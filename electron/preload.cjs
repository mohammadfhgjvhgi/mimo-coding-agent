// MiMo X — Electron Preload Script
// Provides a safe bridge between the renderer (Next.js) and the main process.
const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("mimoX", {
  version: require("../package.json").version,
  platform: process.platform,
  isElectron: true,
});
