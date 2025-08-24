/**
 * @file src/calib/robust.js
 * @description Implements robust model fitting algorithms like RANSAC and IRLS.
 */

import { fitSimilarity, fitAffine, fitHomography } from './transforms.js';

/**
 * Selects a random subset of elements from an array.
 * @param {Array} arr - The source array.
 * @param {number} n - The number of elements to select.
 * @returns {Array} A new array with n random elements.
 */
function getRandomSubset(arr, n) {
  const result = new Array(n);
  let len = arr.length;
  const taken = new Array(len);
  if (n > len) {
    throw new RangeError("getRandomSubset: n is larger than array length.");
  }
  while (n--) {
    const x = Math.floor(Math.random() * len);
    result[n] = arr[x in taken ? taken[x] : x];
    taken[x] = --len in taken ? taken[len] : len;
  }
  return result;
}

/**
 * Calculates the Euclidean distance between two 2D points.
 * @param {{x: number, y: number}} p1
 * @param {{x: number, y: number}} p2
 * @returns {number} The distance.
 */
function distance(p1, p2) {
  return Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
}

/**
 * Projects a point using a given transformation matrix.
 * @param {{x: number, y: number}} point - The point to project.
 * @param {math.Matrix} H - The 3x3 transformation matrix.
 * @returns {{x: number, y: number}} The projected point.
 */
function projectPoint(point, H) {
  const p = [point.x, point.y, 1];
  const p_prime = math.multiply(H, p).toArray();
  return { x: p_prime[0] / p_prime[2], y: p_prime[1] / p_prime[2] };
}

/**
 * Finds the best-fit transformation using the RANSAC algorithm.
 * @param {'similarity'|'affine'|'homography'} kind - The type of model to fit.
 * @param {Array<{pixel: {x,y}, enu: {x,y}}>} pairs - All available pairs.
 * @param {{inlierThreshold: number, maxSamples: number}} config - RANSAC parameters.
 * @returns {{model: math.Matrix, inliers: Array}|null} The best model and its inliers.
 */
export function ransac(kind, pairs, config) {
  const fitFns = {
    similarity: { fit: fitSimilarity, sampleSize: 2 },
    affine: { fit: fitAffine, sampleSize: 3 },
    homography: { fit: fitHomography, sampleSize: 4 },
  };

  const { fit, sampleSize } = fitFns[kind];
  if (!fit || pairs.length < sampleSize) {
    return null;
  }

  let bestModel = null;
  let bestInliers = [];

  for (let i = 0; i < config.maxSamples; i++) {
    const sample = getRandomSubset(pairs, sampleSize);
    const model = fit(sample);

    if (!model) continue;

    const currentInliers = [];
    for (const pair of pairs) {
      const projectedEnu = projectPoint(pair.pixel, model);
      const error = distance(projectedEnu, pair.enu);
      if (error < config.inlierThreshold) {
        currentInliers.push(pair);
      }
    }

    if (currentInliers.length > bestInliers.length) {
      bestInliers = currentInliers;
      bestModel = model;
    }
  }

  // Optional: Refit the model using all inliers from the best set.
  if (bestInliers.length >= sampleSize) {
    const refitModel = fit(bestInliers);
    if (refitModel) {
      bestModel = refitModel;
    }
  }

  return { model: bestModel, inliers: bestInliers };
}

/**
 * Refines a model using Iteratively Reweighted Least Squares (IRLS).
 * @param {'affine'|'homography'} kind - The type of model to fit.
 * @param {Array} inliers - The set of inlier pairs from RANSAC.
 * @param {math.Matrix} initialModel - The model found by RANSAC.
 * @param {{huberDelta: number}} config - IRLS parameters.
 * @returns {math.Matrix|null} The refined model.
 */
export function irls(kind, inliers, initialModel, config) {
  const fitFns = {
    affine: fitAffine,
    homography: fitHomography,
  };
  const fit = fitFns[kind];
  if (!fit) {
    console.warn(`IRLS not supported for kind: ${kind}`);
    return initialModel;
  }

  // 1. Calculate residuals from the initial model
  const residuals = inliers.map(pair => {
    const projected = projectPoint(pair.pixel, initialModel);
    return distance(projected, pair.enu);
  });

  // 2. Calculate Huber weights
  const { huberDelta } = config;
  const weights = residuals.map(r => (r <= huberDelta ? 1 : huberDelta / Math.abs(r)));

  // 3. Perform a single weighted least squares fit
  const refinedModel = fit(inliers, weights);

  return refinedModel || initialModel; // Return original model if refinement fails
}
