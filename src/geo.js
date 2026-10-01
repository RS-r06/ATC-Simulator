// Geometry and small helpers.
//
// Positions are in nautical miles (nm) from the airport: x grows east, y grows
// north. Headings are in degrees clockwise from north, as on a compass.

export function normalizeHeading(h) {
  return ((h % 360) + 360) % 360;
}

// Shortest signed turn from one heading to another, in -180..180.
// Positive means turn right.
export function headingDiff(from, to) {
  let d = normalizeHeading(to) - normalizeHeading(from);
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

export function bearing(from, to) {
  const deg = (Math.atan2(to.x - from.x, to.y - from.y) * 180) / Math.PI;
  return normalizeHeading(deg);
}

export function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function clamp(value, lo, hi) {
  return Math.min(hi, Math.max(lo, value));
}

// Compass heading for display: 0 shows as 360, always three digits.
export function formatHeading(h) {
  const whole = Math.round(normalizeHeading(h)) || 360;
  return String(whole).padStart(3, "0");
}

// Small seeded random number generator (mulberry32), so a game with the same
// seed plays out the same way. Tests rely on this.
export function seededRandom(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
