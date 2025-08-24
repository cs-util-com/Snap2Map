import { getCurrentPosition, startWatchingPosition, stopWatchingPosition } from '../../src/gps/gps.js';

describe('gps module', () => {
  const realGeo = global.navigator && global.navigator.geolocation;

  beforeEach(() => {
    // Provide a fake geolocation object for tests
    global.navigator = global.navigator || {};
    global.navigator.geolocation = {
      getCurrentPosition: (success) => success({ coords: { latitude: 1, longitude: 2, accuracy: 5 } }),
      watchPosition: (success) => {
        const id = 123;
        setTimeout(() => success({ coords: { latitude: 1, longitude: 2, accuracy: 5 } }), 10);
        return id;
      },
      clearWatch: () => {},
    };
  });

  afterEach(() => {
    if (realGeo) global.navigator.geolocation = realGeo;
  });

  test('getCurrentPosition resolves with position', async () => {
    const pos = await getCurrentPosition({ timeout: 1000 });
    expect(pos.coords.latitude).toBe(1);
    expect(pos.coords.longitude).toBe(2);
  });

  test('startWatchingPosition returns true and stop stops it', () => {
    const started = startWatchingPosition(() => {}, () => {});
    expect(started).toBe(true);
    stopWatchingPosition();
  });
});
