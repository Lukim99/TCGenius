const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = name => fs.readFileSync(require.resolve('../' + name), 'utf8');
const rpgSource = source('rpgenius');
const getKoreanWeekKey = vm.runInNewContext(rpgSource.slice(rpgSource.indexOf('function getKoreanWeekKey('), rpgSource.indexOf('function getKoreanMonthKey(')) + '\ngetKoreanWeekKey');
const corridorSource = source('paradise');
// Use the real rollover functions without starting the app or accessing production DB.
const { recordFloor } = vm.runInNewContext(corridorSource.slice(corridorSource.indexOf('function weeklyInfo('), corridorSource.indexOf('function buildWeeklyRanking(')) + '\n({ recordFloor })', {
    rpg: () => ({ getKoreanWeekKey }), MAX_FLOOR: 999, clamp: (value, min, max) => Math.max(min, Math.min(max, value))
});
const monday = new Date('2026-11-09T00:00:00+09:00'), sunday = new Date('2026-11-08T23:59:59+09:00');

function settlementFixture({ users = [], snapshots = new Map(), failMailOnce = false, beforeScan, now = monday.getTime() } = {}) {
    const scheduled = [], intervals = [], errors = [], sent = [], commands = [];
    const config = { participation: [], ranks: [{ from: 1, to: 7, rewards: [{ type: '가넷', count: 123 }] }] };
    const db = { async send(command) {
        const { type, input } = command; commands.push(type);
        if (type === 'ScanCommand') { if (beforeScan) await beforeScan(); return { Items: structuredClone(users) }; }
        if (type === 'GetCommand') return { Item: snapshots.has(input.Key.key) ? { data: structuredClone(snapshots.get(input.Key.key)) } : undefined };
        if (type === 'PutCommand') { snapshots.set(input.Item.key, structuredClone(input.Item.data)); return {}; }
        if (type === 'UpdateCommand') { snapshots.get(input.Key.key).completedAt = input.ExpressionAttributeValues[':now']; return {}; }
        throw Error(type);
    } };
    const commandTypes = Object.fromEntries(['ScanCommand', 'GetCommand', 'PutCommand', 'UpdateCommand'].map(type => [type, class { constructor(input) { this.type = type; this.input = input; } }]));
    const rpg = { getKoreanWeekKey, getDataCache: key => key === 'Paradise' ? { weeklyRewards: config } : [], async sendSystemMailToUser(name, options) {
        if (failMailOnce) { failMailOnce = false; throw Error('isolated mail outage'); }
        sent.push({ name, options: structuredClone(options) }); return { ok: true };
    } };
    class ClockDate extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } }
    const modules = { '@aws-sdk/client-dynamodb': { DynamoDBClient: class {} }, '@aws-sdk/lib-dynamodb': { ...commandTypes, DynamoDBDocumentClient: { from: () => db } }, './rpgenius': rpg };
    const context = { module: { exports: {} }, require: name => { assert.ok(modules[name], name); return modules[name]; }, process: { env: {} }, structuredClone, Date: ClockDate, console: { error: (...args) => errors.push(args) }, setImmediate: fn => scheduled.push(fn), setInterval: (fn, delay) => { const handle = { unref() { handle.unreferenced = true; } }; intervals.push({ fn, delay, handle }); return handle; } };
    vm.runInNewContext(source('paradise_rewards'), context);
    return { ...context.module.exports, scheduled, intervals, errors, sent, commands, snapshots, config, setNow(value) { now = value; } };
}

test('startup settlement is scheduled once; a failed tick retries next minute using its durable snapshot', async () => {
    const oldWeek = getKoreanWeekKey(sunday), users = [{ id: 'recipient', name: 'recipient', paradiseWeekly: { week: oldWeek, bestFloor: 88, reachedAt: sunday.getTime() } }];
    const f = settlementFixture({ users, failMailOnce: true });
    f.startWeeklyRewards(); f.startWeeklyRewards();
    assert.equal(f.scheduled.length, 1);
    assert.equal(f.intervals.length, 1);
    assert.equal(f.intervals[0].delay, 60000);
    assert.equal(f.intervals[0].handle.unreferenced, true);
    await f.scheduled[0]();
    const snapshot = f.snapshots.get('ParadiseSettlement:' + oldWeek);
    assert.equal(snapshot.completedAt, undefined);
    assert.equal(f.errors.length, 1);
    f.config.ranks[0].rewards[0].count = 9999;
    await f.intervals[0].fn();
    assert.ok(f.snapshots.get('ParadiseSettlement:' + oldWeek).completedAt);
    assert.equal(f.sent.length, 1);
    assert.equal(f.sent[0].options.gifts[0].amount, 123);
    assert.equal(f.sent[0].options.deliveryKey, 'paradise:' + oldWeek);
    const scans = f.commands.filter(type => type === 'ScanCommand').length;
    await f.intervals[0].fn();
    assert.equal(f.commands.filter(type => type === 'ScanCommand').length, scans);
});

test('single-flight settlement does not duplicate a pending scan', async () => {
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const f = settlementFixture({ beforeScan: () => gate });
    const first = f.settleWeekly(), second = f.settleWeekly();
    assert.equal(first, second);
    assert.equal(f.commands.filter(type => type === 'ScanCommand').length, 1);
    release(); await first;
});

test('scheduler detects the Korean Monday rollover after a successful previous-week check', async () => {
    const oldWeek = getKoreanWeekKey(sunday);
    const f = settlementFixture({ now: sunday.getTime(), users: [{ id: 'recipient', name: 'recipient', paradiseWeekly: { week: oldWeek, bestFloor: 55, reachedAt: sunday.getTime() } }] });
    f.startWeeklyRewards(); await f.scheduled[0]();
    assert.equal(f.sent.length, 0);
    f.setNow(monday.getTime()); await f.intervals[0].fn();
    assert.equal(f.sent.length, 1);
    assert.equal(f.sent[0].options.deliveryKey, 'paradise:' + oldWeek);
});

test('new-week gameplay preserves old scores whether it happens before or during the settlement scan', async () => {
    for (const duringScan of [false, true]) {
        const previous = { week: getKoreanWeekKey(sunday), bestFloor: 88, reachedAt: sunday.getTime() };
        const user = { id: 'recipient', name: 'recipient', paradise: { mode: 'heaven', floor: 3 }, paradiseWeekly: structuredClone(previous) };
        const rollover = () => recordFloor(user, monday);
        if (!duringScan) rollover();
        const f = settlementFixture({ users: [user], beforeScan: duringScan ? rollover : undefined });
        await f.settleWeekly();
        assert.equal(user.paradiseWeekly.week, getKoreanWeekKey(monday));
        assert.equal(user.paradiseWeekly.bestFloor, 3);
        assert.deepEqual(JSON.parse(JSON.stringify(user.paradiseWeeklyHistory[previous.week])), previous);
        const snapshot = f.snapshots.get('ParadiseSettlement:' + previous.week);
        assert.equal(snapshot.rows[0].floor, 88);
        assert.equal(snapshot.rows[0].reachedAt, previous.reachedAt);
        assert.equal(snapshot.rows[0].rank, 1);
        assert.equal(f.snapshots.has('ParadiseSettlement:' + getKoreanWeekKey(monday)), false);
        assert.equal(f.sent[0].options.deliveryKey, 'paradise:' + previous.week);
    }
});

test('startup after a process restart resumes an unfinished snapshot with unchanged recipients and delivery keys', async () => {
    const oldWeek = getKoreanWeekKey(sunday), user = { id: 'recipient', name: 'recipient', paradiseWeeklyHistory: { [oldWeek]: { week: oldWeek, bestFloor: 88, reachedAt: 1 } } };
    const first = settlementFixture({ users: [user], failMailOnce: true });
    await assert.rejects(first.settleWeekly(), /isolated mail outage/);
    const saved = structuredClone(first.snapshots.get('ParadiseSettlement:' + oldWeek));
    user.paradiseWeeklyHistory[oldWeek].bestFloor = 999;
    const restarted = settlementFixture({ users: [user], snapshots: first.snapshots });
    restarted.config.ranks[0].rewards[0].count = 9999;
    restarted.startWeeklyRewards(); await restarted.scheduled[0]();
    assert.equal(restarted.sent[0].options.recipientId, saved.rows[0].id);
    assert.equal(restarted.sent[0].options.deliveryKey, 'paradise:' + oldWeek);
    assert.equal(restarted.sent[0].options.gifts[0].amount, 123);
    assert.equal(restarted.snapshots.get('ParadiseSettlement:' + oldWeek).rows[0].floor, 88);
});
