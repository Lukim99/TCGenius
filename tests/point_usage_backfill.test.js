const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildRecovery, summarize, FROM, BEFORE } = require('../scripts/backfill_point_usage');
const at = Date.parse('2026-11-06T17:18:12.055Z');
const draw = (id, cost = 1500) => ({ id, name: id, personalDraw: { revision: 3, lastAction: { action: cost ? 'shake' : 'refresh', requestId: 'request-' + id, cost, at, baseCount: cost ? 5 : 0, results: [] } } });
const evidence = users => ({ from: FROM, before: BEFORE, capturedAt: '2026-11-09T04:07:00.000Z', users, mails: [{ id: 'mail-one', fromName: 'player', createdAt: at, gifts: [{ type: 'point', amount: 99999 }] }] });

test('확정된 퍼스널뽑기와 무료 새로고침만 복구하고 관리자·메일은 제외한다', () => {
    const result = buildRecovery(evidence([draw('player'), draw('free', 0), { ...draw('admin'), isAdmin: true }]));
    assert.deepEqual(summarize(result).consumption, { count: 2, paidCount: 1, amount: 1500 });
    assert.equal(result.skipped.admin, 1);
    assert.ok(result.rows.every(r => r.category === 'personal_draw' && r.kind === 'consumption' && r.source === 'backfill'));
    assert.ok(result.rows.every(r => r.balance_before === null && r.balance_after === null));
    assert.ok(result.rows.every(r => !JSON.stringify(r).includes('cells')));
});
test('기존 자동 기록과 전송 대기 요청은 UUID가 달라도 중복 복구하지 않는다', () => {
    const user = draw('player');
    const live = { id: 'live-random-id', user_id: user.id, category: 'personal_draw', details: { requestId: user.personalDraw.lastAction.requestId } };
    assert.equal(buildRecovery(evidence([user]), [live]).rows.length, 0);
    user.pointUsageOutbox = { [live.id]: live };
    assert.equal(buildRecovery(evidence([user])).rows.length, 0);
    delete user.pointUsageOutbox;
    const first = buildRecovery(evidence([user])).rows;
    assert.equal(buildRecovery(evidence([user]), first).rows.length, 0);
    assert.equal(buildRecovery(evidence([user])).rows[0].id, first[0].id);
});
test('기록 도입 이후 거래와 5월 이전 거래는 제외하고 잘못된 금액은 거부한다', () => {
    const user = draw('player');
    user.personalDraw.lastAction.at = Date.parse(BEFORE);
    assert.equal(buildRecovery(evidence([user])).rows.length, 0);
    user.personalDraw.lastAction.at = Date.parse(FROM) - 1;
    assert.equal(buildRecovery(evidence([user])).rows.length, 0);
    user.personalDraw.lastAction.at = at; user.personalDraw.lastAction.cost = 1.5;
    assert.throws(() => buildRecovery(evidence([user])), /차감액/);
    assert.throws(() => buildRecovery({ ...evidence([]), before: new Date().toISOString() }), /도입 시각/);
});
