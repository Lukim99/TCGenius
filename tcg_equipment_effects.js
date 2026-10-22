'use strict';

const ilion = require('./ilion_cards');

// Only activations belong here. Permanent stats and continuously evaluated
// conditions (for example low-HP damage bonuses) cannot be activated a second time.
const watches = {
    '마나번 햇': ['manaBurnAttackBuff', 'manaBurnAttack'],
    '마나번 로브': ['manaBurnElementBuff', 'manaBurnElement'],
    '현자의 마나번 로브': ['manaBurnElementBuff', 'manaBurnElement'],
    '마나번 트라우저': ['manaBurnCritBuff', 'manaBurnCrit'],
    '마나번 슈즈': ['manaBurnExtraBuff', 'manaBurnExtra'],
    '핏빛 모자': ['bloodHatBuff', 'bloodHatReadyAt'],
    '일레이나 전용 동전': ['coinBuff'], '최후통첩 모자': ['ultimatumHatBuff'],
    '해방의 열쇠': ['liberationBuff'], '운명의 주사위': ['destinyDiceBuff'],
    '심판의 주사위': ['judgeDiceBuff'], '행운의 복주머니': ['fortuneExtraDamage'],
    '흐르는 피': ['flowingBloodNext'], '킹메이커 팔찌': ['kingmakerDefenseDebuff'],
    '레인보우 프리즘': ['rainbowReadyAt'], '예고편': ['previewNextFinal'],
    '앵콜': ['encoreBuff'], '왓 타임 이즈 잇 나우': ['dropoutStacks'],
    '잿불 모자': ['burnReadyAt'], '잿불 신발': ['emberShoesReadyAt'],
    '종말을 걷는 장송곡': ['mythicBurnShoesReadyAt'],
    '정수 필터망': ['cleanWaterBuff'], '썩어버린 물': ['rottenWaterStacks'],
    '비리의 맛': ['bribeNextBasic'], '범부의 대나무': ['beomStacks', 'beomStacksUntil'],
    '교촌 주머니': ['kyochonGoldBuff'], '심해의 모자': ['deepWaterAttackBuff'],
    '검은 잔향 신발': ['blackEchoShoesBuff'], '심연의 신발': ['darkAttackBuff'],
    '해류를 거스르는 신발': ['currentShoesReadyAt'],
    '불굴': ['dragonRegen'], '피의 서약': ['culprit']
};

function capture(state) {
    // Shallow references distinguish a fresh buff from a still-active buff.
    return Object.assign({}, state);
}

function record(state, name) {
    if (!state.tcgSources) state.tcgSources = [];
    state.tcgSources.push(name);
}

const instantEffects = new Set(['메가카운트 추첨기', '쿨다운 목걸이', '예고편', '모노레일 타이머', '결합 타이머', '십결모 타이머', 'DMC 마이크', '심해의 신발', '치명적인 매력', '불량 배터리', '예고의 예고', '예고의 예고의 예고', '킹메이커 팔찌']);
function recordInstant(state, name) {
    if (instantEffects.has(name)) record(state, name);
}

function collect(state, before) {
    for (const [name, keys] of Object.entries(watches)) {
        if (!state.tcgSources?.includes(name) && keys.some(key => state[key] != null && state[key] !== before[key])) record(state, name);
    }
}

function activate(ctx) {
    const { state, stats, runtime, extra, now } = ctx;
    const sources = state.tcgSources || [];
    delete state.tcgSources;
    if (ctx.setCount < 4 || !sources.length || ctx.disabled) return [];
    const entries = ctx.entries || [];
    const stages = Object.fromEntries(entries.map(entry => [entry.name, Math.max(1, Number(entry.stage || 1))]));
    const stage = name => stages[name] || 0;
    const value = (name, base, per = 0) => base + Math.max(0, stage(name) - 1) * per;
    const add = (key, amount) => { extra[key] = Number(extra[key] || 0) + amount; };
    const duration = seconds => (seconds + Number(stats.equipmentEffectDurationFlat || 0)) * 1000;
    const attack = amount => amount * (1 + Number(stats.attackBuffEfficiency || 0));
    const buff = (key, data, seconds) => ctx.buff(key, Object.assign({}, data), now + duration(seconds));
    const hpCost = rate => {
        ctx.hp(Math.max(1, ctx.hp() - Math.max(1, Math.floor(ctx.hp() * rate))));
        if (stage('흐르는 피')) state.flowingBloodNext = value('흐르는 피', .12, .04);
    };
    const mp = rate => ctx.mp(Math.min(ctx.maxMp, ctx.mp() + Math.max(1, Math.round(ctx.maxMp * rate))));
    const heal = amount => ctx.heal(Math.round(amount * (1 + Number(stats.recoveryEfficiency || 0))));
    const damage = (ratio, element) => add('oneTimeFinalDamage', Math.round(Number(stats.atk || 0) * ratio * ctx.element(element)));
    const effects = {};
    const effect = (name, run) => { if (stage(name)) effects[name] = run; };
    for (const [name, key, rate, base, per] of [
        ['마나번 햇', 'manaBurnAttackBuff', .02, .15, .03],
        ['마나번 로브', 'manaBurnElementBuff', .02, 60, 10],
        ['현자의 마나번 로브', 'manaBurnElementBuff', .01, 100, 0],
        ['마나번 트라우저', 'manaBurnCritBuff', .02, .10, .02],
        ['마나번 슈즈', 'manaBurnExtraBuff', .02, .10, .03]
    ]) effect(name, () => {
        ctx.mp(Math.max(0, ctx.mp() - Math.max(1, Math.round(ctx.maxMp * rate))));
        buff(key, { value: key === 'manaBurnAttackBuff' ? attack(value(name, base, per)) : value(name, base, per) }, 60);
    });
    effect('핏빛 모자', () => { hpCost(.03); buff('bloodHatBuff', { value: attack(value('핏빛 모자', .18, .04)) }, 15); });
    effect('흐르는 피', () => { state.flowingBloodNext = value('흐르는 피', .12, .04); });
    effect('일레이나 전용 동전', () => {
        const water = Math.random() < .5;
        buff('coinBuff', { type: water ? 'water' : 'crit', value: water ? value('일레이나 전용 동전', 250, 50) : value('일레이나 전용 동전', .20, .05) }, 300);
    });
    effect('최후통첩 모자', () => buff('ultimatumHatBuff', { value: value('최후통첩 모자', .15, .04) }, 8));
    effect('앵콜', () => buff('encoreBuff', { attack: attack(value('앵콜', .12, .03)), critMul: .20 }, 6));
    effect('왓 타임 이즈 잇 나우', () => {
        const stacks = Math.min(4, Number(state.dropoutStacks || 0));
        if (stacks) { damage(value('왓 타임 이즈 잇 나우', .50, .05) * stacks, extra.attackElement); state.dropoutStacks = 0; }
        else state.dropoutStacks = 1;
    });
    effect('진사이', () => heal(200));
    effect('정수 필터망', () => { add('pntBonus', value('정수 필터망', 25, 10)); buff('cleanWaterBuff', { value: value('정수 필터망', .08, .03) }, 6); });
    effect('썩어버린 물', () => { state.rottenWaterStacks = Math.min(3, Number(state.rottenWaterStacks || 0) + 1); });
    effect('비리의 맛', () => { state.bribeNextBasic = { damage: value('비리의 맛', .40, .12), darkBonus: value('비리의 맛', .65, .15) }; });
    effect('치명적인 매력', () => { add('critChanceBonus', -Number(stats.crit || 0)); add('critMulBonus', Number(stats.crit || 0) * value('치명적인 매력', .70, .15)); });
    effect('범부의 대나무', () => {
        state.beomStacks = Math.min(7, (now < Number(state.beomStacksUntil || 0) ? Number(state.beomStacks || 0) : 0) + 1);
        state.beomStacksUntil = now + duration(10);
        if (state.beomStacks === 7) state.trueBeomUntil = state.beomStacksUntil;
    });
    effect('교촌 주머니', () => { ctx.cooldown('초특급한탕', 0, 30000); buff('kyochonGoldBuff', { value: value('교촌 주머니', .10, .05) }, 30); });
    effect('불량 배터리', () => {
        if (extra.isSkill || extra.skillName) {
            ctx.mp(Math.min(ctx.maxMp, ctx.mp() + Number(extra.mpCost || 0)));
            add('damageBonusMul', -.12);
        } else state.tcgNoMp = true;
    });
    effect('감옥열쇠', () => ctx.prisonKey(now + duration(8)));
    effect('강릉함씨 32대손', () => ctx.shield(ctx.maxHp * value('강릉함씨 32대손', .08, .02), now + duration(10), '강릉함씨 32대손'));
    effect('피의 서약', () => ctx.culprit(value('피의 서약', .12, .04), value('피의 서약', .15, .05), duration(10)));
    effect('메가카운트 추첨기', () => {
        const choice = Math.floor(Math.random() * 4);
        if (choice === 0) add('extraDamageBonus', value('메가카운트 추첨기', .15, .05));
        if (choice === 1) add('finalDamageBonus', value('메가카운트 추첨기', .15, .05));
        if (choice === 2) mp(value('메가카운트 추첨기', .005, .005));
        if (choice === 3) {
            ctx.gold(500);
            if (stage('행운의 복주머니')) buff('fortuneExtraDamage', { value: value('행운의 복주머니', .10, .05) }, 10);
        }
    });
    effect('해방의 열쇠', () => buff('liberationBuff', { choices: [['element'], ['attack'], ['resist']][Math.floor(Math.random() * 3)], elementValue: value('해방의 열쇠', 70, 20), resistValue: value('해방의 열쇠', 80, 20) }, 10));
    effect('운명의 주사위', () => buff('destinyDiceBuff', { types: [Math.random() < .5 ? 'crit' : 'critMul'] }, 8));
    effect('심판의 주사위', () => buff('judgeDiceBuff', { types: [Math.random() < .5 ? 'crit' : 'critMul'] }, 10));
    effect('행운의 복주머니', () => buff('fortuneExtraDamage', { value: value('행운의 복주머니', .10, .05) }, 10));
    effect('킹메이커 팔찌', () => ctx.defense(value('킹메이커 팔찌', .10, .02), duration(5)));
    effect('레인보우 프리즘', () => damage(value('레인보우 프리즘', 1.8, .4), extra.attackElement));
    effect('예고편', () => { state.previewNextFinal = value('예고편', .06, .02); });
    effect('예고의 예고', () => add('extraDamageBonus', value('예고의 예고', .15, .05)));
    effect('예고의 예고의 예고', () => add('critChanceBonus', value('예고의 예고의 예고', .10, .05)));
    effect('모노레일 타이머', () => add('critMulBonus', value('모노레일 타이머', .40, .08)));
    effect('결합 타이머', () => add('extraDamageBonus', value('결합 타이머', .20, .07)));
    effect('십결모 타이머', () => { add('damageBonusMul', .30); add('critChanceBonus', .25); });
    effect('DMC 마이크', () => add('finalDamageBonus', value('DMC 마이크', .40, .10)));
    effect('쿨다운 목걸이', () => heal(ctx.maxHp * .001));
    effect('포상 정산 반지', () => { if (ctx.hp() / ctx.maxHp <= ctx.mp() / Math.max(1, ctx.maxMp)) heal(ctx.maxHp * .01); else mp(.01); });
    effect('심해의 모자', () => { state.deepNextBasic = value('심해의 모자', .60, .15); buff('deepWaterAttackBuff', { value: .08 }, 6); });
    effect('심해의 갑옷', () => ctx.shield(ctx.maxHp * value('심해의 갑옷', .05, .01), now + duration(5), '심해의 갑옷'));
    effect('심해의 신발', () => ctx.cooldown(extra.skillName, value('심해의 신발', .04, .01), 3000));
    effect('해류를 거스르는 신발', () => { ctx.cooldown(extra.skillName, .08, 5000); mp(.03); });
    effect('검은 잔향 신발', () => buff('blackEchoShoesBuff', { value: value('검은 잔향 신발', .07, .03) }, 60));
    effect('심연의 신발', () => { hpCost(.02); buff('darkAttackBuff', { value: .25 }, 12); buff('abyssBuff', {}, 12); });
    effect('천공의 모자', () => damage(value('천공의 모자', .10, .04), '명'));
    effect('천공의 하의', () => damage(value('천공의 하의', .08, .03), '명'));
    effect('심판자의 하의', () => damage(.70, '명'));
    effect('불멸하는 업화의 하의', () => buff('hellfireRage', { attack: attack(.20) }, 5));
    effect('잿불 모자', () => ctx.burn(value('잿불 모자', .30, .05), duration(8 + Number(stats.burnDurationFlat || 0))));
    effect('잿불 신발', () => ctx.detonate(value('잿불 신발', .60, .10), false));
    effect('종말을 걷는 장송곡', () => ctx.detonate(1, true));
    effect('솔로 인페르노', () => ctx.ally('heal', value('솔로 인페르노', .03, .02), duration(0)));
    effect('성역의 인도자 모자', () => ctx.ally('attack', attack(value('성역의 인도자 모자', .08, .03)), duration(10)));
    effect('성역의 인도자 아머', () => ctx.ally('shield', value('성역의 인도자 아머', .02, .02), duration(5)));
    effect('성역의 인도자 트라우저', () => ctx.ally('mp', value('성역의 인도자 트라우저', .01, .01), 0));
    effect('구원자의 하의', () => { ctx.ally('mp', .04, 0); mp(.02); });
    effect('무한홀덤덱', () => ilion.draw(runtime, ctx.cooldowns, stage('무한홀덤덱'), stage('어머니의 마음'), now));
    effect('어머니의 마음', () => { (runtime.ilion || (runtime.ilion = { deck: [], balanceHits: 0 })).motherCritUntil = now + 5000; });
    effect('가면 스위처', () => { damage(value('가면 스위처', .40, .10), extra.attackElement); (runtime.wonyoddi || (runtime.wonyoddi = {})).nextBasicExtra = value('가면 스위처', .20, .10); });
    effect('청심환', () => { const mental = runtime.kino; if (mental && !mental.berserk) { mental.value = 0; mental.berserk = mental.exhausted = true; } });
    // Legacy equipment passives are attached to their equipped item, too.
    for (const entry of entries) {
        if (entry.passiveId === 0) effect(entry.name, () => add('tcgDestiny', 1));
        if (entry.passiveId === 1) effect(entry.name, () => add('tcgExtraHit', 1));
        if (entry.passiveId === 2) effect(entry.name, () => add('tcgCelestia', 1));
        if (entry.passiveId === 3) effect(entry.name, () => { state.dragonRegen = { ticksLeft: 5, nextTickAt: now + 1000 }; ctx.startTimer(); });
        if (entry.passiveId === 5) effect(entry.name, () => add('oneTimeFinalDamage', Math.round(Number(stats.def || 0) * .25)));
    }
    const triggered = [];
    for (const source of sources) {
        const sourceItems = entries.filter(entry => ({ 0: '운명', 1: '심연', 2: '별빛의 축복', 3: '불굴', 5: '가시' }[entry.passiveId]) === source).map(entry => entry.name);
        if (!stage(source) && !sourceItems.length) continue;
        const pool = Object.keys(effects).filter(name => name !== source && !sourceItems.includes(name));
        if (!pool.length) continue;
        const name = pool[Math.floor(Math.random() * pool.length)];
        effects[name]();
        triggered.push(name);
        extra.triggeredEffectIds = [...new Set([...(extra.triggeredEffectIds || []), 'set:TCG의 유산', 'equipment:' + name])];
    }
    if (triggered.length) extra.notice = [extra.notice, 'TCG 추가 발동: ' + triggered.join(', ')].filter(Boolean).join(' / ');
    return triggered;
}

function context(options) {
    const { state, runtime, actor, stats, now, extra, mode } = options;
    const maxHp = Number(options.maxHp || stats.hp || 1), maxMp = Number(options.maxMp || stats.mp || 0);
    const expiry = mode === 'pvp' ? 'until' : 'expiredAt';
    const cooldowns = options.cooldowns || {};
    const ctx = Object.assign({ maxHp, maxMp, cooldowns, disabled: extra.summonAttack || extra.dotAttack || extra.disableEquipmentBonusDamage }, options);
    ctx.hp = amount => amount == null ? Number(actor.hp ?? maxHp) : (actor.hp = amount);
    ctx.mp = amount => amount == null ? Number(actor.mp ?? maxMp) : (actor.mp = amount);
    ctx.buff = (key, data, until) => {
        data[expiry] = until;
        if (mode === 'party') {
            const mana = { manaBurnAttackBuff: 'manaBurnAttack', manaBurnElementBuff: 'manaBurnElement', manaBurnCritBuff: 'manaBurnCrit', manaBurnExtraBuff: 'manaBurnExtra' };
            if (mana[key]) key = mana[key];
            const attackKey = { manaBurnAttack: 'manaBurnAttack', bloodHatBuff: 'bloodHat', encoreBuff: 'encore', ultimatumHatBuff: 'ultimatumHat' }[key];
            if (attackKey) {
                const attackBuffs = runtime.equipmentAtkBuffs || (runtime.equipmentAtkBuffs = {});
                attackBuffs[attackKey] = { value: Number(data.attack ?? data.value), expiredAt: until };
            }
        }
        state[key] = data;
    };
    ctx.cooldown = (name, rate, cap) => {
        // An attack proc without a skill has no current skill cooldown to shorten.
        // Keep the one-shot reduction for the next skill instead of choosing one.
        if (!name) { state.tcgCooldown = { rate, cap }; return; }
        const end = Number(cooldowns[name] || now);
        cooldowns[name] = Math.max(now, end - (rate ? Math.min(cap, Math.max(0, end - now) * rate) : cap));
    };
    ctx.burn = options.burn || ((ratio, milliseconds) => {
        state.burn = { tickDamage: Math.max(1, Math.round(Number(stats.atk || 0) * ratio * (1 + Number(stats.dotDamage || 0) + Number(stats.burnDamage || 0)))), intervalMs: 2000, nextTickAt: now + 2000, [expiry]: now + milliseconds };
        ctx.startTimer();
    });
    ctx.detonate = options.detonate || ((rate, mythic) => {
        const burn = state.burn;
        if (burn) {
            const ticks = Math.max(0, Math.floor((Number(burn[expiry]) - Math.max(now, Number(burn.nextTickAt || now))) / 2000) + 1);
            extra.oneTimeFinalDamage = Number(extra.oneTimeFinalDamage || 0) + Math.round(Number(burn.tickDamage || 0) * ticks * rate);
            delete state.burn;
        }
        if (mythic) {
            state.hellfire = { tickDamage: Math.max(1, Math.round(Number(stats.atk || 0) * .50 * (1 + Number(stats.dotDamage || 0)))), intervalMs: 2000, nextTickAt: now + 2000, [expiry]: now + 6000 };
            ctx.startTimer();
        }
    });
    return ctx;
}

function consumeSkill(state, result, party) {
    if (state.tcgNoMp) { result.noMp = true; result.extra.damageBonusMul = Number(result.extra.damageBonusMul || 0) - .12; delete state.tcgNoMp; }
    if (state.tcgCooldown) {
        const { rate, cap } = state.tcgCooldown;
        if (rate) { result.selfCooldownRate = Math.max(Number(result.selfCooldownRate || 0), rate); result.selfCooldownCap = cap / (party ? 1000 : 1); }
        else if (party) result.cooldownFlat += cap / 1000;
        else result.cooldownFlatReduction += cap;
        delete state.tcgCooldown;
    }
}

function consumeAttack(state, extra) {
    if (extra.summonAttack || extra.dotAttack || extra.disableEquipmentBonusDamage) return;
    for (const [key, value] of Object.entries(state.tcgPendingExtra || {})) extra[key] = Number(extra[key] || 0) + value;
    delete state.tcgPendingExtra;
}

function outsideAttack(state, activateExtra) {
    // Recovery, shields and timed buffs execute now. A one-attack modifier from
    // a timer/defensive proc is consumed by the owner's next direct attack.
    const extra = {};
    activateExtra(extra);
    for (const [key, value] of Object.entries(extra)) {
        if (typeof value !== 'number') continue;
        const pending = state.tcgPendingExtra || (state.tcgPendingExtra = {});
        pending[key] = Number(pending[key] || 0) + value;
    }
}

function finishHit(state, before, extra, activateExtra) {
    collect(state, before);
    const post = { attackElement: extra.attackElement };
    activateExtra(post);
    extra.triggeredEffectIds = [...new Set([...(extra.triggeredEffectIds || []), ...(post.triggeredEffectIds || [])])];
    if (post.notice) extra.notice = [extra.notice, post.notice].filter(Boolean).join(' / ');
    const damage = Number(post.oneTimeFinalDamage || 0) + Number(post.oneTimeTrueDmg || 0);
    for (const [key, value] of Object.entries(post)) {
        if (typeof value !== 'number' || key === 'oneTimeFinalDamage' || key === 'oneTimeTrueDmg') continue;
        const pending = state.tcgPendingExtra || (state.tcgPendingExtra = {});
        pending[key] = Number(pending[key] || 0) + value;
    }
    return damage;
}

module.exports = { capture, collect, record, recordInstant, activate, context, consumeSkill, consumeAttack, outsideAttack, finishHit };
