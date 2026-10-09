"""Manual highlight CRUD — user-created annotations, no LLM involved."""


def _make_highlight(client, paper_id, **overrides):
    body = {
        "page": 0,
        "rects": [[72.0, 72.0, 300.0, 90.0]],
        "text": "Attention",
        "color": "yellow",
    }
    body.update(overrides)
    return client.post(f"/api/papers/{paper_id}/highlights", json=body)


def test_highlight_create_list_patch_delete(client, paper_id):
    # Starts empty.
    assert client.get(f"/api/papers/{paper_id}/highlights").json()["highlights"] == []

    created = _make_highlight(client, paper_id)
    assert created.status_code == 200, created.text
    hl = created.json()
    hid = hl["id"]
    assert hl["page"] == 0
    assert hl["color"] == "yellow"
    assert hl["kind"] == "user"

    # Appears in the list.
    listed = client.get(f"/api/papers/{paper_id}/highlights").json()["highlights"]
    assert [h["id"] for h in listed] == [hid]

    # Patch a field.
    patched = client.patch(f"/api/highlights/{hid}", json={"color": "green"})
    assert patched.status_code == 200
    after = client.get(f"/api/papers/{paper_id}/highlights").json()["highlights"][0]
    assert after["color"] == "green"

    # Delete it.
    assert client.delete(f"/api/highlights/{hid}").status_code == 200
    assert client.get(f"/api/papers/{paper_id}/highlights").json()["highlights"] == []


def test_highlight_requires_page_and_rects(client, paper_id):
    r = client.post(f"/api/papers/{paper_id}/highlights", json={"text": "x"})
    assert r.status_code == 422


def test_freehand_drawing_create_list_delete(client, paper_id):
    created = client.post(
        f"/api/papers/{paper_id}/drawings",
        json={
            "page": 1,
            "points": [[10.5, 20.0], [11.5, 21.0], [14.0, 25.0]],
            "color": "#ef6b6b",
            "width": 4,
            "tool": "pencil",
        },
    )
    assert created.status_code == 200, created.text
    drawing = created.json()
    assert drawing["points"][1] == [11.5, 21.0]
    assert drawing["width"] == 4
    assert drawing["tool"] == "pencil"

    listed = client.get(f"/api/papers/{paper_id}/drawings")
    assert listed.status_code == 200
    assert [item["id"] for item in listed.json()["drawings"]] == [drawing["id"]]

    assert client.delete(f"/api/drawings/{drawing['id']}").status_code == 200
    assert client.get(f"/api/papers/{paper_id}/drawings").json()["drawings"] == []


def test_freehand_drawing_validates_points(client, paper_id):
    response = client.post(
        f"/api/papers/{paper_id}/drawings",
        json={"page": 0, "points": [[10, 20]], "width": 3},
    )
    assert response.status_code == 422


def test_freehand_drawing_validates_tool(client, paper_id):
    response = client.post(
        f"/api/papers/{paper_id}/drawings",
        json={
            "page": 0,
            "points": [[10, 20], [11, 21]],
            "width": 3,
            "tool": "spray",
        },
    )
    assert response.status_code == 422


def test_personal_note_round_trip(client, paper_id):
    empty = client.get(f"/api/papers/{paper_id}/personal-note")
    assert empty.status_code == 200
    assert empty.json()["content"] == ""

    saved = client.put(
        f"/api/papers/{paper_id}/personal-note",
        json={"content": "## My idea\nCompare the ablation again."},
    )
    assert saved.status_code == 200
    assert saved.json()["updated_at"]
    assert client.get(f"/api/papers/{paper_id}/personal-note").json()["content"].startswith("## My idea")
