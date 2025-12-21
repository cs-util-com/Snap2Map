/**
 * Scale and Measure mode state machine logic.
 * This module contains pure functions for managing the scale/measure mode state,
 * separating business logic from DOM/Leaflet interactions.
 */

import { computeReferenceScale, getActiveScale, measureDistance } from './scale.js';

// ─────────────────────────────────────────────────────────────────────────────
// Shared Two-Point Mode Handler
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generic handler for two-point mode click events.
 * @param {Object} currentState - Current mode state
 * @param {Object} point - The clicked point {x, y}
 * @param {string} p2Action - Action to return when p2 is clicked
 * @param {string} p2NextStep - Next step after p2 click (e.g., 'input' or null)
 * @returns {{ state: Object, action: string | null }}
 */
function handleTwoPointModeClick(currentState, point, p2Action, p2NextStep) {
  if (!currentState.active) {
    return { state: currentState, action: null };
  }

  if (currentState.step === 'p1') {
    return {
      state: { ...currentState, p1: point, step: 'p2' },
      action: 'show-p2-toast',
    };
  }

  if (currentState.step === 'p2') {
    return {
      state: { ...currentState, p2: point, step: p2NextStep },
      action: p2Action,
    };
  }

  return { state: currentState, action: null };
}

// ─────────────────────────────────────────────────────────────────────────────
// Scale Mode State Machine
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Creates the initial scale mode state.
 * @returns {Object} Initial scale mode state
 */
export function createScaleModeState() {
  return {
    active: false,
    step: null, // 'p1' | 'p2' | 'input' | null
    p1: null,
    p2: null,
  };
}

/**
 * Starts the scale mode, returning the new state.
 * @param {Object} currentState - Current scale mode state
 * @returns {Object} New state with mode activated
 */
export function startScaleModeState(currentState) {
  return {
    ...currentState,
    active: true,
    step: 'p1',
    p1: null,
    p2: null,
  };
}

/**
 * Handles a point click during scale mode.
 * @param {Object} currentState - Current scale mode state
 * @param {Object} point - The clicked point {x, y}
 * @returns {{ state: Object, action: string | null }} New state and action to perform
 */
export function handleScaleModePoint(currentState, point) {
  return handleTwoPointModeClick(currentState, point, 'prompt-distance', 'input');
}

/**
 * Validates and processes the user's distance input.
 * @param {string | null} input - Raw user input from prompt
 * @returns {{ valid: boolean, meters?: number, error?: string }}
 */
export function validateDistanceInput(input) {
  if (input === null) {
    return { valid: false, error: 'cancelled' };
  }

  const meters = parseFloat(input);
  if (!Number.isFinite(meters) || meters <= 0) {
    return { valid: false, error: 'invalid-number' };
  }

  return { valid: true, meters };
}

/**
 * Computes the reference distance from scale mode state and user input.
 * @param {Object} scaleModeState - Current scale mode state with p1 and p2
 * @param {number} meters - Validated distance in meters
 * @returns {{ success: boolean, referenceDistance?: Object, error?: string }}
 */
export function computeReferenceDistanceFromInput(scaleModeState, meters) {
  const { p1, p2 } = scaleModeState;
  
  if (!p1 || !p2) {
    return { success: false, error: 'missing-points' };
  }

  const metersPerPixel = computeReferenceScale(p1, p2, meters);
  
  if (!metersPerPixel) {
    return { success: false, error: 'computation-failed' };
  }

  return {
    success: true,
    referenceDistance: { p1, p2, meters, metersPerPixel },
  };
}

/**
 * Resets the scale mode state to inactive.
 * @returns {Object} Reset state
 */
export function cancelScaleModeState() {
  return createScaleModeState();
}

// ─────────────────────────────────────────────────────────────────────────────
// Measure Mode State Machine
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Creates the initial measure mode state.
 * @returns {Object} Initial measure mode state
 */
export function createMeasureModeState() {
  return {
    active: false,
    step: null, // 'p1' | 'p2' | null (null when measurement complete)
    p1: null,
    p2: null,
  };
}

/**
 * Checks if measure mode can be started based on available scale sources.
 * @param {Object} appState - Application state with referenceDistance and/or calibration
 * @returns {{ canStart: boolean, scale?: Object, reason?: string }}
 */
export function canStartMeasureMode(appState) {
  const scale = getActiveScale(appState);
  if (!scale) {
    return { canStart: false, reason: 'no-scale' };
  }
  return { canStart: true, scale };
}

/**
 * Starts the measure mode, returning the new state.
 * @param {Object} currentState - Current measure mode state
 * @returns {Object} New state with mode activated
 */
export function startMeasureModeState(currentState) {
  return {
    ...currentState,
    active: true,
    step: 'p1',
    p1: null,
    p2: null,
  };
}

/**
 * Handles a point click during measure mode.
 * @param {Object} currentState - Current measure mode state
 * @param {Object} point - The clicked point {x, y}
 * @returns {{ state: Object, action: string | null }} New state and action to perform
 */
export function handleMeasureModePoint(currentState, point) {
  return handleTwoPointModeClick(currentState, point, 'measurement-complete', null);
}

/**
 * Updates a point in measure mode (e.g., during drag).
 * @param {Object} currentState - Current measure mode state
 * @param {'p1' | 'p2'} pointId - Which point to update
 * @param {Object} newPoint - New point coordinates {x, y}
 * @returns {Object} Updated state
 */
export function updateMeasureModePoint(currentState, pointId, newPoint) {
  if (!currentState.active || currentState.step !== null) {
    return currentState;
  }
  return {
    ...currentState,
    [pointId]: newPoint,
  };
}

/**
 * Computes the current measurement distance.
 * @param {Object} measureState - Measure mode state with p1 and p2
 * @param {Object} appState - Application state for getting active scale
 * @returns {{ success: boolean, meters?: number, source?: string, error?: string }}
 */
export function computeMeasurement(measureState, appState) {
  const { p1, p2 } = measureState;
  
  if (!p1 || !p2) {
    return { success: false, error: 'missing-points' };
  }

  const scale = getActiveScale(appState);
  if (!scale) {
    return { success: false, error: 'no-scale' };
  }

  const meters = measureDistance(p1, p2, scale.metersPerPixel);
  if (meters === null) {
    return { success: false, error: 'computation-failed' };
  }

  return {
    success: true,
    meters,
    source: scale.source,
  };
}

/**
 * Resets the measure mode state to inactive.
 * @returns {Object} Reset state
 */
export function cancelMeasureModeState() {
  return createMeasureModeState();
}

// ─────────────────────────────────────────────────────────────────────────────
// UI State Derivation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Determines whether the measure button should be enabled.
 * @param {Object} appState - Application state
 * @param {Object} measureModeState - Measure mode state
 * @returns {boolean} True if measure button should be enabled
 */
export function shouldEnableMeasureButton(appState, measureModeState) {
  if (measureModeState.active) {
    // Re-enable when measurement is complete (step is null)
    return measureModeState.step === null;
  }
  // Enable if a scale is available
  return getActiveScale(appState) !== null;
}

/**
 * Determines whether the set scale button should be enabled.
 * @param {Object} scaleModeState - Scale mode state
 * @returns {boolean} True if set scale button should be enabled
 */
export function shouldEnableSetScaleButton(scaleModeState) {
  return !scaleModeState.active;
}
