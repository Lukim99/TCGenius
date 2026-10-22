// 명시 실행 전용: 요청한 지옥 보상 두 항목만 조건부 변경한다.
const fs = require('fs');
const path = require('path');
const { isDeepStrictEqual } = require('node:util');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const replacements = require('../paradise_hell_content').INITIAL_CONFIG.rewards.filter(r => ['goldPouch', 'heavenTicket'].includes(r.id));
function updateRewards(before) {
    if (!Array.isArray(before?.hell?.rewards)) throw new Error('운영 지옥 보상표가 없습니다. 새로 만들지 않습니다.');
    const after = structuredClone(before);
    for (const target of replacements) {
        const existing = after.hell.rewards.find(r => r.id === target.id);
        if (existing) {
            if (existing.kind !== target.kind || existing.item !== target.item) throw new Error(target.id + ' 연결이 예상과 다릅니다. 덮어쓰지 않습니다.');
            existing.counts = [...target.counts];
        } else if (target.id === 'heavenTicket') after.hell.rewards.push(structuredClone(target));
        else throw new Error('기존 황금 주머니 보상 항목을 찾을 수 없습니다.');
    }
    return after;
}
async function main() {
    const envIndex = process.argv.indexOf('--env-file');
    if (envIndex >= 0) for (const line of fs.readFileSync(process.argv[envIndex + 1], 'utf8').split(/\r?\n/)) {
        const match = line.match(/^\s*([^#=]+)=(.*)$/);
        if (match && !process.env[match[1].trim()]) process.env[match[1].trim()] = match[2].trim().replace(/^(['"])(.*)\1$/, '$2');
    }
    const db = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'ap-northeast-2', credentials: { accessKeyId: process.env.AWS_ACCESS_KEY_ID, secretAccessKey: process.env.AWS_SECRET_KEY_ID } }));
    const read = key => db.send(new GetCommand({ TableName: 'rpgenius_data', Key: { key }, ConsistentRead: true }));
    const before = (await read('Paradise')).Item?.data, after = updateRewards(before), items = (await read('Item')).Item?.data;
    for (const reward of replacements) if (!items?.some(item => item?.name === reward.item)) throw new Error('운영 아이템 미등록: ' + reward.item);
    const changed = !isDeepStrictEqual(before, after);
    console.log(JSON.stringify({ changed, before: before.hell.rewards.filter(r => replacements.some(target => target.id === r.id)), after: after.hell.rewards.filter(r => replacements.some(target => target.id === r.id)) }, null, 2));
    if (!changed || !process.argv.includes('--apply')) return;
    const backup = path.join(__dirname, '../output/paradise-refinement/hell-rewards-before-' + Date.now() + '.json');
    fs.mkdirSync(path.dirname(backup), { recursive: true }); fs.writeFileSync(backup, JSON.stringify(before, null, 2));
    await db.send(new UpdateCommand({ TableName: 'rpgenius_data', Key: { key: 'Paradise' }, UpdateExpression: 'SET #data = :after', ConditionExpression: '#data = :before', ExpressionAttributeNames: { '#data': 'data' }, ExpressionAttributeValues: { ':before': before, ':after': after } }));
    if (!isDeepStrictEqual((await read('Paradise')).Item?.data, after)) throw new Error('운영 보상표 읽기 검증 불일치');
    console.log('요청한 지옥 보상 두 항목만 변경하고 읽기 검증했습니다.');
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { updateRewards };
