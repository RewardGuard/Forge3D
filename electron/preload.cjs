const { contextBridge, ipcRenderer, webFrame } = require('electron');

contextBridge.exposeInMainWorld('forge', {
  config: {
    get: () => ipcRenderer.invoke('config:get'),
    setMeshyKey: (key) => ipcRenderer.invoke('config:setMeshyKey', key),
    setHfToken: (token) => ipcRenderer.invoke('config:setHfToken', token),
    setThingiverseToken: (token) => ipcRenderer.invoke('config:setThingiverseToken', token),
    setAnthropicKey: (key) => ipcRenderer.invoke('config:setAnthropicKey', key),
    setGeminiKey: (key) => ipcRenderer.invoke('config:setGeminiKey', key),
    setGroqKey: (key) => ipcRenderer.invoke('config:setGroqKey', key),
    setMistralKey: (key) => ipcRenderer.invoke('config:setMistralKey', key),
    setOpenrouterKey: (key) => ipcRenderer.invoke('config:setOpenrouterKey', key),
    setProvider: (provider) => ipcRenderer.invoke('config:setProvider', provider),
    setCodeProvider: (provider) => ipcRenderer.invoke('config:setCodeProvider', provider),
    setCircuitProvider: (provider) => ipcRenderer.invoke('config:setCircuitProvider', provider),
  },
  claude: {
    generate: (payload) => ipcRenderer.invoke('claude:generate', payload),
    circuit: (payload) => ipcRenderer.invoke('claude:circuit', payload),
    ask: (payload) => ipcRenderer.invoke('claude:ask', payload),
  },
  usage: {
    get: () => ipcRenderer.invoke('usage:get'),
  },
  projects: {
    list: () => ipcRenderer.invoke('projects:list'),
    openPath: (filePath) => ipcRenderer.invoke('projects:openPath', { filePath }),
    reveal: (filePath) => ipcRenderer.invoke('projects:reveal', { filePath }),
  },
  production: {
    export: (payload) => ipcRenderer.invoke('production:export', payload),
  },
  thingiverse: {
    search: (opts) => ipcRenderer.invoke('thingiverse:search', opts),
    import: (opts) => ipcRenderer.invoke('thingiverse:import', opts),
  },
  meshy: {
    createTextTo3D: (payload) => ipcRenderer.invoke('meshy:createTextTo3D', payload),
    getTask: (taskId) => ipcRenderer.invoke('meshy:getTask', taskId),
  },
  hf: {
    generate: (payload) => ipcRenderer.invoke('hf:generate', payload),
  },
  saveFile: (opts) => ipcRenderer.invoke('file:save', opts),
  saveCode: (opts) => ipcRenderer.invoke('code:save', opts),
  saveProject: (opts) => ipcRenderer.invoke('project:save', opts),
  openFile: (opts) => ipcRenderer.invoke('file:open', opts),
  openExternal: (url) => ipcRenderer.invoke('app:openExternal', url),
  // Native page zoom (interface size) — CSS `zoom` broke the flex layout.
  setZoom: (factor) => webFrame.setZoomFactor(Number(factor) || 1),
});
