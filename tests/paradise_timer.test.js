const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../paradise'), 'utf8');
const timerSource = source.slice(0, source.indexOf('function getResources('));
const minute = 60000;

// Evaluate the real timer functions without loading the server or production DB.
function timer(pauses = false) {
    let now = 10000000, claims = 0, api;
    const code = pauses ? timerSource.replace('const PAUSE_TIMER_OUTSIDE_COMBAT = false;', 'const PAUSE_TIMER_OUTSIDE_COMBAT = true;') : timerSource;
    assert.ok(!pauses || code !== timerSource, 'the documented pause switch must still exist');
    api = vm.runInNewContext(code + '\n({ TIME_LIMIT_MS, timeLimit, timerPaused, remainingTime, setPhase, advanceTime })', {
        Date: { now: () => now },
        require: name => name === './paradise_content' ? { AUGMENTS: [], RELICS: [], EVENTS: [], EQUIPMENT_NAMES: [] }
            : name === './paradise_progression' ? { has: (run, id) => run?.mode !== 'hell' && !!run?.celestial?.traits?.includes(id) } : {},
        collapseEncounter: () => false,
        finish(user, outcome) { api.setPhase(user, 'ended'); user.paradise.status = 'ended'; user.paradise.outcome = outcome; user.field = null; },
        claim() { claims++; return {}; }
    });
    return { ...api, tick(ms) { now += ms; }, get now() { return now; }, get claims() { return claims; } };
}
function user(clock, extraTime = false) {
    return { field: { paradise: true }, paradise: { status: 'active', mode: 'heaven', phase: 'augment', revision: 0, relics: [], celestial: { traits: extraTime ? ['extraTime'] : [] }, ...(clock ? { clock } : {}) } };
}

test('new clocks start at 15 or 18 minutes and every active phase counts down', () => {
    for (const extra of [false, true]) {
        const t = timer(), u = user(null, extra);
        assert.equal(t.TIME_LIMIT_MS, 15 * minute);
        assert.equal(t.advanceTime(u), true);
        assert.equal(t.remainingTime(u.paradise), (extra ? 18 : 15) * minute);
        for (const phase of ['combat', 'puzzle', 'augment', 'relic', 'route', 'event']) {
            t.setPhase(u, phase); const before = t.remainingTime(u.paradise);
            assert.equal(u.paradise.clock.paused, false, phase);
            t.tick(1000); assert.equal(t.remainingTime(u.paradise), before - 1000, phase);
        }
    }
});

test('old 20/25 minute clocks lose 5/7 minutes once and keep running through reconnects', () => {
    for (const extra of [false, true]) for (const paused of [false, true]) {
        const t = timer(), u = user({ remainingMs: 10 * minute, limitMs: (extra ? 25 : 20) * minute, updatedAt: t.now - minute, paused }, extra);
        const expected = (extra ? 3 : 5) * minute - (paused ? 0 : minute);
        assert.equal(t.advanceTime(u), true);
        assert.equal(t.remainingTime(u.paradise), expected);
        assert.equal(u.paradise.clock.limitMs, (extra ? 18 : 15) * minute);
        assert.equal(t.advanceTime(u), false);
        t.tick(1000);
        assert.equal(t.remainingTime(structuredClone(u.paradise)), expected - 1000);
    }
});

test('legacy missing-limit clocks do not regain five minutes and normalize only once', () => {
    const t = timer(), u = user({ remainingMs: 2 * minute, updatedAt: t.now - 3600000, paused: true });
    assert.equal(t.advanceTime(u), true);
    assert.equal(t.remainingTime(u.paradise), 2 * minute);
    assert.equal(t.advanceTime(u), false);
    t.tick(1000); assert.equal(t.remainingTime(u.paradise), 2 * minute - 1000);
});

test('shortened and legacy expired clocks finish in the same access and settle only once', () => {
    for (const extra of [false, true]) {
        const t = timer(), u = user({ remainingMs: (extra ? 7 : 5) * minute, limitMs: (extra ? 25 : 20) * minute, updatedAt: t.now, paused: true }, extra);
        assert.equal(t.advanceTime(u), true);
        assert.equal(u.paradise.outcome, 'timedOut'); assert.equal(t.claims, 1);
        assert.equal(t.advanceTime(u), false); assert.equal(t.claims, 1);
    }
    const t = timer(), u = user({ remainingMs: 100, updatedAt: t.now - 1000, paused: false });
    assert.equal(t.advanceTime(u), true); assert.equal(u.paradise.outcome, 'timedOut');
});

test('ended clocks and hell mode remain unchanged', () => {
    const t = timer(), u = user({ remainingMs: 100000, limitMs: 25 * minute, updatedAt: t.now - minute, paused: true }, true);
    u.paradise.status = 'ended'; u.paradise.phase = 'ended';
    assert.equal(t.advanceTime(u), false); assert.equal(t.remainingTime(u.paradise), 100000);
    assert.equal(t.timerPaused(u.paradise), true);
    u.paradise.status = 'active'; u.paradise.mode = 'hell';
    const before = structuredClone(u); assert.equal(t.advanceTime(u), false); assert.deepEqual(u, before);
});

test('the retained toggle restores choice pauses but combat and puzzles still tick', () => {
    const t = timer(true), u = user(); t.advanceTime(u);
    for (const phase of ['augment', 'relic', 'route', 'event']) {
        t.setPhase(u, phase); const before = t.remainingTime(u.paradise);
        assert.equal(u.paradise.clock.paused, true, phase);
        t.tick(minute); assert.equal(t.remainingTime(u.paradise), before, phase);
        assert.equal(t.advanceTime(u), false);
    }
    for (const phase of ['combat', 'puzzle']) {
        t.setPhase(u, phase); const before = t.remainingTime(u.paradise);
        assert.equal(u.paradise.clock.paused, false, phase);
        t.tick(1000); assert.equal(t.remainingTime(u.paradise), before - 1000, phase);
    }
    t.setPhase(u, 'ended'); assert.equal(u.paradise.clock.paused, true);
});
