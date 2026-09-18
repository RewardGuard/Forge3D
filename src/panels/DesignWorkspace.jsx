import React, { useState } from 'react';
import ViewportToolbar from '../components/ViewportToolbar.jsx';
import CopilotPanel from '../components/CopilotPanel.jsx';
import AssemblyPanel from '../components/AssemblyPanel.jsx';
import ConstraintPanel from '../components/ConstraintPanel.jsx';
import Viewport3D from '../components/Viewport3D.jsx';
import MeshyPanel from '../components/MeshyPanel.jsx';
import ThingiversePanel from '../components/ThingiversePanel.jsx';
import AiDesignPanel from '../components/AiDesignPanel.jsx';
import Inspector from '../components/Inspector.jsx';
import PrimitivesPanel from '../components/PrimitivesPanel.jsx';
import SideSection from '../components/SideSection.jsx';
import { useStore } from '../lib/store.js';
import { exportSceneToGltf, exportSceneToGlb } from '../lib/exportScene.js';

const SOURCE_LABEL = { generate: 'AI mesh', claude: 'Claude', orchestra: 'Orchestra', thingiverse: 'Thingiverse' };

export default function DesignWorkspace() {
  const [source, setSource] = useState('generate'); // generate | thingiverse
  const [exporting, setExporting] = useState(false);
  const projectCircuitTo3D = useStore((s) => s.projectCircuitTo3D);
  const nodeCount = useStore((s) => s.nodes.length);
  const meshes = useStore((s) => s.meshes);
  const constraintCount = useStore((s) => s.constraints.length);
  const assemblyCount = useStore((s) => Object.keys(s.assemblies || {}).length);
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
      <aside className="sidebar left">
        {/* One scrolling column. Every tool is a foldable section so the
            sidebar never grows past what the user can reach. */}
        <div className="side-scroll">
          <SideSection title="Add geometry" summary={`${meshes.length} ${meshes.length === 1 ? 'body' : 'bodies'}`}>
            <PrimitivesPanel />
          </SideSection>

          <SideSection title="Generate" summary={SOURCE_LABEL[source]}>
            <div className="seg grid2">
              <button className={'seg-btn' + (source === 'generate' ? ' on' : '')} onClick={() => setSource('generate')}>AI mesh</button>
              <button className={'seg-btn' + (source === 'claude' ? ' on' : '')} onClick={() => setSource('claude')}>Claude</button>
              <button className={'seg-btn' + (source === 'orchestra' ? ' on' : '')} onClick={() => setSource('orchestra')}>✦ Orchestra</button>
              <button className={'seg-btn' + (source === 'thingiverse' ? ' on' : '')} onClick={() => setSource('thingiverse')}>Thingiverse</button>
            </div>
            {source === 'generate' && <MeshyPanel />}
            {source === 'claude' && <AiDesignPanel mode="claude" />}
            {source === 'orchestra' && <AiDesignPanel mode="orchestra" />}
            {source === 'thingiverse' && <ThingiversePanel />}
          </SideSection>

          <SideSection title="Copilot" summary="ask for a change">
            <CopilotPanel />
          </SideSection>

          <SideSection title="Assembly" summary={assemblyCount ? `${assemblyCount} sub` : 'flat'} defaultOpen={false}>
            <AssemblyPanel />
          </SideSection>

          <SideSection title="Constraints" summary={constraintCount ? String(constraintCount) : 'none'} defaultOpen={false}>
            <ConstraintPanel />
          </SideSection>
        </div>
      </aside>

      <section className="viewport">
        <Viewport3D />
        <ViewportToolbar />
        <div className="viewport-overlay bottom row">
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
