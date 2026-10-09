# Tests

Tests for Gloss. Most drive the app through its public HTTP API (`/api/*`), the
same surface used by the web UI and CLI. Small unit tests cover platform-specific
paths, command resolution, and launchers. API tests start FastAPI in-process with
`TestClient`, upload a synthesised PDF, and check end-to-end behaviour.

## Layout

| File | Covers |
| --- | --- |
| `conftest.py` | Harness: data-dir isolation, sample-PDF + `client` fixtures, marker gating |
| `test_health_and_settings.py` | `/api/health`, settings round-trip, API-key masking |
| `test_papers_lifecycle.py` | upload / list / get / patch / delete, 404s, non-PDF rejection |
| `test_pdf_pipeline.py` | pages + bounding boxes, full text, raw PDF bytes, offline reference extraction |
| `test_highlights.py` | manual highlight create / list / patch / delete |
| `test_chats.py` | chat-session create / list, empty message history |
| `test_skills.py` | skill discovery, run guards (unknown id, missing id) |
| `test_validation.py` | 4xx (never 5xx) on malformed requests |
| `test_llm_endpoints.py` | *(gated)* summarize / notes / mind-map / explain / translate / chat / auto-highlight |
| `test_network_endpoints.py` | *(gated)* scholar search, reference resolution |
| `test_platform_support.py` | Windows/Linux data paths and local CLI command resolution |
| `test_cross_platform_entrypoints.py` | npm/Bun entrypoints and native wrappers |

## Isolation

`GLOSS_DATA_DIR` is pointed at a fresh temp directory **before the app is
imported**, so the SQLite DB, uploaded PDFs and `config.json` all live in a
throwaway location — the real user library is never touched.

## Running

```bash
# Linux, from the repo root:
backend/.venv/bin/python -m pytest -v

# Windows PowerShell:
backend\.venv\Scripts\python.exe -m pytest -v

# Or on either platform (also rebuilds the frontend):
npm test

# Deterministic tests only run by default. To also exercise the provider-backed
# and network-backed endpoints:
GLOSS_TEST_LLM=1 backend/.venv/bin/python -m pytest -v          # needs a working LLM provider
GLOSS_TEST_NETWORK=1 backend/.venv/bin/python -m pytest -v      # needs external network
```

Only `pytest` is an extra dependency (`tests/requirements.txt`); everything else
(`fastapi`, `httpx`, `pymupdf`) comes from `backend/requirements.txt`.

## CI

`.github/workflows/ci.yml` runs the deterministic subset on Windows and Linux
for every push/PR (no provider, no API key, no network), plus a frontend build. The gated
`llm` / `network` tests stay skipped in CI.
