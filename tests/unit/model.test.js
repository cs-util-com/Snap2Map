/* eslint-env jest */
const { CalibrationModel } = require('../../src/calib/model.js');

describe('CalibrationModel basic behavior', () => {
  test('addPair sets ENU origin on first pair', () => {
    const m = new CalibrationModel();
    const p = { pixel: { x: 1, y: 2 }, wgs84: { lat: 10, lon: 20 } };
    m.addPair(p);
    expect(m.enuOrigin).toEqual(p.wgs84);
    expect(m.pairs.length).toBe(1);
  });

  test('fit returns false with insufficient pairs', () => {
    const m = new CalibrationModel();
    m.addPair({ pixel: { x: 0, y: 0 }, wgs84: { lat: 0, lon: 0 } });
    expect(m.fit()).toBe(false);
  });

  test('projectLatLonToPixel returns null when no transform', () => {
    const m = new CalibrationModel();
    expect(m.projectLatLonToPixel({ lat: 0, lon: 0 })).toBeNull();
  });
});
