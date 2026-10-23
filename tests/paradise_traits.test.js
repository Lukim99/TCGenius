const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const shields = require('../combat_shields');

// 이 파일은 신규 특수능력 훅만 검증합니다. DB와 서버 모듈을 로드하지 않습니다.
const originals = new Map();
function substitute(name, exports) {
    const file = require.resolve(name); originals.set(file, require.cache[file]);
    require.cache[file] = { id: file, filename: file, loaded: true, exports };
}
substitute('../rpgenius', {
    calculateUserStats: user => ({ ...user.stats }),
    getUltimateSkills: () => [{ skill: { name: '궁극기' } }],
    computeCombatPowerFromStats: stats => ({ total: stats.hp + stats.atk * 10 })
});
substitute('../paradise', {
    getResources: user => user.paradise.resources,
    heal(user, hp = 0, mp = 0) {
        if (user.paradise.effects.noHealing) return;
        const r = user.paradise.resources;
        r.hp = Math.min(user.stats.hp, r.hp + Math.round(user.stats.hp * hp));
        r.mp = Math.min(user.stats.mp, r.mp + Math.round(user.stats.mp * mp));
    },
    remainingTime: (run, now) => Math.max(0, run.clock.remainingMs - (run.clock.paused ? 0 : now - run.clock.updatedAt))
});
substitute('../paradise_content', { RELICS: [
    { id: 'normalA', rarity: 'normal' }, { id: 'normalB', rarity: 'normal' }, { id: 'advancedA', rarity: 'advanced' }
] });
const traits = require('../paradise_traits');
after(() => { for (const [file, previous] of originals) { if (previous) require.cache[file] = previous; else delete require.cache[file]; } });
function user(...ids) {
    return { name: 'trait-test', stats: { hp: 1000, mp: 100, atk: 100 }, field: { paradise: true, skillCooldowns: {} }, paradise: {
        status: 'active', mode: 'heaven', phase: 'combat', floor: 1, distortion: 0, celestial: { traits: ids },
        battle: {}, effects: {}, resources: { hp: 1000, mp: 100 }, acquired: {}, relics: [],
        enemy: { kind: 'normal', hp: 5000, maxHp: 5000, atk: 100 }, choices: ['left', 'middle', 'right'], rerolled: [false, false, false],
        clock: { remainingMs: 120000, updatedAt: Date.now(), paused: false, limitMs: 1200000 }
    } };
}
const state = u => u.paradise.battle.traits ||= {};
const expedition = u => u.paradise.traitState ||= {};
function newBattle(u, kind = 'normal') {
    u.paradise.battle = {}; u.field.shieldLayers = []; u.paradise.enemy = { kind, hp: 5000, maxHp: 5000, atk: 100 };
    traits.onBattle(u);
}
function attack(u, extra = {}, damage = 100, criticalCount = 0, comboHitCount = 1) {
    extra = { isBasic: true, ...extra };
    const stats = { ...u.stats }, hit = { finalDamage: damage, criticalCount, comboHitCount, hitDetails: [{ damage, isCritical: criticalCount > 0 }] };
    traits.prepareAttack(u, stats, extra); traits.modifyHit(u, stats, extra, hit); traits.afterHit(u, stats, extra, hit);
    return { extra, hit };
}
function dot(u, damage) { return attack(u, { dotAttack: true, summonAttack: true, isBasic: false }, damage); }
function route(u, side, left = 'normal', right = 'normal', gimmick = null) {
    u.paradise.routes = [{ id: 'L', kind: left, gimmick }, { id: 'R', kind: right, gimmick }];
    traits.onRoute(u, u.paradise.routes[side]);
}

test('신규 특수능력은 30종이며 설명과 식별자가 빠짐없이 서로 다르다', () => {
    assert.equal(traits.TRAITS.length, 30);
    assert.equal(new Set(traits.TRAITS.map(t => t.id)).size, 30);
    assert.equal(new Set(traits.TRAITS.map(t => t.name)).size, 30);
    assert.ok(traits.TRAITS.every(t => /니다\.$/.test(t.desc) && !t.desc.includes('·')));
});

test('전공과 대기명단이 함께 적용되어도 등급과 세 후보의 중복을 유지한다', () => {
    const u = user('subjectMajor', 'waitingList');
    traits.onChoose(u, { id: 'left', category: 'dot' });
    assert.equal(expedition(u).subject, 'dot'); assert.equal(expedition(u).waiting, 'right');
    const pool = ['a', 'b', 'c', 'right', 'major'].map(id => ({ id, rarity: 'gold', category: id === 'major' ? 'dot' : 'combo' }));
    const choices = traits.modifyOffers(u, ['a', 'b', 'c'], pool, () => 0);
    assert.ok(choices.includes('major')); assert.ok(choices.includes('right')); assert.equal(new Set(choices).size, 3);
    assert.ok(choices.every(id => pool.find(a => a.id === id).rarity === 'gold'));
    expedition(u).waiting = 'unavailable'; traits.modifyOffers(u, choices, pool, () => 0);
    assert.equal(expedition(u).waiting, 'unavailable');
});

test('꽝도장은 세 번째 재추첨에만 준비하며 탐험당 네 번을 넘지 않는다', () => {
    const u = user('rerollStamp');
    traits.onReroll(u); traits.onReroll(u); assert.ok(!expedition(u).luckyOpening);
    traits.onReroll(u); newBattle(u);
    let a = attack(u); assert.equal(a.extra.forceCritical, true); assert.equal(a.extra.defReductionBonus, .25);
    assert.ok(!attack(u).extra.forceCritical);
    for (let i = 0; i < 12; i++) { traits.onReroll(u); if ((i + 1) % 3 === 0) newBattle(u); }
    assert.equal(expedition(u).stampUses, 4); assert.ok(!state(u).luckyOpening);
});

test('증강 좌석 세 종류가 쿨타임, 치명타, 피격에서 각각 한 번 소모된다', () => {
    const u = user('reservedSeat');
    traits.onChoose(u, { id: 'left' }); newBattle(u); u.field.skillCooldowns.주문 = Date.now() + 10000;
    traits.afterCooldown(u, '주문'); assert.ok(u.field.skillCooldowns.주문 - Date.now() <= 5000); assert.ok(!state(u).seat);
    traits.onChoose(u, { id: 'middle' }); newBattle(u); assert.equal(attack(u).extra.forceCritical, true); assert.ok(!attack(u).extra.forceCritical);
    traits.onChoose(u, { id: 'right' }); newBattle(u); assert.equal(traits.incomingMultiplier(u, 100), .50); assert.equal(traits.incomingMultiplier(u, 100), 1);
});

test('무편집 순례는 부족한 자원만 회복하고 회복 봉쇄와 재추첨을 존중한다', () => {
    const u = user('uncutPilgrim'); u.paradise.resources = { hp: 700, mp: 20 };
    traits.onChoose(u, { id: 'left' }); assert.deepEqual(u.paradise.resources, { hp: 700, mp: 30 });
    u.paradise.rerolled[0] = true; traits.onChoose(u, { id: 'left' }); assert.equal(u.paradise.resources.mp, 30);
    u.paradise.rerolled[0] = false; u.paradise.effects.noHealing = true;
    traits.onChoose(u, { id: 'left' }); assert.equal(u.paradise.resources.mp, 30);
});

test('교대 경로는 세 갈림길을 실제 선택해야 방어를 제공하며 반복 경로는 초기화한다', () => {
    const u = user('zigzagTicket'); route(u, 0); route(u, 0); route(u, 1); assert.ok(!expedition(u).routeGuard);
    route(u, 0); newBattle(u); assert.equal(traits.incomingMultiplier(u, 100), 0); assert.equal(traits.incomingMultiplier(u, 100), 1);
    for (let i = 0; i < 15; i++) route(u, (i + 1) % 2);
    assert.equal(expedition(u).zigzags, 3);
});

test('같은 문은 동일 전투 갈림길에서만 HP와 공격력을 교환한다', () => {
    const u = user('twinDoor'); route(u, 0);
    const preview = { ...u.paradise.enemy }; traits.previewRoute(u, u.paradise.routes[0], preview);
    assert.equal(preview.hp, 4000); assert.equal(preview.atk, 115);
    newBattle(u);
    assert.equal(u.paradise.enemy.hp, 4000); assert.equal(u.paradise.enemy.atk, 115);
    route(u, 1); newBattle(u); assert.equal(u.paradise.enemy.hp, 5750); assert.equal(u.paradise.enemy.atk, 80);
    route(u, 0, 'normal', 'elite'); newBattle(u); assert.equal(u.paradise.enemy.hp, 5000);
    route(u, 0, 'event', 'event'); newBattle(u); assert.equal(u.paradise.enemy.hp, 5000);
});

test('기믹 보증 보호막의 파괴만 방어 관통을 준비한다', () => {
    const u = user('gimmickWarranty'); route(u, 0, 'normal', 'elite', 'test'); newBattle(u);
    assert.equal(shields.summary(u.field, Date.now()).amount, 150);
    shields.absorb(u.field, 150); traits.onDamage(u, u.stats, 150, 0);
    assert.equal(attack(u).extra.defReductionBonus, .25); assert.ok(!attack(u).extra.defReductionBonus);
    u.stats.disableShield = true; route(u, 0, 'normal', 'elite', 'test'); newBattle(u);
    traits.onDamage(u, u.stats, 20, 0); assert.ok(!state(u).warrantyReady);
});

test('일반전 몸풀기는 엘리트에서만 소비하며 이벤트 도시락은 첫 전투에서 비운다', () => {
    const u = user('eliteWarmup', 'picnicParcel');
    for (let i = 0; i < 5; i++) traits.onVictory(u);
    assert.equal(expedition(u).warmup, 3); newBattle(u); assert.equal(attack(u).hit.finalDamage, 100);
    route(u, 0, 'event', 'normal'); newBattle(u, 'elite'); assert.equal(shields.summary(u.field, Date.now()).amount, 150);
    for (let i = 0; i < 3; i++) assert.equal(attack(u).hit.finalDamage, 120);
    assert.equal(attack(u).hit.finalDamage, 100); newBattle(u); assert.equal(shields.summary(u.field, Date.now()).amount, 0);
});

test('마무리 공격을 잇고 초과 피해를 보호막에 저장하되 지속 피해 막타는 기억하지 않는다', () => {
    const u = user('finishWord', 'overpack'); u.paradise.enemy.hp = 0;
    attack(u, { paradiseEnemyHpBefore: 100 }, 1000); traits.onVictory(u); newBattle(u);
    assert.equal(shields.summary(u.field, Date.now()).amount, 200);
    assert.equal(attack(u, { isBasic: false, isSkill: true }).hit.finalDamage, 150);
    u.paradise.enemy.hp = 0; dot(u, 50); traits.onVictory(u); newBattle(u); assert.equal(attack(u).hit.finalDamage, 100);
});

test('마나와 무피격 식량은 상한까지 모은 뒤 조건을 만족해야 소비한다', () => {
    const u = user('manaLunch', 'spotlessRations'); for (let i = 0; i < 4; i++) traits.onVictory(u);
    assert.equal(expedition(u).manaLunch, 30); assert.equal(expedition(u).rations, 3);
    u.paradise.resources.mp = 20; attack(u); assert.equal(u.paradise.resources.mp, 50); assert.equal(expedition(u).manaLunch, 0);
    u.paradise.resources.hp = 250; traits.onDamage(u, u.stats, 0, 100);
    assert.equal(u.paradise.resources.hp, 490); assert.equal(expedition(u).rations, 0);
    u.paradise.resources.hp = 0; expedition(u).rations = 1; traits.onDamage(u, u.stats, 0, 500); assert.equal(expedition(u).rations, 1);
});

test('자원 비율 역전은 한 번만 다음 공격에 고정 피해를 저장한다', () => {
    const u = user('levelBalance'); u.paradise.resources.mp = 30; attack(u);
    u.paradise.resources.hp = 100; attack(u);
    assert.equal(attack(u).hit.finalDamage, 300); assert.equal(attack(u).hit.finalDamage, 100);
    u.paradise.resources.hp = 1000; attack(u); assert.equal(attack(u).hit.finalDamage, 100);
});

test('민망한 인사는 종류를 바꿔야 상환하며 단발 탄피는 네 발까지만 모은다', () => {
    let u = user('awkwardGreeting'); assert.equal(attack(u).hit.finalDamage, 50); assert.equal(attack(u).hit.finalDamage, 100);
    assert.equal(attack(u, { isBasic: false, isSkill: true }).hit.finalDamage, 200); assert.equal(attack(u, { isBasic: false, isSkill: true }).hit.finalDamage, 100);
    u = user('singleShell'); for (let i = 0; i < 6; i++) attack(u);
    assert.equal(attack(u, { isBasic: false, isSkill: true }).hit.finalDamage, 200);
    assert.equal(attack(u, { isBasic: false, isSkill: true }).hit.finalDamage, 100);
    attack(u, {}, 100, 0, 3); assert.equal(state(u).shells, 0);
});

test('치명타 피날레와 첫 주문 양보는 연격을 여러 행동으로 세지 않는다', () => {
    const u = user('coldApplause', 'courteousSpell');
    let a = attack(u, { isBasic: false, isSkill: true }); assert.equal(a.extra.disableCritical, true);
    assert.equal(attack(u, {}, 100, 3, 3).extra.forceCritical, true);
    attack(u, {}, 100, 2, 2); assert.ok(!state(u).coldReady);
    attack(u, {}, 100, 1); a = attack(u);
    assert.equal(a.extra.disableCritical, true); assert.equal(a.hit.finalDamage, 200); assert.ok(!state(u).coldReady);
});

test('적 보호막의 흡수 피해를 돌려주되 자체 추가 피해를 재입금하지 않는다', () => {
    const u = user('wardCustoms');
    traits.afterHit(u, u.stats, { isBasic: true, routeShieldAbsorbed: 1000 }, { finalDamage: 0 });
    assert.equal(state(u).customsDamage, 300);
    const a = attack(u, { isBasic: false, isSkill: true, routeShieldAbsorbed: 400 });
    assert.equal(a.hit.finalDamage, 400); assert.equal(state(u).customsDamage, 0);
    assert.equal(attack(u, { isBasic: false, isSkill: true }).hit.finalDamage, 100);
    traits.afterHit(u, u.stats, { isBasic: true, enemyShieldAbsorbed: 200 }, { finalDamage: 0 });
    assert.equal(state(u).customsDamage, 100);
});

test('지속 피해의 갑옷과 동일한 방울은 실제 틱을 사용하고 상한을 지킨다', () => {
    const u = user('softPoisonWard', 'pairedDrops'); dot(u, 100); dot(u, 100); dot(u, 100);
    assert.equal(shields.summary(u.field, Date.now()).amount, 200);
    assert.equal(attack(u).hit.finalDamage, 300);
    for (let i = 0; i < 8; i++) { dot(u, 100); dot(u, 100); attack(u); }
    assert.equal(state(u).pairedUses, 3); assert.equal(state(u).poisonTicks, 3);
});

test('우산은 만료까지 남겨야 보상하며 회복을 한 번만 지급한다', () => {
    const u = user('meltingUmbrella'); newBattle(u); u.paradise.resources.mp = 0;
    state(u).umbrellaUntil = Date.now() - 1; attack(u); assert.equal(u.paradise.resources.mp, 15);
    attack(u); assert.equal(u.paradise.resources.mp, 15);
    newBattle(u); shields.absorb(u.field, 80); traits.onDamage(u, u.stats, 80, 0);
    state(u).umbrellaUntil = Date.now() - 1; attack(u); assert.equal(u.paradise.resources.mp, 15);
});

test('보호막 반납은 잔량을 없애고 최대 MP 20%까지만 회복한다', () => {
    const u = user('wardReturn'); u.paradise.resources.mp = 0;
    shields.grant(u.field, { source: 'test', amount: 900, expiresAt: Date.now() + 20000 });
    traits.onVictory(u); assert.equal(u.paradise.resources.mp, 20); assert.equal(shields.summary(u.field, Date.now()).amount, 0);
    traits.onVictory(u); assert.equal(u.paradise.resources.mp, 20);
});

test('무상수리는 보호막이 흡수한 세 번째 공격에서 한 번만 발동한다', () => {
    const u = user('thirdRepair');
    traits.onDamage(u, u.stats, 0, 100); assert.ok(!state(u).repairHits);
    for (let i = 0; i < 3; i++) traits.onDamage(u, u.stats, 100, 0);
    assert.equal(shields.summary(u.field, Date.now()).amount, 90);
    traits.onDamage(u, u.stats, 500, 0); assert.equal(shields.summary(u.field, Date.now()).amount, 90);
});

test('시간 담보는 90초 미만이면 실패하고 성공해도 탐험당 한 번만 생존한다', () => {
    const u = user('timeMortgage'); u.paradise.clock.remainingMs = 89000;
    assert.equal(traits.survive(u, -1, 1000), null);
    u.paradise.clock.remainingMs = 120000; u.paradise.clock.updatedAt = Date.now();
    assert.equal(traits.survive(u, -1, 1000), 1); assert.ok(u.paradise.clock.remainingMs <= 60000);
    assert.equal(shields.summary(u.field, Date.now()).amount, 200);
    assert.equal(traits.survive(u, -1, 1000), null);
});

test('역주행은 실제 하강만 세며 궁극기는 냉각 횟수를 소모하지 않는다', () => {
    const u = user('reverseCooling'); traits.afterMove(u, 1); newBattle(u); assert.ok(!state(u).reverseCooling);
    traits.afterMove(u, -3); newBattle(u); u.field.skillCooldowns.궁극기 = Date.now() + 10000;
    traits.afterCooldown(u, '궁극기'); assert.equal(state(u).reverseCooling, 2);
    for (let i = 0; i < 3; i++) {
        u.field.skillCooldowns.주문 = Date.now() + 10000; traits.afterCooldown(u, '주문');
        assert.ok(u.field.skillCooldowns.주문 - Date.now() <= (i < 2 ? 5000 : 10000));
    }
    assert.equal(state(u).reverseCooling, 0);
});

test('온도계는 같은 뒤틀림 구간을 오르내려도 재발급하지 않는다', () => {
    const u = user('chaosThermometer'); u.paradise.distortion = 75; traits.afterMove(u, 5);
    assert.equal(expedition(u).coolingPlates, 3);
    u.paradise.distortion = 0; traits.afterMove(u, -5); u.paradise.distortion = 75; newBattle(u);
    for (let i = 0; i < 3; i++) assert.equal(traits.incomingMultiplier(u, 100), .70);
    assert.equal(traits.incomingMultiplier(u, 100), 1); newBattle(u); assert.equal(expedition(u).coolingPlates, 0);
});

test('새 일반 유물 환영과 홀짝 전술은 유물 종류와 처음 행동을 구분한다', () => {
    const u = user('relicWelcome', 'oddEvenLuggage'); u.paradise.relics = ['normalA']; newBattle(u);
    assert.equal(attack(u).extra.comboHitCount, 2); assert.equal(attack(u).extra.comboHitCount, 2); assert.ok(!attack(u).extra.comboHitCount);
    u.field.skillCooldowns.주문 = Date.now() + 10000; traits.afterCooldown(u, '주문'); assert.ok(u.field.skillCooldowns.주문 - Date.now() <= 5000);
    u.paradise.relics.push('advancedA'); newBattle(u); assert.ok(!state(u).welcome); assert.equal(attack(u).hit.finalDamage, 135);
    assert.equal(attack(u).hit.finalDamage, 100); u.paradise.relics.push('normalB'); newBattle(u); assert.equal(state(u).welcome, 2);
});

test('지옥, 종료 상태, 소환 공격은 천상 직접 공격 효과를 작동시키지 않는다', () => {
    const u = user('awkwardGreeting', 'singleShell', 'rerollStamp');
    assert.equal(attack(u, { summonAttack: true }).hit.finalDamage, 100); assert.ok(!state(u).firstDirect);
    u.paradise.mode = 'hell'; traits.onReroll(u); assert.ok(!expedition(u).rerolls);
    assert.equal(attack(u).hit.finalDamage, 100); u.paradise.mode = 'heaven'; u.paradise.status = 'ended';
    assert.equal(attack(u).hit.finalDamage, 100);
});
