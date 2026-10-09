from __future__ import annotations

import asyncio
import importlib
from pathlib import Path

import pytest


def test_pdf_parser_runs_in_a_killable_worker(pdf_bytes) -> None:
    from app.library import service

    parsed = service.parse_pdf_bytes_with_timeout(pdf_bytes, 10)

    assert parsed["n_pages"] == 2
    assert parsed["pages"]
    assert "sections" in parsed


def test_cancelled_parser_removes_parent_owned_temporary_pdf(
    monkeypatch, pdf_bytes
) -> None:
    from app import platform_support
    from app.library import service

    temporary_path: Path | None = None

    def cancelled(_target, args, _timeout, cancel_event=None):
        nonlocal temporary_path
        assert cancel_event is not None
        temporary_path = Path(args[0])
        assert temporary_path.is_file()
        raise platform_support.ProcessCancelledError("cancelled")

    monkeypatch.setattr(service, "run_in_process_with_timeout", cancelled)

    with pytest.raises(platform_support.ProcessCancelledError):
        service.parse_pdf_bytes_with_timeout(
            pdf_bytes,
            10,
            cancel_event=object(),
        )

    assert temporary_path is not None
    assert not temporary_path.exists()


def test_server_import_timeout_configuration_is_capped_at_300_seconds(
    monkeypatch,
) -> None:
    from app.routers import papers

    monkeypatch.setenv("GLOSS_TEST_IMPORT_BUDGET", "999")

    assert papers._bounded_import_timeout("GLOSS_TEST_IMPORT_BUDGET") == 300


def test_download_timeout_defaults_to_300_seconds(monkeypatch) -> None:
    monkeypatch.delenv("GLOSS_IMPORT_TIMEOUT", raising=False)
    import app.routers.papers as papers

    reloaded = importlib.reload(papers)

    assert reloaded.IMPORT_DOWNLOAD_TIMEOUT == 300


def test_arxiv_pdf_download_does_not_wait_for_optional_metadata(monkeypatch) -> None:
    """A slow Atom endpoint must not consume the PDF's download budget."""
    from app.library import importers

    class FakeResponse:
        content = b"%PDF-fast"

        def raise_for_status(self) -> None:
            return None

    class FakeClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args) -> None:
            return None

        async def get(self, url, **_kwargs):
            if "export.arxiv.org" in url:
                await asyncio.Event().wait()
            assert "/pdf/2504.12369.pdf" in url
            return FakeResponse()

    monkeypatch.setattr(importers, "external_client", lambda **_kwargs: FakeClient())

    async def fetch():
        return await asyncio.wait_for(importers.fetch_arxiv("2504.12369"), timeout=0.2)

    meta, pdf = asyncio.run(fetch())

    assert meta["arxiv_id"] == "2504.12369"
    assert pdf == b"%PDF-fast"


def test_url_import_has_an_end_to_end_download_deadline(
    client, monkeypatch, pdf_bytes
) -> None:
    from app.library import importers
    from app.routers import papers

    cancelled = False

    async def slow_import(_payload):
        nonlocal cancelled
        try:
            await asyncio.sleep(0.1)
        except asyncio.CancelledError:
            cancelled = True
            raise
        return {"source": "url", "title": "too late"}, pdf_bytes

    monkeypatch.setattr(importers, "import_source", slow_import)
    monkeypatch.setattr(papers, "IMPORT_DOWNLOAD_TIMEOUT", 0.01, raising=False)

    response = client.post(
        "/api/papers/import", json={"query": "https://example.com/paper.pdf"}
    )

    assert response.status_code == 504
    assert "timed out" in response.json()["detail"].lower()
    assert cancelled is True


def test_url_import_parse_timeout_does_not_create_a_paper(
    client, monkeypatch, pdf_bytes
) -> None:
    from app.library import importers, service
    from app.routers import papers

    async def downloaded(_payload):
        return {"source": "url", "title": "slow parse"}, pdf_bytes

    def parse_timeout(_pdf, _timeout):
        raise TimeoutError("PDF parsing timed out")

    monkeypatch.setattr(importers, "import_source", downloaded)
    monkeypatch.setattr(
        service,
        "parse_pdf_bytes_with_timeout",
        parse_timeout,
        raising=False,
    )
    monkeypatch.setattr(papers, "IMPORT_PARSE_TIMEOUT", 0.01, raising=False)
    before = {paper["id"] for paper in client.get("/api/papers").json()["papers"]}

    response = client.post(
        "/api/papers/import", json={"query": "https://example.com/paper.pdf"}
    )

    after = {paper["id"] for paper in client.get("/api/papers").json()["papers"]}
    assert response.status_code == 504
    assert "parsing" in response.json()["detail"].lower()
    assert after == before
