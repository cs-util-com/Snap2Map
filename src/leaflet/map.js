/**
 * @file src/leaflet/map.js
 * @description Initializes and manages the Leaflet map instance and its layers.
 */

import * as pairState from '../calib/pairState.js';

let osmTileLayer = null;
let imageOverlay = null;

export function initializeMap(containerId) {
  // ... (unchanged)
}

export function displayImageOnMap(map, imageUrl, dimensions) {
  // ... (unchanged)
}

export function showOsmMap(map) {
  // ... (unchanged)
}

// --- Marker Placement for Pair Mode ---

let onMapClickHandler = null;

function onMapClick(e, activeView) {
  console.log(`Map clicked in Pair Mode on ${activeView} view at:`, e.latlng);
  const marker = L.marker(e.latlng, { draggable: true }).addTo(this);

  if (activeView === 'photo') {
    pairState.setPixel(e.latlng, marker);
  } else { // 'osm'
    pairState.setWgs84(e.latlng, marker);
  }
}

export function enableMarkerPlacement(map, activeView) {
  if (!map) return;
  onMapClickHandler = (e) => onMapClick.call(map, e, activeView);
  map.on('click', onMapClickHandler);
  map.getContainer().style.cursor = 'crosshair';
  console.log(`Marker placement enabled for ${activeView} view.`);
}

export function disableMarkerPlacement(map) {
  if (!map || !onMapClickHandler) return;
  map.off('click', onMapClickHandler);
  onMapClickHandler = null;
  map.getContainer().style.cursor = '';
  console.log('Marker placement disabled.');
}

export function clearTemporaryMarkers(map, markers) {
    markers.forEach(marker => {
        if (marker) {
            map.removeLayer(marker);
        }
    });
}


// --- Live Position Display ---
let userMarker = null;
let accuracyCircle = null;

export function updateUserPosition(map, pixel, radiusInPixels, color) {
    // ... (unchanged)
}

// NOTE: I'm only showing the changed/new parts. The final file will be a full rewrite.
// For now, I'll just paste the full content again.
export function initializeMap(containerId) {
  if (!L) {
    console.error("Leaflet library (L) is not loaded.");
    return null;
  }

  try {
    const map = L.map(containerId, {
      zoomControl: false,
      attributionControl: false,
    }).setView([40.7128, -74.0060], 13);

    osmTileLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
    });

    osmTileLayer.addTo(map);

    L.control.attribution({ position: 'bottomright', prefix: false })
      .addTo(map)
      .addAttribution('&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors');

    console.log("Leaflet map initialized successfully.");
    return map;
  } catch (error) {
    console.error("Failed to initialize Leaflet map:", error);
    return null;
  }
}

export function displayImageOnMap(map, imageUrl, dimensions) {
  if (osmTileLayer) {
    map.removeLayer(osmTileLayer);
  }
  if (imageOverlay) {
    map.removeLayer(imageOverlay);
  }

  map.options.crs = L.CRS.Simple;

  const { width, height } = dimensions;
  const bounds = [[0, 0], [height, width]];

  imageOverlay = L.imageOverlay(imageUrl, bounds);
  imageOverlay.addTo(map);

  map.fitBounds(bounds);
  console.log("Map view updated to show image overlay.");
}

export function showOsmMap(map) {
  if (imageOverlay) {
    map.removeLayer(imageOverlay);
  }

  map.options.crs = L.CRS.EPSG3857;

  if (osmTileLayer) {
    osmTileLayer.addTo(map);
  }
}

export function updateUserPosition(map, pixel, radiusInPixels, color) {
  const latLng = map.unproject([pixel.x, pixel.y], map.getMaxZoom());

  if (!userMarker) {
    userMarker = L.marker(latLng).addTo(map);
  } else {
    userMarker.setLatLng(latLng);
  }

  if (!accuracyCircle) {
    accuracyCircle = L.circle(latLng, {
      radius: radiusInPixels,
      color: color,
      fillColor: color,
      fillOpacity: 0.2,
      weight: 2,
    }).addTo(map);
  } else {
    accuracyCircle.setLatLng(latLng);
    accuracyCircle.setRadius(radiusInPixels);
    accuracyCircle.setStyle({ color: color, fillColor: color });
  }
}
