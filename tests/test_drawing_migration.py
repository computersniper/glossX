"""Regression coverage for legacy drawing records created before brush types."""

import sqlite3

from app.library import store


def test_init_db_adds_pen_tool_to_legacy_drawings(tmp_path, monkeypatch):
    db_path = tmp_path / "legacy.db"
    with sqlite3.connect(db_path) as connection:
        connection.execute(
            """CREATE TABLE drawings (
                id TEXT PRIMARY KEY,
                paper_id TEXT,
                page INTEGER,
                points TEXT,
                color TEXT,
                width REAL,
                note TEXT,
                created_at REAL
            )"""
        )
        connection.execute(
            """INSERT INTO drawings
               (id,paper_id,page,points,color,width,note,created_at)
               VALUES ('legacy','paper-1',0,'[[1,2],[3,4]]','#123456',3,'',1)"""
        )

    monkeypatch.setattr(store, "DB_PATH", db_path)
    store.init_db()

    with sqlite3.connect(db_path) as connection:
        columns = [row[1] for row in connection.execute("PRAGMA table_info(drawings)")]
        tool = connection.execute(
            "SELECT tool FROM drawings WHERE id='legacy'"
        ).fetchone()[0]

    assert "tool" in columns
    assert tool == "pen"
