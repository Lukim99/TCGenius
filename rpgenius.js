const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, UpdateCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');
const fs = require('fs');
const path = require('path');

const TARGET_CHANNEL_IDS = ['442097040687921', '18470462260425659'];
const TABLE_NAME = 'rpgenius_user';
const VIEWMORE = '\u200e'.repeat(500);
const pendingChecks = {};
const CHARACTER_CARDS_PATH = path.join(__dirname, 'DB', 'RPGenius', 'CharacterCards.json');
const SKILLS_PATH = path.join(__dirname, 'DB', 'RPGenius', 'Skills.json');

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

function formatSkillDesc(skill) {
    if (!skill) return '알 수 없는 스킬입니다.';
    return skill.desc.replace(/\$\{(\d+)\}/g, (match, index) => {
        const format = skill.format && skill.format[Number(index) - 1];
        return formatValue(format);
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
            return true;
        }
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