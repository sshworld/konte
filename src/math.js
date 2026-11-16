// Small pure helpers, importable from Node as well as the browser.
export const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const smooth = (a, b, x) => { const u = clamp((x - a) / (b - a)); return u * u * (3 - 2 * u); };

// Catmull-Rom through keyed vectors: times [t0..tn], values [[x,y,z]..].
export function catmull(times, values, t) {
  const n = times.length;
  if (t <= times[0]) return values[0].slice();
  if (t >= times[n - 1]) return values[n - 1].slice();
  let i = 0;
  while (t > times[i + 1]) i++;
  const u = (t - times[i]) / (times[i + 1] - times[i]);
  const p0 = values[Math.max(0, i - 1)], p1 = values[i], p2 = values[i + 1], p3 = values[Math.min(n - 1, i + 2)];
  return p1.map((_, k) => 0.5 * (2 * p1[k] + (p2[k] - p0[k]) * u + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * u * u + (3 * p1[k] - p0[k] - 3 * p2[k] + p3[k]) * u * u * u));
}
