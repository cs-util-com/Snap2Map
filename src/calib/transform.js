// Calibration transform utilities for Snap2Map
// Implements minimal similarity, affine and homography fits based on
// reference pairs between photo pixels and world coordinates (meters)

/**
 * Solve a linear system A x = b using Gaussian elimination with partial pivoting.
 * @param {number[][]} A square matrix
 * @param {number[]} b right hand side
 * @returns {number[]} solution vector
 */
function solve(A, b) {
  const n = A.length;
  for (let i = 0; i < n; i++) {
    // pivot
    let max = i;
    for (let j = i + 1; j < n; j++) {
      if (Math.abs(A[j][i]) > Math.abs(A[max][i])) max = j;
    }
    if (Math.abs(A[max][i]) < 1e-12) throw new Error('Singular matrix');
    [A[i], A[max]] = [A[max], A[i]];
    [b[i], b[max]] = [b[max], b[i]];

    // normalize row
    const diag = A[i][i];
    for (let k = i; k < n; k++) A[i][k] /= diag;
    b[i] /= diag;

    // eliminate
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      const factor = A[j][i];
      for (let k = i; k < n; k++) A[j][k] -= factor * A[i][k];
      b[j] -= factor * b[i];
    }
  }
  return b;
}

/**
 * Solve an overdetermined system in the least-squares sense using normal equations.
 * @param {number[][]} rows matrix rows
 * @param {number[]} rhs right hand side
 * @param {number[]} [weights] optional weights per row
 * @returns {number[]} solution vector
 */
function leastSquares(rows, rhs, weights) {
  const m = rows[0].length;
  const A = Array.from({ length: m }, () => Array(m).fill(0));
  const b = Array(m).fill(0);
  for (let i = 0; i < rows.length; i++) {
    const w = weights ? weights[i] : 1;
    const row = rows[i];
    for (let j = 0; j < m; j++) {
      b[j] += w * row[j] * rhs[i];
      for (let k = 0; k < m; k++) {
        A[j][k] += w * row[j] * row[k];
      }
    }
  }
  return solve(A, b);
}

function applySimilarity(model, w) {
  const cos = Math.cos(model.angle);
  const sin = Math.sin(model.angle);
  return {
    x: model.scale * (cos * w.x - sin * w.y) + model.tx,
    y: model.scale * (sin * w.x + cos * w.y) + model.ty,
  };
}

function computeSimilarity(pairs, weights) {
  if (pairs.length < 2) throw new Error('Need at least 2 pairs');
  const rows = [];
  const rhs = [];
  const wts = [];
  pairs.forEach((p, i) => {
    rows.push([p.world.x, -p.world.y, 1, 0]);
    rhs.push(p.pixel.x);
    wts.push(weights ? weights[i] : 1);
    rows.push([p.world.y, p.world.x, 0, 1]);
    rhs.push(p.pixel.y);
    wts.push(weights ? weights[i] : 1);
  });
  const sol = leastSquares(rows, rhs, wts);
  const a = sol[0];
  const b = sol[1];
  const scale = Math.hypot(a, b);
  const angle = Math.atan2(b, a);
  return { type: 'similarity', scale, angle, tx: sol[2], ty: sol[3] };
}

function applyAffine(model, w) {
  return {
    x: model.a * w.x + model.b * w.y + model.tx,
    y: model.c * w.x + model.d * w.y + model.ty,
  };
}

function computeAffine(pairs, weights) {
  if (pairs.length < 3) throw new Error('Need at least 3 pairs');
  const rows = [];
  const rhs = [];
  const wts = [];
  pairs.forEach((p, i) => {
    rows.push([p.world.x, p.world.y, 1, 0, 0, 0]);
    rhs.push(p.pixel.x);
    wts.push(weights ? weights[i] : 1);
    rows.push([0, 0, 0, p.world.x, p.world.y, 1]);
    rhs.push(p.pixel.y);
    wts.push(weights ? weights[i] : 1);
  });
  const sol = leastSquares(rows, rhs, wts);
  return {
    type: 'affine',
    a: sol[0],
    b: sol[1],
    tx: sol[2],
    c: sol[3],
    d: sol[4],
    ty: sol[5],
  };
}

function applyHomography(model, w) {
  const { h } = model;
  const den = h[6] * w.x + h[7] * w.y + 1;
  return {
    x: (h[0] * w.x + h[1] * w.y + h[2]) / den,
    y: (h[3] * w.x + h[4] * w.y + h[5]) / den,
  };
}

function computeHomography(pairs, weights) {
  if (pairs.length < 4) throw new Error('Need at least 4 pairs');
  const rows = [];
  const rhs = [];
  const wts = [];
  pairs.forEach((p, i) => {
    const X = p.world.x;
    const Y = p.world.y;
    rows.push([X, Y, 1, 0, 0, 0, -p.pixel.x * X, -p.pixel.x * Y]);
    rhs.push(p.pixel.x);
    wts.push(weights ? weights[i] : 1);
    rows.push([0, 0, 0, X, Y, 1, -p.pixel.y * X, -p.pixel.y * Y]);
    rhs.push(p.pixel.y);
    wts.push(weights ? weights[i] : 1);
  });
  const sol = leastSquares(rows, rhs, wts);
  sol.push(1);
  return { type: 'homography', h: sol };
}

function applyTransform(model, w) {
  switch (model.type) {
    case 'similarity':
      return applySimilarity(model, w);
    case 'affine':
      return applyAffine(model, w);
    case 'homography':
      return applyHomography(model, w);
    default:
      throw new Error('Unknown model type');
  }
}

function computeTransform(pairs, weights) {
  if (pairs.length === 2) return computeSimilarity(pairs, weights);
  if (pairs.length === 3) return computeAffine(pairs, weights);
  if (pairs.length >= 4) return computeHomography(pairs, weights);
  throw new Error('Insufficient pairs');
}

module.exports = {
  solve,
  computeSimilarity,
  computeAffine,
  computeHomography,
  computeTransform,
  applyTransform,
  leastSquares,
};
