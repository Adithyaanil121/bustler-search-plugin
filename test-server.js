// test-server.js — LOCAL TESTING ONLY. Do not use in production.
// Run: HF_TOKEN=your_token_here node test-server.js
// Or on Windows PowerShell: $env:HF_TOKEN="your_token_here"; node test-server.js

'use strict';

const express = require('express');
const search  = require('./index');

const app  = express();
const PORT = 3001;

// ---------------------------------------------------------------------------
// Boot sequence
// ---------------------------------------------------------------------------
(async () => {
  // init() loads skills.json internally — no terms argument needed
  await search.init();

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
        search.saveFiles(); // Save cache to file immediately
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
