// 아바타 시스템 개편 - DynamoDB rpgenius_data 1회성 마이그레이션 스크립트
//
// 실행: node scripts/avatar_data_migration.js          (dry-run: 변경 내용만 출력)
//       node scripts/avatar_data_migration.js --apply  (실제 반영)
//
// 하는 일:
//  [Item]     패션 적용권(104류)·패션 제거 가위: use 제거 + 사용불가(재료)화 + sellPrice 부여
//             전용 적용권(MZ사원/체리 바이트): use만 제거 (fashion 필드는 유저 지연 마이그레이션이 참조하므로 유지)
//             패션 조각: sellPrice 부여
//  [Recipe]   패션 적용권/고급 패션 적용권 제작 레시피 삭제 (레시피는 이름으로만 참조됨)
//  [Shop]     '아바타' 카테고리 신설 - 일반 등급 아바타 전체를 개당 1,000 포인트 상시 판매
//             '일반' 상점의 패션 제거 가위 판매 종료 (뒤 항목에 구매 제한이 있으면 건너뛰고 경고)
//  [Auction]  카드 매물 payload의 skin 제거 (아바타는 계정 해금 자산으로 이동)
//  [BuyOrder] 카드 구매 등록 payload의 skin 제거
//
// 반영 후에는 서버를 재시작해야 캐시에 적용된다. (유저별 해금/스킨 정리는 서버 코드의
// migrateUserToAvatarSystem이 유저 로드 시 자동 수행)
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { DynamoDBClient } = require(path.join(ROOT, 'node_modules', '@aws-sdk', 'client-dynamodb'));
const { DynamoDBDocumentClient, GetCommand, PutCommand } = require(path.join(ROOT, 'node_modules', '@aws-sdk', 'lib-dynamodb'));

const APPLY = process.argv.includes('--apply');

const env = Object.fromEntries(fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8').split(/\r?\n/)
    .filter(l => l.includes('=')).map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const doc = DynamoDBDocumentClient.from(new DynamoDBClient({
    region: 'ap-northeast-2',
    credentials: { accessKeyId: env.AWS_ACCESS_KEY_ID, secretAccessKey: env.AWS_SECRET_KEY_ID }
}));

const BACKUP_DIR = path.join(ROOT, 'tmp', 'avatar_migration_backup');

async function getKey(key) {
    const got = await doc.send(new GetCommand({ TableName: 'rpgenius_data', Key: { key } }));
    return got.Item ? got.Item.data : null;
}

async function putKey(key, data) {
    await doc.send(new PutCommand({ TableName: 'rpgenius_data', Item: { key, data } }));
}

function backup(key, data) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    fs.writeFileSync(path.join(BACKUP_DIR, `backup-${key}-${Date.now()}.json`), JSON.stringify(data));
}

const SELL_PRICES = {
    '패션 조각': 10000,
    '패션 적용권': 200000,
    '고급 패션 적용권': 2000000,
    '패션 제거 가위': 10000
};

(async () => {
    console.log(APPLY ? '=== 실제 반영 모드 ===' : '=== DRY-RUN (반영하려면 --apply) ===');
    const originals = {}; // key → 변형 전 원본 스냅샷 (백업용)
    const snapshot = (key, data) => { originals[key] = JSON.parse(JSON.stringify(data)); return data; };

    // ---------- Fashion (읽기 전용: 아바타 상점 시딩·검증용) ----------
    const fashions = await getKey('Fashion');
    if (!Array.isArray(fashions) || fashions.length === 0) throw new Error('Fashion 데이터를 읽지 못했습니다.');
    const normalNames = [];
    const gradeByName = {};
    fashions.forEach(f => {
        if (!f || !f.name) return;
        if (!(f.name in gradeByName)) gradeByName[f.name] = '일반';
        if (f.exclusive === true) gradeByName[f.name] = '한정';
        else if (f.isHigh === true && gradeByName[f.name] !== '한정') gradeByName[f.name] = '프레스티지';
    });
    Object.keys(gradeByName).forEach(name => { if (gradeByName[name] === '일반') normalNames.push(name); });
    console.log(`[Fashion] 총 ${Object.keys(gradeByName).length}종 (일반 ${normalNames.length} / 프레스티지 ${Object.values(gradeByName).filter(g => g === '프레스티지').length} / 한정 ${Object.values(gradeByName).filter(g => g === '한정').length})`);

    // ---------- Item ----------
    const items = snapshot('Item', await getKey('Item'));
    if (!Array.isArray(items) || items.length === 0) throw new Error('Item 데이터를 읽지 못했습니다.');
    const itemChanges = [];
    items.forEach((item, id) => {
        if (!item) return;
        const isFashionUse = ['패션적용', '고급패션적용', '패션제거'].includes(item.use);
        if (isFashionUse) {
            itemChanges.push(`#${id} ${item.name}: use='${item.use}' 제거` + (item.fashion ? ` (fashion='${item.fashion}' 유지)` : `, type '${item.type}'→'재료'`));
            delete item.use;
            delete item.no_consume;
            if (!item.fashion) item.type = '재료'; // 전용 적용권은 마이그레이션에서 회수되므로 type 유지
        }
        if (item.name in SELL_PRICES && item.sellPrice == null) {
            item.sellPrice = SELL_PRICES[item.name];
            itemChanges.push(`#${id} ${item.name}: sellPrice=${SELL_PRICES[item.name]}`);
        }
    });
    itemChanges.forEach(line => console.log('[Item] ' + line));
    if (itemChanges.length === 0) console.log('[Item] 변경 없음 (이미 반영됨?)');

    // ---------- Recipe ----------
    const recipes = snapshot('Recipe', (await getKey('Recipe')) || []);
    const removedRecipes = (recipes || []).filter(r => r && ['패션 적용권', '고급 패션 적용권'].includes(r.name));
    const keptRecipes = (recipes || []).filter(r => !(r && ['패션 적용권', '고급 패션 적용권'].includes(r.name)));
    removedRecipes.forEach(r => console.log(`[Recipe] 삭제: ${r.name}`));
    if (removedRecipes.length === 0) console.log('[Recipe] 삭제 대상 없음');

    // ---------- Shop ----------
    const shop = snapshot('Shop', await getKey('Shop'));
    if (!shop || typeof shop !== 'object') throw new Error('Shop 데이터를 읽지 못했습니다.');
    // 아바타 카테고리 신설/갱신 (이미 있으면 빠진 일반 아바타만 추가)
    if (!Array.isArray(shop['아바타'])) shop['아바타'] = [];
    const existingAvatarNames = new Set(shop['아바타'].map(e => e && e.fashion).filter(Boolean));
    let addedAvatars = 0;
    normalNames.forEach(name => {
        if (existingAvatarNames.has(name)) return;
        shop['아바타'].push({ type: '아바타', fashion: name, count: 1, price: { goods: 'point', amount: 1000 } });
        addedAvatars++;
    });
    console.log(`[Shop] '아바타' 카테고리: 일반 아바타 ${addedAvatars}종 추가 (총 ${shop['아바타'].length}종, 개당 1,000P)`);
    // 일반 상점 가위 판매 종료 (뒤 항목 인덱스가 밀리므로, 뒤에 limits 항목이 있으면 수동 처리 요망)
    const generalShop = Array.isArray(shop['일반']) ? shop['일반'] : [];
    const scissorsItemId = items.findIndex(it => it && it.name === '패션 제거 가위');
    const scissorsIndex = generalShop.findIndex(e => e && e.type === '아이템' && Number(e.item_id) === scissorsItemId);
    if (scissorsIndex >= 0) {
        const shiftedWithLimits = generalShop.slice(scissorsIndex + 1).filter(e => e && e.limits && Object.keys(e.limits).length > 0);
        if (shiftedWithLimits.length > 0) {
            // 삭제하면 뒤 항목의 유저 구매 기록/전역 카운터 인덱스가 밀리므로, 대신 구매 제한 0으로 품절 처리
            generalShop[scissorsIndex].limits = { max: 0 };
            console.log(`[Shop] '일반' 상점 ${scissorsIndex + 1}번(가위): 뒤에 구매 제한 항목이 있어 삭제 대신 limits={max:0}(품절)로 판매 종료`);
        } else {
            generalShop.splice(scissorsIndex, 1);
            console.log(`[Shop] '일반' 상점에서 패션 제거 가위(${scissorsIndex + 1}번) 판매 종료`);
        }
    } else {
        console.log('[Shop] 일반 상점에 가위 항목 없음 (이미 제거됨?)');
    }

    // ---------- Auction / BuyOrder ----------
    const auction = await getKey('Auction');
    if (auction) snapshot('Auction', auction);
    let auctionSkins = 0;
    ((auction && auction.items) || []).forEach(entry => {
        if (entry && entry.kind === 'card' && entry.payload && entry.payload.skin) {
            console.log(`[Auction] ${entry.id} (${entry.sellerName}) 카드 매물 skin='${entry.payload.skin}' 제거`);
            entry.payload.skin = '';
            auctionSkins++;
        }
    });
    if (auctionSkins === 0) console.log('[Auction] 스킨 붙은 카드 매물 없음');

    const buyOrder = await getKey('BuyOrder');
    if (buyOrder) snapshot('BuyOrder', buyOrder);
    let buyOrderSkins = 0;
    ((buyOrder && buyOrder.items) || []).forEach(entry => {
        if (entry && entry.kind === 'card' && entry.payload && entry.payload.skin) {
            console.log(`[BuyOrder] ${entry.id} (${entry.buyerName}) 카드 구매 등록 skin='${entry.payload.skin}' 제거`);
            delete entry.payload.skin;
            buyOrderSkins++;
        }
    });
    if (buyOrderSkins === 0) console.log('[BuyOrder] 스킨 지정 카드 구매 등록 없음');

    if (!APPLY) {
        console.log('\nDRY-RUN 종료. 반영하려면 --apply 로 다시 실행하세요.');
        return;
    }

    // ---------- 백업 후 쓰기 ----------
    Object.keys(originals).forEach(key => backup(key, originals[key]));

    await putKey('Item', items);
    await putKey('Recipe', keptRecipes);
    await putKey('Shop', shop);
    if (auction && auctionSkins > 0) await putKey('Auction', auction);
    if (buyOrder && buyOrderSkins > 0) await putKey('BuyOrder', buyOrder);

    // ---------- 검증 ----------
    const itemsAfter = await getKey('Item');
    const badUse = itemsAfter.filter(it => it && ['패션적용', '고급패션적용', '패션제거'].includes(it.use)).length;
    const recipesAfter = await getKey('Recipe');
    const shopAfter = await getKey('Shop');
    console.log('\n=== 검증 ===');
    console.log(`Item 길이 ${originals.Item.length} → ${itemsAfter.length} (동일해야 함), 패션 use 잔여: ${badUse}건`);
    console.log(`Recipe ${originals.Recipe.length} → ${recipesAfter.length}개`);
    console.log(`Shop '아바타' ${Array.isArray(shopAfter['아바타']) ? shopAfter['아바타'].length : 0}종 / '일반' ${(shopAfter['일반'] || []).length}개`);
    console.log(`백업: ${BACKUP_DIR}`);
    console.log('완료. 서버를 재시작해야 캐시에 반영됩니다.');
})().catch(e => { console.error(e); process.exit(1); });
