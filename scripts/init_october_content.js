// 직접 실행할 때만 요청된 10월 콘텐츠를 등록한다. 기존 아이템과 운영 구성은 보존한다.
const fs = require('fs');
const path = require('path');
const { isDeepStrictEqual } = require('node:util');
const shopCatalog = require('../shop_catalog');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, TransactWriteCommand } = require('@aws-sdk/lib-dynamodb');

function appendOctober(before) {
    if (!Array.isArray(before.Item) || !Array.isArray(before.Bundle) || !Array.isArray(before.Pack) || !before.Shop || Array.isArray(before.Shop)) throw new Error('운영 Item/Bundle/Pack/Shop 데이터가 없습니다. 초기화하지 않습니다.');
    const after = structuredClone(before);
    const existingId = name => {
        const id = after.Item.findIndex(item => item && item.name === name);
        if (id < 0) throw new Error('운영 구성품이 없습니다: ' + name);
        return id;
    };
    const addItem = definition => {
        let id = after.Item.findIndex(item => item && item.name === definition.name);
        if (id < 0) { id = after.Item.length; after.Item.push(definition); }
        return id;
    };
    const addBundle = (definition, rewards) => {
        const id = after.Item.findIndex(item => item && item.name === definition.name);
        if (id >= 0) return id;
        const itemId = addItem({ ...definition, type: '번들', pack: after.Bundle.length });
        after.Bundle.push(rewards);
        return itemId;
    };
    const keyId = addItem({ name: '아티팩트 옵션 변경열쇠', type: '사용', use: '아티팩트옵션변경', desc: '아티팩트의 모든 옵션을 무작위로 다시 뽑는다. 등급과 재설정 사용 횟수는 유지되며 기존 옵션 종류도 다시 나올 수 있다.' });
    const gemSetId = addBundle({ name: '[10월]각성보석세트', sellPrice: 60000000, desc: '용기의 보석, 희생의 보석, 투지의 보석, 권능의 보석, 지혜의 보석, 인내의 보석을 각각 1개 획득한다.' },
        ['용기의 보석', '희생의 보석', '투지의 보석', '권능의 보석', '지혜의 보석', '인내의 보석'].map(name => ({ type: '아이템', item_id: existingId(name), count: 1 })));
    const luckyId = addItem({ name: '[10월]조합성공률30%증가럭키카드', type: '티켓', sellPrice: 30000000, lucky: .3, desc: '카드 조합 성공률을 곱연산으로 30% 상승시킨다.' });
    const lockbox = after.Item[existingId('봉인된 자물쇠')];
    const pack = after.Pack[lockbox.pack];
    if (!Array.isArray(pack)) throw new Error('운영 자물쇠 보상 구성을 확인해주세요.');
    for (const [oldName, nextId] of [['[9월]8성 보호카드', gemSetId], ['[9월]9성 보호카드', luckyId]]) {
        const entries = pack.filter(entry => entry && entry.type === '아이템' && (after.Item[entry.item_id]?.name === oldName || entry.item_id === nextId));
        if (entries.length !== 1) throw new Error('이달의 아이템 슬롯을 확인해주세요: ' + oldName);
        entries[0].item_id = nextId;
    }
    const packageId = addBundle({ name: '아티팩트패키지', no_trade: true, desc: '구매 즉시 아티팩트 옵션 변경열쇠 1개, 황금 주머니 20개, 윷 4개를 지급한다.' },
        [{ type: '아이템', item_id: keyId, count: 1 }, { type: '아이템', item_id: existingId('황금 주머니'), count: 20 }, { type: '아이템', item_id: existingId('윷'), count: 4 }]);
    if (after.Shop['패키지'] == null) after.Shop['패키지'] = [];
    if (!Array.isArray(after.Shop['패키지'])) throw new Error('운영 패키지 상점 형식을 확인해주세요.');
    if (!Object.values(after.Shop).some(entries => Array.isArray(entries) && entries.some(entry => entry?.type === '아이템' && entry.item_id === packageId))) {
        after.Shop['패키지'].push({ shopId: shopCatalog.newShopItemId(), contentKey: 'artifact-package', type: '아이템', item_id: packageId, count: 1, price: { goods: 'point', amount: 550 }, limits: { max: 2 } });
    }
    shopCatalog.readShopCatalog(after.Shop);
    return { after, keyId, gemSetId, luckyId, packageId };
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
    const db = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'ap-northeast-2', credentials: { accessKeyId: process.env.AWS_ACCESS_KEY_ID, secretAccessKey: process.env.AWS_SECRET_KEY_ID } }));
    const records = {}, before = {};
    for (const key of ['Item', 'Bundle', 'Pack', 'Shop']) {
        const result = await db.send(new GetCommand({ TableName: 'rpgenius_data', Key: { key }, ConsistentRead: true }));
        records[key] = result.Item; before[key] = result.Item && result.Item.data;
    }
    const result = appendOctober(before), after = result.after;
    const changed = Object.keys(before).filter(key => !isDeepStrictEqual(before[key], after[key]));
    console.log(JSON.stringify({ changed, items: [result.keyId, result.gemSetId, result.luckyId, result.packageId].map(id => ({ id, ...after.Item[id], rewards: after.Item[id].type === '번들' ? after.Bundle[after.Item[id].pack] : undefined })), monthly: after.Pack[after.Item.find(item => item?.name === '봉인된 자물쇠').pack].slice(0, 2), product: Object.values(after.Shop).flat().find(entry => entry?.item_id === result.packageId) }, null, 2));
    if (!process.argv.includes('--apply') || !changed.length) return;
    const index = process.argv.indexOf('--backup-dir');
    if (index < 0 || !process.argv[index + 1]) throw new Error('--apply에는 --backup-dir 경로가 필요합니다.');
    const backupDir = path.resolve(process.argv[index + 1]); fs.mkdirSync(backupDir, { recursive: true });
    fs.writeFileSync(path.join(backupDir, 'october-before-' + Date.now() + '.json'), JSON.stringify(records, null, 2));
    await db.send(new TransactWriteCommand({ TransactItems: Object.keys(before).map(key => changed.includes(key) ? { Update: {
        TableName: 'rpgenius_data', Key: { key }, UpdateExpression: 'SET #data = :after', ConditionExpression: '#data = :before',
        ExpressionAttributeNames: { '#data': 'data' }, ExpressionAttributeValues: { ':before': before[key], ':after': after[key] }
    } } : { ConditionCheck: { TableName: 'rpgenius_data', Key: { key }, ConditionExpression: '#data = :before', ExpressionAttributeNames: { '#data': 'data' }, ExpressionAttributeValues: { ':before': before[key] } } }) }));
    for (const key of Object.keys(after)) {
        const saved = await db.send(new GetCommand({ TableName: 'rpgenius_data', Key: { key }, ConsistentRead: true }));
        if (!isDeepStrictEqual(saved.Item && saved.Item.data, after[key])) throw new Error(key + ' 등록 후 검증 불일치');
    }
    console.log('10월 콘텐츠 등록 및 전체 읽기 검증 완료. 기존 운영 데이터와 확률 보존.');
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { appendOctober };
