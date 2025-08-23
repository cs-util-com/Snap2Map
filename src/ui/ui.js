/**
 * @file src/ui/ui.js
 * @description Manages all UI components and user interactions.
 */

import { processAndDisplayImage } from '../util/image.js';
import { exportAllData, importData } from '../util/bundle.js';
import { enableMarkerPlacement, disableMarkerPlacement, clearTemporaryMarkers, displayImageOnMap, updateUserPosition } from '../leaflet/map.js';
import { savePair, getPairsForMap, getBlob, getAllMaps, getMap } from '../data/db.js';
import * as pairState from '../calib/pairState.js';
import { getCurrentPosition, startWatchingPosition } from '../gps/gps.js';
import { CalibrationModel } from '../calib/model.js';

const MAP_MANAGER_ID = 'map-manager-view';
const PAIR_MODE_BAR_ID = 'pair-mode-bar';
const TPS_DRAWER_ID = 'tps-drawer';

const appState = {
  isPairModeActive: false,
  activeView: 'photo',
  currentMapId: null,
  map: null,
  model: null,
  bannerTimeout: null,
};

export function setCurrentMap(mapId) {
  appState.currentMapId = mapId;
}

export function showBanner(message, level = 'info', duration = 4000) {
  const banner = document.getElementById('global-banner');
  const messageEl = document.getElementById('global-banner-message');
  if (!banner || !messageEl) return;
  clearTimeout(appState.bannerTimeout);
  const colors = { info: 'bg-blue-500', warning: 'bg-orange-500', error: 'bg-red-600' };
  banner.className = `absolute top-12 left-0 right-0 z-[1002] p-2 text-center text-white transition-opacity duration-300 ${colors[level] || colors.info}`;
  messageEl.textContent = message;
  banner.classList.remove('hidden', 'opacity-0');
  appState.bannerTimeout = setTimeout(() => {
    banner.classList.add('opacity-0');
    setTimeout(() => banner.classList.add('hidden'), 300);
  }, duration);
}

export async function showMapManager() {
  const mainContent = document.getElementById('main-content');
  if (!mainContent) return;
  hideMapManager();
  const maps = await getAllMaps();
  let managerHTML;
  if (maps.length === 0) {
    managerHTML = `<div id="${MAP_MANAGER_ID}" class="absolute inset-0 bg-gray-50 z-20 flex flex-col items-center justify-center p-8 text-center"><h2 class="text-2xl font-bold text-gray-800 mb-4">No Maps Found</h2><p class="text-gray-600 mb-6">Import a map photo to get started.</p><button id="import-photo-btn" class="bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-6 rounded-lg shadow-lg">Import First Map</button></div>`;
  } else {
    managerHTML = `<div id="${MAP_MANAGER_ID}" class="absolute inset-0 bg-gray-50 z-20 overflow-y-auto p-4"><h2 class="text-2xl font-bold text-gray-800 mb-4 text-center">Your Maps</h2><div id="map-card-list" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">${maps.map(m => `<div class="map-card bg-white rounded-lg shadow-md overflow-hidden cursor-pointer" data-map-id="${m.id}"><img src="" alt="Map thumbnail" class="h-40 w-full object-cover bg-gray-200" data-blob-id="${m.photoBlobId}"><div class="p-4"><h3 class="font-bold text-lg">${m.name}</h3></div></div>`).join('')}</div><div class="text-center mt-6 space-x-2"><button id="import-another-btn" class="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-lg">Import New</button><button id="import-bundle-btn" class="bg-purple-600 hover:bg-purple-700 text-white font-bold py-2 px-4 rounded-lg">Import Bundle</button><button id="export-all-btn" class="bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded-lg">Export All</button></div></div>`;
  }
  mainContent.insertAdjacentHTML('beforeend', managerHTML);
  document.getElementById('import-photo-btn')?.addEventListener('click', () => document.getElementById('image-input').click());
  document.getElementById('import-another-btn')?.addEventListener('click', () => document.getElementById('image-input').click());
  document.getElementById('export-all-btn')?.addEventListener('click', exportAllData);
  document.getElementById('import-bundle-btn')?.addEventListener('click', () => document.getElementById('bundle-input').click());
  document.querySelectorAll('.map-card').forEach(card => {
    card.addEventListener('click', () => loadAndDisplayMap(card.dataset.mapId));
    const img = card.querySelector('img');
    getBlob(img.dataset.blobId).then(blobData => { if (blobData?.bytes) img.src = URL.createObjectURL(blobData.bytes); });
  });
}

export function hideMapManager() {
  const managerView = document.getElementById(MAP_MANAGER_ID);
  if (managerView) managerView.remove();
}

async function loadAndDisplayMap(mapId) {
  try {
    const mapData = await getMap(mapId);
    const pairs = await getPairsForMap(mapId);
    const blobData = await getBlob(mapData.photoBlobId);
    const imageUrl = URL.createObjectURL(blobData.bytes);
    displayImageOnMap(appState.map, imageUrl, mapData.pixelSize);
    appState.currentMapId = mapId;
    appState.model = new CalibrationModel();
    if (mapData.enuOrigin) appState.model.enuOrigin = mapData.enuOrigin;
    pairs.forEach(p => appState.model.addPair(p));
    if (appState.model.fit()) {
      startGpsUpdates();
      document.getElementById('tab-refine').disabled = false;
      document.getElementById('tab-refine').classList.remove('opacity-50', 'cursor-not-allowed');
    }
    hideMapManager();
    setFabVisible(true);
    setMapTabsEnabled(true);
  } catch (error) { console.error("Failed to load map:", error); }
}

function startGpsUpdates() {
    startWatchingPosition(
        (position) => {
          const { latitude, longitude, accuracy } = position.coords;
          const pixel = appState.model.projectLatLonToPixel({ lat: latitude, lon: longitude });
          if (!pixel) return;
          const mapRmse = appState.model.rmse || 0;
          const totalAccuracy = Math.sqrt(accuracy**2 + mapRmse**2);
          const scale = appState.model.getScale();
          if (!scale) return;
          const radiusInPixels = totalAccuracy * scale;
          let color = totalAccuracy <= 15 ? 'green' : totalAccuracy <= 30 ? 'yellow' : 'orange';
          updateUserPosition(appState.map, pixel, radiusInPixels, color);
          if (totalAccuracy > 30) showBanner("Accuracy low. Consider adding more points.", "warning");
        },
        (error) => showBanner(`GPS Error: ${error.message}`, 'error')
    );
}

export function setMapTabsEnabled(enabled) {
  document.getElementById('tab-photo').disabled = !enabled;
  document.getElementById('tab-osm').disabled = !enabled;
}
export function setFabVisible(visible) {
  document.getElementById('add-pair-fab').classList.toggle('hidden', !visible);
}

function enterPairMode() {
  if (appState.isPairModeActive) return;
  appState.isPairModeActive = true;
  const header = document.querySelector('header');
  if (header) {
    const barHTML = `<div id="${PAIR_MODE_BAR_ID}" class="bg-amber-500 text-white p-2 text-center relative h-12 flex items-center justify-center"><button id="cancel-pair-mode" class="absolute left-4 text-2xl leading-none">&larr;</button><p class="font-bold">Pair Mode</p><button id="use-my-position" class="absolute right-16 bg-blue-500 p-2 rounded">My Pos</button><button id="confirm-pair" class="absolute right-4 text-2xl leading-none">&#10003;</button></div>`;
    header.insertAdjacentHTML('afterend', barHTML);
    document.getElementById('cancel-pair-mode').addEventListener('click', exitPairMode);
    document.getElementById('confirm-pair').addEventListener('click', confirmAndSavePair);
    document.getElementById('use-my-position').addEventListener('click', useMyPosition);
  }
  document.getElementById('main-content').classList.add('border-4', 'border-amber-500');
  enableMarkerPlacement(appState.map, appState.activeView);
}

function exitPairMode() {
  if (!appState.isPairModeActive) return;
  appState.isPairModeActive = false;
  const bar = document.getElementById(PAIR_MODE_BAR_ID);
  if (bar) bar.remove();
  clearTemporaryMarkers(appState.map, pairState.getActivePairMarkers());
  pairState.resetActivePair();
  document.getElementById('main-content').classList.remove('border-4', 'border-amber-500');
  disableMarkerPlacement(appState.map);
}

async function confirmAndSavePair() {
  if (!pairState.isPairComplete()) return alert("Pair not complete.");
  if (!appState.currentMapId) return;
  try {
    const pairData = pairState.getActivePairData();
    await savePair(appState.currentMapId, pairData);
    clearTemporaryMarkers(appState.map, pairState.getActivePairMarkers());
    pairState.resetActivePair();
  } catch (error) { console.error("Failed to save pair:", error); }
}

async function useMyPosition() {
    try {
        const pos = await getCurrentPosition();
        const latLng = { lat: pos.coords.latitude, lon: pos.coords.longitude };
        const marker = L.marker(latLng).addTo(appState.map);
        pairState.setWgs84(latLng, marker);
    } catch (error) { showBanner(error.message, 'error'); }
}

function showTpsDrawer() {
  const drawer = document.getElementById(TPS_DRAWER_ID);
  if (!drawer || !appState.model?.transform) return;
  const initialRmse = appState.model.rmse;
  document.getElementById('tps-rmse-before').textContent = initialRmse.toFixed(2);
  document.getElementById('tps-rmse-after').textContent = '--';
  const slider = document.getElementById('tps-slider');
  slider.value = 50;
  const onSliderInput = () => {
    const lambda = Math.pow(10, (slider.value - 50) / 10);
    appState.model.enableTPS(lambda);
    document.getElementById('tps-rmse-after').textContent = appState.model.rmse.toFixed(2);
  };
  const cancel = () => { appState.model.disableTPS(); hideTpsDrawer(); };
  slider.addEventListener('input', onSliderInput);
  document.getElementById('tps-cancel').addEventListener('click', cancel, { once: true });
  document.getElementById('tps-apply').addEventListener('click', hideTpsDrawer, { once: true });
  drawer.classList.remove('hidden');
}

function hideTpsDrawer() {
  const drawer = document.getElementById(TPS_DRAWER_ID);
  if (drawer) drawer.classList.add('hidden');
  const slider = document.getElementById('tps-slider');
  slider.replaceWith(slider.cloneNode(true));
}

function handleTabClick(event) {
    const id = event.currentTarget.id;
    if (id === 'tab-photo' || id === 'tab-osm') {
        appState.activeView = id.replace('tab-', '');
        document.getElementById('use-my-position')?.classList.toggle('hidden', appState.activeView !== 'osm');
    }
}

export function initializeUI(map, model) {
  appState.map = map;
  appState.model = model;
  document.getElementById('image-input').addEventListener('change', (e) => processAndDisplayImage(e.target.files[0], map));
  document.getElementById('bundle-input').addEventListener('change', (e) => importData(e.target.files[0]));
  document.getElementById('add-pair-fab').addEventListener('click', enterPairMode);
  document.querySelectorAll('footer nav button').forEach(tab => tab.addEventListener('click', handleTabClick));
  document.getElementById('tab-refine').addEventListener('click', showTpsDrawer);
  setMapTabsEnabled(false);
  setFabVisible(false);
  document.getElementById('tab-refine').disabled = true;
  document.getElementById('tab-refine').classList.add('opacity-50', 'cursor-not-allowed');
}
