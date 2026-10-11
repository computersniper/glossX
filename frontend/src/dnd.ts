// Drag and drop that works the same in a plain browser tab and in the desktop
// app: papers, workspace files and threads carry a small JSON payload under
// our own MIME type; files from the operating system arrive as `Files`.
import { useEffect, useRef, useState, type DragEvent } from "react";

export const DND_TYPE = "application/x-glossx";

export type DragItem =
  | { type: "paper"; id: string; label: string }
  | { type: "file"; project: string; path: string; label: string; dir?: boolean }
  | { type: "thread"; id: string; label: string; projectId: string | null }
  | { type: "project"; id: string; label: string }
  | { type: "tab"; key: string; label: string };

/** Start dragging one of our items; plain text is the label, for drops outside GlossX. */
export function startDrag(e: DragEvent, item: DragItem) {
  e.dataTransfer.setData(DND_TYPE, JSON.stringify(item));
  e.dataTransfer.setData("text/plain", item.type === "file" ? item.path : item.label);
  e.dataTransfer.effectAllowed = item.type === "tab" ? "move" : "copyMove";
  current = item;
}

// the payload is only readable on drop; while hovering, zones look at this
let current: DragItem | null = null;
if (typeof window !== "undefined") {
  window.addEventListener("dragend", () => { current = null; }, true);
  window.addEventListener("drop", () => { window.setTimeout(() => { current = null; }); }, true);
}

/** The item being dragged right now (ours only), readable during dragover. */
export const draggedItem = () => current;

export function readDrag(e: DragEvent): DragItem | null {
  try {
    const raw = e.dataTransfer.getData(DND_TYPE);
    return raw ? (JSON.parse(raw) as DragItem) : current;
  } catch {
    return current;
  }
}

export const hasFiles = (e: DragEvent | globalThis.DragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes("Files");
export const hasItem = (e: DragEvent | globalThis.DragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes(DND_TYPE);

/**
 * Props for an element that accepts drops. `accepts` decides during the hover
 * (files from the OS, or `draggedItem()` for ours); `onDrop` gets the event.
 * `over` stays true while the pointer is anywhere inside, children included.
 */
export function useDropZone(accepts: (e: DragEvent) => boolean, onDrop: (e: DragEvent) => void, effect: "copy" | "move" | (() => "copy" | "move") = "copy") {
  const [over, setOver] = useState(false);
  const depth = useRef(0);
  // a nested zone that takes the drop stops it here, so reset on any drop
  useEffect(() => {
    const reset = () => { depth.current = 0; setOver(false); };
    window.addEventListener("drop", reset, true);
    window.addEventListener("dragend", reset, true);
    return () => { window.removeEventListener("drop", reset, true); window.removeEventListener("dragend", reset, true); };
  }, []);
  const props = {
    onDragEnter: (e: DragEvent) => {
      if (!accepts(e)) return;
      e.preventDefault();
      depth.current += 1;
      setOver(true);
    },
    onDragOver: (e: DragEvent) => {
      if (!accepts(e)) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = typeof effect === "function" ? effect() : effect;
    },
    onDragLeave: (e: DragEvent) => {
      if (!accepts(e)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (!depth.current) setOver(false);
    },
    onDrop: (e: DragEvent) => {
      depth.current = 0;
      setOver(false);
      if (!accepts(e)) return;
      e.preventDefault();
      e.stopPropagation();
      onDrop(e);
    },
  };
  return { over, props };
}

export type DroppedFile = { file: File; path: string };

/**
 * Files from a drop, folders walked with their structure kept (`path` is
 * "folder/sub/file.txt"). Call it inside the drop handler, before any await:
 * the browser empties `dataTransfer` once the handler returns.
 */
export function droppedFiles(dt: DataTransfer | null): Promise<DroppedFile[]> {
  if (!dt) return Promise.resolve([]);
  const entries = Array.from(dt.items || []).filter((i) => i.kind === "file").map((i) => (i as any).webkitGetAsEntry?.() as any).filter(Boolean);
  const plain = Array.from(dt.files || []);
  if (!entries.length || !entries.some((e) => e.isDirectory)) return Promise.resolve(plain.map((file) => ({ file, path: file.name })));
  const out: DroppedFile[] = [];
  const walk = async (entry: any, prefix: string): Promise<void> => {
    if (out.length >= 2000) return;
    if (entry.isFile) {
      const file: File = await new Promise((ok, err) => entry.file(ok, err));
      out.push({ file, path: prefix + entry.name });
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      // readEntries returns at most ~100 entries per call
      for (;;) {
        const batch: any[] = await new Promise((ok, err) => reader.readEntries(ok, err));
        if (!batch.length) break;
        for (const child of batch) await walk(child, `${prefix}${entry.name}/`);
      }
    }
  };
  return (async () => {
    for (const e of entries) await walk(e, "");
    return out;
  })();
}

/** A drop carries a folder (only knowable inside the drop handler). */
export const dropHasFolder = (dt: DataTransfer | null) =>
  !!dt && Array.from(dt.items || []).some((i) => i.kind === "file" && (i as any).webkitGetAsEntry?.()?.isDirectory);
