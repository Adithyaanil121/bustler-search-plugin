# Bustler AI Search & Trending Plugin

A self-contained Node.js plugin that adds lightning-fast, AI-powered autocomplete suggestions and trending searches to the Bustler marketplace. 

This plugin acts as a **smart "middleman"** (a discovery engine). It does not replace the existing PostgreSQL database or the actual data retrieval logic. Instead, it sits between the user's keystrokes and the database to correct misspelled words and understand natural language intent (e.g., typing "mow lawn" suggests "gardener"), ensuring the existing database receives clean, perfect keywords to search for.

It runs entirely offline using local AI models (`@xenova/transformers`) and local JSON caching. It requires zero database schema changes, zero modifications to existing database structures, and no external API tokens.

---

## 🚀 How It Acts as a "Middleman"

Your existing data retrieval system is safe! Here is the exact flow:

1. **User Types:** A user types "fix sink" into the search bar.
2. **Plugin Autocompletes:** The frontend asks this plugin for suggestions. The plugin instantly returns "plumber".
3. **User Clicks:** The user selects "plumber" from the dropdown.
4. **Existing System Takes Over:** The frontend sends "plumber" to Bustler's existing database retrieval API. Bustler's existing logic successfully retrieves and displays the freelancer profiles from PostgreSQL.

By passing through this plugin first, your existing database never has to deal with messy, conversational, or misspelled search queries.

---

## ✨ Features

- **Lightning-Fast Autocomplete:** Uses an optimized Trie (Prefix Tree) data structure in memory to return instantaneous suggestions as the user types.
- **Semantic (Smart) Search:** Runs a local AI model to understand the *meaning* of words. If a user types conversational queries, it maps them to official marketplace skills.
- **Auto-Healing Vector Database:** If you add a new skill to `skills.json` and restart the server, the plugin automatically detects the new skill, computes its AI vector locally, and saves it. Zero maintenance code required.
- **Trending Searches:** Quietly tracks search counts to provide a live list of "Trending Skills" when the search bar is empty.

---

## 📦 Installation Guide

Navigate to the plugin directory and install the local dependencies:

```bash
cd search-plugin
npm install
```

This installs exactly two dependencies:
- `node-fetch@2` (for HTTP logic)
- `@xenova/transformers` (for the local AI semantic search)

---

## 🛠️ Integration Guide — Backend (2 Lines of Code)

You do not need to replace your backend. Simply add this plugin as a new module in your existing Express.js server:

```javascript
// 1. Import the plugin
const aiSearch = require('./search-plugin/index.js');

// 2. Initialize it when your server starts (this loads skills into memory)
await aiSearch.init();

// 3. Create your new Autocomplete Route
app.get('/api/search/suggestions', async (req, res) => {
  const suggestions = await aiSearch.getSuggestions(req.query.q);
  res.json({ suggestions });
});

// 4. Create your new Trending Route
app.get('/api/search/trending', (req, res) => {
  const trending = aiSearch.getTrending();
  res.json({ trending });
});
```

---

## 💻 Integration Guide — Frontend

Point your React search bar's API calls to your newly created `/api/search/suggestions` endpoint. 

*(A fully working test UI is provided in `test.html` and `SearchBar.jsx` if your frontend team needs an example of how to implement the dropdown UI, but they can just use their existing search UI.)*

---

## 📁 File Structure

```
search-plugin/
  index.js              ← Core backend logic (Trie, Semantic Search, Cache)
  skills.json           ← The master list of marketplace skills (Edit this to add skills)
  skill_vectors.json    ← Auto-generated AI embeddings for semantic search
  query_cache.json      ← Auto-generated cache for user queries (makes repeated searches instant)
  search_counts.json    ← Auto-generated cache for trending search analytics
  test-server.js        ← Sandbox server for local testing ONLY
  package.json          ← Dependencies
  README.md             ← This documentation
```

---

## 🧪 Local Testing

To verify the plugin works before integrating it into Bustler's main app:

```bash
node test-server.js
```
Then open `http://localhost:3001` in your browser to test the live search UI and see the middleman logic in action.

---

## ⚙️ Maintenance & Adding New Skills

Adding new skills to the platform is fully automated:
1. Open `skills.json`.
2. Add your new skill string (e.g., `"drone operator"`).
3. Save the file and restart your Express server.

The plugin's `init()` function will automatically detect the missing skill, spin up the local AI model, compute the vector, and save it to `skill_vectors.json`. No scripts to run!
