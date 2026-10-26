const { test, before, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const AWS = require('aws-sdk');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
const data = {};
for (const key of ['Item', 'Equipment', 'Bundle', 'Recipe', 'Pack']) data[key] = JSON.parse(fs.readFileSync(path.join(__dirname, '../DB/RPGenius', key + '.json'), 'utf8'));
data.Item.push({ name: '천상의 회랑 입장권', type: '티켓' });
data.Paradise = { enabled: true, baseRewards: [] };
AWS.S3.prototype.makeRequest = operation => {
    if (operation === 'listObjectsV2') return { promise: async () => ({ Contents: [] }) };
    throw new Error('Unexpected isolated S3 operation: ' + operation);
};
DynamoDBDocumentClient.prototype.send = async command => {
    if (command.constructor.name === 'GetCommand' && command.input.TableName === 'rpgenius_data') return { Item: data[command.input.Key.key] ? { data: structuredClone(data[command.input.Key.key]) } : undefined };
    if (command.constructor.name === 'ScanCommand') return { Items: [] };
    throw new Error('Unexpected isolated DB write: ' + command.constructor.name);
};
const rpg = require('../rpgenius'), corridor = require('../paradise'), playful = require('../paradise_playful');
const catalog = require('../paradise_augments_playful'), mechanics = require('../paradise_mechanics'), shields = require('../combat_shields');
const name = 'paradise-playful-test';
before(() => rpg.initRpgeniusData());
afterEach(() => rpg.clearFieldRuntimeTimers(name));
function battle(user, kind = 'normal') {
    rpg.clearFieldRuntimeTimers(name); corridor.startCombat(user, kind, null, () => .99);
    Object.assign(user.paradise.enemy, { hp: 1e12, maxHp: 1e12, atk: 100, def: 0, pnt: 0, crit: 0, cmb: 0 });
}
function fresh(...augments) {
    rpg.clearFieldRuntimeTimers(name);
    const user = new rpg.RPGUser(name, name);
    user.level = 300; user.main_card = { id: 0, star: 9, type: '전직' }; user.need_character_card_select = false;
    user.hp = 19; user.mp = 7;
    rpg.addInventoryItem(user, data.Item.length - 1, 1);
    assert.equal(corridor.enter(user, () => .99).error, undefined);
    for (const id of augments) user.paradise.acquired[id] = 1;
    battle(user); return user;
}
const s = user => user.paradise.battle.playful;
const e = user => user.paradise.playfulState ||= {};
const res = user => corridor.getResources(user);
const stats = user => rpg.calculateUserStats(user);
function hit(user, extra = {}, raw = 100) {
    rpg.buildHuntResult(user, {}, raw, { isBasic: true, comboHitCount: 1, disableCritical: true, precalculatedDamage: !extra.forceCritical && extra.disableCritical !== false, ...extra });
    return user.paradise.combatEvents.at(-1);
}
function spell(user, raw = 100, name = '테스트 주문', extra = {}) {
    const packet = { isBasic: false, isSkill: true, skillName: name, ...extra };
    playful.onSkill(user, name, stats(user), packet);
    return hit(user, packet, raw);
}
function hurt(user, ratio, absorbed = 0, shieldBefore = 0) {
    const st = stats(user), lost = Math.round(st.hp * ratio);
    res(user).hp = Math.max(1, res(user).hp - lost);
    playful.onDamage(user, st, absorbed, lost, shieldBefore, {});
}
function ward(user, amount) { shields.grant(user.field, { source: 'test', caster: name, amount, expiresAt: Date.now() + 30000 }); }
function takeRoute(user, side, kinds = ['normal', 'normal']) {
    user.paradise.phase = 'route'; user.paradise.routes = kinds.map((kind, i) => ({ id: String(i), kind }));
    assert.equal(corridor.chooseRoute(user, String(side), () => .99).error, undefined);
    if (user.paradise.phase === 'combat') Object.assign(user.paradise.enemy, { hp: 1e12, maxHp: 1e12, atk: 100, def: 0 });
}

test('독립 증강 50종은 등급 비율과 기존 동일 등급 선택 계약을 지킨다', () => {
    assert.equal(catalog.length, 50); assert.equal(new Set(catalog.map(a => a.id)).size, 50);
    assert.deepEqual(catalog.reduce((out, a) => { out[a.rarity] = (out[a.rarity] || 0) + 1; return out; }, {}), { silver: 18, gold: 20, prismatic: 12 });
    assert.ok(catalog.every(a => a.floors <= 14 && a.desc.endsWith('니다.')));
    assert.ok(catalog.every(a => !a.cardContract && !a.quest));
    const user = fresh();
    for (const rarity of ['silver', 'gold', 'prismatic']) {
        corridor.offerAugments(user, () => .99, rarity);
        assert.equal(user.paradise.choices.length, 3);
        assert.ok(user.paradise.choices.every(id => corridor.AUGMENTS.find(a => a.id === id).rarity === rarity));
    }
});

test('간식과 스탬프는 피격 후 공격 종류로 회복 대상을 선택하고 한 번만 완성한다', t => {
    t.mock.method(Math, 'random', () => .99);
    let user = fresh('snackVoucher', 'punchCard'); const st = stats(user);
    res(user).mp = 0; hurt(user, .20); const before = res(user).hp; hit(user);
    assert.equal(res(user).hp, before + Math.round(st.hp * .06));
    spell(user); assert.equal(s(user).punched, true);
    assert.equal(shields.summary(user.field, Date.now()).amount, Math.round(st.hp * .15));
    const once = res(user).mp; spell(user); assert.equal(res(user).mp, once);
    user = fresh('snackVoucher'); res(user).mp = 0; hurt(user, .20); spell(user);
    assert.equal(res(user).mp, Math.round(stats(user).mp * .10));
});

test('영수증 복권은 최대 세 장이며 꽝과 당첨의 결과가 저장된다', t => {
    t.mock.method(Math, 'random', () => .99);
    const user = fresh('fortuneReceipt');
    for (let i = 0; i < 6; i++) playful.onReroll(user);
    assert.equal(e(user).lotteryTickets, 3); battle(user);
    assert.equal(e(user).lotteryTickets, 2); assert.ok(shields.summary(user.field, Date.now()).amount > 0);
    assert.match(user.paradise.rewardReveal.text, /위로상/);
    user.paradise.battle.playful = {}; playful.onBattle(user, () => 0);
    assert.equal(e(user).lotteryTickets, 1); assert.equal(s(user).receiptStrike, true);
    assert.ok(hit(user).damage > 100 + stats(user).atk); assert.equal(s(user).receiptStrike, undefined);
});

test('택배는 보호에 성공하거나 파손된 경우 중 하나만 정산한다', t => {
    t.mock.method(Math, 'random', () => .99);
    let user = fresh('fragileParcel'); hit(user); hit(user); hit(user);
    assert.equal(s(user).parcelStrike, true); assert.ok(hit(user).damage > stats(user).atk * 2);
    user = fresh('fragileParcel'); res(user).mp = 0; hurt(user, .01);
    assert.equal(res(user).mp, Math.floor(stats(user).mp * .10));
    for (let i = 0; i < 5; i++) hit(user);
    assert.equal(s(user).parcelStrike, undefined);
});

test('도시락과 포장 음식은 다음 전투에만 운반되고 바깥 자원은 그대로다', t => {
    t.mock.method(Math, 'random', () => .99);
    const user = fresh('coldPizza', 'sealedSnack'); hit(user); playful.onVictory(user);
    assert.equal(e(user).pizza, true); assert.equal(e(user).snack, true);
    battle(user); const st = stats(user); hurt(user, .20);
    assert.equal(res(user).hp, st.hp - Math.round(st.hp * .2) + Math.floor(st.hp * .1));
    assert.equal(spell(user).damage, 160); assert.equal(spell(user).damage, 100);
    assert.equal(user.hp, 19); assert.equal(user.mp, 7);
});

test('신발끈과 초인종은 행동 시간을 조정하고 반격은 한 번만 준비한다', t => {
    const now = Date.now(); t.mock.method(Date, 'now', () => now); t.mock.method(Math, 'random', () => .99);
    const user = fresh('shoeLaces', 'doorbell');
    assert.equal(user.field.nextEnemyAttackAt, now + 5500);
    hit(user); assert.equal(playful.incomingMultiplier(user, 100), .7);
    assert.ok(hit(user).damage > 100); assert.equal(hit(user).damage, 100);
});

test('종이비행기와 별똥별은 지연 피해와 다음 전투 배송을 중복 지급하지 않는다', t => {
    let now = Date.now(); t.mock.method(Date, 'now', () => now); t.mock.method(Math, 'random', () => .99);
    const user = fresh('paperAirplane', 'meteorDelivery'); spell(user); spell(user);
    assert.ok(mechanics.dots(user).some(d => d.key === 'playfulAirplane'));
    playful.onVictory(user); assert.equal(e(user).airMail, true); assert.equal(e(user).meteorMail, true);
    battle(user); const first = hit(user).damage;
    assert.ok(first > stats(user).atk * 2); assert.equal(hit(user).damage, 100);
    now += 12001; assert.ok(hit(user).damage > stats(user).atk * 6);
    assert.equal(hit(user).damage, 100); assert.equal(s(user).meteorDelivered, true);
});

test('후진 주차와 창가 좌석은 실제 이동과 실제 갈림길 위치를 따른다', t => {
    t.mock.method(Math, 'random', () => .99);
    let user = fresh('reverseParking', 'windowSeat'); user.paradise.floor = 20; corridor.move(user, -3); battle(user);
    assert.equal(playful.incomingMultiplier(user, 100), .7); assert.equal(playful.incomingMultiplier(user, 100), .7); assert.equal(playful.incomingMultiplier(user, 100), 1);
    takeRoute(user, 0); res(user).hp = Math.floor(stats(user).hp / 2); const before = res(user).hp;
    hit(user); hit(user); hit(user); assert.equal(res(user).hp, before + 2 * Math.floor(stats(user).hp * .03));
    takeRoute(user, 1); res(user).mp = 0; spell(user); spell(user); spell(user);
    assert.equal(res(user).mp, 2 * Math.round(stats(user).mp * .05));
});

test('손가락과 소매 마술은 입력 순서가 다르며 지속 피해가 입력을 만들지 않는다', t => {
    t.mock.method(Math, 'random', () => .99);
    const user = fresh('fingerPuzzle', 'streetMagician');
    assert.deepEqual(s(user).fingerPattern, ['skill', 'basic', 'basic']);
    spell(user); hit(user, { dotAttack: true, summonAttack: true, isBasic: false }); hit(user); const solved = hit(user);
    assert.equal(s(user).fingerSolved, true); assert.ok(solved.damage > stats(user).atk * 2);
    assert.equal(spell(user).damage, 180);
    assert.equal(s(user).magicUses, 1);
});

test('꽝 적립은 전투를 넘고 마침내 확정 당첨된 뒤 초기화한다', t => {
    t.mock.method(Math, 'random', () => .99);
    const user = fresh('troubleLottery');
    for (let i = 0; i < 4; i++) { assert.equal(hit(user).damage, 100); battle(user); }
    assert.ok(hit(user).damage > stats(user).atk * 2); assert.equal(e(user).lotteryMisses, 0);
    assert.equal(hit(user).damage, 100);
});

test('바나나와 아슬아슬 출석은 HP 피격으로만 충전하고 횟수 제한을 지킨다', t => {
    t.mock.method(Math, 'random', () => .99);
    const user = fresh('rottenBanana', 'escapeArtist');
    hurt(user, .35); hurt(user, .35);
    assert.equal(s(user).escapeHits, 2); assert.equal(s(user).bananaStrike, true);
    const before = user.field.nextEnemyAttackAt; hit(user);
    assert.equal(user.field.nextEnemyAttackAt, before + 1000); assert.equal(s(user).escapeHits, 1);
    hit(user); assert.equal(s(user).escapeHits, 0);
    for (let i = 0; i < 8; i++) hurt(user, .001);
    assert.equal(s(user).bananaUses, 2);
});

test('블랙잭은 공격을 더 할지 스킬로 정산할지 선택하고 초과 점수는 버린다', t => {
    t.mock.method(Math, 'random', () => .99);
    const user = fresh('blackjackCounter');
    hit(user); hit(user); hit(user); assert.equal(s(user).blackjack, 18);
    assert.equal(spell(user).damage, 200); assert.equal(s(user).blackjack, 0);
    res(user).mp = 0; for (let i = 0; i < 4; i++) hit(user);
    assert.equal(s(user).blackjack, 0); assert.equal(res(user).mp, Math.floor(stats(user).mp * .08));
    s(user).blackjack = 21; assert.equal(spell(user).damage, 300);
});

test('뜨거운 감자는 일반 공격으로 넘기거나 다른 스킬로 떨어뜨린다', t => {
    t.mock.method(Math, 'random', () => .99);
    let user = fresh('hotPotato'); spell(user); hit(user); assert.ok(hit(user).damage > stats(user).atk * 4);
    user = fresh('hotPotato'); spell(user); const before = res(user).hp; spell(user);
    assert.equal(res(user).hp, before - Math.round(before * .05)); assert.equal(s(user).potato, undefined);
});

test('봉투와 균등 정산은 저장된 추가 피해를 다시 저축하지 않는다', t => {
    t.mock.method(Math, 'random', () => .99);
    let user = fresh('sealedEnvelope'); hit(user); hit(user); assert.equal(s(user).envelope, 40);
    hurt(user, .01); assert.equal(s(user).envelope, 20);
    const critical = hit(user, { disableCritical: false, forceCritical: true });
    assert.ok(critical.hits.some(h => h.label === '봉투 개봉')); assert.equal(s(user).envelope, 0);
    user = fresh('doubleEntry'); hit(user, {}, 100); assert.equal(spell(user, 300).damage, 400);
    assert.equal(s(user).entryKind, undefined);
});

test('골든벨은 한 번에 건너뛴 HP 구간을 여러 번 완료한 것으로 세지 않는다', t => {
    t.mock.method(Math, 'random', () => .99);
    let user = fresh('goldenBell'); Object.assign(user.paradise.enemy, { maxHp: 10000, hp: 10000 });
    for (let i = 0; i < 4; i++) hit(user, {}, 2000);
    assert.equal(s(user).bellReady, true); assert.equal(spell(user, 100).damage, 200);
    user = fresh('goldenBell'); Object.assign(user.paradise.enemy, { maxHp: 10000, hp: 10000 });
    hit(user, {}, 8100); assert.equal(s(user).bellBands.length, 1); assert.equal(s(user).bellReady, undefined);
});

test('티타임과 자판기는 사용 순서와 실제 추첨 결과를 반영한다', t => {
    t.mock.method(Math, 'random', () => .99);
    const user = fresh('ceasefireTea', 'damagedVending');
    res(user).hp = Math.floor(stats(user).hp * .5); res(user).mp = 0;
    user.paradise.enemy.hp = 5e11;
    spell(user); spell(user); spell(user);
    assert.equal(s(user).teaUsed, true); assert.equal(s(user).vending, 4); assert.ok(user.paradise.enemy.hp > 5e11);
    assert.equal(hit(user).damage, 400); assert.equal(hit(user).damage, 100);
});

test('파손 교환과 트램펄린은 보호막 흡수량과 공격 선택을 사용한다', t => {
    t.mock.method(Math, 'random', () => .99);
    const user = fresh('wardWarranty', 'bounceHouse'); const st = stats(user);
    playful.onDamage(user, st, 100, 0, 100, {});
    assert.equal(s(user).warranty, true); assert.equal(s(user).balls, 1);
    res(user).hp = Math.floor(st.hp * .5); const before = res(user).hp;
    assert.ok(hit(user).damage > 100); assert.equal(res(user).hp, before + Math.round(st.hp * .08));
    for (let i = 0; i < 5; i++) playful.onDamage(user, st, 10, 0, 0, {});
    assert.equal(s(user).balls, 3); spell(user);
    assert.equal(s(user).balls, 0); assert.ok(mechanics.dots(user).some(d => d.key === 'playfulBounce'));
});

test('적의 보호막 선물과 지우개는 실제 적 보호막을 소모하고 보답을 한 번 지급한다', t => {
    t.mock.method(Math, 'random', () => .99);
    const user = fresh('enemyGift', 'eraserCrumb'); const st = stats(user);
    assert.equal(shields.summary(user.paradise.enemy, Date.now()).amount, Math.round(st.atk * 4));
    spell(user, st.atk * 3);
    assert.equal(shields.summary(user.paradise.enemy, Date.now()).amount, 0);
    assert.ok(shields.summary(user.field, Date.now()).amount > 0);
    assert.equal(spell(user).damage, 175); assert.equal(spell(user).damage, 100);
});

test('목숨 줄다리기와 룰렛은 선택한 규칙을 저장하며 모든 분기가 발동한다', t => {
    t.mock.method(Math, 'random', () => .99);
    let user = fresh('healthTug'); res(user).hp = Math.floor(stats(user).hp * .5);
    assert.equal(hit(user).damage, 125); user.paradise.enemy.hp = user.paradise.enemy.maxHp * .10;
    assert.equal(playful.incomingMultiplier(user, 100), .8);
    for (const [roll, mode] of [[0, 'gravity'], [.4, 'fire'], [.9, 'recoil']]) {
        user = fresh('rouletteBrake'); playful.onChoose(user, catalog.find(a => a.id === 'rouletteBrake'), () => roll);
        assert.equal(e(user).rouletteMode, mode); assert.ok(user.paradise.rewardReveal.text.length > 10);
        if (mode === 'gravity') { hit(user); hit(user); hit(user); assert.ok(hit(user).damage > stats(user).atk * 2); }
        if (mode === 'fire') { spell(user); spell(user); spell(user); assert.ok(mechanics.dots(user).some(d => d.key === 'playfulFire')); }
        if (mode === 'recoil') { hurt(user, .1); assert.ok(shields.summary(user.field, Date.now()).amount > 0); }
    }
});

test('야유는 피해와 실패를 환호로 바꾸고 반복 무한 발동하지 않는다', t => {
    t.mock.method(Math, 'random', () => .99);
    const user = fresh('pendingApplause'); spell(user); spell(user); hurt(user, .01); hurt(user, .01);
    assert.equal(s(user).applauseHits, 2);
    assert.equal(hit(user, { disableCritical: false }).criticalCount, 1);
    assert.equal(hit(user, { disableCritical: false }).criticalCount, 1);
    spell(user); hurt(user, .01); assert.equal(s(user).applauseHits, 0);
});

test('문짝과 오타 지도는 이벤트를 지나 다음 전투에 전달된다', t => {
    t.mock.method(Math, 'random', () => .99);
    const user = fresh('doorPrize', 'misprintedMap');
    takeRoute(user, 0, ['event', 'event']); assert.equal(e(user).door, true); assert.equal(e(user).mapGuard, true);
    battle(user); hit(user); hit(user); hit(user); hit(user);
    assert.equal(shields.summary(user.field, Date.now()).amount, Math.round(stats(user).hp * .05) * 3);
    assert.equal(playful.incomingMultiplier(user, 100), 0); assert.equal(playful.incomingMultiplier(user, 100), 1.2); assert.equal(playful.incomingMultiplier(user, 100), 1.2); assert.equal(playful.incomingMultiplier(user, 100), 1);
});

test('파손 비용은 새로 생긴 적 보호막을 제거한 뒤 한 번만 정산한다', t => {
    t.mock.method(Math, 'random', () => .99);
    const user = fresh('breakGlass'); const st = stats(user);
    playful.onDamage(user, st, 100, 0, 100, {}); res(user).mp = 0; user.field.skillCooldowns['테스트 주문'] = Date.now() + 60000;
    hit(user, {}, st.hp); assert.equal(shields.summary(user.paradise.enemy, Date.now()).amount, 0);
    assert.ok(user.field.skillCooldowns['테스트 주문'] <= Date.now()); assert.equal(res(user).mp, Math.round(st.mp * .15));
    hit(user); assert.equal(res(user).mp, Math.round(st.mp * .15));
});

test('소음과 관객 투표는 반복 공격과 다음 전투의 반대 공격을 유도한다', t => {
    t.mock.method(Math, 'random', () => .99);
    const user = fresh('noisyNeighbors', 'audienceVote');
    for (let i = 0; i < 5; i++) hit(user);
    assert.ok(hit(user).damage > stats(user).atk * 7); assert.equal(playful.incomingMultiplier(user, 100), 1.5);
    playful.onVictory(user); battle(user);
    assert.equal(spell(user).damage, 150); assert.equal(spell(user).damage, 150); assert.equal(spell(user).damage, 100);
});

test('작은 이동 영수증과 미개봉 상자는 종료 보상 상한을 지킨다', t => {
    t.mock.method(Math, 'random', () => .99);
    const user = fresh('rewardReceipt', 'schrodingerBox');
    for (let i = 0; i < 15; i++) playful.onChoose(user, { id: 'test', floors: 5 });
    assert.equal(e(user).rewardReceiptBonus, .16);
    for (let i = 0; i < 8; i++) { playful.onVictory(user); playful.onReroll(user, null, null, () => 0); }
    assert.equal(e(user).boxOpened, 2); assert.equal(e(user).schrodingerBoxBonus, .20);
    assert.ok(Math.abs(user.paradise.effects.reward - .36) < 1e-8);
});

test('피해 덱은 매 다섯 장에 대박 한 장이며 다음 배율을 미리 표시한다', t => {
    t.mock.method(Math, 'random', () => .99);
    const user = fresh('loadedDeck');
    assert.equal(playful.view(user)[0].value, '60%');
    const values = Array.from({ length: 10 }, () => hit(user).damage);
    assert.deepEqual(values, [60, 60, 60, 60, 360, 60, 60, 60, 60, 360]);
    const old = s(user).deck.slice(); hit(user, { dotAttack: true, summonAttack: true }); assert.deepEqual(s(user).deck, old);
});

test('앙숙은 엘리트 공격력을 다음 전투 세 번에 나눠 쓰고 상한을 지킨다', t => {
    t.mock.method(Math, 'random', () => .99);
    const user = fresh('pocketNemesis'); user.paradise.enemy.kind = 'elite'; user.paradise.enemy.atk = 1e9;
    playful.onVictory(user); battle(user);
    for (let i = 0; i < 3; i++) assert.equal(spell(user).damage, 100 + stats(user).atk * 3);
    assert.equal(spell(user).damage, 100);
});

test('큰 피해는 한입 지속 피해로 바뀌며 생성된 지속 피해가 다시 분할되지 않는다', t => {
    t.mock.method(Math, 'random', () => .99);
    const user = fresh('damageDiet'); Object.assign(user.paradise.enemy, { maxHp: 10000, hp: 10000 });
    const result = hit(user, {}, 3000); assert.equal(result.damage, 800);
    const stored = mechanics.dots(user).find(d => d.key === 'playfulDiet'); assert.ok(stored.damage * stored.ticks <= stats(user).atk * 15 + 2);
    const before = mechanics.dots(user).length; hit(user, { dotAttack: true, paradiseDot: true, summonAttack: true, isBasic: false }, 900);
    assert.equal(mechanics.dots(user).length, before);
});

test('구급차는 큰 피격 이후 세 번만 회복하고 경매는 세 번째 피격 뒤에 정산한다', t => {
    t.mock.method(Math, 'random', () => .99);
    let user = fresh('rescuePunch'); hurt(user, .30); assert.equal(s(user).rescueHits, 3);
    for (let i = 0; i < 3; i++) assert.ok(hit(user).damage > stats(user).atk);
    assert.equal(hit(user).damage, 100);
    user = fresh('scarecrowAuction');
    for (let i = 0; i < 3; i++) { assert.equal(playful.incomingMultiplier(user, 100), 1.3); hurt(user, .01); }
    assert.ok(shields.summary(user.field, Date.now()).amount > 0); assert.ok(hit(user).damage > stats(user).atk * 7);
    assert.equal(playful.incomingMultiplier(user, 100), 1);
});

test('2페이즈 전환과 도둑단은 실제 적 스탯을 한 번만 바꾼다', t => {
    t.mock.method(Math, 'random', () => .99);
    const user = fresh('phaseExchange', 'theHeist'); Object.assign(user.paradise.enemy, { maxHp: 10000, hp: 10000, atk: 1000, def: 0 });
    user.field.skillCooldowns['테스트 주문'] = Date.now() + 60000;
    hit(user, {}, 5100); assert.equal(user.paradise.enemy.atk, 1300); assert.ok(user.field.skillCooldowns['테스트 주문'] <= Date.now());
    hit(user); hit(user); spell(user); spell(user);
    assert.equal(user.paradise.enemy.atk, 1040); assert.equal(s(user).heistUsed, true);
    hit(user); assert.equal(user.paradise.enemy.atk, 1040);
});

test('천장 확률은 보장 당첨에 도달하며 한 전투 다섯 번으로 제한한다', t => {
    t.mock.method(Math, 'random', () => .99);
    const user = fresh('pityMachine');
    for (let i = 0; i < 60; i++) hit(user);
    assert.equal(s(user).pityWins, 5); assert.equal(hit(user).damage, 100);
});

test('궁극기 투척은 실제 궁극기 경로에서 MP와 보호막을 소비하고 명장면을 한 번 재생한다', async t => {
    t.mock.method(Math, 'random', () => .99);
    let now = Date.now(); t.mock.method(Date, 'now', () => now);
    const user = fresh('kitchenSink', 'cutsceneCoupon'); const st = stats(user);
    now += 10000;
    spell(user, 100, '테스트 주문', { disableCritical: false, forceCritical: true }); assert.ok(s(user).cutsceneDamage > 0);
    ward(user, st.hp * .30); res(user).mp = st.mp; user.field.nextActionAt = 0;
    const ultimate = rpg.getUltimateSkills(user)[0]?.skill?.name; assert.ok(ultimate);
    const text = await rpg.useSkillInField(user, ultimate); assert.ok(!text.startsWith('❌'), text);
    assert.equal(s(user).kitchenUsed, true); assert.equal(s(user).cutsceneUsed, true);
    assert.equal(shields.summary(user.field, Date.now()).amount, 0); assert.equal(res(user).mp, 0);
});

test('쌍방 과실은 HP 비율을 양방향으로 중재하고 회복 금지를 우회하지 않는다', t => {
    t.mock.method(Math, 'random', () => .99);
    const user = fresh('forcedMediation'); const st = stats(user);
    res(user).hp = Math.round(st.hp * .2); s(user).hpHits = 1;
    user.paradise.effects.noHealing = 1; const before = res(user).hp;
    spell(user); assert.equal(res(user).hp, before); assert.ok(user.paradise.enemy.hp < user.paradise.enemy.maxHp * .81);
    battle(user); delete user.paradise.effects.noHealing; res(user).hp = st.hp; user.paradise.enemy.hp = user.paradise.enemy.maxHp * .10; s(user).hpHits = 1;
    spell(user); assert.equal(res(user).hp, st.hp - Math.round(st.hp * .2)); assert.ok(user.paradise.enemy.hp > user.paradise.enemy.maxHp * .29);
});

test('지옥과 일반 필드에는 신규 증강의 피해 카드나 보상 효과가 적용되지 않는다', t => {
    t.mock.method(Math, 'random', () => .99);
    const user = fresh('loadedDeck', 'rewardReceipt'); user.paradise.mode = 'hell';
    const extra = { isBasic: true }, result = { finalDamage: 100, hitDetails: [{ damage: 100 }] };
    playful.prepareAttack(user, stats(user), extra); playful.modifyHit(user, stats(user), extra, result);
    playful.onChoose(user, { id: 'test', floors: 5 }); assert.equal(result.finalDamage, 100); assert.equal(e(user).smallSteps, undefined);
    assert.deepEqual(playful.view(user), []);
});

test('정밀 마무리 환불은 실제 승리에서만 지급되고 초과 피해가 크면 지급하지 않는다', t => {
    t.mock.method(Math, 'random', () => .99);
    for (const [raw, paid] of [[100, true], [200, false]]) {
        const user = fresh('refundStamp'), st = stats(user);
        res(user).hp = Math.floor(st.hp * .5); res(user).mp = 0;
        Object.assign(user.paradise.enemy, { hp: 100, maxHp: 1000 });
        const hp = res(user).hp; hit(user, {}, raw);
        assert.equal(user.paradise.battlesWon, 1);
        assert.equal(res(user).hp, hp + (paid ? Math.round(st.hp * .10) : 0));
        assert.equal(res(user).mp, paid ? Math.round(st.mp * .10) : 0);
    }
});

test('반사로 이미 사망한 상태에서는 타격 후 환불과 2페이즈 회복이 부활시키지 않는다', () => {
    const user = fresh('refundStamp', 'phaseExchange'), st = stats(user);
    Object.assign(user.paradise.enemy, { hp: 0, maxHp: 1000 }); res(user).hp = 0; res(user).mp = 0;
    playful.afterHit(user, st, { isBasic: true, paradiseEnemyHpBefore: 100 }, { finalDamage: 100, criticalCount: 0 });
    assert.equal(res(user).hp, 0); assert.equal(res(user).mp, 0); assert.equal(s(user).phaseChanged, undefined);
});

test('골든벨은 회복시킨 적의 같은 구간을 반복 통과해도 중복 도장을 찍지 않는다', t => {
    t.mock.method(Math, 'random', () => .99);
    const user = fresh('goldenBell'); Object.assign(user.paradise.enemy, { maxHp: 10000, hp: 10000 });
    for (let i = 0; i < 4; i++) { user.paradise.enemy.hp = 10000; hit(user, {}, 2100); }
    assert.deepEqual(s(user).bellBands, [.8]); assert.equal(s(user).bellReady, undefined);
});

test('상자 실패 위로상과 덱의 다음 패는 저장 후 재개해도 다시 추첨하지 않는다', t => {
    t.mock.method(Math, 'random', () => .99);
    const user = fresh('schrodingerBox', 'loadedDeck'); playful.onVictory(user);
    playful.onReroll(user, null, null, () => .99); assert.equal(e(user).boxGuard, true);
    battle(user); hit(user); const next = s(user).deck[0];
    user.paradise = JSON.parse(JSON.stringify(user.paradise));
    assert.equal(s(user).deck[0], next); assert.equal(playful.incomingMultiplier(user, 100), 0);
    assert.equal(playful.incomingMultiplier(user, 100), 1); assert.equal(e(user).boxOpened, 1);
});
