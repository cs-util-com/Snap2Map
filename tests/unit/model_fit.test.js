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
