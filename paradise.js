const crypto = require('crypto');
const { AUGMENTS, RELICS, EVENTS, EQUIPMENT_NAMES } = require('./paradise_content');
const wisdom = require('./wisdom_puzzle');
const rpg = () => require('./rpgenius');
const TICKET = '천상의 회랑 입장권';
const MAX_FLOOR = 999;
const CP_ANCHORS = [[1, 10000], [10, 100000], [100, 1000000], [200, 10000000], [300, 30000000], [400, 60000000], [500, 100000000], [600, 200000000], [700, 300000000], [800, 400000000], [900, 500000000], [999, 600000000]];
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const pick = (list, random = Math.random) => list[Math.min(list.length - 1, Math.floor(random() * list.length))];
const active = user => user?.paradise?.status === 'active' && user.field?.paradise === true;
const has = (run, id) => run.relics.includes(id);
const log = (run, text) => { run.history.unshift({ floor: run.floor, text }); run.history.length = Math.min(60, run.history.length); };

function weeklyInfo(user, date = new Date()) {
    const week = rpg().getKoreanWeekKey(date), stored = user.paradiseWeekly;
    const kst = new Date(date.getTime() + 9 * 3600000);
    const resetsAt = Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate() + 8 - (kst.getUTCDay() || 7)) - 9 * 3600000;
    return { week, bestFloor: stored?.week === week ? Number(stored.bestFloor || 0) : 0, reachedAt: stored?.week === week ? Number(stored.reachedAt || 0) : 0, resetsAt };
}
function recordFloor(user, date = new Date()) {
    if (user.paradise.mode === 'hell') { user.paradise.highestFloor = Math.max(user.paradise.highestFloor || 0, user.paradise.floor); return; }
    const info = weeklyInfo(user, date), floor = clamp(Number(user.paradise.floor), 1, MAX_FLOOR);
    user.paradise.highestFloor = Math.max(Number(user.paradise.highestFloor || user.paradise.clearedFloor || 0), floor);
    if (user.paradiseWeekly?.week && user.paradiseWeekly.week !== info.week) {
        user.paradiseWeeklyHistory ||= {};
        user.paradiseWeeklyHistory[user.paradiseWeekly.week] = { ...user.paradiseWeekly };
    }
    if (floor > info.bestFloor) user.paradiseWeekly = { week: info.week, bestFloor: floor, reachedAt: date.getTime() };
}
function buildWeeklyRanking(users, user, date = new Date()) {
    const info = weeklyInfo(user, date);
    const ranked = users.map(candidate => ({ name: candidate.name, ...weeklyInfo(candidate, date) })).filter(row => row.bestFloor > 0)
        .sort((a, b) => b.bestFloor - a.bestFloor || a.reachedAt - b.reachedAt || a.name.localeCompare(b.name, 'ko'))
        .map((row, index) => ({ rank: index + 1, name: row.name, floor: row.bestFloor, reachedAt: row.reachedAt }));
    return { week: info.week, resetsAt: info.resetsAt, total: ranked.length, me: ranked.find(row => row.name === user.name) || { rank: null, name: user.name, floor: 0 }, rows: ranked.slice(0, 100) };
}

function validateConfig(config) {
    if (!config || typeof config.enabled !== 'boolean' || !Array.isArray(config.baseRewards)) return 'enabled와 baseRewards를 지정해주세요.';
    for (const reward of config.baseRewards) {
        if (!reward || !['골드', '경험치', '아이템'].includes(reward.type) || !Number.isSafeInteger(reward.count) || reward.count < 1 || !Number.isSafeInteger(reward.perFloors) || reward.perFloors < 1 || reward.perFloors > 999 || reward.type === '아이템' && (typeof reward.name !== 'string' || !reward.name.trim())) return '기본 보상은 type(골드/경험치/아이템), 양의 정수 count·perFloors, 아이템 name이 필요합니다.';
    }
    if (config.milestoneRewards !== undefined && (!Array.isArray(config.milestoneRewards) || config.milestoneRewards.some((r, i, all) => !r || !Number.isInteger(r.floor) || r.floor < 1 || r.floor > 999 || i > 0 && r.floor <= all[i - 1].floor || !Number.isSafeInteger(r.count) || r.count < 1 || typeof r.name !== 'string' || !r.name.trim()))) return '달성 보상은 오름차순 floor, 아이템 name, 양의 정수 count가 필요합니다.';
    if (config.weeklyRewards !== undefined) {
        const w = config.weeklyRewards;
        const valid = list => Array.isArray(list) && list.every(r => r && (r.type === '아이템' && typeof r.name === 'string' && r.name.trim() || r.type === '가넷') && Number.isSafeInteger(r.count) && r.count > 0);
        if (!w || !valid(w.participation) || !Array.isArray(w.ranks) || w.ranks.some((r, i, all) => !r || !Number.isInteger(r.from) || !Number.isInteger(r.to) || r.from < 1 || r.to < r.from || i > 0 && r.from <= all[i - 1].to || !valid(r.rewards))) return '주간 보상은 participation과 겹치지 않는 ranks(from/to/rewards)가 필요합니다.';
    }
    if (config.hell !== undefined) return require('./paradise_hell').validateConfig(config.hell);
    return null;
}
function recommendedPower(floor) {
    floor = clamp(Number(floor), 1, MAX_FLOOR);
    const i = CP_ANCHORS.findIndex(([f]) => f >= floor);
    if (i === 0) return CP_ANCHORS[0][1];
    const [a, x] = CP_ANCHORS[i - 1], [b, y] = CP_ANCHORS[i];
    return Math.round(x + (y - x) * (floor - a) / (b - a));
}
function equipmentOptions(user) {
    return rpg().getEquippedEquipmentData(user).filter(({ data }) => EQUIPMENT_NAMES.includes(data.name) && rpg().isEquipmentEffectActive(user, data)).map(({ ref, data }) => ({ name: data.name, slot: ref.type }));
}
function equipmentMultiplier(user, name, scope = 'combat') {
    if (!active(user)) return 1;
    const run = user.paradise;
    let multiplier = 1 + Number(run.equipmentPermanent[name] || 0);
    for (const buff of run.temporary) if (buff.battles > 0 && buff.equipment === name && !(buff.combatOnly && scope !== 'combat')) multiplier *= buff.multiplier;
    if (has(run, 'sheath') && user.equipments?.weapon && rpg().getEquipmentData('weapon', user.equipments.weapon.id)?.name === name) multiplier += .20;
    return multiplier;
}
function sumEffects(run) {
    const effects = { ...run.effects };
    for (const buff of run.temporary) if (buff.battles > 0) for (const [key, n] of Object.entries(buff.effects || {})) effects[key] = Number(effects[key] || 0) + n;
    if (has(run, 'redContract')) { effects.hp = Number(effects.hp || 0) - .20; effects.final = Number(effects.final || 0) + .20; }
    if (has(run, 'necklace')) effects.taken = Number(effects.taken || 0) + .15;
    if (has(run, 'judgment')) effects.final = Number(effects.final || 0) + .35;
    if (has(run, 'riftHeart')) { effects.atk = Number(effects.atk || 0) + .40; effects.taken = Number(effects.taken || 0) - .15; }
    return effects;
}
function applyStats(user, stats) {
    if (!active(user)) return;
    const run = user.paradise, effects = sumEffects(run);
    for (const key of ['hp', 'mp', 'def']) stats[key] = Math.max(key === 'mp' ? 0 : 1, Math.round(Number(stats[key] || 0) * Math.max(.05, 1 + Number(effects[key] || 0))));
    const missingHp = 1 - clamp(Number(user.hp ?? stats.hp) / stats.hp, 0, 1);
    stats.atk = Math.max(1, Math.round(Number(stats.atk || 0) * Math.max(.05, 1 + Number(effects.atk || 0) + Number(run.compass || 0) + (effects.risk ? missingHp * .50 : 0))));
    stats.finalDamage = Number(stats.finalDamage || 0) + Number(effects.final || 0) + (effects.lastStand && Number(user.hp ?? stats.hp) <= stats.hp * .30 ? .40 : 0);
    stats.takenDamage = Number(stats.takenDamage || 0) + Number(effects.taken || 0);
    stats.maxCmb = Number(stats.maxCmb || 0) + Number(effects.maxCmb || 0);
    stats.critMul = Number(stats.critMul || 0) + Number(run.focus || 0);
}
function heal(user, hp = 0, mp = 0) {
    if (user.paradise.effects.noHealing) return;
    const stats = rpg().calculateUserStats(user);
    user.hp = Math.min(stats.hp, Number(user.hp) + Math.round(stats.hp * hp));
    user.mp = Math.min(stats.mp, Number(user.mp) + Math.round(stats.mp * mp));
}
function clampResources(user) {
    const stats = rpg().calculateUserStats(user);
    user.hp = clamp(Number(user.hp), 1, stats.hp);
    user.mp = clamp(Number(user.mp), 0, stats.mp);
}
function addEffect(user, effects, copyable = true) {
    const run = user.paradise;
    for (const [key, n] of Object.entries(effects)) run.effects[key] = Number(run.effects[key] || 0) + n;
    if (copyable) {
        const copy = Object.fromEntries(Object.entries(effects).filter(([key, n]) => ['atk', 'def', 'hp', 'mp', 'final', 'maxCmb', 'taken'].includes(key) && (key === 'taken' ? n < 0 : n > 0)));
        if (Object.keys(copy).length) run.lastStatBuff = copy;
    }
    clampResources(user);
}
function move(user, floors, dangerous = false) {
    const run = user.paradise;
    run.floor = clamp(run.floor + floors, 1, MAX_FLOOR);
    // 지정되지 않은 중간 이동량은 구간으로 처리: +5 이하 0 / +6〜15 +5 / +16 이상 +15.
    const distortion = floors < 0 ? -5 : floors <= 5 ? 0 : floors <= 15 ? 5 : 15;
    run.distortion = clamp(run.distortion + distortion + (dangerous ? 10 : 0), 0, 100);
    recordFloor(user);
    if (floors < 0 && has(run, 'compass')) run.compass = Math.min(.20, Number(run.compass || 0) + .04);
    if (floors >= 20 && has(run, 'ring')) run.ring = Math.min(.25, Number(run.ring || 0) + .05);
}
function grantRelic(user, special, random = Math.random) {
    const run = user.paradise;
    const pool = RELICS.filter(relic => special ? relic.id === special : !relic.special && !has(run, relic.id));
    if (!pool.length) { addEffect(user, { atk: .05 }); log(run, '유물의 잔향: 공격력 +5%'); return; }
    const relic = pick(pool, random);
    if (!has(run, relic.id)) run.relics.push(relic.id);
    clampResources(user);
    log(run, '회랑 유물 획득 · ' + relic.name);
}
function offerAugments(user, random = Math.random) {
    const run = user.paradise, equipped = equipmentOptions(user).map(e => e.name);
    const pool = AUGMENTS.filter(a => (!a.equipment || equipped.includes(a.equipment)) && (a.special !== 'duplicate' || run.lastStatBuff) && (!run.acquired[a.id] || !['lastStand', 'firstStrike', 'execution', 'unyielding', 'manaCycle', 'focus', 'thirst', 'risk', 'comeback', 'devil'].includes(a.id)));
    const choices = [];
    while (choices.length < 3 && pool.length) {
        // 뒤틀림 50 이상에서는 저주받은 선택지가 더 자주 제시된다.
        const weighted = pool.flatMap(a => Array(a.rarity === 'cursed' && run.distortion >= 50 ? 3 : 1).fill(a));
        const choice = pick(weighted, random); choices.push(choice.id); pool.splice(pool.indexOf(choice), 1);
    }
    run.phase = 'augment'; run.choices = choices; run.event = null;
}
function createMonster(user, kind = 'normal', random = Math.random) {
    const run = user.paradise, fields = rpg().getRegularFieldDungeons().filter(d => d.hp > 0 && d.atk >= 0);
    if (!fields.length) throw new Error('재사용할 필드 몬스터가 없습니다.');
    const index = Math.min(fields.length - 1, Math.floor((run.floor - 1) / (run.mode === 'hell' ? 100 : MAX_FLOOR) * fields.length));
    const offset = random() < .5 ? 0 : 1;
    const source = fields[Math.min(fields.length - 1, index + offset)];
    const sourceIndex = rpg().getRegularFieldDungeons().findIndex(d => d.name === source.name);
    const base = kind === 'normal' ? source : source.elite || source;
    const power = run.mode === 'hell' ? require('./paradise_hell').recommendedPower(run.floor) : recommendedPower(run.floor) * (kind === 'elite' ? 1.2 : kind === 'judge' ? 3.5 : kind === 'rift' ? 4 : kind === 'final' ? 2 : 1);
    // 기존 권장 전투력 계산에 맞춰 HP/공격력 배율을 이분 탐색한다.
    const defense = Math.max(0, Math.round(Math.sqrt(power) / 18));
    const template = { atk: Math.max(1, Number(base.atk || 1)), hp: Math.max(1, Number(base.hp || 1)), def: defense, pnt: Math.round(defense * .4), crit: Number(base.crit || .05), critMul: Number(base.critMul || 1.5), cmb: Number(base.cmb || .05), maxCmb: Number(base.maxCmb || 0) };
    let low = 0, high = Math.max(1, power);
    for (let i = 0; i < 60; i++) {
        const scale = (low + high) / 2;
        const cp = rpg().getDungeonRecommendedCP({ ...template, atk: template.atk * scale, hp: template.hp * scale });
        if (cp < power) low = scale; else high = scale;
    }
    const enemy = { ...template, id: crypto.randomUUID(), kind, name: kind === 'judge' ? '회랑의 심판자' : kind === 'rift' ? '균열을 삼키는 자' : kind === 'final' ? '천상의 마지막 수문장' : kind === 'normal' ? source.name + '의 망령' : base.name || source.name + '의 정예',
        hp: Math.max(1, Math.round(template.hp * high)), atk: Math.max(1, Math.round(template.atk * high)), recommendedPower: Math.round(power), sourceIndex, sourceField: source.name, traits: [] };
    enemy.maxHp = enemy.hp;
    if (run.mode === 'hell') enemy.name = (kind === 'boss' ? '지옥의 지배자 · ' : kind === 'elite' ? '지옥의 정예 · ' : '지옥의 ') + (base.name || source.name);
    if (run.distortion >= 50 && random() < (run.distortion >= 75 ? .65 : .20)) {
        const trait = pick(['광폭 · 공격력 +25%', '철갑 · 방어력 +30%', '거대 · HP +30%'], random);
        enemy.traits.push(trait);
        if (trait.startsWith('광폭')) enemy.atk = Math.round(enemy.atk * 1.25);
        if (trait.startsWith('철갑')) enemy.def = Math.round(enemy.def * 1.30);
        if (trait.startsWith('거대')) enemy.hp = enemy.maxHp = Math.round(enemy.hp * 1.30);
    }
    return enemy;
}
function startCombat(user, kind = 'normal', sequence = null, random = Math.random) {
    const run = user.paradise;
    rpg().clearFieldRuntimeTimers(user.name);
    run.phase = 'combat'; run.event = null; run.choices = []; run.sequence = sequence;
    run.lastOutcome = null;
    const enemy = createMonster(user, kind, random);
    if (kind === 'mirror') {
        const baseUser = { ...user, field: null, paradise: null, hp: undefined, mp: undefined };
        const mirror = require('./pvp').createCorridorMirror(baseUser);
        Object.assign(enemy, structuredClone(mirror.snapshot.stats), { kind, name: '거울 속의 ' + user.name, hp: mirror.hp, maxHp: mirror.maxHp, mp: mirror.mp, maxMp: mirror.maxMp, mirror, traits: ['회랑 강화·유물 없음 · HP·MP 100%'] });
        enemy.recommendedPower = rpg().calculateCombatPower(baseUser).total;
    }
    if (kind === 'elite' && run.nextEliteAttack) { enemy.atk = Math.round(enemy.atk * 1.5); run.nextEliteAttack = false; enemy.traits.push('저주받은 보물 · 공격력 +50%'); }
    if (kind === 'elite' && run.nextEliteHp) { enemy.hp = enemy.maxHp = Math.round(enemy.hp * 1.5); run.nextEliteHp = false; enemy.traits.push('대장장이의 대가 · HP +50%'); }
    if (has(run, 'hourglass')) enemy.atk = Math.round(enemy.atk * .70);
    const collapse = run.temporary.some(buff => buff.id === 'collapse' && buff.battles > 0);
    if (collapse) { enemy.atk *= 2; enemy.traits.push('붕괴 · 공격력·보상 2배'); }
    run.enemy = enemy; run.battle = { firstAttack: true, firstSkill: true, survived: false, comeback: 0, doubledReward: collapse, insurance: run.insurance === true };
    recordFloor(user);
    run.insurance = false;
    user.field = { name: run.mode === 'hell' ? '지옥' : '천상의 회랑', paradise: true, enteredAt: Date.now(), nextActionAt: 0, skillCooldowns: {}, equipmentState: {}, elite: kind === 'normal' ? null : { hp: enemy.hp, encounteredAt: Date.now() } };
    if (has(run, 'orb')) heal(user, 0, .30);
    log(run, `${enemy.name} 조우 · 권장 전투력 ${enemy.recommendedPower.toLocaleString('ko-KR')}`);
}
function nextEncounter(user, random = Math.random) {
    const run = user.paradise;
    if (run.distortion >= 100) { run.phase = 'event'; run.event = { id: 'collapse' }; return; }
    if (run.floor === MAX_FLOOR) return startCombat(user, 'final', null, random);
    if (run.forceElite) { run.forceElite = false; return startCombat(user, 'elite', null, random); }
    const eliteChance = run.distortion >= 25 ? .30 : .15;
    const roll = random();
    if (roll < .35) {
        const pool = Object.keys(EVENTS).filter(id => id !== 'collapse' && (id !== 'forge' || equipmentOptions(user).length));
        if (run.distortion >= 50) pool.push('mirror', 'chests', 'judge');
        const id = pick(pool, random);
        run.phase = 'event'; run.event = { id };
        if (id === 'forge') run.event.equipment = pick(equipmentOptions(user), random).name;
        log(run, EVENTS[id].title);
    } else startCombat(user, roll < .35 + eliteChance ? 'elite' : 'normal', null, random);
}
function enter(user, random = Math.random) {
    if (user.paradise?.status === 'active' || user.field || require('./partyquest').getRoomOf(user.name) || user.pvp?.battle && user.pvp.battle.phase !== 'ended') return { error: '진행 중인 전투나 탐험을 먼저 마쳐주세요.' };
    if (user.paradise?.status === 'ended' && !user.paradise.claimed) return { error: '지난 탐험의 종료 보상을 먼저 수령해주세요.' };
    if (!user.main_card || user.need_character_card_select) return { error: '메인 카드를 먼저 선택해주세요.' };
    if (user.pendingAction || user.pendingFragment || user.fishing === true) return { error: '진행 중인 작업이나 보상 선택을 먼저 완료해주세요.' };
    const config = rpg().getDataCache('Paradise', null);
    if (validateConfig(config) || !config.enabled) return { error: '천상의 회랑 입장이 아직 열리지 않았습니다.' };
    const id = rpg().getDataCache('Item', []).findIndex(i => i?.name === TICKET);
    if (id < 0 || rpg().getInventoryItemCount(user, id) < 1) return { error: TICKET + ' 1장이 필요합니다.' };
    const stats = rpg().calculateUserStats(user);
    if (Number(user.hp ?? stats.hp) <= 1) return { error: 'HP를 회복한 후 입장해주세요.' };
    rpg().removeInventoryItem(user, id, 1);
    user.hp = Math.min(stats.hp, Number(user.hp ?? stats.hp)); user.mp = Math.min(stats.mp, Number(user.mp ?? stats.mp));
    user.paradise = { id: crypto.randomUUID(), revision: 0, status: 'active', phase: 'combat', floor: 1, clearedFloor: 0, distortion: 0, effects: {}, relics: [], temporary: [], equipmentPermanent: {}, history: [], acquired: {}, contracts: [], battlesWon: 0, elitesWon: 0, rewardUnits: 0, eliteUnits: 0, startedAt: Date.now(), baseRewards: structuredClone(config.baseRewards), receipt: null };
    user.paradise.milestoneRewards = structuredClone(config.milestoneRewards || []);
    startCombat(user, 'normal', null, random);
    return { message: '입장권 1장을 사용했습니다. 천상의 회랑에 입장합니다.' };
}
function chooseAugment(user, id, random = Math.random) {
    const run = user.paradise;
    if (run.phase !== 'augment' || !run.choices.includes(id)) return { error: '현재 제시된 강화 중 하나를 선택해주세요.' };
    const choice = AUGMENTS.find(a => a.id === id);
    if (choice.equipment && !equipmentOptions(user).some(e => e.name === choice.equipment)) return { error: '해당 장비가 장착되어 있지 않습니다.' };
    addEffect(user, choice.effect);
    if (choice.equipment) run.temporary.push({ id, name: choice.name, equipment: choice.equipment, multiplier: choice.multiplier, battles: choice.battles, combatOnly: true });
    switch (choice.special) {
        case 'future': run.temporary.push({ id, name: choice.name, battles: 3, effects: { atk: .50 }, forceEliteAfter: true }); break;
        case 'insurance': run.insurance = true; break;
        case 'duplicate': addEffect(user, Object.fromEntries(Object.entries(run.lastStatBuff).map(([key, value]) => [key, value * .5]))); break;
        case 'forbidden': run.temporary.push({ id, name: choice.name, battles: 1, effects: { taken: .50 }, cooldown: .50 }); break;
        case 'rewind': heal(user, 1, 1); run.forceElite = true; break;
        case 'gambler': { const won = random() < .5; addEffect(user, { atk: won ? .30 : -.20 }); log(run, '회랑의 도박사 · ' + (won ? '공격력 +30%' : '공격력 -20%')); break; }
        case 'cursedTreasure': run.nextEliteAttack = true; break;
        case 'greed': run.temporary.push({ id, name: choice.name, battles: 3, rewardAfter: .20 }); break;
        case 'contract': run.contracts.push({ star: 5, type: '전직', name: '5성 전직 카드' }); break;
        case 'breath': heal(user, 0, .20); break;
        case 'pilgrim': heal(user, .15, 0); break;
        case 'clarity': run.distortion = Math.max(0, run.distortion - 10); break;
        case 'rest': heal(user, .30, .30); break;
    }
    run.acquired[id] = Number(run.acquired[id] || 0) + 1;
    move(user, choice.floors, choice.dangerous);
    log(run, `${choice.name} · ${choice.floors > 0 ? '+' : ''}${choice.floors}층`);
    nextEncounter(user, random);
    return { message: choice.name + ' 획득' };
}
function eventChoices(user) {
    const event = user.paradise.event;
    if (!event) return [];
    const chance = has(user.paradise, 'dice') ? 10 : 0, equipment = event.equipment;
    const entries = {
        puzzle: [['solve', '봉인을 푼다', '120초 안에 성공: 공격력 +10% 또는 최종 피해 +8%, +10층, 뒤틀림 -10. 실패: 현재 HP -15%.'], ['skip', '그냥 지나간다', '+5층. 페널티 없이 퍼즐을 건너뜁니다.']],
        casino: [['safe', '안전한 도박', `성공 확률 ${70 + chance}% · 성공: +10층, 공격력 +10%. 실패: 현재 HP -10%.`], ['risk', '위험한 도박', `성공 확률 ${30 + chance}% · 성공: +50층, 공격력 +30%. 실패: 공격력 -15%.`], ['attack', '도박사를 공격한다', '엘리트 전투 · 승리: 회랑 유물 획득.']],
        forge: [['enhance', equipment + ' 강화', '다음 3회 전투 수치형 패시브 2배. 다음 엘리트 HP +50%.'], ['modify', equipment + ' 개조', '이번 탐험 동안 수치형 패시브 +20%. 최대 HP -15%.'], ['skip', '거절한다', '+5층, 최대 HP의 10% 회복.']],
        mirror: [['fight', '거울을 부순다', '회랑 강화가 없는 자신의 복제본과 전투. 승리: 공격력 +20%, 종료 보상 +30% 계약.'], ['trade', '거울 속 자신과 거래한다', '모든 강화·저주·유물을 포기. 종료 보상 +40% 계약. 이미 얻은 종료 계약은 보존.'], ['skip', '거울을 무시한다', '+5층.']],
        chests: [['red', '붉은 상자', '공격 강화가 나올 확률이 높습니다.'], ['blue', '푸른 상자', '방어·회복 강화가 나올 확률이 높습니다.'], ['gold', '황금 상자', '강력한 보물 또는 저주. 드물게 9성 전직 카드 확정 보상 계약.']],
        judge: [['three', '일반 몬스터 3마리와 연속 전투', '전부 승리: 공격력 +15%.'], ['elite', '엘리트 몬스터 1마리와 전투', '승리: 공격력 +25%.'], ['boss', '심판자에게 도전', '일반 적 권장 전투력의 3.5배. 승리: 특별 유물(최종 피해 +35%, 종료 보상 +50%) 및 8성 전직 카드 계약.']],
        well: [['blood', '피를 바친다', '최대 HP -20%, 공격력 +30%.'], ['drink', '우물의 물을 마신다', 'HP·MP 전부 회복. 다음 2회 전투 받는 피해 +20%.'], ['destroy', '우물을 파괴한다', '일반 몬스터 2마리 연속 전투. 모두 승리: 최대 HP +10%.']],
        collapse: [['prevent', '붕괴를 막는다', '현재 HP -50%, 뒤틀림 -50.'], ['accept', '붕괴를 받아들인다', '다음 3회 전투 적 공격력·보상 2배. 뒤틀림 50으로 안정화.'], ['rift', '균열 속으로 뛰어든다', '+50층, 권장 전투력 4배의 특수 보스. 승리: 특별 유물 및 9성 전직 카드 계약.']]
    };
    return (entries[event.id] || []).map(([id, name, desc]) => ({ id, name, desc }));
}
function chooseEvent(user, id, input = {}, random = Math.random) {
    const run = user.paradise, event = run.event;
    if (run.phase !== 'event' || !event || !eventChoices(user).some(c => c.id === id)) return { error: '현재 이벤트의 선택지를 골라주세요.' };
    const chance = has(run, 'dice') ? .10 : 0;
    let fighting = false, message = '';
    const battle = (kind, remaining, reward) => { startCombat(user, kind, { kind, remaining, reward }, random); fighting = true; };
    switch (event.id) {
        case 'puzzle':
            if (id === 'skip') move(user, 5);
            else {
                const puzzle = wisdom.getPuzzle(pick(['2026-01-03', '2026-01-04'], random), run.id, crypto.randomUUID());
                run.phase = 'puzzle'; run.event = { id: 'puzzle', puzzle, deadline: Date.now() + 120000 }; return { message: '봉인을 풀어주세요. 제한 시간 120초.' };
            }
            break;
        case 'casino':
            if (id === 'attack') battle('elite', 1, 'casino');
            else {
                const won = random() < (id === 'safe' ? .70 : .30) + chance;
                if (won) { move(user, id === 'safe' ? 10 : 50); addEffect(user, { atk: id === 'safe' ? .10 : .30 }); }
                else if (id === 'safe') user.hp = Math.max(1, Math.floor(user.hp * .9));
                else addEffect(user, { atk: -.15 }, false);
                message = won ? '도박 성공! 황금 주사위가 당신 편에 섰습니다.' : '도박 실패… 도박사가 웃음을 짓습니다.';
            }
            break;
        case 'forge':
            if (id !== 'skip' && !equipmentOptions(user).some(e => e.name === event.equipment)) return { error: '강화 가능한 장비를 더 이상 장착하고 있지 않습니다.' };
            if (id === 'enhance') { run.temporary.push({ id: 'forge', name: event.equipment + ' · 대장장이 강화', equipment: event.equipment, battles: 3, multiplier: 2 }); run.nextEliteHp = true; }
            else if (id === 'modify') { run.equipmentPermanent[event.equipment] = Number(run.equipmentPermanent[event.equipment] || 0) + .20; addEffect(user, { hp: -.15 }, false); }
            else { move(user, 5); heal(user, .10); }
            break;
        case 'mirror':
            if (id === 'fight') battle('mirror', 1, 'mirror');
            else if (id === 'trade') {
                run.effects = {}; run.relics = []; run.temporary = []; run.equipmentPermanent = {}; run.acquired = {}; run.lastStatBuff = null; run.compass = 0; run.ring = 0; run.focus = 0; run.insurance = false; run.forceElite = false; run.nextEliteAttack = false; run.nextEliteHp = false;
                run.contracts.push({ bonus: .40, name: '거울과의 거래 · 종료 보상 +40%' }); clampResources(user);
            } else move(user, 5);
            break;
        case 'chests': {
            const key = has(run, 'key') ? .15 : 0, roll = random();
            if (id === 'gold' && roll < .02 + key * .1) { run.contracts.push({ star: 9, type: '전직', name: '9성 전직 카드' }); message = '황금빛 계약 · 9성 전직 카드 확정 보상!'; }
            else if (id === 'gold' && roll < .42 + key) { grantRelic(user, null, random); addEffect(user, { atk: .25 }); message = '황금 상자에서 유물과 힘을 얻었습니다.'; }
            else if (id === 'gold') { addEffect(user, { taken: .15 }, false); run.distortion = clamp(run.distortion + 15, 0, 100); message = '저주가 스며듭니다. 받는 피해 +15%, 뒤틀림 +15.'; }
            else {
                const defensive = id === 'blue' ? roll < .8 + key : roll >= .8 + key;
                if (defensive) { const buff = pick([{ hp: .15 }, { def: .20 }], random); addEffect(user, buff); heal(user, .20, .20); message = '방어의 축복 · 능력치 강화, HP·MP 20% 회복'; }
                else { addEffect(user, { atk: .15, final: .05 }); message = '공격의 축복 · 공격력 +15%, 최종 피해 +5%'; }
            }
            break;
        }
        case 'judge': battle(id === 'three' ? 'normal' : id === 'elite' ? 'elite' : 'judge', id === 'three' ? 3 : 1, 'judge:' + id); break;
        case 'well':
            if (id === 'blood') { addEffect(user, { hp: -.20, atk: .30 }); run.distortion = clamp(run.distortion + 10, 0, 100); }
            else if (id === 'drink') { heal(user, 1, 1); run.temporary.push({ id: 'well', name: '붉은 물의 대가', effects: { taken: .20 }, battles: 2 }); }
            else battle('normal', 2, 'well');
            break;
        case 'collapse':
            run.distortion = 50;
            if (id === 'prevent') user.hp = Math.max(1, Math.floor(user.hp * .50));
            else if (id === 'accept') run.temporary.push({ id: 'collapse', name: '붕괴 수락 · 적 공격력·보상 2배', battles: 3 });
            else { move(user, 50); battle('rift', 1, 'rift'); }
            break;
    }
    message ||= EVENTS[event.id].title + ' · ' + eventChoicesForLog(event.id, id);
    log(run, message); run.lastOutcome = message;
    if (!fighting) {
        if (event.id === 'collapse') nextEncounter(user, random); else offerAugments(user, random);
    }
    return { message };
}
function eventChoicesForLog(event, choice) { return event === 'forge' ? ({ enhance: '장비 강화', modify: '장비 개조', skip: '거절' }[choice]) : '선택의 결과가 회랑에 새겨졌습니다.'; }
function answerPuzzle(user, answer, random = Math.random) {
    const run = user.paradise;
    if (run.phase !== 'puzzle') return { error: '진행 중인 퍼즐이 없습니다.' };
    const expired = Date.now() >= run.event.deadline;
    const skipped = answer === null;
    const checked = expired || skipped ? { correct: false } : wisdom.checkAnswer(run.event.puzzle, answer);
    if (checked.error) return checked;
    let message;
    if (skipped && !expired) { move(user, 5); message = '퍼즐을 건너뛰었습니다. +5층'; }
    else if (checked.correct) { addEffect(user, random() < .5 ? { atk: .10 } : { final: .08 }); move(user, 10); run.distortion = Math.max(0, run.distortion - 10); message = '봉인 해제! 강화 획득, +10층, 뒤틀림 -10'; }
    else { user.hp = Math.max(1, Math.floor(user.hp * .85)); message = expired ? '시간 초과 · 현재 HP -15%' : '오답 · 현재 HP -15%'; }
    log(run, message); run.lastOutcome = message; offerAugments(user, random);
    return { message };
}
function onSkillUsed(user, spent) {
    if (!active(user)) return;
    const run = user.paradise;
    if (!run.effects.noHealing && run.effects.manaCycle) user.mp = Math.min(rpg().calculateUserStats(user).mp, user.mp + Math.floor(spent * .20));
}
function cooldownMultiplier(user) {
    if (!active(user)) return 1;
    const run = user.paradise;
    let multiplier = run.temporary.some(b => b.id === 'forbidden' && b.battles > 0) ? .50 : 1;
    if (run.battle.firstSkill && has(run, 'clock')) multiplier *= .50;
    run.battle.firstSkill = false;
    return multiplier;
}
function attackMultiplier(user, extra) {
    const run = user.paradise;
    let multiplier = 1;
    const manual = !extra.summonAttack && !extra.dotAttack && !extra.isBotAutoAttack;
    if (manual && run.battle.firstAttack) { if (run.effects.firstStrike) multiplier *= 2; run.battle.firstAttack = false; }
    if (run.effects.execution && run.enemy.hp <= run.enemy.maxHp * .20) multiplier *= 1.50;
    if (manual && run.effects.comeback) { multiplier *= 1 + Math.min(.30, Math.floor((run.battle.comeback + 1e-9) * 10) * .05); run.battle.comeback = 0; }
    return multiplier;
}
function survive(user, nextHp, maxHp) {
    const run = user.paradise;
    if (nextHp > 0) return nextHp;
    if (run.effects.unyielding && !run.battle.survived) { run.battle.survived = true; log(run, '불굴의 의지 · HP 1로 생존'); return 1; }
    if (run.battle.insurance) { run.battle.insurance = false; log(run, '회랑의 보험 발동'); return run.effects.noHealing ? 1 : Math.max(1, Math.round(maxHp * .30)); }
    if (has(run, 'feather') && !run.featherUsed) { run.featherUsed = true; log(run, '불사의 깃털 발동'); return run.effects.noHealing ? 1 : Math.max(1, Math.round(maxHp * .30)); }
    return 0;
}
function victory(user, random = Math.random) {
    if (user.paradise.mode === 'hell') return require('./paradise_hell').victory(user, random);
    const run = user.paradise, enemy = run.enemy, elite = enemy.kind === 'elite';
    const units = (run.battle.doubledReward ? 2 : 1) * (elite && has(run, 'necklace') ? 2 : 1);
    run.battlesWon++; run.rewardUnits += units;
    recordFloor(user);
    run.clearedFloor = Math.max(run.clearedFloor, run.floor);
    if (elite) { run.elitesWon++; run.eliteUnits += units; run.distortion = Math.max(0, run.distortion - 5); if (has(run, 'crown')) heal(user, .15); }
    if (run.effects.thirst) heal(user, .10);
    for (const buff of run.temporary) {
        buff.battles--;
        if (!buff.battles && buff.forceEliteAfter) run.forceElite = true;
        if (!buff.battles && buff.rewardAfter) { run.effects.reward = Number(run.effects.reward || 0) + buff.rewardAfter; log(run, '탐욕의 인장 달성 · 종료 보상 +20%'); }
    }
    run.temporary = run.temporary.filter(buff => buff.battles > 0);
    run.relics = run.relics.filter(id => id !== 'hourglass');
    clampResources(user); rpg().clearFieldRuntimeTimers(user.name);
    log(run, enemy.name + ' 격파');
    const seq = run.sequence;
    if (seq && seq.remaining > 1) { startCombat(user, seq.kind, { ...seq, remaining: seq.remaining - 1 }, random); return; }
    if (seq) {
        switch (seq.reward) {
            case 'casino': for (let i = 0; i < units; i++) grantRelic(user, null, random); break;
            case 'mirror': addEffect(user, { atk: .20 * units }); run.contracts.push({ bonus: .30 * units, name: `거울 격파 · 종료 보상 +${30 * units}%` }); break;
            case 'judge:three': addEffect(user, { atk: .15 * units }); break;
            case 'judge:elite': addEffect(user, { atk: .25 * units }); break;
            case 'judge:boss':
            case 'rift':
                for (let i = 0; i < units; i++) {
                    grantRelic(user, i === 0 ? seq.reward === 'rift' ? 'riftHeart' : 'judgment' : null, random);
                    run.contracts.push({ star: seq.reward === 'rift' ? 9 : 8, type: '전직', name: seq.reward === 'rift' ? '9성 전직 카드' : '8성 전직 카드' });
                }
                break;
            case 'well': addEffect(user, { hp: .10 * units }); break;
        }
    } else if (elite) {
        // 일반 엘리트도 회랑 유물을 지급한다. 목걸이/붕괴의 두 배는 실제 지급에 반영한다.
        for (let i = 0; i < units; i++) if (random() < .35) grantRelic(user, null, random);
    }
    if (enemy.kind === 'final') { finish(user, 'cleared'); return; }
    if (run.distortion >= 100) { run.phase = 'event'; run.event = { id: 'collapse' }; }
    else offerAugments(user, random);
}
function finish(user, outcome = 'retired') {
    if (user.paradise.mode === 'hell') return require('./paradise_hell').finish(user, outcome);
    const run = user.paradise;
    rpg().clearFieldRuntimeTimers(user.name);
    run.status = 'ended'; run.phase = 'ended'; run.outcome = outcome; run.endedAt = Date.now(); run.event = null; run.choices = [];
    run.rewardBonus = Number(run.effects.reward || 0) + Number(run.ring || 0) + (has(run, 'judgment') ? .50 : 0) + (has(run, 'riftHeart') ? .75 : 0) + run.contracts.reduce((sum, c) => sum + Number(c.bonus || 0), 0);
    user.field = null;
    if (outcome === 'defeated') user.hp = 1;
    const stats = rpg().calculateUserStats(user);
    user.hp = clamp(Number(user.hp), 1, stats.hp); user.mp = clamp(Number(user.mp), 0, stats.mp);
    log(run, outcome === 'cleared' ? '999층 완주 · 천상의 끝' : outcome === 'defeated' ? '탐험 종료 · 전투 불능' : '귀환 · 종료 보상 정산');
}
function previewRewards(run) {
    const multiplier = 1 + Math.max(0, Number(run.rewardBonus ?? (Number(run.effects.reward || 0) + Number(run.ring || 0) + run.contracts.reduce((sum, c) => sum + Number(c.bonus || 0), 0))));
    const battleMultiplier = run.battlesWon ? run.rewardUnits / run.battlesWon : 1;
    const rewards = (run.baseRewards || []).map(reward => ({ ...reward, count: Math.floor(Math.floor(run.clearedFloor / reward.perFloors) * reward.count * multiplier * battleMultiplier) })).filter(reward => reward.count > 0);
    const milestone = (run.milestoneRewards || []).filter(r => r.floor <= Number(run.highestFloor || run.clearedFloor || run.floor)).at(-1);
    if (milestone) rewards.push({ type: '아이템', name: milestone.name, count: Math.floor(milestone.count * multiplier * battleMultiplier), floor: milestone.floor });
    return rewards;
}

function powerWarning(user, floors, enemyKind = 'normal', conditional = false) {
    const floor = clamp(user.paradise.floor + floors, 1, MAX_FLOOR);
    const kind = floor === MAX_FLOOR && enemyKind === 'normal' ? 'final' : enemyKind;
    const power = Math.round(recommendedPower(floor) * ({ elite: 1.2, judge: 3.5, rift: 4, final: 2 }[kind] || 1));
    const playerPower = rpg().calculateCombatPower(user).total;
    return power > playerPower ? { floor, recommendedPower: power, playerPower, conditional, enemyKind: kind } : null;
}
function eventPowerWarning(user, id) {
    const event = user.paradise.event?.id;
    if (event === 'casino' && ['safe', 'risk'].includes(id)) return powerWarning(user, id === 'safe' ? 10 : 50, 'normal', true);
    if (event === 'collapse' && id === 'rift') return powerWarning(user, 50, 'rift');
    if (event === 'puzzle' && id === 'solve') return powerWarning(user, 10, 'normal', true);
    if (id === 'skip') return powerWarning(user, 5);
    return null;
}
function claim(user) {
    const run = user.paradise;
    if (run?.mode === 'hell') return run.claimed ? { message: '이미 수령한 보상입니다.' } : { error: '지옥 보상 상자를 직접 선택해주세요.' };
    if (!run || run.status !== 'ended') return { error: '탐험을 종료한 후 수령할 수 있습니다.' };
    if (run.claimed) return { message: '이미 수령한 보상입니다.' };
    const rewards = previewRewards(run), items = rpg().getDataCache('Item', []);
    if (rewards.some(reward => reward.type === '아이템' && !items.some(i => i?.name === reward.name))) return { error: '종료 보상 아이템이 운영 DB에 없습니다. 운영자에게 설정 확인을 요청해주세요. 계약과 보상은 보존됩니다.' };
    const contracts = run.contracts.filter(c => c.star);
    if (user.inventory.card.length + contracts.length > Number(user.maxCardLimit || 52)) return { error: `계약 카드 ${contracts.length}장을 받을 카드 보관함 공간이 필요합니다. 정리 후 다시 수령해주세요.` };
    const cards = contracts.map(c => rpg().buildCharacterCardReward({ card_type: c.type, display_star: c.star }));
    if (cards.some(c => !c)) return { error: '전직 카드 보상 데이터를 찾을 수 없습니다. 계약은 보존됩니다.' };
    for (const reward of rewards) {
        if (reward.type === '골드') user.gold = Number(user.gold || 0) + reward.count;
        else if (reward.type === '경험치') rpg().addExperience(user, reward.count);
        else rpg().grantItemReward(user, items.findIndex(i => i?.name === reward.name), reward.count);
    }
    user.inventory.card.push(...cards);
    run.claimed = true; run.claimedAt = Date.now(); run.rewards = { rewards, cards };
    return { message: '종료 보상을 수령했습니다.' };
}
function view(user) {
    const run = user.paradise, config = rpg().getDataCache('Paradise', null), stats = rpg().calculateUserStats(user);
    const ticketId = rpg().getDataCache('Item', []).findIndex(i => i?.name === TICKET);
    const result = { serverTime: Date.now(), weekly: weeklyInfo(user), enabled: !validateConfig(config) && config.enabled, ticket: { name: TICKET, count: ticketId < 0 ? 0 : rpg().getInventoryItemCount(user, ticketId), iconUrl: '/static/assets/paradise/ticket.webp' }, revision: Number(run?.revision || 0), runId: run?.id || null,
        player: { name: user.name, hp: Number(user.hp ?? stats.hp), maxHp: stats.hp, mp: Number(user.mp ?? stats.mp), maxMp: stats.mp, atk: stats.atk, def: stats.def, combatPower: rpg().calculateCombatPower(user).total },
        baseRewards: config?.baseRewards || [], entryBlocked: user.field && !user.field.paradise ? '다른 전투를 먼저 마쳐주세요.' : null, run: null };
    if (!run) return require('./paradise_hell').decorateView(result, user);
    const { mirror, ...enemy } = run.enemy || {};
    result.run = { id: run.id, status: run.status, phase: run.phase, floor: run.floor, clearedFloor: run.clearedFloor, distortion: run.distortion, outcome: run.outcome || null, claimed: !!run.claimed, battlesWon: run.battlesWon, elitesWon: run.elitesWon, enemy: run.phase === 'combat' ? enemy : null,
        choices: run.phase === 'augment' ? run.choices.map(id => AUGMENTS.find(a => a.id === id)).map(({ id, name, desc, floors, rarity, equipment, dangerous }) => ({ id, name, desc, floors, rarity, equipment, dangerous: !!dangerous })) : [],
        event: run.event ? { id: run.event.id, ...EVENTS[run.event.id], equipment: run.event.equipment || null, choices: run.phase === 'event' ? eventChoices(user) : [], ...(run.phase === 'puzzle' ? { puzzle: run.event.puzzle.publicPuzzle, deadline: run.event.deadline } : {}) } : null,
        relics: run.relics.map(id => ({ ...RELICS.find(r => r.id === id), spent: id === 'feather' && !!run.featherUsed })), effects: Object.entries(run.acquired).map(([id, count]) => ({ ...AUGMENTS.find(a => a.id === id), count })), permanentEffects: sumEffects(run), temporary: run.temporary.map(({ name, battles }) => ({ name, battles })), equipmentPermanent: run.equipmentPermanent,
        contracts: run.contracts, history: run.history.slice(0, 20), lastOutcome: run.lastOutcome || null, rewards: previewRewards(run), rewardBonus: run.rewardBonus || 0, nextActionAt: Number(user.field?.nextActionAt || 0),
        skills: rpg().getMainCardSkills(user).map(({ skill }) => ({ name: skill.name, cost: skill.mp_cost, cooldownEnd: Number(user.field?.skillCooldowns?.[skill.name] || 0) })) };
    if (result.run) {
        result.run.highestFloor = Number(run.highestFloor || run.clearedFloor || run.floor);
        for (const choice of result.run.choices) choice.powerWarning = powerWarning(user, choice.floors, choice.id === 'rewind' || run.forceElite ? 'elite' : 'normal');
        for (const choice of result.run.event?.choices || []) choice.powerWarning = eventPowerWarning(user, choice.id);
    }
    return require('./paradise_hell').decorateView(result, user);
}
module.exports = { TICKET, MAX_FLOOR, CP_ANCHORS, AUGMENTS, RELICS, EVENTS, active, validateConfig, recommendedPower, equipmentOptions, equipmentMultiplier, applyStats, sumEffects, enter, chooseAugment, chooseEvent, answerPuzzle, startCombat, nextEncounter, offerAugments, grantRelic, addEffect, move, heal, onSkillUsed, cooldownMultiplier, attackMultiplier, survive, victory, finish, claim, view, weeklyInfo, recordFloor, buildWeeklyRanking };
