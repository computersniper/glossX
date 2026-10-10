// Render docs/logo-x.svg to transparent PNGs and pack them into a Windows .ico (PNG-compressed entries).
const { chromium } = require('C:/Users/caijiechao/AppData/Local/Temp/claude/D--study-vibe-coding-glossX/ee2824b5-e972-4673-8262-601f3d47c73b/scratchpad/pw/node_modules/playwright-core');
const fs = require('fs');
const [,, svgPath, icoPath, pngPath] = process.argv;
const sizes = [16, 24, 32, 48, 64, 128, 256];
(async () => {
  const svg = fs.readFileSync(svgPath, 'utf8');
  const b = await chromium.launch({ executablePath: 'C:/Users/caijiechao/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe' });
  const pngs = [];
  for (const s of sizes) {
    const p = await b.newPage({ viewport: { width: s, height: s }, deviceScaleFactor: 1 });
    // small sizes: thicker strokes so the page and the X survive downscaling
    const k = s <= 24 ? 1.5 : s <= 48 ? 1.2 : 1;
    const t = svg.replace('<svg ', `<svg width="${s}" height="${s}" `)
      .replace(/stroke-width="3.5"/g, `stroke-width="${3.5 * k}"`).replace('stroke-width="8"', `stroke-width="${8 * (s <= 24 ? 1.25 : 1)}"`);
    await p.setContent(`<body style="margin:0;background:transparent">${t}</body>`);
    pngs.push(await p.screenshot({ omitBackground: true }));
    await p.close();
  }
  await b.close();
  const head = Buffer.alloc(6); head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(sizes.length, 4);
  let offset = 6 + 16 * sizes.length; const entries = [];
  sizes.forEach((s, i) => { const e = Buffer.alloc(16); e.writeUInt8(s === 256 ? 0 : s, 0); e.writeUInt8(s === 256 ? 0 : s, 1); e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6); e.writeUInt32LE(pngs[i].length, 8); e.writeUInt32LE(offset, 12); offset += pngs[i].length; entries.push(e); });
  fs.writeFileSync(icoPath, Buffer.concat([head, ...entries, ...pngs]));
  if (pngPath) fs.writeFileSync(pngPath, pngs[pngs.length - 1]);
  console.log('wrote', icoPath, fs.statSync(icoPath).size, 'bytes');
})();
