// PVP — 비동기 대전 모듈.
// 상대는 방어 덱(카드 + AI 규칙)만 스냅샷으로 복제해 공격자 레코드 위에서 순수하게 시뮬레이션한다.
// 상대 레코드는 전투 중에는 절대 건드리지 않고, 종료 시 레이팅/전적만 상대 계정 큐로 반영한다.
const fs = require('fs');
const path = require('path');
const rpgenius = require('./rpgenius.js');

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
    return {
        stats: rpgenius.calculateUserStats(clone),
        slotEffects: rpgenius.calculateCardSlotEffects(clone),
        skillIndexes: skills.map(entry => Number(entry.index)),
        elementChain: rpgenius.getEquipmentElementChain(clone),
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
        runtime: { buffs: {}, nmmStacks: 0, sivalonCharge: 0, sivalon: null, gunryeok: null, summon: null, mark: null }
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

function skillUsable(side, skill, t) {
    if (Number(side.skillCooldowns[skill.name] || 0) > t) return false;
    if (side.mp < skillMpCost(side, skill)) return false;
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
    battle.events.push(Object.assign({ seq: battle.seq, damage: 0, criticalCount: 0, hitCount: 0, dodged: false, absorbed: 0 }, event));
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

function receivedDamageReduction(side) {
    const buff = side.runtime.buffs.receivedDamageReduction;
    const gunryeok = side.runtime.gunryeok;
    return Number(buff && buff.value || 0) + Number(gunryeok && gunryeok.dmgReduce || 0);
}

function receivedDamageMul(side) {
    const buff = side.runtime.buffs.receivedDamageMul;
    return buff ? Math.max(0, Number(buff.value || 1)) : 1;
}

function outgoingMul(side) {
    const gunryeok = side.runtime.gunryeok;
    const summon = side.runtime.summon;
    return (1 + Number(gunryeok && gunryeok.atkBuff || 0)) * (1 + Number(summon && summon.buff || 0));
}

function attackElementOf(side, skill) {
    const chain = side.snapshot.elementChain || {};
    if (chain.weapon) return chain.weapon;
    if (skill && skill.element && rpgenius.ELEMENT_ATK_KEYS[skill.element]) return skill.element;
    return chain.rest || null;
}

function setShield(side, amount, durationMs, t) {
    if (side.snapshot.stats.disableShield) return 0;
    const value = Math.max(0, Math.round(amount));
    side.shield = { amount: value, until: t + durationMs };
    return value;
}

// 피해 계산 — 양방향 동일. 솔로 buildHuntResult + calculateMonsterAttackHitResult 순서를 그대로 따른다.
function dealDamage(attacker, defender, rawDamage, extra, t) {
    if (Math.random() < Number(defender.snapshot.stats.avd || 0)) return { damage: 0, criticalCount: 0, hitCount: 0, absorbed: 0, dodged: true };
    const aStats = attacker.snapshot.stats;
    const aSlot = attacker.snapshot.slotEffects;
    const dStats = defender.snapshot.stats;
    const dSlot = defender.snapshot.slotEffects;
    let base = Number(rawDamage || 0)
        * (1 + Number(dStats.takenDamage || 0))
        * (1 - Math.min(1, Number(dSlot.hpDamageReduction || 0)))
        * (1 - Math.min(1, receivedDamageReduction(defender)))
        * receivedDamageMul(defender);
    // 솔로 buildHuntResult의 damageWithSlotBonus (피해 증가 스탯/슬롯효과)
    if (!extra.precalculatedDamage) base = base * (1 + Number(aSlot.damageBonus || 0)) * (1 + Number(aStats.damageBonus || 0));
    extra.attackElement = attackElementOf(attacker, extra.skill);
    delete extra.skill;
    if (!extra.attackElement && Number(aSlot.nonElementFinalDamage || 0) > 0) {
        extra.finalDamageBonus = Number(extra.finalDamageBonus || 0) + Number(aSlot.nonElementFinalDamage || 0);
    }
    // 보호막 공격 시 최종 피해 증가 (전직 흠시원 슬롯 효과)
    if (defender.shield && Number(defender.shield.amount || 0) > 0 && Number(aSlot.shieldFinalDamage || 0) > 0) {
        extra.finalDamageBonus = Number(extra.finalDamageBonus || 0) + Number(aSlot.shieldFinalDamage || 0);
    }
    if (Number(aSlot.tenthHitFinalAtk || 0) > 0) {
        extra.tenthAtkBonus = Number(aSlot.tenthHitFinalAtk || 0);
        extra.tenthAtkStart = Number(attacker.attackCount || 0);
    }
    if (defender.runtime.mark) extra.defReductionBonus = Number(extra.defReductionBonus || 0) + Number(defender.runtime.mark.defReduce || 0);
    const pntBuff = attacker.runtime.buffs.pntBuff;
    let pntBonus = Number(pntBuff && pntBuff.value || 0);
    if (extra.isBasic && attacker.runtime.buffs.nextFinalDamageBonus) {
        extra.finalDamageBonus = Number(extra.finalDamageBonus || 0) + Number(attacker.runtime.buffs.nextFinalDamageBonus.value || 0);
        delete attacker.runtime.buffs.nextFinalDamageBonus;
    }
    const penetration = (extra.pnt != null ? Number(extra.pnt) : Number(aStats.pnt || 0)) + pntBonus;
    const defense = Math.max(0, Number(dStats.def || 0) - Number(aStats.atkDefReduce || 0));
    const result = rpgenius.calculateAttackHitResult(base, defense, penetration, aStats, aSlot, extra, dStats);
    let damage = Math.max(0, Math.round(Number(result.finalDamage || 0)));
    const nextReduction = defender.runtime.buffs.nextDamageReduction;
    if (nextReduction) {
        damage = Math.round(damage * (1 - Number(nextReduction.value || 0)));
        delete defender.runtime.buffs.nextDamageReduction;
    }
    if (isDefending(defender, t)) damage = Math.round(damage * 0.5);
    const summon = defender.runtime.summon;
    if (summon && summon.hp != null && Number(summon.hp) > 0) {
        const absorb = Math.round(damage * 0.3);
        damage -= absorb;
        summon.hp = Number(summon.hp) - absorb;
        if (summon.hp <= 0) defender.runtime.summon = null;
    }
    let absorbed = 0;
    if (defender.shield && Number(defender.shield.amount || 0) > 0) {
        absorbed = Math.min(Number(defender.shield.amount), damage);
        defender.shield.amount -= absorbed;
        damage -= absorbed;
        if (defender.shield.amount <= 0) defender.shield = null;
    }
    defender.hp = Math.max(0, defender.hp - damage);
    const units = Math.max(1, Number(result.attackUnitCount || 1));
    attacker.attackCount = Number(attacker.attackCount || 0) + units;
    if (extra.buildNmmStack) attacker.runtime.nmmStacks = Math.min(9, Number(attacker.runtime.nmmStacks || 0) + units);
    return { damage, criticalCount: Number(result.criticalCount || 0), hitCount: Number(result.hitCount || 1), absorbed, dodged: false };
}

function damageText(label, hit) {
    if (hit.dodged) return label + ' — 회피';
    return label + ' — ' + (hit.criticalCount > 0 ? '치명타 ' : '') + comma(hit.damage) + ' 피해';
}

function hasSkill(side, skillName) {
    return sideSkills(side).some(skill => skill.name == skillName);
}

function doBasicAttack(battle, actorKey, t) {
    const actor = battle[actorKey];
    const target = battle[actorKey == 'me' ? 'opp' : 'me'];
    const stats = actor.snapshot.stats;
    const slotEffects = actor.snapshot.slotEffects;
    const nextBasic = actor.runtime.buffs.nextBasicDamageBonus;
    const nextBasicBonus = Number(nextBasic && nextBasic.value || 0);
    if (nextBasic) delete actor.runtime.buffs.nextBasicDamageBonus;
    const sivalonActive = !!(actor.runtime.sivalon && Number(actor.runtime.sivalon.until || 0) > t);
    if (!sivalonActive && hasSkill(actor, '시벌론')) actor.runtime.sivalonCharge = Math.min(5, Number(actor.runtime.sivalonCharge || 0) + 1);
    const rawDamage = Math.round(Number(stats.atk || 0) * (1 + Number(stats.afterBasic || 0) + Number(slotEffects.basicDamageBonus || 0) + nextBasicBonus) * outgoingMul(actor));
    const extra = { isBasic: true, buildNmmStack: hasSkill(actor, '나인 멘스 모리스') };
    const hit = dealDamage(actor, target, rawDamage, extra, t);
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

// ===== 스킬 효과 매핑 (솔로 executeMainCardSkillInField 미러, 초월 장비 훅은 범위 밖) =====

function doSkill(battle, actorKey, skill, t) {
    const actor = battle[actorKey];
    const targetKey = actorKey == 'me' ? 'opp' : 'me';
    const target = battle[targetKey];
    const stats = actor.snapshot.stats;
    const slotEffects = actor.snapshot.slotEffects;
    const star = Number(actor.snapshot.star || 0);
    const value = (index) => rpgenius.getSkillValue(skill, index, star);
    const name = skill.name;
    const mpCost = skillMpCost(actor, skill);
    actor.mp = Math.max(0, actor.mp - mpCost);
    actor.skillCooldowns[name] = t + skillCooldownMs(actor, skill);
    actor.nextActionAt = t + actionCooldownMs(actor, false, t);
    // 건력 상태에서 다른 스킬을 쓰면 해제된다
    if (name != '건력' && actor.runtime.gunryeok) clearGunryeok(actor);

    let multiplier = value(0);
    const extra = { isSkill: true, skill };

    if (name == '시벌론') {
        actor.runtime.sivalon = { until: t + Math.round(value(0) * 1000) };
        actor.runtime.sivalonCharge = 0;
        actor.nextActionAt = t; // 사용 즉시 일반 공격 가능
        pushEvent(battle, { at: t, actor: actorKey, action: 'skill', skillName: name, text: name + ' — 일반 공격 쿨타임 단축' });
        return;
    }
    if (name == '건력') {
        if (actor.runtime.gunryeok) {
            clearGunryeok(actor);
            pushEvent(battle, { at: t, actor: actorKey, action: 'skill', skillName: name, text: name + ' — 상태 해제' });
            return;
        }
        // 솔로와 동일: 최대 HP를 70% 봉인(실질 30%)하고 현재 HP를 그 위로 잘라낸다
        const sealed = Math.max(1, Math.round(actor.maxHp * 0.3));
        actor.runtime.gunryeok = { until: t + 60000, dmgReduce: value(0), atkBuff: value(1), maxHpBefore: actor.maxHp };
        actor.maxHp = sealed;
        actor.hp = Math.min(actor.hp, sealed);
        pushEvent(battle, { at: t, actor: actorKey, action: 'skill', skillName: name, text: name + ' — 상태 진입' });
        return;
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
        pushEvent(battle, { at: t, actor: actorKey, action: 'skill', skillName: name, text: name + ' — 소환 완료' });
        return;
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
        pushEvent(battle, { at: t, actor: actorKey, action: 'skill', skillName: name, text: name + ' — 소환 완료' });
        return;
    }
    if (name == '유서새김') {
        const dot = Math.max(1, Math.round(Number(stats.atk || 0) * value(1) * (1 + Number(stats.dotDamage || 0))));
        target.runtime.mark = { defReduce: value(0), dot, until: t + 10000, nextTickAt: t + MARK_TICK_MS };
        pushEvent(battle, { at: t, actor: actorKey, action: 'skill', skillName: name, text: name + ' — 표식 부여' });
        return;
    }
    if (name == '범인은 이 안에') {
        const hpCost = Math.floor(actor.hp * 0.1);
        actor.hp = Math.max(1, actor.hp - hpCost);
        actor.runtime.buffs.pntBuff = { value: value(0), until: t + 10000 };
        actor.runtime.buffs.nextFinalDamageBonus = { value: value(1), until: null };
        pushEvent(battle, { at: t, actor: actorKey, action: 'skill', skillName: name, selfDamage: hpCost, text: name + ' — 방어 관통 강화' });
        return;
    }

    if (name == '나인 멘스 모리스') {
        const stacks = Math.min(9, Number(actor.runtime.nmmStacks || 0));
        multiplier = value(0) * (1 + value(1) * stacks);
        if (stacks >= 9) extra.defReductionBonus = Number(extra.defReductionBonus || 0) + 0.5;
        actor.runtime.nmmStacks = 0;
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
    if (name == '초특급한탕' && Math.random() < 0.1) multiplier = value(1);
    if (name == '불사조') {
        extra.damageBonusMul = Number(extra.damageBonusMul || 0) + Number(stats.crit || 0) * 0.5;
        actor.runtime.buffs.receivedDamageMul = { value: 1.5, until: t + 4000 };
    }
    if (name == '처형박수') {
        extra.damageBonusMul = Number(extra.damageBonusMul || 0) + Number(stats.crit || 0);
        actor.runtime.buffs.receivedDamageMul = { value: 2.0, until: t + 8000 };
    }
    if (name == '수업끝') {
        extra.disableCritical = true;
        actor.runtime.buffs.receivedDamageReduction = { value: 0.3, until: t + 3000 };
    }
    if (name == '자인') actor.runtime.buffs.nextBasicDamageBonus = { value: value(1), until: null };
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
    if (shieldAmount > 0) pushEvent(battle, { at: t, actor: actorKey, action: 'shield', skillName: name, shield: shieldAmount, text: name + ' — 보호막 ' + comma(shieldAmount) });

    let nextSkillBonus = 0;
    if (!extra.basicAttackSkill && actor.runtime.buffs.nextSkillDamageBonus && name != '유드 알레프') {
        nextSkillBonus = Number(actor.runtime.buffs.nextSkillDamageBonus.value || 0);
        delete actor.runtime.buffs.nextSkillDamageBonus;
    }
    const rawDamage = extra.basicAttackSkill
        ? Math.round(Number(stats.atk || 0) * multiplier * (1 + Number(stats.afterBasic || 0) + Number(slotEffects.basicDamageBonus || 0)) * outgoingMul(actor))
        : Math.round(Number(stats.atk || 0) * multiplier * (1 + Number(stats.afterSkill || 0) + Number(slotEffects.skillDamageBonus || 0) + nextSkillBonus) * outgoingMul(actor));
    if (extra.basicAttackSkill && hasSkill(actor, '나인 멘스 모리스')) extra.buildNmmStack = true;
    const hit = dealDamage(actor, target, rawDamage, extra, t);
    pushEvent(battle, Object.assign({ at: t, actor: actorKey, action: 'skill', skillName: name, text: damageText(name, hit) }, hit));
}

function doSummonTick(battle, actorKey, t) {
    const actor = battle[actorKey];
    const target = battle[actorKey == 'me' ? 'opp' : 'me'];
    const summon = actor.runtime.summon;
    summon.nextAttackAt = t + (SUMMON_TICK_MS[summon.name] || 5000);
    // 솔로 소환수 틱과 동일: 단일 타격, 장비 추가 피해 제외
    const raw = Math.max(1, Math.round(Number(actor.snapshot.stats.atk || 0) * Number(summon.atkMul || 0)));
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
    const extra = { precalculatedDamage: true, dotAttack: true, hitCount: 1 };
    const hit = dealDamage(attacker, marked, Math.max(1, Number(mark.dot || 0)), extra, t);
    pushEvent(battle, Object.assign({ at: t, actor: attackerKey, action: 'dot', skillName: '유서새김', text: damageText('유서새김', hit) }, hit));
}

function doAiAction(battle, t) {
    const opp = battle.opp;
    const decision = evaluateRules(opp, battle.me, t);
    if (decision.action == 'defend') return doDefend(battle, 'opp', t);
    if (decision.action == 'skill') {
        const skill = findSideSkill(opp, decision.skillName);
        if (skill) return doSkill(battle, 'opp', skill, t);
    }
    return doBasicAttack(battle, 'opp', t);
}

// 시간순으로 처리해야 할 가장 이른 항목 (동시각이면 행동 → 소환 → 지속 피해 순)
function nextDueItem(battle, limit) {
    const items = [];
    if (battle.opp.nextActionAt <= limit) items.push({ kind: 'action', side: 'opp', t: battle.opp.nextActionAt, order: 0 });
    ['me', 'opp'].forEach(key => {
        const summon = battle[key].runtime.summon;
        if (summon && summon.nextAttackAt <= limit && summon.nextAttackAt <= Number(summon.until || 0)) {
            items.push({ kind: 'summon', side: key, t: summon.nextAttackAt, order: 1 });
        }
        const mark = battle[key].runtime.mark;
        if (mark && mark.nextTickAt <= limit && mark.nextTickAt <= Number(mark.until || 0)) {
            items.push({ kind: 'mark', side: key, t: mark.nextTickAt, order: 2 });
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
        else doMarkTick(battle, item.side, item.t);
        if (checkKo(user, battle, item.t)) {
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
    if (battle.me.mp < skillMpCost(battle.me, skill)) return { ok: false, message: 'MP가 부족합니다.', battle: buildBattleView(user, -1) };
    if (skill.name == '시벌론' && Number(battle.me.runtime.sivalonCharge || 0) < 5) {
        return { ok: false, message: '일반 공격을 5회 사용해야 시벌론을 사용할 수 있습니다.', battle: buildBattleView(user, -1) };
    }
    doSkill(battle, 'me', skill, t);
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

// 유료 추가 플레이: 가넷을 내고 상대 슬롯 1개를 추가한다 (레이팅 근접 매칭, 이미 대결한 상대와의 재대결 허용).
async function buyExtraPlay(user) {
    const state = ensurePvpState(user);
    if (Number(state.daily.extraUsed || 0) >= EXTRA_PLAY_MAX) return { ok: false, message: '오늘의 추가 플레이 횟수를 모두 사용했습니다.' };
    if (Number(user.garnet || 0) < EXTRA_PLAY_COST) return { ok: false, message: '가넷이 부족합니다. (' + EXTRA_PLAY_COST + '가넷 필요)' };
    const open = (state.daily.opponents || []).filter(slot => slot && !slot.result).map(slot => slot.name);
    const rolled = pickOpponents(user, await getLadder(false), ['near'], open);
    if (rolled.length == 0) return { ok: false, message: '추가로 매칭할 상대가 없습니다.' };
    rolled[0].kind = 'extra';
    user.garnet = Number(user.garnet || 0) - EXTRA_PLAY_COST;
    state.daily.opponents.push(rolled[0]);
    state.daily.extraUsed = Number(state.daily.extraUsed || 0) + 1;
    return { ok: true, message: '추가 상대가 매칭되었습니다. (가넷 -' + EXTRA_PLAY_COST + ')', daily: buildDailyView(user), garnet: Number(user.garnet || 0) };
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
    return {
        date: daily.date,
        battlesUsed,
        battlesMax: DAILY_BATTLE_MAX + extraUsed,
        refreshUsed,
        refreshMax: DAILY_REFRESH_MAX,
        canRefresh: refreshUsed < DAILY_REFRESH_MAX && (daily.opponents || []).some(slot => slot && !slot.result),
        extraUsed,
        extraMax: EXTRA_PLAY_MAX,
        extraCost: EXTRA_PLAY_COST,
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
    buyExtraPlay,
    buildBattleView,
    buildPvpOverview,
    DEFAULT_RULES,
    __setNow
};
