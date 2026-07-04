// Measure an STL's native bounding box (binary and ASCII formats). STLs are
// conventionally authored in millimetres, so this gives a part's REAL
// dimensions — which lets the importer place it at true scale in the scene.
// Kept dependency-free so it's unit-testable with plain node.
export function measureSTL(buf) {
  let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  const take = (x, y, z) => {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return;
    if (x < min[0]) min[0] = x; if (x > max[0]) max[0] = x;
    if (y < min[1]) min[1] = y; if (y > max[1]) max[1] = y;
    if (z < min[2]) min[2] = z; if (z > max[2]) max[2] = z;
  };
  // some binary STLs also start with "solid", so confirm ASCII by ruling out a
  // consistent binary triangle count
  const isAscii = buf.length >= 6 && buf.slice(0, 6).toString('ascii').trim().toLowerCase().startsWith('solid')
    && !(buf.length >= 84 && 84 + buf.readUInt32LE(80) * 50 === buf.length);
  if (isAscii) {
    const text = buf.toString('ascii');
    const re = /vertex\s+([-\d.eE+]+)\s+([-\d.eE+]+)\s+([-\d.eE+]+)/g;
    let m;
    while ((m = re.exec(text))) take(parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]));
  } else if (buf.length >= 84) {
    const n = buf.readUInt32LE(80);
    for (let i = 0; i < n; i++) {
      const off = 84 + i * 50 + 12; // skip the normal, read 3 vertices
      if (off + 36 > buf.length) break;
      for (let v = 0; v < 3; v++) take(buf.readFloatLE(off + v * 12), buf.readFloatLE(off + v * 12 + 4), buf.readFloatLE(off + v * 12 + 8));
    }
  }
  if (!Number.isFinite(min[0])) return null;
  const r = (v) => Math.round(v * 100) / 100;
  return { w: r(max[0] - min[0]), h: r(max[1] - min[1]), d: r(max[2] - min[2]) };
}
