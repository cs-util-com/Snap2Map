/**
 * @file src/calib/transforms.js
 * @description Contains functions to fit geometric transformations (Affine, Homography, etc.)
 * between two sets of corresponding points.
 */

/**
 * Normalizes a set of 2D points to have a centroid at (0,0) and mean distance of sqrt(2).
 * This is a crucial step for the numerical stability of the DLT algorithm.
 * @param {Array<{x: number, y: number}>} points - The points to normalize.
 * @returns {{normalizedPoints: Array, T: math.Matrix}} - The normalized points and the normalization matrix.
 */
function normalizePoints(points) {
  const n = points.length;
  const { sum } = points.reduce((acc, p) => {
    acc.sum.x += p.x;
    acc.sum.y += p.y;
    return acc;
  }, { sum: { x: 0, y: 0 } });

  const centroid = { x: sum.x / n, y: sum.y / n };

  const meanDist = points.reduce((acc, p) => {
    return acc + Math.sqrt(Math.pow(p.x - centroid.x, 2) + Math.pow(p.y - centroid.y, 2));
  }, 0) / n;

  const scale = Math.sqrt(2) / meanDist;

  // Normalization matrix
  const T = math.matrix([
    [scale, 0, -scale * centroid.x],
    [0, scale, -scale * centroid.y],
    [0, 0, 1]
  ]);

  const normalizedPoints = points.map(p => {
    const pHom = [p.x, p.y, 1];
    const normPHom = math.multiply(T, pHom);
    return { x: normPHom.get([0]) / normPHom.get([2]), y: normPHom.get([1]) / normPHom.get([2]) };
  });

  return { normalizedPoints, T };
}


/**
 * Fits an affine transformation matrix to a set of corresponding points.
 * @param {Array<{pixel: {x, y}, enu: {x, y}}>} pairs - At least 3 corresponding pairs.
 * @param {Array<number>} [weights] - Optional weights for each pair for IRLS.
 * @returns {math.Matrix|null} The 3x3 affine transformation matrix, or null if unfit.
 */
export function fitAffine(pairs, weights) {
  if (pairs.length < 3) {
    console.error("Affine fit requires at least 3 pairs.");
    return null;
  }

  const srcPoints = pairs.map(p => p.pixel);
  const dstPoints = pairs.map(p => p.enu);

  const M = [];
  const B = [];

  for (let i = 0; i < pairs.length; i++) {
    const { x, y } = srcPoints[i];
    const { x: xp, y: yp } = dstPoints[i];
    M.push([x, y, 1, 0, 0, 0]);
    M.push([0, 0, 0, x, y, 1]);
    B.push(xp);
    B.push(yp);
  }

  try {
    const MT = math.transpose(M);
    let A;

    if (weights && weights.length === pairs.length) {
      // Weighted least squares for IRLS
      const W = math.diag(weights.flatMap(w => [w, w])); // Repeat weight for x and y equations
      const MTW = math.multiply(MT, W);
      const MTWM = math.multiply(MTW, M);
      const MTWB = math.multiply(MTW, B);
      A = math.flatten(math.lusolve(MTWM, MTWB));
    } else {
      // Standard least squares
      const MTM = math.multiply(MT, M);
      const MTB = math.multiply(MT, B);
      A = math.flatten(math.lusolve(MTM, MTB));
    }

    // Reconstruct the 3x3 affine matrix
    const H = math.matrix([
      [A[0], A[1], A[2]],
      [A[3], A[4], A[5]],
      [0, 0, 1]
    ]);

    return H;
  } catch (error) {
    console.error("Error solving for affine transformation:", error);
    return null;
  }
}

/**
 * Fits a similarity transformation (rotation, uniform scale, translation) to a set of points.
 * @param {Array<{pixel: {x, y}, enu: {x, y}}>} pairs - 2 or more corresponding pairs.
 * @returns {math.Matrix|null} The 3x3 similarity transformation matrix, or null if unfit.
 */
export function fitSimilarity(pairs) {
  if (pairs.length < 2) {
    console.error("Similarity fit requires at least 2 pairs.");
    return null;
  }

  const srcPoints = pairs.map(p => p.pixel);
  const dstPoints = pairs.map(p => p.enu);

  const n = pairs.length;
  const srcCentroid = srcPoints.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
  srcCentroid.x /= n;
  srcCentroid.y /= n;

  const dstCentroid = dstPoints.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
  dstCentroid.x /= n;
  dstCentroid.y /= n;

  // Use the Kabsch algorithm (simplified for 2D)
  // Covariance matrix H
  let Hxx = 0, Hxy = 0, Hyx = 0, Hyy = 0;
  for (let i = 0; i < n; i++) {
    const src = { x: srcPoints[i].x - srcCentroid.x, y: srcPoints[i].y - srcCentroid.y };
    const dst = { x: dstPoints[i].x - dstCentroid.x, y: dstPoints[i].y - dstCentroid.y };
    Hxx += src.x * dst.x;
    Hxy += src.x * dst.y;
    Hyx += src.y * dst.x;
    Hyy += src.y * dst.y;
  }

  const H = [[Hxx, Hxy], [Hyx, Hyy]];

  try {
    const svd = math.svd(H);
    let R = math.multiply(svd.V, math.transpose(svd.U));

    // Check for reflection and correct if necessary
    if (math.det(R) < 0) {
      const V_prime = math.clone(svd.V);
      V_prime.set([0, 1], V_prime.get([0, 1]) * -1);
      V_prime.set([1, 1], V_prime.get([1, 1]) * -1);
      R = math.multiply(V_prime, math.transpose(svd.U));
    }

    const c = math.trace(math.multiply(math.diag(svd.s), math.transpose(R))) / pairs.reduce((sum, p) => sum + (p.pixel.x - srcCentroid.x)**2 + (p.pixel.y - srcCentroid.y)**2, 0);
    const t = math.subtract(math.matrix([dstCentroid.x, dstCentroid.y]), math.multiply(c, R, math.matrix([srcCentroid.x, srcCentroid.y])));

    // Construct the 3x3 augmented matrix
    const M = math.matrix([
      [c * R.get([0, 0]), c * R.get([0, 1]), t.get([0])],
      [c * R.get([1, 0]), c * R.get([1, 1]), t.get([1])],
      [0, 0, 1]
    ]);

    return M;
  } catch(error) {
    console.error("Error solving for similarity transformation:", error);
    return null;
  }
}

/**
 * Fits a homography matrix (perspective transformation) to a set of corresponding points.
 * Uses the Direct Linear Transform (DLT) algorithm with normalization for stability.
 * @param {Array<{pixel: {x, y}, enu: {x, y}}>} pairs - At least 4 corresponding pairs.
 * @param {Array<number>} [weights] - Optional weights for each pair for IRLS.
 * @returns {math.Matrix|null} The 3x3 homography matrix, or null if unfit.
 */
export function fitHomography(pairs, weights) {
  if (pairs.length < 4) {
    console.error("Homography fit requires at least 4 pairs.");
    return null;
  }

  const srcPoints = pairs.map(p => p.pixel);
  const dstPoints = pairs.map(p => p.enu);

  const { normalizedPoints: normSrc, T: T_src } = normalizePoints(srcPoints);
  const { normalizedPoints: normDst, T: T_dst } = normalizePoints(dstPoints);

  const A = [];
  for (let i = 0; i < pairs.length; i++) {
    const { x, y } = normSrc[i];
    const { x: xp, y: yp } = normDst[i];
    A.push([-x, -y, -1, 0, 0, 0, x * xp, y * xp, xp]);
    A.push([0, 0, 0, -x, -y, -1, x * yp, y * yp, yp]);
  }

  try {
    let h;
    if (weights && weights.length === pairs.length) {
      // Weighted DLT for IRLS
      const W = math.diag(weights.flatMap(w => [w, w]));
      const WA = math.multiply(W, A);
      const svd = math.svd(WA);
      h = svd.V.toArray().pop();
    } else {
      // Standard DLT
      const svd = math.svd(A);
      h = svd.V.toArray().pop();
    }

    const H_norm = math.matrix(h).reshape([3, 3]);

    // De-normalize the homography
    const T_dst_inv = math.inv(T_dst);
    const H = math.multiply(T_dst_inv, H_norm, T_src);

    return H;
  } catch (error) {
    console.error("Error solving for homography:", error);
    return null;
  }
}
