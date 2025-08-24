/* eslint-env jest */
// Tests for geometric transform fitting routines
global.math = require('mathjs');

const { fitAffine, fitSimilarity, fitHomography } = require('../../src/calib/transforms.js');

function applyMatrixToPoint(H, p) {
  const arr = math.multiply(H, [p.x, p.y, 1]).toArray();
  return { x: arr[0] / arr[2], y: arr[1] / arr[2] };
}

describe('transforms fitting', () => {
  test('fitAffine recovers a known affine transform', () => {
    // Construct a known affine transform (scale, shear, translate)
    const H = math.matrix([
      [1.2, -0.2, 10],
      [0.1, 0.9, 5],
      [0, 0, 1],
    ]);

    const src = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 5 }, { x: 7, y: 3 }];
    const pairs = src.map(s => ({ pixel: s, enu: applyMatrixToPoint(H, s) }));

    const H_est = fitAffine(pairs);
    expect(H_est).not.toBeNull();

    // Compare the top-left 2x3 elements
    for (let r = 0; r < 2; r++) {
      for (let c = 0; c < 3; c++) {
        const expected = H.get([r, c]);
        const actual = H_est.get([r, c]);
        expect(Math.abs(actual - expected)).toBeLessThan(1e-6);
      }
    }
  });

  // similarity and homography require SVD; those code-paths are exercised elsewhere
  // here we focus on affine which uses direct least-squares and is deterministic
});
