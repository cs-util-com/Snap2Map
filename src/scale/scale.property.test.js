import * as fc from 'fast-check';
import {
  computeReferenceScale,
  measureDistance,
  formatDistance,
} from './scale.js';

describe('scale module property-based tests', () => {
  test('computeReferenceScale always returns positive finite number or null', () => {
    fc.assert(
      fc.property(
        fc.record({ x: fc.double(), y: fc.double() }),
        fc.record({ x: fc.double(), y: fc.double() }),
        fc.double(),
        (p1, p2, meters) => {
          const scale = computeReferenceScale(p1, p2, meters);
          if (scale !== null) {
            expect(Number.isFinite(scale)).toBe(true);
            expect(scale).toBeGreaterThan(0);
          }
        }
      )
    );
  });

  test('measureDistance is consistent with computeReferenceScale', () => {
    fc.assert(
      fc.property(
        fc.record({ x: fc.double({ min: -10000, max: 10000 }), y: fc.double({ min: -10000, max: 10000 }) }),
        fc.record({ x: fc.double({ min: -10000, max: 10000 }), y: fc.double({ min: -10000, max: 10000 }) }),
        fc.double({ min: 0.001, max: 1000000 }),
        (p1, p2, meters) => {
          const scale = computeReferenceScale(p1, p2, meters);
          if (scale !== null) {
            const measured = measureDistance(p1, p2, scale);
            // Allow for small floating point errors
            expect(measured).toBeCloseTo(meters, 5);
          }
        }
      )
    );
  });

  test('formatDistance never throws and returns a string', () => {
    fc.assert(
      fc.property(
        fc.double(),
        fc.constantFrom('m', 'ft', 'ft-in'),
        (meters, unit) => {
          const formatted = formatDistance(meters, unit);
          expect(typeof formatted).toBe('string');
          expect(formatted.length).toBeGreaterThan(0);
        }
      )
    );
  });
});
