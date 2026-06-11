// Describe the objects currently in the 3D scene as plain text, so the AI mesh
// generator can relate a new model to them (e.g. "make a shell for this").
// Circuit-projected parts (kind === 'part') are excluded — those are footprints,
// not design objects.
export function buildSceneContext(meshes) {
  const list = (meshes || []).filter((m) => m.kind !== 'part');
  if (!list.length) return '';

  const lines = list.map((m, i) => {
    const pos = (m.position || [0, 0, 0]).map((n) => +(+n).toFixed(2)).join(', ');
    const sc = Array.isArray(m.scale) ? (m.scale[0] + m.scale[1] + m.scale[2]) / 3 : m.scale;
    const size = sc ? `, size ~${(+sc).toFixed(2)} units` : '';
    const type =
      m.kind === 'meshy' ? 'AI-generated model'
      : m.kind === 'stl' ? 'imported STL'
      : `${m.kind} primitive`;
    return `  ${i + 1}. "${m.label || m.kind}" — ${type}${size}, at (${pos})`;
  });

  return `Existing objects in the 3D scene:\n${lines.join('\n')}\n`;
}

// How many design objects (not circuit parts) are in the scene.
export function designObjectCount(meshes) {
  return (meshes || []).filter((m) => m.kind !== 'part').length;
}
