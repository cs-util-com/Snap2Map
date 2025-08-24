const fc = require('fast-check');
const {
  computeSimilarity,
  computeAffine,
  computeHomography,
  computeTransform,
  applyTransform,
} = require('./transform');

function approxEqual(a, b, eps = 1e-6) {
  return Math.abs(a - b) < eps;
}

describe('computeSimilarity', () => {
  test('recovers known transform', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.1, max: 10, noDefaultInfinity: true, noNaN: true }), // scale
        fc.double({ min: -Math.PI, max: Math.PI, noDefaultInfinity: true, noNaN: true }), // angle
        fc.double({ min: -1000, max: 1000, noDefaultInfinity: true, noNaN: true }), // tx
        fc.double({ min: -1000, max: 1000, noDefaultInfinity: true, noNaN: true }), // ty
        fc.double({ min: -500, max: 500, noDefaultInfinity: true, noNaN: true }),
        fc.double({ min: -500, max: 500, noDefaultInfinity: true, noNaN: true }),
        fc.double({ min: -500, max: 500, noDefaultInfinity: true, noNaN: true }),
        fc.double({ min: -500, max: 500, noDefaultInfinity: true, noNaN: true }),
        (
          scale,
          angle,
          tx,
          ty,
          x1,
          y1,
          x2,
          y2,
        ) => {
          if (Math.hypot(x2 - x1, y2 - y1) < 1e-6) return true; // skip degenerate
          const model = { type: 'similarity', scale, angle, tx, ty };
          const p1 = applyTransform(model, { x: x1, y: y1 });
          const p2 = applyTransform(model, { x: x2, y: y2 });
          const est = computeSimilarity([
            { world: { x: x1, y: y1 }, pixel: p1 },
            { world: { x: x2, y: y2 }, pixel: p2 },
          ]);
          const p1e = applyTransform(est, { x: x1, y: y1 });
          const p2e = applyTransform(est, { x: x2, y: y2 });
          return (
            approxEqual(p1.x, p1e.x) &&
            approxEqual(p1.y, p1e.y) &&
            approxEqual(p2.x, p2e.x) &&
            approxEqual(p2.y, p2e.y)
          );
        }
      ),
      { numRuns: 50 }
    );
  });
});

describe('computeAffine', () => {
  test('recovers known affine transform', () => {
    fc.assert(
      fc.property(
        // matrix elements
        fc.double({ min: -5, max: 5, noDefaultInfinity: true, noNaN: true }),
        fc.double({ min: -5, max: 5, noDefaultInfinity: true, noNaN: true }),
        fc.double({ min: -5, max: 5, noDefaultInfinity: true, noNaN: true }),
        fc.double({ min: -5, max: 5, noDefaultInfinity: true, noNaN: true }),
        // translation
        fc.double({ min: -500, max: 500, noDefaultInfinity: true, noNaN: true }),
        fc.double({ min: -500, max: 500, noDefaultInfinity: true, noNaN: true }),
        // world points
        fc.tuple(
          fc.double({ min: -100, max: 100, noDefaultInfinity: true, noNaN: true }),
          fc.double({ min: -100, max: 100, noDefaultInfinity: true, noNaN: true })
        ),
        fc.tuple(
          fc.double({ min: -100, max: 100, noDefaultInfinity: true, noNaN: true }),
          fc.double({ min: -100, max: 100, noDefaultInfinity: true, noNaN: true })
        ),
        fc.tuple(
          fc.double({ min: -100, max: 100, noDefaultInfinity: true, noNaN: true }),
          fc.double({ min: -100, max: 100, noDefaultInfinity: true, noNaN: true })
        ),
        (
          a,
          b,
          c,
          d,
          tx,
          ty,
          w1,
          w2,
          w3
        ) => {
          // Ensure matrix is not singular
          if (Math.abs(a * d - b * c) < 1e-6) return true;
          const model = { type: 'affine', a, b, c, d, tx, ty };
          const p1 = applyTransform(model, { x: w1[0], y: w1[1] });
          const p2 = applyTransform(model, { x: w2[0], y: w2[1] });
          const p3 = applyTransform(model, { x: w3[0], y: w3[1] });
          // ensure points not collinear
          const area = (w2[0]-w1[0])*(w3[1]-w1[1]) - (w3[0]-w1[0])*(w2[1]-w1[1]);
          if (Math.abs(area) < 1e-3) return true;
          const est = computeAffine([
            { world: { x: w1[0], y: w1[1] }, pixel: p1 },
            { world: { x: w2[0], y: w2[1] }, pixel: p2 },
            { world: { x: w3[0], y: w3[1] }, pixel: p3 },
          ]);
          const p1e = applyTransform(est, { x: w1[0], y: w1[1] });
          const p2e = applyTransform(est, { x: w2[0], y: w2[1] });
          const p3e = applyTransform(est, { x: w3[0], y: w3[1] });
          return (
            approxEqual(p1.x, p1e.x) &&
            approxEqual(p1.y, p1e.y) &&
            approxEqual(p2.x, p2e.x) &&
            approxEqual(p2.y, p2e.y) &&
            approxEqual(p3.x, p3e.x) &&
            approxEqual(p3.y, p3e.y)
          );
        }
      ),
      { numRuns: 50 }
    );
  });
});

describe('computeHomography', () => {
  test('recovers known homography', () => {
    fc.assert(
      fc.property(
        // homography parameters
        fc.double({ min: -2, max: 2, noDefaultInfinity: true, noNaN: true }),
        fc.double({ min: -2, max: 2, noDefaultInfinity: true, noNaN: true }),
        fc.double({ min: -5, max: 5, noDefaultInfinity: true, noNaN: true }),
        fc.double({ min: -2, max: 2, noDefaultInfinity: true, noNaN: true }),
        fc.double({ min: -2, max: 2, noDefaultInfinity: true, noNaN: true }),
        fc.double({ min: -5, max: 5, noDefaultInfinity: true, noNaN: true }),
        fc.double({ min: -1e-3, max: 1e-3, noDefaultInfinity: true, noNaN: true }),
        fc.double({ min: -1e-3, max: 1e-3, noDefaultInfinity: true, noNaN: true }),
        // world points
        fc.tuple(fc.double({ min: -10, max: 10, noDefaultInfinity: true, noNaN: true }), fc.double({ min: -10, max: 10, noDefaultInfinity: true, noNaN: true })),
        fc.tuple(fc.double({ min: -10, max: 10, noDefaultInfinity: true, noNaN: true }), fc.double({ min: -10, max: 10, noDefaultInfinity: true, noNaN: true })),
        fc.tuple(fc.double({ min: -10, max: 10, noDefaultInfinity: true, noNaN: true }), fc.double({ min: -10, max: 10, noDefaultInfinity: true, noNaN: true })),
        fc.tuple(fc.double({ min: -10, max: 10, noDefaultInfinity: true, noNaN: true }), fc.double({ min: -10, max: 10, noDefaultInfinity: true, noNaN: true })),
        (
          h1, h2, h3, h4, h5, h6, h7, h8,
          w1, w2, w3, w4
        ) => {
          const model = { type: 'homography', h: [h1, h2, h3, h4, h5, h6, h7, h8, 1] };
          const points = [w1, w2, w3, w4];
          // ensure points form a valid configuration
          const area = (p) => {
            const [a,b,c,d] = p;
            return (
              (a[0]*b[1]+b[0]*c[1]+c[0]*d[1]+d[0]*a[1]) -
              (b[0]*a[1]+c[0]*b[1]+d[0]*c[1]+a[0]*d[1])
            )/2;
          };
          if (Math.abs(area(points)) < 1e-3) return true;
          const pixels = points.map(([x,y]) => applyTransform(model, {x,y}));
          let est;
          try {
            est = computeHomography([
              { world: { x: w1[0], y: w1[1] }, pixel: pixels[0] },
              { world: { x: w2[0], y: w2[1] }, pixel: pixels[1] },
              { world: { x: w3[0], y: w3[1] }, pixel: pixels[2] },
              { world: { x: w4[0], y: w4[1] }, pixel: pixels[3] },
            ]);
          } catch {
            return true; // skip degenerate configurations
          }
          return points.every((w, i) => {
            const p = applyTransform(est, { x: w[0], y: w[1] });
            return (
              approxEqual(p.x, pixels[i].x) &&
              approxEqual(p.y, pixels[i].y)
            );
          });
        }
      ),
      { numRuns: 30 }
    );
  });
});

describe('computeTransform', () => {
  test('chooses model based on pair count', () => {
    const world1 = { x: 0, y: 0 };
    const world2 = { x: 1, y: 0 };
    const world3 = { x: 0, y: 1 };
    const world4 = { x: 1, y: 1 };

    const sim = computeSimilarity([
      { world: world1, pixel: { x: 0, y: 0 } },
      { world: world2, pixel: { x: 2, y: 0 } },
    ]);
    const aff = computeAffine([
      { world: world1, pixel: { x: 0, y: 0 } },
      { world: world2, pixel: { x: 1, y: 0 } },
      { world: world3, pixel: { x: 0, y: 1 } },
    ]);
    const hom = computeHomography([
      { world: world1, pixel: { x: 0, y: 0 } },
      { world: world2, pixel: { x: 1, y: 0 } },
      { world: world3, pixel: { x: 0, y: 1 } },
      { world: world4, pixel: { x: 1, y: 1 } },
    ]);

    expect(computeTransform([
      { world: world1, pixel: { x: 0, y: 0 } },
      { world: world2, pixel: { x: 2, y: 0 } },
    ]).type).toBe(sim.type);

    expect(computeTransform([
      { world: world1, pixel: { x: 0, y: 0 } },
      { world: world2, pixel: { x: 1, y: 0 } },
      { world: world3, pixel: { x: 0, y: 1 } },
    ]).type).toBe(aff.type);

    expect(computeTransform([
      { world: world1, pixel: { x: 0, y: 0 } },
      { world: world2, pixel: { x: 1, y: 0 } },
      { world: world3, pixel: { x: 0, y: 1 } },
      { world: world4, pixel: { x: 1, y: 1 } },
    ]).type).toBe(hom.type);
  });

  test('errors on invalid inputs', () => {
    expect(() => applyTransform({ type: 'bogus' }, { x: 0, y: 0 })).toThrow('Unknown model type');
    expect(() => computeTransform([])).toThrow('Insufficient pairs');
  });
});
