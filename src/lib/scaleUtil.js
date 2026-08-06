// Mesh `scale` can be a number (uniform) or [x, y, z] (stretched — e.g. a box
// scaled into a slab). These helpers normalize between the two forms.
// `?? 1` only caught null/undefined — NaN, Infinity and non-numeric strings went
// straight through and became the mesh's three.js scale, which silently makes the
// object vanish (NaN matrix) or explode. Coerce anything non-finite back to 1.
// null/undefined → 1 (the original `?? 1` behaviour), any non-finite → 1,
// everything else through unchanged (0 stays 0 — collapsing a mesh is legal).
const num = (v) => {
  if (v == null) return 1;
  const n = Number(v);
  return Number.isFinite(n) ? n : 1;
};
export const scaleArr = (s) => (Array.isArray(s) ? [num(s[0]), num(s[1]), num(s[2])] : [num(s), num(s), num(s)]);

// Collapse an [x,y,z] back to a plain number when it's (almost) uniform.
export function packScale(x, y, z) {
  const eq = (a, b) => Math.abs(a - b) < 1e-4;
  return eq(x, y) && eq(y, z) ? x : [x, y, z];
}

// A single representative size (for physics/heuristics that want one number).
export const avgScale = (s) => {
  const [x, y, z] = scaleArr(s);
  return (x + y + z) / 3;
};
