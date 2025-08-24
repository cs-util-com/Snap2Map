const CalibrationModel = require('./model');
const PositionProjector = require('./projector');

function degPerMeter(lat) {
  const R = 6378137;
  return (180 / Math.PI) / (R * Math.cos((lat * Math.PI) / 180));
}

test('PositionProjector combines accuracy', () => {
  const model = new CalibrationModel();
  const lat0 = 0;
  const lon0 = 0;
  const d = degPerMeter(lat0) * 10; // 10 m east
  model.setPairs([
    { pixel: { x: 0, y: 0 }, wgs84: { lat: lat0, lon: lon0 } },
    { pixel: { x: 10, y: 0 }, wgs84: { lat: lat0, lon: lon0 + d } },
  ]);
  model.setBaseKind('similarity');
  model.fitRobust({ rng: () => 0.2 });
  const proj = new PositionProjector();
  proj.setCalibration(model);
  const res = proj.toPixel({ lat: lat0, lon: lon0 + d, accuracy: 5 });
  expect(res.px.x).toBeCloseTo(10, 2);
  expect(res.sigmaTotal).toBeGreaterThan(res.sigmaMap);
  expect(res.sigmaTotal).toBeGreaterThanOrEqual(5);
});
