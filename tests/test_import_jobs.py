from __future__ import annotations

import asyncio
import threading
import time


def _wait_for_job(client, job_id: str, predicate, timeout: float = 5) -> dict:
    deadline = time.monotonic() + timeout
    last = None
    while time.monotonic() < deadline:
        response = client.get("/api/papers/import-jobs")
        assert response.status_code == 200, response.text
        last = next(
            (job for job in response.json()["jobs"] if job["id"] == job_id),
            None,
        )
        if last is not None and predicate(last):
            return last
        time.sleep(0.02)
    raise AssertionError(f"job {job_id} did not reach expected state; last={last!r}")


def test_import_job_returns_immediately_and_can_be_cancelled(
    client, monkeypatch, pdf_bytes
) -> None:
    from app.library import importers

    started = threading.Event()
    cancelled = threading.Event()
    download_calls = 0

    async def blocked_download(_payload):
        nonlocal download_calls
        download_calls += 1
        started.set()
        try:
            while True:
                await asyncio.sleep(1)
        except asyncio.CancelledError:
            cancelled.set()
            raise

    monkeypatch.setattr(importers, "import_source", blocked_download)
    before = {paper["id"] for paper in client.get("/api/papers").json()["papers"]}

    request_started = time.monotonic()
    response = client.post(
        "/api/papers/import-jobs",
        json={"query": "https://example.com/blocked.pdf"},
    )

    assert response.status_code == 202, response.text
    assert time.monotonic() - request_started < 0.5
    job = response.json()
    assert job["query"] == "https://example.com/blocked.pdf"
    assert job["status"] in {"queued", "downloading"}
    assert started.wait(2)

    # This is the same endpoint a freshly mounted Library view calls after
    # navigating away (or refreshing the browser).
    visible = _wait_for_job(client, job["id"], lambda item: item["status"] == "downloading")
    assert visible["progress"] >= 0

    queued_response = client.post(
        "/api/papers/import-jobs",
        json={"query": "https://example.com/queued-behind-it.pdf"},
    )
    assert queued_response.status_code == 202, queued_response.text
    queued_job = _wait_for_job(
        client,
        queued_response.json()["id"],
        lambda item: item["status"] == "queued",
    )
    assert queued_job["progress"] == 0
    assert client.delete(f"/api/papers/import-jobs/{queued_job['id']}").status_code == 200
    assert download_calls == 1

    removed = client.delete(f"/api/papers/import-jobs/{job['id']}")
    assert removed.status_code == 200, removed.text
    assert cancelled.wait(2)
    assert all(
        item["id"] != job["id"]
        for item in client.get("/api/papers/import-jobs").json()["jobs"]
    )
    after = {paper["id"] for paper in client.get("/api/papers").json()["papers"]}
    assert after == before


def test_completed_import_job_can_be_cleared_without_deleting_paper(
    client, monkeypatch, pdf_bytes
) -> None:
    from app.library import importers, service

    async def downloaded(_payload):
        return {"source": "url", "title": "Queued paper"}, pdf_bytes

    def parsed(data, _timeout, cancel_event=None):
        assert cancel_event is not None
        return service._parse_pdf_bytes(data)

    monkeypatch.setattr(importers, "import_source", downloaded)
    monkeypatch.setattr(service, "parse_pdf_bytes_with_timeout", parsed)

    response = client.post(
        "/api/papers/import-jobs",
        json={"query": "https://example.com/queued.pdf"},
    )
    assert response.status_code == 202, response.text
    job = _wait_for_job(
        client,
        response.json()["id"],
        lambda item: item["status"] == "completed",
        timeout=10,
    )
    assert job["progress"] == 100
    assert job["paper_id"]
    assert client.get(f"/api/papers/{job['paper_id']}").status_code == 200

    cleared = client.delete(f"/api/papers/import-jobs/{job['id']}")
    assert cleared.status_code == 200, cleared.text
    assert client.get(f"/api/papers/{job['paper_id']}").status_code == 200
    client.delete(f"/api/papers/{job['paper_id']}")


def test_cancel_during_save_waits_for_cleanup_and_leaves_no_paper(
    client, monkeypatch, pdf_bytes
) -> None:
    from app.library import importers, service, store

    saving = threading.Event()
    created_paper_id: list[str] = []

    async def downloaded(_payload):
        return {"source": "url", "title": "Cancel me"}, pdf_bytes

    def parsed(_data, _timeout, cancel_event=None):
        assert cancel_event is not None
        return {
            "n_pages": 0,
            "pages": [],
            "sections": [],
            "toc": [],
            "full_text": "",
            "meta": {},
        }

    def slow_save(_data, meta, _parsed, cancel_event=None):
        assert cancel_event is not None
        paper_id = store.create_paper({**meta, "n_pages": 0})
        created_paper_id.append(paper_id)
        saving.set()
        deadline = time.monotonic() + 5
        while not cancel_event.is_set() and time.monotonic() < deadline:
            time.sleep(0.01)
        return store.get_paper(paper_id)

    monkeypatch.setattr(importers, "import_source", downloaded)
    monkeypatch.setattr(service, "parse_pdf_bytes_with_timeout", parsed)
    manager = client.app.state.import_jobs

    async def persist(job, data, meta, parsed_data):
        paper = await asyncio.to_thread(
            slow_save, data, meta, parsed_data, job.cancel_event
        )
        job.paper_id = paper["id"]
        return paper

    monkeypatch.setattr(manager, "_persist", persist)

    response = client.post(
        "/api/papers/import-jobs",
        json={"query": "https://example.com/cancel-save.pdf"},
    )
    assert response.status_code == 202, response.text
    assert saving.wait(3)

    cancelled = client.delete(f"/api/papers/import-jobs/{response.json()['id']}")
    assert cancelled.status_code == 200, cancelled.text
    assert created_paper_id
    assert client.get(f"/api/papers/{created_paper_id[0]}").status_code == 404


def test_cleanup_failure_keeps_job_and_paper_id_for_retry(
    client, monkeypatch, pdf_bytes
) -> None:
    from app.library import importers, service, store

    saving = threading.Event()
    original_delete = store.delete_paper

    async def downloaded(_payload):
        return {"source": "url", "title": "Retry cleanup"}, pdf_bytes

    def parsed(_data, _timeout, cancel_event=None):
        return {
            "n_pages": 0,
            "pages": [],
            "sections": [],
            "toc": [],
            "full_text": "",
            "meta": {},
        }

    def slow_save(_data, meta, _parsed, cancel_event=None):
        paper_id = store.create_paper({**meta, "n_pages": 0})
        saving.set()
        while not cancel_event.is_set():
            time.sleep(0.01)
        return store.get_paper(paper_id)

    def failed_delete(_paper_id):
        raise OSError("simulated locked file")

    monkeypatch.setattr(importers, "import_source", downloaded)
    monkeypatch.setattr(service, "parse_pdf_bytes_with_timeout", parsed)
    manager = client.app.state.import_jobs

    async def persist(job, data, meta, parsed_data):
        paper = await asyncio.to_thread(
            slow_save, data, meta, parsed_data, job.cancel_event
        )
        job.paper_id = paper["id"]
        return paper

    monkeypatch.setattr(manager, "_persist", persist)
    monkeypatch.setattr(store, "delete_paper", failed_delete)

    response = client.post(
        "/api/papers/import-jobs",
        json={"query": "https://example.com/retry-cleanup.pdf"},
    )
    job_id = response.json()["id"]
    assert saving.wait(3)

    failed_cancel = client.delete(f"/api/papers/import-jobs/{job_id}")
    assert failed_cancel.status_code == 500
    retained = _wait_for_job(client, job_id, lambda item: item["status"] == "failed")
    assert retained["paper_id"]
    assert "cleanup" in retained["error"].lower()

    # Cleanup-pending jobs are recovery records, not disposable history. Even
    # an aggressive terminal-history prune must retain the paper id.
    manager.max_terminal_jobs = 0
    rollover = client.post(
        "/api/papers/import-jobs",
        json={"query": "https://example.com/rollover.pdf"},
    )
    assert rollover.status_code == 202, rollover.text
    visible_ids = {
        item["id"]
        for item in client.get("/api/papers/import-jobs").json()["jobs"]
    }
    assert job_id in visible_ids

    monkeypatch.setattr(store, "delete_paper", original_delete)
    manager.max_terminal_jobs = 20
    assert client.delete(
        f"/api/papers/import-jobs/{rollover.json()['id']}"
    ).status_code == 200
    retried = client.delete(f"/api/papers/import-jobs/{job_id}")
    assert retried.status_code == 200, retried.text
    assert client.get(f"/api/papers/{retained['paper_id']}").status_code == 404


def test_importer_metadata_id_cannot_overwrite_or_delete_existing_paper(
    client, monkeypatch, pdf_bytes
) -> None:
    from app.library import importers, service, store

    existing_id = "existing-importer-id"
    if store.get_paper(existing_id):
        store.delete_paper(existing_id)
    store.create_paper({"id": existing_id, "title": "Keep me", "source": "test"})

    async def downloaded(_payload):
        return {
            "id": existing_id,
            "source": "url",
            "title": "New queued paper",
        }, pdf_bytes

    def parsed(data, _timeout, cancel_event=None):
        return service._parse_pdf_bytes(data)

    monkeypatch.setattr(importers, "import_source", downloaded)
    monkeypatch.setattr(service, "parse_pdf_bytes_with_timeout", parsed)

    try:
        response = client.post(
            "/api/papers/import-jobs",
            json={"query": "https://example.com/id-collision.pdf"},
        )
        job = _wait_for_job(
            client,
            response.json()["id"],
            lambda item: item["status"] in {"completed", "failed"},
            timeout=10,
        )
        assert job["status"] == "completed", job
        assert job["paper_id"] != existing_id
        assert client.get(f"/api/papers/{existing_id}").json()["title"] == "Keep me"
    finally:
        if 'job' in locals() and job.get("paper_id"):
            client.delete(f"/api/papers/{job['paper_id']}")
            client.delete(f"/api/papers/import-jobs/{job['id']}")
        if store.get_paper(existing_id):
            store.delete_paper(existing_id)
