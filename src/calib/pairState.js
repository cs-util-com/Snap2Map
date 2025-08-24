/**
 * @file src/calib/pairState.js
 * @description Manages the state of the reference pair currently being created or edited.
 */

const state = {
  pixel: null, // {x, y}
  wgs84: null, // {lat, lon}
  pixelMarker: null, // L.Marker instance
  wgs84Marker: null, // L.Marker instance
};

export function setPixel(point, marker) {
  state.pixel = point;
  state.pixelMarker = marker;
  console.log('Active pair PIXEL set:', state.pixel);
}

export function setWgs84(point, marker) {
  state.wgs84 = point;
  state.wgs84Marker = marker;
  console.log('Active pair WGS84 set:', state.wgs84);
}

export function getActivePairData() {
  return {
    pixel: state.pixel,
    wgs84: state.wgs84,
  };
}

export function getActivePairMarkers() {
    return [state.pixelMarker, state.wgs84Marker].filter(m => m !== null);
}

export function isPairComplete() {
  return state.pixel !== null && state.wgs84 !== null;
}

export function resetActivePair() {
  state.pixel = null;
  state.wgs84 = null;
  state.pixelMarker = null;
  state.wgs84Marker = null;
  console.log('Active pair state has been reset.');
}
