import {
  fitSimilarity,
  fitSimilarityFixedScale,
  fitSimilarity1Point,
  fitAffine,
  fitHomography,
  applyTransform,
  applyInverseTransform,
  jacobianForTransform,
  averageScaleFromJacobian,
  invertSimilarity,
  invertAffine,
  invertHomography,
} from './transformations.js';

describe('transformations', () => {
  test('fitSimilarity recovers known transform', () => {
    const scale = 5;
    const theta = Math.PI / 6;
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);
    const translation = { x: 100, y: -40 };
    const pairs = [
      { pixel: { x: 0, y: 0 }, enu: { x: translation.x, y: translation.y } },
      { pixel: { x: 10, y: 0 }, enu: { x: translation.x + scale * (cos * 10), y: translation.y + scale * (sin * 10) } },
      { pixel: { x: 0, y: 10 }, enu: { x: translation.x + scale * (-sin * 10), y: translation.y + scale * (cos * 10) } },
    ];
    const transform = fitSimilarity(pairs);
    expect(transform.scale).toBeCloseTo(scale);
    expect(transform.translation.x).toBeCloseTo(translation.x);
    expect(transform.translation.y).toBeCloseTo(translation.y);
  });

  test('fitAffine solves general linear mapping', () => {
    const matrix = [
      [2, 0.5, 10],
      [-0.3, 1.5, -2],
    ];
    const pairs = [
      { pixel: { x: 0, y: 0 }, enu: { x: 10, y: -2 } },
      { pixel: { x: 4, y: 1 }, enu: { x: 2 * 4 + 0.5 * 1 + 10, y: -0.3 * 4 + 1.5 * 1 - 2 } },
      { pixel: { x: -3, y: 2 }, enu: { x: 2 * -3 + 0.5 * 2 + 10, y: -0.3 * -3 + 1.5 * 2 - 2 } },
    ];
    const transform = fitAffine(pairs);
    expect(transform.matrix[0][0]).toBeCloseTo(matrix[0][0]);
    expect(transform.matrix[0][1]).toBeCloseTo(matrix[0][1]);
    expect(transform.matrix[1][0]).toBeCloseTo(matrix[1][0]);
    expect(transform.matrix[1][1]).toBeCloseTo(matrix[1][1]);
  });

  test('fitHomography maps square to quadrilateral', () => {
    const pairs = [
      { pixel: { x: 0, y: 0 }, enu: { x: 0, y: 0 } },
      { pixel: { x: 1, y: 0 }, enu: { x: 2, y: 0 } },
      { pixel: { x: 1, y: 1 }, enu: { x: 2, y: 1 } },
      { pixel: { x: 0, y: 1 }, enu: { x: 0, y: 1 } },
    ];
    const transform = fitHomography(pairs);
    const projected = applyTransform(transform, { x: 0.5, y: 0.5 });
    expect(projected.x).toBeCloseTo(1);
    expect(projected.y).toBeCloseTo(0.5);
  });

  test('applyInverseTransform is inverse of applyTransform', () => {
    const affine = {
      type: 'affine',
      matrix: [
        [1.5, 0.2, -4],
        [0.1, 0.9, 6],
      ],
    };
    const point = { x: 3, y: -2 };
    const forward = applyTransform(affine, point);
    const inverse = applyInverseTransform(affine, forward);
    expect(inverse.x).toBeCloseTo(point.x);
    expect(inverse.y).toBeCloseTo(point.y);
  });

  test('jacobianForTransform returns average scale', () => {
    const similarity = {
      type: 'similarity',
      scale: 10,
      cos: 1,
      sin: 0,
      translation: { x: 0, y: 0 },
    };
    const jacobian = jacobianForTransform(similarity, { x: 0, y: 0 });
    const scale = averageScaleFromJacobian(jacobian);
    expect(scale).toBeCloseTo(10);
  });

  test('invertHomography produces identity when composed', () => {
    const homography = {
      type: 'homography',
      matrix: [
        [2, 0.5, 1],
        [0.4, 3, -2],
        [0.002, 0.001, 1],
      ],
    };
    const inverse = invertHomography(homography);
    const point = { x: 5, y: -3 };
    const mapped = applyTransform(homography, point);
    const roundTrip = applyTransform(inverse, mapped);
    expect(roundTrip.x).toBeCloseTo(point.x, 5);
    expect(roundTrip.y).toBeCloseTo(point.y, 5);
  });

  test('fitSimilarity1Point creates valid transform from single point', () => {
    const pair = { pixel: { x: 10, y: 20 }, enu: { x: 100, y: 200 } };
    const scale = 2.5;
    const rotation = Math.PI / 4; // 45 degrees
    const transform = fitSimilarity1Point(pair, scale, rotation);

    expect(transform.type).toBe('similarity');
    expect(transform.scale).toBe(scale);
    expect(transform.rotation).toBe(rotation);

    const projected = applyTransform(transform, pair.pixel);
    expect(projected.x).toBeCloseTo(pair.enu.x);
    expect(projected.y).toBeCloseTo(pair.enu.y);
  });

  test('fitSimilarity1Point returns null for invalid inputs', () => {
    expect(fitSimilarity1Point(null, 1, 0)).toBeNull();
    expect(fitSimilarity1Point({ pixel: { x: 0, y: 0 } }, 1, 0)).toBeNull();
    expect(fitSimilarity1Point({ pixel: { x: 0, y: 0 }, enu: { x: 0, y: 0 } }, -1, 0)).toBeNull();
    expect(fitSimilarity1Point({ pixel: { x: 0, y: 0 }, enu: { x: 0, y: 0 } }, 0, 0)).toBeNull();
    expect(fitSimilarity1Point({ pixel: { x: 0, y: 0 }, enu: { x: 0, y: 0 } }, NaN, 0)).toBeNull();
  });

  test('invertSimilarity and invertAffine expose consistent parameters', () => {
    const similarity = {
      type: 'similarity',
      scale: 2,
      rotation: Math.PI / 4,
      cos: Math.cos(Math.PI / 4),
      sin: Math.sin(Math.PI / 4),
      translation: { x: 5, y: -3 },
    };
    const similarityInverse = invertSimilarity(similarity);
    const roundTrip = applyTransform(similarityInverse, applyTransform(similarity, { x: 3, y: 2 }));
    expect(roundTrip.x).toBeCloseTo(3);
    expect(roundTrip.y).toBeCloseTo(2);

    const affine = {
      type: 'affine',
      matrix: [
        [1.2, -0.4, 2],
        [0.3, 0.8, -1],
      ],
    };
    const affineInverse = invertAffine(affine);
    const point = { x: -2, y: 7 };
    const restored = applyTransform(affineInverse, applyTransform(affine, point));
    expect(restored.x).toBeCloseTo(point.x);
    expect(restored.y).toBeCloseTo(point.y);
  });

  test('fit functions handle degenerate and invalid input', () => {
    expect(fitSimilarity([{ pixel: { x: 0, y: 0 }, enu: { x: 0, y: 0 } }])).toBeNull();
    const degeneratePairs = [
      { pixel: { x: 0, y: 0 }, enu: { x: 0, y: 0 } },
      { pixel: { x: 0, y: 0 }, enu: { x: 10, y: 10 } },
    ];
    expect(fitSimilarity(degeneratePairs)).toBeNull();
    expect(fitAffine(degeneratePairs)).toBeNull();
    expect(fitHomography([{ pixel: { x: 0, y: 0 }, enu: { x: 0, y: 0 } }])).toBeNull();
    const zeroScalePairs = [
      { pixel: { x: 0, y: 0 }, enu: { x: 0, y: 0 } },
      { pixel: { x: 5, y: 0 }, enu: { x: 0, y: 0 } },
    ];
    expect(fitSimilarity(zeroScalePairs)).toBeNull();
    const zeroWeightsPairs = [
      { pixel: { x: 0, y: 0 }, enu: { x: 0, y: 0 } },
      { pixel: { x: 1, y: 1 }, enu: { x: 1, y: 1 } },
    ];
    expect(fitSimilarity(zeroWeightsPairs, [0, 0])).toBeNull();
    const weightedPairs = [
      { pixel: { x: 0, y: 0 }, enu: { x: 0, y: 0 } },
      { pixel: { x: 1, y: 0 }, enu: { x: 1, y: 0 } },
      { pixel: { x: 0, y: 1 }, enu: { x: 0, y: 1 } },
    ];
    expect(() => fitAffine(weightedPairs, [1])).toThrow('Weight length mismatch');
  });

  test('applyTransform handles unsupported cases', () => {
    const homography = {
      type: 'homography',
      matrix: [
        [1, 0, 0],
        [0, 1, 0],
        [1, 0, -1],
      ],
    };
    expect(applyTransform(homography, { x: 1, y: 0 })).toBeNull();
    expect(applyTransform(null, { x: 0, y: 0 })).toBeNull();
    expect(() => applyTransform({ type: 'unknown' }, { x: 0, y: 0 })).toThrow('Unsupported transform type');
    expect(applyInverseTransform(null, { x: 0, y: 0 })).toBeNull();
    expect(() => applyInverseTransform({ type: 'unknown' }, { x: 0, y: 0 })).toThrow('Unsupported transform type');
    expect(invertAffine({ type: 'affine', matrix: [[1, 2, 0], [2, 4, 0]] })).toBeNull();
    expect(invertHomography({ type: 'homography', matrix: [[1, 1, 1], [1, 1, 1], [1, 1, 1]] })).toBeNull();
    expect(jacobianForTransform({ type: 'unsupported' }, { x: 0, y: 0 })).toBeNull();
    expect(averageScaleFromJacobian(null)).toBeNull();
  });

  test('jacobianForTransform covers affine and homography', () => {
    const affine = {
      type: 'affine',
      matrix: [
        [2, 1, 5],
        [0.5, 3, -2],
      ],
    };
    const jAffine = jacobianForTransform(affine, { x: 10, y: 20 });
    expect(jAffine).toEqual([
      [2, 1],
      [0.5, 3],
    ]);

    const homography = {
      type: 'homography',
      matrix: [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ],
    };
    const jHomo = jacobianForTransform(homography, { x: 5, y: 5 });
    expect(jHomo[0][0]).toBeCloseTo(1);
    expect(jHomo[1][1]).toBeCloseTo(1);

    const singularHomo = {
      type: 'homography',
      matrix: [
        [1, 0, 0],
        [0, 1, 0],
        [1, 0, -10],
      ],
    };
    expect(jacobianForTransform(singularHomo, { x: 10, y: 0 })).toBeNull();
  });

  test('fitHomography handles degenerate cases', () => {
    // 4 points on a line
    const degeneratePairs = [
      { pixel: { x: 0, y: 0 }, enu: { x: 0, y: 0 } },
      { pixel: { x: 1, y: 0 }, enu: { x: 1, y: 0 } },
      { pixel: { x: 2, y: 0 }, enu: { x: 2, y: 0 } },
      { pixel: { x: 3, y: 0 }, enu: { x: 3, y: 0 } },
    ];
    expect(fitHomography(degeneratePairs)).toBeNull();
  });

  test('applyInverseTransform covers all types', () => {
    const similarity = {
      type: 'similarity',
      scale: 2,
      cos: 1,
      sin: 0,
      rotation: 0,
      translation: { x: 10, y: 20 },
    };
    expect(applyInverseTransform(similarity, { x: 20, y: 30 })).toEqual({ x: 5, y: 5 });

    const homography = {
      type: 'homography',
      matrix: [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ],
    };
    expect(applyInverseTransform(homography, { x: 5, y: 5 })).toEqual({ x: 5, y: 5 });
  });

  describe('fitSimilarityFixedScale', () => {
    test('preserves exact fixed scale with known transform', () => {
      const fixedScale = 5;
      const theta = Math.PI / 6;
      const cos = Math.cos(theta);
      const sin = Math.sin(theta);
      const translation = { x: 100, y: -40 };
      const pairs = [
        { pixel: { x: 0, y: 0 }, enu: { x: translation.x, y: translation.y } },
        { pixel: { x: 10, y: 0 }, enu: { x: translation.x + fixedScale * (cos * 10), y: translation.y + fixedScale * (sin * 10) } },
        { pixel: { x: 0, y: 10 }, enu: { x: translation.x + fixedScale * (-sin * 10), y: translation.y + fixedScale * (cos * 10) } },
      ];
      const transform = fitSimilarityFixedScale(pairs, fixedScale);
      expect(transform.scale).toBe(fixedScale);
      expect(transform.rotation).toBeCloseTo(theta);
      expect(transform.translation.x).toBeCloseTo(translation.x);
      expect(transform.translation.y).toBeCloseTo(translation.y);
    });

    test('uses fixed scale even when data suggests different scale', () => {
      // Data that would naturally fit scale=2, but we force scale=5
      const pairs = [
        { pixel: { x: 0, y: 0 }, enu: { x: 0, y: 0 } },
        { pixel: { x: 10, y: 0 }, enu: { x: 20, y: 0 } },
        { pixel: { x: 0, y: 10 }, enu: { x: 0, y: 20 } },
      ];
      const freeTransform = fitSimilarity(pairs);
      expect(freeTransform.scale).toBeCloseTo(2);

      const fixedTransform = fitSimilarityFixedScale(pairs, 5);
      expect(fixedTransform.scale).toBe(5);
    });

    test('correctly finds rotation when scale is fixed', () => {
      const fixedScale = 3;
      const theta = Math.PI / 4;
      const cos = Math.cos(theta);
      const sin = Math.sin(theta);
      const pairs = [
        { pixel: { x: 0, y: 0 }, enu: { x: 0, y: 0 } },
        { pixel: { x: 10, y: 0 }, enu: { x: fixedScale * (cos * 10), y: fixedScale * (sin * 10) } },
      ];
      const transform = fitSimilarityFixedScale(pairs, fixedScale);
      expect(transform.rotation).toBeCloseTo(theta);
    });

    test('computes correct translation with fixed scale', () => {
      const fixedScale = 2;
      const pairs = [
        { pixel: { x: 5, y: 5 }, enu: { x: 100, y: 200 } },
        { pixel: { x: 15, y: 5 }, enu: { x: 120, y: 200 } },
      ];
      const transform = fitSimilarityFixedScale(pairs, fixedScale);
      expect(transform.scale).toBe(fixedScale);
      const mapped = applyTransform(transform, { x: 5, y: 5 });
      expect(mapped.x).toBeCloseTo(100);
      expect(mapped.y).toBeCloseTo(200);
    });

    test('returns null for insufficient pairs', () => {
      expect(fitSimilarityFixedScale([{ pixel: { x: 0, y: 0 }, enu: { x: 0, y: 0 } }], 5)).toBeNull();
      expect(fitSimilarityFixedScale([], 5)).toBeNull();
    });

    test('returns null for invalid fixed scale', () => {
      const pairs = [
        { pixel: { x: 0, y: 0 }, enu: { x: 0, y: 0 } },
        { pixel: { x: 10, y: 0 }, enu: { x: 20, y: 0 } },
      ];
      expect(fitSimilarityFixedScale(pairs, 0)).toBeNull();
      expect(fitSimilarityFixedScale(pairs, NaN)).toBeNull();
      expect(fitSimilarityFixedScale(pairs, Infinity)).toBeNull();
      expect(fitSimilarityFixedScale(pairs, -1)).toBeNull();
      expect(fitSimilarityFixedScale(pairs, -0.5)).toBeNull();
    });

    test('returns null for zero total weight', () => {
      const pairs = [
        { pixel: { x: 0, y: 0 }, enu: { x: 0, y: 0 } },
        { pixel: { x: 10, y: 0 }, enu: { x: 20, y: 0 } },
      ];
      expect(fitSimilarityFixedScale(pairs, 5, [0, 0])).toBeNull();
    });

    test('respects weights in rotation computation', () => {
      // With 2 pairs, cross/dot contributions are geometrically symmetric,
      // so we use 3 pairs to properly test weighting influence on rotation.
      // p0: anchor at origin
      // p1: suggests rotation 0 (pixel +x maps to enu +x)
      // p2: suggests rotation 90deg (pixel +y maps to enu -x)
      const pairs = [
        { pixel: { x: 0, y: 0 }, enu: { x: 0, y: 0 } },
        { pixel: { x: 10, y: 0 }, enu: { x: 10, y: 0 } },
        { pixel: { x: 0, y: 10 }, enu: { x: -10, y: 0 } },
      ];

      // With equal weights, rotation should be ~45deg
      const uniformTransform = fitSimilarityFixedScale(pairs, 1, [1, 1, 1]);
      expect(uniformTransform.rotation).toBeCloseTo(Math.PI / 4);

      // With more weight on p1 (rotation 0), result should be closer to 0
      const weightedTowardZero = fitSimilarityFixedScale(pairs, 1, [1, 10, 0.1]);
      expect(weightedTowardZero.rotation).toBeLessThan(Math.PI / 4);
      expect(weightedTowardZero.rotation).toBeGreaterThan(0);

      // With more weight on p2 (rotation 90deg), result should be closer to PI/2
      const weightedToward90 = fitSimilarityFixedScale(pairs, 1, [1, 0.1, 10]);
      expect(weightedToward90.rotation).toBeGreaterThan(Math.PI / 4);
      expect(weightedToward90.rotation).toBeLessThan(Math.PI / 2);
    });

    test('2 pairs produce same rotation regardless of weights due to geometric symmetry', () => {
      // This documents the mathematical property discovered during testing:
      // With exactly 2 pairs, the cross/dot contributions are always equal,
      // so weights cannot influence the rotation result.
      const pairs = [
        { pixel: { x: 10, y: 0 }, enu: { x: 10, y: 0 } },
        { pixel: { x: 0, y: 10 }, enu: { x: -10, y: 0 } },
      ];

      const uniform = fitSimilarityFixedScale(pairs, 1, [1, 1]);
      const heavyFirst = fitSimilarityFixedScale(pairs, 1, [100, 1]);
      const heavySecond = fitSimilarityFixedScale(pairs, 1, [1, 100]);

      // All should produce the same rotation due to 2-pair symmetry
      expect(uniform.rotation).toBeCloseTo(heavyFirst.rotation);
      expect(uniform.rotation).toBeCloseTo(heavySecond.rotation);
    });

    test('3 pairs with one zero weight behaves like 2 pairs', () => {
      const pairs = [
        { pixel: { x: 0, y: 0 }, enu: { x: 0, y: 0 } },
        { pixel: { x: 10, y: 0 }, enu: { x: 10, y: 0 } },
        { pixel: { x: 0, y: 10 }, enu: { x: -10, y: 0 } },
      ];

      // With third pair zeroed out, should match 2-pair result
      const twoPairs = [pairs[0], pairs[1]];
      const twoPairResult = fitSimilarityFixedScale(twoPairs, 1, [1, 1]);
      const threePairZeroWeight = fitSimilarityFixedScale(pairs, 1, [1, 1, 0]);

      expect(threePairZeroWeight.rotation).toBeCloseTo(twoPairResult.rotation);
      expect(threePairZeroWeight.translation.x).toBeCloseTo(twoPairResult.translation.x);
      expect(threePairZeroWeight.translation.y).toBeCloseTo(twoPairResult.translation.y);
    });

    test('handles negative rotation correctly', () => {
      // Rotation of -45deg (or equivalently 315deg)
      const fixedScale = 2;
      const theta = -Math.PI / 4;
      const cos = Math.cos(theta);
      const sin = Math.sin(theta);
      const pairs = [
        { pixel: { x: 0, y: 0 }, enu: { x: 0, y: 0 } },
        { pixel: { x: 10, y: 0 }, enu: { x: fixedScale * (cos * 10), y: fixedScale * (sin * 10) } },
        { pixel: { x: 0, y: 10 }, enu: { x: fixedScale * (-sin * 10), y: fixedScale * (cos * 10) } },
      ];

      const transform = fitSimilarityFixedScale(pairs, fixedScale);
      expect(transform.rotation).toBeCloseTo(theta);
      expect(transform.scale).toBe(fixedScale);
    });

    test('returns null for degenerate coincident pixel points', () => {
      // All pixel points on same location - cannot determine rotation
      const pairs = [
        { pixel: { x: 5, y: 5 }, enu: { x: 0, y: 0 } },
        { pixel: { x: 5, y: 5 }, enu: { x: 10, y: 10 } },
      ];

      // When pixel points coincide, rotation is mathematically undefined
      // The function should return null to indicate invalid input
      const transform = fitSimilarityFixedScale(pairs, 1);
      expect(transform).toBeNull();
    });

    test('handles 180 degree rotation', () => {
      const fixedScale = 1;
      const pairs = [
        { pixel: { x: 0, y: 0 }, enu: { x: 0, y: 0 } },
        { pixel: { x: 10, y: 0 }, enu: { x: -10, y: 0 } },
        { pixel: { x: 0, y: 10 }, enu: { x: 0, y: -10 } },
      ];

      const transform = fitSimilarityFixedScale(pairs, fixedScale);
      expect(Math.abs(transform.rotation)).toBeCloseTo(Math.PI);
    });
  });
});
