const CalibrationModel = require('./model');
const { applyTransform } = require('./transform');

function degPerMeter(lat) {
  const R = 6378137;
  return (180 / Math.PI) / (R * Math.cos((lat * Math.PI) / 180));
}

test('CalibrationModel fits and projects', () => {
  const trueModel = { type: 'similarity', scale: 1.5, angle: 0.1, tx: 3, ty: -2 };
  const proj = (w) => applyTransform(trueModel, w);
  const lat0 = 40;
  const lon0 = -105;
  const d = degPerMeter(lat0);
  const pairs = [
    { pixel: proj({ x: 0, y: 0 }), wgs84: { lat: lat0, lon: lon0 } },
    { pixel: proj({ x: 10, y: 0 }), wgs84: { lat: lat0, lon: lon0 + 10 * d } },
    { pixel: proj({ x: 0, y: 10 }), wgs84: { lat: lat0 + 10 * d, lon: lon0 } },
  ];
  const model = new CalibrationModel();
  model.setPairs(pairs);
  model.setBaseKind('affine');
  const res = model.fitRobust({ rng: () => 0.5 });
  expect(res.rmse).toBeLessThan(1e-3);
  const px = model.projectLatLonToPixel(lat0 + 10 * d, lon0 + 10 * d);
  const expected = proj({ x: 10, y: 10 });
  expect(Math.hypot(px.x - expected.x, px.y - expected.y)).toBeLessThan(1e-1);
});

test('setBaseKind enforces pair count', () => {
  const model = new CalibrationModel();
  model.setPairs([
    { pixel: { x: 0, y: 0 }, wgs84: { lat: 0, lon: 0 } },
    { pixel: { x: 10, y: 0 }, wgs84: { lat: 0, lon: 0.000089 } },
  ]);
  model.setBaseKind('affine');
  expect(() => model.fitRobust()).toThrow('Insufficient pairs');
});
