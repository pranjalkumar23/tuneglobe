const API_BASE = 'https://de1.api.radio-browser.info/json/stations/search';
const FAVORITES_KEY = 'radioatlas.favorites';
const THEME_KEY = 'radioatlas.theme';
const btnTheme = document.getElementById('btn-theme');

const audio = document.getElementById('audio');
const statusBadge = document.getElementById('status-badge');
const searchInput = document.getElementById('search-input');
const searchClear = document.getElementById('search-clear');
const countryFilter = document.getElementById('filter-country');
const genreFilter = document.getElementById('filter-genre');
const sidePanel = document.getElementById('side-panel');
const panelTitle = document.getElementById('panel-title');
const panelBody = document.getElementById('panel-body');
const panelClose = document.getElementById('panel-close');

const npName = document.getElementById('np-name');
const npSub = document.getElementById('np-sub');
const btnPlay = document.getElementById('btn-play');
const btnPrev = document.getElementById('btn-prev');
const btnNext = document.getElementById('btn-next');
const btnMute = document.getElementById('btn-mute');
const btnFav = document.getElementById('btn-fav');
const volumeSlider = document.getElementById('volume');

let allStations = [];
let filteredStations = [];
let markers = [];
let currentStation = null;
let currentIndex = -1;
let isPlaying = false;

// 'radio' while a station plays, 'podcast' while a podcast episode plays —
// changes what prev/next/favorite do and what the player bar shows.
let nowPlayingType = 'radio';
let currentEpisode = null; // { title, showName, audioUrl, artwork }
let currentEpisodeList = []; // episodes of the show currently open, for prev/next
let currentEpisodeIndex = -1;

function getFavorites() {
  try { return JSON.parse(localStorage.getItem(FAVORITES_KEY)) || []; }
  catch { return []; }
}
function saveFavorites(list) {
  localStorage.setItem(FAVORITES_KEY, JSON.stringify(list));
}
function isFavorite(stationId) {
  return getFavorites().some(s => s.stationuuid === stationId);
}
const FREE_FAVORITES_LIMIT = 5;
function isPremiumUser() {
  return Boolean(window.TuneGlobe?.Auth?.isPremium());
}
// Returns false (and prompts to upgrade) if a free user is already at the
// favorites cap and is trying to add a new one — removing an existing
// favorite is always allowed regardless of plan.
function toggleFavorite(station) {
  const favs = getFavorites();
  const idx = favs.findIndex(s => s.stationuuid === station.stationuuid);
  if (idx >= 0) {
    favs.splice(idx, 1);
    saveFavorites(favs);
    return true;
  }
  if (!isPremiumUser() && favs.length >= FREE_FAVORITES_LIMIT) {
    window.TuneGlobe?.Auth?.openPremiumModal();
    return false;
  }
  favs.push(station);
  saveFavorites(favs);
  return true;
}

const map = new maplibregl.Map({
  container: 'map',
  style: 'https://tiles.openfreemap.org/styles/bright',
  center: [10, 30],
  zoom: 1.5,
  projection: { type: 'globe' },
  dragRotate: true,
  pitchWithRotate: true,
});
map.addControl(new maplibregl.NavigationControl(), 'bottom-right');
map.on('load', () => {
  if (map.setProjection) map.setProjection({ type: 'globe' });
  addShadedRelief();
});
map.once('idle', () => {
  captureOriginalPaint();
  applyMapTheme(getTheme());
});
map.on('move', updateMarkerVisibility);

// "bright" ships without the low-zoom shaded-relief raster that "liberty"
// has (source id "ne2_shaded", already present in bright's sources even
// though no layer uses it) — a flat vector fill color reads as a cartoon
// disc at world zoom. Layering the real Natural Earth II shaded-relief
// image underneath the water/landcover fills gives the continents actual
// terrain texture (forests, deserts, ice caps) instead of one flat green.
function addShadedRelief() {
  if (map.getLayer('natural-earth-shaded')) return;
  map.addLayer({
    id: 'natural-earth-shaded',
    type: 'raster',
    source: 'ne2_shaded',
    maxzoom: 7,
    paint: {
      'raster-opacity': ['interpolate', ['exponential', 1.5], ['zoom'], 0, 0.85, 6, 0.15],
    },
  }, 'water');
}

map.on('load', loadStations);

// The "bright" basemap already ships true earth colors (blue ocean, green/
// tan land) for the light theme, so light mode just restores those native
// paint values. Dark mode recolors the same layers to a deep-navy/forest
// palette that keeps the same hues (blue water, green land) instead of
// turning everything grayscale. Layer ids come from openfreemap's "bright"
// style, which differs slightly from "positron"/"liberty" (hyphens, extra
// landcover/landuse layers).
const DARK_FILLS = {
  background: '#16241a',
  water: '#0a2338',
  'water-intermittent': '#0a2338',
  park: '#1b3320',
  'landcover-wood': '#132318',
  'landcover-grass': '#1a3020',
  'landcover-grass-park': '#1a3020',
  'landcover-ice-shelf': '#33414a',
  'landcover-glacier': '#33414a',
  'landcover-sand': '#3a3423',
  'landuse-residential': '#1c2a1f',
  'landuse-suburb': '#1c2a1f',
  'landuse-commercial': '#1c2a1f',
  'landuse-industrial': '#1c2a1f',
  'landuse-cemetery': '#1c2a1f',
  'landuse-hospital': '#1c2a1f',
  'landuse-school': '#1c2a1f',
  'landuse-railway': '#1c2a1f',
  building: '#20301f',
  'building-top': '#20301f',
  'aeroway-area': '#1c2a1f',
  'highway-area': '#1c2a1f',
  road_area_pier: '#1c2a1f',
};
const originalPaint = {};

function captureOriginalPaint() {
  const style = map.getStyle();
  for (const layer of style.layers) {
    const props = {};
    if (layer.type === 'background') props['background-color'] = map.getPaintProperty(layer.id, 'background-color');
    if (layer.type === 'fill') props['fill-color'] = map.getPaintProperty(layer.id, 'fill-color');
    if (layer.type === 'line') props['line-color'] = map.getPaintProperty(layer.id, 'line-color');
    if (layer.type === 'symbol') {
      props['text-color'] = map.getPaintProperty(layer.id, 'text-color');
      props['text-halo-color'] = map.getPaintProperty(layer.id, 'text-halo-color');
    }
    if (layer.type === 'raster') {
      props['raster-brightness-max'] = map.getPaintProperty(layer.id, 'raster-brightness-max') ?? 1;
      props['raster-saturation'] = map.getPaintProperty(layer.id, 'raster-saturation') ?? 0;
    }
    originalPaint[layer.id] = props;
  }
}

function applyMapTheme(theme) {
  const style = map.getStyle();
  for (const layer of style.layers) {
    if (theme === 'light') {
      for (const [prop, value] of Object.entries(originalPaint[layer.id] || {})) {
        map.setPaintProperty(layer.id, prop, value);
      }
      continue;
    }
    if (layer.id in DARK_FILLS) {
      map.setPaintProperty(layer.id, layer.type === 'fill' ? 'fill-color' : 'background-color', DARK_FILLS[layer.id]);
    } else if (layer.type === 'line') {
      map.setPaintProperty(layer.id, 'line-color', '#3a4a3d');
    } else if (layer.type === 'symbol') {
      map.setPaintProperty(layer.id, 'text-color', '#cfd8ce');
      map.setPaintProperty(layer.id, 'text-halo-color', '#16241a');
    } else if (layer.type === 'raster') {
      map.setPaintProperty(layer.id, 'raster-brightness-max', 0.45);
      map.setPaintProperty(layer.id, 'raster-saturation', -0.2);
    }
  }
  applySky(theme);
  map.triggerRepaint();
}

// Atmosphere halo around the globe's limb, plus the flat backdrop beyond
// it — kept the same color as the page background so the app frame and
// map read as one surface, with just a thin realistic blue glow at the
// horizon (fades out once the globe morphs into flat mercator).
function applySky(theme) {
  if (!map.setSky) return;
  const bg = theme === 'dark' ? '#000000' : '#ffffff';
  const horizon = theme === 'dark' ? '#123047' : '#cfe9ff';
  map.setSky({
    'sky-color': bg,
    'sky-horizon-blend': 0.6,
    'horizon-color': horizon,
    'horizon-fog-blend': 0.6,
    'fog-color': bg,
    'fog-ground-blend': 0.6,
    'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 5, 1, 7, 0],
  });
}

function getTheme() {
  return localStorage.getItem(THEME_KEY) || 'dark';
}
function setTheme(theme) {
  localStorage.setItem(THEME_KEY, theme);
  document.documentElement.setAttribute('data-theme', theme);
  btnTheme.textContent = theme === 'dark' ? '🌙' : '☀️';
  if (map.isStyleLoaded()) applyMapTheme(theme);
}
btnTheme.addEventListener('click', () => setTheme(getTheme() === 'dark' ? 'light' : 'dark'));
setTheme(getTheme());

// DOM markers aren't depth-tested against the WebGL globe, so a station on
// the far side of the sphere would otherwise render on top of the near
// side. Hide markers more than ~90 degrees of great-circle distance from
// the current center. This check is applied at every zoom level, not just
// when the whole sphere is visible: maplibre's globe projection stays
// curved well past low zooms (it doesn't fully flatten to mercator until
// much higher), so disabling the check above some cutoff let far-side
// stations bleed through while zoomed into a region. At high zoom the
// visible area is only a few degrees wide, so the ~90 degree threshold
// never triggers and every marker in view is shown as before.
function isFrontFacing(lng, lat) {
  const center = map.getCenter();
  const toRad = Math.PI / 180;
  const phi1 = center.lat * toRad;
  const phi2 = lat * toRad;
  const deltaLambda = (lng - center.lng) * toRad;
  const cosAngle = Math.sin(phi1) * Math.sin(phi2) + Math.cos(phi1) * Math.cos(phi2) * Math.cos(deltaLambda);
  return cosAngle > 0.02;
}
function updateMarkerVisibility() {
  for (const marker of markers) {
    const el = marker.getElement();
    const { lng, lat } = marker.getLngLat();
    el.style.display = isFrontFacing(lng, lat) ? '' : 'none';
  }
}

async function loadStations() {
  statusBadge.textContent = 'Loading stations…';
  try {
    const params = new URLSearchParams({
      has_geo_info: 'true',
      hidebroken: 'true',
      order: 'clickcount',
      reverse: 'true',
      limit: '3000',
    });
    const res = await fetch(`${API_BASE}?${params}`);
    const data = await res.json();
    allStations = data.filter(s => s.geo_lat && s.geo_long && s.url_resolved);
    filteredStations = allStations;
    populateFilters();
    renderMarkers(filteredStations);
    statusBadge.textContent = `${filteredStations.length.toLocaleString()} stations on the map`;
  } catch (err) {
    statusBadge.textContent = 'Could not load stations. Try again shortly.';
    console.error(err);
  }
}

function populateFilters() {
  const countries = [...new Set(allStations.map(s => s.country).filter(Boolean))].sort();
  const genres = [...new Set(allStations.flatMap(s => (s.tags || '').split(',')).map(t => t.trim()).filter(Boolean))]
    .sort()
    .slice(0, 200);

  for (const c of countries) {
    const opt = document.createElement('option');
    opt.value = c; opt.textContent = c;
    countryFilter.appendChild(opt);
  }
  for (const g of genres) {
    const opt = document.createElement('option');
    opt.value = g; opt.textContent = g;
    genreFilter.appendChild(opt);
  }
}

function clearMarkers() {
  markers.forEach(m => m.remove());
  markers = [];
}

function renderMarkers(stations) {
  clearMarkers();
  const capped = stations.slice(0, 1500); // keep the map responsive
  for (const station of capped) {
    const el = document.createElement('div');
    el.className = 'station-marker';
    el.title = station.name.trim();
    if (currentStation && currentStation.stationuuid === station.stationuuid) {
      el.classList.add('playing');
    }
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      playStation(station);
    });
    const marker = new maplibregl.Marker({ element: el })
      .setLngLat([station.geo_long, station.geo_lat])
      .addTo(map);
    markers.push(marker);
  }
  updateMarkerVisibility();
}

// Podcasts have no real geo-coordinates, so — unlike radio stations —
// they were never a great fit for pins on a globe (an earlier version did
// scatter them by iTunes storefront country, but that placement was
// essentially arbitrary and implied a location the podcast doesn't
// actually have). They get a plain searchable, paginated grid instead
// (see showPodcastsView() and renderPodcastGrid() below). Querying
// several countries' storefronts here is still a legitimate way to build
// a large, varied default catalog — it's the *display* as a globe that
// didn't make sense, not the sourcing.
const PODCAST_COUNTRY_CODES = ['us', 'gb', 'in', 'au', 'br', 'de', 'jp', 'ng', 'ca', 'fr', 'mx', 'za', 'kr', 'es'];

async function fetchCuratedPodcastShows() {
  const perCountry = await Promise.all(
    PODCAST_COUNTRY_CODES.map(async (code) => {
      try {
        const params = new URLSearchParams({ media: 'podcast', term: 'podcast', country: code, limit: '20' });
        const res = await fetch(`${PODCAST_SEARCH_API}?${params}`);
        const data = await res.json();
        return (data.results || [])
          .filter(p => p.feedUrl)
          .map(p => ({
            id: p.collectionId,
            name: decodeHtmlEntities(p.collectionName),
            artist: decodeHtmlEntities(p.artistName),
            feedUrl: p.feedUrl,
            artwork: p.artworkUrl60,
          }));
      } catch (err) {
        console.error('Podcast fetch failed for', code, err);
        return [];
      }
    })
  );
  const seen = new Set();
  const shows = [];
  for (const show of perCountry.flat()) {
    if (seen.has(show.id)) continue;
    seen.add(show.id);
    shows.push(show);
  }
  return shows;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// RSS feeds (via rss2json) commonly hand back titles with literal HTML
// entities like "&amp;" instead of "&" — decode those before re-escaping
// for display, otherwise users see "&amp;" on screen.
function decodeHtmlEntities(str) {
  if (!str) return str;
  const textarea = document.createElement('textarea');
  textarea.innerHTML = str;
  return textarea.value;
}

function playStation(station) {
  nowPlayingType = 'radio';
  currentEpisode = null;
  currentStation = station;
  currentIndex = filteredStations.findIndex(s => s.stationuuid === station.stationuuid);
  audio.src = station.url_resolved;
  audio.play().catch(() => {});
  updateNowPlaying();
  renderMarkers(filteredStations);
}

function playEpisode(episode, show, episodeList, episodeIndex) {
  nowPlayingType = 'podcast';
  currentStation = null;
  currentEpisode = { ...episode, showName: show.name };
  currentEpisodeList = episodeList;
  currentEpisodeIndex = episodeIndex;
  audio.src = episode.audioUrl;
  audio.play().catch(() => {});
  updateNowPlaying();
}

function updateNowPlaying() {
  if (nowPlayingType === 'podcast' && currentEpisode) {
    npName.textContent = currentEpisode.title;
    npSub.textContent = currentEpisode.showName;
    btnFav.classList.remove('active');
    btnFav.textContent = '♡';
    btnFav.disabled = true;
    btnFav.title = 'Favorites are for radio stations only, for now';
    return;
  }
  btnFav.disabled = false;
  btnFav.title = 'Favorite';
  if (!currentStation) {
    npName.textContent = 'Choose a station';
    npSub.textContent = 'Click a pin on the map to start listening';
    btnFav.classList.remove('active');
    btnFav.textContent = '♡';
    return;
  }
  npName.textContent = currentStation.name.trim();
  npSub.textContent = [currentStation.country, currentStation.tags].filter(Boolean).join(' · ');
  const fav = isFavorite(currentStation.stationuuid);
  btnFav.classList.toggle('active', fav);
  btnFav.textContent = fav ? '♥' : '♡';
}

btnPlay.addEventListener('click', () => {
  if (!currentStation && !currentEpisode) return;
  if (audio.paused) audio.play().catch(() => {});
  else audio.pause();
});
audio.addEventListener('play', () => { isPlaying = true; btnPlay.textContent = '⏸'; });
audio.addEventListener('pause', () => { isPlaying = false; btnPlay.textContent = '▶'; });

btnPrev.addEventListener('click', () => stepStation(-1));
btnNext.addEventListener('click', () => stepStation(1));
function stepStation(delta) {
  if (nowPlayingType === 'podcast') {
    stepEpisode(delta);
    return;
  }
  if (!filteredStations.length) return;
  const nextIndex = ((currentIndex + delta) % filteredStations.length + filteredStations.length) % filteredStations.length;
  playStation(filteredStations[nextIndex]);
  map.flyTo({ center: [filteredStations[nextIndex].geo_long, filteredStations[nextIndex].geo_lat], zoom: Math.max(map.getZoom(), 4) });
}
function stepEpisode(delta) {
  if (!currentEpisodeList.length) return;
  const nextIndex = ((currentEpisodeIndex + delta) % currentEpisodeList.length + currentEpisodeList.length) % currentEpisodeList.length;
  playEpisode(currentEpisodeList[nextIndex], { name: currentEpisode.showName }, currentEpisodeList, nextIndex);
}

btnMute.addEventListener('click', () => {
  audio.muted = !audio.muted;
  btnMute.textContent = audio.muted ? '🔇' : '🔊';
});
volumeSlider.addEventListener('input', () => { audio.volume = Number(volumeSlider.value); });
audio.volume = Number(volumeSlider.value);

btnFav.addEventListener('click', () => {
  if (!currentStation) return;
  toggleFavorite(currentStation);
  updateNowPlaying();
});

let searchDebounce = null;
searchInput.addEventListener('input', () => {
  searchClear.style.display = searchInput.value ? 'block' : 'none';
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(applyFilters, 200);
});
searchClear.addEventListener('click', () => {
  searchInput.value = '';
  searchClear.style.display = 'none';
  applyFilters();
});
countryFilter.addEventListener('change', applyFilters);
genreFilter.addEventListener('change', applyFilters);

function applyFilters() {
  const q = searchInput.value.trim().toLowerCase();
  const country = countryFilter.value;
  const genre = genreFilter.value;
  filteredStations = allStations.filter(s => {
    if (country && s.country !== country) return false;
    if (genre && !(s.tags || '').toLowerCase().includes(genre.toLowerCase())) return false;
    if (q) {
      const hay = `${s.name} ${s.country} ${s.tags}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  renderMarkers(filteredStations);
  statusBadge.textContent = `${filteredStations.length.toLocaleString()} stations on the map`;
}

// Side nav: Explore / Favorites / List
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const view = btn.dataset.view;
    if (view !== 'podcasts') hidePodcastsView();
    if (view === 'explore') {
      sidePanel.classList.add('hidden');
    } else if (view === 'favorites') {
      showPanel('Favorites', getFavorites());
    } else if (view === 'list') {
      showPanel('All stations', filteredStations.slice(0, 200));
    } else if (view === 'podcasts') {
      showPodcastsView();
    }
  });
});

const podcastGridView = document.getElementById('podcast-grid-view');
const mapEl = document.getElementById('map');

// The curated (by-country) set is the default; a text search temporarily
// replaces it as the "active" list driving the grid, and clearing the
// search restores the curated set. Kept separate
// so we don't have to re-fetch the curated list every time search clears.
let curatedPodcastShows = [];
let activePodcastShows = [];
const GRID_PAGE_SIZE = 24;
let gridPage = 0;

// The podcast grid occupies the same layout slot #map does (grid-area:
// map) and simply replaces it while the Podcasts tab is active — there's
// no globe/grid choice to make since podcasts have no geography to plot.
function showPodcastsView() {
  showPodcastSearchPanel();
  podcastGridView.classList.remove('hidden');
  mapEl.classList.add('hidden');
  if (lastPodcastResults.length) {
    // Reopening the tab with an active search — restore immediately
    // rather than waiting on a fresh curated-list fetch.
    setActivePodcastShows(lastPodcastResults);
  } else {
    statusBadge.textContent = 'Loading podcasts…';
  }
  fetchCuratedPodcastShows().then(shows => {
    curatedPodcastShows = shows;
    if (!lastPodcastResults.length) setActivePodcastShows(shows);
  });
}

// MapLibre's canvas may have been display:none while the grid was
// showing, which leaves its internal size cache stale — resize it when
// it becomes visible again.
function hidePodcastsView() {
  podcastGridView.classList.add('hidden');
  mapEl.classList.remove('hidden');
  map.resize();
  statusBadge.textContent = `${filteredStations.length.toLocaleString()} stations on the map`;
}

function setActivePodcastShows(shows) {
  activePodcastShows = shows;
  gridPage = 0;
  statusBadge.textContent = `${shows.length} podcasts`;
  renderPodcastGrid();
}

const podcastGridPrev = document.getElementById('podcast-grid-prev');
const podcastGridNext = document.getElementById('podcast-grid-next');
const podcastGridPageLabel = document.getElementById('podcast-grid-page-label');
podcastGridPrev.addEventListener('click', () => { gridPage--; renderPodcastGrid(); });
podcastGridNext.addEventListener('click', () => { gridPage++; renderPodcastGrid(); });

function renderPodcastGrid() {
  const grid = document.getElementById('podcast-grid-body');
  const shows = activePodcastShows;
  if (!shows.length) {
    grid.innerHTML = `<div class="empty-note">Still loading podcasts — try again in a moment.</div>`;
    podcastGridPrev.disabled = true;
    podcastGridNext.disabled = true;
    podcastGridPageLabel.textContent = '';
    return;
  }
  const totalPages = Math.max(1, Math.ceil(shows.length / GRID_PAGE_SIZE));
  gridPage = Math.min(Math.max(gridPage, 0), totalPages - 1);
  const pageShows = shows.slice(gridPage * GRID_PAGE_SIZE, (gridPage + 1) * GRID_PAGE_SIZE);

  grid.innerHTML = '';
  for (const show of pageShows) {
    const card = document.createElement('div');
    card.className = 'podcast-card';
    card.innerHTML = `
      <img src="${escapeHtml(show.artwork || '')}" alt="" width="60" height="60" />
      <div class="podcast-card-name">${escapeHtml(show.name || 'Untitled')}</div>
      <div class="podcast-card-artist">${escapeHtml(show.artist || '')}</div>
    `;
    card.addEventListener('click', () => openEpisodesDialog(show));
    grid.appendChild(card);
  }
  podcastGridPrev.disabled = gridPage === 0;
  podcastGridNext.disabled = gridPage >= totalPages - 1;
  podcastGridPageLabel.textContent = `Page ${gridPage + 1} of ${totalPages}`;
}

panelClose.addEventListener('click', () => {
  sidePanel.classList.add('hidden');
  document.querySelector('.nav-btn[data-view="explore"]').classList.add('active');
  document.querySelectorAll('.nav-btn').forEach(b => {
    if (b.dataset.view !== 'explore') b.classList.remove('active');
  });
});

function showPanel(title, stations) {
  panelTitle.textContent = title;
  panelBody.innerHTML = '';
  if (title === 'Favorites' && !isPremiumUser()) {
    const note = document.createElement('div');
    note.className = 'favorites-limit-note';
    note.innerHTML = `${stations.length}/${FREE_FAVORITES_LIMIT} free favorites used · <button type="button" id="favorites-upgrade-link">Upgrade for unlimited</button>`;
    panelBody.appendChild(note);
    note.querySelector('#favorites-upgrade-link').addEventListener('click', () => window.TuneGlobe?.Auth?.openPremiumModal());
  }
  if (!stations.length) {
    panelBody.insertAdjacentHTML('beforeend', `<div class="empty-note">No stations here yet.</div>`);
  } else {
    for (const s of stations) {
      const row = document.createElement('div');
      row.className = 'station-row';
      row.innerHTML = `
        <div>
          <div class="row-name">${escapeHtml(s.name.trim())}</div>
          <div class="row-sub">${escapeHtml(s.country || '')}</div>
        </div>
        <button class="row-fav" type="button">${isFavorite(s.stationuuid) ? '♥' : '♡'}</button>
      `;
      row.addEventListener('click', (e) => {
        if (e.target.closest('.row-fav')) return;
        playStation(s);
        map.flyTo({ center: [s.geo_long, s.geo_lat], zoom: Math.max(map.getZoom(), 5) });
      });
      row.querySelector('.row-fav').addEventListener('click', () => {
        toggleFavorite(s);
        showPanel(title, title === 'Favorites' ? getFavorites() : stations);
        updateNowPlaying();
      });
      panelBody.appendChild(row);
    }
  }
  sidePanel.classList.remove('hidden');
}

// --- Podcasts -------------------------------------------------------------
// This panel is a secondary way in — search by name — for when the show
// you want isn't one of the curated picks already filling the grid. Show
// metadata comes from Apple's free iTunes Search API; episode audio URLs
// have to be pulled from each show's own RSS feed (see fetchPodcastEpisodes
// below for how that's fetched).
const PODCAST_SEARCH_API = 'https://itunes.apple.com/search';
const PODCAST_FEED_API = 'https://api.rss2json.com/v1/api.json';
let lastPodcastResults = [];
let lastPodcastSearchQuery = '';

function showPodcastSearchPanel() {
  panelTitle.textContent = 'Podcasts';
  panelBody.innerHTML = `
    <div class="empty-note">🎙️ Browse the grid, or search below.</div>
    <div class="podcast-search">
      <input id="podcast-search-input" type="search" placeholder="Search podcasts…" />
    </div>
    <div id="podcast-results"></div>
  `;
  sidePanel.classList.remove('hidden');
  const input = document.getElementById('podcast-search-input');
  const results = document.getElementById('podcast-results');
  if (lastPodcastResults.length) {
    renderPodcastResults(lastPodcastResults, results);
    input.value = lastPodcastSearchQuery;
  }
  let debounce = null;
  input.addEventListener('input', () => {
    clearTimeout(debounce);
    const q = input.value.trim();
    if (!q) {
      results.innerHTML = '';
      lastPodcastResults = [];
      lastPodcastSearchQuery = '';
      setActivePodcastShows(curatedPodcastShows);
      return;
    }
    debounce = setTimeout(() => searchPodcasts(q, results), 300);
  });
  input.focus();
}

// Search drives both surfaces at once: the panel's own results list (for
// quickly jumping straight to episodes) and the paginated grid — so
// searching feels like it's actually filtering what you're browsing, not
// just adding a side list next to it.
async function searchPodcasts(query, resultsEl) {
  resultsEl.innerHTML = `<div class="empty-note">Searching…</div>`;
  lastPodcastSearchQuery = query;
  try {
    const params = new URLSearchParams({ media: 'podcast', limit: '50', term: query });
    const res = await fetch(`${PODCAST_SEARCH_API}?${params}`);
    const data = await res.json();
    const shows = (data.results || []).map(p => ({
      id: p.collectionId,
      name: decodeHtmlEntities(p.collectionName),
      artist: decodeHtmlEntities(p.artistName),
      feedUrl: p.feedUrl,
      artwork: p.artworkUrl60,
    })).filter(s => s.feedUrl);
    lastPodcastResults = shows;
    renderPodcastResults(shows, resultsEl);
    setActivePodcastShows(shows);
  } catch (err) {
    console.error(err);
    resultsEl.innerHTML = `<div class="empty-note">Could not search podcasts. Try again shortly.</div>`;
  }
}

function renderPodcastResults(shows, resultsEl) {
  if (!shows.length) {
    resultsEl.innerHTML = `<div class="empty-note">No podcasts found.</div>`;
    return;
  }
  resultsEl.innerHTML = '';
  for (const show of shows) {
    const row = document.createElement('div');
    row.className = 'podcast-row';
    row.innerHTML = `
      <img src="${escapeHtml(show.artwork || '')}" alt="" width="40" height="40" />
      <div>
        <div class="row-name">${escapeHtml(show.name || 'Untitled')}</div>
        <div class="row-sub">${escapeHtml(show.artist || '')}</div>
      </div>
    `;
    row.addEventListener('click', () => openPodcastShow(show));
    resultsEl.appendChild(row);
  }
}

// Most podcast hosts actually do allow cross-origin fetches of their own
// RSS feed (it's meant to be fetched by any podcast app), so try parsing
// the XML directly in the browser first — no proxy, no rate limit, no
// dependency on a third party being up. rss2json is only a fallback for
// the minority of feeds that don't set CORS headers; it's what used to be
// the *only* path here, but its free anonymous tier rate-limits almost
// immediately ("You are converting new feeds in a very short period"),
// which is why episodes so often failed to load — most podcasts were
// hitting that limit, not actually broken.
async function fetchPodcastEpisodes(show) {
  try {
    const episodes = await fetchPodcastEpisodesDirect(show.feedUrl);
    if (episodes.length) return episodes;
    throw new Error('no items found via direct parse');
  } catch (err) {
    console.warn('Direct feed fetch/parse failed, falling back to rss2json:', err.message);
    return fetchPodcastEpisodesViaProxy(show.feedUrl);
  }
}

async function fetchPodcastEpisodesDirect(feedUrl) {
  const res = await fetch(feedUrl);
  if (!res.ok) throw new Error(`feed responded ${res.status}`);
  const text = await res.text();
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('feed XML failed to parse');
  const channelImage = doc.querySelector('channel > image > url')?.textContent
    || doc.querySelector('channel')?.getElementsByTagName('itunes:image')[0]?.getAttribute('href');
  return [...doc.querySelectorAll('item')]
    .map(item => {
      const audioUrl = item.querySelector('enclosure')?.getAttribute('url');
      if (!audioUrl) return null;
      const image = item.getElementsByTagName('itunes:image')[0]?.getAttribute('href');
      return {
        title: decodeHtmlEntities(item.querySelector('title')?.textContent || ''),
        audioUrl,
        pubDate: item.querySelector('pubDate')?.textContent || '',
        artwork: image || channelImage,
      };
    })
    .filter(Boolean);
}

async function fetchPodcastEpisodesViaProxy(feedUrl) {
  const params = new URLSearchParams({ rss_url: feedUrl });
  const res = await fetch(`${PODCAST_FEED_API}?${params}`);
  const data = await res.json();
  if (data.status !== 'ok') throw new Error(data.message || 'feed error');
  return (data.items || [])
    .filter(item => item.enclosure && item.enclosure.link)
    .map(item => ({
      title: decodeHtmlEntities(item.title),
      audioUrl: item.enclosure.link,
      pubDate: item.pubDate,
      artwork: item.enclosure.image || data.feed?.image,
    }));
}

async function openPodcastShow(show) {
  panelTitle.textContent = show.name;
  panelBody.innerHTML = `<div class="empty-note">Loading episodes…</div>`;
  try {
    const episodes = await fetchPodcastEpisodes(show);
    showPodcastEpisodesPanel(show, episodes);
  } catch (err) {
    console.error(err);
    panelBody.innerHTML = `<div class="empty-note">Could not load episodes for this show. Try another one.</div>`;
  }
}

function showPodcastEpisodesPanel(show, episodes) {
  panelTitle.textContent = show.name;
  panelBody.innerHTML = '';
  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'podcast-back';
  back.textContent = '← Back to search';
  back.addEventListener('click', () => showPodcastSearchPanel());
  panelBody.appendChild(back);

  if (!episodes.length) {
    panelBody.insertAdjacentHTML('beforeend', `<div class="empty-note">No playable episodes found.</div>`);
    return;
  }
  episodes.forEach((ep, i) => {
    const row = document.createElement('div');
    row.className = 'station-row';
    row.innerHTML = `
      <div>
        <div class="row-name">${escapeHtml(ep.title || 'Untitled episode')}</div>
        <div class="row-sub">${escapeHtml(ep.pubDate || '')}</div>
      </div>
    `;
    row.addEventListener('click', () => playEpisode(ep, show, episodes, i));
    panelBody.appendChild(row);
  });
}

// Opening episodes from a grid card uses a modal dialog rather than the
// side panel (which the search results list uses), so the user doesn't
// lose their place in the grid underneath.
const episodesModal = document.getElementById('episodes-modal');
const episodesModalTitle = document.getElementById('episodes-modal-title');
const episodesModalBody = document.getElementById('episodes-modal-body');

async function openEpisodesDialog(show) {
  episodesModalTitle.textContent = show.name;
  episodesModalBody.innerHTML = `<div class="empty-note">Loading episodes…</div>`;
  episodesModal.classList.remove('hidden');
  try {
    const episodes = await fetchPodcastEpisodes(show);
    renderEpisodesDialogList(show, episodes);
  } catch (err) {
    console.error(err);
    episodesModalBody.innerHTML = `<div class="empty-note">Could not load episodes for this show. Try another one.</div>`;
  }
}

function renderEpisodesDialogList(show, episodes) {
  if (!episodes.length) {
    episodesModalBody.innerHTML = `<div class="empty-note">No playable episodes found.</div>`;
    return;
  }
  episodesModalBody.innerHTML = '';
  episodes.forEach((ep, i) => {
    const row = document.createElement('div');
    row.className = 'station-row';
    row.innerHTML = `
      <div>
        <div class="row-name">${escapeHtml(ep.title || 'Untitled episode')}</div>
        <div class="row-sub">${escapeHtml(ep.pubDate || '')}</div>
      </div>
    `;
    row.addEventListener('click', () => {
      playEpisode(ep, show, episodes, i);
      closeEpisodesDialog();
    });
    episodesModalBody.appendChild(row);
  });
}
function closeEpisodesDialog() {
  episodesModal.classList.add('hidden');
}
document.getElementById('episodes-modal-close')?.addEventListener('click', closeEpisodesDialog);
episodesModal?.addEventListener('click', (e) => { if (e.target === episodesModal) closeEpisodesDialog(); });

window.addEventListener('tuneglobe:subscription-changed', () => {
  if (!sidePanel.classList.contains('hidden') && panelTitle.textContent === 'Favorites') {
    showPanel('Favorites', getFavorites());
  }
});

updateNowPlaying();
