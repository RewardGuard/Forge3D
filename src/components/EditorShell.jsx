import React from 'react';
import { useStore } from '../lib/store.js';
import DesignWorkspace from '../panels/DesignWorkspace.jsx';
import CircuitWorkspace from '../panels/CircuitWorkspace.jsx';
import ExportWorkspace from '../panels/ExportWorkspace.jsx';
import LifeSimWorkspace from '../panels/LifeSimWorkspace.jsx';
import OrchestraPanel from './OrchestraPanel.jsx';
import SettingsButton from './SettingsButton.jsx';
import markUrl from '../assets/forge3d-mark.png';
import ProjectButtons from './ProjectButtons.jsx';
import ThemeToggle from './ThemeToggle.jsx';

const TABS = [
  { id: 'orchestra', label: '✦ Orchestra', hint: 'AI director — builds whole projects for you' },
  { id: 'design', label: '3D Design', hint: 'Meshy AI + viewport' },
  { id: 'circuit', label: 'Circuit', hint: 'Parts, wiring & BOM' },
  { id: 'export', label: 'Export', hint: 'Sticker SVG + bill of materials' },
  { id: 'lifesim', label: 'Life Sim', hint: 'Run code + real-world physics' },
];

// The main editor: topbar + workspace tabs. Extracted from App so a shell router
// can swap between the onboarding screens, the projects home, and this editor.
// `chromeless` hides the Home button (used when the tutorial mounts the editor).
export default function EditorShell({ chromeless = false }) {
  const tab = useStore((s) => s.tab);
  const setTab = useStore((s) => s.setTab);
  const setShellView = useStore((s) => s.setShellView);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <img className="logo-img" src={markUrl} alt="" /> Forge3D
          <span className="tag">design · simulate · fabricate</span>
        </div>
        <nav className="tabs">
          {TABS.map((t) => (
            <button
              key={t.id}
              data-tut={'tab-' + t.id}
              className={'tab' + (tab === t.id ? ' active' : '')}
              onClick={() => setTab(t.id)}
              title={t.hint}
            >
              {t.label}
            </button>
          ))}
        </nav>
        {!chromeless && (
          <button className="mini" title="Back to your projects" onClick={() => setShellView('home')}>⌂ Home</button>
        )}
        <ProjectButtons />
        <ThemeToggle />
        <SettingsButton />
      </header>

      <main className="workspace">
        {tab === 'orchestra' && <OrchestraPanel />}
        {tab === 'design' && <DesignWorkspace />}
        {tab === 'circuit' && <CircuitWorkspace />}
        {tab === 'export' && <ExportWorkspace />}
        {tab === 'lifesim' && <LifeSimWorkspace />}
      </main>
    </div>
  );
}
