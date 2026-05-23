const express = require('express');
const crypto = require('crypto');
const path = require('path');
const rpgenius = require('./rpgenius.js');
const { DynamoDBClient, DescribeTableCommand, DescribeContinuousBackupsCommand, RestoreTableToPointInTimeCommand, DeleteTableCommand } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand, BatchWriteCommand } = require('@aws-sdk/lib-dynamodb');

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

const ADMIN_HTML_PATH = path.join(__dirname, 'public', 'admin.html');
const ADMIN_JS_PATH = path.join(__dirname, 'public', 'admin.js');
const APP_JS_PATH = path.join(__dirname, 'public', 'app.js');
const CHARACTER_CARDS_PATH = path.join(__dirname, 'DB', 'RPGenius', 'CharacterCards.json');
const CARD_IMAGE_PATH = path.join(__dirname, 'DB', 'RPGenius', 'cardImage');
const ITEM_IMAGE_PATH = path.join(__dirname, 'DB', 'RPGenius', 'itemImage');
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

server.get('/', (req, res) => {
    const sess = getSession(req);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (sess && sess.name) return res.send(renderUserDashboard(sess));
    return res.send(renderLogin());
});

server.get('/admin', (req, res) => {
    const sess = getSession(req);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (!sess || !sess.admin) return res.redirect('/');
    return res.send(renderAdminDashboard(sess));
});

server.post('/api/login', async (req, res) => {
    const code = String((req.body && req.body.code) || '').trim();
    if (!code) return res.status(400).json({ error: '코드를 입력해주세요.' });
    try {
        const user = await rpgenius.getRPGUserByCode(code);
        if (!user) return res.status(401).json({ error: '존재하지 않는 코드입니다.' });
        if (typeof user.changeCode == 'function') await user.changeCode();
        setSession(res, { name: user.name, admin: !!user.isAdmin, exp: Date.now() + SESSION_TTL_MS });
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
                totalExp
            };
        });
        const cp = rows.slice().sort((a, b) => b.cp - a.cp || b.level - a.level || a.name.localeCompare(b.name, 'ko-KR'))
            .map((r, i) => ({ rank: i + 1, name: r.name, level: r.level, value: r.cp }));
        const exp = rows.slice().sort((a, b) => b.totalExp - a.totalExp || a.name.localeCompare(b.name, 'ko-KR'))
            .map((r, i) => ({ rank: i + 1, name: r.name, level: r.level, value: r.totalExp }));
        const worldBossBase = rpgenius.getWorldBossContributionRanking();
        const levelByName = {};
        rows.forEach(r => { levelByName[r.name] = r.level; });
        const worldBoss = worldBossBase.map(r => ({ rank: r.rank, name: r.name, level: Number(levelByName[r.name] || 1), value: r.value }));
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
        return res.status(400).json({ error: '알 수 없는 인벤토리 종류입니다.' });
    } catch (e) {
        console.error('inventory error:', e);
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

server.get('/api/lookup/cards', requireAdmin, (req, res) => {
    const cards = readJson(CHARACTER_CARDS_PATH, []);
    res.json(cards.map((card, id) => card ? { id, name: card.name } : null).filter(Boolean));
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
    if (skin) {
        if (user.prestige === true) candidates.push(star + ' 프레스티지 ' + skin + ' ' + data.name + '.png');
        candidates.push(star + ' ' + skin + ' ' + data.name + '.png');
        candidates.push(star + ' ' + data.name + '.png');
    } else {
        if (user.prestige === true) candidates.push(star + ' 프레스티지 ' + data.name + '.png');
        candidates.push(star + ' ' + data.name + '.png');
    }
    const file = candidates.find(candidate => fs.existsSync(path.join(CARD_IMAGE_PATH, data.name, candidate)));
    if (!file) return null;
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

function getItemDisplayAssets(item) {
    if (!item || !item.name) return { frameUrl: getAuctionFrameUrl('item'), iconUrl: null };
    const m = String(item.name).match(/^(.+)\s장비\s상자$/);
    if (m) {
        return {
            frameUrl: getAuctionFrameUrl('equipment', m[1]),
            iconUrl: getItemImageUrl('가챠', '개봉 후 장비 상자.png')
        };
    }
    const frameUrl = item.type == '미끼'
        ? getItemImageUrl('프레임', '미끼.png')
        : getAuctionFrameUrl('item');
    return { frameUrl, iconUrl: getItemIconUrl(item) };
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
        skills: buildSkillInfo(card, user)
    };
}

function buildInventoryItems(user) {
    const items = rpgenius.getDataCache('Item', []);
    return (user.inventory && Array.isArray(user.inventory.item) ? user.inventory.item : [])
        .map(inv => {
            const data = items[inv.id];
            return data ? { id: Number(inv.id), name: data.name, type: data.type, desc: data.desc || '', count: Number(inv.count || 0), noTrade: data.no_trade === true } : null;
        })
        .filter(item => item && item.count > 0);
}

function buildInventoryCards(user) {
    return (user.inventory && Array.isArray(user.inventory.card) ? user.inventory.card : [])
        .map(card => serializeCard(card, user))
        .filter(Boolean);
}

function getEquipmentData(type, id) {
    const equipments = rpgenius.getDataCache('Equipment', {});
    const list = equipments[type] || [];
    return list[id];
}

function buildInventoryEquipment(user) {
    const result = [];
    const labels = { weapon: '무기', armor: '갑옷', accessory: '장신구', support: '보조' };
    const add = (equip, type, equipped) => {
        const data = equip && getEquipmentData(equip.type || type, equip.id);
        if (!data) return;
        const level = Number(equip.level || 0);
        const statText = rpgenius.formatCurrentEquipmentStatLines(data, level, equip && equip.rolled);
        const statLines = String(statText || '').split('\n').filter(line => line && line.trim());
        result.push({
            type: equip.type || type,
            typeLabel: labels[equip.type || type] || (equip.type || type),
            id: Number(equip.id),
            name: data.name,
            rarity: data.rarity,
            level,
            equipped: !!equipped,
            statLines,
            rolled: equip && equip.rolled || null,
            requireMainCard: Array.isArray(data.requireMainCard) ? data.requireMainCard.slice() : null,
            noTrade: data.no_trade === true,
            iconUrl: getEquipmentIconUrl(data),
            frameUrl: getAuctionFrameUrl('equipment', data.rarity)
        });
    };
    (user.inventory && Array.isArray(user.inventory.equipment) ? user.inventory.equipment : []).forEach(equip => add(equip, equip.type, false));
    if (user.equipments && user.equipments.weapon) add(user.equipments.weapon, 'weapon', true);
    if (user.equipments && user.equipments.armor) add(user.equipments.armor, 'armor', true);
    const accessories = user.equipments && user.equipments.accessory || {};
    Object.keys(accessories).forEach(key => add(accessories[key], 'accessory', true));
    if (user.equipments && user.equipments.support) add(user.equipments.support, 'support', true);
    return result;
}

const RARITY_ORDER = ['일반', '고급', '레어', '희귀', '유니크', '영웅', '레전더리', '전설', '신화', '고유'];

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
        recipe
    };
}

function buildRecipeIndex() {
    const items = rpgenius.getDataCache('Item', []);
    const recipes = rpgenius.getDataCache('Recipe', []);
    const index = {};
    (recipes || []).forEach(recipe => {
        if (!recipe || !Array.isArray(recipe.crafted)) return;
        recipe.crafted.forEach(crafted => {
            if (!crafted || !crafted.type) return;
            const slotKey = crafted.type == '무기' ? 'weapon' : crafted.type == '갑옷' ? 'armor' : crafted.type == '장신구' ? 'accessory' : null;
            if (!slotKey) return;
            const targetId = Number(crafted.weapon_id != null ? crafted.weapon_id : crafted.armor_id != null ? crafted.armor_id : crafted.accessory_id);
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
                return { type: 'unknown', typeLabel: String(mat.type || ''), name: String(mat.type || ''), count: Number(mat.count || 0) };
            }).filter(Boolean);
            index[slotKey + ':' + targetId] = { name: recipe.name, materials };
        });
    });
    return index;
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
        map[String(user.id)] = { name: user.name || '알 수 없음', level: Number(user.level || 1) };
    });
    return map;
}

function serializePatchnoteReply(reply, userMap) {
    const user = userMap[String(reply && reply.userId)] || { name: '알 수 없음', level: 1 };
    return {
        id: String(reply && reply.id || ''),
        userId: String(reply && reply.userId || ''),
        authorName: user.name,
        authorLevel: user.level,
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
            name: data ? data.name : '알 수 없는 장비',
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
    return { name: '알 수 없음', sub: '' };
}

function serializeAuctionEntry(entry, currentUserName) {
    const desc = describeAuctionPayload(entry);
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
        if (data) {
            const text = rpgenius.formatCurrentEquipmentStatLines(data, Number(entry.payload && entry.payload.level || 0), entry.payload && entry.payload.rolled);
            statLines = String(text || '').split('\n').filter(line => line && line.trim()).map(line => line.replace(/^-\s*/, ''));
        }
    } else if (entry.kind == 'item') {
        const item = rpgenius.getDataCache('Item', [])[entry.payload && entry.payload.id];
        const assets = getItemDisplayAssets(item);
        frameUrl = assets.frameUrl;
        iconUrl = assets.iconUrl;
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
            statLines
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
            const level = Number(eq.level || 0);
            const statText = rpgenius.formatCurrentEquipmentStatLines(data, level, eq.rolled);
            return {
                index,
                type: eq.type,
                typeLabel: { weapon: '무기', armor: '갑옷', accessory: '장신구', support: '보조' }[eq.type] || eq.type,
                id: Number(eq.id),
                name: data.name,
                rarity: data.rarity,
                level,
                statLines: String(statText || '').split('\n').filter(line => line && line.trim()).map(line => line.replace(/^-\s*/, ''))
            };
        })
        .filter(Boolean);
    const items = buildInventoryItems(user).filter(item => !item.noTrade);
    return { cards, equipment, items };
}

function countUserAuctions(items, name) {
    return items.filter(entry => entry.sellerName == name).length;
}

async function registerAuction(sellerName, body) {
    const kind = String(body.kind || '');
    const currency = String(body.currency || '');
    const price = Math.floor(Number(body.price || 0));
    if (!['card', 'equipment', 'item'].includes(kind)) return { error: '알 수 없는 종류입니다.' };
    if (!['gold', 'garnet'].includes(currency)) return { error: '가격 화폐는 골드 또는 가넷이어야 합니다.' };
    if (!Number.isInteger(price) || price < 1 || price > AUCTION_MAX_PRICE) return { error: '가격은 1 이상의 정수여야 합니다.' };

    const user = await rpgenius.getRPGUserByName(sellerName);
    if (!user) return { error: '유저를 찾을 수 없습니다.' };
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
        payload = { type: eq.type, id: Number(eq.id), level: Number(eq.level || 0) };
        if (eq.rolled) payload.rolled = eq.rolled;
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
    if (!user.inventory) user.inventory = { card: [], item: [], equipment: [] };
    if (!Array.isArray(user.inventory.card)) user.inventory.card = [];
    if (!Array.isArray(user.inventory.item)) user.inventory.item = [];
    if (!Array.isArray(user.inventory.equipment)) user.inventory.equipment = [];
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
        const eqEntry = { type: entry.payload.type, id: Number(entry.payload.id), level: Number(entry.payload.level || 0) };
        if (entry.payload.rolled) eqEntry.rolled = entry.payload.rolled;
        buyer.inventory.equipment.push(eqEntry);
    } else if (entry.kind == 'item') {
        rpgenius.addInventoryItem(buyer, Number(entry.payload.id), buyCount);
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
        const eqEntry = { type: entry.payload.type, id: Number(entry.payload.id), level: Number(entry.payload.level || 0) };
        if (entry.payload.rolled) eqEntry.rolled = entry.payload.rolled;
        user.inventory.equipment.push(eqEntry);
    } else if (entry.kind == 'item') {
        rpgenius.addInventoryItem(user, Number(entry.payload.id), Number(entry.count || 1));
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
            const text = rpgenius.formatCurrentEquipmentStatLines(data, Number(entry.payload.level));
            statLines = String(text || '').split('\n').filter(line => line && line.trim()).map(line => line.replace(/^-\s*/, ''));
        }
    } else if (entry.kind == 'item') {
        const item = rpgenius.getDataCache('Item', [])[entry.payload && entry.payload.id];
        const assets = getItemDisplayAssets(item);
        frameUrl = assets.frameUrl;
        iconUrl = assets.iconUrl;
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
    if (!['card', 'equipment', 'item'].includes(kind)) return { error: '알 수 없는 종류입니다.' };
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
        if (!matchBuyOrderEquipment(entry, eq)) return { error: '이 장비는 구매 등록 조건에 맞지 않습니다.' };
        const transferred = { type: eq.type, id: Number(eq.id), level: Number(eq.level || 0) };
        if (eq.rolled) transferred.rolled = eq.rolled;
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
    const cardList = characterCards.map((data, id) => data ? { id, name: data.name } : null).filter(Boolean);
    const pack = list => (list || []).map((e, id) => e && e.no_trade !== true ? { id, name: e.name, rarity: e.rarity } : null).filter(Boolean);
    const equipmentList = {
        weapon: pack(equipments.weapon),
        armor: pack(equipments.armor),
        accessory: pack(equipments.accessory),
        support: pack(equipments.support)
    };
    const itemList = items.map((it, id) => it && it.no_trade !== true ? { id, name: it.name, type: it.type } : null).filter(Boolean);
    return { cards: cardList, equipment: equipmentList, items: itemList };
}

function buildFulfillableAssets(user, entry) {
    const result = { cards: [], equipment: [], itemCount: 0 };
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
            const level = Number(eq.level || 0);
            const statText = rpgenius.formatCurrentEquipmentStatLines(data, level, eq.rolled);
            result.equipment.push({
                index,
                type: eq.type,
                typeLabel: { weapon: '무기', armor: '갑옷', accessory: '장신구', support: '보조' }[eq.type] || eq.type,
                id: Number(eq.id),
                name: data.name,
                rarity: data.rarity,
                level,
                statLines: String(statText || '').split('\n').filter(line => line && line.trim()).map(line => line.replace(/^-\s*/, ''))
            });
        });
    } else if (entry.kind == 'item') {
        const itemId = Number(entry.payload && entry.payload.id);
        result.itemCount = rpgenius.getInventoryItemCount(user, itemId);
    }
    return result;
}

function buildUserProfile(user) {
    const level = Number(user.level || 1);
    const exp = Number(user.exp || 0);
    const maxExp = getMaxExpForLevel(level);
    const stats = rpgenius.calculateUserStats(user);
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
            isAdmin: !!user.isAdmin
        },
        combatPower: cp,
        stats: {
            atk: Number(stats.atk || 0),
            def: Number(stats.def || 0),
            pnt: Number(stats.pnt || 0),
            critText: rpgenius.formatStatValue('crit', stats.crit).replace(/^\+/, ''),
            critMulText: rpgenius.formatStatValue('critMul', stats.critMul).replace(/^\+/, '')
        },
        mainCard: serializeCard(user.main_card, user),
        cardSlots: slots,
        equippedEquipment: buildInventoryEquipment(user).filter(equipment => equipment.equipped),
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
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0d12;color:#e5e7eb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
.card{background:#13161d;border:1px solid #232734;border-radius:14px;padding:28px;width:min(380px,92vw);box-shadow:0 10px 40px rgba(0,0,0,.4)}
h1{margin:0 0 6px;font-size:20px}
p.sub{margin:0 0 20px;color:#9aa3b2;font-size:13px}
label{display:block;font-size:12px;color:#9aa3b2;margin-bottom:6px}
input{width:100%;padding:11px 12px;background:#0b0d12;border:1px solid #2a2f3d;border-radius:8px;color:#e5e7eb;font-size:14px;outline:none;font-family:ui-monospace,monospace;letter-spacing:.05em}
input:focus{border-color:#5865f2}
button{width:100%;margin-top:14px;padding:11px;background:#5865f2;color:#fff;border:0;border-radius:8px;font-weight:600;cursor:pointer;font-size:14px}
button:hover{background:#4752c4}
button:disabled{opacity:.6;cursor:wait}
.err{margin-top:12px;color:#f87171;font-size:13px;min-height:18px}
</style></head><body>
<form class="card" id="f">
  <h1>RPGenius</h1>
  <p class="sub">RPGenius 계정의 로그인 코드를 입력하세요.</p>
  <label>로그인 코드</label>
  <input id="code" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="ABCDE12345" required>
  <button type="submit">로그인</button>
  <div class="err" id="err"></div>
</form>
<script>
const f=document.getElementById('f'),err=document.getElementById('err'),code=document.getElementById('code');
f.addEventListener('submit',async e=>{e.preventDefault();err.textContent='';f.querySelector('button').disabled=true;
try{const r=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:code.value.trim()})});
const j=await r.json();if(!r.ok)throw new Error(j.error||'로그인 실패');location.reload();
}catch(x){err.textContent='❌ '+x.message;f.querySelector('button').disabled=false}});
</script></body></html>`;
}

function renderUserDashboard(sess) {
    return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><title>RPGenius</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root{color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;background:radial-gradient(circle at top left,#1e293b,#070910 42%,#05060a);color:#e5e7eb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
header{position:sticky;top:0;z-index:5;display:flex;justify-content:space-between;align-items:center;padding:18px 24px;background:rgba(7,9,16,.82);backdrop-filter:blur(14px);border-bottom:1px solid rgba(148,163,184,.18)}
h1{margin:0;font-size:22px;white-space:nowrap}.who{color:#a5b4fc;font-weight:700;white-space:nowrap}.bar{display:flex;gap:8px;align-items:center}.top-left{display:flex;gap:22px;align-items:center;min-width:0}.nav{display:flex;gap:6px;min-width:0}.nav-btn{white-space:nowrap}.nav-btn.active{background:#5865f2}
button{border:0;border-radius:10px;padding:10px 13px;background:#1f2937;color:#e5e7eb;font-weight:700;cursor:pointer}button:hover{background:#374151}.primary{background:#5865f2}.primary:hover{background:#4752c4}
main{width:min(1180px,94vw);margin:26px auto 50px;display:grid;gap:18px}.page{display:none;gap:18px}.page.active{display:grid}.profile-hero{display:grid;grid-template-columns:170px 1fr;gap:18px;align-items:start}.profile-card{text-align:center}.profile-card .card-tile{padding:0;background:transparent;border:0;box-shadow:none}.profile-card img{width:160px;aspect-ratio:3/4;object-fit:cover;border-radius:4px;border:4px solid #020617;background:#f8fafc}.profile-card .card-name{font-size:16px;color:#f8fafc}.profile-summary{padding-top:4px}.name-line{font-size:20px;margin-bottom:8px}.status-row{display:grid;grid-template-columns:32px minmax(160px,300px) auto;gap:10px;align-items:center;margin:10px 0;font-size:18px}.meter{height:22px;border-radius:6px;background:rgba(2,6,23,.65);overflow:hidden}.meter-fill{height:100%;width:0%}.meter.hp .meter-fill{background:#ef171e}.meter.mp .meter-fill{background:#4140c8}.power-line{font-size:18px;margin-top:14px}.panel{background:rgba(15,23,42,.82);border:1px solid rgba(148,163,184,.16);border-radius:18px;padding:18px;box-shadow:0 16px 50px rgba(0,0,0,.25)}
h2{margin:0 0 14px;font-size:17px}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.kv{display:flex;justify-content:space-between;gap:12px;padding:10px 12px;background:rgba(2,6,23,.52);border:1px solid rgba(148,163,184,.12);border-radius:12px}.kv span{color:#94a3b8}.kv b{font-variant-numeric:tabular-nums}.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(132px,1fr));gap:12px}
.card-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:12px}.card-tile{background:rgba(2,6,23,.58);border:1px solid rgba(148,163,184,.14);border-radius:16px;padding:10px;text-align:center}.card-tile img{width:100%;border-radius:12px;display:block;box-shadow:0 10px 24px rgba(0,0,0,.35)}.card-tile.compact{padding:8px}.card-name{margin-top:8px;font-size:13px;font-weight:700}.no-img,.empty-card{min-height:180px;display:grid;place-items:center;color:#94a3b8;border:1px dashed #334155;border-radius:12px}.card-tile.compact .no-img,.card-tile.compact .empty-card{min-height:120px}
.actions{display:flex;gap:8px;flex-wrap:wrap}.view-btn{background:#111827;border:1px solid #334155}.viewer{display:grid;gap:18px}.cat{display:grid;gap:8px}.cat-title{font-size:14px;font-weight:800;color:#f1f5f9;padding:4px 4px 6px;border-bottom:1px solid rgba(148,163,184,.18);margin-bottom:2px}.inv-row{display:flex;justify-content:space-between;gap:12px;align-items:center;padding:12px 14px;background:rgba(2,6,23,.52);border:1px solid rgba(148,163,184,.12);border-radius:13px}.equip-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px}.equip-card{position:relative;display:grid;grid-template-columns:48px 1fr auto;gap:12px;align-items:center;padding:14px;background:linear-gradient(135deg,rgba(2,6,23,.85),rgba(15,23,42,.7));border:1px solid var(--rar,#334155);border-left:5px solid var(--rar,#334155);border-radius:14px;box-shadow:0 8px 24px rgba(0,0,0,.25)}.equip-card .slot-icon{display:grid;place-items:center;width:48px;height:48px;border-radius:12px;background:rgba(148,163,184,.12);font-size:22px}.equip-card .equip-name{font-size:16px;font-weight:800;color:#f8fafc;margin-bottom:6px}.equip-card .equip-meta{display:flex;gap:6px;flex-wrap:wrap;align-items:center}.equip-card .level{font-size:20px;font-weight:900;font-variant-numeric:tabular-nums;color:#fbbf24}.card-tile,.equip-card{cursor:pointer;transition:transform .12s,box-shadow .12s}.card-tile:hover,.equip-card:hover{transform:translateY(-2px);box-shadow:0 14px 36px rgba(0,0,0,.4)}.modal-bg{position:fixed;inset:0;background:rgba(0,0,0,.65);display:none;align-items:center;justify-content:center;z-index:50;backdrop-filter:blur(4px);padding:16px}.modal-bg.active{display:flex}.modal{width:min(480px,100%);max-height:90vh;overflow-y:auto;background:#0f172a;border:1px solid rgba(148,163,184,.25);border-radius:18px;padding:22px;box-shadow:0 30px 80px rgba(0,0,0,.6)}.modal.wide{width:min(640px,100%)}.modal h3{margin:0 0 6px;font-size:18px;color:#f8fafc}.modal .sub{color:#94a3b8;font-size:13px;margin-bottom:14px}.modal .stat-line{padding:8px 12px;background:rgba(2,6,23,.6);border:1px solid rgba(148,163,184,.12);border-radius:10px;margin:6px 0;font-size:14px}.modal .close{margin-top:14px;width:100%}.modal .row{display:flex;gap:8px;margin-top:12px;flex-wrap:wrap}.modal .row>*{flex:1}.modal label{display:block;font-size:13px;color:#94a3b8;margin:10px 0 6px;font-weight:700}.modal input,.modal select{width:100%;padding:10px 12px;border-radius:10px;border:1px solid #334155;background:#0b1220;color:#e5e7eb;font-size:14px;font-weight:600;font-family:inherit}.modal input:focus,.modal select:focus{outline:none;border-color:#5865f2}.seg{display:flex;gap:6px;background:rgba(2,6,23,.6);padding:4px;border-radius:12px;flex-wrap:wrap}.seg button{flex:1 0 auto;background:transparent;font-size:13px;padding:8px 12px;white-space:nowrap}.seg button.on{background:#5865f2}.pick-list{max-height:280px;overflow-y:auto;display:grid;gap:6px;margin-top:8px;padding:4px;background:rgba(2,6,23,.4);border-radius:10px}.pick-row{display:flex;justify-content:space-between;gap:10px;align-items:center;padding:10px 12px;background:rgba(15,23,42,.7);border:1px solid transparent;border-radius:10px;cursor:pointer;font-size:13px}.pick-row:hover{border-color:#5865f2}.pick-row.on{border-color:#5865f2;background:rgba(88,101,242,.18)}.pick-row .meta{color:#94a3b8;font-size:12px;margin-top:2px}.danger{background:#dc2626}.danger:hover{background:#b91c1c}
.equip-thumb{position:relative;width:48px;height:48px;background:rgba(15,23,42,.7);border-radius:12px;overflow:visible}.equip-thumb .frame{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;z-index:1}.equip-thumb .icon{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);z-index:2;width:124%;height:124%;object-fit:contain;filter:drop-shadow(0 3px 6px rgba(0,0,0,.5))}.equip-thumb .icon-fallback{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);z-index:2;font-size:24px;line-height:1}
.modal-equip-thumb{width:120px!important;height:120px!important;margin:6px auto 16px;border-radius:16px}.modal-equip-thumb .icon-fallback{font-size:80px}
.profile-banner{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:12px 16px;background:linear-gradient(135deg,rgba(251,191,36,.18),rgba(88,101,242,.18));border:1px solid rgba(251,191,36,.4);border-radius:14px;color:#fde68a;font-weight:700}.profile-banner button{padding:8px 12px;font-size:13px}
.rank-section{display:grid;gap:14px}.rank-tabs{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px}.rank-tab{padding:9px 14px;border-radius:10px;background:#1f2937;color:#cbd5e1;cursor:pointer;font-weight:700;font-size:13px;border:1px solid transparent}.rank-tab.active{background:#5865f2;color:#fff;border-color:#5865f2}
.rank-me{padding:14px 16px;background:linear-gradient(135deg,rgba(88,101,242,.18),rgba(15,23,42,.6));border:1px solid rgba(88,101,242,.45);border-radius:14px;display:grid;grid-template-columns:auto 1fr auto auto;gap:14px;align-items:center;font-weight:700}.rank-me .rk{font-size:22px;color:#a5b4fc}.rank-me .nm{font-size:15px;color:#f8fafc}.rank-me .lv{font-size:12px;color:#94a3b8}.rank-me .vl{font-size:18px;color:#fbbf24;font-variant-numeric:tabular-nums}
.rank-list{display:grid;gap:8px}.rank-row{display:grid;grid-template-columns:60px 1fr auto;align-items:center;gap:12px;padding:12px 14px;background:rgba(2,6,23,.55);border:1px solid rgba(148,163,184,.12);border-radius:12px;cursor:pointer;transition:transform .12s,border-color .12s,background .12s}.rank-row:hover{transform:translateX(4px);border-color:#5865f2;background:rgba(88,101,242,.12)}.rank-row.me{border-color:#fbbf24;background:rgba(251,191,36,.08)}.rank-row .rk{font-size:16px;font-weight:800;color:#a5b4fc;text-align:center}.rank-row .rk.gold{color:#fbbf24;font-size:22px}.rank-row .rk.silver{color:#cbd5e1;font-size:20px}.rank-row .rk.bronze{color:#d97706;font-size:18px}.rank-row .nm{font-weight:700;color:#f1f5f9}.rank-row .lv{font-size:12px;color:#94a3b8;margin-left:6px}.rank-row .vl{font-weight:800;color:#fbbf24;font-variant-numeric:tabular-nums;font-size:15px}
.dex-tabs{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px}.dex-tab{padding:9px 14px;border-radius:10px;background:#1f2937;color:#cbd5e1;cursor:pointer;font-weight:700;font-size:13px;border:1px solid transparent}.dex-tab.active{background:#5865f2;color:#fff;border-color:#5865f2}
.dex-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:14px}
.dex-card{display:grid;gap:12px;padding:14px;background:linear-gradient(135deg,rgba(2,6,23,.85),rgba(15,23,42,.7));border:1px solid var(--rar,#334155);border-left:5px solid var(--rar,#334155);border-radius:14px;box-shadow:0 8px 24px rgba(0,0,0,.25)}
.dex-head{display:grid;grid-template-columns:72px 1fr;gap:12px;align-items:center}
.dex-thumb{position:relative;width:72px;height:72px;background:rgba(15,23,42,.7);border-radius:10px;overflow:visible}.dex-thumb .frame{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;z-index:1}.dex-thumb .icon{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);z-index:2;width:124%;height:124%;object-fit:contain;filter:drop-shadow(0 4px 8px rgba(0,0,0,.55))}.dex-thumb .icon-fallback{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);z-index:2;font-size:56px;line-height:1}
.dex-name{font-weight:800;font-size:16px;color:#f8fafc}.dex-meta{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:4px}.dex-desc{color:#94a3b8;font-size:13px;line-height:1.5}
.dex-stat-block{padding:10px 12px;background:rgba(2,6,23,.5);border:1px solid rgba(148,163,184,.12);border-radius:10px;display:grid;gap:4px;font-size:13px;color:#cbd5e1}.dex-stat-title{font-weight:800;color:#f1f5f9;font-size:12px;letter-spacing:.04em;text-transform:uppercase}
.dex-collapse{background:rgba(2,6,23,.4);border:1px solid rgba(148,163,184,.12);border-radius:10px}.dex-collapse>summary{cursor:pointer;padding:10px 12px;font-weight:700;color:#e5e7eb;font-size:13px;list-style:none}.dex-collapse>summary::-webkit-details-marker{display:none}.dex-collapse>summary::before{content:'▶';display:inline-block;margin-right:8px;transition:transform .15s;color:#94a3b8;font-size:10px}.dex-collapse[open]>summary::before{transform:rotate(90deg)}.dex-upgrade-list{display:grid;gap:6px;padding:0 12px 12px}
.dex-upgrade-row{display:grid;grid-template-columns:46px 1fr;gap:8px;padding:8px 10px;background:rgba(2,6,23,.55);border:1px solid rgba(148,163,184,.1);border-radius:8px;font-size:12px}.dex-upgrade-row .lvl{font-weight:800;color:#fbbf24;font-variant-numeric:tabular-nums}.dex-upgrade-row .lines{display:grid;gap:2px;color:#cbd5e1}
.dex-evol,.dex-recipe{display:grid;gap:8px;padding:10px 12px;background:rgba(88,101,242,.08);border:1px solid rgba(88,101,242,.3);border-radius:10px}.dex-recipe{background:rgba(34,197,94,.08);border-color:rgba(34,197,94,.3)}
.dex-evol-title,.dex-recipe-title{font-weight:800;font-size:12px;letter-spacing:.04em;text-transform:uppercase;color:#a5b4fc}.dex-recipe-title{color:#86efac}
.dex-evol-target,.dex-recipe-mat{display:grid;grid-template-columns:42px 1fr auto;gap:10px;align-items:center;padding:6px 8px;background:rgba(2,6,23,.55);border-radius:8px;font-size:13px}
.dex-evol-thumb,.dex-mat-thumb{position:relative;width:42px;height:42px;background:rgba(15,23,42,.7);border-radius:8px;overflow:visible}.dex-evol-thumb .frame,.dex-mat-thumb .frame{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;z-index:1}.dex-evol-thumb .icon,.dex-mat-thumb .icon{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);z-index:2;width:124%;height:124%;object-fit:contain;filter:drop-shadow(0 3px 6px rgba(0,0,0,.5))}.dex-evol-thumb .icon-fallback,.dex-mat-thumb .icon-fallback{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);z-index:2;font-size:32px;line-height:1}
.dex-mat-count{font-weight:800;color:#fbbf24;font-variant-numeric:tabular-nums}
.auction-bar{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:14px}.auction-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px}.auc-card{position:relative;display:flex;flex-direction:column;gap:8px;padding:14px;background:rgba(2,6,23,.62);border:1px solid rgba(148,163,184,.16);border-radius:14px;cursor:pointer;transition:transform .12s,box-shadow .12s,border-color .12s}.auc-card:hover{transform:translateY(-2px);box-shadow:0 14px 36px rgba(0,0,0,.4);border-color:#5865f2}.auc-card.mine{border-color:#fbbf24}.auc-thumb{aspect-ratio:3/4;display:grid;place-items:center;background:rgba(15,23,42,.7);border-radius:10px;font-size:64px;overflow:hidden}.auc-thumb.square{aspect-ratio:1/1;position:relative;background:transparent}.auc-thumb img{width:100%;height:100%;object-fit:contain}.auc-thumb.card{background:transparent}.auc-frame{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;z-index:1}.auc-icon,.auc-item-img{position:relative;z-index:2}.auc-icon{font-size:64px;line-height:1;text-shadow:0 4px 14px rgba(0,0,0,.6)}.auc-item-img{width:62%;height:62%;object-fit:contain;filter:drop-shadow(0 6px 10px rgba(0,0,0,.55))}.currency-img{width:20px;height:20px;object-fit:contain;vertical-align:-4px;margin-right:5px}.auc-name{font-weight:800;font-size:15px;color:#f8fafc;line-height:1.3;word-break:break-word}.auc-sub{font-size:12px;color:#94a3b8}.auc-price{display:flex;justify-content:space-between;align-items:center;font-weight:800;font-size:15px;color:#fbbf24}.auc-seller{font-size:11px;color:#64748b}.auc-mine-badge{position:absolute;top:8px;right:8px;background:#fbbf24;color:#0f172a;font-size:11px;font-weight:800;padding:3px 7px;border-radius:999px}.tag{display:inline-block;padding:3px 8px;border-radius:999px;background:#263244;color:#cbd5e1;font-size:12px;font-weight:700}.tag.rarity{color:#fff;background:var(--rar,#334155)}.tag.on{background:#14532d;color:#bbf7d0}.empty,.loading{padding:24px;text-align:center;color:#94a3b8}.err{color:#f87171}.section-row{display:grid;grid-template-columns:1fr 1fr;gap:18px}
@media(max-width:860px){.profile-hero,.section-row{grid-template-columns:1fr}header{padding:14px 16px;align-items:flex-start}.top-left{display:grid;gap:10px}.grid{grid-template-columns:1fr}}
.patch-wrap{display:grid;gap:14px}.patch-editor{display:none;gap:8px;padding:14px;background:rgba(2,6,23,.52);border:1px solid rgba(148,163,184,.14);border-radius:14px}.patch-editor.active{display:grid}.patch-editor input,.patch-editor textarea,.reply-box textarea{width:100%;padding:10px 12px;background:#0b0d12;border:1px solid #334155;border-radius:10px;color:#e5e7eb;outline:none}.patch-editor textarea,.reply-box textarea{min-height:140px;resize:vertical;line-height:1.5}.patch-list{display:grid;gap:14px}.patch-card{display:grid;gap:12px;padding:16px;background:linear-gradient(135deg,rgba(2,6,23,.85),rgba(15,23,42,.7));border:1px solid rgba(148,163,184,.16);border-radius:14px}.patch-title{font-size:18px;font-weight:900;color:#f8fafc}.patch-date{font-size:12px;color:#94a3b8}.markdown-body{line-height:1.65;color:#dbeafe;word-break:break-word}.markdown-body h1,.markdown-body h2,.markdown-body h3{color:#f8fafc;margin:14px 0 8px}.markdown-body p{margin:8px 0}.markdown-body ul,.markdown-body ol{padding-left:22px}.markdown-body code{background:rgba(15,23,42,.9);border:1px solid rgba(148,163,184,.18);border-radius:6px;padding:1px 5px}.markdown-body pre{background:#020617;border:1px solid rgba(148,163,184,.18);border-radius:10px;padding:12px;overflow:auto}.reply-list{display:grid;gap:8px}.reply-item{display:grid;gap:7px;padding:10px 12px;background:rgba(2,6,23,.5);border:1px solid rgba(148,163,184,.1);border-radius:10px}.reply-item.child{margin-left:22px}.reply-meta{font-size:12px;color:#94a3b8}.reply-meta b{color:#f8fafc}.reply-text{white-space:pre-wrap;line-height:1.5}.reply-box{display:grid;gap:8px}.reply-box textarea{min-height:70px}
.search-input{padding:8px 10px;background:#0b0d12;border:1px solid #334155;border-radius:8px;color:#e5e7eb;font-size:13px;outline:none;min-width:140px}.search-input:focus{border-color:#5865f2}
@media(max-width:520px){header{padding:12px 10px;gap:8px}h1{font-size:clamp(16px,5vw,20px)}.nav{gap:4px}.nav-btn{padding:8px clamp(7px,2.1vw,10px);font-size:clamp(11px,3.1vw,13px)}.bar{gap:5px}.who{max-width:22vw;overflow:hidden;text-overflow:ellipsis;font-size:12px}#adminLink,#logout{padding:8px 9px;font-size:12px}.search-input{flex:1;min-width:0}}
</style></head><body>
<header><div class="top-left"><h1>RPGenius</h1><nav class="nav"><button class="nav-btn active" data-page="info">정보</button><button class="nav-btn" data-page="inventory">인벤토리</button><button class="nav-btn" data-page="auction">팝니다</button><button class="nav-btn" data-page="buyorder">삽니다</button><button class="nav-btn" data-page="ranking">랭킹</button><button class="nav-btn" data-page="dex">도감</button><button class="nav-btn" data-page="patchnotes">패치노트</button></nav></div><div class="bar"><span class="who" id="who">${escapeHtml(sess.name)}</span><button id="adminLink" class="primary" style="display:none">관리자</button><button id="logout">로그아웃</button></div></header>
<main id="app">
  <div class="page active" data-page="info">
    <div id="profileBanner" class="profile-banner" style="display:none"><span id="profileBannerText"></span><button id="profileBackBtn" class="primary">내 정보로 돌아가기</button></div>
    <section class="panel"><div class="profile-hero"><div id="mainCard" class="profile-card"></div><div class="profile-summary"><div class="name-line"><span id="level">-</span> <span id="profileName">-</span> <span id="exp" style="color:#94a3b8;font-size:15px">-</span></div><div class="status-row"><span>HP</span><div class="meter hp"><div class="meter-fill" id="hpFill"></div></div><b id="hp">-</b></div><div class="status-row"><span>MP</span><div class="meter mp"><div class="meter-fill" id="mpFill"></div></div><b id="mp">-</b></div><div class="power-line">⚔️ <b id="totalPower">-</b></div></div></div></section>
    <section class="panel"><h2>장착 중인 카드 슬롯</h2><div id="slotCards" class="cards"></div></section>
    <section class="panel"><h2>재화</h2><div id="goods" class="grid"></div></section>
    <section class="panel"><h2>스탯</h2><div id="stats" class="grid"></div></section>
    <section class="panel"><h2>장착 장비</h2><div id="equippedGear" class="equip-grid"></div></section>
  </div>
  <div class="page" data-page="inventory">
    <section class="panel"><div class="bar" style="justify-content:space-between;margin-bottom:14px"><h2 id="viewerTitle" style="margin:0">인벤토리</h2><div class="actions"><button class="view-btn" data-kind="items">인벤토리</button><button class="view-btn" data-kind="cards">보유 캐릭터 카드</button><button class="view-btn" data-kind="equipment">보유 장비</button></div></div><div id="viewer" class="viewer"></div></section>
  </div>
  <div class="page" data-page="auction"><section class="panel"><div class="auction-bar"><h2 style="margin:0">팝니다</h2><div class="actions"><input id="aucSearch" class="search-input" placeholder="검색..." autocomplete="off"><div class="seg" id="aucFilter"><button data-filter="all" class="on">전체</button><button data-filter="card">카드</button><button data-filter="equipment">장비</button><button data-filter="item">아이템</button><button data-filter="mine">내 판매</button></div><button class="primary" id="aucNew">+ 등록</button></div></div><div id="auctionList" class="auction-grid"></div></section></div>
  <div class="page" data-page="ranking"><section class="panel rank-section"><div class="auction-bar"><h2 style="margin:0">랭킹</h2><div class="rank-tabs"><button class="rank-tab active" data-tab="cp">전투력 랭킹</button><button class="rank-tab" data-tab="exp">경험치 랭킹</button><button class="rank-tab" data-tab="worldBoss">월드보스 랭킹</button></div></div><div id="rankMe"></div><div id="rankList" class="rank-list"></div></section></div>
  <div class="page" data-page="dex"><section class="panel"><div class="auction-bar"><h2 style="margin:0">장비 도감</h2><div class="dex-tabs"><button class="dex-tab active" data-tab="weapon">무기</button><button class="dex-tab" data-tab="armor">갑옷</button><button class="dex-tab" data-tab="accessory">장신구</button><button class="dex-tab" data-tab="support">보조</button></div></div><div id="dexList" class="dex-grid"></div></section></div>
  <div class="page" data-page="buyorder"><section class="panel"><div class="auction-bar"><h2 style="margin:0">삽니다</h2><div class="actions"><input id="boSearch" class="search-input" placeholder="검색..." autocomplete="off"><div class="seg" id="boFilter"><button data-filter="all" class="on">전체</button><button data-filter="card">카드</button><button data-filter="equipment">장비</button><button data-filter="item">아이템</button><button data-filter="mine">내 구매</button></div><button class="primary" id="boNew">+ 구매 등록</button></div></div><div id="buyOrderList" class="auction-grid"></div></section></div>
  <div class="page" data-page="patchnotes"><section class="panel patch-wrap"><div class="auction-bar"><h2 style="margin:0">패치노트</h2><button class="primary" id="patchNew" style="display:none">+ 작성</button></div><div class="patch-editor" id="patchEditor"><input id="patchTitle" placeholder="제목"><input id="patchDate" placeholder="패치 일자 (비워두면 작성일시)" type="datetime-local"><textarea id="patchBody" placeholder="본문 (Markdown 지원)"></textarea><div class="actions"><button class="primary" id="patchSubmit">등록</button><button id="patchCancel">취소</button></div></div><div id="patchList" class="patch-list"></div></section></div>
</main>
<div id="modalBg" class="modal-bg"><div class="modal"><h3 id="modalTitle">-</h3><div class="sub" id="modalSub"></div><div id="modalBody"></div><button class="primary close" id="modalClose">닫기</button></div></div>
<div id="aucDetailBg" class="modal-bg"><div class="modal" id="aucDetail"></div></div>
<div id="aucRegBg" class="modal-bg"><div class="modal wide" id="aucReg"></div></div>
<div id="boDetailBg" class="modal-bg"><div class="modal" id="boDetail"></div></div>
<div id="boRegBg" class="modal-bg"><div class="modal wide" id="boReg"></div></div>
<script src="/static/app.js"></script>
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
