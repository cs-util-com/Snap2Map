import {
  computeReferenceScale,
  getMetersPerPixelFromCalibration,
  getActiveScale,
  measureDistance,
  formatDistance,
  compareScales,
  METERS_TO_FEET,
} from './scale.js';

describe('scale module', () => {
  describe('computeReferenceScale', () => {
    test('computes correct scale for horizontal line', () => {
      const p1 = { x: 0, y: 0 };
      const p2 = { x: 100, y: 0 };
      const meters = 10;
      expect(computeReferenceScale(p1, p2, meters)).toBe(0.1); // 10m / 100px = 0.1 m/px
    });

    test('computes correct scale for vertical line', () => {
      const p1 = { x: 50, y: 0 };
      const p2 = { x: 50, y: 200 };
      const meters = 20;
      expect(computeReferenceScale(p1, p2, meters)).toBe(0.1); // 20m / 200px = 0.1 m/px
    });

    test('computes correct scale for diagonal line', () => {
      const p1 = { x: 0, y: 0 };
      const p2 = { x: 30, y: 40 }; // 3-4-5 triangle, distance = 50
      const meters = 5;
      expect(computeReferenceScale(p1, p2, meters)).toBe(0.1); // 5m / 50px = 0.1 m/px
    });

    test('returns null for coincident points', () => {
      const p1 = { x: 100, y: 200 };
      const p2 = { x: 100, y: 200 };
      expect(computeReferenceScale(p1, p2, 10)).toBeNull();
    });

    test('returns null for zero meters', () => {
      const p1 = { x: 0, y: 0 };
      const p2 = { x: 100, y: 0 };
      expect(computeReferenceScale(p1, p2, 0)).toBeNull();
    });

    test('returns null for negative meters', () => {
      const p1 = { x: 0, y: 0 };
      const p2 = { x: 100, y: 0 };
      expect(computeReferenceScale(p1, p2, -5)).toBeNull();
    });

    test('returns null for NaN meters', () => {
      const p1 = { x: 0, y: 0 };
      const p2 = { x: 100, y: 0 };
      expect(computeReferenceScale(p1, p2, NaN)).toBeNull();
    });

    test('returns null for Infinity meters', () => {
      const p1 = { x: 0, y: 0 };
      const p2 = { x: 100, y: 0 };
      expect(computeReferenceScale(p1, p2, Infinity)).toBeNull();
    });

    test('returns null for null/undefined points', () => {
      expect(computeReferenceScale(null, { x: 0, y: 0 }, 10)).toBeNull();
      expect(computeReferenceScale({ x: 0, y: 0 }, undefined, 10)).toBeNull();
      expect(computeReferenceScale(null, null, 10)).toBeNull();
    });

    test('returns null for points with missing coordinates', () => {
      expect(computeReferenceScale({ x: 0 }, { x: 100, y: 0 }, 10)).toBeNull();
      expect(computeReferenceScale({ x: 0, y: 0 }, { y: 100 }, 10)).toBeNull();
    });
  });

  describe('getMetersPerPixelFromCalibration', () => {
    test('extracts scale from similarity calibration', () => {
      const calibration = {
        status: 'ok',
        model: {
          type: 'similarity',
          scale: 0.05,
          rotation: 0,
          translation: { x: 0, y: 0 }
        }
      };
      expect(getMetersPerPixelFromCalibration(calibration)).toBe(0.05);
    });

    test('returns absolute value for negative similarity scale', () => {
      const calibration = {
        status: 'ok',
        model: {
          type: 'similarity',
          scale: -0.05,
          rotation: Math.PI,
          translation: { x: 0, y: 0 }
        }
      };
      expect(getMetersPerPixelFromCalibration(calibration)).toBe(0.05);
    });

    test('extracts average scale from affine calibration', () => {
      // Affine with uniform scale of 0.1 (no shear)
      const calibration = {
        status: 'ok',
        model: {
          type: 'affine',
          matrix: { a: 0.1, b: 0, c: 0, d: 0.1, tx: 10, ty: 20 }
        }
      };
      expect(getMetersPerPixelFromCalibration(calibration)).toBe(0.1);
    });

    test('extracts average scale from affine with rotation', () => {
      // Affine with scale=0.1 and 45° rotation
      const cos45 = Math.cos(Math.PI / 4);
      const sin45 = Math.sin(Math.PI / 4);
      const scale = 0.1;
      const calibration = {
        status: 'ok',
        model: {
          type: 'affine',
          matrix: { 
            a: scale * cos45, 
            b: -scale * sin45, 
            c: scale * sin45, 
            d: scale * cos45, 
            tx: 0, 
            ty: 0 
          }
        }
      };
      expect(getMetersPerPixelFromCalibration(calibration)).toBeCloseTo(0.1, 10);
    });

    test('returns null for homography (scale varies)', () => {
      const calibration = {
        status: 'ok',
        model: {
          type: 'homography',
          matrix: [[1, 0, 0], [0, 1, 0], [0.001, 0.001, 1]]
        }
      };
      expect(getMetersPerPixelFromCalibration(calibration)).toBeNull();
    });

    test('returns null for failed calibration', () => {
      expect(getMetersPerPixelFromCalibration({ status: 'fit-failed' })).toBeNull();
      expect(getMetersPerPixelFromCalibration({ status: 'insufficient-pairs' })).toBeNull();
    });

    test('returns null for null/undefined calibration', () => {
      expect(getMetersPerPixelFromCalibration(null)).toBeNull();
      expect(getMetersPerPixelFromCalibration(undefined)).toBeNull();
    });

    test('returns null for calibration without model', () => {
      expect(getMetersPerPixelFromCalibration({ status: 'ok' })).toBeNull();
      expect(getMetersPerPixelFromCalibration({ status: 'ok', model: null })).toBeNull();
    });

    test('returns null for affine with invalid matrix coefficients', () => {
      const calibration = {
        status: 'ok',
        model: {
          type: 'affine',
          matrix: { a: 'invalid', b: 0, c: 0, d: 0.1 }
        }
      };
      expect(getMetersPerPixelFromCalibration(calibration)).toBeNull();
    });

    test('returns null for affine without matrix property', () => {
      const calibration = {
        status: 'ok',
        model: { type: 'affine' }
      };
      expect(getMetersPerPixelFromCalibration(calibration)).toBeNull();
    });

    test('returns null for similarity with non-number scale', () => {
      const calibration = {
        status: 'ok',
        model: { type: 'similarity', scale: 'invalid' }
      };
      expect(getMetersPerPixelFromCalibration(calibration)).toBeNull();
    });

    test('returns null for unknown model type', () => {
      const calibration = {
        status: 'ok',
        model: { type: 'unknown', foo: 'bar' }
      };
      expect(getMetersPerPixelFromCalibration(calibration)).toBeNull();
    });
  });

  describe('getActiveScale', () => {
    test('returns manual reference when both sources exist (priority)', () => {
      const state = {
        referenceDistance: { metersPerPixel: 0.05 },
        calibration: {
          status: 'ok',
          model: { type: 'similarity', scale: 0.08 }
        }
      };
      const result = getActiveScale(state);
      expect(result).toEqual({ metersPerPixel: 0.05, source: 'manual' });
    });

    test('returns manual reference when only manual exists', () => {
      const state = {
        referenceDistance: { metersPerPixel: 0.05 },
        calibration: null
      };
      const result = getActiveScale(state);
      expect(result).toEqual({ metersPerPixel: 0.05, source: 'manual' });
    });

    test('returns GPS calibration when only calibration exists', () => {
      const state = {
        referenceDistance: null,
        calibration: {
          status: 'ok',
          model: { type: 'similarity', scale: 0.08 }
        }
      };
      const result = getActiveScale(state);
      expect(result).toEqual({ metersPerPixel: 0.08, source: 'gps' });
    });

    test('returns null when no scale sources exist', () => {
      expect(getActiveScale({ referenceDistance: null, calibration: null })).toBeNull();
      expect(getActiveScale({})).toBeNull();
    });

    test('returns null for null state', () => {
      expect(getActiveScale(null)).toBeNull();
      expect(getActiveScale(undefined)).toBeNull();
    });

    test('falls back to GPS when manual reference has invalid scale', () => {
      const state = {
        referenceDistance: { metersPerPixel: 0 },
        calibration: {
          status: 'ok',
          model: { type: 'similarity', scale: 0.08 }
        }
      };
      const result = getActiveScale(state);
      expect(result).toEqual({ metersPerPixel: 0.08, source: 'gps' });
    });

    test('falls back to GPS when manual reference has negative scale', () => {
      const state = {
        referenceDistance: { metersPerPixel: -0.05 },
        calibration: {
          status: 'ok',
          model: { type: 'similarity', scale: 0.08 }
        }
      };
      const result = getActiveScale(state);
      expect(result).toEqual({ metersPerPixel: 0.08, source: 'gps' });
    });

    test('returns null when GPS calibration failed', () => {
      const state = {
        referenceDistance: null,
        calibration: { status: 'fit-failed' }
      };
      expect(getActiveScale(state)).toBeNull();
    });
  });

  describe('measureDistance', () => {
    test('calculates correct distance for horizontal line', () => {
      const p1 = { x: 0, y: 0 };
      const p2 = { x: 100, y: 0 };
      const metersPerPixel = 0.1;
      expect(measureDistance(p1, p2, metersPerPixel)).toBe(10); // 100px * 0.1 = 10m
    });

    test('calculates correct distance for diagonal line', () => {
      const p1 = { x: 0, y: 0 };
      const p2 = { x: 30, y: 40 }; // distance = 50px
      const metersPerPixel = 0.2;
      expect(measureDistance(p1, p2, metersPerPixel)).toBe(10); // 50px * 0.2 = 10m
    });

    test('returns 0 for coincident points', () => {
      const p1 = { x: 50, y: 50 };
      const p2 = { x: 50, y: 50 };
      expect(measureDistance(p1, p2, 0.1)).toBe(0);
    });

    test('returns null for invalid points', () => {
      expect(measureDistance(null, { x: 0, y: 0 }, 0.1)).toBeNull();
      expect(measureDistance({ x: 0, y: 0 }, null, 0.1)).toBeNull();
      expect(measureDistance({ x: 0 }, { x: 0, y: 0 }, 0.1)).toBeNull();
    });

    test('returns null for invalid scale', () => {
      const p1 = { x: 0, y: 0 };
      const p2 = { x: 100, y: 0 };
      expect(measureDistance(p1, p2, 0)).toBeNull();
      expect(measureDistance(p1, p2, -0.1)).toBeNull();
      expect(measureDistance(p1, p2, NaN)).toBeNull();
      expect(measureDistance(p1, p2, Infinity)).toBeNull();
    });
  });

  describe('formatDistance', () => {
    describe('meters (default)', () => {
      test('formats large distances in meters', () => {
        expect(formatDistance(5.25, 'm')).toBe('5.25 m');
        expect(formatDistance(100, 'm')).toBe('100.00 m');
        expect(formatDistance(1.5)).toBe('1.50 m'); // default unit
      });

      test('formats sub-meter distances in centimeters', () => {
        expect(formatDistance(0.5, 'm')).toBe('50.0 cm');
        expect(formatDistance(0.01, 'm')).toBe('1.0 cm');
      });

      test('formats tiny distances in millimeters', () => {
        expect(formatDistance(0.005, 'm')).toBe('5.0 mm');
        expect(formatDistance(0.001, 'm')).toBe('1.0 mm');
      });
    });

    describe('feet', () => {
      test('formats distance in feet', () => {
        expect(formatDistance(1, 'ft')).toBe(`${METERS_TO_FEET.toFixed(2)} ft`);
        expect(formatDistance(3.048, 'ft')).toBe('10.00 ft'); // 3.048m ≈ 10ft
      });

      test('formats fractional feet', () => {
        expect(formatDistance(0.3048, 'ft')).toBe('1.00 ft'); // 0.3048m = 1ft
      });
    });

    describe('feet and inches', () => {
      test('formats whole feet with zero inches', () => {
        expect(formatDistance(0.3048, 'ft-in')).toBe("1' 0\"");
        expect(formatDistance(1.8288, 'ft-in')).toBe("6' 0\"");
      });

      test('formats feet with inches', () => {
        // 1.7018m ≈ 5'7"
        expect(formatDistance(1.7018, 'ft-in')).toBe("5' 7\"");
      });

      test('handles rounding to 12 inches', () => {
        // Edge case: when inches rounds to 12, should become next foot
        // 0.6096m = 2ft exactly, but 0.6090m rounds to 2'0"
        const almostTwoFeet = 0.6090; // Just under 2 feet
        const result = formatDistance(almostTwoFeet, 'ft-in');
        // Should be close to 2' 0"
        expect(result).toMatch(/[12]' \d+"/);
      });
    });

    describe('edge cases', () => {
      test('returns dash for NaN', () => {
        expect(formatDistance(NaN, 'm')).toBe('—');
      });

      test('returns dash for negative values', () => {
        expect(formatDistance(-5, 'm')).toBe('—');
      });

      test('returns dash for Infinity', () => {
        expect(formatDistance(Infinity, 'm')).toBe('—');
      });

      test('handles zero correctly', () => {
        expect(formatDistance(0, 'm')).toBe('0.0 mm');
        expect(formatDistance(0, 'ft')).toBe('0.00 ft');
        expect(formatDistance(0, 'ft-in')).toBe("0' 0\"");
      });
    });
  });

  describe('compareScales', () => {
    test('detects scales that differ by more than threshold', () => {
      const result = compareScales(0.10, 0.05, 0.10);
      expect(result.differs).toBe(true);
      expect(result.percentDifference).toBeCloseTo(0.5, 10); // 50% difference
    });

    test('detects scales within threshold', () => {
      const result = compareScales(0.10, 0.095, 0.10);
      expect(result.differs).toBe(false);
      expect(result.percentDifference).toBeCloseTo(0.05, 10); // 5% difference
    });

    test('uses 10% default threshold', () => {
      expect(compareScales(1.0, 0.91).differs).toBe(false); // 9% diff
      expect(compareScales(1.0, 0.89).differs).toBe(true);  // 11% diff
    });

    test('is symmetric (order independent)', () => {
      const result1 = compareScales(0.10, 0.05);
      const result2 = compareScales(0.05, 0.10);
      expect(result1.percentDifference).toBeCloseTo(result2.percentDifference, 10);
      expect(result1.differs).toBe(result2.differs);
    });

    test('returns null for invalid inputs', () => {
      expect(compareScales(0, 0.1)).toBeNull();
      expect(compareScales(0.1, 0)).toBeNull();
      expect(compareScales(-0.1, 0.1)).toBeNull();
      expect(compareScales(NaN, 0.1)).toBeNull();
      expect(compareScales(0.1, Infinity)).toBeNull();
    });

    test('handles identical scales', () => {
      const result = compareScales(0.05, 0.05);
      expect(result.differs).toBe(false);
      expect(result.percentDifference).toBe(0);
    });
  });
});
