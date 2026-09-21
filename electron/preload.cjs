// Preload runs in an isolated context even with contextIsolation+sandbox on — contextBridge is
// the one safe way to expose a narrow surface to the renderer. Kept deliberately tiny: one method,
// no raw ipcRenderer, no filesystem access exposed directly.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mpp', {
  /**
   * Opens a native "choose a .mpp file" dialog, then parses the chosen file via the bundled MPXJ
   * shim. Resolves to:
   *   { canceled: true }                          — user dismissed the dialog
   *   { canceled: false, fileName, json }          — parsed successfully (json is MppToJson's output)
   *   { canceled: false, error }                   — the shim failed (message is safe to show as-is)
   */
  pickAndParse: () => ipcRenderer.invoke('mpp:pick-and-parse'),
});
