const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../public/paradise.js'), 'utf8');
const networking = source.slice(source.indexOf('    const REQUEST_TIMEOUT_MS'), source.indexOf('    // 천상의 다음 조우'));
const mutations = source.slice(source.indexOf('    async function mutate('), source.indexOf('    function syncPuzzle('));
const visibility = source.split('\n').find(line => line.includes("document.addEventListener('visibilitychange'"));
const snapshot = (phase = 'route', revision = 2) => ({ serverTime: 1000000, revision, runId: 'run-1', run: { id: 'run-1', status: 'active', phase, timer: { paused: !['combat', 'puzzle'].includes(phase), remainingMs: 900000 } }, player: {}, weekly: { week: 'week', resetsAt: 2000000 }, shop: { revision: 3, catalogRevision: 'catalog' }, progression: { revision: 4 } });
const response = (status, result) => ({ status, ok: status >= 200 && status < 300, json: async () => result });
const success = (phase = 'route', revision = 3) => response(200, { ok: true, state: snapshot(phase, revision), message: '완료' });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
async function flush() { for (let i = 0; i < 20; i++) await Promise.resolve(); }
function client(fetchImpl, { reduced = false, hidden = false } = {}) {
    let time = 1000000, timerId = 0, id = 0;
    const timers = new Map(), calls = [], accepted = [], notices = [], listeners = {};
    const context = vm.createContext({
        initial: snapshot(), reduced, document: { hidden, addEventListener: (name, fn) => { listeners[name] = fn; } },
        performance: { now: () => time }, Date: { now: () => time }, AbortController,
        setTimeout(fn, ms) { timers.set(++timerId, { at: time + ms, fn }); return timerId; }, clearTimeout: id => timers.delete(id),
        fetch(url, options) { calls.push({ url, options }); return fetchImpl(url, options, calls); },
        crypto: { randomUUID: () => 'request-00000000-' + (++id) }, location: {},
        announce: message => notices.push(message), sound() {}, fmt: String, syncPuzzle() {},
        renderer: { clearCards() {}, image() {} }, audio: { play() {}, visibility() {} }, battle: { reset() {} },
        window: { ParadiseShop: { purchaseComplete() {} } }, accepted
    });
    vm.runInContext(`
        let state = initial, ranking = null, busy = false, pending = null, selection = null, heavenEntry = null, transition = null,
            battleUntil = 0, regionKey = '', outcomeReveal = null, rewardReveal = null, fall = null, chestPick = null,
            overlay = null, lobbyScroll = 0, chestPage = 0;
        const now = () => Date.now();
        function accept(next) { state = next; selection = null; accepted.push(next); }
        ${networking}\n${mutations}\n${visibility}
        globalThis.api = { mutate, choose, pickRelic, pickRoute, fetchState, pollState, fetchRanking,
            get state() { return state; }, set state(value) { state = value; },
            get pending() { return pending; }, get busy() { return busy; }, get loading() { return stateLoading; },
            get selection() { return selection; } };
    `, context);
    return { api: context.api, context, calls, accepted, notices,
        async advance(ms) {
            const target = time + ms;
            for (;;) {
                const due = [...timers.entries()].filter(([, v]) => v.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
                if (!due) break;
                time = due[1].at; timers.delete(due[0]); due[1].fn(); await flush();
            }
            time = target; await flush();
        },
        async visibility(hidden) { context.document.hidden = hidden; listeners.visibilitychange(); await flush(); }
    };
}

test('HTTP failures, non-JSON and malformed success keep the identical operation for recovery', async t => {
    for (const [name, failed] of [
        ['500 JSON', response(500, { error: 'server' })], ['503 retryable', response(503, { error: 'save', retryable: true })],
        ['429', response(429, { error: 'slow down' })], ['408', response(408, {})],
        ['HTML', { status: 502, ok: false, json: async () => { throw new SyntaxError('html'); } }],
        ['invalid JSON success', response(200, null)], ['empty success', response(200, {})],
        ['malformed state', response(200, { ok: true, state: {} })]
    ]) await t.test(name, async () => {
        let count = 0;
        const c = client(() => Promise.resolve(++count === 1 ? failed : success()));
        await c.api.mutate('route', { choice: 'left' });
        const original = c.api.pending;
        assert.ok(original); assert.equal(c.api.busy, false); assert.equal(c.accepted.length, 0);
        await c.api.mutate('route', { choice: 'right' }); assert.equal(c.calls.length, 1);
        await c.advance(1000);
        assert.equal(c.calls.length, 2); assert.equal(c.calls[1].options.body, c.calls[0].options.body);
        assert.equal(c.api.pending, null); assert.equal(c.accepted.length, 1);
    });
});

test('automatic retries stop after one; manual retry still uses the same ID and body', async () => {
    let count = 0;
    const c = client(() => Promise.resolve(++count <= 2 ? response(503, { error: 'retry' }) : success()));
    await c.api.mutate('route', { choice: 'left' }); await c.advance(1000); await c.advance(60000);
    assert.equal(c.calls.length, 2); assert.ok(c.api.pending); assert.equal(c.api.busy, false);
    await c.api.mutate('ignored', { choice: 'changed' }, true);
    assert.equal(c.calls.length, 3); assert.equal(c.calls[2].url, c.calls[0].url);
    assert.equal(c.calls[2].options.body, c.calls[0].options.body); assert.equal(c.api.pending, null);
});

test('business rejection and stale revision resolve; 401 redirects without retry or clearing pending', async t => {
    for (const status of [400, 409]) await t.test(String(status), async () => {
        const c = client(() => Promise.resolve(response(status, { error: 'rejected', state: snapshot('route', 7) })));
        await c.api.mutate('route', { choice: 'left' }); await c.advance(30000);
        assert.equal(c.api.pending, null); assert.equal(c.api.state.revision, 7); assert.equal(c.calls.length, 1);
    });
    const c = client(() => Promise.resolve(response(401, {})));
    await c.api.mutate('route', { choice: 'left' }); await c.advance(30000);
    assert.equal(c.context.location.href, '/'); assert.ok(c.api.pending); assert.equal(c.calls.length, 1);
});

test('hung response and body parsing time out, unlock and ignore late completion', async t => {
    for (const bodyHangs of [false, true]) await t.test(bodyHangs ? 'body' : 'fetch', async () => {
        const late = deferred(); let count = 0;
        const c = client(() => ++count === 1 ? bodyHangs ? Promise.resolve({ status: 200, ok: true, json: () => late.promise }) : late.promise : Promise.resolve(success()));
        const mutation = c.api.mutate('route', { choice: 'left' }); await flush();
        assert.equal(c.api.busy, true); await c.advance(12000); await mutation;
        assert.equal(c.api.busy, false); assert.equal(c.calls[0].options.signal.aborted, true); assert.ok(c.api.pending);
        await c.advance(1000); assert.equal(c.accepted.length, 1); assert.equal(c.api.pending, null);
        late.resolve(bodyHangs ? { ok: true, state: snapshot('route', 99) } : success('route', 99)); await flush();
        assert.equal(c.accepted.length, 1); assert.equal(c.api.state.revision, 3);
    });
});

test('selection posts immediately, blocks duplicate input, and overlaps rather than adds animation time', async t => {
    for (const [method, duration] of [['choose', 430], ['pickRelic', 420], ['pickRoute', 380]]) await t.test(method, async () => {
        const c = client(url => Promise.resolve(url.endsWith('/ranking') ? response(200, {}) : success()));
        c.api[method]({ id: 'one' }, 0); c.api[method]({ id: 'two' }, 1);
        assert.equal(c.calls.length, 1); assert.equal(c.calls[0].options.method, 'POST'); await flush();
        assert.equal(c.api.busy, true); assert.equal(c.accepted.length, 0);
        await c.advance(duration - 1); assert.equal(c.accepted.length, 0);
        await c.advance(1); assert.equal(c.accepted.length, 1); assert.equal(c.api.busy, false);
    });
    const reply = deferred(), slow = client(() => reply.promise);
    slow.api.pickRoute({ id: 'one' }, 0); await slow.advance(600); reply.resolve(success()); await flush();
    assert.equal(slow.accepted.length, 1); assert.equal(slow.api.busy, false);
    const reduced = client(() => Promise.resolve(success()), { reduced: true });
    reduced.api.pickRoute({ id: 'one' }, 0); await flush(); assert.equal(reduced.accepted.length, 1);
});

test('pre-action GET cannot overwrite the newer mutation result', async () => {
    const old = deferred();
    const c = client((_, options) => options.method === 'POST' ? Promise.resolve(success('route', 8)) : old.promise);
    const read = c.api.fetchState(); await flush(); await c.api.mutate('route', { choice: 'left' });
    old.resolve(response(200, snapshot('relic', 1))); await read;
    assert.equal(c.accepted.length, 1); assert.equal(c.api.state.revision, 8);
});

test('choice polling is 15 seconds, combat/puzzles one second, and hidden tabs do not poll', async () => {
    const c = client(() => Promise.resolve(response(200, snapshot())));
    await c.api.fetchState(); await c.advance(1000); c.api.pollState(); await flush(); assert.equal(c.calls.length, 1);
    await c.advance(14000); c.api.pollState(); await flush(); assert.equal(c.calls.length, 2);
    c.api.state = snapshot('combat'); await c.advance(1000); c.api.pollState(); await flush(); assert.equal(c.calls.length, 3);
    c.api.state = snapshot('puzzle'); await c.advance(1000); c.api.pollState(); await flush(); assert.equal(c.calls.length, 4);
    await c.visibility(true); await c.advance(30000); c.api.pollState(); await flush(); assert.equal(c.calls.length, 4);
    await c.visibility(false); assert.equal(c.calls.length, 5);
});

test('hidden failure defers recovery until visible and does not start a new operation', async () => {
    const first = deferred(); let count = 0;
    const c = client(() => ++count === 1 ? first.promise : Promise.resolve(success()));
    const action = c.api.mutate('route', { choice: 'left' }); await c.visibility(true);
    first.reject(new TypeError('network')); await action; await c.advance(30000); assert.equal(c.calls.length, 1);
    await c.visibility(false); assert.equal(c.calls.length, 2);
    assert.equal(c.calls[0].options.body, c.calls[1].options.body); assert.equal(c.api.pending, null);
});

test('a stalled state read unlocks and retries later without stacking requests', async () => {
    let count = 0;
    const c = client(() => ++count === 1 ? new Promise(() => {}) : Promise.resolve(response(200, snapshot())));
    const read = c.api.fetchState(); await c.api.fetchState(); assert.equal(c.calls.length, 1);
    await c.advance(12000); await read; assert.equal(c.api.loading, false);
    await c.advance(3000); c.api.pollState(); await flush(); assert.equal(c.calls.length, 2); assert.equal(c.accepted.length, 1);
});
