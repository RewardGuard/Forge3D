import React, { useState } from 'react';
import { useStore } from '../lib/store.js';
import { DEFAULT_SHAPE_UNIT } from '../data/parts.js';
import { buildSceneContext, designObjectCount } from '../lib/sceneContext.js';

const STYLES = ['realistic', 'sculpture', 'cartoon'];
// Mock generator maps keywords to primitive shapes so mock mode still feels responsive.
function mockKindFromPrompt(prompt) {
  const p = prompt.toLowerCase();
  if (/(ball|sphere|planet|orb|head)/.test(p)) return 'sphere';
  if (/(can|bottle|tube|pipe|cylinder|wheel)/.test(p)) return 'cylinder';
  return 'box';
}

const PROVIDER_LABEL = { mock: 'mock', hf: 'Hugging Face', meshy: 'Meshy' };

// Built-in primitive shapes the user can drop straight into the scene.
const PRIMITIVES = [
  { kind: 'box', label: 'Box', color: '#7c93b8' },
  { kind: 'sphere', label: 'Sphere', color: '#b88a8a' },
  { kind: 'cylinder', label: 'Cylinder', color: '#8ab89a' },
  { kind: 'cone', label: 'Cone', color: '#b8a07c' },
  { kind: 'pyramid', label: 'Pyramid', color: '#a98ab8' },
  { kind: 'torus', label: 'Torus', color: '#8ab8b2' },
  { kind: 'torusknot', label: 'Knot', color: '#b87ca0' },
  { kind: 'capsule', label: 'Capsule', color: '#7cb88f' },
  { kind: 'plane', label: 'Plate', color: '#9aa7bd' },
  { kind: 'tetrahedron', label: 'Tetra', color: '#c0a062' },
  { kind: 'icosahedron', label: 'Icosa', color: '#6294c0' },
];

export default function MeshyPanel() {
  const [prompt, setPrompt] = useState('a low-poly robot');
  const [style, setStyle] = useState('realistic');
  const status = useStore((s) => s.meshyStatus);
  const message = useStore((s) => s.meshyMessage);
  const provider = useStore((s) => s.provider);
  const hasHfToken = useStore((s) => s.hasHfToken);
  const setMeshyStatus = useStore((s) => s.setMeshyStatus);
  const addMesh = useStore((s) => s.addMesh);
  const meshes = useStore((s) => s.meshes);
  const sceneContextOn = useStore((s) => s.sceneContextOn);
  const toggleSceneContext = useStore((s) => s.toggleSceneContext);

  const sceneCount = designObjectCount(meshes);

  // Compose the prompt actually sent to the generator: when scene awareness is
  // on and the scene isn't empty, prepend a description of existing objects.
  function composePrompt() {
    if (!sceneContextOn) return prompt;
    const ctx = buildSceneContext(meshes);
    if (!ctx) return prompt;
    return `${ctx}\nDesign request (relate it to the objects above when relevant): ${prompt}`;
  }

  async function generate() {
    if (!prompt.trim()) return;
    const sendPrompt = composePrompt();
    try {
      if (provider === 'hf') {
        setMeshyStatus('running', 'Generating on Hugging Face (Shap-E)… this can take 30–90s.');
        const { modelUrl } = await window.forge.hf.generate({ prompt: sendPrompt, steps: 32 });
        if (!modelUrl) throw new Error('No model returned.');
        addMesh({ kind: 'meshy', label: prompt.slice(0, 40), color: '#8aa0c8', modelUrl, scale: DEFAULT_SHAPE_UNIT });
        setMeshyStatus('done', 'Mesh generated on Hugging Face and added.');
        return;
      }

      // mock + meshy share the task/poll flow
      setMeshyStatus('running', provider === 'meshy' ? 'Submitting to Meshy…' : 'Generating mock mesh…');
      const { taskId, mock } = await window.forge.meshy.createTextTo3D({ prompt: sendPrompt, artStyle: style });
      let tries = 0;
      while (tries++ < 120) {
        const task = await window.forge.meshy.getTask(taskId);
        if (task.status === 'SUCCEEDED') {
          addMesh({
            kind: mock ? mockKindFromPrompt(prompt) : 'meshy',
            label: prompt.slice(0, 40),
            color: '#8aa0c8',
            modelUrl: task.model_urls?.glb || null,
            scale: DEFAULT_SHAPE_UNIT,
          });
          setMeshyStatus('done', mock ? 'Mock mesh added to scene.' : 'Mesh generated and added.');
          return;
        }
        if (task.status === 'FAILED') {
          setMeshyStatus('error', 'Generation task failed.');
          return;
        }
        setMeshyStatus('running', `Working: ${task.progress ?? 0}%`);
        await new Promise((r) => setTimeout(r, 2500));
      }
      setMeshyStatus('error', 'Timed out waiting for the generator.');
    } catch (err) {
      setMeshyStatus('error', String(err.message || err));
    }
  }

  const needsToken = provider === 'hf' && !hasHfToken;

  return (
    <div className="panel">
      <h3>AI Mesh Generator <span className="badge">{PROVIDER_LABEL[provider]}</span></h3>
      <label className="lbl">Prompt</label>
      <textarea
        rows={3}
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="Describe the object to generate…"
      />

      <label className="switch-row" title="Tell the AI about objects already in the scene, so you can say things like 'make a shell for this'. Turn off for faster prompts.">
        <span className="switch">
          <input type="checkbox" checked={sceneContextOn} onChange={toggleSceneContext} />
          <span className="switch-track"><span className="switch-thumb" /></span>
        </span>
        <span className="switch-label">
          See scene objects
          {sceneContextOn && sceneCount > 0 && <span className="badge">{sceneCount} in view</span>}
        </span>
      </label>
      {sceneContextOn && sceneCount === 0 && (
        <p className="muted small">Scene is empty — add or generate an object and it'll be shared with the AI next time.</p>
      )}

      {provider === 'meshy' && (
        <>
          <label className="lbl">Art style</label>
          <div className="seg">
            {STYLES.map((s) => (
              <button key={s} className={'seg-btn' + (style === s ? ' on' : '')} onClick={() => setStyle(s)}>
                {s}
              </button>
            ))}
          </div>
        </>
      )}
      <button className="btn primary full" disabled={status === 'running' || needsToken} onClick={generate}>
        {status === 'running' ? 'Generating…' : 'Generate 3D'}
      </button>
      {needsToken && <p className="status error">Add a free Hugging Face token in settings (top-right) first.</p>}
      {message && <p className={'status ' + status}>{message}</p>}

      <div className="divider" />
      <label className="lbl">Quick primitives</label>
      <div className="row wrap" data-tut="add-shape">
        {PRIMITIVES.map((p) => (
          <button key={p.kind} className="btn" onClick={() => addMesh({ kind: p.kind, label: p.label, color: p.color, scale: DEFAULT_SHAPE_UNIT })}>
            + {p.label}
          </button>
        ))}
      </div>
    </div>
  );
}
