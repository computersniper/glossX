import * as pdfjsLib from "pdfjs-dist";
// Bundle the worker locally (no CDN) so it works fully offline.
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

export { pdfjsLib };
export const TextLayer = (pdfjsLib as any).TextLayer;
