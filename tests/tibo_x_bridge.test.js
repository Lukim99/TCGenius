const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
    DEFAULT_COMMENT_GALLERY_ID,
    DEFAULT_COMMENT_POST_NO,
    DEFAULT_COMMENT_REPLY_TEXT,
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
    assert.strictEqual(DEFAULT_COMMENT_GALLERY_ID, 'agent_stack');
    assert.strictEqual(DEFAULT_COMMENT_POST_NO, '5181');
    assert.strictEqual(DEFAULT_MODERATION_GALLERY_ID, 'agent_stack');
    assert.strictEqual(DEFAULT_MODERATION_POST_NO, '6492');
    assert.strictEqual(DEFAULT_MODERATION_HEADTEXT, '130');
    assert.strictEqual(DEFAULT_COMMENT_REPLY_TEXT, '테스트');
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
    assert.strictEqual(writes[0][0], 'agent_stack');
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

    const commentStore = createMemoryStateStore({
        version: 1,
        username: 'thsottiaux',
        userId: 'user-42',
        lastProcessedPostId: '201'
    });
    let commentSnapshot = [
        {
            commentNo: '19442',
            memberNo: '1',
            accountId: 'dc-id',
            content: '기존 테스트 댓글',
            isReply: false,
            parentCommentNo: null
        }
    ];
    const commentWrites = [];
    const commentBridge = createTiboXBridge({
        logger: silentLogger,
        stateStore: commentStore,
        xBearerToken: 'x-token',
        geminiApiKey: 'gemini-key',
        dcId: 'dc-id',
        dcPassword: 'dc-password',
        writePost: async () => ({ success: true }),
        fetchComments: async () => ({ success: true, comments: clone(commentSnapshot) }),
        writeComment: async (...args) => {
            commentWrites.push(args);
            return { success: true, commentNo: String(19500 + commentWrites.length) };
        }
    });

    const initializedComments = await commentBridge.runCommentOnce();
    assert.deepStrictEqual(initializedComments, {
        status: 'initialized',
        replied: 0,
        lastSeenCommentNo: '19442'
    });
    assert.strictEqual(commentWrites.length, 0, '최초 실행에서 기존 댓글에 대댓글을 달면 안 된다.');
    assert.strictEqual(commentStore.getState().lastProcessedPostId, '201', '댓글 상태 저장 시 X 상태를 보존해야 한다.');

    commentSnapshot = [
        ...commentSnapshot,
        {
            commentNo: '19443',
            memberNo: '77',
            accountId: 'visitor',
            content: '새 댓글',
            isReply: false,
            parentCommentNo: null
        },
        {
            commentNo: '19444',
            memberNo: '1',
            accountId: 'dc-id',
            content: '봇이 쓴 새 댓글',
            isReply: false,
            parentCommentNo: null
        },
        {
            commentNo: '19445',
            memberNo: '2',
            accountId: 'other-user',
            content: '다른 사람의 대댓글',
            isReply: true,
            parentCommentNo: '19443'
        }
    ];
    const repliedComments = await commentBridge.runCommentOnce();
    assert.deepStrictEqual(repliedComments, {
        status: 'replied',
        replied: 1,
        lastSeenCommentNo: '19445'
    });
    assert.deepStrictEqual(commentWrites, [[
        'agent_stack',
        '5181',
        '테스트',
        'dc-id',
        'dc-password',
        { replyToCommentNo: '19443', replyToMemberNo: '77' }
    ]]);
    assert.strictEqual(commentStore.getState().commentMonitor.lastSeenCommentNo, '19445');

    const duplicateStore = createMemoryStateStore({
        version: 1,
        username: 'thsottiaux',
        userId: 'user-42',
        lastProcessedPostId: '201',
        commentMonitor: {
            galleryId: 'agent_stack',
            postNo: '5181',
            lastSeenCommentNo: '19442'
        }
    });
    let duplicateWriteCount = 0;
    const duplicateBridge = createTiboXBridge({
        logger: silentLogger,
        stateStore: duplicateStore,
        xBearerToken: 'x-token',
        geminiApiKey: 'gemini-key',
        dcId: 'dc-id',
        dcPassword: 'dc-password',
        writePost: async () => ({ success: true }),
        fetchComments: async () => ({
            success: true,
            comments: [
                {
                    commentNo: '19443',
                    memberNo: '77',
                    accountId: 'visitor',
                    content: '새 댓글',
                    isReply: false,
                    parentCommentNo: null
                },
                {
                    commentNo: '19446',
                    memberNo: '1',
                    accountId: 'dc-id',
                    content: '테스트',
                    isReply: true,
                    parentCommentNo: '19443'
                }
            ]
        }),
        writeComment: async () => {
            duplicateWriteCount++;
            return { success: true };
        }
    });
    const duplicateResult = await duplicateBridge.runCommentOnce();
    assert.deepStrictEqual(duplicateResult, {
        status: 'idle',
        replied: 0,
        lastSeenCommentNo: '19446'
    });
    assert.strictEqual(duplicateWriteCount, 0, '상태 저장 직전 종료됐더라도 이미 달린 대댓글을 중복 작성하면 안 된다.');

    let moderationSnapshot = [{
        commentNo: '300',
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

    moderationSnapshot = [
        ...moderationSnapshot,
        {
            commentNo: '301',
            content: 'https://m.dcinside.com/board/agent_stack/7001 https://gall.dcinside.com/mgallery/board/view/?id=another_gallery&no=9001',
            links: [
                'https://gall.dcinside.com/mgallery/board/view/?id=agent_stack&no=7002',
                'https://m.dcinside.com/board/agent_stack/7001'
            ],
            isReply: false
        },
        {
            commentNo: '302',
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

    const mergedStore = createMemoryStateStore({
        version: 1,
        username: 'thsottiaux',
        userId: 'user-42',
        lastProcessedPostId: '201',
        commentMonitor: {
            galleryId: 'agent_stack',
            postNo: '5181',
            lastSeenCommentNo: '19446'
        },
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
        dcId: 'dc-id',
        dcPassword: 'dc-password',
        adminDcId: 'admin-id',
        adminDcPassword: 'admin-password',
        writePost: async () => ({ success: true }),
        fetchComments: async () => {
            mergedCommentCalls++;
            return { success: true, comments: [] };
        },
        writeComment: async () => ({ success: true }),
        changePostHeadtext: async () => ({ success: true })
    });
    assert.deepStrictEqual(await mergedBridge.runOnce(), { status: 'idle', posted: 0 });
    assert.strictEqual(mergedTimelineCalls, 1, '한 폴링 주기에서 X 타임라인을 한 번 조회해야 한다.');
    assert.strictEqual(mergedCommentCalls, 2, '같은 폴링 주기에서 대댓글 및 관리 댓글 대상을 각각 조회해야 한다.');

    const engineSource = fs.readFileSync(path.join(__dirname, '..', 'new_engine.js'), 'utf8');
    assert.ok(engineSource.includes("const { createDynamoStateStore, startTiboXBridge } = require('./tibo_x_bridge');"));
    assert.ok(engineSource.includes('stateStore: createDynamoStateStore(docClient)'));
    assert.ok(engineSource.includes('fetchComments: getDcPostComments'));
    assert.ok(engineSource.includes('writeComment: doDcWriteComment'));
    assert.ok(engineSource.includes('changePostHeadtext: doDcChangePostHeadtext'));
    assert.ok(engineSource.includes("params.set('headtext', requestedHeadtext);"));

    const bridgeSource = fs.readFileSync(path.join(__dirname, '..', 'tibo_x_bridge.js'), 'utf8');
    assert.ok(bridgeSource.includes("{ headtext: '10', ogLinkUrl: pending.url }"));
    assert.ok(bridgeSource.includes('process.env.ADMIN_DC_ID'));
    assert.ok(bridgeSource.includes('process.env.ADMIN_DC_PASSWORD'));

    console.log('tibo_x_bridge.test.js: OK');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
