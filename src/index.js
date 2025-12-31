/* istanbul ignore file */
/* global L */
import {
  calibrateMap,
  computeAccuracyRing,
  projectLocationToPixel,
  accuracyRingRadiusPixels,
} from 'snap2map/calibrator';
import {
  formatDistance,
  getMetersPerPixelFromCalibration,
  compareScales,
} from './scale/scale.js';
import {
  createScaleModeState,
  startScaleModeState,
  handleScaleModePoint,
  validateDistanceInput,
  computeReferenceDistanceFromInput,
  cancelScaleModeState,
  canStartMeasureMode,
  createMeasureModeState,
  startMeasureModeState,
  handleMeasureModePoint,
  updateMeasureModePoint,
  computeMeasurement,
  cancelMeasureModeState,
  shouldEnableMeasureButton,
  shouldEnableSetScaleButton,
} from './scale/scale-mode.js';

const GUIDED_PAIR_TARGET = 2;
const MAX_PHOTO_DIMENSION = 2048*2; // pixels

const COLORS = {
  PRIMARY: '#2563eb',    // blue-600
  INLIER: '#16a34a',     // green-600
  OUTLIER: '#dc2626',    // red-600
  SCALE: '#3b82f6',      // blue-500
  REFERENCE: '#10b981',  // emerald-500
  MEASURE: '#8b5cf6',    // violet-500
};

const state = {
  imageDataUrl: null,
  imageSize: null,
  pairs: [],
  calibration: null,
  activePair: null,
  photoMap: null,
  photoOverlay: null,
  photoPairMarkers: [],
  photoActiveMarker: null,
  osmMap: null,
  osmPairMarkers: [],
  osmActiveMarker: null,
  userMarker: null,
  accuracyCircle: null,
  osmLocateControl: null,
  osmLocateHandlersAttached: false,
  geoWatchId: null,
  lastPosition: null,
  lastGpsUpdate: null,
  photoPendingCenter: false,
  osmPendingCenter: false,
  // Prompt geolocation when OSM tab opened the first time
  osmGeoPrompted: false,
  guidedPairing: {
    active: false,
    targetCount: GUIDED_PAIR_TARGET,
    step: null,
    pairsCompleted: 0,
    pendingToast: false,
  },
  // Reference distance for manual scale definition (Phase 2 feature)
  // Structure: { p1: {x, y}, p2: {x, y}, meters: number, metersPerPixel: number }
  referenceDistance: null,
  // User's preferred display unit for distances: 'm' | 'ft' | 'ft-in'
  preferredUnit: 'm',
  // Default rotation for 1-point calibration (in degrees)
  defaultRotation: 0,
  // Scale mode: setting the reference distance line
  scaleMode: {
    logic: createScaleModeState(),
    ui: {
      marker1: null,
      marker2: null,
      line: null,
    },
  },
  // Reference distance visualization (persists after scaleMode is done)
  referenceMarkers: {
    marker1: null,
    marker2: null,
    line: null,
    label: null,
  },
  // Measure mode: measuring arbitrary distances
  measureMode: {
    logic: createMeasureModeState(),
    ui: {
      marker1: null,
      marker2: null,
      line: null,
      label: null,
    },
    pinned: [], // Array of { p1, p2, meters, source, ui: { marker1, marker2, line, label } }
  },
  // One-tap calibration mode (Phase 3 feature)
  oneTapMode: {
    active: false,
  },
};

const dom = {};

function $(id) {
  return document.getElementById(id);
}

function showToast(message, { duration = 4200, tone = 'info' } = {}) {
  if (!dom.toastContainer) {
    return;
  }

  const toneClass =
    tone === 'success'
      ? 'bg-emerald-500/95 text-emerald-950 border border-emerald-300'
      : tone === 'warning'
        ? 'bg-amber-500/95 text-amber-950 border border-amber-300'
        : 'bg-slate-900/95 text-slate-100 border border-slate-700';

  const toast = document.createElement('div');
  toast.className = `pointer-events-none px-4 py-3 rounded-xl shadow-2xl text-sm font-semibold tracking-tight transition-opacity duration-300 ${toneClass}`;
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');
  toast.textContent = message;
  toast.style.opacity = '0';

  dom.toastContainer.appendChild(toast);

  requestAnimationFrame(() => {
    toast.style.opacity = '1';
  });

  const hide = () => {
    toast.style.opacity = '0';
    setTimeout(() => {
      if (toast.parentNode === dom.toastContainer) {
        dom.toastContainer.removeChild(toast);
      }
    }, 320);
  };

  setTimeout(hide, duration);
}

function isGuidedActive() {
  return Boolean(state.guidedPairing && state.guidedPairing.active);
}

function startGuidedPairing() {
  state.guidedPairing.active = true;
  state.guidedPairing.targetCount = GUIDED_PAIR_TARGET;
  state.guidedPairing.step = 'photo';
  state.guidedPairing.pairsCompleted = 0;
  state.guidedPairing.pendingToast = false;
  beginPairMode();
  setActiveView('photo');
  showToast('Tap the first point on your photo.');
}

function stopGuidedPairing(reason = 'complete') {
  if (!isGuidedActive()) {
    return;
  }

  state.guidedPairing.active = false;
  state.guidedPairing.step = null;
  state.guidedPairing.pendingToast = false;
  state.guidedPairing.pairsCompleted = 0;

  if (dom.addPairButton) {
    dom.addPairButton.disabled = false;
  }

  if (reason === 'complete') {
    showToast('Nice! Two reference pairs captured. Add more for better accuracy.', {
      duration: 5200,
      tone: 'success',
    });
  } else if (reason === 'cancelled') {
    showToast('Guided setup cancelled. You can continue adding pairs manually.', {
      tone: 'warning',
    });
  }
}

function maybeAutoCompleteGuidedPair() {
  if (!isGuidedActive() || !state.activePair) {
    return;
  }

  if (state.activePair.pixel && state.activePair.wgs84) {
    state.guidedPairing.pendingToast = true;
    confirmPair();
  }
}

function finalizeMapSelection() {
  const guidedMapStep = isGuidedActive() && state.guidedPairing.step === 'osm';

  if (guidedMapStep) {
    state.guidedPairing.step = 'complete';
  }

  updatePairStatus();

  if (guidedMapStep) {
    maybeAutoCompleteGuidedPair();
  } else if (!isGuidedActive()) {
    showToast('Pair ready — tap "Confirm pair" to save it.');
  }
}

function formatLatLon(value, positive, negative) {
  const direction = value >= 0 ? positive : negative;
  return `${value.toFixed(6)}° ${direction}`;
}

function getRotationLabel(degrees) {
  const labels = {
    0: 'North-up',
    90: 'East-up',
    180: 'South-up',
    270: 'West-up',
  };
  return labels[degrees] || `${degrees}°`;
}

function checkScaleDisagreement() {
  if (!dom.scaleWarning) {
    return;
  }

  if (!state.referenceDistance || !state.calibration || state.calibration.status !== 'ok') {
    dom.scaleWarning.classList.add('hidden');
    return;
  }

  const gpsScale = getMetersPerPixelFromCalibration(state.calibration);
  const manualScale = state.referenceDistance.metersPerPixel;

  const comparison = compareScales(manualScale, gpsScale);

  if (comparison && comparison.differs) {
    const percent = (comparison.percentDifference * 100).toFixed(0);
    dom.scaleWarning.textContent = `⚠️ Scale mismatch: Manual reference (${manualScale.toFixed(4)} m/px) and GPS calibration (${gpsScale.toFixed(4)} m/px) differ by ${percent}%`;
    dom.scaleWarning.classList.remove('hidden');
  } else {
    dom.scaleWarning.classList.add('hidden');
  }
}

function updateNoCalibrationStatus() {
  const minPairs = state.referenceDistance ? 1 : 2;
  dom.calibrationStatus.textContent = minPairs === 1 
    ? 'Add at least one reference pair to calibrate the photo.' 
    : 'Add at least two reference pairs to calibrate the photo.';
  dom.calibrationBadge.textContent = 'No calibration';
  dom.calibrationBadge.className = 'px-2 py-1 rounded text-xs font-semibold bg-gray-200 text-gray-700';
  dom.residualSummary.textContent = '';
  dom.accuracyDetails.textContent = '';
}

function updateActiveCalibrationStatus() {
  const { kind, quality, statusMessage } = state.calibration;
  dom.calibrationStatus.textContent = statusMessage.message;
  dom.calibrationBadge.textContent = kind.toUpperCase();
  const badgeColor = kind === 'homography' ? 'bg-emerald-200 text-emerald-800' : kind === 'affine' ? 'bg-yellow-200 text-yellow-800' : 'bg-orange-200 text-orange-800';
  dom.calibrationBadge.className = `px-2 py-1 rounded text-xs font-semibold ${badgeColor}`;
  dom.residualSummary.textContent = `RMSE ${quality.rmse.toFixed(2)} m · Max residual ${quality.maxResidual.toFixed(2)} m`;

  if (state.lastPosition) {
    const ring = computeAccuracyRing(state.calibration, state.lastPosition.coords.accuracy || 50);
    if (ring) {
      dom.accuracyDetails.textContent = `Combined accuracy ${ring.sigmaTotal.toFixed(1)} m (GPS ${ring.sigmaGps.toFixed(1)} m, Map ${ring.sigmaMap.toFixed(1)} m)`;
    }
  } else {
    dom.accuracyDetails.textContent = '';
  }
}

function updateStatusText() {
  if (!dom.calibrationStatus) {
    return;
  }
  
  checkScaleDisagreement();

  if (!state.calibration || state.calibration.status !== 'ok') {
    updateNoCalibrationStatus();
  } else {
    updateActiveCalibrationStatus();
  }

  updateInstantUsagePromptsVisibility();
  updateMapCursor();
}

function updateMapCursor() {
  const isAnyModeActive = 
    (state.activePair !== null) || 
    (state.scaleMode.logic && state.scaleMode.logic.active) || 
    (state.measureMode.logic && state.measureMode.logic.active) ||
    (state.oneTapMode && state.oneTapMode.active);
    
  if (isAnyModeActive) {
    document.body.classList.add('cursor-crosshair');
  } else {
    document.body.classList.remove('cursor-crosshair');
  }
}

function hideInstantUsagePrompts() {
  if (dom.instantUsagePrompts) {
    dom.instantUsagePrompts.classList.add('hidden');
  }
}

function showInstantUsagePrompts() {
  if (dom.instantUsagePrompts) {
    dom.instantUsagePrompts.classList.remove('hidden');
  }
}

function updateInstantUsagePromptsVisibility() {
  if (!dom.instantUsagePrompts) return;

  const hasScale = !!(state.referenceDistance && state.referenceDistance.metersPerPixel);
  const hasPairs = state.pairs.length > 0;
  const hasTwoPairs = state.pairs.length >= 2;

  if (hasTwoPairs || (hasPairs && hasScale)) {
    hideInstantUsagePrompts();
    return;
  }

  if (state.imageDataUrl) {
    showInstantUsagePrompts();
    
    if (dom.instantSetScaleButton) {
      dom.instantSetScaleButton.classList.toggle('hidden', hasScale);
    }
    if (dom.oneTapCalibrateButton) {
      dom.oneTapCalibrateButton.classList.toggle('hidden', hasPairs);
    }
  } else {
    hideInstantUsagePrompts();
  }
}

function setPhotoImportState(hasImage) {
  if (dom.photoPlaceholder) {
    dom.photoPlaceholder.classList.toggle('hidden', hasImage);
  }
  if (dom.replacePhotoButton) {
    dom.replacePhotoButton.classList.toggle('hidden', !hasImage);
  }
  if (!hasImage) {
    hideInstantUsagePrompts();
  }
}

function clearMarkers(markers) {
  markers.forEach((marker) => marker.remove());
  return [];
}

function refreshPairMarkers() {
  if (!state.photoMap || !state.osmMap) {
    return;
  }

  state.photoPairMarkers = clearMarkers(state.photoPairMarkers);
  state.osmPairMarkers = clearMarkers(state.osmPairMarkers);

  state.pairs.forEach((pair, index) => {
    const residual = state.calibration && state.calibration.residuals ? state.calibration.residuals[index] : null;
    const inlier = state.calibration && state.calibration.inliers ? state.calibration.inliers[index] : false;
    const color = !state.calibration ? COLORS.PRIMARY : inlier ? COLORS.INLIER : COLORS.OUTLIER;
    const label = residual !== null && residual !== undefined ? `${residual.toFixed(1)} m` : '—';

    const photoMarker = L.circleMarker([pair.pixel.y, pair.pixel.x], {
      radius: 6,
      color,
      weight: 2,
      fillOpacity: 0.1,
    }).bindTooltip(`Pair ${index + 1}: ${label}`);
    photoMarker.addTo(state.photoMap);
    state.photoPairMarkers.push(photoMarker);

    const osmMarker = L.circleMarker([pair.wgs84.lat, pair.wgs84.lon], {
      radius: 6,
      color,
      weight: 2,
      fillOpacity: 0.1,
    }).bindTooltip(`Pair ${index + 1}: ${label}`);
    osmMarker.addTo(state.osmMap);
    state.osmPairMarkers.push(osmMarker);
  });
}

function renderPairList() {
  if (!dom.pairTableBody) {
    return;
  }
  dom.pairTableBody.innerHTML = '';

  state.pairs.forEach((pair, index) => {
    const row = document.createElement('tr');
    row.className = index % 2 === 0 ? 'bg-slate-900/40' : 'bg-slate-900/20';
    const residual = state.calibration && state.calibration.residuals ? state.calibration.residuals[index] : null;
    const inlier = state.calibration && state.calibration.inliers ? state.calibration.inliers[index] : false;
    const indicatorClass = !state.calibration ? 'bg-blue-500' : inlier ? 'bg-green-500' : 'bg-red-500';
    const indicator = `<span class="inline-block w-2 h-2 rounded-full ${indicatorClass}"></span>`;

    row.innerHTML = `
      <td class="px-4 py-3 text-sm text-slate-200 space-x-2">${indicator}<span>${pair.pixel.x.toFixed(1)}, ${pair.pixel.y.toFixed(1)}</span></td>
      <td class="px-4 py-3 text-sm text-slate-200">${formatLatLon(pair.wgs84.lat, 'N', 'S')} · ${formatLatLon(pair.wgs84.lon, 'E', 'W')}</td>
      <td class="px-4 py-3 text-sm text-slate-200">${residual !== null && residual !== undefined ? `${residual.toFixed(1)} m` : '—'}</td>
      <td class="px-4 py-3 text-right">
        <button class="text-sm font-semibold text-rose-300 hover:text-rose-200" data-action="delete" data-index="${index}">Remove</button>
      </td>`;

    dom.pairTableBody.appendChild(row);
  });
}

function stopGeolocationWatch() {
  if (state.geoWatchId && navigator.geolocation) {
    navigator.geolocation.clearWatch(state.geoWatchId);
    state.geoWatchId = null;
  }
}

function updateGpsStatus(message, isError) {
  if (!dom.gpsStatus) {
    return;
  }
  dom.gpsStatus.textContent = message;
  dom.gpsStatus.className = isError ? 'text-sm text-rose-400' : 'text-sm text-slate-200';
}

function ensureUserMarker(latlng) {
  if (!state.userMarker) {
    state.userMarker = L.circleMarker(latlng, {
      radius: 6,
      color: COLORS.PRIMARY,
      fillColor: COLORS.PRIMARY,
      fillOpacity: 0.9,
    }).addTo(state.photoMap);
  } else {
    state.userMarker.setLatLng(latlng);
  }
}

function updateAccuracyCircle(latlng, ring) {
  if (!ring || !ring.pixelRadius) {
    return;
  }
  if (!state.accuracyCircle) {
    state.accuracyCircle = L.circle(latlng, {
      radius: ring.pixelRadius,
      color: ring.color,
      weight: 1,
      fillColor: ring.color,
      fillOpacity: 0.15,
    }).addTo(state.photoMap);
  } else {
    state.accuracyCircle.setLatLng(latlng);
    state.accuracyCircle.setRadius(ring.pixelRadius);
    state.accuracyCircle.setStyle({ color: ring.color, fillColor: ring.color });
  }
}

function isCalibrationReady() {
  return !!(
    state.photoMap &&
    state.calibration &&
    state.calibration.status === 'ok' &&
    state.lastPosition
  );
}

function updateLivePosition() {
  if (!isCalibrationReady()) {
    return;
  }

  const coords = state.lastPosition.coords;
  const location = { lat: coords.latitude, lon: coords.longitude };
  const pixel = projectLocationToPixel(state.calibration, location);
  if (!pixel) {
    return;
  }
  const latlng = L.latLng(pixel.y, pixel.x);

  ensureUserMarker(latlng);

  if (state.photoPendingCenter && state.photoMap) {
    state.photoMap.panTo(latlng, { animate: true });
    state.photoPendingCenter = false;
  }

  const ring = accuracyRingRadiusPixels(state.calibration, location, coords.accuracy || 50);
  updateAccuracyCircle(latlng, ring);

  if (dom.accuracyDetails && ring) {
    dom.accuracyDetails.textContent = `Combined accuracy ${ring.sigmaTotal.toFixed(1)} m (GPS ${ring.sigmaGps.toFixed(1)} m, Map ${ring.sigmaMap.toFixed(1)} m)`;
  }
}

function startGeolocationWatch() {
  if (!navigator.geolocation) {
    updateGpsStatus('Geolocation is not available on this device.', true);
    return;
  }
  if (state.geoWatchId) {
    return;
  }

  updateGpsStatus('Waiting for location fix…', false);
  state.photoPendingCenter = true;
  state.osmPendingCenter = true;

  state.geoWatchId = navigator.geolocation.watchPosition(
    (position) => {
      state.lastPosition = position;
      state.lastGpsUpdate = Date.now();
      updateGpsStatus(`Live position · accuracy ±${Math.round(position.coords.accuracy)} m`, false);
      maybeCenterOsmOnFix(position.coords.latitude, position.coords.longitude);
      updateLivePosition();
      updateStatusText();
    },
    (error) => {
      updateGpsStatus(`Location error: ${error.message}`, true);
    },
    {
      enableHighAccuracy: true,
      maximumAge: 5000,
      timeout: 3000,
    },
  );
}

function clearActivePairMarkers() {
  if (state.photoActiveMarker) {
    state.photoActiveMarker.remove();
    state.photoActiveMarker = null;
  }
  if (state.osmActiveMarker) {
    state.osmActiveMarker.remove();
    state.osmActiveMarker = null;
  }
}

function setIdlePairStatus(guided) {
  dom.pairStatus.textContent = guided
    ? 'Guided setup preparing the next pair…'
    : 'Tap “Start pair” and select a pixel on the photo followed by its real-world location on the map.';
  dom.confirmPairButton.disabled = true;
  dom.cancelPairButton.disabled = !guided;
}

function setGuidedPairStatus({ pairNumber, hasPixel, hasWorld }) {
  dom.cancelPairButton.disabled = false;
  dom.confirmPairButton.disabled = true;

  if (!hasPixel) {
    dom.pairStatus.textContent = `Guided Pair ${pairNumber} — Step 1/2: tap the photo.`;
    return;
  }

  if (!hasWorld) {
    dom.pairStatus.textContent = `Guided Pair ${pairNumber} — Step 2/2: tap the map or use your position.`;
    return;
  }

  dom.pairStatus.textContent = `Guided Pair ${pairNumber} — finishing…`;
}

function setManualPairStatus({ pairNumber, hasPixel, hasWorld }) {
  dom.cancelPairButton.disabled = false;
  dom.confirmPairButton.disabled = !(hasPixel && hasWorld);

  if (!hasPixel && !hasWorld) {
    dom.pairStatus.textContent = `Pair ${pairNumber} — Step 1/2: tap the photo to drop the pixel anchor.`;
    return;
  }

  if (hasPixel && !hasWorld) {
    dom.pairStatus.textContent = `Pair ${pairNumber} — Step 2/2: tap the OpenStreetMap view or use your current position.`;
    return;
  }

  dom.pairStatus.textContent = `Pair ${pairNumber} ready — confirm to store it or tap cancel to discard.`;
}

function updatePairStatus() {
  if (!dom.pairStatus) {
    return;
  }

  const guided = isGuidedActive();
  const pairNumber = state.pairs.length + 1;

  if (!state.activePair) {
    setIdlePairStatus(guided);
    return;
  }

  const hasPixel = Boolean(state.activePair.pixel);
  const hasWorld = Boolean(state.activePair.wgs84);

  if (guided) {
    setGuidedPairStatus({ pairNumber, hasPixel, hasWorld });
    return;
  }

  setManualPairStatus({ pairNumber, hasPixel, hasWorld });
}

function beginPairMode() {
  // Cancel other modes
  cancelScaleMode();
  cancelMeasureMode();
  cancelOneTapMode();

  state.activePair = { pixel: null, wgs84: null };
  
  // Hide prompts since we are starting a manual pair
  hideInstantUsagePrompts();

  clearActivePairMarkers();
  updatePairStatus();
  dom.addPairButton.disabled = true;
  if (!isGuidedActive()) {
    showToast('Tap the photo to drop the pixel anchor.');
  }
  updateMapCursor();
}

function cancelPairMode() {
  state.activePair = null;
  clearActivePairMarkers();
  updatePairStatus();
  dom.addPairButton.disabled = isGuidedActive();
  updateMapCursor();
}

function showGuidedPairSavedToast(index) {
  if (!state.guidedPairing.pendingToast) {
    return;
  }

  const residual =
    state.calibration && Array.isArray(state.calibration.residuals)
      ? state.calibration.residuals[index]
      : null;
  const residualText = residual !== null && residual !== undefined ? `${residual.toFixed(1)} m` : '—';
  const tone = residual !== null && residual <= 30 ? 'success' : 'info';
  showToast(`Pair ${index + 1} saved — residual ${residualText}.`, { tone });
  state.guidedPairing.pendingToast = false;
}

function promptNextGuidedPair() {
  state.guidedPairing.step = 'photo';
  beginPairMode();
  updatePairStatus();
  setActiveView('photo');
  const nextPairNumber = state.pairs.length + 1;
  const message = nextPairNumber === 2 ? 'Tap the second point on your photo.' : 'Tap the next point on your photo.';
  showToast(message);
}

function advanceGuidedFlow() {
  if (!isGuidedActive()) {
    return;
  }

  state.guidedPairing.pairsCompleted += 1;

  if (state.pairs.length >= state.guidedPairing.targetCount) {
    setActiveView('photo');
    stopGuidedPairing('complete');
    updatePairStatus();
    return;
  }

  promptNextGuidedPair();
}

function showPairSavedToast(savedIndex) {
  if (isGuidedActive()) {
    showGuidedPairSavedToast(savedIndex);
    return;
  }

  const residual =
    state.calibration && Array.isArray(state.calibration.residuals)
      ? state.calibration.residuals[savedIndex]
      : null;
  const residualText = residual !== null && residual !== undefined ? `${residual.toFixed(1)} m` : '—';
  const tone = residual !== null && residual <= 30 ? 'success' : 'info';
  showToast(`Pair ${savedIndex + 1} saved — residual ${residualText}.`, { tone });
}

function confirmPair() {
  if (!state.activePair || !state.activePair.pixel || !state.activePair.wgs84) {
    return;
  }
  state.pairs.push({
    pixel: state.activePair.pixel,
    wgs84: state.activePair.wgs84,
  });
  
  cancelPairMode();
  renderPairList();
  refreshPairMarkers();
  recalculateCalibration();

  const savedIndex = state.pairs.length - 1;
  showPairSavedToast(savedIndex);
  advanceGuidedFlow();
}

function onPairTableClick(event) {
  const target = event.target;
  if (target.dataset.action === 'delete') {
    const index = Number.parseInt(target.dataset.index, 10);
    state.pairs.splice(index, 1);
    renderPairList();
    refreshPairMarkers();
    recalculateCalibration();
    cancelPairMode();
  }
}

function handlePhotoClick(event) {
  const pixel = { x: event.latlng.lng, y: event.latlng.lat };

  if (state.oneTapMode.active) {
    handleOneTapClick(pixel);
    return;
  }

  // Route to scale mode handler first
  if (handleScaleModeClick(event)) {
    return;
  }
  
  // Route to measure mode handler
  if (handleMeasureModeClick(event)) {
    return;
  }
  
  // Default: pair mode
  if (!state.activePair) {
    return;
  }
  state.activePair.pixel = pixel;
  if (state.photoActiveMarker) {
    state.photoActiveMarker.setLatLng(event.latlng);
  } else {
    state.photoActiveMarker = L.marker(event.latlng, { draggable: false }).addTo(state.photoMap);
  }
  const guidedPhotoStep = isGuidedActive() && state.guidedPairing.step === 'photo';
  if (guidedPhotoStep) {
    state.guidedPairing.step = 'osm';
  }
  updatePairStatus();
  if (guidedPhotoStep) {
    setActiveView('osm');
    showToast('Now tap the matching spot on the map.');
  } else if (!isGuidedActive()) {
    showToast('Switch to the OpenStreetMap tab and tap the matching spot.');
  }
}

function handleOsmClick(event) {
  if (!state.activePair) {
    return;
  }
  const wgs84 = { lat: event.latlng.lat, lon: event.latlng.lng };
  state.activePair.wgs84 = wgs84;
  if (state.osmActiveMarker) {
    state.osmActiveMarker.setLatLng(event.latlng);
  } else {
    state.osmActiveMarker = L.marker(event.latlng, { draggable: false }).addTo(state.osmMap);
  }
  finalizeMapSelection();
}

function useCurrentPositionForPair() {
  if (!state.activePair) {
    return;
  }
  if (!navigator.geolocation) {
    updateGpsStatus('Geolocation is not available.', true);
    return;
  }
  updateGpsStatus('Acquiring GPS fix for reference pair…', false);
  navigator.geolocation.getCurrentPosition(
    (position) => {
      const { latitude, longitude, accuracy } = position.coords;
      updateGpsStatus(`Captured reference with accuracy ±${Math.round(accuracy)} m`, false);
      const latlng = L.latLng(latitude, longitude);
      state.activePair.wgs84 = { lat: latitude, lon: longitude };
      if (state.osmActiveMarker) {
        state.osmActiveMarker.setLatLng(latlng);
      } else {
        state.osmActiveMarker = L.marker(latlng, { draggable: false }).addTo(state.osmMap);
      }
      state.osmMap.setView(latlng, Math.max(state.osmMap.getZoom(), 15));
      finalizeMapSelection();
    },
    (error) => {
      updateGpsStatus(`Location error: ${error.message}`, true);
    },
    {
      enableHighAccuracy: true,
      timeout: 30000,
    },
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Scale Mode: Set reference distance for manual scale definition
// ─────────────────────────────────────────────────────────────────────────────

function createScaleMarkerIcon(color = COLORS.SCALE) {
  return L.divIcon({
    className: 'scale-marker',
    html: `<div class="scale-marker-dot" style="background:${color};"></div>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  });
}

function createDistanceLabelHtml({ meters, color, icon, showPin = false, showDelete = false, extraClass = '' }) {
  const distanceText = formatDistance(meters, state.preferredUnit);
  const pinHtml = showPin ? '<button class="pin-btn ml-2 px-1 bg-white/20 hover:bg-white/40 rounded" title="Pin measurement">📌</button>' : '';
  const deleteHtml = showDelete ? '<button class="delete-ref-btn ml-1 px-1 bg-white/20 hover:bg-white/40 rounded" title="Delete scale">✕</button>' : '';
  
  return `<div class="distance-label ${extraClass}" style="background:${color};">${icon} ${distanceText}${pinHtml}${deleteHtml}</div>`;
}

function clearScaleModeMarkers() {
  if (state.scaleMode.ui.marker1) {
    state.scaleMode.ui.marker1.remove();
    state.scaleMode.ui.marker1 = null;
  }
  if (state.scaleMode.ui.marker2) {
    state.scaleMode.ui.marker2.remove();
    state.scaleMode.ui.marker2 = null;
  }
  if (state.scaleMode.ui.line) {
    state.scaleMode.ui.line.remove();
    state.scaleMode.ui.line = null;
  }
}

function clearReferenceVisualization() {
  if (state.referenceMarkers.marker1) {
    state.referenceMarkers.marker1.remove();
    state.referenceMarkers.marker1 = null;
  }
  if (state.referenceMarkers.marker2) {
    state.referenceMarkers.marker2.remove();
    state.referenceMarkers.marker2 = null;
  }
  if (state.referenceMarkers.line) {
    state.referenceMarkers.line.remove();
    state.referenceMarkers.line = null;
  }
  if (state.referenceMarkers.label) {
    state.referenceMarkers.label.remove();
    state.referenceMarkers.label = null;
  }
}

function drawReferenceVisualization() {
  if (!state.referenceDistance || !state.photoMap) {
    return;
  }
  clearReferenceVisualization();
  
  const { p1, p2, meters } = state.referenceDistance;
  const latlng1 = L.latLng(p1.y, p1.x);
  const latlng2 = L.latLng(p2.y, p2.x);
  
  state.referenceMarkers.marker1 = L.marker(latlng1, {
    icon: createScaleMarkerIcon(COLORS.REFERENCE),
    draggable: true,
  }).addTo(state.photoMap);
  
  state.referenceMarkers.marker2 = L.marker(latlng2, {
    icon: createScaleMarkerIcon(COLORS.REFERENCE),
    draggable: true,
  }).addTo(state.photoMap);

  const updateRef = () => {
    const l1 = state.referenceMarkers.marker1.getLatLng();
    const l2 = state.referenceMarkers.marker2.getLatLng();
    
    state.referenceDistance.p1 = { x: l1.lng, y: l1.lat };
    state.referenceDistance.p2 = { x: l2.lng, y: l2.lat };
    
    // Recompute metersPerPixel
    const dist = Math.hypot(l1.lng - l2.lng, l1.lat - l2.lat);
    if (dist > 0) {
      state.referenceDistance.metersPerPixel = state.referenceDistance.meters / dist;
    }
    
    if (state.referenceMarkers.line) {
      state.referenceMarkers.line.setLatLngs([l1, l2]);
    }
    if (state.referenceMarkers.label) {
      state.referenceMarkers.label.setLatLng(L.latLng((l1.lat + l2.lat) / 2, (l1.lng + l2.lng) / 2));
    }
    
    recalculateCalibration();
    saveSettings();
  };

  state.referenceMarkers.marker1.on('drag', updateRef);
  state.referenceMarkers.marker2.on('drag', updateRef);
  
  state.referenceMarkers.line = L.polyline([latlng1, latlng2], {
    color: COLORS.REFERENCE,
    weight: 3,
    dashArray: '8, 8',
    opacity: 0.9,
    interactive: true,
  }).addTo(state.photoMap);

  state.referenceMarkers.line.on('click', (e) => {
    L.DomEvent.stopPropagation(e);
    // Tapping the line triggers edit mode
    state.scaleMode.logic.p1 = state.referenceDistance.p1;
    state.scaleMode.logic.p2 = state.referenceDistance.p2;
    promptForReferenceDistance();
  });
  
  const midLat = (p1.y + p2.y) / 2;
  const midLng = (p1.x + p2.x) / 2;
  state.referenceMarkers.label = L.marker(L.latLng(midLat, midLng), {
    icon: L.divIcon({
      className: 'reference-label',
      html: createDistanceLabelHtml({
        meters,
        color: COLORS.REFERENCE,
        icon: '📏',
        showDelete: true,
      }),
      iconAnchor: [0, 0],
    }),
  }).addTo(state.photoMap);

  state.referenceMarkers.label.on('add', () => {
    const element = state.referenceMarkers.label.getElement();
    if (element) {
      const btn = element.querySelector('.delete-ref-btn');
      if (btn) {
        L.DomEvent.on(btn, 'click', (e) => {
          L.DomEvent.stopPropagation(e);
          if (confirm('Delete reference scale?')) {
            state.referenceDistance = null;
            clearReferenceVisualization();
            recalculateCalibration();
            saveSettings();
          }
        });
      }
    }
  });
}

function updateScaleModeLine() {
  const { p1, p2 } = state.scaleMode.logic;
  if (!p1 || !p2) {
    return;
  }
  const latlng1 = L.latLng(p1.y, p1.x);
  const latlng2 = L.latLng(p2.y, p2.x);
  
  if (state.scaleMode.ui.line) {
    state.scaleMode.ui.line.setLatLngs([latlng1, latlng2]);
  } else {
    state.scaleMode.ui.line = L.polyline([latlng1, latlng2], {
      color: COLORS.SCALE,
      weight: 3,
      dashArray: '6, 6',
      opacity: 0.9,
    }).addTo(state.photoMap);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Distance Input Modal: Custom dialog for entering reference distances
// ─────────────────────────────────────────────────────────────────────────────

function showDistanceModal() {
  if (!dom.distanceModal) {
    return;
  }
  
  // Reset modal state
  dom.distanceInput.value = '';
  dom.distanceUnit.value = state.preferredUnit;
  dom.distanceError.classList.add('hidden');
  
  // Show modal with flex display for centering
  dom.distanceModal.classList.remove('hidden');
  dom.distanceModal.classList.add('flex');
  
  // Focus input after a short delay for transition
  requestAnimationFrame(() => {
    dom.distanceInput.focus();
  });
}

function hideDistanceModal() {
  if (!dom.distanceModal) {
    return;
  }
  dom.distanceModal.classList.add('hidden');
  dom.distanceModal.classList.remove('flex');
}

function handleDistanceModalCancel() {
  hideDistanceModal();
  cancelScaleMode();
}

function handleDistanceModalConfirm() {
  const inputValue = dom.distanceInput.value;
  const unit = dom.distanceUnit.value;
  
  // Update preferred unit for future use
  state.preferredUnit = unit;
  if (dom.globalUnitSelect) {
    dom.globalUnitSelect.value = unit;
  }
  
  const validation = validateDistanceInput(inputValue, unit);
  
  if (!validation.valid) {
    dom.distanceError.classList.remove('hidden');
    dom.distanceInput.focus();
    return;
  }
  
  const { meters } = validation;
  
  hideDistanceModal();
  
  const result = computeReferenceDistanceFromInput(state.scaleMode.logic, meters);
  
  if (!result.success) {
    showToast('Could not compute scale. Points may be too close.', { tone: 'warning' });
    cancelScaleMode();
    return;
  }
  
  state.referenceDistance = result.referenceDistance;
  clearScaleModeMarkers();
  state.scaleMode.logic = cancelScaleModeState();
  
  drawReferenceVisualization();
  recalculateCalibration();
  saveSettings();
  
  if (state.pairs.length === 1) {
    const rotationLabel = getRotationLabel(state.defaultRotation);
    showToast(`1-point calibration active (${rotationLabel}). Add a second point to fix orientation and scale.`, { tone: 'success', duration: 6000 });
  } else {
    showToast(`Scale set: ${formatDistance(result.referenceDistance.meters, state.preferredUnit)} = ${result.referenceDistance.metersPerPixel.toFixed(4)} m/px`, { tone: 'success' });
  }
}

function promptForReferenceDistance() {
  showDistanceModal();
}

function startScaleMode() {
  if (state.activePair) {
    cancelPairMode();
  }
  if (state.measureMode.logic.active) {
    cancelMeasureMode();
  }
  cancelOneTapMode();
  
  state.scaleMode.logic = startScaleModeState(state.scaleMode.logic);
  clearScaleModeMarkers();
  
  if (dom.setScaleButton) {
    dom.setScaleButton.disabled = !shouldEnableSetScaleButton(state.scaleMode.logic);
  }
  
  setActiveView('photo');
  showToast('Tap the start point of a known distance.');
  updateMapCursor();
}

function cancelScaleMode() {
  clearScaleModeMarkers();
  state.scaleMode.logic = cancelScaleModeState();
  
  if (dom.setScaleButton) {
    dom.setScaleButton.disabled = !shouldEnableSetScaleButton(state.scaleMode.logic);
  }
  updateMapCursor();
}

function startOneTapMode() {
  if (state.oneTapMode.active) return;
  
  // Cancel other modes
  cancelScaleMode();
  cancelMeasureMode();
  cancelPairMode();
  
  state.oneTapMode.active = true;
  if (dom.oneTapCalibrateButton) {
    dom.oneTapCalibrateButton.classList.add('ring-2', 'ring-white', 'scale-105');
    dom.oneTapCalibrateButton.textContent = '📍 Tap your location';
  }
  
  showToast('Tap your current location on the photo', { tone: 'info' });
  updateMapCursor();
}

function cancelOneTapMode() {
  state.oneTapMode.active = false;
  if (dom.oneTapCalibrateButton) {
    dom.oneTapCalibrateButton.classList.remove('ring-2', 'ring-white', 'scale-105');
    dom.oneTapCalibrateButton.textContent = '📍 I am here';
  }
  updateMapCursor();
}

function handleOneTapClick(pixel) {
  if (!state.oneTapMode.active) return;
  
  if (!navigator.geolocation) {
    showToast('Geolocation is not supported.', { tone: 'warning' });
    cancelOneTapMode();
    return;
  }

  showToast('Capturing your GPS position...', { duration: 3000 });
  
  // We use getCurrentPosition to ensure we get a fresh fix for this specific tap
  navigator.geolocation.getCurrentPosition(
    (position) => {
      if (!state.oneTapMode.active) return;
      
      state.lastPosition = position;
      state.lastGpsUpdate = Date.now();
      
      const wgs84 = {
        lat: position.coords.latitude,
        lon: position.coords.longitude,
      };
      
      state.pairs.push({ pixel, wgs84 });
      
      cancelOneTapMode();
      recalculateCalibration();
      
      if (state.referenceDistance) {
        const rotationLabel = getRotationLabel(state.defaultRotation);
        showToast(`1-point calibration active (${rotationLabel}). Add a second point to fix orientation and scale.`, { tone: 'success', duration: 6000 });
      } else {
        showToast('Position pinned. Now set the scale to enable live view.', { duration: 5000 });
      }
    },
    (error) => {
      console.error('One-tap geolocation error:', error);
      showToast(`Failed to get position: ${error.message}`, { tone: 'warning' });
      cancelOneTapMode();
    },
    {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 0,
    }
  );
}

function handleScaleModeClick(event) {
  const pixel = { x: event.latlng.lng, y: event.latlng.lat };
  const { state: newState, action } = handleScaleModePoint(state.scaleMode.logic, pixel);
  
  if (!action) {
    return false;
  }
  
  // Update logical state
  state.scaleMode.logic = newState;

  const createDragHandler = (marker, pointId) => {
    marker.on('drag', () => {
      const latlng = marker.getLatLng();
      state.scaleMode.logic[pointId] = { x: latlng.lng, y: latlng.lat };
      updateScaleModeLine();
    });
  };
  
  // Handle UI side effects based on action
  if (action === 'show-p2-toast') {
    clearScaleModeMarkers();
    state.scaleMode.ui.marker1 = L.marker(event.latlng, {
      icon: createScaleMarkerIcon(COLORS.SCALE),
      draggable: true,
    }).addTo(state.photoMap);
    
    createDragHandler(state.scaleMode.ui.marker1, 'p1');
    
    showToast('Now tap the end point.');
    return true;
  }
  
  if (action === 'prompt-distance') {
    state.scaleMode.ui.marker2 = L.marker(event.latlng, {
      icon: createScaleMarkerIcon(COLORS.SCALE),
      draggable: true,
    }).addTo(state.photoMap);
    
    createDragHandler(state.scaleMode.ui.marker2, 'p2');
    
    updateScaleModeLine();
    promptForReferenceDistance();
    return true;
  }
  
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// Measure Mode: Measure arbitrary distances using the active scale
// ─────────────────────────────────────────────────────────────────────────────

function clearMeasureModeMarkers() {
  if (state.measureMode.ui.marker1) {
    state.measureMode.ui.marker1.remove();
    state.measureMode.ui.marker1 = null;
  }
  if (state.measureMode.ui.marker2) {
    state.measureMode.ui.marker2.remove();
    state.measureMode.ui.marker2 = null;
  }
  if (state.measureMode.ui.line) {
    state.measureMode.ui.line.remove();
    state.measureMode.ui.line = null;
  }
  if (state.measureMode.ui.label) {
    state.measureMode.ui.label.remove();
    state.measureMode.ui.label = null;
  }
}

function updateMeasureLabel() {
  const { p1, p2 } = state.measureMode.logic;
  if (!p1 || !p2) {
    return;
  }
  
  const result = computeMeasurement(state.measureMode.logic, state);
  if (!result.success) {
    return;
  }
  
  const midLat = (p1.y + p2.y) / 2;
  const midLng = (p1.x + p2.x) / 2;
  const sourceIcon = result.source === 'manual' ? '📏' : '📡';
  
  if (state.measureMode.ui.label) {
    state.measureMode.ui.label.remove();
  }
  
  state.measureMode.ui.label = L.marker(L.latLng(midLat, midLng), {
    icon: L.divIcon({
      className: 'measure-label',
      html: createDistanceLabelHtml({
        meters: result.meters,
        color: COLORS.MEASURE,
        icon: sourceIcon,
        showPin: true,
        extraClass: 'distance-label--measure',
      }),
      iconAnchor: [0, 0],
    }),
  }).addTo(state.photoMap);

  // Attach click handler to pin button
  state.measureMode.ui.label.on('add', () => {
    const element = state.measureMode.ui.label.getElement();
    if (element) {
      const btn = element.querySelector('.pin-btn');
      if (btn) {
        L.DomEvent.on(btn, 'click', (e) => {
          L.DomEvent.stopPropagation(e);
          pinCurrentMeasurement();
        });
      }
    }
  });
}

function updateMeasureModeLine() {
  const { p1, p2 } = state.measureMode.logic;
  if (!p1 || !p2) {
    return;
  }
  
  const latlng1 = L.latLng(p1.y, p1.x);
  const latlng2 = L.latLng(p2.y, p2.x);
  
  if (state.measureMode.ui.line) {
    state.measureMode.ui.line.setLatLngs([latlng1, latlng2]);
  } else {
    state.measureMode.ui.line = L.polyline([latlng1, latlng2], {
      color: COLORS.MEASURE,
      weight: 3,
      opacity: 0.9,
    }).addTo(state.photoMap);
  }
  
  updateMeasureLabel();
}

function startMeasureMode() {
  const check = canStartMeasureMode(state);
  if (!check.canStart) {
    showToast('Set a reference scale or add GPS pairs first.', { tone: 'warning' });
    return;
  }
  
  if (state.activePair) {
    cancelPairMode();
  }
  if (state.scaleMode.logic.active) {
    cancelScaleMode();
  }
  cancelOneTapMode();
  
  // If there's a completed measurement, pin it automatically
  if (state.measureMode.logic.active && state.measureMode.logic.step === null) {
    pinCurrentMeasurement();
  }
  
  clearMeasureModeMarkers();
  state.measureMode.logic = startMeasureModeState(state.measureMode.logic);
  
  if (dom.measureButton) {
    dom.measureButton.disabled = !shouldEnableMeasureButton(state, state.measureMode.logic);
  }
  
  setActiveView('photo');
  const sourceText = check.scale.source === 'manual' ? 'manual scale' : 'GPS calibration';
  showToast(`Measure mode (${sourceText}). Tap start point.`);
  updateMapCursor();
}

function cancelMeasureMode() {
  clearMeasureModeMarkers();
  state.measureMode.logic = cancelMeasureModeState();
  
  updateMeasureButtonState();
  updateMapCursor();
}

function handleMeasureModeClick(event) {
  const pixel = { x: event.latlng.lng, y: event.latlng.lat };
  
  // If there's a completed measurement, pin it automatically before starting a new one
  if (state.measureMode.logic.active && state.measureMode.logic.step === null) {
    pinCurrentMeasurement();
  }

  const { state: newState, action } = handleMeasureModePoint(state.measureMode.logic, pixel);
  
  if (!action) {
    return false;
  }
  
  // Update logical state
  state.measureMode.logic = newState;

  const createDragHandler = (marker, pointId) => {
    marker.on('drag', () => {
      const latlng = marker.getLatLng();
      state.measureMode.logic = updateMeasureModePoint(state.measureMode.logic, pointId, { x: latlng.lng, y: latlng.lat });
      updateMeasureModeLine();
    });
  };
  
  // Handle UI side effects based on action
  if (action === 'show-p2-toast') {
    state.measureMode.ui.marker1 = L.marker(event.latlng, {
      icon: createScaleMarkerIcon(COLORS.MEASURE),
      draggable: true,
    }).addTo(state.photoMap);
    
    createDragHandler(state.measureMode.ui.marker1, 'p1');
    
    showToast('Tap the end point to measure.');
    return true;
  }
  
  if (action === 'measurement-complete') {
    state.measureMode.ui.marker2 = L.marker(event.latlng, {
      icon: createScaleMarkerIcon(COLORS.MEASURE),
      draggable: true,
    }).addTo(state.photoMap);
    
    createDragHandler(state.measureMode.ui.marker2, 'p2');
    
    updateMeasureModeLine();
    
    if (dom.measureButton) {
      dom.measureButton.disabled = !shouldEnableMeasureButton(state, state.measureMode.logic);
    }
    
    showToast('Drag endpoints to refine. Tap Measure again for a new measurement.', { duration: 5000 });
    return true;
  }
  
  return false;
}

function updateMeasureButtonState() {
  if (!dom.measureButton) {
    return;
  }
  dom.measureButton.disabled = !shouldEnableMeasureButton(state, state.measureMode.logic);
  
  if (dom.clearMeasurementsButton) {
    dom.clearMeasurementsButton.classList.toggle('hidden', state.measureMode.pinned.length === 0);
  }
}

function pinCurrentMeasurement() {
  const { p1, p2 } = state.measureMode.logic;
  if (!p1 || !p2 || state.measureMode.logic.step !== null) {
    return;
  }
  
  const result = computeMeasurement(state.measureMode.logic, state);
  if (!result.success) {
    return;
  }
  
  // Move current UI elements to pinned list
  const pinnedItem = {
    p1,
    p2,
    meters: result.meters,
    source: result.source,
    ui: {
      marker1: state.measureMode.ui.marker1,
      marker2: state.measureMode.ui.marker2,
      line: state.measureMode.ui.line,
      label: state.measureMode.ui.label,
    },
  };
  
  // Make markers non-draggable once pinned
  if (pinnedItem.ui.marker1) pinnedItem.ui.marker1.dragging.disable();
  if (pinnedItem.ui.marker2) pinnedItem.ui.marker2.dragging.disable();
  
  // Remove the pin button from the label if it exists
  if (pinnedItem.ui.label) {
    const sourceIcon = pinnedItem.source === 'manual' ? '📏' : '📡';
    pinnedItem.ui.label.setIcon(L.divIcon({
      className: 'measure-label',
      html: createDistanceLabelHtml({
        meters: pinnedItem.meters,
        color: COLORS.MEASURE,
        icon: sourceIcon,
        showPin: false,
        extraClass: 'distance-label--measure',
      }),
      iconAnchor: [0, 0],
    }));
  }
  
  state.measureMode.pinned.push(pinnedItem);
  
  // Reset current UI references (but don't remove from map)
  state.measureMode.ui = {
    marker1: null,
    marker2: null,
    line: null,
    label: null,
  };

  // Reset logic state to allow new measurement
  state.measureMode.logic = startMeasureModeState(state.measureMode.logic);
  
  updateMeasureButtonState();
}

function clearAllMeasurements() {
  // Clear current
  clearMeasureModeMarkers();
  
  // Clear pinned
  state.measureMode.pinned.forEach(item => {
    if (item.ui.marker1) item.ui.marker1.remove();
    if (item.ui.marker2) item.ui.marker2.remove();
    if (item.ui.line) item.ui.line.remove();
    if (item.ui.label) item.ui.label.remove();
  });
  state.measureMode.pinned = [];
  
  updateMeasureButtonState();
}

function handleInsufficientPairs() {
  state.calibration = null;
  refreshPairMarkers();
  updateStatusText();
  stopGeolocationWatch();
  updateMeasureButtonState();
}

function handleCalibrationResult(result) {
  state.calibration = result.status === 'ok' ? result : null;

  if (!state.calibration) {
    updateGpsStatus(result.message || 'Calibration failed. Add more pairs.', true);
    state.userMarker = null;
    if (state.accuracyCircle) {
      state.accuracyCircle.remove();
      state.accuracyCircle = null;
    }
  } else {
    const msg = (result.statusMessage && result.statusMessage.message) || 'Calibration ready. Live mode active.';
    updateGpsStatus(msg, false);
    startGeolocationWatch();
  }
}

function recalculateCalibration() {
  const minPairs = state.referenceDistance ? 1 : 2;
  if (state.pairs.length < minPairs) {
    handleInsufficientPairs();
    return;
  }

  const options = {
    defaultRotation: (state.defaultRotation * Math.PI) / 180,
  };
  if (state.referenceDistance && state.referenceDistance.metersPerPixel) {
    options.referenceScale = state.referenceDistance.metersPerPixel;
  }

  const result = calibrateMap(state.pairs, options);
  handleCalibrationResult(result);

  renderPairList();
  refreshPairMarkers();
  updateStatusText();
  updateLivePosition();
  updateMeasureButtonState();
}

function loadPhotoMap(dataUrl, width, height) {
  if (!state.photoMap) {
    state.photoMap = L.map('photoMap', {
      crs: L.CRS.Simple,
      zoomControl: true,
      maxZoom: 4,
      minZoom: -4,
    });
    state.photoMap.on('click', handlePhotoClick);
  }

  const bounds = [
    [0, 0],
    [height, width],
  ];

  if (state.photoOverlay) {
    state.photoOverlay.remove();
  }

  state.photoOverlay = L.imageOverlay(dataUrl, bounds).addTo(state.photoMap);
  state.photoMap.setMaxBounds(bounds);
  state.photoMap.fitBounds(bounds);

  setPhotoImportState(true);

  state.imageDataUrl = dataUrl;
  state.imageSize = { width, height };
  state.pairs = [];
  state.calibration = null;
  state.referenceDistance = null;
  clearReferenceVisualization();
  clearAllMeasurements();
  state.lastPosition = null;
  state.userMarker = null;
  if (state.accuracyCircle) {
    state.accuracyCircle.remove();
    state.accuracyCircle = null;
  }
  clearMarkers(state.photoPairMarkers);
  clearMarkers(state.osmPairMarkers);
  cancelPairMode();
  renderPairList();
  refreshPairMarkers();
  updateStatusText();
  saveSettings();
  updateGpsStatus('Photo loaded. Guided pairing active — follow the prompts.', false);
  startGuidedPairing();

  if (dom.mapImageInput) {
    dom.mapImageInput.value = '';
  }

  requestAnimationFrame(() => {
    if (state.photoMap) {
      state.photoMap.invalidateSize();
    }
  });
}

function handleImageImport(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) {
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    const dataUrl = reader.result;
    if (typeof dataUrl !== 'string') {
      return;
    }

    const img = new Image();
    img.onload = () => {
      const originalWidth = img.width;
      const originalHeight = img.height;

      if (!originalWidth || !originalHeight) {
        loadPhotoMap(dataUrl, originalWidth, originalHeight);
        return;
      }

      const scale = Math.min(
        MAX_PHOTO_DIMENSION / originalWidth,
        MAX_PHOTO_DIMENSION / originalHeight,
        1,
      );

      if (scale < 1) {
        const targetWidth = Math.round(originalWidth * scale);
        const targetHeight = Math.round(originalHeight * scale);
        const canvas = document.createElement('canvas');
        canvas.width = targetWidth;
        canvas.height = targetHeight;
        const context = canvas.getContext('2d');

        if (context) {
          context.imageSmoothingEnabled = true;
          context.imageSmoothingQuality = 'high';
          context.drawImage(img, 0, 0, targetWidth, targetHeight);

          const preferredType =
            file.type === 'image/png' || file.type === 'image/webp'
              ? file.type
              : 'image/jpeg';

          const optimizedDataUrl =
            preferredType === 'image/jpeg'
              ? canvas.toDataURL(preferredType, 0.9)
              : canvas.toDataURL(preferredType);

          loadPhotoMap(optimizedDataUrl, targetWidth, targetHeight);
          return;
        }
      }

      loadPhotoMap(dataUrl, originalWidth, originalHeight);
    };
    img.onerror = () => {
      console.warn('Failed to load the selected image.');
    };
    img.src = dataUrl;
  };
  reader.readAsDataURL(file);
}

function setupMaps() {
  state.osmMap = L.map('osmMap', {
    zoomControl: true,
  }).setView([39.7392, -104.9903], 11);

  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/">OpenStreetMap</a> contributors',
    maxZoom: 19,
  }).addTo(state.osmMap);

  state.osmMap.on('click', handleOsmClick);

  if (!state.osmLocateHandlersAttached) {
    const handleLocateFound = (event) => {
      const now = Date.now();
      state.lastPosition = {
        coords: {
          latitude: event.latlng.lat,
          longitude: event.latlng.lng,
          accuracy: event.accuracy,
        },
        timestamp: now,
      };
      state.lastGpsUpdate = now;
      updateGpsStatus(`Live position · accuracy ±${Math.round(event.accuracy)} m`, false);
      updateStatusText();
      maybeCenterOsmOnFix(event.latlng.lat, event.latlng.lng);
      updateLivePosition();
    };

    const handleLocateError = (error) => {
      updateGpsStatus(`Location error: ${error.message}`, true);
    };

    state.osmMap.on('locationfound', handleLocateFound);
    state.osmMap.on('locationerror', handleLocateError);
    state.osmLocateHandlersAttached = true;
  }

  if (L.control && typeof L.control.locate === 'function') {
    const locateControl = L.control.locate({
      position: 'topleft',
      setView: false,
      flyTo: false,
      cacheLocation: true,
      showPopup: false,
    });

    state.osmLocateControl = locateControl.addTo(state.osmMap);
    state.osmPendingCenter = true;

    try {
      updateGpsStatus('Locating your position…', false);
      state.osmPendingCenter = true;
      state.osmLocateControl.start();
    } catch (error) {
      console.warn('Failed to start locate control', error);
    }
  } else {
    console.warn('Leaflet locate control plugin not available.');
  }
}

function centerOsmOnLatLon(lat, lon) {
  if (!state.osmMap) return;
  const latlng = L.latLng(lat, lon);
  const targetZoom = Math.max(state.osmMap.getZoom() || 0, 15);
  state.osmMap.setView(latlng, targetZoom);
}

function maybeCenterOsmOnFix(lat, lon) {
  if (!state.osmPendingCenter) {
    return;
  }
  centerOsmOnLatLon(lat, lon);
  state.osmPendingCenter = false;
}

function requestAndCenterOsmOnUser() {
  if (state.osmLocateControl) {
    try {
      state.osmPendingCenter = true;
      state.osmLocateControl.start();
    } catch (error) {
      console.warn('Failed to trigger locate control', error);
    }
    return;
  }

  if (!navigator.geolocation) return;
  updateGpsStatus('Locating your position…', false);
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      updateGpsStatus(`Centered on your location (±${Math.round(pos.coords.accuracy)} m)`, false);
      centerOsmOnLatLon(pos.coords.latitude, pos.coords.longitude);
      state.osmPendingCenter = false;
    },
    () => {
      // ignore errors – keep default view
      updateGpsStatus('Could not get your location right now.', true);
    },
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 },
  );
}

function handleGeolocationPermission(shouldPrompt, doRequest) {
  if (!navigator.permissions || !navigator.permissions.query) {
    if (shouldPrompt) doRequest();
    return;
  }

  navigator.permissions
    .query({ name: 'geolocation' })
    .then((status) => {
      if (status.state === 'granted') {
        doRequest();
      } else if (status.state === 'prompt' && shouldPrompt) {
        doRequest();
      }
    })
    .catch(() => {
      if (shouldPrompt) doRequest();
    });
}

function maybePromptGeolocationForOsm() {
  // If we already have a recent position, prefer that immediately
  if (state.lastPosition && Date.now() - (state.lastGpsUpdate || 0) <= 5_000) {
    const { latitude, longitude } = state.lastPosition.coords;
    centerOsmOnLatLon(latitude, longitude);
    state.osmPendingCenter = false;
    // continue so we also keep the locate control active for future updates
  }

  if (state.osmLocateControl) {
    state.osmGeoPrompted = true;
    try {
      state.osmLocateControl.start();
    } catch (error) {
      console.warn('Failed to restart locate control', error);
    }
    return;
  }

  if (!navigator.geolocation) return;

  const shouldPrompt = !state.osmGeoPrompted;
  const doRequest = () => {
    if (shouldPrompt) state.osmGeoPrompted = true;
    requestAndCenterOsmOnUser();
  };

  handleGeolocationPermission(shouldPrompt, doRequest);
}

function setActiveView(view) {
  if (view === 'photo') {
    dom.photoView.classList.remove('hidden');
    dom.osmView.classList.add('hidden');
    dom.photoTabButton.classList.add('bg-blue-600', 'text-white');
    dom.photoTabButton.classList.remove('bg-white/10', 'text-blue-300');
    dom.osmTabButton.classList.remove('bg-blue-600', 'text-white');
    dom.osmTabButton.classList.add('bg-white/10', 'text-blue-300');
    if (state.photoMap) {
      state.photoMap.invalidateSize();
    }
  } else {
    dom.photoView.classList.add('hidden');
    dom.osmView.classList.remove('hidden');
    dom.osmTabButton.classList.add('bg-blue-600', 'text-white');
    dom.osmTabButton.classList.remove('bg-white/10', 'text-blue-300');
    dom.photoTabButton.classList.remove('bg-blue-600', 'text-white');
    dom.photoTabButton.classList.add('bg-white/10', 'text-blue-300');
    state.osmMap.invalidateSize();
    // On first OSM open, immediately ask for location permission and center if available
    maybePromptGeolocationForOsm();
  }
}

function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('service-worker.js').catch((error) => {
      console.warn('Service worker registration failed', error);
    });
  }
}

function cacheDom() {
  dom.mapImageInput = $('mapImageInput');
  dom.photoPlaceholder = $('photoPlaceholder');
  dom.addPairButton = $('addPairButton');
  dom.usePositionButton = $('usePositionButton');
  dom.confirmPairButton = $('confirmPairButton');
  dom.cancelPairButton = $('cancelPairButton');
  dom.pairStatus = $('pairStatus');
  dom.pairTableBody = $('pairTableBody');
  dom.calibrationStatus = $('calibrationStatus');
  dom.calibrationBadge = $('calibrationBadge');
  dom.residualSummary = $('residualSummary');
  dom.accuracyDetails = $('accuracyDetails');
  dom.gpsStatus = $('gpsStatus');
  dom.scaleWarning = $('scaleWarning');
  dom.photoView = $('photoView');
  dom.osmView = $('osmView');
  dom.photoTabButton = $('photoTabButton');
  dom.osmTabButton = $('osmTabButton');
  dom.pairTable = $('pairTable');
  dom.toastContainer = $('toastContainer');
  dom.replacePhotoButton = $('replacePhotoButton');
  // Global unit selector
  dom.globalUnitSelect = $('globalUnitSelect');
  dom.defaultRotationSelect = $('defaultRotationSelect');
  // Scale and measure mode buttons
  dom.setScaleButton = $('setScaleButton');
  dom.measureButton = $('measureButton');
  dom.photoMap = $('photoMap');
  dom.clearMeasurementsButton = $('clearMeasurementsButton');
  dom.instantUsagePrompts = $('instantUsagePrompts');
  dom.instantSetScaleButton = $('instantSetScaleButton');
  dom.oneTapCalibrateButton = $('oneTapCalibrateButton');
  // Distance input modal
  dom.distanceModal = $('distanceModal');
  dom.distanceInput = $('distanceInput');
  dom.distanceUnit = $('distanceUnit');
  dom.distanceError = $('distanceError');
  dom.distanceCancelBtn = $('distanceCancelBtn');
  dom.distanceConfirmBtn = $('distanceConfirmBtn');
}

function handleGlobalUnitChange(e) {
  state.preferredUnit = e.target.value;
  // Refresh visualizations that use the unit
  drawReferenceVisualization();
  updateMeasureLabel();

  // Also update all pinned measurement labels
  state.measureMode.pinned.forEach((item) => {
    if (item.ui.label) {
      const sourceIcon = item.source === 'manual' ? '📏' : '📡';
      item.ui.label.setIcon(L.divIcon({
        className: 'measure-label',
        html: createDistanceLabelHtml({
          meters: item.meters,
          color: COLORS.MEASURE,
          icon: sourceIcon,
          showPin: false,
          extraClass: 'distance-label--measure',
        }),
        iconAnchor: [0, 0],
      }));
    }
  });

  saveSettings();
}

function handleDefaultRotationChange(e) {
  state.defaultRotation = parseFloat(e.target.value);
  saveSettings();
  if (state.pairs.length === 1) {
    recalculateCalibration();
  }
}

function setupModalEventHandlers() {
  // Distance modal handlers
  if (dom.distanceCancelBtn) {
    dom.distanceCancelBtn.addEventListener('click', handleDistanceModalCancel);
  }
  if (dom.distanceConfirmBtn) {
    dom.distanceConfirmBtn.addEventListener('click', handleDistanceModalConfirm);
  }
  if (dom.distanceInput) {
    dom.distanceInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        handleDistanceModalConfirm();
      }
    });
    dom.distanceInput.addEventListener('input', () => {
      dom.distanceError.classList.add('hidden');
    });
  }
  if (dom.distanceModal) {
    dom.distanceModal.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        handleDistanceModalCancel();
      }
    });
    // Close on backdrop click
    dom.distanceModal.addEventListener('click', (e) => {
      if (e.target === dom.distanceModal) {
        handleDistanceModalCancel();
      }
    });
  }
}

function setupEventHandlers() {
  dom.mapImageInput.addEventListener('change', handleImageImport);
  dom.addPairButton.addEventListener('click', beginPairMode);
  dom.cancelPairButton.addEventListener('click', () => {
    const wasGuided = isGuidedActive();
    cancelPairMode();
    if (wasGuided) {
      stopGuidedPairing('cancelled');
    }
  });
  dom.confirmPairButton.addEventListener('click', confirmPair);
  dom.usePositionButton.addEventListener('click', useCurrentPositionForPair);
  dom.pairTableBody.addEventListener('click', onPairTableClick);
  dom.photoTabButton.addEventListener('click', () => setActiveView('photo'));
  dom.osmTabButton.addEventListener('click', () => setActiveView('osm'));
  
  // Global unit selector
  if (dom.globalUnitSelect) {
    dom.globalUnitSelect.addEventListener('change', handleGlobalUnitChange);
  }
  
  if (dom.defaultRotationSelect) {
    dom.defaultRotationSelect.addEventListener('change', handleDefaultRotationChange);
  }
  
  // Scale and measure mode handlers
  if (dom.setScaleButton) {
    dom.setScaleButton.addEventListener('click', startScaleMode);
  }
  if (dom.instantSetScaleButton) {
    dom.instantSetScaleButton.addEventListener('click', startScaleMode);
  }
  if (dom.oneTapCalibrateButton) {
    dom.oneTapCalibrateButton.addEventListener('click', startOneTapMode);
  }
  if (dom.measureButton) {
    dom.measureButton.addEventListener('click', startMeasureMode);
  }
  if (dom.clearMeasurementsButton) {
    dom.clearMeasurementsButton.addEventListener('click', clearAllMeasurements);
  }
  
  setupModalEventHandlers();
}

function saveSettings() {
  try {
    localStorage.setItem('snap2map_preferredUnit', state.preferredUnit);
    localStorage.setItem('snap2map_defaultRotation', state.defaultRotation.toString());
    if (state.referenceDistance) {
      localStorage.setItem('snap2map_referenceDistance', JSON.stringify(state.referenceDistance));
    } else {
      localStorage.removeItem('snap2map_referenceDistance');
    }
  } catch (e) {
    console.warn('Failed to save settings', e);
  }
}

function loadSettings() {
  try {
    const unit = localStorage.getItem('snap2map_preferredUnit');
    if (unit) {
      state.preferredUnit = unit;
      if (dom.globalUnitSelect) {
        dom.globalUnitSelect.value = unit;
      }
    }

    const rotation = localStorage.getItem('snap2map_defaultRotation');
    if (rotation) {
      state.defaultRotation = parseFloat(rotation);
      if (dom.defaultRotationSelect) {
        dom.defaultRotationSelect.value = rotation;
      }
    }
    
    const refDist = localStorage.getItem('snap2map_referenceDistance');
    if (refDist) {
      state.referenceDistance = JSON.parse(refDist);
      drawReferenceVisualization();
    }
  } catch (e) {
    console.warn('Failed to load settings', e);
  }
}

function init() {
  cacheDom();
  loadSettings();
  setPhotoImportState(false);
  setupEventHandlers();
  setupMaps();
  setActiveView('photo');
  updateStatusText();
  updateGpsStatus('Import a map photo to get started.', false);
  showToast('Import a map photo to get started.');
  registerServiceWorker();
}

document.addEventListener('DOMContentLoaded', init);

export const __testables = {
  setupMaps,
  state,
  maybePromptGeolocationForOsm,
  requestAndCenterOsmOnUser,
  checkScaleDisagreement,
  saveSettings,
  loadSettings,
  recalculateCalibration,
  handleDistanceModalConfirm,
  handleDistanceModalCancel,
  cacheDom,
  setupEventHandlers,
  loadPhotoMap,
  confirmPair,
  startOneTapMode,
  handleOneTapClick,
  handlePhotoClick,
  updateStatusText,
};
