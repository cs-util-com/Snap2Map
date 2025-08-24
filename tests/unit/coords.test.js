/**
 * @file tests/unit/coords.test.js
 * @description Unit tests for the coordinate utility functions.
 */

import { projectToEnu, unprojectFromEnu } from '../../src/util/coords.js';

describe('Coordinate Projections', () => {
  const origin = { lat: 40.7128, lon: -74.0060 }; // NYC

  test('should perform a round-trip projection accurately', () => {
    const testPoint = { lat: 40.7580, lon: -73.9855 }; // Times Square

    // Project to ENU
    const enuPoint = projectToEnu(testPoint, origin);

    // Un-project back to WGS84
    const roundTripPoint = unprojectFromEnu(enuPoint, origin);

    // Check if the result is close to the original
    expect(roundTripPoint.lat).toBeCloseTo(testPoint.lat, 4); // 4 decimal places is ~11m accuracy
    expect(roundTripPoint.lon).toBeCloseTo(testPoint.lon, 4);
  });

  test('should return {x: 0, y: 0} when projecting the origin', () => {
    const enuPoint = projectToEnu(origin, origin);
    expect(enuPoint.x).toBeCloseTo(0);
    expect(enuPoint.y).toBeCloseTo(0);
  });

  test('should return the origin when un-projecting {x: 0, y: 0}', () => {
    const wgsPoint = unprojectFromEnu({ x: 0, y: 0 }, origin);
    expect(wgsPoint.lat).toBeCloseTo(origin.lat);
    expect(wgsPoint.lon).toBeCloseTo(origin.lon);
  });

  test('should handle points across the prime meridian', () => {
    const origin_pm = { lat: 51.4779, lon: 0.0 }; // Greenwich
    const testPoint_pm = { lat: 51.5014, lon: -0.1419 }; // Buckingham Palace

    const enuPoint = projectToEnu(testPoint_pm, origin_pm);
    const roundTripPoint = unprojectFromEnu(enuPoint, origin_pm);

    expect(roundTripPoint.lat).toBeCloseTo(testPoint_pm.lat, 4);
    expect(roundTripPoint.lon).toBeCloseTo(testPoint_pm.lon, 4);
  });
});
