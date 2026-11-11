// 능력치에 이미 포함된 강화는 다시 더하지 않는다. 추가 타격과 조건부 효과는
// 현재 전투의 복사본에서 같은 전투 훅으로 계산하며, 실제 자원/횟수/타이머를 소비하지 않는다.
const previews = new WeakMap();
const rpg = () => require('./rpgenius');
const corridor = () => require('./paradise');
const mechanics = () => require('./paradise_mechanics');
const characters = () => require('./paradise_augments_characters');
const features = () => require('./paradise_features');
const stones = () => require('./paradise_stones');
const shields = require('./combat_shields');
const random = user => previews.get(user)?.random() ?? Math.random();
const context = user => previews.get(user);
const ratio = (a, b) => b > 0 ? a / b : 1;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function snapshot(user, stats, slots, sample = .5, lookup = {}) {
    const run = structuredClone({ ...user.paradise, history: [], combatEvents: [], rewardReveal: null });
    const copy = { ...user, paradise: run, field: structuredClone(user.field) };
    run.resources = { ...(run.resources || { hp: user.hp, mp: user.mp }) };
    run.battle ||= {}; copy.field.skillCooldowns ||= {};
    (run.battle.stones ||= {}).queue ||= [];
    // 선택 중에도 동일한 강화가 계산된다. 지난 전투의 처치된 적은 다음 적의 HP 비율로 본다.
    run.phase = 'combat';
    run.enemy = { kind: 'normal', hp: 1e9, maxHp: 1e9, def: 0, atk: stats.atk, ...(run.enemy || {}) };
    if (!(run.enemy.hp > 0)) run.enemy.hp = run.enemy.maxHp;
    // 전투력은 방어력 0인 표준 표적으로 환산한다. 적 HP 조건과 보호막은 유지한다.
    run.enemy.def = 0; delete run.enemy.mirror;
    previews.set(copy, { stats, slots, skills: lookup.skills, ultimates: lookup.ultimates, random: () => sample });
    return copy;
}

function hit(user, stats, slots, raw, extra) {
    return rpg().calculateAttackHitResult(raw, 0, stats.pnt, stats, slots,
        { ...extra, random: context(user).random, powerPreview: true }, user.paradise.enemy);
}

function dotDamage(user, stats, slots) {
    let total = 0;
    for (const dot of mechanics().dots(user)) {
        const extra = { dotAttack: true, paradiseDot: true, precalculatedDamage: dot.precalculated, random: context(user).random, powerPreview: true, hitCount: 1 };
        const dotStats = { ...stats };
        mechanics().prepareAttack(user, dotStats, extra);
        const result = hit(user, dotStats, slots, dot.damage, extra);
        result.finalDamage *= corridor().attackMultiplier(user, extra);
        mechanics().modifyHit(user, dotStats, extra, result);
        features().call('modifyHit', user, dotStats, extra, result);
        total += result.finalDamage * Math.min(4, dot.ticks) / 4;
    }
    return total;
}

function action(user, stats, slots, skill, sample, lookup) {
    const copy = snapshot(user, stats, slots, sample, lookup), run = copy.paradise;
    const current = { ...stats }, basic = !skill;
    const extra = { isBasic: basic, isSkill: !basic, ...(basic ? {} : { hitCount: 1 }), skillName: skill?.name, random: context(copy).random, powerPreview: true, paradiseEnemyHpBefore: run.enemy.hp };
    const raw = Math.max(1, stats.atk) * (1 + Number((basic ? stats.afterBasic : stats.afterSkill) || 0) + Number((basic ? slots.basicDamageBonus : slots.skillDamageBonus) || 0));
    const reference = hit(copy, stats, slots, raw, { isBasic: basic, isSkill: !basic, ...(basic ? {} : { hitCount: 1 }) }).finalDamage;
    const hpBefore = run.resources.hp, mpBefore = run.resources.mp;
    let damage = raw, duration = 0, paid = 0;
    const now = Date.now(), cooldownsBefore = { ...copy.field.skillCooldowns };
    if (skill) {
        const cost = skill.stoneSkill ? 0 : skill.augmentSkill ? Math.ceil(stats.mp * Number(skill.ratio || 0))
            : Math.round(Number(skill.mp_cost || 0) * (1 - Number(slots.mpCostReduction || 0)) * (1 + Number(stats.mpReduce || 0)));
        const payment = mechanics().payment(copy, current, Math.max(0, cost), skill.name);
        paid = characters().freeSkill(copy, skill.name) ? 0 : Math.min(run.resources.mp, payment.cost);
        run.resources.mp -= paid;
        extra.mpCost = paid;
        characters().onSkill(copy, skill, current, extra);
        mechanics().onSkill(copy, skill.name, current, extra);
        features().call('onSkill', copy, skill.name, current, extra);
        if (skill.stoneSkill) damage = stones().cast(copy, current, extra);
        else if (skill.augmentSkill) damage = mechanics().activeSkill(copy, skill, current, extra);
        corridor().onSkillUsed(copy, paid, skill.name);
        duration = Math.max(2000, Number(skill.cooldown || skill.cooltime || 10000));
        copy.field.skillCooldowns[skill.name] = now + duration * corridor().cooldownMultiplier(copy);
        characters().afterCooldown(copy, skill.name);
        mechanics().afterCooldown(copy, skill.name);
        features().call('afterCooldown', copy, skill.name);
    }
    corridor().prepareAttack(copy, extra);
    characters().prepareAttack(copy, current, extra);
    mechanics().prepareAttack(copy, current, extra);
    features().call('prepareAttack', copy, current, extra);
    const result = hit(copy, current, slots, damage, extra);
    const penetration = 1 + Number(stats.pnt || 0) / 280 + clamp(Number(stats.pntPercent || 0) + Number(slots.defReduction || 0), 0, 1) * .5;
    const conditionalPenetration = 1 + (Number(current.pnt || 0) + Number(extra.pntBonus || 0)) / 280
        + clamp(Number(current.pntPercent || 0) + Number(slots.defReduction || 0) + Number(extra.defReductionBonus || 0), 0, 1) * .5;
    const multiplier = corridor().attackMultiplier(copy, extra);
    extra.paradiseAttackMultiplier = multiplier;
    result.finalDamage *= multiplier;
    for (const detail of result.hitDetails) { detail.damage *= multiplier; detail.fixedDamage *= multiplier; }
    features().call('prepareHit', copy, current, extra, result);
    corridor().modifyHit(copy, extra, result);
    characters().modifyHit(copy, extra, result);
    mechanics().modifyHit(copy, current, extra, result);
    features().call('modifyHit', copy, current, extra, result);
    const enemyShield = shields.summary(run.enemy, Date.now()).amount;
    extra.enemyShieldAbsorbed = Math.min(enemyShield, result.finalDamage);
    shields.absorb(run.enemy, extra.enemyShieldAbsorbed);
    // 승리 훅과 정산은 호출하지 않는다. 피해 후 조건과 지속 피해 부여까지만 평가한다.
    run.enemy.hp = Math.max(1, run.enemy.hp - Math.max(0, result.finalDamage - extra.enemyShieldAbsorbed));
    corridor().afterAttack(copy, extra, result);
    characters().afterHit(copy, current, extra, result);
    mechanics().afterHit(copy, current, extra, result);
    features().call('afterHit', copy, current, extra, result);
    const cooldown = skill ? Math.max(.25, Math.round((copy.field.skillCooldowns[skill.name] - now) / 50) * 50 / duration) : 1;
    const savedCooldown = Object.entries(cooldownsBefore).reduce((sum, [name, until]) => name === skill?.name ? sum
        : sum + Math.max(0, until - Math.max(now, Number(copy.field.skillCooldowns[name] || 0))), 0);
    return {
        offense: ratio(result.finalDamage * conditionalPenetration / penetration + dotDamage(copy, current, slots) * .5, reference) / cooldown,
        shield: stats.disableShield ? 0 : shields.summary(copy.field, Date.now()).amount,
        hp: Math.max(0, run.resources.hp - hpBefore), mp: Math.max(0, run.resources.mp - (mpBefore - paid)), savedCooldown
    };
}

function apply(user, stats, slots, base) {
    if (!corridor().active(user) || user.paradise.mode === 'hell' || previews.has(user)) return base;
    const copy = snapshot(user, stats, slots), run = copy.paradise;
    const main = rpg().getMainCardSkills(copy).map(entry => entry.skill);
    const ultimates = rpg().getUltimateSkills(copy).map(entry => entry.skill);
    const lookup = context(copy);
    const ultimateNames = new Set(ultimates.map(skill => skill.name));
    const normalSkills = main.filter(skill => !ultimateNames.has(skill.name));
    const primary = normalSkills[0] || { name: '기본 스킬' };
    const gained = [...normalSkills.slice(1), ...mechanics().skills(copy).map(skill => ({ ...skill, augmentSkill: true }))];
    const skillsBlocked = !!characters().skillBlocked(copy);
    const results = [];
    // 고정된 네 표본을 사용하므로 조회만으로 확률 효과가 다시 추첨되거나 전투력이 흔들리지 않는다.
    for (const sample of [.125, .375, .625, .875]) {
        results.push({ weight: skillsBlocked ? 1 : .60, ...action(user, stats, slots, null, sample, lookup) });
        if (skillsBlocked) continue;
        const normal = action(user, stats, slots, primary, sample, lookup);
        // 습득 스킬은 추가로 가능한 행동이다. 기본 스킬보다 유리한 선택의 기대치를 반영한다.
        for (const skill of gained) {
            const next = action(user, stats, slots, skill, sample, lookup);
            normal.offense = Math.max(normal.offense, next.offense);
            normal.shield = Math.max(normal.shield, next.shield);
            normal.hp = Math.max(normal.hp, next.hp); normal.mp = Math.max(normal.mp, next.mp);
            normal.savedCooldown = Math.max(normal.savedCooldown, next.savedCooldown);
        }
        results.push({ weight: ultimates.length ? .30 : .40, ...normal });
        if (ultimates.length) results.push({ weight: .10, ...action(user, stats, slots, ultimates[0], sample, lookup) });
    }
    const mean = key => results.reduce((sum, value) => sum + value[key] * value.weight, 0) / 4;
    const received = Math.max(1, stats.hp * .20);
    let incoming = corridor().incomingMultiplier(copy, received) * mechanics().incomingMultiplier(copy) * features().incomingMultiplier(copy, received);
    incoming = clamp(incoming, 0, 3);
    const survived = corridor().survive(copy, 0, stats.hp);
    const effects = corridor().sumEffects(run), noHealing = effects.noHealing;
    const relic = id => run.relics.includes(id);
    const healing = noHealing ? 0 : mean('hp') + stats.hp * (Number(effects.victoryHp || 0) + Number(effects.eliteHp || 0) * .25
        + (effects.thirst ? .10 : 0) + (relic('crown') ? .27 * .25 : 0) + (relic('meditationCenser') ? .05 : 0));
    const survivalHp = survived > 0 ? Math.max(stats.hp * .15, survived) : 0;
    const bot = user.field.iktaeBot;
    const botSpeed = bot?.hp > 0 && bot.expired_at > Date.now() ? .25 * Number(bot.atkMul || 0) * (4000 / characters().iktaeInterval(copy) - 1) : 0;
    const offense = Math.round(base.offense * Math.max(0, mean('offense') + botSpeed));
    // 일회 방어/부활은 4회 피격 구간에 나누어 반영한다. 현재 보호막은 소모/만료 즉시 빠진다.
    const defense = Math.round(base.defense * Math.sqrt(1 + (mean('shield') + healing + survivalHp) / Math.max(1, stats.hp)) / Math.max(.25, .75 + incoming * .25));
    const mana = mean('mp') + stats.mp * (Number(effects.victoryMp || 0) + Number(effects.eliteMp || 0) * .25
        + (relic('orb') ? .15 : 0) + (relic('crown') ? .14 * .25 : 0) + (relic('meditationCenser') ? .05 : 0));
    const utility = Math.round(base.utility + (noHealing ? 0 : mana / 8) + mean('savedCooldown') / 8000);
    return { offense, defense, utility, total: offense + defense + utility };
}

module.exports = { context, random, apply };
