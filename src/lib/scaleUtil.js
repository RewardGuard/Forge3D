// Mesh `scale` can be a number (uniform) or [x, y, z] (stretched — e.g. a box
// scaled into a slab). These helpers normalize between the two forms.
export const scaleArr = (s) => (Array.isArray(s) ? s : [s ?? 1, s ?? 1, s ?? 1]);

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
