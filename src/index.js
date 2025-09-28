/* istanbul ignore file */
/* global L */
import {
  calibrateMap,
  computeAccuracyRing,
  projectLocationToPixel,
  accuracyRingRadiusPixels,
} from 'snap2map/calibrator';

const GUIDED_PAIR_TARGET = 2;
const MAX_PHOTO_DIMENSION = 2048*2; // pixels

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
  // Prompt geolocation when OSM tab opened the first time
  osmGeoPrompted: false,
  guidedPairing: {
    active: false,
    targetCount: GUIDED_PAIR_TARGET,
    step: null,
    pairsCompleted: 0,
    pendingToast: false,
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

function updateStatusText() {
  if (!dom.calibrationStatus) {
    return;
  }
  if (!state.calibration || state.calibration.status !== 'ok') {
    dom.calibrationStatus.textContent = 'Add at least two reference pairs to calibrate the photo.';
    dom.calibrationBadge.textContent = 'No calibration';
    dom.calibrationBadge.className = 'px-2 py-1 rounded text-xs font-semibold bg-gray-200 text-gray-700';
    dom.residualSummary.textContent = '';
    dom.accuracyDetails.textContent = '';
    return;
  }

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
    const color = !state.calibration ? '#2563eb' : inlier ? '#16a34a' : '#dc2626';
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
    row.className = index % 2 === 0 ? 'bg-white' : 'bg-gray-50';
    const residual = state.calibration && state.calibration.residuals ? state.calibration.residuals[index] : null;
    const inlier = state.calibration && state.calibration.inliers ? state.calibration.inliers[index] : false;
    const indicatorClass = !state.calibration ? 'bg-blue-500' : inlier ? 'bg-green-500' : 'bg-red-500';
    const indicator = `<span class="inline-block w-2 h-2 rounded-full ${indicatorClass}"></span>`;

    row.innerHTML = `
      <td class="px-3 py-2 text-sm text-gray-700 space-x-2">${indicator}<span>${pair.pixel.x.toFixed(1)}, ${pair.pixel.y.toFixed(1)}</span></td>
      <td class="px-3 py-2 text-sm text-gray-700">${formatLatLon(pair.wgs84.lat, 'N', 'S')} · ${formatLatLon(pair.wgs84.lon, 'E', 'W')}</td>
      <td class="px-3 py-2 text-sm text-gray-700">${residual !== null && residual !== undefined ? `${residual.toFixed(1)} m` : '—'}</td>
      <td class="px-3 py-2 text-right">
        <button class="text-sm text-red-600 hover:underline" data-action="delete" data-index="${index}">Remove</button>
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
  dom.gpsStatus.className = isError ? 'text-sm text-red-600' : 'text-sm text-slate-600';
}

function updateLivePosition() {
  if (!state.photoMap || !state.calibration || state.calibration.status !== 'ok' || !state.lastPosition) {
    return;
  }

  const coords = state.lastPosition.coords;
  const location = { lat: coords.latitude, lon: coords.longitude };
  const pixel = projectLocationToPixel(state.calibration, location);
  if (!pixel) {
    return;
  }
  const latlng = L.latLng(pixel.y, pixel.x);

  function ensureUserMarker(latlngLocal) {
    if (!state.userMarker) {
      state.userMarker = L.circleMarker(latlngLocal, {
        radius: 6,
        color: '#2563eb',
        fillColor: '#2563eb',
        fillOpacity: 0.9,
      }).addTo(state.photoMap);
    } else {
      state.userMarker.setLatLng(latlngLocal);
    }
  }

  function updateAccuracyCircle(latlngLocal, ring) {
    if (!ring || !ring.pixelRadius) {
      return;
    }
    if (!state.accuracyCircle) {
      state.accuracyCircle = L.circle(latlngLocal, {
        radius: ring.pixelRadius,
        color: ring.color,
        weight: 1,
        fillColor: ring.color,
        fillOpacity: 0.15,
      }).addTo(state.photoMap);
    } else {
      state.accuracyCircle.setLatLng(latlngLocal);
      state.accuracyCircle.setRadius(ring.pixelRadius);
      state.accuracyCircle.setStyle({ color: ring.color, fillColor: ring.color });
    }
  }

  ensureUserMarker(latlng);

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

  state.geoWatchId = navigator.geolocation.watchPosition(
    (position) => {
      state.lastPosition = position;
      state.lastGpsUpdate = Date.now();
      updateGpsStatus(`Live position · accuracy ±${Math.round(position.coords.accuracy)} m`, false);
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
  state.activePair = { pixel: null, wgs84: null };
  clearActivePairMarkers();
  updatePairStatus();
  dom.addPairButton.disabled = true;
  if (!isGuidedActive()) {
    showToast('Tap the photo to drop the pixel anchor.');
  }
}

function cancelPairMode() {
  state.activePair = null;
  clearActivePairMarkers();
  updatePairStatus();
  dom.addPairButton.disabled = isGuidedActive();
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
  if (!isGuidedActive()) {
    const residual =
      state.calibration && Array.isArray(state.calibration.residuals)
        ? state.calibration.residuals[savedIndex]
        : null;
    const residualText = residual !== null && residual !== undefined ? `${residual.toFixed(1)} m` : '—';
    const tone = residual !== null && residual <= 30 ? 'success' : 'info';
    showToast(`Pair ${savedIndex + 1} saved — residual ${residualText}.`, { tone });
  }
  showGuidedPairSavedToast(savedIndex);
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
  if (!state.activePair) {
    return;
  }
  const pixel = { x: event.latlng.lng, y: event.latlng.lat };
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

function recalculateCalibration() {
  if (state.pairs.length < 2) {
    state.calibration = null;
    refreshPairMarkers();
    updateStatusText();
    stopGeolocationWatch();
    return;
  }

  const result = calibrateMap(state.pairs);
  state.calibration = result.status === 'ok' ? result : null;

  if (!state.calibration) {
    updateGpsStatus(result.message || 'Calibration failed. Add more pairs.', true);
    state.userMarker = null;
    if (state.accuracyCircle) {
      state.accuracyCircle.remove();
      state.accuracyCircle = null;
    }
  } else {
    updateGpsStatus('Calibration ready. Live mode active.', false);
    startGeolocationWatch();
  }

  renderPairList();
  refreshPairMarkers();
  updateStatusText();
  updateLivePosition();
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

  state.imageDataUrl = dataUrl;
  state.imageSize = { width, height };
  state.pairs = [];
  state.calibration = null;
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
  updateGpsStatus('Photo loaded. Guided pairing active — follow the prompts.', false);
  startGuidedPairing();
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
      setView: 'always',
      flyTo: false,
      cacheLocation: true,
      showPopup: false,
    });

    state.osmLocateControl = locateControl.addTo(state.osmMap);

    try {
      updateGpsStatus('Locating your position…', false);
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

function requestAndCenterOsmOnUser() {
  if (state.osmLocateControl) {
    try {
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
    },
    () => {
      // ignore errors – keep default view
      updateGpsStatus('Could not get your location right now.', true);
    },
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 },
  );
}

function maybePromptGeolocationForOsm() {
  // If we already have a recent position, prefer that immediately
  if (state.lastPosition && Date.now() - (state.lastGpsUpdate || 0) <= 5_000) {
    const { latitude, longitude } = state.lastPosition.coords;
    centerOsmOnLatLon(latitude, longitude);
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

  // Try Permissions API to avoid unnecessary prompt where already denied/granted
  const doRequest = () => {
    if (shouldPrompt) state.osmGeoPrompted = true;
    requestAndCenterOsmOnUser();
  };

  if (navigator.permissions && navigator.permissions.query) {
    try {
      navigator.permissions
        .query({ name: 'geolocation' })
        .then((status) => {
          if (status.state === 'granted') {
            // No prompt needed; just center
            requestAndCenterOsmOnUser();
          } else if (status.state === 'prompt') {
            // Only trigger the browser prompt the first time we open OSM
            if (shouldPrompt) doRequest();
          }
          // if denied → do nothing
        })
        .catch(() => {
          if (shouldPrompt) doRequest();
        });
    } catch (_) {
      if (shouldPrompt) doRequest();
    }
  } else {
    if (shouldPrompt) doRequest();
  }
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
  dom.photoView = $('photoView');
  dom.osmView = $('osmView');
  dom.photoTabButton = $('photoTabButton');
  dom.osmTabButton = $('osmTabButton');
  dom.pairTable = $('pairTable');
  dom.toastContainer = $('toastContainer');
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
}

function init() {
  cacheDom();
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
};
