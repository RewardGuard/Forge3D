import React, { useState } from 'react';
import Viewport3D from '../components/Viewport3D.jsx';
import MeshyPanel from '../components/MeshyPanel.jsx';
import ThingiversePanel from '../components/ThingiversePanel.jsx';
import Inspector from '../components/Inspector.jsx';
import { useStore } from '../lib/store.js';
import { exportSceneToGltf, exportSceneToGlb } from '../lib/exportScene.js';

export default function DesignWorkspace() {
  const [source, setSource] = useState('generate'); // generate | thingiverse
  const [exporting, setExporting] = useState(false);
  const projectCircuitTo3D = useStore((s) => s.projectCircuitTo3D);
  const nodeCount = useStore((s) => s.nodes.length);
  const meshes = useStore((s) => s.meshes);
  const exportQuality = useStore((s) => s.exportQuality);

  async function exportGltf() {
    if (!meshes.length) return;
    setExporting(true);
    try {
      const content = await exportSceneToGltf(meshes, exportQuality);
      await window.forge.saveFile({
        defaultName: `forge3d-scene-${exportQuality}.gltf`,
        content,
        filters: [{ name: 'glTF', extensions: ['gltf'] }],
      });
    } catch (err) {
      console.error('Export failed', err);
    } finally {
      setExporting(false);
    }
  }

  async function exportGlb() {
    if (!meshes.length) return;
    setExporting(true);
    try {
      const content = await exportSceneToGlb(meshes, exportQuality);
      await window.forge.saveFile({
        defaultName: `forge3d-scene-${exportQuality}.glb`,
        content,
        encoding: 'base64',
        filters: [{ name: 'Binary glTF', extensions: ['glb'] }],
      });
    } catch (err) {
      console.error('Export failed', err);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="layout three-col">
      <aside className="sidebar left" style={{ flexDirection: 'column' }}>
        <div className="seg" style={{ padding: '12px 14px 0' }}>
          <button
            className={'seg-btn' + (source === 'generate' ? ' on' : '')}
            onClick={() => setSource('generate')}
          >
            AI Generate
          </button>
          <button
            className={'seg-btn' + (source === 'thingiverse' ? ' on' : '')}
            onClick={() => setSource('thingiverse')}
          >
            Thingiverse
          </button>
        </div>
        {source === 'generate' ? <MeshyPanel /> : <ThingiversePanel />}
      </aside>

      <section className="viewport">
        <Viewport3D />
        <div className="viewport-overlay row">
          <button className="btn" onClick={projectCircuitTo3D} disabled={nodeCount === 0} title="Place circuit parts at real-world scale into the 3D scene">
            ⤢ Import circuit parts ({nodeCount})
          </button>
          <button className="btn" onClick={exportGltf} disabled={!meshes.length || exporting} title={`Export the scene as glTF JSON (${exportQuality} quality — change in Settings)`}>
            {exporting ? 'Exporting…' : `⤓ .gltf (${exportQuality})`}
          </button>
          <button className="btn" onClick={exportGlb} disabled={!meshes.length || exporting} title={`Export the scene as binary glTF (.glb), embedding real model geometry (${exportQuality} quality)`}>
            {exporting ? 'Exporting…' : `⤓ .glb (${exportQuality})`}
          </button>
        </div>
      </section>

      <aside className="sidebar right">
        <Inspector />
      </aside>
    </div>
  );
}
