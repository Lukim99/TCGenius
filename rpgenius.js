const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, UpdateCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');
const node_kakao = require('node-kakao');
const fs = require('fs');
const path = require('path');

const TARGET_CHANNEL_IDS = ['442097040687921', '18470462260425659'];
const TABLE_NAME = 'rpgenius_user';
const VIEWMORE = '\u200e'.repeat(500);
const pendingChecks = {};
const CHARACTER_CARDS_PATH = path.join(__dirname, 'DB', 'RPGenius', 'CharacterCards.json');
const SKILLS_PATH = path.join(__dirname, 'DB', 'RPGenius', 'Skills.json');
const ITEMS_PATH = path.join(__dirname, 'DB', 'RPGenius', 'Item.json');
const EQUIPMENT_PATH = path.join(__dirname, 'DB', 'RPGenius', 'Equipment.json');
const PACKS_PATH = path.join(__dirname, 'DB', 'RPGenius', 'Pack.json');
const BUNDLE_PATH = path.join(__dirname, 'DB', 'RPGenius', 'Bundle.json');
const SHOP_PATH = path.join(__dirname, 'DB', 'RPGenius', 'Shop.json');
const COUPON_PATH = path.join(__dirname, 'DB', 'RPGenius', 'Coupon.json');
const BASE_STAT_PATH = path.join(__dirname, 'DB', 'RPGenius', 'BaseStat.json');
const EXP_TABLE_PATH = path.join(__dirname, 'DB', 'RPGenius', 'ExpTable.json');
const DUNGEON_PATH = path.join(__dirname, 'DB', 'RPGenius', 'Dungeon.json');
const CARD_IMAGE_PATH = path.join(__dirname, 'DB', 'RPGenius', 'cardImage');
const ITEM_TYPE_ORDER = ['가챠', '번들', '마법석', '소모품', '티켓', '재료'];

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
    if (['crit', 'critMul', 'atk%', 'def%', 'hp%'].includes(key)) return sign + (Math.round(number * 1000) / 10) + '%';
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
        crit: '치명타 확률',
        critMul: '치명타 피해량'
    };
    const plusStatNames = {
        atk: '최종 공격력',
        def: '최종 방어력',
        hp: '최종 체력'
    };
    const lines = [];
    Object.keys(statNames).forEach(key => {
        if (equipment.stat && typeof equipment.stat[key] != 'undefined') lines.push('- ' + statNames[key] + ' ' + formatStatValue(key, equipment.stat[key]));
    });
    Object.keys(plusStatNames).forEach(key => {
        if (equipment.plusStat && typeof equipment.plusStat[key] != 'undefined') lines.push('- ' + plusStatNames[key] + ' ' + formatStatValue(key + '%', equipment.plusStat[key]));
    });
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
        pnt: 0
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
        if (cardData.name == '마쉐비') effects.pnt += value;
    });
    return effects;
}

function formatCardSlotEffectLines(user) {
    const slotEffects = calculateCardSlotEffects(user);
    const effectMap = [
        ['expBonus', '경험치 획득 증가량'],
        ['hpDamageReduction', '사냥 시 HP 소모량 감소'],
        ['killRecoveryChance', '적 처치 시 HP/MP 10% 회복 확률'],
        ['crit', '치명타 확률 증가'],
        ['mpCostReduction', '사냥 시 MP 소모량 감소'],
        ['damageBonus', '일반 몬스터에게 주는 피해 증가'],
        ['critMul', '치명타 피해량 증가'],
        ['goldBonus', '골드 획득 증가량'],
        ['itemDropChance', '아이템 드랍 확률'],
        ['pnt', '방어 관통력']
    ];
    return effectMap
        .filter(entry => Number(slotEffects[entry[0]] || 0) > 0)
        .map(entry => {
            const value = Number(slotEffects[entry[0]] || 0);
            const display = entry[0] == 'pnt' ? comma(value) : Math.round(value * 1000) / 10 + '%';
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
    const before = Object.assign({}, card);
    let newId = card.id;
    while (newId == card.id) newId = randomInt(0, characterCards.length - 1);
    card.id = newId;
    if (user.main_card && user.main_card.id == before.id && user.main_card.star == before.star && user.main_card.type == before.type) user.main_card.id = newId;
    if (Array.isArray(user.card_slot)) {
        user.card_slot.forEach(slotCard => {
            if (slotCard && slotCard.id == before.id && slotCard.star == before.star && slotCard.type == before.type) slotCard.id = newId;
        });
    }
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

function calculateUserStats(user) {
    const stats = getBaseStat(user.main_card);
    [['weapon', user.equipments && user.equipments.weapon], ['armor', user.equipments && user.equipments.armor]].forEach(entry => {
        const data = entry[1] && getEquipmentData(entry[0], entry[1].id);
        if (data) addStats(stats, getEquipmentStatsAtLevel(data, entry[1].level));
    });
    const accessories = user.equipments && user.equipments.accessory || {};
    Object.keys(accessories).forEach(key => {
        const equip = accessories[key];
        const data = equip && getEquipmentData('accessory', equip.id);
        if (data) addStats(stats, getEquipmentStatsAtLevel(data, equip.level));
    });
    const slotEffects = calculateCardSlotEffects(user);
    stats.crit = Number(stats.crit || 0) + slotEffects.crit;
    stats.critMul = Number(stats.critMul || 0) + slotEffects.critMul;
    stats.pnt = Number(stats.pnt || 0) + slotEffects.pnt;
    return stats;
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
    return levelUps;
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
    user.field = { name: dungeon.name, enteredAt: Date.now(), nextActionAt: 0, skillCooldowns: {} };
    return '✅ 필드에 입장했습니다: ' + dungeon.name;
}

function leaveField(user) {
    if (!user.field || !user.field.name) return '❌ 입장 중인 필드가 없습니다.';
    const fieldName = user.field.name;
    user.field = null;
    return '✅ 필드에서 퇴장했습니다: ' + fieldName;
}

function buildHuntResult(user, dungeon, rawDamage, extra) {
    const stats = calculateUserStats(user);
    const slotEffects = calculateCardSlotEffects(user);
    const damageWithSlotBonus = Number(rawDamage || 0) * (1 + slotEffects.damageBonus);
    const criticalResult = applyCriticalDamage(damageWithSlotBonus, stats, extra);
    const finalDamage = getDamageAfterDefense(criticalResult.damage, dungeon.def, extra && extra.pnt || stats.pnt);
    const killCount = Math.floor(finalDamage / Number(dungeon.hp || 1));
    const fieldDamageBase = Number(dungeon.atk || 0) * (extra && extra.receivedDamageMul || 1) * (1 - Math.min(1, slotEffects.hpDamageReduction));
    const fieldDamage = getDamageAfterDefense(fieldDamageBase, stats.def, dungeon.pnt);
    const maxHp = Number(stats.hp || 0);
    const beforeHp = typeof user.hp == 'undefined' ? maxHp : Number(user.hp || 0);
    user.hp = Math.max(0, beforeHp - fieldDamage);

    const lines = ['⚔️ ' + comma(finalDamage) + (criticalResult.isCritical ? ' 치명타 ' : ' ') + '피해를 입혔습니다!', '- 총 ' + comma(killCount) + '마리 처치'];
    lines.push('❗ ' + comma(fieldDamage) + ' 피해를 입었습니다!');

    if (user.hp <= 0) {
        user.hp = 1;
        user.field = null;
        lines.push('- 남은 체력: 1/' + comma(maxHp));
        lines.push('', '💀 보상을 획득하지 못하고 필드에서 퇴장했습니다.');
        return lines.join('\n');
    }

    lines.push('- 남은 체력: ' + comma(user.hp) + '/' + comma(maxHp));

    if (killCount > 0) {
        let expReward = Math.round(Number(dungeon.reward && dungeon.reward.exp || 0) * killCount * (1 + slotEffects.expBonus));
        let goldReward = 0;
        for (let i = 0; i < killCount; i++) goldReward += randomInt(Number(dungeon.reward.gold.min || 0), Number(dungeon.reward.gold.max || 0));
        goldReward = Math.round(goldReward * (1 + slotEffects.goldBonus + Number(extra && extra.goldBonus || 0)));
        user.gold = Number(user.gold || 0) + goldReward;
        const levelUps = addExperience(user, expReward);
        lines.push('', '[ 보상 ]');
        lines.push('- XP ' + comma(expReward));
        lines.push('- 🪙 ' + comma(goldReward));
        if (levelUps > 0) lines.push('- 레벨업! Lv. ' + user.level);
    }

    if (killCount > 0) {
        const dropChance = 0.03 + Number(slotEffects.itemDropChance || 0);
        if (Math.random() < dropChance) {
            const items = readJson(ITEMS_PATH, []);
            const dropItemId = items.findIndex(item => item.name == '장비 상자');
            if (dropItemId != -1) {
                addInventoryItem(user, dropItemId, 1);
                lines.push('- 🌟 ' + items[dropItemId].name + ' 획득!');
            }
        }
    }

    if (killCount > 0 && slotEffects.killRecoveryChance > 0) {
        let recoveryCount = 0;
        for (let i = 0; i < killCount; i++) if (Math.random() < slotEffects.killRecoveryChance) recoveryCount++;
        if (recoveryCount > 0) {
            const beforeRecoverHp = Number(user.hp || 0);
            const beforeRecoverMp = typeof user.mp == 'undefined' ? Number(stats.mp || 0) : Number(user.mp || 0);
            user.hp = Math.min(maxHp, beforeRecoverHp + Math.round(maxHp * 0.1) * recoveryCount);
            user.mp = Math.min(Number(stats.mp || 0), beforeRecoverMp + Math.round(Number(stats.mp || 0) * 0.1) * recoveryCount);
            lines.push('- 처치 회복: HP +' + comma(user.hp - beforeRecoverHp) + ' / MP +' + comma(user.mp - beforeRecoverMp));
        }
    }

    const passiveMp = getPassiveMpRecovery(user);
    if (passiveMp > 0) {
        const beforeMp = typeof user.mp == 'undefined' ? Number(stats.mp || 0) : Number(user.mp || 0);
        user.mp = Math.min(Number(stats.mp || 0), beforeMp + passiveMp);
        if (user.mp - beforeMp > 0) lines.push('- MP +' + comma(user.mp - beforeMp));
    }

    user.field.nextActionAt = Date.now() + randomInt(2000, 3000);
    return lines.join('\n');
}

function useBasicAttackInField(user) {
    if (!user.field || !user.field.name) return '❌ 필드에 입장한 상태가 아닙니다.';
    const now = Date.now();
    if (now < Number(user.field.nextActionAt || 0)) return '❌ 아직 행동할 수 없습니다. (' + Math.ceil((user.field.nextActionAt - now) / 1000) + '초)';
    const dungeon = findDungeonByName(user.field.name);
    if (!dungeon) return '❌ 현재 필드를 찾을 수 없습니다.';
    const stats = calculateUserStats(user);
    const rawDamage = Math.round(Number(stats.atk || 0) * (randomInt(95, 105) / 100));
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
    const mpCost = Math.max(0, Math.round(Number(skillData.skill.mp_cost || 0) * (1 - Math.min(1, slotEffects.mpCostReduction))));
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
    const rawDamage = Math.round(Number(stats.atk || 0) * multiplier);
    user.field.skillCooldowns[skillData.skill.name] = now + Number(skillData.skill.cooltime || 0);
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
        const maxSlot = 3;
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
    const ordered = ['weapon', 'armor', 'accessory'];
    return all
        .map((entry, index) => Object.assign({ rawNumber: index + 1 }, entry))
        .sort((a, b) => ordered.indexOf(a.equip.type || a.type) - ordered.indexOf(b.equip.type || b.type) || a.rawNumber - b.rawNumber)[number - 1] || null;
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
    if (selected.source == 'equipped') return '❌ 장착 중인 장비는 강화할 수 없습니다.';
    const type = selected.equip.type || selected.type;
    if (type == 'accessory') return '❌ 장신구는 강화할 수 없습니다.';
    const equipment = getEquipmentData(type, selected.equip.id);
    if (!equipment) return '❌ 잘못된 장비 데이터입니다.';
    const level = Number(selected.equip.level || 0);
    if (level >= EQUIPMENT_UPGRADE_MAX) return '❌ 이미 최대 강화 단계입니다.';

    const nextLevel = level + 1;
    const currentStats = getEquipmentStatsAtLevel(equipment, level);
    const nextStats = getEquipmentStatsAtLevel(equipment, nextLevel);
    const statNames = { atk: '공격력', pnt: '방어 관통력', def: '방어력', hp: '체력', crit: '치명타 확률', critMul: '치명타 피해량' };
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
    if (selected.source == 'equipped') {
        user.pendingAction = null;
        return '❌ 장착 중인 장비는 강화할 수 없습니다.';
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
            user.inventory.equipment.splice(selected.index, 1);
        }
    }
    user.pendingAction = null;
    const messages = {
        great: '🌟 강화 대성공!!',
        success: '✨ 강화 성공!',
        down: '❌ 강화 실패..',
        destroy: '💥 장비가 파괴되었습니다.',
        blessedDown: '🛡️ 축복받은 장비 보호권으로 하락을 막았습니다.',
        blessedDestroy: '�️ 축복받은 장비 보호권으로 파괴를 막았습니다.',
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
    if (func.type == '체력회복') {
        const maxHp = Number(stats.hp || 0);
        const before = typeof user.hp == 'undefined' ? maxHp : Number(user.hp || 0);
        const amount = Number(func.amount || 0) * useCount;
        user.hp = Math.min(maxHp, before + amount);
        resultLines.push('- HP +' + comma(user.hp - before) + ' (' + comma(user.hp) + '/' + comma(maxHp) + ')');
        return;
    }
    if (func.type == '마나회복') {
        const maxMp = Number(stats.mp || 0);
        const before = typeof user.mp == 'undefined' ? maxMp : Number(user.mp || 0);
        const amount = Number(func.amount || 0) * useCount;
        user.mp = Math.min(maxMp, before + amount);
        resultLines.push('- MP +' + comma(user.mp - before) + ' (' + comma(user.mp) + '/' + comma(maxMp) + ')');
        return;
    }
    if (func.type == '체력회복%') {
        const maxHp = Number(stats.hp || 0);
        const before = typeof user.hp == 'undefined' ? maxHp : Number(user.hp || 0);
        const amount = Math.round(maxHp * Number(func.amount || 0)) * useCount;
        user.hp = Math.min(maxHp, before + amount);
        resultLines.push('- HP +' + comma(user.hp - before) + ' (' + comma(user.hp) + '/' + comma(maxHp) + ')');
        return;
    }
    if (func.type == '마나회복%') {
        const maxMp = Number(stats.mp || 0);
        const before = typeof user.mp == 'undefined' ? maxMp : Number(user.mp || 0);
        const amount = Math.round(maxMp * Number(func.amount || 0)) * useCount;
        user.mp = Math.min(maxMp, before + amount);
        resultLines.push('- MP +' + comma(user.mp - before) + ' (' + comma(user.mp) + '/' + comma(maxMp) + ')');
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
        this.pendingAction = null;
        this.maxCardLimit = 52;
        this.mail = [];
        this.usedCoupons = [];
    }

    load(data) {
        Object.assign(this, data);
        if (!Array.isArray(this.logged_in)) this.logged_in = [];
        if (!this.inventory) this.inventory = { card: [], item: [] };
        if (!Array.isArray(this.inventory.card)) this.inventory.card = [];
        if (!Array.isArray(this.inventory.item)) this.inventory.item = [];
        if (!Array.isArray(this.inventory.equipment)) this.inventory.equipment = [];
        cleanupInventoryItems(this);
        if (!Array.isArray(this.mail)) this.mail = [];
        if (!Array.isArray(this.usedCoupons)) this.usedCoupons = [];
        if (typeof this.isAdmin == 'undefined') this.isAdmin = false;
        if (!this.level) this.level = 1;
        if (!this.exp) this.exp = 0;
        if (typeof this.field == 'undefined') this.field = null;
        if (typeof this.mileage == 'undefined') this.mileage = 0;
        if (typeof this.pendingAction == 'undefined') this.pendingAction = null;
        if (typeof this.need_character_card_select == 'undefined') this.need_character_card_select = !this.main_card || typeof this.main_card.id == 'undefined';
        if (!this.maxCardLimit) this.maxCardLimit = 52;
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

async function onChat(data, channel) {
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
            await user.save();
            reply('✅ 캐릭터 카드를 선택했습니다: ' + characterCard.card.name);
        }
        return true;
    }

    const user = await getRPGUserById(senderId);
    if (!user) {
        reply('❌ 등록되지 않은 사용자입니다.\n/RPGenius 등록 [닉네임]');
        return true;
    }

    if (user.pendingAction && user.pendingAction.type == '캐릭터변환') {
        if (args[0] != '선택') {
            reply('❌ 캐릭터 변환할 카드를 먼저 선택해야 합니다.\n/RPGenius 선택 [카드번호]');
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

    if (args[0] == '내정보') {
        await sendUserMainCardImage(channel, user);
        reply(formatMyInfo(user));
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

module.exports = {
    TARGET_CHANNEL_IDS,
    RPGUser,
    getRPGUserById,
    getRPGUserByName,
    getRPGUserByCode,
    onChat
};