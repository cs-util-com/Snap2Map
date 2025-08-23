/**
 * @file src/calib/tps.js
 * @description Implements the Thin-Plate Spline (TPS) refinement for non-linear warping.
 */

export class RefinerTPS {
  constructor() {
    this.controlPoints = null;
    this.weightsX = null;
    this.weightsY = null;
  }

  /**
   * Radial basis function U(r) = r^2 * log(r).
   * @param {number} r - The radius.
   * @returns {number} The function result.
   */
  static U(r) {
    if (r === 0) return 0;
    return r * r * Math.log(r);
  }

  /**
   * Fits the TPS model to a set of control points and their targets.
   * @param {Array<{x, y}>} controlPoints - The source points for the warp.
   * @param {Array<{x, y}>} targetPoints - The corresponding destination points.
   * @param {number} lambda - The regularization parameter.
   */
  fit(controlPoints, targetPoints, lambda) {
    const n = controlPoints.length;
    if (n < 3) {
      console.error("TPS requires at least 3 control points.");
      return;
    }
    this.controlPoints = controlPoints;

    // Create the L matrix for the linear system
    const L = math.zeros(n + 3, n + 3);

    // Fill K part (U(|c_i - c_j|))
    for (let i = 0; i < n; i++) {
      for (let j = i; j < n; j++) {
        const r = math.distance([controlPoints[i].x, controlPoints[i].y], [controlPoints[j].x, controlPoints[j].y]);
        const u = RefinerTPS.U(r);
        L.set([i, j], u);
        L.set([j, i], u);
      }
    }

    // Add regularization lambda to the diagonal of K
    for (let i = 0; i < n; i++) {
      L.set([i, i], L.get([i, i]) + lambda);
    }

    // Fill P part
    const P = math.matrix(controlPoints.map(p => [1, p.x, p.y]));
    L.subset(math.index(math.range(0, n), math.range(n, n + 3)), P);
    L.subset(math.index(math.range(n, n + 3), math.range(0, n)), math.transpose(P));

    // Create the Y vectors (one for x, one for y)
    const Yx = math.zeros(n + 3, 1);
    const Yy = math.zeros(n + 3, 1);
    for (let i = 0; i < n; i++) {
      Yx.set([i, 0], targetPoints[i].x);
      Yy.set([i, 0], targetPoints[i].y);
    }

    try {
      // Solve the linear systems L*w = Y for both x and y
      this.weightsX = math.lusolve(L, Yx);
      this.weightsY = math.lusolve(L, Yy);
      console.log("TPS model fitted successfully.");
    } catch (error) {
      console.error("Error solving TPS linear system:", error);
      this.weightsX = null;
      this.weightsY = null;
    }
  }

  /**
   * Warps a single point using the fitted TPS model.
   * @param {{x: number, y: number}} point - The point to warp.
   * @returns {{x: number, y: number}|null} The warped point, or null if model not fitted.
   */
  warp(point) {
    if (!this.weightsX || !this.controlPoints) {
      return null;
    }

    const n = this.controlPoints.length;
    const { x, y } = point;

    // Affine part
    let warpedX = this.weightsX.get([n, 0]) + this.weightsX.get([n + 1, 0]) * x + this.weightsX.get([n + 2, 0]) * y;
    let warpedY = this.weightsY.get([n, 0]) + this.weightsY.get([n + 1, 0]) * x + this.weightsY.get([n + 2, 0]) * y;

    // Non-linear part
    for (let i = 0; i < n; i++) {
      const r = math.distance([x, y], [this.controlPoints[i].x, this.controlPoints[i].y]);
      const u = RefinerTPS.U(r);
      warpedX += this.weightsX.get([i, 0]) * u;
      warpedY += this.weightsY.get([i, 0]) * u;
    }

    return { x: warpedX, y: warpedY };
  }
}
