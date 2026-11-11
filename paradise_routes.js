'use strict';

const { RELICS } = require('./paradise_content');
const shields = require('./combat_shields');
const cardContracts = require('./paradise_contracts');
const rpg = () => require('./rpgenius');
const corridor = () => require('./paradise');
const mechanics = () => require('./paradise_mechanics');
const pick = (list, random) => list[Math.min(list.length - 1, Math.floor(random() * list.length))];
const direct = extra => !extra.dotAttack && !extra.paradiseDot && !extra.summonAttack && !extra.isBotAutoAttack;
const dot = extra => !!extra.paradiseDot;
const g = (id, name, rule, reward, options = {}) => ({ id, name, rule, reward, kinds: ['normal', 'elite'], tone: 'amber', sigil: 'sword', ...options });
const GIMMICKS = [
    g('bloodSeal', '피로 봉인한 계약', '적의 HP가 35%, 공격력이 25% 증가합니다.', '6성 일반 카드 계약을 획득합니다.', { enemy: { hp: 1.35, atk: 1.25 }, prize: { star: 6, type: '일반' }, tone: 'crimson' }),
    g('twinHunt', '둘을 위한 칼날', '공격력이 50% 증가합니다. 적 두 마리와 연속으로 싸웁니다.', '모두 쓰러뜨리면 종료 보상이 5%p 증가합니다.', { effects: { atk: .50 }, sequence: 2, prize: { bonus: .05 } }),
    g('gildedElite', '황금 사냥감', '엘리트의 HP와 공격력이 20% 증가합니다.', '고급 유물 세 개 중 하나를 선택합니다.', { kinds: ['elite'], enemy: { hp: 1.20, atk: 1.20 }, prize: { relic: 'advanced' } }),
    g('ashOnly', '재만 남는 길', '적의 HP가 절반이 되며 지속 피해만 받습니다. 직접 공격하면 1초마다 공격력의 40%만큼 5회 피해를 입히는 불씨를 남깁니다.', '지속 피해 증강 중 하나를 선택합니다.', { enemy: { hp: .50 }, category: 'dot', tone: 'crimson', sigil: 'flame' }),
    g('silentArena', '침묵의 검투장', '스킬을 봉인합니다. 일반 공격 피해가 2배가 됩니다.', '연격 증강 중 하나를 선택합니다.', { effects: { basicDamage: 1 }, category: 'combo' }),
    g('alternatingGate', '엇박자의 문', '직접 공격의 피해가 75% 증가합니다. 같은 종류의 공격을 연속 사용하면 피해를 입히지 못합니다.', '5성 전직 카드 계약을 획득합니다.', { prize: { star: 5, type: '전직' }, tone: 'cyan' }),
    g('thirdSeal', '세 번의 봉인', '직접 공격은 세 번째마다 피해를 3배로 입힙니다. 나머지 두 번은 피해를 입히지 못합니다.', '종료 보상이 5%p 증가합니다.', { prize: { bonus: .05 }, tone: 'violet' }),
    g('glassVault', '유리 금고', '적이 최대 HP의 50%만큼 보호막을 얻습니다. 보호막을 깨면 다음 직접 공격의 피해가 3배가 됩니다.', '일반 유물 세 개 중 하나를 선택합니다.', { prize: { relic: 'normal' }, tone: 'cyan', sigil: 'shield' }),
    g('criticalLock', '치명적인 자물쇠', '적의 HP가 25% 감소하며 치명타만 받습니다. 직접 공격이 세 번 연속 치명타에 실패하면 다음 직접 공격이 확정 치명타가 됩니다.', '치명타 증강 중 하나를 선택합니다.', { enemy: { hp: .75 }, category: 'critical', tone: 'violet' }),
    g('burningFuse', '타오르는 도화선', '직접 공격 피해의 25%를 1초 간격의 지속 피해 3회로 나눕니다. 적의 공격력이 20% 증가합니다.', '최대 HP와 MP의 25%를 회복합니다.', { enemy: { atk: 1.20 }, prize: { heal: .25 }, tone: 'crimson', sigil: 'flame' }),
    g('bloodFuel', '피의 연료', '직접 공격마다 현재 HP의 5%를 바쳐 피해를 2배로 입힙니다. HP는 1 아래로 감소하지 않습니다.', '최대 HP와 MP의 25%를 회복합니다.', { prize: { heal: .25 }, tone: 'crimson' }),
    g('manaSpring', '마나 샘의 파수꾼', '적의 HP가 40% 증가합니다. 일반 공격마다 MP를 20% 회복하고 가장 긴 쿨타임을 2초 줄입니다.', '5성 전직 카드 계약을 획득합니다.', { enemy: { hp: 1.4 }, prize: { star: 5, type: '전직' }, tone: 'cyan' }),
    g('reversalSpear', '역전의 창', '적의 첫 두 공격은 피해가 50% 증가합니다. 세 번째 공격을 무효화하고 다음 직접 공격의 피해를 3배로 만듭니다.', '방어 증강 중 하나를 선택합니다.', { category: 'defense', tone: 'crimson', sigil: 'shield' }),
    g('crookedClock', '비껴치는 시계', '일반 공격은 적의 다음 공격을 1초 늦춥니다. 최대 4회 발동합니다. 스킬은 피해가 2배가 되지만 적의 공격을 1초 앞당깁니다.', '종료 보상이 5%p 증가합니다.', { prize: { bonus: .05 }, tone: 'cyan' }),
    g('wardDuel', '성벽 대결', '60초 동안 최대 HP의 50%만큼 보호막을 얻습니다. 보호막이 있으면 피해가 80% 증가하고 없으면 40% 감소합니다. 적의 HP가 25% 증가합니다.', '보호막 증강 중 하나를 선택합니다.', { enemy: { hp: 1.25 }, category: 'shield', tone: 'cyan', sigil: 'shield' }),
    g('cleanHunt', '흠 없는 추격', '적의 공격력이 25% 증가합니다.', 'HP 피해 없이 승리하면 일반 유물을 선택합니다. 실패하면 HP를 10% 회복합니다.', { enemy: { atk: 1.25 }, tone: 'cyan' }),
    g('fadingContract', '꺼져 가는 계약', '적의 HP가 30% 증가합니다. 계약의 유효 시간은 25초입니다.', '시간 안에 승리하면 6성, 늦으면 5성 일반 카드 계약을 획득합니다.', { cardContract: true, enemy: { hp: 1.30 }, tone: 'violet' }),
    g('secondHalf', '후반전의 왕', '적의 HP가 50% 증가합니다. 적의 첫 세 공격은 피해가 절반이 됩니다. 이후 가하는 피해가 2배가 됩니다.', '종료 보상이 5%p 증가합니다.', { enemy: { hp: 1.50 }, prize: { bonus: .05 } }),
    g('borrowedFinale', '빌려 온 피날레', '궁극기 피해가 2배가 됩니다. 첫 궁극기는 쿨타임이 없으며 이후 받는 피해가 20% 증가합니다.', '궁극기 증강 중 하나를 선택합니다.', { category: 'ultimate', ultimate: true, tone: 'violet' }),
    g('comboToll', '연격 통행료', '일반 공격이 최소 3연격이 되는 대신 피해가 40% 감소합니다. 적의 HP가 30% 증가합니다.', '연격 증강 중 하나를 선택합니다.', { enemy: { hp: 1.30 }, category: 'combo' }),
    g('vengeance', '맞바꾼 한 방', '적의 공격력이 25% 증가합니다. 잃은 HP를 최대 HP의 50%까지 저장하고 다음 일반 공격에 3배의 고정 피해로 돌려줍니다.', '6성 일반 카드 계약을 획득합니다.', { enemy: { atk: 1.25 }, prize: { star: 6, type: '일반' }, tone: 'crimson' }),
    g('lastLight', '마지막 불빛', '현재 HP를 최대 HP의 30% 이하로 낮추고 15초 동안 80%의 보호막을 얻습니다. HP가 30% 이하이면 직접 공격의 피해가 2배가 됩니다.', 'HP와 MP를 모두 회복합니다.', { prize: { heal: 1 }, tone: 'crimson', sigil: 'shield' }),
    g('revenant', '되살아난 수문장', '적이 한 번 부활합니다. 최대 HP의 40%를 회복하고 공격력이 30% 증가합니다.', '일반 유물 세 개 중 하나를 선택합니다.', { prize: { relic: 'normal' }, tone: 'violet' }),
    g('coinDuel', '앞면의 승부', '직접 공격마다 동전을 던집니다. 피해가 50% 확률로 2.5배, 나머지는 25%가 됩니다.', '25% 확률로 6성 각성, 나머지는 5성 일반 카드 계약을 획득합니다.', { cardContract: true, tone: 'amber', sigil: 'gambler' }),
    g('eventSeal', '빈 방의 봉인', '입장할 때 현재 HP의 10%를 바칩니다.', '이벤트를 마치면 종료 보상이 5%p 증가합니다.', { kinds: ['event'], hpCost: .10, prize: { bonus: .05 }, tone: 'violet', sigil: 'contract' }),
    g('eventLantern', '휴식의 등불', '입장할 때 뒤틀림이 10 증가합니다.', '최대 HP와 MP의 20%를 즉시 회복합니다.', { kinds: ['event'], tone: 'cyan', sigil: 'shield' }),
    g('eventAmbush', '대가 있는 보물지도', '이벤트를 마친 뒤 공격력이 30% 증가한 일반 몬스터와 추가로 싸웁니다.', '추가 전투에서 승리하면 일반 유물을 선택합니다.', { kinds: ['event'], enemy: { atk: 1.30 }, prize: { relic: 'normal' }, tone: 'crimson' }),
    g('eventClock', '시간을 먹는 문', '입장할 때 남은 탐험 시간을 30초 바칩니다.', '이벤트를 마치면 종료 보상이 8%p 증가합니다.', { kinds: ['event'], prize: { bonus: .08 }, tone: 'violet' }),
    g('eventPurity', '정화의 문턱', '입장할 때 현재 MP를 모두 바칩니다.', '뒤틀림이 즉시 25 감소합니다.', { kinds: ['event'], tone: 'cyan', sigil: 'clarity' }),
    g('eventDeed', '봉인된 증서', '입장할 때 현재 HP의 25%를 바칩니다.', '이벤트를 마치면 카드 계약을 개봉합니다. 5성 일반 85%, 6성 전직 13%, 8성 일반 2%입니다.', { cardContract: true, kinds: ['event'], hpCost: .25, tone: 'amber', sigil: 'contract' })
];
const byId = new Map(GIMMICKS.map(gimmick => [gimmick.id, gimmick]));
function context(user) {
    return corridor().active(user) && user.paradise.mode !== 'hell' ? user.paradise.routeEncounter : null;
}
function combat(user) { return user.paradise?.phase === 'combat' ? context(user) : null; }
function eligible(user, kind) {
    const run = user.paradise, available = corridor().availableAugments(user);
    return GIMMICKS.filter(gimmick => gimmick.kinds.includes(kind)
        && (!gimmick.category || ['silver', 'gold', 'prismatic', 'cursed'].some(rarity => available.filter(a => a.category === gimmick.category && a.rarity === rarity).length >= 3))
        && (!gimmick.ultimate || rpg().getUltimateSkills(user).length > 0)
        && (!gimmick.prize?.relic || RELICS.filter(r => !r.special && r.rarity === gimmick.prize.relic && !run.relics.includes(r.id)).length >= 3)
        && (gimmick.id !== 'eventClock' || corridor().remainingTime(run) > 60000)
        && (gimmick.id !== 'criticalLock' || !run.acquired.dopamineAddiction)
        && (!['alternatingGate', 'borrowedFinale', 'crookedClock'].includes(gimmick.id) || !run.acquired.solitaryIktae));
}
function roll(user, kind, random) {
    if (random() >= .20) return null;
    return cardContracts.pick(eligible(user, kind), random)?.id || null;
}
function describe(id) {
    const gimmick = byId.get(id);
    if (!gimmick) return null;
    const { name, rule, reward, tone, sigil } = gimmick;
    return { id, name, rule, reward, tone, sigil };
}
function enter(user, route) {
    const run = user.paradise, gimmick = byId.get(route.gimmick);
    delete run.routeEncounter;
    if (!gimmick) return;
    const s = run.routeEncounter = { id: gimmick.id, startedAt: Date.now(), wins: 0, attacks: 0, incoming: 0 };
    const resources = corridor().getResources(user);
    if (gimmick.hpCost) resources.hp = Math.max(1, Math.floor(resources.hp * (1 - gimmick.hpCost)));
    if (s.id === 'eventLantern') { run.distortion = Math.min(100, run.distortion + 10); corridor().heal(user, .20, .20); }
    if (s.id === 'eventPurity') { resources.mp = 0; run.distortion = Math.max(0, run.distortion - 25); }
    if (s.id === 'eventClock') run.clock = { ...run.clock, remainingMs: Math.max(0, corridor().remainingTime(run) - 30000), updatedAt: Date.now() };
    run.history.unshift({ floor: run.floor, text: gimmick.name + ', ' + gimmick.rule });
}
function effects(run) { return run.mode !== 'hell' && run.phase === 'combat' ? byId.get(run.routeEncounter?.id)?.effects || {} : {}; }
function scaleEnemy(enemy, id, ambushStarted = false) {
    if (id === 'eventAmbush' && !ambushStarted) return;
    const gimmick = byId.get(id);
    for (const [key, scale] of Object.entries(gimmick?.enemy || {})) enemy[key] = Math.max(1, Math.round(enemy[key] * scale));
    enemy.maxHp = enemy.hp;
}
function onBattle(user) {
    const s = combat(user); if (!s) return;
    const run = user.paradise, stats = rpg().calculateUserStats(user);
    if (s.id === 'glassVault') shields.grant(run.enemy, { source: 'route:glassVault', caster: '', amount: Math.round(run.enemy.maxHp * .50) });
    if (['wardDuel', 'lastLight'].includes(s.id) && !stats.disableShield) shields.grant(user.field, { source: 'route:' + s.id, caster: user.name, amount: Math.round(stats.hp * (s.id === 'wardDuel' ? .50 : .80)), expiresAt: Date.now() + (s.id === 'wardDuel' ? 60000 : 15000) });
    if (s.id === 'lastLight') corridor().getResources(user).hp = Math.max(1, Math.min(corridor().getResources(user).hp, Math.floor(stats.hp * .30)));
}
function skillBlocked(user) { return combat(user)?.id === 'silentArena' ? '침묵의 검투장에서는 스킬을 사용할 수 없습니다.' : null; }
function prepareAttack(user, extra) {
    const s = combat(user); if (!s || !direct(extra)) return;
    if (s.id === 'criticalLock' && s.misses >= 3) extra.forceCritical = true;
    if (s.id === 'comboToll' && extra.isBasic && !extra.hitCount) extra.comboHitCount = Math.max(3, Number(extra.comboHitCount || 1));
}
function onSkill(user, name) {
    const s = combat(user); if (!s) return;
    const ultimate = rpg().getUltimateSkills(user).some(entry => entry.skill.name === name);
    if (s.id === 'borrowedFinale' && ultimate && !s.ultimateUsed) { s.ultimateUsed = true; s.freeCooldown = true; }
    if (s.id === 'crookedClock') user.field.nextEnemyAttackAt = Math.max(Date.now(), user.field.nextEnemyAttackAt - 1000);
}
function cooldown(user) {
    const s = combat(user);
    if (s?.freeCooldown) { s.freeCooldown = false; return 0; }
    return 1;
}
function notify(extra, message) { extra.notice = [extra.notice, message].filter(Boolean).join(' / '); }
function modifyHit(user, stats, extra, hit, random = Math.random) {
    const s = combat(user); if (!s) return;
    const manual = direct(extra), basic = manual && extra.isBasic, run = user.paradise;
    const scale = multiplier => {
        hit.finalDamage = Math.max(0, Math.round(hit.finalDamage * multiplier));
        for (const detail of hit.hitDetails || []) { detail.damage = Math.max(0, Math.round(detail.damage * multiplier)); if (detail.fixedDamage) detail.fixedDamage = Math.round(detail.fixedDamage * multiplier); }
    };
    if (manual) {
        s.attacks++;
        if (s.id === 'bloodFuel') { const resources = corridor().getResources(user); resources.hp = Math.max(1, resources.hp - Math.floor(resources.hp * .05)); scale(2); }
        if (s.id === 'alternatingGate') { const kind = basic ? 'basic' : 'skill'; scale(s.lastKind === kind ? 0 : 1.75); s.lastKind = kind; }
        if (s.id === 'thirdSeal') scale(s.attacks % 3 === 0 ? 3 : 0);
        if (s.id === 'glassVault' && s.shattered) { scale(3); s.shattered = false; notify(extra, '유리 금고, 파쇄의 일격'); }
        if (s.id === 'criticalLock') s.misses = hit.criticalCount ? 0 : Number(s.misses || 0) + 1;
        if (s.id === 'burningFuse' && hit.finalDamage > 0) {
            mechanics().addDot(user, 'routeFuse:' + s.attacks, '타오르는 도화선', hit.finalDamage * .25 / 3, 3, 1000, true); scale(.75);
        }
        if (s.id === 'reversalSpear' && s.reversal) { scale(3); s.reversal = false; }
        if (s.id === 'crookedClock') {
            if (basic && Number(s.delays || 0) < 4) { s.delays = Number(s.delays || 0) + 1; user.field.nextEnemyAttackAt += 1000; }
            if (!basic) scale(2);
        }
        if (s.id === 'borrowedFinale' && rpg().getUltimateSkills(user).some(entry => entry.skill.name === extra.skillName)) scale(2);
        if (s.id === 'comboToll' && basic) scale(.60);
        if (s.id === 'vengeance' && basic && s.storedHp) {
            const amount = Math.round(s.storedHp * 3); s.storedHp = 0;
            hit.finalDamage += amount; (hit.hitDetails ||= []).push({ damage: amount, fixedDamage: amount, label: '맞바꾼 한 방' });
        }
        if (s.id === 'lastLight' && corridor().getResources(user).hp <= stats.hp * .30) scale(2);
        if (s.id === 'coinDuel') { const win = random() < .50; scale(win ? 2.5 : .25); notify(extra, win ? '앞면! 피해 2.5배' : '뒷면, 피해 25%'); }
    }
    if (s.id === 'wardDuel') scale(shields.summary(user.field, Date.now()).amount > 0 ? 1.8 : .6);
    if (s.id === 'secondHalf' && s.incoming >= 3) scale(2);
    // 모든 장비/증강 추가 피해까지 계산한 뒤 제한한다. 소환수나 고정 피해로 우회하지 않는다.
    if (s.id === 'ashOnly' && !dot(extra)) scale(0);
    if (s.id === 'criticalLock') {
        hit.hitDetails = (hit.hitDetails || []).filter(detail => detail.isCritical);
        hit.finalDamage = hit.hitDetails.reduce((sum, detail) => sum + detail.damage, 0);
    }
    if (shields.summary(run.enemy, Date.now()).amount > 0) {
        const result = shields.absorb(run.enemy, hit.finalDamage);
        scale(hit.finalDamage > 0 ? result.damage / hit.finalDamage : 0);
        extra.routeShieldAbsorbed = result.absorbed;
        if (s.id === 'glassVault' && result.broken.length) { s.shattered = true; notify(extra, '유리 금고, 보호막 파괴'); }
    }
    if (hit.finalDamage === 0 && !extra.routeShieldAbsorbed && manual) notify(extra, describe(s.id).name + ', 피해가 봉인되었습니다.');
}
function afterHit(user, stats, extra) {
    const s = combat(user); if (!s) return;
    const enemy = user.paradise.enemy;
    if (s.id === 'revenant' && enemy.hp <= 0 && !s.revived) {
        s.revived = true; enemy.hp = Math.max(1, Math.round(enemy.maxHp * .40)); enemy.atk = Math.round(enemy.atk * 1.30);
        enemy.recommendedPower = rpg().computeCombatPowerFromStats({ ...enemy, hp: enemy.maxHp }).total;
        if (user.field.elite) user.field.elite.hp = enemy.hp;
        notify(extra, '수문장이 부활했습니다!');
    }
    if (!direct(extra)) return;
    if (s.id === 'ashOnly' && enemy.hp > 0) mechanics().addDot(user, 'routeAsh', '재만 남는 길', stats.atk * .40 * (1 + Number(stats.dotDamage || 0)), 5, 1000);
    if (s.id === 'manaSpring' && extra.isBasic) {
        corridor().heal(user, 0, .20);
        const now = Date.now(), entry = Object.entries(user.field.skillCooldowns).filter(([, until]) => until > now).sort((a, b) => b[1] - a[1])[0];
        if (entry) user.field.skillCooldowns[entry[0]] = Math.max(now, entry[1] - 2000);
    }
}
function incoming(user, amount) {
    const s = combat(user); if (!s) return amount;
    s.incoming++;
    if (s.id === 'reversalSpear') {
        if (s.incoming <= 2) return Math.round(amount * 1.50);
        if (s.incoming === 3) { s.reversal = true; return 0; }
    }
    if (s.id === 'secondHalf' && s.incoming <= 3) return Math.round(amount * .50);
    if (s.id === 'borrowedFinale' && s.ultimateUsed) return Math.round(amount * 1.20);
    return amount;
}
function onDamage(user, stats, lostHp) {
    const s = combat(user); if (!s) return;
    if (lostHp > 0) s.damaged = true;
    if (s.id === 'vengeance') s.storedHp = Math.min(stats.hp * .50, Number(s.storedHp || 0) + lostHp);
}
function reflection(user, amount) {
    const s = combat(user);
    if (['ashOnly', 'criticalLock'].includes(s?.id)) return 0;
    if (s?.id === 'glassVault') {
        const result = shields.absorb(user.paradise.enemy, amount);
        if (result.broken.length) s.shattered = true;
        return result.damage;
    }
    return amount;
}
function complete(user, random = Math.random) {
    const s = context(user); if (!s) return;
    const run = user.paradise, gimmick = byId.get(s.id), prize = { ...gimmick.prize };
    if (s.id === 'fadingContract') Object.assign(prize, { star: Date.now() - s.startedAt <= 25000 ? 6 : 5, type: '일반' });
    if (s.id === 'cleanHunt') Object.assign(prize, s.damaged ? { healHp: .10 } : { relic: 'normal' });
    if (s.id === 'coinDuel') Object.assign(prize, random() < .25 ? { star: 6, type: '각성' } : { star: 5, type: '일반' });
    if (s.id === 'eventDeed') { const roll = random(); Object.assign(prize, roll < .85 ? { star: 5, type: '일반' } : roll < .98 ? { star: 6, type: '전직' } : { star: 8, type: '일반' }); }
    delete run.routeEncounter;
    const lines = [];
    if (prize.star) { const name = `${prize.star}성 ${prize.type} 카드`; run.contracts.push({ star: prize.star, type: prize.type, name }); lines.push(name + ' 계약 획득'); }
    if (prize.bonus) { run.contracts.push({ bonus: prize.bonus, name: gimmick.name + ', 종료 보상 +' + Math.round(prize.bonus * 100) + '%' }); lines.push('종료 보상 +' + Math.round(prize.bonus * 100) + '%p'); }
    if (prize.heal || prize.healHp) { corridor().heal(user, prize.heal || prize.healHp, prize.heal || 0); lines.push(run.effects.noHealing ? '회복 봉쇄' : prize.heal ? 'HP와 MP ' + Math.round(prize.heal * 100) + '% 회복' : 'HP 10% 회복'); }
    if (prize.relic) {
        run.relicPicksRemaining = Number(run.relicPicksRemaining || 0) + 1;
        (run.relicDraftRarities ||= []).push(prize.relic);
        lines.push((prize.relic === 'advanced' ? '고급' : '일반') + ' 유물 선택');
    }
    if (gimmick.category) { run.augmentCategory = gimmick.category; lines.push(gimmick.reward); }
    if (!lines.length) return;
    const text = gimmick.name + '\n' + lines.join('\n');
    run.history.unshift({ floor: run.floor, text });
    run.rewardReveal = { motif: 'contract', positive: true, text: [run.rewardReveal?.text, text].filter(Boolean).join('\n') };
}
function eventComplete(user, random) {
    const s = context(user);
    if (s?.id === 'eventAmbush' && !s.ambushStarted) {
        s.ambushStarted = true;
        corridor().startCombat(user, 'normal', null, random);
        return true;
    }
    complete(user, random);
    return false;
}
function view(user) {
    const s = context(user); if (!s) return null;
    let progress = null;
    if (s.id === 'twinHunt') progress = `${s.wins + 1} / 2 전투`;
    if (s.id === 'thirdSeal') progress = `봉인 ${s.attacks % 3} / 3`;
    if (s.id === 'fadingContract') progress = `계약 ${Math.max(0, Math.ceil((25000 - Date.now() + s.startedAt) / 1000))}초`;
    if (s.id === 'criticalLock') progress = `확정 치명타까지 ${Math.max(0, 3 - Number(s.misses || 0))}회`;
    if (s.id === 'revenant' && s.revived) progress = '부활한 수문장';
    return { ...describe(s.id), progress };
}
module.exports = { GIMMICKS, byId, eligible, roll, describe, enter, effects, scaleEnemy, onBattle, skillBlocked, prepareAttack, onSkill, cooldown, modifyHit, afterHit, incoming, onDamage, reflection, complete, eventComplete, view };
