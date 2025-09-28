describe('OpenStreetMap locate control integration', () => {
  let mapHandlers;
  let locateControlInstance;
  let mapInstance;
  let tileLayerInstance;
  let setupMaps;
  let state;
  let maybePromptGeolocationForOsm;

  function loadModule({ includeLocateControlOn = true } = {}) {
    jest.resetModules();
    mapHandlers = {};

    jest.mock('snap2map/calibrator', () => ({
      calibrateMap: jest.fn(),
      computeAccuracyRing: jest.fn(),
      projectLocationToPixel: jest.fn(),
      accuracyRingRadiusPixels: jest.fn(),
    }));

    mapInstance = {
      setView: jest.fn(() => mapInstance),
      on: jest.fn((event, handler) => {
        mapHandlers[event] = handler;
        return mapInstance;
      }),
      getZoom: jest.fn(() => 11),
    };

    tileLayerInstance = {
      addTo: jest.fn(() => tileLayerInstance),
    };

    locateControlInstance = {
      addTo: jest.fn(() => locateControlInstance),
      start: jest.fn(),
    };

    if (includeLocateControlOn) {
      locateControlInstance.on = jest.fn();
    }

    global.L = {
      map: jest.fn(() => mapInstance),
      tileLayer: jest.fn(() => tileLayerInstance),
      control: {
        locate: jest.fn(() => locateControlInstance),
      },
      latLng: jest.fn((lat, lon) => ({ lat, lon })),
    };

    document.body.innerHTML = '<div id="osmMap"></div>';

    ({ __testables: { setupMaps, state, maybePromptGeolocationForOsm } } = require('./index.js'));
  }

  afterEach(() => {
    jest.resetModules();
    delete global.L;
  });

  it('configures and starts the locate control', () => {
    loadModule();

    setupMaps();

    expect(global.L.control.locate).toHaveBeenCalledWith(
      expect.objectContaining({
        setView: 'always',
        flyTo: false,
        cacheLocation: true,
        showPopup: false,
      }),
    );
    expect(locateControlInstance.addTo).toHaveBeenCalledWith(mapInstance);
    expect(locateControlInstance.start).toHaveBeenCalledTimes(1);
    expect(state.osmLocateControl).toBe(locateControlInstance);
    expect(mapInstance.on).toHaveBeenCalledWith('locationfound', expect.any(Function));
    expect(mapInstance.on).toHaveBeenCalledWith('locationerror', expect.any(Function));
    expect(mapHandlers.locationfound).toBeInstanceOf(Function);
    expect(mapHandlers.locationerror).toBeInstanceOf(Function);
    expect(state.osmLocateHandlersAttached).toBe(true);
    expect(locateControlInstance.on).not.toHaveBeenCalled();
  });

  it('updates state when the locate control reports a fix', () => {
    loadModule();

    setupMaps();

    const fixedNow = 1700000000000;
    jest.spyOn(Date, 'now').mockReturnValue(fixedNow);

    const handler = mapHandlers.locationfound;
    expect(handler).toBeInstanceOf(Function);

    handler({
      latlng: { lat: 51.5, lng: -0.12 },
      accuracy: 8.4,
    });

    expect(state.lastPosition).toEqual({
      coords: {
        latitude: 51.5,
        longitude: -0.12,
        accuracy: 8.4,
      },
      timestamp: fixedNow,
    });
    expect(state.lastGpsUpdate).toBe(fixedNow);

    Date.now.mockRestore();
  });

  it('does not rely on the locate control exposing an event API', () => {
    loadModule({ includeLocateControlOn: false });

    expect(() => setupMaps()).not.toThrow();

    expect(mapHandlers.locationfound).toBeInstanceOf(Function);
    expect(locateControlInstance.start).toHaveBeenCalledTimes(1);
    expect(state.osmLocateControl).toBe(locateControlInstance);
  });

  it('restarts locating when the OSM view prompts for geolocation', () => {
    loadModule();

    setupMaps();
    locateControlInstance.start.mockClear();

    maybePromptGeolocationForOsm();

    expect(locateControlInstance.start).toHaveBeenCalledTimes(1);
  });
});
