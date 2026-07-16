const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
    GEMINI_MODEL,
    buildDcTitle,
    buildXPostUrl,
    createDynamoStateStore,
    createTiboXBridge,
    fallbackSummary,
    fetchNewXPosts,
    normalizePollInterval,
    sanitizeSummary
} = require('../tibo_x_bridge');

function clone(value) {
    return value === null ? null : JSON.parse(JSON.stringify(value));
}

function createMemoryStateStore(initialState = null) {
    let state = clone(initialState);
    return {
        async load() {
            return clone(state);
        },
        async save(nextState) {
            state = clone(nextState);
        },
        getState() {
            return clone(state);
        }
    };
}

const silentLogger = {
    info() {},
    warn() {},
    error() {}
};

(async () => {
    assert.strictEqual(GEMINI_MODEL, 'gemini-3.1-flash-lite');
    assert.strictEqual(normalizePollInterval(undefined), 60000);
    assert.strictEqual(normalizePollInterval(1000), 60000);
    assert.strictEqual(normalizePollInterval(300000), 300000);
    assert.strictEqual(buildXPostUrl('thsottiaux', '123'), 'https://x.com/thsottiaux/status/123');
    assert.strictEqual(sanitizeSummary('"Tibo: 새 Codex 기능 공개"'), '새 Codex 기능 공개');
    assert.strictEqual(fallbackSummary('새 기능을 공개했습니다. 자세한 내용 https://x.com/test'), '새 기능을 공개했습니다.');
    assert.ok(buildDcTitle('🚀'.repeat(30)).length <= 40, 'UTF-16 기준으로도 DC 제목 40자를 넘으면 안 된다.');

    const pagedCalls = [];
    const pagedHttp = {
        async get(url, config) {
            pagedCalls.push({ url, params: clone(config.params) });
            if (!config.params.pagination_token) {
                return {
                    data: {
                        data: [{ id: '302', text: '두 번째' }],
                        meta: { next_token: 'page-2' }
                    }
                };
            }
            return { data: { data: [{ id: '301', text: '첫 번째' }], meta: {} } };
        }
    };
    const pagedPosts = await fetchNewXPosts(pagedHttp, 'token', 'user-1', '300');
    assert.deepStrictEqual(pagedPosts.map(post => post.id), ['301', '302']);
    assert.strictEqual(pagedCalls[0].params.since_id, '300');
    assert.strictEqual(pagedCalls[0].params.exclude, 'replies,retweets');
    assert.strictEqual(pagedCalls[0].params['tweet.fields'], 'created_at,note_tweet');
    assert.strictEqual(pagedCalls[1].params.pagination_token, 'page-2');

    const longPostHttp = {
        async get() {
            return {
                data: {
                    data: [{
                        id: '401',
                        text: '잘린 본문',
                        note_tweet: { text: '장문 게시물의 전체 본문' }
                    }],
                    meta: {}
                }
            };
        }
    };
    const longPosts = await fetchNewXPosts(longPostHttp, 'token', 'user-1', '400');
    assert.strictEqual(longPosts[0].text, '장문 게시물의 전체 본문');

    const dynamoCalls = [];
    const dynamoStore = createDynamoStateStore({
        async send(command) {
            dynamoCalls.push(command.input);
            if (dynamoCalls.length === 1) return { Item: { key: 'TiboXBridgeState', data: { cursor: '1' } } };
            return {};
        }
    });
    assert.deepStrictEqual(await dynamoStore.load(), { cursor: '1' });
    await dynamoStore.save({ cursor: '2' });
    assert.deepStrictEqual(dynamoCalls[0], {
        TableName: 'rpgenius_data',
        Key: { key: 'TiboXBridgeState' }
    });
    assert.deepStrictEqual(dynamoCalls[1], {
        TableName: 'rpgenius_data',
        Item: { key: 'TiboXBridgeState', data: { cursor: '2' } }
    });

    const stateStore = createMemoryStateStore();
    let timelineCallCount = 0;
    let geminiCallCount = 0;
    const writes = [];
    const http = {
        async get(url) {
            if (url.includes('/users/by/username/')) {
                return {
                    data: {
                        data: {
                            id: 'user-42',
                            username: 'thsottiaux',
                            most_recent_tweet_id: '100'
                        }
                    }
                };
            }

            timelineCallCount++;
            if (timelineCallCount === 1) {
                return {
                    data: {
                        data: [
                            { id: '102', text: '두 번째 새 게시물', created_at: '2026-07-16T00:01:00Z' },
                            { id: '101', text: '첫 번째 새 게시물', created_at: '2026-07-16T00:00:00Z' }
                        ],
                        meta: {}
                    }
                };
            }
            return { data: { meta: {} } };
        },
        async post(url) {
            assert.ok(url.includes('/gemini-3.1-flash-lite:generateContent'));
            geminiCallCount++;
            return {
                data: {
                    candidates: [{
                        content: {
                            parts: [{ text: geminiCallCount === 1 ? '첫 소식 요약' : '두 번째 소식 요약' }]
                        }
                    }]
                }
            };
        }
    };
    const bridge = createTiboXBridge({
        http,
        logger: silentLogger,
        stateStore,
        xBearerToken: 'x-token',
        geminiApiKey: 'gemini-key',
        dcId: 'dc-id',
        dcPassword: 'dc-password',
        now: () => '2026-07-16T00:00:00.000Z',
        writePost: async (...args) => {
            writes.push(args);
            return { success: true, postNo: String(9000 + writes.length) };
        }
    });

    const initialized = await bridge.runOnce();
    assert.strictEqual(initialized.status, 'initialized');
    assert.strictEqual(stateStore.getState().lastProcessedPostId, '100');
    assert.strictEqual(writes.length, 0, '최초 실행에서 기존 게시물을 올리면 안 된다.');

    const posted = await bridge.runOnce();
    assert.deepStrictEqual(posted, { status: 'posted', posted: 2, lastProcessedPostId: '102' });
    assert.strictEqual(writes.length, 2);
    assert.strictEqual(writes[0][0], 'thesingularity');
    assert.strictEqual(writes[0][1], buildDcTitle('첫 소식 요약'));
    assert.strictEqual(writes[0][2], 'https://x.com/thsottiaux/status/101');
    assert.strictEqual(writes[0][3], 'dc-id');
    assert.strictEqual(writes[0][4], 'dc-password');
    assert.deepStrictEqual(writes[0][5], {
        headtext: '10',
        ogLinkUrl: 'https://x.com/thsottiaux/status/101'
    });
    assert.strictEqual(writes[1][2], 'https://x.com/thsottiaux/status/102');
    assert.strictEqual(stateStore.getState().lastProcessedPostId, '102');
    assert.strictEqual(stateStore.getState().pendingPost, null);

    const idle = await bridge.runOnce();
    assert.deepStrictEqual(idle, { status: 'idle', posted: 0 });
    assert.strictEqual(writes.length, 2);

    const retryStore = createMemoryStateStore({
        version: 1,
        username: 'thsottiaux',
        userId: 'user-42',
        lastProcessedPostId: '200'
    });
    let summaryCalls = 0;
    let writeAttempts = 0;
    const retryBridge = createTiboXBridge({
        http: {
            async get() {
                return { data: { data: [{ id: '201', text: '재시도할 게시물' }], meta: {} } };
            }
        },
        logger: silentLogger,
        stateStore: retryStore,
        xBearerToken: 'x-token',
        geminiApiKey: 'gemini-key',
        dcId: 'dc-id',
        dcPassword: 'dc-password',
        summarize: async () => {
            summaryCalls++;
            return '재시도 제목';
        },
        writePost: async () => {
            writeAttempts++;
            return writeAttempts === 1
                ? { success: false, msg: '일시 오류' }
                : { success: true, postNo: '9999' };
        }
    });

    await assert.rejects(() => retryBridge.runOnce(), /DC 게시 실패/);
    assert.strictEqual(retryStore.getState().lastProcessedPostId, '200');
    assert.strictEqual(retryStore.getState().pendingPost.title, buildDcTitle('재시도 제목'));

    await retryBridge.runOnce();
    assert.strictEqual(summaryCalls, 1, '재시도 때 Gemini 요약을 다시 생성하면 안 된다.');
    assert.strictEqual(retryStore.getState().lastProcessedPostId, '201');
    assert.strictEqual(retryStore.getState().pendingPost, null);

    const engineSource = fs.readFileSync(path.join(__dirname, '..', 'new_engine.js'), 'utf8');
    assert.ok(engineSource.includes("const { createDynamoStateStore, startTiboXBridge } = require('./tibo_x_bridge');"));
    assert.ok(engineSource.includes('stateStore: createDynamoStateStore(docClient)'));
    assert.ok(engineSource.includes("params.set('headtext', requestedHeadtext);"));

    const bridgeSource = fs.readFileSync(path.join(__dirname, '..', 'tibo_x_bridge.js'), 'utf8');
    assert.ok(bridgeSource.includes("{ headtext: '10', ogLinkUrl: pending.url }"));

    console.log('tibo_x_bridge.test.js: OK');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
