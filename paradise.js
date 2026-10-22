const crypto = require('crypto');
const { AUGMENTS, RELICS, EVENTS, EQUIPMENT_NAMES } = require('./paradise_content');
const EQUIPMENT_AUGMENTS = new Map(AUGMENTS.filter(a => a.equipment).map(a => [a.equipment, a]));
const wisdom = require('./wisdom_puzzle');
const rpg = () => require('./rpgenius');
const TICKET = '천상의 회랑 입장권';
const MAX_FLOOR = 999;
const MIN_LEVEL = 141;
const JUDGE_MIN_FLOOR = 150;
const ADVANCED_RELIC_CHANCE = .08;
const TIME_LIMIT_MS = 20 * 60 * 1000;
const progression = require('./paradise_progression');
const routeMechanics = require('./paradise_routes');
const timeLimit = run => TIME_LIMIT_MS + (progression.has(run, 'extraTime') ? 5 * 60 * 1000 : 0);
const timerPaused = run => ['augment', 'route', 'event', 'ended'].includes(run.phase);
const CP_ANCHORS = [[1, 10000], [10, 100000], [100, 1000000], [200, 5000000], [300, 10000000], [400, 30000000], [500, 60000000], [600, 100000000], [700, 300000000], [800, 400000000], [900, 500000000], [999, 1000000000]];
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const pick = (list, random = Math.random) => list[Math.min(list.length - 1, Math.floor(random() * list.length))];
const active = user => user?.paradise?.status === 'active' && user.field?.paradise === true;
const has = (run, id) => run.relics.includes(id);
const log = (run, text) => { run.history.unshift({ floor: run.floor, text }); run.history.length = Math.min(60, run.history.length); };

function remainingTime(run, now = Date.now()) {
    if (!run?.clock) return timeLimit(run);
    const extension = run.clock.limitMs ? 0 : TIME_LIMIT_MS - 15 * 60 * 1000;
    return Math.max(0, run.clock.remainingMs + extension - (run.clock.paused || run.status !== 'active' ? 0 : Math.max(0, now - run.clock.updatedAt)));
}
function setPhase(user, phase) {
    const run = user.paradise, now = Date.now();
    if (run.mode !== 'hell') run.clock = { remainingMs: remainingTime(run, now), limitMs: timeLimit(run), updatedAt: now, paused: timerPaused({ phase }) };
    run.phase = phase;
}
function isTimedOut(user, now = Date.now()) {
    return active(user) && user.paradise.mode !== 'hell' && remainingTime(user.paradise, now) <= 0;
}
function advanceTime(user) {
    if (!active(user) || user.paradise.mode === 'hell') return false;
    const run = user.paradise;
    // 기존 15분 탐험에는 남은 시간에 5분을 한 번만 더한다.
    if (!run.clock?.limitMs) { setPhase(user, run.phase); run.revision++; return true; }
    const pauseChanged = run.clock.paused !== timerPaused(run);
    if (pauseChanged) { setPhase(user, run.phase); run.revision++; }
    if (!isTimedOut(user)) return pauseChanged;
    finish(user, 'timedOut');
    const result = claim(user);
    if (result.error) run.timeoutClaimError = result.error;
    run.revision++;
    return true;
}

function getResources(user) {
    if (!active(user)) return user;
    // 구형 진행 중 탐험은 현재 저장된 수치부터 분리한다. 바깥 HP와 MP는 변경하지 않는다.
    return user.paradise.resources ||= { hp: user.hp, mp: user.mp };
}

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
    const augment = EQUIPMENT_AUGMENTS.get(name);
    // 획득 기록으로 적용하므로 업데이트 전에 얻었거나 횟수가 만료된 증강도 탐험 내내 유지한다.
    if (augment && run.acquired[augment.id] && (scope === 'combat' || augment.staticPassive)) multiplier *= augment.multiplier;
    for (const buff of run.temporary) if (buff.id !== augment?.id && buff.battles > 0 && buff.equipment === name && !(buff.combatOnly && scope !== 'combat')) multiplier *= buff.multiplier;
    if (has(run, 'sheath') && user.equipments?.weapon && rpg().getEquipmentData('weapon', user.equipments.weapon.id)?.name === name) multiplier += .45;
    return multiplier;
}
function sumEffects(run) {
    const effects = { ...run.effects };
    for (const [key, value] of Object.entries(routeMechanics.effects(run))) effects[key] = Number(effects[key] || 0) + value;
    for (const relic of RELICS) if (has(run, relic.id)) {
        for (const [key, value] of Object.entries(relic.effect || {})) effects[key] = Number(effects[key] || 0) + value;
    }
    if (progression.has(run, 'distortedEdge') && run.distortion >= 20) effects.extraDamage = Number(effects.extraDamage || 0) + .20;
    if (progression.has(run, 'chaosCrown') && run.distortion >= 60) effects.final = Number(effects.final || 0) + .30;
    // 진행 중인 탐험의 구형 악마의 거래에도 같은 밸런스를 적용한다.
    if (run.acquired.devil && effects.noHealing && !effects.devil) {
        effects.atk = Number(effects.atk || 0) - .25;
        effects.extraDamage = Number(effects.extraDamage || 0) + .666;
    }
    for (const buff of run.temporary) if (buff.battles > 0) for (const [key, n] of Object.entries(buff.effects || {})) effects[key] = Number(effects[key] || 0) + n;
    if (has(run, 'redContract')) { effects.hp = Number(effects.hp || 0) - .10; effects.final = Number(effects.final || 0) + .36; }
    if (has(run, 'necklace')) effects.taken = Number(effects.taken || 0) + .10;
    if (has(run, 'judgment')) effects.final = Number(effects.final || 0) + .35;
    if (has(run, 'abyssDiadem')) effects.final = Number(effects.final || 0) + .54;
    if (has(run, 'riftHeart')) { effects.atk = Number(effects.atk || 0) + .70; effects.taken = Number(effects.taken || 0) - .20; }
    return effects;
}
function applyStats(user, stats) {
    const resources = getResources(user);
    if (!active(user)) return;
    const run = user.paradise, effects = sumEffects(run);
    progression.applyStats(run, stats);
    const hpGrowth = effects.victoryHpGrowth ? Number(run.hpGrowth || 0) : 0;
    for (const key of ['hp', 'mp', 'def']) stats[key] = Math.max(key === 'mp' ? 0 : 1, Math.round(Number(stats[key] || 0) * Math.max(.05, 1 + Number(effects[key] || 0) + (key === 'hp' ? hpGrowth : 0))));
    const missingHp = 1 - clamp(Number(resources.hp ?? stats.hp) / stats.hp, 0, 1);
    const attackGrowth = effects.victoryAtkGrowth ? Number(run.attackGrowth || 0) : 0;
    stats.atk = Math.max(1, Math.round(Number(stats.atk || 0) * Math.max(.05, 1 + Number(effects.atk || 0) + Number(run.compass || 0) + attackGrowth + (effects.risk ? missingHp * .50 : 0) + (effects.calmMind && run.distortion <= 24 ? .20 : 0))));
    stats.finalDamage = Number(stats.finalDamage || 0) + Number(effects.final || 0) + (effects.lastStand && Number(resources.hp ?? stats.hp) <= stats.hp * .30 ? .40 : 0) + (effects.eclipse && run.distortion >= 50 ? .30 : 0);
    stats.takenDamage = Number(stats.takenDamage || 0) + Number(effects.taken || 0) + (missingHp >= .65 ? Number(effects.lowHpGuard || 0) : 0) - (effects.eclipse && run.distortion < 50 ? .10 : 0);
    stats.maxCmb = Number(stats.maxCmb || 0) + Number(effects.maxCmb || 0);
    stats.critMul = Number(stats.critMul || 0) + Number(run.focus || 0) + missingHp * Number(effects.woundedCrit || 0);
    for (const key of ['crit', 'critMul', 'cmb', 'critDef', 'avd', 'mpReduce', 'eliteDmg', 'bossDmg', 'damageBonus', 'extraDamage', 'pnt', 'pntPercent']) stats[key] = Number(stats[key] || 0) + Number(effects[key] || 0);
    for (const key of ['crit', 'cmb', 'critDef', 'avd']) stats[key] = Math.max(0, stats[key]);
    stats.critMul = Math.max(1, stats.critMul);
    stats.mpReduce = Math.max(-1, stats.mpReduce);
    if (run.mode !== 'hell' && run.acquired.dopamineAddiction) {
        stats.crit = stats.fixedCriticalChance = .20;
        stats.critMul += .50;
    }
}
function heal(user, hp = 0, mp = 0) {
    const resources = getResources(user);
    if (user.paradise.effects.noHealing) return;
    const stats = rpg().calculateUserStats(user);
    resources.hp = Math.min(stats.hp, Number(resources.hp) + Math.round(stats.hp * hp));
    resources.mp = Math.min(stats.mp, Number(resources.mp) + Math.round(stats.mp * mp));
}
function clampResources(user) {
    const resources = getResources(user);
    const stats = rpg().calculateUserStats(user);
    resources.hp = clamp(Number(resources.hp), 1, stats.hp);
    resources.mp = clamp(Number(resources.mp), 0, stats.mp);
}
function addEffect(user, effects) {
    const run = user.paradise;
    for (const [key, n] of Object.entries(effects)) run.effects[key] = Number(run.effects[key] || 0) + n;
    clampResources(user);
}
function move(user, floors, dangerous = false) {
    const run = user.paradise;
    floors = progression.movement(run, floors);
    const before = run.floor;
    // 이동을 선택할 수 있는 방은 통과한 것으로 확정한다. 도착한 전투 층은 승리해야 기록한다.
    recordFloor(user);
    run.floor = clamp(run.floor + floors, 1, MAX_FLOOR);
    // 지정되지 않은 중간 이동량은 구간으로 처리: +5 이하 0 / +6〜15 +5 / +16 이상 +15.
    const distortion = floors < 0 ? -5 : floors <= 5 ? 0 : floors <= 15 ? 5 : 15;
    run.distortion = clamp(run.distortion + distortion + (dangerous ? 10 : 0), 0, 100);
    if (run.floor > before && progression.has(run, 'woundedAscent')) heal(user, (run.floor - before) * .05);
    if (floors < 0 && has(run, 'compass')) run.compass = Math.min(.35, Number(run.compass || 0) + .07);
    if (floors >= 20 && has(run, 'ring')) run.ring = Math.min(.35, Number(run.ring || 0) + .07);
}
function grantRelic(user, special, random = Math.random, rarity = null) {
    const run = user.paradise;
    let pool = RELICS.filter(relic => special ? relic.id === special : !relic.special && !has(run, relic.id) && (!rarity || relic.rarity === rarity));
    if (!pool.length) { addEffect(user, { atk: .05 }); log(run, '유물의 잔향: 공격력 +5%'); return '유물의 잔향, 공격력 +5%'; }
    if (!special && !rarity) {
        const normal = pool.filter(r => r.rarity === 'normal'), advanced = pool.filter(r => r.rarity === 'advanced');
        pool = normal.length && advanced.length ? random() < ADVANCED_RELIC_CHANCE ? advanced : normal : pool;
    }
    const relic = pick(pool, random);
    if (!has(run, relic.id)) {
        run.relics.push(relic.id);
        // 획득 전 전투 기록은 유물의 발동 횟수에 포함하지 않는다.
        if (['meditationCenser', 'returnLantern'].includes(relic.id)) (run.relicState ||= {})[relic.id] = { wins: 0 };
    }
    clampResources(user);
    log(run, '천상 유물 획득, ' + relic.name);
    return relic.name + ' 획득';
}
function offerRelics(user, random = Math.random) {
    const run = user.paradise;
    if (!run.relicPicksRemaining) return false;
    const rarity = run.relicDraftRarities?.[0];
    const pool = RELICS.filter(relic => !relic.special && !has(run, relic.id) && (!rarity || relic.rarity === rarity));
    if (!pool.length) {
        run.relicPicksRemaining--; run.relicDraftRarities?.shift();
        addEffect(user, { atk: .05 }); log(run, '유물의 잔향, 공격력 +5%');
        return offerRelics(user, random);
    }
    const normal = pool.filter(relic => relic.rarity === 'normal'), advanced = pool.filter(relic => relic.rarity === 'advanced'), choices = [];
    // 후보가 세 개여도 고급 유물을 볼 확률은 8%로 유지한다.
    if (!rarity && advanced.length && (normal.length < 3 || random() < ADVANCED_RELIC_CHANCE)) choices.push(pick(advanced, random).id);
    while (choices.length < 3 && normal.length) {
        const relic = pick(normal, random); choices.push(relic.id); normal.splice(normal.indexOf(relic), 1);
    }
    while (choices.length < Math.min(3, pool.length)) choices.push(pick(pool.filter(relic => !choices.includes(relic.id)), random).id);
    run.relicChoices = choices; run.choices = []; run.event = null;
    setPhase(user, 'relic');
    return true;
}
function chooseRelic(user, id, random = Math.random) {
    const run = user.paradise;
    if (!active(user) || run.mode === 'hell' || run.phase !== 'relic' || !run.relicChoices?.includes(id) || has(run, id)) return { error: '현재 제시된 유물 중 하나를 선택해주세요.' };
    const message = grantRelic(user, id, random);
    run.relicPicksRemaining--; run.relicDraftRarities?.shift(); run.relicChoices = [];
    if (!offerRelics(user, random)) {
        if (run.distortion >= 100 && !run.augmentCategory) { setPhase(user, 'event'); run.event = { id: 'collapse' }; }
        else offerAugments(user, random);
    }
    return { message };
}
function obtainedAugment(run, id) { return !!run.acquired[id] || (run.discardedAugments || []).includes(id); }
function ordinaryRelics(run) { return run.relics.filter(id => RELICS.some(r => r.id === id && !r.special) && !(id === 'feather' && run.featherUsed)); }
function eligibleAugment(user, choice, equipped = equipmentOptions(user).map(e => e.name)) {
    const run = user.paradise;
    return (!choice.equipment || equipped.includes(choice.equipment))
        && (!run.startingAugments?.length || !choice.encounter)
        && (choice.character == null || require('./paradise_augments_characters').eligible(user, choice))
        && (!choice.requiresUltimate || rpg().getUltimateSkills(user).length > 0)
        && (!choice.requiresEquipment || equipped.length > 0)
        && (!choice.requiresRelics || ordinaryRelics(run).length >= choice.requiresRelics)
        && (!choice.requiresCardContract || run.contracts.some(c => c.star));
}
function augmentRarity(run, pool, random) {
    const weights = run.distortion >= 50
        ? run.augmentFromElite ? { silver: 20, gold: 25, prismatic: 35, cursed: 20 } : { silver: 35, gold: 30, prismatic: 15, cursed: 20 }
        : run.augmentFromElite ? { silver: 25, gold: 30, prismatic: 40, cursed: 5 } : { silver: 40, gold: 35, prismatic: 20, cursed: 5 };
    const minimum = Math.min(3, Math.max(0, ...Object.keys(weights).map(rarity => pool.filter(a => a.rarity === rarity).length)));
    const rarities = Object.entries(weights).filter(([rarity]) => pool.filter(a => a.rarity === rarity).length >= minimum && pool.some(a => a.rarity === rarity));
    if (!rarities.length) return null;
    let roll = random() * rarities.reduce((sum, [, weight]) => sum + weight, 0);
    return (rarities.find(([, weight]) => (roll -= weight) < 0) || rarities.at(-1))[0];
}
function availableAugments(user, rarity = null, category = null) {
    const run = user.paradise, equipped = equipmentOptions(user).map(e => e.name);
    return AUGMENTS.filter(a => (!rarity || a.rarity === rarity) && (!category || a.category === category) && !obtainedAugment(run, a.id) && eligibleAugment(user, a, equipped));
}
function offerAugments(user, random = Math.random, rarity = null) {
    const run = user.paradise;
    const eligible = availableAugments(user, rarity, run.augmentCategory);
    run.offerRarity = rarity || augmentRarity(run, eligible, random);
    delete run.augmentFromElite;
    const pool = eligible.filter(a => a.rarity === run.offerRarity);
    const choices = [];
    while (choices.length < 3 && pool.length) {
        const choice = pick(pool, random);
        choices.push(choice.id); pool.splice(pool.indexOf(choice), 1);
    }
    setPhase(user, 'augment'); run.choices = choices; run.event = null;
    run.offerId = crypto.randomUUID(); run.rerolled = choices.map(() => false); run.offerSeen = [...choices];
}
function rerollPool(user) {
    const run = user.paradise, equipped = equipmentOptions(user).map(e => e.name);
    return AUGMENTS.filter(a => (!run.augmentCategory || a.category === run.augmentCategory) && (!run.offerRarity || a.rarity === run.offerRarity) && (!run.startingAugments?.length || a.rarity === run.startingAugments[0]) && !obtainedAugment(run, a.id) && !run.choices.includes(a.id) && !(run.offerSeen || []).includes(a.id) && eligibleAugment(user, a, equipped));
}
function normalizeAugmentOffer(user, random = Math.random) {
    const run = user.paradise;
    if (!active(user) || run.mode === 'hell' || run.phase !== 'augment' || run.completed) return false;
    const rarities = new Set(run.choices.map(id => AUGMENTS.find(a => a.id === id)?.rarity).filter(Boolean));
    if (rarities.size <= 1) return false;
    offerAugments(user, random, run.startingAugments?.[0] || null);
    run.revision++;
    return true;
}
function rerollAugment(user, id, random = Math.random) {
    const run = user.paradise;
    if (!active(user) || run.mode === 'hell' || run.phase !== 'augment' || run.completed) return { error: '증강 선택 단계에서만 새로고침할 수 있습니다.' };
    const index = run.choices.indexOf(id);
    if (index < 0) return { error: '현재 제시된 증강을 새로고침해주세요.' };
    if (run.rerolled?.[index]) return { error: '이 선택지는 이미 새로고침했습니다.' };
    const pool = rerollPool(user).filter(a => a.rarity === (run.offerRarity || AUGMENTS.find(a => a.id === id)?.rarity));
    const choice = pool.length ? pick(pool, random) : null;
    if (!choice) return { error: '새로 제시할 수 있는 증강이 없습니다.' };
    run.rerolled ||= run.choices.map(() => false);
    run.offerSeen ||= [...run.choices];
    run.rerolled[index] = true; run.offerSeen.push(choice.id); run.choices[index] = choice.id;
    if (has(run, 'riftLens')) { run.distortion = Math.max(0, run.distortion - 4); heal(user, 0, .09); }
    return { message: '증강 선택지를 새로고침했습니다.' };
}
function continueExploration(user, random = Math.random) {
    const run = user.paradise;
    if (run.completed) return { error: '999층을 정복했습니다. 귀환하여 보상을 정산해주세요.' };
    if (run.phase !== 'augment' || run.choices.some(id => AUGMENTS.some(a => a.id === id) && !obtainedAugment(run, id))) return { error: '먼저 증강을 선택해주세요.' };
    delete run.augmentCategory;
    move(user, 5); offerRoutes(user, random);
    return { message: '새로운 증강이 없어 5층을 올라갔습니다.' };
}
function heavenMonsterStats(floor, kind) {
    const power = recommendedPower(floor) * (kind === 'elite' ? 1.2 : kind === 'judge' ? 3.5 : kind === 'rift' ? 4 : 1);
    const def = Math.round(Math.sqrt(power) * .5);
    const stats = { hp: Math.round(power * .5), def, pnt: Math.round(def * .4), crit: .05, critMul: 1.5, cmb: .05, maxCmb: 0, statVersion: 3 };
    // HP를 전투력에 비례시킨 뒤 공격력으로 맞춘다. 정수 공격력의 오차만 HP로 보정한다.
    let low = 0, high = Math.ceil(power);
    while (high - low > 1) {
        const atk = Math.floor((low + high) / 2);
        if (rpg().computeCombatPowerFromStats({ ...stats, atk }).total <= power) low = atk; else high = atk;
    }
    stats.atk = Math.max(1, low);
    low = stats.hp; high = power;
    for (let i = 0; i < 60; i++) {
        const hp = (low + high) / 2;
        if (rpg().computeCombatPowerFromStats({ ...stats, hp }).total < power) low = hp; else high = hp;
    }
    stats.hp = stats.maxHp = Math.ceil(high);
    return stats;
}
function rebalanceEnemy(user) {
    const run = user?.paradise, enemy = run?.enemy;
    if (!active(user) || run.mode === 'hell' || run.phase !== 'combat' || !enemy || enemy.mirror || ['mirror', 'moonDuel'].includes(enemy.kind) || enemy.statVersion === 3) return false;
    const hpRatio = clamp(enemy.hp / enemy.maxHp, 0, 1);
    Object.assign(enemy, heavenMonsterStats(run.floor, enemy.kind));
    for (const savedTrait of enemy.traits) {
        const trait = savedTrait.replace(/\s*·\s*/g, ', ');
        if (trait === '광폭, 공격력 +25%') enemy.atk = Math.round(enemy.atk * 1.25);
        if (trait === '철갑, 방어력 +30%') enemy.def = Math.round(enemy.def * 1.30);
        if (trait === '거대, HP +30%') enemy.hp = Math.round(enemy.hp * 1.30);
        if (trait === '저주받은 보물, 공격력 +50%') enemy.atk = Math.round(enemy.atk * 1.5);
        if (trait === '대장장이의 대가, HP +50%') enemy.hp = Math.round(enemy.hp * 1.5);
    }
    if (run.mode !== 'hell' && run.routeEncounter) routeMechanics.scaleEnemy(enemy, run.routeEncounter.id, run.routeEncounter.ambushStarted);
    if (has(run, 'hourglass')) enemy.atk = Math.round(enemy.atk * .55);
    if (run.battle.collapse || run.battle.doubledReward) enemy.atk *= 2;
    enemy.recommendedPower = rpg().computeCombatPowerFromStats(enemy).total;
    enemy.maxHp = enemy.hp;
    enemy.hp = hpRatio > 0 ? Math.max(1, Math.round(enemy.maxHp * hpRatio)) : 0;
    if (user.field.elite) user.field.elite.hp = enemy.hp;
    return true;
}
function createMonster(user, kind = 'normal', random = Math.random) {
    const run = user.paradise, fields = rpg().getRegularFieldDungeons().filter(d => d.hp > 0 && d.atk >= 0);
    if (!fields.length) throw new Error('재사용할 필드 몬스터가 없습니다.');
    const index = Math.min(fields.length - 1, Math.floor((run.floor - 1) / (run.mode === 'hell' ? 100 : MAX_FLOOR) * fields.length));
    const offset = random() < .5 ? 0 : 1;
    const source = fields[Math.min(fields.length - 1, index + offset)];
    const sourceIndex = rpg().getRegularFieldDungeons().findIndex(d => d.name === source.name);
    const base = kind === 'normal' ? source : source.elite || source;
    const power = run.mode === 'hell' ? require('./paradise_hell').recommendedPower(run.floor) : recommendedPower(run.floor) * (kind === 'elite' ? 1.2 : kind === 'judge' ? 3.5 : kind === 'rift' ? 4 : 1);
    // 지옥은 기존 공격·방어 수치를 구한 뒤 HP만 10배로 늘린다. 천상은 자체 전투력으로 보정한다.
    const defense = Math.max(0, Math.round(Math.sqrt(power) / 18));
    const template = { atk: Math.max(1, Number(base.atk || 1)), hp: Math.max(1, Number(base.hp || 1)), def: defense, pnt: Math.round(defense * .4), crit: Number(base.crit || .05), critMul: Number(base.critMul || 1.5), cmb: Number(base.cmb || .05), maxCmb: Number(base.maxCmb || 0) };
    let low = 0, high = Math.max(1, power);
    if (run.mode === 'hell') {
        for (let i = 0; i < 60; i++) {
            const scale = (low + high) / 2;
            const cp = rpg().getDungeonRecommendedCP({ ...template, atk: template.atk * scale, hp: template.hp * scale });
            if (cp < power) low = scale; else high = scale;
        }
    }
    const enemy = { ...template, id: crypto.randomUUID(), kind, name: kind === 'judge' ? '회랑의 심판자' : kind === 'rift' ? '균열을 삼키는 자' : kind === 'final' ? '천상의 마지막 수문장' : kind === 'normal' ? source.name + '의 망령' : base.name || source.name + '의 정예',
        hp: Math.max(1, Math.round(template.hp * high)), atk: Math.max(1, Math.round(template.atk * high)), recommendedPower: Math.round(power), sourceIndex, sourceField: source.name, traits: [] };
    if (run.mode !== 'hell') Object.assign(enemy, heavenMonsterStats(run.floor, kind));
    else enemy.hp *= 10;
    enemy.maxHp = enemy.hp;
    if (run.mode === 'hell') enemy.name = (kind === 'boss' ? '지옥의 지배자, ' : kind === 'elite' ? '지옥의 정예, ' : '지옥의 ') + (base.name || source.name);
    if (run.distortion >= 50 && random() < (run.distortion >= 75 ? .65 : .20)) {
        const trait = pick(['광폭, 공격력 +25%', '철갑, 방어력 +30%', '거대, HP +30%'], random);
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
    setPhase(user, 'combat'); run.event = null; run.choices = []; run.routes = []; run.sequence = sequence;
    run.lastOutcome = null;
    const enemy = createMonster(user, kind, random);
    if (sequence?.reward === 'casino') { enemy.name = '잊혀진 도박사'; enemy.portrait = 'gambler'; }
    if (kind === 'mirror') {
        const baseUser = { ...user, field: null, paradise: null, hp: undefined, mp: undefined };
        const mirror = require('./pvp').createCorridorMirror(baseUser);
        Object.assign(enemy, structuredClone(mirror.snapshot.stats), { kind, name: '거울 속의 ' + user.name, hp: mirror.hp, maxHp: mirror.maxHp, mp: mirror.mp, maxMp: mirror.maxMp, mirror, traits: ['천상 증강·유물 없음, HP와 MP 100%'] });
        enemy.recommendedPower = rpg().calculateCombatPower(baseUser).total;
    }
    if (kind === 'moonDuel') {
        const challenger = new (rpg().RPGUser)('paradise:moon-duel', '월야의 뭔마');
        challenger.level = Math.min(300, Math.max(1, run.floor));
        challenger.main_card = { id: 1, star: Math.min(9, 2 + Math.floor(run.floor / 100)), type: '전직' };
        const equipment = rpg().getDataCache('Equipment', {});
        for (const [slot, name] of Object.entries({ weapon: '초심권', hat: '핏빛 모자', armor: '심해의 갑옷', pants: '흐르는 피', shoes: '블러디 슈즈', support: '월야의 와인잔' })) {
            const id = (equipment[slot] || []).findIndex(e => e?.name === name);
            if (id >= 0) challenger.equipments[slot] = { id, level: 0, transcendStage: Math.min(3, 1 + Math.floor(run.floor / 350)) };
        }
        const mirror = require('./pvp').createCorridorMirror(challenger), power = recommendedPower(run.floor) * 1.8;
        const template = { ...mirror.snapshot.stats, ...heavenMonsterStats(run.floor, 'elite') };
        // 낮은 층에서도 전직 궁극기와 일반 스킬을 사용할 수 있는 MP를 확보한다.
        template.mp = Math.max(template.mp, rpg().getMainCardSkills(challenger).reduce((sum, entry) => sum + Number(entry.skill.mp_cost || 0), 0) * 2);
        const scaled = scale => ({ ...template, atk: Math.max(1, template.atk * scale), hp: Math.max(1, template.hp * scale), def: Math.max(0, template.def * scale), pnt: Math.max(0, template.pnt * scale) });
        let low = 0, high = 10;
        for (let i = 0; i < 60; i++) { const scale = (low + high) / 2; if (rpg().computeCombatPowerFromStats(scaled(scale)).total < power) low = scale; else high = scale; }
        mirror.snapshot.stats = scaled(high);
        for (const key of ['atk', 'hp', 'def', 'pnt']) mirror.snapshot.stats[key] = Math.round(mirror.snapshot.stats[key]);
        mirror.maxHp = mirror.hp = mirror.snapshot.stats.hp;
        mirror.maxMp = mirror.mp = mirror.snapshot.stats.mp;
        mirror.name = '월야의 뭔마';
        Object.assign(enemy, mirror.snapshot.stats, { kind, name: mirror.name, hp: mirror.hp, maxHp: mirror.maxHp, mp: mirror.mp, maxMp: mirror.maxMp, mirror, characterCard: challenger.main_card, traits: [] });
        enemy.recommendedPower = rpg().computeCombatPowerFromStats(mirror.snapshot.stats).total;
    }
    if (kind === 'elite' && run.nextEliteAttack) { enemy.atk = Math.round(enemy.atk * 1.5); run.nextEliteAttack = false; enemy.traits.push('저주받은 보물, 공격력 +50%'); }
    if (kind === 'elite' && run.nextEliteHp) { enemy.hp = enemy.maxHp = Math.round(enemy.hp * 1.5); run.nextEliteHp = false; enemy.traits.push('대장장이의 대가, HP +50%'); }
    if (run.mode !== 'hell' && run.routeEncounter) routeMechanics.scaleEnemy(enemy, run.routeEncounter.id, run.routeEncounter.ambushStarted);
    if (has(run, 'hourglass')) enemy.atk = Math.round(enemy.atk * .55);
    const collapse = run.temporary.some(buff => buff.id === 'collapse' && buff.battles > 0);
    if (collapse) { enemy.atk *= 2; enemy.traits.push('붕괴, 공격력 2배'); }
    if (enemy.mirror) enemy.mirror.snapshot.stats.atk = enemy.atk;
    if (run.mode !== 'hell' && !enemy.mirror) enemy.recommendedPower = rpg().computeCombatPowerFromStats(enemy).total;
    if (kind === 'elite' && progression.has(run, 'fragileElites') && run.celestial.elites < 2) { enemy.hp = 1; run.celestial.elites++; }
    run.enemy = enemy; run.battle = { firstAttack: true, firstSkill: true, survived: false, comeback: 0, collapse, insurance: run.insurance === true };
    if (run.nextHackCard) { run.battle.hackCard = run.nextHackCard; delete run.nextHackCard; }
    run.combatLog = [];
    if (run.mode === 'hell') recordFloor(user);
    run.insurance = false;
    user.field = { name: run.mode === 'hell' ? '지옥' : '천상의 회랑', paradise: true, enteredAt: Date.now(), nextActionAt: 0, nextEnemyAttackAt: Date.now() + 4000, skillCooldowns: {}, equipmentState: {}, elite: kind === 'normal' ? null : { hp: enemy.hp, encounteredAt: Date.now() } };
    if (has(run, 'orb')) heal(user, 0, .15);
    require('./paradise_mechanics').onBattle(user);
    routeMechanics.onBattle(user);
    log(run, `${enemy.name} 조우`);
}
function startEvent(user, random = Math.random) {
    const run = user.paradise;
    const pool = Object.keys(EVENTS).filter(id => id !== 'collapse' && (id !== 'judge' || run.floor >= JUDGE_MIN_FLOOR) && (id !== 'forge' || equipmentOptions(user).length));
    if (run.distortion >= 50) pool.push('mirror', 'chests', ...(run.floor >= JUDGE_MIN_FLOOR ? ['judge'] : []));
    const id = progression.has(run, 'firstTreasure') && !run.celestial.firstEvent ? 'chests' : pick(pool, random);
    if (run.celestial) run.celestial.firstEvent = true;
    setPhase(user, 'event'); run.event = { id }; run.routes = [];
    if (id === 'forge') run.event.equipment = pick(equipmentOptions(user), random).name;
    log(run, EVENTS[id].title);
}
function forcedEncounter(user, random = Math.random) {
    const run = user.paradise;
    delete run.nextMoonDuel;
    if (run.distortion >= 100) { setPhase(user, 'event'); run.event = { id: 'collapse' }; run.routes = []; return true; }
    if (run.floor === MAX_FLOOR) { startCombat(user, 'final', null, random); return true; }
    if (run.forceElite) { run.forceElite = false; startCombat(user, 'elite', null, random); return true; }
    return false;
}
function nextEncounter(user, random = Math.random) {
    if (forcedEncounter(user, random)) return;
    const run = user.paradise;
    const eliteChance = run.distortion >= 25 ? .30 : .15;
    const roll = random();
    if (roll < .15) startEvent(user, random);
    else startCombat(user, roll < .15 + eliteChance ? 'elite' : 'normal', null, random);
}
function offerRoutes(user, random = Math.random) {
    if (forcedEncounter(user, random)) return;
    const run = user.paradise, elite = run.distortion >= 25 ? .30 : .15;
    run.routes = [];
    while (run.routes.length < 2) {
        const roll = random(), kind = roll < .15 ? 'event' : roll < .15 + elite ? 'elite' : 'normal';
        run.routes.push({ id: crypto.randomUUID(), kind, gimmick: routeMechanics.roll(user, kind, random) });
    }
    run.event = null; run.choices = []; setPhase(user, 'route');
}
function chooseRoute(user, id, random = Math.random) {
    const run = user.paradise;
    if (!active(user) || run.mode === 'hell' || run.phase !== 'route') return { error: '갈림길에서만 길을 선택할 수 있습니다.' };
    const route = run.routes?.find(route => route.id === id);
    if (!route) return { error: '현재 제시된 길 중 하나를 선택해주세요.' };
    routeMechanics.enter(user, route);
    if (route.kind === 'event') startEvent(user, random);
    else {
        const count = routeMechanics.byId.get(route.gimmick)?.sequence;
        startCombat(user, route.kind, count ? { kind: route.kind, remaining: count } : null, random);
    }
    return { message: route.gimmick ? routeMechanics.describe(route.gimmick).name : '선택한 길로 이동합니다.' };
}
function enter(user, random = Math.random) {
    if (Number(user.level || 1) < MIN_LEVEL) return { error: '낙원은 ' + MIN_LEVEL + '레벨부터 입장할 수 있습니다.' };
    if (user.paradise?.status === 'active' || user.field || require('./partyquest').getRoomOf(user.name) || user.pvp?.battle && user.pvp.battle.phase !== 'ended') return { error: '진행 중인 전투나 탐험을 먼저 마쳐주세요.' };
    if (user.paradise?.status === 'ended' && !user.paradise.claimed && (user.paradise.mode === 'hell' || user.paradise.outcome !== 'defeated' || rewardEligible(user.paradise))) return { error: '지난 탐험의 종료 보상을 먼저 수령해주세요.' };
    if (!user.main_card || user.need_character_card_select) return { error: '메인 카드를 먼저 선택해주세요.' };
    if (user.pendingAction || user.pendingFragment || user.fishing === true) return { error: '진행 중인 작업이나 보상 선택을 먼저 완료해주세요.' };
    const config = rpg().getDataCache('Paradise', null);
    if (validateConfig(config) || !config.enabled) return { error: '천상 입장이 아직 열리지 않았습니다.' };
    const id = rpg().getDataCache('Item', []).findIndex(i => i?.name === TICKET);
    if (id < 0 || rpg().getInventoryItemCount(user, id) < 1) return { error: TICKET + ' 1장이 필요합니다.' };
    const stats = rpg().calculateUserStats(user);
    rpg().removeInventoryItem(user, id, 1);
    user.paradise = { id: crypto.randomUUID(), revision: 0, status: 'active', phase: 'combat', floor: 1, highestFloor: 0, clearedFloor: 0, distortion: 0, effects: {}, relics: [], temporary: [], equipmentPermanent: {}, history: [], acquired: {}, contracts: [], battlesWon: 0, elitesWon: 0, startedAt: Date.now(), baseRewards: structuredClone(config.baseRewards), receipt: null };
    user.paradise.resources = { hp: stats.hp, mp: stats.mp };
    user.paradise.celestial = progression.snapshot(user);
    user.paradise.milestoneRewards = structuredClone(config.milestoneRewards || []);
    // 시작 유물과 천상 장비를 계산할 때부터 탐험 전용 자원을 사용한다.
    user.field = { paradise: true };
    if (progression.has(user.paradise, 'ordinaryRelic')) grantRelic(user, null, random, 'normal');
    if (progression.has(user.paradise, 'advancedRelic')) grantRelic(user, null, random, 'advanced');
    const startingStats = rpg().calculateUserStats(user);
    user.paradise.resources = { hp: progression.has(user.paradise, 'woundedAscent') ? Math.max(1, Math.round(startingStats.hp * .05)) : startingStats.hp, mp: startingStats.mp };
    startCombat(user, 'normal', null, random);
    user.paradise.startingAugments = ['silverAugment', 'prismaticAugment'].filter(id => progression.has(user.paradise, id)).map(id => id === 'silverAugment' ? 'silver' : 'prismatic');
    if (user.paradise.startingAugments.length) offerAugments(user, random, user.paradise.startingAugments[0]);
    return { message: '입장권 1장을 사용했습니다. 천상에 입장합니다.' };
}
function chooseAugment(user, id, random = Math.random) {
    const resources = getResources(user);
    const run = user.paradise;
    if (run.completed || run.phase !== 'augment' || !run.choices.includes(id) || obtainedAugment(run, id)) return { error: '현재 제시된 강화 중 하나를 선택해주세요.' };
    const choice = AUGMENTS.find(a => a.id === id);
    if (!choice) return { error: '현재 제시된 증강 중 하나를 선택해주세요.' };
    let message = choice.name + ' 획득', reveal = null;
    if (choice.equipment && !equipmentOptions(user).some(e => e.name === choice.equipment)) return { error: '해당 장비가 장착되어 있지 않습니다.' };
    if (!eligibleAugment(user, choice)) return { error: '이 증강의 장착 장비, 유물, 계약 조건을 더 이상 만족하지 않습니다.' };
    delete run.augmentCategory;
    addEffect(user, choice.effect);
    switch (choice.special) {
        case 'rukimHack': {
            const cards = require('./DB/RPGenius/CharacterCards.json'), skills = require('./DB/RPGenius/Skills.json');
            const cardId = pick(cards.map((_, i) => i).filter(i => i !== Number(user.main_card.id)), random);
            run.nextHackCard = { id: cardId, star: user.main_card.star, type: '일반' };
            message = '해킹 성공!\n' + cards[cardId].name + ', ' + cards[cardId].skills.map(i => skills[i].name).join(', ') + '\n다음 전투에서 사용할 수 있습니다.';
            reveal = { motif: 'clarity', positive: true, text: message }; break;
        }
        case 'future': run.temporary.push({ id, name: choice.name, battles: 3, effects: { atk: .50 }, forceEliteAfter: true }); break;
        case 'insurance': run.insurance = true; break;
        case 'forbidden': run.temporary.push({ id, name: choice.name, battles: 1, effects: { taken: .50 }, cooldown: .50 }); break;
        case 'rewind': heal(user, 1, 1); run.forceElite = true; break;
        case 'gambler': { const won = random() < .5; addEffect(user, { atk: won ? .30 : -.20 }); message = '회랑의 도박사, ' + (won ? '성공!\n공격력 +30%' : '실패\n공격력 -20%'); break; }
        case 'cursedTreasure': run.nextEliteAttack = true; break;
        case 'greed': run.temporary.push({ id, name: choice.name, battles: 3, rewardAfter: .20 }); break;
        case 'contract': run.contracts.push({ star: 5, type: '전직', name: '5성 전직 카드' }); break;
        case 'breath': heal(user, 0, .20); break;
        case 'pilgrim': heal(user, .15, 0); break;
        case 'clarity': run.distortion = Math.max(0, run.distortion - 10); break;
        case 'rest': heal(user, .30, .30); break;
        case 'oneHp': resources.hp = 1; break;
        case 'relicCard':
        case 'relicExchange': {
            const relic = pick(ordinaryRelics(run), random);
            const reward = grantAdventureReward(user, choice.special === 'relicCard' ? { star: 5, type: '전직' } : { relics: 2 }, random);
            run.relics = run.relics.filter(id => id !== relic);
            clampResources(user);
            message = RELICS.find(r => r.id === relic).name + ' 반납\n' + reward;
            reveal = { motif: 'contract', positive: true, text: message }; break;
        }
        case 'relicCrown': {
            const relics = ordinaryRelics(run);
            run.relics = run.relics.filter(id => !relics.includes(id)); clampResources(user);
            message = '유물 ' + relics.length + '개 반납\n' + grantAdventureReward(user, { star: 9, type: '전직' }, random);
            reveal = { motif: 'contract', positive: true, text: message }; break;
        }
        case 'slotMachine': {
            const numbers = Array.from({ length: 3 }, () => Math.min(7, 1 + Math.floor(random() * 7)));
            const same = new Set(numbers).size;
            const reward = same === 1 ? { star: numbers[0] === 7 ? 9 : 8, type: numbers[0] === 7 ? '각성' : '전직' } : same === 2 ? { star: 7, type: '일반' } : { relics: 2 };
            message = numbers.join(', ') + '\n' + grantAdventureReward(user, reward, random);
            reveal = { motif: 'gambler', positive: true, text: message }; break;
        }
        case 'doubleContract': {
            const contract = pick(run.contracts.filter(c => c.star), random), won = random() < .5;
            if (won) run.contracts.push({ ...contract }); else run.contracts.splice(run.contracts.indexOf(contract), 1);
            message = (won ? '계약 복제 성공!\n' : '서명이 사라졌습니다.\n') + contract.name + (won ? ' 1장 추가' : ' 계약 상실');
            reveal = { motif: 'gambler', positive: won, text: message }; break;
        }
        case 'tricksterGift':
        case 'museumNight': {
            const reward = choice.special === 'museumNight' || random() < .5 ? { relics: 3 } : { star: 7, type: '각성' };
            message = grantAdventureReward(user, reward, random);
            if (choice.special === 'museumNight') { run.nextEliteHp = true; message += '\n다음 엘리트 HP +50%'; }
            reveal = { motif: 'contract', positive: true, text: message }; break;
        }
    }
    const acquire = choice.acquire;
    if (acquire) {
        if (acquire.temporary) run.temporary.push({ id, name: choice.name, ...structuredClone(acquire.temporary) });
        if (acquire.hpCost) resources.hp = Math.max(1, Math.floor(resources.hp * (1 - acquire.hpCost)));
        if (acquire.heal) heal(user, ...acquire.heal);
        if (acquire.distortion) run.distortion = clamp(run.distortion + acquire.distortion, 0, 100);
        if (acquire.forceElite) run.forceElite = true;
        if (acquire.relic) {
            message = choice.name + '\n' + grantRelic(user, null, random) + '\n공격력 -15%';
            reveal = { motif: 'contract', positive: true, text: message };
        }
        if (acquire.outcomes) {
            let roll = random();
            const outcome = acquire.outcomes.find(option => (roll -= option.chance) < 0) || acquire.outcomes.at(-1);
            addEffect(user, outcome.effects);
            message = choice.name + '\n' + outcome.text;
            reveal = { motif: 'gambler', positive: outcome.positive, text: message };
        }
    }
    run.acquired[id] = Number(run.acquired[id] || 0) + 1;
    if (choice.quest) {
        (run.quests ||= []).push({ ...structuredClone(choice.quest), id, name: choice.name, remaining: choice.quest.battles, progress: 0, status: 'active' });
        if (choice.quest.forceElite) run.forceElite = true;
        message += '\n계약 시작, ' + choice.desc;
    }
    heal(user, progression.has(run, 'augmentHp') ? .02 : 0, progression.has(run, 'augmentMp') ? .02 : 0);
    if (run.startingAugments?.length) {
        log(run, '시작 증강, ' + choice.name); run.startingAugments.shift();
        if (run.startingAugments.length) offerAugments(user, random, run.startingAugments[0]);
        else startCombat(user, 'normal', null, random);
    } else {
        const floors = progression.movement(run, choice.floors);
        move(user, choice.floors, choice.dangerous);
        log(run, `${choice.name}, ${floors > 0 ? '+' : ''}${floors}층`);
        if (choice.encounter && run.distortion < 100 && run.floor < MAX_FLOOR) {
            const id = progression.has(run, 'firstTreasure') && !run.celestial.firstEvent ? 'chests' : choice.encounter;
            if (run.celestial) run.celestial.firstEvent = true;
            setPhase(user, 'event'); run.event = { id }; run.choices = [];
            if (id === 'forge') run.event.equipment = pick(equipmentOptions(user), random).name;
            log(run, EVENTS[id].title);
        } else offerRoutes(user, random);
    }
    run.lastOutcome = message;
    if (choice.special === 'gambler') reveal = { motif: 'gambler', positive: message.includes('성공'), text: message };
    if (reveal) log(run, message.replace(/\n/g, ', '));
    return { message, reveal };
}
function eventChoices(user) {
    const event = user.paradise.event;
    if (!event) return [];
    const chance = has(user.paradise, 'dice') ? 18 : 0, equipment = event.equipment;
    const entries = {
        puzzle: [['solve', '봉인을 푼다', '제한 시간은 120초.\n성공하면 공격력 +10% 또는 최종 피해 +8%.\n10층을 오르고 뒤틀림이 10 줄어듭니다.\n실패하면 현재 HP가 15% 줄어듭니다.'], ['skip', '그냥 지나간다', '퍼즐을 건너뛰고 5층을 올라갑니다.']],
        casino: [['safe', '안전한 도박', `성공 확률 ${70 + chance}%.\n성공하면 10층 이동, 공격력 +10%.\n실패하면 현재 HP -10%.`], ['risk', '위험한 도박', `성공 확률 ${30 + chance}%.\n성공하면 50층 이동, 공격력 +30%.\n실패하면 공격력 -15%.`], ['attack', '도박사를 공격한다', '엘리트 도박사와 싸웁니다.\n이기면 천상 유물 하나를 얻습니다.']],
        forge: [['enhance', '장비를 강화한다', `${equipment}\n다음 3번의 전투에서 패시브 수치가 2배.\n대신 다음 엘리트의 HP가 50% 늘어납니다.`], ['modify', '장비를 개조한다', `${equipment}\n이번 탐험 동안 패시브 수치 +20%.\n대신 최대 HP가 15% 줄어듭니다.`], ['skip', '거절한다', '5층을 올라갑니다.\n최대 HP의 10%를 회복합니다.']],
        mirror: [['fight', '거울을 부순다', '장비와 모든 기술을 복제한 자신과 싸웁니다.\n복제본에게는 천상 증강과 유물이 없습니다.\n승리하면 공격력 +20%, 종료 보상 +30%.'], ['trade', '거울 속 자신과 거래한다', '지금까지 얻은 강화·저주·유물을 모두 버립니다.\n대신 종료 보상이 40% 늘어납니다.\n이미 맺은 보상 계약은 유지됩니다.'], ['skip', '거울을 무시한다', '거울을 지나 5층을 올라갑니다.']],
        chests: [['red', '붉은 상자', '공격력을 키울 기회.\n공격 관련 강화가 나올 확률이 높습니다.'], ['blue', '푸른 상자', '몸을 지키고 회복할 기회.\n방어·회복 강화가 나올 확률이 높습니다.'], ['gold', '황금 상자', '진귀한 보물이 잠들어 있을지도 모릅니다.\n하지만 강한 저주가 따라올 수 있습니다.']],
        judge: [['three', '세 번의 시련', '일반 몬스터 3마리와 연속으로 싸웁니다.\n모두 이기면 공격력 +15%.'], ['elite', '정예의 시련', '엘리트 몬스터 한 마리와 싸웁니다.\n이기면 공격력 +25%.'], ['boss', '심판자에게 도전한다', '매우 강력한 심판자와 싸웁니다.\n승리하면 심판자의 성흔을 얻습니다.\n' + RELICS.find(r => r.id === 'judgment').desc + '\n8성 전직 카드 계약도 얻습니다.']],
        well: [['blood', '피를 바친다', '최대 HP를 20% 바칩니다.\n공격력이 30% 늘고 뒤틀림이 10 쌓입니다.'], ['drink', '우물의 물을 마신다', 'HP와 MP를 모두 회복합니다.\n대신 다음 2번의 전투에서 받는 피해 +20%.'], ['destroy', '우물을 파괴한다', '일반 몬스터 2마리와 연속으로 싸웁니다.\n모두 이기면 최대 HP +10%.']],
        riftTrader: [['power', '파괴의 힘을 받는다', '공격력이 25% 증가합니다.\n대신 뒤틀림이 20 쌓입니다.'], ['vigor', '불굴의 육신을 받는다', '최대 HP와 방어력이 각각 25% 증가합니다.\n대신 뒤틀림이 20 쌓입니다.'], ['pierce', '꿰뚫는 눈을 받는다', '방어 관통력이 300 증가합니다.\n적의 방어력을 10% 추가로 무시합니다.\n대신 뒤틀림이 25 쌓입니다.'], ['skip', '도망친다', '거래하지 않고 5층을 올라갑니다.']],
        collapse: [['prevent', '붕괴를 막는다', '현재 HP의 절반을 바칩니다.\n뒤틀림이 50으로 내려갑니다.'], ['accept', '붕괴를 받아들인다', '다음 3번의 전투에서 적의 공격력이 2배가 됩니다.\n모두 승리하면 종료 보상이 30% 증가합니다.\n뒤틀림은 50으로 내려갑니다.'], ['rift', '균열 속으로 뛰어든다', '50층을 올라 특수 보스와 싸웁니다.\n승리하면 균열의 심장 유물과\n9성 전직 카드 계약을 얻습니다.']]
    };
    return (entries[event.id] || []).map(([id, name, desc]) => ({ id, name, desc }));
}
function chooseEvent(user, id, input = {}, random = Math.random) {
    const resources = getResources(user);
    const run = user.paradise, event = run.event;
    if (run.phase !== 'event' || !event || !eventChoices(user).some(c => c.id === id)) return { error: '현재 이벤트의 선택지를 골라주세요.' };
    const selected = eventChoices(user).find(c => c.id === id);
    const chance = has(run, 'dice') ? .18 : 0;
    let fighting = false, message = '', outcomePositive = true;
    const battle = (kind, remaining, reward) => { startCombat(user, kind, { kind, remaining, reward }, random); fighting = true; };
    switch (event.id) {
        case 'puzzle':
            if (id === 'skip') move(user, 5);
            else {
                const puzzle = wisdom.getPuzzle(pick(['2026-01-03', '2026-01-04'], random), run.id, crypto.randomUUID());
                setPhase(user, 'puzzle'); run.event = { id: 'puzzle', puzzle, deadline: Date.now() + 120000 }; return { message: '봉인을 풀어주세요. 제한 시간 120초.' };
            }
            break;
        case 'casino':
            if (id === 'attack') battle('elite', 1, 'casino');
            else {
                const won = random() < (id === 'safe' ? .70 : .30) + chance;
                outcomePositive = won;
                if (won) { move(user, id === 'safe' ? 10 : 50); addEffect(user, { atk: id === 'safe' ? .10 : .30 }); }
                else if (id === 'safe') resources.hp = Math.max(1, Math.floor(resources.hp * .9));
                else addEffect(user, { atk: -.15 });
                message = won ? `도박 성공!\n${id === 'safe' ? '+10층, 공격력 +10%' : '+50층, 공격력 +30%'}` : `도박 실패\n${id === 'safe' ? '현재 HP -10%' : '공격력 -15%'}`;
            }
            break;
        case 'forge':
            if (id !== 'skip' && !equipmentOptions(user).some(e => e.name === event.equipment)) return { error: '강화 가능한 장비를 더 이상 장착하고 있지 않습니다.' };
            if (id === 'enhance') { run.temporary.push({ id: 'forge', name: event.equipment + ', 대장장이 강화', equipment: event.equipment, battles: 3, multiplier: 2 }); run.nextEliteHp = true; }
            else if (id === 'modify') { run.equipmentPermanent[event.equipment] = Number(run.equipmentPermanent[event.equipment] || 0) + .20; addEffect(user, { hp: -.15 }); }
            else { move(user, 5); heal(user, .10); }
            break;
        case 'mirror':
            if (id === 'fight') battle('mirror', 1, 'mirror');
            else if (id === 'trade') {
                run.discardedAugments = [...new Set([...(run.discardedAugments || []), ...Object.keys(run.acquired)])];
                run.effects = {}; run.relics = []; run.temporary = []; run.quests = []; run.equipmentPermanent = {}; run.acquired = {}; run.compass = 0; run.ring = 0; run.focus = 0; run.insurance = false; run.forceElite = false; run.nextEliteAttack = false; run.nextEliteHp = false;
                run.contracts.push({ bonus: .40, name: '거울과의 거래, 종료 보상 +40%' }); clampResources(user);
            } else move(user, 5);
            break;
        case 'chests': {
            const key = has(run, 'key') ? .22 : 0, roll = random();
            if (id === 'gold' && roll < .02 + key * .1) {
                const contract = pick([
                    { star: 9, type: '각성', name: '9성 각성 카드' },
                    { star: 9, type: '전직', name: '9성 전직 카드' },
                    { bonus: 1, name: '황금의 서약, 종료 보상 +100%' }
                ], random);
                run.contracts.push({ ...contract });
                message = '황금빛 계약 획득!\n' + contract.name + (contract.star ? '\n탐험 종료 시 확정 획득' : '');
            }
            else if (id === 'gold' && roll < .42 + key) { const relic = grantRelic(user, null, random); addEffect(user, { atk: .25 }); message = '황금 상자 개봉\n' + relic + '\n공격력 +25%'; }
            else if (id === 'gold' && run.effects.goldAmnesty) message = '황금 방의 보호가 발동했습니다!\n' + grantRelic(user, null, random);
            else if (id === 'gold') { outcomePositive = false; addEffect(user, { taken: .15 }); run.distortion = clamp(run.distortion + 15, 0, 100); message = '저주가 스며듭니다. 받는 피해 +15%, 뒤틀림 +15.'; }
            else {
                const defensive = id === 'blue' ? roll < .8 + key : roll >= .8 + key;
                if (defensive) { const buff = pick([{ hp: .15 }, { def: .20 }], random); addEffect(user, buff); heal(user, .20, .20); message = '방어의 축복\n' + (buff.hp ? '최대 HP +15%' : '방어력 +20%') + '\nHP와 MP 20% 회복'; }
                else { addEffect(user, { atk: .15, final: .05 }); message = '공격의 축복, 공격력 +15%, 최종 피해 +5%'; }
            }
            if (id === 'gold') run.effects.goldAmnesty = 0;
            break;
        }
        case 'judge': battle(id === 'three' ? 'normal' : id === 'elite' ? 'elite' : 'judge', id === 'three' ? 3 : 1, 'judge:' + id); break;
        case 'well':
            if (id === 'blood') { addEffect(user, { hp: -.20, atk: .30 }); run.distortion = clamp(run.distortion + 10, 0, 100); }
            else if (id === 'drink') { heal(user, 1, 1); run.temporary.push({ id: 'well', name: '붉은 물의 대가', effects: { taken: .20 }, battles: 2 }); }
            else battle('normal', 2, 'well');
            break;
        case 'riftTrader':
            if (id === 'skip') move(user, 5);
            else {
                addEffect(user, id === 'power' ? { atk: .25 } : id === 'vigor' ? { hp: .25, def: .25 } : { pnt: 300, pntPercent: .10 });
                run.distortion = clamp(run.distortion + (id === 'pierce' ? 25 : 20), 0, 100);
                message = selected.name + '\n' + selected.desc + '\n이번 탐험 동안 유지됩니다.';
            }
            break;
        case 'collapse':
            run.distortion = 50;
            if (id === 'prevent') resources.hp = Math.max(1, Math.floor(resources.hp * .50));
            else if (id === 'accept') run.temporary.push({ id: 'collapse', name: '붕괴의 계약', battles: 3, rewardAfter: .30 });
            else { move(user, 50); battle('rift', 1, 'rift'); }
            break;
    }
    message ||= fighting ? run.enemy.name + ' 출현' : selected.name + '\n' + selected.desc;
    log(run, message); run.lastOutcome = message;
    if (!fighting) {
        if (event.id === 'collapse') nextEncounter(user, random);
        else if (!routeMechanics.eventComplete(user, random)) { recordFloor(user); if (!offerRelics(user, random)) offerAugments(user, random); }
    }
    return { message, reveal: !fighting && (['casino', 'chests'].includes(event.id) || event.id === 'riftTrader' && id !== 'skip') ? { motif: event.id === 'casino' ? 'gambler' : 'contract', positive: outcomePositive, text: message } : null };
}
function answerPuzzle(user, answer, random = Math.random) {
    const resources = getResources(user);
    const run = user.paradise;
    if (run.phase !== 'puzzle') return { error: '진행 중인 퍼즐이 없습니다.' };
    const expired = Date.now() >= run.event.deadline;
    const skipped = answer === null;
    const checked = expired || skipped ? { correct: false } : wisdom.checkAnswer(run.event.puzzle, answer);
    if (checked.error) return checked;
    let message;
    if (skipped && !expired) { move(user, 5); message = '퍼즐을 건너뛰었습니다. +5층'; }
    else if (checked.correct) { const attack = random() < .5; addEffect(user, attack ? { atk: .10 } : { final: .08 }); move(user, 10); run.distortion = Math.max(0, run.distortion - 10); message = '봉인 해제!\n' + (attack ? '공격력 +10%' : '최종 피해 +8%') + '\n+10층, 뒤틀림 -10'; }
    else { resources.hp = Math.max(1, Math.floor(resources.hp * .85)); message = expired ? '시간 초과, 현재 HP -15%' : '오답, 현재 HP -15%'; }
    if (checked.correct && has(run, 'crystalVial')) {
        heal(user, .22, .22);
        const progress = (run.relicState ||= {});
        if (Number(progress.crystalVial || 0) < 3) {
            progress.crystalVial = Number(progress.crystalVial || 0) + 1;
            run.effects.reward = Number(run.effects.reward || 0) + .09;
            message += '\n새벽의 이슬병, 종료 보상 +9%';
        }
    }
    log(run, message); run.lastOutcome = message;
    if (!routeMechanics.eventComplete(user, random)) { recordFloor(user); if (!offerRelics(user, random)) offerAugments(user, random); }
    return { message, reveal: { motif: 'clarity', positive: checked.correct, text: message } };
}
function grantAdventureReward(user, reward, random = Math.random) {
    const lines = [];
    if (reward.star) {
        const contract = { star: reward.star, type: reward.type, name: `${reward.star}성 ${reward.type} 카드` };
        user.paradise.contracts.push(contract); lines.push(contract.name + ' 계약 획득');
    }
    for (let i = 0; i < Number(reward.relics || 0); i++) lines.push(grantRelic(user, null, random));
    if (reward.atk) { addEffect(user, { atk: reward.atk }); lines.push(`공격력 +${Math.round(reward.atk * 100)}%`); }
    if (reward.heal) { heal(user, 1, 1); lines.push(user.paradise.effects.noHealing ? '회복 봉쇄' : 'HP와 MP 전부 회복'); }
    if (reward.restore) { heal(user, 1, 1); user.paradise.distortion = Math.max(0, user.paradise.distortion - 30); lines.push(user.paradise.effects.noHealing ? '회복 봉쇄, 뒤틀림 -30' : 'HP와 MP 전부 회복, 뒤틀림 -30'); }
    return lines.join('\n');
}
function questResult(run, quest, success, reward = '') {
    quest.status = success ? 'completed' : 'failed';
    const text = quest.name + (success ? ', 계약 달성' : ', 계약 실패') + (reward ? '\n' + reward : '');
    log(run, text.replace(/\n/g, ', '));
    run.rewardReveal = { motif: 'contract', positive: (run.rewardReveal?.positive || success), text: [run.rewardReveal?.text, text].filter(Boolean).join('\n') };
}
function resolveQuests(user, random) {
    const run = user.paradise;
    for (const quest of run.quests || []) {
        if (quest.status !== 'active') continue;
        quest.remaining--;
        if (quest.condition === 'basicOnly' && run.battle.skillsUsed || quest.condition === 'twoSpells' && (run.battle.skillNames || []).length < 2) { questResult(run, quest, false); continue; }
        quest.progress += quest.condition === 'criticals' ? Number(run.battle.criticalHits || 0) : quest.condition === 'untouched' ? (run.battle.hasTakenHpDamage ? 0 : 1) : 1;
        if (quest.remaining <= 0) {
            const success = quest.progress >= (quest.target || quest.battles);
            const reward = ['duelistContract', 'deathHandshake'].includes(quest.id) ? AUGMENTS.find(a => a.id === quest.id).quest.reward : quest.reward;
            questResult(run, quest, success, success ? grantAdventureReward(user, reward, random) : '');
        } else if (quest.forceElite) run.forceElite = true;
    }
}
function reduceLongestCooldown(user, milliseconds) {
    const now = Date.now(), cooldowns = user.field.skillCooldowns;
    const entry = Object.entries(cooldowns).filter(([, until]) => until > now).sort((a, b) => b[1] - a[1])[0];
    if (entry) cooldowns[entry[0]] = milliseconds === Infinity ? now : Math.max(now, entry[1] - milliseconds);
    return entry?.[0];
}
function combatNotice(extra, text) { extra.notice = [extra.notice, text].filter(Boolean).join(' / '); }
function prepareAttack(user, extra) {
    if (!active(user) || extra.summonAttack || extra.dotAttack || extra.isBotAutoAttack) return;
    const run = user.paradise;
    if (extra.isBasic && has(run, 'tuningFork') && run.battle.tuningForkReady) {
        run.battle.tuningForkReady = false;
        extra.defReductionBonus = 1; extra.tuningForkDouble = true;
        combatNotice(extra, '천상의 소리굽쇠, 방어력 무시');
    }
    if (run.effects.sparkJar && run.battle.sparks >= 3) {
        extra.forceCritical = true; run.battle.sparks = 0;
        combatNotice(extra, '불꽃 저금통, 확정 치명타');
    }
}
function modifyHit(user, extra, hit) {
    if (extra.summonAttack || extra.dotAttack || extra.isBotAutoAttack || hit.finalDamage <= 0) return;
    const run = user.paradise, battle = run.battle;
    const damage = hit.finalDamage;
    const add = (amount, name) => {
        amount = Math.round(amount);
        if (amount <= 0) return;
        hit.finalDamage += amount;
        (hit.hitDetails ||= []).push({ damage: amount, label: name, isCritical: false });
        combatNotice(extra, name + ', 추가 피해 ' + amount.toLocaleString('ko-KR'));
    };
    if (run.effects.echoStrike) {
        if (battle.echoDamage) { add(battle.echoDamage * .4, '메아리 저장고'); battle.echoDamage = 0; }
        else battle.echoDamage = damage;
    }
    if (!extra.isBasic && run.effects.revengeVault && battle.revengeDamage) { add(battle.revengeDamage, '복수의 금고'); battle.revengeDamage = 0; }
    if (run.effects.overkillParcel && battle.attackCount === 1 && run.overkillDamage) { add(Math.min(run.overkillDamage, run.enemy.maxHp * .30), '남은 일격의 행선지'); run.overkillDamage = 0; }
}
function onSkillUsed(user, spent, skillName) {
    const resources = getResources(user);
    if (!active(user)) return;
    const run = user.paradise, effects = sumEffects(run);
    routeMechanics.onSkill(user, skillName);
    run.battle.skillsUsed = Number(run.battle.skillsUsed || 0) + 1;
    if (skillName) run.battle.skillNames = [...new Set([...(run.battle.skillNames || []), skillName])];
    if (has(run, 'starlightSpool') && run.battle.skillsUsed === 1) {
        const stats = rpg().calculateUserStats(user);
        if (!stats.disableShield) require('./combat_shields').grant(user.field, { source: 'paradise:starlightSpool', caster: user.name, amount: Math.round(stats.hp * .22 * (1 + Number(stats.shieldEfficiency || 0))), expiresAt: Date.now() + 15000 });
    }
    if (has(run, 'echoBell') && run.battle.skillsUsed % 2 === 0) run.battle.echoBellReady = true;
    const ultimate = skillName && rpg().getUltimateSkills(user).some(entry => entry.skill.name === skillName);
    if (has(run, 'tuningFork') && ultimate) run.battle.tuningForkReady = true;
    if (has(run, 'runeQuill') && skillName && !ultimate) run.battle.quillSkills = [...new Set([...(run.battle.quillSkills || []), skillName])];
    for (const quest of run.quests || []) if (quest.status === 'active' && quest.condition === 'basicOnly') questResult(run, quest, false);
    if (effects.spellWeave) run.battle.spellWeaveReady = true;
    if (effects.skillGuard) run.battle.skillGuardReady = true;
    if (!run.effects.noHealing && effects.manaCycle) resources.mp = Math.min(rpg().calculateUserStats(user).mp, resources.mp + Math.floor(spent * .20));
    if (effects.skillHeal) heal(user, effects.skillHeal);
    if (effects.paperWard && spent > 0) {
        const stats = rpg().calculateUserStats(user);
        if (!stats.disableShield) require('./combat_shields').grant(user.field, { source: 'paradise:paperWard', caster: user.name, amount: Math.round(Math.min(stats.hp * .25, spent * 3 * (1 + Number(stats.shieldEfficiency || 0)))), expiresAt: Date.now() + 10000 });
    }
    if (effects.skillRelay && skillName) {
        const now = Date.now();
        for (const name of Object.keys(user.field.skillCooldowns)) if (name !== skillName && user.field.skillCooldowns[name] > now) user.field.skillCooldowns[name] = Math.max(now, user.field.skillCooldowns[name] - 1500);
    }
}
function cooldownMultiplier(user) {
    if (!active(user)) return 1;
    const run = user.paradise, effects = sumEffects(run);
    let multiplier = Math.max(.10, 1 + Number(effects.cooldown || 0) - (effects.calmMind && run.distortion >= 25 ? .20 : 0));
    if (run.temporary.some(b => b.id === 'forbidden' && b.battles > 0)) multiplier *= .50;
    if (run.battle.firstSkill && has(run, 'clock')) multiplier *= .30;
    if (run.battle.firstSkill && effects.clockHeart) multiplier = 0;
    run.battle.firstSkill = false;
    return multiplier * routeMechanics.cooldown(user);
}
function attackMultiplier(user, extra) {
    const resources = getResources(user);
    const run = user.paradise, effects = sumEffects(run), battle = run.battle;
    let multiplier = extra.tuningForkDouble ? 1.9 : 1;
    const manual = !extra.summonAttack && !extra.dotAttack && !extra.isBotAutoAttack;
    if (manual && run.battle.firstAttack) { if (run.effects.firstStrike) multiplier *= 2; run.battle.firstAttack = false; }
    if (run.effects.execution && run.enemy.hp <= run.enemy.maxHp * .20) multiplier *= 1.50;
    if (manual && run.effects.comeback) { multiplier *= 1 + Math.min(.30, Math.floor((run.battle.comeback + 1e-9) * 10) * .05); run.battle.comeback = 0; }
    if (effects.healthyEnemy && run.enemy.hp >= run.enemy.maxHp * .80) multiplier *= 1 + effects.healthyEnemy;
    if (effects.woundedEnemy && run.enemy.hp <= run.enemy.maxHp * .35) multiplier *= 1 + effects.woundedEnemy;
    if (effects.untouched && !battle.hasTakenHpDamage) multiplier *= 1 + effects.untouched;
    if (effects.highMana || effects.lowMana) {
        const maxMp = rpg().calculateUserStats(user).mp;
        if (maxMp > 0) {
            if (effects.highMana && resources.mp >= maxMp * .80) multiplier *= 1 + effects.highMana;
            if (effects.lowMana && resources.mp <= maxMp * .25) multiplier *= 1 + effects.lowMana;
        }
    }
    if (manual) {
        const type = extra.isBasic ? 'basic' : 'skill', count = Number(battle.attackCount || 0);
        multiplier *= Math.max(.05, 1 + Number(effects[type === 'basic' ? 'basicDamage' : 'skillDamage'] || 0));
        if (effects.alternating && battle.lastAttackType && battle.lastAttackType !== type) multiplier *= 1 + effects.alternating;
        if (effects.thirdStrike && (count + 1) % 3 === 0) multiplier *= 1 + effects.thirdStrike;
        if (effects.patientHunter) multiplier *= 1 + Math.min(.40, count * effects.patientHunter);
        if (effects.briefGlory) multiplier *= count < 3 ? 1.35 : .85;
        battle.sameTypeStreak = battle.lastAttackType === type ? Number(battle.sameTypeStreak || 0) + 1 : 0;
        if (effects.sameRhythm) multiplier *= 1 + Math.min(.48, battle.sameTypeStreak * effects.sameRhythm);
        if (effects.missedFortune && battle.missedFortuneReady) multiplier *= 1 + effects.missedFortune;
        if (type === 'basic') {
            if (has(run, 'echoBell') && battle.echoBellReady) { multiplier *= 2.8; battle.echoBellReady = false; combatNotice(extra, '메아리 종, 피해 2.8배'); }
            if (effects.quietBlade && !battle.skillsUsed) multiplier *= 1 + effects.quietBlade;
            if (effects.spellWeave && battle.spellWeaveReady) { multiplier *= 1 + effects.spellWeave; battle.spellWeaveReady = false; }
            if (effects.swordCharge) battle.basicCharges = Math.min(3, Number(battle.basicCharges || 0) + 1);
            if (effects.basicHpCost) resources.hp = Math.max(1, resources.hp - Math.round(rpg().calculateUserStats(user).hp * effects.basicHpCost));
        } else {
            if (effects.openingSpell && !battle.openingSpellUsed) { multiplier *= 1 + effects.openingSpell; battle.openingSpellUsed = true; }
            if (effects.swordCharge && battle.basicCharges >= 3) { multiplier *= 1 + effects.swordCharge; battle.basicCharges = 0; }
        }
        battle.attackCount = count + 1; battle.lastAttackType = type;
    }
    return multiplier;
}
function afterAttack(user, extra, hit) {
    if (!active(user) || extra.summonAttack || extra.dotAttack || extra.isBotAutoAttack) return;
    const run = user.paradise, effects = sumEffects(run);
    if (extra.isBasic && effects.basicGuard) run.battle.basicGuardReady = true;
    if (effects.missedFortune) run.battle.missedFortuneReady = Number(hit.criticalCount || 0) === 0;
    const mp = (extra.isBasic && hit.finalDamage > 0 ? Number(effects.basicMp || 0) : 0) + Math.min(.05, Number(hit.criticalCount || 0) * Number(effects.criticalMp || 0));
    if (mp) heal(user, 0, mp);
    if (hit.finalDamage > 0) {
        const battle = run.battle;
        battle.criticalHits = Number(battle.criticalHits || 0) + Number(hit.criticalCount || 0);
        if (effects.sparkJar && !hit.criticalCount) battle.sparks = Math.min(3, Number(battle.sparks || 0) + 1);
        if (extra.isBasic && effects.windupKey) {
            battle.windingHits = Number(battle.windingHits || 0) + 1;
            if (battle.windingHits % 3 === 0) { const skill = reduceLongestCooldown(user, 3000); if (skill) combatNotice(extra, '태엽 감는 손, ' + skill + ' 쿨타임 -3초'); }
        }
        if (effects.stolenTurn) {
            battle.stolenHits = Number(battle.stolenHits || 0) + 1;
            if (battle.stolenHits % 5 === 0) {
                const skill = reduceLongestCooldown(user, Infinity); battle.stolenGuard = true;
                combatNotice(extra, '훔쳐 온 한 턴, ' + (skill ? skill + ' 쿨타임 초기화, ' : '') + '다음 피격 무효');
            }
        }
        if (effects.overkillParcel && extra.paradiseEnemyHpBefore > 0 && hit.finalDamage > extra.paradiseEnemyHpBefore) run.overkillDamage = hit.finalDamage - extra.paradiseEnemyHpBefore;
    }
}
function incomingMultiplier(user, received) {
    if (!active(user) || received <= 0) return 1;
    const run = user.paradise, effects = sumEffects(run), battle = run.battle;
    if (effects.pocketSand && !battle.sandUsed) { battle.sandUsed = true; return 0; }
    if (effects.stolenTurn && battle.stolenGuard) { battle.stolenGuard = false; return 0; }
    let multiplier = 1;
    if (effects.arrivalGuard && Number(battle.arrivalGuardUsed || 0) < 2) {
        multiplier *= 1 - effects.arrivalGuard; battle.arrivalGuardUsed = Number(battle.arrivalGuardUsed || 0) + 1;
    }
    if (effects.basicGuard && battle.basicGuardReady) { multiplier *= 1 - effects.basicGuard; battle.basicGuardReady = false; }
    if (effects.skillGuard && battle.skillGuardReady) { multiplier *= 1 - effects.skillGuard; battle.skillGuardReady = false; }
    return multiplier;
}
function onDamageTaken(user, lostHp) {
    const resources = getResources(user);
    if (!active(user) || lostHp <= 0) return;
    const run = user.paradise, effects = sumEffects(run);
    run.battle.hasTakenHpDamage = true;
    const equipmentLines = [];
    rpg().tryHellfireRage(user, undefined, equipmentLines);
    equipmentLines.forEach(message => log(run, message));
    if (effects.revengeVault) run.battle.revengeDamage = Math.min(rpg().calculateUserStats(user).hp * 2, Number(run.battle.revengeDamage || 0) + lostHp);
    if (effects.reserveHeal && !run.battle.reserveHealUsed && resources.hp > 0 && resources.hp <= rpg().calculateUserStats(user).hp * .25) {
        run.battle.reserveHealUsed = true; heal(user, effects.reserveHeal);
        log(run, run.effects.noHealing ? '안주머니의 비상약, 회복 봉쇄' : '안주머니의 비상약, HP 30% 회복');
    }
}
function survive(user, nextHp, maxHp) {
    const run = user.paradise;
    if (nextHp > 0) return nextHp;
    const characterHp = require('./paradise_augments_characters').survive(user, nextHp, maxHp);
    if (characterHp > 0) return characterHp;
    const mechanicHp = require('./paradise_mechanics').survive(user, nextHp);
    if (mechanicHp > 0) return mechanicHp;
    if (run.effects.unyielding && !run.battle.survived) { run.battle.survived = true; log(run, '불굴의 의지, HP 1로 생존'); return 1; }
    if (run.battle.insurance) { run.battle.insurance = false; log(run, '회랑의 보험 발동'); return run.effects.noHealing ? 1 : Math.max(1, Math.round(maxHp * .30)); }
    if (has(run, 'abyssDiadem') && !run.battle.abyssSaved) {
        run.battle.abyssSaved = true; getResources(user).mp = 0;
        log(run, '파멸의 면류관, MP를 소모하고 생존했습니다.');
        return run.effects.noHealing ? 1 : Math.max(1, Math.round(maxHp * .45));
    }
    if (has(run, 'feather') && !run.featherUsed) { run.featherUsed = true; heal(user, 0, .55); log(run, '불사의 깃털 발동'); return run.effects.noHealing ? 1 : Math.max(1, Math.round(maxHp * .55)); }
    const pledge = ordinaryRelics(run)[0];
    if (run.effects.phoenixPact && Number(run.phoenixUsed || 0) < 3 && pledge) {
        run.relics = run.relics.filter(id => id !== pledge); run.phoenixUsed = Number(run.phoenixUsed || 0) + 1;
        log(run, '불사조의 담보, ' + RELICS.find(r => r.id === pledge).name + ' 소각');
        return run.effects.noHealing ? 1 : Math.max(1, Math.round(Math.min(maxHp, rpg().calculateUserStats(user).hp) * .30));
    }
    return 0;
}
function victory(user, random = Math.random) {
    if (user.paradise.mode === 'hell') return require('./paradise_hell').victory(user, random);
    require('./paradise_mechanics').onVictory(user);
    const run = user.paradise, enemy = run.enemy, elite = enemy.kind === 'elite';
    run.battlesWon++;
    if (run.routeEncounter) run.routeEncounter.wins++;
    const progress = (run.relicState ||= {});
    for (const id of ['meditationCenser', 'returnLantern']) {
        if (!has(run, id)) continue;
        const relic = (progress[id] ||= { wins: 0 });
        if (++relic.wins % 2 !== 0) continue;
        if (id === 'meditationCenser') { heal(user, .27, .27); log(run, '명상 향로, HP와 MP 회복'); }
        else if (Number(progress.timeRestored || 0) < 162000) {
            const now = Date.now(), before = remainingTime(run, now), restored = Math.min(27000, timeLimit(run) - before, 162000 - Number(progress.timeRestored || 0));
            run.clock = { remainingMs: before + restored, limitMs: timeLimit(run), updatedAt: now, paused: false };
            progress.timeRestored = Number(progress.timeRestored || 0) + restored;
            log(run, `귀환 등불, 탐험 시간 ${Math.round(restored / 1000)}초 회복`);
        }
    }
    if (has(run, 'runeQuill') && (run.battle.quillSkills || []).length >= 2 && Number(progress.runeQuill || 0) < 3) {
        progress.runeQuill = Number(progress.runeQuill || 0) + 1;
        const message = '룬 깃펜, ' + grantAdventureReward(user, { star: 8, type: '일반' }, random);
        run.rewardReveal = { motif: 'contract', positive: true, text: [run.rewardReveal?.text, message].filter(Boolean).join('\n') };
        log(run, message);
    }
    if (elite) { run.elitesWon++; run.distortion = Math.max(0, run.distortion - 5); if (has(run, 'crown')) heal(user, .27, .14); }
    if (elite && random() < .60) run.relicPicksRemaining = Number(run.relicPicksRemaining || 0) + 1;
    const effects = sumEffects(run);
    if (effects.victoryAtkGrowth) run.attackGrowth = Math.min(.30, Number(run.attackGrowth || 0) + effects.victoryAtkGrowth);
    if (effects.victoryHpGrowth) run.hpGrowth = Math.min(.20, Number(run.hpGrowth || 0) + effects.victoryHpGrowth);
    if (effects.victoryDistortion) run.distortion = clamp(run.distortion + effects.victoryDistortion, 0, 100);
    resolveQuests(user, random);
    heal(user, (effects.thirst ? .10 : 0) + Number(effects.victoryHp || 0) + (elite ? Number(effects.eliteHp || 0) : 0), Number(effects.victoryMp || 0) + (elite ? Number(effects.eliteMp || 0) : 0));
    for (const buff of run.temporary) {
        // 진행 중이던 이전 붕괴 계약도 남은 승리 수를 유지한 채 새 보상으로 처리한다.
        if (buff.id === 'collapse') { buff.name = '붕괴의 계약'; buff.rewardAfter = .30; }
        buff.battles--;
        if (!buff.battles && buff.forceEliteAfter) run.forceElite = true;
        if (!buff.battles && buff.rewardAfter) { run.effects.reward = Number(run.effects.reward || 0) + buff.rewardAfter; log(run, buff.name + ' 달성, 종료 보상 +' + Math.round(buff.rewardAfter * 100) + '%'); }
        if (!buff.battles && buff.afterEffects) { addEffect(user, buff.afterEffects); log(run, buff.name + ', 빌린 힘의 대가가 적용됩니다.'); }
    }
    run.temporary = run.temporary.filter(buff => buff.battles > 0);
    run.relics = run.relics.filter(id => id !== 'hourglass');
    clampResources(user); rpg().clearFieldRuntimeTimers(user.name);
    log(run, enemy.name + ' 격파');
    const seq = run.sequence;
    if (seq && seq.remaining > 1) { startCombat(user, seq.kind, { ...seq, remaining: seq.remaining - 1 }, random); return; }
    if (seq) {
        switch (seq.reward) {
            case 'moonDuel':
                run.contracts.push({ star: 10, type: '일반', cardId: 1, name: 'Z 일반 뭔마 카드' });
                grantRelic(user, 'moonSeal', random);
                run.rewardReveal = { motif: 'contract', positive: true, text: '월야섬 격파\nZ 일반 뭔마 카드 계약, 월야의 인장 획득' };
                break;
            case 'casino': grantRelic(user, null, random); break;
            case 'mirror': addEffect(user, { atk: .20 }); run.contracts.push({ bonus: .30, name: '거울 격파, 종료 보상 +30%' }); break;
            case 'judge:three': addEffect(user, { atk: .15 }); break;
            case 'judge:elite': addEffect(user, { atk: .25 }); break;
            case 'judge:boss':
            case 'rift':
                if (seq.reward === 'rift') grantRelic(user, 'abyssDiadem', random);
                grantRelic(user, seq.reward === 'rift' ? 'riftHeart' : 'judgment', random);
                run.contracts.push({ star: seq.reward === 'rift' ? 9 : 8, type: '전직', name: seq.reward === 'rift' ? '9성 전직 카드' : '8성 전직 카드' });
                break;
            case 'well': addEffect(user, { hp: .10 }); break;
        }
    }
    if (routeMechanics.eventComplete(user, random)) return;
    recordFloor(user);
    run.clearedFloor = Math.max(run.clearedFloor, run.floor);
    run.augmentFromElite = elite;
    if (enemy.kind === 'final') {
        run.completed = true; setPhase(user, 'augment'); run.choices = []; run.event = null;
        log(run, '999층 정복, 귀환하여 보상을 정산해주세요.');
        return;
    }
    if (offerRelics(user, random)) return;
    if (run.distortion >= 100 && !run.augmentCategory) { setPhase(user, 'event'); run.event = { id: 'collapse' }; }
    else offerAugments(user, random);
}
function canReturn(user) {
    const run = user.paradise;
    return !!run && run.mode !== 'hell' && (run.status === 'active' && run.phase === 'augment'
        || run.status === 'ended' && run.outcome === 'cleared' && !run.claimed && !run.returnedAt);
}
function rewardEligible(run) {
    return run.outcome === 'retired' || ['cleared', 'timedOut'].includes(run.outcome) && !!run.returnedAt
        || run.outcome === 'defeated' && progression.has(run, 'deathInsurance');
}
function finish(user, outcome = 'retired') {
    if (user.paradise.mode === 'hell') {
        require('./paradise_hell').finish(user, outcome);
        return { message: '지옥에서 귀환했습니다.' };
    }
    const run = user.paradise;
    if (outcome === 'timedOut') {
        if (!isTimedOut(user)) return { error: '아직 탐험 시간이 남아 있습니다.' };
        run.returnedAt = Date.now();
    } else if (outcome !== 'defeated') {
        if (!canReturn(user)) return { error: '귀환은 증강 선택 단계에서만 가능합니다.' };
        run.returnedAt = Date.now();
        outcome = run.completed || run.outcome === 'cleared' ? 'cleared' : 'retired';
    }
    if (outcome !== 'defeated') recordFloor(user);
    delete run.routeEncounter; delete run.augmentCategory;
    rpg().clearFieldRuntimeTimers(user.name);
    setPhase(user, 'ended'); run.status = 'ended'; run.outcome = outcome; run.endedAt = Date.now(); run.event = null; run.choices = [];
    for (const quest of run.quests || []) if (quest.status === 'active') quest.status = 'failed';
    run.rewardBonus = endingRewardBonus(run);
    user.field = null;
    log(run, outcome === 'cleared' ? '999층 완주, 천상의 끝' : outcome === 'defeated' ? '탐험 종료, 전투 불능' : outcome === 'timedOut' ? '제한 시간 종료, 자동 귀환' : '귀환, 종료 보상 정산');
    return { message: outcome === 'defeated' ? progression.has(run, 'deathInsurance') ? '마지막 은총으로 천상의 증표 50%를 수령할 수 있습니다. 다른 보상과 계약은 잃었습니다.' : '전투에서 패배하여 탐험 보상과 계약 보상을 잃었습니다.' : '천상에서 귀환했습니다. 종료 보상을 수령해주세요.' };
}
function endingRewardBonus(run) {
    return Number(sumEffects(run).reward || 0) + Number(run.ring || 0) + (has(run, 'judgment') ? .5 : 0) + (has(run, 'riftHeart') ? 1 : 0) + (has(run, 'necklace') ? .30 : 0) + run.contracts.reduce((sum, c) => sum + Number(c.bonus || 0), 0);
}
function previewRewards(run) {
    if (run.status === 'ended' && !rewardEligible(run)) return [];
    const multiplier = 1 + Math.max(0, Number(run.rewardBonus ?? endingRewardBonus(run)));
    const rewards = (run.baseRewards || []).map(reward => ({ ...reward, count: Math.floor(Math.floor(run.clearedFloor / reward.perFloors) * reward.count * multiplier) })).filter(reward => reward.count > 0);
    const milestone = (run.milestoneRewards || []).filter(r => r.floor <= Number(run.highestFloor ?? run.clearedFloor ?? 0)).at(-1);
    if (milestone) rewards.push({ type: '아이템', name: milestone.name, count: Math.floor(milestone.count * multiplier), floor: milestone.floor });
    for (const reward of rewards) if (reward.name === progression.TOKEN && progression.has(run, 'tokenBounty')) reward.count = Math.floor(reward.count * 1.20);
    return run.outcome === 'defeated' ? rewards.filter(reward => reward.type === '아이템' && reward.name === progression.TOKEN).map(reward => ({ ...reward, count: Math.floor(reward.count * .50) })).filter(reward => reward.count > 0) : rewards;
}

function powerWarning(user, floors, enemyKind = 'normal', conditional = false, playerPower = rpg().calculateCombatPower(user).total) {
    const floor = clamp(user.paradise.floor + progression.movement(user.paradise, floors), 1, MAX_FLOOR);
    const kind = floor === MAX_FLOOR && enemyKind === 'normal' ? 'final' : enemyKind;
    const power = Math.round(recommendedPower(floor) * ({ elite: 1.2, judge: 3.5, rift: 4, moonDuel: 1.8 }[kind] || 1));
    return power * 10 >= playerPower * 11 ? { floor, recommendedPower: power, playerPower, conditional, enemyKind: kind } : null;
}
function routePowerWarning(user, route, playerPower) {
    if (route.kind === 'event') return false;
    if (!route.gimmick) return !!powerWarning(user, 0, route.kind, false, playerPower);
    const stats = heavenMonsterStats(user.paradise.floor, route.kind);
    routeMechanics.scaleEnemy(stats, route.gimmick);
    return rpg().computeCombatPowerFromStats(stats).total * 10 >= playerPower * 11;
}
function eventPowerWarning(user, id, playerPower) {
    const event = user.paradise.event?.id;
    if (event === 'casino' && ['safe', 'risk'].includes(id)) return powerWarning(user, id === 'safe' ? 10 : 50, 'normal', true, playerPower);
    if (event === 'collapse' && id === 'rift') return powerWarning(user, 50, 'rift', false, playerPower);
    if (event === 'puzzle' && id === 'solve') return powerWarning(user, 10, 'normal', true, playerPower);
    if (id === 'skip') return powerWarning(user, 5, 'normal', false, playerPower);
    return null;
}
function claim(user) {
    const run = user.paradise;
    if (run?.mode === 'hell') return run.claimed ? { message: '이미 수령한 보상입니다.' } : { error: '지옥 보상 상자를 직접 선택해주세요.' };
    if (!run || run.status !== 'ended') return { error: '탐험을 종료한 후 수령할 수 있습니다.' };
    if (run.claimed) return { message: '이미 수령한 보상입니다.' };
    if (!rewardEligible(run)) return { error: run.outcome === 'defeated' ? '전투에서 패배하면 탐험 보상과 계약 보상을 받을 수 없습니다.' : '귀환한 후 보상을 수령해주세요.' };
    const rewards = previewRewards(run), items = rpg().getDataCache('Item', []);
    if (rewards.some(reward => reward.type === '아이템' && !items.some(i => i?.name === reward.name))) return { error: '종료 보상 아이템이 운영 DB에 없습니다. 운영자에게 설정 확인을 요청해주세요. 계약과 보상은 보존됩니다.' };
    const contracts = run.outcome === 'defeated' ? [] : run.contracts.filter(c => c.star);
    if (user.inventory.card.length + contracts.length > Number(user.maxCardLimit || 52)) return { error: `계약 카드 ${contracts.length}장을 받을 카드 보관함 공간이 필요합니다. 정리 후 다시 수령해주세요.` };
    const cards = contracts.map(c => rpg().buildCharacterCardReward({ card_type: c.type, display_star: c.star, card_id: c.cardId }));
    if (cards.some(c => !c)) return { error: '계약 카드 보상 데이터를 찾을 수 없습니다. 계약은 보존됩니다.' };
    for (const reward of rewards) {
        if (reward.type === '골드') user.gold = Number(user.gold || 0) + reward.count;
        else if (reward.type === '경험치') rpg().addExperience(user, reward.count);
        else rpg().grantItemReward(user, items.findIndex(i => i?.name === reward.name), reward.count);
    }
    user.inventory.card.push(...cards);
    run.claimed = true; run.claimedAt = Date.now(); run.rewards = { rewards, cards };
    delete run.timeoutClaimError;
    return { message: '종료 보상을 수령했습니다.', reveal: { kind: 'rewards', title: '회랑 보상', items: claimedRewards(run) } };
}
function claimedRewards(run) {
    if (!run.claimed || !run.rewards) return [];
    const items = rpg().getDataCache('Item', []);
    return [
        ...run.rewards.rewards.map(reward => ({ kind: reward.type === '아이템' ? 'item' : reward.type === '골드' ? 'gold' : 'experience',
            id: reward.type === '아이템' ? items.findIndex(item => item?.name === reward.name) : null, name: reward.name || reward.type, count: reward.count })),
        ...run.rewards.cards.map(card => ({ kind: 'card', card, name: rpg().formatUserCard(card), count: 1 }))
    ];
}
function dismiss(user) {
    const run = user.paradise;
    if (!run || run.status !== 'ended' || run.mode === 'hell' && !run.claimed || run.mode !== 'hell' && !run.claimed && (rewardEligible(run) || canReturn(user))) return { error: '탐험을 마치고 남은 보상을 수령해주세요.' };
    run.dismissedAt ||= Date.now();
    return { message: '낙원으로 돌아왔습니다.' };
}
function view(user, stats = rpg().calculateUserStats(user), slotEffects) {
    const resources = getResources(user);
    const run = user.paradise, config = rpg().getDataCache('Paradise', null);
    const playerPower = rpg().calculateCombatPower(user, stats, slotEffects).total;
    const ticketId = rpg().getDataCache('Item', []).findIndex(i => i?.name === TICKET);
    const result = { serverTime: Date.now(), weekly: weeklyInfo(user), enabled: !validateConfig(config) && config.enabled, ticket: { name: TICKET, count: ticketId < 0 ? 0 : rpg().getInventoryItemCount(user, ticketId), iconUrl: '/rpg-ui?file=%EB%82%99%EC%9B%90%2Fticket.webp' }, revision: Number(run?.revision || 0), runId: run?.id || null,
        player: { name: user.name, hp: Number(resources.hp ?? stats.hp), maxHp: stats.hp, mp: Number(resources.mp ?? stats.mp), maxMp: stats.mp, atk: stats.atk, def: stats.def, combatPower: playerPower },
        progression: progression.view(user), weeklyRewards: config?.weeklyRewards || { participation: [], ranks: [] },
        baseRewards: config?.baseRewards || [], entryBlocked: Number(user.level || 1) < MIN_LEVEL ? '낙원은 ' + MIN_LEVEL + '레벨부터 입장할 수 있습니다.' : user.field && !user.field.paradise ? '다른 전투를 먼저 마쳐주세요.' : null, run: null };
    if (!run || run.dismissedAt) return require('./paradise_hell').decorateView(result, user);
    const { mirror, ...enemy } = run.enemy || {};
    if (mirror) {
        enemy.shieldLayers = require('./combat_shields').active(mirror, Date.now()).map(({ amount, expiresAt }) => ({ amount, expiresAt }));
        enemy.shield = enemy.shieldLayers.reduce((sum, layer) => sum + layer.amount, 0);
    } else if (run.enemy?.shieldLayers) {
        enemy.shieldLayers = require('./combat_shields').active(run.enemy, Date.now()).map(({ amount, expiresAt }) => ({ amount, expiresAt }));
        enemy.shield = enemy.shieldLayers.reduce((sum, layer) => sum + layer.amount, 0);
    }
    result.run = { id: run.id, status: run.status, phase: run.phase, completed: !!run.completed, canReturn: canReturn(user), canClaim: run.status === 'ended' && !run.claimed && rewardEligible(run), floor: run.floor, clearedFloor: run.clearedFloor, distortion: run.distortion, outcome: run.outcome || null, claimed: !!run.claimed, battlesWon: run.battlesWon, elitesWon: run.elitesWon, enemy: run.phase === 'combat' ? enemy : null,
        choices: run.phase === 'augment' ? run.choices.filter(id => !obtainedAugment(run, id)).map(id => AUGMENTS.find(a => a.id === id)).filter(Boolean).map(({ id, name, desc, floors, rarity, category, equipment, character, characterName, dangerous }) => ({ id, name, desc, floors, rarity, category, equipment, character, characterName, dangerous: !!dangerous })) : [],
        routes: run.phase === 'route' ? (run.routes || []).map(route => ({ ...route, gimmick: routeMechanics.describe(route.gimmick), title: { normal: '일반 전투', elite: '엘리트 전투', event: '알 수 없는 방' }[route.kind], description: { normal: '몬스터가 길을 지키고 있습니다.', elite: '강한 적에게 도전합니다.', event: '문 너머의 운명을 마주합니다.' }[route.kind], powerWarning: routePowerWarning(user, route, playerPower) })) : [],
        routeGimmick: routeMechanics.view(user),
        relicChoices: run.phase === 'relic' ? (run.relicChoices || []).map(id => RELICS.find(relic => relic.id === id)).filter(Boolean) : [], relicPicksRemaining: Number(run.relicPicksRemaining || 0),
        event: run.event ? { id: run.event.id, ...EVENTS[run.event.id], equipment: run.event.equipment || null, choices: run.phase === 'event' ? eventChoices(user) : [], ...(run.phase === 'puzzle' ? { puzzle: run.event.puzzle.publicPuzzle, deadline: run.event.deadline } : {}) } : null,
        relics: run.relics.map(id => ({ ...RELICS.find(r => r.id === id), spent: id === 'feather' && !!run.featherUsed })), effects: Object.entries(run.acquired).filter(([id]) => AUGMENTS.some(a => a.id === id)).map(([id, count]) => ({ ...AUGMENTS.find(a => a.id === id), count })), permanentEffects: sumEffects(run), temporary: run.temporary.filter(buff => !buff.equipment || EQUIPMENT_AUGMENTS.get(buff.equipment)?.id !== buff.id).map(({ name, battles }) => ({ name, battles })), equipmentPermanent: run.equipmentPermanent,
        contracts: run.contracts, quests: (run.quests || []).map(q => ({ name: q.name, remaining: q.remaining, progress: q.progress, target: q.target || q.battles, status: q.status })), history: run.history.slice(0, 20), lastOutcome: run.lastOutcome || null, rewards: previewRewards(run), rewardBonus: run.rewardBonus || 0, nextActionAt: Number(user.field?.nextActionAt || 0),
        rewardSummary: run.mode === 'hell' ? [] : claimedRewards(run),
        offerId: run.offerId || null, timer: run.mode === 'hell' ? null : { remainingMs: remainingTime(run), paused: timerPaused(run) }, timeoutClaimError: run.timeoutClaimError || null,
        skills: rpg().getMainCardSkills(user).map(({ skill }) => ({ name: skill.name, cost: skill.mp_cost, cooldownEnd: Number(user.field?.skillCooldowns?.[skill.name] || 0) })) };
    if (result.run) {
        if (run.phase === 'augment' && !run.completed && !result.run.choices.length) result.run.continueWarning = powerWarning(user, 5, 'normal', false, playerPower);
        result.run.highestFloor = Number(run.highestFloor ?? run.clearedFloor ?? 0);
        const canReroll = result.run.choices.length > 0 && !run.completed && rerollPool(user).length > 0;
        result.run.startingAugment = !!run.startingAugments?.length;
        for (const choice of result.run.choices) {
            choice.starting = result.run.startingAugment;
            choice.canReroll = canReroll && !run.rerolled?.[run.choices.indexOf(choice.id)];
            choice.powerWarning = result.run.startingAugment ? null : powerWarning(user, choice.floors, choice.id === 'rewind' || AUGMENTS.find(a => a.id === choice.id)?.acquire?.forceElite || AUGMENTS.find(a => a.id === choice.id)?.quest?.forceElite || run.forceElite ? 'elite' : 'normal', false, playerPower);
            choice.floors = result.run.startingAugment ? 0 : progression.movement(run, choice.floors);
        }
        for (const choice of result.run.event?.choices || []) choice.powerWarning = eventPowerWarning(user, choice.id, playerPower);
    }
    return require('./paradise_hell').decorateView(result, user);
}
module.exports = { TICKET, MAX_FLOOR, MIN_LEVEL, TIME_LIMIT_MS, CP_ANCHORS, AUGMENTS, RELICS, EVENTS, active, getResources, validateConfig, recommendedPower, equipmentOptions, equipmentMultiplier, applyStats, sumEffects, enter, chooseAugment, rerollAugment, normalizeAugmentOffer, chooseEvent, answerPuzzle, startCombat, rebalanceEnemy, nextEncounter, offerRoutes, chooseRoute, offerRelics, chooseRelic, offerAugments, availableAugments, continueExploration, grantRelic, addEffect, move, heal, onSkillUsed, cooldownMultiplier, prepareAttack, modifyHit, attackMultiplier, afterAttack, incomingMultiplier, onDamageTaken, survive, victory, finish, claim, dismiss, view, weeklyInfo, recordFloor, buildWeeklyRanking, remainingTime, isTimedOut, advanceTime };
