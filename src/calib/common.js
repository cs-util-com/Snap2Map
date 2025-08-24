/**
 * Small shared helpers for calibration code.
 */
export function projectPoint(point, H) {
  const p = [point.x, point.y, 1];
  const p_prime = math.multiply(H, p).toArray();
  return { x: p_prime[0] / p_prime[2], y: p_prime[1] / p_prime[2] };
}
