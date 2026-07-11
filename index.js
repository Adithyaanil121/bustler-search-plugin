'use strict';

const fs = require('fs');
const path = require('path');
const db = require('./db');

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const CACHE_FILE = path.join(__dirname, 'query_cache.json');
const COUNTS_FILE = path.join(__dirname, 'search_counts.json');
const VECTORS_FILE = path.join(__dirname, 'skill_vectors.json');
const CACHE_SAVE_INTERVAL = 10 * 60 * 1000;
const COUNTS_SAVE_INTERVAL = 5 * 60 * 1000;
const MIN_SIMILARITY = 0.2;
const MAX_SUGGESTIONS = 5;
// Minimum characters needed before we call the HF API for semantic search.
// Trie + Fuzzy handle anything shorter for free (zero API tokens).
const MIN_SEMANTIC_LENGTH = 3;

// In-flight deduplication: if two callers ask for the same vector simultaneously,
// they share one pending HF request instead of firing two.
const inFlight = new Map();

let categories = [];
let services = [];
let vectorCache = {};
let queryCache = {};
let searchCounts = {};
let isReady = false;
let trieRoot = null;
let hfToken = null;

function loadFiles() {
  try {
    if (fs.existsSync(CACHE_FILE)) queryCache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    if (fs.existsSync(COUNTS_FILE)) searchCounts = JSON.parse(fs.readFileSync(COUNTS_FILE, 'utf8'));
  } catch (e) {}
}

function saveFiles() {
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(queryCache, null, 2));
    fs.writeFileSync(COUNTS_FILE, JSON.stringify(searchCounts, null, 2));
  } catch (e) {}
}

function loadVectors() {
  try {
    if (fs.existsSync(VECTORS_FILE)) vectorCache = JSON.parse(fs.readFileSync(VECTORS_FILE, 'utf8'));
  } catch (e) {}
}

function saveVectors() {
  try {
    fs.writeFileSync(VECTORS_FILE, JSON.stringify(vectorCache));
  } catch (e) {}
}

async function getVector(text) {
  // Dedup: return the same promise if a request for this text is already in-flight
  if (inFlight.has(text)) return inFlight.get(text);

  const promise = (async () => {
    try {
      if (!hfToken) return null;
      const url = 'https://router.huggingface.co/hf-inference/models/sentence-transformers/all-MiniLM-L6-v2/pipeline/feature-extraction';
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${hfToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ inputs: text })
      });
      if (!response.ok) return null;
      const data = await response.json();
      if (Array.isArray(data) && Array.isArray(data[0])) return data[0];
      if (Array.isArray(data)) return data;
      return null;
    } catch (err) {
      return null;
    } finally {
      inFlight.delete(text);
    }
  })();

  inFlight.set(text, promise);
  return promise;
}

function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB || vecA.length === 0 || vecB.length === 0) return 0;
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dot += vecA[i] * vecB[i];
    magA += vecA[i] * vecA[i];
    magB += vecB[i] * vecB[i];
  }
  const magnitude = Math.sqrt(magA) * Math.sqrt(magB);
  return magnitude === 0 ? 0 : dot / magnitude;
}

class TrieNode {
  constructor() {
    this.children = {};
    this.isEnd = false;
    this.items = [];
  }
}

function insertTrie(text, item) {
  if (!text) return;
  let node = trieRoot;
  for (const ch of text.toLowerCase()) {
    if (!node.children[ch]) node.children[ch] = new TrieNode();
    node = node.children[ch];
  }
  node.isEnd = true;
  node.items.push(item);
}

async function init(token) {
  hfToken = token || process.env.HF_TOKEN;
  loadFiles();
  loadVectors();

  console.log('[search-plugin] Fetching data from database...');
  try {
    categories = await db('categories').select('id', 'name', 'description');
    services = await db('services').select('id', 'category_id', 'title', 'description', 'short_description', 'total_bookings', 'base_price_cents', 'rating', 'total_reviews', 'provider_id', 'images', 'pricing_type');
  } catch(e) {
    console.error('Error fetching from DB:', e);
  }

  trieRoot = new TrieNode();
  for (const cat of categories) insertTrie(cat.name, { type: 'category', text: cat.name, id: cat.id });
  for (const srv of services) insertTrie(srv.title, { type: 'service', text: srv.title, id: srv.id });

  let missing = 0;
  for (const cat of categories) {
    if (!vectorCache[cat.id]) {
      vectorCache[cat.id] = await getVector(`${cat.name} ${cat.description || ''}`.trim());
      missing++;
    }
  }
  for (const srv of services) {
    if (!vectorCache[srv.id]) {
      vectorCache[srv.id] = await getVector(`${srv.title} ${srv.short_description || ''} ${srv.description || ''}`.trim());
      missing++;
    }
  }

  if (missing > 0) saveVectors();
  isReady = true;

  setInterval(saveFiles, CACHE_SAVE_INTERVAL);
  setInterval(saveFiles, COUNTS_SAVE_INTERVAL);
  console.log(`[search-plugin] Init complete. Ready for searches. (Loaded ${categories.length} categories, ${services.length} services)`);
}

function prefixMatch(query) {
  if (!query || !trieRoot) return [];
  let node = trieRoot;
  for (const ch of query.toLowerCase()) {
    if (!node.children[ch]) return [];
    node = node.children[ch];
  }
  const results = [];
  function collect(n, lim) {
    if (results.length >= lim) return;
    if (n.isEnd) results.push(...n.items);
    for (const c of Object.keys(n.children).sort()) {
      collect(n.children[c], lim);
      if (results.length >= lim) return;
    }
  }
  collect(node, MAX_SUGGESTIONS * 3);
  return results;
}

// ---------------------------------------------------------------------------
// Damerau-Levenshtein (Optimal String Alignment variant)
// Handles: insert, delete, replace, AND transposition (swapped adjacent chars)
// e.g. "teh" → "the" = 1 edit (not 2 like standard Levenshtein)
// ---------------------------------------------------------------------------
function damerauLevenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,       // deletion
        dp[i][j - 1] + 1,       // insertion
        dp[i - 1][j - 1] + cost // substitution
      );
      // Transposition: if current chars are a swap of the previous two
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        dp[i][j] = Math.min(dp[i][j], dp[i - 2][j - 2] + cost);
      }
    }
  }
  return dp[m][n];
}

// Fuzzy match query against each word inside a title.
// Tolerance: 1 edit per 4 chars of the query (min 1, max 3).
function fuzzyMatch(query) {
  if (!query) return [];
  const q = query.toLowerCase();
  const tolerance = Math.min(3, Math.max(1, Math.floor(q.length / 4)));
  const scored = [];

  const allItems = [
    ...categories.map(c => ({ type: 'category', text: c.name, id: c.id })),
    ...services.map(s => ({ type: 'service', text: s.title, id: s.id }))
  ];

  for (const item of allItems) {
    if (!item.text) continue;
    const words = item.text.toLowerCase().split(/\s+/);
    // Score = best (lowest) edit distance across all individual words in the title
    let bestDist = Infinity;
    for (const word of words) {
      if (Math.abs(word.length - q.length) > tolerance + 1) continue; // fast skip
      const dist = damerauLevenshtein(q, word);
      if (dist < bestDist) bestDist = dist;
    }
    // Also check edit distance of query against the full title (good for short titles)
    const fullDist = damerauLevenshtein(q, item.text.toLowerCase());
    if (fullDist < bestDist) bestDist = fullDist;

    if (bestDist <= tolerance) {
      scored.push({ ...item, dist: bestDist });
    }
  }

  // Sort by edit distance ascending (closest match first)
  scored.sort((a, b) => a.dist - b.dist);
  return scored;
}

// Substring (contains) match — catches partial mid-word typing like "inst" → "Installation"
function substringMatch(query) {
  if (!query || query.length < 2) return [];
  const q = query.toLowerCase();
  const results = [];

  const allItems = [
    ...categories.map(c => ({ type: 'category', text: c.name, id: c.id })),
    ...services.map(s => ({ type: 'service', text: s.title, id: s.id }))
  ];

  for (const item of allItems) {
    if (!item.text) continue;
    if (item.text.toLowerCase().includes(q)) {
      results.push(item);
    }
  }
  return results;
}

async function getSuggestions(query) {
  if (!isReady || !query.trim()) return [];
  const q = query.toLowerCase().trim();

  // 1. Exact prefix match (Trie) — zero cost
  const prefixResults = prefixMatch(q);

  // 2. Fuzzy match (Damerau-Levenshtein) — zero cost, pure JS
  const fuzzyResults = fuzzyMatch(q);

  // 3. Substring match (contains) — zero cost, catches mid-word typing
  const substringResults = substringMatch(q);

  // SHORT-CIRCUIT: if cheap layers already found enough suggestions,
  // skip the HF API call entirely — this is the biggest token saver.
  const cheapResults = [...prefixResults, ...fuzzyResults, ...substringResults];
  if (cheapResults.length >= MAX_SUGGESTIONS) {
    const seen = new Set();
    const final = [];
    for (const item of cheapResults) {
      if (!seen.has(item.text.toLowerCase())) {
        seen.add(item.text.toLowerCase());
        final.push(item.text);
      }
      if (final.length >= MAX_SUGGESTIONS) break;
    }
    return final;
  }

  // 3. Semantic vector match — only if query is long enough AND we need more results
  let qVector = null;
  if (q.length >= MIN_SEMANTIC_LENGTH) {
    qVector = queryCache[q];
    if (!qVector) {
      qVector = await getVector(q);
      if (qVector) {
        queryCache[q] = qVector;
        // Save immediately so restarts don't recompute this (saves tokens on every boot)
        saveFiles();
      }
    }
  }

  const semanticCats = [];
  const semanticSrvs = [];
  if (qVector) {
    for (const cat of categories) {
      const sim = cosineSimilarity(qVector, vectorCache[cat.id]);
      if (sim >= MIN_SIMILARITY) semanticCats.push({ type: 'category', text: cat.name, id: cat.id, sim });
    }
    for (const srv of services) {
      const sim = cosineSimilarity(qVector, vectorCache[srv.id]);
      if (sim >= MIN_SIMILARITY) semanticSrvs.push({ type: 'service', text: srv.title, id: srv.id, sim });
    }
  }

  let topCatSim = semanticCats.length ? Math.max(...semanticCats.map(c => c.sim)) : 0;
  let topSrvSim = semanticSrvs.length ? Math.max(...semanticSrvs.map(s => s.sim)) : 0;

  // AI Reasoning: decide whether to lead with categories or services
  const leadWithCategories = topCatSim > topSrvSim + 0.05;

  // Build candidate list: prefix (exact) → fuzzy → substring → semantic
  let merged = [];
  if (leadWithCategories) {
    merged = [
      ...prefixResults.filter(p => p.type === 'category').map(p => p.text),
      ...fuzzyResults.filter(f => f.type === 'category').map(f => f.text),
      ...substringResults.filter(s => s.type === 'category').map(s => s.text),
      ...semanticCats.sort((a, b) => b.sim - a.sim).map(c => c.text)
    ];
  } else {
    merged = [
      ...prefixResults.filter(p => p.type === 'service').map(p => p.text),
      ...fuzzyResults.filter(f => f.type === 'service').map(f => f.text),
      ...substringResults.filter(s => s.type === 'service').map(s => s.text),
      ...semanticSrvs.sort((a, b) => b.sim - a.sim).map(s => s.text)
    ];
  }

  // Fallback: if still nothing, mix everything
  if (merged.length === 0) {
    merged = [
      ...prefixResults.map(p => p.text),
      ...fuzzyResults.map(f => f.text),
      ...substringResults.map(s => s.text),
      ...semanticCats.map(c => c.text),
      ...semanticSrvs.map(s => s.text)
    ];
  }

  // Deduplicate, preserve priority order
  const seen = new Set();
  const final = [];
  for (const item of merged) {
    if (!seen.has(item.toLowerCase())) {
      seen.add(item.toLowerCase());
      final.push(item);
    }
    if (final.length >= MAX_SUGGESTIONS) break;
  }
  return final;
}

async function search(query) {
  if (!isReady || !query.trim()) return [];
  const q = query.toLowerCase().trim();
  
  let qVector = queryCache[q];
  if (!qVector) {
    qVector = await getVector(q);
    if (qVector) queryCache[q] = qVector;
  }

  if (!qVector) return [];

  const catMap = {};
  for (const cat of categories) {
    catMap[cat.id] = cat.name;
  }

  const results = [];
  for (const srv of services) {
    const sim = cosineSimilarity(qVector, vectorCache[srv.id]);
    if (sim >= MIN_SIMILARITY) {
      results.push({ ...srv, category_name: catMap[srv.category_id] || '', sim });
    }
  }

  results.sort((a, b) => {
    if (Math.abs(a.sim - b.sim) < 0.05) {
      return (b.total_bookings || 0) - (a.total_bookings || 0);
    }
    return b.sim - a.sim;
  });

  return results.slice(0, 10);
}

function getCategories() {
  return categories.map(c => ({ id: c.id, name: c.name }));
}

function recordSearch(term) {
  if (!term.trim()) return;
  const t = term.toLowerCase().trim();
  searchCounts[t] = (searchCounts[t] || 0) + 1;
}

function getTrending() {
  return Object.entries(searchCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(e => e[0]);
}

async function handleNewService(serviceId) {
  try {
    const srv = await db('services').select('id', 'category_id', 'title', 'description', 'short_description', 'total_bookings', 'base_price_cents', 'rating', 'total_reviews', 'provider_id', 'images', 'pricing_type').where({ id: serviceId }).first();
    if (!srv) return false;
    services.push(srv);
    insertTrie(srv.title, { type: 'service', text: srv.title, id: srv.id });
    
    const vec = await getVector(`${srv.title} ${srv.short_description || ''} ${srv.description || ''}`.trim());
    if (vec) {
      vectorCache[srv.id] = vec;
      saveVectors();
    }
    return true;
  } catch(e) {
    console.error('Webhook error:', e);
    return false;
  }
}

module.exports = {
  init,
  getSuggestions,
  search,
  getTrending,
  recordSearch,
  handleNewService,
  getCategories
};
