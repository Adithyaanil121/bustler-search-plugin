// search-plugin/index.js
// Bustler AI Search & Trending Plugin — Backend Core
// Drop-in plugin for any Express.js codebase. Integrates with 2 lines of code.
// All internal APIs use REST. No database required. No modifications to existing files.

'use strict';

const fs   = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const { pipeline } = require('@xenova/transformers');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HUGGINGFACE_API_URL  = 'https://api-inference.huggingface.co/models/sentence-transformers/all-MiniLM-L6-v2';
const SKILLS_FILE          = path.join(__dirname, 'skills.json');
const CACHE_FILE           = path.join(__dirname, 'query_cache.json');
const COUNTS_FILE          = path.join(__dirname, 'search_counts.json');
const VECTORS_FILE         = path.join(__dirname, 'skill_vectors.json');
const CACHE_SAVE_INTERVAL  = 10 * 60 * 1000; // 10 minutes
const COUNTS_SAVE_INTERVAL = 5 * 60 * 1000;  // 5 minutes
const MIN_SIMILARITY       = 0.3;
const MAX_SUGGESTIONS      = 5;
const MAX_TRENDING         = 2;
const VECTOR_BATCH_SIZE    = 20;              // skills per API batch
const VECTOR_BATCH_DELAY   = 500;             // ms between batches (rate-limit safety)

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let serviceTerms     = [];    // loaded from skills.json on startup
let serviceVectors   = [];    // in-memory vectors: [{ term, vector }]
let skillVectorCache = {};    // persisted to skill_vectors.json: { term: [floats] }
let queryCache       = {};    // { normalizedQuery: [float] } — cached query vectors
let searchCounts     = {};    // { term: count }
let isReady          = false; // true once all service vectors are pre-computed
let trieRoot         = null;  // Trie root node, built on init()
let extractor        = null;  // Local model for vectorizing search queries

// ---------------------------------------------------------------------------
// 1. loadSkills()
// ---------------------------------------------------------------------------

function loadSkills() {
  try {
    const raw = fs.readFileSync(SKILLS_FILE, 'utf8');
    serviceTerms = JSON.parse(raw);

    if (!Array.isArray(serviceTerms) || serviceTerms.length === 0) {
      throw new Error('skills.json is empty or not a valid array');
    }

    console.log(`[search-plugin] Loaded ${serviceTerms.length} service terms from skills.json`);
  } catch (err) {
    // Intentionally throw — the plugin cannot function without the skills corpus
    throw new Error(`[search-plugin] Failed to load skills.json: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// 2. loadFiles()
// ---------------------------------------------------------------------------

function loadFiles() {
  // Load query cache
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const raw = fs.readFileSync(CACHE_FILE, 'utf8');
      queryCache = JSON.parse(raw);
    } else {
      queryCache = {};
    }
  } catch (err) {
    console.error('[search-plugin ERROR] Failed to load query_cache.json — resetting:', err.message);
    queryCache = {};
  }

  // Load search counts
  try {
    if (fs.existsSync(COUNTS_FILE)) {
      const raw = fs.readFileSync(COUNTS_FILE, 'utf8');
      searchCounts = JSON.parse(raw);
    } else {
      searchCounts = {};
    }
  } catch (err) {
    console.error('[search-plugin ERROR] Failed to load search_counts.json — resetting:', err.message);
    searchCounts = {};
  }
}

// ---------------------------------------------------------------------------
// 3. saveFiles()
// ---------------------------------------------------------------------------

function saveFiles() {
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(queryCache, null, 2), 'utf8');
  } catch (err) {
    console.error('[search-plugin ERROR] Failed to save query_cache.json:', err.message);
  }

  try {
    fs.writeFileSync(COUNTS_FILE, JSON.stringify(searchCounts, null, 2), 'utf8');
  } catch (err) {
    console.error('[search-plugin ERROR] Failed to save search_counts.json:', err.message);
  }
}

// ---------------------------------------------------------------------------
// 3b. loadVectors() / saveVectors() — skill vector cache persistence
// ---------------------------------------------------------------------------

function loadVectors() {
  try {
    if (fs.existsSync(VECTORS_FILE)) {
      const raw = fs.readFileSync(VECTORS_FILE, 'utf8');
      skillVectorCache = JSON.parse(raw);
      console.log(`[search-plugin] Loaded ${Object.keys(skillVectorCache).length} cached skill vectors from skill_vectors.json`);
    } else {
      skillVectorCache = {};
    }
  } catch (err) {
    console.error('[search-plugin ERROR] Failed to load skill_vectors.json — resetting:', err.message);
    skillVectorCache = {};
  }
}

function saveVectors() {
  try {
    fs.writeFileSync(VECTORS_FILE, JSON.stringify(skillVectorCache), 'utf8');
    console.log(`[search-plugin] Saved ${Object.keys(skillVectorCache).length} skill vectors to skill_vectors.json`);
  } catch (err) {
    console.error('[search-plugin ERROR] Failed to save skill_vectors.json:', err.message);
  }
}

// Removed getVectorsBatch as it was for the HuggingFace API and is no longer needed
// 3d. precomputeVectors() — vectorize all skills, cache to disk
//     Only calls the API for skills not already in skill_vectors.json.
//     Batches API calls in groups of VECTOR_BATCH_SIZE with delays.
// ---------------------------------------------------------------------------

async function precomputeVectors() {
  loadVectors();

  let missingCount = 0;
  // Populate the in-memory serviceVectors array for fast lookups
  serviceVectors = [];
  for (const term of serviceTerms) {
    const lowerTerm = term.toLowerCase();
    let vec = skillVectorCache[lowerTerm];
    
    if (!vec) {
      console.log(`[search-plugin] Computing missing vector locally for: ${term}`);
      vec = await getVector(lowerTerm);
      if (vec) {
        skillVectorCache[lowerTerm] = vec;
        missingCount++;
      }
    }

    if (vec) {
      serviceVectors.push({ term, vector: vec });
    }
  }

  if (missingCount > 0) {
    saveVectors();
  }

  console.log(`[search-plugin] ${serviceVectors.length}/${serviceTerms.length} skills have vectors ready for semantic search.`);
}

// ---------------------------------------------------------------------------
// 4. getVector(text) — REST call to HuggingFace Inference API
// ---------------------------------------------------------------------------

async function getVector(text) {
  try {
    if (!extractor) {
      console.error('[search-plugin ERROR] Local model not loaded yet');
      return null;
    }
    
    // Vectorize the single query string locally
    const output = await extractor(text, { pooling: 'mean', normalize: true });
    return Array.from(output.data);
  } catch (err) {
    console.error('[search-plugin ERROR] getVector() failed:', err.message);
    return null;
  }
}

// ---------------------------------------------------------------------------
// 5. cosineSimilarity(vecA, vecB) — pure math, no async
// ---------------------------------------------------------------------------

function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB || vecA.length === 0 || vecB.length === 0) return 0;

  try {
    let dot  = 0;
    let magA = 0;
    let magB = 0;

    for (let i = 0; i < vecA.length; i++) {
      dot  += vecA[i] * vecB[i];
      magA += vecA[i] * vecA[i];
      magB += vecB[i] * vecB[i];
    }

    const magnitude = Math.sqrt(magA) * Math.sqrt(magB);
    if (magnitude === 0) return 0;

    return dot / magnitude;
  } catch (err) {
    console.error('[search-plugin ERROR] cosineSimilarity() failed:', err.message);
    return 0;
  }
}

// ---------------------------------------------------------------------------
// 6. Trie (Prefix Tree) — O(k) lookup, k = query length
//    The most efficient data structure for character-by-character prefix match.
//    Each node stores a map of children keyed by character.
//    Terminal nodes store the original skill string.
// ---------------------------------------------------------------------------

class TrieNode {
  constructor() {
    this.children = {};   // { char: TrieNode }
    this.isEnd    = false;
    this.term     = null; // original skill string at terminal nodes
  }
}

/**
 * Build the Trie from the serviceTerms array.
 * Called once during init(). O(n * m) where n = terms, m = avg term length.
 */
function buildTrie() {
  trieRoot = new TrieNode();

  for (const term of serviceTerms) {
    let node = trieRoot;
    const lower = term.toLowerCase();

    for (const ch of lower) {
      if (!node.children[ch]) {
        node.children[ch] = new TrieNode();
      }
      node = node.children[ch];
    }

    node.isEnd = true;
    node.term  = term; // preserve original casing
  }

  console.log(`[search-plugin] Trie built with ${serviceTerms.length} terms.`);
}

/**
 * Collect up to `limit` completions below a given Trie node using DFS.
 * Returns as soon as `limit` results are found — no wasted traversal.
 */
function collectFromNode(node, results, limit) {
  if (results.length >= limit) return;

  if (node.isEnd) {
    results.push(node.term);
    if (results.length >= limit) return;
  }

  // Traverse children in alphabetical order for consistent results
  const keys = Object.keys(node.children).sort();
  for (const ch of keys) {
    collectFromNode(node.children[ch], results, limit);
    if (results.length >= limit) return;
  }
}

/**
 * Trie-based prefix search.
 * 1. Walk the trie character by character following the query — O(k)
 * 2. If any character has no child, return [] instantly (no match)
 * 3. Collect completions via DFS from the landing node — stops at MAX_SUGGESTIONS
 *
 * For multi-word queries (e.g. "web dev"), also searches each word in the
 * query against word boundaries in multi-word skills.
 */
function prefixMatch(query) {
  if (!query || query.length === 0 || !trieRoot) return [];

  try {
    const q = query.toLowerCase().trim();
    if (q.length === 0) return [];

    // --- Primary: Trie walk for exact prefix ---
    let node = trieRoot;
    for (const ch of q) {
      if (!node.children[ch]) {
        node = null;
        break;
      }
      node = node.children[ch];
    }

    const results = [];
    if (node) {
      collectFromNode(node, results, MAX_SUGGESTIONS);
    }

    // If we already have enough, return immediately
    if (results.length >= MAX_SUGGESTIONS) {
      return results.slice(0, MAX_SUGGESTIONS);
    }

    // --- Secondary: word-boundary match for multi-word queries ---
    // e.g. typing "dev" also finds "web developer", "game developer"
    const seen = new Set(results.map(t => t.toLowerCase()));
    for (const term of serviceTerms) {
      if (results.length >= MAX_SUGGESTIONS) break;
      const t = term.toLowerCase();
      if (!seen.has(t) && (t.includes(` ${q}`) || t.includes(`-${q}`))) {
        results.push(term);
        seen.add(t);
      }
    }

    return results.slice(0, MAX_SUGGESTIONS);
  } catch (err) {
    console.error('[search-plugin ERROR] prefixMatch() failed:', err.message);
    return [];
  }
}

// ---------------------------------------------------------------------------
// 7. semanticMatch(query) — AI vector similarity with cache
//    1. Get query vector (from queryCache or API call)
//    2. Compare against all pre-computed serviceVectors via cosine similarity
//    3. Return top matches above MIN_SIMILARITY threshold
// ---------------------------------------------------------------------------

async function semanticMatch(query) {
  try {
    // Skip if vectors aren't ready or no service vectors exist
    if (!isReady || serviceVectors.length === 0) return [];

    const normalised = query.toLowerCase().trim();
    if (!normalised) return [];

    // 1. Get query vector — check cache first, then API
    let queryVector = queryCache[normalised];

    if (!queryVector) {
      queryVector = await getVector(normalised);
      if (!queryVector) {
        // API call failed — fall back to prefix-only results
        return [];
      }
      // Cache the query vector for future use
      queryCache[normalised] = queryVector;
    }

    // 2. Compute cosine similarity against all service vectors
    const scored = [];
    for (const { term, vector } of serviceVectors) {
      const sim = cosineSimilarity(queryVector, vector);
      if (sim >= MIN_SIMILARITY) {
        scored.push({ term, score: sim });
      }
    }

    // 3. Sort descending by similarity, return top results
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, MAX_SUGGESTIONS).map(s => s.term);
  } catch (err) {
    console.error('[search-plugin ERROR] semanticMatch() failed:', err.message);
    return [];
  }
}

// ---------------------------------------------------------------------------
// 8. getSuggestions(query) — main exported function
// ---------------------------------------------------------------------------

async function getSuggestions(query) {
  try {
    if (!query || query.length < 1) return [];

    // Normalise query
    const trimmed = query.trim();
    if (trimmed.length === 0) return [];

    // Security: reject excessively long queries
    if (trimmed.length > 100) return [];

    // Run both matching strategies in parallel
    const [prefixResults, semanticResults] = await Promise.all([
      prefixMatch(trimmed),
      semanticMatch(trimmed),
    ]);

    // Merge and deduplicate (case insensitive)
    const seen = new Set();
    const merged = [];

    for (const term of [...prefixResults, ...semanticResults]) {
      const key = term.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(term);
      }
      if (merged.length >= MAX_SUGGESTIONS) break;
    }

    return merged;
  } catch (err) {
    console.error('[search-plugin ERROR] getSuggestions() failed:', err.message);
    return [];
  }
}

// ---------------------------------------------------------------------------
// 9. recordSearch(term)
// ---------------------------------------------------------------------------

function recordSearch(term) {
  try {
    const normalised = term.toLowerCase().trim();
    if (!normalised) return;

    searchCounts[normalised] = (searchCounts[normalised] || 0) + 1;
  } catch (err) {
    console.error('[search-plugin ERROR] recordSearch() failed:', err.message);
  }
}

// ---------------------------------------------------------------------------
// 10. getTrending() — second exported function
// ---------------------------------------------------------------------------

function getTrending() {
  try {
    const entries = Object.entries(searchCounts);
    if (entries.length === 0) return [];

    return entries
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_TRENDING)
      .map(([term]) => term);
  } catch (err) {
    console.error('[search-plugin ERROR] getTrending() failed:', err.message);
    return [];
  }
}

// ---------------------------------------------------------------------------
// 11. init() — setup function, called once on server startup
// ---------------------------------------------------------------------------

async function init() {
  try {

    // Load the skills corpus from skills.json (throws if missing)
    loadSkills();

    // Build the Trie index for O(k) prefix lookups
    buildTrie();

    // Restore persisted state from JSON files (query cache, search counts)
    loadFiles();

    console.log(`[search-plugin] Loaded ${serviceTerms.length} service terms with Trie index for autocomplete.`);

    // Load local model for queries
    console.log('[search-plugin] Loading local embedding model for queries...');
    extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
    console.log('[search-plugin] Local model loaded.');

    // Load precomputed vectors
    await precomputeVectors();
    isReady = true;

    // Start auto-save intervals
    setInterval(saveFiles, CACHE_SAVE_INTERVAL);
    setInterval(saveFiles, COUNTS_SAVE_INTERVAL);

    console.log(`[search-plugin] Ready. Prefix + Semantic search enabled for ${serviceTerms.length} terms.`);
  } catch (err) {
    console.error('[search-plugin ERROR] init() failed:', err.message);
  }
}

// ---------------------------------------------------------------------------
// Exports — the 3 public functions any codebase calls
// ---------------------------------------------------------------------------

module.exports = {
  init,
  getSuggestions,
  getTrending,
  recordSearch,
  saveFiles,
};
