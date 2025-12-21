import { computeOrigin, wgs84ToEnu } from '../geo/coordinate.js';
import {
  fitSimilarity,
  fitSimilarityFixedScale,
  fitAffine,
  fitHomography,
  applyTransform,
  applyInverseTransform,
  jacobianForTransform,
  averageScaleFromJacobian,
} from '../geo/transformations.js';

const DEFAULT_OPTIONS = {
  iterations: 150,
  inlierThresholdMeters: 40,
  confidence: 0.98,
  huberDelta: 35,
  irlsIterations: 1,
  random: Math.random,
};

const MODEL_PREFERENCES = {
  homography: { minPairs: 4, estimator: fitHomography },
  affine: { minPairs: 3, estimator: fitAffine },
  similarity: { minPairs: 2, estimator: fitSimilarity },
};

function pickModelKinds(pairCount) {
  if (pairCount >= 4) {
    return ['homography', 'affine', 'similarity'];
  }
  if (pairCount === 3) {
    return ['affine', 'similarity'];
  }
  if (pairCount === 2) {
    return ['similarity'];
  }
  return [];
}

function createEnrichedPairs(pairs, origin) {
  return pairs.map((pair) => ({
    pixel: pair.pixel,
    wgs84: pair.wgs84,
    enu: pair.enu || wgs84ToEnu(pair.wgs84, origin),
  }));
}

function sampleUniqueIndexes(randomFn, total, sampleSize) {
  const selected = new Set();
  while (selected.size < sampleSize) {
    const index = Math.floor(randomFn() * total);
    selected.add(index);
  }
  return Array.from(selected);
}

function fitModel(kind, pairs, weights, referenceScale) {
  if (kind === 'similarity' && referenceScale != null) {
    return fitSimilarityFixedScale(pairs, referenceScale, weights);
  }
  const estimator = MODEL_PREFERENCES[kind].estimator;
  return estimator(pairs, weights);
}

function computeResidualMeters(transform, pair) {
  const predicted = applyTransform(transform, pair.pixel);
  if (!predicted) {
    return Number.POSITIVE_INFINITY;
  }
  const dx = predicted.x - pair.enu.x;
  const dy = predicted.y - pair.enu.y;
  return Math.hypot(dx, dy);
}

function huberWeight(residual, delta) {
  const absResidual = Math.abs(residual);
  if (absResidual <= delta) {
    return 1;
  }
  return delta / absResidual;
}

function runReweightedFit(kind, pairs, options, referenceScale) {
  let weights = Array.from({ length: pairs.length }, () => 1);
  let model = null;

  for (let iteration = 0; iteration <= options.irlsIterations; iteration += 1) {
    model = fitModel(kind, pairs, weights, referenceScale);
    if (!model) {
      return null;
    }
    if (iteration === options.irlsIterations) {
      return { model, weights };
    }
    const residuals = pairs.map((pair) => computeResidualMeters(model, pair));
    weights = residuals.map((value) => huberWeight(value, options.huberDelta));
  }

  return null;
}

function evaluateModel(kind, model, pairs, threshold) {
  const residuals = pairs.map((pair) => computeResidualMeters(model, pair));
  const inliers = residuals.map((value) => value <= threshold);
  let inlierSum = 0;
  let inlierCount = 0;
  let maxResidual = 0;

  for (let i = 0; i < residuals.length; i += 1) {
    const value = residuals[i];
    if (inliers[i]) {
      inlierSum += value * value;
      inlierCount += 1;
    }
    if (value > maxResidual) {
      maxResidual = value;
    }
  }

  const rmse = Math.sqrt(inlierSum / Math.max(inlierCount, 1));

  return {
    residuals,
    inliers,
    inlierCount,
    rmse: Number.isFinite(rmse) ? rmse : Number.POSITIVE_INFINITY,
    maxResidual,
  };
}

function calibrationStatus(kind) {
  if (kind === 'homography') {
    return { level: 'high', message: 'Accuracy high (homography).' };
  }
  if (kind === 'affine') {
    return { level: 'medium', message: 'Accuracy medium (affine).' };
  }
  return { level: 'low', message: 'Accuracy low (similarity). Add more reference points.' };
}

export function computeAccuracyRing(calibration, gpsAccuracy) {
  if (!calibration || !calibration.model) {
    return null;
  }

  const sigmaMap = calibration.quality.rmse;
  const sigmaGps = gpsAccuracy;
  const sigmaTotal = Math.sqrt(sigmaGps * sigmaGps + sigmaMap * sigmaMap);
  let color = 'green';
  if (sigmaTotal > 60) {
    color = 'red';
  } else if (sigmaTotal > 30) {
    color = 'orange';
  } else if (sigmaTotal > 15) {
    color = 'yellow';
  }

  return {
    sigmaMap,
    sigmaGps,
    sigmaTotal,
    color,
  };
}

function runRansacForKind(kind, pairs, options, referenceScale) {
  const { minPairs } = MODEL_PREFERENCES[kind];
  if (pairs.length < minPairs) {
    return null;
  }

  let best = null;
  const iterationBudget = Math.min(options.iterations, pairs.length === minPairs ? 1 : options.iterations);

  for (let iteration = 0; iteration < iterationBudget; iteration += 1) {
    const sampleIndexes = sampleUniqueIndexes(options.random, pairs.length, minPairs);
    const sample = sampleIndexes.map((index) => pairs[index]);
    const candidate = fitModel(kind, sample, undefined, referenceScale);
    if (!candidate) {
      continue;
    }
    const metrics = evaluateModel(kind, candidate, pairs, options.inlierThresholdMeters);

    if (!best || metrics.inlierCount > best.metrics.inlierCount) {
      best = { candidate, metrics };
    }
  }

  if (!best || best.metrics.inlierCount < minPairs) {
    return null;
  }

  const inlierPairs = pairs.filter((pair, index) => best.metrics.inliers[index]);
  const refined = runReweightedFit(kind, inlierPairs, options, referenceScale);
  if (!refined) {
    return null;
  }

  const finalMetrics = evaluateModel(kind, refined.model, pairs, options.inlierThresholdMeters);

  return {
    kind,
    model: refined.model,
    metrics: finalMetrics,
  };
}

function pixelFromLocation(calibration, location) {
  if (!calibration || calibration.status !== 'ok') {
    return null;
  }
  const enu = wgs84ToEnu(location, calibration.origin);
  const pixel = applyInverseTransform(calibration.model, enu);
  return pixel || null;
}

export function calibrateMap(pairs, userOptions = {}) {
  if (!pairs || pairs.length < 2) {
    return {
      status: 'insufficient-pairs',
      message: 'At least two reference pairs are required to calibrate the map.',
    };
  }

  const options = { ...DEFAULT_OPTIONS, ...userOptions };
  const origin = userOptions.origin || computeOrigin(pairs);
  const enrichedPairs = createEnrichedPairs(pairs, origin);
  const referenceScale = userOptions.referenceScale;

  const modelKinds = pickModelKinds(enrichedPairs.length);

  for (let i = 0; i < modelKinds.length; i += 1) {
    const kind = modelKinds[i];
    const result = runRansacForKind(kind, enrichedPairs, options, referenceScale);
    if (result) {
      const { metrics } = result;
      const combined = {
        status: 'ok',
        origin,
        kind: result.kind,
        model: result.model,
        metrics,
        quality: {
          rmse: metrics.rmse,
          maxResidual: metrics.maxResidual,
        },
        statusMessage: calibrationStatus(result.kind),
        residuals: metrics.residuals,
        inliers: metrics.inliers,
      };
      return combined;
    }
  }

  return {
    status: 'fit-failed',
    message: 'Calibration failed. Try adding more accurate reference pairs.',
  };
}

export function projectLocationToPixel(calibration, location) {
  return pixelFromLocation(calibration, location);
}

export function accuracyRingRadiusPixels(calibration, location, gpsAccuracy) {
  if (!calibration || calibration.status !== 'ok') {
    return null;
  }
  const pixel = pixelFromLocation(calibration, location);
  if (!pixel) {
    return null;
  }
  const jacobian = jacobianForTransform(calibration.model, pixel);
  const metersPerPixel = averageScaleFromJacobian(jacobian);
  if (!metersPerPixel || metersPerPixel === 0) {
    return null;
  }
  const ring = computeAccuracyRing(calibration, gpsAccuracy);
  return {
    ...ring,
    pixelRadius: ring ? ring.sigmaTotal / metersPerPixel : null,
  };
}

const api = {
  calibrateMap,
  computeAccuracyRing,
  projectLocationToPixel,
  accuracyRingRadiusPixels,
};

export const __internals = {
  pickModelKinds,
  computeResidualMeters,
  huberWeight,
  runReweightedFit,
  evaluateModel,
  runRansacForKind,
};

const exported = { ...api, __internals };

export default exported;
