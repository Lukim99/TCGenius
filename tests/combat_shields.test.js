const test = require('node:test');
const assert = require('node:assert/strict');
const shields = require('../combat_shields');

test('같은 출처만 갱신하고 다른 효과와 다른 시전자의 잔여량·만료시간은 보존한다', () => {
    const state = {};
    shields.grant(state, { source: 'skill:글버지', caster: 'A', amount: 1000, expiresAt: 8000, expireHeal: 40 });
    shields.grant(state, { source: 'skill:글버지', caster: 'B', amount: 2000, expiresAt: 9000, expireHeal: 80 });
    shields.grant(state, { source: 'equipment:심해의 갑옷', caster: 'A', amount: 500, expiresAt: 5000 });
    assert.equal(shields.absorb(state, 200).absorbed, 200);
    const otherSources = structuredClone(state.shieldLayers.filter(layer => layer.source !== 'equipment:심해의 갑옷'));
    shields.grant(state, { source: 'equipment:심해의 갑옷', caster: 'A', amount: 700, expiresAt: 7000 });
    assert.deepEqual(state.shieldLayers.filter(layer => layer.source !== 'equipment:심해의 갑옷'), otherSources);
    assert.equal(state.shieldLayers.length, 3);
    assert.equal(shields.summary(state, 1000).amount, 3700);
    shields.grant(state, { source: 'skill:글버지', caster: 'A', amount: 800, expiresAt: 10000, expireHeal: 32 });
    assert.equal(state.shieldLayers.find(layer => layer.caster === 'B').amount, 2000);
    assert.equal(shields.summary(state, 1000).amount, 3500);
});

test('먼저 만료되는 보호막부터 흡수하고 피해가 넘으면 다음 출처로 이어진다', () => {
    const state = {};
    shields.grant(state, { source: 'long', caster: 'A', amount: 1000, expiresAt: 12000 });
    shields.grant(state, { source: 'short', caster: 'A', amount: 300, expiresAt: 5000 });
    shields.grant(state, { source: 'hits', caster: 'A', amount: 100, expiresAt: 0, hits: 2 });
    const first = shields.absorb(state, 500);
    assert.equal(first.damage, 0);
    assert.deepEqual(first.broken.map(layer => layer.source), ['short']);
    assert.equal(state.shieldLayers.find(layer => layer.source === 'long').amount, 800);
    assert.equal(state.shieldLayers.find(layer => layer.source === 'hits').hits, 2);
    const overflow = shields.absorb(state, 1000);
    assert.equal(overflow.absorbed, 900); assert.equal(overflow.damage, 100);
    assert.equal(shields.summary(state, 1000).amount, 0);
});

test('한 출처만 만료되고 만료 효과는 한 번만 반환하며 저장·복원 후에도 동일하다', () => {
    const state = {};
    shields.grant(state, { source: 'skill:글버지', caster: 'A', amount: 1000, expiresAt: 8000, expireHeal: 40 });
    shields.grant(state, { source: 'awakening:워뇨띠', caster: 'B', amount: 700, expiresAt: 7000 });
    const restored = JSON.parse(JSON.stringify(state));
    assert.equal(shields.summary(restored, 7000).amount, 1000);
    assert.deepEqual(shields.expire(restored, 7000).map(layer => layer.source), ['awakening:워뇨띠']);
    assert.deepEqual(shields.expire(restored, 7000), []);
    assert.equal(shields.expire(restored, 8000)[0].expireHeal, 40);
    assert.deepEqual(shields.expire(restored, 8000), []);
});

test('피격 횟수는 실제 흡수한 출처만 줄어들고 다른 보호막을 함께 파괴하지 않는다', () => {
    const state = {};
    shields.grant(state, { source: 'skill:빛의 장막', caster: 'A', amount: 1000, expiresAt: 0, hits: 2 });
    shields.grant(state, { source: 'skill:글버지', caster: 'B', amount: 500, expiresAt: 8000, hits: 99 });
    shields.absorb(state, 0);
    shields.absorb(state, 100);
    assert.equal(state.shieldLayers.find(layer => layer.source === 'skill:빛의 장막').hits, 2);
    shields.absorb(state, 500);
    assert.equal(state.shieldLayers[0].amount, 900); assert.equal(state.shieldLayers[0].hits, 1);
    const broken = shields.absorb(state, 100);
    assert.equal(broken.broken[0].source, 'skill:빛의 장막');
    assert.equal(broken.broken[0].amount, 800);
    assert.equal(shields.summary(state, 1000).amount, 0);
});

test('기존 단일 보호막은 한 번만 보존해 읽고 소진 후 다시 살아나지 않는다', () => {
    const state = {};
    const legacy = { amount: 5000, expiresAt: 12000, hits: 1, expireHeal: 200 };
    shields.layers(state, legacy);
    shields.grant(state, { source: 'awakening:워뇨띠', caster: 'A', amount: 700, expiresAt: 7000 });
    assert.equal(shields.summary(state, 1000).amount, 5700);
    shields.absorb(state, 6000);
    shields.layers(state, legacy);
    assert.equal(shields.summary(state, 1000).amount, 0);
});
