'use strict';
// 천상 증강(2026-11 개편) 30종의 전투 동작. 설명은 paradise_augments_prism.js, 연출 신호는 docs/paradise-augment-fx.md.
// 상태는 세 단계로 나눈다: 탐험(run.prism), 2마리 연속 전투 한 번(run.prismEncounter), 적 한 마리(run.battle.prism).
// 연출 신호(augment:*)는 run.prismCues에 모았다가 다음에 만들어지는 전투 사건에 붙인다.
const catalog = require('./paradise_augments_prism');
const shields = require('./combat_shields');
const attackStats = require('./attack_stats');
const combatEffects = require('./public/combat-effects');
const rpg = () => require('./rpgenius');
const corridor = () => require('./paradise');
const mechanics = () => require('./paradise_mechanics');

const SEASONS = ['spring', 'summer', 'autumn', 'winter'];
const SEASON_NAMES = { spring: '봄', summer: '여름', autumn: '가을', winter: '겨울' };
const SKILLS = [
    { id: 'fatalDestiny', name: '운명', cooldown: 0, mp: 0 },
    { id: 'soulReaper', name: '명계의 부름', cooldown: 0, mp: 0 },
    { id: 'swordDance', name: '검무', cooldown: 45000, mp: 390, kinoRatio: .15 },
    { id: 'replay', name: '리플레이', cooldown: 30000, mp: 0, replay: true },
    { id: 'manualShift', name: '변속', cooldown: 0, mp: 0, utility: true },
    { id: 'readIntent', name: '간파', cooldown: 0, mp: 0, utility: true }
].map(skill => ({ ...skill, prism: true, ratio: 0 }));
// 소환수와 지속 피해의 틱 이름 → 연출 신호
const TICK_CUES = { '정복자의 기병': 'conqueror.cavalry', '꺼지지 않는 불꽃': 'eternalFlame', '떠다니는 검': 'flyingSword', '여름의 열기': 'seasons.burn', '천사': 'angelDescent', '고통스러운 상처': 'painfulWound', '행동성 출혈': 'deepeningBleed' };

const enabled = user => user?.paradise?.status === 'active' && user.paradise.mode !== 'hell';
const owned = user => enabled(user) && catalog.some(a => user.paradise.acquired?.[a.id]);
const combat = user => owned(user) && user.paradise.phase === 'combat' && !!user.field?.paradise && !!user.paradise.battle;
const has = (user, id) => enabled(user) && !!user.paradise.acquired?.[id];
const expedition = user => user.paradise.prism ||= {};
const battle = user => user.paradise.battle.prism ||= {};
function encounter(user) {
    const run = user.paradise;
    if (!run.prismEncounter || run.prismEncounter.id !== run.encounterId) run.prismEncounter = { id: run.encounterId || null };
    return run.prismEncounter;
}
// 증강 문구의 공격 분류(사용자 지시 2026-11-18):
//   공격      = 지속 피해를 뺀 모든 공격. 직접 공격과 소환수(정복자의 기병, 떠다니는 검, 천사, 익테봇 같은 카드 소환수)의 공격.
//   직접 공격 = 내가 행동해서 한 공격. 일반 공격, 스킬(증강 스킬과 빌린 스킬 포함), 검무의 한 타 한 타.
//   일반 공격 = 일반 공격과 검무의 한 타 한 타.
// 내 행동을 말하는 문구('공격하지 않으면', '두 번 공격할 수 있습니다', 변속과 결투의 '다음 공격')는 직접 공격으로 센다.
const direct = extra => !extra.dotAttack && !extra.summonAttack && !extra.isBotAutoAttack;
const summonAttack = extra => !!extra.paradiseSummon || (!!extra.summonAttack && !extra.dotAttack && !extra.paradiseDot);
const anyAttack = extra => direct(extra) || summonAttack(extra);
const isDot = extra => extra.paradiseDot === true;
const isUltimate = (user, name) => !!name && rpg().getUltimateSkills(user).some(entry => entry.skill.name === name);
const count = (object, key, n = 1) => (object[key] = Number(object[key] || 0) + n);
const resources = user => corridor().getResources(user);
const statsOf = user => rpg().calculateUserStats(user);
const dotScale = stats => 1 + Number(stats.dotDamage || 0);
const fmt = n => Math.round(Number(n || 0)).toLocaleString('ko-KR');

function cue(user, id) {
    const run = user.paradise, list = run.prismCues ||= [], value = 'augment:' + id;
    if (!list.includes(value)) list.push(value);
}
function drainCues(user) {
    const run = user?.paradise;
    if (!run?.prismCues?.length) return [];
    const list = run.prismCues; run.prismCues = [];
    return list;
}
function log(user, text) { const run = user.paradise; run.history.unshift({ floor: run.floor, text }); run.history.length = Math.min(60, run.history.length); }
function pushEvent(user, partial) {
    const run = user.paradise;
    run.combatSequence = Number(run.combatSequence || 0) + 1;
    const event = combatEffects.annotateEvent({ id: run.id + ':' + run.combatSequence, at: Date.now(), enemyId: run.enemy?.id || null, hits: [], receivedHits: [], damage: 0, received: 0, targetHp: run.enemy?.hp, ...partial });
    run.combatEvents = [...(run.combatEvents || []), event].slice(-12);
    return event;
}
function shield(user, id, amount, seconds) {
    if (amount <= 0 || statsOf(user).disableShield) return;
    shields.grant(user.field, { source: 'paradise:' + id, caster: user.name, amount: Math.round(amount), expiresAt: Date.now() + seconds * 1000 });
}
function enemyShield(user) {
    const enemy = user.paradise.enemy;
    if (!enemy) return 0;
    return shields.summary(enemy.mirror || enemy, Date.now()).amount;
}
function enemyTarget(user) {
    const enemy = user.paradise.enemy;
    return enemy.mirror ? Object.assign({}, enemy, require('./pvp').getCorridorMirrorStats(enemy.mirror)) : enemy;
}
// 증강이 따로 내리치는 피해. 방어력을 거치고 치명타는 없다. 죽을 각오로가 켜져 있으면 방어력을 무시한다.
function strike(user, stats, raw, element) {
    if (!user.paradise.enemy || raw <= 0) return 0;
    const target = enemyTarget(user), b = battle(user);
    const ignore = desperate(user, stats) ? 1 : Number(b.shred || 0);
    const result = rpg().calculateAttackHitResult(raw, Math.max(0, Number(target.def || 0) - Number(stats.atkDefReduce || 0)), Number(stats.pnt || 0), stats, rpg().calculateCardSlotEffects(user),
        { hitCount: 1, disableCritical: true, disableEquipmentBonusDamage: true, attackElement: element || null, defReductionBonus: ignore }, rpg().getCombatStats(target));
    return Math.max(0, Math.round(result.finalDamage));
}
// 최대 HP 비례 피해를 일반 피해로 줄 때. 방어력만 거치고 공격력 배율과 치명타는 없다(죽을 각오로와 갑옷 깎아내기는 strike와 같다).
function mitigated(user, stats, amount) {
    if (!user.paradise.enemy || amount <= 0) return 0;
    const target = enemyTarget(user), ignore = desperate(user, stats) ? 1 : Number(battle(user).shred || 0);
    const rate = Math.min(1, rpg().getTotalDefenseReductionRate(stats, rpg().calculateCardSlotEffects(user)) + ignore);
    return Math.max(0, Math.round(rpg().getDamageAfterReducedDefense(amount, Math.max(0, Number(target.def || 0) - Number(stats.atkDefReduce || 0)), Number(stats.pnt || 0), rate)));
}
function add(hit, amount, label, fixed = false) {
    amount = Math.max(0, Math.round(amount));
    if (!amount) return 0;
    hit.finalDamage += amount;
    (hit.hitDetails ||= []).push({ damage: amount, fixedDamage: fixed ? amount : 0, isCritical: false, label });
    return amount;
}
function desperate(user, stats) { return has(user, 'deathWish') && Number(resources(user).hp) < Number(stats.hp) * .20; }
// 소환수 공격은 지속 피해가 아니다(취약의 치명타 대상이 아님). 피해는 틱마다 현재 공격력과 대상으로 계산한다.
function summon(user, key, label, kind, ticks, interval, element = null) {
    mechanics().addDot(user, key, label, 1, ticks, interval, true, { summon: true, prism: kind, element });
}
function tickDamage(user, dot) {
    if (!combat(user) || !user.paradise.enemy) return 0;
    const stats = statsOf(user), enemy = user.paradise.enemy;
    if (dot.prism === 'cavalry') return strike(user, stats, stats.atk * 1.2, null);
    if (dot.prism === 'sword') return strike(user, stats, stats.atk * .7, null);
    if (dot.prism === 'angel') return strike(user, stats, stats.atk * 6, '명') + Math.round(Number(enemy.maxHp || 0) * .07);
    return Number(dot.damage || 0);
}
function hpSample(user, at, hp) {
    const b = battle(user), list = b.hpLog ||= [];
    if (!list.length || list.at(-1)[1] !== hp) list.push([at, hp]);
    while (list.length > 2 && list[1][0] <= at - 6000) list.shift();
    if (list.length > 40) list.splice(0, list.length - 40);
}

// ---- 능력치 ----
function applyStats(user, stats) {
    if (!owned(user)) return;
    const run = user.paradise;
    if (has(user, 'fruition')) stats.critMul = Number(stats.critMul || 0) + 1;
    if (has(user, 'fatalDestiny')) {
        stats.critMul = Number(stats.critMul || 0) + 3;
        const capped = Math.min(.20, Math.max(0, Number(stats.fixedCriticalChance ?? stats.crit ?? 0)));
        stats.crit = stats.fixedCriticalChance = capped;
    }
    if (has(user, 'thornArmor')) stats.def = Math.round(Number(stats.def || 0) * 1.2);
    if (has(user, 'conqueror') && run.phase === 'combat' && run.battle) {
        const stacks = Number(encounter(user).conqueror || 0);
        if (stacks) {
            stats.finalDamage = Number(stats.finalDamage || 0) + .02 * stacks;
            attackStats.addPercent(stats, 0, 20 * stacks / (1 + Number(stats.plusStats?.atk || 0)));
        }
    }
    if (has(user, 'seasons') && expedition(user).season === 'autumn') stats.mpReduce = Math.max(-1, Number(stats.mpReduce || 0) - .30);
    if (desperate(user, stats)) stats.takenDamage = Number(stats.takenDamage || 0) + 1;
}
function cooldownMultiplier(user) { return has(user, 'seasons') && expedition(user).season === 'autumn' ? .70 : 1; }
function enemyIntervalBonus(user) { return combat(user) && has(user, 'seasons') && expedition(user).season === 'winter' ? 1000 : 0; }
function actionReduction(user) { return combat(user) && has(user, 'haste') ? 500 : 0; }
// 결투 신청: 반격을 받은 뒤 10초 동안 나와 적의 행동 쿨타임이 절반이다(시각마다 따진다).
function duelHaste(user, at = Date.now()) { return combat(user) && battle(user).duel === 'haste' && at < Number(battle(user).duelUntil || 0); }
function actionMultiplier(user, at = Date.now()) { return duelHaste(user, at) ? .5 : 1; }
function enemyIntervalMultiplier(user, at = Date.now()) { return duelHaste(user, at) ? .5 : 1; }

// ---- 획득과 전투 시작 ----
function onAcquire(user, choice, random = Math.random) {
    const e = expedition(user);
    if (choice.id === 'seasons') e.season = 'spring';
    if (choice.id === 'dualIdentity') {
        const cards = require('./DB/RPGenius/CharacterCards.json'), skills = require('./DB/RPGenius/Skills.json');
        const pool = cards.map((card, id) => ({ card, id })).filter(({ card, id }) => card && id !== Number(user.main_card?.id) && (card.skills || []).some(i => skills[i]));
        const chosen = pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))];
        if (!chosen) return '';
        e.identity = { id: chosen.id, star: user.main_card?.star || 1, type: '일반' };
        e.identityName = chosen.card.name;
        const names = chosen.card.skills.map(i => skills[i]?.name).filter(Boolean);
        return chosen.card.name + '의 스킬\n' + names.join(', ');
    }
    return '';
}
// 적 한 마리가 나올 때마다 부른다. linked는 2마리 전투의 두 번째 적: 전투 기록은 이어지고, 적에게 붙어 있던 상태만 새 적에서 다시 시작한다.
const TARGET_STATE = ['fate', 'flowers', 'lastForm', 'shred', 'woundCrits', 'marked', 'bleedLeft', 'bleedDamage', 'foresight', 'intentCount', 'parry'];
function onBattle(user, linked = false) {
    if (!combat(user)) return;
    const run = user.paradise, b = battle(user), e = expedition(user), enc = encounter(user), now = Date.now(), stats = statsOf(user);
    if (linked) for (const key of TARGET_STATE) delete b[key];
    else {
        b.hpLog = [[now, Number(resources(user).hp)]];
        b.lastAttackAt = now;
        if (has(user, 'duelChallenge')) b.duel = 'ready';
    }
    if (has(user, 'dualIdentity') && e.identity && !run.battle.hackCard) run.battle.hackCard = { ...e.identity };
    const cues = [];
    if (has(user, 'eternalFlame')) {
        mechanics().addDot(user, 'prism:flame', '꺼지지 않는 불꽃', stats.atk * .25 * dotScale(stats), 9999, 2000, false, { element: '화' });
        cues.push('augment:eternalFlame.ignite');
    }
    if (!linked && has(user, 'conqueror') && Number(enc.conqueror || 0) >= 10) summon(user, 'prism:cavalry', '정복자의 기병', 'cavalry', 9999, 3000);
    if (!linked && Number(e.angelUntil || 0) > now) summon(user, 'prism:angel', '천사', 'angel', Math.max(1, Math.ceil((e.angelUntil - now) / 2000)), 2000, '명');
    if (cues.length) pushEvent(user, { action: 'augment', actor: 'player', effectTarget: 'target', triggeredEffectIds: cues });
}

// ---- 공격 ----
function prepareAttack(user, stats, extra) {
    if (!combat(user)) return;
    const b = battle(user), e = expedition(user), now = Date.now();
    if (desperate(user, stats)) { extra.defReductionBonus = 1; extra.prismFixed = true; }
    const own = direct(extra);
    if (!own) {
        const tick = TICK_CUES[extra.skillName];
        if (tick) cue(user, tick);
        if (!summonAttack(extra)) return;
    }
    const kind = own ? extra.isBasic ? 'basic' : 'skill' : 'summon';
    extra.prismKind = kind;
    if (own) hpSample(user, now, Number(resources(user).hp));
    // 치명타: 확정 치명타(변속, 결투, 결실의 세 번째)가 자연 치명타 봉인보다 앞선다.
    let forced = !!extra.forceCritical;
    if (own && has(user, 'manualShift') && e.armed) { e.armed = false; forced = true; cue(user, 'manualShift.crit'); }
    // '3번째 공격마다'(결실, 신성한 번개)는 소환수의 공격도 센다.
    if (has(user, 'fruition') && count(e, 'fruition') % 3 === 0) { forced = true; cue(user, 'fruition'); }
    if (forced) { extra.forceCritical = true; delete extra.disableCritical; delete stats.fixedCriticalChance; }
    else if (has(user, 'fruition') || has(user, 'manualShift')) { extra.disableCritical = true; stats.ilionForceCritical = false; }
    if (has(user, 'armorShred') && b.shred) extra.defReductionBonus = Math.min(1, Number(extra.defReductionBonus || 0) + b.shred);
    if (has(user, 'holyLightning') && count(e, 'lightning') % 3 === 0) extra.prismLightning = true;
    if (!own) return;
    if (has(user, 'demonHunter') && count(e, 'demon') % 3 === 0) extra.prismDemon = true;
    if (has(user, 'timeOfChoice') && b.marked) { b.marked = false; if (kind === 'basic') extra.prismMarkHeal = true; else extra.prismMarkBurst = true; }
    if (kind === 'basic') {
        if (has(user, 'onePunch')) cue(user, 'onePunch');
        if (has(user, 'flyingSword') && now - Number(b.lastAttackAt || 0) >= 4000) extra.prismSwords = true;
        if (has(user, 'deepeningBleed') && !b.bleedApplied) extra.prismBleed = true;
        if (has(user, 'comboStaircase') && !extra.hitCount && Number(extra.comboHitCount || 1) >= 3) cue(user, 'comboStaircase.3');
    }
    // 결투 신청: 매 전투 첫 일반 스킬(궁극기가 아닌 스킬)이 적에게 피해를 입히면 적이 즉시 반격한다. 피해를 입혔는지는 afterHit에서 확정한다.
    if (kind === 'skill' && b.duel === 'ready' && !isUltimate(user, extra.skillName)) extra.prismDuel = true;
    if (has(user, 'hundredFlowers')) {
        const form = kind === 'basic' ? 'basic' : 'skill:' + (extra.skillName || '');
        extra.prismFlowers = b.lastForm && b.lastForm !== form ? 2 : 1;
        b.lastForm = form;
    }
    b.lastAttackAt = now;
}
function attackMultiplier(user, extra) {
    return combat(user) && direct(extra) && extra.isBasic && has(user, 'onePunch') ? 2 : 1;
}
function modifyHit(user, stats, extra, hit) {
    if (!combat(user)) return;
    const run = user.paradise, enemy = run.enemy, b = battle(user);
    if (isDot(extra) && has(user, 'dotCritical') && hit.criticalCount > 0) cue(user, 'dotCritical');
    // 소환수의 피해는 미리 계산되어 엔진의 치명타 판정을 거치지 않는다. 결실의 확정 치명타는 여기서 같은 공식으로 씌운다.
    if (summonAttack(extra) && extra.forceCritical && !hit.criticalCount && hit.finalDamage > 0) {
        const crit = rpg().applyCriticalDamage(hit.finalDamage, stats, { forceCritical: true }, rpg().getCombatStats(enemyTarget(user)));
        const gain = Math.max(0, Math.round(crit.damage - hit.finalDamage));
        if (crit.isCritical) {
            hit.finalDamage += gain; hit.criticalCount = 1;
            const detail = (hit.hitDetails ||= [{ damage: 0, isCritical: false }])[0];
            detail.damage = Number(detail.damage || 0) + gain; detail.isCritical = true;
        }
    }
    if (extra.prismLightning) { add(hit, strike(user, stats, stats.atk * 2, '명'), '신성한 번개'); cue(user, 'holyLightning'); }
    if (direct(extra)) {
        if (extra.prismDemon) { add(hit, Number(enemy.maxHp || 0) * .06, '악마 사냥꾼', true); cue(user, 'demonHunter'); }
        if (extra.prismMarkBurst) { add(hit, mitigated(user, stats, Number(enemy.maxHp || 0) * .10), '표식 폭발'); cue(user, 'timeOfChoice.burst'); }
        if (extra.prismSkill && extra.skillName === '운명' && hit.criticalCount > 0) {
            add(hit, Number(extra.paradiseEnemyHpBefore ?? enemy.hp) + enemyShield(user), '처형', true);
            cue(user, 'fatalDestiny.execute'); log(user, '치명적인 운명, 처형');
        }
        if (has(user, 'shieldSiphon') && hit.finalDamage > 0 && enemyShield(user) > 0) {
            const bonus = add(hit, hit.finalDamage * .10, '흡수의 일격');
            shield(user, 'shieldSiphon', bonus * .50, 10); cue(user, 'shieldSiphon');
        }
        if (extra.prismFlowers) {
            b.flowers = Number(b.flowers || 0) + extra.prismFlowers;
            if (b.flowers >= 6) {
                const flowers = b.flowers; b.flowers = 0;
                const damage = add(hit, strike(user, stats, stats.atk * 1.2 * flowers, null), '백화요란');
                if (damage > 0) corridor().heal(user, damage * .10 / Math.max(1, stats.hp));
                cue(user, 'hundredFlowers.bloom');
            }
        }
    }
    if (extra.prismFixed) for (const detail of hit.hitDetails || []) detail.fixedDamage = detail.damage;
}
function afterHit(user, stats, extra, hit) {
    if (!combat(user)) return;
    const run = user.paradise, b = battle(user), e = expedition(user), enc = encounter(user), now = Date.now();
    if (extra.paradiseSummon && extra.skillName === '천사' && hit.finalDamage > 0) corridor().heal(user, hit.finalDamage * .05 / Math.max(1, stats.hp));
    if (!anyAttack(extra)) return;
    const landed = hit.finalDamage > 0 || Number(extra.enemyShieldAbsorbed || 0) > 0, crits = Number(hit.criticalCount || 0), alive = run.enemy.hp > 0;
    // '공격할 때마다'(정복자), '치명타가 적중할 때마다'(치명적인 운명), 여름의 '공격하면'은 소환수의 공격도 센다.
    if (has(user, 'conqueror') && Number(enc.conqueror || 0) < 10) {
        enc.conqueror = Number(enc.conqueror || 0) + 1;
        if (enc.conqueror >= 10) { cue(user, 'conqueror.max'); log(user, '정복자, 기병 소환'); if (alive) summon(user, 'prism:cavalry', '정복자의 기병', 'cavalry', 9999, 3000); }
    }
    if (has(user, 'fatalDestiny') && crits) b.fate = Math.min(99, Number(b.fate || 0) + crits);
    if (has(user, 'seasons') && e.season === 'summer' && landed && alive) mechanics().addDot(user, 'prism:summer', '여름의 열기', stats.atk * .50 * dotScale(stats), 3, 2000, false, { element: '화' });
    if (!direct(extra)) return;
    // 결투 신청: 피해를 입혔고 적이 살아 있어야 반격이 온다(counter). 아니면 다음 일반 스킬을 기다린다.
    if (extra.prismDuel) {
        if (landed && alive && !run.enemy.mirror) { b.duel = 'pending'; cue(user, 'duelChallenge'); }
        else delete extra.prismDuel;
    }
    if (has(user, 'manualShift') && landed && !crits && count(e, 'shiftHits') % 2 === 0) e.shift = Math.min(3, Number(e.shift || 0) + 1);
    if (has(user, 'painfulWound') && extra.isBasic && crits) {
        b.woundCrits = Number(b.woundCrits || 0) + crits;
        if (b.woundCrits >= 5 && alive) {
            b.woundCrits -= 5;
            mechanics().addDot(user, 'prism:wound', '고통스러운 상처', Number(run.enemy.maxHp || 0) * .04, 5, 2000, true, { element: '암' });
            cue(user, 'painfulWound.apply');
        }
    }
    if (has(user, 'armorShred') && landed) {
        const before = Number(b.shred || 0);
        b.shred = Math.min(.30, Math.round((before + .06) * 100) / 100);
        if (b.shred >= .30 && before < .30) cue(user, 'armorShred.max');
    }
    // 선택의 시간: 표식이 있을 때 일반 공격은 표식을 소비해 회복하고, 스킬은 표식 폭발(modifyHit). 표식을 소비한 공격은 새 표식을 남기지 않는다.
    if (has(user, 'timeOfChoice')) {
        if (extra.prismMarkHeal) { corridor().heal(user, .10, .10); cue(user, 'timeOfChoice.heal'); }
        else if (extra.prismKind === 'skill' && !extra.prismMarkBurst && landed && alive && !isUltimate(user, extra.skillName)) { b.marked = true; cue(user, 'timeOfChoice.mark'); }
    }
    if (extra.prismSwords && alive) {
        b.swords = Number(b.swords || 0) + 1;
        summon(user, 'prism:sword:' + b.swords, '떠다니는 검', 'sword', 3, 1000);
        cue(user, 'flyingSword.summon');
    }
    if (extra.prismBleed) {
        b.bleedApplied = true;
        if (alive) { b.bleedLeft = 5; b.bleedDamage = Math.round(stats.atk * 1.5 * dotScale(stats)); cue(user, 'deepeningBleed.apply'); }
    }
    // 검무의 한 타 한 타는 여기서 세지 않고, 검무가 끝난 뒤 afterAction이 행동 한 번으로 센다.
    if (!extra.danceStrike) spendLastChance(user);
}
// 죽음을 초월하는 자의 마지막 기회: 내 행동(직접 공격) 한 번마다 한 번을 쓴다.
function spendLastChance(user) {
    const b = battle(user);
    if (!b.transcend) return;
    b.transcend.attacksLeft = Math.max(0, Number(b.transcend.attacksLeft || 0) - 1);
    if (user.paradise.enemy?.hp > 0 && b.transcend.attacksLeft <= 0) failTranscend(user);
}
// 여러 번 때리는 행동(검무)이 끝난 뒤 한 번 부른다.
function afterAction(user) { if (combat(user)) spendLastChance(user); }
// 내 공격 직후의 반격: 결투 신청(첫 일반 스킬, 피해 -75%), 원펀치 룰(일반 공격, 피해 -50%). rpgenius가 적의 공격을 계산해 적용한다.
function counter(user, extra) {
    if (!combat(user) || !direct(extra) || user.paradise.enemy.hp <= 0 || user.paradise.enemy.mirror) return null;
    const punch = has(user, 'onePunch') && !!extra.isBasic, duel = !!extra.prismDuel;
    if (!punch && !duel) return null;
    return { mul: duel ? .25 : .50, resetTimer: punch, cues: [duel && 'augment:duelChallenge.counter', punch && 'augment:onePunch.counter'].filter(Boolean) };
}
// 결투 신청의 반격을 받은 뒤: 10초 동안 서로의 행동 쿨타임이 절반. 이미 잡혀 있던 적의 다음 공격까지 남은 시간도 절반으로 줄인다.
// 내 다음 행동 시각은 이 행동이 끝날 때 getFieldActionCooldownMs가 actionMultiplier로 줄인다.
function afterCounter(user) {
    if (!combat(user)) return;
    const b = battle(user), now = Date.now(), field = user.field;
    if (b.duel !== 'pending') return;
    b.duel = 'haste'; b.duelUntil = now + 10000;
    if (field && Number(field.nextEnemyAttackAt || 0) > now) field.nextEnemyAttackAt = now + Math.round((field.nextEnemyAttackAt - now) * .5);
    cue(user, 'duelChallenge.haste'); log(user, '결투 신청, 10초 동안 서로의 행동이 빨라짐');
}

// ---- 피격 ----
function incoming(user, received, extra = {}, at = Date.now()) {
    if (!combat(user) || received <= 0) return 1;
    const b = battle(user), e = expedition(user);
    if (b.transcend) return 0;
    if (Number(e.angelUntil || 0) > at) { cue(user, 'angelDescent.guard'); return 0; }
    if (b.parry && !extra.counter) { b.parry = false; cue(user, 'readIntent.parry'); return 0; }
    return Number(b.rewindGuardUntil || 0) > at ? .50 : 1;
}
function rewind(user, stats, beforeHp, nextHp, at = Date.now()) {
    if (!combat(user) || !has(user, 'timeRewind')) return nextHp;
    const b = battle(user);
    hpSample(user, at, beforeHp);
    if (b.rewindUsed || beforeHp - nextHp < Number(stats.hp) * .25) return nextHp;
    const log3 = b.hpLog || [], past = [...log3].reverse().find(([t]) => t <= at - 3000) || log3[0];
    b.rewindUsed = true; b.rewindGuardUntil = at + 6000; cue(user, 'timeRewind');
    log(user, '되감기, HP를 3초 전으로 되돌렸습니다.');
    return Math.min(Number(stats.hp), Math.max(nextHp, Number(past?.[1] || beforeHp)));
}
function afterDamage(user, stats, at = Date.now()) {
    if (!combat(user)) return;
    const hp = Number(resources(user).hp), e = expedition(user), b = battle(user);
    if (has(user, 'angelDescent') && !e.angelUsed && hp > 0 && hp < Number(stats.hp) * .20) {
        e.angelUsed = true; e.angelUntil = at + 10000;
        summon(user, 'prism:angel', '천사', 'angel', 5, 2000, '명');
        cue(user, 'angelDescent.descend'); log(user, '천사강림, 천사가 10초 동안 대신 싸웁니다.');
    }
    if (has(user, 'deathWish') && hp > 0 && hp < Number(stats.hp) * .20 && !b.deathWishAwake) { b.deathWishAwake = true; cue(user, 'deathWish.awaken'); }
}
// 가시 갑옷: 적의 공격을 받을 때마다(보호막으로 막아도) 방어력의 300%를 고정 피해로 되돌린다.
function thorns(user, stats, damaged) {
    if (!combat(user) || !has(user, 'thornArmor') || damaged <= 0) return 0;
    cue(user, 'thornArmor');
    return Math.round(Number(stats.def || 0) * 3);
}
// 읽어 낸 살의: 적의 공격을 2회 받으면 다음 공격을 미리 계산해 둔다.
function takeForesight(user) {
    if (!combat(user) || !has(user, 'readIntent') || user.paradise.enemy?.mirror) return null;
    const b = battle(user), planned = b.foresight;
    if (!planned) return null;
    b.foresight = null; b.intentCount = 0;
    return planned;
}
function afterEnemyAttack(user, { avoided, planned }, roll) {
    if (!combat(user) || !has(user, 'readIntent') || user.paradise.enemy?.mirror || user.paradise.enemy.hp <= 0) return;
    const b = battle(user);
    if (planned) return;
    if (!avoided) b.intentCount = Number(b.intentCount || 0) + 1;
    if (b.intentCount >= 2 && !b.foresight) b.foresight = roll();
}
// 움직일수록 깊게: 적이 행동할 때마다 출혈 한 번.
function onEnemyAction(user) {
    if (!combat(user) || !has(user, 'deepeningBleed') || user.paradise.enemy.hp <= 0) return 0;
    const b = battle(user);
    if (!(Number(b.bleedLeft || 0) > 0)) return 0;
    b.bleedLeft--;
    return Number(b.bleedDamage || 0);
}
// 죽음을 초월하는 자: 마지막 기회 동안은 HP 1로 버티며(화면에는 0) 적의 공격을 받지 않는다.
function survive(user) {
    if (!combat(user) || !has(user, 'transcendDeath')) return 0;
    const b = battle(user);
    if (b.transcend) return 0;
    const now = Date.now();
    b.transcend = { until: now + 10000, attacksLeft: 2 };
    const cooldowns = user.field.skillCooldowns || {};
    for (const name of Object.keys(cooldowns)) cooldowns[name] = now;
    user.field.nextActionAt = now;
    cue(user, 'transcendDeath.trigger'); log(user, '죽음을 초월하는 자, 마지막 기회');
    return 1;
}
function failTranscend(user) {
    const b = battle(user);
    delete b.transcend;
    resources(user).hp = 0;
    cue(user, 'transcendDeath.fail');
}
function transcendActive(user) { return combat(user) && !!user.paradise.battle?.prism?.transcend; }
function freeSkill(user, name) {
    if (!combat(user)) return false;
    const b = battle(user);
    return !!b.transcend || !!name && b.replayFree === name;
}
// 처치할 때마다(2마리 전투의 첫 적 포함) 부른다.
function onKill(user) {
    if (!owned(user) || !user.paradise.battle) return;
    const b = user.paradise.battle.prism, e = expedition(user);
    if (has(user, 'soulReaper')) { e.souls = Number(e.souls || 0) + 1; corridor().heal(user, .05); cue(user, 'soulReaper.harvest'); }
    if (b?.transcend) {
        delete b.transcend;
        resources(user).hp = Math.max(1, Math.round(Number(statsOf(user).hp) * .30));
        cue(user, 'transcendDeath.revive'); log(user, '죽음을 초월하는 자, HP 30%로 부활');
    }
}
// 요청마다 부른다: 봄의 재생, 마지막 기회의 시간 제한. defeated를 돌려주면 패배 처리한다.
function advance(user, now = Date.now()) {
    if (!combat(user)) return null;
    const b = battle(user), e = expedition(user);
    if (b.transcend && now >= b.transcend.until) { failTranscend(user); return { defeated: true }; }
    let changed = false;
    if (has(user, 'seasons') && e.season === 'spring') {
        if (!b.springAt) b.springAt = now;
        const seconds = Math.floor((now - b.springAt) / 1000);
        if (seconds > 0) { b.springAt += seconds * 1000; corridor().heal(user, .01 * Math.min(seconds, 30)); changed = true; }
    } else delete b.springAt;
    hpSample(user, now, Number(resources(user).hp));
    return changed ? {} : null;
}

// ---- 스킬 ----
function skills(user) { return owned(user) ? SKILLS.filter(skill => has(user, skill.id)) : []; }
function replayTarget(user) {
    const name = expedition(user).lastSkill;
    if (!name) return null;
    const known = [...rpg().getMainCardSkills(user).map(entry => entry.skill.name), ...skills(user).map(skill => skill.name)];
    return known.includes(name) && !isUltimate(user, name) ? name : null;
}
function disabledReason(user, skill) {
    const b = user.paradise.battle?.prism || {}, e = expedition(user);
    if (skill.id === 'fatalDestiny' && Number(b.fate || 0) < 7) return '운명 7중첩 필요';
    if (skill.id === 'soulReaper' && !(Number(e.souls || 0) > 0)) return '영혼 없음';
    if (skill.id === 'replay' && !replayTarget(user)) return '다시 쓸 스킬 없음';
    if (skill.id === 'manualShift') return e.armed ? '변속 완료' : Number(e.shift || 0) < 1 ? '운명 중첩 없음' : null;
    if (skill.id === 'readIntent') return b.parry ? '간파 준비됨' : !b.foresight ? '살의를 읽는 중' : null;
    return null;
}
function skillCost(user, skill, stats) {
    if (!skill.mp) return 0;
    if (stats.kino) return Math.ceil(Number(stats.mental || 0) * Number(skill.kinoRatio || 0));
    return Math.max(0, Math.round(skill.mp * (1 + Math.max(-1, Number(stats.mpReduce || 0)))));
}
function skillView(user, stats) {
    if (!combat(user)) return [];
    const descs = Object.fromEntries(catalog.filter(a => a.skill).map(a => [a.skill, a.lines.find(line => line.includes(a.skill)) || a.desc]));
    return skills(user).map(skill => ({ name: skill.name, element: null, hpCost: 0, mpCost: skillCost(user, skill, stats), resourceLabel: stats.kino ? '정신력' : 'MP',
        cooldownEnd: Number(user.field.skillCooldowns?.[skill.name] || 0), cooltimeText: skill.cooldown ? skill.cooldown / 1000 + '초' : '없음',
        descLines: [descs[skill.name]], augmentSkill: true, ...(disabledReason(user, skill) ? { disabledReason: disabledReason(user, skill) } : {}) }));
}
// 피해를 주는 증강 스킬. 돌려주는 값은 공격 피해의 원본이다.
function activeSkill(user, skill, stats, extra) {
    const b = battle(user), e = expedition(user);
    extra.prismSkill = true;
    if (skill.id === 'fatalDestiny') { b.fate = Math.max(0, Number(b.fate || 0) - 7); extra.hitCount = 1; return stats.atk * .07; }
    if (skill.id === 'soulReaper') {
        const souls = Number(e.souls || 0); e.souls = 0;
        extra.hitCount = 1; extra.oneTimeTrueDmg = Math.round(stats.atk * 1.44 * souls); extra.disableEquipmentBonusDamage = true;
        extra.notice = '명계의 부름, 영혼 ' + souls + '개'; log(user, '명계의 부름, 영혼 ' + souls + '개');
        return 0;
    }
    return 0;
}
// 피해 없는 증강 스킬(변속, 간파). 행동 시간을 쓰지 않는다.
function useUtility(user, skill) {
    if (!combat(user)) return { error: '전투 중에만 사용할 수 있습니다.' };
    const reason = disabledReason(user, skill);
    if (reason) return { error: reason };
    const run = user.paradise, e = expedition(user), b = battle(user), now = Date.now();
    let message;
    if (skill.id === 'manualShift') { e.shift = Number(e.shift || 0) - 1; e.armed = true; message = '변속, 다음 공격이 확정 치명타로 적중합니다.'; }
    else {
        b.parry = true; corridor().heal(user, .10);
        user.field.nextActionAt = Math.max(now, Number(user.field.nextActionAt || 0)) + 2000;
        message = '간파, 다음 적 공격을 무효화합니다. 다음 행동 +2초';
    }
    pushEvent(user, { action: 'skill', actor: 'player', skillName: skill.name, effectTarget: 'actor', triggeredEffectIds: drainCues(user) });
    run.combatLog = [message, ...(run.combatLog || [])].slice(0, 18);
    return { message };
}
function onSkillUsed(user, name) {
    if (!owned(user) || !name) return;
    const e = expedition(user), skill = SKILLS.find(entry => entry.name === name);
    if (isUltimate(user, name) || skill?.utility || skill?.replay) return;
    if ((!skill || skill.id === 'swordDance') && !e.replaying) e.lastSkill = name;
    if (has(user, 'seasons')) {
        e.season = SEASONS[(SEASONS.indexOf(e.season || 'spring') + 1) % SEASONS.length];
        cue(user, 'seasons.' + e.season);
        if (user.paradise.battle) battle(user).springAt = e.season === 'spring' ? Date.now() : undefined;
    }
}

// ---- 보이기 ----
function dotsOf(user) { return user.paradise.battle?.mechanics?.dots || {}; }
function view(user) {
    if (!combat(user)) return [];
    const run = user.paradise, e = expedition(user), b = run.battle.prism || {}, enc = encounter(user), now = Date.now(), dots = dotsOf(user);
    const stair = Number(run.battle.mechanics?.stairStep || 0);
    const aura = {
        conqueror: () => ({ stacks: Number(enc.conqueror || 0), max: 10 }),
        fatalDestiny: () => ({ stacks: Number(b.fate || 0) }),
        seasons: () => ({ season: e.season || 'spring' }),
        manualShift: () => ({ stacks: Number(e.shift || 0), max: 3, armed: !!e.armed }),
        soulReaper: () => ({ souls: Number(e.souls || 0) }),
        readIntent: () => ({ count: Number(b.intentCount || 0), foresight: b.foresight ? { damage: Number(b.foresight.finalDamage || 0), critical: Number(b.foresight.criticalCount || 0) > 0, avoided: !!b.foresight.avoided } : null, parry: !!b.parry }),
        timeOfChoice: () => ({ marked: !!b.marked }),
        flyingSword: () => ({ swords: Object.keys(dots).filter(key => key.startsWith('prism:sword')).length, ready: now - Number(b.lastAttackAt || now) >= 4000 }),
        deathWish: () => ({ active: Number(resources(user).hp) < Number(statsOf(user).hp) * .20 }),
        eternalFlame: () => ({ burning: !!dots['prism:flame'] }),
        deepeningBleed: () => ({ left: Number(b.bleedLeft || 0) }),
        angelDescent: () => ({ until: Number(e.angelUntil || 0), used: !!e.angelUsed }),
        transcendDeath: () => ({ until: Number(b.transcend?.until || 0), attacksLeft: Number(b.transcend?.attacksLeft || 0) }),
        hundredFlowers: () => ({ flowers: Number(b.flowers || 0) }),
        armorShred: () => ({ percent: Math.round(Number(b.shred || 0) * 100) }),
        painfulWound: () => ({ until: Number(dots['prism:wound']?.until || 0), crits: Number(b.woundCrits || 0) }),
        comboStaircase: () => ({ step: stair % 3 + 1 }),
        fruition: () => ({ count: Number(e.fruition || 0) % 3 }),
        holyLightning: () => ({ count: Number(e.lightning || 0) % 3 }),
        demonHunter: () => ({ count: Number(e.demon || 0) % 3 }),
        timeRewind: () => ({ used: !!b.rewindUsed, guardUntil: Number(b.rewindGuardUntil || 0) }),
        // stage: ready(첫 일반 스킬을 기다림) / pending(반격 직전) / haste(서로 가속, until까지) / done
        duelChallenge: () => ({ stage: b.duel === 'haste' && now >= Number(b.duelUntil || 0) ? 'done' : b.duel || 'done', until: Number(b.duelUntil || 0) }),
        replay: () => ({ skill: replayTarget(user) }),
        dualIdentity: () => ({ cardName: e.identityName || null })
    };
    return catalog.filter(a => run.acquired[a.id]).map(a => ({ id: a.id, ...(aura[a.id] ? aura[a.id]() : {}) }));
}
// 전투 화면의 짧은 상태 칩(낙원 HUD). 숫자가 변하는 것만 보인다.
// 전투 화면의 증강 상태 표시(낙원 화면이 증강 그림으로 그린다). side: 'self'는 내 정보 카드 곁, 'enemy'는 적 체력 막대 아래.
// value/max는 중첩(테두리 눈금), until/total은 남은 시간(줄어드는 테두리), ready는 준비됨(빛남), dim은 아직 쓸 일이 없음, state는 자세히 볼 때의 한 줄.
// 신성한 번개, 치명적인 운명, 백화요란, 악마 사냥꾼, 선택의 시간, 읽어 낸 살의는 사용자 지시(2026-11-19)로 표시하지 않는다(전장 연출로만 보인다). 순서는 고정이라 표시가 자리를 바꾸지 않는다.
function statusView(user) {
    if (!combat(user)) return [];
    const run = user.paradise, e = expedition(user), b = run.battle.prism || {}, enc = encounter(user), now = Date.now(), list = [];
    const add = (id, side, label, value, extra = {}) => { if (has(user, id)) list.push({ id, side, label, value, ...extra }); };
    if (b.transcend) add('transcendDeath', 'self', '마지막 기회', b.transcend.attacksLeft, { max: 2, until: b.transcend.until, total: 10000, ready: true, urgent: true, state: `남은 기회 ${b.transcend.attacksLeft}번, 그 안에 처치하면 부활` });
    if (Number(e.angelUntil || 0) > now) add('angelDescent', 'self', '천사', Math.ceil((e.angelUntil - now) / 1000) + '초', { until: e.angelUntil, total: 10000, ready: true, state: '천사가 함께 싸우는 중, 받는 피해 없음' });
    if (b.duel === 'haste' && now < Number(b.duelUntil || 0)) add('duelChallenge', 'self', '결투', Math.ceil((b.duelUntil - now) / 1000) + '초', { until: b.duelUntil, total: 10000, ready: true, state: '나와 적의 행동 쿨타임 50% 감소' });
    else if (b.duel === 'ready' || b.duel === 'pending') add('duelChallenge', 'self', '결투', '대기', { dim: true, state: '첫 일반 스킬로 피해를 입히면 결투가 시작됩니다' });
    const conquest = Number(enc.conqueror || 0);
    add('conqueror', 'self', '정복자', conquest, { max: 10, ready: conquest >= 10, dim: !conquest, state: conquest >= 10 ? '10중첩, 기병이 함께 싸우는 중' : `${conquest} / 10중첩` });
    const fruit = Number(e.fruition || 0) % 3;
    add('fruition', 'self', '결실', fruit, { max: 3, ready: fruit === 2, dim: !fruit, state: fruit === 2 ? '다음 공격이 확정 치명타' : `확정 치명타까지 ${3 - fruit}번` });
    add('manualShift', 'self', '변속', e.armed ? '준비' : Number(e.shift || 0), e.armed ? { ready: true, state: '다음 공격이 확정 치명타' } : { max: 3, dim: !Number(e.shift || 0), state: `${Number(e.shift || 0)} / 3단` });
    add('soulReaper', 'self', '영혼', Number(e.souls || 0), { dim: !Number(e.souls || 0), state: `모은 영혼 ${Number(e.souls || 0)}개` });
    add('seasons', 'self', '계절', SEASON_NAMES[e.season || 'spring'], { season: e.season || 'spring', state: `지금은 ${SEASON_NAMES[e.season || 'spring']}` });
    if (b.shred) add('armorShred', 'enemy', '방어 감소', '-' + Math.round(b.shred * 100) + '%', { percent: Math.round(b.shred * 100), max: 30, ready: b.shred >= .30, state: `적 방어력 -${Math.round(b.shred * 100)}%` });
    if (Number(b.bleedLeft || 0) > 0) add('deepeningBleed', 'enemy', '출혈', Number(b.bleedLeft), { max: 5, state: `남은 출혈 ${Number(b.bleedLeft)}번` });
    const woundUntil = Number(dotsOf(user)['prism:wound']?.until || 0), wounded = woundUntil > now, crits = Number(b.woundCrits || 0);
    add('painfulWound', 'enemy', '상처', crits, { max: 5, dim: !crits && !wounded, ...(wounded ? { until: woundUntil, total: 10000 } : {}), state: (wounded ? '상처가 벌어지는 중, ' : '') + `다음 상처까지 치명타 ${5 - crits}번` });
    return list;
}
module.exports = { SKILLS, SEASONS, SEASON_NAMES, TICK_CUES, has, owned, drainCues, pushEvent, applyStats, cooldownMultiplier, enemyIntervalBonus, actionReduction, actionMultiplier, enemyIntervalMultiplier,
    onAcquire, onBattle, prepareAttack, attackMultiplier, modifyHit, afterHit, afterAction, counter, afterCounter, incoming, rewind, afterDamage, thorns,
    takeForesight, afterEnemyAttack, onEnemyAction, survive, transcendActive, freeSkill, onKill, advance, tickDamage,
    skills, replayTarget, disabledReason, skillCost, skillView, activeSkill, useUtility, onSkillUsed, view, statusView };
