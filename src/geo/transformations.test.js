import {
  fitSimilarity,
  fitSimilarityFixedScale,
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
    expect(() => applyTransform({ type: 'unknown' }, { x: 0, y: 0 })).toThrow('Unsupported transform type');
    expect(applyInverseTransform(null, { x: 0, y: 0 })).toBeNull();
    expect(invertAffine({ type: 'affine', matrix: [[1, 2, 0], [2, 4, 0]] })).toBeNull();
    expect(jacobianForTransform({ type: 'unsupported' }, { x: 0, y: 0 })).toBeNull();
    expect(averageScaleFromJacobian(null)).toBeNull();
  });
});
