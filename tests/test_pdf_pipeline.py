"""PDF ingest pipeline — pages, bounding boxes, full text, raw bytes and the
offline (heuristic) reference extraction. All deterministic, no LLM/network."""


def test_pages_expose_blocks_with_valid_bboxes(client, paper_id, pdf_meta):
    r = client.get(f"/api/papers/{paper_id}/pages")
    assert r.status_code == 200
    data = r.json()
    assert data["n_pages"] == pdf_meta["n_pages"]

    pages = data["pages"]
    assert len(pages) == pdf_meta["n_pages"]

    first = pages[0]
    # Page dimensions match the synthesised US-Letter page (in PDF points).
    assert first["width"] == 612.0
    assert first["height"] == 792.0
    assert first["blocks"], "expected extracted text blocks on page 0"

    for block in first["blocks"]:
        x0, y0, x1, y1 = block["bbox"]
        # Boxes are top-left origin, normalised, and inside the page.
        assert x0 < x1 and y0 < y1
        assert 0 <= x0 and x1 <= first["width"]
        assert 0 <= y0 and y1 <= first["height"]
        assert isinstance(block["text"], str)


def test_title_text_is_present_on_first_page(client, paper_id, pdf_meta):
    pages = client.get(f"/api/papers/{paper_id}/pages").json()["pages"]
    page0_text = " ".join(b["text"] for b in pages[0]["blocks"])
    assert pdf_meta["title"] in page0_text


def test_fulltext_contains_title_and_abstract(client, paper_id, pdf_meta):
    r = client.get(f"/api/papers/{paper_id}/fulltext")
    assert r.status_code == 200
    text = r.json()["full_text"]
    assert pdf_meta["title"] in text
    assert pdf_meta["abstract_sentence"] in text


def test_pdf_endpoint_serves_original_bytes(client, paper_id):
    r = client.get(f"/api/papers/{paper_id}/pdf")
    assert r.status_code == 200
    assert r.headers["content-type"] == "application/pdf"
    assert r.content[:5] == b"%PDF-"


def test_references_extracted_offline(client, paper_id):
    r = client.get(f"/api/papers/{paper_id}/references")
    assert r.status_code == 200
    refs = r.json()["references"]
    assert refs, "expected at least one reference from the References section"
    raws = " ".join(ref["raw"] for ref in refs)
    assert "Vaswani" in raws
    # Heuristic extraction only — not yet enriched/resolved against Crossref.
    assert all(ref["resolved"] == 0 for ref in refs)
