const express = require('express');
const crypto = require('crypto');
const path = require('path');
const rpgenius = require('./rpgenius.js');
const partyquest = require('./partyquest.js');
partyquest.setCardImageResolver((card, user) => getCardImageUrl(card, user));
const { createWebChat } = require('./webchat.js');
const { DynamoDBClient, DescribeTableCommand, DescribeContinuousBackupsCommand, RestoreTableToPointInTimeCommand, DeleteTableCommand } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand, BatchWriteCommand } = require('@aws-sdk/lib-dynamodb');
const AWS = require('aws-sdk');
const { createClient } = require('@supabase/supabase-js');

const supabaseP = (process.env.SUPABASE_URL_P && process.env.SUPABASE_KEY_P)
    ? createClient(process.env.SUPABASE_URL_P, process.env.SUPABASE_KEY_P)
    : null;

const SESSION_SECRET = process.env.ADMIN_SESSION_SECRET || 'rpgenius-default-secret-change-me';
const SESSION_COOKIE = 'rpg_admin';
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

const fs = require('fs');

const server = express();
const webchat = createWebChat({ onChat: rpgenius.onChat, getUserByName: rpgenius.getRPGUserByName });
server.use(express.json({ limit: '5mb' }));
server.use('/static', express.static(path.join(__dirname, 'public')));
const bannerUploadBody = express.raw({ type: () => true, limit: 10 * 1024 * 1024 });

const AUCTION_NOTIFY_CHANNEL_ID = '18470462260425659';
const SEND_KAKAO_API_KEY = 'delutive-kakao-1mdk2kfe';
let kakaoClient = null;
const PITR_TABLES = {
    rpgenius_user: { key: 'id', label: '유저 데이터' },
    rpgenius_data: { key: 'key', label: '게임 데이터' }
};
const pitrJobs = {};
const dynamoClient = new DynamoDBClient({
    region: 'ap-northeast-2',
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_KEY_ID
    }
});
const dynamoDocClient = DynamoDBDocumentClient.from(dynamoClient);
const BANNER_BUCKET = process.env.S3_BANNER_BUCKET || 'eefl-image';
const BANNER_PREFIX = 'tcgenius/banners/';
const BANNER_MAX_BYTES = 10 * 1024 * 1024;
const BANNER_TYPES = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif'
};
const BANNER_TARGET_TABS = [
    { value: '', label: '이동하지 않음' },
    { value: 'custom-url', label: '커스텀 URL' },
    { value: 'chat', label: '채팅' },
    { value: 'info', label: '캐릭터 · 정보' },
    { value: 'inventory', label: '캐릭터 · 인벤토리' },
    { value: 'mail', label: '캐릭터 · 메일함' },
    { value: '캡슐', label: '콘텐츠 · 100일 캡슐' },
    { value: '[H]필드', label: '콘텐츠 · [H]필드' },
    { value: '버닝', label: '콘텐츠 · 버닝' },
    { value: '자물쇠', label: '콘텐츠 · 자물쇠' },
    { value: 'combine', label: '콘텐츠 · 조합' },
    { value: 'jobcombine', label: '콘텐츠 · 전직조합' },
    { value: 'equipment-synthesis', label: '콘텐츠 · 장비합성' },
    { value: 'dex', label: '콘텐츠 · 도감' },
    { value: '레벨보상', label: '콘텐츠 · 레벨보상' },
    { value: 'shop', label: '거래 · 상점' },
    { value: 'auction', label: '거래 · 팝니다' },
    { value: 'buyorder', label: '거래 · 삽니다' },
    { value: 'ranking', label: '커뮤니티 · 랭킹' },
    { value: 'patchnotes', label: '커뮤니티 · 패치노트' },
    { value: 'party', label: '파티퀘스트' }
];
const BANNER_TARGET_VALUES = new Set(BANNER_TARGET_TABS.map(item => item.value));
const bannerS3 = new AWS.S3({
    region: process.env.AWS_REGION || 'ap-northeast-2',
    credentials: new AWS.Credentials({
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_KEY_ID
    })
});

function setKakaoClient(client) {
    kakaoClient = client || null;
}

function sendAuctionKakaoNotice(message) {
    try {
        if (!kakaoClient || !kakaoClient.channelList) return;
        const channel = kakaoClient.channelList.get(AUCTION_NOTIFY_CHANNEL_ID);
        if (channel && typeof channel.sendChat == 'function') channel.sendChat(message);
    } catch (e) {
        console.error('auction kakao notice error:', e);
    }
}

function sendKakaoNotice(channelId, message) {
    try {
        if (!kakaoClient || !kakaoClient.channelList) return;
        const channel = kakaoClient.channelList.get(channelId);
        if (channel && typeof channel.sendChat == 'function') channel.sendChat(message);
    } catch (e) {
        console.error('kakao notice error:', e);
    }
}

const ADMIN_HTML_PATH = path.join(__dirname, 'public', 'admin.html');
const ADMIN_JS_PATH = path.join(__dirname, 'public', 'admin.js');
const APP_JS_PATH = path.join(__dirname, 'public', 'app.js');
const PARTY_JS_PATH = path.join(__dirname, 'public', 'party.js');
const CHARACTER_CARDS_PATH = path.join(__dirname, 'DB', 'RPGenius', 'CharacterCards.json');
const CARD_IMAGE_PATH = path.join(__dirname, 'DB', 'RPGenius', 'cardImage');
const ITEM_IMAGE_PATH = path.join(__dirname, 'DB', 'RPGenius', 'itemImage');

const LEVEL_REWARDS = [
    { level: 10,  items: [['황금 주머니', 5], ['5성 카드팩', 3], ['레어 장비 상자', 3]] },
    { level: 20,  items: [['황금 주머니', 5], ['6성 카드팩', 1], ['하급 고유의 보석', 1]] },
    { level: 30,  items: [['황금 주머니', 5], ['6성 카드팩', 2], ['6성 보호 카드', 1]] },
    { level: 40,  items: [['황금 주머니', 5], ['7성 카드팩', 1], ['유니크 장비 상자', 1]] },
    { level: 50,  items: [['황금 주머니', 5], ['7성 카드팩', 1], ['장비 보호권', 1]] },
    { level: 60,  items: [['황금 주머니', 5], ['7성 카드팩', 1], ['7성 보호 카드', 1]] },
    { level: 70,  items: [['황금 주머니', 5], ['8성 카드팩', 1], ['패션 적용권', 1]] },
    { level: 80,  items: [['황금 주머니', 5], ['8성 카드팩', 1], ['지니어스의 열쇠', 30]] },
    { level: 90,  items: [['황금 주머니', 5], ['8성 카드팩', 1], ['8성 보호 카드', 1]] },
    { level: 100, items: [['황금 주머니', 10], ['9성 카드팩', 1], ['캐릭터 변환석', 5]] },
    { level: 110, items: [['황금 주머니', 10], ['고유의 보석', 1], ['장비 보호권', 1]] },
    { level: 120, items: [['황금 주머니', 10], ['딜러 지렁이', 200], ['패션 상자', 10]] },
    { level: 130, items: [['황금 주머니', 10], ['익명 지렁이', 200], ['지니어스의 열쇠', 30]] },
    { level: 140, items: [['황금 주머니', 10], ['6성 카드팩', 5], ['쥬얼', 20]] },
    { level: 150, items: [['황금 주머니', 15], ['9성 카드팩', 1], ['9성 보호 카드', 1]] },
    { level: 160, items: [['황금 주머니', 15], ['7성 카드팩', 3], ['장비 보호권', 1]] },
    { level: 170, items: [['황금 주머니', 15], ['7성 카드팩', 5], ['전직 캐릭터 변환석', 3]] },
    { level: 180, items: [['황금 주머니', 15], ['8성 카드팩', 1], ['고급 장비 보호권', 1]] },
    { level: 190, items: [['황금 주머니', 15], ['8성 카드팩', 3], ['화이트 쥬얼', 20]] },
    { level: 200, items: [['황금 주머니', 20], ['제타 카드팩', 1], ['제타 캐릭터 변환석', 3], ['유니크 장비 상자', 1]] },
    { level: 210, items: [['황금 주머니', 20], ['장비 보호권', 1]], garnet: 1000 },
    { level: 220, items: [['황금 주머니', 20], ['장비 보호권', 1]], garnet: 1000 },
    { level: 230, items: [['황금 주머니', 20], ['장비 보호권', 1]], garnet: 1000 },
    { level: 240, items: [['황금 주머니', 20], ['장비 보호권', 1]], garnet: 1000 },
    { level: 250, items: [['황금 주머니', 25], ['시그마 카드팩', 1], ['시그마 캐릭터 변환석', 3]] },
    { level: 260, items: [['황금 주머니', 25], ['고급 장비 보호권', 1]], garnet: 2000 },
    { level: 270, items: [['황금 주머니', 25], ['고급 장비 보호권', 1]], garnet: 2000 },
    { level: 280, items: [['황금 주머니', 25], ['고급 장비 보호권', 1]], garnet: 2000 },
    { level: 290, items: [['황금 주머니', 25], ['고급 장비 보호권', 1]], garnet: 2000 },
    { level: 300, items: [['황금 주머니', 30], ['오메가 카드팩', 1], ['오메가 캐릭터 변환석', 3], ['축복받은 장비 보호권', 1]] },
];
// 버닝: 레벨 보상처럼 10레벨 단위(1~100) 보상. 일반(normal)과 메가(mega) 트랙. 메가는 500포인트로 해금.
const BURNING_MEGA_COST = 500;
const BURNING_REWARDS = [
    { level: 1,   normal: [['1000경험치비약', 1], ['5성 카드팩', 1]],        mega: [['1000경험치비약', 1], ['5성 전직 카드팩', 1]] },
    { level: 10,  normal: [['7500경험치비약', 1], ['6성 카드팩', 1]],        mega: [['7500경험치비약', 1], ['6성 전직 카드팩', 1]] },
    { level: 20,  normal: [['20000경험치비약', 1], ['황금 주머니', 10]],     mega: [['20000경험치비약', 1], ['황금 주머니', 30]] },
    { level: 30,  normal: [['100000경험치비약', 1], ['7성 카드팩', 1]],      mega: [['100000경험치비약', 1], ['7성 전직 카드팩', 1]] },
    { level: 40,  normal: [['300000경험치비약', 1], ['유니크 장비 상자', 1]], mega: [['300000경험치비약', 1], ['유니크 장비 상자', 1]] },
    { level: 50,  normal: [['600000경험치비약', 1], ['8성 카드팩', 1]],      mega: [['600000경험치비약', 1], ['8성 보호 카드', 1]] },
    { level: 60,  normal: [['1000000경험치비약', 1], ['유니크 장비 상자', 1]], mega: [['1000000경험치비약', 1], ['유니크 장비 상자', 1]] },
    { level: 70,  normal: [['2000000경험치비약', 1], ['장비 보호권', 1]],     mega: [['2000000경험치비약', 1], ['고급 장비 보호권', 1]] },
    { level: 80,  normal: [['4000000경험치비약', 1], ['패션 상자', 1]],       mega: [['4000000경험치비약', 1], ['패션 적용권', 1]] },
    { level: 90,  normal: [['8000000경험치비약', 1], ['캐릭터 변환석', 5]],    mega: [['8000000경험치비약', 1], ['전직 캐릭터 변환석', 5]] },
    { level: 100, normal: [['9성 카드팩', 1], ['유니크 잠재능력 주문서', 1]], normalTitle: 'burning',
                  mega:   [['9성 보호 카드', 1], ['레전더리 잠재능력 주문서', 1]], megaTitle: 'megaBurning' },
];
server.get('/static/admin.js', (req, res) => {
    const sess = getSession(req);
    if (!sess || !sess.admin) return res.status(401).end();
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.send(fs.readFileSync(ADMIN_JS_PATH, 'utf8'));
});
server.get('/static/app.js', (req, res) => {
    if (!getSession(req)) return res.status(401).end();
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.send(fs.readFileSync(APP_JS_PATH, 'utf8'));
});
server.get('/static/party.js', requirePartyQuest, (req, res) => {
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.send(fs.readFileSync(PARTY_JS_PATH, 'utf8'));
});

function sign(payload) {
    const json = JSON.stringify(payload);
    const body = Buffer.from(json, 'utf8').toString('base64url');
    const sig = crypto.createHmac('sha256', SESSION_SECRET).update(body).digest('base64url');
    return body + '.' + sig;
}

function verify(token) {
    if (!token || typeof token != 'string') return null;
    const [body, sig] = token.split('.');
    if (!body || !sig) return null;
    const expected = crypto.createHmac('sha256', SESSION_SECRET).update(body).digest('base64url');
    const a = Buffer.from(sig), b = Buffer.from(expected);
    if (a.length != b.length || !crypto.timingSafeEqual(a, b)) return null;
    try {
        const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
        if (Number(payload.exp || 0) < Date.now()) return null;
        return payload;
    } catch (e) {
        return null;
    }
}

function parseCookies(req) {
    const header = req.headers.cookie || '';
    const out = {};
    header.split(';').forEach(part => {
        const idx = part.indexOf('=');
        if (idx > 0) out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
    });
    return out;
}

function getSession(req) {
    const cookies = parseCookies(req);
    return verify(cookies[SESSION_COOKIE]);
}

function setSession(res, payload) {
    const token = sign(payload);
    res.setHeader('Set-Cookie', SESSION_COOKIE + '=' + encodeURIComponent(token) + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + Math.floor(SESSION_TTL_MS / 1000));
}

function clearSession(res) {
    res.setHeader('Set-Cookie', SESSION_COOKIE + '=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
}

// ===== 2단계 인증 (구글 OTP / TOTP, RFC 6238) — 외부 의존성 없이 crypto만 사용 =====
const B32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32Encode(buf) {
    let bits = 0, value = 0, out = '';
    for (const b of buf) {
        value = (value << 8) | b; bits += 8;
        while (bits >= 5) { out += B32_ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; }
    }
    if (bits > 0) out += B32_ALPHABET[(value << (5 - bits)) & 31];
    return out;
}
function base32Decode(str) {
    let bits = 0, value = 0; const out = [];
    for (const c of String(str).toUpperCase()) {
        const idx = B32_ALPHABET.indexOf(c);
        if (idx < 0) continue;
        value = (value << 5) | idx; bits += 5;
        if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
    }
    return Buffer.from(out);
}
function totpAt(secret, counter) {
    const msg = Buffer.alloc(8);
    msg.writeBigUInt64BE(BigInt(counter));
    const h = crypto.createHmac('sha1', base32Decode(secret)).update(msg).digest();
    const off = h[h.length - 1] & 15;
    return String((h.readUInt32BE(off) & 0x7fffffff) % 1000000).padStart(6, '0');
}
function verifyTotp(secret, token) {
    token = String(token || '').trim();
    if (!/^\d{6}$/.test(token)) return false;
    const counter = Math.floor(Date.now() / 30000);
    // ponytail: ±1스텝(30초) 허용 — 시계 오차 대응, 재사용 방지 카운터는 생략
    return [counter - 1, counter, counter + 1].some(c => totpAt(secret, c) === token);
}

function requireAdmin(req, res, next) {
    const sess = getSession(req);
    if (!sess || !sess.admin) return res.status(401).json({ error: '로그인이 필요합니다.' });
    req.session = sess;
    next();
}

function requireUser(req, res, next) {
    const sess = getSession(req);
    if (!sess || !sess.name) return res.status(401).json({ error: '로그인이 필요합니다.' });
    req.session = sess;
    next();
}

function parseBannerUpload(req, res, next) {
    bannerUploadBody(req, res, error => {
        if (!error) return next();
        if (error.type == 'entity.too.large') return res.status(413).json({ error: '배너 이미지는 10MB 이하여야 합니다.' });
        return res.status(400).json({ error: '이미지 업로드 요청을 읽을 수 없습니다.' });
    });
}

function isValidBannerImage(buffer, contentType) {
    if (!Buffer.isBuffer(buffer) || buffer.length < 4) return false;
    if (contentType == 'image/jpeg') return buffer[0] == 0xff && buffer[1] == 0xd8 && buffer[2] == 0xff;
    if (contentType == 'image/png') return buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    if (contentType == 'image/gif') return buffer.subarray(0, 6).toString('ascii') == 'GIF87a' || buffer.subarray(0, 6).toString('ascii') == 'GIF89a';
    if (contentType == 'image/webp') return buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') == 'RIFF' && buffer.subarray(8, 12).toString('ascii') == 'WEBP';
    return false;
}

function normalizeBannerList(data) {
    if (!Array.isArray(data)) return [];
    return data
        .filter(entry => entry && typeof entry.id == 'string' && typeof entry.key == 'string' && entry.key.startsWith(BANNER_PREFIX))
        .map(entry => {
            const targetUrl = normalizeBannerTargetUrl(entry.targetUrl);
            let targetTab = BANNER_TARGET_VALUES.has(entry.targetTab) ? entry.targetTab : '';
            if (targetTab == 'custom-url' && !targetUrl) targetTab = '';
            return Object.assign({}, entry, { targetTab, targetUrl });
        });
}

function normalizeBannerTargetUrl(value) {
    const url = String(value || '').trim();
    if (!url || url.length > 1000 || /[\x00-\x1f\x7f]/.test(url)) return '';
    if (/^\/(?![\\/])/.test(url)) return url;
    try {
        const parsed = new URL(url);
        if ((parsed.protocol == 'http:' || parsed.protocol == 'https:') && !parsed.username && !parsed.password) return parsed.href;
    } catch (_) {}
    return '';
}

async function loadBannerList() {
    const found = await rpgenius.loadRpgeniusDataEntry('Banner');
    if (!found) return [];
    return normalizeBannerList(rpgenius.getDataCache('Banner', []));
}

function serializeBanner(entry, admin) {
    const result = {
        id: entry.id,
        imageUrl: '/api/banners/' + encodeURIComponent(entry.id) + '/image',
        targetTab: BANNER_TARGET_VALUES.has(entry.targetTab) ? entry.targetTab : ''
    };
    if (result.targetTab == 'custom-url') result.targetUrl = normalizeBannerTargetUrl(entry.targetUrl);
    if (admin) {
        result.originalName = entry.originalName || '';
        result.contentType = entry.contentType || '';
        result.size = Number(entry.size || 0);
        result.createdAt = Number(entry.createdAt || 0);
    }
    return result;
}

async function requirePartyQuest(req, res, next) {
    const sess = getSession(req);
    if (!sess || !sess.name) {
        if (req.path === '/party') return res.redirect('/');
        return res.status(401).json({ error: '로그인이 필요합니다.' });
    }
    try {
        const user = await rpgenius.getRPGUserByName(sess.name);
        if (!user || !user.canPartyQuest) {
            if (req.path === '/party') return res.redirect('/');
            return res.status(403).json({ error: '파티 퀘스트가 활성화되지 않았습니다.' });
        }
        req.session = Object.assign({}, sess, { canPartyQuest: true });
        next();
    } catch (e) {
        console.error('party auth error:', e);
        if (req.path === '/party') return res.redirect('/');
        return res.status(500).json({ error: '서버 오류' });
    }
}

server.get('/sealed-lock', (req, res) => {
    res.redirect('/?tab=' + encodeURIComponent('자물쇠'));
});

// 외부 API: 카카오톡 채널로 메시지 발송. API Key 인증(헤더 x-api-key 또는 body.apiKey).
server.post('/send-kakao', async (req, res) => {
    const key = req.get('x-api-key') || (req.body && req.body.apiKey) || '';
    if (key !== SEND_KAKAO_API_KEY) return res.status(401).json({ error: '인증 실패: 올바르지 않은 API Key입니다.' });
    const body = req.body || {};
    const channelId = String(body.channelId || body.channelID || body.channel || '').trim();
    const message = body.content != null ? body.content : (body.message != null ? body.message : body.text);
    if (!channelId) return res.status(400).json({ error: 'channelId(채널ID)가 필요합니다.' });
    if (typeof message !== 'string' || message.trim() === '') return res.status(400).json({ error: 'content(내용)가 필요합니다.' });
    if (!kakaoClient || !kakaoClient.channelList) return res.status(503).json({ error: '카카오 봇이 아직 준비되지 않았습니다.' });
    let channel;
    try { channel = kakaoClient.channelList.get(channelId); } catch (e) { channel = null; }
    if (!channel || typeof channel.sendChat !== 'function') return res.status(404).json({ error: '채널을 찾을 수 없습니다: ' + channelId });
    try {
        await channel.sendChat(message);
        res.json({ ok: true, channelId });
    } catch (e) {
        console.error('[send-kakao] 전송 실패:', e);
        res.status(500).json({ error: '메시지 전송 실패: ' + ((e && e.message) || String(e)) });
    }
});

server.get('/', async (req, res) => {
    const sess = getSession(req);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (sess && sess.name) {
        try {
            const user = await rpgenius.getRPGUserByName(sess.name);
            return res.send(renderUserDashboard(Object.assign({}, sess, {
                admin: user ? !!user.isAdmin : !!sess.admin,
                canPartyQuest: user ? !!user.canPartyQuest : !!sess.canPartyQuest
            })));
        } catch (_) {
            return res.send(renderUserDashboard(sess));
        }
    }
    return res.send(renderLogin());
});

server.get('/mail', async (req, res) => {
    const sess = getSession(req);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (!sess || !sess.name) return res.redirect('/');
    try {
        const user = await rpgenius.getRPGUserByName(sess.name);
        return res.send(renderUserDashboard(Object.assign({}, sess, {
            admin: user ? !!user.isAdmin : !!sess.admin,
            canPartyQuest: user ? !!user.canPartyQuest : !!sess.canPartyQuest
        }), { initialPage: 'mail' }));
    } catch (_) {
        return res.send(renderUserDashboard(sess, { initialPage: 'mail' }));
    }
});

server.get('/hfield', async (req, res) => {
    const sess = getSession(req);
    if (!sess || !sess.name) return res.redirect('/');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(renderHFieldApp(sess));
});

server.get('/admin', (req, res) => {
    const sess = getSession(req);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (!sess || !sess.admin) return res.redirect('/');
    return res.send(renderAdminDashboard(sess));
});

server.get('/party', requirePartyQuest, (req, res) => {
    const sess = req.session;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(renderPartyApp(sess));
});

server.post('/api/login', async (req, res) => {
    const name = String((req.body && req.body.name) || '').trim();
    const code = String((req.body && req.body.code) || '').trim();
    const otp = String((req.body && req.body.otp) || '').trim();
    const ua = String(req.headers['user-agent'] || '').trim();
    if (!name) return res.status(400).json({ error: '닉네임을 입력해주세요.' });
    try {
        const user = await rpgenius.getRPGUserByName(name);
        if (!user) return res.status(401).json({ error: '존재하지 않는 닉네임입니다.' });
        const knownAgent = ua && Array.isArray(user.logged_in_agent) && user.logged_in_agent.includes(ua);
        if (!code && !otp) {
            if (knownAgent) {
                setSession(res, { name: user.name, admin: !!user.isAdmin, canPartyQuest: !!user.canPartyQuest, exp: Date.now() + SESSION_TTL_MS });
                return res.json({ ok: true, name: user.name });
            }
            return res.json({ needCode: true, canOtp: !!user.otpSecret });
        }
        if (code) {
            if (user.code !== code) return res.status(401).json({ error: '코드가 올바르지 않습니다.' });
            if (typeof user.changeCode == 'function') await user.changeCode();
        } else {
            // 로그인 코드 대신 OTP로 새 기기 인증
            if (!user.otpSecret || !verifyTotp(user.otpSecret, otp)) return res.status(401).json({ error: 'OTP 코드가 올바르지 않습니다.' });
        }
        const latest = await rpgenius.getRPGUserByName(name);
        if (latest && ua && !latest.logged_in_agent.includes(ua)) {
            latest.logged_in_agent.push(ua);
            await latest.save();
        }
        setSession(res, { name: user.name, admin: !!user.isAdmin, canPartyQuest: !!user.canPartyQuest, exp: Date.now() + SESSION_TTL_MS });
        res.json({ ok: true, name: user.name });
    } catch (e) {
        console.error('login error:', e);
        res.status(500).json({ error: '서버 오류' });
    }
});

server.post('/api/register', async (req, res) => {
    const name = String((req.body && req.body.name) || '').trim();
    const ua = String(req.headers['user-agent'] || '').trim();
    if (!name) return res.status(400).json({ error: '닉네임을 입력해주세요.' });
    try {
        const result = await rpgenius.webRegisterRPGUser(name, ua);
        if (result.error) return res.status(400).json({ error: result.error });
        setSession(res, { name: result.user.name, admin: false, canPartyQuest: false, exp: Date.now() + SESSION_TTL_MS });
        res.json({ ok: true, name: result.user.name });
    } catch (e) {
        console.error('register error:', e);
        res.status(500).json({ error: '서버 오류' });
    }
});

server.post('/api/logout', (req, res) => {
    clearSession(res);
    res.json({ ok: true });
});

server.get('/api/me', requireUser, (req, res) => {
    res.json({ name: req.session.name, admin: !!req.session.admin });
});

server.get('/api/otp/status', requireUser, async (req, res) => {
    try {
        const user = await rpgenius.getRPGUserByName(req.session.name);
        if (!user) return res.status(404).json({ error: '유저를 찾을 수 없습니다.' });
        res.json({ enabled: !!user.otpSecret });
    } catch (e) {
        console.error('otp status error:', e);
        res.status(500).json({ error: '서버 오류' });
    }
});

server.post('/api/otp/setup', requireUser, async (req, res) => {
    try {
        const user = await rpgenius.getRPGUserByName(req.session.name);
        if (!user) return res.status(404).json({ error: '유저를 찾을 수 없습니다.' });
        if (user.otpSecret) return res.status(400).json({ error: '이미 2단계 인증이 켜져 있습니다.' });
        const secret = base32Encode(crypto.randomBytes(20));
        user.otpPending = secret;
        await user.save();
        res.json({ secret, uri: 'otpauth://totp/RPGenius:' + encodeURIComponent(user.name) + '?secret=' + secret + '&issuer=RPGenius' });
    } catch (e) {
        console.error('otp setup error:', e);
        res.status(500).json({ error: '서버 오류' });
    }
});

server.post('/api/otp/enable', requireUser, async (req, res) => {
    try {
        const user = await rpgenius.getRPGUserByName(req.session.name);
        if (!user) return res.status(404).json({ error: '유저를 찾을 수 없습니다.' });
        if (!user.otpPending) return res.status(400).json({ error: '먼저 OTP 설정을 시작해주세요.' });
        if (!verifyTotp(user.otpPending, req.body && req.body.otp)) return res.status(400).json({ error: 'OTP 코드가 올바르지 않습니다.' });
        user.otpSecret = user.otpPending;
        delete user.otpPending;
        await user.save();
        res.json({ ok: true });
    } catch (e) {
        console.error('otp enable error:', e);
        res.status(500).json({ error: '서버 오류' });
    }
});

server.post('/api/otp/disable', requireUser, async (req, res) => {
    try {
        const user = await rpgenius.getRPGUserByName(req.session.name);
        if (!user) return res.status(404).json({ error: '유저를 찾을 수 없습니다.' });
        if (!user.otpSecret) return res.status(400).json({ error: '2단계 인증이 꺼져 있습니다.' });
        if (!verifyTotp(user.otpSecret, req.body && req.body.otp)) return res.status(400).json({ error: 'OTP 코드가 올바르지 않습니다.' });
        delete user.otpSecret;
        await user.save();
        res.json({ ok: true });
    } catch (e) {
        console.error('otp disable error:', e);
        res.status(500).json({ error: '서버 오류' });
    }
});

async function getWebChatUser(req) {
    const user = await rpgenius.getRPGUserByName(req.session.name);
    if (!user) throw Object.assign(new Error('웹 계정을 찾을 수 없습니다.'), { status: 401 });
    return { id: user.id, name: user.name };
}

function sendWebChatError(res, error) {
    const status = Number(error && error.status) || 500;
    if (status == 500) console.error('web chat error:', error);
    res.status(status).json({ error: status == 500 ? '채팅 서버 오류' : error.message });
}

server.get('/api/chat/:roomId/history', requireUser, async (req, res) => {
    try {
        const user = await getWebChatUser(req);
        res.json(webchat.history(req.params.roomId, user, { before: req.query.before, limit: req.query.limit }));
    } catch (e) {
        sendWebChatError(res, e);
    }
});

server.post('/api/chat/:roomId/message', requireUser, async (req, res) => {
    try {
        const user = await getWebChatUser(req);
        const message = webchat.sendMessage(req.params.roomId, user, req.body && req.body.text);
        res.status(202).json({ ok: true, message });
    } catch (e) {
        sendWebChatError(res, e);
    }
});

server.get('/api/chat/:roomId/stream', requireUser, async (req, res) => {
    let closed = false;
    let unsubscribe = null;
    let heartbeat = null;
    const cleanup = () => {
        if (closed) return;
        closed = true;
        if (heartbeat) clearInterval(heartbeat);
        heartbeat = null;
        if (unsubscribe) unsubscribe();
        unsubscribe = null;
    };
    req.on('close', cleanup);
    res.on('close', cleanup);
    try {
        const user = await getWebChatUser(req);
        webchat.resolveRoom(req.params.roomId, user);
        if (closed || req.destroyed || res.destroyed || res.writableEnded) return cleanup();
        res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');
        if (typeof res.flushHeaders == 'function') res.flushHeaders();
        unsubscribe = webchat.subscribe(req.params.roomId, user, message => {
            if (closed || res.destroyed || res.writableEnded) return;
            try {
                res.write('id: ' + message.id + '\ndata: ' + JSON.stringify(message) + '\n\n');
            } catch (_) {
                cleanup();
            }
        });
        if (closed || res.destroyed || res.writableEnded) return cleanup();
        res.write('event: ready\ndata: {}\n\n');
        heartbeat = setInterval(() => {
            if (closed || res.destroyed || res.writableEnded) return cleanup();
            try { res.write(': heartbeat\n\n'); } catch (_) { cleanup(); }
        }, 25000);
    } catch (e) {
        if (closed || req.destroyed || res.destroyed || res.writableEnded) return cleanup();
        if (!res.headersSent) sendWebChatError(res, e);
        else res.end();
        cleanup();
    }
});

server.get('/api/banners', requireUser, async (req, res) => {
    try {
        const banners = await loadBannerList();
        res.json({ items: banners.map(entry => serializeBanner(entry, false)) });
    } catch (e) {
        console.error('banner list error:', e);
        res.status(500).json({ error: '배너를 불러오지 못했습니다.' });
    }
});

server.get('/api/banners/:id/image', requireUser, async (req, res) => {
    try {
        const banners = await loadBannerList();
        const entry = banners.find(item => item.id == String(req.params.id));
        if (!entry) return res.status(404).end();
        const object = await bannerS3.getObject({ Bucket: BANNER_BUCKET, Key: entry.key }).promise();
        const contentType = BANNER_TYPES[entry.contentType] ? entry.contentType : (BANNER_TYPES[object.ContentType] ? object.ContentType : 'application/octet-stream');
        res.setHeader('Content-Type', contentType);
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Cache-Control', 'private, max-age=300');
        if (object.ETag) res.setHeader('ETag', object.ETag);
        if (object.ContentLength != null) res.setHeader('Content-Length', String(object.ContentLength));
        res.end(object.Body);
    } catch (e) {
        console.error('banner image error:', e);
        if (!res.headersSent) res.status(e && e.name == 'NoSuchKey' ? 404 : 500).end();
    }
});

server.get('/api/admin/banners', requireAdmin, async (req, res) => {
    try {
        const banners = await loadBannerList();
        res.json({
            items: banners.map(entry => serializeBanner(entry, true)),
            targetTabs: BANNER_TARGET_TABS
        });
    } catch (e) {
        console.error('admin banner list error:', e);
        res.status(500).json({ error: '배너를 불러오지 못했습니다.' });
    }
});

server.put('/api/admin/banners', requireAdmin, async (req, res) => {
    try {
        const items = req.body && req.body.items;
        if (!Array.isArray(items)) return res.status(400).json({ error: '저장할 배너 목록이 필요합니다.' });

        const banners = await loadBannerList();
        const byId = new Map(banners.map(entry => [entry.id, entry]));
        const requestedIds = items.map(item => item && String(item.id || ''));
        const uniqueIds = new Set(requestedIds);
        if (items.length !== banners.length || uniqueIds.size !== items.length || requestedIds.some(id => !byId.has(id))) {
            return res.status(409).json({ error: '배너 목록이 변경되었습니다. 다시 불러온 뒤 저장해 주세요.' });
        }
        const invalidTarget = items.find(item => !item || typeof item.targetTab !== 'string' || !BANNER_TARGET_VALUES.has(item.targetTab));
        if (invalidTarget) return res.status(400).json({ error: '선택할 수 없는 이동 탭이 포함되어 있습니다.' });
        const invalidUrl = items.find(item => item.targetTab == 'custom-url' && !normalizeBannerTargetUrl(item.targetUrl));
        if (invalidUrl) return res.status(400).json({ error: '커스텀 URL은 http://, https:// 또는 /로 시작하는 내부 경로를 입력해 주세요.' });

        const next = items.map(item => Object.assign({}, byId.get(String(item.id)), {
            targetTab: item.targetTab,
            targetUrl: item.targetTab == 'custom-url' ? normalizeBannerTargetUrl(item.targetUrl) : ''
        }));
        await rpgenius.saveRpgeniusDataEntry('Banner', next);
        res.json({ ok: true, items: next.map(entry => serializeBanner(entry, true)) });
    } catch (e) {
        console.error('admin banner save error:', e);
        res.status(500).json({ error: '배너 설정 저장에 실패했습니다.' });
    }
});

server.post('/api/admin/banners', requireAdmin, parseBannerUpload, async (req, res) => {
    const contentType = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    const extension = BANNER_TYPES[contentType];
    if (!extension) return res.status(400).json({ error: 'JPG, PNG, WEBP, GIF 이미지만 업로드할 수 있습니다.' });
    if (!Buffer.isBuffer(req.body) || req.body.length < 1) return res.status(400).json({ error: '이미지 파일이 비어있습니다.' });
    if (req.body.length > BANNER_MAX_BYTES) return res.status(413).json({ error: '배너 이미지는 10MB 이하여야 합니다.' });
    if (!isValidBannerImage(req.body, contentType)) return res.status(400).json({ error: '파일 내용과 이미지 형식이 일치하지 않습니다.' });

    const id = Date.now().toString(36) + '_' + crypto.randomBytes(5).toString('hex');
    const key = BANNER_PREFIX + id + '.' + extension;
    let originalName = 'banner.' + extension;
    try { originalName = decodeURIComponent(String(req.headers['x-file-name'] || originalName)); } catch (_) {}
    originalName = path.basename(originalName).replace(/[\x00-\x1f\x7f]/g, '').slice(0, 160) || ('banner.' + extension);
    const entry = { id, key, originalName, contentType, size: req.body.length, createdAt: Date.now(), targetTab: '', targetUrl: '' };

    try {
        await bannerS3.putObject({
            Bucket: BANNER_BUCKET,
            Key: key,
            Body: req.body,
            ContentType: contentType,
            CacheControl: 'private, max-age=300',
            ServerSideEncryption: 'AES256'
        }).promise();
        const banners = await loadBannerList();
        banners.push(entry);
        try {
            await rpgenius.saveRpgeniusDataEntry('Banner', banners);
        } catch (e) {
            await bannerS3.deleteObject({ Bucket: BANNER_BUCKET, Key: key }).promise().catch(() => {});
            throw e;
        }
        res.json({ ok: true, item: serializeBanner(entry, true) });
    } catch (e) {
        console.error('banner upload error:', e);
        res.status(500).json({ error: '배너 업로드에 실패했습니다.' });
    }
});

server.delete('/api/admin/banners/:id', requireAdmin, async (req, res) => {
    try {
        const banners = await loadBannerList();
        const index = banners.findIndex(entry => entry.id == String(req.params.id));
        if (index < 0) return res.status(404).json({ error: '배너를 찾을 수 없습니다.' });
        const entry = banners[index];
        const next = banners.slice();
        next.splice(index, 1);
        await rpgenius.saveRpgeniusDataEntry('Banner', next);
        await bannerS3.deleteObject({ Bucket: BANNER_BUCKET, Key: entry.key }).promise().catch(error => console.error('banner object delete error:', error));
        res.json({ ok: true });
    } catch (e) {
        console.error('banner delete error:', e);
        res.status(500).json({ error: '배너 삭제에 실패했습니다.' });
    }
});

server.get('/api/profile', requireUser, async (req, res) => {
    try {
        const user = await rpgenius.getRPGUserByName(req.session.name);
        if (!user) return res.status(404).json({ error: '유저를 찾을 수 없습니다.' });
        res.json(buildUserProfile(user));
    } catch (e) {
        console.error('profile error:', e);
        res.status(500).json({ error: '서버 오류' });
    }
});

server.get('/api/profile/:name', requireUser, async (req, res) => {
    try {
        const name = String(req.params.name || '').trim();
        if (!name) return res.status(400).json({ error: '닉네임이 비어있습니다.' });
        const user = await rpgenius.getRPGUserByName(name);
        if (!user) return res.status(404).json({ error: '유저를 찾을 수 없습니다.' });
        const profile = buildUserProfile(user);
        profile.viewerName = req.session.name;
        profile.isOwn = (user.name == req.session.name);
        res.json(profile);
    } catch (e) {
        console.error('profile-by-name error:', e);
        res.status(500).json({ error: '서버 오류' });
    }
});

server.post('/api/stat-points/buy', requireUser, async (req, res) => {
    try {
        const count = Number(req.body && req.body.count);
        if (!Number.isInteger(count) || count < 1) return res.status(400).json({ error: '구매 수량은 1 이상의 정수여야 합니다.' });
        const user = await rpgenius.getRPGUserByName(req.session.name);
        if (!user) return res.status(404).json({ error: '유저를 찾을 수 없습니다.' });
        const result = rpgenius.buyStatPoint(user, count);
        if (String(result).startsWith('❌')) return res.status(400).json({ error: String(result).replace(/^❌\s*/, '') });
        await user.save();
        res.json({ ok: true, message: result, profile: buildUserProfile(user) });
    } catch (e) {
        console.error('stat point buy error:', e);
        res.status(500).json({ error: '서버 오류' });
    }
});

server.post('/api/stat-points/invest', requireUser, async (req, res) => {
    try {
        const stat = String((req.body && req.body.stat) || '').trim();
        const count = Number(req.body && req.body.count);
        if (!stat) return res.status(400).json({ error: '투자할 능력치를 선택해주세요.' });
        if (!Number.isInteger(count) || count < 1) return res.status(400).json({ error: '투자 수량은 1 이상의 정수여야 합니다.' });
        const user = await rpgenius.getRPGUserByName(req.session.name);
        if (!user) return res.status(404).json({ error: '유저를 찾을 수 없습니다.' });
        const result = rpgenius.investStatPoint(user, stat, count);
        if (String(result).startsWith('❌')) return res.status(400).json({ error: String(result).replace(/^❌\s*/, '') });
        await user.save();
        res.json({ ok: true, message: result, profile: buildUserProfile(user) });
    } catch (e) {
        console.error('stat point invest error:', e);
        res.status(500).json({ error: '서버 오류' });
    }
});

server.post('/api/stat-points/reset', requireUser, async (req, res) => {
    try {
        const user = await rpgenius.getRPGUserByName(req.session.name);
        if (!user) return res.status(404).json({ error: '유저를 찾을 수 없습니다.' });
        const info = rpgenius.getStatPointInfo(user);
        if (!info.stats.some(stat => Number(stat.invested || 0) > 0)) return res.status(400).json({ error: '초기화할 투자 스탯이 없습니다.' });
        const result = await rpgenius.useItem(user, '순백의 결정', 1);
        if (String(result).startsWith('❌')) return res.status(400).json({ error: String(result).replace(/^❌\s*/, '') });
        res.json({ ok: true, message: result, profile: buildUserProfile(user) });
    } catch (e) {
        console.error('stat point reset error:', e);
        res.status(500).json({ error: '서버 오류' });
    }
});

// ===== 메일함 =====
// 선물 표시객체에 아이콘 URL을 채운다(rpgenius 모듈엔 이미지 헬퍼가 없어 서버에서 후처리)
function attachMailGiftIcons(g) {
    if (!g || !g.type) return g;
    if (g.type === 'gold') g.iconUrl = getItemImageUrl('화폐', '골드.png');
    else if (g.type === 'garnet') g.iconUrl = getItemImageUrl('화폐', '가넷.png');
    else if (g.type === 'point') g.iconUrl = getItemImageUrl('화폐', '포인트.png');
    else if (g.type === 'item') {
        const items = rpgenius.getDataCache('Item', []);
        const a = getItemDisplayAssets(items[g.id]);
        g.iconUrl = a.iconUrl; g.frameUrl = a.frameUrl;
    } else if (g.type === 'equipment') {
        const eq = rpgenius.getDataCache('Equipment', {});
        const data = eq[g.equipType] && eq[g.equipType][g.equipId];
        if (data) { g.iconUrl = getEquipmentIconUrl(data); g.frameUrl = getAuctionFrameUrl('equipment', data.rarity); }
        else g.frameUrl = getAuctionFrameUrl('equipment', g.rarity);
    } else if (g.type === 'pet') {
        const pets = rpgenius.getDataCache('Pet', []);
        const data = pets[g.petId];
        if (data) { g.iconUrl = getPetIconUrl(data); g.frameUrl = getAuctionFrameUrl('equipment', data.rarity); }
    } else if (g.type === 'card') {
        g.iconUrl = getCardImageUrl({ id: g.cardId, star: g.star, type: g.cardType }, { prestige: false, jobPrestige: false });
    } else if (g.type === 'title') {
        g.iconUrl = rpgenius.getTitleImageUrl(g.name);
    }
    return g;
}

server.get('/api/mail', requireUser, async (req, res) => {
    try {
        const user = await rpgenius.getRPGUserByName(req.session.name);
        if (!user) return res.status(404).json({ error: '유저를 찾을 수 없습니다.' });
        const box = await rpgenius.getMailbox(user, req.query.page);
        (box.mails || []).forEach(m => { (m.gifts || []).forEach(attachMailGiftIcons); });
        res.json(box);
    } catch (e) { console.error('mail list error:', e); res.status(500).json({ error: '서버 오류' }); }
});

server.get('/api/mail/giftable', requireUser, async (req, res) => {
    try {
        const user = await rpgenius.getRPGUserByName(req.session.name);
        if (!user) return res.status(404).json({ error: '유저를 찾을 수 없습니다.' });
        const equipment = buildInventoryEquipment(user)
            .filter(e => !e.equipped && !e.noTrade)
            .map(e => ({ number: e.number, name: e.name, rarity: e.rarity, level: e.level, iconUrl: e.iconUrl, frameUrl: e.frameUrl }));
        const pets = buildInventoryPets(user)
            .filter(p => p.source === 'inventory' && p.tradeCount > 0 && !p.expired)
            .map(p => ({ index: p.index, name: p.name, rarity: p.rarity, level: p.level, iconUrl: p.iconUrl, frameUrl: p.frameUrl }));
        const items = buildInventoryItems(user)
            .filter(i => !i.noTrade)
            .map(i => ({ id: i.id, name: i.name, count: i.count, iconUrl: i.iconUrl, frameUrl: i.frameUrl }));
        res.json({
            gold: Number(user.gold || 0), garnet: Number(user.garnet || 0), point: Number(user.point || 0),
            goldIconUrl: getItemImageUrl('화폐', '골드.png'), garnetIconUrl: getItemImageUrl('화폐', '가넷.png'), pointIconUrl: getItemImageUrl('화폐', '포인트.png'),
            feeRate: 0.05, feeMin: 5, maxGifts: rpgenius.MAIL_GIFT_MAX, equipment, pets, items
        });
    } catch (e) { console.error('mail giftable error:', e); res.status(500).json({ error: '서버 오류' }); }
});

server.post('/api/mail/read', requireUser, async (req, res) => {
    try {
        const user = await rpgenius.getRPGUserByName(req.session.name);
        if (!user) return res.status(404).json({ error: '유저를 찾을 수 없습니다.' });
        if (rpgenius.markMailRead(user, String((req.body && req.body.id) || ''))) await user.save();
        res.json({ ok: true, unread: rpgenius.countUnreadMail(user) });
    } catch (e) { console.error('mail read error:', e); res.status(500).json({ error: '서버 오류' }); }
});

server.post('/api/mail/claim', requireUser, async (req, res) => {
    try {
        const user = await rpgenius.getRPGUserByName(req.session.name);
        if (!user) return res.status(404).json({ error: '유저를 찾을 수 없습니다.' });
        const result = await rpgenius.claimMailGifts(user, String((req.body && req.body.id) || ''));
        if (result.error) return res.status(400).json({ error: result.error });
        res.json({ ok: true, lines: result.lines || [] });
    } catch (e) { console.error('mail claim error:', e); res.status(500).json({ error: '서버 오류' }); }
});

server.post('/api/mail/send', requireUser, async (req, res) => {
    try {
        const user = await rpgenius.getRPGUserByName(req.session.name);
        if (!user) return res.status(404).json({ error: '유저를 찾을 수 없습니다.' });
        const b = req.body || {};
        const result = await rpgenius.sendMail(user, b.to, b.subject, b.body, Array.isArray(b.gifts) ? b.gifts : []);
        if (result.error) return res.status(400).json({ error: result.error });
        res.json({ ok: true, fee: result.fee || 0 });
    } catch (e) { console.error('mail send error:', e); res.status(500).json({ error: '서버 오류' }); }
});

// 관리자 전체 발송 (선물 합성·무소모·무수수료·GM 태그)
server.post('/api/admin/mail/broadcast', requireAdmin, async (req, res) => {
    try {
        const b = req.body || {};
        const result = await rpgenius.sendBroadcastMail({ subject: b.subject, body: b.body, gmName: b.gmName, gifts: Array.isArray(b.gifts) ? b.gifts : [] });
        if (result.error) return res.status(400).json({ error: result.error });
        res.json({ ok: true, recipients: result.recipients });
    } catch (e) { console.error('mail broadcast error:', e); res.status(500).json({ error: '서버 오류' }); }
});

// 관리자 개인 발송 (전체 발송과 동일한 선물 스펙, 특정 유저 1명)
server.post('/api/admin/mail/send-user', requireAdmin, async (req, res) => {
    try {
        const b = req.body || {};
        const to = String(b.to || '').trim();
        if (!to) return res.status(400).json({ error: '받는 사람을 입력해주세요.' });
        const result = await rpgenius.sendGmMailToUser(to, { subject: b.subject, body: b.body, gmName: b.gmName, gifts: Array.isArray(b.gifts) ? b.gifts : [] });
        if (result.error) return res.status(400).json({ error: result.error });
        res.json({ ok: true });
    } catch (e) { console.error('mail send-user error:', e); res.status(500).json({ error: '서버 오류' }); }
});

server.get('/api/ranking', requireUser, async (req, res) => {
    try {
        const users = await rpgenius.getAllRPGUsers();
        const rows = users.map(u => {
            const level = Number(u.level || 1);
            const exp = Number(u.exp || 0);
            let totalExp = exp;
            for (let lv = 1; lv < level; lv++) totalExp += Number(rpgenius.getMaxExpForLevel(lv) || 0);
            return {
                name: u.name,
                level,
                cp: rpgenius.calculateCombatPower(u).total,
                totalExp,
                title: buildTitleDisplay(u)
            };
        });
        const cp = rows.slice().sort((a, b) => b.cp - a.cp || b.level - a.level || a.name.localeCompare(b.name, 'ko-KR'))
            .map((r, i) => ({ rank: i + 1, name: r.name, level: r.level, value: r.cp, title: r.title }));
        const exp = rows.slice().sort((a, b) => b.totalExp - a.totalExp || a.name.localeCompare(b.name, 'ko-KR'))
            .map((r, i) => ({ rank: i + 1, name: r.name, level: r.level, value: r.totalExp, title: r.title }));
        const worldBossBase = rpgenius.getWorldBossContributionRanking();
        const infoByName = {};
        rows.forEach(r => { infoByName[r.name] = { level: r.level, title: r.title }; });
        const worldBoss = worldBossBase.map(r => ({ rank: r.rank, name: r.name, level: Number(infoByName[r.name] && infoByName[r.name].level || 1), value: r.value, title: infoByName[r.name] && infoByName[r.name].title || null }));
        const me = req.session.name;
        const myCp = cp.find(r => r.name == me) || null;
        const myExp = exp.find(r => r.name == me) || null;
        const myWorldBoss = worldBoss.find(r => r.name == me) || null;
        res.json({ cp, exp, worldBoss, total: rows.length, me: { name: me, cp: myCp, exp: myExp, worldBoss: myWorldBoss } });
    } catch (e) {
        console.error('ranking error:', e);
        res.status(500).json({ error: '서버 오류' });
    }
});

server.get('/api/dex/equipment', requireUser, (req, res) => {
    try {
        res.json(buildEquipmentDex());
    } catch (e) {
        console.error('dex error:', e);
        res.status(500).json({ error: '서버 오류' });
    }
});

server.get('/api/dex/potential', requireUser, (req, res) => {
    try {
        res.json(rpgenius.buildPotentialDex());
    } catch (e) {
        console.error('dex potential error:', e);
        res.status(500).json({ error: '서버 오류' });
    }
});

server.get('/api/titles', requireUser, async (req, res) => {
    try {
        const user = await rpgenius.getRPGUserByName(req.session.name);
        if (!user) return res.status(404).json({ error: '유저를 찾을 수 없습니다.' });
        const newly = rpgenius.checkAndUnlockTitles(user); // 진행도 동기화 + 자가 해금
        if (newly.length) await user.save();
        const unlocked = rpgenius.getUnlockedTitles(user);
        const equipped = user.equippedTitle || null;
        const prog = rpgenius.getTitleProgress(user);
        const titles = rpgenius.getTitleDefs().map(t => {
            const c = t.condition || {};
            const target = Number(c.count || 0);
            const isUnlocked = unlocked.includes(t.id);
            const current = isUnlocked ? target : Math.min(target, Number(prog[c.progressKey] || 0));
            return {
                id: t.id,
                name: t.name,
                description: t.description || '',
                statLines: dexStatLines(rpgenius.formatTitleStatLines(t)),
                imageUrl: rpgenius.getTitleImageUrl(t.name),
                unlocked: isUnlocked,
                equipped: equipped === t.id,
                progress: { current, target }
            };
        });
        res.json({ titles, equipped });
    } catch (e) {
        console.error('titles error:', e);
        res.status(500).json({ error: '서버 오류' });
    }
});

server.post('/api/titles/equip', requireUser, async (req, res) => {
    try {
        const user = await rpgenius.getRPGUserByName(req.session.name);
        if (!user) return res.status(404).json({ error: '유저를 찾을 수 없습니다.' });
        const id = req.body && req.body.id ? String(req.body.id) : null;
        if (id === null) {
            user.equippedTitle = null;
        } else {
            if (!rpgenius.getTitleById(id)) return res.status(400).json({ error: '존재하지 않는 칭호입니다.' });
            if (!rpgenius.getUnlockedTitles(user).includes(id)) return res.status(400).json({ error: '아직 획득하지 않은 칭호입니다.' });
            user.equippedTitle = id;
        }
        await user.save();
        res.json({ ok: true, equipped: user.equippedTitle || null, title: buildTitleDisplay(user) });
    } catch (e) {
        console.error('title equip error:', e);
        res.status(500).json({ error: '서버 오류' });
    }
});

server.get('/api/patchnotes', requireUser, async (req, res) => {
    try {
        const notes = await getPatchnoteList();
        const users = await rpgenius.getAllRPGUsers();
        res.json({ items: serializePatchnotes(notes, users), admin: !!req.session.admin });
    } catch (e) {
        console.error('patchnote list error:', e);
        res.status(500).json({ error: '서버 오류' });
    }
});

server.post('/api/patchnotes', requireAdmin, async (req, res) => {
    try {
        const title = String((req.body && req.body.title) || '').trim();
        const textbody = String((req.body && req.body.textbody) || '').trim();
        const inputDate = String((req.body && req.body.date) || '').trim();
        if (!title) return res.status(400).json({ error: '제목을 입력해주세요.' });
        if (!textbody) return res.status(400).json({ error: '본문을 입력해주세요.' });
        const notes = await getPatchnoteList();
        const now = new Date().toISOString();
        notes.unshift({
            id: createPatchnoteId(),
            title,
            date: inputDate || now,
            textbody,
            replies: [],
            createdAt: now,
            updatedAt: now
        });
        await savePatchnoteList(notes);
        const users = await rpgenius.getAllRPGUsers();
        res.json({ ok: true, items: serializePatchnotes(notes, users) });
    } catch (e) {
        console.error('patchnote create error:', e);
        res.status(500).json({ error: '서버 오류' });
    }
});

server.post('/api/patchnotes/:id/replies', requireUser, async (req, res) => {
    try {
        const noteId = String(req.params.id || '').trim();
        const parentId = String((req.body && req.body.parentId) || '').trim();
        const textbody = String((req.body && req.body.textbody) || '').trim();
        if (!textbody) return res.status(400).json({ error: '댓글 내용을 입력해주세요.' });
        const user = await rpgenius.getRPGUserByName(req.session.name);
        if (!user) return res.status(404).json({ error: '유저를 찾을 수 없습니다.' });
        const notes = await getPatchnoteList();
        const note = notes.find(item => item && item.id == noteId);
        if (!note) return res.status(404).json({ error: '패치노트를 찾을 수 없습니다.' });
        if (!Array.isArray(note.replies)) note.replies = [];
        const reply = {
            id: createPatchnoteId(),
            userId: String(user.id),
            textbody,
            date: new Date().toISOString(),
            replies: []
        };
        if (parentId) {
            const parent = findPatchnoteReply(note.replies, parentId);
            if (!parent) return res.status(404).json({ error: '상위 댓글을 찾을 수 없습니다.' });
            if (!Array.isArray(parent.replies)) parent.replies = [];
            parent.replies.push(reply);
        } else {
            note.replies.push(reply);
        }
        note.updatedAt = new Date().toISOString();
        await savePatchnoteList(notes);
        const users = await rpgenius.getAllRPGUsers();
        res.json({ ok: true, items: serializePatchnotes(notes, users) });
    } catch (e) {
        console.error('patchnote reply error:', e);
        res.status(500).json({ error: '서버 오류' });
    }
});

server.get('/api/inventory/:kind', requireUser, async (req, res) => {
    try {
        const user = await rpgenius.getRPGUserByName(req.session.name);
        if (!user) return res.status(404).json({ error: '유저를 찾을 수 없습니다.' });
        const kind = String(req.params.kind || '');
        if (kind == 'items') return res.json({ items: buildInventoryItems(user) });
        if (kind == 'cards') return res.json({ cards: buildInventoryCards(user) });
        if (kind == 'equipment') return res.json({ equipment: buildInventoryEquipment(user) });
        if (kind == 'pet') return res.json({ pet: buildInventoryPets(user) });
        return res.status(400).json({ error: '알 수 없는 인벤토리 종류입니다.' });
    } catch (e) {
        console.error('inventory error:', e);
        res.status(500).json({ error: '서버 오류' });
    }
});

server.get('/api/inventory/items/:id/detail', requireUser, (req, res) => {
    const itemId = Number(req.params.id);
    const items = rpgenius.getDataCache('Item', []);
    if (!Number.isInteger(itemId) || itemId < 0 || !items[itemId]) {
        return res.status(404).json({ error: '아이템 정보를 찾을 수 없습니다.' });
    }
    res.json({ detail: buildInventoryItemDetail(itemId, items[itemId]) });
});

server.post('/api/inventory/items/:id/use', requireUser, async (req, res) => {
    try {
        const user = await rpgenius.getRPGUserByName(req.session.name);
        if (!user) return res.status(404).json({ error: '유저를 찾을 수 없습니다.' });
        const itemId = Number(req.params.id);
        const items = rpgenius.getDataCache('Item', []);
        const item = items[itemId];
        if (!Number.isInteger(itemId) || !item) return res.status(404).json({ error: '아이템 정보를 찾을 수 없습니다.' });
        if (!isUsableInventoryItem(item)) return res.status(400).json({ error: '사용할 수 없는 아이템입니다.' });
        if (item.name === '봉인된 자물쇠') return res.status(400).json({ error: '봉인된 자물쇠는 전용 개봉 화면을 이용해주세요.' });
        if (user.pendingAction) {
            const pending = user.pendingAction.webItemUse ? decorateWebItemUsePending(rpgenius.getWebItemUsePending(user), user) : null;
            return res.status(409).json({ error: '먼저 진행 중인 작업을 완료하거나 취소해주세요.', pending });
        }
        const count = Number(req.body && req.body.count || 1);
        if (!Number.isInteger(count) || count < 1) return res.status(400).json({ error: '사용 수량을 확인해주세요.' });
        const message = await rpgenius.useItem(user, item.name, count);
        if (String(message).startsWith('❌')) return res.status(400).json({ error: String(message).replace(/^❌\s*/, '') });
        if (user.pendingAction) {
            user.pendingAction.webItemUse = true;
            await user.save();
        }
        const pending = decorateWebItemUsePending(rpgenius.getWebItemUsePending(user), user);
        res.json({ ok: true, message, pending, remainingCount: rpgenius.getInventoryItemCount(user, itemId) });
    } catch (error) {
        console.error('inventory item use error:', error);
        res.status(500).json({ error: '아이템 사용 중 오류가 발생했습니다.' });
    }
});

server.post('/api/inventory/item-use/resolve', requireUser, async (req, res) => {
    try {
        const user = await rpgenius.getRPGUserByName(req.session.name);
        if (!user) return res.status(404).json({ error: '유저를 찾을 수 없습니다.' });
        if (!user.pendingAction || user.pendingAction.webItemUse !== true) return res.status(400).json({ error: '진행 중인 아이템 사용이 없습니다.' });
        const message = rpgenius.resolveWebItemUsePending(user, req.body && req.body.choice, req.body && req.body.confirm === true);
        if (user.pendingAction) user.pendingAction.webItemUse = true;
        await user.save();
        const pending = decorateWebItemUsePending(rpgenius.getWebItemUsePending(user), user);
        if (String(message).startsWith('❌')) return res.status(400).json({ error: String(message).replace(/^❌\s*/, ''), pending });
        res.json({ ok: true, message, pending });
    } catch (error) {
        console.error('inventory item resolve error:', error);
        res.status(500).json({ error: '아이템 적용 중 오류가 발생했습니다.' });
    }
});

server.post('/api/inventory/item-use/cancel', requireUser, async (req, res) => {
    try {
        const user = await rpgenius.getRPGUserByName(req.session.name);
        if (!user) return res.status(404).json({ error: '유저를 찾을 수 없습니다.' });
        if (!user.pendingAction || user.pendingAction.webItemUse !== true) return res.json({ ok: true, message: '취소할 아이템 사용이 없습니다.' });
        const message = rpgenius.cancelWebItemUsePending(user);
        await user.save();
        res.json({ ok: true, message });
    } catch (error) {
        console.error('inventory item cancel error:', error);
        res.status(500).json({ error: '아이템 사용 취소 중 오류가 발생했습니다.' });
    }
});

server.get('/api/inventory/:kind/:name', requireUser, async (req, res) => {
    try {
        const name = String(req.params.name || '').trim();
        if (!name) return res.status(400).json({ error: '닉네임이 비어있습니다.' });
        const user = await rpgenius.getRPGUserByName(name);
        if (!user) return res.status(404).json({ error: '유저를 찾을 수 없습니다.' });
        const kind = String(req.params.kind || '');
        if (kind == 'items') return res.json({ items: buildInventoryItems(user) });
        if (kind == 'cards') return res.json({ cards: buildInventoryCards(user) });
        if (kind == 'equipment') return res.json({ equipment: buildInventoryEquipment(user) });
        if (kind == 'pet') return res.json({ pet: buildInventoryPets(user) });
        return res.status(400).json({ error: '알 수 없는 인벤토리 종류입니다.' });
    } catch (e) {
        console.error('inventory-by-name error:', e);
        res.status(500).json({ error: '서버 오류' });
    }
});

const EVENT_DICE_ITEM_NAME = '유생의 주사위';
// 유생의 주사위 이벤트 종료 시각(KST 2026-07-10 23:59). 이후 서버 차원에서 굴리기 차단.
const EVENT_DICE_END_TS = new Date('2026-07-10T23:59:00+09:00').getTime();
const EVENT_DICE_ENDED_MSG = '유생의 주사위 이벤트가 종료되었습니다.';
function isEventDiceEnded() { return Date.now() >= EVENT_DICE_END_TS; }
const EVENT_DICE_REWARDS = {
    3:  { name: '축복받은 장비 보호권', count: 1,  mult: 170 },
    4:  { name: '고급 장비 보호권',     count: 1,  mult: 60 },
    5:  { name: '고급 패션 적용권',     count: 1,  mult: 30 },
    6:  { name: '장비 보호권',          count: 1,  mult: 16 },
    7:  { name: '패션 적용권',          count: 1,  mult: 11 },
    8:  { name: '지니어스의 열쇠',      count: 10, mult: 8 },
    9:  { name: '딜러 지렁이',          count: 20, mult: 6 },
    10: { name: '화이트 쥬얼',          count: 1,  mult: 5 },
    11: { name: '화이트 쥬얼',          count: 1,  mult: 5 },
    12: { name: '익명 지렁이',          count: 20, mult: 6 },
    13: { name: '캐릭터 변환석',        count: 2,  mult: 8 },
    14: { name: '7성 카드팩',           count: 1,  mult: 11 },
    15: { name: '8성 보호 카드',        displayName: '8성 보호 카드', count: 1, mult: 16 },
    16: { name: '8성 카드팩',           count: 1,  mult: 30 },
    17: { name: '9성 카드팩',           count: 1,  mult: 60 },
    18: { name: '제타 카드팩',          count: 1,  mult: 170 }
};
const EVENT_DICE_COMBO_COUNTS = { 3: 1, 4: 3, 5: 6, 6: 10, 7: 15, 8: 21, 9: 25, 10: 27, 11: 27, 12: 25, 13: 21, 14: 15, 15: 10, 16: 6, 17: 3, 18: 1 };
const EVENT_DICE_LOG_LIMIT = 5000;
const EVENT_DICE_EDGE_SUMS = [3, 18];
const EVENT_DICE_EDGE_FLOOR = 0.000463;

function getEventDiceCeilLimit(sum) {
    const reward = EVENT_DICE_REWARDS[sum];
    const baseMult = Number(EVENT_DICE_REWARDS[3].mult || 1);
    return Math.max(1, Math.round(600 * Number(reward && reward.mult || 1) / baseMult));
}

function findItemIdByName(name) {
    const items = rpgenius.getDataCache('Item', []);
    const cachedId = items.findIndex(item => item && item.name == name);
    if (cachedId >= 0) return cachedId;
    const localItems = readJson(path.join(__dirname, 'DB', 'RPGenius', 'Item.json'), []);
    return localItems.findIndex(item => item && item.name == name);
}

function buildEventDiceRewardDisplay(sum) {
    const reward = EVENT_DICE_REWARDS[sum];
    if (!reward) return null;
    const items = rpgenius.getDataCache('Item', []);
    const itemId = findItemIdByName(reward.name);
    const data = itemId >= 0 ? items[itemId] : null;
    const assets = getItemDisplayAssets(data || { name: reward.name, type: '이벤트' });
    return {
        sum: Number(sum),
        name: reward.displayName || reward.name,
        grantName: reward.name,
        count: Number(reward.count || 1),
        mult: Number(reward.mult || 1),
        iconUrl: assets.iconUrl,
        frameUrl: assets.frameUrl
    };
}

function buildEventDiceRewardsDisplay() {
    const out = {};
    Object.keys(EVENT_DICE_REWARDS).forEach(sum => { out[sum] = buildEventDiceRewardDisplay(sum); });
    return out;
}

function weightedEventDiceSum(prediction) {
    const picked = Number(prediction);
    const sums = Object.keys(EVENT_DICE_COMBO_COUNTS).map(Number);
    const base = {};
    sums.forEach(sum => { base[sum] = EVENT_DICE_COMBO_COUNTS[sum] / 216; });
    const adjusted = Object.assign({}, base);
    const redistribute = (amount, excluded) => {
        if (amount <= 0) return;
        const targets = sums.filter(sum => !excluded.includes(sum));
        const restTotal = targets.reduce((acc, sum) => acc + base[sum], 0);
        targets.forEach(sum => { adjusted[sum] += amount * (base[sum] / restTotal); });
    };
    EVENT_DICE_EDGE_SUMS.forEach(sum => {
        const removed = Math.max(0, adjusted[sum] - EVENT_DICE_EDGE_FLOOR);
        adjusted[sum] = EVENT_DICE_EDGE_FLOOR;
        redistribute(removed, EVENT_DICE_EDGE_SUMS);
    });
    if (Number.isInteger(picked) && adjusted[picked] != null) {
        const floor = EVENT_DICE_EDGE_SUMS.includes(picked) ? EVENT_DICE_EDGE_FLOOR : 0;
        const removed = Math.min(0.01, Math.max(0, adjusted[picked] - floor));
        adjusted[picked] = Math.max(0, adjusted[picked] - removed);
        redistribute(removed, EVENT_DICE_EDGE_SUMS.concat([picked]));
    }
    const roll = Math.random();
    let acc = 0;
    for (const sum of sums) {
        acc += adjusted[sum];
        if (roll <= acc) return sum;
    }
    return 18;
}

async function getEventDiceCeilData() {
    let data = rpgenius.getDataCache('Ceil', null);
    if (!data) {
        await rpgenius.loadRpgeniusDataEntry('Ceil').catch(() => null);
        data = rpgenius.getDataCache('Ceil', null);
    }
    if (!data || typeof data != 'object') data = {};
    if (!data.EventDice || typeof data.EventDice != 'object') data.EventDice = {};
    Object.keys(EVENT_DICE_REWARDS).forEach(sum => {
        const key = String(sum);
        const value = Number(data.EventDice[key] || 0);
        data.EventDice[key] = Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
    });
    return data;
}

function randomDiceForSum(sum) {
    const combos = [];
    for (let a = 1; a <= 6; a++) {
        for (let b = 1; b <= 6; b++) {
            for (let c = 1; c <= 6; c++) {
                if (a + b + c == sum) combos.push([a, b, c]);
            }
        }
    }
    return combos[Math.floor(Math.random() * combos.length)] || [1, 1, 1];
}

function randomEventDiceLightningSum() {
    return 3 + Math.floor(Math.random() * 16);
}

async function appendEventDiceLog(record) {
    try {
        let data = rpgenius.getDataCache('Logs', null);
        if (!data) {
            await rpgenius.loadRpgeniusDataEntry('Logs');
            data = rpgenius.getDataCache('Logs', null);
        }
        if (!data || typeof data != 'object') data = {};
        if (!Array.isArray(data.eventDice)) data.eventDice = [];
        data.eventDice.unshift(Object.assign({
            id: 'dice_' + Date.now().toString(36) + '_' + crypto.randomBytes(4).toString('hex')
        }, record));
        if (data.eventDice.length > EVENT_DICE_LOG_LIMIT) data.eventDice.length = EVENT_DICE_LOG_LIMIT;
        await rpgenius.saveRpgeniusDataEntry('Logs', data);
    } catch (e) {
        console.error('[event-dice-log] 기록 실패:', e);
    }
}

server.get('/api/event/dice', requireUser, async (req, res) => {
    try {
        const user = await rpgenius.getRPGUserByName(req.session.name);
        if (!user) return res.status(404).json({ error: '유저를 찾을 수 없습니다.' });
        const diceItemId = findItemIdByName(EVENT_DICE_ITEM_NAME);
        const diceItemCount = diceItemId >= 0 ? rpgenius.getInventoryItemCount(user, diceItemId) : 0;
        res.json({ ok: true, ended: isEventDiceEnded(), diceItemName: EVENT_DICE_ITEM_NAME, diceItemCount, rewards: buildEventDiceRewardsDisplay() });
    } catch (e) {
        console.error('event dice status error:', e);
        res.status(500).json({ error: '서버 오류' });
    }
});

server.post('/api/event/dice/roll', requireUser, async (req, res) => {
    try {
        if (isEventDiceEnded()) return res.status(400).json({ error: EVENT_DICE_ENDED_MSG });
        const prediction = Number(req.body && req.body.prediction);
        if (!Number.isInteger(prediction) || prediction < 3 || prediction > 18) return res.status(400).json({ error: '합 예측을 선택해주세요.' });
        const user = await rpgenius.getRPGUserByName(req.session.name);
        if (!user) return res.status(404).json({ error: '유저를 찾을 수 없습니다.' });

        const diceItemId = findItemIdByName(EVENT_DICE_ITEM_NAME);
        if (diceItemId < 0) return res.status(500).json({ error: EVENT_DICE_ITEM_NAME + ' 아이템 데이터가 없습니다.' });
        if (rpgenius.getInventoryItemCount(user, diceItemId) < 1) return res.status(400).json({ error: EVENT_DICE_ITEM_NAME + '를 보유하고 있지 않습니다.' });

        const ceilData = await getEventDiceCeilData();
        const ceilKey = String(prediction);
        const ceilLimit = getEventDiceCeilLimit(prediction);
        let sum;
        if (Number(ceilData.EventDice[ceilKey] || 0) >= ceilLimit) {
            ceilData.EventDice[ceilKey] = 0;
            sum = prediction;
        } else {
            sum = weightedEventDiceSum(prediction);
        }
        const dice = randomDiceForSum(sum);
        const lightningSum = randomEventDiceLightningSum();
        const rewardDef = EVENT_DICE_REWARDS[sum];
        const rewardItemId = findItemIdByName(rewardDef.name);
        if (rewardItemId < 0) return res.status(500).json({ error: '보상 아이템 데이터가 없습니다: ' + rewardDef.name });
        const lightning = lightningSum == sum;
        const hit = prediction == sum;
        const rewardCount = Number(rewardDef.count || 1) * (lightning ? 2 : 1);
        if (!hit) {
            ceilData.EventDice[ceilKey] = Number(ceilData.EventDice[ceilKey] || 0) + 1;
        }

        rpgenius.removeInventoryItem(user, diceItemId, 1);
        if (hit) rpgenius.addInventoryItem(user, rewardItemId, rewardCount);
        rpgenius.cleanupInventoryItems(user);
        await user.save();
        await rpgenius.saveRpgeniusDataEntry('Ceil', ceilData);
        const reward = buildEventDiceRewardDisplay(sum);
        reward.count = rewardCount;
        await appendEventDiceLog({
            nickname: user.name,
            userId: user.id,
            time: Date.now(),
            timeIso: new Date().toISOString(),
            diceConsumed: true,
            hit,
            prediction,
            sum,
            dice,
            receivedReward: hit ? {
                name: reward.name,
                grantName: reward.grantName,
                count: rewardCount,
                lightning
            } : null,
            lightningSum
        });

        res.json({
            ok: true,
            prediction,
            dice,
            sum,
            hit,
            lightningSum,
            lightning,
            reward,
            diceItemCount: rpgenius.getInventoryItemCount(user, diceItemId)
        });
    } catch (e) {
        console.error('event dice roll error:', e);
        res.status(500).json({ error: '서버 오류' });
    }
});

// 아이템 이름+수량 → 표시용(아이콘 포함) 객체.
function buildRewardDisplay(name, count) {
    const items = rpgenius.getDataCache('Item', []);
    const id = findItemIdByName(name);
    const item = id >= 0 ? items[id] : null;
    return { name, count, iconUrl: item ? getItemIconUrl(item) : null, frameUrl: getAuctionFrameUrl('item') };
}

// ===== 100일 기념 캡슐 기계 =====
const CAPSULE100_COIN_ITEM_NAME = '100일 기념 코인';
// 2026-08-14 전체 오픈.
const CAPSULE100_ADMIN_ONLY = false;
// 순서 = 캡슐 목록 번호. 1번(보주 선택 상자)이 뽑히면 전체 재고가 초기화된다.
const CAPSULE100_PRIZES = [
    { name: '보주 선택 상자', count: 1, stock: 1 },
    { name: '[7월]만능 캐릭터 변환석', count: 1, stock: 2 },
    { name: '9성 전직 카드팩', count: 1, stock: 3 },
    { name: '9성 카드팩', count: 1, stock: 3 },
    { name: '고급 장비 보호권', count: 1, stock: 5 },
    { name: '장비 보호권', count: 1, stock: 5 },
    { name: '지니어스의 열쇠', count: 30, stock: 5 },
    { name: '유생의 강화기', count: 1, stock: 35 },
    { name: '밍플 지렁이', count: 3, stock: 125 },
    { name: '밍플 지렁이', count: 1, stock: 316 },
];
const CAPSULE100_TOTAL = CAPSULE100_PRIZES.reduce((sum, p) => sum + p.stock, 0);

function getCapsule100Remaining() {
    const state = rpgenius.getDataCache('Capsule100', null);
    const remaining = state && Array.isArray(state.remaining) ? state.remaining.map(n => Number(n) || 0) : null;
    if (!remaining || remaining.length != CAPSULE100_PRIZES.length || remaining.reduce((a, b) => a + b, 0) <= 0) {
        return CAPSULE100_PRIZES.map(p => p.stock);
    }
    return remaining;
}

function buildCapsule100Status(user) {
    const coinId = findItemIdByName(CAPSULE100_COIN_ITEM_NAME);
    const remaining = getCapsule100Remaining();
    return {
        ok: true,
        coinItemName: CAPSULE100_COIN_ITEM_NAME,
        coinIconUrl: getItemImageUrl('이벤트', CAPSULE100_COIN_ITEM_NAME + '.png'),
        coinCount: coinId >= 0 ? rpgenius.getInventoryItemCount(user, coinId) : 0,
        total: CAPSULE100_TOTAL,
        totalRemaining: remaining.reduce((a, b) => a + b, 0),
        prizes: CAPSULE100_PRIZES.map((p, i) => Object.assign(buildRewardDisplay(p.name, p.count), { stock: p.stock, remaining: remaining[i] }))
    };
}

server.get('/api/capsule100', requireUser, async (req, res) => {
    try {
        if (CAPSULE100_ADMIN_ONLY && !req.session.admin) return res.status(403).json({ error: '아직 오픈되지 않았습니다.' });
        const user = await rpgenius.getRPGUserByName(req.session.name);
        if (!user) return res.status(404).json({ error: '유저를 찾을 수 없습니다.' });
        res.json(buildCapsule100Status(user));
    } catch (e) {
        console.error('capsule100 status error:', e);
        res.status(500).json({ error: '서버 오류' });
    }
});

// 코인 N개(1~3)를 소비해 N회 뽑기. 확률은 잔여 재고 가중, 1번 당첨 시 즉시 전체 초기화.
// 뽑기 전체(유저 로드→재고 계산→저장)를 직렬화해 재고 이중 차감·동일 유저 중복 뽑기를 막는다.
// ponytail: 단일 프로세스 전제의 전역 프로미스 체인 락 — 처리량이 문제되면 DynamoDB 조건부 갱신으로 전환.
let capsule100DrawChain = Promise.resolve();
server.post('/api/capsule100/draw', requireUser, (req, res) => {
    capsule100DrawChain = capsule100DrawChain.then(() => handleCapsule100Draw(req, res));
});

async function handleCapsule100Draw(req, res) {
    try {
        if (CAPSULE100_ADMIN_ONLY && !req.session.admin) return res.status(403).json({ error: '아직 오픈되지 않았습니다.' });
        const count = Number(req.body && req.body.count);
        if (![1, 2, 3].includes(count)) return res.status(400).json({ error: '1~3회만 이용할 수 있습니다.' });
        const user = await rpgenius.getRPGUserByName(req.session.name);
        if (!user) return res.status(404).json({ error: '유저를 찾을 수 없습니다.' });
        const coinId = findItemIdByName(CAPSULE100_COIN_ITEM_NAME);
        if (coinId < 0) return res.status(500).json({ error: CAPSULE100_COIN_ITEM_NAME + ' 아이템 데이터가 없습니다.' });
        if (rpgenius.getInventoryItemCount(user, coinId) < count) return res.status(400).json({ error: CAPSULE100_COIN_ITEM_NAME + '이 부족합니다.' });
        for (const p of CAPSULE100_PRIZES) {
            if (findItemIdByName(p.name) < 0) return res.status(500).json({ error: p.name + ' 아이템 데이터가 없습니다.' });
        }

        rpgenius.removeInventoryItem(user, coinId, count);
        let remaining = getCapsule100Remaining();
        const results = [];
        let jackpot = false;
        for (let d = 0; d < count; d++) {
            const totalLeft = remaining.reduce((a, b) => a + b, 0);
            let roll = Math.floor(Math.random() * totalLeft);
            let picked = 0;
            for (let i = 0; i < remaining.length; i++) {
                roll -= remaining[i];
                if (roll < 0) { picked = i; break; }
            }
            const prize = CAPSULE100_PRIZES[picked];
            rpgenius.addInventoryItem(user, findItemIdByName(prize.name), prize.count);
            results.push(Object.assign(buildRewardDisplay(prize.name, prize.count), { number: picked + 1, jackpot: picked == 0 }));
            if (picked == 0) {
                jackpot = true;
                remaining = CAPSULE100_PRIZES.map(p => p.stock);
            } else {
                remaining[picked] -= 1;
            }
        }
        rpgenius.cleanupInventoryItems(user);
        await user.save();
        await rpgenius.saveRpgeniusDataEntry('Capsule100', { remaining });
        if (jackpot) console.log('[capsule100] 1등 당첨, 재고 초기화: ' + user.name);
        res.json(Object.assign(buildCapsule100Status(user), { results, jackpot }));
    } catch (e) {
        console.error('capsule100 draw error:', e);
        res.status(500).json({ error: '서버 오류' });
    }
}

server.get('/api/combine/cards', requireUser, async (req, res) => {
    try {
        const user = await rpgenius.getRPGUserByName(req.session.name);
        if (!user) return res.status(404).json({ error: '유저를 찾을 수 없습니다.' });
        res.json({ cards: buildCombineCards(user), meta: buildCombineMeta(user) });
    } catch (e) {
        console.error('combine cards error:', e);
        res.status(500).json({ error: '서버 오류' });
    }
});

server.get('/api/jobcombine/cards', requireUser, async (req, res) => {
    try {
        const user = await rpgenius.getRPGUserByName(req.session.name);
        if (!user) return res.status(404).json({ error: '유저를 찾을 수 없습니다.' });
        res.json({ cards: buildJobCombineCards(user), gold: Number(user.gold || 0) });
    } catch (e) {
        console.error('jobcombine cards error:', e);
        res.status(500).json({ error: '서버 오류' });
    }
});

server.post('/api/jobcombine', requireUser, async (req, res) => {
    try {
        const user = await rpgenius.getRPGUserByName(req.session.name);
        if (!user) return res.status(404).json({ error: '유저를 찾을 수 없습니다.' });
        const numbers = Array.isArray(req.body && req.body.numbers) ? req.body.numbers.map(n => Number(n)) : [];
        const selection = rpgenius.getJobCombineSelection(user, numbers);
        if (selection.error) return res.status(400).json({ error: selection.error.replace(/^❌\s*/, '') });
        user.pendingAction = { type: '전직조합', numbers: selection.numbers };
        const message = rpgenius.runJobCombine(user);
        if (typeof message == 'string' && message.startsWith('❌')) {
            user.pendingAction = null;
            return res.status(400).json({ error: message.replace(/^❌\s*/, '') });
        }
        const cardsArr = user.inventory.card;
        const resultCard = serializeCard(cardsArr[cardsArr.length - 1], user);
        await user.save();
        res.json({ ok: true, message, resultCard, cards: buildJobCombineCards(user), gold: Number(user.gold || 0), profile: buildUserProfile(user) });
    } catch (e) {
        console.error('jobcombine error:', e);
        res.status(500).json({ error: '서버 오류' });
    }
});

server.get('/api/levelrewards', requireUser, async (req, res) => {
    try {
        const user = await rpgenius.getRPGUserByName(req.session.name);
        if (!user) return res.status(404).json({ error: '유저를 찾을 수 없습니다.' });
        const items = rpgenius.getDataCache('Item', []);
        const userLevel = Number(user.level || 1);
        const claimed = new Set(Array.isArray(user.claimedLevelRewards) ? user.claimedLevelRewards : []);
        const garnetIconUrl = getItemImageUrl('화폐', '가넷.png');
        const list = LEVEL_REWARDS.map(r => ({
            level: r.level,
            claimed: claimed.has(r.level),
            unlocked: userLevel >= r.level,
            garnet: r.garnet || 0,
            garnetIconUrl,
            items: r.items.map(([name, count]) => {
                const itemData = items.find(it => it && it.name === name);
                const assets = itemData ? getItemDisplayAssets(itemData) : { iconUrl: null, frameUrl: null };
                return { name, count, iconUrl: assets.iconUrl, frameUrl: assets.frameUrl };
            }),
        }));
        res.json({ list, userLevel });
    } catch (e) {
        console.error('levelrewards error:', e);
        res.status(500).json({ error: '서버 오류' });
    }
});

server.post('/api/levelreward', requireUser, async (req, res) => {
    try {
        const user = await rpgenius.getRPGUserByName(req.session.name);
        if (!user) return res.status(404).json({ error: '유저를 찾을 수 없습니다.' });
        const level = Number(req.body && req.body.level);
        const reward = LEVEL_REWARDS.find(r => r.level === level);
        if (!reward) return res.status(400).json({ error: '존재하지 않는 보상입니다.' });
        const userLevel = Number(user.level || 1);
        if (userLevel < level) return res.status(400).json({ error: '레벨이 부족합니다.' });
        if (!Array.isArray(user.claimedLevelRewards)) user.claimedLevelRewards = [];
        if (user.claimedLevelRewards.includes(level)) return res.status(400).json({ error: '이미 수령한 보상입니다.' });
        const allItems = rpgenius.getDataCache('Item', []);
        for (const [name, count] of reward.items) {
            const itemId = allItems.findIndex(it => it && it.name === name);
            if (itemId !== -1) rpgenius.addInventoryItem(user, itemId, count);
        }
        if (reward.garnet) user.garnet = Number(user.garnet || 0) + reward.garnet;
        user.claimedLevelRewards.push(level);
        await user.save();
        res.json({ ok: true, profile: buildUserProfile(user) });
    } catch (e) {
        console.error('levelreward claim error:', e);
        res.status(500).json({ error: '서버 오류' });
    }
});

// ===== 버닝 =====
function resolveBurningItems(itemList) {
    const items = rpgenius.getDataCache('Item', []);
    return (itemList || []).map(([name, count]) => {
        const itemData = items.find(it => it && it.name === name);
        const assets = itemData ? getItemDisplayAssets(itemData) : { iconUrl: null, frameUrl: null };
        return { name, count, iconUrl: assets.iconUrl, frameUrl: assets.frameUrl };
    });
}
function buildBurningTrack(reward, track, claimedSet) {
    const titleId = track === 'mega' ? reward.megaTitle : reward.normalTitle;
    const titleDef = titleId ? rpgenius.getTitleById(titleId) : null;
    return {
        claimed: claimedSet.has(reward.level),
        items: resolveBurningItems(track === 'mega' ? reward.mega : reward.normal),
        title: titleDef ? titleDef.name : null,
        titleImageUrl: titleDef ? rpgenius.getTitleImageUrl(titleDef.name) : null
    };
}

// ===== [H]필드 =====
const H_FIELD_NAME = '부타게임[H]';
const H_FIELD_RECOVERY_TYPES = new Set(['체력회복', '마나회복', '체력회복%', '마나회복%']);

function getHFieldTicketInfo(user) {
    const items = rpgenius.getDataCache('Item', []);
    const id = items.findIndex(item => item && item.name == '헬 초대장');
    const data = id >= 0 ? items[id] : null;
    const assets = data ? getItemDisplayAssets(data) : { iconUrl: null, frameUrl: null };
    return {
        name: '헬 초대장',
        count: id >= 0 ? rpgenius.getInventoryItemCount(user, id) : 0,
        cost: rpgenius.HELL_INVITATION_COST,
        iconUrl: assets.iconUrl,
        frameUrl: assets.frameUrl
    };
}

function getHFieldRecoveryItems(user) {
    const items = rpgenius.getDataCache('Item', []);
    return buildInventoryItems(user).filter(entry => {
        const data = items[Number(entry.id)];
        return data && data.type == '소모품' && (data.use_func || []).some(func => func && H_FIELD_RECOVERY_TYPES.has(func.type));
    }).map(entry => {
        const data = items[Number(entry.id)];
        const effects = (data.use_func || []).filter(func => func && H_FIELD_RECOVERY_TYPES.has(func.type)).map(func => {
            const resource = String(func.type).startsWith('체력') ? 'HP' : 'MP';
            const amount = String(func.type).endsWith('%') ? Math.round(Number(func.amount || 0) * 100) + '%' : Number(func.amount || 0).toLocaleString('ko-KR');
            return resource + ' +' + amount;
        });
        return {
            id: Number(entry.id), name: entry.name, count: Number(entry.count || 0),
            effect: effects.join(' / '), iconUrl: entry.iconUrl, frameUrl: entry.frameUrl
        };
    });
}

function getHFieldSkills(user, mainCard) {
    const classSkills = mainCard && mainCard.type == '전직' && mainCard.classInfo ? mainCard.classInfo.skills : [];
    const entries = [].concat(mainCard && mainCard.skills || [], classSkills || []);
    const cooldowns = user.field && user.field.name == H_FIELD_NAME && user.field.skillCooldowns || {};
    const seen = new Set();
    return entries.filter(skill => {
        if (!skill || !skill.name || seen.has(skill.name)) return false;
        seen.add(skill.name);
        return true;
    }).map(skill => ({
        name: skill.name,
        mpCost: Number(skill.mpCost || 0),
        cooltimeText: skill.cooltimeText || '',
        descLines: Array.isArray(skill.descLines) ? skill.descLines : [],
        cooldownEnd: Number(cooldowns[skill.name] || 0)
    }));
}

const H_FIELD_SPRITE_EXCLUSIONS = new Set([
    '딜러장__일반__수영장 파티.png',
    '딜러장__일반__고급 수영장 파티.png',
    '딜러장__전직__고급 산타.png',
    '흠시원__일반__수영장 파티.png',
    '흠시원__일반__고급 수영장 파티.png'
]);

function getHFieldSpritePart(value) {
    return String(value || '').trim().replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
}

function getHFieldCharacterSprite(mainCard) {
    const fallback = '필드/hfield-hunter.png';
    if (!mainCard || !mainCard.name) return '/rpg-ui?file=' + encodeURIComponent(fallback);
    const name = getHFieldSpritePart(mainCard.name);
    const cardType = mainCard.type == '전직' ? '전직' : '일반';
    const skin = getHFieldSpritePart(mainCard.skin);
    const candidates = [];
    if (skin) candidates.push([name, cardType, skin].join('__') + '.png');
    if (cardType == '전직') candidates.push(name + '__전직.png');
    candidates.push(name + '.png');
    const spriteRoot = path.join(RPG_UI_PATH, '필드', '캐릭터');
    const sprite = candidates.find(file => !H_FIELD_SPRITE_EXCLUSIONS.has(file) && fs.existsSync(path.join(spriteRoot, file)));
    const selected = sprite ? path.join('필드', '캐릭터', sprite) : fallback;
    return '/rpg-ui?file=' + encodeURIComponent(selected.replace(/\\/g, '/'));
}

function buildHFieldState(user) {
    const dungeon = rpgenius.getHellDungeon();
    const stats = rpgenius.calculateUserStats(user);
    const maxHp = Number(stats.hp || 0);
    const maxMp = Number(stats.mp || 0);
    const mainCard = serializeCard(user.main_card, user);
    const ticket = getHFieldTicketInfo(user);
    const fieldName = user.field && user.field.name || null;
    const inField = fieldName == H_FIELD_NAME;
    const phase = inField ? (user.field.phase == 'pillar' ? 'pillar' : 'elite') : 'lobby';
    const bossMaxHp = Number(dungeon.elite && dungeon.elite.hp || 1);
    const targetMaxHp = phase == 'pillar' ? Number(rpgenius.HELL_PILLAR_MAX_HP) : bossMaxHp;
    const targetHp = phase == 'pillar'
        ? Number(user.field.pillarHp || targetMaxHp)
        : inField ? Number(user.field.elite && user.field.elite.hp || bossMaxHp) : bossMaxHp;
    const level = Number(user.level || 1);
    const hp = typeof user.hp == 'undefined' ? maxHp : Number(user.hp || 0);
    let entryError = null;
    if (fieldName && !inField) entryError = '현재 ' + fieldName + ' 필드에 입장 중입니다. 먼저 해당 필드에서 퇴장해주세요.';
    else if (level < Number(dungeon.requireLevel || 1)) entryError = 'Lv.' + Number(dungeon.requireLevel || 1) + ' 이상부터 입장할 수 있습니다.';
    else if (level > Number(dungeon.maxLevel || 300)) entryError = 'Lv.' + Number(dungeon.maxLevel || 300) + ' 이하만 입장할 수 있습니다.';
    else if (hp <= 1) entryError = '체력이 1 이하일 때는 입장할 수 없습니다.';
    else if (ticket.count < ticket.cost) entryError = '헬 초대장 ' + ticket.cost + '장이 필요합니다.';
    return {
        serverNow: Date.now(),
        inField,
        fieldName,
        blockedField: fieldName && !inField ? fieldName : null,
        phase,
        canEnter: !inField && !entryError,
        entryError,
        requirements: { minLevel: Number(dungeon.requireLevel || 1), maxLevel: Number(dungeon.maxLevel || 300) },
        ticket,
        player: {
            name: user.name,
            level,
            hp,
            maxHp,
            mp: typeof user.mp == 'undefined' ? maxMp : Number(user.mp || 0),
            maxMp,
            atk: Number(stats.atk || 0),
            def: Number(stats.def || 0),
            combatPower: Number(rpgenius.calculateCombatPower(user).total || 0),
            cardName: mainCard && mainCard.name || '',
            cardFormatted: mainCard && mainCard.formatted || '',
            cardStar: mainCard ? Number(mainCard.star || 0) : null,
            cardImageUrl: mainCard && mainCard.imageUrl || null,
            cardType: mainCard && mainCard.type || '일반',
            cardSkin: mainCard && mainCard.skin || '',
            spriteUrl: getHFieldCharacterSprite(mainCard)
        },
        target: {
            name: phase == 'pillar' ? '부타의 기둥' : (dungeon.elite && dungeon.elite.name || '부타'),
            hp: Math.max(0, targetHp),
            maxHp: targetMaxHp,
            atk: phase == 'pillar' ? 0 : Number(dungeon.elite && dungeon.elite.atk || 0),
            def: phase == 'pillar' ? 0 : Number(dungeon.elite && dungeon.elite.def || 0),
            pillars: phase == 'pillar' ? [targetHp >= 2, targetHp >= 1] : []
        },
        nextActionAt: inField ? Number(user.field.nextActionAt || 0) : 0,
        charge: inField ? Number(user.field.sivalonCharge || 0) : 0,
        skills: getHFieldSkills(user, mainCard),
        consumables: inField ? getHFieldRecoveryItems(user) : []
    };
}

function captureHFieldAction(user) {
    const inField = !!(user.field && user.field.name == H_FIELD_NAME);
    const phase = inField && user.field.phase == 'pillar' ? 'pillar' : 'elite';
    const itemCounts = new Map((user.inventory && Array.isArray(user.inventory.item) ? user.inventory.item : []).map(item => [Number(item.id), Number(item.count || 0)]));
    return {
        inField,
        phase,
        playerHp: Number(user.hp || 0),
        targetHp: !inField ? 0 : phase == 'pillar'
            ? Number(user.field.pillarHp || 0)
            : Number(user.field.elite && user.field.elite.hp || 0),
        itemCounts,
        equipmentCount: user.inventory && Array.isArray(user.inventory.equipment) ? user.inventory.equipment.length : 0
    };
}

function getHFieldRewards(user, before) {
    const rewards = [];
    buildInventoryItems(user).forEach(item => {
        const gained = Number(item.count || 0) - Number(before.itemCounts.get(Number(item.id)) || 0);
        if (gained > 0) rewards.push({ kind: 'item', name: item.name, count: gained, iconUrl: item.iconUrl, frameUrl: item.frameUrl, rarity: null });
    });
    buildInventoryEquipment(user)
        .filter(item => item.source == 'inventory' && Number(item.index) >= Number(before.equipmentCount || 0))
        .forEach(item => rewards.push({
            kind: 'equipment', name: item.name, count: 1, rarity: item.rarity,
            iconUrl: item.iconUrl, frameUrl: item.frameUrl, typeLabel: item.typeLabel
        }));
    return rewards;
}

function buildHFieldActionResult(user, before, message, action, skillName) {
    const state = buildHFieldState(user);
    const rewards = getHFieldRewards(user, before);
    const sameTarget = state.inField && state.phase == before.phase;
    const targetAfter = sameTarget ? Number(state.target.hp || 0) : 0;
    const criticalCount = (String(message).match(/치명타/g) || []).length;
    return {
        ok: !String(message).startsWith('❌'),
        message: String(message),
        state,
        event: {
            action,
            skillName: skillName || null,
            damage: Math.max(0, Number(before.targetHp || 0) - targetAfter),
            received: Math.max(0, Number(before.playerHp || 0) - Number(state.player.hp || 0)),
            criticalCount,
            phaseChanged: before.inField && state.inField && before.phase != state.phase,
            pillarDestroyed: before.phase == 'pillar' && Number(before.targetHp || 0) > targetAfter
                ? Math.max(0, 2 - Number(before.targetHp || 0)) : null,
            cleared: before.inField && !state.inField && /자동으로 퇴장했습니다/.test(String(message)) && rewards.length > 0,
            defeated: before.inField && !state.inField && /보상을 획득하지 못하고.*퇴장했습니다/.test(String(message)),
            rewards
        }
    };
}

async function runHFieldMutation(req, res, mutate) {
    try {
        const seed = await rpgenius.getRPGUserByName(req.session.name);
        if (!seed) return res.status(404).json({ error: '유저를 찾을 수 없습니다.' });
        const payload = await rpgenius.enqueueFieldAction(seed, async () => {
            const user = await rpgenius.getRPGUserByName(req.session.name);
            if (!user) throw new Error('유저를 찾을 수 없습니다.');
            return mutate(user);
        });
        res.json(payload);
    } catch (e) {
        console.error('h-field action error:', e);
        res.status(500).json({ error: e && e.message == '유저를 찾을 수 없습니다.' ? e.message : '서버 오류' });
    }
}

server.get('/api/hfield', requireUser, async (req, res) => {
    try {
        const user = await rpgenius.getRPGUserByName(req.session.name);
        if (!user) return res.status(404).json({ error: '유저를 찾을 수 없습니다.' });
        res.json(buildHFieldState(user));
    } catch (e) {
        console.error('h-field status error:', e);
        res.status(500).json({ error: '서버 오류' });
    }
});

server.get('/api/equipment-synthesis', requireUser, async (req, res) => {
    try {
        const user = await rpgenius.getRPGUserByName(req.session.name);
        if (!user) return res.status(404).json({ error: '유저를 찾을 수 없습니다.' });
        res.json({ equipment: buildEquipmentSynthesisItems(user) });
    } catch (e) {
        console.error('equipment synthesis list error:', e);
        res.status(500).json({ error: '서버 오류' });
    }
});

server.post('/api/equipment-synthesis', requireUser, async (req, res) => {
    try {
        const numbers = Array.isArray(req.body && req.body.numbers) ? req.body.numbers.map(Number) : [];
        const user = await rpgenius.getRPGUserByName(req.session.name);
        if (!user) return res.status(404).json({ error: '유저를 찾을 수 없습니다.' });
        const blockedReason = getEquipmentActionBlockedReason(user, '합성');
        if (blockedReason) return res.status(400).json({ error: blockedReason });
        if (user.pendingAction) return res.status(409).json({ error: '먼저 진행 중인 작업을 완료하거나 취소해주세요.' });
        const selection = rpgenius.getEquipmentSynthesisSelection(user, numbers);
        if (selection.error) return res.status(400).json({ error: selection.error.replace(/^❌\s*/, '') });
        user.pendingAction = { type: '장비합성', numbers: selection.numbers };
        const message = rpgenius.runEquipmentSynthesis(user);
        if (String(message || '').startsWith('❌')) return res.status(400).json({ error: String(message).replace(/^❌\s*/, '') });
        await user.save();
        const equipment = buildEquipmentSynthesisItems(user);
        res.json({
            ok: true,
            message,
            resultEquipment: equipment[equipment.length - 1] || null,
            equipment,
            profile: buildUserProfile(user)
        });
    } catch (e) {
        console.error('equipment synthesis error:', e);
        res.status(500).json({ error: '서버 오류' });
    }
});

server.post('/api/hfield/enter', requireUser, (req, res) => runHFieldMutation(req, res, async user => {
    const message = await rpgenius.enterField(user, H_FIELD_NAME, { confirmed: req.body && req.body.confirmed === true });
    await user.save();
    const state = buildHFieldState(user);
    return {
        ok: state.inField,
        needsConfirmation: !state.inField && !!(user.pendingAction && user.pendingAction.type == '필드입장확인' && user.pendingAction.name == H_FIELD_NAME),
        message,
        state
    };
}));

server.post('/api/hfield/cancel-entry', requireUser, (req, res) => runHFieldMutation(req, res, async user => {
    if (user.pendingAction && user.pendingAction.type == '필드입장확인' && user.pendingAction.name == H_FIELD_NAME) user.pendingAction = null;
    await user.save();
    return { ok: true, state: buildHFieldState(user) };
}));

server.post('/api/hfield/attack', requireUser, (req, res) => runHFieldMutation(req, res, async user => {
    if (!user.field || user.field.name != H_FIELD_NAME) return { ok: false, message: '❌ 부타게임[H]에 입장한 상태가 아닙니다.', state: buildHFieldState(user) };
    const before = captureHFieldAction(user);
    const message = await rpgenius.useBasicAttackInField(user);
    await user.save();
    return buildHFieldActionResult(user, before, message, 'attack');
}));

server.post('/api/hfield/skill', requireUser, (req, res) => runHFieldMutation(req, res, async user => {
    if (!user.field || user.field.name != H_FIELD_NAME) return { ok: false, message: '❌ 부타게임[H]에 입장한 상태가 아닙니다.', state: buildHFieldState(user) };
    const skillName = String(req.body && req.body.skillName || '').trim().slice(0, 80);
    if (!skillName) return { ok: false, message: '❌ 사용할 스킬을 선택해주세요.', state: buildHFieldState(user) };
    const before = captureHFieldAction(user);
    const message = await rpgenius.useSkillInField(user, skillName);
    await user.save();
    return buildHFieldActionResult(user, before, message, 'skill', skillName);
}));

server.post('/api/hfield/use-consumable', requireUser, (req, res) => runHFieldMutation(req, res, async user => {
    if (!user.field || user.field.name != H_FIELD_NAME) return { ok: false, message: '부타게임[H]에 입장한 상태가 아닙니다.', state: buildHFieldState(user) };
    const itemId = Number(req.body && req.body.itemId);
    const items = rpgenius.getDataCache('Item', []);
    const item = Number.isInteger(itemId) ? items[itemId] : null;
    const recoveryFuncs = item && item.type == '소모품'
        ? (item.use_func || []).filter(func => func && H_FIELD_RECOVERY_TYPES.has(func.type)) : [];
    if (!item || recoveryFuncs.length == 0) return { ok: false, message: '사용할 수 있는 회복 소모품이 아닙니다.', state: buildHFieldState(user) };
    if (rpgenius.getInventoryItemCount(user, itemId) < 1) return { ok: false, message: '아이템이 부족합니다.', state: buildHFieldState(user) };
    const stats = rpgenius.calculateUserStats(user);
    const maxHp = Number(stats.hp || 0), maxMp = Number(stats.mp || 0);
    const beforeHp = typeof user.hp == 'undefined' ? maxHp : Number(user.hp || 0);
    const beforeMp = typeof user.mp == 'undefined' ? maxMp : Number(user.mp || 0);
    const restoresHp = recoveryFuncs.some(func => String(func.type).startsWith('체력'));
    const restoresMp = recoveryFuncs.some(func => String(func.type).startsWith('마나'));
    if ((!restoresHp || beforeHp >= maxHp) && (!restoresMp || beforeMp >= maxMp)) {
        return { ok: false, message: '회복할 HP나 MP가 없습니다.', state: buildHFieldState(user) };
    }
    const message = await rpgenius.useItem(user, item.name, 1);
    const state = buildHFieldState(user);
    return {
        ok: !String(message).startsWith('❌'), message, state,
        event: {
            action: 'consumable', itemId, itemName: item.name,
            recoveredHp: Math.max(0, Number(state.player.hp || 0) - beforeHp),
            recoveredMp: Math.max(0, Number(state.player.mp || 0) - beforeMp)
        }
    };
}));

server.post('/api/hfield/leave', requireUser, (req, res) => runHFieldMutation(req, res, async user => {
    if (!user.field || user.field.name != H_FIELD_NAME) return { ok: false, message: '❌ 부타게임[H]에 입장한 상태가 아닙니다.', state: buildHFieldState(user) };
    const message = rpgenius.leaveField(user);
    await user.save();
    return { ok: !String(message).startsWith('❌'), message, state: buildHFieldState(user) };
}));

// ===== 버닝 =====
server.get('/api/burning', requireUser, async (req, res) => {
    try {
        const user = await rpgenius.getRPGUserByName(req.session.name);
        if (!user) return res.status(404).json({ error: '유저를 찾을 수 없습니다.' });
        const userLevel = Number(user.level || 1);
        const claimedNormal = new Set(Array.isArray(user.claimedBurning) ? user.claimedBurning : []);
        const claimedMega = new Set(Array.isArray(user.claimedMegaBurning) ? user.claimedMegaBurning : []);
        const list = BURNING_REWARDS.map(r => ({
            level: r.level,
            unlocked: userLevel >= r.level,
            normal: buildBurningTrack(r, 'normal', claimedNormal),
            mega: buildBurningTrack(r, 'mega', claimedMega)
        }));
        res.json({ list, userLevel, megaUnlocked: !!user.megaBurningUnlocked, megaCost: BURNING_MEGA_COST, point: Number(user.point || 0), pointIconUrl: getItemImageUrl('화폐', '포인트.png') });
    } catch (e) {
        console.error('burning status error:', e);
        res.status(500).json({ error: '서버 오류' });
    }
});

server.post('/api/burning/unlock-mega', requireUser, async (req, res) => {
    try {
        const user = await rpgenius.getRPGUserByName(req.session.name);
        if (!user) return res.status(404).json({ error: '유저를 찾을 수 없습니다.' });
        if (user.megaBurningUnlocked) return res.status(400).json({ error: '이미 메가 버닝이 해금되었습니다.' });
        if (Number(user.point || 0) < BURNING_MEGA_COST) return res.status(400).json({ error: '포인트가 부족합니다. (' + BURNING_MEGA_COST + 'P 필요)' });
        user.point = Number(user.point || 0) - BURNING_MEGA_COST;
        user.megaBurningUnlocked = true;
        await user.save();
        res.json({ ok: true, profile: buildUserProfile(user) });
    } catch (e) {
        console.error('burning unlock-mega error:', e);
        res.status(500).json({ error: '서버 오류' });
    }
});

server.post('/api/burning/claim', requireUser, async (req, res) => {
    try {
        const user = await rpgenius.getRPGUserByName(req.session.name);
        if (!user) return res.status(404).json({ error: '유저를 찾을 수 없습니다.' });
        const track = req.body && req.body.track === 'mega' ? 'mega' : 'normal';
        const level = Number(req.body && req.body.level);
        const reward = BURNING_REWARDS.find(r => r.level === level);
        if (!reward) return res.status(400).json({ error: '존재하지 않는 보상입니다.' });
        if (Number(user.level || 1) < level) return res.status(400).json({ error: '레벨이 부족합니다.' });
        if (track === 'mega' && !user.megaBurningUnlocked) return res.status(400).json({ error: '메가 버닝이 해금되지 않았습니다.' });
        const claimedKey = track === 'mega' ? 'claimedMegaBurning' : 'claimedBurning';
        if (!Array.isArray(user[claimedKey])) user[claimedKey] = [];
        if (user[claimedKey].includes(level)) return res.status(400).json({ error: '이미 수령한 보상입니다.' });
        const allItems = rpgenius.getDataCache('Item', []);
        for (const [name, count] of (track === 'mega' ? reward.mega : reward.normal)) {
            const itemId = allItems.findIndex(it => it && it.name === name);
            if (itemId !== -1) rpgenius.addInventoryItem(user, itemId, count);
        }
        const titleId = track === 'mega' ? reward.megaTitle : reward.normalTitle;
        if (titleId) rpgenius.unlockTitle(user, titleId);
        user[claimedKey].push(level);
        await user.save();
        res.json({ ok: true, profile: buildUserProfile(user) });
    } catch (e) {
        console.error('burning claim error:', e);
        res.status(500).json({ error: '서버 오류' });
    }
});

// ===== 포인트 충전 =====
const POINT_CHARGE_MIN = 50;
const POINT_CHARGE_NOTICE_CHANNEL_ID = '18436121437302863';

async function addSupabaseUserBalance(nickname, delta) {
    const { data, error } = await supabaseP.from('users').select('balance').eq('nickname', nickname).maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("'" + nickname + "' 계정을 찾을 수 없습니다.");
    const next = Number(data.balance || 0) + delta;
    const { error: updErr } = await supabaseP.from('users').update({ balance: next }).eq('nickname', nickname);
    if (updErr) throw updErr;
    return next;
}

async function addSupabaseCompanyBalance(name, delta) {
    const { data, error } = await supabaseP.from('companies').select('balance').eq('name', name).maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("'" + name + "' 회사를 찾을 수 없습니다.");
    const { error: updErr } = await supabaseP.from('companies').update({ balance: Number(data.balance || 0) + delta }).eq('name', name);
    if (updErr) throw updErr;
}

async function appendPointLog(entry) {
    await rpgenius.loadRpgeniusDataEntry('PointLogs').catch(() => {});
    const cached = rpgenius.getDataCache('PointLogs', []);
    const logs = Array.isArray(cached) ? cached.slice() : [];
    logs.push(entry);
    while (logs.length > 100) logs.shift();
    await rpgenius.saveRpgeniusDataEntry('PointLogs', logs);
}

// rpgenius_user name → supabase users nickname 치환 (NameMatch 데이터에 키가 있을 때만)
async function resolveStoreNickname(name) {
    await rpgenius.loadRpgeniusDataEntry('NameMatch').catch(() => {});
    const map = rpgenius.getDataCache('NameMatch', {}) || {};
    return (typeof map[name] === 'string' && map[name]) ? map[name] : name;
}

server.post('/api/point/charge', requireUser, async (req, res) => {
    if (!supabaseP) return res.status(503).json({ error: '충전 기능이 설정되지 않았습니다.' });
    const amount = Math.floor(Number(req.body && req.body.amount));
    if (!Number.isFinite(amount) || amount < POINT_CHARGE_MIN) {
        return res.status(400).json({ error: '최소 ' + POINT_CHARGE_MIN + 'P부터 충전할 수 있습니다.' });
    }
    const nickname = req.session.name;
    // 중간 실패 시 역순으로 실행되는 보상(rollback) 스택
    const rollback = [];
    try {
        const storeNickname = await resolveStoreNickname(nickname);
        const { data: acc, error: accErr } = await supabaseP.from('users').select('balance').eq('nickname', storeNickname).maybeSingle();
        if (accErr) throw accErr;
        if (!acc) return res.status(404).json({ error: '연동된 계정을 찾을 수 없습니다.' });
        const balance = Number(acc.balance || 0);
        if (balance < amount) return res.status(400).json({ error: '잔액이 부족합니다. (보유 ' + balance.toLocaleString('ko-KR') + ')' });

        const lotto = Math.max(1, Math.floor(amount * 0.01));
        const company = Math.max(1, Math.floor(amount * 0.01));
        const remainder = amount - lotto - company;
        const kinder = Math.floor(remainder / 2);   // 유치원생
        const lukim = remainder - kinder;           // Lukim9 (잉여 포인트 포함)
        const storeBalance = balance - amount;

        // 1) 충전 계정 잔액 차감
        const { error: deductErr } = await supabaseP.from('users').update({ balance: storeBalance }).eq('nickname', storeNickname);
        if (deductErr) throw deductErr;
        rollback.push(() => supabaseP.from('users').update({ balance }).eq('nickname', storeNickname));

        // 2) 포인트 지급 (DynamoDB rpgenius_user)
        const user = await rpgenius.getRPGUserByName(nickname);
        if (!user) throw new Error('유저를 찾을 수 없습니다.');
        const prevPoint = Number(user.point || 0);
        user.point = prevPoint + amount;
        await user.save();
        const newPoint = Number(user.point || 0);
        rollback.push(async () => { user.point = prevPoint; await user.save(); });

        // 3) 차감액 분배 이체 (1% 로또기금 / 1% 익테봇 / 49% Lukim9 / 49% 유치원생)
        await addSupabaseUserBalance('로또기금', lotto);
        rollback.push(() => addSupabaseUserBalance('로또기금', -lotto));
        await addSupabaseCompanyBalance('익테봇', company);
        rollback.push(() => addSupabaseCompanyBalance('익테봇', -company));
        await addSupabaseUserBalance('Lukim9', lukim);
        rollback.push(() => addSupabaseUserBalance('Lukim9', -lukim));
        await addSupabaseUserBalance('유치원생', kinder);
        rollback.push(() => addSupabaseUserBalance('유치원생', -kinder));

        // 4) 충전 로그 기록 (최대 100건)
        await appendPointLog({ id: crypto.randomUUID(), nickname, amount, point: newPoint, lotto, company, lukim, kinder, at: new Date().toISOString() });

        // 5) 카카오 알림 (성공 후 best-effort, 실패해도 충전은 롤백하지 않음)
        sendKakaoNotice(POINT_CHARGE_NOTICE_CHANNEL_ID,
            '[ RPGenius 충전 ]\n' +
            '✅ ' + nickname + ' ' + amount.toLocaleString('ko-KR') + ' P 충전 완료\n' +
            '💰 포인트 상점 잔액: ' + storeBalance.toLocaleString('ko-KR') + ' P\n' +
            '💰 RPGenius 잔액: ' + newPoint.toLocaleString('ko-KR') + ' P\n' +
            '\n[ 포인트 분배 ]\n' +
            '- 로또기금: ' + lotto.toLocaleString('ko-KR') + ' P\n' +
            '- 익테봇: ' + company.toLocaleString('ko-KR') + ' P\n' +
            '- 유치원생: ' + kinder.toLocaleString('ko-KR') + ' P\n' +
            '- Lukim9: ' + lukim.toLocaleString('ko-KR') + ' P');

        res.json({ ok: true, point: newPoint, charged: amount });
    } catch (e) {
        console.error('point charge error:', e);
        for (const undo of rollback.reverse()) {
            try { await undo(); } catch (re) { console.error('point charge rollback failed:', re); }
        }
        res.status(500).json({ error: '충전에 실패하여 원래 상태로 복구했습니다.' });
    }
});

server.post('/api/combine', requireUser, async (req, res) => {
    try {
        const user = await rpgenius.getRPGUserByName(req.session.name);
        if (!user) return res.status(404).json({ error: '유저를 찾을 수 없습니다.' });
        const numbers = Array.isArray(req.body && req.body.numbers) ? req.body.numbers.map(n => Number(n)) : [];
        const protectIndex = req.body && req.body.protectIndex != null ? Number(req.body.protectIndex) : null;
        const luckyRate = req.body && req.body.luckyRate != null ? Number(req.body.luckyRate) : null;
        const selection = rpgenius.getCardCombineSelection(user, numbers);
        if (selection.error) return res.status(400).json({ error: selection.error.replace(/^❌\s*/, '') });
        const pending = { type: '카드조합', numbers: selection.numbers };
        if (Number.isInteger(protectIndex) && protectIndex >= 0 && protectIndex < 3) {
            if (rpgenius.getProtectItemIdForCardStar(user, selection.star) == -1) return res.status(400).json({ error: '사용할 수 있는 보호 카드가 없습니다.' });
            pending.protectIndex = protectIndex;
        } else if (luckyRate != null && luckyRate > 0) {
            if (rpgenius.getLuckyItemIdForRate(user, luckyRate) == -1) return res.status(400).json({ error: '사용할 수 있는 럭키 카드가 없습니다.' });
            pending.luckyRate = luckyRate;
        }
        user.pendingAction = pending;
        const message = rpgenius.runCardCombine(user);
        if (typeof message == 'string' && message.startsWith('❌')) {
            user.pendingAction = null;
            return res.status(400).json({ error: message.replace(/^❌\s*/, '') });
        }
        const cardsArr = user.inventory.card;
        const resultCard = serializeCard(cardsArr[cardsArr.length - 1], user);
        const success = !!(resultCard && Number(resultCard.star) > Number(selection.star));
        await user.save();
        res.json({ ok: true, message, success, resultCard, cards: buildCombineCards(user), meta: buildCombineMeta(user), profile: buildUserProfile(user) });
    } catch (e) {
        console.error('combine error:', e);
        res.status(500).json({ error: '서버 오류' });
    }
});

function getEquipmentActionBlockedReason(user, action, noun) {
    const verb = action || '변경';
    const target = noun || '장비를';
    if (user && user.field && user.field.name) {
        return user.field.worldBoss ? '월드보스 전투 중에는 ' + target + ' ' + verb + '할 수 없습니다.' : '사냥 중에는 ' + target + ' ' + verb + '할 수 없습니다.';
    }
    const room = partyquest.getMyRoomSnapshot(user && user.name);
    if (room && room.state == 'inProgress') return '파티퀘스트 진행 중에는 ' + target + ' ' + verb + '할 수 없습니다.';
    return null;
}

server.post('/api/inventory/equipment/equip', requireUser, async (req, res) => {
    try {
        const number = Number(req.body && req.body.number);
        if (!Number.isInteger(number) || number < 1) return res.status(400).json({ error: '장비 번호가 올바르지 않습니다.' });
        const user = await rpgenius.getRPGUserByName(req.session.name);
        if (!user) return res.status(404).json({ error: '유저를 찾을 수 없습니다.' });
        const blockedReason = getEquipmentActionBlockedReason(user);
        if (blockedReason) return res.status(400).json({ error: blockedReason });
        const result = rpgenius.equipItemByNumber(user, number);
        if (String(result || '').startsWith('❌')) return res.status(400).json({ error: result.replace(/^❌\s*/, '') });
        await user.save();
        res.json({ ok: true, message: result, equipment: buildInventoryEquipment(user), profile: buildUserProfile(user) });
    } catch (e) {
        console.error('equipment equip error:', e);
        res.status(500).json({ error: '서버 오류' });
    }
});

server.post('/api/inventory/equipment/unequip', requireUser, async (req, res) => {
    try {
        const number = Number(req.body && req.body.number);
        if (!Number.isInteger(number) || number < 1) return res.status(400).json({ error: '장비 번호가 올바르지 않습니다.' });
        const user = await rpgenius.getRPGUserByName(req.session.name);
        if (!user) return res.status(404).json({ error: '유저를 찾을 수 없습니다.' });
        const blockedReason = getEquipmentActionBlockedReason(user);
        if (blockedReason) return res.status(400).json({ error: blockedReason });
        const result = rpgenius.unequipEquipmentByNumber(user, number);
        if (String(result || '').startsWith('❌')) return res.status(400).json({ error: result.replace(/^❌\s*/, '') });
        await user.save();
        res.json({ ok: true, message: result, equipment: buildInventoryEquipment(user), profile: buildUserProfile(user) });
    } catch (e) {
        console.error('equipment unequip error:', e);
        res.status(500).json({ error: '서버 오류' });
    }
});

server.post('/api/cards/equip-main', requireUser, async (req, res) => {
    try {
        const number = Number(req.body && req.body.number);
        if (!Number.isInteger(number) || number < 1) return res.status(400).json({ error: '카드 번호가 올바르지 않습니다.' });
        const user = await rpgenius.getRPGUserByName(req.session.name);
        if (!user) return res.status(404).json({ error: '유저를 찾을 수 없습니다.' });
        const blockedReason = getEquipmentActionBlockedReason(user, '장착', '카드를');
        if (blockedReason) return res.status(400).json({ error: blockedReason });
        const result = rpgenius.equipMainCharacterCard(user, number);
        if (String(result || '').startsWith('❌')) return res.status(400).json({ error: result.replace(/^❌\s*/, '') });
        await user.save();
        res.json({ ok: true, message: result, profile: buildUserProfile(user) });
    } catch (e) {
        console.error('card equip-main error:', e);
        res.status(500).json({ error: '서버 오류' });
    }
});

server.post('/api/cards/slot/equip', requireUser, async (req, res) => {
    try {
        const number = Number(req.body && req.body.number);
        if (!Number.isInteger(number) || number < 1) return res.status(400).json({ error: '카드 번호가 올바르지 않습니다.' });
        const user = await rpgenius.getRPGUserByName(req.session.name);
        if (!user) return res.status(404).json({ error: '유저를 찾을 수 없습니다.' });
        const blockedReason = getEquipmentActionBlockedReason(user, '장착', '카드를');
        if (blockedReason) return res.status(400).json({ error: blockedReason });
        const result = rpgenius.equipCharacterCardSlot(user, number);
        if (String(result || '').startsWith('❌')) return res.status(400).json({ error: result.replace(/^❌\s*/, '') });
        await user.save();
        res.json({ ok: true, message: result, profile: buildUserProfile(user) });
    } catch (e) {
        console.error('card slot equip error:', e);
        res.status(500).json({ error: '서버 오류' });
    }
});

server.post('/api/cards/slot/remove', requireUser, async (req, res) => {
    try {
        const slot = Number(req.body && req.body.slot);
        if (!Number.isInteger(slot) || slot < 1) return res.status(400).json({ error: '슬롯 번호가 올바르지 않습니다.' });
        const user = await rpgenius.getRPGUserByName(req.session.name);
        if (!user) return res.status(404).json({ error: '유저를 찾을 수 없습니다.' });
        const blockedReason = getEquipmentActionBlockedReason(user, '해제', '카드를');
        if (blockedReason) return res.status(400).json({ error: blockedReason });
        const result = rpgenius.removeCharacterCardSlot(user, slot);
        if (String(result || '').startsWith('❌')) return res.status(400).json({ error: result.replace(/^❌\s*/, '') });
        await user.save();
        res.json({ ok: true, message: result, profile: buildUserProfile(user) });
    } catch (e) {
        console.error('card slot remove error:', e);
        res.status(500).json({ error: '서버 오류' });
    }
});

// ===== 장착 프리셋 =====
// 슬롯 1은 기본 제공. 2·3번 100가넷, 4번 300포인트, 5번 500포인트로 순차 해금.
const PRESET_UNLOCK_COSTS = [
    null,
    { currency: 'garnet', amount: 100 },
    { currency: 'garnet', amount: 100 },
    { currency: 'point', amount: 300 },
    { currency: 'point', amount: 500 }
];
const PRESET_TYPE_LABELS = { weapon: '무기', hat: '모자', armor: '갑옷', pants: '하의', shoes: '신발', accessory: '장신구', support: '보조' };

function getUnlockedPresetSlots(user) {
    return Math.max(1, Math.min(rpgenius.PRESET_SLOT_COUNT, Number(user.presetSlotsUnlocked || 1)));
}

function buildPresetPayload(user) {
    const presets = rpgenius.getUserPresets(user);
    // 장비는 인벤토리 탭과 동일한 리치 직렬화(스탯/잠재/패시브 포함)를 uid로 매칭해 재사용
    const richByUid = new Map(buildInventoryEquipment(user).filter(e => e.uid).map(e => [e.uid, e]));
    const views = presets.map(preset => {
        const view = rpgenius.resolvePresetForView(user, preset);
        if (!view) return null;
        return {
            name: (preset && preset.name) || null,
            savedAt: view.savedAt,
            mainCard: view.mainCard ? serializeCard(view.mainCard, user) : null,
            slotCards: view.slotCards.map(card => serializeCard(card, user)).filter(Boolean),
            equipment: view.equipment.map(entry => entry.equip && richByUid.get(entry.equip.uid) || null).filter(Boolean)
        };
    });
    return {
        ok: true,
        slotCount: rpgenius.PRESET_SLOT_COUNT,
        unlocked: getUnlockedPresetSlots(user),
        costs: PRESET_UNLOCK_COSTS.map(c => c && {
            currency: c.currency,
            amount: c.amount,
            label: c.currency == 'garnet' ? comma(c.amount) + ' 가넷' : comma(c.amount) + 'P',
            iconUrl: getItemImageUrl('화폐', c.currency == 'garnet' ? '가넷.png' : '포인트.png')
        }),
        garnet: Number(user.garnet || 0),
        point: Number(user.point || 0),
        presets: views
    };
}

server.get('/api/presets', requireUser, async (req, res) => {
    try {
        const user = await rpgenius.getRPGUserByName(req.session.name);
        if (!user) return res.status(404).json({ error: '유저를 찾을 수 없습니다.' });
        res.json(buildPresetPayload(user));
    } catch (e) {
        console.error('presets status error:', e);
        res.status(500).json({ error: '서버 오류' });
    }
});

server.post('/api/presets/save', requireUser, async (req, res) => {
    try {
        const slot = Number(req.body && req.body.slot);
        const user = await rpgenius.getRPGUserByName(req.session.name);
        if (!user) return res.status(404).json({ error: '유저를 찾을 수 없습니다.' });
        if (!Number.isInteger(slot) || slot < 0 || slot >= getUnlockedPresetSlots(user)) return res.status(400).json({ error: '사용할 수 없는 프리셋 슬롯입니다.' });
        rpgenius.saveUserPreset(user, slot);
        await user.save();
        res.json(buildPresetPayload(user));
    } catch (e) {
        console.error('presets save error:', e);
        res.status(500).json({ error: '서버 오류' });
    }
});

server.post('/api/presets/apply', requireUser, async (req, res) => {
    try {
        const slot = Number(req.body && req.body.slot);
        const user = await rpgenius.getRPGUserByName(req.session.name);
        if (!user) return res.status(404).json({ error: '유저를 찾을 수 없습니다.' });
        if (!Number.isInteger(slot) || slot < 0 || slot >= getUnlockedPresetSlots(user)) return res.status(400).json({ error: '사용할 수 없는 프리셋 슬롯입니다.' });
        const blockedReason = getEquipmentActionBlockedReason(user, '변경', '장비를');
        if (blockedReason) return res.status(400).json({ error: blockedReason });
        const result = rpgenius.applyUserPreset(user, slot);
        if (result.error) return res.status(400).json({ error: result.error });
        await user.save();
        res.json(Object.assign(buildPresetPayload(user), { warnings: result.warnings || [], profile: buildUserProfile(user) }));
    } catch (e) {
        console.error('presets apply error:', e);
        res.status(500).json({ error: '서버 오류' });
    }
});

server.post('/api/presets/rename', requireUser, async (req, res) => {
    try {
        const slot = Number(req.body && req.body.slot);
        const name = String((req.body && req.body.name) || '').trim();
        if (name.length > 12) return res.status(400).json({ error: '이름은 12자 이하로 입력해주세요.' });
        const user = await rpgenius.getRPGUserByName(req.session.name);
        if (!user) return res.status(404).json({ error: '유저를 찾을 수 없습니다.' });
        if (!Number.isInteger(slot) || slot < 0 || slot >= getUnlockedPresetSlots(user)) return res.status(400).json({ error: '사용할 수 없는 프리셋 슬롯입니다.' });
        const presets = rpgenius.getUserPresets(user);
        if (!presets[slot]) return res.status(400).json({ error: '저장된 프리셋이 없습니다.' });
        presets[slot].name = name || null;
        await user.save();
        res.json(buildPresetPayload(user));
    } catch (e) {
        console.error('presets rename error:', e);
        res.status(500).json({ error: '서버 오류' });
    }
});

server.post('/api/presets/unlock', requireUser, async (req, res) => {
    try {
        const slot = Number(req.body && req.body.slot);
        const user = await rpgenius.getRPGUserByName(req.session.name);
        if (!user) return res.status(404).json({ error: '유저를 찾을 수 없습니다.' });
        const unlocked = getUnlockedPresetSlots(user);
        if (!Number.isInteger(slot) || slot != unlocked) return res.status(400).json({ error: '슬롯은 순서대로 해금할 수 있습니다.' });
        const cost = PRESET_UNLOCK_COSTS[slot];
        if (!cost) return res.status(400).json({ error: '해금할 수 없는 슬롯입니다.' });
        if (cost.currency == 'garnet') {
            if (Number(user.garnet || 0) < cost.amount) return res.status(400).json({ error: '가넷이 부족합니다. (' + comma(cost.amount) + ' 가넷 필요)' });
            user.garnet = Number(user.garnet || 0) - cost.amount;
        } else {
            if (Number(user.point || 0) < cost.amount) return res.status(400).json({ error: '포인트가 부족합니다. (' + comma(cost.amount) + 'P 필요)' });
            user.point = Number(user.point || 0) - cost.amount;
        }
        user.presetSlotsUnlocked = slot + 1;
        await user.save();
        res.json(buildPresetPayload(user));
    } catch (e) {
        console.error('presets unlock error:', e);
        res.status(500).json({ error: '서버 오류' });
    }
});

// ===== 봉인된 자물쇠 =====
const LOCKBOX_ITEM_NAME = '봉인된 자물쇠';

server.post('/api/inventory/lockbox-check', requireUser, async (req, res) => {
    try {
        const user = await rpgenius.getRPGUserByName(req.session.name);
        if (!user) return res.status(404).json({ error: '유저를 찾을 수 없습니다.' });
        const count = Number(req.body && req.body.count) || 1;
        if (![1, 10].includes(count)) return res.status(400).json({ error: '잘못된 요청입니다.' });
        const err = rpgenius.getLockboxOpenError(user, count);
        return res.json(err ? { ok: false, error: err } : { ok: true });
    } catch (e) {
        console.error('lockbox check error:', e);
        res.status(500).json({ error: '서버 오류' });
    }
});

server.post('/api/inventory/use-lockbox', requireUser, async (req, res) => {
    try {
        const user = await rpgenius.getRPGUserByName(req.session.name);
        if (!user) return res.status(404).json({ error: '유저를 찾을 수 없습니다.' });
        const count = Number(req.body && req.body.count) || 1;
        if (![1, 10].includes(count)) return res.status(400).json({ error: '잘못된 요청입니다.' });
        const out = rpgenius.openSealedLockbox(user, count);
        if (out.error) return res.status(400).json({ error: out.error });
        await user.save();
        const items = rpgenius.getDataCache('Item', []);
        const enrich = r => {
            const itemData = items.find(it => it && it.name === r.name);
            return {
                name: r.name, count: r.count,
                iconUrl: itemData ? getItemIconUrl(itemData) : null,
                frameUrl: itemData ? getAuctionFrameUrl('item') : null
            };
        };
        const opens = out.opens.map(o => ({ main: o.main.map(enrich), bonus: o.bonus.map(enrich) }));
        res.json({ ok: true, opens });
    } catch (e) {
        console.error('lockbox error:', e);
        res.status(500).json({ error: '서버 오류' });
    }
});

// ===== 잠재능력 =====

server.post('/api/potential/awaken', requireUser, async (req, res) => {
    try {
        const number = Number(req.body && req.body.number);
        if (!Number.isInteger(number) || number < 1) return res.status(400).json({ error: '장비 번호가 올바르지 않습니다.' });
        const user = await rpgenius.getRPGUserByName(req.session.name);
        if (!user) return res.status(404).json({ error: '유저를 찾을 수 없습니다.' });
        const blocked = getEquipmentActionBlockedReason(user, '변경');
        if (blocked) return res.status(400).json({ error: blocked });
        const out = rpgenius.webAwakenPotential(user, number);
        if (out.error) return res.status(400).json({ error: out.error });
        await user.save();
        res.json({ ok: true, equipment: buildInventoryEquipment(user), profile: buildUserProfile(user) });
    } catch (e) {
        console.error('potential awaken error:', e);
        res.status(500).json({ error: '서버 오류' });
    }
});

server.get('/api/potential/reroll-info/:number', requireUser, async (req, res) => {
    try {
        const number = Number(req.params.number);
        if (!Number.isInteger(number) || number < 1) return res.status(400).json({ error: '장비 번호가 올바르지 않습니다.' });
        const user = await rpgenius.getRPGUserByName(req.session.name);
        if (!user) return res.status(404).json({ error: '유저를 찾을 수 없습니다.' });
        const out = rpgenius.getPotentialRerollInfo(user, number);
        if (out.error) return res.status(400).json({ error: out.error });
        const items = rpgenius.getDataCache('Item', []) || [];
        const iconByName = name => { const d = items.find(it => it && it.name === name); return d ? getItemIconUrl(d) : null; };
        out.jewelIcons = { jewel: iconByName('쥬얼'), white: iconByName('화이트 쥬얼') };
        out.goldIcon = SHOP_CURR_IMG.gold;
        res.json(out);
    } catch (e) {
        console.error('potential reroll-info error:', e);
        res.status(500).json({ error: '서버 오류' });
    }
});

server.post('/api/potential/reroll', requireUser, async (req, res) => {
    try {
        const number = Number(req.body && req.body.number);
        if (!Number.isInteger(number) || number < 1) return res.status(400).json({ error: '장비 번호가 올바르지 않습니다.' });
        const jewel = ['none', 'jewel', 'white'].includes(req.body && req.body.jewel) ? req.body.jewel : 'none';
        const user = await rpgenius.getRPGUserByName(req.session.name);
        if (!user) return res.status(404).json({ error: '유저를 찾을 수 없습니다.' });
        const blocked = getEquipmentActionBlockedReason(user, '변경');
        if (blocked) return res.status(400).json({ error: blocked });
        const out = rpgenius.webRerollPotential(user, number, jewel);
        if (out.error) return res.status(400).json({ error: out.error });
        await user.save();
        res.json(out);
    } catch (e) {
        console.error('potential reroll error:', e);
        res.status(500).json({ error: '서버 오류' });
    }
});

server.post('/api/potential/reroll/confirm', requireUser, async (req, res) => {
    try {
        const user = await rpgenius.getRPGUserByName(req.session.name);
        if (!user) return res.status(404).json({ error: '유저를 찾을 수 없습니다.' });
        const result = rpgenius.confirmPotentialReroll(user);
        if (String(result || '').startsWith('❌')) return res.status(400).json({ error: result.replace(/^❌\s*/, '') });
        await user.save();
        res.json({ ok: true, equipment: buildInventoryEquipment(user), profile: buildUserProfile(user) });
    } catch (e) {
        console.error('potential reroll confirm error:', e);
        res.status(500).json({ error: '서버 오류' });
    }
});

server.post('/api/potential/reroll/cancel', requireUser, async (req, res) => {
    try {
        const user = await rpgenius.getRPGUserByName(req.session.name);
        if (!user) return res.status(404).json({ error: '유저를 찾을 수 없습니다.' });
        // 웹은 비교 화면에서 명시적으로 '이전 유지'를 선택하므로 강제 취소
        const result = rpgenius.cancelPotentialReroll(user, true);
        if (String(result || '').startsWith('❌')) return res.status(400).json({ error: result.replace(/^❌\s*/, '') });
        await user.save();
        res.json({ ok: true, equipment: buildInventoryEquipment(user), profile: buildUserProfile(user) });
    } catch (e) {
        console.error('potential reroll cancel error:', e);
        res.status(500).json({ error: '서버 오류' });
    }
});

// ===== 장비 강화 =====

server.get('/api/equipment/upgrade/preview/:number', requireUser, async (req, res) => {
    try {
        const number = Number(req.params.number);
        if (!Number.isInteger(number) || number < 1) return res.status(400).json({ error: '장비 번호가 올바르지 않습니다.' });
        const user = await rpgenius.getRPGUserByName(req.session.name);
        if (!user) return res.status(404).json({ error: '유저를 찾을 수 없습니다.' });
        const blockedReason = getEquipmentActionBlockedReason(user, '강화');
        if (blockedReason) return res.status(400).json({ error: blockedReason });
        res.json(buildEquipmentUpgradePreview(user, number));
    } catch (e) {
        console.error('upgrade preview error:', e);
        res.status(500).json({ error: '서버 오류' });
    }
});

server.post('/api/equipment/upgrade/run', requireUser, async (req, res) => {
    try {
        const number = Number(req.body && req.body.number);
        if (!Number.isInteger(number) || number < 1) return res.status(400).json({ error: '장비 번호가 올바르지 않습니다.' });
        const rawProtectLevel = req.body && req.body.protectLevel;
        const protectLevel = ['none', 'basic', 'advanced', 'blessed'].includes(rawProtectLevel) ? rawProtectLevel : undefined;
        const user = await rpgenius.getRPGUserByName(req.session.name);
        if (!user) return res.status(404).json({ error: '유저를 찾을 수 없습니다.' });
        const blockedReason = getEquipmentActionBlockedReason(user, '강화');
        if (blockedReason) return res.status(400).json({ error: blockedReason });
        // set pendingAction then run
        const preview = buildEquipmentUpgradePreview(user, number);
        if (preview.error) return res.status(400).json({ error: preview.error });
        if (!preview.canUpgrade) return res.status(400).json({ error: preview.blockReason || '강화할 수 없습니다.' });
        // manually set pendingAction
        const selected = rpgenius.getEquipmentByNumber(user, number);
        const type = selected.equip.type || selected.type;
        // capture pre-upgrade state to compute the actual applied stat changes
        const beforeEquip = rpgenius.getEquipmentData(type, selected.equip.id);
        const beforeLevel = Number(selected.equip.level || 0);
        const beforeStats = rpgenius.getEquipmentStatsAtLevel(beforeEquip, beforeLevel);
        const beforePlus = rpgenius.getEquipmentPlusStatsAtLevel(beforeEquip, beforeLevel);
        const beforeId = selected.equip.id;
        user.pendingAction = { type: '장비강화', number, equipmentType: type, free: false, protectLevel };
        const result = rpgenius.runEquipmentUpgrade(user);
        await user.save();
        const resultKind = getUpgradeResultKind(result);
        // compute actual stat changes that were applied (skip when item was destroyed/lost)
        let appliedDiffs = [];
        if (resultKind !== 'destroy') {
            const afterSel = rpgenius.getEquipmentByNumber(user, number);
            if (afterSel && afterSel.equip.id === beforeId) {
                const afterLevel = Number(afterSel.equip.level || 0);
                const afterStats = rpgenius.getEquipmentStatsAtLevel(beforeEquip, afterLevel);
                const afterPlus = rpgenius.getEquipmentPlusStatsAtLevel(beforeEquip, afterLevel);
                appliedDiffs = buildStatDiffs(beforeStats, afterStats, beforePlus, afterPlus);
            }
        }
        res.json({
            ok: true,
            message: result,
            resultKind,
            appliedDiffs,
            equipment: buildInventoryEquipment(user),
            profile: buildUserProfile(user),
            preview: buildEquipmentUpgradePreview(user, number)
        });
    } catch (e) {
        console.error('upgrade run error:', e);
        res.status(500).json({ error: '서버 오류' });
    }
});

function getUpgradeResultKind(msg) {
    if (!msg) return 'unknown';
    if (msg.includes('막았습니다') || msg.includes('보호권으로')) return 'protected';
    if (msg.includes('대성공')) return 'great';
    if (msg.includes('성공')) return 'success';
    if (msg.includes('파괴')) return 'destroy';
    if (msg.includes('실패') || msg.includes('하락')) return 'down';
    return 'fail';
}

function buildEquipmentUpgradePreview(user, number) {
    const selected = rpgenius.getEquipmentByNumber(user, number);
    if (!selected) return { error: '존재하지 않는 장비 번호입니다.' };
    if (selected.equip.locked) return { error: '잠긴 장비는 강화할 수 없습니다.' };
    const type = selected.equip.type || selected.type;
    const equipment = rpgenius.getEquipmentData(type, selected.equip.id);
    if (!equipment) return { error: '잘못된 장비 데이터입니다.' };
    if (!Array.isArray(equipment.upgrade) || equipment.upgrade.length === 0) return { error: '강화할 수 없는 장비입니다.' };
    const level = Number(selected.equip.level || 0);
    const maxLevel = rpgenius.getEquipmentMaxLevel(equipment);
    if (level >= maxLevel) return { error: '이미 최대 강화 단계입니다.' };
    const nextLevel = level + 1;
    const currentStats = rpgenius.getEquipmentStatsAtLevel(equipment, level);
    const nextStats = rpgenius.getEquipmentStatsAtLevel(equipment, nextLevel);
    const currentPlus = rpgenius.getEquipmentPlusStatsAtLevel(equipment, level);
    const nextPlus = rpgenius.getEquipmentPlusStatsAtLevel(equipment, nextLevel);
    const rates = rpgenius.getEquipmentUpgradeRates(type, level);
    const cost = rpgenius.getEquipmentUpgradeCost(equipment, type, level);
    const stoneItemId = Number.isInteger(cost.stoneItemId) && cost.stoneItemId >= 0 ? cost.stoneItemId : rpgenius.EQUIPMENT_STONE_ITEM_ID;
    const stoneCount = rpgenius.getInventoryItemCount(user, stoneItemId);
    const gold = Number(user.gold || 0);
    const hasStone = stoneCount >= cost.stone;
    const hasGold = gold >= cost.gold;
    const statDiffs = buildStatDiffs(currentStats, nextStats, currentPlus, nextPlus);
    const protectOptions = buildProtectOptions(user);
    return {
        number,
        name: rpgenius.getEquipmentDisplayName(equipment, selected.equip),
        rarity: equipment.rarity,
        type,
        level,
        nextLevel,
        maxLevel,
        iconUrl: getEquipmentIconUrl(equipment),
        frameUrl: getAuctionFrameUrl('equipment', equipment.rarity),
        rates: { great: rates.great, success: rates.success, down: rates.down, reset: rates.reset },
        cost,
        stoneCount,
        gold,
        hasStone,
        hasGold,
        canUpgrade: hasStone && hasGold,
        statDiffs,
        protectOptions
    };
}

function buildStatDiffs(currentStats, nextStats, currentPlus, nextPlus) {
    const STAT_LABELS = {
        atk: '공격력', def: '방어력', hp: '체력', mp: 'MP', pnt: '방어 관통력',
        plusGold: '처치 당 골드', crit: '치명타 확률', critMul: '치명타 피해량',
        critDef: '치명타 피해 감소율', cmb: '연격 확률', maxCmb: '추가 공격 횟수',
        skillCooldown: '스킬 쿨타임', skillTrueDmg: '스킬 추가 고정 피해',
        cardStarAtk: '카드 1성당 공격력', level9Atk: '레벨 9당 공격력',
        atkPerMillionGold: '골드 100만 당 공격력'
    };
    const PLUS_LABELS = {
        atk: '최종 공격력', def: '최종 방어력', hp: '최종 체력', mp: '최종 MP',
        pnt: '방어력 관통', gold: '골드 획득량', potion: '물약 효율',
        afterBasic: '일반 공격 피해', avd: '회피 확률', afterSkill: '스킬 공격 피해',
        '000': '추가 피해 확률', exp: '경험치 획득량', eliteDmg: '엘리트 추가 피해',
        mpReduce: 'MP 소모량', itemDropChance: '아이템 획득 확률',
        recoveryEfficiency: '회복 효율', crit: '치명타 확률', critMul: '치명타 피해량',
        critDef: '치명타 피해 감소율', cmb: '연격 확률', maxCmb: '추가 공격 횟수',
        skillCooldown: '스킬 쿨타임', skillTrueDmg: '스킬 추가 고정 피해',
        takenDamage: '받는 피해 증가', damageBonus: '주는 피해 증가',
        finalDamage: '최종 피해', extraDamage: '추가 피해', bossDmg: '보스 추가 피해',
        butagamePartyQuestDmg: "'부타게임' 파티 퀘스트 내 추가 피해"
    };
    // 값이 낮을수록(감소할수록) 이득인 스탯
    const LOWER_IS_BETTER = new Set(['skillCooldown', 'mpReduce', 'takenDamage']);
    const isImproved = (k, before, after) => LOWER_IS_BETTER.has(k) ? after < before : after > before;
    const diffs = [];
    Object.keys(STAT_LABELS).forEach(k => {
        const before = Number(currentStats[k] || 0);
        const after = Number(nextStats[k] || 0);
        if (before !== after) diffs.push({ key: k, label: STAT_LABELS[k], before: rpgenius.formatStatValue(k, before), after: rpgenius.formatStatValue(k, after), delta: rpgenius.formatStatValue(k, after - before), improved: isImproved(k, before, after) });
    });
    Object.keys(PLUS_LABELS).forEach(k => {
        const before = Number(currentPlus[k] || 0);
        const after = Number(nextPlus[k] || 0);
        if (before !== after) {
            const fmt = v => rpgenius.formatStatValue(k + '%', v);
            diffs.push({ key: k, label: PLUS_LABELS[k], before: fmt(before), after: fmt(after), delta: fmt(after - before), improved: isImproved(k, before, after) });
        }
    });
    return diffs;
}

function buildProtectOptions(user) {
    const items = rpgenius.getDataCache('Item', []);
    const iconFor = id => { const d = items[id]; return d ? getItemIconUrl(d) : null; };
    const opts = [];
    const check = (id, label, detail, level) => {
        const count = rpgenius.getInventoryItemCount(user, id);
        if (count > 0) opts.push({ level, label, detail, iconUrl: iconFor(id), count });
    };
    check(rpgenius.EQUIPMENT_BLESSED_PROTECT_ITEM_ID, '축복받은 장비 보호권', '파괴/하락 시 유지', 'blessed');
    check(rpgenius.EQUIPMENT_ADVANCED_PROTECT_ITEM_ID, '고급 장비 보호권', '파괴 시 유지', 'advanced');
    check(rpgenius.EQUIPMENT_PROTECT_ITEM_ID, '장비 보호권', '파괴 시 0강 초기화', 'basic');
    return opts;
}

// ===== 핫딜샵 =====

const HOTDEAL_SECTORS = [
    { name: '강화 섹터', items: [
        { id: 3,   count: 1,     goods: 'gold',   amount: 1200000,  weight: 1.5 },
        { id: 3,   count: 1,     goods: 'gold',   amount: 2000000,  weight: 2   },
        { id: 3,   count: 1,     goods: 'garnet', amounts: [280,320,380], weight: 30  },
        { id: 4,   count: 1,     goods: 'gold',   amount: 9500000,  weight: 0.5 },
        { id: 4,   count: 1,     goods: 'gold',   amount: 12000000, weight: 1.5 },
        { id: 4,   count: 1,     goods: 'garnet', amounts: [850,1000,1150], weight: 10 },
        { id: 5,   count: 1,     goods: 'gold',   amount: 100000000,weight: 0.5 },
        { id: 5,   count: 1,     goods: 'garnet', amount: 3500,     weight: 2   },
        { id: 0,   count: 5000,  goods: 'gold',   amount: 300000,   weight: 2   },
        { id: 0,   count: 5000,  goods: 'garnet', amount: 40,       weight: 19  },
        { id: 0,   count: 10000, goods: 'gold',   amount: 600000,   weight: 2   },
        { id: 0,   count: 10000, goods: 'garnet', amount: 60,       weight: 19  },
        { itemName: '상급 강화석', count: 10, goods: 'gold',   amount: 600000, weight: 1 },
        { itemName: '상급 강화석', count: 10, goods: 'garnet', amount: 60,     weight: 9 },
    ]},
    { name: '쥬얼/헬 섹터', items: [
        { id: 124, count: 5,  goods: 'garnet', amount: 10,  weight: 18  },
        { id: 124, count: 10, goods: 'garnet', amount: 20,  weight: 12  },
        { id: 124, count: 20, goods: 'garnet', amount: 35,  weight: 5   },
        { id: 124, count: 30, goods: 'garnet', amount: 50,  weight: 3   },
        { id: 124, count: 50, goods: 'garnet', amount: 80,  weight: 1   },
        { id: 133, count: 3,  goods: 'gold',   amount: 200000, weight: 1.5 },
        { id: 133, count: 5,  goods: 'garnet', amount: 25,  weight: 16  },
        { id: 133, count: 10, goods: 'garnet', amount: 50,  weight: 6   },
        { id: 133, count: 20, goods: 'garnet', amount: 90,  weight: 3   },
        { id: 133, count: 30, goods: 'garnet', amount: 125, weight: 1.5 },
        { itemName: '헬 초대장', count: 10,  goods: 'gold',   amount: 500000,  weight: 6 },
        { itemName: '헬 초대장', count: 50,  goods: 'gold',   amount: 2300000, weight: 3 },
        { itemName: '헬 초대장', count: 100, goods: 'gold',   amount: 4500000, weight: 1 },
        { itemName: '헬 초대장', count: 10,  goods: 'garnet', amount: 25,      weight: 12 },
        { itemName: '헬 초대장', count: 50,  goods: 'garnet', amount: 120,     weight: 7 },
        { itemName: '헬 초대장', count: 100, goods: 'garnet', amount: 230,     weight: 4 },
    ]},
    { name: '보호 카드 섹터', items: [
        { id: 107, count: 1, goods: 'gold',   amount: 100000,  weight: 0.3    },
        { id: 107, count: 1, goods: 'gold',   amount: 300000,  weight: 3      },
        { id: 107, count: 1, goods: 'garnet', amount: 30,      weight: 15     },
        { id: 107, count: 1, goods: 'garnet', amount: 60,      weight: 30     },
        { id: 108, count: 1, goods: 'gold',   amount: 250000,  weight: 0.1    },
        { id: 108, count: 1, goods: 'gold',   amount: 450000,  weight: 2      },
        { id: 108, count: 1, goods: 'garnet', amount: 65,      weight: 10     },
        { id: 108, count: 1, goods: 'garnet', amount: 100,     weight: 20     },
        { id: 109, count: 1, goods: 'gold',   amount: 1000000, weight: 0.076  },
        { id: 109, count: 1, goods: 'gold',   amount: 1500000, weight: 0.5    },
        { id: 109, count: 1, goods: 'garnet', amount: 250,     weight: 2      },
        { id: 109, count: 1, goods: 'garnet', amount: 320,     weight: 12     },
        { id: 110, count: 1, goods: 'gold',   amount: 10000000,weight: 0.001  },
        { id: 110, count: 1, goods: 'gold',   amount: 20000000,weight: 0.02   },
        { id: 110, count: 1, goods: 'garnet', amount: 640,     weight: 0.8    },
        { id: 110, count: 1, goods: 'garnet', amount: 820,     weight: 3      },
        { id: 111, count: 1, goods: 'gold',   amount: 55000000,weight: 0.0005 },
        { id: 111, count: 1, goods: 'gold',   amount: 75000000,weight: 0.0025 },
        { id: 111, count: 1, goods: 'garnet', amount: 1650,    weight: 0.2    },
        { id: 111, count: 1, goods: 'garnet', amount: 1950,    weight: 1      },
    ]},
    { name: '카드팩 섹터', items: [
        { id: 21, count: 1, goods: 'gold',   amount: 200000,  weight: 6    },
        { id: 21, count: 1, goods: 'garnet', amount: 50,      weight: 10   },
        { id: 21, count: 1, goods: 'garnet', amount: 80,      weight: 30   },
        { id: 22, count: 1, goods: 'gold',   amount: 500000,  weight: 2    },
        { id: 22, count: 1, goods: 'garnet', amount: 80,      weight: 10   },
        { id: 22, count: 1, goods: 'garnet', amount: 120,     weight: 30   },
        { id: 23, count: 1, goods: 'gold',   amount: 2200000, weight: 1    },
        { id: 23, count: 1, goods: 'garnet', amount: 280,     weight: 2    },
        { id: 23, count: 1, goods: 'garnet', amount: 320,     weight: 8    },
        { id: 24, count: 1, goods: 'gold',   amount: 6000000, weight: 0.05 },
        { id: 24, count: 1, goods: 'garnet', amount: 650,     weight: 0.35 },
        { id: 24, count: 1, goods: 'garnet', amount: 880,     weight: 0.5  },
        { id: 25, count: 1, goods: 'gold',   amount: 30000000,weight: 0.02 },
        { id: 25, count: 1, goods: 'garnet', amount: 2400,    weight: 0.08 },
    ]},
    { name: '캐시템 섹터', items: [
        { id: 144, count: 10, weight: 29, variants: [
            { goods: 'gold', amount: 100000 }, { goods: 'garnet', amount: 10 },
        ]},
        { id: 144, count: 50, weight: 10, variants: [
            { goods: 'gold', amount: 450000 }, { goods: 'garnet', amount: 45 },
        ]},
        { id: 84, count: 10, weight: 29, variants: [
            { goods: 'gold', amount: 100000 }, { goods: 'garnet', amount: 10 },
        ]},
        { id: 84, count: 50, weight: 10, variants: [
            { goods: 'gold', amount: 450000 }, { goods: 'garnet', amount: 45 },
        ]},
        { id: 17,  count: 10, goods: 'gold',   amount: 1500000, weight: 1.4  },
        { id: 17,  count: 10, goods: 'garnet', amount: 90,      weight: 10   },
        { id: 17,  count: 50, goods: 'gold',   amount: 7000000, weight: 0.25 },
        { id: 17,  count: 50, goods: 'garnet', amount: 540,     weight: 3    },
        { id: 112, count: 10, goods: 'gold',   amount: 5500000, weight: 0.125 },
        { id: 112, count: 10, goods: 'garnet', amount: 300,     weight: 3    },
        { id: 36,  count: 5,  goods: 'gold',   amount: 2500000, weight: 0.125 },
        { id: 36,  count: 5,  goods: 'garnet', amount: 250,     weight: 2    },
        { id: 177, count: 3,  goods: 'gold',   amount: 3500000, weight: 0.1  },
        { id: 177, count: 3,  goods: 'garnet', amount: 280,     weight: 2    },
    ]},
];

function getHotDealPeriodKey(date) {
    const d = date || new Date();
    const kstMs = d.getTime() + 9 * 3600000;
    const kst = new Date(kstMs);
    const y = kst.getUTCFullYear();
    const m = String(kst.getUTCMonth() + 1).padStart(2, '0');
    const day = String(kst.getUTCDate()).padStart(2, '0');
    const seg = Math.floor(kst.getUTCHours() / 6);
    return y + '-' + m + '-' + day + '-' + seg;
}

function getNextHotDealRefreshMs(date) {
    const d = date || new Date();
    const kstMs = d.getTime() + 9 * 3600000;
    const kst = new Date(kstMs);
    const seg = Math.floor(kst.getUTCHours() / 6);
    const nextHour = (seg + 1) * 6;
    const next = new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate(), nextHour, 0, 0));
    return next.getTime() - 9 * 3600000;
}

function hotdealPeriodSeed(key) {
    let h = 0x811C9DC5;
    for (let i = 0; i < key.length; i++) { h = Math.imul(h ^ key.charCodeAt(i), 0x01000193) | 0; }
    return h >>> 0;
}

function hotdealRng(seed) {
    let s = seed >>> 0;
    return function() {
        s = Math.imul(s + 0x6D2B79F5, s ^ (s >>> 16)) | 0;
        let t = Math.imul(s ^ s >>> 15, 1 | s);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}

function hotdealWeightedPick(pool, rng) {
    const total = pool.reduce((s, e) => s + e.weight, 0);
    let r = rng() * total;
    for (const e of pool) { r -= e.weight; if (r <= 0) return e; }
    return pool[pool.length - 1];
}

function hotdealPeriodIndex(periodKey) {
    // periodKey: "YYYY-MM-DD-N"
    const [y, m, d, seg] = periodKey.split('-').map(Number);
    const epoch = Date.UTC(y, m - 1, d) / 86400000;
    return epoch * 4 + seg;
}

function getHotDealSectorIndex(periodKey) {
    return hotdealPeriodIndex(periodKey) % HOTDEAL_SECTORS.length;
}

function hotdealItemId(item) {
    if (Number.isInteger(item.id) && item.id >= 0) return item.id;
    const itemName = String(item.itemName || '');
    const items = rpgenius.getDataCache('Item', []);
    const id = items.findIndex(data => data && data.name === itemName);
    if (id < 0) throw new Error('핫딜 아이템 데이터를 찾을 수 없습니다: ' + itemName);
    return id;
}

// 병합된 확률 셀은 그룹을 먼저 뽑고, 아래 가격 변형 중 하나를 균등 선택한다.
function hotdealItemVariants(item) {
    let variants;
    if (Array.isArray(item.variants)) variants = item.variants;
    else if (Array.isArray(item.amounts)) variants = item.amounts.map(amount => ({ goods: item.goods, amount }));
    else variants = [{ goods: item.goods, amount: item.amount }];
    const id = hotdealItemId(item);
    return variants.map(variant => ({
        id,
        count: item.count,
        goods: variant.goods,
        amount: variant.amount,
    }));
}

// 섹터의 선택 가능한 모든 가격 변형을 펼쳐서 반환 (편집 드롭다운용)
function hotdealSectorOptions(sectorIdx) {
    const sector = HOTDEAL_SECTORS[sectorIdx];
    if (!sector) return [];
    return sector.items.flatMap(hotdealItemVariants);
}

function getHotDealOverride(periodKey) {
    const all = rpgenius.getDataCache('HotDealOverride', {}) || {};
    return all[periodKey] || null;
}

function generateHotDeal(periodKey) {
    const sectorIdx = getHotDealSectorIndex(periodKey);
    const sector = HOTDEAL_SECTORS[sectorIdx];
    const override = getHotDealOverride(periodKey);
    if (override && Array.isArray(override.picks) && override.picks.length === 2) {
        const options = hotdealSectorOptions(sectorIdx);
        const picks = override.picks.map(p => options.find(option =>
            option.id === Number(p.id)
            && option.count === Number(p.count)
            && option.goods === String(p.goods)
            && option.amount === Number(p.amount)
        ));
        if (picks.every(Boolean)) return { sectorName: sector.name, picks: picks.map(p => ({ ...p })), edited: true };
    }
    const rng = hotdealRng(hotdealPeriodSeed(periodKey));
    const firstIdx = sector.items.indexOf(hotdealWeightedPick(sector.items, rng));
    const pool2 = sector.items.filter((_, i) => i !== firstIdx);
    const second = hotdealWeightedPick(pool2, rng);
    const picks = [sector.items[firstIdx], second].map(item => {
        const variants = hotdealItemVariants(item);
        return variants[Math.floor(rng() * variants.length)];
    });
    return { sectorName: sector.name, picks, edited: false };
}

function buildHotDealData(user) {
    const now = new Date();
    const periodKey = getHotDealPeriodKey(now);
    const deal = generateHotDeal(periodKey);
    const items = rpgenius.getDataCache('Item', []);
    const purchases = ((user.hotDealPurchases || {})[periodKey]) || [];
    return {
        periodKey,
        sectorName: deal.sectorName,
        nextRefreshAt: getNextHotDealRefreshMs(now),
        currencies: { gold: Number(user.gold || 0), garnet: Number(user.garnet || 0) },
        items: deal.picks.map((pick, slot) => {
            const itemData = items[pick.id];
            const assets = itemData ? getItemDisplayAssets(itemData) : { iconUrl: null, frameUrl: null };
            return {
                slot,
                name: itemData ? (itemData.name + (pick.count > 1 ? ' x' + pick.count : '')) : '알 수 없음',
                count: pick.count,
                itemId: pick.id,
                iconUrl: assets.iconUrl,
                frameUrl: assets.frameUrl,
                price: { goods: pick.goods, amount: pick.amount, imgUrl: SHOP_CURR_IMG[pick.goods] || null },
                purchased: purchases.includes(slot),
            };
        }),
    };
}

server.get('/api/hotdeal', requireUser, async (req, res) => {
    try {
        const user = await rpgenius.getRPGUserByName(req.session.name);
        if (!user) return res.status(404).json({ error: '유저를 찾을 수 없습니다.' });
        res.json(buildHotDealData(user));
    } catch (e) {
        console.error('hotdeal error:', e);
        res.status(500).json({ error: '서버 오류' });
    }
});

server.post('/api/hotdeal/buy', requireUser, async (req, res) => {
    try {
        const slot = Number(req.body && req.body.slot);
        if (slot !== 0 && slot !== 1) return res.status(400).json({ error: '슬롯이 올바르지 않습니다.' });
        const user = await rpgenius.getRPGUserByName(req.session.name);
        if (!user) return res.status(404).json({ error: '유저를 찾을 수 없습니다.' });
        ensureInventoryShape(user);
        const now = new Date();
        const periodKey = getHotDealPeriodKey(now);
        const deal = generateHotDeal(periodKey);
        const pick = deal.picks[slot];
        if (!user.hotDealPurchases) user.hotDealPurchases = {};
        if (!user.hotDealPurchases[periodKey]) user.hotDealPurchases[periodKey] = [];
        if (user.hotDealPurchases[periodKey].includes(slot)) return res.status(400).json({ error: '이미 구매한 항목입니다.' });
        if (pick.goods === 'gold') {
            if (Number(user.gold || 0) < pick.amount) return res.status(400).json({ error: '골드가 부족합니다.' });
            user.gold = Number(user.gold || 0) - pick.amount;
        } else if (pick.goods === 'garnet') {
            if (Number(user.garnet || 0) < pick.amount) return res.status(400).json({ error: '가넷이 부족합니다.' });
            user.garnet = Number(user.garnet || 0) - pick.amount;
        }
        rpgenius.addInventoryItem(user, pick.id, pick.count);
        user.hotDealPurchases[periodKey].push(slot);
        // 이전 섹터 기록 정리
        Object.keys(user.hotDealPurchases).forEach(k => { if (k !== periodKey) delete user.hotDealPurchases[k]; });
        await user.save();
        res.json({ ok: true, hotdeal: buildHotDealData(user) });
    } catch (e) {
        console.error('hotdeal buy error:', e);
        res.status(500).json({ error: '서버 오류' });
    }
});

// ===== 경매장 =====

server.get('/api/auction', requireUser, async (req, res) => {
    try {
        const list = await getAuctionList();
        const me = req.session.name;
        const user = await rpgenius.getRPGUserByName(me);
        const equipmentContext = { entries: user ? buildInventoryEquipment(user) : [], setCache: {} };
        res.json({ items: list.map(entry => serializeAuctionEntry(entry, me, equipmentContext)) });
    } catch (e) {
        console.error('auction list error:', e);
        res.status(500).json({ error: '서버 오류' });
    }
});

server.get('/api/auction/sellable', requireUser, async (req, res) => {
    try {
        const user = await rpgenius.getRPGUserByName(req.session.name);
        if (!user) return res.status(404).json({ error: '유저를 찾을 수 없습니다.' });
        res.json(buildSellableAssets(user));
    } catch (e) {
        console.error('sellable error:', e);
        res.status(500).json({ error: '서버 오류' });
    }
});

server.post('/api/auction/register', requireUser, async (req, res) => {
    try {
        const out = await registerAuction(req.session.name, req.body || {});
        if (out.error) return res.status(400).json({ error: out.error });
        if (out.notice) sendAuctionKakaoNotice(out.notice);
        res.json({ ok: true, id: out.id });
    } catch (e) {
        console.error('auction register error:', e);
        res.status(500).json({ error: '서버 오류' });
    }
});

server.post('/api/auction/buy', requireUser, async (req, res) => {
    try {
        const out = await buyAuction(req.session.name, String((req.body && req.body.id) || ''), req.body && req.body.count);
        if (out.error) return res.status(400).json({ error: out.error });
        if (out.notice) sendAuctionKakaoNotice(out.notice);
        res.json({ ok: true });
    } catch (e) {
        console.error('auction buy error:', e);
        res.status(500).json({ error: '서버 오류' });
    }
});

server.post('/api/auction/cancel', requireUser, async (req, res) => {
    try {
        const out = await cancelAuction(req.session.name, String((req.body && req.body.id) || ''));
        if (out.error) return res.status(400).json({ error: out.error });
        res.json({ ok: true });
    } catch (e) {
        console.error('auction cancel error:', e);
        res.status(500).json({ error: '서버 오류' });
    }
});

// ===== 상점 =====

server.get('/api/shop', requireUser, async (req, res) => {
    try {
        await rpgenius.loadRpgeniusDataEntry('ShopState');
        const user = await rpgenius.getRPGUserByName(req.session.name);
        if (!user) return res.status(404).json({ error: '유저를 찾을 수 없습니다.' });
        res.json(buildShopData(user));
    } catch (e) {
        console.error('shop error:', e);
        res.status(500).json({ error: '서버 오류' });
    }
});

server.post('/api/shop/buy', requireUser, async (req, res) => {
    try {
        const out = await buyShopItem(req.session.name, req.body || {});
        if (out.error) return res.status(400).json(out);
        res.json(out);
    } catch (e) {
        console.error('shop buy error:', e);
        res.status(500).json({ error: '서버 오류' });
    }
});

// ===== 삽니다 (구매 등록) =====

server.get('/api/buyorder', requireUser, async (req, res) => {
    try {
        const list = await getBuyOrderList();
        const me = req.session.name;
        res.json({ items: list.map(entry => serializeBuyOrderEntry(entry, me)) });
    } catch (e) {
        console.error('buyorder list error:', e);
        res.status(500).json({ error: '서버 오류' });
    }
});

server.get('/api/buyorder/lookups', requireUser, (req, res) => {
    try {
        const lookups = buildBuyOrderLookups();
        const fashion = rpgenius.getDataCache('Fashion', []);
        lookups.fashion = (fashion || []).map(skin => skin ? {
            name: skin.name,
            primary_card: Array.isArray(skin.primary_card) ? skin.primary_card : [],
            requireStar: Number(skin.requireStar || 0)
        } : null).filter(Boolean);
        res.json(lookups);
    } catch (e) {
        console.error('buyorder lookups error:', e);
        res.status(500).json({ error: '서버 오류' });
    }
});

server.get('/api/buyorder/fulfillable', requireUser, async (req, res) => {
    try {
        const orderId = String(req.query.id || '');
        if (!orderId) return res.status(400).json({ error: '구매 등록 ID가 비어있습니다.' });
        const list = await getBuyOrderList();
        const entry = list.find(item => item.id == orderId);
        if (!entry) return res.status(404).json({ error: '존재하지 않는 구매 등록입니다.' });
        const user = await rpgenius.getRPGUserByName(req.session.name);
        if (!user) return res.status(404).json({ error: '유저를 찾을 수 없습니다.' });
        res.json(buildFulfillableAssets(user, entry));
    } catch (e) {
        console.error('buyorder fulfillable error:', e);
        res.status(500).json({ error: '서버 오류' });
    }
});

server.post('/api/buyorder/register', requireUser, async (req, res) => {
    try {
        const out = await registerBuyOrder(req.session.name, req.body || {});
        if (out.error) return res.status(400).json({ error: out.error });
        if (out.notice) sendAuctionKakaoNotice(out.notice);
        res.json({ ok: true, id: out.id });
    } catch (e) {
        console.error('buyorder register error:', e);
        res.status(500).json({ error: '서버 오류' });
    }
});

server.post('/api/buyorder/fulfill', requireUser, async (req, res) => {
    try {
        const out = await fulfillBuyOrder(req.session.name, String((req.body && req.body.id) || ''), req.body || {});
        if (out.error) return res.status(400).json({ error: out.error });
        if (out.notice) sendAuctionKakaoNotice(out.notice);
        res.json({ ok: true });
    } catch (e) {
        console.error('buyorder fulfill error:', e);
        res.status(500).json({ error: '서버 오류' });
    }
});

server.post('/api/buyorder/cancel', requireUser, async (req, res) => {
    try {
        const out = await cancelBuyOrder(req.session.name, String((req.body && req.body.id) || ''));
        if (out.error) return res.status(400).json({ error: out.error });
        res.json({ ok: true });
    } catch (e) {
        console.error('buyorder cancel error:', e);
        res.status(500).json({ error: '서버 오류' });
    }
});

// ===== 파티 퀘스트 =====

server.get('/api/party/quests', requirePartyQuest, (req, res) => {
    res.json({ quests: partyquest.listQuestSummaries() });
});

server.get('/api/party/rooms', requirePartyQuest, (req, res) => {
    res.json({ rooms: partyquest.publicRoomList(), my: partyquest.getMyRoomSnapshot(req.session.name) });
});

server.get('/api/party/me', requirePartyQuest, (req, res) => {
    res.json({ room: partyquest.getMyRoomSnapshot(req.session.name) });
});

server.post('/api/party/rooms', requirePartyQuest, async (req, res) => {
    const questId = String((req.body && req.body.questId) || '').trim();
    const password = String((req.body && req.body.password) || '');
    const out = await partyquest.createRoom(req.session.name, questId, password);
    if (out.error) return res.status(400).json({ error: out.error });
    res.json(out);
});

server.post('/api/party/rooms/:id/join', requirePartyQuest, async (req, res) => {
    const out = await partyquest.joinRoom(String(req.params.id || ''), req.session.name, String((req.body && req.body.password) || ''));
    if (out.error) return res.status(400).json({ error: out.error });
    res.json(out);
});

server.post('/api/party/leave', requirePartyQuest, (req, res) => {
    res.json(partyquest.leaveRoom(req.session.name));
});

server.post('/api/party/position', requirePartyQuest, (req, res) => {
    const position = String((req.body && req.body.position) || '').trim();
    const out = partyquest.setPosition(req.session.name, position || null);
    if (out.error) return res.status(400).json({ error: out.error });
    res.json(out);
});

server.post('/api/party/ready', requirePartyQuest, (req, res) => {
    const ready = !!(req.body && req.body.ready);
    const out = partyquest.setReady(req.session.name, ready);
    if (out.error) return res.status(400).json({ error: out.error });
    res.json(out);
});

server.post('/api/party/potions', requirePartyQuest, async (req, res) => {
    try {
        const items = (req.body && req.body.items) || [];
        const out = await partyquest.setPotions(req.session.name, items);
        if (out.error) return res.status(400).json({ error: out.error });
        res.json(out);
    } catch (e) {
        console.error('party potions error:', e);
        res.status(500).json({ error: '서버 오류' });
    }
});

server.get('/api/party/potions/available', requirePartyQuest, async (req, res) => {
    try {
        const list = await partyquest.getAvailablePotions(req.session.name);
        res.json({ potions: list });
    } catch (e) {
        console.error('party potions available error:', e);
        res.status(500).json({ error: '서버 오류' });
    }
});

server.post('/api/party/use-potion', requirePartyQuest, async (req, res) => {
    try {
        const name = String((req.body && req.body.name) || '').trim();
        const out = await partyquest.usePotion(req.session.name, name);
        if (out.error) return res.status(400).json({ error: out.error });
        res.json(out);
    } catch (e) {
        console.error('party use-potion error:', e);
        res.status(500).json({ error: '서버 오류' });
    }
});

server.post('/api/party/start', requirePartyQuest, async (req, res) => {
    try {
        const out = await partyquest.start(req.session.name);
        if (out.error) return res.status(400).json({ error: out.error });
        res.json(out);
    } catch (e) {
        console.error('party start error:', e);
        res.status(500).json({ error: '서버 오류' });
    }
});

server.post('/api/party/restart', requirePartyQuest, (req, res) => {
    const out = partyquest.restartQuest(req.session.name);
    if (out.error) return res.status(400).json({ error: out.error });
    res.json(out);
});

server.post('/api/party/attack', requirePartyQuest, (req, res) => {
    const out = partyquest.attackMobPhase(req.session.name);
    if (out.error) return res.status(400).json({ error: out.error });
    res.json(out);
});

server.post('/api/party/skill', requirePartyQuest, (req, res) => {
    const skill = String((req.body && req.body.skill) || '').trim();
    const target = req.body && req.body.target ? String(req.body.target) : null;
    const out = partyquest.useSkill(req.session.name, skill, target);
    if (out.error) return res.status(400).json({ error: out.error });
    res.json(out);
});

server.post('/api/party/pick-skill', requirePartyQuest, (req, res) => {
    const skill = String((req.body && req.body.skill) || '').trim();
    const out = partyquest.pickRandomSkill(req.session.name, skill);
    if (out.error) return res.status(400).json({ error: out.error });
    res.json(out);
});

server.post('/api/party/vote', requirePartyQuest, (req, res) => {
    const target = String((req.body && req.body.target) || '').trim();
    const out = partyquest.castVote(req.session.name, target);
    if (out.error) return res.status(400).json({ error: out.error });
    res.json(out);
});

server.post('/api/party/support-skill', requirePartyQuest, (req, res) => {
    const skill = String((req.body && req.body.skill) || '').trim();
    const out = partyquest.useSupportSkill(req.session.name, skill);
    if (out.error) return res.status(400).json({ error: out.error });
    res.json(out);
});

server.post('/api/party/chat', requirePartyQuest, (req, res) => {
    const text = String((req.body && req.body.text) || '');
    const out = partyquest.chat(req.session.name, text);
    if (out.error) return res.status(400).json({ error: out.error });
    res.json(out);
});

server.get('/api/party/stream', requirePartyQuest, (req, res) => {
    partyquest.attachStream(req.session.name, res);
});

server.get('/card-image', requireUser, (req, res) => {
    const name = String(req.query.name || '');
    const file = String(req.query.file || '');
    if (!name || !file || name.includes('..') || file.includes('..') || path.basename(name) != name || path.basename(file) != file) return res.status(400).end();
    const filePath = path.join(CARD_IMAGE_PATH, name, file);
    if (!filePath.startsWith(path.join(CARD_IMAGE_PATH, name)) || !fs.existsSync(filePath)) return res.status(404).end();
    res.sendFile(filePath);
});

server.get('/item-image', requireUser, (req, res) => {
    const dir = String(req.query.dir || '');
    const file = String(req.query.file || '');
    if (!dir || !file || dir.includes('..') || file.includes('..') || path.basename(dir) != dir || path.basename(file) != file) return res.status(400).end();
    const dirPath = path.join(ITEM_IMAGE_PATH, dir);
    const filePath = path.join(dirPath, file);
    if (!filePath.startsWith(dirPath) || !fs.existsSync(filePath)) return res.status(404).end();
    res.sendFile(filePath);
});

const RPG_UI_PATH = path.join(__dirname, 'DB', 'RPGenius', 'ui');

// 하위 폴더(예: '부타게임/타부자고.png')도 허용. 경로 이탈은 '..' 차단 + 해석 경로 검사로 막는다.
server.get('/rpg-ui', requireUser, (req, res) => {
    const file = String(req.query.file || '');
    if (!file || file.includes('..')) return res.status(400).end();
    const filePath = path.resolve(RPG_UI_PATH, file);
    if (!filePath.startsWith(RPG_UI_PATH + path.sep) || !fs.existsSync(filePath)) return res.status(404).end();
    res.sendFile(filePath);
});

const COMBINE_UI_PATH = path.join(__dirname, 'DB', 'RPGenius', 'ui', '조합');

server.get('/combine-ui', requireUser, (req, res) => {
    const file = String(req.query.file || '');
    if (!file || file.includes('..') || path.basename(file) != file) return res.status(400).end();
    const filePath = path.join(COMBINE_UI_PATH, file);
    if (!filePath.startsWith(COMBINE_UI_PATH) || !fs.existsSync(filePath)) return res.status(404).end();
    res.sendFile(filePath);
});

const LOCKBOX_UI_PATH = path.join(__dirname, 'DB', 'RPGenius', 'ui', '봉인된 자물쇠');

server.get('/lockbox-ui', requireUser, (req, res) => {
    const file = String(req.query.file || '');
    if (!file || file.includes('..') || path.basename(file) != file) return res.status(400).end();
    const filePath = path.join(LOCKBOX_UI_PATH, file);
    if (!filePath.startsWith(LOCKBOX_UI_PATH) || !fs.existsSync(filePath)) return res.status(404).end();
    res.sendFile(filePath);
});

server.get('/rpg-ui-title', requireUser, (req, res) => {
    const file = String(req.query.file || '');
    if (!file || file.includes('..') || path.basename(file) != file) return res.status(400).end();
    const filePath = path.join(rpgenius.TITLE_IMAGE_PATH, file);
    if (!filePath.startsWith(rpgenius.TITLE_IMAGE_PATH) || !fs.existsSync(filePath)) return res.status(404).end();
    res.sendFile(filePath);
});

// ===== 유저 검색 / 재화 지급 =====

server.get('/api/users/search', requireAdmin, async (req, res) => {
    const name = String(req.query.name || '').trim();
    if (!name) return res.status(400).json({ error: '닉네임을 입력해주세요.' });
    try {
        const user = await rpgenius.getRPGUserByName(name);
        if (!user) return res.status(404).json({ error: '존재하지 않는 유저입니다.' });
        res.json({
            name: user.name,
            level: user.level,
            gold: user.gold,
            garnet: user.garnet,
            point: user.point,
            mileage: user.mileage,
            isAdmin: !!user.isAdmin
        });
    } catch (e) {
        console.error('search error:', e);
        res.status(500).json({ error: '서버 오류' });
    }
});

const GOODS_KEYS = ['gold', 'garnet', 'point', 'mileage'];

server.post('/api/users/grant', requireAdmin, async (req, res) => {
    const name = String((req.body && req.body.name) || '').trim();
    const kind = String((req.body && req.body.kind) || '').trim();
    const amount = Number((req.body && req.body.amount) || 0);
    if (!name) return res.status(400).json({ error: '닉네임을 입력해주세요.' });
    if (kind != 'equipment' && (!Number.isInteger(amount) || amount == 0)) return res.status(400).json({ error: '수량은 0이 아닌 정수여야 합니다.' });

    try {
        const user = await rpgenius.getRPGUserByName(name);
        if (!user) return res.status(404).json({ error: '존재하지 않는 유저입니다.' });

        if (kind == 'equipment') {
            const equipType = String((req.body && req.body.equipType) || '');
            const equipId = Number(req.body && req.body.equipId);
            const level = Math.max(0, Math.floor(Number((req.body && req.body.level) || 0)));
            const equipments = rpgenius.getDataCache('Equipment', {});
            const data = equipments[equipType] && equipments[equipType][equipId];
            if (!data) return res.status(404).json({ error: '존재하지 않는 장비입니다.' });
            if (!user.inventory) user.inventory = { card: [], item: [], equipment: [], pet: [] };
            if (!Array.isArray(user.inventory.equipment)) user.inventory.equipment = [];
            user.inventory.equipment.push({ type: equipType, id: equipId, level });
            await user.save();
            return res.json({ ok: true, name: user.name, kind: 'equipment', equipName: data.name, level });
        }

        if (GOODS_KEYS.includes(kind)) {
            const before = Number(user[kind] || 0);
            const after = before + amount;
            if (after < 0) return res.status(400).json({ error: '결과가 0보다 작을 수 없습니다. (현재 ' + before + ')' });
            user[kind] = after;
            await user.save();
            return res.json({ ok: true, name: user.name, kind, before, after, delta: amount });
        }

        if (kind == 'item') {
            const itemName = String((req.body && req.body.itemName) || '').trim();
            if (!itemName) return res.status(400).json({ error: '아이템명을 입력해주세요.' });
            const items = rpgenius.getDataCache('Item', []);
            const itemId = items.findIndex(item => item && item.name == itemName);
            if (itemId == -1) return res.status(404).json({ error: '존재하지 않는 아이템입니다.' });
            if (amount > 0) {
                rpgenius.addInventoryItem(user, itemId, amount);
            } else {
                const have = rpgenius.getInventoryItemCount(user, itemId);
                if (have < -amount) return res.status(400).json({ error: '대상 보유 수량이 부족합니다. (보유 ' + have + ')' });
                rpgenius.removeInventoryItem(user, itemId, -amount);
                rpgenius.cleanupInventoryItems(user);
            }
            await user.save();
            return res.json({ ok: true, name: user.name, kind: 'item', itemId, itemName, delta: amount });
        }

        return res.status(400).json({ error: '알 수 없는 종류입니다.' });
    } catch (e) {
        console.error('grant error:', e);
        res.status(500).json({ error: '서버 오류' });
    }
});

// ===== Lookup (드롭다운 / 픽커 데이터) =====

server.get('/api/lookup/items', requireAdmin, (req, res) => {
    const items = rpgenius.getDataCache('Item', []);
    res.json(items.map((it, id) => it ? { id, name: it.name, type: it.type, desc: it.desc } : null).filter(Boolean));
});

server.get('/api/lookup/equipment', requireAdmin, (req, res) => {
    const eq = rpgenius.getDataCache('Equipment', {});
    const pack = list => (list || []).map((e, id) => e ? { id, name: e.name, rarity: e.rarity } : null).filter(Boolean);
    res.json({ weapon: pack(eq.weapon), hat: pack(eq.hat), armor: pack(eq.armor), pants: pack(eq.pants), shoes: pack(eq.shoes), accessory: pack(eq.accessory), support: pack(eq.support) });
});

server.get('/api/lookup/equipment-passives', requireAdmin, (req, res) => {
    const passives = rpgenius.getEquipmentPassives();
    res.json(passives.map((p, i) => ({ id: i, name: p ? p.name : '?' })));
});

server.get('/api/lookup/titles', requireAdmin, (req, res) => {
    res.json(rpgenius.getTitleDefs().map(t => ({ id: t.id, name: t.name })));
});

server.get('/api/lookup/cards', requireAdmin, (req, res) => {
    const cards = readJson(CHARACTER_CARDS_PATH, []);
    res.json(cards.map((card, id) => card ? { id, name: card.name } : null).filter(Boolean));
});

server.get('/api/lookup/pet', requireAdmin, (req, res) => {
    const pets = rpgenius.getDataCache('Pet', []);
    res.json((Array.isArray(pets) ? pets : []).map((p, id) => p ? { id, name: p.name, rarity: p.rarity } : null).filter(Boolean));
});

server.get('/api/lookup/fashion', requireAdmin, (req, res) => {
    const fashion = rpgenius.getDataCache('Fashion', []);
    res.json((fashion || []).map(skin => skin ? {
        name: skin.name,
        primary_card: Array.isArray(skin.primary_card) ? skin.primary_card : [],
        requireStar: Number(skin.requireStar || 0)
    } : null).filter(Boolean));
});

// ===== rpgenius_data 관리 =====

server.get('/api/data', requireAdmin, (req, res) => {
    res.json({ keys: rpgenius.RPGENIUS_DATA_KEYS });
});

server.get('/api/data/:key', requireAdmin, async (req, res) => {
    const key = String(req.params.key);
    if (!rpgenius.RPGENIUS_DATA_KEYS.includes(key)) return res.status(400).json({ error: '허용되지 않은 키입니다.' });
    try {
        await rpgenius.loadRpgeniusDataEntry(key);
        const data = rpgenius.getDataCache(key, null);
        res.json({ key, data });
    } catch (e) {
        console.error('data get error:', e);
        res.status(500).json({ error: '서버 오류' });
    }
});

server.put('/api/data/:key', requireAdmin, async (req, res) => {
    const key = String(req.params.key);
    if (!rpgenius.RPGENIUS_DATA_KEYS.includes(key)) return res.status(400).json({ error: '허용되지 않은 키입니다.' });
    if (!req.body || typeof req.body.data == 'undefined') return res.status(400).json({ error: 'data 필드가 비어있습니다.' });
    if (key == 'Equipment') {
        const requiredSlots = ['weapon', 'hat', 'armor', 'pants', 'shoes', 'accessory', 'support'];
        const missingSlots = requiredSlots.filter(slot => !Array.isArray(req.body.data && req.body.data[slot]));
        if (missingSlots.length > 0) return res.status(400).json({ error: 'Equipment 필수 부위가 누락되었습니다: ' + missingSlots.join(', ') });
    }
    try {
        await rpgenius.saveRpgeniusDataEntry(key, req.body.data);
        res.json({ ok: true, key });
    } catch (e) {
        console.error('data put error:', e);
        res.status(500).json({ error: e.message || '서버 오류' });
    }
});

server.get('/api/admin/hotdeal/preview', requireAdmin, (req, res) => {
    try {
        const { date, seg } = req.query;
        // Build a range: if date given, return that day's 4 segments; if date+seg, return just that one
        const items = rpgenius.getDataCache('Item', []);
        const itemName = id => (items[id] && items[id].name) ? items[id].name : (id === 0 ? '강화석' : `아이템#${id}`);
        const itemIcon = id => { const d = items[id]; return d ? getItemIconUrl(d) : null; };
        const formatHotdealResult = (periodKey) => {
            const d = generateHotDeal(periodKey);
            const sectorIdx = getHotDealSectorIndex(periodKey);
            return {
                periodKey,
                sectorName: d.sectorName,
                sectorIdx,
                edited: !!d.edited,
                slots: d.picks.map(p => ({
                    itemId: p.id,
                    name: itemName(p.id),
                    iconUrl: itemIcon(p.id),
                    count: p.count,
                    goods: p.goods,
                    amount: p.amount,
                })),
                options: hotdealSectorOptions(sectorIdx).map(o => ({
                    id: o.id, count: o.count, goods: o.goods, amount: o.amount,
                    name: itemName(o.id), iconUrl: itemIcon(o.id),
                    label: itemName(o.id) + (o.count > 1 ? ' ×' + o.count : '') + ' / ' + (o.goods === 'gold' ? '골드' : '가넷') + ' ' + Number(o.amount).toLocaleString(),
                })),
            };
        };
        if (date && seg != null) {
            const segN = Number(seg);
            if (!date.match(/^\d{4}-\d{2}-\d{2}$/) || segN < 0 || segN > 3) return res.status(400).json({ error: '잘못된 파라미터' });
            return res.json(formatHotdealResult(`${date}-${segN}`));
        }
        if (date) {
            if (!date.match(/^\d{4}-\d{2}-\d{2}$/)) return res.status(400).json({ error: '잘못된 날짜' });
            return res.json([0, 1, 2, 3].map(s => formatHotdealResult(`${date}-${s}`)));
        }
        // default: return today (KST) all 4 segments
        const now = new Date();
        const kstMs = now.getTime() + 9 * 3600000;
        const kst = new Date(kstMs);
        const y = kst.getUTCFullYear();
        const m = String(kst.getUTCMonth() + 1).padStart(2, '0');
        const day = String(kst.getUTCDate()).padStart(2, '0');
        const today = `${y}-${m}-${day}`;
        return res.json([0, 1, 2, 3].map(s => formatHotdealResult(`${today}-${s}`)));
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

server.post('/api/admin/hotdeal/override', requireAdmin, async (req, res) => {
    try {
        const periodKey = String((req.body && req.body.periodKey) || '');
        const picks = req.body && req.body.picks;
        if (!periodKey.match(/^\d{4}-\d{2}-\d{2}-[0-3]$/)) return res.status(400).json({ error: '잘못된 기간 키' });
        if (!Array.isArray(picks) || picks.length !== 2) return res.status(400).json({ error: '슬롯 2개를 지정해야 합니다.' });
        // 섹터는 변경 불가 — 제출된 각 항목이 해당 섹터의 유효 옵션인지 검증
        const sectorIdx = getHotDealSectorIndex(periodKey);
        const options = hotdealSectorOptions(sectorIdx);
        const normalized = [];
        for (const p of picks) {
            const match = options.find(o => o.id === Number(p.id) && o.count === Number(p.count) && o.goods === String(p.goods) && o.amount === Number(p.amount));
            if (!match) return res.status(400).json({ error: '해당 섹터에 존재하지 않는 항목입니다.' });
            normalized.push({ id: match.id, count: match.count, goods: match.goods, amount: match.amount });
        }
        const all = Object.assign({}, rpgenius.getDataCache('HotDealOverride', {}) || {});
        all[periodKey] = { picks: normalized };
        await rpgenius.saveRpgeniusDataEntry('HotDealOverride', all);
        res.json({ ok: true });
    } catch (e) {
        console.error('hotdeal override error:', e);
        res.status(500).json({ error: e.message });
    }
});

server.post('/api/admin/hotdeal/override/reset', requireAdmin, async (req, res) => {
    try {
        const periodKey = String((req.body && req.body.periodKey) || '');
        if (!periodKey.match(/^\d{4}-\d{2}-\d{2}-[0-3]$/)) return res.status(400).json({ error: '잘못된 기간 키' });
        const all = Object.assign({}, rpgenius.getDataCache('HotDealOverride', {}) || {});
        if (all[periodKey]) {
            delete all[periodKey];
            await rpgenius.saveRpgeniusDataEntry('HotDealOverride', all);
        }
        res.json({ ok: true });
    } catch (e) {
        console.error('hotdeal override reset error:', e);
        res.status(500).json({ error: e.message });
    }
});

// 패키지 등록: 번들 생성 -> 개봉 아이템 생성(번들 연결) -> 상점 등록을 한 번에 처리
server.post('/api/admin/package/create', requireAdmin, async (req, res) => {
    try {
        const b = req.body || {};
        const name = String(b.name || '').trim();
        const desc = String(b.desc || '');
        const rewards = Array.isArray(b.rewards) ? b.rewards : [];
        const shopType = String(b.shopType || '').trim();
        const price = b.price || {};
        const goods = String(price.goods || 'garnet');
        const amount = Math.floor(Number(price.amount));
        if (!name) return res.status(400).json({ error: '패키지 이름을 입력하세요.' });
        if (rewards.length < 1 || rewards.length > 10) return res.status(400).json({ error: '구성 보상은 1~10개여야 합니다.' });
        if (!['gold', 'garnet', 'point', 'mileage'].includes(goods)) return res.status(400).json({ error: '잘못된 결제 수단입니다.' });
        if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: '가격을 입력하세요.' });

        await rpgenius.loadRpgeniusDataEntry('Bundle');
        await rpgenius.loadRpgeniusDataEntry('Item');
        await rpgenius.loadRpgeniusDataEntry('Shop');
        const items = rpgenius.getDataCache('Item', []) || [];
        const shop = rpgenius.getDataCache('Shop', {}) || {};
        if (!Array.isArray(shop[shopType])) return res.status(400).json({ error: '존재하지 않는 상점 종류: ' + shopType });

        const REWARD_KINDS = ['골드', '가넷', '포인트', '마일리지', '아이템'];
        const bundleEntries = [];
        for (const r of rewards) {
            const type = String(r.type || '');
            const count = Math.floor(Number(r.count));
            if (!REWARD_KINDS.includes(type)) return res.status(400).json({ error: '지원하지 않는 보상 타입: ' + type });
            if (!Number.isFinite(count) || count <= 0) return res.status(400).json({ error: '보상 수량이 잘못되었습니다.' });
            const entry = { type, count: { min: count, max: count } };
            if (type === '아이템') {
                const itemId = Number(r.item_id);
                if (!items[itemId]) return res.status(400).json({ error: '존재하지 않는 아이템: #' + r.item_id });
                entry.item_id = itemId;
            }
            bundleEntries.push(entry);
        }

        const bundles = rpgenius.getDataCache('Bundle', []) || [];
        bundles.push(bundleEntries);
        const bundleIndex = bundles.length - 1;
        await rpgenius.saveRpgeniusDataEntry('Bundle', bundles);

        const newItem = { name, type: '번들', desc, pack: bundleIndex };
        if (b.noTrade) newItem.no_trade = true;
        items.push(newItem);
        const itemIndex = items.length - 1;
        await rpgenius.saveRpgeniusDataEntry('Item', items);

        const shopEntry = { type: '아이템', item_id: itemIndex, count: 1, price: { goods, amount } };
        const limits = {};
        ['max', 'daily', 'weekly', 'monthly', 'global'].forEach(k => {
            const v = Math.floor(Number(b.limits && b.limits[k]));
            if (Number.isFinite(v) && v > 0) limits[k] = v;
        });
        if (Object.keys(limits).length) shopEntry.limits = limits;
        shop[shopType].push(shopEntry);
        await rpgenius.saveRpgeniusDataEntry('Shop', shop);

        res.json({ ok: true, bundleIndex, itemIndex, shopType, shopIndex: shop[shopType].length - 1 });
    } catch (e) {
        console.error('package create error:', e);
        res.status(500).json({ error: e.message || '서버 오류' });
    }
});

server.post('/api/admin/shop-limits/reset', requireAdmin, async (req, res) => {
    const scope = String((req.body && req.body.scope) || '').trim();
    const shopType = String((req.body && req.body.shopType) || '').trim();
    const index = Number(req.body && req.body.index);
    if (!['all', 'shop', 'item'].includes(scope)) return res.status(400).json({ error: '초기화 범위가 올바르지 않습니다.' });
    if ((scope == 'shop' || scope == 'item') && !shopType) return res.status(400).json({ error: '상점 종류를 선택해주세요.' });
    if (scope == 'item' && (!Number.isInteger(index) || index < 0)) return res.status(400).json({ error: '상품 번호가 올바르지 않습니다.' });
    try {
        const users = await rpgenius.getAllRPGUsers();
        let userUpdated = 0;
        for (const user of users) {
            if (!user.shopPurchases || typeof user.shopPurchases != 'object') continue;
            let changed = false;
            if (scope == 'all') {
                if (Object.keys(user.shopPurchases).length > 0) {
                    delete user.shopPurchases;
                    changed = true;
                }
            } else if (scope == 'shop') {
                if (user.shopPurchases[shopType]) {
                    delete user.shopPurchases[shopType];
                    changed = true;
                }
            } else if (scope == 'item') {
                const key = String(index);
                if (user.shopPurchases[shopType] && user.shopPurchases[shopType][key]) {
                    delete user.shopPurchases[shopType][key];
                    if (Object.keys(user.shopPurchases[shopType]).length == 0) delete user.shopPurchases[shopType];
                    changed = true;
                }
            }
            if (changed) {
                await user.save();
                userUpdated++;
            }
        }
        await rpgenius.loadRpgeniusDataEntry('ShopState');
        const state = rpgenius.getDataCache('ShopState', {}) || {};
        let globalUpdated = 0;
        if (scope == 'all') {
            globalUpdated = Object.keys(state).length;
            await rpgenius.saveRpgeniusDataEntry('ShopState', {});
        } else if (scope == 'shop') {
            if (state[shopType]) {
                globalUpdated = Object.keys(state[shopType]).length;
                delete state[shopType];
                await rpgenius.saveRpgeniusDataEntry('ShopState', state);
            }
        } else if (scope == 'item') {
            const key = String(index);
            if (state[shopType] && state[shopType][key]) {
                delete state[shopType][key];
                if (Object.keys(state[shopType]).length == 0) delete state[shopType];
                globalUpdated = 1;
                await rpgenius.saveRpgeniusDataEntry('ShopState', state);
            }
        }
        res.json({ ok: true, scope, shopType, index, userUpdated, globalUpdated });
    } catch (e) {
        console.error('shop limit reset error:', e);
        res.status(500).json({ error: e.message || '서버 오류' });
    }
});

// ===== 거래 로그 (관리자) =====

server.get('/api/admin/tradelog', requireAdmin, async (req, res) => {
    try {
        const list = await getTradeLogList();
        const limit = Math.min(2000, Math.max(1, Number(req.query.limit || 500)));
        res.json({ items: list.slice(0, limit), total: list.length });
    } catch (e) {
        console.error('tradelog list error:', e);
        res.status(500).json({ error: '서버 오류' });
    }
});

server.get('/api/admin/event-dice-logs', requireAdmin, async (req, res) => {
    try {
        let data = rpgenius.getDataCache('Logs', null);
        if (!data) {
            await rpgenius.loadRpgeniusDataEntry('Logs');
            data = rpgenius.getDataCache('Logs', null);
        }
        const list = data && Array.isArray(data.eventDice) ? data.eventDice : [];
        const limit = Math.min(5000, Math.max(1, Number(req.query.limit || 1000)));
        res.json({ items: list.slice(0, limit), total: list.length });
    } catch (e) {
        console.error('event dice logs list error:', e);
        res.status(500).json({ error: '서버 오류' });
    }
});

server.get('/api/admin/point-logs', requireAdmin, async (req, res) => {
    try {
        let data = rpgenius.getDataCache('PointLogs', null);
        if (!data) {
            await rpgenius.loadRpgeniusDataEntry('PointLogs');
            data = rpgenius.getDataCache('PointLogs', null);
        }
        const list = Array.isArray(data) ? data : [];
        res.json({ items: list.slice().reverse(), total: list.length });
    } catch (e) {
        console.error('point logs list error:', e);
        res.status(500).json({ error: '서버 오류' });
    }
});

server.post('/api/admin/point-logs/cancel', requireAdmin, async (req, res) => {
    if (!supabaseP) return res.status(503).json({ error: '충전 기능이 설정되지 않았습니다.' });
    const id = String((req.body && req.body.id) || '');
    if (!id) return res.status(400).json({ error: '취소할 로그 ID가 없습니다.' });
    // 중간 실패 시 역순으로 실행되는 보상(rollback) 스택
    const rollback = [];
    try {
        await rpgenius.loadRpgeniusDataEntry('PointLogs').catch(() => {});
        const cached = rpgenius.getDataCache('PointLogs', []);
        const logs = Array.isArray(cached) ? cached.slice() : [];
        const entry = logs.find(l => l && l.id === id);
        if (!entry) return res.status(404).json({ error: '해당 충전 기록을 찾을 수 없습니다. (이미 취소되었을 수 있습니다)' });

        const amount = Number(entry.amount || 0);
        const lotto = Number(entry.lotto || 0);
        const company = Number(entry.company || 0);
        const lukim = Number(entry.lukim || 0);
        const kinder = Number(entry.kinder || 0);

        // 보유 rpgenius 포인트 확인
        const user = await rpgenius.getRPGUserByName(entry.nickname);
        if (!user) return res.status(404).json({ error: '유저를 찾을 수 없습니다.' });
        const curPoint = Number(user.point || 0);
        if (curPoint < amount) {
            return res.status(400).json({ error: '보유 포인트(' + curPoint.toLocaleString('ko-KR') + ')가 취소 포인트(' + amount.toLocaleString('ko-KR') + ')보다 적어 취소할 수 없습니다.' });
        }

        // 충전의 역연산 (각 단계마다 보상 등록)
        // 1) 포인트 회수
        const newPoint = curPoint - amount;
        user.point = newPoint;
        await user.save();
        rollback.push(async () => { user.point = curPoint; await user.save(); });

        // 2) 충전 계정 잔액 환불 (NameMatch 치환 적용)
        const storeNickname = await resolveStoreNickname(entry.nickname);
        const refundedBalance = await addSupabaseUserBalance(storeNickname, amount);
        rollback.push(() => addSupabaseUserBalance(storeNickname, -amount));

        // 3) 분배 회수
        await addSupabaseUserBalance('로또기금', -lotto);
        rollback.push(() => addSupabaseUserBalance('로또기금', lotto));
        await addSupabaseCompanyBalance('익테봇', -company);
        rollback.push(() => addSupabaseCompanyBalance('익테봇', company));
        await addSupabaseUserBalance('Lukim9', -lukim);
        rollback.push(() => addSupabaseUserBalance('Lukim9', lukim));
        await addSupabaseUserBalance('유치원생', -kinder);
        rollback.push(() => addSupabaseUserBalance('유치원생', kinder));

        // 4) 로그에서 제거
        await rpgenius.saveRpgeniusDataEntry('PointLogs', logs.filter(l => l !== entry));

        // 5) 카카오 알림 (성공 후 best-effort)
        sendKakaoNotice(POINT_CHARGE_NOTICE_CHANNEL_ID,
            '[ RPGenius 환불 ]\n' +
            '✅ ' + entry.nickname + ' ' + amount.toLocaleString('ko-KR') + ' P 환불 완료\n' +
            '💰 포인트 상점 잔액: ' + refundedBalance.toLocaleString('ko-KR') + ' P\n' +
            '💰 RPGenius 잔액: ' + newPoint.toLocaleString('ko-KR') + ' P\n' +
            '\n' +
            '- 로또기금: -' + lotto.toLocaleString('ko-KR') + ' P\n' +
            '- 익테봇: -' + company.toLocaleString('ko-KR') + ' P\n' +
            '- 유치원생: -' + kinder.toLocaleString('ko-KR') + ' P\n' +
            '- Lukim9: -' + lukim.toLocaleString('ko-KR') + ' P');

        res.json({ ok: true });
    } catch (e) {
        console.error('point log cancel error:', e);
        for (const undo of rollback.reverse()) {
            try { await undo(); } catch (re) { console.error('point log cancel rollback failed:', re); }
        }
        res.status(500).json({ error: '취소 처리에 실패하여 원래 상태로 복구했습니다.' });
    }
});

server.delete('/api/admin/tradelog', requireAdmin, async (req, res) => {
    try {
        await saveTradeLogList([]);
        res.json({ ok: true });
    } catch (e) {
        console.error('tradelog clear error:', e);
        res.status(500).json({ error: '서버 오류' });
    }
});

// ===== PITR 복원 / 마이그레이션 (관리자) =====

function getPitrTableInfo(table) {
    const name = String(table || '').trim();
    if (!PITR_TABLES[name]) throw new Error('허용되지 않은 테이블입니다.');
    return { name, ...PITR_TABLES[name] };
}

function serializeTableDescription(desc) {
    if (!desc) return null;
    return {
        name: desc.TableName,
        status: desc.TableStatus,
        itemCount: desc.ItemCount || 0,
        sizeBytes: desc.TableSizeBytes || 0,
        createdAt: desc.CreationDateTime
    };
}

async function describeDynamoTable(tableName) {
    try {
        const out = await dynamoClient.send(new DescribeTableCommand({ TableName: tableName }));
        return serializeTableDescription(out.Table);
    } catch (e) {
        if (e && e.name == 'ResourceNotFoundException') return null;
        throw e;
    }
}

async function scanTableSample(tableName, limit) {
    const out = await dynamoDocClient.send(new ScanCommand({ TableName: tableName, Limit: Math.min(25, Math.max(1, Number(limit || 10))) }));
    return out.Items || [];
}

async function batchWriteAll(tableName, items) {
    let written = 0;
    for (let i = 0; i < items.length; i += 25) {
        let requestItems = {
            [tableName]: items.slice(i, i + 25).map(item => ({ PutRequest: { Item: item } }))
        };
        while (requestItems[tableName] && requestItems[tableName].length > 0) {
            const out = await dynamoDocClient.send(new BatchWriteCommand({ RequestItems: requestItems }));
            requestItems = out.UnprocessedItems || {};
            if (requestItems[tableName] && requestItems[tableName].length > 0) await new Promise(resolve => setTimeout(resolve, 500));
        }
        written += items.slice(i, i + 25).length;
    }
    return written;
}

async function copyTableItems(sourceTable, targetTable) {
    let ExclusiveStartKey = null;
    let total = 0;
    do {
        const out = await dynamoDocClient.send(new ScanCommand({ TableName: sourceTable, ExclusiveStartKey }));
        const items = out.Items || [];
        if (items.length > 0) total += await batchWriteAll(targetTable, items);
        ExclusiveStartKey = out.LastEvaluatedKey;
    } while (ExclusiveStartKey);
    return total;
}

server.get('/api/admin/pitr/status', requireAdmin, async (req, res) => {
    try {
        const table = getPitrTableInfo(req.query.table || 'rpgenius_user');
        const backups = await dynamoClient.send(new DescribeContinuousBackupsCommand({ TableName: table.name }));
        const pitr = backups.ContinuousBackupsDescription && backups.ContinuousBackupsDescription.PointInTimeRecoveryDescription || {};
        const live = await describeDynamoTable(table.name);
        res.json({
            table: table.name,
            label: table.label,
            live,
            pitr: {
                status: pitr.PointInTimeRecoveryStatus || 'UNKNOWN',
                earliest: pitr.EarliestRestorableDateTime || null,
                latest: pitr.LatestRestorableDateTime || null
            }
        });
    } catch (e) {
        console.error('pitr status error:', e);
        res.status(500).json({ error: e.message || '서버 오류' });
    }
});

server.get('/api/admin/pitr/live', requireAdmin, async (req, res) => {
    try {
        const table = getPitrTableInfo(req.query.table || 'rpgenius_user');
        res.json({ table: table.name, info: await describeDynamoTable(table.name), sample: await scanTableSample(table.name, req.query.limit || 10) });
    } catch (e) {
        console.error('pitr live preview error:', e);
        res.status(500).json({ error: e.message || '서버 오류' });
    }
});

server.post('/api/admin/pitr/restore', requireAdmin, async (req, res) => {
    try {
        const table = getPitrTableInfo(req.body && req.body.table || 'rpgenius_user');
        const useLatest = !!(req.body && req.body.useLatest);
        const restoreTimeRaw = String(req.body && req.body.restoreTime || '').trim();
        if (!useLatest && !restoreTimeRaw) return res.status(400).json({ error: '복원 시점을 입력해주세요.' });
        const restoreDate = useLatest ? null : new Date(restoreTimeRaw);
        if (!useLatest && Number.isNaN(restoreDate.getTime())) return res.status(400).json({ error: '복원 시점 형식이 올바르지 않습니다.' });

        const backups = await dynamoClient.send(new DescribeContinuousBackupsCommand({ TableName: table.name }));
        const pitr = backups.ContinuousBackupsDescription && backups.ContinuousBackupsDescription.PointInTimeRecoveryDescription || {};
        if (pitr.PointInTimeRecoveryStatus != 'ENABLED') return res.status(400).json({ error: table.name + ' PITR이 활성화되어 있지 않습니다.' });
        if (!useLatest) {
            const earliest = new Date(pitr.EarliestRestorableDateTime);
            const latest = new Date(pitr.LatestRestorableDateTime);
            if (restoreDate < earliest || restoreDate > latest) return res.status(400).json({ error: '복원 가능 범위를 벗어난 시점입니다.' });
        }

        const jobId = crypto.randomBytes(8).toString('hex');
        const targetTable = table.name + '_restore_' + Date.now();
        const params = {
            SourceTableName: table.name,
            TargetTableName: targetTable,
            UseLatestRestorableTime: useLatest
        };
        if (!useLatest) params.RestoreDateTime = restoreDate;
        await dynamoClient.send(new RestoreTableToPointInTimeCommand(params));
        pitrJobs[jobId] = {
            id: jobId,
            sourceTable: table.name,
            targetTable,
            restoreTime: useLatest ? 'latest' : restoreDate.toISOString(),
            createdAt: new Date().toISOString(),
            migratedAt: null,
            migratedCount: 0
        };
        res.json({ ok: true, job: pitrJobs[jobId] });
    } catch (e) {
        console.error('pitr restore error:', e);
        res.status(500).json({ error: e.message || '서버 오류' });
    }
});

server.get('/api/admin/pitr/jobs/:id', requireAdmin, async (req, res) => {
    try {
        const job = pitrJobs[String(req.params.id || '')];
        if (!job) return res.status(404).json({ error: '복원 작업을 찾을 수 없습니다.' });
        const info = await describeDynamoTable(job.targetTable);
        const sample = info && info.status == 'ACTIVE' ? await scanTableSample(job.targetTable, req.query.limit || 10) : [];
        res.json({ job, info, sample });
    } catch (e) {
        console.error('pitr job status error:', e);
        res.status(500).json({ error: e.message || '서버 오류' });
    }
});

server.post('/api/admin/pitr/jobs/:id/migrate', requireAdmin, async (req, res) => {
    try {
        const job = pitrJobs[String(req.params.id || '')];
        if (!job) return res.status(404).json({ error: '복원 작업을 찾을 수 없습니다.' });
        if (String(req.body && req.body.confirm || '').trim() != '마이그레이션') return res.status(400).json({ error: '확인 문구가 올바르지 않습니다.' });
        const info = await describeDynamoTable(job.targetTable);
        if (!info || info.status != 'ACTIVE') return res.status(400).json({ error: '복원 테이블이 아직 ACTIVE 상태가 아닙니다.' });
        const count = await copyTableItems(job.targetTable, job.sourceTable);
        job.migratedAt = new Date().toISOString();
        job.migratedCount = count;
        if (job.sourceTable == 'rpgenius_data') {
            for (const key of rpgenius.RPGENIUS_DATA_KEYS) await rpgenius.loadRpgeniusDataEntry(key).catch(() => null);
        }
        res.json({ ok: true, job });
    } catch (e) {
        console.error('pitr migrate error:', e);
        res.status(500).json({ error: e.message || '서버 오류' });
    }
});

server.delete('/api/admin/pitr/jobs/:id/table', requireAdmin, async (req, res) => {
    try {
        const job = pitrJobs[String(req.params.id || '')];
        if (!job) return res.status(404).json({ error: '복원 작업을 찾을 수 없습니다.' });
        await dynamoClient.send(new DeleteTableCommand({ TableName: job.targetTable }));
        job.deletedAt = new Date().toISOString();
        res.json({ ok: true, job });
    } catch (e) {
        console.error('pitr delete table error:', e);
        res.status(500).json({ error: e.message || '서버 오류' });
    }
});

// ===== HTML =====

function readJson(filePath, fallback) {
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (e) {
        return fallback;
    }
}

function comma(n) {
    return Number(n || 0).toLocaleString('ko-KR');
}

function formatStar(star) {
    const displayStar = Number(star || 0) + 1;
    if (displayStar == 10) return '𝛧';
    if (displayStar == 11) return '𝛴';
    if (displayStar == 12) return '𝛀';
    return displayStar + '성';
}

function getMaxExpForLevel(level) {
    const table = readJson(path.join(__dirname, 'DB', 'RPGenius', 'ExpTable.json'), []);
    const value = table[Math.max(1, Number(level || 1)) - 1];
    return typeof value == 'number' ? value : 0;
}

function getCardImageUrl(card, user) {
    const characterCards = readJson(CHARACTER_CARDS_PATH, []);
    const data = card && characterCards[card.id];
    if (!data) return null;
    const star = String(Number(card.star || 0) + 1).padStart(2, '0');
    const skin = typeof card.skin == 'string' ? card.skin.trim() : '';
    const candidates = [];
    if (card && card.type === '전직') {
        const prestige = user && user.jobPrestige === true;
        if (skin) {
            if (prestige) candidates.push(star + ' 프레스티지 전직 ' + skin + ' ' + data.name + '.png');
            candidates.push(star + ' 전직 ' + skin + ' ' + data.name + '.png');
            candidates.push(star + ' 전직 ' + data.name + '.png');
        } else {
            if (prestige) candidates.push(star + ' 프레스티지 전직 ' + data.name + '.png');
            candidates.push(star + ' 전직 ' + data.name + '.png');
        }
    } else {
        if (skin) {
            if (user && user.prestige === true) candidates.push(star + ' 프레스티지 ' + skin + ' ' + data.name + '.png');
            candidates.push(star + ' ' + skin + ' ' + data.name + '.png');
            candidates.push(star + ' ' + data.name + '.png');
        } else {
            if (user && user.prestige === true) candidates.push(star + ' 프레스티지 ' + data.name + '.png');
            candidates.push(star + ' ' + data.name + '.png');
        }
    }
    const file = candidates.find(candidate => fs.existsSync(path.join(CARD_IMAGE_PATH, data.name, candidate)));
    if (!file) return null;
    return '/card-image?name=' + encodeURIComponent(data.name) + '&file=' + encodeURIComponent(file);
}

function getCharacterCoverImageUrl(data) {
    if (!data || !data.name) return null;
    const file = '캐릭터표지.png';
    if (!fs.existsSync(path.join(CARD_IMAGE_PATH, data.name, file))) return null;
    return '/card-image?name=' + encodeURIComponent(data.name) + '&file=' + encodeURIComponent(file);
}

function getJobCoverImageUrl(data) {
    if (!data || !data.name) return null;
    const file = '전직 캐릭터표지.png';
    if (!fs.existsSync(path.join(CARD_IMAGE_PATH, data.name, file))) return null;
    return '/card-image?name=' + encodeURIComponent(data.name) + '&file=' + encodeURIComponent(file);
}

function getItemImageUrl(dir, file) {
    const filePath = path.join(ITEM_IMAGE_PATH, dir, file);
    if (!fs.existsSync(filePath)) return null;
    return '/item-image?dir=' + encodeURIComponent(dir) + '&file=' + encodeURIComponent(file);
}

function getAuctionFrameUrl(kind, rarity) {
    if (kind == 'item') return getItemImageUrl('프레임', '아이템.png');
    if (kind == 'equipment') return getItemImageUrl('프레임', '[장비]' + String(rarity || '') + '.png');
    return null;
}

function getItemIconUrl(item) {
    if (!item || !item.type || !item.name) return null;
    // 보주는 type이 '사용'(use 디스패치용)이지만 이미지는 itemImage/보주/에 있다
    const dir = item.use == '보주' ? '보주' : String(item.type);
    return getItemImageUrl(dir, String(item.name) + '.png');
}

function getEquipmentIconUrl(data) {
    if (!data || !data.name || !data.rarity) return null;
    return getItemImageUrl('장비', String(data.rarity) + ' ' + String(data.name) + '.png');
}

function getPetIconUrl(data) {
    if (!data || !data.name || !data.rarity) return null;
    return getItemImageUrl('펫', String(data.rarity) + ' ' + String(data.name) + '.png');
}

function formatPetRemainText(pet) {
    if (!pet || !pet.expireAt) return '';
    const diff = Number(pet.expireAt) - Date.now();
    if (diff <= 0) return '만료됨';
    const days = Math.floor(diff / 86400000);
    const hours = Math.floor((diff % 86400000) / 3600000);
    if (days > 0) return days + '일 ' + hours + '시간 남음';
    if (hours > 0) return hours + '시간 남음';
    const mins = Math.floor((diff % 3600000) / 60000);
    return (mins > 0 ? mins + '분' : '1시간 미만') + ' 남음';
}

function buildPetSetEffectForUser(data, activeSets) {
    if (!data || !data.set) return null;
    const found = (activeSets || []).find(s => s.name === String(data.set));
    if (!found) return null;
    return {
        name: found.name,
        count: found.count,
        total: found.total,
        tiers: found.applied.map(a => ({ tier: a.tier, lines: rpgenius.formatPetSetEffectLines(a.effect).map(l => l.replace(/^-\s*/, '')) }))
    };
}

function buildInventoryPets(user) {
    const activeSets = rpgenius.getActivePetSetEffects(user);
    const result = [];
    let number = 1;
    const add = (pet, equipped, meta) => {
        const data = rpgenius.getPetData(pet.id);
        const itemNumber = number++;
        if (!data) return;
        const level = Number(pet.level || 0);
        result.push({
            type: 'pet',
            typeLabel: '펫',
            id: Number(pet.id),
            number: itemNumber,
            source: meta && meta.source || (equipped ? 'equipped' : 'inventory'),
            index: meta && typeof meta.index != 'undefined' ? Number(meta.index) : null,
            name: data.name,
            rarity: data.rarity,
            level,
            equipped: !!equipped,
            expired: rpgenius.isPetExpired(pet),
            expiryText: formatPetRemainText(pet),
            tradeCount: Number(pet.tradeCount || 0),
            statLines: dexStatLines(rpgenius.formatEquipmentBaseStatLines(data, level)),
            specialLines: rpgenius.collectPetSpecialObjects(data, level).flatMap(sp => rpgenius.formatPetSpecialLines(sp) || []).map(l => l.replace(/^-\s*/, '')),
            setEffect: buildPetSetEffectForUser(data, activeSets),
            iconUrl: getPetIconUrl(data),
            frameUrl: getAuctionFrameUrl('equipment', data.rarity)
        });
    };
    (user.inventory && Array.isArray(user.inventory.pet) ? user.inventory.pet : []).forEach((pet, index) => add(pet, false, { source: 'inventory', index }));
    rpgenius.getEquippedPets(user).forEach(pet => add(pet, true, { source: 'equipped' }));
    return result;
}

function getItemDisplayAssets(item) {
    if (!item || !item.name) return { frameUrl: getAuctionFrameUrl('item'), iconUrl: null };
    const m = String(item.name).match(/^(.+)\s장비\s상자$/);
    if (m) {
        return {
            frameUrl: getAuctionFrameUrl('equipment', m[1]),
            iconUrl: getItemImageUrl('가챠', '개봉 후 장비 상자.png')
        };
    }
    let frameUrl;
    if (item.type == '미끼') frameUrl = getItemImageUrl('프레임', '미끼.png');
    else if (item.use == '패션적용' || item.use == '고급패션적용') frameUrl = getItemImageUrl('프레임', '특수.png');
    else frameUrl = getAuctionFrameUrl('item');
    let iconUrl;
    if (/^\d+프로\s\+9\s장비\s강화권$/.test(String(item.name))) {
        iconUrl = getItemImageUrl(String(item.type || '사용'), '9강 장비강화권.png');
    } else {
        iconUrl = getItemIconUrl(item);
    }
    return { frameUrl, iconUrl };
}

function buildSlotEffectInfo(card, data) {
    if (!data || !data.slot_effect) return null;
    const star = Number(card && card.star || 0);
    const eff = data.slot_effect;
    const requireStar = 4;
    const baseValue = Number(eff.base || 0);
    const perLevel = Number(eff.per_level || 0);
    const currentValue = star >= requireStar ? baseValue + perLevel * (star - requireStar) : 0;
    const fmt = v => eff.type == 'flat' ? String(v) : (Math.round(Number(v || 0) * 1000) / 10) + '%';
    return {
        name: eff.name,
        type: eff.type || 'percent',
        baseText: fmt(baseValue),
        perLevelText: fmt(perLevel),
        currentText: fmt(currentValue),
        active: star >= requireStar,
        requireStarText: (requireStar + 1) + '성',
        currentStarText: (star + 1) + '성'
    };
}

function buildSkillInfo(card, user) {
    const characterCards = readJson(CHARACTER_CARDS_PATH, []);
    const skills = readJson(path.join(__dirname, 'DB', 'RPGenius', 'Skills.json'), []);
    const data = card && characterCards[card.id];
    if (!data || !Array.isArray(data.skills)) return [];
    const stats = rpgenius.calculateUserStats(user);
    const slotEffects = rpgenius.calculateCardSlotEffects(user);
    const star = Number(card && card.star || 0);
    return data.skills.map(skillIndex => {
        const skill = skills[skillIndex];
        if (!skill) return null;
        const mpCost = Math.max(0, Math.round(Number(skill.mp_cost || 0) * (1 - Math.min(1, Number(slotEffects.mpCostReduction || 0))) * (1 + Number(stats.mpReduce || 0))));
        const cooltime = Math.max(0, Number(skill.cooltime || 0) + Number(stats.skillCooldown || 0));
        return {
            name: skill.name,
            mpCost,
            baseMpCost: Number(skill.mp_cost || 0),
            cooltimeText: rpgenius.formatCooltime(cooltime),
            descLines: rpgenius.formatCurrentSkillDesc(skill, star).split('\n').filter(Boolean)
        };
    }).filter(Boolean);
}

function serializeCard(card, user) {
    const characterCards = readJson(CHARACTER_CARDS_PATH, []);
    const data = card && characterCards[card.id];
    if (!data) return null;
    let classInfo = null;
    if (data.class) {
        const skills = readJson(path.join(__dirname, 'DB', 'RPGenius', 'Skills.json'), []);
        const stats = user ? rpgenius.calculateUserStats(user) : {};
        const slotEffects = user ? rpgenius.calculateCardSlotEffects(user) : {};
        const star = Number(card && card.star || 0);
        const fmtPct = v => (Math.round(Number(v || 0) * 1000) / 10) + '%';
        classInfo = {
            name: data.class.name || '',
            slotEffects: Array.isArray(data.class.slot_effects) ? data.class.slot_effects.map(se => {
                const base = Number(se.base || 0);
                const perLevel = Number(se.per_level || 0);
                const current = star >= 4 ? base + perLevel * (star - 4) : 0;
                const fmt = v => se.type === 'flat' ? String(v) : fmtPct(v);
                return {
                    name: se.name,
                    baseText: fmt(base),
                    perLevelText: fmt(perLevel),
                    currentText: fmt(current),
                    active: star >= 4,
                    requireStarText: '5성',
                    currentStarText: (star + 1) + '성'
                };
            }) : [],
            skills: Array.isArray(data.class.skills) ? data.class.skills.map(skillId => {
                const skill = skills[Number(skillId)];
                if (!skill) return null;
                const mpCost = Math.max(0, Math.round(Number(skill.mp_cost || 0) * (1 - Math.min(1, Number(slotEffects.mpCostReduction || 0))) * (1 + Number(stats.mpReduce || 0))));
                const cooltime = Math.max(0, Number(skill.cooltime || 0) + Number(stats.skillCooldown || 0));
                return {
                    name: skill.name,
                    mpCost,
                    cooltimeText: rpgenius.formatCooltime(cooltime),
                    descLines: rpgenius.formatCurrentSkillDesc(skill, star).split('\n').filter(Boolean)
                };
            }).filter(Boolean) : []
        };
    }
    return {
        id: Number(card.id),
        star: Number(card.star || 0),
        starText: formatStar(card.star),
        type: card.type || '일반',
        skin: card.skin || '',
        name: data.name,
        formatted: rpgenius.formatUserCard(card),
        imageUrl: getCardImageUrl(card, user),
        slotEffect: buildSlotEffectInfo(card, data),
        skills: buildSkillInfo(card, user),
        classInfo
    };
}

const WEB_ITEM_USE_KEYS = new Set([
    '변환', '캐릭터변환', '만능캐릭터변환', '전직캐릭터변환', '전직프레스티지',
    '패션적용', '고급패션적용', '패션제거', '스탯초기화', '장신구선택권',
    '보조장비리롤', '잠재능력부여', '장비강화권', '영혼석', '보주', '보주선택',
    '가위', '생명수', '초월업그레이드', '초월선택', '아이템선택'
]);

function isUsableInventoryItem(item) {
    if (!item) return false;
    if (['소모품', '가챠', '번들', '미끼'].includes(item.type)) return true;
    if (item.type !== '사용') return false;
    return item.name === '유생의 강화기' || item.name === '프레스티지 증표' || WEB_ITEM_USE_KEYS.has(item.use);
}

function isBulkUsableInventoryItem(item) {
    if (!item || !['소모품', '가챠', '번들'].includes(item.type)) return false;
    if (item.type === '소모품' && (item.use_func || []).some(func => func && (func.type === '경험치비약' || func.type === '골드비약'))) return false;
    return true;
}

function buildInventoryItems(user) {
    const items = rpgenius.getDataCache('Item', []);
    return (user.inventory && Array.isArray(user.inventory.item) ? user.inventory.item : [])
        .map(inv => {
            const data = items[inv.id];
            if (!data) return null;
            const assets = getItemDisplayAssets(data);
            return {
                id: Number(inv.id), name: data.name, type: data.type, desc: data.desc || '', count: Number(inv.count || 0),
                noTrade: data.no_trade === true, usable: isUsableInventoryItem(data), bulkUsable: isBulkUsableInventoryItem(data),
                iconUrl: assets.iconUrl, frameUrl: assets.frameUrl
            };
        })
        .filter(item => item && item.count > 0);
}

function buildInventoryCards(user) {
    return (user.inventory && Array.isArray(user.inventory.card) ? user.inventory.card : [])
        .map((card, i) => {
            const serialized = serializeCard(card, user);
            return serialized ? Object.assign(serialized, { number: i + 1 }) : null;
        })
        .filter(Boolean);
}

function buildCombineCards(user) {
    const cards = user.inventory && Array.isArray(user.inventory.card) ? user.inventory.card : [];
    return cards.map((card, i) => {
        const s = serializeCard(card, user);
        if (!s) return null;
        const star = Number(card.star || 0);
        return {
            number: i + 1,
            id: s.id,
            star,
            type: card.type || '일반',
            starText: s.starText,
            name: s.name,
            formatted: s.formatted,
            imageUrl: s.imageUrl,
            combinable: !!rpgenius.getCardCombineInfo(star)
        };
    }).filter(Boolean).sort((a, b) => b.star - a.star || a.id - b.id);
}

function buildJobCombineCards(user) {
    const cards = user.inventory && Array.isArray(user.inventory.card) ? user.inventory.card : [];
    return cards.map((card, i) => {
        if (card.type === '전직') return null;
        const star = Number(card.star || 0);
        if (star < 4) return null;
        if (!rpgenius.hasJobClass(card.id)) return null;
        const s = serializeCard(card, user);
        if (!s) return null;
        return { number: i + 1, id: s.id, star, starText: s.starText, name: s.name, formatted: s.formatted, imageUrl: s.imageUrl };
    }).filter(Boolean).sort((a, b) => b.star - a.star || a.id - b.id);
}

function buildCombineMeta(user) {
    const table = {};
    const protect = {};
    for (let star = 0; star <= 11; star++) {
        const info = rpgenius.getCardCombineInfo(star);
        if (!info) continue;
        table[star] = {
            rate: info.rate,
            gold: info.gold,
            guarantee: rpgenius.getCardCombineGuaranteeCount(star) || 0,
            count: rpgenius.getCardCombineCount(user, 'card', star)
        };
        protect[star] = rpgenius.getProtectItemIdForCardStar(user, star) != -1;
    }
    const lucky = rpgenius.getLuckyCardItems(user).map(l => ({ rate: l.lucky, name: l.name }));
    return { table, protect, lucky, gold: Number(user.gold || 0) };
}

function getEquipmentData(type, id) {
    const equipments = rpgenius.getDataCache('Equipment', {});
    const list = equipments[type] || [];
    return list[id];
}

function buildEquipmentSetOverview(setName, inventoryEntries) {
    const equipments = rpgenius.getDataCache('Equipment', {});
    const labels = { weapon: '무기', hat: '모자', armor: '갑옷', pants: '하의', shoes: '신발', accessory: '장신구', support: '보조' };
    const typeOrder = ['weapon', 'hat', 'armor', 'pants', 'shoes', 'accessory', 'support'];
    const entries = inventoryEntries || [];
    const tierMap = {};
    const components = [];
    typeOrder.forEach(type => {
        (equipments[type] || []).forEach((data, id) => {
            if (!data || String(data.set || '') !== setName) return;
            Object.assign(tierMap, data.setEffects || {});
            const matching = entries.filter(entry => entry.type === type && Number(entry.id) === Number(id));
            const status = matching.some(entry => entry.equipped) ? 'equipped' : (matching.length ? 'owned' : 'missing');
            components.push({
                type,
                typeLabel: labels[type] || type,
                id: Number(id),
                name: data.name,
                rarity: data.rarity,
                status,
                iconUrl: getEquipmentIconUrl(data),
                frameUrl: getAuctionFrameUrl('equipment', data.rarity)
            });
        });
    });
    const equippedCount = entries.filter(entry => entry.equipped && entry.setName === setName).length;
    const tierKeys = Object.keys(tierMap).sort((a, b) => Number(a) - Number(b));
    return {
        name: setName,
        equippedCount,
        total: components.length,
        requiredCount: tierKeys.length ? Math.max(...tierKeys.map(Number)) : components.length,
        components,
        tiers: tierKeys.map(tier => ({
            tier: Number(tier),
            description: String(tierMap[tier]),
            active: equippedCount >= Number(tier)
        }))
    };
}

function buildInventoryEquipment(user) {
    const result = [];
    const labels = { weapon: '무기', hat: '모자', armor: '갑옷', pants: '하의', shoes: '신발', accessory: '장신구', support: '보조' };
    let number = 1;
    const add = (equip, type, equipped, meta) => {
        const data = equip && getEquipmentData(equip.type || type, equip.id);
        const itemNumber = number++;
        if (!data) return;
        const level = Number(equip.level || 0);
        const statText = rpgenius.formatCurrentEquipmentStatLines(data, level, equip && equip.rolled, { soul: equip && equip.soul });
        const statLines = String(statText || '').split('\n').filter(line => line && line.trim());
        rpgenius.formatOrbLines(equip && equip.orb).forEach(line => statLines.push(line.replace(/^-\s*/, '')));
        let passive = null;
        if (typeof data.passive_id !== 'undefined') {
            const passiveData = rpgenius.getEquipmentPassives()[Number(data.passive_id)];
            if (passiveData) passive = {
                name: passiveData.name,
                desc: formatPassiveDesc(passiveData),
                cooltime: passiveData.cooltime || null
            };
        }
        const potentialLines = equip && equip.potential ? rpgenius.formatPotentialLines(equip.potential) : [];
        const potentialDisplay = equip && equip.potential ? {
            tierKey: rpgenius.getPotentialRarityKey(equip.potential.rarity),
            tierLabel: rpgenius.getPotentialRarityLabel(equip.potential.rarity),
            entries: rpgenius.formatPotentialOptionEntries(equip.potential)
        } : null;
        const soulActive = equip && equip.soul && !rpgenius.isSoulExpired(equip.soul) ? equip.soul : null;
        result.push({
            type: equip.type || type,
            typeLabel: labels[equip.type || type] || (equip.type || type),
            id: Number(equip.id),
            number: itemNumber,
            source: meta && meta.source || (equipped ? 'equipped' : 'inventory'),
            index: meta && typeof meta.index != 'undefined' ? Number(meta.index) : null,
            slotKey: meta && typeof meta.slotKey != 'undefined' ? String(meta.slotKey) : null,
            name: rpgenius.getEquipmentDisplayName(data, equip),
            baseName: data.name,
            rarity: rpgenius.getEquipmentRarityLabel(data, equip),
            baseRarity: data.rarity,
            setName: data.set || null,
            level,
            equipped: !!equipped,
            statLines,
            description: data.desc || '',
            passive,
            potentialLines,
            potentialDisplay,
            potential: equip && equip.potential || null,
            canPotential: rpgenius.equipmentTypeSupportsPotential(equip.type || type),
            rolled: equip && equip.rolled || null,
            soul: soulActive ? { name: soulActive.name || '', expiredAt: Number(soulActive.expired_at || 0), stat: soulActive.stat || {}, plusStat: soulActive.plusStat || {} } : null,
            requireMainCard: Array.isArray(data.requireMainCard) ? data.requireMainCard.slice() : null,
            noTrade: data.no_trade === true,
            uid: (equip && equip.uid) || null,
            iconUrl: getEquipmentIconUrl(data),
            frameUrl: getAuctionFrameUrl('equipment', data.rarity)
        });
    };
    (user.inventory && Array.isArray(user.inventory.equipment) ? user.inventory.equipment : []).forEach((equip, index) => add(equip, equip.type, false, { source: 'inventory', index }));
    ['weapon', 'hat', 'armor', 'pants', 'shoes'].forEach(type => {
        if (user.equipments && user.equipments[type] && typeof user.equipments[type].id != 'undefined') add(user.equipments[type], type, true, { source: 'equipped' });
    });
    const accessories = user.equipments && user.equipments.accessory || {};
    Object.keys(accessories).forEach(key => {
        if (accessories[key] && typeof accessories[key].id != 'undefined') add(accessories[key], 'accessory', true, { source: 'equipped', slotKey: key });
    });
    if (user.equipments && user.equipments.support && typeof user.equipments.support.id != 'undefined') add(user.equipments.support, 'support', true, { source: 'equipped' });
    const equipments = rpgenius.getDataCache('Equipment', {});
    const setCache = {};
    const typeOrder = ['weapon', 'hat', 'armor', 'pants', 'shoes', 'accessory', 'support'];
    const buildSetOverview = setName => {
        if (setCache[setName]) return setCache[setName];
        const tierMap = {};
        const components = [];
        typeOrder.forEach(type => {
            (equipments[type] || []).forEach((data, id) => {
                if (!data || String(data.set || '') !== setName) return;
                Object.assign(tierMap, data.setEffects || {});
                const matching = result.filter(entry => entry.type === type && Number(entry.id) === Number(id));
                const status = matching.some(entry => entry.equipped) ? 'equipped' : (matching.length ? 'owned' : 'missing');
                components.push({
                    type,
                    typeLabel: labels[type] || type,
                    id: Number(id),
                    name: data.name,
                    rarity: data.rarity,
                    status,
                    iconUrl: getEquipmentIconUrl(data),
                    frameUrl: getAuctionFrameUrl('equipment', data.rarity)
                });
            });
        });
        const equippedCount = result.filter(entry => entry.equipped && entry.setName === setName).length;
        const tierKeys = Object.keys(tierMap).sort((a, b) => Number(a) - Number(b));
        setCache[setName] = {
            name: setName,
            equippedCount,
            total: components.length,
            requiredCount: tierKeys.length ? Math.max(...tierKeys.map(Number)) : components.length,
            components,
            tiers: tierKeys.map(tier => ({
                tier: Number(tier),
                description: String(tierMap[tier]),
                active: equippedCount >= Number(tier)
            }))
        };
        return setCache[setName];
    };
    result.forEach(entry => { if (entry.setName) entry.setInfo = buildSetOverview(String(entry.setName)); });
    return result;
}

const RARITY_ORDER = ['일반', '고급', '레어', '희귀', '유니크', '영웅', '레전더리', '전설', '초월', '신화', '고유'];

function formatPassiveDesc(passive) {
    if (!passive) return '';
    let desc = passive.desc || '';
    (passive.format || []).forEach((fmt, i) => {
        const val = Number(fmt.base || 0);
        const text = fmt.type === 'flat' ? String(Math.round(val)) : (Math.round(val * 1000) / 10) + '%';
        desc = desc.replace('${' + (i + 1) + '}', text);
    });
    return desc;
}

function splitDexEquipmentLines(lines) {
    const stats = [];
    const conditions = [];
    let conditionalBlock = false;
    (lines || []).forEach(raw => {
        const line = String(raw || '').replace(/^[-\s]+/, '').trim();
        if (!line) return;
        if (/^\[\s*\d+성 보너스\s*\]$/.test(line)) {
            conditionalBlock = true;
            conditions.push(line);
            return;
        }
        if (/^(장착 필요 레벨|장착 가능 최대 레벨|효과 적용 조건|장착 가능 메인 카드):/.test(line)) {
            conditionalBlock = false;
            conditions.push(line);
            return;
        }
        (conditionalBlock ? conditions : stats).push(line);
    });
    return { stats, conditions };
}

function buildEquipmentDexEntry(type, typeLabel, id, data, recipeIndex) {
    if (!data) return null;
    const upgrades = Array.isArray(data.upgrade) ? data.upgrade : [];
    const baseLineData = splitDexEquipmentLines(String(rpgenius.formatEquipmentBaseStatLines(data, 0) || '').split('\n'));
    const upgradeLines = upgrades.map((_, i) => {
        const lvl = i + 1;
        const lineData = splitDexEquipmentLines(String(rpgenius.formatEquipmentBaseStatLines(data, lvl) || '').split('\n'));
        return { level: lvl, statLines: lineData.stats };
    });
    let evolution = null;
    if (typeof data.evolution != 'undefined') {
        const targetId = Number(data.evolution);
        const targetData = getEquipmentData(type, targetId);
        evolution = {
            targetType: type,
            targetTypeLabel: typeLabel,
            targetId,
            targetName: targetData ? targetData.name : '알 수 없음',
            targetRarity: targetData ? targetData.rarity : null,
            targetIconUrl: targetData ? getEquipmentIconUrl(targetData) : null,
            targetFrameUrl: targetData ? getAuctionFrameUrl('equipment', targetData.rarity) : null,
            requireLevel: 10,
            requireCount: 3
        };
    }
    const recipeKey = type + ':' + id;
    const recipe = recipeIndex[recipeKey] || null;
    let passive = null;
    if (typeof data.passive_id !== 'undefined') {
        const passives = rpgenius.getEquipmentPassives();
        const pd = passives[Number(data.passive_id)];
        if (pd) {
            passive = {
                name: pd.name,
                desc: formatPassiveDesc(pd),
                cooltime: pd.cooltime || null
            };
        }
    }
    const set = data.set ? {
        name: String(data.set),
        tiers: Object.keys(data.setEffects || {}).sort((a, b) => Number(a) - Number(b)).map(tier => ({ tier: Number(tier), lines: [String(data.setEffects[tier])] }))
    } : null;
    return {
        type,
        typeLabel,
        id,
        name: data.name,
        rarity: data.rarity,
        desc: data.desc || '',
        noTrade: data.no_trade === true,
        iconUrl: getEquipmentIconUrl(data),
        frameUrl: getAuctionFrameUrl('equipment', data.rarity),
        baseStatLines: baseLineData.stats,
        conditionLines: baseLineData.conditions,
        upgrades: upgradeLines,
        maxUpgradeLevel: upgrades.length,
        transcend: data.transcend === true,
        mythic: data.mythic === true,
        evolution,
        recipe,
        passive,
        set
    };
}

function buildRecipeIndex() {
    const items = rpgenius.getDataCache('Item', []);
    const equipments = rpgenius.getDataCache('Equipment', {});
    const recipes = rpgenius.getDataCache('Recipe', []);
    const index = {};
    const equipmentTypeMap = {
        '무기': { slotKey: 'weapon', idKey: 'weapon_id', label: '무기' },
        '갑옷': { slotKey: 'armor', idKey: 'armor_id', label: '갑옷' },
        '장신구': { slotKey: 'accessory', idKey: 'accessory_id', label: '장신구' },
        '보조': { slotKey: 'support', idKey: 'support_id', label: '보조' }
    };
    (recipes || []).forEach(recipe => {
        if (!recipe || !Array.isArray(recipe.crafted)) return;
        recipe.crafted.forEach(crafted => {
            if (!crafted || !crafted.type) return;
            const craftedType = equipmentTypeMap[crafted.type];
            const slotKey = craftedType ? craftedType.slotKey : null;
            if (!slotKey) return;
            const targetId = Number(crafted[craftedType.idKey]);
            if (!Number.isFinite(targetId)) return;
            const materials = (recipe.materials || []).map(mat => {
                if (!mat) return null;
                if (mat.type == '아이템') {
                    const itemData = items[mat.item_id];
                    return {
                        type: 'item',
                        typeLabel: '아이템',
                        name: itemData ? itemData.name : '알 수 없음',
                        count: Number(mat.count || 0),
                        iconUrl: itemData ? getItemIconUrl(itemData) : null,
                        frameUrl: itemData ? getAuctionFrameUrl('item') : null
                    };
                }
                if (mat.type == '골드') return { type: 'gold', typeLabel: '골드', name: '골드', count: Number(mat.count || 0) };
                if (mat.type == '가넷') return { type: 'garnet', typeLabel: '가넷', name: '가넷', count: Number(mat.count || 0) };
                const matType = equipmentTypeMap[mat.type];
                if (matType) {
                    const equipId = Number(mat[matType.idKey]);
                    const equipData = equipments[matType.slotKey] && equipments[matType.slotKey][equipId];
                    return {
                        type: 'equipment',
                        typeLabel: matType.label,
                        name: equipData ? equipData.name : '알 수 없음',
                        count: Number(mat.count || 0),
                        iconUrl: equipData ? getEquipmentIconUrl(equipData) : null,
                        frameUrl: equipData ? getAuctionFrameUrl('equipment', equipData.rarity) : null
                    };
                }
                return { type: 'unknown', typeLabel: String(mat.type || ''), name: String(mat.type || ''), count: Number(mat.count || 0) };
            }).filter(Boolean);
            index[slotKey + ':' + targetId] = { name: recipe.name, materials };
        });
    });
    return index;
}

function buildCharacterDex() {
    const characterCards = readJson(CHARACTER_CARDS_PATH, []);
    const skills = readJson(path.join(__dirname, 'DB', 'RPGenius', 'Skills.json'), []);
    const fmtPct = v => (Math.round(Number(v || 0) * 1000) / 10) + '%';
    const buildSkillEntry = skillId => {
        const skill = skills[Number(skillId)];
        if (!skill) return null;
        return {
            id: Number(skillId),
            name: skill.name,
            mpCost: Number(skill.mp_cost || 0),
            cooltimeText: rpgenius.formatCooltime(Number(skill.cooltime || 0)),
            descLines: rpgenius.formatSkillDescWithIncrease(skill).split('\n').filter(Boolean)
        };
    };
    return characterCards.map((data, id) => {
        if (!data) return null;
        const baseCard = { id, star: 0, type: '일반' };
        const slotEffect = buildSlotEffectInfo({ id, star: 4 }, data);
        let jobClass = null;
        if (data.class) {
            jobClass = {
                slotEffects: Array.isArray(data.class.slot_effects) ? data.class.slot_effects.map(se => ({
                    name: se.name,
                    baseText: fmtPct(se.base),
                    perLevelText: fmtPct(se.per_level),
                    requireStarText: '5성'
                })) : [],
                skills: Array.isArray(data.class.skills) ? data.class.skills.map(buildSkillEntry).filter(Boolean) : []
            };
        }
        return {
            kind: 'character',
            type: 'character',
            typeLabel: '캐릭터 카드',
            id,
            name: data.name,
            formatted: rpgenius.formatUserCard(baseCard),
            imageUrl: getCardImageUrl(baseCard, { prestige: false }),
            coverUrl: getCharacterCoverImageUrl(data),
            jobCoverUrl: getJobCoverImageUrl(data),
            hasJobClass: !!data.class,
            slotEffect,
            skills: Array.isArray(data.skills) ? data.skills.map(buildSkillEntry).filter(Boolean) : [],
            jobClass
        };
    }).filter(Boolean);
}

function dexStatLines(text) {
    return String(text || '').split('\n').filter(line => line && line.trim()).map(line => line.replace(/^-\s*/, ''));
}

function buildPetDexEntry(id, data) {
    if (!data) return null;
    const upgrades = Array.isArray(data.upgrade) ? data.upgrade : [];
    const upgradeLines = upgrades.map((step, i) => {
        const statLines = dexStatLines(rpgenius.formatEquipmentBaseStatLines(data, i + 1));
        (rpgenius.formatPetSpecialLines(rpgenius.normalizeSpecialObject(step && step.special)) || []).forEach(l => statLines.push(l.replace(/^-\s*/, '')));
        return { level: i + 1, statLines };
    });
    const specialLines = (rpgenius.formatPetSpecialLines(rpgenius.normalizePetSpecial(data)) || []).map(l => l.replace(/^-\s*/, ''));
    let set = null;
    if (data.set) {
        const tiers = rpgenius.getPetSetData()[data.set];
        set = {
            name: String(data.set),
            tiers: Array.isArray(tiers) ? tiers.map((eff, i) => ({ tier: i + 1, lines: rpgenius.formatPetSetEffectLines(eff).map(l => l.replace(/^-\s*/, '')) })) : []
        };
    }
    return {
        type: 'pet',
        typeLabel: '펫',
        id,
        name: data.name,
        rarity: data.rarity,
        desc: data.desc || '',
        iconUrl: getPetIconUrl(data),
        frameUrl: getAuctionFrameUrl('equipment', data.rarity),
        baseStatLines: dexStatLines(rpgenius.formatEquipmentBaseStatLines(data, 0)),
        upgrades: upgradeLines,
        maxUpgradeLevel: upgrades.length,
        specialLines,
        set
    };
}

function buildPetDex() {
    const pets = rpgenius.getDataCache('Pet', []);
    return (Array.isArray(pets) ? pets : [])
        .map((data, id) => buildPetDexEntry(id, data))
        .filter(Boolean)
        .sort((a, b) => {
            const ax = RARITY_ORDER.indexOf(a.rarity) < 0 ? 999 : RARITY_ORDER.indexOf(a.rarity);
            const bx = RARITY_ORDER.indexOf(b.rarity) < 0 ? 999 : RARITY_ORDER.indexOf(b.rarity);
            return ax != bx ? ax - bx : a.id - b.id;
        });
}

const ORB_DEX_CATEGORIES = [
    { name: '대저택1', parts: ['weapon', 'armor', 'pants', 'support'], orbs: ['대탐정F 보주', '장충동왕족발보쌈 보주', '멸치볶음 보주', '조각 보주', '아리스 보주'] },
    { name: '월도랜드2', parts: ['hat', 'shoes'], orbs: ['뉴비 보주', '현식이아버지 보주', '직장인 보주'] },
    { name: '밍닝스플랜', parts: ['weapon'], orbs: ['쌩쑈메이커 보주', '첫 만남은 다시 guitar 보주', '흐음 보주'] },
    { name: '이세계대저택', parts: ['accessory'], orbs: ['눈뜬 장님 보주', '예토전생 보주', '오로라 보주', 'X39825 보주', '쿠마가와 미소기 보주', '피아스트 보주'] },
    { name: '부타게임', parts: ['support'], orbs: ['레인 보주', '우정잉여왕 보주', '물장구 보주', 'X 보주', 'SitoSoym 보주', '페비 보주', '수나타 보주', '지오 보주', '우정 보주', '블루로즈 보주'] },
    { name: '대저택 리턴즈', parts: ['hat', 'armor', 'pants', 'shoes'], orbs: ['레지에로 보주', '플로로 보주', '유스티티아 보주', 'Ori 보주', '멜론빵 보주', '엘리스 유 보주', '헬로키티 보주', '박보검 보주', '송예빈 보주', '케이티 위즈 보주'] },
    { name: '대저택2', parts: ['weapon'], orbs: ['매그내릭 보주', '필규햄 보주', '이어브피 보주', '황정민 보주', '조디악 보주', '클로브 보주', '단테 보주', 'YR 보주'] }
];

function buildOrbDex() {
    const items = rpgenius.getDataCache('Item', []);
    const partLabels = { weapon: '무기', hat: '모자', armor: '갑옷', pants: '하의', shoes: '신발', accessory: '장신구', support: '보조' };
    return rpgenius.getOrbData().map((orb, id) => {
        if (!orb) return null;
        const item = items.find(it => it && it.use == '보주' && it.name == orb.name) || null;
        const category = ORB_DEX_CATEGORIES.find(group => group.orbs.includes(orb.name));
        return {
            type: 'orb',
            typeLabel: '보주',
            id,
            name: orb.name,
            rarity: null,
            iconUrl: item ? getItemIconUrl(item) : null,
            frameUrl: getAuctionFrameUrl('item'),
            category: category ? category.name : '기타',
            categoryParts: (category ? category.parts : orb.parts || []).map(part => partLabels[part] || part),
            partLabels: (orb.parts || []).map(part => partLabels[part] || part),
            baseStatLines: dexStatLines(rpgenius.formatOrbLines(orb).slice(1).join('\n')),
        };
    }).filter(Boolean);
}

function buildEquipmentDex() {
    const eq = rpgenius.getDataCache('Equipment', {});
    const recipeIndex = buildRecipeIndex();
    const sortByRarity = (a, b) => {
        const ai = RARITY_ORDER.indexOf(a.rarity);
        const bi = RARITY_ORDER.indexOf(b.rarity);
        const ax = ai < 0 ? 999 : ai;
        const bx = bi < 0 ? 999 : bi;
        if (ax != bx) return ax - bx;
        return a.id - b.id;
    };
    const pack = (list, type, label) => (list || []).map((data, id) => buildEquipmentDexEntry(type, label, id, data, recipeIndex)).filter(Boolean).sort(sortByRarity);
    const result = {
        weapon: pack(eq.weapon, 'weapon', '무기'),
        hat: pack(eq.hat, 'hat', '모자'),
        armor: pack(eq.armor, 'armor', '갑옷'),
        pants: pack(eq.pants, 'pants', '하의'),
        shoes: pack(eq.shoes, 'shoes', '신발'),
        accessory: pack(eq.accessory, 'accessory', '장신구'),
        support: pack(eq.support, 'support', '보조'),
        orb: buildOrbDex(),
        pet: buildPetDex(),
        character: buildCharacterDex(),
        rarityOrder: RARITY_ORDER
    };
    const equipmentEntries = ['weapon', 'hat', 'armor', 'pants', 'shoes', 'accessory', 'support'].flatMap(type => result[type]);
    const setGroups = {};
    equipmentEntries.forEach(entry => {
        if (!entry.set) return;
        const name = entry.set.name;
        if (!setGroups[name]) setGroups[name] = [];
        setGroups[name].push({
            type: entry.type,
            typeLabel: entry.typeLabel,
            id: entry.id,
            name: entry.name,
            rarity: entry.rarity,
            iconUrl: entry.iconUrl,
            frameUrl: entry.frameUrl
        });
    });
    equipmentEntries.forEach(entry => {
        if (entry.set) entry.set.components = setGroups[entry.set.name] || [];
    });
    return result;
}

function buildEquipmentSynthesisItems(user) {
    const inventory = user.inventory && Array.isArray(user.inventory.equipment) ? user.inventory.equipment : [];
    return buildInventoryEquipment(user)
        .filter(entry => entry.source == 'inventory')
        .map(entry => {
            const equip = inventory[entry.index] || {};
            const data = getEquipmentData(entry.type, entry.id);
            const stage = data && data.rarity == '초월' ? Math.max(1, Number(equip.transcendStage || 1)) : null;
            let synthesisMode = null;
            let result = null;
            let unavailableReason = '';
            if (data && data.rarity == '초월') {
                synthesisMode = 'transcend';
                if (equip.locked) unavailableReason = '잠긴 장비';
                else if (stage >= 3) unavailableReason = '최종 단계';
                else result = {
                    type: entry.type,
                    id: entry.id,
                    name: entry.name,
                    rarity: '초월 ' + (stage + 1) + '단계',
                    transcendStage: stage + 1,
                    iconUrl: entry.iconUrl,
                    frameUrl: entry.frameUrl
                };
            } else if (data && typeof data.evolution != 'undefined') {
                synthesisMode = 'evolution';
                const resultId = Number(data.evolution);
                const resultData = getEquipmentData(entry.type, resultId);
                if (entry.level < 10) unavailableReason = '+10 강화 필요';
                else if (!resultData) unavailableReason = '합성 결과 정보 없음';
                else result = {
                    type: entry.type,
                    id: resultId,
                    name: resultData.name,
                    rarity: resultData.rarity,
                    transcendStage: null,
                    iconUrl: getEquipmentIconUrl(resultData),
                    frameUrl: getAuctionFrameUrl('equipment', resultData.rarity)
                };
            } else {
                unavailableReason = '합성 진화 불가';
            }
            return Object.assign({}, entry, {
                locked: !!equip.locked,
                transcendStage: stage,
                synthesisMode,
                requiredCount: synthesisMode == 'transcend' ? 2 : 3,
                result,
                selectable: !!result,
                unavailableReason
            });
        });
}

async function getPatchnoteList() {
    let data = rpgenius.getDataCache('Patchnote', null);
    if (!data) {
        await rpgenius.loadRpgeniusDataEntry('Patchnote');
        data = rpgenius.getDataCache('Patchnote', null);
    }
    if (Array.isArray(data)) return data;
    if (data && Array.isArray(data.items)) return data.items;
    if (data && typeof data == 'object' && (data.title || data.textbody)) return [Object.assign({ id: 'main', replies: [] }, data)];
    return [];
}

async function savePatchnoteList(items) {
    await rpgenius.saveRpgeniusDataEntry('Patchnote', items);
}

function createPatchnoteId() {
    return Date.now().toString(36) + crypto.randomBytes(4).toString('hex');
}

function buildPatchnoteUserMap(users) {
    const map = {};
    (users || []).forEach(user => {
        if (!user || typeof user.id == 'undefined') return;
        map[String(user.id)] = { name: user.name || '알 수 없음', level: Number(user.level || 1), title: buildTitleDisplay(user) };
    });
    return map;
}

function serializePatchnoteReply(reply, userMap) {
    const user = userMap[String(reply && reply.userId)] || { name: '알 수 없음', level: 1, title: null };
    return {
        id: String(reply && reply.id || ''),
        userId: String(reply && reply.userId || ''),
        authorName: user.name,
        authorLevel: user.level,
        authorTitle: user.title || null,
        textbody: String(reply && reply.textbody || ''),
        date: String(reply && reply.date || ''),
        replies: (Array.isArray(reply && reply.replies) ? reply.replies : []).map(child => serializePatchnoteReply(child, userMap))
    };
}

function serializePatchnotes(notes, users) {
    const userMap = buildPatchnoteUserMap(users);
    return (Array.isArray(notes) ? notes : []).map(note => ({
        id: String(note && note.id || ''),
        title: String(note && note.title || ''),
        date: String(note && note.date || ''),
        textbody: String(note && note.textbody || ''),
        replies: (Array.isArray(note && note.replies) ? note.replies : []).map(reply => serializePatchnoteReply(reply, userMap))
    })).sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

function findPatchnoteReply(replies, id) {
    for (const reply of (Array.isArray(replies) ? replies : [])) {
        if (reply && reply.id == id) return reply;
        const found = findPatchnoteReply(reply && reply.replies, id);
        if (found) return found;
    }
    return null;
}

// ===== 상점 헬퍼 =====

const SHOP_CURR_IMG = {
    gold:   '/item-image?dir=' + encodeURIComponent('화폐') + '&file=' + encodeURIComponent('골드.png'),
    garnet: '/item-image?dir=' + encodeURIComponent('화폐') + '&file=' + encodeURIComponent('가넷.png'),
    point:  '/item-image?dir=' + encodeURIComponent('화폐') + '&file=' + encodeURIComponent('포인트.png'),
};

function buildBundleContents(data) {
    const bundles = rpgenius.getDataCache('Bundle', []);
    const items = rpgenius.getDataCache('Item', []);
    if (typeof data.pack !== 'number') return null;
    const bundle = bundles[data.pack];
    if (!Array.isArray(bundle)) return null;
    return bundle.map(entry => {
        const min = Number((entry.count && entry.count.min) || entry.count || 1);
        const max = Number((entry.count && entry.count.max) || entry.count || 1);
        const countStr = min === max ? String(min) : min + '~' + max;
        if (entry.type === '아이템') {
            const itemData = items[entry.item_id];
            const assets = itemData ? getItemDisplayAssets(itemData) : { iconUrl: null, frameUrl: null };
            return { type: '아이템', name: itemData ? itemData.name : '알 수 없음', count: countStr, iconUrl: assets.iconUrl, frameUrl: assets.frameUrl };
        }
        if (entry.type === '골드') return { type: '골드', name: '골드', count: countStr, imgUrl: SHOP_CURR_IMG.gold };
        if (entry.type === '가넷') return { type: '가넷', name: '가넷', count: countStr, imgUrl: SHOP_CURR_IMG.garnet };
        if (entry.type === '마일리지') return { type: '마일리지', name: '마일리지', count: countStr, label: 'Ⓜ️' };
        if (entry.type === '포인트') return { type: '포인트', name: '포인트', count: countStr, imgUrl: SHOP_CURR_IMG.point };
        if (entry.type === '칭호') {
            const title = rpgenius.getTitleById(entry.title_id);
            return { type: '칭호', name: (title ? title.name : '알 수 없는') + ' 칭호', count: '1', iconUrl: title ? rpgenius.getTitleImageUrl(title.name) : null, frameUrl: null, label: title ? null : '🏅' };
        }
        const eqSlotMap = { '무기': ['weapon', 'weapon_id'], '갑옷': ['armor', 'armor_id'], '장신구': ['accessory', 'accessory_id'], '보조': ['support', 'support_id'], '보조무기': ['support', 'support_id'] };
        if (eqSlotMap[entry.type]) {
            const [slot, idKey] = eqSlotMap[entry.type];
            const eq = rpgenius.getDataCache('Equipment', {});
            const eqData = eq[slot] && eq[slot][entry[idKey]];
            return { type: entry.type, name: eqData ? '<' + eqData.rarity + '> ' + eqData.name : '알 수 없는 ' + entry.type, count: '1', iconUrl: eqData ? getEquipmentIconUrl(eqData) : null, frameUrl: eqData ? getAuctionFrameUrl('equipment', eqData.rarity) : null };
        }
        if (entry.type === '펫') {
            if (typeof entry.pet_id !== 'undefined') {
                const petData = rpgenius.getPetData(entry.pet_id);
                return { type: '펫', name: petData ? '<' + petData.rarity + '> ' + petData.name + ' (펫)' : '알 수 없는 펫', count: countStr, iconUrl: petData ? getPetIconUrl(petData) : null, frameUrl: petData ? getAuctionFrameUrl('equipment', petData.rarity) : null };
            }
            return { type: '펫', name: '<' + (entry.rarity || '?') + '> 랜덤 펫', count: countStr, label: '🐾' };
        }
        if (entry.type === '캐릭터카드') {
            const characterCards = readJson(CHARACTER_CARDS_PATH, []);
            const cardId = entry.card_id != null ? Number(entry.card_id) : (entry.character_card_id != null ? Number(entry.character_card_id) : (entry.id != null ? Number(entry.id) : -1));
            const cardData = Number.isInteger(cardId) && cardId >= 0 ? characterCards[cardId] : null;
            // 성급 표기/이미지: 랜덤 범위는 최소 성급 기준 (지급 시 실제 롤은 grantPackReward에서)
            let starText, starForImg;
            if (entry.display_star != null || entry.star_display != null) {
                const s = Number(entry.display_star != null ? entry.display_star : entry.star_display);
                starText = s + '성'; starForImg = Math.max(0, s - 1);
            } else if (entry.star && typeof entry.star === 'object') {
                const min = Number(entry.star.min || 1), max = Number(entry.star.max || entry.star.min || 1);
                starText = (min === max ? min : min + '~' + max) + '성'; starForImg = Math.max(0, min - 1);
            } else if (entry.range && typeof entry.range === 'object') {
                const min = Number(entry.range.min || 1), max = Number(entry.range.max || entry.range.min || 1);
                starText = (min === max ? min : min + '~' + max) + '성'; starForImg = Math.max(0, min - 1);
            } else {
                starForImg = Math.max(0, Number(entry.star || 0)); starText = (starForImg + 1) + '성';
            }
            const cardType = entry.card_type || entry.cardType || '일반';
            if (!cardData) return { type: '캐릭터카드', name: '랜덤 캐릭터 카드 ' + starText, count: countStr, label: '🃏' };
            const iconUrl = getCardImageUrl({ id: cardId, star: starForImg, type: cardType, skin: entry.skin ? String(entry.skin) : '' }, { prestige: false });
            return { type: '캐릭터카드', name: (cardType === '전직' ? '[전직] ' : '') + cardData.name + ' ' + starText, count: countStr, iconUrl, frameUrl: null, label: iconUrl ? null : '🃏' };
        }
        return null;
    }).filter(Boolean);
}

function formatItemDetailCount(value) {
    const min = Number(value && typeof value == 'object' ? (value.min ?? value.max ?? 1) : (value ?? 1));
    const max = Number(value && typeof value == 'object' ? (value.max ?? value.min ?? 1) : (value ?? 1));
    return min === max ? comma(min) : comma(min) + '~' + comma(max);
}

function buildDetailRewardDisplay(entry) {
    if (!entry || typeof entry != 'object') return null;
    const items = rpgenius.getDataCache('Item', []);
    const count = formatItemDetailCount(entry.count);
    if (entry.type === '아이템') {
        const data = items[entry.item_id];
        const assets = data ? getItemDisplayAssets(data) : { iconUrl: null, frameUrl: null };
        return { type: '아이템', name: data ? data.name : '알 수 없는 아이템', count, iconUrl: assets.iconUrl, frameUrl: assets.frameUrl };
    }
    if (entry.type === '골드') return { type: '골드', name: '골드', count, iconUrl: SHOP_CURR_IMG.gold };
    if (entry.type === '가넷') return { type: '가넷', name: '가넷', count, iconUrl: SHOP_CURR_IMG.garnet };
    if (entry.type === '마일리지') return { type: '마일리지', name: '마일리지', count, label: 'M' };
    if (entry.type === '포인트') return { type: '포인트', name: '포인트', count, iconUrl: SHOP_CURR_IMG.point };
    if (entry.type === '칭호') {
        const title = rpgenius.getTitleById(entry.title_id);
        return { type: '칭호', name: (title ? title.name : '알 수 없는') + ' 칭호', count: '1', iconUrl: title ? rpgenius.getTitleImageUrl(title.name) : null, label: '칭호' };
    }
    const equipmentTypes = { '무기': ['weapon', 'weapon_id'], '갑옷': ['armor', 'armor_id'], '장신구': ['accessory', 'accessory_id'], '보조': ['support', 'support_id'], '보조무기': ['support', 'support_id'] };
    if (equipmentTypes[entry.type]) {
        const [slot, idKey] = equipmentTypes[entry.type];
        const equipment = rpgenius.getDataCache('Equipment', {});
        const data = equipment[slot] && equipment[slot][entry[idKey]];
        return { type: entry.type, name: data ? '<' + data.rarity + '> ' + data.name : '알 수 없는 ' + entry.type, count, iconUrl: data ? getEquipmentIconUrl(data) : null, frameUrl: data ? getAuctionFrameUrl('equipment', data.rarity) : null };
    }
    if (entry.type === '펫') {
        const data = typeof entry.pet_id !== 'undefined' ? rpgenius.getPetData(entry.pet_id) : null;
        if (data) return { type: '펫', name: '<' + data.rarity + '> ' + data.name, count, iconUrl: getPetIconUrl(data), frameUrl: getAuctionFrameUrl('equipment', data.rarity), label: '펫' };
        return { type: '펫', name: '<' + (entry.rarity || '?') + '> 랜덤 펫', count, label: '펫' };
    }
    if (entry.type === '캐릭터카드') {
        const cards = readJson(CHARACTER_CARDS_PATH, []);
        const cardId = entry.card_id != null ? Number(entry.card_id) : (entry.character_card_id != null ? Number(entry.character_card_id) : Number(entry.id));
        const data = cards[cardId];
        let star = 0;
        if (entry.display_star != null || entry.star_display != null) star = Math.max(0, Number(entry.display_star ?? entry.star_display) - 1);
        else if (entry.star && typeof entry.star == 'object') star = Math.max(0, Number(entry.star.min || 1) - 1);
        else if (entry.range && typeof entry.range == 'object') star = Math.max(0, Number(entry.range.min || 1) - 1);
        else star = Math.max(0, Number(entry.star || 0));
        const cardType = entry.card_type || entry.cardType || '일반';
        if (!data) return { type: '캐릭터카드', name: '알 수 없는 캐릭터 카드', count, label: '카드' };
        return {
            type: '캐릭터카드',
            name: (cardType === '전직' ? '[전직] ' : '') + data.name + ' ' + formatStar(star),
            count,
            iconUrl: getCardImageUrl({ id: cardId, star, type: cardType, skin: entry.skin ? String(entry.skin) : '' }, { prestige: false, jobPrestige: false }),
            label: '카드'
        };
    }
    return null;
}

function buildPackChanceEntries(pack) {
    let cumulative = 0;
    return pack.map((entry, index) => {
        const before = Math.max(0, Math.min(1, cumulative));
        cumulative += Math.max(0, Number(entry && entry.roll || 0));
        const chance = index === pack.length - 1
            ? Math.max(0, 1 - before)
            : Math.max(0, Math.min(1, cumulative) - before);
        const display = buildDetailRewardDisplay(entry);
        return display ? Object.assign(display, { chance }) : null;
    }).filter(Boolean);
}

function buildUniformEquipmentOutcomes(types, rarity, excludeRaidUnique) {
    const equipment = rpgenius.getDataCache('Equipment', {});
    const typeLabels = { weapon: '무기', hat: '모자', armor: '갑옷', pants: '하의', shoes: '신발', accessory: '장신구', support: '보조' };
    const candidates = [];
    types.forEach(type => {
        (equipment[type] || []).forEach((data, id) => {
            if (!data || data.rarity !== rarity) return;
            if (excludeRaidUnique && rarity === '유니크' && data.isRaid === true) return;
            candidates.push({ type, id, data });
        });
    });
    const chance = candidates.length ? 1 / candidates.length : 0;
    return candidates.map(entry => ({
        type: typeLabels[entry.type] || '장비',
        name: '<' + entry.data.rarity + '> ' + entry.data.name,
        count: '1',
        iconUrl: getEquipmentIconUrl(entry.data),
        frameUrl: getAuctionFrameUrl('equipment', entry.data.rarity),
        chance
    }));
}

function buildCharacterPackOutcomes(pack) {
    const cards = readJson(CHARACTER_CARDS_PATH, []);
    const isJob = pack.type === '전직 캐릭터 카드팩';
    const candidates = cards.map((data, id) => ({ data, id })).filter(entry => entry.data && (!isJob || entry.data.class));
    const minStar = Math.max(1, Number(pack.range && pack.range.min || 1));
    const maxStar = Math.max(minStar, Number(pack.range && pack.range.max || minStar));
    const outcomeCount = candidates.length * (maxStar - minStar + 1);
    const chance = outcomeCount ? 1 / outcomeCount : 0;
    const results = [];
    candidates.forEach(entry => {
        for (let displayStar = minStar; displayStar <= maxStar; displayStar++) {
            const star = displayStar - 1;
            const skin = pack.skin ? String(pack.skin) : '';
            results.push({
                type: isJob ? '전직 캐릭터카드' : '캐릭터카드',
                name: entry.data.name + ' · ' + formatStar(star),
                detail: skin ? skin + ' 패션' : '',
                count: '1',
                iconUrl: getCardImageUrl({ id: entry.id, star, type: isJob ? '전직' : '일반', skin }, { prestige: false, jobPrestige: false }),
                label: '카드',
                chance
            });
        }
    });
    return results;
}

function buildPetPackOutcomes(pack) {
    const pets = rpgenius.getDataCache('Pet', []);
    const candidates = (Array.isArray(pets) ? pets : []).map((data, id) => ({ data, id })).filter(entry => entry.data && entry.data.rarity === pack.rarity);
    const chance = candidates.length ? 1 / candidates.length : 0;
    return candidates.map(entry => ({
        type: '펫', name: '<' + entry.data.rarity + '> ' + entry.data.name, count: '1',
        iconUrl: getPetIconUrl(entry.data), frameUrl: getAuctionFrameUrl('equipment', entry.data.rarity), label: '펫', chance
    }));
}

function buildBaitDetail(item) {
    const bait = (rpgenius.getDataCache('Bait', []) || []).find(entry => entry && entry.name === item.name);
    const rewards = bait && Array.isArray(bait.rewards) ? bait.rewards : [];
    const totalRate = rewards.reduce((sum, reward) => sum + Math.max(0, Number(reward && reward.rate || 0)), 0);
    return {
        kind: 'chance',
        title: '낚시 획득 확률',
        rollCount: 1,
        note: '낚시 1회마다 아래 아이템 중 하나를 획득합니다.',
        entries: rewards.map(reward => {
            const display = buildDetailRewardDisplay({ type: '아이템', item_id: reward.id, count: 1 });
            return display ? Object.assign(display, { chance: totalRate > 0 ? Number(reward.rate || 0) / totalRate : 0 }) : null;
        }).filter(Boolean)
    };
}

function buildGachaDetail(item) {
    let entries = [];
    let note = '';
    if (item.use === '초월상자') {
        entries = buildUniformEquipmentOutcomes(['weapon', 'hat', 'armor', 'pants', 'shoes', 'accessory', 'support'], '초월', false);
        note = '모든 초월 장비 중 하나를 동일한 확률로 획득합니다.' + (item.tradeUsed ? ' 획득 장비는 거래 가능 횟수가 소진된 상태입니다.' : '');
    } else if (item.use === '보주상자') {
        const items = rpgenius.getDataCache('Item', []);
        const candidates = items.map((data, id) => ({ data, id })).filter(entry => entry.data && entry.data.use === '보주');
        const chance = candidates.length ? 1 / candidates.length : 0;
        entries = candidates.map(entry => Object.assign(buildDetailRewardDisplay({ type: '아이템', item_id: entry.id, count: 1 }), { chance }));
        note = '등록된 모든 보주 중 하나를 동일한 확률로 획득합니다.';
    } else if (typeof item.pack === 'number') {
        const pack = (rpgenius.getDataCache('Pack', []) || [])[item.pack];
        if (Array.isArray(pack)) entries = buildPackChanceEntries(pack);
        note = '표시 확률은 1회 추첨 기준이며, 각 추첨은 서로 독립적으로 진행됩니다.';
    } else if (item.pack && (item.pack.type === '캐릭터 카드팩' || item.pack.type === '전직 캐릭터 카드팩')) {
        entries = buildCharacterPackOutcomes(item.pack);
        note = '캐릭터와 성급은 가능한 모든 조합에서 동일한 확률로 결정됩니다.';
    } else if (item.pack && item.pack.type === '장비 상자') {
        entries = buildUniformEquipmentOutcomes(['weapon', 'armor', 'accessory'], String(item.pack.rarity || ''), true);
        note = '표시된 장비 중 하나를 동일한 확률로 획득합니다. 유니크 레이드 장비는 대상에서 제외됩니다.';
    } else if (item.pack && item.pack.type === '보조 장비 상자') {
        entries = buildUniformEquipmentOutcomes(['support'], String(item.pack.rarity || ''), false);
        note = '표시된 보조 장비 중 하나를 동일한 확률로 획득합니다.';
    } else if (item.pack && item.pack.type === '펫') {
        entries = buildPetPackOutcomes(item.pack);
        note = '표시된 펫 중 하나를 동일한 확률로 획득합니다.';
    }
    const rollCount = Math.max(1, Number(item.num || 1));
    return { kind: 'chance', title: '획득 확률', entries, rollCount, note: (rollCount > 1 ? '아이템 1개당 ' + rollCount + '회 추첨합니다. ' : '') + note };
}

function formatUseDuration(ms) {
    const seconds = Math.max(0, Math.round(Number(ms || 0) / 1000));
    if (seconds >= 60 && seconds % 60 === 0) return comma(seconds / 60) + '분';
    return comma(seconds) + '초';
}

function buildItemUsageFacts(item) {
    const facts = [];
    const useFuncLabels = {
        '체력회복': func => '체력 ' + comma(func.amount) + ' 회복',
        '마나회복': func => '마나 ' + comma(func.amount) + ' 회복',
        '체력회복%': func => '최대 체력의 ' + Math.round(Number(func.amount || 0) * 100) + '% 회복',
        '마나회복%': func => '최대 마나의 ' + Math.round(Number(func.amount || 0) * 100) + '% 회복',
        '경험치획득': func => '경험치 ' + comma(func.amount) + ' 획득',
        '경험치비약': func => formatUseDuration(func.duration) + ' 동안 경험치 획득량 +' + Math.round(Number(func.amount || 0) * 100) + '%',
        '골드비약': func => formatUseDuration(func.duration) + ' 동안 골드 획득량 +' + Math.round(Number(func.amount || 0) * 100) + '%'
    };
    (Array.isArray(item.use_func) ? item.use_func : []).forEach(func => {
        const formatter = func && useFuncLabels[func.type];
        facts.push({ label: func && func.type || '사용 효과', value: formatter ? formatter(func) : String(func && func.type || '효과 적용') });
    });
    const useDetails = {
        '변환': ['적용 대상', '캐릭터 카드의 캐릭터를 지정 캐릭터로 변환'],
        '캐릭터변환': ['적용 대상', '조건에 맞는 캐릭터 카드를 다른 캐릭터로 무작위 변환'],
        '만능캐릭터변환': ['적용 대상', '등급과 전직 여부에 관계없이 캐릭터 카드를 무작위 변환'],
        '전직캐릭터변환': ['적용 대상', '전직 캐릭터 카드를 다른 전직 캐릭터로 무작위 변환'],
        '전직프레스티지': ['사용 효과', '제타 이상 전직 카드에 프레스티지 표시 및 영구 효과 적용'],
        '패션적용': ['적용 대상', '캐릭터 카드에 패션 적용'],
        '고급패션적용': ['적용 대상', '고급 패션 적용이 가능한 캐릭터 카드'],
        '패션제거': ['적용 대상', '패션이 적용된 캐릭터 카드에서 패션 제거'],
        '스탯초기화': ['사용 효과', '투자한 스탯포인트를 모두 회수'],
        '장신구선택권': ['사용 효과', (item.rarity || '지정 등급') + ' 장신구 중 하나를 선택해 획득'],
        '보조장비리롤': ['적용 대상', '보유한 보조 장비의 스탯을 재설정'],
        '잠재능력부여': ['적용 대상', (item.tier ? item.tier + ' 티어로 ' : '') + '잠재능력을 부여할 수 있는 장비'],
        '영혼석': ['적용 대상', '무기 또는 갑옷에 영혼 효과 부여'],
        '보주': ['적용 대상', '보주가 허용된 장비 부위에 효과 부여'],
        '보주선택': ['사용 효과', '원하는 보주를 선택해 획득'],
        '가위': ['적용 대상', '귀속된 장비의 거래 귀속 해제'],
        '생명수': ['적용 대상', '보유 펫의 사용 기간 연장'],
        '초월업그레이드': ['적용 대상', '초월 장비의 초월 단계를 한 단계 상승'],
        '초월선택': ['사용 효과', '원하는 초월 1단계 장비를 선택해 획득' + (item.tradeUsed ? ' (거래 불가)' : '')],
        '아이템선택': ['사용 효과', '아래 아이템 중 1개를 선택해 교환'],
        '흑화': ['적용 대상', '흑화가 가능한 장비']
    };
    if (item.use && useDetails[item.use]) facts.push({ label: useDetails[item.use][0], value: useDetails[item.use][1] });
    if (item.use === '아이템선택') {
        const items = rpgenius.getDataCache('Item', []);
        (Array.isArray(item.choices) ? item.choices : []).forEach(c => {
            const data = items[Number(c.id)];
            if (data) facts.push({ label: '교환 가능', value: data.name + ' x' + comma(Math.max(1, Number(c.count || 1))) });
        });
    }
    if (item.use === '장비강화권' && item.ug) {
        facts.push({ label: '강화 결과', value: '성공 시 장비를 +' + Number(item.ug.level || 0) + '강으로 변경' });
        facts.push({ label: '성공 확률', value: (Math.round(Number(item.ug.roll || 0) * 10000) / 100) + '%' });
    }
    if (item.type === '미끼') facts.push({ label: '사용 효과', value: '낚시에서 사용할 미끼로 장착' });
    if (item.name === '유생의 강화기') facts.push({ label: '사용 효과', value: '선택한 장비를 강화석과 골드 소모 없이 1회 강화' });
    if (item.name === '프레스티지 증표') facts.push({ label: '사용 효과', value: '제타 이상 카드에 프레스티지 표시 및 영구 경험치 획득량 +10%' });
    if (item.no_consume === true) facts.push({ label: '소모 여부', value: '사용 후에도 아이템이 소모되지 않음' });
    return facts;
}

function buildItemApplications(itemId, item) {
    const applications = [];
    const items = rpgenius.getDataCache('Item', []);
    const add = application => {
        const key = [application.category, application.title, application.description].join('|');
        if (!applications.some(entry => entry._key === key)) applications.push(Object.assign({ _key: key }, application));
    };
    const systemUses = {
        '강화석': ['장비 강화', '일반 장비 강화', '초월·신화 장비를 제외한 장비 강화 시 강화 단계에 따라 소모됩니다.'],
        '상급 강화석': ['장비 강화', '초월·신화 장비 강화', '초월 또는 신화 등급 장비 강화 시 강화 단계에 따라 소모됩니다.'],
        '쥬얼': ['잠재능력', '잠재능력 재설정', '1개를 소모해 재설정 골드 비용을 30% 줄입니다. 에픽 이하에서는 승급 확률과 실패 누적이 2배로 적용됩니다.'],
        '화이트 쥬얼': ['잠재능력', '잠재능력 재설정', '1개를 소모해 재설정 골드 비용을 60% 줄입니다. 에픽 이하에서는 승급 확률과 실패 누적이 2배로 적용됩니다.'],
        '장비 보호권': ['장비 강화', '강화 파괴 보호', '강화 실패로 파괴될 때 자동 소모되어 장비를 보호하고 강화 단계를 0으로 초기화합니다.'],
        '고급 장비 보호권': ['장비 강화', '고급 강화 파괴 보호', '강화 실패로 파괴될 때 자동 소모되어 장비와 강화 단계를 유지합니다.'],
        '축복받은 장비 보호권': ['장비 강화', '강화 하락·파괴 보호', '강화 실패로 단계가 하락하거나 장비가 파괴될 때 자동 소모되어 현재 상태를 유지합니다.'],
        '헬 초대장': ['던전 입장', '부타게임[H] 입장', '부타게임[H] 1회 입장 시 30장이 소모됩니다.']
    };
    if (systemUses[item.name]) {
        const info = systemUses[item.name];
        add({ category: info[0], title: info[1], description: info[2], iconUrl: getItemDisplayAssets(item).iconUrl, frameUrl: getItemDisplayAssets(item).frameUrl });
    }
    const recipes = rpgenius.getDataCache('Recipe', []);
    (Array.isArray(recipes) ? recipes : []).forEach(recipe => {
        const material = (Array.isArray(recipe && recipe.materials) ? recipe.materials : []).find(entry => entry && entry.type === '아이템' && Number(entry.item_id) === itemId);
        if (!material) return;
        const outputs = (Array.isArray(recipe.crafted) ? recipe.crafted : []).map(buildDetailRewardDisplay).filter(Boolean);
        const primary = outputs[0] || {};
        add({
            category: '제작 재료',
            title: recipe.name || outputs.map(entry => entry.name).join(', ') || '아이템 제작',
            description: '제작 1회당 ' + item.name + ' ×' + formatItemDetailCount(material.count) + ' 소모',
            resultText: outputs.length ? '제작 결과 · ' + outputs.map(entry => entry.name + ' ×' + entry.count).join(', ') : '',
            iconUrl: primary.iconUrl || primary.imgUrl || null,
            frameUrl: primary.frameUrl || null,
            label: primary.label || '제작'
        });
    });
    items.forEach((target, targetId) => {
        if (!target || targetId === itemId) return;
        const requirement = (Array.isArray(target.require) ? target.require : []).find(entry => Number(entry && entry.id) === itemId);
        if (!requirement) return;
        const assets = getItemDisplayAssets(target);
        add({ category: '사용 조건', title: target.name + ' 사용', description: '1회당 ' + item.name + ' ×' + formatItemDetailCount(requirement.count) + ' 소모', iconUrl: assets.iconUrl, frameUrl: assets.frameUrl });
    });
    const shops = rpgenius.getDataCache('Shop', {});
    Object.keys(shops && typeof shops == 'object' ? shops : {}).forEach(shopName => {
        (Array.isArray(shops[shopName]) ? shops[shopName] : []).forEach(shopEntry => {
            const price = shopEntry && shopEntry.price;
            if (!price || price.goods !== 'item' || Number(price.item_id) !== itemId) return;
            const reward = buildDetailRewardDisplay(shopEntry) || {};
            add({
                category: '교환 재료',
                title: shopName + ' 상점 · ' + (reward.name || '상품'),
                description: '구매 1회당 ' + item.name + ' ×' + formatItemDetailCount(price.amount) + ' 소모',
                resultText: reward.name ? '구매 결과 · ' + reward.name + ' ×' + reward.count : '',
                iconUrl: reward.iconUrl || reward.imgUrl || null,
                frameUrl: reward.frameUrl || null,
                label: reward.label || '상점'
            });
        });
    });
    return applications.map(({ _key, ...entry }) => entry);
}

function decorateWebItemUsePending(pending, user) {
    if (!pending) return null;
    const items = rpgenius.getDataCache('Item', []);
    const equipment = rpgenius.getDataCache('Equipment', {});
    return Object.assign({}, pending, {
        options: (pending.options || []).map(option => {
            const decorated = Object.assign({}, option);
            if ((option.kind === 'card' || option.kind === 'fashion') && option.card) {
                decorated.iconUrl = getCardImageUrl(option.card, user);
            } else if (option.kind === 'equipment') {
                const data = equipment[option.equipmentType] && equipment[option.equipmentType][option.equipmentId];
                if (data) {
                    decorated.iconUrl = getEquipmentIconUrl(data);
                    decorated.frameUrl = getAuctionFrameUrl('equipment', data.rarity);
                }
            } else if (option.kind === 'pet') {
                const data = rpgenius.getPetData(option.petId);
                if (data) {
                    decorated.iconUrl = getPetIconUrl(data);
                    decorated.frameUrl = getAuctionFrameUrl('equipment', data.rarity);
                }
            } else if (option.kind === 'item') {
                const data = items[option.itemId];
                const assets = data ? getItemDisplayAssets(data) : null;
                if (assets) {
                    decorated.iconUrl = assets.iconUrl;
                    decorated.frameUrl = assets.frameUrl;
                }
            }
            return decorated;
        })
    });
}

function buildInventoryItemDetail(itemId, item) {
    const assets = getItemDisplayAssets(item);
    const requirements = (Array.isArray(item.require) ? item.require : []).map(entry => buildDetailRewardDisplay({ type: '아이템', item_id: entry.id, count: entry.count })).filter(Boolean);
    let rewards = null;
    if (item.type === '가챠') rewards = buildGachaDetail(item);
    if (item.type === '미끼') rewards = buildBaitDetail(item);
    if (item.type === '번들') {
        const bundle = (rpgenius.getDataCache('Bundle', []) || [])[item.pack];
        rewards = {
            kind: 'bundle', title: '번들 구성품', rollCount: 1,
            note: '아이템 1개를 사용하면 아래 구성품을 모두 획득합니다.',
            entries: (Array.isArray(bundle) ? bundle : []).map(buildDetailRewardDisplay).filter(Boolean)
        };
    }
    return {
        id: itemId,
        name: item.name,
        type: item.type,
        desc: item.desc || '',
        noTrade: item.no_trade === true,
        usable: isUsableInventoryItem(item),
        bulkUsable: isBulkUsableInventoryItem(item),
        iconUrl: assets.iconUrl,
        frameUrl: assets.frameUrl,
        requirements,
        usageFacts: buildItemUsageFacts(item),
        rewards,
        applications: buildItemApplications(itemId, item),
        showApplicationEmpty: item.type === '재료' || item.type === '티켓'
    };
}

// 즉시 지급된 보상 요약(grantPackReward가 만든 summary)을 아이콘 포함 표시용 배열로 변환
function buildRewardSummaryDisplay(summary) {
    const items = rpgenius.getDataCache('Item', []);
    const equipments = rpgenius.getDataCache('Equipment', {});
    return Object.keys(summary).map(key => {
        const entry = summary[key];
        const parts = key.split(':');
        const type = parts[0];
        let iconUrl = null, frameUrl = null;
        if (type === 'item') {
            const data = items[Number(parts[1])];
            const assets = data ? getItemDisplayAssets(data) : null;
            iconUrl = assets ? assets.iconUrl : null;
            frameUrl = assets ? assets.frameUrl : getAuctionFrameUrl('item');
        } else if (type === 'gold') {
            iconUrl = SHOP_CURR_IMG.gold;
        } else if (type === 'garnet') {
            iconUrl = SHOP_CURR_IMG.garnet;
        } else if (type === 'point') {
            iconUrl = SHOP_CURR_IMG.point;
        } else if (['weapon', 'hat', 'armor', 'pants', 'shoes', 'accessory', 'support'].includes(type)) {
            const data = equipments[type] && equipments[type][Number(parts[1])];
            iconUrl = data ? getEquipmentIconUrl(data) : null;
            frameUrl = data ? getAuctionFrameUrl('equipment', data.rarity) : null;
        } else if (type === 'pet') {
            const data = rpgenius.getPetData(Number(parts[1]));
            iconUrl = data ? getPetIconUrl(data) : null;
            frameUrl = data ? getAuctionFrameUrl('equipment', data.rarity) : null;
        } else if (type === 'card') {
            iconUrl = getCardImageUrl({ id: Number(parts[1]), star: Number(parts[2]), type: parts[3], skin: parts.slice(4).join(':') }, { prestige: false });
        } else if (type === 'title') {
            const title = rpgenius.getTitleById(parts.slice(1).join(':'));
            iconUrl = title ? rpgenius.getTitleImageUrl(title.name) : null;
        }
        return { name: entry.label, count: entry.count, iconUrl, frameUrl };
    });
}

function buildShopItemDisplay(shopItem) {
    const items = rpgenius.getDataCache('Item', []);
    if (shopItem.type === '아이템') {
        const data = items[shopItem.item_id];
        if (!data) return { name: '알 수 없음', iconUrl: null, frameUrl: null };
        const assets = getItemDisplayAssets(data);
        const bundleContents = data.type === '번들' ? buildBundleContents(data) : null;
        return { name: data.name + (shopItem.count > 1 ? ' x' + shopItem.count : ''), iconUrl: assets.iconUrl, frameUrl: assets.frameUrl, bundleContents };
    }
    if (shopItem.type === '가넷') {
        return { name: '가넷 ' + shopItem.count + '개', iconUrl: SHOP_CURR_IMG.garnet, frameUrl: null, isCurrency: true };
    }
    if (shopItem.type === '골드') {
        return { name: '골드 ' + shopItem.count, iconUrl: SHOP_CURR_IMG.gold, frameUrl: null, isCurrency: true };
    }
    return { name: shopItem.type, iconUrl: null, frameUrl: null };
}

function buildShopPriceDisplay(price) {
    const items = rpgenius.getDataCache('Item', []);
    if (price.goods === 'item') {
        const data = items[price.item_id];
        const assets = data ? getItemDisplayAssets(data) : { iconUrl: null, frameUrl: null };
        return { goods: 'item', amount: price.amount, name: data ? data.name : '아이템', iconUrl: assets.iconUrl };
    }
    return { goods: price.goods, amount: price.amount, imgUrl: SHOP_CURR_IMG[price.goods] || null };
}

const SHOP_TAB_ORDER = ['일반', '가넷', '포인트', '마일리지', '패키지', '출석', '초월'];
function buildShopData(user) {
    const shopRaw = rpgenius.getDataCache('Shop', {}) || {};
    const allKeys = Object.keys(shopRaw);
    const tabs = [
        ...SHOP_TAB_ORDER.filter(k => allKeys.includes(k)),
        ...allKeys.filter(k => !SHOP_TAB_ORDER.includes(k)),
    ];
    const shop = {};
    const now = new Date();
    for (const tab of tabs) {
        shop[tab] = (shopRaw[tab] || []).map((item, idx) => {
            // getShopRemainingLimits가 normalizeShopPurchaseRecord도 처리하므로 정확한 값
            const { limits, rec, globalCount, remaining } = rpgenius.getShopRemainingLimits(user, tab, idx, item, now);
            const hasLimits = Object.keys(limits).length > 0;
            const soldOut = (typeof limits.global == 'number' && remaining.global <= 0)
                || (typeof limits.max == 'number' && remaining.max <= 0)
                || (typeof limits.daily == 'number' && remaining.daily <= 0)
                || (typeof limits.weekly == 'number' && remaining.weekly <= 0)
                || (typeof limits.monthly == 'number' && remaining.monthly <= 0);
            const priceItemCount = item.price.goods === 'item'
                ? rpgenius.getInventoryItemCount(user, item.price.item_id) : null;
            return {
                index: idx,
                type: item.type,
                count: item.count,
                display: buildShopItemDisplay(item),
                price: buildShopPriceDisplay(item.price),
                priceItemCount,
                soldOut,
                limitInfo: hasLimits ? { limits, rec, globalCount, remaining } : null,
            };
        });
    }
    return {
        tabs: ['핫딜샵', ...tabs],
        shop,
        currencies: {
            gold: Number(user.gold || 0),
            garnet: Number(user.garnet || 0),
            point: Number(user.point || 0),
            mileage: Number(user.mileage || 0),
        },
    };
}

async function buyShopItem(userName, body) {
    const shopType = String(body.shopType || '');
    const index = Number(body.index); // 0-based from client
    const count = Math.max(1, Math.floor(Number(body.count || 1)));
    if (!shopType) return { error: '상점 종류가 필요합니다.' };
    if (!Number.isInteger(index) || index < 0) return { error: '상품 번호가 올바르지 않습니다.' };
    if (!Number.isInteger(count) || count < 1 || count > 999) return { error: '구매 수량이 올바르지 않습니다.' };

    await rpgenius.loadRpgeniusDataEntry('ShopState');
    const user = await rpgenius.getRPGUserByName(userName);
    if (!user) return { error: '유저를 찾을 수 없습니다.' };
    ensureInventoryShape(user);

    // purchaseShopItem은 1-based index를 사용하므로 +1
    const outMeta = {};
    const result = await rpgenius.purchaseShopItem(user, shopType, index + 1, count, outMeta);
    if (typeof result === 'string' && result.startsWith('❌')) {
        return { error: result.replace(/^❌\s*/, '') };
    }

    return {
        ok: true,
        currencies: {
            gold: Number(user.gold || 0),
            garnet: Number(user.garnet || 0),
            point: Number(user.point || 0),
            mileage: Number(user.mileage || 0),
        },
        bundleGranted: outMeta.bundleGranted ? buildRewardSummaryDisplay(outMeta.bundleGranted) : null,
    };
}

// ===== 경매장 헬퍼 =====

const AUCTION_FEE_RATE = 0.05;
const AUCTION_MAX_PER_USER = 20;
const AUCTION_MAX_PRICE = 1_000_000_000_000;

// ===== 거래 로그 =====
const TRADE_LOG_LIMIT = 2000;

async function getTradeLogList() {
    let data = rpgenius.getDataCache('TradeLog', null);
    if (!data) {
        await rpgenius.loadRpgeniusDataEntry('TradeLog');
        data = rpgenius.getDataCache('TradeLog', null);
    }
    if (!data || !Array.isArray(data.items)) data = { items: [] };
    return data.items;
}

async function saveTradeLogList(items) {
    await rpgenius.saveRpgeniusDataEntry('TradeLog', { items });
}

function buildTradeLogPayload(entry) {
    const characterCards = readJson(CHARACTER_CARDS_PATH, []);
    const equipments = rpgenius.getDataCache('Equipment', {});
    const items = rpgenius.getDataCache('Item', []);
    if (entry.kind == 'card') {
        const id = entry.payload && entry.payload.id;
        const data = characterCards[id];
        return {
            kindLabel: '캐릭터 카드',
            name: data ? data.name : '알 수 없는 카드',
            payload: Object.assign({}, entry.payload || {})
        };
    }
    if (entry.kind == 'equipment') {
        const slot = entry.payload && entry.payload.type;
        const id = entry.payload && entry.payload.id;
        const slotMap = { '무기': 'weapon', '모자': 'hat', '갑옷': 'armor', '상의': 'armor', '하의': 'pants', '신발': 'shoes', '장신구': 'accessory', '보조': 'support' };
        const slotKey = slotMap[slot] || (['weapon', 'hat', 'armor', 'pants', 'shoes', 'accessory', 'support'].includes(slot) ? slot : null);
        const data = slotKey ? (equipments[slotKey] || [])[id] : null;
        return {
            kindLabel: { weapon: '무기', hat: '모자', armor: '갑옷', pants: '하의', shoes: '신발', accessory: '장신구', support: '보조' }[slotKey] || slot || '장비',
            name: data ? data.name : '알 수 없는 장비',
            rarity: data ? data.rarity : null,
            payload: Object.assign({}, entry.payload || {})
        };
    }
    if (entry.kind == 'item') {
        const id = entry.payload && entry.payload.id;
        const data = items[id];
        return {
            kindLabel: '아이템',
            name: data ? data.name : '알 수 없는 아이템',
            payload: Object.assign({}, entry.payload || {})
        };
    }
    if (entry.kind == 'pet') {
        const data = rpgenius.getPetData(entry.payload && entry.payload.id);
        return {
            kindLabel: '펫',
            name: data ? data.name : '알 수 없는 펫',
            rarity: data ? data.rarity : null,
            payload: Object.assign({}, entry.payload || {})
        };
    }
    return { kindLabel: entry.kind || '?', name: '알 수 없음', payload: entry.payload || {} };
}

function buildAuctionRegisterNotice(type, entry) {
    const payloadMeta = buildTradeLogPayload(entry);
    const owner = type == '팝니다' ? entry.sellerName : entry.buyerName;
    const count = Number(entry.count || 1);
    const lines = [
        '[ RPGenius ' + type + ' 등록 ]',
        '- 등록자: ' + owner,
        '- 종류: ' + payloadMeta.kindLabel,
        '- 물품: ' + payloadMeta.name + (count > 1 ? ' x' + comma(count) : ''),
        '- 가격: ' + getCurrencyLabel(entry.currency) + ' ' + comma(entry.price) + (entry.kind == 'item' ? ' / 1개' : '')
    ];
    if (entry.kind == 'card') {
        const ticketCost = rpgenius.getCardTicketCost(entry.payload || {});
        if (ticketCost > 0) lines.push('- 거래권: ' + comma(ticketCost) + '장');
    }
    lines.push('\n웹버전에서 확인할 수 있습니다.\nhttps://rpgenius.kro.kr');
    return lines.join('\n');
}

function buildAuctionTradeNotice(type, entry, actorName, count) {
    const payloadMeta = buildTradeLogPayload(entry);
    const tradeCount = Number(count || 1);
    const unitPrice = Number(entry.price || 0);
    const totalPrice = unitPrice * tradeCount;
    const lines = [
        '[ RPGenius ' + type + ' 체결 ]',
        '- 구매자: ' + (type == '팝니다' ? actorName : entry.buyerName),
        '- 판매자: ' + (type == '팝니다' ? entry.sellerName : actorName),
        '- 종류: ' + payloadMeta.kindLabel,
        '- 물품: ' + payloadMeta.name + (tradeCount > 1 ? ' x' + comma(tradeCount) : ''),
        '- 가격: ' + getCurrencyLabel(entry.currency) + ' ' + comma(totalPrice) + (entry.kind == 'item' && tradeCount > 1 ? ' (개당 ' + comma(unitPrice) + ')' : ''),
    ];
    if (entry.kind == 'card') {
        const ticketCost = rpgenius.getCardTicketCost(entry.payload || {});
        if (ticketCost > 0) lines.push('- 거래권: ' + comma(ticketCost) + '장');
    }
    lines.push('\n웹버전에서 확인할 수 있습니다.\nhttps://rpgenius.kro.kr');
    return lines.join('\n');
}

async function appendTradeLog(record) {
    try {
        const list = await getTradeLogList();
        const log = Object.assign({
            id: 'trd_' + Date.now().toString(36) + '_' + crypto.randomBytes(4).toString('hex'),
            time: Date.now()
        }, record);
        list.unshift(log);
        if (list.length > TRADE_LOG_LIMIT) list.length = TRADE_LOG_LIMIT;
        await saveTradeLogList(list);
    } catch (e) {
        console.error('[trade-log] 기록 실패:', e);
    }
}

async function getAuctionList() {
    let data = rpgenius.getDataCache('Auction', null);
    if (!data) {
        await rpgenius.loadRpgeniusDataEntry('Auction');
        data = rpgenius.getDataCache('Auction', null);
    }
    if (!data || !Array.isArray(data.items)) data = { items: [] };
    return data.items;
}

async function saveAuctionList(items) {
    await rpgenius.saveRpgeniusDataEntry('Auction', { items });
}

function generateAuctionId() {
    return 'auc_' + Date.now().toString(36) + '_' + crypto.randomBytes(4).toString('hex');
}

function getCurrencyLabel(currency) {
    return currency == 'gold' ? '🪙 골드' : '💠 가넷';
}

function describeAuctionPayload(entry) {
    if (entry.kind == 'card') {
        const characterCards = readJson(CHARACTER_CARDS_PATH, []);
        const data = characterCards[entry.payload && entry.payload.id];
        const name = data ? data.name : '알 수 없는 카드';
        return {
            name,
            sub: rpgenius.formatUserCard(entry.payload || {}),
            star: Number(entry.payload && entry.payload.star || 0)
        };
    }
    if (entry.kind == 'equipment') {
        const data = getEquipmentData(entry.payload && entry.payload.type, entry.payload && entry.payload.id);
        const level = Number(entry.payload && entry.payload.level || 0);
        return {
            name: data ? rpgenius.getEquipmentDisplayName(data, entry.payload) : '알 수 없는 장비',
            sub: data ? (data.rarity + ' · ' + ({ weapon: '무기', hat: '모자', armor: '갑옷', pants: '하의', shoes: '신발', accessory: '장신구', support: '보조' }[entry.payload.type] || entry.payload.type)) : '',
            rarity: data ? data.rarity : '',
            equipType: entry.payload && entry.payload.type,
            level
        };
    }
    if (entry.kind == 'item') {
        const items = rpgenius.getDataCache('Item', []);
        const data = items[entry.payload && entry.payload.id];
        return {
            name: data ? data.name : '알 수 없는 아이템',
            sub: data ? data.type : '',
            itemType: data ? data.type : ''
        };
    }
    if (entry.kind == 'pet') {
        const data = rpgenius.getPetData(entry.payload && entry.payload.id);
        return {
            name: data ? data.name : '알 수 없는 펫',
            sub: data ? (data.rarity + ' · 펫') : '펫',
            rarity: data ? data.rarity : ''
        };
    }
    return { name: '알 수 없음', sub: '' };
}

function serializeAuctionEntry(entry, currentUserName, equipmentContext) {
    const desc = describeAuctionPayload(entry);
    let imageUrl = null;
    let frameUrl = null;
    let iconUrl = null;
    let statLines = null;
    let potentialDisplay = null;
    let soul = null;
    let equipmentDetail = null;
    let orbDetail = null;
    if (entry.kind == 'card') {
        imageUrl = getCardImageUrl(entry.payload || {}, { prestige: false });
    } else if (entry.kind == 'equipment') {
        const data = getEquipmentData(entry.payload && entry.payload.type, entry.payload && entry.payload.id);
        const type = entry.payload && entry.payload.type;
        const typeLabels = { weapon: '무기', hat: '모자', armor: '갑옷', pants: '하의', shoes: '신발', accessory: '장신구', support: '보조' };
        const level = Number(entry.payload && entry.payload.level || 0);
        frameUrl = getAuctionFrameUrl('equipment', data && data.rarity);
        iconUrl = getEquipmentIconUrl(data);
        let orbLines = [];
        if (data) {
            const text = rpgenius.formatCurrentEquipmentStatLines(data, level, entry.payload && entry.payload.rolled, { soul: entry.payload && entry.payload.soul });
            statLines = String(text || '').split('\n').filter(line => line && line.trim()).map(line => line.replace(/^-\s*/, ''));
            orbLines = rpgenius.formatOrbLines(entry.payload && entry.payload.orb).map(line => line.replace(/^-\s*/, ''));
            orbLines.forEach(line => statLines.push(line));
        }
        const potential = entry.payload && entry.payload.potential;
        if (potential) {
            potentialDisplay = {
                tierKey: rpgenius.getPotentialRarityKey(potential.rarity),
                tierLabel: rpgenius.getPotentialRarityLabel(potential.rarity),
                entries: rpgenius.formatPotentialOptionEntries(potential)
            };
        }
        const soulPayload = entry.payload && entry.payload.soul;
        if (soulPayload && !rpgenius.isSoulExpired(soulPayload)) {
            soul = { name: soulPayload.name || '', expiredAt: Number(soulPayload.expired_at || 0) };
        }
        const tradeLimit = rpgenius.getEquipmentTradeLimitInfo(entry.payload || {});
        if (tradeLimit) {
            statLines = statLines || [];
            statLines.push('남은 거래 가능 횟수: ' + comma(tradeLimit.remaining) + '/' + comma(tradeLimit.max));
        }
        if (data) {
            let passive = null;
            if (typeof data.passive_id !== 'undefined') {
                const passiveData = rpgenius.getEquipmentPassives()[Number(data.passive_id)];
                if (passiveData) passive = {
                    name: passiveData.name,
                    desc: formatPassiveDesc(passiveData),
                    cooltime: passiveData.cooltime || null
                };
            }
            let setInfo = null;
            if (data.set && equipmentContext) {
                const setName = String(data.set);
                if (!equipmentContext.setCache[setName]) {
                    const owned = (equipmentContext.entries || []).find(item => item.setName === setName);
                    equipmentContext.setCache[setName] = owned && owned.setInfo || buildEquipmentSetOverview(setName, equipmentContext.entries || []);
                }
                setInfo = equipmentContext.setCache[setName];
            }
            equipmentDetail = {
                type,
                typeLabel: typeLabels[type] || type,
                id: Number(entry.payload && entry.payload.id),
                name: rpgenius.getEquipmentDisplayName(data, entry.payload || {}),
                rarity: rpgenius.getEquipmentRarityLabel(data, entry.payload || {}),
                level,
                equipped: false,
                statLines: statLines || [],
                description: data.desc || '',
                passive,
                potentialDisplay,
                soul,
                orb: entry.payload && entry.payload.orb || null,
                orbLines,
                iconUrl,
                frameUrl,
                setInfo
            };
        }
    } else if (entry.kind == 'item') {
        const item = rpgenius.getDataCache('Item', [])[entry.payload && entry.payload.id];
        const assets = getItemDisplayAssets(item);
        frameUrl = assets.frameUrl;
        iconUrl = assets.iconUrl;
        if (item && item.use == '보주') {
            const orb = rpgenius.getOrbData().find(data => data && data.name == item.name);
            if (orb) {
                const partLabels = { weapon: '무기', hat: '모자', armor: '갑옷', pants: '하의', shoes: '신발', accessory: '장신구', support: '보조장비' };
                orbDetail = {
                    partLabels: (orb.parts || []).map(part => partLabels[part] || part),
                    effectLines: dexStatLines(rpgenius.formatOrbLines(orb).slice(1).join('\n'))
                };
            }
        }
    } else if (entry.kind == 'pet') {
        const data = rpgenius.getPetData(entry.payload && entry.payload.id);
        frameUrl = getAuctionFrameUrl('equipment', data && data.rarity);
        iconUrl = getPetIconUrl(data);
        if (data) statLines = buildPetTradeDisplay(data, entry.payload || {});
    }
    const count = Number(entry.count || 1);
    const unitPrice = Number(entry.price || 0);
    const ticketCost = entry.kind == 'card' ? rpgenius.getCardTicketCost(entry.payload || {}) : 0;
    return {
        id: entry.id,
        sellerName: entry.sellerName,
        kind: entry.kind,
        count,
        currency: entry.currency,
        price: unitPrice,
        unitPrice,
        totalPrice: unitPrice * count,
        ticketCost,
        createdAt: Number(entry.createdAt || 0),
        mine: entry.sellerName == currentUserName,
        display: {
            name: desc.name,
            sub: desc.sub,
            rarity: desc.rarity || null,
            equipType: desc.equipType || null,
            star: typeof desc.star == 'number' ? desc.star : null,
            level: typeof desc.level == 'number' ? desc.level : null,
            imageUrl,
            frameUrl,
            iconUrl,
            statLines,
            potentialDisplay,
            soul,
            equipmentDetail,
            orbDetail
        }
    };
}

function buildSellableAssets(user) {
    const cards = (user.inventory && Array.isArray(user.inventory.card) ? user.inventory.card : [])
        .map((card, index) => {
            const serialized = serializeCard(card, user);
            return serialized ? Object.assign({ index }, serialized) : null;
        })
        .filter(Boolean);
    const equipment = (user.inventory && Array.isArray(user.inventory.equipment) ? user.inventory.equipment : [])
        .map((eq, index) => {
            const data = getEquipmentData(eq.type, eq.id);
            if (!data || data.no_trade === true) return null;
            if (rpgenius.getEquipmentTradeBlockReason(eq, user.name)) return null;
            const level = Number(eq.level || 0);
            const statText = rpgenius.formatCurrentEquipmentStatLines(data, level, eq.rolled, { soul: eq.soul });
            const statLines = String(statText || '').split('\n').filter(line => line && line.trim()).map(line => line.replace(/^-\s*/, ''));
            rpgenius.formatOrbLines(eq.orb).forEach(line => statLines.push(line.replace(/^-\s*/, '')));
            const potentialDisplay = eq.potential ? {
                tierKey: rpgenius.getPotentialRarityKey(eq.potential.rarity),
                tierLabel: rpgenius.getPotentialRarityLabel(eq.potential.rarity),
                entries: rpgenius.formatPotentialOptionEntries(eq.potential)
            } : null;
            const soulActive = eq.soul && !rpgenius.isSoulExpired(eq.soul) ? eq.soul : null;
            return {
                index,
                type: eq.type,
                typeLabel: { weapon: '무기', hat: '모자', armor: '갑옷', pants: '하의', shoes: '신발', accessory: '장신구', support: '보조' }[eq.type] || eq.type,
                id: Number(eq.id),
                name: rpgenius.getEquipmentDisplayName(data, eq),
                rarity: data.rarity,
                level,
                boundOwner: rpgenius.isEquipmentBindingEnabled() ? (eq.boundOwner || null) : null,
                tradeCount: Number(eq.tradeCount || 0),
                statLines,
                potentialDisplay,
                soul: soulActive ? { name: soulActive.name || '', expiredAt: Number(soulActive.expired_at || 0) } : null,
                iconUrl: getEquipmentIconUrl(data),
                frameUrl: getAuctionFrameUrl('equipment', data.rarity)
            };
        })
        .filter(Boolean);
    const items = buildInventoryItems(user).filter(item => !item.noTrade);
    const pets = (user.inventory && Array.isArray(user.inventory.pet) ? user.inventory.pet : [])
        .map((pet, index) => {
            if (!rpgenius.isPetTradable(pet)) return null;
            const data = rpgenius.getPetData(pet.id);
            if (!data) return null;
            return {
                index,
                id: Number(pet.id),
                name: data.name,
                rarity: data.rarity,
                level: Number(pet.level || 0),
                tradeCount: Number(pet.tradeCount || 0),
                statLines: buildPetTradeDisplay(data, pet),
                iconUrl: getPetIconUrl(data),
                frameUrl: getAuctionFrameUrl('equipment', data.rarity)
            };
        })
        .filter(Boolean);
    return { cards, equipment, items, pets };
}

function countUserAuctions(items, name) {
    return items.filter(entry => entry.sellerName == name).length;
}

async function registerAuction(sellerName, body) {
    const kind = String(body.kind || '');
    const currency = String(body.currency || '');
    const price = Math.floor(Number(body.price || 0));
    if (!['card', 'equipment', 'item', 'pet'].includes(kind)) return { error: '알 수 없는 종류입니다.' };
    if (!['gold', 'garnet'].includes(currency)) return { error: '가격 화폐는 골드 또는 가넷이어야 합니다.' };
    if (!Number.isInteger(price) || price < 1 || price > AUCTION_MAX_PRICE) return { error: '가격은 1 이상의 정수여야 합니다.' };

    const user = await rpgenius.getRPGUserByName(sellerName);
    if (!user) return { error: '유저를 찾을 수 없습니다.' };
    ensureInventoryShape(user);
    const list = await getAuctionList();
    if (countUserAuctions(list, sellerName) >= AUCTION_MAX_PER_USER) return { error: '경매 등록은 최대 ' + AUCTION_MAX_PER_USER + '건까지 가능합니다.' };

    let payload, count = 1;
    if (kind == 'card') {
        const index = Number(body.index);
        if (!Number.isInteger(index) || index < 0) return { error: '카드를 선택해주세요.' };
        const cards = (user.inventory && user.inventory.card) || [];
        if (!cards[index]) return { error: '존재하지 않는 카드입니다.' };
        const card = cards[index];
        payload = { id: Number(card.id), star: Number(card.star || 0), type: card.type || '일반', skin: card.skin || '' };
        cards.splice(index, 1);
    } else if (kind == 'equipment') {
        const index = Number(body.index);
        if (!Number.isInteger(index) || index < 0) return { error: '장비를 선택해주세요.' };
        const equips = (user.inventory && user.inventory.equipment) || [];
        if (!equips[index]) return { error: '존재하지 않는 장비입니다.' };
        const eq = equips[index];
        const data = getEquipmentData(eq.type, eq.id);
        if (data && data.no_trade === true) return { error: '거래 불가 장비는 판매 등록할 수 없습니다.' };
        const tradeBlockReason = rpgenius.getEquipmentTradeBlockReason(eq, sellerName);
        if (tradeBlockReason) return { error: tradeBlockReason };
        payload = rpgenius.cloneEquipmentInstance(eq, eq.type);
        equips.splice(index, 1);
    } else if (kind == 'item') {
        const itemId = Number(body.itemId);
        count = Math.floor(Number(body.count || 1));
        if (!Number.isInteger(itemId) || itemId < 0) return { error: '아이템을 선택해주세요.' };
        if (!Number.isInteger(count) || count < 1) return { error: '갯수는 1 이상의 정수여야 합니다.' };
        const itemData = rpgenius.getDataCache('Item', [])[itemId];
        if (itemData && itemData.no_trade === true) return { error: '거래 불가 아이템은 판매 등록할 수 없습니다.' };
        const have = rpgenius.getInventoryItemCount(user, itemId);
        if (have < count) return { error: '보유 수량이 부족합니다. (보유 ' + have + ')' };
        const tradable = rpgenius.getTradableItemCount(user, itemId);
        if (tradable < count) return { error: '귀속 아이템은 판매 등록할 수 없습니다. (거래 가능 ' + tradable + '개)' };
        if (!rpgenius.removeInventoryItem(user, itemId, count)) return { error: '아이템 차감에 실패했습니다.' };
        payload = { id: itemId };
    } else if (kind == 'pet') {
        const index = Number(body.index);
        if (!Number.isInteger(index) || index < 0) return { error: '펫을 선택해주세요.' };
        const pets = (user.inventory && user.inventory.pet) || [];
        if (!pets[index]) return { error: '존재하지 않는 펫입니다.' };
        const pet = pets[index];
        if (!rpgenius.getPetData(pet.id)) return { error: '잘못된 펫 데이터입니다.' };
        if (!rpgenius.isPetTradable(pet)) return { error: '거래 가능 횟수가 0인 펫은 판매 등록할 수 없습니다.' };
        payload = rpgenius.clonePetInstance(pet);
        delete payload.shortcuts;
        pets.splice(index, 1);
    }

    const entry = {
        id: generateAuctionId(),
        sellerId: user.id,
        sellerName: user.name,
        kind,
        payload,
        count,
        currency,
        price,
        createdAt: Date.now()
    };
    list.push(entry);
    await saveAuctionList(list);
    await user.save();
    return { id: entry.id, notice: buildAuctionRegisterNotice('팝니다', entry) };
}

function ensureInventoryShape(user) {
    if (!user.inventory) user.inventory = { card: [], item: [], equipment: [], pet: [] };
    if (!Array.isArray(user.inventory.card)) user.inventory.card = [];
    if (!Array.isArray(user.inventory.item)) user.inventory.item = [];
    if (!Array.isArray(user.inventory.equipment)) user.inventory.equipment = [];
    if (!Array.isArray(user.inventory.pet)) user.inventory.pet = [];
}

function buildPetTradeDisplay(petData, pet) {
    const statText = rpgenius.formatEquipmentBaseStatLines(petData, Number(pet && pet.level || 0));
    const statLines = String(statText || '').split('\n').filter(line => line && line.trim()).map(line => line.replace(/^-\s*/, ''));
    (rpgenius.formatPetSpecialLines(rpgenius.normalizePetSpecial(petData)) || []).forEach(l => statLines.push(l.replace(/^-\s*/, '')));
    if (petData && petData.set) statLines.push('세트: ' + petData.set);
    if (pet && typeof pet.tradeCount != 'undefined') statLines.push('남은 거래 가능 횟수: ' + comma(Number(pet.tradeCount || 0)));
    return statLines;
}

async function buyAuction(buyerName, auctionId, buyCountArg) {
    if (!auctionId) return { error: '경매 ID가 비어있습니다.' };
    const list = await getAuctionList();
    const entry = list.find(item => item.id == auctionId);
    if (!entry) return { error: '존재하지 않거나 이미 판매된 경매입니다.' };
    if (entry.sellerName == buyerName) return { error: '본인의 경매는 구매할 수 없습니다.' };

    const buyer = await rpgenius.getRPGUserByName(buyerName);
    if (!buyer) return { error: '유저를 찾을 수 없습니다.' };

    const unitPrice = Number(entry.price || 0);
    const currency = entry.currency;
    const stock = Number(entry.count || 1);
    let buyCount = 1;
    if (entry.kind == 'item') {
        buyCount = Math.floor(Number(buyCountArg || 1));
        if (!Number.isInteger(buyCount) || buyCount < 1) return { error: '구매 갯수는 1 이상의 정수여야 합니다.' };
        if (buyCount > stock) return { error: '남은 재고보다 많이 구매할 수 없습니다. (남은 수량 ' + stock + ')' };
    }
    const totalPrice = unitPrice * buyCount;
    if (Number(buyer[currency] || 0) < totalPrice) return { error: getCurrencyLabel(currency) + '이(가) 부족합니다.' };

    ensureInventoryShape(buyer);

    let ticketId = -1;
    let ticketCost = 0;
    if (entry.kind == 'card') {
        ticketCost = rpgenius.getCardTicketCost(entry.payload || {});
        if (ticketCost > 0) {
            ticketId = rpgenius.getTradeTicketItemId();
            if (ticketId == -1) return { error: '거래권 아이템을 찾을 수 없습니다.' };
            const have = rpgenius.getInventoryItemCount(buyer, ticketId);
            if (have < ticketCost) return { error: '거래권이 부족합니다. (필요 ' + ticketCost + '장 / 보유 ' + have + '장)' };
        }
    }
    if (entry.kind == 'equipment') {
        const tradeBlockReason = rpgenius.getEquipmentTradeBlockReason(entry.payload, entry.sellerName);
        if (tradeBlockReason) return { error: tradeBlockReason };
    }

    if (entry.kind == 'card') {
        if (rpgenius.getRemainingCardInventorySpace(buyer) < 1) return { error: '카드 인벤토리에 빈 칸이 없습니다.' };
        buyer.inventory.card.push({
            id: Number(entry.payload.id),
            star: Number(entry.payload.star || 0),
            type: entry.payload.type || '일반',
            skin: entry.payload.skin || ''
        });
        if (ticketCost > 0 && ticketId != -1) {
            if (!rpgenius.removeInventoryItem(buyer, ticketId, ticketCost)) return { error: '거래권 차감에 실패했습니다.' };
        }
    } else if (entry.kind == 'equipment') {
        const eqEntry = rpgenius.markEquipmentTraded(rpgenius.cloneEquipmentInstance(entry.payload, entry.payload.type));
        buyer.inventory.equipment.push(eqEntry);
    } else if (entry.kind == 'item') {
        rpgenius.addInventoryItem(buyer, Number(entry.payload.id), buyCount);
    } else if (entry.kind == 'pet') {
        const petEntry = rpgenius.markPetTraded(rpgenius.clonePetInstance(entry.payload));
        buyer.inventory.pet.push(petEntry);
    } else {
        return { error: '알 수 없는 종류입니다.' };
    }

    buyer[currency] = Number(buyer[currency] || 0) - totalPrice;

    const fee = Math.floor(totalPrice * AUCTION_FEE_RATE);
    const payout = totalPrice - fee;

    const seller = await rpgenius.getRPGUserByName(entry.sellerName);
    if (seller) {
        seller[currency] = Number(seller[currency] || 0) + payout;
        await seller.save();
    }

    const indexNow = list.findIndex(item => item.id == auctionId);
    if (indexNow == -1) {
        if (seller) {
            seller[currency] = Number(seller[currency] || 0) - payout;
            await seller.save();
        }
        return { error: '이미 판매되었거나 취소된 경매입니다.' };
    }
    if (entry.kind == 'item' && buyCount < stock) {
        list[indexNow].count = stock - buyCount;
    } else {
        list.splice(indexNow, 1);
    }
    await saveAuctionList(list);
    await buyer.save();

    const payloadMeta = buildTradeLogPayload(entry);
    const notice = buildAuctionTradeNotice('팝니다', entry, buyerName, buyCount);
    await appendTradeLog({
        tradeType: '경매장',
        buyer: buyerName,
        seller: entry.sellerName,
        kind: entry.kind,
        kindLabel: payloadMeta.kindLabel,
        itemName: payloadMeta.name,
        rarity: payloadMeta.rarity || null,
        payload: payloadMeta.payload,
        count: buyCount,
        unitPrice: unitPrice,
        totalPrice: totalPrice,
        fee: fee,
        currency: currency
    });
    return { notice };
}

async function cancelAuction(userName, auctionId) {
    if (!auctionId) return { error: '경매 ID가 비어있습니다.' };
    const list = await getAuctionList();
    const index = list.findIndex(item => item.id == auctionId);
    if (index == -1) return { error: '존재하지 않는 경매입니다.' };
    const entry = list[index];
    if (entry.sellerName != userName) return { error: '본인의 경매만 취소할 수 있습니다.' };

    const user = await rpgenius.getRPGUserByName(userName);
    if (!user) return { error: '유저를 찾을 수 없습니다.' };
    ensureInventoryShape(user);

    if (entry.kind == 'card') {
        if (rpgenius.getRemainingCardInventorySpace(user) < 1) return { error: '카드 인벤토리에 빈 칸이 없습니다.' };
        user.inventory.card.push({
            id: Number(entry.payload.id),
            star: Number(entry.payload.star || 0),
            type: entry.payload.type || '일반',
            skin: entry.payload.skin || ''
        });
    } else if (entry.kind == 'equipment') {
        const eqEntry = rpgenius.cloneEquipmentInstance(entry.payload, entry.payload.type);
        user.inventory.equipment.push(eqEntry);
    } else if (entry.kind == 'item') {
        rpgenius.addInventoryItem(user, Number(entry.payload.id), Number(entry.count || 1));
    } else if (entry.kind == 'pet') {
        user.inventory.pet.push(rpgenius.clonePetInstance(entry.payload));
    }

    list.splice(index, 1);
    await saveAuctionList(list);
    await user.save();
    return {};
}

// ===== 삽니다 (구매 등록) 헬퍼 =====

const BUY_ORDER_MAX_PER_USER = 20;

async function getBuyOrderList() {
    let data = rpgenius.getDataCache('BuyOrder', null);
    if (!data) {
        await rpgenius.loadRpgeniusDataEntry('BuyOrder');
        data = rpgenius.getDataCache('BuyOrder', null);
    }
    if (!data || !Array.isArray(data.items)) data = { items: [] };
    return data.items;
}

async function saveBuyOrderList(items) {
    await rpgenius.saveRpgeniusDataEntry('BuyOrder', { items });
}

function generateBuyOrderId() {
    return 'buy_' + Date.now().toString(36) + '_' + crypto.randomBytes(4).toString('hex');
}

function describeBuyOrderPayload(entry) {
    if (entry.kind == 'card') {
        const characterCards = readJson(CHARACTER_CARDS_PATH, []);
        const data = characterCards[entry.payload && entry.payload.id];
        const name = data ? data.name : '알 수 없는 카드';
        const star = Number(entry.payload && entry.payload.star || 0);
        const skin = entry.payload && entry.payload.skin ? String(entry.payload.skin) : '';
        const type = entry.payload && entry.payload.type ? String(entry.payload.type) : '';
        const subParts = [(star + 1) + '성'];
        if (type) subParts.push('타입: ' + type);
        if (skin) subParts.push('스킨: ' + skin);
        return { name, sub: subParts.join(' · '), star };
    }
    if (entry.kind == 'equipment') {
        const data = getEquipmentData(entry.payload && entry.payload.type, entry.payload && entry.payload.id);
        const typeLabel = { weapon: '무기', hat: '모자', armor: '갑옷', pants: '하의', shoes: '신발', accessory: '장신구', support: '보조' }[entry.payload && entry.payload.type] || (entry.payload && entry.payload.type) || '';
        const subParts = [];
        if (data) subParts.push(data.rarity);
        if (typeLabel) subParts.push(typeLabel);
        const hasLevel = entry.payload && typeof entry.payload.level == 'number';
        if (hasLevel) subParts.push('강화 +' + Number(entry.payload.level));
        else subParts.push('강화 무관');
        return {
            name: data ? data.name : '알 수 없는 장비',
            sub: subParts.join(' · '),
            rarity: data ? data.rarity : '',
            equipType: entry.payload && entry.payload.type,
            level: hasLevel ? Number(entry.payload.level) : null
        };
    }
    if (entry.kind == 'item') {
        const items = rpgenius.getDataCache('Item', []);
        const data = items[entry.payload && entry.payload.id];
        return {
            name: data ? data.name : '알 수 없는 아이템',
            sub: data ? data.type : '',
            itemType: data ? data.type : ''
        };
    }
    if (entry.kind == 'pet') {
        const data = rpgenius.getPetData(entry.payload && entry.payload.id);
        return {
            name: data ? data.name : '알 수 없는 펫',
            sub: data ? (data.rarity + ' · 펫') : '펫',
            rarity: data ? data.rarity : ''
        };
    }
    return { name: '알 수 없음', sub: '' };
}

function serializeBuyOrderEntry(entry, currentUserName) {
    const desc = describeBuyOrderPayload(entry);
    let imageUrl = null;
    let frameUrl = null;
    let iconUrl = null;
    let statLines = null;
    if (entry.kind == 'card') {
        imageUrl = getCardImageUrl(entry.payload || {}, { prestige: false });
    } else if (entry.kind == 'equipment') {
        const data = getEquipmentData(entry.payload && entry.payload.type, entry.payload && entry.payload.id);
        frameUrl = getAuctionFrameUrl('equipment', data && data.rarity);
        iconUrl = getEquipmentIconUrl(data);
        if (data && entry.payload && typeof entry.payload.level == 'number') {
            const text = rpgenius.formatCurrentEquipmentStatLines(data, Number(entry.payload.level), entry.payload.rolled);
            statLines = String(text || '').split('\n').filter(line => line && line.trim()).map(line => line.replace(/^-\s*/, ''));
            if (entry.payload.potential) rpgenius.formatPotentialLines(entry.payload.potential).forEach(line => statLines.push(line.replace(/^-\s*/, '')));
        }
    } else if (entry.kind == 'item') {
        const item = rpgenius.getDataCache('Item', [])[entry.payload && entry.payload.id];
        const assets = getItemDisplayAssets(item);
        frameUrl = assets.frameUrl;
        iconUrl = assets.iconUrl;
    } else if (entry.kind == 'pet') {
        const data = rpgenius.getPetData(entry.payload && entry.payload.id);
        frameUrl = getAuctionFrameUrl('equipment', data && data.rarity);
        iconUrl = getPetIconUrl(data);
    }
    const count = Number(entry.count || 1);
    const unitPrice = Number(entry.price || 0);
    const ticketCost = entry.kind == 'card' ? rpgenius.getCardTicketCost(entry.payload || {}) : 0;
    return {
        id: entry.id,
        buyerName: entry.buyerName,
        kind: entry.kind,
        count,
        currency: entry.currency,
        price: unitPrice,
        unitPrice,
        totalPrice: unitPrice * count,
        ticketCost,
        ticketTotal: ticketCost * count,
        createdAt: Number(entry.createdAt || 0),
        mine: entry.buyerName == currentUserName,
        payload: entry.payload,
        display: {
            name: desc.name,
            sub: desc.sub,
            rarity: desc.rarity || null,
            equipType: desc.equipType || null,
            star: typeof desc.star == 'number' ? desc.star : null,
            level: typeof desc.level == 'number' ? desc.level : null,
            imageUrl,
            frameUrl,
            iconUrl,
            statLines
        }
    };
}

function countUserBuyOrders(items, name) {
    return items.filter(entry => entry.buyerName == name).length;
}

async function registerBuyOrder(buyerName, body) {
    const kind = String(body.kind || '');
    const currency = String(body.currency || '');
    const price = Math.floor(Number(body.price || 0));
    const count = Math.floor(Number(body.count || 1));
    if (!['card', 'equipment', 'item', 'pet'].includes(kind)) return { error: '알 수 없는 종류입니다.' };
    if (!['gold', 'garnet'].includes(currency)) return { error: '가격 화폐는 골드 또는 가넷이어야 합니다.' };
    if (!Number.isInteger(price) || price < 1 || price > AUCTION_MAX_PRICE) return { error: '가격은 1 이상의 정수여야 합니다.' };
    if (!Number.isInteger(count) || count < 1) return { error: '갯수는 1 이상의 정수여야 합니다.' };

    const buyer = await rpgenius.getRPGUserByName(buyerName);
    if (!buyer) return { error: '유저를 찾을 수 없습니다.' };
    const list = await getBuyOrderList();
    if (countUserBuyOrders(list, buyerName) >= BUY_ORDER_MAX_PER_USER) return { error: '구매 등록은 최대 ' + BUY_ORDER_MAX_PER_USER + '건까지 가능합니다.' };

    let payload;
    let ticketCostPer = 0;
    if (kind == 'card') {
        const characterCards = readJson(CHARACTER_CARDS_PATH, []);
        const cardId = Number(body.cardId);
        const star = Math.floor(Number(body.star));
        if (!Number.isInteger(cardId) || cardId < 0 || !characterCards[cardId]) return { error: '존재하지 않는 캐릭터 카드입니다.' };
        if (!Number.isInteger(star) || star < 0 || star > 11) return { error: '성급이 올바르지 않습니다.' };
        const skin = body.skin ? String(body.skin).trim() : '';
        const type = body.type ? String(body.type).trim() : '';
        payload = { id: cardId, star };
        if (type) payload.type = type;
        if (skin) payload.skin = skin;
        ticketCostPer = rpgenius.getCardTicketCost({ star });
    } else if (kind == 'equipment') {
        const equipType = String(body.equipType || '');
        if (!['weapon', 'hat', 'armor', 'pants', 'shoes', 'accessory', 'support'].includes(equipType)) return { error: '장비 종류가 올바르지 않습니다.' };
        const eqId = Number(body.equipId);
        const data = getEquipmentData(equipType, eqId);
        if (!data) return { error: '존재하지 않는 장비입니다.' };
        if (data.no_trade === true) return { error: '거래 불가 장비는 구매 등록할 수 없습니다.' };
        payload = { type: equipType, id: eqId };
        if (body.level !== undefined && body.level !== null && body.level !== '') {
            const level = Math.floor(Number(body.level));
            if (!Number.isInteger(level) || level < 0) return { error: '강화 레벨이 올바르지 않습니다.' };
            payload.level = level;
        }
    } else if (kind == 'item') {
        const itemId = Number(body.itemId);
        if (!Number.isInteger(itemId) || itemId < 0) return { error: '아이템을 선택해주세요.' };
        const itemData = rpgenius.getDataCache('Item', [])[itemId];
        if (!itemData) return { error: '존재하지 않는 아이템입니다.' };
        if (itemData.no_trade === true) return { error: '거래 불가 아이템은 구매 등록할 수 없습니다.' };
        payload = { id: itemId };
    } else if (kind == 'pet') {
        const petId = Number(body.petId);
        if (!Number.isInteger(petId) || petId < 0 || !rpgenius.getPetData(petId)) return { error: '존재하지 않는 펫입니다.' };
        payload = { id: petId };
    }

    const totalPrice = price * count;
    if (Number(buyer[currency] || 0) < totalPrice) return { error: getCurrencyLabel(currency) + '이(가) 부족합니다. (필요 ' + comma(totalPrice) + ')' };

    let ticketId = -1;
    const totalTickets = ticketCostPer * count;
    if (totalTickets > 0) {
        ticketId = rpgenius.getTradeTicketItemId();
        if (ticketId == -1) return { error: '거래권 아이템을 찾을 수 없습니다.' };
        const have = rpgenius.getInventoryItemCount(buyer, ticketId);
        if (have < totalTickets) return { error: '거래권이 부족합니다. (필요 ' + totalTickets + '장 / 보유 ' + have + '장)' };
    }

    buyer[currency] = Number(buyer[currency] || 0) - totalPrice;
    if (totalTickets > 0 && ticketId != -1) {
        if (!rpgenius.removeInventoryItem(buyer, ticketId, totalTickets)) return { error: '거래권 차감에 실패했습니다.' };
    }

    const entry = {
        id: generateBuyOrderId(),
        buyerId: buyer.id,
        buyerName: buyer.name,
        kind,
        payload,
        count,
        currency,
        price,
        ticketCostPer,
        createdAt: Date.now()
    };
    list.push(entry);
    await saveBuyOrderList(list);
    await buyer.save();
    return { id: entry.id, notice: buildAuctionRegisterNotice('삽니다', entry) };
}

async function cancelBuyOrder(userName, orderId) {
    if (!orderId) return { error: '구매 등록 ID가 비어있습니다.' };
    const list = await getBuyOrderList();
    const index = list.findIndex(item => item.id == orderId);
    if (index == -1) return { error: '존재하지 않는 구매 등록입니다.' };
    const entry = list[index];
    if (entry.buyerName != userName) return { error: '본인의 구매 등록만 취소할 수 있습니다.' };

    const user = await rpgenius.getRPGUserByName(userName);
    if (!user) return { error: '유저를 찾을 수 없습니다.' };
    ensureInventoryShape(user);

    const remainCount = Number(entry.count || 1);
    user[entry.currency] = Number(user[entry.currency] || 0) + Number(entry.price || 0) * remainCount;
    const ticketCostPer = Number(entry.ticketCostPer || 0);
    if (ticketCostPer > 0) {
        const ticketId = rpgenius.getTradeTicketItemId();
        if (ticketId != -1) rpgenius.addInventoryItem(user, ticketId, ticketCostPer * remainCount);
    }

    list.splice(index, 1);
    await saveBuyOrderList(list);
    await user.save();
    return {};
}

function matchBuyOrderCard(entry, card) {
    if (!card || entry.kind != 'card') return false;
    if (Number(card.id) != Number(entry.payload.id)) return false;
    if (Number(card.star || 0) != Number(entry.payload.star || 0)) return false;
    if (entry.payload.type && String(card.type || '일반') != String(entry.payload.type)) return false;
    if (entry.payload.skin && String(card.skin || '') != String(entry.payload.skin)) return false;
    return true;
}

function matchBuyOrderEquipment(entry, eq) {
    if (!eq || entry.kind != 'equipment') return false;
    if (String(eq.type) != String(entry.payload.type)) return false;
    if (Number(eq.id) != Number(entry.payload.id)) return false;
    if (typeof entry.payload.level == 'number' && Number(eq.level || 0) != Number(entry.payload.level)) return false;
    return true;
}

function matchBuyOrderPet(entry, pet) {
    if (!pet || entry.kind != 'pet') return false;
    if (Number(pet.id) != Number(entry.payload.id)) return false;
    if (!rpgenius.isPetTradable(pet)) return false;
    return true;
}

async function fulfillBuyOrder(sellerName, orderId, body) {
    if (!orderId) return { error: '구매 등록 ID가 비어있습니다.' };
    const list = await getBuyOrderList();
    const entry = list.find(item => item.id == orderId);
    if (!entry) return { error: '존재하지 않거나 이미 종료된 구매 등록입니다.' };
    if (entry.buyerName == sellerName) return { error: '본인의 구매 등록은 이행할 수 없습니다.' };

    const seller = await rpgenius.getRPGUserByName(sellerName);
    if (!seller) return { error: '유저를 찾을 수 없습니다.' };
    ensureInventoryShape(seller);

    const buyer = await rpgenius.getRPGUserByName(entry.buyerName);
    if (!buyer) return { error: '구매자 정보를 찾을 수 없습니다.' };
    ensureInventoryShape(buyer);

    const stock = Number(entry.count || 1);
    const unitPrice = Number(entry.price || 0);
    let sellCount = 1;
    const cards = (seller.inventory && seller.inventory.card) || [];
    const equips = (seller.inventory && seller.inventory.equipment) || [];

    if (entry.kind == 'card') {
        const index = Number(body.index);
        if (!Number.isInteger(index) || index < 0 || !cards[index]) return { error: '판매할 카드를 선택해주세요.' };
        if (!matchBuyOrderCard(entry, cards[index])) return { error: '이 카드는 구매 등록 조건에 맞지 않습니다.' };
        const transferred = cards[index];
        cards.splice(index, 1);
        if (rpgenius.getRemainingCardInventorySpace(buyer) < 1) {
            cards.push(transferred);
            return { error: '구매자의 카드 인벤토리가 가득 차 있습니다.' };
        }
        buyer.inventory.card.push({
            id: Number(transferred.id),
            star: Number(transferred.star || 0),
            type: transferred.type || '일반',
            skin: transferred.skin || ''
        });
    } else if (entry.kind == 'equipment') {
        const index = Number(body.index);
        if (!Number.isInteger(index) || index < 0 || !equips[index]) return { error: '판매할 장비를 선택해주세요.' };
        const eq = equips[index];
        const eqData = getEquipmentData(eq.type, eq.id);
        if (eqData && eqData.no_trade === true) return { error: '거래 불가 장비입니다.' };
        const tradeBlockReason = rpgenius.getEquipmentTradeBlockReason(eq, sellerName);
        if (tradeBlockReason) return { error: tradeBlockReason };
        if (!matchBuyOrderEquipment(entry, eq)) return { error: '이 장비는 구매 등록 조건에 맞지 않습니다.' };
        const transferred = rpgenius.markEquipmentTraded(rpgenius.cloneEquipmentInstance(eq, eq.type));
        equips.splice(index, 1);
        buyer.inventory.equipment.push(transferred);
    } else if (entry.kind == 'item') {
        sellCount = Math.floor(Number(body.count || 1));
        if (!Number.isInteger(sellCount) || sellCount < 1) return { error: '판매 갯수는 1 이상의 정수여야 합니다.' };
        if (sellCount > stock) return { error: '구매 등록에서 요구하는 수량보다 많이 팔 수 없습니다. (남은 수량 ' + stock + ')' };
        const itemId = Number(entry.payload.id);
        const itemData = rpgenius.getDataCache('Item', [])[itemId];
        if (itemData && itemData.no_trade === true) return { error: '거래 불가 아이템입니다.' };
        const have = rpgenius.getInventoryItemCount(seller, itemId);
        if (have < sellCount) return { error: '판매 수량이 부족합니다. (보유 ' + have + ')' };
        const sellerTradable = rpgenius.getTradableItemCount(seller, itemId);
        if (sellerTradable < sellCount) return { error: '귀속 아이템은 판매할 수 없습니다. (거래 가능 ' + sellerTradable + '개)' };
        if (!rpgenius.removeInventoryItem(seller, itemId, sellCount)) return { error: '아이템 차감에 실패했습니다.' };
        rpgenius.addInventoryItem(buyer, itemId, sellCount);
    } else if (entry.kind == 'pet') {
        const pets = (seller.inventory && seller.inventory.pet) || [];
        const index = Number(body.index);
        if (!Number.isInteger(index) || index < 0 || !pets[index]) return { error: '판매할 펫을 선택해주세요.' };
        const pet = pets[index];
        if (!matchBuyOrderPet(entry, pet)) return { error: '이 펫은 구매 등록 조건에 맞지 않거나 거래 가능 횟수가 0입니다.' };
        const transferred = rpgenius.markPetTraded(rpgenius.clonePetInstance(pet));
        pets.splice(index, 1);
        buyer.inventory.pet.push(transferred);
    } else {
        return { error: '알 수 없는 종류입니다.' };
    }

    const totalPrice = unitPrice * sellCount;
    const fee = Math.floor(totalPrice * AUCTION_FEE_RATE);
    const payout = totalPrice - fee;
    seller[entry.currency] = Number(seller[entry.currency] || 0) + payout;

    const indexNow = list.findIndex(item => item.id == orderId);
    if (indexNow == -1) return { error: '이미 종료되었거나 취소된 구매 등록입니다.' };
    if (sellCount < stock) {
        list[indexNow].count = stock - sellCount;
    } else {
        list.splice(indexNow, 1);
    }
    await saveBuyOrderList(list);
    await seller.save();
    await buyer.save();

    const payloadMeta = buildTradeLogPayload(entry);
    const notice = buildAuctionTradeNotice('삽니다', entry, sellerName, sellCount);
    await appendTradeLog({
        tradeType: '삽니다',
        buyer: entry.buyerName,
        seller: sellerName,
        kind: entry.kind,
        kindLabel: payloadMeta.kindLabel,
        itemName: payloadMeta.name,
        rarity: payloadMeta.rarity || null,
        payload: payloadMeta.payload,
        count: sellCount,
        unitPrice: unitPrice,
        totalPrice: totalPrice,
        fee: fee,
        currency: entry.currency
    });
    return { notice };
}

function buildBuyOrderLookups() {
    const characterCards = readJson(CHARACTER_CARDS_PATH, []);
    const equipments = rpgenius.getDataCache('Equipment', {});
    const items = rpgenius.getDataCache('Item', []);
    const cardList = characterCards.map((data, id) => {
        if (!data) return null;
        return { id, name: data.name, imageUrl: getCardImageUrl({ id, star: 0 }, { prestige: false }) };
    }).filter(Boolean);
    const pack = (list, type) => (list || []).map((e, id) => {
        if (!e || e.no_trade === true) return null;
        const iconUrl = getEquipmentIconUrl(e);
        const frameUrl = getAuctionFrameUrl('equipment', e.rarity);
        return { id, name: e.name, rarity: e.rarity, iconUrl, frameUrl };
    }).filter(Boolean);
    const equipmentList = {
        weapon: pack(equipments.weapon, 'weapon'),
        hat: pack(equipments.hat, 'hat'),
        armor: pack(equipments.armor, 'armor'),
        pants: pack(equipments.pants, 'pants'),
        shoes: pack(equipments.shoes, 'shoes'),
        accessory: pack(equipments.accessory, 'accessory'),
        support: pack(equipments.support, 'support')
    };
    const itemList = items.map((it, id) => {
        if (!it || it.no_trade === true) return null;
        const assets = getItemDisplayAssets(it);
        return { id, name: it.name, type: it.type, iconUrl: assets.iconUrl, frameUrl: assets.frameUrl };
    }).filter(Boolean);
    const pets = rpgenius.getDataCache('Pet', []);
    const petList = (Array.isArray(pets) ? pets : []).map((p, id) => {
        if (!p) return null;
        return { id, name: p.name, rarity: p.rarity, iconUrl: getPetIconUrl(p), frameUrl: getAuctionFrameUrl('equipment', p.rarity) };
    }).filter(Boolean);
    return { cards: cardList, equipment: equipmentList, items: itemList, pets: petList };
}

function buildFulfillableAssets(user, entry) {
    const result = { cards: [], equipment: [], itemCount: 0, pets: [] };
    if (!entry) return result;
    if (entry.kind == 'card') {
        const cards = (user.inventory && Array.isArray(user.inventory.card) ? user.inventory.card : []);
        cards.forEach((card, index) => {
            if (!matchBuyOrderCard(entry, card)) return;
            const serialized = serializeCard(card, user);
            if (serialized) result.cards.push(Object.assign({ index }, serialized));
        });
    } else if (entry.kind == 'equipment') {
        const equips = (user.inventory && Array.isArray(user.inventory.equipment) ? user.inventory.equipment : []);
        equips.forEach((eq, index) => {
            if (!matchBuyOrderEquipment(entry, eq)) return;
            const data = getEquipmentData(eq.type, eq.id);
            if (!data || data.no_trade === true) return;
            if (rpgenius.getEquipmentTradeBlockReason(eq, user.name)) return;
            const level = Number(eq.level || 0);
            const statText = rpgenius.formatCurrentEquipmentStatLines(data, level, eq.rolled, { soul: eq.soul });
            const statLines = String(statText || '').split('\n').filter(line => line && line.trim()).map(line => line.replace(/^-\s*/, ''));
            rpgenius.formatOrbLines(eq.orb).forEach(line => statLines.push(line.replace(/^-\s*/, '')));
            if (eq.potential) rpgenius.formatPotentialLines(eq.potential).forEach(line => statLines.push(line.replace(/^-\s*/, '')));
            result.equipment.push({
                index,
                type: eq.type,
                typeLabel: { weapon: '무기', hat: '모자', armor: '갑옷', pants: '하의', shoes: '신발', accessory: '장신구', support: '보조' }[eq.type] || eq.type,
                id: Number(eq.id),
                name: rpgenius.getEquipmentDisplayName(data, eq),
                rarity: data.rarity,
                level,
                boundOwner: rpgenius.isEquipmentBindingEnabled() ? (eq.boundOwner || null) : null,
                tradeCount: Number(eq.tradeCount || 0),
                statLines
            });
        });
    } else if (entry.kind == 'item') {
        const itemId = Number(entry.payload && entry.payload.id);
        result.itemCount = rpgenius.getInventoryItemCount(user, itemId);
    } else if (entry.kind == 'pet') {
        const pets = (user.inventory && Array.isArray(user.inventory.pet) ? user.inventory.pet : []);
        pets.forEach((pet, index) => {
            if (!matchBuyOrderPet(entry, pet)) return;
            const data = rpgenius.getPetData(pet.id);
            if (!data) return;
            result.pets.push({
                index,
                id: Number(pet.id),
                name: data.name,
                rarity: data.rarity,
                level: Number(pet.level || 0),
                tradeCount: Number(pet.tradeCount || 0),
                statLines: buildPetTradeDisplay(data, pet)
            });
        });
    }
    return result;
}

function buildTitleDisplay(user) {
    const def = rpgenius.getEquippedTitleDef(user);
    if (!def) return null;
    return { id: def.id, name: def.name, imageUrl: rpgenius.getTitleImageUrl(def.name) };
}

// 게임에 존재하는 모든 스탯 (그룹 유지)
const PROFILE_STAT_GROUPS = [
    { title: '기본', keys: ['atk', 'def', 'hp', 'mp', 'pnt', 'pntPercent'] },
    { title: '치명타', keys: ['crit', 'critMul', 'critDef'] },
    { title: '연격', keys: ['cmb', 'maxCmb'] },
    { title: '피해', keys: ['afterBasic', 'afterSkill', 'damageBonus', 'eliteDmg', 'bossDmg', 'finalDamage', 'extraDamage', 'dotDamage', 'skillTrueDmg', 'nonElementDamage'] },
    { title: '속성', keys: ['allElementAtk', 'allElementRes', 'fireAtk', 'waterAtk', 'lightAtk', 'darkAtk', 'fireRes', 'waterRes', 'lightRes', 'darkRes'] },
    { title: '생존 · 유틸', keys: ['avd', 'takenDamage', 'recoveryEfficiency', 'potion', 'mpReduce', 'skillCooldown', 'cooldown', 'summonDuration'] },
    { title: '획득', keys: ['gold', 'plusGold', 'exp', 'itemDropChance'] },
];
const PROFILE_STAT_LABELS = {
    atk: '공격력', def: '방어력', hp: '최대 체력', mp: '최대 MP', pnt: '방어 관통력', pntPercent: '방어력 관통',
    crit: '치명타 확률', critMul: '치명타 피해량', critDef: '치명타 피해 감소율',
    cmb: '연격 확률', maxCmb: '추가 공격 횟수',
    afterBasic: '일반 공격 피해', afterSkill: '스킬 공격 피해', damageBonus: '일반 몬스터 추가 피해',
    eliteDmg: '엘리트 추가 피해', bossDmg: '보스 추가 피해', finalDamage: '최종 피해', extraDamage: '추가 피해', dotDamage: '지속 피해',
    nonElementDamage: '[무]속성 공격 피해',
    butagamePartyQuestDmg: "'부타게임' 파티 퀘스트 내 추가 피해",
    fireAtk: '[화]속성 강화', waterAtk: '[수]속성 강화', lightAtk: '[명]속성 강화', darkAtk: '[암]속성 강화',
    fireRes: '[화]속성 저항', waterRes: '[수]속성 저항', lightRes: '[명]속성 저항', darkRes: '[암]속성 저항',
    allElementAtk: '모든 속성 강화', allElementRes: '모든 속성 저항',
    '000': '10/100/1000 추가 피해 확률', skillTrueDmg: '스킬 추가 고정 피해',
    avd: '회피 확률', takenDamage: '받는 피해 증가', recoveryEfficiency: '회복 효율', potion: '물약 효율',
    mpReduce: 'MP 소모량', skillCooldown: '스킬 쿨타임', cooldown: '쿨타임 감소', summonDuration: '소환 지속시간',
    gold: '골드 획득량', plusGold: '처치 당 골드', exp: '경험치 획득량', itemDropChance: '아이템 획득 확률',
};
// 수치 + % 곱연산으로 합산되는 스탯 (수치/% 따로 표시)
const PROFILE_STAT_MULT = new Set(['atk', 'def', 'hp', 'mp']);
const PROFILE_STAT_NUMERIC = new Set(['atk', 'def', 'hp', 'mp', 'pnt', 'maxCmb', 'plusGold', 'skillTrueDmg', 'fireAtk', 'waterAtk', 'lightAtk', 'darkAtk', 'fireRes', 'waterRes', 'lightRes', 'darkRes', 'allElementAtk', 'allElementRes']);
const PROFILE_STAT_DIRECT = new Set(['crit', 'critMul', 'critDef', 'cmb', 'pntPercent', 'skillCooldown']);
// 낮을수록(음수일수록) 이득인 스탯 — 음수일 때 긍정(초록) 표시
const PROFILE_STAT_INVERSE = new Set(['skillCooldown', 'takenDamage', 'mpReduce']);
// 캐릭터 카드 슬롯 효과 → 표시 스탯 매핑 (crit/critMul은 calculateUserStats에서 이미 합산됨)
const SLOT_EFFECT_TO_STAT = {
    expBonus: 'exp', mpCostReduction: 'mpReduce', damageBonus: 'damageBonus', goldBonus: 'gold',
    itemDropChance: 'itemDropChance', defReduction: 'pntPercent', basicDamageBonus: 'afterBasic', skillDamageBonus: 'afterSkill',
};
// 슬롯 효과 값을 스탯에 더할 때의 부호 (mpCostReduction은 소모량을 줄이므로 음수로 적용)
const SLOT_EFFECT_SIGN = { mpCostReduction: -1 };

function applySlotEffectsToStats(stats, slotEffects) {
    const out = Object.assign({}, stats);
    Object.keys(SLOT_EFFECT_TO_STAT).forEach(k => {
        const v = Number((slotEffects || {})[k] || 0) * (SLOT_EFFECT_SIGN[k] || 1);
        if (v) { const sk = SLOT_EFFECT_TO_STAT[k]; out[sk] = Number(out[sk] || 0) + v; }
    });
    return out;
}

function statTone(key, rawValue) {
    const v = Number(rawValue || 0);
    if (v === 0 || PROFILE_STAT_NUMERIC.has(key)) return 'neutral';
    const beneficial = PROFILE_STAT_INVERSE.has(key) ? v < 0 : v > 0;
    return beneficial ? 'good' : 'bad';
}

function fmtProfileStat(key, val) {
    if (PROFILE_STAT_NUMERIC.has(key)) return comma(Math.round(Number(val || 0)));
    const k = PROFILE_STAT_DIRECT.has(key) ? key : key + '%';
    return rpgenius.formatStatValue(k, val).replace(/^\+/, '');
}

function pctText(ratio) {
    const v = Math.round(Number(ratio || 0) * 1000) / 10;
    return (v >= 0 ? '+' : '') + v + '%';
}

function buildProfileStatItem(key, stats, plusStats) {
    if (PROFILE_STAT_MULT.has(key)) {
        const total = Math.round(Number(stats[key] || 0));
        const plus = Number(plusStats[key] || 0);
        const flat = plus !== 0 ? Math.round(total / (1 + plus)) : total;
        return { label: PROFILE_STAT_LABELS[key], value: comma(total), sub: '수치 ' + comma(flat) + ' · ' + pctText(plus), owned: true, tone: 'neutral' };
    }
    const raw = Number(stats[key] || 0);
    return { label: PROFILE_STAT_LABELS[key], value: fmtProfileStat(key, stats[key]), owned: raw !== 0, tone: statTone(key, raw) };
}

function buildProfileStatGroups(stats, plusStats) {
    return PROFILE_STAT_GROUPS.map(g => ({
        title: g.title,
        items: g.keys.map(key => buildProfileStatItem(key, stats, plusStats)),
    }));
}

function buildWebStatPointInfo(user) {
    const info = rpgenius.getStatPointInfo(user);
    const items = rpgenius.getDataCache('Item', []);
    const resetItemId = findItemIdByName('순백의 결정');
    const resetItem = resetItemId >= 0 ? items[resetItemId] : null;
    const resetAssets = resetItem ? getItemDisplayAssets(resetItem) : { iconUrl: null, frameUrl: null };
    return Object.assign(info, {
        gold: Number(user.gold || 0),
        goldIconUrl: getItemImageUrl('화폐', '골드.png'),
        resetItem: {
            name: '순백의 결정',
            count: resetItemId >= 0 ? rpgenius.getInventoryItemCount(user, resetItemId) : 0,
            iconUrl: resetAssets.iconUrl,
            frameUrl: resetAssets.frameUrl
        }
    });
}

function buildUserProfile(user) {
    const level = Number(user.level || 1);
    const exp = Number(user.exp || 0);
    const maxExp = getMaxExpForLevel(level);
    const _bd = {};
    const stats = rpgenius.calculateUserStats(user, _bd);
    const plusStats = _bd.plusStats || {};
    const slotEffects = rpgenius.calculateCardSlotEffects(user);
    const dispStats = applySlotEffectsToStats(stats, slotEffects);
    const cp = rpgenius.calculateCombatPower(user);
    const maxHp = Number(stats.hp || 0);
    const maxMp = Number(stats.mp || 0);
    const cardSlots = user.card_slot || [];
    const maxCardSlot = Number(user.maxCardSlot || 5);
    const slots = [];
    for (let i = 0; i < maxCardSlot; i++) slots.push(cardSlots[i] ? serializeCard(cardSlots[i], user) : null);
    return {
        user: {
            name: user.name,
            level,
            exp,
            maxExp,
            hp: typeof user.hp == 'undefined' ? maxHp : Number(user.hp || 0),
            maxHp,
            mp: typeof user.mp == 'undefined' ? maxMp : Number(user.mp || 0),
            maxMp,
            gold: Number(user.gold || 0),
            garnet: Number(user.garnet || 0),
            point: Number(user.point || 0),
            mileage: Number(user.mileage || 0),
            isAdmin: !!user.isAdmin,
            canPartyQuest: !!user.canPartyQuest,
            maxAccessory: Number(user.maxAccessory || 3),
            title: buildTitleDisplay(user)
        },
        combatPower: cp,
        stats: {
            atk: Number(stats.atk || 0),
            def: Number(stats.def || 0),
            pnt: Number(stats.pnt || 0),
            critText: rpgenius.formatStatValue('crit', stats.crit).replace(/^\+/, ''),
            critMulText: rpgenius.formatStatValue('critMul', stats.critMul).replace(/^\+/, '')
        },
        statGroups: buildProfileStatGroups(dispStats, plusStats),
        statPoint: buildWebStatPointInfo(user),
        currencyIcons: {
            gold: getItemImageUrl('화폐', '골드.png'),
            garnet: getItemImageUrl('화폐', '가넷.png'),
            point: getItemImageUrl('화폐', '포인트.png')
        },
        mainCard: serializeCard(user.main_card, user),
        cardSlots: slots,
        equippedEquipment: buildInventoryEquipment(user).filter(equipment => equipment.equipped),
        equippedPets: buildInventoryPets(user).filter(pet => pet.equipped),
        equipmentInfoText: rpgenius.formatEquipmentInfo(user)
    };
}

function renderLogin() {
    return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><title>RPGenius</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
@import url("https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard-dynamic-subset.min.css");
:root{color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;min-height:100svh;display:grid;place-items:center;background:#101216;color:#eceef2;font-family:Pretendard,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
.card{background:#181b21;border:1px solid #2a2e37;border-radius:10px;padding:34px 30px;width:min(380px,92vw)}
h1{margin:0 0 8px;font-size:20px;font-weight:700;color:#eceef2;letter-spacing:.02em}
p.sub{margin:0 0 24px;color:#9aa3b2;font-size:13px}
label{display:block;font-size:11px;color:#646c79;margin-bottom:8px;font-weight:600;letter-spacing:.06em;text-transform:uppercase}
input{width:100%;padding:12px 14px;background:#14161b;border:1px solid #2a2e37;border-radius:6px;color:#eceef2;font-size:14px;outline:none;font-family:ui-monospace,monospace;letter-spacing:.08em;transition:border-color .15s,box-shadow .15s}
input:focus{border-color:#e8b04b;box-shadow:0 0 0 3px rgba(232,176,75,.15)}
button{width:100%;margin-top:18px;padding:13px;background:#e8b04b;color:#1f1503;border:0;border-radius:6px;font-weight:700;cursor:pointer;font-size:14px;letter-spacing:.02em;transition:background .15s}
button:hover{background:#f0c56e}
button:disabled{opacity:.6;cursor:wait}
.err{margin-top:12px;color:#e0655c;font-size:13px;min-height:18px}
.alt{margin:14px 0 0;text-align:center;font-size:13px}.alt a{color:#e8b04b;text-decoration:none}.alt a:hover{text-decoration:underline}
</style></head><body>
<div class="card" id="card">
  <h1>RPGenius</h1>
  <p class="sub" id="sub">닉네임을 입력하세요.</p>
  <form id="f1">
    <label>닉네임</label>
    <input id="nameInput" autocomplete="off" spellcheck="false" placeholder="닉네임" required>
    <button type="submit">다음</button>
  </form>
  <form id="f2" style="display:none">
    <div id="codeField">
      <label>로그인 코드</label>
      <input id="codeInput" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="ABCDE12345">
    </div>
    <div id="otpField" style="display:none">
      <label>OTP 코드 (Google Authenticator)</label>
      <input id="otpInput" autocomplete="one-time-code" inputmode="numeric" pattern="[0-9]*" maxlength="6" spellcheck="false" placeholder="123456">
    </div>
    <button type="submit">로그인</button>
    <p class="alt" id="otpAltWrap" style="display:none"><a href="#" id="otpAlt">OTP 코드로 로그인</a></p>
  </form>
  <form id="f3" style="display:none">
    <label>닉네임</label>
    <input id="regInput" autocomplete="off" spellcheck="false" placeholder="사용할 닉네임 (최대 10자)" required>
    <button type="submit">등록</button>
  </form>
  <div class="err" id="err"></div>
  <p class="alt"><a href="#" id="toggleLink">계정이 없으신가요? 등록하기</a></p>
</div>
<script>
const err=document.getElementById('err');
const f1=document.getElementById('f1'),f2=document.getElementById('f2');
const nameInput=document.getElementById('nameInput'),codeInput=document.getElementById('codeInput'),otpInput=document.getElementById('otpInput');
const codeField=document.getElementById('codeField'),otpField=document.getElementById('otpField');
const otpAltWrap=document.getElementById('otpAltWrap'),otpAlt=document.getElementById('otpAlt');
let savedName='',useOtp=false;
function showStep2(){
  codeField.style.display=useOtp?'none':'';
  otpField.style.display=useOtp?'':'none';
  codeInput.required=!useOtp;otpInput.required=useOtp;
  document.getElementById('sub').textContent=useOtp?'OTP 코드를 입력하세요.':'코드를 입력하세요.';
  otpAlt.textContent=useOtp?'로그인 코드로 로그인':'OTP 코드로 로그인';
  f1.style.display='none';f2.style.display='';
  (useOtp?otpInput:codeInput).focus();
}
otpAlt.addEventListener('click',e=>{e.preventDefault();err.textContent='';useOtp=!useOtp;showStep2();});
f1.addEventListener('submit',async e=>{
  e.preventDefault();err.textContent='';
  const btn=f1.querySelector('button');btn.disabled=true;
  try{
    const r=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:nameInput.value.trim()})});
    const j=await r.json();
    if(!r.ok)throw new Error(j.error||'로그인 실패');
    if(j.ok){location.reload();return;}
    if(j.needCode){
      savedName=nameInput.value.trim();
      useOtp=false;
      otpAltWrap.style.display=j.canOtp?'':'none';
      showStep2();
    }
  }catch(x){err.textContent='❌ '+x.message;}
  btn.disabled=false;
});
f2.addEventListener('submit',async e=>{
  e.preventDefault();err.textContent='';
  const btn=f2.querySelector('button');btn.disabled=true;
  try{
    const body={name:savedName};
    if(useOtp)body.otp=otpInput.value.trim();
    else body.code=codeInput.value.trim();
    const r=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const j=await r.json();
    if(!r.ok)throw new Error(j.error||'로그인 실패');
    location.reload();
  }catch(x){err.textContent='❌ '+x.message;btn.disabled=false;}
});
const f3=document.getElementById('f3'),regInput=document.getElementById('regInput'),toggleLink=document.getElementById('toggleLink'),sub=document.getElementById('sub');
let regMode=false;
toggleLink.addEventListener('click',e=>{
  e.preventDefault();err.textContent='';
  regMode=!regMode;
  if(regMode){f1.style.display='none';f2.style.display='none';f3.style.display='';sub.textContent='사용할 닉네임을 입력하세요.';toggleLink.textContent='이미 계정이 있으신가요? 로그인';regInput.focus();}
  else{f3.style.display='none';f1.style.display='';sub.textContent='닉네임을 입력하세요.';toggleLink.textContent='계정이 없으신가요? 등록하기';nameInput.focus();}
});
f3.addEventListener('submit',async e=>{
  e.preventDefault();err.textContent='';
  const btn=f3.querySelector('button');btn.disabled=true;
  try{
    const r=await fetch('/api/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:regInput.value.trim()})});
    const j=await r.json();
    if(!r.ok)throw new Error(j.error||'등록 실패');
    location.reload();
  }catch(x){err.textContent='❌ '+x.message;btn.disabled=false;}
});
</script></body></html>`;
}

function renderUserDashboard(sess, opts) {
    const initialPage = opts && opts.initialPage ? opts.initialPage : '';
    return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><title>RPGenius</title>
<script>window.__INITIAL_PAGE=${JSON.stringify(initialPage)};</script>
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/static/style.css"></head><body>
<header><div class="top-left"><h1>RPGenius</h1><nav class="group-tabs" id="groupTabs"></nav></div><div class="bar"><div class="point-pill" id="pointPill" title="보유 포인트"><img src="${getItemImageUrl('화폐', '포인트.png')}" alt="포인트"><b id="pointAmount">0</b><button id="pointAddBtn" type="button" aria-label="포인트 충전">+</button></div><span class="who" id="who">${escapeHtml(sess.name)}</span><button id="adminLink" class="primary" style="display:none;padding:8px 12px;font-size:13px">관리자</button><button id="otpBtn" style="padding:8px 12px;font-size:13px" title="2단계 인증 설정">OTP</button><button id="logout" style="padding:8px 12px;font-size:13px">로그아웃</button></div></header>
<div class="subnav-bar" id="subNavBar"></div>
<main id="app">
  <div class="page active" data-page="home"><div id="homeBannerList" class="home-banner-list"></div></div>
  <div class="page" data-page="chat">
    <div class="webchat-shell" id="webChatShell">
      <aside class="webchat-rooms">
        <div class="webchat-list-head"><h2>채팅</h2><p>웹 사용자 전용 채팅방입니다.</p></div>
        <div class="webchat-room-list" id="webChatRoomList"></div>
      </aside>
      <section class="webchat-conversation">
        <div class="webchat-head"><button class="webchat-back" id="webChatBack" type="button" aria-label="채팅방 목록">‹</button><div class="webchat-head-copy"><b id="webChatRoomTitle">채팅방을 선택하세요</b><span id="webChatRoomDetail">공용 채팅방 또는 개인 채팅을 선택할 수 있습니다.</span></div></div>
        <div class="webchat-message-wrap"><div class="webchat-messages" id="webChatMessages" role="log" aria-live="polite"><div class="webchat-empty">왼쪽에서 채팅방을 선택하세요.</div></div><button class="webchat-new" id="webChatNewMessage" type="button" hidden>새 메시지 ↓</button></div>
        <div class="webchat-composer"><div class="webchat-input-line"><textarea id="webChatInput" maxlength="500" rows="1" aria-label="채팅 메시지" placeholder="메시지를 입력하세요."></textarea><button class="primary webchat-send" id="webChatSend" type="button">전송</button></div><div class="webchat-error" id="webChatError"></div></div>
      </section>
    </div>
  </div>
  <div class="webchat-modal-bg" id="webChatFullModal" hidden>
    <section class="webchat-modal" role="dialog" aria-modal="true" aria-labelledby="webChatFullTitle">
      <div class="webchat-modal-head"><h3 id="webChatFullTitle">전체보기</h3><button class="webchat-modal-close" id="webChatFullClose" type="button" aria-label="전체보기 닫기">×</button></div>
      <div class="webchat-modal-content" id="webChatFullContent"></div>
    </section>
  </div>
  <div class="page" data-page="info">
    <div class="pf-sheet">
      <div class="pf-hero">
        <div class="pf-hero-bg" id="pfHeroBg"></div>
        <div class="pf-hero-inner">
          <div id="mainCard" class="pf-card"></div>
          <div class="pf-ident">
            <div id="profileTitle" class="pf-title"></div>
            <div class="pf-name-row"><span id="profileName" class="pf-name">-</span><span id="level" class="pf-level">-</span></div>
            <div class="pf-exp-wrap"><div class="pf-exp-bar"><i id="expFill"></i></div><div id="exp" class="pf-exp">-</div></div>
            <div class="pf-power"><span class="pf-power-label">전투력</span><b id="totalPower">-</b></div>
            <div id="petRow" class="pf-pets"></div>
          </div>
        </div>
      </div>
      <div class="pf-body">
        <div class="pf-tabs">
          <button class="pf-tab active" data-pftab="gear" type="button">장비</button>
          <button class="pf-tab" data-pftab="cards" type="button">슬롯 카드</button>
          <button class="pf-tab" data-pftab="stats" type="button">스탯</button>
          <button class="pf-tab" data-pftab="statpoint" type="button">스탯포인트</button>
          <button class="pf-tab" data-pftab="goods" type="button">재화</button>
        </div>
        <div class="pf-panel active" data-pfpanel="gear"><div id="equippedGear" class="gear-slots"></div></div>
        <div class="pf-panel" data-pfpanel="cards"><div id="slotCards" class="cards"></div></div>
        <div class="pf-panel" data-pfpanel="stats"><div class="pf-panel-head"><h2>스탯</h2><label class="stat-filter"><input type="checkbox" id="statHideZero"><span>비보유 숨기기</span></label></div><div id="stats" class="stat-body"></div></div>
        <div class="pf-panel" data-pfpanel="statpoint"><div id="statPointBody"></div></div>
        <div class="pf-panel" data-pfpanel="goods"><div id="goods"></div></div>
      </div>
    </div>
  </div>
  <div class="page" data-page="inventory">
    <div id="inventoryBanner" class="profile-banner" style="display:none"><span id="inventoryBannerText"></span><button id="inventoryBackBtn" class="primary">내 인벤토리로 돌아가기</button></div>
    <section class="panel inventory-shell">
      <div class="inventory-head">
        <div class="inventory-title-block"><h2 id="viewerTitle">인벤토리</h2></div>
        <div class="inventory-total"><span id="inventoryTotalLabel">보유 슬롯</span><b id="inventoryTotal">0</b></div>
      </div>
      <div class="inventory-console">
        <div class="inv-kind-tabs" role="tablist" aria-label="인벤토리 분류">
          <button class="view-btn inv-kind-tab" data-kind="items" role="tab">아이템</button>
          <button class="view-btn inv-kind-tab" data-kind="cards" role="tab">캐릭터 카드</button>
          <button class="view-btn inv-kind-tab" data-kind="equipment" role="tab">장비</button>
          <button class="view-btn inv-kind-tab" data-kind="pet" role="tab">펫</button>
        </div>
        <label class="inventory-search"><span aria-hidden="true">⌕</span><input id="inventorySearch" type="search" placeholder="이름으로 검색" autocomplete="off"><button id="inventorySearchClear" type="button" aria-label="검색어 지우기">×</button></label>
      </div>
      <div id="viewer" class="viewer inventory-viewer"></div>
    </section>
  </div>
  <div class="page" data-page="mail">
    <div class="mailbox" id="mailbox">
      <div class="mailbox-list-pane">
        <div class="mailbox-head">
          <h2><svg class="mail-head-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>메일함</h2>
          <button class="primary mail-compose-btn" id="mailComposeBtn"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/></svg>메일 쓰기</button>
        </div>
        <div class="mailbox-list" id="mailList"></div>
        <div class="mail-pager" id="mailPager" style="display:none"></div>
      </div>
      <div class="mailbox-detail-pane" id="mailDetailPane">
        <button class="mail-back-btn" id="mailBackBtn">‹ 목록</button>
        <div class="mail-detail-empty" id="mailDetailEmpty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg><p>왼쪽에서 메일을 선택하세요.</p></div>
        <div class="mail-detail" id="mailDetail" style="display:none"></div>
      </div>
    </div>
  </div>
  <div class="mail-modal-bg" id="mailModalBg"><div class="mail-modal" id="mailModal"></div></div>
  <div class="page" data-page="preset">
    <section class="panel"><h2 style="margin:0 0 14px">프리셋</h2><div id="presetRoot"></div></section>
  </div>
  <div class="page" data-page="event">
    <section class="event-dice-panel"><div id="eventDiceRoot"></div></section>
  </div>
  <div class="page" data-page="버닝">
    <section class="panel"><div id="burningRoot"></div></section>
  </div>
  <div class="page" data-page="자물쇠">
    <section class="lockbox-panel"><div id="lockboxRoot"></div></section>
  </div>
  <div class="page" data-page="캡슐">
    <section class="capsule-panel"><div id="capsuleRoot"></div></section>
  </div>
  <div class="page" data-page="combine">
    <section class="panel combine-board">
      <div class="fusion-head"><div><span class="fusion-eyebrow">CARD FUSION</span><h2>캐릭터 카드 조합</h2><p>같은 등급과 종류의 카드 3장을 선택해 상위 카드를 획득하세요.</p></div><span class="fusion-rule-badge">재료 3장</span></div>
      <div class="combine-wrap">
        <div class="fusion-stage-shell"><div class="combine-stage" id="combineStage"></div></div>
        <div class="combine-info" id="combineInfo"></div>
      </div>
    </section>
    <section class="panel fusion-inventory">
      <div class="fusion-pool-head"><div><h2>재료 카드 선택</h2><p>카드를 누르면 빈 슬롯에 바로 추가됩니다.</p></div><span id="combinePoolCount" class="fusion-pool-count"></span></div>
      <div class="fusion-tools"><label class="fusion-search"><span>검색</span><input id="combineSearch" type="search" placeholder="캐릭터 이름 검색" autocomplete="off"></label><label class="fusion-toggle"><input id="combineCompatibleOnly" type="checkbox"><span>선택 가능한 카드만</span></label><button id="combineClear" class="fusion-clear" type="button">선택 초기화</button></div>
      <div id="combinePool" class="card-grid fusion-card-grid"></div>
    </section>
  </div>
  <div class="page" data-page="jobcombine">
    <section class="panel jobcombine-board">
      <div class="fusion-head job"><div><span class="fusion-eyebrow">JOB AWAKENING</span><h2>전직 카드 조합</h2><p>같은 캐릭터와 같은 등급의 일반 카드 3장을 전직 카드로 변환하세요.</p></div><span class="fusion-rule-badge">성공률 100%</span></div>
      <div class="jobcombine-wrap">
        <div class="fusion-stage-shell job"><div class="jobcombine-stage" id="jobCombineStage"></div></div>
        <div class="jobcombine-info" id="jobCombineInfo"></div>
      </div>
    </section>
    <section class="panel fusion-inventory job">
      <div class="fusion-pool-head"><div><h2>전직 재료 선택</h2><p>첫 카드와 동일한 캐릭터·등급만 이어서 선택할 수 있습니다.</p></div><span id="jobCombinePoolCount" class="fusion-pool-count"></span></div>
      <div class="fusion-tools"><label class="fusion-search"><span>검색</span><input id="jobCombineSearch" type="search" placeholder="캐릭터 이름 검색" autocomplete="off"></label><label class="fusion-toggle"><input id="jobCombineCompatibleOnly" type="checkbox"><span>선택 가능한 카드만</span></label><button id="jobCombineClear" class="fusion-clear" type="button">선택 초기화</button></div>
      <div id="jobCombinePool" class="card-grid fusion-card-grid"></div>
    </section>
  </div>
  <div class="page" data-page="equipment-synthesis">
    <section class="panel equipment-synthesis-board">
      <div class="equipment-synthesis-head"><div><span>EQUIPMENT SYNTHESIS</span><h2>장비 합성</h2><p>합성 가능한 장비를 선택해 상위 장비로 진화시키세요.</p></div><b id="equipmentSynthesisRule">재료 선택</b></div>
      <div id="equipmentSynthesisStage" class="equipment-synthesis-stage"></div>
      <div id="equipmentSynthesisInfo" class="equipment-synthesis-info"></div>
    </section>
    <div id="equipmentSynthesisDock" class="equipment-synthesis-dock" aria-hidden="true"></div>
    <section class="panel equipment-synthesis-inventory">
      <div class="equipment-synthesis-pool-head"><div><h2>재료 장비 선택</h2><p>일반 합성은 동일한 +10 장비 3개, 초월 합성은 같은 이름의 장비 2개가 필요합니다.</p></div><span id="equipmentSynthesisCount"></span></div>
      <div class="equipment-synthesis-tools"><label><span>검색</span><input id="equipmentSynthesisSearch" type="search" placeholder="장비 이름 검색" autocomplete="off"></label><label class="equipment-synthesis-toggle"><input id="equipmentSynthesisCompatibleOnly" type="checkbox"><span>선택 가능한 장비만</span></label><button id="equipmentSynthesisClear" type="button">선택 초기화</button></div>
      <div id="equipmentSynthesisPool" class="equipment-synthesis-grid"></div>
    </section>
  </div>
  <div class="page" data-page="레벨보상">
    <section class="panel"><h2>레벨 달성 보상</h2><div id="levelRewardList" class="lvreward-list"></div></section>
  </div>
  <div class="page" data-page="auction"><section class="panel"><div class="auction-bar"><h2 style="margin:0">팝니다</h2><div class="actions"><input id="aucSearch" class="search-input" placeholder="검색..." autocomplete="off"><select id="aucSort" class="sort-select" aria-label="정렬"><option value="new">최신순</option><option value="priceAsc">가격 낮은순</option><option value="priceDesc">가격 높은순</option></select><div class="seg" id="aucFilter"><button data-filter="all" class="on">전체</button><button data-filter="card">카드</button><button data-filter="equipment">장비</button><button data-filter="pet">펫</button><button data-filter="item">아이템</button><button data-filter="mine">내 판매</button></div><div class="seg" id="aucCurrFilter"><button data-curr="all" class="on">전체</button><button data-curr="gold">골드</button><button data-curr="garnet">가넷</button></div><button class="primary" id="aucNew">+ 등록</button></div></div><div id="auctionList" class="auction-grid"></div><div id="aucPager" class="auc-pager" style="display:none"></div></section></div>
  <div class="page" data-page="ranking"><section class="panel rank-section"><div class="auction-bar"><h2 style="margin:0">랭킹</h2><div class="rank-tabs"><button class="rank-tab active" data-tab="cp">전투력 랭킹</button><button class="rank-tab" data-tab="exp">경험치 랭킹</button><button class="rank-tab" data-tab="worldBoss">월드보스 랭킹</button></div></div><div id="rankMe"></div><div id="rankList" class="rank-list"></div></section></div>
  <div class="page" data-page="dex"><section class="panel dex-shell">
    <aside class="dex-sidebar" aria-label="도감 종류">
      <h2>도감</h2>
      <div class="dex-tabs">
        <button class="dex-tab active" data-tab="weapon">무기</button><button class="dex-tab" data-tab="hat">모자</button><button class="dex-tab" data-tab="armor">갑옷</button><button class="dex-tab" data-tab="pants">하의</button><button class="dex-tab" data-tab="shoes">신발</button><button class="dex-tab" data-tab="accessory">장신구</button><button class="dex-tab" data-tab="support">보조</button><button class="dex-tab" data-tab="orb">보주</button><button class="dex-tab" data-tab="pet">펫</button><button class="dex-tab" data-tab="character"><span>캐릭터</span> <span>카드</span></button><button class="dex-tab" data-tab="title">칭호</button><button class="dex-tab" data-tab="potential">잠재능력</button>
      </div>
    </aside>
    <div class="dex-content"><div id="dexRarityFilterBar" class="dex-filter-bar" hidden><label class="dex-filter-label" for="dexRarityFilter">등급</label><select id="dexRarityFilter" class="dex-rarity-select" aria-label="도감 등급 필터"><option value="all">전체 등급</option></select><span id="dexRarityCount" class="dex-filter-count"></span></div><div id="dexList" class="dex-grid"></div></div>
  </section></div>
  <div class="page" data-page="shop"><section class="panel shop-wrap"><div id="shopBody"></div></section></div>
  <div class="page" data-page="buyorder"><section class="panel"><div class="auction-bar"><h2 style="margin:0">삽니다</h2><div class="actions"><input id="boSearch" class="search-input" placeholder="검색..." autocomplete="off"><select id="boSort" class="sort-select" aria-label="정렬"><option value="new">최신순</option><option value="priceAsc">가격 낮은순</option><option value="priceDesc">가격 높은순</option></select><div class="seg" id="boFilter"><button data-filter="all" class="on">전체</button><button data-filter="card">카드</button><button data-filter="equipment">장비</button><button data-filter="pet">펫</button><button data-filter="item">아이템</button><button data-filter="mine">내 구매</button></div><div class="seg" id="boCurrFilter"><button data-curr="all" class="on">전체</button><button data-curr="gold">골드</button><button data-curr="garnet">가넷</button></div><button class="primary" id="boNew">+ 구매 등록</button></div></div><div id="buyOrderList" class="auction-grid"></div><div id="boPager" class="auc-pager" style="display:none"></div></section></div>
  <div class="page" data-page="patchnotes"><section class="panel patch-wrap"><div class="auction-bar"><h2 style="margin:0">패치노트</h2><button class="primary" id="patchNew" style="display:none">+ 작성</button></div><div class="patch-editor" id="patchEditor"><input id="patchTitle" placeholder="제목"><input id="patchDate" placeholder="패치 일자 (비워두면 작성일시)" type="datetime-local"><textarea id="patchBody" placeholder="본문 (Markdown 지원)"></textarea><div class="actions"><button class="primary" id="patchSubmit">등록</button><button id="patchCancel">취소</button></div></div><div id="patchList" class="patch-list"></div></section></div>
</main>
<div id="modalBg" class="modal-bg"><div class="modal"><h3 id="modalTitle">-</h3><div class="sub" id="modalSub"></div><div id="modalBody"></div><button class="primary close" id="modalClose">닫기</button></div></div>
<div id="enhanceOverlay" class="enhance-overlay"><div class="enhance-wrap"><div id="enhanceContent"></div><div id="enhanceResultOverlay" class="enhance-result-overlay"></div></div></div>
<div id="potentialOverlay" class="enhance-overlay"><div class="enhance-wrap pot-wrap"><div id="potentialContent"></div><div id="potentialResultOverlay" class="enhance-result-overlay"></div></div></div>
<div id="lockboxOverlay" class="lockbox-overlay"><video id="lockboxVideo" src="/static/assets/%EC%9E%90%EB%AC%BC%EC%87%A0.mp4" playsinline muted></video><button id="lockboxSkip" class="lockbox-skip-btn">건너뛰기</button></div>
<div id="lockboxResultOverlay" class="lockbox-result-overlay"></div>
<div id="aucDetailBg" class="modal-bg"><div class="modal" id="aucDetail"></div></div>
<div id="aucRegBg" class="modal-bg"><div class="modal wide" id="aucReg"></div></div>
<div id="boDetailBg" class="modal-bg"><div class="modal" id="boDetail"></div></div>
<div id="boRegBg" class="modal-bg"><div class="modal wide" id="boReg"></div></div>
<div id="loadingOverlay" class="loading-overlay"><div class="loading-spinner"></div></div>
<nav class="bottom-tabs" id="bottomTabs"></nav>
<script>window.HAS_PARTY=${sess.canPartyQuest ? 'true' : 'false'};window.IS_ADMIN=${sess.admin ? 'true' : 'false'};</script>
<script src="/static/app.js"></script>
</body></html>`;
}

function renderHFieldApp(sess) {
    return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><title>부타게임 [H]</title>
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,user-scalable=no">
<link rel="stylesheet" href="/static/hfield.css"></head><body>
<main id="hFieldRoot" class="hf-root" aria-label="부타게임 하드 필드">
  <canvas id="hfCanvas" aria-label="부타게임 하드 필드 전투 화면"></canvas>
  <canvas id="hfHud"></canvas>
</main>
<script>window.HFIELD_ME=${JSON.stringify(sess.name)};</script>
<script src="/static/hfield.js"></script>
</body></html>`;
}

function renderPartyApp(sess) {
    return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><title>파티 퀘스트 · RPGenius</title>
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<link rel="stylesheet" href="/static/party.css"></head><body>
<div class="frame" id="frame">
  <div class="pq-header">
    <button class="pq-icon-btn" id="pqHome" title="홈으로">←</button>
    <h1 id="pqTitle">파티 퀘스트</h1>
    <span class="me">${escapeHtml(sess.name)}</span>
  </div>
  <div class="pq-body" id="pqBody">

    <section class="pq-screen active" data-screen="lobby">
      <div class="pq-bar">
        <div class="pq-section-title" style="margin:0">파티 퀘스트</div>
        <div class="pq-row" style="gap:6px">
          <button class="pq-btn pq-lobby-tool" id="pqKeybindOpen" type="button">⚙ 설정</button>
          <button class="pq-btn" id="pqRefresh" style="height:32px;padding:0 12px;font-size:12px">새로고침</button>
        </div>
      </div>
      <div id="pqRoomList" class="pq-screen" style="display:flex;gap:10px"></div>
    </section>

    <section class="pq-screen" data-screen="room">
      <div class="pq-room-toolbar">
        <button class="pq-back" id="pqLeave">← 파티 나가기</button>
        <button class="pq-btn pq-lobby-tool" id="pqRoomSettings" type="button">⚙ 설정</button>
      </div>
      <div class="pq-panel">
        <div class="pq-bar">
          <div class="pq-section-title" style="margin:0">퀘스트</div>
          <span id="pqRoomQuestName" style="font-weight:800;color:#a5b4fc"></span>
        </div>
        <div id="pqQuestInfo" class="pq-quest-info"></div>
      </div>
      <div class="pq-panel">
        <div class="pq-section-title" style="margin:0">파티원</div>
        <div id="pqMemberList" style="display:flex;flex-direction:column;gap:6px"></div>
      </div>
      <div class="pq-panel" id="pqPositionPanel">
        <div class="pq-section-title" style="margin:0">포지션 선택</div>
        <div id="pqPositionGrid" class="pq-position-grid"></div>
        <div id="pqPositionDetail" class="pq-stat-list" style="display:none"></div>
      </div>
      <div class="pq-panel">
        <div class="pq-section-title" style="margin:0">채팅</div>
        <div id="pqChat" class="pq-chat"></div>
        <form id="pqChatForm" class="pq-chat-form">
          <input id="pqChatInput" class="pq-input" placeholder="메시지..." autocomplete="off" maxlength="500">
          <button type="submit" class="pq-btn primary" style="height:38px">전송</button>
        </form>
      </div>
      <div class="pq-panel">
        <div class="pq-bar">
          <div class="pq-section-title" style="margin:0">휴대 물약</div>
          <button class="pq-btn" id="pqOpenPotion" type="button" style="height:32px;padding:0 12px;font-size:12px">선택</button>
        </div>
        <div id="pqPotionSummary" style="font-size:12px;color:#cbd5e1;line-height:1.5"></div>
      </div>
      <div class="pq-actions">
        <button class="pq-btn" id="pqReadyBtn">준비</button>
        <button class="pq-btn primary" id="pqStartBtn" style="display:none">퀘스트 시작</button>
      </div>
    </section>

    <section class="pq-screen" data-screen="play">
      <div class="pq-game-top">
        <button class="pq-game-leave" id="pqPlayLeave" type="button">← 나가기</button>
        <div class="pq-game-phase"><span id="pqPhaseLabel">PHASE</span><b id="pqPhaseName">-</b></div>
        <div class="pq-enrage" style="display:none" id="pqEnrage"></div>
        <button class="pq-game-leave" id="pqSettingsBtn" type="button">설정</button>
      </div>
      <div class="pq-game-stagewrap">
        <div id="pqPhaseStage" class="pq-game-stage"></div>
        <div class="pq-game-chat" id="pqGameChat">
          <div class="tabs">
            <button type="button" class="on" id="pqTabChat">채팅</button>
            <button type="button" id="pqTabLog">로그</button>
            <button type="button" id="pqChatCollapse">접기</button>
          </div>
          <div id="pqPlayChat" class="pq-chat"></div>
          <div id="pqCombatLog" class="pq-combat-log" style="display:none"></div>
          <form id="pqPlayChatForm" class="pq-chat-form">
            <input id="pqPlayChatInput" class="pq-input" placeholder="메시지..." autocomplete="off" maxlength="500">
            <button type="submit" class="pq-btn primary">전송</button>
          </form>
        </div>
        <div class="pq-my-vitals" id="pqMyVitals" style="display:none"></div>
        <div class="pq-member-detail" id="pqMemberDetail" style="display:none"></div>
      </div>
      <div id="pqPlayMembers" class="pq-game-party"></div>
      <div class="pq-game-actions" id="pqActionRow">
        <div class="pq-game-bars">
          <div id="pqSupportPanel" style="display:none">
            <div class="sup-head">
              <span>지원군</span>
              <div class="pq-prog gauge"><div id="pqSupportGaugeFill" class="fill" style="width:0%"></div></div>
              <span id="pqSupportGaugeVal">0%</span>
            </div>
            <div id="pqSupportSkills" class="pq-skill-strip"></div>
          </div>
          <div id="pqSkillBar" class="pq-skill-strip"></div>
          <div id="pqPotionBar" class="pq-skill-strip potion"></div>
          <div id="pqSealOverlay" class="pq-seal-overlay" style="display:none"></div>
        </div>
        <div class="pq-game-attack">
          <span id="pqAttackKey" class="pq-attack-key"></span>
          <button id="pqAttackBtn" class="pq-attack-btn" type="button" disabled>공격</button>
          <div id="pqAttackOrder" class="pq-attack-order"></div>
        </div>
      </div>
    </section>

  </div>

  <button class="pq-fab" id="pqCreateFab" style="display:none">＋ 파티 생성</button>

  <div class="pq-modal-bg" id="pqCreateBg">
    <div class="pq-modal pq-create-modal" role="dialog" aria-modal="true" aria-labelledby="pqCreateTitle">
      <div class="pq-create-head">
        <div>
          <span>PARTY MISSION</span>
          <h3 id="pqCreateTitle">새로운 원정대 생성</h3>
        </div>
        <button class="pq-create-close" id="pqCreateClose" type="button" aria-label="파티 생성 닫기">×</button>
      </div>
      <div class="pq-create-section-head">
        <span>퀘스트 선택</span>
        <b id="pqQuestPager">1 / 1</b>
      </div>
      <div class="pq-quest-picker">
        <button class="pq-quest-arrow prev" id="pqQuestPrev" type="button" aria-label="이전 퀘스트">&#8249;</button>
        <div class="pq-quest-card" id="pqQuestCard">
          <div class="pq-quest-card-img" id="pqQuestCardImg"></div>
          <div class="pq-quest-card-body">
            <div class="pq-quest-difficulty" id="pqQuestDifficulty">NORMAL</div>
            <div class="pq-quest-card-name" id="pqQuestCardName">-</div>
            <div class="pq-quest-card-meta" id="pqQuestCardMeta"></div>
          </div>
        </div>
        <button class="pq-quest-arrow next" id="pqQuestNext" type="button" aria-label="다음 퀘스트">&#8250;</button>
      </div>
      <div class="pq-create-private">
        <label for="pqCreatePw"><span>파티 비밀번호</span><b>선택</b></label>
        <input id="pqCreatePw" class="pq-input" type="text" placeholder="비워두면 누구나 참가할 수 있습니다" autocomplete="off">
      </div>
      <div class="pq-actions pq-create-actions">
        <button class="pq-btn" id="pqCreateCancel" type="button">취소</button>
        <button class="pq-btn primary" id="pqCreateConfirm" type="button">원정대 생성</button>
      </div>
    </div>
  </div>

  <div class="pq-modal-bg" id="pqJoinBg">
    <div class="pq-modal">
      <h3 id="pqJoinTitle">파티 입장</h3>
      <div id="pqJoinSub" style="font-size:12px;color:#94a3b8"></div>
      <input id="pqJoinPw" class="pq-input" type="text" placeholder="비밀번호">
      <div class="pq-actions">
        <button class="pq-btn" id="pqJoinCancel" type="button">취소</button>
        <button class="pq-btn primary" id="pqJoinConfirm" type="button">입장</button>
      </div>
    </div>
  </div>

  <div class="pq-modal-bg" id="pqChoiceBg">
    <div class="pq-modal">
      <h3>스킬 선택</h3>
      <div style="font-size:12px;color:#94a3b8">페이즈 보상으로 1개를 습득합니다.</div>
      <div id="pqChoiceList" class="pq-choice-grid"></div>
    </div>
  </div>

  <div class="pq-modal-bg" id="pqVoteBg">
    <div class="pq-modal">
      <h3 id="pqVoteTitle">투표</h3>
      <div class="pq-vote-timer" id="pqVoteTimer"></div>
      <div id="pqVoteList" class="pq-target-list"></div>
      <div style="font-size:12px;color:#94a3b8;display:none" id="pqVoteDone">투표 완료 — 결과를 기다리는 중...</div>
    </div>
  </div>

  <div class="pq-modal-bg" id="pqPotionBg">
    <div class="pq-modal" style="max-width:420px">
      <h3>물약 휴대 설정</h3>
      <div style="font-size:12px;color:#94a3b8" id="pqPotionLimitInfo">최대 0개</div>
      <div id="pqPotionListEditor" style="display:flex;flex-direction:column;gap:6px;max-height:340px;overflow-y:auto"></div>
      <div class="pq-actions">
        <button class="pq-btn" id="pqPotionCancel" type="button">취소</button>
        <button class="pq-btn primary" id="pqPotionSave" type="button">저장</button>
      </div>
    </div>
  </div>

  <div class="pq-modal-bg" id="pqKeybindBg">
    <div class="pq-modal">
      <h3>설정</h3>
      <div class="pq-section-title" style="margin:0">사운드</div>
      <div class="pq-sound-row"><span>배경음악</span><input type="range" id="pqVolBgm" min="0" max="100" step="1"><b id="pqVolBgmVal">18%</b></div>
      <div class="pq-sound-row"><span>효과음</span><input type="range" id="pqVolSfx" min="0" max="100" step="1"><b id="pqVolSfxVal">50%</b></div>
      <div class="pq-section-title" style="margin:6px 0 0">단축키</div>
      <div style="font-size:12px;color:#94a3b8">항목을 클릭한 뒤 원하는 키를 누르세요. Backspace로 해제, Esc로 취소.</div>
      <div id="pqKeybindList" class="pq-keybind-list"></div>
      <div class="pq-actions">
        <button class="pq-btn" id="pqKeybindReset" type="button">키 기본값</button>
        <button class="pq-btn primary" id="pqKeybindClose" type="button">닫기</button>
      </div>
    </div>
  </div>

  <div class="pq-modal-bg" id="pqTargetBg">
    <div class="pq-modal">
      <h3 id="pqTargetTitle">대상 선택</h3>
      <div id="pqTargetList" class="pq-target-list"></div>
      <div class="pq-actions"><button class="pq-btn" id="pqTargetCancel" type="button">취소</button></div>
    </div>
  </div>

  <div class="pq-modal-bg" id="pqRewardBg">
    <div class="pq-modal" style="max-width:460px">
      <h3>파티 보상</h3>
      <div style="font-size:12px;color:#94a3b8">파티원별 획득 아이템</div>
      <div id="pqRewardList" class="pq-reward-list"></div>
      <div class="pq-actions"><button class="pq-btn primary" id="pqRewardClose" type="button">확인</button></div>
    </div>
  </div>

  <div class="pq-modal-bg" id="pqFirstClearBg">
    <div class="pq-modal pq-fc-modal">
      <div class="pq-fc-badge">최초 클리어</div>
      <h3 class="pq-fc-title" id="pqFirstClearTitle">최초 클리어!</h3>
      <div class="pq-fc-sub">개인 최초 클리어 특별 보상을 획득했습니다.</div>
      <div id="pqFirstClearList" class="pq-fc-list"></div>
      <div class="pq-actions"><button class="pq-btn primary" id="pqFirstClearClose" type="button">확인</button></div>
    </div>
  </div>

  <div class="pq-notice-stack" id="pqNoticeStack"></div>
  <div class="pq-toast" id="pqToast"></div>
  <div class="pq-intro" id="pqIntro">
    <div class="pq-intro-quest" id="pqIntroQuest"></div>
    <div class="pq-intro-count" id="pqIntroCount"></div>
  </div>
</div>
<script>window.PARTY_ME = ${JSON.stringify(sess.name)};</script>
<script src="/static/party.js"></script>
</body></html>`;
}

function renderAdminDashboard(sess) {
    const html = fs.readFileSync(ADMIN_HTML_PATH, 'utf8');
    return html
        .replace(/{{ADMIN_NAME}}/g, escapeHtml(sess.name))
        .replace(/{{DATA_KEYS}}/g, JSON.stringify(rpgenius.RPGENIUS_DATA_KEYS));
}

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function keepAlive() {
    const port = Number(process.env.PORT || 3000);
    server.listen(port, () => console.log('서버 준비 완료! http://localhost:' + port));
}

if (require.main === module) keepAlive();

keepAlive.setKakaoClient = setKakaoClient;

module.exports = keepAlive;
