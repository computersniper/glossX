"""Files dropped on the explorer or composer, and drag-to-move inside it."""
from pathlib import Path


def ok(response):
    assert response.status_code == 200, response.text
    return response.json()


def test_upload_never_overwrites_and_checkpoints_text(client):
    project = ok(client.post('/api/agent/projects', json={'name': 'Drops'}))
    root = Path(project['workspace']['path'])
    url = f"/api/workspace/{project['id']}/upload"
    first = ok(client.post(url, data={'dir': 'notes'}, files=[('files', ('idea.md', b'# idea\n', 'text/markdown')),
                                                              ('files', ('fig.png', b'\x89PNG\r\n\x1a\n\0\0', 'image/png'))]))
    assert [f['path'] for f in first['files']] == ['notes/idea.md', 'notes/fig.png']
    assert first['files'][0]['checkpoint'] and first['files'][1]['checkpoint'] is None
    again = ok(client.post(url, data={'dir': 'notes'}, files=[('files', ('idea.md', b'second', 'text/markdown'))]))
    assert again['files'][0]['path'] == 'notes/idea (2).md'
    assert (root / 'notes/idea.md').read_text() == '# idea\n'
    # path tricks in the name are reduced to the base name, protected folders refused
    sneaky = ok(client.post(url, files=[('files', ('../../evil.txt', b'x', 'text/plain'))]))
    assert sneaky['files'][0]['path'] == 'evil.txt'
    assert client.post(url, data={'dir': '.git'}, files=[('files', ('a', b'x', 'text/plain'))]).status_code == 400
    assert client.post(url, data={'dir': '../outside'}, files=[('files', ('a', b'x', 'text/plain'))]).status_code == 400


def test_move_file_and_folder(client):
    project = ok(client.post('/api/agent/projects', json={'name': 'Moves'}))
    root = Path(project['workspace']['path'])
    (root / 'a').mkdir()
    (root / 'a' / 'x.txt').write_text('hello')
    (root / 'b').mkdir()
    url = f"/api/workspace/{project['id']}/move"
    moved = ok(client.post(url, json={'path': 'a/x.txt', 'dir': 'b'}))
    assert moved == {'path': 'b/x.txt', 'moved': True}
    assert (root / 'b' / 'x.txt').read_text() == 'hello' and not (root / 'a' / 'x.txt').exists()
    cps = ok(client.get(f"/api/workspace/{project['id']}/checkpoints"))
    paths = {c['path'] for c in (cps.get('checkpoints') if isinstance(cps, dict) else cps)}
    assert {'a/x.txt', 'b/x.txt'} <= paths
    assert ok(client.post(url, json={'path': 'b', 'dir': ''}))['moved'] is False   # already at the root
    assert client.post(url, json={'path': 'b', 'dir': 'b'}).status_code == 400
    assert ok(client.post(url, json={'path': 'b', 'dir': 'a'}))['path'] == 'a/b'
    assert (root / 'a' / 'b' / 'x.txt').exists()
    assert client.post(url, json={'path': 'missing.txt', 'dir': ''}).status_code == 404
