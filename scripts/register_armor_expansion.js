'use strict';

// 명시 실행 전용. 기존 장비, 강화 수치, 인덱스 및 운영 설명은 보존한다.
const fs = require('fs');
const path = require('path');
const { isDeepStrictEqual } = require('node:util');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { definitions, PASSIVE_IDS } = require('../armor_expansion');
function appendEquipment(before) {
    const after = structuredClone(before), names = new Set(Object.values(definitions).flat().map(item => item.name));
    for (const item of Object.values(after || {}).flat()) if (Object.values(PASSIVE_IDS).includes(item?.passive_id) && !names.has(item.name)) throw new Error('기존 장비와 패시브 ID가 충돌합니다: ' + item.name);
    for (const [slot, entries] of Object.entries(definitions)) {
        if (!Array.isArray(after?.[slot])) throw new Error('운영 장비 목록이 없습니다: ' + slot);
        for (const item of entries) if (!after[slot].some(old => old?.name === item.name)) after[slot].push(structuredClone(item));
        const unique = entries.find(item => item.rarity === '유니크'), legendary = entries.find(item => item.rarity === '레전더리');
        after[slot].find(item => item.name === unique.name).evolution = after[slot].findIndex(item => item.name === legendary.name);
    }
    return after;
}
async function main() {
    const root = path.join(__dirname, '..');
    for (const name of ['.env', '.env.local']) {
        const file = path.join(root, name); if (!fs.existsSync(file)) continue;
        for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
            const match = line.match(/^\s*([^#=]+)=(.*)$/);
            if (match && !process.env[match[1].trim()]) process.env[match[1].trim()] = match[2].trim().replace(/^(['"])(.*)\1$/, '$2');
        }
    }
    const db = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'ap-northeast-2', credentials: { accessKeyId: process.env.AWS_ACCESS_KEY_ID, secretAccessKey: process.env.AWS_SECRET_KEY_ID } }));
    const read = async () => (await db.send(new GetCommand({ TableName: 'rpgenius_data', Key: { key: 'Equipment' }, ConsistentRead: true }))).Item?.data;
    const before = await read(), after = appendEquipment(before), changed = !isDeepStrictEqual(before, after);
    console.log(JSON.stringify({ changed, added: Object.keys(definitions).flatMap(slot => after[slot].slice(before[slot].length).map(item => ({ slot, name:item.name, rarity:item.rarity }))) }, null, 2));
    if (!process.argv.includes('--apply') || !changed) return;
    const backup = path.join(root, 'output', 'armor-expansion', 'before-' + Date.now() + '.json');
    fs.mkdirSync(path.dirname(backup), { recursive:true }); fs.writeFileSync(backup, JSON.stringify(before, null, 2), { flag:'wx' });
    await db.send(new UpdateCommand({ TableName:'rpgenius_data', Key:{key:'Equipment'}, UpdateExpression:'SET #data = :after', ConditionExpression:'#data = :before',
        ExpressionAttributeNames:{'#data':'data'}, ExpressionAttributeValues:{':before':before,':after':after} }));
    if (!isDeepStrictEqual(await read(), after)) throw new Error('신규 장비 등록 후 읽기 검증 불일치');
    console.log('신규 장비 12종 등록 및 기존 장비 보존 검증 완료. 백업: ' + backup);
}
module.exports = { appendEquipment };
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
