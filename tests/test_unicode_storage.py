from __future__ import annotations

import json

from app import config, platform_support
from app.library import service, store


def test_parsed_paper_round_trips_characters_outside_windows_gbk() -> None:
    parsed = {"full_text": "loss = α ∗ β ∑ γ", "pages": [], "n_pages": 0}

    store.save_parsed("unicode-paper", parsed)

    assert store.load_parsed("unicode-paper") == parsed
    assert "∗".encode("utf-8") in store.parsed_path("unicode-paper").read_bytes()


def test_config_round_trips_characters_outside_windows_gbk() -> None:
    marker = "preferred model ∗ provider"

    config.save_config({"unicode_test": marker})

    assert config.load_config()["unicode_test"] == marker
    assert "∗".encode("utf-8") in config.CONFIG_PATH.read_bytes()


def test_parsed_paper_reads_legacy_windows_gbk(monkeypatch) -> None:
    monkeypatch.setattr(platform_support.locale, "getencoding", lambda: "cp936")
    parsed = {"full_text": "旧版中文论文", "pages": [], "n_pages": 0}
    store.parsed_path("legacy-gbk").write_bytes(
        json.dumps(parsed, ensure_ascii=False).encode("gbk")
    )

    assert store.load_parsed("legacy-gbk") == parsed


def test_config_reads_legacy_windows_gbk(monkeypatch) -> None:
    monkeypatch.setattr(platform_support.locale, "getencoding", lambda: "cp936")
    config.CONFIG_PATH.write_bytes('{"output_language":"旧版中文"}'.encode("gbk"))

    assert config.load_config()["output_language"] == "旧版中文"


def test_failed_ingest_removes_partial_paper(monkeypatch) -> None:
    store.init_db()

    def fail_ingest(_path):
        raise UnicodeEncodeError("gbk", "∗", 0, 1, "illegal multibyte sequence")

    monkeypatch.setattr(service.pdf_ingest, "ingest_pdf", fail_ingest)

    try:
        service.create_from_pdf_bytes(
            b"%PDF-placeholder", {"id": "partial-paper", "title": "partial"}
        )
    except UnicodeEncodeError:
        pass
    else:
        raise AssertionError("the simulated ingest failure should propagate")

    assert store.get_paper("partial-paper") is None
    assert not (store.PAPERS_DIR / "partial-paper").exists()
