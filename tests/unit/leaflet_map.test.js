/* eslint-env jest */


// Provide minimal L mock with chaining support for circle
global.L = {
  marker: (latlng) => ({ addTo: (map) => { return { _latlng: latlng, setLatLng: function(l){ this._latlng = l; return this; }, addTo: ()=>{} }; } }),
  circle: (latlng, opts) => ({ addTo: (map) => ({ _latlng: latlng, _opts: opts, setLatLng: function(l){ this._latlng = l; return this; }, setRadius: function(r){ this._radius = r; return this; }, setStyle: function(){ return this; } }) }),
  CRS: { Simple: {}, EPSG3857: {} },
  tileLayer: () => ({ addTo: () => {}, remove: () => {} }),
  imageOverlay: () => ({ addTo: () => {} }),
  map: () => ({})
};

const pairState = require('../../src/calib/pairState.js');
// spy on pairState functions so calls from the map module are observable
jest.spyOn(pairState, 'setPixel');
jest.spyOn(pairState, 'setWgs84');
jest.spyOn(pairState, 'getActivePairMarkers');
jest.spyOn(pairState, 'resetActivePair');

describe('leaflet map integration (unit)', () => {
  beforeEach(() => {
  // create a fake map object per test
  });

  test('enableMarkerPlacement registers click handler and calls pairState.setPixel for photo view', () => {
    const mapModule = require('../../src/leaflet/map.js');

    const handlers = {};
    const fakeMap = {
      on: (evt, h) => { handlers[evt] = h; },
      off: (evt, h) => { if (handlers[evt] && handlers[evt] === h) delete handlers[evt]; },
      getContainer: () => ({ style: {} }),
      removeLayer: jest.fn(),
      options: {},
    };

    mapModule.enableMarkerPlacement(fakeMap, 'photo');

    // simulate a click event: latlng will be forwarded to marker creation
  const clickEvent = { latlng: { lat: 1, lng: 2 } };
    expect(typeof handlers.click).toBe('function');
    handlers.click(clickEvent);

    expect(pairState.setPixel).toHaveBeenCalled();

    // disable placement
    mapModule.disableMarkerPlacement(fakeMap);
  });

  test('updateUserPosition creates marker and circle then updates them', () => {
    jest.resetModules();
    const mapModule = require('../../src/leaflet/map.js');

    // fake map that records calls
    let lastLatLng = null;
    const fakeMap = {
      unproject: ([x, y]) => ({ lat: x + 0.1, lng: y + 0.2 }),
      getMaxZoom: () => 18,
      removeLayer: jest.fn(),
      options: {},
    };

    // first call should create marker and circle without throwing
    expect(() => mapModule.updateUserPosition(fakeMap, { x: 10, y: 20 }, 5, 'green')).not.toThrow();

    // second call should update existing marker and circle without throwing
    expect(() => mapModule.updateUserPosition(fakeMap, { x: 15, y: 25 }, 8, 'yellow')).not.toThrow();
  });
});
