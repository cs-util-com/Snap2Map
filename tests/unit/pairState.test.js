import { setPixel, setWgs84, getActivePairData, getActivePairMarkers, isPairComplete, resetActivePair } from '../../src/calib/pairState.js';

describe('pairState module', () => {
  afterEach(() => resetActivePair());

  test('set and get active pair data', () => {
    const pixel = { x: 10, y: 20 };
    const wgs84 = { lat: 1.23, lon: 4.56 };
    const fakeMarker = { id: 'm' };

    setPixel(pixel, fakeMarker);
    setWgs84(wgs84, fakeMarker);

    const data = getActivePairData();
    expect(data.pixel).toEqual(pixel);
    expect(data.wgs84).toEqual(wgs84);
    expect(isPairComplete()).toBe(true);

    const markers = getActivePairMarkers();
    expect(Array.isArray(markers)).toBe(true);
    expect(markers.length).toBeGreaterThanOrEqual(0);
  });

  test('reset clears state', () => {
    setPixel({ x: 1, y: 2 }, null);
    setWgs84({ lat: 0, lon: 0 }, null);
    resetActivePair();
    const data = getActivePairData();
    expect(data.pixel).toBeNull();
    expect(data.wgs84).toBeNull();
    expect(isPairComplete()).toBe(false);
  });
});
