// One-off generator for morph-compatible sun/moon SVG paths (24x24 viewBox).
// Both shapes are emitted as M + 5 cubic segments + Z so CSS `d` transitions
// can interpolate them. Run: node scripts/gen-sun-moon-paths.mjs
const fmt = (n) => +n.toFixed(3);

// Cubic approximation of a circular arc from angle a0 to a1 (radians, y-down
// screen coords, positive sweep = clockwise on screen) around center c.
function arcSegment(c, r, a0, a1) {
  const da = a1 - a0;
  const k = (4 / 3) * Math.tan(da / 4);
  const p0 = [c[0] + r * Math.cos(a0), c[1] + r * Math.sin(a0)];
  const p3 = [c[0] + r * Math.cos(a1), c[1] + r * Math.sin(a1)];
  const p1 = [p0[0] - k * r * Math.sin(a0), p0[1] + k * r * Math.cos(a0)];
  const p2 = [p3[0] + k * r * Math.sin(a1), p3[1] - k * r * Math.cos(a1)];
  return { p0, p1, p2, p3 };
}

// Split an arc into n cubic segments and emit "C" commands (start point assumed current).
function arcCubics(c, r, a0, a1, n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const s = a0 + ((a1 - a0) * i) / n;
    const e = a0 + ((a1 - a0) * (i + 1)) / n;
    const { p1, p2, p3 } = arcSegment(c, r, s, e);
    out.push(`C${fmt(p1[0])} ${fmt(p1[1])} ${fmt(p2[0])} ${fmt(p2[1])} ${fmt(p3[0])} ${fmt(p3[1])}`);
  }
  return out;
}

// ---- moon: crescent = outer circle minus inner "bite" circle ----
const C1 = [12, 12], R1 = 7;        // outer disc
const C2 = [17, 7],  R2 = 6.5;      // bite circle (offset to upper-right)

const dx = C2[0] - C1[0], dy = C2[1] - C1[1];
const d = Math.hypot(dx, dy);
const a = (d * d + R1 * R1 - R2 * R2) / (2 * d);
const h = Math.sqrt(R1 * R1 - a * a);
const mid = [C1[0] + (a * dx) / d, C1[1] + (a * dy) / d];
const perp = [-dy / d, dx / d];
const cuspA = [mid[0] + h * perp[0], mid[1] + h * perp[1]]; // lower-right cusp
const cuspB = [mid[0] - h * perp[0], mid[1] - h * perp[1]]; // upper-left cusp

const angA1 = Math.atan2(cuspA[1] - C1[1], cuspA[0] - C1[0]); // on outer circle
const angB1 = Math.atan2(cuspB[1] - C1[1], cuspB[0] - C1[0]);
const angA2 = Math.atan2(cuspA[1] - C2[1], cuspA[0] - C2[0]); // on bite circle
const angB2 = Math.atan2(cuspB[1] - C2[1], cuspB[0] - C2[0]);

// Outer arc: cuspA -> cuspB the long way, clockwise on screen (increasing angle).
let outerEnd = angB1;
while (outerEnd <= angA1) outerEnd += Math.PI * 2;
// Inner arc: cuspB -> cuspA along the bite circle, counter-clockwise (decreasing angle)
// so the bite is concave.
let innerEnd = angA2;
while (innerEnd >= angB2) innerEnd -= Math.PI * 2;

const moon = [
  `M${fmt(cuspA[0])} ${fmt(cuspA[1])}`,
  ...arcCubics(C1, R1, angA1, outerEnd, 3),
  ...arcCubics(C2, R2, angB2, innerEnd, 2),
  'Z',
].join('');

// ---- sun disc: plain circle, 5 segments, anchors roughly corresponding ----
// Start at the same angle as cuspA so anchor 0 of both paths lines up.
const RS = 4.4;
const sunStart = angA1;
const sun = [
  `M${fmt(C1[0] + RS * Math.cos(sunStart))} ${fmt(C1[1] + RS * Math.sin(sunStart))}`,
  ...arcCubics(C1, RS, sunStart, sunStart + Math.PI * 2 * (3 / 5), 3),
  ...arcCubics(C1, RS, sunStart + Math.PI * 2 * (3 / 5), sunStart + Math.PI * 2, 2),
  'Z',
].join('');

console.log('SUN :', sun);
console.log('MOON:', moon);
console.log('cusps', cuspA.map(fmt), cuspB.map(fmt), 'outer sweep deg', fmt(((outerEnd - angA1) * 180) / Math.PI), 'inner sweep deg', fmt(((innerEnd - angB2) * 180) / Math.PI));
