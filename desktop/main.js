// GlossX desktop shell: starts the local backend, shows the app in an
// Electron window, and lends the backend Electron's Chromium as its browser.
"use strict";

const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require("electron");
const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { BrowserBridge } = require("./bridge");

const APP_NAME = "GlossX";
const STARTUP_TIMEOUT_MS = 60_000;
const TITLEBAR_HEIGHT = 40;
const REPO_ROOT = path.resolve(__dirname, "..");
const smokeArg = process.argv.find((arg) => arg.startsWith("--glossx-smoke="));
const SMOKE_REPORT = smokeArg ? path.resolve(smokeArg.slice("--glossx-smoke=".length)) : null;

// The browser pages reach the network only through the backend's guard proxy;
// QUIC and direct DNS would bypass it. Loopback stays resolvable for the app.
app.commandLine.appendSwitch("disable-quic");
app.commandLine.appendSwitch("host-resolver-rules", "MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost");
app.commandLine.appendSwitch("force-webrtc-ip-handling-policy", "disable_non_proxied_udp");

let mainWindow = null;
let backend = null;
let backendUrl = null;
let allowClose = false;
let promptOpen = false;
let quitting = false;
const bridge = new BrowserBridge(() => (mainWindow && !mainWindow.isDestroyed() ? mainWindow : null));

function logPath() {
  return path.join(app.getPath("logs"), "desktop.log");
}

function log(...parts) {
  const line = `${new Date().toISOString()} ${parts.join(" ")}\n`;
  try {
    fs.mkdirSync(path.dirname(logPath()), { recursive: true });
    fs.appendFileSync(logPath(), line);
  } catch {}
  if (!app.isPackaged) process.stderr.write(line);
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

// The packaged app carries the frozen backend; a source checkout runs Python.
function backendCommand() {
  if (app.isPackaged) {
    const name = process.platform === "win32" ? "glossx-backend.exe" : "glossx-backend";
    return { command: path.join(process.resourcesPath, "backend", name), args: [] };
  }
  const python = process.env.GLOSSX_PYTHON
    || [path.join(REPO_ROOT, "backend", ".venv", "Scripts", "python.exe"), path.join(REPO_ROOT, "backend", ".venv", "bin", "python")].find((p) => fs.existsSync(p))
    || (process.platform === "win32" ? "python" : "python3");
  return { command: python, args: [path.join(REPO_ROOT, "packaging", "windows_launcher.py")] };
}

async function startBackend(browserEndpoint) {
  const port = await freePort();
  const readyFile = path.join(os.tmpdir(), `glossx-ready-${process.pid}-${Date.now()}`);
  const { command, args } = backendCommand();
  const env = { ...process.env, GLOSSX_BROWSER_CDP: browserEndpoint, GLOSSX_READY_FILE: readyFile };
  log("Starting backend:", command);
  backend = spawn(command, [...args, "--headless", "--port", String(port)], {
    env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true, detached: process.platform !== "win32",
  });
  const tail = [];
  const keep = (chunk) => { tail.push(String(chunk)); if (tail.length > 40) tail.shift(); };
  backend.stdout.on("data", keep);
  backend.stderr.on("data", keep);
  const exited = new Promise((resolve) => backend.once("exit", (code) => resolve(code)));
  backend.once("exit", (code) => {
    log("Backend exited with code", code);
    if (!quitting && backendUrl) {
      dialog.showErrorBox(APP_NAME, `The GlossX backend stopped unexpectedly (code ${code}).\n\nDetails: ${logPath()}`);
      app.quit();
    }
  });
  // The backend may move to another port if this one was taken meanwhile; it
  // reports the address it actually serves.
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const code = await Promise.race([exited, new Promise((resolve) => setTimeout(() => resolve(undefined), 150))]);
    if (code !== undefined) throw new Error(`The backend exited during startup (code ${code}).\n\n${tail.join("").slice(-3000)}`);
    let url = null;
    try { url = fs.readFileSync(readyFile, "utf8").trim(); } catch {}
    if (url) {
      fs.rmSync(readyFile, { force: true });
      return url;
    }
  }
  throw new Error(`The backend did not become ready in time.\n\n${tail.join("").slice(-3000)}`);
}

function stopBackend() {
  const child = backend;
  backend = null;
  if (!child || child.exitCode !== null) return;
  try {
    if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
    else process.kill(-child.pid, "SIGTERM");
  } catch {
    try { child.kill(); } catch {}
  }
}

async function settings() {
  const response = await fetch(`${backendUrl}/api/settings`, { signal: AbortSignal.timeout(2000) });
  return (await response.json()).config || {};
}

async function requestClose() {
  if (promptOpen || !mainWindow) return;
  let confirm = false;
  try { confirm = mainWindow.webContents.isLoading() ? false : (await settings()).confirm_exit !== false; } catch (error) { log("Exit check failed:", error); }
  if (!confirm) {
    allowClose = true;
    mainWindow.close();
    return;
  }
  promptOpen = true;
  // Native pages draw above the app; the dialog must not sit underneath one.
  bridge.hide();
  mainWindow.webContents.send("glossx:close-request");
}

function fromMainWindow(event) {
  return mainWindow && event.sender === mainWindow.webContents;
}

ipcMain.handle("glossx:exit-cancel", (event) => {
  if (fromMainWindow(event)) promptOpen = false;
  return true;
});

ipcMain.handle("glossx:exit-confirm", async (event, dontAskAgain) => {
  if (!fromMainWindow(event)) return false;
  if (dontAskAgain === true) {
    try {
      await fetch(`${backendUrl}/api/settings`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirm_exit: false }) });
    } catch (error) { log("Could not save the exit preference:", error); }
  }
  promptOpen = false;
  allowClose = true;
  mainWindow.close();
  return true;
});

// The title bar follows the app theme; the page reports its colours.
ipcMain.handle("glossx:titlebar", (event, colors) => {
  if (!fromMainWindow(event) || process.platform === "darwin") return false;
  const color = /^#[0-9a-f]{6}$/i.test(colors?.color) ? colors.color : "#111820";
  const symbolColor = /^#[0-9a-f]{6}$/i.test(colors?.symbolColor) ? colors.symbolColor : "#c9d1d9";
  mainWindow.setTitleBarOverlay({ color, symbolColor, height: TITLEBAR_HEIGHT });
  return true;
});

const ZOOM_STEPS = [0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];

function zoom(direction) {
  const contents = mainWindow.webContents;
  const current = contents.getZoomFactor();
  const next = direction === 0 ? 1
    : direction > 0 ? ZOOM_STEPS.find((step) => step > current + 0.001)
      : [...ZOOM_STEPS].reverse().find((step) => step < current - 0.001);
  contents.setZoomFactor(next ?? current);
}

// Menu commands that only the window itself can carry out.
ipcMain.handle("glossx:window", (event, action) => {
  if (!fromMainWindow(event)) return false;
  const contents = mainWindow.webContents;
  switch (action) {
    case "undo": case "redo": case "cut": case "copy": case "paste": case "selectAll":
      contents[action]();
      return true;
    case "zoomIn": zoom(1); return true;
    case "zoomOut": zoom(-1); return true;
    case "zoomReset": zoom(0); return true;
    case "fullscreen": mainWindow.setFullScreen(!mainWindow.isFullScreen()); return true;
    case "devtools": contents.toggleDevTools(); return true;
    case "quit": mainWindow.close(); return true;
    default: return false;
  }
});

ipcMain.handle("glossx:browser-show", (event, targetId, rect) => {
  if (!fromMainWindow(event) || typeof targetId !== "string") return false;
  return bridge.show(targetId, rect, mainWindow.webContents.getZoomFactor());
});

ipcMain.handle("glossx:browser-hide", (event) => {
  if (fromMainWindow(event)) bridge.hide();
  return true;
});

function createWindow(url) {
  const icon = app.isPackaged ? path.join(process.resourcesPath, "gloss.ico") : path.join(REPO_ROOT, "packaging", "gloss.ico");
  mainWindow = new BrowserWindow({
    title: "GlossX · 旁注",
    width: 1500,
    height: 950,
    minWidth: 1024,
    minHeight: 720,
    backgroundColor: "#111820",
    icon,
    // The app draws its own title bar; the system keeps only its window
    // buttons, drawn over the bar's right end (traffic lights on macOS).
    titleBarStyle: "hidden",
    ...(process.platform === "darwin" ? { trafficLightPosition: { x: 14, y: 13 } } : { titleBarOverlay: { color: "#00000000", symbolColor: "#c9d1d9", height: TITLEBAR_HEIGHT } }),
    show: !SMOKE_REPORT,
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false },
  });
  const origin = new URL(url).origin;
  const external = (target) => { if (/^https?:/i.test(target)) void shell.openExternal(target); };
  mainWindow.webContents.setWindowOpenHandler(({ url: target }) => { external(target); return { action: "deny" }; });
  mainWindow.webContents.on("will-navigate", (event, target) => {
    if (new URL(target).origin !== origin) { event.preventDefault(); external(target); }
  });
  // Without an application menu, the usual window shortcuts are wired here.
  mainWindow.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") return;
    const mod = input.control || input.meta;
    if (input.key === "F11") mainWindow.setFullScreen(!mainWindow.isFullScreen());
    else if (mod && (input.key === "=" || input.key === "+")) zoom(1);
    else if (mod && input.key === "-") zoom(-1);
    else if (mod && input.key === "0") zoom(0);
    else return;
    event.preventDefault();
  });
  mainWindow.on("close", (event) => {
    if (allowClose || SMOKE_REPORT) return;
    event.preventDefault();
    void requestClose();
  });
  mainWindow.on("closed", () => { mainWindow = null; });
  return mainWindow.loadURL(url);
}

// A packaged-build check: drives the shared browser through the backend API,
// exactly as the agent does, and writes what happened to a JSON report.
async function smoke() {
  const call = async (method, route, body) => {
    const response = await fetch(`${backendUrl}${route}`, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    const value = await response.json();
    if (!response.ok) throw new Error(`${route}: ${JSON.stringify(value)}`);
    return value;
  };
  const report = { ok: false };
  try {
    const status = await call("GET", "/api/browser/status");
    const created = await call("POST", "/api/sessions", { title: "Desktop browser check" });
    const sid = created.id || created.session?.id;
    await call("POST", `/api/sessions/${sid}/browser/input`, { type: "navigate", url: "about:blank" });
    // GLOSSX_SMOKE_URL also checks a real page (it must be allowed by the guard).
    if (process.env.GLOSSX_SMOKE_URL) {
      await call("POST", `/api/sessions/${sid}/browser/input`, { type: "navigate", url: process.env.GLOSSX_SMOKE_URL });
      report.text = (await call("POST", `/api/sessions/${sid}/browser/input`, { type: "read" })).text?.slice(0, 200);
    }
    const snapshot = await call("POST", `/api/sessions/${sid}/browser/input`, { type: "snapshot" });
    report.snapshot = String(snapshot.text || "").slice(0, 300);
    const tabs = snapshot.tabs || [];
    const shown = bridge.show(tabs[0]?.id, { x: 0, y: 0, width: 400, height: 300 });
    Object.assign(report, { ok: status.available === true && tabs.length === 1 && shown && bridge.targets.size === 1, browser: status.browser, tabs: tabs.length, native_pages: bridge.targets.size, electron: process.versions.electron });
  } catch (error) {
    report.error = String(error?.stack || error);
  }
  fs.mkdirSync(path.dirname(SMOKE_REPORT), { recursive: true });
  fs.writeFileSync(SMOKE_REPORT, JSON.stringify(report, null, 2));
  return report.ok ? 0 : 1;
}

async function main() {
  Menu.setApplicationMenu(null);
  try {
    const endpoint = await bridge.start();
    backendUrl = await startBackend(endpoint);
    log("Backend ready at", backendUrl);
    await createWindow(backendUrl);
    if (SMOKE_REPORT) {
      const code = await smoke();
      quitting = true;
      // Close the pages and the window before exiting, as a normal quit does.
      bridge.close();
      stopBackend();
      mainWindow?.destroy();
      setTimeout(() => app.exit(code), 300);
    }
  } catch (error) {
    log("Startup failed:", error?.stack || error);
    quitting = true;
    stopBackend();
    if (SMOKE_REPORT) {
      fs.mkdirSync(path.dirname(SMOKE_REPORT), { recursive: true });
      fs.writeFileSync(SMOKE_REPORT, JSON.stringify({ ok: false, error: String(error?.stack || error) }, null, 2));
      app.exit(1);
      return;
    }
    dialog.showErrorBox(APP_NAME, `GlossX could not start.\n\n${error?.message || error}\n\nDetails: ${logPath()}`);
    app.quit();
  }
}

if (process.argv.includes("--version")) {
  process.stdout.write(`${APP_NAME} ${app.getVersion()} (Electron ${process.versions.electron})\n`);
  process.exit(0);
} else if (!SMOKE_REPORT && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
  app.whenReady().then(main);
  app.on("window-all-closed", () => app.quit());
  app.on("before-quit", () => { quitting = true; });
  app.on("will-quit", () => { bridge.close(); stopBackend(); });
}
