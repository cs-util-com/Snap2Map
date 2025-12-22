
describe('Scale and Measure UI integration', () => {
  let state;
  let checkScaleDisagreement;
  let saveSettings;
  let loadSettings;
  let recalculateCalibration;
  let handleDistanceModalConfirm;
  let handleDistanceModalCancel;
  let cacheDom;

  function setupLeafletMock() {
    const mapMock = {
      on: jest.fn(),
      setView: jest.fn(() => mapMock),
      invalidateSize: jest.fn(),
      fitBounds: jest.fn(),
      setMaxBounds: jest.fn(),
      getZoom: jest.fn(() => 11),
    };

    const locateControlMock = {
      addTo: jest.fn(() => locateControlMock),
      start: jest.fn(),
    };

    global.L = {
      map: jest.fn(() => mapMock),
      tileLayer: jest.fn(() => ({
        addTo: jest.fn(),
      })),
      control: {
        locate: jest.fn(() => locateControlMock),
      },
      latLng: jest.fn((lat, lon) => ({ lat, lon })),
      marker: jest.fn(() => ({
        addTo: jest.fn(),
        on: jest.fn(),
        remove: jest.fn(),
      })),
      polyline: jest.fn(() => ({
        addTo: jest.fn(),
        on: jest.fn(),
        remove: jest.fn(),
      })),
      divIcon: jest.fn(),
      imageOverlay: jest.fn(() => ({
        addTo: jest.fn(),
        remove: jest.fn(),
      })),
      CRS: { Simple: {} },
      DomEvent: { stopPropagation: jest.fn(), on: jest.fn() },
    };
  }

  function setupDomMock() {
    document.body.innerHTML = `
      <div id="photoMap"></div>
      <div id="osmMap"></div>
      <div id="calibrationStatus"></div>
      <div id="calibrationBadge"></div>
      <div id="residualSummary"></div>
      <div id="accuracyDetails"></div>
      <div id="gpsStatus"></div>
      <div id="scaleWarning" class="hidden"></div>
      <div id="distanceModal" class="hidden"></div>
      <input id="distanceInput" />
      <select id="distanceUnit">
        <option value="m">Meters</option>
        <option value="ft">Feet</option>
        <option value="ft-in">Feet & Inches</option>
      </select>
      <div id="distanceError" class="hidden"></div>
      <button id="distanceCancelBtn"></button>
      <button id="distanceConfirmBtn"></button>
      <select id="globalUnitSelect"></select>
      <button id="setScaleButton"></button>
      <button id="measureButton"></button>
      <button id="clearMeasurementsButton"></button>
      <div id="toastContainer"></div>
      <div id="photoView"></div>
      <div id="osmView"></div>
      <button id="photoTabButton"></button>
      <button id="osmTabButton"></button>
      <button id="addPairButton"></button>
      <button id="usePositionButton"></button>
      <button id="confirmPairButton"></button>
      <button id="cancelPairButton"></button>
      <div id="pairStatus"></div>
      <div id="replacePhotoButton"></div>
      <input id="mapImageInput" type="file" />
      <table id="pairTable"><tbody id="pairTableBody"></tbody></table>
    `;
  }

  function setupLocalStorageMock() {
    const localStorageMock = (() => {
      let store = {};
      return {
        getItem: jest.fn(key => store[key] || null),
        setItem: jest.fn((key, value) => { store[key] = value.toString(); }),
        removeItem: jest.fn(key => { delete store[key]; }),
        clear: jest.fn(() => { store = {}; }),
      };
    })();
    Object.defineProperty(window, 'localStorage', { value: localStorageMock, configurable: true });
  }

  function setupCalibratorMock() {
    jest.mock('snap2map/calibrator', () => ({
      calibrateMap: jest.fn(() => ({ 
        status: 'ok', 
        kind: 'similarity',
        quality: { rmse: 0.1, maxResidual: 0.2 },
        statusMessage: { message: 'Calibrated' },
        model: { type: 'similarity', scale: 0.1 } 
      })),
      computeAccuracyRing: jest.fn(),
      projectLocationToPixel: jest.fn(),
      accuracyRingRadiusPixels: jest.fn(),
    }));
  }

  function loadModule() {
    jest.resetModules();
    
    setupLeafletMock();
    setupDomMock();
    setupLocalStorageMock();
    setupCalibratorMock();

    const indexModule = require('./index.js');
    ({ 
      state, 
      checkScaleDisagreement, 
      saveSettings, 
      loadSettings, 
      recalculateCalibration,
      handleDistanceModalConfirm,
      handleDistanceModalCancel,
      cacheDom
    } = indexModule.__testables);
    
    // Initialize DOM references and maps
    cacheDom();
    indexModule.__testables.setupMaps(); 
  }

  beforeEach(() => {
    loadModule();
  });

  afterEach(() => {
    delete global.L;
    window.localStorage.clear();
  });

  describe('Persistence', () => {
    it('saves settings to localStorage', () => {
      state.preferredUnit = 'ft';
      state.referenceDistance = { meters: 10, metersPerPixel: 0.1 };
      
      saveSettings();
      
      expect(window.localStorage.setItem).toHaveBeenCalledWith('snap2map_preferredUnit', 'ft');
      expect(window.localStorage.setItem).toHaveBeenCalledWith('snap2map_referenceDistance', JSON.stringify(state.referenceDistance));
    });

    it('loads settings from localStorage', () => {
      window.localStorage.getItem.mockImplementation((key) => {
        if (key === 'snap2map_preferredUnit') return 'ft-in';
        if (key === 'snap2map_referenceDistance') return JSON.stringify({ meters: 5, metersPerPixel: 0.05 });
        return null;
      });
      
      loadSettings();
      
      expect(state.preferredUnit).toBe('ft-in');
      expect(state.referenceDistance).toEqual({ meters: 5, metersPerPixel: 0.05 });
    });
  });

  describe('Scale Warning', () => {
    it('shows warning when scales disagree', () => {
      state.referenceDistance = { metersPerPixel: 0.1 };
      state.calibration = { 
        status: 'ok', 
        model: { type: 'similarity', scale: 0.05 } // 50% difference
      };
      
      const warningEl = document.getElementById('scaleWarning');
      checkScaleDisagreement();
      
      expect(warningEl.classList.contains('hidden')).toBe(false);
      expect(warningEl.textContent).toContain('Scale mismatch');
    });

    it('hides warning when scales agree', () => {
      state.referenceDistance = { metersPerPixel: 0.1 };
      state.calibration = { 
        status: 'ok', 
        model: { type: 'similarity', scale: 0.101 } // 1% difference
      };
      
      const warningEl = document.getElementById('scaleWarning');
      warningEl.classList.remove('hidden');
      
      checkScaleDisagreement();
      
      expect(warningEl.classList.contains('hidden')).toBe(true);
    });
  });

  describe('Hybrid Calibration', () => {
    it('passes referenceScale to calibrateMap', () => {
      const { calibrateMap } = require('snap2map/calibrator');
      state.pairs = [{ pixel: {x:0, y:0}, wgs84: {lat:0, lon:0} }, { pixel: {x:10, y:10}, wgs84: {lat:1, lon:1} }];
      state.referenceDistance = { metersPerPixel: 0.123 };
      
      recalculateCalibration();
      
      expect(calibrateMap).toHaveBeenCalledWith(
        state.pairs,
        expect.objectContaining({ referenceScale: 0.123 })
      );
    });
  });

  describe('Distance Modal', () => {
    it('updates state and saves on confirm', () => {
      state.scaleMode.logic = { active: true, step: 'input', p1: {x:0, y:0}, p2: {x:100, y:0} };
      document.getElementById('distanceInput').value = '10';
      document.getElementById('distanceUnit').value = 'm';
      
      handleDistanceModalConfirm();
      
      expect(state.referenceDistance).not.toBeNull();
      expect(state.referenceDistance.meters).toBe(10);
      expect(state.referenceDistance.metersPerPixel).toBe(0.1);
      expect(window.localStorage.setItem).toHaveBeenCalledWith('snap2map_referenceDistance', expect.any(String));
    });

    it('cancels scale mode on cancel and preserves existing reference distance', () => {
      const existingReference = { meters: 5, metersPerPixel: 0.05 };
      state.referenceDistance = existingReference;
      state.scaleMode.logic = { active: true, step: 'input', p1: {x:0, y:0}, p2: {x:100, y:0} };
      
      handleDistanceModalCancel();
      
      expect(state.scaleMode.logic.active).toBe(false);
      expect(state.referenceDistance).toEqual(existingReference);
    });
  });
});
