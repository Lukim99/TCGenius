const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand, GetCommand, PutCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const rpg = () => require('./rpgenius');
const db = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'ap-northeast-2', credentials: { accessKeyId: process.env.AWS_ACCESS_KEY_ID, secretAccessKey: process.env.AWS_SECRET_KEY_ID } }));
let work = null, checkedWeek = null, timer = null;
const PARTICIPATION_FROM_RANK = 6;

function rewardsForRank(config, rank, participationFromRank = PARTICIPATION_FROM_RANK) {
    return [...(config.ranks.find(r => rank >= r.from && rank <= r.to)?.rewards || []), ...(rank >= participationFromRank ? config.participation : [])];
}
async function settle(date = new Date()) {
    const currentWeek = rpg().getKoreanWeekKey(date), config = rpg().getDataCache('Paradise', null)?.weeklyRewards;
    if (!config || checkedWeek === currentWeek) return;
    const users = []; let cursor;
    do {
        const page = await db.send(new ScanCommand({ TableName: 'rpgenius_user', ConsistentRead: true,
            ProjectionExpression: 'id, #name, paradiseWeekly, paradiseWeeklyHistory', ExpressionAttributeNames: { '#name': 'name' }, ...(cursor ? { ExclusiveStartKey: cursor } : {}) }));
        users.push(...(page.Items || [])); cursor = page.LastEvaluatedKey;
    } while (cursor);
    const weeks = new Map();
    for (const user of users) {
        const records = { ...user.paradiseWeeklyHistory, ...(user.paradiseWeekly?.week ? { [user.paradiseWeekly.week]: user.paradiseWeekly } : {}) };
        for (const [week, record] of Object.entries(records)) {
            if (week >= currentWeek || !(record.bestFloor > 0)) continue;
            if (!weeks.has(week)) weeks.set(week, []);
            weeks.get(week).push({ id: user.id, name: user.name, floor: record.bestFloor, reachedAt: record.reachedAt });
        }
    }
    for (const week of [...weeks.keys()].sort()) {
        const key = 'ParadiseSettlement:' + week;
        let snapshot = (await db.send(new GetCommand({ TableName: 'rpgenius_data', Key: { key }, ConsistentRead: true }))).Item?.data;
        if (snapshot?.completedAt) continue;
        if (!snapshot) {
            const ranked = weeks.get(week).sort((a, b) => b.floor - a.floor || a.reachedAt - b.reachedAt || a.name.localeCompare(b.name, 'ko'));
            snapshot = { week, createdAt: Date.now(), participationFromRank: PARTICIPATION_FROM_RANK, config: structuredClone(config), rows: ranked.map((r, index) => ({ ...r, rank: index + 1 })) };
            try { await db.send(new PutCommand({ TableName: 'rpgenius_data', Item: { key, data: snapshot }, ConditionExpression: 'attribute_not_exists(#key)', ExpressionAttributeNames: { '#key': 'key' } })); }
            catch (error) {
                if (error.name !== 'ConditionalCheckFailedException') throw error;
                snapshot = (await db.send(new GetCommand({ TableName: 'rpgenius_data', Key: { key }, ConsistentRead: true }))).Item?.data;
                if (!snapshot) throw error;
            }
        }
        const items = rpg().getDataCache('Item', []);
        // 모든 지급 항목을 먼저 확인한다. 미등록 아이템이 있으면 주차를 완료 처리하지 않고 재시도한다.
        // 이미 정산을 시작한 주차는 당시 확정한 참가상 규칙으로 재시도한다.
        const deliveries = snapshot.rows.map(row => ({ row, gifts: rewardsForRank(snapshot.config, row.rank, snapshot.participationFromRank ?? 1).map(reward => {
            if (reward.type === '가넷') return { type: 'garnet', amount: reward.count };
            const id = items.findIndex(item => item?.name === reward.name);
            if (id < 0) throw new Error('주간 회랑 보상 아이템 미등록: ' + reward.name);
            return { type: 'item', id, count: reward.count };
        }) }));
        for (const { row, gifts } of deliveries) {
            const result = await rpg().sendSystemMailToUser(row.name, { recipientId: row.id, deliveryKey: 'paradise:' + week,
                gmName: '천상의 회랑', subject: '천상의 회랑 ' + week + ' 주간 보상',
                body: `${row.floor}층 ${row.rank}위\n천상 주간 보상을 지급합니다.`, gifts });
            if (result.error) throw new Error(result.error);
        }
        await db.send(new UpdateCommand({ TableName: 'rpgenius_data', Key: { key }, UpdateExpression: 'SET #data.completedAt = :now', ExpressionAttributeNames: { '#data': 'data' }, ExpressionAttributeValues: { ':now': Date.now() } }));
    }
    checkedWeek = currentWeek;
}
function settleWeekly(date = new Date()) {
    if (work) return work;
    work = settle(date).finally(() => { work = null; });
    return work;
}
function startWeeklyRewards() {
    if (timer) return;
    const tick = () => settleWeekly().catch(error => console.error('[paradise weekly]', error.message));
    timer = setInterval(tick, 60000); timer.unref();
    setImmediate(tick);
}
module.exports = { settleWeekly, startWeeklyRewards, rewardsForRank };
