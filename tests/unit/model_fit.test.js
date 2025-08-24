/* eslint-env jest */
// Mock ransac and irls to force a successful fit path in CalibrationModel
jest.mock('../../src/calib/robust.js', () => ({
  ransac: jest.fn(),
  irls: jest.fn(),
}));

jest.mock('../../src/util/coords.js', () => ({
  projectToEnu: jest.fn((wgs84, origin) => ({ x: wgs84.lat || 0, y: wgs84.lon || 0 })),
}));

global.math = require('mathjs');
const math = global.math;
const { ransac, irls } = require('../../src/calib/robust.js');
const { CalibrationModel } = require('../../src/calib/model.js');

describe('CalibrationModel fit happy path', () => {
  test('fit succeeds when ransac returns a model', () => {
    // prepare pairs (4 pairs to choose homography branch)
    const pairs = [
      { pixel: { x: 0, y: 0 }, wgs84: { lat: 0, lon: 0 }, enu: { x: 0, y: 0 } },
      { pixel: { x: 10, y: 0 }, wgs84: { lat: 10, lon: 0 }, enu: { x: 10, y: 0 } },
      { pixel: { x: 0, y: 5 }, wgs84: { lat: 0, lon: 5 }, enu: { x: 0, y: 5 } },
      { pixel: { x: 7, y: 3 }, wgs84: { lat: 7, lon: 3 }, enu: { x: 7, y: 3 } },
    ];

    // Configure ransac to return an identity model and the pairs as inliers
    const identity = math.identity(3);
    ransac.mockReturnValue({ model: identity, inliers: pairs });
    irls.mockReturnValue(identity);

    const model = new CalibrationModel();
    pairs.forEach(p => model.addPair(p));

    const ok = model.fit();
    expect(ok).toBe(true);
    expect(model.transform).not.toBeNull();
    expect(Array.isArray(model.inliers)).toBe(true);
    expect(typeof model.rmse).toBe('number');
  });
});

describe('CalibrationModel additional behaviors', () => {
  test('fit fails when not enough pairs', () => {
    const model = new CalibrationModel();
    model.addPair({ pixel: { x: 0, y: 0 }, wgs84: { lat: 0, lon: 0 }, enu: { x: 0, y: 0 } });
    const ok = model.fit();
    expect(ok).toBe(false);
    expect(model.transform).toBeNull();
  });

  test('projectPixelToEnu and getProjectionError return null when no transform', () => {
    const model = new CalibrationModel();
    const out = model.projectPixelToEnu({ x: 1, y: 2 });
    expect(out).toBeNull();
    expect(model.getProjectionError([])).toBeNull();
  });

  test('projectLatLonToPixel is null before fit and returns pixel after fit', () => {
    // reuse the pairs from the happy path
    const pairs = [
      { pixel: { x: 0, y: 0 }, wgs84: { lat: 0, lon: 0 }, enu: { x: 0, y: 0 } },
      { pixel: { x: 10, y: 0 }, wgs84: { lat: 10, lon: 0 }, enu: { x: 10, y: 0 } },
      { pixel: { x: 0, y: 5 }, wgs84: { lat: 0, lon: 5 }, enu: { x: 0, y: 5 } },
      { pixel: { x: 7, y: 3 }, wgs84: { lat: 7, lon: 3 }, enu: { x: 7, y: 3 } },
    ];

    // Configure ransac to return an identity model and the pairs as inliers
    const identity = math.identity(3);
    ransac.mockReturnValue({ model: identity, inliers: pairs });
    irls.mockReturnValue(identity);

    const model = new CalibrationModel();
    // before adding pairs or fitting, projection should be null
    expect(model.projectLatLonToPixel({ lat: 1, lon: 2 })).toBeNull();

    pairs.forEach(p => model.addPair(p));
    const ok = model.fit();
    expect(ok).toBe(true);

    // project the lat/lon of the third pair and expect the pixel to match
    const projected = model.projectLatLonToPixel(pairs[2].wgs84);
    expect(projected).not.toBeNull();
    expect(typeof projected.x).toBe('number');
    expect(typeof projected.y).toBe('number');
    // Because we used an identity base transform and the mocked ENU projection,
    // the returned pixel coordinates should approximately equal the enu values
    expect(Math.abs(projected.x - pairs[2].pixel.x)).toBeLessThan(1e-6);
    expect(Math.abs(projected.y - pairs[2].pixel.y)).toBeLessThan(1e-6);
  });

  test('getScale returns null before fit and a number after fit', () => {
    const model = new CalibrationModel();
    expect(model.getScale()).toBeNull();

    // create a simple identity transform so scale can be computed
    const identity = math.identity(3);
    // Prepare two pairs and instruct ransac to return them as inliers so RMSE is computed
    const pairs = [
      { pixel: { x: 0, y: 0 }, wgs84: { lat: 0, lon: 0 }, enu: { x: 0, y: 0 } },
      { pixel: { x: 1, y: 0 }, wgs84: { lat: 1, lon: 0 }, enu: { x: 1, y: 0 } },
    ];
    ransac.mockReturnValue({ model: identity, inliers: pairs });
    irls.mockReturnValue(identity);

    // Add minimal pairs (2) to force similarity branch
    pairs.forEach(p => model.addPair(p));

    // Fit should succeed because ransac returns a model
    const ok = model.fit();
    expect(ok).toBe(true);
    const scale = model.getScale();
    expect(typeof scale).toBe('number');
    expect(scale).toBeGreaterThan(0);
  });

  test('enableTPS and disableTPS attach and detach the refiner', () => {
    const pairs = [
      { pixel: { x: 0, y: 0 }, wgs84: { lat: 0, lon: 0 }, enu: { x: 0, y: 0 } },
      { pixel: { x: 10, y: 0 }, wgs84: { lat: 10, lon: 0 }, enu: { x: 10, y: 0 } },
      { pixel: { x: 0, y: 5 }, wgs84: { lat: 0, lon: 5 }, enu: { x: 0, y: 5 } },
      { pixel: { x: 7, y: 3 }, wgs84: { lat: 7, lon: 3 }, enu: { x: 7, y: 3 } },
    ];

    const identity = math.identity(3);
    ransac.mockReturnValue({ model: identity, inliers: pairs });
    irls.mockReturnValue(identity);

    const model = new CalibrationModel();
    pairs.forEach(p => model.addPair(p));
    const ok = model.fit();
    expect(ok).toBe(true);

    // Enable TPS should attach a RefinerTPS instance
    model.enableTPS(1e-6);
    expect(model.tpsRefiner).not.toBeNull();
    // warp should produce a point
    const warped = model.tpsRefiner.warp({ x: 1, y: 2 });
    expect(warped).not.toBeNull();
    expect(typeof warped.x).toBe('number');
    expect(typeof warped.y).toBe('number');

    // Disable should remove it
    model.disableTPS();
    expect(model.tpsRefiner).toBeNull();
  });
});
