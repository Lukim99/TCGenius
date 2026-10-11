'use strict';

// 직접 실행할 때만 신규 항목을 추가한다. 기존 운영 정의·인덱스·꾸러미는 보존한다.
const fs = require('fs');
const path = require('path');
const { isDeepStrictEqual } = require('node:util');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, TransactWriteCommand } = require('@aws-sdk/lib-dynamodb');
const { newShopItemId } = require('../shop_catalog');
const transcend = require('../transcend_equipment');
const orbDescriptions = {
    '급락전문': '받는 피해 감소 2%', '나무': '연격 확률 +1%', '나일로머스크': '화속성 강화 +25, 화속성 저항 +25',
    '대학원생': '회복 효율 -5%, 물약 효율 +10%', '베재댜겨쇼': '치명타 확률 +5%, 치명타 피해량 -5%',
    '스테브잡션': '방어력 +2%', '신호등': '암속성 강화 +25, 암속성 저항 +25', '야치요': '수속성 강화 +25, 수속성 저항 +25',
    '에스코바르': '[무]속성 공격 피해 +1%', '연기금': '골드 획득량 +1%', '워뇨띠': '방어력 관통 +3%',
    '코트': '엘리트 추가 피해 +3%', '키노': '일반 몬스터 추가 피해 +3%'
};
const itemDefinitions = Object.entries(orbDescriptions).map(([name, desc]) => ({
    name: name + ' 보주', type: '사용', use: '보주', desc: '장비에 부여해 효과를 얻는 보주다.\n- 부여 가능 부위: 모자, 신발\n- ' + desc
})).concat({ name: '일리온 캐릭터 변환석', type: '사용', use: '변환', no_trade: true, charId: 14, desc: '지정한 캐릭터 카드의 캐릭터를 일리온으로 변환한다.' });
const equipmentDefinitions = {
    weapon: transcend.definitions.weapon.filter(item => ['무한홀덤덱', '어머니의 마음'].includes(item.name)).map(item => ({ ...item, require: [] })),
    support: [{ name: '래퍼의 증표', rarity: '고유', require: [], requireMainCard: [14], stat: { atk: 110, mp: 200 },
        statRange: { atk: 90, mp: 100 }, plusStat: { afterBasic: .05 }, plusStatRange: { afterBasic: .10 },
        upgrade: [], desc: '일리온 전용 보조장비. 공격력 +110~200, 일반 공격 피해 +5~15%, 최대 MP +200~300.' }]
};
const fashionDefinition = { name: '2018', primary_card: [14], requireStar: 6, option: { stat: { atk: 80, hp: 1000 }, plusStat: {} } };

function prepare(before) {
    if (!Array.isArray(before.Item) || !Array.isArray(before.Equipment?.weapon) || !Array.isArray(before.Equipment?.support)
        || !Array.isArray(before.Fashion) || !Array.isArray(before.Shop?.['아바타'])) throw new Error('기존 운영 데이터가 필요합니다. 초기화하지 않습니다.');
    const after = structuredClone(before);
    for (const item of itemDefinitions) if (!after.Item.some(old => old?.name === item.name)) after.Item.push(item);
    for (const [part, list] of Object.entries(equipmentDefinitions)) for (const item of list) {
        if (!after.Equipment[part].some(old => old?.name === item.name)) after.Equipment[part].push(structuredClone(item));
    }
    if (!after.Fashion.some(old => old?.name === fashionDefinition.name)) after.Fashion.push(structuredClone(fashionDefinition));
    if (!after.Shop['아바타'].some(old => old?.fashion === '2018')) after.Shop['아바타'].push({
        shopId: newShopItemId(), type: '아바타', fashion: '2018', count: 1, limits: {}, price: { goods: 'point', amount: 1000 }
    });
    return after;
}

async function main() {
    for (const name of ['.env', '.env.local']) {
        const file = path.join(__dirname, '..', name);
        if (!fs.existsSync(file)) continue;
        for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
            const match = line.match(/^\s*([^#=]+)=(.*)$/);
            if (match && !process.env[match[1].trim()]) process.env[match[1].trim()] = match[2].trim().replace(/^(['"])(.*)\1$/, '$2');
        }
    }
    const db = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'ap-northeast-2', credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID, secretAccessKey: process.env.AWS_SECRET_KEY_ID
    } }));
    const keys = ['Item', 'Equipment', 'Fashion', 'Shop'];
    const read = async key => (await db.send(new GetCommand({ TableName: 'rpgenius_data', Key: { key }, ConsistentRead: true }))).Item?.data;
    const before = Object.fromEntries(await Promise.all(keys.map(async key => [key, await read(key)])));
    const after = prepare(before), changed = keys.filter(key => !isDeepStrictEqual(before[key], after[key]));
    console.log(JSON.stringify({ changed, items: after.Item.slice(before.Item.length).map(item => item.name),
        weapons: after.Equipment.weapon.slice(before.Equipment.weapon.length).map(item => item.name),
        support: after.Equipment.support.slice(before.Equipment.support.length).map(item => item.name),
        avatars: after.Fashion.slice(before.Fashion.length).map(item => item.name), avatarPrice: 1000 }, null, 2));
    if (!process.argv.includes('--apply') || !changed.length) return;
    const dir = path.join(__dirname, '..', 'output', 'ilion');
    fs.mkdirSync(dir, { recursive: true });
    const backup = path.join(dir, 'registration-before-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json');
    fs.writeFileSync(backup, JSON.stringify(before, null, 2), { flag: 'wx' });
    await db.send(new TransactWriteCommand({ TransactItems: keys.map(key => {
        const contract = { TableName: 'rpgenius_data', Key: { key }, ConditionExpression: '#data = :before',
            ExpressionAttributeNames: { '#data': 'data' }, ExpressionAttributeValues: { ':before': before[key] } };
        return changed.includes(key) ? { Update: { ...contract, UpdateExpression: 'SET #data = :after',
            ExpressionAttributeValues: { ...contract.ExpressionAttributeValues, ':after': after[key] } } } : { ConditionCheck: contract };
    }) }));
    for (const key of keys) if (!isDeepStrictEqual(await read(key), after[key])) throw new Error('동시 운영 변경 감지: ' + key);
    console.log('신규 등록 완료. 기존 운영 데이터 보존. 백업: ' + backup);
}

module.exports = { prepare, itemDefinitions, equipmentDefinitions, fashionDefinition };
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
