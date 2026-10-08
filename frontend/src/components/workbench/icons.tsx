// Minimal stroke icons for the workbench chrome (inherit currentColor).
const PATHS: Record<string, string> = {
  library: "M4 4.5h3v15H4zM9 4.5h3v15H9zM14.2 5.2l2.9-.8 3.9 14.5-2.9.8z",
  projects: "M3.5 7.5a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z",
  search: "M10.5 4a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13zM15.5 15.5 20 20",
  plugins: "M9 4h6v4h2.5a1.5 1.5 0 0 1 1.5 1.5V12h-2a2 2 0 1 0 0 4h2v2.5a1.5 1.5 0 0 1-1.5 1.5H6.5A1.5 1.5 0 0 1 5 18.5V9.5A1.5 1.5 0 0 1 6.5 8H9z",
  settings: "M12 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6zM12 2.8l1.6 2.6 3-.6.6 3 2.6 1.6-1.5 2.6 1.5 2.6-2.6 1.6-.6 3-3-.6L12 21.2l-1.6-2.6-3 .6-.6-3-2.6-1.6 1.5-2.6-1.5-2.6 2.6-1.6.6-3 3 .6z",
  agent: "M12 3v3M7 8h10a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2zM9.5 13h.01M14.5 13h.01M2.5 12.5v3M21.5 12.5v3",
  chat: "M4 5.5h16v10H9l-5 4z",
  tools: "M14.5 5.5a4 4 0 0 0-5 5L4 16l4 4 5.5-5.5a4 4 0 0 0 5-5l-2.5 2.5-3-1-1-3z",
  paper: "M6 3.5h8l4 4v13H6zM14 3.5v4h4M9 12h6M9 15.5h6",
  report: "M5 4h14v16H5zM8.5 8h7M8.5 11.5h7M8.5 15h4",
  home: "M4 11 12 4l8 7M6.5 9.5V20h11V9.5",
  panel: "M3.5 4.5h17v15h-17zM3.5 14.5h17",
  sidebar: "M3.5 4.5h17v15h-17zM9 4.5v15",
  aipane: "M3.5 4.5h17v15h-17zM15 4.5v15",
  close: "M6 6l12 12M18 6 6 18",
  plus: "M12 5v14M5 12h14",
  upload: "M12 16V4M7 9l5-5 5 5M4.5 15v4.5h15V15",
  more: "M6 12h.01M12 12h.01M18 12h.01",
  command: "M9 9V6.5A2.5 2.5 0 1 0 6.5 9H9zm0 0h6m-6 0v6m6-6V6.5A2.5 2.5 0 1 1 17.5 9H15zm0 0v6m0 0h-6m6 0v2.5a2.5 2.5 0 1 0 2.5-2.5H15zm-6 0v2.5A2.5 2.5 0 1 1 6.5 15H9z",
};

export function Icon({ name, size = 18 }: { name: keyof typeof PATHS | string; size?: number }) {
  return (
    <svg className="wb-icon" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d={PATHS[name] || PATHS.more} />
    </svg>
  );
}
