const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, UpdateCommand, QueryCommand, GetCommand } = require('@aws-sdk/lib-dynamodb');
const node_kakao = require('node-kakao');
const fs = require('fs');
const path = require('path');

const TARGET_CHANNEL_IDS = ['442097040687921', '18470462260425659', "18483114949710565", "18483115447101144", "18483115484530406", "18483115510764240"];
const TABLE_NAME = 'rpgenius_user';
const DATA_TABLE_NAME = 'rpgenius_data';
const RPGENIUS_DATA_KEYS = ['Bundle', 'Coupon', 'Equipment', 'Item', 'Pack', 'Recipe', 'Shop', 'EliteState', 'Ices', 'Fashion', 'Auction', 'BuyOrder', 'Bait', 'ShopState', 'TradeLog', 'Patchnote', 'WorldBossState', 'VoteState', 'Pet'];
const VIEWMORE = '\u200e'.repeat(500);
const pendingChecks = {};
const CHARACTER_CARDS_PATH = path.join(__dirname, 'DB', 'RPGenius', 'CharacterCards.json');
const SKILLS_PATH = path.join(__dirname, 'DB', 'RPGenius', 'Skills.json');
const ITEMS_PATH = path.join(__dirname, 'DB', 'RPGenius', 'Item.json');
const EQUIPMENT_PATH = path.join(__dirname, 'DB', 'RPGenius', 'Equipment.json');
const POTENTIAL_PATH = path.join(__dirname, 'DB', 'RPGenius', 'Potential.json');
const PACKS_PATH = path.join(__dirname, 'DB', 'RPGenius', 'Pack.json');
const BUNDLE_PATH = path.join(__dirname, 'DB', 'RPGenius', 'Bundle.json');
const RECIPE_PATH = path.join(__dirname, 'DB', 'RPGenius', 'Recipe.json');
const SHOP_PATH = path.join(__dirname, 'DB', 'RPGenius', 'Shop.json');
const COUPON_PATH = path.join(__dirname, 'DB', 'RPGenius', 'Coupon.json');
const FASHION_PATH = path.join(__dirname, 'DB', 'RPGenius', 'Fashion.json');
const BAIT_PATH = path.join(__dirname, 'DB', 'RPGenius', 'Bait.json');
const BASE_STAT_PATH = path.join(__dirname, 'DB', 'RPGenius', 'BaseStat.json');
const EXP_TABLE_PATH = path.join(__dirname, 'DB', 'RPGenius', 'ExpTable.json');
const DUNGEON_PATH = path.join(__dirname, 'DB', 'RPGenius', 'Dungeon.json');
const EXTRA_SKILLS_PATH = path.join(__dirname, 'DB', 'RPGenius', 'ExtraSkills.json');
const WORLD_BOSS_PATH = path.join(__dirname, 'DB', 'RPGenius', 'WorldBoss.json');
const PETSET_PATH = path.join(__dirname, 'DB', 'RPGenius', 'PetSet.json');
const WORLD_BOSS_DAILY_LIMIT = 2;
const WORLD_BOSS_VALOR_TOKEN_NAME = '용맹의 증표';
const WORLD_BOSS_VALOR_TOKEN_DAILY_LIMIT = 3;
const WORLD_BOSS_FORCE_DEFEAT_MS = 3 * 24 * 60 * 60 * 1000;
const WORLD_BOSS_SKILL_INTERVAL = 7000;
const CARD_IMAGE_PATH = path.join(__dirname, 'DB', 'RPGenius', 'cardImage');
const ITEM_TYPE_ORDER = ['이벤트', '가챠', '번들', '사용', '소모품', '티켓', '미끼', '재료'];
const ELITE_KILL_REQUIREMENT = 100;
const GOLD_MINE_ORE_DROPS = {
    1: { name: '희미한 금광석', chance: 0.005 },
    2: { name: '저주받은 금광석', chance: 0.003 },
    3: { name: '찬란한 금광석', chance: 0.002 }
};
const BIG_LEVEL_DIFF_THRESHOLD = 30;
const BIG_LEVEL_DIFF_KILL_CAP = 50;
const GOLD_MINE_DAILY_KILL_LIMIT = 5000;
const FRAGMENT_TIERS = {
    low: {
        name: '하급 편린',
        chance: 0.005,
        minLevel: 1, maxLevel: 46,
        rewards: [
            { weight: 40, type: 'gold', amount: 10000 },
            { weight: 20, type: 'gold', amount: 20000 },
            { weight: 10, type: 'gold', amount: 50000 },
            { weight: 5,  type: 'gold', amount: 100000 },
            { weight: 5,  type: 'item', name: '5성 카드팩', count: 1 },
            { weight: 5,  type: 'item', name: '6성 카드팩', count: 1 },
            { weight: 15, type: 'item', name: '강화석', count: 1000 }
        ]
    },
    mid: {
        name: '중급 편린',
        chance: 0.003,
        minLevel: 51, maxLevel: 96,
        rewards: [
            { weight: 120,  type: 'gold', amount: 100000 },
            { weight: 50,  type: 'gold', amount: 200000 },
            { weight: 10,   type: 'gold', amount: 300000 },
            { weight: 2,   type: 'gold', amount: 500000 },
            { weight: 10,   type: 'item', name: '7성 카드팩', count: 1 },
            { weight: 2,   type: 'item', name: '8성 카드팩', count: 1 },
            { weight: 5, type: 'item', name: '지니어스의 열쇠', count: 10 },
            { weight: 1, type: 'item', name: '지니어스의 열쇠', count: 30 }
        ]
    },
    high: {
        name: '상급 편린',
        chance: 0.002,
        minLevel: 101, maxLevel: 146,
        rewards: [
            { weight: 140,  type: 'gold', amount: 200000 },
            { weight: 20,  type: 'item', name: '강화석', count: 3000 },
            { weight: 20,  type: 'gold', amount: 400000 },
            { weight: 12,   type: 'item', name: '지니어스의 열쇠', count: 10 },
            { weight: 4,   type: 'gold', amount: 600000 },
            { weight: 2,   type: 'item', name: '지니어스의 열쇠', count: 30 },
            { weight: 2,   type: 'gold', amount: 1000000 },
            { weight: 3, type: 'item', name: '8성 카드팩', count: 1 },
            { weight: 1, type: 'item', name: '9성 카드팩', count: 1 }
        ]
    }
};
const ELITE_ENCOUNTER_RATE = 0.1;
const ELITE_RESPAWN_COOLDOWN = 60 * 60 * 1000;
const TAXATION_GUN_NAME = '징수의 총';
const TAXATION_GUN_EXECUTE_THRESHOLD = 0.05;
const ATTENDANCE_STAMP_ITEM_ID = 71;
const ICE_HAMMER_ITEM_ID = 74;
const ICE_SUMMON_REWARDS = {
    '소': { chance: 0.9, gold: 5000 },
    '중': { chance: 0.7, gold: 10000 },
    '대': { chance: 0.4, gold: 25000 },
    '특대': { chance: 0.25, gold: 50000 }
};
const eliteFieldStates = {};
const worldBossStates = {};
const worldBossSkillTimers = {};
const worldBossChannels = {};
const activeFieldChannels = {};
const fieldIktaeBotTimers = {};

function startFieldIktaeBot(userName) {
    clearFieldIktaeBot(userName);
    fieldIktaeBotTimers[userName] = setInterval(() => runFieldIktaeBotTick(userName).catch(e => console.error('[iktaebot tick]', e.message)), 4000);
}

function ensureFieldIktaeBotTimer(user, channel) {
    if (!user || !user.field || !user.field.iktaeBot) return;
    if (channel) activeFieldChannels[user.name] = channel;
    if (fieldIktaeBotTimers[user.name]) return;
    startFieldIktaeBot(user.name);
}

function clearFieldIktaeBot(userName) {
    if (fieldIktaeBotTimers[userName]) {
        clearInterval(fieldIktaeBotTimers[userName]);
        delete fieldIktaeBotTimers[userName];
    }
}

async function runFieldIktaeBotTick(userName) {
    const user = await getRPGUserByName(userName);
    if (!user || !user.field || !user.field.iktaeBot) { clearFieldIktaeBot(userName); return; }
    if (Date.now() > user.field.iktaeBot.expired_at || user.field.iktaeBot.hp <= 0) {
        user.field.iktaeBot = null;
        clearFieldIktaeBot(userName);
        await user.save();
        return;
    }
    const context = getFieldCombatContext(user);
    if (context.error) return;
    const stats = calculateUserStats(user);
    const botDamage = Math.max(1, Math.round(Number(stats.atk || 0) * user.field.iktaeBot.atkMul));
    const extra = { isSkill: true, isBotAutoAttack: true };
    const lines = [];
    if (context.type == 'worldBoss') {
        const result = dealDamageToWorldBoss(user, context.boss, botDamage, extra);
        lines.push('🤖 익테봇 자동 공격! ' + context.boss.name + '에게 ' + comma(result.damage) + ' 피해를 입혔습니다!');
        if (Number(result.after) <= 0) await finalizeWorldBossDefeat(user, context.boss, lines);
    } else if (context.type == 'elite') {
        const result = buildEliteHuntResult(user, context.dungeon, botDamage, extra);
        lines.push(result);
    } else {
        const result = buildHuntResult(user, context.dungeon, botDamage, extra);
        lines.push(result);
    }
    await user.save();
    const channel = activeFieldChannels[userName] || worldBossChannels[userName];
    if (channel && lines.length > 0) channel.sendChat(lines.join('\n'));
}
const commandQueues = {};
const petShortcutCache = {};
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

const rpgeniusDataCache = {};
let rpgeniusDataLoadPromise = null;

async function loadRpgeniusDataEntry(key) {
    const res = await docClient.send(new GetCommand({ TableName: DATA_TABLE_NAME, Key: { key: key } }));
    if (res && res.Item && typeof res.Item.data != 'undefined') {
        rpgeniusDataCache[key] = res.Item.data;
        return true;
    }
    return false;
}

async function saveRpgeniusDataEntry(key, data) {
    if (!RPGENIUS_DATA_KEYS.includes(key)) throw new Error('허용되지 않은 키: ' + key);
    await docClient.send(new PutCommand({ TableName: DATA_TABLE_NAME, Item: { key: key, data: data } }));
    rpgeniusDataCache[key] = data;
    return true;
}

async function initRpgeniusData() {
    if (rpgeniusDataLoadPromise) return rpgeniusDataLoadPromise;
    rpgeniusDataLoadPromise = (async () => {
        for (const key of RPGENIUS_DATA_KEYS) {
            try {
                const ok = await loadRpgeniusDataEntry(key);
                if (!ok) console.warn('[rpgenius_data] ' + key + ' × 데이터 없음');
            } catch (e) {
                console.error('[rpgenius_data] ' + key + ' 로드 실패: ' + e.message);
            }
        }
        const cachedEliteState = rpgeniusDataCache.EliteState;
        if (cachedEliteState && typeof cachedEliteState == 'object') {
            Object.keys(cachedEliteState).forEach(k => { eliteFieldStates[k] = cachedEliteState[k]; });
        }
        const cachedWorldBossState = rpgeniusDataCache.WorldBossState;
        if (cachedWorldBossState && typeof cachedWorldBossState == 'object') {
            Object.keys(cachedWorldBossState).forEach(k => { worldBossStates[k] = cachedWorldBossState[k]; });
        }
        console.log('[rpgenius_data] 데이터 로드 완료 (' + Object.keys(rpgeniusDataCache).length + '/' + RPGENIUS_DATA_KEYS.length + ')');
    })();
    return rpgeniusDataLoadPromise;
}

function getDataCache(key, fallback) {
    if (typeof rpgeniusDataCache[key] != 'undefined') return rpgeniusDataCache[key];
    return fallback;
}

initRpgeniusData();

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

function clonePlain(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
}

function formatValue(format) {
    const value = Number(format && format.base || 0);
    if (format && format.type == 'flat') return value.toString();
    return Math.round(value * 1000) / 10 + '%';
}

function formatCurrentValue(format, star) {
    const value = Number(format && format.base || 0) + Number(format && format.per_star || 0) * Number(star || 0);
    if (format && format.type == 'flat') return value.toString();
    return Math.round(value * 1000) / 10 + '%';
}

function formatIncreaseValue(format) {
    const value = Number(format && (format.per_star || format.per_level) || 0);
    if (format && format.type == 'flat') return value.toString();
    return Math.round(value * 1000) / 10 + '%';
}

function formatIncreaseText(format) {
    const value = Number(format && (format.per_star || format.per_level) || 0);
    const text = formatIncreaseValue(format);
    return value > 0 ? '+' + text : text;
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
        return formatValue(format) + '(' + formatIncreaseText(format) + ')';
    });
}

function formatCurrentSkillDesc(skill, star) {
    if (!skill) return '알 수 없는 스킬입니다.';
    return skill.desc.replace(/\$\{(\d+)\}/g, (match, index) => {
        const format = skill.format && skill.format[Number(index) - 1];
        return formatCurrentValue(format, star);
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

const KOREAN_BIG_UNITS = ['', '만', '억', '조', '경', '해', '자', '양', '구', '간', '정', '재', '극'];

function comma(value) {
    const n = Number(value || 0);
    if (!Number.isFinite(n)) return String(value);
    const abs = Math.abs(n);
    if (abs < 1_000_000_000) return n.toLocaleString('ko-KR');
    const sign = n < 0 ? '-' : '';
    const groups = [];
    let remaining = Math.trunc(abs);
    while (remaining > 0) {
        groups.push(remaining % 10000);
        remaining = Math.floor(remaining / 10000);
    }
    let topIndex = groups.length - 1;
    while (topIndex > 0 && groups[topIndex] === 0) topIndex--;
    const parts = [];
    parts.push(String(groups[topIndex]) + KOREAN_BIG_UNITS[topIndex]);
    if (topIndex > 0 && groups[topIndex - 1] > 0) {
        parts.push(String(groups[topIndex - 1]) + KOREAN_BIG_UNITS[topIndex - 1]);
    }
    return sign + parts.join(' ');
}

function formatRoll(value) {
    const percent = Number(value || 0) * 100;
    return (Number.isInteger(percent) ? percent : percent.toFixed(4).replace(/0+$/, '').replace(/\.$/, '')) + '%';
}

function formatCount(count) {
    if (!count) return 'x1';
    if (typeof count != 'object') return 'x' + comma(Number(count));
    const min = Number(count.min || 0);
    const max = Number(count.max || 0);
    if (min == max) return 'x' + comma(min);
    return 'x' + comma(min) + '~' + comma(max);
}

function getCharacterCardRewardId(entry) {
    if (entry.card_id != null) return Number(entry.card_id);
    if (entry.character_card_id != null) return Number(entry.character_card_id);
    if (entry.id != null) return Number(entry.id);
    return -1;
}

function getCharacterCardRewardStar(entry) {
    if (entry.display_star != null) return Math.max(0, Number(entry.display_star) - 1);
    if (entry.star_display != null) return Math.max(0, Number(entry.star_display) - 1);
    if (entry.star && typeof entry.star == 'object') return Math.max(0, rollCount(entry.star) - 1);
    if (entry.range && typeof entry.range == 'object') return Math.max(0, randomInt(Number(entry.range.min || 1), Number(entry.range.max || entry.range.min || 1)) - 1);
    return Math.max(0, Number(entry.star || 0));
}

function buildCharacterCardReward(entry) {
    const characterCards = readJson(CHARACTER_CARDS_PATH, []);
    let id = getCharacterCardRewardId(entry);
    if (!Number.isInteger(id) || id < 0) id = randomInt(0, characterCards.length - 1);
    if (!characterCards[id]) return null;
    const card = {
        id,
        star: getCharacterCardRewardStar(entry),
        type: entry.card_type || entry.cardType || '일반'
    };
    if (entry.skin) card.skin = String(entry.skin);
    return card;
}

function formatStatValue(key, value) {
    const number = Number(value || 0);
    const sign = number > 0 ? '+' : '';
    if (key == 'skillCooldown') return sign + (Math.round(number / 100) / 10) + '초';
    if ([
        'crit', 'critMul', 'critDef', 'cmb',
        'atk%', 'def%', 'hp%', 'mp%', 'pnt%', 'crit%', 'critMul%', 'critDef%', 'cmb%',
        'gold%', 'potion%', 'afterBasic%', 'avd%', 'afterSkill%', '000%',
        'exp%', 'eliteDmg%', 'mpReduce%', 'itemDropChance%', 'recoveryEfficiency%',
        'takenDamage%', 'damageBonus%', 'finalDamage%', 'bossDmg%', 'summonDuration%'
    ].includes(key)) return sign + (Math.round(number * 1000) / 10) + '%';
    return sign + comma(number);
}

function formatPlusStatValue(key, value) {
    if (key == 'skillCooldown' || key == 'maxCmb' || key == 'skillTrueDmg') return formatStatValue(key, value);
    return formatStatValue(key + '%', value);
}

function formatPackEntry(entry) {
    const items = getDataCache('Item', []);
    const equipments = getDataCache('Equipment', {});
    const characterCards = readJson(CHARACTER_CARDS_PATH, []);
    if (entry.type == '아이템') {
        const item = items[entry.item_id];
        return item ? item.name + ' ' + formatCount(entry.count) : '알 수 없는 아이템';
    }
    if (entry.type == '캐릭터카드') {
        const card = buildCharacterCardReward(entry);
        if (!card) return '알 수 없는 캐릭터카드';
        const data = characterCards[card.id];
        return (data ? data.name : '알 수 없는 캐릭터카드') + ' ' + formatStar(card.star) + ' ' + formatCount(entry.count);
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
    if (entry.type == '보조' || entry.type == '보조무기') {
        const support = equipments.support && equipments.support[entry.support_id];
        return support ? '<' + support.rarity + '> ' + support.name : '알 수 없는 보조 장비';
    }
    if (entry.type == '펫') {
        if (typeof entry.pet_id != 'undefined') {
            const pet = getPetData(entry.pet_id);
            return pet ? '<' + pet.rarity + '> ' + pet.name + ' (펫)' : '알 수 없는 펫';
        }
        return '<' + (entry.rarity || '?') + '> 랜덤 펫';
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
        lines.push(' ㄴ 5성 이후 등급마다 ' + formatIncreaseText(card.slot_effect));
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
        plusGold: '처치 당 골드',
        crit: '치명타 확률',
        critMul: '치명타 피해량',
        critDef: '치명타 피해 감소율',
        cmb: '연격 확률',
        maxCmb: '추가 공격 횟수',
        skillCooldown: '스킬 쿨타임',
        skillTrueDmg: '스킬 사용 시 추가 고정 피해',
        cardStarAtk: '카드 1성당 공격력',
        attackHpRecovery: '공격 시 10% 확률로 HP 회복',
        attackMpRecovery: '공격 시 10% 확률로 MP 회복',
        level9Atk: '레벨 9당 공격력'
    };
    const plusStatNames = {
        atk: '최종 공격력',
        def: '최종 방어력',
        hp: '최종 체력',
        mp: '최종 MP',
        pnt: '방어력 관통',
        gold: '골드 획득량',
        potion: '물약 효율',
        afterBasic: '일반 공격 피해',
        avd: '회피 확률',
        afterSkill: '스킬 공격 피해',
        '000': '공격 시 10/100/1000 추가 피해 확률',
        exp: '경험치 획득량',
        eliteDmg: '엘리트 몬스터 대상 추가 피해',
        mpReduce: 'MP 소모량',
        itemDropChance: '아이템 획득 확률',
        recoveryEfficiency: '회복 효율',
        crit: '치명타 확률',
        critMul: '치명타 피해량',
        critDef: '치명타 피해 감소율',
        cmb: '연격 확률',
        maxCmb: '추가 공격 횟수',
        skillCooldown: '스킬 쿨타임',
        skillTrueDmg: '스킬 사용 시 추가 고정 피해',
        takenDamage: '받는 피해 증가',
        damageBonus: '일반 몬스터에게 주는 피해 증가',
        finalDamage: '최종 피해',
        bossDmg: '보스 몬스터에게 주는 피해 증가',
        summonDuration: '소환 지속시간'
    };
    const lines = [];
    Object.keys(statNames).forEach(key => {
        if (equipment.stat && typeof equipment.stat[key] != 'undefined') lines.push('- ' + statNames[key] + ' ' + formatStatValue(key, equipment.stat[key]));
    });
    Object.keys(plusStatNames).forEach(key => {
        if (equipment.plusStat && typeof equipment.plusStat[key] != 'undefined') lines.push('- ' + plusStatNames[key] + ' ' + formatPlusStatValue(key, equipment.plusStat[key]));
    });
    if (typeof equipment.requireLevel != 'undefined') lines.push('- 장착 필요 레벨: Lv. ' + Number(equipment.requireLevel));
    if (typeof equipment.underLevel != 'undefined') lines.push('- 장착 가능 최대 레벨: Lv. ' + Number(equipment.underLevel));
    if (typeof equipment.exactlyStar != 'undefined') lines.push('- 효과 적용 조건: 메인 캐릭터 카드 ' + (Number(equipment.exactlyStar) + 1) + '성');
    if (Array.isArray(equipment.require) && equipment.require.length > 0) {
        const equipments = getDataCache('Equipment', {});
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

function formatEquipmentBaseStatLines(equipment, level) {
    if (!equipment) return '';
    const lvl = Number(level || 0);
    const stat = getEquipmentStatsAtLevel(equipment, lvl);
    const plusStat = getEquipmentPlusStatsAtLevel(equipment, lvl);
    const rangeStat = getEquipmentStatRangeAtLevel(equipment, lvl);
    const rangePlus = getEquipmentPlusStatRangeAtLevel(equipment, lvl);
    const statKeys = Object.keys(SUPPORT_STAT_LABELS_OR_FALLBACK());
    const plusKeys = Object.keys(SUPPORT_PLUS_STAT_LABELS_OR_FALLBACK());
    const lines = [];
    statKeys.forEach(key => {
        const hasBase = stat && typeof stat[key] != 'undefined';
        const range = Number(rangeStat[key] || 0);
        if (!hasBase && range == 0) return;
        const base = Number(stat[key] || 0);
        const label = SUPPORT_STAT_LABELS[key] || key;
        if (range > 0) lines.push('- ' + label + ' ' + formatStatValue(key, base) + ' ~ ' + formatStatValue(key, base + range));
        else lines.push('- ' + label + ' ' + formatStatValue(key, base));
    });
    plusKeys.forEach(key => {
        const hasBase = plusStat && typeof plusStat[key] != 'undefined';
        const range = Number(rangePlus[key] || 0);
        if (!hasBase && range == 0) return;
        const base = Number(plusStat[key] || 0);
        const label = SUPPORT_PLUS_STAT_LABELS[key] || key;
        if (range > 0) lines.push('- ' + label + ' ' + formatPlusStatValue(key, base) + ' ~ ' + formatPlusStatValue(key, base + range));
        else lines.push('- ' + label + ' ' + formatPlusStatValue(key, base));
    });
    if (typeof equipment.requireLevel != 'undefined') lines.push('- 장착 필요 레벨: Lv. ' + Number(equipment.requireLevel));
    if (typeof equipment.underLevel != 'undefined') lines.push('- 장착 가능 최대 레벨: Lv. ' + Number(equipment.underLevel));
    if (typeof equipment.exactlyStar != 'undefined') lines.push('- 효과 적용 조건: 메인 캐릭터 카드 ' + (Number(equipment.exactlyStar) + 1) + '성');
    if (Array.isArray(equipment.require) && equipment.require.length > 0) {
        const equipments = getDataCache('Equipment', {});
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
    if (Array.isArray(equipment.requireMainCard) && equipment.requireMainCard.length > 0) {
        const characterCards = readJson(CHARACTER_CARDS_PATH, []);
        const names = equipment.requireMainCard.map(id => {
            const card = characterCards[Number(id)];
            return card ? card.name : ('#' + id);
        });
        lines.push('- 장착 가능 메인 카드: ' + names.join(', '));
    }
    const dyn = getEquipmentDynamicBonusAtLevel(equipment, lvl);
    const stars = Object.keys(dyn).sort((a, b) => Number(a) - Number(b));
    stars.forEach(starKey => {
        const entry = dyn[starKey];
        const parts = [];
        Object.keys(entry.stat || {}).forEach(k => {
            if (Number(entry.stat[k] || 0) == 0) return;
            parts.push((SUPPORT_STAT_LABELS[k] || k) + ' ' + formatStatValue(k, entry.stat[k]));
        });
        Object.keys(entry.plusStat || {}).forEach(k => {
            if (Number(entry.plusStat[k] || 0) == 0) return;
            parts.push((SUPPORT_PLUS_STAT_LABELS[k] || k) + ' ' + formatPlusStatValue(k, entry.plusStat[k]));
        });
        if (parts.length == 0) return;
        lines.push('[ ' + (Number(starKey) + 1) + '성 보너스 ]');
        parts.forEach(p => lines.push('- ' + p));
    });
    return lines.join('\n');
}

// 라벨 맵을 늦은 시점에 참조하기 위한 헬퍼 (순환 참조 방지용)
function SUPPORT_STAT_LABELS_OR_FALLBACK() { return typeof SUPPORT_STAT_LABELS != 'undefined' ? SUPPORT_STAT_LABELS : {}; }
function SUPPORT_PLUS_STAT_LABELS_OR_FALLBACK() { return typeof SUPPORT_PLUS_STAT_LABELS != 'undefined' ? SUPPORT_PLUS_STAT_LABELS : {}; }

function getPotentialRarityLabel(rarity) {
    return { rare: '레어', epic: '에픽', unique: '유니크', legendary: '레전더리', bronze: '브론즈', silver: '실버', gold: '골드', platinum: '플레티넘' }[rarity] || rarity || '레어';
}

function getPotentialRarityKey(label) {
    return { '레어': 'rare', '에픽': 'epic', '유니크': 'unique', '레전더리': 'legendary', rare: 'rare', epic: 'epic', unique: 'unique', legendary: 'legendary' }[label] || 'rare';
}

const POTENTIAL_REROLL_COST = {
    weapon: { rare: 80000, epic: 200000, unique: 680000, legendary: 1400000 },
    armor: { rare: 60000, epic: 150000, unique: 520000, legendary: 1070000 },
    accessory: { rare: 70000, epic: 180000, unique: 600000, legendary: 1240000 },
    support: { rare: 80000, epic: 200000, unique: 680000, legendary: 1400000 }
};

const POTENTIAL_UPGRADE = {
    rare: { next: 'epic', rate: 0.02381, guarantee: 62 },
    epic: { next: 'unique', rate: 0.009804, guarantee: 152 },
    unique: { next: 'legendary', rate: 0.007, guarantee: 214 }
};
const POTENTIAL_JEWEL_ITEM_NAME = '쥬얼';
const POTENTIAL_WHITE_JEWEL_ITEM_NAME = '화이트 쥬얼';
const POTENTIAL_JEWEL_DISCOUNT = 0.3;
const POTENTIAL_WHITE_JEWEL_DISCOUNT = 0.6;

function addPotentialStats(stat, plusStat, potential) {
    (potential && Array.isArray(potential.option) ? potential.option : []).forEach(option => {
        addStats(stat, option && option.stat || {});
        addStats(plusStat, option && option.plusStat || {});
    });
}

function applyPotentialDerivedStats(stats, user) {
    if (Number(stats.cardStarAtk || 0) != 0) stats.atk = Number(stats.atk || 0) + Number(stats.cardStarAtk || 0) * (Number(user.main_card && user.main_card.star || 0) + 1);
    if (Number(stats.level9Atk || 0) != 0) stats.atk = Number(stats.atk || 0) + Number(stats.level9Atk || 0) * Math.floor(Number(user.level || 1) / 9);
}

function getPotentialData() {
    return readJson(POTENTIAL_PATH, {});
}

function pickPotentialGroup(type, rarity) {
    const data = getPotentialData();
    const table = data[type];
    const groups = table && Array.isArray(table[rarity]) ? table[rarity] : [];
    if (groups.length == 0) return null;
    const total = groups.reduce((sum, group) => sum + Number(group.rate || 0), 0);
    let roll = Math.random() * total;
    for (const group of groups) {
        roll -= Number(group.rate || 0);
        if (roll < 0) return group;
    }
    return groups[groups.length - 1];
}

function getPotentialOptionPoolKey(rarity, index) {
    const key = getPotentialRarityKey(rarity);
    if (key == 'rare') return 'bronze';
    if (key == 'epic') return index == 0 || Math.random() < 0.047 ? 'silver' : 'bronze';
    if (key == 'unique') return index == 0 || Math.random() < 0.019 ? 'gold' : 'silver';
    if (key == 'legendary') return index == 0 || Math.random() < 0.005 ? 'platinum' : 'gold';
    return 'bronze';
}

function rollPotentialOption(type, poolKey) {
    const group = pickPotentialGroup(type, poolKey);
    const rolls = Array.isArray(group && group.roll) ? group.roll : [];
    if (rolls.length == 0) return null;
    return clonePlain(rolls[randomInt(0, rolls.length - 1)]);
}

function rollEquipmentPotential(type, rarity) {
    const options = [];
    const tier = getPotentialRarityKey(rarity);
    for (let i = 0; i < 3; i++) {
        const poolKey = getPotentialOptionPoolKey(tier, i);
        const rolled = rollPotentialOption(type, poolKey);
        if (!rolled) return null;
        rolled.grade = poolKey;
        options.push(rolled);
    }
    return { rarity: getPotentialRarityLabel(tier), option: options, failCount: 0 };
}

function getPotentialDefaultGradeKey(rarity) {
    return { rare: 'bronze', epic: 'bronze', unique: 'silver', legendary: 'gold' }[getPotentialRarityKey(rarity)] || 'bronze';
}

function getPotentialGradeLabel(grade) {
    return { bronze: '브론즈', silver: '실버', gold: '골드', platinum: '플레티넘' }[grade] || '브론즈';
}

function formatPotentialOptionEntries(potential) {
    if (!potential || !Array.isArray(potential.option)) return [];
    const fallback = getPotentialDefaultGradeKey(potential.rarity);
    return potential.option.map(opt => {
        const text = formatEquipmentStatLines({ stat: opt && opt.stat || {}, plusStat: opt && opt.plusStat || {} });
        const lines = String(text || '').split('\n').filter(Boolean).map(l => l.replace(/^-\s*/, ''));
        const grade = (opt && opt.grade) || fallback;
        return { grade, gradeLabel: getPotentialGradeLabel(grade), text: lines.join(', ') };
    });
}

function getUpgradeTicketTargets(user, ugLevel) {
    return getAllUserEquipments(user)
        .map((entry, index) => {
            const type = entry.equip.type || entry.type;
            const equipment = getEquipmentData(type, entry.equip.id);
            if (!equipment) return null;
            const maxLevel = Array.isArray(equipment.upgrade) ? equipment.upgrade.length : 0;
            if (maxLevel < ugLevel) return null;
            if (Number(entry.equip.level || 0) >= ugLevel) return null;
            return { number: index + 1, entry, type, equipment };
        })
        .filter(Boolean);
}

function formatUpgradeTicketTargetList(targets, ugLevel) {
    const lines = ['[ +' + ugLevel + ' 강화 대상 ]', VIEWMORE];
    targets.forEach(target => {
        const lvl = Number(target.entry.equip.level || 0);
        const lockMark = target.entry.equip.locked ? ' 🔒' : '';
        const equippedMark = target.entry.source == 'equipped' ? ' (장착)' : '';
        lines.push('[' + target.number + '] <' + target.equipment.rarity + '> ' + getEquipmentDisplayName(target.equipment, target.entry.equip) + (lvl > 0 ? ' +' + lvl : '') + equippedMark + lockMark);
    });
    return lines.join('\n');
}

function applyUpgradeTicket(user, numberArg) {
    const pending = user.pendingAction;
    if (!pending || pending.type != '장비강화권') return '❌ 진행 중인 장비 강화권 사용이 없습니다.';
    const number = Number(numberArg);
    if (!Number.isInteger(number) || number < 1) return '❌ /RPGenius 선택 [장비번호]';
    const selected = getAllUserEquipments(user)[number - 1];
    if (!selected) return '❌ 존재하지 않는 장비 번호입니다.';
    const type = selected.equip.type || selected.type;
    const equipment = getEquipmentData(type, selected.equip.id);
    if (!equipment) return '❌ 잘못된 장비 데이터입니다.';
    const ugLevel = Number(pending.ugLevel || 0);
    const ugRoll = Number(pending.ugRoll || 0);
    const maxLevel = Array.isArray(equipment.upgrade) ? equipment.upgrade.length : 0;
    if (maxLevel < ugLevel) return '❌ +' + ugLevel + ' 강화가 불가능한 장비입니다.';
    if (Number(selected.equip.level || 0) >= ugLevel) return '❌ 이미 +' + ugLevel + ' 이상으로 강화된 장비입니다.';
    user.pendingAction = null;
    const beforeLevel = Number(selected.equip.level || 0);
    const success = Math.random() < ugRoll;
    const lines = ['[ +' + ugLevel + ' 장비 강화권 ]'];
    lines.push('- 대상: <' + equipment.rarity + '> ' + getEquipmentDisplayName(equipment, selected.equip) + (beforeLevel > 0 ? ' +' + beforeLevel : ''));
    lines.push('- 성공 확률: ' + (Math.round(ugRoll * 10000) / 100) + '%');
    if (success) {
        selected.equip.level = ugLevel;
        lines.push('✨ +' + ugLevel + ' 강화 성공!\n' + getEquipmentDisplayName(equipment, selected.equip) + ' +' + beforeLevel + ' -> +' + ugLevel);
    } else {
        lines.push('❌ +' + ugLevel + ' 강화 실패..');
    }
    return lines.join('\n');
}

function getSoulTargets(user) {
    return getAllUserEquipments(user)
        .map((entry, index) => {
            const type = entry.equip.type || entry.type;
            if (type != 'weapon' && type != 'armor') return null;
            if (entry.equip.soul && !isSoulExpired(entry.equip.soul)) return null;
            const equipment = getEquipmentData(type, entry.equip.id);
            if (!equipment) return null;
            return { number: index + 1, entry, type, equipment };
        })
        .filter(Boolean);
}

function formatSoulTargetList(targets) {
    const lines = ['[ 영혼 부여 대상 ]', VIEWMORE];
    targets.forEach(target => {
        const lvl = Number(target.entry.equip.level || 0);
        const lockMark = target.entry.equip.locked ? ' 🔒' : '';
        const equippedMark = target.entry.source == 'equipped' ? ' (장착)' : '';
        lines.push('[' + target.number + '] <' + target.equipment.rarity + '> ' + getEquipmentDisplayName(target.equipment, target.entry.equip) + (lvl > 0 ? ' +' + lvl : '') + equippedMark + lockMark);
    });
    return lines.join('\n');
}

function applySoulToEquipment(user, numberArg) {
    const pending = user.pendingAction;
    if (!pending || pending.type != '영혼부여') return '❌ 진행 중인 영혼석 사용이 없습니다.';
    const soulData = pending.soul;
    if (!soulData || typeof soulData != 'object') { user.pendingAction = null; return '❌ 영혼석 데이터가 잘못되었습니다.'; }
    const number = Number(numberArg);
    if (!Number.isInteger(number) || number < 1) return '❌ /RPGenius 선택 [장비번호]';
    const selected = getAllUserEquipments(user)[number - 1];
    if (!selected) return '❌ 존재하지 않는 장비 번호입니다.';
    const type = selected.equip.type || selected.type;
    if (type != 'weapon' && type != 'armor') return '❌ 영혼은 무기 또는 갑옷에만 부여할 수 있습니다.';
    const equipment = getEquipmentData(type, selected.equip.id);
    if (!equipment) return '❌ 잘못된 장비 데이터입니다.';
    if (selected.equip.soul && !isSoulExpired(selected.equip.soul)) return '❌ 이미 영혼이 깃든 장비입니다.';
    const slot = soulData[type];
    if (!slot || typeof slot != 'object') return '❌ 해당 장비 부위에 부여할 수 있는 영혼 정보가 없습니다.';
    const days = Number(soulData.date || 0);
    const expiresAt = days > 0 ? Date.now() + days * 86400000 : 0;
    selected.equip.soul = {
        name: soulData.name || '',
        expired_at: expiresAt,
        stat: Object.assign({}, slot.stat || {}),
        plusStat: Object.assign({}, slot.plusStat || {})
    };
    user.pendingAction = null;
    const lvl = Number(selected.equip.level || 0);
    const lines = ['✨ ' + (soulData.name || '') + '의 영혼이 깃들었습니다.'];
    lines.push('- 대상: <' + equipment.rarity + '> ' + getEquipmentDisplayName(equipment, selected.equip) + (lvl > 0 ? ' +' + lvl : ''));
    if (expiresAt > 0) lines.push('- 유지 기간: ' + days + '일 (만료: ' + new Date(expiresAt).toLocaleString('ko-KR') + ')');
    const soulStatText = formatEquipmentStatLines({ stat: slot.stat || {}, plusStat: slot.plusStat || {} });
    if (soulStatText) lines.push('', '[ 영혼 효과 ]', ...String(soulStatText).split('\n').filter(Boolean));
    return lines.join('\n');
}

function getPotentialAwakenTargets(user) {
    return getAllUserEquipments(user)
        .map((entry, index) => {
            const type = entry.equip.type || entry.type;
            const equipment = getEquipmentData(type, entry.equip.id);
            if (!equipment || entry.equip.potential) return null;
            if (!getPotentialData()[type]) return null;
            return { number: index + 1, entry, type, equipment };
        })
        .filter(Boolean);
}

function formatPotentialAwakenTargetList(targets) {
    const lines = ['[ 잠재능력 부여 대상 ]', VIEWMORE];
    targets.forEach(target => {
        const lvl = Number(target.entry.equip.level || 0);
        const lockMark = target.entry.equip.locked ? ' 🔒' : '';
        const equippedMark = target.entry.source == 'equipped' ? ' (장착)' : '';
        lines.push('[' + target.number + '] <' + target.equipment.rarity + '> ' + getEquipmentDisplayName(target.equipment, target.entry.equip) + (lvl > 0 ? ' +' + lvl : '') + equippedMark + lockMark);
    });
    return lines.join('\n');
}

function awakenEquipmentPotential(user, numberArg) {
    const pending = user.pendingAction;
    if (!pending || pending.type != '잠재능력부여') return '❌ 진행 중인 잠재능력 부여가 없습니다.';
    const number = Number(numberArg);
    if (!Number.isInteger(number) || number < 1) return '❌ /RPGenius 선택 [장비번호]';
    const selected = getAllUserEquipments(user)[number - 1];
    if (!selected) return '❌ 존재하지 않는 장비 번호입니다.';
    const type = selected.equip.type || selected.type;
    const equipment = getEquipmentData(type, selected.equip.id);
    if (!equipment) return '❌ 잘못된 장비 데이터입니다.';
    if (selected.equip.potential) return '❌ 이미 잠재능력이 부여된 장비입니다.';
    if (!getPotentialData()[type]) return '❌ 해당 장비 타입에는 잠재능력을 부여할 수 없습니다.';
    const potential = rollEquipmentPotential(type);
    if (!potential) return '❌ 잠재능력 데이터를 찾을 수 없습니다.';
    selected.equip.potential = potential;
    user.pendingAction = null;
    const lvl = Number(selected.equip.level || 0);
    return ['✅ 잠재능력을 부여했습니다.', '- <' + equipment.rarity + '> ' + getEquipmentDisplayName(equipment, selected.equip) + (lvl > 0 ? ' +' + lvl : ''), '', ...formatPotentialLines(potential)].join('\n');
}

function getPotentialRerollCost(type, rarity) {
    const tier = getPotentialRarityKey(rarity);
    return Number(POTENTIAL_REROLL_COST[type] && POTENTIAL_REROLL_COST[type][tier] || 0);
}

function getItemIdByName(name) {
    const items = getDataCache('Item', []);
    return items.findIndex(item => item && item.name == name);
}

function rerollEquipmentPotential(user, numberArg) {
    const number = Number(numberArg);
    if (!Number.isInteger(number) || number < 1) return '❌ /RPGenius 잠재능력 재설정 [장비번호]';
    const selected = getAllUserEquipments(user)[number - 1];
    if (!selected) return '❌ 존재하지 않는 장비 번호입니다.';
    const type = selected.equip.type || selected.type;
    const equipment = getEquipmentData(type, selected.equip.id);
    if (!equipment) return '❌ 잘못된 장비 데이터입니다.';
    if (!selected.equip.potential) return '❌ 잠재능력이 부여된 장비만 재설정할 수 있습니다.';
    if (!getPotentialData()[type]) return '❌ 해당 장비 타입에는 잠재능력을 재설정할 수 없습니다.';
    const currentTier = getPotentialRarityKey(selected.equip.potential.rarity);
    const baseCost = getPotentialRerollCost(type, currentTier);
    if (baseCost <= 0) return '❌ 잠재능력 재설정 비용 정보를 찾을 수 없습니다.';
    const whiteJewelItemId = getItemIdByName(POTENTIAL_WHITE_JEWEL_ITEM_NAME);
    const hasWhiteJewel = whiteJewelItemId != -1 && getInventoryItemCount(user, whiteJewelItemId) > 0;
    const jewelItemId = getItemIdByName(POTENTIAL_JEWEL_ITEM_NAME);
    const hasJewel = !hasWhiteJewel && jewelItemId != -1 && getInventoryItemCount(user, jewelItemId) > 0;
    const useJewel = hasWhiteJewel || hasJewel;
    const usedJewelItemId = hasWhiteJewel ? whiteJewelItemId : (hasJewel ? jewelItemId : -1);
    const usedJewelName = hasWhiteJewel ? POTENTIAL_WHITE_JEWEL_ITEM_NAME : POTENTIAL_JEWEL_ITEM_NAME;
    const discountRate = hasWhiteJewel ? POTENTIAL_WHITE_JEWEL_DISCOUNT : (hasJewel ? POTENTIAL_JEWEL_DISCOUNT : 0);
    const cost = Math.max(0, Math.floor(baseCost * (1 - discountRate)));
    if (Number(user.gold || 0) < cost) return '❌ 골드가 부족합니다.\n- 필요 골드: 🪙 ' + comma(cost) + '\n- 보유 골드: 🪙 ' + comma(user.gold || 0);

    user.gold = Number(user.gold || 0) - cost;
    if (useJewel && !removeInventoryItem(user, usedJewelItemId, 1)) {
        user.gold = Number(user.gold || 0) + cost;
        return '❌ ' + usedJewelName + ' 소모에 실패했습니다.';
    }
    let nextTier = currentTier;
    let upgraded = false;
    let guaranteed = false;
    const upgrade = POTENTIAL_UPGRADE[currentTier];
    const previousFailCount = Number(selected.equip.potential.failCount || 0);
    const jewelUpgradeBonus = useJewel && currentTier != 'unique';
    const failIncrement = jewelUpgradeBonus ? 2 : 1;
    if (upgrade) {
        guaranteed = previousFailCount + failIncrement >= Number(upgrade.guarantee || 0);
        upgraded = guaranteed || Math.random() < Number(upgrade.rate || 0) * (jewelUpgradeBonus ? 2 : 1);
        if (upgraded) nextTier = upgrade.next;
    }
    const potential = rollEquipmentPotential(type, nextTier);
    if (!potential) {
        user.gold = Number(user.gold || 0) + cost;
        if (useJewel) addInventoryItem(user, usedJewelItemId, 1);
        return '❌ 잠재능력 데이터를 찾을 수 없어 골드를 반환했습니다.';
    }
    selected.equip.potential.failCount = upgrade && !upgraded ? previousFailCount + failIncrement : 0;
    potential.failCount = selected.equip.potential.failCount;
    const oldPotential = JSON.parse(JSON.stringify(selected.equip.potential));
    user.pendingAction = {
        type: '잠재능력재설정확인',
        number: number,
        oldPotential: oldPotential,
        newPotential: potential,
        cost: cost,
        useJewel: useJewel,
        currentTier: currentTier,
        nextTier: nextTier,
        upgraded: upgraded,
        guaranteed: guaranteed
    };
    const lvl = Number(selected.equip.level || 0);
    const lines = [
        '[ 잠재능력 재설정 ]',
        '- <' + equipment.rarity + '> ' + getEquipmentDisplayName(equipment, selected.equip) + (lvl > 0 ? ' +' + lvl : ''),
        '- 소모 골드: 🪙 ' + comma(cost)
    ];
    if (useJewel) {
        const discountText = ' ㄴ 골드 소모 ' + Math.round(discountRate * 100) + '% 감소';
        lines.push('- ' + usedJewelName + ' x1 소모' + (jewelUpgradeBonus ? '\n' + discountText + '\n ㄴ 승급 확률/카운트 2배' : '\n' + discountText));
    }
    if (upgraded) lines.push('- 잠재능력 티어: ' + getPotentialRarityLabel(currentTier) + ' → ' + getPotentialRarityLabel(nextTier) + (guaranteed ? ' (확정)' : ''));
    else if (upgrade) lines.push('- 승급 확정까지: ' + comma(selected.equip.potential.failCount) + '/' + comma(upgrade.guarantee));
    lines.push('', '[ 이전 잠재능력 ]');
    formatPotentialLines(oldPotential).forEach(line => { if (! line.startsWith("[잠재능력]")) lines.push(line) });
    lines.push('', '[ 새로운 잠재능력 ]');
    formatPotentialLines(potential).forEach(line => { if (! line.startsWith("[잠재능력]")) lines.push(line) });
    lines.push('', '적용하시겠습니까?\n소모된 골드/' + usedJewelName + '은 반환되지 않습니다.\n');
    lines.push('/RPGenius 재설정확인');
    lines.push('/RPGenius 재설정포기');
    return lines.join('\n');
}

function confirmPotentialReroll(user) {
    const pending = user.pendingAction;
    if (!pending || pending.type != '잠재능력재설정확인') return '❌ 진행 중인 잠재능력 재설정이 없습니다.';
    const selected = getAllUserEquipments(user)[Number(pending.number) - 1];
    if (!selected) { user.pendingAction = null; return '❌ 대상 장비를 찾을 수 없습니다.'; }
    const equipment = getEquipmentData(selected.equip.type || selected.type, selected.equip.id);
    if (!equipment) { user.pendingAction = null; return '❌ 잘못된 장비 데이터입니다.'; }
    selected.equip.potential = pending.newPotential;
    const lvl = Number(selected.equip.level || 0);
    const lines = [
        '✅ 잠재능력을 재설정했습니다.',
        '- <' + equipment.rarity + '> ' + getEquipmentDisplayName(equipment, selected.equip) + (lvl > 0 ? ' +' + lvl : '')
    ];
    lines.push('', ...formatPotentialLines(pending.newPotential));
    user.pendingAction = null;
    return lines.join('\n');
}

function cancelPotentialReroll(user, force) {
    const pending = user.pendingAction;
    if (!pending || pending.type != '잠재능력재설정확인') return '❌ 진행 중인 잠재능력 재설정이 없습니다.';
    if (pending.upgraded && !force) {
        return [
            '❗ 잠재능력 티어가 승급합니다.',
            '- ' + getPotentialRarityLabel(pending.currentTier) + ' → ' + getPotentialRarityLabel(pending.nextTier) + (pending.guaranteed ? ' (확정)' : ''),
            '취소하면 이 승급도 함께 사라지며, 소모된 골드' + (pending.useJewel ? '/쥬얼은' : '는') + ' 반환되지 않습니다.',
            '',
            '정말 포기하시려면 아래 명령어를 입력해주세요.',
            '/RPGenius 재설정포기확정'
        ].join('\n');
    }
    user.pendingAction = null;
    return '✅ 잠재능력이 유지됩니다.';
}

function formatPotentialLines(potential) {
    if (!potential || !Array.isArray(potential.option) || potential.option.length == 0) return [];
    const lines = ['[잠재능력] ' + getPotentialRarityLabel(potential.rarity)];
    formatPotentialOptionEntries(potential).forEach(entry => {
        lines.push({'브론즈':'🟤','실버':'⚪','골드':'🟡','플레티넘':'🟢'}[entry.gradeLabel] + ' ' + entry.text);
    });
    return lines;
}

function formatCurrentEquipmentStatLines(equipment, level, rolled, context) {
    const stat = getEquipmentStatsAtLevel(equipment, level);
    const plusStat = getEquipmentPlusStatsAtLevel(equipment, level);
    const resolved = resolveRolledStats(equipment, level, rolled);
    addStats(stat, resolved.stat);
    addStats(plusStat, resolved.plusStat);
    addPotentialStats(stat, plusStat, context && context.potential);
    addSoulStats(stat, plusStat, context && context.soul);
    if (context && context.mainCardStar != null) {
        const dyn = getEquipmentDynamicBonusAtLevel(equipment, level);
        const entry = dyn[String(context.mainCardStar)];
        if (entry) {
            addStats(stat, entry.stat || {});
            addStats(plusStat, entry.plusStat || {});
        }
    }
    return formatEquipmentStatLines({ stat, plusStat });
}

function hasActiveSupportEquipment(user, name) {
    const support = user.equipments && user.equipments.support;
    if (!support || typeof support.id == 'undefined') return false;
    const data = getEquipmentData('support', support.id);
    return !!(data && data.name == name && isEquipmentEffectActive(user, data));
}

function findEquipmentByName(name) {
    const equipments = getDataCache('Equipment', {});
    const types = [
        { key: 'weapon', name: '무기' },
        { key: 'armor', name: '갑옷' },
        { key: 'accessory', name: '장신구' },
        { key: 'support', name: '보조' }
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

function getFashionData() {
    const cached = getDataCache('Fashion', null);
    return Array.isArray(cached) ? cached : readJson(FASHION_PATH, []);
}

function getCardFashion(card) {
    if (!card || typeof card.skin != 'string' || !card.skin.trim()) return null;
    const skin = card.skin.trim();
    return getFashionData().find(fashion => fashion && fashion.name == skin && (fashion.primary_card || []).map(id => Number(id)).includes(Number(card.id))) || null;
}

function pickFashionForCard(cardId) {
    const candidates = getFashionData().filter(fashion => fashion && fashion.isHigh !== true && (fashion.primary_card || []).map(id => Number(id)).includes(Number(cardId)));
    return candidates.length > 0 ? candidates[randomInt(0, candidates.length - 1)] : null;
}

function pickRandomFashionCard() {
    const candidates = getFashionData().filter(fashion => fashion && fashion.isHigh !== true && Array.isArray(fashion.primary_card) && fashion.primary_card.length > 0);
    if (candidates.length == 0) return null;
    const fashion = candidates[randomInt(0, candidates.length - 1)];
    const primaryCards = fashion.primary_card.map(id => Number(id)).filter(id => Number.isInteger(id) && id >= 0);
    if (primaryCards.length == 0) return null;
    return { fashion, id: primaryCards[randomInt(0, primaryCards.length - 1)] };
}

function applyFashionRollToCard(card, fixedCardId) {
    if (!card || Math.random() >= 0.1) return;
    const picked = fixedCardId != null ? { fashion: pickFashionForCard(fixedCardId), id: fixedCardId } : pickRandomFashionCard();
    if (!picked || !picked.fashion) return;
    card.id = picked.id;
    if (Number(card.star || 0) >= Number(picked.fashion.requireStar || 0)) card.skin = picked.fashion.name;
}

function applyPackSkinToCard(card, skinName) {
    const skin = typeof skinName == 'string' ? skinName.trim() : '';
    if (!card || !skin) return;
    const fashion = getFashionData().find(data => data && data.name == skin && Array.isArray(data.primary_card) && data.primary_card.length > 0);
    if (!fashion) return;
    const primaryCards = fashion.primary_card.map(id => Number(id)).filter(id => Number.isInteger(id) && id >= 0);
    if (primaryCards.length == 0) return;
    card.id = primaryCards[randomInt(0, primaryCards.length - 1)];
    if (Number(card.star || 0) >= Number(fashion.requireStar || 0)) card.skin = fashion.name;
}

function getApplicableFashionsForCard(card, highOnly) {
    if (!card || typeof card.id == 'undefined' || (typeof card.skin == 'string' && card.skin.trim())) return [];
    if (Number(card.star || 0) < 6) return [];
    return getFashionData().filter(fashion => {
        if (!fashion || !Array.isArray(fashion.primary_card)) return false;
        if (!!fashion.isHigh !== !!highOnly) return false;
        if (!fashion.primary_card.map(id => Number(id)).includes(Number(card.id))) return false;
        return Number(card.star || 0) >= Number(fashion.requireStar || 0);
    });
}

function getFashionApplyTargets(user, highOnly) {
    const cards = user.inventory && Array.isArray(user.inventory.card) ? user.inventory.card : [];
    return cards
        .map((card, index) => ({ number: index + 1, card, fashions: getApplicableFashionsForCard(card, highOnly) }))
        .filter(entry => entry.fashions.length > 0);
}

function formatFashionApplyTargetList(user, highOnly) {
    const targets = getFashionApplyTargets(user, highOnly);
    const lines = [highOnly ? '[ 고급 패션 적용 대상 ]' : '[ 패션 적용 대상 ]', VIEWMORE];
    targets.forEach(target => {
        lines.push('[' + target.number + '] ' + formatUserCard(target.card) + ' → ' + target.fashions.map(fashion => fashion.name).join(', '));
    });
    return lines.join('\n');
}

function applyFashionStoneToCard(user, numberArg) {
    const pending = user.pendingAction;
    if (!pending || pending.type != '패션적용') return '❌ 진행 중인 패션 적용이 없습니다.';
    const number = Number(numberArg);
    const cards = user.inventory && Array.isArray(user.inventory.card) ? user.inventory.card : [];
    if (!Number.isInteger(number) || number < 1 || number > cards.length) return '❌ 존재하지 않는 카드 번호입니다.';
    const card = cards[number - 1];
    const fashions = getApplicableFashionsForCard(card, pending.highOnly);
    if (fashions.length == 0) return '❌ 해당 카드에 적용 가능한 패션이 없습니다.\n/RPGenius 선택 [카드번호]\n/RPGenius 사용취소';
    const before = Object.assign({}, card);
    const fashion = fashions[randomInt(0, fashions.length - 1)];
    card.skin = fashion.name;
    user.pendingAction = null;
    return '✅ 패션을 적용했습니다.\n- 대상: ' + formatUserCard(before) + '\n- 적용: ' + fashion.name + '\n- 결과: ' + formatUserCard(card);
}

function formatUserCard(card) {
    const characterCards = readJson(CHARACTER_CARDS_PATH, []);
    if (!card || typeof card.id == 'undefined') return '없음';
    const data = characterCards[card.id];
    if (!data) return '없음';
    const fashion = getCardFashion(card);
    const typeText = card.type && card.type != '일반' ? card.type + ' ' : '';
    return '[' + formatStar(card.star) + '] ' + typeText + (fashion ? fashion.name + ' ' : '') + data.name;
}

function getEquipmentData(type, id) {
    const equipments = getDataCache('Equipment', {});
    const list = equipments[type] || [];
    return list[id];
}

function isSoulExpired(soul) {
    return !!(soul && soul.expired_at && Date.now() >= Number(soul.expired_at));
}

function formatSoulRemainingText(soul) {
    if (!soul || !soul.expired_at || isSoulExpired(soul)) return null;
    const diff = Number(soul.expired_at) - Date.now();
    let value, unit;
    if (diff >= 86400000) { value = Math.floor(diff / 86400000); unit = '일'; }
    else if (diff >= 3600000) { value = Math.floor(diff / 3600000); unit = '시간'; }
    else if (diff >= 60000) { value = Math.floor(diff / 60000); unit = '분'; }
    else if (diff >= 1000) { value = Math.floor(diff / 1000); unit = '초'; }
    else return null;
    return '영혼이 ' + value + unit + ' 후 빠져나갑니다.';
}

function getEquipmentDisplayName(data, equip) {
    const baseName = (data && data.name) || '';
    const soul = equip && equip.soul;
    if (soul && !isSoulExpired(soul) && soul.name) return soul.name + '의 ' + baseName;
    return baseName;
}

function addSoulStats(stat, plusStat, soul) {
    if (!soul || isSoulExpired(soul)) return;
    addStats(stat, soul.stat || {});
    addStats(plusStat, soul.plusStat || {});
}

function cleanupExpiredSouls(user) {
    let changed = false;
    const strip = equip => {
        if (equip && equip.soul && isSoulExpired(equip.soul)) {
            delete equip.soul;
            changed = true;
        }
    };
    (user && user.inventory && Array.isArray(user.inventory.equipment) ? user.inventory.equipment : []).forEach(strip);
    if (user && user.equipments) {
        strip(user.equipments.weapon);
        strip(user.equipments.armor);
        strip(user.equipments.support);
        const accessories = user.equipments.accessory || {};
        Object.keys(accessories).forEach(key => strip(accessories[key]));
    }
    return changed;
}

function formatEquippedEquipment(label, type, equip) {
    if (!equip || typeof equip.id == 'undefined') return '[' + label + '] 없음';
    const data = getEquipmentData(type, equip.id);
    if (!data) return '[' + label + '] 없음';
    const level = Number(equip.level || 0);
    return '[' + label + '] <' + data.rarity + '> ' + getEquipmentDisplayName(data, equip) + (level > 0 ? ' +' + level : '');
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

const SUPPORT_PERCENT_STATS = new Set(['crit', 'critMul', 'critDef', 'cmb']);

function getEquipmentStatRangeAtLevel(equipment, level) {
    const result = Object.assign({}, equipment && equipment.statRange || {});
    const max = Math.min(Number(level || 0), Array.isArray(equipment && equipment.upgrade) ? equipment.upgrade.length : 0);
    for (let i = 0; i < max; i++) addStats(result, equipment.upgrade[i].statRange || {});
    return result;
}

function getEquipmentPlusStatRangeAtLevel(equipment, level) {
    const result = Object.assign({}, equipment && equipment.plusStatRange || {});
    const max = Math.min(Number(level || 0), Array.isArray(equipment && equipment.upgrade) ? equipment.upgrade.length : 0);
    for (let i = 0; i < max; i++) addStats(result, equipment.upgrade[i].plusStatRange || {});
    return result;
}

function normalizeMainCardStarEntry(entry) {
    if (entry == null) return { stat: {}, plusStat: {} };
    if (typeof entry == 'number') return { stat: {}, plusStat: { atk: Number(entry) || 0 } };
    return { stat: Object.assign({}, entry.stat || {}), plusStat: Object.assign({}, entry.plusStat || {}) };
}

function getEquipmentDynamicBonusAtLevel(equipment, level) {
    const result = {};
    const merge = (src) => {
        Object.keys(src || {}).forEach(starKey => {
            const norm = normalizeMainCardStarEntry(src[starKey]);
            if (!result[starKey]) result[starKey] = { stat: {}, plusStat: {} };
            addStats(result[starKey].stat, norm.stat);
            addStats(result[starKey].plusStat, norm.plusStat);
        });
    };
    merge(equipment && equipment.dynamicBonus && equipment.dynamicBonus.mainCardStar);
    const max = Math.min(Number(level || 0), Array.isArray(equipment && equipment.upgrade) ? equipment.upgrade.length : 0);
    for (let i = 0; i < max; i++) {
        merge(equipment.upgrade[i].dynamicBonus && equipment.upgrade[i].dynamicBonus.mainCardStar);
    }
    return result;
}

function resolveRolledStats(equipment, level, rolled) {
    const result = { stat: {}, plusStat: {} };
    if (!rolled) return result;
    const rangeStat = getEquipmentStatRangeAtLevel(equipment, level);
    const rangePlus = getEquipmentPlusStatRangeAtLevel(equipment, level);
    Object.keys(rolled.stat || {}).forEach(key => {
        const ratio = Math.min(1, Math.max(0, Number(rolled.stat[key] || 0)));
        const range = Number(rangeStat[key] || 0);
        if (SUPPORT_PERCENT_STATS.has(key)) result.stat[key] = Math.round(ratio * range * 10000) / 10000;
        else result.stat[key] = Math.round(ratio * range);
    });
    Object.keys(rolled.plusStat || {}).forEach(key => {
        const ratio = Math.min(1, Math.max(0, Number(rolled.plusStat[key] || 0)));
        const range = Number(rangePlus[key] || 0);
        result.plusStat[key] = Math.round(ratio * range * 10000) / 10000;
    });
    return result;
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
    if (Array.isArray(data.requireMainCard) && data.requireMainCard.length > 0) {
        const mainId = user.main_card && typeof user.main_card.id != 'undefined' ? Number(user.main_card.id) : null;
        if (mainId == null || !data.requireMainCard.map(Number).includes(mainId)) return false;
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
        defReduction: 0,
        basicDamageBonus: 0,
        skillDamageBonus: 0
    };
    (user.card_slot || []).forEach(card => {
        const cardData = characterCards[card.id];
        const value = getCardSlotEffectValue(card, cardData);
        if (value == 0) return;
        if (cardData.name == '빵귤') effects.expBonus += value;
        if (cardData.name == '뭔마') effects.hpDamageReduction += Math.abs(value);
        if (cardData.name == '글렌첵') effects.killRecoveryChance += value;
        if (cardData.name == '오버라이드') effects.crit += value;
        if (cardData.name == '일레이나') effects.mpCostReduction += Math.abs(value);
        if (cardData.name == '진필규') effects.damageBonus += value;
        if (cardData.name == '켄시') effects.critMul += value;
        if (cardData.name == '제우스') effects.goldBonus += value;
        if (cardData.name == '타이란트') effects.itemDropChance += value;
        if (cardData.name == '마쉐비') effects.defReduction += value;
        if (cardData.name == '딜러장') effects.basicDamageBonus += value;
        if (cardData.name == '이익태') effects.skillDamageBonus += value;
    });
    return effects;
}

function formatCardSlotEffectLines(user) {
    const slotEffects = calculateCardSlotEffects(user);
    const effectMap = [
        ['expBonus', '경험치 획득 증가량'],
        ['hpDamageReduction', '받는 피해량 감소'],
        ['killRecoveryChance', '받은 피해의 20%만큼 체력 회복 확률'],
        ['crit', '치명타 확률 증가'],
        ['mpCostReduction', 'MP 소모량 감소'],
        ['damageBonus', '일반 몬스터 대상 피해'],
        ['critMul', '치명타 피해량 증가'],
        ['goldBonus', '골드 획득 증가량'],
        ['itemDropChance', '아이템 드랍 확률'],
        ['defReduction', '방어력 관통'],
        ['basicDamageBonus', '일반 공격 피해'],
        ['skillDamageBonus', '스킬 공격 피해']
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

const CARD_COMBINE_GUARANTEE_COUNTS = {
    4: 5,
    5: 5,
    6: 5,
    7: 10
};

function getCardCombineInfo(star) {
    return CARD_COMBINE_TABLE[Number(star || 0)] || null;
}

function normalizeCardCombineCounts(user) {
    if (!user.cardCombineCounts || typeof user.cardCombineCounts != 'object') user.cardCombineCounts = {};
    if (!user.cardPackCombineCounts || typeof user.cardPackCombineCounts != 'object') user.cardPackCombineCounts = {};
}

function getCardCombineGuaranteeCount(star) {
    return CARD_COMBINE_GUARANTEE_COUNTS[Number(star)];
}

function getCardCombineCount(user, kind, star) {
    normalizeCardCombineCounts(user);
    const target = kind == 'pack' ? user.cardPackCombineCounts : user.cardCombineCounts;
    return Number(target[String(star)] || 0);
}

function rollCardCombineSuccess(user, kind, star, rate) {
    normalizeCardCombineCounts(user);
    const target = kind == 'pack' ? user.cardPackCombineCounts : user.cardCombineCounts;
    const key = String(star);
    const guarantee = getCardCombineGuaranteeCount(star);
    if (!guarantee) return { success: Math.random() < Number(rate || 0), guaranteed: false, count: 0, guarantee: 0 };
    const nextCount = Number(target[key] || 0) + 1;
    if (nextCount >= guarantee) {
        target[key] = 0;
        return { success: true, guaranteed: true, count: 0, guarantee };
    }
    const success = Math.random() < Number(rate || 0);
    target[key] = success ? 0 : nextCount;
    return { success, guaranteed: false, count: Number(target[key] || 0), guarantee };
}

function formatRatePercent(rate) {
    return Math.round(Number(rate || 0) * 1000) / 10 + '%';
}

function getProtectItemIdForCardStar(user, star) {
    const items = getDataCache('Item', []);
    return items.findIndex((item, id) => item && item.protect && Number(item.protect.star) == Number(star) && getInventoryItemCount(user, id) > 0);
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
    const sameCardId = selected.every(card => Number(card.id) == Number(selected[0].id)) ? Number(selected[0].id) : null;
    return { numbers, selected, star, info, sameCardId };
}

function setCardCombineProtection(user, indexArg) {
    const pending = user.pendingAction;
    if (!pending || pending.type != '카드조합') return '❌ 진행 중인 카드조합이 없습니다.';
    const index = Number(indexArg);
    if (!Number.isInteger(index) || index < 1 || index > 3) return '❌ /RPGenius 보호카드사용 [1/2/3]';
    const selection = getCardCombineSelection(user, pending.numbers);
    if (selection.error) return selection.error;
    const protectItemId = getProtectItemIdForCardStar(user, selection.star);
    if (protectItemId == -1) return '❌ 해당 등급에 사용할 수 있는 보호 아이템이 없습니다.';
    pending.protectIndex = index - 1;
    pending.protectItemId = protectItemId;
    return '🛡️ 보호 카드 사용 대상이 변경되었습니다.\n- 보호 대상: ' + formatUserCard(selection.selected[index - 1]);
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
        lines.push('- ' + formatUserCard(card));
    });
    lines.push('', '- ' + formatRatePercent(selection.info.rate) + ' 확률로 ' + formatStar(selection.star + 1) + ' 캐릭터 카드를 획득합니다.');
    const guarantee = getCardCombineGuaranteeCount(selection.star);
    if (guarantee) lines.push('- 보정 카운트: ' + comma(getCardCombineCount(user, 'card', selection.star)) + '/' + comma(guarantee));
    lines.push('- 필요 골드: 🪙 ' + comma(selection.info.gold));
    if (Number(user.gold || 0) < selection.info.gold) {
        user.pendingAction = null;
        lines.push('', '❌ 골드가 부족합니다.');
    } else {
        user.pendingAction = { type: '카드조합', numbers: selection.numbers };
        const protectItemId = getProtectItemIdForCardStar(user, selection.star);
        if (protectItemId != -1) {
            lines.push('', '🛡️ 보호 카드를 사용할 수 있습니다.', '/RPGenius 보호카드사용 [1/2/3]');
        }
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
    const protectIndex = Number(pending.protectIndex);
    const useProtection = Number.isInteger(protectIndex) && protectIndex >= 0 && protectIndex < 3;
    const protectItemId = useProtection ? getProtectItemIdForCardStar(user, selection.star) : -1;
    if (useProtection && (protectItemId == -1 || getInventoryItemCount(user, protectItemId) < 1)) return '❌ 보호 카드가 부족합니다.';
    const protectedCard = useProtection ? Object.assign({}, selection.selected[protectIndex]) : null;
    user.gold = Number(user.gold || 0) - selection.info.gold;
    selection.numbers.slice().sort((a, b) => b - a).forEach(number => user.inventory.card.splice(number - 1, 1));
    const combineRoll = rollCardCombineSuccess(user, 'card', selection.star, selection.info.rate);
    const success = combineRoll.success;
    if (useProtection) removeInventoryItem(user, protectItemId, 1);
    if (!success && protectedCard) user.inventory.card.push(protectedCard);
    const resultCard = {
        id: selection.sameCardId != null ? selection.sameCardId : randomInt(0, characterCards.length - 1),
        star: success ? selection.star + 1 : selection.star,
        type: '일반'
    };
    applyFashionRollToCard(resultCard, selection.sameCardId);
    user.inventory.card.push(resultCard);
    const lines = [(success ? (combineRoll.guaranteed ? '⚜️ 카드 3장을 확정 조합했습니다!' : '🌟 카드 3장을 조합했습니다!') : '✅ 카드 3장을 조합했습니다.')];
    if (useProtection) lines.push(success ? '🛡️ 조합에 성공해 보호 카드는 소모되었지만 재료 카드는 보존되지 않았습니다.' : '🛡️ 보호 카드 효과로 재료 카드 1장을 보존했습니다.\n- ' + formatUserCard(protectedCard));
    lines.push('[ 획득 결과 ]', '- ' + formatUserCard(resultCard));
    return lines.join('\n');
}

function getCardPackNameByStar(starIndex) {
    if (!Number.isInteger(starIndex) || starIndex < 0 || starIndex > 11) return null;
    if (starIndex == 9) return '제타 카드팩';
    if (starIndex == 10) return '시그마 카드팩';
    if (starIndex == 11) return '오메가 카드팩';
    return (starIndex + 1) + '성 카드팩';
}

function combineCardPacks(user, starArg, countArg) {
    const star = parseCardStarArg(starArg);
    if (star == null) return '❌ /RPGenius 카드팩조합 [등급] <횟수>';
    const info = getCardCombineInfo(star);
    if (!info) return '❌ 해당 등급의 카드팩은 더 이상 조합할 수 없습니다.';
    let times = 1;
    if (countArg != null && countArg !== '') {
        times = Number(countArg);
        if (!Number.isInteger(times) || times < 1) return '❌ 횟수는 1 이상의 정수여야 합니다.';
    }
    const inputPackName = getCardPackNameByStar(star);
    const outputPackName = getCardPackNameByStar(star + 1);
    if (!inputPackName || !outputPackName) return '❌ 해당 등급의 카드팩은 더 이상 조합할 수 없습니다.';
    const items = getDataCache('Item', []);
    const inputItemId = items.findIndex(it => it.name == inputPackName);
    const outputItemId = items.findIndex(it => it.name == outputPackName);
    if (inputItemId == -1) return '❌ 사용 가능한 카드팩이 없습니다: ' + inputPackName;
    if (outputItemId == -1) return '❌ 결과 카드팩 데이터를 찾을 수 없습니다: ' + outputPackName;
    const requiredPacks = times * 3;
    const havePacks = getInventoryItemCount(user, inputItemId);
    if (havePacks < requiredPacks) return '❌ ' + inputPackName + '이(가) 부족합니다. (' + comma(havePacks) + '/' + comma(requiredPacks) + ')';
    const totalGold = info.gold * times;
    if (Number(user.gold || 0) < totalGold) return '❌ 골드가 부족합니다. (필요 🪙 ' + comma(totalGold) + ')';
    if (!removeInventoryItem(user, inputItemId, requiredPacks)) return '❌ 카드팩 차감에 실패했습니다.';
    user.gold = Number(user.gold || 0) - totalGold;
    let successCount = 0;
    let guaranteedCount = 0;
    let lastRoll = null;
    for (let i = 0; i < times; i++) {
        const roll = rollCardCombineSuccess(user, 'pack', star, info.rate);
        if (roll.success) successCount++;
        if (roll.guaranteed) guaranteedCount++;
        lastRoll = roll;
    }
    const failCount = times - successCount;
    if (successCount > 0) addInventoryItem(user, outputItemId, successCount);
    if (failCount > 0) addInventoryItem(user, inputItemId, failCount);
    cleanupInventoryItems(user);
    const lines = ['✅ ' + inputPackName + ' x' + comma(requiredPacks) + ' 조합 완료 (' + comma(times) + '회)'];
    lines.push('- 성공 확률: ' + formatRatePercent(info.rate));
    if (guaranteedCount > 0) lines.push('- 보정 카운트 확정 성공: ' + comma(guaranteedCount) + '회');
    else if (lastRoll && lastRoll.guarantee > 0) lines.push('- 보정 카운트: ' + comma(lastRoll.count) + '/' + comma(lastRoll.guarantee));
    lines.push('- 소모 🪙 ' + comma(totalGold));
    lines.push('', '[ 결과 ]');
    lines.push('- ' + outputPackName + ' x' + comma(successCount));
    if (failCount > 0) lines.push('- ' + inputPackName + ' x' + comma(failCount) + ' 반환');
    return lines.join('\n');
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
        lines.push('- ' + formatUserCard(card));
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
    if (Array.isArray(user.card_slot) && user.card_slot.some(slotCard => slotCard && Number(slotCard.id) == Number(card.id))) return '❌ 같은 캐릭터가 카드 슬롯에 장착되어 있어 메인 카드로 장착할 수 없습니다.';
    user.inventory.card.splice(number - 1, 1);
    if (user.main_card && typeof user.main_card.id != 'undefined') user.inventory.card.push(user.main_card);
    user.main_card = card;
    const removed = autoUnequipInvalidSupport(user);
    const stats = calculateUserStats(user);
    user.hp = Math.min(typeof user.hp == 'undefined' ? Number(stats.hp || 0) : Number(user.hp || 0), Number(stats.hp || 0));
    user.mp = Math.min(typeof user.mp == 'undefined' ? Number(stats.mp || 0) : Number(user.mp || 0), Number(stats.mp || 0));
    let msg = '✅ 메인 캐릭터 카드를 장착했습니다.\n- ' + formatUserCard(card);
    if (removed) msg += '\n⚠️ 메인 카드 변경으로 보조 장비 <' + removed.rarity + '> ' + removed.name + '(이)가 장착 해제되었습니다.';
    return msg;
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
    if (user.main_card && typeof user.main_card.id != 'undefined' && Number(user.main_card.id) == Number(card.id)) return '❌ 메인 카드와 같은 캐릭터는 카드 슬롯에 장착할 수 없습니다.';
    if (user.card_slot.some(slotCard => slotCard && slotCard.id == card.id)) return '❌ 이미 같은 캐릭터가 카드 슬롯에 장착되어 있습니다.';
    user.inventory.card.splice(number - 1, 1);
    user.card_slot.push(card);
    return '✅ 카드 슬롯에 장착했습니다.\n- ' + formatUserCard(card);
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
    return '✅ 카드 슬롯 ' + slotNumber + '번에서 제거했습니다.\n- ' + formatUserCard(removed);
}

const CHARACTER_CONVERT_MAX_STAR = { '제타': 10, '시그마': 11, '오메가': 12 };

function convertCharacterCard(user, numberArg, confirmedFashion, can) {
    const number = Number(numberArg);
    const cards = user.inventory && Array.isArray(user.inventory.card) ? user.inventory.card : [];
    if (!Number.isInteger(number) || number < 1 || number > cards.length) return '❌ 존재하지 않는 카드 번호입니다.';
    const characterCards = readJson(CHARACTER_CARDS_PATH, []);
    if (characterCards.length <= 1) return '❌ 변환할 수 있는 캐릭터 카드 데이터가 부족합니다.';
    const card = cards[number - 1];
    const maxStar = CHARACTER_CONVERT_MAX_STAR[can] || 9;
    if (Number(card.star || 0) >= maxStar) return '❌ 해당 등급 카드는 캐릭터 변환석을 사용할 수 없습니다.';
    if (typeof card.skin == 'string' && card.skin.trim() && !confirmedFashion) {
        user.pendingAction.cardNumber = number;
        return '❗ 패션 카드를 변환하시겠습니까?\n\n적용된 패션이 사라지고 일반 카드로 변환됩니다.\n/RPGenius 확인\n/RPGenius 사용취소';
    }
    const before = Object.assign({}, card);
    let newId = card.id;
    while (newId == card.id) newId = randomInt(0, characterCards.length - 1);
    card.id = newId;
    delete card.skin;
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
    '방어관통력': { key: 'pnt', plusKey: 'pnt', flat: 1, plus: 0.003, label: '방어 관통력', plusLabel: '방어력 관통' },
    '방어 관통력': { key: 'pnt', plusKey: 'pnt', flat: 1, plus: 0.003, label: '방어 관통력', plusLabel: '방어력 관통' }
};

const STAT_POINT_DISPLAY = [
    { name: '공격력', key: 'atk', plusKey: 'atk', flat: 2, plus: 1 },
    { name: '체력', key: 'hp', plusKey: 'hp', flat: 10, plus: 1 },
    { name: 'MP', key: 'mp', plusKey: 'mp', flat: 12, plus: 1 },
    { name: '방어력', key: 'def', plusKey: 'def', flat: 3, plus: 1 },
    { name: '방어 관통력', key: 'pnt', plusKey: 'pnt', flat: 1, plus: 0.3 }
];

function normalizeStatPointData(user) {
    if (!user.statPointStats || typeof user.statPointStats != 'object') user.statPointStats = {};
    ['atk', 'hp', 'mp', 'def', 'pnt'].forEach(key => {
        user.statPointStats[key] = Number(user.statPointStats[key] || 0);
    });
    user.statPoint = Number(user.statPoint || 0);
    user.statPointBuyCount = Math.max(0, Math.floor(Number(user.statPointBuyCount || 0)));
}

const STAT_POINT_BUY_BASE_A = 500;
const STAT_POINT_BUY_BASE_B = 800;

function getStatPointBuyPrice(n) {
    const idx = Math.max(1, Math.floor(Number(n || 1)));
    if (idx == 1) return STAT_POINT_BUY_BASE_A;
    let a = STAT_POINT_BUY_BASE_A;
    let b = STAT_POINT_BUY_BASE_B;
    if (idx == 2) return b;
    for (let i = 3; i <= idx; i++) {
        const c = a + b;
        a = b;
        b = c;
    }
    return idx >= 21 ? Math.round(b * Math.pow(0.75, idx - 20)) : b;
}

function getStatPointBuyTotalPrice(currentCount, buyCount) {
    let total = 0;
    for (let i = 1; i <= buyCount; i++) total += getStatPointBuyPrice(currentCount + i);
    return total;
}

function buyStatPoint(user, countArg) {
    normalizeStatPointData(user);
    const count = typeof countArg == 'undefined' ? 1 : Number(countArg);
    if (!Number.isInteger(count) || count < 1) return '❌ 숫자는 1 이상의 정수여야 합니다.';
    const currentCount = Number(user.statPointBuyCount || 0);
    const totalPrice = getStatPointBuyTotalPrice(currentCount, count);
    if (Number(user.gold || 0) < totalPrice) {
        const nextPrice = getStatPointBuyPrice(currentCount + 1);
        return '❌ 골드가 부족합니다.\n- ' + comma(count) + '개 구매 필요 골드: 🪙 ' + comma(totalPrice) + '\n- 다음 1개 가격: 🪙 ' + comma(nextPrice) + ')';
    }
    user.gold = Number(user.gold || 0) - totalPrice;
    user.statPoint = Number(user.statPoint || 0) + count;
    user.statPointBuyCount = currentCount + count;
    const nextPrice = getStatPointBuyPrice(user.statPointBuyCount + 1);
    return '✅ ' + comma(count) + ' 스탯포인트를 🪙 ' + comma(totalPrice) + ' 골드에 구매했습니다.\n- 누적 구매 횟수: ' + comma(user.statPointBuyCount) + '회\n- 다음 1개 가격: 🪙 ' + comma(nextPrice) + '\n- 잔여 스탯포인트: ' + comma(user.statPoint);
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
        if (key == 'pnt') {
            stats.pnt = Number(stats.pnt || 0) + count;
            plusStats.pnt = Number(plusStats.pnt || 0) + count * 0.003;
        }
    });
    [['weapon', user.equipments && user.equipments.weapon], ['armor', user.equipments && user.equipments.armor]].forEach(entry => {
        const data = entry[1] && getEquipmentData(entry[0], entry[1].id);
        if (data && isEquipmentEffectActive(user, data)) {
            addStats(stats, getEquipmentStatsAtLevel(data, entry[1].level));
            addStats(plusStats, getEquipmentPlusStatsAtLevel(data, entry[1].level));
            addPotentialStats(stats, plusStats, entry[1].potential);
            addSoulStats(stats, plusStats, entry[1].soul);
            if (entry[0] == 'weapon' && data.name == DESTINY_AION_NAME) stats.trueDamageChance = Math.max(Number(stats.trueDamageChance || 0), DESTINY_AION_TRUE_DAMAGE_CHANCE);
            if (entry[0] == 'weapon' && data.name == '심연의 종말') stats.hasAbyssDoom = true;
            if (entry[0] == 'weapon' && data.name == '셀레스티아') stats.hasCelestia = true;
        }
    });
    const accessories = user.equipments && user.equipments.accessory || {};
    Object.keys(accessories).forEach(key => {
        const equip = accessories[key];
        const data = equip && getEquipmentData('accessory', equip.id);
        if (data && isEquipmentEffectActive(user, data)) {
            addStats(stats, getEquipmentStatsAtLevel(data, equip.level));
            addStats(plusStats, getEquipmentPlusStatsAtLevel(data, equip.level));
            addPotentialStats(stats, plusStats, equip.potential);
        }
    });
    getEquippedPets(user).forEach(pet => {
        if (!isPetEffectActive(pet)) return;
        const data = getPetData(pet.id);
        if (!data) return;
        addStats(stats, getEquipmentStatsAtLevel(data, pet.level));
        addStats(plusStats, getEquipmentPlusStatsAtLevel(data, pet.level));
    });
    getActivePetSetEffects(user).forEach(set => {
        set.applied.forEach(a => {
            addStats(stats, a.effect.stat || {});
            addStats(plusStats, a.effect.plusStat || {});
        });
    });
    const support = user.equipments && user.equipments.support;
    if (support && typeof support.id != 'undefined') {
        const data = getEquipmentData('support', support.id);
        if (data && isEquipmentEffectActive(user, data)) {
            const level = Number(support.level || 0);
            addStats(stats, getEquipmentStatsAtLevel(data, level));
            addStats(plusStats, getEquipmentPlusStatsAtLevel(data, level));
            const resolved = resolveRolledStats(data, level, support.rolled);
            addStats(stats, resolved.stat);
            addStats(plusStats, resolved.plusStat);
            addPotentialStats(stats, plusStats, support.potential);
            const dyn = getEquipmentDynamicBonusAtLevel(data, level);
            const star = String(Number(user.main_card && user.main_card.star || 0));
            if (dyn[star]) {
                addStats(stats, dyn[star].stat || {});
                addStats(plusStats, dyn[star].plusStat || {});
            }
        }
    }
    const fashion = getCardFashion(user.main_card);
    if (fashion && Number(user.main_card && user.main_card.star || 0) >= Number(fashion.requireStar || 0)) {
        addStats(stats, fashion.option && fashion.option.stat || {});
        addStats(plusStats, fashion.option && fashion.option.plusStat || {});
    }
    applyPotentialDerivedStats(stats, user);
    ['atk', 'def', 'hp', 'mp'].forEach(key => {
        if (Number(plusStats[key] || 0) != 0) stats[key] = Math.round(Number(stats[key] || 0) * (1 + Number(plusStats[key] || 0)));
    });
    stats.pntPercent = Number(stats.pntPercent || 0) + Number(plusStats.pnt || 0);
    ['gold', 'potion', 'afterBasic', 'avd', 'afterSkill', '000', 'exp', 'eliteDmg', 'mpReduce', 'itemDropChance', 'recoveryEfficiency', 'crit', 'critMul', 'critDef', 'cmb', 'maxCmb', 'skillCooldown', 'skillTrueDmg', 'takenDamage', 'damageBonus', 'finalDamage', 'bossDmg', 'summonDuration'].forEach(key => {
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
    BOSS_DMG_RATIO: 0.3,
    FINAL_DAMAGE_RATIO: 0.9,
    PEN_DIVISOR: 200,
    DEF_REDUCTION_RATIO: 0.5,
    TRIPLE_ZERO_RATIO: 0.15,
    SKILL_TRUE_DMG_RATIO: 0.2,
    TRUE_DAMAGE_RATIO: 0.125,
    AVOID_CAP: 0.8,
    MITIGATE_CAP: 0.8,
    TAKEN_DAMAGE_CAP: 0.8,
    RECOVERY_RATIO: 0.5,
    RECOVERY_EFFICIENCY_RATIO: 0.25,
    MP_DIVISOR: 8,
    COOLDOWN_DIVISOR: 10000,
    ECON_SCALE: 30,
    POTION_SCALE: 25,
    PLUS_GOLD_DIVISOR: 1000,
    DROP_SCALE: 80
};

function calculateCombatPower(user) {
    return computeCombatPowerFromStats(calculateUserStats(user), calculateCardSlotEffects(user));
}

function getTotalDefenseReductionRate(stats, slotEffects) {
    return Math.max(0, Math.min(1, Number(stats && stats.pntPercent || 0) + Number(slotEffects && slotEffects.defReduction || 0)));
}

function computeCombatPowerFromStats(stats, slot) {
    stats = stats || {};
    slot = slot || {};
    const W = CP_WEIGHTS;

    const atk = Math.max(0, Number(stats.atk || 0));
    const def = Math.max(0, Number(stats.def || 0));
    const hp = Math.max(0, Number(stats.hp || 0));
    const mp = Math.max(0, Number(stats.mp || 0));
    const crit = Math.max(0, Number(stats.crit || 0));
    const critMul = Math.max(1, Number(stats.critMul || 1.4));
    const critDef = Math.max(0, Math.min(1, Number(stats.critDef || 0)));
    const cmb = Math.max(0, Math.min(1, Number(stats.cmb || 0)));
    const maxCmb = 2 + Math.max(0, Math.floor(Number(stats.maxCmb || 0)));
    const pnt = Math.max(0, Number(stats.pnt || 0));
    const pntPercent = getTotalDefenseReductionRate(stats, slot);

    const mAttack = (1 + Number(stats.afterBasic || 0) + Number(slot.basicDamageBonus || 0)) * (1 + (Number(stats.afterSkill || 0) + Number(slot.skillDamageBonus || 0)) * W.AFTER_SKILL_RATIO);
    const mContext = 1 + (Number(stats.damageBonus || 0) + Number(slot.damageBonus || 0)) * W.DAMAGE_BONUS_RATIO + Number(stats.eliteDmg || 0) * W.ELITE_DMG_RATIO + Number(stats.bossDmg || 0) * W.BOSS_DMG_RATIO + Number(stats.finalDamage || 0) * W.FINAL_DAMAGE_RATIO;
    const mCrit = 1 + Math.min(1, crit) * (critMul - 1);
    const mCombo = Array.from({ length: maxCmb }, (_, i) => Math.pow(cmb, i)).reduce((sum, value) => sum + value, 0);
    const mPen = 1 + pnt / W.PEN_DIVISOR + pntPercent * W.DEF_REDUCTION_RATIO;
    const mExtra = 1 + Math.min(1, Number(stats['000'] || 0)) * W.TRIPLE_ZERO_RATIO
                     + Number(stats.skillTrueDmg || 0) / Math.max(atk, 1) * W.SKILL_TRUE_DMG_RATIO
                     + Math.min(1, Number(stats.trueDamageChance || 0)) * W.TRUE_DAMAGE_RATIO;
    const offense = atk * mAttack * mContext * mCrit * mCombo * mPen * mExtra * W.OFFENSE_SCALE;

    const ehp = hp * (1 + def / 100);
    const mAvoid = 1 / (1 - Math.min(W.AVOID_CAP, Math.max(0, Number(stats.avd || 0))));
    const mMitigate = 1 / (1 - Math.min(W.MITIGATE_CAP, Math.max(0, Number(slot.hpDamageReduction || 0))));
    const mTakenDamage = 1 / Math.max(1 - W.TAKEN_DAMAGE_CAP, 1 + Number(stats.takenDamage || 0));
    const mRecover = 1 + (Number(slot.killRecoveryChance || 0) + Number(stats.recoveryEfficiency || 0) * W.RECOVERY_EFFICIENCY_RATIO + (Number(stats.attackHpRecovery || 0) / Math.max(hp, 1) + Number(stats.attackMpRecovery || 0) / Math.max(mp, 1)) * 0.1) * W.RECOVERY_RATIO;
    const mCritDef = 1 / (1 - Math.min(W.MITIGATE_CAP, critDef));
    const defense = Math.sqrt(ehp) * mAvoid * mMitigate * mTakenDamage * mRecover * mCritDef * W.DEFENSE_SCALE;

    const mMpSave = 1 + Math.min(0.8, Math.max(0, -Number(stats.mpReduce || 0))) + Math.min(0.8, Number(slot.mpCostReduction || 0));
    const mCooldown = 1 + Math.max(0, -Number(stats.skillCooldown || 0)) / W.COOLDOWN_DIVISOR;
    const resourcePower = (mp / W.MP_DIVISOR) * mMpSave * mCooldown;
    const economyPower = (Number(stats.gold || 0) + Number(stats.exp || 0) + Number(slot.goldBonus || 0) + Number(slot.expBonus || 0)) * W.ECON_SCALE
                       + Number(stats.potion || 0) * W.POTION_SCALE
                       + Number(stats.plusGold || 0) / W.PLUS_GOLD_DIVISOR * W.ECON_SCALE
                       + (Number(stats.itemDropChance || 0) + Number(slot.itemDropChance || 0)) * W.DROP_SCALE;
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

    const cp = calculateCombatPower(user);
    const lines = [
        '[ ' + user.name + '님의 정보 ]',
        VIEWMORE,
        'Lv. ' + level + ' (' + comma(exp) + '/' + comma(maxExp) + ')',
        'HP: ' + comma(hp) + '/' + comma(maxHp),
        'MP: ' + comma(mp) + '/' + comma(maxMp),
        '',
        '〈 전투력 〉',
        '⚔️ 총 전투력: ' + comma(cp.total),
        '- 공격: ' + comma(cp.offense),
        '- 방어: ' + comma(cp.defense),
        '- 유틸: ' + comma(cp.utility),
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
    lines.push(formatEquippedEquipment('보조', 'support', user.equipments && user.equipments.support));
    lines.push('', '〈 스탯 〉');
    lines.push('공격력: ' + comma(stats.atk));
    lines.push('방어력: ' + comma(stats.def));
    lines.push('방어 관통력: ' + comma(stats.pnt));
    lines.push('치명타 확률: ' + formatStatValue('crit', stats.crit).replace(/^\+/, ''));
    lines.push('치명타 피해량: ' + formatStatValue('critMul', stats.critMul).replace(/^\+/, ''));
    lines.push('치명타 피해 감소율: ' + formatStatValue('crit', stats.critDef).replace(/^\+/, ''));
    lines.push('연격 확률: ' + formatStatValue('crit', stats.cmb).replace(/^\+/, ''));
    lines.push('최대 공격 횟수: ' + comma(2 + Math.max(0, Math.floor(Number(stats.maxCmb || 0)))));
    return lines.join('\n');
}

const RECOMMEND_CP_TUNING = {
    NORMAL_KILL_HITS: 1,
    ELITE_KILL_HITS: 25,
    SURVIVAL_HITS: 10,
    DEF_RATIO: 0.30,
    PEN_RATIO: 0.15,
    BASE_MP: 350,
    BASE_CRIT: 0.05,
    BASE_CRIT_MUL: 1.5,
    SAFE_RATIO: 1.0,
    CAUTION_RATIO: 0.7
};

function getDungeonRecommendedCP(dungeon) {
    if (!dungeon) return 0;
    const T = RECOMMEND_CP_TUNING;
    const N = getCombatStats(dungeon);
    const E = getCombatStats(dungeon.elite || {});
    const normalCritMitigation = 1 + T.BASE_CRIT * (T.BASE_CRIT_MUL - 1) * (1 - Math.max(0, Math.min(1, Number(N.critDef || 0))));
    const eliteCritMitigation = 1 + T.BASE_CRIT * (T.BASE_CRIT_MUL - 1) * (1 - Math.max(0, Math.min(1, Number(E.critDef || 0))));
    const normalKill = Number(N.hp || 0) * (100 + Number(N.def || 0)) / 100 / Math.max(1, T.NORMAL_KILL_HITS) / normalCritMitigation;
    const eliteKill = Number(E.hp || 0) * (100 + Number(E.def || 0)) / 100 / Math.max(1, T.ELITE_KILL_HITS) / eliteCritMitigation;
    const atk = Math.max(normalKill, eliteKill);
    const def = Number(E.atk || 0) * T.DEF_RATIO;
    const effDef = Math.max(0, def - Number(E.pnt || 0));
    const eliteExpectedCrit = 1 + Math.max(0, Math.min(1, Number(E.crit || 0))) * (Math.max(1, Number(E.critMul || 1.5)) - 1);
    const eliteMaxCmb = 2 + Math.max(0, Math.floor(Number(E.maxCmb || 0)));
    const eliteCmb = Math.max(0, Math.min(1, Number(E.cmb || 0)));
    const eliteExpectedCombo = Array.from({ length: eliteMaxCmb }, (_, i) => Math.pow(eliteCmb, i)).reduce((sum, value) => sum + value, 0);
    const incomingPerHit = Number(E.atk || 0) * eliteExpectedCrit * eliteExpectedCombo * 100 / (100 + effDef);
    const hp = incomingPerHit * T.SURVIVAL_HITS;
    const pnt = Number(E.def || 0) * T.PEN_RATIO;
    const stats = {
        atk, def, hp, pnt,
        mp: T.BASE_MP,
        crit: T.BASE_CRIT,
        critMul: T.BASE_CRIT_MUL
    };
    return computeCombatPowerFromStats(stats, {}).total;
}

function getDungeonCPStatus(userCP, recommendCP) {
    if (!recommendCP || recommendCP <= 0) return 'safe';
    const ratio = Number(userCP || 0) / recommendCP;
    if (ratio >= RECOMMEND_CP_TUNING.SAFE_RATIO) return 'safe';
    if (ratio >= RECOMMEND_CP_TUNING.CAUTION_RATIO) return 'caution';
    return 'danger';
}

function formatDungeonCPLine(userCP, recommendCP) {
    const status = getDungeonCPStatus(userCP, recommendCP);
    const prefix = status == 'safe' ? '' : status == 'caution' ? '⚠️ ' : '❌ ';
    const tag = status == 'safe' ? '' : status == 'caution' ? ' (도전)' : ' (위험)';
    return prefix + '권장 ⚔️ ' + comma(recommendCP) + tag;
}

function getAccessibleDungeons(level) {
    const dungeons = readJson(DUNGEON_PATH, []);
    const lvl = Number(level || 1);
    return dungeons.filter(dungeon => {
        if (lvl < Number(dungeon.requireLevel || 1)) return false;
        if (typeof dungeon.maxLevel != 'undefined' && lvl > Number(dungeon.maxLevel)) return false;
        return true;
    });
}

function formatDungeonLevelRange(dungeon) {
    const min = Number(dungeon.requireLevel || 1);
    if (typeof dungeon.maxLevel != 'undefined') return 'Lv. ' + min + ' ~ ' + Number(dungeon.maxLevel);
    return 'Lv. ' + min;
}

function formatFieldList(user) {
    const level = Number(user.level || 1);
    const dungeons = getAccessibleDungeons(level);
    const userCP = calculateCombatPower(user).total;
    const lines = ['[ 입장 가능한 필드 목록 ]', '내 전투력: ⚔️ ' + comma(userCP), VIEWMORE];
    const goldMineDungeons = dungeons.filter(dungeon => typeof dungeon.goldMineLevel != 'undefined');
    const normalDungeons = dungeons.filter(dungeon => typeof dungeon.goldMineLevel == 'undefined');
    if (goldMineDungeons.length > 0) {
        lines.push('', '[ 황금 광산 ]');
        goldMineDungeons.forEach(dungeon => {
            const recCP = getDungeonRecommendedCP(dungeon);
            lines.push('〈 ' + dungeon.name + ' 〉 ' + formatDungeonLevelRange(dungeon) + ' · ' + formatDungeonCPLine(userCP, recCP));
        });
    }

    lines.push('', '[ 던전 ]');
    normalDungeons.forEach(dungeon => {
        const recCP = getDungeonRecommendedCP(dungeon);
        lines.push('〈 ' + dungeon.name + ' 〉 ' + formatDungeonLevelRange(dungeon) + ' · ' + formatDungeonCPLine(userCP, recCP));
    });
    const bosses = getWorldBossList();
    if (bosses.length > 0) {
        lines.push('', '[ 월드보스 ]');
        bosses.forEach(boss => {
            forceDefeatExpiredWorldBoss(boss);
            const state = getWorldBossState(boss.name);
            const aliveHp = Number(state.hp || 0);
            if (aliveHp > 0) {
                const ratio = Math.max(0, Math.min(1, aliveHp / Number(boss.hp || 1)));
                lines.push('〈 ' + boss.name + ' 〉 HP ' + comma(aliveHp) + '/' + comma(Number(boss.hp || 0)) + ' (' + (Math.round(ratio * 1000) / 10) + '%)');
            } else {
                const respawnAt = getWorldBossRespawnTimestamp(state);
                if (Date.now() >= respawnAt) {
                    lines.push('〈 ' + boss.name + ' 〉 HP ' + comma(Number(boss.hp || 0)) + '/' + comma(Number(boss.hp || 0)));
                } else {
                    lines.push('〈 ' + boss.name + ' 〉 ❌ 부활 대기 (' + formatTimestampLocal(respawnAt) + ')');
                }
            }
        });
    }
    return lines.join('\n');
}

function formatTimestampLocal(ts) {
    if (!ts) return '-';
    const kst = new Date(Number(ts) + 9 * 60 * 60 * 1000);
    const month = kst.getUTCMonth() + 1;
    const day = kst.getUTCDate();
    const hour = String(kst.getUTCHours()).padStart(2, '0');
    const min = String(kst.getUTCMinutes()).padStart(2, '0');
    return month + '/' + day + ' ' + hour + ':' + min;
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

function getDamageAfterDestinyDefense(damage, defense, penetration, defenseReductionRate) {
    const reducedDefense = Number(defense || 0) * (1 - Math.min(1, Math.max(0, Number(defenseReductionRate || 0))));
    const penetratedDefense = Math.max(0, reducedDefense - Number(penetration || 0));
    return getDamageAfterDefense(damage, penetratedDefense * 0.5, 0);
}

function getCombatStats(data) {
    return Object.assign({
        atk: 0,
        pnt: 0,
        def: 0,
        hp: 0,
        crit: 0,
        critMul: 1.5,
        critDef: 0,
        cmb: 0,
        maxCmb: 0
    }, data || {});
}

function getComboHitCount(stats) {
    const chance = Math.max(0, Math.min(1, Number(stats && stats.cmb || 0)));
    const maxHits = 2 + Math.max(0, Math.floor(Number(stats && stats.maxCmb || 0)));
    let hitCount = 1;
    while (hitCount < maxHits && Math.random() < chance) hitCount++;
    return hitCount;
}

function applyCriticalDamage(damage, stats, extra, defenderStats) {
    if (extra && extra.disableCritical) return { damage: Number(damage || 0), isCritical: false };
    const critChance = Math.max(0, Number(stats.crit || 0)) * (extra && typeof extra.critChanceMul != 'undefined' ? Number(extra.critChanceMul) : 1);
    const critMul = Number(stats.critMul || 1.4) + Number(extra && extra.critMulBonus || 0);
    const critDef = Math.max(0, Math.min(1, Number(defenderStats && defenderStats.critDef || 0)));
    const finalCritMul = 1 + Math.max(0, critMul - 1) * (1 - critDef);
    const isCritical = extra && extra.forceCritical ? true : Math.random() < critChance;
    return {
        damage: isCritical ? Math.round(Number(damage || 0) * finalCritMul) : Number(damage || 0),
        isCritical: isCritical
    };
}

function applyDamageVariance(damage) {
    return Math.max(0, Math.round(Number(damage || 0) * (randomInt(98, 102) / 100)));
}

const DESTINY_AION_NAME = '운명의 아이온';
const DESTINY_AION_TRUE_DAMAGE_CHANCE = 0.25;

function calculateAttackHitResult(rawDamage, defense, penetration, stats, slotEffects, extra, defenderStats) {
    const hitCount = extra && extra.hitCount ? Math.max(1, Math.floor(Number(extra.hitCount || 1))) : getComboHitCount(stats);
    const hitDamages = [];
    const hitDetails = [];
    let finalDamage = 0;
    let criticalCount = 0;
    let bonusTripleZero = 0;
    let destinyDamageCount = 0;
    const trueChance = Number(stats && stats.trueDamageChance || 0);
    let totalHits = hitCount;
    for (let i = 0; i < totalHits; i++) {
        const baseDamage = Number(rawDamage || 0) * (1 + Number(extra && extra.damageBonusMul || 0)) * (1 + Number(stats && stats.finalDamage || 0));
        const criticalResult = applyCriticalDamage(baseDamage, stats, extra, defenderStats);
        if (criticalResult.isCritical && stats && stats.hasAbyssDoom && extra && extra.isBasic && totalHits < 999 && Math.random() < 0.3) {
            totalHits++;
        }
        let hitDamage = 0;
        const isDestinyDamage = trueChance > 0 && Math.random() < trueChance;
        hitDamage = isDestinyDamage
            ? getDamageAfterDestinyDefense(criticalResult.damage, defense, penetration, getTotalDefenseReductionRate(stats, slotEffects))
            : getDamageAfterReducedDefense(criticalResult.damage, defense, penetration, getTotalDefenseReductionRate(stats, slotEffects));
        
        if (stats && stats.hasCelestia && extra && extra.isSkill && Math.random() < 0.2) {
            hitDamage += Math.round(criticalResult.damage * 0.15);
        }

        if (isDestinyDamage) destinyDamageCount++;
        if (criticalResult.isCritical) criticalCount++;
        if (Number(stats['000'] || 0) > 0 && Math.random() < Number(stats['000'])) {
            const bonus = [10, 100, 1000][randomInt(0, 2)];
            bonusTripleZero += bonus;
            hitDamage += bonus;
        }
        if (extra && Number(extra.skillTrueDmg || 0) > 0) hitDamage += Number(extra.skillTrueDmg);
        hitDamage = applyDamageVariance(hitDamage);
        hitDamages.push(hitDamage);
        hitDetails.push({ damage: hitDamage, isCritical: criticalResult.isCritical, isDestinyDamage });
        finalDamage += hitDamage;
    }
    return { hitCount, hitDamages, hitDetails, finalDamage, criticalCount, bonusTripleZero, destinyDamageCount, trueDamageCount: destinyDamageCount };
}

function calculateMonsterAttackHitResult(monster, defenderStats, slotEffects, extra) {
    const monsterStats = getCombatStats(monster);
    const fieldDamageBase = Number(monsterStats.atk || 0) * (extra && extra.receivedDamageMul || 1) * (1 - Math.min(1, Number(slotEffects && slotEffects.hpDamageReduction || 0))) * (1 - Math.min(1, Number(extra && extra.receivedDamageReduction || 0)));
    return calculateAttackHitResult(fieldDamageBase, defenderStats.def, monsterStats.pnt, monsterStats, { defReduction: 0 }, {}, defenderStats);
}

function formatHitDetailLines(hitResult, prefix, suffix) {
    if (!hitResult || Number(hitResult.hitCount || 1) <= 1) return [];
    const details = Array.isArray(hitResult.hitDetails) ? hitResult.hitDetails : [];
    return details.map(detail => prefix + comma(detail.damage) + (detail.isDestinyDamage ? ' 운명' : '') + (detail.isCritical ? ' 치명타 ' : ' ') + suffix);
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

const IMMORTAL_DRAGON_ARMOR_NAME = '불멸하는 업화의 용갑';
const IMMORTAL_DRAGON_ARMOR_COOLDOWN_MS = 15 * 60 * 1000;
const IMMORTAL_DRAGON_ARMOR_REVIVE_RATIO = 0.2;

function tryImmortalArmorRevive(user, maxHp, lines) {
    const armor = user.equipments && user.equipments.armor;
    if (!armor || typeof armor.id == 'undefined') return false;
    const data = getEquipmentData('armor', armor.id);
    if (!data || data.name != IMMORTAL_DRAGON_ARMOR_NAME) return false;
    if (!isEquipmentEffectActive(user, data)) return false;
    if (!user.equipmentPassiveCd || typeof user.equipmentPassiveCd != 'object') user.equipmentPassiveCd = {};
    const now = Date.now();
    const readyAt = Number(user.equipmentPassiveCd.immortalDragonArmor || 0);
    if (readyAt > now) {
        const remainMs = readyAt - now;
        const remainMin = Math.ceil(remainMs / 60000);
        lines.push('🔥 ' + IMMORTAL_DRAGON_ARMOR_NAME + ' 효과 재사용 대기 중... (' + remainMin + '분 남음)');
        return false;
    }
    const reviveHp = Math.max(1, Math.floor(Number(maxHp || 0) * IMMORTAL_DRAGON_ARMOR_REVIVE_RATIO));
    user.hp = reviveHp;
    user.equipmentPassiveCd.immortalDragonArmor = now + IMMORTAL_DRAGON_ARMOR_COOLDOWN_MS;
    lines.push('🔥 ' + IMMORTAL_DRAGON_ARMOR_NAME + '의 불멸 효과 발동! HP ' + comma(reviveHp) + ' (' + Math.round(IMMORTAL_DRAGON_ARMOR_REVIVE_RATIO * 100) + '%)로 부활했습니다.');
    return true;
}

function applySkillRecovery(user, maxHp, extra, lines) {
    if (!extra || Number(extra.skillRecoveryChance || 0) <= 0 || Number(extra.skillRecoveryAmount || 0) <= 0) return;
    if (Math.random() >= Number(extra.skillRecoveryChance || 0)) return;
    const beforeHp = typeof user.hp == 'undefined' ? Number(maxHp || 0) : Number(user.hp || 0);
    user.hp = Math.min(Number(maxHp || 0), beforeHp + applyRecoveryEfficiency(extra.skillRecoveryAmount, user));
    const recovered = user.hp - beforeHp;
    if (recovered > 0) lines.push('- HP +' + comma(recovered) + ' 회복');
}

function applyDamageTakenSlotRecovery(user, maxHp, fieldDamage, slotEffects, stats, lines) {
    if (Number(fieldDamage || 0) <= 0 || Number(slotEffects && slotEffects.killRecoveryChance || 0) <= 0) return;
    if (Math.random() >= Number(slotEffects.killRecoveryChance || 0)) return;
    const beforeHp = typeof user.hp == 'undefined' ? Number(maxHp || 0) : Number(user.hp || 0);
    const recovery = applyRecoveryEfficiency(Number(fieldDamage || 0) * 0.2, user, stats);
    user.hp = Math.min(Number(maxHp || 0), beforeHp + recovery);
    const recovered = user.hp - beforeHp;
    if (recovered > 0) lines.push('- 피해 회복: HP +' + comma(recovered) + ' (' + Math.round(Number(slotEffects.killRecoveryChance || 0) * 1000) / 10 + '% 확률)');
}

function applyFlatSkillRecovery(user, maxHp, amount, stats, lines) {
    const beforeHp = typeof user.hp == 'undefined' ? Number(maxHp || 0) : Number(user.hp || 0);
    user.hp = Math.min(Number(maxHp || 0), beforeHp + applyRecoveryEfficiency(amount, user, stats));
    const recovered = user.hp - beforeHp;
    if (recovered > 0) lines.push('- HP +' + comma(recovered) + ' 회복');
}

function applySkillMpRecovery(user, maxMp, amount, stats, lines) {
    const beforeMp = typeof user.mp == 'undefined' ? Number(maxMp || 0) : Number(user.mp || 0);
    user.mp = Math.min(Number(maxMp || 0), beforeMp + applyRecoveryEfficiency(amount, user, stats));
    const recovered = user.mp - beforeMp;
    if (recovered > 0) lines.push('- MP +' + comma(recovered));
}

function applyAttackPotentialRecovery(user, stats, lines) {
    if (Math.random() < 0.1 && Number(stats.attackHpRecovery || 0) > 0) applyFlatSkillRecovery(user, Number(stats.hp || 0), Number(stats.attackHpRecovery || 0), stats, lines);
    if (Math.random() < 0.1 && Number(stats.attackMpRecovery || 0) > 0) applySkillMpRecovery(user, Number(stats.mp || 0), Number(stats.attackMpRecovery || 0), stats, lines);
}

function applyRecoveryEfficiency(amount, user, stats) {
    const currentStats = stats || calculateUserStats(user);
    return Math.round(Number(amount || 0) * (1 + Number(currentStats.recoveryEfficiency || 0)));
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

function applyPrestigeExpBonus(user, amount) {
    return Math.round(Number(amount || 0) * (user && user.prestige === true ? 1.1 : 1));
}

function applyLowLevelExpBonus(user, amount) {
    const level = Number(user && user.level || 1);
    return Math.round(Number(amount || 0) * (level >= 1 && level <= 30 ? 1.5 : 1));
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

const STAT_POINT_PER_STAT_LIMIT = 100;

function investStatPoint(user, statArg, countArg) {
    normalizeStatPointData(user);
    const option = STAT_POINT_OPTIONS[String(statArg || '').trim()];
    if (!option) return '❌ /RPGenius 스탯포인트 [공격력|체력|MP|방어력|방어 관통력] <숫자>';
    const count = typeof countArg == 'undefined' ? 1 : Number(countArg);
    if (!Number.isInteger(count) || count < 1) return '❌ 숫자는 1 이상의 정수여야 합니다.';
    if (Number(user.statPoint || 0) < count) return '❌ 잔여 스탯포인트가 부족합니다.';
    const invested = Number(user.statPointStats[option.key] || 0);
    const remaining = Math.max(0, STAT_POINT_PER_STAT_LIMIT - invested);
    if (remaining <= 0) return '❌ ' + option.label + '에는 이미 최대 ' + comma(STAT_POINT_PER_STAT_LIMIT) + '까지 투자했습니다.';
    if (count > remaining) return '❌ ' + option.label + '에는 최대 ' + comma(remaining) + '까지만 추가 투자할 수 있습니다. (현재 ' + comma(invested) + ' / ' + comma(STAT_POINT_PER_STAT_LIMIT) + ')';
    user.statPoint -= count;
    user.statPointStats[option.key] = invested + count;
    const flatValue = option.flat * count;
    const plusValue = option.plus * count;
    const stats = calculateUserStats(user);
    user.hp = Math.min(typeof user.hp == 'undefined' ? Number(stats.hp || 0) : Number(user.hp || 0), Number(stats.hp || 0));
    user.mp = Math.min(typeof user.mp == 'undefined' ? Number(stats.mp || 0) : Number(user.mp || 0), Number(stats.mp || 0));
    if (plusValue > 0) return '✅ ' + option.label + '에 스탯포인트 ' + comma(count) + '을 투자해 ' + option.label + '이 ' + comma(flatValue) + ', ' + option.plusLabel + '이 +' + (Math.round(plusValue * 1000) / 10) + '% 증가했습니다.';
    return '✅ ' + option.label + '에 스탯포인트를 ' + comma(count) + ' 투자해 ' + option.label + '이 ' + comma(flatValue) + ' 증가했습니다.';
}

function formatStatPointStatus(user) {
    normalizeStatPointData(user);
    const lines = ['[ 스탯포인트 현황 ]'];
    STAT_POINT_DISPLAY.forEach(stat => {
        const count = Number(user.statPointStats[stat.key] || 0);
        const flat = count * stat.flat;
        const progress = ' [' + comma(count) + '/' + comma(STAT_POINT_PER_STAT_LIMIT) + ']';
        if (stat.plusKey) lines.push('- ' + stat.name + ' +' + comma(flat) + ' / +' + (Math.round(count * stat.plus * 10) / 10) + '%' + progress);
        else lines.push('- ' + stat.name + ' +' + comma(flat) + progress);
    });
    lines.push('', '잔여 스탯포인트: ' + comma(user.statPoint || 0));
    const nextPrice = getStatPointBuyPrice(Number(user.statPointBuyCount || 0) + 1);
    lines.push('누적 구매: ' + comma(user.statPointBuyCount || 0) + '회', '다음 1개 가격: 🪙 ' + comma(nextPrice));
    return lines.join('\n');
}

async function enterField(user, fieldName, options, channel) {
    if (channel) activeFieldChannels[user.name] = channel;
    const worldBoss = findWorldBossByName(fieldName);
    if (worldBoss) return await enterWorldBossField(user, worldBoss, options, channel);
    const dungeon = findDungeonByName(fieldName);
    if (!dungeon) return '❌ 존재하지 않는 필드입니다.';
    const level = Number(user.level || 1);
    if (level < Number(dungeon.requireLevel || 1)) return '❌ 입장 레벨이 부족합니다.';
    if (typeof dungeon.maxLevel != 'undefined' && level > Number(dungeon.maxLevel)) return '❌ 입장 가능한 최대 레벨을 초과했습니다. (Lv. ' + Number(dungeon.maxLevel) + ' 이하만 입장 가능)';
    const stats = calculateUserStats(user);
    const maxHp = Number(stats.hp || 0);
    const hp = typeof user.hp == 'undefined' ? maxHp : Number(user.hp || 0);
    if (hp <= 1) return '❌ 체력이 1 이하일 때는 필드에 입장할 수 없습니다.';
    if (!(options && options.confirmed)) {
        const userCP = calculateCombatPower(user).total;
        const recCP = getDungeonRecommendedCP(dungeon);
        const status = getDungeonCPStatus(userCP, recCP);
        if (status == 'danger') {
            user.pendingAction = { type: '필드입장확인', name: dungeon.name };
            return [
                '❌ 권장 전투력에 한참 미치지 못합니다.',
                '- 내 전투력: ⚔️ ' + comma(userCP),
                '- 권장 전투력: ⚔️ ' + comma(recCP),
                '',
                '정말 입장하시겠습니까?',
                '/RPGenius 입장확인',
                '/RPGenius 입장취소'
            ].join('\n');
        }
    }
    if (user.pendingAction && user.pendingAction.type == '필드입장확인') user.pendingAction = null;
    user.hp = hp;
    const cooldowns = getFieldCooldowns(user);
    user.field = { name: dungeon.name, enteredAt: Date.now(), nextActionAt: Number(cooldowns.nextActionAt || 0), skillCooldowns: cooldowns.skillCooldowns, killCount: 0, elite: null };
    return '✅ 필드에 입장했습니다.\n- ' + dungeon.name;
}

function leaveField(user) {
    if (!user.field || !user.field.name) return '❌ 입장 중인 필드가 없습니다.';
    if (user.field.worldBoss) return '❌ 월드보스 전투 중에는 퇴장할 수 없습니다.';
    const fieldName = user.field.name;
    saveFieldCooldowns(user);
    releaseEliteEncounter(user);
    clearFieldIktaeBot(user.name);
    delete activeFieldChannels[user.name];
    user.field = null;
    return '✅ 필드에서 퇴장했습니다.\n- ' + fieldName;
}

function getWorldBossChannelId(channel) {
    if (!channel) return null;
    return typeof channel.channelId != 'undefined' ? String(channel.channelId) : null;
}

function getActiveWorldBossUserInChannel(channel, currentUserName) {
    const channelId = getWorldBossChannelId(channel);
    if (!channelId) return null;
    for (const userName of Object.keys(worldBossChannels)) {
        if (currentUserName && userName == currentUserName) continue;
        if (!worldBossSkillTimers[userName]) continue;
        if (getWorldBossChannelId(worldBossChannels[userName]) == channelId) return userName;
    }
    return null;
}

function formatWorldBossChannelBusyMessage(userName) {
    return '❌ 이 채널에서는 이미 ' + userName + '님이 월드보스를 진행 중입니다.';
}

async function enterWorldBossField(user, boss, options, channel) {
    if (user.field && user.field.name) return '❌ 이미 다른 필드에 입장 중입니다. 먼저 퇴장해주세요.';
    const activeUser = getActiveWorldBossUserInChannel(channel, user.name);
    if (activeUser) return formatWorldBossChannelBusyMessage(activeUser);
    ensureWorldBossRevived(boss);
    const state = getWorldBossState(boss.name);
    if (Number(state.hp || 0) <= 0) {
        if (!state.rankRewardsDistributed) await grantWorldBossRankRewards(user, boss, state, null);
        const respawnAt = getWorldBossRespawnTimestamp(state);
        return '❌ ' + boss.name + '은(는) 현재 처치된 상태입니다.\n- 부활: ' + formatTimestampLocal(respawnAt);
    }
    const daily = getWorldBossDailyState(user);
    const useToken = Number(daily.count || 0) >= WORLD_BOSS_DAILY_LIMIT;
    if (useToken) {
        if (Number(daily.tokenCount || 0) >= WORLD_BOSS_VALOR_TOKEN_DAILY_LIMIT) return '❌ 오늘 사용할 수 있는 ' + WORLD_BOSS_VALOR_TOKEN_NAME + ' 한도에 도달했습니다. (' + comma(daily.tokenCount) + '/' + comma(WORLD_BOSS_VALOR_TOKEN_DAILY_LIMIT) + ')';
        const tokenId = getValorTokenItemId();
        if (tokenId == -1 || getInventoryItemCount(user, tokenId) < 1) return '❌ 오늘의 입장 횟수를 모두 사용했습니다. (' + comma(daily.count) + '/' + comma(WORLD_BOSS_DAILY_LIMIT) + ')\n- ' + WORLD_BOSS_VALOR_TOKEN_NAME + '가 있으면 추가 입장할 수 있습니다.';
    }
    const pool = (boss.skillPool || []).map(id => ({ id: Number(id), skill: getExtraSkillById(id) })).filter(entry => entry.skill);
    if (pool.length < 3) return '❌ 스킬이 부족합니다.';
    const candidates = [];
    const used = new Set();
    while (candidates.length < 3 && used.size < pool.length) {
        const idx = randomInt(0, pool.length - 1);
        if (used.has(idx)) continue;
        used.add(idx);
        candidates.push(pool[idx].id);
    }
    user.pendingAction = { type: '월드보스스킬선택', boss: boss.name, candidates: candidates, useToken: useToken };
    const lines = ['[ 월드보스 ] ' + boss.name];
    lines.push('HP ' + comma(Number(state.hp || 0)) + '/' + comma(Number(boss.hp || 0)));
    lines.push('', '입장 시 사용할 스킬을 선택해주세요.');
    candidates.forEach((id, i) => {
        const skill = getExtraSkillById(id);
        const star = Number(user.main_card && user.main_card.star || 0);
        lines.push('');
        lines.push((i + 1) + '. ' + skill.name + ' [ MP ' + comma(Number(skill.mp_cost || 0)) + ' ] 쿨타임 ' + (Number(skill.cooltime || 0) / 1000) + '초');
        lines.push(' ㄴ ' + formatSkillDesc(skill, star));
    });
    lines.push('', '/RPGenius 월드보스선택 [1/2/3]');
    if (useToken) lines.push('* ' + WORLD_BOSS_VALOR_TOKEN_NAME + ' 1개를 사용해 입장합니다. (' + comma(Number(daily.tokenCount || 0)) + '/' + comma(WORLD_BOSS_VALOR_TOKEN_DAILY_LIMIT) + ')');
    else lines.push('* 오늘 남은 입장: ' + comma(WORLD_BOSS_DAILY_LIMIT - Number(daily.count || 0)) + '/' + comma(WORLD_BOSS_DAILY_LIMIT));
    return lines.join('\n');
}

function confirmWorldBossSkill(user, indexArg, channel) {
    const pending = user.pendingAction;
    if (!pending || pending.type != '월드보스스킬선택') return '❌ 진행 중인 월드보스 입장이 없습니다.';
    const activeUser = getActiveWorldBossUserInChannel(channel, user.name);
    if (activeUser) {
        user.pendingAction = null;
        return formatWorldBossChannelBusyMessage(activeUser);
    }
    const index = Number(indexArg);
    if (!Number.isInteger(index) || index < 1 || index > (pending.candidates || []).length) return '❌ /RPGenius 월드보스선택 [1/2/3]';
    const skillId = Number(pending.candidates[index - 1]);
    const skill = getExtraSkillById(skillId);
    if (!skill) return '❌ 선택한 스킬 데이터를 찾을 수 없습니다.';
    const boss = findWorldBossByName(pending.boss);
    if (!boss) return '❌ 월드보스 데이터를 찾을 수 없습니다.';
    ensureWorldBossRevived(boss);
    const state = getWorldBossState(boss.name);
    if (Number(state.hp || 0) <= 0) {
        user.pendingAction = null;
        return '❌ 보스가 이미 사망 상태입니다.';
    }
    if (pending.useToken) {
        const daily = getWorldBossDailyState(user);
        if (Number(daily.tokenCount || 0) >= WORLD_BOSS_VALOR_TOKEN_DAILY_LIMIT) {
            user.pendingAction = null;
            return '❌ 오늘 사용할 수 있는 ' + WORLD_BOSS_VALOR_TOKEN_NAME + ' 한도에 도달했습니다. (' + comma(daily.tokenCount) + '/' + comma(WORLD_BOSS_VALOR_TOKEN_DAILY_LIMIT) + ')';
        }
        const tokenId = getValorTokenItemId();
        if (tokenId == -1 || getInventoryItemCount(user, tokenId) < 1) {
            user.pendingAction = null;
            return '❌ ' + WORLD_BOSS_VALOR_TOKEN_NAME + '가 부족합니다.';
        }
        removeInventoryItem(user, tokenId, 1);
        daily.tokenCount = Number(daily.tokenCount || 0) + 1;
    } else {
        const daily = getWorldBossDailyState(user);
        daily.count = Number(daily.count || 0) + 1;
    }
    user.pendingAction = null;
    const stats = calculateUserStats(user);
    user.hp = Number(stats.hp || 0);
    user.mp = Number(stats.mp || 0);
    const passiveDamageReduction = skill.name == '000' ? Number(getSkillValue(skill, 3, 0) || 0) : 0;
    user.field = {
        name: boss.name,
        worldBoss: true,
        enteredAt: Date.now(),
        nextActionAt: 0,
        skillCooldowns: {},
        bossSkillCooldowns: {},
        bossSkillUseCounts: {},
        chosenSkillId: skillId,
        chosenSkillName: skill.name,
        buffs: {},
        karmaStack: 0,
        passiveDamageReduction: passiveDamageReduction
    };
    if (channel) startWorldBossSkillTimer(user, boss, channel);
    const lines = ['⚔️ 월드보스 ' + boss.name + ' 전투 시작!'];
    lines.push('- 선택 스킬: ' + skill.name);
    lines.push('- ' + boss.name + ' HP: ' + comma(Number(state.hp || 0)) + '/' + comma(Number(boss.hp || 0)));
    return lines.join('\n');
}

function forceLeaveWorldBoss(user) {
    if (!user || !user.field || !user.field.worldBoss) return;
    clearWorldBossSkillTimer(user.name);
    user.field = null;
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

function getFieldBuffs(user) {
    if (!user.field || typeof user.field != 'object') return {};
    if (!user.field.buffs || typeof user.field.buffs != 'object') user.field.buffs = {};
    return user.field.buffs;
}

function getActiveFieldDamageReduction(user) {
    const buffs = getFieldBuffs(user);
    const buff = buffs.receivedDamageReduction;
    if (!buff || Number(buff.expired_at || 0) <= Date.now()) {
        if (buffs.receivedDamageReduction) delete buffs.receivedDamageReduction;
        return 0;
    }
    return Number(buff.value || 0);
}

function getActiveFieldDamageMultiplier(user) {
    const buffs = getFieldBuffs(user);
    const buff = buffs.receivedDamageMultiplier;
    if (!buff || Number(buff.expired_at || 0) <= Date.now()) {
        if (buffs.receivedDamageMultiplier) delete buffs.receivedDamageMultiplier;
        return 1;
    }
    return Math.max(0, Number(buff.value || 1));
}

function getEliteState(fieldName) {
    if (!eliteFieldStates[fieldName]) eliteFieldStates[fieldName] = { owner: null, defeatedAt: 0 };
    return eliteFieldStates[fieldName];
}

let eliteStatePersistTimer = null;
function persistEliteState() {
    if (eliteStatePersistTimer) return;
    eliteStatePersistTimer = setTimeout(() => {
        eliteStatePersistTimer = null;
        saveRpgeniusDataEntry('EliteState', eliteFieldStates).catch(e => console.error('EliteState 저장 실패:', e.message));
    }, 1000);
}

function releaseEliteEncounter(user) {
    if (!user || !user.field || !user.field.name) return;
    const state = getEliteState(user.field.name);
    if (state.owner == user.name) { state.owner = null; persistEliteState(); }
}

function getExtraSkills() {
    return readJson(EXTRA_SKILLS_PATH, []);
}

function getExtraSkillById(id) {
    const skills = getExtraSkills();
    return skills[Number(id)] || null;
}

function findExtraSkillIdByName(name) {
    const skills = getExtraSkills();
    const idx = skills.findIndex(skill => skill && skill.name == name);
    return idx == -1 ? null : idx;
}

function getWorldBossList() {
    return readJson(WORLD_BOSS_PATH, []);
}

function findWorldBossByName(name) {
    return getWorldBossList().find(boss => boss && boss.name == name) || null;
}

function getWorldBossState(bossName) {
    if (!worldBossStates[bossName]) {
        const boss = findWorldBossByName(bossName);
        const now = Date.now();
        worldBossStates[bossName] = {
            hp: boss ? Number(boss.hp || 0) : 0,
            revivedAt: now,
            defeatedAt: 0,
            defeatedBy: null,
            contributions: {},
            claimedRewards: {},
            rankRewards: {},
            rankRewardsDistributed: false
        };
    }
    const state = worldBossStates[bossName];
    if (!state.contributions || typeof state.contributions != 'object') state.contributions = {};
    if (!state.claimedRewards || typeof state.claimedRewards != 'object') state.claimedRewards = {};
    if (!state.rankRewards || typeof state.rankRewards != 'object') state.rankRewards = {};
    if (typeof state.rankRewardsDistributed == 'undefined') state.rankRewardsDistributed = false;
    if (!state.revivedAt && Number(state.hp || 0) > 0) state.revivedAt = Date.now();
    return state;
}

let worldBossStatePersistTimer = null;
function persistWorldBossState() {
    if (worldBossStatePersistTimer) return;
    worldBossStatePersistTimer = setTimeout(() => {
        worldBossStatePersistTimer = null;
        saveRpgeniusDataEntry('WorldBossState', worldBossStates).catch(e => console.error('WorldBossState 저장 실패:', e.message));
    }, 1000);
}

function getWorldBossRespawnTimestamp(state) {
    if (!state || !state.defeatedAt) return 0;
    const defeated = new Date(Number(state.defeatedAt));
    const respawnDate = new Date(defeated.getTime() + 9 * 60 * 60 * 1000);
    respawnDate.setUTCDate(respawnDate.getUTCDate() + 1);
    respawnDate.setUTCHours(18, 0, 0, 0);
    return respawnDate.getTime() - 9 * 60 * 60 * 1000;
}

function forceDefeatExpiredWorldBoss(boss) {
    const state = getWorldBossState(boss.name);
    if (Number(state.hp || 0) <= 0) return state;
    if (!state.revivedAt) state.revivedAt = Date.now();
    if (Date.now() < Number(state.revivedAt || 0) + WORLD_BOSS_FORCE_DEFEAT_MS) return state;
    state.hp = 0;
    state.defeatedAt = Date.now();
    state.defeatedBy = '시간 초과';
    persistWorldBossState();
    return state;
}

function isWorldBossAlive(boss) {
    forceDefeatExpiredWorldBoss(boss);
    const state = getWorldBossState(boss.name);
    if (Number(state.hp || 0) > 0) return true;
    return Date.now() >= getWorldBossRespawnTimestamp(state);
}

function ensureWorldBossRevived(boss) {
    const state = getWorldBossState(boss.name);
    forceDefeatExpiredWorldBoss(boss);
    if (Number(state.hp || 0) > 0) return state;
    if (Date.now() < getWorldBossRespawnTimestamp(state)) return state;
    state.hp = Number(boss.hp || 0);
    state.revivedAt = Date.now();
    state.defeatedAt = 0;
    state.defeatedBy = null;
    state.contributions = {};
    state.claimedRewards = {};
    state.rankRewards = {};
    state.rankRewardsDistributed = false;
    persistWorldBossState();
    return state;
}

function getWorldBossContributionRanking() {
    const totals = {};
    getWorldBossList().forEach(boss => {
        const state = ensureWorldBossRevived(boss);
        Object.entries(state.contributions || {}).forEach(([name, damage]) => {
            const value = Number(damage || 0);
            if (value <= 0) return;
            totals[name] = Number(totals[name] || 0) + value;
        });
    });
    return Object.entries(totals)
        .map(([name, value]) => ({ name, value }))
        .filter(entry => Number(entry.value || 0) > 0)
        .sort((a, b) => Number(b.value || 0) - Number(a.value || 0) || a.name.localeCompare(b.name, 'ko-KR'))
        .map((entry, i) => ({ rank: i + 1, name: entry.name, value: Math.round(Number(entry.value || 0)) }));
}

function getWorldBossDailyState(user) {
    const today = getKoreanDateKey(new Date());
    if (!user.worldBossDaily || user.worldBossDaily.date != today) user.worldBossDaily = { date: today, count: 0, tokenCount: 0 };
    user.worldBossDaily.tokenCount = Number(user.worldBossDaily.tokenCount || 0);
    return user.worldBossDaily;
}

function getValorTokenItemId() {
    const items = getDataCache('Item', []);
    return items.findIndex(item => item && item.name == WORLD_BOSS_VALOR_TOKEN_NAME);
}

function grantWorldBossRewardItems(user, rewardItems, lines) {
    const items = getDataCache('Item', []);
    let granted = 0;
    (rewardItems || []).forEach(it => {
        const count = rollCount(it.count);
        if (count <= 0) return;
        if (it.type == '골드') {
            user.gold = Number(user.gold || 0) + count;
            if (lines) lines.push('- 🪙 ' + comma(count));
            granted++;
            return;
        }
        if (it.type == '가넷') {
            user.garnet = Number(user.garnet || 0) + count;
            if (lines) lines.push('- 💠 ' + comma(count));
            granted++;
            return;
        }
        if (it.type == '아이템') {
            const itemId = Number(it.item_id);
            const item = items[itemId];
            if (!item) {
                if (lines) lines.push('- (아이템 누락) item_id=' + itemId);
                return;
            }
            addInventoryItem(user, itemId, count);
            if (lines) lines.push('- ' + item.name + ' x' + comma(count));
            granted++;
        }
    });
    return granted;
}

function grantWorldBossThresholdRewards(user, boss, state, lines, title) {
    const contributed = Number(state.contributions && state.contributions[user.name] || 0);
    if (contributed <= 0) return 0;
    const claimedMax = Number(state.claimedRewards && state.claimedRewards[user.name] || 0);
    const newRewards = (boss.rewards || []).filter(r => Number(r.threshold || 0) > claimedMax && contributed >= Number(r.threshold || 0));
    if (newRewards.length == 0) return 0;
    if (lines && title) {
        lines.push('', title);
        lines.push('- 누적 피해: ' + comma(contributed));
    }
    let highestThreshold = claimedMax;
    let granted = 0;
    newRewards.forEach(reward => {
        granted += grantWorldBossRewardItems(user, reward.items || [], lines);
        if (Number(reward.threshold || 0) > highestThreshold) highestThreshold = Number(reward.threshold || 0);
    });
    state.claimedRewards[user.name] = highestThreshold;
    persistWorldBossState();
    return granted;
}

function getWorldBossRankRewardForRank(boss, rank) {
    return (boss.rankRewards || []).filter(reward => {
        if (!reward) return false;
        if (typeof reward.rank != 'undefined') return Number(reward.rank) == Number(rank);
        const minRank = Number(reward.minRank || reward.from || 0);
        const maxRank = Number(reward.maxRank || reward.to || minRank);
        return minRank > 0 && rank >= minRank && rank <= maxRank;
    });
}

async function grantWorldBossRankRewards(defeater, boss, state, lines) {
    if (state.rankRewardsDistributed) return 0;
    const rankings = Object.entries(state.contributions || {})
        .map(([name, value]) => ({ name, value: Number(value || 0) }))
        .filter(entry => entry.value > 0)
        .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name, 'ko-KR'))
        .map((entry, i) => Object.assign(entry, { rank: i + 1 }));
    let grantedUsers = 0;
    for (const entry of rankings) {
        const rewards = getWorldBossRankRewardForRank(boss, entry.rank);
        if (rewards.length == 0) continue;
        const target = entry.name == defeater.name ? defeater : await getRPGUserByName(entry.name);
        if (!target) continue;
        const rewardLines = [];
        let granted = 0;
        rewards.forEach(reward => { granted += grantWorldBossRewardItems(target, reward.items || [], rewardLines); });
        if (granted <= 0) continue;
        if (!state.rankRewards) state.rankRewards = {};
        state.rankRewards[entry.name] = { rank: entry.rank, damage: Math.round(entry.value), rewardedAt: Date.now() };
        if (target !== defeater) await target.save();
        if (entry.name == defeater.name && lines) {
            lines.push('', '[ 월드보스 딜기여 랭킹 보상 ]');
            lines.push('- 순위: ' + entry.rank + '위 / 피해: ' + comma(entry.value));
            rewardLines.forEach(line => lines.push(line));
        }
        grantedUsers++;
    }
    state.rankRewardsDistributed = true;
    persistWorldBossState();
    return grantedUsers;
}

function tryEncounterElite(user, dungeon, lines) {
    if (!dungeon.elite || !user.field || user.field.elite) return;
    if (Number(user.field.killCount || 0) < ELITE_KILL_REQUIREMENT) return;
    const state = getEliteState(dungeon.name);
    if (state.owner || Date.now() - Number(state.defeatedAt || 0) < ELITE_RESPAWN_COOLDOWN) return;
    if (Math.random() >= ELITE_ENCOUNTER_RATE) return;
    state.owner = user.name;
    persistEliteState();
    user.field.elite = { hp: Number(dungeon.elite.hp || 0), encounteredAt: Date.now() };
    lines.push('', '⚠️ 엘리트 몬스터 조우!');
    lines.push('- ' + dungeon.elite.name + '이(가) 나타났습니다!');
}

function applyEliteReward(user, dungeon, slotEffects, extra, lines) {
    const items = getDataCache('Item', []);
    const stats = calculateUserStats(user);
    const rewardLines = [];
    let levelUps = 0;
    const levelMultiplier = getLevelExpMultiplier(user.level, dungeon.requireLevel);
    (dungeon.elite.reward || []).forEach(reward => {
        if (reward.roll != null && Math.random() >= Number(reward.roll || 0) * levelMultiplier) return;
        const count = rollCount(reward.count);
        if (reward.type == '경험치') {
            const amount = applyLowLevelExpBonus(user, applyPrestigeExpBonus(user, Math.round(count * levelMultiplier * (1 + Number(slotEffects.expBonus || 0) + Number(stats.exp || 0)))));
            levelUps += addExperience(user, amount);
            rewardLines.push('- XP ' + comma(amount));
            return;
        }
        if (reward.type == '골드') {
            const amount = Math.round((count + Number(stats.plusGold || 0)) * levelMultiplier * (1 + Number(slotEffects.goldBonus || 0) + Number(extra && extra.goldBonus || 0) + Number(stats.gold || 0)));
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
    applyPetRegen(user, stats, null);
    const slotEffects = calculateCardSlotEffects(user);
    const elite = getCombatStats(dungeon.elite);
    const currentHp = Number(user.field.elite && user.field.elite.hp || elite.hp || 0);
    const damageWithSlotBonus = Number(rawDamage || 0) * (1 + slotEffects.damageBonus) * (1 + Number(stats.eliteDmg || 0));
    const hitResult = calculateAttackHitResult(damageWithSlotBonus, elite.def, extra && extra.pnt || stats.pnt, stats, slotEffects, extra, elite);
    const finalDamage = hitResult.finalDamage;
    let remainHp = Math.max(0, currentHp - finalDamage);
    const executedByTaxationGun = remainHp > 0 && Number(elite.hp || 0) > 0 && remainHp / Number(elite.hp || 0) < TAXATION_GUN_EXECUTE_THRESHOLD && hasActiveSupportEquipment(user, TAXATION_GUN_NAME);
    if (executedByTaxationGun) remainHp = 0;
    const maxHp = Number(stats.hp || 0);
    const lines = hitResult.hitCount > 1
        ? formatHitDetailLines(hitResult, '⚔️ ' + elite.name + '에게 ', '피해를 입혔습니다!')
        : ['⚔️ ' + elite.name + '에게 ' + comma(finalDamage) + (hitResult.destinyDamageCount > 0 ? ' 운명' : '') + (hitResult.criticalCount > 0 ? ' 치명타 ' : ' ') + '피해를 입혔습니다!'];
    if (extra && extra.notice) lines.push('- ' + extra.notice);
    if (extra && typeof extra.mpCost != 'undefined') lines.push('- MP ' + comma(extra.mpCost) + ' 소모 (' + comma(extra.mpAfter) + '/' + comma(extra.maxMp) + ')');
    if (hitResult.bonusTripleZero > 0) lines.push('- 0️⃣ 추가 피해 +' + comma(hitResult.bonusTripleZero));
    applyAttackPotentialRecovery(user, stats, lines);
    if (extra && Number(extra.lifeStealFromPreMitigation || 0) > 0) applyFlatSkillRecovery(user, maxHp, damageWithSlotBonus * Number(extra.lifeStealFromPreMitigation || 0), stats, lines);
    if (extra && Number(extra.skillHpRecovery || 0) > 0) applyFlatSkillRecovery(user, maxHp, Number(extra.skillHpRecovery || 0), stats, lines);
    if (extra && Number(extra.skillMpRecovery || 0) > 0) applySkillMpRecovery(user, Number(stats.mp || 0), Number(extra.skillMpRecovery || 0), stats, lines);
    if (!extra || !extra.skipPassiveMpRecovery) {
        const passiveMp = getPassiveMpRecovery(user);
        if (passiveMp > 0) applySkillMpRecovery(user, Number(stats.mp || 0), passiveMp, stats, lines);
    }
    if (executedByTaxationGun) lines.push('- ❌ ' + TAXATION_GUN_NAME + ' 효과: ' + elite.name + ' 처형!');
    if (remainHp <= 0) {
        lines.push('- ' + elite.name + ' 처치!');
        applySkillRecovery(user, maxHp, extra, lines);
        applyEliteReward(user, dungeon, slotEffects, extra, lines);
        const state = getEliteState(dungeon.name);
        state.owner = null;
        state.defeatedAt = Date.now();
        persistEliteState();
        user.field.elite = null;
        if (!(extra && extra.isBotAutoAttack)) setFieldNextActionAt(user, Date.now() + randomInt(2000, 3000));
        return lines.join('\n');
    }
    user.field.elite.hp = remainHp;
    lines.push('- ' + elite.name + ' HP: ' + comma(remainHp) + '/' + comma(elite.hp));
    const avoided = Number(stats.avd || 0) > 0 && Math.random() < Number(stats.avd);
    const monsterHitResult = avoided ? null : calculateMonsterAttackHitResult(elite, stats, slotEffects, extra);
    let fieldDamage = avoided ? 0 : monsterHitResult.finalDamage;
    const beforeHp = typeof user.hp == 'undefined' ? maxHp : Number(user.hp || 0);
    
    if (user.field.iktaeBot && user.field.iktaeBot.hp > 0 && Date.now() < user.field.iktaeBot.expired_at) {
        if (extra && extra.isBotAutoAttack) {
            user.field.iktaeBot.hp -= fieldDamage;
            lines.push('- 익테봇 체력: ' + comma(user.field.iktaeBot.hp) + '(-' + comma(fieldDamage) + ')');
            fieldDamage = 0;
            if (user.field.iktaeBot.hp <= 0) {
                user.field.iktaeBot = null;
                lines.push('💥 익테봇이 파괴되었습니다!');
                clearFieldIktaeBot(user.name);
            }
        } else {
            const absorb = Math.round(fieldDamage * 0.3);
            fieldDamage -= absorb;
            user.field.iktaeBot.hp -= absorb;
            lines.push('🤖 익테봇이 피해를 대신 받았습니다!\n- 익테봇 체력: ' + comma(user.field.iktaeBot.hp) + '(-' + comma(absorb) + ')');
            if (user.field.iktaeBot.hp <= 0) {
                user.field.iktaeBot = null;
                lines.push('💥 익테봇이 파괴되었습니다!');
                clearFieldIktaeBot(user.name);
            }
        }
    }

    user.hp = Math.max(0, beforeHp - fieldDamage);
    if (avoided) lines.push('💨 ' + elite.name + '의 공격을 회피했습니다!');
    else {
        if (monsterHitResult.hitCount > 1) formatHitDetailLines(monsterHitResult, '❗ ' + elite.name + '에게 ', '피해를 입었습니다!').forEach(line => lines.push(line));
        else lines.push('❗ ' + elite.name + '에게 ' + comma(fieldDamage) + (monsterHitResult.criticalCount > 0 ? ' 치명타 ' : ' ') + '피해를 입었습니다!');
    }
    applyDamageTakenSlotRecovery(user, maxHp, fieldDamage, slotEffects, stats, lines);
    applySkillRecovery(user, maxHp, extra, lines);
    if (user.hp <= 0 && !tryImmortalArmorRevive(user, maxHp, lines)) {
        user.hp = 1;
        saveFieldCooldowns(user);
        releaseEliteEncounter(user);
        user.field = null;
        lines.push('- 남은 체력: 1/' + comma(maxHp));
        lines.push('', '💀 보상을 획득하지 못하고 필드에서 퇴장했습니다.');
        return lines.join('\n');
    }
    lines.push('- 남은 체력: ' + comma(user.hp) + '/' + comma(maxHp));
    if (!(extra && extra.isBotAutoAttack)) setFieldNextActionAt(user, Date.now() + randomInt(2000, 3000));
    return lines.join('\n');
}

function buildHuntResult(user, dungeon, rawDamage, extra) {
    const stats = calculateUserStats(user);
    applyPetRegen(user, stats, null);
    const slotEffects = calculateCardSlotEffects(user);
    const monster = getCombatStats(dungeon);
    const damageWithSlotBonus = Number(rawDamage || 0) * (1 + slotEffects.damageBonus) * (1 + Number(stats.damageBonus || 0));
    const hitResult = calculateAttackHitResult(damageWithSlotBonus, monster.def, extra && extra.pnt || stats.pnt, stats, slotEffects, extra, monster);
    const finalDamage = hitResult.finalDamage;
    let killCount = Math.floor(finalDamage / Number(monster.hp || 1));
    const requireLevel = Number(dungeon.requireLevel || 1);
    const levelDiff = Number(user.level || 1) - requireLevel;
    const overLeveledCap = levelDiff >= BIG_LEVEL_DIFF_THRESHOLD;
    let killCapNote = null;
    if (overLeveledCap && killCount > BIG_LEVEL_DIFF_KILL_CAP) {
        killCount = BIG_LEVEL_DIFF_KILL_CAP
    }
    let goldMineCapNote = null;
    let goldMineLimitReached = false;
    if (typeof dungeon.goldMineLevel != 'undefined') {
        const today = getKoreanDateKey(new Date());
        if (!user.goldMineDaily || user.goldMineDaily.date != today) user.goldMineDaily = { date: today, count: 0 };
        const used = Number(user.goldMineDaily.count || 0);
        const remaining = Math.max(0, GOLD_MINE_DAILY_KILL_LIMIT - used);
        if (remaining <= 0) {
            killCount = 0;
            goldMineLimitReached = true;
        } else if (killCount > remaining) {
            killCount = remaining;
            goldMineCapNote = '- ⛏️ 황금 광산 일일 처치 한도(' + comma(GOLD_MINE_DAILY_KILL_LIMIT) + '마리) 도달. ' + comma(remaining) + '마리만 처치되었습니다.';
        }
    }
    const avoided = Number(stats.avd || 0) > 0 && Math.random() < Number(stats.avd);
    const monsterHitResult = avoided ? null : calculateMonsterAttackHitResult(monster, stats, slotEffects, extra);
    let fieldDamage = avoided ? 0 : monsterHitResult.finalDamage;
    const maxHp = Number(stats.hp || 0);
    const beforeHp = typeof user.hp == 'undefined' ? maxHp : Number(user.hp || 0);

    const lines = hitResult.hitCount > 1
        ? formatHitDetailLines(hitResult, '⚔️ ', '피해를 입혔습니다!')
        : ['⚔️ ' + comma(finalDamage) + (hitResult.destinyDamageCount > 0 ? ' 운명' : '') + (hitResult.criticalCount > 0 ? ' 치명타 ' : ' ') + '피해를 입혔습니다!'];

    if (user.field.iktaeBot && user.field.iktaeBot.hp > 0 && Date.now() < user.field.iktaeBot.expired_at) {
        if (extra && extra.isBotAutoAttack) {
            user.field.iktaeBot.hp -= fieldDamage;
            lines.push('- 익테봇 체력: ' + comma(user.field.iktaeBot.hp) + '(-' + comma(fieldDamage) + ')');
            fieldDamage = 0;
            if (user.field.iktaeBot.hp <= 0) {
                user.field.iktaeBot = null;
                lines.push('💥 익테봇이 파괴되었습니다!');
                clearFieldIktaeBot(user.name);
            }
        } else {
            const absorb = Math.round(fieldDamage * 0.3);
            fieldDamage -= absorb;
            user.field.iktaeBot.hp -= absorb;
            lines.push('🤖 익테봇이 피해를 대신 받았습니다!\n- 익테봇 체력: ' + comma(user.field.iktaeBot.hp) + '(-' + comma(absorb) + ')');
            if (user.field.iktaeBot.hp <= 0) {
                user.field.iktaeBot = null;
                lines.push('💥 익테봇이 파괴되었습니다!');
                clearFieldIktaeBot(user.name);
            }
        }
    }

    user.hp = Math.max(0, beforeHp - fieldDamage);
    if (extra && extra.notice) lines.push('- ' + extra.notice);
    lines.push('- 총 ' + comma(killCount) + '마리 처치');
    if (killCapNote) lines.push(killCapNote);
    if (goldMineCapNote) lines.push(goldMineCapNote);
    if (goldMineLimitReached) lines.push('- ⛏️ 오늘은 황금 광산에서 더 이상 사냥할 수 없습니다. (일일 한도 ' + comma(GOLD_MINE_DAILY_KILL_LIMIT) + '마리 도달)');
    if (extra && typeof extra.mpCost != 'undefined') lines.push('- MP ' + comma(extra.mpCost) + ' 소모 (' + comma(extra.mpAfter) + '/' + comma(extra.maxMp) + ')');
    if (hitResult.bonusTripleZero > 0) lines.push('- 0️⃣ 추가 피해 +' + comma(hitResult.bonusTripleZero));
    applyAttackPotentialRecovery(user, stats, lines);
    if (extra && Number(extra.lifeStealFromPreMitigation || 0) > 0) applyFlatSkillRecovery(user, maxHp, damageWithSlotBonus * Number(extra.lifeStealFromPreMitigation || 0), stats, lines);
    if (extra && Number(extra.skillHpRecovery || 0) > 0) applyFlatSkillRecovery(user, maxHp, Number(extra.skillHpRecovery || 0), stats, lines);
    if (extra && Number(extra.skillMpRecovery || 0) > 0) applySkillMpRecovery(user, Number(stats.mp || 0), Number(extra.skillMpRecovery || 0), stats, lines);
    if (!extra || !extra.skipPassiveMpRecovery) {
        const passiveMp = getPassiveMpRecovery(user);
        if (passiveMp > 0) applySkillMpRecovery(user, Number(stats.mp || 0), passiveMp, stats, lines);
    }
    if (avoided) lines.push('💨 필드 피해를 회피했습니다!');
    else {
        if (monsterHitResult.hitCount > 1) formatHitDetailLines(monsterHitResult, '❗ ', '피해를 입었습니다!').forEach(line => lines.push(line));
        else lines.push('❗ ' + comma(fieldDamage) + (monsterHitResult.criticalCount > 0 ? ' 치명타 ' : ' ') + '피해를 입었습니다!');
    }
    applyDamageTakenSlotRecovery(user, maxHp, fieldDamage, slotEffects, stats, lines);
    applySkillRecovery(user, maxHp, extra, lines);

    if (user.hp <= 0 && !tryImmortalArmorRevive(user, maxHp, lines)) {
        user.hp = 1;
        saveFieldCooldowns(user);
        user.field = null;
        lines.push('- 남은 체력: 1/' + comma(maxHp));
        lines.push('', '💀 보상을 획득하지 못하고 필드에서 퇴장했습니다.');
        return lines.join('\n');
    }

    lines.push('- 남은 체력: ' + comma(user.hp) + '/' + comma(maxHp));

    const levelMultiplier = getLevelExpMultiplier(user.level, dungeon.requireLevel);
    if (killCount > 0) {
        user.field.killCount = Number(user.field.killCount || 0) + killCount;
        if (typeof dungeon.goldMineLevel != 'undefined' && user.goldMineDaily) {
            user.goldMineDaily.count = Number(user.goldMineDaily.count || 0) + killCount;
        }
        let expReward = applyLowLevelExpBonus(user, applyPrestigeExpBonus(user, Math.round(Number(dungeon.reward && dungeon.reward.exp || 0) * killCount * levelMultiplier * (1 + slotEffects.expBonus + Number(stats.exp || 0)))));
        let goldReward = 0;
        for (let i = 0; i < killCount; i++) goldReward += randomInt(Number(dungeon.reward.gold.min || 0), Number(dungeon.reward.gold.max || 0)) + Number(stats.plusGold || 0);
        goldReward = Math.round(goldReward * levelMultiplier * (1 + slotEffects.goldBonus + Number(extra && extra.goldBonus || 0) + Number(stats.gold || 0)));
        user.gold = Number(user.gold || 0) + goldReward;
        const levelUps = addExperience(user, expReward);
        lines.push('', '[ 보상 ]');
        lines.push('- XP ' + comma(expReward));
        lines.push('- 🪙 ' + comma(goldReward));
        const dropMultiplier = 1 + Number(slotEffects.itemDropChance || 0) + Number(stats.itemDropChance || 0);
        let stoneDropCount = 0;
        for (let i = 0; i < killCount; i++) if (Math.random() < 0.2 * dropMultiplier * levelMultiplier) stoneDropCount++;
        if (stoneDropCount > 0) {
            addInventoryItem(user, EQUIPMENT_STONE_ITEM_ID, stoneDropCount);
            lines.push('- 강화석 x' + comma(stoneDropCount));
        }
        const items = getDataCache('Item', []);
        const baitItemId = items.findIndex(item => item.name == '일반 떡밥');
        let baitDropCount = 0;
        for (let i = 0; i < killCount; i++) if (Math.random() < 0.35 * dropMultiplier * levelMultiplier) baitDropCount++;
        if (baitItemId != -1 && baitDropCount > 0) {
            addInventoryItem(user, baitItemId, baitDropCount);
            lines.push('- 일반 떡밥 x' + comma(baitDropCount));
        }
        if (levelUps > 0) lines.push('- 레벨업! Lv. ' + user.level);
    }

    if (killCount > 0) {
        const dropMultiplier = 1 + Number(slotEffects.itemDropChance || 0) + Number(stats.itemDropChance || 0);
        const dropChance = 0.03 * dropMultiplier * levelMultiplier;
        if (Math.random() < dropChance) {
            const items = getDataCache('Item', []);
            const equipBoxName = Number(dungeon.requireLevel || 0) >= 71
                ? (Math.random() < 0.7 ? '중급 장비 상자' : '보조 장비 상자')
                : '장비 상자';
            const dropItemId = items.findIndex(item => item.name == equipBoxName);
            if (dropItemId != -1) {
                addInventoryItem(user, dropItemId, 1);
                lines.push('- 📦 ' + items[dropItemId].name + ' 획득!');
            }
        }
        if (Math.random() < dropChance) {
            const items = getDataCache('Item', []);
            const dropItemId = items.findIndex(item => item.name == '카드팩 상자');
            if (dropItemId != -1) {
                addInventoryItem(user, dropItemId, 1);
                lines.push('- 📦 ' + items[dropItemId].name + ' 획득!');
            }
        }
        const oreInfo = GOLD_MINE_ORE_DROPS[Number(dungeon.goldMineLevel || 0)];
        if (oreInfo) {
            const items = getDataCache('Item', []);
            const oreItemId = items.findIndex(item => item.name == oreInfo.name);
            if (oreItemId != -1) {
                let oreDropCount = 0;
                for (let i = 0; i < killCount; i++) if (Math.random() < oreInfo.chance * dropMultiplier * levelMultiplier) oreDropCount++;
                if (oreDropCount > 0) {
                    addInventoryItem(user, oreItemId, oreDropCount);
                    lines.push('- ⛏️ ' + oreInfo.name + ' x' + comma(oreDropCount));
                }
            }
        }
        if (Math.random() < 0.01 * dropMultiplier * levelMultiplier) {
            const items = getDataCache('Item', []);
            const dropItemId = items.findIndex(item => item.name == '투표 용지');
            if (dropItemId != -1) {
                addInventoryItem(user, dropItemId, 1);
                lines.push('- 📃 [이벤트]' + items[dropItemId].name + ' 획득!');
            }
        }
    }

    if (!(extra && extra.isBotAutoAttack)) setFieldNextActionAt(user, Date.now() + randomInt(2000, 3000));
    if (killCount > 0) tryEncounterFragment(user, dungeon, lines);
    if (killCount > 0) tryEncounterElite(user, dungeon, lines);
    return lines.join('\n');
}

function getFragmentTierForDungeon(dungeon) {
    if (!dungeon || typeof dungeon.goldMineLevel != 'undefined') return null;
    const lvl = Number(dungeon.requireLevel || 0);
    if (!lvl) return null;
    for (const tier of ['low', 'mid', 'high']) {
        const cfg = FRAGMENT_TIERS[tier];
        if (lvl >= cfg.minLevel && lvl <= cfg.maxLevel) return tier;
    }
    return null;
}

function tryEncounterFragment(user, dungeon, lines) {
    if (user.pendingFragment) return;
    const tier = getFragmentTierForDungeon(dungeon);
    if (!tier) return;
    const cfg = FRAGMENT_TIERS[tier];
    if (Math.random() >= cfg.chance) return;
    user.pendingFragment = tier;
    const autoChance = getActivePetSpecials(user).autoFragment;
    if (autoChance > 0 && Math.random() < autoChance) {
        lines.push('', '✨ ' + cfg.name + '이(가) 등장했습니다!');
        lines.push('🐾 펫 효과로 자동 사용했습니다.');
        lines.push(consumeFragment(user));
        return;
    }
    lines.push('', '✨ ' + cfg.name + '이(가) 등장했습니다!');
    lines.push('🔓 /RPGenius 편린 명령어로 사용해야 다른 명령을 사용할 수 있습니다.');
}

function useBasicAttackInField(user, channel) {
    if (!user.field || !user.field.name) return '❌ 필드에 입장한 상태가 아닙니다.';
    if (channel) activeFieldChannels[user.name] = channel;
    if (user.field.iktaeBot) ensureFieldIktaeBotTimer(user, channel);
    const now = Date.now();
    if (now < Number(user.field.nextActionAt || 0)) return '❌ 아직 행동할 수 없습니다. (' + Math.ceil((user.field.nextActionAt - now) / 1000) + '초)';
    const context = getFieldCombatContext(user);
    if (context.error) return context.error;
    if (context.type == 'worldBoss') ensureWorldBossSkillTimer(user, channel);
    const stats = calculateUserStats(user);
    const slotEffects = calculateCardSlotEffects(user);
    const buffs = getFieldBuffs(user);
    const nextBasicBuff = buffs.nextBasicDamageBonus;
    const nextBasicBonus = nextBasicBuff && Number(nextBasicBuff.value || 0) > 0 ? Number(nextBasicBuff.value || 0) : 0;
    if (nextBasicBuff) delete buffs.nextBasicDamageBonus;
    const rawDamage = Math.round(Number(stats.atk || 0) * (1 + Number(stats.afterBasic || 0) + Number(slotEffects.basicDamageBonus || 0) + nextBasicBonus));
    const extra = {};
    extra.receivedDamageReduction = getActiveFieldDamageReduction(user);
    if (nextBasicBonus > 0) extra.notice = '자인 효과: 다음 일반 공격 피해 +' + (Math.round(nextBasicBonus * 1000) / 10) + '%';
    return applyFieldDamageAction(user, context, rawDamage, extra, 'basic', null);
}

function getFieldCombatContext(user) {
    if (!user.field || !user.field.name) return { error: '❌ 필드에 입장한 상태가 아닙니다.' };
    if (user.field.worldBoss) {
        const boss = findWorldBossByName(user.field.name);
        if (!boss) return { error: '❌ 월드보스 데이터를 찾을 수 없습니다.' };
        return { type: 'worldBoss', boss: boss };
    }
    const dungeon = findDungeonByName(user.field.name);
    if (!dungeon) return { error: '❌ 현재 필드를 찾을 수 없습니다.' };
    return { type: user.field.elite ? 'elite' : 'normal', dungeon: dungeon };
}

function applyFieldDamageAction(user, context, rawDamage, extra, actionType, skill) {
    extra = extra || {};
    if (actionType === 'skill') extra.isSkill = true;
    if (actionType === 'basic') extra.isBasic = true;
    if (context.type == 'worldBoss') return applyWorldBossDamageAction(user, context.boss, rawDamage, extra, actionType, skill);
    if (context.type == 'elite') return buildEliteHuntResult(user, context.dungeon, rawDamage, extra);
    return buildHuntResult(user, context.dungeon, rawDamage, extra);
}

async function applyWorldBossDamageAction(user, boss, rawDamage, extra, actionType, skill) {
    const stats = calculateUserStats(user);
    applyPetRegen(user, stats, null);
    const slotEffects = calculateCardSlotEffects(user);
    forceDefeatExpiredWorldBoss(boss);
    const state = getWorldBossState(boss.name);
    if (Number(state.hp || 0) <= 0) {
        const lines = ['❌ ' + boss.name + '은(는) 이미 사망 상태입니다.'];
        if (!state.rankRewardsDistributed) await grantWorldBossRankRewards(user, boss, state, lines);
        clearWorldBossSkillTimer(user.name);
        user.field = null;
        return lines.join('\n');
    }
    const damage = actionType == 'skill' ? Number(rawDamage || 0) * (1 + Number(slotEffects.damageBonus || 0)) : rawDamage;
    const result = dealDamageToWorldBoss(user, boss, damage, extra || {});
    const prefix = actionType == 'skill' && skill ? '✨ ' + skill.name + '! ' : '⚔️ ';
    const lines = formatWorldBossDamageLines(boss, result, prefix);
    if (extra && extra.notice) lines.push('- ' + extra.notice);
    if (extra && typeof extra.mpCost != 'undefined') lines.push('- MP ' + comma(extra.mpCost) + ' 소모 (' + comma(extra.mpAfter) + '/' + comma(extra.maxMp) + ')');
    if (Number(result.bonusTripleZero || 0) > 0) lines.push('- 0️⃣ 추가 피해 +' + comma(result.bonusTripleZero));
    grantWorldBossThresholdRewards(user, boss, getWorldBossState(boss.name), lines, '[ 월드보스 딜량 달성 보상 ]');
    if (extra && Number(extra.lifeStealFromPreMitigation || 0) > 0) applyFlatSkillRecovery(user, Number(stats.hp || 0), damage * Number(extra.lifeStealFromPreMitigation || 0), stats, lines);
    if (extra && Number(extra.skillHpRecovery || 0) > 0) applyFlatSkillRecovery(user, Number(stats.hp || 0), Number(extra.skillHpRecovery || 0), stats, lines);
    if (extra && Number(extra.skillMpRecovery || 0) > 0) applySkillMpRecovery(user, Number(stats.mp || 0), Number(extra.skillMpRecovery || 0), stats, lines);
    if (!extra || !extra.skipPassiveMpRecovery) {
        const passiveMp = actionType == 'skill' ? getPassiveMpRecovery(user) : 0;
        if (passiveMp > 0) applySkillMpRecovery(user, Number(stats.mp || 0), passiveMp, stats, lines);
    }
    appendWorldBossStatusLines(lines, user, boss, result);
    if (Number(result.after) <= 0) await finalizeWorldBossDefeat(user, boss, lines);
    setWorldBossNextActionAt(user);
    return lines.join('\n');
}

function useSkillInField(user, skillName, channel) {
    if (!user.field || !user.field.name) return '❌ 필드에 입장한 상태가 아닙니다.';
    if (channel) activeFieldChannels[user.name] = channel;
    if (user.field.iktaeBot) ensureFieldIktaeBotTimer(user, channel);
    if (user.field.worldBoss) {
        ensureWorldBossSkillTimer(user, channel);
        if (skillName && findUsableSkill(user, skillName)) return executeMainCardSkillInField(user, skillName);
        return useWorldBossChosenSkill(user, skillName);
    }
    return executeMainCardSkillInField(user, skillName);
}

function executeMainCardSkillInField(user, skillName) {
    if (!user.field || !user.field.name) return '❌ 필드에 입장한 상태가 아닙니다.';
    const now = Date.now();
    if (now < Number(user.field.nextActionAt || 0)) return '❌ 아직 행동할 수 없습니다. (' + Math.ceil((user.field.nextActionAt - now) / 1000) + '초)';
    if (!user.field.skillCooldowns) user.field.skillCooldowns = {};
    const skillData = findUsableSkill(user, skillName);
    if (!skillData) return '❌ 사용할 수 없는 스킬입니다.';
    const cooldownEnd = Number(user.field.skillCooldowns[skillData.skill.name] || 0);
    if (now < cooldownEnd) return '❌ 스킬 쿨타임입니다. (' + Math.ceil((cooldownEnd - now) / 1000) + '초)';

    const context = getFieldCombatContext(user);
    if (context.error) return context.error;
    const isWorldBoss = context.type == 'worldBoss';
    const dungeon = context.dungeon;
    const boss = context.boss;
    const stats = calculateUserStats(user);
    const slotEffects = calculateCardSlotEffects(user);
    const maxMp = Number(stats.mp || 0);
    const mp = typeof user.mp == 'undefined' ? maxMp : Number(user.mp || 0);
    const mpCost = Math.max(0, Math.round(Number(skillData.skill.mp_cost || 0) * (1 - Math.min(1, slotEffects.mpCostReduction)) * (1 + Number(stats.mpReduce || 0))));
    if (mp < mpCost) return '❌ MP가 부족합니다.';
    user.mp = mp - mpCost;

    const star = Number(user.main_card && user.main_card.star || 0);
    let multiplier = getSkillValue(skillData.skill, 0, star);
    const extra = {};
    extra.mpCost = mpCost;
    extra.mpAfter = user.mp;
    extra.maxMp = maxMp;
    extra.receivedDamageReduction = getActiveFieldDamageReduction(user);
    if (skillData.skill.name == '글버지') {
        const heal = getSkillValue(skillData.skill, 0, star) + Number(stats.atk || 0) * getSkillValue(skillData.skill, 1, star);
        const lines = ['✨ 글버지를 사용했습니다.', '- MP ' + comma(mpCost) + ' 소모 (' + comma(user.mp) + '/' + comma(maxMp) + ')'];
        applyFlatSkillRecovery(user, Number(stats.hp || 0), heal, stats, lines);
        const cooltime = Math.max(0, Number(skillData.skill.cooltime || 0) + Number(stats.skillCooldown || 0));
        user.field.skillCooldowns[skillData.skill.name] = now + cooltime;
        if (!isWorldBoss) getFieldCooldowns(user).skillCooldowns = user.field.skillCooldowns;
        if (isWorldBoss) setWorldBossNextActionAt(user);
        else setFieldNextActionAt(user, Date.now() + randomInt(2000, 3000));
        return lines.join('\n');
    }
    if (skillData.skill.name == '자인') getFieldBuffs(user).nextBasicDamageBonus = { value: getSkillValue(skillData.skill, 1, star) };
    if (skillData.skill.name == '시벌론') extra.lifeStealFromPreMitigation = getSkillValue(skillData.skill, 1, star);
    if (skillData.skill.name == '불사조') {
        extra.damageBonusMul = Number(stats.crit || 0) * 0.5;
        extra.receivedDamageMul = 1.5;
        if (isWorldBoss) getFieldBuffs(user).receivedDamageMultiplier = { value: 1.5, expired_at: Date.now() + 8000 };
    }
    if (skillData.skill.name == '피아스트') {
        extra.skillMpRecovery = getSkillValue(skillData.skill, 1, star);
        extra.skipPassiveMpRecovery = true;
    }
    if (skillData.skill.name == '수업끝') {
        extra.disableCritical = true;
        extra.receivedDamageReduction = 0.3;
        getFieldBuffs(user).receivedDamageReduction = { value: 0.3, expired_at: Date.now() + 3000 };
        extra.notice = '수업끝 효과: 3초 동안 받는 피해 30% 감소';
    }
    if (skillData.skill.name == '익테봇 소환') {
        const hpRatio = getSkillValue(skillData.skill, 0, star);
        const atkMul = getSkillValue(skillData.skill, 1, star);
        const botHp = Math.round(Number(stats.hp || 0) * hpRatio);
        const summonDurationBonus = 1 + Number(stats.summonDuration || 0) / 100;
        const durationMs = Math.round(20000 * summonDurationBonus);
        user.field.iktaeBot = { hp: botHp, atkMul: atkMul, expired_at: Date.now() + durationMs };
        const lines = ['✨ 익테봇을 소환했습니다!\n- 익테봇 체력: ' + comma(botHp) + '\n- ' + (durationMs / 1000).toFixed(1) + '초간 유지', '- MP ' + comma(mpCost) + ' 소모 (' + comma(user.mp) + '/' + comma(maxMp) + ')'];
        const cooltime = Math.max(0, Number(skillData.skill.cooltime || 0) + Number(stats.skillCooldown || 0));
        user.field.skillCooldowns[skillData.skill.name] = now + cooltime;
        if (!isWorldBoss) getFieldCooldowns(user).skillCooldowns = user.field.skillCooldowns;
        if (isWorldBoss) setWorldBossNextActionAt(user);
        else setFieldNextActionAt(user, Date.now() + randomInt(2000, 3000));
        startFieldIktaeBot(user.name);
        return lines.join('\n');
    }
    if (skillData.skill.name == 'SUPER EASY') {
        extra.critChanceMul = 0.5;
        extra.critMulBonus = getSkillValue(skillData.skill, 1, star);
    }
    if (skillData.skill.name == '백억이요') extra.goldBonus = getSkillValue(skillData.skill, 1, star);
    if (skillData.skill.name == '청정수 투척') extra.pnt = Number(stats.pnt || 0) + getSkillValue(skillData.skill, 1, star);
    if (skillData.skill.name == '비리') {
        extra.forceCritical = true;
        extra.basicAttackSkill = true;
    }
    if (Number(stats.skillTrueDmg || 0) > 0) extra.skillTrueDmg = Number(stats.skillTrueDmg);
    const rawDamage = extra.basicAttackSkill
        ? Math.round(Number(stats.atk || 0) * multiplier * (1 + Number(stats.afterBasic || 0) + Number(slotEffects.basicDamageBonus || 0)))
        : Math.round(Number(stats.atk || 0) * multiplier * (1 + Number(stats.afterSkill || 0) + Number(slotEffects.skillDamageBonus || 0)));
    const cooltime = Math.max(0, Number(skillData.skill.cooltime || 0) + Number(stats.skillCooldown || 0));
    user.field.skillCooldowns[skillData.skill.name] = now + cooltime;
    if (!isWorldBoss) getFieldCooldowns(user).skillCooldowns = user.field.skillCooldowns;
    return applyFieldDamageAction(user, context, rawDamage, extra, 'skill', skillData.skill);
}

function setWorldBossNextActionAt(user) {
    let cooldown = 2500;
    const buffs = getFieldBuffs(user);
    const buff = buffs.actionCooldownReduction;
    if (buff && Number(buff.expired_at || 0) > Date.now()) {
        cooldown = Math.max(500, cooldown - Number(buff.value || 0));
    } else if (buffs.actionCooldownReduction) {
        delete buffs.actionCooldownReduction;
    }
    setFieldNextActionAt(user, Date.now() + cooldown);
}

function getWorldBossDefenderStats(boss) {
    return {
        def: Number(boss.def || 0),
        critDef: Number(boss.critDef || 0),
        crit: 0,
        critMul: 1,
        cmb: 0,
        maxCmb: 0
    };
}

function dealDamageToWorldBoss(user, boss, rawDamage, opts) {
    const stats = calculateUserStats(user);
    const slotEffects = calculateCardSlotEffects(user);
    const extra = Object.assign({}, opts || {});
    const defenderStats = getWorldBossDefenderStats(boss);
    let finalDamage = 0;
    let isCritical = false;
    let trueDamageCount = 0;
    let destinyDamageCount = 0;
    let bonusTripleZero = 0;
    let hitResult = null;
    if (extra.trueDamage) {
        finalDamage = Math.max(0, Math.round(Number(rawDamage || 0)));
        trueDamageCount = 1;
    } else {
        hitResult = calculateAttackHitResult(Number(rawDamage || 0) * (1 + Number(stats.bossDmg || 0)), boss.def, stats.pnt, stats, slotEffects, extra, defenderStats);
        finalDamage = Math.max(0, Math.round(Number(hitResult.finalDamage || 0)));
        isCritical = Number(hitResult.criticalCount || 0) > 0;
        trueDamageCount = Number(hitResult.trueDamageCount || 0);
        destinyDamageCount = Number(hitResult.destinyDamageCount || 0);
        bonusTripleZero = Number(hitResult.bonusTripleZero || 0);
    }
    const state = ensureWorldBossRevived(boss);
    const before = Number(state.hp || 0);
    const dealt = Math.min(before, finalDamage);
    state.hp = Math.max(0, before - finalDamage);
    state.contributions[user.name] = Number(state.contributions[user.name] || 0) + dealt;
    persistWorldBossState();
    return { damage: finalDamage, dealt: dealt, isCritical: isCritical, trueDamageCount: trueDamageCount, destinyDamageCount: destinyDamageCount, bonusTripleZero: bonusTripleZero, hitResult: hitResult, before: before, after: state.hp };
}

function formatWorldBossDamageLines(boss, result, prefix) {
    const head = prefix || '⚔️ ';
    const target = boss.name + '에게 ';
    if (result.hitResult && Number(result.hitResult.hitCount || 1) > 1) {
        return formatHitDetailLines(result.hitResult, head + target, '피해를 입혔습니다!');
    }
    const damageLabel = Number(result.destinyDamageCount || 0) > 0 ? ' 운명' : (Number(result.trueDamageCount || 0) > 0 ? ' 고정' : '');
    return [head + target + comma(result.damage) + damageLabel + (result.isCritical ? ' 치명타 ' : ' ') + '피해를 입혔습니다!'];
}

async function useWorldBossChosenSkill(user, skillName) {
    const boss = findWorldBossByName(user.field.name);
    if (!boss) return '❌ 월드보스 데이터를 찾을 수 없습니다.';
    forceDefeatExpiredWorldBoss(boss);
    const state = getWorldBossState(boss.name);
    if (Number(state.hp || 0) <= 0) {
        const lines = ['❌ ' + boss.name + '은(는) 이미 사망 상태입니다.'];
        if (!state.rankRewardsDistributed) await grantWorldBossRankRewards(user, boss, state, lines);
        clearWorldBossSkillTimer(user.name);
        user.field = null;
        return lines.join('\n');
    }
    const skillId = Number(user.field.chosenSkillId);
    const skill = getExtraSkillById(skillId);
    if (!skill) return '❌ 선택된 스킬 데이터를 찾을 수 없습니다.';
    if (skillName && skillName != skill.name) return '❌ 이 보스전에서는 ' + skill.name + '만 사용할 수 있습니다.';
    const now = Date.now();
    const isAcceleration = skill.name == '가속';
    if (!isAcceleration && now < Number(user.field.nextActionAt || 0)) return '❌ 아직 행동할 수 없습니다. (' + Math.ceil((user.field.nextActionAt - now) / 1000) + '초)';
    if (!user.field.skillCooldowns) user.field.skillCooldowns = {};
    const cooldownEnd = Number(user.field.skillCooldowns[skill.name] || 0);
    if (now < cooldownEnd) return '❌ 스킬 쿨타임입니다. (' + Math.ceil((cooldownEnd - now) / 1000) + '초)';
    const stats = calculateUserStats(user);
    const slotEffects = calculateCardSlotEffects(user);
    const maxMp = Number(stats.mp || 0);
    const mp = typeof user.mp == 'undefined' ? maxMp : Number(user.mp || 0);
    const mpCost = Math.max(0, Math.round(Number(skill.mp_cost || 0) * (1 - Math.min(1, slotEffects.mpCostReduction)) * (1 + Number(stats.mpReduce || 0))));
    if (mp < mpCost) return '❌ MP가 부족합니다.';
    user.mp = mp - mpCost;
    const cooltime = Math.max(0, Number(skill.cooltime || 0) + Number(stats.skillCooldown || 0));
    user.field.skillCooldowns[skill.name] = now + cooltime;
    const lines = [];
    let dealtSomething = false;
    let result = null;
    if (skill.name == '빙결') {
        const raw = Math.round(getSkillValue(skill, 0, 0) + Number(stats.atk || 0) * getSkillValue(skill, 1, 0));
        result = dealDamageToWorldBoss(user, boss, raw, { isSkill: true });
        user.field.bossSkipNext = true;
        formatWorldBossDamageLines(boss, result, '❄️ 빙결! ').forEach(l => lines.push(l));
        dealtSomething = true;
    } else if (skill.name == '피의 맛') {
        const raw = Math.round(getSkillValue(skill, 0, 0) + Number(stats.atk || 0) * getSkillValue(skill, 1, 0));
        result = dealDamageToWorldBoss(user, boss, raw, { isSkill: true });
        const heal = Number(result.dealt || 0) * getSkillValue(skill, 2, 0);
        formatWorldBossDamageLines(boss, result, '🩸 피의 맛! ').forEach(l => lines.push(l));
        applyFlatSkillRecovery(user, Number(stats.hp || 0), heal, stats, lines);
        dealtSomething = true;
    } else if (skill.name == '가속') {
        const dur = getSkillValue(skill, 0, 0) * 1000;
        const reduce = getSkillValue(skill, 1, 0) * 1000;
        getFieldBuffs(user).actionCooldownReduction = { value: reduce, expired_at: now + dur };
        lines.push('⏩ 가속! ' + (dur / 1000) + '초 동안 행동 쿨타임이 ' + (reduce / 1000) + '초 감소합니다.');
    } else if (skill.name == '카운터') {
        const dur = getSkillValue(skill, 0, 0) * 1000;
        const reduceRate = getSkillValue(skill, 1, 0);
        const flat = getSkillValue(skill, 2, 0);
        const mul = getSkillValue(skill, 3, 0);
        getFieldBuffs(user).counterReady = { expired_at: now + dur, reduceRate: reduceRate, flat: flat, mul: mul };
        lines.push('🛡️ 카운터 준비! ' + (dur / 1000) + '초 동안 보스 스킬을 ' + (Math.round(reduceRate * 100)) + '% 감소시키고 반격합니다.');
    } else if (skill.name == '000') {
        const flat = getSkillValue(skill, 0, 0);
        const critChance = getSkillValue(skill, 1, 0);
        const critFlat = getSkillValue(skill, 2, 0);
        const damage = Math.random() < critChance ? critFlat : flat;
        result = dealDamageToWorldBoss(user, boss, damage, { trueDamage: true, isSkill: true });
        lines.push('0️⃣ 000! ' + boss.name + '에게 ' + comma(result.damage) + ' 고정 피해를 입혔습니다!');
        dealtSomething = true;
    } else if (skill.name == '럭키펀치') {
        if (Math.random() < getSkillValue(skill, 0, 0)) {
            const raw = Math.round(getSkillValue(skill, 1, 0) + Number(stats.atk || 0) * getSkillValue(skill, 2, 0));
            result = dealDamageToWorldBoss(user, boss, raw, { isSkill: true });
            formatWorldBossDamageLines(boss, result, '🍀 럭키펀치 적중! ').forEach(l => lines.push(l));
            dealtSomething = true;
        } else {
            lines.push('💢 럭키펀치 빗나감!');
        }
    } else if (skill.name == '갈취') {
        const raw = Math.round(Number(stats.atk || 0) * getSkillValue(skill, 0, 0));
        result = dealDamageToWorldBoss(user, boss, raw, { isSkill: true });
        const goldMin = getSkillValue(skill, 1, 0);
        const goldMax = getSkillValue(skill, 2, 0);
        const gained = randomInt(Math.round(goldMin), Math.round(goldMax));
        user.gold = Number(user.gold || 0) + gained;
        formatWorldBossDamageLines(boss, result, '💰 갈취! ').forEach(l => lines.push(l));
        lines.push('- 🪙 ' + comma(gained) + ' 획득');
        dealtSomething = true;
    } else if (skill.name == '카르마') {
        const stack = Math.round(Number(user.field.karmaStack || 0));
        if (stack <= 0) {
            lines.push('💢 카르마! 누적된 피해가 없습니다.');
        } else {
            result = dealDamageToWorldBoss(user, boss, stack, { trueDamage: true, isSkill: true });
            user.field.karmaStack = 0;
            lines.push('🌀 카르마! ' + boss.name + '에게 ' + comma(result.damage) + ' 고정 피해를 입혔습니다!');
            dealtSomething = true;
        }
    } else {
        lines.unshift('✨ ' + skill.name + '을(를) 사용했습니다.');
    }
    lines.push('- MP ' + comma(mpCost) + ' 소모 (' + comma(user.mp) + '/' + comma(maxMp) + ')');
    if (result) grantWorldBossThresholdRewards(user, boss, getWorldBossState(boss.name), lines, '[ 월드보스 딜량 달성 보상 ]');
    if (result) appendWorldBossStatusLines(lines, user, boss, result);
    if (result && Number(result.after) <= 0) await finalizeWorldBossDefeat(user, boss, lines);
    else if (!isAcceleration) setWorldBossNextActionAt(user);
    return lines.join('\n');
}

function appendWorldBossStatusLines(lines, user, boss, result) {
    const state = getWorldBossState(boss.name);
    lines.push('- ' + boss.name + ' HP ' + comma(Math.max(0, Number(state.hp || 0))) + '/' + comma(Number(boss.hp || 0)));
    const stats = calculateUserStats(user);
    lines.push('- 남은 체력: ' + comma(Math.max(0, Number(user.hp || 0))) + '/' + comma(Number(stats.hp || 0)));
}

async function finalizeWorldBossDefeat(user, boss, lines) {
    const state = getWorldBossState(boss.name);
    state.hp = 0;
    state.defeatedAt = Date.now();
    if (!state.defeatedBy) state.defeatedBy = user.name;
    persistWorldBossState();
    clearWorldBossSkillTimer(user.name);
    user.field = null;
    lines.push('', '🎉 ' + boss.name + ' 처치!');
    lines.push('- 처치자: ' + state.defeatedBy);
    const rankRewardUsers = await grantWorldBossRankRewards(user, boss, state, lines);
    if (rankRewardUsers > 0) lines.push('- 딜기여 랭킹 보상 지급 완료: ' + comma(rankRewardUsers) + '명');
}

function startWorldBossSkillTimer(user, boss, channel) {
    clearWorldBossSkillTimer(user.name);
    if (channel) worldBossChannels[user.name] = channel;
    const userName = user.name;
    const bossName = boss.name;
    scheduleNextWorldBossSkillTimer(user, boss);
}

function ensureWorldBossSkillTimer(user, channel) {
    if (!user || !user.field || !user.field.worldBoss) return;
    if (channel) worldBossChannels[user.name] = channel;
    if (worldBossSkillTimers[user.name]) return;
    const boss = findWorldBossByName(user.field.name);
    if (!boss) return;
    startWorldBossSkillTimer(user, boss, channel || worldBossChannels[user.name]);
}

function getWorldBossSkillIds(boss) {
    return (boss.skills || []).map(id => Number(id)).filter(id => getExtraSkillById(id));
}

function getNextWorldBossSkillDelay(user, boss, now) {
    const skillIds = getWorldBossSkillIds(boss);
    if (skillIds.length == 0 || !user.field) return null;
    if (!user.field.bossSkillCooldowns) user.field.bossSkillCooldowns = {};
    skillIds.forEach(id => {
        if (typeof user.field.bossSkillCooldowns[id] == 'undefined') {
            const skill = getExtraSkillById(id);
            user.field.bossSkillCooldowns[id] = now + Number(skill.cooltime || WORLD_BOSS_SKILL_INTERVAL);
        }
    });
    const nextAt = Math.min.apply(null, skillIds.map(id => Number(user.field.bossSkillCooldowns[id] || 0)));
    return Math.max(0, nextAt - now);
}

function scheduleNextWorldBossSkillTimer(user, boss) {
    const delay = getNextWorldBossSkillDelay(user, boss, Date.now());
    if (delay === null) return;
    const userName = user.name;
    const bossName = boss.name;
    if (worldBossSkillTimers[userName]) clearTimeout(worldBossSkillTimers[userName]);
    worldBossSkillTimers[userName] = setTimeout(() => runWorldBossSkillTick(userName, bossName).catch(e => console.error('[worldboss tick]', e.message)), delay);
}

function clearWorldBossSkillTimer(name) {
    if (worldBossSkillTimers[name]) {
        clearTimeout(worldBossSkillTimers[name]);
        delete worldBossSkillTimers[name];
    }
    delete worldBossChannels[name];
}

async function runWorldBossSkillTick(userName, bossName) {
    const channel = worldBossChannels[userName];
    const latest = await getRPGUserByName(userName);
    if (!latest) { clearWorldBossSkillTimer(userName); return; }
    if (!latest.field || !latest.field.worldBoss || latest.field.name != bossName) {
        clearWorldBossSkillTimer(userName);
        return;
    }
    const boss = findWorldBossByName(bossName);
    if (!boss) { clearWorldBossSkillTimer(userName); return; }
    forceDefeatExpiredWorldBoss(boss);
    const state = getWorldBossState(bossName);
    if (Number(state.hp || 0) <= 0) {
        if (!state.rankRewardsDistributed) await grantWorldBossRankRewards(latest, boss, state, null);
        clearWorldBossSkillTimer(userName);
        latest.field = null;
        await latest.save();
        return;
    }
    const skillIds = getWorldBossSkillIds(boss);
    if (skillIds.length == 0) return;
    const now = Date.now();
    if (!latest.field.bossSkillCooldowns) latest.field.bossSkillCooldowns = {};
    skillIds.forEach(id => {
        if (typeof latest.field.bossSkillCooldowns[id] == 'undefined') {
            const data = getExtraSkillById(id);
            latest.field.bossSkillCooldowns[id] = now + Number(data.cooltime || WORLD_BOSS_SKILL_INTERVAL);
        }
    });
    const ready = skillIds.filter(id => Number(latest.field.bossSkillCooldowns[id] || 0) <= now);
    if (ready.length == 0) {
        scheduleNextWorldBossSkillTimer(latest, boss);
        await latest.save();
        return;
    }
    const skillId = ready[randomInt(0, ready.length - 1)];
    const skill = getExtraSkillById(skillId);
    latest.field.bossSkillCooldowns[skillId] = now + Number(skill.cooltime || WORLD_BOSS_SKILL_INTERVAL);
    if (latest.field.bossSkipNext) {
        latest.field.bossSkipNext = false;
        await latest.save();
        scheduleNextWorldBossSkillTimer(latest, boss);
        if (channel) channel.sendChat('❄️ ' + boss.name + '이(가) 얼어붙어 공격하지 못했습니다.');
        return;
    }
    const userStats = calculateUserStats(latest);
    applyPetRegen(latest, userStats, null);
    const slotEffects = calculateCardSlotEffects(latest);
    const flat = getSkillValue(skill, 0, 0);
    const mul = getSkillValue(skill, 1, 0);
    const baseDamage = Number(flat || 0) + Number(userStats.atk || 0) * 0;
    if (!latest.field.bossSkillUseCounts) latest.field.bossSkillUseCounts = {};
    const bossSkillUseCount = Number(latest.field.bossSkillUseCounts[skill.name] || 0);
    const rawDamageMultiplier = skill.name == '정권' ? 1 + bossSkillUseCount * 0.15 : 1;
    latest.field.bossSkillUseCounts[skill.name] = bossSkillUseCount + 1;
    const rawDamage = (Number(flat || 0) + Number(boss.atk || 0) * Number(mul || 0)) * rawDamageMultiplier;
    let receivedReduction = Number(latest.field.passiveDamageReduction || 0) + Number(slotEffects.hpDamageReduction || 0);
    receivedReduction = Math.max(0, Math.min(0.95, receivedReduction));
    const activeReceivedReduction = Math.max(0, Math.min(0.95, getActiveFieldDamageReduction(latest)));
    const activeReceivedMultiplier = getActiveFieldDamageMultiplier(latest);
    const buffs = getFieldBuffs(latest);
    const counterBuff = buffs.counterReady;
    const counterActive = counterBuff && Number(counterBuff.expired_at || 0) > now;
    const counterReduction = counterActive ? Number(counterBuff.reduceRate || 0) : 0;
    const reducedDamage = rawDamage * activeReceivedMultiplier * (1 - receivedReduction) * (1 - activeReceivedReduction) * (1 - counterReduction);
    let finalDamage = Math.max(0, Math.round(getDamageAfterDefense(reducedDamage, userStats.def, boss.pnt)));
    const beforeHp = typeof latest.hp == 'undefined' ? Number(userStats.hp || 0) : Number(latest.hp || 0);
    const tickLines = [];
    if (latest.field.iktaeBot && latest.field.iktaeBot.hp > 0 && Date.now() < latest.field.iktaeBot.expired_at) {
        const absorb = Math.round(finalDamage * 0.3);
        finalDamage -= absorb;
        latest.field.iktaeBot.hp -= absorb;
        tickLines.push('🤖 익테봇이 피해를 대신 받았습니다!\n- 익테봇 체력: ' + comma(latest.field.iktaeBot.hp) + '(-' + comma(absorb) + ')');
        if (latest.field.iktaeBot.hp <= 0) {
            latest.field.iktaeBot = null;
            tickLines.push('💥 익테봇이 파괴되었습니다!');
            clearFieldIktaeBot(userName);
        }
    }
    latest.hp = Math.max(0, beforeHp - finalDamage);
    tickLines.unshift('💥 ' + boss.name + '의 ' + skill.name + '! ' + comma(finalDamage) + ' 피해를 입었습니다!');
    applyDamageTakenSlotRecovery(latest, Number(userStats.hp || 0), finalDamage, slotEffects, userStats, tickLines);
    latest.field.karmaStack = Number(latest.field.karmaStack || 0) + finalDamage * 0.30;
    if (counterActive) {
        const counterRaw = Math.round(Number(counterBuff.flat || 0) + Number(userStats.atk || 0) * Number(counterBuff.mul || 0));
        const counterResult = dealDamageToWorldBoss(latest, boss, counterRaw, {});
        delete buffs.counterReady;
        formatWorldBossDamageLines(boss, counterResult, '🛡️ 카운터! ').forEach(l => tickLines.push(l));
        grantWorldBossThresholdRewards(latest, boss, getWorldBossState(boss.name), tickLines, '[ 월드보스 딜량 달성 보상 ]');
        if (Number(counterResult.after) <= 0) {
            await finalizeWorldBossDefeat(latest, boss, tickLines);
            await latest.save();
            if (channel) channel.sendChat(tickLines.join('\n'));
            return;
        }
    }
    tickLines.push('- ' + boss.name + ' HP ' + comma(Math.max(0, Number(state.hp || 0))) + '/' + comma(Number(boss.hp || 0)));
    if (latest.hp <= 0) {
        const reviveLines = [];
        const revived = tryImmortalArmorRevive(latest, Number(userStats.hp || 0), reviveLines);
        if (revived) {
            reviveLines.forEach(line => tickLines.push(line));
            tickLines.push('- 남은 체력: ' + comma(latest.hp) + '/' + comma(Number(userStats.hp || 0)));
        } else {
            clearWorldBossSkillTimer(userName);
            latest.field = null;
            latest.hp = 1;
            tickLines.push('- 남은 체력: 1/' + comma(Number(userStats.hp || 0)));
            tickLines.push('', '💀 ' + boss.name + '에게 패배하고 필드에서 퇴장했습니다.');
        }
    } else {
        tickLines.push('- 남은 체력: ' + comma(latest.hp) + '/' + comma(Number(userStats.hp || 0)));
    }
    if (latest.field && latest.field.worldBoss) scheduleNextWorldBossSkillTimer(latest, boss);
    await latest.save();
    if (channel) channel.sendChat(tickLines.join('\n'));
}

async function claimWorldBossRewards(user) {
    const bosses = getWorldBossList();
    if (bosses.length == 0) return '❌ 월드보스 데이터가 없습니다.';
    const lines = [];
    let totalRewards = 0;
    for (const boss of bosses) {
        forceDefeatExpiredWorldBoss(boss);
        const state = getWorldBossState(boss.name);
        if (Number(state.hp || 0) > 0) continue;
        const contributed = Number(state.contributions && state.contributions[user.name] || 0);
        if (contributed <= 0) continue;
        const before = lines.length;
        totalRewards += grantWorldBossThresholdRewards(user, boss, state, lines, '[ ' + boss.name + ' 딜량 보상 ]');
        if (!state.rankRewardsDistributed) totalRewards += await grantWorldBossRankRewards(user, boss, state, lines);
        if (lines.length == before && state.rankRewards && state.rankRewards[user.name]) {
            const rank = state.rankRewards[user.name];
            lines.push('[ ' + boss.name + ' 딜기여 랭킹 보상 ]');
            lines.push('- 이미 지급됨: ' + rank.rank + '위 / 피해 ' + comma(rank.damage));
        }
    }
    if (totalRewards == 0) return '❌ 수령할 수 있는 월드보스 보상이 없습니다.';
    return '✅ 월드보스 보상을 수령했습니다.\n' + lines.join('\n');
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
    const skin = typeof mainCard.skin == 'string' ? mainCard.skin.trim() : '';
    const candidates = [];
    if (skin) {
        if (user.prestige === true) candidates.push(star + ' 프레스티지 ' + skin + ' ' + card.name + '.png');
        candidates.push(star + ' ' + skin + ' ' + card.name + '.png');
        candidates.push(star + ' ' + card.name + '.png');
    } else {
        if (user.prestige === true) candidates.push(star + ' 프레스티지 ' + card.name + '.png');
        candidates.push(star + ' ' + card.name + '.png');
    }
    const fileName = candidates.find(candidate => fs.existsSync(path.join(CARD_IMAGE_PATH, card.name, candidate)));
    if (!fileName) return;
    const filePath = path.join(CARD_IMAGE_PATH, card.name, fileName);
    if (!fs.existsSync(filePath)) return;
    await channel.sendMedia(node_kakao.KnownChatType.PHOTO, { name: fileName, data: fs.readFileSync(filePath), width: 399, height: 515, ext: 'png' });
}

function formatDescription(name) {
    const items = getDataCache('Item', []);
    const packs = getDataCache('Pack', []);
    const bundles = getDataCache('Bundle', []);

    const item = items.find(data => data.name == name);
    if (item) {
        const lines = ['《 ' + formatNameWithTrade(item) + ' 》 [' + item.type + ']', '- ' + item.desc];
        if (typeof item.sellPrice != 'undefined' && Number(item.sellPrice) > 0) lines.push('- 판매가: 🪙 ' + comma(Number(item.sellPrice)));
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
        return ['《 ' + formatNameWithTrade(equipment.equipment) + ' 》 [' + equipment.equipment.rarity + ' ' + equipment.type + ']', '- ' + equipment.equipment.desc, VIEWMORE, formatEquipmentBaseStatLines(equipment.equipment, 0)].join('\n');
    }

    const pet = findPetByName(name);
    if (pet) {
        return ['《 ' + pet.pet.name + ' 》 [' + pet.pet.rarity + ' 펫]', '- ' + (pet.pet.desc || ''), VIEWMORE, formatPetStatLines(pet.pet)].join('\n');
    }

    return null;
}

function formatInventory(user) {
    const items = getDataCache('Item', []);
    const lines = [
        '[ ' + user.name + '님의 인벤토리 ]',
        '🪙 ' + comma(user.gold),
        '💠 ' + comma(user.garnet),
        '💰 ' + comma(user.point) + 'P | Ⓜ️ ' + comma(user.mileage)
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
    const cards = user.inventory && Array.isArray(user.inventory.card) ? user.inventory.card : [];
    const lines = ['[ ' + user.name + '님의 보유 캐릭터 카드 ]'];
    if (cards.length == 0) {
        lines.push('', '캐릭터 카드가 없습니다.');
        return lines.join('\n');
    }

    lines.push(VIEWMORE);
    cards.forEach((card, index) => {
        const data = characterCards[card.id];
        if (data) lines.push('[' + (index + 1) + '] ' + formatUserCard(card));
    });
    return lines.join('\n');
}

const SUPPORT_STAT_LABELS = {
    atk: '공격력', def: '방어력', hp: '체력', mp: 'MP', pnt: '방어 관통력', plusGold: '처치 당 골드',
    crit: '치명타 확률', critMul: '치명타 피해량', critDef: '치명타 피해 감소율',
    cmb: '연격 확률', maxCmb: '추가 공격 횟수',
    skillCooldown: '스킬 쿨타임', skillTrueDmg: '스킬 사용 시 추가 고정 피해'
};

const SUPPORT_PLUS_STAT_LABELS = {
    atk: '최종 공격력', def: '최종 방어력', hp: '최종 체력', mp: '최종 MP',
    pnt: '방어력 관통',
    gold: '골드 획득량', potion: '물약 효율', recoveryEfficiency: '회복 효율', afterBasic: '일반 공격 피해',
    avd: '회피 확률', afterSkill: '스킬 공격 피해',
    '000': '공격 시 10/100/1000 추가 피해 확률', exp: '경험치 획득량',
    eliteDmg: '엘리트 몬스터 대상 추가 피해', mpReduce: 'MP 소모량',
    itemDropChance: '아이템 획득 확률', crit: '치명타 확률',
    critMul: '치명타 피해량', critDef: '치명타 피해 감소율', cmb: '연격 확률',
    maxCmb: '추가 공격 횟수', skillCooldown: '스킬 쿨타임',
    skillTrueDmg: '스킬 사용 시 추가 고정 피해',
    takenDamage: '받는 피해 증가', damageBonus: '일반 몬스터에게 주는 피해 증가',
    summonDuration: '소환 지속시간'
};

function formatEquippedEquipmentDetail(label, type, equip, user) {
    const title = formatEquippedEquipment(label, type, equip);
    if (!equip || typeof equip.id == 'undefined') return title;
    const data = getEquipmentData(type, equip.id);
    if (!data) return title;
    const level = Number(equip.level || 0);
    const statLines = formatCurrentEquipmentStatLines(data, level, equip && equip.rolled, { soul: equip && equip.soul });
    let out = title + (statLines ? '\n' + statLines : '');
    const soulRemaining = formatSoulRemainingText(equip && equip.soul);
    if (soulRemaining) out += '\n' + soulRemaining;
    const potentialLines = formatPotentialLines(equip && equip.potential);
    if (potentialLines.length > 0) out += '\n' + potentialLines.join('\n');
    if (type == 'support' && user && user.main_card) {
        const star = Number(user.main_card.star || 0);
        const dyn = getEquipmentDynamicBonusAtLevel(data, level);
        const entry = dyn[String(star)];
        if (entry) {
            const bonusLines = [];
            Object.keys(entry.stat || {}).forEach(k => {
                if (Number(entry.stat[k] || 0) == 0) return;
                bonusLines.push('- ' + (SUPPORT_STAT_LABELS[k] || k) + ' ' + formatStatValue(k, entry.stat[k]));
            });
            Object.keys(entry.plusStat || {}).forEach(k => {
                if (Number(entry.plusStat[k] || 0) == 0) return;
                bonusLines.push('- ' + (SUPPORT_PLUS_STAT_LABELS[k] || k) + ' ' + formatPlusStatValue(k, entry.plusStat[k]));
            });
            if (bonusLines.length > 0) out += '\n[ ' + (star + 1) + '성 보너스 ]\n' + bonusLines.join('\n');
        }
    }
    return out;
}

function formatEquipmentInfo(user) {
    const characterCards = readJson(CHARACTER_CARDS_PATH, []);
    const skills = readJson(SKILLS_PATH, []);
    const mainCard = user.main_card;
    const cardData = mainCard && characterCards[mainCard.id];
    const star = Number(mainCard && mainCard.star || 0);
    const stats = calculateUserStats(user);
    const lines = [
        '[ ' + user.name + '님의 장착 정보 ]',
        VIEWMORE,
        '〈 캐릭터 카드 〉',
        '- ' + formatUserCard(mainCard)
    ];

    const fashion = getCardFashion(mainCard);
    if (fashion && star >= Number(fashion.requireStar || 0)) {
        const fashionStatLines = formatEquipmentStatLines(fashion.option || {});
        if (fashionStatLines) lines.push('', '〈 패션 카드 효과 〉', fashionStatLines);
    }

    lines.push('', '〈 스킬 〉');

    if (cardData && Array.isArray(cardData.skills) && cardData.skills.length > 0) {
        cardData.skills.forEach(skillIndex => {
            const skill = skills[skillIndex];
            if (!skill) return;
            const cooltime = Math.max(0, Number(skill.cooltime || 0) + Number(stats.skillCooldown || 0));
            lines.push('- ' + skill.name + ' [ ' + Number(skill.mp_cost || 0) + ' MP ] 쿨타임 ' + formatCooltime(cooltime));
            formatCurrentSkillDesc(skill, star).split('\n').forEach(desc => lines.push(' ㄴ ' + desc));
        });
    } else {
        lines.push('- 없음');
    }

    lines.push('', '〈 장비 〉');
    lines.push(formatEquippedEquipmentDetail('무기', 'weapon', user.equipments && user.equipments.weapon, user));
    lines.push('');
    lines.push(formatEquippedEquipmentDetail('갑옷', 'armor', user.equipments && user.equipments.armor, user));

    const accessories = user.equipments && user.equipments.accessory || {};
    const accessoryKeys = Object.keys(accessories).filter(key => accessories[key] && typeof accessories[key].id != 'undefined');
    if (accessoryKeys.length == 0) {
        lines.push('', '[장신구] 없음');
    } else {
        accessoryKeys.forEach(key => {
            lines.push('');
            lines.push(formatEquippedEquipmentDetail('장신구', 'accessory', accessories[key], user));
        });
    }

    lines.push('');
    lines.push(formatEquippedEquipmentDetail('보조', 'support', user.equipments && user.equipments.support, user));

    const equippedPets = getEquippedPets(user);
    const petSets = getActivePetSetEffects(user);
    if (equippedPets.length > 0 || petSets.length > 0) {
        lines.push('', '〈 펫 〉');
        if (equippedPets.length == 0) {
            lines.push('- 없음');
        } else {
            equippedPets.forEach(pet => {
                const d = getPetData(pet.id);
                const expired = isPetExpired(pet);
                lines.push('- <' + (d ? d.rarity : '?') + '> ' + (d ? d.name : '알 수 없는 펫') + (d && d.set ? ' [' + d.set + ']' : '') + (expired ? ' (기한만료)' : ''));
            });
        }
        petSets.forEach(set => {
            lines.push('', '《 ' + set.name + ' 세트 (' + set.count + '/' + set.total + ') 》');
            set.applied.forEach(a => {
                const inline = formatPetSetEffectLines(a.effect).map(l => l.replace(/^-\s*/, '')).join(', ');
                lines.push('- ' + a.tier + '세트: ' + (inline || '효과 없음'));
            });
        });
    }

    return lines.join('\n');
}

function getEquippedEquipmentRefs(user) {
    const refs = [];
    if (user.equipments && user.equipments.weapon && typeof user.equipments.weapon.id != 'undefined') refs.push({ type: 'weapon', equip: bindEquipmentToUser(user.equipments.weapon, user) });
    if (user.equipments && user.equipments.armor && typeof user.equipments.armor.id != 'undefined') refs.push({ type: 'armor', equip: bindEquipmentToUser(user.equipments.armor, user) });
    const accessories = user.equipments && user.equipments.accessory || {};
    Object.keys(accessories).forEach(key => {
        if (accessories[key] && typeof accessories[key].id != 'undefined') refs.push({ type: 'accessory', equip: bindEquipmentToUser(accessories[key], user), slotKey: key });
    });
    if (user.equipments && user.equipments.support && typeof user.equipments.support.id != 'undefined') refs.push({ type: 'support', equip: bindEquipmentToUser(user.equipments.support, user) });
    return refs;
}

function getAllUserEquipments(user) {
    const list = [];
    (user.inventory && Array.isArray(user.inventory.equipment) ? user.inventory.equipment : []).forEach((equip, index) => list.push({ source: 'inventory', index, equip }));
    getEquippedEquipmentRefs(user).forEach(ref => list.push(Object.assign({ source: 'equipped' }, ref)));
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
    if (selected.source == 'equipped' && selected.type == 'support') {
        user.equipments.support = null;
        return true;
    }
    return false;
}

function getEquipmentTypeLabel(type) {
    if (type == 'weapon') return '무기';
    if (type == 'armor') return '갑옷';
    if (type == 'accessory') return '장신구';
    if (type == 'support') return '보조';
    return type;
}

const EQUIPMENT_TRADE_MAX_COUNT = 5;
const EQUIPMENT_BINDING_ENABLED = true;
const EQUIPMENT_TRADE_RARITY_ORDER = ['일반', '고급', '레어', '희귀', '에픽', '유니크', '영웅', '레전더리', '전설', '신화', '고유'];

function isEquipmentTradeCountLimited(rarity) {
    const index = EQUIPMENT_TRADE_RARITY_ORDER.indexOf(String(rarity || ''));
    const uniqueIndex = EQUIPMENT_TRADE_RARITY_ORDER.indexOf('유니크');
    return index >= uniqueIndex && uniqueIndex >= 0;
}

function isEquipmentBindingEnabled() {
    return EQUIPMENT_BINDING_ENABLED === true;
}

function cloneEquipmentInstance(equip, fallbackType) {
    const entry = { type: equip.type || fallbackType, id: Number(equip.id), level: Number(equip.level || 0) };
    if (equip.rolled) entry.rolled = clonePlain(equip.rolled);
    if (equip.potential) entry.potential = clonePlain(equip.potential);
    if (equip.soul && !isSoulExpired(equip.soul)) entry.soul = clonePlain(equip.soul);
    if (equip.locked) entry.locked = true;
    if (equip.boundOwner) entry.boundOwner = equip.boundOwner;
    if (typeof equip.tradeCount != 'undefined') entry.tradeCount = Number(equip.tradeCount || 0);
    return entry;
}

function getEquipmentTradeBlockReason(equip, ownerName) {
    const type = equip && equip.type;
    const data = getEquipmentData(type, equip && equip.id);
    if (!data) return '잘못된 장비 데이터입니다.';
    if (data.no_trade) return '거래 불가 장비입니다.';
    if (isEquipmentBindingEnabled() && equip.boundOwner) return '귀속된 장비입니다. 귀속 해제의 주문서로 귀속을 해제해야 거래할 수 있습니다.';
    if (isEquipmentTradeCountLimited(data.rarity) && Number(equip.tradeCount || 0) >= EQUIPMENT_TRADE_MAX_COUNT) return '거래 횟수가 ' + EQUIPMENT_TRADE_MAX_COUNT + '회에 도달한 장비입니다.';
    return null;
}

function markEquipmentTraded(equip) {
    const data = getEquipmentData(equip && equip.type, equip && equip.id);
    if (data && isEquipmentTradeCountLimited(data.rarity)) equip.tradeCount = Number(equip.tradeCount || 0) + 1;
    delete equip.boundOwner;
    return equip;
}

function getEquipmentTradeLimitInfo(equip) {
    const data = getEquipmentData(equip && equip.type, equip && equip.id);
    if (!data || !isEquipmentTradeCountLimited(data.rarity)) return null;
    const max = EQUIPMENT_TRADE_MAX_COUNT;
    const count = Math.max(0, Number(equip.tradeCount || 0));
    return { count, max, remaining: Math.max(0, max - count) };
}

function bindEquipmentToUser(equip, user) {
    if (!isEquipmentBindingEnabled()) return equip;
    if (equip && user && user.name && !equip.boundOwner) equip.boundOwner = user.name;
    return equip;
}

function getBoundEquipmentScissorTargets(user) {
    if (!isEquipmentBindingEnabled()) return [];
    return getAllUserEquipments(user)
        .map((entry, index) => {
            const equip = entry.equip;
            if (!equip || !equip.boundOwner) return null;
            const type = equip.type || entry.type;
            const equipment = getEquipmentData(type, equip.id);
            if (!equipment) return null;
            const tradeLimit = getEquipmentTradeLimitInfo(Object.assign({ type }, equip));
            if (tradeLimit && Number(tradeLimit.remaining || 0) <= 0) return null;
            return { number: index + 1, entry, equipment };
        })
        .filter(Boolean);
}

function formatBoundEquipmentScissorList(targets) {
    const lines = ['[ 귀속 해제 대상 ]', VIEWMORE];
    targets.forEach(target => {
        const equip = target.entry.equip;
        const lvl = Number(equip.level || 0);
        const equippedMark = target.entry.source == 'equipped' ? ' (장착)' : '';
        const tradeCount = Number(equip.tradeCount || 0);
        const tradeText = isEquipmentTradeCountLimited(target.equipment.rarity) ? ' · 거래 ' + comma(tradeCount) + '/' + comma(EQUIPMENT_TRADE_MAX_COUNT) + '회' : '';
        lines.push('[' + target.number + '] <' + target.equipment.rarity + '> ' + getEquipmentDisplayName(target.equipment, equip) + (lvl > 0 ? ' +' + lvl : '') + equippedMark + ' · 귀속: ' + equip.boundOwner + tradeText);
    });
    return lines.join('\n');
}

function releaseBoundEquipment(user, numberArg) {
    if (!isEquipmentBindingEnabled()) return '❌ 현재 장비 귀속 시스템이 비활성화되어 있습니다.';
    const pending = user.pendingAction;
    if (!pending || pending.type != '귀속해제') return '❌ 진행 중인 귀속 해제가 없습니다.';
    const number = Number(numberArg);
    if (!Number.isInteger(number) || number < 1) return '❌ /RPGenius 선택 [장비번호]';
    const selected = getAllUserEquipments(user)[number - 1];
    if (!selected || !selected.equip || !selected.equip.boundOwner) return '❌ 귀속된 장비 번호가 아닙니다.';
    const type = selected.equip.type || selected.type;
    const equipment = getEquipmentData(type, selected.equip.id);
    if (!equipment) return '❌ 잘못된 장비 데이터입니다.';
    const tradeLimit = getEquipmentTradeLimitInfo(Object.assign({ type }, selected.equip));
    if (tradeLimit && Number(tradeLimit.remaining || 0) <= 0) return '❌ 남은 거래 가능 횟수가 0인 장비는 귀속을 해제할 수 없습니다.';
    delete selected.equip.boundOwner;
    user.pendingAction = null;
    const lvl = Number(selected.equip.level || 0);
    return '✅ 장비 귀속을 해제했습니다.\n- <' + equipment.rarity + '> ' + getEquipmentDisplayName(equipment, selected.equip) + (lvl > 0 ? ' +' + lvl : '');
}

function formatEquipmentInventoryLine(number, entry) {
    const data = getEquipmentData(entry.equip.type || entry.type, entry.equip.id);
    if (!data) return null;
    const level = Number(entry.equip.level || 0);
    const lockMark = entry.equip.locked ? ' 🔒' : '';
    return '[' + number + '] <' + data.rarity + '> ' + getEquipmentDisplayName(data, entry.equip) + (level > 0 ? ' +' + level : '') + (entry.source == 'equipped' ? ' (장착)' : '') + lockMark;
}

function formatEquipmentInventory(user) {
    const lines = ['[ ' + user.name + '님의 보유 장비 ]', VIEWMORE];
    const all = getAllUserEquipments(user);
    const types = [['weapon', '무기'], ['armor', '갑옷'], ['accessory', '장신구'], ['support', '보조']];
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
    const items = getDataCache('Item', []);
    const characterCards = readJson(CHARACTER_CARDS_PATH, []);
    if (shopItem.type == '아이템') {
        const item = items[shopItem.item_id];
        const itemName = item ? item.name : '알 수 없는 아이템';
        return itemName + ' x' + comma(shopItem.count);
    }
    if (shopItem.type == '캐릭터카드') {
        const card = buildCharacterCardReward(shopItem);
        if (!card) return '알 수 없는 캐릭터카드';
        const data = characterCards[card.id];
        return (data ? data.name : '알 수 없는 캐릭터카드') + ' ' + formatStar(card.star) + ' x' + comma(shopItem.count || 1);
    }
    if (shopItem.type == '가넷') return '💠 ' + comma(shopItem.count);
    if (shopItem.type == '골드') return '🪙 ' + comma(shopItem.count);
    if (shopItem.type == '마일리지') return 'Ⓜ️ ' + comma(shopItem.count);
    return shopItem.type;
}

function formatPrice(price) {
    const items = getDataCache('Item', []);
    if (price.goods == 'gold') return '🪙 ' + comma(price.amount);
    if (price.goods == 'garnet') return '💠 ' + comma(price.amount);
    if (price.goods == 'point') return '💰 ' + comma(price.amount) + 'P';
    if (price.goods == 'mileage') return 'Ⓜ️ ' + comma(price.amount);
    if (price.goods == 'item') {
        const item = items[price.item_id];
        return (item ? item.name : '알 수 없는 아이템') + ' x' + comma(price.amount);
    }
    return comma(price.amount);
}

function formatShop(shopType, user) {
    const shops = getDataCache('Shop', {});
    const shop = shops[shopType];
    if (!shop || !Array.isArray(shop)) return null;
    
    const lines = ['[ ' + shopType + ' 상점 ]', VIEWMORE];
    shop.forEach((item, index) => {
        const limitSuffix = user ? formatShopLimitSuffix(user, shopType, index, item) : '';
        lines.push('│ [' + (index + 1) + '] 〈 ' + formatShopItem(item) + ' 〉' + limitSuffix);
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

function getIceCount(ices, size) {
    const entry = ices && ices[size];
    if (entry && typeof entry == 'object' && typeof entry.N != 'undefined') return Number(entry.N || 0);
    return Number(entry || 0);
}

function setIceCount(ices, size, count) {
    if (ices[size] && typeof ices[size] == 'object' && typeof ices[size].N != 'undefined') ices[size].N = String(count);
    else ices[size] = count;
}

function formatRemainingIces(ices) {
    return ['[ 남은 얼음 ]']
        .concat(Object.keys(ICE_SUMMON_REWARDS).map(size => '🧊 ' + size + ': ' + comma(getIceCount(ices, size))))
        .join('\n');
}

// ===================== PET SYSTEM =====================
const PET_SLOT_MAX = 3;
const PET_DURATION_MS = 30 * 24 * 60 * 60 * 1000;

function getPetData(id) {
    const pets = getDataCache('Pet', []);
    return Array.isArray(pets) ? pets[id] : undefined;
}

function findPetByName(name) {
    const pets = getDataCache('Pet', []);
    if (!Array.isArray(pets)) return null;
    const id = pets.findIndex(p => p && p.name == name);
    if (id == -1) return null;
    return { id, pet: pets[id] };
}

function normalizeSpecialObject(src) {
    const out = {};
    if (!src) return out;
    const arr = Array.isArray(src) ? src : [src];
    arr.forEach(o => { if (o && typeof o == 'object') Object.keys(o).forEach(k => { out[k] = o[k]; }); });
    return out;
}

function normalizePetSpecial(petData) {
    return normalizeSpecialObject(petData && petData.special);
}

// 펫의 기본 special + 현재 강화 레벨까지의 강화 단계 special 목록 (각각 별도 소스로 누적)
function collectPetSpecialObjects(petData, level) {
    const list = [];
    const base = normalizePetSpecial(petData);
    if (Object.keys(base).length) list.push(base);
    const max = Math.min(Number(level || 0), Array.isArray(petData && petData.upgrade) ? petData.upgrade.length : 0);
    for (let i = 0; i < max; i++) {
        const sp = normalizeSpecialObject(petData.upgrade[i] && petData.upgrade[i].special);
        if (Object.keys(sp).length) list.push(sp);
    }
    return list;
}

function accumulatePetSpecial(result, sp) {
    result.fishingSpeed += Number(sp.fishingSpeed || 0);
    result.fishBasket += Number(sp.fishBasket || 0);
    result.autoFragment += Number(sp.autoFragment || 0);
    result.canShortcut += Number(sp.canShortcut || 0);
    if (Number(sp.hpRegen || 0) > 0) result.hpRegenRate += 0.01 / Number(sp.hpRegen);
    if (Number(sp.mpRegen || 0) > 0) result.mpRegenRate += 0.01 / Number(sp.mpRegen);
    if (sp.autoAttend) result.autoAttend = true;
}

// 세트 효과 단계의 효과 라인 (능력치 + special) — 각 라인은 '- ' 접두사 포함
function formatPetSetEffectLines(effect) {
    const lines = [];
    String(formatEquipmentStatLines(effect || {}) || '').split('\n').filter(Boolean).forEach(l => lines.push(l));
    formatPetSpecialLines(normalizeSpecialObject(effect && effect.special)).forEach(l => lines.push(l));
    return lines;
}

function clonePetInstance(pet) {
    const entry = { id: Number(pet.id), level: Number(pet.level || 0), tradeCount: Number(pet.tradeCount || 0) };
    if (typeof pet.expireAt != 'undefined') entry.expireAt = Number(pet.expireAt);
    if (pet.shortcuts && typeof pet.shortcuts == 'object') entry.shortcuts = clonePlain(pet.shortcuts);
    return entry;
}

function isPetExpired(pet) {
    return !!(pet && pet.expireAt && Date.now() >= Number(pet.expireAt));
}

function isPetTradable(pet) {
    return !!pet && Number(pet.tradeCount || 0) > 0;
}

function markPetTraded(pet) {
    if (pet) {
        pet.tradeCount = Math.max(0, Number(pet.tradeCount || 0) - 1);
        delete pet.shortcuts;
    }
    return pet;
}

function isPetEffectActive(pet) {
    return !!pet && !isPetExpired(pet);
}

function getEquippedPets(user) {
    if (!user.equipments || !Array.isArray(user.equipments.pet)) return [];
    return user.equipments.pet.filter(pet => pet && typeof pet.id != 'undefined');
}

function getAllUserPets(user) {
    const list = [];
    (user.inventory && Array.isArray(user.inventory.pet) ? user.inventory.pet : []).forEach((pet, index) => list.push({ source: 'inventory', index, pet }));
    getEquippedPets(user).forEach(pet => list.push({ source: 'equipped', pet }));
    return list;
}

const PET_TRADE_DEFAULT_COUNT = 1;

function addPetInventory(user, id) {
    if (!user.inventory) user.inventory = { card: [], item: [], equipment: [], pet: [] };
    if (!Array.isArray(user.inventory.pet)) user.inventory.pet = [];
    user.inventory.pet.push({ id: Number(id), level: 0, tradeCount: PET_TRADE_DEFAULT_COUNT });
}

function getInventoryPetCount(user, id) {
    if (!user.inventory || !Array.isArray(user.inventory.pet)) return 0;
    return user.inventory.pet.filter(p => p && Number(p.id) == Number(id)).length;
}

function removeInventoryPet(user, id, count) {
    if (!user.inventory || !Array.isArray(user.inventory.pet)) return false;
    if (getInventoryPetCount(user, id) < count) return false;
    let remain = count;
    for (let i = user.inventory.pet.length - 1; i >= 0 && remain > 0; i--) {
        if (Number(user.inventory.pet[i].id) == Number(id)) { user.inventory.pet.splice(i, 1); remain--; }
    }
    return remain == 0;
}

function grantRandomPetByRarity(user, rarity, count, summary) {
    const pets = getDataCache('Pet', []);
    const target = String(rarity || '').trim();
    const candidates = [];
    (Array.isArray(pets) ? pets : []).forEach((pet, id) => { if (pet && pet.rarity == target) candidates.push({ id, pet }); });
    if (candidates.length == 0) return false;
    for (let i = 0; i < Math.max(1, Number(count || 1)); i++) {
        const selected = candidates[randomInt(0, candidates.length - 1)];
        addPetInventory(user, selected.id);
        addRewardSummary(summary, 'pet:' + selected.id, '<' + selected.pet.rarity + '> ' + selected.pet.name + ' (펫)', 1);
    }
    return true;
}

function getPetSetData() {
    const data = readJson(PETSET_PATH, {});
    return data && typeof data == 'object' ? data : {};
}

// 장착 중인(만료되지 않은) 펫들을 set 이름별로 집계
function getActivePetSetCounts(user) {
    const counts = {};
    getEquippedPets(user).forEach(pet => {
        if (!isPetEffectActive(pet)) return;
        const data = getPetData(pet.id);
        if (!data || !data.set) return;
        const name = String(data.set);
        counts[name] = (counts[name] || 0) + 1;
    });
    return counts;
}

// 활성화된 세트 효과 목록. PetSet.json 인덱스 0 = 1개 장착 효과, 1 = 2개 장착 효과 ...
// N개 장착 시 인덱스 0..N-1 의 효과가 누적 적용된다.
function getActivePetSetEffects(user) {
    const sets = getPetSetData();
    const counts = getActivePetSetCounts(user);
    const result = [];
    Object.keys(counts).forEach(name => {
        const tiers = sets[name];
        if (!Array.isArray(tiers)) return;
        const count = counts[name];
        const applied = [];
        for (let i = 0; i < Math.min(count, tiers.length); i++) {
            if (tiers[i] && typeof tiers[i] == 'object') applied.push({ tier: i + 1, effect: tiers[i] });
        }
        if (applied.length) result.push({ name, count, total: tiers.length, applied });
    });
    return result;
}

function getActivePetSpecials(user) {
    const result = { fishingSpeed: 0, fishBasket: 0, autoFragment: 0, hpRegenRate: 0, mpRegenRate: 0, autoAttend: false, canShortcut: 0 };
    getEquippedPets(user).forEach(pet => {
        if (!isPetEffectActive(pet)) return;
        const data = getPetData(pet.id);
        if (!data) return;
        collectPetSpecialObjects(data, pet.level).forEach(sp => accumulatePetSpecial(result, sp));
    });
    getActivePetSetEffects(user).forEach(set => {
        set.applied.forEach(a => {
            const sp = normalizeSpecialObject(a.effect && a.effect.special);
            if (Object.keys(sp).length) accumulatePetSpecial(result, sp);
        });
    });
    return result;
}

function getActivePetShortcutMap(user) {
    const map = {};
    getEquippedPets(user).forEach(pet => {
        if (!isPetEffectActive(pet)) return;
        if (pet.shortcuts && typeof pet.shortcuts == 'object') {
            Object.keys(pet.shortcuts).forEach(k => { if (typeof map[k] == 'undefined') map[k] = pet.shortcuts[k]; });
        }
    });
    return map;
}

function getEffectiveFishingNetLimit(user) {
    const base = Number(user.fishingNetLimit || 200);
    return base + Math.max(0, Math.round(getActivePetSpecials(user).fishBasket));
}

function applyPetRegen(user, stats, lines) {
    if (!user.field) return;
    const specials = getActivePetSpecials(user);
    if (specials.hpRegenRate <= 0 && specials.mpRegenRate <= 0) return;
    const now = Date.now();
    if (typeof user.field.petRegenAt == 'undefined') { user.field.petRegenAt = now; return; }
    const elapsedSec = Math.max(0, (now - Number(user.field.petRegenAt)) / 1000);
    if (elapsedSec <= 0) return;
    const maxHp = Number(stats.hp || 0);
    const maxMp = Number(stats.mp || 0);
    const beforeHp = typeof user.hp == 'undefined' ? maxHp : Number(user.hp || 0);
    const beforeMp = typeof user.mp == 'undefined' ? maxMp : Number(user.mp || 0);
    const hpHeal = (specials.hpRegenRate > 0 && beforeHp < maxHp) ? Math.floor(maxHp * specials.hpRegenRate * elapsedSec) : 0;
    const mpHeal = (specials.mpRegenRate > 0 && beforeMp < maxMp) ? Math.floor(maxMp * specials.mpRegenRate * elapsedSec) : 0;
    if (hpHeal <= 0 && mpHeal <= 0) return;
    user.field.petRegenAt = now;
    if (hpHeal > 0) {
        user.hp = Math.min(maxHp, beforeHp + hpHeal);
        if (lines) lines.push('🐾 펫 회복: HP +' + comma(user.hp - beforeHp));
    }
    if (mpHeal > 0) {
        user.mp = Math.min(maxMp, beforeMp + mpHeal);
        if (lines) lines.push('🐾 펫 회복: MP +' + comma(user.mp - beforeMp));
    }
}

function formatPetExpiry(pet) {
    if (!pet || !pet.expireAt) return '미장착';
    const diff = Number(pet.expireAt) - Date.now();
    if (diff <= 0) return '기한 만료';
    const days = Math.floor(diff / 86400000);
    const hours = Math.floor((diff % 86400000) / 3600000);
    if (days > 0) return '잔여 ' + days + '일 ' + hours + '시간';
    if (hours > 0) return '잔여 ' + hours + '시간';
    return '잔여 1시간 미만';
}

function formatPetSpecialLines(sp) {
    const pct = v => (Math.round(Number(v) * 1000) / 10) + '%';
    const lines = [];
    if (Number(sp.fishingSpeed || 0)) lines.push('- 낚시 속도 +' + pct(sp.fishingSpeed));
    if (Number(sp.fishBasket || 0)) lines.push('- 살림망 크기 +' + comma(Number(sp.fishBasket)));
    if (Number(sp.autoFragment || 0)) lines.push('- 편린 자동 사용 확률 ' + pct(sp.autoFragment));
    if (Number(sp.hpRegen || 0)) lines.push('- ' + Number(sp.hpRegen) + '초마다 최대 체력 1% 회복');
    if (Number(sp.mpRegen || 0)) lines.push('- ' + Number(sp.mpRegen) + '초마다 최대 MP 1% 회복');
    if (sp.autoAttend) lines.push('- 자동 출석체크');
    if (Number(sp.canShortcut || 0)) lines.push('- 단축키 저장 슬롯 ' + comma(Number(sp.canShortcut)) + '개');
    return lines;
}

function formatPetStatLines(petData) {
    const parts = [];
    const baseStats = formatEquipmentBaseStatLines(petData, 0);
    if (baseStats) parts.push(baseStats);
    const specialLines = formatPetSpecialLines(normalizePetSpecial(petData));
    if (specialLines.length) parts.push('[ 특수 효과 ]\n' + specialLines.join('\n'));
    return parts.join('\n');
}

function formatPetInventory(user) {
    const lines = ['[ ' + user.name + '님의 보유 펫 ]', VIEWMORE];
    const all = getAllUserPets(user);
    let shown = 0;
    all.forEach((entry, index) => {
        const data = getPetData(entry.pet.id);
        if (!data) return;
        shown++;
        const lvl = Number(entry.pet.level || 0);
        let suffix = '';
        if (entry.source == 'equipped') suffix = isPetExpired(entry.pet) ? ' (장착·기한만료)' : ' (장착)';
        const remain = entry.pet.expireAt ? ' · ' + formatPetExpiry(entry.pet) : '';
        lines.push('[' + (index + 1) + '] <' + data.rarity + '> ' + data.name + (lvl > 0 ? ' +' + lvl : '') + suffix + remain);
    });
    if (shown == 0) lines.push('', '보유 중인 펫이 없습니다.');
    return lines.join('\n');
}

function equipPetByNumber(user, numberArg) {
    const number = Number(numberArg);
    if (!Number.isInteger(number) || number < 1) return '❌ 펫 번호는 1 이상의 정수여야 합니다.';
    if (!user.inventory) user.inventory = { card: [], item: [], equipment: [], pet: [] };
    if (!Array.isArray(user.inventory.pet)) user.inventory.pet = [];
    if (!user.equipments) user.equipments = { weapon: null, armor: null, accessory: {}, support: null, pet: [] };
    if (!Array.isArray(user.equipments.pet)) user.equipments.pet = [];
    const all = getAllUserPets(user);
    const selected = all[number - 1];
    if (!selected) return '❌ 존재하지 않는 펫 번호입니다.';
    if (selected.source == 'equipped') return '❌ 이미 장착 중인 펫입니다.';
    const target = user.inventory.pet[selected.index];
    const data = getPetData(target.id);
    if (!data) return '❌ 잘못된 펫 데이터입니다.';
    const userLevel = Number(user.level || 1);
    if (typeof data.requireLevel != 'undefined' && userLevel < Number(data.requireLevel)) return '❌ 장착 필요 레벨이 부족합니다. (Lv. ' + Number(data.requireLevel) + ' 이상)';
    if (getEquippedPets(user).some(pet => Number(pet.id) == Number(target.id))) return '❌ 같은 종류의 펫은 중복 장착할 수 없습니다.';
    if (getEquippedPets(user).length >= PET_SLOT_MAX) return '❌ 펫 슬롯이 가득 찼습니다. (최대 ' + PET_SLOT_MAX + '마리) 먼저 다른 펫을 해제해주세요.';
    const entry = clonePetInstance(target);
    if (typeof entry.expireAt == 'undefined') entry.expireAt = Date.now() + PET_DURATION_MS;
    entry.tradeCount = 0;
    if (!entry.shortcuts) entry.shortcuts = {};
    user.equipments.pet.push(entry);
    user.inventory.pet.splice(selected.index, 1);
    return '✅ 펫을 장착했습니다.\n<' + data.rarity + '> ' + data.name + '\n- ' + formatPetExpiry(entry);
}

function unequipPetByNumber(user, numberArg) {
    const number = Number(numberArg);
    if (!Number.isInteger(number) || number < 1) return '❌ 펫 번호를 올바르게 입력해주세요.';
    const all = getAllUserPets(user);
    const selected = all[number - 1];
    if (!selected) return '❌ 존재하지 않는 펫 번호입니다.';
    if (selected.source != 'equipped') return '❌ 장착 중인 펫이 아닙니다.';
    const data = getPetData(selected.pet.id);
    if (!user.inventory) user.inventory = { card: [], item: [], equipment: [], pet: [] };
    if (!Array.isArray(user.inventory.pet)) user.inventory.pet = [];
    const idx = user.equipments.pet.indexOf(selected.pet);
    if (idx == -1) return '❌ 장착 중인 펫이 아닙니다.';
    user.equipments.pet.splice(idx, 1);
    user.inventory.pet.push(clonePetInstance(selected.pet));
    const stats = calculateUserStats(user);
    user.hp = Math.min(typeof user.hp == 'undefined' ? Number(stats.hp || 0) : Number(user.hp || 0), Number(stats.hp || 0));
    user.mp = Math.min(typeof user.mp == 'undefined' ? Number(stats.mp || 0) : Number(user.mp || 0), Number(stats.mp || 0));
    return '✅ 펫을 해제했습니다.\n<' + (data ? data.rarity : '?') + '> ' + (data ? data.name : '알 수 없는 펫');
}

const PET_EXTRACT_ITEM_ID = 155; // 2024올스타즈 생명체 숨결
const PET_EXTRACT_YIELD = { '레어': 15, '유니크': 35, '레전더리': 80 };

function extractPetsByNumbers(user, numberArgs) {
    if (!Array.isArray(numberArgs) || numberArgs.length == 0) return '❌ /RPGenius 추출 [펫 번호1] [펫 번호2] ...';
    if (!user.inventory) user.inventory = { card: [], item: [], equipment: [], pet: [] };
    if (!Array.isArray(user.inventory.pet)) user.inventory.pet = [];
    const all = getAllUserPets(user);
    const seen = new Set();
    const targets = [];
    for (const arg of numberArgs) {
        const number = Number(arg);
        if (!Number.isInteger(number) || number < 1) return '❌ 펫 번호는 1 이상의 정수여야 합니다: ' + arg;
        if (seen.has(number)) return '❌ 중복된 펫 번호입니다: ' + number;
        seen.add(number);
        const selected = all[number - 1];
        if (!selected) return '❌ 존재하지 않는 펫 번호입니다: ' + number;
        if (selected.source != 'inventory') return '❌ 장착 중인 펫은 추출할 수 없습니다. 먼저 장착 해제해주세요: ' + number;
        const data = getPetData(selected.pet.id);
        if (!data) return '❌ 잘못된 펫 데이터입니다: ' + number;
        const amount = PET_EXTRACT_YIELD[data.rarity];
        if (!amount) return '❌ 추출할 수 없는 등급입니다: <' + data.rarity + '> ' + data.name;
        targets.push({ invIndex: selected.index, data, amount });
    }
    targets.slice().sort((a, b) => b.invIndex - a.invIndex).forEach(t => user.inventory.pet.splice(t.invIndex, 1));
    const totalAmount = targets.reduce((sum, t) => sum + t.amount, 0);
    addInventoryItem(user, PET_EXTRACT_ITEM_ID, totalAmount);
    const items = getDataCache('Item', []);
    const itemName = (items[PET_EXTRACT_ITEM_ID] && items[PET_EXTRACT_ITEM_ID].name) || '2024올스타즈 생명체 숨결';
    const lines = ['✅ 펫 추출 완료 (' + targets.length + '마리)'];
    targets.forEach(t => lines.push('- <' + t.data.rarity + '> ' + t.data.name + ' → ' + itemName + ' x' + comma(t.amount)));
    lines.push('', '[ 획득 결과 ]' + itemName + ' x' + comma(totalAmount));
    return lines.join('\n');
}

function setPetShortcut(user, key, phrase) {
    if (!key) return '❌ /RPGenius 단축키설정 [단축키] [문구]';
    if (!/^[0-9A-Za-z가-힣]+$/.test(key)) return '❌ 단축키는 공백 없이 한글/영어/숫자로만 입력해주세요.';
    if (!phrase) return '❌ /RPGenius 단축키설정 [단축키] [문구]';
    const equipped = getEquippedPets(user).filter(isPetEffectActive);
    if (equipped.length == 0) return '❌ 단축키를 저장할 수 있는 펫이 없습니다. (단축키 슬롯이 있는 펫을 장착하세요)';
    if (equipped.some(pet => pet.shortcuts && typeof pet.shortcuts[key] != 'undefined')) return '❌ 이미 사용 중인 단축키입니다. (단축키는 변경할 수 없습니다)';
    let target = null;
    for (const pet of equipped) {
        const cap = Number(normalizePetSpecial(getPetData(pet.id)).canShortcut || 0);
        if (cap <= 0) continue;
        if (!pet.shortcuts || typeof pet.shortcuts != 'object') pet.shortcuts = {};
        if (Object.keys(pet.shortcuts).length < cap) { target = pet; break; }
    }
    if (!target) return '❌ 단축키 저장 슬롯이 남아있는 펫이 없습니다.';
    target.shortcuts[key] = phrase;
    const data = getPetData(target.id);
    return '✅ 단축키를 저장했습니다. (변경 불가)\n- ' + key + ' → ' + phrase + '\n- 귀속: <' + (data ? data.rarity : '?') + '> ' + (data ? data.name : '');
}

function formatPetShortcuts(user) {
    const equipped = getEquippedPets(user);
    const lines = ['[ ' + user.name + '님의 단축키 ]'];
    let any = false;
    equipped.forEach(pet => {
        const data = getPetData(pet.id);
        const cap = Number(normalizePetSpecial(data).canShortcut || 0);
        const sc = (pet.shortcuts && typeof pet.shortcuts == 'object') ? pet.shortcuts : {};
        const keys = Object.keys(sc);
        if (cap <= 0 && keys.length == 0) return;
        any = true;
        const expiredMark = isPetEffectActive(pet) ? '' : ' (기한만료·비활성)';
        lines.push('', '〈 <' + (data ? data.rarity : '?') + '> ' + (data ? data.name : '?') + ' 〉 (' + keys.length + '/' + cap + ')' + expiredMark);
        if (keys.length == 0) lines.push('- (등록된 단축키 없음)');
        else keys.forEach(k => lines.push('- ' + k + ' → ' + sc[k]));
    });
    if (!any) {
        lines.push('', '등록된 단축키가 없습니다.');
        lines.push('단축키 슬롯이 있는 펫을 장착한 뒤 /RPGenius 단축키설정 [단축키] [문구]');
    }
    return lines.join('\n');
}

function extendPetExpiry(user, numberArg) {
    const pending = user.pendingAction;
    if (!pending || pending.type != '생명수') return '❌ 진행 중인 생명수 사용이 없습니다.';
    const number = Number(numberArg);
    const all = getAllUserPets(user);
    if (!Number.isInteger(number) || number < 1 || number > all.length) return '❌ 존재하지 않는 펫 번호입니다.\n/RPGenius 선택 [번호]';
    const target = all[number - 1].pet;
    const data = getPetData(target.id);
    if (!data) return '❌ 잘못된 펫 데이터입니다.';
    target.expireAt = Math.max(Number(target.expireAt || 0), Date.now()) + PET_DURATION_MS;
    user.pendingAction = null;
    return '✅ ' + data.name + ' 펫의 기한을 30일 연장했습니다.\n- ' + formatPetExpiry(target);
}

async function voteCandidate(user, candidateArg, countArg) {
    const candidateIdx = parseInt(candidateArg);
    if (![1, 2, 3].includes(candidateIdx)) {
        return '❌ /RPGenius 투표 [1/2/3] (횟수)\n1번 후보: 오치원생\n2번 후보: 루이킴\n3번 후보: 부랑도';
    }

    let count = typeof countArg === 'undefined' ? 1 : parseInt(countArg);
    if (isNaN(count) || count < 1) {
        return '❌ 투표 횟수는 1 이상의 숫자여야 합니다.';
    }

    const candidates = ['오치원생', '루이킴', '부랑도'];
    const candidateName = candidates[candidateIdx - 1];

    const items = getDataCache('Item', []);
    const paperId = items.findIndex(item => item.name == '투표 용지');
    const paperCount = paperId == -1 ? 0 : getInventoryItemCount(user, paperId);
    if (paperCount < 1) {
        return '❌ 투표 용지가 부족합니다.';
    }
    if (paperCount < count) count = paperCount;

    removeInventoryItem(user, paperId, count);

    await loadRpgeniusDataEntry('VoteState');
    let votes = getDataCache('VoteState', {});
    if (!votes || typeof votes !== 'object') votes = {};
    for (const name of candidates) {
        if (typeof votes[name] === 'undefined') votes[name] = 0;
    }

    votes[candidateName] += count;
    await saveRpgeniusDataEntry('VoteState', votes);

    const lines = [];
    lines.push(`🗳️ ${candidateName} 후보를 ${comma(count)}표 투표했습니다.`);
    lines.push('');
    lines.push('[ 투표 현황 ]');
    for (let i = 0; i < candidates.length; i++) {
        const name = candidates[i];
        lines.push(`${i + 1}️⃣ ${name}: ${comma(votes[name] || 0)}표`);
    }
    lines.push('');
    lines.push('[ 투표 보너스 ]');

    // open pack 20
    const packId = 20;
    const packs = getDataCache('Pack', []);
    const pack = packs[packId];
    if (!Array.isArray(pack)) {
        lines.push('- (설정 오류: 투표 보상 팩을 찾을 수 없습니다)');
    } else {
        const summary = {};
        for (let i = 0; i < count; i++) {
            grantPackReward(user, pickPackEntry(pack), summary);
        }
        Object.keys(summary).forEach(key => lines.push('- ' + summary[key].label + ' x' + comma(summary[key].count)));
    }

    return lines.join('\n');
}

function getRecipeEquipmentType(material) {
    if (material.type == '무기') return 'weapon';
    if (material.type == '갑옷') return 'armor';
    if (material.type == '장신구') return 'accessory';
    if (material.type == '보조' || material.type == '보조무기') return 'support';
    return null;
}

function getRecipeEquipmentId(material) {
    if (material.type == '무기') return material.weapon_id;
    if (material.type == '갑옷') return material.armor_id;
    if (material.type == '장신구') return material.accessory_id;
    if (material.type == '보조' || material.type == '보조무기') return material.support_id;
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

function getKoreanWeekKey(date) {
    const kst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
    const tmp = new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate()));
    const day = tmp.getUTCDay() || 7;
    tmp.setUTCDate(tmp.getUTCDate() + 4 - day);
    const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil((((tmp - yearStart) / 86400000) + 1) / 7);
    return tmp.getUTCFullYear() + '-W' + String(weekNo).padStart(2, '0');
}

function getKoreanMonthKey(date) {
    const kst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
    return kst.toISOString().slice(0, 7);
}

const SHOP_LIMIT_KEYS = ['max', 'daily', 'weekly', 'monthly', 'global'];

function getShopLimits(shopItem) {
    const out = {};
    const src = shopItem && shopItem.limits;
    if (src && typeof src == 'object') {
        SHOP_LIMIT_KEYS.forEach(k => {
            const v = Number(src[k]);
            if (Number.isFinite(v) && v > 0) out[k] = Math.floor(v);
        });
    }
    return out;
}

function normalizeShopPurchaseRecord(rec, now) {
    const dateKey = getKoreanDateKey(now);
    const weekKey = getKoreanWeekKey(now);
    const monthKey = getKoreanMonthKey(now);
    if (!rec || typeof rec != 'object') rec = {};
    if (typeof rec.max != 'number') rec.max = Number(rec.max || 0);
    if (rec.dailyKey != dateKey) { rec.dailyKey = dateKey; rec.daily = 0; }
    if (rec.weeklyKey != weekKey) { rec.weeklyKey = weekKey; rec.weekly = 0; }
    if (rec.monthlyKey != monthKey) { rec.monthlyKey = monthKey; rec.monthly = 0; }
    rec.daily = Number(rec.daily || 0);
    rec.weekly = Number(rec.weekly || 0);
    rec.monthly = Number(rec.monthly || 0);
    return rec;
}

function getUserShopRecord(user, shopType, index, now) {
    if (!user.shopPurchases || typeof user.shopPurchases != 'object') user.shopPurchases = {};
    if (!user.shopPurchases[shopType] || typeof user.shopPurchases[shopType] != 'object') user.shopPurchases[shopType] = {};
    const key = String(index);
    user.shopPurchases[shopType][key] = normalizeShopPurchaseRecord(user.shopPurchases[shopType][key], now || new Date());
    return user.shopPurchases[shopType][key];
}

function getShopGlobalCount(shopType, index) {
    const state = getDataCache('ShopState', {}) || {};
    const t = state[shopType];
    if (!t) return 0;
    const r = t[String(index)];
    if (!r) return 0;
    return Number(r.global || 0);
}

async function addShopGlobalCount(shopType, index, delta) {
    let state = getDataCache('ShopState', {});
    if (!state || typeof state != 'object') state = {};
    if (!state[shopType] || typeof state[shopType] != 'object') state[shopType] = {};
    const key = String(index);
    if (!state[shopType][key] || typeof state[shopType][key] != 'object') state[shopType][key] = { global: 0 };
    state[shopType][key].global = Number(state[shopType][key].global || 0) + Number(delta || 0);
    await saveRpgeniusDataEntry('ShopState', state);
}

function getShopRemainingLimits(user, shopType, index, shopItem, now) {
    const limits = getShopLimits(shopItem);
    const rec = getUserShopRecord(user, shopType, index, now);
    const globalCount = getShopGlobalCount(shopType, index);
    const out = {};
    if (typeof limits.max == 'number') out.max = Math.max(0, limits.max - rec.max);
    if (typeof limits.daily == 'number') out.daily = Math.max(0, limits.daily - rec.daily);
    if (typeof limits.weekly == 'number') out.weekly = Math.max(0, limits.weekly - rec.weekly);
    if (typeof limits.monthly == 'number') out.monthly = Math.max(0, limits.monthly - rec.monthly);
    if (typeof limits.global == 'number') out.global = Math.max(0, limits.global - globalCount);
    return { limits, rec, globalCount, remaining: out };
}

function formatShopLimitSuffix(user, shopType, index, shopItem) {
    const { limits, rec, globalCount } = getShopRemainingLimits(user, shopType, index, shopItem, new Date());
    const parts = [];
    if (typeof limits.max == 'number') parts.push('전체 ' + comma(rec.max) + '/' + comma(limits.max));
    if (typeof limits.daily == 'number') parts.push('일일 ' + comma(rec.daily) + '/' + comma(limits.daily));
    if (typeof limits.weekly == 'number') parts.push('주간 ' + comma(rec.weekly) + '/' + comma(limits.weekly));
    if (typeof limits.monthly == 'number') parts.push('월간 ' + comma(rec.monthly) + '/' + comma(limits.monthly));
    if (typeof limits.global == 'number') parts.push('선착순 ' + comma(globalCount) + '/' + comma(limits.global));
    if (parts.length == 0) return '';
    return '\n│ 구매 제한\n├ ' + parts.join('\n├ ');
}

function checkAttendance(user) {
    const today = getKoreanDateKey(new Date());
    if (user.lastAttendanceDate == today) return '❌ 오늘은 이미 출석체크를 완료했습니다.';
    user.lastAttendanceDate = today;
    addInventoryItem(user, ATTENDANCE_STAMP_ITEM_ID, 1);
    const items = getDataCache('Item', []);
    const stamp = items[ATTENDANCE_STAMP_ITEM_ID];
    return '✅ 출석체크 완료!\n\n[ 획득 물품 ]\n- ' + (stamp ? stamp.name : '출석 도장') + ' x1';
}

function getRecipeByName(name) {
    const recipes = getDataCache('Recipe', []);
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
    if (['무기', '갑옷', '장신구', '보조', '보조무기'].includes(material.type)) {
        const have = getInventoryEquipmentCount(user, material);
        return { have, need, ok: have >= need };
    }
    if (material.type == '펫') {
        const have = getInventoryPetCount(user, material.pet_id);
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
    if (['무기', '갑옷', '장신구', '보조', '보조무기'].includes(material.type)) return removeInventoryEquipment(user, material, count);
    if (material.type == '펫') return removeInventoryPet(user, material.pet_id, count);
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
    if (['무기', '갑옷', '장신구', '보조', '보조무기', '펫'].includes(material.type)) return text + ' x' + comma(need);
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
        return;
    }
    if (entry.type == '보조') {
        for (let i = 0; i < count; i++) addEquipmentInventory(user, 'support', entry.support_id);
        return;
    }
    if (entry.type == '펫') {
        for (let i = 0; i < count; i++) addPetInventory(user, entry.pet_id);
    }
}

function formatCraftedEntryWithTotal(entry, total) {
    const text = formatPackEntry(entry);
    if (['무기', '갑옷', '장신구', '보조', '캐릭터카드', '펫'].includes(entry.type)) {
        if (Number(total) <= 1) return text;
        return text + ' x' + comma(total);
    }
    if (/x[\d,]+(?:~[\d,]+)?$/.test(text)) return text.replace(/x[\d,]+(?:~[\d,]+)?$/, 'x' + comma(total));
    return text + ' x' + comma(total);
}

function formatCraftPreview(user, name, times) {
    const recipe = getRecipeByName(name);
    if (!recipe) return '❌ 존재하지 않는 제작 레시피입니다.';
    const count = Math.max(1, Math.floor(Number(times) || 1));
    const header = '⚒️ ' + recipe.name + ' 제작' + (count > 1 ? ' x' + comma(count) : '');
    const lines = [header, '', '- 필요한 재료:'];
    (recipe.materials || []).forEach(material => {
        const status = getCraftMaterialStatus(user, material);
        const totalNeed = status.need * count;
        const ok = status.have >= totalNeed;
        lines.push((ok ? '✅ ' : '❌ ') + formatCraftMaterial(material, totalNeed) + ' (' + comma(status.have) + '/' + comma(totalNeed) + ')');
    });
    lines.push('', '- 제작 시 획득 물품:');
    (recipe.crafted || []).forEach(entry => {
        const total = getRecipeEntryCount(entry) * count;
        lines.push(' ㄴ ' + formatCraftedEntryWithTotal(entry, total));
    });
    if (!canConsumeCraftMaterialsTimes(user, recipe.materials || [], count)) {
        user.pendingAction = null;
        lines.push('', '❌ 재료가 부족합니다.');
    } else {
        user.pendingAction = { type: '제작', name: recipe.name, times: count };
        lines.push('', '제작하시겠습니까?', '/RPGenius 제작');
    }
    return lines.join('\n');
}

function canConsumeCraftMaterialsTimes(user, materials, times) {
    const clone = JSON.parse(JSON.stringify({
        gold: Number(user.gold || 0),
        garnet: Number(user.garnet || 0),
        inventory: user.inventory || {}
    }));
    for (let i = 0; i < times; i++) {
        if (!(materials || []).every(material => consumeCraftMaterial(clone, material))) return false;
    }
    return true;
}

function runCraft(user) {
    const pending = user.pendingAction;
    if (!pending || pending.type != '제작') return '❌ 진행 중인 제작이 없습니다.';
    const recipe = getRecipeByName(pending.name);
    const times = Math.max(1, Math.floor(Number(pending.times) || 1));
    user.pendingAction = null;
    if (!recipe) return '❌ 존재하지 않는 제작 레시피입니다.';
    if (!canConsumeCraftMaterialsTimes(user, recipe.materials || [], times)) return '❌ 재료가 부족합니다.';
    for (let i = 0; i < times; i++) {
        if (!(recipe.materials || []).every(material => consumeCraftMaterial(user, material))) return '❌ 재료 차감 중 오류가 발생했습니다.';
        (recipe.crafted || []).forEach(entry => grantCraftEntry(user, entry));
    }
    const header = '✅ \'' + recipe.name + '\' 제작에 성공했습니다.' + (times > 1 ? ' (x' + comma(times) + ')' : '');
    const lines = [header, '', '[ 획득 물품 ]'];
    (recipe.crafted || []).forEach(entry => {
        const total = getRecipeEntryCount(entry) * times;
        lines.push('- ' + formatCraftedEntryWithTotal(entry, total));
    });
    return lines.join('\n');
}

function parseItemSaleArgs(args) {
    if (!Array.isArray(args) || args.length == 0) return { error: '❌ /RPGenius 아이템판매 [아이템명] <갯수>' };
    const last = args[args.length - 1];
    const hasCount = args.length > 1 && /^\d+$/.test(last);
    const count = hasCount ? Number(last) : 1;
    const name = (hasCount ? args.slice(0, -1) : args).join(' ').trim();
    if (!name) return { error: '❌ 아이템명이 비어 있습니다.' };
    if (!Number.isInteger(count) || count < 1) return { error: '❌ 갯수는 1 이상의 정수여야 합니다.' };
    return { name, count };
}

function sellItemByName(user, args) {
    const parsed = parseItemSaleArgs(args);
    if (parsed.error) return parsed.error;
    const items = getDataCache('Item', []);
    const itemId = items.findIndex(item => item.name == parsed.name);
    if (itemId == -1) return '❌ 존재하지 않는 아이템입니다.';
    const item = items[itemId];
    if (!item || typeof item.sellPrice == 'undefined') return '❌ 판매할 수 없는 아이템입니다.';
    const unitPrice = Number(item.sellPrice || 0);
    if (unitPrice <= 0) return '❌ 판매할 수 없는 아이템입니다.';
    if (getInventoryItemCount(user, itemId) < parsed.count) return '❌ 보유한 아이템이 부족합니다.';
    if (!removeInventoryItem(user, itemId, parsed.count)) return '❌ 아이템 판매에 실패했습니다.';
    cleanupInventoryItems(user);
    const total = unitPrice * parsed.count;
    user.gold = Number(user.gold || 0) + total;
    return '✅ ' + item.name + ' x' + comma(parsed.count) + '을(를) 판매했습니다.\n- 🪙 +' + comma(total);
}

function consumeFragment(user) {
    if (!user.pendingFragment) return '❌ 사용 가능한 편린이 없습니다.';
    const tier = String(user.pendingFragment);
    const cfg = FRAGMENT_TIERS[tier];
    if (!cfg) { user.pendingFragment = null; return '❌ 알 수 없는 편린입니다. 데이터를 초기화했습니다.'; }
    if (!user.fragmentCounts || typeof user.fragmentCounts != 'object') user.fragmentCounts = {};
    if (!Array.isArray(user.fragmentCounts[tier])) user.fragmentCounts[tier] = [];
    const counts = user.fragmentCounts[tier];
    while (counts.length < cfg.rewards.length) counts.push(0);
    const computeEffective = () => cfg.rewards.map((r, i) => Math.max(0, Number(r.weight || 0) - Number(counts[i] || 0)));
    let effective = computeEffective();
    let totalWeight = effective.reduce((a, b) => a + b, 0);
    if (totalWeight <= 0) {
        for (let i = 0; i < counts.length; i++) counts[i] = 0;
        effective = computeEffective();
        totalWeight = effective.reduce((a, b) => a + b, 0);
    }
    if (totalWeight <= 0) { user.pendingFragment = null; return '❌ 편린 보상 데이터가 잘못되었습니다.'; }
    let roll = Math.random() * totalWeight;
    let chosenIdx = effective.length - 1;
    for (let i = 0; i < effective.length; i++) {
        roll -= effective[i];
        if (roll <= 0) { chosenIdx = i; break; }
    }
    const chosen = cfg.rewards[chosenIdx];
    counts[chosenIdx] = Number(counts[chosenIdx] || 0) + 1;
    const remaining = computeEffective().reduce((a, b) => a + b, 0);
    if (remaining <= 0) for (let i = 0; i < counts.length; i++) counts[i] = 0;
    const lines = ['✨ ' + cfg.name + '을(를) 사용했습니다.', '', '[ 획득 보상 ]'];
    if (chosen.type == 'gold') {
        const amount = Number(chosen.amount || 0);
        user.gold = Number(user.gold || 0) + amount;
        lines.push('- 🪙 +' + comma(amount));
    } else if (chosen.type == 'item') {
        const items = getDataCache('Item', []);
        const itemId = items.findIndex(it => it.name == chosen.name);
        if (itemId == -1) {
            user.pendingFragment = null;
            return '❌ 보상 아이템 \'' + chosen.name + '\'을(를) 찾을 수 없습니다.';
        }
        const count = Number(chosen.count || 1);
        addInventoryItem(user, itemId, count);
        lines.push('- ' + chosen.name + ' x' + comma(count));
    } else {
        user.pendingFragment = null;
        return '❌ 알 수 없는 보상 형식입니다.';
    }
    user.pendingFragment = null;
    return lines.join('\n');
}

function findItemByName(name) {
    const items = getDataCache('Item', []);
    const index = items.findIndex(item => item.name == name);
    if (index == -1) return null;
    return { index, item: items[index] };
}

const fishingTimers = {};
const fishingChannels = {};
const DEFAULT_BAIT_NAME = '일반 떡밥';

function getBaitData() {
    const cached = getDataCache('Bait', null);
    if (Array.isArray(cached)) return cached;
    return readJson(BAIT_PATH, []);
}

function getBaitDefinition(name) {
    const list = getBaitData();
    if (!Array.isArray(list)) return null;
    return list.find(b => b && b.name == name) || null;
}

function getCurrentBaitName(user) {
    const name = user && user.bait ? String(user.bait) : '';
    if (name && getBaitDefinition(name)) return name;
    return DEFAULT_BAIT_NAME;
}

function getCurrentBaitItemId(user) {
    const items = getDataCache('Item', []);
    const name = getCurrentBaitName(user);
    const id = items.findIndex(item => item && item.name == name);
    if (id != -1) return id;
    return items.findIndex(item => item && item.name == DEFAULT_BAIT_NAME);
}

function pickBaitReward(user) {
    const def = getBaitDefinition(getCurrentBaitName(user)) || getBaitDefinition(DEFAULT_BAIT_NAME);
    const rewards = (def && Array.isArray(def.rewards)) ? def.rewards : [];
    const total = rewards.reduce((s, r) => s + Number(r.rate || 0), 0);
    if (total <= 0) return null;
    const roll = Math.random() * total;
    let acc = 0;
    for (const r of rewards) {
        acc += Number(r.rate || 0);
        if (roll < acc) return Number(r.id);
    }
    return Number(rewards[0].id);
}

function normalizeFishingData(user) {
    if (!user.fishingNet || typeof user.fishingNet != 'object') user.fishingNet = {};
    Object.keys(user.fishingNet).forEach(itemId => {
        user.fishingNet[itemId] = Number(user.fishingNet[itemId] || 0);
        if (user.fishingNet[itemId] <= 0) delete user.fishingNet[itemId];
    });
    if (!user.fishingNetLimit) user.fishingNetLimit = 200;
    if (typeof user.fishing == 'undefined') user.fishing = false;
    if (!user.bait || !getBaitDefinition(String(user.bait))) user.bait = DEFAULT_BAIT_NAME;
}

function getFishingNetCount(user) {
    normalizeFishingData(user);
    return Object.keys(user.fishingNet).reduce((sum, itemId) => sum + Number(user.fishingNet[itemId] || 0), 0);
}

function addFishingNetItem(user, itemId, count) {
    normalizeFishingData(user);
    user.fishingNet[itemId] = Number(user.fishingNet[itemId] || 0) + Number(count || 0);
}

function formatFishingNet(user) {
    normalizeFishingData(user);
    const items = getDataCache('Item', []);
    const current = getFishingNetCount(user);
    const lines = ['🪣 ' + user.name + '님의 살림망 (' + comma(current) + '/' + comma(getEffectiveFishingNetLimit(user)) + ')'];
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
    if (channel) fishingChannels[user.name] = channel;
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
        if (getFishingNetCount(latest) >= getEffectiveFishingNetLimit(latest)) {
            await stopFishingByName(latest.name, stoppedUser => '🪣 ' + stoppedUser.name + '님의 살림망이 가득 찼습니다!\n- 현재 살림망: ' + comma(getFishingNetCount(stoppedUser)) + '/' + comma(getEffectiveFishingNetLimit(stoppedUser)));
            return;
        }
        const baitId = getCurrentBaitItemId(latest);
        if (baitId == -1 || getInventoryItemCount(latest, baitId) < 1) {
            await stopFishingByName(latest.name, stoppedUser => '🪱 ' + stoppedUser.name + '님의 ' + getCurrentBaitName(stoppedUser) + '이(가) 모두 소모되었습니다!\n- 현재 살림망: ' + comma(getFishingNetCount(stoppedUser)) + '/' + comma(getEffectiveFishingNetLimit(stoppedUser)));
            return;
        }
        removeInventoryItem(latest, baitId, 1);
        const rewardId = pickBaitReward(latest);
        if (rewardId != null) addFishingNetItem(latest, rewardId, 1);
        await latest.save();
        if (getFishingNetCount(latest) >= getEffectiveFishingNetLimit(latest)) {
            await stopFishingByName(latest.name, stoppedUser => '🪣 ' + stoppedUser.name + '님의 살림망이 가득 찼습니다!\n- 현재 살림망: ' + comma(getFishingNetCount(stoppedUser)) + '/' + comma(getEffectiveFishingNetLimit(stoppedUser)));
            return;
        }
        const remainBaitId = getCurrentBaitItemId(latest);
        if (remainBaitId == -1 || getInventoryItemCount(latest, remainBaitId) < 1) {
            await stopFishingByName(latest.name, stoppedUser => '🪱 ' + stoppedUser.name + '님의 ' + getCurrentBaitName(stoppedUser) + '이(가) 모두 소모되었습니다!\n- 현재 살림망: ' + comma(getFishingNetCount(stoppedUser)) + '/' + comma(getEffectiveFishingNetLimit(stoppedUser)));
            return;
        }
        scheduleFishing(latest, channel);
    }, getFishingInterval(user));
}

function getFishingInterval(user) {
    const speed = Math.min(0.9, Math.max(0, getActivePetSpecials(user).fishingSpeed));
    return Math.round(randomInt(30000, 60000) * (1 - speed));
}

async function toggleFishing(user, channel) {
    normalizeFishingData(user);
    if (user.fishing) {
        clearFishingTimer(user.name);
        delete fishingChannels[user.name];
        user.fishing = false;
        await user.save();
        return '✅ 낚시를 중단합니다.\n- 현재 살림망: ' + comma(getFishingNetCount(user)) + '/' + comma(getEffectiveFishingNetLimit(user));
    }
    if (getFishingNetCount(user) >= getEffectiveFishingNetLimit(user)) return '❌ 살림망이 가득 찼습니다.\n/RPGenius 살림망비우기';
    const baitId = getCurrentBaitItemId(user);
    if (baitId == -1 || getInventoryItemCount(user, baitId) < 1) return '❌ ' + getCurrentBaitName(user) + '이(가) 없습니다.';
    user.fishing = true;
    if (channel && channel.channelId) user.fishingChannelId = String(channel.channelId);
    await user.save();
    scheduleFishing(user, channel);
    return '🎣 낚시를 시작합니다..\n- 현재 살림망: ' + comma(getFishingNetCount(user)) + '/' + comma(getEffectiveFishingNetLimit(user));
}

async function resumeAllFishing(getChannelById) {
    try {
        const users = await getAllRPGUsers();
        let resumed = 0;
        for (const user of users) {
            if (!user || !user.fishing) continue;
            const channelId = user.fishingChannelId ? String(user.fishingChannelId) : null;
            const channel = channelId && typeof getChannelById == 'function' ? getChannelById(channelId) : null;
            scheduleFishing(user, channel);
            resumed++;
        }
        if (resumed > 0) console.log('[rpgenius] Resumed fishing for ' + resumed + ' user(s).');
    } catch (e) {
        console.error('[rpgenius] resumeAllFishing error:', e);
    }
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
    const items = getDataCache('Item', []);
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
    const items = getDataCache('Item', []);
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
    return '✅ ' + targetUser.name + '님에게' + (command.args[0] == '아이템지급' ? '' : '서') + ' 아이템을 ' + (command.args[0] == '아이템지급' ? '지급' : '제거') + '했습니다.\n- ' + itemName + ' x' + comma(count);
}

function rollSupportEquipmentStats(data) {
    const rolled = { stat: {}, plusStat: {} };
    const collect = (src, target) => {
        Object.keys(src || {}).forEach(k => { if (!(k in target)) target[k] = Math.round(Math.random() * 10000) / 10000; });
    };
    collect(data && data.statRange, rolled.stat);
    collect(data && data.plusStatRange, rolled.plusStat);
    (data && Array.isArray(data.upgrade) ? data.upgrade : []).forEach(u => {
        collect(u && u.statRange, rolled.stat);
        collect(u && u.plusStatRange, rolled.plusStat);
    });
    return rolled;
}

function addEquipmentInventory(user, type, id) {
    if (!user.inventory) user.inventory = { card: [], item: [] };
    if (!user.inventory.equipment) user.inventory.equipment = [];
    const entry = { type: type, id: id, level: 0 };
    if (type == 'support') {
        const data = getEquipmentData('support', id);
        if (data) entry.rolled = rollSupportEquipmentStats(data);
    }
    user.inventory.equipment.push(entry);
}

function autoUnequipInvalidSupport(user) {
    const sup = user.equipments && user.equipments.support;
    if (!sup || typeof sup.id == 'undefined') return null;
    const data = getEquipmentData('support', sup.id);
    if (!data) return null;
    if (Array.isArray(data.requireMainCard) && data.requireMainCard.length > 0) {
        const mainId = user.main_card && typeof user.main_card.id != 'undefined' ? Number(user.main_card.id) : null;
        if (mainId == null || !data.requireMainCard.map(Number).includes(mainId)) {
            if (!user.inventory) user.inventory = { card: [], item: [], equipment: [] };
            if (!Array.isArray(user.inventory.equipment)) user.inventory.equipment = [];
            const entry = cloneEquipmentInstance(sup, 'support');
            user.inventory.equipment.push(entry);
            user.equipments.support = null;
            return data;
        }
    }
    return null;
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

    if (!user.equipments) user.equipments = { weapon: {}, armor: {}, accessory: {}, support: null };

    if (target.type == 'support') {
        if (Array.isArray(data.requireMainCard) && data.requireMainCard.length > 0) {
            const mainId = user.main_card && typeof user.main_card.id != 'undefined' ? Number(user.main_card.id) : null;
            if (mainId == null || !data.requireMainCard.map(Number).includes(mainId)) {
                return '❌ 해당 보조 장비를 장착할 수 있는 캐릭터 카드가 아닙니다.';
            }
        }
        const prev = user.equipments.support;
        const equipEntry = bindEquipmentToUser(cloneEquipmentInstance(target, 'support'), user);
        user.equipments.support = equipEntry;
        user.inventory.equipment.splice(invIndex, 1);
        if (prev && typeof prev.id != 'undefined') {
            const back = cloneEquipmentInstance(prev, 'support');
            user.inventory.equipment.push(back);
        }
        return '✅ 보조 장비를 장착했습니다.\n<' + data.rarity + '> ' + getEquipmentDisplayName(data, target) + (Number(target.level || 0) > 0 ? ' +' + target.level : '');
    }

    if (target.type == 'weapon' || target.type == 'armor') {
        const prev = user.equipments[target.type];
        const equipEntry = bindEquipmentToUser(cloneEquipmentInstance(target, target.type), user);
        user.equipments[target.type] = equipEntry;
        user.inventory.equipment.splice(invIndex, 1);
        if (prev && typeof prev.id != 'undefined') {
            const back = cloneEquipmentInstance(prev, target.type);
            user.inventory.equipment.push(back);
        }
        return '✅ ' + (target.type == 'weapon' ? "무기를" : "갑옷을") + ' 장착했습니다.\n<' + data.rarity + '> ' + getEquipmentDisplayName(data, target) + (Number(target.level || 0) > 0 ? ' +' + target.level : '');
    }

    if (target.type == 'accessory') {
        if (!user.equipments.accessory || typeof user.equipments.accessory != 'object') user.equipments.accessory = {};
        const accessories = user.equipments.accessory;
        if (Object.keys(accessories).some(key => accessories[key] && Number(accessories[key].id) == Number(target.id))) return '❌ 같은 종류의 장신구는 중복 장착할 수 없습니다.';
        const category = typeof data.category != 'undefined' ? String(data.category).trim() : '';
        if (category && Object.keys(accessories).some(key => {
            const equipped = accessories[key];
            if (!equipped || typeof equipped.id == 'undefined') return false;
            const equippedData = getEquipmentData('accessory', equipped.id);
            return equippedData && typeof equippedData.category != 'undefined' && String(equippedData.category).trim() == category;
        })) return '❌ 같은 분류의 장신구는 중복 장착할 수 없습니다. (' + category + ')';
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
        const equipEntry = bindEquipmentToUser(cloneEquipmentInstance(target, 'accessory'), user);
        accessories[slotKey] = equipEntry;
        user.inventory.equipment.splice(invIndex, 1);
        return '✅ 장신구를 장착했습니다.\n<' + data.rarity + '> ' + getEquipmentDisplayName(data, target) + (Number(target.level || 0) > 0 ? ' +' + target.level : '');
    }

    return '❌ 알 수 없는 장비 타입입니다.';
}

function unequipSupport(user) {
    if (!user.equipments || !user.equipments.support || typeof user.equipments.support.id == 'undefined') return '❌ 장착 중인 보조 장비가 없습니다.';
    const sup = user.equipments.support;
    const data = getEquipmentData('support', sup.id);
    if (!data) {
        user.equipments.support = null;
        return '❌ 잘못된 보조 장비 데이터입니다.';
    }
    if (!user.inventory) user.inventory = { card: [], item: [], equipment: [] };
    if (!Array.isArray(user.inventory.equipment)) user.inventory.equipment = [];
    const entry = cloneEquipmentInstance(sup, 'support');
    user.inventory.equipment.push(entry);
    user.equipments.support = null;
    const stats = calculateUserStats(user);
    user.hp = Math.min(typeof user.hp == 'undefined' ? Number(stats.hp || 0) : Number(user.hp || 0), Number(stats.hp || 0));
    user.mp = Math.min(typeof user.mp == 'undefined' ? Number(stats.mp || 0) : Number(user.mp || 0), Number(stats.mp || 0));
    return '✅ 보조 장비를 해제했습니다.\n<' + data.rarity + '> ' + getEquipmentDisplayName(data, sup) + (Number(sup.level || 0) > 0 ? ' +' + sup.level : '');
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
    const entry = cloneEquipmentInstance(equipped, 'accessory');
    user.inventory.equipment.push(entry);
    delete user.equipments.accessory[slotKey];
    const stats = calculateUserStats(user);
    user.hp = Math.min(typeof user.hp == 'undefined' ? Number(stats.hp || 0) : Number(user.hp || 0), Number(stats.hp || 0));
    user.mp = Math.min(typeof user.mp == 'undefined' ? Number(stats.mp || 0) : Number(user.mp || 0), Number(stats.mp || 0));
    return '✅ 장신구를 해제했습니다.\n<' + data.rarity + '> ' + getEquipmentDisplayName(data, equipped) + (Number(equipped.level || 0) > 0 ? ' +' + equipped.level : '');
}

function unequipEquipmentByNumber(user, numberArg) {
    const number = Number(numberArg);
    if (!Number.isInteger(number) || number < 1) return '❌ 장비 번호를 올바르게 입력해주세요.';
    const selected = getAllUserEquipments(user)[number - 1];
    if (!selected || selected.source != 'equipped' || !selected.equip || typeof selected.equip.id == 'undefined') return '❌ 장착 중인 장비 번호가 아닙니다.';
    const type = selected.equip.type || selected.type;
    const data = getEquipmentData(type, selected.equip.id);
    if (!data) return '❌ 잘못된 장비 데이터입니다.';
    if (!user.inventory) user.inventory = { card: [], item: [], equipment: [] };
    if (!Array.isArray(user.inventory.equipment)) user.inventory.equipment = [];
    if (type != 'weapon' && type != 'armor' && type != 'support' && !(type == 'accessory' && typeof selected.slotKey != 'undefined')) return '❌ 알 수 없는 장비 타입입니다.';
    user.inventory.equipment.push(cloneEquipmentInstance(selected.equip, type));
    if (type == 'weapon') user.equipments.weapon = null;
    else if (type == 'armor') user.equipments.armor = null;
    else if (type == 'support') user.equipments.support = null;
    else if (type == 'accessory') delete user.equipments.accessory[selected.slotKey];
    const stats = calculateUserStats(user);
    user.hp = Math.min(typeof user.hp == 'undefined' ? Number(stats.hp || 0) : Number(user.hp || 0), Number(stats.hp || 0));
    user.mp = Math.min(typeof user.mp == 'undefined' ? Number(stats.mp || 0) : Number(user.mp || 0), Number(stats.mp || 0));
    return '✅ ' + getEquipmentTypeLabel(type) + ' 장비를 해제했습니다.\n<' + data.rarity + '> ' + getEquipmentDisplayName(data, selected.equip) + (Number(selected.equip.level || 0) > 0 ? ' +' + selected.equip.level : '');
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
    '레전더리': { min: 560, max: 650 },
    '고유': { min: 800, max: 950 }
};
const SUPPORT_DISASSEMBLE_BLACK_FIRE_REWARD = { '일반': 1, '레어': 2, '유니크': 5, '레전더리': 10 };
const EQUIPMENT_STONE_MULTIPLIERS = [1.0, 1.4, 1.9, 2.5, 3.2, 4.0, 5.0, 6.2, 7.6, 10.3, 13.9, 18.7, 25.2, 34.1, 46.0];
const ACCESSORY_UPGRADE_RATE_INDEX = [1, 3, 5, 8, 11];

function getEquipmentMaxLevel(equipment) {
    return Array.isArray(equipment && equipment.upgrade) ? equipment.upgrade.length : 0;
}

function getEquipmentUpgradeRates(type, level) {
    if (type == 'accessory') {
        const idx = ACCESSORY_UPGRADE_RATE_INDEX[level];
        return EQUIPMENT_UPGRADE_RATES[typeof idx == 'number' ? idx : level];
    }
    return EQUIPMENT_UPGRADE_RATES[level];
}

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

function refundPendingActionItem(user, pending) {
    if (!pending || typeof pending.consumedItemId == 'undefined') return null;
    const count = Number(pending.consumedItemCount || 1);
    if (count <= 0) return null;
    addInventoryItem(user, pending.consumedItemId, count);
    const items = getDataCache('Item', []);
    const item = items[pending.consumedItemId];
    return (item ? item.name : '알 수 없는 아이템') + ' x' + comma(count);
}

function getAccessoryChoiceCandidates(rarity) {
    const equipments = getDataCache('Equipment', {});
    return (equipments.accessory || [])
        .map((equipment, id) => ({ id, equipment }))
        .filter(entry => entry.equipment && entry.equipment.rarity == rarity && entry.equipment.name != '신규 장신구');
}

function formatAccessoryChoiceList(candidates) {
    const lines = ['[ 장신구 선택 ]'];
    candidates.forEach((entry, index) => {
        lines.push((index + 1) + '. <' + entry.equipment.rarity + '> ' + entry.equipment.name);
    });
    return lines.join('\n');
}

function selectAccessoryChoice(user, numberArg) {
    const pending = user.pendingAction;
    if (!pending || pending.type != '장신구선택권') return '❌ 진행 중인 장신구 선택이 없습니다.';
    const candidates = getAccessoryChoiceCandidates(pending.rarity);
    if (candidates.length == 0) {
        const refund = refundPendingActionItem(user, pending);
        user.pendingAction = null;
        return '❌ 선택 가능한 장신구가 없습니다.' + (refund ? '\n[ 반환 ]\n- ' + refund : '');
    }
    const number = Number(numberArg);
    if (!Number.isInteger(number) || number < 1 || number > candidates.length) return '❌ 존재하지 않는 장신구 번호입니다.\n/RPGenius 선택 [번호]';
    const selected = candidates[number - 1];
    addEquipmentInventory(user, 'accessory', selected.id);
    user.pendingAction = null;
    return '✅ 장신구를 선택했습니다.\n[ 획득 결과 ]\n- <' + selected.equipment.rarity + '> ' + selected.equipment.name;
}

function getSupportRerollTargets(user) {
    return getAllUserEquipments(user)
        .map((entry, index) => {
            const type = entry.equip.type || entry.type;
            if (type != 'support') return null;
            const equipment = getEquipmentData('support', entry.equip.id);
            if (!equipment) return null;
            return { number: index + 1, entry, equipment };
        })
        .filter(Boolean);
}

function formatSupportRerollList(targets) {
    const lines = ['[ 보조 장비 선택 ]', VIEWMORE];
    targets.forEach(target => {
        const lvl = Number(target.entry.equip.level || 0);
        const lockMark = target.entry.equip.locked ? ' 🔒' : '';
        const equippedMark = target.entry.source == 'equipped' ? ' (장착)' : '';
        lines.push('[' + target.number + '] <' + target.equipment.rarity + '> ' + getEquipmentDisplayName(target.equipment, target.entry.equip) + (lvl > 0 ? ' +' + lvl : '') + equippedMark + lockMark);
    });
    return lines.join('\n');
}

function rerollSupportEquipment(user, numberArg) {
    const pending = user.pendingAction;
    if (!pending || pending.type != '보조장비리롤') return '❌ 진행 중인 보조 장비 재설정이 없습니다.';
    const number = Number(numberArg);
    if (!Number.isInteger(number) || number < 1) return '❌ /RPGenius 선택 [장비번호]';
    const selected = getAllUserEquipments(user)[number - 1];
    if (!selected) return '❌ 존재하지 않는 장비 번호입니다.';
    const type = selected.equip.type || selected.type;
    if (type != 'support') return '❌ 보조 장비만 선택할 수 있습니다.';
    const equipment = getEquipmentData('support', selected.equip.id);
    if (!equipment) return '❌ 잘못된 보조 장비 데이터입니다.';
    selected.equip.rolled = rollSupportEquipmentStats(equipment);
    user.pendingAction = null;
    const lvl = Number(selected.equip.level || 0);
    return '✅ 보조 장비 스탯을 재설정했습니다.\n- <' + equipment.rarity + '> ' + getEquipmentDisplayName(equipment, selected.equip) + (lvl > 0 ? ' +' + lvl : '') + '\n' + formatCurrentEquipmentStatLines(equipment, lvl, selected.equip.rolled, { soul: selected.equip.soul });
}

function getEquipmentByNumber(user, numberArg) {
    const number = Number(numberArg);
    if (!Number.isInteger(number) || number < 1) return null;
    const all = getAllUserEquipments(user);
    return all[number - 1] || null;
}

function formatEquipmentName(type, id, level, equip) {
    const data = getEquipmentData(type, id);
    if (!data) return '알 수 없는 장비';
    return '<' + data.rarity + '> ' + getEquipmentDisplayName(data, equip) + (Number(level || 0) > 0 ? ' +' + Number(level || 0) : '');
}

function getEquipmentSynthesisSelection(user, numberArgs) {
    if (!Array.isArray(numberArgs) || numberArgs.length != 3) return { error: '❌ /RPGenius 장비합성 [장비번호1] [장비번호2] [장비번호3]' };
    const numbers = numberArgs.map(arg => Number(arg));
    if (numbers.some(number => !Number.isInteger(number) || number < 1)) return { error: '❌ 장비 번호는 1 이상의 정수여야 합니다.' };
    if (new Set(numbers).size != 3) return { error: '❌ 같은 장비 번호를 중복 선택할 수 없습니다.' };
    const selected = numbers.map(number => getEquipmentByNumber(user, number));
    if (selected.some(entry => !entry)) return { error: '❌ 존재하지 않는 장비 번호가 있습니다.' };
    if (selected.some(entry => entry.source == 'equipped')) return { error: '❌ 장착 중인 장비는 합성할 수 없습니다.' };
    const first = selected[0].equip;
    const type = first.type || selected[0].type;
    const id = Number(first.id);
    if (selected.some(entry => (entry.equip.type || entry.type) != type || Number(entry.equip.id) != id)) return { error: '❌ 동일한 장비 3개만 합성할 수 있습니다.' };
    if (selected.some(entry => Number(entry.equip.level || 0) < 10)) return { error: '❌ 합성할 장비는 모두 10강 이상이어야 합니다.' };
    const equipment = getEquipmentData(type, id);
    if (!equipment) return { error: '❌ 잘못된 장비 데이터입니다.' };
    if (typeof equipment.evolution == 'undefined') return { error: '❌ 해당 장비는 합성 진화가 불가능합니다.' };
    const resultId = Number(equipment.evolution);
    const resultEquipment = getEquipmentData(type, resultId);
    if (!resultEquipment) return { error: '❌ 합성 결과 장비 데이터가 없습니다.' };
    return { numbers, selected, type, id, equipment, resultId, resultEquipment };
}

function formatEquipmentSynthesisPreview(user, numberArgs) {
    const selection = getEquipmentSynthesisSelection(user, numberArgs);
    if (selection.error) return selection.error;
    user.pendingAction = { type: '장비합성', numbers: selection.numbers };
    const lines = ['[ 장비 합성 ]'];
    selection.selected.forEach(entry => {
        lines.push('- ' + formatEquipmentName(selection.type, selection.id, entry.equip.level, entry.equip));
    });
    lines.push('', '[ 합성 결과 ]');
    lines.push('- <' + selection.resultEquipment.rarity + '> ' + selection.resultEquipment.name);
    lines.push('', '합성을 진행하시겠습니까?', '/RPGenius 합성');
    return lines.join('\n');
}

function runEquipmentSynthesis(user) {
    const pending = user.pendingAction;
    if (!pending || pending.type != '장비합성') return '❌ 진행 중인 장비 합성이 없습니다.';
    const selection = getEquipmentSynthesisSelection(user, pending.numbers);
    user.pendingAction = null;
    if (selection.error) return selection.error;
    selection.selected
        .slice()
        .sort((a, b) => b.index - a.index)
        .forEach(entry => user.inventory.equipment.splice(entry.index, 1));
    addEquipmentInventory(user, selection.type, selection.resultId);
    return '✅ 장비 합성이 완료되었습니다.\n[ 합성 결과 ]\n- <' + selection.resultEquipment.rarity + '> ' + selection.resultEquipment.name;
}

function getEquipmentUpgradeCost(equipment, type, level) {
    const targetLevel = Number(level || 0) + 1;
    const rarityCorrection = EQUIPMENT_RARITY_CORRECTION[equipment.rarity] || 1;
    const stoneMultiplier = EQUIPMENT_STONE_MULTIPLIERS[level] || 1;
    const armorMultiplier = type == 'armor' ? 0.85 : 1;
    const accessoryMultiplier = type == 'accessory' ? 6 : 1;
    const stone = Math.floor(((level + 10) * 3 * rarityCorrection) * stoneMultiplier * armorMultiplier * accessoryMultiplier);
    const goldRate = EQUIPMENT_GOLD_RATE[equipment.rarity] || 1;
    const gold = Math.floor(goldRate * ((Math.pow(targetLevel, 4) / 5) + 1)) * 8 * accessoryMultiplier;
    return { stone, gold };
}

function getBlackFireItemId() {
    return getDataCache('Item', []).findIndex(item => item && item.name == '검은 불');
}

function getDisassembleStoneAmount(rewardRange, type) {
    const stone = randomInt(rewardRange.min, rewardRange.max);
    return type == 'support' ? Math.floor(stone * 0.5) : stone;
}

function getDisassembleRewardRange(rewardRange, type) {
    if (type != 'support') return rewardRange;
    return { min: Math.floor(rewardRange.min * 0.5), max: Math.floor(rewardRange.max * 0.5) };
}

function getSupportDisassembleBlackFireCount(equipment, type) {
    return type == 'support' ? Number(SUPPORT_DISASSEMBLE_BLACK_FIRE_REWARD[equipment.rarity] || 0) : 0;
}

function getDarkPieceDisassembleCount(equipment) {
    return equipment && String(equipment.category || '').trim() == '핏빛 분장' ? 1 : 0;
}

function pushLimitedEquipmentLines(lines, equipmentLines) {
    const visibleLines = equipmentLines.slice(0, 10);
    visibleLines.forEach(line => lines.push(line));
    if (equipmentLines.length > 10) lines.push('...(총 ' + comma(equipmentLines.length) + '개)');
}

function parseDisassembleSelection(user, numberArgs) {
    if (!Array.isArray(numberArgs) || numberArgs.length == 0) return { error: '❌ /RPGenius 분해 [장비번호1] [장비번호2]...' };
    const numbers = numberArgs.map(arg => Number(arg));
    if (numbers.some(n => !Number.isInteger(n) || n < 1)) return { error: '❌ 장비 번호는 1 이상의 정수여야 합니다.' };
    if (new Set(numbers).size != numbers.length) return { error: '❌ 같은 장비 번호를 중복 선택할 수 없습니다.' };
    const all = getAllUserEquipments(user);
    const entries = [];
    for (const number of numbers) {
        const entry = all[number - 1];
        if (!entry) return { error: '❌ 존재하지 않는 장비 번호가 있습니다: ' + number };
        if (entry.source == 'equipped') return { error: '❌ 장착 중인 장비는 분해할 수 없습니다: [' + number + ']' };
        if (entry.equip.locked) return { error: '❌ 잠긴 장비는 분해할 수 없습니다: [' + number + ']' };
        const type = entry.equip.type || entry.type;
        const equipment = getEquipmentData(type, entry.equip.id);
        if (!equipment) return { error: '❌ 잘못된 장비 데이터입니다: [' + number + ']' };
        const rewardRange = EQUIPMENT_DISASSEMBLE_REWARD[equipment.rarity];
        if (!rewardRange) return { error: '❌ 분해할 수 없는 등급(' + equipment.rarity + ')이 포함되어 있습니다: [' + number + ']' };
        entries.push({ number, entry, type, equipment, rewardRange });
    }
    return { numbers, entries };
}

function formatDisassemblePreview(user, numberArgs) {
    const parsed = parseDisassembleSelection(user, numberArgs);
    if (parsed.error) { user.pendingAction = null; return parsed.error; }
    user.pendingAction = { type: '장비분해', numbers: parsed.numbers };
    const lines = ['[ 장비 분해 ]'];
    let minTotal = 0;
    let maxTotal = 0;
    let blackFireTotal = 0;
    let darkPieceTotal = 0;
    const equipmentLines = [];
    parsed.entries.forEach(e => {
        const lvl = Number(e.entry.equip.level || 0);
        const range = getDisassembleRewardRange(e.rewardRange, e.type);
        const blackFire = getSupportDisassembleBlackFireCount(e.equipment, e.type);
        const darkPiece = getDarkPieceDisassembleCount(e.equipment);
        equipmentLines.push('- <' + e.equipment.rarity + '> ' + getEquipmentDisplayName(e.equipment, e.entry.equip) + (lvl > 0 ? ' +' + lvl : '') + ' (강화석 ' + comma(range.min) + '~' + comma(range.max) + (blackFire > 0 ? ', 검은 불 ' + comma(blackFire) : '') + (darkPiece > 0 ? ', 어둠 조각 ' + comma(darkPiece) : '') + ')');
        minTotal += range.min;
        maxTotal += range.max;
        blackFireTotal += blackFire;
        darkPieceTotal += darkPiece;
    });
    pushLimitedEquipmentLines(lines, equipmentLines);
    lines.push('', '[ 예상 획득 ]');
    lines.push('- 강화석 ' + comma(minTotal) + ' ~ ' + comma(maxTotal));
    if (blackFireTotal > 0) lines.push('- 검은 불 x' + comma(blackFireTotal));
    if (darkPieceTotal > 0) lines.push('- 어둠 조각 x' + comma(darkPieceTotal));
    lines.push('', '분해하시겠습니까?', '/RPGenius 분해확인');
    return lines.join('\n');
}

function runDisassemble(user) {
    const pending = user.pendingAction;
    if (!pending || pending.type != '장비분해') return '❌ 진행 중인 분해 작업이 없습니다.';
    user.pendingAction = null;
    const parsed = parseDisassembleSelection(user, pending.numbers);
    if (parsed.error) return parsed.error;
    const entries = parsed.entries.slice().sort((a, b) => b.entry.index - a.entry.index);
    const blackFireItemId = entries.some(e => getSupportDisassembleBlackFireCount(e.equipment, e.type) > 0) ? getBlackFireItemId() : -1;
    if (entries.some(e => getSupportDisassembleBlackFireCount(e.equipment, e.type) > 0) && blackFireItemId == -1) return '❌ 검은 불 아이템 데이터를 찾을 수 없습니다.';
    const darkPieceItemId = entries.some(e => getDarkPieceDisassembleCount(e.equipment) > 0) ? getItemIdByName('어둠 조각') : -1;
    if (entries.some(e => getDarkPieceDisassembleCount(e.equipment) > 0) && darkPieceItemId == -1) return '❌ 어둠 조각 아이템 데이터를 찾을 수 없습니다.';
    let totalStone = 0;
    let totalBlackFire = 0;
    let totalDarkPiece = 0;
    const dismantledLines = [];
    entries.forEach(e => {
        const stone = getDisassembleStoneAmount(e.rewardRange, e.type);
        const blackFire = getSupportDisassembleBlackFireCount(e.equipment, e.type);
        const darkPiece = getDarkPieceDisassembleCount(e.equipment);
        totalStone += stone;
        totalBlackFire += blackFire;
        totalDarkPiece += darkPiece;
        user.inventory.equipment.splice(e.entry.index, 1);
        const lvl = Number(e.entry.equip.level || 0);
        dismantledLines.push('- <' + e.equipment.rarity + '> ' + getEquipmentDisplayName(e.equipment, e.entry.equip) + (lvl > 0 ? ' +' + lvl : '') + ' → 강화석 x' + comma(stone) + (blackFire > 0 ? ', 검은 불 x' + comma(blackFire) : '') + (darkPiece > 0 ? ', 어둠 조각 x' + comma(darkPiece) : ''));
    });
    if (totalStone > 0) addInventoryItem(user, EQUIPMENT_STONE_ITEM_ID, totalStone);
    if (totalBlackFire > 0) addInventoryItem(user, blackFireItemId, totalBlackFire);
    if (totalDarkPiece > 0) addInventoryItem(user, darkPieceItemId, totalDarkPiece);
    const lines = ['✅ 장비 ' + comma(entries.length) + '개를 분해했습니다.', '', '[ 분해 장비 ]'];
    pushLimitedEquipmentLines(lines, dismantledLines);
    lines.push('', '[ 획득 결과 ]', '- 강화석 x' + comma(totalStone));
    if (totalBlackFire > 0) lines.push('- 검은 불 x' + comma(totalBlackFire));
    if (totalDarkPiece > 0) lines.push('- 어둠 조각 x' + comma(totalDarkPiece));
    return lines.join('\n');
}

function formatBulkDisassemblePreview(user, rarityArg, countArg) {
    const rarity = String(rarityArg || '').trim();
    if (!rarity) return '❌ /RPGenius 일괄분해 [등급] <갯수>';
    if (!EQUIPMENT_DISASSEMBLE_REWARD[rarity]) return '❌ 분해할 수 없는 등급입니다: ' + rarity;
    let count = null;
    if (countArg != null && countArg !== '') {
        count = Number(countArg);
        if (!Number.isInteger(count) || count < 1) return '❌ 갯수는 1 이상의 정수여야 합니다.';
    }
    const all = getAllUserEquipments(user);
    const eligibleNumbers = [];
    all.forEach((entry, i) => {
        if (entry.source != 'inventory') return;
        if (entry.equip.locked) return;
        const type = entry.equip.type || entry.type;
        const equipment = getEquipmentData(type, entry.equip.id);
        if (!equipment || equipment.rarity != rarity) return;
        eligibleNumbers.push(i + 1);
    });
    if (eligibleNumbers.length == 0) return '❌ 분해 가능한 ' + rarity + ' 등급 장비가 없습니다.';
    const finalCount = count == null ? eligibleNumbers.length : Math.min(count, eligibleNumbers.length);
    return formatDisassemblePreview(user, eligibleNumbers.slice(0, finalCount));
}

function toggleEquipmentLock(user, numberArg) {
    const selected = getEquipmentByNumber(user, numberArg);
    if (!selected) return '❌ 존재하지 않는 장비 번호입니다.';
    const type = selected.equip.type || selected.type;
    const equipment = getEquipmentData(type, selected.equip.id);
    if (!equipment) return '❌ 잘못된 장비 데이터입니다.';
    selected.equip.locked = !selected.equip.locked;
    const lvl = Number(selected.equip.level || 0);
    const status = selected.equip.locked ? '🔒 잠금' : '🔓 잠금 해제';
    return '✅ <' + equipment.rarity + '> ' + getEquipmentDisplayName(equipment, selected.equip) + (lvl > 0 ? ' +' + lvl : '') + ' ' + status;
}

function formatUpgradeRatePercent(value) {
    return Math.round(Number(value || 0) * 1000) / 10 + '%';
}

function formatEquipmentUpgradePreview(user, numberArg, options) {
    const selected = getEquipmentByNumber(user, numberArg);
    if (!selected) return '❌ 존재하지 않는 장비 번호입니다.';
    if (selected.equip.locked) return '❌ 잠긴 장비는 강화할 수 없습니다. (/RPGenius 잠금 ' + numberArg + ')';
    const type = selected.equip.type || selected.type;
    const equipment = getEquipmentData(type, selected.equip.id);
    if (!equipment) return '❌ 잘못된 장비 데이터입니다.';
    if (!Array.isArray(equipment.upgrade) || equipment.upgrade.length == 0) return '❌ 강화할 수 없는 장비입니다.';
    const level = Number(selected.equip.level || 0);
    const maxLevel = getEquipmentMaxLevel(equipment);
    if (level >= maxLevel) return '❌ 이미 최대 강화 단계입니다.';

    const nextLevel = level + 1;
    const currentStats = getEquipmentStatsAtLevel(equipment, level);
    const nextStats = getEquipmentStatsAtLevel(equipment, nextLevel);
    const currentPlus = getEquipmentPlusStatsAtLevel(equipment, level);
    const nextPlus = getEquipmentPlusStatsAtLevel(equipment, nextLevel);
    const rolled = selected.equip && selected.equip.rolled;
    if (rolled) {
        const curResolved = resolveRolledStats(equipment, level, rolled);
        const nxtResolved = resolveRolledStats(equipment, nextLevel, rolled);
        addStats(currentStats, curResolved.stat);
        addStats(nextStats, nxtResolved.stat);
        addStats(currentPlus, curResolved.plusStat);
        addStats(nextPlus, nxtResolved.plusStat);
    }
    const statNames = {
        atk: '공격력', pnt: '방어 관통력', def: '방어력', hp: '체력', mp: 'MP', plusGold: '처치 당 골드',
        crit: '치명타 확률', critMul: '치명타 피해량', critDef: '치명타 피해 감소율',
        cmb: '연격 확률', maxCmb: '추가 공격 횟수',
        skillCooldown: '스킬 쿨타임', skillTrueDmg: '스킬 사용 시 추가 고정 피해'
    };
    const plusStatNames = {
        atk: '최종 공격력', def: '최종 방어력', hp: '최종 체력', mp: '최종 MP',
        pnt: '방어력 관통',
        gold: '골드 획득량', potion: '물약 효율', recoveryEfficiency: '회복 효율', afterBasic: '일반 공격 피해',
        avd: '회피 확률', afterSkill: '스킬 공격 피해',
        '000': '공격 시 10/100/1000 추가 피해 확률', exp: '경험치 획득량',
        eliteDmg: '엘리트 몬스터 대상 추가 피해', mpReduce: 'MP 소모량',
        itemDropChance: '아이템 획득 확률', crit: '치명타 확률',
        critMul: '치명타 피해량', critDef: '치명타 피해 감소율', cmb: '연격 확률',
        maxCmb: '추가 공격 횟수', skillCooldown: '스킬 쿨타임',
        skillTrueDmg: '스킬 사용 시 추가 고정 피해',
        takenDamage: '받는 피해 증가', damageBonus: '일반 몬스터에게 주는 피해 증가'
    };
    const rates = getEquipmentUpgradeRates(type, level);
    const cost = getEquipmentUpgradeCost(equipment, type, level);
    const isFreeUpgrade = options && options.free;
    const stoneCount = getInventoryItemCount(user, EQUIPMENT_STONE_ITEM_ID);
    const hasStone = stoneCount >= cost.stone;
    const hasGold = Number(user.gold || 0) >= cost.gold;
    const lines = ['⚒️ ' + getEquipmentDisplayName(equipment, selected.equip) + ' +' + level + ' -> +' + nextLevel];
    Object.keys(statNames).forEach(key => {
        if (Number(currentStats[key] || 0) != Number(nextStats[key] || 0)) lines.push('- ' + statNames[key] + ' ' + formatStatValue(key, currentStats[key] || 0).replace(/^\+/, '') + ' -> ' + formatStatValue(key, nextStats[key] || 0).replace(/^\+/, ''));
    });
    Object.keys(plusStatNames).forEach(key => {
        if (Number(currentPlus[key] || 0) != Number(nextPlus[key] || 0)) lines.push('- ' + plusStatNames[key] + ' ' + formatPlusStatValue(key, currentPlus[key] || 0).replace(/^\+/, '') + ' -> ' + formatPlusStatValue(key, nextPlus[key] || 0).replace(/^\+/, ''));
    });
    if (type == 'support') {
        const curDyn = getEquipmentDynamicBonusAtLevel(equipment, level);
        const nextDyn = getEquipmentDynamicBonusAtLevel(equipment, nextLevel);
        const stars = new Set([...Object.keys(curDyn), ...Object.keys(nextDyn)]);
        Array.from(stars).sort((a, b) => Number(a) - Number(b)).forEach(starKey => {
            const cur = curDyn[starKey] || { stat: {}, plusStat: {} };
            const nxt = nextDyn[starKey] || { stat: {}, plusStat: {} };
            const statKeys = new Set([...Object.keys(cur.stat || {}), ...Object.keys(nxt.stat || {})]);
            statKeys.forEach(k => {
                const a = Number((cur.stat || {})[k] || 0);
                const b = Number((nxt.stat || {})[k] || 0);
                if (a != b) lines.push('- [' + (Number(starKey) + 1) + '성] ' + (SUPPORT_STAT_LABELS[k] || k) + ' ' + formatStatValue(k, a).replace(/^\+/, '') + ' -> ' + formatStatValue(k, b).replace(/^\+/, ''));
            });
            const plusKeys = new Set([...Object.keys(cur.plusStat || {}), ...Object.keys(nxt.plusStat || {})]);
            plusKeys.forEach(k => {
                const a = Number((cur.plusStat || {})[k] || 0);
                const b = Number((nxt.plusStat || {})[k] || 0);
                if (a != b) lines.push('- [' + (Number(starKey) + 1) + '성] ' + (SUPPORT_PLUS_STAT_LABELS[k] || k) + ' ' + formatPlusStatValue(k, a).replace(/^\+/, '') + ' -> ' + formatPlusStatValue(k, b).replace(/^\+/, ''));
            });
        });
    }
    lines.push('', '[ 강화 확률 ]');
    lines.push('⏫ 대성공 ' + formatUpgradeRatePercent(rates.great));
    lines.push('🔼 성공 ' + formatUpgradeRatePercent(rates.success));
    lines.push('🔽 하락 ' + formatUpgradeRatePercent(rates.down));
    lines.push('💥 파괴 ' + formatUpgradeRatePercent(rates.reset));
    if (isFreeUpgrade) {
        lines.push('', '✨ 유생의 강화기 효과가 적용됩니다.');
    } else {
        lines.push('', '[ 필요 재료 ]');
        lines.push((hasStone ? '✅ ' : '❌ ') + '강화석 x' + comma(cost.stone));
        lines.push((hasGold ? '✅ ' : '❌ ') + '🪙 ' + comma(cost.gold));
    }
    if (getInventoryItemCount(user, EQUIPMENT_BLESSED_PROTECT_ITEM_ID) > 0) lines.push('', '🛡️ 축복받은 장비 보호권 보유\n- 파괴/하락 시 유지');
    else if (getInventoryItemCount(user, EQUIPMENT_ADVANCED_PROTECT_ITEM_ID) > 0) lines.push('', '🛡️ 고급 장비 보호권 보유\n- 파괴 시 유지');
    else if (getInventoryItemCount(user, EQUIPMENT_PROTECT_ITEM_ID) > 0) lines.push('', '🛡️ 장비 보호권 보유\n- 파괴 시 0강 초기화');
    if (!isFreeUpgrade && (!hasStone || !hasGold)) {
        user.pendingAction = null;
        lines.push('', '❌ 재료가 부족합니다!');
    } else {
        const pending = {
            type: '장비강화',
            number: Number(numberArg),
            equipmentType: type,
            free: !!isFreeUpgrade
        };
        if (options && typeof options.consumedItemId != 'undefined') pending.consumedItemId = options.consumedItemId;
        if (options && typeof options.consumedItemCount != 'undefined') pending.consumedItemCount = options.consumedItemCount;
        user.pendingAction = pending;
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
    const equipment = getEquipmentData(type, selected.equip.id);
    const level = Number(selected.equip.level || 0);
    const maxLevel = getEquipmentMaxLevel(equipment);
    if (!equipment || maxLevel == 0 || level >= maxLevel) {
        user.pendingAction = null;
        return '❌ 강화할 수 없는 장비입니다.';
    }
    const cost = getEquipmentUpgradeCost(equipment, type, level);
    const isFreeUpgrade = !!pending.free;
    if (!isFreeUpgrade && (getInventoryItemCount(user, EQUIPMENT_STONE_ITEM_ID) < cost.stone || Number(user.gold || 0) < cost.gold)) {
        user.pendingAction = null;
        return '❌ 재료가 부족합니다!';
    }
    if (!isFreeUpgrade) {
        removeInventoryItem(user, EQUIPMENT_STONE_ITEM_ID, cost.stone);
        user.gold = Number(user.gold || 0) - cost.gold;
    }
    const rates = getEquipmentUpgradeRates(type, level);
    const roll = Math.random();
    let result = 'destroy';
    if (roll < rates.great) result = 'great';
    else if (roll < rates.great + rates.success) result = 'success';
    else if (roll < rates.great + rates.success + rates.down) result = 'down';
    const before = level;
    let protectedResult = null;
    if (result == 'great') selected.equip.level = Math.min(maxLevel, level + 2);
    if (result == 'success') selected.equip.level = Math.min(maxLevel, level + 1);
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
    if (result == 'destroy' && !protectedResult) return messages[messageKey] + '\n' + getEquipmentDisplayName(equipment, selected.equip) + ' +' + before + ' -> 파괴';
    return messages[messageKey] + '\n' + getEquipmentDisplayName(equipment, selected.equip) + ' +' + before + ' -> +' + Number(selected.equip.level || 0);
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
    const items = getDataCache('Item', []);
    const equipments = getDataCache('Equipment', {});
    const count = rollCount(reward.count);
    if (reward.type == '아이템') {
        addInventoryItem(user, reward.item_id, count);
        const item = items[reward.item_id];
        addRewardSummary(summary, 'item:' + reward.item_id, (item ? item.name : '알 수 없는 아이템'), count);
        return;
    }
    if (reward.type == '캐릭터카드') {
        if (!user.inventory) user.inventory = { card: [], item: [], equipment: [] };
        if (!Array.isArray(user.inventory.card)) user.inventory.card = [];
        for (let i = 0; i < count; i++) {
            const card = buildCharacterCardReward(reward);
            if (!card) continue;
            user.inventory.card.push(card);
            addRewardSummary(summary, 'card:' + card.id + ':' + card.star + ':' + (card.type || '일반') + ':' + (card.skin || ''), formatUserCard(card), 1);
        }
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
        return;
    }
    if (reward.type == '보조') {
        addEquipmentInventory(user, 'support', reward.support_id);
        const equipment = equipments.support && equipments.support[reward.support_id];
        addRewardSummary(summary, 'support:' + reward.support_id, equipment ? '<' + equipment.rarity + '> ' + equipment.name : '알 수 없는 보조 장비', 1);
        return;
    }
    if (reward.type == '펫') {
        if (typeof reward.pet_id != 'undefined') {
            const pet = getPetData(reward.pet_id);
            addPetInventory(user, reward.pet_id);
            addRewardSummary(summary, 'pet:' + reward.pet_id, pet ? '<' + pet.rarity + '> ' + pet.name + ' (펫)' : '알 수 없는 펫', 1);
        } else {
            grantRandomPetByRarity(user, reward.rarity, 1, summary);
        }
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
        applyPackSkinToCard(card, pack.skin);
        user.inventory.card.push(card);
        addRewardSummary(summary, 'card:' + card.id + ':' + star + ':' + (card.skin || ''), formatUserCard(card), 1);
    }
}

function grantEquipmentBox(user, pack, useCount, summary) {
    const equipments = getDataCache('Equipment', {});
    const rarity = String(pack && pack.rarity || '').trim();
    const candidates = [];
    [
        { type: 'weapon', key: 'weapon' },
        { type: 'armor', key: 'armor' },
        { type: 'accessory', key: 'accessory' }
    ].forEach(group => {
        (equipments[group.key] || []).forEach((equipment, id) => {
            if (rarity == '유니크' && equipment && equipment.isRaid === true) return;
            if (equipment && equipment.rarity == rarity) candidates.push({ type: group.type, id, equipment });
        });
    });
    if (candidates.length == 0) return false;
    for (let i = 0; i < useCount; i++) {
        const selected = candidates[randomInt(0, candidates.length - 1)];
        addEquipmentInventory(user, selected.type, selected.id);
        addRewardSummary(summary, selected.type + ':' + selected.id, '<' + selected.equipment.rarity + '> ' + selected.equipment.name, 1);
    }
    return true;
}

function grantSupportEquipmentBox(user, pack, useCount, summary) {
    const equipments = getDataCache('Equipment', {});
    const rarity = String(pack && pack.rarity || '').trim();
    const candidates = [];
    (equipments.support || []).forEach((equipment, id) => {
        if (equipment && equipment.rarity == rarity) candidates.push({ type: 'support', id, equipment });
    });
    if (candidates.length == 0) return false;
    for (let i = 0; i < useCount; i++) {
        const selected = candidates[randomInt(0, candidates.length - 1)];
        addEquipmentInventory(user, selected.type, selected.id);
        addRewardSummary(summary, selected.type + ':' + selected.id, '<' + selected.equipment.rarity + '> ' + selected.equipment.name, 1);
    }
    return true;
}

async function useCoupon(user, codeArg) {
    const code = String(codeArg || '').trim();
    if (!code) return '❌ /RPGenius 쿠폰 [코드]';
    const coupons = getDataCache('Coupon', []);
    const coupon = coupons.find(data => String(data.code || '').toUpperCase() == code.toUpperCase());
    if (!coupon) return '❌ 존재하지 않는 쿠폰입니다.';
    if (coupon.expired_At != null && Date.now() > Number(new Date(coupon.expired_At).getTime() || 0)) return '❌ 만료된 쿠폰입니다.';
    if (!Array.isArray(user.usedCoupons)) user.usedCoupons = [];
    if (user.usedCoupons.includes(coupon.code)) return '❌ 이미 사용한 쿠폰입니다.';
    const maxUse = Number(coupon.maxUse || 0);
    if (maxUse > 0 && Number(coupon.usedCount || 0) >= maxUse) return '❌ 사용 가능 횟수를 모두 소진한 쿠폰입니다.';
    const summary = {};
    (coupon.reward || []).forEach(reward => grantPackReward(user, reward, summary));
    user.usedCoupons.push(coupon.code);
    coupon.usedCount = Number(coupon.usedCount || 0) + 1;
    try {
        await saveRpgeniusDataEntry('Coupon', coupons);
    } catch (e) {
        console.error('쿠폰 사용 횟수 저장 실패:', e);
    }
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
        const amount = applyRecoveryEfficiency(Number(func.amount || 0) * potionMul, user, stats) * useCount;
        user.hp = Math.min(maxHp, before + amount);
        resultLines.push('- HP +' + comma(user.hp - before) + ' (' + comma(user.hp) + '/' + comma(maxHp) + ')');
        return;
    }
    if (func.type == '마나회복') {
        const maxMp = Number(stats.mp || 0);
        const before = typeof user.mp == 'undefined' ? maxMp : Number(user.mp || 0);
        const amount = applyRecoveryEfficiency(Number(func.amount || 0) * potionMul, user, stats) * useCount;
        user.mp = Math.min(maxMp, before + amount);
        resultLines.push('- MP +' + comma(user.mp - before) + ' (' + comma(user.mp) + '/' + comma(maxMp) + ')');
        return;
    }
    if (func.type == '체력회복%') {
        const maxHp = Number(stats.hp || 0);
        const before = typeof user.hp == 'undefined' ? maxHp : Number(user.hp || 0);
        const amount = applyRecoveryEfficiency(maxHp * Number(func.amount || 0) * potionMul, user, stats) * useCount;
        user.hp = Math.min(maxHp, before + amount);
        resultLines.push('- HP +' + comma(user.hp - before) + ' (' + comma(user.hp) + '/' + comma(maxHp) + ')');
        return;
    }
    if (func.type == '마나회복%') {
        const maxMp = Number(stats.mp || 0);
        const before = typeof user.mp == 'undefined' ? maxMp : Number(user.mp || 0);
        const amount = applyRecoveryEfficiency(maxMp * Number(func.amount || 0) * potionMul, user, stats) * useCount;
        user.mp = Math.min(maxMp, before + amount);
        resultLines.push('- MP +' + comma(user.mp - before) + ' (' + comma(user.mp) + '/' + comma(maxMp) + ')');
        return;
    }
    if (func.type == '경험치획득') {
        const amount = applyLowLevelExpBonus(user, applyPrestigeExpBonus(user, Number(func.amount || 0) * useCount));
        const levelUps = addExperience(user, amount);
        resultLines.push('- XP +' + comma(amount));
        if (levelUps > 0) resultLines.push('- 레벨업! Lv. ' + user.level);
    }
}

async function useItem(user, itemName, countArg) {
    const items = getDataCache('Item', []);
    const itemId = items.findIndex(item => item.name == itemName);
    const item = items[itemId];
    if (!item) return '❌ 존재하지 않는 아이템입니다.';
    if (!['소모품', '가챠', '번들', '사용', '미끼'].includes(item.type)) return '❌ 사용할 수 없는 아이템입니다.';
    if (item.type == '미끼') {
        if (!getBaitDefinition(item.name)) return '❌ 등록되지 않은 미끼입니다.';
        if (user.bait == item.name) return '❌ 이미 사용 중인 미끼입니다.';
        user.bait = item.name;
        await user.save();
        return '✅ 낚시 미끼를 ' + item.name + '(으)로 변경했습니다.';
    }

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
            return '❌ 필요한 아이템이 부족합니다.\n- ' + (requireItem ? requireItem.name : '알 수 없는 아이템') + ' x' + comma(requiredCount);
        }
    }
    if (item.type == '번들') {
        const bundles = getDataCache('Bundle', []);
        if (!Array.isArray(bundles[item.pack])) return '❌ 사용할 수 없는 번들입니다.';
    }
    if (item.type == '사용') {
        if (item.use == '캐릭터변환' && useCount != 1) return '❌ 한 번에 1개만 사용할 수 있습니다.';
        if ((item.use == '패션적용' || item.use == '고급패션적용') && useCount != 1) return '❌ 한 번에 1개만 사용할 수 있습니다.';
        if (itemId == EQUIPMENT_UPGRADER_ITEM_ID && useCount != 1) return '❌ 한 번에 1개만 사용할 수 있습니다.';
        if (item.name == '프레스티지 증표' && useCount != 1) return '❌ 한 번에 1개만 사용할 수 있습니다.';
        if (item.use == '스탯초기화' && useCount != 1) return '❌ 한 번에 1개만 사용할 수 있습니다.';
        if (item.use == '장신구선택권' && useCount != 1) return '❌ 한 번에 1개만 사용할 수 있습니다.';
        if (item.use == '보조장비리롤' && useCount != 1) return '❌ 한 번에 1개만 사용할 수 있습니다.';
        if (item.use == '잠재능력부여' && useCount != 1) return '❌ 한 번에 1개만 사용할 수 있습니다.';
        if (item.use == '장비강화권' && useCount != 1) return '❌ 한 번에 1개만 사용할 수 있습니다.';
        if (item.use == '영혼석' && useCount != 1) return '❌ 한 번에 1개만 사용할 수 있습니다.';
        if (item.use == '가위' && useCount != 1) return '❌ 한 번에 1개만 사용할 수 있습니다.';
        if (item.use == '생명수' && useCount != 1) return '❌ 한 번에 1개만 사용할 수 있습니다.';
        if (item.use == '장신구선택권' && !item.rarity) return '❌ 장신구 선택권 등급 정보가 없습니다.';
        if (item.use == '장비강화권' && (!item.ug || !Number(item.ug.level) || !Number(item.ug.roll))) return '❌ 장비 강화권 정보가 없습니다.';
        if (item.use == '영혼석' && (!item.soul || typeof item.soul != 'object')) return '❌ 영혼석 정보가 없습니다.';
        if (item.use != '캐릭터변환' && item.use != '패션적용' && item.use != '고급패션적용' && item.use != '스탯초기화' && item.use != '장신구선택권' && item.use != '보조장비리롤' && item.use != '잠재능력부여' && item.use != '장비강화권' && item.use != '영혼석' && item.use != '가위' && item.use != '생명수' && itemId != EQUIPMENT_UPGRADER_ITEM_ID && item.name != '프레스티지 증표') return '❌ 사용할 수 없는 아이템입니다.';
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
            const packs = getDataCache('Pack', []);
            const pack = packs[item.pack];
            if (!Array.isArray(pack)) return '❌ 사용할 수 없는 가챠입니다.';
            const rollCount = Number(item.num || 1) * useCount;
            for (let i = 0; i < rollCount; i++) grantPackReward(user, pickPackEntry(pack), summary);
        } else if (item.pack && item.pack.type == '캐릭터 카드팩') {
            if (!user.inventory) user.inventory = { card: [], item: [] };
            if (!Array.isArray(user.inventory.card)) user.inventory.card = [];
            grantCharacterCardPack(user, item.pack, useCount, summary);
        } else if (item.pack && item.pack.type == '장비 상자') {
            if (!grantEquipmentBox(user, item.pack, useCount, summary)) return '❌ 사용할 수 없는 장비 상자입니다.';
        } else if (item.pack && item.pack.type == '보조 장비 상자') {
            if (!grantSupportEquipmentBox(user, item.pack, useCount, summary)) return '❌ 사용할 수 없는 보조 장비 상자입니다.';
        } else if (item.pack && item.pack.type == '펫') {
            if (!grantRandomPetByRarity(user, item.pack.rarity, useCount, summary)) return '❌ 해당 등급의 펫이 없습니다.';
        } else {
            return '❌ 사용할 수 없는 가챠입니다.';
        }
        lines.push('[ 획득 결과 ]');
        Object.keys(summary).forEach(key => lines.push('- ' + summary[key].label + ' x' + comma(summary[key].count)));
    }
    if (item.type == '번들') {
        const bundles = getDataCache('Bundle', []);
        const bundle = bundles[item.pack];
        const summary = {};
        for (let i = 0; i < useCount; i++) bundle.forEach(reward => grantPackReward(user, reward, summary));
        lines.push('[ 획득 결과 ]');
        Object.keys(summary).forEach(key => lines.push('- ' + summary[key].label + ' x' + comma(summary[key].count)));
    }
    if (item.type == '사용') {
        if (item.use == '캐릭터변환') {
            user.pendingAction = { type: '캐릭터변환', consumedItemId: itemId, consumedItemCount: useCount };
            if (item.can) user.pendingAction.can = item.can;
            lines.push('변환할 캐릭터 카드를 선택해주세요.');
            lines.push('/RPGenius 선택 [카드번호]');
            lines.push('/RPGenius 사용취소');
            lines.push('', formatCharacterInventory(user));
        }
        if (item.use == '패션적용' || item.use == '고급패션적용') {
            const highOnly = item.use == '고급패션적용';
            const targets = getFashionApplyTargets(user, highOnly);
            if (targets.length == 0) {
                addInventoryItem(user, itemId, useCount);
                lines.push('❌ 적용 가능한 캐릭터 카드가 없어 아이템을 반환했습니다.');
            } else {
                user.pendingAction = { type: '패션적용', highOnly, consumedItemId: itemId, consumedItemCount: useCount };
                lines.push('패션을 적용할 캐릭터 카드를 선택해주세요.');
                lines.push('/RPGenius 선택 [카드번호]');
                lines.push('/RPGenius 사용취소');
                lines.push('', formatFashionApplyTargetList(user, highOnly));
            }
        }
        if (itemId == EQUIPMENT_UPGRADER_ITEM_ID) {
            user.pendingAction = { type: '무료장비강화', consumedItemId: itemId, consumedItemCount: useCount };
            lines.push('무료로 강화할 장비를 선택해주세요.');
            lines.push('/RPGenius 장비강화 [장비번호]');
            lines.push('', formatEquipmentInventory(user));
        }
        if (item.use == '스탯초기화') {
            normalizeStatPointData(user);
            let refunded = 0;
            Object.keys(user.statPointStats).forEach(key => {
                refunded += Number(user.statPointStats[key] || 0);
                user.statPointStats[key] = 0;
            });
            user.statPoint = Number(user.statPoint || 0) + refunded;
            const recalcStats = calculateUserStats(user);
            user.hp = Math.min(typeof user.hp == 'undefined' ? Number(recalcStats.hp || 0) : Number(user.hp || 0), Number(recalcStats.hp || 0));
            user.mp = Math.min(typeof user.mp == 'undefined' ? Number(recalcStats.mp || 0) : Number(user.mp || 0), Number(recalcStats.mp || 0));
            lines.push('- 스탯포인트를 초기화했습니다.');
            lines.push('- 잔여 스탯포인트: ' + comma(user.statPoint));
        }
        if (item.use == '장신구선택권') {
            const candidates = getAccessoryChoiceCandidates(item.rarity);
            if (candidates.length == 0) {
                addInventoryItem(user, itemId, useCount);
                lines.push('❌ 선택 가능한 장신구가 없어 아이템을 반환했습니다.');
            } else {
                user.pendingAction = { type: '장신구선택권', rarity: item.rarity, consumedItemId: itemId, consumedItemCount: useCount };
                lines.push('획득할 장신구를 선택해주세요.');
                lines.push('/RPGenius 선택 [번호]');
                lines.push('/RPGenius 사용취소');
                lines.push('', formatAccessoryChoiceList(candidates));
            }
        }
        if (item.use == '보조장비리롤') {
            const targets = getSupportRerollTargets(user);
            if (targets.length == 0) {
                addInventoryItem(user, itemId, useCount);
                lines.push('❌ 보조 장비가 없어 아이템을 반환했습니다.');
            } else {
                user.pendingAction = { type: '보조장비리롤', consumedItemId: itemId, consumedItemCount: useCount };
                lines.push('스탯을 재설정할 보조 장비를 선택해주세요.');
                lines.push('/RPGenius 선택 [장비번호]');
                lines.push('/RPGenius 사용취소');
                lines.push('', formatSupportRerollList(targets));
            }
        }
        if (item.use == '잠재능력부여') {
            const targets = getPotentialAwakenTargets(user);
            if (targets.length == 0) {
                addInventoryItem(user, itemId, useCount);
                lines.push('❌ 잠재능력을 부여할 수 있는 장비가 없어 아이템을 반환했습니다.');
            } else {
                user.pendingAction = { type: '잠재능력부여', consumedItemId: itemId, consumedItemCount: useCount };
                lines.push('잠재능력을 부여할 장비를 선택해주세요.');
                lines.push('/RPGenius 선택 [장비번호]');
                lines.push('/RPGenius 사용취소');
                lines.push('', formatPotentialAwakenTargetList(targets));
            }
        }
        if (item.use == '장비강화권') {
            const ugLevel = Number(item.ug && item.ug.level || 0);
            const ugRoll = Number(item.ug && item.ug.roll || 0);
            const targets = getUpgradeTicketTargets(user, ugLevel);
            if (targets.length == 0) {
                addInventoryItem(user, itemId, useCount);
                lines.push('❌ +' + ugLevel + ' 강화 가능한 장비가 없어 아이템을 반환했습니다.');
            } else {
                user.pendingAction = { type: '장비강화권', ugLevel, ugRoll, consumedItemId: itemId, consumedItemCount: useCount };
                lines.push('+' + ugLevel + '으로 강화할 장비를 선택해주세요. (성공 확률 ' + (Math.round(ugRoll * 10000) / 100) + '%)');
                lines.push('/RPGenius 선택 [장비번호]');
                lines.push('/RPGenius 사용취소');
                lines.push('', formatUpgradeTicketTargetList(targets, ugLevel));
            }
        }
        if (item.use == '영혼석') {
            const targets = getSoulTargets(user);
            if (targets.length == 0) {
                addInventoryItem(user, itemId, useCount);
                lines.push('❌ 영혼을 깃들일 수 있는 무기/갑옷이 없어 아이템을 반환했습니다.');
            } else {
                user.pendingAction = { type: '영혼부여', soul: item.soul, consumedItemId: itemId, consumedItemCount: useCount };
                lines.push((item.soul && item.soul.name ? item.soul.name : '') + '의 영혼을 깃들일 장비를 선택해주세요.');
                lines.push('/RPGenius 선택 [장비번호]');
                lines.push('/RPGenius 사용취소');
                lines.push('', formatSoulTargetList(targets));
            }
        }
        if (item.use == '가위') {
            const targets = getBoundEquipmentScissorTargets(user);
            if (targets.length == 0) {
                addInventoryItem(user, itemId, useCount);
                lines.push('❌ 귀속 해제할 장비가 없어 아이템을 반환했습니다.');
            } else {
                user.pendingAction = { type: '귀속해제', consumedItemId: itemId, consumedItemCount: useCount };
                lines.push('귀속을 해제할 장비를 선택해주세요.');
                lines.push('/RPGenius 선택 [장비번호]');
                lines.push('/RPGenius 사용취소');
                lines.push('', formatBoundEquipmentScissorList(targets));
            }
        }
        if (item.use == '생명수') {
            if (getAllUserPets(user).length == 0) {
                addInventoryItem(user, itemId, useCount);
                lines.push('❌ 기한을 연장할 펫이 없어 아이템을 반환했습니다.');
            } else {
                user.pendingAction = { type: '생명수', consumedItemId: itemId, consumedItemCount: useCount };
                lines.push('기한을 30일 연장할 펫을 선택해주세요.');
                lines.push('/RPGenius 선택 [번호]');
                lines.push('/RPGenius 사용취소');
                lines.push('', formatPetInventory(user));
            }
        }
        if (item.name == '프레스티지 증표') {
            if (user.prestige === true) {
                user.mileage = Number(user.mileage || 0) + 20000;
                lines.push('- 이미 프레스티지가 적용되어 Ⓜ️ 20,000 마일리지를 획득했습니다.');
            } else {
                user.prestige = true;
                lines.push('✨ 프레스티지가 적용되었습니다.');
            }
        }
    }

    await user.save();
    return lines.join('\n');
}

async function purchaseShopItem(user, shopType, indexArg, countArg) {
    const shops = getDataCache('Shop', {});
    const shop = shops[shopType];
    if (!shop || !Array.isArray(shop)) return '❌ 존재하지 않는 상점입니다.';

    const index = Number(indexArg);
    if (!Number.isInteger(index) || index < 1 || index > shop.length) return '❌ 존재하지 않는 상품 번호입니다.';

    const count = countArg == null || countArg === '' ? 1 : Number(countArg);
    if (!Number.isInteger(count) || count < 1) return '❌ 갯수는 1 이상의 정수여야 합니다.';

    const shopItem = shop[index - 1];
    const itemIndex = index - 1;
    const { limits, remaining } = getShopRemainingLimits(user, shopType, itemIndex, shopItem, new Date());
    if (typeof limits.max == 'number' && remaining.max < count) return '❌ 누적 구매 제한을 초과합니다. (잔여 ' + comma(remaining.max) + '/' + comma(limits.max) + ')';
    if (typeof limits.daily == 'number' && remaining.daily < count) return '❌ 오늘의 구매 제한을 초과합니다. (잔여 ' + comma(remaining.daily) + '/' + comma(limits.daily) + ')';
    if (typeof limits.weekly == 'number' && remaining.weekly < count) return '❌ 이번 주 구매 제한을 초과합니다. (잔여 ' + comma(remaining.weekly) + '/' + comma(limits.weekly) + ')';
    if (typeof limits.monthly == 'number' && remaining.monthly < count) return '❌ 이번 달 구매 제한을 초과합니다. (잔여 ' + comma(remaining.monthly) + '/' + comma(limits.monthly) + ')';
    if (typeof limits.global == 'number' && remaining.global < count) return '❌ 전체 구매 제한을 초과합니다. (잔여 ' + comma(remaining.global) + '/' + comma(limits.global) + ')';
    if (shopItem.type == '캐릭터카드') {
        const grantCount = Number(shopItem.count || 1) * count;
        if (!buildCharacterCardReward(shopItem)) return '❌ 처리할 수 없는 상품입니다.';
        if (getRemainingCardInventorySpace(user) < grantCount) return '❌ 캐릭터 카드 인벤토리 공간이 부족합니다. (필요 ' + comma(grantCount) + '칸)';
    }
    const totalPrice = Number(shopItem.price.amount) * count;
    const field = GOODS_FIELD[shopItem.price.goods];
    if (shopItem.price.goods == 'item') {
        if (typeof shopItem.price.item_id == 'undefined') return '❌ 가격 아이템 정보가 잘못되었습니다.';
        if (getInventoryItemCount(user, shopItem.price.item_id) < totalPrice) return '❌ 재화가 부족합니다. (필요: ' + formatPrice({ goods: shopItem.price.goods, item_id: shopItem.price.item_id, amount: totalPrice }) + ')';
        removeInventoryItem(user, shopItem.price.item_id, totalPrice);
    } else {
        if (!field) return '❌ 알 수 없는 화폐입니다.';
        const owned = Number(user[field] || 0);
        if (owned < totalPrice) return '❌ 재화가 부족합니다. (필요: ' + formatPrice({ goods: shopItem.price.goods, amount: totalPrice }) + ')';
        user[field] = owned - totalPrice;
    }
    const mileageEarned = shopItem.price.goods == 'point' ? Math.round(totalPrice * 0.1) : 0;
    if (mileageEarned > 0) user.mileage = Number(user.mileage || 0) + mileageEarned;

    if (shopItem.type == '아이템') {
        addInventoryItem(user, shopItem.item_id, Number(shopItem.count) * count);
    } else if (shopItem.type == '캐릭터카드') {
        if (!user.inventory) user.inventory = { card: [], item: [], equipment: [] };
        if (!Array.isArray(user.inventory.card)) user.inventory.card = [];
        const grantCount = Number(shopItem.count || 1) * count;
        for (let i = 0; i < grantCount; i++) {
            const card = buildCharacterCardReward(shopItem);
            if (!card) return '❌ 처리할 수 없는 상품입니다.';
            user.inventory.card.push(card);
        }
    } else if (shopItem.type == '가넷') {
        user.garnet = Number(user.garnet || 0) + Number(shopItem.count) * count;
    } else if (shopItem.type == '골드') {
        user.gold = Number(user.gold || 0) + Number(shopItem.count) * count;
    } else if (shopItem.type == '마일리지') {
        user.mileage = Number(user.mileage || 0) + Number(shopItem.count) * count;
    } else {
        return '❌ 처리할 수 없는 상품입니다.';
    }

    const rec = getUserShopRecord(user, shopType, itemIndex, new Date());
    if (typeof limits.max == 'number') rec.max = Number(rec.max || 0) + count;
    if (typeof limits.daily == 'number') rec.daily = Number(rec.daily || 0) + count;
    if (typeof limits.weekly == 'number') rec.weekly = Number(rec.weekly || 0) + count;
    if (typeof limits.monthly == 'number') rec.monthly = Number(rec.monthly || 0) + count;

    await user.save();
    if (typeof limits.global == 'number') {
        try { await addShopGlobalCount(shopType, itemIndex, count); } catch (e) { console.error('[shop] global counter 저장 실패: ' + e.message); }
    }

    const rewardItem = Object.assign({}, shopItem, { count: Number(shopItem.count || 1) * count });
    return '✅ 구매 완료: ' + formatShopItem(rewardItem) + '\n- 사용: ' + formatPrice({ goods: shopItem.price.goods, item_id: shopItem.price.item_id, amount: totalPrice }) + (mileageEarned > 0 ? '\n- 적립: Ⓜ️ ' + comma(mileageEarned) + '마일리지' : '');
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

async function putNewItem(table, item) {
    try {
        const command = new PutCommand({
            TableName: table,
            Item: item,
            ConditionExpression: 'attribute_not_exists(id)'
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
        this.prestige = false;
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
            accessory: {},
            support: null,
            pet: []
        };
        this.inventory = {
            card: [],
            item: [],
            equipment: [],
            pet: []
        };
        this.gold = 0;
        this.garnet = 0;
        this.point = 0;
        this.total_point = 0;
        this.mileage = 0;
        this.statPoint = 0;
        this.statPointStats = { atk: 0, hp: 0, mp: 0, def: 0, pnt: 0 };
        this.statPointBuyCount = 0;
        this.fishing = false;
        this.fishingNet = {};
        this.fishingNetLimit = 200;
        this.pendingAction = null;
        this.pendingFragment = null;
        this.fragmentCounts = {};
        this.goldMineDaily = null;
        this.cardCombineCounts = {};
        this.cardPackCombineCounts = {};
        this.maxCardLimit = 52;
        this.maxAccessory = 3;
        this.mail = [];
        this.usedCoupons = [];
        this.shopPurchases = {};
        this.lastAttendanceDate = null;
    }

    load(data) {
        Object.assign(this, data);
        if (!Array.isArray(this.logged_in)) this.logged_in = [];
        if (!this.inventory) this.inventory = { card: [], item: [] };
        if (!Array.isArray(this.inventory.card)) this.inventory.card = [];
        if (!Array.isArray(this.inventory.item)) this.inventory.item = [];
        if (!Array.isArray(this.inventory.equipment)) this.inventory.equipment = [];
        if (!Array.isArray(this.inventory.pet)) this.inventory.pet = [];
        if (!this.equipments || typeof this.equipments != 'object') this.equipments = { weapon: null, armor: null, accessory: {}, support: null, pet: [] };
        if (typeof this.equipments.weapon == 'undefined') this.equipments.weapon = null;
        if (typeof this.equipments.armor == 'undefined') this.equipments.armor = null;
        if (!this.equipments.accessory || typeof this.equipments.accessory != 'object') this.equipments.accessory = {};
        if (typeof this.equipments.support == 'undefined') this.equipments.support = null;
        if (!Array.isArray(this.equipments.pet)) this.equipments.pet = [];
        cleanupInventoryItems(this);
        if (!Array.isArray(this.mail)) this.mail = [];
        if (!Array.isArray(this.usedCoupons)) this.usedCoupons = [];
        if (!this.shopPurchases || typeof this.shopPurchases != 'object') this.shopPurchases = {};
        if (typeof this.lastAttendanceDate == 'undefined') this.lastAttendanceDate = null;
        if (typeof this.isAdmin == 'undefined') this.isAdmin = false;
        if (!this.level) this.level = 1;
        if (!this.exp) this.exp = 0;
        if (typeof this.field == 'undefined') this.field = null;
        if (typeof this.mileage == 'undefined') this.mileage = 0;
        normalizeStatPointData(this);
        normalizeFishingData(this);
        if (typeof this.pendingAction == 'undefined') this.pendingAction = null;
        if (typeof this.pendingFragment == 'undefined') this.pendingFragment = null;
        if (!this.fragmentCounts || typeof this.fragmentCounts != 'object') this.fragmentCounts = {};
        cleanupExpiredSouls(this);
        if (typeof this.goldMineDaily == 'undefined') this.goldMineDaily = null;
        normalizeCardCombineCounts(this);
        if (typeof this.need_character_card_select == 'undefined') this.need_character_card_select = !this.main_card || typeof this.main_card.id == 'undefined';
        if (typeof this.prestige == 'undefined') this.prestige = false;
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
    const items = getDataCache('Item', []);
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
    const items = getDataCache('Item', []);
    const lines = [];
    if (Number(offer.gold || 0) > 0) lines.push('- 🪙 ' + comma(offer.gold));
    if (Number(offer.garnet || 0) > 0) lines.push('- 💠 ' + comma(offer.garnet));
    (offer.equipments || []).forEach(entry => {
        const data = getEquipmentData(entry.type, entry.id);
        if (!data) return;
        const level = Number(entry.level || 0);
        lines.push('- <' + data.rarity + '> ' + getEquipmentDisplayName(data, entry) + (level > 0 ? ' +' + level : ''));
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
    (offer.equipments || []).forEach(equip => user.inventory.equipment.push(JSON.parse(JSON.stringify(equip))));
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
        const tradeBlockReason = getEquipmentTradeBlockReason(selected.equip, user.name);
        if (tradeBlockReason) return '❌ ' + tradeBlockReason;
        const idx = user.inventory.equipment.indexOf(selected.equip);
        if (idx < 0) return '❌ 장비를 찾을 수 없습니다.';
        const equipCopy = cloneEquipmentInstance(selected.equip, selected.type);
        user.inventory.equipment.splice(idx, 1);
        side.offer.equipments.push(equipCopy);
        resetTradeConfirmations(session);
        return '✅ <' + data.rarity + '> ' + getEquipmentDisplayName(data, selected.equip) + (equipCopy.level > 0 ? ' +' + equipCopy.level : '') + ' 장비를 등록했습니다.\n\n' + formatTradeStatus(session);
    }
    if (parsed.kind == '아이템') {
        const items = getDataCache('Item', []);
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
    const items = getDataCache('Item', []);
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
        equipments: (session.bOffer.equipments || []).map(equip => markEquipmentTraded(equip)),
        items: session.bOffer.items
    };
    const bReceive = {
        gold: session.aOffer.gold ? session.aOffer.gold - Math.round(session.aOffer.gold * TRADE_FEE_RATE) : 0,
        garnet: session.aOffer.garnet ? session.aOffer.garnet - Math.round(session.aOffer.garnet * TRADE_FEE_RATE) : 0,
        cards: session.aOffer.cards,
        equipments: (session.aOffer.equipments || []).map(equip => markEquipmentTraded(equip)),
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
            reply('❌ 이미 로그인된 상태입니다.\n- ' + existingById.name);
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
            reply('❌ 이미 로그인된 상태입니다.\n- ' + existingById.name);
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
            const nickname = pendingChecks[senderId].arg.name;
            const existingById = await getRPGUserById(senderId);
            if (existingById) {
                reply('❌ 이미 등록된 계정이 있습니다.\n- ' + existingById.name);
                delete pendingChecks[senderId];
                return true;
            }
            const existsByName = await getRPGUserByName(nickname);
            if (existsByName) {
                reply('❌ 이미 존재하는 이름입니다.');
                delete pendingChecks[senderId];
                return true;
            }
            const user = new RPGUser(nickname, senderId);
            const res = await putNewItem(TABLE_NAME, user);
            if (res.success) {
                reply('✅ 성공적으로 등록되셨습니다!\n환영합니다, ' + user.name + '님!\n캐릭터 카드를 선택해주세요.');
                reply(formatCharacterCardList());
            } else {
                const errorName = res.result && res.result[0] && res.result[0].name;
                if (errorName == 'ConditionalCheckFailedException') reply('❌ 이미 등록된 계정이 있습니다.');
                else reply('❌ 등록 과정에서 오류가 발생했습니다.\n' + VIEWMORE + '\n' + (res.result && res.result[0] && (res.result[0].message || res.result[0].Message) || 'Unknown Error'));
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
            reply('✅ 캐릭터 카드를 선택했습니다.\n- ' + characterCard.card.name + '\n\n🎁 초보자 키트를 받았습니다!\n/RPGenius 사용 초보자 키트');
        }
        return true;
    }

    const user = await getRPGUserById(senderId);
    if (!user) {
        reply('❌ 등록되지 않은 사용자입니다.\n/RPGenius 등록 [닉네임]');
        return true;
    }

    petShortcutCache[senderId] = getActivePetShortcutMap(user);

    if (!user.need_character_card_select && getActivePetSpecials(user).autoAttend) {
        const today = getKoreanDateKey(new Date());
        if (user.lastAttendanceDate != today) {
            const attendResult = checkAttendance(user);
            await user.save();
            reply('🐾 ' + attendResult);
        }
    }

    if (args[0] == '파티퀘스트') {
        if (Number(user.level || 1) >= 71 && !user.canPartyQuest) {
            user.canPartyQuest = true;
            await user.save();
            reply('✅ 파티 퀘스트가 활성화되었습니다.\n웹버전에서 이용할 수 있습니다.\nhttps://rpgenius.kro.kr');
        } else if (Number(user.level || 1) < 71) {
            reply('❌ 해당 기능은 71레벨 이상부터 활성화됩니다.');
        }
        return true;
    }

    if (user.pendingFragment) {
        if (args[0] == '편린') {
            const result = consumeFragment(user);
            await user.save();
            reply(result);
            return true;
        }
        const cfg = FRAGMENT_TIERS[user.pendingFragment];
        const tierName = cfg ? cfg.name : '편린';
        reply('❌ ' + tierName + '을(를) 먼저 사용해야 합니다.\n/RPGenius 편린');
        return true;
    }

    if (args[0] == '편린') {
        reply('❌ 사용 가능한 편린이 없습니다.');
        return true;
    }

    if (user.pendingAction && user.pendingAction.type == '캐릭터변환') {
        if (args[0] == '사용취소') {
            const refund = refundPendingActionItem(user, user.pendingAction);
            user.pendingAction = null;
            await user.save();
            reply('✅ 캐릭터 변환석 사용을 취소했습니다.' + (refund ? '\n[ 반환 ]\n- ' + refund : ''));
            return true;
        }
        if (args[0] == '확인') {
            if (!user.pendingAction.cardNumber) {
                reply('❌ 캐릭터 변환할 카드를 먼저 선택해야 합니다.\n/RPGenius 선택 [카드번호]\n/RPGenius 사용취소');
                return true;
            }
            const result = convertCharacterCard(user, user.pendingAction.cardNumber, true, user.pendingAction.can);
            await user.save();
            reply(result);
            return true;
        }
        if (args[0] != '선택') {
            reply('❌ 캐릭터 변환할 카드를 먼저 선택해야 합니다.\n/RPGenius 선택 [카드번호]\n/RPGenius 사용취소');
            return true;
        }
        const result = convertCharacterCard(user, args[1], false, user.pendingAction.can);
        await user.save();
        reply(result);
        return true;
    }

    if (user.pendingAction && user.pendingAction.type == '패션적용') {
        if (args[0] == '사용취소') {
            const refund = refundPendingActionItem(user, user.pendingAction);
            user.pendingAction = null;
            await user.save();
            reply('✅ 패션 적용을 취소했습니다.' + (refund ? '\n[ 반환 ]\n- ' + refund : ''));
            return true;
        }
        if (args[0] != '선택') {
            reply('❌ 패션을 적용할 캐릭터 카드를 먼저 선택해야 합니다.\n/RPGenius 선택 [카드번호]\n/RPGenius 사용취소');
            return true;
        }
        const result = applyFashionStoneToCard(user, args[1]);
        await user.save();
        reply(result);
        return true;
    }

    if (user.pendingAction && user.pendingAction.type == '무료장비강화') {
        if (args[0] == '사용취소') {
            const refund = refundPendingActionItem(user, user.pendingAction);
            user.pendingAction = null;
            await user.save();
            reply('✅ 유생의 강화기 사용을 취소했습니다.' + (refund ? '\n[ 반환 ]\n- ' + refund : ''));
            return true;
        }
        if (args[0] != '장비강화') {
            reply('❌ 무료로 강화할 장비를 먼저 선택해야 합니다.\n/RPGenius 장비강화 [장비번호]\n/RPGenius 사용취소');
            return true;
        }
        if (!args[1]) {
            reply('❌ /RPGenius 장비강화 [장비번호]\n/RPGenius 사용취소');
            return true;
        }
        const result = formatEquipmentUpgradePreview(user, args[1], {
            free: true,
            consumedItemId: user.pendingAction.consumedItemId,
            consumedItemCount: user.pendingAction.consumedItemCount
        });
        await user.save();
        reply(result);
        return true;
    }

    if (user.pendingAction && user.pendingAction.type == '장신구선택권') {
        if (args[0] == '사용취소') {
            const refund = refundPendingActionItem(user, user.pendingAction);
            user.pendingAction = null;
            await user.save();
            reply('✅ 장신구 선택권 사용을 취소했습니다.' + (refund ? '\n[ 반환 ]\n- ' + refund : ''));
            return true;
        }
        if (args[0] != '선택') {
            reply('❌ 획득할 장신구를 먼저 선택해야 합니다.\n/RPGenius 선택 [번호]\n/RPGenius 사용취소');
            return true;
        }
        const result = selectAccessoryChoice(user, args[1]);
        await user.save();
        reply(result);
        return true;
    }

    if (user.pendingAction && user.pendingAction.type == '보조장비리롤') {
        if (args[0] == '사용취소') {
            const refund = refundPendingActionItem(user, user.pendingAction);
            user.pendingAction = null;
            await user.save();
            reply('✅ 보조 장비 스탯 재설정을 취소했습니다.' + (refund ? '\n[ 반환 ]\n- ' + refund : ''));
            return true;
        }
        if (args[0] != '선택') {
            reply('❌ 스탯을 재설정할 보조 장비를 먼저 선택해야 합니다.\n/RPGenius 선택 [장비번호]\n/RPGenius 사용취소');
            return true;
        }
        const result = rerollSupportEquipment(user, args[1]);
        await user.save();
        reply(result);
        return true;
    }

    if (user.pendingAction && user.pendingAction.type == '잠재능력부여') {
        if (args[0] == '사용취소') {
            const refund = refundPendingActionItem(user, user.pendingAction);
            user.pendingAction = null;
            await user.save();
            reply('✅ 잠재능력 부여를 취소했습니다.' + (refund ? '\n[ 반환 ]\n- ' + refund : ''));
            return true;
        }
        if (args[0] != '선택') {
            reply('❌ 잠재능력을 부여할 장비를 먼저 선택해야 합니다.\n/RPGenius 선택 [장비번호]\n/RPGenius 사용취소');
            return true;
        }
        const result = awakenEquipmentPotential(user, args[1]);
        await user.save();
        reply(result);
        return true;
    }

    if (user.pendingAction && user.pendingAction.type == '장비강화권') {
        if (args[0] == '사용취소') {
            const refund = refundPendingActionItem(user, user.pendingAction);
            user.pendingAction = null;
            await user.save();
            reply('✅ 장비 강화권 사용을 취소했습니다.' + (refund ? '\n[ 반환 ]\n- ' + refund : ''));
            return true;
        }
        if (args[0] != '선택') {
            reply('❌ 강화할 장비를 먼저 선택해야 합니다.\n/RPGenius 선택 [장비번호]\n/RPGenius 사용취소');
            return true;
        }
        const result = applyUpgradeTicket(user, args[1]);
        await user.save();
        reply(result);
        return true;
    }

    if (user.pendingAction && user.pendingAction.type == '영혼부여') {
        if (args[0] == '사용취소') {
            const refund = refundPendingActionItem(user, user.pendingAction);
            user.pendingAction = null;
            await user.save();
            reply('✅ 영혼석 사용을 취소했습니다.' + (refund ? '\n[ 반환 ]\n- ' + refund : ''));
            return true;
        }
        if (args[0] != '선택') {
            reply('❌ 영혼을 깃들일 장비를 먼저 선택해야 합니다.\n/RPGenius 선택 [장비번호]\n/RPGenius 사용취소');
            return true;
        }
        const result = applySoulToEquipment(user, args[1]);
        await user.save();
        reply(result);
        return true;
    }

    if (user.pendingAction && user.pendingAction.type == '귀속해제') {
        if (args[0] == '사용취소') {
            const refund = refundPendingActionItem(user, user.pendingAction);
            user.pendingAction = null;
            await user.save();
            reply('✅ 귀속 해제를 취소했습니다.' + (refund ? '\n[ 반환 ]\n- ' + refund : ''));
            return true;
        }
        if (args[0] != '선택') {
            reply('❌ 귀속을 해제할 장비를 먼저 선택해야 합니다.\n/RPGenius 선택 [장비번호]\n/RPGenius 사용취소');
            return true;
        }
        const result = releaseBoundEquipment(user, args[1]);
        await user.save();
        reply(result);
        return true;
    }

    if (user.pendingAction && user.pendingAction.type == '생명수') {
        if (args[0] == '사용취소') {
            const refund = refundPendingActionItem(user, user.pendingAction);
            user.pendingAction = null;
            await user.save();
            reply('✅ 생명수 사용을 취소했습니다.' + (refund ? '\n[ 반환 ]\n- ' + refund : ''));
            return true;
        }
        if (args[0] != '선택') {
            reply('❌ 기한을 연장할 펫을 먼저 선택해야 합니다.\n/RPGenius 선택 [번호]\n/RPGenius 사용취소');
            return true;
        }
        const result = extendPetExpiry(user, args[1]);
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
        const refund = refundPendingActionItem(user, user.pendingAction);
        user.pendingAction = null;
        await user.save();
        reply('❌ 장비 강화가 취소되었습니다.' + (refund ? '\n[ 반환 ]\n- ' + refund : ''));
    }

    if (user.pendingAction && user.pendingAction.type == '장비합성') {
        if (args[0] == '합성') {
            const result = runEquipmentSynthesis(user);
            await user.save();
            reply(result);
            return true;
        }
        user.pendingAction = null;
        await user.save();
        reply('❌ 장비 합성이 취소되었습니다.');
    }

    if (user.pendingAction && user.pendingAction.type == '카드조합') {
        if (args[0] == '보호카드사용') {
            const result = setCardCombineProtection(user, args[1]);
            await user.save();
            reply(result);
            return true;
        }
        if (args[0] == '조합') {
            const result = runCardCombine(user);
            await user.save();
            reply(result);
            return true;
        }
        user.pendingAction = null;
        await user.save();
        reply('❌ 카드조합이 취소되었습니다.');
    }

    if (user.pendingAction && user.pendingAction.type == '장비분해') {
        if (args[0] == '분해확인') {
            const result = runDisassemble(user);
            await user.save();
            reply(result);
            return true;
        }
        user.pendingAction = null;
        await user.save();
        reply('❌ 장비 분해가 취소되었습니다.');
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

    if (activeTrades[user.name] && !['내정보', '장착정보', '설명', '인벤토리', '인벤', 'i', '캐릭인벤', 'ci', '장비인벤', 'ei', '스탯'].includes(args[0])) {
        reply('❌ 거래 진행 중에는 사용할 수 없는 명령어입니다.\n/RPGenius 거래취소');
        return true;
    }

    if (user.field && user.field.name && !['필드퇴장', '공격', '스킬', '내정보', '장착정보', '설명', '사용'].includes(args[0])) {
        reply('❌ 필드에서 사용할 수 없는 명령어입니다.\n/RPGenius 필드퇴장');
        return true;
    }

    if (args[0] == '투표') {
        const result = await voteCandidate(user, args[1], args[2]);
        await user.save();
        reply(result);
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
        const result = await enterField(user, fieldName, null, channel);
        await user.save();
        reply(result);
        return true;
    }

    if (args[0] == '입장확인') {
        if (!user.pendingAction || user.pendingAction.type != '필드입장확인') {
            reply('❌ 진행 중인 필드 입장이 없습니다.');
            return true;
        }
        const fieldName = user.pendingAction.name;
        user.pendingAction = null;
        const result = await enterField(user, fieldName, { confirmed: true }, channel);
        await user.save();
        reply(result);
        return true;
    }

    if (args[0] == '입장취소') {
        if (!user.pendingAction || user.pendingAction.type != '필드입장확인') {
            reply('❌ 진행 중인 필드 입장이 없습니다.');
            return true;
        }
        user.pendingAction = null;
        await user.save();
        reply('✅ 필드 입장을 취소했습니다.');
        return true;
    }

    if (args[0] == '월드보스선택') {
        const result = confirmWorldBossSkill(user, args[1], channel);
        await user.save();
        reply(result);
        return true;
    }

    if (args[0] == '월드보스보상') {
        const result = await claimWorldBossRewards(user);
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
        const result = await useBasicAttackInField(user, channel);
        await user.save();
        reply(result);
        return true;
    }

    if (args[0] == '스킬') {
        const skillName = cmd.substr(cmd.split(' ')[0].length + 1 + args[0].length + 1).trim();
        if (!skillName && !(user.field && user.field.worldBoss)) {
            reply('❌ /RPGenius 스킬 [스킬명]');
            return true;
        }
        const result = await useSkillInField(user, skillName, channel);
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
            reply('❌ /RPGenius 스탯포인트 [공격력|체력|MP|방어력|방어 관통력] <숫자>\n❌ /RPGenius 스탯포인트 구매 <숫자>');
            return true;
        }
        if (args[1] == '구매') {
            const countArg = typeof args[2] == 'undefined' ? 1 : args[2];
            const result = buyStatPoint(user, countArg);
            await user.save();
            reply(result);
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

    if (args[0] == '카드팩조합') {
        const result = combineCardPacks(user, args[1], args[2]);
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

    if (args[0] == '아이템판매') {
        const result = sellItemByName(user, args.slice(1));
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

    if (args[0] == '장착정보') {
        reply(formatEquipmentInfo(user));
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

    if (args[0] == '펫') {
        if (args[1] == '장착') {
            if (!args[2]) { reply('❌ /RPGenius 펫 장착 [번호]'); return true; }
            const result = equipPetByNumber(user, args[2]);
            await user.save();
            petShortcutCache[senderId] = getActivePetShortcutMap(user);
            reply(result);
            return true;
        }
        if (args[1] == '장착해제') {
            if (!args[2]) { reply('❌ /RPGenius 펫 장착해제 [번호]'); return true; }
            const result = unequipPetByNumber(user, args[2]);
            await user.save();
            petShortcutCache[senderId] = getActivePetShortcutMap(user);
            reply(result);
            return true;
        }
        reply(formatPetInventory(user));
        return true;
    }

    if (args[0] == '추출') {
        const result = extractPetsByNumbers(user, args.slice(1));
        if (!result.startsWith('❌')) await user.save();
        reply(result);
        return true;
    }

    if (args[0] == '단축키목록') {
        reply(formatPetShortcuts(user));
        return true;
    }

    if (args[0] == '단축키설정') {
        const key = args[1];
        const phrase = key ? cmd.substr(cmd.split(' ')[0].length + 1 + args[0].length + 1 + key.length + 1).trim() : '';
        const result = setPetShortcut(user, key, phrase);
        await user.save();
        petShortcutCache[senderId] = getActivePetShortcutMap(user);
        reply(result);
        return true;
    }

    if (args[0] == '상점') {
        const shopType = args[1] || '일반';
        const shopDisplay = formatShop(shopType, user);
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
        const craftText = cmd.substr(cmd.split(' ')[0].length + 1 + args[0].length + 1).trim();
        if (!craftText) {
            reply('❌ /RPGenius 제작 [이름] <갯수>');
            return true;
        }
        const craftArgs = craftText.split(' ');
        const lastArg = craftArgs[craftArgs.length - 1];
        const hasCount = /^\d+$/.test(lastArg) && craftArgs.length > 1;
        const craftName = hasCount ? craftArgs.slice(0, -1).join(' ') : craftText;
        const craftCount = hasCount ? Math.max(1, parseInt(lastArg, 10)) : 1;
        const result = formatCraftPreview(user, craftName, craftCount);
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
        if (user.field && user.field.worldBoss) {
            reply('❌ 월드보스 전투 중에는 아이템을 사용할 수 없습니다.');
            return true;
        }
        if (user.field && user.field.name) {
            const items = getDataCache('Item', []);
            const targetItem = items.find(item => item.name == itemName);
            if (targetItem && targetItem.type != '소모품' && targetItem.type != '미끼') {
                reply('❌ 필드에서는 소모품/미끼만 사용할 수 있습니다.');
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
        const result = await useCoupon(user, args[1]);
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

    if (args[0] == '잠재능력' && args[1] == '재설정') {
        if (user.pendingAction && user.pendingAction.type == '잠재능력재설정확인') {
            const result = cancelPotentialReroll(user, false);
            await user.save();
            reply(result);
            return true;
        }
        if (!args[2]) {
            reply('❌ /RPGenius 잠재능력 재설정 [장비번호]');
            return true;
        }
        const result = rerollEquipmentPotential(user, args[2]);
        await user.save();
        reply(result);
        return true;
    }

    if (args[0] == '재설정확인') {
        const result = confirmPotentialReroll(user);
        await user.save();
        reply(result);
        return true;
    }

    if (args[0] == '재설정포기') {
        const result = cancelPotentialReroll(user, false);
        await user.save();
        reply(result);
        return true;
    }

    if (args[0] == '재설정포기확정') {
        const result = cancelPotentialReroll(user, true);
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

    if (args[0] == '보조해제') {
        const result = unequipSupport(user);
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

    if (args[0] == '장비합성') {
        const result = formatEquipmentSynthesisPreview(user, args.slice(1));
        await user.save();
        reply(result);
        return true;
    }

    if (args[0] == '분해') {
        const result = formatDisassemblePreview(user, args.slice(1));
        await user.save();
        reply(result);
        return true;
    }

    if (args[0] == '일괄분해') {
        const result = formatBulkDisassemblePreview(user, args[1], args[2]);
        await user.save();
        reply(result);
        return true;
    }

    if (args[0] == '잠금') {
        if (!args[1]) {
            reply('❌ /RPGenius 잠금 [장비번호]');
            return true;
        }
        const result = toggleEquipmentLock(user, args[1]);
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

function expandPetShortcut(rawText, senderId) {
    if (!rawText || rawText.length > 200) return null;
    const map = petShortcutCache[senderId];
    if (!map || Object.keys(map).length == 0) return null;
    const tokens = rawText.split(/\s+/);
    if (tokens.length == 0 || typeof map[tokens[0]] == 'undefined') return null; // 단축키로 시작할 때만 치환
    const parts = [];
    let i = 0;
    while (i < tokens.length && typeof map[tokens[i]] != 'undefined') parts.push(map[tokens[i++]]);
    for (; i < tokens.length; i++) parts.push(tokens[i]);
    return parts.join(' ');
}

async function onChat(data, channel) {
    if (!channel || !TARGET_CHANNEL_IDS.includes(channel.channelId + '')) return false;
    const rawMsg = (data.text || '').trim();
    let workingText = data.text;
    if (!rawMsg.startsWith('/')) {
        const sender = data.getSenderInfo(channel) || data._chat?.sender;
        if (!sender || !sender.userId) return false;
        const expanded = expandPetShortcut(rawMsg, sender.userId + '');
        if (expanded == null) return false;
        workingText = expanded;
    }
    const msg = (workingText || '').trim();
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
    const finalData = workingText === data.text ? data : { text: workingText, getSenderInfo: c => data.getSenderInfo(c), _chat: data._chat };
    enqueueUserCommand(senderId, () => handleRPGCommand(finalData, channel)).catch(error => console.log('RPG command queue error:', error));
    return true;
}

module.exports = {
    TARGET_CHANNEL_IDS,
    RPGUser,
    getRPGUserById,
    getRPGUserByName,
    getRPGUserByCode,
    getAllRPGUsers,
    getMaxExpForLevel,
    onChat,
    initRpgeniusData,
    resumeAllFishing,
    loadRpgeniusDataEntry,
    saveRpgeniusDataEntry,
    getDataCache,
    RPGENIUS_DATA_KEYS,
    calculateUserStats,
    calculateCombatPower,
    getEquippedPets,
    getPetData,
    isPetEffectActive,
    isPetExpired,
    getActivePetSpecials,
    formatPetExpiry,
    normalizePetSpecial,
    formatPetSpecialLines,
    getPetSetData,
    getActivePetSetEffects,
    formatEquipmentStatLines,
    formatPetSetEffectLines,
    normalizeSpecialObject,
    collectPetSpecialObjects,
    applyPetRegen,
    clonePetInstance,
    addPetInventory,
    isPetTradable,
    markPetTraded,
    formatUserCard,
    formatEquipmentInfo,
    formatInventory,
    formatCharacterInventory,
    formatEquipmentInventory,
    formatEquipmentBaseStatLines,
    formatStatValue,
    formatValue,
    formatCurrentEquipmentStatLines,
    formatPotentialLines,
    formatPotentialOptionEntries,
    getPotentialRarityKey,
    getPotentialRarityLabel,
    getEquipmentDisplayName,
    isSoulExpired,
    getCardSlotEffectValue,
    addInventoryItem,
    removeInventoryItem,
    getInventoryItemCount,
    cleanupInventoryItems,
    getRemainingCardInventorySpace,
    getTradeTicketItemId,
    getCardTicketCost,
    cloneEquipmentInstance,
    equipItemByNumber,
    unequipEquipmentByNumber,
    getEquipmentTradeBlockReason,
    markEquipmentTraded,
    getEquipmentTradeLimitInfo,
    isEquipmentBindingEnabled,
    formatSkillDescWithIncrease,
    formatCurrentSkillDesc,
    formatCooltime,
    getWorldBossContributionRanking,
    calculateCardSlotEffects
};
