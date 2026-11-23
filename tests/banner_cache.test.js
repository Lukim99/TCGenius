'use strict';

const { test, before, after, mock } = require('node:test');
const assert = require('node:assert/strict');
const AWS = require('aws-sdk');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
const sandbox = require('../scripts/paradise-lab/sandbox');
const { rpg } = sandbox;
let base, cookie, dbReads = 0, s3Reads = 0, offset = 0, imageGate = null, imageStarted = null, failImage = false;
const realNow = Date.now;
const image = Buffer.from('isolated banner bytes');
const banners = ['one', 'retry', 'deleted'].map(id => ({ id, key: 'tcgenius/banners/' + id + '.png', contentType: 'image/png', targetTab: '' }));
async function request(path, options = {}) {
    return fetch(base + path, { ...options, headers: { Cookie: cookie || '', ...options.headers } });
}

before(async () => {
    base = 'http://127.0.0.1:' + await sandbox.start();
    const user = await rpg.getRPGUserByName(sandbox.account.name);
    user.isAdmin = true; await user.save();
    const login = await request('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: sandbox.account.name, code: 'LAB' }) });
    assert.equal(login.status, 200); cookie = login.headers.get('set-cookie').split(';')[0];
    await rpg.saveRpgeniusDataEntry('Banner', banners);
    const send = DynamoDBDocumentClient.prototype.send;
    mock.method(DynamoDBDocumentClient.prototype, 'send', async function(command) {
        if (command.constructor.name === 'GetCommand' && command.input.TableName === 'rpgenius_data' && command.input.Key.key === 'Banner') dbReads++;
        return send.call(this, command);
    });
    mock.method(Date, 'now', () => realNow() + offset);
    mock.method(AWS.S3.prototype, 'makeRequest', function(operation) {
        if (operation === 'getObject') return { promise: async () => {
            s3Reads++; imageStarted?.();
            if (imageGate) await imageGate;
            if (failImage) throw Object.assign(new Error('isolated missing banner'), { name: 'NoSuchKey' });
            return { Body: image, ContentType: 'image/png' };
        } };
        if (operation === 'deleteObject' || operation === 'putObject') return { promise: async () => ({}) };
        throw new Error('Unexpected isolated S3 operation: ' + operation);
    });
});
after(() => sandbox.close());

test('동시 배너 요청은 DB 읽기와 S3 다운로드를 각각 한 번만 수행한다', async () => {
    let release, started;
    imageGate = new Promise(resolve => { release = resolve; });
    const seen = new Promise(resolve => { started = resolve; }); imageStarted = started;
    const requests = Array.from({ length: 10 }, () => request('/api/banners/one/image'));
    await seen; release();
    const responses = await Promise.all(requests);
    for (const response of responses) {
        assert.equal(response.status, 200);
        assert.deepEqual(Buffer.from(await response.arrayBuffer()), image);
    }
    imageGate = imageStarted = null;
    assert.equal(dbReads, 1); assert.equal(s3Reads, 1);
    const conditional = await request('/api/banners/one/image', { headers: { 'If-None-Match': '"bn-one"' } });
    assert.equal(conditional.status, 304);
    assert.equal(dbReads, 1); assert.equal(s3Reads, 1);
});

test('30초 후 목록을 한 번 갱신하고 이미 받은 이미지는 S3에서 다시 받지 않는다', async () => {
    offset += 31000;
    const responses = await Promise.all(Array.from({ length: 10 }, () => request('/api/banners/one/image')));
    assert.ok(responses.every(response => response.status === 200));
    assert.equal(dbReads, 2); assert.equal(s3Reads, 1);
});

test('다운로드 실패는 캐시하지 않아 다음 요청에서 정상 재시도한다', async () => {
    failImage = true;
    assert.equal((await request('/api/banners/retry/image')).status, 404);
    failImage = false;
    assert.equal((await request('/api/banners/retry/image')).status, 200);
    assert.equal(s3Reads, 3);
    assert.equal((await request('/api/banners/retry/image')).status, 200);
    assert.equal(s3Reads, 3);
});

test('관리자 변경은 최신 목록을 읽고 일반 목록에도 즉시 반영한다', async () => {
    const before = dbReads;
    const result = await request('/api/admin/banners', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: banners.map(entry => ({ id: entry.id, targetTab: 'custom-url', targetUrl: '/characters' })) }) });
    assert.equal(result.status, 200, await result.text());
    assert.equal(dbReads, before + 1);
    const view = await (await request('/api/banners')).json();
    assert.ok(view.items.every(entry => entry.targetUrl === '/characters'));
    assert.equal(dbReads, before + 1);
});

test('다운로드 도중 삭제된 배너는 늦게 완료되어도 캐시에 되살아나지 않는다', async () => {
    let release;
    imageGate = new Promise(resolve => { release = resolve; });
    const started = new Promise(resolve => { imageStarted = resolve; });
    const pending = request('/api/banners/deleted/image');
    await started;
    const deleted = await request('/api/admin/banners/deleted', { method: 'DELETE' });
    assert.equal(deleted.status, 200);
    release(); await pending; imageGate = imageStarted = null;
    assert.equal((await request('/api/banners/deleted/image')).status, 404);
    // 같은 키를 테스트 DB에 다시 넣어도 삭제된 이전 요청의 바이트가 남지 않아야 한다.
    await rpg.saveRpgeniusDataEntry('Banner', banners);
    const before = s3Reads;
    assert.equal((await request('/api/banners/deleted/image')).status, 200);
    assert.equal(s3Reads, before + 1);
});

test('배너 목록이 처음 만들어져도 업로드 직후 일반 목록에 보인다', async () => {
    const send = DynamoDBDocumentClient.prototype.send;
    const missing = mock.method(DynamoDBDocumentClient.prototype, 'send', async function(command) {
        if (command.constructor.name === 'GetCommand' && command.input.TableName === 'rpgenius_data' && command.input.Key.key === 'Banner') return {};
        return send.call(this, command);
    });
    try {
        const uploaded = await request('/api/admin/banners', { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: Buffer.from('89504e470d0a1a0a00000000', 'hex') });
        assert.equal(uploaded.status, 200);
        const { item } = await uploaded.json();
        const view = await (await request('/api/banners')).json();
        assert.deepEqual(view.items.map(entry => entry.id), [item.id]);
    } finally { missing.mock.restore(); }
});
