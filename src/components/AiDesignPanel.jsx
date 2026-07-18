import React, { useState } from 'react';
import { useStore } from '../lib/store.js';
import { runOrchestra } from '../lib/orchestra.js';

// "Claude Design" / "Orchestra" generation — build a whole 3D model from a
// sentence, from scratch. Both hand the prompt to the Orchestra director and open
// the ✦ Orchestra stage so you watch it build live. "claude" forces Claude as the
// brain (Anthropic key or Forge3D Cloud); "orchestra" uses your configured model.
export default function AiDesignPanel({ mode }) {
  const setTab = useStore((s) => s.setTab);
  const setOrchestraDirector = useStore((s) => s.setOrchestraDirector);
  const running = useStore((s) => s.orchestraStatus === 'running');
  const [prompt, setPrompt] = useState('');

  async function generate() {
    const goal = prompt.trim();
    if (!goal) return;
    if (mode === 'claude') {
      setOrchestraDirector('anthropic');
      try { await window.forge.config.setOrchestraDirector('anthropic'); } catch { /* browser preview */ }
    }
    setTab('orchestra'); // watch it build on the Orchestra stage
    runOrchestra(goal);  // fire-and-forget; progress streams to the store
  }

  const claude = mode === 'claude';
  return (
    <div className="panel scroll">
      <h3>{claude ? 'Claude Design' : '✦ Orchestra'}</h3>
      <p className="muted small">
        {claude
          ? 'Build a full 3D model from scratch with Claude as the director — geometry, plus circuit + firmware if your idea needs them.'
          : 'Describe a whole project; Orchestra plans it and builds the 3D model (and electronics) from scratch.'}
      </p>
      <label className="lbl">Describe what to build</label>
      <textarea
        className="onb-input" rows={4} value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder={claude ? 'a low-poly desk lamp' : 'a sumo robot with ultrasonic, 4 motors and an arduino'}
      />
      <button className="btn primary full" style={{ marginTop: 10 }} disabled={running || !prompt.trim()} onClick={generate}>
        {running ? 'Building…' : (claude ? 'Design with Claude ✦' : 'Run Orchestra ✦')}
      </button>
      <p className="muted small" style={{ marginTop: 8 }}>Opens the ✦ Orchestra stage so you watch it build live.</p>
    </div>
  );
}
