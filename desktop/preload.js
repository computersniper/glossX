// The only desktop APIs the app page can reach.
"use strict";

const { contextBridge, ipcRenderer } = require("electron");

ipcRenderer.on("glossx:close-request", () => window.dispatchEvent(new CustomEvent("glossx:close-request")));

contextBridge.exposeInMainWorld("glossxDesktop", {
  shell: "electron",
  platform: process.platform,
  command: (action) => ipcRenderer.invoke("glossx:window", String(action)),
  setTitleBarColors: (color, symbolColor) => ipcRenderer.invoke("glossx:titlebar", { color: String(color), symbolColor: String(symbolColor) }),
  cancelExit: () => ipcRenderer.invoke("glossx:exit-cancel"),
  confirmExit: (dontAskAgain) => ipcRenderer.invoke("glossx:exit-confirm", dontAskAgain === true),
  browser: {
    show: (targetId, rect) => ipcRenderer.invoke("glossx:browser-show", String(targetId), {
      x: Number(rect.x), y: Number(rect.y), width: Number(rect.width), height: Number(rect.height),
    }),
    hide: () => ipcRenderer.invoke("glossx:browser-hide"),
  },
});
