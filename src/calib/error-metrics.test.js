const ErrorMetrics = require('./error-metrics');

const model = { type: 'similarity', scale: 1, angle: 0, tx: 0, ty: 0 };

function makePairs(offset) {
  return [
    { world: { x: 0, y: 0 }, pixel: { x: 0, y: 0 } },
    { world: { x: 10, y: 0 }, pixel: { x: 10, y: 0 } },
    { world: { x: 0, y: 10 }, pixel: { x: 0, y: 10 } },
    offset && { world: { x: 20, y: 20 }, pixel: { x: 25, y: 40 } },
  ].filter(Boolean);
}

test('localRMSE reflects residuals', () => {
  const base = new ErrorMetrics(model, makePairs(false));
  const noisy = new ErrorMetrics(model, makePairs(true));
  const pt = { x: 5, y: 5 };
  expect(noisy.localRMSE(pt)).toBeGreaterThan(base.localRMSE(pt));
  const heat = base.heatmap([pt, { x: 0, y: 0 }]);
  expect(heat).toBeInstanceOf(Float32Array);
  expect(heat.length).toBe(2);
});
