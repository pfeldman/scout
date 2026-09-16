const TMDB_KEY = "b175ef95d9831a20297ff0f1034c32fe";
const TMDB_BASE = "https://api.themoviedb.org/3";
const IMG_BASE = "https://image.tmdb.org/t/p";

/* ── Theme: follows the system, can be pinned with ?theme=dark|light ── */
(function pinTheme() {
  const t = new URLSearchParams(location.search).get('theme');
  if (t === 'dark' || t === 'light') document.documentElement.dataset.theme = t;
})();

/* ── Country code → flag emoji ── */
function countryFlag(code) {
  return [...code.toUpperCase()].map(c => String.fromCodePoint(0x1F1E6 + c.charCodeAt(0) - 65)).join('');
}

const countryNames = new Intl.DisplayNames(['en'], { type: 'region' });
function countryName(code) {
  try { return countryNames.of(code.toUpperCase()); } catch { return code; }
}

const dateFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
function longDate(iso) {
  if (!iso) return '';
  const d = new Date(`${iso}T00:00:00Z`);
  return isNaN(d) ? iso : dateFmt.format(d);
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

/* ── Watchlist (localStorage) ── */
const WL_KEY = 'scout_watchlist';

function getWatchlist() {
  try { return JSON.parse(localStorage.getItem(WL_KEY)) || []; }
  catch { return []; }
}

function saveWatchlist(list) {
  localStorage.setItem(WL_KEY, JSON.stringify(list));
}

function addToWatchlist(item) {
  const list = getWatchlist();
  if (list.some(w => w.id === item.id && w.media_type === item.media_type)) return;
  list.unshift({
    id: item.id,
    media_type: item.media_type,
    title: item.title || item.name || 'Untitled',
    year: (item.release_date || item.first_air_date || '').slice(0, 4),
    poster_path: item.poster_path || null,
    rating: item.vote_average ? item.vote_average.toFixed(1) : '',
    added_at: Date.now(),
    watched: false,
  });
  saveWatchlist(list);
}

function removeFromWatchlist(id, mediaType) {
  const list = getWatchlist().filter(w => !(w.id === id && w.media_type === mediaType));
  saveWatchlist(list);
}

function isInWatchlist(id, mediaType) {
  return getWatchlist().some(w => w.id === id && w.media_type === mediaType);
}

function toggleWatched(id, mediaType) {
  const list = getWatchlist();
  const item = list.find(w => w.id === id && w.media_type === mediaType);
  if (item) item.watched = !item.watched;
  saveWatchlist(list);
}

function isWatched(id, mediaType) {
  const item = getWatchlist().find(w => w.id === id && w.media_type === mediaType);
  return item ? !!item.watched : false;
}

/* ── State ── */
let state = {
  query: '',
  mediaType: 'multi',   // multi | movie | tv
  genre: null,          // trending genre filter (TMDB genre id)
  results: [],
  people: [],           // people matched by a search
  page: 1,
  totalPages: 0,
  loading: false,
  trendingFailed: false,
  searchFocused: false,
  detailLoading: false,  // guard: prevents re-triggering loadDetail
  detail: null,          // full detail object when viewing
  providers: null,       // streaming providers for detail
  providersLoading: false,
  overviewOpen: false,
  person: null,          // full person object when viewing
  personLoading: false,
  personFilter: 'all',   // all | movie | tv
  personLimit: 40,
  bioOpen: false,
  watchlistFilter: 'all',       // all | movie | tv
  watchlistStatusFilter: 'all', // all | to-watch | watched
};

/* ── Icons ── */
const ICON = {
  back: '<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
  bookmark: '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>',
  bookmarkFill: '<svg width="19" height="19" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>',
  seen: '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9.5"/><polyline points="8.5 12 11 14.5 15.5 9.5"/></svg>',
  seenFill: '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 11.2V12a9.5 9.5 0 1 1-5.6-8.7"/><polyline points="22 4.5 12 14.5 9 11.5"/></svg>',
  tick: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 12.5 9.5 18 20 6.5"/></svg>',
  close: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
  frame: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="2.5" y="3.5" width="19" height="17" rx="2"/><path d="M7.5 3.5v17M16.5 3.5v17M2.5 12h19"/></svg>',
  head: '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><circle cx="12" cy="8.5" r="4"/><path d="M4 21v-1.2A6.8 6.8 0 0 1 10.8 13h2.4A6.8 6.8 0 0 1 20 19.8V21"/></svg>',
};

/* ── Toast ── */
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('show'), 2400);
}

/* ── Routing ── */
function getRoute() {
  const hash = location.hash || '#/';
  if (hash === '#/') return { screen: 'home' };
  if (hash === '#/watchlist') return { screen: 'watchlist' };
  const m = hash.match(/^#\/(movie|tv)\/(\d+)$/);
  if (m) return { screen: 'detail', mediaType: m[1], id: m[2] };
  const p = hash.match(/^#\/person\/(\d+)$/);
  if (p) return { screen: 'person', id: p[1] };
  return { screen: 'home' };
}

/* Each screen remembers where you were, so stepping back down a chain of
   people and titles returns you to the row you left, not to the top. */
const scrollMem = new Map();
let currentHash = location.hash || '#/';

window.addEventListener('hashchange', () => {
  scrollMem.set(currentHash, window.scrollY);
  currentHash = location.hash || '#/';
  render();
  const y = scrollMem.get(currentHash) || 0;
  requestAnimationFrame(() => window.scrollTo(0, y));
});

window.addEventListener('popstate', () => render());

function go(hash) {
  location.hash = hash;
}

/* ── Person → works helper ── */
const DEPT_LABELS = {
  acting: 'Actor', directing: 'Director', writing: 'Writer',
  production: 'Producer', editing: 'Editor', camera: 'Cinematographer',
  sound: 'Composer', art: 'Art', 'visual effects': 'VFX',
};

function extractPersonWorks(people) {
  const works = [];
  for (const person of people) {
    const dept = (person.known_for_department || '').toLowerCase();
    const label = DEPT_LABELS[dept] || 'Cast';
    for (const w of (person.known_for || [])) {
      if (w.media_type !== 'movie' && w.media_type !== 'tv') continue;
      works.push({
        ...w,
        match_type: label,
        match_name: person.name,
        match_person_id: person.id,
      });
    }
  }
  return works;
}

/* ── Search ── */
async function doSearch(page = 1) {
  const q = state.query.trim();
  if (!q) return;
  state.loading = true;
  state.page = page;
  render();
  try {
    let results, totalPages;
    const ql = q.toLowerCase();
    if (state.mediaType === 'multi') {
      const [movies, tv, people] = await Promise.all([
        tmdb('/search/movie', { query: q, page, include_adult: false }),
        tmdb('/search/tv', { query: q, page, include_adult: false }),
        tmdb('/search/person', { query: q, page: 1, include_adult: false }),
      ]);
      const movieResults = (movies.results || []).map(r => ({ ...r, media_type: 'movie', match_type: 'title' }));
      const tvResults = (tv.results || []).map(r => ({ ...r, media_type: 'tv', match_type: 'title' }));
      // Extract known_for works from person results
      const personWorks = extractPersonWorks(people.results || []);
      // Merge, dedup, filter to real matches only, sort by popularity
      const seen = new Set();
      results = [...movieResults, ...tvResults, ...personWorks]
        .filter(r => { const k = `${r.media_type}-${r.id}`; if (seen.has(k)) return false; seen.add(k); return true; })
        .filter(r => r.match_name || (r.title || r.name || '').toLowerCase().includes(ql))
        .sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
      totalPages = Math.max(movies.total_pages || 1, tv.total_pages || 1);
      state.people = matchedPeople(people.results || [], ql);
    } else {
      const [data, people] = await Promise.all([
        tmdb(`/search/${state.mediaType}`, { query: q, page, include_adult: false }),
        tmdb('/search/person', { query: q, page: 1, include_adult: false }),
      ]);
      const titleResults = (data.results || []).map(r => ({ ...r, media_type: state.mediaType, match_type: 'title' }));
      const personWorks = extractPersonWorks(people.results || [])
        .filter(r => r.media_type === state.mediaType);
      const seen = new Set();
      results = [...titleResults, ...personWorks]
        .filter(r => { const k = `${r.media_type}-${r.id}`; if (seen.has(k)) return false; seen.add(k); return true; })
        .filter(r => r.match_name || (r.title || r.name || '').toLowerCase().includes(ql))
        .sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
      totalPages = data.total_pages || 1;
      state.people = matchedPeople(people.results || [], ql);
    }
    state.results = results;
    state.totalPages = Math.min(totalPages, 500);
  } catch (e) {
    toast('Search failed. Check the connection and try again.');
    console.error(e);
  }
  state.loading = false;
  render();
}

function matchedPeople(people, ql) {
  return people
    .filter(p => (p.name || '').toLowerCase().includes(ql))
    .sort((a, b) => (b.popularity || 0) - (a.popularity || 0))
    .slice(0, 12);
}

/* ── Load trending ── */
let trendingAll = []; // cache unfiltered trending results

async function loadTrending() {
  state.loading = true;
  render();
  try {
    const data = await tmdb('/trending/all/week');
    trendingAll = (data.results || []).filter(r => r.media_type === 'movie' || r.media_type === 'tv');
    state.trendingFailed = false;
    state.results = filterTrending();
    state.totalPages = 1;
    state.page = 1;
    state.query = '';
    state.people = [];
  } catch (e) {
    console.error(e);
    state.trendingFailed = true;
    toast('Could not reach TMDB. Reload to try again.');
  }
  state.loading = false;
  render();
}

function filterTrending() {
  let list = trendingAll;
  if (state.mediaType !== 'multi') list = list.filter(r => r.media_type === state.mediaType);
  if (state.genre) list = list.filter(r => (r.genre_ids || []).includes(state.genre));
  return list;
}

/* Genres actually present in the trending set, most common first. */
function trendingGenres() {
  let base = trendingAll;
  if (state.mediaType !== 'multi') base = base.filter(r => r.media_type === state.mediaType);
  const counts = new Map();
  for (const r of base) {
    for (const g of (r.genre_ids || [])) {
      if (!GENRE_MAP[g]) continue;
      counts.set(g, (counts.get(g) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || GENRE_MAP[a[0]].localeCompare(GENRE_MAP[b[0]]))
    .map(([id]) => id);
}

/* ── Load detail ── */
async function loadDetail(mediaType, id) {
  state.detailLoading = true;
  state.detail = null;
  state.providers = null;
  state.providersLoading = true;
  state.overviewOpen = false;
  render();
  try {
    // Load detail + credits first so we can show it immediately
    const detail = await tmdb(`/${mediaType}/${id}`, { append_to_response: 'credits' });
    detail.media_type = mediaType;
    if (getRoute().screen !== 'detail' || getRoute().id !== String(id)) { state.detailLoading = false; return; }
    state.detail = detail;
    render();
    // Then load providers in the background
    const provData = await tmdb(`/${mediaType}/${id}/watch/providers`);
    state.providers = aggregateProviders(provData.results || {});
  } catch (e) {
    if (!state.detail) toast('Could not load this title. Try again in a moment.');
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

/* ── Load person ── */
async function loadPerson(id) {
  state.personLoading = true;
  state.person = null;
  state.personFilter = 'all';
  state.personLimit = 40;
  state.bioOpen = false;
  render();
  try {
    const person = await tmdb(`/person/${id}`, { append_to_response: 'combined_credits' });
    if (getRoute().screen !== 'person' || getRoute().id !== String(id)) { state.personLoading = false; return; }
    person.works = buildFilmography(person.combined_credits || {});
    state.person = person;
  } catch (e) {
    toast('Could not load this profile. Try again in a moment.');
    console.error(e);
  }
  state.personLoading = false;
  render();
}

/* One row per title, with every role that person had on it. */
function buildFilmography(credits) {
  const byKey = new Map();
  const add = (c, role) => {
    if (c.media_type !== 'movie' && c.media_type !== 'tv') return;
    const key = `${c.media_type}-${c.id}`;
    const date = c.release_date || c.first_air_date || '';
    let row = byKey.get(key);
    if (!row) {
      row = {
        id: c.id,
        media_type: c.media_type,
        title: c.title || c.name || 'Untitled',
        date,
        year: date.slice(0, 4),
        poster_path: c.poster_path || null,
        vote_average: c.vote_average || 0,
        vote_count: c.vote_count || 0,
        popularity: c.popularity || 0,
        episode_count: c.episode_count || 0,
        roles: [],
      };
      byKey.set(key, row);
    }
    if (role && !row.roles.includes(role)) row.roles.push(role);
    if (!row.date && date) { row.date = date; row.year = date.slice(0, 4); }
    if (c.episode_count > row.episode_count) row.episode_count = c.episode_count;
  };

  for (const c of (credits.cast || [])) add(c, c.character ? `as ${c.character}` : 'Cast');
  for (const c of (credits.crew || [])) add(c, c.job || c.department || '');

  return [...byKey.values()].sort((a, b) => {
    if (!a.date && !b.date) return (b.popularity || 0) - (a.popularity || 0);
    if (!a.date) return -1;   // unreleased / undated first
    if (!b.date) return 1;
    return b.date.localeCompare(a.date);
  });
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
      return;
    }
    app.innerHTML = renderDetail();
    bindDetail();
    return;
  }

  if (route.screen === 'person') {
    const needsLoad = !state.personLoading && (!state.person || String(state.person.id) !== route.id);
    if (needsLoad) {
      loadPerson(route.id);
      return;
    }
    app.innerHTML = renderPerson();
    bindPerson();
    return;
  }

  if (route.screen === 'watchlist') {
    app.innerHTML = renderWatchlist();
    bindWatchlist();
    return;
  }

  // Home / search screen
  if (state.results.length === 0 && !state.loading && !state.query && !state.trendingFailed && trendingAll.length === 0) {
    loadTrending();
    return;
  }
  app.innerHTML = renderHome();
  bindHome();
}

/* ── Shared pieces ── */
function watchlistButton() {
  const n = getWatchlist().length;
  return `
    <button class="iconbtn" id="goWatchlist" aria-label="Watchlist${n ? `, ${n} saved` : ''}">
      ${ICON.bookmark}
      ${n ? `<span class="count">${n}</span>` : ''}
    </button>`;
}

function backButton(id) {
  return `<button class="iconbtn iconbtn--flat" id="${id}" aria-label="Back">${ICON.back}</button>`;
}

function posterArt(path, alt, size = 'w342') {
  if (!path) return `<div class="art-empty">${ICON.frame}</div>`;
  return `<img src="${IMG_BASE}/${size}${path}" alt="" loading="lazy" decoding="async">`;
}

function kindLabel(mediaType) {
  return mediaType === 'movie' ? 'Film' : 'Series';
}

function savedMark(id, mediaType) {
  if (!isInWatchlist(id, mediaType)) return '';
  const seen = isWatched(id, mediaType);
  return `<span class="saved-mark${seen ? ' is-done' : ''}" aria-hidden="true">${seen ? ICON.tick : ICON.bookmarkFill}</span>`;
}

/* One tile in a grid or rail. */
function renderCard(r, opts = {}) {
  const title = r.title || r.name || 'Untitled';
  const year = r.year || (r.release_date || r.first_air_date || '').slice(0, 4);
  const rating = r.vote_average ? Number(r.vote_average).toFixed(1) : '';
  const key = `${r.media_type}-${r.id}`;
  const rank = opts.rank ? String(opts.rank).padStart(2, '0') : '';

  return `
    <div class="tile" data-key="${key}">
      <button class="tile-open" data-type="${r.media_type}" data-id="${r.id}">
        <div class="art">
          ${posterArt(r.poster_path, title)}
          ${rank ? `<span class="art-foot"></span><span class="rank">${rank}</span>` : ''}
          ${savedMark(r.id, r.media_type)}
        </div>
        <h3 class="tile-title">${esc(title)}</h3>
        <div class="factline">
          <span>${kindLabel(r.media_type)}</span>
          ${year ? `<span>${year}</span>` : ''}
          ${rating && rating !== '0.0' ? `<span class="star">${rating}</span>` : ''}
        </div>
      </button>
      ${r.match_name && r.match_person_id
        ? `<button class="tile-via" data-person="${r.match_person_id}">${esc(r.match_name)}, ${esc(String(r.match_type).toLowerCase())}</button>`
        : ''}
    </div>`;
}

/* ── Home screen ── */
function renderHome() {
  const isSearch = state.query.trim().length > 0;
  const list = state.results;
  const hero = !isSearch && !state.loading ? list[0] : null;
  const rest = hero ? list.slice(1) : list;
  const genres = !isSearch ? trendingGenres() : [];

  return `
    <div class="screen">
      <header class="topbar">
        <div class="topbar-lead">
          <h1 class="wordmark">Scout<span class="wordmark-dot">.</span></h1>
        </div>
        <div class="topbar-actions">${watchlistButton()}</div>
      </header>

      <div class="searchrow">
        <input class="search" type="search" id="searchInput" autocomplete="off"
               placeholder="Search a title, an actor, a director"
               aria-label="Search titles and people" value="${esc(state.query)}">
      </div>

      ${hero ? renderMarquee(hero) : ''}

      <div class="filters">
        <nav class="tabs" aria-label="Kind">
          <button class="tab ${state.mediaType === 'multi' ? 'is-on' : ''}" data-type="multi" aria-pressed="${state.mediaType === 'multi'}">Everything</button>
          <button class="tab ${state.mediaType === 'movie' ? 'is-on' : ''}" data-type="movie" aria-pressed="${state.mediaType === 'movie'}">Films</button>
          <button class="tab ${state.mediaType === 'tv' ? 'is-on' : ''}" data-type="tv" aria-pressed="${state.mediaType === 'tv'}">Series</button>
        </nav>
        ${genres.length ? `
          <div class="chiprail" role="group" aria-label="Genre">
            <button class="chip ${state.genre === null ? 'is-on' : ''}" data-genre="all" aria-pressed="${state.genre === null}">Any genre</button>
            ${genres.map(g => `<button class="chip ${state.genre === g ? 'is-on' : ''}" data-genre="${g}" aria-pressed="${state.genre === g}">${esc(GENRE_MAP[g])}</button>`).join('')}
          </div>` : ''}
      </div>

      ${state.loading ? `
        <div class="pending"><span class="spinner"></span><span>${isSearch ? 'Searching' : 'Reading the charts'}</span></div>
      ` : list.length === 0 && state.people.length === 0 ? renderNoResults() : `
        ${isSearch && state.people.length ? `
          <section class="block">
            <h2 class="blockhead">People</h2>
            <div class="peoplerail">
              ${state.people.map(p => renderCreditPerson(p, p.known_for_department === 'Acting' ? 'Acting' : p.known_for_department)).join('')}
            </div>
          </section>` : ''}

        ${rest.length ? `
          <section class="block">
            <div class="blockhead-row">
              <h2 class="blockhead">${isSearch ? 'Titles' : hero ? 'Also charting' : 'Trending this week'}</h2>
              ${isSearch ? `<span class="blockhead-note">${list.length} on this page</span>` : ''}
            </div>
            <div class="grid">
              ${rest.map((r, i) => renderCard(r, { rank: isSearch ? 0 : i + 2 })).join('')}
            </div>
          </section>` : ''}
        ${isSearch && state.totalPages > 1 ? renderPagination() : ''}
      `}
    </div>`;
}

function renderMarquee(r) {
  const title = r.title || r.name || 'Untitled';
  const year = (r.release_date || r.first_air_date || '').slice(0, 4);
  const rating = r.vote_average ? Number(r.vote_average).toFixed(1) : '';
  const art = r.backdrop_path ? `${IMG_BASE}/w780${r.backdrop_path}`
    : r.poster_path ? `${IMG_BASE}/w500${r.poster_path}` : '';
  const genre = (r.genre_ids || []).map(g => GENRE_MAP[g]).filter(Boolean)[0];

  return `
    <section class="marquee">
      <button class="marquee-open" data-type="${r.media_type}" data-id="${r.id}">
        ${art ? `<img src="${art}" alt="" fetchpriority="high" decoding="async">` : ''}
        <span class="marquee-scrim"></span>
        <span class="marquee-text">
          <span class="marquee-kicker"><span class="bignum">01</span> most watched this week</span>
          <span class="marquee-title">${esc(title)}</span>
          <span class="factline">
            <span>${kindLabel(r.media_type)}</span>
            ${year ? `<span>${year}</span>` : ''}
            ${genre ? `<span>${esc(genre)}</span>` : ''}
            ${rating && rating !== '0.0' ? `<span class="star">${rating}</span>` : ''}
          </span>
        </span>
      </button>
    </section>`;
}

function renderNoResults() {
  if (state.query.trim()) {
    return `
      <div class="blank">
        <h2>Nothing under that name</h2>
        <p>Check the spelling, or search the director or an actor instead.</p>
      </div>`;
  }
  if (state.genre) {
    return `
      <div class="blank">
        <h2>Nothing in that genre this week</h2>
        <p>The chart moves every Monday. Try another genre.</p>
        <button class="moretoggle" data-genre="all">Show every genre</button>
      </div>`;
  }
  return `
    <div class="blank">
      <h2>The chart is empty</h2>
      <p>Scout could not reach TMDB. Reload once you are back online.</p>
    </div>`;
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
    <nav class="pager" aria-label="Result pages">
      ${p > 1 ? `<button class="page" data-page="${p - 1}" aria-label="Previous page">&larr;</button>` : ''}
      ${pages.map(pg => pg === '...'
        ? `<span class="page-gap" aria-hidden="true">...</span>`
        : `<button class="page ${pg === p ? 'is-on' : ''}" data-page="${pg}" aria-label="Page ${pg}"${pg === p ? ' aria-current="page"' : ''}>${pg}</button>`
      ).join('')}
      ${p < total ? `<button class="page" data-page="${p + 1}" aria-label="Next page">&rarr;</button>` : ''}
    </nav>`;
}

/* ── Detail screen ── */
function renderDetail() {
  if (!state.detail) {
    return `
      <div class="screen">
        <header class="topbar">${backButton('backBtn')}</header>
        <div class="pending"><span class="spinner"></span><span>Loading</span></div>
      </div>`;
  }

  const d = state.detail;
  const title = d.title || d.name || 'Untitled';
  const year = (d.release_date || d.first_air_date || '').slice(0, 4);
  const rating = d.vote_average ? d.vote_average.toFixed(1) : '';
  const backdrop = d.backdrop_path ? `${IMG_BASE}/w780${d.backdrop_path}` : '';
  const genres = (d.genres || []).map(g => g.name);
  const overview = d.overview || '';
  const runtime = d.runtime ? `${d.runtime} min` : '';
  const seasons = d.number_of_seasons ? `${d.number_of_seasons} season${d.number_of_seasons > 1 ? 's' : ''}` : '';
  const long = overview.length > 420;

  return `
    <div class="screen${backdrop ? '' : ' detail-no-art'}">
      <header class="topbar ${backdrop ? 'topbar--over' : ''}">
        ${backButton('backBtn')}
        <div class="topbar-actions">${watchlistButton()}</div>
      </header>

      ${backdrop ? `
        <div class="backdrop">
          <img src="${backdrop}" alt="" fetchpriority="high" decoding="async">
          <div class="backdrop-fade"></div>
        </div>` : ''}

      <div class="detail-head">
        <div class="poster">${posterArt(d.poster_path, title, 'w500')}</div>
        <div class="detail-facts">
          <h1 class="screen-title">${esc(title)}</h1>
          <div class="factline">
            <span>${kindLabel(d.media_type)}</span>
            ${year ? `<span>${year}</span>` : ''}
            ${runtime ? `<span>${runtime}</span>` : ''}
            ${seasons ? `<span>${seasons}</span>` : ''}
          </div>
          ${rating && rating !== '0.0' ? `<p class="rating">${rating} <small>average of ${d.vote_count || 0} votes</small></p>` : ''}
        </div>
      </div>

      <div class="actions" id="detailActions">${renderDetailActions()}</div>

      ${genres.length ? `<div class="taglist">${genres.map(g => `<span class="tag">${esc(g)}</span>`).join('')}</div>` : ''}

      ${overview ? `
        <section class="block">
          <h2 class="blockhead">The story</h2>
          <p class="prose${long && !state.overviewOpen ? ' is-clamped' : ''}" id="overviewText">${esc(overview)}</p>
          ${long ? `<button class="moretoggle" id="overviewToggle">${state.overviewOpen ? 'Show less' : 'Read more'}</button>` : ''}
        </section>` : ''}

      ${renderCredits(d)}

      <section class="block">
        <h2 class="blockhead">Where to watch</h2>
        ${renderProviders()}
      </section>
    </div>`;
}

function renderDetailActions() {
  const d = state.detail;
  if (!d) return '';
  const saved = isInWatchlist(d.id, d.media_type);
  const seen = isWatched(d.id, d.media_type);
  return `
    <button class="btn ${saved ? 'btn--quiet is-on' : 'btn--primary'}" id="wlToggle" aria-pressed="${saved}">
      ${saved ? ICON.bookmarkFill : ICON.bookmark}
      <span>${saved ? 'Saved' : 'Save to watchlist'}</span>
    </button>
    ${saved ? `
      <button class="btn btn--quiet${seen ? ' is-done' : ''}" id="watchedToggle" aria-pressed="${seen}">
        ${seen ? ICON.seenFill : ICON.seen}
        <span>${seen ? 'Watched' : 'Mark watched'}</span>
      </button>` : ''}`;
}

function renderCredits(d) {
  const credits = d.credits;
  if (!credits) return '';
  const directors = (credits.crew || []).filter(c => c.job === 'Director');
  const creators = (d.created_by || []);
  const cast = (credits.cast || []).slice(0, 12);
  if (!directors.length && !cast.length && !creators.length) return '';

  const lead = directors.length ? directors : creators;
  const leadLabel = directors.length
    ? `Direction`
    : `Created by`;

  return `
    <section class="block">
      <h2 class="blockhead">Who made it</h2>
      ${lead.length ? `
        <div class="blockhead-row"><span class="blockhead-note">${leadLabel}</span></div>
        <div class="peoplerail">${lead.map(p => renderCreditPerson(p, null)).join('')}</div>` : ''}
      ${cast.length ? `
        <div class="blockhead-row" style="margin-top:18px"><span class="blockhead-note">Cast</span></div>
        <div class="peoplerail">${cast.map(p => renderCreditPerson(p, p.character)).join('')}</div>` : ''}
    </section>`;
}

function renderCreditPerson(p, role) {
  const photo = p.profile_path ? `${IMG_BASE}/w185${p.profile_path}` : '';
  return `
    <button class="person-chip" data-person="${p.id}">
      <span class="face">
        ${photo ? `<img src="${photo}" alt="" loading="lazy" decoding="async">` : ICON.head}
      </span>
      <span class="person-name">${esc(p.name)}</span>
      ${role ? `<span class="person-role">${esc(role)}</span>` : ''}
    </button>`;
}

function renderProviders() {
  if (state.providersLoading) {
    return '<div class="pending"><span class="spinner"></span><span>Checking services</span></div>';
  }
  const providers = state.providers;
  if (!providers || providers.length === 0) {
    return '<p class="prose">No subscription service carries this one right now.</p>';
  }
  return `
    <div class="providers">
      ${providers.map((p, i) => `
        <button class="provider" data-idx="${i}" aria-expanded="false">
          ${p.logo_url ? `<img class="provider-logo" src="${p.logo_url}" alt="" loading="lazy">` : ''}
          <span class="provider-name">${esc(p.name)}</span>
          <span class="provider-count">${p.countries.length} ${p.countries.length === 1 ? 'country' : 'countries'}</span>
          <span class="provider-flags">
            ${p.countries.map(cc => `<span class="flag" title="${esc(countryName(cc))}">${countryFlag(cc)}</span>`).join('')}
          </span>
        </button>`).join('')}
    </div>`;
}

/* ── Person screen ── */
function renderPerson() {
  if (!state.person) {
    return `
      <div class="screen">
        <header class="topbar">${backButton('personBackBtn')}</header>
        <div class="pending"><span class="spinner"></span><span>Loading</span></div>
      </div>`;
  }

  const p = state.person;
  const photo = p.profile_path ? `${IMG_BASE}/w342${p.profile_path}` : '';
  const works = p.works || [];
  const filtered = state.personFilter === 'all' ? works : works.filter(w => w.media_type === state.personFilter);
  const shown = filtered.slice(0, state.personLimit);
  const filmCount = works.filter(w => w.media_type === 'movie').length;
  const tvCount = works.filter(w => w.media_type === 'tv').length;

  const knownFor = [...works]
    .filter(w => w.poster_path)
    .sort((a, b) => (b.vote_count || 0) * (b.popularity || 1) - (a.vote_count || 0) * (a.popularity || 1))
    .slice(0, 10);

  const bio = (p.biography || '').trim();
  const longBio = bio.length > 460;
  const born = longDate(p.birthday);
  const died = longDate(p.deathday);

  const facts = [];
  if (born) facts.push({ k: 'Born', v: born + (died ? '' : ageSuffix(p.birthday)) });
  if (died) facts.push({ k: 'Died', v: died + ageAtDeath(p.birthday, p.deathday) });
  if (p.place_of_birth) facts.push({ k: 'From', v: p.place_of_birth });

  return `
    <div class="screen">
      <header class="topbar">
        ${backButton('personBackBtn')}
        <div class="topbar-actions">${watchlistButton()}</div>
      </header>

      <div class="person-head">
        <div class="portrait">
          ${photo ? `<img src="${photo}" alt="${esc(p.name)}" fetchpriority="high" decoding="async">` : ICON.head}
        </div>
        <div>
          <h1 class="screen-title">${esc(p.name)}</h1>
          <div class="factline">
            ${p.known_for_department ? `<span>${esc(p.known_for_department)}</span>` : ''}
            ${works.length ? `<span>${works.length} credits</span>` : ''}
          </div>
        </div>
      </div>

      ${facts.length ? `
        <div class="person-stats">
          ${facts.map(f => `<div class="stat"><div class="stat-key">${esc(f.k)}</div><div class="stat-val">${esc(f.v)}</div></div>`).join('')}
        </div>` : ''}

      ${bio ? `
        <section class="block">
          <h2 class="blockhead">Life</h2>
          <p class="prose${longBio && !state.bioOpen ? ' is-clamped' : ''}">${esc(bio)}</p>
          ${longBio ? `<button class="moretoggle" id="bioToggle">${state.bioOpen ? 'Show less' : 'Read more'}</button>` : ''}
        </section>` : ''}

      ${knownFor.length ? `
        <section class="block">
          <h2 class="blockhead">Best known for</h2>
          <div class="rail">${knownFor.map(w => renderCard(w)).join('')}</div>
        </section>` : ''}

      ${works.length ? `
        <section class="block">
          <h2 class="blockhead">Every credit</h2>
          <nav class="tabs" aria-label="Credit kind">
            <button class="tab ${state.personFilter === 'all' ? 'is-on' : ''}" data-pfilter="all" aria-pressed="${state.personFilter === 'all'}">All<span class="tab-count">${works.length}</span></button>
            <button class="tab ${state.personFilter === 'movie' ? 'is-on' : ''}" data-pfilter="movie" aria-pressed="${state.personFilter === 'movie'}">Films<span class="tab-count">${filmCount}</span></button>
            <button class="tab ${state.personFilter === 'tv' ? 'is-on' : ''}" data-pfilter="tv" aria-pressed="${state.personFilter === 'tv'}">Series<span class="tab-count">${tvCount}</span></button>
          </nav>
          <ol class="filmo">
            ${shown.map((w, i) => renderFilmoRow(w, i === 0 ? null : shown[i - 1])).join('')}
          </ol>
          ${filtered.length > shown.length
            ? `<button class="morelist" id="moreCredits">Show ${filtered.length - shown.length} more</button>`
            : ''}
        </section>` : `
        <div class="blank">
          <h2>No credits on file</h2>
          <p>TMDB has a profile for ${esc(p.name)} but no titles attached to it yet.</p>
        </div>`}
    </div>`;
}

function renderFilmoRow(w, prev) {
  const showYear = !prev || prev.year !== w.year;
  const saved = isInWatchlist(w.id, w.media_type);
  const seen = isWatched(w.id, w.media_type);
  const rating = w.vote_average ? Number(w.vote_average).toFixed(1) : '';
  const bits = [];
  if (w.roles.length) bits.push(esc(w.roles.slice(0, 2).join(', ')));
  if (w.media_type === 'tv' && w.episode_count) bits.push(`${w.episode_count} episodes`);
  if (rating && rating !== '0.0') bits.push(`<span class="star">${rating}</span>`);

  return `
    <li class="filmo-row">
      <span class="filmo-year">${showYear ? (w.year || 'TBA') : ''}</span>
      <button class="filmo-open" data-type="${w.media_type}" data-id="${w.id}">
        <span class="filmo-title">${esc(w.title)}</span>
        ${bits.length ? `<span class="filmo-sub factline">${bits.map(b => `<span>${b}</span>`).join('')}</span>` : ''}
      </button>
      <button class="filmo-save${saved ? ' is-on' : ''}" data-save-id="${w.id}" data-save-type="${w.media_type}"
              aria-pressed="${saved}" aria-label="${saved ? `Remove ${esc(w.title)} from watchlist` : `Save ${esc(w.title)} to watchlist`}">
        ${saved ? (seen ? ICON.seenFill : ICON.bookmarkFill) : ICON.bookmark}
      </button>
    </li>`;
}

function ageSuffix(birthday) {
  if (!birthday) return '';
  const b = new Date(`${birthday}T00:00:00Z`);
  if (isNaN(b)) return '';
  const now = new Date();
  let age = now.getUTCFullYear() - b.getUTCFullYear();
  const m = now.getUTCMonth() - b.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < b.getUTCDate())) age--;
  return age > 0 && age < 120 ? ` (${age})` : '';
}

function ageAtDeath(birthday, deathday) {
  if (!birthday || !deathday) return '';
  const b = new Date(`${birthday}T00:00:00Z`);
  const d = new Date(`${deathday}T00:00:00Z`);
  if (isNaN(b) || isNaN(d)) return '';
  let age = d.getUTCFullYear() - b.getUTCFullYear();
  const m = d.getUTCMonth() - b.getUTCMonth();
  if (m < 0 || (m === 0 && d.getUTCDate() < b.getUTCDate())) age--;
  return age > 0 && age < 120 ? ` (aged ${age})` : '';
}

/* ── Watchlist screen ── */
function renderWatchlist() {
  const all = getWatchlist();
  const typeFilter = state.watchlistFilter;
  const statusFilter = state.watchlistStatusFilter;
  let items = all;
  if (typeFilter === 'movie') items = items.filter(w => w.media_type === 'movie');
  if (typeFilter === 'tv') items = items.filter(w => w.media_type === 'tv');
  if (statusFilter === 'to-watch') items = items.filter(w => !w.watched);
  if (statusFilter === 'watched') items = items.filter(w => !!w.watched);

  const movieCount = all.filter(w => w.media_type === 'movie').length;
  const tvCount = all.filter(w => w.media_type === 'tv').length;
  const watchedCount = all.filter(w => !!w.watched).length;

  return `
    <div class="screen">
      <header class="topbar">
        <div class="topbar-lead">
          ${backButton('wlBackBtn')}
          <h1 class="wordmark">Watchlist</h1>
        </div>
      </header>

      <div class="filters">
        <nav class="tabs" aria-label="Kind">
          <button class="tab ${typeFilter === 'all' ? 'is-on' : ''}" data-wltype="all" aria-pressed="${typeFilter === 'all'}">All<span class="tab-count">${all.length}</span></button>
          <button class="tab ${typeFilter === 'movie' ? 'is-on' : ''}" data-wltype="movie" aria-pressed="${typeFilter === 'movie'}">Films<span class="tab-count">${movieCount}</span></button>
          <button class="tab ${typeFilter === 'tv' ? 'is-on' : ''}" data-wltype="tv" aria-pressed="${typeFilter === 'tv'}">Series<span class="tab-count">${tvCount}</span></button>
        </nav>
        <div class="chiprail" role="group" aria-label="Status">
          <button class="chip ${statusFilter === 'all' ? 'is-on' : ''}" data-wlstatus="all" aria-pressed="${statusFilter === 'all'}">Everything</button>
          <button class="chip ${statusFilter === 'to-watch' ? 'is-on' : ''}" data-wlstatus="to-watch" aria-pressed="${statusFilter === 'to-watch'}">Still to watch${all.length - watchedCount ? ` (${all.length - watchedCount})` : ''}</button>
          <button class="chip ${statusFilter === 'watched' ? 'is-on' : ''}" data-wlstatus="watched" aria-pressed="${statusFilter === 'watched'}">Watched${watchedCount ? ` (${watchedCount})` : ''}</button>
        </div>
      </div>

      ${items.length === 0 ? `
        <div class="blank">
          ${all.length === 0 ? `
            <h2>Nothing saved yet</h2>
            <p>Tap the bookmark on any title and it waits for you here.</p>
            <button class="moretoggle" id="wlGoHome">Browse the chart</button>
          ` : `
            <h2>Nothing under this filter</h2>
            <p>${watchedCount === all.length ? 'You have watched everything you saved.' : 'Try another filter to see the rest.'}</p>
          `}
        </div>
      ` : `
        <div class="grid">
          ${items.map(w => renderWatchlistCard(w)).join('')}
        </div>
      `}
    </div>`;
}

function renderWatchlistCard(w) {
  return `
    <div class="tile${w.watched ? ' is-watched' : ''}" data-key="${w.media_type}-${w.id}">
      <button class="tile-open" data-type="${w.media_type}" data-id="${w.id}">
        <div class="art">
          ${posterArt(w.poster_path, w.title)}
          ${w.watched ? `<span class="saved-mark is-done" aria-hidden="true">${ICON.tick}</span>` : ''}
        </div>
        <h3 class="tile-title">${esc(w.title)}</h3>
        <div class="factline">
          <span>${kindLabel(w.media_type)}</span>
          ${w.year ? `<span>${w.year}</span>` : ''}
          ${w.rating ? `<span class="star">${w.rating}</span>` : ''}
          ${w.watched ? `<span class="now">Watched</span>` : ''}
        </div>
      </button>
      <button class="tile-remove" data-remove-id="${w.id}" data-remove-type="${w.media_type}"
              aria-label="Remove ${esc(w.title)} from watchlist">${ICON.close}</button>
    </div>`;
}

/* ── Binding ── */
function bindCommon() {
  const wlBtn = document.getElementById('goWatchlist');
  if (wlBtn) wlBtn.addEventListener('click', () => go('#/watchlist'));

  document.querySelectorAll('.tile-open, .marquee-open, .filmo-open').forEach(el => {
    el.addEventListener('click', () => go(`#/${el.dataset.type}/${el.dataset.id}`));
  });

  document.querySelectorAll('[data-person]').forEach(el => {
    el.addEventListener('click', () => go(`#/person/${el.dataset.person}`));
  });
}

function goBack() {
  if (history.length > 1) history.back();
  else go('#/');
}

/* ── Debounce ── */
let debounceTimer = null;

function bindHome() {
  bindCommon();

  const input = document.getElementById('searchInput');
  if (input) {
    input.addEventListener('focus', () => { state.searchFocused = true; });
    input.addEventListener('blur', () => { state.searchFocused = false; });
    input.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      const q = input.value.trim();
      if (!q) {
        state.query = '';
        state.people = [];
        state.results = filterTrending();
        render();
        return;
      }
      debounceTimer = setTimeout(() => { state.query = input.value; doSearch(); }, 700);
    });
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') { clearTimeout(debounceTimer); state.query = input.value; doSearch(); input.blur(); }
    });
    if (state.searchFocused) {
      input.focus();
      const v = input.value;
      input.setSelectionRange(v.length, v.length);
    }
  }

  document.querySelectorAll('.tab[data-type]').forEach(b => {
    b.addEventListener('click', () => {
      state.mediaType = b.dataset.type;
      state.genre = null;
      if (state.query.trim()) doSearch();
      else { state.results = filterTrending(); render(); }
    });
  });

  document.querySelectorAll('[data-genre]').forEach(b => {
    b.addEventListener('click', () => {
      const g = b.dataset.genre;
      state.genre = g === 'all' ? null : Number(g);
      state.results = filterTrending();
      render();
    });
  });

  document.querySelectorAll('.page[data-page]').forEach(b => {
    b.addEventListener('click', () => {
      doSearch(Number(b.dataset.page));
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  });
}

function bindDetail() {
  const back = document.getElementById('backBtn');
  if (back) back.addEventListener('click', goBack);

  bindCommon();
  bindDetailActions();

  const toggle = document.getElementById('overviewToggle');
  if (toggle) {
    toggle.addEventListener('click', () => {
      state.overviewOpen = !state.overviewOpen;
      const text = document.getElementById('overviewText');
      if (text) text.classList.toggle('is-clamped', !state.overviewOpen);
      toggle.textContent = state.overviewOpen ? 'Show less' : 'Read more';
    });
  }

  document.querySelectorAll('.provider').forEach(chip => {
    chip.addEventListener('click', () => {
      const open = chip.getAttribute('aria-expanded') === 'true';
      chip.setAttribute('aria-expanded', String(!open));
    });
  });
}

function bindDetailActions() {
  const d = state.detail;
  if (!d) return;

  const refresh = () => {
    const holder = document.getElementById('detailActions');
    if (holder) {
      holder.innerHTML = renderDetailActions();
      bindDetailActions();
    }
    syncSaved(d.id, d.media_type);
  };

  const wlToggle = document.getElementById('wlToggle');
  if (wlToggle) {
    wlToggle.addEventListener('click', () => {
      if (isInWatchlist(d.id, d.media_type)) {
        removeFromWatchlist(d.id, d.media_type);
        toast('Removed from your watchlist');
      } else {
        addToWatchlist(d);
        toast('Saved to your watchlist');
      }
      refresh();
    });
  }

  const watchedToggle = document.getElementById('watchedToggle');
  if (watchedToggle) {
    watchedToggle.addEventListener('click', () => {
      toggleWatched(d.id, d.media_type);
      toast(isWatched(d.id, d.media_type) ? 'Marked as watched' : 'Marked as not watched');
      refresh();
    });
  }
}

function bindPerson() {
  const back = document.getElementById('personBackBtn');
  if (back) back.addEventListener('click', goBack);

  bindCommon();

  const bio = document.getElementById('bioToggle');
  if (bio) {
    bio.addEventListener('click', () => {
      state.bioOpen = !state.bioOpen;
      const text = bio.previousElementSibling;
      if (text) text.classList.toggle('is-clamped', !state.bioOpen);
      bio.textContent = state.bioOpen ? 'Show less' : 'Read more';
    });
  }

  document.querySelectorAll('[data-pfilter]').forEach(b => {
    b.addEventListener('click', () => {
      state.personFilter = b.dataset.pfilter;
      state.personLimit = 40;
      render();
    });
  });

  const more = document.getElementById('moreCredits');
  if (more) {
    more.addEventListener('click', () => {
      state.personLimit += 120;
      render();
    });
  }

  document.querySelectorAll('.filmo-save').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = Number(btn.dataset.saveId);
      const type = btn.dataset.saveType;
      const work = (state.person.works || []).find(w => w.id === id && w.media_type === type);
      if (isInWatchlist(id, type)) {
        removeFromWatchlist(id, type);
        toast('Removed from your watchlist');
      } else if (work) {
        addToWatchlist({ ...work, release_date: work.date, first_air_date: work.date });
        toast('Saved to your watchlist');
      }
      syncSaved(id, type);
    });
  });
}

/* Keep every visible marker for one title in step, without a full redraw. */
function syncSaved(id, mediaType) {
  const saved = isInWatchlist(id, mediaType);
  const seen = isWatched(id, mediaType);

  document.querySelectorAll(`.filmo-save[data-save-id="${id}"][data-save-type="${mediaType}"]`).forEach(btn => {
    btn.classList.toggle('is-on', saved);
    btn.setAttribute('aria-pressed', String(saved));
    btn.innerHTML = saved ? (seen ? ICON.seenFill : ICON.bookmarkFill) : ICON.bookmark;
  });

  document.querySelectorAll(`.tile[data-key="${mediaType}-${id}"]`).forEach(tile => {
    const art = tile.querySelector('.art');
    if (!art) return;
    const mark = art.querySelector('.saved-mark');
    if (!saved) { if (mark) mark.remove(); return; }
    const html = seen ? ICON.tick : ICON.bookmarkFill;
    if (mark) {
      mark.classList.toggle('is-done', seen);
      mark.innerHTML = html;
    } else {
      art.insertAdjacentHTML('beforeend', `<span class="saved-mark${seen ? ' is-done' : ''}" aria-hidden="true">${html}</span>`);
    }
  });

  const badge = document.querySelector('#goWatchlist .count');
  const n = getWatchlist().length;
  if (badge && n) badge.textContent = n;
  else if (badge) badge.remove();
  else if (n) {
    const btn = document.getElementById('goWatchlist');
    if (btn) btn.insertAdjacentHTML('beforeend', `<span class="count">${n}</span>`);
  }
}

function bindWatchlist() {
  const back = document.getElementById('wlBackBtn');
  if (back) back.addEventListener('click', () => go('#/'));

  bindCommon();

  const home = document.getElementById('wlGoHome');
  if (home) home.addEventListener('click', () => go('#/'));

  document.querySelectorAll('[data-wltype]').forEach(b => {
    b.addEventListener('click', () => { state.watchlistFilter = b.dataset.wltype; render(); });
  });

  document.querySelectorAll('[data-wlstatus]').forEach(b => {
    b.addEventListener('click', () => { state.watchlistStatusFilter = b.dataset.wlstatus; render(); });
  });

  document.querySelectorAll('.tile-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = Number(btn.dataset.removeId);
      const type = btn.dataset.removeType;
      const tile = btn.closest('.tile');
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const finish = () => { removeFromWatchlist(id, type); toast('Removed from your watchlist'); render(); };
      if (tile && !reduce) {
        tile.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
        tile.style.opacity = '0';
        tile.style.transform = 'scale(0.94)';
        setTimeout(finish, 200);
      } else {
        finish();
      }
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
  const banner = document.createElement('button');
  banner.className = 'update-banner';
  banner.textContent = 'New version ready. Tap to reload.';
  banner.addEventListener('click', () => {
    if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });
    location.reload();
  });
  document.body.appendChild(banner);
}

/* ── Init ── */
render();
