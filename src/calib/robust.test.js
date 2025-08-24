const { calibrate } = require('./robust');
const { applyTransform } = require('./transform');

test('robust calibration rejects outlier', () => {
  const trueModel = { type: 'affine', a: 1, b: 0.2, c: -0.1, d: 0.9, tx: 5, ty: -3 };
  const pairs = [
    { world: { x: 0, y: 0 }, pixel: applyTransform(trueModel, { x: 0, y: 0 }) },
    { world: { x: 10, y: 0 }, pixel: applyTransform(trueModel, { x: 10, y: 0 }) },
    { world: { x: 0, y: 10 }, pixel: applyTransform(trueModel, { x: 0, y: 10 }) },
    { world: { x: 10, y: 10 }, pixel: applyTransform(trueModel, { x: 10, y: 10 }) },
    { world: { x: 20, y: 20 }, pixel: { x: 400, y: -200 } }, // outlier
  ];
  const { model, residuals } = calibrate(pairs, { rng: () => 0.99 });
  const inliers = pairs.slice(0, 4);
  inliers.forEach((p) => {
    const proj = applyTransform(model, p.world);
    expect(Math.hypot(proj.x - p.pixel.x, proj.y - p.pixel.y)).toBeLessThan(1e-3);
  });
  expect(residuals[4]).toBeGreaterThan(30);
});

test('calibrate respects explicit model type and pair count', () => {
  const pairs = [
    { world: { x: 0, y: 0 }, pixel: { x: 0, y: 0 } },
    { world: { x: 10, y: 0 }, pixel: { x: 10, y: 0 } },
  ];
  expect(() => calibrate(pairs, { modelType: 'affine' })).toThrow('Insufficient pairs');
  const { model } = calibrate(pairs, { modelType: 'similarity' });
  const proj = applyTransform(model, { x: 5, y: 0 });
  expect(proj.x).toBeCloseTo(5, 5);
});
