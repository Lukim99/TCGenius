const crypto = require('crypto');

const GRADES = { '레어': 1, '유니크': 2, '레전더리': 3 };
const MATERIALS = { '레어': [5, 10, 30], '유니크': [20, 25, 100], '레전더리': [45, 50, 300] };
const ABILITIES = {
    finalAtk: '최종 공격력', finalDamage: '최종 피해', hp: '최대 체력', mp: '최대 MP',
    pnt: '방어 관통력', crit: '치명타 확률', critMul: '치명타 피해량', afterBasic: '일반 공격 피해량',
    afterSkill: '스킬 피해량', ultimateDamage: '궁극기 피해량', damageBonus: '일반 몬스터 추가 피해',
    eliteDmg: '엘리트 추가 피해', bossDmg: '보스 추가 피해', extraDamage: '추가 피해', dotDamage: '지속 피해', cooldown: '쿨타임 감소'
};
const TYPES = ['mainStar', 'slotStar', 'element', 'equipmentRarity', 'character', 'cardType'];
const RARITIES = ['일반', '레어', '유니크', '레전더리', '초월', '신화', '고유'];
const FORMS = ['일반', '전직', '각성'];
const BONUSES = [
    { threshold: 10, key: 'finalDamage', value: .08, label: '최종 피해 +8%' },
    { threshold: 15, key: 'finalAtk', value: .12, label: '최종 공격력 +12%' },
    { threshold: 20, key: 'extraDamage', value: .10, label: '추가 피해 +10%' },
    { threshold: 25, key: 'cooldown', value: .10, label: '스킬 쿨타임 10% 감소' }
];
const pick = values => values[Math.floor(Math.random() * values.length)];
const starLabel = star => star <= 9 ? star + '성' : ['제타', '시그마', '오메가'][star - 10];

function conditionValues(type, characters) {
    if (type === 'mainStar') return Array.from({ length: 12 }, (_, i) => i + 1);
    if (type === 'slotStar') return Array.from({ length: 8 }, (_, i) => i + 5);
    if (type === 'element') return Array.from({ length: 10 }, (_, i) => (i + 1) * 100);
    if (type === 'equipmentRarity') return RARITIES;
    if (type === 'cardType') return FORMS;
    return characters.map((character, id) => character && character.name ? id : null).filter(id => id !== null);
}

function create(rarity, id, characters) {
    if (!GRADES[rarity]) throw new Error('알 수 없는 아티팩트 등급입니다.');
    const pool = TYPES.slice();
    const options = [];
    while (options.length < GRADES[rarity]) {
        const type = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
        const values = conditionValues(type, characters);
        if (!values.length) throw new Error('캐릭터 정보를 불러오지 못했습니다.');
        options.push({ type, condition: pick(values), ability: pick(Object.keys(ABILITIES)), n: 1 + Math.floor(Math.random() * 10) });
    }
    return { type: 'artifact', id, level: 0, uid: crypto.randomUUID(), artifact: { options, rerollsUsed: 0 }, tradeCount: 0 };
}

function matches(option, user, stats, equipmentData) {
    const card = user.main_card || {};
    if (option.type === 'mainStar') return Number(card.star) + 1 === option.condition;
    if (option.type === 'slotStar') return (user.card_slot || []).some(card => card && Number(card.star) + 1 === option.condition);
    if (option.type === 'element') return Math.max(...['fireAtk', 'waterAtk', 'lightAtk', 'darkAtk'].map(key => Number(stats[key] || 0))) >= option.condition;
    if (option.type === 'character') return Number(card.id) === option.condition;
    if (option.type === 'cardType') return (card.type || '일반') === option.condition;
    if (option.type === 'equipmentRarity') {
        return Object.entries(user.equipments || {}).some(([type, value]) => {
            if (type === 'pet') return false;
            const entries = type === 'accessory' ? Object.values(value || {}) : [value];
            return entries.some(equip => equip && equipmentData(type, equip.id)?.rarity === option.condition);
        });
    }
    return false;
}

function evaluate(equip, rarity, user, stats, equipmentData) {
    const options = equip?.artifact?.options || [];
    const active = options.map(option => matches(option, user, stats, equipmentData));
    const values = {};
    options.forEach((option, i) => { if (active[i] && ABILITIES[option.ability]) values[option.ability] = Number(values[option.ability] || 0) + option.n / 100; });
    const manifestation = rarity === '레전더리' ? options.reduce((sum, option, i) => sum + (active[i] ? option.n : 0), 0) : 0;
    if (rarity === '레전더리') for (const bonus of BONUSES) if (manifestation >= bonus.threshold) values[bonus.key] = Number(values[bonus.key] || 0) + bonus.value;
    return { active, values, manifestation };
}

function describe(option, characters) {
    let conditionValue = option.condition;
    let conditionPrefix = '', conditionSuffix = '';
    if (option.type === 'mainStar' || option.type === 'slotStar') {
        conditionValue = starLabel(option.condition);
        conditionPrefix = option.type === 'mainStar' ? '메인 카드가 ' : '슬롯 카드 중 ';
        conditionSuffix = option.type === 'mainStar' ? '일 때' : ' 카드가 있을 때';
    } else if (option.type === 'element') { conditionPrefix = '최고 속성 강화가 '; conditionSuffix = ' 이상일 때'; }
    else if (option.type === 'equipmentRarity') { conditionPrefix = '장착 장비에 '; conditionSuffix = ' 등급이 있을 때'; }
    else if (option.type === 'character') { conditionPrefix = '메인 캐릭터가 '; conditionSuffix = '일 때'; conditionValue = characters[option.condition]?.name || '알 수 없는 캐릭터'; }
    else if (option.type === 'cardType') { conditionPrefix = '메인 카드가 '; conditionSuffix = ' 카드일 때'; }
    const conditionLabel = conditionPrefix + conditionValue + conditionSuffix;
    return { type: option.type, conditionLabel, conditionPrefix, conditionSuffix, conditionValue, ability: option.ability, abilityLabel: ABILITIES[option.ability], n: option.n };
}

function view(equip, rarity, user, stats, equipmentData, characters) {
    const evaluation = evaluate(equip, rarity, user, stats, equipmentData);
    return {
        uid: equip.uid, rarity, options: (equip.artifact?.options || []).map((option, i) => ({ ...describe(option, characters), active: evaluation.active[i] })),
        rerollsUsed: Number(equip.artifact?.rerollsUsed || 0), maxRerolls: 3, manifestation: evaluation.manifestation,
        bonuses: rarity === '레전더리' ? BONUSES.map(bonus => ({ threshold: bonus.threshold, label: bonus.label, active: evaluation.manifestation >= bonus.threshold })) : [], gold: Number(user.gold || 0)
    };
}

function reroll(user, equip, locks, characters) {
    const artifact = equip?.artifact;
    if (!artifact || !Array.isArray(artifact.options) || !artifact.options.length) return { error: '아티팩트를 찾을 수 없습니다.' };
    if (equip.locked) return { error: '잠긴 장비는 재설정할 수 없습니다.' };
    if (Number(artifact.rerollsUsed || 0) >= 3) return { error: '재설정 횟수 3회를 모두 사용했습니다.' };
    const keys = artifact.options.flatMap((_, i) => ['condition', 'ability', 'n'].map(field => i + '.' + field));
    if (!Array.isArray(locks) || locks.some(key => !keys.includes(key)) || new Set(locks).size !== locks.length) return { error: '잘못된 변수 잠금입니다.' };
    if (locks.length === keys.length) return { error: '변경할 변수가 없습니다.' };
    const cost = 100 * Math.pow(10, locks.length);
    if (!Number.isSafeInteger(user.gold) || user.gold < cost) return { error: '골드가 부족합니다. (' + cost.toLocaleString('ko-KR') + '골드)' };
    const next = artifact.options.map((option, i) => {
        const values = conditionValues(option.type, characters);
        if (!values.length) throw new Error('캐릭터 정보를 불러오지 못했습니다.');
        return { ...option, condition: locks.includes(i + '.condition') ? option.condition : pick(values), ability: locks.includes(i + '.ability') ? option.ability : pick(Object.keys(ABILITIES)), n: locks.includes(i + '.n') ? option.n : 1 + Math.floor(Math.random() * 10) };
    });
    user.gold -= cost;
    artifact.options = next;
    artifact.rerollsUsed = Number(artifact.rerollsUsed || 0) + 1;
    return { ok: true, cost };
}

module.exports = { GRADES, MATERIALS, ABILITIES, BONUSES, create, evaluate, view, reroll };
