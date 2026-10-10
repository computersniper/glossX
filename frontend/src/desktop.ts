// The Electron shell's API (desktop/preload.js). Absent when GlossX runs in a
// regular browser, so every use is optional.
export type DesktopCommand = "undo" | "redo" | "cut" | "copy" | "paste" | "selectAll" | "zoomIn" | "zoomOut" | "zoomReset" | "fullscreen" | "devtools" | "quit";

export type DesktopApi = {
  shell: "electron";
  platform: string;
  command: (action: DesktopCommand) => Promise<boolean>;
  setTitleBarColors: (color: string, symbolColor: string) => Promise<boolean>;
  cancelExit: () => Promise<boolean>;
  confirmExit: (dontAskAgain: boolean) => Promise<boolean>;
  browser: {
    show: (targetId: string, rect: { x: number; y: number; width: number; height: number }) => Promise<boolean>;
    hide: () => Promise<boolean>;
  };
};

declare global {
  interface Window { glossxDesktop?: DesktopApi }
}

export const desktop: DesktopApi | undefined = typeof window === "undefined" ? undefined : window.glossxDesktop;

// Any CSS colour (including color-mix results) as #rrggbb.
function hex(color: string): string | null {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/** Let the app's own top bar act as the window title bar. */
export function initDesktopChrome() {
  const api = desktop;
  if (!api) return;
  const root = document.documentElement;
  root.classList.add("gx-desktop", `gx-desktop-${api.platform}`);
  // Room for the system window buttons at the right end of the bar.
  const overlay = (navigator as Navigator & { windowControlsOverlay?: EventTarget & { getTitlebarAreaRect: () => DOMRect } }).windowControlsOverlay;
  const reserve = () => {
    const area = overlay?.getTitlebarAreaRect();
    const right = area && area.width > 0 ? Math.max(0, window.innerWidth - area.x - area.width) : api.platform === "darwin" ? 0 : 138;
    root.style.setProperty("--gx-controls-right", `${Math.round(right)}px`);
  };
  overlay?.addEventListener("geometrychange", reserve);
  window.addEventListener("resize", reserve);
  reserve();
  let last = "", queued = false;
  // The system window buttons sit on the bar, so they take its colours. The
  // bar changes with the theme and with the Gloss / GlossX mode.
  const sync = () => {
    queued = false;
    const bar = document.querySelector(".wb-titlebar, .topbar");
    if (!bar) return;
    const style = getComputedStyle(bar);
    const raw = `${style.backgroundColor}|${style.color}`;
    if (raw === last) return;
    last = raw;
    const color = hex(style.backgroundColor);
    const symbol = hex(style.color);
    if (color && symbol) void api.setTitleBarColors(color, symbol);
  };
  const queue = () => { if (!queued) { queued = true; requestAnimationFrame(sync); } };
  new MutationObserver(queue).observe(root, { attributes: true, attributeFilter: ["data-theme"] });
  new MutationObserver(queue).observe(document.body, { childList: true, subtree: true });
  queue();
}
