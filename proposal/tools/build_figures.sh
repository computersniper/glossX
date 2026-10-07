#!/usr/bin/env bash
# Compile each TikZ figure standalone -> PDF, then rasterise to PNG for the Word version.
# Usage: tools/build_figures.sh [python-with-pymupdf]
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
py="${1:-python3}"
out="$here/word/figures"; build="$here/tools/.build"
mkdir -p "$out" "$build"
for fig in positioning dimensions architecture workflow; do
  cat > "$build/$fig.tex" <<TEX
\documentclass[border=6pt]{standalone}
\usepackage[T1]{fontenc}
\renewcommand{\rmdefault}{ptm}\renewcommand{\sfdefault}{phv}
\usepackage{amsmath,tikz}
\input{styles}
\newcommand{\sysname}{GlossX}
\begin{document}
\input{$fig}
\end{document}
TEX
  (cd "$here/latex/figures" && pdflatex -interaction=nonstopmode -halt-on-error \
      -output-directory "$build" "$build/$fig.tex" >/dev/null)
  cp "$build/$fig.pdf" "$out/$fig.pdf"
done
"$py" - "$out" <<'PY'
import sys, pathlib, pymupdf
out = pathlib.Path(sys.argv[1])
for pdf in sorted(out.glob("*.pdf")):
    page = pymupdf.open(pdf)[0]
    page.get_pixmap(dpi=300, alpha=False).save(pdf.with_suffix(".png"))
    print(pdf.with_suffix(".png").name, page.rect.width, page.rect.height)
PY
