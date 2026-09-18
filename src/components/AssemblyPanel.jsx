// Assembly tree, exploded view, interference check and bill of materials.
import React, { useEffect, useMemo, useState } from 'react';
import { useStore } from '../lib/store.js';
import { assemblyTree, meshesUnder, assemblyMass, interferenceReport, assemblyBOM, bomToCsv, ROOT } from '../lib/assembly.js';

function Node({ id, tree, depth, onSelect, selectedAsm, meshes, byId }) {
  const [open, setOpen] = useState(true);
  const n = tree.nodes[id];
  const selectMesh = useStore((s) => s.selectMesh);
  const selectedMeshId = useStore((s) => s.selectedMeshId);
  const renameAssembly = useStore((s) => s.renameAssembly);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(n.name);
  const count = meshesUnder(id, tree).length;
  return (
    <div className="asm-node">
      <div className={'asm-row' + (selectedAsm === id ? ' on' : '')} style={{ paddingLeft: 6 + depth * 14 }}>
        <button className="asm-tog" onClick={() => setOpen((v) => !v)}>{n.children.length || n.meshes.length ? (open ? '▾' : '▸') : '·'}</button>
        {editing ? (
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onBlur={() => { renameAssembly(id, name); setEditing(false); }}
            onKeyDown={(e) => { if (e.key === 'Enter') { renameAssembly(id, name); setEditing(false); } }} style={{ flex: 1 }} />
        ) : (
          <button className="asm-name" onClick={() => onSelect(id)} onDoubleClick={() => id !== ROOT && setEditing(true)} title={id === ROOT ? 'Top level' : 'Double-click to rename'}>
            {id === ROOT ? '⌂ ' : '▣ '}{n.name}
          </button>
        )}
        <span className="muted small">{count}</span>
      </div>
      {open && (
        <>
          {n.children.map((c) => <Node key={c} id={c} tree={tree} depth={depth + 1} onSelect={onSelect} selectedAsm={selectedAsm} meshes={meshes} byId={byId} />)}
          {n.meshes.map((mid) => {
            const m = byId[mid]; if (!m) return null;
            return (
              <div key={mid} className={'asm-row asm-leaf' + (selectedMeshId === mid ? ' on' : '')} style={{ paddingLeft: 24 + depth * 14 }}>
                <button className="asm-name" onClick={() => selectMesh(mid)}>{m.kind === 'part' ? '◈' : '▪'} {m.label || mid}</button>
                <span className="muted small">{m.kind}</span>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}

export default function AssemblyPanel() {
  const meshes = useStore((s) => s.meshes);
  const assemblies = useStore((s) => s.assemblies);
  const selectedMeshId = useStore((s) => s.selectedMeshId);
  const selectedMeshIds = useStore((s) => s.selectedMeshIds);
  const createAssembly = useStore((s) => s.createAssembly);
  const dissolveAssembly = useStore((s) => s.dissolveAssembly);
  const moveMeshToAssembly = useStore((s) => s.moveMeshToAssembly);
  const moveAssembly = useStore((s) => s.moveAssembly);
  const explode = useStore((s) => s.explode);
  const setExplode = useStore((s) => s.setExplode);

  const tree = useMemo(() => assemblyTree(), [meshes, assemblies]);
  const byId = useMemo(() => Object.fromEntries(meshes.map((m) => [m.id, m])), [meshes]);
  const [selAsm, setSelAsm] = useState(ROOT);
  const [mass, setMass] = useState(null);
  const [interf, setInterf] = useState(null);
  const [bom, setBom] = useState(null);
  const [busy, setBusy] = useState(false);
  const [clearance, setClearance] = useState(0.5);
  const selIds = selectedMeshIds?.length ? selectedMeshIds : selectedMeshId ? [selectedMeshId] : [];
  const asmList = Object.values(assemblies);

  useEffect(() => { let live = true; assemblyMass(selAsm).then((r) => live && setMass(r)); return () => { live = false; }; }, [selAsm, meshes, assemblies]);

  async function checkInterference() {
    setBusy(true); setInterf(null);
    try { setInterf(await interferenceReport({ clearanceMm: clearance, assemblyId: selAsm })); } finally { setBusy(false); }
  }
  async function buildBom() {
    setBusy(true); setBom(null);
    try { setBom(await assemblyBOM(selAsm)); } finally { setBusy(false); }
  }
  async function exportCsv() {
    const b = bom || (await assemblyBOM(selAsm));
    await window.forge.saveFile({ defaultName: `${tree.nodes[selAsm]?.name || 'assembly'}-bom.csv`, content: bomToCsv(b), filters: [{ name: 'CSV', extensions: ['csv'] }] });
  }

  return (
    <div className="asm">
      <p className="muted small" style={{ margin: 0 }}>{meshes.length} bodies · {asmList.length} subassembl{asmList.length === 1 ? 'y' : 'ies'} · double-click a name to rename</p>
      <div className="asm-tree">
        <Node id={ROOT} tree={tree} depth={0} onSelect={setSelAsm} selectedAsm={selAsm} meshes={meshes} byId={byId} />
      </div>

      <div className="row" style={{ flexWrap: 'wrap', gap: 4 }}>
        <button className="btn" disabled={!selIds.length} title="Put the selected bodies into a new subassembly under the selected node"
          onClick={() => { const id = createAssembly(`Sub ${asmList.length + 1}`, selIds, selAsm === ROOT ? null : selAsm); setSelAsm(id); }}>
          + Subassembly from selection
        </button>
        {selAsm !== ROOT && (
          <>
            <button className="btn ghost" onClick={() => { dissolveAssembly(selAsm); setSelAsm(ROOT); }} title="Members move up one level; nothing is deleted">Dissolve</button>
            <select value={assemblies[selAsm]?.parentId || ''} onChange={(e) => moveAssembly(selAsm, e.target.value || null)} title="Move this subassembly under…">
              <option value="">↑ top level</option>
              {asmList.filter((a) => a.id !== selAsm).map((a) => <option key={a.id} value={a.id}>under {a.name}</option>)}
            </select>
          </>
        )}
        {selIds.length > 0 && asmList.length > 0 && (
          <select value="" onChange={(e) => { for (const id of selIds) moveMeshToAssembly(id, e.target.value || null); }} title="Move the selected bodies into…">
            <option value="">move selection to…</option>
            <option value="">↑ top level</option>
            {asmList.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        )}
      </div>

      {mass && (
        <p className="muted small">
          <b>{tree.nodes[selAsm]?.name}</b>: {mass.components} bodies · {mass.mass_g.toFixed(1)} g · COM {mass.centreOfMass_mm.map((v) => v.toFixed(0)).join(', ')} mm
          <br />{mass.basis}
        </p>
      )}

      <label className="lbl">Exploded view — {explode.toFixed(2)}× <span className="muted">(display only; exports assembled)</span></label>
      <input type="range" min="0" max="3" step="0.05" value={explode} onChange={(e) => setExplode(e.target.value)} />

      <div className="row" style={{ marginTop: 4, alignItems: 'center' }}>
        <button className="btn" disabled={busy || meshes.length < 2} onClick={checkInterference}>{busy ? '…' : 'Check interference'}</button>
        <input type="number" step="0.1" min="0" value={clearance} onChange={(e) => setClearance(parseFloat(e.target.value) || 0)} style={{ width: 64 }} title="Minimum clearance between bodies" />
        <span className="muted small" style={{ whiteSpace: 'nowrap' }}>mm gap</span>
      </div>
      {interf && (
        <div className={'asm-report ' + (interf.ok ? 'ok' : 'err')}>
          <b>{interf.ok ? 'No interference' : `${interf.overlaps.length} interference${interf.overlaps.length === 1 ? '' : 's'}`}</b>
          {interf.nearMisses.length > 0 && <span> · {interf.nearMisses.length} under clearance</span>}
          {interf.overlaps.map((o, i) => <p key={'o' + i} className="asm-issue">✕ {o.msg} <span className="ms-badge kernel">{o.method === 'exact' ? 'exact' : 'box'}</span></p>)}
          {interf.nearMisses.map((o, i) => <p key={'n' + i} className="asm-warn">△ {o.msg}</p>)}
          <p className="muted small">{interf.basis}</p>
        </div>
      )}

      <div className="row" style={{ marginTop: 4 }}>
        <button className="btn" disabled={busy || !meshes.length} onClick={buildBom}>{busy ? '…' : 'Bill of materials'}</button>
        <button className="btn ghost" disabled={busy || !meshes.length} onClick={exportCsv}>⤓ CSV</button>
      </div>
      {bom && (
        <div className="asm-bom">
          <table className="ms-table"><tbody>
            {bom.rows.map((r) => (
              <tr key={r.key}>
                <td className="ms-v">{r.qty}×</td>
                <td>{r.description}{r.partNumber && <span className="muted small"> {r.partNumber}</span>}<br /><span className="muted small">{r.material}</span></td>
                <td className="ms-v">{r.lineMass_g != null ? `${r.lineMass_g.toFixed(1)} g` : '—'}</td>
                <td className="ms-v">{r.linePrice != null ? `$${r.linePrice.toFixed(2)}` : '—'}</td>
              </tr>
            ))}
            <tr><td /><td><b>Total · {bom.items} items</b></td><td className="ms-v"><b>{bom.totalMass_g.toFixed(1)} g</b></td><td className="ms-v"><b>${bom.totalPrice.toFixed(2)}</b></td></tr>
          </tbody></table>
          <p className="muted small">{bom.note}</p>
        </div>
      )}
    </div>
  );
}
