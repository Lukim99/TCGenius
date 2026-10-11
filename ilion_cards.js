'use strict';

const CARD_ID = 14;
const cards = [
    { name: '삼두사', seconds: 16, desc: '추가 피해 +13%', stats: { extraDamage: .13 } },
    { name: '광기', seconds: 30, desc: '행동 쿨타임 -0.5초' },
    { name: '부식', seconds: 30, desc: '공격 시 30% 확률로 대상이 5초간 자신에게 받는 피해 +10%' },
    { name: '환희', desc: '제외 시 모든 스킬의 남은 재사용 대기시간 10% 감소' },
    { name: '뒤틀린 운명', seconds: 4, desc: '스킬 피해가 50% 확률로 +40%' },
    { name: '유령', seconds: 16, desc: '회피 확률 +10%', stats: { avd: .10 } },
    { name: '도태', seconds: 4, desc: '모든 공격 치명타 확률 100%, 치명타 피해 +50%', stats: { critMul: .50 } },
    { name: '균형', desc: '제외 시 즉시 공격력의 100% 피해' },
    { name: '심판', seconds: 4, desc: '최종 피해 +50%', stats: { finalDamage: .50 } },
    { name: '달', seconds: 30, desc: '스킬 재사용 대기시간 -20%', stats: { cooldown: .20 } },
    { name: '별', seconds: 12, desc: '마나 소모량 -100%' },
    { name: '광대', seconds: 8, desc: '연격 확률 +15%', stats: { cmb: .15 } },
    { name: '재상', seconds: 12, desc: '치명타 확률 +20%', stats: { crit: .20 } },
    { name: '제후', seconds: 4, desc: '일반 공격 피해 +50%', stats: { afterBasic: .50 } }
];
const description = cards.map(card => card.name + (card.seconds ? ' (' + card.seconds + '초)' : '') + ': ' + card.desc).join('\n');

function state(runtime) {
    if (!runtime.ilion) runtime.ilion = { deck: [], balanceHits: 0 };
    return runtime.ilion;
}

function active(runtime, name, now) {
    return (runtime?.ilion?.deck || []).some(card => card.name === name && (!card.until || card.until > now));
}

function exclude(runtime, cooldowns, motherStage, now) {
    const s = state(runtime), card = s.deck.shift();
    if (!card) return null;
    if (card.name === '부식') delete s.corrosion;
    if (card.name === '환희') for (const name of Object.keys(cooldowns || {})) {
        cooldowns[name] = now + Math.max(0, Number(cooldowns[name]) - now) * .90;
    }
    if (card.name === '균형') s.balanceHits = Number(s.balanceHits || 0) + 1;
    if (motherStage > 0) s.motherCritUntil = now + 5000;
    return card.name;
}

function draw(runtime, cooldowns, deckStage, motherStage, now, rng = Math.random) {
    const s = state(runtime);
    // 추첨 직전 덱을 기준으로 제외한다. 밀려날 카드도 다시 뽑을 수 없다.
    const available = cards.filter(card => !s.deck.some(held => held.name === card.name));
    const card = available[Math.min(available.length - 1, Math.floor(rng() * available.length))];
    const removed = [];
    while (s.deck.length >= (deckStage > 0 ? 3 : 2)) removed.push(exclude(runtime, cooldowns, motherStage, now));
    const excluded = removed.length ? removed.join(', ') : null;
    s.deck.push({ name: card.name, until: card.seconds ? now + card.seconds * 1000 : 0 });
    return { name: card.name, excluded, text: '카드 뽑기: ' + card.name + (excluded ? ' / ' + excluded + ' 제외' : '') };
}

function excludeAll(runtime, cooldowns, motherStage, now) {
    const excluded = [];
    while (state(runtime).deck.length) excluded.push(exclude(runtime, cooldowns, motherStage, now));
    return excluded;
}

function applyStats(stats, runtime, slots, now) {
    if (!stats.ilion) return stats;
    stats.ilionForceCritical = false;
    for (const held of runtime?.ilion?.deck || []) {
        if (held.until && held.until <= now) continue;
        const card = cards.find(card => card.name === held.name);
        for (const [key, value] of Object.entries(card?.stats || {})) stats[key] = Number(stats[key] || 0) + value;
    }
    stats.atk = Math.round(Number(stats.atk || 0) * (1 + Number(slots?.ilionDeckAttack || 0) * (runtime?.ilion?.deck || []).length));
    if (active(runtime, '도태', now)) { stats.crit = 1; stats.ilionForceCritical = true; }
    if (Number(runtime?.ilion?.motherCritUntil || 0) > now) stats.crit = Number(stats.crit || 0) + .10;
    return stats;
}

function mpMultiplier(stats, runtime, skillName, now) {
    if (!stats.ilion) return 1;
    if (active(runtime, '별', now)) return 0;
    return skillName === '헤즈업' ? Math.max(0, 1 - .10 - .05 * Number(stats.ilionStar || 0)) : 1;
}

function actionReduction(stats, runtime, now) {
    return stats.ilion && active(runtime, '광기', now) ? 500 : 0;
}

function prepareAttack(stats, runtime, slots, targetKey, ordinary, extra, now, rng = Math.random) {
    if (stats.ilionForceCritical) extra.forceCritical = true;
    if (extra.ilionPrepared) return;
    extra.ilionPrepared = true;
    const direct = !(extra.summonAttack || extra.dotAttack || extra.counterDamage || extra.isBotAutoAttack || extra.cardDamage);
    if (direct && Number(slots?.firstStrikeDamage || 0) > 0) {
        const ready = ordinary ? runtime.firstStrikeAt == null || now >= runtime.firstStrikeAt + 20000 : runtime.firstStrikeTarget !== targetKey;
        if (ready) {
            extra.finalDamageBonus = Number(extra.finalDamageBonus || 0) + slots.firstStrikeDamage;
            if (ordinary) runtime.firstStrikeAt = now;
            else runtime.firstStrikeTarget = targetKey;
            extra.firstStrike = true;
        }
    }
    if (!stats.ilion) return;
    const s = state(runtime);
    if (direct && active(runtime, '부식', now) && rng() < .30) s.corrosion = { targetKey, until: now + 5000 };
    if (s.corrosion?.targetKey === targetKey && s.corrosion.until > now) extra.finalDamageBonus = Number(extra.finalDamageBonus || 0) + .10;
    if (extra.isSkill && !extra.cardDamage && active(runtime, '뒤틀린 운명', now) && rng() < .50) extra.damageBonusMul = Number(extra.damageBonusMul || 0) + .40;
    if (s.balanceHits > 0) { extra.ilionBalanceHits = s.balanceHits; s.balanceHits = 0; }
}

function autoDrawAt(runtime, stage, startedAt) {
    if (stage <= 0) { if (runtime.ilion) delete runtime.ilion.autoDrawAt; return null; }
    const s = state(runtime);
    if (s.autoDrawAt == null) s.autoDrawAt = startedAt + Math.max(1, 11 - stage) * 1000;
    return s.autoDrawAt;
}

function tick(runtime, cooldowns, stage, motherStage, startedAt, now, rng) {
    const at = autoDrawAt(runtime, stage, startedAt);
    if (at == null || now < at) return null;
    const result = draw(runtime, cooldowns, stage, motherStage, now, rng);
    state(runtime).autoDrawAt = now + Math.max(1, 11 - stage) * 1000;
    return result;
}

function views(runtime, now) {
    const deck = runtime?.ilion?.deck || [];
    return deck.map((held, i) => ({ name: held.name, until: held.until, active: !held.until || held.until > now,
        label: '덱 ' + (i + 1) + ' · ' + held.name + (held.until && held.until <= now ? ' (효과 종료)' : ''),
        desc: cards.find(card => card.name === held.name)?.desc || '' }));
}

module.exports = { CARD_ID, cards, description, active, draw, excludeAll, applyStats, mpMultiplier, actionReduction, prepareAttack, autoDrawAt, tick, views };
