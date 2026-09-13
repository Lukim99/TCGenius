const definitions = require('./DB/RPGenius/Awakening.json');
const characters = require('./DB/RPGenius/CharacterCards.json');

function valueAtStar(values, star) {
    if (!Array.isArray(values) || Number(star) < 4) return 0;
    return Number(values[Math.min(Number(star) - 4, values.length - 1)] || 0);
}

function getDefinition(card) {
    if (!card || card.type !== '각성') return null;
    const character = characters[Number(card.id)];
    return character ? definitions.find(entry => entry.name === character.name) || null : null;
}

function getPassive(card) {
    const def = getDefinition(card);
    if (!def || Number(card.star) < 4) return null;
    return { ...def.passive, value: valueAtStar(def.passive.values, card.star), attackValue: valueAtStar(def.passive.attackValues, card.star) };
}

function formatPassive(card) {
    const passive = getPassive(card);
    if (!passive) return '';
    const format = value => passive.type === 'flat' ? Number(value).toLocaleString('ko-KR') : (Math.round(value * 1000) / 10) + '%';
    return passive.desc.replace('${1}', format(passive.value)).replace('${2}', format(passive.attackValue));
}

function formatPassiveProgression(card) {
    const def = getDefinition(card);
    if (!def) return '';
    const passive = def.passive;
    const format = values => (values || []).map(value => passive.type === 'flat' ? Number(value).toLocaleString('ko-KR') : (Math.round(value * 1000) / 10) + '%').join(' / ');
    return passive.desc.replace('${1}', format(passive.values)).replace('${2}', format(passive.attackValues));
}

function getAttackMultiplier(passive, reduction, stacks) {
    if (!passive) return 1;
    if (passive.effect === 'riskAttack') return 1 + passive.attackValue;
    if (passive.effect === 'reductionAttack') return 1 + Math.max(0, reduction) * passive.value;
    if (passive.effect === 'stackAttack') return 1 + Math.min(9, Math.max(0, stacks)) * passive.value;
    return 1;
}

function runtimeAttackRatio(stats, slotEffects, hp, mp, reduction, stacks) {
    const passive = stats && stats.awakening;
    if (!passive) return 1;
    const applied = Number(stats.awakeningAttackMultiplier || 1);
    let derived = 0;
    if (passive.effect === 'hpAttack') derived = (hp - Number(stats.hp || 0)) / 10000 * passive.value;
    if (passive.effect === 'mpAttack') derived = (mp - Number(stats.mp || 0)) / 1000 * passive.value;
    const updatedAttack = Number(stats.atk || 0) + derived * applied * (1 + Number(slotEffects.finalAttackBonus || 0));
    const resourceRatio = Number(stats.atk || 0) > 0 ? updatedAttack / stats.atk : 1;
    return resourceRatio * getAttackMultiplier(passive, reduction, stacks) / applied;
}

function prepareAttack(stats, runtime, target, extra, kind, now) {
    if (!extra) return;
    const passive = stats && stats.awakening;
    const indirect = extra.summonAttack || extra.dotAttack || extra.isBotAutoAttack || (extra.trueDamage && !extra.isSkill) || extra.counterDamage;
    if (passive && !indirect) {
        if (passive.effect === 'alternateAttack' && !extra.awakeningPrepared) {
            if (runtime.awakeningLastAttack && runtime.awakeningLastAttack !== kind) extra.awakeningExtraDamage = passive.value;
            runtime.awakeningLastAttack = kind;
        }
        if (extra.isBasic && passive.effect === 'waterBasic') extra.attackElement = '수';
        if (extra.isBasic && passive.effect === 'criticalBasic') extra.forceCritical = true;
        if (passive.effect === 'criticalResistance' && target) {
            const active = target.awakeningCriticalResistance;
            target.awakeningCriticalResistance = { value: Math.max(passive.value, active && active.until > now ? active.value : 0), until: now + 4000 };
        }
    }
    extra.awakeningPrepared = true;
    delete extra.awakeningCritChanceBonus;
    const debuff = target && target.awakeningCriticalResistance;
    if (debuff && debuff.until > now) extra.awakeningCritChanceBonus = debuff.value;
}

function basicHitMultiplier(stats, extra) {
    const passive = stats && stats.awakening;
    return passive && passive.effect === 'basicDouble' && extra && extra.isBasic && !extra.summonAttack && Math.random() < passive.value ? 2 : 1;
}

function conditionalFinalDamage(stats, critical) {
    const passive = stats && stats.awakening;
    return (critical ? Number(stats && stats.criticalFinalDamage || 0) : 0)
        + (passive && passive.effect === 'criticalTradeoff' ? (critical ? passive.value : -passive.value) : 0);
}

function skillCritMultiplier(card) {
    const passive = getPassive(card);
    return passive && passive.effect === 'skillCritPenalty' ? 1 - passive.value : 0.5;
}

function formatSkillDescription(card, skill, description) {
    const passive = getPassive(card);
    if (!passive || passive.effect !== 'skillCritPenalty' || !['SUPER EASY', 'KICK BACK'].includes(skill.name)) return description;
    return description.replace('치명타 확률이 절반으로 적용되는 대신', '치명타 확률이 ' + (Math.round(passive.value * 1000) / 10) + '% 감소하는 대신');
}

function summonMultiplier(stats) {
    const passive = stats && stats.awakening;
    return passive && passive.effect === 'summonStats' ? 1 + passive.value : 1;
}

function resolveSurvival(passive, state, hpBefore, nextHp, now, wipe) {
    if (wipe || !passive || passive.effect !== 'lastStand' || hpBefore <= 0 || nextHp >= hpBefore) return nextHp;
    if (now < Number(state.invincibleUntil || 0)) return hpBefore;
    if (nextHp <= 1 && now >= Number(state.readyAt || 0)) {
        state.readyAt = now + 210000;
        state.invincibleUntil = now + 3000;
        return 1;
    }
    return nextHp;
}

module.exports = { definitions, valueAtStar, getDefinition, getPassive, formatPassive, formatPassiveProgression, getAttackMultiplier, runtimeAttackRatio, prepareAttack, basicHitMultiplier, conditionalFinalDamage, skillCritMultiplier, formatSkillDescription, summonMultiplier, resolveSurvival };
