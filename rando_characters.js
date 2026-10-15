'use strict';

const WONYODDI_ID = 15;
const KINO_ID = 16;
const modes = ['기본', '즐리', '쉐비'];
const step = (stage, base, per) => stage > 0 ? base + per * (stage - 1) : 0;

function configureStats(stats, card, equipment) {
    stats.wonyoddi = Number(card?.id) === WONYODDI_ID;
    stats.kino = Number(card?.id) === KINO_ID;
    stats.randoStar = Number(card?.star || 0);
    if (stats.wonyoddi || stats.kino) stats.randoEquipment = Object.fromEntries((equipment?.entries || []).map(e => [e.name, e.stage]));
    if (stats.kino) { stats.mental = 100 + Number(stats.mental || 0); stats.mp = 0; }
    return stats;
}

function mentalState(stats, runtime, now) {
    if (!runtime.kino) runtime.kino = { value: Number(stats.mental || 100), at: now, exhausted: false, berserk: false };
    return runtime.kino;
}

function recoverMental(stats, runtime, amount, now) {
    if (!stats.kino) return;
    const s = mentalState(stats, runtime, now);
    s.value = Math.min(Number(stats.mental || 100), Math.max(0, Math.round((s.value + amount) * 1e9) / 1e9));
    if (s.value >= 30) s.exhausted = false;
    if (s.value >= Number(stats.mental || 100)) s.berserk = false;
}

function tickMental(stats, runtime, slots, now) {
    if (!stats.kino || !runtime) return;
    const s = mentalState(stats, runtime, now), equipment = stats.randoEquipment || {};
    let seconds = Math.max(0, now - s.at) / 1000;
    s.at = now;
    s.value = Math.min(Number(stats.mental || 100), s.value);
    // 30을 넘는 순간 박카스의 추가 자연 회복을 종료한다.
    while (seconds > 0 && s.value < Number(stats.mental || 100)) {
        const below30 = equipment['박카스 스프레이'] > 0 && s.value < 30;
        const rate = 5 + Number(slots?.mentalRegen || 0) + (s.berserk && equipment['청심환'] > 0 ? 25 : 0) + (below30 ? 3 : 0);
        const limit = below30 ? 30 : Number(stats.mental || 100);
        const elapsed = Math.min(seconds, (limit - s.value) / rate);
        recoverMental(stats, runtime, elapsed * rate, now);
        seconds -= elapsed;
    }
}

function spendMental(stats, runtime, amount, now) {
    const s = mentalState(stats, runtime, now);
    if (s.exhausted || s.value < amount) return false;
    s.value = Math.max(0, s.value - amount);
    if (!s.berserk && Number(stats.randoEquipment?.['청심환'] || 0) > 0 && s.value <= Number(stats.mental || 100) * .20) {
        s.value = 0;
        s.berserk = true;
    }
    if (s.value === 0) s.exhausted = true;
    return true;
}

function mentalCost(stats, skill) {
    return Math.max(0, Number(skill.mental_cost ?? skill.mp_cost ?? skill.mp ?? 0)) + (Number(stats.randoEquipment?.['청심환'] || 0) > 0 ? 10 : 0);
}

function applyStats(stats, runtime, slots, shield, now) {
    if (Number(shield || 0) > 0) stats.atk = Math.round(stats.atk * (1 + Number(slots?.shieldAttack || 0)));
    if (stats.wonyoddi) {
        const mode = runtime?.wonyoddi?.mode || '기본', star = stats.randoStar;
        const base = { '즐리': .60, '쉐비': 1, '럭키비키': .77, '원영적사고': 1 + .10 * star }[mode] || 0;
        const stage = Number(stats.randoEquipment?.['존버의 미학'] || 0);
        const rates = { '즐리': [.06, .015], '쉐비': [.36, .09], '럭키비키': [.48, .12], '원영적사고': [.84, .21] }[mode];
        stats.afterBasic = Number(stats.afterBasic || 0) + base + (rates ? step(stage, ...rates) : 0);
        if (mode === '쉐비') stats.modeDefReduction = .30;
        if (mode === '럭키비키') stats.crit = Number(stats.crit || 0) + .77;
        if (mode === '원영적사고') { stats.crit = Number(stats.crit || 0) + .10 + .02 * star; stats.critMul = Number(stats.critMul || 0) + .30 + .02 * star; }
    }
    if (stats.kino && runtime) {
        const s = mentalState(stats, runtime, now), stage = Number(stats.randoEquipment?.['청심환'] || 0);
        if (stats.awakening?.effect === 'mentalAttack') stats.atk = Math.round(stats.atk * (1 + Math.floor(s.value / 15) * stats.awakening.value));
        if (s.berserk && stage > 0) { stats.finalDamage = Number(stats.finalDamage || 0) + step(stage, .20, .05); stats.critMul = Number(stats.critMul || 0) + step(stage, .30, .05); }
    }
    return stats;
}

function switchMode(stats, runtime, cooldowns, skillName, now, rng = Math.random) {
    const s = runtime.wonyoddi || (runtime.wonyoddi = { mode: '기본', cycle: 0 });
    if (skillName === '원영적사고 모드 전환') s.mode = '원영적사고';
    else { s.cycle = (Number(s.cycle || 0) + 1) % 3; s.mode = rng() < .07 ? '럭키비키' : modes[s.cycle]; }
    s.firstDamage = .30 + .03 * stats.randoStar;
    s.nextBasicExtra = step(Number(stats.randoEquipment?.['가면 스위처'] || 0), .20, .10);
    if (!stats.randoEquipment?.['존버의 미학']) {
        for (const key of Object.keys(cooldowns || {})) cooldowns[key] = now + Math.max(0, Number(cooldowns[key]) - now) * .70;
        for (const key of ['basicUntil', 'nextActionAt', 'actionUntil']) if (runtime[key] > now) runtime[key] = now + (runtime[key] - now) * .70;
    }
    const awakening = stats.awakening?.effect === 'modeSwitch' ? stats.awakening.value : 0;
    const shield = awakening && !stats.disableShield && rng() < Math.min(1, .77 + Number(stats.wonyoddiShieldChance || 0)) ? Math.round(stats.hp * .07 * (1 + Number(stats.shieldEfficiency || 0))) : 0;
    return { mode: s.mode, fixed: awakening, shield, skillRate: step(Number(stats.randoEquipment?.['가면 스위처'] || 0), .40, .10) };
}

function prepareAttack(stats, runtime, extra) {
    if (extra.randoPrepared) return;
    extra.randoPrepared = true;
    const direct = !(extra.dotAttack || extra.summonAttack || extra.counterDamage || extra.isBotAutoAttack || extra.modeSwitchDamage);
    if (stats.kino && runtime?.kino?.berserk && stats.randoEquipment?.['청심환']) {
        extra.triggeredEffectIds = [...new Set([...(extra.triggeredEffectIds || []), 'equipment:청심환'])];
    }
    if (stats.wonyoddi) {
        extra.defReductionBonus = Number(extra.defReductionBonus || 0) + Number(stats.modeDefReduction || 0);
        const s = runtime.wonyoddi;
        if (direct && s?.firstDamage) { extra.finalDamageBonus = Number(extra.finalDamageBonus || 0) + s.firstDamage; s.firstDamage = 0; }
        if (direct && extra.isBasic && s?.nextBasicExtra) { extra.extraDamageBonus = Number(extra.extraDamageBonus || 0) + s.nextBasicExtra; s.nextBasicExtra = 0; }
    }
}

function basicCooldown(stats, runtime, slots, fallback) {
    if (!stats.wonyoddi) return fallback;
    const base = { '즐리': 3500, '쉐비': 6000, '럭키비키': 7000, '원영적사고': 14000 }[runtime?.wonyoddi?.mode] || fallback;
    return base * (1 - Math.min(1, Number(slots?.wonyoddiBasicCooldown || 0)));
}

function cooldownMultiplier(stats, skillName) {
    return stats.kino && skillName === '카스 살포' ? Math.max(0, 1 - step(Number(stats.randoEquipment?.['박카스 스프레이'] || 0), .10, .05)) : 1;
}

function sprayDamageMultiplier(stats) { return 1 + step(Number(stats.randoEquipment?.['박카스 스프레이'] || 0), .10, .05); }

function startSpray(stats, runtime, dotRate, targetKey, now) {
    mentalState(stats, runtime, now).dot = { rate: dotRate, targetKey, nextAt: now + 2000, until: now + 10000 };
}

function sprayTicks(stats, runtime, targetKey, now) {
    const dot = runtime?.kino?.dot;
    if (!dot) return 0;
    if (dot.targetKey !== targetKey) { delete runtime.kino.dot; return 0; }
    let ticks = 0;
    while (dot.nextAt <= now && dot.nextAt <= dot.until) { ticks++; dot.nextAt += 2000; }
    if (dot.nextAt > dot.until) delete runtime.kino.dot;
    return ticks;
}

function onHit(stats, runtime, hits, extra, kills, now) {
    if (!stats.kino) return;
    if (!(extra.dotAttack || extra.summonAttack || extra.counterDamage || extra.isBotAutoAttack)) recoverMental(stats, runtime, Math.max(0, hits) * 5, now);
    if (extra.skillName === '아이돌 할래?' && kills > 0) recoverMental(stats, runtime, 10, now);
}

function view(stats, runtime) {
    if (stats.kino) { const s = runtime?.kino; return { resourceLabel: '정신력', resource: Math.floor(s?.value ?? stats.mental), maxResource: stats.mental, incapacitated: !!s?.exhausted, berserk: !!s?.berserk }; }
    if (stats.wonyoddi) return { mode: runtime?.wonyoddi?.mode || '기본', basicUntil: Number(runtime?.basicUntil || 0) };
    return {};
}

module.exports = { WONYODDI_ID, KINO_ID, configureStats, tickMental, recoverMental, spendMental, mentalCost, applyStats, switchMode, prepareAttack, basicCooldown, cooldownMultiplier, sprayDamageMultiplier, startSpray, sprayTicks, onHit, view };
