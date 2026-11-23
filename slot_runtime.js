'use strict';

const attackStats = require('./attack_stats');

function applyMissingHp(stats, slots, hp, maxHp) {
    if (!slots) return stats;
    const previous = Number(stats.slotMissingHpPercent || 0);
    const missing = Math.max(0, Math.min(100, (1 - Number(hp ?? maxHp) / Math.max(1, Number(maxHp || 1))) * 100));
    const difference = missing - previous;
    if (slots.missingHpDef) stats.def = Math.round(Number(stats.def || 0) / (1 + previous * slots.missingHpDef) * (1 + missing * slots.missingHpDef));
    if (slots.missingHpFinal) stats.finalDamage = Number(stats.finalDamage || 0) + difference * slots.missingHpFinal;
    if (slots.missingHpExtra) stats.extraDamage = Number(stats.extraDamage || 0) + difference * slots.missingHpExtra;
    if (slots.missingHpAttack) attackStats.addPercent(stats, difference * slots.missingHpAttack);
    stats.slotMissingHpPercent = missing;
    return stats;
}

module.exports = { applyMissingHp };
