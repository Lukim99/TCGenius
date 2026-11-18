'use strict';

// Keep shield contact separate from HP damage. Allocate absorption in attack order,
// rather than proportionally erasing every hit (and its combo/critical metadata).
function applyAbsorption(hit, result) {
    const total = Math.max(0, Number(hit.finalDamage || 0));
    const absorbed = Math.max(0, Number(result.absorbed || 0));
    if (!absorbed) { hit.finalDamage = result.damage; return; }
    let details = (hit.hitDetails || []).map(detail => ({ ...detail }));
    const detailTotal = details.reduce((sum, detail) => sum + Math.max(0, Number(detail.damage || 0)), 0);
    if (!detailTotal) details = [{ damage: total, isCritical: !!hit.criticalCount }];
    else {
        let remaining = total;
        details.forEach((detail, index) => {
            const original = Math.max(0, Number(detail.damage || 0));
            detail.damage = index === details.length - 1 ? remaining : Math.min(remaining, Math.round(original * total / detailTotal));
            detail.fixedDamage = Math.min(detail.damage, Math.round(Math.max(0, Number(detail.fixedDamage || 0)) * (original ? detail.damage / original : 0)));
            remaining -= detail.damage;
        });
    }
    hit.shieldedHitDetails = details.map(detail => ({ ...detail }));
    let remainingShield = absorbed;
    hit.hitDetails = details.map(detail => {
        const shieldAbsorbed = Math.min(detail.damage, remainingShield);
        remainingShield -= shieldAbsorbed;
        const damage = detail.damage - shieldAbsorbed;
        return { ...detail, damage, shieldAbsorbed,
            fixedDamage: Math.min(damage, Math.round(Number(detail.fixedDamage || 0) * (detail.damage ? damage / detail.damage : 0))) };
    });
    hit.finalDamage = result.damage;
}

module.exports = { applyAbsorption };
