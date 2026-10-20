// 명시 실행 전용. 신규 입장권과 누락된 설정만 추가하며 기존 운영 데이터를 보존한다.
const fs = require('fs');
const path = require('path');
const { isDeepStrictEqual } = require('node:util');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, TransactWriteCommand } = require('@aws-sdk/lib-dynamodb');
const ticket = { name: '천상의 회랑 입장권', type: '티켓', desc: '낙원의 천상 · 무한회랑에 입장할 때 1장 소모됩니다. 콘텐츠 > 사냥 > 낙원에서 입장할 수 있습니다.' };
const initialConfig = { enabled: true, baseRewards: [] };
const rewardItems = [
    { name: '천상의 증표', type: '재료', desc: '천상의 회랑 탐험 달성 보상으로 획득하는 증표.' },
    ...['지옥 열쇠', '화려한 지옥 열쇠', '찬란한 지옥 열쇠'].map(name => ({ name, type: '재료', desc: '천상의 회랑 주간 랭킹 보상. 지옥 콘텐츠 개방 후 사용할 수 있습니다.' }))
];
const milestoneRewards = [[1,1],[10,2],[100,3],[200,4],[300,5],[400,6],[500,7],[600,8],[700,10],[800,15],[900,20],[999,30]].map(([floor,count]) => ({ floor, count, name: '천상의 증표' }));
const weeklyRewards = { participation: [{ type: '아이템', name: '지옥 열쇠', count: 3 }], ranks: [
    { from: 1, to: 1, rewards: [{ type: '아이템', name: '찬란한 지옥 열쇠', count: 3 }, { type: '가넷', count: 2000 }] },
    { from: 2, to: 2, rewards: [{ type: '아이템', name: '화려한 지옥 열쇠', count: 3 }, { type: '가넷', count: 1000 }] },
    { from: 3, to: 5, rewards: [{ type: '아이템', name: '지옥 열쇠', count: 3 }, { type: '가넷', count: 500 }] }
] };

function appendContent(before, configureRewards = false, configureHell = false) {
    if (!Array.isArray(before.Item)) throw new Error('운영 Item 데이터가 없습니다. 초기화하지 않습니다.');
    const after = structuredClone(before);
    let ticketId = after.Item.findIndex(item => item?.name === ticket.name);
    if (ticketId < 0) { ticketId = after.Item.length; after.Item.push(structuredClone(ticket)); }
    if (after.Paradise === undefined) after.Paradise = structuredClone(initialConfig);
    if (configureRewards) {
        for (const item of rewardItems) if (!after.Item.some(existing => existing?.name === item.name)) after.Item.push(structuredClone(item));
        after.Paradise.milestoneRewards = structuredClone(milestoneRewards);
        after.Paradise.weeklyRewards = structuredClone(weeklyRewards);
    }
    if (configureHell && after.Paradise.hell === undefined) after.Paradise.hell = structuredClone(require('../paradise_hell_content').INITIAL_CONFIG);
    return { after, ticketId };
}
async function main() {
    const root = path.join(__dirname, '..');
    for (const filename of ['.env', '.env.local']) {
        const full = path.join(root, filename);
        if (!fs.existsSync(full)) continue;
        for (const line of fs.readFileSync(full, 'utf8').split(/\r?\n/)) {
            const match = line.match(/^\s*([^#=]+)=(.*)$/);
            if (match && !process.env[match[1].trim()]) process.env[match[1].trim()] = match[2].trim().replace(/^(['"])(.*)\1$/, '$2');
        }
    }
    const db = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'ap-northeast-2', credentials: { accessKeyId: process.env.AWS_ACCESS_KEY_ID, secretAccessKey: process.env.AWS_SECRET_KEY_ID } }));
    const before = {};
    for (const key of ['Item', 'Paradise']) {
        const result = await db.send(new GetCommand({ TableName: 'rpgenius_data', Key: { key }, ConsistentRead: true }));
        before[key] = result.Item?.data;
    }
    const { after, ticketId } = appendContent(before, process.argv.includes('--configure-rewards'), process.argv.includes('--configure-hell'));
    const changed = Object.keys(after).filter(key => !isDeepStrictEqual(before[key], after[key]));
    console.log(JSON.stringify({ changed, ticketId, ticket: after.Item[ticketId], config: after.Paradise, existingItemsPreserved: isDeepStrictEqual(after.Item.slice(0, before.Item.length), before.Item) }, null, 2));
    if (!process.argv.includes('--apply') || !changed.length) return;
    const backup = path.join(root, 'output', 'paradise', 'registration-before-' + Date.now() + '.json');
    fs.mkdirSync(path.dirname(backup), { recursive: true }); fs.writeFileSync(backup, JSON.stringify(before, null, 2));
    await db.send(new TransactWriteCommand({ TransactItems: changed.map(key => before[key] === undefined ? { Put: {
        TableName: 'rpgenius_data', Item: { key, data: after[key] }, ConditionExpression: 'attribute_not_exists(#key)', ExpressionAttributeNames: { '#key': 'key' }
    } } : { Update: {
        TableName: 'rpgenius_data', Key: { key }, UpdateExpression: 'SET #data = :after', ConditionExpression: '#data = :before',
        ExpressionAttributeNames: { '#data': 'data' }, ExpressionAttributeValues: { ':before': before[key], ':after': after[key] }
    } }) }));
    for (const key of changed) {
        const result = await db.send(new GetCommand({ TableName: 'rpgenius_data', Key: { key }, ConsistentRead: true }));
        if (!isDeepStrictEqual(result.Item?.data, after[key])) throw new Error(key + ' 등록 후 읽기 검증 불일치');
    }
    console.log(process.argv.includes('--configure-hell') ? '누락된 지옥 설정을 등록했습니다. 기존 아이템과 운영 보상표는 보존했습니다.' : process.argv.includes('--configure-rewards') ? '요청한 달성·주간 보상 설정과 누락된 보상 아이템을 등록했습니다. 기존 아이템·상점·기타 설정은 보존했습니다.' : '신규 입장권·설정만 등록했습니다. 기존 아이템과 상점·보상 구성은 보존했습니다.');
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { appendContent, ticket, initialConfig, milestoneRewards, weeklyRewards, rewardItems };
