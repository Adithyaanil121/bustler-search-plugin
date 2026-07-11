// test-server.js — LOCAL TESTING ONLY. Do not use in production.
// Run: HF_TOKEN=your_token_here node test-server.js
// Or on Windows PowerShell: $env:HF_TOKEN="your_token_here"; node test-server.js

'use strict';

const express = require('express');
const search  = require('../src/core/index');
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const app  = express();
const PORT = 3001;

// ---------------------------------------------------------------------------
// Boot sequence
// ---------------------------------------------------------------------------
(async () => {
  // init() loads skills.json internally — no terms argument needed
  await search.init(process.env.HF_TOKEN);

  // ---------------------------------------------------------------------------
  // REST API Endpoints
  // ---------------------------------------------------------------------------

  // Serve static files for frontend testing
  app.use(express.static(__dirname));
  app.use(express.json());

  /**
   * GET /api/search/suggestions?q={query}
   * Returns AI-powered autocomplete suggestions for the given query.
   *
   * Response: { suggestions: string[] }
   */
  app.get('/api/search/suggestions', async (req, res) => {
    try {
      const query = req.query.q || '';
      const suggestions = await search.getSuggestions(query);
      res.json({ suggestions });
    } catch (err) {
      console.error('[test-server] /api/search/suggestions error:', err.message);
      res.status(500).json({ suggestions: [] });
    }
  });

  /**
   * GET /api/search/trending
   * Returns the top trending search terms based on recorded search counts.
   *
   * Response: { trending: string[] }
   */
  app.get('/api/search/trending', (req, res) => {
    try {
      const trending = search.getTrending();
      res.json({ trending });
    } catch (err) {
      console.error('[test-server] /api/search/trending error:', err.message);
      res.status(500).json({ trending: [] });
    }
  });

  /**
   * GET /api/search/results?q={query}
   * Returns the final search results (services only) sorted by vector similarity and bookings.
   */
  app.get('/api/search/results', async (req, res) => {
    try {
      const query = req.query.q || '';
      const results = await search.search(query);
      res.json({ results });
    } catch (err) {
      console.error('[test-server] /api/search/results error:', err.message);
      res.status(500).json({ results: [] });
    }
  });

  /**
   * GET /api/search/categories
   * Returns all available categories for the filter drawer.
   */
  app.get('/api/search/categories', (req, res) => {
    try {
      const categories = search.getCategories();
      res.json({ categories });
    } catch (err) {
      console.error('[test-server] /api/search/categories error:', err.message);
      res.status(500).json({ categories: [] });
    }
  });

  /**
   * POST /api/search/webhook/service-created
   * Triggers vector calculation and caches a newly added service to the Trie and memory.
   */
  app.post('/api/search/webhook/service-created', async (req, res) => {
    try {
      const { serviceId } = req.body;
      if (!serviceId) return res.status(400).json({ success: false, error: 'Missing serviceId' });
      const success = await search.handleNewService(serviceId);
      res.json({ success });
    } catch (err) {
      console.error('[test-server] /api/search/webhook error:', err.message);
      res.status(500).json({ success: false });
    }
  });

  /**
   * POST /api/search/record
   * Records a confirmed search for trending calculation and saves to disk immediately.
   *
   * Request body: { query: string }
   */
  app.post('/api/search/record', (req, res) => {
    try {
      const query = req.body.query;
      if (query && query.trim()) {
        search.recordSearch(query);
      }
      res.json({ success: true });
    } catch (err) {
      console.error('[test-server] /api/search/record error:', err.message);
      res.status(500).json({ success: false });
    }
  });

  // ---------------------------------------------------------------------------
  // Start server
  // ---------------------------------------------------------------------------
  app.listen(PORT, () => {
    console.log(`\n[test-server] Running at http://localhost:${PORT}`);
    console.log('[test-server] REST API endpoints:');
    console.log(`  GET http://localhost:${PORT}/api/search/suggestions?q=photo`);
    console.log(`  GET http://localhost:${PORT}/api/search/trending`);
    console.log('\n[test-server] WARNING: This server is for local development only.\n');
  });
})();
