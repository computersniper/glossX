"""Engine boundaries and approvals without requiring an installed browser."""
import asyncio
from contextlib import asynccontextmanager
from types import SimpleNamespace

import pytest

from app.harness.browser.engine import BrowserManager, BrowserSession, Page
from app.harness.browser.cdp import CDPError
from app.harness.browser.tools import capabilities, handler
from app.harness import settings


class Sessions:
    def _rt(self, sid):
        if sid == 'missing':
            raise LookupError('Unknown session')
        return SimpleNamespace(session={'project_id': None}, emit=lambda *args: None)


def test_seventeen_tools_and_sensitive_categories():
    tools = capabilities()
    assert len(tools) == 17
    assert len({tool.name for tool in tools}) == 17
    assert {tool.meta['tool'] for tool in tools if tool.meta['always_ask']} == {
        'browser_download', 'browser_import_paper'
    }
    assert all(not tool.meta['parallel_safe'] for tool in tools)


@pytest.mark.parametrize('mode', ['ask', 'plan'])
@pytest.mark.parametrize('name', ['browser_download', 'browser_import_paper'])
def test_readonly_modes_cannot_enable_browser_writes_with_allow_rules(mode, name):
    from app.harness.permissions import decide
    from app.harness.tools import ToolSpec
    spec = ToolSpec(name=name, description='', parameters={}, category='browser', handler=None,
                    always_ask=True, primary_arg='url')
    decision, reason = decide(spec, {'url': 'https://public.example/paper.pdf'}, mode,
                              {'permissions': {'allow': ['browser_*']}})
    assert decision == 'unavailable'


@pytest.mark.parametrize('mode', ['ask', 'plan'])
@pytest.mark.parametrize('action,args', [
    ('type', {'ref': 'e1', 'text': 'private', 'submit': True}),
    ('press', {'key': 'Enter'}),
    ('type', {'ref': 'e1', 'text': 'password'}),
    ('click', {'ref': 'e1'}),
])
def test_sensitive_dynamic_actions_are_readonly_mode_errors(mode, action, args):
    manager = BrowserManager(Sessions())

    @asynccontextmanager
    async def operation(*args, **kwargs):
        yield None, None

    async def element(*args):
        return {'password': True, 'submit': True}

    manager.operation = operation
    manager.element = element
    runtime = SimpleNamespace(manager=SimpleNamespace(browser=manager), id='s')
    ctx = SimpleNamespace(runtime=runtime, mode=mode, settings={}, call={})
    with pytest.raises(ValueError, match='sends data'):
        asyncio.run(handler(action)(args, ctx))


def test_takeover_blocks_agent_but_allows_explicit_user_and_serializes_context():
    async def check():
        manager = BrowserManager(Sessions())
        state = BrowserSession('context')
        page = Page('page', 'cdp', 'context')
        state.pages['page'] = page
        state.active = 'page'
        state.controlling = 'user'
        manager.states['s'] = state
        leases = []
        manager.browser = SimpleNamespace(acquire=lambda: leases.append(1), release=lambda: leases.pop())

        async def start():
            pass

        manager.start = start
        with pytest.raises(CDPError, match='user is controlling'):
            async with manager.operation('s'):
                pytest.fail('Agent acquired user-controlled page')
        async with manager.operation('s', user=True) as (_, actual):
            assert actual is page
        assert not leases
        with pytest.raises(LookupError):
            async with manager.operation('missing'):
                pytest.fail('Unknown session was admitted')
    asyncio.run(check())


def test_doi_import_reuses_importer_and_guarded_fetch(monkeypatch):
    from app.library import service
    from app.agent import projects
    manager = BrowserManager(Sessions())
    urls = []

    async def fetch(url):
        urls.append(url)
        if url.startswith('https://api.crossref.org/'):
            return (b'{"message":{"title":["DOI paper"],"author":[{"given":"A","family":"B"}],'
                    b'"link":[{"content-type":"application/pdf","URL":"https://public.example/paper.pdf"}]}}',
                    url, 'application/json')
        return b'%PDF-test', url, 'application/pdf'

    def create(data, meta):
        assert data == b'%PDF-test'
        assert meta['doi'] == '10.1234/test'
        assert meta['authors'] == ['A B']
        return {'id': 'paper', 'title': meta['title']}

    manager.fetch = fetch
    monkeypatch.setattr(service, 'create_from_pdf_bytes', create)
    monkeypatch.setattr(projects, 'ensure_paper_project_quietly', lambda paper: None)
    result = asyncio.run(manager.import_paper('s', 'https://doi.org/10.1234/test', Page('p', 'c', 'ctx')))
    assert result['paper_id'] == 'paper'
    assert urls == ['https://api.crossref.org/works/10.1234/test', 'https://public.example/paper.pdf']


def test_pending_settings_do_not_relax_active_network_policy(monkeypatch):
    manager = BrowserManager(Sessions())
    manager._applied_options = {'path': None, 'headed': False, 'allow_private': False}
    monkeypatch.setattr(settings, 'load_global', lambda: {'browser': {'path': '/new', 'headed': True, 'allow_private': True, 'navigation_budget': 10}})
    assert manager.options()['allow_private'] is False
    assert manager.options()['headed'] is False
    assert manager.options()['navigation_budget'] == 10


@pytest.mark.parametrize('resource', ['Document', 'Image', 'Script', 'XHR', 'Other'])
def test_fetch_interception_guards_every_resource_and_redirect(resource):
    manager = BrowserManager(Sessions())
    state = BrowserSession('ctx')
    page = Page('p', 'cdp', 'ctx')
    calls = []

    async def call(page, method, params):
        calls.append(method)

    manager.call = call
    manager.options = lambda: {'allow_private': False}
    asyncio.run(manager._request('s', state, page, {
        'requestId': 'unsafe', 'resourceType': resource,
        'request': {'url': 'http://169.254.169.254/latest/meta-data'},
    }))
    assert calls == ['Fetch.failRequest']


def test_navigation_budget_is_enforced_without_continuing_extra_document():
    manager = BrowserManager(Sessions())
    state = BrowserSession('ctx')
    page = Page('p', 'cdp', 'ctx')
    calls = []

    async def call(page, method, params):
        calls.append(method)

    manager.call = call
    manager.options = lambda: {'allow_private': False, 'navigation_budget': 1}

    async def run():
        for _ in range(2):
            await manager._request('s', state, page, {
                'requestId': 'document', 'resourceType': 'Document',
                'request': {'url': 'https://1.1.1.1/'},
            })
    asyncio.run(run())
    assert calls == ['Fetch.continueRequest', 'Fetch.failRequest']


def test_refs_cannot_be_reused_between_pages_or_sessions():
    first = Page('p1', 's1', 'ctx1')
    second = Page('p2', 's2', 'ctx2')
    nodes = [{'nodeId': '1', 'backendDOMNodeId': 10, 'role': {'value': 'button'}, 'name': {'value': 'Continue'}}]
    a = first.refs.render(nodes)
    b = second.refs.render(nodes)
    import re
    ref_a = re.search(r'\[(e\d+)\]', a['text']).group(1)
    ref_b = re.search(r'\[(e\d+)\]', b['text']).group(1)
    assert ref_a != ref_b
    with pytest.raises(ValueError):
        second.refs.resolve(ref_a)


def test_proxy_does_not_connect_to_mixed_or_rebound_private_addresses(monkeypatch):
    import socket
    from app.harness.browser import proxy

    async def resolve(host, port):
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, '', (ip, port))
                for ip in ['93.184.216.34', '127.0.0.1']]

    async def forbidden_connect(*args, **kwargs):
        pytest.fail('Private/mixed DNS result reached the socket')

    monkeypatch.setattr(proxy, 'resolve_addresses', resolve)
    monkeypatch.setattr(asyncio, 'open_connection', forbidden_connect)
    with pytest.raises(ValueError, match='Private network'):
        asyncio.run(proxy.GuardProxy()._connect('public.example', 443))


@pytest.mark.parametrize('cancel', [False, True])
def test_startup_stderr_and_cancellation_cleanup_without_disabling_sandbox(tmp_path, monkeypatch, cancel):
    from app.harness.browser import process as module
    from app.harness.browser import job
    from app.harness.browser.discovery import BrowserExecutable
    import os
    commands = []
    stopped = []

    class Job:
        def assign(self, pid):
            pass

        def close(self):
            stopped.append('job')

    async def check():
        launched = asyncio.Event()
        reader = asyncio.StreamReader()
        reader.feed_data(b'Chromium sandbox initialization failed\n')
        reader.feed_eof()
        child = SimpleNamespace(pid=99999999, returncode=None if cancel else -6, stderr=reader)

        async def spawn(*args, **kwargs):
            commands.extend(args)
            assert kwargs['stderr'] == asyncio.subprocess.PIPE
            launched.set()
            return child

        async def terminate(actual):
            assert actual is child
            stopped.append('process')
            child.returncode = -9

        monkeypatch.setattr(module.asyncio, 'create_subprocess_exec', spawn)
        monkeypatch.setattr(module, 'terminate_process_tree', terminate)
        monkeypatch.setattr(module, 'discover', lambda path: BrowserExecutable('Chromium', tmp_path / 'chromium'))
        monkeypatch.setattr(job, 'BrowserJob', Job)
        monkeypatch.setattr(os, 'killpg', lambda *args: None, raising=False)
        browser = module.BrowserProcess(tmp_path)
        task = asyncio.create_task(browser.start())
        await launched.wait()
        if cancel:
            task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await task
        else:
            with pytest.raises(CDPError, match='sandbox initialization failed'):
                await task
        assert browser.process is None
        assert browser.client is None
        assert 'process' in stopped
        assert '--no-sandbox' not in commands
    asyncio.run(check())


def test_cancelled_page_initialization_removes_paused_target_and_partial_state():
    async def check():
        manager = BrowserManager(Sessions())
        state = BrowserSession('ctx')
        manager.states['s'] = state
        entered = asyncio.Event()
        closed = []

        async def call(method, params):
            if method == 'Target.createTarget':
                manager._target_sessions['page'] = 'cdp'
                manager._target_contexts['page'] = 'ctx'
                return {'targetId': 'page'}
            if method == 'Target.closeTarget':
                closed.append(params['targetId'])
            return {}

        async def configure(*args):
            entered.set()
            await asyncio.Event().wait()

        manager._client = SimpleNamespace(call=call)
        manager._configure_page = configure
        task = asyncio.create_task(manager._new_page('s', state))
        await entered.wait()
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert closed == ['page']
        assert not state.pages
        assert state.active is None
        assert not manager._creating_contexts
    asyncio.run(check())


def test_cancelled_operation_releases_lease_and_session_lock():
    async def check():
        manager = BrowserManager(Sessions())
        state = BrowserSession('ctx')
        state.pages['page'] = Page('page', 'cdp', 'ctx')
        state.active = 'page'
        manager.states['s'] = state
        leases = []
        entered = asyncio.Event()
        manager.browser = SimpleNamespace(acquire=lambda: leases.append(1), release=lambda: leases.pop())

        async def start():
            pass

        async def evaluate(*args):
            entered.set()
            await asyncio.Event().wait()

        manager.start = start
        manager.evaluate = evaluate
        task = asyncio.create_task(manager.action('s', 'read', {}))
        await entered.wait()
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert not leases
        assert not state.lock.locked()
    asyncio.run(check())
