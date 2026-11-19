const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { requestTiming, measureWork, waitFor, instrumentDynamo } = require('../paradise_timing');

function fixture({ advance = false, viewFailOnce = false, saveFailOnce = false, settlement = () => new Promise(() => {}) } = {}) {
    const user = { id: 'private-id', name: 'private-name', field: { paradise: true }, paradise: { id: 'private-run', status: 'active', phase: 'augment', revision: 0, resources: { hp: 10, mp: 10 } } };
    const counts = { mutations: 0, writes: 0, weekly: 0, scheduled: 0 };
    const commits = [], routes = new Map();
    let tail = Promise.resolve();
    const corridor = {
        active: () => true, forceReturnOutdated: () => false, advanceTime: () => false, rebalanceEnemy: () => false, normalizeAugmentOffer: () => false, normalizeRelicOffer: () => false,
        rerollAugment() { counts.mutations++; return { message: 'done' }; },
        view() {
            if (viewFailOnce) { viewFailOnce = false; throw Error('presentation failed'); }
            return { ticket: { name: 'ticket' }, progression: {}, weeklyRewards: { participation: [], ranks: [] }, hell: { keys: [] }, player: {}, run: null };
        }
    };
    const rpg = {
        getRPGUserByName: async () => user,
        enqueueFieldAction(seed, run) { const result = tail.then(run); tail = result.catch(() => {}); return result; },
        advanceParadiseCombat: () => advance,
        commitProtectedUserChange: async (latest, keys) => { if (saveFailOnce) { saveFailOnce = false; throw Error('save failed'); } counts.writes++; commits.push({ latest: structuredClone(latest), keys }); },
        calculateUserStats: () => ({}), calculateCardSlotEffects: () => ({}), getDataCache: () => []
    };
    const modules = {
        './paradise': corridor, './paradise_hell': { normalizeChestSelection: () => false }, './public/combat-effects': {},
        './paradise_progression': { TOKEN: 'token' }, './paradise_shop': { view: () => ({}) }, './paradise_timing': { requestTiming },
        './paradise_rewards': { startWeeklyRewards() { counts.scheduled++; }, settleWeekly() { counts.weekly++; return settlement(); } }
    };
    const context = { module: { exports: {} }, require: name => { assert.ok(modules[name], name); return modules[name]; }, console: { error() {} }, structuredClone };
    vm.runInNewContext(fs.readFileSync(require.resolve('../paradise_web'), 'utf8'), context);
    const register = method => (path, ...handlers) => routes.set(method + path, handlers.at(-1));
    context.module.exports.registerParadiseRoutes({ get: register('GET'), post: register('POST') }, { rpgenius: rpg, requireUser() {}, getSession() {}, serializeCard: () => ({}), getCharacterSprite: () => '', getMonsterSprite: () => '', getEquipmentIconUrl: () => '', getItemIconUrl: () => '' });
    async function request(method = 'POST', overrides = {}) {
        let status = 200, payload;
        const headers = {};
        const req = { session: { name: user.name }, body: { requestId: 'private-request-0000000001', revision: 0, runId: user.paradise.id, choice: 'choice', ...overrides } };
        const res = { status: value => (status = value, res), json: value => (payload = value, res), setHeader: (name, value) => { headers[name] = value; } };
        await routes.get(method + '/api/paradise' + (method === 'POST' ? '/reroll' : ''))(req, res);
        return { status, payload, headers };
    }
    return { request, counts, commits, user };
}

test('interactive reroll never waits for global settlement, and concurrent receipt replay stays idempotent', { timeout: 2000 }, async () => {
    const f = fixture();
    const results = await Promise.all([f.request(), f.request()]);
    assert.deepEqual(results.map(result => result.status), [200, 200]);
    assert.deepEqual(f.counts, { mutations: 1, writes: 1, weekly: 0, scheduled: 1 });
    assert.equal(f.commits[0].latest.paradiseReceipt.id, 'private-request-0000000001');
    assert.ok(f.commits[0].keys.includes('paradiseReceipt'));
    assert.match(results[0].headers['Server-Timing'], /load;dur=\d+\.\d, queue;dur=\d+\.\d/);
    for (const stage of ['reload', 'advance', 'action', 'save', 'state', 'total']) assert.match(results[0].headers['Server-Timing'], new RegExp(stage + ';dur='));
});

test('a failing settlement service cannot turn a valid action into a retryable error', async () => {
    const f = fixture({ settlement() { throw Error('weekly service unavailable'); } });
    assert.equal((await f.request()).status, 200);
    assert.equal(f.counts.weekly, 0);
});

test('combat advancement and action writes retain their existing order and durable boundaries', async () => {
    const f = fixture({ advance: true });
    const result = await f.request();
    assert.equal(result.status, 200);
    assert.match(result.headers['Server-Timing'], /advance_compute;dur=/);
    assert.match(result.headers['Server-Timing'], /advance_save;dur=/);
    assert.equal(f.commits.length, 2);
    assert.equal(f.commits[0].latest.paradiseReceipt, undefined);
    assert.equal(f.commits[1].latest.paradiseReceipt.action, 'reroll');
});

test('post-commit presentation failure returns retryable 503 and replay does not duplicate mutation', async () => {
    const f = fixture({ viewFailOnce: true });
    const failed = await f.request();
    assert.equal(failed.status, 503);
    assert.equal(failed.payload.retryable, true);
    assert.match(failed.headers['Server-Timing'], /state;dur=/);
    assert.equal((await f.request()).status, 200);
    assert.equal(f.counts.mutations, 1);
    assert.equal(f.counts.writes, 1);
});

test('protected save failures remain retryable and are timed, never acknowledged as success', async () => {
    const f = fixture({ saveFailOnce: true });
    const result = await f.request();
    assert.equal(result.status, 503);
    assert.equal(result.payload.retryable, true);
    assert.match(result.headers['Server-Timing'], /save;dur=/);
    assert.equal(f.counts.writes, 0);
});

test('stale revisions and GET views retain behavior with request-local timing', async () => {
    const f = fixture();
    const stale = await f.request('POST', { revision: 9 });
    assert.equal(stale.status, 409);
    assert.equal(stale.payload.stale, true);
    assert.equal(f.counts.mutations, 0);
    const result = await f.request('GET');
    assert.equal(result.status, 200);
    assert.equal(result.headers['Cache-Control'], 'no-store');
    assert.match(result.headers['Server-Timing'], /state;dur=/);
    assert.doesNotMatch(result.headers['Server-Timing'], /private|action;|save;/);
});

test('timings use a monotonic clock and slow logs contain no response or user data', async () => {
    let now = 0;
    const logs = [], timers = new Set();
    const context = { module: { exports: {} }, process,
        require: name => name === 'node:perf_hooks' ? { performance: { now: () => now, eventLoopUtilization: start => ({ active: 0, idle: now - (start?.idle || 0) }) } } : require(name),
        console: { warn: (...args) => logs.push(args) },
        setInterval(fn) { const timer = { fn, unref() {} }; timers.add(timer); return timer; }, clearInterval: timer => timers.delete(timer)
    };
    vm.runInNewContext(fs.readFileSync(require.resolve('../paradise_timing'), 'utf8'), context);
    const timing = context.module.exports.requestTiming('reroll'), headers = {};
    const payload = { name: 'private-name', requestId: 'private-request', secret: 'private-secret' };
    timing.measure('state', () => { now += 25; });
    await assert.rejects(timing.measureAsync('save', async () => { now += 1200; throw Error('private-error'); }), /private-error/);
    const res = { setHeader: (key, value) => { headers[key] = value; }, status: value => (assert.equal(value, 503), res), json: value => (assert.equal(value, payload), res) };
    timing.send(res, 503, payload);
    assert.equal(headers['Server-Timing'], 'state;dur=25.0, save;dur=1200.0, total;dur=1225.0');
    assert.equal(logs.length, 1);
    assert.doesNotMatch(JSON.stringify(logs), /private/);
    const log = JSON.parse(logs[0][1]);
    assert.deepEqual(log.durations, { state: 25, save: 1200, total: 1225 });
    assert.equal(log.trace, headers['X-Paradise-Trace']);
    assert.equal(log.runtime.ms, 1225);
    assert.equal(timers.size, 0);

    const response = new EventEmitter();
    let release;
    const background = context.module.exports.measureWork('user_flush', () => context.module.exports.measureWork('dynamodb', () => new Promise(resolve => { release = resolve; })));
    const pending = context.module.exports.requestTiming('attack', response);
    const joined = pending.measureAsync('advance_save', () => context.module.exports.waitFor('flush_wait', background));
    response.emit('close');
    assert.equal(JSON.parse(logs.at(-1)[1]).event, 'disconnect');
    const timer = [...timers][0];
    for (let i = 0; i < 6; i++) { now += 10000; timer.fn(); }
    assert.deepEqual(JSON.parse(logs.at(-1)[1]).active.map(work => work.name).sort(), ['dynamodb', 'flush_wait', 'user_flush']);
    assert.equal(timers.size, 0, 'a disconnected request cannot log forever');
    assert.equal(logs.filter(([tag]) => tag === '[paradise pending]').length, 6);
    release(); await joined;
    pending.send(res, 503, payload);

    const httpResponse = new EventEmitter();
    httpResponse.statusCode = 200;
    httpResponse.getHeader = name => name === 'Content-Type' ? 'video/mp4; private-secret' : name === 'Content-Length' ? '5242880' : undefined;
    context.module.exports.httpTiming({ method: 'GET', route: { path: '/api/example/:id' }, path: '/api/example/private-id', query: { secret: 'private-secret' } }, httpResponse, () => { now += 1500; });
    httpResponse.emit('finish'); httpResponse.emit('close');
    const httpLogs = logs.filter(([tag]) => tag === '[http timing]');
    assert.equal(httpLogs.length, 1);
    assert.equal(JSON.parse(httpLogs[0][1]).route, '/api/example/:id');
    assert.equal(JSON.parse(httpLogs[0][1]).ms, 1500);
    assert.equal(JSON.parse(httpLogs[0][1]).responseType, 'video');
    assert.equal(JSON.parse(httpLogs[0][1]).responseBytes, 5242880);
    assert.doesNotMatch(JSON.stringify(httpLogs), /private/);

    const disconnected = new EventEmitter();
    disconnected.statusCode = 200;
    disconnected.getHeader = () => undefined;
    context.module.exports.httpTiming({ method: 'POST', route: { path: '/api/paradise/attack' } }, disconnected, () => { now += 12000; });
    disconnected.destroyed = true; disconnected.emit('close');
    const outerTrace = JSON.parse(logs.at(-1)[1]).trace;
    assert.equal(JSON.parse(logs.at(-1)[1]).responseBytes, undefined);
    const late = context.module.exports.requestTiming('attack', disconnected);
    assert.equal(late.trace, outerTrace, 'an outer-queue disconnect stays linked to the later handler');
    assert.equal(JSON.parse(logs.at(-1)[1]).event, 'disconnected_before_handler');
    late.send(res, 503, payload);
    assert.equal(timers.size, 0);
    const streaming = new EventEmitter(), beforeStreams = logs.length;
    streaming.getHeader = () => 'text/event-stream';
    context.module.exports.httpTiming({ method: 'GET' }, streaming, () => { now += 60000; });
    streaming.emit('finish');
    assert.equal(logs.length, beforeStreams, 'a long-lived event stream is not a slow HTTP action');
});

test('concurrent request traces retain the identity of a shared background save without sharing spans', async () => {
    let complete;
    const background = measureWork('user_flush', () => new Promise(resolve => { complete = resolve; }));
    const a = requestTiming('attack'), b = requestTiming('view');
    const joined = [a, b].map(timing => timing.measureAsync('advance_save', () => waitFor('flush_wait', background)));
    complete();
    await Promise.all(joined);
    const res = { setHeader() {}, status() { return this; }, json() {} };
    for (const timing of [a, b]) timing.send(res, 200, {});
    assert.notEqual(a.trace, b.trace);
    assert.equal(a.operations.length, 1);
    assert.equal(b.operations.length, 1);
    assert.notEqual(a.operations[0].id, b.operations[0].id);
    assert.equal(a.operations[0].waitingFor, b.operations[0].waitingFor);
    assert.match(a.operations[0].waitingFor, /^[a-f0-9]{12}$/);
    assert.equal(a.operations[0].stage, 'advance_save');
});

test('real SDK retries and HTTP response delay are distinguished without logging private input', { timeout: 5000 }, async () => {
    const http = require('node:http');
    const { DynamoDBClient, GetItemCommand } = require('@aws-sdk/client-dynamodb');
    let calls = 0;
    const server = http.createServer((req, res) => {
        req.resume();
        if (++calls === 3) { req.socket.destroy(); return; }
        res.writeHead(calls === 1 ? 500 : 200, { 'content-type': 'application/x-amz-json-1.0', 'x-amzn-requestid': 'aws-trace' });
        res.flushHeaders();
        setTimeout(() => res.end(calls === 1 ? '{"__type":"InternalServerError","message":"private-error"}' : '{}'), 20);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const client = new DynamoDBClient({ region: 'ap-northeast-2', endpoint: 'http://127.0.0.1:' + server.address().port,
        credentials: { accessKeyId: 'private-key', secretAccessKey: 'private-secret' }, maxAttempts: 2 });
    instrumentDynamo(client);
    const timing = requestTiming('attack');
    try {
        await timing.measureAsync('advance_save', () => client.send(new GetItemCommand({ TableName: 'private-table', Key: { id: { S: 'private-account' } } })));
        const work = timing.operations.find(work => work.name === 'dynamodb');
        assert.equal(work.command, 'GetItemCommand');
        assert.equal(work.attempts, 2);
        assert.equal(work.tries.length, 2);
        assert.deepEqual(work.tries.map(attempt => attempt.status), [500, 200]);
        assert.equal(work.tries[0].error, 'InternalServerError');
        assert.ok(work.retryDelayMs >= 0);
        assert.equal(work.awsRequestId, 'aws-trace');
        assert.ok(work.tries[1].network.dispatchMs >= 0);
        assert.ok(work.tries[1].network.bodyMs - work.tries[1].network.headersMs >= 10);
        assert.ok(work.ms >= work.tries.reduce((sum, attempt) => sum + attempt.ms, 0) - 2);
        await timing.measureAsync('save', () => client.send(new GetItemCommand({ TableName: 'private-table', Key: { id: { S: 'private-account' } } })));
        const reset = timing.operations.at(-1);
        assert.equal(reset.attempts, 2);
        assert.equal(reset.tries[0].errorCode, 'ECONNRESET');
        assert.equal(reset.tries[0].network.errorCode, 'ECONNRESET');
        assert.doesNotMatch(JSON.stringify(timing.operations), /private/);
    } finally {
        timing.send({ setHeader() {}, status() { return this; }, json() {} }, 200, {});
        client.destroy();
        await new Promise(resolve => server.close(resolve));
    }
});
