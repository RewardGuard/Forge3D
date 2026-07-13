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
    setGlmKey: (key) => ipcRenderer.invoke('config:setGlmKey', key),
    setProvider: (provider) => ipcRenderer.invoke('config:setProvider', provider),
    setCodeProvider: (provider) => ipcRenderer.invoke('config:setCodeProvider', provider),
    setCircuitProvider: (provider) => ipcRenderer.invoke('config:setCircuitProvider', provider),
    setOrchestraDirector: (provider) => ipcRenderer.invoke('config:setOrchestraDirector', provider),
    setOrchestraVision: (model) => ipcRenderer.invoke('config:setOrchestraVision', model),
    setOrchestraHeadroom: (level) => ipcRenderer.invoke('config:setOrchestraHeadroom', level),
    setBridgeEnabled: (enabled) => ipcRenderer.invoke('config:setBridgeEnabled', enabled),
    setBridgeToken: (token) => ipcRenderer.invoke('config:setBridgeToken', token),
    setCloudPairing: (opts) => ipcRenderer.invoke('config:setCloudPairing', opts),
  },
  claude: {
    generate: (payload) => ipcRenderer.invoke('claude:generate', payload),
    circuit: (payload) => ipcRenderer.invoke('claude:circuit', payload),
    ask: (payload) => ipcRenderer.invoke('claude:ask', payload),
  },
  account: {
    signup: (payload) => ipcRenderer.invoke('account:signup', payload),
    login: (payload) => ipcRenderer.invoke('account:login', payload),
    logout: () => ipcRenderer.invoke('account:logout'),
    me: () => ipcRenderer.invoke('account:me'),
    checkout: () => ipcRenderer.invoke('account:checkout'),
    portal: () => ipcRenderer.invoke('account:portal'),
    setCloudAi: (ai) => ipcRenderer.invoke('config:setCloudAi', ai),
  },
  orchestra: {
    think: (payload) => ipcRenderer.invoke('orchestra:think', payload),
    vision: (payload) => ipcRenderer.invoke('orchestra:vision', payload),
  },
  usage: {
    get: () => ipcRenderer.invoke('usage:get'),
  },
  projects: {
    list: () => ipcRenderer.invoke('projects:list'),
    openPath: (filePath) => ipcRenderer.invoke('projects:openPath', { filePath }),
    reveal: (filePath) => ipcRenderer.invoke('projects:reveal', { filePath }),
    saveAs: (opts) => ipcRenderer.invoke('project:saveAs', opts), // dialog-free (bridge/MCP)
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
