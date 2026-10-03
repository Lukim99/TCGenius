// 명시적으로 실행하는 신규 콘텐츠 등록. 기존 운영 정의와 배열 인덱스는 그대로 보존한다.
const fs = require('fs');
const path = require('path');
const { isDeepStrictEqual } = require('node:util');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, TransactWriteCommand } = require('@aws-sdk/lib-dynamodb');

const material = { type: '재료', name: '금괴0.1돈', desc: '우승상품으로 주어졌던 금괴0.1돈이다.' };
const accessory = { name: '게임체인저', rarity: '고유', desc: 'GCL OFFLINE 우승자에게 주어진 트로피다.', plusStat: { bossDmg: 0.1, takenDamage: 0.1 } };

function appendContent(before) {
    if (!Array.isArray(before.Item) || !before.Equipment || !Array.isArray(before.Equipment.accessory) || !Array.isArray(before.Recipe)) throw new Error('운영 Item/Equipment/Recipe 데이터가 없습니다. 초기화하지 않습니다.');
    const after = structuredClone(before);
    let materialId = after.Item.findIndex(item => item && item.name === material.name);
    if (materialId < 0) { materialId = after.Item.length; after.Item.push(structuredClone(material)); }
    let accessoryId = after.Equipment.accessory.findIndex(item => item && item.name === accessory.name);
    if (accessoryId < 0) { accessoryId = after.Equipment.accessory.length; after.Equipment.accessory.push(structuredClone(accessory)); }
    if (!after.Recipe.some(recipe => recipe && recipe.name === accessory.name)) after.Recipe.push({
        name: accessory.name, materials: [{ type: '아이템', item_id: materialId, count: 10 }], crafted: [{ type: '장신구', accessory_id: accessoryId }]
    });
    return { after, materialId, accessoryId };
}

async function main() {
    const root = path.join(__dirname, '..');
    for (const file of ['.env', '.env.local']) {
        const full = path.join(root, file);
        if (!fs.existsSync(full)) continue;
        for (const line of fs.readFileSync(full, 'utf8').split(/\r?\n/)) {
            const match = line.match(/^\s*([^#=]+)=(.*)$/);
            if (match && !process.env[match[1].trim()]) process.env[match[1].trim()] = match[2].trim().replace(/^(['"])(.*)\1$/, '$2');
        }
    }
    const db = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'ap-northeast-2', credentials: { accessKeyId: process.env.AWS_ACCESS_KEY_ID, secretAccessKey: process.env.AWS_SECRET_KEY_ID } }));
    const before = {};
    for (const key of ['Item', 'Equipment', 'Recipe']) {
        const result = await db.send(new GetCommand({ TableName: 'rpgenius_data', Key: { key }, ConsistentRead: true }));
        before[key] = result.Item && result.Item.data;
    }
    const { after, materialId, accessoryId } = appendContent(before);
    const changed = Object.keys(before).filter(key => !isDeepStrictEqual(before[key], after[key]));
    console.log(JSON.stringify({ changed, materialId, accessoryId, material: after.Item[materialId], accessory: after.Equipment.accessory[accessoryId], recipe: after.Recipe.find(recipe => recipe && recipe.name === accessory.name) }, null, 2));
    if (!process.argv.includes('--apply') || !changed.length) return;
    await db.send(new TransactWriteCommand({ TransactItems: Object.keys(before).map(key => changed.includes(key) ? { Update: {
        TableName: 'rpgenius_data', Key: { key }, UpdateExpression: 'SET #data = :after', ConditionExpression: '#data = :before',
        ExpressionAttributeNames: { '#data': 'data' }, ExpressionAttributeValues: { ':before': before[key], ':after': after[key] }
    } } : { ConditionCheck: {
        TableName: 'rpgenius_data', Key: { key }, ConditionExpression: '#data = :before',
        ExpressionAttributeNames: { '#data': 'data' }, ExpressionAttributeValues: { ':before': before[key] }
    } }) }));
    for (const key of Object.keys(after)) {
        const result = await db.send(new GetCommand({ TableName: 'rpgenius_data', Key: { key }, ConsistentRead: true }));
        if (!isDeepStrictEqual(result.Item && result.Item.data, after[key])) throw new Error(key + ' 등록 후 읽기 검증이 일치하지 않습니다. 추가로 변경하지 않습니다.');
    }
    console.log('신규 누락 항목만 등록하고 읽기 검증을 완료했습니다. 기존 운영 정의와 제작 연결은 보존했습니다.');
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { appendContent, material, accessory };
