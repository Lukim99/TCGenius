// 직접 실행할 때만 요청된 생일 보상 아이템과 레이드를 추가한다. 기존 운영 항목은 보존한다.
const fs = require('fs');
const path = require('path');
const { isDeepStrictEqual } = require('node:util');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { ID } = require('../birthday_raid');

function birthdayQuest() {
    const monster = { image: '레이드/lukim-birthday-boss-v1.png', atk: 0, def: 0, mp: 0, actionInterval: 3 };
    return { id: ID, name: '루킴의 생일파티', description: '10월 6일 생일파티',
        coverImage: '레이드/lukim-birthday-banner-v1.png', minPlayers: 1, maxPlayers: 4,
        potionLimit: 10, noPositions: true, noPhaseChoices: true,
        phases: [
            { name: '생일 케이크', type: 'boss', monster: { ...monster, name: '생일 케이크', hp: 6 } },
            { name: '루킴의 생일파티', type: 'boss', monster: { ...monster, name: '루킴', hp: 1006 } }
        ], rewards: { exp: 0, gold: 0, courageGemChance: 0 } };
}

function appendBirthday(before) {
    if (!Array.isArray(before)) throw new Error('운영 Item 데이터가 없습니다. 초기화하지 않습니다.');
    const items = structuredClone(before);
    const elixir = items.find(item => item?.name === '엘릭서');
    if (!elixir || !Array.isArray(elixir.use_func)) throw new Error('운영 엘릭서 설정을 확인해주세요.');
    let blessingId = items.findIndex(item => item?.use === '축복사용권' && item.blessing === 'rukim' && Number(item.durationDays) === 30);
    if (blessingId < 0) {
        blessingId = items.length;
        items.push({ name: '루킴의 축복 사용권 (30일)', type: '사용', use: '축복사용권', blessing: 'rukim', durationDays: 30,
            no_trade: true, desc: '사용 시 루킴의 축복 이용 기간이 30일 적용 또는 연장된다.' });
    }
    let cakeId = items.findIndex(item => item?.name === '케이크');
    if (cakeId < 0) { cakeId = items.length; items.push({ ...structuredClone(elixir), name: '케이크' }); }
    return { items, blessingId, cakeId };
}

function appendQuest(before) {
    if (!before || !Array.isArray(before.quests)) throw new Error('기존 PartyQuest.json을 확인해주세요.');
    const after = structuredClone(before);
    if (!after.quests.some(quest => quest.id === ID)) after.quests.push(birthdayQuest());
    return after;
}

function appendQuestText(text) {
    const before = JSON.parse(text), after = appendQuest(before);
    if (after.quests.length === before.quests.length) return text;
    const closing = text.lastIndexOf(']');
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    const indent = text.match(/\r?\n([ \t]+)"quests"/)?.[1] || '  ';
    const quest = JSON.stringify(birthdayQuest(), null, indent).split('\n').map(line => indent + indent + line).join(eol);
    const result = text.slice(0, closing).trimEnd() + ',' + eol + quest + eol + indent + text.slice(closing);
    if (!isDeepStrictEqual(JSON.parse(result), after)) throw new Error('기존 레이드 설정 형식을 확인해주세요.');
    return result;
}

async function main() {
    const root = path.join(__dirname, '..');
    for (const name of ['.env', '.env.local']) {
        const file = path.join(root, name);
        if (!fs.existsSync(file)) continue;
        for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
            const match = line.match(/^\s*([^#=]+)=(.*)$/);
            if (match && !process.env[match[1].trim()]) process.env[match[1].trim()] = match[2].trim().replace(/^(['"])(.*)\1$/, '$2');
        }
    }
    const db = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'ap-northeast-2', credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID, secretAccessKey: process.env.AWS_SECRET_KEY_ID } }));
    const key = { TableName: 'rpgenius_data', Key: { key: 'Item' } };
    const before = (await db.send(new GetCommand({ ...key, ConsistentRead: true }))).Item?.data;
    const result = appendBirthday(before);
    const questPath = path.join(root, 'DB/RPGenius/PartyQuest.json');
    const questBefore = fs.readFileSync(questPath, 'utf8');
    const questAfter = appendQuestText(questBefore);
    console.log(JSON.stringify({ blessingId: result.blessingId, cakeId: result.cakeId,
        cake: result.items[result.cakeId], addedItems: result.items.length - before.length, quest: birthdayQuest() }, null, 2));
    if (!process.argv.includes('--apply')) return;
    const index = process.argv.indexOf('--backup-dir');
    if (index < 0 || !process.argv[index + 1]) throw new Error('--apply에는 --backup-dir 경로가 필요합니다.');
    const backupDir = path.resolve(process.argv[index + 1]); fs.mkdirSync(backupDir, { recursive: true });
    fs.writeFileSync(path.join(backupDir, 'birthday-before-' + Date.now() + '.json'), JSON.stringify({ Item: before, PartyQuest: JSON.parse(questBefore) }, null, 2));
    if (!isDeepStrictEqual(result.items, before)) await db.send(new UpdateCommand({ ...key,
        UpdateExpression: 'SET #data = :after', ConditionExpression: '#data = :before',
        ExpressionAttributeNames: { '#data': 'data' }, ExpressionAttributeValues: { ':before': before, ':after': result.items } }));
    const saved = (await db.send(new GetCommand({ ...key, ConsistentRead: true }))).Item?.data;
    if (!isDeepStrictEqual(saved, result.items)) throw new Error('생일 아이템 등록 후 검증 불일치');
    if (fs.readFileSync(questPath, 'utf8') !== questBefore) throw new Error('레이드 설정이 동시에 변경되었습니다. 다시 실행해주세요.');
    if (questAfter !== questBefore) fs.writeFileSync(questPath, questAfter);
    console.log('생일 콘텐츠 누락 항목 등록 완료. 기존 아이템과 레이드 보존.');
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { appendBirthday, appendQuest, appendQuestText, birthdayQuest };
