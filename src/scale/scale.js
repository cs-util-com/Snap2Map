/**
 * Scale management utilities for the reference distance feature.
 * Provides functions for extracting scale from calibration, determining active scale source,
 * and formatting distances for display.
 */

/** Conversion factor from meters to feet */
export const METERS_TO_FEET = 3.28084;

/**
 * Validates that two points have valid numeric x,y coordinates.
 * @param {Object} p1 - First point
 * @param {Object} p2 - Second point
 * @returns {boolean} - True if both points are valid
 */
function arePointsValid(p1, p2) {
  return p1 && p2 && 
    typeof p1.x === 'number' && typeof p1.y === 'number' &&
    typeof p2.x === 'number' && typeof p2.y === 'number';
}

/**
 * Computes the pixel distance between two points.
 * @param {Object} p1 - First point {x, y}
 * @param {Object} p2 - Second point {x, y}
 * @returns {number} - Euclidean distance in pixels
 */
function pixelDistance(p1, p2) {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  return Math.hypot(dx, dy);
}

/**
 * Computes the meters per pixel scale from a reference distance definition.
 * 
 * @param {Object} p1 - First point in pixel coordinates {x, y}
 * @param {Object} p2 - Second point in pixel coordinates {x, y}
 * @param {number} meters - Known distance in meters between the two points
 * @returns {number|null} - Meters per pixel, or null if inputs are invalid
 */
export function computeReferenceScale(p1, p2, meters) {
  if (!arePointsValid(p1, p2)) {
    return null;
  }
  
  if (!Number.isFinite(meters) || meters <= 0) {
    return null;
  }
  
  const distance = pixelDistance(p1, p2);
  
  if (distance === 0 || !Number.isFinite(distance)) {
    return null;
  }
  
  const scale = meters / distance;
  return (Number.isFinite(scale) && scale > 0) ? scale : null;
}

/**
 * Extracts scale from a similarity model.
 * @param {Object} model - Calibration model
 * @returns {number|null} - Scale or null
 */
function extractSimilarityScale(model) {
  if (typeof model.scale === 'number') {
    return Math.abs(model.scale);
  }
  return null;
}

/**
 * Extracts average scale from an affine model.
 * @param {Object} model - Calibration model
 * @returns {number|null} - Scale or null
 */
function extractAffineScale(model) {
  if (!model.matrix) {
    return null;
  }
  const { a, b, c, d } = model.matrix;
  if (typeof a !== 'number' || typeof b !== 'number' || 
      typeof c !== 'number' || typeof d !== 'number') {
    return null;
  }
  const scaleX = Math.hypot(a, b);
  const scaleY = Math.hypot(c, d);
  return (scaleX + scaleY) / 2;
}

/**
 * Extracts the scale (meters per pixel) from a calibration result.
 * For similarity transforms, scale = sqrt(a² + b²) where the matrix coefficients
 * represent the scale and rotation components.
 * 
 * The calibration matrix maps pixels → geo coordinates (ENU in meters),
 * so the scale directly gives meters per pixel.
 * 
 * @param {Object} calibrationResult - Result from calibrateMap()
 * @returns {number|null} - Scale in meters per pixel, or null if not extractable
 */
export function getMetersPerPixelFromCalibration(calibrationResult) {
  if (!calibrationResult || calibrationResult.status !== 'ok' || !calibrationResult.model) {
    return null;
  }
  
  const { model } = calibrationResult;
  
  const extractors = {
    similarity: extractSimilarityScale,
    affine: extractAffineScale,
    homography: () => null, // Scale varies across image
  };
  
  const extractor = extractors[model.type];
  return extractor ? extractor(model) : null;
}

/**
 * Determines the active metersPerPixel value based on available sources.
 * Priority: manual referenceDistance > GPS calibration
 * 
 * @param {Object} state - Application state containing referenceDistance and/or calibration
 * @returns {{ metersPerPixel: number, source: 'manual' | 'gps' } | null}
 */
export function getActiveScale(state) {
  if (!state) {
    return null;
  }
  
  // Priority 1: Manual reference distance (most trusted)
  if (state.referenceDistance && 
      typeof state.referenceDistance.metersPerPixel === 'number' &&
      state.referenceDistance.metersPerPixel > 0) {
    return { 
      metersPerPixel: state.referenceDistance.metersPerPixel, 
      source: 'manual' 
    };
  }
  
  // Priority 2: GPS calibration
  if (state.calibration) {
    const scale = getMetersPerPixelFromCalibration(state.calibration);
    if (scale !== null && scale > 0) {
      return { 
        metersPerPixel: scale, 
        source: 'gps' 
      };
    }
  }
  
  return null;
}

/**
 * Calculates the distance in meters between two pixel points given a scale.
 * 
 * @param {Object} p1 - First point in pixel coordinates {x, y}
 * @param {Object} p2 - Second point in pixel coordinates {x, y}
 * @param {number} metersPerPixel - Scale factor
 * @returns {number|null} - Distance in meters, or null if inputs are invalid
 */
export function measureDistance(p1, p2, metersPerPixel) {
  if (!arePointsValid(p1, p2)) {
    return null;
  }
  
  if (!Number.isFinite(metersPerPixel) || metersPerPixel <= 0) {
    return null;
  }
  
  return pixelDistance(p1, p2) * metersPerPixel;
}

/**
 * Converts a distance value from a given unit to meters.
 * Validates that the input is a positive finite number.
 * 
 * @param {number} value - Numeric distance value
 * @param {string} unit - Unit of the input value ('m', 'ft', 'ft-in')
 * @returns {number|null} - Distance in meters, or null if invalid
 */
export function convertToMeters(value, unit) {
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }
  switch (unit) {
    case 'ft':
    case 'ft-in': // Assume decimal feet are entered for 'ft-in'
      return value / METERS_TO_FEET;
    default:
      return value;
  }
}

/**
 * Formats a distance value for display in the user's preferred unit.
 * 
 * @param {number} meters - Distance in meters
 * @param {'m' | 'ft' | 'ft-in'} unit - Display unit preference
 * @returns {string} - Formatted distance string
 */
export function formatDistance(meters, unit = 'm') {
  if (!Number.isFinite(meters) || meters < 0) {
    return '—';
  }
  
  switch (unit) {
    case 'ft': {
      const feet = meters * METERS_TO_FEET;
      return `${feet.toFixed(2)} ft`;
    }
    case 'ft-in': {
      const totalInches = meters * METERS_TO_FEET * 12;
      const feet = Math.floor(totalInches / 12);
      const inches = Math.round(totalInches % 12);
      // Handle case where inches rounds to 12
      if (inches === 12) {
        return `${feet + 1}' 0"`;
      }
      return `${feet}' ${inches}"`;
    }
    default: {
      // Meters (default)
      if (meters < 0.01) {
        return `${(meters * 1000).toFixed(1)} mm`;
      }
      if (meters < 1) {
        return `${(meters * 100).toFixed(1)} cm`;
      }
      return `${meters.toFixed(2)} m`;
    }
  }
}

/**
 * Compares two scale values and determines if they differ significantly.
 * Used to warn users when manual reference and GPS-derived scales disagree.
 * 
 * @param {number} scale1 - First scale (meters per pixel)
 * @param {number} scale2 - Second scale (meters per pixel)
 * @param {number} [threshold=0.10] - Relative difference threshold (default 10%)
 * @returns {{ differs: boolean, percentDifference: number } | null}
 */
export function compareScales(scale1, scale2, threshold = 0.10) {
  if (!Number.isFinite(scale1) || !Number.isFinite(scale2) ||
      scale1 <= 0 || scale2 <= 0) {
    return null;
  }
  
  const percentDifference = Math.abs(scale1 - scale2) / Math.max(scale1, scale2);
  
  return {
    differs: percentDifference > threshold,
    percentDifference
  };
}
