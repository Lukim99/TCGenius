const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { requestTiming } = require('../paradise_timing');

function fixture({ advance = false, viewFailOnce = false, saveFailOnce = false, settlement = () => new Promise(() => {}) } = {}) {
    const user = { id: 'private-id', name: 'private-name', field: { paradise: true }, paradise: { id: 'private-run', status: 'active', phase: 'augment', revision: 0, resources: { hp: 10, mp: 10 } } };
    const counts = { mutations: 0, writes: 0, weekly: 0, scheduled: 0 };
    const commits = [], routes = new Map();
    let tail = Promise.resolve();
    const corridor = {
        active: () => true, advanceTime: () => false, rebalanceEnemy: () => false, normalizeAugmentOffer: () => false, normalizeRelicOffer: () => false,
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
    assert.equal((await f.request()).status, 200);
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
    const logs = [], context = { module: { exports: {} }, require: () => ({ performance: { now: () => now } }), console: { warn: (...args) => logs.push(args) } };
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
    assert.deepEqual(JSON.parse(logs[0][1]), { action: 'reroll', status: 503, durations: { state: 25, save: 1200, total: 1225 } });
});
