import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { registerOrchestraBridge } from './lib/orchestraBridge.js';
import './styles/app.css';

// Expose window.__orchestraRunTool so the Electron control bridge (and through
// it, the Claude MCP plugin) can drive Forge3D. Harmless in the browser preview.
registerOrchestraBridge();

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
