const catalog = require('./paradise_augments_mechanics');
const shields = require('./combat_shields');
const rpg = () => require('./rpgenius');
const corridor = () => require('./paradise');
const active = user => corridor().active(user) && user.paradise.mode !== 'hell' && user.paradise.phase === 'combat' && !!user.field?.paradise;
const has = (user, id) => active(user) && !!user.paradise.acquired[id];
const relic = (user, id) => active(user) && user.paradise.relics.includes(id);
const state = user => user.paradise.battle.mechanics ||= {};
const expedition = user => user.paradise.mechanics ||= {};
const direct = extra => !extra.dotAttack && !extra.summonAttack && !extra.isBotAutoAttack;
const isDot = extra => extra.paradiseDot === true;
const consumedDots = new WeakSet();
const notice = (extra, text) => { extra.notice = [extra.notice, text].filter(Boolean).join(' / '); };
const count = (s, key, n = 1) => (s[key] = Number(s[key] || 0) + n);
const ultimate = (user, name) => rpg().getUltimateSkills(user).some(entry => entry.skill.name === name);
const skillEntries = user => [...rpg().getMainCardSkills(user).map(entry => entry.skill), ...skills(user)];
function reduce(user, name, ms) {
    const now = Date.now(), cooldowns = user.field.skillCooldowns;
    if (cooldowns[name] > now) cooldowns[name] = Math.max(now, cooldowns[name] - ms);
}
function reduceLongest(user, ms, includeUltimate = false, except) {
    const now = Date.now(), allowed = new Set(skillEntries(user).filter(skill => skill.name !== except && (includeUltimate || !ultimate(user, skill.name))).map(skill => skill.name));
    const entry = Object.entries(user.field.skillCooldowns).filter(([name, until]) => allowed.has(name) && until > now).sort((a, b) => b[1] - a[1])[0];
    if (entry) reduce(user, entry[0], ms);
}
function shield(user, id, amount, seconds) {
    if (rpg().calculateUserStats(user).disableShield) return;
    shields.grant(user.field, { source: 'paradise:' + id, caster: user.name, amount: Math.round(amount), expiresAt: Date.now() + seconds * 1000 });
}
function announceReward(user, text) {
    const run = user.paradise;
    run.rewardReveal = { motif: 'contract', positive: true, text: [run.rewardReveal?.text, text].filter(Boolean).join('\n') };
    run.history.unshift({ floor: run.floor, text });
}
function cardContract(user, name, star, type = '일반') {
    user.paradise.contracts.push({ star, type, name: name + ' · ' + star + '성 ' + type + ' 카드' });
    announceReward(user, name + ' · ' + star + '성 ' + type + ' 카드 계약을 획득했습니다.');
}
function rewardBonus(user, id, increment, limit, extra) {
    const e = expedition(user), before = Number(e[id] || 0), added = Math.min(increment, Math.max(0, limit - before));
    if (!added) return;
    e[id] = Math.round((before + added) * 1e9) / 1e9;
    user.paradise.effects.reward = Number(user.paradise.effects.reward || 0) + added;
    const text = catalog.find(a => a.id === id).name + ' · 종료 보상 +' + Math.round(added * 100) + '%p';
    if (extra) notice(extra, text); else announceReward(user, text);
}
function relicPrize(user, id) {
    const e = expedition(user), s = state(user);
    if (s[id + 'Paid'] || Number(e[id] || 0) >= 3) return;
    s[id + 'Paid'] = true; count(e, id);
    announceReward(user, catalog.find(a => a.id === id).name + ' · ' + corridor().grantRelic(user));
}

// 네이티브 화상·겁화·유서새김·카스 살포와 증강 지속 피해를 같은 계약으로 조회한다.
// 아래 어댑터의 함수는 저장하지 않고 매번 실제 전투 상태를 참조한다.
function dots(user, now = Date.now()) {
    if (!active(user)) return [];
    const result = [], s = state(user);
    const add = (key, dot, damage, endKey, nextKey, interval, remove) => {
        if (!dot || consumedDots.has(dot) || !(dot[endKey] > now)) return;
        const next = nextKey ? Number(dot[nextKey] || now + interval) : now + interval;
        const ticks = Math.max(0, Math.floor((dot[endKey] - Math.max(now, next)) / interval) + 1);
        if (ticks) result.push({ key, damage: Number(damage || 0), ticks,
            get consumed() { return consumedDots.has(dot); },
            extend: ms => { dot[endKey] += ms; }, remove: () => { consumedDots.add(dot); remove(); } });
    };
    for (const [key, dot] of Object.entries(s.dots || {}))
        add(key, dot, dot.damage, 'until', 'nextAt', dot.interval, () => { if (s.dots[key] === dot) delete s.dots[key]; });
    for (const key of ['burn', 'hellfire']) {
        const dot = user.field.equipmentState?.[key];
        add(key, dot, dot?.tickDamage, 'expiredAt', 'nextTickAt', Number(dot?.intervalMs || 2000), () => { if (user.field.equipmentState[key] === dot) delete user.field.equipmentState[key]; });
    }
    const mark = user.field.mark;
    add('mark', mark, mark?.dot, 'expired_at', null, 2000, () => { if (user.field.mark === mark) delete user.field.mark; });
    const spray = user.field.kino?.dot;
    if (spray) {
        const stats = rpg().calculateUserStats(user);
        add('spray', spray, stats.atk * spray.rate * (1 + Number(stats.dotDamage || 0)), 'until', 'nextAt', 2000, () => { if (user.field.kino.dot === spray) delete user.field.kino.dot; });
    }
    return result;
}
function consumeDots(user) {
    const current = dots(user), amount = current.reduce((sum, dot) => sum + dot.damage * dot.ticks, 0);
    current.forEach(dot => dot.remove());
    return Math.round(amount);
}
function extendDots(user, ms) { dots(user).forEach(dot => dot.extend(ms)); }
function addDot(user, key, label, damage, ticks, interval = 2000, precalculated = false) {
    if (!active(user) || damage <= 0) return;
    const s = state(user), now = Date.now();
    (s.dots ||= {})[key] = { label, damage: Math.round(damage), interval, nextAt: now + interval, until: now + interval * ticks, precalculated };
    rpg().ensureFieldEquipmentDotTimer(user);
}
function hasTicks(user) { return active(user) && Object.keys(user.paradise.battle.mechanics?.dots || {}).length > 0; }
function takeTicks(user, now) {
    if (!hasTicks(user)) return [];
    const s = state(user), pending = [];
    for (const [key, dot] of Object.entries(s.dots)) {
        while (dot.nextAt <= now && dot.nextAt <= dot.until) {
            pending.push({ label: dot.label, rawDamage: dot.damage, precalculated: dot.precalculated, paradiseDot: true });
            dot.nextAt += dot.interval;
        }
        if (dot.nextAt > dot.until) delete s.dots[key];
    }
    return pending;
}
function onBattle(user) {
    if (!active(user)) return;
    const e = expedition(user), stats = rpg().calculateUserStats(user);
    if (has(user, 'glassBastion')) shield(user, 'glassBastion', stats.hp * .20, 12);
    if (has(user, 'wardRelay') && e.carriedWard) shield(user, 'wardRelay', Math.min(e.carriedWard, stats.hp * .40), 15);
    if (has(user, 'contagiousAsh') && e.carriedAsh) addDot(user, 'ash', '옮겨 붙는 잿더미', Math.min(e.carriedAsh, stats.atk * 3), 3, 2000, true);
    if (has(user, 'bottledAgony') && e.bottledDamage) addDot(user, 'bottledAgony', '고통의 병조림', e.bottledDamage / 4, 4, 2000, true);
    if (relic(user, 'guardianClasp')) shield(user, 'guardianClasp', stats.hp * .27, 20);
    delete e.bottledDamage;
    delete e.carriedWard; delete e.carriedAsh;
}
function onVictory(user) {
    if (!active(user)) return;
    const s = state(user), e = expedition(user), remaining = shields.summary(user.field, Date.now()).amount;
    if (has(user, 'wardRelay')) e.carriedWard = remaining * .50;
    if (has(user, 'bastionPact') && remaining > 0 && !user.paradise.battle.hasTakenHpDamage) rewardBonus(user, 'bastionPact', .02, .20);
    if (has(user, 'threefoldPact') && ['basic', 'skill', 'dot'].every(type => (s.damageKinds || []).includes(type))) rewardBonus(user, 'threefoldPact', .03, .30);
    const stats = rpg().calculateUserStats(user), hp = corridor().getResources(user).hp;
    if (has(user, 'shieldEscrow')) {
        e.shieldDeposit = Number(e.shieldDeposit || 0) + remaining;
        const units = Math.floor(e.shieldDeposit / stats.hp);
        if (units) { e.shieldDeposit %= stats.hp; rewardBonus(user, 'shieldEscrow', units * .05, .25); }
    }
    if (has(user, 'ultimateWager') && s.ultimateAt && Date.now() - s.ultimateAt <= 10000) rewardBonus(user, 'ultimateWager', .05, .25);
    if (has(user, 'secondReceipt') && user.paradise.battle.hasTakenHpDamage && (s.normalSkills || []).length >= 2
        && Number(e.receiptPrizes || 0) < 2 && count(e, 'receiptWins') % 3 === 0) {
        count(e, 'receiptPrizes'); cardContract(user, '두 번째 영수증', 8, '각성');
    }
    if (has(user, 'lastTicket') && hp <= stats.hp * .20 && Number(e.lastTickets || 0) < 2) {
        count(e, 'lastTickets'); cardContract(user, '마지막 티켓', 8);
    }
}

const SKILLS = [
    { id: 'skillIgnition', name: '도화선 점화', ratio: .08, cooldown: 12000, element: '화' },
    { id: 'skillRupture', name: '응혈 폭발', ratio: .10, cooldown: 18000, element: '암' },
    { id: 'skillBulwark', name: '유리 방벽', ratio: .12, cooldown: 20000, element: '명' },
    { id: 'skillShadowDance', name: '그림자 연무', ratio: .10, cooldown: 16000, element: '암' },
    { id: 'skillFoldTime', name: '시간 접기', ratio: 0, cooldown: 30000, hpCost: .10 },
    { id: 'skillDoubleDown', name: '판돈 뒤집기', ratio: 0, cooldown: 25000, hpCost: .20 },
    { id: 'skillBloodAuction', name: '생명 경매', ratio: 0, cooldown: 18000, hpCost: .15 },
    { id: 'skillWardShatter', name: '방벽 투척', ratio: 0, cooldown: 20000 },
    { id: 'skillThreadPull', name: '운명의 당김', ratio: .15, cooldown: 25000, element: '명' },
    { id: 'skillBorrowedTomorrow', name: '내일 훔치기', ratio: 0, cooldown: 30000, hpCost: .10 }
];
function skills(user) { return SKILLS.filter(skill => has(user, skill.id)); }
function freeSkill(user, name) {
    if (!active(user)) return false;
    const s = state(user);
    return !!(s.freeAny || s.freeNormal && !ultimate(user, name) || s.freeNamed === name);
}
function payment(user, stats, cost, name) {
    if (!active(user)) return { cost, hpCost: 0 };
    if (freeSkill(user, name)) return { cost: 0, hpCost: 0 };
    const mp = Number(corridor().getResources(user).mp || 0), shortfall = Math.max(0, cost - mp);
    if (!stats.kino && has(user, 'bloodMana') && shortfall > 0 && corridor().getResources(user).hp > shortfall * 2)
        return { cost: mp, hpCost: shortfall * 2 };
    return { cost, hpCost: 0 };
}
function skillView(user) {
    if (!active(user)) return [];
    const stats = rpg().calculateUserStats(user);
    return skills(user).map(skill => ({ name: skill.name, element: skill.element || null,
        hpCost: Math.floor(corridor().getResources(user).hp * Number(skill.hpCost || 0)),
        mpCost: Math.ceil((stats.kino ? stats.mental : stats.mp) * skill.ratio), resourceLabel: stats.kino ? '정신력' : 'MP',
        cooldownEnd: Number(user.field.skillCooldowns[skill.name] || 0), cooltimeText: skill.cooldown / 1000 + '초',
        descLines: [catalog.find(a => a.id === skill.id).desc], augmentSkill: true,
        ...(skill.id === 'skillRupture' && !dots(user).length ? { disabledReason: '지속 피해 없음' } : {}),
        ...(skill.id === 'skillWardShatter' && shields.summary(user.field, Date.now()).amount <= 0 ? { disabledReason: '보호막 없음' } : {}) }));
}
function onSkill(user, name, stats, extra) {
    if (!active(user)) return;
    if (has(user, 'venomDetonator')) extra.maturingDots = dots(user);
    const s = state(user), isUltimate = ultimate(user, name);
    if (!isUltimate) s.normalSkills = [...new Set([...(s.normalSkills || []), name])];
    if (has(user, 'pilferTurn') && s.enemyActionAt && Date.now() - s.enemyActionAt <= 1500 && s.pilferedAt !== s.enemyActionAt) {
        s.pilferedAt = s.enemyActionAt;
        if (user.paradise.enemy.mirror) user.paradise.enemy.mirror.nextActionAt += 2000;
        else user.field.nextEnemyAttackAt = Number(user.field.nextEnemyAttackAt || Date.now() + 4000) + 2000;
        corridor().heal(user, 0, .10); notice(extra, '찰나의 소매치기 · 적의 다음 행동 +2초');
    }
    if (has(user, 'ultimateReservoir') && !isUltimate) s.reservoir = Number(s.reservoir || 0) + Number(extra.mpCost || 0);
    if (s.freeAny) s.freeAny = false;
    if (s.freeNormal && !isUltimate) s.freeNormal = false;
    if (s.freeNamed === name) delete s.freeNamed;
    if (has(user, 'bloodInk') && dots(user).length && Number(s.ink || 0) < 1) {
        const resources = corridor().getResources(user);
        resources.hp = Math.max(1, resources.hp - Math.round(stats.hp * .05));
        s.ink = Math.min(1, Number(s.ink || 0) + .25); notice(extra, '피로 쓰는 잉크 · 지속 피해 강화');
    }
    if (has(user, 'spellTriad')) {
        s.triadNames = [...new Set([...(s.triadNames || []), name])];
        if (!isUltimate) s.triadLast = name;
        if (s.triadNames.length >= 3 && s.triadLast) { s.triadReady = s.triadLast; s.triadNames = []; }
    }
    if (has(user, 'firstSpellMemory') && !isUltimate && !s.firstSpell) { s.firstSpell = name; s.memoryBasics = 0; }
    if (!isUltimate) return;
    s.ultimateAt = Date.now(); count(s, 'ultimateCasts');
    if (has(user, 'ultimateReservoir')) { shield(user, 'ultimateReservoir', Math.min(stats.hp * .60, Number(s.reservoir || 0) * 3), 20); s.reservoir = 0; }
    if (relic(user, 'oracleLens') && !s.oracleUsed) { s.oracleUsed = true; s.oracleSkill = name; s.guard = true; }
    if (relic(user, 'moonSeal') && !s.moonUsed) { s.moonUsed = true; s.moonStrike = true; shield(user, 'moonSeal', stats.hp * .45, 20); }
    if (has(user, 'ultimateOverture') && !s.overtureUsed) {
        s.overtureUsed = true; s.freeNormal = true;
        skillEntries(user).filter(skill => !ultimate(user, skill.name)).forEach(skill => reduce(user, skill.name, Infinity));
        notice(extra, '피날레 뒤의 서곡 · 일반 스킬 초기화');
    }
    if (has(user, 'ultimateEncore')) s.encoreBasics = 3;
    if (has(user, 'ultimateDividend') && count(expedition(user), 'ultimateUses') % 3 === 0) {
        cardContract(user, '대단원의 배당', 8); corridor().heal(user, .20, .20);
    }
    if (has(user, 'ultimateHourglass')) {
        const now = Date.now();
        skillEntries(user).filter(skill => !ultimate(user, skill.name)).forEach(skill => { user.field.skillCooldowns[skill.name] = Math.max(now, Number(user.field.skillCooldowns[skill.name] || 0)) + 10000; });
    }
    if (has(user, 'ultimateHarvest')) {
        s.harvest = Number(s.harvest || 0) + consumeDots(user);
        shield(user, 'ultimateHarvest', stats.hp * .20, 10); notice(extra, '종말의 수확 · 다음 일반 공격에 수확한 피해 추가');
    }
}
function afterCooldown(user, name) {
    if (has(user, 'ultimateHourglass') && ultimate(user, name)) {
        const now = Date.now(), until = Number(user.field.skillCooldowns[name] || now);
        user.field.skillCooldowns[name] = now + Math.max(0, until - now) * .60;
    }
    if (!active(user)) return;
    const s = state(user), now = Date.now(), until = Number(user.field.skillCooldowns[name] || now);
    if (has(user, 'ultimateLoan') && ultimate(user, name)) {
        if (s.ultimateCasts === 1) user.field.skillCooldowns[name] = now;
        else if (s.ultimateCasts === 2) user.field.skillCooldowns[name] = now + Math.max(0, until - now) * 2;
    }
    if (s.oracleSkill === name) { user.field.skillCooldowns[name] = now + Math.max(0, user.field.skillCooldowns[name] - now) * .35; delete s.oracleSkill; }
}
function activeSkill(user, skill, stats, extra) {
    const s = state(user);
    switch (skill.id) {
        case 'skillIgnition': addDot(user, 'ignition', '도화선 점화', stats.atk * .40 * (1 + Number(stats.dotDamage || 0)), 5, 1000); return stats.atk * .80;
        case 'skillRupture': extra.oneTimeTrueDmg = consumeDots(user); return 0;
        case 'skillBulwark': shield(user, 'skillBulwark', stats.hp * .35, 10); return stats.atk * .50;
        case 'skillShadowDance': extra.hitCount = 3; s.guard = true; return stats.atk * .60;
        case 'skillFoldTime':
            skillEntries(user).filter(entry => entry.name !== skill.name && !ultimate(user, entry.name)).forEach(entry => reduce(user, entry.name, 5000));
            extendDots(user, 2000); extra.disableEquipmentBonusDamage = true; notice(extra, '시간 접기 · 일반 스킬 -5초 · 지속 피해 +2초'); return 0;
        case 'skillDoubleDown':
            if (Math.random() < .50) { notice(extra, '판돈 뒤집기 · 대박! 공격력 600% 피해'); return stats.atk * 6; }
            shield(user, 'skillDoubleDown', stats.hp * .20, 8); notice(extra, '판돈 뒤집기 · 실패 · 보호막 획득'); return stats.atk * .50;
        case 'skillBloodAuction':
            if (!user.paradise.effects.noHealing) {
                if (stats.kino) require('./rando_characters').recoverMental(stats, user.field, stats.mental * .25, Date.now());
                else corridor().heal(user, 0, .25);
            }
            return stats.atk * 3;
        case 'skillWardShatter': {
            const amount = shields.summary(user.field, Date.now()).amount;
            shields.expire(user.field, Date.now()); shields.absorb(user.field, amount);
            extra.oneTimeTrueDmg = Math.min(stats.hp * 2, amount * 2); s.guard = true;
            return 0;
        }
        case 'skillThreadPull': s.threadPull = true; s.freeNormal = true; return stats.atk;
        case 'skillBorrowedTomorrow':
            reduceLongest(user, Infinity, false, skill.name); s.guard = true;
            user.paradise.distortion = Math.min(100, user.paradise.distortion + 5);
            extra.disableEquipmentBonusDamage = true; notice(extra, '내일 훔치기 · 스킬 초기화 · 뒤틀림 +5'); return 0;
    }
}
function prepareAttack(user, stats, extra) {
    if (!active(user)) return;
    const s = state(user);
    if (isDot(extra)) { extra.disableCritical = true; stats.ilionForceCritical = false; extra.dotTypes = dots(user).length; return; }
    if (!direct(extra)) return;
    // 이번 공격이 새로 부여하는 화상은 만기 회수 대상에 포함하지 않는다.
    if (extra.isSkill && has(user, 'venomDetonator')) extra.maturingDots ||= dots(user);
    if (s.meltReady) { extra.defReductionBonus = Number(extra.defReductionBonus || 0) + .50; s.meltReady = false; notice(extra, '갑옷을 녹이는 시간'); }
    if (s.ruptureReady) { extra.defReductionBonus = 1; s.ruptureReady = false; notice(extra, '세 번째 균열'); }
    if (extra.isBasic) {
        if (has(user, 'comboStaircase') && !extra.hitCount) extra.comboHitCount = Math.max(Number(extra.comboHitCount || 1), (count(s, 'stairStep') - 1) % 3 + 1);
        if (s.threadPull && !extra.hitCount) { extra.comboHitCount = 2 + Math.max(0, Number(stats.maxCmb || 0)); s.threadPull = false; }
        if (relic(user, 'hunterBadge') && !s.hunterUsed && !extra.hitCount) {
            s.hunterUsed = true; extra.comboHitCount = Math.max(3, Number(extra.comboHitCount || 1)); stats.comboLastCrit = true;
        }
        if (s.encoreReady && has(user, 'comboEncore') && !extra.hitCount) { extra.comboHitCount = Math.max(2, Number(extra.comboHitCount || 1)); s.encoreReady = false; }
        if (s.meterReady && has(user, 'comboMeter') && !extra.hitCount) {
            extra.comboHitCount = 2 + Math.max(0, Math.floor(Number(stats.maxCmb || 0)));
            stats.comboLastCrit = true; s.meterReady = false; notice(extra, '여섯 박자의 지휘자 · 최대 연격');
        }
        if (s.glassReady) { extra.forceCritical = true; extra.mechanicsDouble = true; s.glassReady = false; }
        if (has(user, 'shedArmor')) {
            const amount = shields.summary(user.field, Date.now()).amount * .25;
            shields.expire(user.field, Date.now()); shields.absorb(user.field, amount);
            extra.mechanicsFixed = amount * 2;
        }
    }
    if (s.waltzReady) { extra.mechanicsDouble = true; s.waltzReady = false; corridor().heal(user, 0, .10); }
    if (has(user, 'loadedCoin') && count(s, 'coinAttacks') % 4 === 0) {
        if (Math.random() < .50) { extra.mechanicsTriple = true; notice(extra, '네 번째 동전 · 성공! 피해 3배'); }
        else { corridor().heal(user, .15); notice(extra, '네 번째 동전 · 실패 · HP 15% 회복'); }
    }
}
function modifyHit(user, stats, extra, hit) {
    if (!active(user)) return;
    const s = state(user), scale = mul => {
        hit.finalDamage = Math.round(hit.finalDamage * mul);
        for (const detail of hit.hitDetails || []) { detail.damage = Math.round(detail.damage * mul); if (detail.fixedDamage) detail.fixedDamage = Math.round(detail.fixedDamage * mul); }
    };
    const add = (amount, label) => {
        amount = Math.max(0, Math.round(amount));
        if (!amount) return;
        hit.finalDamage += amount; (hit.hitDetails ||= []).push({ damage: amount, fixedDamage: amount, isCritical: false, label });
        notice(extra, label + ' · ' + amount.toLocaleString('ko-KR') + ' 피해');
    };
    if (isDot(extra)) {
        scale(1 + (has(user, 'patientPoison') ? Math.min(1, Number(s.dotHits || 0) * .10) : 0) + Number(s.ink || 0));
        if (has(user, 'dotCritical') && hit.finalDamage > 0) {
            const result = rpg().applyCriticalDamage(hit.finalDamage, stats, {}, user.paradise.enemy);
            if (result.isCritical) {
                scale(result.damage / hit.finalDamage); hit.criticalCount = 1;
                for (const detail of hit.hitDetails || []) detail.isCritical = true;
                notice(extra, '고통의 급소 · 치명타');
            }
        }
        return;
    }
    if (!direct(extra)) return;
    if (extra.mechanicsDouble) scale(2);
    if (extra.mechanicsTriple) scale(3);
    if (relic(user, 'duelGlove') && s.duelReady) { s.duelReady = false; scale(1.9); }
    if (s.moonStrike) { s.moonStrike = false; scale(2.35); }
    if (extra.isSkill && has(user, 'comboSavings') && s.savedCombos) { scale(1 + s.savedCombos * .25); s.savedCombos = 0; }
    if (extra.isSkill && hit.finalDamage > 0 && has(user, 'bottledAgony') && !s.bottled && dots(user).length) {
        s.bottled = true; expedition(user).bottledDamage = Math.min(stats.atk * 12, consumeDots(user) * .75);
        notice(extra, '고통의 병조림 · 다음 전투에 고통을 저장했습니다.');
    }
    if (extra.isSkill && has(user, 'venomDetonator') && hit.finalDamage > 0) {
        const matured = (extra.maturingDots || []).filter(dot => !dot.consumed);
        add(matured.reduce((sum, dot) => sum + dot.damage * dot.ticks, 0) * .50, '독의 만기일');
        matured.forEach(dot => dot.remove());
    }
    if (s.stolenHits > 0 && hit.finalDamage > 0) { s.stolenHits--; add(s.stolenAttack, '반쪽짜리 약탈'); }
    if (has(user, 'comboSheath') && hit.comboHitCount > 1) { add(s.sheathDamage, '미완성 검무'); s.sheathDamage = 0; }
    if (extra.isBasic) {
        if (s.feverDamage) { add(s.feverDamage, '열병의 박자'); s.feverDamage = 0; }
        add(extra.mechanicsFixed, '벗어 던진 성벽');
        if (has(user, 'rustPendulum')) { add(s.rustDamage, '녹슨 진자'); s.rustDamage = 0; }
        if (s.harvest) { add(s.harvest, '종말의 수확'); s.harvest = 0; }
    }
}
function afterHit(user, stats, extra, hit) {
    if (!active(user) || hit.finalDamage <= 0) return;
    const s = state(user), e = expedition(user), run = user.paradise, dot = isDot(extra), manual = direct(extra);
    if (!dot && !manual) return;
    const kind = dot ? 'dot' : extra.isBasic ? 'basic' : 'skill';
    s.damageKinds = [...new Set([...(s.damageKinds || []), kind])];
    if (has(user, 'collectorTrinity') && hit.criticalCount) {
        s.criticalKinds = [...new Set([...(s.criticalKinds || []), kind])];
        if (['basic', 'skill', 'dot'].every(value => s.criticalKinds.includes(value))) relicPrize(user, 'collectorTrinity');
    }
    if (dot) {
        const n = count(s, 'dotHits');
        if (has(user, 'feverPitch') && n % 3 === 0) s.feverDamage = Math.min(stats.atk * 5, hit.finalDamage * 3);
        if (has(user, 'dotSabbatical') && n === 8) {
            skillEntries(user).filter(skill => !ultimate(user, skill.name)).forEach(skill => reduce(user, skill.name, Infinity));
            s.guard = true; notice(extra, '여덟 번째 안식 · 일반 스킬 초기화');
        }
        if (relic(user, 'alchemistFlask') && n % 5 === 0) { corridor().heal(user, .07, .14); shield(user, 'alchemistFlask', stats.hp * .14, 10); }
        if (has(user, 'meltingArmor') && n % 3 === 0) s.meltReady = true;
        if (has(user, 'emberBattery') && n % 5 === 0) corridor().heal(user, 0, .10);
        if (has(user, 'coagulation') && n % 4 === 0) shield(user, 'coagulation', stats.hp * .08, 6);
        if (has(user, 'anesthetic') && n % 3 === 0) s.anesthetic = true;
        if (has(user, 'putrefaction') && n % 4 === 0) reduceLongest(user, 3000);
        if (has(user, 'rustPendulum')) s.rustDamage = Math.min(stats.atk * 5, Number(s.rustDamage || 0) + hit.finalDamage * .30);
        if (has(user, 'malignantHarmony') && extra.dotTypes >= 2 && !s.harmonyUsed && run.enemy.hp > 0) {
            s.harmonyUsed = true; addDot(user, 'harmony', '악성 합창', stats.atk * .50 * (1 + Number(stats.dotDamage || 0)), 5);
        }
        if (has(user, 'plaguePact') && n === 12) rewardBonus(user, 'plaguePact', .03, .30);
        if (run.enemy.hp <= 0) {
            if (has(user, 'contagiousAsh')) e.carriedAsh = hit.finalDamage * .40;
            if (has(user, 'funeralInterest') && count(e, 'dotKills') % 3 === 0) cardContract(user, '장례 보험금', 7);
        }
        return;
    }
    if (has(user, 'dopamineAddiction') && hit.criticalCount > 0) rewardBonus(user, 'dopamineAddiction', hit.criticalCount * .03, .30, extra);
    if (has(user, 'mercyLedger') && !hit.criticalCount && count(s, 'mercyHits') % 5 === 0) { corridor().heal(user, .15); s.guard = true; }
    if (has(user, 'shieldReforge') && s.reforgeHits != null && !s.reforgeUsed && ++s.reforgeHits >= 2) {
        s.reforgeUsed = true; shield(user, 'shieldReforge', stats.hp * .40, 20);
    }
    if (relic(user, 'emberSeed') && !s.emberSeedUsed && run.enemy.hp > 0) {
        s.emberSeedUsed = true; addDot(user, 'emberSeed', '잿불 씨앗', stats.atk * .72 * (1 + Number(stats.dotDamage || 0)), 5);
    }
    if (has(user, 'memoryTheft') && !s.theftUsed && extra.paradiseEnemyHpBefore > run.enemy.maxHp * .50 && run.enemy.hp <= run.enemy.maxHp * .50) {
        s.theftUsed = true; s.stolenAttack = run.enemy.atk; s.stolenHits = 3; notice(extra, '반쪽짜리 약탈 · 적의 공격력 획득');
    }
    if (has(user, 'alternatingWaltz')) {
        s.waltzCount = s.lastKind && s.lastKind !== kind ? Number(s.waltzCount || 1) + 1 : 1;
        if (s.waltzCount >= 3) { s.waltzCount = 0; s.waltzReady = true; }
    }
    if (has(user, 'barrierBloom') && !s.bloomUsed && shields.summary(user.field, Date.now()).amount > 0 && count(s, 'wardAttacks') >= 3) {
        s.bloomUsed = true; shield(user, 'barrierBloom', stats.hp * .20, 12);
    }
    if (run.enemy.hp > 0) {
        const dotScale = 1 + Number(stats.dotDamage || 0);
        if (extra.isBasic && has(user, 'venomNeedle')) addDot(user, 'needle', '독 묻은 바늘', stats.atk * .30 * dotScale, 3);
        if (extra.isSkill && has(user, 'cinderScript')) addDot(user, 'cinder', '불씨 필사본', hit.finalDamage * .05, 4, 2000, true);
        if (has(user, 'sourRain') && s.lastKind && s.lastKind !== kind) addDot(user, 'acid', '산성 교차로', stats.atk * .35 * dotScale, 3);
        if (has(user, 'delayedWound') && count(s, 'woundAttacks') % 3 === 0) addDot(user, 'wound', '늦게 도착한 상처', stats.atk * 1.50 * dotScale, 1);
        if (has(user, 'bleedLedger') && hit.criticalCount) {
            const stacks = Math.min(5, Number(s.dots?.ledger?.stacks || 0) + 1);
            addDot(user, 'ledger', '붉은 장부', stats.atk * .15 * stacks * dotScale, 4); s.dots.ledger.stacks = stacks;
        }
    }
    s.lastKind = kind;
    if (extra.isBasic) {
        if (has(user, 'afterglowThread') && dots(user).length && Number(s.extended || 0) < 10000) { extendDots(user, 2000); count(s, 'extended', 2000); }
        if (has(user, 'emptyHands') && corridor().getResources(user).mp === 0 && Number(s.emptyUses || 0) < 2) { count(s, 'emptyUses'); corridor().heal(user, 0, .20); }
        if (s.encoreBasics > 0) {
            s.encoreBasics--; const now = Date.now();
            rpg().getUltimateSkills(user).forEach(entry => reduce(user, entry.skill.name, Math.max(0, Number(user.field.skillCooldowns[entry.skill.name] || 0) - now) * .10));
        }
        if (s.triadReady) { reduce(user, s.triadReady, Infinity); notice(extra, '삼색 주문서 · ' + s.triadReady + ' 재사용'); delete s.triadReady; }
        if (s.firstSpell && !s.memoryUsed && count(s, 'memoryBasics') >= 3) {
            s.memoryUsed = true; s.freeNamed = s.firstSpell; reduce(user, s.firstSpell, Infinity); notice(extra, '첫 주문의 기억 · ' + s.firstSpell + ' 재사용');
        }
    }
    const combos = Math.max(0, Number(hit.comboHitCount || 1) - 1), before = Number(s.comboHits || 0), total = count(s, 'comboHits', combos);
    if (has(user, 'comboSavings')) s.savedCombos = Math.min(6, Number(s.savedCombos || 0) + combos);
    if (has(user, 'comboRoulette') && extra.isBasic) { if (combos === 1) corridor().heal(user, .15); else if (combos >= 2) s.guard = true; }
    const crossed = n => Math.floor(total / n) > Math.floor(before / n);
    if (has(user, 'comboEncore') && extra.isBasic && !combos) s.encoreReady = true;
    if (has(user, 'comboMeter') && crossed(6)) s.meterReady = true;
    if (has(user, 'comboRelay') && combos) reduceLongest(user, Math.min(3000, combos * 500));
    if (has(user, 'comboSheath') && extra.isBasic && !combos) s.sheathDamage = Math.min(stats.atk * 5, Number(s.sheathDamage || 0) + hit.finalDamage * .50);
    if (has(user, 'comboWard') && crossed(3)) shield(user, 'comboWard', stats.hp * .10, 8);
    if (has(user, 'comboBleed') && combos && run.enemy.hp > 0) {
        const last = (hit.hitDetails || []).filter(detail => detail.isComboHit).at(-1);
        if (last) addDot(user, 'comboBleed', '마지막 칼날', last.damage * .20, 3, 2000, true);
    }
    if (has(user, 'comboEscrow') && crossed(5)) s.freeAny = true;
    if (has(user, 'comboBalance')) { if (extra.isBasic && !combos) corridor().heal(user, .03); if (crossed(3)) corridor().heal(user, 0, .05); }
    if (has(user, 'comboRupture') && combos >= 2) s.ruptureReady = true;
    if (has(user, 'comboJackpot') && combos >= 2 && combos + 1 >= 2 + Math.max(0, Math.floor(Number(stats.maxCmb || 0))) && count(s, 'maxCombos') >= 3) relicPrize(user, 'comboJackpot');
}
function incomingMultiplier(user) {
    if (!active(user)) return 1;
    const s = state(user);
    if (s.guard) { s.guard = false; return 0; }
    if (s.anesthetic) { s.anesthetic = false; return .50; }
    return 1;
}
function onDamage(user, stats, absorbed, lostHp, shieldBefore, extra) {
    if (!active(user)) return;
    const s = state(user), broken = shieldBefore > 0 && absorbed > 0 && shields.summary(user.field, Date.now()).amount <= 0;
    if (absorbed > 0) {
        s.absorbedTotal = Number(s.absorbedTotal || 0) + absorbed;
        if (has(user, 'shieldBattery')) {
            s.battery = Number(s.battery || 0) + absorbed;
            while (s.battery >= stats.hp * .10 && Number(s.batteryUses || 0) < 5) {
                s.battery -= stats.hp * .10; count(s, 'batteryUses'); corridor().heal(user, 0, .05);
            }
        }
        if (has(user, 'mirrorAegis') && count(s, 'absorptions') % 3 === 0) s.guard = true;
        if (has(user, 'shieldThorns')) {
            const dot = dots(user).find(dot => dot.key === 'thorns');
            const stored = Math.min(stats.hp, absorbed * .30 + (dot ? dot.damage * dot.ticks : 0));
            addDot(user, 'thorns', '가시 고치', stored / 3, 3, 2000, true);
        }
    }
    if (broken) {
        if (relic(user, 'guardianClasp') && !s.claspUsed) { s.claspUsed = true; corridor().heal(user, .14); }
        if (has(user, 'shieldFuse') && !s.fuseUsed) { s.fuseUsed = true; addDot(user, 'shieldFuse', '깨진 방패의 도화선', Math.min(stats.hp * 2, s.absorbedTotal * 2) / 4, 4, 2000, true); }
        if (has(user, 'shieldReforge') && s.reforgeHits == null) s.reforgeHits = 0;
        if (has(user, 'glassBastion')) { s.glassReady = true; notice(extra, '깨지는 순간의 광채 · 반격 준비'); }
        if (has(user, 'shieldCooldown') && !s.breakReset) { s.breakReset = true; reduceLongest(user, Infinity, true); notice(extra, '성벽 붕괴 신호 · 스킬 초기화'); }
    }
    if (lostHp > 0 && corridor().getResources(user).hp > 0) {
        if (relic(user, 'duelGlove')) s.duelReady = true;
        if (has(user, 'shieldStitch') && Number(s.stitches || 0) < 3) { count(s, 'stitches'); shield(user, 'shieldStitch', stats.hp * .10, 6); }
        if (has(user, 'emergencyExit') && !s.secondWind && corridor().getResources(user).hp <= stats.hp * .30) {
            s.secondWind = true; shield(user, 'emergencyExit', stats.hp * .25, 8); skills(user).forEach(skill => reduce(user, skill.name, Infinity));
            notice(extra, '비상 탈출구 · 보호막 획득 · 습득 스킬 초기화');
        }
    }
}
function survive(user, hp) {
    if (hp > 0 || !has(user, 'toxicInsurance') || state(user).toxicSaved || !dots(user).length) return hp;
    consumeDots(user); state(user).toxicSaved = true;
    user.paradise.history.unshift({ floor: user.paradise.floor, text: '독과 맺은 생명보험 · 지속 피해를 지우고 HP 1로 생존했습니다.' });
    return 1;
}
module.exports = { active, has, dots, consumeDots, addDot, hasTicks, takeTicks, onBattle, onVictory, skills, skillView, payment, onSkill, afterCooldown, activeSkill, prepareAttack, modifyHit, afterHit, incomingMultiplier, onDamage, survive };
