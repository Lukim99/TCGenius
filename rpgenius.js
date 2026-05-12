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
const SHOP_PATH = path.join(__dirname, 'DB', 'RPGenius', 'Shop.json');
const BASE_STAT_PATH = path.join(__dirname, 'DB', 'RPGenius', 'BaseStat.json');
const EXP_TABLE_PATH = path.join(__dirname, 'DB', 'RPGenius', 'ExpTable.json');
const CARD_IMAGE_PATH = path.join(__dirname, 'DB', 'RPGenius', 'cardImage');
const ITEM_TYPE_ORDER = ['가챠', '소모품', '티켓', '재료'];

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
    if (entry.type == '골드') return '🪙 ' + formatCount(entry.count);
    if (entry.type == '가넷') return '💠 ' + formatCount(entry.count);
    return entry.type || '알 수 없는 보상';
}

function formatPack(pack) {
    if (!Array.isArray(pack)) return '';
    return pack.map(entry => formatRoll(entry.roll) + ' [ ' + formatPackEntry(entry) + ' ]').join('\n');
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
        if (data) addStats(stats, data.stat);
    });
    const accessories = user.equipments && user.equipments.accessory || {};
    Object.keys(accessories).forEach(key => {
        const equip = accessories[key];
        const data = equip && getEquipmentData('accessory', equip.id);
        if (data) addStats(stats, data.stat);
    });
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

async function sendCharacterCardImage(channel, card) {
    const fileName = card.name + '1성.png';
    const filePath = path.join(CARD_IMAGE_PATH, fileName);
    if (!fs.existsSync(filePath)) return;
    await channel.sendMedia(node_kakao.KnownChatType.PHOTO, { name: fileName, data: fs.readFileSync(filePath), width: 300, height: 500, ext: 'png' });
}

function formatDescription(name) {
    const items = readJson(ITEMS_PATH, []);
    const packs = readJson(PACKS_PATH, []);

    const item = items.find(data => data.name == name);
    if (item) {
        const lines = ['《 ' + formatNameWithTrade(item) + ' 》 [' + item.type + ']', '- ' + item.desc];
        if (item.type == '가챠' && typeof item.pack == 'number' && packs[item.pack]) lines.push(VIEWMORE, formatPack(packs[item.pack]));
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
        '💵 ' + comma(user.point) + 'P'
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
    cards.forEach(card => {
        const data = characterCards[card.id];
        if (data) lines.push('[' + formatStar(card.star) + '] ' + card.type + ' ' + data.name);
    });
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
    return shopItem.type;
}

function formatPrice(price) {
    if (price.goods == 'gold') return '🪙 ' + comma(price.amount);
    if (price.goods == 'garnet') return '💠 ' + comma(price.amount);
    if (price.goods == 'point') return '💵 ' + comma(price.amount) + 'P';
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

const GOODS_FIELD = { gold: 'gold', garnet: 'garnet', point: 'point' };

function addInventoryItem(user, itemId, count) {
    if (!user.inventory) user.inventory = { card: [], item: [] };
    if (!Array.isArray(user.inventory.item)) user.inventory.item = [];
    const existing = user.inventory.item.find(inv => inv.id == itemId);
    if (existing) existing.count = Number(existing.count || 0) + count;
    else user.inventory.item.push({ id: itemId, count: count });
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

    if (shopItem.type == '아이템') {
        addInventoryItem(user, shopItem.item_id, Number(shopItem.count) * count);
    } else if (shopItem.type == '가넷') {
        user.garnet = Number(user.garnet || 0) + Number(shopItem.count) * count;
    } else if (shopItem.type == '골드') {
        user.gold = Number(user.gold || 0) + Number(shopItem.count) * count;
    } else {
        return '❌ 처리할 수 없는 상품입니다.';
    }

    await user.save();

    const rewardItem = { type: shopItem.type, item_id: shopItem.item_id, count: Number(shopItem.count) * count };
    return '✅ 구매 완료: ' + formatShopItem(rewardItem) + '\n- 사용: ' + formatPrice({ goods: shopItem.price.goods, amount: totalPrice });
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
        this.code = getRandomString(10).toUpperCase();
        this.logged_in = [id];
        this.main_card = {};
        this.need_character_card_select = true;
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
            item: []
        };
        this.gold = 0;
        this.garnet = 0;
        this.point = 0;
        this.total_point = 0;
        this.maxCardLimit = 52;
        this.mail = [];
    }

    load(data) {
        Object.assign(this, data);
        if (!Array.isArray(this.logged_in)) this.logged_in = [];
        if (!this.inventory) this.inventory = { card: [], item: [] };
        if (!Array.isArray(this.inventory.card)) this.inventory.card = [];
        if (!Array.isArray(this.inventory.item)) this.inventory.item = [];
        if (!Array.isArray(this.mail)) this.mail = [];
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
            user.inventory.card.push(userCard);
            user.need_character_card_select = false;
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

    if (user.need_character_card_select) {
        reply('❌ 먼저 캐릭터 카드를 선택해야 합니다.\n/RPGenius 캐릭터카드 선택 [캐릭터카드 이름]');
        reply(formatCharacterCardList());
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

    if (args[0] == '내정보') {
        reply(formatMyInfo(user));
        return true;
    }

    if (args[0] == '설명') {
        const name = cmd.substr(cmd.split(' ')[0].length + 1 + args[0].length + 1).trim();
        const description = formatDescription(name);
        const characterCard = findCharacterCardByName(name);
        if (description && characterCard) await sendCharacterCardImage(channel, characterCard.card);
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