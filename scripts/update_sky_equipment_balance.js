'use strict';

// 명시 실행 전용. 요청된 세 장비의 효과 수치와 설명만 변경한다.
const fs = require('fs');
const path = require('path');
const { isDeepStrictEqual } = require('node:util');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const PATCHES = [
    { slot: 'hat', name: '천공의 모자', group: 'stat', key: 'critLightBonus', value: .10,
        desc: '치명타가 발생하면 공격력의 10%만큼 명속성 추가 피해를 입힙니다. 초월 단계마다 피해 배율이 4%p 증가합니다.' },
    { slot: 'armor', name: '천공의 갑옷', group: 'plusStat', key: 'lightFinalDamage', value: .10,
        desc: '명속성 공격의 최종 피해가 10% 증가합니다. 초월 단계마다 5%p 추가로 증가합니다.' },
    { slot: 'pants', name: '천공의 하의', group: 'stat', key: 'nonCritLightBonus', value: .08,
        desc: '치명타가 발생하지 않으면 공격력의 8%만큼 명속성 추가 피해를 입힙니다. 초월 단계마다 피해 배율이 3%p 증가합니다.' }
];
function patchEquipment(before) {
    const after = structuredClone(before);
    for (const patch of PATCHES) {
        const matches = after?.[patch.slot]?.filter(item => item?.name === patch.name);
        if (matches?.length !== 1 || !matches[0][patch.group]) throw new Error('운영 장비를 확인해주세요: ' + patch.name);
        matches[0][patch.group][patch.key] = patch.value;
        matches[0].desc = patch.desc;
    }
    return after;
}
async function main() {
    const root = path.join(__dirname, '..');
    for (const filename of ['.env', '.env.local']) {
        const full = path.join(root, filename); if (!fs.existsSync(full)) continue;
        for (const line of fs.readFileSync(full, 'utf8').split(/\r?\n/)) {
            const match = line.match(/^\s*([^#=]+)=(.*)$/);
            if (match && !process.env[match[1].trim()]) process.env[match[1].trim()] = match[2].trim().replace(/^(['"])(.*)\1$/, '$2');
        }
    }
    const db = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'ap-northeast-2', credentials: { accessKeyId: process.env.AWS_ACCESS_KEY_ID, secretAccessKey: process.env.AWS_SECRET_KEY_ID } }));
    const read = async () => (await db.send(new GetCommand({ TableName: 'rpgenius_data', Key: { key: 'Equipment' }, ConsistentRead: true }))).Item?.data;
    const before = await read(), after = patchEquipment(before), changed = !isDeepStrictEqual(before, after);
    console.log(JSON.stringify({ changed, equipment: PATCHES.map(patch => {
        const item = before[patch.slot].find(entry => entry?.name === patch.name);
        return { name: patch.name, field: patch.group + '.' + patch.key, before: item[patch.group][patch.key], after: patch.value, description: patch.desc };
    }) }, null, 2));
    if (!process.argv.includes('--apply') || !changed) return;
    const backup = path.join(root, 'output', 'sky-equipment-balance', 'before-' + Date.now() + '.json');
    fs.mkdirSync(path.dirname(backup), { recursive: true }); fs.writeFileSync(backup, JSON.stringify(before, null, 2), { flag: 'wx' });
    await db.send(new UpdateCommand({ TableName: 'rpgenius_data', Key: { key: 'Equipment' }, UpdateExpression: 'SET #data = :after',
        ConditionExpression: '#data = :before', ExpressionAttributeNames: { '#data': 'data' }, ExpressionAttributeValues: { ':after': after, ':before': before } }));
    if (!isDeepStrictEqual(await read(), after)) throw new Error('운영 장비 변경 후 검증 불일치');
    console.log('천공 장비 3종 변경 및 읽기 검증 완료. 백업: ' + backup);
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { PATCHES, patchEquipment };
