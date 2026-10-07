# GlossX proposal

| File | What it is |
| --- | --- |
| `GlossX_Proposal_overleaf.zip` | Upload to Overleaf (New Project → Upload Project); compiles with pdfLaTeX |
| `GlossX_Proposal.pdf` | Locally compiled LaTeX version (main content = 4 pages) |
| `word/GlossX_Proposal.docx` | Word version with the same content and figures |
| `latex/` | LaTeX sources: `main.tex`, `references.bib`, NeurIPS 2026 style, TikZ figures |
| `tools/` | Scripts that regenerate the figure PNGs and the Word file |

Rename the system by editing `\newcommand{\sysname}{GlossX}` in `latex/main.tex`,
`SYS` in `tools/build_docx.cjs`, and the `\sysname` line in `tools/build_figures.sh`.

Rebuild:

```bash
cd latex && latexmk -pdf main.tex                        # LaTeX PDF
tools/build_figures.sh /path/to/python-with-pymupdf      # word/figures/*.png from the TikZ sources
NODE_PATH=/path/to/node_modules node tools/build_docx.cjs  # needs the `docx` npm package
```

Citation numbers in the Word file follow the bibtex order of the LaTeX build; if you
add references, update `ORDER` in `tools/build_docx.cjs` from `latex/main.bbl`.
