// 파티 퀘스트 매니저 (인메모리 방/세션, SSE 허브, 채팅, 전투 엔진)
// 채팅은 유저 발화만 보관/방송. 시스템/전투 진행은 'notice'로 휘발성 송출.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const rpgenius = require('./rpgenius.js');

const PARTY_QUEST_PATH = path.join(__dirname, 'DB', 'RPGenius', 'PartyQuest.json');
const CHARACTER_CARDS_PATH = path.join(__dirname, 'DB', 'RPGenius', 'CharacterCards.json');
const SKILLS_PATH = path.join(__dirname, 'DB', 'RPGenius', 'Skills.json');
const EQUIPMENT_PATH = path.join(__dirname, 'DB', 'RPGenius', 'Equipment.json');
const PACKS_PATH = path.join(__dirname, 'DB', 'RPGenius', 'Pack.json');
const POSITION_LIST = ['탱커', '브루저', '메인딜러', '서브딜러', '서포터'];
// 이 값 이상의 buff.remain은 '영구'로 간주해 잔여시간을 표시하지 않는다 (튀어오르기 등)
const PERMANENT_BUFF_SEC = 86400;
const TICK_MS = 200;
const HODU_WEEKLY_REWARD_LIMIT = 3;
const IMMORTAL_DRAGON_ARMOR_NAME = '불멸하는 업화의 용갑';
const IMMORTAL_DRAGON_ARMOR_COOLDOWN_MS = 65 * 1000;
const IMMORTAL_DRAGON_ARMOR_TRIGGER_HP_RATIO = 0.2;
const IMMORTAL_DRAGON_ARMOR_REGEN_TICKS = 5;
const IMMORTAL_DRAGON_ARMOR_REGEN_HP_PCT = 0.03;

let questsCache = null;
let questsCacheMtime = 0;
let characterCardsCache = null;
let characterCardsCacheMtime = 0;
let skillsCache = null;
let skillsCacheMtime = 0;
let equipmentCache = null;
let equipmentCacheMtime = 0;
let packsCache = null;
let packsCacheMtime = 0;

function loadQuests() {
    try {
        const stat = fs.statSync(PARTY_QUEST_PATH);
        if (!questsCache || stat.mtimeMs !== questsCacheMtime) {
            const raw = fs.readFileSync(PARTY_QUEST_PATH, 'utf8');
            const parsed = JSON.parse(raw);
            questsCache = Array.isArray(parsed.quests) ? parsed.quests : [];
            questsCacheMtime = stat.mtimeMs;
        }
    } catch (e) {
        console.error('[partyquest] PartyQuest.json 로드 실패:', e);
        questsCache = questsCache || [];
    }
    return questsCache;
}

function getQuestById(id) {
    return loadQuests().find(q => q.id === id) || null;
}

function loadJsonCached(filePath, cacheKey) {
    try {
        const stat = fs.statSync(filePath);
        if (cacheKey === 'cards') {
            if (!characterCardsCache || stat.mtimeMs !== characterCardsCacheMtime) {
                characterCardsCache = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                characterCardsCacheMtime = stat.mtimeMs;
            }
            return Array.isArray(characterCardsCache) ? characterCardsCache : [];
        }
        if (cacheKey === 'equipment') {
            if (!equipmentCache || stat.mtimeMs !== equipmentCacheMtime) {
                equipmentCache = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                equipmentCacheMtime = stat.mtimeMs;
            }
            return equipmentCache || {};
        }
        if (cacheKey === 'packs') {
            if (!packsCache || stat.mtimeMs !== packsCacheMtime) {
                packsCache = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                packsCacheMtime = stat.mtimeMs;
            }
            return Array.isArray(packsCache) ? packsCache : [];
        }
        if (!skillsCache || stat.mtimeMs !== skillsCacheMtime) {
            skillsCache = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            skillsCacheMtime = stat.mtimeMs;
        }
        return Array.isArray(skillsCache) ? skillsCache : [];
    } catch (_) {
        return cacheKey === 'equipment' ? {} : [];
    }
}

function getMainCardSkillEntries(user) {
    const cards = loadJsonCached(CHARACTER_CARDS_PATH, 'cards');
    const skills = loadJsonCached(SKILLS_PATH, 'skills');
    const card = user && user.main_card && cards[user.main_card.id];
    if (!card) return [];
    const star = Number(user.main_card.star || 0);
    let skillIndices = card.skills || [];
    if (user.main_card.type === '전직' && card.class && Array.isArray(card.class.skills)) {
        skillIndices = skillIndices.concat(card.class.skills);
    }
    return skillIndices.map(index => {
        const skill = skills[index];
        return skill ? { index: Number(index), skill, star } : null;
    }).filter(Boolean);
}

function getSkillValue(skill, index, star) {
    const format = skill && skill.format && skill.format[index];
    return Number(format && format.base || 0) + Number(format && format.per_star || 0) * Number(star || 0);
}

function getTranscendEquipmentEntry(member, name) {
    const entries = member && member.baseSnapshot && member.baseSnapshot.transcendEquipment && member.baseSnapshot.transcendEquipment.entries;
    return Array.isArray(entries) ? entries.find(entry => entry.name === name) || null : null;
}

function getTranscendStageValue(member, name, base, perStage) {
    const entry = getTranscendEquipmentEntry(member, name);
    if (!entry) return 0;
    return Number(base || 0) + Number(perStage || 0) * Math.max(0, Number(entry.stage || 1) - 1);
}

function getTranscendSetCount(member, setName) {
    const counts = member && member.baseSnapshot && member.baseSnapshot.transcendEquipment && member.baseSnapshot.transcendEquipment.setCounts;
    return Number(counts && counts[setName] || 0);
}

function getPartyAttackOrderPreview(member) {
    if (!getTranscendEquipmentEntry(member, '판테온 레거시') && !getTranscendEquipmentEntry(member, '리턴즈파겜')) return null;
    const count = Number(member && member.runtime && member.runtime.equipmentState && member.runtime.equipmentState.attackCount || 0);
    return getTranscendEquipmentEntry(member, '리턴즈파겜') ? ((count + 1) % 3) + 1 : (count % 3) + 1;
}

function getPartyAttackBuffValue(member) {
    const runtimeValue = Number(member && member.runtime && member.runtime.atkBuff || 0);
    const equipmentBuffs = member && member.runtime && member.runtime.equipmentAtkBuffs || {};
    let equipmentValue = 0;
    for (const key of Object.keys(equipmentBuffs)) {
        const buff = equipmentBuffs[key];
        if (buff && Date.now() < Number(buff.expiredAt || 0)) equipmentValue += Number(buff.value || 0);
    }
    const equipmentState = member && member.runtime && member.runtime.equipmentState;
    if (equipmentState && Date.now() < Number(equipmentState.trueBeomUntil || 0)) equipmentValue += scalePartyAttackBuff(member, getTranscendStageValue(member, '범부의 대나무', .30, .05));
    return runtimeValue + equipmentValue;
}

function scalePartyAttackBuff(source, value) {
    const efficiency = Number(source && source.baseSnapshot && source.baseSnapshot.stats && source.baseSnapshot.stats.attackBuffEfficiency || 0);
    return Number(value || 0) * (1 + efficiency);
}

// 시벌론 상태: 일반 공격 쿨타임 0.5초 (만료는 lazy 체크)
function isPartySivalonActive(member) {
    return !!(member && member.runtime && Date.now() < Number(member.runtime.sivalonUntil || 0));
}

// 건력 상태 해제: 봉인된 최대 HP 복구 (버프 칩 정리는 호출부 책임 — expireBuff 경유 시 tick 루프가 제거)
function clearPartyGunryeok(member) {
    const r = member && member.runtime;
    if (!r || !r.gunryeok) return false;
    r.hpMax = Math.max(1, Number(r.gunryeok.originalHpMax || r.hpMax));
    delete r.gunryeok;
    return true;
}

function clearPartyGunryeokOnSkillUse(room, member) {
    if (!clearPartyGunryeok(member)) return;
    if (member.runtime && Array.isArray(member.runtime.buffs)) member.runtime.buffs = member.runtime.buffs.filter(b => b.id !== 'gunryeok');
    pushCombat(room, member.name + ' [건력] 상태 해제 (스킬 사용)', 'buff');
}

function getPartyDynamicDefenseStats(member) {
    const stats = Object.assign({}, member && member.baseSnapshot && member.baseSnapshot.stats || {});
    const state = member && member.runtime && member.runtime.equipmentState || {};
    if (state.liberationBuff && Date.now() < Number(state.liberationBuff.expiredAt || 0) && (state.liberationBuff.choices || []).includes('resist')) {
        stats.allElementRes = Number(stats.allElementRes || 0) + Number(state.liberationBuff.resistValue || 0);
    }
    return stats;
}

function getActiveKingElementBonus(member) {
    const buffs = member && member.runtime && member.runtime.kingmakerBuffs || {};
    return Object.keys(buffs).reduce((sum, key) => {
        const buff = buffs[key];
        return sum + (buff && Date.now() < Number(buff.expiredAt || 0) ? Number(buff.allElementAtk || 0) : 0);
    }, 0);
}

function getPartyShieldMultiplier(member) {
    return Math.max(0, 1 + Number(member && member.baseSnapshot && member.baseSnapshot.stats && member.baseSnapshot.stats.shieldEfficiency || 0));
}

function getPartyRecoveryMultiplier(member) {
    return Math.max(0, 1 + Number(member && member.baseSnapshot && member.baseSnapshot.stats && member.baseSnapshot.stats.recoveryEfficiency || 0));
}

function getPartyGoldBonus(member) {
    let value = Number(member && member.baseSnapshot && member.baseSnapshot.stats && member.baseSnapshot.stats.gold || 0);
    const state = member && member.runtime && member.runtime.equipmentState || {};
    if (Date.now() < Number(state.beomStacksUntil || 0)) value += Math.min(7, Number(state.beomStacks || 0)) * .01;
    if (state.kyochonGoldBuff && Date.now() < Number(state.kyochonGoldBuff.expiredAt || 0)) value += Number(state.kyochonGoldBuff.value || 0);
    return value;
}

function getPartyConditionalFinalAttack(member) {
    let value = 0;
    if (Number(member && member.runtime && member.runtime.shield || 0) > 0) value += getTranscendStageValue(member, '강릉함씨 32대손', .18, .05);
    return value;
}

function canPartyApplyShield(source, target) {
    const sourceDisabled = Number(source && source.baseSnapshot && source.baseSnapshot.stats && source.baseSnapshot.stats.disableShield || 0) > 0;
    const targetDisabled = Number(target && target.baseSnapshot && target.baseSnapshot.stats && target.baseSnapshot.stats.disableShield || 0) > 0;
    return !sourceDisabled && !targetDisabled;
}

function canPartyReceiveHealing(member) {
    const state = member && member.runtime && member.runtime.equipmentState;
    return !(state && Date.now() < Number(state.ignoreHealingUntil || 0));
}

function applyTranscendAllyEffect(room, source, target, kind) {
    if (!source || !target || source === target || !target.runtime || target.runtime.dead) return;
    const durationBonus = getEquipmentEffectDurationBonus(source);
    const durationMs = (10 + durationBonus) * 1000;
    if (!target.runtime.equipmentAtkBuffs) target.runtime.equipmentAtkBuffs = {};
    const sanctuaryHat = getTranscendStageValue(source, '성역의 인도자 모자', .08, .03);
    if (sanctuaryHat > 0) target.runtime.equipmentAtkBuffs.sanctuaryHat = { value: scalePartyAttackBuff(source, sanctuaryHat), expiredAt: Date.now() + durationMs };
    if (getTranscendSetCount(source, '성역의 인도자') >= 4) target.runtime.equipmentAtkBuffs.sanctuarySet = { value: scalePartyAttackBuff(source, .25), expiredAt: Date.now() + durationMs };

    const sourceState = source.runtime.equipmentState || (source.runtime.equipmentState = {});
    if (getTranscendSetCount(source, '킹메이커') >= 4 && !sourceState.kingmakerUsed) {
        sourceState.kingmakerUsed = true;
        const kingDuration = (20 + durationBonus) * 1000;
        const key = 'kingmaker:' + source.name;
        target.runtime.equipmentAtkBuffs[key] = { value: scalePartyAttackBuff(source, .18), expiredAt: Date.now() + kingDuration };
        if (!target.runtime.kingmakerBuffs) target.runtime.kingmakerBuffs = {};
        target.runtime.kingmakerBuffs[key] = { allElementAtk: 80, takenDamageReduction: .05, expiredAt: Date.now() + kingDuration };
        pushCombat(room, source.name + ' [킹메이커] → ' + target.name + ' 킹 지정 (20초)', 'buff');
    }

    if (kind === 'shield') {
        const sanctuaryArmor = getTranscendStageValue(source, '성역의 인도자 아머', .02, .02);
        if (sanctuaryArmor > 0 && Number(target.runtime.hp || 0) / Math.max(1, Number(target.runtime.hpMax || 1)) <= .50 && canPartyApplyShield(source, target)) {
            target.runtime.shield = Number(target.runtime.shield || 0) + Math.max(1, Math.round(target.runtime.hpMax * sanctuaryArmor * getPartyShieldMultiplier(source)));
        }
        const pantsMp = getTranscendStageValue(source, '성역의 인도자 트라우저', .01, .01);
        if (pantsMp > 0) target.runtime.mp = Math.min(target.runtime.mpMax, target.runtime.mp + Math.max(1, Math.round(target.runtime.mpMax * pantsMp)));
        if (getTranscendEquipmentEntry(source, '구원자의 하의')) {
            target.runtime.mp = Math.min(target.runtime.mpMax, target.runtime.mp + Math.max(1, Math.round(target.runtime.mpMax * .04)));
            source.runtime.mp = Math.min(source.runtime.mpMax, source.runtime.mp + Math.max(1, Math.round(source.runtime.mpMax * .02)));
        }
    }
}

// 장비 효과 지속시간 증가/쿨타임 감소는 스탯(equipmentEffectDurationFlat: 행운의 복주머니 등, equipmentEffectCooldownFlat: TCG의 유산 2세트)으로 공통 적용 (솔로와 동일)
function getEquipmentEffectDurationBonus(member) {
    return Number(member && member.baseSnapshot && member.baseSnapshot.stats && member.baseSnapshot.stats.equipmentEffectDurationFlat || 0);
}

function getEquipmentEffectCooldownReduction(member) {
    return Number(member && member.baseSnapshot && member.baseSnapshot.stats && member.baseSnapshot.stats.equipmentEffectCooldownFlat || 0);
}

function applyPartyCurrentShoesOnSkillHit(room, member, skillName) {
    if (!skillName || !getTranscendEquipmentEntry(member, '해류를 거스르는 신발')) return;
    const runtime = member.runtime;
    const state = runtime.equipmentState || (runtime.equipmentState = {});
    const now = Date.now();
    if (now < Number(state.currentShoesReadyAt || 0)) return;
    const cooldownEnd = Number(runtime.cooldownsUntil && runtime.cooldownsUntil[skillName] || now);
    const remaining = Math.max(0, cooldownEnd - now);
    const reduction = Math.min(5000, remaining * .08);
    runtime.cooldownsUntil[skillName] = Math.max(now, cooldownEnd - reduction);
    runtime.mp = Math.min(runtime.mpMax, Number(runtime.mp || 0) + Math.max(1, Math.round(Number(runtime.mpMax || 0) * .03)));
    state.currentShoesReadyAt = now + Math.max(0, 8 - getEquipmentEffectCooldownReduction(member)) * 1000;
    pushCombat(room, member.name + ' [해류를 거스르는 신발] 쿨타임 ' + (reduction / 1000).toFixed(1) + '초 감소 / MP 3% 회복', 'buff');
}

function preparePartyTranscendSkill(member, skillName, isUltimate, room) {
    const runtime = member.runtime;
    const state = JSON.parse(JSON.stringify(runtime.equipmentState || {}));
    const now = Date.now();
    const sinceSkill = now - Number(state.lastSkillAt || state.combatStartedAt || now);
    const extra = {};
    const result = { extra, mpCostMul: 1, cooldownFlat: 0, cooldownOverride: null, state };
    let virtualHp = Number(runtime.hp || 0);
    const durationBonus = getEquipmentEffectDurationBonus(member);
    const cooldownReduction = getEquipmentEffectCooldownReduction(member);
    const markHpCost = () => { if (getTranscendEquipmentEntry(member, '흐르는 피')) state.flowingBloodNext = getTranscendStageValue(member, '흐르는 피', .12, .04); };
    const spendHp = rate => {
        const cost = Math.max(1, Math.floor(virtualHp * Number(rate || 0)));
        virtualHp = Math.max(1, virtualHp - cost);
        result.hpAfter = virtualHp;
        markHpCost();
    };

    if (getTranscendEquipmentEntry(member, '불량 배터리') && Math.random() < .20) {
        result.noMp = true;
        extra.damageBonusMul = Number(extra.damageBonusMul || 0) - .12;
    }
    if (getTranscendEquipmentEntry(member, '썩어버린 물')) {
        const stacksBeforeSkill = Math.min(3, Number(state.rottenWaterStacks || 0));
        result.mpCostMul *= 1 + .06 * stacksBeforeSkill;
        extra.damageBonusMul = Number(extra.damageBonusMul || 0) + stacksBeforeSkill * getTranscendStageValue(member, '썩어버린 물', .05, .02);
        if (skillName === '청정수 투척') state.rottenWaterStacks = Math.min(3, stacksBeforeSkill + 1);
    }
    if (getTranscendEquipmentEntry(member, '모노레일 타이머') && sinceSkill >= 15000) extra.critMulBonus = Number(extra.critMulBonus || 0) + getTranscendStageValue(member, '모노레일 타이머', .40, .08);
    if (getTranscendEquipmentEntry(member, '결합 타이머') && sinceSkill >= 10000) extra.extraDamageBonus = Number(extra.extraDamageBonus || 0) + getTranscendStageValue(member, '결합 타이머', .20, .07);
    if (getTranscendEquipmentEntry(member, '십결모 타이머') && sinceSkill >= 10000) {
        extra.damageBonusMul = Number(extra.damageBonusMul || 0) + .30;
        extra.critChanceBonus = Number(extra.critChanceBonus || 0) + .25;
    }
    if (getTranscendSetCount(member, '딜레이') >= 4 && sinceSkill >= 15000) {
        extra.finalDamageBonus = Number(extra.finalDamageBonus || 0) + .25;
        extra.pntBonus = Number(extra.pntBonus || 0) + 100;
        result.mpCostMul *= 1.25;
    }
    if (getTranscendSetCount(member, '복선 회수') >= 4 && getPartyAttackOrderPreview(member) === 1) result.mpCostMul *= .80;
    if (getTranscendEquipmentEntry(member, 'DMC 마이크')) {
        state.dmcSkillCount = Number(state.dmcSkillCount || 0) + 1;
        if (state.dmcSkillCount % 3 === 0) extra.finalDamageBonus = Number(extra.finalDamageBonus || 0) + getTranscendStageValue(member, 'DMC 마이크', .40, .10);
    }
    if (skillName === '백억이요' && getTranscendEquipmentEntry(member, '범부의 대나무')) {
        if (now >= Number(state.beomStacksUntil || 0)) state.beomStacks = 0;
        state.beomStacks = Math.min(7, Number(state.beomStacks || 0) + 1);
        state.beomStacksUntil = now + (10 + durationBonus) * 1000;
        if (state.beomStacks >= 7) state.trueBeomUntil = now + (10 + durationBonus) * 1000;
    }
    if (getTranscendEquipmentEntry(member, '운명의 주사위') && now >= Number(state.destinyDiceReadyAt || 0)) {
        const types = getTranscendSetCount(member, 'TCG의 유산') >= 4 ? ['crit', 'critMul'] : [Math.random() < .5 ? 'crit' : 'critMul'];
        state.destinyDiceBuff = { types, expiredAt: now + (8 + durationBonus) * 1000 };
        state.destinyDiceReadyAt = now + Math.max(0, 15 - cooldownReduction) * 1000;
    }
    if (state.destinyDiceBuff && now < Number(state.destinyDiceBuff.expiredAt || 0)) {
        const types = state.destinyDiceBuff.types || [state.destinyDiceBuff.type];
        if (types.includes('crit')) extra.critChanceBonus = Number(extra.critChanceBonus || 0) + getTranscendStageValue(member, '운명의 주사위', .15, .04);
        if (types.includes('critMul')) extra.critMulBonus = Number(extra.critMulBonus || 0) + getTranscendStageValue(member, '운명의 주사위', .30, .08);
    }
    if (getTranscendEquipmentEntry(member, '심판의 주사위') && now >= Number(state.judgeDiceReadyAt || 0)) {
        const types = getTranscendSetCount(member, 'TCG의 유산') >= 4 ? ['crit', 'critMul'] : [Math.random() < .5 ? 'crit' : 'critMul'];
        state.judgeDiceBuff = { types, expiredAt: now + (10 + durationBonus) * 1000 };
        state.judgeDiceReadyAt = now + Math.max(0, 14 - cooldownReduction) * 1000;
    }
    if (state.judgeDiceBuff && now < Number(state.judgeDiceBuff.expiredAt || 0)) {
        const types = state.judgeDiceBuff.types || [state.judgeDiceBuff.type];
        if (types.includes('crit')) extra.critChanceBonus = Number(extra.critChanceBonus || 0) + .30;
        if (types.includes('critMul')) extra.critMulBonus = Number(extra.critMulBonus || 0) + .50;
    }
    if (skillName === '자인' && getTranscendEquipmentEntry(member, '궁택토')) result.cooldownOverride = 0;
    if (getTranscendEquipmentEntry(member, '감옥열쇠')) {
        const overflowCrit = Math.max(0, Number(member.baseSnapshot.stats.crit || 0) - 1);
        extra.damageBonusMul = Number(extra.damageBonusMul || 0) + overflowCrit * getTranscendStageValue(member, '감옥열쇠', .20, .10);
    }
    if (isUltimate) {
        // 궁극기 스킬 피해(ultimateDamage) / 궁극기 쿨타임 감소(ultimateCooldownFlat, ms): 초심권 등 스탯 보유 장비 공통 (솔로와 동일 규칙)
        const memberStats = member.baseSnapshot && member.baseSnapshot.stats || {};
        if (Number(memberStats.ultimateCooldownFlat || 0) > 0) result.cooldownFlat += Number(memberStats.ultimateCooldownFlat) / 1000;
        if (Number(memberStats.ultimateDamage || 0) != 0) extra.damageBonusMul = Number(extra.damageBonusMul || 0) + Number(memberStats.ultimateDamage);
    }
    if (skillName === '끝판왕' && getTranscendEquipmentEntry(member, 'Lv1 초보')) {
        extra.damageBonusMul = Number(extra.damageBonusMul || 0) + getTranscendStageValue(member, 'Lv1 초보', 1.30, .40);
        if (Number(runtime.hp || 0) / Math.max(1, Number(runtime.hpMax || 1)) <= .30) extra.finalDamageBonus = Number(extra.finalDamageBonus || 0) + getTranscendStageValue(member, 'Lv1 초보', .40, .15);
    }
    if (skillName === '청정수 투척' && getTranscendEquipmentEntry(member, '정수 필터망')) {
        extra.pntBonus = Number(extra.pntBonus || 0) + getTranscendStageValue(member, '정수 필터망', 25, 10);
        state.cleanWaterBuff = { value: getTranscendStageValue(member, '정수 필터망', .08, .03), expiredAt: now + (6 + durationBonus) * 1000 };
    }
    if (skillName === '비리' && getTranscendEquipmentEntry(member, '치명적인 매력')) {
        const crit = Math.max(0, Number(member.baseSnapshot.stats.crit || 0));
        extra.critChanceBonus = Number(extra.critChanceBonus || 0) - crit;
        extra.critMulBonus = Number(extra.critMulBonus || 0) + crit * getTranscendStageValue(member, '치명적인 매력', .70, .15);
    }
    if (skillName === '비리' && getTranscendEquipmentEntry(member, '비리의 맛')) {
        state.bribeNextBasic = {
            damage: getTranscendStageValue(member, '비리의 맛', .40, .12),
            darkBonus: getTranscendStageValue(member, '비리의 맛', .65, .15)
        };
    }
    if (skillName === '초특급한탕') {
        result.superJackpot = Math.random() < .10;
        if (!result.superJackpot && getTranscendEquipmentEntry(member, '교촌 주머니')) {
            result.cooldownFlat += 30;
            state.kyochonGoldBuff = { value: getTranscendStageValue(member, '교촌 주머니', .10, .05), expiredAt: now + (30 + durationBonus) * 1000 };
            if (getTranscendEquipmentEntry(member, '행운의 복주머니')) state.fortuneExtraDamage = { value: getTranscendStageValue(member, '행운의 복주머니', .10, .05), expiredAt: now + (10 + durationBonus) * 1000 };
        }
    }
    if (getTranscendSetCount(member, '심해의 순환') >= 4 && now >= Number(state.deepSetReadyAt || 0)) {
        result.reduceUltimateCooldown = 3;
        state.deepSetReadyAt = now + Math.max(0, 12 - cooldownReduction) * 1000;
    }
    if (getTranscendEquipmentEntry(member, '심해의 신발')) {
        result.selfCooldownRate = getTranscendStageValue(member, '심해의 신발', .04, .01);
        result.selfCooldownCap = 3;
    }
    if (getTranscendEquipmentEntry(member, '심해의 모자')) {
        state.deepNextBasic = getTranscendStageValue(member, '심해의 모자', .60, .15);
        state.deepWaterAttackBuff = { value: .08, expiredAt: now + (6 + durationBonus) * 1000 };
    }
    if (getTranscendEquipmentEntry(member, '심해의 갑옷') && !Number(member.baseSnapshot.stats.disableShield || 0)) {
        result.selfShield = Math.max(1, Math.round(runtime.hpMax * getTranscendStageValue(member, '심해의 갑옷', .05, .01) * getPartyShieldMultiplier(member)));
        result.selfShieldDuration = 5 + durationBonus;
    }
    if (getTranscendEquipmentEntry(member, '검은 잔향 신발') && now >= Number(state.blackEchoShoesReadyAt || 0)) {
        state.blackEchoShoesBuff = { value: getTranscendStageValue(member, '검은 잔향 신발', .07, .03), expiredAt: now + (60 + durationBonus) * 1000 };
        state.blackEchoShoesReadyAt = now + Math.max(0, 60 - cooldownReduction) * 1000;
    }
    if (getTranscendSetCount(member, '검은 잔향') >= 4 && now >= Number(state.blackEchoSetReadyAt || 0)) {
        spendHp(.02);
        result.shadowDamageRate = virtualHp / Math.max(1, Number(runtime.hpMax || 1)) <= .50 ? .50 : .35;
        state.blackEchoSetReadyAt = now + Math.max(0, 12 - cooldownReduction) * 1000;
    }
    if (getTranscendEquipmentEntry(member, '심연의 신발')) {
        if (virtualHp / Math.max(1, Number(runtime.hpMax || 1)) > .50) spendHp(.02);
        state.darkAttackBuff = { value: .25, expiredAt: now + (12 + durationBonus) * 1000 };
        state.abyssBuff = { expiredAt: now + (12 + durationBonus) * 1000 };
    }
    const burn = room && room.monster && Array.isArray(room.monster.debuffs) && room.monster.debuffs.find(d => d.id === 'emberBurn:' + member.name && d.type === 'dot');
    if (burn) {
        const mythic = getTranscendEquipmentEntry(member, '종말을 걷는 장송곡');
        const emberStage = getTranscendEquipmentEntry(member, '잿불 신발');
        const readyKey = mythic ? 'mythicBurnShoesReadyAt' : 'emberShoesReadyAt';
        const cooldownSeconds = mythic ? 8 : 10;
        if ((mythic || emberStage) && now >= Number(state[readyKey] || 0)) {
            const remainingTicks = Math.max(0, Math.ceil(Number(burn.remain || 0) / Number(burn.interval || 2)));
            const rate = mythic ? 1 : getTranscendStageValue(member, '잿불 신발', .60, .10);
            extra.oneTimeFinalDamage = Number(extra.oneTimeFinalDamage || 0) + Math.round(Number(burn.dmg || 0) * remainingTicks * rate);
            result.removeBurnId = burn.id;
            state[readyKey] = now + Math.max(0, cooldownSeconds - cooldownReduction) * 1000;
            if (mythic) result.hellfire = { id: 'hellfire:' + member.name, label: '겁화', type: 'dot', dmg: Math.max(1, Math.round(Number(member.baseSnapshot.stats.atk || 0) * .50)), interval: 2, tick: 2, remain: 6, sourceName: member.name, sourceSkill: '겁화' };
        }
    }
    state.lastSkillAt = now;
    return result;
}

function commitPartySkillEquipmentSideEffects(room, equipmentSkill) {
    if (!room || !room.monster || !equipmentSkill) return;
    if (equipmentSkill.removeBurnId && Array.isArray(room.monster.debuffs)) room.monster.debuffs = room.monster.debuffs.filter(d => d.id !== equipmentSkill.removeBurnId);
    if (equipmentSkill.hellfire) addMonsterDebuff(room.monster, equipmentSkill.hellfire);
}

function toPartyMainCardSkillDef(entry) {
    const skill = entry.skill;
    return {
        type: 'active',
        source: 'mainCard',
        mp: Number(skill.mp_cost || 0),
        cd: Number(skill.cooltime || 0) / 1000,
        target: skill.name === '글버지' ? 'allAllies' : 'enemy',
        desc: skill.desc || '',
        raw: skill,
        star: entry.star
    };
}

// 장착 장비 패시브 보유 여부. rpgenius.getEquippedPassiveIds가 7부위(무기/모자/갑옷/하의/신발/장신구/보조)와
// 효과 적용 조건(isEquipmentEffectActive)까지 솔로와 동일하게 판정한다. 폴백은 export가 없을 때만 사용.
function hasEquippedPassive(user, passiveId) {
    if (!user) return false;
    if (typeof rpgenius.getEquippedPassiveIds === 'function') return rpgenius.getEquippedPassiveIds(user).has(passiveId);
    const eq = user.equipments || {};
    const slots = [
        ...['weapon', 'hat', 'armor', 'pants', 'shoes'].map(type => [type, eq[type]]),
        ...Object.values(eq.accessory || {}).map(e => ['accessory', e]),
        ['support', eq.support]
    ];
    let equipments = typeof rpgenius.getDataCache === 'function' ? rpgenius.getDataCache('Equipment', {}) : {};
    if (!equipments || typeof equipments !== 'object') equipments = loadJsonCached(EQUIPMENT_PATH, 'equipment');
    for (const [slot, equip] of slots) {
        if (!equip || typeof equip.id === 'undefined') continue;
        const data = equipments && equipments[slot] && equipments[slot][equip.id];
        if (data && data.passive_id === passiveId) return true;
    }
    return false;
}

function getImmortalArmorSnapshot(user) {
    if (!hasEquippedPassive(user, 3)) return null;
    return { readyAt: Number(user.equipmentPassiveCd && user.equipmentPassiveCd.immortalDragonArmor || 0) };
}

function getManaResonanceSnapshot(user) {
    if (!hasEquippedPassive(user, 4)) return null;
    const passives = typeof rpgenius.getEquipmentPassives === 'function' ? rpgenius.getEquipmentPassives() : [];
    const passive = passives[4];
    if (!passive) return null;
    return {
        threshold: Number(passive.format && passive.format[0] && passive.format[0].base || 0.75),
        bonus: Number(passive.format && passive.format[1] && passive.format[1].base || 0.05)
    };
}

function getThornsSnapshot(user) {
    if (!hasEquippedPassive(user, 5)) return null;
    const passives = typeof rpgenius.getEquipmentPassives === 'function' ? rpgenius.getEquipmentPassives() : [];
    const passive = passives[5];
    if (!passive) return null;
    return { ratio: Number(passive.format && passive.format[0] && passive.format[0].base || 0) };
}

function getPartyQuestPacks() {
    const cached = typeof rpgenius.getDataCache === 'function' ? rpgenius.getDataCache('Pack', []) : [];
    return Array.isArray(cached) && cached.length ? cached : loadJsonCached(PACKS_PATH, 'packs');
}

function addPartyQuestRewardSummary(summary, key, label, count) {
    if (!summary[key]) summary[key] = { label, count: 0 };
    summary[key].count += Number(count || 0);
}

function addPartyQuestExperience(user, amount) {
    user.level = Number(user.level || 1);
    user.exp = Number(user.exp || 0) + Number(amount || 0);
    let levelUps = 0;
    let need = typeof rpgenius.getMaxExpForLevel === 'function' ? rpgenius.getMaxExpForLevel(user.level) : 0;
    while (need > 0 && user.exp >= need) {
        user.exp -= need;
        user.level += 1;
        levelUps++;
        need = rpgenius.getMaxExpForLevel(user.level);
    }
    if (levelUps > 0) user.statPoint = Number(user.statPoint || 0) + levelUps;
    return levelUps;
}

function pickPartyQuestPackEntry(pack) {
    const roll = Math.random();
    let current = 0;
    for (const entry of pack || []) {
        current += Number(entry && entry.roll || 0);
        if (roll <= current) return entry;
    }
    return Array.isArray(pack) ? pack[pack.length - 1] : null;
}

function rollPartyQuestCount(count) {
    if (!count) return 1;
    if (typeof count === 'number') return count;
    return randomInt(Number(count.min || 1), Number(count.max || 1));
}

function addPartyQuestEquipment(user, type, id) {
    if (!user.inventory) user.inventory = { card: [], item: [], equipment: [] };
    if (!Array.isArray(user.inventory.equipment)) user.inventory.equipment = [];
    user.inventory.equipment.push({ type, id: Number(id), level: 0 });
}

function buildPartyQuestCharacterCardReward(entry) {
    const cards = loadJsonCached(CHARACTER_CARDS_PATH, 'cards');
    let id = entry.card_id != null ? Number(entry.card_id) : (entry.character_card_id != null ? Number(entry.character_card_id) : (entry.id != null ? Number(entry.id) : -1));
    if (!Number.isInteger(id) || id < 0) id = randomInt(0, Math.max(0, cards.length - 1));
    if (!cards[id]) return null;
    let star = 0;
    if (entry.display_star != null) star = Math.max(0, Number(entry.display_star) - 1);
    else if (entry.star_display != null) star = Math.max(0, Number(entry.star_display) - 1);
    else if (entry.star && typeof entry.star === 'object') star = Math.max(0, rollPartyQuestCount(entry.star) - 1);
    else if (entry.range && typeof entry.range === 'object') star = Math.max(0, randomInt(Number(entry.range.min || 1), Number(entry.range.max || entry.range.min || 1)) - 1);
    else star = Math.max(0, Number(entry.star || 0));
    const card = { id, star, type: entry.card_type || entry.cardType || '일반' };
    if (entry.skin) card.skin = String(entry.skin);
    return card;
}

function grantPartyQuestPackReward(user, reward, summary) {
    if (!reward) return null;
    const items = typeof rpgenius.getDataCache === 'function' ? rpgenius.getDataCache('Item', []) : [];
    const equipments = typeof rpgenius.getDataCache === 'function' ? rpgenius.getDataCache('Equipment', {}) : {};
    const count = rollPartyQuestCount(reward.count);
    if (reward.type === '아이템') {
        rpgenius.addInventoryItem(user, reward.item_id, count);
        const item = items[reward.item_id];
        addPartyQuestRewardSummary(summary, 'item:' + reward.item_id, item ? item.name : '알 수 없는 아이템', count);
        return { kind: 'item', itemId: Number(reward.item_id), name: item ? item.name : '알 수 없는 아이템', count };
    }
    if (reward.type === '캐릭터카드') {
        if (!user.inventory) user.inventory = { card: [], item: [], equipment: [] };
        if (!Array.isArray(user.inventory.card)) user.inventory.card = [];
        let last = null;
        for (let i = 0; i < count; i++) {
            const card = buildPartyQuestCharacterCardReward(reward);
            if (!card) continue;
            user.inventory.card.push(card);
            last = card;
            addPartyQuestRewardSummary(summary, 'card:' + card.id + ':' + card.star + ':' + (card.type || '일반') + ':' + (card.skin || ''), rpgenius.formatUserCard(card), 1);
        }
        return last ? { kind: 'card', card: last, name: rpgenius.formatUserCard(last), count } : null;
    }
    if (reward.type === '골드') {
        user.gold = Number(user.gold || 0) + count;
        addPartyQuestRewardSummary(summary, 'packGold', '🪙 골드', count);
        return { kind: 'currency', currency: 'gold', name: '골드', count };
    }
    if (reward.type === '가넷') {
        user.garnet = Number(user.garnet || 0) + count;
        addPartyQuestRewardSummary(summary, 'garnet', '💠 가넷', count);
        return { kind: 'currency', currency: 'garnet', name: '가넷', count };
    }
    if (reward.type === '마일리지') {
        user.mileage = Number(user.mileage || 0) + count;
        addPartyQuestRewardSummary(summary, 'mileage', 'Ⓜ️ 마일리지', count);
        return { kind: 'currency', currency: 'mileage', name: '마일리지', count };
    }
    if (reward.type === '펫') {
        for (let i = 0; i < count; i++) rpgenius.addPetInventory(user, Number(reward.pet_id));
        const pet = typeof rpgenius.getPetData === 'function' ? rpgenius.getPetData(Number(reward.pet_id)) : null;
        const name = pet ? '<' + pet.rarity + '> ' + pet.name + ' (펫)' : '알 수 없는 펫';
        addPartyQuestRewardSummary(summary, 'pet:' + reward.pet_id, name, count);
        return { kind: 'pet', petId: Number(reward.pet_id), name, count };
    }
    // 등급 지정 랜덤 장비 (예: 고유 등급 보조장비)
    if (reward.type === '랜덤장비') {
        const map = { '무기': 'weapon', '갑옷': 'armor', '장신구': 'accessory', '보조': 'support' };
        const slot = map[reward.part] || 'support';
        const list = (equipments[slot] || []);
        const ids = list.map((d, i) => (d && d.rarity === reward.rarity ? i : -1)).filter(i => i >= 0);
        if (!ids.length) return null;
        const id = ids[randomInt(0, ids.length - 1)];
        addPartyQuestEquipment(user, slot, id);
        const name = '<' + list[id].rarity + '> ' + list[id].name;
        addPartyQuestRewardSummary(summary, slot + ':' + id, name, 1);
        return { kind: 'equipment', equipType: slot, equipmentId: id, rarity: list[id].rarity, name, count: 1 };
    }
    // 보주 랜덤 (use:'보주' 아이템 중 균등 1개)
    if (reward.type === '보주랜덤') {
        const ids = items.map((it, i) => (it && it.use === '보주' ? i : -1)).filter(i => i >= 0);
        if (!ids.length) return null;
        const id = ids[randomInt(0, ids.length - 1)];
        rpgenius.addInventoryItem(user, id, count);
        addPartyQuestRewardSummary(summary, 'item:' + id, items[id].name, count);
        return { kind: 'item', itemId: id, name: items[id].name, count };
    }
    const equipmentMap = { '무기': ['weapon', 'weapon_id'], '갑옷': ['armor', 'armor_id'], '장신구': ['accessory', 'accessory_id'], '보조': ['support', 'support_id'] };
    const eq = equipmentMap[reward.type];
    if (eq) {
        addPartyQuestEquipment(user, eq[0], reward[eq[1]]);
        const data = equipments[eq[0]] && equipments[eq[0]][reward[eq[1]]];
        const name = data ? '<' + data.rarity + '> ' + data.name : '알 수 없는 장비';
        addPartyQuestRewardSummary(summary, eq[0] + ':' + reward[eq[1]], name, 1);
        return { kind: 'equipment', equipType: eq[0], equipmentId: Number(reward[eq[1]]), rarity: data && data.rarity, name, count: 1 };
    }
    return null;
}

function pickPartyQuestRewardEntry(entries) {
    const list = Array.isArray(entries) ? entries : [];
    const roll = Math.random();
    let current = 0;
    for (let i = 0; i < list.length; i++) {
        current += Number(list[i] && list[i].roll || 0);
        if (roll <= current) return { entry: list[i], index: i };
    }
    return list.length ? { entry: list[list.length - 1], index: list.length - 1 } : { entry: null, index: -1 };
}

function getPartyQuestItemAsset(itemId, rewardIndex) {
    const items = typeof rpgenius.getDataCache === 'function' ? rpgenius.getDataCache('Item', []) : [];
    const item = items[Number(itemId)];
    const frameFile = Number(rewardIndex || 0) === 1 ? '특수.png' : '아이템.png';
    // 보주는 type이 '사용'이지만 이미지는 itemImage/보주/에 있다
    const dir = item && item.use === '보주' ? '보주' : String((item && item.type) || '아이템');
    return {
        frameUrl: '/item-image?dir=' + encodeURIComponent('프레임') + '&file=' + encodeURIComponent(frameFile),
        iconUrl: item ? '/item-image?dir=' + encodeURIComponent(dir) + '&file=' + encodeURIComponent(String(item.name) + '.png') : null
    };
}

function isButaQuest(questId) {
    return questId === 'butaGame' || questId === 'butaGameHard';
}

function grantPartyQuestClearRewards(room) {
    (async () => {
        const quest = getQuestById(room.questId);
        const rewards = quest && quest.rewards || {};
        const packs = getPartyQuestPacks();
        const results = [];
        for (const member of room.members) {
            try {
                const user = await rpgenius.getRPGUserByName(member.name);
                if (!user) continue;
                // 퀘스트: 파티 퀘스트 클리어 집계 (인원 조건 포함, 아래 user.save로 저장)
                if (typeof rpgenius.recordQuestEvent === 'function') {
                    rpgenius.recordQuestEvent(user, 'partyClear', { quest: quest && quest.name || '', members: room.members.length });
                }
                const summary = {};
                // 부타게임 주간 보상 제한 (노말/하드 통합 주 1회, 월요일 0시 KST 초기화).
                // 입장/클리어는 무제한이고 칭호 진행도는 계속 쌓인다.
                const prog = rpgenius.getTitleProgress(user);
                const weekKey = rpgenius.getKoreanWeekKey(new Date());
                // 흑화 호두 주간 보상 제한: 노말/익스트림 통합 주 최대 3회 (입장/클리어/칭호 진행도/최초 클리어 보너스는 무제한)
                const isHodu = room.questId === 'blackHodu' || room.questId === 'blackHoduExtreme';
                const hoduRewardCount = isHodu && prog.hoduRewardWeek === weekKey ? Number(prog.hoduRewardCount || 0) : 0;
                const weeklyLocked = (isButaQuest(room.questId) && prog.butaRewardWeek === weekKey)
                    || (isHodu && hoduRewardCount >= HODU_WEEKLY_REWARD_LIMIT);
                const exp = weeklyLocked ? 0 : Math.max(0, Math.round(Number(rewards.exp || 0)));
                const levelUps = exp > 0 ? addPartyQuestExperience(user, exp) : 0;
                if (exp > 0) addPartyQuestRewardSummary(summary, 'exp', 'XP', exp);
                const goldDef = rewards.gold || {};
                const baseGold = weeklyLocked ? 0 : (typeof goldDef === 'number'
                    ? Math.max(0, Math.round(goldDef))
                    : randomInt(Math.max(0, Number(goldDef.min || 0)), Math.max(0, Number(goldDef.max || goldDef.min || 0))));
                const gold = Math.max(0, Math.round(baseGold * (1 + getPartyGoldBonus(member))));
                if (gold > 0) {
                    user.gold = Number(user.gold || 0) + gold;
                    addPartyQuestRewardSummary(summary, 'gold', '🪙 골드', gold);
                }
                const equipmentGold = Math.max(0, Math.round(Number(member.runtime && member.runtime.pendingEquipmentGold || 0)));
                if (equipmentGold > 0) {
                    user.gold = Number(user.gold || 0) + equipmentGold;
                    addPartyQuestRewardSummary(summary, 'equipmentGold', '🪙 장비 효과 골드', equipmentGold);
                    member.runtime.pendingEquipmentGold = 0;
                }
                const selected = pickPartyQuestRewardEntry(rewards.reward);
                let itemReward = null;
                if (!weeklyLocked && selected.entry && typeof selected.entry.pack !== 'undefined') {
                    const pack = packs[Number(selected.entry.pack)];
                    const packEntry = Array.isArray(pack) ? pickPartyQuestPackEntry(pack) : null;
                    itemReward = grantPartyQuestPackReward(user, packEntry, summary);
                    if (itemReward && itemReward.kind === 'item') Object.assign(itemReward, getPartyQuestItemAsset(itemReward.itemId, selected.index));
                    if (itemReward) {
                        itemReward.rewardIndex = selected.index;
                        itemReward.pack = Number(selected.entry.pack);
                    }
                }
                // 기본 보상(전부 지급) + 추가 보상(가중 1개 추첨)
                const extraRewards = [];
                if (!weeklyLocked) {
                    for (const entry of (Array.isArray(rewards.base) ? rewards.base : [])) {
                        const granted = grantPartyQuestPackReward(user, entry, summary);
                        if (granted) extraRewards.push(granted);
                    }
                    if (Array.isArray(rewards.bonus) && rewards.bonus.length) {
                        const granted = grantPartyQuestPackReward(user, pickPartyQuestPackEntry(rewards.bonus), summary);
                        if (granted) { granted.bonus = true; extraRewards.push(granted); }
                    }
                }
                for (const r of extraRewards) if (r.kind === 'item') Object.assign(r, getPartyQuestItemAsset(r.itemId, r.bonus ? 1 : 0));
                if (!itemReward && extraRewards.length) itemReward = extraRewards[extraRewards.length - 1];
                // 칭호 진행 추적 (흑화 호두)
                if (isHodu && !weeklyLocked) {
                    prog.hoduRewardWeek = weekKey;
                    prog.hoduRewardCount = hoduRewardCount + 1;
                }
                if (room.questId === 'blackHodu') {
                    prog.hoduClears = Number(prog.hoduClears || 0) + 1;
                    rpgenius.checkAndUnlockTitles(user);
                }
                // 칭호 진행 추적 (부타게임 — 노말/하드 공용 카운터, 주간 제한과 무관하게 적립)
                if (isButaQuest(room.questId)) {
                    prog.butaClears = Number(prog.butaClears || 0) + 1;
                    if (!weeklyLocked) prog.butaRewardWeek = weekKey;
                    rpgenius.checkAndUnlockTitles(user);
                }
                // 흑화 호두 (익스트림) 개인 최초 클리어 보너스 (기존 보상과 별도)
                let firstClear = null;
                if (room.questId === 'blackHoduExtreme' && !rpgenius.getUnlockedTitles(user).includes('hoduExtreme')) {
                    const bonusGold = 1000000;
                    const bonusGarnet = 200;
                    const boxItemId = 137;
                    user.gold = Number(user.gold || 0) + bonusGold;
                    user.garnet = Number(user.garnet || 0) + bonusGarnet;
                    rpgenius.addInventoryItem(user, boxItemId, 1);
                    rpgenius.unlockTitle(user, 'hoduExtreme');
                    const itemCache = typeof rpgenius.getDataCache === 'function' ? rpgenius.getDataCache('Item', []) : [];
                    const boxItem = itemCache[boxItemId];
                    const boxAsset = getPartyQuestItemAsset(boxItemId, 0);
                    firstClear = {
                        questName: (quest && quest.name) || '흑화 호두 (익스트림)',
                        rewards: [
                            { kind: 'item', name: boxItem ? boxItem.name : '흑화 호두 장신구 상자', count: 1, iconUrl: boxAsset.iconUrl, frameUrl: boxAsset.frameUrl },
                            { kind: 'garnet', name: '가넷', count: bonusGarnet },
                            { kind: 'gold', name: '골드', count: bonusGold },
                            { kind: 'title', name: '흑두 익스트림' }
                        ]
                    };
                }
                await user.save();
                results.push({
                    name: member.name,
                    exp,
                    gold,
                    equipmentGold,
                    levelUps,
                    item: itemReward,
                    items: extraRewards,
                    weeklyLocked,
                    firstClear,
                    summary: Object.keys(summary).map(key => ({ label: summary[key].label, count: summary[key].count }))
                });
            } catch (e) {
                console.error('[partyquest] reward grant error:', member.name, e);
                results.push({ name: member.name, error: '보상 지급 실패' });
            }
        }
        room.result.rewards = results;
        pushNotice(room, '보상 지급 완료', 'success', 4500);
        broadcastRoom(room);
    })();
}

function listQuestSummaries() {
    return loadQuests().map(q => ({
        id: q.id,
        name: q.name,
        description: q.description || '',
        minPlayers: q.minPlayers || 1,
        maxPlayers: q.maxPlayers || 5,
        potionLimit: q.potionLimit || 0,
        positions: POSITION_LIST.slice(),
        minLevel: q.minLevel || null,
        recommendedPower: q.recommendedPower || null,
        coverImage: q.coverImage || null
    }));
}

// ===== 방 저장 =====

const rooms = new Map();
const memberIndex = new Map();

function newRoomId() { return crypto.randomBytes(6).toString('hex'); }

function publicRoomList() {
    const out = [];
    for (const room of rooms.values()) {
        if (room.state !== 'lobby' && room.state !== 'preparing') continue;
        out.push({
            id: room.id,
            questId: room.questId,
            questName: getQuestById(room.questId) ? getQuestById(room.questId).name : room.questId,
            hostName: room.hostName,
            memberCount: room.members.length,
            maxPlayers: room.maxPlayers,
            hasPassword: !!room.password,
            state: room.state
        });
    }
    return out;
}

function createPartyBattleStats() {
    return {
        damage: 0,
        damageTaken: 0,
        damageReduced: { defense: 0, resistance: 0, buff: 0, shield: 0, other: 0 },
        allyHealing: 0
    };
}

function getPartyBattleStats(member) {
    if (!member || !member.runtime) return null;
    if (!member.runtime.battleStats) member.runtime.battleStats = createPartyBattleStats();
    return member.runtime.battleStats;
}

function recordPartyDamage(member, result) {
    const stats = getPartyBattleStats(member);
    if (!stats || !result) return;
    const damage = Math.max(0, Math.round(Number(result.damage || 0)));
    if (damage > 0) stats.damage += damage;
}

function recordPartyHealing(source, target, amount) {
    const healed = Math.max(0, Number(amount || 0));
    if (healed <= 0) return;
    const healer = source || target;
    const stats = getPartyBattleStats(healer);
    if (!stats) return;
    if (healer !== target) stats.allyHealing += healed;
}

function recordPartyDamageReduced(member, kind, amount) {
    const stats = getPartyBattleStats(member);
    const reduced = Math.max(0, Number(amount || 0));
    if (!stats || reduced <= 0) return;
    const key = Object.prototype.hasOwnProperty.call(stats.damageReduced, kind) ? kind : 'other';
    stats.damageReduced[key] += reduced;
}

function buildPartyBattleStatistics(room) {
    const members = room.members.map(member => {
        const stats = getPartyBattleStats(member) || createPartyBattleStats();
        const reduced = {
            defense: Math.max(0, Math.round(stats.damageReduced.defense)),
            resistance: Math.max(0, Math.round(stats.damageReduced.resistance)),
            buff: Math.max(0, Math.round(stats.damageReduced.buff)),
            shield: Math.max(0, Math.round(stats.damageReduced.shield)),
            other: Math.max(0, Math.round(stats.damageReduced.other))
        };
        reduced.total = reduced.defense + reduced.resistance + reduced.buff + reduced.shield + reduced.other;
        return {
            name: member.name,
            position: member.position || null,
            card: member.card || null,
            damage: Math.max(0, Math.round(stats.damage)),
            damageTaken: Math.max(0, Math.round(stats.damageTaken)),
            damageReduced: reduced.total,
            allyHealing: Math.max(0, Math.round(stats.allyHealing))
        };
    }).sort((a, b) => b.damage - a.damage);
    return {
        durationSeconds: Math.max(0, Math.round((Date.now() - Number(room.startedAt || Date.now())) / 1000)),
        members
    };
}

function serializeMember(m) {
    return {
        name: m.name,
        level: Number(m.level || 1),
        title: m.title || null,
        card: m.card || null,
        position: m.position || null,
        ready: !!m.ready,
        potions: m.potions.slice(),
        online: !!m.sseRes,
        skills: (m.skills || []).slice(),
        skillDefs: publicSkillDefs(m.skillDefs),
        runtime: m.runtime ? {
            hp: Math.max(0, Math.round(m.runtime.hp)),
            hpMax: Math.round(m.runtime.hpMax),
            mp: Math.max(0, Math.round(m.runtime.mp)),
            mpMax: Math.round(m.runtime.mpMax),
            gauge: Math.max(0, Math.min(100, Math.round(m.runtime.gauge || 0))),
            cooldowns: serializeCooldownsFromUntil(m.runtime.cooldownsUntil),
            // 영구 디버프(remain 센티넬)는 remain: null로 내려 클라가 '몇십만 초'를 찍지 않게 한다
            buffs: (m.runtime.buffs || []).map(b => ({
                id: b.id,
                label: b.label,
                remain: Number(b.remain || 0) >= PERMANENT_BUFF_SEC ? null : Math.max(0, Math.round(b.remain * 10) / 10),
                stack: Math.max(0, Math.round(Number(b.stack || 0)))
            })),
            shield: Math.round(m.runtime.shield || 0),
            sealRemain: Math.max(0, Math.round(Number(m.runtime.sealRemain || 0) * 10) / 10),
            dead: !!m.runtime.dead,
            potionCdRemain: remainSeconds(m.runtime.potionUntil),
            actionCdRemain: remainSeconds(m.runtime.actionUntil),
            actionCdMul: Number(m.runtime.actCdMul || 1),
            attackOrder: getPartyAttackOrderPreview(m),
            sivalonCharge: Math.max(0, Math.min(5, Math.round(Number(m.runtime.sivalonCharge || 0))))
        } : null,
        pendingChoices: m.pendingChoices || null
    };
}

function publicSkillDefs(defs) {
    const out = {};
    if (!defs) return out;
    for (const name of Object.keys(defs)) {
        const d = defs[name];
        out[name] = {
            type: d.type || 'active',
            source: d.source || 'party',
            mp: Number(d.mp || 0),
            cd: Number(d.cd || 0),
            target: d.target || 'enemy',
            desc: d.desc || ''
        };
    }
    return out;
}

function nowMs() { return Date.now(); }

// 전투 시작 카운트다운(클라 3-2-1 연출) 동안 전투를 동결한다.
// 클라 연출(페이드 450 + 카운트 2400 + 개시 950 = 3800ms)과 맞춘 값.
const INTRO_GRACE_MS = 3800;
function isIntroActive(room) {
    return !!(room && room.introUntil && nowMs() < room.introUntil);
}

function remainSeconds(untilMs) {
    if (!untilMs) return 0;
    return Math.max(0, Math.round((untilMs - nowMs()) / 100) / 10);
}

function serializeCooldownsFromUntil(map) {
    const out = {};
    if (!map) return out;
    const t = nowMs();
    for (const k of Object.keys(map)) {
        const v = map[k];
        if (!v) continue;
        const remain = Math.max(0, Math.round((v - t) / 100) / 10);
        if (remain > 0) out[k] = remain;
    }
    return out;

}

function cloneCooldowns(cd) {
    const out = {};
    if (!cd) return out;
    for (const k of Object.keys(cd)) out[k] = Math.max(0, Math.round((cd[k] || 0) * 10) / 10);
    return out;
}

function serializeMonster(mon) {
    if (!mon) return null;
    const gimmick = mon.bossState && mon.bossState.chatGimmick;
    return {
        name: mon.name,
        hp: Math.max(0, Math.round(mon.hp)),
        hpMax: Math.round(mon.hpMax),
        gauge: Math.max(0, Math.min(100, Math.round(mon.gauge || 0))),
        stunRemain: Math.max(0, Math.round(Number(mon.stunRemain || 0) * 10) / 10),
        nextPattern: mon.nextPattern || null,
        image: mon.image ? '/rpg-ui?file=' + encodeURIComponent(mon.image) : null,
        shield: Math.max(0, Math.round(Number(mon.shield || 0))),
        shieldMax: Math.max(0, Math.round(Number(mon.shieldMax || 0))),
        hpLines: Number(mon.hpLines || 0),
        enrageRemain: Number(mon.enrageSec || 0) > 0 ? Math.max(0, Math.round(Number(mon.enrageRemain || 0))) : null,
        enraged: !!mon.enraged,
        chatGimmick: gimmick ? { label: gimmick.label || '', remain: Math.max(0, Math.round(gimmick.remain * 10) / 10), responded: gimmick.responded.size, need: gimmick.need } : null
    };
}

function mergeMonsterStats(monsterDef) {
    const out = {};
    const src = monsterDef || {};
    const stat = src.stat || {};
    const plusStat = src.plusStat || {};
    for (const key of Object.keys(stat)) out[key] = Number(out[key] || 0) + Number(stat[key] || 0);
    for (const key of ['hp', 'mp', 'atk', 'def', 'pnt']) if (Object.prototype.hasOwnProperty.call(src, key)) out[key] = Number(src[key] || 0);
    for (const key of ['atk', 'def', 'hp', 'mp']) if (Number(plusStat[key] || 0) !== 0) out[key] = Math.round(Number(out[key] || 0) * (1 + Number(plusStat[key] || 0)));
    out.pntPercent = Number(out.pntPercent || 0) + Number(plusStat.pnt || 0);
    ['gold', 'potion', 'afterBasic', 'avd', 'afterSkill', '000', 'exp', 'eliteDmg', 'mpReduce', 'itemDropChance', 'recoveryEfficiency', 'crit', 'critMul', 'critDef', 'cmb', 'maxCmb', 'skillCooldown', 'skillTrueDmg', 'takenDamage', 'damageBonus', 'finalDamage', 'bossDmg', 'trueDamageChance', 'attackHpRecovery', 'attackMpRecovery', 'plusGold', 'cooldown'].forEach(key => {
        out[key] = Number(out[key] || 0) + Number(plusStat[key] || 0);
    });
    return out;
}

// 보스별 패턴 핸들러. step(room, mon, dt) -> true면 이번 tick의 일반 행동을 소비.
// init(monDef)는 해당 보스 전용 bossState 필드를 반환한다.
const BOSS_HANDLERS = {
    '흑화 호두': { step: stepBlackHoduBoss, init: createBlackHoduBossState },
    '타부자고': { step: stepTabuzago, init: createTabuzagoBossState, onSpawn: onSpawnTabuzago },
    '잉여왕': { step: stepIngyeoWang, init: createIngyeoWangBossState, onSpawn: onSpawnIngyeoWang }
};

// 모든 보스가 공유하는 bossState 필드
function createCommonBossState() {
    return {
        disabled: false,
        casting: null,
        chatGimmick: null,
        hpGimmicks: null,
        gimmickActive: null
    };
}

function createBlackHoduBossState(monDef) {
    const patterns = (monDef && monDef.patterns) || [];
    const findPattern = type => patterns.find(p => p && p.type === type) || {};
    const fixedAoe = findPattern('fixedAoe');
    const regenBelowHp = findPattern('regenBelowHp');
    const selfBuff = findPattern('selfBuff');
    const hpThresholdCast = findPattern('hpThresholdCast');
    const roleDamageLock = findPattern('roleDamageLock');
    return {
        revived: false,
        phase50Started: false,
        phase10Started: false,
        healActive: false,
        shockTimer: Number(fixedAoe.interval || 20),
        healTimer: Number(regenBelowHp.interval || 5),
        buffTimer: Number(selfBuff.interval || 30),
        buffRemain: 0,
        purgeTimer: Number(hpThresholdCast.intervalSec || 0),
        shieldInterval: Number(roleDamageLock.interval || 0),
        shieldDuration: Number(roleDamageLock.duration || 10),
        shieldTimer: Number(roleDamageLock.interval || 0),
        shieldRemain: 0,
        shieldRole: null,
        curseTriggered: false,
        curseRemain: 0,
        curseWipeArmed: false
    };
}

function createPhaseMonster(phase) {
    const monDef = (phase && phase.monster) || {};
    const stats = mergeMonsterStats(monDef);
    const hp = Math.max(1, Math.round(Number(stats.hp || 1)));
    const mp = Math.max(0, Math.round(Number(stats.mp || 0)));
    const patterns = monDef.patterns || [];
    const handler = phase && phase.type === 'boss' ? BOSS_HANDLERS[monDef.name] : null;
    const enrageSec = Number(monDef.enrageSec || 0);
    return {
        name: monDef.name || phase.name || '몬스터',
        hp,
        hpMax: hp,
        mp,
        mpMax: mp,
        atk: Number(stats.atk || 0),
        def: Number(stats.def || 0),
        pnt: Number(stats.pnt || 0),
        stats,
        actionInterval: Number(monDef.actionInterval || (phase.type === 'boss' ? 2.0 : 2.5)),
        gauge: 0,
        type: phase.type,
        element: monDef.element || null,
        tauntTarget: null,
        tauntRemain: 0,
        stunRemain: 0,
        image: monDef.image || null,
        // 전투 중 이름이 바뀌어도(폭주 전환) 핸들러를 찾을 수 있도록 고정 키를 둔다
        bossKey: handler ? monDef.name : null,
        shield: 0,
        shieldMax: 0,
        hpLines: Number(monDef.hpLines || 0),
        defeatLine: monDef.defeatLine || null,
        berserkForm: monDef.berserkForm || null,
        enrageSec,
        enrageRemain: enrageSec,
        enraged: false,
        bossState: handler ? Object.assign(createCommonBossState(), handler.init ? handler.init(monDef) : {}) : null,
        stackCounters: {},
        patterns,
        skills: monDef.skills || [],
        patternCooldowns: {},
        nextPattern: null
    };
}

function serializeRoomForMember(room) {
    const quest = getQuestById(room.questId);
    return {
        id: room.id,
        questId: room.questId,
        questName: quest ? quest.name : room.questId,
        hostName: room.hostName,
        state: room.state,
        phaseIndex: room.phaseIndex,
        phaseName: room.phaseIndex >= 0 && quest && quest.phases[room.phaseIndex] ? quest.phases[room.phaseIndex].name : null,
        phaseType: room.phaseIndex >= 0 && quest && quest.phases[room.phaseIndex] ? quest.phases[room.phaseIndex].type : null,
        sharedKillCount: room.sharedKillCount,
        killTarget: room.killTarget,
        members: room.members.map(serializeMember),
        chat: room.chatLog.slice(-100),
        potionLimit: room.potionLimit,
        noPositions: !!(quest && quest.noPositions),
        positions: quest && quest.noPositions ? [] : POSITION_LIST.slice(),
        questDef: safePublicQuestInfo(room.questId),
        monster: serializeMonster(room.monster),
        tauntTarget: room.tauntTarget || (room.monster && room.monster.tauntTarget) || null,
        tauntRemain: Math.max(0, Math.round(Number(room.tauntRemain || (room.monster && room.monster.tauntRemain) || 0) * 10) / 10),
        awaitingChoices: !!room.awaitingChoices,
        supportSkills: serializeSupportSkills(room),
        supportGauge: getQuestSupportSkills(room).length ? Math.floor(Number(room.supportGauge || 0)) : null,
        voteState: serializeVoteState(room),
        result: room.result || null
    };
}

function serializeVoteState(room) {
    const vs = room.voteState;
    if (!vs) return null;
    return {
        prompt: vs.prompt || '투표',
        deadline: Math.max(0, Math.round(Number(vs.deadline || 0) * 10) / 10),
        candidates: vs.candidates.slice(),
        votes: Object.assign({}, vs.votes)
    };
}

function safePublicQuestInfo(questId) {
    const q = getQuestById(questId);
    if (!q) return null;
    return {
        id: q.id,
        name: q.name,
        description: q.description || '',
        phases: (q.phases || []).map(p => ({ name: p.name, type: p.type })),
        noPositions: !!q.noPositions,
        positions: Object.fromEntries(POSITION_LIST.map(pos => {
            const def = (q.positions && q.positions[pos]) || {};
            return [pos, { stats: def.stats || {}, baseSkill: def.baseSkill || null }];
        })),
        skills: q.skills || {},
        extraSkills: q.extraSkills || {},
        potionLimit: q.potionLimit || 0
    };
}

// ===== SSE =====

function sseSend(res, event, payload) {
    if (!res || res.writableEnded) return;
    try {
        res.write('event: ' + event + '\n');
        res.write('data: ' + JSON.stringify(payload) + '\n\n');
    } catch (_) {}
}

function broadcast(room, event, payload) {
    for (const m of room.members) sseSend(m.sseRes, event, payload);
}

function broadcastRoom(room) {
    broadcast(room, 'room', serializeRoomForMember(room));
}

function pushChat(room, fromName, text) {
    const entry = {
        id: crypto.randomBytes(4).toString('hex'),
        from: fromName,
        text: String(text || ''),
        kind: 'user',
        at: Date.now()
    };
    room.chatLog.push(entry);
    if (room.chatLog.length > 300) room.chatLog.splice(0, room.chatLog.length - 300);
    broadcast(room, 'chat', entry);
    return entry;
}

function pushNotice(room, text, kind, ttl) {
    const entry = {
        id: crypto.randomBytes(4).toString('hex'),
        text: String(text || ''),
        kind: kind || 'info',
        ttl: ttl || 4000,
        at: Date.now()
    };
    broadcast(room, 'notice', entry);
}

function pushCombat(room, line, severity) {
    broadcast(room, 'combat', { text: String(line || ''), severity: severity || 'info', at: Date.now() });
}

// ===== 방 조작 =====

function findMember(room, name) {
    return room.members.find(m => m.name === name) || null;
}

function buildMemberTitle(user) {
    const def = rpgenius.getEquippedTitleDef(user);
    if (!def) return null;
    return { name: def.name, imageUrl: rpgenius.getTitleImageUrl(def.name) };
}

// 카드 이미지 URL 빌더는 server.js의 getCardImageUrl을 주입받는다 (순환 require 회피)
let cardImageUrlResolver = null;
function setCardImageResolver(fn) { cardImageUrlResolver = fn; }

function buildMemberCard(user) {
    const mc = user && user.main_card;
    if (!mc) return null;
    const cards = loadJsonCached(CHARACTER_CARDS_PATH, 'cards');
    const data = cards[mc.id];
    if (!data) return null;
    let imageUrl = null;
    try {
        if (cardImageUrlResolver) imageUrl = cardImageUrlResolver({ id: mc.id, star: mc.star, type: mc.type, skin: mc.skin }, user);
    } catch (_) {}
    return { name: data.name, star: Number(mc.star || 0), type: mc.type || '일반', imageUrl };
}

async function createRoom(hostName, questId, password) {
    if (memberIndex.has(hostName)) return { error: '이미 참여 중인 파티가 있습니다.' };
    const quest = getQuestById(questId);
    if (!quest) return { error: '존재하지 않는 파티 퀘스트입니다.' };
    let hostInfo = null;
    try {
        const user = await rpgenius.getRPGUserByName(hostName);
        const level = user ? Number(user.level || 1) : 1;
        if (quest.minLevel && level < quest.minLevel) return { error: 'Lv.' + quest.minLevel + ' 이상부터 입장할 수 있습니다. (현재 Lv.' + level + ')' };
        if (user) hostInfo = { level, title: buildMemberTitle(user), card: buildMemberCard(user) };
    } catch (_) {}
    const id = newRoomId();
    const room = {
        id,
        questId: quest.id,
        password: password ? String(password) : '',
        hostName,
        state: 'lobby',
        phaseIndex: -1,
        sharedKillCount: 0,
        killTarget: 0,
        members: [],
        chatLog: [],
        potionLimit: quest.potionLimit || 0,
        maxPlayers: quest.maxPlayers || 5,
        minPlayers: quest.minPlayers || 1,
        monster: null,
        tauntTarget: null,
        tauntRemain: 0,
        awaitingChoices: false,
        result: null,
        startedAt: null,
        createdAt: Date.now()
    };
    rooms.set(id, room);
    addMember(room, hostName, hostInfo);
    return { roomId: id };
}

function addMember(room, name, info) {
    if (!findMember(room, name)) {
        room.members.push({
            name,
            position: null,
            ready: false,
            potions: [],
            sseRes: null,
            skills: [],
            skillDefs: {},
            runtime: null,
            pendingChoices: null,
            level: info && info.level || 1,
            title: info && info.title || null,
            card: info && info.card || null,
            joinedAt: Date.now()
        });
    }
    memberIndex.set(name, room.id);
}

async function joinRoom(roomId, name, password) {
    if (memberIndex.has(name)) {
        const existingId = memberIndex.get(name);
        if (existingId === roomId) return { ok: true, roomId };
        return { error: '이미 참여 중인 파티가 있습니다.' };
    }
    const room = rooms.get(roomId);
    if (!room) return { error: '존재하지 않는 파티입니다.' };
    if (room.state !== 'lobby' && room.state !== 'preparing') return { error: '입장할 수 없는 상태입니다.' };
    if (room.members.length >= room.maxPlayers) return { error: '파티가 가득 찼습니다.' };
    if (room.password && String(password || '') !== room.password) return { error: '비밀번호가 일치하지 않습니다.' };
    const quest = getQuestById(room.questId);
    let joinInfo = null;
    try {
        const user = await rpgenius.getRPGUserByName(name);
        const level = user ? Number(user.level || 1) : 1;
        if (quest && quest.minLevel && level < quest.minLevel) return { error: 'Lv.' + quest.minLevel + ' 이상부터 입장할 수 있습니다. (현재 Lv.' + level + ')' };
        if (user) joinInfo = { level, title: buildMemberTitle(user), card: buildMemberCard(user) };
    } catch (_) {}
    addMember(room, name, joinInfo);
    pushNotice(room, name + ' 입장', 'info', 3500);
    broadcastRoom(room);
    return { ok: true, roomId };
}

function leaveRoom(name) {
    const roomId = memberIndex.get(name);
    if (!roomId) return { ok: true };
    const room = rooms.get(roomId);
    memberIndex.delete(name);
    if (!room) return { ok: true };
    const idx = room.members.findIndex(m => m.name === name);
    if (idx >= 0) {
        const [removed] = room.members.splice(idx, 1);
        // 전투 진행 중이라면 남은 물약 반환
        if (room.state === 'inProgress' && removed.potions && removed.potions.length) {
            refundLeftoverPotionsAsync(removed.name, removed.potions);
        }
        // 몬스터가 이 멤버를 도발 타깃으로 잡고 있다면 해제
        if (room.monster && room.monster.tauntTarget === name) {
            room.monster.tauntTarget = null;
            room.monster.tauntRemain = 0;
        }
        if (room.tauntTarget === name) {
            room.tauntTarget = null;
            room.tauntRemain = 0;
        }
        if (removed.sseRes && !removed.sseRes.writableEnded) { try { removed.sseRes.end(); } catch (_) {} }
    }
    if (room.members.length === 0) {
        stopTick(room);
        rooms.delete(room.id);
        return { ok: true };
    }
    if (room.hostName === name) room.hostName = room.members[0].name;
    pushNotice(room, name + ' 퇴장', 'warn', 3500);
    if (room.state === 'inProgress') {
        const aliveCount = room.members.filter(m => m.runtime && !m.runtime.dead).length;
        if (aliveCount === 0) {
            endQuest(room, false, '파티원이 부족합니다.');
        } else if (room.awaitingChoices) {
            // 선택 대기 중이었다면 남은 인원들의 선택 상태로 재평가
            const stillWaiting = room.members.some(m => m.runtime && !m.runtime.dead && Array.isArray(m.pendingChoices) && m.pendingChoices.length > 0);
            if (!stillWaiting) proceedToNextPhase(room);
        }
    }
    broadcastRoom(room);
    return { ok: true };
}

// 포지션 개념이 없는 퀘스트(부타게임 등)
function questHasNoPositions(room) {
    const quest = getQuestById(room && room.questId);
    return !!(quest && quest.noPositions);
}

function setPosition(name, position) {
    const room = getRoomOf(name);
    if (!room) return { error: '참여 중인 파티가 없습니다.' };
    if (questHasNoPositions(room)) return { error: '이 퀘스트는 포지션이 없습니다.' };
    if (room.state !== 'lobby' && room.state !== 'preparing') return { error: '준비 단계에서만 변경할 수 있습니다.' };
    if (position && !POSITION_LIST.includes(position)) return { error: '존재하지 않는 포지션입니다.' };
    if (position) {
        const taken = room.members.find(m => m.name !== name && m.position === position);
        if (taken) return { error: '이미 다른 파티원이 선택한 포지션입니다.' };
    }
    const me = findMember(room, name);
    me.position = position || null;
    me.ready = false;
    broadcastRoom(room);
    return { ok: true };
}

function setReady(name, ready) {
    const room = getRoomOf(name);
    if (!room) return { error: '참여 중인 파티가 없습니다.' };
    if (room.state !== 'lobby' && room.state !== 'preparing') return { error: '준비 단계에서만 변경할 수 있습니다.' };
    const me = findMember(room, name);
    if (!me.position && !questHasNoPositions(room)) return { error: '포지션을 먼저 선택해주세요.' };
    me.ready = !!ready;
    broadcastRoom(room);
    return { ok: true };
}

async function setPotions(name, items) {
    const room = getRoomOf(name);
    if (!room) return { error: '참여 중인 파티가 없습니다.' };
    if (room.state !== 'lobby' && room.state !== 'preparing') return { error: '준비 단계에서만 변경할 수 있습니다.' };
    const limit = room.potionLimit || 10;
    const list = Array.isArray(items) ? items : [];
    const cleaned = [];
    let total = 0;
    for (const it of list) {
        const itemName = String((it && it.name) || '').trim();
        const count = Math.max(0, Math.floor(Number((it && it.count) || 0)));
        if (!itemName || count <= 0) continue;
        cleaned.push({ name: itemName, count });
        total += count;
    }
    if (total > limit) return { error: '물약은 최대 ' + limit + '개까지 들고 갈 수 있습니다.' };
    // 인벤토리 보유량 검증 (소모는 시작 시점에서)
    try {
        const user = await rpgenius.getRPGUserByName(name);
        if (user) {
            const itemList = rpgenius.getDataCache('Item', []) || [];
            for (const it of cleaned) {
                const idx = itemList.findIndex(d => d && d.name === it.name);
                if (idx < 0 || !isPotionItem(itemList[idx])) return { error: '존재하지 않는 물약입니다: ' + it.name };
                const have = rpgenius.getInventoryItemCount(user, idx);
                if (have < it.count) return { error: it.name + ' 보유량 부족 (' + have + '/' + it.count + ')' };
            }
        }
    } catch (_) { /* 검증 실패 시 통과 (DB 미연결 환경 고려) */ }
    const me = findMember(room, name);
    me.potions = cleaned;
    broadcastRoom(room);
    return { ok: true };
}

// ===== 시작 / 페이즈 =====

async function start(hostName) {
    const room = getRoomOf(hostName);
    if (!room) return { error: '참여 중인 파티가 없습니다.' };
    if (room.hostName !== hostName) return { error: '공대장만 시작할 수 있습니다.' };
    if (room.state !== 'lobby' && room.state !== 'preparing') return { error: '이미 진행 중입니다.' };
    if (room.members.length < room.minPlayers) return { error: '최소 ' + room.minPlayers + '명이 필요합니다.' };
    const noPositions = questHasNoPositions(room);
    const occupiedPositions = new Set();
    for (const m of room.members) {
        if (!noPositions) {
            if (!m.position) return { error: m.name + '님이 포지션을 선택하지 않았습니다.' };
            if (occupiedPositions.has(m.position)) return { error: m.position + ' 포지션은 한 명만 선택할 수 있습니다.' };
            occupiedPositions.add(m.position);
        }
        if (!m.ready) return { error: m.name + '님이 준비되지 않았습니다.' };
    }

    const quest = getQuestById(room.questId);
    // 사전 검증: 물약 보유량
    const userMap = new Map();
    for (const m of room.members) {
        try {
            const user = await rpgenius.getRPGUserByName(m.name);
            if (user) userMap.set(m.name, user);
            if (user && m.potions && m.potions.length) {
                const itemList = rpgenius.getDataCache('Item', []) || [];
                for (const p of m.potions) {
                    const idx = itemList.findIndex(d => d && d.name === p.name);
                    if (idx < 0 || rpgenius.getInventoryItemCount(user, idx) < p.count) {
                        return { error: m.name + '님의 ' + p.name + ' 보유량이 부족합니다.' };
                    }
                }
            }
        } catch (_) {}
    }
    // 실제 차감 + 저장
    for (const m of room.members) {
        const user = userMap.get(m.name);
        if (!user || !m.potions || !m.potions.length) continue;
        const r = await consumePotionsFromInventory(user, m.potions);
        if (r.error) return { error: m.name + ': ' + r.error };
        try { await user.save(); } catch (e) { console.error('[partyquest] save potions error:', e); }
    }
    for (const m of room.members) {
        try {
            const user = userMap.get(m.name) || await rpgenius.getRPGUserByName(m.name);
            const baseStats = user ? rpgenius.calculateUserStats(user) : null;
            const slotEffects = user && typeof rpgenius.calculateCardSlotEffects === 'function' ? rpgenius.calculateCardSlotEffects(user) : null;
            const mainCardSkills = user ? getMainCardSkillEntries(user) : [];
            const immortalArmor = user ? getImmortalArmorSnapshot(user) : null;
            const manaResonance = user ? getManaResonanceSnapshot(user) : null;
            const thorns = user ? getThornsSnapshot(user) : null;
            const elementChain = user && typeof rpgenius.getEquipmentElementChain === 'function' ? rpgenius.getEquipmentElementChain(user) : null;
            const transcendEquipment = user && typeof rpgenius.getTranscendEquipmentSnapshot === 'function' ? rpgenius.getTranscendEquipmentSnapshot(user) : { entries: [], setCounts: {} };
            m.baseSnapshot = { stats: baseStats || { atk: 100, def: 50, hp: 1000, mp: 500, crit: 0, critMul: 1.4 }, slotEffects: slotEffects || {}, mainCardSkills, immortalArmor, manaResonance, thorns, elementChain, transcendEquipment };
        } catch (_) {
            m.baseSnapshot = { stats: { atk: 100, def: 50, hp: 1000, mp: 500, crit: 0, critMul: 1.4 }, slotEffects: {}, mainCardSkills: [], immortalArmor: null };
        }
        const posDef = quest.positions && quest.positions[m.position];
        const finalHpMul = posDef && posDef.stats && posDef.stats.finalHp != null ? Number(posDef.stats.finalHp) : 1;
        const finalMpMul = posDef && posDef.stats && posDef.stats.finalMp != null ? Number(posDef.stats.finalMp) : 1;
        const baseHp = Math.max(100, Math.round(Number(m.baseSnapshot.stats.hp || 1000) * finalHpMul));
        const baseMp = Math.max(50, Math.round(Number(m.baseSnapshot.stats.mp || 500) * finalMpMul));
        let petHpRegenRate = 0, petMpRegenRate = 0;
        try {
            const petUser = userMap.get(m.name) || await rpgenius.getRPGUserByName(m.name);
            if (petUser && typeof rpgenius.getActivePetSpecials === 'function') {
                const sp = rpgenius.getActivePetSpecials(petUser);
                petHpRegenRate = Number(sp.hpRegenRate || 0);
                petMpRegenRate = Number(sp.mpRegenRate || 0);
            }
        } catch (_) {}
        m.runtime = {
            hp: baseHp, hpMax: baseHp,
            mp: baseMp, mpMax: baseMp,
            petHpRegenRate, petMpRegenRate,
            gauge: 0,
            cooldowns: {}, // (deprecated, kept for compat)
            cooldownsUntil: {}, // skillName -> epoch ms
            actionUntil: 0,
            potionUntil: 0,
            buffs: [],
            shield: 0,
            shieldHits: 0,
            shieldExpireAt: 0,
            shieldExpireHeal: 0,
            nextSkillDamageBonus: 0,
            nextDamageReduction: 0,
            dead: false,
            tauntedBy: null,
            tauntRemain: 0,
            stunRemain: 0,
            dodgeNext: false,
            critBoostNext: 0,
            stackCounters: {},
            atkBuff: 0,
            equipmentState: { combatStartedAt: Date.now() },
            battleStats: createPartyBattleStats()
        };
        m.skills = posDef && posDef.baseSkill ? [posDef.baseSkill] : [];
        m.skillDefs = {};
        for (const entry of (m.baseSnapshot.mainCardSkills || [])) {
            const name = entry.skill && entry.skill.name;
            if (!name || m.skills.includes(name)) continue;
            m.skills.push(name);
            m.skillDefs[name] = toPartyMainCardSkillDef(entry);
        }
        if (getTranscendEquipmentEntry(m, '카카오의 계략') && !m.skills.includes('자폭')) {
            m.skills.push('자폭');
            m.skillDefs['자폭'] = { type: 'active', source: 'equipment', mp: 0, cd: 0, target: 'enemy', desc: '소환 중인 익테봇·수나타를 파괴해 피해를 주고 해당 소환 스킬의 쿨타임을 5초 줄인다.' };
        }
        m.pendingChoices = null;
    }

    for (const source of room.members) {
        const sanctuaryCooldown = getTranscendStageValue(source, '성역의 인도자 슈즈', .03, .01);
        const kingmakerElement = Number(source.baseSnapshot && source.baseSnapshot.stats && source.baseSnapshot.stats.partyAllElementAtk || 0); // 킹메이커 장갑: 파티원 모든 속성 강화 (스탯 기반, 단계 보정 포함)
        for (const target of room.members) {
            if (sanctuaryCooldown > 0 && target !== source) target.baseSnapshot.stats.cooldown = Number(target.baseSnapshot.stats.cooldown || 0) + sanctuaryCooldown;
            if (kingmakerElement > 0) target.baseSnapshot.stats.allElementAtk = Number(target.baseSnapshot.stats.allElementAtk || 0) + kingmakerElement;
        }
    }

    room.state = 'inProgress';
    room.phaseIndex = 0;
    room.sharedKillCount = 0;
    room.supportGauge = 0;
    room.result = null;
    room.startedAt = Date.now();
    room.introUntil = Date.now() + INTRO_GRACE_MS;
    // 퀘스트: 파티 퀘스트 참여 집계 (진행도가 변한 유저만 저장)
    if (typeof rpgenius.recordQuestEvent === 'function') {
        for (const m of room.members) {
            const user = userMap.get(m.name);
            if (!user) continue;
            try {
                if (rpgenius.recordQuestEvent(user, 'partyJoin', { quest: quest.name })) await user.save();
            } catch (e) { console.error('[partyquest] quest join record error:', e); }
        }
    }
    pushNotice(room, '「' + quest.name + '」 시작', 'big', 3500);
    setupPhase(room);
    broadcastRoom(room);
    return { ok: true };
}

function setupPhase(room) {
    const quest = getQuestById(room.questId);
    const phase = quest.phases[room.phaseIndex];
    if (!phase) { endQuest(room, true); return; }
    room.awaitingChoices = false;
    room.killTarget = phase.killTarget || 0;
    room.sharedKillCount = 0;
    room.tauntTarget = null;
    room.tauntRemain = 0;
    if (phase.type === 'mob') {
        room.monster = null;
        startTick(room);
        pushNotice(room, phase.name + ' (목표 ' + phase.killTarget + '마리)', 'big', 4500);
    } else {
        room.monster = createPhaseMonster(phase);
        // 게이지 초기화
        for (const m of room.members) { m.runtime.gauge = 0; }
        const handler = BOSS_HANDLERS[room.monster.bossKey];
        if (handler && handler.onSpawn) handler.onSpawn(room, room.monster);
        startTick(room);
        pushNotice(room, phase.name + ' — ' + room.monster.name + ' 등장', 'big', 4500);
    }
}

function endPhase(room) {
    stopTick(room);
    const quest = getQuestById(room.questId);
    const next = quest.phases[room.phaseIndex + 1];
    pushNotice(room, (quest.phases[room.phaseIndex] && quest.phases[room.phaseIndex].name) + ' 클리어', 'big', 4500);
    // 3택 스킵 퀘스트: 바로 다음 관문으로
    if (next && quest.noPhaseChoices) {
        for (const m of room.members) m.pendingChoices = null;
        proceedToNextPhase(room);
        return;
    }
    // 랜덤 스킬 선택지 부여 (죽은 멤버는 선택 없이 스킵)
    room.awaitingChoices = true;
    for (const m of room.members) {
        if (!m.runtime || m.runtime.dead) {
            m.pendingChoices = null;
            continue;
        }
        const pool = (quest.randomSkillPool && quest.randomSkillPool[m.position]) || [];
        const owned = new Set(m.skills);
        const pick = shuffle(pool.filter(s => !owned.has(s))).slice(0, 3);
        m.pendingChoices = pick.length > 0 ? pick : null;
    }
    if (!next) {
        // 마지막 페이즈가 클리어된 경우, 선택을 굳이 받을 필요 없음 -> 바로 클리어
        room.awaitingChoices = false;
        for (const m of room.members) m.pendingChoices = null;
        endQuest(room, true);
        return;
    }
    broadcastRoom(room);
    // 선택할 스킬이 없는 멤버는 자동 통과 처리
    if (room.members.every(m => !m.pendingChoices)) {
        proceedToNextPhase(room);
    }
}

function pickRandomSkill(name, skillName) {
    const room = getRoomOf(name);
    if (!room) return { error: '참여 중인 파티가 없습니다.' };
    if (!room.awaitingChoices) return { error: '지금은 스킬 선택 단계가 아닙니다.' };
    const m = findMember(room, name);
    if (!m || !m.pendingChoices) return { error: '선택할 수 없는 상태입니다.' };
    if (!m.pendingChoices.includes(skillName)) return { error: '제공된 선택지가 아닙니다.' };
    m.skills.push(skillName);
    m.pendingChoices = null;
    pushNotice(room, name + ' [' + skillName + '] 습득', 'info', 3500);
    broadcastRoom(room);
    if (room.members.every(mm => !mm.pendingChoices)) proceedToNextPhase(room);
    return { ok: true };
}

function proceedToNextPhase(room) {
    room.awaitingChoices = false;
    room.phaseIndex += 1;
    const quest = getQuestById(room.questId);
    if (quest && quest.reviveOnPhaseClear) {
        for (const m of room.members) {
            if (!m.runtime || !m.runtime.dead) continue;
            m.runtime.dead = false;
            m.runtime.hp = m.runtime.hpMax;
            m.runtime.mp = m.runtime.mpMax;
            pushCombat(room, m.name + ' 부활 (관문 클리어)', 'heal');
        }
    }
    setupPhase(room);
    broadcastRoom(room);
}

function endQuest(room, cleared, reason) {
    stopTick(room);
    room.state = cleared ? 'cleared' : 'failed';
    room.monster = null;
    room.awaitingChoices = false;
    // 남은 물약은 인벤토리로 반환
    for (const m of room.members) {
        if (m.potions && m.potions.length) {
            refundLeftoverPotionsAsync(m.name, m.potions);
            m.potions = [];
        }
        if (!cleared && Number(m.runtime && m.runtime.pendingEquipmentGold || 0) > 0) grantPendingEquipmentGoldAsync(m);
    }
    room.result = {
        cleared: !!cleared,
        reason: reason || (cleared ? '모든 페이즈 클리어!' : '파티 전멸'),
        rewards: [],
        statistics: buildPartyBattleStatistics(room)
    };
    if (cleared) grantPartyQuestClearRewards(room);
    pushNotice(room, cleared ? '퀘스트 클리어' : '파티 전멸', cleared ? 'success' : 'danger', 6000);
    broadcastRoom(room);
}

// 조건 없이 코드로 지급하는 칭호 (히든 등)
function grantTitleAsync(room, name, titleId) {
    (async () => {
        try {
            const user = await rpgenius.getRPGUserByName(name);
            if (!user || !rpgenius.unlockTitle(user, titleId)) return;
            await user.save();
            const def = typeof rpgenius.getTitleDefs === 'function' ? rpgenius.getTitleDefs().find(t => t.id === titleId) : null;
            if (room) pushNotice(room, name + ' — 칭호 「' + ((def && def.name) || titleId) + '」 획득', 'success', 6000);
        } catch (e) { console.error('[partyquest] title grant error:', e); }
    })();
}

function grantPendingEquipmentGoldAsync(member) {
    const amount = Math.max(0, Math.round(Number(member && member.runtime && member.runtime.pendingEquipmentGold || 0)));
    if (amount <= 0) return;
    member.runtime.pendingEquipmentGold = 0;
    (async () => {
        try {
            const user = await rpgenius.getRPGUserByName(member.name);
            if (!user) return;
            user.gold = Number(user.gold || 0) + amount;
            await user.save();
        } catch (e) { console.error('[partyquest] equipment gold save error:', e); }
    })();
}

function restartQuest(hostName) {
    const room = getRoomOf(hostName);
    if (!room) return { error: '참여 중인 파티가 없습니다.' };
    if (room.hostName !== hostName) return { error: '공대장만 다시 시작할 수 있습니다.' };
    if (room.state !== 'cleared' && room.state !== 'failed') return { error: '퀘스트가 종료된 후에만 사용할 수 있습니다.' };
    stopTick(room);
    room.state = 'lobby';
    room.phaseIndex = -1;
    room.sharedKillCount = 0;
    room.killTarget = 0;
    room.monster = null;
    room.awaitingChoices = false;
    room.tauntTarget = null;
    room.tauntRemain = 0;
    room.result = null;
    room.startedAt = null;
    for (const m of room.members) {
        m.ready = false;
        m.potions = [];
        m.runtime = null;
        m.pendingChoices = null;
        m.skills = [];
        m.skillDefs = {};
    }
    pushNotice(room, '재도전 요청 — 준비 필요', 'info', 4000);
    broadcastRoom(room);
    return { ok: true };
}

function refundLeftoverPotionsAsync(name, potions) {
    (async () => {
        try {
            const user = await rpgenius.getRPGUserByName(name);
            if (!user) return;
            refundPotionsToInventory(user, potions);
            await user.save();
        } catch (e) { console.error('[partyquest] refund potions error:', e); }
    })();
}

// ===== 수동 공격 =====

function attackMobPhase(name) {
    const room = getRoomOf(name);
    if (!room) return { error: '참여 중인 파티가 없습니다.' };
    if (room.state !== 'inProgress') return { error: '진행 중이 아닙니다.' };
    if (isIntroActive(room)) return { error: '전투 시작 카운트다운 중입니다.' };
    const quest = getQuestById(room.questId);
    const phase = quest.phases[room.phaseIndex];
    if (!phase) return { error: '진행 중인 페이즈가 없습니다.' };
    const me = findMember(room, name);
    if (!me) return { error: '멤버가 아닙니다.' };
    if (me.runtime && me.runtime.dead) return { error: '행동할 수 없습니다.' };
    if (me.runtime && me.runtime.stunRemain > 0) return { error: '기절 상태입니다.' };
    if (me.runtime && me.runtime.sealRemain > 0) return { error: '봉인 상태입니다.' };
    if (room.awaitingChoices) return { error: '스킬 선택 후 진행됩니다.' };
    if (me.runtime && nowMs() < (me.runtime.actionUntil || 0)) return { error: '행동 쿨타임 중입니다.' };
    // 시벌론: 상태 중 일반 공격 쿨타임 0.5초, 상태가 아니면 충전 +1
    const sivalonActive = isPartySivalonActive(me);
    if (me.runtime) me.runtime.actionUntil = nowMs() + (sivalonActive ? 500 : getActionCooldownSeconds(me) * 1000);
    if (me.runtime && !sivalonActive && Array.isArray(me.skills) && me.skills.includes('시벌론')) {
        me.runtime.sivalonCharge = Math.min(5, Number(me.runtime.sivalonCharge || 0) + 1);
    }
    if (phase.type === 'mob') {
        const fakeMon = createPhaseMonster(phase);
        const result = computeBasicDamage(me, fakeMon, room);
        const applied = applyMobPhaseDamage(room, me, fakeMon, result, 'attack', null, true);
        return { ok: true, damage: result.damage, kills: applied.kills, crit: !!result.isCrit };
    }
    if (!room.monster) return { error: '공격할 대상이 없습니다.' };
    const r = performBasicAttack(room, me);
    if (room.monster && room.monster.hp <= 0) {
        onMonsterDefeated(room);
    }
    return { ok: true, damage: r && r.damage, crit: !!(r && r.isCrit) };
}

function comma(n) { return Number(n || 0).toLocaleString('en-US'); }

function applyMobPhaseDamage(room, attacker, monster, result, type, skillName, counterAttack) {
    const damage = Math.max(0, Number(result && result.damage || 0));
    recordPartyDamage(attacker, result, skillName || '기본 공격');
    recordPartyJudgmentDamage(room, attacker, result);
    const mobHp = Math.max(1, Number(monster && monster.hpMax || 1));
    const remaining = Math.max(0, room.killTarget - room.sharedKillCount);
    const kills = damage > 0 ? Math.min(remaining, Math.max(1, Math.floor(damage / mobHp))) : 0;
    room.sharedKillCount += kills;
    const payload = {
        by: attacker.name,
        total: room.sharedKillCount,
        target: room.killTarget,
        damage: damage,
        fixedDamage: Number(result && result.fixedDamage || 0),
        destinyDamage: Number(result && result.destinyDamage || 0),
        hitDetails: Array.isArray(result && result.hitDetails) ? result.hitDetails : [],
        kills: kills,
        crit: !!(result && result.isCrit),
        mobHp: mobHp,
        skill: skillName || null
    };
    broadcast(room, 'kill', payload);
    pushCombat(room, attacker.name + (skillName ? ' [' + skillName + ']' : '') + ' → 어둠 ' + comma(kills) + '마리 처치 [-' + comma(damage) + ']' + (result && result.isCrit ? ' (치명타)' : ''), type || 'attack');
    applyAttackPotentialRecovery(room, attacker);
    if (room.sharedKillCount >= room.killTarget) {
        room.sharedKillCount = room.killTarget;
        endPhase(room);
    } else if (counterAttack && attacker.runtime && !attacker.runtime.dead) {
        performMobCounterAttack(room, monster, attacker);
        broadcast(room, 'tick', {
            members: room.members.map(serializeMember),
            monster: null,
            tauntTarget: room.tauntTarget || null,
            tauntRemain: Math.max(0, Math.round(Number(room.tauntRemain || 0) * 10) / 10)
        });
    }
    return { kills };
}

// ===== 전투 엔진 (2/3 페이즈, ATB) =====

const tickHandles = new Map(); // roomId -> interval

function startTick(room) {
    stopTick(room);
    const handle = setInterval(() => stepRoom(room), TICK_MS);
    tickHandles.set(room.id, handle);
}
function stopTick(room) {
    const h = tickHandles.get(room.id);
    if (h) { clearInterval(h); tickHandles.delete(room.id); }
}

function stepRoom(room) {
    if (room.state !== 'inProgress') { stopTick(room); return; }
    if (room.awaitingChoices) return;
    if (isIntroActive(room)) return; // 시작 카운트다운 동안 전투 동결 (몬스터 게이지·버프·광폭화 타이머 전부)
    const dt = TICK_MS / 1000;
    if (Array.isArray(room.delayedEquipmentDamage) && room.delayedEquipmentDamage.length > 0) {
        const now = Date.now();
        const waiting = [];
        for (const delayed of room.delayedEquipmentDamage) {
            if (now < Number(delayed.dueAt || 0)) { waiting.push(delayed); continue; }
            if (Number(delayed.phaseIndex) !== Number(room.phaseIndex)) continue;
            const quest = getQuestById(room.questId);
            const phase = quest && quest.phases[room.phaseIndex];
            const attacker = findMember(room, delayed.attackerName);
            if (!phase || phase.type !== 'mob' || !attacker) continue;
            const fakeMon = createPhaseMonster(phase);
            applyMobPhaseDamage(room, attacker, fakeMon, { damage: Number(delayed.damage || 0), fixedDamage: 0, destinyDamage: 0, hitDetails: [], isCrit: false }, 'skill', '그림자 공격', false);
            if (room.state !== 'inProgress' || Number(delayed.phaseIndex) !== Number(room.phaseIndex)) break;
        }
        room.delayedEquipmentDamage = waiting;
    }

    // 버프/디버프/쿨타임 감소
    for (const m of room.members) {
        const r = m.runtime;
        if (!r) continue;
        if (!r.dead) {
            if (r.petHpRegenRate > 0 && r.hp > 0 && r.hp < r.hpMax && canPartyReceiveHealing(m)) {
                const before = r.hp;
                r.hp = Math.min(r.hpMax, r.hp + r.hpMax * r.petHpRegenRate * dt);
                recordPartyHealing(m, m, r.hp - before);
            }
            if (r.petMpRegenRate > 0 && r.mp < r.mpMax) r.mp = Math.min(r.mpMax, r.mp + r.mpMax * r.petMpRegenRate * dt);
            if (r.dragonRegen) {
                const now = nowMs();
                while (r.dragonRegen.ticksLeft > 0 && now >= Number(r.dragonRegen.nextTickAt || 0)) {
                    const amount = Math.max(1, Math.round(r.hpMax * IMMORTAL_DRAGON_ARMOR_REGEN_HP_PCT * getPartyRecoveryMultiplier(m)));
                    const healed = healMember(m, amount);
                    if (healed > 0) pushCombat(room, m.name + ' [' + IMMORTAL_DRAGON_ARMOR_NAME + '] HP +' + comma(healed), 'heal');
                    r.dragonRegen.ticksLeft -= 1;
                    r.dragonRegen.nextTickAt = Number(r.dragonRegen.nextTickAt || 0) + 1000;
                }
                if (r.dragonRegen.ticksLeft <= 0) r.dragonRegen = null;
            }
            const infernoHealRatio = getTranscendStageValue(m, '솔로 인페르노', .03, .02);
            if (infernoHealRatio > 0) {
                const equipmentState = r.equipmentState || (r.equipmentState = {});
                if (!equipmentState.soloInfernoNextAt) equipmentState.soloInfernoNextAt = Date.now() + 15000;
                if (Date.now() >= equipmentState.soloInfernoNextAt) {
                    const amount = Math.max(1, Math.round(r.hpMax * infernoHealRatio * getPartyRecoveryMultiplier(m)));
                    const healed = [];
                    for (const ally of room.members) {
                        if (ally === m || !ally.runtime || ally.runtime.dead) continue;
                        const healedAmount = healMember(ally, amount, m);
                        applyTranscendAllyEffect(room, m, ally, 'heal');
                        if (healedAmount > 0) healed.push(ally.name);
                    }
                    if (healed.length > 0) pushCombat(room, m.name + ' [솔로 인페르노] → ' + healed.join(', ') + ' HP +' + comma(amount), 'heal');
                    equipmentState.soloInfernoNextAt += 15000;
                    if (equipmentState.soloInfernoNextAt <= Date.now()) equipmentState.soloInfernoNextAt = Date.now() + 15000;
                }
            }
            if (getTranscendEquipmentEntry(m, '포상 정산 반지')) {
                const equipmentState = r.equipmentState || (r.equipmentState = {});
                const intervalMs = 4000;
                if (!equipmentState.settlementRecoveryAt) equipmentState.settlementRecoveryAt = Date.now() + intervalMs;
                if (Date.now() >= equipmentState.settlementRecoveryAt) {
                    const hpRatio = Number(r.hp || 0) / Math.max(1, Number(r.hpMax || 1));
                    const mpRatio = Number(r.mp || 0) / Math.max(1, Number(r.mpMax || 1));
                    if (hpRatio < mpRatio) healMember(m, Math.max(1, Math.round(r.hpMax * .01 * getPartyRecoveryMultiplier(m))));
                    else if (mpRatio < hpRatio) r.mp = Math.min(r.mpMax, r.mp + Math.max(1, Math.round(r.mpMax * .01)));
                    equipmentState.settlementRecoveryAt = Date.now() + intervalMs;
                }
            }
            const equipmentState = r.equipmentState || (r.equipmentState = {});
            if (equipmentState.judgment && Date.now() >= Number(equipmentState.judgment.expiresAt || 0)) {
                const judgment = equipmentState.judgment;
                delete equipmentState.judgment;
                if (Number(judgment.phaseIndex) === Number(room.phaseIndex) && Number(judgment.damage || 0) > 0) {
                    const quest = getQuestById(room.questId);
                    const phase = quest && quest.phases[room.phaseIndex];
                    const target = room.monster || (phase && phase.type === 'mob' ? createPhaseMonster(phase) : null);
                    if (target) {
                        const lightMul = typeof rpgenius.getElementDamageMultiplier === 'function'
                            ? rpgenius.getElementDamageMultiplier('명', m.baseSnapshot.stats || {}, target.stats || {})
                            : 1;
                        let damage = Math.max(1, Math.round(Number(judgment.damage) * .15 * lightMul));
                        if (room.monster) {
                            damage = applyPlayerDamageToBoss(room, room.monster, m, damage);
                            recordPartyDamage(m, { damage, fixedDamage: 0, destinyDamage: 0, hitDetails: [], isCrit: false }, '심판 폭발');
                            pushCombat(room, m.name + ' [심판 폭발] → ' + room.monster.name + ' [-' + damage + ']', 'skill');
                            if (room.monster.hp <= 0) { onMonsterDefeated(room); return; }
                        } else {
                            applyMobPhaseDamage(room, m, target, { damage, fixedDamage: 0, destinyDamage: 0, hitDetails: [], isCrit: false, equipmentTriggerAllowed: false }, 'skill', '심판 폭발', false);
                            if (room.state !== 'inProgress' || Number(judgment.phaseIndex) !== Number(room.phaseIndex)) return;
                        }
                    }
                }
            }
        }
        if (!r.dead) {
            stepMemberDots(room, m, dt);
            if (room.state !== 'inProgress') return;
        }
        if (r.tauntRemain > 0) r.tauntRemain = Math.max(0, r.tauntRemain - dt);
        if (r.stunRemain > 0) r.stunRemain = Math.max(0, r.stunRemain - dt);
        if (r.sealRemain > 0) r.sealRemain = Math.max(0, r.sealRemain - dt);
        for (let i = r.buffs.length - 1; i >= 0; i--) {
            r.buffs[i].remain -= dt;
            if (r.buffs[i].remain <= 0) {
                expireBuff(m, r.buffs[i]);
                r.buffs.splice(i, 1);
            }
        }
        if (r.shieldExpireAt && Date.now() >= r.shieldExpireAt) triggerShieldExpire(room, m);
        if (r.iktaeBot) {
            const now = Date.now();
            if (now > r.iktaeBot.expired_at) {
                r.iktaeBot = null;
                pushCombat(room, m.name + ' 익테봇 만료', 'buff');
            } else if (now >= r.iktaeBot.nextAttackAt) {
                r.iktaeBot.nextAttackAt = now + 4000;
                let targetMon = room.monster;
                const quest = getQuestById(room.questId);
                const phase = quest && quest.phases[room.phaseIndex];
                if (!targetMon && phase && phase.type === 'mob') targetMon = createPhaseMonster(phase);
                if (targetMon && targetMon.hp > 0 && !m.runtime.dead) {
                    const botDamage = Math.max(1, Math.round(Number(m.baseSnapshot.stats.atk || 0) * r.iktaeBot.atkMul));
                    const res = calculateOutgoingDamage(m, targetMon, room, botDamage, { isSkill: true, summonAttack: true, disableEquipmentBonusDamage: true, hitCount: 1 });
                    const invincible = !!(targetMon.bossState && targetMon.bossState.casting);
                    if (invincible) res.damage = 0;
                    if (room.monster) {
                        res.damage = applyBossHpDamage(room, room.monster, res.damage);
                        recordPartyDamage(m, res, '익테봇 소환');
                    }
                    else applyMobPhaseDamage(room, m, targetMon, res, 'skill', '익테봇 소환', false);
                    pushCombat(room, m.name + ' 익테봇 → ' + targetMon.name + ' [-' + res.damage + ']', 'skill');
                    if (room.monster) applyBlackHoduCritReflect(room, m, res);
                }
            }
        }
        if (r.sunata) {
            const now = Date.now();
            if (now > r.sunata.expired_at) {
                r.sunata = null;
                pushCombat(room, m.name + ' 수나타 만료', 'buff');
            } else if (now >= r.sunata.nextAttackAt) {
                r.sunata.nextAttackAt = now + 5000;
                let targetMon = room.monster;
                const quest = getQuestById(room.questId);
                const phase = quest && quest.phases[room.phaseIndex];
                if (!targetMon && phase && phase.type === 'mob') targetMon = createPhaseMonster(phase);
                if (targetMon && targetMon.hp > 0 && !m.runtime.dead) {
                    const dmg = Math.max(1, Math.round(Number(m.baseSnapshot.stats.atk || 0) * r.sunata.atkMul));
                    const res = calculateOutgoingDamage(m, targetMon, room, dmg, { isSkill: true, summonAttack: true, disableEquipmentBonusDamage: true, hitCount: 1 });
                    const invincible = !!(targetMon.bossState && targetMon.bossState.casting);
                    if (invincible) res.damage = 0;
                    if (room.monster) {
                        res.damage = applyBossHpDamage(room, room.monster, res.damage);
                        recordPartyDamage(m, res, '수나타 소환');
                    }
                    else applyMobPhaseDamage(room, m, targetMon, res, 'skill', '수나타 소환', false);
                    pushCombat(room, m.name + ' 수나타 → ' + targetMon.name + ' [-' + res.damage + ']', 'skill');
                    if (room.monster) applyBlackHoduCritReflect(room, m, res);
                }
            }
        }
    }
    if (room.tauntRemain > 0) {
        room.tauntRemain = Math.max(0, room.tauntRemain - dt);
        if (room.tauntRemain <= 0) room.tauntTarget = null;
    }
    if (room.voteState) {
        room.voteState.deadline = Math.max(0, Number(room.voteState.deadline || 0) - dt);
        if (room.voteState.deadline <= 0) {
            resolveVote(room);
            if (room.state !== 'inProgress') return;
        }
    }
    // 지원군 게이지 자연 증가 (전투 중에만, 5초당 +1%)
    if (getQuestSupportSkills(room).length) {
        room.supportGaugeAccum = Number(room.supportGaugeAccum || 0) + dt;
        while (room.supportGaugeAccum >= SUPPORT_GAUGE_SEC_PER_PERCENT) {
            room.supportGaugeAccum -= SUPPORT_GAUGE_SEC_PER_PERCENT;
            addSupportGauge(room, 1, true);
        }
    }
    if (room.supportSito) {
        stepSupportSito(room, dt);
        if (room.state !== 'inProgress') return;
    }
    if (room.supportXBarrage) {
        stepSupportXBarrage(room, dt);
        if (room.state !== 'inProgress') return;
    }
    const mon = room.monster;
    if (mon) {
        // 처치 판정을 하지 않는 경로(익테봇/수나타/지원군 등)로 HP가 0이 된 경우의 안전망
        if (mon.hp <= 0) { onMonsterDefeated(room); return; }
        // 폭주 형태는 HP가 아니라 보호막이 생명줄 — 그로기 중에도 소진 판정을 한다
        if (mon.bossState && mon.bossState.berserk && Number(mon.shield || 0) <= 0) {
            mon.hpFloor = 0;
            mon.hp = 0;
            onMonsterDefeated(room);
            return;
        }
        stepEnrage(room, mon, dt);
        if (mon.stunRemain > 0) mon.stunRemain = Math.max(0, mon.stunRemain - dt);
        if (mon.bossState && mon.bossState.buffRemain > 0) mon.bossState.buffRemain = Math.max(0, mon.bossState.buffRemain - dt);
        if (mon.tauntRemain > 0) mon.tauntRemain = Math.max(0, mon.tauntRemain - dt);
        for (const k of Object.keys(mon.patternCooldowns || {})) {
            mon.patternCooldowns[k] = Math.max(0, mon.patternCooldowns[k] - dt);
        }
        // 몬스터 디버프 (잔류 전격, 유서새김 지속 피해 등)
        if (mon.debuffs && mon.debuffs.length) {
            let dotKilled = false;
            for (let i = mon.debuffs.length - 1; i >= 0; i--) {
                const d = mon.debuffs[i];
                if (!dotKilled && d.type === 'dot' && mon.hp > 0) {
                    d.tick = Number(typeof d.tick !== 'undefined' ? d.tick : (d.interval || 2)) - dt;
                    if (d.tick <= 0) {
                        d.tick += Number(d.interval || 2);
                        const dotDmg = Math.max(1, Math.round(Number(d.dmg || 0)));
                        const dealt = applyBossHpDamage(room, mon, dotDmg);
                        const sourceMember = d.sourceName ? findMember(room, d.sourceName) : null;
                        if (sourceMember) recordPartyDamage(sourceMember, { damage: dealt, fixedDamage: 0, destinyDamage: 0, hitDetails: [], isCrit: false }, d.sourceSkill || d.label || '지속 피해');
                        pushCombat(room, (d.label || d.id || '지속 피해') + ' → ' + mon.name + ' [-' + dealt + ']', 'skill');
                        if (mon.hp <= 0) dotKilled = true;
                    }
                }
                d.remain -= dt;
                if (d.remain <= 0) {
                    if (!dotKilled && Number(d.explodeDamage || 0) > 0 && mon.hp > 0) {
                        const explosion = Math.max(1, Math.round(Number(d.explodeDamage || 0)));
                        const dealt = applyBossHpDamage(room, mon, explosion);
                        const sourceMember = d.sourceName ? findMember(room, d.sourceName) : null;
                        if (sourceMember) recordPartyDamage(sourceMember, { damage: dealt, fixedDamage: 0, destinyDamage: 0, hitDetails: [], isCrit: false }, d.explodeLabel || d.sourceSkill || '지속 피해 폭발');
                        pushCombat(room, (d.explodeLabel || '장송곡 폭발') + ' → ' + mon.name + ' [-' + dealt + ']', 'skill');
                        if (mon.hp <= 0) dotKilled = true;
                    }
                    mon.debuffs.splice(i, 1);
                }
            }
            if (dotKilled) { onMonsterDefeated(room); return; }
        }

        if (mon.stunRemain <= 0) {
            const patternConsumed = stepBoss(room, mon, dt);
            if (room.state !== 'inProgress' || room.monster !== mon) return;
            if (patternConsumed) {
                broadcast(room, 'tick', {
                    members: room.members.map(serializeMember),
                    monster: serializeMonster(mon),
                    tauntTarget: room.tauntTarget || (mon && mon.tauntTarget) || null,
                    tauntRemain: Math.max(0, Math.round(Number(room.tauntRemain || (mon && mon.tauntRemain) || 0) * 10) / 10),
                    supportGauge: getQuestSupportSkills(room).length ? Math.floor(Number(room.supportGauge || 0)) : null
                });
                return;
            }
            // 몬스터 게이지 누적
            mon.gauge += (100 / Math.max(0.4, mon.actionInterval)) * dt;
            if (mon.gauge >= 100) {
                mon.gauge -= 100;
                performMonsterAction(room);
            }
        } else if (mon.bossState && mon.bossState.casting) {
            pushCombat(room, mon.name + ' [' + mon.bossState.casting.name + '] 캐스팅 중단', 'buff');
            mon.bossState.casting = null;
            mon.nextPattern = null;
        }
    }

    // 스냅샷 푸시 (가벼운 tick)
    broadcast(room, 'tick', {
        members: room.members.map(serializeMember),
        monster: serializeMonster(mon),
        tauntTarget: room.tauntTarget || (mon && mon.tauntTarget) || null,
        tauntRemain: Math.max(0, Math.round(Number(room.tauntRemain || (mon && mon.tauntRemain) || 0) * 10) / 10),
        supportGauge: getQuestSupportSkills(room).length ? Math.floor(Number(room.supportGauge || 0)) : null
    });
}

function triggerShieldExpire(room, m) {
    const r = m.runtime;
    const heal = Math.round(Number(r.shieldExpireHeal || 0));
    r.shield = 0;
    r.shieldHits = 0;
    r.shieldExpireAt = 0;
    if (heal > 0 && !r.dead) {
        const healed = healMember(m, heal);
        if (healed > 0) pushCombat(room, m.name + ' 보호막 소멸 → 생명력 +' + comma(healed), 'heal');
    }
    r.shieldExpireHeal = 0;
}

function expireBuff(member, buff) {
    const r = member.runtime;
    if (buff.id === 'actCdMul') r.actCdMul = getActiveBuffValue(r, 'actCdMul', 1);
    if (buff.id === 'atkBuff') r.atkBuff = getActiveBuffValue(r, 'atkBuff', 0);
    if (buff.id === 'takenDmgSelf') r.takenDmgMul = getActiveBuffValue(r, 'takenDmgSelf', 1);
    if (buff.id === 'absorbAlly') r.absorbAlly = getActiveBuffValue(r, 'absorbAlly', 0);
    if (buff.id === 'gunryeok') clearPartyGunryeok(member);
}

function getActiveBuffValue(runtime, id, fallback) {
    const matches = (runtime.buffs || []).filter(b => b.id === id && Number(b.remain || 0) > 0 && typeof b.value !== 'undefined');
    if (!matches.length) return fallback;
    if (id === 'atkBuff' || id === 'absorbAlly') return Math.max(...matches.map(b => Number(b.value || 0)));
    if (id === 'actCdMul' || id === 'takenDmgSelf') return Math.min(...matches.map(b => Number(b.value || fallback)));
    return Number(matches[matches.length - 1].value || fallback);
}

function upsertMemberBuff(member, buff) {
    if (!member || !member.runtime || !buff || !buff.id) return;
    if (!Array.isArray(member.runtime.buffs)) member.runtime.buffs = [];
    const exist = member.runtime.buffs.find(b => b.id === buff.id && b.label === buff.label);
    if (exist) {
        exist.remain = Number(buff.remain || 0);
        if (typeof buff.value !== 'undefined') exist.value = buff.value;
    } else {
        member.runtime.buffs.push(buff);
    }
}

// ===== 데미지 계산 =====

function hasPassive(member, name) {
    return Array.isArray(member.skills) && member.skills.includes(name);
}

function getFinalDamageMul(attacker, options) {
    let mul = 1;
    const summonAttack = !!(options && options.summonAttack);
    // 복수의 칼날: 잃은 체력 10%당 +4% 최종 피해
    if (hasPassive(attacker, '복수의 칼날') && attacker.runtime) {
        const r = attacker.runtime;
        const missingPct = r.hpMax > 0 ? Math.max(0, (r.hpMax - r.hp) / r.hpMax) : 0;
        mul *= 1 + missingPct * 0.4;
    }
    // 마력 감응: MP 75% 이상일 때 최종 피해 +5%
    const mr = attacker.baseSnapshot && attacker.baseSnapshot.manaResonance;
    if (mr && attacker.runtime) {
        const r = attacker.runtime;
        if (r.mpMax > 0 && r.mp / r.mpMax >= mr.threshold) mul *= 1 + mr.bonus;
    }
    // 수나타 소환: 소환 중 본인 공격력(피해) +buff — 소환수 자동공격에는 미적용 (솔로와 동일)
    if (!summonAttack && attacker.runtime && attacker.runtime.sunata && Date.now() < Number(attacker.runtime.sunata.expired_at || 0)) {
        mul *= 1 + Number(attacker.runtime.sunata.buff || 0);
    }
    // 건력: 상태 동안 공격력 증가 — 소환수 자동공격에는 미적용 (솔로와 동일)
    if (!summonAttack && attacker.runtime && attacker.runtime.gunryeok) {
        mul *= 1 + Number(attacker.runtime.gunryeok.atkBuff || 0);
    }
    return mul;
}

function getMonsterDealtDmgMul(monster) {
    let mul = 1;
    if (monster && monster.bossState && Number(monster.bossState.buffRemain || 0) > 0) {
        const pattern = getMonsterPattern(monster, 'selfBuff');
        mul *= Number(pattern.buff && pattern.buff.dealtDmg || 1.15);
    }
    if (monster && Array.isArray(monster.debuffs)) {
        for (const d of monster.debuffs) {
            if (d.type === 'dealtDmg') mul *= (1 + Number(d.value || 0));
        }
    }
    return Math.max(0.1, mul);
}

function getMonsterTakenDmgMul(monster) {
    let mul = 1;
    if (monster && monster.bossState && Number(monster.bossState.buffRemain || 0) > 0) {
        const pattern = getMonsterPattern(monster, 'selfBuff');
        mul *= Number(pattern.buff && pattern.buff.takenDmg || 0.85);
    }
    if (monster && Array.isArray(monster.debuffs)) {
        for (const d of monster.debuffs) {
            if (d.type === 'takenDamage') mul *= (1 + Number(d.value || 0));
        }
    }
    return Math.max(0, mul);
}

function getMonsterDefReduce(monster) {
    let rate = 0;
    if (monster && Array.isArray(monster.debuffs)) {
        for (const d of monster.debuffs) {
            if (d.type === 'defReduce') rate += Number(d.value || 0);
        }
    }
    return Math.max(0, Math.min(1, rate));
}

// 공격 시 방어력 감소(flat) 디버프 합산 — 공격자별로 누적된다
function getMonsterDefFlat(monster) {
    let flat = 0;
    if (monster && Array.isArray(monster.debuffs)) {
        for (const d of monster.debuffs) {
            if (d.type === 'defFlat') flat += Number(d.value || 0);
        }
    }
    return Math.max(0, flat);
}

function addMonsterDebuff(monster, debuff) {
    if (!monster || !debuff) return;
    if (!Array.isArray(monster.debuffs)) monster.debuffs = [];
    const id = debuff.id || debuff.type || 'debuff';
    const exist = monster.debuffs.find(d => d.id === id && d.type === debuff.type);
    if (exist) {
        Object.assign(exist, debuff, { id });
    } else {
        monster.debuffs.push(Object.assign({ id }, debuff));
    }
}

function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function getComboHitCount(stats) {
    const chance = Math.max(0, Math.min(1, Number(stats && stats.cmb || 0)));
    const maxHits = 2 + Math.max(0, Math.floor(Number(stats && stats.maxCmb || 0)));
    let hitCount = 1;
    while (hitCount < maxHits && Math.random() < chance) hitCount++;
    return hitCount;
}

function getReducedDefenseRate(stats, slotEffects, extraRate) {
    return Math.max(0, Math.min(1, Number(stats && stats.pntPercent || 0) + Number(slotEffects && slotEffects.defReduction || 0) + Number(extraRate || 0)));
}

function preparePartyAttackUnits(room, attacker, monster, extra, stats) {
    const runtime = attacker.runtime;
    const state = runtime.equipmentState || (runtime.equipmentState = {});
    const isFixedMultiHit = !!(extra && extra.hitCount);
    const comboHitCount = isFixedMultiHit ? 1 : Math.max(1, Number(extra.comboHitCount || getComboHitCount(stats)));
    extra.comboHitCount = comboHitCount;
    extra.attackUnitCount = comboHitCount;
    if (extra.summonAttack || extra.dotAttack) return;
    const perAttackUnitExtras = Array.from({ length: comboHitCount }, () => ({}));
    const add = (unit, key, value) => { perAttackUnitExtras[unit][key] = Number(perAttackUnitExtras[unit][key] || 0) + Number(value || 0); };
    const stage = name => getTranscendEquipmentEntry(attacker, name);
    const value = (name, base, per) => getTranscendStageValue(attacker, name, base, per);
    const duration = seconds => Number(seconds || 0) + getEquipmentEffectDurationBonus(attacker);
    const cooldown = seconds => Math.max(0, Number(seconds || 0) - getEquipmentEffectCooldownReduction(attacker));
    const attackBuffs = runtime.equipmentAtkBuffs || (runtime.equipmentAtkBuffs = {});
    if (stage('예고편')) extra.previewNextBefore = Number(state.previewNextFinal || 0);
    const activeAttackBuffAtStart = {
        manaBurnAttack: !!(attackBuffs.manaBurnAttack && Date.now() < Number(attackBuffs.manaBurnAttack.expiredAt || 0)),
        bloodHat: !!(attackBuffs.bloodHat && Date.now() < Number(attackBuffs.bloodHat.expiredAt || 0)),
        encore: !!(attackBuffs.encore && Date.now() < Number(attackBuffs.encore.expiredAt || 0))
    };
    if (getTranscendSetCount(attacker, '천공의 심판') >= 4 && !state.judgment && Date.now() >= Number(state.judgmentReadyAt || 0)) {
        state.judgment = { phaseIndex: room && room.phaseIndex, damage: 0, expiresAt: Date.now() + duration(8) * 1000 };
        state.judgmentReadyAt = Date.now() + cooldown(15) * 1000;
    }
    const markHpCost = () => { if (stage('흐르는 피')) state.flowingBloodNext = value('흐르는 피', .12, .04); };
    const manaBurnConfigs = [
        ['마나번 햇', 'manaBurnAttack', .02, 'damageBonusMul', scalePartyAttackBuff(attacker, value('마나번 햇', .15, .03))],
        ['마나번 로브', 'manaBurnElement', .02, 'allElementAtk', value('마나번 로브', 60, 10)],
        ['마나번 트라우저', 'manaBurnCrit', .02, 'critChanceBonus', value('마나번 트라우저', .10, .02)],
        ['마나번 슈즈', 'manaBurnExtra', .02, 'extraDamageBonus', value('마나번 슈즈', .10, .03)],
        ['현자의 마나번 로브', 'manaBurnElement', .01, 'allElementAtk', 100]
    ];

    for (let unit = 0; unit < comboHitCount; unit++) {
        if (Number(state.flowingBloodNext || 0) > 0) {
            add(unit, 'finalDamageBonus', Number(state.flowingBloodNext));
            delete state.flowingBloodNext;
        }
        for (const config of manaBurnConfigs) {
            const [name, key, costRate, modifierKey, buffValue] = config;
            if (!stage(name)) continue;
            const readyKey = key + 'ReadyAt';
            if (Date.now() >= Number(state[readyKey] || 0)) {
                const cost = Math.max(1, Math.round(Number(runtime.mpMax || 0) * costRate));
                if (Number(runtime.mp || 0) >= cost) {
                    runtime.mp -= cost;
                    state[key] = { value: buffValue, expiredAt: Date.now() + duration(60) * 1000 };
                    state[readyKey] = Date.now() + cooldown(60) * 1000;
                    if (key == 'manaBurnAttack') attackBuffs.manaBurnAttack = state[key];
                }
            }
            if (key == 'manaBurnAttack') {
                if (!activeAttackBuffAtStart.manaBurnAttack && state[key] && Date.now() < Number(state[key].expiredAt || 0)) add(unit, modifierKey, Number(state[key].value || 0));
            } else if (state[key] && Date.now() < Number(state[key].expiredAt || 0)) add(unit, modifierKey, Number(state[key].value || 0));
        }

        if (stage('핏빛 모자') && Date.now() >= Number(state.bloodHatReadyAt || 0)) {
            const cost = Math.max(1, Math.floor(Number(runtime.hp || 0) * .03));
            runtime.hp = Math.max(1, Number(runtime.hp || 0) - cost);
            const buff = { value: scalePartyAttackBuff(attacker, value('핏빛 모자', .18, .04)), expiredAt: Date.now() + duration(15) * 1000 };
            attackBuffs.bloodHat = buff;
            state.bloodHatReadyAt = Date.now() + cooldown(15) * 1000;
            markHpCost();
        }
        if (!activeAttackBuffAtStart.bloodHat && attackBuffs.bloodHat && Date.now() < Number(attackBuffs.bloodHat.expiredAt || 0)) add(unit, 'damageBonusMul', Number(attackBuffs.bloodHat.value || 0));

        if (stage('일레이나 전용 동전') && Date.now() >= Number(state.coinReadyAt || 0)) {
            state.coinBuff = Math.random() < .5
                ? { type: 'water', value: value('일레이나 전용 동전', 250, 50), expiredAt: Date.now() + duration(300) * 1000 }
                : { type: 'crit', value: value('일레이나 전용 동전', .20, .05), expiredAt: Date.now() + duration(300) * 1000 };
            state.coinReadyAt = Date.now() + cooldown(300) * 1000;
        }
        if (state.coinBuff && Date.now() < Number(state.coinBuff.expiredAt || 0)) {
            if (state.coinBuff.type == 'water') add(unit, 'waterAtk', Number(state.coinBuff.value || 0));
            if (state.coinBuff.type == 'crit') add(unit, 'critChanceBonus', Number(state.coinBuff.value || 0));
        }

        if (stage('메가카운트 추첨기')) {
            const pool = ['extra', 'final', 'mp', 'gold'];
            const picked = [];
            const count = getTranscendSetCount(attacker, 'TCG의 유산') >= 4 ? 2 : 1;
            while (picked.length < count) {
                const choice = pool[randomInt(0, pool.length - 1)];
                if (!picked.includes(choice)) picked.push(choice);
            }
            for (const choice of picked) {
                if (choice == 'extra') add(unit, 'extraDamageBonus', value('메가카운트 추첨기', .15, .05));
                if (choice == 'final') add(unit, 'finalDamageBonus', value('메가카운트 추첨기', .15, .05));
                if (choice == 'mp') runtime.mp = Math.min(runtime.mpMax, Number(runtime.mp || 0) + Math.max(1, Math.round(runtime.mpMax * value('메가카운트 추첨기', .005, .005))));
                if (choice == 'gold') {
                    runtime.pendingEquipmentGold = Number(runtime.pendingEquipmentGold || 0) + 500;
                    if (stage('행운의 복주머니')) state.fortuneExtraDamage = { value: value('행운의 복주머니', .10, .05), expiredAt: Date.now() + duration(10) * 1000 };
                }
            }
        }

        if (stage('해방의 열쇠') && Date.now() >= Number(state.liberationReadyAt || 0)) {
            const pool = ['element', 'attack', 'resist'];
            const choices = [];
            const count = getTranscendSetCount(attacker, 'TCG의 유산') >= 4 ? 2 : 1;
            while (choices.length < count) {
                const choice = pool[randomInt(0, pool.length - 1)];
                if (!choices.includes(choice)) choices.push(choice);
            }
            state.liberationBuff = { choices, elementValue: value('해방의 열쇠', 70, 20), resistValue: value('해방의 열쇠', 80, 20), expiredAt: Date.now() + duration(10) * 1000 };
            state.liberationReadyAt = Date.now() + cooldown(15) * 1000;
        }
        if (state.liberationBuff && Date.now() < Number(state.liberationBuff.expiredAt || 0)) {
            const choices = state.liberationBuff.choices || [];
            if (choices.includes('attack')) add(unit, 'damageBonusMul', scalePartyAttackBuff(attacker, value('해방의 열쇠', .10, .03)));
            if (choices.includes('element')) add(unit, 'allElementAtk', Number(state.liberationBuff.elementValue || 0));
        }

        if (stage('킹메이커 팔찌') && monster) addMonsterDebuff(monster, { id: 'kingmaker:' + attacker.name, type: 'defReduce', value: value('킹메이커 팔찌', .10, .02), remain: duration(5) });

        const totalElement = ['fireAtk', 'waterAtk', 'lightAtk', 'darkAtk'].reduce((sum, key) => sum + Number(stats[key] || 0) + Number(stats.allElementAtk || 0), 0)
            + getActiveKingElementBonus(attacker) * 4
            + Number(perAttackUnitExtras[unit].allElementAtk || 0) * 4 + Number(perAttackUnitExtras[unit].waterAtk || 0);
        if (stage('레인보우 프리즘') && totalElement >= 1000) {
            add(unit, 'finalDamageBonus', value('레인보우 프리즘', .15, .05));
            if (Date.now() >= Number(state.rainbowReadyAt || 0)) {
                add(unit, 'rainbowAttackRatio', value('레인보우 프리즘', 1.8, .4));
                state.rainbowReadyAt = Date.now() + cooldown(5) * 1000;
            }
        }

        state.attackCount = Number(state.attackCount || 0) + 1;
        if (stage('예고편')) {
            add(unit, 'finalDamageBonus', -.04 + Number(state.previewNextFinal || 0));
            state.previewNextFinal = value('예고편', .06, .02);
        }
        if (stage('예고의 예고') && state.attackCount % 2 == 0) add(unit, 'extraDamageBonus', value('예고의 예고', .15, .05));
        if (stage('예고의 예고의 예고') && state.attackCount % 3 == 0) add(unit, 'critChanceBonus', value('예고의 예고의 예고', .10, .05));
        if (getTranscendSetCount(attacker, '복선 회수') >= 4) {
            const cycle = stage('리턴즈파겜') ? ((state.attackCount % 3) + 1) : (((state.attackCount - 1) % 3) + 1);
            if (cycle == 1) add(unit, 'finalDamageBonus', -.08);
            if (cycle == 2) { add(unit, 'critChanceBonus', .20); add(unit, 'critMulBonus', .20); }
            if (cycle == 3) { add(unit, 'finalDamageBonus', .25); add(unit, 'pntBonus', 120); }
        }
        if (Number(stats.manaBurnAttackRecovery || 0) > 0) runtime.mp = Math.min(runtime.mpMax, Number(runtime.mp || 0) + Math.max(1, Math.round(runtime.mpMax * Number(stats.manaBurnAttackRecovery))));
    }
    extra.perAttackUnitExtras = perAttackUnitExtras;
    extra.partyBeforeAttackUnit = hitExtra => {
        if (!activeAttackBuffAtStart.encore && attackBuffs.encore && Date.now() < Number(attackBuffs.encore.expiredAt || 0)) {
            hitExtra.damageBonusMul = Number(hitExtra.damageBonusMul || 0) + Number(attackBuffs.encore.value || 0);
            hitExtra.critMulBonus = Number(hitExtra.critMulBonus || 0) + .20;
        }
        const burn = monster && Array.isArray(monster.debuffs) && monster.debuffs.find(d => d.id == 'emberBurn:' + attacker.name && d.type == 'dot');
        if (burn && getTranscendSetCount(attacker, '잿불의 장송곡') >= 4) hitExtra.finalDamageBonus = Number(hitExtra.finalDamageBonus || 0) + .10;
        if (stage('왓 타임 이즈 잇 나우') && Number(state.dropoutStacks || 0) > 0) {
            hitExtra.critMulBonus = Number(hitExtra.critMulBonus || 0) + Math.min(4, Number(state.dropoutStacks || 0)) * value('왓 타임 이즈 잇 나우', .08, .03);
        }
    };
    extra.partyAfterAttackUnit = isCritical => {
        let additionalDamage = 0;
        if (stage('앵콜') && isCritical) attackBuffs.encore = { value: scalePartyAttackBuff(attacker, value('앵콜', .12, .03)), expiredAt: Date.now() + duration(6) * 1000 };
        if (stage('왓 타임 이즈 잇 나우')) {
            const stacks = Math.min(4, Number(state.dropoutStacks || 0));
            if (isCritical) {
                if (stacks > 0) additionalDamage += Math.round(Number(stats.atk || 0) * value('왓 타임 이즈 잇 나우', .50, .05) * stacks * getPartyElementMultiplier(attacker, monster, extra.skillElement));
                state.dropoutStacks = 0;
            } else state.dropoutStacks = Math.min(4, stacks + 1);
        }
        if (stage('진사이') && Math.random() < .05) healMember(attacker, Math.round(200 * getPartyRecoveryMultiplier(attacker)));
        if (stage('잿불 모자') && monster && Date.now() >= Number(state.burnReadyAt || 0)) {
            const burnDamage = Math.max(1, Math.round(Number(stats.atk || 0) * value('잿불 모자', .30, .05) * (1 + Number(stats.burnDamage || 0) + (getTranscendSetCount(attacker, '잿불의 장송곡') >= 4 ? .35 : 0))));
            addMonsterDebuff(monster, { id: 'emberBurn:' + attacker.name, label: '화상', type: 'dot', dmg: burnDamage, interval: 2, tick: 2, remain: duration(8 + Number(stats.burnDurationFlat || 0)), explodeDamage: getTranscendSetCount(attacker, '잿불의 장송곡') >= 4 ? Number(stats.atk || 0) : 0, explodeLabel: '장송곡 폭발', sourceName: attacker.name, sourceSkill: '화상' });
            state.burnReadyAt = Date.now() + cooldown(6) * 1000;
        }
        return additionalDamage;
    };
}

function getPositionStatMul(room, member, key) {
    const quest = getQuestById(room && room.questId) || {};
    const posDef = (quest.positions && member && quest.positions[member.position]) || {};
    return posDef && posDef.stats && posDef.stats[key] != null ? Number(posDef.stats[key]) : 1;
}

function getDamageAfterDefense(damage, defense, penetration, defenseReductionRate) {
    const reducedDefense = Number(defense || 0) * (1 - Math.min(1, Math.max(0, Number(defenseReductionRate || 0))));
    const finalDefense = Math.max(0, reducedDefense - Number(penetration || 0));
    return Math.floor(Number(damage || 0) * (100 / (100 + finalDefense)));
}

function getFixedDamageAgainstMonster(damage, monster, penetration, defenseReductionRate) {
    return Math.max(0, Math.round(Number(damage || 0)));
}

function getDestinyDamageAgainstMonster(damage, monster, penetration, defenseReductionRate) {
    const reducedDefense = Number(monster && monster.def || 0) * (1 - Math.min(1, Math.max(0, Number(defenseReductionRate || 0))));
    const penetratedDefense = Math.max(0, reducedDefense - Number(penetration || 0));
    return getDamageAfterDefense(damage, penetratedDefense * 0.5, 0);
}

function getDestinyDamageAfterDefense(damage, defense, penetration, defenseReductionRate) {
    const reducedDefense = Number(defense || 0) * (1 - Math.min(1, Math.max(0, Number(defenseReductionRate || 0))));
    const penetratedDefense = Math.max(0, reducedDefense - Number(penetration || 0));
    return getDamageAfterDefense(damage, penetratedDefense * 0.5, 0);
}

// 파티 공격 속성 판정: 무기 > 스킬 > 보조>갑옷>장신구 (rest). 없으면 null
function resolvePartyAttackElement(attacker, skillElement) {
    const chain = (attacker && attacker.baseSnapshot && attacker.baseSnapshot.elementChain) || {};
    if (chain.weapon) return chain.weapon;
    const atkKeys = rpgenius.ELEMENT_ATK_KEYS || {};
    if (skillElement && atkKeys[skillElement]) return skillElement;
    return chain.rest || null;
}

// 공격 속성 배수: 1 + (공격자 속성 강화 - 대상 속성 저항) * 0.1%. 없으면 1
function getPartyElementMultiplier(attacker, monster, skillElement) {
    if (typeof rpgenius.getElementDamageMultiplier !== 'function') return 1;
    const elem = resolvePartyAttackElement(attacker, skillElement);
    if (!elem) return 1;
    const stats = Object.assign({}, (attacker && attacker.baseSnapshot && attacker.baseSnapshot.stats) || {});
    stats.allElementAtk = Number(stats.allElementAtk || 0) + getActiveKingElementBonus(attacker);
    const monsterResist = (monster && monster.stats) || {};
    return rpgenius.getElementDamageMultiplier(elem, stats, monsterResist);
}

function calculateNormalDamageToMonster(attacker, monster, room, rawDamage) {
    const snapshot = (attacker && attacker.baseSnapshot) || {};
    const stats = snapshot.stats || {};
    const slotEffects = snapshot.slotEffects || {};
    const quest = getQuestById(room && room.questId) || {};
    const posDef = (quest.positions && attacker && quest.positions[attacker.position]) || {};
    const monsterStats = (monster && monster.stats) || {};
    const defenseReductionRate = getReducedDefenseRate(stats, slotEffects, posDef && posDef.stats && posDef.stats.armorPen);
    const penetration = Number(stats.pnt || 0);
    let damage = Number(rawDamage || 0);
    damage *= Math.max(0, 1 + Number(monsterStats.takenDamage || 0)) * getMonsterTakenDmgMul(monster);
    damage = getDamageAfterDefense(damage, monster && monster.def, penetration, defenseReductionRate);
    return Math.max(0, applyDamageVariance(damage));
}

function calculateNormalDamageToMember(room, mon, target, rawDamage) {
    const quest = getQuestById(room.questId);
    const posDef = (quest.positions && quest.positions[target.position]) || {};
    const finalDefMul = (posDef && posDef.stats && posDef.stats.finalDef) || 1;
    const targetStats = target.baseSnapshot.stats || {};
    const targetSlotEffects = target.baseSnapshot.slotEffects || {};
    const monStats = mon.stats || {};
    const monDealtMul = getMonsterDealtDmgMul(mon);
    const mitigation = 1 - Math.min(1, Number(targetSlotEffects.hpDamageReduction || 0));
    const targetHpRatio = Number(target.runtime.hp || 0) / Math.max(1, Number(target.runtime.hpMax || 1));
    let equipmentReduction = 0;
    if (targetHpRatio <= .50) equipmentReduction += Number(targetStats.bloodFlowReduction || 0) * (targetHpRatio <= .30 ? 2 : 1);
    const attackerHpRatio = Number(mon && mon.hp || 0) / Math.max(1, Number(mon && mon.hpMax || 1));
    if (attackerHpRatio <= .50) equipmentReduction += getTranscendStageValue(target, '최후통첩 아머', .10, .04);
    if (target.runtime.gunryeok) equipmentReduction += Number(target.runtime.gunryeok.dmgReduce || 0);
    const kingBuffs = target.runtime.kingmakerBuffs || {};
    for (const key of Object.keys(kingBuffs)) {
        const buff = kingBuffs[key];
        if (buff && Date.now() < Number(buff.expiredAt || 0)) equipmentReduction += Number(buff.takenDamageReduction || 0);
    }
    const targetTakenMul = Math.max(0, 1 + Number(targetStats.takenDamage || 0)) * (target.runtime.takenDmgMul || 1) * Math.max(0, 1 - equipmentReduction);
    const defense = Number(targetStats.def || 50) * finalDefMul;
    const defenseReductionRate = Math.max(0, Math.min(1, Number(monStats.pntPercent || 0)));
    const penetration = Number(monStats.pnt || mon.pnt || 0);
    const beforeReduction = Number(rawDamage || 0) * monDealtMul;
    const afterReduction = beforeReduction * mitigation * targetTakenMul;
    const afterDefense = getDamageAfterDefense(afterReduction, defense, penetration, defenseReductionRate);
    let damage = afterDefense;
    // 몬스터가 element 속성을 가지면 플레이어 속성 저항 적용 (맨 마지막)
    const monElement = mon.element || monStats.element;
    if (monElement && typeof rpgenius.getElementDamageMultiplier === 'function') {
        damage *= rpgenius.getElementDamageMultiplier(monElement, monStats, getPartyDynamicDefenseStats(target));
    }
    const finalDamage = Math.max(0, applyDamageVariance(damage));
    const varianceScale = damage > 0 ? finalDamage / damage : 1;
    return {
        damage: finalDamage,
        mitigation: {
            buff: Math.max(0, beforeReduction - afterReduction) * varianceScale,
            defense: Math.max(0, afterReduction - afterDefense) * varianceScale,
            resistance: Math.max(0, afterDefense - damage) * varianceScale
        }
    };
}

function queuePartyBlackShadow(room, attacker, monster, damage, extra) {
    if (!room || !attacker || !extra || Number(extra.shadowDamageRate || 0) <= 0 || Number(damage || 0) <= 0) return;
    const shadowDamage = Math.max(1, Math.round(Number(damage) * Number(extra.shadowDamageRate)));
    const quest = getQuestById(room.questId);
    const phase = quest && quest.phases[room.phaseIndex];
    if (!room.monster && phase && phase.type === 'mob') {
        if (!Array.isArray(room.delayedEquipmentDamage)) room.delayedEquipmentDamage = [];
        room.delayedEquipmentDamage.push({ dueAt: Date.now() + 2000, phaseIndex: room.phaseIndex, attackerName: attacker.name, damage: shadowDamage });
        return;
    }
    if (monster && room.monster === monster) addMonsterDebuff(monster, { id: 'blackShadow:' + attacker.name + ':' + Date.now(), label: '그림자 공격', type: 'dot', dmg: shadowDamage, interval: 2, tick: 2, remain: 2, sourceName: attacker.name, sourceSkill: '그림자 공격' });
}

function recordPartyJudgmentDamage(room, attacker, result) {
    if (!room || !attacker || !result || !result.equipmentTriggerAllowed || Number(result.damage || 0) <= 0) return;
    const state = attacker.runtime && attacker.runtime.equipmentState;
    if (!state || !state.judgment || Number(state.judgment.phaseIndex) !== Number(room.phaseIndex) || Date.now() >= Number(state.judgment.expiresAt || 0)) return;
    state.judgment.damage = Number(state.judgment.damage || 0) + Number(result.damage || 0);
}

function applyDamageVariance(damage) {
    return Math.max(0, Math.round(Number(damage || 0) * (randomInt(98, 102) / 100)));
}

function computeBasicDamage(attacker, monster, room) {
    const snapshot = (attacker && attacker.baseSnapshot) || {};
    const stats = snapshot.stats || {};
    const slotEffects = snapshot.slotEffects || {};
    const quest = getQuestById(room && room.questId) || {};
    const posDef = (quest.positions && attacker && quest.positions[attacker.position]) || {};
    const runtime = (attacker && attacker.runtime) || {};
    const finalAtkMul = (posDef && posDef.stats && posDef.stats.finalAtk) || 1;
    const dealtDmgMul = (posDef && posDef.stats && posDef.stats.dealtDmg) || 1;
    const nextBasicBonus = Number(runtime.nextBasicDamageBonus || 0);
    if (runtime.nextBasicDamageBonus) runtime.nextBasicDamageBonus = 0;
    let finalAttackBonus = 0;
    let equipmentBasicBonus = 0;
    let cooldownNecklaceActive = false;
    if (getTranscendEquipmentEntry(attacker, '쿨다운 목걸이')) {
        const activeSkills = (attacker.skills || []).filter(name => {
            const def = resolveSkillDef(room, name, attacker);
            return def && def.type !== 'passive' && Number(def.cd || 0) > 0;
        });
        cooldownNecklaceActive = activeSkills.length > 0 && activeSkills.every(name => Number(runtime.cooldownsUntil && runtime.cooldownsUntil[name] || 0) > Date.now());
        if (cooldownNecklaceActive) {
            finalAttackBonus = getTranscendStageValue(attacker, '쿨다운 목걸이', .12, .03);
            equipmentBasicBonus = getTranscendStageValue(attacker, '쿨다운 목걸이', .35, .10);
        }
    }
    let rawDamage = Math.round(Number(stats.atk || 100) * finalAtkMul * (1 + getPartyAttackBuffValue(attacker)) * (1 + getPartyConditionalFinalAttack(attacker) + finalAttackBonus) * (1 + Number(stats.afterBasic || 0) + Number(slotEffects.basicDamageBonus || 0) + nextBasicBonus + equipmentBasicBonus));
    const extra = { isBasic: true };
    const equipmentState = runtime.equipmentState || {};
    if (equipmentState.bribeNextBasic) {
        rawDamage = Math.round(rawDamage * (1 + Number(equipmentState.bribeNextBasic.damage || 0)));
        extra.bribeDarkBonus = Number(equipmentState.bribeNextBasic.darkBonus || 0);
        delete equipmentState.bribeNextBasic;
    }
    if (Number(equipmentState.deepNextBasic || 0) > 0) {
        extra.deepWaterBonus = Number(equipmentState.deepNextBasic);
        delete equipmentState.deepNextBasic;
    }
    const result = calculateOutgoingDamage(attacker, monster, room, rawDamage, extra);
    if (cooldownNecklaceActive) {
        const attackUnits = Math.max(1, Number(result.attackUnitCount || 1));
        healMember(attacker, Math.max(1, Math.round(runtime.hpMax * .001 * attackUnits * getPartyRecoveryMultiplier(attacker))));
    }
    return result;
}

function calculateOutgoingDamage(attacker, monster, room, rawDamage, extra) {
    const snapshot = (attacker && attacker.baseSnapshot) || {};
    const stats = snapshot.stats || {};
    const slotEffects = snapshot.slotEffects || {};
    const quest = getQuestById(room && room.questId) || {};
    const posDef = (quest.positions && attacker && quest.positions[attacker.position]) || {};
    const runtime = (attacker && attacker.runtime) || {};
    const monsterStats = (monster && monster.stats) || {};
    preparePartyAttackUnits(room, attacker, monster, extra, stats);
    if (Number(monsterStats.avd || 0) > 0 && Math.random() < Math.max(0, Number(monsterStats.avd || 0))) {
        if (typeof extra.previewNextBefore !== 'undefined') runtime.equipmentState.previewNextFinal = Number(extra.previewNextBefore || 0);
        return { damage: 0, isCrit: false, hitCount: 0, criticalCount: 0, dodged: true };
    }
    if (extra && extra.isSkill && !extra.summonAttack) applyPartyCurrentShoesOnSkillHit(room, attacker, extra.skillName);
    const dealtDmgMul = (posDef && posDef.stats && posDef.stats.dealtDmg) || 1;
    let contextMul = 1;
    if (!monster || monster.type === 'mob') contextMul *= (1 + Number(slotEffects.damageBonus || 0)) * (1 + Number(stats.damageBonus || 0));
    if (monster && monster.type === 'elite') contextMul *= (1 + Number(slotEffects.damageBonus || 0)) * (1 + Number(stats.eliteDmg || 0));
    if (monster && monster.type === 'boss') contextMul *= (1 + Number(stats.bossDmg || 0));
    if (getTranscendEquipmentEntry(attacker, '과소평가')) {
        const elapsed = Date.now() - Number(runtime.equipmentState && runtime.equipmentState.combatStartedAt || Date.now());
        if (elapsed < 10000) contextMul *= .85;
        else {
            contextMul *= 1 + getTranscendStageValue(attacker, '과소평가', .25, .08);
            extra.critMulBonus = Number(extra && extra.critMulBonus || 0) + getTranscendStageValue(attacker, '과소평가', .20, .06);
        }
    }
    const targetHpRatio = Number(monster && monster.hp || 0) / Math.max(1, Number(monster && monster.hpMax || 1));
    const attackerHpRatio = Number(runtime.hp || 0) / Math.max(1, Number(runtime.hpMax || 1));
    const equipmentStateForTrigger = runtime.equipmentState || (runtime.equipmentState = {});
    if (Date.now() < Number(equipmentStateForTrigger.beomStacksUntil || 0) && Number(equipmentStateForTrigger.beomStacks || 0) > 0
        && resolvePartyAttackElement(attacker, extra && extra.skillElement) === '명') {
        extra.finalDamageBonus = Number(extra && extra.finalDamageBonus || 0) + Math.min(7, Number(equipmentStateForTrigger.beomStacks || 0)) * .02;
    }
    if (Date.now() < Number(equipmentStateForTrigger.trueBeomUntil || 0) && extra && extra.isSkill) {
        extra.extraDamageBonus = Number(extra.extraDamageBonus || 0) + getTranscendStageValue(attacker, '범부의 대나무', .30, .10);
    }
    if (equipmentStateForTrigger.fortuneExtraDamage && Date.now() < Number(equipmentStateForTrigger.fortuneExtraDamage.expiredAt || 0)) {
        extra.extraDamageBonus = Number(extra && extra.extraDamageBonus || 0) + Number(equipmentStateForTrigger.fortuneExtraDamage.value || 0);
    }
    if (targetHpRatio <= .50 && getTranscendEquipmentEntry(attacker, '최후통첩 모자') && Date.now() >= Number(equipmentStateForTrigger.ultimatumHatReadyAt || 0)) {
        if (!runtime.equipmentAtkBuffs) runtime.equipmentAtkBuffs = {};
        runtime.equipmentAtkBuffs.ultimatumHat = {
            value: scalePartyAttackBuff(attacker, getTranscendStageValue(attacker, '최후통첩 모자', .15, .04)),
            expiredAt: Date.now() + (8 + getEquipmentEffectDurationBonus(attacker)) * 1000
        };
        equipmentStateForTrigger.ultimatumHatReadyAt = Date.now() + Math.max(0, 12 - getEquipmentEffectCooldownReduction(attacker)) * 1000;
    }
    if (getTranscendSetCount(attacker, '최후 통첩') >= 4) {
        if (targetHpRatio >= .70) extra.finalDamageBonus = Number(extra && extra.finalDamageBonus || 0) + .10;
        if (targetHpRatio <= .30) extra.finalDamageBonus = Number(extra && extra.finalDamageBonus || 0) + .18;
    }
    if (targetHpRatio <= .60 && getTranscendEquipmentEntry(attacker, '정복자의 최후통첩')) extra.finalDamageBonus = Number(extra && extra.finalDamageBonus || 0) + .20;
    if (targetHpRatio <= .30) {
        extra.pntBonus = Number(extra && extra.pntBonus || 0) + getTranscendStageValue(attacker, '최후통첩 트라우저', 150, 40);
        extra.extraDamageBonus = Number(extra && extra.extraDamageBonus || 0) + getTranscendStageValue(attacker, '최후통첩 슈즈', .20, .05);
    }
    if (attackerHpRatio <= .50) extra.extraDamageBonus = Number(extra && extra.extraDamageBonus || 0) + Number(stats.bloodyShoesExtraDamage || 0) + Number(stats.vladimirExtraDamage || 0);
    if (attackerHpRatio <= .20 && getTranscendEquipmentEntry(attacker, '진사이')) extra.finalDamageBonus = Number(extra && extra.finalDamageBonus || 0) + getTranscendStageValue(attacker, '진사이', .30, .05);
    if (extra && extra.isSkill && attackerHpRatio <= .60 && Number(stats.blackEchoSkillDamage || 0) > 0) {
        const currentSkillMul = Math.max(.01, 1 + Number(stats.afterSkill || 0));
        contextMul *= (currentSkillMul + Number(stats.blackEchoSkillDamage)) / currentSkillMul;
    }
    if (attackerHpRatio <= .50 && equipmentStateForTrigger.abyssBuff && Date.now() < Number(equipmentStateForTrigger.abyssBuff.expiredAt || 0)) contextMul *= 1.08;
    if (getTranscendEquipmentEntry(attacker, '마나 증폭 장치')) {
        const mpRatio = Number(runtime.mp || 0) / Math.max(1, Number(runtime.mpMax || 1));
        if (mpRatio > .20) contextMul *= 1 + Number(stats.manaAmplifierFinalAtk || 0);
        if (mpRatio >= .50) extra.extraDamageBonus = Number(extra && extra.extraDamageBonus || 0) + getTranscendStageValue(attacker, '마나 증폭 장치', .08, .04);
    }
    if (getTranscendEquipmentEntry(attacker, '포상 정산 반지')) {
        const hpRatio = Number(runtime.hp || 0) / Math.max(1, Number(runtime.hpMax || 1));
        const mpRatio = Number(runtime.mp || 0) / Math.max(1, Number(runtime.mpMax || 1));
        const diff = Math.abs(hpRatio - mpRatio);
        if (diff >= .30) contextMul *= 1 + getTranscendStageValue(attacker, '포상 정산 반지', .12, .04);
        if (diff >= .50) extra.finalDamageBonus = Number(extra && extra.finalDamageBonus || 0) + getTranscendStageValue(attacker, '포상 정산 반지', .16, .04);
    }
    // 공격 시 5초간 방어력 감소(flat) — 몬스터 디버프(파티 전체 이득), 공격자별 누적, 소환 자동공격 제외
    if (monster && !(extra && extra.summonAttack) && Number(stats.atkDefReduce || 0) > 0) {
        addMonsterDebuff(monster, { id: 'atkDefReduce:' + (attacker && attacker.name), type: 'defFlat', value: Number(stats.atkDefReduce || 0), remain: 5 });
    }
    // '월도랜드' 필드(퀘스트) 공격 시 추가 피해
    if (/월도랜드/.test(String(quest.name || ''))) extra.extraDamageBonus = Number(extra && extra.extraDamageBonus || 0) + Number(stats.waldolandDmg || 0);
    // 향후 추가될 '부타게임' 파티 퀘스트에서만 적용되는 추가 피해
    if (/부타게임/.test(String(quest.name || '') + ' ' + String(quest.id || ''))) extra.extraDamageBonus = Number(extra && extra.extraDamageBonus || 0) + Number(stats.butagamePartyQuestDmg || 0);
    // 10번째 공격마다 최종 공격력 증가 (흠시원; 소환수 자동공격 제외, 연격 각각 별도 집계해 해당 타격에만 적용)
    const tenthAtk = Number(slotEffects.tenthHitFinalAtk || 0);
    const tenthAtkStart = (!(extra && extra.summonAttack) && tenthAtk > 0) ? Number(runtime.attackCounter || 0) : null;
    contextMul *= 1 + Number(extra && extra.damageBonusMul || 0);
    // [무]속성 공격 시 최종 피해 증가 + 범인은 이 안에(다음 공격 최종 피해)
    let extraFinalDamage = Number(extra && extra.finalDamageBonus || 0);
    const equipmentState = runtime.equipmentState || {};
    if (equipmentState.cleanWaterBuff && Date.now() < Number(equipmentState.cleanWaterBuff.expiredAt || 0) && resolvePartyAttackElement(attacker, extra && extra.skillElement) === '수') {
        extraFinalDamage += Number(equipmentState.cleanWaterBuff.value || 0);
    }
    if (equipmentState.deepWaterAttackBuff && Date.now() < Number(equipmentState.deepWaterAttackBuff.expiredAt || 0) && resolvePartyAttackElement(attacker, extra && extra.skillElement) === '수') {
        extraFinalDamage += Number(equipmentState.deepWaterAttackBuff.value || 0);
    }
    if (equipmentState.darkAttackBuff && Date.now() < Number(equipmentState.darkAttackBuff.expiredAt || 0) && resolvePartyAttackElement(attacker, extra && extra.skillElement) === '암') {
        extraFinalDamage += Number(equipmentState.darkAttackBuff.value || 0);
    }
    if (equipmentState.blackEchoShoesBuff && Date.now() < Number(equipmentState.blackEchoShoesBuff.expiredAt || 0) && resolvePartyAttackElement(attacker, extra && extra.skillElement) === '암') {
        extra.extraDamageBonus = Number(extra.extraDamageBonus || 0) + Number(equipmentState.blackEchoShoesBuff.value || 0);
    }
    // 명속성 공격 최종 피해(lightFinalDamage): 천공의 갑옷 등 스탯 보유 장비 공통 (솔로 calculateAttackHitResult와 동일 규칙)
    if (resolvePartyAttackElement(attacker, extra && extra.skillElement) === '명') extraFinalDamage += Number(stats.lightFinalDamage || 0);
    if (!resolvePartyAttackElement(attacker, extra && extra.skillElement)) extraFinalDamage += Number(slotEffects.nonElementFinalDamage || 0);
    // 보호막 공격 시 최종 피해 증가 (전직 흠시원 슬롯 효과)
    if (Number(monster && monster.shield || 0) > 0) extraFinalDamage += Number(slotEffects.shieldFinalDamage || 0);
    if (extra && extra.isBasic && Number(runtime.nextFinalDamageBonus || 0) > 0) {
        extraFinalDamage += Number(runtime.nextFinalDamageBonus || 0);
        runtime.nextFinalDamageBonus = 0;
    }
    const isFixedMultiHit = !!(extra && extra.hitCount);
    const comboHitCount = isFixedMultiHit ? 1 : Math.max(1, Math.floor(Number(extra && extra.comboHitCount || getComboHitCount(stats))));
    const hitCount = isFixedMultiHit ? Math.max(1, Math.floor(Number(extra.hitCount || 1))) : comboHitCount;
    const defenseReductionRate = Math.min(1, getReducedDefenseRate(stats, slotEffects, posDef && posDef.stats && posDef.stats.armorPen) + getMonsterDefReduce(monster) + Number(extra && extra.defReductionBonus || 0));
    let penetration = (typeof extra.pnt !== 'undefined' ? Number(extra.pnt || 0) : Number(stats.pnt || 0)) + Number(extra && extra.pntBonus || 0);
    if (runtime.pntBonusUntil && Date.now() < Number(runtime.pntBonusUntil)) penetration += Number(runtime.pntBonusValue || 0);
    // 방어력 감소(flat) 반영한 유효 방어력
    const monsterDef = Math.max(0, Number(monster && monster.def || 0) - getMonsterDefFlat(monster));
    let crit = Number(stats.crit || 0) + Number(extra && extra.critChanceBonus || 0);
    if (extra && typeof extra.critChanceMul !== 'undefined') crit *= Number(extra.critChanceMul || 0);
    const trueDamageOnCrit = !!(extra && extra.trueDamageOnCrit) || !!runtime.trueDamageOnCritNext;
    if (runtime.critBoostNext > 0) { crit += runtime.critBoostNext; runtime.critBoostNext = 0; }
    if (runtime.trueDamageOnCritNext) runtime.trueDamageOnCritNext = false;
    let damage = 0;
    let fixedDamage = 0;
    let destinyDamage = 0;
    let criticalCount = 0;
    const hitDamages = [];
    const hitDetails = [];
    let totalHits = hitCount;
    const maxHits = extra && extra.extraOnCrit ? Math.max(totalHits, Math.floor(Number(extra.extraOnCrit.max || totalHits))) : totalHits;
    const maxComboHits = 2 + Math.max(0, Math.floor(Number(stats.maxCmb || 0)));
    let abyssDoomUsed = false;
    for (let i = 0; i < totalHits; i++) {
        const unitIndex = isFixedMultiHit ? 0 : Math.min(i, comboHitCount - 1);
        const unitModifier = extra && Array.isArray(extra.perAttackUnitExtras) ? (extra.perAttackUnitExtras[unitIndex] || {}) : {};
        const hitExtra = Object.assign({}, extra || {});
        Object.keys(unitModifier).forEach(key => {
            if (typeof unitModifier[key] === 'number') hitExtra[key] = Number(hitExtra[key] || 0) + Number(unitModifier[key]);
            else hitExtra[key] = unitModifier[key];
        });
        if (typeof hitExtra.partyBeforeAttackUnit === 'function') hitExtra.partyBeforeAttackUnit(hitExtra);
        const hitStats = Object.assign({}, stats || {});
        hitStats.allElementAtk = Number(hitStats.allElementAtk || 0) + getActiveKingElementBonus(attacker);
        ['allElementAtk', 'fireAtk', 'waterAtk', 'lightAtk', 'darkAtk'].forEach(key => { hitStats[key] = Number(hitStats[key] || 0) + Number(unitModifier[key] || 0); });
        const attackElement = resolvePartyAttackElement(attacker, hitExtra.skillElement);
        // 무속성 공격일 때만 [무]속성 공격 피해가 적용된다 (속성 배수 자리에 곱연산)
        const elementMul = attackElement
            ? (typeof rpgenius.getElementDamageMultiplier === 'function' ? rpgenius.getElementDamageMultiplier(attackElement, hitStats, monsterStats) : 1)
            : 1 + Number(hitStats.nonElementDamage || 0);
        const darkMul = typeof rpgenius.getElementDamageMultiplier === 'function' ? rpgenius.getElementDamageMultiplier('암', hitStats, monsterStats) : 1;
        const waterMul = typeof rpgenius.getElementDamageMultiplier === 'function' ? rpgenius.getElementDamageMultiplier('수', hitStats, monsterStats) : 1;
        const unitDamageBonus = Number(hitExtra.damageBonusMul || 0) - Number(extra && extra.damageBonusMul || 0);
        const unitFinalBonus = Number(hitExtra.finalDamageBonus || 0) - Number(extra && extra.finalDamageBonus || 0);
        const unitCritBonus = Number(hitExtra.critChanceBonus || 0) - Number(extra && extra.critChanceBonus || 0);
        const unitPntBonus = Number(hitExtra.pntBonus || 0) - Number(extra && extra.pntBonus || 0);
        const unitDefReductionBonus = Number(hitExtra.defReductionBonus || 0) - Number(extra && extra.defReductionBonus || 0);
        const unitExtraDamageBonus = Number(hitExtra.extraDamageBonus || 0) - Number(extra && extra.extraDamageBonus || 0);
        let hitContextMul = contextMul * (1 + unitDamageBonus);
        const tenthOffset = isFixedMultiHit ? 0 : i;
        if (tenthAtkStart !== null && i < comboHitCount && (tenthAtkStart + tenthOffset + 1) % 10 === 0) hitContextMul *= 1 + tenthAtk;
        let hitDamage = rawDamage * hitContextMul * (1 + Number(stats.finalDamage || 0) + extraFinalDamage + unitFinalBonus) * dealtDmgMul * getFinalDamageMul(attacker, { summonAttack: !!(extra && extra.summonAttack) });
        let fixedHitDamage = 0;
        let destinyHitDamage = 0;
        const isComboExtraHit = !isFixedMultiHit && i > 0 && i < comboHitCount;
        const forceComboLastCrit = !!(isComboExtraHit && stats.comboLastCrit && comboHitCount >= maxComboHits && i === comboHitCount - 1);
        const unitCrit = crit + unitCritBonus;
        const isCrit = hitExtra.disableCritical ? false : (hitExtra.forceCritical || forceComboLastCrit ? true : Math.random() < Math.max(0, unitCrit));
        if (isCrit) {
            const comboCritBonus = isComboExtraHit ? Number(stats.comboCritMul || 0) : 0;
            const lastCritBonus = forceComboLastCrit ? Number(stats.comboLastCritMul || 0) : 0;
            // 치명타 배율: 솔로 applyCriticalDamage와 동일 — 치명타 피해 감소율(critDef)은 치명타 추가분에 대한 감소율로 적용
            const totalCritMul = Number(stats.critMul || 1.4) + Number(hitExtra.critMulBonus || 0) + comboCritBonus + lastCritBonus;
            hitDamage = Math.round(hitDamage * (1 + Math.max(0, totalCritMul - 1) * (1 - Math.min(1, Math.max(0, Number(monsterStats.critDef || 0))))));
            criticalCount++;
            if (extra && extra.extraOnCrit && totalHits < maxHits) totalHits++;
            if (stats && stats.hasAbyssDoom && extra && extra.isBasic && !abyssDoomUsed && Math.random() < 0.3) {
                totalHits++;
                abyssDoomUsed = true;
            }
        }
        
        // 별빛의 축복: 방어 연산 전 피해의 15%를 고정 피해로 추가 (솔로 calculateAttackHitResult와 동일 — 방어 연산 뒤에 가산)
        const celestiaBonus = !(extra && extra.disableEquipmentBonusDamage) && stats && stats.hasCelestia && extra && extra.isSkill && Math.random() < 0.2
            ? Math.round(hitDamage * 0.15) : 0;

        hitDamage *= Math.max(0, 1 + Number(monsterStats.takenDamage || 0)) * getMonsterTakenDmgMul(monster);
        const unitPenetration = penetration + unitPntBonus;
        const unitDefenseReduction = Math.min(1, defenseReductionRate + unitDefReductionBonus);
        if (trueDamageOnCrit && isCrit) {
            hitDamage = getFixedDamageAgainstMonster(hitDamage, monster, unitPenetration, unitDefenseReduction);
            fixedHitDamage += hitDamage;
        } else if (Number(stats.trueDamageChance || 0) > 0 && Math.random() < Number(stats.trueDamageChance || 0)) {
            hitDamage = getDestinyDamageAfterDefense(hitDamage, monsterDef, unitPenetration, unitDefenseReduction);
            destinyHitDamage += hitDamage;
        } else {
            hitDamage = getDamageAfterDefense(hitDamage, monsterDef, unitPenetration, unitDefenseReduction);
        }
        if (celestiaBonus > 0) {
            hitDamage += celestiaBonus;
            fixedHitDamage += celestiaBonus;
        }
        if (!(extra && extra.disableEquipmentBonusDamage) && Number(stats['000'] || 0) > 0 && Math.random() < Number(stats['000'])) {
            const bonus = getFixedDamageAgainstMonster([10, 100, 1000][randomInt(0, 2)], monster, penetration, defenseReductionRate);
            hitDamage += bonus;
            fixedHitDamage += bonus;
        }
        if (extra && Number(extra.skillTrueDmg || 0) > 0) {
            const bonus = getFixedDamageAgainstMonster(Number(extra.skillTrueDmg || 0), monster, penetration, defenseReductionRate);
            hitDamage += bonus;
            fixedHitDamage += bonus;
        }
        if (elementMul !== 1) { // 속성 배수: 맨 마지막 적용 (총/고정/운명 비례 스케일)
            hitDamage = Math.max(0, hitDamage * elementMul);
            fixedHitDamage *= elementMul;
            destinyHitDamage *= elementMul;
        }
        const lightMul = typeof rpgenius.getElementDamageMultiplier === 'function' ? rpgenius.getElementDamageMultiplier('명', hitStats, monsterStats) : 1;
        if (!(extra && extra.disableEquipmentBonusDamage) && isCrit && Number(stats.critLightBonus || 0) > 0) hitDamage += Number(stats.atk || 0) * Number(stats.critLightBonus) * lightMul;
        if (!(extra && extra.disableEquipmentBonusDamage) && !isCrit && Number(stats.nonCritLightBonus || 0) > 0) hitDamage += Number(stats.atk || 0) * Number(stats.nonCritLightBonus) * lightMul;
        if (!(extra && extra.disableEquipmentBonusDamage) && isCrit && i === 0 && Number(extra && extra.bribeDarkBonus || 0) > 0) hitDamage += Number(stats.atk || 0) * Number(extra.bribeDarkBonus) * darkMul;
        if (!(extra && extra.disableEquipmentBonusDamage) && i === 0 && Number(extra && extra.deepWaterBonus || 0) > 0) hitDamage += Number(stats.atk || 0) * Number(extra.deepWaterBonus) * waterMul;
        if (!(extra && extra.disableEquipmentBonusDamage) && resolvePartyAttackElement(attacker, extra && extra.skillElement) && Number(stats.elementalExtraDamage || 0) > 0) hitDamage += hitDamage * Number(stats.elementalExtraDamage);
        if (isComboExtraHit && Number(stats.comboDamage || 0) !== 0) hitDamage *= 1 + Number(stats.comboDamage);
        if (!(extra && extra.disableEquipmentBonusDamage) && Number(hitExtra.rainbowAttackRatio || 0) > 0) hitDamage += Number(stats.atk || 0) * Number(hitExtra.rainbowAttackRatio) * elementMul;
        if (unitExtraDamageBonus > 0) hitDamage += hitDamage * unitExtraDamageBonus;
        if (!isFixedMultiHit && i < comboHitCount && typeof hitExtra.partyAfterAttackUnit === 'function') hitDamage += Math.max(0, Number(hitExtra.partyAfterAttackUnit(isCrit) || 0));
        fixedDamage += fixedHitDamage;
        destinyDamage += destinyHitDamage;
        let finalHitDamage = applyDamageVariance(hitDamage);
        if (i === 0 && Number(extra && extra.oneTimeFinalDamage || 0) > 0) finalHitDamage += Math.max(0, Math.round(Number(extra.oneTimeFinalDamage)));
        hitDamages.push(finalHitDamage);
        hitDetails.push({ damage: finalHitDamage, fixedDamage: Math.max(0, Math.round(fixedHitDamage)), destinyDamage: Math.max(0, Math.round(destinyHitDamage)), crit: !!isCrit, isComboHit: isComboExtraHit, comboLastCrit: forceComboLastCrit });
        damage += finalHitDamage;
    }
    if (isFixedMultiHit && typeof extra.partyAfterAttackUnit === 'function') {
        const additional = Math.max(0, Math.round(Number(extra.partyAfterAttackUnit(hitDetails.some(detail => detail.crit)) || 0)));
        if (additional > 0 && hitDetails.length > 0) {
            hitDetails[hitDetails.length - 1].damage += additional;
            hitDamages[hitDamages.length - 1] += additional;
            damage += additional;
        }
    }
    // 10번째 공격마다 최종 공격력 증가: 이번 행동에서 실제로 발생한 히트 수만큼 카운터 전진
    // 고정 다단 일반 공격(포커 못 하시네)은 실제 타격 수만큼 공격 횟수로 집계한다 (솔로 separateBasicAttackHits와 동일)
    const attackUnitsForCounters = extra && extra.separateBasicAttackHits ? Math.max(1, hitDetails.length) : comboHitCount;
    if (tenthAtkStart !== null) runtime.attackCounter = tenthAtkStart + attackUnitsForCounters;
    // 나인 멘스 모리스 패시브: 일반 공격/일반 취급 공격(countAsBasic)은 각 타격마다 중첩 (연격 각각), 최대 9
    if (!(extra && extra.summonAttack) && extra && extra.isBasic && attacker && attacker.skills && attacker.skills.includes('나인 멘스 모리스')) {
        if (!attacker.runtime.stackCounters) attacker.runtime.stackCounters = {};
        attacker.runtime.stackCounters['나인멘스'] = Math.min(9, Number(attacker.runtime.stackCounters['나인멘스'] || 0) + attackUnitsForCounters);
    }
    // 추가 피해: 모든 계산이 끝난 최종 피해에 마지막으로 비율만큼 더한다
    let extraDamageDealt = 0;
    const extraDamageRate = extra && extra.disableEquipmentBonusDamage ? 0 : Math.max(0, Number(stats.extraDamage || 0)) + Math.max(0, Number(extra && extra.extraDamageBonus || 0));
    if (extraDamageRate > 0 && damage > 0) {
        extraDamageDealt = Math.floor(damage * extraDamageRate);
        damage += extraDamageDealt;
    }
    const result = { damage: Math.max(1, Math.round(damage)), fixedDamage: Math.max(0, Math.round(fixedDamage)), destinyDamage: Math.max(0, Math.round(destinyDamage)), isCrit: criticalCount > 0, hitCount: hitDetails.length, attackUnitCount: comboHitCount, criticalCount, hitDamages, hitDetails, extraDamageDealt: Math.round(extraDamageDealt), equipmentTriggerAllowed: !(extra && (extra.disableEquipmentBonusDamage || extra.summonAttack || extra.dotAttack)) };
    queuePartyBlackShadow(room, attacker, monster, result.damage, extra);
    return result;
}

function dealSkillDamageToMonster(room, attacker, rawDamage, extra) {
    extra = extra || {};
    extra.isSkill = true;
    if (!room.monster) return { damage: 0, isCrit: false };
    const result = calculateOutgoingDamage(attacker, room.monster, room, rawDamage, extra);
    const invincible = !!(room.monster.bossState && room.monster.bossState.casting);
    if (invincible) result.damage = 0;
    else result.damage = applyPlayerDamageToBoss(room, room.monster, attacker, result.damage);
    recordPartyDamage(attacker, result, extra.skillName || '스킬 피해');
    recordPartyJudgmentDamage(room, attacker, result);
    applyBlackHoduCritReflect(room, attacker, result);
    return result;
}

function performBasicAttack(room, attacker) {
    const mon = room.monster;
    if (!mon) return null;
    const r = computeBasicDamage(attacker, mon, room);
    const invincible = !!(mon.bossState && mon.bossState.casting);
    if (invincible) r.damage = 0;
    else r.damage = applyPlayerDamageToBoss(room, mon, attacker, r.damage);
    recordPartyDamage(attacker, r, '기본 공격');
    recordPartyJudgmentDamage(room, attacker, r);
    applyAttackPotentialRecovery(room, attacker);
    applyMainCardPassiveMpRecovery(room, attacker);
    applyBlackHoduCritReflect(room, attacker, r);
    pushCombat(room, attacker.name + ' → ' + mon.name + ' [-' + r.damage + (r.isCrit ? ' 치명' : '') + ']', 'attack');
    broadcast(room, 'hit', {
        by: attacker.name,
        type: 'attack',
        damage: r.damage,
        fixedDamage: r.fixedDamage || 0,
        destinyDamage: r.destinyDamage || 0,
        crit: !!r.isCrit,
        hitCount: r.hitCount || 1,
        hitDetails: r.hitDetails || [],
        monster: serializeMonster(mon)
    });
    return r;
}

function applyAttackPotentialRecovery(room, member) {
    const stats = member && member.baseSnapshot && member.baseSnapshot.stats || {};
    if (!member || !member.runtime || member.runtime.dead) return;
    const recoveryMul = 1 + Number(stats.recoveryEfficiency || 0);
    let hpRecovered = 0;
    let mpRecovered = 0;
    if (Math.random() < 0.1 && Number(stats.attackHpRecovery || 0) > 0) {
        hpRecovered = healMember(member, Math.round(Number(stats.attackHpRecovery || 0) * recoveryMul));
    }
    if (Math.random() < 0.1 && Number(stats.attackMpRecovery || 0) > 0) {
        const before = member.runtime.mp;
        member.runtime.mp = Math.min(member.runtime.mpMax, member.runtime.mp + Math.round(Number(stats.attackMpRecovery || 0) * recoveryMul));
        mpRecovered = member.runtime.mp - before;
    }
    if (hpRecovered > 0 || mpRecovered > 0) pushCombat(room, member.name + ' 공격 회복' + (hpRecovered > 0 ? ' HP +' + comma(hpRecovered) : '') + (mpRecovered > 0 ? ' MP +' + comma(mpRecovered) : ''), 'heal');
}

// ===== 몬스터 행동 =====

function pickMonsterTarget(room, mon) {
    if (mon.tauntRemain > 0 && mon.tauntTarget) {
        const t = findMember(room, mon.tauntTarget);
        if (t && !t.runtime.dead) return t;
    }
    const alive = room.members.filter(m => !m.runtime.dead);
    if (!alive.length) return null;
    return alive[Math.floor(Math.random() * alive.length)];
}

function performMonsterAction(room) {
    const mon = room.monster;
    const target = pickMonsterTarget(room, mon);
    if (!target) return;
    const dmg = computeMonsterDamage(room, mon, target);
    applyMonsterAttackRecovery(mon);
    applyDamageToMember(room, target, dmg, mon.name);
}

function performMobCounterAttack(room, mon, target) {
    if (!mon || !target || !target.runtime || target.runtime.dead) return;
    const taunted = room.tauntRemain > 0 && room.tauntTarget ? findMember(room, room.tauntTarget) : null;
    const actualTarget = taunted && taunted.runtime && !taunted.runtime.dead ? taunted : target;
    const dmg = computeMonsterDamage(room, mon, actualTarget);
    applyMonsterAttackRecovery(mon);
    applyDamageToMember(room, actualTarget, dmg, mon.name);
}

function applyMonsterAttackRecovery(mon) {
    const stats = (mon && mon.stats) || {};
    const recoveryMul = 1 + Number(stats.recoveryEfficiency || 0);
    if (Math.random() < 0.1 && Number(stats.attackHpRecovery || 0) > 0) mon.hp = Math.min(mon.hpMax, mon.hp + Math.round(Number(stats.attackHpRecovery || 0) * recoveryMul));
    if (Math.random() < 0.1 && Number(stats.attackMpRecovery || 0) > 0) mon.mp = Math.min(mon.mpMax || 0, Number(mon.mp || 0) + Math.round(Number(stats.attackMpRecovery || 0) * recoveryMul));
}

function getAliveMembers(room) {
    return room.members.filter(m => m.runtime && !m.runtime.dead);
}

function pickTauntOrNull(room, mon) {
    const tauntName = room.tauntRemain > 0 && room.tauntTarget ? room.tauntTarget : (mon && mon.tauntRemain > 0 && mon.tauntTarget ? mon.tauntTarget : null);
    if (!tauntName) return null;
    const target = findMember(room, tauntName);
    return target && target.runtime && !target.runtime.dead ? target : null;
}

function applyFixedDamageToMember(room, member, amount, source) {
    if (!member || !member.runtime || member.runtime.dead) return 0;
    const before = member.runtime.hp;
    const incoming = amount && typeof amount === 'object'
        ? amount
        : Math.max(0, Math.round(Number(amount || 0)));
    applyDamageToMember(room, member, incoming, source);
    return Math.max(0, before - member.runtime.hp);
}

function getMonsterPattern(mon, type) {
    return mon && Array.isArray(mon.patterns) ? (mon.patterns.find(p => p && p.type === type) || {}) : {};
}

// 암흑의 저주 발동: 체력을 threshold(40%)로 되돌리고 windowSec 동안 발동 창을 연다.
function triggerBlackHoduCurse(room, mon) {
    const st = mon && mon.bossState;
    if (!st || st.curseTriggered) return;
    const pattern = getMonsterPattern(mon, 'curseRevive');
    const floorRatio = Number(pattern.threshold || 0.4);
    st.curseTriggered = true;
    st.curseRemain = Number(pattern.windowSec || 5);
    mon.hp = Math.max(1, Math.ceil(mon.hpMax * floorRatio));
    pushNotice(room, '암흑의 저주 — ' + st.curseRemain + '초간 공격 시 전멸', 'danger', 5000);
    pushCombat(room, mon.name + ' [' + (pattern.name || '암흑의 저주') + '] 체력을 ' + Math.round(floorRatio * 100) + '%로 되돌립니다', 'danger');
}

function wipePartyByCurse(room, mon) {
    wipeParty(room, '암흑의 저주', (mon ? mon.name : '보스') + ' [암흑의 저주] 발동 — 보스를 공격하여 파티 전멸');
}

// 기믹 실패 전멸 공용 처리
function wipeParty(room, reason, combatLine) {
    for (const m of room.members) {
        if (m.runtime && !m.runtime.dead) { m.runtime.hp = 0; m.runtime.dead = true; }
    }
    pushCombat(room, combatLine || (reason + ' — 파티 전멸'), 'danger');
    endQuest(room, false, reason);
}

// 플레이어가 보스에게 피해를 줄 때의 익스트림 기믹 처리. 실제 적용된 피해를 반환.
function applyPlayerDamageToBoss(room, mon, attacker, damage) {
    damage = Math.max(0, Math.round(Number(damage) || 0));
    const st = mon && mon.bossState;
    if (st && damage > 0) {
        // 칠흑의 방패: 지정된 역할군만 피해를 줄 수 있다.
        if (st.shieldRemain > 0 && st.shieldRole && (!attacker || attacker.position !== st.shieldRole)) {
            pushCombat(room, mon.name + ' [칠흑의 방패] ' + ((attacker && attacker.name) || '공격') + ' 피해 무효', 'buff');
            return 0;
        }
        // 암흑의 저주 발동 창: 보스에게 피해를 입히면 전멸을 예약(틱에서 처리해 안전하게).
        if (st.curseRemain > 0) {
            st.curseWipeArmed = true;
            return 0;
        }
        // 암흑의 저주: 최초로 40% 미만으로 떨어지는 피해는 40%로 복구되며 발동한다.
        const cursePattern = getMonsterPattern(mon, 'curseRevive');
        if (cursePattern.type && !st.curseTriggered) {
            const floor = Math.max(1, Math.ceil(mon.hpMax * Number(cursePattern.threshold || 0.4)));
            if (mon.hp - damage < floor) {
                const applied = Math.max(0, mon.hp - floor);
                triggerBlackHoduCurse(room, mon);
                return applied;
            }
        }
    }
    return applyBossHpDamage(room, mon, damage);
}

// 몬스터 HP를 깎는 유일한 경로. 보호막이 남아있으면 먼저 소모하고 HP는 무손상(초과분 소멸).
// mon.hpFloor가 있으면 그 아래로 내려가지 않는다(폭주 잉여왕: 보호막 소진 전 즉사 방지).
function applyBossHpDamage(room, mon, damage) {
    damage = Math.max(0, Math.round(Number(damage) || 0));
    if (!mon || damage <= 0) return 0;
    if (Number(mon.shield || 0) > 0) {
        const absorbed = Math.min(Number(mon.shield), damage);
        mon.shield = Math.max(0, Number(mon.shield) - damage);
        return absorbed;
    }
    mon.hp = Math.max(Number(mon.hpFloor || 0), mon.hp - damage);
    const st = mon.bossState;
    if (st && typeof st.onDamageTaken === 'function') st.onDamageTaken(room, mon, damage);
    return damage;
}

function executeMember(room, member, source) {
    if (!member || !member.runtime || member.runtime.dead) return;
    member.runtime.hp = 0;
    member.runtime.dead = true;
    pushCombat(room, source + ' → ' + member.name + ' [즉사]', 'damage');
    pushNotice(room, member.name + ' 전투불능', 'danger', 3500);
    if (room.members.every(m => m.runtime.dead)) endQuest(room, false, '파티 전멸');
}

// 보스 공용 캐스팅. onFinish(room, mon, cast)는 캐스팅 완료 시 호출된다(기절로 중단되면 호출되지 않음).
function startBossCast(room, mon, id, name, duration, onFinish) {
    const st = mon && mon.bossState;
    if (!st || st.disabled || st.casting) return;
    st.casting = { id, name, remain: Number(duration || 0), onFinish: onFinish || null };
    mon.nextPattern = name + ' ' + Number(duration || 0).toFixed(1) + 's';
    pushCombat(room, mon.name + ' [' + name + '] 캐스팅 시작', 'danger');
}

// 보스 공용 캐스팅 진행. 항상 true(이번 tick 소비)를 반환한다.
function tickBossCast(room, mon, dt) {
    const st = mon.bossState;
    const cast = st.casting;
    cast.remain = Math.max(0, Number(cast.remain || 0) - dt);
    mon.nextPattern = cast.name + ' ' + cast.remain.toFixed(1) + 's';
    if (cast.remain <= 0) {
        st.casting = null;
        mon.nextPattern = null;
        if (typeof cast.onFinish === 'function') cast.onFinish(room, mon, cast);
    }
    return true;
}

function finishBlackHoduCast(room, mon, cast) {
    const st = mon && mon.bossState;
    if (!st || !cast) return;
    if (cast.id === 'half') {
        const pattern = getMonsterPattern(mon, 'hpThresholdCast');
        const pct = Number(pattern.damageTargetMaxHpPct || 0.5);
        let healed = 0;
        for (const m of getAliveMembers(room)) {
            healed += applyFixedDamageToMember(room, m, Math.ceil(Number(m.runtime.hpMax || 0) * pct), mon.name + ' [' + (pattern.name || '파멸의 정화') + ']');
            if (room.state !== 'inProgress' || room.monster !== mon || st.disabled) return;
        }
        if (healed > 0) mon.hp = Math.min(mon.hpMax, mon.hp + healed);
        pushCombat(room, mon.name + ' [' + (pattern.name || '파멸의 정화') + '] 피해 흡수 [+' + comma(healed) + ']', 'heal');
    }
    if (cast.id === 'execute') {
        const pattern = getMonsterPattern(mon, 'executePositionCast');
        const order = Array.isArray(pattern.targetPriority) && pattern.targetPriority.length ? pattern.targetPriority : ['메인딜러', '서브딜러', '브루저', '탱커', '서포터'];
        let target = null;
        for (const pos of order) {
            target = room.members.find(m => m.position === pos && m.runtime && !m.runtime.dead);
            if (target) break;
        }
        if (target) executeMember(room, target, mon.name + ' [' + (pattern.name || '종언') + ']');
    }
}

function stepBlackHoduBoss(room, mon, dt) {
    const st = mon && mon.bossState;
    if (!st || st.disabled) return false;
    // 암흑의 저주: 발동 창 중 보스를 공격했다면 이 시점에 전멸 처리(데미지 핸들러 밖에서 안전하게).
    if (st.curseWipeArmed) { wipePartyByCurse(room, mon); return true; }
    if (st.casting) return tickBossCast(room, mon, dt);
    const hpRatio = mon.hpMax > 0 ? mon.hp / mon.hpMax : 1;
    const halfPattern = getMonsterPattern(mon, 'hpThresholdCast');
    const executePattern = getMonsterPattern(mon, 'executePositionCast');
    const halfThreshold = Number(halfPattern.threshold || 0.5);
    const executeThreshold = Number(executePattern.threshold || 0.1);
    // 암흑의 저주: 발동 창 카운트다운
    if (st.curseRemain > 0) {
        st.curseRemain = Math.max(0, st.curseRemain - dt);
        if (st.curseRemain <= 0) pushCombat(room, mon.name + ' [암흑의 저주] 효과 종료', 'buff');
    }
    // 암흑의 저주: 최초로 40% 미만이 되면(데미지 인터셉트를 놓친 경우 대비) 복구하며 발동
    const cursePattern = getMonsterPattern(mon, 'curseRevive');
    if (cursePattern.type && !st.curseTriggered && hpRatio <= Number(cursePattern.threshold || 0.4)) {
        triggerBlackHoduCurse(room, mon);
        return true;
    }
    // 칠흑의 방패: 일정 주기마다 참가 역할군 중 하나를 골라 그 역할군만 피해를 줄 수 있게 한다.
    if (st.shieldInterval > 0) {
        if (st.shieldRemain > 0) {
            st.shieldRemain = Math.max(0, st.shieldRemain - dt);
            if (st.shieldRemain <= 0) {
                st.shieldRole = null;
                pushCombat(room, mon.name + ' [칠흑의 방패] 해제', 'buff');
            }
        } else {
            st.shieldTimer = Math.max(0, Number(st.shieldTimer || 0) - dt);
            if (st.shieldTimer <= 0) {
                st.shieldTimer += st.shieldInterval;
                const roles = [...new Set(room.members.map(m => m.position).filter(Boolean))];
                if (roles.length) {
                    st.shieldRole = roles[Math.floor(Math.random() * roles.length)];
                    st.shieldRemain = st.shieldDuration;
                    pushNotice(room, '칠흑의 방패 — ' + st.shieldDuration + '초간 ' + st.shieldRole + ' 공격만 유효', 'danger', 4500);
                    pushCombat(room, mon.name + ' [칠흑의 방패] ' + st.shieldRole + ' 공격만 유효 (' + st.shieldDuration + 's)', 'danger');
                    return true;
                }
            }
        }
    }
    // 파멸의 정화: intervalSec가 있으면 주기 발동, 없으면 기존 체력 임계 1회 발동
    if (Number(halfPattern.intervalSec || 0) > 0) {
        st.purgeTimer = Math.max(0, Number(st.purgeTimer || 0) - dt);
        if (st.purgeTimer <= 0) {
            st.purgeTimer += Number(halfPattern.intervalSec);
            startBossCast(room, mon, 'half', halfPattern.name || '파멸의 정화', Number(halfPattern.castTime || 2), finishBlackHoduCast);
            return true;
        }
    } else if (!st.phase50Started && hpRatio <= halfThreshold) {
        st.phase50Started = true;
        startBossCast(room, mon, 'half', halfPattern.name || '파멸의 정화', Number(halfPattern.castTime || 2), finishBlackHoduCast);
        return true;
    }
    if (!st.phase10Started && hpRatio <= executeThreshold) {
        st.phase10Started = true;
        startBossCast(room, mon, 'execute', executePattern.name || '종언', Number(executePattern.castTime || 3), finishBlackHoduCast);
        return true;
    }
    const regenPattern = getMonsterPattern(mon, 'regenBelowHp');
    const regenInterval = Number(regenPattern.interval || 5);
    const regenActive = !!regenPattern.type && hpRatio <= Number(regenPattern.threshold || 0.3);
    st.healActive = regenActive;
    if (!regenActive) st.healTimer = regenInterval;
    st.shockTimer = Math.max(0, Number(st.shockTimer || 0) - dt);
    if (st.shockTimer <= 0) {
        const pattern = getMonsterPattern(mon, 'fixedAoe');
        const amount = Number(pattern.fixedDamage || 1000);
        st.shockTimer += Number(pattern.interval || 20);
        const alive = getAliveMembers(room);
        const taunted = pickTauntOrNull(room, mon);
        if (taunted) {
            applyFixedDamageToMember(room, taunted, amount * alive.length, mon.name + ' [' + (pattern.name || '어둠 폭발') + ']');
            if (room.state !== 'inProgress' || room.monster !== mon || st.disabled) return true;
        } else {
            for (const m of alive) {
                applyFixedDamageToMember(room, m, amount, mon.name + ' [' + (pattern.name || '어둠 폭발') + ']');
                if (room.state !== 'inProgress' || room.monster !== mon || st.disabled) return true;
            }
        }
        if (room.state !== 'inProgress') return true;
        return true;
    }
    if (st.healActive) {
        st.healTimer = Math.max(0, Number(st.healTimer || 0) - dt);
        if (st.healTimer <= 0) {
            st.healTimer += regenInterval;
            const amount = Math.max(1, Math.round(mon.hpMax * Number(regenPattern.healMaxHpPct || 0.05)));
            mon.hp = Math.min(mon.hpMax, mon.hp + amount);
            pushCombat(room, mon.name + ' [' + (regenPattern.name || '재생') + '] +' + comma(amount), 'heal');
        }
    }
    st.buffTimer = Math.max(0, Number(st.buffTimer || 0) - dt);
    if (st.buffTimer <= 0) {
        const pattern = getMonsterPattern(mon, 'selfBuff');
        st.buffTimer += Number(pattern.interval || 30);
        st.buffRemain = Number(pattern.duration || 15);
        pushCombat(room, mon.name + ' [' + (pattern.name || '흑화 증폭') + '] 공격력 증가 / 받는 피해 감소', 'buff');
        return true;
    }
    return false;
}

// ===== 공용 보스 시스템 (광폭화 / 보호막 / 체력 기믹 / 투표 / 채팅 기믹) =====

// 보스 tick 진입점. true면 이번 tick의 일반 행동(게이지 누적)을 소비한다.
function stepBoss(room, mon, dt) {
    const st = mon && mon.bossState;
    if (!st || st.disabled) return false;
    if (st.chatGimmick) {
        tickChatGimmick(room, mon, dt);
        if (room.state !== 'inProgress' || room.monster !== mon) return true;
    }
    if (st.gimmickActive) {
        // 체력 기믹 진행 중 — 일반 공격/짤패턴 정지. 기믹 자체의 진행은 tick 콜백이 담당.
        if (typeof st.gimmickActive.tick === 'function') st.gimmickActive.tick(room, mon, dt);
        return true;
    }
    if (!st.casting && stepBossHpGimmick(room, mon)) return true;
    const handler = BOSS_HANDLERS[mon.bossKey || mon.name];
    return handler && handler.step ? handler.step(room, mon, dt) : false;
}

// 광폭화: enrageSec 경과 시 1회 — HP 10% 회복 / 공격력 ×5 / 행동주기 -1.0초
function stepEnrage(room, mon, dt) {
    if (mon.enraged || !(Number(mon.enrageSec || 0) > 0)) return;
    mon.enrageRemain = Math.max(0, Number(mon.enrageRemain || 0) - dt);
    if (mon.enrageRemain > 0) return;
    mon.enraged = true;
    mon.hp = Math.min(mon.hpMax, mon.hp + Math.round(mon.hpMax * 0.1));
    mon.atk = Number(mon.atk || 0) * 5;
    if (mon.stats) mon.stats.atk = Number(mon.stats.atk || 0) * 5;
    mon.actionInterval = Math.max(0.5, Number(mon.actionInterval || 2) - 1.0);
    pushNotice(room, mon.name + ' 광폭화 — 공격력 급증', 'danger', 6000);
    pushCombat(room, mon.name + ' [광폭화] 체력 10% 회복 / 공격력 ×5 / 행동주기 -1.0s', 'danger');
}

function bossAtk(mon) {
    return Number((mon && mon.stats && mon.stats.atk) || (mon && mon.atk) || 0);
}

// 그로기(=몬스터 기절) + 선택적 받는 피해 증가 디버프
function applyBossGroggy(room, mon, seconds, takenDamageUp) {
    const sec = Number(seconds || 0);
    mon.stunRemain = Math.max(Number(mon.stunRemain || 0), sec);
    const up = Number(takenDamageUp || 0);
    if (up > 0) addMonsterDebuff(mon, { id: 'groggyTakenUp', type: 'takenDamage', value: up, remain: sec });
    pushNotice(room, mon.name + ' 그로기 ' + sec + '초' + (up > 0 ? ' / 받는 피해 +' + Math.round(up * 100) + '%' : ''), 'success', 4500);
}

// 공대장 지원군 스킬 게이지
function addSupportGauge(room, amount, silent) {
    const n = Number(amount || 0);
    if (n <= 0 || !getQuestSupportSkills(room).length) return;
    room.supportGauge = Math.min(100, Number(room.supportGauge || 0) + n);
    if (!silent) pushCombat(room, '지원군 게이지 +' + n + '% (' + Math.round(room.supportGauge) + '%)', 'buff');
}

// ===== 공대장 전용 지원군 스킬 =====

const SUPPORT_SKILL_ICONS = {
    '지오': '부타게임/지오.png',
    'SitoSoym': '부타게임/사이토소음.jpg',
    'X': '부타게임/X.jpg'
};
const SUPPORT_GAUGE_SEC_PER_PERCENT = 4.5;   // 4.5초당 +1%
const SUPPORT_GEO_DAMAGE = 200000;
const SUPPORT_SITO_SHIELD = 25000;
const SUPPORT_SITO_SEC = 10;
const SUPPORT_SITO_TICK_HP_PCT = 0.03;     // 보호막 유지 중 초당 최대HP 3%
const SUPPORT_SITO_END_PCT = 0.2;          // 종료 시 전원 HP/MP 20%
const SUPPORT_X_DAMAGE = 20000;
const SUPPORT_X_HIDDEN_DAMAGE = 1250000;
const SUPPORT_X_HIDDEN_SEC = 10;

function getQuestSupportSkills(room) {
    const quest = getQuestById(room && room.questId);
    return Array.isArray(quest && quest.supportSkills) ? quest.supportSkills : [];
}

function serializeSupportSkills(room) {
    const skills = getQuestSupportSkills(room);
    if (!skills.length) return null;
    return skills.map(name => ({
        name,
        icon: SUPPORT_SKILL_ICONS[name] ? '/rpg-ui?file=' + encodeURIComponent(SUPPORT_SKILL_ICONS[name]) : null
    }));
}

// 봉인/기절 상태에서도 사용 가능한 것이 스펙 — 일부러 sealRemain/stunRemain을 검사하지 않는다.
function useSupportSkill(name, skillName) {
    const room = getRoomOf(name);
    if (!room) return { error: '참여 중인 파티가 없습니다.' };
    if (room.state !== 'inProgress') return { error: '진행 중이 아닙니다.' };
    if (isIntroActive(room)) return { error: '전투 시작 카운트다운 중입니다.' };
    if (room.hostName !== name) return { error: '공대장만 사용할 수 있습니다.' };
    const skills = getQuestSupportSkills(room);
    if (!skills.length) return { error: '이 퀘스트에는 지원군 스킬이 없습니다.' };
    if (!skills.includes(skillName)) return { error: '존재하지 않는 지원군 스킬입니다.' };
    const me = findMember(room, name);
    if (!me || !me.runtime || me.runtime.dead) return { error: '행동할 수 없습니다.' };
    if (Number(room.supportGauge || 0) < 100) return { error: '지원군 게이지가 부족합니다. (' + Math.floor(Number(room.supportGauge || 0)) + '%)' };
    room.supportGauge = 0;
    room.supportGaugeAccum = 0;
    pushNotice(room, name + ' — 지원군 [' + skillName + '] 호출', 'big', 4000);
    if (skillName === '지오') useSupportGeo(room, me);
    else if (skillName === 'SitoSoym') useSupportSito(room, me);
    else if (skillName === 'X') useSupportX(room, me);
    broadcastRoom(room);
    return { ok: true };
}

function useSupportGeo(room, source) {
    const mon = room.monster;
    if (!mon) return;
    const dealt = applyBossHpDamage(room, mon, SUPPORT_GEO_DAMAGE);
    recordPartyDamage(source, { damage: dealt, fixedDamage: 0, destinyDamage: 0, hitDetails: [], isCrit: false }, '지원군 · 지오');
    pushCombat(room, '지원군 [지오] → ' + mon.name + ' [-' + comma(dealt) + ']', 'skill');
}

function useSupportSito(room, source) {
    for (const m of getAliveMembers(room)) {
        // 보호막 무효 스탯(disableShield)을 가진 대상만 제외 — 시전자는 파티원이 아니므로 source는 없다.
        if (!canPartyApplyShield(null, m)) continue;
        const r = m.runtime;
        r.shield = Number(r.shield || 0) + SUPPORT_SITO_SHIELD;
        r.shieldHits = 99;
        r.shieldExpireAt = nowMs() + SUPPORT_SITO_SEC * 1000;
        r.shieldExpireHeal = 0;
        upsertMemberBuff(m, { id: 'supportSito', label: '사이토 소음', remain: SUPPORT_SITO_SEC });
    }
    room.supportSito = { remain: SUPPORT_SITO_SEC, tick: 1, sourceName: source && source.name };
    pushCombat(room, '지원군 [SitoSoym] 전원 보호막 ' + comma(SUPPORT_SITO_SHIELD) + ' (' + SUPPORT_SITO_SEC + '초)', 'buff');
}

function stepSupportSito(room, dt) {
    const sp = room.supportSito;
    const source = sp.sourceName ? findMember(room, sp.sourceName) : null;
    sp.remain = Math.max(0, sp.remain - dt);
    sp.tick -= dt;
    if (sp.tick <= 0) {
        sp.tick += 1;
        for (const m of getAliveMembers(room)) {
            if (Number(m.runtime.shield || 0) <= 0) continue;
            healMember(m, Math.round(Number(m.runtime.hpMax || 0) * SUPPORT_SITO_TICK_HP_PCT), source);
        }
    }
    if (sp.remain > 0) return;
    room.supportSito = null;
    for (const m of getAliveMembers(room)) {
        healMember(m, Math.round(Number(m.runtime.hpMax || 0) * SUPPORT_SITO_END_PCT), source);
        m.runtime.mp = Math.min(m.runtime.mpMax, m.runtime.mp + Math.round(Number(m.runtime.mpMax || 0) * SUPPORT_SITO_END_PCT));
    }
    pushCombat(room, '[SitoSoym] 종료 — 전원 HP/MP ' + Math.round(SUPPORT_SITO_END_PCT * 100) + '% 회복', 'heal');
}

function useSupportX(room, source) {
    for (const m of room.members) if (m.runtime) m.runtime.cooldownsUntil = {};
    pushCombat(room, '지원군 [X] 전 파티원 스킬 쿨타임 초기화', 'buff');
    const mon = room.monster;
    if (!mon) return;
    const dealt = applyBossHpDamage(room, mon, SUPPORT_X_DAMAGE);
    recordPartyDamage(source, { damage: dealt, fixedDamage: 0, destinyDamage: 0, hitDetails: [], isCrit: false }, '지원군 · X');
    pushCombat(room, '지원군 [X] → ' + mon.name + ' [-' + comma(dealt) + ']', 'skill');
    const st = mon.bossState;
    if (!st || !st.berserk || mon.bossKey !== '잉여왕') return;
    room.xHiddenTriggered = true;
    pushNotice(room, '(히든지원군스킬 발동)죽어라 부타!!!!!!!!!!!!', 'big', 6000);
    pushCombat(room, '(히든지원군스킬 발동)죽어라 부타!!!!!!!!!!!!', 'danger');
    grantTitleAsync(room, room.hostName, 'rainDefender');
    applyBossGroggy(room, mon, SUPPORT_X_HIDDEN_SEC, 0);
    room.supportXBarrage = { remain: SUPPORT_X_HIDDEN_SEC, duration: SUPPORT_X_HIDDEN_SEC, total: SUPPORT_X_HIDDEN_DAMAGE, dealt: 0, sourceName: source && source.name };
}

function stepSupportXBarrage(room, dt) {
    const b = room.supportXBarrage;
    b.remain = Math.max(0, b.remain - dt);
    const want = Math.round(b.total * (1 - b.remain / b.duration));
    const chunk = want - b.dealt;
    if (chunk > 0 && room.monster) {
        b.dealt = want;
        const dealt = applyBossHpDamage(room, room.monster, chunk);
        const source = b.sourceName ? findMember(room, b.sourceName) : null;
        recordPartyDamage(source, { damage: dealt, fixedDamage: 0, destinyDamage: 0, hitDetails: [], isCrit: false }, '지원군 · X 연속 타격');
        pushCombat(room, '[X] 연속 타격 → ' + room.monster.name + ' [-' + comma(dealt) + ']', 'skill');
    }
    if (b.remain <= 0 || !room.monster) room.supportXBarrage = null;
}

// 보호막 부여. applyPlayerDamageToBoss에서 HP보다 먼저 차감되며, 남아있는 동안 HP는 무손상.
function setBossShield(room, mon, amount, label) {
    if (!mon) return;
    mon.shield = Math.max(0, Math.round(Number(amount || 0)));
    mon.shieldMax = mon.shield;
    if (label) pushCombat(room, mon.name + ' [' + label + '] 보호막 ' + comma(mon.shield), 'buff');
}

function clearBossShield(mon) {
    if (!mon) return;
    mon.shield = 0;
    mon.shieldMax = 0;
}

// 체력 임계 기믹 등록. list: [{ ratio, run(room, mon) }] — HP가 ratio 이하로 내려가면 run 호출.
function registerHpGimmicks(mon, list) {
    const st = mon && mon.bossState;
    if (!st) return;
    st.hpGimmicks = (list || []).map(g => ({ ratio: Number(g.ratio || 0), run: g.run, fired: false }));
}

function stepBossHpGimmick(room, mon) {
    const st = mon.bossState;
    const list = st.hpGimmicks;
    if (!Array.isArray(list) || !list.length) return false;
    const ratio = mon.hpMax > 0 ? mon.hp / mon.hpMax : 1;
    const pending = list.find(g => !g.fired && ratio <= g.ratio);
    if (!pending) return false;
    pending.fired = true;
    st.gimmickActive = { ratio: pending.ratio };
    if (typeof pending.run === 'function') pending.run(room, mon);
    return true;
}

// 기믹 종료 — 일반 공격/짤패턴 타이머 재개
function endBossGimmick(mon) {
    if (mon && mon.bossState) mon.bossState.gimmickActive = null;
}

// 채팅 기믹: 제한 시간 내 발화한 생존자를 집계. onFinish(room, mon, gimmick)에서 gimmick.responded / gimmick.need 판정.
function chatGimmickMajority(aliveCount) {
    return Math.max(1, Math.ceil(Number(aliveCount || 0) / 2));
}

function startChatGimmick(room, mon, opts) {
    const st = mon && mon.bossState;
    if (!st) return null;
    const o = opts || {};
    st.chatGimmick = {
        label: o.label || '채팅',
        remain: Number(o.seconds || 10),
        responded: new Set(),
        need: chatGimmickMajority(getAliveMembers(room).length),
        onFinish: o.onFinish || null
    };
    return st.chatGimmick;
}

function tickChatGimmick(room, mon, dt) {
    const st = mon.bossState;
    const g = st.chatGimmick;
    g.remain = Math.max(0, Number(g.remain || 0) - dt);
    if (g.remain > 0) return;
    st.chatGimmick = null;
    if (typeof g.onFinish === 'function') g.onFinish(room, mon, g);
}

// 시간제한 투표. resolver(room, topName, counts, voteState) — 시간 종료 또는 생존자 전원 투표 시 호출.
function startVote(room, opts) {
    const o = opts || {};
    room.voteState = {
        prompt: o.prompt || '투표',
        deadline: Number(o.seconds || 15),
        votes: {},
        candidates: getAliveMembers(room).map(m => m.name),
        resolver: o.resolver || null
    };
    pushNotice(room, room.voteState.prompt + ' (' + Math.round(room.voteState.deadline) + '초)', 'danger', 5000);
    broadcastRoom(room);
    return room.voteState;
}

// 첫 투표 고정 — 중복 투표는 무시된다.
function castVote(name, target) {
    const room = getRoomOf(name);
    if (!room || !room.voteState) return { error: '진행 중인 투표가 없습니다.' };
    const me = findMember(room, name);
    if (!me || !me.runtime || me.runtime.dead) return { error: '투표할 수 없는 상태입니다.' };
    const vs = room.voteState;
    if (vs.votes[name]) return { error: '이미 투표했습니다.' };
    if (!vs.candidates.includes(String(target))) return { error: '투표할 수 없는 대상입니다.' };
    vs.votes[name] = String(target);
    broadcastRoom(room);
    if (getAliveMembers(room).every(m => vs.votes[m.name])) resolveVote(room);
    return { ok: true };
}

function resolveVote(room) {
    const vs = room.voteState;
    if (!vs) return;
    room.voteState = null;
    const counts = {};
    for (const target of Object.values(vs.votes)) counts[target] = (counts[target] || 0) + 1;
    let top = null, best = 0;
    for (const key of Object.keys(counts)) if (counts[key] > best) { best = counts[key]; top = key; }
    if (typeof vs.resolver === 'function') vs.resolver(room, top, counts, vs);
    broadcastRoom(room);
}

// 봉인: 스킬/기본공격/물약 사용 차단
function applySealToMember(room, member, seconds, label) {
    if (!member || !member.runtime || member.runtime.dead) return;
    member.runtime.sealRemain = Math.max(Number(member.runtime.sealRemain || 0), Number(seconds || 0));
    pushCombat(room, member.name + ' 봉인' + (label ? ' [' + label + ']' : '') + ' ' + Number(seconds || 0).toFixed(1) + 's', 'damage');
}

// 받는 피해 증가 스택 디버프 (runtime.buffs 재사용)
function addTakenDamageUpStack(member, perStack, remain, label) {
    const r = member && member.runtime;
    if (!r) return null;
    const name = label || '받는 피해 증가';
    const exist = (r.buffs || []).find(b => b.id === 'takenDamageUp');
    const rate = Number(perStack || 0);
    if (exist) {
        exist.stack = Math.round(Number(exist.stack || 1)) + 1;
        exist.perStack = rate;
        exist.value = 1 + exist.stack * rate;
        exist.remain = Math.max(Number(exist.remain || 0), Number(remain || 0));
        exist.label = name + ' x' + exist.stack;
        return exist;
    }
    upsertMemberBuff(member, { id: 'takenDamageUp', label: name + ' x1', stack: 1, perStack: rate, value: 1 + rate, remain: Number(remain || 0) });
    return (r.buffs || []).find(b => b.id === 'takenDamageUp');
}

function getTakenDamageUpMul(member) {
    const b = member && member.runtime && (member.runtime.buffs || []).find(x => x.id === 'takenDamageUp');
    return b ? Math.max(0, Number(b.value || 1)) : 1;
}

// 플레이어 측 속성 도트. ratio는 보스 공격력 대비 비율, remain 미지정 시 무한.
function applyElementalDotToMember(room, member, opts) {
    const r = member && member.runtime;
    if (!r || r.dead) return null;
    const o = opts || {};
    const mon = room.monster;
    const srcStats = (mon && mon.stats) || {};
    const baseAtk = Number(srcStats.atk || (mon && mon.atk) || 0);
    const interval = Math.max(0.2, Number(o.interval || 1));
    const dot = {
        id: o.id || o.label || 'dot',
        label: o.label || '속성 지속 피해',
        interval,
        tick: interval,
        power: Math.max(0, baseAtk * Number(o.ratio || 0)),
        element: o.element || null,
        srcStats,
        remain: o.remain == null ? Infinity : Number(o.remain),
        source: o.source || (mon && mon.name) || '지속 피해'
    };
    if (!Array.isArray(r.dots)) r.dots = [];
    const exist = r.dots.find(d => d.id === dot.id);
    if (exist) { Object.assign(exist, dot); return exist; }
    r.dots.push(dot);
    return dot;
}

function clearMemberDot(member, id) {
    const r = member && member.runtime;
    if (!r || !Array.isArray(r.dots)) return;
    r.dots = id ? r.dots.filter(d => d.id !== id) : [];
}

function stepMemberDots(room, member, dt) {
    const r = member.runtime;
    if (!Array.isArray(r.dots) || !r.dots.length) return;
    for (let i = r.dots.length - 1; i >= 0; i--) {
        const d = r.dots[i];
        d.remain -= dt;
        d.tick -= dt;
        if (d.tick <= 0) {
            d.tick += d.interval;
            const beforeResistance = Number(d.power || 0);
            let dmg = beforeResistance;
            if (d.element && typeof rpgenius.getElementDamageMultiplier === 'function') {
                dmg *= rpgenius.getElementDamageMultiplier(d.element, d.srcStats, getPartyDynamicDefenseStats(member));
            }
            applyFixedDamageToMember(room, member, {
                damage: Math.max(1, Math.round(dmg)),
                mitigation: { resistance: Math.max(0, beforeResistance - dmg) }
            }, d.source + ' [' + d.label + ']');
            if (room.state !== 'inProgress' || r.dead) return;
        }
        if (d.remain <= 0) r.dots.splice(i, 1);
    }
}

function applyBlackHoduCritReflect(room, attacker, result) {
    const mon = room && room.monster;
    const st = mon && mon.bossState;
    if (!st || st.disabled || Number(mon.hp || 0) <= 0 || Number(mon.stunRemain || 0) > 0 || !result || !result.isCrit) return;
    const pattern = getMonsterPattern(mon, 'critReflect');
    const details = Array.isArray(result.hitDetails) ? result.hitDetails : [];
    const critDamage = details.length ? details.filter(h => h && h.crit).reduce((sum, h) => sum + Number(h.damage || 0), 0) : Number(result.damage || 0);
    const reflect = Math.max(1, Math.round(critDamage * Number(pattern.reflectPct || 0.15)));
    const target = pickTauntOrNull(room, mon) || attacker;
    if (!target || !target.runtime || target.runtime.dead) return;
    applyDamageToMember(room, target, calculateNormalDamageToMember(room, mon, target, reflect), mon.name + ' [치명 반사]');
}

// ===== 부타게임: 타부자고 =====

function createTabuzagoBossState(monDef) {
    const find = type => ((monDef && monDef.patterns) || []).find(p => p && p.type === type) || {};
    return {
        puzzleTimer: Number(find('puzzleThrow').interval || 17),
        dealingTimer: Number(find('dealingCharge').interval || 20),
        dealingCount: 0,
        reflectTimer: Number(find('reflectWindow').interval || 50),
        reflectWindow: 0,
        reflectAccum: 0,
        mochiTimer: Number(find('mochiShield').interval || 0),
        mochiWindow: 0
    };
}

function onSpawnTabuzago(room, mon) {
    const lines = Math.max(1, Number(mon.hpLines || 1));
    const chat = getMonsterPattern(mon, 'chatCallGimmick');
    const vote = getMonsterPattern(mon, 'voteGimmick');
    registerHpGimmicks(mon, [
        { ratio: Number(chat.lineThreshold || 90) / lines, run: startTabuzagoChatGimmick },
        { ratio: Number(vote.lineThreshold || 40) / lines, run: startTabuzagoVoteGimmick }
    ]);
}

// 체력 x90 — '김쁠뿡' 채팅 기믹
function startTabuzagoChatGimmick(room, mon) {
    const p = getMonsterPattern(mon, 'chatCallGimmick');
    const sec = Number(p.seconds || 7);
    pushNotice(room, '“야, 김쁠뿡!!!!!!” 타부자고가 파티원을 부릅니다. ' + sec + '초 안에 대답해줘야만 할 것 같습니다.', 'danger', 6000);
    startChatGimmick(room, mon, {
        label: p.name || '김쁠뿡',
        seconds: sec,
        onFinish: (rm, mo, g) => {
            endBossGimmick(mo);
            if (g.responded.size >= g.need) {
                pushCombat(rm, mo.name + " '으악!'", 'buff');
                applyBossGroggy(rm, mo, Number(p.groggy || 8), Number(p.takenDamageUp || 0.2));
                addSupportGauge(rm, Number(p.gauge || 0));
            } else {
                wipeParty(rm, '김쁠뿡', mo.name + ' [' + (p.name || '김쁠뿡') + '] 아무도 대답하지 않았다 — 파티 전멸');
            }
        }
    });
}

// 체력 x40 — 부타 투표
function startTabuzagoVoteGimmick(room, mon) {
    const p = getMonsterPattern(mon, 'voteGimmick');
    pushNotice(room, '지금부터 부타를 투표하겠습니다. 각자 싫어하는 플레이어를 투표해주세요. 동률이 나온 플레이어는 모두 죽습니다.', 'danger', 6000);
    startVote(room, {
        prompt: '부타 투표 — 싫어하는 플레이어를 투표하세요',
        seconds: Number(p.seconds || 7),
        resolver: (rm, top, counts, vs) => {
            endBossGimmick(mon);
            resolveTabuzagoVote(rm, mon, counts, vs, p);
        }
    });
}

function resolveTabuzagoVote(room, mon, counts, vs, p) {
    const voters = vs.candidates || [];
    if (voters.some(name => !vs.votes[name])) {
        pushCombat(room, mon.name + " '누군가 투표를 안했네?'", 'danger');
        wipeParty(room, '부타 투표', mon.name + ' [부타 투표] 미투표자 발생 — 파티 전멸');
        return;
    }
    const tally = Object.values(counts);
    const max = tally.length ? Math.max.apply(null, tally) : 0;
    const n = voters.length;
    let survived = false;
    let doomed = [];
    if (n <= 1) survived = vs.votes[voters[0]] === voters[0];
    else if (n === 2) survived = max === 2;
    else if (n === 3) survived = max >= 2;
    else {
        const twos = Object.keys(counts).filter(k => counts[k] === 2);
        if (twos.length === 2) { survived = true; doomed = twos; }
        else survived = max > 1;
    }
    if (!survived) {
        wipeParty(room, '부타 투표', mon.name + ' [부타 투표] 파훼 실패 — 파티 전멸');
        return;
    }
    for (const name of doomed) {
        const target = findMember(room, name);
        if (target) executeMember(room, target, mon.name + ' [부타 투표] 동률');
        if (room.state !== 'inProgress') return;
    }
    pushCombat(room, mon.name + ' [부타 투표] 파훼!', 'buff');
    addSupportGauge(room, Number(p.gauge || 0));
}

function stepTabuzago(room, mon, dt) {
    const st = mon.bossState;
    if (st.casting) return tickBossCast(room, mon, dt);
    if (tickTabuzagoMochi(room, mon, dt)) return true;
    if (tickTabuzagoReflect(room, mon, dt)) return true;

    // 퍼즐 던지기
    st.puzzleTimer = Math.max(0, Number(st.puzzleTimer || 0) - dt);
    if (st.puzzleTimer <= 0) {
        const p = getMonsterPattern(mon, 'puzzleThrow');
        st.puzzleTimer += Number(p.interval || 17);
        pushCombat(room, mon.name + '가 퍼즐을 요리조리 던져댑니다.', 'danger');
        const hits = Number(p.hits || 15);
        const raw = bossAtk(mon) * Number(p.atkRatio || 0.5);
        for (let i = 0; i < hits; i++) {
            const alive = getAliveMembers(room);
            if (!alive.length) break;
            const target = alive[Math.floor(Math.random() * alive.length)];
            applyDamageToMember(room, target, calculateNormalDamageToMember(room, mon, target, raw), mon.name + ' [' + (p.name || '퍼즐 던지기') + ']');
            if (room.state !== 'inProgress' || room.monster !== mon) return true;
        }
        return true;
    }
    // 무난한 딜링 → 3회 누적 시 확실한 딜링
    st.dealingTimer = Math.max(0, Number(st.dealingTimer || 0) - dt);
    if (st.dealingTimer <= 0) {
        const p = getMonsterPattern(mon, 'dealingCharge');
        const need = Number(p.count || 3);
        st.dealingTimer += Number(p.interval || 20);
        st.dealingCount += 1;
        if (st.dealingCount >= need) {
            st.dealingCount = 0;
            pushNotice(room, mon.name + ' — 확실한 딜링 예고', 'danger', 4500);
            const pct = Number(p.targetMaxHpPct || 0.3);
            for (const m of getAliveMembers(room)) {
                applyFixedDamageToMember(room, m, Math.ceil(Number(m.runtime.hpMax || 0) * pct), mon.name + ' [' + (p.finishName || '확실한 딜링') + ']');
                if (room.state !== 'inProgress' || room.monster !== mon) return true;
            }
        } else {
            pushCombat(room, mon.name + '가 딜링을 준비 중입니다... (' + st.dealingCount + '/' + need + ')', 'danger');
        }
        return true;
    }
    // 반사 준비
    st.reflectTimer = Math.max(0, Number(st.reflectTimer || 0) - dt);
    if (st.reflectTimer <= 0) {
        const p = getMonsterPattern(mon, 'reflectWindow');
        st.reflectTimer += Number(p.interval || 50);
        st.reflectWindow = Number(p.windowSec || 5);
        st.reflectAccum = 0;
        st.onDamageTaken = (rm, mo, dmg) => { mo.bossState.reflectAccum += dmg; };
        pushNotice(room, mon.name + '가 움츠러 듭니다...', 'danger', 4500);
        return true;
    }
    // 모찌나간다 (하드 전용 — interval 0이면 비활성)
    const mochi = getMonsterPattern(mon, 'mochiShield');
    if (Number(mochi.interval || 0) > 0) {
        st.mochiTimer = Math.max(0, Number(st.mochiTimer || 0) - dt);
        if (st.mochiTimer <= 0) {
            st.mochiTimer += Number(mochi.interval);
            st.mochiWindow = Number(mochi.windowSec || 8);
            pushNotice(room, '모찌나가요...!!!', 'danger', 4500);
            setBossShield(room, mon, Number(mochi.shield || 150000), mochi.name || '모찌나간다');
            return true;
        }
    }
    return false;
}

function tickTabuzagoReflect(room, mon, dt) {
    const st = mon.bossState;
    if (!(Number(st.reflectWindow || 0) > 0)) return false;
    st.reflectWindow = Math.max(0, st.reflectWindow - dt);
    if (st.reflectWindow > 0) return false;
    const p = getMonsterPattern(mon, 'reflectWindow');
    st.onDamageTaken = null;
    if (st.reflectAccum > Number(p.threshold || 60000)) {
        const dmg = Number(p.fixedDamage || 18000);
        pushCombat(room, mon.name + ' [' + (p.name || '반사') + '] 반격 (누적 ' + comma(Math.round(st.reflectAccum)) + ')', 'danger');
        for (const m of getAliveMembers(room)) {
            applyFixedDamageToMember(room, m, dmg, mon.name + ' [' + (p.name || '반사') + ']');
            if (room.state !== 'inProgress' || room.monster !== mon) return true;
        }
    } else {
        pushCombat(room, mon.name + ' [' + (p.name || '반사') + '] 아무 일도 일어나지 않았다 (누적 ' + comma(Math.round(st.reflectAccum)) + ')', 'buff');
    }
    st.reflectAccum = 0;
    return true;
}

function tickTabuzagoMochi(room, mon, dt) {
    const st = mon.bossState;
    if (!(Number(st.mochiWindow || 0) > 0)) return false;
    const p = getMonsterPattern(mon, 'mochiShield');
    if (Number(mon.shield || 0) <= 0) {
        st.mochiWindow = 0;
        clearBossShield(mon);
        pushCombat(room, mon.name + ' [' + (p.name || '모찌나간다') + '] 보호막 파괴', 'buff');
        applyBossGroggy(room, mon, Number(p.groggy || 6), Number(p.takenDamageUp || 0.3));
        return true;
    }
    st.mochiWindow = Math.max(0, st.mochiWindow - dt);
    if (st.mochiWindow > 0) return false;
    clearBossShield(mon);
    const stun = Number(p.stun || 5);
    for (const m of getAliveMembers(room)) m.runtime.stunRemain = Math.max(Number(m.runtime.stunRemain || 0), stun);
    pushNotice(room, '저지 실패 — 전원 ' + stun + '초 기절', 'danger', 4500);
    return true;
}

// ===== 부타게임: 잉여왕 =====

function createIngyeoWangBossState(monDef) {
    const find = type => ((monDef && monDef.patterns) || []).find(p => p && p.type === type) || {};
    return {
        bounceTimer: Number(find('bounceDebuff').interval || 10),
        flameTimer: Number(find('flameBurst').interval || 30),
        chargeTimer: Number(find('chargeBlock').interval || 30),
        cannonTimer: Number(find('heavenCannon').interval || 21),
        markName: null,
        markCycle: null,
        blockUsers: null,
        berserk: false,
        dieTimer: 0
    };
}

function onSpawnIngyeoWang(room, mon) {
    const lines = Math.max(1, Number(mon.hpLines || 1));
    const rain = getMonsterPattern(mon, 'rainShield');
    registerHpGimmicks(mon, (rain.lineThresholds || []).map(line => ({
        ratio: Number(line) / lines,
        run: startIngyeoRain
    })));
    // 하드: HP 0이 아니라 1에서 멈추고 폭주 형태로 전환
    if (mon.berserkForm) mon.hpFloor = 1;
    moveIngyeoMark(room, mon);
}

// 표식 순환: 입장 순서대로, 사망자는 건너뛰고, 한 바퀴 돌기 전에는 재지목하지 않는다.
function moveIngyeoMark(room, mon) {
    const st = mon.bossState;
    const order = room.members.map(m => m.name);
    const aliveAt = idx => {
        const m = findMember(room, st.markCycle[idx]);
        return m && m.runtime && !m.runtime.dead;
    };
    if (!Array.isArray(st.markCycle) || !st.markCycle.length) st.markCycle = order.slice();
    let idx = st.markCycle.findIndex((_, i) => aliveAt(i));
    if (idx < 0) { st.markCycle = order.slice(); idx = st.markCycle.findIndex((_, i) => aliveAt(i)); }
    if (idx < 0) return;
    const name = st.markCycle.splice(idx, 1)[0];
    const prev = st.markName && findMember(room, st.markName);
    if (prev) clearMemberDot(prev, 'ingyeoMark');
    st.markName = name;
    const target = findMember(room, name);
    if (!target) return;
    const p = getMonsterPattern(mon, 'markDot');
    applyElementalDotToMember(room, target, {
        id: 'ingyeoMark',
        interval: Number(p.interval || 3),
        ratio: Number(p.atkRatio || 0.1),
        element: p.element || '화',
        label: p.name || '잉여왕 표식',
        source: mon.name
    });
    pushNotice(room, '잉여왕이 ' + name + '를 주시합니다...', 'danger', 4500);
}

// 체력 고정 패턴 — '레인! 도와줘!'
function startIngyeoRain(room, mon) {
    const st = mon.bossState;
    const p = getMonsterPattern(mon, 'rainShield');
    pushNotice(room, '레인! 도와줘!', 'danger', 5000);
    for (const m of getAliveMembers(room)) {
        if (m.name !== st.markName) applySealToMember(room, m, Number(p.sealSec || 10), p.name || '레인! 도와줘!');
    }
    setBossShield(room, mon, Number(p.shield || 80000), p.name || '레인! 도와줘!');
    st.gimmickActive.remain = Number(p.windowSec || 10);
    st.gimmickActive.tick = tickIngyeoRain;
}

function tickIngyeoRain(room, mon, dt) {
    const g = mon.bossState.gimmickActive;
    if (Number(mon.shield || 0) <= 0) { finishIngyeoRain(room, mon, true); return; }
    g.remain = Math.max(0, Number(g.remain || 0) - dt);
    if (g.remain <= 0) finishIngyeoRain(room, mon, false);
}

function finishIngyeoRain(room, mon, success) {
    const p = getMonsterPattern(mon, 'rainShield');
    clearBossShield(mon);
    endBossGimmick(mon);
    for (const m of room.members) if (m.runtime) m.runtime.sealRemain = 0;
    if (success) {
        pushCombat(room, mon.name + ' [' + (p.name || '레인! 도와줘!') + '] 보호막 파괴', 'buff');
        applyBossGroggy(room, mon, Number(p.groggy || 8), Number(p.takenDamageUp || 0.2));
        addSupportGauge(room, Number(p.gauge || 0));
    } else if (p.failWipe) {
        wipeParty(room, '레인! 도와줘!', mon.name + ' [' + (p.name || '레인! 도와줘!') + '] 보호막 제거 실패 — 파티 전멸');
        return;
    } else {
        const dmg = Number(p.failFixedDamage || 40000);
        for (const m of getAliveMembers(room)) {
            applyFixedDamageToMember(room, m, dmg, mon.name + ' [' + (p.name || '레인! 도와줘!') + ']');
            if (room.state !== 'inProgress' || room.monster !== mon) return;
        }
    }
    moveIngyeoMark(room, mon);
}

// '저지' 임시 스킬 부여/회수 ('자폭' 선례와 동일한 동적 스킬 방식)
function grantBlockSkill(room) {
    for (const m of getAliveMembers(room)) {
        if (m.skills.includes('저지')) continue;
        m.skills.push('저지');
        m.skillDefs['저지'] = { type: 'active', source: 'boss', mp: 0, cd: 0, target: 'self', desc: '잉여왕의 기 모으기를 저지합니다. 과반수가 사용해야 성공합니다.' };
    }
    broadcastRoom(room);
}

function revokeBlockSkill(room) {
    for (const m of room.members) {
        m.skills = m.skills.filter(s => s !== '저지');
        if (m.skillDefs) delete m.skillDefs['저지'];
    }
    broadcastRoom(room);
}

function usePartyBlockSkill(room, member) {
    const st = room.monster && room.monster.bossState;
    if (!st || !st.blockUsers) return { error: '지금은 사용할 수 없습니다.' };
    if (!member.skills.includes('저지')) return { error: '습득하지 않은 스킬입니다.' };
    if (st.blockUsers.has(member.name)) return { error: '이미 저지했습니다.' };
    clearPartyGunryeokOnSkillUse(room, member);
    st.blockUsers.add(member.name);
    pushCombat(room, member.name + ' [저지]', 'buff');
    broadcastRoom(room);
    return { ok: true };
}

function finishIngyeoCharge(room, mon) {
    const st = mon.bossState;
    const p = getMonsterPattern(mon, 'chargeBlock');
    const used = st.blockUsers ? st.blockUsers.size : 0;
    st.blockUsers = null;
    revokeBlockSkill(room);
    if (used >= chatGimmickMajority(getAliveMembers(room).length)) {
        pushCombat(room, mon.name + " '앗..!!'", 'buff');
        applyBossGroggy(room, mon, Number(p.groggy || 5), 0);
        // '튀어오르기' 디버프 전체 삭제 + 보유자 체력 회복
        for (const m of room.members) {
            const r = m.runtime;
            if (!r || !Array.isArray(r.buffs)) continue;
            if (!r.buffs.some(b => b.id === 'takenDamageUp')) continue;
            r.buffs = r.buffs.filter(b => b.id !== 'takenDamageUp');
            const healed = healMember(m, Math.round(Number(r.hpMax || 0) * Number(p.healPct || 0.2)));
            if (healed > 0) pushCombat(room, m.name + ' 튀어오르기 해제 → HP +' + comma(healed), 'heal');
        }
        return;
    }
    const raw = bossAtk(mon) * Number(p.failAtkRatio || 5);
    for (const m of getAliveMembers(room)) {
        applyDamageToMember(room, m, calculateNormalDamageToMember(room, mon, m, raw), mon.name + ' [' + (p.name || '기모아 공격') + ']');
        if (room.state !== 'inProgress' || room.monster !== mon) return;
    }
}

function finishIngyeoFlame(room, mon) {
    const p = getMonsterPattern(mon, 'flameBurst');
    const raw = bossAtk(mon) * Number(p.atkRatio || 1.5);
    for (const m of getAliveMembers(room)) {
        applyDamageToMember(room, m, calculateNormalDamageToMember(room, mon, m, raw), mon.name + ' [' + (p.name || '화염 폭발') + ']');
        if (room.state !== 'inProgress' || room.monster !== mon) return;
    }
}

function finishIngyeoCannon(room, mon) {
    const p = getMonsterPattern(mon, 'heavenCannon');
    const raw = bossAtk(mon) * Number(p.atkRatio || 1.5);
    const picked = shuffle(getAliveMembers(room)).slice(0, Math.max(1, Number(p.targets || 2)));
    for (const m of picked) {
        applyDamageToMember(room, m, calculateNormalDamageToMember(room, mon, m, raw), mon.name + ' [' + (p.name || '천국의 대포') + ']');
        if (room.state !== 'inProgress' || room.monster !== mon) return;
    }
}

// 폭주 잉여왕 전환 (하드 전용)
function enterIngyeoBerserk(room, mon) {
    const st = mon.bossState;
    const form = mon.berserkForm || {};
    st.berserk = true;
    st.dieTimer = 0;
    pushNotice(room, '이렇게 죽을 순 없어...!!!!', 'danger', 6000);
    if (form.name) mon.name = form.name;
    if (form.image) mon.image = form.image;
    mon.patterns = form.patterns || [];
    st.hpGimmicks = null;
    st.gimmickActive = null;
    const stats = mergeMonsterStats(form);
    mon.stats = stats;
    mon.atk = Number(stats.atk || 0);
    mon.def = Number(stats.def || 0);
    mon.pnt = Number(stats.pnt || 0);
    mon.hp = 1;
    mon.hpMax = 1;
    mon.hpFloor = 1;
    mon.hpLines = 0;
    mon.actionInterval = Number(form.actionInterval || 2);
    mon.enrageSec = Number(form.enrageSec || 60);
    mon.enrageRemain = mon.enrageSec;
    mon.enraged = false;
    setBossShield(room, mon, Number(form.shield || 2000000), '폭주');
    addMonsterDebuff(mon, { id: 'berserkTaken', type: 'takenDamage', value: Number(form.takenDamageUp || 1), remain: 999999 });
    addSupportGauge(room, 80); // 잉여왕 부활 시 공대장 지원군 게이지 +80%
    // 폭주지대: 전 생존자 상시 화상
    const burn = ((form.patterns || []).find(p => p && p.type === 'burnZone')) || {};
    for (const m of getAliveMembers(room)) {
        applyElementalDotToMember(room, m, {
            id: 'berserkBurn',
            interval: Number(burn.interval || 3),
            ratio: Number(burn.atkRatio || 0.1),
            element: burn.element || '화',
            label: burn.name || '폭주지대',
            source: mon.name
        });
    }
}

function stepIngyeoWang(room, mon, dt) {
    const st = mon.bossState;
    if (mon.berserkForm && !st.berserk && mon.hp <= 1) { enterIngyeoBerserk(room, mon); return true; }
    if (st.berserk) return stepIngyeoBerserk(room, mon, dt);
    if (st.casting) return tickBossCast(room, mon, dt);

    // 튀어오르기
    st.bounceTimer = Math.max(0, Number(st.bounceTimer || 0) - dt);
    if (st.bounceTimer <= 0) {
        const p = getMonsterPattern(mon, 'bounceDebuff');
        st.bounceTimer += Number(p.interval || 10);
        const alive = getAliveMembers(room);
        if (alive.length) {
            const target = alive[Math.floor(Math.random() * alive.length)];
            // remain 무한 대신 충분히 큰 값 — 관문 내내 유지된다
            const buff = addTakenDamageUpStack(target, Number(p.takenDamageUp || 0.5), 999999, p.name || '튀어오르기');
            pushCombat(room, mon.name + '가 ' + target.name + '를 튀어오르게 합니다 (x' + (buff ? buff.stack : 1) + ')', 'danger');
        }
        return true;
    }
    // 화염 폭발
    st.flameTimer = Math.max(0, Number(st.flameTimer || 0) - dt);
    if (st.flameTimer <= 0) {
        const p = getMonsterPattern(mon, 'flameBurst');
        st.flameTimer += Number(p.interval || 30);
        pushCombat(room, mon.name + '이 화를 냅니다. 대비하세요.', 'danger');
        startBossCast(room, mon, 'flame', p.name || '화염 폭발', Number(p.castTime || 3), finishIngyeoFlame);
        return true;
    }
    // 기모아 공격
    st.chargeTimer = Math.max(0, Number(st.chargeTimer || 0) - dt);
    if (st.chargeTimer <= 0) {
        const p = getMonsterPattern(mon, 'chargeBlock');
        st.chargeTimer += Number(p.interval || 30);
        pushNotice(room, '잉여왕이 기를 모은다 — [저지] 사용', 'danger', 5000);
        st.blockUsers = new Set();
        grantBlockSkill(room);
        startBossCast(room, mon, 'charge', p.name || '기모아 공격', Number(p.castTime || 4), finishIngyeoCharge);
        return true;
    }
    // 천국의 대포
    st.cannonTimer = Math.max(0, Number(st.cannonTimer || 0) - dt);
    if (st.cannonTimer <= 0) {
        const p = getMonsterPattern(mon, 'heavenCannon');
        st.cannonTimer += Number(p.interval || 21);
        pushCombat(room, '미니게임천국에서 대포가 날라옵니다.', 'danger');
        startBossCast(room, mon, 'cannon', p.name || '천국의 대포', Number(p.castTime || 2), finishIngyeoCannon);
        return true;
    }
    return false;
}

function stepIngyeoBerserk(room, mon, dt) {
    // 보호막 소진 판정은 stepRoom에서 (그로기 중에도 성립해야 하므로)
    const st = mon.bossState;
    st.dieTimer = Math.max(0, Number(st.dieTimer || 0) - dt);
    if (st.dieTimer <= 0) {
        const p = getMonsterPattern(mon, 'dieAoe');
        st.dieTimer += Number(p.interval || 5);
        pushCombat(room, mon.name + " '죽어버려'", 'danger');
        const raw = bossAtk(mon) * Number(p.atkRatio || 0.75);
        for (const m of getAliveMembers(room)) {
            applyDamageToMember(room, m, calculateNormalDamageToMember(room, mon, m, raw), mon.name + ' [' + (p.name || '죽어') + ']');
            if (room.state !== 'inProgress' || room.monster !== mon) return true;
        }
        return true;
    }
    return false;
}

function computeMonsterDamage(room, mon, target) {
    const quest = getQuestById(room.questId);
    const posDef = (quest.positions && quest.positions[target.position]) || {};
    const finalDefMul = (posDef && posDef.stats && posDef.stats.finalDef) || 1;
    const targetStats = target.baseSnapshot.stats || {};
    const targetSlotEffects = target.baseSnapshot.slotEffects || {};
    const monStats = mon.stats || {};
    if (Number(targetStats.avd || 0) > 0 && Math.random() < Math.max(0, Number(targetStats.avd || 0))) return 0;
    const hitCount = getComboHitCount(monStats);
    const monDealtMul = getMonsterDealtDmgMul(mon);
    const mitigation = 1 - Math.min(1, Number(targetSlotEffects.hpDamageReduction || 0));
    const targetHpRatio = Number(target.runtime.hp || 0) / Math.max(1, Number(target.runtime.hpMax || 1));
    let equipmentReduction = 0;
    if (targetHpRatio <= .50) equipmentReduction += Number(targetStats.bloodFlowReduction || 0) * (targetHpRatio <= .30 ? 2 : 1);
    const attackerHpRatio = Number(mon && mon.hp || 0) / Math.max(1, Number(mon && mon.hpMax || 1));
    if (attackerHpRatio <= .50) equipmentReduction += getTranscendStageValue(target, '최후통첩 아머', .10, .04);
    if (target.runtime.gunryeok) equipmentReduction += Number(target.runtime.gunryeok.dmgReduce || 0);
    for (const key of Object.keys(target.runtime.kingmakerBuffs || {})) {
        const buff = target.runtime.kingmakerBuffs[key];
        if (buff && Date.now() < Number(buff.expiredAt || 0)) equipmentReduction += Number(buff.takenDamageReduction || 0);
    }
    const targetTakenMul = Math.max(0, 1 + Number(targetStats.takenDamage || 0)) * (target.runtime.takenDmgMul || 1) * Math.max(0, 1 - equipmentReduction);
    const rawDamage = Math.max(0, Number(monStats.atk || mon.atk || 0) * (1 + Number(monStats.afterBasic || 0)));
    const defense = Number(targetStats.def || 50) * finalDefMul;
    const defenseReductionRate = Math.max(0, Math.min(1, Number(monStats.pntPercent || 0)));
    const penetration = Number(monStats.pnt || mon.pnt || 0);
    let total = 0;
    let reducedByBuff = 0;
    let reducedByDefense = 0;
    for (let i = 0; i < hitCount; i++) {
        let beforeReduction = rawDamage * (1 + Number(monStats.finalDamage || 0)) * monDealtMul;
        let hitDamage = beforeReduction * mitigation * targetTakenMul;
        const isCrit = Math.random() < Math.max(0, Number(monStats.crit || 0));
        if (isCrit) {
            const critMul = 1 + Math.max(0, Number(monStats.critMul || 1.4) - 1) * (1 - Math.min(1, Math.max(0, Number(targetStats.critDef || 0)))); // 솔로와 동일한 치명타 피해 감소율 공식
            beforeReduction = Math.round(beforeReduction * critMul);
            hitDamage = Math.round(hitDamage * critMul);
        }
        const afterReduction = hitDamage;
        if (Number(monStats.trueDamageChance || 0) > 0 && Math.random() < Number(monStats.trueDamageChance || 0)) {
            hitDamage = getDestinyDamageAfterDefense(hitDamage, defense, penetration, defenseReductionRate);
        } else {
            hitDamage = getDamageAfterDefense(hitDamage, defense, penetration, defenseReductionRate);
        }
        const afterDefense = hitDamage;
        if (Number(monStats['000'] || 0) > 0 && Math.random() < Number(monStats['000'])) hitDamage += [10, 100, 1000][randomInt(0, 2)];
        if (Number(monStats.skillTrueDmg || 0) > 0) hitDamage += Number(monStats.skillTrueDmg || 0);
        const variedDamage = applyDamageVariance(hitDamage);
        const varianceScale = hitDamage > 0 ? variedDamage / hitDamage : 1;
        reducedByBuff += Math.max(0, beforeReduction - afterReduction) * varianceScale;
        reducedByDefense += Math.max(0, afterReduction - afterDefense) * varianceScale;
        total += variedDamage;
    }
    // 몬스터가 element 속성을 가지면 플레이어 속성 저항 적용 (맨 마지막)
    const monElement = mon.element || monStats.element;
    const beforeResistance = total;
    if (monElement && typeof rpgenius.getElementDamageMultiplier === 'function') {
        total *= rpgenius.getElementDamageMultiplier(monElement, monStats, getPartyDynamicDefenseStats(target));
    }
    const finalDamage = Math.max(0, Math.round(total));
    const elementScale = beforeResistance > 0 ? finalDamage / beforeResistance : 1;
    return {
        damage: finalDamage,
        mitigation: {
            buff: reducedByBuff * elementScale,
            defense: reducedByDefense * elementScale,
            resistance: Math.max(0, beforeResistance - total)
        }
    };
}

function applyDamageToMember(room, member, dmg, source) {
    const r = member.runtime;
    const incoming = dmg && typeof dmg === 'object' ? dmg : { damage: dmg };
    const mitigation = incoming.mitigation || {};
    recordPartyDamageReduced(member, 'buff', mitigation.buff);
    recordPartyDamageReduced(member, 'defense', mitigation.defense);
    recordPartyDamageReduced(member, 'resistance', mitigation.resistance);
    dmg = Math.max(0, Math.round(Number(incoming.damage || 0) * getTakenDamageUpMul(member)));
    if (r.dodgeNext) {
        r.dodgeNext = false;
        recordPartyDamageReduced(member, 'other', dmg);
        pushCombat(room, source + ' → ' + member.name + ' [회피]', 'damage');
        return;
    }
    if (dmg > 0) {
        const protector = room.members.find(m => m !== member && m.runtime && !m.runtime.dead && Number(m.runtime.absorbAlly || 0) > 0);
        if (protector) {
            const beforeRedirect = dmg;
            const absorbed = Math.max(1, Math.round(dmg * Number(protector.runtime.absorbAlly || 0)));
            dmg = Math.max(0, dmg - absorbed);
            const protectorHpBefore = protector.runtime.hp;
            protector.runtime.hp = Math.max(0, protector.runtime.hp - absorbed);
            recordPartyDamageReduced(member, 'other', beforeRedirect - dmg);
            const protectorStats = getPartyBattleStats(protector);
            if (protectorStats) protectorStats.damageTaken += Math.max(0, protectorHpBefore - protector.runtime.hp);
            pushCombat(room, protector.name + ' 결속 → ' + member.name + ' 피해 대신 받음 [-' + absorbed + ']', 'damage');
            if (protector.runtime.hp <= 0) {
                protector.runtime.dead = true;
                pushNotice(room, protector.name + ' 전투불능', 'danger', 3500);
                if (room.members.every(m => m.runtime.dead)) {
                    endQuest(room, false, '파티 전멸');
                    return;
                }
            } else maybeStartImmortalArmorRegen(room, protector);
        }
    }
    if (dmg <= 0) {
        pushCombat(room, source + ' → ' + member.name + ' [회피]', 'damage');
        return;
    }
    if (r.nextDamageReduction) {
        const beforeReduction = dmg;
        dmg = Math.round(dmg * (1 - Number(r.nextDamageReduction || 0)));
        recordPartyDamageReduced(member, 'buff', beforeReduction - dmg);
        r.nextDamageReduction = 0;
    }
    if (r.shield > 0) {
        const absorbed = Math.min(r.shield, dmg);
        r.shield -= absorbed;
        dmg -= absorbed;
        recordPartyDamageReduced(member, 'shield', absorbed);
        if (r.shieldHits > 0) {
            r.shieldHits -= 1;
            if (r.shieldHits <= 0) r.shield = 0;
        }
        if (r.shield <= 0 && r.shieldExpireAt) triggerShieldExpire(room, member);
        if (dmg <= 0) {
            pushCombat(room, source + ' → ' + member.name + ' [방어]', 'damage');
            return;
        }
    }
    if (r.iktaeBot) {
        const absorbed = Math.round(dmg * 0.3);
        if (absorbed > 0) {
            dmg = Math.max(0, dmg - absorbed);
            recordPartyDamageReduced(member, 'other', absorbed);
            r.iktaeBot.hp -= absorbed;
            pushCombat(room, '익테봇 → ' + member.name + ' 피해 대신 받음 [-' + absorbed + ']', 'damage');
            if (r.iktaeBot.hp <= 0) {
                r.iktaeBot = null;
                pushCombat(room, member.name + ' 익테봇 파괴', 'buff');
            }
        }
    }
    const hpBefore = r.hp;
    r.hp = Math.max(0, r.hp - dmg);
    const battleStats = getPartyBattleStats(member);
    if (battleStats) battleStats.damageTaken += Math.max(0, hpBefore - r.hp);
    pushCombat(room, source + ' → ' + member.name + ' [-' + dmg + ']', 'damage');
    if (r.hp > 0) maybeStartImmortalArmorRegen(room, member);
    applyDamageTakenSlotRecovery(room, member, dmg);
    // 장비 패시브: 가시 (passive_id 5) — 방어력 × ratio 고정 피해 반사
    const thornSnap = member.baseSnapshot && member.baseSnapshot.thorns;
    if (dmg > 0 && thornSnap && room.monster) {
        const tStats = member.baseSnapshot.stats;
        const tQuest = getQuestById(room.questId);
        const tPosDef = tQuest && tQuest.positions && tQuest.positions[member.position];
        const finalDefMul = (tPosDef && tPosDef.stats && tPosDef.stats.finalDef) || 1;
        const reflect = Math.max(1, Math.round(Number(tStats.def || 50) * finalDefMul * thornSnap.ratio));
        const dealt = applyBossHpDamage(room, room.monster, reflect);
        recordPartyDamage(member, { damage: dealt, fixedDamage: 0, destinyDamage: 0, hitDetails: [], isCrit: false }, '가시 반사');
        pushCombat(room, '가시 반사 → ' + room.monster.name + ' [-' + dealt + ']', 'skill');
        if (room.monster.hp <= 0) { onMonsterDefeated(room); return; }
    }
    // 패시브: 가시 갑옷 — 받은 피해 발생 시 방어력 20% 반사
    if (dmg > 0 && hasPassive(member, '가시 갑옷') && room.monster) {
        const stats = member.baseSnapshot.stats;
        const quest = getQuestById(room.questId);
        const posDef = (quest.positions && quest.positions[member.position]) || {};
        const finalDefMul = (posDef && posDef.stats && posDef.stats.finalDef) || 1;
        const reflect = Math.max(1, calculateNormalDamageToMonster(member, room.monster, room, Math.round(Number(stats.def || 50) * finalDefMul * 0.20)));
        const dealt = applyBossHpDamage(room, room.monster, reflect);
        recordPartyDamage(member, { damage: dealt, fixedDamage: 0, destinyDamage: 0, hitDetails: [], isCrit: false }, '가시 갑옷 반사');
        pushCombat(room, '가시 갑옷 반사 → ' + room.monster.name + ' [-' + dealt + ']', 'skill');
        if (room.monster.hp <= 0) { onMonsterDefeated(room); return; }
    }
    if (r.hp <= 0) {
        r.dead = true;
        pushNotice(room, member.name + ' 전투불능', 'danger', 3500);
        const allDead = room.members.every(m => m.runtime.dead);
        if (allDead) {
            endQuest(room, false, '파티 전멸');
        }
    }
}

function maybeStartImmortalArmorRegen(room, member) {
    const snap = member.baseSnapshot && member.baseSnapshot.immortalArmor;
    if (!snap) return;
    const r = member.runtime;
    if (!r || r.dead || r.hp <= 0 || r.hp > Number(r.hpMax || 0) * IMMORTAL_DRAGON_ARMOR_TRIGGER_HP_RATIO) return;
    if (r.dragonRegen) return;
    const now = nowMs();
    if (Number(snap.readyAt || 0) > now) return;
    snap.readyAt = now + IMMORTAL_DRAGON_ARMOR_COOLDOWN_MS;
    r.dragonRegen = { ticksLeft: IMMORTAL_DRAGON_ARMOR_REGEN_TICKS, nextTickAt: now + 1000 };
    pushNotice(room, member.name + ' [' + IMMORTAL_DRAGON_ARMOR_NAME + '] ' + IMMORTAL_DRAGON_ARMOR_REGEN_TICKS + '초간 초당 ' + Math.round(IMMORTAL_DRAGON_ARMOR_REGEN_HP_PCT * 100) + '% 회복', 'success', 4500);
    persistImmortalArmorCooldown(member.name, snap.readyAt);
}

async function persistImmortalArmorCooldown(name, readyAt) {
    try {
        const user = await rpgenius.getRPGUserByName(name);
        if (!user) return;
        if (!user.equipmentPassiveCd || typeof user.equipmentPassiveCd !== 'object') user.equipmentPassiveCd = {};
        user.equipmentPassiveCd.immortalDragonArmor = Number(readyAt || 0);
        await user.save();
    } catch (e) {
        console.error('[partyquest] immortal armor cooldown save error:', e);
    }
}

function healMember(member, amount, source) {
    if (!member || !member.runtime || member.runtime.dead || !canPartyReceiveHealing(member)) return 0;
    const before = member.runtime.hp;
    member.runtime.hp = Math.min(member.runtime.hpMax, member.runtime.hp + Math.max(0, Math.round(Number(amount || 0))));
    const healed = member.runtime.hp - before;
    recordPartyHealing(source || member, member, healed);
    return healed;
}

function recoverPartyMp(room, amount) {
    const n = Math.max(0, Math.round(Number(amount || 0)));
    if (n <= 0) return;
    for (const m of room.members) {
        if (!m.runtime || m.runtime.dead) continue;
        m.runtime.mp = Math.min(m.runtime.mpMax, m.runtime.mp + n);
    }
    pushCombat(room, '파티 MP +' + comma(n), 'heal');
}

function applyMainCardPassiveMpRecovery(room, caster) {
    // 피아스트 개편으로 '공격 시 MP 회복' 패시브 제거됨
}

function applyDamageTakenSlotRecovery(room, damaged, damage) {
    if (!damaged || Number(damage || 0) <= 0) return;
    for (const m of room.members) {
        const slotEffects = (m.baseSnapshot && m.baseSnapshot.slotEffects) || {};
        const chance = Number(slotEffects.killRecoveryChance || 0);
        if (chance <= 0 || Math.random() >= chance) continue;
        const amount = Math.round(Number(damage || 0) * 0.2);
        let total = 0;
        // 회복 효율(recoveryEfficiency)은 받는 아군 기준으로 적용 (솔로 applyDamageTakenSlotRecovery와 동일)
        for (const ally of room.members) total += healMember(ally, Math.round(amount * getPartyRecoveryMultiplier(ally)), m);
        if (total > 0) pushCombat(room, '글렌첵 효과 → 파티 체력 회복 [+' + comma(amount) + ']', 'heal');
    }
}

function onMonsterDefeated(room) {
    const mon = room.monster;
    // reviveOnce 패턴을 가진 보스만 부활한다 (패턴이 없는 보스는 그대로 처치)
    if (mon && mon.bossState && !mon.bossState.revived && getMonsterPattern(mon, 'reviveOnce').type) {
        const pattern = getMonsterPattern(mon, 'reviveOnce');
        const disablePatterns = pattern.disablePatternsAfterRevive !== false;
        const reviveHpPct = Number(pattern.reviveHpPct || 0.3);
        mon.bossState.revived = true;
        mon.bossState.disabled = disablePatterns;
        mon.bossState.casting = null;
        mon.bossState.buffRemain = 0;
        mon.nextPattern = null;
        mon.hp = Math.max(1, Math.round(mon.hpMax * reviveHpPct));
        mon.gauge = 0;
        mon.debuffs = [];
        const pctLabel = Math.round(reviveHpPct * 100) + '%';
        const noticeMsg = disablePatterns
            ? '🔥 ' + mon.name + ' 부활! 패턴이 사라지고 기본 공격만 사용합니다.'
            : '🔥 ' + mon.name + ' 부활!';
        pushNotice(room, noticeMsg, 'danger', 4500);
        pushCombat(room, mon.name + ' 최대 체력의 ' + pctLabel + '로 부활', 'danger');
        return;
    }
    if (mon && mon.defeatLine) pushNotice(room, mon.defeatLine, 'big', 5000);
    pushNotice(room, (room.monster ? room.monster.name : '적') + ' 처치', 'success', 4000);
    room.monster = null;
    endPhase(room);
}

// ===== 스킬 사용 =====

function useSkill(name, skillName, targetName) {
    const room = getRoomOf(name);
    if (!room) return { error: '참여 중인 파티가 없습니다.' };
    if (room.state !== 'inProgress') return { error: '진행 중이 아닙니다.' };
    if (isIntroActive(room)) return { error: '전투 시작 카운트다운 중입니다.' };
    const me = findMember(room, name);
    if (!me || me.runtime.dead) return { error: '행동할 수 없습니다.' };
    if (me.runtime.stunRemain > 0) return { error: '기절 상태입니다.' };
    if (me.runtime.sealRemain > 0) return { error: '봉인 상태입니다.' };
    if (room.awaitingChoices) return { error: '스킬 선택 후 진행됩니다.' };
    if (skillName === '자폭') return usePartySelfDestruct(room, me);
    if (skillName === '저지') return usePartyBlockSkill(room, me);
    if (!me.skills.includes(skillName)) return { error: '습득하지 않은 스킬입니다.' };
    const def = resolveSkillDef(room, skillName, me);
    if (!def) return { error: '존재하지 않는 스킬입니다.' };
    if (def.type === 'passive') return { error: '패시브 스킬은 사용할 수 없습니다.' };
    if (nowMs() < (me.runtime.cooldownsUntil[skillName] || 0)) return { error: '쿨타임 중입니다.' };
    if (nowMs() < (me.runtime.actionUntil || 0)) return { error: '행동 쿨타임 중입니다.' };
    if (skillName === '시벌론' && Number(me.runtime.sivalonCharge || 0) < 5) {
        return { error: '일반 공격을 5회 사용해야 시벌론이 활성화됩니다. (충전 ' + Number(me.runtime.sivalonCharge || 0) + '/5)' };
    }
    const quest = getQuestById(room.questId);
    const posDef = (quest.positions && quest.positions[me.position]) || {};
    const stats = me.baseSnapshot.stats || {};
    const slotEffects = me.baseSnapshot.slotEffects || {};
    const mainCardSkillNames = (me.baseSnapshot.mainCardSkills || []).map(entry => entry.skill && entry.skill.name).filter(Boolean);
    const equipmentSkill = preparePartyTranscendSkill(me, skillName, mainCardSkillNames.length > 0 && mainCardSkillNames[mainCardSkillNames.length - 1] === skillName, room);
    let mpCostMul = (posDef && posDef.stats && posDef.stats.mpCost) || 1;
    mpCostMul *= (1 - Math.min(1, Math.max(0, Number(slotEffects.mpCostReduction || 0))));
    mpCostMul *= (1 + Number(stats.mpReduce || 0));
    if (hasPassive(me, '과부하')) mpCostMul *= 1.20;
    mpCostMul *= Number(equipmentSkill.mpCostMul || 1);
    const mp = equipmentSkill.noMp ? 0 : Math.round(Number(def.mp || 0) * mpCostMul);
    if (me.runtime.mp < mp) return { error: 'MP가 부족합니다.' };
    me.runtime.equipmentState = equipmentSkill.state;
    if (typeof equipmentSkill.hpAfter !== 'undefined') me.runtime.hp = Math.max(1, Number(equipmentSkill.hpAfter));
    commitPartySkillEquipmentSideEffects(room, equipmentSkill);
    me.runtime.mp -= mp;
    me.runtime.actionUntil = nowMs() + getActionCooldownSeconds(me) * 1000;
    // 건력 상태에서 스킬 사용 시 해제 (건력 자체는 executeMainCardSkillEffect에서 토글 처리)
    if (skillName !== '건력') clearPartyGunryeokOnSkillUse(room, me);
    const cdMul = (posDef && posDef.stats && posDef.stats.skillCd) || 1;
    const statCd = Number(stats.skillCooldown || 0) / 1000;
    const cdPct = typeof rpgenius.getSkillCooldownRate === 'function' ? rpgenius.getSkillCooldownRate(stats) : Math.max(.2, 1 - Number(stats.cooldown || 0));
    const baseCooldown = equipmentSkill.cooldownOverride == null ? Number(def.cd || 0) * cdMul + statCd : Number(equipmentSkill.cooldownOverride || 0);
    const cooldownMs = Math.max(equipmentSkill.cooldownOverride === 0 ? 0 : 500, (baseCooldown * cdPct - Number(equipmentSkill.cooldownFlat || 0)) * 1000);
    me.runtime.cooldownsUntil[skillName] = nowMs() + cooldownMs;
    if (Number(equipmentSkill.selfCooldownRate || 0) > 0) {
        const reductionMs = Math.min(Number(equipmentSkill.selfCooldownCap || 0) * 1000, cooldownMs * Number(equipmentSkill.selfCooldownRate));
        me.runtime.cooldownsUntil[skillName] = Math.max(nowMs(), me.runtime.cooldownsUntil[skillName] - reductionMs);
    }
    if (Number(equipmentSkill.reduceUltimateCooldown || 0) > 0 && mainCardSkillNames.length > 0) {
        const ultimateName = mainCardSkillNames[mainCardSkillNames.length - 1];
        me.runtime.cooldownsUntil[ultimateName] = Math.max(nowMs(), Number(me.runtime.cooldownsUntil[ultimateName] || nowMs()) - Number(equipmentSkill.reduceUltimateCooldown) * 1000);
    }
    if (Number(equipmentSkill.selfShield || 0) > 0 && canPartyApplyShield(me, me)) {
        me.runtime.shield = Number(me.runtime.shield || 0) + Number(equipmentSkill.selfShield);
        me.runtime.shieldHits = 99;
        me.runtime.shieldExpireAt = nowMs() + Number(equipmentSkill.selfShieldDuration || 5) * 1000;
        me.runtime.shieldExpireHeal = 0;
    }
    executeSkillEffect(room, me, skillName, def, targetName, equipmentSkill);
    broadcastRoom(room);
    return { ok: true };
}

function usePartySelfDestruct(room, member) {
    if (!getTranscendEquipmentEntry(member, '카카오의 계략')) return { error: '사용할 수 없는 스킬입니다.' };
    const runtime = member.runtime;
    const now = Date.now();
    if (now < Number(runtime.actionUntil || 0)) return { error: '행동 쿨타임 중입니다.' };
    const botActive = !!(runtime.iktaeBot && Number(runtime.iktaeBot.expired_at || 0) > now && Number(runtime.iktaeBot.hp || 0) > 0);
    const sunataActive = !!(runtime.sunata && Number(runtime.sunata.expired_at || 0) > now);
    if (!botActive && !sunataActive) return { error: '익테봇 또는 수나타가 소환 중일 때만 자폭을 사용할 수 있습니다.' };
    clearPartyGunryeokOnSkillUse(room, member);
    const mainSkills = (member.baseSnapshot.mainCardSkills || []).map(entry => entry.skill && entry.skill.name).filter(Boolean);
    const equipmentSkill = preparePartyTranscendSkill(member, '자폭', false, room);
    runtime.equipmentState = equipmentSkill.state;
    if (typeof equipmentSkill.hpAfter !== 'undefined') runtime.hp = Math.max(1, Number(equipmentSkill.hpAfter));
    commitPartySkillEquipmentSideEffects(room, equipmentSkill);
    if (Number(equipmentSkill.selfShield || 0) > 0 && canPartyApplyShield(member, member)) {
        runtime.shield = Number(runtime.shield || 0) + Number(equipmentSkill.selfShield);
        runtime.shieldHits = 99;
        runtime.shieldExpireAt = now + Number(equipmentSkill.selfShieldDuration || 5) * 1000;
    }
    if (botActive) runtime.cooldownsUntil['익테봇 소환'] = Math.max(now, Number(runtime.cooldownsUntil['익테봇 소환'] || now) - 5000);
    if (sunataActive) runtime.cooldownsUntil['수나타 소환'] = Math.max(now, Number(runtime.cooldownsUntil['수나타 소환'] || now) - 5000);
    if (Number(equipmentSkill.reduceUltimateCooldown || 0) > 0 && mainSkills.length > 0) {
        const ultimate = mainSkills[mainSkills.length - 1];
        runtime.cooldownsUntil[ultimate] = Math.max(now, Number(runtime.cooldownsUntil[ultimate] || now) - Number(equipmentSkill.reduceUltimateCooldown) * 1000);
    }
    runtime.iktaeBot = null;
    runtime.sunata = null;
    runtime.actionUntil = now + getActionCooldownSeconds(member) * 1000;
    const stats = member.baseSnapshot.stats || {};
    const slotEffects = member.baseSnapshot.slotEffects || {};
    const finalAtk = Number(stats.atk || 0) * getPositionStatMul(room, member, 'finalAtk') * (1 + getPartyAttackBuffValue(member)) * (1 + getPartyConditionalFinalAttack(member));
    const ratio = getTranscendStageValue(member, '카카오의 계략', 3.30, .30);
    const rawDamage = Math.max(1, Math.round(finalAtk * ratio * (Number(botActive) + Number(sunataActive)) * (1 + Number(stats.afterSkill || 0) + Number(slotEffects.skillDamageBonus || 0)) * getPositionStatMul(room, member, 'skillDmg')));
    const extra = Object.assign({}, equipmentSkill.extra || {}, { isSkill: true, skillName: '자폭' });
    if (Number(equipmentSkill.shadowDamageRate || 0) > 0) extra.shadowDamageRate = Number(equipmentSkill.shadowDamageRate);
    const quest = getQuestById(room.questId);
    const phase = quest && quest.phases[room.phaseIndex];
    let result;
    if (!room.monster && phase && phase.type === 'mob') {
        const fakeMon = createPhaseMonster(phase);
        result = calculateOutgoingDamage(member, fakeMon, room, rawDamage, extra);
        applyMobPhaseDamage(room, member, fakeMon, result, 'skill', '자폭', false);
    } else if (room.monster) {
        result = dealSkillDamageToMonster(room, member, rawDamage, extra);
        pushCombat(room, member.name + ' [자폭] → ' + room.monster.name + ' [-' + result.damage + ']', 'skill');
        broadcast(room, 'hit', { by: member.name, type: 'skill', skill: '자폭', damage: result.damage, crit: !!result.isCrit, hitDetails: result.hitDetails || [], monster: serializeMonster(room.monster) });
        if (room.monster && room.monster.hp <= 0) onMonsterDefeated(room);
    } else return { error: '공격할 대상이 없습니다.' };
    broadcastRoom(room);
    return { ok: true, damage: result && result.damage };
}

function resolveSkillDef(room, skillName, member) {
    const quest = getQuestById(room.questId);
    if (member && member.skillDefs && member.skillDefs[skillName]) return member.skillDefs[skillName];
    if (quest.skills && quest.skills[skillName]) return quest.skills[skillName];
    if (quest.extraSkills && quest.extraSkills[skillName]) return quest.extraSkills[skillName];
    for (const m of room.members) {
        if (m.skillDefs && m.skillDefs[skillName]) return m.skillDefs[skillName];
    }
    return null;
}

function executeSkillEffect(room, caster, skillName, def, targetName, equipmentSkill) {
    if (def.source === 'mainCard') {
        executeMainCardSkillEffect(room, caster, skillName, def, targetName, equipmentSkill);
        return;
    }
    const stats = caster.baseSnapshot.stats;
    const slotEffects = caster.baseSnapshot.slotEffects || {};
    const quest = getQuestById(room.questId);
    const posDef = (quest.positions && quest.positions[caster.position]) || {};
    const finalAtkMul = (posDef && posDef.stats && posDef.stats.finalAtk) || 1;
    let skillDmgMul = (posDef && posDef.stats && posDef.stats.skillDmg) || 1;
    if (hasPassive(caster, '과부하')) skillDmgMul *= 1.25;
    if (def.countAsBasic) skillDmgMul = 1;
    const extra = Object.assign({}, equipmentSkill && equipmentSkill.extra || {});
    if (Number(equipmentSkill && equipmentSkill.shadowDamageRate || 0) > 0) extra.shadowDamageRate = Number(equipmentSkill.shadowDamageRate);
    extra.skillName = skillName;
    if (def.hits) extra.hitCount = Number(def.hits || 1);
    if (def.extraOnCrit) extra.extraOnCrit = def.extraOnCrit;
    const ctx = {
        atk: Number(stats.atk || 100) * finalAtkMul * (1 + getPartyAttackBuffValue(caster)) * (1 + getPartyConditionalFinalAttack(caster)),
        def: Number(stats.def || 50),
        targetMaxHp: room.monster ? room.monster.hpMax : 0
    };
    const phase = quest && quest.phases[room.phaseIndex];
    if (def.damage && (room.monster || (phase && phase.type === 'mob'))) {
        const targetMonster = room.monster || createPhaseMonster(phase);
        ctx.targetMaxHp = targetMonster.hpMax || ctx.targetMaxHp;
        // getFinalDamageMul(복수의 칼날/마력 감응/수나타/건력)은 calculateOutgoingDamage 안에서 1회 적용된다 — 여기서 곱하면 중복 적용
        let dmg = evalFormula(def.damage, ctx) * skillDmgMul;
        if (def.countAsBasic) dmg *= (1 + Number(stats.afterBasic || 0) + Number(slotEffects.basicDamageBonus || 0));
        // 스택형 (낙뢰)
        if (def.stack && def.stack.key) {
            const k = def.stack.key;
            caster.runtime.stackCounters[k] = (caster.runtime.stackCounters[k] || 0);
            dmg *= (1 + caster.runtime.stackCounters[k] * Number(def.stack.incPerUse || 0));
            caster.runtime.stackCounters[k] += 1;
        }
        const fixedDamage = Math.max(0, Math.round(Number(stats.skillTrueDmg || 0)));
        const rawDamage = Math.max(1, Math.round(dmg));
        if (phase && phase.type === 'mob' && !room.monster) {
            const result = calculateOutgoingDamage(caster, targetMonster, room, rawDamage, Object.assign({}, extra, { skillTrueDmg: fixedDamage, isSkill: true, isBasic: !!def.countAsBasic, skillElement: def.element }));
            const damage = result.damage;
            applyMobPhaseDamage(room, caster, targetMonster, result, 'skill', skillName, true);
            if (def.mpRefundPctOfDealt) caster.runtime.mp = Math.min(caster.runtime.mpMax, caster.runtime.mp + Math.round(damage * Number(def.mpRefundPctOfDealt)));
            if (def.lifesteal && def.lifesteal.byMissingHp) healMember(caster, Math.round(Math.max(0, caster.runtime.hpMax - caster.runtime.hp) * Number(def.lifesteal.byMissingHp || 0)));
            if (def.selfDodgeNext) caster.runtime.dodgeNext = true;
            applyMainCardPassiveMpRecovery(room, caster);
            return;
        }
        const result = calculateOutgoingDamage(caster, room.monster, room, rawDamage, Object.assign({}, extra, { skillTrueDmg: fixedDamage, isSkill: true, isBasic: !!def.countAsBasic, skillElement: def.element }));
        const invincible = !!(room.monster.bossState && room.monster.bossState.casting);
        if (invincible) result.damage = 0;
        let damage = result.damage;
        if (!invincible) damage = applyPlayerDamageToBoss(room, room.monster, caster, damage);
        result.damage = damage;
        recordPartyDamage(caster, result, skillName);
        pushCombat(room, caster.name + ' [' + skillName + '] → ' + room.monster.name + ' [-' + damage + ']', 'skill');
        if (def.debuff && def.debuff.def) room.monster.def = Math.max(0, Number(room.monster.def || 0) + Number(def.debuff.def));
        if (def.debuff && def.debuff.takenDmg) {
            addMonsterDebuff(room.monster, { id: skillName, type: 'takenDamage', value: Number(def.debuff.takenDmg || 0), remain: Number(def.debuff.duration || 5) });
            pushCombat(room, room.monster.name + ' 받는 피해 증가 +' + Math.round(Number(def.debuff.takenDmg || 0) * 100) + '%', 'buff');
        }
        if (def.stun && def.stun > 0) {
            room.monster.stunRemain = Math.max(Number(room.monster.stunRemain || 0), Number(def.stun || 0));
            if (room.monster.bossState && room.monster.bossState.casting) {
                pushCombat(room, room.monster.name + ' [' + room.monster.bossState.casting.name + '] 캐스팅 중단', 'buff');
                room.monster.bossState.casting = null;
                room.monster.nextPattern = null;
            }
            pushNotice(room, room.monster.name + ' 기절 (' + def.stun + 's)', 'info', 2500);
        }
        applyBlackHoduCritReflect(room, caster, result);
        if (room.state !== 'inProgress' || !room.monster) return;
        if (def.mpRefundPctOfDealt) caster.runtime.mp = Math.min(caster.runtime.mpMax, caster.runtime.mp + Math.round(damage * Number(def.mpRefundPctOfDealt)));
        if (def.lifesteal && def.lifesteal.byMissingHp) healMember(caster, Math.round(Math.max(0, caster.runtime.hpMax - caster.runtime.hp) * Number(def.lifesteal.byMissingHp || 0)));
        if (def.selfDodgeNext) caster.runtime.dodgeNext = true;
        applyAttackPotentialRecovery(room, caster);
        applyMainCardPassiveMpRecovery(room, caster);
        broadcast(room, 'hit', {
            by: caster.name,
            type: 'skill',
            skill: skillName,
            damage: damage,
            fixedDamage: result.fixedDamage || 0,
            destinyDamage: result.destinyDamage || 0,
            crit: !!result.isCrit,
            hitDetails: result.hitDetails || [],
            monster: serializeMonster(room.monster)
        });
        // 패시브: 잔류 전격 — 스킬 명중 시 75% 확률로 입히는 피해 -15%, 3초
        if (hasPassive(caster, '잔류 전격') && room.monster.hp > 0 && Math.random() < 0.75) {
            if (!Array.isArray(room.monster.debuffs)) room.monster.debuffs = [];
            const exist = room.monster.debuffs.find(d => d.id === '잔류 전격');
            if (exist) { exist.remain = 3; }
            else { room.monster.debuffs.push({ id: '잔류 전격', type: 'dealtDmg', value: -0.15, remain: 3 }); }
            pushCombat(room, '잔류 전격 — ' + room.monster.name + ' 감전', 'buff');
        }
        if (room.monster.hp <= 0) onMonsterDefeated(room);
    }
    if (def.heal) {
        const amount = Math.max(1, Math.round(evalFormula(def.heal, ctx) * getPartyRecoveryMultiplier(caster)));
        if (def.target === 'allAllies') {
            for (const m of room.members) {
                if (!m.runtime.dead) {
                    healMember(m, amount, caster);
                    applyTranscendAllyEffect(room, caster, m, 'heal');
                }
            }
            pushCombat(room, caster.name + ' [' + skillName + '] → 파티 전체 [+' + amount + ']', 'heal');
        } else {
            const target = pickAllyTarget(room, caster, targetName);
            if (target) {
                healMember(target, amount, caster);
                applyTranscendAllyEffect(room, caster, target, 'heal');
                pushCombat(room, caster.name + ' [' + skillName + '] → ' + target.name + ' [+' + amount + ']', 'heal');
            }
        }
    }
    if (def.shield) {
        const target = pickAllyTarget(room, caster, targetName) || caster;
        const amount = Math.max(1, Math.round(evalFormula(def.shield, ctx) * getPartyShieldMultiplier(caster)));
        if (canPartyApplyShield(caster, target)) {
            target.runtime.shield = (target.runtime.shield || 0) + amount;
            target.runtime.shieldHits = Number(def.shieldHits || 99);
            applyTranscendAllyEffect(room, caster, target, 'shield');
            pushCombat(room, caster.name + ' [' + skillName + '] → ' + target.name + ' 보호막 +' + amount, 'buff');
        }
    }
    if (def.buff) {
        const target = pickAllyTarget(room, caster, targetName) || caster;
        if (def.buff.atkMul) {
            target.runtime.atkBuff = scalePartyAttackBuff(caster, Number(def.buff.atkMul) - 1);
            upsertMemberBuff(target, { id: 'atkBuff', label: skillName + ' (공+)', value: target.runtime.atkBuff, remain: Number(def.buff.duration || 5) });
            applyTranscendAllyEffect(room, caster, target, 'buff');
        }
    }
    if (def.self) {
        if (def.self.actCdMul) {
            caster.runtime.actCdMul = Number(def.self.actCdMul);
            upsertMemberBuff(caster, { id: 'actCdMul', label: skillName + ' (가속)', value: caster.runtime.actCdMul, remain: Number(def.duration || 5) });
        }
        if (def.self.atkMul) {
            caster.runtime.atkBuff = scalePartyAttackBuff(caster, Number(def.self.atkMul) - 1);
            upsertMemberBuff(caster, { id: 'atkBuff', label: skillName + ' (공+)', value: caster.runtime.atkBuff, remain: Number(def.duration || 5) });
        }
        if (def.self.takenDmg) {
            caster.runtime.takenDmgMul = Number(def.self.takenDmg);
            upsertMemberBuff(caster, { id: 'takenDmgSelf', label: skillName + ' (방+)', value: caster.runtime.takenDmgMul, remain: Number(def.duration || 5) });
        }
        if (def.absorbAlly) {
            caster.runtime.absorbAlly = Number(def.absorbAlly || 0);
            upsertMemberBuff(caster, { id: 'absorbAlly', label: skillName + ' (보호)', value: caster.runtime.absorbAlly, remain: Number(def.duration || 5) });
        }
    }
    if (def.effect === 'taunt') {
        const duration = Number(def.duration || 5);
        room.tauntTarget = caster.name;
        room.tauntRemain = duration;
        if (room.monster) {
            room.monster.tauntTarget = caster.name;
            room.monster.tauntRemain = duration;
        }
        const targetLabel = room.monster ? room.monster.name : '잡몹';
        pushCombat(room, caster.name + ' [' + skillName + '] → ' + targetLabel + ' 도발', 'buff');
    }
    if (def.buffNextBasic && def.buffNextBasic.critAdd) {
        caster.runtime.critBoostNext = Number(def.buffNextBasic.critAdd);
        if (def.buffNextBasic.trueDamageOnCrit) caster.runtime.trueDamageOnCritNext = true;
        pushCombat(room, caster.name + ' [' + skillName + '] (다음 공격 강화)', 'buff');
    }
}

function executeMainCardSkillEffect(room, caster, skillName, def, targetName, equipmentSkill) {
    const skill = def.raw || {};
    const star = Number(def.star || 0);
    const stats = caster.baseSnapshot.stats || {};
    const slotEffects = caster.baseSnapshot.slotEffects || {};
    const finalAtkMul = getPositionStatMul(room, caster, 'finalAtk');
    const finalAtk = Number(stats.atk || 0) * finalAtkMul * (1 + getPartyAttackBuffValue(caster)) * (1 + getPartyConditionalFinalAttack(caster));
    let skillDmgMul = getPositionStatMul(room, caster, 'skillDmg');
    if (hasPassive(caster, '과부하')) skillDmgMul *= 1.25;
    const multiplier = getSkillValue(skill, 0, star);
    const extra = Object.assign({}, equipmentSkill && equipmentSkill.extra || {});
    if (Number(equipmentSkill && equipmentSkill.shadowDamageRate || 0) > 0) extra.shadowDamageRate = Number(equipmentSkill.shadowDamageRate);
    extra.skillName = skillName;
    if (skill && skill.element) extra.skillElement = skill.element;
    let nextSkillBonus = 0;
    // 일반 공격으로 간주되는 스킬(포커 못 하시네/비리)은 유드 알레프의 '다음 스킬 피해' 버프를 소모하지 않는다 (솔로 basicAttackSkill 가드와 동일)
    const countsAsBasicSkill = skillName === '포커 못 하시네' || skillName === '비리';
    if (caster.runtime.nextSkillDamageBonus && !countsAsBasicSkill) {
        nextSkillBonus = Number(caster.runtime.nextSkillDamageBonus || 0);
        caster.runtime.nextSkillDamageBonus = 0;
    }
    let rawDamage = Math.round(finalAtk * multiplier * (1 + Number(stats.afterSkill || 0) + Number(slotEffects.skillDamageBonus || 0) + nextSkillBonus) * skillDmgMul);
    if (skillName === '나인 멘스 모리스') {
        if (!caster.runtime.stackCounters) caster.runtime.stackCounters = {};
        const stacks = Math.min(9, Number(caster.runtime.stackCounters['나인멘스'] || 0));
        const roseKnifeBonus = getTranscendStageValue(caster, '장미칼', .06, .02);
        const nmmMul = getSkillValue(skill, 0, star) * (1 + (getSkillValue(skill, 1, star) + roseKnifeBonus) * stacks);
        rawDamage = Math.round(finalAtk * nmmMul * (1 + Number(stats.afterSkill || 0) + Number(slotEffects.skillDamageBonus || 0) + nextSkillBonus) * skillDmgMul);
        if (stacks >= 9) extra.defReductionBonus = Number(extra.defReductionBonus || 0) + 0.5;
        caster.runtime.stackCounters['나인멘스'] = roseKnifeBonus > 0 && stacks >= 9 ? 3 : 0;
        pushCombat(room, caster.name + ' [나인 멘스 모리스] ' + stacks + '중첩 소모' + (stacks >= 9 ? ' (방관 50%' + (roseKnifeBonus > 0 ? ', 3중첩 유지' : '') + ')' : ''), 'buff');
    }
    if (skillName === '포커 못 하시네') {
        extra.hitCount = 9;
        extra.isBasic = true; // 일반 공격으로 간주 (파티 퀘스트 countAsBasic 스킬과 동일 취급)
        extra.separateBasicAttackHits = true; // 9타 각각을 공격 1회로 집계 (나인 멘스 중첩·10번째 공격 카운터, 솔로와 동일)
        rawDamage = Math.round(finalAtk * multiplier * (1 + Number(stats.afterBasic || 0) + Number(slotEffects.basicDamageBonus || 0)));
    }
    if (skillName === '글버지') {
        const shieldAmt = Math.max(1, Math.round(caster.runtime.hpMax * getSkillValue(skill, 1, star) * getPartyShieldMultiplier(caster)));
        const allyAtk = getSkillValue(skill, 2, star);
        const expireHeal = Math.round(caster.runtime.hpMax * 0.04);
        for (const m of room.members) {
            if (!m.runtime || m.runtime.dead) continue;
            if (canPartyApplyShield(caster, m)) {
                m.runtime.shield = (m.runtime.shield || 0) + shieldAmt;
                m.runtime.shieldHits = 99;
                m.runtime.shieldExpireAt = Date.now() + 8000;
                m.runtime.shieldExpireHeal = expireHeal;
            }
            m.runtime.atkBuff = scalePartyAttackBuff(caster, allyAtk);
            upsertMemberBuff(m, { id: 'atkBuff', label: '글버지 (공+)', value: m.runtime.atkBuff, remain: 8 });
            applyTranscendAllyEffect(room, caster, m, canPartyApplyShield(caster, m) ? 'shield' : 'buff');
        }
        pushCombat(room, caster.name + ' [글버지] → 파티 보호막 +' + comma(shieldAmt) + ' / 공격력 ▲', 'buff');
    }
    if (skillName === '자인') {
        if (getTranscendEquipmentEntry(caster, '궁택토')) caster.runtime.nextBasicDamageBonus = 0;
        else caster.runtime.nextBasicDamageBonus = getSkillValue(skill, 1, star) + getTranscendStageValue(caster, '쿠루미의 힘이 깃든 지팡이', .75, .25);
    }
    if (skillName === '시벌론') {
        const durationSec = getSkillValue(skill, 0, star);
        caster.runtime.sivalonUntil = Date.now() + Math.round(durationSec * 1000);
        caster.runtime.sivalonCharge = 0;
        caster.runtime.actionUntil = 0; // 편의성: 사용 즉시 평타 가능 (행동 쿨타임 초기화)
        upsertMemberBuff(caster, { id: 'sivalon', label: '시벌론 (공속)', remain: Math.round(durationSec * 10) / 10 });
        pushCombat(room, caster.name + ' [시벌론] ' + (Math.round(durationSec * 10) / 10) + '초간 일반 공격 쿨타임 0.5초', 'buff');
        return;
    }
    if (skillName === '건력') {
        if (caster.runtime.gunryeok) {
            clearPartyGunryeok(caster);
            if (Array.isArray(caster.runtime.buffs)) caster.runtime.buffs = caster.runtime.buffs.filter(b => b.id !== 'gunryeok');
            pushCombat(room, caster.name + ' [건력] 상태 해제', 'buff');
            return;
        }
        const dmgReduce = getSkillValue(skill, 0, star);
        const atkBuff = scalePartyAttackBuff(caster, getSkillValue(skill, 1, star));
        const originalHpMax = Number(caster.runtime.hpMax || 0);
        const sealedMax = Math.max(1, Math.round(originalHpMax * 0.3));
        caster.runtime.gunryeok = { originalHpMax: originalHpMax, dmgReduce: dmgReduce, atkBuff: atkBuff };
        caster.runtime.hpMax = sealedMax;
        caster.runtime.hp = Math.min(Number(caster.runtime.hp || 0), sealedMax);
        upsertMemberBuff(caster, { id: 'gunryeok', label: '건력 (공+/피해감소)', value: atkBuff, remain: 60 });
        pushCombat(room, caster.name + ' [건력] 60초간 최대 HP 70% 봉인 / 공격력 +' + Math.round(atkBuff * 100) + '% / 받는 피해 -' + Math.round(dmgReduce * 100) + '%', 'buff');
        return;
    }
    if (skillName === '불사조') {
        extra.damageBonusMul = Number(extra.damageBonusMul || 0) + Number(stats.crit || 0) * 0.5;
        caster.runtime.takenDmgMul = 1.5;
        const prisonKey = getTranscendEquipmentEntry(caster, '감옥열쇠');
        if (prisonKey) {
            extra.critChanceBonus = Number(extra.critChanceBonus || 0) + .10;
            extra.damageBonusMul = Number(extra.damageBonusMul || 0) + .30;
        }
        upsertMemberBuff(caster, { id: 'takenDmgSelf', label: '불사조 (피해증가)', value: caster.runtime.takenDmgMul, remain: prisonKey ? 8 + getEquipmentEffectDurationBonus(caster) : 4 });
    }
    if (skillName === '피아스트') {
        // 8초간 최대 MP의 ${2}만큼 본인 보호막 (솔로와 동일; 파티 전용 효과는 아래 공격력/MP)
        const piastShield = Math.max(1, Math.round(caster.runtime.mpMax * getSkillValue(skill, 1, star) * getPartyShieldMultiplier(caster)));
        if (canPartyApplyShield(caster, caster)) {
            caster.runtime.shield = (caster.runtime.shield || 0) + piastShield;
            caster.runtime.shieldHits = 99;
            caster.runtime.shieldExpireAt = Date.now() + 8000;
            caster.runtime.shieldExpireHeal = 0;
        }
        const allyAtk = getSkillValue(skill, 2, star);
        for (const m of room.members) {
            if (!m.runtime || m.runtime.dead) continue;
            m.runtime.atkBuff = scalePartyAttackBuff(caster, allyAtk);
            upsertMemberBuff(m, { id: 'atkBuff', label: '피아스트 (공+)', value: m.runtime.atkBuff, remain: 8 });
            applyTranscendAllyEffect(room, caster, m, 'buff');
        }
        extra.partyMpFlat = Math.round(caster.runtime.mpMax * getSkillValue(skill, 3, star));
    }
    if (skillName === '수업끝') {
        extra.disableCritical = true;
        caster.runtime.takenDmgMul = 0.7;
        upsertMemberBuff(caster, { id: 'takenDmgSelf', label: '수업끝 (피해감소)', value: caster.runtime.takenDmgMul, remain: 3 });
    }
    if (skillName === '유드 알레프') {
        caster.runtime.nextSkillDamageBonus = 0.10;
        upsertMemberBuff(caster, { id: 'nextSkillDmg', label: '유드 알레프 (다음 스킬+)', value: 0.10, remain: 1 });
    }
    if (skillName === '안면강타') {
        caster.runtime.nextDamageReduction = 0.30;
        upsertMemberBuff(caster, { id: 'nextDmgRed', label: '안면강타 (다음 피해감소)', value: 0.30, remain: 1 });
    }
    if (skillName === '감사합니다 친구야') {
        const shieldBonus = getTranscendStageValue(caster, '강릉함씨 32대손', .08, .02);
        const shieldAmt = Math.max(1, Math.round(caster.runtime.hpMax * getSkillValue(skill, 1, star) * getPartyShieldMultiplier(caster) * (1 + shieldBonus)));
        if (canPartyApplyShield(caster, caster)) {
            caster.runtime.shield = (caster.runtime.shield || 0) + shieldAmt;
            caster.runtime.shieldHits = 99;
            caster.runtime.shieldExpireAt = Date.now() + 12000;
            caster.runtime.shieldExpireHeal = 0;
        }
        caster.runtime.takenDmgMul = 0.7;
        upsertMemberBuff(caster, { id: 'takenDmgSelf', label: '감사합니다 친구야 (피해감소)', value: 0.7, remain: 12 });
        pushCombat(room, caster.name + ' [감사합니다 친구야] → 보호막 +' + comma(shieldAmt) + ' / 받는 피해 ▼', 'buff');
    }
    if (skillName === 'KICK BACK') {
        extra.critChanceMul = 0.5;
        extra.critMulBonus = getSkillValue(skill, 1, star);
    }
    if (skillName === '익테봇 소환') {
        const hpRatio = getSkillValue(skill, 0, star);
        const atkMul = getSkillValue(skill, 1, star);
        const summonDurationBonus = 1 + Number(caster.baseSnapshot.stats.summonDuration || 0);
        const durationMs = Math.round(20000 * summonDurationBonus);
        caster.runtime.iktaeBot = { hp: Math.round(caster.runtime.hpMax * hpRatio), atkMul: atkMul, expired_at: Date.now() + durationMs, nextAttackAt: Date.now() + 4000 };
        pushCombat(room, caster.name + ' 익테봇 소환 (' + (durationMs / 1000).toFixed(1) + '초)', 'buff');
        return;
    }
    if (skillName === 'SUPER EASY') {
        extra.critChanceMul = 0.5;
        extra.critMulBonus = getSkillValue(skill, 1, star);
    }
    if (skillName === '청정수 투척') extra.pnt = Number(stats.pnt || 0) + getSkillValue(skill, 1, star);
    if (skillName === '비리') {
        extra.forceCritical = true;
        extra.isBasic = true; // 일반 공격으로 간주 (나인 멘스 모리스 중첩·심연 등 일반 공격 판정, 솔로 basicAttackSkill과 동일)
        rawDamage = Math.round(finalAtk * multiplier * (1 + Number(stats.afterBasic || 0) + Number(slotEffects.basicDamageBonus || 0)));
    }
    if (skillName === '54버스트') extra.forceCritical = true;
    if (skillName === '처형박수') {
        extra.damageBonusMul = Number(extra.damageBonusMul || 0) + Number(stats.crit || 0); // 치명타 확률만큼 피해 증가
        caster.runtime.takenDmgMul = 2.0; // 받는 피해 100% 증가
        upsertMemberBuff(caster, { id: 'takenDmgSelf', label: '처형박수 (피해증가)', value: 2.0, remain: 4 });
    }
    if (skillName === '핫식스의정력') {
        const shieldAmt = Math.max(1, Math.round(caster.runtime.hpMax * getSkillValue(skill, 1, star) * getPartyShieldMultiplier(caster)));
        for (const m of room.members) {
            if (!m.runtime || m.runtime.dead) continue;
            if (!canPartyApplyShield(caster, m)) continue;
            m.runtime.shield = (m.runtime.shield || 0) + shieldAmt;
            m.runtime.shieldHits = 99;
            m.runtime.shieldExpireAt = Date.now() + 12000;
            m.runtime.shieldExpireHeal = 0;
            applyTranscendAllyEffect(room, caster, m, 'shield');
        }
        pushCombat(room, caster.name + ' [핫식스의정력] → 파티 보호막 +' + comma(shieldAmt) + ' (12초)', 'buff');
    }
    if (skillName === '이어브피') {
        const shieldAmt = Math.max(1, Math.round(caster.runtime.mpMax * getSkillValue(skill, 1, star) * getPartyShieldMultiplier(caster)));
        for (const m of room.members) {
            if (!m.runtime || m.runtime.dead) continue;
            if (!canPartyApplyShield(caster, m)) continue;
            m.runtime.shield = (m.runtime.shield || 0) + shieldAmt;
            m.runtime.shieldHits = 99;
            m.runtime.shieldExpireAt = Date.now() + 12000;
            m.runtime.shieldExpireHeal = 0;
            applyTranscendAllyEffect(room, caster, m, 'shield');
        }
        pushCombat(room, caster.name + ' [이어브피] → 파티 보호막 +' + comma(shieldAmt) + ' (12초)', 'buff');
    }
    if (skillName === '댄져') {
        extra.pnt = Number(stats.pnt || 0) + getSkillValue(skill, 1, star);
        if (getTranscendEquipmentEntry(caster, '썩어버린 물')) {
            const state = caster.runtime.equipmentState || (caster.runtime.equipmentState = {});
            const stacks = Math.min(3, Number(state.rottenWaterStacks || 0));
            if (stacks >= 3) extra.extraDamageBonus = Number(extra.extraDamageBonus || 0) + .20;
            state.rottenWaterStacks = 0;
        }
    }
    if (skillName === '초특급한탕' && equipmentSkill && equipmentSkill.superJackpot) {
        rawDamage = Math.round(rawDamage * (getSkillValue(skill, 1, star) / (multiplier || 1)));
        pushCombat(room, caster.name + ' [초특급한탕] 폭딜 발동', 'buff');
    }
    if (skillName === '수나타 소환') {
        const atkMul = getSkillValue(skill, 0, star);
        const buffMul = getSkillValue(skill, 1, star);
        const durationMs = Math.round(45000 * (1 + Number(caster.baseSnapshot.stats.summonDuration || 0)));
        caster.runtime.sunata = { atkMul: atkMul, buff: scalePartyAttackBuff(caster, buffMul), expired_at: Date.now() + durationMs, nextAttackAt: Date.now() + 5000 };
        upsertMemberBuff(caster, { id: 'sunata', label: '수나타 (공+)', value: caster.runtime.sunata.buff, remain: Math.round(durationMs / 1000) });
        pushCombat(room, caster.name + ' 수나타 소환 (' + (durationMs / 1000).toFixed(1) + '초)', 'buff');
        return;
    }
    if (skillName === '유서새김') {
        if (room.monster) {
            const defDown = getSkillValue(skill, 0, star) + getTranscendStageValue(caster, '흐음티콘', .12, .04);
            const dotMul = 1 + Number(stats.dotDamage || 0) + getTranscendStageValue(caster, '흐음티콘', .40, .15);
            const dotDmg = Math.max(1, Math.round(Number(stats.atk || 0) * getSkillValue(skill, 1, star) * dotMul));
            addMonsterDebuff(room.monster, { id: '유서새김-def', type: 'defReduce', value: defDown, remain: 10 });
            addMonsterDebuff(room.monster, { id: '유서새김', label: '유서새김', type: 'dot', dmg: dotDmg, interval: 2, tick: 2, remain: 10, sourceName: caster.name, sourceSkill: '유서새김' });
            pushCombat(room, caster.name + ' [유서새김] → ' + room.monster.name + ' 표식 (방어력 ▼ / 2초마다 지속 피해)', 'buff');
        }
        applyMainCardPassiveMpRecovery(room, caster);
        return;
    }
    if (skillName === '범인은 이 안에') {
        const pnt = getSkillValue(skill, 0, star);
        const fdmg = getSkillValue(skill, 1, star);
        const bloodOath = getTranscendEquipmentEntry(caster, '피의 서약');
        let recipients = [];
        if (bloodOath && room.monster) {
            const finalTaken = getTranscendStageValue(caster, '피의 서약', .12, .04);
            const defDown = getTranscendStageValue(caster, '피의 서약', .15, .05);
            addMonsterDebuff(room.monster, { id: '피의 서약-final', type: 'takenDamage', value: finalTaken, remain: 10 });
            addMonsterDebuff(room.monster, { id: '피의 서약-def', type: 'defReduce', value: defDown, remain: 10 });
        } else {
            const ally = pickAllyTarget(room, caster, targetName);
            recipients = ally && ally !== caster ? [caster, ally] : [caster];
            const until = Date.now() + 10000;
            for (const t of recipients) {
                t.runtime.pntBonusValue = pnt;
                t.runtime.pntBonusUntil = until;
                upsertMemberBuff(t, { id: 'pntBonus', label: '범인은 이 안에 (방관)', value: pnt, remain: 10 });
            }
        }
        // 다음 기본 공격 최종 피해 증가: 시전자(흠시원)에게만 부여
        caster.runtime.nextFinalDamageBonus = fdmg;
        const hpCost = Math.floor(Number(caster.runtime.hp || 0) * 0.1);
        caster.runtime.hp = Math.max(1, Number(caster.runtime.hp || 0) - hpCost);
        pushCombat(room, caster.name + ' [범인은 이 안에] → ' + (bloodOath ? room.monster.name + ' 범인 지정' : recipients.map(t => t.name).join(', ') + ' 방어 관통 ▲') + ' / 다음 공격 최종 피해 ▲ (HP -' + comma(hpCost) + ')', 'buff');
        applyMainCardPassiveMpRecovery(room, caster);
        return;
    }
    if (Number(stats.skillTrueDmg || 0) > 0) extra.skillTrueDmg = Number(stats.skillTrueDmg);
    const quest = getQuestById(room.questId);
    const phase = quest && quest.phases[room.phaseIndex];
    if (phase && phase.type === 'mob') {
        const fakeMon = createPhaseMonster(phase);
        const result = calculateOutgoingDamage(caster, fakeMon, room, rawDamage, extra);
        applyMobPhaseDamage(room, caster, fakeMon, result, 'skill', skillName, true);
        if (extra.lifeStealFromPreMitigation) healMember(caster, Math.round(rawDamage * Number(extra.lifeStealFromPreMitigation || 0)));
        if (extra.partyMpFlat) recoverPartyMp(room, extra.partyMpFlat);
        return;
    }
    const result = dealSkillDamageToMonster(room, caster, rawDamage, extra);
    applyAttackPotentialRecovery(room, caster);
    if (extra.lifeStealFromPreMitigation) healMember(caster, Math.round(rawDamage * Number(extra.lifeStealFromPreMitigation || 0)));
    if (extra.partyMpFlat) recoverPartyMp(room, extra.partyMpFlat);
    pushCombat(room, caster.name + ' [' + skillName + '] → ' + (room.monster ? room.monster.name : '적') + ' [-' + result.damage + (result.isCrit ? ' 치명' : '') + ']', 'skill');
    broadcast(room, 'hit', {
        by: caster.name,
        type: 'skill',
        skill: skillName,
        damage: result.damage,
        fixedDamage: result.fixedDamage || 0,
        destinyDamage: result.destinyDamage || 0,
        crit: !!result.isCrit,
        hitDetails: result.hitDetails || [],
        monster: serializeMonster(room.monster)
    });
    if (room.monster && room.monster.hp <= 0) onMonsterDefeated(room);
}

function pickAllyTarget(room, caster, targetName) {
    if (targetName) {
        const t = findMember(room, targetName);
        if (t && !t.runtime.dead) return t;
    }
    if (caster && !caster.runtime.dead) return caster;
    return room.members.find(m => !m.runtime.dead) || null;
}

function shuffle(arr) {
    const out = arr.slice();
    for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
}

// 매우 제한적인 수식 평가기 (atk/def/targetMaxHp + 숫자 + + - * / 만 허용)
function evalFormula(expr, ctx) {
    if (typeof expr === 'number') return expr;
    const safe = String(expr).replace(/[a-zA-Z_][a-zA-Z0-9_]*/g, m => {
        if (Object.prototype.hasOwnProperty.call(ctx, m)) return '(' + Number(ctx[m] || 0) + ')';
        return '0';
    });
    if (!/^[\d+\-*/().\s]+$/.test(safe)) return 0;
    try { return Function('"use strict";return (' + safe + ')')(); } catch (_) { return 0; }
}

// ===== SSE 등록 =====

function attachStream(name, res) {
    const room = getRoomOf(name);
    if (!room) {
        sseSend(res, 'error', { error: '참여 중인 파티가 없습니다.' });
        try { res.end(); } catch (_) {}
        return;
    }
    const me = findMember(room, name);
    if (!me) {
        sseSend(res, 'error', { error: '파티 멤버가 아닙니다.' });
        try { res.end(); } catch (_) {}
        return;
    }
    if (me.sseRes && !me.sseRes.writableEnded) { try { me.sseRes.end(); } catch (_) {} }
    me.sseRes = res;
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders && res.flushHeaders();
    sseSend(res, 'room', serializeRoomForMember(room));

    const heartbeat = setInterval(() => {
        if (res.writableEnded) { clearInterval(heartbeat); return; }
        try { res.write(': ping\n\n'); } catch (_) { clearInterval(heartbeat); }
    }, 25000);

    res.on('close', () => {
        clearInterval(heartbeat);
        if (me.sseRes === res) me.sseRes = null;
        setTimeout(() => {
            const cur = rooms.get(room.id);
            if (!cur) return;
            const cm = findMember(cur, name);
            if (!cm) return;
            if (!cm.sseRes) leaveRoom(name);
        }, 30000);
    });
}

// ===== 물약 =====

const POTION_FUNC_TYPES = new Set(['체력회복', '마나회복', '체력회복%', '마나회복%']);
const POTION_GLOBAL_CD = 3; // 모든 물약 공용 쿨다운 (초)
const ACTION_GLOBAL_CD = 2.5; // 일반공격/스킬 공용 행동 쿨다운 (초)

function getActionCooldownSeconds(member) {
    const mul = member && member.runtime ? Number(member.runtime.actCdMul || 1) : 1;
    return Math.max(0.5, ACTION_GLOBAL_CD * mul);
}

function getItemDef(name) {
    const list = rpgenius.getDataCache('Item', []) || [];
    const idx = list.findIndex(it => it && it.name === name);
    if (idx < 0) return null;
    return { id: idx, data: list[idx] };
}

function getPotionFuncs(itemData) {
    if (!itemData || itemData.type !== '소모품') return [];
    const list = Array.isArray(itemData.use_func) ? itemData.use_func : [];
    return list.filter(f => f && POTION_FUNC_TYPES.has(f.type));
}

function isPotionItem(itemData) {
    return getPotionFuncs(itemData).length > 0;
}

async function getAvailablePotions(name) {
    try {
        const user = await rpgenius.getRPGUserByName(name);
        if (!user) return [];
        const items = rpgenius.getDataCache('Item', []) || [];
        const out = [];
        for (const inv of (user.inventory && user.inventory.item) || []) {
            const data = items[inv.id];
            const funcs = getPotionFuncs(data);
            if (!funcs.length) continue;
            out.push({
                name: data.name,
                count: Number(inv.count || 0),
                desc: funcs.map(potionFuncDesc).filter(Boolean).join(', ')
            });
        }
        return out.sort((a, b) => a.name.localeCompare(b.name));
    } catch (e) {
        console.error('[partyquest] getAvailablePotions error:', e);
        return [];
    }
}

function potionFuncDesc(func) {
    if (!func) return '';
    if (func.type === '체력회복') return 'HP +' + func.amount;
    if (func.type === '마나회복') return 'MP +' + func.amount;
    if (func.type === '체력회복%') return 'HP +' + Math.round(Number(func.amount || 0) * 100) + '%';
    if (func.type === '마나회복%') return 'MP +' + Math.round(Number(func.amount || 0) * 100) + '%';
    return '';
}

async function consumePotionsFromInventory(user, items) {
    // 반환: { ok: true } | { error }
    if (!Array.isArray(items) || !items.length) return { ok: true };
    const itemList = rpgenius.getDataCache('Item', []) || [];
    const resolved = [];
    for (const it of items) {
        const idx = itemList.findIndex(d => d && d.name === it.name);
        if (idx < 0 || !isPotionItem(itemList[idx])) return { error: '존재하지 않는 물약입니다: ' + it.name };
        const have = rpgenius.getInventoryItemCount(user, idx);
        if (have < it.count) return { error: it.name + ' 보유량 부족 (' + have + '/' + it.count + ')' };
        resolved.push({ id: idx, name: it.name, count: it.count });
    }
    for (const r of resolved) rpgenius.removeInventoryItem(user, r.id, r.count);
    return { ok: true };
}

function refundPotionsToInventory(user, items) {
    if (!Array.isArray(items) || !items.length) return;
    const itemList = rpgenius.getDataCache('Item', []) || [];
    for (const it of items) {
        if (!it || !it.count || it.count <= 0) continue;
        const idx = itemList.findIndex(d => d && d.name === it.name);
        if (idx < 0) continue;
        rpgenius.addInventoryItem(user, idx, Number(it.count));
    }
}

async function usePotion(name, potionName) {
    const room = getRoomOf(name);
    if (!room) return { error: '참여 중인 파티가 없습니다.' };
    if (room.state !== 'inProgress') return { error: '진행 중이 아닙니다.' };
    if (isIntroActive(room)) return { error: '전투 시작 카운트다운 중입니다.' };
    const me = findMember(room, name);
    if (!me || me.runtime.dead) return { error: '행동할 수 없습니다.' };
    if (me.runtime.sealRemain > 0) return { error: '봉인 상태입니다.' };
    if (nowMs() < (me.runtime.potionUntil || 0)) return { error: '물약 쿨타임 중입니다.' };
    const slot = (me.potions || []).find(p => p.name === potionName);
    if (!slot || slot.count <= 0) return { error: '보유한 물약이 없습니다.' };
    const itemDef = getItemDef(potionName);
    if (!itemDef) return { error: '사용 불가한 물약입니다.' };
    const funcs = getPotionFuncs(itemDef.data);
    if (!funcs.length) return { error: '사용 불가한 물약입니다.' };
    const stats = (me.baseSnapshot && me.baseSnapshot.stats) || {};
    // 솔로 applyUseFunc와 동일: 물약 효율(potion) × 회복 효율(recoveryEfficiency)
    const potionMul = (1 + Number(stats.potion || 0)) * getPartyRecoveryMultiplier(me);
    const parts = [];
    for (const func of funcs) {
        if (func.type === '체력회복') {
            const amt = Math.max(1, Math.round(Number(func.amount || 0) * potionMul));
            parts.push('+' + healMember(me, amt) + ' HP');
        } else if (func.type === '마나회복') {
            const amt = Math.max(1, Math.round(Number(func.amount || 0) * potionMul));
            const before = me.runtime.mp;
            me.runtime.mp = Math.min(me.runtime.mpMax, me.runtime.mp + amt);
            parts.push('+' + (me.runtime.mp - before) + ' MP');
        } else if (func.type === '체력회복%') {
            const amt = Math.max(1, Math.round(me.runtime.hpMax * Number(func.amount || 0) * potionMul));
            parts.push('+' + healMember(me, amt) + ' HP');
        } else if (func.type === '마나회복%') {
            const amt = Math.max(1, Math.round(me.runtime.mpMax * Number(func.amount || 0) * potionMul));
            const before = me.runtime.mp;
            me.runtime.mp = Math.min(me.runtime.mpMax, me.runtime.mp + amt);
            parts.push('+' + (me.runtime.mp - before) + ' MP');
        }
    }
    const line = '🧪 ' + potionName + ' → ' + name + ' [' + parts.join(', ') + ']';
    slot.count -= 1;
    if (slot.count <= 0) me.potions = me.potions.filter(p => p !== slot);
    me.runtime.potionUntil = nowMs() + POTION_GLOBAL_CD * 1000;
    pushCombat(room, line, 'heal');
    broadcastRoom(room);
    return { ok: true };
}

function chat(name, text) {
    const room = getRoomOf(name);
    if (!room) return { error: '참여 중인 파티가 없습니다.' };
    const trimmed = String(text || '').slice(0, 500).trim();
    if (!trimmed) return { error: '내용이 비어있습니다.' };
    pushChat(room, name, trimmed);
    // 채팅 기믹: 전투 중 생존자의 발화만 집계
    const gimmick = room.state === 'inProgress' && room.monster && room.monster.bossState && room.monster.bossState.chatGimmick;
    if (gimmick) {
        const me = findMember(room, name);
        if (me && me.runtime && !me.runtime.dead) gimmick.responded.add(name);
    }
    return { ok: true };
}

function getRoomOf(name) {
    const id = memberIndex.get(name);
    if (!id) return null;
    return rooms.get(id) || null;
}

function getMyRoomSnapshot(name) {
    const room = getRoomOf(name);
    if (!room) return null;
    return serializeRoomForMember(room);
}

module.exports = {
    listQuestSummaries,
    publicRoomList,
    setCardImageResolver,
    createRoom,
    joinRoom,
    leaveRoom,
    setPosition,
    setReady,
    setPotions,
    start,
    restartQuest,
    attachStream,
    chat,
    attackMobPhase,
    useSkill,
    pickRandomSkill,
    castVote,
    useSupportSkill,
    getAvailablePotions,
    usePotion,
    getMyRoomSnapshot,
    getRoomOf,
    POSITION_LIST,
    __test: {
        preparePartyAttackUnits,
        computeBasicDamage,
        calculateOutgoingDamage,
        preparePartyTranscendSkill,
        applyTranscendAllyEffect,
        getPartyAttackBuffValue,
        getPartyAttackOrderPreview,
        usePartySelfDestruct,
        addMonsterDebuff,
        recordPartyJudgmentDamage,
        stepRoom,
        createPhaseMonster,
        setBossShield,
        clearBossShield,
        registerHpGimmicks,
        endBossGimmick,
        startBossCast,
        startVote,
        resolveVote,
        startChatGimmick,
        chatGimmickMajority,
        applySealToMember,
        addTakenDamageUpStack,
        getTakenDamageUpMul,
        applyElementalDotToMember,
        clearMemberDot,
        applyPlayerDamageToBoss,
        applyBossHpDamage,
        wipeParty,
        addSupportGauge,
        getQuestSupportSkills,
        grantPartyQuestPackReward,
        grantPartyQuestClearRewards,
        pickPartyQuestPackEntry,
        getPartyQuestItemAsset,
        applyBossGroggy,
        __moveMark: moveIngyeoMark,
        BOSS_HANDLERS
    }
};
