const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { buildDcHyperlinkMemo } = require('../dc_write_utils');
const {
    DEFAULT_MODERATION_GALLERY_ID,
    DEFAULT_MODERATION_HEADTEXT,
    DEFAULT_MODERATION_POST_NO,
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
    assert.strictEqual(DEFAULT_MODERATION_GALLERY_ID, 'agent_stack');
    assert.strictEqual(DEFAULT_MODERATION_POST_NO, '6492');
    assert.strictEqual(DEFAULT_MODERATION_HEADTEXT, '130');
    assert.strictEqual(GEMINI_MODEL, 'gemini-3.1-flash-lite');
    assert.strictEqual(normalizePollInterval(undefined), 60000);
    assert.strictEqual(normalizePollInterval(1000), 60000);
    assert.strictEqual(normalizePollInterval(300000), 300000);
    assert.strictEqual(buildXPostUrl('thsottiaux', '123'), 'https://x.com/thsottiaux/status/123');
    assert.strictEqual(sanitizeSummary('"Tibo: 새 Codex 기능 공개"'), '새 Codex 기능 공개');
    assert.strictEqual(sanitizeSummary('SF 기술 개발 팀원 모집'), 'SF 기술 개발 팀 관련 소식');
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
        dcPostPassword: 'dc-password',
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
    assert.strictEqual(writes[0][0], 'ai_utilize');
    assert.strictEqual(writes[0][1], buildDcTitle('첫 소식 요약'));
    assert.strictEqual(writes[0][2], buildDcHyperlinkMemo('https://x.com/thsottiaux/status/101'));
    assert.strictEqual(writes[0][3], null);
    assert.strictEqual(writes[0][4], 'dc-password');
    assert.deepStrictEqual(writes[0][5], {
        headtext: '20',
        expectedLinkUrl: 'https://x.com/thsottiaux/status/101',
        guestNickname: 'Tibo'
    });
    assert.strictEqual(writes[1][2], buildDcHyperlinkMemo('https://x.com/thsottiaux/status/102'));
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
        dcPostPassword: 'dc-password',
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

    let moderationSnapshot = [{
        commentNo: '300',
        memberNo: '1',
        content: 'existing comment',
        links: [],
        isReply: false
    }];
    const moderationCalls = [];
    const moderationStore = createMemoryStateStore({
        version: 1,
        username: 'thsottiaux',
        userId: 'user-42',
        lastProcessedPostId: '201'
    });
    const moderationBridge = createTiboXBridge({
        logger: silentLogger,
        stateStore: moderationStore,
        adminDcId: 'admin-id',
        adminDcPassword: 'admin-password',
        fetchComments: async () => ({ success: true, comments: clone(moderationSnapshot) }),
        changePostHeadtext: async (...args) => {
            moderationCalls.push(args);
            return { success: true };
        }
    });

    assert.deepStrictEqual(await moderationBridge.runModerationOnce(), {
        status: 'initialized',
        updated: 0,
        lastSeenCommentNo: '300'
    });
    assert.strictEqual(moderationCalls.length, 0, 'Existing comments must only establish the initial cursor.');
    assert.strictEqual(moderationStore.getState().lastProcessedPostId, '201');
    assert.deepStrictEqual(moderationStore.getState().moderationMonitor.processedPostNos, []);
    assert.deepStrictEqual(moderationStore.getState().moderationMonitor.pendingPostNos, []);

    moderationSnapshot = [
        ...moderationSnapshot,
        {
            commentNo: '301',
            memberNo: '77',
            content: 'https://m.dcinside.com/board/agent_stack/7001 https://gall.dcinside.com/mgallery/board/view/?id=another_gallery&no=9001',
            links: [
                'https://gall.dcinside.com/mgallery/board/view/?id=agent_stack&no=7002',
                'https://m.dcinside.com/board/agent_stack/7001'
            ],
            isReply: false
        },
        {
            commentNo: '302',
            memberNo: '78',
            content: 'https://gall.dcinside.com/board/view/?id=agent_stack&no=7003',
            links: [],
            isReply: true,
            parentCommentNo: '301'
        }
    ];
    assert.deepStrictEqual(await moderationBridge.runModerationOnce(), {
        status: 'updated',
        updated: 3,
        postNos: ['7001', '7002', '7003'],
        lastSeenCommentNo: '302'
    });
    assert.deepStrictEqual(moderationCalls, [[
        'agent_stack',
        ['7001', '7002', '7003'],
        '130',
        'admin-id',
        'admin-password'
    ]]);
    assert.strictEqual(moderationStore.getState().moderationMonitor.lastSeenCommentNo, '302');
    assert.deepStrictEqual(
        moderationStore.getState().moderationMonitor.processedPostNos,
        ['7001', '7002', '7003']
    );

    moderationSnapshot = [
        ...moderationSnapshot,
        {
            commentNo: '303',
            memberNo: '0',
            content: 'https://m.dcinside.com/board/agent_stack/7999',
            links: [],
            isReply: false
        },
        {
            commentNo: '304',
            memberNo: '79',
            content: 'https://m.dcinside.com/board/agent_stack/7001 https://m.dcinside.com/board/agent_stack/7004',
            links: [],
            isReply: false
        }
    ];
    assert.deepStrictEqual(await moderationBridge.runModerationOnce(), {
        status: 'updated',
        updated: 1,
        postNos: ['7004'],
        lastSeenCommentNo: '304'
    });
    assert.deepStrictEqual(moderationCalls[1], [
        'agent_stack',
        ['7004'],
        '130',
        'admin-id',
        'admin-password'
    ]);
    assert.ok(!moderationStore.getState().moderationMonitor.processedPostNos.includes('7999'));
    assert.deepStrictEqual(await moderationBridge.runModerationOnce(), {
        status: 'idle',
        updated: 0,
        postNos: [],
        lastSeenCommentNo: '304'
    });
    assert.strictEqual(moderationCalls.length, 2, 'Processed posts and guest comments must never trigger another update.');

    let disabledFetches = 0;
    const disabledModerationBridge = createTiboXBridge({
        fetchComments: async () => {
            disabledFetches++;
            return { success: true, comments: [] };
        },
        changePostHeadtext: async () => ({ success: true })
    });
    assert.deepStrictEqual(await disabledModerationBridge.runModerationOnce(), {
        status: 'disabled',
        reason: 'missing_admin_credentials',
        updated: 0
    });
    assert.strictEqual(disabledFetches, 0, 'Missing admin credentials must disable only moderation without fetching comments.');

    const failedModerationStore = createMemoryStateStore({
        version: 1,
        moderationMonitor: {
            galleryId: 'agent_stack',
            postNo: '6492',
            lastSeenCommentNo: '300'
        }
    });
    const failedModerationBridge = createTiboXBridge({
        logger: silentLogger,
        stateStore: failedModerationStore,
        adminDcId: 'admin-id',
        adminDcPassword: 'admin-password',
        fetchComments: async () => ({
            success: true,
            comments: [{
                commentNo: '301',
                memberNo: '77',
                content: 'https://m.dcinside.com/board/agent_stack/7001',
                links: []
            }]
        }),
        changePostHeadtext: async () => ({ success: false, msg: 'rejected' })
    });
    await assert.rejects(
        failedModerationBridge.runModerationOnce(),
        /DC 말머리 변경 실패/
    );
    assert.strictEqual(
        failedModerationStore.getState().moderationMonitor.lastSeenCommentNo,
        '300',
        'A failed update must retain the cursor so the comment can be retried.'
    );

    const cappedPostNos = Array.from({ length: 12 }, (value, index) => String(8001 + index));
    const cappedCalls = [];
    const cappedStore = createMemoryStateStore({
        version: 1,
        moderationMonitor: {
            galleryId: 'agent_stack',
            postNo: '6492',
            lastSeenCommentNo: '300',
            processedPostNos: [],
            pendingPostNos: []
        }
    });
    const cappedBridge = createTiboXBridge({
        logger: silentLogger,
        stateStore: cappedStore,
        adminDcId: 'admin-id',
        adminDcPassword: 'admin-password',
        fetchComments: async () => ({
            success: true,
            comments: [{
                commentNo: '301',
                memberNo: '77',
                content: cappedPostNos
                    .map(postNo => `https://m.dcinside.com/board/agent_stack/${postNo}`)
                    .join(' '),
                links: []
            }]
        }),
        changePostHeadtext: async (...args) => {
            cappedCalls.push(args);
            return { success: true };
        }
    });
    assert.deepStrictEqual(await cappedBridge.runModerationOnce(), {
        status: 'updated',
        updated: 10,
        postNos: cappedPostNos.slice(0, 10),
        lastSeenCommentNo: '301'
    });
    assert.deepStrictEqual(
        cappedStore.getState().moderationMonitor.pendingPostNos,
        cappedPostNos.slice(10)
    );
    assert.deepStrictEqual(await cappedBridge.runModerationOnce(), {
        status: 'updated',
        updated: 2,
        postNos: cappedPostNos.slice(10),
        lastSeenCommentNo: '301'
    });
    assert.deepStrictEqual(await cappedBridge.runModerationOnce(), {
        status: 'idle',
        updated: 0,
        postNos: [],
        lastSeenCommentNo: '301'
    });
    assert.strictEqual(cappedCalls.length, 2);
    assert.ok(cappedCalls.every(call => call[1].length <= 10));
    assert.deepStrictEqual(cappedStore.getState().moderationMonitor.processedPostNos, cappedPostNos);
    assert.deepStrictEqual(cappedStore.getState().moderationMonitor.pendingPostNos, []);

    const mergedStore = createMemoryStateStore({
        version: 1,
        username: 'thsottiaux',
        userId: 'user-42',
        lastProcessedPostId: '201',
        moderationMonitor: {
            galleryId: 'agent_stack',
            postNo: '6492',
            lastSeenCommentNo: '300'
        }
    });
    let mergedTimelineCalls = 0;
    let mergedCommentCalls = 0;
    const mergedBridge = createTiboXBridge({
        http: {
            async get() {
                mergedTimelineCalls++;
                return { data: { meta: {} } };
            }
        },
        logger: silentLogger,
        stateStore: mergedStore,
        xBearerToken: 'x-token',
        geminiApiKey: 'gemini-key',
        dcPostPassword: 'dc-password',
        adminDcId: 'admin-id',
        adminDcPassword: 'admin-password',
        writePost: async () => ({ success: true }),
        fetchComments: async () => {
            mergedCommentCalls++;
            return { success: true, comments: [] };
        },
        changePostHeadtext: async () => ({ success: true })
    });
    assert.deepStrictEqual(await mergedBridge.runOnce(), { status: 'idle', posted: 0 });
    assert.strictEqual(mergedTimelineCalls, 1, '한 폴링 주기에서 X 타임라인을 한 번 조회해야 한다.');
    assert.strictEqual(mergedCommentCalls, 0, 'Tibo X 폴링에서 관리 댓글을 조회하면 안 된다.');

    const engineSource = fs.readFileSync(path.join(__dirname, '..', 'new_engine.js'), 'utf8');
    assert.ok(engineSource.includes("const { createDynamoStateStore, startTiboXBridge } = require('./tibo_x_bridge');"));
    assert.ok(engineSource.includes('stateStore: createDynamoStateStore(docClient)'));
    assert.ok(!engineSource.includes('fetchComments: getDcPostComments'));
    assert.ok(!engineSource.includes('writeComment: doDcWriteComment'));
    assert.ok(!engineSource.includes('changePostHeadtext: doDcChangePostHeadtext'));
    assert.ok(engineSource.includes("params.set('headtext', requestedHeadtext);"));

    const bridgeSource = fs.readFileSync(path.join(__dirname, '..', 'tibo_x_bridge.js'), 'utf8');
    assert.ok(bridgeSource.includes("const galleryId = options.galleryId || 'ai_utilize'"));
    assert.ok(bridgeSource.includes("const dcGuestNickname = options.dcGuestNickname || 'Tibo'"));
    assert.ok(bridgeSource.includes("process.env.TIBO_DC_POST_PASSWORD"));
    assert.ok(!bridgeSource.includes('process.env.TIBO_DC_ID'));
    assert.ok(bridgeSource.includes('guestNickname: dcGuestNickname'));
    assert.ok(!bridgeSource.includes('runCommentOnce'));
    assert.ok(!bridgeSource.includes('DEFAULT_COMMENT_REPLY_TEXT'));
    assert.ok(bridgeSource.includes('process.env.ADMIN_DC_ID'));
    assert.ok(bridgeSource.includes('process.env.ADMIN_DC_PW'));
    assert.ok(bridgeSource.includes('process.env.ADMIN_DC_PASSWORD'));

    console.log('tibo_x_bridge.test.js: OK');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
