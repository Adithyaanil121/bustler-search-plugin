// SearchBar.jsx — Standalone React component for Bustler AI Search
// Drop-in: import SearchBar from './search-plugin/SearchBar';
// Usage:   <SearchBar apiBase="https://your-api.com" onSearch={(term) => {}} />
// No external dependencies. Inline styles only.

import React, { useState, useEffect, useRef, useCallback } from 'react';
import PropTypes from 'prop-types';

function SearchBar({ apiBase, onSearch, placeholder = 'Search services...' }) {
  const [query, setQuery]             = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [trending, setTrending]       = useState([]);
  const [isLoading, setIsLoading]     = useState(false);
  const [isOpen, setIsOpen]           = useState(false);

  const debounceTimer = useRef(null);
  const blurTimer     = useRef(null);
  const inputRef      = useRef(null);

  // -------------------------------------------------------------------------
  // Fetch trending on mount
  // -------------------------------------------------------------------------
  useEffect(() => {
    async function fetchTrending() {
      try {
        const res = await fetch(`${apiBase}/api/search/trending`);
        const data = await res.json();
        if (data.trending && Array.isArray(data.trending)) {
          setTrending(data.trending);
        }
      } catch (err) {
        console.error('[SearchBar] Failed to fetch trending:', err.message);
      }
    }
    fetchTrending();
  }, [apiBase]);

  // -------------------------------------------------------------------------
  // Fetch suggestions (debounced)
  // -------------------------------------------------------------------------
  const fetchSuggestions = useCallback(async (q) => {
    if (!q || q.trim().length === 0) {
      setSuggestions([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    try {
      const res = await fetch(`${apiBase}/api/search/suggestions?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      if (data.suggestions && Array.isArray(data.suggestions)) {
        setSuggestions(data.suggestions);
      } else {
        setSuggestions([]);
      }
    } catch (err) {
      console.error('[SearchBar] Failed to fetch suggestions:', err.message);
      setSuggestions([]);
    } finally {
      setIsLoading(false);
    }
  }, [apiBase]);

  // -------------------------------------------------------------------------
  // Input change handler with 300ms debounce
  // -------------------------------------------------------------------------
  const handleChange = (e) => {
    const value = e.target.value;
    setQuery(value);
    setIsOpen(true);

    // Clear previous debounce timer
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
    }

    if (!value || value.trim().length === 0) {
      setSuggestions([]);
      setIsLoading(false);
      return;
    }

    // Debounce: wait 300ms before fetching
    setIsLoading(true);
    debounceTimer.current = setTimeout(() => {
      fetchSuggestions(value);
    }, 300);
  };

  // -------------------------------------------------------------------------
  // Focus handler — show dropdown
  // -------------------------------------------------------------------------
  const handleFocus = () => {
    if (blurTimer.current) {
      clearTimeout(blurTimer.current);
    }
    setIsOpen(true);
  };

  // -------------------------------------------------------------------------
  // Blur handler — hide dropdown after 150ms delay
  // -------------------------------------------------------------------------
  const handleBlur = () => {
    blurTimer.current = setTimeout(() => {
      setIsOpen(false);
    }, 150);
  };

  // -------------------------------------------------------------------------
  // Suggestion click handler
  // -------------------------------------------------------------------------
  const handleSelect = (term) => {
    setQuery(term);
    setSuggestions([]);
    setIsOpen(false);
    if (onSearch) {
      onSearch(term);
    }
  };

  // -------------------------------------------------------------------------
  // Keyboard handler
  // -------------------------------------------------------------------------
  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      setQuery('');
      setSuggestions([]);
      setIsOpen(false);
      if (inputRef.current) {
        inputRef.current.blur();
      }
    }
  };

  // -------------------------------------------------------------------------
  // Cleanup timers on unmount
  // -------------------------------------------------------------------------
  useEffect(() => {
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      if (blurTimer.current) clearTimeout(blurTimer.current);
    };
  }, []);

  // -------------------------------------------------------------------------
  // Determine what to show in the dropdown
  // -------------------------------------------------------------------------
  const showTrending    = isOpen && query.trim().length === 0 && trending.length > 0;
  const showSuggestions = isOpen && query.trim().length > 0 && (suggestions.length > 0 || isLoading);

  // -------------------------------------------------------------------------
  // Inline styles
  // -------------------------------------------------------------------------
  const styles = {
    container: {
      position: 'relative',
      width: '100%',
      maxWidth: '480px',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    },
    input: {
      width: '100%',
      padding: '10px 14px',
      fontSize: '15px',
      border: '1px solid #d1d5db',
      borderRadius: '8px',
      outline: 'none',
      boxSizing: 'border-box',
      transition: 'border-color 0.2s ease',
    },
    dropdown: {
      position: 'absolute',
      top: '100%',
      left: 0,
      right: 0,
      marginTop: '4px',
      background: '#ffffff',
      border: '1px solid #e5e7eb',
      borderRadius: '8px',
      boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)',
      zIndex: 1000,
      overflow: 'hidden',
    },
    sectionLabel: {
      padding: '8px 14px 4px',
      fontSize: '11px',
      fontWeight: 600,
      color: '#9ca3af',
      textTransform: 'uppercase',
      letterSpacing: '0.05em',
    },
    item: {
      padding: '8px 14px',
      fontSize: '14px',
      color: '#374151',
      cursor: 'pointer',
      transition: 'background-color 0.15s ease',
    },
    itemHover: {
      backgroundColor: '#f3f4f6',
    },
    loading: {
      padding: '8px 14px',
      fontSize: '13px',
      color: '#9ca3af',
      fontStyle: 'italic',
    },
  };

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  return (
    <div style={styles.container}>
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={handleChange}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        style={styles.input}
        autoComplete="off"
        aria-label="Search services"
        id="bustler-search-input"
      />

      {/* Trending dropdown — shown when input is empty and focused */}
      {showTrending && (
        <div style={styles.dropdown} role="listbox" id="bustler-trending-list">
          <div style={styles.sectionLabel}>Trending</div>
          {trending.map((term, idx) => (
            <div
              key={`trending-${idx}`}
              style={styles.item}
              role="option"
              onMouseDown={() => handleSelect(term)}
              onMouseEnter={(e) => { e.target.style.backgroundColor = '#f3f4f6'; }}
              onMouseLeave={(e) => { e.target.style.backgroundColor = 'transparent'; }}
            >
              {term}
            </div>
          ))}
        </div>
      )}

      {/* Suggestions dropdown — shown when user is typing */}
      {showSuggestions && (
        <div style={styles.dropdown} role="listbox" id="bustler-suggestions-list">
          {isLoading && suggestions.length === 0 && (
            <div style={styles.loading}>Searching...</div>
          )}
          {suggestions.map((term, idx) => (
            <div
              key={`suggestion-${idx}`}
              style={styles.item}
              role="option"
              onMouseDown={() => handleSelect(term)}
              onMouseEnter={(e) => { e.target.style.backgroundColor = '#f3f4f6'; }}
              onMouseLeave={(e) => { e.target.style.backgroundColor = 'transparent'; }}
            >
              {term}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

SearchBar.propTypes = {
  apiBase: PropTypes.string.isRequired,
  onSearch: PropTypes.func,
  placeholder: PropTypes.string,
};

export default SearchBar;
