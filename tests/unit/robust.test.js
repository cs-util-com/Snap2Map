/* eslint-env jest */
global.math = require('mathjs');

const { ransac, irls } = require('../../src/calib/robust.js');
const { fitAffine } = require('../../src/calib/transforms.js');

function makeAffinePairs() {
  const H = math.matrix([
    [1.1, -0.05, 4],
    [0.02, 0.98, -2],
    [0, 0, 1],
  ]);
  const src = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 5 }, { x: 7, y: 3 }];
  return src.map(s => ({ pixel: s, enu: { x: (math.multiply(H, [s.x, s.y, 1]).toArray()[0]) / 1, y: (math.multiply(H, [s.x, s.y, 1]).toArray()[1]) / 1 } }));
}

describe('robust fitting', () => {
  test('ransac returns null for insufficient pairs for homography', () => {
    const pairs = [{ pixel: { x: 0, y: 0 }, enu: { x: 0, y: 0 } }];
    const res = ransac('homography', pairs, { inlierThreshold: 1, maxSamples: 10 });
    expect(res).toBeNull();
  });

  test('ransac finds an affine model for clean data', () => {
    const pairs = makeAffinePairs();
    const noisy = pairs.map(p => ({ pixel: { x: p.pixel.x + (Math.random()-0.5)*1e-6, y: p.pixel.y + (Math.random()-0.5)*1e-6 }, enu: p.enu }));
    const res = ransac('affine', noisy, { inlierThreshold: 0.5, maxSamples: 50 });
    expect(res).not.toBeNull();
    expect(res.model).not.toBeNull();
    expect(res.inliers.length).toBeGreaterThanOrEqual(3);
  });

  test('irls refines affine model when supported', () => {
    const pairs = makeAffinePairs();
    const initial = fitAffine(pairs);
    const refined = irls('affine', pairs, initial, { huberDelta: 1 });
    expect(refined).not.toBeNull();
  });
});
