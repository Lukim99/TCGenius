'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const sandbox = require('../scripts/paradise-lab/sandbox');
const cards = require('../DB/RPGenius/CharacterCards.json');
const potential = require('../DB/RPGenius/Potential.json');
let base, cookie;

async function get(path) {
    const response = await fetch(base + path, { headers: { Cookie: cookie } });
    assert.equal(response.status, 200, path);
    return response.json();
}
before(async () => {
    base = 'http://127.0.0.1:' + await sandbox.start();
    const response = await fetch(base + '/api/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: sandbox.account.name, code: 'LAB' })
    });
    assert.equal(response.status, 200);
    cookie = response.headers.get('set-cookie').split(';')[0];
});
after(() => sandbox.close());

const effectText = effect => effect.type === 'flat' ? String(effect.base)
    : effect.type === 'seconds' ? effect.base + '초' : Math.round(effect.base * 1000) / 10 + '%';

test('도감은 생성 화면의 아이콘과 소개, 형태별 표지 및 정확한 고유 슬롯 수치를 제공한다', async () => {
    const dex = await get('/api/dex/equipment');
    const { starters } = await get('/api/characters');
    assert.equal(dex.character.length, starters.length);
    for (const entry of dex.character) {
        const starter = starters.find(value => value.id === entry.id);
        assert.equal(entry.iconUrl, starter.iconUrl);
        assert.equal(entry.description, starter.description);
        assert.equal(entry.coverUrl, starter.covers['일반']);
        assert.equal(entry.jobCoverUrl, starter.covers['전직']);
        const cover = new URL(entry.awakeningCoverUrl, base), starterCover = new URL(starter.covers['각성'], base);
        assert.equal(cover.pathname, starterCover.pathname);
        assert.equal(cover.searchParams.get('name'), starterCover.searchParams.get('name'));
        assert.equal(cover.searchParams.get('cover'), starterCover.searchParams.get('cover'));
        for (const [type, effects] of [['일반', [entry.slotEffect]], ['전직', entry.jobClass.slotEffects], ['각성', entry.awakening.slotEffects]]) {
            const definitions = sandbox.rpg.getCardSlotEffectDefinitions({ id: entry.id, type });
            assert.deepEqual(effects.map(effect => ({ name: effect.name, value: effect.baseText })),
                definitions.map(effect => ({ name: effect.name, value: effectText(effect) })), entry.name + ' ' + type);
        }
    }
    assert.equal(dex.character.find(entry => entry.name === '딜러장').jobClass.slotEffects.find(effect => effect.name.includes('암속성')).baseText, '50');
    assert.ok(dex.character.find(entry => entry.name === '일리온').jobClass.slotEffects.some(effect => effect.baseText === '2초'));
});

test('소지품의 모든 형태와 성급은 공통 고유 슬롯 효과를 표시할 수 있다', async () => {
    const user = await sandbox.rpg.getRPGUserByName(sandbox.account.name);
    user.inventory.card = cards.flatMap((card, id) => ['일반', '전직', '각성', ...(card.berserkSlotEffects ? ['광폭'] : [])]
        .flatMap(type => [0, 4, 8, 11].map(star => ({ id, type, star }))));
    await user.save();
    const result = await get('/api/inventory/cards');
    assert.equal(result.cards.length, user.inventory.card.length);
    for (const card of result.cards) {
        const definitions = sandbox.rpg.getCardSlotEffectDefinitions(card);
        assert.deepEqual(card.slotEffects.map(effect => effect.baseText), definitions.map(effectText), card.formatted);
    }
    assert.equal(sandbox.rpg.formatSlotEffectProgression({ base: 0.2, type: 'seconds' }), '0.2초');
});

test('잠재능력 도감의 개별 옵션 확률은 그룹 가중치와 그룹 안 옵션 수를 모두 반영한다', async () => {
    const dex = await get('/api/dex/potential');
    for (const type of dex.types) {
        for (const grade of type.grades) {
            const source = potential[type.type][grade.grade];
            const total = source.reduce((sum, group) => sum + group.rate, 0);
            let sum = 0;
            grade.groups.forEach((group, index) => {
                assert.equal(group.optionPercent, Number((source[index].rate / total / source[index].roll.length * 100).toFixed(4)));
                assert.equal(group.options.length, source[index].roll.length);
                sum += group.optionPercent * group.options.length;
            });
            assert.ok(Math.abs(sum - 100) < 0.002, type.type + ' ' + grade.grade);
        }
    }
});
