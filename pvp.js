// PVP — 비동기 대전 모듈.
// 상대는 방어 덱(카드 + AI 규칙)만 스냅샷으로 복제해 공격자 레코드 위에서 순수하게 시뮬레이션한다.
// 상대 레코드는 전투 중에는 절대 건드리지 않고, 종료 시 레이팅/전적만 상대 계정 큐로 반영한다.
const fs = require('fs');
const path = require('path');
const rpgenius = require('./rpgenius.js');
const combatEffects = require('./public/combat-effects.js');

const SKILLS_PATH = path.join(__dirname, 'DB', 'RPGenius', 'Skills.json');

const RATING_START = 1000;
const ELO_K = 32;
const DAILY_BATTLE_MAX = 5;
const DAILY_REFRESH_MAX = 2;
const COUNTDOWN_MS = 3000;
const BATTLE_LIMIT_MS = 120000;
const EVENT_KEEP = 60;
const HISTORY_MAX = 20;
const RULE_MAX = 8;
const LADDER_TTL_MS = 60000;
const SIVALON_BASIC_COOLDOWN_MS = 500;
const ACTION_COOLDOWN_MAX_MS = 3000;   // 행동 쿨 2~3초의 상한 (전투 시작 시 초기 쿨로 사용)
const DEFEND_DURATION_MS = 4000;       // 방어 지속 시간
const DEFEND_COOLDOWN_MS = 10000;      // 방어 재사용 대기
const START_COOLDOWN_CAP_MS = 60000;   // 전투 시작 시 스킬 초기 쿨 상한
const SUMMON_TICK_MS = { '익테봇': 4000, '수나타': 5000 }; // 솔로 타이머 간격과 동일
const MARK_TICK_MS = 2000;
const EQUIPMENT_DOT_TICK_MS = 2000;
const ADVANCE_STEP_LIMIT = 400;
const OPPONENT_KINDS = ['near', 'near', 'near', 'higher', 'random'];
const EXTRA_PLAY_MAX = 2;      // 하루 유료 추가 플레이 횟수
const EXTRA_PLAY_COST = 10;    // 1회당 가넷
// 플레이 보상 (승패 무관, 전투 1회 종료마다 1개): 확률 합 1
const PLAY_REWARD_TABLE = [
    { chance: .40, label: '카드팩 상자', pick: items => items.filter(item => item && item.name == '카드팩 상자') },
    { chance: .40, label: '랜덤 지렁이', pick: items => items.filter(item => item && item.type == '미끼' && String(item.name).includes('지렁이')) },
    { chance: .10, label: '랜덤 쥬얼', pick: items => items.filter(item => item && item.type == '티켓' && String(item.name).includes('쥬얼')) },
    { chance: .10, label: '지니어스의 열쇠', pick: items => items.filter(item => item && item.name == '지니어스의 열쇠') }
];

// ===== 상태 / 초기화 =====

let clock = () => Date.now();

// 테스트에서 시간을 앞으로 감기 위한 주입 훅
function __setNow(fn) {
    clock = typeof fn == 'function' ? fn : () => Date.now();
}

function now() {
    return Number(clock());
}

let injected = { serializeCard: null, getCharacterSprite: null, getItemAssets: null };

function configure(deps) {
    injected = {
        serializeCard: deps && deps.serializeCard || null,
        getCharacterSprite: deps && deps.getCharacterSprite || null,
        getItemAssets: deps && deps.getItemAssets || null
    };
}

function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function comma(value) {
    return String(Math.round(Number(value || 0))).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

let skillsCache = null;

function readSkills() {
    if (!skillsCache) {
        try {
            skillsCache = JSON.parse(fs.readFileSync(SKILLS_PATH, 'utf8'));
        } catch (e) {
            skillsCache = [];
        }
    }
    return skillsCache;
}

function ensurePvpState(user) {
    if (!user.pvp || typeof user.pvp != 'object') user.pvp = {};
    const state = user.pvp;
    if (typeof state.rating != 'number') state.rating = RATING_START;
    if (typeof state.wins != 'number') state.wins = 0;
    if (typeof state.losses != 'number') state.losses = 0;
    if (typeof state.defense == 'undefined') state.defense = null;
    if (typeof state.battle == 'undefined') state.battle = null;
    if (!Array.isArray(state.history)) state.history = [];
    const today = rpgenius.getKoreanDateKey(new Date(now()));
    if (!state.daily || state.daily.date != today) state.daily = { date: today, refreshUsed: 0, extraUsed: 0, opponents: [] };
    if (!Array.isArray(state.daily.opponents)) state.daily.opponents = [];
    if (typeof state.daily.extraUsed != 'number') state.daily.extraUsed = 0;
    return state;
}

function readRating(user) {
    return Number(user && user.pvp && user.pvp.rating != null ? user.pvp.rating : RATING_START);
}

function pushHistory(user, entry) {
    const state = ensurePvpState(user);
    state.history.unshift(entry);
    if (state.history.length > HISTORY_MAX) state.history.length = HISTORY_MAX;
}

// ===== 방어 덱 =====

const DEFAULT_RULES = [
    { cond: 'hpBelow', value: 30, action: 'defend', skill: null },
    { cond: 'skillReady', value: null, action: 'skill', skill: null },
    { cond: 'always', value: null, action: 'attack', skill: null }
];

const RULE_CONDS = ['always', 'hpBelow', 'hpAbove', 'enemyHpBelow', 'enemyHpAbove', 'mpBelow', 'skillReady', 'enemyDefending'];
const RULE_VALUE_CONDS = ['hpBelow', 'hpAbove', 'enemyHpBelow', 'enemyHpAbove', 'mpBelow'];
const RULE_ACTIONS = ['attack', 'skill', 'defend'];

// 프리셋과 동일하게 시그니처로 물리 카드를 하나씩 소거하며 매칭한다 (패션 일치 우선).
function makeCardTaker(user) {
    const pool = rpgenius.getAllUserCardsForPreset(user);
    return sig => {
        if (!sig) return null;
        let index = pool.findIndex(card => rpgenius.cardMatchesPresetSignature(card, sig, true));
        if (index < 0) index = pool.findIndex(card => rpgenius.cardMatchesPresetSignature(card, sig, false));
        if (index < 0) return null;
        return pool.splice(index, 1)[0];
    };
}

function equippedDeck(user) {
    return { mainCard: user.main_card || null, cardSlot: (Array.isArray(user.card_slot) ? user.card_slot : []).slice() };
}

// 저장된 방어 덱을 실제 카드로 해석한다. 메인 카드를 못 찾으면 장착 덱으로 대체하고 valid=false.
function resolveDefenseDeck(user) {
    const defense = user.pvp && user.pvp.defense;
    const rules = defense && Array.isArray(defense.rules) && defense.rules.length > 0 ? defense.rules : DEFAULT_RULES;
    const equipped = equippedDeck(user);
    if (!defense || !defense.mainCard) return { mainCard: equipped.mainCard, cardSlot: equipped.cardSlot, rules, useEquipped: true, valid: true };
    const take = makeCardTaker(user);
    const mainCard = take(defense.mainCard);
    if (!mainCard) return { mainCard: equipped.mainCard, cardSlot: equipped.cardSlot, rules, useEquipped: false, valid: false };
    const maxSlots = Number(user.maxCardSlot || 5);
    const cardSlot = (Array.isArray(defense.slotCards) ? defense.slotCards : []).map(take).filter(Boolean).slice(0, maxSlots);
    return { mainCard, cardSlot, rules, useEquipped: false, valid: true };
}

function validateRules(user, mainCard, rawRules) {
    if (!Array.isArray(rawRules)) return { error: '규칙 형식이 올바르지 않습니다.' };
    if (rawRules.length > RULE_MAX) return { error: '규칙은 최대 ' + RULE_MAX + '개까지 등록할 수 있습니다.' };
    const skillNames = new Set(rpgenius.getMainCardSkills({ main_card: mainCard }).map(entry => entry.skill.name));
    const rules = [];
    for (const raw of rawRules) {
        const cond = String(raw && raw.cond || '');
        const action = String(raw && raw.action || '');
        if (RULE_CONDS.indexOf(cond) < 0) return { error: '알 수 없는 조건입니다.' };
        if (RULE_ACTIONS.indexOf(action) < 0) return { error: '알 수 없는 행동입니다.' };
        let value = null;
        if (RULE_VALUE_CONDS.indexOf(cond) >= 0) {
            value = Number(raw && raw.value);
            if (!Number.isInteger(value) || value < 1 || value > 99) return { error: '조건 수치는 1~99 사이의 정수여야 합니다.' };
        }
        let skill = null;
        if (action == 'skill' && raw && raw.skill) {
            skill = String(raw.skill);
            if (!skillNames.has(skill)) return { error: '방어 덱 메인 카드의 스킬이 아닙니다.' };
        }
        rules.push({ cond, value, action, skill });
    }
    return { rules };
}

// 방어 덱 저장 검증. 카드 슬롯 규칙은 equipCharacterCardSlot과 동일하게 맞춘다.
function validateDefensePayload(user, payload) {
    const maxSlots = Number(user.maxCardSlot || 5);
    const useEquipped = !!(payload && payload.useEquipped);
    const rawSlots = Array.isArray(payload && payload.slotCards) ? payload.slotCards.filter(Boolean) : [];
    if (useEquipped) {
        const rules = validateRules(user, user.main_card, Array.isArray(payload && payload.rules) ? payload.rules : DEFAULT_RULES);
        if (rules.error) return rules;
        return { defense: { mainCard: null, slotCards: [], rules: rules.rules } };
    }
    if (!payload || !payload.mainCard) return { error: '방어 덱 메인 카드를 선택해주세요.' };
    if (rawSlots.length > maxSlots) return { error: '카드 슬롯은 최대 ' + maxSlots + '개까지 등록할 수 있습니다.' };
    const take = makeCardTaker(user);
    const mainCard = take(payload.mainCard);
    if (!mainCard) return { error: '메인 카드를 보유하고 있지 않습니다.' };
    const cardKey = card => Number(card.id) + ':' + (card.type || '일반');
    const keys = new Set([cardKey(mainCard)]);
    const slotCards = [];
    for (const sig of rawSlots) {
        const card = take(sig);
        if (!card) return { error: '카드 슬롯에 넣을 카드를 보유하고 있지 않습니다.' };
        if (Number(card.star || 0) < 4) return { error: '카드 슬롯에는 5성 이상 카드만 등록할 수 있습니다.' };
        if (keys.has(cardKey(card))) return { error: '같은 타입의 동일 캐릭터는 한 번만 등록할 수 있습니다.' };
        keys.add(cardKey(card));
        slotCards.push(card);
    }
    const rules = validateRules(user, mainCard, Array.isArray(payload.rules) ? payload.rules : DEFAULT_RULES);
    if (rules.error) return rules;
    return {
        defense: {
            mainCard: rpgenius.cardPresetSignature(mainCard),
            slotCards: slotCards.map(rpgenius.cardPresetSignature),
            rules: rules.rules
        }
    };
}

function saveDefense(user, payload) {
    ensurePvpState(user);
    const result = validateDefensePayload(user, payload);
    if (result.error) return { ok: false, message: result.error };
    user.pvp.defense = result.defense;
    return { ok: true, message: '방어 덱을 저장했습니다.', defense: buildDefenseView(user) };
}

// ===== 전투 스냅샷 =====

function buildDisplay(mainCard, user, skillEntries) {
    const serialize = injected.serializeCard;
    const card = serialize ? serialize(mainCard, user) : null;
    const metaByName = {};
    if (card) {
        const classSkills = card.classInfo && Array.isArray(card.classInfo.skills) ? card.classInfo.skills : [];
        [].concat(card.skills || [], classSkills).forEach(meta => {
            if (meta && meta.name && !metaByName[meta.name]) metaByName[meta.name] = meta;
        });
    }
    return {
        cardName: card && card.name || '',
        cardFormatted: card && card.formatted || '',
        cardImageUrl: card && card.imageUrl || null,
        cardStar: card ? Number(card.star || 0) : 0,
        cardType: card && card.type || '일반',
        cardSkin: card && card.skin || '',
        spriteUrl: injected.getCharacterSprite ? injected.getCharacterSprite(card) : null,
        skillsMeta: skillEntries.map(entry => {
            const meta = metaByName[entry.skill.name] || {};
            return {
                name: entry.skill.name,
                mpCost: Number(meta.mpCost || 0),
                cooltimeText: meta.cooltimeText || '',
                descLines: Array.isArray(meta.descLines) ? meta.descLines : []
            };
        })
    };
}

// 카드만 바꾼 플레인 클론으로 전투 수치를 뽑는다 (DB 기록 없음).
function buildSideSnapshot(user, deck) {
    const clone = Object.assign({}, user, { main_card: deck.mainCard, card_slot: deck.cardSlot, field: null, mp: undefined, hp: undefined });
    const skills = rpgenius.getMainCardSkills(clone);
    const statMeta = {};
    const stats = rpgenius.calculateUserStats(clone, statMeta);
    return {
        stats,
        staticAtkPlus: Number(statMeta.plusStats && statMeta.plusStats.atk || 0),
        slotEffects: rpgenius.calculateCardSlotEffects(clone),
        skillIndexes: skills.map(entry => Number(entry.index)),
        elementChain: rpgenius.getEquipmentElementChain(clone),
        equipment: rpgenius.getTranscendEquipmentSnapshot(clone, { includeAllActive: true }),
        passiveIds: Array.from(rpgenius.getEquippedPassiveIds(clone)),
        star: Number(deck.mainCard && deck.mainCard.star || 0),
        display: buildDisplay(deck.mainCard, clone, skills)
    };
}

// PVP 전용 체력 보정: 전투가 한두 방에 끝나지 않도록 최대 HP를 배수 적용
const PVP_HP_SCALE = 5;

function makeSide(user, snapshot, rules) {
    const maxHp = Math.max(1, Math.round(Number(snapshot.stats.hp || 0) * PVP_HP_SCALE));
    const maxMp = Math.max(0, Math.round(Number(snapshot.stats.mp || 0)));
    return {
        name: user.name,
        level: Number(user.level || 1),
        rating: readRating(user),
        userId: user.id != null ? user.id : null,
        snapshot,
        rules: rules || null,
        hp: maxHp,
        maxHp,
        mp: maxMp,
        maxMp,
        shield: null,
        defendUntil: 0,        // 방어 상태 종료 시각 (4초 지속)
        defendCooldownEnd: 0,  // 방어 재사용 가능 시각
        nextActionAt: 0,
        skillCooldowns: {},
        attackCount: 0,
        enteredAt: 0,
        runtime: { buffs: {}, nmmStacks: 0, sivalonCharge: 0, sivalon: null, gunryeok: null, summon: null, mark: null, equipment: {} }
    };
}

function sideSkills(side) {
    const skills = readSkills();
    return (side.snapshot.skillIndexes || []).map(index => skills[index]).filter(Boolean);
}

function findSideSkill(side, skillName) {
    return sideSkills(side).find(skill => skill.name == skillName) || null;
}

// ===== 방어 AI 규칙 =====

function skillMpCost(side, skill) {
    const stats = side.snapshot.stats;
    const slotEffects = side.snapshot.slotEffects;
    return Math.max(0, Math.round(Number(skill.mp_cost || 0) * (1 - Math.min(1, Number(slotEffects.mpCostReduction || 0))) * (1 + Number(stats.mpReduce || 0))));
}

function skillCooldownMs(side, skill) {
    const stats = side.snapshot.stats;
    return Math.max(0, (Number(skill.cooltime || 0) + Number(stats.skillCooldown || 0)) * Math.max(.2, 1 - Number(stats.cooldown || 0)));
}

function isDefending(side, t) {
    return Number(side.defendUntil || 0) > t;
}

function defendUsable(side, t) {
    return Number(side.defendCooldownEnd || 0) <= t;
}

function minimumSkillMpCost(side, skill, t) {
    if (equipmentStage(side, '불량 배터리')) return 0;
    const state = side.runtime && side.runtime.equipment || {};
    let multiplier = 1;
    if (equipmentStage(side, '썩어버린 물')) multiplier *= 1 + .06 * Math.min(3, Number(state.rottenWaterStacks || 0));
    if (equipmentSetCount(side, '딜레이') >= 4 && t - Number(state.lastSkillAt || side.enteredAt || t) >= 15000) multiplier *= 1.25;
    if (equipmentSetCount(side, '복선 회수') >= 4) {
        const nextOrder = equipmentStage(side, '리턴즈파겜') ? ((Number(state.attackCount || 0) + 1) % 3) + 1 : (Number(state.attackCount || 0) % 3) + 1;
        if (nextOrder == 1) multiplier *= .80;
    }
    return Math.max(0, Math.round(skillMpCost(side, skill) * multiplier));
}

function skillUsable(side, skill, t) {
    if (Number(side.skillCooldowns[skill.name] || 0) > t) return false;
    if (side.mp < minimumSkillMpCost(side, skill, t)) return false;
    if (skill.name == '시벌론' && Number(side.runtime.sivalonCharge || 0) < 5) return false;
    return true;
}

// 이름 지정이 없으면 궁극기 쪽(뒤)부터 사용 가능한 스킬을 고른다.
function pickAiSkill(side, skillName, t) {
    const skills = sideSkills(side);
    if (skillName) {
        const skill = skills.find(entry => entry.name == skillName);
        return skill && skillUsable(side, skill, t) ? skill.name : null;
    }
    for (let i = skills.length - 1; i >= 0; i--) {
        if (skillUsable(side, skills[i], t)) return skills[i].name;
    }
    return null;
}

function ruleConditionHolds(rule, actor, enemy, t) {
    const percent = Number(rule.value || 0);
    if (rule.cond == 'always') return true;
    if (rule.cond == 'hpBelow') return actor.hp / Math.max(1, actor.maxHp) * 100 <= percent;
    if (rule.cond == 'hpAbove') return actor.hp / Math.max(1, actor.maxHp) * 100 >= percent;
    if (rule.cond == 'enemyHpBelow') return enemy.hp / Math.max(1, enemy.maxHp) * 100 <= percent;
    if (rule.cond == 'enemyHpAbove') return enemy.hp / Math.max(1, enemy.maxHp) * 100 >= percent;
    if (rule.cond == 'mpBelow') return actor.mp / Math.max(1, actor.maxMp) * 100 <= percent;
    if (rule.cond == 'skillReady') return sideSkills(actor).some(skill => skillUsable(actor, skill, t));
    if (rule.cond == 'enemyDefending') return isDefending(enemy, t);
    return false;
}

function evaluateRules(actor, enemy, t) {
    const rules = Array.isArray(actor.rules) && actor.rules.length > 0 ? actor.rules : DEFAULT_RULES;
    for (const rule of rules) {
        if (!ruleConditionHolds(rule, actor, enemy, t)) continue;
        if (rule.action == 'skill') {
            const skillName = pickAiSkill(actor, rule.skill, t);
            if (!skillName) continue;
            return { action: 'skill', skillName };
        }
        if (rule.action == 'defend' && !defendUsable(actor, t)) continue; // 방어 쿨타임 중이면 다음 규칙으로
        return { action: rule.action, skillName: null };
    }
    return { action: 'attack', skillName: null };
}

// ===== 전투 엔진 =====

function pushEvent(battle, event) {
    battle.seq += 1;
    battle.events.push(combatEffects.annotateEvent(Object.assign({ seq: battle.seq, damage: 0, criticalCount: 0, hitCount: 0, dodged: false, absorbed: 0 }, event)));
    if (battle.events.length > EVENT_KEEP) battle.events.splice(0, battle.events.length - EVENT_KEEP);
}

function actionCooldownMs(side, isBasic, t) {
    if (isBasic && side.runtime.sivalon && Number(side.runtime.sivalon.until || 0) > t) return SIVALON_BASIC_COOLDOWN_MS;
    return randomInt(2000, 3000);
}

// 만료 처리는 지연 평가한다. 항상 처리 시각 t를 넘겨 캐치업 순서가 어긋나지 않게 한다.
function expireSide(side, t) {
    const runtime = side.runtime;
    Object.keys(runtime.buffs).forEach(key => {
        const buff = runtime.buffs[key];
        if (buff && buff.until != null && Number(buff.until) <= t) delete runtime.buffs[key];
    });
    if (runtime.sivalon && Number(runtime.sivalon.until || 0) <= t) runtime.sivalon = null;
    if (runtime.gunryeok && Number(runtime.gunryeok.until || 0) <= t) clearGunryeok(side);
    // 소환수/표식은 만료 시각과 같은 시점의 마지막 틱까지 살려둔다 (틱 처리 직전 만료로 사라지지 않도록)
    if (runtime.summon && Number(runtime.summon.until || 0) < t) runtime.summon = null;
    if (runtime.mark && Number(runtime.mark.until || 0) < t) runtime.mark = null;
    if (side.shield && Number(side.shield.until || 0) <= t) side.shield = null;
}

function expireStates(battle, t) {
    expireSide(battle.me, t);
    expireSide(battle.opp, t);
}

function clearGunryeok(side) {
    const state = side.runtime.gunryeok;
    if (!state) return;
    side.maxHp = Number(state.maxHpBefore || side.maxHp);
    side.hp = Math.min(side.hp, side.maxHp);
    side.runtime.gunryeok = null;
}

function receivedDamageReduction(side, attacker) {
    const buff = side.runtime.buffs.receivedDamageReduction;
    const gunryeok = side.runtime.gunryeok;
    const stats = side.snapshot.stats || {};
    const hpRatio = side.hp / Math.max(1, side.maxHp);
    const targetHpRatio = attacker ? attacker.hp / Math.max(1, attacker.maxHp) : 1;
    const bloodFlow = hpRatio <= .50 ? Number(stats.bloodFlowReduction || 0) * (hpRatio <= .30 ? 2 : 1) : 0;
    const ultimatumArmor = targetHpRatio <= .50 && equipmentStage(side, '최후통첩 아머')
        ? equipmentStep(side, '최후통첩 아머', .10, .04)
        : 0;
    return Number(buff && buff.value || 0) + Number(gunryeok && gunryeok.dmgReduce || 0) + bloodFlow + ultimatumArmor;
}

function receivedDamageMul(side) {
    const buff = side.runtime.buffs.receivedDamageMul;
    return buff ? Math.max(0, Number(buff.value || 1)) : 1;
}

function attackElementOf(side, skill) {
    const chain = side.snapshot.elementChain || {};
    if (chain.weapon) return chain.weapon;
    if (skill && skill.element && rpgenius.ELEMENT_ATK_KEYS[skill.element]) return skill.element;
    return chain.rest || null;
}

function equipmentRuntime(side) {
    if (!side.runtime.equipment || typeof side.runtime.equipment != 'object') side.runtime.equipment = {};
    return side.runtime.equipment;
}

function equipmentStage(side, name) {
    const entries = side.snapshot.equipment && Array.isArray(side.snapshot.equipment.entries) ? side.snapshot.equipment.entries : [];
    const found = entries.find(entry => entry && entry.name == name);
    return found ? Math.max(1, Number(found.stage || 1)) : 0;
}

function hasEquipmentPassive(side, passiveId) {
    return Array.isArray(side.snapshot.passiveIds) && side.snapshot.passiveIds.includes(Number(passiveId));
}

function isUltimateSkill(side, skill) {
    const skills = sideSkills(side);
    return !!(skill && skills.length > 0 && skills[skills.length - 1].name == skill.name);
}

function equipmentSetCount(side, setName) {
    return Number(side.snapshot.equipment && side.snapshot.equipment.setCounts && side.snapshot.equipment.setCounts[setName] || 0);
}

function equipmentStep(side, name, base, perStage) {
    return Number(base || 0) + Number(perStage || 0) * Math.max(0, equipmentStage(side, name) - 1);
}

function equipmentCooldownMs(side, seconds) {
    return Math.max(0, Number(seconds || 0) - Number(side.snapshot.stats.equipmentEffectCooldownFlat || 0)) * 1000;
}

function equipmentDurationMs(side, seconds) {
    return (Number(seconds || 0) + Number(side.snapshot.stats.equipmentEffectDurationFlat || 0)) * 1000;
}

function markTriggeredEffect(extra, kind, name) {
    if (!extra || !name) return;
    if (!Array.isArray(extra.triggeredEffectIds)) extra.triggeredEffectIds = [];
    const effectId = combatEffects.id(kind, name);
    if (!extra.triggeredEffectIds.includes(effectId)) extra.triggeredEffectIds.push(effectId);
}

// 필드는 매 행동/틱마다 calculateUserStats를 다시 호출해 이미 활성 중인 장비 버프를 스탯에 합산한다.
// PVP는 스냅샷을 유지하므로 같은 동적 스탯만 현재 시각 기준으로 복원한다.
function getLiveEquipmentStats(side, t) {
    const stats = Object.assign({}, side.snapshot.stats || {});
    const state = side.runtime && side.runtime.equipment || {};
    const active = key => state[key] && Number(state[key].until || 0) > t ? state[key] : null;
    const manaAttack = active('manaBurnAttackBuff');
    const manaElement = active('manaBurnElementBuff');
    const manaCrit = active('manaBurnCritBuff');
    const manaExtra = active('manaBurnExtraBuff');
    const coin = active('coinBuff');
    const encore = active('encoreBuff');
    const bloodHat = active('bloodHatBuff');
    const liberation = active('liberationBuff');
    const dynamicAtkPlus = Number(manaAttack && manaAttack.value || 0)
        + Number(encore && encore.attack || 0)
        + Number(bloodHat && bloodHat.value || 0);
    if (dynamicAtkPlus != 0) {
        const staticAtkPlus = Number(side.snapshot.staticAtkPlus || 0);
        const baseMultiplier = 1 + staticAtkPlus;
        const liveMultiplier = 1 + staticAtkPlus + dynamicAtkPlus;
        stats.atk = Math.max(0, Math.round(Number(stats.atk || 0) * (Math.abs(baseMultiplier) > .0001 ? liveMultiplier / baseMultiplier : 1 + dynamicAtkPlus)));
    }
    if (manaElement) stats.allElementAtk = Number(stats.allElementAtk || 0) + Number(manaElement.value || 0);
    if (manaCrit) stats.crit = Number(stats.crit || 0) + Number(manaCrit.value || 0);
    if (manaExtra) stats.extraDamage = Number(stats.extraDamage || 0) + Number(manaExtra.value || 0);
    if (coin && coin.type == 'water') stats.waterAtk = Number(stats.waterAtk || 0) + Number(coin.value || 0);
    if (coin && coin.type == 'crit') stats.crit = Number(stats.crit || 0) + Number(coin.value || 0);
    if (encore) stats.critMul = Number(stats.critMul || 0) + Number(encore.critMul || 0);
    if (liberation && (liberation.choices || []).includes('element')) stats.allElementAtk = Number(stats.allElementAtk || 0) + Number(liberation.elementValue || 0);
    if (liberation && (liberation.choices || []).includes('resist')) stats.allElementRes = Number(stats.allElementRes || 0) + Number(liberation.resistValue || 0);
    return stats;
}

function prepareEquipmentAttack(actor, target, extra, t) {
    if (extra.summonAttack || extra.dotAttack || extra.disableEquipmentBonusDamage) return;
    const state = equipmentRuntime(actor);
    const stats = extra.combatStats || getLiveEquipmentStats(actor, t);
    const skill = extra.skill || null;
    const actionType = extra.isSkill ? 'skill' : 'basic';
    const attackElement = attackElementOf(actor, skill);
    extra.attackElement = attackElement;
    const targetHpRatio = target.hp / Math.max(1, target.maxHp);
    const hpRatio = actor.hp / Math.max(1, actor.maxHp);
    const mpRatio = actor.mp / Math.max(1, actor.maxMp);
    const active = key => !!(state[key] && Number(state[key].until || 0) > t);
    const add = (key, value) => { extra[key] = Number(extra[key] || 0) + Number(value || 0); };
    const includedAtStart = {
        manaBurnAttackBuff: active('manaBurnAttackBuff'),
        manaBurnElementBuff: active('manaBurnElementBuff'),
        manaBurnCritBuff: active('manaBurnCritBuff'),
        manaBurnExtraBuff: active('manaBurnExtraBuff'),
        coinBuff: active('coinBuff'),
        encoreBuff: active('encoreBuff'),
        bloodHatBuff: active('bloodHatBuff'),
        liberationBuff: active('liberationBuff')
    };
    [
        ['manaBurnAttackBuff', '마나번 햇'], ['manaBurnElementBuff', equipmentStage(actor, '현자의 마나번 로브') ? '현자의 마나번 로브' : '마나번 로브'],
        ['manaBurnCritBuff', '마나번 트라우저'], ['manaBurnExtraBuff', '마나번 슈즈'],
        ['coinBuff', '일레이나 전용 동전'], ['encoreBuff', '앵콜'], ['bloodHatBuff', '핏빛 모자'], ['liberationBuff', '해방의 열쇠']
    ].forEach(([key, name]) => { if (includedAtStart[key]) markTriggeredEffect(extra, 'equipment', name); });

    if (active('culprit')) { add('finalDamageBonus', state.culprit.takenFinalDamage); add('defReductionBonus', state.culprit.defReduction); markTriggeredEffect(extra, 'equipment', '피의 서약'); }
    if (active('fortuneExtraDamage')) { add('extraDamageBonus', state.fortuneExtraDamage.value); markTriggeredEffect(extra, 'equipment', '행운의 복주머니'); }
    if (active('ultimatumHatBuff')) { add('damageBonusMul', Number(state.ultimatumHatBuff.value || 0) * (1 + Number(stats.attackBuffEfficiency || 0))); markTriggeredEffect(extra, 'equipment', '최후통첩 모자'); }
    if (active('deepWaterAttackBuff') && attackElement == '수') { add('finalDamageBonus', state.deepWaterAttackBuff.value); markTriggeredEffect(extra, 'equipment', '심해의 모자'); }
    if (active('darkAttackBuff') && attackElement == '암') { add('finalDamageBonus', state.darkAttackBuff.value); markTriggeredEffect(extra, 'equipment', '심연의 신발'); }
    if (active('blackEchoShoesBuff') && attackElement == '암') { add('extraDamageBonus', state.blackEchoShoesBuff.value); markTriggeredEffect(extra, 'equipment', '검은 잔향 신발'); }
    const attackBuffEfficiency = 1 + Number(stats.attackBuffEfficiency || 0);
    if (actor.runtime.summon && Number(actor.runtime.summon.until || 0) > t && Number(actor.runtime.summon.buff || 0) != 0) { add('damageBonusMul', Number(actor.runtime.summon.buff) * attackBuffEfficiency); markTriggeredEffect(extra, 'summon', '수나타 강화'); }
    if (actor.runtime.gunryeok && Number(actor.runtime.gunryeok.until || 0) > t && Number(actor.runtime.gunryeok.atkBuff || 0) != 0) { add('damageBonusMul', Number(actor.runtime.gunryeok.atkBuff) * attackBuffEfficiency); markTriggeredEffect(extra, 'skill', '건력'); }
    if (hasEquipmentPassive(actor, 4) && mpRatio >= .75) { add('finalDamageBonus', .05); markTriggeredEffect(extra, 'equipment', '마력 감응'); }
    if (Number(state.beomStacksUntil || 0) > t && Number(state.beomStacks || 0) > 0 && attackElement == '명') { add('finalDamageBonus', Math.min(7, Number(state.beomStacks)) * .02); markTriggeredEffect(extra, 'equipment', '범부의 대나무'); }
    if (Number(state.trueBeomUntil || 0) > t) {
        add('damageBonusMul', equipmentStep(actor, '범부의 대나무', .30, .05) * (1 + Number(stats.attackBuffEfficiency || 0)));
        if (actionType == 'skill') add('extraDamageBonus', equipmentStep(actor, '범부의 대나무', .30, .10));
        markTriggeredEffect(extra, 'equipment', '범부의 대나무');
    }

    if (actionType == 'skill' && equipmentStage(actor, '감옥열쇠')) { const overflow = Math.max(0, Number(stats.crit || 0) - 1); add('damageBonusMul', overflow * equipmentStep(actor, '감옥열쇠', .20, .10)); if (overflow > 0) markTriggeredEffect(extra, 'equipment', '감옥열쇠'); }
    if (actionType == 'skill' && isUltimateSkill(actor, skill)) add('damageBonusMul', Number(stats.ultimateDamage || 0));
    if (actionType == 'skill' && skill && skill.name == '끝판왕' && equipmentStage(actor, 'Lv1 초보')) {
        add('damageBonusMul', equipmentStep(actor, 'Lv1 초보', 1.30, .40));
        if (hpRatio <= .30) add('finalDamageBonus', equipmentStep(actor, 'Lv1 초보', .40, .15));
        markTriggeredEffect(extra, 'equipment', 'Lv1 초보');
    }
    if (actionType == 'skill' && skill && skill.name == '청정수 투척' && equipmentStage(actor, '정수 필터망')) {
        add('pntBonus', equipmentStep(actor, '정수 필터망', 25, 10));
        state.cleanWaterBuff = { value: equipmentStep(actor, '정수 필터망', .08, .03), until: t + equipmentDurationMs(actor, 6) };
        markTriggeredEffect(extra, 'equipment', '정수 필터망');
    }
    if (active('cleanWaterBuff') && attackElement == '수') { add('finalDamageBonus', state.cleanWaterBuff.value); markTriggeredEffect(extra, 'equipment', '정수 필터망'); }
    if (actionType == 'skill' && skill && skill.name == '댄져' && equipmentStage(actor, '썩어버린 물')) {
        if (Math.min(3, Number(state.rottenWaterStacks || 0)) >= 3) add('extraDamageBonus', .20);
        state.rottenWaterStacks = 0;
        markTriggeredEffect(extra, 'equipment', '썩어버린 물');
    }
    if (actionType == 'skill' && skill && skill.name == '비리' && equipmentStage(actor, '치명적인 매력')) {
        add('critChanceBonus', -Math.max(0, Number(stats.crit || 0)));
        add('critMulBonus', Math.max(0, Number(stats.crit || 0)) * equipmentStep(actor, '치명적인 매력', .70, .15));
        markTriggeredEffect(extra, 'equipment', '치명적인 매력');
    }
    if (actionType == 'skill' && skill && skill.name == '비리' && equipmentStage(actor, '비리의 맛')) {
        state.bribeNextBasic = { damage: equipmentStep(actor, '비리의 맛', .40, .12), darkBonus: equipmentStep(actor, '비리의 맛', .65, .15) };
        markTriggeredEffect(extra, 'equipment', '비리의 맛');
    }
    if (actionType == 'basic' && state.bribeNextBasic) {
        extra.rawDamageMultiplier = 1 + Number(state.bribeNextBasic.damage || 0);
        extra.bribeDarkBonus = Number(state.bribeNextBasic.darkBonus || 0);
        state.bribeNextBasic = null;
        markTriggeredEffect(extra, 'equipment', '비리의 맛');
    }
    if (actionType == 'skill' && active('burn')) {
        const mythicBurnShoes = equipmentStage(actor, '종말을 걷는 장송곡');
        const emberShoes = equipmentStage(actor, '잿불 신발');
        const readyKey = mythicBurnShoes ? 'mythicBurnShoesReadyAt' : 'emberShoesReadyAt';
        const cooldown = mythicBurnShoes ? 8 : 10;
        if ((mythicBurnShoes || emberShoes) && t >= Number(state[readyKey] || 0)) {
            const nextTickAt = Math.max(t, Number(state.burn.nextTickAt || t));
            const remainingTicks = Math.max(0, Math.floor((Number(state.burn.until || 0) - nextTickAt) / EQUIPMENT_DOT_TICK_MS) + 1);
            const detonationRate = mythicBurnShoes ? 1 : equipmentStep(actor, '잿불 신발', .60, .10);
            extra.oneTimeFinalDamage = Number(extra.oneTimeFinalDamage || 0) + Math.round(Number(state.burn.tickDamage || 0) * remainingTicks * detonationRate);
            extra.oneTimeFinalDamageLabel = mythicBurnShoes ? '종말 화상 폭발' : '화상 폭발';
            markTriggeredEffect(extra, 'equipment', mythicBurnShoes ? '종말을 걷는 장송곡' : '잿불 신발');
            state.burn = null;
            state[readyKey] = t + equipmentCooldownMs(actor, cooldown);
            if (mythicBurnShoes) {
                state.hellfire = { tickDamage: Math.max(1, Math.round(Number(stats.atk || 0) * .50)), nextTickAt: t + EQUIPMENT_DOT_TICK_MS, until: t + 6000 };
                markTriggeredEffect(extra, 'combat', '겁화 부여');
            }
        }
    }
    if (equipmentStage(actor, '진사이') && hpRatio <= .20) { add('finalDamageBonus', equipmentStep(actor, '진사이', .30, .05)); markTriggeredEffect(extra, 'equipment', '진사이'); }
    if (hpRatio <= .50) {
        add('extraDamageBonus', Number(stats.bloodyShoesExtraDamage || 0) + Number(stats.vladimirExtraDamage || 0));
        if (Number(stats.bloodyShoesExtraDamage || 0) > 0) markTriggeredEffect(extra, 'equipment', '블러디 슈즈');
        if (Number(stats.vladimirExtraDamage || 0) > 0) markTriggeredEffect(extra, 'equipment', '블라디미르');
    }
    if (actionType == 'skill' && hpRatio <= .60 && Number(stats.blackEchoSkillDamage || 0) > 0) {
        const currentSkillMul = Math.max(.01, 1 + Number(stats.afterSkill || 0));
        extra.rawDamageMultiplier = Number(extra.rawDamageMultiplier || 1) * ((currentSkillMul + Number(stats.blackEchoSkillDamage)) / currentSkillMul);
        markTriggeredEffect(extra, 'equipment', '검은 잔향 하의');
    }
    if (actor.shield && Number(actor.shield.amount || 0) > 0 && equipmentStage(actor, '강릉함씨 32대손')) { add('damageBonusMul', equipmentStep(actor, '강릉함씨 32대손', .18, .05)); markTriggeredEffect(extra, 'equipment', '강릉함씨 32대손'); }
    if (equipmentSetCount(actor, '최후 통첩') >= 4) {
        if (targetHpRatio >= .70) add('finalDamageBonus', .10);
        if (targetHpRatio <= .30) add('finalDamageBonus', .18);
        if (targetHpRatio >= .70 || targetHpRatio <= .30) markTriggeredEffect(extra, 'set', '최후 통첩');
    }
    if (targetHpRatio <= .60 && equipmentStage(actor, '정복자의 최후통첩')) { add('finalDamageBonus', .20); markTriggeredEffect(extra, 'equipment', '정복자의 최후통첩'); }
    if (targetHpRatio <= .30 && equipmentStage(actor, '최후통첩 트라우저')) { add('pntBonus', equipmentStep(actor, '최후통첩 트라우저', 150, 40)); markTriggeredEffect(extra, 'equipment', '최후통첩 트라우저'); }
    if (targetHpRatio <= .30 && equipmentStage(actor, '최후통첩 슈즈')) { add('extraDamageBonus', equipmentStep(actor, '최후통첩 슈즈', .20, .05)); markTriggeredEffect(extra, 'equipment', '최후통첩 슈즈'); }
    if (targetHpRatio <= .50 && equipmentStage(actor, '최후통첩 모자') && t >= Number(state.ultimatumHatReadyAt || 0)) {
        state.ultimatumHatBuff = { value: equipmentStep(actor, '최후통첩 모자', .15, .04), until: t + equipmentDurationMs(actor, 8) };
        state.ultimatumHatReadyAt = t + equipmentCooldownMs(actor, 12);
        add('damageBonusMul', Number(state.ultimatumHatBuff.value || 0) * (1 + Number(stats.attackBuffEfficiency || 0)));
        markTriggeredEffect(extra, 'equipment', '최후통첩 모자');
    }
    if (equipmentStage(actor, '과소평가')) {
        const elapsed = t - Number(actor.enteredAt || t);
        add('damageBonusMul', elapsed < 10000 ? -.15 : equipmentStep(actor, '과소평가', .25, .08));
        if (elapsed >= 10000) add('critMulBonus', equipmentStep(actor, '과소평가', .20, .06));
        markTriggeredEffect(extra, 'equipment', '과소평가');
    }
    if (equipmentStage(actor, '마나 증폭 장치')) {
        if (mpRatio > .20) add('damageBonusMul', Number(stats.manaAmplifierFinalAtk || equipmentStep(actor, '마나 증폭 장치', .10, .06)));
        if (mpRatio >= .50) add('extraDamageBonus', equipmentStep(actor, '마나 증폭 장치', .08, .04));
        if (mpRatio > .20) markTriggeredEffect(extra, 'equipment', '마나 증폭 장치');
    }
    if (equipmentStage(actor, '포상 정산 반지')) {
        const diff = Math.abs(hpRatio - mpRatio);
        if (diff >= .30) add('damageBonusMul', equipmentStep(actor, '포상 정산 반지', .12, .04));
        if (diff >= .50) add('finalDamageBonus', equipmentStep(actor, '포상 정산 반지', .16, .04));
        if (diff >= .30) markTriggeredEffect(extra, 'equipment', '포상 정산 반지');
        if (!state.settlementRecoveryAt) state.settlementRecoveryAt = Number(actor.enteredAt || t) + 4000;
        if (t >= Number(state.settlementRecoveryAt || 0)) {
            const ticks = Math.floor((t - Number(state.settlementRecoveryAt)) / 4000) + 1;
            if (hpRatio < mpRatio) actor.hp = Math.min(actor.maxHp, actor.hp + Math.max(1, Math.round(actor.maxHp * .01 * ticks * (1 + Number(stats.recoveryEfficiency || 0)))));
            else if (mpRatio < hpRatio) actor.mp = Math.min(actor.maxMp, actor.mp + Math.max(1, Math.round(actor.maxMp * .01 * ticks)));
            state.settlementRecoveryAt += ticks * 4000;
            markTriggeredEffect(extra, 'equipment', '포상 정산 반지');
        }
    }
    if (equipmentStage(actor, '심연의 신발') && hpRatio <= .50 && active('abyssBuff')) { add('damageBonusMul', .08); markTriggeredEffect(extra, 'equipment', '심연의 신발'); }
    if (actionType == 'basic' && Number(state.deepNextBasic || 0) > 0) { extra.deepWaterBonus = Number(state.deepNextBasic); state.deepNextBasic = 0; markTriggeredEffect(extra, 'equipment', '심해의 모자'); }
    if (actionType == 'basic' && equipmentStage(actor, '쿨다운 목걸이')) {
        const skills = sideSkills(actor);
        if (skills.length > 0 && skills.every(entry => Number(actor.skillCooldowns[entry.name] || 0) > t)) {
            add('damageBonusMul', equipmentStep(actor, '쿨다운 목걸이', .12, .03));
            extra.rawDamageMultiplier = Number(extra.rawDamageMultiplier || 1) * (1 + equipmentStep(actor, '쿨다운 목걸이', .35, .10));
            actor.hp = Math.min(actor.maxHp, actor.hp + Math.max(1, Math.round(actor.maxHp * .001 * Math.max(1, Number(extra.attackUnitCount || 1)) * (1 + Number(stats.recoveryEfficiency || 0)))));
            markTriggeredEffect(extra, 'equipment', '쿨다운 목걸이');
            markTriggeredEffect(extra, 'combat', 'HP 회복');
        }
    }
    const manaBurn = [
        ['마나번 햇', 'manaBurnAttackBuff', .02, 'damageBonusMul', equipmentStep(actor, '마나번 햇', .15, .03) * (1 + Number(stats.attackBuffEfficiency || 0))],
        ['마나번 로브', 'manaBurnElementBuff', .02, 'allElementAtk', equipmentStep(actor, '마나번 로브', 60, 10)],
        ['마나번 트라우저', 'manaBurnCritBuff', .02, 'critChanceBonus', equipmentStep(actor, '마나번 트라우저', .10, .02)],
        ['마나번 슈즈', 'manaBurnExtraBuff', .02, 'extraDamageBonus', equipmentStep(actor, '마나번 슈즈', .10, .03)],
        ['현자의 마나번 로브', 'manaBurnElementBuff', .01, 'allElementAtk', 100]
    ];
    for (const [name, buffKey, costRate, modifierKey, value] of manaBurn) {
        if (!equipmentStage(actor, name)) continue;
        const readyKey = buffKey + 'ReadyAt';
        if (t >= Number(state[readyKey] || 0)) {
            const cost = Math.max(1, Math.round(Number(actor.maxMp || 0) * costRate));
            if (actor.mp >= cost) {
                actor.mp -= cost;
                state[buffKey] = { value, until: t + equipmentDurationMs(actor, 60) };
                state[readyKey] = t + equipmentCooldownMs(actor, 60);
                markTriggeredEffect(extra, 'equipment', name);
                markTriggeredEffect(extra, 'set', '마나번');
                markTriggeredEffect(extra, 'combat', 'MP 소모');
            }
        }
        const buff = state[buffKey];
        if (!includedAtStart[buffKey] && buff && Number(buff.until || 0) > t) {
            if (modifierKey == 'allElementAtk') extra.equipmentAllElementAtk = Number(extra.equipmentAllElementAtk || 0) + Number(buff.value || 0);
            else extra[modifierKey] = Number(extra[modifierKey] || 0) + Number(buff.value || 0);
            markTriggeredEffect(extra, 'equipment', name);
        }
    }
    const attackUnitCount = Math.max(1, Number(extra.attackUnitCount || 1));
    if (attackUnitCount > 1) {
        if (equipmentStage(actor, '유랄 목걸이')) markTriggeredEffect(extra, 'equipment', '유랄 목걸이');
        if (equipmentStage(actor, '유랄 장갑')) markTriggeredEffect(extra, 'equipment', '유랄 장갑');
        if (equipmentStage(actor, '유생의 개지랄')) markTriggeredEffect(extra, 'equipment', '유생의 개지랄');
        if (equipmentSetCount(actor, '유랄') >= 2) markTriggeredEffect(extra, 'set', '유랄');
    }
    const perAttackUnitExtras = Array.from({ length: attackUnitCount }, () => ({}));
    const addUnit = (unit, key, value) => { perAttackUnitExtras[unit][key] = Number(perAttackUnitExtras[unit][key] || 0) + Number(value || 0); };
    let rainbowTriggeredUnit = -1;
    for (let unit = 0; unit < attackUnitCount; unit++) {
        if (Number(state.flowingBloodNext || 0) > 0) { addUnit(unit, 'finalDamageBonus', state.flowingBloodNext); state.flowingBloodNext = 0; markTriggeredEffect(extra, 'equipment', '흐르는 피'); }
        if (equipmentStage(actor, '핏빛 모자') && t >= Number(state.bloodHatReadyAt || 0)) {
            const cost = Math.max(1, Math.floor(actor.hp * .03));
            actor.hp = Math.max(1, actor.hp - cost);
            state.bloodHatBuff = { value: equipmentStep(actor, '핏빛 모자', .18, .04) * (1 + Number(stats.attackBuffEfficiency || 0)), until: t + equipmentDurationMs(actor, 15) };
            state.bloodHatReadyAt = t + equipmentCooldownMs(actor, 15);
            if (equipmentStage(actor, '흐르는 피')) state.flowingBloodNext = equipmentStep(actor, '흐르는 피', .12, .04);
            markTriggeredEffect(extra, 'equipment', '핏빛 모자');
            markTriggeredEffect(extra, 'combat', '자해');
            if (equipmentStage(actor, '흐르는 피')) markTriggeredEffect(extra, 'equipment', '흐르는 피');
        }
        if (!includedAtStart.bloodHatBuff && active('bloodHatBuff')) addUnit(unit, 'damageBonusMul', state.bloodHatBuff.value);
        if (equipmentStage(actor, '일레이나 전용 동전') && t >= Number(state.coinReadyAt || 0)) {
            state.coinBuff = Math.random() < .5
                ? { type: 'water', value: equipmentStep(actor, '일레이나 전용 동전', 250, 50), until: t + equipmentDurationMs(actor, 300) }
                : { type: 'crit', value: equipmentStep(actor, '일레이나 전용 동전', .20, .05), until: t + equipmentDurationMs(actor, 300) };
            state.coinReadyAt = t + equipmentCooldownMs(actor, 300);
            markTriggeredEffect(extra, 'equipment', '일레이나 전용 동전');
        }
        if (!includedAtStart.coinBuff && state.coinBuff && Number(state.coinBuff.until || 0) > t) {
            if (state.coinBuff.type == 'water') addUnit(unit, 'waterAtk', state.coinBuff.value);
            else addUnit(unit, 'critChanceBonus', state.coinBuff.value);
        }
        if (equipmentStage(actor, '메가카운트 추첨기')) {
            // 골드 결과는 전투 경제에 반영하지 않되, 원본 4종 추첨 확률은 유지한다.
            const pool = ['extra', 'final', 'mp', 'gold'];
            const picked = [];
            const count = equipmentSetCount(actor, 'TCG의 유산') >= 4 ? 2 : 1;
            while (picked.length < count) {
                const choice = pool[randomInt(0, pool.length - 1)];
                if (!picked.includes(choice)) picked.push(choice);
            }
            picked.forEach(choice => {
                if (choice == 'extra') addUnit(unit, 'extraDamageBonus', equipmentStep(actor, '메가카운트 추첨기', .15, .05));
                if (choice == 'final') addUnit(unit, 'finalDamageBonus', equipmentStep(actor, '메가카운트 추첨기', .15, .05));
                if (choice == 'mp') actor.mp = Math.min(actor.maxMp, actor.mp + Math.max(1, Math.round(actor.maxMp * equipmentStep(actor, '메가카운트 추첨기', .005, .005))));
                if (choice == 'gold' && equipmentStage(actor, '행운의 복주머니')) state.fortuneExtraDamage = { value: equipmentStep(actor, '행운의 복주머니', .10, .05), until: t + equipmentDurationMs(actor, 10) };
            });
            markTriggeredEffect(extra, 'equipment', '메가카운트 추첨기');
            if (equipmentSetCount(actor, 'TCG의 유산') >= 4) markTriggeredEffect(extra, 'set', 'TCG의 유산');
        }
        if (equipmentStage(actor, '해방의 열쇠') && t >= Number(state.liberationReadyAt || 0)) {
            const pool = ['element', 'attack', 'resist'];
            const choices = [];
            const count = equipmentSetCount(actor, 'TCG의 유산') >= 4 ? 2 : 1;
            while (choices.length < count) { const choice = pool[randomInt(0, pool.length - 1)]; if (!choices.includes(choice)) choices.push(choice); }
            state.liberationBuff = { choices, elementValue: equipmentStep(actor, '해방의 열쇠', 70, 20), resistValue: equipmentStep(actor, '해방의 열쇠', 80, 20), until: t + equipmentDurationMs(actor, 10) };
            state.liberationReadyAt = t + equipmentCooldownMs(actor, 15);
            markTriggeredEffect(extra, 'equipment', '해방의 열쇠');
            if (equipmentSetCount(actor, 'TCG의 유산') >= 4) markTriggeredEffect(extra, 'set', 'TCG의 유산');
        }
        if (state.liberationBuff && Number(state.liberationBuff.until || 0) > t) {
            const choices = state.liberationBuff.choices || [];
            if (choices.includes('attack')) addUnit(unit, 'damageBonusMul', equipmentStep(actor, '해방의 열쇠', .10, .03) * (1 + Number(stats.attackBuffEfficiency || 0)));
            if (!includedAtStart.liberationBuff && choices.includes('element')) addUnit(unit, 'allElementAtk', state.liberationBuff.elementValue);
        }
        if (equipmentStage(actor, '킹메이커 팔찌')) {
            state.kingmakerDefenseDebuff = { value: equipmentStep(actor, '킹메이커 팔찌', .10, .02), until: t + equipmentDurationMs(actor, 5) };
            markTriggeredEffect(extra, 'equipment', '킹메이커 팔찌');
            markTriggeredEffect(extra, 'combat', '방어력 감소');
        }
        if (active('kingmakerDefenseDebuff')) addUnit(unit, 'defReductionBonus', state.kingmakerDefenseDebuff.value);
        const unitElementBonus = Number(perAttackUnitExtras[unit].allElementAtk || 0) * 4 + Number(perAttackUnitExtras[unit].waterAtk || 0);
        const totalElement = ['fireAtk', 'waterAtk', 'lightAtk', 'darkAtk'].reduce((sum, key) => sum + Number(stats[key] || 0) + Number(stats.allElementAtk || 0), 0)
            + Number(extra.equipmentAllElementAtk || 0) * 4 + Number(extra.equipmentWaterAtk || 0) + unitElementBonus;
        if (equipmentStage(actor, '레인보우 프리즘') && totalElement >= 1000) {
            addUnit(unit, 'finalDamageBonus', equipmentStep(actor, '레인보우 프리즘', .15, .05));
            if (rainbowTriggeredUnit < 0 && t >= Number(state.rainbowReadyAt || 0)) {
                addUnit(unit, 'rainbowAttackRatio', equipmentStep(actor, '레인보우 프리즘', 1.8, .4));
                rainbowTriggeredUnit = unit;
                markTriggeredEffect(extra, 'equipment', '레인보우 프리즘');
                markTriggeredEffect(extra, 'combat', '프리즘 추가 공격');
            }
        }
        state.attackCount = Number(state.attackCount || 0) + 1;
        if (equipmentStage(actor, '예고편')) { addUnit(unit, 'finalDamageBonus', -.04 + Number(state.previewNextFinal || 0)); state.previewNextFinal = equipmentStep(actor, '예고편', .06, .02); markTriggeredEffect(extra, 'equipment', '예고편'); }
        if (equipmentStage(actor, '예고의 예고') && state.attackCount % 2 == 0) { addUnit(unit, 'extraDamageBonus', equipmentStep(actor, '예고의 예고', .15, .05)); markTriggeredEffect(extra, 'equipment', '예고의 예고'); }
        if (equipmentStage(actor, '예고의 예고의 예고') && state.attackCount % 3 == 0) { addUnit(unit, 'critChanceBonus', equipmentStep(actor, '예고의 예고의 예고', .10, .05)); markTriggeredEffect(extra, 'equipment', '예고의 예고의 예고'); }
        if (equipmentSetCount(actor, '복선 회수') >= 4) {
            const cycle = equipmentStage(actor, '리턴즈파겜') ? ((state.attackCount % 3) + 1) : (((state.attackCount - 1) % 3) + 1);
            if (cycle == 1) addUnit(unit, 'finalDamageBonus', -.08);
            if (cycle == 2) { addUnit(unit, 'critChanceBonus', .20); addUnit(unit, 'critMulBonus', .20); }
            if (cycle == 3) { addUnit(unit, 'finalDamageBonus', .25); addUnit(unit, 'pntBonus', 120); }
            markTriggeredEffect(extra, 'set', '복선 회수');
            if (equipmentStage(actor, '리턴즈파겜')) markTriggeredEffect(extra, 'equipment', '리턴즈파겜');
            else if (equipmentStage(actor, '판테온 레거시')) markTriggeredEffect(extra, 'equipment', '판테온 레거시');
        }
    }
    extra.perAttackUnitExtras = perAttackUnitExtras;
    if (equipmentSetCount(actor, '천공의 심판') >= 4 && !state.judgment && t >= Number(state.judgmentReadyAt || 0)) {
        state.judgment = { damage: 0, until: t + equipmentDurationMs(actor, 8) };
        state.judgmentReadyAt = t + equipmentCooldownMs(actor, 15);
        markTriggeredEffect(extra, 'set', '천공의 심판');
        markTriggeredEffect(extra, 'combat', '심판 표식');
    }
    const previousBeforeAttack = extra.beforeAttackUnit;
    extra.beforeAttackUnit = args => {
        if (typeof previousBeforeAttack == 'function') previousBeforeAttack(args);
        if (rainbowTriggeredUnit >= 0 && args.unitIndex == rainbowTriggeredUnit) {
            state.rainbowReadyAt = t + equipmentCooldownMs(actor, 5);
            rainbowTriggeredUnit = -1;
        }
        if (!includedAtStart.encoreBuff && active('encoreBuff')) {
            args.hitExtra.damageBonusMul = Number(args.hitExtra.damageBonusMul || 0) + Number(state.encoreBuff.attack || 0);
            args.hitExtra.critMulBonus = Number(args.hitExtra.critMulBonus || 0) + Number(state.encoreBuff.critMul || 0);
        }
        if (equipmentSetCount(actor, '잿불의 장송곡') >= 4 && state.burn && Number(state.burn.until || 0) > t) {
            args.hitExtra.finalDamageBonus = Number(args.hitExtra.finalDamageBonus || 0) + .10;
            markTriggeredEffect(extra, 'set', '잿불의 장송곡');
        }
        if (equipmentStage(actor, '왓 타임 이즈 잇 나우') && Number(state.dropoutStacks || 0) > 0) {
            args.hitExtra.critMulBonus = Number(args.hitExtra.critMulBonus || 0) + Math.min(4, Number(state.dropoutStacks || 0)) * equipmentStep(actor, '왓 타임 이즈 잇 나우', .08, .03);
            markTriggeredEffect(extra, 'equipment', '왓 타임 이즈 잇 나우');
        }
    };
    extra.afterAttackUnit = ({ isCritical }) => {
        let additionalDamage = 0;
        let label = null;
        if (equipmentStage(actor, '앵콜') && isCritical) { state.encoreBuff = { attack: equipmentStep(actor, '앵콜', .12, .03) * (1 + Number(stats.attackBuffEfficiency || 0)), critMul: .20, until: t + equipmentDurationMs(actor, 6) }; markTriggeredEffect(extra, 'equipment', '앵콜'); }
        if (equipmentStage(actor, '왓 타임 이즈 잇 나우')) {
            const stacks = Math.min(4, Number(state.dropoutStacks || 0));
            if (isCritical) {
                if (stacks > 0) { additionalDamage = Math.round(Number(stats.atk || 0) * equipmentStep(actor, '왓 타임 이즈 잇 나우', .50, .05) * stacks * rpgenius.getElementDamageMultiplier(attackElement, stats, getLiveEquipmentStats(target, t))); label = '중퇴 추가 피해'; markTriggeredEffect(extra, 'equipment', '왓 타임 이즈 잇 나우'); }
                state.dropoutStacks = 0;
            } else state.dropoutStacks = Math.min(4, stacks + 1);
        }
        if (equipmentStage(actor, '진사이') && Math.random() < .05) { actor.hp = Math.min(actor.maxHp, actor.hp + Math.round(200 * (1 + Number(stats.recoveryEfficiency || 0)))); markTriggeredEffect(extra, 'equipment', '진사이'); markTriggeredEffect(extra, 'combat', 'HP 회복'); }
        if (equipmentStage(actor, '잿불 모자') && t >= Number(state.burnReadyAt || 0)) {
            const duration = 8 + Number(stats.burnDurationFlat || 0) + (equipmentStage(actor, '행운의 복주머니') ? 3 : 0);
            const tickDamage = Math.max(1, Math.round(Number(stats.atk || 0) * equipmentStep(actor, '잿불 모자', .30, .05)
                * (1 + Number(stats.burnDamage || 0) + (equipmentSetCount(actor, '잿불의 장송곡') >= 4 ? .35 : 0))));
            state.burn = { tickDamage, nextTickAt: t + EQUIPMENT_DOT_TICK_MS, until: t + duration * 1000 };
            state.burnReadyAt = t + equipmentCooldownMs(actor, 6);
            markTriggeredEffect(extra, 'equipment', '잿불 모자');
            markTriggeredEffect(extra, 'combat', '화상 부여');
        }
        return { additionalDamage, label };
    };
}

function finishEquipmentAttack(actor, hit, t) {
    const state = equipmentRuntime(actor);
    if (state.judgment && Number(state.judgment.until || 0) > t && Number(hit.damage || 0) > 0) {
        state.judgment.damage = Number(state.judgment.damage || 0) + Number(hit.judgmentDamage != null ? hit.judgmentDamage : hit.damage || 0);
    }
    delete hit.judgmentDamage;
}

function setShield(side, amount, durationMs, t) {
    if (side.snapshot.stats.disableShield) return 0;
    const value = Math.max(0, Math.round(amount));
    side.shield = { amount: value, until: t + durationMs };
    return value;
}

// 피해 계산 — 양방향 동일. 솔로 buildHuntResult + calculateMonsterAttackHitResult 순서를 그대로 따른다.
function dealDamage(attacker, defender, rawDamage, extra, t) {
    if (Math.random() < Number(defender.snapshot.stats.avd || 0)) return {
        damage: 0, criticalCount: 0, hitCount: 0, absorbed: 0, dodged: true,
        effectElement: extra.attackElement || attackElementOf(attacker, extra.skill),
        triggeredEffectIds: combatEffects.unique(extra.triggeredEffectIds || [])
    };
    const isDirectAttack = !(extra.summonAttack || extra.dotAttack);
    const aStats = Object.assign({}, extra.combatStats || getLiveEquipmentStats(attacker, t));
    if (Number(extra.equipmentAllElementAtk || 0) > 0) aStats.allElementAtk = Number(aStats.allElementAtk || 0) + Number(extra.equipmentAllElementAtk);
    if (Number(extra.equipmentWaterAtk || 0) > 0) aStats.waterAtk = Number(aStats.waterAtk || 0) + Number(extra.equipmentWaterAtk);
    const aSlot = attacker.snapshot.slotEffects;
    const dStats = getLiveEquipmentStats(defender, t);
    const dSlot = defender.snapshot.slotEffects;
    const defenderEffectIds = [];
    const defenderHpRatio = defender.hp / Math.max(1, defender.maxHp);
    const attackerHpRatio = attacker.hp / Math.max(1, attacker.maxHp);
    if (defenderHpRatio <= .50 && Number(dStats.bloodFlowReduction || 0) > 0) defenderEffectIds.push(combatEffects.id('equipment', '피의 흐름'));
    if (attackerHpRatio <= .50 && equipmentStage(defender, '최후통첩 아머')) defenderEffectIds.push(combatEffects.id('equipment', '최후통첩 아머'));
    if (isDefending(defender, t)) defenderEffectIds.push(combatEffects.id('combat', '방어'));
    let base = Number(rawDamage || 0) * Number(extra.rawDamageMultiplier || 1);
    const incomingDamageMul = Math.max(0, 1 + Number(dStats.takenDamage || 0))
        * (1 - Math.min(1, Number(dSlot.hpDamageReduction || 0)))
        * (1 - Math.min(1, receivedDamageReduction(defender, attacker)))
        * receivedDamageMul(defender);
    // 솔로 buildHuntResult의 damageWithSlotBonus (피해 증가 스탯/슬롯효과)
    if (!extra.precalculatedDamage) base = base * (1 + Number(aSlot.damageBonus || 0)) * (1 + Number(aStats.damageBonus || 0));
    if (!extra.attackElement) extra.attackElement = attackElementOf(attacker, extra.skill);
    delete extra.combatStats;
    delete extra.skill;
    if (!extra.attackElement && Number(aSlot.nonElementFinalDamage || 0) > 0) {
        extra.finalDamageBonus = Number(extra.finalDamageBonus || 0) + Number(aSlot.nonElementFinalDamage || 0);
    }
    // 보호막 공격 시 최종 피해 증가 (전직 흠시원 슬롯 효과)
    if (defender.shield && Number(defender.shield.amount || 0) > 0 && Number(aSlot.shieldFinalDamage || 0) > 0) {
        extra.finalDamageBonus = Number(extra.finalDamageBonus || 0) + Number(aSlot.shieldFinalDamage || 0);
    }
    if (isDirectAttack && Number(aSlot.tenthHitFinalAtk || 0) > 0) {
        extra.tenthAtkBonus = Number(aSlot.tenthHitFinalAtk || 0);
        extra.tenthAtkStart = Number(attacker.attackCount || 0);
    }
    if (isDirectAttack && defender.runtime.mark) extra.defReductionBonus = Number(extra.defReductionBonus || 0) + Number(defender.runtime.mark.defReduce || 0);
    const pntBuff = attacker.runtime.buffs.pntBuff;
    let pntBonus = isDirectAttack ? Number(pntBuff && pntBuff.value || 0) : 0;
    if (isDirectAttack && extra.isBasic && attacker.runtime.buffs.nextFinalDamageBonus) {
        extra.finalDamageBonus = Number(extra.finalDamageBonus || 0) + Number(attacker.runtime.buffs.nextFinalDamageBonus.value || 0);
        delete attacker.runtime.buffs.nextFinalDamageBonus;
    }
    const penetration = (extra.pnt != null ? Number(extra.pnt) : Number(aStats.pnt || 0)) + pntBonus + Number(extra.pntBonus || 0);
    const defense = Math.max(0, Number(dStats.def || 0) - Number(aStats.atkDefReduce || 0));
    const result = rpgenius.calculateAttackHitResult(base, defense, penetration, aStats, aSlot, extra, dStats);
    let components = (Array.isArray(result.damageComponents) && result.damageComponents.length > 0
        ? result.damageComponents
        : result.hitDetails || []).map(component => ({
            damage: Math.max(0, Math.round(Number(component && component.damage || 0) * incomingDamageMul)),
            critical: !!(component && (component.isCritical || component.critical)),
            destiny: !!(component && (component.isDestinyDamage || component.destiny)),
            type: component && component.type || 'hit',
            label: component && component.label || null,
            hitIndex: component && component.hitIndex != null ? Number(component.hitIndex) : null,
            isComboHit: !!(component && component.isComboHit),
            isComboLastCrit: !!(component && component.isComboLastCrit),
            isAbyssExtraHit: !!(component && component.isAbyssExtraHit),
            effectIds: combatEffects.unique([].concat(component && component.effectIds || [], defenderEffectIds))
        }));
    if (components.length == 0 && Number(result.finalDamage || 0) > 0) components = [{ damage: Math.round(Number(result.finalDamage) * incomingDamageMul), critical: false, destiny: false, type: 'hit', label: null }];
    const nextReduction = defender.runtime.buffs.nextDamageReduction;
    if (nextReduction) {
        const multiplier = 1 - Number(nextReduction.value || 0);
        components.forEach(component => { component.damage = Math.max(0, Math.round(component.damage * multiplier)); });
        delete defender.runtime.buffs.nextDamageReduction;
    }
    if (isDefending(defender, t)) components.forEach(component => { component.damage = Math.max(0, Math.round(component.damage * 0.5)); });
    const summon = defender.runtime.summon;
    const summonComponents = [];
    if (summon && summon.hp != null && Number(summon.hp) > 0) {
        let summonAbsorbed = 0;
        components.forEach(component => {
            const absorb = Math.round(component.damage * 0.3);
            component.damage -= absorb;
            summonAbsorbed += absorb;
            if (absorb > 0) summonComponents.push({ damage: absorb, critical: false, destiny: false, type: 'summonAbsorbed', label: summon.name + ' 피해 대행' });
        });
        summon.hp = Number(summon.hp) - summonAbsorbed;
        if (summon.hp <= 0) defender.runtime.summon = null;
    }
    let absorbed = 0;
    const shieldComponents = [];
    if (defender.shield && Number(defender.shield.amount || 0) > 0) {
        components.forEach(component => {
            const amount = Math.min(Number(defender.shield && defender.shield.amount || 0), component.damage);
            component.damage -= amount;
            absorbed += amount;
            if (amount > 0) shieldComponents.push({ damage: amount, critical: false, destiny: false, type: 'absorbed', label: component.label ? '보호막 흡수 · ' + component.label : '보호막 흡수' });
            if (defender.shield) defender.shield.amount -= amount;
        });
        if (defender.shield.amount <= 0) {
            if (shieldComponents.length > 0) shieldComponents[shieldComponents.length - 1].shieldBroken = true;
            defender.shield = null;
        }
    }
    components = components.filter(component => component.damage > 0);
    let damage = components.reduce((sum, component) => sum + Number(component.damage || 0), 0);
    const judgmentDamage = damage;
    // 실제 처리 순서(소환수 피해 대행 → 남은 피해를 보호막 흡수)와 같은 순서로 표시한다.
    components.push(...summonComponents, ...shieldComponents);
    defender.hp = Math.max(0, defender.hp - damage);
    if (isDirectAttack && defender.hp > 0 && defender.hp / Math.max(1, defender.maxHp) < .05 && equipmentStage(attacker, '징수의 총')) {
        const executeDamage = defender.hp;
        defender.hp = 0;
        damage += executeDamage;
        components.push({ damage: executeDamage, critical: false, destiny: false, type: 'additional', label: '징수의 총 처형' });
    }
    const units = Math.max(1, Number(result.attackUnitCount || 1));
    if (isDirectAttack) {
        attacker.attackCount = Number(attacker.attackCount || 0) + units;
        if (extra.buildNmmStack) attacker.runtime.nmmStacks = Math.min(9, Number(attacker.runtime.nmmStacks || 0) + units);
        if (Number(aStats.manaBurnAttackRecovery || 0) > 0) {
            attacker.mp = Math.min(attacker.maxMp, attacker.mp + Math.max(1, Math.round(attacker.maxMp * Number(aStats.manaBurnAttackRecovery))) * units);
                if (equipmentSetCount(attacker, '마나번') >= 2) markTriggeredEffect(extra, 'set', '마나번');
            markTriggeredEffect(extra, 'combat', 'MP 회복');
        }
    }
    let heal = 0;
    let mpRecovery = 0;
    if (isDirectAttack && Math.random() < .10 && Number(aStats.attackHpRecovery || 0) > 0) {
        const before = attacker.hp;
        attacker.hp = Math.min(attacker.maxHp, attacker.hp + Math.round(Number(aStats.attackHpRecovery) * (1 + Number(aStats.recoveryEfficiency || 0))));
        heal = attacker.hp - before;
    }
    if (isDirectAttack && Math.random() < .10 && Number(aStats.attackMpRecovery || 0) > 0) {
        const before = attacker.mp;
        attacker.mp = Math.min(attacker.maxMp, attacker.mp + Math.round(Number(aStats.attackMpRecovery) * (1 + Number(aStats.recoveryEfficiency || 0))));
        mpRecovery = attacker.mp - before;
    }
    let targetHeal = 0;
    if (damage > 0 && Number(dSlot.killRecoveryChance || 0) > 0 && Math.random() < Number(dSlot.killRecoveryChance)) {
        const before = defender.hp;
        defender.hp = Math.min(defender.maxHp, defender.hp + Math.round(damage * .20 * (1 + Number(dStats.recoveryEfficiency || 0))));
        targetHeal = defender.hp - before;
    }
    const reflectedHits = [];
    let reflectedDamage = 0;
    if (isDirectAttack && damage > 0 && hasEquipmentPassive(defender, 5) && attacker.hp > 0) {
        const reflectCount = Math.max(1, Number(result.hitCount || 1));
        for (let i = 0; i < reflectCount && attacker.hp > 0; i++) {
            const reflected = Math.max(0, Math.round(Number(dStats.def || 0) * .25 * (randomInt(98, 102) / 100)));
            if (reflected <= 0) continue;
            reflectedHits.push({ damage: reflected, label: '가시 반사' });
            reflectedDamage += reflected;
            attacker.hp = Math.max(0, attacker.hp - reflected);
        }
    }
    const defenderState = equipmentRuntime(defender);
    if (defender.hp > 0 && defender.hp / Math.max(1, defender.maxHp) <= .20 && hasEquipmentPassive(defender, 3) && t >= Number(defenderState.dragonRegenReadyAt || 0)) {
        defenderState.dragonRegen = { ticksLeft: 5, nextTickAt: t + 1000 };
        defenderState.dragonRegenReadyAt = t + 65000;
        defenderEffectIds.push(combatEffects.id('equipment', '불굴'));
    }
    const hit = { damage, hits: components, criticalCount: Number(result.criticalCount || 0), hitCount: Number(result.hitCount || 1), absorbed, dodged: false, heal, mpRecovery, targetHeal, reflectedDamage, reflectedHits, selfDamage: reflectedDamage, effectElement: extra.attackElement || null, triggeredEffectIds: combatEffects.unique(extra.triggeredEffectIds || []) };
    if (judgmentDamage != damage) hit.judgmentDamage = judgmentDamage;
    return hit;
}

function damageText(label, hit) {
    if (hit.dodged) return label + ' — 회피';
    const parts = Array.isArray(hit.hits) ? hit.hits.filter(entry => entry.type != 'absorbed' && Number(entry.damage || 0) > 0) : [];
    if (parts.length > 0) return label + ' — ' + parts.map(entry => comma(entry.damage) + (entry.label ? ' ' + entry.label : '')).join(' / ') + ' 피해';
    return label + ' — ' + (hit.criticalCount > 0 ? '치명타 ' : '') + comma(hit.damage) + ' 피해';
}

function hasSkill(side, skillName) {
    return sideSkills(side).some(skill => skill.name == skillName);
}

function prepareEquipmentSkill(side, skill, t, combatStats) {
    const state = JSON.parse(JSON.stringify(equipmentRuntime(side)));
    const stats = combatStats || getLiveEquipmentStats(side, t);
    const result = { mpCostMul: 1, extra: {}, cooldownFlatReduction: 0, cooldownOverride: null, ultimateCooldownReduction: 0, state };
    let virtualHp = side.hp;
    const sinceSkill = t - Number(state.lastSkillAt || side.enteredAt || t);
    const markHpCost = () => { if (equipmentStage(side, '흐르는 피')) state.flowingBloodNext = equipmentStep(side, '흐르는 피', .12, .04); };
    const spendHp = rate => { const cost = Math.max(1, Math.floor(virtualHp * rate)); virtualHp = Math.max(1, virtualHp - cost); result.hpAfter = virtualHp; markHpCost(); return cost; };
    const add = (key, value) => { result.extra[key] = Number(result.extra[key] || 0) + Number(value || 0); };
    if (equipmentStage(side, '불량 배터리') && Math.random() < .20) { result.noMp = true; add('damageBonusMul', -.12); markTriggeredEffect(result.extra, 'equipment', '불량 배터리'); }
    if (equipmentStage(side, '썩어버린 물')) {
        const stacks = Math.min(3, Number(state.rottenWaterStacks || 0));
        result.mpCostMul *= 1 + .06 * stacks;
        add('damageBonusMul', stacks * equipmentStep(side, '썩어버린 물', .05, .02));
        if (skill.name == '청정수 투척') { state.rottenWaterStacks = Math.min(3, stacks + 1); markTriggeredEffect(result.extra, 'equipment', '썩어버린 물'); }
    }
    if (equipmentStage(side, '모노레일 타이머') && sinceSkill >= 15000) { add('critMulBonus', equipmentStep(side, '모노레일 타이머', .40, .08)); markTriggeredEffect(result.extra, 'equipment', '모노레일 타이머'); }
    if (equipmentStage(side, '결합 타이머') && sinceSkill >= 10000) { add('extraDamageBonus', equipmentStep(side, '결합 타이머', .20, .07)); markTriggeredEffect(result.extra, 'equipment', '결합 타이머'); }
    if (equipmentStage(side, '십결모 타이머') && sinceSkill >= 10000) { add('damageBonusMul', .30); add('critChanceBonus', .25); markTriggeredEffect(result.extra, 'equipment', '십결모 타이머'); }
    if (equipmentSetCount(side, '딜레이') >= 4 && sinceSkill >= 15000) { add('finalDamageBonus', .25); add('pntBonus', 100); result.mpCostMul *= 1.25; markTriggeredEffect(result.extra, 'set', '딜레이'); }
    if (equipmentSetCount(side, '복선 회수') >= 4) {
        const nextOrder = equipmentStage(side, '리턴즈파겜') ? ((Number(state.attackCount || 0) + 1) % 3) + 1 : (Number(state.attackCount || 0) % 3) + 1;
        if (nextOrder == 1) result.mpCostMul *= .80;
    }
    if (equipmentStage(side, 'DMC 마이크')) { state.dmcSkillCount = Number(state.dmcSkillCount || 0) + 1; if (state.dmcSkillCount % 3 == 0) { add('finalDamageBonus', equipmentStep(side, 'DMC 마이크', .40, .10)); markTriggeredEffect(result.extra, 'equipment', 'DMC 마이크'); } }
    if (skill.name == '백억이요' && equipmentStage(side, '범부의 대나무')) {
        if (t >= Number(state.beomStacksUntil || 0)) state.beomStacks = 0;
        state.beomStacks = Math.min(7, Number(state.beomStacks || 0) + 1);
        state.beomStacksUntil = t + equipmentDurationMs(side, 10);
        if (state.beomStacks >= 7) state.trueBeomUntil = t + equipmentDurationMs(side, 10);
        markTriggeredEffect(result.extra, 'equipment', '범부의 대나무');
    }
    if (skill.name == '초특급한탕') {
        result.superJackpot = Math.random() < .10;
        if (!result.superJackpot && equipmentStage(side, '교촌 주머니')) {
            result.cooldownFlatReduction += 30000;
            if (equipmentStage(side, '행운의 복주머니')) state.fortuneExtraDamage = { value: equipmentStep(side, '행운의 복주머니', .10, .05), until: t + equipmentDurationMs(side, 10) };
            markTriggeredEffect(result.extra, 'equipment', '교촌 주머니');
        }
    }
    if (equipmentStage(side, '운명의 주사위') && t >= Number(state.destinyDiceReadyAt || 0)) {
        const types = equipmentSetCount(side, 'TCG의 유산') >= 4 ? ['crit', 'critMul'] : [Math.random() < .5 ? 'crit' : 'critMul'];
        state.destinyDiceBuff = { types, until: t + equipmentDurationMs(side, 8) };
        state.destinyDiceReadyAt = t + equipmentCooldownMs(side, 15);
        markTriggeredEffect(result.extra, 'equipment', '운명의 주사위');
    }
    if (state.destinyDiceBuff && Number(state.destinyDiceBuff.until || 0) > t) {
        if ((state.destinyDiceBuff.types || []).includes('crit')) add('critChanceBonus', equipmentStep(side, '운명의 주사위', .15, .04));
        if ((state.destinyDiceBuff.types || []).includes('critMul')) add('critMulBonus', equipmentStep(side, '운명의 주사위', .30, .08));
        markTriggeredEffect(result.extra, 'equipment', '운명의 주사위');
    }
    if (equipmentStage(side, '심판의 주사위') && t >= Number(state.judgeDiceReadyAt || 0)) {
        const types = equipmentSetCount(side, 'TCG의 유산') >= 4 ? ['crit', 'critMul'] : [Math.random() < .5 ? 'crit' : 'critMul'];
        state.judgeDiceBuff = { types, until: t + equipmentDurationMs(side, 10) };
        state.judgeDiceReadyAt = t + equipmentCooldownMs(side, 14);
        markTriggeredEffect(result.extra, 'equipment', '심판의 주사위');
    }
    if (state.judgeDiceBuff && Number(state.judgeDiceBuff.until || 0) > t) {
        if ((state.judgeDiceBuff.types || []).includes('crit')) add('critChanceBonus', .30);
        if ((state.judgeDiceBuff.types || []).includes('critMul')) add('critMulBonus', .50);
        markTriggeredEffect(result.extra, 'equipment', '심판의 주사위');
    }
    if (skill.name == '자인' && equipmentStage(side, '궁택토')) { result.cooldownOverride = 0; markTriggeredEffect(result.extra, 'equipment', '궁택토'); }
    if (isUltimateSkill(side, skill)) result.cooldownFlatReduction += Number(stats.ultimateCooldownFlat || 0);
    if (equipmentSetCount(side, '심해의 순환') >= 4 && t >= Number(state.deepSetReadyAt || 0)) { result.ultimateCooldownReduction = 3000; state.deepSetReadyAt = t + equipmentCooldownMs(side, 12); markTriggeredEffect(result.extra, 'set', '심해의 순환'); }
    if (equipmentStage(side, '심해의 신발')) { result.selfCooldownRate = equipmentStep(side, '심해의 신발', .04, .01); result.selfCooldownCap = 3000; markTriggeredEffect(result.extra, 'equipment', '심해의 신발'); }
    if (equipmentStage(side, '심해의 갑옷') && !stats.disableShield) { result.shield = Math.round(side.maxHp * equipmentStep(side, '심해의 갑옷', .05, .01) * (1 + Number(stats.shieldEfficiency || 0))); markTriggeredEffect(result.extra, 'equipment', '심해의 갑옷'); }
    if (equipmentStage(side, '심해의 모자')) { state.deepNextBasic = equipmentStep(side, '심해의 모자', .60, .15); state.deepWaterAttackBuff = { value: .08, until: t + equipmentDurationMs(side, 6) }; markTriggeredEffect(result.extra, 'equipment', '심해의 모자'); }
    if (equipmentStage(side, '검은 잔향 신발') && t >= Number(state.blackEchoShoesReadyAt || 0)) { state.blackEchoShoesBuff = { value: equipmentStep(side, '검은 잔향 신발', .07, .03), until: t + equipmentDurationMs(side, 60) }; state.blackEchoShoesReadyAt = t + equipmentCooldownMs(side, 60); markTriggeredEffect(result.extra, 'equipment', '검은 잔향 신발'); }
    if (equipmentSetCount(side, '검은 잔향') >= 4 && t >= Number(state.blackEchoSetReadyAt || 0)) { spendHp(.02); result.shadowDamageRate = virtualHp / Math.max(1, side.maxHp) <= .50 ? .50 : .35; state.blackEchoSetReadyAt = t + equipmentCooldownMs(side, 12); markTriggeredEffect(result.extra, 'set', '검은 잔향'); }
    if (equipmentStage(side, '심연의 신발')) { if (virtualHp / Math.max(1, side.maxHp) > .50) spendHp(.02); state.darkAttackBuff = { value: .25, until: t + equipmentDurationMs(side, 12) }; state.abyssBuff = { until: t + equipmentDurationMs(side, 12) }; markTriggeredEffect(result.extra, 'equipment', '심연의 신발'); }
    state.lastSkillAt = t;
    return result;
}

function commitEquipmentSkillCooldown(side, skill, equipmentSkill, t) {
    const base = equipmentSkill.cooldownOverride != null ? Number(equipmentSkill.cooldownOverride) : skillCooldownMs(side, skill);
    let duration = Math.max(0, base - Number(equipmentSkill.cooldownFlatReduction || 0));
    if (Number(equipmentSkill.selfCooldownRate || 0) > 0) duration -= Math.min(Number(equipmentSkill.selfCooldownCap || 0), duration * Number(equipmentSkill.selfCooldownRate));
    side.skillCooldowns[skill.name] = Math.max(t, t + duration);
    if (Number(equipmentSkill.ultimateCooldownReduction || 0) > 0) {
        const skills = sideSkills(side);
        const ultimate = skills.length > 0 ? skills[skills.length - 1] : null;
        if (ultimate) side.skillCooldowns[ultimate.name] = Math.max(t, Number(side.skillCooldowns[ultimate.name] || t) - Number(equipmentSkill.ultimateCooldownReduction));
    }
}

function doBasicAttack(battle, actorKey, t) {
    const actor = battle[actorKey];
    const target = battle[actorKey == 'me' ? 'opp' : 'me'];
    const stats = getLiveEquipmentStats(actor, t);
    const slotEffects = actor.snapshot.slotEffects;
    const nextBasic = actor.runtime.buffs.nextBasicDamageBonus;
    const nextBasicBonus = Number(nextBasic && nextBasic.value || 0);
    if (nextBasic) delete actor.runtime.buffs.nextBasicDamageBonus;
    const sivalonActive = !!(actor.runtime.sivalon && Number(actor.runtime.sivalon.until || 0) > t);
    if (!sivalonActive && hasSkill(actor, '시벌론')) actor.runtime.sivalonCharge = Math.min(5, Number(actor.runtime.sivalonCharge || 0) + 1);
    const rawDamage = Math.round(Number(stats.atk || 0) * (1 + Number(stats.afterBasic || 0) + Number(slotEffects.basicDamageBonus || 0) + nextBasicBonus));
    const extra = { isBasic: true, buildNmmStack: hasSkill(actor, '나인 멘스 모리스'), combatStats: stats };
    extra.comboHitCount = rpgenius.getComboHitCount(stats);
    extra.attackUnitCount = extra.comboHitCount;
    prepareEquipmentAttack(actor, target, extra, t);
    const hit = dealDamage(actor, target, rawDamage, extra, t);
    finishEquipmentAttack(actor, hit, t);
    pushEvent(battle, Object.assign({ at: t, actor: actorKey, action: 'attack', text: damageText(actor.name + ' 공격', hit) }, hit));
    actor.nextActionAt = t + actionCooldownMs(actor, true, t);
}

function doDefend(battle, actorKey, t) {
    const actor = battle[actorKey];
    actor.defendUntil = t + DEFEND_DURATION_MS;
    actor.defendCooldownEnd = t + DEFEND_COOLDOWN_MS;
    pushEvent(battle, { at: t, actor: actorKey, action: 'defend', text: actor.name + ' 방어 태세 (' + (DEFEND_DURATION_MS / 1000) + '초)' });
    actor.nextActionAt = t + actionCooldownMs(actor, false, t);
}

// ===== 스킬 효과 매핑 (솔로 executeMainCardSkillInField 미러) =====

function doSkill(battle, actorKey, skill, t) {
    const actor = battle[actorKey];
    const targetKey = actorKey == 'me' ? 'opp' : 'me';
    const target = battle[targetKey];
    const stats = getLiveEquipmentStats(actor, t);
    const slotEffects = actor.snapshot.slotEffects;
    const star = Number(actor.snapshot.star || 0);
    const value = (index) => rpgenius.getSkillValue(skill, index, star);
    const name = skill.name;
    const equipmentSkill = prepareEquipmentSkill(actor, skill, t, stats);
    const mpCost = equipmentSkill.noMp ? 0 : Math.max(0, Math.round(skillMpCost(actor, skill) * Number(equipmentSkill.mpCostMul || 1)));
    if (actor.mp < mpCost) return { ok: false, message: 'MP가 부족합니다.' };
    actor.runtime.equipment = equipmentSkill.state;
    if (typeof equipmentSkill.hpAfter != 'undefined') actor.hp = Math.max(1, Number(equipmentSkill.hpAfter));
    actor.mp = Math.max(0, actor.mp - mpCost);
    commitEquipmentSkillCooldown(actor, skill, equipmentSkill, t);
    actor.nextActionAt = t + actionCooldownMs(actor, false, t);
    // 건력 상태에서 다른 스킬을 쓰면 해제된다
    if (name != '건력' && actor.runtime.gunryeok) clearGunryeok(actor);

    let multiplier = value(0);
    const extra = Object.assign({ isSkill: true, skill, combatStats: stats }, equipmentSkill.extra || {});
    const skillEffectMeta = () => ({
        effectElement: attackElementOf(actor, skill),
        triggeredEffectIds: combatEffects.unique(extra.triggeredEffectIds || [])
    });
    if (Number(equipmentSkill.shadowDamageRate || 0) > 0) extra.shadowDamageRate = Number(equipmentSkill.shadowDamageRate);
    if (Number(equipmentSkill.shield || 0) > 0) {
        const amount = setShield(actor, equipmentSkill.shield, equipmentDurationMs(actor, 5), t);
        if (amount > 0) pushEvent(battle, Object.assign({ at: t, actor: actorKey, action: 'shield', skillName: name, shield: amount, text: '심해의 갑옷 — 보호막 ' + comma(amount) }, skillEffectMeta()));
    }

    if (name == '시벌론') {
        actor.runtime.sivalon = { until: t + Math.round(value(0) * 1000) };
        actor.runtime.sivalonCharge = 0;
        actor.nextActionAt = t; // 사용 즉시 일반 공격 가능
        pushEvent(battle, Object.assign({ at: t, actor: actorKey, action: 'skill', skillName: name, text: name + ' — 일반 공격 쿨타임 단축' }, skillEffectMeta()));
        return { ok: true };
    }
    if (name == '건력') {
        if (actor.runtime.gunryeok) {
            clearGunryeok(actor);
            pushEvent(battle, Object.assign({ at: t, actor: actorKey, action: 'skill', skillName: name, text: name + ' — 상태 해제' }, skillEffectMeta()));
            return { ok: true };
        }
        // 솔로와 동일: 최대 HP를 70% 봉인(실질 30%)하고 현재 HP를 그 위로 잘라낸다
        const sealed = Math.max(1, Math.round(actor.maxHp * 0.3));
        actor.runtime.gunryeok = { until: t + 60000, dmgReduce: value(0), atkBuff: value(1), maxHpBefore: actor.maxHp };
        actor.maxHp = sealed;
        actor.hp = Math.min(actor.hp, sealed);
        pushEvent(battle, Object.assign({ at: t, actor: actorKey, action: 'skill', skillName: name, text: name + ' — 상태 진입' }, skillEffectMeta()));
        return { ok: true };
    }
    if (name == '익테봇 소환') {
        actor.runtime.summon = {
            name: '익테봇',
            atkMul: value(1),
            hp: Math.round(actor.maxHp * value(0)),
            buff: 0,
            until: t + Math.round(20000 * (1 + Number(stats.summonDuration || 0))),
            nextAttackAt: t + SUMMON_TICK_MS['익테봇']
        };
        pushEvent(battle, Object.assign({ at: t, actor: actorKey, action: 'skill', skillName: name, text: name + ' — 소환 완료' }, skillEffectMeta()));
        return { ok: true };
    }
    if (name == '수나타 소환') {
        actor.runtime.summon = {
            name: '수나타',
            atkMul: value(0),
            hp: null,
            buff: value(1),
            until: t + Math.round(45000 * (1 + Number(stats.summonDuration || 0))),
            nextAttackAt: t + SUMMON_TICK_MS['수나타']
        };
        pushEvent(battle, Object.assign({ at: t, actor: actorKey, action: 'skill', skillName: name, text: name + ' — 소환 완료' }, skillEffectMeta()));
        return { ok: true };
    }
    if (name == '유서새김') {
        const emoticonStage = equipmentStage(actor, '흐음티콘');
        const defReduce = value(0) + (emoticonStage ? equipmentStep(actor, '흐음티콘', .12, .04) : 0);
        const dotMul = 1 + Number(stats.dotDamage || 0) + (emoticonStage ? equipmentStep(actor, '흐음티콘', .40, .15) : 0);
        const dot = Math.max(1, Math.round(Number(stats.atk || 0) * value(1) * dotMul));
        target.runtime.mark = { defReduce, dot, until: t + 10000, nextTickAt: t + MARK_TICK_MS };
        if (emoticonStage) markTriggeredEffect(extra, 'equipment', '흐음티콘');
        pushEvent(battle, Object.assign({ at: t, actor: actorKey, action: 'skill', skillName: name, text: name + ' — 표식 부여' }, skillEffectMeta()));
        return { ok: true };
    }
    if (name == '범인은 이 안에') {
        const hpCost = Math.floor(actor.hp * 0.1);
        actor.hp = Math.max(1, actor.hp - hpCost);
        const bloodOathStage = equipmentStage(actor, '피의 서약');
        if (bloodOathStage) equipmentRuntime(actor).culprit = {
            takenFinalDamage: equipmentStep(actor, '피의 서약', .12, .04),
            defReduction: equipmentStep(actor, '피의 서약', .15, .05),
            until: t + 10000
        };
        else actor.runtime.buffs.pntBuff = { value: value(0), until: t + 10000 };
        if (bloodOathStage) markTriggeredEffect(extra, 'equipment', '피의 서약');
        actor.runtime.buffs.nextFinalDamageBonus = { value: value(1), until: null };
        pushEvent(battle, Object.assign({ at: t, actor: actorKey, action: 'skill', skillName: name, selfDamage: hpCost, text: name + ' — 방어 관통 강화' }, skillEffectMeta()));
        return { ok: true };
    }

    if (name == '나인 멘스 모리스') {
        const stacks = Math.min(9, Number(actor.runtime.nmmStacks || 0));
        const roseKnifeStage = equipmentStage(actor, '장미칼');
        const perStack = value(1) + (roseKnifeStage ? equipmentStep(actor, '장미칼', .06, .02) : 0);
        multiplier = value(0) * (1 + perStack * stacks);
        if (stacks >= 9) extra.defReductionBonus = Number(extra.defReductionBonus || 0) + 0.5;
        actor.runtime.nmmStacks = roseKnifeStage && stacks >= 9 ? 3 : 0;
        if (roseKnifeStage && stacks >= 9) markTriggeredEffect(extra, 'equipment', '장미칼');
    }
    if (name == '포커 못 하시네') {
        extra.hitCount = 9;
        extra.basicAttackSkill = true;
        extra.separateBasicAttackHits = true;
    }
    if (name == '비리') {
        extra.forceCritical = true;
        extra.basicAttackSkill = true;
    }
    if (name == '54버스트') extra.forceCritical = true;
    if (name == 'SUPER EASY' || name == 'KICK BACK') {
        extra.critChanceMul = 0.5;
        extra.critMulBonus = value(1);
    }
    if (name == '청정수 투척' || name == '댄져') extra.pnt = Number(stats.pnt || 0) + value(1);
    if (name == '초특급한탕' && equipmentSkill.superJackpot) multiplier = value(1);
    if (name == '불사조') {
        extra.damageBonusMul = Number(extra.damageBonusMul || 0) + Number(stats.crit || 0) * 0.5;
        const prisonKey = equipmentStage(actor, '감옥열쇠');
        if (prisonKey) {
            extra.critChanceBonus = Number(extra.critChanceBonus || 0) + .10;
            extra.damageBonusMul = Number(extra.damageBonusMul || 0) + .30;
            markTriggeredEffect(extra, 'equipment', '감옥열쇠');
            if (equipmentStage(actor, '행운의 복주머니')) markTriggeredEffect(extra, 'equipment', '행운의 복주머니');
        }
        actor.runtime.buffs.receivedDamageMul = { value: 1.5, until: t + (prisonKey ? (equipmentStage(actor, '행운의 복주머니') ? 11000 : 8000) : 4000) };
    }
    if (name == '처형박수') {
        extra.damageBonusMul = Number(extra.damageBonusMul || 0) + Number(stats.crit || 0);
        actor.runtime.buffs.receivedDamageMul = { value: 2.0, until: t + 8000 };
    }
    if (name == '수업끝') {
        extra.disableCritical = true;
        actor.runtime.buffs.receivedDamageReduction = { value: 0.3, until: t + 3000 };
    }
    if (name == '자인' && !equipmentStage(actor, '궁택토')) {
        actor.runtime.buffs.nextBasicDamageBonus = {
            value: value(1) + (equipmentStage(actor, '쿠루미의 힘이 깃든 지팡이') ? equipmentStep(actor, '쿠루미의 힘이 깃든 지팡이', .75, .25) : 0),
            until: null
        };
        if (equipmentStage(actor, '쿠루미의 힘이 깃든 지팡이')) markTriggeredEffect(extra, 'equipment', '쿠루미의 힘이 깃든 지팡이');
    }
    if (name == '유드 알레프') actor.runtime.buffs.nextSkillDamageBonus = { value: 0.10, until: null };
    if (name == '안면강타') actor.runtime.sivalonCharge = 5;

    let shieldAmount = 0;
    if (name == '글버지') shieldAmount = setShield(actor, actor.maxHp * value(1) * (1 + Number(stats.shieldEfficiency || 0)), 8000, t);
    if (name == '피아스트') shieldAmount = setShield(actor, actor.maxMp * value(1) * (1 + Number(stats.shieldEfficiency || 0)), 8000, t);
    if (name == '핫식스의정력') shieldAmount = setShield(actor, actor.maxHp * value(1) * (1 + Number(stats.shieldEfficiency || 0)), 12000, t);
    if (name == '이어브피') shieldAmount = setShield(actor, actor.maxMp * value(1) * (1 + Number(stats.shieldEfficiency || 0)), 12000, t);
    if (name == '감사합니다 친구야') {
        actor.runtime.buffs.receivedDamageReduction = { value: 0.3, until: t + 10000 };
    }
    if (shieldAmount > 0) pushEvent(battle, Object.assign({ at: t, actor: actorKey, action: 'shield', skillName: name, shield: shieldAmount, text: name + ' — 보호막 ' + comma(shieldAmount) }, skillEffectMeta()));

    let nextSkillBonus = 0;
    if (!extra.basicAttackSkill && actor.runtime.buffs.nextSkillDamageBonus && name != '유드 알레프') {
        nextSkillBonus = Number(actor.runtime.buffs.nextSkillDamageBonus.value || 0);
        delete actor.runtime.buffs.nextSkillDamageBonus;
    }
    if (Number(stats.skillTrueDmg || 0) > 0) extra.skillTrueDmg = Number(stats.skillTrueDmg);
    const rawDamage = extra.basicAttackSkill
        ? Math.round(Number(stats.atk || 0) * multiplier * (1 + Number(stats.afterBasic || 0) + Number(slotEffects.basicDamageBonus || 0)))
        : Math.round(Number(stats.atk || 0) * multiplier * (1 + Number(stats.afterSkill || 0) + Number(slotEffects.skillDamageBonus || 0) + nextSkillBonus));
    if (extra.basicAttackSkill && hasSkill(actor, '나인 멘스 모리스')) extra.buildNmmStack = true;
    if (!extra.hitCount) extra.comboHitCount = rpgenius.getComboHitCount(stats);
    extra.attackUnitCount = extra.hitCount ? 1 : Math.max(1, Number(extra.comboHitCount || 1));
    prepareEquipmentAttack(actor, target, extra, t);
    const hit = dealDamage(actor, target, rawDamage, extra, t);
    finishEquipmentAttack(actor, hit, t);
    if (!hit.dodged && Number(extra.shadowDamageRate || 0) > 0 && Number(hit.damage || 0) > 0) {
        const state = equipmentRuntime(actor);
        if (!Array.isArray(state.shadowQueue)) state.shadowQueue = [];
        state.shadowQueue.push({ dueAt: t + 2000, damage: Math.max(1, Math.round(Number(hit.damage) * Number(extra.shadowDamageRate))) });
    }
    if (!hit.dodged && equipmentStage(actor, '해류를 거스르는 신발')) {
        const state = equipmentRuntime(actor);
        if (t >= Number(state.currentShoesReadyAt || 0)) {
            const cooldownEnd = Number(actor.skillCooldowns[name] || t);
            const reduction = Math.min(5000, Math.max(0, cooldownEnd - t) * .08);
            actor.skillCooldowns[name] = Math.max(t, cooldownEnd - reduction);
            const mpBeforeRecovery = actor.mp;
            actor.mp = Math.min(actor.maxMp, actor.mp + Math.max(1, Math.round(actor.maxMp * .03)));
            state.currentShoesReadyAt = t + equipmentCooldownMs(actor, 8);
            hit.mpRecovery = Number(hit.mpRecovery || 0) + Math.max(0, actor.mp - mpBeforeRecovery);
            hit.triggeredEffectIds = combatEffects.unique([].concat(hit.triggeredEffectIds || [], [
                combatEffects.id('equipment', '해류를 거스르는 신발'),
                combatEffects.id('combat', '쿨타임 감소'),
                combatEffects.id('combat', 'MP 회복')
            ]));
        }
    }
    pushEvent(battle, Object.assign({ at: t, actor: actorKey, action: 'skill', skillName: name, text: damageText(name, hit) }, hit));
    return { ok: true };
}

function doSummonTick(battle, actorKey, t) {
    const actor = battle[actorKey];
    const target = battle[actorKey == 'me' ? 'opp' : 'me'];
    const summon = actor.runtime.summon;
    summon.nextAttackAt = t + (SUMMON_TICK_MS[summon.name] || 5000);
    // 솔로 소환수 틱과 동일: 단일 타격, 장비 추가 피해 제외
    const raw = Math.max(1, Math.round(Number(getLiveEquipmentStats(actor, t).atk || 0) * Number(summon.atkMul || 0)));
    const extra = { isSkill: true, summonAttack: true, disableEquipmentBonusDamage: true, hitCount: 1 };
    const hit = dealDamage(actor, target, raw, extra, t);
    pushEvent(battle, Object.assign({ at: t, actor: actorKey, action: 'summon', skillName: summon.name, text: damageText(summon.name, hit) }, hit));
}

function doMarkTick(battle, markedKey, t) {
    const marked = battle[markedKey];
    const attackerKey = markedKey == 'me' ? 'opp' : 'me';
    const attacker = battle[attackerKey];
    const mark = marked.runtime.mark;
    mark.nextTickAt = t + MARK_TICK_MS;
    const extra = { dotAttack: true, summonAttack: true, disableEquipmentBonusDamage: true, hitCount: 1 };
    const hit = dealDamage(attacker, marked, Math.max(1, Number(mark.dot || 0)), extra, t);
    pushEvent(battle, Object.assign({ at: t, actor: attackerKey, action: 'dot', skillName: '유서새김', text: damageText('유서새김', hit) }, hit));
}

function doEquipmentBurnTick(battle, actorKey, t) {
    const actor = battle[actorKey];
    const target = battle[actorKey == 'me' ? 'opp' : 'me'];
    const state = equipmentRuntime(actor);
    const burn = state.burn;
    if (!burn) return;
    burn.nextTickAt = t + EQUIPMENT_DOT_TICK_MS;
    const extra = { dotAttack: true, disableCritical: true, disableEquipmentBonusDamage: true, hitCount: 1, attackElement: '화' };
    const hit = dealDamage(actor, target, Math.max(1, Number(burn.tickDamage || 0)), extra, t);
    pushEvent(battle, Object.assign({ at: t, actor: actorKey, action: 'dot', skillName: '화상', text: damageText('화상', hit) }, hit));
}

function doEquipmentBurnExpire(battle, actorKey, t) {
    const actor = battle[actorKey];
    const target = battle[actorKey == 'me' ? 'opp' : 'me'];
    const state = equipmentRuntime(actor);
    if (!state.burn || Number(state.burn.nextTickAt || 0) <= Number(state.burn.until || 0)) return;
    state.burn = null;
    if (target.hp <= 0 || equipmentSetCount(actor, '잿불의 장송곡') < 4) return;
    const raw = Math.max(1, Number(getLiveEquipmentStats(actor, t).atk || 0));
    const extra = { dotAttack: true, summonAttack: true, disableCritical: true, disableEquipmentBonusDamage: true, hitCount: 1, attackElement: '화' };
    const hit = dealDamage(actor, target, raw, extra, t);
    pushEvent(battle, Object.assign({ at: t, actor: actorKey, action: 'dot', skillName: '장송곡 폭발', text: damageText('장송곡 폭발', hit) }, hit));
}

function doEquipmentHellfireTick(battle, actorKey, t) {
    const actor = battle[actorKey];
    const target = battle[actorKey == 'me' ? 'opp' : 'me'];
    const state = equipmentRuntime(actor);
    const hellfire = state.hellfire;
    if (!hellfire) return;
    hellfire.nextTickAt = t + EQUIPMENT_DOT_TICK_MS;
    const hit = dealDamage(actor, target, Math.max(1, Number(hellfire.tickDamage || 0)), { dotAttack: true, disableCritical: true, disableEquipmentBonusDamage: true, hitCount: 1, attackElement: '화' }, t);
    pushEvent(battle, Object.assign({ at: t, actor: actorKey, action: 'dot', skillName: '겁화', text: damageText('겁화', hit) }, hit));
    if (t >= Number(hellfire.until || 0) || hellfire.nextTickAt > Number(hellfire.until || 0)) state.hellfire = null;
}

function doEquipmentShadowTick(battle, actorKey, t) {
    const actor = battle[actorKey];
    const target = battle[actorKey == 'me' ? 'opp' : 'me'];
    const state = equipmentRuntime(actor);
    const queue = Array.isArray(state.shadowQueue) ? state.shadowQueue : [];
    const index = queue.findIndex(entry => Number(entry && entry.dueAt || 0) <= t);
    if (index < 0) return;
    const shadow = queue.splice(index, 1)[0];
    const hit = dealDamage(actor, target, Math.max(1, Number(shadow.damage || 0)), { precalculatedDamage: true, dotAttack: true, disableEquipmentBonusDamage: true, hitCount: 1, attackElement: '암' }, t);
    pushEvent(battle, Object.assign({ at: t, actor: actorKey, action: 'dot', skillName: '그림자 공격', text: damageText('그림자 공격', hit) }, hit));
}

function doDragonRegenTick(battle, actorKey, t) {
    const actor = battle[actorKey];
    const state = equipmentRuntime(actor);
    const regen = state.dragonRegen;
    if (!regen) return;
    if (actor.hp <= 0) { state.dragonRegen = null; return; }
    const before = actor.hp;
    actor.hp = Math.min(actor.maxHp, actor.hp + Math.max(1, Math.round(actor.maxHp * .03 * (1 + Number(actor.snapshot.stats.recoveryEfficiency || 0)))));
    regen.ticksLeft = Number(regen.ticksLeft || 0) - 1;
    regen.nextTickAt = t + 1000;
    const healed = actor.hp - before;
    pushEvent(battle, { at: t, actor: actorKey, action: 'heal', heal: healed, text: '불굴 — HP +' + comma(healed) });
    if (regen.ticksLeft <= 0) state.dragonRegen = null;
}

function doEquipmentJudgment(battle, actorKey, t) {
    const actor = battle[actorKey];
    const target = battle[actorKey == 'me' ? 'opp' : 'me'];
    const state = equipmentRuntime(actor);
    const judgment = state.judgment;
    state.judgment = null;
    if (!judgment || Number(judgment.damage || 0) <= 0) return;
    const lightMultiplier = rpgenius.getElementDamageMultiplier('명', getLiveEquipmentStats(actor, t), getLiveEquipmentStats(target, t));
    const raw = Math.max(1, Math.round(Number(judgment.damage || 0) * .15 * lightMultiplier));
    const hit = dealDamage(actor, target, raw, { precalculatedDamage: true, dotAttack: true, disableEquipmentBonusDamage: true, hitCount: 1, attackElement: '명' }, t);
    pushEvent(battle, Object.assign({ at: t, actor: actorKey, action: 'dot', skillName: '천공 폭발', text: damageText('천공 폭발', hit) }, hit));
}

function doAiAction(battle, t) {
    const opp = battle.opp;
    const decision = evaluateRules(opp, battle.me, t);
    if (decision.action == 'defend') return doDefend(battle, 'opp', t);
    if (decision.action == 'skill') {
        const skill = findSideSkill(opp, decision.skillName);
        if (skill) {
            const result = doSkill(battle, 'opp', skill, t);
            if (!result || result.ok !== false) return result;
        }
    }
    return doBasicAttack(battle, 'opp', t);
}

// 시간순으로 처리해야 할 가장 이른 항목. 동시각 예약 효과는 양측 모두 해석한 뒤 KO를 판정하며,
// 예약 효과가 AI 행동과 같은 ms에 걸리면 플레이어 행동과 동일하게 기존 틱을 먼저 처리한다.
function nextDueItem(battle, limit) {
    const items = [];
    if (battle.opp.nextActionAt <= limit) items.push({ kind: 'action', side: 'opp', t: battle.opp.nextActionAt, order: 5 });
    ['me', 'opp'].forEach(key => {
        const summon = battle[key].runtime.summon;
        if (summon && summon.nextAttackAt <= limit && summon.nextAttackAt <= Number(summon.until || 0)) {
            items.push({ kind: 'summon', side: key, t: summon.nextAttackAt, order: 1 });
        }
        const mark = battle[key].runtime.mark;
        if (mark && mark.nextTickAt <= limit && mark.nextTickAt <= Number(mark.until || 0)) {
            items.push({ kind: 'mark', side: key, t: mark.nextTickAt, order: 2 });
        }
        const equipment = equipmentRuntime(battle[key]);
        const burn = equipment.burn;
        if (burn && burn.nextTickAt <= limit && burn.nextTickAt <= Number(burn.until || 0)) {
            items.push({ kind: 'burn', side: key, t: burn.nextTickAt, order: 3 });
        } else if (burn && Number(burn.nextTickAt || 0) > Number(burn.until || 0) && Number(burn.until || 0) <= limit) {
            items.push({ kind: 'burnExpire', side: key, t: Number(burn.until || 0), order: 3 });
        }
        const hellfire = equipment.hellfire;
        if (hellfire && hellfire.nextTickAt <= limit && hellfire.nextTickAt <= Number(hellfire.until || 0)) {
            items.push({ kind: 'hellfire', side: key, t: hellfire.nextTickAt, order: 3 });
        }
        const shadow = Array.isArray(equipment.shadowQueue)
            ? equipment.shadowQueue.reduce((found, entry) => !found || Number(entry.dueAt || 0) < Number(found.dueAt || 0) ? entry : found, null)
            : null;
        if (shadow && Number(shadow.dueAt || 0) <= limit) items.push({ kind: 'shadow', side: key, t: Number(shadow.dueAt), order: 3 });
        const dragonRegen = equipment.dragonRegen;
        if (dragonRegen && Number(dragonRegen.ticksLeft || 0) > 0 && Number(dragonRegen.nextTickAt || 0) <= limit) {
            items.push({ kind: 'dragonRegen', side: key, t: Number(dragonRegen.nextTickAt), order: 0 });
        }
        const judgment = equipment.judgment;
        if (judgment && Number(judgment.until || 0) <= limit) {
            items.push({ kind: 'judgment', side: key, t: Number(judgment.until || 0), order: 4 });
        }
    });
    if (items.length == 0) return null;
    items.sort((a, b) => a.t - b.t || a.order - b.order);
    return items[0];
}

function checkKo(user, battle, t) {
    if (battle.me.hp <= 0) {
        pushEvent(battle, { at: t, actor: 'me', action: 'ko', text: battle.me.name + ' 전투 불능' });
        finishBattle(user, battle, 'lose', 'ko', t);
        return true;
    }
    if (battle.opp.hp <= 0) {
        pushEvent(battle, { at: t, actor: 'opp', action: 'ko', text: battle.opp.name + ' 전투 불능' });
        finishBattle(user, battle, 'win', 'ko', t);
        return true;
    }
    return false;
}

function resolveTimeout(user, battle) {
    const t = battle.endsAt;
    const myRatio = battle.me.hp / Math.max(1, battle.me.maxHp);
    const oppRatio = battle.opp.hp / Math.max(1, battle.opp.maxHp);
    const outcome = myRatio > oppRatio ? 'win' : 'lose';
    const winner = outcome == 'win' ? battle.me.name : battle.opp.name;
    pushEvent(battle, { at: t, actor: outcome == 'win' ? 'me' : 'opp', action: 'timeout', text: '제한 시간 종료 — ' + winner + ' 판정승' });
    finishBattle(user, battle, outcome, 'timeout', t);
}

// 전투 읽기/행동 전에 항상 호출. 밀린 시간을 결정적으로 따라잡는다.
function advanceBattle(user, nowMs) {
    const state = ensurePvpState(user);
    const battle = state.battle;
    if (!battle) return null;
    const t0 = Number(nowMs != null ? nowMs : now());
    if (battle.phase == 'ended') {
        battle.lastAdvancedAt = t0;
        return battle;
    }
    if (battle.phase == 'countdown') {
        if (t0 < battle.startedAt) {
            battle.lastAdvancedAt = t0;
            return battle;
        }
        battle.phase = 'fight';
        pushEvent(battle, { at: battle.startedAt, actor: 'me', action: 'start', text: '전투 시작' });
    }
    let steps = 0;
    while (battle.phase == 'fight' && steps++ < ADVANCE_STEP_LIMIT) {
        const item = nextDueItem(battle, t0);
        if (!item || item.t >= battle.endsAt) break;
        expireStates(battle, item.t);
        if (item.kind == 'action') doAiAction(battle, item.t);
        else if (item.kind == 'summon') doSummonTick(battle, item.side, item.t);
        else if (item.kind == 'mark') doMarkTick(battle, item.side, item.t);
        else if (item.kind == 'burn') doEquipmentBurnTick(battle, item.side, item.t);
        else if (item.kind == 'burnExpire') doEquipmentBurnExpire(battle, item.side, item.t);
        else if (item.kind == 'hellfire') doEquipmentHellfireTick(battle, item.side, item.t);
        else if (item.kind == 'shadow') doEquipmentShadowTick(battle, item.side, item.t);
        else if (item.kind == 'dragonRegen') doDragonRegenTick(battle, item.side, item.t);
        else doEquipmentJudgment(battle, item.side, item.t);
        const nextAtSameTime = item.kind == 'action' ? null : nextDueItem(battle, t0);
        const deferKoForSimultaneousEffect = !!(nextAtSameTime && nextAtSameTime.kind != 'action' && nextAtSameTime.t == item.t);
        if (!deferKoForSimultaneousEffect && checkKo(user, battle, item.t)) {
            battle.lastAdvancedAt = t0;
            return battle;
        }
    }
    if (battle.phase == 'fight') {
        expireStates(battle, Math.min(t0, battle.endsAt));
        if (t0 >= battle.endsAt) resolveTimeout(user, battle);
    }
    battle.lastAdvancedAt = t0;
    return battle;
}

function playerActionGuard(user, t) {
    const battle = user.pvp.battle;
    if (!battle || battle.phase == 'ended') return { error: '진행 중인 전투가 없습니다.' };
    if (battle.phase == 'countdown') return { error: '전투 시작 전입니다.' };
    if (t < battle.me.nextActionAt) return { error: '아직 행동할 수 없습니다.' };
    return { battle };
}

function playerAttack(user) {
    const t = now();
    advanceBattle(user, t);
    const guard = playerActionGuard(user, t);
    if (guard.error) return { ok: false, message: guard.error, battle: buildBattleView(user, -1) };
    const battle = guard.battle;
    expireStates(battle, t);
    doBasicAttack(battle, 'me', t);
    checkKo(user, battle, t);
    return { ok: true, message: '', battle: buildBattleView(user, -1) };
}

function playerSkill(user, skillName) {
    const t = now();
    advanceBattle(user, t);
    const guard = playerActionGuard(user, t);
    if (guard.error) return { ok: false, message: guard.error, battle: buildBattleView(user, -1) };
    const battle = guard.battle;
    expireStates(battle, t);
    const skill = findSideSkill(battle.me, skillName);
    if (!skill) return { ok: false, message: '사용할 수 없는 스킬입니다.', battle: buildBattleView(user, -1) };
    if (Number(battle.me.skillCooldowns[skill.name] || 0) > t) return { ok: false, message: '스킬 쿨타임입니다.', battle: buildBattleView(user, -1) };
    if (skill.name == '시벌론' && Number(battle.me.runtime.sivalonCharge || 0) < 5) {
        return { ok: false, message: '일반 공격을 5회 사용해야 시벌론을 사용할 수 있습니다.', battle: buildBattleView(user, -1) };
    }
    const skillResult = doSkill(battle, 'me', skill, t);
    if (skillResult && skillResult.ok === false) return { ok: false, message: skillResult.message, battle: buildBattleView(user, -1) };
    checkKo(user, battle, t);
    return { ok: true, message: '', battle: buildBattleView(user, -1) };
}

function playerDefend(user) {
    const t = now();
    advanceBattle(user, t);
    const guard = playerActionGuard(user, t);
    if (guard.error) return { ok: false, message: guard.error, battle: buildBattleView(user, -1) };
    if (!defendUsable(guard.battle.me, t)) return { ok: false, message: '방어 쿨타임입니다.', battle: buildBattleView(user, -1) };
    doDefend(guard.battle, 'me', t);
    return { ok: true, message: '', battle: buildBattleView(user, -1) };
}

function forfeit(user) {
    const t = now();
    advanceBattle(user, t);
    const battle = user.pvp.battle;
    if (!battle) return { ok: false, message: '진행 중인 전투가 없습니다.', battle: null };
    if (battle.phase == 'ended') return { ok: true, battle: buildBattleView(user, -1) };
    pushEvent(battle, { at: t, actor: 'me', action: 'forfeit', text: battle.me.name + ' 전투 포기' });
    finishBattle(user, battle, 'lose', 'forfeit', t);
    return { ok: true, battle: buildBattleView(user, -1) };
}

function closeBattle(user) {
    const state = ensurePvpState(user);
    if (state.battle && state.battle.phase == 'ended') state.battle = null;
    return { ok: true };
}

// ===== 레이팅 =====

function eloDelta(winnerRating, loserRating) {
    const expected = 1 / (1 + Math.pow(10, (Number(loserRating) - Number(winnerRating)) / 400));
    return Math.max(1, Math.round(ELO_K * (1 - expected)));
}

function cachedRating(name, fallback) {
    const entry = ladderCache.entries.find(item => item.name == name);
    return entry ? Number(entry.rating) : Number(fallback);
}

// 같은 이름의 슬롯이 여럿일 수 있으므로(추가 플레이 재대결) 아직 대결하지 않은 슬롯을 우선 찾는다
function findOpenSlot(state, opponentName) {
    return (state.daily.opponents || []).find(entry => entry && entry.name == opponentName && !entry.result) || null;
}

// 플레이 보상: 승패 무관하게 전투 1회 종료마다 표에서 1개 지급. 아이템 데이터가 없으면 지급하지 않는다.
function grantPlayReward(user) {
    const items = rpgenius.getDataCache('Item', []);
    const roll = Math.random();
    let sum = 0;
    let entry = PLAY_REWARD_TABLE[PLAY_REWARD_TABLE.length - 1];
    for (const candidate of PLAY_REWARD_TABLE) {
        sum += candidate.chance;
        if (roll < sum) { entry = candidate; break; }
    }
    const pool = entry.pick(items);
    if (pool.length == 0) return null;
    const item = pool[randomInt(0, pool.length - 1)];
    const itemId = items.indexOf(item);
    if (itemId < 0) return null;
    rpgenius.addInventoryItem(user, itemId, 1);
    const assets = injected.getItemAssets ? injected.getItemAssets(item) : {};
    return { name: item.name, count: 1, iconUrl: assets && assets.iconUrl || null, frameUrl: assets && assets.frameUrl || null };
}

function finishBattle(user, battle, outcome, reason, t) {
    const state = ensurePvpState(user);
    battle.phase = 'ended';
    const myRating = Number(state.rating || RATING_START);
    const oppRating = cachedRating(battle.opponent, battle.opp.rating);
    const delta = outcome == 'win' ? eloDelta(myRating, oppRating) : eloDelta(oppRating, myRating);
    const myDelta = outcome == 'win' ? delta : -delta;
    const oppDelta = -myDelta;
    const ratingAfter = Math.max(0, myRating + myDelta);
    state.rating = ratingAfter;
    if (outcome == 'win') state.wins = Number(state.wins || 0) + 1;
    else state.losses = Number(state.losses || 0) + 1;
    // 퀘스트: PVP 전투/승리 목표 진행 (finishBattle 이후 호출부의 user.save 흐름으로 저장)
    if (typeof rpgenius.recordQuestEvent == 'function') rpgenius.recordQuestEvent(user, 'pvp', { win: outcome == 'win' });
    const oppRatingAfter = Math.max(0, oppRating + oppDelta);
    battle.result = {
        outcome, reason,
        ratingBefore: myRating,
        ratingAfter,
        ratingDelta: ratingAfter - myRating,
        oppRatingBefore: oppRating,
        oppRatingAfter,
        oppRatingDelta: oppRatingAfter - oppRating,
        endedAt: t,
        reward: null
    };
    const slot = findOpenSlot(state, battle.opponent);
    if (slot) {
        slot.result = outcome;
        slot.ratingDelta = battle.result.ratingDelta;
        slot.rating = oppRatingAfter; // 방어측 레이팅 변화를 상대 목록에도 바로 반영
        slot.foughtAt = t;
    }
    const reward = grantPlayReward(user);
    battle.result.reward = reward;
    if (slot) slot.reward = reward ? reward.name : null;
    pushHistory(user, { at: t, opponent: battle.opponent, role: 'attack', result: outcome, ratingDelta: battle.result.ratingDelta, reason, reward: reward ? reward.name : null });
    patchLadderEntry(user.name, state);
    // 방어측(상대) 레이팅/전적은 상대 계정 큐에서 갱신한다 (서로의 큐를 기다리며 교착되지 않도록 대기하지 않는다).
    propagateOpponentResult(battle, t).catch(e => console.error('pvp 방어측 레이팅 반영 실패 (' + battle.opponent + '):', e && e.message || e));
}

// 방어측 레이팅 반영: 상대 레코드를 새로 읽어 ∓Δ 적용 + 방어 전적 기록 + 저장
async function propagateOpponentResult(battle, t) {
    const oppName = battle.opponent;
    const delta = Number(battle.result.oppRatingDelta || 0);
    const result = battle.result.outcome == 'win' ? 'lose' : 'win';
    const applyToOpponent = async () => {
        const target = await rpgenius.getRPGUserByName(oppName);
        if (!target) throw new Error('상대 유저를 찾을 수 없습니다.');
        const state = ensurePvpState(target);
        state.rating = Math.max(0, Number(state.rating || RATING_START) + delta);
        if (result == 'win') state.wins = Number(state.wins || 0) + 1;
        else state.losses = Number(state.losses || 0) + 1;
        pushHistory(target, { at: t, opponent: battle.me.name, role: 'defense', result, ratingDelta: delta, reason: battle.result.reason });
        await target.save();
        patchLadderEntry(oppName, state);
    };
    const seed = battle.opp.userId != null ? { id: battle.opp.userId, name: oppName } : await rpgenius.getRPGUserByName(oppName);
    if (!seed) throw new Error('상대 유저를 찾을 수 없습니다.');
    await rpgenius.enqueueFieldAction(seed, applyToOpponent);
}

// ===== 매칭 / 랭킹 캐시 =====

let ladderCache = { at: 0, entries: [] };
let ladderLoading = null; // 동시 요청이 getAllRPGUsers를 중복 호출하지 않도록 진행 중인 빌드를 공유

function patchLadderEntry(name, state) {
    const entry = ladderCache.entries.find(item => item.name == name);
    if (!entry) return;
    entry.rating = Number(state.rating || RATING_START);
    entry.wins = Number(state.wins || 0);
    entry.losses = Number(state.losses || 0);
}

function ladderDisplay(user) {
    const deck = resolveDefenseDeck(user);
    const card = injected.serializeCard ? injected.serializeCard(deck.mainCard, user) : null;
    return {
        cardName: card && card.name || '',
        cardFormatted: card && card.formatted || '',
        cardImageUrl: card && card.imageUrl || null,
        cardStar: card ? Number(card.star || 0) : 0,
        cardType: card && card.type || '일반',
        cardSkin: card && card.skin || '',
        spriteUrl: injected.getCharacterSprite ? injected.getCharacterSprite(card) : null
    };
}

async function getLadder(force) {
    if (!force && ladderCache.entries.length > 0 && now() - ladderCache.at < LADDER_TTL_MS) return ladderCache.entries;
    if (ladderLoading) return ladderLoading;
    ladderLoading = (async () => {
        const users = await rpgenius.getAllRPGUsers();
        const entries = users
            .filter(user => user && user.name && user.main_card && typeof user.main_card.id != 'undefined')
            .map(user => Object.assign({
                name: user.name,
                level: Number(user.level || 1),
                rating: readRating(user),
                wins: Number(user.pvp && user.pvp.wins || 0),
                losses: Number(user.pvp && user.pvp.losses || 0)
            }, ladderDisplay(user)));
        ladderCache = { at: now(), entries };
        return entries;
    })();
    try {
        return await ladderLoading;
    } finally {
        ladderLoading = null;
    }
}

function getRanking(ladder) {
    return ladder.slice()
        .sort((a, b) => b.rating - a.rating || b.wins - a.wins || a.name.localeCompare(b.name, 'ko-KR'))
        .slice(0, 3)
        .map((entry, index) => ({
            rank: index + 1,
            name: entry.name,
            level: entry.level,
            rating: entry.rating,
            wins: entry.wins,
            losses: entry.losses,
            cardName: entry.cardName,
            cardImageUrl: entry.cardImageUrl
        }));
}

function opponentSlot(entry, kind) {
    return {
        name: entry.name,
        level: entry.level,
        rating: entry.rating,
        cardName: entry.cardName,
        cardFormatted: entry.cardFormatted,
        cardImageUrl: entry.cardImageUrl,
        cardStar: entry.cardStar,
        cardType: entry.cardType,
        cardSkin: entry.cardSkin,
        spriteUrl: entry.spriteUrl || null,
        kind,
        result: null,
        ratingDelta: 0,
        foughtAt: null
    };
}

// kinds 순서대로 상대를 뽑는다. 풀이 작으면 뽑히는 수가 줄어들 뿐 중복은 없다.
function pickOpponents(user, ladder, kinds, excludeNames) {
    const myRating = readRating(user);
    const exclude = new Set(excludeNames);
    exclude.add(user.name);
    const pool = ladder.filter(entry => !exclude.has(entry.name));
    const picked = [];
    const remaining = () => pool.filter(entry => picked.indexOf(entry) < 0);
    const nearPool = pool.slice().sort((a, b) =>
        Math.abs(a.rating - myRating) - Math.abs(b.rating - myRating) || a.name.localeCompare(b.name, 'ko-KR')).slice(0, 10);
    const result = [];
    kinds.forEach(kind => {
        let candidates;
        if (kind == 'near') candidates = nearPool.filter(entry => picked.indexOf(entry) < 0);
        else if (kind == 'higher') candidates = remaining().filter(entry => entry.rating > myRating);
        else candidates = remaining();
        if (kind == 'higher' && candidates.length == 0) {
            candidates = remaining().sort((a, b) => b.rating - a.rating).slice(0, 1);
        }
        if (candidates.length == 0) return;
        const entry = candidates[randomInt(0, candidates.length - 1)];
        picked.push(entry);
        result.push(opponentSlot(entry, kind));
    });
    return result;
}

function generateOpponents(user, ladder, keepSlots) {
    const fought = (user.pvp.daily.opponents || []).filter(slot => slot && slot.result).map(slot => slot.name);
    const kept = (keepSlots || []).filter(Boolean).map(slot => slot.name);
    return pickOpponents(user, ladder, OPPONENT_KINDS, fought.concat(kept));
}

// 오늘 자 상태 보정 (필요할 때만 상대 목록 생성). 저장이 필요하면 true를 돌려준다.
async function ensureDaily(user) {
    const hadState = !!(user.pvp && user.pvp.daily);
    const previousDate = user.pvp && user.pvp.daily && user.pvp.daily.date;
    const state = ensurePvpState(user);
    let changed = !hadState || previousDate != state.daily.date;
    if (state.daily.opponents.length == 0) {
        const rolled = generateOpponents(user, await getLadder(false), []);
        if (rolled.length > 0) {
            state.daily.opponents = rolled;
            changed = true;
        }
    }
    return changed;
}

async function refreshOpponents(user) {
    const state = ensurePvpState(user);
    if (Number(state.daily.refreshUsed || 0) >= DAILY_REFRESH_MAX) return { ok: false, message: '새로고침 횟수를 모두 사용했습니다.' };
    const slots = state.daily.opponents || [];
    const keep = slots.filter(slot => slot && slot.result);
    if (slots.length == 0 || keep.length == slots.length) return { ok: false, message: '새로고침할 상대가 없습니다.' };
    const kinds = slots.filter(slot => !slot || !slot.result).map(slot => slot.kind || 'random');
    const rolled = pickOpponents(user, await getLadder(false), kinds, keep.map(slot => slot.name));
    let index = 0;
    state.daily.opponents = slots.map(slot => (slot && slot.result) ? slot : (rolled[index++] || null)).filter(Boolean);
    state.daily.refreshUsed = Number(state.daily.refreshUsed || 0) + 1;
    return { ok: true, message: '오늘의 상대를 새로 뽑았습니다.', daily: buildDailyView(user) };
}

function getExtraPlayCost(user) {
    return rpgenius.isBlessingActive(user, 'divine', now()) ? 0 : EXTRA_PLAY_COST;
}

// 추가 플레이: 신성한 유생의 축복이 없으면 가넷을 내고 상대 슬롯 1개를 추가한다.
async function buyExtraPlay(user) {
    const state = ensurePvpState(user);
    const cost = getExtraPlayCost(user);
    if (Number(state.daily.extraUsed || 0) >= EXTRA_PLAY_MAX) return { ok: false, message: '오늘의 추가 플레이 횟수를 모두 사용했습니다.' };
    if (Number(user.garnet || 0) < cost) return { ok: false, message: '가넷이 부족합니다. (' + cost + '가넷 필요)' };
    const open = (state.daily.opponents || []).filter(slot => slot && !slot.result).map(slot => slot.name);
    const rolled = pickOpponents(user, await getLadder(false), ['near'], open);
    if (rolled.length == 0) return { ok: false, message: '추가로 매칭할 상대가 없습니다.' };
    rolled[0].kind = 'extra';
    user.garnet = Number(user.garnet || 0) - cost;
    state.daily.opponents.push(rolled[0]);
    state.daily.extraUsed = Number(state.daily.extraUsed || 0) + 1;
    return { ok: true, message: cost > 0 ? '추가 상대가 매칭되었습니다. (가넷 -' + cost + ')' : '추가 상대가 매칭되었습니다. (축복 무료)', daily: buildDailyView(user), garnet: Number(user.garnet || 0) };
}

// ===== 전투 시작 =====

async function startBattle(user, opponentName) {
    const state = ensurePvpState(user);
    await ensureDaily(user);
    advanceBattle(user); // 방치된 전투는 시간 초과로 먼저 정리한다
    if (state.battle && state.battle.phase != 'ended') return { ok: false, message: '이미 진행 중인 전투가 있습니다.' };
    const listed = (state.daily.opponents || []).some(entry => entry && entry.name == opponentName);
    if (!listed) return { ok: false, message: '오늘의 상대 목록에 없는 상대입니다.' };
    if (!findOpenSlot(state, opponentName)) return { ok: false, message: '이미 대결한 상대입니다.' };
    if (!user.main_card || typeof user.main_card.id == 'undefined') return { ok: false, message: '메인 카드를 먼저 장착해주세요.' };
    const opponent = await rpgenius.getRPGUserByName(opponentName);
    if (!opponent) return { ok: false, message: '상대를 찾을 수 없습니다.' };
    const oppDeck = resolveDefenseDeck(opponent);
    if (!oppDeck.mainCard || typeof oppDeck.mainCard.id == 'undefined') return { ok: false, message: '상대의 방어 덱이 준비되지 않았습니다.' };
    const t = now();
    const me = makeSide(user, buildSideSnapshot(user, equippedDeck(user)), null);
    const opp = makeSide(opponent, buildSideSnapshot(opponent, oppDeck), oppDeck.rules);
    const startedAt = t + COUNTDOWN_MS;
    // 시작 시 모든 행동을 최대 쿨타임 상태로 둔다: 일반 행동 3초, 방어 10초, 스킬은 각자 쿨타임(최대 60초)
    [me, opp].forEach(side => {
        side.enteredAt = startedAt;
        side.nextActionAt = startedAt + ACTION_COOLDOWN_MAX_MS;
        side.defendCooldownEnd = startedAt + DEFEND_COOLDOWN_MS;
        sideSkills(side).forEach(skill => {
            side.skillCooldowns[skill.name] = startedAt + Math.min(START_COOLDOWN_CAP_MS, Math.round(skillCooldownMs(side, skill)));
        });
    });
    state.battle = {
        id: 'pvp' + t.toString(36) + Math.random().toString(36).slice(2, 8),
        opponent: opponentName,
        createdAt: t,
        startedAt,
        endsAt: startedAt + BATTLE_LIMIT_MS,
        phase: 'countdown',
        seq: 0,
        lastAdvancedAt: t,
        me,
        opp,
        events: [],
        result: null
    };
    return { ok: true, message: '', battle: buildBattleView(user, -1) };
}

// ===== 뷰 =====

function buffViews(side) {
    const labels = {
        receivedDamageReduction: '피해 감소',
        receivedDamageMul: '받는 피해 증가',
        pntBuff: '방어 관통',
        nextBasicDamageBonus: '다음 일반 공격 강화',
        nextSkillDamageBonus: '다음 스킬 강화',
        nextDamageReduction: '다음 피해 감소',
        nextFinalDamageBonus: '다음 공격 최종 피해'
    };
    const views = Object.keys(side.runtime.buffs).map(key => ({ name: labels[key] || key, until: Number(side.runtime.buffs[key].until || 0) }));
    if (side.runtime.gunryeok) views.push({ name: '건력', until: Number(side.runtime.gunryeok.until || 0) });
    if (side.runtime.sivalon) views.push({ name: '시벌론', until: Number(side.runtime.sivalon.until || 0) });
    const equipment = equipmentRuntime(side);
    const equipmentLabels = {
        manaBurnAttackBuff: '마나번 · 공격', manaBurnElementBuff: '마나번 · 속성',
        manaBurnCritBuff: '마나번 · 치명타', manaBurnExtraBuff: '마나번 · 추가 피해',
        encoreBuff: '앵콜', bloodHatBuff: '핏빛 모자', coinBuff: '일레이나의 동전',
        liberationBuff: '해방의 열쇠', ultimatumHatBuff: '최후통첩 모자',
        destinyDiceBuff: '운명의 주사위', judgeDiceBuff: '심판의 주사위',
        cleanWaterBuff: '정수 필터망', deepWaterAttackBuff: '심해 수속성 강화',
        darkAttackBuff: '심연 암속성 강화', blackEchoShoesBuff: '검은 잔향',
        fortuneExtraDamage: '행운의 복주머니', culprit: '피의 서약', abyssBuff: '심연'
    };
    Object.keys(equipmentLabels).forEach(key => {
        const buff = equipment[key];
        if (buff && Number(buff.until || 0) > now()) views.push({ name: equipmentLabels[key], until: Number(buff.until) });
    });
    if (equipment.judgment) views.push({ name: '천공의 심판', until: Number(equipment.judgment.until || 0) });
    if (equipment.burn) views.push({ name: '상대 화상', until: Number(equipment.burn.until || 0) });
    if (equipment.hellfire) views.push({ name: '상대 겁화', until: Number(equipment.hellfire.until || 0) });
    if (Number(equipment.deepNextBasic || 0) > 0) views.push({ name: '다음 일반 공격 · 심해', until: 0 });
    if (Number(equipment.dropoutStacks || 0) > 0) views.push({ name: '중퇴 ' + Math.min(4, Number(equipment.dropoutStacks)) + '중첩', until: 0 });
    if (Number(equipment.trueBeomUntil || 0) > now()) views.push({ name: '진정한 범부', until: Number(equipment.trueBeomUntil) });
    if (Array.isArray(equipment.shadowQueue) && equipment.shadowQueue.length > 0) views.push({ name: '그림자 공격 대기', until: Number(equipment.shadowQueue[0].dueAt || 0) });
    if ((equipmentStage(side, '판테온 레거시') || equipmentStage(side, '리턴즈파겜')) && Number(equipment.attackCount || 0) >= 0) {
        const order = equipmentStage(side, '리턴즈파겜') ? ((Number(equipment.attackCount || 0) + 1) % 3) + 1 : (Number(equipment.attackCount || 0) % 3) + 1;
        views.push({ name: '다음 공격 순서 ' + order, until: 0 });
    }
    return views;
}

function buildSideView(side) {
    const display = side.snapshot.display || {};
    const meta = {};
    (display.skillsMeta || []).forEach(entry => { meta[entry.name] = entry; });
    return {
        name: side.name,
        level: side.level,
        rating: side.rating,
        hp: side.hp,
        maxHp: side.maxHp,
        mp: side.mp,
        maxMp: side.maxMp,
        shield: Number(side.shield && side.shield.amount || 0),
        defending: isDefending(side, now()),
        defendUntil: Number(side.defendUntil || 0),
        defendCooldownEnd: Number(side.defendCooldownEnd || 0),
        nextActionAt: Number(side.nextActionAt || 0),
        cardName: display.cardName || '',
        cardFormatted: display.cardFormatted || '',
        cardImageUrl: display.cardImageUrl || null,
        cardStar: Number(display.cardStar || 0),
        cardType: display.cardType || '일반',
        cardSkin: display.cardSkin || '',
        spriteUrl: display.spriteUrl || null,
        skills: sideSkills(side).map(skill => ({
            name: skill.name,
            element: skill.element || null,
            mpCost: Number(meta[skill.name] && meta[skill.name].mpCost || 0),
            cooldownEnd: Number(side.skillCooldowns[skill.name] || 0),
            cooltimeText: meta[skill.name] && meta[skill.name].cooltimeText || '',
            descLines: meta[skill.name] && meta[skill.name].descLines || []
        })),
        buffs: buffViews(side),
        summon: side.runtime.summon ? { name: side.runtime.summon.name, until: Number(side.runtime.summon.until || 0), hp: side.runtime.summon.hp } : null,
        mark: side.runtime.mark ? { until: Number(side.runtime.mark.until || 0) } : null
    };
}

function buildBattleView(user, since) {
    const battle = user.pvp && user.pvp.battle;
    if (!battle) return { ok: true, serverNow: now(), active: false, battle: null };
    const from = Number.isFinite(Number(since)) ? Number(since) : -1;
    return {
        ok: true,
        serverNow: now(),
        active: true,
        phase: battle.phase,
        id: battle.id,
        startedAt: battle.startedAt,
        endsAt: battle.endsAt,
        seq: battle.seq,
        me: buildSideView(battle.me),
        opp: buildSideView(battle.opp),
        events: battle.events.filter(event => event.seq > from),
        result: battle.result ? {
            outcome: battle.result.outcome,
            reason: battle.result.reason,
            ratingBefore: battle.result.ratingBefore,
            ratingAfter: battle.result.ratingAfter,
            ratingDelta: battle.result.ratingDelta,
            oppRatingBefore: battle.result.oppRatingBefore,
            oppRatingAfter: battle.result.oppRatingAfter,
            oppRatingDelta: battle.result.oppRatingDelta,
            reward: battle.result.reward || null
        } : null
    };
}

function buildDailyView(user) {
    const daily = user.pvp.daily;
    const battlesUsed = (daily.opponents || []).filter(slot => slot && slot.result).length;
    const refreshUsed = Number(daily.refreshUsed || 0);
    const extraUsed = Number(daily.extraUsed || 0);
    const extraCost = getExtraPlayCost(user);
    return {
        date: daily.date,
        battlesUsed,
        battlesMax: DAILY_BATTLE_MAX + extraUsed,
        refreshUsed,
        refreshMax: DAILY_REFRESH_MAX,
        canRefresh: refreshUsed < DAILY_REFRESH_MAX && (daily.opponents || []).some(slot => slot && !slot.result),
        extraUsed,
        extraMax: EXTRA_PLAY_MAX,
        extraCost,
        extraFree: extraCost === 0,
        canBuyExtra: extraUsed < EXTRA_PLAY_MAX,
        opponents: (daily.opponents || []).map(slot => ({
            name: slot.name,
            level: slot.level,
            rating: slot.rating,
            cardName: slot.cardName,
            cardFormatted: slot.cardFormatted,
            cardImageUrl: slot.cardImageUrl,
            cardStar: slot.cardStar,
            cardType: slot.cardType,
            spriteUrl: slot.spriteUrl || null,
            kind: slot.kind,
            result: slot.result,
            ratingDelta: Number(slot.ratingDelta || 0),
            reward: slot.reward || null
        }))
    };
}

function cardView(card, user) {
    if (!card) return null;
    const serialized = injected.serializeCard ? injected.serializeCard(card, user) : null;
    if (!serialized) return null;
    return Object.assign({}, serialized, { sig: rpgenius.cardPresetSignature(card) });
}

function buildDefenseView(user) {
    const deck = resolveDefenseDeck(user);
    const maxSlots = Number(user.maxCardSlot || 5);
    const slotCards = [];
    for (let i = 0; i < maxSlots; i++) slotCards.push(cardView(deck.cardSlot[i] || null, user));
    return {
        useEquipped: deck.useEquipped,
        valid: deck.valid,
        maxSlots,
        mainCard: cardView(deck.mainCard, user),
        slotCards,
        rules: deck.rules,
        skills: rpgenius.getMainCardSkills({ main_card: deck.mainCard }).map(entry => ({ name: entry.skill.name }))
    };
}

function buildCardList(user) {
    const cards = [];
    if (user.main_card && typeof user.main_card.id != 'undefined') {
        const view = cardView(user.main_card, user);
        if (view) cards.push(Object.assign(view, { location: 'main' }));
    }
    (Array.isArray(user.card_slot) ? user.card_slot : []).forEach(card => {
        const view = cardView(card, user);
        if (view) cards.push(Object.assign(view, { location: 'slot' }));
    });
    (user.inventory && Array.isArray(user.inventory.card) ? user.inventory.card : []).forEach(card => {
        const view = cardView(card, user);
        if (view) cards.push(Object.assign(view, { location: 'inventory' }));
    });
    return cards;
}

async function buildPvpOverview(user) {
    const state = ensurePvpState(user);
    await ensureDaily(user);
    const ladder = await getLadder(false);
    const ranking = getRanking(ladder);
    const myRank = ranking.find(entry => entry.name == user.name);
    const mainCard = injected.serializeCard ? injected.serializeCard(user.main_card, user) : null;
    const battle = state.battle;
    return {
        ok: true,
        serverNow: now(),
        me: {
            name: user.name,
            level: Number(user.level || 1),
            rating: Number(state.rating || RATING_START),
            wins: Number(state.wins || 0),
            losses: Number(state.losses || 0),
            rank: myRank ? myRank.rank : null,
            garnet: Number(user.garnet || 0),
            mainCard: mainCard ? {
                name: mainCard.name,
                formatted: mainCard.formatted,
                imageUrl: mainCard.imageUrl,
                star: Number(mainCard.star || 0),
                type: mainCard.type,
                spriteUrl: injected.getCharacterSprite ? injected.getCharacterSprite(mainCard) : null
            } : null
        },
        daily: buildDailyView(user),
        defense: buildDefenseView(user),
        cards: buildCardList(user),
        ranking,
        history: (state.history || []).map(entry => ({
            at: Number(entry.at || 0),
            opponent: entry.opponent,
            role: entry.role,
            result: entry.result,
            ratingDelta: Number(entry.ratingDelta || 0),
            reason: entry.reason,
            reward: entry.reward || null
        })),
        battle: battle ? {
            active: battle.phase != 'ended',
            phase: battle.phase,
            opponent: battle.opponent,
            opponentCardImageUrl: battle.opp.snapshot.display && battle.opp.snapshot.display.cardImageUrl || null
        } : null
    };
}

module.exports = {
    configure,
    ensurePvpState,
    ensureDaily,
    resolveDefenseDeck,
    validateDefensePayload,
    saveDefense,
    buildSideSnapshot,
    evaluateRules,
    startBattle,
    advanceBattle,
    playerAttack,
    playerSkill,
    playerDefend,
    forfeit,
    closeBattle,
    finishBattle,
    eloDelta,
    getLadder,
    generateOpponents,
    refreshOpponents,
    getExtraPlayCost,
    buyExtraPlay,
    buildBattleView,
    buildPvpOverview,
    DEFAULT_RULES,
    __setNow
};
