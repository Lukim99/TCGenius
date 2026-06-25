const express = require('express');
const crypto = require('crypto');
const path = require('path');
const rpgenius = require('./rpgenius.js');
const partyquest = require('./partyquest.js');
const { DynamoDBClient, DescribeTableCommand, DescribeContinuousBackupsCommand, RestoreTableToPointInTimeCommand, DeleteTableCommand } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand, BatchWriteCommand } = require('@aws-sdk/lib-dynamodb');
const { createClient } = require('@supabase/supabase-js');

const supabaseP = (process.env.SUPABASE_URL_P && process.env.SUPABASE_KEY_P)
    ? createClient(process.env.SUPABASE_URL_P, process.env.SUPABASE_KEY_P)
    : null;

const SESSION_SECRET = process.env.ADMIN_SESSION_SECRET || 'rpgenius-default-secret-change-me';
const SESSION_COOKIE = 'rpg_admin';
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

const fs = require('fs');

const server = express();
server.use(express.json({ limit: '5mb' }));
server.use('/static', express.static(path.join(__dirname, 'public')));

const AUCTION_NOTIFY_CHANNEL_ID = '18470462260425659';
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
    const ua = String(req.headers['user-agent'] || '').trim();
    if (!name) return res.status(400).json({ error: '닉네임을 입력해주세요.' });
    try {
        const user = await rpgenius.getRPGUserByName(name);
        if (!user) return res.status(401).json({ error: '존재하지 않는 닉네임입니다.' });
        const knownAgent = ua && Array.isArray(user.logged_in_agent) && user.logged_in_agent.includes(ua);
        if (!code) {
            if (knownAgent) {
                setSession(res, { name: user.name, admin: !!user.isAdmin, canPartyQuest: !!user.canPartyQuest, exp: Date.now() + SESSION_TTL_MS });
                return res.json({ ok: true, name: user.name });
            }
            return res.json({ needCode: true });
        }
        if (user.code !== code) return res.status(401).json({ error: '코드가 올바르지 않습니다.' });
        if (typeof user.changeCode == 'function') await user.changeCode();
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

server.post('/api/logout', (req, res) => {
    clearSession(res);
    res.json({ ok: true });
});

server.get('/api/me', requireUser, (req, res) => {
    res.json({ name: req.session.name, admin: !!req.session.admin });
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

// ===== 메일함 =====
// 선물 표시객체에 아이콘 URL을 채운다(rpgenius 모듈엔 이미지 헬퍼가 없어 서버에서 후처리)
function attachMailGiftIcons(g) {
    if (!g || !g.type) return g;
    if (g.type === 'gold') g.iconUrl = getItemImageUrl('화폐', '골드.png');
    else if (g.type === 'garnet') g.iconUrl = getItemImageUrl('화폐', '가넷.png');
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
            gold: Number(user.gold || 0), garnet: Number(user.garnet || 0),
            goldIconUrl: getItemImageUrl('화폐', '골드.png'), garnetIconUrl: getItemImageUrl('화폐', '가넷.png'),
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

// ===== 펀치기계 =====
const PUNCH_TOKEN_ITEM_NAME = '펀치기계 토큰';
const PUNCH_RANK_LIMIT = 5;
const PUNCH_MIN_SCORE = 3000, PUNCH_MAX_SCORE = 9999;

function getPunchRank() {
    const r = rpgenius.getDataCache('PunchRank', []);
    return Array.isArray(r) ? r.filter(e => e && e.name && Number.isFinite(Number(e.score))) : [];
}
// 닉네임당 최고점 1개만 유지하여 상위 5명을 정렬해 반환.
function buildPunchRank(rank, name, score) {
    const best = new Map();
    for (const e of rank) {
        const prev = best.get(e.name);
        if (!prev || Number(e.score) > prev.score) best.set(e.name, { name: e.name, score: Number(e.score), time: Number(e.time) || 0 });
    }
    const mine = best.get(name);
    if (!mine || score > mine.score) best.set(name, { name, score, time: Date.now() });
    return Array.from(best.values()).sort((a, b) => b.score - a.score || a.time - b.time).slice(0, PUNCH_RANK_LIMIT);
}

server.get('/api/punch', requireUser, async (req, res) => {
    try {
        const user = await rpgenius.getRPGUserByName(req.session.name);
        if (!user) return res.status(404).json({ error: '유저를 찾을 수 없습니다.' });
        const tokenId = findItemIdByName(PUNCH_TOKEN_ITEM_NAME);
        const tokenCount = tokenId >= 0 ? rpgenius.getInventoryItemCount(user, tokenId) : 0;
        res.json({ ok: true, tokenItemName: PUNCH_TOKEN_ITEM_NAME, tokenCount, rank: getPunchRank().slice(0, PUNCH_RANK_LIMIT) });
    } catch (e) {
        console.error('punch status error:', e);
        res.status(500).json({ error: '서버 오류' });
    }
});

// 토큰 1개를 소비하고 1회용 토큰(nonce)을 발급. 이 nonce가 있어야 점수를 기록할 수 있다.
server.post('/api/punch/play', requireUser, async (req, res) => {
    try {
        const user = await rpgenius.getRPGUserByName(req.session.name);
        if (!user) return res.status(404).json({ error: '유저를 찾을 수 없습니다.' });
        const tokenId = findItemIdByName(PUNCH_TOKEN_ITEM_NAME);
        if (tokenId < 0) return res.status(500).json({ error: PUNCH_TOKEN_ITEM_NAME + ' 아이템 데이터가 없습니다.' });
        if (rpgenius.getInventoryItemCount(user, tokenId) < 1) return res.status(400).json({ error: PUNCH_TOKEN_ITEM_NAME + '이(가) 없습니다.' });
        rpgenius.removeInventoryItem(user, tokenId, 1);
        rpgenius.cleanupInventoryItems(user);
        const nonce = Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
        user.punchToken = nonce;
        await user.save();
        res.json({ ok: true, token: nonce, tokenCount: rpgenius.getInventoryItemCount(user, tokenId) });
    } catch (e) {
        console.error('punch play error:', e);
        res.status(500).json({ error: '서버 오류' });
    }
});

// 발급받은 nonce로 점수를 기록(닉네임당 최고점, 상위 5명).
server.post('/api/punch/score', requireUser, async (req, res) => {
    try {
        const user = await rpgenius.getRPGUserByName(req.session.name);
        if (!user) return res.status(404).json({ error: '유저를 찾을 수 없습니다.' });
        const token = req.body && req.body.token;
        if (!token || user.punchToken !== token) return res.status(400).json({ error: '유효하지 않은 플레이입니다.' });
        const score = Math.round(Number(req.body && req.body.score));
        if (!Number.isFinite(score) || score < PUNCH_MIN_SCORE || score > PUNCH_MAX_SCORE) return res.status(400).json({ error: '잘못된 점수입니다.' });
        user.punchToken = null;
        await user.save();
        const rank = buildPunchRank(getPunchRank(), user.name, score);
        await rpgenius.saveRpgeniusDataEntry('PunchRank', rank);
        const position = rank.findIndex(e => e.name === user.name && e.score === score);
        res.json({ ok: true, rank, ranked: position >= 0, position: position >= 0 ? position + 1 : null });
    } catch (e) {
        console.error('punch score error:', e);
        res.status(500).json({ error: '서버 오류' });
    }
});

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
        const selection = rpgenius.getCardCombineSelection(user, numbers);
        if (selection.error) return res.status(400).json({ error: selection.error.replace(/^❌\s*/, '') });
        const pending = { type: '카드조합', numbers: selection.numbers };
        if (Number.isInteger(protectIndex) && protectIndex >= 0 && protectIndex < 3) {
            if (rpgenius.getProtectItemIdForCardStar(user, selection.star) == -1) return res.status(400).json({ error: '사용할 수 있는 보호 카드가 없습니다.' });
            pending.protectIndex = protectIndex;
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

function getEquipmentActionBlockedReason(user, action) {
    const verb = action || '변경';
    if (user && user.field && user.field.name) {
        return user.field.worldBoss ? '월드보스 전투 중에는 장비를 ' + verb + '할 수 없습니다.' : '사냥 중에는 장비를 ' + verb + '할 수 없습니다.';
    }
    const room = partyquest.getMyRoomSnapshot(user && user.name);
    if (room && room.state == 'inProgress') return '파티퀘스트 진행 중에는 장비를 ' + verb + '할 수 없습니다.';
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
    const stoneCount = rpgenius.getInventoryItemCount(user, rpgenius.EQUIPMENT_STONE_ITEM_ID);
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
        finalDamage: '최종 피해', bossDmg: '보스 추가 피해'
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
        { id: 4,   count: 1,     goods: 'garnet', amounts: [850,1000,1150], weight: 20 },
        { id: 5,   count: 1,     goods: 'gold',   amount: 100000000,weight: 0.5 },
        { id: 5,   count: 1,     goods: 'garnet', amount: 3500,     weight: 2   },
        { id: 0,   count: 5000,  goods: 'gold',   amount: 300000,   weight: 2   },
        { id: 0,   count: 5000,  goods: 'garnet', amount: 60,      weight: 19  },
        { id: 0,   count: 10000, goods: 'gold',   amount: 600000,   weight: 2   },
        { id: 0,   count: 10000, goods: 'garnet', amount: 120,      weight: 19  },
    ]},
    { name: '쥬얼 섹터', items: [
        { id: 124, count: 5,  goods: 'garnet', amount: 30,  weight: 24  },
        { id: 124, count: 10, goods: 'garnet', amount: 58,  weight: 15  },
        { id: 124, count: 20, goods: 'garnet', amount: 110, weight: 10  },
        { id: 124, count: 30, goods: 'garnet', amount: 160, weight: 5   },
        { id: 124, count: 50, goods: 'garnet', amount: 260, weight: 3   },
        { id: 133, count: 3,  goods: 'gold',   amount: 200000, weight: 1.5 },
        { id: 133, count: 5,  goods: 'garnet', amount: 50,  weight: 24  },
        { id: 133, count: 10, goods: 'garnet', amount: 90, weight: 10  },
        { id: 133, count: 20, goods: 'garnet', amount: 175, weight: 5   },
        { id: 133, count: 30, goods: 'garnet', amount: 260, weight: 2.5 },
    ]},
    { name: '보호 카드 섹터', items: [
        { id: 107, count: 1, goods: 'gold',   amount: 100000,  weight: 0.3    },
        { id: 107, count: 1, goods: 'gold',   amount: 300000,  weight: 3      },
        { id: 107, count: 1, goods: 'garnet', amount: 60,      weight: 10     },
        { id: 107, count: 1, goods: 'garnet', amount: 100,     weight: 40     },
        { id: 108, count: 1, goods: 'gold',   amount: 250000,  weight: 0.1    },
        { id: 108, count: 1, goods: 'gold',   amount: 450000,  weight: 2      },
        { id: 108, count: 1, goods: 'garnet', amount: 125,     weight: 5      },
        { id: 108, count: 1, goods: 'garnet', amount: 180,     weight: 20     },
        { id: 109, count: 1, goods: 'gold',   amount: 1000000, weight: 0.076  },
        { id: 109, count: 1, goods: 'gold',   amount: 1500000, weight: 0.5    },
        { id: 109, count: 1, goods: 'garnet', amount: 360,     weight: 2      },
        { id: 109, count: 1, goods: 'garnet', amount: 480,     weight: 12     },
        { id: 110, count: 1, goods: 'gold',   amount: 10000000,weight: 0.001  },
        { id: 110, count: 1, goods: 'gold',   amount: 20000000,weight: 0.02   },
        { id: 110, count: 1, goods: 'garnet', amount: 860,     weight: 0.8    },
        { id: 110, count: 1, goods: 'garnet', amount: 1020,    weight: 3      },
        { id: 111, count: 1, goods: 'gold',   amount: 55000000,weight: 0.0005 },
        { id: 111, count: 1, goods: 'gold',   amount: 75000000,weight: 0.0025 },
        { id: 111, count: 1, goods: 'garnet', amount: 1800,    weight: 0.2    },
        { id: 111, count: 1, goods: 'garnet', amount: 2200,    weight: 1      },
    ]},
    { name: '카드팩 섹터', items: [
        { id: 21, count: 1, goods: 'gold',   amount: 200000,  weight: 6    },
        { id: 21, count: 1, goods: 'garnet', amount: 80,     weight: 10   },
        { id: 21, count: 1, goods: 'garnet', amount: 140,     weight: 30   },
        { id: 22, count: 1, goods: 'gold',   amount: 500000,  weight: 2    },
        { id: 22, count: 1, goods: 'garnet', amount: 180,     weight: 10   },
        { id: 22, count: 1, goods: 'garnet', amount: 220,     weight: 30   },
        { id: 23, count: 1, goods: 'gold',   amount: 2200000, weight: 1    },
        { id: 23, count: 1, goods: 'garnet', amount: 400,     weight: 2    },
        { id: 23, count: 1, goods: 'garnet', amount: 550,     weight: 8    },
        { id: 24, count: 1, goods: 'gold',   amount: 6000000, weight: 0.05 },
        { id: 24, count: 1, goods: 'garnet', amount: 800,     weight: 0.35 },
        { id: 24, count: 1, goods: 'garnet', amount: 1100,    weight: 0.5  },
        { id: 25, count: 1, goods: 'gold',   amount: 30000000,weight: 0.02 },
        { id: 25, count: 1, goods: 'garnet', amount: 2600,    weight: 0.08 },
    ]},
    { name: '캐시템 섹터', items: [
        { id: 144, count: 20, goods: 'gold',   amount: 100000,  weight: 30   },
        { id: 144, count: 20, goods: 'garnet', amount: 10,      weight: 30   },
        { id: 144, count: 100, goods: 'gold',   amount: 450000,  weight: 10   },
        { id: 144, count: 100, goods: 'garnet', amount: 45,      weight: 10   },
        { id: 84,  count: 20, goods: 'gold',   amount: 100000,  weight: 30   },
        { id: 84,  count: 20, goods: 'garnet', amount: 10,      weight: 30   },
        { id: 84,  count: 100, goods: 'gold',   amount: 450000,  weight: 10   },
        { id: 84,  count: 100, goods: 'garnet', amount: 45,      weight: 10   },
        { id: 17,  count: 10, goods: 'gold',   amount: 1500000, weight: 1.5  },
        { id: 17,  count: 10, goods: 'garnet', amount: 90,      weight: 10   },
        { id: 17,  count: 50, goods: 'gold',   amount: 7000000, weight: 0.25 },
        { id: 17,  count: 50, goods: 'garnet', amount: 540,     weight: 4    },
        { id: 112, count: 10, goods: 'gold',   amount: 5500000, weight: 0.25 },
        { id: 112, count: 10, goods: 'garnet', amount: 750,     weight: 4    },
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

// 섹터의 선택 가능한 모든 항목을 amounts 배열까지 펼쳐서 반환 (편집 드롭다운용)
function hotdealSectorOptions(sectorIdx) {
    const sector = HOTDEAL_SECTORS[sectorIdx];
    if (!sector) return [];
    const out = [];
    sector.items.forEach(item => {
        const amounts = item.amounts ? item.amounts : [item.amount];
        amounts.forEach(amount => out.push({ id: item.id, count: item.count, goods: item.goods, amount }));
    });
    return out;
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
        return { sectorName: sector.name, picks: override.picks.map(p => ({ ...p })), edited: true };
    }
    const rng = hotdealRng(hotdealPeriodSeed(periodKey));
    const firstIdx = sector.items.indexOf(hotdealWeightedPick(sector.items, rng));
    const pool2 = sector.items.filter((_, i) => i !== firstIdx);
    const second = hotdealWeightedPick(pool2, rng);
    const picks = [sector.items[firstIdx], second].map(item => ({
        ...item,
        amount: item.amounts ? item.amounts[Math.floor(rng() * item.amounts.length)] : item.amount,
    }));
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
        res.json({ items: list.map(entry => serializeAuctionEntry(entry, me)) });
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

server.get('/rpg-ui', requireUser, (req, res) => {
    const file = String(req.query.file || '');
    if (!file || file.includes('..') || path.basename(file) != file) return res.status(400).end();
    const filePath = path.join(RPG_UI_PATH, file);
    if (!filePath.startsWith(RPG_UI_PATH) || !fs.existsSync(filePath)) return res.status(404).end();
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
    if (!Number.isInteger(amount) || amount == 0) return res.status(400).json({ error: '수량은 0이 아닌 정수여야 합니다.' });

    try {
        const user = await rpgenius.getRPGUserByName(name);
        if (!user) return res.status(404).json({ error: '존재하지 않는 유저입니다.' });

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
    res.json({ weapon: pack(eq.weapon), armor: pack(eq.armor), accessory: pack(eq.accessory), support: pack(eq.support) });
});

server.get('/api/lookup/equipment-passives', requireAdmin, (req, res) => {
    const passives = rpgenius.getEquipmentPassives();
    res.json(passives.map((p, i) => ({ id: i, name: p ? p.name : '?' })));
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
    return getItemImageUrl(String(item.type), String(item.name) + '.png');
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

function buildInventoryItems(user) {
    const items = rpgenius.getDataCache('Item', []);
    return (user.inventory && Array.isArray(user.inventory.item) ? user.inventory.item : [])
        .map(inv => {
            const data = items[inv.id];
            if (!data) return null;
            const assets = getItemDisplayAssets(data);
            return { id: Number(inv.id), name: data.name, type: data.type, desc: data.desc || '', count: Number(inv.count || 0), noTrade: data.no_trade === true, iconUrl: assets.iconUrl, frameUrl: assets.frameUrl };
        })
        .filter(item => item && item.count > 0);
}

function buildInventoryCards(user) {
    return (user.inventory && Array.isArray(user.inventory.card) ? user.inventory.card : [])
        .map(card => serializeCard(card, user))
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
    return { table, protect, gold: Number(user.gold || 0) };
}

function getEquipmentData(type, id) {
    const equipments = rpgenius.getDataCache('Equipment', {});
    const list = equipments[type] || [];
    return list[id];
}

function buildInventoryEquipment(user) {
    const result = [];
    const labels = { weapon: '무기', armor: '갑옷', accessory: '장신구', support: '보조' };
    let number = 1;
    const add = (equip, type, equipped, meta) => {
        const data = equip && getEquipmentData(equip.type || type, equip.id);
        const itemNumber = number++;
        if (!data) return;
        const level = Number(equip.level || 0);
        const statText = rpgenius.formatCurrentEquipmentStatLines(data, level, equip && equip.rolled, { soul: equip && equip.soul });
        const statLines = String(statText || '').split('\n').filter(line => line && line.trim());
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
            rarity: data.rarity,
            level,
            equipped: !!equipped,
            statLines,
            potentialLines,
            potentialDisplay,
            potential: equip && equip.potential || null,
            canPotential: rpgenius.equipmentTypeSupportsPotential(equip.type || type),
            rolled: equip && equip.rolled || null,
            soul: soulActive ? { name: soulActive.name || '', expiredAt: Number(soulActive.expired_at || 0), stat: soulActive.stat || {}, plusStat: soulActive.plusStat || {} } : null,
            requireMainCard: Array.isArray(data.requireMainCard) ? data.requireMainCard.slice() : null,
            noTrade: data.no_trade === true,
            iconUrl: getEquipmentIconUrl(data),
            frameUrl: getAuctionFrameUrl('equipment', data.rarity)
        });
    };
    (user.inventory && Array.isArray(user.inventory.equipment) ? user.inventory.equipment : []).forEach((equip, index) => add(equip, equip.type, false, { source: 'inventory', index }));
    if (user.equipments && user.equipments.weapon && typeof user.equipments.weapon.id != 'undefined') add(user.equipments.weapon, 'weapon', true, { source: 'equipped' });
    if (user.equipments && user.equipments.armor && typeof user.equipments.armor.id != 'undefined') add(user.equipments.armor, 'armor', true, { source: 'equipped' });
    const accessories = user.equipments && user.equipments.accessory || {};
    Object.keys(accessories).forEach(key => {
        if (accessories[key] && typeof accessories[key].id != 'undefined') add(accessories[key], 'accessory', true, { source: 'equipped', slotKey: key });
    });
    if (user.equipments && user.equipments.support && typeof user.equipments.support.id != 'undefined') add(user.equipments.support, 'support', true, { source: 'equipped' });
    return result;
}

const RARITY_ORDER = ['일반', '고급', '레어', '희귀', '유니크', '영웅', '레전더리', '전설', '신화', '고유'];

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

function buildEquipmentDexEntry(type, typeLabel, id, data, recipeIndex) {
    if (!data) return null;
    const upgrades = Array.isArray(data.upgrade) ? data.upgrade : [];
    const baseLines = String(rpgenius.formatEquipmentBaseStatLines(data, 0) || '').split('\n').filter(line => line && line.trim()).map(line => line.replace(/^-\s*/, ''));
    const upgradeLines = upgrades.map((_, i) => {
        const lvl = i + 1;
        const lines = String(rpgenius.formatEquipmentBaseStatLines(data, lvl) || '').split('\n').filter(line => line && line.trim()).map(line => line.replace(/^-\s*/, ''));
        return { level: lvl, statLines: lines };
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
        baseStatLines: baseLines,
        upgrades: upgradeLines,
        maxUpgradeLevel: upgrades.length,
        evolution,
        recipe,
        passive
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
    return {
        weapon: pack(eq.weapon, 'weapon', '무기'),
        armor: pack(eq.armor, 'armor', '갑옷'),
        accessory: pack(eq.accessory, 'accessory', '장신구'),
        support: pack(eq.support, 'support', '보조'),
        pet: buildPetDex(),
        character: buildCharacterDex(),
        rarityOrder: RARITY_ORDER
    };
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
        return null;
    }).filter(Boolean);
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

const SHOP_TAB_ORDER = ['일반', '가넷', '포인트', '마일리지', '패키지', '출석'];
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
    const result = await rpgenius.purchaseShopItem(user, shopType, index + 1, count);
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
        const slotKey = slot == '무기' ? 'weapon' : slot == '갑옷' ? 'armor' : slot == '장신구' ? 'accessory' : slot == '보조' ? 'support' : ['weapon', 'armor', 'accessory', 'support'].includes(slot) ? slot : null;
        const data = slotKey ? (equipments[slotKey] || [])[id] : null;
        return {
            kindLabel: { weapon: '무기', armor: '갑옷', accessory: '장신구', support: '보조' }[slotKey] || slot || '장비',
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
            sub: data ? (data.rarity + ' · ' + ({ weapon: '무기', armor: '갑옷', accessory: '장신구', support: '보조' }[entry.payload.type] || entry.payload.type)) : '',
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

function serializeAuctionEntry(entry, currentUserName) {
    const desc = describeAuctionPayload(entry);
    let imageUrl = null;
    let frameUrl = null;
    let iconUrl = null;
    let statLines = null;
    let potentialDisplay = null;
    let soul = null;
    if (entry.kind == 'card') {
        imageUrl = getCardImageUrl(entry.payload || {}, { prestige: false });
    } else if (entry.kind == 'equipment') {
        const data = getEquipmentData(entry.payload && entry.payload.type, entry.payload && entry.payload.id);
        frameUrl = getAuctionFrameUrl('equipment', data && data.rarity);
        iconUrl = getEquipmentIconUrl(data);
        if (data) {
            const text = rpgenius.formatCurrentEquipmentStatLines(data, Number(entry.payload && entry.payload.level || 0), entry.payload && entry.payload.rolled, { soul: entry.payload && entry.payload.soul });
            statLines = String(text || '').split('\n').filter(line => line && line.trim()).map(line => line.replace(/^-\s*/, ''));
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
    } else if (entry.kind == 'item') {
        const item = rpgenius.getDataCache('Item', [])[entry.payload && entry.payload.id];
        const assets = getItemDisplayAssets(item);
        frameUrl = assets.frameUrl;
        iconUrl = assets.iconUrl;
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
            soul
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
            const potentialDisplay = eq.potential ? {
                tierKey: rpgenius.getPotentialRarityKey(eq.potential.rarity),
                tierLabel: rpgenius.getPotentialRarityLabel(eq.potential.rarity),
                entries: rpgenius.formatPotentialOptionEntries(eq.potential)
            } : null;
            const soulActive = eq.soul && !rpgenius.isSoulExpired(eq.soul) ? eq.soul : null;
            return {
                index,
                type: eq.type,
                typeLabel: { weapon: '무기', armor: '갑옷', accessory: '장신구', support: '보조' }[eq.type] || eq.type,
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
        const typeLabel = { weapon: '무기', armor: '갑옷', accessory: '장신구', support: '보조' }[entry.payload && entry.payload.type] || (entry.payload && entry.payload.type) || '';
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
        if (!['weapon', 'armor', 'accessory', 'support'].includes(equipType)) return { error: '장비 종류가 올바르지 않습니다.' };
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
        armor: pack(equipments.armor, 'armor'),
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
            if (eq.potential) rpgenius.formatPotentialLines(eq.potential).forEach(line => statLines.push(line.replace(/^-\s*/, '')));
            result.equipment.push({
                index,
                type: eq.type,
                typeLabel: { weapon: '무기', armor: '갑옷', accessory: '장신구', support: '보조' }[eq.type] || eq.type,
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
    { title: '피해', keys: ['afterBasic', 'afterSkill', 'damageBonus', 'eliteDmg', 'bossDmg', 'finalDamage', 'skillTrueDmg'] },
    { title: '속성', keys: ['fireAtk', 'waterAtk', 'lightAtk', 'darkAtk', 'fireRes', 'waterRes', 'lightRes', 'darkRes'] },
    { title: '생존 · 유틸', keys: ['avd', 'takenDamage', 'recoveryEfficiency', 'potion', 'mpReduce', 'skillCooldown', 'cooldown', 'summonDuration'] },
    { title: '획득', keys: ['gold', 'plusGold', 'exp', 'itemDropChance'] },
];
const PROFILE_STAT_LABELS = {
    atk: '공격력', def: '방어력', hp: '최대 체력', mp: '최대 MP', pnt: '방어 관통력', pntPercent: '방어력 관통',
    crit: '치명타 확률', critMul: '치명타 피해량', critDef: '치명타 피해 감소율',
    cmb: '연격 확률', maxCmb: '추가 공격 횟수',
    afterBasic: '일반 공격 피해', afterSkill: '스킬 공격 피해', damageBonus: '일반 몬스터 추가 피해',
    eliteDmg: '엘리트 추가 피해', bossDmg: '보스 추가 피해', finalDamage: '최종 피해',
    fireAtk: '[화]속성 강화', waterAtk: '[수]속성 강화', lightAtk: '[명]속성 강화', darkAtk: '[암]속성 강화',
    fireRes: '[화]속성 저항', waterRes: '[수]속성 저항', lightRes: '[명]속성 저항', darkRes: '[암]속성 저항',
    '000': '10/100/1000 추가 피해 확률', skillTrueDmg: '스킬 추가 고정 피해',
    avd: '회피 확률', takenDamage: '받는 피해 증가', recoveryEfficiency: '회복 효율', potion: '물약 효율',
    mpReduce: 'MP 소모량', skillCooldown: '스킬 쿨타임', cooldown: '쿨타임 감소', summonDuration: '소환 지속시간',
    gold: '골드 획득량', plusGold: '처치 당 골드', exp: '경험치 획득량', itemDropChance: '아이템 획득 확률',
};
// 수치 + % 곱연산으로 합산되는 스탯 (수치/% 따로 표시)
const PROFILE_STAT_MULT = new Set(['atk', 'def', 'hp', 'mp']);
const PROFILE_STAT_NUMERIC = new Set(['atk', 'def', 'hp', 'mp', 'pnt', 'maxCmb', 'plusGold', 'skillTrueDmg', 'fireAtk', 'waterAtk', 'lightAtk', 'darkAtk', 'fireRes', 'waterRes', 'lightRes', 'darkRes']);
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
:root{color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;min-height:100svh;display:grid;place-items:center;background:#06070d;background-image:radial-gradient(ellipse 80% 50% at 50% -5%,rgba(99,102,241,.22),transparent),radial-gradient(ellipse 60% 40% at 92% 96%,rgba(139,92,246,.1),transparent);color:#e5e7eb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
.card{position:relative;background:rgba(10,12,22,.95);border:1px solid rgba(99,102,241,.2);border-radius:22px;padding:34px 30px;width:min(380px,92vw);box-shadow:0 0 0 1px rgba(255,255,255,.03) inset,0 24px 64px rgba(0,0,0,.7),0 0 36px rgba(99,102,241,.1);overflow:hidden}
.card::before{content:'';position:absolute;top:0;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent,rgba(139,92,246,.85),rgba(99,102,241,1),rgba(139,92,246,.85),transparent)}
h1{margin:0 0 8px;font-size:22px;font-weight:900;background:linear-gradient(135deg,#818cf8 20%,#c4b5fd);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;letter-spacing:.01em}
p.sub{margin:0 0 24px;color:#475569;font-size:13px}
label{display:block;font-size:11px;color:#64748b;margin-bottom:8px;font-weight:700;letter-spacing:.06em;text-transform:uppercase}
input{width:100%;padding:12px 14px;background:rgba(6,7,13,.9);border:1px solid rgba(255,255,255,.1);border-radius:11px;color:#e5e7eb;font-size:14px;outline:none;font-family:ui-monospace,monospace;letter-spacing:.08em;transition:border-color .15s,box-shadow .15s}
input:focus{border-color:rgba(99,102,241,.65);box-shadow:0 0 0 3px rgba(99,102,241,.13)}
button{width:100%;margin-top:18px;padding:13px;background:linear-gradient(135deg,#5865f2 0%,#7c3aed 100%);color:#fff;border:0;border-radius:11px;font-weight:700;cursor:pointer;font-size:14px;letter-spacing:.02em;box-shadow:0 4px 18px rgba(88,101,242,.4);transition:all .15s}
button:hover{background:linear-gradient(135deg,#4752c4 0%,#6d28d9 100%);box-shadow:0 6px 24px rgba(88,101,242,.58);transform:translateY(-1px)}
button:disabled{opacity:.6;cursor:wait;transform:none;box-shadow:none}
.err{margin-top:12px;color:#f87171;font-size:13px;min-height:18px}
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
    <label>로그인 코드</label>
    <input id="codeInput" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="ABCDE12345" required>
    <button type="submit">로그인</button>
  </form>
  <div class="err" id="err"></div>
</div>
<script>
const err=document.getElementById('err');
const f1=document.getElementById('f1'),f2=document.getElementById('f2');
const nameInput=document.getElementById('nameInput'),codeInput=document.getElementById('codeInput');
let savedName='';
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
      document.getElementById('sub').textContent='코드를 입력하세요.';
      f1.style.display='none';f2.style.display='';codeInput.focus();
    }
  }catch(x){err.textContent='❌ '+x.message;}
  btn.disabled=false;
});
f2.addEventListener('submit',async e=>{
  e.preventDefault();err.textContent='';
  const btn=f2.querySelector('button');btn.disabled=true;
  try{
    const r=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:savedName,code:codeInput.value.trim()})});
    const j=await r.json();
    if(!r.ok)throw new Error(j.error||'로그인 실패');
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
<style>
:root{color-scheme:dark}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent;-webkit-touch-callout:none}
body{margin:0;background:#06070d;background-image:radial-gradient(ellipse 100% 55% at -5% 0%,rgba(30,41,59,.8),transparent 55%),radial-gradient(ellipse 60% 40% at 110% 100%,rgba(88,101,242,.07),transparent);color:#e5e7eb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
header{position:sticky;top:0;z-index:5;display:flex;justify-content:space-between;align-items:center;padding:14px 24px;background:rgba(5,6,12,.9);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);border-bottom:1px solid rgba(255,255,255,.06);box-shadow:0 1px 0 rgba(99,102,241,.12)}
.point-pill{display:flex;align-items:center;gap:5px;padding:4px 5px 4px 9px;border-radius:999px;background:rgba(94,234,212,.08);border:1px solid rgba(94,234,212,.28);flex:0 0 auto}
.point-pill img{width:18px;height:18px;object-fit:contain;flex:0 0 auto}
.point-pill b{color:#5eead4;font-weight:800;font-variant-numeric:tabular-nums;font-size:14px;white-space:nowrap;line-height:1}
#pointAddBtn{width:22px;height:22px;min-width:22px;padding:0;border-radius:50%;display:grid;place-items:center;background:linear-gradient(135deg,#14b8a6,#0d9488);color:#fff;font-size:17px;font-weight:900;line-height:1;flex:0 0 auto}
#pointAddBtn:hover{background:linear-gradient(135deg,#2dd4bf,#14b8a6)}
.point-charge-body{display:flex;flex-direction:column;gap:12px}
.point-charge-body input{width:100%;padding:12px 14px;border-radius:10px;border:1px solid rgba(148,163,184,.25);background:#0b0f1c;color:#e5e7eb;font-size:16px;font-variant-numeric:tabular-nums}
.point-charge-body .point-charge-info{font-size:13px;color:#94a3b8;line-height:1.55}
.point-charge-body button.primary{padding:12px;font-size:15px;font-weight:800}
@media(max-width:560px){.point-pill b{font-size:13px}.who{display:none}}
.loading-overlay{position:fixed;inset:0;z-index:200;display:none;align-items:center;justify-content:center;background:rgba(2,4,10,.55);backdrop-filter:blur(2px);-webkit-backdrop-filter:blur(2px)}
.loading-overlay.active{display:flex}
.loading-spinner{width:54px;height:54px;border-radius:50%;border:5px solid rgba(129,140,248,.25);border-top-color:#818cf8;animation:loadingSpin .8s linear infinite}
@keyframes loadingSpin{to{transform:rotate(360deg)}}
h1{margin:0;font-size:21px;font-weight:900;white-space:nowrap;background:linear-gradient(135deg,#818cf8,#a78bfa 60%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;letter-spacing:.01em}.who{color:#a5b4fc;font-weight:700;white-space:nowrap;min-width:0;overflow:hidden;text-overflow:ellipsis}.bar{display:flex;gap:8px;align-items:center;justify-content:flex-end;min-width:0;flex-shrink:0}.top-left{display:flex;gap:16px;align-items:center;min-width:0;flex:1}.group-tabs{display:flex;gap:2px;min-width:0;overflow:hidden}.group-tab{white-space:nowrap;background:transparent;border:0;color:#64748b;padding:8px 12px;border-radius:9px;font-weight:700;font-size:13px;cursor:pointer;transition:all .15s;flex-shrink:0}.group-tab:hover{background:rgba(255,255,255,.06);color:#e5e7eb}.group-tab.active{background:rgba(88,101,242,.2);color:#e5e7eb;box-shadow:0 0 0 1px rgba(99,102,241,.28)}.subnav-bar{display:flex;gap:2px;padding:0 20px;background:rgba(4,6,14,.82);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);border-bottom:1px solid rgba(255,255,255,.05);overflow-x:auto;scrollbar-width:none;flex-shrink:0}.subnav-bar::-webkit-scrollbar{display:none}.subnav-tab{flex-shrink:0;padding:9px 14px;background:transparent;border:0;border-bottom:2px solid transparent;border-radius:6px 6px 0 0;color:#64748b;font-size:13px;font-weight:600;cursor:pointer;transition:all .15s;margin-bottom:-1px}.subnav-tab:hover{color:#cbd5e1;background:rgba(255,255,255,.05)}.subnav-tab.active{color:#e5e7eb;border-bottom-color:#818cf8}.bottom-tabs{display:none;position:fixed;bottom:0;left:0;right:0;z-index:50;padding:8px 4px calc(8px + env(safe-area-inset-bottom));background:rgba(5,6,12,.94);backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);border-top:1px solid rgba(255,255,255,.07);justify-content:space-around;align-items:flex-start}.bottom-tab{flex:1;display:flex;flex-direction:column;align-items:center;gap:3px;padding:5px 2px;background:transparent;border:0;color:#475569;cursor:pointer;transition:color .15s;border-radius:0;font-weight:700;min-width:0}.bottom-tab:hover{color:#94a3b8;background:transparent}.tab-icon-wrap{display:flex;align-items:center;justify-content:center;width:44px;height:28px;border-radius:14px;background:transparent;transition:background .15s}.tab-icon-wrap svg{width:22px;height:22px;display:block;flex-shrink:0;transition:filter .15s}.tab-label{font-size:10px;letter-spacing:.03em;white-space:nowrap}.bottom-tab.active{color:#818cf8}.bottom-tab.active .tab-icon-wrap{background:rgba(88,101,242,.22);box-shadow:0 0 10px rgba(88,101,242,.3)}.bottom-tab.active .tab-icon-wrap svg{filter:drop-shadow(0 0 3px rgba(129,140,248,.7))}.group-tab{gap:6px;display:flex;align-items:center}.group-tab svg{width:15px;height:15px;display:block;flex-shrink:0;opacity:.75;transition:opacity .15s}.group-tab:hover svg,.group-tab.active svg{opacity:1}
button{border:0;border-radius:10px;padding:10px 13px;background:#141c2e;color:#e5e7eb;font-weight:700;cursor:pointer;transition:background .15s,box-shadow .15s,transform .1s}button:hover{background:#1a2540}.primary{background:linear-gradient(135deg,#5865f2,#4338ca);box-shadow:0 4px 12px rgba(88,101,242,.32)}.primary:hover{background:linear-gradient(135deg,#4752c4,#3730a3);box-shadow:0 6px 18px rgba(88,101,242,.48)}
main{width:min(1180px,94vw);margin:26px auto 50px;display:grid;gap:18px}.page{display:none;gap:18px}.page.active{display:grid}.profile-hero{display:grid;grid-template-columns:170px 1fr;gap:18px;align-items:start}.profile-card{text-align:center}.profile-card .card-tile{padding:0;background:transparent;border:0;box-shadow:none}.profile-card img{width:160px;aspect-ratio:3/4;object-fit:cover;border-radius:4px;border:4px solid #020617;background:#f8fafc}.profile-card .card-name{font-size:16px;color:#f8fafc}.profile-summary{padding-top:4px}.name-line{font-size:20px;margin-bottom:8px}.status-row{display:grid;grid-template-columns:32px minmax(160px,300px) auto;gap:10px;align-items:center;margin:10px 0;font-size:18px}.meter{height:22px;border-radius:6px;background:rgba(2,6,23,.65);overflow:hidden}.meter-fill{height:100%;width:0%}.meter.hp .meter-fill{background:#ef171e}.meter.mp .meter-fill{background:#4140c8}.power-line{font-size:18px;margin-top:14px}.pet-row{display:flex;flex-direction:column;gap:8px;margin-top:14px}.pet-item{display:flex;align-items:center;gap:10px}.pet-thumb{position:relative;width:52px;height:52px;flex:0 0 auto;background:rgba(15,23,42,.7);border-radius:10px;overflow:visible}.pet-thumb .frame{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;z-index:1}.pet-thumb .icon{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);z-index:2;width:120%;height:120%;object-fit:contain;filter:drop-shadow(0 3px 6px rgba(0,0,0,.5))}.pet-thumb .icon-fallback{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);z-index:2;font-size:26px;line-height:1}.pet-thumb.expired .icon{filter:grayscale(1) brightness(.6)}.pet-name{font-size:15px;color:#f8fafc}.pet-item.expired .pet-name{color:#94a3b8}.panel{background:rgba(8,10,20,.82);border:1px solid rgba(255,255,255,.07);border-radius:20px;padding:20px;box-shadow:0 4px 24px rgba(0,0,0,.38),0 0 0 1px rgba(255,255,255,.02) inset;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px)}
h2{margin:0 0 16px;font-size:16px;font-weight:800;letter-spacing:.01em;color:#f1f5f9}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.kv{display:flex;justify-content:space-between;gap:12px;padding:10px 14px;background:rgba(4,6,18,.65);border:1px solid rgba(255,255,255,.06);border-radius:12px}.kv span{color:#94a3b8}.kv b{font-variant-numeric:tabular-nums}
.stat-panel{padding-top:0}
.stat-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:18px 2px 14px}
.stat-toggle{flex:1;display:flex;align-items:center;gap:10px;background:transparent;border:0;padding:0;margin:0;cursor:pointer;font-size:16px;font-weight:800;letter-spacing:.01em;color:#f1f5f9}
.stat-toggle:hover{color:#fff;background:transparent}
.stat-chevron{font-size:14px;color:#94a3b8;transition:transform .2s ease}
.stat-filter{display:flex;align-items:center;gap:6px;font-size:12px;color:#94a3b8;font-weight:600;cursor:pointer;user-select:none;white-space:nowrap}
.stat-filter input{width:15px;height:15px;cursor:pointer;accent-color:#6366f1}
.stat-body{overflow:hidden;transition:max-height .3s ease,opacity .2s ease,margin .2s ease;max-height:3600px;opacity:1}
.stat-body.collapsed{max-height:0;opacity:0;margin-top:-8px}
.stat-card{background:rgba(4,6,18,.6);border:1px solid rgba(255,255,255,.07);border-radius:14px;padding:6px 16px}
.stat-grp+.stat-grp{border-top:1px solid rgba(255,255,255,.05)}
.stat-grp-title{font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#7dd3fc;padding:13px 0 7px}
.stat-line{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:8px 0;min-height:38px}
.stat-line+.stat-line{border-top:1px dashed rgba(148,163,184,.12)}
.stat-line .stat-label{color:#94a3b8;font-size:13px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.stat-vblock{display:flex;flex-direction:column;align-items:flex-end;gap:1px;min-width:0}
.stat-value{font-variant-numeric:tabular-nums;font-weight:800;color:#e5e7eb;white-space:nowrap;font-size:15px}
.stat-value.bonus{color:#86efac}
.stat-value.neg{color:#fca5a5}
.stat-value.zero{color:#475569}
.stat-sub{font-size:11px;color:#64748b;font-weight:600;white-space:nowrap;font-variant-numeric:tabular-nums}.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(132px,1fr));gap:12px}
.card-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:12px}.card-tile{background:rgba(4,6,18,.65);border:1px solid rgba(255,255,255,.07);border-radius:16px;padding:10px;text-align:center}.card-tile img{width:100%;border-radius:12px;display:block;box-shadow:0 10px 24px rgba(0,0,0,.35)}.card-tile.compact{padding:8px}.card-name{margin-top:8px;font-size:13px;font-weight:700}.no-img,.empty-card{min-height:180px;display:grid;place-items:center;color:#94a3b8;border:1px dashed #334155;border-radius:12px}.card-tile.compact .no-img,.card-tile.compact .empty-card{min-height:120px}
.actions{display:flex;gap:8px;flex-wrap:wrap}.view-btn{background:rgba(10,15,28,.8);border:1px solid rgba(255,255,255,.1)}.inv-kind-tabs{display:flex;gap:6px;overflow-x:auto;scrollbar-width:none;flex-wrap:nowrap;padding-bottom:2px}.inv-kind-tabs::-webkit-scrollbar{display:none}.inv-kind-tab{flex-shrink:0;white-space:nowrap;background:rgba(10,15,28,.8);border:1px solid rgba(255,255,255,.1);font-size:13px;padding:7px 14px}.inv-kind-tab.active{background:rgba(88,101,242,.22);border-color:rgba(99,102,241,.5);color:#e0e7ff}.viewer{display:grid;gap:18px}.cat{display:grid;gap:8px}.cat-title{font-size:14px;font-weight:800;color:#f1f5f9;padding:4px 4px 6px;border-bottom:1px solid rgba(148,163,184,.18);margin-bottom:2px}.inv-row{display:flex;justify-content:space-between;gap:12px;align-items:center;padding:12px 14px;background:rgba(4,6,18,.6);border:1px solid rgba(255,255,255,.06);border-radius:13px}.inv-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(72px,1fr));gap:6px}.inv-cell{position:relative;background:rgba(4,6,18,.7);border:1px solid rgba(255,255,255,.09);border-radius:10px;cursor:pointer;transition:border-color .15s,transform .12s,box-shadow .12s;overflow:hidden}.inv-cell:hover{border-color:rgba(99,102,241,.5);transform:translateY(-1px);box-shadow:0 6px 18px rgba(0,0,0,.4)}.inv-cell-img{aspect-ratio:1/1;position:relative;display:grid;place-items:center;background:rgba(15,23,42,.5)}.inv-cell-frame{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;z-index:1}.inv-cell-icon{position:relative;z-index:2;width:100%;height:100%;object-fit:contain;filter:drop-shadow(0 3px 6px rgba(0,0,0,.55))}.inv-cell-count{position:absolute;bottom:3px;right:5px;font-size:11px;font-weight:900;color:#f8fafc;text-shadow:0 1px 4px rgba(0,0,0,.9),0 0 2px rgba(0,0,0,1);line-height:1;z-index:3}.inv-cell-name{padding:3px 4px 5px;font-size:10px;font-weight:700;color:#94a3b8;text-align:center;line-height:1.2;word-break:break-word;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.equip-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px}.equip-card{position:relative;display:grid;grid-template-columns:48px 1fr auto;gap:12px;align-items:center;padding:14px;background:linear-gradient(135deg,rgba(4,6,18,.9),rgba(8,12,26,.75));border:1px solid var(--rar,rgba(255,255,255,.08));border-left:4px solid var(--rar,rgba(255,255,255,.15));border-radius:14px;box-shadow:0 8px 24px rgba(0,0,0,.3)}.equip-card .slot-icon{display:grid;place-items:center;width:48px;height:48px;border-radius:12px;background:rgba(148,163,184,.12);font-size:22px}.equip-card .equip-name{font-size:16px;font-weight:800;color:#f8fafc;margin-bottom:6px}.equip-card .equip-meta{display:flex;gap:6px;flex-wrap:wrap;align-items:center}.equip-card .level{font-size:20px;font-weight:900;font-variant-numeric:tabular-nums;color:#fbbf24}.card-tile,.equip-card{cursor:pointer;transition:transform .12s,box-shadow .12s}.card-tile:hover,.equip-card:hover{transform:translateY(-2px);box-shadow:0 14px 36px rgba(0,0,0,.45),0 0 0 1px rgba(99,102,241,.2)}.modal-bg{position:fixed;inset:0;background:rgba(0,0,0,.72);display:none;align-items:center;justify-content:center;z-index:70;backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);padding:16px}.modal-bg.active{display:flex}.modal{width:min(480px,100%);max-height:90vh;overflow-y:auto;background:rgba(7,10,20,.97);border:1px solid rgba(255,255,255,.1);border-radius:20px;padding:24px;box-shadow:0 30px 80px rgba(0,0,0,.7),0 0 0 1px rgba(255,255,255,.03) inset}.modal.wide{width:min(640px,100%)}.modal h3{margin:0 0 6px;font-size:18px;color:#f8fafc}.modal .sub{color:#94a3b8;font-size:13px;margin-bottom:14px}.modal .stat-line{padding:8px 12px;background:rgba(2,6,23,.6);border:1px solid rgba(148,163,184,.12);border-radius:10px;margin:6px 0;font-size:14px}.modal .close{margin-top:14px;width:100%}.modal .row{display:flex;gap:8px;margin-top:12px;flex-wrap:wrap}.modal .row>*{flex:1}.modal label{display:block;font-size:13px;color:#94a3b8;margin:10px 0 6px;font-weight:700}.modal input,.modal select{width:100%;padding:10px 12px;border-radius:10px;border:1px solid rgba(255,255,255,.1);background:rgba(4,6,18,.85);color:#e5e7eb;font-size:14px;font-weight:600;font-family:inherit;transition:border-color .15s}.modal input:focus,.modal select:focus{outline:none;border-color:rgba(99,102,241,.6);box-shadow:0 0 0 3px rgba(99,102,241,.1)}.seg{display:flex;gap:6px;background:rgba(4,6,18,.7);padding:4px;border-radius:12px;flex-wrap:wrap;border:1px solid rgba(255,255,255,.06)}.seg button{flex:1 0 auto;background:transparent;font-size:13px;padding:8px 12px;white-space:nowrap;color:#94a3b8;transition:all .15s}.seg button:hover{background:rgba(255,255,255,.06);color:#e5e7eb}.seg button.on{background:linear-gradient(135deg,#5865f2,#4338ca);color:#fff;box-shadow:0 2px 8px rgba(88,101,242,.35)}.pick-list{max-height:280px;overflow-y:auto;display:grid;gap:6px;margin-top:8px;padding:4px;background:rgba(4,6,18,.5);border-radius:10px}.pick-row{display:flex;justify-content:space-between;gap:10px;align-items:center;padding:10px 12px;background:rgba(10,15,30,.7);border:1px solid rgba(255,255,255,.06);border-radius:10px;cursor:pointer;font-size:13px;transition:border-color .15s,background .15s}.pick-row:hover{border-color:rgba(99,102,241,.5)}.pick-row.on{border-color:rgba(99,102,241,.55);background:rgba(88,101,242,.16)}.pick-row .meta{color:#94a3b8;font-size:12px;margin-top:2px}.danger{background:#dc2626}.danger:hover{background:#b91c1c}
.equip-thumb{position:relative;width:48px;height:48px;background:rgba(15,23,42,.7);border-radius:12px;overflow:visible}.equip-thumb .frame{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;z-index:1}.equip-thumb .icon{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);z-index:2;width:124%;height:124%;object-fit:contain;filter:drop-shadow(0 3px 6px rgba(0,0,0,.5))}.equip-thumb .icon-fallback{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);z-index:2;font-size:24px;line-height:1}
.modal-equip-thumb{width:120px!important;height:120px!important;margin:6px auto 16px;border-radius:16px}.modal-equip-thumb .icon-fallback{font-size:80px}
.enhance-overlay{position:fixed;inset:0;z-index:60;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,.85);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);padding:12px 8px}.enhance-overlay.active{display:flex}.enhance-wrap{position:relative;width:min(340px,100%);display:flex;flex-direction:column;max-height:90vh;overflow-y:auto;overflow-x:hidden;scrollbar-width:none;background:linear-gradient(180deg,#0c1118,#06090e);border:1px solid rgba(90,130,150,.22);border-radius:14px;box-shadow:0 24px 70px rgba(0,0,0,.65),inset 0 1px 0 rgba(180,220,235,.06)}.enhance-window{position:relative;width:100%;aspect-ratio:641/666;background:url('/rpg-ui?file=%EA%B0%95%ED%99%94.png') center/100% 100% no-repeat;flex-shrink:0;overflow:hidden}.enhance-close-btn{position:absolute;top:1.5%;right:1.5%;background:rgba(0,0,0,.55);border:0;color:rgba(255,255,255,.8);font-size:12px;cursor:pointer;z-index:2;line-height:1;padding:2px 6px;border-radius:4px}.enhance-close-btn:hover{color:#fff;background:rgba(0,0,0,.8)}.enhance-item-zone{position:absolute;top:9%;left:50%;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:4px;z-index:1}.enhance-item-zone .auc-thumb.square{width:60px!important;height:60px!important}.enhance-item-level{font-size:11px;font-weight:700;color:#f1f5f9;text-shadow:0 1px 6px rgba(0,0,0,.95),0 0 14px rgba(0,0,0,.95);background:rgba(0,0,0,.6);border-radius:5px;padding:2px 7px;white-space:nowrap}.enhance-before-content{position:absolute;top:56%;left:3%;width:44%;bottom:6%;overflow-y:auto;scrollbar-width:none;display:flex;flex-direction:column;gap:2px;padding:2px 4px}.enhance-after-content{position:absolute;top:56%;left:52%;width:45%;bottom:6%;overflow-y:auto;scrollbar-width:none;display:flex;flex-direction:column;gap:2px;padding:2px 4px}.enhance-stat-row{display:flex;justify-content:space-between;gap:2px;align-items:baseline}.enhance-stat-label{font-size:9px;color:#94a3b8;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1;min-width:0}.enhance-stat-val{font-size:9px;font-weight:800;color:#e2e8f0;font-variant-numeric:tabular-nums;white-space:nowrap}.enhance-stat-val.better{color:#86efac}.enhance-stat-delta{font-size:8px;font-weight:700;color:#fbbf24;opacity:.85}.enhance-empty-stat{font-size:9px;color:#475569;padding:2px 0}.enhance-info{padding:10px 12px 2px;display:flex;flex-direction:column;gap:8px;flex-shrink:0}.enhance-section-label{font-size:10px;font-weight:800;color:#7dd3fc;letter-spacing:.08em;text-transform:uppercase;margin-bottom:-2px;display:flex;align-items:center;gap:6px}.enhance-section-label::before{content:'';width:3px;height:11px;background:linear-gradient(180deg,#22d3ee,#0891b2);border-radius:2px;box-shadow:0 0 6px rgba(34,211,238,.6)}.enhance-rates-row{display:grid;grid-template-columns:repeat(4,1fr);gap:4px}.enhance-rate-chip{padding:7px 2px;background:linear-gradient(180deg,rgba(24,32,40,.92),rgba(10,14,20,.96));border:1px solid rgba(120,160,180,.14);border-radius:8px;text-align:center;box-shadow:inset 0 1px 0 rgba(180,220,235,.06)}.enhance-rate-chip .rate-label{font-size:9px;color:#94a3b8;font-weight:700}.enhance-rate-chip .rate-val{font-size:11px;font-weight:900;margin-top:2px;font-variant-numeric:tabular-nums}.enhance-rate-chip.great{border-color:rgba(251,191,36,.3);box-shadow:inset 0 1px 0 rgba(251,191,36,.14),0 0 10px rgba(251,191,36,.08)}.enhance-rate-chip.great .rate-val{color:#fbbf24}.enhance-rate-chip.success{border-color:rgba(134,239,172,.28)}.enhance-rate-chip.success .rate-val{color:#86efac}.enhance-rate-chip.down{border-color:rgba(251,146,60,.28)}.enhance-rate-chip.down .rate-val{color:#fdba74}.enhance-rate-chip.destroy{border-color:rgba(239,68,68,.3)}.enhance-rate-chip.destroy .rate-val{color:#ef4444}.enhance-cost-row{display:flex;gap:5px}.enhance-cost-item{flex:1;display:flex;align-items:center;gap:6px;padding:8px 10px;background:linear-gradient(180deg,rgba(24,32,40,.92),rgba(10,14,20,.96));border:1px solid rgba(120,160,180,.14);border-radius:9px;box-shadow:inset 0 1px 0 rgba(180,220,235,.06)}.enhance-cost-item.ok{border-color:rgba(134,239,172,.28)}.enhance-cost-item.lack{border-color:rgba(252,165,165,.35);box-shadow:inset 0 1px 0 rgba(180,220,235,.06),0 0 10px rgba(239,68,68,.08)}.enhance-cost-text{display:flex;flex-direction:column;gap:1px;flex:1;min-width:0}.enhance-cost-name{font-size:10px;color:#94a3b8;font-weight:700}.enhance-cost-val{font-size:11px;font-weight:800;font-variant-numeric:tabular-nums}.enhance-cost-item.ok .enhance-cost-val{color:#86efac}.enhance-cost-item.lack .enhance-cost-val{color:#fca5a5}.enhance-protect{display:flex;align-items:center;gap:10px;padding:9px 11px;border-radius:10px;border:1px solid;position:relative;overflow:hidden}.enhance-protect.clickable{cursor:pointer;transition:filter .15s}.enhance-protect.clickable:hover{filter:brightness(1.15)}.enhance-protect.none{background:rgba(20,26,34,.7);border-color:rgba(100,116,139,.25)}.enhance-protect.none .enhance-protect-icon{color:#64748b;font-size:18px}.enhance-protect.none .enhance-protect-name{color:#94a3b8}.enhance-protect.none .enhance-protect-detail{color:#64748b}.enhance-protect-pick-arrow{font-size:13px;color:#94a3b8;flex-shrink:0;margin-left:auto}
.protect-picker{display:flex;flex-direction:column;gap:6px;padding:2px 0}.protect-pick-row{display:flex;align-items:center;gap:10px;padding:10px 12px;border:1.5px solid rgba(255,255,255,.07);border-radius:11px;background:rgba(4,6,18,.6);cursor:pointer;transition:all .12s}.protect-pick-row:hover{border-color:rgba(99,102,241,.4);background:rgba(88,101,242,.08)}.protect-pick-row.selected{border-color:rgba(99,102,241,.6);background:rgba(88,101,242,.16)}.protect-pick-icon{width:34px;height:34px;flex-shrink:0;display:flex;align-items:center;justify-content:center;border-radius:8px;background:rgba(4,6,18,.8);font-size:16px;overflow:hidden}.protect-pick-icon img{width:100%;height:100%;object-fit:contain}.protect-pick-text{flex:1;min-width:0}.protect-pick-name{font-size:13px;font-weight:800;color:#f1f5f9;line-height:1.3}.protect-pick-detail{font-size:11px;color:#64748b;font-weight:600;margin-top:1px}.protect-pick-count{font-size:11px;font-weight:800;color:#94a3b8;white-space:nowrap;flex-shrink:0}.protect-pick-check{font-size:13px;color:#818cf8;flex-shrink:0;margin-left:2px}.enhance-protect-icon,.enhance-protect-text,.enhance-protect-badge{position:relative;z-index:1}.enhance-protect-icon{width:34px;height:34px;flex-shrink:0;display:flex;align-items:center;justify-content:center;border-radius:8px;font-size:15px;line-height:1;overflow:hidden}.enhance-protect-img{width:100%;height:100%;object-fit:contain;filter:drop-shadow(0 1px 3px rgba(0,0,0,.5))}.enhance-protect-text{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px}.enhance-protect-name{font-size:12px;font-weight:800;line-height:1.2}.enhance-protect-detail{font-size:10px;font-weight:600;opacity:.85;line-height:1.2}.enhance-protect-badge{font-size:9px;font-weight:800;padding:3px 8px;border-radius:999px;white-space:nowrap;letter-spacing:.04em}
.enhance-protect.basic{background:linear-gradient(180deg,rgba(100,116,139,.16),rgba(51,65,85,.12));border-color:rgba(148,163,184,.32)}.enhance-protect.basic .enhance-protect-icon{background:rgba(148,163,184,.18);color:#cbd5e1;box-shadow:inset 0 0 0 1px rgba(203,213,225,.25)}.enhance-protect.basic .enhance-protect-name{color:#e2e8f0}.enhance-protect.basic .enhance-protect-detail{color:#cbd5e1}.enhance-protect.basic .enhance-protect-badge{background:rgba(148,163,184,.2);color:#e2e8f0}
.enhance-protect.advanced{background:linear-gradient(180deg,rgba(34,211,238,.13),rgba(8,145,178,.1));border-color:rgba(34,211,238,.42);box-shadow:0 0 18px rgba(34,211,238,.1)}.enhance-protect.advanced .enhance-protect-icon{background:rgba(34,211,238,.18);color:#67e8f9;box-shadow:inset 0 0 0 1px rgba(103,232,249,.35)}.enhance-protect.advanced .enhance-protect-name{color:#a5f3fc}.enhance-protect.advanced .enhance-protect-detail{color:#7dd3fc}.enhance-protect.advanced .enhance-protect-badge{background:rgba(34,211,238,.22);color:#cffafe}
.enhance-protect.blessed{background:linear-gradient(180deg,rgba(251,191,36,.15),rgba(180,83,9,.1));border-color:rgba(251,191,36,.45);box-shadow:0 0 22px rgba(251,191,36,.15)}.enhance-protect.blessed::before{content:'';position:absolute;inset:0;z-index:0;background:linear-gradient(115deg,transparent 32%,rgba(255,255,255,.2) 50%,transparent 68%);animation:enhBlessShimmer 3.2s linear infinite}@keyframes enhBlessShimmer{0%{transform:translateX(-120%)}100%{transform:translateX(120%)}}.enhance-protect.blessed .enhance-protect-icon{background:rgba(251,191,36,.2);color:#fde68a;box-shadow:inset 0 0 0 1px rgba(253,230,138,.4)}.enhance-protect.blessed .enhance-protect-name{color:#fde68a}.enhance-protect.blessed .enhance-protect-detail{color:#fcd34d}.enhance-protect.blessed .enhance-protect-badge{background:rgba(251,191,36,.25);color:#fffbeb}.enhance-error-wrap{display:flex;flex-direction:column;align-items:center;padding:40px 16px 20px}.enhance-footer{padding:10px 12px;background:linear-gradient(180deg,rgba(14,19,26,.5),rgba(6,9,14,.98));border-top:1px solid rgba(90,130,150,.18);display:grid;grid-template-columns:1fr 2fr;gap:8px;flex-shrink:0}.enhance-cancel-btn{background:linear-gradient(180deg,rgba(34,44,56,.92),rgba(16,22,30,.96));border:1px solid rgba(120,160,180,.18);border-radius:8px;color:#cbd5e1;font-weight:700;font-size:13px;cursor:pointer;box-shadow:inset 0 1px 0 rgba(180,220,235,.06);transition:filter .15s,transform .1s}.enhance-cancel-btn:hover{filter:brightness(1.18)}.enhance-cancel-btn:active{transform:scale(.97)}.enhance-confirm-btn{background:url('/rpg-ui?file=%EA%B0%95%ED%99%94%EB%B2%84%ED%8A%BC.png') center/contain no-repeat!important;background-color:transparent!important;border:0!important;box-shadow:none!important;min-height:44px;color:transparent!important;cursor:pointer;transition:opacity .15s,transform .1s;border-radius:6px;transform:none!important}.enhance-confirm-btn:hover{opacity:.85;background:url('/rpg-ui?file=%EA%B0%95%ED%99%94%EB%B2%84%ED%8A%BC.png') center/contain no-repeat!important;transform:none!important}.enhance-confirm-btn:active{transform:scale(.96)!important}.enhance-confirm-btn:disabled{opacity:.35;cursor:not-allowed}.enhance-result-overlay{position:absolute;inset:0;z-index:5;display:none;align-items:center;justify-content:center;flex-direction:column;gap:10px;background:rgba(0,0,0,.86);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);padding:20px;text-align:center;overflow-y:auto;scrollbar-width:none}.enhance-result-overlay.active{display:flex}.enhance-result-msg{font-size:24px;font-weight:900;letter-spacing:.02em;line-height:1.3}.enhance-result-msg.great{color:#fbbf24;text-shadow:0 0 24px rgba(251,191,36,.6)}.enhance-result-msg.success{color:#86efac;text-shadow:0 0 20px rgba(134,239,172,.5)}.enhance-result-msg.fail{color:#fca5a5}.enhance-result-msg.destroy{color:#ef4444;text-shadow:0 0 24px rgba(239,68,68,.5)}.enhance-result-msg.protected{color:#a5b4fc}.enhance-result-sub{font-size:13px;color:#94a3b8;font-weight:600;max-width:280px;word-break:break-word}
.enh-fx{position:relative;width:170px;height:170px;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-bottom:4px}.enh-fx-weapon{position:relative;z-index:3;width:96px;height:96px}.enh-fx-weapon .auc-thumb.square{width:96px!important;height:96px!important}.enh-fx-aura{position:absolute;inset:-18%;z-index:1;border-radius:50%;opacity:0}.enh-fx-rays{position:absolute;inset:-28%;z-index:2;width:156%;height:156%;pointer-events:none;overflow:visible}.enh-fx-sparkles,.enh-fx-shards{position:absolute;inset:-28%;z-index:4;width:156%;height:156%;pointer-events:none;overflow:visible}
.enh-sparkle{opacity:0;animation:enhSparkle 1.1s ease-out forwards}@keyframes enhSparkle{0%{opacity:0;transform:scale(.2) rotate(0)}30%{opacity:1;transform:scale(1.3) rotate(40deg)}100%{opacity:0;transform:scale(.4) rotate(90deg)}}
@keyframes enhPop{0%{transform:scale(.3);opacity:0}100%{transform:scale(1);opacity:1}}@keyframes enhAuraFade{0%{opacity:0;transform:scale(.5)}40%{opacity:1;transform:scale(1)}100%{opacity:0;transform:scale(1.3)}}@keyframes enhAuraFade2{0%{opacity:0;transform:scale(.5)}30%{opacity:.9;transform:scale(1)}100%{opacity:.4;transform:scale(1.15)}}@keyframes enhRayBurst{0%{opacity:0;transform:scale(.2)}50%{opacity:1;transform:scale(1.05)}100%{opacity:0;transform:scale(1.2)}}@keyframes enhRaySpin{to{transform:rotate(360deg)}}@keyframes enhRainbowSpin{to{transform:rotate(360deg)}}
.enh-fx.success .enh-fx-weapon{animation:enhPop .5s cubic-bezier(.2,1.4,.4,1) both,enhShineBlue 1.4s ease-in-out .3s}.enh-fx.success .enh-fx-aura{background:radial-gradient(circle,rgba(186,230,253,.5),transparent 65%);animation:enhAuraFade 1.3s ease-out forwards}.enh-fx.success .enh-rays-spin{animation:enhRayBurst 1s ease-out forwards}@keyframes enhShineBlue{0%,100%{filter:drop-shadow(0 0 0 rgba(186,230,253,0))}50%{filter:drop-shadow(0 0 16px rgba(186,230,253,.95)) brightness(1.3)}}
.enh-fx.great .enh-fx-weapon{animation:enhPop .5s cubic-bezier(.2,1.4,.4,1) both,enhGoldRainbow 2.4s ease-in-out .3s forwards}.enh-fx.great .enh-fx-aura{background:conic-gradient(from 0deg,#f87171,#fbbf24,#86efac,#22d3ee,#818cf8,#e879f9,#f87171);filter:blur(9px);animation:enhRainbowSpin 3s linear infinite,enhAuraFade2 2.6s ease-out forwards}.enh-fx.great .enh-rays-spin{animation:enhRayBurst 1.1s ease-out forwards,enhRaySpin 3s linear .6s infinite}@keyframes enhGoldRainbow{0%{filter:drop-shadow(0 0 0 rgba(251,191,36,0))}22%{filter:drop-shadow(0 0 24px rgba(251,191,36,1)) brightness(1.6) saturate(1.4)}55%{filter:drop-shadow(0 0 18px rgba(251,191,36,.8)) hue-rotate(0deg) brightness(1.3)}100%{filter:drop-shadow(0 0 14px rgba(255,255,255,.6)) hue-rotate(360deg) brightness(1.15)}}
.enh-fx.down .enh-fx-weapon,.enh-fx.fail .enh-fx-weapon{animation:enhSink 1.2s ease-in forwards}.enh-fx.down .enh-fx-aura,.enh-fx.fail .enh-fx-aura{background:radial-gradient(circle,rgba(239,68,68,.45),transparent 65%);animation:enhAuraFade 1.2s ease-out forwards}@keyframes enhSink{0%{transform:translateY(0);filter:drop-shadow(0 0 0 rgba(239,68,68,0))}22%{transform:translate(-3px,-3px)}34%{transform:translateX(3px)}46%{transform:translateX(-2px)}56%{transform:translateX(0)}100%{transform:translateY(15px);filter:drop-shadow(0 6px 10px rgba(239,68,68,.6)) brightness(.6) saturate(.7)}}
.enh-fx.destroy .enh-fx-weapon{animation:enhShatter 1.1s ease-in forwards}.enh-fx.destroy .enh-fx-aura{background:radial-gradient(circle,rgba(239,68,68,.6),transparent 60%);animation:enhExplode 1.1s ease-out forwards}@keyframes enhShatter{0%{transform:translate(0,0) rotate(0)}8%{transform:translate(-4px,0) rotate(-3deg)}16%{transform:translate(4px,0) rotate(3deg)}24%{transform:translate(-4px,0) rotate(-3deg)}32%{transform:translate(4px,0) rotate(3deg)}40%{transform:translate(-3px,0) rotate(-2deg)}48%{transform:translate(3px,0) rotate(2deg);opacity:1}55%{transform:scale(1.18);opacity:1;filter:brightness(2)}60%,100%{opacity:0;transform:scale(1.3)}}.enh-shard{opacity:0;animation:enhShardFly 1s ease-out .5s forwards}@keyframes enhShardFly{0%{opacity:0;transform:translate(0,0) rotate(0)}10%{opacity:1}100%{opacity:0;transform:translate(var(--dx),var(--dy)) rotate(var(--rot))}}@keyframes enhExplode{0%{opacity:0;transform:scale(.3)}40%{opacity:0}55%{opacity:1;transform:scale(.6)}70%{opacity:.8;transform:scale(1.1)}100%{opacity:0;transform:scale(1.4)}}
.enh-fx.protected .enh-fx-weapon{animation:enhPop .5s cubic-bezier(.2,1.4,.4,1) both}.enh-fx.protected .enh-fx-aura{background:radial-gradient(circle,rgba(129,140,248,.45),transparent 62%);box-shadow:0 0 0 2px rgba(165,180,252,.4) inset;animation:enhShieldPulse 1.3s ease-out forwards}@keyframes enhShieldPulse{0%{opacity:0;transform:scale(.6)}40%{opacity:1;transform:scale(1)}70%{opacity:.7;transform:scale(1.08)}100%{opacity:0;transform:scale(1.15)}}
.enh-result-headline{font-size:24px;font-weight:900;letter-spacing:.02em;line-height:1.3;opacity:0;animation:enhHeadline .5s ease-out .2s forwards}@keyframes enhHeadline{0%{opacity:0;transform:translateY(8px) scale(.9)}100%{opacity:1;transform:none}}.enh-result-headline.great{color:#fbbf24;text-shadow:0 0 24px rgba(251,191,36,.6)}.enh-result-headline.success{color:#86efac;text-shadow:0 0 20px rgba(134,239,172,.5)}.enh-result-headline.down,.enh-result-headline.fail{color:#fca5a5}.enh-result-headline.destroy{color:#ef4444;text-shadow:0 0 24px rgba(239,68,68,.5)}.enh-result-headline.protected{color:#a5b4fc}
.enh-result-stats{display:flex;flex-direction:column;gap:5px;width:100%;max-width:280px;margin-top:2px}.enh-result-stat-row{display:flex;justify-content:space-between;align-items:baseline;gap:10px;padding:6px 12px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:9px;opacity:0;animation:enhStatIn .45s cubic-bezier(.2,.8,.3,1) forwards}.enh-result-stat-row.down{background:rgba(239,68,68,.06);border-color:rgba(239,68,68,.18)}@keyframes enhStatIn{0%{opacity:0;transform:translateX(-14px)}100%{opacity:1;transform:none}}.enh-result-stat-label{font-size:12px;color:#94a3b8;font-weight:600}.enh-result-stat-val{font-size:13px;font-weight:800;color:#86efac;font-variant-numeric:tabular-nums;white-space:nowrap}.enh-result-stat-row.down .enh-result-stat-val{color:#fca5a5}.enh-result-stat-delta{font-size:11px;font-weight:700;color:#fbbf24;opacity:.9}.enh-result-stat-row.down .enh-result-stat-delta{color:#f87171}
.enh-result-confirm{min-width:130px;padding:11px 18px;border-radius:10px;font-size:14px;font-weight:800;cursor:pointer;border:1px solid rgba(255,255,255,.15);background:rgba(255,255,255,.08);color:#e5e7eb;opacity:0;animation:enhHeadline .4s ease-out forwards;margin-top:4px}.enh-result-confirm.great,.enh-result-confirm.success{background:linear-gradient(135deg,#6366f1,#8b5cf6);border-color:transparent;color:#fff}.enh-result-confirm:hover{filter:brightness(1.1)}.enh-result-confirm:active{transform:scale(.96)}
.enh-warn-icon{font-size:40px;line-height:1;filter:drop-shadow(0 0 16px rgba(251,146,60,.5))}.enh-warn-title{font-size:18px;font-weight:900;color:#fdba74;text-shadow:0 0 18px rgba(251,146,60,.4)}.enh-warn-sub{font-size:13px;color:#cbd5e1;font-weight:600;max-width:260px;line-height:1.5;word-break:keep-all}.enh-warn-actions{display:grid;grid-template-columns:1fr 1fr;gap:10px;width:100%;max-width:260px;margin-top:6px}.enh-warn-confirm{padding:11px 18px;border-radius:10px;font-size:14px;font-weight:800;cursor:pointer;border:1px solid rgba(251,146,60,.4);background:linear-gradient(135deg,#ea580c,#dc2626);color:#fff;box-shadow:0 0 18px rgba(234,88,12,.3)}.enh-warn-confirm:hover{filter:brightness(1.12)}.enh-warn-confirm:active{transform:scale(.96)}.enh-warn-actions .enhance-cancel-btn{padding:11px 18px}
@media(max-width:400px){.enhance-rates-row{grid-template-columns:repeat(2,1fr)}}
.shop-tab.hotdeal{background:linear-gradient(135deg,rgba(234,88,12,.18),rgba(6,182,212,.14));border-color:rgba(251,146,60,.45);color:#fdba74;font-weight:800}.shop-tab.hotdeal.active{background:linear-gradient(135deg,rgba(234,88,12,.32),rgba(6,182,212,.22));border-color:rgba(251,146,60,.8);color:#fde68a;box-shadow:0 0 12px rgba(251,146,60,.3)}
.hd-root{display:flex;flex-direction:column;gap:14px;padding:2px 0}.hd-header{position:relative;text-align:center;padding:8px 0 4px}.hd-title{font-size:28px;font-weight:900;letter-spacing:.04em;background:linear-gradient(135deg,#f97316 0%,#fbbf24 35%,#67e8f9 70%,#22d3ee 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;text-shadow:none;line-height:1.1}.hd-title-fire{display:inline-block;font-size:22px;-webkit-text-fill-color:initial;margin-right:4px;animation:hdFireFlicker 1.4s ease-in-out infinite}.hd-title-fire2{display:inline-block;font-size:22px;-webkit-text-fill-color:initial;margin-left:4px;animation:hdFireFlicker 1.4s ease-in-out infinite .7s}@keyframes hdFireFlicker{0%,100%{transform:scaleY(1) rotate(-2deg);opacity:1}50%{transform:scaleY(1.15) rotate(2deg);opacity:.85}}.hd-meta{display:flex;align-items:center;justify-content:center;gap:10px;margin-top:6px;flex-wrap:wrap}.hd-sector-badge{padding:3px 12px;border-radius:999px;background:linear-gradient(135deg,rgba(234,88,12,.22),rgba(6,182,212,.18));border:1px solid rgba(251,146,60,.45);color:#fde68a;font-size:11px;font-weight:800;letter-spacing:.06em}.hd-countdown{font-size:12px;color:#7dd3fc;font-weight:700;font-variant-numeric:tabular-nums}.hd-countdown span{color:#e0f2fe;font-weight:900}
.hd-slots{display:grid;grid-template-columns:1fr 1fr;gap:12px}@media(max-width:480px){.hd-slots{grid-template-columns:1fr}}
.hd-slot{position:relative;border-radius:14px;padding:3px;overflow:visible}.hd-slot-inner{border-radius:12px;background:linear-gradient(160deg,#061218,#04090e);overflow:hidden;display:flex;flex-direction:column;align-items:center;padding:18px 14px 14px;gap:10px;min-height:200px;position:relative;z-index:1}
.hd-slot.fire{background:linear-gradient(135deg,#f97316,#ea580c,#fbbf24,#f97316);background-size:200% 200%;animation:hdFireBorder 3s ease infinite;box-shadow:0 0 22px rgba(234,88,12,.5),0 0 45px rgba(249,115,22,.2)}.hd-slot.fire .hd-slot-inner::before{content:'';position:absolute;inset:0;background:radial-gradient(ellipse at 50% 100%,rgba(234,88,12,.12),transparent 65%);pointer-events:none}@keyframes hdFireBorder{0%,100%{background-position:0% 50%}50%{background-position:100% 50%}}
.hd-slot.lightning{background:linear-gradient(135deg,#06b6d4,#0891b2,#22d3ee,#0284c7,#06b6d4);background-size:200% 200%;animation:hdLightningBorder 2.4s ease infinite;box-shadow:0 0 22px rgba(6,182,212,.55),0 0 45px rgba(34,211,238,.18)}.hd-slot.lightning .hd-slot-inner::before{content:'';position:absolute;inset:0;background:radial-gradient(ellipse at 50% 100%,rgba(6,182,212,.12),transparent 65%);pointer-events:none}@keyframes hdLightningBorder{0%,100%{background-position:0% 50%}50%{background-position:100% 50%}}
.hd-slot-spark{position:absolute;width:2px;height:10px;border-radius:1px;background:#22d3ee;opacity:0;animation:hdSpark 1.8s linear infinite;pointer-events:none;z-index:2}.hd-slot.lightning .hd-slot-spark:nth-child(1){top:18%;right:-1px;animation-delay:0s}.hd-slot.lightning .hd-slot-spark:nth-child(2){top:55%;right:-1px;animation-delay:.6s}.hd-slot.lightning .hd-slot-spark:nth-child(3){bottom:22%;left:-1px;animation-delay:1.1s}@keyframes hdSpark{0%{opacity:0;transform:scaleY(1) translateY(0)}20%{opacity:1;transform:scaleY(1.6) translateY(-3px)}40%{opacity:.6;transform:scaleY(.8) translateY(2px)}60%{opacity:1;transform:scaleY(1.4) translateY(-2px)}80%{opacity:.3}100%{opacity:0}}
.hd-slot-ember{position:absolute;width:3px;height:3px;border-radius:50%;background:#f97316;opacity:0;animation:hdEmber 2.2s ease-out infinite;pointer-events:none;z-index:2}.hd-slot.fire .hd-slot-ember:nth-child(1){bottom:10%;left:20%;animation-delay:0s}.hd-slot.fire .hd-slot-ember:nth-child(2){bottom:10%;left:50%;animation-delay:.7s}.hd-slot.fire .hd-slot-ember:nth-child(3){bottom:10%;right:20%;animation-delay:1.4s}@keyframes hdEmber{0%{opacity:0;transform:translate(0,0) scale(1)}30%{opacity:1}70%{opacity:.7;transform:translate(var(--ex,4px),var(--ey,-28px)) scale(.6)}100%{opacity:0;transform:translate(var(--ex,4px),var(--ey,-40px)) scale(.2)}}
.hd-item-thumb{position:relative;width:80px;height:80px;flex-shrink:0}.hd-item-thumb .auc-frame,.hd-item-thumb .auc-item-img{position:absolute}.hd-sold{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.72);border-radius:8px;z-index:3}.hd-sold-text{font-size:14px;font-weight:900;color:#94a3b8;letter-spacing:.1em;transform:rotate(-12deg)}
.hd-item-name{font-size:14px;font-weight:800;color:#f1f5f9;text-align:center;line-height:1.3}.hd-price-row{display:flex;align-items:center;justify-content:center;gap:6px}.hd-price-img{width:20px;height:20px;object-fit:contain}.hd-price-val{font-size:15px;font-weight:900;font-variant-numeric:tabular-nums;color:#e2e8f0}.hd-buy-btn{margin-top:2px;padding:9px 24px;border-radius:10px;font-size:14px;font-weight:800;cursor:pointer;border:0;transition:filter .15s,transform .1s;width:100%;box-shadow:0 4px 14px rgba(0,0,0,.3)}.hd-slot.fire .hd-buy-btn{background:linear-gradient(135deg,#ea580c,#f97316);color:#fff}.hd-slot.lightning .hd-buy-btn{background:linear-gradient(135deg,#0891b2,#06b6d4);color:#fff}.hd-buy-btn:disabled{background:rgba(71,85,105,.5)!important;color:#64748b;box-shadow:none;cursor:not-allowed}.hd-buy-btn:not(:disabled):hover{filter:brightness(1.15)}.hd-buy-btn:not(:disabled):active{transform:scale(.97)}.hd-currency-bar{display:flex;gap:8px;justify-content:center;flex-wrap:wrap}
.pet-special-title{margin:14px 0 4px;font-size:12px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;color:#a5f3fc}
.pet-set-block{margin-top:14px;padding:12px 14px;background:rgba(34,197,94,.08);border:1px solid rgba(34,197,94,.35);border-radius:12px;display:grid;gap:10px}
.pet-set-title{font-size:13px;font-weight:800;color:#86efac}
.pet-set-tier{display:grid;grid-template-columns:54px 1fr;gap:10px;align-items:start;font-size:13px}
.pet-set-tier-label{font-weight:800;color:#fbbf24;font-variant-numeric:tabular-nums}
.pet-set-tier-lines{display:grid;gap:2px;color:#dcfce7}
.equip-thumb.pet-expired .icon{filter:grayscale(1) brightness(.6)}
.combine-board{position:sticky;top:74px;z-index:1;align-self:start}
@media(min-width:900px){.page[data-page="combine"]{grid-template-columns:minmax(340px,520px) 1fr;align-items:start}}
@media(min-width:900px){.page[data-page="jobcombine"]{grid-template-columns:minmax(340px,520px) 1fr;align-items:start}}
.jobcombine-board{position:sticky;top:74px;z-index:1;align-self:start}
.jobcombine-wrap{display:grid;gap:14px;justify-items:center}
.jobcombine-stage{position:relative;width:min(560px,96%);aspect-ratio:872/896;background-size:contain;background-repeat:no-repeat;background-position:center}
.jobcombine-slot{position:absolute;cursor:pointer}
.jobcombine-slot .slot-card{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;filter:drop-shadow(0 4px 10px rgba(0,0,0,.55))}
.jobcombine-slot.m0{left:6.8%;top:55.4%;width:21.8%;height:29%}
.jobcombine-slot.m1{left:38.88%;top:4%;width:21.8%;height:29%}
.jobcombine-slot.m2{left:71.7%;top:55.4%;width:21.8%;height:29%}
.jobcombine-slot.result{left:39.2%;top:39.3%;width:21.3%;height:28.8%}
.jobcombine-slot.empty .slot-card{display:none}
.jobcombine-slot.clickable:hover .slot-card{filter:brightness(1.12) drop-shadow(0 4px 10px rgba(0,0,0,.55))}
.jobcombine-btn{position:absolute;left:38.5%;top:94.5%;width:23%;height:5%;border:0;background:transparent;background-size:contain;background-repeat:no-repeat;background-position:center;cursor:pointer;padding:0}
.jobcombine-btn:disabled{opacity:.45;cursor:not-allowed}
.jobcombine-info{font-size:13px;color:#cbd5e1;text-align:center;min-height:20px;line-height:1.6;display:flex;flex-direction:column;align-items:center;gap:4px}
.combine-wrap{display:grid;gap:14px;justify-items:center}
.lvreward-list{display:flex;flex-direction:column;gap:10px;padding:4px 0}
.lvreward-row{display:flex;align-items:center;gap:12px;padding:14px 16px;background:rgba(4,6,18,.7);border:1px solid rgba(255,255,255,.07);border-left:3px solid #f59e0b;border-radius:12px;transition:border-color .15s}
.lvreward-row.claimed{border-left-color:rgba(100,116,139,.4);opacity:.55}
.lvreward-items{display:flex;align-items:center;gap:8px;flex:1;flex-wrap:wrap}
.lvreward-icon-wrap{position:relative;display:flex;flex-direction:column;align-items:center;gap:3px}
.lvreward-thumb{position:relative;width:44px;height:44px;flex-shrink:0}
.lvreward-thumb .auc-frame{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;z-index:1;pointer-events:none}
.lvreward-thumb .auc-item-img{position:relative;z-index:2;width:100%;height:100%;object-fit:contain;position:absolute;top:50%;left:50%;transform:translate(-50%,-50%)}
.lvreward-thumb-fallback{width:44px;height:44px;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:800;color:#94a3b8;background:rgba(30,41,59,.6);border-radius:8px;text-align:center;word-break:keep-all;padding:2px;flex-shrink:0}
.lvreward-icon-count{font-size:10px;font-weight:900;color:#fde68a;white-space:nowrap}
.lvreward-garnet{display:flex;align-items:center;gap:4px;font-size:11px;font-weight:900;color:#7dd3fc}
.lvreward-garnet img{width:36px;height:36px;object-fit:contain}
.lvreward-right{display:flex;flex-direction:column;align-items:flex-end;gap:6px;flex-shrink:0;min-width:110px}
.lvreward-label{font-size:12px;font-weight:900;letter-spacing:.02em;background:url('/rpg-ui?file=%EB%AC%B4%EC%A7%80%EA%B0%9C%20%EA%B7%B8%EB%9D%BC%EB%8D%B0%EC%9D%B4%EC%85%98.jpg') center/cover;-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;color:transparent}
.lvreward-label.gray{background:none;-webkit-background-clip:unset;background-clip:unset;-webkit-text-fill-color:unset;color:#6b7280}
.lvreward-btn{padding:6px 14px;border-radius:8px;font-size:12px;font-weight:900;cursor:pointer;border:0;transition:opacity .15s,transform .1s}
.lvreward-btn.claim{background:linear-gradient(135deg,#f59e0b,#d97706);color:#fff;box-shadow:0 4px 12px rgba(245,158,11,.35)}
.lvreward-btn.claim:hover{opacity:.88}
.lvreward-btn.claim:active{transform:scale(.96)}
.lvreward-btn.done{background:rgba(30,41,59,.6);color:#64748b;border:1px solid rgba(100,116,139,.2);cursor:default}
.lvreward-btn.locked{background:rgba(30,41,59,.4);color:#475569;border:1px solid rgba(100,116,139,.15);cursor:default}
.lvreward-modal-body{display:flex;flex-direction:column;gap:8px}
.lvreward-modal-row{display:flex;align-items:center;gap:10px;padding:8px 10px;background:rgba(4,6,18,.5);border:1px solid rgba(255,255,255,.06);border-radius:10px}
.lvreward-modal-name{flex:1;font-size:13px;font-weight:700;color:#e2e8f0}
.lvreward-modal-count{font-size:13px;font-weight:900;color:#fde68a;white-space:nowrap}
.combine-stage{position:relative;width:min(560px,96%);aspect-ratio:878/898;background-size:contain;background-repeat:no-repeat;background-position:center}
.combine-slot{position:absolute;cursor:pointer}
.combine-slot .slot-card{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;filter:drop-shadow(0 4px 10px rgba(0,0,0,.55))}
.combine-slot.lucky{left:38.5%;top:2.2%;width:21.7%;height:29%}
.combine-slot.result{left:38.5%;top:31.27%;width:21.7%;height:29%}
.combine-slot.m0{left:8.8%;top:52.1%;width:21.7%;height:29%}
.combine-slot.m1{left:38.4%;top:60.5%;width:21.7%;height:29%}
.combine-slot.m2{left:68.4%;top:52.1%;width:21.7%;height:29%}
.combine-slot.empty .slot-card{display:none}
.combine-slot.clickable:hover .slot-card{filter:brightness(1.12) drop-shadow(0 4px 10px rgba(0,0,0,.55))}
.combine-btn{position:absolute;left:37.7%;top:91.6%;width:23.4%;height:8%;border:0;background:transparent;background-size:contain;background-repeat:no-repeat;background-position:center;cursor:pointer;padding:0}
.combine-btn:disabled{opacity:.45;cursor:not-allowed}
.combine-btn:hover{background-color:transparent;background-size:contain;background-repeat:no-repeat;background-position:center}
.combine-effect{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:10;pointer-events:none}
.combine-info{font-size:13px;color:#cbd5e1;text-align:center;min-height:20px;line-height:1.6;display:flex;flex-direction:column;align-items:center;gap:4px}
.combine-result{display:inline-flex;flex-direction:column;align-items:center;gap:8px;padding:14px 22px;border-radius:16px;border:1px solid;animation:combinePop .3s ease}
.combine-result.ok{background:linear-gradient(135deg,rgba(251,191,36,.2),rgba(88,101,242,.16));border-color:rgba(251,191,36,.55);box-shadow:0 8px 30px rgba(251,191,36,.18);color:#fde68a}
.combine-result.fail{background:rgba(2,6,23,.55);border-color:rgba(148,163,184,.28);color:#cbd5e1}
.combine-result-head{font-size:17px;font-weight:900;letter-spacing:.02em}
.combine-result-card{display:flex;align-items:center;gap:10px}
.combine-result-img{width:46px;aspect-ratio:3/4;object-fit:cover;border-radius:6px;border:2px solid rgba(2,6,23,.6);box-shadow:0 4px 12px rgba(0,0,0,.4)}
.combine-result-name{font-size:14px;font-weight:800;color:#f8fafc}
.combine-result-note{font-size:12px;color:#94a3b8;line-height:1.4}
@keyframes combinePop{from{opacity:0;transform:translateY(8px) scale(.95)}to{opacity:1;transform:none}}
.combine-pool-card{cursor:pointer;position:relative}
.combine-pool-card.disabled{opacity:.32;filter:grayscale(.7);cursor:not-allowed}
.combine-pool-card.selected{outline:2px solid #fbbf24;border-radius:14px}
.pot-block{margin-top:12px;padding:12px 14px;background:rgba(2,6,23,.5);border:2px solid var(--pot-tier,#94a3b8);border-radius:12px;box-shadow:0 0 14px -4px var(--pot-tier,#94a3b8) inset}
.pot-title{font-size:12px;font-weight:800;letter-spacing:.06em;color:var(--pot-tier,#e5e7eb);text-transform:uppercase;margin-bottom:8px;display:flex;align-items:center;gap:8px}
.pot-title .pot-tier-label{padding:2px 8px;background:rgba(255,255,255,.06);border:1px solid var(--pot-tier,#94a3b8);border-radius:999px;font-size:11px;color:var(--pot-tier,#e5e7eb)}
.pot-row{display:flex;align-items:center;gap:8px;padding:6px 0;font-size:14px;color:#e5e7eb}
.pot-row+.pot-row{border-top:1px dashed rgba(148,163,184,.18)}
.pot-grade{flex-shrink:0;display:inline-block;min-width:54px;text-align:center;padding:3px 8px;border-radius:999px;font-size:11px;font-weight:800;letter-spacing:.04em;background:var(--grade-bg,#334155);color:var(--grade-fg,#fff);border:1px solid var(--grade-border,transparent)}
.pot-grade.bronze{--grade-bg:rgba(199,122,58,.18);--grade-fg:#e0a675;--grade-border:rgba(199,122,58,.55)}
.pot-grade.silver{--grade-bg:rgba(203,213,225,.16);--grade-fg:#e2e8f0;--grade-border:rgba(203,213,225,.55)}
.pot-grade.gold{--grade-bg:rgba(251,191,36,.18);--grade-fg:#fde68a;--grade-border:rgba(251,191,36,.6)}
.pot-grade.platinum{--grade-bg:rgba(103,232,249,.16);--grade-fg:#a5f3fc;--grade-border:rgba(103,232,249,.6)}
.pot-text{flex:1;line-height:1.4}
.pot-awaken,.pot-reroll-open{width:100%}
.pot-wrap{width:min(420px,100%)!important;max-height:96dvh!important;overflow:hidden!important}
.pot-wrap .enhance-result-overlay{overflow:hidden}
.pot-result-inner{display:flex;flex-direction:column;align-items:center;gap:10px;width:100%}
.jewel-icon-img{width:100%;height:100%;object-fit:contain;filter:drop-shadow(0 1px 3px rgba(0,0,0,.5))}
.jewel-icon-none{color:#64748b;font-size:18px;font-weight:800}
.protect-pick-row.disabled{opacity:.4;cursor:not-allowed;pointer-events:none}
.pot-block.cur{--pot-tier:#94a3b8}.pot-block.old{--pot-tier:#64748b;opacity:.85}.pot-block.new{--pot-tier:#a5b4fc}
/* 잠재능력 재설정 모달 (강화 스타일) */
.pot-mod-head{position:relative;display:flex;flex-direction:column;align-items:center;gap:6px;padding:18px 14px 14px;background:linear-gradient(180deg,rgba(76,29,149,.32),rgba(2,6,23,.5));border-bottom:1px solid rgba(168,85,247,.22);flex-shrink:0}
.pot-mod-head .auc-thumb.square{width:64px!important;height:64px!important}
.pot-mod-title{font-size:14px;font-weight:800;color:#f1f5f9;text-align:center}
.pot-mod-tier{font-size:11px;font-weight:800;color:#c4b5fd;background:rgba(168,85,247,.16);border:1px solid rgba(168,85,247,.4);border-radius:999px;padding:2px 10px}
.enhance-protect.advanced .enhance-protect-icon,.enhance-protect.blessed .enhance-protect-icon{font-size:17px}
.pot-cost-box{display:flex;flex-direction:column;gap:5px;padding:10px 12px;background:linear-gradient(180deg,rgba(24,32,40,.92),rgba(10,14,20,.96));border:1px solid rgba(120,160,180,.14);border-radius:9px}
.pot-cost-line{font-size:13px;font-weight:800;color:#fde68a;display:flex;align-items:center;gap:2px}
.pot-cost-line.lack{color:#fca5a5}
.pot-gold-icon{width:16px;height:16px;object-fit:contain;vertical-align:-3px}
.pot-upg-line{font-size:11px;font-weight:700;color:#c4b5fd}
.pot-confirm-btn{background:linear-gradient(135deg,#7c3aed,#a855f7);border:0;border-radius:8px;min-height:44px;color:#fff;font-weight:900;font-size:15px;letter-spacing:.02em;cursor:pointer;box-shadow:0 6px 18px rgba(124,58,237,.4);transition:filter .15s,transform .1s}
.pot-confirm-btn:hover{filter:brightness(1.12)}
.pot-confirm-btn:active{transform:scale(.97)}
.pot-confirm-btn:disabled{opacity:.4;cursor:not-allowed;box-shadow:none}
.pot-compare{display:grid;grid-template-columns:1fr 1fr;gap:8px;width:100%;max-width:440px}
.pot-compare .pot-block{margin-top:0;text-align:left}
.pot-result-actions{display:flex;gap:8px;width:100%;max-width:440px;margin-top:2px}
.pot-result-actions>button{flex:1}
.pot-result-reveal{opacity:0;animation:enhStatIn .45s cubic-bezier(.2,.8,.3,1) forwards}
.pot-warn{font-size:11px;color:#fca5a5;line-height:1.5;background:rgba(127,29,29,.18);border:1px solid rgba(239,68,68,.3);border-radius:10px;padding:8px 11px;max-width:440px}
@media(max-width:520px){.pot-compare{grid-template-columns:1fr}}
.profile-banner{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:12px 16px;background:linear-gradient(135deg,rgba(251,191,36,.18),rgba(88,101,242,.18));border:1px solid rgba(251,191,36,.4);border-radius:14px;color:#fde68a;font-weight:700}.profile-banner button{padding:8px 12px;font-size:13px}
.event-dice-panel{position:relative;overflow:hidden;min-height:min(720px,calc(100svh - 170px));padding:0;background:#05070d;background-image:linear-gradient(110deg,rgba(4,7,18,.9) 0%,rgba(4,7,18,.66) 42%,rgba(4,7,18,.3) 100%),url('/rpg-ui?file=%EC%A3%BC%EC%82%AC%EC%9C%84PC.png');background-size:cover;background-position:center;display:grid;align-items:stretch}.event-dice-panel::before{content:'';position:absolute;inset:0;background:radial-gradient(circle at 28% 24%,rgba(251,191,36,.22),transparent 32%),linear-gradient(180deg,rgba(255,255,255,.04),transparent 30%,rgba(0,0,0,.38));pointer-events:none}.event-dice-panel>#eventDiceRoot{position:relative;z-index:1;display:grid;grid-template-columns:minmax(280px,420px) minmax(0,1fr);gap:24px;width:100%;padding:clamp(18px,3vw,34px)}.event-dice-main{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;min-width:0}.event-title-block{text-align:center;display:grid;gap:6px}.event-eyebrow,.event-panel-title{font-size:11px;font-weight:900;letter-spacing:.14em;color:#facc15}.event-title-block h2{margin:0;font-size:clamp(24px,4vw,42px);line-height:1;color:#fff;text-shadow:0 4px 22px rgba(0,0,0,.75),0 0 18px rgba(250,204,21,.24)}.event-subcopy{font-size:13px;color:#cbd5e1;font-weight:700}.event-dice-row{display:flex;gap:14px;justify-content:center;align-items:center}.event-die{--die-size:78px;width:var(--die-size);height:var(--die-size);perspective:720px;filter:drop-shadow(0 14px 22px rgba(0,0,0,.55))}.event-die-face{width:100%;height:100%;display:grid;grid-template-columns:repeat(3,1fr);grid-template-rows:repeat(3,1fr);padding:12%;border-radius:16%;background:radial-gradient(circle at 30% 24%,#fff 0%,#f2f4f8 40%,#cfd5df 100%);box-shadow:inset 0 0 0 1px rgba(0,0,0,.08),inset 0 8px 14px rgba(255,255,255,.82),inset 0 -10px 18px rgba(0,0,0,.18);transform:rotateX(-18deg) rotateY(-24deg);transition:transform .18s}.event-die.rolling .event-die-face{animation:eventDiceRoll .28s linear infinite}.event-die-pip,.event-die-empty{display:flex;align-items:center;justify-content:center}.event-die-pip::after{content:'';width:62%;aspect-ratio:1;border-radius:50%;background:radial-gradient(circle at 35% 28%,#4b5563 0%,#111827 68%,#020617 100%);box-shadow:inset 0 2px 3px rgba(0,0,0,.7),0 1px 1px rgba(255,255,255,.42)}@keyframes eventDiceRoll{0%{transform:rotateX(-18deg) rotateY(-24deg) rotateZ(0deg) scale(1)}50%{transform:rotateX(34deg) rotateY(60deg) rotateZ(12deg) scale(1.05)}100%{transform:rotateX(-18deg) rotateY(336deg) rotateZ(0deg) scale(1)}}.event-result-card{width:min(390px,100%);min-height:128px;padding:16px;background:rgba(4,6,18,.72);border:1px solid rgba(255,255,255,.11);border-radius:16px;box-shadow:0 16px 40px rgba(0,0,0,.35);display:grid;gap:9px;text-align:center;backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px)}.event-result-card.hit{border-color:rgba(250,204,21,.46);box-shadow:0 18px 46px rgba(0,0,0,.42),0 0 24px rgba(250,204,21,.14)}.event-result-kicker{font-size:10px;font-weight:900;letter-spacing:.16em;color:#94a3b8}.event-result-title{font-size:22px;font-weight:900;color:#f8fafc}.event-result-sub{font-size:13px;color:#94a3b8;line-height:1.45}.event-result-reward{display:grid;grid-template-columns:64px 1fr;gap:12px;align-items:center;text-align:left}.event-result-reward-name{font-size:16px;font-weight:900;color:#fde68a}.event-result-reward-count{font-size:13px;font-weight:800;color:#e2e8f0}.event-roll-btn{width:min(320px,100%);padding:15px 18px;font-size:16px;font-weight:900;box-shadow:0 12px 28px rgba(88,101,242,.42)}.event-dice-side{min-width:0;align-self:stretch;display:flex;flex-direction:column;gap:12px;padding:16px;background:rgba(5,8,18,.72);border:1px solid rgba(255,255,255,.09);border-radius:18px;backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px)}.event-reward-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}.event-reward-cell{min-width:0;padding:9px 7px;background:rgba(4,6,18,.66);border:1px solid rgba(255,255,255,.08);border-radius:12px;text-align:center;display:grid;justify-items:center;gap:5px;transition:transform .12s,border-color .15s,box-shadow .15s}.event-reward-cell.active{border-color:rgba(250,204,21,.68);box-shadow:0 0 0 1px rgba(250,204,21,.16) inset,0 0 18px rgba(250,204,21,.18);transform:translateY(-1px)}.event-reward-sum{font-size:15px;font-weight:900;color:#f8fafc;font-variant-numeric:tabular-nums}.event-reward-thumb{position:relative;width:42px;height:42px;display:grid;place-items:center}.event-reward-thumb.large{width:60px;height:60px}.event-reward-frame{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;z-index:1}.event-reward-icon{position:relative;z-index:3;width:100%;height:100%;object-fit:contain;filter:drop-shadow(0 3px 7px rgba(0,0,0,.58))}.event-reward-fallback{position:relative;z-index:2;font-size:18px;font-weight:900;color:#475569}.event-reward-name{width:100%;font-size:10px;font-weight:800;color:#cbd5e1;line-height:1.25;word-break:keep-all;overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.event-reward-count{font-size:10px;font-weight:900;color:#facc15}.event-history-title{margin-top:4px}.event-history-empty{padding:16px;text-align:center;color:#64748b;font-size:12px;background:rgba(4,6,18,.42);border:1px dashed rgba(148,163,184,.2);border-radius:12px}.event-history-list{display:grid;gap:6px}.event-history-row{display:grid;grid-template-columns:34px 70px 1fr;gap:8px;align-items:center;padding:8px 10px;background:rgba(4,6,18,.52);border:1px solid rgba(255,255,255,.06);border-radius:10px;font-size:12px}.event-history-sum{font-size:15px;font-weight:900;color:#fde68a}.event-history-dice{color:#94a3b8;font-variant-numeric:tabular-nums}.event-history-reward{font-weight:800;color:#e2e8f0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rank-section{display:grid;gap:14px}.rank-tabs{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px}.rank-tab{padding:9px 14px;border-radius:10px;background:rgba(20,28,46,.8);color:#94a3b8;cursor:pointer;font-weight:700;font-size:13px;border:1px solid rgba(255,255,255,.07);transition:all .15s}.rank-tab.active{background:linear-gradient(135deg,#5865f2,#4338ca);color:#fff;border-color:transparent;box-shadow:0 4px 12px rgba(88,101,242,.32)}
.rank-me{padding:14px 16px;background:linear-gradient(135deg,rgba(88,101,242,.15),rgba(4,6,18,.7));border:1px solid rgba(88,101,242,.4);border-radius:14px;display:grid;grid-template-columns:auto 1fr auto auto;gap:14px;align-items:center;font-weight:700;box-shadow:0 4px 16px rgba(88,101,242,.15)}.rank-me .rk{font-size:22px;color:#a5b4fc}.rank-me .nm{font-size:15px;color:#f8fafc}.rank-me .lv{font-size:12px;color:#94a3b8}.rank-me .vl{font-size:18px;color:#fbbf24;font-variant-numeric:tabular-nums}
.title-badge{height:16px;width:auto;vertical-align:-3px;margin-right:4px;image-rendering:auto}
.rank-list{display:grid;gap:8px}.rank-row{display:grid;grid-template-columns:60px 1fr auto;align-items:center;gap:12px;padding:12px 14px;background:rgba(4,6,18,.6);border:1px solid rgba(255,255,255,.06);border-radius:12px;cursor:pointer;transition:transform .12s,border-color .12s,background .12s,box-shadow .12s}.rank-row:hover{transform:translateX(3px);border-color:rgba(88,101,242,.5);background:rgba(88,101,242,.1);box-shadow:0 4px 14px rgba(88,101,242,.15)}.rank-row.me{border-color:#fbbf24;background:rgba(251,191,36,.08)}.rank-row .rk{font-size:16px;font-weight:800;color:#a5b4fc;text-align:center}.rank-row .rk.gold{color:#fbbf24;font-size:22px}.rank-row .rk.silver{color:#cbd5e1;font-size:20px}.rank-row .rk.bronze{color:#d97706;font-size:18px}.rank-row .nm{font-weight:700;color:#f1f5f9}.rank-row .lv{font-size:12px;color:#94a3b8;margin-left:6px}.rank-row .vl{font-weight:800;color:#fbbf24;font-variant-numeric:tabular-nums;font-size:15px}
.dex-tabs{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px}.dex-tab{padding:9px 14px;border-radius:10px;background:rgba(20,28,46,.8);color:#94a3b8;cursor:pointer;font-weight:700;font-size:13px;border:1px solid rgba(255,255,255,.07);transition:all .15s}.dex-tab.active{background:linear-gradient(135deg,#5865f2,#4338ca);color:#fff;border-color:transparent;box-shadow:0 4px 12px rgba(88,101,242,.32)}
.dex-pot-row{display:flex;gap:8px;align-items:flex-start;padding:4px 0;font-size:12.5px;line-height:1.5}.dex-pot-rate{flex:0 0 auto;min-width:46px;text-align:center;font-weight:800;color:#c4b5fd;background:rgba(168,85,247,.14);border:1px solid rgba(168,85,247,.3);border-radius:7px;padding:2px 6px}.dex-pot-opts{flex:1;color:#cbd5e1}
.dex-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:14px}
.dex-title-grid{grid-template-columns:repeat(auto-fill,minmax(200px,1fr))}
.dex-title-card{display:flex;flex-direction:column;align-items:center;gap:8px;padding:18px 14px;background:linear-gradient(135deg,rgba(4,6,18,.9),rgba(8,12,26,.75));border:1px solid rgba(255,255,255,.08);border-radius:14px;text-align:center;transition:border-color .15s,box-shadow .15s}
.dex-title-card.equipped{border-color:#fbbf24;box-shadow:0 0 18px rgba(251,191,36,.18)}
.dex-title-card.locked{opacity:.55;filter:grayscale(.7)}
.dex-title-thumb{height:40px;display:flex;align-items:center;justify-content:center}
.dex-title-thumb img{max-height:40px;width:auto}
.dex-title-name{font-weight:900;font-size:16px;color:#f8fafc}
.dex-title-stats{display:flex;flex-direction:column;gap:2px;font-size:12px;color:#86efac;font-weight:700;line-height:1.4}
.dex-title-cond{font-size:11px;color:#94a3b8;line-height:1.4}
.dex-title-status.locked{font-size:12px;color:#f87171;font-weight:700;margin-top:2px}
.dex-title-prog{display:flex;flex-direction:column;gap:4px;width:100%;margin-top:2px}
.dex-title-prog-bar{position:relative;height:8px;background:rgba(0,0,0,.5);border-radius:999px;overflow:hidden;border:1px solid rgba(148,163,184,.18)}
.dex-title-prog-bar .fill{position:absolute;left:0;top:0;bottom:0;width:0%;border-radius:999px;background:linear-gradient(90deg,#5865f2,#7c3aed);transition:width .2s}
.dex-title-prog-text{font-size:11px;color:#94a3b8;font-weight:700;text-align:center;font-variant-numeric:tabular-nums}
.dex-title-btn{margin-top:4px;padding:8px 16px;border:1px solid rgba(88,101,242,.5);border-radius:9px;background:rgba(88,101,242,.15);color:#c7d2fe;font-weight:800;font-size:13px;cursor:pointer;transition:all .15s}
.dex-title-btn:hover{background:rgba(88,101,242,.3)}
.dex-title-btn.on{border-color:#fbbf24;background:rgba(251,191,36,.15);color:#fde68a}
.dex-title-btn:disabled{opacity:.5;cursor:wait}
.dex-card{display:grid;gap:12px;padding:14px;background:linear-gradient(135deg,rgba(4,6,18,.9),rgba(8,12,26,.75));border:1px solid var(--rar,rgba(255,255,255,.08));border-left:4px solid var(--rar,rgba(255,255,255,.15));border-radius:14px;box-shadow:0 8px 24px rgba(0,0,0,.3)}
.dex-char-toggle{display:flex;gap:6px}.dex-char-toggle-btn{flex:1;padding:5px 0;border:1px solid rgba(255,255,255,.12);border-radius:8px;background:rgba(255,255,255,.04);color:rgba(255,255,255,.45);font-size:.8rem;cursor:pointer;transition:background .15s,color .15s}.dex-char-toggle-btn.active{background:rgba(88,101,242,.25);border-color:#5865f2;color:#c7d0ff;font-weight:700}
.dex-head{display:grid;grid-template-columns:72px 1fr;gap:12px;align-items:center}
.dex-thumb{position:relative;width:72px;height:72px;background:rgba(15,23,42,.7);border-radius:10px;overflow:visible}.dex-thumb .frame{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;z-index:1}.dex-thumb .icon{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);z-index:2;width:124%;height:124%;object-fit:contain;filter:drop-shadow(0 4px 8px rgba(0,0,0,.55))}.dex-thumb .icon-fallback{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);z-index:2;font-size:56px;line-height:1}
.dex-name{font-weight:800;font-size:16px;color:#f8fafc}.dex-meta{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:4px}.dex-desc{color:#94a3b8;font-size:13px;line-height:1.5}
.dex-stat-block{padding:10px 12px;background:rgba(2,6,23,.5);border:1px solid rgba(148,163,184,.12);border-radius:10px;display:grid;gap:4px;font-size:13px;color:#cbd5e1}.dex-stat-title{font-weight:800;color:#f1f5f9;font-size:12px;letter-spacing:.04em;text-transform:uppercase}
.dex-passive{padding:10px 12px;background:rgba(124,58,237,.08);border:1px solid rgba(124,58,237,.35);border-radius:10px;display:grid;gap:5px}.dex-passive-label{font-weight:800;font-size:12px;letter-spacing:.04em;color:#c4b5fd;display:flex;align-items:center;gap:6px}.dex-passive-label::before{content:'';display:inline-block;width:6px;height:6px;border-radius:50%;background:#7c3aed;flex-shrink:0}.dex-passive-desc{font-size:13px;color:#ddd6fe;line-height:1.5}.dex-passive-cd{font-size:11px;color:#a78bfa}
.lockbox-overlay{position:fixed;inset:0;z-index:80;display:none;background:#04060d}.lockbox-overlay.active{display:block}#lockboxVideo{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;mix-blend-mode:screen}.lockbox-skip-btn{position:absolute;top:16px;left:16px;z-index:2;padding:7px 16px;background:rgba(0,0,0,.5);border:1px solid rgba(255,255,255,.28);border-radius:8px;color:rgba(255,255,255,.85);font-size:13px;font-weight:700;cursor:pointer;transition:background .15s,color .15s}.lockbox-skip-btn:hover{background:rgba(0,0,0,.78);color:#fff}
.lockbox-result-overlay{position:fixed;inset:0;z-index:90;display:none;flex-direction:column;align-items:center;justify-content:safe center;background:radial-gradient(ellipse at 50% 35%,rgba(20,10,50,.98),rgba(4,6,18,1));padding:24px;overflow-y:auto}.lockbox-result-overlay.active{display:flex}
.lockbox-result-title{font-size:22px;font-weight:900;color:#e2d5ff;letter-spacing:.12em;text-align:center;text-shadow:0 0 32px rgba(139,92,246,.7),0 0 10px rgba(139,92,246,.4);margin-bottom:4px}.lockbox-result-sub{font-size:13px;color:#6d5fa0;margin-bottom:22px;letter-spacing:.04em;text-align:center}
.lockbox-rewards-grid{display:flex;flex-direction:column;gap:10px;width:100%;max-width:340px;margin-bottom:24px}.lockbox-bonus-divider{width:100%;max-width:340px;display:flex;align-items:center;gap:10px;margin:2px 0 14px;color:#a78bfa;font-size:11px;font-weight:800;letter-spacing:.14em}.lockbox-bonus-divider::before,.lockbox-bonus-divider::after{content:'';flex:1;height:1px;background:linear-gradient(90deg,transparent,rgba(139,92,246,.4),transparent)}.lockbox-reward-row.bonus{border-color:rgba(250,204,21,.32);background:rgba(40,30,8,.55);box-shadow:0 2px 14px rgba(202,138,4,.12),inset 0 1px 0 rgba(255,255,255,.05)}.lockbox-reward-row.bonus .lockbox-reward-name{color:#fde68a}.lockbox-reward-row.bonus .lockbox-reward-count{color:#facc15}.lockbox-reward-row.bonus .lockbox-reward-thumb{border-color:rgba(250,204,21,.3)}.lockbox-reward-row{display:flex;align-items:center;gap:12px;padding:12px 14px;background:rgba(20,10,50,.7);border:1px solid rgba(139,92,246,.22);border-radius:14px;box-shadow:0 2px 14px rgba(109,40,217,.12),inset 0 1px 0 rgba(255,255,255,.04);animation:lbRewardIn .45s cubic-bezier(.2,.8,.3,1) both}@keyframes lbRewardIn{0%{opacity:0;transform:translateY(14px) scale(.95)}100%{opacity:1;transform:none}}
.lockbox-reward-thumb{position:relative;width:52px;height:52px;flex-shrink:0;background:rgba(15,10,35,.8);border-radius:10px;overflow:visible;border:1px solid rgba(139,92,246,.2)}.lockbox-reward-thumb .lb-frame{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;z-index:1}.lockbox-reward-thumb .lb-icon{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);z-index:2;width:68%;height:68%;object-fit:contain;filter:drop-shadow(0 3px 8px rgba(0,0,0,.65))}
.lockbox-reward-info{flex:1;min-width:0}.lockbox-reward-name{font-size:14px;font-weight:800;color:#e9d5ff;word-break:break-word;line-height:1.3}.lockbox-reward-count{font-size:12px;color:#a78bfa;font-weight:700;margin-top:3px}
.lockbox-result-close{padding:13px 36px;border-radius:12px;font-size:15px;font-weight:800;background:linear-gradient(135deg,rgba(109,40,217,.85),rgba(79,70,229,.85));border:1px solid rgba(139,92,246,.5);color:#ede9fe;cursor:pointer;box-shadow:0 4px 20px rgba(109,40,217,.4),inset 0 1px 0 rgba(255,255,255,.15);transition:filter .15s,transform .1s;letter-spacing:.06em}.lockbox-result-close:hover{filter:brightness(1.15)}.lockbox-result-close:active{transform:scale(.96)}
.lockbox-opens{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;width:100%;max-width:680px;margin-bottom:22px}
.lockbox-open-card{background:rgba(20,10,50,.6);border:1px solid rgba(139,92,246,.22);border-radius:14px;padding:10px 12px;box-shadow:0 2px 14px rgba(109,40,217,.1),inset 0 1px 0 rgba(255,255,255,.04);animation:lbRewardIn .45s cubic-bezier(.2,.8,.3,1) both}
.lockbox-open-no{font-size:11px;font-weight:900;color:#a78bfa;letter-spacing:.08em;margin-bottom:8px}
.lockbox-open-body{display:flex;flex-direction:column;gap:7px}
.lockbox-mini{display:flex;align-items:center;gap:9px}
.lockbox-mini-tag{flex-shrink:0;width:38px;text-align:center;font-size:9px;font-weight:900;padding:3px 0;border-radius:6px;background:rgba(139,92,246,.2);color:#c4b5fd;letter-spacing:.02em}
.lockbox-mini.bonus .lockbox-mini-tag{background:rgba(250,204,21,.18);color:#fde68a}
.lockbox-mini-thumb{position:relative;width:38px;height:38px;flex-shrink:0;background:rgba(15,10,35,.8);border-radius:9px;border:1px solid rgba(139,92,246,.2)}
.lockbox-mini.bonus .lockbox-mini-thumb{border-color:rgba(250,204,21,.3)}
.lockbox-mini-thumb .lb-frame{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;z-index:1}
.lockbox-mini-thumb .lb-icon{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);z-index:2;width:70%;height:70%;object-fit:contain;filter:drop-shadow(0 2px 6px rgba(0,0,0,.6))}
.lockbox-mini-info{flex:1;min-width:0}
.lockbox-mini-name{font-size:12px;font-weight:800;color:#e9d5ff;line-height:1.25;word-break:break-word}
.lockbox-mini.bonus .lockbox-mini-name{color:#fde68a}
.lockbox-mini-count{font-size:11px;color:#a78bfa;font-weight:700;margin-top:1px}
.lockbox-mini.bonus .lockbox-mini-count{color:#facc15}
@media(max-width:560px){.lockbox-opens{grid-template-columns:1fr;max-width:380px}}
.dex-collapse{background:rgba(2,6,23,.4);border:1px solid rgba(148,163,184,.12);border-radius:10px}.dex-collapse>summary{cursor:pointer;padding:10px 12px;font-weight:700;color:#e5e7eb;font-size:13px;list-style:none}.dex-collapse>summary::-webkit-details-marker{display:none}.dex-collapse>summary::before{content:'▶';display:inline-block;margin-right:8px;transition:transform .15s;color:#94a3b8;font-size:10px}.dex-collapse[open]>summary::before{transform:rotate(90deg)}.dex-upgrade-list{display:grid;gap:6px;padding:0 12px 12px}
.dex-upgrade-row{display:grid;grid-template-columns:46px 1fr;gap:8px;padding:8px 10px;background:rgba(2,6,23,.55);border:1px solid rgba(148,163,184,.1);border-radius:8px;font-size:12px}.dex-upgrade-row .lvl{font-weight:800;color:#fbbf24;font-variant-numeric:tabular-nums}.dex-upgrade-row .lines{display:grid;gap:2px;color:#cbd5e1}
.dex-evol,.dex-recipe{display:grid;gap:8px;padding:10px 12px;background:rgba(88,101,242,.08);border:1px solid rgba(88,101,242,.3);border-radius:10px}.dex-recipe{background:rgba(34,197,94,.08);border-color:rgba(34,197,94,.3)}
.dex-evol-title,.dex-recipe-title{font-weight:800;font-size:12px;letter-spacing:.04em;text-transform:uppercase;color:#a5b4fc}.dex-recipe-title{color:#86efac}
.dex-evol-target,.dex-recipe-mat{display:grid;grid-template-columns:42px 1fr auto;gap:10px;align-items:center;padding:6px 8px;background:rgba(2,6,23,.55);border-radius:8px;font-size:13px}
.dex-evol-thumb,.dex-mat-thumb{position:relative;width:42px;height:42px;background:rgba(15,23,42,.7);border-radius:8px;overflow:visible}.dex-evol-thumb .frame,.dex-mat-thumb .frame{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;z-index:1}.dex-evol-thumb .icon,.dex-mat-thumb .icon{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);z-index:2;width:124%;height:124%;object-fit:contain;filter:drop-shadow(0 3px 6px rgba(0,0,0,.5))}.dex-evol-thumb .icon-fallback,.dex-mat-thumb .icon-fallback{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);z-index:2;font-size:32px;line-height:1}
.dex-mat-count{font-weight:800;color:#fbbf24;font-variant-numeric:tabular-nums}
.auction-bar{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:14px}.auction-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px}.auc-card{position:relative;display:flex;flex-direction:column;gap:8px;padding:14px;background:rgba(4,6,18,.65);border:1px solid rgba(255,255,255,.07);border-radius:16px;cursor:pointer;transition:transform .12s,box-shadow .12s,border-color .12s}.auc-card:hover{transform:translateY(-2px);box-shadow:0 14px 36px rgba(0,0,0,.45),0 0 0 1px rgba(88,101,242,.3);border-color:rgba(88,101,242,.45)}.auc-card.mine{border-color:#fbbf24}.auc-thumb{aspect-ratio:3/4;display:grid;place-items:center;background:rgba(15,23,42,.7);border-radius:10px;font-size:64px;overflow:hidden}.auc-thumb.square{aspect-ratio:1/1;position:relative;background:transparent}.auc-thumb img{width:100%;height:100%;object-fit:contain}.auc-thumb.card{background:transparent}.auc-frame{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;z-index:1}.auc-icon,.auc-item-img{position:relative;z-index:2}.auc-icon{font-size:64px;line-height:1;text-shadow:0 4px 14px rgba(0,0,0,.6)}.auc-item-img{width:100%;height:100%;object-fit:contain;filter:drop-shadow(0 6px 10px rgba(0,0,0,.55))}.currency-img{width:20px;height:20px;object-fit:contain;vertical-align:-4px;margin-right:5px}.auc-name{font-weight:800;font-size:15px;color:#f8fafc;line-height:1.3;word-break:break-word}.auc-sub{font-size:12px;color:#94a3b8}.auc-price{display:flex;justify-content:space-between;align-items:center;font-weight:800;font-size:15px;color:#fbbf24}.auc-seller{font-size:11px;color:#64748b}.auc-mine-badge{position:absolute;top:8px;right:8px;background:#fbbf24;color:#0f172a;font-size:11px;font-weight:800;padding:3px 7px;border-radius:999px}.tag{display:inline-block;padding:3px 8px;border-radius:999px;background:#263244;color:#cbd5e1;font-size:12px;font-weight:700}.tag.rarity{color:#fff;background:var(--rar,#334155)}.tag.on{background:#14532d;color:#bbf7d0}.empty,.loading{padding:24px;text-align:center;color:#94a3b8}.err{color:#f87171}.section-row{display:grid;grid-template-columns:1fr 1fr;gap:18px}
@media(max-width:860px){.profile-hero,.section-row{grid-template-columns:1fr}header{padding:12px 14px;gap:8px}.top-left{flex:1 1 auto;min-width:0;gap:10px}.bar{flex:0 0 auto;gap:6px}.group-tabs{display:none}.bottom-tabs{display:flex}main{padding-bottom:74px}.subnav-bar{padding:0 14px}.who{max-width:36vw;font-size:13px;line-height:1.2}.grid{grid-template-columns:1fr}}
.patch-wrap{display:grid;gap:14px}.patch-editor{display:none;gap:8px;padding:14px;background:rgba(4,6,18,.65);border:1px solid rgba(255,255,255,.08);border-radius:14px}.patch-editor.active{display:grid}.patch-editor input,.patch-editor textarea,.reply-box textarea{width:100%;padding:10px 12px;background:rgba(4,6,14,.85);border:1px solid rgba(255,255,255,.1);border-radius:10px;color:#e5e7eb;outline:none;transition:border-color .15s}.patch-editor textarea,.reply-box textarea{min-height:140px;resize:vertical;line-height:1.5}.patch-list{display:grid;gap:14px}.patch-card{display:grid;gap:12px;padding:16px;background:linear-gradient(135deg,rgba(4,6,18,.9),rgba(8,12,26,.75));border:1px solid rgba(255,255,255,.07);border-radius:16px;transition:border-color .15s}.patch-card:hover{border-color:rgba(255,255,255,.12)}.patch-title{font-size:18px;font-weight:900;color:#f8fafc}.patch-date{font-size:12px;color:#94a3b8}.markdown-body{line-height:1.65;color:#dbeafe;word-break:break-word}.markdown-body h1,.markdown-body h2,.markdown-body h3{color:#f8fafc;margin:14px 0 8px}.markdown-body p{margin:8px 0}.markdown-body ul,.markdown-body ol{padding-left:22px}.markdown-body code{background:rgba(15,23,42,.9);border:1px solid rgba(148,163,184,.18);border-radius:6px;padding:1px 5px}.markdown-body pre{background:#020617;border:1px solid rgba(148,163,184,.18);border-radius:10px;padding:12px;overflow:auto}.reply-list{display:grid;gap:8px}.reply-item{display:grid;gap:7px;padding:10px 12px;background:rgba(2,6,23,.5);border:1px solid rgba(148,163,184,.1);border-radius:10px}.reply-item.child{margin-left:22px}.reply-meta{font-size:12px;color:#94a3b8}.reply-meta b{color:#f8fafc}.reply-text{white-space:pre-wrap;line-height:1.5}.reply-box{display:grid;gap:8px}.reply-box textarea{min-height:70px}
.search-input{padding:8px 10px;background:rgba(4,6,14,.85);border:1px solid rgba(255,255,255,.1);border-radius:8px;color:#e5e7eb;font-size:13px;outline:none;min-width:140px;transition:border-color .15s}.search-input:focus{border-color:rgba(99,102,241,.6)}
.reg-kind-row{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-bottom:2px}.reg-kind-btn{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:5px;padding:10px 4px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(4,6,18,.6);color:#64748b;font-size:11px;font-weight:700;cursor:pointer;transition:all .15s;letter-spacing:.02em;line-height:1.2;text-align:center}.reg-kind-btn svg{width:18px;height:18px;display:block;flex-shrink:0;transition:filter .15s}.reg-kind-btn:hover{background:rgba(255,255,255,.06);color:#e5e7eb}.reg-kind-btn.active{background:rgba(88,101,242,.2);border-color:rgba(99,102,241,.45);color:#e5e7eb;box-shadow:0 0 0 1px rgba(99,102,241,.15)}.reg-kind-btn.active svg{filter:drop-shadow(0 0 3px rgba(129,140,248,.55))}
.reg-pick-scroll{display:grid;gap:6px;max-height:236px;overflow-y:auto;padding:2px;scrollbar-width:thin;scrollbar-color:rgba(99,102,241,.3) transparent}.reg-pick-scroll::-webkit-scrollbar{width:4px}.reg-pick-scroll::-webkit-scrollbar-thumb{background:rgba(99,102,241,.3);border-radius:2px}.reg-pick-row{display:grid;grid-template-columns:auto 1fr auto;gap:10px;align-items:center;padding:10px 12px;border:1px solid rgba(255,255,255,.07);border-radius:12px;background:rgba(4,6,18,.6);cursor:pointer;transition:all .12s}.reg-pick-row:hover{border-color:rgba(99,102,241,.4);background:rgba(88,101,242,.08)}.reg-pick-row.selected{border-color:rgba(99,102,241,.6);background:rgba(88,101,242,.14);box-shadow:0 0 0 1px rgba(99,102,241,.14) inset}.reg-thumb{width:57px;height:76px;border-radius:8px;overflow:hidden;background:rgba(2,6,23,.8);display:grid;place-items:center;flex-shrink:0;position:relative}.reg-thumb.sq{height:57px}.reg-thumb img.reg-card-img{width:100%;height:100%;object-fit:cover}.reg-thumb-frame{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;z-index:1}.reg-thumb-icon{position:relative;z-index:2;width:90%;height:90%;object-fit:contain;filter:drop-shadow(0 2px 8px rgba(0,0,0,.6))}.reg-thumb svg{width:28px;height:28px;display:block;opacity:.7;position:relative;z-index:2}.reg-item-name{font-weight:700;font-size:13px;color:#f1f5f9;line-height:1.3}.reg-item-meta{font-size:11px;color:#64748b;margin-top:2px;line-height:1.4;white-space:pre-line}.reg-check{width:20px;height:20px;border-radius:50%;border:1.5px solid rgba(255,255,255,.14);display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:all .15s}.reg-check.sel{background:#6366f1;border-color:#6366f1}.reg-check svg{width:11px;height:11px}
.reg-currency-row{display:flex;gap:6px}.reg-curr-btn{flex:1;padding:11px 8px;border:1px solid rgba(255,255,255,.1);border-radius:10px;background:rgba(4,6,18,.6);color:#94a3b8;font-weight:700;font-size:13px;cursor:pointer;transition:all .15s;display:flex;align-items:center;justify-content:center;gap:7px}.reg-curr-btn img{width:20px;height:20px;object-fit:contain;display:block;flex-shrink:0}.reg-curr-btn:hover{border-color:rgba(255,255,255,.2);color:#e5e7eb}.reg-curr-btn.gold.active{background:rgba(251,191,36,.14);border-color:rgba(251,191,36,.55);color:#fde68a;box-shadow:0 0 8px rgba(251,191,36,.12)}.reg-curr-btn.garnet.active{background:rgba(167,139,250,.14);border-color:rgba(167,139,250,.55);color:#ddd6fe;box-shadow:0 0 8px rgba(167,139,250,.12)}
.reg-price-wrap{display:flex;align-items:center;gap:10px;padding:0 14px;background:rgba(4,6,14,.85);border:1px solid rgba(255,255,255,.1);border-radius:11px;transition:border-color .15s,box-shadow .15s}.reg-price-wrap:focus-within{border-color:rgba(99,102,241,.6);box-shadow:0 0 0 3px rgba(99,102,241,.1)}.reg-price-icon{flex-shrink:0;display:flex;align-items:center}.reg-price-icon img{width:22px;height:22px;object-fit:contain;display:block}.reg-price-field{flex:1;min-width:0;padding:14px 0;background:transparent;border:0;outline:none;color:#f8fafc;font-size:20px;font-weight:800;font-variant-numeric:tabular-nums}
.bo-img-wrap{display:flex;flex-direction:column;gap:6px}.bo-search-inp{width:100%;box-sizing:border-box;padding:9px 13px;background:rgba(4,6,18,.8);border:1px solid rgba(255,255,255,.1);border-radius:10px;color:#e5e7eb;font-size:13px;font-weight:600;outline:none;transition:border-color .15s}.bo-search-inp:focus{border-color:rgba(99,102,241,.6);box-shadow:0 0 0 2px rgba(99,102,241,.1)}.bo-search-inp::placeholder{color:#475569}.bo-search-inp::-webkit-search-cancel-button{cursor:pointer}
.bo-img-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(72px,1fr));gap:6px;max-height:260px;overflow-y:auto;padding:2px;scrollbar-width:thin;scrollbar-color:rgba(99,102,241,.3) transparent}.bo-img-grid::-webkit-scrollbar{width:4px}.bo-img-grid::-webkit-scrollbar-thumb{background:rgba(99,102,241,.3);border-radius:2px}.bo-img-cell{display:flex;flex-direction:column;align-items:center;gap:5px;padding:7px 4px 8px;border:1.5px solid rgba(255,255,255,.07);border-radius:12px;background:rgba(4,6,18,.6);cursor:pointer;transition:all .12s;text-align:center}.bo-img-cell:hover{border-color:rgba(99,102,241,.4);background:rgba(88,101,242,.08)}.bo-img-cell.selected{border-color:rgba(99,102,241,.7);background:rgba(88,101,242,.18);box-shadow:0 0 0 1px rgba(99,102,241,.18) inset}.bo-img-thumb{width:52px;height:52px;position:relative;flex-shrink:0;display:grid;place-items:center;border-radius:8px;overflow:hidden;background:rgba(2,6,23,.6)}.bo-img-thumb img{position:absolute;inset:0;width:100%;height:100%}.bo-img-thumb .bo-img-frame{object-fit:contain;z-index:1}.bo-img-thumb .bo-img-icon{object-fit:contain;z-index:2}.bo-img-thumb img:only-child{object-fit:cover;position:static;width:100%;height:100%;object-fit:contain}.bo-img-fallback{font-size:18px;font-weight:900;color:#475569;line-height:1}.bo-img-name{font-size:10px;font-weight:700;color:#94a3b8;line-height:1.3;word-break:keep-all;max-width:100%;overflow-wrap:anywhere}.bo-img-cell.selected .bo-img-name{color:#e2e8f0}.bo-img-empty{grid-column:1/-1;text-align:center;padding:20px 0;color:#475569;font-size:12px}
.reg-section-label{font-size:11px;font-weight:800;color:#64748b;letter-spacing:.06em;text-transform:uppercase;margin:12px 0 6px}.reg-divider{height:1px;background:rgba(255,255,255,.06);margin:14px 0}.reg-count-row{display:flex;align-items:center;gap:8px}.reg-count-row input{flex:1;padding:10px 12px;background:rgba(4,6,14,.85);border:1px solid rgba(255,255,255,.1);border-radius:10px;color:#e5e7eb;font-size:15px;font-weight:700;font-variant-numeric:tabular-nums;outline:none;transition:border-color .15s}.reg-count-row input:focus{border-color:rgba(99,102,241,.6)}.reg-count-hint{font-size:12px;color:#64748b;flex-shrink:0;white-space:nowrap}.reg-inline-err{font-size:12px;color:#fca5a5;padding:8px 12px;background:rgba(220,38,38,.1);border:1px solid rgba(220,38,38,.3);border-radius:8px;display:none;margin-top:6px}.reg-inline-err.visible{display:block}.reg-footer{display:grid;grid-template-columns:1fr 2fr;gap:8px;margin-top:14px}
.reg-equip-row{display:grid;grid-template-columns:repeat(4,1fr);gap:5px}.reg-equip-btn{display:flex;flex-direction:column;align-items:center;gap:4px;padding:8px 4px;border:1px solid rgba(255,255,255,.08);border-radius:10px;background:rgba(4,6,18,.6);color:#64748b;font-size:11px;font-weight:700;cursor:pointer;transition:all .15s}.reg-equip-btn svg{width:16px;height:16px;display:block;flex-shrink:0}.reg-equip-btn:hover{background:rgba(255,255,255,.06);color:#e5e7eb}.reg-equip-btn.active{background:rgba(88,101,242,.2);border-color:rgba(99,102,241,.4);color:#e5e7eb}.reg-equip-btn.active svg{filter:drop-shadow(0 0 3px rgba(129,140,248,.5))}.reg-level-toggle{display:flex;align-items:center;gap:8px;padding:10px 12px;background:rgba(4,6,18,.5);border:1px solid rgba(255,255,255,.07);border-radius:10px;cursor:pointer;font-size:13px;font-weight:600;color:#94a3b8;transition:all .15s;user-select:none}.reg-level-toggle:hover{color:#e5e7eb;border-color:rgba(255,255,255,.14)}.reg-level-toggle input[type=checkbox]{accent-color:#6366f1;width:15px;height:15px;cursor:pointer}
/* ── 상점 ── */
.shop-wrap{display:flex;flex-direction:column;gap:0;min-height:0;min-width:0;width:100%}
.shop-tabs{display:flex;gap:4px;padding:0 0 14px;overflow-x:auto;-webkit-overflow-scrolling:touch;scrollbar-width:none;flex-wrap:nowrap;min-width:0;width:100%}.shop-tabs::-webkit-scrollbar{display:none}
.shop-tab{padding:7px 16px;border-radius:20px;border:1px solid rgba(255,255,255,.09);background:rgba(4,6,18,.5);color:#64748b;font-size:13px;font-weight:700;cursor:pointer;transition:all .18s;white-space:nowrap;flex-shrink:0}
.shop-tab:hover{color:#e2e8f0;background:rgba(255,255,255,.06)}
.shop-tab.active{background:rgba(88,101,242,.22);border-color:rgba(99,102,241,.5);color:#e0e7ff}
.shop-currency-bar{display:flex;gap:6px;align-items:center;overflow-x:auto;flex-wrap:nowrap;-webkit-overflow-scrolling:touch;scrollbar-width:none;padding-bottom:10px;min-width:0;width:100%}.shop-currency-bar::-webkit-scrollbar{display:none}
.shop-currency-chip{display:flex;align-items:center;gap:5px;padding:5px 11px;border-radius:16px;background:rgba(4,6,18,.7);border:1px solid rgba(255,255,255,.08);font-size:13px;font-weight:700;font-variant-numeric:tabular-nums;color:#e2e8f0;flex-shrink:0;white-space:nowrap}
.shop-currency-chip img{width:16px;height:16px;object-fit:contain;display:block;flex-shrink:0}
.shop-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(148px,1fr));gap:12px}
.shop-card{position:relative;display:flex;flex-direction:column;align-items:center;gap:0;padding:16px 12px 12px;border-radius:16px;border:1px solid rgba(255,255,255,.07);background:linear-gradient(160deg,rgba(10,14,40,.9) 0%,rgba(4,6,18,.95) 100%);cursor:pointer;transition:all .2s;overflow:hidden}
.shop-card::before{content:'';position:absolute;inset:0;border-radius:16px;background:radial-gradient(ellipse at 50% 0%,rgba(99,102,241,.12) 0%,transparent 70%);opacity:0;transition:opacity .2s}
.shop-card:hover::before{opacity:1}
.shop-card:hover{border-color:rgba(99,102,241,.35);transform:translateY(-2px);box-shadow:0 8px 24px rgba(0,0,0,.4)}
.shop-card.sold-out{opacity:.45;cursor:default;pointer-events:none}
.shop-card-thumb{width:72px;height:72px;border-radius:12px;overflow:hidden;background:rgba(2,6,23,.8);display:grid;place-items:center;flex-shrink:0;position:relative;margin-bottom:10px}
.shop-card-thumb-frame{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;z-index:1}
.shop-card-thumb-icon{position:relative;z-index:2;width:100%;height:100%;object-fit:contain;filter:drop-shadow(0 2px 8px rgba(0,0,0,.6))}
.shop-card-thumb-curr{position:relative;z-index:2;width:64%;height:64%;object-fit:contain;filter:drop-shadow(0 2px 10px rgba(0,0,0,.7))}
.shop-card-thumb svg{width:32px;height:32px;display:block;opacity:.7;position:relative;z-index:2}
.shop-card-name{font-size:13px;font-weight:700;color:#e2e8f0;text-align:center;line-height:1.35;margin-bottom:8px;word-break:keep-all}
.shop-card-price{display:flex;align-items:center;gap:5px;font-size:14px;font-weight:800;color:#f8fafc;font-variant-numeric:tabular-nums;margin-bottom:10px}
.shop-card-price img{width:18px;height:18px;object-fit:contain;display:block;flex-shrink:0}
.shop-card-price-label{font-size:10px;font-weight:700;color:#64748b;letter-spacing:.04em;text-transform:uppercase}
.shop-card-btn{width:100%;padding:8px 0;border-radius:10px;background:linear-gradient(135deg,#4f46e5,#7c3aed);color:#fff;font-size:12px;font-weight:800;letter-spacing:.04em;border:0;cursor:pointer;transition:all .18s}
.shop-card-btn:hover{background:linear-gradient(135deg,#6366f1,#8b5cf6);box-shadow:0 4px 12px rgba(99,102,241,.4)}
.shop-sold-badge{position:absolute;top:10px;right:10px;padding:3px 8px;border-radius:8px;background:rgba(100,116,139,.3);border:1px solid rgba(100,116,139,.4);color:#94a3b8;font-size:10px;font-weight:800}
/* 카드 내 제한 배지 */
.shop-limit-badge{width:100%;margin-bottom:6px;display:flex;flex-direction:column;gap:2px}
.shop-limit-row{display:flex;align-items:center;justify-content:space-between;gap:6px;padding:2px 6px;border-radius:6px;background:rgba(139,92,246,.08);border:1px solid rgba(139,92,246,.18)}
.shop-limit-row.exhausted{background:rgba(239,68,68,.08);border-color:rgba(239,68,68,.2)}
.shop-limit-label{font-size:10px;font-weight:700;color:#a78bfa;flex-shrink:0}
.shop-limit-row.exhausted .shop-limit-label{color:#fca5a5}
.shop-limit-val{font-size:10px;font-weight:800;color:#c4b5fd;font-variant-numeric:tabular-nums}
.shop-limit-row.exhausted .shop-limit-val{color:#fca5a5}
/* 모달 내 제한 상세 */
.shop-limit-detail{background:rgba(4,6,18,.5);border:1px solid rgba(139,92,246,.18);border-radius:12px;padding:10px 14px;display:flex;flex-direction:column;gap:6px}
.shop-limit-detail-row{display:grid;grid-template-columns:44px 1fr auto;align-items:center;gap:8px}
.shop-limit-detail-row.exhausted{}
.shop-limit-detail-label{font-size:11px;font-weight:800;color:#a78bfa}
.shop-limit-detail-row.exhausted .shop-limit-detail-label{color:#fca5a5}
.shop-limit-bar-wrap{height:6px;border-radius:3px;background:rgba(255,255,255,.08);overflow:hidden}
.shop-limit-bar{height:100%;width:var(--pct,0%);border-radius:3px;background:linear-gradient(90deg,#6366f1,#a78bfa);transition:width .3s}
.shop-limit-detail-row.exhausted .shop-limit-bar{background:linear-gradient(90deg,#ef4444,#fca5a5)}
.shop-limit-detail-val{font-size:11px;font-weight:800;color:#c4b5fd;font-variant-numeric:tabular-nums;white-space:nowrap}
.shop-limit-detail-val.exhausted{color:#fca5a5}
/* 상점 구매 모달 */
.shop-buy-modal{display:flex;flex-direction:column;gap:14px;padding:4px 0}
.shop-buy-item-row{display:flex;align-items:center;gap:14px;padding:14px;border-radius:14px;background:rgba(4,6,18,.6);border:1px solid rgba(255,255,255,.07)}
.shop-buy-thumb{width:64px;height:64px;border-radius:12px;overflow:hidden;background:rgba(2,6,23,.8);display:grid;place-items:center;position:relative;flex-shrink:0}
.shop-buy-name{font-size:16px;font-weight:800;color:#f1f5f9;line-height:1.3}
.shop-buy-meta{font-size:12px;color:#64748b;margin-top:3px}
.shop-buy-price-row{display:flex;align-items:center;gap:8px;padding:12px 14px;border-radius:12px;background:rgba(99,102,241,.08);border:1px solid rgba(99,102,241,.18)}
.shop-buy-price-row img{width:22px;height:22px;object-fit:contain;display:block;flex-shrink:0}
.shop-buy-price-amount{font-size:22px;font-weight:900;color:#f8fafc;font-variant-numeric:tabular-nums}
.shop-buy-price-label{font-size:12px;color:#64748b;margin-left:2px;align-self:flex-end;padding-bottom:2px}
.shop-buy-balance{font-size:12px;color:#64748b;text-align:right}
.shop-buy-balance span{color:#e2e8f0;font-weight:700}
.shop-buy-footer{display:grid;grid-template-columns:1fr 2fr;gap:8px}
/* 번들 구성품 */
.shop-bundle-section{background:rgba(4,6,18,.5);border:1px solid rgba(255,255,255,.07);border-radius:12px;padding:12px}
.shop-bundle-label{font-size:10px;font-weight:800;color:#64748b;letter-spacing:.07em;text-transform:uppercase;margin-bottom:8px}
.shop-bundle-list{display:flex;flex-direction:column;gap:6px}
.shop-bundle-row{display:flex;align-items:center;gap:10px}
.shop-bundle-mini{width:32px;height:32px;position:relative;flex-shrink:0;border-radius:6px;overflow:hidden;background:rgba(2,6,23,.8);display:grid;place-items:center}
.shop-bundle-name{flex:1;font-size:13px;font-weight:600;color:#e2e8f0}
.shop-bundle-count{font-size:13px;font-weight:800;color:#a5b4fc;flex-shrink:0}
/* 수량 입력 */
.shop-qty-row{display:flex;align-items:center;gap:8px;padding:10px 0}
.shop-qty-label{font-size:12px;font-weight:700;color:#94a3b8;flex-shrink:0;min-width:60px}
.shop-qty-btn{width:34px;height:34px;border-radius:8px;border:1px solid rgba(255,255,255,.12);background:rgba(4,6,18,.7);color:#e2e8f0;font-size:18px;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:all .15s}
.shop-qty-btn:hover{background:rgba(99,102,241,.2);border-color:rgba(99,102,241,.4)}
.shop-qty-input{width:60px;text-align:center;padding:7px 8px;background:rgba(4,6,18,.85);border:1px solid rgba(255,255,255,.12);border-radius:8px;color:#f8fafc;font-size:15px;font-weight:800;font-variant-numeric:tabular-nums;outline:none;transition:border-color .15s}
.shop-qty-input:focus{border-color:rgba(99,102,241,.5)}
.shop-qty-input::-webkit-inner-spin-button,.shop-qty-input::-webkit-outer-spin-button{opacity:.4}
.shop-qty-max{font-size:11px;color:#475569;flex-shrink:0}
/* 계산서 */
.shop-receipt{background:rgba(4,6,18,.6);border:1px solid rgba(255,255,255,.07);border-radius:12px;padding:10px 14px;display:flex;flex-direction:column;gap:6px}
.shop-receipt-row{display:flex;align-items:center;justify-content:space-between;gap:8px}
.shop-receipt-label{font-size:12px;color:#64748b;font-weight:600}
.shop-receipt-val{display:flex;align-items:center;gap:5px;font-size:13px;font-weight:800;color:#e2e8f0;font-variant-numeric:tabular-nums}
.shop-receipt-row.deduct .shop-receipt-label::before{content:'− ';color:#f87171}
.shop-receipt-row.deduct .shop-receipt-val{color:#fca5a5}
.shop-receipt-row.result .shop-receipt-val{color:#a5f3c8}
.shop-receipt-row.neg .shop-receipt-val{color:#fca5a5}
.shop-receipt-divider{height:1px;background:rgba(255,255,255,.07);margin:2px 0}
@keyframes shop-pop{0%{transform:scale(.92);opacity:0}60%{transform:scale(1.04)}100%{transform:scale(1);opacity:1}}
.shop-card:hover .shop-card-thumb{animation:shop-pop .25s ease}
.page[data-page="자물쇠"]{width:100vw;margin-left:calc(50% - 50vw);margin-right:calc(50% - 50vw);margin-top:-26px;margin-bottom:-50px}.page[data-page="자물쇠"].active{display:block}
.lockbox-panel{position:relative;overflow:hidden;min-height:calc(100svh - 104px);background:#05070d url('/lockbox-ui?file=%EB%B0%91%EB%B0%94%ED%83%95.png') center/cover no-repeat}
.lockbox-panel::before{content:'';position:absolute;inset:0;background:linear-gradient(180deg,rgba(4,7,18,.32),transparent 22%,transparent 70%,rgba(0,0,0,.34));pointer-events:none;z-index:1}
#lockboxRoot{position:absolute;inset:0;z-index:2}
.lockbox-title{position:absolute;top:4%;left:50%;transform:translateX(-50%);width:min(440px,42%);height:auto;object-fit:contain;pointer-events:none;z-index:4;filter:drop-shadow(0 6px 20px rgba(0,0,0,.6))}
.lockbox-char{position:absolute;right:1.5%;bottom:0;height:88%;width:auto;object-fit:contain;pointer-events:none;z-index:3;filter:drop-shadow(0 10px 30px rgba(0,0,0,.55))}
.lockbox-item{position:absolute;left:3%;top:24%;width:min(360px,30%);height:auto;object-fit:contain;pointer-events:none;z-index:4;filter:drop-shadow(0 8px 22px rgba(0,0,0,.5))}
.lockbox-btns{position:absolute;left:50%;bottom:6%;transform:translateX(-50%);display:flex;gap:18px;z-index:5}
.lockbox-btn{width:min(240px,26vw);aspect-ratio:287/70;border:0;padding:0;background-color:transparent;background-position:center;background-size:contain;background-repeat:no-repeat;box-shadow:none;cursor:pointer;transition:none;-webkit-tap-highlight-color:transparent}
.lockbox-btn:hover,.lockbox-btn:focus,.lockbox-btn:active{background-color:transparent;background-position:center;background-size:contain;background-repeat:no-repeat;box-shadow:none;transform:none;color:inherit;outline:none}
.lockbox-btn:active{filter:brightness(.92)}
@media(max-width:820px){.lockbox-panel{min-height:calc(100svh - 150px)}.lockbox-title{top:2.5%;width:min(320px,64%)}.lockbox-item{left:50%;top:14%;transform:translateX(-50%);width:min(380px,86%)}.lockbox-char{height:48%;right:-5%;bottom:14%;opacity:.92}.lockbox-btns{bottom:5%;gap:10px}.lockbox-btn{width:min(200px,44vw)}}
.page[data-page="event"]{width:100vw;margin-left:calc(50% - 50vw);margin-right:calc(50% - 50vw);margin-top:-26px;margin-bottom:-50px}.page[data-page="event"].active{display:block}.event-dice-panel{position:relative;overflow:hidden;min-height:calc(100svh - 104px);padding:0;background:#05070d;background-image:linear-gradient(110deg,rgba(4,7,18,.86) 0%,rgba(4,7,18,.62) 42%,rgba(4,7,18,.18) 100%),url('/rpg-ui?file=%EC%A3%BC%EC%82%AC%EC%9C%84PC.png');background-size:cover;background-position:center;display:grid;align-items:stretch;border:0;border-radius:0;box-shadow:none}.event-dice-panel::before{content:'';position:absolute;inset:0;background:radial-gradient(circle at 26% 22%,rgba(250,204,21,.18),transparent 34%),linear-gradient(180deg,rgba(255,255,255,.04),transparent 30%,rgba(0,0,0,.36));pointer-events:none}.event-dice-panel>#eventDiceRoot{position:relative;z-index:1;display:grid;grid-template-columns:minmax(300px,430px) minmax(0,1fr);gap:24px;width:min(1180px,94vw);margin:0 auto;padding:clamp(24px,4vw,44px) 0}.event-dice-main{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;min-width:0}.event-title-block{text-align:center;display:grid;gap:6px}.event-eyebrow,.event-panel-title{font-size:11px;font-weight:900;letter-spacing:.14em;color:#facc15}.event-title-block h2{margin:0;font-size:clamp(28px,5vw,50px);line-height:1;color:#fff;text-shadow:0 4px 22px rgba(0,0,0,.75),0 0 18px rgba(250,204,21,.24)}.event-subcopy{font-size:13px;color:#cbd5e1;font-weight:700}.event-dice-row{display:flex;gap:14px;justify-content:center;align-items:center}.event-die{--die-size:88px;--half:calc(var(--die-size) / 2);width:var(--die-size);height:var(--die-size);perspective:720px;filter:drop-shadow(0 14px 22px rgba(0,0,0,.55));display:flex;align-items:center;justify-content:center}.event-cube{position:relative;width:100%;height:100%;transform-style:preserve-3d;transform:rotateX(-20deg) rotateY(-25deg);will-change:transform;transition:transform .85s cubic-bezier(.18,.9,.28,1)}.event-die.rolling .event-cube{transition:none;animation:eventDiceSpin .36s linear infinite}.event-face{position:absolute;inset:0;display:grid;grid-template-columns:repeat(3,1fr);grid-template-rows:repeat(3,1fr);padding:11%;border-radius:16%;background:radial-gradient(circle at 30% 25%,#fff 0%,#f3f4f7 38%,#d9dce4 100%);box-shadow:inset 0 0 0 1px rgba(0,0,0,.05),inset 0 6px 12px rgba(255,255,255,.85),inset 0 -8px 16px rgba(0,0,0,.14);backface-visibility:hidden}.event-face1{transform:translateZ(var(--half))}.event-face6{transform:rotateY(180deg) translateZ(var(--half))}.event-face2{transform:rotateY(90deg) translateZ(var(--half))}.event-face5{transform:rotateY(-90deg) translateZ(var(--half))}.event-face3{transform:rotateX(90deg) translateZ(var(--half))}.event-face4{transform:rotateX(-90deg) translateZ(var(--half))}.event-die-pip,.event-die-empty{display:flex;align-items:center;justify-content:center}.event-die-pip::after{content:'';width:64%;aspect-ratio:1;border-radius:50%;background:radial-gradient(circle at 35% 30%,#4a4f5a 0%,#1a1d24 65%,#050608 100%);box-shadow:inset 0 2px 3px rgba(0,0,0,.65),0 1px 1px rgba(255,255,255,.4)}@keyframes eventDiceSpin{0%{transform:rotateX(-20deg) rotateY(-25deg)}100%{transform:rotateX(700deg) rotateY(760deg)}}.event-result-card{width:min(390px,100%);min-height:128px;padding:16px;background:rgba(4,6,18,.72);border:1px solid rgba(255,255,255,.11);border-radius:16px;box-shadow:0 16px 40px rgba(0,0,0,.35);display:grid;gap:9px;text-align:center;backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px)}.event-result-card.hit{border-color:rgba(250,204,21,.46);box-shadow:0 18px 46px rgba(0,0,0,.42),0 0 24px rgba(250,204,21,.14)}.event-result-kicker{font-size:10px;font-weight:900;letter-spacing:.16em;color:#94a3b8}.event-result-title{font-size:22px;font-weight:900;color:#f8fafc}.event-result-sub{font-size:13px;color:#94a3b8;line-height:1.45}.event-hit-label{font-size:12px;font-weight:900}.event-hit-label.yes{color:#86efac}.event-hit-label.no{color:#94a3b8}.event-result-reward{display:grid;grid-template-columns:64px 1fr;gap:12px;align-items:center;text-align:left}.event-result-reward-name{font-size:16px;font-weight:900;color:#fde68a}.event-result-reward-count{font-size:13px;font-weight:800;color:#e2e8f0}.event-ticket-line{display:flex;justify-content:center;gap:8px;align-items:center;color:#cbd5e1;font-size:13px;font-weight:800}.event-ticket-line b{color:#fde68a;font-variant-numeric:tabular-nums}.event-roll-btn{width:min(320px,100%);padding:15px 18px;font-size:16px;font-weight:900;box-shadow:0 12px 28px rgba(88,101,242,.42)}.event-dice-side{min-width:0;align-self:stretch;display:flex;flex-direction:column;gap:12px;padding:16px;background:rgba(5,8,18,.72);border:1px solid rgba(255,255,255,.09);border-radius:18px;backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px)}.event-reward-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}.event-reward-cell{min-width:0;padding:9px 7px;background:rgba(4,6,18,.66);border:1px solid rgba(255,255,255,.08);border-radius:12px;text-align:center;display:grid;justify-items:center;gap:5px;transition:transform .12s,border-color .15s,box-shadow .15s;color:inherit}.event-reward-cell:hover:not(:disabled){border-color:rgba(99,102,241,.45);background:rgba(88,101,242,.12)}.event-reward-cell.picked{border-color:rgba(129,140,248,.8);background:rgba(88,101,242,.2);box-shadow:0 0 0 1px rgba(129,140,248,.2) inset}.event-reward-cell.active{border-color:rgba(250,204,21,.68);box-shadow:0 0 0 1px rgba(250,204,21,.16) inset,0 0 18px rgba(250,204,21,.18);transform:translateY(-1px)}.event-reward-sum{font-size:15px;font-weight:900;color:#f8fafc;font-variant-numeric:tabular-nums;display:flex;gap:5px;align-items:center}.event-mult{font-size:9px;color:#94a3b8;font-weight:900}.event-reward-thumb{position:relative;width:42px;height:42px;display:grid;place-items:center}.event-reward-thumb.large{width:60px;height:60px}.event-reward-frame{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;z-index:1}.event-reward-icon{position:relative;z-index:3;width:68%;height:68%;object-fit:contain;filter:drop-shadow(0 3px 7px rgba(0,0,0,.58))}.event-reward-fallback{position:relative;z-index:2;font-size:18px;font-weight:900;color:#475569}.event-reward-name{width:100%;font-size:10px;font-weight:800;color:#cbd5e1;line-height:1.25;word-break:keep-all;overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.event-reward-count{font-size:10px;font-weight:900;color:#facc15}.event-error{padding:10px 12px;border-radius:10px;background:rgba(127,29,29,.28);border:1px solid rgba(248,113,113,.28);color:#fecaca;font-size:12px;font-weight:800}.event-history-title{margin-top:4px}.event-history-empty{padding:16px;text-align:center;color:#64748b;font-size:12px;background:rgba(4,6,18,.42);border:1px dashed rgba(148,163,184,.2);border-radius:12px}.event-history-list{display:grid;gap:6px}.event-history-row{display:grid;grid-template-columns:34px 70px 1fr 42px;gap:8px;align-items:center;padding:8px 10px;background:rgba(4,6,18,.52);border:1px solid rgba(255,255,255,.06);border-radius:10px;font-size:12px}.event-history-sum{font-size:15px;font-weight:900;color:#fde68a}.event-history-dice{color:#94a3b8;font-variant-numeric:tabular-nums}.event-history-reward{font-weight:800;color:#e2e8f0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.event-history-hit{font-size:10px;font-weight:900;text-align:right}.event-history-hit.yes{color:#86efac}.event-history-hit.no{color:#64748b}
@media(max-width:820px){.event-dice-panel{min-height:calc(100svh - 150px);background-image:linear-gradient(180deg,rgba(4,7,18,.68),rgba(4,7,18,.9) 62%,rgba(4,7,18,.96)),url('/rpg-ui?file=%EC%A3%BC%EC%82%AC%EC%9C%84%EB%AA%A8%EB%B0%94%EC%9D%BC.png');background-position:center top}.event-dice-panel>#eventDiceRoot{grid-template-columns:1fr;padding:18px;gap:18px}.event-dice-main{min-height:420px;justify-content:flex-end;padding-top:64px}.event-dice-side{padding:12px}.event-reward-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.event-die{--die-size:64px}.event-history-row{grid-template-columns:32px 64px 1fr}}
.event-cube-settle{width:100%;height:100%;transform-style:preserve-3d}.event-die.result .event-cube-settle{animation:eventDiceSettle .72s cubic-bezier(.18,.9,.22,1.18) both}.event-die.win{filter:drop-shadow(0 16px 24px rgba(0,0,0,.58)) drop-shadow(0 0 18px rgba(250,204,21,.62))}.event-die.lose{filter:drop-shadow(0 14px 22px rgba(0,0,0,.58)) grayscale(.2) brightness(.88)}.event-result-card.hit{animation:eventResultPop .58s cubic-bezier(.17,.84,.28,1.18) both}.event-result-card.win{border-color:rgba(74,222,128,.5);box-shadow:0 18px 46px rgba(0,0,0,.42),0 0 28px rgba(74,222,128,.2)}.event-result-card.lose{border-color:rgba(148,163,184,.28);box-shadow:0 18px 46px rgba(0,0,0,.42),0 0 24px rgba(148,163,184,.1)}.event-screen-flash{position:absolute;inset:0;z-index:0;pointer-events:none;animation:eventFlash .82s ease-out both}.event-screen-flash.win{background:radial-gradient(circle at 38% 38%,rgba(250,204,21,.32),transparent 38%),radial-gradient(circle at 50% 48%,rgba(74,222,128,.22),transparent 44%)}.event-screen-flash.lose{background:radial-gradient(circle at 38% 38%,rgba(148,163,184,.18),transparent 42%)}.event-outcome-burst{position:absolute;left:50%;top:48%;z-index:0;width:240px;height:240px;margin:-120px 0 0 -120px;border-radius:50%;pointer-events:none;animation:eventBurst .9s ease-out both}.event-outcome-burst.win{background:conic-gradient(from 0deg,transparent 0 11%,rgba(250,204,21,.8) 12% 13%,transparent 14% 25%,rgba(74,222,128,.65) 26% 27%,transparent 28% 39%,rgba(250,204,21,.7) 40% 41%,transparent 42%)}.event-outcome-burst.lose{background:conic-gradient(from 0deg,transparent 0 14%,rgba(148,163,184,.34) 15% 16%,transparent 17% 34%,rgba(100,116,139,.28) 35% 36%,transparent 37%)}@keyframes eventDiceSettle{0%{transform:translateY(-16px) scale(.92);opacity:.6}52%{transform:translateY(5px) scale(1.07);opacity:1}76%{transform:translateY(-2px) scale(.98)}100%{transform:translateY(0) scale(1)}}@keyframes eventResultPop{0%{opacity:0;transform:translateY(14px) scale(.94)}62%{opacity:1;transform:translateY(-3px) scale(1.03)}100%{opacity:1;transform:none}}@keyframes eventFlash{0%{opacity:0}18%{opacity:1}100%{opacity:0}}@keyframes eventBurst{0%{opacity:0;transform:scale(.35) rotate(0deg);filter:blur(1px)}22%{opacity:1}100%{opacity:0;transform:scale(1.75) rotate(18deg);filter:blur(5px)}}@media(max-width:900px){.event-dice-panel{background-image:linear-gradient(180deg,rgba(4,7,18,.54),rgba(4,7,18,.88) 58%,rgba(4,7,18,.97)),url('/rpg-ui?file=%EC%A3%BC%EC%82%AC%EC%9C%84%EB%AA%A8%EB%B0%94%EC%9D%BC.png') !important;background-size:cover !important;background-position:center top !important;background-repeat:no-repeat !important}.event-outcome-burst{top:38%;width:190px;height:190px;margin:-95px 0 0 -95px}}
.event-lightning-flash{position:fixed;inset:0;z-index:9999;pointer-events:none;animation:eventLightningScreenFlash .85s ease-out forwards}.event-lightning-bolt-svg{position:fixed;left:0;top:0;pointer-events:none;z-index:9998;overflow:visible;animation:eventBoltFade .55s ease-out forwards}.event-reward-cell{position:relative;overflow:hidden}.event-reward-cell.lightning{background:linear-gradient(135deg,rgba(6,182,212,.18),rgba(8,145,178,.18),rgba(34,211,238,.16));border-color:rgba(34,211,238,.72);box-shadow:0 0 22px rgba(6,182,212,.55),0 0 45px rgba(34,211,238,.18)}.event-reward-cell.lightning::before{content:'';position:absolute;inset:0;background:radial-gradient(ellipse at 50% 100%,rgba(6,182,212,.16),transparent 65%);pointer-events:none}.event-reward-cell.lightning-striking{animation:eventLightningTargetStrike .65s ease-out forwards,eventLightningPulse 2.5s ease-in-out .65s infinite!important}.event-slot-spark{position:absolute;width:2px;height:10px;border-radius:1px;background:#22d3ee;opacity:0;animation:eventLightningSpark 1.8s linear infinite;pointer-events:none;z-index:2}.event-reward-cell.lightning .event-slot-spark:nth-child(1){top:18%;right:-1px;animation-delay:0s}.event-reward-cell.lightning .event-slot-spark:nth-child(2){top:55%;right:-1px;animation-delay:.6s}.event-reward-cell.lightning .event-slot-spark:nth-child(3){bottom:22%;left:-1px;animation-delay:1.1s}.event-lit-bolt{font-size:12px;margin-right:2px;display:inline-block;animation:eventZapBolt .55s ease-in-out infinite;filter:drop-shadow(0 0 6px rgba(34,211,238,.9))}.event-lightning-hit{justify-self:center;display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border:1px solid rgba(34,211,238,.45);border-radius:999px;background:rgba(6,182,212,.14);color:#a5f3fc;font-size:12px;font-weight:900}.event-result-card.lightning{border-color:rgba(34,211,238,.62);box-shadow:0 18px 46px rgba(0,0,0,.42),0 0 30px rgba(34,211,238,.24)}@keyframes eventLightningScreenFlash{0%{background:rgba(255,240,80,0)}6%{background:rgba(255,255,180,.75)}12%{background:rgba(255,220,50,.2)}20%{background:rgba(255,240,100,.55)}32%{background:rgba(255,200,30,.15)}50%{background:rgba(255,210,60,.25)}70%{background:rgba(255,200,30,.08)}100%{background:rgba(255,200,30,0)}}@keyframes eventBoltFade{0%{opacity:0}4%{opacity:1}15%{opacity:.25}22%{opacity:.95}38%{opacity:.15}52%{opacity:.6}100%{opacity:0}}@keyframes eventLightningTargetStrike{0%{transform:translateX(0) scaleX(1);filter:brightness(1);box-shadow:0 0 8px rgba(6,182,212,.12)}8%{transform:translateX(-4px) scaleX(1.02);filter:brightness(3.5);box-shadow:0 0 40px #22d3ee,0 0 80px rgba(34,211,238,.45)}16%{transform:translateX(4px) scaleX(.99);filter:brightness(2.5);box-shadow:0 0 28px #22d3ee}26%{transform:translateX(-3px) scaleX(1.01);filter:brightness(2);box-shadow:0 0 20px rgba(34,211,238,.45)}38%{transform:translateX(2px) scaleX(1);filter:brightness(1.6)}52%{transform:translateX(-1px) scaleX(1);filter:brightness(1.3)}100%{transform:translateX(0) scaleX(1);filter:brightness(1);box-shadow:0 0 18px rgba(34,211,238,.45)}}@keyframes eventLightningPulse{0%,100%{box-shadow:0 0 8px rgba(6,182,212,.16)}50%{box-shadow:0 0 18px rgba(34,211,238,.45)}}@keyframes eventLightningSpark{0%{opacity:0;transform:scaleY(1) translateY(0)}20%{opacity:1;transform:scaleY(1.6) translateY(-3px)}40%{opacity:.6;transform:scaleY(.8) translateY(2px)}60%{opacity:1;transform:scaleY(1.4) translateY(-2px)}80%{opacity:.3}100%{opacity:0}}@keyframes eventZapBolt{0%,100%{opacity:1;transform:scale(1) rotate(0deg);filter:drop-shadow(0 0 3px #22d3ee)}30%{opacity:.4;transform:scale(.7) rotate(-14deg);filter:none}55%{opacity:1;transform:scale(1.4) rotate(9deg);filter:drop-shadow(0 0 8px #22d3ee) brightness(1.7)}70%{opacity:.7;transform:scale(.85) rotate(-5deg);filter:drop-shadow(0 0 4px #22d3ee)}}@media(max-width:900px){.event-dice-panel{background-image:linear-gradient(180deg,rgba(4,7,18,.24),rgba(4,7,18,.72) 62%,rgba(4,7,18,.94)),url('/rpg-ui?file=%EC%A3%BC%EC%82%AC%EC%9C%84%EB%AA%A8%EB%B0%94%EC%9D%BC.png')!important;background-size:100% 100%,contain!important;background-position:center top,center top!important;background-repeat:no-repeat,no-repeat!important}.event-dice-main{min-height:min(540px,62svh)}}
@media(max-width:520px){header{padding:10px 8px;gap:6px}h1{font-size:clamp(16px,5vw,20px)}.top-left{gap:8px}.bar{gap:5px}.who{max-width:30vw;font-size:clamp(10px,2.8vw,12px)}.subnav-bar{padding:0 8px}.tab-label{display:none}.tab-icon-wrap{width:36px;height:36px;border-radius:12px}.tab-icon-wrap svg{width:20px;height:20px}.search-input{flex:1;min-width:0}.shop-grid{grid-template-columns:repeat(2,1fr);gap:8px}.shop-currency-chip{font-size:11px;padding:4px 8px}.shop-currency-chip img{width:14px;height:14px}}
.page[data-page="펀치기계"]{width:100vw;margin-left:calc(50% - 50vw);margin-right:calc(50% - 50vw);margin-top:-26px;margin-bottom:-50px}.page[data-page="펀치기계"].active{display:block}
.punch-panel{position:relative;overflow:hidden;min-height:calc(100svh - 104px);background:radial-gradient(circle at 28% 12%,rgba(99,102,241,.16),transparent 42%),radial-gradient(circle at 80% 90%,rgba(244,63,94,.14),transparent 46%),linear-gradient(180deg,#0a0e1c,#05070f)}
#punchRoot{position:relative;z-index:1;height:100%}
.punch-stage{display:grid;grid-template-columns:minmax(240px,360px) minmax(0,1fr);gap:clamp(20px,4vw,52px);align-items:center;justify-items:center;width:min(1040px,92vw);margin:0 auto;padding:clamp(20px,4vw,44px) 0;perspective:1100px}
.punch-tower-wrap{transform:rotateY(-16deg) rotateX(3deg);transform-style:preserve-3d;filter:drop-shadow(0 28px 40px rgba(0,0,0,.6))}
.punch-tower{width:min(320px,72vw);height:auto;display:block;overflow:visible}
.pm-light{fill:#1c2742;transition:fill .07s,filter .07s}
.pm-light.on{fill:#ffd24a;filter:drop-shadow(0 0 5px rgba(255,196,40,.95))}
#punchBell{transform-origin:96px 20px}
#punchBell.ring{animation:pmBellRing .7s ease-out}
@keyframes pmBellRing{0%,100%{transform:rotate(0)}12%{transform:rotate(-13deg)}30%{transform:rotate(11deg)}48%{transform:rotate(-8deg)}66%{transform:rotate(5deg)}82%{transform:rotate(-2deg)}}
.punch-controls{display:flex;flex-direction:column;align-items:center;gap:clamp(14px,2.4vw,24px);min-width:0;text-align:center}
.punch-title-block{display:grid;gap:6px}
.punch-eyebrow{font-size:11px;font-weight:900;letter-spacing:.16em;color:#fca5a5}
.punch-title-block h2{margin:0;font-size:clamp(26px,5vw,44px);line-height:1;color:#fff;text-shadow:0 4px 22px rgba(0,0,0,.7),0 0 18px rgba(244,63,94,.22)}
.punch-sub{font-size:13px;color:#cbd5e1;font-weight:700}
.punch-lcd{position:relative;width:min(300px,80vw);padding:16px 16px 12px;border-radius:14px;background:linear-gradient(165deg,#3a3f49,#1c2027 58%,#0f1217);border:1px solid rgba(0,0,0,.6);box-shadow:0 14px 30px rgba(0,0,0,.5),inset 0 1px 0 rgba(255,255,255,.14),inset 0 -3px 8px rgba(0,0,0,.55)}
.punch-lcd-screw{position:absolute;width:8px;height:8px;border-radius:50%;background:radial-gradient(circle at 35% 30%,#cdd3da,#5a626d 60%,#2b3038);box-shadow:inset 0 1px 1px rgba(255,255,255,.5),0 1px 2px rgba(0,0,0,.5)}
.punch-lcd-screw.tl{top:6px;left:6px}.punch-lcd-screw.tr{top:6px;right:6px}.punch-lcd-screw.bl{bottom:6px;left:6px}.punch-lcd-screw.br{bottom:6px;right:6px}
.punch-lcd-label{font-size:10px;font-weight:900;letter-spacing:.32em;color:#8b94a3;text-align:center;margin-bottom:8px;text-shadow:0 1px 0 rgba(0,0,0,.6)}
.punch-lcd-screen{position:relative;border-radius:8px;padding:10px 18px;background:linear-gradient(180deg,#120a03,#1c0f02);box-shadow:inset 0 3px 10px rgba(0,0,0,.85),inset 0 0 0 1px rgba(0,0,0,.6),0 0 0 2px rgba(255,255,255,.04);overflow:hidden}
.punch-lcd-screen::after{content:'';position:absolute;inset:0;pointer-events:none;background:repeating-linear-gradient(0deg,rgba(0,0,0,.22) 0 1px,transparent 1px 3px);mix-blend-mode:multiply;opacity:.5}
.punch-lcd-ghost,.punch-lcd-value{display:block;text-align:right;font-family:'Courier New',ui-monospace,monospace;font-weight:900;font-style:italic;font-size:clamp(40px,9vw,60px);line-height:1;letter-spacing:6px;font-variant-numeric:tabular-nums}
.punch-lcd-ghost{color:rgba(255,120,20,.1)}
.punch-lcd-value{position:absolute;inset:10px 18px auto auto;color:#ff8a1e;text-shadow:0 0 6px rgba(255,138,30,.9),0 0 16px rgba(255,90,10,.6),0 0 30px rgba(255,80,0,.4)}
.punch-best{font-size:11px;font-weight:900;letter-spacing:.18em;color:#7f8896;margin-top:8px;text-align:center}.punch-best b{color:#fca5a5;font-variant-numeric:tabular-nums;font-family:'Courier New',ui-monospace,monospace;font-style:italic}
.punch-dial{position:relative;width:clamp(212px,56vw,284px);aspect-ratio:1;display:grid;place-items:center;margin:2px 0}
.punch-ring{position:absolute;inset:0;width:100%;height:100%;overflow:visible;transition:filter .2s}
.punch-ring-grad{opacity:.4;transition:opacity .25s}
.punch-dial.active .punch-ring-grad{opacity:1}
.punch-dial.active .punch-ring{filter:drop-shadow(0 0 10px rgba(255,140,30,.35))}
.punch-dot{opacity:0;transition:opacity .2s}
.punch-dial.active .punch-dot{opacity:1}
.punch-pad{position:relative;z-index:2;width:58%;height:58%;border:0;border-radius:50%;background:radial-gradient(circle at 36% 28%,#ff8a8a 0%,#ef4444 42%,#b91c1c 78%,#7f1212 100%);color:#fff;font-weight:900;cursor:pointer;user-select:none;-webkit-tap-highlight-color:transparent;box-shadow:0 12px 0 #6d1212,0 20px 28px rgba(0,0,0,.5),inset 0 5px 14px rgba(255,255,255,.45),inset 0 -10px 20px rgba(0,0,0,.32);transition:transform .08s ease,box-shadow .08s ease,filter .15s;display:grid;place-items:center;gap:2px}
.punch-pad:hover,.punch-pad:focus,.punch-pad:active{background:radial-gradient(circle at 36% 28%,#ff8a8a 0%,#ef4444 42%,#b91c1c 78%,#7f1212 100%);color:#fff;outline:none}
.punch-pad:not(:disabled):hover{filter:brightness(1.06)}
.punch-pad:not(:disabled):active{transform:translateY(8px);box-shadow:0 4px 0 #6d1212,0 8px 14px rgba(0,0,0,.5),inset 0 5px 14px rgba(255,255,255,.3),inset 0 -8px 18px rgba(0,0,0,.4)}
.punch-pad:disabled{filter:grayscale(.35) brightness(.82);cursor:default}
.punch-pad .pm-glove{font-size:clamp(30px,7vw,40px);line-height:1;filter:drop-shadow(0 4px 6px rgba(0,0,0,.4))}
.punch-pad-label{font-size:clamp(12px,2.4vw,15px);letter-spacing:.02em}
.punch-coin-btn{padding:11px 20px;border:0;border-radius:12px;background:linear-gradient(135deg,#f59e0b,#d97706);color:#3b1d00;font-weight:900;font-size:14px;cursor:pointer;box-shadow:0 8px 18px rgba(217,119,6,.4);transition:transform .1s,box-shadow .1s,filter .15s}
.punch-coin-btn b{font-variant-numeric:tabular-nums}
.punch-coin-btn:not(:disabled):hover{filter:brightness(1.06)}
.punch-coin-btn:not(:disabled):active{transform:translateY(2px)}
.punch-coin-btn:disabled{background:linear-gradient(135deg,#3a4254,#2a3142);color:#6b7280;box-shadow:none;cursor:default}
.punch-rank{width:min(320px,84vw);background:rgba(5,8,18,.6);border:1px solid rgba(255,255,255,.08);border-radius:14px;padding:12px 14px}
.punch-rank-title{font-size:13px;font-weight:900;color:#fde68a;text-align:center;margin-bottom:8px;letter-spacing:.04em}
.punch-rank-list{display:grid;gap:5px}
.punch-rank-empty{padding:10px;text-align:center;color:#64748b;font-size:12px}
.punch-rank-row{display:grid;grid-template-columns:26px 1fr auto;gap:8px;align-items:center;padding:7px 9px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.05);border-radius:9px;font-size:13px}
.punch-rank-row.me{border-color:rgba(244,63,94,.5);background:rgba(244,63,94,.1)}
.punch-rank-no{font-weight:900;text-align:center;color:#94a3b8;font-variant-numeric:tabular-nums}
.punch-rank-no.r1{color:#fbbf24}.punch-rank-no.r2{color:#cbd5e1}.punch-rank-no.r3{color:#d97757}
.punch-rank-name{font-weight:800;color:#e5e7eb;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.punch-rank-score{font-weight:900;color:#fca5a5;font-variant-numeric:tabular-nums}
.punch-hint{font-size:12px;color:#64748b;font-weight:700;max-width:300px;line-height:1.5;text-align:center}
@media(max-width:820px){
.punch-panel{min-height:calc(100svh - 124px)}
.punch-stage{display:flex;flex-direction:column;align-items:center;gap:14px;padding:18px 0 34px;width:100%}
.punch-controls{display:contents}
.punch-title-block{order:1;gap:3px}.punch-title-block h2{font-size:24px}
.punch-sub{order:1;display:block;font-size:12px;max-width:84vw}
.punch-tower-wrap{order:2;transform:rotateY(-10deg);flex:0 0 auto}
.punch-tower{width:min(170px,44vw);height:auto}
.punch-lcd{order:3;width:min(260px,80vw)}
.punch-dial{order:4;width:min(286px,82vw)}
.punch-coin-btn{order:5}
.punch-rank{order:6;width:min(330px,90vw)}
.punch-hint{display:none}
}
.burning-wrap{max-width:880px;margin:0 auto;position:relative}
.burning-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;margin-bottom:16px}
.burning-title{font-size:clamp(24px,5vw,38px);font-weight:900;font-style:italic;letter-spacing:.01em;background:linear-gradient(90deg,#a855f7 0%,#22d3ee 100%);-webkit-background-clip:text;background-clip:text;color:transparent;filter:drop-shadow(0 0 14px rgba(124,58,237,.4))}
.burning-sub{font-size:12px;color:#a5b4fc;font-weight:700;margin-top:3px}
.burning-head-right{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.burning-points{font-size:14px;font-weight:800;color:#cbd5e1;display:flex;align-items:center;gap:3px}.burning-points b{color:#5eead4;font-variant-numeric:tabular-nums}
.burning-mega-btn{padding:10px 18px;border:0;border-radius:999px;background:linear-gradient(135deg,#7c3aed,#d946ef);color:#fff;font-weight:900;font-size:13px;cursor:pointer;box-shadow:0 0 16px rgba(168,85,247,.55),0 6px 16px rgba(0,0,0,.4)}
.burning-mega-btn:hover,.burning-mega-btn:focus,.burning-mega-btn:active{background:linear-gradient(135deg,#8b5cf6,#e879f9);color:#fff;outline:none}
.burning-mega-btn:disabled{opacity:.5;cursor:default}
.burning-mega-on{font-size:13px;font-weight:900;color:#d8b4fe;display:flex;align-items:center;gap:5px;text-shadow:0 0 12px rgba(168,85,247,.6)}
/* 보드: 좌(버닝) | 중앙(레벨) | 우(메가) — 모바일에서도 좌우 유지 */
.burning-board{--bcell:132px;--bgap:12px;--bhead:34px;position:relative;display:flex;align-items:flex-start;gap:clamp(4px,1.6vw,14px);padding:clamp(10px,2.4vw,18px);border-radius:20px;background:radial-gradient(circle at 28% -5%,rgba(124,58,237,.26),transparent 52%),radial-gradient(circle at 78% 105%,rgba(20,184,166,.2),transparent 52%),linear-gradient(180deg,#0d0a20,#080c18);border:1px solid rgba(148,163,184,.14);box-shadow:inset 0 0 60px rgba(76,29,149,.18)}
.burning-track,.burning-spine{position:relative;display:flex;flex-direction:column;gap:var(--bgap);min-width:0}
.burning-track{flex:1 1 0}
.burning-spine{flex:0 0 clamp(40px,11vw,58px)}
.burning-track::before,.burning-spine::before{content:'';position:absolute;left:50%;transform:translateX(-50%);top:calc(var(--bhead) + var(--bgap));bottom:calc(var(--bcell) / 2);width:3px;border-radius:2px;z-index:0}
.burning-track.normal::before{background:linear-gradient(180deg,rgba(34,211,238,.1),rgba(34,211,238,.55),rgba(34,211,238,.1));box-shadow:0 0 10px rgba(34,211,238,.5)}
.burning-track.mega::before{background:linear-gradient(180deg,rgba(217,70,239,.1),rgba(192,132,252,.6),rgba(217,70,239,.1));box-shadow:0 0 10px rgba(168,85,247,.55)}
.burning-spine::before{background:linear-gradient(180deg,rgba(148,163,184,.05),rgba(168,85,247,.4),rgba(148,163,184,.05))}
.burning-colhead-cell{height:var(--bhead);display:flex;align-items:center;justify-content:center;font-size:clamp(11px,2.6vw,14px);font-weight:900;border-radius:10px;letter-spacing:.02em}
.burning-colhead-cell.c-normal{color:#67e8f9;background:rgba(34,211,238,.08)}
.burning-colhead-cell.c-mega{color:#e9d5ff;background:rgba(168,85,247,.1)}
.burning-colhead-cell.c-lv{color:#cbd5e1;background:rgba(255,255,255,.04);font-size:11px}
.burning-track.normal{--glow:34,211,238}
.burning-track.mega{--glow:168,85,247}
.burning-cell,.burning-level-badge{position:relative;z-index:1;min-height:var(--bcell);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:7px}
.burning-orb{position:relative;width:clamp(44px,12vw,60px);height:clamp(44px,12vw,60px);border-radius:50%;display:grid;place-items:center;cursor:pointer;background:radial-gradient(circle at 35% 28%,rgba(var(--glow),.22),rgba(8,12,28,.95));border:2px solid rgba(var(--glow),.72);box-shadow:0 0 12px rgba(var(--glow),.45),inset 0 0 10px rgba(var(--glow),.18);transition:transform .12s ease,box-shadow .2s ease,filter .2s ease;-webkit-tap-highlight-color:transparent}
.burning-orb:hover{transform:scale(1.09);box-shadow:0 0 20px rgba(var(--glow),.85),inset 0 0 12px rgba(var(--glow),.28)}
.burning-orb.claimable{animation:burningPulse 1.6s ease-in-out infinite}
@keyframes burningPulse{0%,100%{box-shadow:0 0 12px rgba(var(--glow),.5),inset 0 0 10px rgba(var(--glow),.22)}50%{box-shadow:0 0 26px rgba(var(--glow),.95),inset 0 0 14px rgba(var(--glow),.4)}}
.burning-orb.claimed{opacity:.55;filter:grayscale(.35)}
.burning-orb.locked{opacity:.42;filter:grayscale(.7)}
.burning-fire{font-size:clamp(22px,6vw,30px);line-height:1;filter:drop-shadow(0 0 6px rgba(251,146,60,.85))}
.burning-orb-check{position:absolute;bottom:-3px;right:-3px;width:18px;height:18px;border-radius:50%;background:#22c55e;color:#04140a;font-size:11px;font-weight:900;display:grid;place-items:center;border:2px solid #07121f}
.burning-orb-lock{position:absolute;bottom:-3px;right:-3px;font-size:13px;filter:drop-shadow(0 1px 1px #000)}
.burning-level-badge>span{width:clamp(32px,9vw,46px);height:clamp(32px,9vw,46px);border-radius:50%;display:grid;place-items:center;font-weight:900;font-size:clamp(10px,2.6vw,14px);color:#f3e8ff;background:radial-gradient(circle at 40% 30%,#3b1d6e,#150a2c);border:2px solid rgba(168,85,247,.7);box-shadow:0 0 14px rgba(168,85,247,.5)}
.burning-point-icon{width:16px;height:16px;object-fit:contain;vertical-align:-3px;margin-right:2px}
/* 보상 모달 */
.burning-modal-body{display:flex;flex-direction:column;gap:8px}
.burning-modal-row{display:flex;align-items:center;gap:12px;padding:8px 4px}
.burning-modal-thumb{position:relative;width:54px;height:54px;flex:0 0 auto;display:grid;place-items:center}
.burning-modal-thumb img{max-width:100%;max-height:100%;object-fit:contain}
.burning-modal-thumb.title{width:auto;min-width:54px;height:42px}
.burning-modal-thumb.title img{max-width:160px;max-height:42px;width:auto}
.burning-modal-name{flex:1;font-weight:800;color:#e5e7eb;font-size:14px}
.burning-modal-count{font-weight:900;color:#fbbf24;font-variant-numeric:tabular-nums}
.burning-modal-claim,.burning-unlock-btn{margin-top:6px;width:100%;padding:12px;border:0;border-radius:12px;font-weight:900;font-size:15px;cursor:pointer;background:linear-gradient(135deg,#f97316,#dc2626);color:#fff;box-shadow:0 6px 18px rgba(220,38,38,.4)}
.burning-modal-claim:hover,.burning-modal-claim:focus,.burning-modal-claim:active,.burning-unlock-btn:hover,.burning-unlock-btn:focus,.burning-unlock-btn:active{background:linear-gradient(135deg,#fb923c,#ef4444);color:#fff;outline:none}
.burning-modal-claim:disabled,.burning-unlock-btn:disabled{opacity:.6;cursor:default}
/* 메가 해금 모달 */
.burning-unlock-modal{display:flex;flex-direction:column;align-items:center;text-align:center;gap:12px;padding:6px 2px}
.burning-unlock-icon{font-size:52px;line-height:1;filter:drop-shadow(0 0 16px rgba(217,70,239,.7))}
.burning-unlock-desc{font-size:14px;color:#cbd5e1;font-weight:700;line-height:1.55}
.burning-unlock-cost{display:flex;align-items:center;gap:6px;font-size:15px;font-weight:900;color:#e9d5ff;padding:8px 16px;border-radius:999px;background:rgba(168,85,247,.14);border:1px solid rgba(168,85,247,.4)}
.burning-unlock-cost img{width:20px;height:20px;object-fit:contain}
.burning-unlock-btn{background:linear-gradient(135deg,#7c3aed,#d946ef);box-shadow:0 0 18px rgba(168,85,247,.5),0 6px 16px rgba(0,0,0,.4)}
.burning-unlock-btn:hover,.burning-unlock-btn:focus,.burning-unlock-btn:active{background:linear-gradient(135deg,#8b5cf6,#e879f9)}
@media(max-width:560px){.burning-board{--bcell:104px;--bgap:9px;padding:9px}}
.mc-body{display:flex;flex-direction:column;gap:11px}
.mc-section{display:flex;align-items:center;gap:10px;margin:8px 0 1px}
.mc-section-line{flex:1;height:1px;background:linear-gradient(90deg,transparent,rgba(192,132,252,.4),transparent)}
.mc-section-label{font-size:11px;font-weight:800;letter-spacing:.12em;color:#d8b4fe;padding:4px 14px;border:1px solid rgba(192,132,252,.4);border-radius:999px;background:rgba(192,132,252,.12);box-shadow:0 0 14px rgba(192,132,252,.18)}
.mc-panel{position:relative;background:linear-gradient(135deg,rgba(12,16,34,.92),rgba(18,22,46,.7));border:1px solid rgba(148,163,184,.16);border-radius:15px;padding:14px 16px;box-shadow:0 8px 22px rgba(0,0,0,.35);overflow:hidden}
.mc-panel::before{content:'';position:absolute;left:0;top:0;bottom:0;width:3px;background:var(--mc-accent,linear-gradient(180deg,#818cf8,#6366f1))}
.mc-panel.skill{--mc-accent:linear-gradient(180deg,#818cf8,#4f46e5)}
.mc-panel.slot{--mc-accent:linear-gradient(180deg,#4ade80,#16a34a)}
.mc-panel.locked{--mc-accent:linear-gradient(180deg,#64748b,#475569);opacity:.78}
.mc-head{display:flex;align-items:center;justify-content:space-between;gap:10px}
.mc-name{font-size:15px;font-weight:800;color:#f8fafc;line-height:1.3}
.mc-chips{display:flex;gap:6px;flex-shrink:0;flex-wrap:wrap;justify-content:flex-end}
.mc-chip{font-size:11px;font-weight:700;padding:3px 10px;border-radius:999px;white-space:nowrap;line-height:1.5}
.mc-chip.mp{color:#93c5fd;background:rgba(59,130,246,.15);border:1px solid rgba(59,130,246,.32)}
.mc-chip.cd{color:#fcd34d;background:rgba(251,191,36,.12);border:1px solid rgba(251,191,36,.3)}
.mc-chip.val{color:#86efac;background:rgba(34,197,94,.15);border:1px solid rgba(34,197,94,.34);font-size:13px}
.mc-desc{margin-top:9px;font-size:13px;line-height:1.62;color:#cbd5e1;display:flex;flex-direction:column;gap:3px}
.mc-note{margin-top:8px;font-size:12px;color:#94a3b8;line-height:1.5}
.mc-note.warn{color:#fcd34d}
.mc-empty{padding:22px;text-align:center;color:#64748b;font-size:14px}
.page[data-page="mail"]{width:100vw;margin-left:calc(50% - 50vw);margin-right:calc(50% - 50vw);margin-top:-26px;margin-bottom:-50px}
.page[data-page="mail"].active{display:block}
.mailbox{position:relative;display:flex;height:calc(100svh - 104px);background:#05070d;overflow:hidden}
.mailbox-list-pane{width:380px;flex:0 0 380px;display:flex;flex-direction:column;border-right:1px solid rgba(148,163,184,.12);min-height:0}
.mailbox-head{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:18px 20px;border-bottom:1px solid rgba(148,163,184,.1)}
.mailbox-head h2{margin:0;font-size:19px;color:#f8fafc}
.mail-compose-btn{padding:9px 14px;font-size:13px;font-weight:800}
.mailbox-list{flex:1;overflow-y:auto;min-height:0;padding:8px;display:flex;flex-direction:column;gap:4px}
.mail-row{display:flex;gap:11px;align-items:flex-start;padding:13px 14px;border-radius:12px;cursor:pointer;transition:background .12s;border:1px solid transparent}
.mail-row:hover{background:rgba(255,255,255,.03)}
.mail-row.active{background:rgba(88,101,242,.14);border-color:rgba(99,102,241,.4)}
.mail-row.unread .mail-row-subject{font-weight:800;color:#f8fafc}
.mail-dot{width:9px;height:9px;border-radius:50%;background:#6366f1;flex:0 0 auto;margin-top:6px;box-shadow:0 0 8px rgba(99,102,241,.6)}
.mail-dot.read{background:transparent;box-shadow:none}
.mail-row-main{flex:1;min-width:0}
.mail-row-top{display:flex;justify-content:space-between;gap:8px;align-items:baseline}
.mail-row-from{font-size:12px;color:#93c5fd;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mail-row-date{font-size:11px;color:#64748b;flex:0 0 auto}
.mail-row-subject{font-size:14px;color:#cbd5e1;margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mail-row-tags{display:flex;gap:5px;margin-top:6px;flex-wrap:wrap}
.mail-tag-gift{font-size:10px;font-weight:800;color:#fcd34d;background:rgba(251,191,36,.12);border:1px solid rgba(251,191,36,.3);border-radius:999px;padding:2px 8px}
.mail-tag-gift.claimed{color:#86efac;background:rgba(34,197,94,.1);border-color:rgba(34,197,94,.28)}
.gm-tag{display:inline-block;font-size:10px;font-weight:900;color:#fff;background:linear-gradient(135deg,#f59e0b,#d97706);border-radius:5px;padding:1px 5px;margin-right:5px;letter-spacing:.04em;vertical-align:middle;box-shadow:0 0 8px rgba(245,158,11,.35)}
.mailbox-head h2{display:flex;align-items:center;gap:9px}
.mail-head-svg{width:22px;height:22px;color:#818cf8}
.mail-compose-btn{display:inline-flex;align-items:center;gap:7px}
.mail-compose-btn svg{width:16px;height:16px}
.mail-detail-empty svg{width:50px;height:50px;opacity:.45}
.mail-tag-gift{display:inline-flex;align-items:center;gap:4px}
.mtg-icon{width:12px;height:12px}
.mail-gift-title svg{width:16px;height:16px}
.mail-claimed-badge{display:flex;align-items:center;justify-content:center;gap:7px}
.mail-claimed-badge svg{width:16px;height:16px}
.mail-claim-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px}
.mail-claim-btn svg{width:17px;height:17px}
.mail-gift-thumb{position:relative;width:40px;height:40px;flex:0 0 auto;display:grid;place-items:center;border-radius:9px;background:rgba(15,23,42,.5);overflow:hidden}
.mg-frame{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;z-index:1}
.mg-icon{position:relative;z-index:2;width:80%;height:80%;object-fit:contain;filter:drop-shadow(0 2px 4px rgba(0,0,0,.5))}
.mg-fallback{position:relative;z-index:2;color:#94a3b8}
.mg-fallback svg{width:20px;height:20px}
.mg-label{flex:1;min-width:0;word-break:break-word}
/* 메일 전용 모달 */
.mail-modal-bg{position:fixed;inset:0;background:rgba(0,0,0,.74);display:none;align-items:center;justify-content:center;z-index:90;backdrop-filter:blur(7px);-webkit-backdrop-filter:blur(7px);padding:16px}
.mail-modal-bg.active{display:flex}
.mail-modal{position:relative;width:min(420px,100%);max-height:88vh;display:flex;flex-direction:column;background:linear-gradient(180deg,rgba(13,17,30,.99),rgba(8,11,21,.99));border:1px solid rgba(255,255,255,.1);border-radius:20px;box-shadow:0 30px 80px rgba(0,0,0,.7),0 0 0 1px rgba(255,255,255,.03) inset;overflow:hidden;animation:mmPop .18s ease}
.mail-modal.wide{width:min(520px,100%)}
@keyframes mmPop{from{transform:translateY(8px) scale(.98);opacity:0}to{transform:none;opacity:1}}
.mm-head{display:flex;align-items:center;gap:10px;padding:16px 56px 14px 20px;border-bottom:1px solid rgba(148,163,184,.12)}
.mm-titlewrap{display:flex;align-items:center;gap:10px;min-width:0;flex:1}
.mm-headicon{display:grid;place-items:center;width:34px;height:34px;border-radius:10px;background:rgba(99,102,241,.15);color:#a5b4fc;flex:0 0 auto}
.mm-headicon svg{width:18px;height:18px}
.mm-title{font-size:17px;font-weight:800;color:#f8fafc;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mm-close{position:absolute;top:14px;right:14px;z-index:2;display:grid;place-items:center;width:32px;height:32px;padding:0;border-radius:9px;background:rgba(255,255,255,.05);border:none;color:#94a3b8;cursor:pointer}
.mm-close:hover{background:rgba(255,255,255,.1);color:#e2e8f0}
.mm-close svg{display:block;width:16px;height:16px}
.mm-body{padding:18px 20px;overflow-y:auto}
.mm-foot{display:flex;gap:10px;padding:14px 20px 18px;border-top:1px solid rgba(148,163,184,.1)}
.mm-btn{flex:1;padding:12px;border-radius:11px;font-size:14px;font-weight:800;cursor:pointer;border:1px solid transparent;font-family:inherit}
.mm-btn.primary{background:linear-gradient(135deg,#5865f2,#4338ca);color:#fff;box-shadow:0 4px 14px rgba(88,101,242,.4)}
.mm-btn.primary:hover{filter:brightness(1.08)}
.mm-btn.primary:disabled{opacity:.5;cursor:default}
.mm-btn.ghost{background:rgba(255,255,255,.05);border-color:rgba(255,255,255,.1);color:#cbd5e1}
.mm-btn.ghost:hover{background:rgba(255,255,255,.1)}
.mm-btn.danger{background:#dc2626;color:#fff}
.mm-message{font-size:14px;line-height:1.65;color:#cbd5e1}
.mm-msg-text{white-space:pre-wrap}
/* 메일 작성 모달 내부 */
.mc-view{display:flex;flex-direction:column;gap:13px}
.mc-field{display:flex;flex-direction:column;gap:6px}
.mc-label{font-size:12px;font-weight:700;color:#94a3b8}
.mc-input,.mc-textarea{width:100%;padding:11px 13px;border-radius:11px;border:1px solid rgba(255,255,255,.1);background:rgba(4,6,18,.85);color:#e5e7eb;font-size:14px;font-family:inherit;transition:border-color .15s}
.mc-input:focus,.mc-textarea:focus{outline:none;border-color:rgba(99,102,241,.6);box-shadow:0 0 0 3px rgba(99,102,241,.12)}
.mc-textarea{min-height:110px;resize:vertical;line-height:1.6}
.mc-section-label{font-size:12px;font-weight:800;color:#cbd5e1;margin-top:2px}
.mc-add-row{display:grid;grid-template-columns:repeat(5,1fr);gap:7px}
.mc-add-btn{display:flex;flex-direction:column;align-items:center;gap:5px;padding:11px 4px;border-radius:12px;background:rgba(88,101,242,.1);border:1px solid rgba(99,102,241,.25);color:#c7d2fe;font-size:12px;font-weight:700;cursor:pointer;transition:transform .14s,background .14s,border-color .14s}
.mc-add-btn:hover{background:rgba(88,101,242,.2);border-color:rgba(99,102,241,.5);transform:translateY(-1px)}
.mc-add-ic{display:grid;place-items:center;height:22px}
.mc-add-ic svg{width:20px;height:20px}
.mc-add-img{width:22px;height:22px;object-fit:contain}
.mc-gift-slots{display:flex;flex-direction:column;gap:7px}
.mc-gift-empty{padding:16px;text-align:center;color:#64748b;font-size:13px;background:rgba(4,6,18,.4);border:1px dashed rgba(148,163,184,.2);border-radius:11px}
.mc-gift-slot{display:flex;align-items:center;gap:10px;padding:9px 11px;background:rgba(4,6,18,.6);border:1px solid rgba(148,163,184,.14);border-radius:11px}
.mc-slot-label{flex:1;min-width:0;font-size:13px;font-weight:600;color:#e2e8f0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mc-slot-remove{display:grid;place-items:center;width:26px;height:26px;border-radius:8px;background:rgba(127,29,29,.4);border:none;color:#fecaca;cursor:pointer;flex:0 0 auto}
.mc-slot-remove:hover{background:rgba(153,27,27,.6)}
.mc-slot-remove svg{width:13px;height:13px}
.mc-fee-note{font-size:12px;color:#fcd34d;line-height:1.5}
.mc-error{font-size:13px;color:#fca5a5;font-weight:600}
.mc-asset-head{display:flex;align-items:center;gap:12px;padding:12px;background:rgba(4,6,18,.5);border-radius:12px}
.mc-asset-img{width:42px;height:42px;object-fit:contain}
.mc-asset-name{font-size:15px;font-weight:800;color:#f8fafc}
.mc-asset-bal{font-size:12px;color:#94a3b8;margin-top:2px}
.mc-preview{font-size:12px;color:#86efac;font-weight:600}
.mc-pick-list{display:flex;flex-direction:column;gap:6px;max-height:52vh;overflow-y:auto}
.mc-pick-row{display:flex;align-items:center;gap:11px;padding:9px 11px;border-radius:11px;background:rgba(4,6,18,.5);border:1px solid rgba(255,255,255,.06);cursor:pointer;transition:border-color .14s,background .14s}
.mc-pick-row:hover{border-color:rgba(99,102,241,.5);background:rgba(88,101,242,.12)}
.mc-pick-main{min-width:0;flex:1}
.mc-pick-name{font-size:14px;font-weight:700;color:#f1f5f9;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mc-pick-sub{font-size:12px;color:#94a3b8;margin-top:2px}
.mailbox-empty{padding:48px 20px;text-align:center;color:#64748b;font-size:14px;line-height:1.7}
.mail-pager{display:flex;align-items:center;justify-content:center;gap:12px;padding:12px;border-top:1px solid rgba(148,163,184,.1);flex:0 0 auto}
.mail-pager button{padding:7px 13px;font-size:13px;background:rgba(88,101,242,.14);border:1px solid rgba(99,102,241,.3);color:#c7d2fe;border-radius:9px;font-weight:800;cursor:pointer}
.mail-pager button:disabled{opacity:.35;cursor:default}
.mail-pager .mail-page-info{font-size:13px;color:#94a3b8;font-variant-numeric:tabular-nums;font-weight:700}
.mailbox-detail-pane{flex:1;min-width:0;display:flex;flex-direction:column;position:relative;overflow-y:auto}
.mail-back-btn{display:none;position:sticky;top:0;z-index:2;background:rgba(5,7,13,.94);border:none;border-bottom:1px solid rgba(148,163,184,.12);color:#93c5fd;font-size:14px;font-weight:700;padding:14px 18px;text-align:left;cursor:pointer}
.mail-detail-empty{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;color:#475569}
.mail-detail-empty span{font-size:46px;opacity:.55}
.mail-detail-empty p{margin:0;font-size:14px}
.mail-detail{padding:30px 34px;max-width:760px;width:100%;margin:0 auto}
.mail-detail-subject{font-size:23px;font-weight:900;color:#f8fafc;line-height:1.32;margin:0 0 14px;word-break:break-word}
.mail-detail-meta{display:flex;gap:14px;align-items:center;flex-wrap:wrap;padding-bottom:16px;border-bottom:1px solid rgba(148,163,184,.14);font-size:13px;color:#94a3b8}
.mail-detail-meta b{color:#93c5fd}
.mail-detail-body{padding:22px 0;font-size:15px;line-height:1.78;color:#e2e8f0;white-space:pre-wrap;word-break:break-word;min-height:70px}
.mail-gift-box{margin-top:4px;background:linear-gradient(135deg,rgba(12,16,34,.9),rgba(18,22,46,.6));border:1px solid rgba(251,191,36,.22);border-radius:16px;padding:18px}
.mail-gift-title{font-size:13px;font-weight:800;color:#fcd34d;margin-bottom:12px;display:flex;align-items:center;gap:8px}
.mail-gift-list{display:flex;flex-direction:column;gap:8px}
.mail-gift-item{display:flex;align-items:center;gap:8px;padding:11px 14px;background:rgba(4,6,18,.6);border:1px solid rgba(148,163,184,.12);border-radius:11px;font-size:14px;color:#e2e8f0;font-weight:600}
.mail-claim-btn{margin-top:14px;width:100%;padding:13px;font-size:15px;font-weight:800}
.mail-claimed-badge{margin-top:14px;text-align:center;color:#86efac;font-size:14px;font-weight:800;padding:12px;background:rgba(34,197,94,.1);border:1px solid rgba(34,197,94,.28);border-radius:12px}
.mail-compose-field{display:flex;flex-direction:column;gap:6px;margin-bottom:14px}
.mail-compose-field label{font-size:13px;font-weight:700;color:#94a3b8}
.mail-compose-field input,.mail-compose-field textarea{width:100%;padding:11px 13px;border-radius:10px;border:1px solid rgba(255,255,255,.1);background:rgba(4,6,18,.85);color:#e5e7eb;font-size:14px;font-family:inherit}
.mail-compose-field textarea{min-height:110px;resize:vertical;line-height:1.6}
.mail-gift-slots{display:flex;flex-direction:column;gap:7px;margin-bottom:8px}
.mail-gift-slot{display:flex;align-items:center;gap:8px;padding:10px 12px;background:rgba(4,6,18,.6);border:1px solid rgba(148,163,184,.14);border-radius:10px;font-size:13px}
.mail-gift-slot .slot-label{flex:1;min-width:0;color:#e2e8f0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mail-gift-slot .slot-remove{background:rgba(127,29,29,.4);border:none;color:#fecaca;width:26px;height:26px;border-radius:7px;cursor:pointer;font-weight:900;flex:0 0 auto}
.mail-gift-add{display:flex;gap:6px;flex-wrap:wrap;margin:4px 0 8px}
.mail-gift-add button{flex:1 0 auto;font-size:12px;padding:8px 10px;background:rgba(88,101,242,.14);border:1px solid rgba(99,102,241,.3);color:#c7d2fe;border-radius:9px;font-weight:700}
.mail-fee-note{font-size:12px;color:#fcd34d;margin-top:2px;line-height:1.5}
.group-tab,.bottom-tab{position:relative}
.mail-badge{position:absolute;top:2px;right:0;min-width:17px;height:17px;padding:0 4px;border-radius:999px;background:#ef4444;color:#fff;font-size:11px;font-weight:900;display:flex;align-items:center;justify-content:center;line-height:1;box-shadow:0 0 0 2px rgba(5,6,12,.9)}
.bottom-tab .mail-badge{top:-2px;right:8px}
.subnav-tab{position:relative}
.subnav-tab .mail-badge{top:-5px;right:-7px}
@media(max-width:768px){
  .page[data-page="mail"]{margin-top:-14px;margin-bottom:-30px}
  .mailbox{height:calc(100svh - 92px)}
  .mailbox-list-pane{width:100%;flex:1 1 auto;border-right:none}
  .mailbox.show-detail .mailbox-list-pane{display:none}
  .mailbox-detail-pane{display:none}
  .mailbox.show-detail .mailbox-detail-pane{display:flex;position:absolute;inset:0;z-index:5;background:#05070d}
  .mail-back-btn{display:block}
  .mail-detail{padding:18px}
  .mail-detail-subject{font-size:20px}
}
</style></head><body>
<header><div class="top-left"><h1>RPGenius</h1><nav class="group-tabs" id="groupTabs"></nav></div><div class="bar"><div class="point-pill" id="pointPill" title="보유 포인트"><img src="${getItemImageUrl('화폐', '포인트.png')}" alt="포인트"><b id="pointAmount">0</b><button id="pointAddBtn" type="button" aria-label="포인트 충전">+</button></div><span class="who" id="who">${escapeHtml(sess.name)}</span><button id="adminLink" class="primary" style="display:none;padding:8px 12px;font-size:13px">관리자</button><button id="logout" style="padding:8px 12px;font-size:13px">로그아웃</button></div></header>
<div class="subnav-bar" id="subNavBar"></div>
<main id="app">
  <div class="page active" data-page="info">
    <div id="profileBanner" class="profile-banner" style="display:none"><span id="profileBannerText"></span><button id="profileBackBtn" class="primary">내 정보로 돌아가기</button></div>
    <section class="panel"><div class="profile-hero"><div id="mainCard" class="profile-card"></div><div class="profile-summary"><div class="name-line"><span id="profileTitle"></span><span id="level">-</span> <span id="profileName">-</span> <span id="exp" style="color:#94a3b8;font-size:15px">-</span></div><div class="status-row"><span>HP</span><div class="meter hp"><div class="meter-fill" id="hpFill"></div></div><b id="hp">-</b></div><div class="status-row"><span>MP</span><div class="meter mp"><div class="meter-fill" id="mpFill"></div></div><b id="mp">-</b></div><div class="power-line">⚔️ <b id="totalPower">-</b></div><div id="petRow" class="pet-row"></div></div></div></section>
    <section class="panel"><h2>장착 중인 카드 슬롯</h2><div id="slotCards" class="cards"></div></section>
    <section class="panel"><h2>재화</h2><div id="goods" class="grid"></div></section>
    <section class="panel stat-panel"><div class="stat-head"><button class="stat-toggle" id="statToggle" type="button"><span>스탯</span><span class="stat-chevron" id="statChevron">▾</span></button><label class="stat-filter"><input type="checkbox" id="statHideZero"><span>비보유 숨기기</span></label></div><div id="stats" class="stat-body"></div></section>
    <section class="panel"><h2>장착 장비</h2><div id="equippedGear" class="equip-grid"></div></section>
    <button id="viewInventoryBtn" class="primary" style="display:none;justify-self:center;padding:12px 22px;font-size:15px">인벤토리 보기</button>
  </div>
  <div class="page" data-page="inventory">
    <div id="inventoryBanner" class="profile-banner" style="display:none"><span id="inventoryBannerText"></span><button id="inventoryBackBtn" class="primary">내 인벤토리로 돌아가기</button></div>
    <section class="panel" style="min-width:0"><h2 id="viewerTitle" style="margin:0 0 10px">인벤토리</h2><div class="inv-kind-tabs"><button class="view-btn inv-kind-tab" data-kind="items">인벤토리</button><button class="view-btn inv-kind-tab" data-kind="cards">캐릭터 카드</button><button class="view-btn inv-kind-tab" data-kind="equipment">보유 장비</button><button class="view-btn inv-kind-tab" data-kind="pet">보유 펫</button></div><div id="viewer" class="viewer" style="margin-top:14px"></div></section>
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
  <div class="page" data-page="event">
    <section class="event-dice-panel"><div id="eventDiceRoot"></div></section>
  </div>
  <div class="page" data-page="버닝">
    <section class="panel"><div id="burningRoot"></div></section>
  </div>
  <div class="page" data-page="자물쇠">
    <section class="lockbox-panel"><div id="lockboxRoot"></div></section>
  </div>
  <div class="page" data-page="펀치기계">
    <section class="punch-panel"><div id="punchRoot"></div></section>
  </div>
  <div class="page" data-page="combine">
    <section class="panel combine-board">
      <div class="combine-wrap">
        <div class="combine-stage" id="combineStage"></div>
        <div class="combine-info" id="combineInfo"></div>
      </div>
    </section>
    <section class="panel"><h2>보유 캐릭터 카드</h2><div id="combinePool" class="card-grid"></div></section>
  </div>
  <div class="page" data-page="jobcombine">
    <section class="panel jobcombine-board">
      <div class="jobcombine-wrap">
        <div class="jobcombine-stage" id="jobCombineStage"></div>
        <div class="jobcombine-info" id="jobCombineInfo"></div>
      </div>
    </section>
    <section class="panel"><h2>보유 캐릭터 카드 (전직 가능)</h2><div id="jobCombinePool" class="card-grid"></div></section>
  </div>
  <div class="page" data-page="레벨보상">
    <section class="panel"><h2>레벨 달성 보상</h2><div id="levelRewardList" class="lvreward-list"></div></section>
  </div>
  <div class="page" data-page="auction"><section class="panel"><div class="auction-bar"><h2 style="margin:0">팝니다</h2><div class="actions"><input id="aucSearch" class="search-input" placeholder="검색..." autocomplete="off"><div class="seg" id="aucFilter"><button data-filter="all" class="on">전체</button><button data-filter="card">카드</button><button data-filter="equipment">장비</button><button data-filter="pet">펫</button><button data-filter="item">아이템</button><button data-filter="mine">내 판매</button></div><button class="primary" id="aucNew">+ 등록</button></div></div><div id="auctionList" class="auction-grid"></div></section></div>
  <div class="page" data-page="ranking"><section class="panel rank-section"><div class="auction-bar"><h2 style="margin:0">랭킹</h2><div class="rank-tabs"><button class="rank-tab active" data-tab="cp">전투력 랭킹</button><button class="rank-tab" data-tab="exp">경험치 랭킹</button><button class="rank-tab" data-tab="worldBoss">월드보스 랭킹</button></div></div><div id="rankMe"></div><div id="rankList" class="rank-list"></div></section></div>
  <div class="page" data-page="dex"><section class="panel"><div class="auction-bar"><h2 style="margin:0">도감</h2><div class="dex-tabs"><button class="dex-tab active" data-tab="weapon">무기</button><button class="dex-tab" data-tab="armor">갑옷</button><button class="dex-tab" data-tab="accessory">장신구</button><button class="dex-tab" data-tab="support">보조</button><button class="dex-tab" data-tab="pet">펫</button><button class="dex-tab" data-tab="character">캐릭터 카드</button><button class="dex-tab" data-tab="title">칭호</button><button class="dex-tab" data-tab="potential">잠재능력</button></div></div><div id="dexList" class="dex-grid"></div></section></div>
  <div class="page" data-page="shop"><section class="panel shop-wrap"><div id="shopBody"></div></section></div>
  <div class="page" data-page="buyorder"><section class="panel"><div class="auction-bar"><h2 style="margin:0">삽니다</h2><div class="actions"><input id="boSearch" class="search-input" placeholder="검색..." autocomplete="off"><div class="seg" id="boFilter"><button data-filter="all" class="on">전체</button><button data-filter="card">카드</button><button data-filter="equipment">장비</button><button data-filter="pet">펫</button><button data-filter="item">아이템</button><button data-filter="mine">내 구매</button></div><button class="primary" id="boNew">+ 구매 등록</button></div></div><div id="buyOrderList" class="auction-grid"></div></section></div>
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

function renderPartyApp(sess) {
    return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><title>파티 퀘스트 · RPGenius</title>
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<style>
:root{color-scheme:dark;--frame-w:440px;--frame-h:900px}
*{box-sizing:border-box}
html,body{margin:0;padding:0;height:100%;overflow:hidden}
body{background:#000;color:#e5e7eb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;display:grid;place-items:center}
.frame{position:relative;width:min(var(--frame-w),100vw);height:min(var(--frame-h),100dvh);background:radial-gradient(circle at 30% 0%,#1e293b,#070910 55%,#05060a);border-radius:24px;overflow:hidden;box-shadow:0 30px 80px rgba(0,0,0,.6),0 0 0 1px rgba(148,163,184,.1) inset;display:flex;flex-direction:column}
@media(max-width:520px),(max-height:920px){.frame{width:100vw;height:100dvh;border-radius:0;box-shadow:none}}
.pq-header{display:flex;align-items:center;gap:10px;padding:14px 16px;border-bottom:1px solid rgba(148,163,184,.16);background:rgba(7,9,16,.65);backdrop-filter:blur(10px)}
.pq-header h1{flex:1;margin:0;font-size:16px;font-weight:800;letter-spacing:.02em;color:#f8fafc}
.pq-header .me{font-size:12px;color:#a5b4fc;font-weight:700}
.pq-icon-btn{width:36px;height:36px;border:0;border-radius:10px;background:#1f2937;color:#e5e7eb;font-size:18px;cursor:pointer;display:grid;place-items:center}
.pq-icon-btn:hover{background:#374151}
.pq-body{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:12px;-webkit-overflow-scrolling:touch}
.pq-screen{display:none;flex-direction:column;gap:12px;animation:pqfade .18s ease}
.pq-screen.active{display:flex}
@keyframes pqfade{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
.pq-room-card{display:grid;grid-template-columns:1fr auto;gap:6px 12px;padding:14px;background:rgba(2,6,23,.62);border:1px solid rgba(148,163,184,.16);border-radius:14px;cursor:pointer;transition:transform .12s,border-color .12s}
.pq-room-card:hover{transform:translateY(-1px);border-color:#5865f2}
.pq-room-card .pq-room-title{font-weight:800;color:#f8fafc;font-size:15px}
.pq-room-card .pq-room-quest{font-size:12px;color:#a5b4fc;font-weight:700}
.pq-room-card .pq-room-meta{font-size:12px;color:#94a3b8;grid-column:1/-1;display:flex;gap:10px;flex-wrap:wrap}
.pq-room-card .pq-pill{padding:2px 8px;background:rgba(88,101,242,.15);border:1px solid rgba(88,101,242,.4);color:#c7d2fe;border-radius:999px;font-size:11px;font-weight:700}
.pq-room-card .pq-pill.lock{background:rgba(251,191,36,.12);border-color:rgba(251,191,36,.45);color:#fde68a}
.pq-empty{padding:30px 16px;text-align:center;color:#94a3b8;font-size:13px;background:rgba(2,6,23,.4);border:1px dashed rgba(148,163,184,.18);border-radius:14px}
.pq-fab{position:absolute;right:16px;bottom:18px;height:54px;padding:0 22px;border:0;border-radius:999px;background:linear-gradient(135deg,#5865f2,#7c3aed);color:#fff;font-weight:800;font-size:15px;cursor:pointer;box-shadow:0 14px 36px rgba(88,101,242,.55)}
.pq-fab:hover{filter:brightness(1.08)}
.pq-section-title{font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#94a3b8;margin:6px 2px}
.pq-panel{padding:14px;background:rgba(15,23,42,.7);border:1px solid rgba(148,163,184,.16);border-radius:14px;display:flex;flex-direction:column;gap:10px}
.pq-row{display:flex;gap:8px;align-items:center}
.pq-input,.pq-select{flex:1;padding:10px 12px;background:#0b0d12;border:1px solid #334155;border-radius:10px;color:#e5e7eb;font-size:14px;outline:none}
.pq-input:focus,.pq-select:focus{border-color:#5865f2}
.pq-btn{display:inline-flex;align-items:center;justify-content:center;line-height:1;height:40px;padding:0 14px;border:0;border-radius:10px;background:#1f2937;color:#e5e7eb;font-weight:700;cursor:pointer;font-size:14px;text-align:center}
.pq-btn:hover{background:#374151}
.pq-btn.primary{background:#5865f2}
.pq-btn.primary:hover{background:#4752c4}
.pq-btn.danger{background:#7f1d1d;color:#fecaca}
.pq-btn.danger:hover{background:#991b1b}
.pq-btn.gold{background:#b45309;color:#fef3c7}
.pq-btn.gold:hover{background:#d97706}
.pq-btn:disabled{opacity:.5;cursor:not-allowed}
.pq-member{display:grid;grid-template-columns:auto 1fr auto;gap:10px;align-items:center;padding:10px 12px;background:rgba(2,6,23,.55);border:1px solid rgba(148,163,184,.14);border-radius:12px}
.pq-member.host{border-color:rgba(251,191,36,.55)}
.pq-member.me{box-shadow:0 0 0 2px rgba(88,101,242,.45) inset}
.pq-avatar{width:34px;height:34px;border-radius:10px;background:linear-gradient(135deg,#1e293b,#0f172a);display:grid;place-items:center;font-weight:800;color:#a5b4fc}
.title-badge{height:16px;width:auto;vertical-align:-3px;margin-right:4px;flex-shrink:0}
.pq-lv{font-size:12px;color:#94a3b8;font-weight:700}
.pq-name{font-weight:800;color:#f1f5f9;font-size:14px;display:flex;align-items:center;gap:6px}
.pq-tag{font-size:10px;font-weight:800;padding:2px 6px;border-radius:999px;background:#334155;color:#cbd5e1}
.pq-tag.host{background:rgba(251,191,36,.18);color:#fde68a}
.pq-tag.ready{background:rgba(34,197,94,.18);color:#bbf7d0}
.pq-tag.off{background:rgba(239,68,68,.16);color:#fecaca}
.pq-pos{font-size:12px;color:#94a3b8}
.pq-pos.set{color:#a5b4fc;font-weight:700}
.pq-position-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(96px,1fr));gap:8px}
.pq-position-btn{padding:10px 8px;border:1px solid rgba(148,163,184,.2);border-radius:12px;background:rgba(2,6,23,.55);color:#cbd5e1;font-weight:700;cursor:pointer;text-align:center;font-size:13px;transition:all .12s}
.pq-position-btn:hover{border-color:#5865f2}
.pq-position-btn.active{background:linear-gradient(135deg,#5865f2,#7c3aed);color:#fff;border-color:transparent}
.pq-position-btn.taken{opacity:.4;cursor:not-allowed}
.pq-stat-list{display:grid;gap:4px;font-size:12px;color:#cbd5e1;padding:8px 10px;background:rgba(2,6,23,.4);border-radius:10px;margin-top:6px}
.pq-chat{display:flex;flex-direction:column;gap:6px;height:120px;overflow-y:auto;padding:10px;background:rgba(2,6,23,.45);border:1px solid rgba(148,163,184,.14);border-radius:12px;font-size:13px;scrollbar-width:thin}
.pq-chat::-webkit-scrollbar{width:6px}.pq-chat::-webkit-scrollbar-thumb{background:rgba(148,163,184,.3);border-radius:3px}
.pq-chat-line{line-height:1.45}
.pq-chat-line .from{font-weight:800;color:#a5b4fc;margin-right:4px}
.pq-chat-line.system{color:#94a3b8;font-size:12px;font-style:italic}
.pq-chat-form{display:flex;gap:6px}
.pq-chat-form .pq-input{height:38px}
.pq-quest-info{font-size:12px;color:#cbd5e1;line-height:1.5}
.pq-quest-info b{color:#f8fafc}
.pq-modal-bg{position:absolute;inset:0;background:rgba(0,0,0,.7);display:none;align-items:center;justify-content:center;z-index:30;padding:18px;backdrop-filter:blur(4px)}
.pq-modal-bg.active{display:flex}
.pq-modal{width:100%;max-width:380px;background:#0f172a;border:1px solid rgba(148,163,184,.25);border-radius:16px;padding:18px;display:flex;flex-direction:column;gap:12px}
.pq-modal h3{margin:0;font-size:16px;color:#f8fafc}
.pq-quest-picker{display:flex;align-items:center;gap:6px}
.pq-quest-arrow{flex-shrink:0;width:36px;height:36px;border:1px solid rgba(148,163,184,.25);border-radius:50%;background:rgba(255,255,255,.05);color:#94a3b8;font-size:22px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background .15s,color .15s}
.pq-quest-arrow:hover{background:rgba(255,255,255,.12);color:#f8fafc}
.pq-quest-arrow:disabled{opacity:.3;cursor:not-allowed}
.pq-quest-card{flex:1;border-radius:12px;overflow:hidden;border:1px solid rgba(148,163,184,.2);background:#0b0d12;cursor:default;user-select:none}
.pq-quest-card-img{width:100%;height:140px;background:#0a0010;overflow:hidden;display:flex;align-items:center;justify-content:center;position:relative}
.pq-quest-card-img img{width:100%;height:100%;object-fit:contain;object-position:center bottom;filter:drop-shadow(0 0 14px rgba(168,85,247,.3))}
.pq-quest-card-img .pq-quest-no-img{font-size:48px;opacity:.3}
.pq-quest-card-body{padding:10px 12px;display:flex;flex-direction:column;gap:4px}
.pq-quest-card-name{font-size:15px;font-weight:900;color:#f8fafc;letter-spacing:.02em}
.pq-quest-card-meta{display:flex;gap:8px;flex-wrap:wrap}
.pq-quest-card-meta span{font-size:11px;font-weight:700;color:#94a3b8;background:rgba(255,255,255,.06);border:1px solid rgba(148,163,184,.15);border-radius:999px;padding:2px 8px}
.pq-toast{position:absolute;left:50%;bottom:78px;transform:translateX(-50%);background:rgba(15,23,42,.95);border:1px solid rgba(148,163,184,.25);border-radius:12px;padding:10px 14px;color:#fecaca;font-size:13px;font-weight:700;display:none;z-index:40;max-width:90%;text-align:center}
.pq-toast.active{display:block}
/* 휘발성 알림 (전투 진행) */
.pq-notice-stack{position:absolute;left:0;right:0;top:62px;display:flex;flex-direction:column;align-items:center;gap:6px;pointer-events:none;z-index:25;padding:0 14px}
.pq-notice{pointer-events:none;background:rgba(15,23,42,.92);border:1px solid rgba(148,163,184,.28);border-radius:999px;padding:8px 14px;font-size:13px;font-weight:700;color:#e5e7eb;box-shadow:0 10px 30px rgba(0,0,0,.45);animation:pqnotice .3s ease;max-width:92%;text-align:center}
.pq-notice.big{font-size:14px;padding:10px 18px;background:linear-gradient(135deg,rgba(124,58,237,.85),rgba(88,101,242,.85));border-color:transparent;color:#fff}
.pq-notice.success{background:linear-gradient(135deg,rgba(22,163,74,.85),rgba(5,150,105,.85));border-color:transparent;color:#ecfdf5}
.pq-notice.warn{background:rgba(180,83,9,.85);border-color:transparent;color:#fef3c7}
.pq-notice.danger{background:rgba(127,29,29,.92);border-color:rgba(239,68,68,.6);color:#fecaca}
@keyframes pqnotice{from{opacity:0;transform:translateY(-8px) scale(.96)}to{opacity:1;transform:none}}
/* 전투 진행 로그 */
.pq-combat-log{height:86px;overflow-y:auto;overflow-x:hidden;font-size:11.5px;color:#cbd5e1;line-height:1.35;display:flex;flex-direction:column;gap:2px;padding:6px 10px;background:rgba(0,0,0,.35);border-radius:10px;border:1px solid rgba(148,163,184,.12);scrollbar-width:thin}
.pq-combat-log .ln{white-space:normal;overflow-wrap:anywhere;animation:pqfade .25s ease}
.pq-combat-log .ln.attack{color:#fde68a}
.pq-combat-log .ln.skill{color:#a5b4fc}
.pq-combat-log .ln.heal{color:#86efac}
.pq-combat-log .ln.damage{color:#fecaca}
.pq-combat-log .ln.buff{color:#c7d2fe}
/* 전투 화면 */
.pq-boss{display:flex;flex-direction:column;gap:8px;padding:14px;background:linear-gradient(180deg,rgba(127,29,29,.35),rgba(2,6,23,.7));border:1px solid rgba(239,68,68,.35);border-radius:14px}
.pq-boss-head{display:flex;justify-content:space-between;align-items:baseline;gap:8px}
.pq-boss-name{font-weight:900;font-size:16px;color:#fecaca;letter-spacing:.02em}
.pq-boss-hpval{font-variant-numeric:tabular-nums;font-size:12px;color:#fecaca}
.pq-prog{position:relative;height:14px;background:rgba(0,0,0,.5);border-radius:999px;overflow:hidden;border:1px solid rgba(148,163,184,.18)}
.pq-prog .fill{position:absolute;left:0;top:0;bottom:0;width:0%;border-radius:999px;transition:width .15s linear}
.pq-prog.hp .fill{background:linear-gradient(90deg,#dc2626,#f97316)}
.pq-prog.boss-hp{height:20px;border:1px solid rgba(239,68,68,.5);box-shadow:0 0 10px rgba(220,38,38,.3)}
.pq-prog.boss-hp .fill{background:linear-gradient(90deg,#7f1d1d,#dc2626,#f97316);box-shadow:inset 0 1px 0 rgba(255,255,255,.15)}
.pq-boss-illust-wrap{position:relative;width:100%;height:220px;border-radius:12px;overflow:hidden;background:linear-gradient(180deg,rgba(30,0,40,.6),rgba(10,0,20,.85));border:1px solid rgba(168,85,247,.2)}
.pq-boss-illust{display:block;width:100%;height:100%;object-fit:contain;object-position:center bottom;user-select:none;filter:drop-shadow(0 0 18px rgba(168,85,247,.35))}
.pq-boss-illust-wrap::before{content:'';position:absolute;inset:0;background:radial-gradient(ellipse at 50% 100%,rgba(139,92,246,.12),transparent 70%);pointer-events:none;z-index:1}
.pq-boss-illust-wrap::after{content:'';position:absolute;bottom:0;left:0;right:0;height:40px;background:linear-gradient(0deg,rgba(10,0,20,.8),transparent);pointer-events:none;z-index:1}
.pq-prog.mp .fill{background:linear-gradient(90deg,#0ea5e9,#6366f1)}
.pq-prog.gauge{height:6px}
.pq-prog.gauge .fill{background:linear-gradient(90deg,#facc15,#f59e0b)}
.pq-prog.shield .fill{background:linear-gradient(90deg,#22d3ee,#67e8f9)}
.pq-mob-stage{position:relative;display:flex;flex-direction:column;gap:10px}
.pq-mob-counter{display:flex;flex-direction:column;align-items:center;gap:8px;padding:18px;background:radial-gradient(circle at 50% 0%,rgba(124,58,237,.25),rgba(2,6,23,.7));border:1px solid rgba(148,163,184,.2);border-radius:18px}
.pq-dmg-pop{position:absolute;left:50%;top:38%;transform:translate(-50%,0);pointer-events:none;font-size:32px;font-weight:900;color:#fde047;text-shadow:0 2px 10px rgba(0,0,0,.85),0 0 18px rgba(251,191,36,.55);letter-spacing:.02em;animation:pqDmgPop 950ms cubic-bezier(.22,.61,.36,1) forwards;white-space:nowrap;z-index:5}
.pq-dmg-pop.crit{color:#fca5a5;font-size:42px;text-shadow:0 2px 12px rgba(0,0,0,.95),0 0 22px rgba(220,38,38,.75)}
.pq-dmg-pop.fixed{color:#67e8f9;text-shadow:0 2px 12px rgba(0,0,0,.95),0 0 22px rgba(6,182,212,.75)}
.pq-dmg-pop.other{font-size:22px;color:#cbd5e1;opacity:.85}
.pq-dmg-pop .by{display:block;font-size:11px;color:#94a3b8;font-weight:700;letter-spacing:.04em;margin-bottom:2px;text-shadow:none}
.pq-dmg-pop .sub{display:block;font-size:11px;color:#a5b4fc;font-weight:700;letter-spacing:.04em;margin-top:2px;text-shadow:none}
.pq-dmg-pop .sub.combo-label{color:#fef08a}
.pq-dmg-pop .sub.fixed-label{display:inline-block;color:#a5f3fc;border:1px solid rgba(103,232,249,.45);background:rgba(8,145,178,.18);border-radius:999px;padding:1px 7px}
@keyframes pqDmgPop{0%{transform:translate(-50%,10px) scale(.6);opacity:0}15%{transform:translate(-50%,-12px) scale(1.2);opacity:1}40%{transform:translate(-50%,-32px) scale(1);opacity:1}100%{transform:translate(-50%,-90px) scale(.95);opacity:0}}
.pq-attack-btn{position:relative}
.pq-attack-btn::after{content:'';position:absolute;inset:0;border-radius:18px;background:radial-gradient(circle,rgba(255,255,255,.35),transparent 60%);opacity:0;transition:opacity .15s}
.pq-attack-btn.flash::after{opacity:1;transition:opacity 0s}
.pq-mob-counter .n{font-size:34px;font-weight:900;color:#f8fafc;font-variant-numeric:tabular-nums;letter-spacing:.02em}
.pq-mob-counter .lbl{font-size:11px;color:#94a3b8;letter-spacing:.1em;text-transform:uppercase;font-weight:800}
.pq-attack-btn{width:100%;height:64px;border:0;border-radius:18px;background:linear-gradient(135deg,#dc2626,#7c2d12);color:#fff;font-weight:900;font-size:18px;letter-spacing:.04em;cursor:pointer;box-shadow:0 14px 30px rgba(220,38,38,.4);transition:transform .08s}
.pq-attack-btn:active{transform:scale(.97)}
.pq-attack-btn:disabled{opacity:.5;cursor:not-allowed}
.pq-party-row{display:flex;flex-direction:column;gap:6px;padding:10px;background:rgba(2,6,23,.55);border:1px solid rgba(148,163,184,.14);border-radius:12px}
.pq-party-row.dead{opacity:.45;filter:grayscale(.7)}
.pq-party-row.taunt{border-color:rgba(251,191,36,.55)}
.pq-party-row .ph{display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:13px}
.pq-party-row .ph .nm{font-weight:800;color:#f1f5f9}
.pq-party-row .ph .pos{font-size:11px;color:#a5b4fc;font-weight:700}
.pq-party-row .vals{font-size:11px;color:#94a3b8;display:flex;gap:8px;font-variant-numeric:tabular-nums}
.pq-combat-hud{position:sticky;top:0;z-index:30;padding:8px;background:rgba(15,23,42,.94);border:1px solid rgba(148,163,184,.14);border-radius:14px;box-shadow:0 10px 24px rgba(0,0,0,.28);backdrop-filter:blur(10px)}
.pq-party-mini-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:5px}
.pq-party-mini{padding:6px;gap:4px;border-radius:9px;min-width:0}
.pq-party-mini .ph{font-size:clamp(7px,2.2vw,10px);gap:3px}
.pq-party-mini .ph .nm{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pq-party-mini .ph .pos{font-size:clamp(7px,2vw,10px);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pq-party-mini .vals{font-size:9px;gap:3px;justify-content:space-between}
.pq-my-hp{margin-top:7px;padding:9px;background:rgba(2,6,23,.62);border:1px solid rgba(34,197,94,.26);border-radius:12px}
.pq-my-hp .top{display:flex;justify-content:space-between;gap:8px;font-size:13px;font-weight:900;color:#f8fafc}
.pq-my-hp .vals{margin-top:5px;font-size:11px;color:#94a3b8;display:flex;justify-content:space-between}
.pq-my-hp .pq-prog.mp{margin-top:5px}
.pq-my-buffs{margin-top:6px}
.pq-target-hp{min-width:126px;text-align:right}
.pq-target-hp .txt{color:#e2e8f0;font-size:12px;font-weight:800}
.pq-target-hp .pct{color:#94a3b8;font-size:10px;margin-top:2px}
.pq-target-hp .pq-prog{margin-top:5px;height:6px}
.pq-buff-row{display:flex;flex-wrap:wrap;gap:4px;margin-top:2px}
.pq-buff-chip{display:inline-flex;align-items:center;padding:2px 6px;border-radius:999px;background:rgba(99,102,241,.16);border:1px solid rgba(129,140,248,.35);color:#c7d2fe;font-size:10px;font-weight:800}
.pq-skill-bar{display:grid;grid-template-columns:repeat(auto-fill,minmax(82px,1fr));gap:6px}
.pq-skill-btn{position:relative;padding:8px 8px;border-radius:10px;border:1px solid rgba(148,163,184,.18);background:rgba(2,6,23,.55);color:#e5e7eb;font-weight:700;font-size:11px;cursor:pointer;text-align:center;line-height:1.25;min-height:54px;display:flex;flex-direction:column;justify-content:center;align-items:center;gap:2px;transition:border-color .12s}
.pq-skill-btn:hover{border-color:#5865f2}
.pq-skill-btn:disabled{opacity:.55;cursor:not-allowed}
.pq-skill-btn .mp{font-size:10px;color:#7dd3fc;font-weight:800}
.pq-skill-btn .cd{position:absolute;inset:0;display:grid;place-items:center;background:rgba(0,0,0,.55);border-radius:10px;color:#fde68a;font-weight:900;font-size:14px;pointer-events:none}
.pq-target-list{display:flex;flex-direction:column;gap:6px}
.pq-target-row{display:flex;justify-content:space-between;align-items:center;padding:10px 12px;background:rgba(2,6,23,.55);border:1px solid rgba(148,163,184,.14);border-radius:10px;cursor:pointer}
.pq-target-row:hover{border-color:#5865f2}
.pq-choice-grid{display:grid;gap:8px}
.pq-choice{padding:12px;background:rgba(2,6,23,.6);border:1px solid rgba(148,163,184,.18);border-radius:12px;cursor:pointer;display:flex;flex-direction:column;gap:4px;text-align:left}
.pq-choice:hover{border-color:#5865f2;transform:translateY(-1px)}
.pq-choice .ttl{font-weight:800;color:#f8fafc;font-size:14px}
.pq-choice .desc{font-size:12px;color:#cbd5e1;line-height:1.4}
.pq-result{display:flex;flex-direction:column;align-items:center;gap:14px;padding:20px;text-align:center}
.pq-result .big{font-size:24px;font-weight:900;letter-spacing:.04em}
.pq-result.cleared .big{color:#bbf7d0}
.pq-result.failed .big{color:#fecaca}
.pq-reward-list{display:flex;flex-direction:column;gap:8px;max-height:420px;overflow-y:auto}
.pq-reward-row{display:grid;grid-template-columns:58px 1fr;gap:10px;align-items:center;padding:9px;background:rgba(2,6,23,.55);border:1px solid rgba(148,163,184,.14);border-radius:12px}
.pq-reward-thumb{position:relative;width:54px;height:54px;display:grid;place-items:center}
.pq-reward-thumb .frame{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;z-index:1}
.pq-reward-thumb .icon{position:relative;width:72%;height:72%;object-fit:contain;z-index:2}
.pq-reward-thumb .fallback{position:relative;z-index:2;font-size:28px}
.pq-reward-row .owner{font-size:12px;font-weight:900;color:#f8fafc}
.pq-reward-row .item{font-size:12px;font-weight:800;color:#fde68a}
.pq-reward-row .meta{font-size:11px;color:#94a3b8;margin-top:2px}
.pq-potion-row{display:grid;grid-template-columns:1fr auto;gap:6px 10px;align-items:center;padding:10px 12px;background:rgba(2,6,23,.55);border:1px solid rgba(148,163,184,.14);border-radius:10px}
.pq-potion-row .nm{font-weight:800;color:#f1f5f9;font-size:13px}
.pq-potion-row .ef{font-size:11px;color:#a5b4fc;grid-column:1/-1}
.pq-potion-row .own{font-size:11px;color:#94a3b8}
.pq-potion-stepper{display:flex;gap:4px;align-items:center}
.pq-potion-stepper button{width:28px;height:28px;border:0;border-radius:8px;background:#1f2937;color:#e5e7eb;font-weight:800;cursor:pointer;font-size:14px}
.pq-potion-stepper button:hover{background:#374151}
.pq-potion-stepper input{width:48px;padding:4px 6px;background:#0b0d12;border:1px solid #334155;border-radius:6px;color:#e5e7eb;text-align:center;font-weight:800;font-size:13px}
.pq-potion-chip{display:inline-flex;align-items:center;gap:4px;padding:3px 8px;background:rgba(34,197,94,.15);border:1px solid rgba(34,197,94,.35);border-radius:999px;color:#bbf7d0;font-size:11px;font-weight:700;margin:2px 4px 2px 0}
.pq-back{background:transparent;color:#94a3b8;border:0;font-weight:700;padding:6px 4px;cursor:pointer;font-size:13px}
.pq-back:hover{color:#e5e7eb}
.pq-bar{display:flex;justify-content:space-between;align-items:center;gap:8px}
.pq-actions{display:flex;gap:8px;flex-wrap:wrap}
</style></head><body>
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
        <button class="pq-btn" id="pqRefresh" style="height:32px;padding:0 12px;font-size:12px">새로고침</button>
      </div>
      <div id="pqRoomList" class="pq-screen" style="display:flex;gap:10px"></div>
    </section>

    <section class="pq-screen" data-screen="room">
      <button class="pq-back" id="pqLeave">← 파티 나가기</button>
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
      <div class="pq-panel">
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
      <div id="pqPhaseTop" class="pq-bar" style="margin-top:-2px">
        <div style="font-size:11px;color:#94a3b8;letter-spacing:.06em;font-weight:800;text-transform:uppercase" id="pqPhaseLabel">PHASE</div>
        <div style="color:#a5b4fc;font-weight:800;font-size:13px" id="pqPhaseName">-</div>
      </div>
      <div class="pq-combat-hud">
        <div id="pqPlayMembers" style="display:flex;flex-direction:column;gap:6px"></div>
      </div>
      <div id="pqPhaseStage"></div>
      <div class="pq-panel" style="padding:10px;gap:8px">
        <div class="pq-section-title" style="margin:0">내 스킬</div>
        <div id="pqSkillBar" class="pq-skill-bar"></div>
      </div>
      <div class="pq-panel" style="padding:10px;gap:8px">
        <div class="pq-section-title" style="margin:0">휴대 물약</div>
        <div id="pqPotionBar" class="pq-skill-bar"></div>
      </div>
      <div class="pq-panel" style="padding:10px;gap:8px">
        <div class="pq-section-title" style="margin:0">채팅</div>
        <div id="pqPlayChat" class="pq-chat"></div>
        <form id="pqPlayChatForm" class="pq-chat-form">
          <input id="pqPlayChatInput" class="pq-input" placeholder="메시지..." autocomplete="off" maxlength="500">
          <button type="submit" class="pq-btn primary" style="height:38px">전송</button>
        </form>
      </div>
      <div id="pqCombatLog" class="pq-combat-log"></div>
      <div class="pq-actions">
        <button class="pq-btn danger" id="pqPlayLeave">파티 나가기</button>
      </div>
    </section>

  </div>

  <button class="pq-fab" id="pqCreateFab" style="display:none">＋ 파티 생성</button>

  <div class="pq-modal-bg" id="pqCreateBg">
    <div class="pq-modal">
      <h3>파티 생성</h3>
      <label class="pq-section-title">퀘스트 선택</label>
      <div class="pq-quest-picker">
        <button class="pq-quest-arrow" id="pqQuestPrev" type="button">&#8249;</button>
        <div class="pq-quest-card" id="pqQuestCard">
          <div class="pq-quest-card-img" id="pqQuestCardImg"></div>
          <div class="pq-quest-card-body">
            <div class="pq-quest-card-name" id="pqQuestCardName">-</div>
            <div class="pq-quest-card-meta" id="pqQuestCardMeta"></div>
          </div>
        </div>
        <button class="pq-quest-arrow" id="pqQuestNext" type="button">&#8250;</button>
      </div>
      <label class="pq-section-title">비밀번호 (선택)</label>
      <input id="pqCreatePw" class="pq-input" type="text" placeholder="비워두면 공개">
      <div class="pq-actions">
        <button class="pq-btn" id="pqCreateCancel" type="button">취소</button>
        <button class="pq-btn primary" id="pqCreateConfirm" type="button">생성</button>
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

  <div class="pq-notice-stack" id="pqNoticeStack"></div>
  <div class="pq-toast" id="pqToast"></div>
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
