'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createWebChat, WebChatError } = require('../webchat');

const alice = { id: 'user-a', name: '한글유저' };
const bob = { id: 'user-b', name: '다른유저' };

function service(options) {
    return createWebChat(Object.assign({ minIntervalMs: 0 }, options));
}

test('공용 채팅은 같은 방 구독자에게 fan-out하고 다른 방에는 보내지 않는다', () => {
    const chat = service();
    const first = [];
    const second = [];
    const otherRoom = [];
    chat.subscribe('public-1', alice, message => first.push(message));
    chat.subscribe('public-1', bob, message => second.push(message));
    chat.subscribe('public-2', bob, message => otherRoom.push(message));

    chat.sendMessage('public-1', alice, '안녕하세요');

    assert.equal(first.length, 1);
    assert.equal(second.length, 1);
    assert.equal(otherRoom.length, 0);
    assert.equal(first[0].text, '안녕하세요');
});

test('개인 채팅은 사용자별로 격리된다', () => {
    const chat = service();
    const aliceMessages = [];
    const bobMessages = [];
    chat.subscribe('me', alice, message => aliceMessages.push(message));
    chat.subscribe('me', bob, message => bobMessages.push(message));

    chat.sendMessage('me', alice, '비밀 메시지');

    assert.equal(aliceMessages.length, 1);
    assert.equal(bobMessages.length, 0);
    assert.equal(chat.history('me', bob).messages.length, 0);
    assert.equal(chat.resolveRoom('me', alice).channelId, 'web-chat:private:' + alice.id);
    assert.equal(chat.resolveRoom('public-1', alice).channelId, 'web-chat:public:1');
});

test('지속 channel shim의 sendChat, 지연 reply, sendMedia 대체가 전달된다', async () => {
    let capturedChannel;
    const chat = service({
        onChat: async (_data, channel) => {
            capturedChannel = channel;
            await new Promise(resolve => setTimeout(resolve, 10));
            await channel.sendChat('늦은 답변');
            await channel.sendMedia({});
        }
    });
    const received = [];
    chat.subscribe('public-1', alice, message => received.push(message));
    chat.sendMessage('public-1', alice, '/rpg 테스트');
    await new Promise(resolve => setTimeout(resolve, 30));

    assert.equal(chat.getChannel(chat.resolveRoom('public-1', alice)), capturedChannel);
    assert.deepEqual(received.map(message => message.text), [
        '/rpg 테스트',
        '늦은 답변',
        '이 채팅에서는 미디어 전송을 지원하지 않습니다.'
    ]);
    assert.equal(received[1].sender.type, 'bot');
});

test('VIEWMORE 투명 표식은 웹 응답에서 전체보기 본문으로 분리된다', async () => {
    const markers = ['\u200e'.repeat(500), '\u200b'.repeat(500)];
    for (const marker of markers) {
        const chat = service();
        const room = chat.resolveRoom('public-1', alice);
        const message = await chat.getChannel(room).sendChat('미리보기\n' + marker + '\n\n전체 내용');
        assert.equal(message.text, '미리보기');
        assert.equal(message.moreText, '전체 내용');
        assert.doesNotMatch(message.text + message.moreText, /[\u200b\u200e]{500,}/);
    }
});

test('방별 링버퍼와 before 기반 이전 기록을 제공한다', () => {
    const chat = service({ maxMessages: 3 });
    ['하나', '둘', '셋', '넷'].forEach(text => chat.sendMessage('public-1', alice, text));
    const latest = chat.history('public-1', alice, { limit: 3 }).messages;
    assert.deepEqual(latest.map(message => message.text), ['둘', '셋', '넷']);
    const before = chat.history('public-1', alice, { before: latest[2].id, limit: 2 }).messages;
    assert.deepEqual(before.map(message => message.text), ['둘', '셋']);
});

test('잘못된 방, 빈값, 500자 초과, 발신 속도를 거부한다', () => {
    let time = 1000;
    const chat = createWebChat({ now: () => time, minIntervalMs: 500 });
    assert.throws(() => chat.history('unknown', alice), error => error instanceof WebChatError && error.status === 404);
    assert.throws(() => chat.history('public-1', alice, { before: 'missing' }), error => error.status === 400);
    assert.throws(() => chat.sendMessage('public-1', alice, '   '), error => error.status === 400);
    assert.throws(() => chat.sendMessage('public-1', alice, '가'.repeat(501)), error => error.status === 400);
    chat.sendMessage('public-1', alice, '첫 메시지');
    time += 499;
    assert.throws(() => chat.sendMessage('public-1', alice, '너무 빠름'), error => error.status === 429);
    time += 1;
    assert.equal(chat.sendMessage('public-1', alice, '전송 가능').text, '전송 가능');
});

test('구독 cleanup 뒤에는 메시지를 받지 않는다', () => {
    const chat = service();
    const received = [];
    const cleanup = chat.subscribe('public-1', alice, message => received.push(message));
    cleanup();
    cleanup();
    chat.sendMessage('public-1', bob, '정리 후 메시지');
    assert.equal(received.length, 0);
    assert.equal(chat.__test.subscribers.size, 0);
});

test('웹 sender는 stable user id를 쓰고 resolver는 처리 시 이름으로 계정을 가져온다', async () => {
    const resolvedNames = [];
    const seenSenderIds = [];
    const queueKeys = [];
    const user = { id: alice.id, name: alice.name };
    const chat = service({
        getUserByName: async name => {
            resolvedNames.push(name);
            return user;
        },
        onChat: async (data, channel, context) => {
            seenSenderIds.push(data.getSenderInfo(channel).userId);
            queueKeys.push(context.queueKey);
            await Promise.resolve();
            const current = await context.getUser();
            await channel.sendChat(current.name + ' 계정 확인');
            return true;
        }
    });
    const replies = [];
    chat.subscribe('me', alice, message => {
        if (message.sender.type === 'bot') replies.push(message.text);
    });
    chat.sendMessage('me', alice, '/rpg 정보');
    assert.equal(resolvedNames.length, 0);
    for (let i = 0; i < 30 && !replies.length; i++) await new Promise(resolve => setTimeout(resolve, 10));

    assert.deepEqual(seenSenderIds, ['web:' + alice.id]);
    assert.deepEqual(queueKeys, ['account:' + alice.id]);
    assert.ok(resolvedNames.length >= 1);
    assert.ok(resolvedNames.every(name => name === alice.name));
    assert.deepEqual(replies, [alice.name + ' 계정 확인']);
});

test('rpgenius 웹 context와 기존 카카오 fallback seam을 정적으로 보존한다', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'rpgenius.js'), 'utf8');
    assert.match(source, /TARGET_CHANNEL_IDS\.includes\(channelId\) \|\| channelId\.startsWith\('web-chat:'\)/);
    assert.match(source, /context\.getUser \? context\.getUser\(\) : getRPGUserById\(senderId\)/);
    assert.match(source, /getRPGUserById\(senderId\)[\s\S]*'account:' \+ user\.id : 'sender:' \+ senderId/);
    assert.match(source, /enqueueUserCommand\(commandQueueKey, \(\) => handleRPGCommand\(finalData, channel, commandContext\)\)/);
    assert.match(source, /fieldQueueKeys\[user\.name\] = context\.queueKey \|\| 'sender:' \+ senderId/);
    assert.match(source, /enqueueUserCommand\(commandQueueKey, async \(\) =>[\s\S]*petShortcutCache\[senderId\] = getActivePetShortcutMap\(user\)/);
    assert.match(source, /if \(context\.isWeb\)[\s\S]*웹 로그아웃은 화면 상단의 로그아웃 버튼/);
    assert.match(source, /handleCommandQueueError\(error, channel, context, 'RPG command queue error'\)/);
});

test('SSE ready/reconnect, 조기 종료 cleanup, 클라이언트 세대 가드를 보존한다', () => {
    const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    const appSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
    assert.match(serverSource, /req\.on\('close', cleanup\);[\s\S]*await getWebChatUser\(req\)/);
    assert.match(serverSource, /if \(closed \|\| req\.destroyed \|\| res\.destroyed \|\| res\.writableEnded\) return cleanup\(\);[\s\S]*unsubscribe = webchat\.subscribe/);
    assert.match(serverSource, /unsubscribe = webchat\.subscribe[\s\S]*event: ready\\ndata: \{\}\\n\\n/);
    assert.match(serverSource, /id: ' \+ message\.id \+ '\\ndata: /);
    assert.match(appSource, /source\.addEventListener\('ready', async \(\) =>[\s\S]*history\?limit=50/);
    assert.match(appSource, /generation !== webChatGeneration \|\| messageMap !== webChatMessages/);
    assert.match(appSource, /window\.visualViewport\.addEventListener\('resize', updateWebChatViewport\)/);
    assert.match(appSource, /input\.value === text/);
    assert.match(appSource, /openWebChatFullMessage\(message, event\.currentTarget\)/);
    assert.match(appSource, /content\.textContent = parts\.join\('\\n\\n'\)/);
    assert.match(serverSource, /id="webChatFullModal" hidden/);
    assert.match(serverSource, /role="dialog" aria-modal="true"/);
    assert.match(appSource, /'aria-label': g\.label, title: g\.label/);
    assert.match(serverSource, /\.webchat-older\[hidden\],\.webchat-new\[hidden\]\{display:none\}/);
});
