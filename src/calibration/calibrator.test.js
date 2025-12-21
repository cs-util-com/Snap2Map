import {
  calibrateMap,
  computeAccuracyRing,
  projectLocationToPixel,
  accuracyRingRadiusPixels,
  __internals,
} from './calibrator.js';
import { EARTH_RADIUS_METERS, degToRad, radToDeg } from '../geo/coordinate.js';

describe('calibrator', () => {
  const origin = { lat: 39.7392, lon: -104.9903 };

  const makeRandomGenerator = () => {
    const values = [0.01, 0.21, 0.41, 0.61, 0.81, 0.31, 0.51, 0.71, 0.91];
    let index = 0;
    return () => {
      const value = values[index % values.length];
      index += 1;
      return value;
    };
  };

  const makePairs = () => {
    const pairs = [];
    const transform = {
      type: 'affine',
      matrix: [
        [3, 0.5, 100],
        [-0.4, 2.5, -30],
      ],
    };

    const pixels = [
      { x: 0, y: 0 },
      { x: 50, y: 20 },
      { x: 120, y: -40 },
      { x: -80, y: 60 },
      { x: 40, y: -100 },
    ];

    pixels.forEach((pixel) => {
      const enu = {
        x: transform.matrix[0][0] * pixel.x + transform.matrix[0][1] * pixel.y + transform.matrix[0][2],
        y: transform.matrix[1][0] * pixel.x + transform.matrix[1][1] * pixel.y + transform.matrix[1][2],
      };
      const wgs84 = {
        lat: origin.lat + (enu.y / 111139),
        lon: origin.lon + (enu.x / (111139 * Math.cos(origin.lat * (Math.PI / 180)))),
      };
      pairs.push({ pixel, wgs84 });
    });

    pairs.push({
      pixel: { x: 200, y: 200 },
      wgs84: { lat: origin.lat + 0.2, lon: origin.lon + 0.2 },
    });

    return { pairs, transform };
  };

  test('calibrateMap recovers affine transform and ignores outlier', () => {
    const { pairs } = makePairs();
    const randomFn = makeRandomGenerator();
    const result = calibrateMap(pairs, { origin, random: randomFn, iterations: 20 });
    expect(result.status).toBe('ok');
    expect(result.kind).toBe('homography');
    expect(result.metrics.inlierCount).toBeGreaterThanOrEqual(5);
    expect(result.metrics.inliers.filter(Boolean).length).toBeGreaterThanOrEqual(5);
    expect(result.metrics.inliers.some((flag) => flag === false)).toBe(true);
    expect(result.quality.rmse).toBeLessThan(5);
  });

  test('computeAccuracyRing merges gps and map accuracy', () => {
    const { pairs } = makePairs();
    const randomFn = makeRandomGenerator();
    const result = calibrateMap(pairs, { origin, random: randomFn, iterations: 10 });
    const ring = computeAccuracyRing(result, 12);
    expect(ring.sigmaGps).toBe(12);
    expect(ring.sigmaMap).toBeCloseTo(result.quality.rmse);
    expect(ring.color === 'green' || ring.color === 'yellow' || ring.color === 'orange' || ring.color === 'red').toBe(true);
  });

  test('projectLocationToPixel returns consistent pixel estimate', () => {
    const { pairs } = makePairs();
    const randomFn = makeRandomGenerator();
    const calibration = calibrateMap(pairs, { origin, random: randomFn, iterations: 15 });
    const location = pairs[2].wgs84;
    const pixel = projectLocationToPixel(calibration, location);
    expect(pixel.x).toBeCloseTo(pairs[2].pixel.x, 0);
    expect(pixel.y).toBeCloseTo(pairs[2].pixel.y, 0);
  });

  test('accuracyRingRadiusPixels converts meters to pixels', () => {
    const { pairs } = makePairs();
    const randomFn = makeRandomGenerator();
    const calibration = calibrateMap(pairs, { origin, random: randomFn, iterations: 12 });
    const location = pairs[1].wgs84;
    const ring = accuracyRingRadiusPixels(calibration, location, 10);
    expect(ring.pixelRadius).toBeGreaterThan(0);
    expect(ring.pixelRadius).toBeLessThan(1000);
  });

  test('calibrateMap handles insufficient pairs', () => {
    const result = calibrateMap([{ pixel: { x: 0, y: 0 }, wgs84: origin }]);
    expect(result.status).toBe('insufficient-pairs');
  });

  test('calibrateMap selects similarity model for two pairs', () => {
    const pairs = [
      { pixel: { x: 0, y: 0 }, wgs84: { lat: origin.lat, lon: origin.lon } },
      { pixel: { x: 200, y: 0 }, wgs84: { lat: origin.lat, lon: origin.lon + 0.002 } },
    ];
    const result = calibrateMap(pairs, { origin, iterations: 5, random: makeRandomGenerator() });
    expect(result.status).toBe('ok');
    expect(result.kind).toBe('similarity');
    expect(result.statusMessage.level).toBe('low');
  });

  test('calibrateMap uses fixed scale when referenceScale is provided', () => {
    const referenceScale = 0.5; // meters per pixel
    const pairs = [
      { pixel: { x: 0, y: 0 }, wgs84: { lat: origin.lat, lon: origin.lon } },
      { pixel: { x: 200, y: 0 }, wgs84: { lat: origin.lat, lon: origin.lon + 0.002 } },
    ];
    const result = calibrateMap(pairs, { origin, iterations: 5, random: makeRandomGenerator(), referenceScale });
    expect(result.status).toBe('ok');
    expect(result.kind).toBe('similarity');
    expect(result.model.scale).toBe(referenceScale);
  });

  test('calibrateMap with referenceScale ignores natural GPS-derived scale', () => {
    // Create pairs that would naturally give a scale of ~1.11 m/px
    // (based on lon difference of 0.002 degrees ≈ 222m at this latitude, over 200px)
    const pairs = [
      { pixel: { x: 0, y: 0 }, wgs84: { lat: origin.lat, lon: origin.lon } },
      { pixel: { x: 200, y: 0 }, wgs84: { lat: origin.lat, lon: origin.lon + 0.002 } },
    ];

    // First, calibrate without referenceScale to get the natural scale
    const naturalResult = calibrateMap(pairs, { origin, iterations: 5, random: makeRandomGenerator() });
    expect(naturalResult.model.scale).toBeGreaterThan(0.5);

    // Now calibrate with a moderately different fixed scale (close enough to still produce inliers)
    const fixedScale = naturalResult.model.scale * 0.8;
    const fixedResult = calibrateMap(pairs, { origin, iterations: 5, random: makeRandomGenerator(), referenceScale: fixedScale });
    expect(fixedResult.status).toBe('ok');
    expect(fixedResult.model.scale).toBe(fixedScale);
    expect(fixedResult.model.scale).not.toBeCloseTo(naturalResult.model.scale);
  });

  test('referenceScale only affects similarity model, not affine or homography', () => {
    const referenceScale = 0.5;
    // 3 pairs = affine model
    const threePairs = [
      { pixel: { x: 0, y: 0 }, wgs84: { lat: origin.lat, lon: origin.lon } },
      { pixel: { x: 100, y: 0 }, wgs84: { lat: origin.lat, lon: origin.lon + 0.001 } },
      { pixel: { x: 0, y: 60 }, wgs84: { lat: origin.lat + 0.0005, lon: origin.lon } },
    ];
    const result = calibrateMap(threePairs, { origin, iterations: 10, random: makeRandomGenerator(), referenceScale });
    expect(result.status).toBe('ok');
    expect(result.kind).toBe('affine');
    // Affine doesn't have a single 'scale' property - it uses a matrix
    expect(result.model.matrix).toBeDefined();
  });

  test('calibrateMap selects affine model for three pairs', () => {
    const pairs = [
      { pixel: { x: 0, y: 0 }, wgs84: { lat: origin.lat, lon: origin.lon } },
      { pixel: { x: 100, y: 0 }, wgs84: { lat: origin.lat, lon: origin.lon + 0.001 } },
      { pixel: { x: 0, y: 60 }, wgs84: { lat: origin.lat + 0.0005, lon: origin.lon } },
    ];
    const result = calibrateMap(pairs, { origin, iterations: 10, random: makeRandomGenerator() });
    expect(result.status).toBe('ok');
    expect(result.kind).toBe('affine');
    expect(result.statusMessage.level).toBe('medium');
  });

  test('calibrateMap returns fit-failed for degenerate geometry', () => {
    const degenerate = [
      { pixel: { x: 0, y: 0 }, wgs84: { lat: origin.lat, lon: origin.lon } },
      { pixel: { x: 0, y: 0 }, wgs84: { lat: origin.lat, lon: origin.lon } },
      { pixel: { x: 0, y: 0 }, wgs84: { lat: origin.lat, lon: origin.lon } },
    ];
    const result = calibrateMap(degenerate, { origin, iterations: 5, random: makeRandomGenerator() });
    expect(result.status).toBe('fit-failed');
  });

  test('projectLocationToPixel returns null for invalid calibration', () => {
    const nullCalibration = { status: 'fit-failed' };
    expect(projectLocationToPixel(nullCalibration, origin)).toBeNull();

    const radOffset = radToDeg(1 / (EARTH_RADIUS_METERS * Math.cos(degToRad(origin.lat))));
    const calibration = {
      status: 'ok',
      origin,
      quality: { rmse: 0, maxResidual: 0 },
      model: {
        type: 'homography',
        matrix: [
          [1, 0, 0],
          [0, 1, 0],
          [1, 0, -1],
        ],
      },
    };
    const location = { lat: origin.lat, lon: origin.lon + radOffset };
    expect(projectLocationToPixel(calibration, location)).toBeNull();
  });

  test('accuracyRingRadiusPixels handles degenerate Jacobian and colors', () => {
    expect(accuracyRingRadiusPixels({ status: 'fit-failed' }, origin, 10)).toBeNull();
    const calibration = {
      status: 'ok',
      origin,
      quality: { rmse: 20, maxResidual: 0 },
      model: {
        type: 'similarity',
        scale: 0,
        cos: 1,
        sin: 0,
        translation: { x: 0, y: 0 },
      },
    };
    expect(accuracyRingRadiusPixels(calibration, origin, 10)).toBeNull();

    const strongCalibration = {
      status: 'ok',
      origin,
      quality: { rmse: 5, maxResidual: 0 },
      model: {
        type: 'similarity',
        scale: 1,
        cos: 1,
        sin: 0,
        translation: { x: 0, y: 0 },
      },
    };
    const yellowRing = computeAccuracyRing(strongCalibration, 20);
    expect(yellowRing.color).toBe('yellow');
    const orangeRing = computeAccuracyRing(strongCalibration, 40);
    expect(orangeRing.color).toBe('orange');
    const redRing = computeAccuracyRing(strongCalibration, 70);
    expect(redRing.color).toBe('red');
    expect(computeAccuracyRing(null, 10)).toBeNull();

    const radOffset = radToDeg(1 / (EARTH_RADIUS_METERS * Math.cos(degToRad(origin.lat))));
    const singularCalibration = {
      status: 'ok',
      origin,
      quality: { rmse: 1, maxResidual: 0 },
      model: {
        type: 'homography',
        matrix: [
          [1, 0, 0],
          [0, 1, 0],
          [1, 0, -1],
        ],
      },
    };
    const singularLocation = { lat: origin.lat, lon: origin.lon + radOffset };
    expect(accuracyRingRadiusPixels(singularCalibration, singularLocation, 10)).toBeNull();
  });

  test('internal helpers cover defensive branches', () => {
    const {
      pickModelKinds,
      computeResidualMeters,
      huberWeight,
      evaluateModel,
      runReweightedFit,
      runRansacForKind,
    } = __internals;

    expect(pickModelKinds(1)).toEqual([]);

    const infinityTransform = {
      type: 'homography',
      matrix: [
        [1, 0, 0],
        [0, 1, 0],
        [1, 0, -1],
      ],
    };
    const singularPair = { pixel: { x: 1, y: 0 }, enu: { x: 0, y: 0 } };
    expect(computeResidualMeters(infinityTransform, singularPair)).toBe(Number.POSITIVE_INFINITY);

    expect(huberWeight(10, 35)).toBe(1);
    expect(huberWeight(100, 35)).toBeCloseTo(0.35);

    const dummyModel = {
      type: 'similarity',
      scale: 1,
      cos: 1,
      sin: 0,
      translation: { x: 0, y: 0 },
    };
    const dummyMetrics = evaluateModel('similarity', dummyModel, [singularPair], 5);
    expect(dummyMetrics.inlierCount).toBe(1);

    let toggle = 0;
    const altRandom = () => {
      const value = toggle % 2 === 0 ? 0.1 : 0.6;
      toggle += 1;
      return value;
    };
    const options = {
      iterations: 1,
      inlierThresholdMeters: 40,
      confidence: 0.98,
      huberDelta: 35,
      irlsIterations: 1,
      random: altRandom,
    };
    const degenerateRun = runReweightedFit('similarity', [singularPair], options);
    expect(degenerateRun).toBeNull();
    expect(runRansacForKind('homography', [singularPair], options)).toBeNull();
    const skipOptions = { ...options, irlsIterations: -1 };
    const simplePairs = [
      singularPair,
      { pixel: { x: 2, y: 0 }, enu: { x: 2, y: 0 } },
    ];
    expect(runReweightedFit('similarity', simplePairs, skipOptions)).toBeNull();
    expect(runRansacForKind('similarity', simplePairs, { ...skipOptions, iterations: 1 })).toBeNull();
  });
});
