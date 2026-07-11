import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View,
  TextInput,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Modal,
  ScrollView,
  Keyboard,
  StatusBar,
  Dimensions,
  Platform,
  Image
} from 'react-native';
import PropTypes from 'prop-types';

// ─── Avatar Color Palette (WhatsApp-style) ────────────────────────────────
const AVATAR_COLORS = [
  '#E17076', '#7BC862', '#E5A645', '#65AADD', '#A695E7',
  '#EE7AAE', '#6EC9CB', '#FAA774', '#E47272', '#82C272',
  '#5FBED5', '#C49BDE', '#F4845F', '#7986CB', '#4DB6AC',
];

// Category icon map (emoji fallbacks — in the real app, replace with actual icons)
const CATEGORY_ICONS = {
  'cleaning': '🧹', 'beauty': '💄', 'repair': '🔧', 'photography': '📷',
  'tutoring': '📚', 'fitness': '💪', 'design': '🎨', 'writing': '✍️',
  'modeling': '🧊', 'translation': '🌐',
};

function getCategoryIcon(name) {
  if (!name) return '📂';
  const lower = name.toLowerCase();
  for (const [key, icon] of Object.entries(CATEGORY_ICONS)) {
    if (lower.includes(key)) return icon;
  }
  return '📂';
}

function getAvatarColor(str) {
  if (!str) return AVATAR_COLORS[0];
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
    hash = hash & hash;
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function getInitials(title) {
  if (!title) return '?';
  const words = title.trim().split(/\s+/).filter(w => w.length > 0);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].substring(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

function formatPrice(cents) {
  if (cents === null || cents === undefined) return '';
  const amount = Math.round(cents / 100);
  return '₹' + amount.toLocaleString('en-IN');
}

function getPricingLabel(type) {
  if (type === 'hourly') return 'Hourly Price';
  if (type === 'custom') return 'Project Price';
  return 'Fixed Price';
}

function getPricingTag(type) {
  if (type === 'hourly') return 'Hourly';
  if (type === 'custom') return 'Flexible';
  return 'Fixed';
}

// ─── InitialsAvatar ──────────────────────────────────────────────────────
function InitialsAvatar({ title, providerId, size = 100, borderRadius = 12 }) {
  const color = getAvatarColor(providerId || title);
  const initials = getInitials(title);
  return (
    <View style={[styles.avatar, { width: size, height: size, borderRadius, backgroundColor: color }]}>
      <Text style={[styles.avatarText, { fontSize: size * 0.35 }]}>{initials}</Text>
    </View>
  );
}

// ─── ServiceImage ────────────────────────────────────────────────────────
function ServiceImage({ images, title, providerId, size = 110 }) {
  const [imgError, setImgError] = useState(false);
  let imageUrl = null;
  if (images && typeof images === 'string') {
    try {
      const parsed = JSON.parse(images.replace(/'/g, '"'));
      if (Array.isArray(parsed) && parsed.length > 0 && parsed[0]) imageUrl = parsed[0];
    } catch {}
  }
  if (imageUrl && !imgError) {
    return (
      <Image
        source={{ uri: imageUrl }}
        style={[styles.serviceImage, { width: size, height: size, borderRadius: 12 }]}
        resizeMode="cover"
        onError={() => setImgError(true)}
      />
    );
  }
  return <InitialsAvatar title={title} providerId={providerId} size={size} />;
}

// ─── ResultCard ──────────────────────────────────────────────────────────
function ResultCard({ result }) {
  const price = formatPrice(result.base_price_cents);
  const pricingLabel = getPricingLabel(result.pricing_type);
  const tag = getPricingTag(result.pricing_type);
  const rating = result.rating ? Number(result.rating).toFixed(1) : '0.0';
  const ratingColor = result.rating && result.rating >= 4.0 ? '#F5A623' : '#9ca3af';

  return (
    <View style={styles.resultCard}>
      <ServiceImage images={result.images} title={result.title} providerId={result.provider_id} size={110} />
      <View style={styles.resultInfo}>
        <Text style={styles.resultTitle} numberOfLines={1}>{result.title}</Text>
        <Text style={styles.providerName} numberOfLines={1}>by Service Provider</Text>
        <View style={styles.ratingRow}>
          <Text style={[styles.starIcon, { color: ratingColor }]}>★</Text>
          <Text style={styles.ratingNum}>{rating}</Text>
          <Text style={styles.dotSeparator}>•</Text>
          <Text style={styles.pricingTypeInline}>{tag}</Text>
        </View>
        {price ? (
          <View style={styles.priceBlock}>
            <Text style={styles.priceAmount}>{price}</Text>
            <Text style={styles.pricingLabel}>{pricingLabel}</Text>
          </View>
        ) : null}
        <View style={styles.tagBadge}>
          <Text style={styles.tagText}>{tag}</Text>
        </View>
      </View>
    </View>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// FILTER DRAWER COMPONENT
// ═══════════════════════════════════════════════════════════════════════════

const SORT_OPTIONS = [
  { key: 'popular', label: 'Most Popular' },
  { key: 'rated', label: 'Highest Rated' },
  { key: 'price_low', label: 'Price: Low to High' },
  { key: 'price_high', label: 'Price: High to Low' },
  { key: 'newest', label: 'Newest First' },
];

const PRICE_TYPES = [
  { key: 'fixed', label: 'Fixed Price' },
  { key: 'hourly', label: 'Hourly Rate' },
  { key: 'custom', label: 'Custom Quota' },
];

const RATING_OPTIONS = [
  { key: 4.5, label: '4.5+' },
  { key: 4.0, label: '4.0+' },
  { key: 3.5, label: '3.5+' },
  { key: 3.0, label: '3.0+' },
];

function FilterDrawer({ visible, onClose, onApply, filters, setFilters, categories }) {
  const activeCount = useMemo(() => {
    let n = 0;
    if (filters.sortBy !== 'popular') n++;
    if (filters.priceType) n++;
    if (filters.minRating) n++;
    if (filters.categoryId) n++;
    return n;
  }, [filters]);

  const clearAll = () => {
    setFilters({ sortBy: 'popular', priceType: null, minRating: null, categoryId: null });
  };

  // Derive unique categories from results (passed via categories prop)
  const categoryList = categories || [];

  return (
    <Modal visible={visible} transparent={true} animationType="none" onRequestClose={onClose}>
      <View style={styles.filterOverlay}>
        <TouchableOpacity style={styles.filterBackdrop} activeOpacity={1} onPress={onClose} />
        <View style={styles.filterDrawer}>
          {/* Header */}
          <View style={styles.filterHeader}>
            <TouchableOpacity onPress={clearAll} style={styles.clearAllBtn}>
              <Text style={styles.clearAllText}>Clear All</Text>
            </TouchableOpacity>
            <Text style={styles.filterTitle}>Filter & Categories</Text>
            <TouchableOpacity onPress={onClose} style={styles.filterCloseBtn}>
              <Text style={styles.filterCloseText}>✕</Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.filterBody} showsVerticalScrollIndicator={false}>
            {/* ── Sort By ── */}
            <Text style={styles.filterSectionTitle}>Sort By</Text>
            {SORT_OPTIONS.map(opt => (
              <TouchableOpacity
                key={opt.key}
                style={styles.radioRow}
                onPress={() => setFilters(f => ({ ...f, sortBy: opt.key }))}
                activeOpacity={0.7}
              >
                <View style={[styles.radioOuter, filters.sortBy === opt.key && styles.radioOuterActive]}>
                  {filters.sortBy === opt.key && <View style={styles.radioInner} />}
                </View>
                <Text style={styles.radioLabel}>{opt.label}</Text>
              </TouchableOpacity>
            ))}

            {/* ── Price Type ── */}
            <Text style={[styles.filterSectionTitle, { marginTop: 20 }]}>Price Type</Text>
            <View style={styles.chipsRow}>
              {PRICE_TYPES.map(pt => (
                <TouchableOpacity
                  key={pt.key}
                  style={[styles.chip, filters.priceType === pt.key && styles.chipActive]}
                  onPress={() => setFilters(f => ({ ...f, priceType: f.priceType === pt.key ? null : pt.key }))}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.chipText, filters.priceType === pt.key && styles.chipTextActive]}>{pt.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* ── Minimum Rating ── */}
            <Text style={[styles.filterSectionTitle, { marginTop: 20 }]}>Minimum Rating</Text>
            <View style={styles.chipsRow}>
              {RATING_OPTIONS.map(ro => (
                <TouchableOpacity
                  key={ro.key}
                  style={[styles.chip, filters.minRating === ro.key && styles.chipActive]}
                  onPress={() => setFilters(f => ({ ...f, minRating: f.minRating === ro.key ? null : ro.key }))}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.chipText, filters.minRating === ro.key && styles.chipTextActive]}>★ {ro.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* ── Browse Categories ── */}
            {categoryList.length > 0 && (
              <>
                <Text style={[styles.filterSectionTitle, { marginTop: 20 }]}>Browse Categories</Text>
                {categoryList.map(cat => (
                  <TouchableOpacity
                    key={cat.id}
                    style={[styles.categoryRow, filters.categoryId === cat.id && styles.categoryRowActive]}
                    onPress={() => setFilters(f => ({ ...f, categoryId: f.categoryId === cat.id ? null : cat.id }))}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.categoryIcon}>{getCategoryIcon(cat.name)}</Text>
                    <Text style={[styles.categoryName, filters.categoryId === cat.id && styles.categoryNameActive]}>{cat.name}</Text>
                    <Text style={styles.categoryChevron}>›</Text>
                  </TouchableOpacity>
                ))}
              </>
            )}

            <View style={{ height: 80 }} />
          </ScrollView>

          {/* Apply button */}
          <View style={styles.applyBtnWrap}>
            <TouchableOpacity style={styles.applyBtn} onPress={onApply} activeOpacity={0.8}>
              <Text style={styles.applyBtnText}>
                Apply Filters{activeCount > 0 ? ` (${activeCount})` : ''}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN SEARCH BAR COMPONENT
// ═══════════════════════════════════════════════════════════════════════════

function SearchBar({ apiBase, onSearch, placeholder = 'Search services...' }) {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [trending, setTrending] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);

  // Results state
  const [searchResults, setSearchResults] = useState([]);
  const [showResults, setShowResults] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [resultsQuery, setResultsQuery] = useState('');
  const [isHeaderOpen, setIsHeaderOpen] = useState(false);

  // Filter state
  const [showFilter, setShowFilter] = useState(false);
  const [filters, setFilters] = useState({ sortBy: 'popular', priceType: null, minRating: null, categoryId: null });
  const [allCategories, setAllCategories] = useState([]);

  const debounceTimer = useRef(null);

  // ── Fetch trending + categories on mount ──
  useEffect(() => {
    async function fetchInit() {
      try {
        const [tRes, cRes] = await Promise.all([
          fetch(`${apiBase}/api/search/trending`),
          fetch(`${apiBase}/api/search/categories`),
        ]);
        const tData = await tRes.json();
        const cData = await cRes.json();
        if (tData.trending && Array.isArray(tData.trending)) setTrending(tData.trending);
        if (cData.categories && Array.isArray(cData.categories)) setAllCategories(cData.categories);
      } catch (err) {
        console.error('[SearchBar] Init fetch failed:', err.message);
      }
    }
    fetchInit();
  }, [apiBase]);

  // ── Apply filters + sorting (client-side) ──
  const filteredResults = useMemo(() => {
    let list = [...searchResults];

    // Price type filter
    if (filters.priceType) {
      list = list.filter(r => r.pricing_type === filters.priceType);
    }

    // Min rating filter
    if (filters.minRating) {
      list = list.filter(r => r.rating && Number(r.rating) >= filters.minRating);
    }

    // Category filter
    if (filters.categoryId) {
      list = list.filter(r => r.category_id === filters.categoryId);
    }

    // Sorting
    switch (filters.sortBy) {
      case 'rated':
        list.sort((a, b) => (Number(b.rating) || 0) - (Number(a.rating) || 0));
        break;
      case 'price_low':
        list.sort((a, b) => (a.base_price_cents || 0) - (b.base_price_cents || 0));
        break;
      case 'price_high':
        list.sort((a, b) => (b.base_price_cents || 0) - (a.base_price_cents || 0));
        break;
      case 'newest':
        list.sort((a, b) => {
          const da = a.created_at ? new Date(a.created_at).getTime() : 0;
          const db2 = b.created_at ? new Date(b.created_at).getTime() : 0;
          return db2 - da;
        });
        break;
      default: // popular
        list.sort((a, b) => (b.total_bookings || 0) - (a.total_bookings || 0));
        break;
    }

    return list;
  }, [searchResults, filters]);

  // ── Derive categories present in results ──
  const resultCategories = useMemo(() => {
    const catIds = new Set(searchResults.map(r => r.category_id));
    return allCategories.filter(c => catIds.has(c.id));
  }, [searchResults, allCategories]);

  // ── Autocomplete ──
  const fetchSuggestions = useCallback(async (q) => {
    if (!q || q.trim().length === 0) { setSuggestions([]); setIsLoading(false); return; }
    setIsLoading(true);
    try {
      const res = await fetch(`${apiBase}/api/search/suggestions?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      setSuggestions(data.suggestions && Array.isArray(data.suggestions) ? data.suggestions : []);
    } catch { setSuggestions([]); }
    finally { setIsLoading(false); }
  }, [apiBase]);

  // ── Full search ──
  const doFinalSearch = async (term) => {
    if (!term || term.trim().length === 0) return;
    setIsSearching(true);
    setShowResults(true);
    setResultsQuery(term);
    Keyboard.dismiss();

    try {
      await fetch(`${apiBase}/api/search/record`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: term })
      });
      const tRes = await fetch(`${apiBase}/api/search/trending`);
      const tData = await tRes.json();
      if (tData.trending) setTrending(tData.trending);
    } catch {}

    try {
      const res = await fetch(`${apiBase}/api/search/results?q=${encodeURIComponent(term)}`);
      const data = await res.json();
      setSearchResults(data.results && Array.isArray(data.results) ? data.results : []);
    } catch { setSearchResults([]); }
    finally { setIsSearching(false); }
  };

  const closeResults = () => { setShowResults(false); setShowFilter(false); };

  // ── Input handlers ──
  const handleChange = (value) => {
    setQuery(value);
    setIsOpen(true);
    setShowResults(false);
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    if (!value || value.trim().length === 0) { setSuggestions([]); setIsLoading(false); return; }
    setIsLoading(true);
    debounceTimer.current = setTimeout(() => fetchSuggestions(value), 300);
  };

  const handleFocus = () => { if (!showResults) setIsOpen(true); };
  const handleBlur = () => { setTimeout(() => setIsOpen(false), 200); };

  const handleSelect = (term) => {
    setQuery(term); setSuggestions([]); setIsOpen(false);
    doFinalSearch(term);
    if (onSearch) onSearch(term);
  };

  const handleSubmit = () => {
    setSuggestions([]); setIsOpen(false);
    doFinalSearch(query);
    if (onSearch) onSearch(query);
  };

  const handleResultsSearch = () => { setIsHeaderOpen(false); doFinalSearch(resultsQuery); };
  const clearResultsQuery = () => { setResultsQuery(''); setIsHeaderOpen(false); };

  const handleHeaderChange = (value) => {
    setResultsQuery(value);
    setIsHeaderOpen(true);
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    if (!value || value.trim().length === 0) { setSuggestions([]); setIsLoading(false); return; }
    setIsLoading(true);
    debounceTimer.current = setTimeout(() => fetchSuggestions(value), 300);
  };

  const handleHeaderSelect = (term) => {
    setResultsQuery(term); setSuggestions([]); setIsHeaderOpen(false);
    doFinalSearch(term);
  };

  useEffect(() => { return () => { if (debounceTimer.current) clearTimeout(debounceTimer.current); }; }, []);

  const showTrending = isOpen && query.trim().length === 0 && trending.length > 0;
  const showSuggestions = isOpen && query.trim().length > 0 && (suggestions.length > 0 || isLoading);

  const showHeaderTrending = isHeaderOpen && resultsQuery.trim().length === 0 && trending.length > 0;
  const showHeaderSuggestions = isHeaderOpen && resultsQuery.trim().length > 0 && (suggestions.length > 0 || isLoading);

  return (
    <View style={styles.container}>
      {/* ── Search Input ── */}
      <TextInput
        style={styles.input}
        value={query}
        onChangeText={handleChange}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onSubmitEditing={handleSubmit}
        placeholder={placeholder}
        placeholderTextColor="#9ca3af"
        autoCorrect={false}
        returnKeyType="search"
      />

      {/* ── Dropdown ── */}
      {(showTrending || showSuggestions) && (
        <View style={styles.dropdown}>
          {showTrending && (
            <>
              <Text style={styles.sectionLabel}>Trending</Text>
              {trending.map((term, idx) => (
                <TouchableOpacity key={`t-${idx}`} style={styles.item} onPress={() => handleSelect(term)} activeOpacity={0.7}>
                  <Text style={styles.itemText}>{term}</Text>
                </TouchableOpacity>
              ))}
            </>
          )}
          {showSuggestions && (
            <>
              {isLoading && suggestions.length === 0 && <Text style={styles.loadingText}>Searching...</Text>}
              {suggestions.map((term, idx) => (
                <TouchableOpacity key={`s-${idx}`} style={styles.item} onPress={() => handleSelect(term)} activeOpacity={0.7}>
                  <Text style={styles.itemText}>{term}</Text>
                </TouchableOpacity>
              ))}
            </>
          )}
        </View>
      )}

      {/* ════════════════════════════════════════════════════════════════════
           FULL-SCREEN SEARCH RESULTS
           ════════════════════════════════════════════════════════════════════ */}
      <Modal visible={showResults} transparent={false} animationType="slide" statusBarTranslucent={true} onRequestClose={closeResults}>
        <View style={styles.resultsScreen}>
          <StatusBar barStyle="light-content" backgroundColor="#0d9488" />

          {/* ── Teal Header ── */}
          <View style={styles.tealHeader}>
            <View style={styles.statusBarSpacer} />
            <View style={styles.headerTopRow}>
              <TouchableOpacity onPress={closeResults} activeOpacity={0.7} style={styles.headerIconBtn}>
                <Text style={styles.headerIcon}>←</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setShowFilter(true)} activeOpacity={0.7} style={styles.headerIconBtn}>
                <Text style={styles.headerIcon}>☰</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.headerSearchRow}>
              <View style={styles.headerSearchBar}>
                <Text style={styles.searchBarIcon}>🔍</Text>
                <TextInput
                  style={styles.headerSearchInput}
                  value={resultsQuery}
                  onChangeText={handleHeaderChange}
                  onFocus={() => setIsHeaderOpen(true)}
                  onBlur={() => setTimeout(() => setIsHeaderOpen(false), 200)}
                  onSubmitEditing={handleResultsSearch}
                  placeholder="Search..."
                  placeholderTextColor="#9ca3af"
                  returnKeyType="search"
                />
                {resultsQuery.length > 0 && (
                  <TouchableOpacity onPress={clearResultsQuery} activeOpacity={0.7}>
                    <Text style={styles.clearIcon}>✕</Text>
                  </TouchableOpacity>
                )}
              </View>
              <TouchableOpacity onPress={handleResultsSearch} activeOpacity={0.7} style={styles.searchArrowBtn}>
                <Text style={styles.searchArrow}>→</Text>
              </TouchableOpacity>
              
              {/* ── Header Dropdown ── */}
              {(showHeaderTrending || showHeaderSuggestions) && (
                <View style={styles.headerDropdown}>
                  {showHeaderTrending && (
                    <>
                      <Text style={styles.sectionLabel}>Trending</Text>
                      {trending.map((term, idx) => (
                        <TouchableOpacity key={`ht-${idx}`} style={styles.item} onPress={() => handleHeaderSelect(term)} activeOpacity={0.7}>
                          <Text style={styles.itemText}>{term}</Text>
                        </TouchableOpacity>
                      ))}
                    </>
                  )}
                  {showHeaderSuggestions && (
                    <>
                      {isLoading && suggestions.length === 0 && <Text style={styles.loadingText}>Searching...</Text>}
                      {suggestions.map((term, idx) => (
                        <TouchableOpacity key={`hs-${idx}`} style={styles.item} onPress={() => handleHeaderSelect(term)} activeOpacity={0.7}>
                          <Text style={styles.itemText}>{term}</Text>
                        </TouchableOpacity>
                      ))}
                    </>
                  )}
                </View>
              )}
            </View>
            <Text style={styles.heroTitle}>Search Bustles</Text>
            <Text style={styles.heroSubtitle}>Find the perfect bustle for your needs</Text>
          </View>

          {/* ── Results Body ── */}
          <View style={styles.resultsBody}>
            {isSearching ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color="#0d9488" />
                <Text style={styles.loadingLabel}>Finding the best services...</Text>
              </View>
            ) : (
              <>
                <Text style={styles.resultCount}>
                  {filteredResults.length} bustle{filteredResults.length !== 1 ? 's' : ''} found
                </Text>
                {filteredResults.length === 0 ? (
                  <View style={styles.emptyContainer}>
                    <Text style={styles.emptyIcon}>🔍</Text>
                    <Text style={styles.emptyTitle}>No bustles found</Text>
                    <Text style={styles.emptySubtitle}>Try a different search term or adjust filters</Text>
                  </View>
                ) : (
                  <ScrollView style={styles.resultsList} contentContainerStyle={styles.resultsListContent} showsVerticalScrollIndicator={false}>
                    {filteredResults.map(res => <ResultCard key={res.id} result={res} />)}
                  </ScrollView>
                )}
              </>
            )}
          </View>
        </View>

        {/* ── Filter Drawer ── */}
        <FilterDrawer
          visible={showFilter}
          onClose={() => setShowFilter(false)}
          onApply={() => setShowFilter(false)}
          filters={filters}
          setFilters={setFilters}
          categories={resultCategories}
        />
      </Modal>
    </View>
  );
}

SearchBar.propTypes = {
  apiBase: PropTypes.string.isRequired,
  onSearch: PropTypes.func,
  placeholder: PropTypes.string,
};

// ═══════════════════════════════════════════════════════════════════════════
// STYLES
// ═══════════════════════════════════════════════════════════════════════════

const styles = StyleSheet.create({
  // ── Search Input ──
  container: { width: '100%', zIndex: 1 },
  input: {
    width: '100%', paddingVertical: 12, paddingHorizontal: 14,
    fontSize: 16, borderWidth: 1, borderColor: '#d1d5db',
    borderRadius: 8, backgroundColor: '#fff', color: '#111827',
  },

  // ── Dropdown ──
  dropdown: {
    marginTop: 4, backgroundColor: '#ffffff',
    borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 8,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1, shadowRadius: 12, elevation: 4,
    position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 1000,
  },
  sectionLabel: {
    paddingTop: 10, paddingHorizontal: 14, paddingBottom: 4,
    fontSize: 11, fontWeight: '600', color: '#9ca3af',
    textTransform: 'uppercase', letterSpacing: 0.5,
  },
  item: { paddingVertical: 12, paddingHorizontal: 14 },
  itemText: { fontSize: 15, color: '#374151' },
  loadingText: { paddingVertical: 12, paddingHorizontal: 14, fontSize: 14, color: '#9ca3af', fontStyle: 'italic' },

  // ── Full-Screen Results ──
  resultsScreen: { flex: 1, backgroundColor: '#f5f5f5' },
  tealHeader: { backgroundColor: '#0d9488', paddingBottom: 20, borderBottomLeftRadius: 20, borderBottomRightRadius: 20 },
  statusBarSpacer: { height: Platform.OS === 'ios' ? 50 : StatusBar.currentHeight || 24 },
  headerTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 12 },
  headerIconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerIcon: { fontSize: 24, color: '#ffffff' },
  headerSearchRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, marginBottom: 16, zIndex: 10 },
  headerSearchBar: {
    flex: 1, flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#ffffff', borderRadius: 25,
    paddingHorizontal: 14, paddingVertical: Platform.OS === 'ios' ? 12 : 6, marginRight: 10,
  },
  searchBarIcon: { fontSize: 16, marginRight: 8, color: '#9ca3af' },
  headerSearchInput: { flex: 1, fontSize: 16, color: '#111827', padding: 0 },
  clearIcon: { fontSize: 16, color: '#9ca3af', padding: 4 },
  searchArrowBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  searchArrow: { fontSize: 24, color: '#ffffff', fontWeight: '700' },
  headerDropdown: {
    backgroundColor: '#ffffff',
    borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 8,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1, shadowRadius: 12, elevation: 4,
    position: 'absolute', top: '100%', left: 16, right: 66, zIndex: 1000,
    marginTop: -10,
  },
  heroTitle: { fontSize: 28, fontWeight: '800', color: '#ffffff', paddingHorizontal: 20, marginBottom: 4 },
  heroSubtitle: { fontSize: 15, color: 'rgba(255,255,255,0.8)', paddingHorizontal: 20 },

  resultsBody: { flex: 1, paddingTop: 4 },
  resultCount: { fontSize: 16, fontWeight: '600', color: '#374151', paddingHorizontal: 20, paddingVertical: 14 },
  loadingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: 60 },
  loadingLabel: { marginTop: 14, fontSize: 15, color: '#6b7280' },
  emptyContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: 60 },
  emptyIcon: { fontSize: 48, marginBottom: 14 },
  emptyTitle: { fontSize: 20, fontWeight: '600', color: '#374151', marginBottom: 6 },
  emptySubtitle: { fontSize: 15, color: '#6b7280' },
  resultsList: { flex: 1 },
  resultsListContent: { paddingHorizontal: 16, paddingBottom: 32 },

  // ── Result Card ──
  resultCard: {
    flexDirection: 'row', backgroundColor: '#ffffff', borderRadius: 14,
    padding: 12, marginBottom: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06, shadowRadius: 8, elevation: 2,
  },
  serviceImage: { backgroundColor: '#e5e7eb' },
  avatar: { alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#ffffff', fontWeight: '700', letterSpacing: 0.5 },
  resultInfo: { flex: 1, marginLeft: 12, justifyContent: 'center' },
  resultTitle: { fontSize: 17, fontWeight: '700', color: '#111827', marginBottom: 2 },
  providerName: { fontSize: 14, color: '#6b7280', marginBottom: 4 },
  ratingRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  starIcon: { fontSize: 16, marginRight: 3 },
  ratingNum: { fontSize: 14, fontWeight: '600', color: '#374151', marginRight: 6 },
  dotSeparator: { fontSize: 14, color: '#d1d5db', marginRight: 6 },
  pricingTypeInline: { fontSize: 13, color: '#6b7280' },
  priceBlock: { marginBottom: 6 },
  priceAmount: { fontSize: 20, fontWeight: '800', color: '#111827' },
  pricingLabel: { fontSize: 12, color: '#6b7280', marginTop: 1 },
  tagBadge: {
    alignSelf: 'flex-start', backgroundColor: '#f0f0f0',
    borderRadius: 14, paddingHorizontal: 12, paddingVertical: 4,
    borderWidth: 1, borderColor: '#e0e0e0',
  },
  tagText: { fontSize: 12, color: '#555', fontWeight: '500' },

  // ═══════════════════════════════════════════════════════════
  // FILTER DRAWER STYLES
  // ═══════════════════════════════════════════════════════════
  filterOverlay: {
    flex: 1, flexDirection: 'row',
  },
  filterBackdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.4)',
  },
  filterDrawer: {
    width: Dimensions.get('window').width * 0.78,
    backgroundColor: '#ffffff',
    shadowColor: '#000', shadowOffset: { width: -4, height: 0 },
    shadowOpacity: 0.15, shadowRadius: 20, elevation: 10,
  },
  filterHeader: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingTop: Platform.OS === 'ios' ? 56 : (StatusBar.currentHeight || 24) + 12,
    paddingBottom: 14,
    borderBottomWidth: 1, borderBottomColor: '#f0f0f0',
  },
  clearAllBtn: {
    backgroundColor: '#0d9488', borderRadius: 16,
    paddingHorizontal: 14, paddingVertical: 6,
  },
  clearAllText: { color: '#ffffff', fontSize: 13, fontWeight: '600' },
  filterTitle: { flex: 1, fontSize: 17, fontWeight: '700', color: '#111827', textAlign: 'center' },
  filterCloseBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  filterCloseText: { fontSize: 20, color: '#374151' },

  filterBody: { flex: 1, paddingHorizontal: 16, paddingTop: 16 },

  filterSectionTitle: { fontSize: 17, fontWeight: '700', color: '#111827', marginBottom: 12 },

  // ── Radio buttons ──
  radioRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  radioOuter: {
    width: 24, height: 24, borderRadius: 12,
    borderWidth: 2, borderColor: '#d1d5db',
    alignItems: 'center', justifyContent: 'center', marginRight: 12,
  },
  radioOuterActive: { borderColor: '#0d9488', backgroundColor: '#0d9488' },
  radioInner: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#ffffff' },
  radioLabel: { fontSize: 16, color: '#374151' },

  // ── Chips ──
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    borderWidth: 1, borderColor: '#d1d5db', borderRadius: 20,
    paddingHorizontal: 16, paddingVertical: 8, backgroundColor: '#ffffff',
  },
  chipActive: { backgroundColor: '#0d9488', borderColor: '#0d9488' },
  chipText: { fontSize: 14, color: '#374151', fontWeight: '500' },
  chipTextActive: { color: '#ffffff' },

  // ── Category rows ──
  categoryRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 14, paddingHorizontal: 14,
    borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 12,
    marginBottom: 8, backgroundColor: '#ffffff',
  },
  categoryRowActive: { backgroundColor: '#e6faf8', borderColor: '#0d9488' },
  categoryIcon: { fontSize: 20, marginRight: 12 },
  categoryName: { flex: 1, fontSize: 15, fontWeight: '500', color: '#374151' },
  categoryNameActive: { color: '#0d9488', fontWeight: '600' },
  categoryChevron: { fontSize: 22, color: '#9ca3af', fontWeight: '300' },

  // ── Apply button ──
  applyBtnWrap: {
    paddingHorizontal: 16, paddingVertical: 12,
    borderTopWidth: 1, borderTopColor: '#f0f0f0',
    paddingBottom: Platform.OS === 'ios' ? 30 : 12,
  },
  applyBtn: {
    backgroundColor: '#0d9488', borderRadius: 25,
    paddingVertical: 16, alignItems: 'center',
  },
  applyBtnText: { color: '#ffffff', fontSize: 17, fontWeight: '700' },
});

export default SearchBar;
