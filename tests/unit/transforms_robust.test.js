/* eslint-env jest */

const math = require('mathjs');
// Ensure modules that depend on global.math can find it
global.math = math;
const robust = require('../../src/calib/robust.js');
const transforms = require('../../src/calib/transforms.js');
const { fitAffine, fitSimilarity, fitHomography } = transforms;
// Spy on the transform fit functions and make them return identity matrices for deterministic tests
jest.spyOn(transforms, 'fitSimilarity').mockImplementation(() => math.identity(3));
jest.spyOn(transforms, 'fitAffine').mockImplementation(() => math.identity(3));
jest.spyOn(transforms, 'fitHomography').mockImplementation(() => math.identity(3));

describe('robust.ransac and irls basic', () => {
  test('ransac returns null when not enough pairs for model', () => {
    const pairs = [{ pixel: { x: 0, y: 0 }, enu: { x: 0, y: 0 } }];
    const res = robust.ransac('homography', pairs, { inlierThreshold: 1, maxSamples: 10 });
    expect(res).toBeNull();
  });

  test('ransac returns a model and inliers when fit functions succeed', () => {
    // Provide 4 identical pairs so identity transform will have zero error
    const pairs = [];
    for (let i = 0; i < 4; i++) {
      pairs.push({ pixel: { x: i, y: i }, enu: { x: i, y: i } });
    }

    const res = robust.ransac('homography', pairs, { inlierThreshold: 0.1, maxSamples: 5 });
    expect(res).not.toBeNull();
    expect(res.model).not.toBeNull();
    expect(Array.isArray(res.inliers)).toBe(true);
    // Because we returned identity for fitHomography, all points should be inliers
    expect(res.inliers.length).toBeGreaterThanOrEqual(4);
  });

  test('irls returns initial model when kind unsupported', () => {
    const initial = math.identity(3);
    const out = robust.irls('similarity', [], initial, { huberDelta: 1 });
    expect(out).toBe(initial);
  });

  test('irls computes weights and calls fit function for affine', () => {
    // Create 3 inliers with small residuals
    const inliers = [
      { pixel: { x: 0, y: 0 }, enu: { x: 0, y: 0 } },
      { pixel: { x: 1, y: 0 }, enu: { x: 1, y: 0 } },
      { pixel: { x: 0, y: 1 }, enu: { x: 0, y: 1 } },
    ];
    const initial = math.identity(3);
    const out = robust.irls('affine', inliers, initial, { huberDelta: 0.5 });
    expect(out).not.toBeNull();
    // ensure fitAffine mock was called
    expect(transforms.fitAffine).toHaveBeenCalled();
  });
});

// Add a few tests for transforms directly (affine/similarity/homography)

describe('transforms basic fits', () => {
  test('fitSimilarity returns null for <2 pairs', () => {
    expect(fitSimilarity([])).toBeNull();
  });

  test('fitAffine returns null for <3 pairs', () => {
    expect(fitAffine([{ pixel: { x: 0, y: 0 }, enu: { x: 0, y: 0 } }])).toBeNull();
  });

  test('fitHomography returns null for <4 pairs', () => {
    expect(fitHomography([1, 2, 3].map(i => ({ pixel: { x: i, y: i }, enu: { x: i, y: i } })))).toBeNull();
  });
});
