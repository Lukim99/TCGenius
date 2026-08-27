const assert = require('assert');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');

const mailRecords = new Map();
let lastTransaction = null;
const recipientData = {
    _get: 1,
    id: 'mail-point-receiver-id',
    name: 'mail-point-receiver',
    point: 0,
    blessings: { divine: Date.now() + 60_000 },
    mail: [],
    inventory: { card: [], item: [], equipment: [], pet: [] },
    equipments: { weapon: null, hat: null, armor: null, pants: null, shoes: null, accessory: {}, support: null, pet: [] }
};

DynamoDBDocumentClient.prototype.send = async function (command) {
    const input = command.input || {};
    if (command.constructor.name === 'ScanCommand') {
        // 유저 캐시 부팅 스캔 — 수신자만 존재하는 테이블로 응답
        if (input.TableName === 'rpgenius_user') return { Items: [JSON.parse(JSON.stringify(recipientData))] };
        return { Items: [] };
    }
    if (command.constructor.name === 'PutCommand') {
        if (input.TableName === 'rpgenius_mail') mailRecords.set(input.Item.id, JSON.parse(JSON.stringify(input.Item)));
        return {};
    }
    if (command.constructor.name === 'GetCommand') {
        if (input.TableName === 'rpgenius_mail') return { Item: mailRecords.get(input.Key.id) };
        return {};
    }
    if (command.constructor.name === 'TransactWriteCommand') {
        lastTransaction = input.TransactItems;
        const mailPut = input.TransactItems.find(item => item.Put && item.Put.TableName === 'rpgenius_mail');
        if (mailPut) mailRecords.set(mailPut.Put.Item.id, JSON.parse(JSON.stringify(mailPut.Put.Item)));
        return {};
    }
    if (command.constructor.name === 'UpdateCommand') return {};
    throw new Error('Unexpected command: ' + command.constructor.name);
};

const rpg = require('../rpgenius');

(async () => {
    const sender = new rpg.RPGUser('mail-point-sender', 'mail-point-sender-id');
    sender.point = 100;
    const sent = await rpg.sendMail(sender, recipientData.name, '포인트', '테스트', [{ type: 'point', amount: 40 }]);
    assert.strictEqual(sent.ok, true);
    assert.strictEqual(sent.fee, 0, '포인트에는 골드/가넷 수수료를 적용하면 안 된다.');
    assert.strictEqual(sender.point, 60);
    assert.strictEqual(lastTransaction.length, 3, '발신자 차감·메일 생성·수신함 추가는 한 트랜잭션이어야 한다.');
    assert.ok(lastTransaction[0].Update.ConditionExpression.includes(':old_point'));
    const record = mailRecords.get(sent.mailId);
    assert.deepStrictEqual(record.gifts, [{ type: 'point', amount: 40 }]);

    const goldSender = new rpg.RPGUser('mail-gold-sender', 'mail-gold-sender-id');
    goldSender.gold = 1000;
    const goldSent = await rpg.sendMail(goldSender, recipientData.name, '골드', '수신자 축복 기준', [{ type: 'gold', amount: 1000 }]);
    assert.strictEqual(goldSent.ok, true);
    assert.strictEqual(goldSent.fee, 20, '메일 수수료 할인은 신성한 유생의 축복이 적용된 수신자 기준이어야 한다.');
    assert.deepStrictEqual(mailRecords.get(goldSent.mailId).gifts, [{ type: 'gold', amount: 980 }]);

    const receiver = new rpg.RPGUser(recipientData.name, recipientData.id);
    receiver.point = 0;
    receiver.mail = [{ id: sent.mailId, read: false, claimed: false, createdAt: record.createdAt }];
    const claimed = await rpg.claimMailGifts(receiver, sent.mailId);
    assert.strictEqual(claimed.ok, true);
    assert.strictEqual(receiver.point, 40);
    assert.strictEqual(receiver.mail[0].claimed, true);

    const overdrawn = new rpg.RPGUser('mail-point-overdrawn', 'mail-point-overdrawn-id');
    overdrawn.point = 100;
    const rejected = await rpg.sendMail(overdrawn, recipientData.name, '', '', [
        { type: 'point', amount: 60 },
        { type: 'point', amount: 50 }
    ]);
    assert.ok(rejected.error && rejected.error.includes('부족'));
    assert.strictEqual(overdrawn.point, 100, '합산 잔액 검증 실패 시 포인트를 차감하면 안 된다.');

    const broadcast = await rpg.sendBroadcastMail({ subject: '관리자 포인트', gifts: [{ type: 'point', amount: 25 }] });
    assert.strictEqual(broadcast.ok, true);
    assert.deepStrictEqual(mailRecords.get(broadcast.mailId).gifts, [{ type: 'point', amount: 25 }]);

    console.log('mail_point.test.js: OK');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
