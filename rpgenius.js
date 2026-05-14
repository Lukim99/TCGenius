const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, UpdateCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');
const node_kakao = require('node-kakao');
const fs = require('fs');
const path = require('path');

const TARGET_CHANNEL_IDS = ['442097040687921', '18470462260425659', "18483114949710565", "18483115447101144", "18483115484530406", "18483115510764240"];
const TABLE_NAME = 'rpgenius_user';
const VIEWMORE = '\u200e'.repeat(500);
const pendingChecks = {};
const CHARACTER_CARDS_PATH = path.join(__dirname, 'DB', 'RPGenius', 'CharacterCards.json');
const SKILLS_PATH = path.join(__dirname, 'DB', 'RPGenius', 'Skills.json');
const ITEMS_PATH = path.join(__dirname, 'DB', 'RPGenius', 'Item.json');
const EQUIPMENT_PATH = path.join(__dirname, 'DB', 'RPGenius', 'Equipment.json');
const PACKS_PATH = path.join(__dirname, 'DB', 'RPGenius', 'Pack.json');
const BUNDLE_PATH = path.join(__dirname, 'DB', 'RPGenius', 'Bundle.json');
const RECIPE_PATH = path.join(__dirname, 'DB', 'RPGenius', 'Recipe.json');
const SHOP_PATH = path.join(__dirname, 'DB', 'RPGenius', 'Shop.json');
const COUPON_PATH = path.join(__dirname, 'DB', 'RPGenius', 'Coupon.json');
const BASE_STAT_PATH = path.join(__dirname, 'DB', 'RPGenius', 'BaseStat.json');
const EXP_TABLE_PATH = path.join(__dirname, 'DB', 'RPGenius', 'ExpTable.json');
const DUNGEON_PATH = path.join(__dirname, 'DB', 'RPGenius', 'Dungeon.json');
const CARD_IMAGE_PATH = path.join(__dirname, 'DB', 'RPGenius', 'cardImage');
const ITEM_TYPE_ORDER = ['가챠', '번들', '마법석', '소모품', '티켓', '재료'];
const ELITE_KILL_REQUIREMENT = 100;
const ELITE_ENCOUNTER_RATE = 0.1;
const ELITE_RESPAWN_COOLDOWN = 60 * 60 * 1000;
const ATTENDANCE_STAMP_ITEM_ID = 71;
const eliteFieldStates = {};
const commandQueues = {};
const commandSpamStates = {};
const COMMAND_SPAM_WINDOW_MS = 1000;
const COMMAND_SPAM_LIMIT = 4;
const COMMAND_SPAM_BLOCK_MS = 10 * 60 * 1000;

const dynamoClient = new DynamoDBClient({
    region: 'ap-northeast-2',
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_KEY_ID
    }
});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

function getRandomString(len) {
    const chars = '023456789ABCDEFGHJKLMNOPQRSTUVWXTZabcdefghikmnopqrstuvwxyz';
    let randomstring = '';
    for (let i = 0; i < len; i++) {
        const rnum = Math.floor(Math.random() * chars.length);
        randomstring += chars.substring(rnum, rnum + 1);
    }
    return randomstring;
}

function readJson(filePath, fallback) {
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (e) {
        return fallback;
    }
}

function formatValue(format) {
    const value = Number(format && format.base || 0);
    if (format && format.type == 'flat') return value.toString();
    return Math.round(value * 1000) / 10 + '%';
}

function formatIncreaseValue(format) {
    const value = Number(format && (format.per_star || format.per_level) || 0);
    if (format && format.type == 'flat') return value.toString();
    return Math.round(value * 1000) / 10 + '%';
}

function formatSkillDesc(skill) {
    if (!skill) return '알 수 없는 스킬입니다.';
    return skill.desc.replace(/\$\{(\d+)\}/g, (match, index) => {
        const format = skill.format && skill.format[Number(index) - 1];
        return formatValue(format);
    });
}

function formatSkillDescWithIncrease(skill) {
    if (!skill) return '알 수 없는 스킬입니다.';
    return skill.desc.replace(/\$\{(\d+)\}/g, (match, index) => {
        const format = skill.format && skill.format[Number(index) - 1];
        return formatValue(format) + '(+' + formatIncreaseValue(format) + ')';
    });
}

function formatCooltime(ms) {
    const seconds = Number(ms || 0) / 1000;
    return Number.isInteger(seconds) ? seconds + '초' : seconds.toFixed(1).replace(/\.0$/, '') + '초';
}

function formatCharacterCardList() {
    const characterCards = readJson(CHARACTER_CARDS_PATH, []);
    const skills = readJson(SKILLS_PATH, []);

    const lines = ['[ 캐릭터 카드 ]', VIEWMORE];
    characterCards.forEach(card => {
        lines.push('{ ' + card.name + ' }');
        if (card.slot_effect) lines.push('- ' + card.slot_effect.name + ' ' + formatValue(card.slot_effect));
        (card.skills || []).forEach(skillIndex => {
            const skill = skills[skillIndex];
            if (skill) {
                lines.push('- 스킬: [ ' + skill.name + ' ]  MP ' + Number(skill.mp_cost || 0));
                formatSkillDesc(skill).split('\n').forEach(desc => lines.push(' ㄴ ' + desc));
                lines.push(' ㄴ 쿨타임: ' + formatCooltime(skill.cooltime));
            }
        });
        lines.push('');
    });

    lines.push('/RPGenius 캐릭터카드 선택 [캐릭터카드 이름]');
    return lines.join('\n').trim();
}

function findCharacterCardByName(name) {
    const characterCards = readJson(CHARACTER_CARDS_PATH, []);
    const index = characterCards.findIndex(card => card.name == name);
    if (index == -1) return null;
    return { index, card: characterCards[index] };
}

function comma(value) {
    return Number(value || 0).toLocaleString('ko-KR');
}

function formatRoll(value) {
    const percent = Number(value || 0) * 100;
    return (Number.isInteger(percent) ? percent : percent.toFixed(4).replace(/0+$/, '').replace(/\.$/, '')) + '%';
}

function formatCount(count) {
    if (!count) return 'x1';
    const min = Number(count.min || 0);
    const max = Number(count.max || 0);
    if (min == max) return 'x' + comma(min);
    return 'x' + comma(min) + '~' + comma(max);
}

function formatStatValue(key, value) {
    const number = Number(value || 0);
    const sign = number > 0 ? '+' : '';
    if (key == 'skillCooldown') return sign + (Math.round(number / 100) / 10) + '초';
    if ([
        'crit', 'critMul',
        'atk%', 'def%', 'hp%', 'mp%',
        'gold%', 'potion%', 'afterBasic%', 'avd%', 'afterSkill%', '000%',
        'exp%', 'eliteDmg%', 'mpReduce%'
    ].includes(key)) return sign + (Math.round(number * 1000) / 10) + '%';
    return sign + comma(number);
}

function formatPackEntry(entry) {
    const items = readJson(ITEMS_PATH, []);
    const equipments = readJson(EQUIPMENT_PATH, {});
    if (entry.type == '아이템') {
        const item = items[entry.item_id];
        return item ? item.name + ' ' + formatCount(entry.count) : '알 수 없는 아이템';
    }
    if (entry.type == '무기') {
        const weapon = equipments.weapon && equipments.weapon[entry.weapon_id];
        return weapon ? '<' + weapon.rarity + '> ' + weapon.name : '알 수 없는 무기';
    }
    if (entry.type == '갑옷') {
        const armor = equipments.armor && equipments.armor[entry.armor_id];
        return armor ? '<' + armor.rarity + '> ' + armor.name : '알 수 없는 갑옷';
    }
    if (entry.type == '장신구') {
        const accessory = equipments.accessory && equipments.accessory[entry.accessory_id];
        return accessory ? '<' + accessory.rarity + '> ' + accessory.name : '알 수 없는 장신구';
    }
    if (entry.type == '골드') return '🪙 ' + formatCount(entry.count);
    if (entry.type == '가넷') return '💠 ' + formatCount(entry.count);
    if (entry.type == '마일리지') return 'Ⓜ️ ' + formatCount(entry.count) + '마일리지';
    return entry.type || '알 수 없는 보상';
}

function formatPack(pack) {
    if (!Array.isArray(pack)) return '';
    return pack.map(entry => formatRoll(entry.roll) + ' [ ' + formatPackEntry(entry) + ' ]').join('\n');
}

function formatBundle(bundle) {
    if (!Array.isArray(bundle)) return '';
    return bundle.map(entry => '[ ' + formatPackEntry(entry) + ' ]').join('\n');
}

function formatCharacterCardDetail(card) {
    const skills = readJson(SKILLS_PATH, []);
    const lines = [];
    if (card.slot_effect) {
        lines.push('[ 5성 이상 / 카드 슬롯 효과 ]');
        lines.push('- ' + card.slot_effect.name + ' ' + formatValue(card.slot_effect));
        lines.push(' ㄴ 5성 이후 등급마다 +' + formatIncreaseValue(card.slot_effect));
        lines.push('');
    }
    lines.push('[ 스킬 ]');
    (card.skills || []).forEach(skillIndex => {
        const skill = skills[skillIndex];
        if (skill) {
            lines.push('- ' + skill.name + ' [ ' + Number(skill.mp_cost || 0) + ' MP ]');
            formatSkillDescWithIncrease(skill).split('\n').forEach(desc => lines.push(' ㄴ ' + desc));
        }
    });
    return lines.join('\n').trim();
}

function formatEquipmentStatLines(equipment) {
    const statNames = {
        atk: '공격력',
        pnt: '방어 관통력',
        def: '방어력',
        hp: '체력',
        mp: 'MP',
        crit: '치명타 확률',
        critMul: '치명타 피해량',
        skillCooldown: '스킬 쿨타임',
        skillTrueDmg: '스킬 사용 시 추가 고정 피해'
    };
    const plusStatNames = {
        atk: '최종 공격력',
        def: '최종 방어력',
        hp: '최종 체력',
        mp: '최종 MP',
        gold: '골드 획득량',
        potion: '물약 효율',
        afterBasic: '공격 후 일반 공격 피해',
        avd: '회피 확률',
        afterSkill: '공격 후 스킬 공격 피해',
        '000': '공격 시 10/100/1000 추가 피해 확률',
        exp: '경험치 획득량',
        eliteDmg: '엘리트 몬스터 대상 추가 피해',
        mpReduce: 'MP 소모량'
    };
    const lines = [];
    Object.keys(statNames).forEach(key => {
        if (equipment.stat && typeof equipment.stat[key] != 'undefined') lines.push('- ' + statNames[key] + ' ' + formatStatValue(key, equipment.stat[key]));
    });
    Object.keys(plusStatNames).forEach(key => {
        if (equipment.plusStat && typeof equipment.plusStat[key] != 'undefined') lines.push('- ' + plusStatNames[key] + ' ' + formatStatValue(key + '%', equipment.plusStat[key]));
    });
    if (typeof equipment.requireLevel != 'undefined') lines.push('- 장착 필요 레벨: Lv. ' + Number(equipment.requireLevel));
    if (typeof equipment.underLevel != 'undefined') lines.push('- 장착 가능 최대 레벨: Lv. ' + Number(equipment.underLevel));
    if (typeof equipment.exactlyStar != 'undefined') lines.push('- 효과 적용 조건: 메인 캐릭터 카드 ' + (Number(equipment.exactlyStar) + 1) + '성');
    if (Array.isArray(equipment.require) && equipment.require.length > 0) {
        const equipments = readJson(EQUIPMENT_PATH, {});
        const reqNames = equipment.require.map(req => {
            if (req.type == '장신구') {
                const data = equipments.accessory && equipments.accessory[req.accessory_id];
                return data ? '<' + data.rarity + '> ' + data.name : '알 수 없는 장신구';
            }
            if (req.type == '무기') {
                const data = equipments.weapon && equipments.weapon[req.weapon_id];
                return data ? '<' + data.rarity + '> ' + data.name : '알 수 없는 무기';
            }
            if (req.type == '갑옷') {
                const data = equipments.armor && equipments.armor[req.armor_id];
                return data ? '<' + data.rarity + '> ' + data.name : '알 수 없는 갑옷';
            }
            return '알 수 없음';
        });
        lines.push('- 효과 적용 조건: ' + reqNames.join(', ') + ' 장착');
    }
    return lines.join('\n');
}

function findEquipmentByName(name) {
    const equipments = readJson(EQUIPMENT_PATH, {});
    const types = [
        { key: 'weapon', name: '무기' },
        { key: 'armor', name: '갑옷' },
        { key: 'accessory', name: '장신구' }
    ];
    for (const type of types) {
        const list = equipments[type.key] || [];
        const index = list.findIndex(equipment => equipment.name == name);
        if (index != -1) return { index, type: type.name, equipment: list[index] };
    }
    return null;
}

function formatNameWithTrade(data) {
    return data.name + (data.no_trade ? ' [거래불가]' : '');
}

function formatUserCard(card) {
    const characterCards = readJson(CHARACTER_CARDS_PATH, []);
    if (!card || typeof card.id == 'undefined') return '없음';
    const data = characterCards[card.id];
    if (!data) return '없음';
    return '[' + formatStar(card.star) + '] ' + (card.type || '일반') + ' ' + data.name;
}

function getEquipmentData(type, id) {
    const equipments = readJson(EQUIPMENT_PATH, {});
    const list = equipments[type] || [];
    return list[id];
}

function formatEquippedEquipment(label, type, equip) {
    if (!equip || typeof equip.id == 'undefined') return '[' + label + '] 없음';
    const data = getEquipmentData(type, equip.id);
    if (!data) return '[' + label + '] 없음';
    const level = Number(equip.level || 0);
    return '[' + label + '] <' + data.rarity + '> ' + data.name + (level > 0 ? ' +' + level : '');
}

function addStats(target, stats) {
    Object.keys(stats || {}).forEach(key => {
        target[key] = Number(target[key] || 0) + Number(stats[key] || 0);
    });
}

function getEquipmentStatsAtLevel(equipment, level) {
    const stats = Object.assign({}, equipment && equipment.stat || {});
    const max = Math.min(Number(level || 0), Array.isArray(equipment && equipment.upgrade) ? equipment.upgrade.length : 0);
    for (let i = 0; i < max; i++) addStats(stats, equipment.upgrade[i].stat || {});
    return stats;
}

function getEquipmentPlusStatsAtLevel(equipment, level) {
    const stats = Object.assign({}, equipment && equipment.plusStat || {});
    const max = Math.min(Number(level || 0), Array.isArray(equipment && equipment.upgrade) ? equipment.upgrade.length : 0);
    for (let i = 0; i < max; i++) addStats(stats, equipment.upgrade[i].plusStat || {});
    return stats;
}

function isEquipmentEffectActive(user, data) {
    if (!data) return false;
    if (typeof data.exactlyStar != 'undefined') {
        const star = Number(user.main_card && user.main_card.star || 0);
        if (star != Number(data.exactlyStar)) return false;
    }
    if (Array.isArray(data.require) && data.require.length > 0) {
        const accessories = user.equipments && user.equipments.accessory || {};
        const equippedAccessoryIds = Object.keys(accessories)
            .map(key => accessories[key] && accessories[key].id)
            .filter(id => typeof id != 'undefined')
            .map(id => Number(id));
        const equippedWeaponId = user.equipments && user.equipments.weapon && typeof user.equipments.weapon.id != 'undefined' ? Number(user.equipments.weapon.id) : null;
        const equippedArmorId = user.equipments && user.equipments.armor && typeof user.equipments.armor.id != 'undefined' ? Number(user.equipments.armor.id) : null;
        for (const req of data.require) {
            if (req.type == '장신구' && !equippedAccessoryIds.includes(Number(req.accessory_id))) return false;
            if (req.type == '무기' && equippedWeaponId !== Number(req.weapon_id)) return false;
            if (req.type == '갑옷' && equippedArmorId !== Number(req.armor_id)) return false;
        }
    }
    return true;
}

function getCardSlotEffectValue(card, cardData) {
    if (!card || !cardData || !cardData.slot_effect) return 0;
    const star = Number(card.star || 0);
    if (star < 4) return 0;
    return Number(cardData.slot_effect.base || 0) + Number(cardData.slot_effect.per_level || 0) * (star - 4);
}

function calculateCardSlotEffects(user) {
    const characterCards = readJson(CHARACTER_CARDS_PATH, []);
    const effects = {
        expBonus: 0,
        hpDamageReduction: 0,
        killRecoveryChance: 0,
        crit: 0,
        mpCostReduction: 0,
        damageBonus: 0,
        critMul: 0,
        goldBonus: 0,
        itemDropChance: 0,
        defReduction: 0
    };
    (user.card_slot || []).forEach(card => {
        const cardData = characterCards[card.id];
        const value = getCardSlotEffectValue(card, cardData);
        if (value <= 0) return;
        if (cardData.name == '빵귤') effects.expBonus += value;
        if (cardData.name == '뭔마') effects.hpDamageReduction += value;
        if (cardData.name == '글렌첵') effects.killRecoveryChance += value;
        if (cardData.name == '오버라이드') effects.crit += value;
        if (cardData.name == '일레이나') effects.mpCostReduction += value;
        if (cardData.name == '진필규') effects.damageBonus += value;
        if (cardData.name == '켄시') effects.critMul += value;
        if (cardData.name == '제우스') effects.goldBonus += value;
        if (cardData.name == '타이란트') effects.itemDropChance += value;
        if (cardData.name == '마쉐비') effects.defReduction += value;
    });
    return effects;
}

function formatCardSlotEffectLines(user) {
    const slotEffects = calculateCardSlotEffects(user);
    const effectMap = [
        ['expBonus', '경험치 획득 증가량'],
        ['hpDamageReduction', '사냥 시 HP 소모량 감소'],
        ['killRecoveryChance', '적 처치 시 잃은 HP 5% 회복 확률'],
        ['crit', '치명타 확률 증가'],
        ['mpCostReduction', '사냥 시 MP 소모량 감소'],
        ['damageBonus', '일반 몬스터에게 주는 피해 증가'],
        ['critMul', '치명타 피해량 증가'],
        ['goldBonus', '골드 획득 증가량'],
        ['itemDropChance', '아이템 드랍 확률'],
        ['defReduction', '방어력 관통']
    ];
    return effectMap
        .filter(entry => Number(slotEffects[entry[0]] || 0) > 0)
        .map(entry => {
            const value = Number(slotEffects[entry[0]] || 0);
            const display = Math.round(value * 1000) / 10 + '%';
            return '◆ ' + entry[1] + ' ' + display;
        });
}

function getCharacterInventoryCard(user, numberArg) {
    const number = Number(numberArg);
    if (!Number.isInteger(number) || number < 1) return null;
    const cards = user.inventory && Array.isArray(user.inventory.card) ? user.inventory.card : [];
    return cards[number - 1] || null;
}

const CARD_COMBINE_TABLE = [
    { rate: 0.90, gold: 400 },
    { rate: 0.90, gold: 800 },
    { rate: 0.90, gold: 1600 },
    { rate: 0.85, gold: 3200 },
    { rate: 0.75, gold: 6400 },
    { rate: 0.65, gold: 12800 },
    { rate: 0.55, gold: 25600 },
    { rate: 0.45, gold: 51200 },
    { rate: 0.35, gold: 128000 },
    { rate: 0.25, gold: 256000 },
    { rate: 0.15, gold: 512000 }
];

function getCardCombineInfo(star) {
    return CARD_COMBINE_TABLE[Number(star || 0)] || null;
}

function formatRatePercent(rate) {
    return Math.round(Number(rate || 0) * 1000) / 10 + '%';
}

function getCardCombineSelection(user, numberArgs) {
    const cards = user.inventory && Array.isArray(user.inventory.card) ? user.inventory.card : [];
    if (!Array.isArray(numberArgs) || numberArgs.length != 3) return { error: '❌ /RPGenius 카드조합 [카드번호1] [카드번호2] [카드번호3]' };
    const numbers = numberArgs.map(arg => Number(arg));
    if (numbers.some(number => !Number.isInteger(number) || number < 1 || number > cards.length)) return { error: '❌ 존재하지 않는 카드 번호가 있습니다.' };
    if (new Set(numbers).size != 3) return { error: '❌ 서로 다른 카드 3장을 선택해야 합니다.' };
    const selected = numbers.map(number => cards[number - 1]);
    const star = Number(selected[0].star || 0);
    if (selected.some(card => Number(card.star || 0) != star)) return { error: '❌ 입력된 카드 3개는 모두 같은 등급이어야 합니다.' };
    const info = getCardCombineInfo(star);
    if (!info) return { error: '❌ 해당 등급은 카드조합을 할 수 없습니다.' };
    return { numbers, selected, star, info };
}

function getRandomCardCombineNumbers(user, starArg) {
    const starText = String(starArg || '').trim();
    const star = starText == '제타' ? 9 : starText == '시그마' ? 10 : starText == '오메가' ? 11 : Number(starText.replace(/성$/, '')) - 1;
    if (!Number.isInteger(star) || star < 0) return { error: '❌ /RPGenius 랜덤카드조합 [등급]' };
    const info = getCardCombineInfo(star);
    if (!info) return { error: '❌ 해당 등급은 카드조합을 할 수 없습니다.' };
    const cards = user.inventory && Array.isArray(user.inventory.card) ? user.inventory.card : [];
    const numbers = cards
        .map((card, index) => ({ card, number: index + 1 }))
        .filter(entry => Number(entry.card.star || 0) == star)
        .map(entry => entry.number);
    if (numbers.length < 3) return { error: '❌ 해당 등급의 카드가 3장 이상 필요합니다.' };
    for (let i = numbers.length - 1; i > 0; i--) {
        const j = randomInt(0, i);
        const temp = numbers[i];
        numbers[i] = numbers[j];
        numbers[j] = temp;
    }
    return { numbers: numbers.slice(0, 3) };
}

function formatCardCombinePreview(user, numberArgs) {
    const selection = getCardCombineSelection(user, numberArgs);
    if (selection.error) return selection.error;
    const characterCards = readJson(CHARACTER_CARDS_PATH, []);
    const lines = ['[ 캐릭터 카드 조합 ]'];
    selection.selected.forEach(card => {
        const data = characterCards[card.id];
        lines.push('- [' + formatStar(card.star) + '] ' + (card.type || '일반') + ' ' + (data ? data.name : '알 수 없음'));
    });
    lines.push('', '- ' + formatRatePercent(selection.info.rate) + ' 확률로 ' + formatStar(selection.star + 1) + ' 캐릭터 카드를 획득합니다.');
    lines.push('- 필요 골드: 🪙 ' + comma(selection.info.gold));
    if (Number(user.gold || 0) < selection.info.gold) {
        user.pendingAction = null;
        lines.push('', '❌ 골드가 부족합니다.');
    } else {
        user.pendingAction = { type: '카드조합', numbers: selection.numbers };
        lines.push('', '/RPGenius 조합');
    }
    return lines.join('\n');
}

function runCardCombine(user) {
    const pending = user.pendingAction;
    if (!pending || pending.type != '카드조합') return '❌ 진행 중인 카드조합이 없습니다.';
    const selection = getCardCombineSelection(user, pending.numbers);
    user.pendingAction = null;
    if (selection.error) return selection.error;
    if (Number(user.gold || 0) < selection.info.gold) return '❌ 골드가 부족합니다.';
    const characterCards = readJson(CHARACTER_CARDS_PATH, []);
    if (characterCards.length == 0) return '❌ 캐릭터 카드 데이터가 없습니다.';
    user.gold = Number(user.gold || 0) - selection.info.gold;
    selection.numbers.slice().sort((a, b) => b - a).forEach(number => user.inventory.card.splice(number - 1, 1));
    const success = Math.random() < selection.info.rate;
    const resultCard = {
        id: randomInt(0, characterCards.length - 1),
        star: success ? selection.star + 1 : selection.star,
        type: '일반'
    };
    user.inventory.card.push(resultCard);
    return (success ? '🌟 카드 3장을 조합했습니다!' : '✅ 카드 3장을 조합했습니다.') + '\n[ 획득 결과 ]\n- ' + formatUserCard(resultCard);
}

function parseCardStarArg(starArg) {
    const starText = String(starArg || '').trim();
    const star = starText == '제타' ? 9 : starText == '시그마' ? 10 : starText == '오메가' ? 11 : Number(starText.replace(/성$/, '')) - 1;
    return Number.isInteger(star) && star >= 0 ? star : null;
}

function getCardSalePrice(card) {
    const info = getCardCombineInfo(Number(card && card.star || 0));
    return info ? Math.floor(Number(info.gold || 0) / 2) : 0;
}

function getCardSaleSelection(user, numberArgs) {
    const cards = user.inventory && Array.isArray(user.inventory.card) ? user.inventory.card : [];
    if (!Array.isArray(numberArgs) || numberArgs.length == 0) return { error: '❌ /RPGenius 카드판매 [카드번호1] [카드번호2] [카드번호3] ...' };
    const numbers = numberArgs.map(arg => Number(arg));
    if (numbers.some(number => !Number.isInteger(number) || number < 1 || number > cards.length)) return { error: '❌ 존재하지 않는 카드 번호가 있습니다.' };
    if (new Set(numbers).size != numbers.length) return { error: '❌ 같은 카드를 중복 선택할 수 없습니다.' };
    const selected = numbers.map(number => cards[number - 1]);
    const gold = selected.reduce((sum, card) => sum + getCardSalePrice(card), 0);
    if (gold <= 0) return { error: '❌ 판매할 수 없는 등급의 카드가 포함되어 있습니다.' };
    return { numbers, selected, gold };
}

function getRandomCardSaleNumbers(user, starArg, countArg) {
    const star = parseCardStarArg(starArg);
    if (star == null) return { error: '❌ /RPGenius 카드일괄판매 [등급] <갯수>' };
    if (!getCardCombineInfo(star)) return { error: '❌ 해당 등급은 판매할 수 없습니다.' };
    const count = countArg == null || countArg === '' ? null : Number(countArg);
    if (count != null && (!Number.isInteger(count) || count < 1)) return { error: '❌ 갯수는 1 이상의 정수여야 합니다.' };
    const cards = user.inventory && Array.isArray(user.inventory.card) ? user.inventory.card : [];
    const numbers = cards
        .map((card, index) => ({ card, number: index + 1 }))
        .filter(entry => Number(entry.card.star || 0) == star)
        .map(entry => entry.number);
    if (numbers.length == 0) return { error: '❌ 해당 등급의 카드가 없습니다.' };
    for (let i = numbers.length - 1; i > 0; i--) {
        const j = randomInt(0, i);
        const temp = numbers[i];
        numbers[i] = numbers[j];
        numbers[j] = temp;
    }
    return { numbers: numbers.slice(0, count == null ? numbers.length : Math.min(count, numbers.length)) };
}

function formatCardSalePreview(user, numberArgs) {
    const selection = getCardSaleSelection(user, numberArgs);
    if (selection.error) return selection.error;
    const characterCards = readJson(CHARACTER_CARDS_PATH, []);
    user.pendingAction = { type: '카드판매', numbers: selection.numbers };
    const lines = ['[ 카드 판매 ]'];
    selection.selected.forEach(card => {
        const data = characterCards[card.id];
        lines.push('- [' + formatStar(card.star) + '] ' + (card.type || '일반') + ' ' + (data ? data.name : '알 수 없음'));
    });
    lines.push('', '판매 시 획득:', '- 🪙 ' + comma(selection.gold), '', '정말 판매하시겠습니까?', '/RPGenius 판매');
    return lines.join('\n');
}

function runCardSale(user) {
    const pending = user.pendingAction;
    if (!pending || pending.type != '카드판매') return '❌ 진행 중인 카드판매가 없습니다.';
    const selection = getCardSaleSelection(user, pending.numbers);
    user.pendingAction = null;
    if (selection.error) return selection.error;
    selection.numbers.slice().sort((a, b) => b - a).forEach(number => user.inventory.card.splice(number - 1, 1));
    user.gold = Number(user.gold || 0) + selection.gold;
    return '✅ 카드 ' + comma(selection.selected.length) + '장을 판매했습니다.\n[ 획득 결과 ]\n- 🪙 ' + comma(selection.gold);
}

function equipMainCharacterCard(user, numberArg) {
    const number = Number(numberArg);
    if (!Number.isInteger(number) || number < 1) return '❌ 존재하지 않는 카드 번호입니다.';
    if (!user.inventory || !Array.isArray(user.inventory.card)) user.inventory = { card: [], item: [], equipment: [] };
    const card = user.inventory.card[number - 1];
    if (!card) return '❌ 존재하지 않는 카드 번호입니다.';
    user.inventory.card.splice(number - 1, 1);
    if (user.main_card && typeof user.main_card.id != 'undefined') user.inventory.card.push(user.main_card);
    user.main_card = card;
    const stats = calculateUserStats(user);
    user.hp = Math.min(typeof user.hp == 'undefined' ? Number(stats.hp || 0) : Number(user.hp || 0), Number(stats.hp || 0));
    user.mp = Math.min(typeof user.mp == 'undefined' ? Number(stats.mp || 0) : Number(user.mp || 0), Number(stats.mp || 0));
    return '✅ 메인 캐릭터 카드를 장착했습니다: ' + formatUserCard(card);
}

function getRemainingCardInventorySpace(user) {
    if (!user.inventory) user.inventory = { card: [], item: [], equipment: [] };
    if (!Array.isArray(user.inventory.card)) user.inventory.card = [];
    return Math.max(0, Number(user.maxCardLimit || 52) - user.inventory.card.length);
}

function equipCharacterCardSlot(user, numberArg) {
    const maxCardSlot = Number(user.maxCardSlot || 5);
    if (Array.isArray(user.card_slot) && user.card_slot.length >= maxCardSlot) return '❌ 카드 슬롯이 가득 찼습니다.';
    const number = Number(numberArg);
    if (!Number.isInteger(number) || number < 1) return '❌ 존재하지 않는 카드 번호입니다.';
    if (!user.inventory || !Array.isArray(user.inventory.card)) user.inventory = { card: [], item: [], equipment: [] };
    const card = user.inventory.card[number - 1];
    if (!card) return '❌ 존재하지 않는 카드 번호입니다.';
    if (Number(card.star || 0) < 4) return '❌ 카드 슬롯에는 5성 이상 카드만 장착할 수 있습니다.';
    if (!Array.isArray(user.card_slot)) user.card_slot = [];
    if (user.card_slot.some(slotCard => slotCard && slotCard.id == card.id)) return '❌ 이미 같은 캐릭터가 카드 슬롯에 장착되어 있습니다.';
    user.inventory.card.splice(number - 1, 1);
    user.card_slot.push(card);
    return '✅ 카드 슬롯에 장착했습니다: ' + formatUserCard(card);
}

function removeCharacterCardSlot(user, slotArg) {
    const slotNumber = Number(slotArg);
    const maxCardSlot = Number(user.maxCardSlot || 5);
    if (!Number.isInteger(slotNumber) || slotNumber < 1 || slotNumber > maxCardSlot) return '❌ 슬롯 번호는 1~' + maxCardSlot + ' 사이여야 합니다.';
    if (!Array.isArray(user.card_slot) || !user.card_slot[slotNumber - 1]) return '❌ 해당 슬롯에 장착된 카드가 없습니다.';
    const removed = user.card_slot[slotNumber - 1];
    if (!user.inventory || !Array.isArray(user.inventory.card)) user.inventory = { card: [], item: [], equipment: [] };
    if (getRemainingCardInventorySpace(user) < 1) return '❌ 캐릭터 카드 인벤토리가 가득 차서 슬롯에서 제거할 수 없습니다.';
    user.inventory.card.push(removed);
    user.card_slot.splice(slotNumber - 1, 1);
    return '✅ 카드 슬롯 ' + slotNumber + '번에서 제거했습니다: ' + formatUserCard(removed);
}

function convertCharacterCard(user, numberArg) {
    const number = Number(numberArg);
    const cards = user.inventory && Array.isArray(user.inventory.card) ? user.inventory.card : [];
    if (!Number.isInteger(number) || number < 1 || number > cards.length) return '❌ 존재하지 않는 카드 번호입니다.';
    const characterCards = readJson(CHARACTER_CARDS_PATH, []);
    if (characterCards.length <= 1) return '❌ 변환할 수 있는 캐릭터 카드 데이터가 부족합니다.';
    const card = cards[number - 1];
    if (Number(card.star || 0) >= 9) return '❌ 해당 등급 카드는 캐릭터 변환석을 사용할 수 없습니다.';
    const before = Object.assign({}, card);
    let newId = card.id;
    while (newId == card.id) newId = randomInt(0, characterCards.length - 1);
    card.id = newId;
    user.pendingAction = null;
    return '✅ 캐릭터 카드가 변환되었습니다.\n- 이전: ' + formatUserCard(before) + '\n- 결과: ' + formatUserCard(card);
}

function getBaseStat(card) {
    const table = readJson(BASE_STAT_PATH, []);
    const star = Number(card && card.star || 0);
    const base = table[star] || table[0] || {};
    return Object.assign({ atk: 0, pnt: 0, def: 0, hp: 0, mp: 0, crit: 0, critMul: 1.4 }, base);
}

function getMaxExpForLevel(level) {
    const table = readJson(EXP_TABLE_PATH, []);
    const value = table[Math.max(1, Number(level || 1)) - 1];
    return typeof value == 'number' ? value : 0;
}

const STAT_POINT_OPTIONS = {
    '공격력': { key: 'atk', plusKey: 'atk', flat: 2, plus: 0.01, label: '공격력', plusLabel: '최종 공격력' },
    '체력': { key: 'hp', plusKey: 'hp', flat: 10, plus: 0.01, label: '체력', plusLabel: '최종 체력' },
    'MP': { key: 'mp', plusKey: 'mp', flat: 12, plus: 0.01, label: 'MP', plusLabel: '최종 MP' },
    'mp': { key: 'mp', plusKey: 'mp', flat: 12, plus: 0.01, label: 'MP', plusLabel: '최종 MP' },
    '방어력': { key: 'def', plusKey: 'def', flat: 3, plus: 0.01, label: '방어력', plusLabel: '최종 방어력' },
    '방어관통력': { key: 'pnt', flat: 1, plus: 0, label: '방어 관통력' },
    '방어 관통력': { key: 'pnt', flat: 1, plus: 0, label: '방어 관통력' }
};

const STAT_POINT_DISPLAY = [
    { name: '공격력', key: 'atk', plusKey: 'atk', flat: 2 },
    { name: '체력', key: 'hp', plusKey: 'hp', flat: 10 },
    { name: 'MP', key: 'mp', plusKey: 'mp', flat: 12 },
    { name: '방어력', key: 'def', plusKey: 'def', flat: 3 },
    { name: '방어 관통력', key: 'pnt', flat: 1 }
];

function normalizeStatPointData(user) {
    if (!user.statPointStats || typeof user.statPointStats != 'object') user.statPointStats = {};
    ['atk', 'hp', 'mp', 'def', 'pnt'].forEach(key => {
        user.statPointStats[key] = Number(user.statPointStats[key] || 0);
    });
    user.statPoint = Number(user.statPoint || 0);
}

function calculateUserStats(user) {
    const stats = getBaseStat(user.main_card);
    const plusStats = {};
    normalizeStatPointData(user);
    Object.keys(user.statPointStats).forEach(key => {
        const count = Number(user.statPointStats[key] || 0);
        if (key == 'atk') {
            stats.atk = Number(stats.atk || 0) + count * 2;
            plusStats.atk = Number(plusStats.atk || 0) + count * 0.01;
        }
        if (key == 'hp') {
            stats.hp = Number(stats.hp || 0) + count * 10;
            plusStats.hp = Number(plusStats.hp || 0) + count * 0.01;
        }
        if (key == 'mp') {
            stats.mp = Number(stats.mp || 0) + count * 12;
            plusStats.mp = Number(plusStats.mp || 0) + count * 0.01;
        }
        if (key == 'def') {
            stats.def = Number(stats.def || 0) + count * 3;
            plusStats.def = Number(plusStats.def || 0) + count * 0.01;
        }
        if (key == 'pnt') stats.pnt = Number(stats.pnt || 0) + count;
    });
    [['weapon', user.equipments && user.equipments.weapon], ['armor', user.equipments && user.equipments.armor]].forEach(entry => {
        const data = entry[1] && getEquipmentData(entry[0], entry[1].id);
        if (data && isEquipmentEffectActive(user, data)) {
            addStats(stats, getEquipmentStatsAtLevel(data, entry[1].level));
            addStats(plusStats, getEquipmentPlusStatsAtLevel(data, entry[1].level));
        }
    });
    const accessories = user.equipments && user.equipments.accessory || {};
    Object.keys(accessories).forEach(key => {
        const equip = accessories[key];
        const data = equip && getEquipmentData('accessory', equip.id);
        if (data && isEquipmentEffectActive(user, data)) {
            addStats(stats, getEquipmentStatsAtLevel(data, equip.level));
            addStats(plusStats, getEquipmentPlusStatsAtLevel(data, equip.level));
        }
    });
    ['atk', 'def', 'hp', 'mp'].forEach(key => {
        if (Number(plusStats[key] || 0) != 0) stats[key] = Math.round(Number(stats[key] || 0) * (1 + Number(plusStats[key] || 0)));
    });
    ['gold', 'potion', 'afterBasic', 'avd', 'afterSkill', '000', 'exp', 'eliteDmg', 'mpReduce'].forEach(key => {
        stats[key] = Number(stats[key] || 0) + Number(plusStats[key] || 0);
    });
    const slotEffects = calculateCardSlotEffects(user);
    stats.crit = Number(stats.crit || 0) + slotEffects.crit;
    stats.critMul = Number(stats.critMul || 0) + slotEffects.critMul;
    return stats;
}

const CP_WEIGHTS = {
    OFFENSE_SCALE: 10,
    DEFENSE_SCALE: 25,
    AFTER_SKILL_RATIO: 0.6,
    DAMAGE_BONUS_RATIO: 0.7,
    ELITE_DMG_RATIO: 0.3,
    PEN_DIVISOR: 200,
    DEF_REDUCTION_RATIO: 0.5,
    TRIPLE_ZERO_RATIO: 0.15,
    SKILL_TRUE_DMG_RATIO: 0.2,
    AVOID_CAP: 0.8,
    MITIGATE_CAP: 0.8,
    RECOVERY_RATIO: 0.5,
    MP_DIVISOR: 8,
    ECON_SCALE: 30,
    POTION_SCALE: 25,
    DROP_SCALE: 80
};

function calculateCombatPower(user) {
    const stats = calculateUserStats(user);
    const slot = calculateCardSlotEffects(user);
    const W = CP_WEIGHTS;

    const atk = Math.max(0, Number(stats.atk || 0));
    const def = Math.max(0, Number(stats.def || 0));
    const hp = Math.max(0, Number(stats.hp || 0));
    const mp = Math.max(0, Number(stats.mp || 0));
    const crit = Math.max(0, Number(stats.crit || 0));
    const critMul = Math.max(1, Number(stats.critMul || 1.4));
    const pnt = Math.max(0, Number(stats.pnt || 0));

    const mAttack = (1 + Number(stats.afterBasic || 0)) * (1 + Number(stats.afterSkill || 0) * W.AFTER_SKILL_RATIO);
    const mContext = 1 + Number(slot.damageBonus || 0) * W.DAMAGE_BONUS_RATIO + Number(stats.eliteDmg || 0) * W.ELITE_DMG_RATIO;
    const mCrit = 1 + Math.min(1, crit) * (critMul - 1);
    const mPen = 1 + pnt / W.PEN_DIVISOR + Number(slot.defReduction || 0) * W.DEF_REDUCTION_RATIO;
    const mExtra = 1 + Math.min(1, Number(stats['000'] || 0)) * W.TRIPLE_ZERO_RATIO
                     + Number(stats.skillTrueDmg || 0) / Math.max(atk, 1) * W.SKILL_TRUE_DMG_RATIO;
    const offense = atk * mAttack * mContext * mCrit * mPen * mExtra * W.OFFENSE_SCALE;

    const ehp = hp * (1 + def / 100);
    const mAvoid = 1 / (1 - Math.min(W.AVOID_CAP, Math.max(0, Number(stats.avd || 0))));
    const mMitigate = 1 / (1 - Math.min(W.MITIGATE_CAP, Math.max(0, Number(slot.hpDamageReduction || 0))));
    const mRecover = 1 + Number(slot.killRecoveryChance || 0) * W.RECOVERY_RATIO;
    const defense = Math.sqrt(ehp) * mAvoid * mMitigate * mRecover * W.DEFENSE_SCALE;

    const mMpSave = 1 + Math.min(0.8, Number(stats.mpReduce || 0)) + Math.min(0.8, Number(slot.mpCostReduction || 0));
    const resourcePower = (mp / W.MP_DIVISOR) * mMpSave;
    const economyPower = (Number(stats.gold || 0) + Number(stats.exp || 0) + Number(slot.goldBonus || 0) + Number(slot.expBonus || 0)) * W.ECON_SCALE
                       + Number(stats.potion || 0) * W.POTION_SCALE
                       + Number(slot.itemDropChance || 0) * W.DROP_SCALE;
    const utility = resourcePower + economyPower;

    return {
        offense: Math.round(offense),
        defense: Math.round(defense),
        utility: Math.round(utility),
        total: Math.round(offense + defense + utility)
    };
}

function formatMyInfo(user) {
    const level = Number(user.level || 1);
    const exp = Number(user.exp || 0);
    const maxExp = getMaxExpForLevel(level);
    const stats = calculateUserStats(user);
    const maxHp = Number(stats.hp || 0);
    const hp = typeof user.hp == 'undefined' ? maxHp : Number(user.hp || 0);
    const maxMp = Number(stats.mp || 0);
    const mp = typeof user.mp == 'undefined' ? maxMp : Number(user.mp || 0);
    const cardSlots = user.card_slot || [];
    const maxCardSlot = Number(user.maxCardSlot || 5);

    const lines = [
        '[ ' + user.name + '님의 정보 ]',
        VIEWMORE,
        'Lv. ' + level + ' (' + comma(exp) + '/' + comma(maxExp) + ')',
        'HP: ' + comma(hp) + '/' + comma(maxHp),
        'MP: ' + comma(mp) + '/' + comma(maxMp),
        '',
        '〈 장착 중인 캐릭터 카드 〉',
        '- ' + formatUserCard(user.main_card),
        '',
        '〈 장착 중인 카드 슬롯 (' + cardSlots.length + '/' + maxCardSlot + ') 〉'
    ];
    for (let i = 0; i < maxCardSlot; i++) lines.push(cardSlots[i] ? '- ' + formatUserCard(cardSlots[i]) : '-');
    const slotEffectLines = formatCardSlotEffectLines(user);
    if (slotEffectLines.length > 0) lines.push('', '〈 카드 슬롯 효과 〉', ...slotEffectLines);
    lines.push('', '〈 장착 중인 장비 〉');
    lines.push(formatEquippedEquipment('무기', 'weapon', user.equipments && user.equipments.weapon));
    lines.push(formatEquippedEquipment('갑옷', 'armor', user.equipments && user.equipments.armor));

    const accessories = user.equipments && user.equipments.accessory || {};
    const accessoryKeys = Object.keys(accessories).filter(key => accessories[key] && typeof accessories[key].id != 'undefined');
    if (accessoryKeys.length == 0) lines.push('[장신구] 없음');
    accessoryKeys.forEach(key => lines.push(formatEquippedEquipment('장신구', 'accessory', accessories[key])));
    lines.push('', '〈 스탯 〉');
    lines.push('공격력: ' + comma(stats.atk));
    lines.push('방어력: ' + comma(stats.def));
    lines.push('방어 관통력: ' + comma(stats.pnt));
    lines.push('치명타 확률: ' + formatStatValue('crit', stats.crit).replace(/^\+/, ''));
    lines.push('치명타 피해량: ' + formatStatValue('critMul', stats.critMul).replace(/^\+/, ''));
    const cp = calculateCombatPower(user);
    lines.push('', '〈 전투력 〉');
    lines.push('⚔️ 총 전투력: ' + comma(cp.total));
    lines.push('- 공격 ' + comma(cp.offense) + ' / 방어 ' + comma(cp.defense) + ' / 유틸 ' + comma(cp.utility));
    return lines.join('\n');
}

function getAccessibleDungeons(level) {
    const dungeons = readJson(DUNGEON_PATH, []);
    return dungeons.filter(dungeon => Number(dungeon.requireLevel || 1) <= Number(level || 1));
}

function formatFieldList(user) {
    const level = Number(user.level || 1);
    const dungeons = getAccessibleDungeons(level);
    const lines = ['[ 입장 가능한 필드 목록 ]', VIEWMORE];
    dungeons.forEach(dungeon => lines.push('〈 ' + dungeon.name + ' 〉 권장 Lv. ' + Number(dungeon.requireLevel || 1)));
    return lines.join('\n');
}

function findDungeonByName(name) {
    const dungeons = readJson(DUNGEON_PATH, []);
    return dungeons.find(dungeon => dungeon.name == name);
}

function getDamageAfterDefense(damage, defense, penetration) {
    const finalDefense = Math.max(0, Number(defense || 0) - Number(penetration || 0));
    return Math.floor(Number(damage || 0) * (100 / (100 + finalDefense)));
}

function getDamageAfterReducedDefense(damage, defense, penetration, defenseReductionRate) {
    const reducedDefense = Number(defense || 0) * (1 - Math.min(1, Math.max(0, Number(defenseReductionRate || 0))));
    return getDamageAfterDefense(damage, reducedDefense, penetration);
}

function applyCriticalDamage(damage, stats, extra) {
    const critChance = Math.max(0, Number(stats.crit || 0));
    const critMul = Number(stats.critMul || 1.4) + Number(extra && extra.critMulBonus || 0);
    const isCritical = Math.random() < critChance;
    return {
        damage: isCritical ? Math.round(Number(damage || 0) * critMul) : Number(damage || 0),
        isCritical: isCritical
    };
}

function getSkillValue(skill, index, star) {
    const format = skill.format && skill.format[index];
    return Number(format && format.base || 0) + Number(format && format.per_star || 0) * Number(star || 0);
}

function getMainCardSkills(user) {
    const characterCards = readJson(CHARACTER_CARDS_PATH, []);
    const skills = readJson(SKILLS_PATH, []);
    const card = user.main_card && characterCards[user.main_card.id];
    if (!card) return [];
    return (card.skills || []).map(index => ({ index: index, skill: skills[index] })).filter(data => data.skill);
}

function findUsableSkill(user, skillName) {
    return getMainCardSkills(user).find(data => data.skill.name == skillName);
}

function getPassiveMpRecovery(user) {
    const skillData = getMainCardSkills(user).find(data => data.skill.name == '피아스트');
    if (!skillData) return 0;
    return getSkillValue(skillData.skill, 1, user.main_card && user.main_card.star);
}

function addExperience(user, amount) {
    user.level = Number(user.level || 1);
    user.exp = Number(user.exp || 0) + Number(amount || 0);
    let levelUps = 0;
    let need = getMaxExpForLevel(user.level);
    while (need > 0 && user.exp >= need) {
        user.exp -= need;
        user.level += 1;
        levelUps++;
        need = getMaxExpForLevel(user.level);
    }
    if (levelUps > 0) user.statPoint = Number(user.statPoint || 0) + levelUps;
    return levelUps;
}

function getLevelExpMultiplier(userLevel, requireLevel) {
    const n = Number(userLevel || 1) - Number(requireLevel || 1);
    if (n <= 1) return 1.2;
    if (n <= 4) return 1.1;
    if (n <= 9) return 1.05;
    if (n == 10) return 1;
    if (n <= 12) return 0.99;
    if (n <= 14) return 0.98;
    if (n <= 16) return 0.97;
    if (n <= 18) return 0.96;
    if (n <= 20) return 0.95;
    if (n <= 39) return Math.max(0.71, 1.1 - n * 0.01);
    return 0.7;
}

function investStatPoint(user, statArg, countArg) {
    normalizeStatPointData(user);
    const option = STAT_POINT_OPTIONS[String(statArg || '').trim()];
    if (!option) return '❌ /RPGenius 스탯포인트 [공격력|체력|MP|방어력|방어 관통력] <숫자>';
    const count = typeof countArg == 'undefined' ? 1 : Number(countArg);
    if (!Number.isInteger(count) || count < 1) return '❌ 숫자는 1 이상의 정수여야 합니다.';
    if (Number(user.statPoint || 0) < count) return '❌ 잔여 스탯포인트가 부족합니다.';
    user.statPoint -= count;
    user.statPointStats[option.key] = Number(user.statPointStats[option.key] || 0) + count;
    const flatValue = option.flat * count;
    const plusValue = option.plus * count;
    const stats = calculateUserStats(user);
    user.hp = Math.min(typeof user.hp == 'undefined' ? Number(stats.hp || 0) : Number(user.hp || 0), Number(stats.hp || 0));
    user.mp = Math.min(typeof user.mp == 'undefined' ? Number(stats.mp || 0) : Number(user.mp || 0), Number(stats.mp || 0));
    if (plusValue > 0) return '✅ ' + option.label + '에 스탯포인트 ' + comma(count) + '을 투자해 ' + option.label + '이 ' + comma(flatValue) + ', ' + option.plusLabel + '이 +' + (Math.round(plusValue * 1000) / 10) + '% 증가했습니다.';
    return '✅ ' + option.label + '에 스탯포인트 ' + comma(count) + '을 투자해 ' + option.label + '이 ' + comma(flatValue) + ' 증가했습니다.';
}

function formatStatPointStatus(user) {
    normalizeStatPointData(user);
    const lines = ['[ 스탯포인트 현황 ]'];
    STAT_POINT_DISPLAY.forEach(stat => {
        const count = Number(user.statPointStats[stat.key] || 0);
        const flat = count * stat.flat;
        if (stat.plusKey) lines.push('- ' + stat.name + ' +' + comma(flat) + ' / +' + (Math.round(count * 10) / 10) + '%');
        else lines.push('- ' + stat.name + ' +' + comma(flat));
    });
    lines.push('', '잔여 스탯포인트: ' + comma(user.statPoint || 0));
    return lines.join('\n');
}

function enterField(user, fieldName) {
    const dungeon = findDungeonByName(fieldName);
    if (!dungeon) return '❌ 존재하지 않는 필드입니다.';
    const level = Number(user.level || 1);
    if (level < Number(dungeon.requireLevel || 1)) return '❌ 입장 레벨이 부족합니다.';
    const stats = calculateUserStats(user);
    const maxHp = Number(stats.hp || 0);
    const hp = typeof user.hp == 'undefined' ? maxHp : Number(user.hp || 0);
    if (hp <= 1) return '❌ 체력이 1 이하일 때는 필드에 입장할 수 없습니다.';
    user.hp = hp;
    const cooldowns = getFieldCooldowns(user);
    user.field = { name: dungeon.name, enteredAt: Date.now(), nextActionAt: Number(cooldowns.nextActionAt || 0), skillCooldowns: cooldowns.skillCooldowns, killCount: 0, elite: null };
    return '✅ 필드에 입장했습니다: ' + dungeon.name;
}

function leaveField(user) {
    if (!user.field || !user.field.name) return '❌ 입장 중인 필드가 없습니다.';
    const fieldName = user.field.name;
    saveFieldCooldowns(user);
    releaseEliteEncounter(user);
    user.field = null;
    return '✅ 필드에서 퇴장했습니다: ' + fieldName;
}

function getFieldCooldowns(user) {
    if (!user.fieldCooldowns || typeof user.fieldCooldowns != 'object') user.fieldCooldowns = {};
    if (!user.fieldCooldowns.skillCooldowns || typeof user.fieldCooldowns.skillCooldowns != 'object') user.fieldCooldowns.skillCooldowns = {};
    user.fieldCooldowns.nextActionAt = Number(user.fieldCooldowns.nextActionAt || 0);
    return user.fieldCooldowns;
}

function saveFieldCooldowns(user) {
    if (!user || !user.field) return;
    const cooldowns = getFieldCooldowns(user);
    cooldowns.nextActionAt = Number(user.field.nextActionAt || 0);
    cooldowns.skillCooldowns = user.field.skillCooldowns && typeof user.field.skillCooldowns == 'object' ? user.field.skillCooldowns : {};
}

function setFieldNextActionAt(user, nextActionAt) {
    if (!user || !user.field) return;
    user.field.nextActionAt = nextActionAt;
    getFieldCooldowns(user).nextActionAt = nextActionAt;
}

function getEliteState(fieldName) {
    if (!eliteFieldStates[fieldName]) eliteFieldStates[fieldName] = { owner: null, defeatedAt: 0 };
    return eliteFieldStates[fieldName];
}

function releaseEliteEncounter(user) {
    if (!user || !user.field || !user.field.name) return;
    const state = getEliteState(user.field.name);
    if (state.owner == user.name) state.owner = null;
}

function tryEncounterElite(user, dungeon, lines) {
    if (!dungeon.elite || !user.field || user.field.elite) return;
    if (Number(user.field.killCount || 0) < ELITE_KILL_REQUIREMENT) return;
    const state = getEliteState(dungeon.name);
    if (state.owner || Date.now() - Number(state.defeatedAt || 0) < ELITE_RESPAWN_COOLDOWN) return;
    if (Math.random() >= ELITE_ENCOUNTER_RATE) return;
    state.owner = user.name;
    user.field.elite = { hp: Number(dungeon.elite.hp || 0), encounteredAt: Date.now() };
    lines.push('', '⚠️ 엘리트 몬스터 조우!');
    lines.push('- ' + dungeon.elite.name + '이(가) 나타났습니다!');
}

function applyEliteReward(user, dungeon, slotEffects, extra, lines) {
    const items = readJson(ITEMS_PATH, []);
    const stats = calculateUserStats(user);
    const rewardLines = [];
    let levelUps = 0;
    (dungeon.elite.reward || []).forEach(reward => {
        if (reward.roll != null && Math.random() >= Number(reward.roll || 0)) return;
        const count = rollCount(reward.count);
        if (reward.type == '경험치') {
            const levelExpMultiplier = getLevelExpMultiplier(user.level, dungeon.requireLevel);
            const amount = Math.round(count * levelExpMultiplier * (1 + Number(slotEffects.expBonus || 0) + Number(stats.exp || 0)));
            levelUps += addExperience(user, amount);
            rewardLines.push('- XP ' + comma(amount));
            return;
        }
        if (reward.type == '골드') {
            const amount = Math.round(count * (1 + Number(slotEffects.goldBonus || 0) + Number(extra && extra.goldBonus || 0) + Number(stats.gold || 0)));
            user.gold = Number(user.gold || 0) + amount;
            rewardLines.push('- 🪙 ' + comma(amount));
            return;
        }
        if (reward.type == '아이템') {
            addInventoryItem(user, reward.item_id, count);
            const item = items[reward.item_id];
            rewardLines.push('- ' + (item ? item.name : '알 수 없는 아이템') + ' x' + comma(count));
        }
    });
    lines.push('', '[ 엘리트 처치 보상 ]');
    if (rewardLines.length > 0) rewardLines.forEach(line => lines.push(line));
    else lines.push('- 없음');
    if (levelUps > 0) lines.push('- 레벨업! Lv. ' + user.level);
}

function buildEliteHuntResult(user, dungeon, rawDamage, extra) {
    const stats = calculateUserStats(user);
    const slotEffects = calculateCardSlotEffects(user);
    const elite = dungeon.elite;
    const currentHp = Number(user.field.elite && user.field.elite.hp || elite.hp || 0);
    const damageWithSlotBonus = Number(rawDamage || 0) * (1 + slotEffects.damageBonus) * (1 + Number(stats.eliteDmg || 0));
    const criticalResult = applyCriticalDamage(damageWithSlotBonus, stats, extra);
    let finalDamage = getDamageAfterReducedDefense(criticalResult.damage, elite.def, extra && extra.pnt || stats.pnt, slotEffects.defReduction);
    let bonusTripleZero = 0;
    if (Number(stats['000'] || 0) > 0 && Math.random() < Number(stats['000'])) {
        bonusTripleZero = [10, 100, 1000][randomInt(0, 2)];
        finalDamage += bonusTripleZero;
    }
    if (extra && Number(extra.skillTrueDmg || 0) > 0) finalDamage += Number(extra.skillTrueDmg);
    const remainHp = Math.max(0, currentHp - finalDamage);
    const maxHp = Number(stats.hp || 0);
    const lines = ['⚔️ ' + elite.name + '에게 ' + comma(finalDamage) + (criticalResult.isCritical ? ' 치명타 ' : ' ') + '피해를 입혔습니다!'];
    if (bonusTripleZero > 0) lines.push('- 0️⃣ 추가 피해 +' + comma(bonusTripleZero));
    if (remainHp <= 0) {
        lines.push('- ' + elite.name + ' 처치!');
        applyEliteReward(user, dungeon, slotEffects, extra, lines);
        const state = getEliteState(dungeon.name);
        state.owner = null;
        state.defeatedAt = Date.now();
        user.field.elite = null;
        setFieldNextActionAt(user, Date.now() + randomInt(2000, 3000));
        return lines.join('\n');
    }
    user.field.elite.hp = remainHp;
    lines.push('- ' + elite.name + ' HP: ' + comma(remainHp) + '/' + comma(elite.hp));
    const avoided = Number(stats.avd || 0) > 0 && Math.random() < Number(stats.avd);
    const fieldDamageBase = Number(elite.atk || 0) * (extra && extra.receivedDamageMul || 1) * (1 - Math.min(1, slotEffects.hpDamageReduction));
    const fieldDamage = avoided ? 0 : getDamageAfterDefense(fieldDamageBase, stats.def, elite.pnt);
    const beforeHp = typeof user.hp == 'undefined' ? maxHp : Number(user.hp || 0);
    user.hp = Math.max(0, beforeHp - fieldDamage);
    if (avoided) lines.push('💨 ' + elite.name + '의 공격을 회피했습니다!');
    else lines.push('❗ ' + elite.name + '에게 ' + comma(fieldDamage) + ' 피해를 입었습니다!');
    if (user.hp <= 0) {
        user.hp = 1;
        saveFieldCooldowns(user);
        releaseEliteEncounter(user);
        user.field = null;
        lines.push('- 남은 체력: 1/' + comma(maxHp));
        lines.push('', '💀 보상을 획득하지 못하고 필드에서 퇴장했습니다.');
        return lines.join('\n');
    }
    lines.push('- 남은 체력: ' + comma(user.hp) + '/' + comma(maxHp));
    setFieldNextActionAt(user, Date.now() + randomInt(2000, 3000));
    return lines.join('\n');
}

function buildHuntResult(user, dungeon, rawDamage, extra) {
    const stats = calculateUserStats(user);
    const slotEffects = calculateCardSlotEffects(user);
    const damageWithSlotBonus = Number(rawDamage || 0) * (1 + slotEffects.damageBonus);
    const criticalResult = applyCriticalDamage(damageWithSlotBonus, stats, extra);
    let finalDamage = getDamageAfterReducedDefense(criticalResult.damage, dungeon.def, extra && extra.pnt || stats.pnt, slotEffects.defReduction);
    let bonusTripleZero = 0;
    if (Number(stats['000'] || 0) > 0 && Math.random() < Number(stats['000'])) {
        bonusTripleZero = [10, 100, 1000][randomInt(0, 2)];
        finalDamage += bonusTripleZero;
    }
    if (extra && Number(extra.skillTrueDmg || 0) > 0) finalDamage += Number(extra.skillTrueDmg);
    const killCount = Math.floor(finalDamage / Number(dungeon.hp || 1));
    const avoided = Number(stats.avd || 0) > 0 && Math.random() < Number(stats.avd);
    const fieldDamageBase = Number(dungeon.atk || 0) * (extra && extra.receivedDamageMul || 1) * (1 - Math.min(1, slotEffects.hpDamageReduction));
    const fieldDamage = avoided ? 0 : getDamageAfterDefense(fieldDamageBase, stats.def, dungeon.pnt);
    const maxHp = Number(stats.hp || 0);
    const beforeHp = typeof user.hp == 'undefined' ? maxHp : Number(user.hp || 0);
    user.hp = Math.max(0, beforeHp - fieldDamage);

    const lines = ['⚔️ ' + comma(finalDamage) + (criticalResult.isCritical ? ' 치명타 ' : ' ') + '피해를 입혔습니다!', '- 총 ' + comma(killCount) + '마리 처치'];
    if (bonusTripleZero > 0) lines.push('- 0️⃣ 추가 피해 +' + comma(bonusTripleZero));
    if (avoided) lines.push('💨 필드 피해를 회피했습니다!');
    else lines.push('❗ ' + comma(fieldDamage) + ' 피해를 입었습니다!');

    if (user.hp <= 0) {
        user.hp = 1;
        saveFieldCooldowns(user);
        user.field = null;
        lines.push('- 남은 체력: 1/' + comma(maxHp));
        lines.push('', '💀 보상을 획득하지 못하고 필드에서 퇴장했습니다.');
        return lines.join('\n');
    }

    lines.push('- 남은 체력: ' + comma(user.hp) + '/' + comma(maxHp));

    if (killCount > 0) {
        user.field.killCount = Number(user.field.killCount || 0) + killCount;
        const levelExpMultiplier = getLevelExpMultiplier(user.level, dungeon.requireLevel);
        let expReward = Math.round(Number(dungeon.reward && dungeon.reward.exp || 0) * killCount * levelExpMultiplier * (1 + slotEffects.expBonus + Number(stats.exp || 0)));
        let goldReward = 0;
        for (let i = 0; i < killCount; i++) goldReward += randomInt(Number(dungeon.reward.gold.min || 0), Number(dungeon.reward.gold.max || 0));
        goldReward = Math.round(goldReward * (1 + slotEffects.goldBonus + Number(extra && extra.goldBonus || 0) + Number(stats.gold || 0)));
        user.gold = Number(user.gold || 0) + goldReward;
        const levelUps = addExperience(user, expReward);
        lines.push('', '[ 보상 ]');
        lines.push('- XP ' + comma(expReward));
        lines.push('- 🪙 ' + comma(goldReward));
        let stoneDropCount = 0;
        for (let i = 0; i < killCount; i++) if (Math.random() < 0.2) stoneDropCount++;
        if (stoneDropCount > 0) {
            addInventoryItem(user, EQUIPMENT_STONE_ITEM_ID, stoneDropCount);
            lines.push('- 강화석 x' + comma(stoneDropCount));
        }
        const items = readJson(ITEMS_PATH, []);
        const baitItemId = items.findIndex(item => item.name == '일반 떡밥');
        let baitDropCount = 0;
        for (let i = 0; i < killCount; i++) if (Math.random() < 0.55) baitDropCount++;
        if (baitItemId != -1 && baitDropCount > 0) {
            addInventoryItem(user, baitItemId, baitDropCount);
            lines.push('- 일반 떡밥 x' + comma(baitDropCount));
        }
        if (levelUps > 0) lines.push('- 레벨업! Lv. ' + user.level);
    }

    if (killCount > 0) {
        const dropChance = 0.03 + Number(slotEffects.itemDropChance || 0);
        if (Math.random() < dropChance) {
            const items = readJson(ITEMS_PATH, []);
            const dropItemId = items.findIndex(item => item.name == '장비 상자');
            if (dropItemId != -1) {
                addInventoryItem(user, dropItemId, 1);
                lines.push('- 📦 ' + items[dropItemId].name + ' 획득!');
            }
        }
        if (Math.random() < dropChance) {
            const items = readJson(ITEMS_PATH, []);
            const dropItemId = items.findIndex(item => item.name == '카드팩 상자');
            if (dropItemId != -1) {
                addInventoryItem(user, dropItemId, 1);
                lines.push('- 📦 ' + items[dropItemId].name + ' 획득!');
            }
        }
    }

    if (killCount > 0 && slotEffects.killRecoveryChance > 0) {
        const beforeRecoverHp = Number(user.hp || 0);
        user.hp = Math.min(maxHp, beforeRecoverHp + Math.round((maxHp - beforeRecoverHp) * 0.05));
        if (user.hp - beforeRecoverHp > 0) lines.push('- 처치 회복: HP +' + comma(user.hp - beforeRecoverHp));
    }

    const passiveMp = getPassiveMpRecovery(user);
    if (killCount > 0 && passiveMp > 0) {
        const beforeMp = typeof user.mp == 'undefined' ? Number(stats.mp || 0) : Number(user.mp || 0);
        user.mp = Math.min(Number(stats.mp || 0), beforeMp + passiveMp);
        if (user.mp - beforeMp > 0) lines.push('- MP +' + comma(user.mp - beforeMp));
    }

    setFieldNextActionAt(user, Date.now() + randomInt(2000, 3000));
    if (killCount > 0) tryEncounterElite(user, dungeon, lines);
    return lines.join('\n');
}

function useBasicAttackInField(user) {
    if (!user.field || !user.field.name) return '❌ 필드에 입장한 상태가 아닙니다.';
    const now = Date.now();
    if (now < Number(user.field.nextActionAt || 0)) return '❌ 아직 행동할 수 없습니다. (' + Math.ceil((user.field.nextActionAt - now) / 1000) + '초)';
    const dungeon = findDungeonByName(user.field.name);
    if (!dungeon) return '❌ 현재 필드를 찾을 수 없습니다.';
    const stats = calculateUserStats(user);
    const rawDamage = Math.round(Number(stats.atk || 0) * (1 + Number(stats.afterBasic || 0)) * (randomInt(95, 105) / 100));
    if (user.field.elite) return buildEliteHuntResult(user, dungeon, rawDamage, {});
    return buildHuntResult(user, dungeon, rawDamage, {});
}

function useSkillInField(user, skillName) {
    if (!user.field || !user.field.name) return '❌ 필드에 입장한 상태가 아닙니다.';
    const now = Date.now();
    if (now < Number(user.field.nextActionAt || 0)) return '❌ 아직 행동할 수 없습니다. (' + Math.ceil((user.field.nextActionAt - now) / 1000) + '초)';
    if (!user.field.skillCooldowns) user.field.skillCooldowns = {};
    const skillData = findUsableSkill(user, skillName);
    if (!skillData) return '❌ 사용할 수 없는 스킬입니다.';
    const cooldownEnd = Number(user.field.skillCooldowns[skillData.skill.name] || 0);
    if (now < cooldownEnd) return '❌ 스킬 쿨타임입니다. (' + Math.ceil((cooldownEnd - now) / 1000) + '초)';

    const stats = calculateUserStats(user);
    const slotEffects = calculateCardSlotEffects(user);
    const maxMp = Number(stats.mp || 0);
    const mp = typeof user.mp == 'undefined' ? maxMp : Number(user.mp || 0);
    const mpCost = Math.max(0, Math.round(Number(skillData.skill.mp_cost || 0) * (1 - Math.min(1, slotEffects.mpCostReduction)) * (1 + Number(stats.mpReduce || 0))));
    if (mp < mpCost) return '❌ MP가 부족합니다.';
    user.mp = mp - mpCost;

    const dungeon = findDungeonByName(user.field.name);
    if (!dungeon) return '❌ 현재 필드를 찾을 수 없습니다.';
    const star = Number(user.main_card && user.main_card.star || 0);
    let multiplier = getSkillValue(skillData.skill, 0, star);
    const extra = {};
    if (skillData.skill.name == '글버지') multiplier *= 2;
    if (skillData.skill.name == '불사조') extra.receivedDamageMul = 1.5;
    if (skillData.skill.name == 'SUPER EASY') extra.critMulBonus = getSkillValue(skillData.skill, 1, star);
    if (skillData.skill.name == '백억이요') extra.goldBonus = getSkillValue(skillData.skill, 1, star);
    if (skillData.skill.name == '청정수 투척') extra.pnt = Number(stats.pnt || 0) + getSkillValue(skillData.skill, 1, star);
    if (Number(stats.skillTrueDmg || 0) > 0) extra.skillTrueDmg = Number(stats.skillTrueDmg);
    const rawDamage = Math.round(Number(stats.atk || 0) * multiplier * (1 + Number(stats.afterSkill || 0)));
    const cooltime = Math.max(0, Number(skillData.skill.cooltime || 0) + Number(stats.skillCooldown || 0));
    user.field.skillCooldowns[skillData.skill.name] = now + cooltime;
    getFieldCooldowns(user).skillCooldowns = user.field.skillCooldowns;
    if (user.field.elite) return buildEliteHuntResult(user, dungeon, rawDamage, extra);
    return buildHuntResult(user, dungeon, rawDamage, extra);
}

async function sendCharacterCardCoverImage(channel, card) {
    const fileName = '캐릭터표지.png';
    const filePath = path.join(CARD_IMAGE_PATH, card.name, fileName);
    if (!fs.existsSync(filePath)) return;
    await channel.sendMedia(node_kakao.KnownChatType.PHOTO, { name: fileName, data: fs.readFileSync(filePath), width: 1920, height: 1080, ext: 'png' });
}

async function sendUserMainCardImage(channel, user) {
    const characterCards = readJson(CHARACTER_CARDS_PATH, []);
    const mainCard = user.main_card;
    const card = mainCard && characterCards[mainCard.id];
    if (!card) return;
    const star = String(Number(mainCard.star || 0) + 1).padStart(2, '0');
    const fileName = star + ' ' + card.name + '.png';
    const filePath = path.join(CARD_IMAGE_PATH, card.name, fileName);
    if (!fs.existsSync(filePath)) return;
    await channel.sendMedia(node_kakao.KnownChatType.PHOTO, { name: fileName, data: fs.readFileSync(filePath), width: 399, height: 515, ext: 'png' });
}

function formatDescription(name) {
    const items = readJson(ITEMS_PATH, []);
    const packs = readJson(PACKS_PATH, []);
    const bundles = readJson(BUNDLE_PATH, []);

    const item = items.find(data => data.name == name);
    if (item) {
        const lines = ['《 ' + formatNameWithTrade(item) + ' 》 [' + item.type + ']', '- ' + item.desc];
        if (item.type == '가챠' && typeof item.pack == 'number' && packs[item.pack]) lines.push(VIEWMORE, formatPack(packs[item.pack]));
        if (item.type == '번들' && typeof item.pack == 'number' && bundles[item.pack]) lines.push(VIEWMORE, formatBundle(bundles[item.pack]));
        return lines.join('\n');
    }

    const characterCard = findCharacterCardByName(name);
    if (characterCard) {
        return ['《 ' + characterCard.card.name + ' 》 [캐릭터 카드]', VIEWMORE, formatCharacterCardDetail(characterCard.card)].join('\n');
    }

    const equipment = findEquipmentByName(name);
    if (equipment) {
        return ['《 ' + formatNameWithTrade(equipment.equipment) + ' 》 [' + equipment.equipment.rarity + ' ' + equipment.type + ']', '- ' + equipment.equipment.desc, VIEWMORE, formatEquipmentStatLines(equipment.equipment)].join('\n');
    }

    return null;
}

function formatInventory(user) {
    const items = readJson(ITEMS_PATH, []);
    const lines = [
        '[ ' + user.name + '님의 인벤토리 ]',
        '🪙 ' + comma(user.gold),
        '💠 ' + comma(user.garnet),
        '💵 ' + comma(user.point) + 'P | Ⓜ️ ' + comma(user.mileage)
    ];
    const inventoryItems = (user.inventory.item || [])
        .map(inv => ({ data: items[inv.id], count: Number(inv.count || 0) }))
        .filter(inv => inv.data && inv.count > 0);

    if (inventoryItems.length == 0) {
        lines.push('', '인벤토리가 비어있습니다.');
        return lines.join('\n');
    }

    lines.push(VIEWMORE);
    ITEM_TYPE_ORDER.forEach(type => {
        const typeItems = inventoryItems
            .filter(inv => inv.data.type == type)
            .sort((a, b) => a.data.name.localeCompare(b.data.name, 'ko-KR'));
        if (typeItems.length > 0) {
            lines.push('', '《 ' + type + ' 》');
            typeItems.forEach(inv => lines.push('- ' + inv.data.name + ' x' + comma(inv.count)));
        }
    });
    return lines.join('\n');
}

function formatCharacterInventory(user) {
    const characterCards = readJson(CHARACTER_CARDS_PATH, []);
    const cards = user.inventory.card || [];
    const lines = ['[ ' + user.name + '님의 캐릭터 카드 (' + cards.length + '/' + user.maxCardLimit + ') ]'];

    if (cards.length == 0) {
        lines.push('', '캐릭터 카드가 없습니다.');
        return lines.join('\n');
    }

    lines.push(VIEWMORE);
    cards.forEach((card, index) => {
        const data = characterCards[card.id];
        if (data) lines.push('[' + (index + 1) + '] [' + formatStar(card.star) + '] ' + card.type + ' ' + data.name);
    });
    return lines.join('\n');
}

function getEquippedEquipmentRefs(user) {
    const refs = [];
    if (user.equipments && user.equipments.weapon && typeof user.equipments.weapon.id != 'undefined') refs.push({ type: 'weapon', equip: user.equipments.weapon });
    if (user.equipments && user.equipments.armor && typeof user.equipments.armor.id != 'undefined') refs.push({ type: 'armor', equip: user.equipments.armor });
    const accessories = user.equipments && user.equipments.accessory || {};
    Object.keys(accessories).forEach(key => {
        if (accessories[key] && typeof accessories[key].id != 'undefined') refs.push({ type: 'accessory', equip: accessories[key] });
    });
    return refs;
}

function getAllUserEquipments(user) {
    const list = [];
    (user.inventory && Array.isArray(user.inventory.equipment) ? user.inventory.equipment : []).forEach((equip, index) => list.push({ source: 'inventory', index, equip }));
    getEquippedEquipmentRefs(user).forEach(ref => list.push({ source: 'equipped', type: ref.type, equip: ref.equip }));
    return list;
}

function removeSelectedEquipment(user, selected) {
    if (selected.source == 'inventory') {
        user.inventory.equipment.splice(selected.index, 1);
        return true;
    }
    if (selected.source == 'equipped' && selected.type == 'weapon') {
        user.equipments.weapon = null;
        return true;
    }
    if (selected.source == 'equipped' && selected.type == 'armor') {
        user.equipments.armor = null;
        return true;
    }
    if (selected.source == 'equipped' && selected.type == 'accessory' && typeof selected.slotKey != 'undefined') {
        delete user.equipments.accessory[selected.slotKey];
        return true;
    }
    return false;
}

function getEquipmentTypeLabel(type) {
    if (type == 'weapon') return '무기';
    if (type == 'armor') return '갑옷';
    if (type == 'accessory') return '장신구';
    return type;
}

function formatEquipmentInventoryLine(number, entry) {
    const data = getEquipmentData(entry.equip.type || entry.type, entry.equip.id);
    if (!data) return null;
    const level = Number(entry.equip.level || 0);
    return '[' + number + '] <' + data.rarity + '> ' + data.name + (level > 0 ? ' +' + level : '') + (entry.source == 'equipped' ? ' (장착)' : '');
}

function formatEquipmentInventory(user) {
    const lines = ['[ ' + user.name + '님의 보유 장비 ]', VIEWMORE];
    const all = getAllUserEquipments(user);
    const types = [['weapon', '무기'], ['armor', '갑옷'], ['accessory', '장신구']];
    let hasEquipment = false;
    types.forEach(type => {
        const filtered = all
            .map((entry, index) => Object.assign({ number: index + 1 }, entry))
            .filter(entry => (entry.equip.type || entry.type) == type[0]);
        if (filtered.length == 0) return;
        hasEquipment = true;
        lines.push('', '《 ' + type[1] + ' 》');
        filtered.forEach(entry => {
            const line = formatEquipmentInventoryLine(entry.number, entry);
            if (line) lines.push(line);
        });
    });
    if (!hasEquipment) lines.push('', '보유 중인 장비가 없습니다.');
    return lines.join('\n');
}

function formatShopItem(shopItem) {
    const items = readJson(ITEMS_PATH, []);
    if (shopItem.type == '아이템') {
        const item = items[shopItem.item_id];
        const itemName = item ? item.name : '알 수 없는 아이템';
        return itemName + ' x' + comma(shopItem.count);
    }
    if (shopItem.type == '가넷') return '💠 ' + comma(shopItem.count);
    if (shopItem.type == '골드') return '🪙 ' + comma(shopItem.count);
    if (shopItem.type == '마일리지') return 'Ⓜ️ ' + comma(shopItem.count);
    return shopItem.type;
}

function formatPrice(price) {
    if (price.goods == 'gold') return '🪙 ' + comma(price.amount);
    if (price.goods == 'garnet') return '💠 ' + comma(price.amount);
    if (price.goods == 'point') return '💵 ' + comma(price.amount) + 'P';
    if (price.goods == 'mileage') return 'Ⓜ️ ' + comma(price.amount);
    return comma(price.amount);
}

function formatShop(shopType) {
    const shops = readJson(SHOP_PATH, {});
    const shop = shops[shopType];
    if (!shop || !Array.isArray(shop)) return null;
    
    const lines = ['[ ' + shopType + ' 상점 ]', VIEWMORE];
    shop.forEach((item, index) => {
        lines.push('│ [' + (index + 1) + '] 〈 ' + formatShopItem(item) + ' 〉');
        lines.push('│ 가격: ' + formatPrice(item.price));
        lines.push('');
    });
    return lines.join('\n').trim();
}

const GOODS_FIELD = { gold: 'gold', garnet: 'garnet', point: 'point', mileage: 'mileage' };

function cleanupInventoryItems(user) {
    if (user.inventory && Array.isArray(user.inventory.item)) {
        user.inventory.item = user.inventory.item.filter(inv => Number(inv.count || 0) > 0);
    }
}

function addInventoryItem(user, itemId, count) {
    if (!user.inventory) user.inventory = { card: [], item: [] };
    if (!Array.isArray(user.inventory.item)) user.inventory.item = [];
    const existing = user.inventory.item.find(inv => inv.id == itemId);
    if (existing) existing.count = Number(existing.count || 0) + count;
    else user.inventory.item.push({ id: itemId, count: count });
    cleanupInventoryItems(user);
}

function getInventoryItemCount(user, itemId) {
    if (!user.inventory || !Array.isArray(user.inventory.item)) return 0;
    const item = user.inventory.item.find(inv => inv.id == itemId);
    return item ? Number(item.count || 0) : 0;
}

function removeInventoryItem(user, itemId, count) {
    if (!user.inventory || !Array.isArray(user.inventory.item)) return false;
    const item = user.inventory.item.find(inv => inv.id == itemId);
    if (!item || Number(item.count || 0) < count) return false;
    item.count = Number(item.count || 0) - count;
    cleanupInventoryItems(user);
    return true;
}

function getRecipeEquipmentType(material) {
    if (material.type == '무기') return 'weapon';
    if (material.type == '갑옷') return 'armor';
    if (material.type == '장신구') return 'accessory';
    return null;
}

function getRecipeEquipmentId(material) {
    if (material.type == '무기') return material.weapon_id;
    if (material.type == '갑옷') return material.armor_id;
    if (material.type == '장신구') return material.accessory_id;
    return null;
}

function getInventoryEquipmentCount(user, material) {
    const type = getRecipeEquipmentType(material);
    const id = getRecipeEquipmentId(material);
    if (!type || typeof id == 'undefined' || !user.inventory || !Array.isArray(user.inventory.equipment)) return 0;
    return user.inventory.equipment.filter(equip => equip.type == type && Number(equip.id) == Number(id)).length;
}

function removeInventoryEquipment(user, material, count) {
    const type = getRecipeEquipmentType(material);
    const id = getRecipeEquipmentId(material);
    if (!type || typeof id == 'undefined' || !user.inventory || !Array.isArray(user.inventory.equipment)) return false;
    if (getInventoryEquipmentCount(user, material) < count) return false;
    let remain = count;
    for (let i = user.inventory.equipment.length - 1; i >= 0 && remain > 0; i--) {
        const equip = user.inventory.equipment[i];
        if (equip.type == type && Number(equip.id) == Number(id)) {
            user.inventory.equipment.splice(i, 1);
            remain--;
        }
    }
    return remain == 0;
}

function getKoreanDateKey(date) {
    const koreaTime = new Date(date.getTime() + 9 * 60 * 60 * 1000);
    return koreaTime.toISOString().slice(0, 10);
}

function checkAttendance(user) {
    const today = getKoreanDateKey(new Date());
    if (user.lastAttendanceDate == today) return '❌ 오늘은 이미 출석체크를 완료했습니다.';
    user.lastAttendanceDate = today;
    addInventoryItem(user, ATTENDANCE_STAMP_ITEM_ID, 1);
    const items = readJson(ITEMS_PATH, []);
    const stamp = items[ATTENDANCE_STAMP_ITEM_ID];
    return '✅ 출석체크 완료!\n\n[ 획득 물품 ]\n- ' + (stamp ? stamp.name : '출석 도장') + ' x1';
}

function getRecipeByName(name) {
    const recipes = readJson(RECIPE_PATH, []);
    return recipes.find(recipe => recipe.name == name);
}

function getRecipeEntryCount(entry) {
    if (typeof entry.count == 'object') return Number(entry.count.min || 0);
    return Number(entry.count || 1);
}

function getCraftMaterialStatus(user, material) {
    const need = getRecipeEntryCount(material);
    if (material.type == '아이템') {
        const have = getInventoryItemCount(user, material.item_id);
        return { have, need, ok: have >= need };
    }
    if (material.type == '골드') {
        const have = Number(user.gold || 0);
        return { have, need, ok: have >= need };
    }
    if (material.type == '가넷') {
        const have = Number(user.garnet || 0);
        return { have, need, ok: have >= need };
    }
    if (['무기', '갑옷', '장신구'].includes(material.type)) {
        const have = getInventoryEquipmentCount(user, material);
        return { have, need, ok: have >= need };
    }
    return { have: 0, need, ok: false };
}

function consumeCraftMaterial(user, material) {
    const count = getRecipeEntryCount(material);
    if (material.type == '아이템') return removeInventoryItem(user, material.item_id, count);
    if (material.type == '골드') {
        if (Number(user.gold || 0) < count) return false;
        user.gold = Number(user.gold || 0) - count;
        return true;
    }
    if (material.type == '가넷') {
        if (Number(user.garnet || 0) < count) return false;
        user.garnet = Number(user.garnet || 0) - count;
        return true;
    }
    if (['무기', '갑옷', '장신구'].includes(material.type)) return removeInventoryEquipment(user, material, count);
    return false;
}

function canConsumeCraftMaterials(user, materials) {
    const clone = JSON.parse(JSON.stringify({
        gold: Number(user.gold || 0),
        garnet: Number(user.garnet || 0),
        inventory: user.inventory || {}
    }));
    return (materials || []).every(material => consumeCraftMaterial(clone, material));
}

function formatCraftMaterial(material, need) {
    const text = formatPackEntry(material);
    if (['무기', '갑옷', '장신구'].includes(material.type)) return text + ' x' + comma(need);
    return text.replace(/x[\d,]+(?:~[\d,]+)?$/, 'x' + comma(need));
}

function grantCraftEntry(user, entry) {
    const count = getRecipeEntryCount(entry);
    if (entry.type == '아이템') {
        addInventoryItem(user, entry.item_id, count);
        return;
    }
    if (entry.type == '무기') {
        for (let i = 0; i < count; i++) addEquipmentInventory(user, 'weapon', entry.weapon_id);
        return;
    }
    if (entry.type == '갑옷') {
        for (let i = 0; i < count; i++) addEquipmentInventory(user, 'armor', entry.armor_id);
        return;
    }
    if (entry.type == '장신구') {
        for (let i = 0; i < count; i++) addEquipmentInventory(user, 'accessory', entry.accessory_id);
    }
}

function formatCraftPreview(user, name) {
    const recipe = getRecipeByName(name);
    if (!recipe) return '❌ 존재하지 않는 제작 레시피입니다.';
    const lines = ['⚒️ ' + recipe.name + ' 제작', '', '- 필요한 재료:'];
    (recipe.materials || []).forEach(material => {
        const status = getCraftMaterialStatus(user, material);
        lines.push((status.ok ? '✅ ' : '❌ ') + formatCraftMaterial(material, status.need) + ' (' + comma(status.have) + '/' + comma(status.need) + ')');
    });
    lines.push('', '- 제작 시 획득 물품:');
    (recipe.crafted || []).forEach(entry => lines.push(' ㄴ ' + formatPackEntry(entry)));
    if (!canConsumeCraftMaterials(user, recipe.materials || [])) {
        user.pendingAction = null;
        lines.push('', '❌ 재료가 부족합니다.');
    } else {
        user.pendingAction = { type: '제작', name: recipe.name };
        lines.push('', '제작하시겠습니까?', '/RPGenius 제작');
    }
    return lines.join('\n');
}

function runCraft(user) {
    const pending = user.pendingAction;
    if (!pending || pending.type != '제작') return '❌ 진행 중인 제작이 없습니다.';
    const recipe = getRecipeByName(pending.name);
    user.pendingAction = null;
    if (!recipe) return '❌ 존재하지 않는 제작 레시피입니다.';
    if (!canConsumeCraftMaterials(user, recipe.materials || [])) return '❌ 재료가 부족합니다.';
    if (!(recipe.materials || []).every(material => consumeCraftMaterial(user, material))) return '❌ 재료 차감 중 오류가 발생했습니다.';
    (recipe.crafted || []).forEach(entry => grantCraftEntry(user, entry));
    const lines = ['✅ \'' + recipe.name + '\' 제작에 성공했습니다.', '', '[ 획득 물품 ]'];
    (recipe.crafted || []).forEach(entry => lines.push('- ' + formatPackEntry(entry)));
    return lines.join('\n');
}

function findItemByName(name) {
    const items = readJson(ITEMS_PATH, []);
    const index = items.findIndex(item => item.name == name);
    if (index == -1) return null;
    return { index, item: items[index] };
}

const fishingTimers = {};
const fishingChannels = {};
const FISHING_BAIT_ITEM_ID = 37;
const FISHING_REWARDS = [
    { id: 38, rate: 600 },
    { id: 39, rate: 250 },
    { id: 40, rate: 90 },
    { id: 0, rate: 30 },
    { id: 15, rate: 15 },
    { id: 18, rate: 10 },
    { id: 19, rate: 4 },
    { id: 20, rate: 1 }
];

function normalizeFishingData(user) {
    if (!user.fishingNet || typeof user.fishingNet != 'object') user.fishingNet = {};
    Object.keys(user.fishingNet).forEach(itemId => {
        user.fishingNet[itemId] = Number(user.fishingNet[itemId] || 0);
        if (user.fishingNet[itemId] <= 0) delete user.fishingNet[itemId];
    });
    if (!user.fishingNetLimit) user.fishingNetLimit = 200;
    if (typeof user.fishing == 'undefined') user.fishing = false;
}

function getFishingNetCount(user) {
    normalizeFishingData(user);
    return Object.keys(user.fishingNet).reduce((sum, itemId) => sum + Number(user.fishingNet[itemId] || 0), 0);
}

function getRandomFishingRewardId() {
    const roll = randomInt(1, 1000);
    let acc = 0;
    for (let i = 0; i < FISHING_REWARDS.length; i++) {
        acc += FISHING_REWARDS[i].rate;
        if (roll <= acc) return FISHING_REWARDS[i].id;
    }
    return FISHING_REWARDS[0].id;
}

function addFishingNetItem(user, itemId, count) {
    normalizeFishingData(user);
    user.fishingNet[itemId] = Number(user.fishingNet[itemId] || 0) + Number(count || 0);
}

function formatFishingNet(user) {
    normalizeFishingData(user);
    const items = readJson(ITEMS_PATH, []);
    const current = getFishingNetCount(user);
    const lines = ['🪣 ' + user.name + '님의 살림망 (' + comma(current) + '/' + comma(user.fishingNetLimit) + ')'];
    Object.keys(user.fishingNet).forEach(itemId => {
        const data = items[itemId];
        const count = Number(user.fishingNet[itemId] || 0);
        if (data && count > 0) lines.push('- ' + data.name + ' x' + comma(count));
    });
    if (lines.length == 1) lines.push('- 비어있음');
    return lines.join('\n');
}

function clearFishingTimer(name) {
    if (fishingTimers[name]) {
        clearTimeout(fishingTimers[name]);
        delete fishingTimers[name];
    }
}

async function stopFishingByName(name, message) {
    clearFishingTimer(name);
    const user = await getRPGUserByName(name);
    if (!user) return;
    normalizeFishingData(user);
    user.fishing = false;
    await user.save();
    const channel = fishingChannels[name];
    delete fishingChannels[name];
    if (channel && message) channel.sendChat(message(user));
}

function scheduleFishing(user, channel) {
    clearFishingTimer(user.name);
    fishingChannels[user.name] = channel;
    fishingTimers[user.name] = setTimeout(async () => {
        const latest = await getRPGUserByName(user.name);
        if (!latest) {
            clearFishingTimer(user.name);
            delete fishingChannels[user.name];
            return;
        }
        normalizeFishingData(latest);
        if (!latest.fishing) {
            clearFishingTimer(latest.name);
            delete fishingChannels[latest.name];
            return;
        }
        if (getFishingNetCount(latest) >= Number(latest.fishingNetLimit || 200)) {
            await stopFishingByName(latest.name, stoppedUser => '🪣 ' + stoppedUser.name + '님의 살림망이 가득 찼습니다!\n- 현재 살림망: ' + comma(getFishingNetCount(stoppedUser)) + '/' + comma(stoppedUser.fishingNetLimit));
            return;
        }
        if (getInventoryItemCount(latest, FISHING_BAIT_ITEM_ID) < 1) {
            await stopFishingByName(latest.name, stoppedUser => '🪱 ' + stoppedUser.name + '님의 떡밥이 모두 소모되었습니다!\n- 현재 살림망: ' + comma(getFishingNetCount(stoppedUser)) + '/' + comma(stoppedUser.fishingNetLimit));
            return;
        }
        removeInventoryItem(latest, FISHING_BAIT_ITEM_ID, 1);
        addFishingNetItem(latest, getRandomFishingRewardId(), 1);
        await latest.save();
        if (getFishingNetCount(latest) >= Number(latest.fishingNetLimit || 200)) {
            await stopFishingByName(latest.name, stoppedUser => '🪣 ' + stoppedUser.name + '님의 살림망이 가득 찼습니다!\n- 현재 살림망: ' + comma(getFishingNetCount(stoppedUser)) + '/' + comma(stoppedUser.fishingNetLimit));
            return;
        }
        if (getInventoryItemCount(latest, FISHING_BAIT_ITEM_ID) < 1) {
            await stopFishingByName(latest.name, stoppedUser => '🪱 ' + stoppedUser.name + '님의 떡밥이 모두 소모되었습니다!\n- 현재 살림망: ' + comma(getFishingNetCount(stoppedUser)) + '/' + comma(stoppedUser.fishingNetLimit));
            return;
        }
        scheduleFishing(latest, channel);
    }, randomInt(30000, 60000));
}

async function toggleFishing(user, channel) {
    normalizeFishingData(user);
    if (user.fishing) {
        clearFishingTimer(user.name);
        delete fishingChannels[user.name];
        user.fishing = false;
        await user.save();
        return '✅ 낚시를 중단합니다.\n- 현재 살림망: ' + comma(getFishingNetCount(user)) + '/' + comma(user.fishingNetLimit);
    }
    if (getFishingNetCount(user) >= Number(user.fishingNetLimit || 200)) return '❌ 살림망이 가득 찼습니다.\n/RPGenius 살림망비우기';
    if (getInventoryItemCount(user, FISHING_BAIT_ITEM_ID) < 1) return '❌ 일반 떡밥이 없습니다.';
    user.fishing = true;
    await user.save();
    scheduleFishing(user, channel);
    return '🎣 낚시를 시작합니다..\n- 현재 살림망: ' + comma(getFishingNetCount(user)) + '/' + comma(user.fishingNetLimit);
}

async function stopFishingForCommand(user) {
    normalizeFishingData(user);
    if (!user.fishing) return;
    clearFishingTimer(user.name);
    delete fishingChannels[user.name];
    user.fishing = false;
    await user.save();
}

async function clearFishingNet(user) {
    normalizeFishingData(user);
    const items = readJson(ITEMS_PATH, []);
    const lines = ['✅ ' + user.name + '님이 살림망을 비웠습니다.', '[ 획득 결과 ]'];
    let hasItem = false;
    Object.keys(user.fishingNet).forEach(itemId => {
        const count = Number(user.fishingNet[itemId] || 0);
        if (count <= 0) return;
        addInventoryItem(user, Number(itemId), count);
        const data = items[itemId];
        if (data) lines.push('- ' + data.name + ' x' + comma(count));
        hasItem = true;
    });
    if (!hasItem) lines.push('- 없음');
    user.fishingNet = {};
    user.fishing = false;
    clearFishingTimer(user.name);
    delete fishingChannels[user.name];
    await user.save();
    return lines.join('\n');
}

async function handleAdminCommand(command, adminUser) {
    const adminCommands = ['골드지급', '골드차감', '가넷지급', '가넷차감', '포인트지급', '포인트차감', '아이템지급', '아이템제거'];
    if (!adminCommands.includes(command.args[0])) return null;
    if (!adminUser.isAdmin) return '❌ 관리자 전용 명령어입니다.';

    const targetName = command.args[1];
    if (!targetName) return '❌ 대상 닉네임을 입력해주세요.';
    const targetUser = await getRPGUserByName(targetName);
    if (!targetUser) return '❌ 존재하지 않는 사용자입니다.';

    if (['골드지급', '골드차감', '가넷지급', '가넷차감', '포인트지급', '포인트차감'].includes(command.args[0])) {
        const amount = Number(command.args[2]);
        if (!Number.isInteger(amount) || amount < 1) return '❌ 금액은 1 이상의 정수여야 합니다.';
        const field = command.args[0].startsWith('골드') ? 'gold' : command.args[0].startsWith('가넷') ? 'garnet' : 'point';
        const sign = command.args[0].endsWith('지급') ? 1 : -1;
        targetUser[field] = Math.max(0, Number(targetUser[field] || 0) + amount * sign);
        if (field == 'point') {
            targetUser.total_point += amount * sign;
        }
        await targetUser.save();
        const goodsName = field == 'gold' ? '골드' : field == 'garnet' ? '가넷' : '포인트';
        return `✅ ${targetUser.name}님${sign > 0 ? `에게 ${comma(amount)} ${goodsName}${goodsName == "가넷" ? "을" : "를"} 지급했습니다.` : `의 ${goodsName}${goodsName == "가넷" ? "을" : "를"} ${comma(amount)} 차감했습니다.`}`;
    }

    const restText = command.raw.substr(command.prefixLength + 1 + command.args[0].length + 1 + targetName.length + 1).trim();
    if (!restText) return '❌ /RPGenius ' + command.args[0] + ' [닉네임] [아이템] [갯수]';
    const restArgs = restText.split(' ');
    const countArg = restArgs.pop();
    const count = Number(countArg);
    if (!Number.isInteger(count) || count < 1 || restArgs.length == 0) return '❌ /RPGenius ' + command.args[0] + ' [닉네임] [아이템] [갯수]';
    const itemName = restArgs.join(' ');
    const items = readJson(ITEMS_PATH, []);
    const itemId = items.findIndex(item => item.name == itemName);
    if (itemId == -1) return '❌ 존재하지 않는 아이템입니다.';

    if (command.args[0] == '아이템지급') {
        addInventoryItem(targetUser, itemId, count);
    } else {
        if (getInventoryItemCount(targetUser, itemId) < count) return '❌ 대상 사용자의 아이템 수량이 부족합니다.';
        removeInventoryItem(targetUser, itemId, count);
    }
    cleanupInventoryItems(targetUser);
    await targetUser.save();
    return '✅ ' + targetUser.name + '님에게' + (command.args[0] == '아이템지급' ? '' : '서') + ' 아이템을 ' + (command.args[0] == '아이템지급' ? '지급' : '제거') + '했습니다: ' + itemName + ' x' + comma(count);
}

function addEquipmentInventory(user, type, id) {
    if (!user.inventory) user.inventory = { card: [], item: [] };
    if (!user.inventory.equipment) user.inventory.equipment = [];
    user.inventory.equipment.push({ type: type, id: id, level: 0 });
}

function equipItemByNumber(user, numberArg) {
    if (!user.inventory || !Array.isArray(user.inventory.equipment) || user.inventory.equipment.length == 0) {
        return '❌ 보유 중인 장비가 없습니다.';
    }
    const number = Number(numberArg);
    if (!Number.isInteger(number) || number < 1) return '❌ 장비 번호는 1 이상의 정수여야 합니다.';
    const all = getAllUserEquipments(user);
    const selected = all[number - 1];
    if (!selected) return '❌ 존재하지 않는 장비 번호입니다.';
    if (selected.source == 'equipped') return '❌ 이미 장착 중인 장비입니다.';

    const invIndex = selected.index;
    const target = user.inventory.equipment[invIndex];
    const data = getEquipmentData(target.type, target.id);
    if (!data) return '❌ 잘못된 장비 데이터입니다.';

    const userLevel = Number(user.level || 1);
    if (typeof data.requireLevel != 'undefined' && userLevel < Number(data.requireLevel)) {
        return '❌ 장착 필요 레벨이 부족합니다. (Lv. ' + Number(data.requireLevel) + ' 이상)';
    }
    if (typeof data.underLevel != 'undefined' && userLevel > Number(data.underLevel)) {
        return '❌ 장착 가능 최대 레벨을 초과했습니다. (Lv. ' + Number(data.underLevel) + ' 이하)';
    }

    if (!user.equipments) user.equipments = { weapon: {}, armor: {}, accessory: {} };

    if (target.type == 'weapon' || target.type == 'armor') {
        const prev = user.equipments[target.type];
        user.equipments[target.type] = { id: target.id, level: Number(target.level || 0) };
        user.inventory.equipment.splice(invIndex, 1);
        if (prev && typeof prev.id != 'undefined') {
            user.inventory.equipment.push({ type: target.type, id: prev.id, level: Number(prev.level || 0) });
        }
        return '✅ 장착했습니다: <' + data.rarity + '> ' + data.name + (Number(target.level || 0) > 0 ? ' +' + target.level : '');
    }

    if (target.type == 'accessory') {
        if (!user.equipments.accessory || typeof user.equipments.accessory != 'object') user.equipments.accessory = {};
        const accessories = user.equipments.accessory;
        if (Object.keys(accessories).some(key => accessories[key] && Number(accessories[key].id) == Number(target.id))) return '❌ 같은 종류의 장신구는 중복 장착할 수 없습니다.';
        const maxSlot = Number(user.maxAccessory || 3);
        let slotKey = null;
        for (let i = 0; i < maxSlot; i++) {
            const key = String(i);
            const equipped = accessories[key];
            if (!equipped || typeof equipped.id == 'undefined') {
                slotKey = key;
                break;
            }
        }
        if (slotKey == null) return '❌ 장신구 슬롯이 가득 찼습니다. 먼저 다른 장신구를 해제해주세요.';
        accessories[slotKey] = { id: target.id, level: Number(target.level || 0) };
        user.inventory.equipment.splice(invIndex, 1);
        return '✅ 장착했습니다: <' + data.rarity + '> ' + data.name + (Number(target.level || 0) > 0 ? ' +' + target.level : '');
    }

    return '❌ 알 수 없는 장비 타입입니다.';
}

function unequipAccessoryByNumber(user, numberArg) {
    const number = Number(numberArg);
    const maxSlot = Number(user.maxAccessory || 3);
    if (!Number.isInteger(number) || number < 1) return '❌ 장신구 번호를 올바르게 입력해주세요.';
    if (!user.equipments || !user.equipments.accessory || typeof user.equipments.accessory != 'object') return '❌ 장착 중인 장신구가 없습니다.';
    const slotKey = String(number - 1);
    const equipped = user.equipments.accessory[slotKey];
    if (!equipped || typeof equipped.id == 'undefined') return '❌ 해당 번호에 장착된 장신구가 없습니다.';
    const data = getEquipmentData('accessory', equipped.id);
    if (!data) return '❌ 잘못된 장신구 데이터입니다.';
    if (!user.inventory) user.inventory = { card: [], item: [], equipment: [] };
    if (!Array.isArray(user.inventory.equipment)) user.inventory.equipment = [];
    user.inventory.equipment.push({ type: 'accessory', id: equipped.id, level: Number(equipped.level || 0) });
    delete user.equipments.accessory[slotKey];
    const stats = calculateUserStats(user);
    user.hp = Math.min(typeof user.hp == 'undefined' ? Number(stats.hp || 0) : Number(user.hp || 0), Number(stats.hp || 0));
    user.mp = Math.min(typeof user.mp == 'undefined' ? Number(stats.mp || 0) : Number(user.mp || 0), Number(stats.mp || 0));
    return '✅ 장신구를 해제했습니다: <' + data.rarity + '> ' + data.name + (Number(equipped.level || 0) > 0 ? ' +' + equipped.level : '');
}

const EQUIPMENT_STONE_ITEM_ID = 0;
const EQUIPMENT_UPGRADER_ITEM_ID = 2;
const EQUIPMENT_PROTECT_ITEM_ID = 3;
const EQUIPMENT_ADVANCED_PROTECT_ITEM_ID = 4;
const EQUIPMENT_BLESSED_PROTECT_ITEM_ID = 5;
const EQUIPMENT_UPGRADE_MAX = 15;
const EQUIPMENT_RARITY_CORRECTION = { '일반': 0.7, '레어': 0.9, '유니크': 1.1, '레전더리': 1.4 };
const EQUIPMENT_GOLD_RATE = { '일반': 1.0, '레어': 1.5, '유니크': 1.8, '레전더리': 2.1 };
const EQUIPMENT_DISASSEMBLE_REWARD = {
    '일반': { min: 120, max: 230 },
    '레어': { min: 270, max: 330 },
    '유니크': { min: 350, max: 430 },
    '레전더리': { min: 560, max: 650 }
};
const EQUIPMENT_STONE_MULTIPLIERS = [1.0, 1.4, 1.9, 2.5, 3.2, 4.0, 5.0, 6.2, 7.6, 10.3, 13.9, 18.7, 25.2, 34.1, 46.0];
const EQUIPMENT_UPGRADE_RATES = [
    { great: 0.10, success: 0.90, down: 0, reset: 0 },
    { great: 0.08, success: 0.91, down: 0.01, reset: 0 },
    { great: 0.06, success: 0.91, down: 0.03, reset: 0 },
    { great: 0.05, success: 0.85, down: 0.10, reset: 0 },
    { great: 0.04, success: 0.80, down: 0.16, reset: 0 },
    { great: 0.03, success: 0.75, down: 0.22, reset: 0 },
    { great: 0.02, success: 0.70, down: 0.28, reset: 0 },
    { great: 0.015, success: 0.60, down: 0.385, reset: 0 },
    { great: 0.012, success: 0.50, down: 0.388, reset: 0.10 },
    { great: 0.01, success: 0.30, down: 0.54, reset: 0.15 },
    { great: 0.005, success: 0.15, down: 0.545, reset: 0.30 },
    { great: 0, success: 0.10, down: 0.50, reset: 0.40 },
    { great: 0, success: 0.03, down: 0.47, reset: 0.50 },
    { great: 0, success: 0.015, down: 0.335, reset: 0.65 },
    { great: 0, success: 0.007, down: 0.193, reset: 0.80 }
];

function getEquipmentByNumber(user, numberArg) {
    const number = Number(numberArg);
    if (!Number.isInteger(number) || number < 1) return null;
    const all = getAllUserEquipments(user);
    return all[number - 1] || null;
}

function getEquipmentUpgradeCost(equipment, type, level) {
    const targetLevel = Number(level || 0) + 1;
    const rarityCorrection = EQUIPMENT_RARITY_CORRECTION[equipment.rarity] || 1;
    const stoneMultiplier = EQUIPMENT_STONE_MULTIPLIERS[level] || 1;
    const armorMultiplier = type == 'armor' ? 0.85 : 1;
    const stone = Math.floor(((level + 10) * 3 * rarityCorrection) * stoneMultiplier * armorMultiplier);
    const goldRate = EQUIPMENT_GOLD_RATE[equipment.rarity] || 1;
    const gold = Math.floor(goldRate * ((Math.pow(targetLevel, 4) / 5) + 1));
    return { stone, gold };
}

function disassembleEquipment(user, numberArg) {
    const selected = getEquipmentByNumber(user, numberArg);
    if (!selected) return '❌ 존재하지 않는 장비 번호입니다.';
    if (selected.source == 'equipped') return '❌ 장착 중인 장비는 분해할 수 없습니다.';
    const type = selected.equip.type || selected.type;
    const equipment = getEquipmentData(type, selected.equip.id);
    if (!equipment) return '❌ 잘못된 장비 데이터입니다.';
    const rewardRange = EQUIPMENT_DISASSEMBLE_REWARD[equipment.rarity];
    if (!rewardRange) return '❌ 분해할 수 없는 장비 등급입니다.';
    const stoneCount = randomInt(rewardRange.min, rewardRange.max);
    user.inventory.equipment.splice(selected.index, 1);
    addInventoryItem(user, EQUIPMENT_STONE_ITEM_ID, stoneCount);
    return '✅ 장비를 분해했습니다.\n[ 분해 장비 ]\n- <' + equipment.rarity + '> ' + equipment.name + '\n[ 획득 결과 ]\n- 강화석 x' + comma(stoneCount);
}

function formatUpgradeRatePercent(value) {
    return Math.round(Number(value || 0) * 1000) / 10 + '%';
}

function formatEquipmentUpgradePreview(user, numberArg) {
    const selected = getEquipmentByNumber(user, numberArg);
    if (!selected) return '❌ 존재하지 않는 장비 번호입니다.';
    const type = selected.equip.type || selected.type;
    if (type == 'accessory') return '❌ 장신구는 강화할 수 없습니다.';
    const equipment = getEquipmentData(type, selected.equip.id);
    if (!equipment) return '❌ 잘못된 장비 데이터입니다.';
    const level = Number(selected.equip.level || 0);
    if (level >= EQUIPMENT_UPGRADE_MAX) return '❌ 이미 최대 강화 단계입니다.';

    const nextLevel = level + 1;
    const currentStats = getEquipmentStatsAtLevel(equipment, level);
    const nextStats = getEquipmentStatsAtLevel(equipment, nextLevel);
    const statNames = { atk: '공격력', pnt: '방어 관통력', def: '방어력', hp: '체력', mp: 'MP', crit: '치명타 확률', critMul: '치명타 피해량' };
    const rates = EQUIPMENT_UPGRADE_RATES[level];
    const cost = getEquipmentUpgradeCost(equipment, type, level);
    const hasUpgrader = getInventoryItemCount(user, EQUIPMENT_UPGRADER_ITEM_ID) > 0;
    const stoneCount = getInventoryItemCount(user, EQUIPMENT_STONE_ITEM_ID);
    const hasStone = hasUpgrader || stoneCount >= cost.stone;
    const hasGold = Number(user.gold || 0) >= cost.gold;
    const lines = ['⚒️ ' + equipment.name + ' +' + level + ' -> +' + nextLevel];
    Object.keys(statNames).forEach(key => {
        if (Number(currentStats[key] || 0) != Number(nextStats[key] || 0)) lines.push('- ' + statNames[key] + ' ' + formatStatValue(key, currentStats[key] || 0).replace(/^\+/, '') + ' -> ' + formatStatValue(key, nextStats[key] || 0).replace(/^\+/, ''));
    });
    lines.push('', '[ 강화 확률 ]');
    lines.push('⏫ 대성공 ' + formatUpgradeRatePercent(rates.great));
    lines.push('🔼 성공 ' + formatUpgradeRatePercent(rates.success));
    lines.push('🔽 하락 ' + formatUpgradeRatePercent(rates.down));
    lines.push('💥 파괴 ' + formatUpgradeRatePercent(rates.reset));
    lines.push('', '[ 필요 재료 ]');
    lines.push((hasStone ? '✅ ' : '❌ ') + (hasUpgrader ? '유생의 강화기 x1' : '강화석 x' + comma(cost.stone)));
    lines.push((hasGold ? '✅ ' : '❌ ') + '🪙 ' + comma(cost.gold));
    if (getInventoryItemCount(user, EQUIPMENT_BLESSED_PROTECT_ITEM_ID) > 0) lines.push('', '🛡️ 축복받은 장비 보호권 보유: 파괴/하락 시 유지');
    else if (getInventoryItemCount(user, EQUIPMENT_ADVANCED_PROTECT_ITEM_ID) > 0) lines.push('', '🛡️ 고급 장비 보호권 보유: 파괴 시 유지');
    else if (getInventoryItemCount(user, EQUIPMENT_PROTECT_ITEM_ID) > 0) lines.push('', '🛡️ 장비 보호권 보유: 파괴 시 0강 초기화');
    if (!hasStone || !hasGold) {
        user.pendingAction = null;
        lines.push('', '❌ 재료가 부족합니다!');
    } else {
        user.pendingAction = { type: '장비강화', number: Number(numberArg), equipmentType: type };
        lines.push('', '/RPGenius 강화');
    }
    return lines.join('\n');
}

function runEquipmentUpgrade(user) {
    const pending = user.pendingAction;
    if (!pending || pending.type != '장비강화') return '❌ 진행 중인 장비 강화가 없습니다.';
    const selected = getEquipmentByNumber(user, pending.number);
    if (!selected) {
        user.pendingAction = null;
        return '❌ 강화할 장비를 찾을 수 없습니다.';
    }
    const type = selected.equip.type || selected.type;
    if (type == 'accessory') {
        user.pendingAction = null;
        return '❌ 장신구는 강화할 수 없습니다.';
    }
    const equipment = getEquipmentData(type, selected.equip.id);
    const level = Number(selected.equip.level || 0);
    if (!equipment || level >= EQUIPMENT_UPGRADE_MAX) {
        user.pendingAction = null;
        return '❌ 강화할 수 없는 장비입니다.';
    }
    const cost = getEquipmentUpgradeCost(equipment, type, level);
    const hasUpgrader = getInventoryItemCount(user, EQUIPMENT_UPGRADER_ITEM_ID) > 0;
    if ((!hasUpgrader && getInventoryItemCount(user, EQUIPMENT_STONE_ITEM_ID) < cost.stone) || Number(user.gold || 0) < cost.gold) {
        user.pendingAction = null;
        return '❌ 재료가 부족합니다!';
    }
    if (hasUpgrader) removeInventoryItem(user, EQUIPMENT_UPGRADER_ITEM_ID, 1);
    else removeInventoryItem(user, EQUIPMENT_STONE_ITEM_ID, cost.stone);
    user.gold = Number(user.gold || 0) - cost.gold;
    const rates = EQUIPMENT_UPGRADE_RATES[level];
    const roll = Math.random();
    let result = 'destroy';
    if (roll < rates.great) result = 'great';
    else if (roll < rates.great + rates.success) result = 'success';
    else if (roll < rates.great + rates.success + rates.down) result = 'down';
    const before = level;
    let protectedResult = null;
    if (result == 'great') selected.equip.level = Math.min(EQUIPMENT_UPGRADE_MAX, level + 2);
    if (result == 'success') selected.equip.level = Math.min(EQUIPMENT_UPGRADE_MAX, level + 1);
    if (result == 'down') {
        if (getInventoryItemCount(user, EQUIPMENT_BLESSED_PROTECT_ITEM_ID) > 0) {
            removeInventoryItem(user, EQUIPMENT_BLESSED_PROTECT_ITEM_ID, 1);
            selected.equip.level = level;
            protectedResult = 'blessedDown';
        } else {
            selected.equip.level = Math.max(0, level - 1);
        }
    }
    if (result == 'destroy') {
        if (getInventoryItemCount(user, EQUIPMENT_BLESSED_PROTECT_ITEM_ID) > 0) {
            removeInventoryItem(user, EQUIPMENT_BLESSED_PROTECT_ITEM_ID, 1);
            selected.equip.level = level;
            protectedResult = 'blessedDestroy';
        } else if (getInventoryItemCount(user, EQUIPMENT_ADVANCED_PROTECT_ITEM_ID) > 0) {
            removeInventoryItem(user, EQUIPMENT_ADVANCED_PROTECT_ITEM_ID, 1);
            selected.equip.level = level;
            protectedResult = 'advancedDestroy';
        } else if (getInventoryItemCount(user, EQUIPMENT_PROTECT_ITEM_ID) > 0) {
            removeInventoryItem(user, EQUIPMENT_PROTECT_ITEM_ID, 1);
            selected.equip.level = 0;
            protectedResult = 'protectDestroy';
        } else {
            removeSelectedEquipment(user, selected);
            const stats = calculateUserStats(user);
            user.hp = Math.min(Number(user.hp || 0), Number(stats.hp || 0));
            user.mp = Math.min(Number(user.mp || 0), Number(stats.mp || 0));
        }
    }
    user.pendingAction = null;
    const messages = {
        great: '🌟 강화 대성공!!',
        success: '✨ 강화 성공!',
        down: '❌ 강화 실패..',
        destroy: '💥 장비가 파괴되었습니다.',
        blessedDown: '🛡️ 축복받은 장비 보호권으로 하락을 막았습니다.',
        blessedDestroy: '🔰 축복받은 장비 보호권으로 파괴를 막았습니다.',
        advancedDestroy: '🛡️ 고급 장비 보호권으로 파괴를 막았습니다.',
        protectDestroy: '🛡️ 장비 보호권으로 파괴를 막고 0강으로 초기화했습니다.'
    };
    const messageKey = protectedResult || result;
    if (result == 'destroy' && !protectedResult) return messages[messageKey] + '\n' + equipment.name + ' +' + before + ' -> 파괴';
    return messages[messageKey] + '\n' + equipment.name + ' +' + before + ' -> +' + Number(selected.equip.level || 0);
}

function addRewardSummary(summary, key, label, count) {
    if (!summary[key]) summary[key] = { label: label, count: 0 };
    summary[key].count += count;
}

function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pickPackEntry(pack) {
    const roll = Math.random();
    let current = 0;
    for (const entry of pack) {
        current += Number(entry.roll || 0);
        if (roll <= current) return entry;
    }
    return pack[pack.length - 1];
}

function rollCount(count) {
    if (!count) return 1;
    if (typeof count == 'number') return count;
    return randomInt(Number(count.min || 1), Number(count.max || 1));
}

function grantPackReward(user, reward, summary) {
    const items = readJson(ITEMS_PATH, []);
    const equipments = readJson(EQUIPMENT_PATH, {});
    const count = rollCount(reward.count);
    if (reward.type == '아이템') {
        addInventoryItem(user, reward.item_id, count);
        const item = items[reward.item_id];
        addRewardSummary(summary, 'item:' + reward.item_id, (item ? item.name : '알 수 없는 아이템'), count);
        return;
    }
    if (reward.type == '골드') {
        user.gold = Number(user.gold || 0) + count;
        addRewardSummary(summary, 'gold', '🪙 골드', count);
        return;
    }
    if (reward.type == '가넷') {
        user.garnet = Number(user.garnet || 0) + count;
        addRewardSummary(summary, 'garnet', '💠 가넷', count);
        return;
    }
    if (reward.type == '마일리지') {
        user.mileage = Number(user.mileage || 0) + count;
        addRewardSummary(summary, 'mileage', 'Ⓜ️ 마일리지', count);
        return;
    }
    if (reward.type == '무기') {
        addEquipmentInventory(user, 'weapon', reward.weapon_id);
        const equipment = equipments.weapon && equipments.weapon[reward.weapon_id];
        addRewardSummary(summary, 'weapon:' + reward.weapon_id, equipment ? '<' + equipment.rarity + '> ' + equipment.name : '알 수 없는 무기', 1);
        return;
    }
    if (reward.type == '갑옷') {
        addEquipmentInventory(user, 'armor', reward.armor_id);
        const equipment = equipments.armor && equipments.armor[reward.armor_id];
        addRewardSummary(summary, 'armor:' + reward.armor_id, equipment ? '<' + equipment.rarity + '> ' + equipment.name : '알 수 없는 갑옷', 1);
        return;
    }
    if (reward.type == '장신구') {
        addEquipmentInventory(user, 'accessory', reward.accessory_id);
        const equipment = equipments.accessory && equipments.accessory[reward.accessory_id];
        addRewardSummary(summary, 'accessory:' + reward.accessory_id, equipment ? '<' + equipment.rarity + '> ' + equipment.name : '알 수 없는 장신구', 1);
    }
}

function grantCharacterCardPack(user, pack, useCount, summary) {
    const characterCards = readJson(CHARACTER_CARDS_PATH, []);
    const minStar = Number(pack.range && pack.range.min || 1);
    const maxStar = Number(pack.range && pack.range.max || minStar);
    for (let i = 0; i < useCount; i++) {
        const id = randomInt(0, characterCards.length - 1);
        const star = randomInt(minStar, maxStar) - 1;
        const card = { id: id, star: star, type: '일반' };
        user.inventory.card.push(card);
        addRewardSummary(summary, 'card:' + id + ':' + star, '[' + formatStar(star) + '] 일반 ' + characterCards[id].name, 1);
    }
}

function useCoupon(user, codeArg) {
    const code = String(codeArg || '').trim();
    if (!code) return '❌ /RPGenius 쿠폰 [코드]';
    const coupons = readJson(COUPON_PATH, []);
    const coupon = coupons.find(data => String(data.code || '').toUpperCase() == code.toUpperCase());
    if (!coupon) return '❌ 존재하지 않는 쿠폰입니다.';
    if (coupon.expired_At != null && Date.now() > Number(new Date(coupon.expired_At).getTime() || 0)) return '❌ 만료된 쿠폰입니다.';
    if (!Array.isArray(user.usedCoupons)) user.usedCoupons = [];
    if (user.usedCoupons.includes(coupon.code)) return '❌ 이미 사용한 쿠폰입니다.';
    const summary = {};
    (coupon.reward || []).forEach(reward => grantPackReward(user, reward, summary));
    user.usedCoupons.push(coupon.code);
    const lines = ['✅ 쿠폰 보상을 획득했습니다.', '[ 획득 결과 ]'];
    Object.keys(summary).forEach(key => lines.push('- ' + summary[key].label + ' x' + comma(summary[key].count)));
    return lines.join('\n');
}

function applyUseFunc(user, func, useCount, resultLines) {
    const stats = calculateUserStats(user);
    const potionMul = 1 + Number(stats.potion || 0);
    if (func.type == '체력회복') {
        const maxHp = Number(stats.hp || 0);
        const before = typeof user.hp == 'undefined' ? maxHp : Number(user.hp || 0);
        const amount = Math.round(Number(func.amount || 0) * potionMul) * useCount;
        user.hp = Math.min(maxHp, before + amount);
        resultLines.push('- HP +' + comma(user.hp - before) + ' (' + comma(user.hp) + '/' + comma(maxHp) + ')');
        return;
    }
    if (func.type == '마나회복') {
        const maxMp = Number(stats.mp || 0);
        const before = typeof user.mp == 'undefined' ? maxMp : Number(user.mp || 0);
        const amount = Math.round(Number(func.amount || 0) * potionMul) * useCount;
        user.mp = Math.min(maxMp, before + amount);
        resultLines.push('- MP +' + comma(user.mp - before) + ' (' + comma(user.mp) + '/' + comma(maxMp) + ')');
        return;
    }
    if (func.type == '체력회복%') {
        const maxHp = Number(stats.hp || 0);
        const before = typeof user.hp == 'undefined' ? maxHp : Number(user.hp || 0);
        const amount = Math.round(maxHp * Number(func.amount || 0) * potionMul) * useCount;
        user.hp = Math.min(maxHp, before + amount);
        resultLines.push('- HP +' + comma(user.hp - before) + ' (' + comma(user.hp) + '/' + comma(maxHp) + ')');
        return;
    }
    if (func.type == '마나회복%') {
        const maxMp = Number(stats.mp || 0);
        const before = typeof user.mp == 'undefined' ? maxMp : Number(user.mp || 0);
        const amount = Math.round(maxMp * Number(func.amount || 0) * potionMul) * useCount;
        user.mp = Math.min(maxMp, before + amount);
        resultLines.push('- MP +' + comma(user.mp - before) + ' (' + comma(user.mp) + '/' + comma(maxMp) + ')');
        return;
    }
    if (func.type == '경험치획득') {
        const amount = Number(func.amount || 0) * useCount;
        const levelUps = addExperience(user, amount);
        resultLines.push('- XP +' + comma(amount));
        if (levelUps > 0) resultLines.push('- 레벨업! Lv. ' + user.level);
    }
}

async function useItem(user, itemName, countArg) {
    const items = readJson(ITEMS_PATH, []);
    const itemId = items.findIndex(item => item.name == itemName);
    const item = items[itemId];
    if (!item) return '❌ 존재하지 않는 아이템입니다.';
    if (!['소모품', '가챠', '번들', '마법석'].includes(item.type)) return '❌ 사용할 수 없는 아이템입니다.';

    let useCount = countArg == null || countArg === '' ? 1 : Number(countArg);
    if (!Number.isInteger(useCount) || useCount < 1) return '❌ 갯수는 1 이상의 정수여야 합니다.';
    if (getInventoryItemCount(user, itemId) < useCount) return '❌ 아이템이 부족합니다.';
    const requestedUseCount = useCount;
    if (item.pack && item.pack.type == '캐릭터 카드팩') {
        const remainingSpace = getRemainingCardInventorySpace(user);
        if (remainingSpace < 1) return '❌ 캐릭터 카드 인벤토리가 가득 찼습니다.';
        useCount = Math.min(useCount, remainingSpace);
    }

    const requirements = item.require || [];
    for (const require of requirements) {
        const requiredCount = Number(require.count || 0) * useCount;
        if (getInventoryItemCount(user, require.id) < requiredCount) {
            const requireItem = items[require.id];
            return '❌ 필요한 아이템이 부족합니다: ' + (requireItem ? requireItem.name : '알 수 없는 아이템') + ' x' + comma(requiredCount);
        }
    }
    if (item.type == '번들') {
        const bundles = readJson(BUNDLE_PATH, []);
        if (!Array.isArray(bundles[item.pack])) return '❌ 사용할 수 없는 번들입니다.';
    }
    if (item.type == '마법석') {
        if (item.use == '캐릭터변환' && useCount != 1) return '❌ 캐릭터 변환석은 한 번에 1개만 사용할 수 있습니다.';
        if (item.use != '캐릭터변환') return '❌ 사용할 수 없는 마법석입니다.';
    }

    removeInventoryItem(user, itemId, useCount);
    requirements.forEach(require => removeInventoryItem(user, require.id, Number(require.count || 0) * useCount));

    const lines = ['✅ ' + item.name + ' x' + comma(useCount) + ' 사용'];
    if (requestedUseCount > useCount) lines.push('- 캐릭터 카드 인벤토리 공간 부족으로 ' + comma(requestedUseCount - useCount) + '개는 사용되지 않았습니다.');
    if (item.type == '소모품') {
        (item.use_func || []).forEach(func => applyUseFunc(user, func, useCount, lines));
    }
    if (item.type == '가챠') {
        const summary = {};
        if (typeof item.pack == 'number') {
            const packs = readJson(PACKS_PATH, []);
            const pack = packs[item.pack];
            if (!Array.isArray(pack)) return '❌ 사용할 수 없는 가챠입니다.';
            const rollCount = Number(item.num || 1) * useCount;
            for (let i = 0; i < rollCount; i++) grantPackReward(user, pickPackEntry(pack), summary);
        } else if (item.pack && item.pack.type == '캐릭터 카드팩') {
            if (!user.inventory) user.inventory = { card: [], item: [] };
            if (!Array.isArray(user.inventory.card)) user.inventory.card = [];
            grantCharacterCardPack(user, item.pack, useCount, summary);
        } else {
            return '❌ 사용할 수 없는 가챠입니다.';
        }
        lines.push('[ 획득 결과 ]');
        Object.keys(summary).forEach(key => lines.push('- ' + summary[key].label + ' x' + comma(summary[key].count)));
    }
    if (item.type == '번들') {
        const bundles = readJson(BUNDLE_PATH, []);
        const bundle = bundles[item.pack];
        const summary = {};
        for (let i = 0; i < useCount; i++) bundle.forEach(reward => grantPackReward(user, reward, summary));
        lines.push('[ 획득 결과 ]');
        Object.keys(summary).forEach(key => lines.push('- ' + summary[key].label + ' x' + comma(summary[key].count)));
    }
    if (item.type == '마법석') {
        if (item.use == '캐릭터변환') {
            user.pendingAction = { type: '캐릭터변환' };
            lines.push('변환할 캐릭터 카드를 선택해주세요.');
            lines.push('/RPGenius 선택 [카드번호]');
            lines.push('', formatCharacterInventory(user));
        }
    }

    await user.save();
    return lines.join('\n');
}

async function purchaseShopItem(user, shopType, indexArg, countArg) {
    const shops = readJson(SHOP_PATH, {});
    const shop = shops[shopType];
    if (!shop || !Array.isArray(shop)) return '❌ 존재하지 않는 상점입니다.';

    const index = Number(indexArg);
    if (!Number.isInteger(index) || index < 1 || index > shop.length) return '❌ 존재하지 않는 상품 번호입니다.';

    const count = countArg == null || countArg === '' ? 1 : Number(countArg);
    if (!Number.isInteger(count) || count < 1) return '❌ 갯수는 1 이상의 정수여야 합니다.';

    const shopItem = shop[index - 1];
    const field = GOODS_FIELD[shopItem.price.goods];
    if (!field) return '❌ 알 수 없는 화폐입니다.';

    const totalPrice = Number(shopItem.price.amount) * count;
    const owned = Number(user[field] || 0);
    if (owned < totalPrice) return '❌ 재화가 부족합니다. (필요: ' + formatPrice({ goods: shopItem.price.goods, amount: totalPrice }) + ')';

    user[field] = owned - totalPrice;
    const mileageEarned = shopItem.price.goods == 'point' ? Math.round(totalPrice * 0.1) : 0;
    if (mileageEarned > 0) user.mileage = Number(user.mileage || 0) + mileageEarned;

    if (shopItem.type == '아이템') {
        addInventoryItem(user, shopItem.item_id, Number(shopItem.count) * count);
    } else if (shopItem.type == '가넷') {
        user.garnet = Number(user.garnet || 0) + Number(shopItem.count) * count;
    } else if (shopItem.type == '골드') {
        user.gold = Number(user.gold || 0) + Number(shopItem.count) * count;
    } else if (shopItem.type == '마일리지') {
        user.mileage = Number(user.mileage || 0) + Number(shopItem.count) * count;
    } else {
        return '❌ 처리할 수 없는 상품입니다.';
    }

    await user.save();

    const rewardItem = { type: shopItem.type, item_id: shopItem.item_id, count: Number(shopItem.count) * count };
    return '✅ 구매 완료: ' + formatShopItem(rewardItem) + '\n- 사용: ' + formatPrice({ goods: shopItem.price.goods, amount: totalPrice }) + (mileageEarned > 0 ? '\n- 적립: Ⓜ️ ' + comma(mileageEarned) + '마일리지' : '');
}

function formatStar(star) {
    const displayStar = Number(star || 0) + 1;
    if (displayStar == 10) return '𝛧';
    if (displayStar == 11) return '𝛴';
    if (displayStar == 12) return '𝛀';
    return displayStar + '성';
}

async function putItem(table, item) {
    try {
        const command = new PutCommand({
            TableName: table,
            Item: item
        });
        const response = await docClient.send(command);
        return { success: true, result: [response] };
    } catch (error) {
        return { success: false, result: [error] };
    }
}

async function updateItem(table, id, data) {
    try {
        const keys = Object.keys(data).filter(d => d != 'id');
        const command = new UpdateCommand({
            TableName: table,
            Key: { id: id },
            UpdateExpression: 'SET ' + keys.map(d => '#' + d + '=:new_' + d).join(','),
            ExpressionAttributeNames: Object.fromEntries(keys.map(d => ['#' + d, d])),
            ExpressionAttributeValues: Object.fromEntries(keys.map(d => [':new_' + d, data[d]]))
        });
        const response = await docClient.send(command);
        return { success: true, result: [response] };
    } catch (error) {
        return { success: false, result: [error] };
    }
}

async function queryItems(params) {
    try {
        const command = new QueryCommand(params);
        const response = await docClient.send(command);
        return { success: true, result: [response] };
    } catch (error) {
        return { success: false, result: [error] };
    }
}

class RPGUser {
    constructor(name, id) {
        this._get = 1;
        this.id = id;
        this.name = name;
        this.isAdmin = false;
        this.code = getRandomString(10).toUpperCase();
        this.logged_in = [id];
        this.main_card = {};
        this.need_character_card_select = true;
        this.level = 1;
        this.exp = 0;
        this.hp = 0;
        this.mp = 0;
        this.field = null;
        this.card_slot = [];
        this.equipments = {
            armor: {
                id: 0,
                level: 0
            },
            weapon: {
                id: 0,
                level: 0
            },
            accessory: {}
        };
        this.inventory = {
            card: [],
            item: [],
            equipment: []
        };
        this.gold = 0;
        this.garnet = 0;
        this.point = 0;
        this.total_point = 0;
        this.mileage = 0;
        this.statPoint = 0;
        this.statPointStats = { atk: 0, hp: 0, mp: 0, def: 0, pnt: 0 };
        this.fishing = false;
        this.fishingNet = {};
        this.fishingNetLimit = 200;
        this.pendingAction = null;
        this.maxCardLimit = 52;
        this.maxAccessory = 3;
        this.mail = [];
        this.usedCoupons = [];
        this.lastAttendanceDate = null;
    }

    load(data) {
        Object.assign(this, data);
        if (!Array.isArray(this.logged_in)) this.logged_in = [];
        if (!this.inventory) this.inventory = { card: [], item: [] };
        if (!Array.isArray(this.inventory.card)) this.inventory.card = [];
        if (!Array.isArray(this.inventory.item)) this.inventory.item = [];
        if (!Array.isArray(this.inventory.equipment)) this.inventory.equipment = [];
        if (!this.equipments || typeof this.equipments != 'object') this.equipments = { weapon: null, armor: null, accessory: {} };
        if (typeof this.equipments.weapon == 'undefined') this.equipments.weapon = null;
        if (typeof this.equipments.armor == 'undefined') this.equipments.armor = null;
        if (!this.equipments.accessory || typeof this.equipments.accessory != 'object') this.equipments.accessory = {};
        cleanupInventoryItems(this);
        if (!Array.isArray(this.mail)) this.mail = [];
        if (!Array.isArray(this.usedCoupons)) this.usedCoupons = [];
        if (typeof this.lastAttendanceDate == 'undefined') this.lastAttendanceDate = null;
        if (typeof this.isAdmin == 'undefined') this.isAdmin = false;
        if (!this.level) this.level = 1;
        if (!this.exp) this.exp = 0;
        if (typeof this.field == 'undefined') this.field = null;
        if (typeof this.mileage == 'undefined') this.mileage = 0;
        normalizeStatPointData(this);
        normalizeFishingData(this);
        if (typeof this.pendingAction == 'undefined') this.pendingAction = null;
        if (typeof this.need_character_card_select == 'undefined') this.need_character_card_select = !this.main_card || typeof this.main_card.id == 'undefined';
        if (!this.maxCardLimit) this.maxCardLimit = 52;
        if (!this.maxAccessory || Number(this.maxAccessory) < 3) this.maxAccessory = 3;
        return this;
    }

    toString() {
        return this.name;
    }

    async save() {
        await updateItem(TABLE_NAME, this.id, this);
    }

    async changeCode() {
        this.code = getRandomString(10).toUpperCase();
        await this.save();
    }
}

const tradeRequests = {};
const activeTrades = {};
const tradeRequestTimers = {};
const TRADE_FEE_RATE = 0.05;
const TRADE_REQUEST_TTL_MS = 5 * 60 * 1000;

function getTradeTicketItemId() {
    const items = readJson(ITEMS_PATH, []);
    return items.findIndex(item => item.name == '거래권');
}

function getCardTicketCost(card) {
    return Math.max(0, Number(card && card.star || 0) - 3);
}

function emptyTradeOffer() {
    return { gold: 0, garnet: 0, cards: [], equipments: [], items: {} };
}

function createTradeSession(aName, bName) {
    return {
        a: aName,
        b: bName,
        aOffer: emptyTradeOffer(),
        bOffer: emptyTradeOffer(),
        aConfirmed: false,
        bConfirmed: false
    };
}

function getTradeSessionForUser(name) {
    return activeTrades[name] || null;
}

function getMyTradeSide(session, name) {
    if (!session) return null;
    if (session.a == name) return { offer: session.aOffer, partnerName: session.b, partnerOffer: session.bOffer, isA: true };
    if (session.b == name) return { offer: session.bOffer, partnerName: session.a, partnerOffer: session.aOffer, isA: false };
    return null;
}

function hasAnyTradeInvolvement(name) {
    if (activeTrades[name]) return true;
    if (tradeRequests[name]) return true;
    return Object.keys(tradeRequests).some(key => tradeRequests[key] && tradeRequests[key].target == name);
}

function clearTradeRequestTimer(name) {
    if (tradeRequestTimers[name]) {
        clearTimeout(tradeRequestTimers[name]);
        delete tradeRequestTimers[name];
    }
}

function formatTradeOfferLines(offer) {
    const items = readJson(ITEMS_PATH, []);
    const lines = [];
    if (Number(offer.gold || 0) > 0) lines.push('- 🪙 ' + comma(offer.gold));
    if (Number(offer.garnet || 0) > 0) lines.push('- 💠 ' + comma(offer.garnet));
    (offer.equipments || []).forEach(entry => {
        const data = getEquipmentData(entry.type, entry.id);
        if (!data) return;
        const level = Number(entry.level || 0);
        lines.push('- <' + data.rarity + '> ' + data.name + (level > 0 ? ' +' + level : ''));
    });
    (offer.cards || []).forEach(card => lines.push('- ' + formatUserCard(card)));
    Object.keys(offer.items || {}).forEach(itemId => {
        const count = Number(offer.items[itemId] || 0);
        if (count <= 0) return;
        const data = items[itemId];
        if (!data) return;
        lines.push('- ' + data.name + ' x' + comma(count));
    });
    return lines;
}

function formatTradeStatus(session) {
    const aLines = formatTradeOfferLines(session.aOffer);
    const bLines = formatTradeOfferLines(session.bOffer);
    const lines = [];
    lines.push('[ ' + session.a + '님의 등록 거래 품목 ]');
    if (aLines.length == 0) lines.push('- 없음');
    else lines.push(...aLines);
    lines.push('');
    lines.push('[ ' + session.b + '님의 등록 거래 품목 ]');
    if (bLines.length == 0) lines.push('- 없음');
    else lines.push(...bLines);
    lines.push('');
    lines.push('거래를 성사하시려면, 둘 다 아래 명령어를 입력해주세요.');
    lines.push('/RPGenius 거래성사');
    lines.push('/RPGenius 거래성사취소');
    lines.push('');
    lines.push('거래를 취소하시려면 아래 명령어를 입력해주세요.');
    lines.push('/RPGenius 거래취소');
    return lines.join('\n');
}

function resetTradeConfirmations(session) {
    session.aConfirmed = false;
    session.bConfirmed = false;
}

function refundOfferToUser(user, offer) {
    if (Number(offer.gold || 0) > 0) user.gold = Number(user.gold || 0) + Number(offer.gold || 0);
    if (Number(offer.garnet || 0) > 0) user.garnet = Number(user.garnet || 0) + Number(offer.garnet || 0);
    if (!user.inventory) user.inventory = { card: [], item: [], equipment: [] };
    if (!Array.isArray(user.inventory.card)) user.inventory.card = [];
    if (!Array.isArray(user.inventory.equipment)) user.inventory.equipment = [];
    (offer.cards || []).forEach(card => user.inventory.card.push(card));
    (offer.equipments || []).forEach(equip => user.inventory.equipment.push(equip));
    Object.keys(offer.items || {}).forEach(itemId => {
        const count = Number(offer.items[itemId] || 0);
        if (count > 0) addInventoryItem(user, Number(itemId), count);
    });
}

async function cancelActiveTrade(session, reason, channel) {
    delete activeTrades[session.a];
    delete activeTrades[session.b];
    const aUser = await getRPGUserByName(session.a);
    const bUser = await getRPGUserByName(session.b);
    if (aUser) {
        refundOfferToUser(aUser, session.aOffer);
        await aUser.save();
    }
    if (bUser) {
        refundOfferToUser(bUser, session.bOffer);
        await bUser.save();
    }
    if (channel && reason) channel.sendChat(reason);
}

function createTradeRequest(user, targetName, channel) {
    if (!targetName) return '❌ /RPGenius 거래신청 [닉네임]';
    if (targetName == user.name) return '❌ 자기 자신에게는 거래를 신청할 수 없습니다.';
    if (hasAnyTradeInvolvement(user.name)) return '❌ 이미 진행 중인 거래가 있습니다.';
    if (hasAnyTradeInvolvement(targetName)) return '❌ 상대방이 이미 다른 거래에 참여 중입니다.';
    tradeRequests[user.name] = { target: targetName, createdAt: Date.now() };
    clearTradeRequestTimer(user.name);
    tradeRequestTimers[user.name] = setTimeout(() => {
        if (tradeRequests[user.name] && tradeRequests[user.name].target == targetName) {
            delete tradeRequests[user.name];
            delete tradeRequestTimers[user.name];
            if (channel) channel.sendChat('⌛ ' + user.name + '님이 ' + targetName + '님에게 보낸 거래 신청이 자동으로 취소되었습니다.');
        }
    }, TRADE_REQUEST_TTL_MS);
    return '✅ ' + targetName + '님에게 거래를 신청했습니다.\n5분 안에 상대방이 /RPGenius 거래수락을 입력하지 않으면 자동으로 취소됩니다.';
}

function cancelTradeRequest(user) {
    if (!tradeRequests[user.name]) return '❌ 진행 중인 거래 신청이 없습니다.';
    const targetName = tradeRequests[user.name].target;
    delete tradeRequests[user.name];
    clearTradeRequestTimer(user.name);
    return '✅ ' + targetName + '님에 대한 거래 신청을 취소했습니다.';
}

function acceptTradeRequest(user) {
    const senderName = Object.keys(tradeRequests).find(key => tradeRequests[key] && tradeRequests[key].target == user.name);
    if (!senderName) return '❌ 수락할 거래 신청이 없습니다.';
    if (activeTrades[user.name]) return '❌ 이미 진행 중인 거래가 있습니다.';
    delete tradeRequests[senderName];
    clearTradeRequestTimer(senderName);
    const session = createTradeSession(senderName, user.name);
    activeTrades[senderName] = session;
    activeTrades[user.name] = session;
    return '✅ ' + senderName + '님과 ' + user.name + '님의 거래가 시작되었습니다.\n\n' + formatTradeStatus(session);
}

function parseTradeRegisterArgs(args) {
    const kind = args[1];
    if (!kind) return { error: '❌ /RPGenius 거래등록 [골드/가넷/카드/장비/아이템] ...' };
    if (kind == '골드' || kind == '가넷') {
        const amount = Number(args[2]);
        if (!Number.isInteger(amount) || amount < 1) return { error: '❌ 금액은 1 이상의 정수여야 합니다.' };
        return { kind, amount };
    }
    if (kind == '카드' || kind == '장비') {
        const number = Number(args[2]);
        if (!Number.isInteger(number) || number < 1) return { error: '❌ 번호는 1 이상의 정수여야 합니다.' };
        return { kind, number };
    }
    if (kind == '아이템') {
        const rest = args.slice(2);
        if (rest.length == 0) return { error: '❌ /RPGenius 거래등록 아이템 [아이템명] <갯수>' };
        const last = rest[rest.length - 1];
        const hasCount = rest.length > 1 && /^\d+$/.test(last);
        const count = hasCount ? Number(last) : 1;
        const itemName = (hasCount ? rest.slice(0, -1) : rest).join(' ');
        if (count < 1) return { error: '❌ 갯수는 1 이상의 정수여야 합니다.' };
        return { kind, itemName, count };
    }
    return { error: '❌ 지원하지 않는 거래 항목입니다.' };
}

function registerTradeOffer(user, args) {
    const session = getTradeSessionForUser(user.name);
    if (!session) return '❌ 진행 중인 거래가 없습니다.';
    const side = getMyTradeSide(session, user.name);
    if (!side) return '❌ 거래 세션 오류입니다.';
    const parsed = parseTradeRegisterArgs(args);
    if (parsed.error) return parsed.error;

    if (parsed.kind == '골드') {
        if (Number(user.gold || 0) < parsed.amount) return '❌ 골드가 부족합니다.';
        user.gold = Number(user.gold || 0) - parsed.amount;
        side.offer.gold = Number(side.offer.gold || 0) + parsed.amount;
        resetTradeConfirmations(session);
        return '✅ ' + comma(parsed.amount) + ' 골드를 등록했습니다.\n\n' + formatTradeStatus(session);
    }
    if (parsed.kind == '가넷') {
        if (Number(user.garnet || 0) < parsed.amount) return '❌ 가넷이 부족합니다.';
        user.garnet = Number(user.garnet || 0) - parsed.amount;
        side.offer.garnet = Number(side.offer.garnet || 0) + parsed.amount;
        resetTradeConfirmations(session);
        return '✅ ' + comma(parsed.amount) + ' 가넷을 등록했습니다.\n\n' + formatTradeStatus(session);
    }
    if (parsed.kind == '카드') {
        if (!user.inventory || !Array.isArray(user.inventory.card)) return '❌ 인벤토리가 비어있습니다.';
        const card = user.inventory.card[parsed.number - 1];
        if (!card) return '❌ 존재하지 않는 카드 번호입니다.';
        user.inventory.card.splice(parsed.number - 1, 1);
        side.offer.cards.push(card);
        resetTradeConfirmations(session);
        return '✅ ' + formatUserCard(card) + ' 캐릭터 카드를 등록했습니다.\n\n' + formatTradeStatus(session);
    }
    if (parsed.kind == '장비') {
        const selected = getEquipmentByNumber(user, parsed.number);
        if (!selected) return '❌ 존재하지 않는 장비 번호입니다.';
        if (selected.source == 'equipped') return '❌ 장착 중인 장비는 거래할 수 없습니다.';
        const data = getEquipmentData(selected.equip.type || selected.type, selected.equip.id);
        if (!data) return '❌ 잘못된 장비 데이터입니다.';
        if (data.no_trade) return '❌ 거래 불가 장비입니다.';
        const idx = user.inventory.equipment.indexOf(selected.equip);
        if (idx < 0) return '❌ 장비를 찾을 수 없습니다.';
        const equipCopy = { type: selected.equip.type || selected.type, id: selected.equip.id, level: Number(selected.equip.level || 0) };
        user.inventory.equipment.splice(idx, 1);
        side.offer.equipments.push(equipCopy);
        resetTradeConfirmations(session);
        return '✅ <' + data.rarity + '> ' + data.name + (equipCopy.level > 0 ? ' +' + equipCopy.level : '') + ' 장비를 등록했습니다.\n\n' + formatTradeStatus(session);
    }
    if (parsed.kind == '아이템') {
        const items = readJson(ITEMS_PATH, []);
        const itemId = items.findIndex(item => item.name == parsed.itemName);
        if (itemId == -1) return '❌ 존재하지 않는 아이템입니다.';
        const itemData = items[itemId];
        if (itemData.no_trade) return '❌ 거래 불가 아이템입니다.';
        if (getInventoryItemCount(user, itemId) < parsed.count) return '❌ 보유한 아이템이 부족합니다.';
        removeInventoryItem(user, itemId, parsed.count);
        side.offer.items[itemId] = Number(side.offer.items[itemId] || 0) + parsed.count;
        resetTradeConfirmations(session);
        return '✅ ' + itemData.name + ' 아이템을 ' + comma(parsed.count) + '개 등록했습니다.\n\n' + formatTradeStatus(session);
    }
    return '❌ 지원하지 않는 거래 항목입니다.';
}

function buildTradeGainLines(receivedOffer) {
    const items = readJson(ITEMS_PATH, []);
    const lines = [];
    (receivedOffer.equipments || []).forEach(entry => {
        const data = getEquipmentData(entry.type, entry.id);
        if (!data) return;
        const level = Number(entry.level || 0);
        lines.push('- <' + data.rarity + '> ' + data.name + (level > 0 ? ' +' + level : ''));
    });
    (receivedOffer.cards || []).forEach(card => {
        const cost = getCardTicketCost(card);
        lines.push('- ' + formatUserCard(card) + (cost > 0 ? ' (거래권 ' + comma(cost) + '장 소모)' : ''));
    });
    Object.keys(receivedOffer.items || {}).forEach(itemId => {
        const count = Number(receivedOffer.items[itemId] || 0);
        if (count <= 0) return;
        const data = items[itemId];
        if (!data) return;
        lines.push('- ' + data.name + ' x' + comma(count));
    });
    if (Number(receivedOffer.gold || 0) > 0) {
        const fee = Math.round(receivedOffer.gold * TRADE_FEE_RATE);
        lines.push('- 🪙 ' + comma(receivedOffer.gold - fee) + ' (수수료 ' + Math.round(TRADE_FEE_RATE * 100) + '% 제외)');
    }
    if (Number(receivedOffer.garnet || 0) > 0) {
        const fee = Math.round(receivedOffer.garnet * TRADE_FEE_RATE);
        lines.push('- 💠 ' + comma(receivedOffer.garnet - fee) + ' (수수료 ' + Math.round(TRADE_FEE_RATE * 100) + '% 제외)');
    }
    return lines;
}

async function finalizeTrade(session, channel) {
    const aUser = await getRPGUserByName(session.a);
    const bUser = await getRPGUserByName(session.b);
    if (!aUser || !bUser) {
        if (aUser) { refundOfferToUser(aUser, session.aOffer); await aUser.save(); }
        if (bUser) { refundOfferToUser(bUser, session.bOffer); await bUser.save(); }
        delete activeTrades[session.a];
        delete activeTrades[session.b];
        if (channel) channel.sendChat('❌ 거래 대상을 찾을 수 없어 거래가 취소되었습니다.');
        return;
    }
    const ticketId = getTradeTicketItemId();
    const aReceivesCards = session.bOffer.cards || [];
    const bReceivesCards = session.aOffer.cards || [];
    const aTicketsNeeded = aReceivesCards.reduce((sum, card) => sum + getCardTicketCost(card), 0);
    const bTicketsNeeded = bReceivesCards.reduce((sum, card) => sum + getCardTicketCost(card), 0);
    const aHasTickets = ticketId == -1 ? aTicketsNeeded == 0 : getInventoryItemCount(aUser, ticketId) >= aTicketsNeeded;
    const bHasTickets = ticketId == -1 ? bTicketsNeeded == 0 : getInventoryItemCount(bUser, ticketId) >= bTicketsNeeded;
    if (!aHasTickets || !bHasTickets) {
        refundOfferToUser(aUser, session.aOffer);
        refundOfferToUser(bUser, session.bOffer);
        await aUser.save();
        await bUser.save();
        delete activeTrades[session.a];
        delete activeTrades[session.b];
        const fail = !aHasTickets ? aUser.name : bUser.name;
        if (channel) channel.sendChat('❌ ' + fail + '님의 거래권이 부족하여 거래가 성사되지 못했습니다.');
        return;
    }
    const aCardSpace = getRemainingCardInventorySpace(aUser);
    const bCardSpace = getRemainingCardInventorySpace(bUser);
    if (aCardSpace < aReceivesCards.length || bCardSpace < bReceivesCards.length) {
        refundOfferToUser(aUser, session.aOffer);
        refundOfferToUser(bUser, session.bOffer);
        await aUser.save();
        await bUser.save();
        delete activeTrades[session.a];
        delete activeTrades[session.b];
        const fail = aCardSpace < aReceivesCards.length ? aUser.name : bUser.name;
        if (channel) channel.sendChat('❌ ' + fail + '님의 캐릭터 카드 인벤토리가 가득 차서 거래가 성사되지 못했습니다.');
        return;
    }

    if (aTicketsNeeded > 0) removeInventoryItem(aUser, ticketId, aTicketsNeeded);
    if (bTicketsNeeded > 0) removeInventoryItem(bUser, ticketId, bTicketsNeeded);

    const aReceive = {
        gold: session.bOffer.gold ? session.bOffer.gold - Math.round(session.bOffer.gold * TRADE_FEE_RATE) : 0,
        garnet: session.bOffer.garnet ? session.bOffer.garnet - Math.round(session.bOffer.garnet * TRADE_FEE_RATE) : 0,
        cards: session.bOffer.cards,
        equipments: session.bOffer.equipments,
        items: session.bOffer.items
    };
    const bReceive = {
        gold: session.aOffer.gold ? session.aOffer.gold - Math.round(session.aOffer.gold * TRADE_FEE_RATE) : 0,
        garnet: session.aOffer.garnet ? session.aOffer.garnet - Math.round(session.aOffer.garnet * TRADE_FEE_RATE) : 0,
        cards: session.aOffer.cards,
        equipments: session.aOffer.equipments,
        items: session.aOffer.items
    };
    refundOfferToUser(aUser, aReceive);
    refundOfferToUser(bUser, bReceive);

    await aUser.save();
    await bUser.save();
    delete activeTrades[session.a];
    delete activeTrades[session.b];

    const lines = ['✅ 거래가 성사되었습니다!', ''];
    const aGain = buildTradeGainLines(session.bOffer);
    const bGain = buildTradeGainLines(session.aOffer);
    lines.push('[ ' + aUser.name + '님 획득 결과 ]');
    if (aGain.length == 0) lines.push('- 없음'); else lines.push(...aGain);
    lines.push('');
    lines.push('[ ' + bUser.name + '님 획득 결과 ]');
    if (bGain.length == 0) lines.push('- 없음'); else lines.push(...bGain);
    if (channel) channel.sendChat(lines.join('\n'));
}

async function confirmTrade(user, channel) {
    const session = getTradeSessionForUser(user.name);
    if (!session) return '❌ 진행 중인 거래가 없습니다.';
    const side = getMyTradeSide(session, user.name);
    if (!side) return '❌ 거래 세션 오류입니다.';
    if (side.isA) session.aConfirmed = true;
    else session.bConfirmed = true;
    if (session.aConfirmed && session.bConfirmed) {
        await finalizeTrade(session, channel);
        return null;
    }
    return '✅ ' + user.name + '님이 거래를 성사시키고자 합니다.';
}

function unconfirmTrade(user) {
    const session = getTradeSessionForUser(user.name);
    if (!session) return '❌ 진행 중인 거래가 없습니다.';
    const side = getMyTradeSide(session, user.name);
    if (!side) return '❌ 거래 세션 오류입니다.';
    if (side.isA) session.aConfirmed = false;
    else session.bConfirmed = false;
    return '🛑 ' + user.name + '님이 거래 성사 요청을 취소했습니다.';
}

async function cancelTradeByUser(user, channel) {
    const session = getTradeSessionForUser(user.name);
    if (!session) return '❌ 진행 중인 거래가 없습니다.';
    await cancelActiveTrade(session, '⛔ ' + user.name + '님이 거래를 취소했습니다.', channel);
    return null;
}

async function getRPGUserById(id) {
    try {
        const res = await queryItems({
            TableName: TABLE_NAME,
            IndexName: 'getIdx',
            KeyConditionExpression: '#gsi_partition_key = :gsi_value',
            FilterExpression: 'contains(logged_in, :userid_val)',
            ExpressionAttributeNames: {
                '#gsi_partition_key': '_get'
            },
            ExpressionAttributeValues: {
                ':gsi_value': 1,
                ':userid_val': id
            }
        });
        if (res.success && res.result[0] && res.result[0].Items && res.result[0].Items[0]) return new RPGUser().load(res.result[0].Items[0]);
        return null;
    } catch (e) {
        console.log('getRPGUserById error:', e);
        return null;
    }
}

async function getRPGUserByName(name) {
    try {
        const res = await queryItems({
            TableName: TABLE_NAME,
            IndexName: 'nameIdx',
            KeyConditionExpression: '#name = :name_val',
            ExpressionAttributeNames: {
                '#name': 'name'
            },
            ExpressionAttributeValues: {
                ':name_val': name
            }
        });
        if (res.success && res.result[0] && res.result[0].Items && res.result[0].Items[0]) return new RPGUser().load(res.result[0].Items[0]);
        return null;
    } catch (e) {
        console.log('getRPGUserByName error:', e);
        return null;
    }
}

async function getRPGUserByCode(code) {
    try {
        const res = await queryItems({
            TableName: TABLE_NAME,
            IndexName: 'codeIdx',
            KeyConditionExpression: '#code = :code_val',
            ExpressionAttributeNames: {
                '#code': 'code'
            },
            ExpressionAttributeValues: {
                ':code_val': code
            }
        });
        if (res.success && res.result[0] && res.result[0].Items && res.result[0].Items[0]) return new RPGUser().load(res.result[0].Items[0]);
        return null;
    } catch (e) {
        console.log('getRPGUserByCode error:', e);
        return null;
    }
}

async function getAllRPGUsers() {
    const users = [];
    let ExclusiveStartKey = undefined;
    try {
        while (true) {
            const params = {
                TableName: TABLE_NAME,
                IndexName: 'getIdx',
                KeyConditionExpression: '#gsi_partition_key = :gsi_value',
                ExpressionAttributeNames: { '#gsi_partition_key': '_get' },
                ExpressionAttributeValues: { ':gsi_value': 1 }
            };
            if (ExclusiveStartKey) params.ExclusiveStartKey = ExclusiveStartKey;
            const res = await queryItems(params);
            if (!res.success || !res.result[0] || !res.result[0].Items) break;
            res.result[0].Items.forEach(item => users.push(new RPGUser().load(item)));
            ExclusiveStartKey = res.result[0].LastEvaluatedKey;
            if (!ExclusiveStartKey) break;
        }
    } catch (e) {
        console.log('getAllRPGUsers error:', e);
    }
    return users;
}

async function formatCombatPowerRanking(currentUser) {
    const users = await getAllRPGUsers();
    if (users.length == 0) return '❌ 랭킹 데이터를 불러올 수 없습니다.';
    const ranked = users
        .map(u => ({ name: u.name, level: Number(u.level || 1), cp: calculateCombatPower(u).total }))
        .sort((a, b) => b.cp - a.cp || b.level - a.level || a.name.localeCompare(b.name));

    const myIndex = ranked.findIndex(entry => entry.name == (currentUser && currentUser.name));
    const myRank = myIndex >= 0 ? myIndex + 1 : null;
    const myEntry = myIndex >= 0 ? ranked[myIndex] : null;

    const formatLine = (rank, entry) => {
        const medal = rank == 1 ? '🥇' : rank == 2 ? '🥈' : rank == 3 ? '🥉' : rank + '위';
        return medal + ' ' + entry.name + ' (Lv.' + comma(entry.level) + ') - ⚔️ ' + comma(entry.cp);
    };

    const lines = ['[ 전투력 랭킹 ]'];
    if (myEntry) lines.push('〈 내 순위 〉 ' + comma(myRank) + '위 / ' + comma(ranked.length) + '명', formatLine(myRank, myEntry));
    else lines.push('〈 내 순위 〉 순위 없음');
    lines.push('');
    lines.push('〈 TOP 3 〉');
    for (let i = 0; i < Math.min(3, ranked.length); i++) lines.push(formatLine(i + 1, ranked[i]));

    if (ranked.length > 3) {
        lines.push(VIEWMORE);
        lines.push('〈 4위 ~ 10위 〉');
        for (let i = 3; i < Math.min(10, ranked.length); i++) lines.push(formatLine(i + 1, ranked[i]));
    }
    return lines.join('\n');
}

function getCommandBlockMessage(senderId) {
    const now = Date.now();
    const state = commandSpamStates[senderId] || { times: [], blockedUntil: 0, notifiedUntil: 0 };
    if (Number(state.blockedUntil || 0) > now) {
        commandSpamStates[senderId] = state;
        if (Number(state.notifiedUntil || 0) <= now) {
            state.notifiedUntil = now + 5000;
            const remainSeconds = Math.ceil((state.blockedUntil - now) / 1000);
            return '❌ 명령어 도배로 RPG 관련 명령어 사용이 차단되었습니다.\n- 남은 시간: ' + Math.ceil(remainSeconds / 60) + '분';
        }
        return null;
    }
    state.times = (state.times || []).filter(time => now - time < COMMAND_SPAM_WINDOW_MS);
    state.times.push(now);
    if (state.times.length >= COMMAND_SPAM_LIMIT) {
        state.times = [];
        state.blockedUntil = now + COMMAND_SPAM_BLOCK_MS;
        state.notifiedUntil = now + 5000;
        commandSpamStates[senderId] = state;
        return '❌ 1초에 ' + COMMAND_SPAM_LIMIT + '회 이상 RPG 명령어를 입력하여 10분동안 사용이 차단됩니다.';
    }
    commandSpamStates[senderId] = state;
    return false;
}

function enqueueUserCommand(senderId, task) {
    const previous = commandQueues[senderId] || Promise.resolve();
    const next = previous
        .catch(() => {})
        .then(task)
        .finally(() => {
            if (commandQueues[senderId] === next) delete commandQueues[senderId];
        });
    commandQueues[senderId] = next;
    return next;
}

async function handleRPGCommand(data, channel) {
    if (!channel || !TARGET_CHANNEL_IDS.includes(channel.channelId + '')) return false;
    const msg = (data.text || '').trim();
    if (!msg.startsWith('/')) return false;
    const cmd = msg.substr(1).trim();
    if (!(cmd.toLowerCase().startsWith('rpg') || cmd.toLowerCase().startsWith('rpgenius'))) return false;

    const sender = data.getSenderInfo(channel) || data._chat?.sender;
    if (!sender || !sender.userId) return true;
    const senderId = sender.userId + '';
    const args = cmd.substr(cmd.split(' ')[0].length + 1).split(' ');
    const reply = text => channel.sendChat(text);

    if (args[0] == '등록') {
        const nickname = cmd.substr(cmd.split(' ')[0].length + 4).trim();
        const existingById = await getRPGUserById(senderId);
        if (existingById) {
            reply('❌ 이미 로그인된 상태입니다: ' + existingById.name);
        } else {
            const existsByName = await getRPGUserByName(nickname);
            if (existsByName) {
                reply('❌ 이미 존재하는 이름입니다.');
            } else if (nickname.match(/[^가-힣ㄱ-ㅎa-zA-Z0-9\s]/) || nickname.length == 0) {
                reply('❌ 닉네임은 한글, 영어, 숫자 및 공백만 들어갈 수 있습니다.');
            } else if (nickname.length > 10) {
                reply('❌ 닉네임은 최대 10글자로 설정하셔야 합니다.');
            } else {
                pendingChecks[senderId] = {
                    type: 'rpg등록',
                    arg: { name: nickname }
                };
                reply('닉네임: [ ' + nickname + ' ]\n정말 등록하시겠습니까?\n\n[ /RPGenius 확인 ]');
            }
        }
        return true;
    }

    if (args[0] == '로그인') {
        const existingById = await getRPGUserById(senderId);
        if (existingById) {
            reply('❌ 이미 로그인된 상태입니다: ' + existingById.name);
            return true;
        }
        const code = args[1];
        const loginUser = await getRPGUserByCode(code);
        if (loginUser) {
            if (!Array.isArray(loginUser.logged_in)) loginUser.logged_in = [];
            if (!loginUser.logged_in.includes(senderId)) loginUser.logged_in.push(senderId);
            loginUser.code = getRandomString(10).toUpperCase();
            await loginUser.save();
            reply('✅ ' + loginUser + ' 계정으로 로그인했습니다.');
        } else {
            reply('❌ 잘못된 코드입니다.');
        }
        return true;
    }

    if (pendingChecks[senderId] && args[0] == '확인') {
        if (pendingChecks[senderId].type == 'rpg등록') {
            const user = new RPGUser(pendingChecks[senderId].arg.name, senderId);
            const res = await putItem(TABLE_NAME, user);
            if (res.success) {
                reply('✅ 성공적으로 등록되셨습니다!\n환영합니다, ' + user.name + '님!\n캐릭터 카드를 선택해주세요.');
                reply(formatCharacterCardList());
            } else {
                reply('❌ 등록 과정에서 오류가 발생했습니다.\n' + VIEWMORE + '\n' + (res.result && res.result[0] && (res.result[0].message || res.result[0].Message) || 'Unknown Error'));
            }
        }
        delete pendingChecks[senderId];
        return true;
    }

    if (args[0] == '캐릭터카드' && args[1] == '선택') {
        const cardName = cmd.substr(cmd.split(' ')[0].length + 1 + args[0].length + 1 + args[1].length + 1).trim();
        const user = await getRPGUserById(senderId);
        if (!user) {
            reply('❌ 등록되지 않은 사용자입니다.\n/RPGenius 등록 [닉네임]');
        } else {
            if (!user.need_character_card_select) {
                reply('❌ 이미 캐릭터 카드를 선택했습니다.');
                return true;
            }
            const characterCard = findCharacterCardByName(cardName);
            if (!characterCard) {
                reply('❌ 존재하지 않는 캐릭터 카드입니다.\n' + formatCharacterCardList());
                return true;
            }
            const userCard = {
                id: characterCard.index,
                star: 0,
                type: '일반'
            };
            user.main_card = userCard;
            user.need_character_card_select = false;
            const stats = calculateUserStats(user);
            user.hp = Number(stats.hp || 0);
            user.mp = Number(stats.mp || 0);
            addInventoryItem(user, 41, 1);
            await user.save();
            reply('✅ 캐릭터 카드를 선택했습니다: ' + characterCard.card.name + '\n\n🎁 초보자 키트를 받았습니다!\n/RPGenius 사용 초보자 키트');
        }
        return true;
    }

    const user = await getRPGUserById(senderId);
    if (!user) {
        reply('❌ 등록되지 않은 사용자입니다.\n/RPGenius 등록 [닉네임]');
        return true;
    }

    if (user.pendingAction && user.pendingAction.type == '캐릭터변환') {
        if (args[0] == '사용취소') {
            user.pendingAction = null;
            await user.save();
            reply('✅ 캐릭터 변환석 사용을 취소했습니다.');
            return true;
        }
        if (args[0] != '선택') {
            reply('❌ 캐릭터 변환할 카드를 먼저 선택해야 합니다.\n/RPGenius 선택 [카드번호]\n/RPGenius 사용취소');
            return true;
        }
        const result = convertCharacterCard(user, args[1]);
        await user.save();
        reply(result);
        return true;
    }

    if (user.pendingAction && user.pendingAction.type == '장비강화') {
        if (args[0] == '강화') {
            const result = runEquipmentUpgrade(user);
            await user.save();
            reply(result);
            return true;
        }
        user.pendingAction = null;
        await user.save();
        reply('❌ 장비 강화가 취소되었습니다.');
        return true;
    }

    if (user.pendingAction && user.pendingAction.type == '카드조합') {
        if (args[0] == '조합') {
            const result = runCardCombine(user);
            await user.save();
            reply(result);
            return true;
        }
        user.pendingAction = null;
        await user.save();
        reply('❌ 카드조합이 취소되었습니다.');
        return true;
    }

    if (user.pendingAction && user.pendingAction.type == '카드판매') {
        if (args[0] == '판매') {
            const result = runCardSale(user);
            await user.save();
            reply(result);
            return true;
        }
        user.pendingAction = null;
        await user.save();
        reply('❌ 카드판매가 취소되었습니다.');
        return true;
    }

    if (user.pendingAction && user.pendingAction.type == '제작') {
        if (args[0] == '제작') {
            const result = runCraft(user);
            await user.save();
            reply(result);
            return true;
        }
        user.pendingAction = null;
        await user.save();
        reply('❌ 제작이 취소되었습니다.');
        return true;
    }

    const adminResult = await handleAdminCommand({ raw: cmd, args: args, prefixLength: cmd.split(' ')[0].length }, user);
    if (adminResult !== null) {
        reply(adminResult);
        return true;
    }

    if (user.need_character_card_select) {
        reply('❌ 먼저 캐릭터 카드를 선택해야 합니다.\n/RPGenius 캐릭터카드 선택 [캐릭터카드 이름]');
        reply(formatCharacterCardList());
        return true;
    }

    if (args[0] == '낚시') {
        const result = await toggleFishing(user, channel);
        reply(result);
        return true;
    }

    if (user.fishing) await stopFishingForCommand(user);

    if (args[0] == '살림망') {
        reply(formatFishingNet(user));
        return true;
    }

    if (args[0] == '살림망비우기') {
        const result = await clearFishingNet(user);
        reply(result);
        return true;
    }

    if (args[0] == '거래신청') {
        const targetName = cmd.substr(cmd.split(' ')[0].length + 1 + args[0].length + 1).trim();
        reply(createTradeRequest(user, targetName, channel));
        return true;
    }

    if (args[0] == '거래신청취소') {
        reply(cancelTradeRequest(user));
        return true;
    }

    if (args[0] == '거래수락') {
        reply(acceptTradeRequest(user));
        return true;
    }

    if (args[0] == '거래등록') {
        const result = registerTradeOffer(user, args);
        await user.save();
        reply(result);
        return true;
    }

    if (args[0] == '거래성사') {
        const result = await confirmTrade(user, channel);
        if (result) reply(result);
        return true;
    }

    if (args[0] == '거래성사취소') {
        reply(unconfirmTrade(user));
        return true;
    }

    if (args[0] == '거래취소') {
        const result = await cancelTradeByUser(user, channel);
        if (result) reply(result);
        return true;
    }

    if (activeTrades[user.name] && !['내정보', '설명', '인벤토리', '인벤', 'i', '캐릭인벤', 'ci', '장비인벤', 'ei', '스탯'].includes(args[0])) {
        reply('❌ 거래 진행 중에는 사용할 수 없는 명령어입니다.\n/RPGenius 거래취소');
        return true;
    }

    if (user.field && user.field.name && !['필드퇴장', '공격', '스킬', '내정보', '설명', '사용'].includes(args[0])) {
        reply('❌ 필드에서 사용할 수 없는 명령어입니다.\n/RPGenius 필드퇴장');
        return true;
    }

    if (args[0] == '필드') {
        reply(formatFieldList(user));
        return true;
    }

    if (args[0] == '필드입장') {
        const fieldName = cmd.substr(cmd.split(' ')[0].length + 1 + args[0].length + 1).trim();
        if (!fieldName) {
            reply('❌ /RPGenius 필드입장 [필드명]');
            return true;
        }
        const result = enterField(user, fieldName);
        await user.save();
        reply(result);
        return true;
    }

    if (args[0] == '필드퇴장') {
        const result = leaveField(user);
        await user.save();
        reply(result);
        return true;
    }

    if (args[0] == '공격') {
        const result = useBasicAttackInField(user);
        await user.save();
        reply(result);
        return true;
    }

    if (args[0] == '스킬') {
        const skillName = cmd.substr(cmd.split(' ')[0].length + 1 + args[0].length + 1).trim();
        if (!skillName) {
            reply('❌ /RPGenius 스킬 [스킬명]');
            return true;
        }
        const result = useSkillInField(user, skillName);
        await user.save();
        reply(result);
        return true;
    }

    if (['인벤토리', '인벤', 'i'].includes(args[0])) {
        reply(formatInventory(user));
        return true;
    }

    if (['캐릭인벤', 'ci'].includes(args[0])) {
        reply(formatCharacterInventory(user));
        return true;
    }

    if (['장비인벤', 'ei'].includes(args[0])) {
        reply(formatEquipmentInventory(user));
        return true;
    }

    if (args[0] == '스탯') {
        reply(formatStatPointStatus(user));
        return true;
    }

    if (args[0] == '스탯포인트') {
        if (!args[1]) {
            reply('❌ /RPGenius 스탯포인트 [공격력|체력|MP|방어력|방어 관통력] <숫자>');
            return true;
        }
        const statName = args[1] == '방어' && args[2] == '관통력' ? '방어 관통력' : args[1];
        const countArg = statName == '방어 관통력' ? args[3] : args[2];
        const result = investStatPoint(user, statName, countArg);
        await user.save();
        reply(result);
        return true;
    }

    if (args[0] == '캐릭터카드' && args[1] == '장착') {
        if (!args[2]) {
            reply('❌ /RPGenius 캐릭터카드 장착 [번호]');
            return true;
        }
        const result = equipMainCharacterCard(user, args[2]);
        await user.save();
        reply(result);
        return true;
    }

    if (args[0] == '캐릭터카드' && args[1] == '슬롯' && args[2] == '장착') {
        if (!args[3]) {
            reply('❌ /RPGenius 캐릭터카드 슬롯 장착 [번호]');
            return true;
        }
        const result = equipCharacterCardSlot(user, args[3]);
        await user.save();
        reply(result);
        return true;
    }

    if (args[0] == '캐릭터카드' && args[1] == '슬롯' && args[2] == '제거') {
        if (!args[3]) {
            reply('❌ /RPGenius 캐릭터카드 슬롯 제거 [슬롯번호]');
            return true;
        }
        const result = removeCharacterCardSlot(user, args[3]);
        await user.save();
        reply(result);
        return true;
    }

    if (args[0] == '카드조합') {
        const result = formatCardCombinePreview(user, args.slice(1, 4));
        await user.save();
        reply(result);
        return true;
    }

    if (args[0] == '랜덤카드조합') {
        if (!args[1]) {
            reply('❌ /RPGenius 랜덤카드조합 [등급]');
            return true;
        }
        const selected = getRandomCardCombineNumbers(user, args[1]);
        const result = selected.error ? selected.error : formatCardCombinePreview(user, selected.numbers);
        await user.save();
        reply(result);
        return true;
    }

    if (args[0] == '카드판매') {
        const result = formatCardSalePreview(user, args.slice(1));
        await user.save();
        reply(result);
        return true;
    }

    if (args[0] == '카드일괄판매') {
        if (!args[1]) {
            reply('❌ /RPGenius 카드일괄판매 [등급] <갯수>');
            return true;
        }
        const selected = getRandomCardSaleNumbers(user, args[1], args[2]);
        const result = selected.error ? selected.error : formatCardSalePreview(user, selected.numbers);
        await user.save();
        reply(result);
        return true;
    }

    if (args[0] == '내정보') {
        await sendUserMainCardImage(channel, user);
        reply(formatMyInfo(user));
        return true;
    }

    if (args[0] == '전투력랭킹') {
        reply(await formatCombatPowerRanking(user));
        return true;
    }

    if (args[0] == '설명') {
        const name = cmd.substr(cmd.split(' ')[0].length + 1 + args[0].length + 1).trim();
        const description = formatDescription(name);
        const characterCard = findCharacterCardByName(name);
        if (description && characterCard) await sendCharacterCardCoverImage(channel, characterCard.card);
        reply(description || '❌ 존재하지 않는 이름입니다.');
        return true;
    }

    if (args[0] == '상점') {
        const shopType = args[1] || '일반';
        const shopDisplay = formatShop(shopType);
        reply(shopDisplay || '❌ 존재하지 않는 상점입니다.');
        return true;
    }

    if (args[0] == '출석체크') {
        const result = checkAttendance(user);
        await user.save();
        reply(result);
        return true;
    }

    if (args[0] == '제작') {
        const craftName = cmd.substr(cmd.split(' ')[0].length + 1 + args[0].length + 1).trim();
        if (!craftName) {
            reply('❌ /RPGenius 제작 [이름]');
            return true;
        }
        const result = formatCraftPreview(user, craftName);
        await user.save();
        reply(result);
        return true;
    }

    if (args[0] == '구매') {
        if (!args[1] || !args[2]) {
            reply('❌ /RPGenius 구매 [상점] [번호] [갯수]');
            return true;
        }
        const result = await purchaseShopItem(user, args[1], args[2], args[3]);
        reply(result);
        return true;
    }

    if (args[0] == '사용') {
        const useText = cmd.substr(cmd.split(' ')[0].length + 1 + args[0].length + 1).trim();
        if (!useText) {
            reply('❌ /RPGenius 사용 [아이템] <갯수>');
            return true;
        }
        const useArgs = useText.split(' ');
        const lastArg = useArgs[useArgs.length - 1];
        const useCount = /^\d+$/.test(lastArg) && useArgs.length > 1 ? lastArg : null;
        const itemName = useCount ? useArgs.slice(0, -1).join(' ') : useText;
        if (user.field && user.field.name) {
            const items = readJson(ITEMS_PATH, []);
            const targetItem = items.find(item => item.name == itemName);
            if (targetItem && targetItem.type != '소모품') {
                reply('❌ 필드에서는 소모품만 사용할 수 있습니다.');
                return true;
            }
        }
        const result = await useItem(user, itemName, useCount);
        reply(result);
        return true;
    }

    if (args[0] == '쿠폰') {
        if (!args[1]) {
            reply('❌ /RPGenius 쿠폰 [코드]');
            return true;
        }
        const result = useCoupon(user, args[1]);
        await user.save();
        reply(result);
        return true;
    }

    if (args[0] == '장착') {
        if (!args[1]) {
            reply('❌ /RPGenius 장착 [장비번호]');
            return true;
        }
        const result = equipItemByNumber(user, args[1]);
        await user.save();
        reply(result);
        return true;
    }

    if (args[0] == '장착해제') {
        if (!args[1]) {
            reply('❌ /RPGenius 장착해제 [장신구번호]');
            return true;
        }
        const result = unequipAccessoryByNumber(user, args[1]);
        await user.save();
        reply(result);
        return true;
    }

    if (args[0] == '장비강화') {
        if (!args[1]) {
            reply('❌ /RPGenius 장비강화 [장비번호]');
            return true;
        }
        const result = formatEquipmentUpgradePreview(user, args[1]);
        await user.save();
        reply(result);
        return true;
    }

    if (args[0] == '분해') {
        if (!args[1]) {
            reply('❌ /RPGenius 분해 [장비번호]');
            return true;
        }
        const result = disassembleEquipment(user, args[1]);
        await user.save();
        reply(result);
        return true;
    }

    if (args[0] == '코드') {
        reply(user.code);
        return true;
    }

    if (args[0] == '로그아웃') {
        user.logged_in = user.logged_in.filter(id => id != senderId);
        await user.save();
        reply('✅ ' + user + ' 계정에서 로그아웃했습니다.');
        return true;
    }

    return true;
}

async function onChat(data, channel) {
    if (!channel || !TARGET_CHANNEL_IDS.includes(channel.channelId + '')) return false;
    const msg = (data.text || '').trim();
    if (!msg.startsWith('/')) return false;
    const cmd = msg.substr(1).trim();
    if (!(cmd.toLowerCase().startsWith('rpg') || cmd.toLowerCase().startsWith('rpgenius'))) return false;
    const sender = data.getSenderInfo(channel) || data._chat?.sender;
    if (!sender || !sender.userId) return true;
    const senderId = sender.userId + '';
    const blockMessage = getCommandBlockMessage(senderId);
    if (blockMessage === null) return true;
    if (blockMessage) {
        channel.sendChat(blockMessage);
        return true;
    }
    enqueueUserCommand(senderId, () => handleRPGCommand(data, channel)).catch(error => console.log('RPG command queue error:', error));
    return true;
}

module.exports = {
    TARGET_CHANNEL_IDS,
    RPGUser,
    getRPGUserById,
    getRPGUserByName,
    getRPGUserByCode,
    onChat
};