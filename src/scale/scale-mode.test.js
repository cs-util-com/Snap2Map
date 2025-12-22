import {
  createScaleModeState,
  startScaleModeState,
  handleScaleModePoint,
  validateDistanceInput,
  computeReferenceDistanceFromInput,
  cancelScaleModeState,
  createMeasureModeState,
  canStartMeasureMode,
  startMeasureModeState,
  handleMeasureModePoint,
  updateMeasureModePoint,
  computeMeasurement,
  cancelMeasureModeState,
  shouldEnableMeasureButton,
  shouldEnableSetScaleButton,
} from './scale-mode.js';

describe('scale-mode state machine', () => {
  // ─────────────────────────────────────────────────────────────────────────
  // Scale Mode Tests
  // ─────────────────────────────────────────────────────────────────────────

  describe('createScaleModeState', () => {
    test('creates inactive state with null values', () => {
      const state = createScaleModeState();
      expect(state).toEqual({
        active: false,
        step: null,
        p1: null,
        p2: null,
      });
    });
  });

  describe('startScaleModeState', () => {
    test('activates mode and sets step to p1', () => {
      const initial = createScaleModeState();
      const started = startScaleModeState(initial);
      expect(started).toEqual({
        active: true,
        step: 'p1',
        p1: null,
        p2: null,
      });
    });

    test('preserves other properties and resets points', () => {
      const withPoints = { active: false, step: null, p1: { x: 10, y: 20 }, p2: { x: 30, y: 40 } };
      const started = startScaleModeState(withPoints);
      expect(started.p1).toBeNull();
      expect(started.p2).toBeNull();
    });
  });

  describe('handleScaleModePoint', () => {
    test('returns unchanged state when not active', () => {
      const inactive = createScaleModeState();
      const { state, action } = handleScaleModePoint(inactive, { x: 100, y: 200 });
      expect(state).toEqual(inactive);
      expect(action).toBeNull();
    });

    test('handles p1 click - stores point and advances to p2', () => {
      const atP1 = startScaleModeState(createScaleModeState());
      const point = { x: 100, y: 200 };
      const { state, action } = handleScaleModePoint(atP1, point);
      
      expect(state.p1).toEqual(point);
      expect(state.step).toBe('p2');
      expect(state.active).toBe(true);
      expect(action).toBe('show-p2-toast');
    });

    test('handles p2 click - stores point and advances to input', () => {
      const atP2 = {
        active: true,
        step: 'p2',
        p1: { x: 100, y: 200 },
        p2: null,
      };
      const point = { x: 300, y: 400 };
      const { state, action } = handleScaleModePoint(atP2, point);
      
      expect(state.p2).toEqual(point);
      expect(state.step).toBe('input');
      expect(action).toBe('prompt-distance');
    });

    test('ignores click during input step', () => {
      const atInput = {
        active: true,
        step: 'input',
        p1: { x: 100, y: 200 },
        p2: { x: 300, y: 400 },
      };
      const { state, action } = handleScaleModePoint(atInput, { x: 500, y: 600 });
      expect(state).toEqual(atInput);
      expect(action).toBeNull();
    });
  });

  describe('validateDistanceInput', () => {
    test('returns cancelled for null input', () => {
      expect(validateDistanceInput(null)).toEqual({ valid: false, error: 'cancelled' });
    });

    test('returns invalid for empty string', () => {
      expect(validateDistanceInput('')).toEqual({ valid: false, error: 'invalid-number' });
    });

    test('returns invalid for non-numeric string', () => {
      expect(validateDistanceInput('abc')).toEqual({ valid: false, error: 'invalid-number' });
    });

    test('returns invalid for zero', () => {
      expect(validateDistanceInput('0')).toEqual({ valid: false, error: 'invalid-number' });
    });

    test('returns invalid for negative number', () => {
      expect(validateDistanceInput('-5')).toEqual({ valid: false, error: 'invalid-number' });
    });

    test('returns valid for positive number', () => {
      expect(validateDistanceInput('10.5')).toEqual({ valid: true, meters: 10.5 });
    });

    test('returns valid for integer string', () => {
      expect(validateDistanceInput('7')).toEqual({ valid: true, meters: 7 });
    });

    test('handles whitespace around number', () => {
      expect(validateDistanceInput('  5.25  ')).toEqual({ valid: true, meters: 5.25 });
    });

    test('handles feet conversion', () => {
      const result = validateDistanceInput('10', 'ft');
      expect(result.valid).toBe(true);
      expect(result.meters).toBeCloseTo(10 / 3.28084);
    });
  });

  describe('computeReferenceDistanceFromInput', () => {
    test('returns error for missing p1', () => {
      const state = { p1: null, p2: { x: 100, y: 0 } };
      expect(computeReferenceDistanceFromInput(state, 10)).toEqual({
        success: false,
        error: 'missing-points',
      });
    });

    test('returns error for missing p2', () => {
      const state = { p1: { x: 0, y: 0 }, p2: null };
      expect(computeReferenceDistanceFromInput(state, 10)).toEqual({
        success: false,
        error: 'missing-points',
      });
    });

    test('returns error for coincident points', () => {
      const state = { p1: { x: 50, y: 50 }, p2: { x: 50, y: 50 } };
      expect(computeReferenceDistanceFromInput(state, 10)).toEqual({
        success: false,
        error: 'computation-failed',
      });
    });

    test('computes correct reference distance', () => {
      const state = { p1: { x: 0, y: 0 }, p2: { x: 100, y: 0 } };
      const result = computeReferenceDistanceFromInput(state, 10);
      
      expect(result.success).toBe(true);
      expect(result.referenceDistance).toEqual({
        p1: { x: 0, y: 0 },
        p2: { x: 100, y: 0 },
        meters: 10,
        metersPerPixel: 0.1,
      });
    });

    test('computes diagonal distance correctly', () => {
      const state = { p1: { x: 0, y: 0 }, p2: { x: 30, y: 40 } }; // 50px distance
      const result = computeReferenceDistanceFromInput(state, 5);
      
      expect(result.success).toBe(true);
      expect(result.referenceDistance.metersPerPixel).toBe(0.1);
    });
  });

  describe('cancelScaleModeState', () => {
    test('returns inactive state', () => {
      const cancelled = cancelScaleModeState();
      expect(cancelled).toEqual(createScaleModeState());
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Measure Mode Tests
  // ─────────────────────────────────────────────────────────────────────────

  describe('createMeasureModeState', () => {
    test('creates inactive state with null values', () => {
      const state = createMeasureModeState();
      expect(state).toEqual({
        active: false,
        step: null,
        p1: null,
        p2: null,
      });
    });
  });

  describe('canStartMeasureMode', () => {
    test('returns false when no scale available', () => {
      const appState = { referenceDistance: null, calibration: null };
      const result = canStartMeasureMode(appState);
      expect(result).toEqual({ canStart: false, reason: 'no-scale' });
    });

    test('returns true with manual reference', () => {
      const appState = { 
        referenceDistance: { metersPerPixel: 0.1 }, 
        calibration: null 
      };
      const result = canStartMeasureMode(appState);
      expect(result.canStart).toBe(true);
      expect(result.scale).toEqual({ metersPerPixel: 0.1, source: 'manual' });
    });

    test('returns true with GPS calibration', () => {
      const appState = { 
        referenceDistance: null, 
        calibration: { status: 'ok', model: { type: 'similarity', scale: 0.05 } }
      };
      const result = canStartMeasureMode(appState);
      expect(result.canStart).toBe(true);
      expect(result.scale).toEqual({ metersPerPixel: 0.05, source: 'gps' });
    });
  });

  describe('startMeasureModeState', () => {
    test('activates mode and sets step to p1', () => {
      const initial = createMeasureModeState();
      const started = startMeasureModeState(initial);
      expect(started).toEqual({
        active: true,
        step: 'p1',
        p1: null,
        p2: null,
      });
    });
  });

  describe('handleMeasureModePoint', () => {
    test('returns unchanged state when not active', () => {
      const inactive = createMeasureModeState();
      const { state, action } = handleMeasureModePoint(inactive, { x: 100, y: 200 });
      expect(state).toEqual(inactive);
      expect(action).toBeNull();
    });

    test('handles p1 click - stores point and advances to p2', () => {
      const atP1 = startMeasureModeState(createMeasureModeState());
      const point = { x: 100, y: 200 };
      const { state, action } = handleMeasureModePoint(atP1, point);
      
      expect(state.p1).toEqual(point);
      expect(state.step).toBe('p2');
      expect(action).toBe('show-p2-toast');
    });

    test('handles p2 click - completes measurement', () => {
      const atP2 = {
        active: true,
        step: 'p2',
        p1: { x: 100, y: 200 },
        p2: null,
      };
      const point = { x: 300, y: 400 };
      const { state, action } = handleMeasureModePoint(atP2, point);
      
      expect(state.p2).toEqual(point);
      expect(state.step).toBeNull(); // Null = complete, endpoints draggable
      expect(state.active).toBe(true);
      expect(action).toBe('measurement-complete');
    });

    test('ignores click after measurement complete', () => {
      const complete = {
        active: true,
        step: null,
        p1: { x: 100, y: 200 },
        p2: { x: 300, y: 400 },
      };
      const { state, action } = handleMeasureModePoint(complete, { x: 500, y: 600 });
      expect(state).toEqual(complete);
      expect(action).toBeNull();
    });
  });

  describe('updateMeasureModePoint', () => {
    test('returns unchanged state when not active', () => {
      const inactive = createMeasureModeState();
      const result = updateMeasureModePoint(inactive, 'p1', { x: 50, y: 50 });
      expect(result).toEqual(inactive);
    });

    test('returns unchanged state when step is not null (still placing points)', () => {
      const placingP2 = {
        active: true,
        step: 'p2',
        p1: { x: 100, y: 200 },
        p2: null,
      };
      const result = updateMeasureModePoint(placingP2, 'p1', { x: 50, y: 50 });
      expect(result).toEqual(placingP2);
    });

    test('updates p1 when measurement is complete', () => {
      const complete = {
        active: true,
        step: null,
        p1: { x: 100, y: 200 },
        p2: { x: 300, y: 400 },
      };
      const result = updateMeasureModePoint(complete, 'p1', { x: 150, y: 250 });
      expect(result.p1).toEqual({ x: 150, y: 250 });
      expect(result.p2).toEqual({ x: 300, y: 400 });
    });

    test('updates p2 when measurement is complete', () => {
      const complete = {
        active: true,
        step: null,
        p1: { x: 100, y: 200 },
        p2: { x: 300, y: 400 },
      };
      const result = updateMeasureModePoint(complete, 'p2', { x: 350, y: 450 });
      expect(result.p1).toEqual({ x: 100, y: 200 });
      expect(result.p2).toEqual({ x: 350, y: 450 });
    });
  });

  describe('computeMeasurement', () => {
    test('returns error for missing p1', () => {
      const measureState = { p1: null, p2: { x: 100, y: 0 } };
      const appState = { referenceDistance: { metersPerPixel: 0.1 } };
      expect(computeMeasurement(measureState, appState)).toEqual({
        success: false,
        error: 'missing-points',
      });
    });

    test('returns error for missing p2', () => {
      const measureState = { p1: { x: 0, y: 0 }, p2: null };
      const appState = { referenceDistance: { metersPerPixel: 0.1 } };
      expect(computeMeasurement(measureState, appState)).toEqual({
        success: false,
        error: 'missing-points',
      });
    });

    test('returns error for no scale', () => {
      const measureState = { p1: { x: 0, y: 0 }, p2: { x: 100, y: 0 } };
      const appState = { referenceDistance: null, calibration: null };
      expect(computeMeasurement(measureState, appState)).toEqual({
        success: false,
        error: 'no-scale',
      });
    });

    test('returns error when measureDistance fails (invalid point coordinates)', () => {
      // Points have non-numeric coordinates, which passes the p1/p2 null check
      // but fails in measureDistance's arePointsValid check
      const measureState = { p1: { x: 'invalid', y: 0 }, p2: { x: 100, y: 0 } };
      const appState = { referenceDistance: { metersPerPixel: 0.1 } };
      expect(computeMeasurement(measureState, appState)).toEqual({
        success: false,
        error: 'computation-failed',
      });
    });

    test('computes distance with manual scale', () => {
      const measureState = { p1: { x: 0, y: 0 }, p2: { x: 100, y: 0 } };
      const appState = { referenceDistance: { metersPerPixel: 0.1 }, calibration: null };
      const result = computeMeasurement(measureState, appState);
      
      expect(result.success).toBe(true);
      expect(result.meters).toBe(10); // 100px * 0.1 m/px
      expect(result.source).toBe('manual');
    });

    test('computes distance with GPS scale', () => {
      const measureState = { p1: { x: 0, y: 0 }, p2: { x: 200, y: 0 } };
      const appState = { 
        referenceDistance: null, 
        calibration: { status: 'ok', model: { type: 'similarity', scale: 0.05 } }
      };
      const result = computeMeasurement(measureState, appState);
      
      expect(result.success).toBe(true);
      expect(result.meters).toBe(10); // 200px * 0.05 m/px
      expect(result.source).toBe('gps');
    });

    test('prioritizes manual scale over GPS', () => {
      const measureState = { p1: { x: 0, y: 0 }, p2: { x: 100, y: 0 } };
      const appState = { 
        referenceDistance: { metersPerPixel: 0.1 },
        calibration: { status: 'ok', model: { type: 'similarity', scale: 0.05 } }
      };
      const result = computeMeasurement(measureState, appState);
      
      expect(result.meters).toBe(10); // Uses 0.1, not 0.05
      expect(result.source).toBe('manual');
    });
  });

  describe('cancelMeasureModeState', () => {
    test('returns inactive state', () => {
      const cancelled = cancelMeasureModeState();
      expect(cancelled).toEqual(createMeasureModeState());
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // UI State Derivation Tests
  // ─────────────────────────────────────────────────────────────────────────

  describe('shouldEnableMeasureButton', () => {
    test('returns false when no scale available', () => {
      const appState = { referenceDistance: null, calibration: null };
      const measureState = createMeasureModeState();
      expect(shouldEnableMeasureButton(appState, measureState)).toBe(false);
    });

    test('returns true when scale available and mode inactive', () => {
      const appState = { referenceDistance: { metersPerPixel: 0.1 }, calibration: null };
      const measureState = createMeasureModeState();
      expect(shouldEnableMeasureButton(appState, measureState)).toBe(true);
    });

    test('returns false while placing points', () => {
      const appState = { referenceDistance: { metersPerPixel: 0.1 }, calibration: null };
      const measureState = { active: true, step: 'p1', p1: null, p2: null };
      expect(shouldEnableMeasureButton(appState, measureState)).toBe(false);
    });

    test('returns true after measurement complete (step is null)', () => {
      const appState = { referenceDistance: { metersPerPixel: 0.1 }, calibration: null };
      const measureState = { 
        active: true, 
        step: null, 
        p1: { x: 0, y: 0 }, 
        p2: { x: 100, y: 0 } 
      };
      expect(shouldEnableMeasureButton(appState, measureState)).toBe(true);
    });
  });

  describe('shouldEnableSetScaleButton', () => {
    test('returns true when scale mode inactive', () => {
      const scaleState = createScaleModeState();
      expect(shouldEnableSetScaleButton(scaleState)).toBe(true);
    });

    test('returns false when scale mode active', () => {
      const scaleState = startScaleModeState(createScaleModeState());
      expect(shouldEnableSetScaleButton(scaleState)).toBe(false);
    });
  });
});
