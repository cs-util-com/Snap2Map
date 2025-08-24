const {
  computeSimilarity,
  computeAffine,
  computeHomography,
  applyTransform,
} = require('./transform');

const MIN_PAIRS = { similarity: 2, affine: 3, homography: 4 };
const COMPUTE = {
  similarity: computeSimilarity,
  affine: computeAffine,
  homography: computeHomography,
};

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function pickSubset(arr, k, rng = Math.random) {
  const copy = arr.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, k);
}

function ransac(pairs, modelType, opts = {}) {
  const { samples = 150, threshold = 40, rng = Math.random } = opts;
  const compute = COMPUTE[modelType];
  const min = MIN_PAIRS[modelType];
  let bestModel = null;
  let bestInliers = [];
  for (let i = 0; i < samples; i++) {
    const subset = pickSubset(pairs, min, rng);
    let model;
    try {
      model = compute(subset);
    } catch {
      continue;
    }
    const inliers = [];
    for (const p of pairs) {
      const proj = applyTransform(model, p.world);
      if (distance(proj, p.pixel) <= threshold) {
        inliers.push(p);
      }
    }
    if (inliers.length > bestInliers.length) {
      bestInliers = inliers;
      bestModel = model;
    }
  }
  if (!bestModel) throw new Error('RANSAC failed');
  bestModel = compute(bestInliers);
  return { model: bestModel, inliers: bestInliers };
}

function irls(pairs, model, modelType, opts = {}) {
  const { delta = 35 } = opts;
  const compute = COMPUTE[modelType];
  const residuals = pairs.map((p) => distance(applyTransform(model, p.world), p.pixel));
  const weights = residuals.map((r) => {
    const a = Math.abs(r);
    return a <= delta ? 1 : delta / a;
    // Huber weighting
  });
  return compute(pairs, weights);
}

function calibrate(pairs, opts = {}) {
  if (pairs.length < 2) throw new Error('Need at least two pairs');
  const requested = opts.modelType;
  const modelType = requested
    ? requested
    : pairs.length >= 4
    ? 'homography'
    : pairs.length === 3
    ? 'affine'
    : 'similarity';
  if (pairs.length < MIN_PAIRS[modelType]) {
    throw new Error('Insufficient pairs for model');
  }
  const { model: ransacModel, inliers } = ransac(pairs, modelType, opts);
  const refined = irls(inliers, ransacModel, modelType, opts);
  const residuals = pairs.map((p) => distance(applyTransform(refined, p.world), p.pixel));
  return { model: refined, residuals };
}

module.exports = { calibrate, ransac, irls, distance };
