const TMDB_KEY = "b175ef95d9831a20297ff0f1034c32fe";
const TMDB_BASE = "https://api.themoviedb.org/3";
const IMG_BASE = "https://image.tmdb.org/t/p";

/* ── Shelf (Linker) API ── */
const SHELF_API_BASE = "https://pieve-linker-e2a788104640.herokuapp.com";
const SHELF_API_KEY = "bH3KqE-TQIzFOc6jHFM3XghkdwB_G5j5QQIc1njsKTo";

/* ── Country code → flag emoji ── */
function countryFlag(code) {
  return [...code.toUpperCase()].map(c => String.fromCodePoint(0x1F1E6 + c.charCodeAt(0) - 65)).join('');
}

const countryNames = new Intl.DisplayNames(['en'], { type: 'region' });
function countryName(code) {
  try { return countryNames.of(code.toUpperCase()); } catch { return code; }
}

/* ── TMDB genre map (movie + tv combined) ── */
const GENRE_MAP = {
  28:'Action',12:'Adventure',16:'Animation',35:'Comedy',80:'Crime',
  99:'Documentary',18:'Drama',10751:'Family',14:'Fantasy',36:'History',
  27:'Horror',10402:'Music',9648:'Mystery',10749:'Romance',878:'Sci-Fi',
  10770:'TV Movie',53:'Thriller',10752:'War',37:'Western',
  10759:'Action & Adventure',10762:'Kids',10763:'News',10764:'Reality',
  10765:'Sci-Fi & Fantasy',10766:'Soap',10767:'Talk',10768:'War & Politics'
};

/* ── TMDB API helper ── */
async function tmdb(path, params = {}) {
  params.api_key = TMDB_KEY;
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${TMDB_BASE}${path}?${qs}`);
  if (!res.ok) throw new Error(`TMDB ${res.status}`);
  return res.json();
}

/* ── State ── */
let state = {
  query: '',
  mediaType: 'multi',   // multi | movie | tv
  results: [],
  page: 1,
  totalPages: 0,
  loading: false,
  detailLoading: false,  // guard: prevents re-triggering loadDetail
  detail: null,          // full detail object when viewing
  providers: null,       // streaming providers for detail
  providersLoading: false,
};

/* ── Toast ── */
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2500);
}

/* ── Routing ── */
function getRoute() {
  const hash = location.hash || '#/';
  if (hash === '#/') return { screen: 'home' };
  const m = hash.match(/^#\/(movie|tv)\/(\d+)$/);
  if (m) return { screen: 'detail', mediaType: m[1], id: m[2] };
  return { screen: 'home' };
}

window.addEventListener('hashchange', () => render());
window.addEventListener('popstate', () => render());

/* ── Search ── */
async function doSearch(page = 1) {
  const q = state.query.trim();
  if (!q) return;
  state.loading = true;
  state.page = page;
  render();
  try {
    let results, totalPages;
    if (state.mediaType === 'multi') {
      // Search movies and TV in parallel for better results than /search/multi
      const [movies, tv] = await Promise.all([
        tmdb('/search/movie', { query: q, page, include_adult: false }),
        tmdb('/search/tv', { query: q, page, include_adult: false }),
      ]);
      const movieResults = (movies.results || []).map(r => ({ ...r, media_type: 'movie' }));
      const tvResults = (tv.results || []).map(r => ({ ...r, media_type: 'tv' }));
      // Merge and sort by popularity
      results = [...movieResults, ...tvResults].sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
      totalPages = Math.max(movies.total_pages || 1, tv.total_pages || 1);
    } else {
      const data = await tmdb(`/search/${state.mediaType}`, { query: q, page, include_adult: false });
      results = (data.results || []).map(r => ({ ...r, media_type: state.mediaType }));
      totalPages = data.total_pages || 1;
    }
    state.results = results;
    state.totalPages = Math.min(totalPages, 500);
  } catch (e) {
    toast('Search failed');
    console.error(e);
  }
  state.loading = false;
  render();
}

/* ── Load trending ── */
async function loadTrending() {
  state.loading = true;
  render();
  try {
    const data = await tmdb('/trending/all/week');
    state.results = (data.results || []).filter(r => r.media_type === 'movie' || r.media_type === 'tv');
    state.totalPages = 1;
    state.page = 1;
    state.query = '';
  } catch (e) {
    console.error(e);
  }
  state.loading = false;
  render();
}

/* ── Load detail ── */
async function loadDetail(mediaType, id) {
  state.detailLoading = true;
  state.detail = null;
  state.providers = null;
  state.providersLoading = true;
  render();
  try {
    // Load detail info first so we can show it immediately
    const detail = await tmdb(`/${mediaType}/${id}`);
    detail.media_type = mediaType;
    state.detail = detail;
    render();
    // Then load providers in the background
    const provData = await tmdb(`/${mediaType}/${id}/watch/providers`);
    state.providers = aggregateProviders(provData.results || {});
  } catch (e) {
    if (!state.detail) toast('Failed to load details');
    console.error(e);
  }
  state.providersLoading = false;
  state.detailLoading = false;
  render();
}

function aggregateProviders(allCountries) {
  const providers = {};
  for (const [cc, data] of Object.entries(allCountries)) {
    if (cc === 'link') continue;
    for (const p of (data.flatrate || [])) {
      const pid = p.provider_id;
      if (!providers[pid]) {
        providers[pid] = {
          name: p.provider_name,
          logo_url: p.logo_path ? `${IMG_BASE}/w92${p.logo_path}` : null,
          countries: [],
        };
      }
      providers[pid].countries.push(cc);
    }
  }
  const result = Object.values(providers).sort((a, b) => b.countries.length - a.countries.length || a.name.localeCompare(b.name));
  result.forEach(p => p.countries.sort());
  return result;
}

/* ── Add to Shelf ── */
async function addToShelf() {
  const d = state.detail;
  if (!d) return;
  const tmdbUrl = `https://www.themoviedb.org/${d.media_type}/${d.id}`;
  try {
    const res = await fetch(`${SHELF_API_BASE}/api/links`, {
      method: 'POST',
      headers: { 'X-API-Key': SHELF_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: tmdbUrl }),
    });
    if (!res.ok) throw new Error(`API ${res.status}`);
    toast('Added to Shelf!');
  } catch (e) {
    toast('Failed to add to Shelf');
    console.error(e);
  }
}

/* ── Render ── */
function render() {
  const route = getRoute();
  const app = document.getElementById('app');

  if (route.screen === 'detail') {
    const needsLoad = !state.detailLoading &&
      (!state.detail || String(state.detail.id) !== route.id || state.detail.media_type !== route.mediaType);
    if (needsLoad) {
      loadDetail(route.mediaType, route.id);
    }
    app.innerHTML = renderDetail();
    bindDetail();
    return;
  }

  // Home / search screen
  if (state.results.length === 0 && !state.loading && !state.query) {
    loadTrending();
    return;
  }
  app.innerHTML = renderHome();
  bindHome();
}

/* ── Home screen ── */
function renderHome() {
  const isSearch = state.query.trim().length > 0;
  return `
    <div class="header">
      <div>
        <h1>Scout</h1>
        <div class="header-subtitle">Movies & TV</div>
      </div>
    </div>

    <div class="search-section">
      <div class="search-bar">
        <input class="search-input" type="text" placeholder="Search movies & TV shows..."
               value="${esc(state.query)}" id="searchInput" autocomplete="off">
        <button class="search-btn" id="searchBtn" aria-label="Search">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
        </button>
      </div>
    </div>

    <div class="toggle-bar">
      <button class="toggle-btn ${state.mediaType==='multi'?'active':''}" data-type="multi">All</button>
      <button class="toggle-btn ${state.mediaType==='movie'?'active':''}" data-type="movie">Movies</button>
      <button class="toggle-btn ${state.mediaType==='tv'?'active':''}" data-type="tv">TV Shows</button>
    </div>

    ${state.loading ? `
      <div class="loading">
        <div class="spinner"></div>
        <span>Searching...</span>
      </div>
    ` : state.results.length === 0 ? `
      <div class="empty-state">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
          <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        <p>No results found.<br>Try a different search term.</p>
      </div>
    ` : `
      ${!isSearch ? '<div class="trending-label">Trending this week</div>' : ''}
      <div class="results-grid">
        ${state.results.map(r => renderCard(r)).join('')}
      </div>
      ${isSearch && state.totalPages > 1 ? renderPagination() : ''}
    `}
  `;
}

function renderCard(r) {
  const title = r.title || r.name || 'Untitled';
  const year = (r.release_date || r.first_air_date || '').slice(0, 4);
  const poster = r.poster_path ? `${IMG_BASE}/w342${r.poster_path}` : '';
  const rating = r.vote_average ? r.vote_average.toFixed(1) : '';
  const type = r.media_type === 'movie' ? 'Movie' : 'TV';

  return `
    <div class="result-card" data-type="${r.media_type}" data-id="${r.id}">
      <div class="poster-frame">
        ${poster ? `<img src="${poster}" alt="${esc(title)}" loading="lazy" onerror="this.parentElement.innerHTML='<div class=poster-fallback><svg width=40 height=40 viewBox=&quot;0 0 24 24&quot; fill=none stroke=currentColor stroke-width=1.5><rect x=2 y=2 width=20 height=20 rx=2/><path d=&quot;M7 2v20M17 2v20M2 12h20&quot;/></svg></div>'">` : `
          <div class="poster-fallback">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <rect x="2" y="2" width="20" height="20" rx="2"/><path d="M7 2v20M17 2v20M2 12h20"/>
            </svg>
          </div>
        `}
        <span class="badge-type">${type}</span>
        ${rating ? `<span class="badge-rating">\u2605 ${rating}</span>` : ''}
      </div>
      <div class="result-title">${esc(title)}</div>
      ${year ? `<div class="result-year">${year}</div>` : ''}
    </div>
  `;
}

function renderPagination() {
  const p = state.page;
  const total = state.totalPages;
  let pages = [];
  if (total <= 5) {
    for (let i = 1; i <= total; i++) pages.push(i);
  } else {
    pages = [1];
    let start = Math.max(2, p - 1);
    let end = Math.min(total - 1, p + 1);
    if (start > 2) pages.push('...');
    for (let i = start; i <= end; i++) pages.push(i);
    if (end < total - 1) pages.push('...');
    pages.push(total);
  }
  return `
    <div class="pagination">
      ${p > 1 ? `<button class="page-btn" data-page="${p-1}">&laquo;</button>` : ''}
      ${pages.map(pg => pg === '...'
        ? `<span class="page-info">...</span>`
        : `<button class="page-btn ${pg===p?'active':''}" data-page="${pg}">${pg}</button>`
      ).join('')}
      ${p < total ? `<button class="page-btn" data-page="${p+1}">&raquo;</button>` : ''}
    </div>
  `;
}

/* ── Detail screen ── */
function renderDetail() {
  if (!state.detail) {
    return `
      <div class="detail-header">
        <button class="back-btn" id="backBtn" aria-label="Back">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M15 18l-6-6 6-6"/></svg>
        </button>
      </div>
      <div class="loading"><div class="spinner"></div><span>Loading...</span></div>
    `;
  }

  const d = state.detail;
  const title = d.title || d.name || 'Untitled';
  const year = (d.release_date || d.first_air_date || '').slice(0, 4);
  const type = d.media_type === 'movie' ? 'Movie' : 'TV Show';
  const rating = d.vote_average ? d.vote_average.toFixed(1) : '';
  const poster = d.poster_path ? `${IMG_BASE}/w500${d.poster_path}` : '';
  const backdrop = d.backdrop_path ? `${IMG_BASE}/w780${d.backdrop_path}` : '';
  const genres = (d.genres || []).map(g => g.name);
  const overview = d.overview || '';
  const runtime = d.runtime ? `${d.runtime} min` : '';
  const seasons = d.number_of_seasons ? `${d.number_of_seasons} season${d.number_of_seasons > 1 ? 's' : ''}` : '';

  return `
    <div class="detail-screen${backdrop ? '' : ' detail-no-hero'}">
      <div class="detail-header">
        <button class="back-btn" id="backBtn" aria-label="Back">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M15 18l-6-6 6-6"/></svg>
        </button>
      </div>

      ${backdrop ? `
        <div class="detail-hero">
          <img src="${backdrop}" alt="">
          <div class="detail-hero-gradient"></div>
        </div>
      ` : ''}

      <div class="detail-body">
        <div class="detail-poster-row">
          ${poster ? `
            <div class="detail-poster">
              <img src="${poster}" alt="${esc(title)}">
            </div>
          ` : ''}
          <div class="detail-info">
            <h2 class="detail-title">${esc(title)}</h2>
            <div class="detail-meta">
              <span class="meta-tag">${type}</span>
              ${year ? `<span class="meta-tag">${year}</span>` : ''}
              ${runtime ? `<span class="meta-tag">${runtime}</span>` : ''}
              ${seasons ? `<span class="meta-tag">${seasons}</span>` : ''}
            </div>
            ${rating ? `<div class="detail-rating">\u2605 ${rating} <span>/ 10</span></div>` : ''}
          </div>
        </div>

        <button class="btn btn-accent add-shelf-btn" id="addShelfBtn">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <path d="M12 5v14M5 12h14"/>
          </svg>
          Add to Shelf
        </button>

        ${genres.length ? `
          <div class="genre-tags">
            ${genres.map(g => `<span class="genre-tag">${esc(g)}</span>`).join('')}
          </div>
        ` : ''}

        ${overview ? `
          <div class="section">
            <h3 class="section-title">Overview</h3>
            <p class="overview-text">${esc(overview)}</p>
          </div>
        ` : ''}

        <div class="section">
          <h3 class="section-title">Where to Watch</h3>
          ${renderProviders()}
        </div>
      </div>
    </div>
  `;
}

function renderProviders() {
  if (state.providersLoading) {
    return '<div class="loading"><div class="spinner"></div><span>Loading availability...</span></div>';
  }
  const providers = state.providers;
  if (!providers || providers.length === 0) {
    return '<p class="no-providers">No streaming availability found.</p>';
  }
  return `
    <div class="providers-list">
      ${providers.map((p, i) => `
        <div class="provider-chip" data-idx="${i}">
          ${p.logo_url ? `<img class="provider-logo" src="${p.logo_url}" alt="${esc(p.name)}" loading="lazy">` : ''}
          <span class="provider-name">${esc(p.name)}</span>
          <span class="provider-count">${p.countries.length} ${p.countries.length === 1 ? 'country' : 'countries'}</span>
          <div class="provider-countries">
            ${p.countries.map(cc => `<span class="country-flag" title="${esc(countryName(cc))}">${countryFlag(cc)}</span>`).join('')}
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

/* ── Bind events ── */
function bindHome() {
  const input = document.getElementById('searchInput');
  const btn = document.getElementById('searchBtn');

  if (input) {
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') { state.query = input.value; doSearch(); }
    });
    // focus input if empty results and not loading
    if (!state.loading && state.results.length === 0 && state.query) {
      input.focus();
    }
  }
  if (btn) {
    btn.addEventListener('click', () => { state.query = input.value; doSearch(); });
  }

  // toggle buttons
  document.querySelectorAll('.toggle-btn').forEach(b => {
    b.addEventListener('click', () => {
      state.mediaType = b.dataset.type;
      if (state.query.trim()) doSearch();
      else { render(); }
    });
  });

  // result cards
  document.querySelectorAll('.result-card').forEach(card => {
    card.addEventListener('click', () => {
      const type = card.dataset.type;
      const id = card.dataset.id;
      location.hash = `#/${type}/${id}`;
    });
  });

  // pagination
  document.querySelectorAll('.page-btn[data-page]').forEach(b => {
    b.addEventListener('click', () => doSearch(Number(b.dataset.page)));
  });
}

function bindDetail() {
  const back = document.getElementById('backBtn');
  if (back) {
    back.addEventListener('click', () => {
      history.back();
    });
  }

  // add to shelf
  const addBtn = document.getElementById('addShelfBtn');
  if (addBtn) {
    addBtn.addEventListener('click', () => addToShelf());
  }

  // provider expand/collapse
  document.querySelectorAll('.provider-chip').forEach(chip => {
    chip.addEventListener('click', (e) => {
      if (e.target.closest('.country-flag')) return;
      chip.classList.toggle('expanded');
    });
  });
}

/* ── Helpers ── */
function esc(s) {
  if (!s) return '';
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

/* ── Service Worker ── */
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').then(reg => {
    // Check for updates every 60s
    setInterval(() => reg.update(), 60000);
    reg.addEventListener('updatefound', () => {
      const sw = reg.installing;
      sw.addEventListener('statechange', () => {
        if (sw.state === 'installed' && navigator.serviceWorker.controller) {
          showUpdateBanner(reg);
        }
      });
    });
  });
}

function showUpdateBanner(reg) {
  const banner = document.createElement('div');
  banner.className = 'update-banner';
  banner.textContent = 'Update available — tap to refresh';
  banner.addEventListener('click', () => {
    if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });
    location.reload();
  });
  document.body.appendChild(banner);
}

/* ── Init ── */
render();
