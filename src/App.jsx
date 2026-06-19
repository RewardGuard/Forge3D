import React, { useEffect } from 'react';
import { useStore } from './lib/store.js';
import DesignWorkspace from './panels/DesignWorkspace.jsx';
import CircuitWorkspace from './panels/CircuitWorkspace.jsx';
import ExportWorkspace from './panels/ExportWorkspace.jsx';
import LifeSimWorkspace from './panels/LifeSimWorkspace.jsx';
import SettingsButton from './components/SettingsButton.jsx';
import ProjectButtons from './components/ProjectButtons.jsx';
import ThemeToggle from './components/ThemeToggle.jsx';

const TABS = [
  { id: 'design', label: '3D Design', hint: 'Meshy AI + viewport' },
  { id: 'circuit', label: 'Circuit Sim', hint: 'Parts, wiring & BOM' },
  { id: 'export', label: 'Sticker / BOM', hint: 'SVG + bill of materials' },
  { id: 'lifesim', label: 'Life Sim', hint: 'Run code + real-world physics' },
];

// `window.forge` exists only inside Electron. Provide a browser fallback so the
// renderer also runs under plain `vite` for quick iteration.
const browserFallback = {
  config: {
    get: async () => ({ hasMeshyKey: false, hasHfToken: false, hasThingiverseToken: false, hasAnthropicKey: false, hasGeminiKey: false, hasGroqKey: false, hasMistralKey: false, hasOpenrouterKey: false, hasGlmKey: false, provider: 'mock', codeProvider: 'mock', circuitProvider: 'mock' }),
    setMeshyKey: async () => ({ hasMeshyKey: false }),
    setHfToken: async () => ({ hasHfToken: false }),
    setThingiverseToken: async () => ({ hasThingiverseToken: false }),
    setAnthropicKey: async () => ({ hasAnthropicKey: false }),
    setGeminiKey: async () => ({ hasGeminiKey: false }),
    setGroqKey: async () => ({ hasGroqKey: false }),
    setMistralKey: async () => ({ hasMistralKey: false }),
    setOpenrouterKey: async () => ({ hasOpenrouterKey: false }),
    setGlmKey: async () => ({ hasGlmKey: false }),
    setProvider: async (provider) => ({ provider }),
    setCodeProvider: async (codeProvider) => ({ codeProvider }),
    setCircuitProvider: async (circuitProvider) => ({ circuitProvider }),
  },
  claude: {
    generate: async ({ prompt }) => ({
      mock: true,
      code: `// Mock sketch (browser preview).\n// ${String(prompt || '').slice(0, 80)}\nvoid setup() {}\nvoid loop() {}`,
    }),
    circuit: async () => ({
      mock: true,
      raw: JSON.stringify({ summary: 'Mock agent (browser preview) — no analysis.', actions: [] }),
    }),
    ask: async () => ({ mock: true, answer: 'Mock mode (browser preview).' }),
  },
  usage: {
    get: async () => ([
      { id: 'gemini', name: 'Gemini', hasKey: false, free: true, remaining: '∞', note: 'Free tier' },
      { id: 'groq', name: 'Groq', hasKey: false, free: true, remaining: '∞', note: 'Free tier' },
    ]),
  },
  projects: {
    list: async () => ({ projects: [], production: [] }),
    openPath: async () => ({ opened: false }),
    reveal: async () => ({ ok: false }),
  },
  production: {
    export: async () => ({ ok: false, path: '(browser preview — no filesystem)' }),
  },
  thingiverse: {
    search: async () => ({ hits: [], total: 0 }),
    import: async () => ({ fileUrl: null }),
  },
  meshy: {
    createTextTo3D: async () => ({ mock: true, taskId: 'mock-' + Date.now() }),
    getTask: async () => ({ mock: true, status: 'SUCCEEDED', progress: 100, model_urls: {} }),
  },
  hf: { generate: async () => ({ modelUrl: null }) },
  saveFile: async ({ defaultName, content }) => {
    const blob = new Blob([content], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = defaultName || 'export.txt';
    a.click();
    return { saved: true, filePath: defaultName };
  },
  saveProject: async ({ content }) => {
    const blob = new Blob([content], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'project.f3d';
    a.click();
    return { saved: true, filePath: 'project.f3d', inPlace: false };
  },
  saveCode: async ({ filename, content }) => {
    const blob = new Blob([content], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename || 'sketch.txt';
    a.click();
    return { saved: true, filePath: filename, inProject: false };
  },
  openExternal: async (url) => {
    window.open(url, '_blank', 'noopener');
    return { opened: true };
  },
  // CSS zoom breaks react-three-fiber's resize observer (canvas blows up to
  // millions of px) — in the browser preview, interface size is a no-op.
  // The packaged Electron app uses webFrame.setZoomFactor, which is safe.
  setZoom: () => {},
  openFile: async () =>
    new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.f3d,.json';
      input.onchange = () => {
        const file = input.files?.[0];
        if (!file) return resolve({ opened: false });
        const reader = new FileReader();
        reader.onload = () => resolve({ opened: true, content: reader.result, filePath: file.name });
        reader.readAsText(file);
      };
      input.click();
    }),
};
if (!window.forge) window.forge = browserFallback;
// dev-only handle for UI testing (vite dev server; never in the packaged app)
if (import.meta.env?.DEV) window.__store = useStore;

// Last-resort guard: a render crash used to unmount everything (black window).
// Now it shows the error and offers a reload instead.
class AppErrorBoundary extends React.Component {
  constructor(p) { super(p); this.state = { err: null }; }
  static getDerivedStateFromError(err) { return { err }; }
  render() {
    if (!this.state.err) return this.props.children;
    return (
      <div style={{ padding: 40, fontFamily: 'monospace', color: '#d7dee8' }}>
        <h2>Something crashed</h2>
        <pre style={{ whiteSpace: 'pre-wrap', color: '#ef4444' }}>{String(this.state.err?.message || this.state.err)}</pre>
        <button style={{ padding: '8px 16px', cursor: 'pointer' }} onClick={() => window.location.reload()}>Reload app</button>
      </div>
    );
  }
}

export default function App() {
  const tab = useStore((s) => s.tab);
  const setTab = useStore((s) => s.setTab);
  const setHasMeshyKey = useStore((s) => s.setHasMeshyKey);
  const setHasHfToken = useStore((s) => s.setHasHfToken);
  const setHasThingiverseToken = useStore((s) => s.setHasThingiverseToken);
  const setHasAnthropicKey = useStore((s) => s.setHasAnthropicKey);
  const setHasGeminiKey = useStore((s) => s.setHasGeminiKey);
  const setHasGroqKey = useStore((s) => s.setHasGroqKey);
  const setHasMistralKey = useStore((s) => s.setHasMistralKey);
  const setHasOpenrouterKey = useStore((s) => s.setHasOpenrouterKey);
  const setHasGlmKey = useStore((s) => s.setHasGlmKey);
  const setProvider = useStore((s) => s.setProvider);
  const setCodeProvider = useStore((s) => s.setCodeProvider);
  const setCircuitProvider = useStore((s) => s.setCircuitProvider);
  const theme = useStore((s) => s.theme);

  useEffect(() => {
    window.forge.config.get().then((c) => {
      setHasMeshyKey(Boolean(c.hasMeshyKey));
      setHasHfToken(Boolean(c.hasHfToken));
      setHasThingiverseToken(Boolean(c.hasThingiverseToken));
      setHasAnthropicKey(Boolean(c.hasAnthropicKey));
      setHasGeminiKey(Boolean(c.hasGeminiKey));
      setHasGroqKey(Boolean(c.hasGroqKey));
      setHasMistralKey(Boolean(c.hasMistralKey));
      setHasOpenrouterKey(Boolean(c.hasOpenrouterKey));
      setHasGlmKey(Boolean(c.hasGlmKey));
      setProvider(c.provider || 'mock');
      setCodeProvider(c.codeProvider || 'mock');
      setCircuitProvider(c.circuitProvider || c.codeProvider || 'mock');
    });
  }, [setHasMeshyKey, setHasHfToken, setHasThingiverseToken, setHasAnthropicKey, setHasGeminiKey, setHasGroqKey, setHasMistralKey, setHasOpenrouterKey, setHasGlmKey, setProvider, setCodeProvider, setCircuitProvider]);

  // reflect theme on the root element so CSS variables switch
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  // blink clock: while the sim runs, advance simTick so code-driven pins toggle
  const simOn = useStore((s) => s.simOn);
  useEffect(() => {
    if (!simOn) return;
    const id = setInterval(() => useStore.getState().tickSim(), 650);
    return () => clearInterval(id);
  }, [simOn]);

  // ---- copy / paste / duplicate / delete shortcuts (3D design tab) ----
  useEffect(() => {
    const onKey = (e) => {
      const s = useStore.getState();
      if (s.tab !== 'design') return;
      // don't hijack typing in inputs / textareas / contenteditable
      const t = e.target;
      const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
      if (typing) return;

      const meta = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      if (meta && key === 'c') {
        if (s.selectedMeshId) { s.copyMesh(); e.preventDefault(); }
      } else if (meta && key === 'v') {
        if (s.clipboard) { s.pasteMesh(); e.preventDefault(); }
      } else if (meta && key === 'd') {
        if (s.selectedMeshId) { s.duplicateMesh(); e.preventDefault(); }
      } else if (meta && key === 'g') {
        if (e.shiftKey) s.ungroupSelected();
        else if (s.selectedMeshIds.length > 1) s.groupSelected();
        e.preventDefault();
      } else if ((key === 'delete' || key === 'backspace') && (s.selectedMeshId || s.selectedMeshIds.length)) {
        s.removeSelectedMeshes(); e.preventDefault();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const uiZoom = useStore((s) => s.uiZoom);
  // interface size via Electron's native page zoom (CSS zoom collapsed the layout)
  useEffect(() => {
    if (window.forge?.setZoom) window.forge.setZoom(uiZoom);
  }, [uiZoom]);

  return (
    <AppErrorBoundary>
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo">◆</span> Forge3D
          <span className="tag">design · simulate · fabricate</span>
        </div>
        <nav className="tabs">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={'tab' + (tab === t.id ? ' active' : '')}
              onClick={() => setTab(t.id)}
              title={t.hint}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <ProjectButtons />
        <ThemeToggle />
        <SettingsButton />
      </header>

      <main className="workspace">
        {tab === 'design' && <DesignWorkspace />}
        {tab === 'circuit' && <CircuitWorkspace />}
        {tab === 'export' && <ExportWorkspace />}
        {tab === 'lifesim' && <LifeSimWorkspace />}
      </main>
    </div>
    </AppErrorBoundary>
  );
}
