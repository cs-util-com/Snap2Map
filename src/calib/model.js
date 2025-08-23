/**
 * @file src/calib/model.js
 * @description The main calibration model that orchestrates the fitting process and coordinate projections.
 */

import { projectToEnu, unprojectFromEnu } from '../util/coords.js';
import { ransac, irls } from './robust.js';
import { RefinerTPS } from './tps.js';

// This utility function should probably be in its own file, but for now, it's here.
function projectPoint(point, H) {
  const p = [point.x, point.y, 1];
  const p_prime = math.multiply(H, p).toArray();
  return { x: p_prime[0] / p_prime[2], y: p_prime[1] / p_prime[2] };
}

export class CalibrationModel {
  constructor() {
    this.pairs = [];
    this.activePairs = [];
    this.transform = null; // The base transformation matrix
    this.tpsRefiner = null; // The TPS model for non-linear refinement
    this.enuOrigin = null;
    this.inliers = [];
    this.rmse = null;
  }

  addPair(pair) {
    this.pairs.push(pair);
    // For now, all pairs are active. Later, we can add a toggle.
    this.activePairs = this.pairs;

    if (!this.enuOrigin) {
      this.enuOrigin = pair.wgs84;
      console.log('ENU origin set to the first pair:', this.enuOrigin);
    }
  }

  /**
   * Fits a transformation model to the active pairs.
   * @returns {boolean} True if a model was successfully fitted.
   */
  fit() {
    if (this.activePairs.length < 2) {
      console.warn("Not enough pairs to fit a model.");
      return false;
    }

    // Project all pairs to ENU using the consistent origin
    const enuPairs = this.activePairs.map(p => ({
      pixel: p.pixel,
      enu: projectToEnu(p.wgs84, this.enuOrigin),
    }));

    let kind;
    if (enuPairs.length >= 4) kind = 'homography';
    else if (enuPairs.length === 3) kind = 'affine';
    else kind = 'similarity';

    console.log(`Fitting with ${kind} model...`);

    const ransacConfig = { inlierThreshold: 40, maxSamples: 150 };
    const ransacResult = ransac(kind, enuPairs, ransacConfig);

    if (!ransacResult || !ransacResult.model) {
      console.error("RANSAC failed to find a model.");
      this.transform = null;
      return false;
    }

    console.log(`RANSAC found ${ransacResult.inliers.length} inliers.`);

    const irlsConfig = { huberDelta: 35 };
    const finalModel = irls(kind, ransacResult.inliers, ransacResult.model, irlsConfig);

    this.transform = finalModel;
    this.inliers = ransacResult.inliers;
    this.rmse = this.getProjectionError(this.inliers);
    console.log(`Model fitting complete. RMSE: ${this.rmse.toFixed(2)}m`);
    return true;
  }

  /**
   * Projects a WGS84 coordinate to a pixel coordinate on the map image.
   * @param {{lat: number, lon: number}} latLon - The WGS84 coordinate.
   * @returns {{x: number, y: number}|null} The projected pixel coordinate.
   */
  projectLatLonToPixel(latLon) {
    if (!this.transform || !this.enuOrigin) {
      return null;
    }
    // This is the hard part with TPS, as it requires an inverse warp.
    // For now, this function will ignore the TPS refinement.
    const enuPoint = projectToEnu(latLon, this.enuOrigin);
    const invTransform = math.inv(this.transform);
    return projectPoint(enuPoint, invTransform);
  }

  projectPixelToEnu(pixel) {
    if (!this.transform) return null;

    let warpedPixel = pixel;
    if (this.tpsRefiner) {
      warpedPixel = this.tpsRefiner.warp(pixel);
    }

    return projectPoint(warpedPixel, this.transform);
  }

  /**
   * Calculates the Root Mean Square Error of the projection for a given set of pairs.
   * @param {Array} pairs - The pairs to calculate the error for.
   * @returns {number|null} The RMSE in meters.
   */
  getProjectionError(pairs) {
    if (!this.transform || pairs.length === 0) {
      return null;
    }
    const errors = pairs.map(p => {
      const projectedEnu = this.projectPixelToEnu(p.pixel);
      return Math.pow(distance(projectedEnu, p.enu), 2);
    });
    return Math.sqrt(errors.reduce((a, b) => a + b, 0) / errors.length);
  }

  /**
   * Estimates the local scale (pixels per meter) from the transformation matrix.
   * @returns {number|null} The average scale.
   */
  getScale() {
    if (!this.transform) return null;
    // Use the Frobenius norm of the top-left 2x2 matrix as an approximation of scale
    const A = this.transform.subset(math.index([0, 1], [0, 1]));
    const scale = math.sqrt(math.trace(math.multiply(math.transpose(A), A)) / 2);
    return scale;
  }
}

function distance(p1, p2) {
  return Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
}

// --- TPS Methods ---
Object.assign(CalibrationModel.prototype, {
  enableTPS(lambda = 1e-6) {
    if (!this.transform || this.inliers.length < 3) {
      console.error("Cannot enable TPS without a valid base transform and enough inliers.");
      return;
    }

    console.log(`Enabling TPS with lambda = ${lambda}`);
    const invTransform = math.inv(this.transform);

    const controlPoints = this.inliers.map(p => p.pixel);
    const targetPoints = this.inliers.map(p => projectPoint(p.enu, invTransform));

    this.tpsRefiner = new RefinerTPS();
    this.tpsRefiner.fit(controlPoints, targetPoints, lambda);

    // Recalculate RMSE with TPS enabled
    this.rmse = this.getProjectionError(this.inliers);
    console.log(`RMSE with TPS: ${this.rmse.toFixed(2)}m`);
  },

  disableTPS() {
    if (!this.tpsRefiner) return;
    console.log("Disabling TPS.");
    this.tpsRefiner = null;
    // Recalculate RMSE with TPS disabled
    this.rmse = this.getProjectionError(this.inliers);
    console.log(`RMSE without TPS: ${this.rmse.toFixed(2)}m`);
  }
});
