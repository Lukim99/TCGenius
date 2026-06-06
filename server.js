const express = require('express');
const crypto = require('crypto');
const path = require('path');
const rpgenius = require('./rpgenius.js');
const partyquest = require('./partyquest.js');
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
const PARTY_JS_PATH = path.join(__dirname, 'public', 'party.js');
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
    const code = String((req.body && req.body.code) || '').trim();
    if (!code) return res.status(400).json({ error: '코드를 입력해주세요.' });
    try {
        const user = await rpgenius.getRPGUserByCode(code);
        if (!user) return res.status(401).json({ error: '존재하지 않는 코드입니다.' });
        if (typeof user.changeCode == 'function') await user.changeCode();
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
        { id: 0,   count: 5000,  goods: 'garnet', amount: 100,      weight: 19  },
        { id: 0,   count: 10000, goods: 'gold',   amount: 600000,   weight: 2   },
        { id: 0,   count: 10000, goods: 'garnet', amount: 180,      weight: 19  },
    ]},
    { name: '쥬얼 섹터', items: [
        { id: 124, count: 5,  goods: 'garnet', amount: 40,  weight: 24  },
        { id: 124, count: 10, goods: 'garnet', amount: 78,  weight: 15  },
        { id: 124, count: 20, goods: 'garnet', amount: 154, weight: 10  },
        { id: 124, count: 30, goods: 'garnet', amount: 228, weight: 5   },
        { id: 124, count: 50, goods: 'garnet', amount: 370, weight: 3   },
        { id: 133, count: 3,  goods: 'gold',   amount: 200000, weight: 1.5 },
        { id: 133, count: 5,  goods: 'garnet', amount: 65,  weight: 24  },
        { id: 133, count: 10, goods: 'garnet', amount: 105, weight: 10  },
        { id: 133, count: 20, goods: 'garnet', amount: 180, weight: 5   },
        { id: 133, count: 30, goods: 'garnet', amount: 270, weight: 2.5 },
    ]},
    { name: '보호 카드 섹터', items: [
        { id: 107, count: 1, goods: 'gold',   amount: 100000,  weight: 0.3    },
        { id: 107, count: 1, goods: 'gold',   amount: 300000,  weight: 3      },
        { id: 107, count: 1, goods: 'garnet', amount: 80,      weight: 10     },
        { id: 107, count: 1, goods: 'garnet', amount: 120,     weight: 40     },
        { id: 108, count: 1, goods: 'gold',   amount: 250000,  weight: 0.1    },
        { id: 108, count: 1, goods: 'gold',   amount: 450000,  weight: 2      },
        { id: 108, count: 1, goods: 'garnet', amount: 150,     weight: 5      },
        { id: 108, count: 1, goods: 'garnet', amount: 210,     weight: 20     },
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
        { id: 21, count: 1, goods: 'garnet', amount: 100,     weight: 10   },
        { id: 21, count: 1, goods: 'garnet', amount: 160,     weight: 30   },
        { id: 22, count: 1, goods: 'gold',   amount: 500000,  weight: 2    },
        { id: 22, count: 1, goods: 'garnet', amount: 200,     weight: 10   },
        { id: 22, count: 1, goods: 'garnet', amount: 320,     weight: 30   },
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
        { id: 144, count: 20, goods: 'gold',   amount: 200000,  weight: 30   },
        { id: 144, count: 20, goods: 'garnet', amount: 20,      weight: 30   },
        { id: 144, count: 100, goods: 'gold',   amount: 950000,  weight: 10   },
        { id: 144, count: 100, goods: 'garnet', amount: 95,      weight: 10   },
        { id: 84,  count: 20, goods: 'gold',   amount: 200000,  weight: 30   },
        { id: 84,  count: 20, goods: 'garnet', amount: 20,      weight: 30   },
        { id: 84,  count: 100, goods: 'gold',   amount: 950000,  weight: 10   },
        { id: 84,  count: 100, goods: 'garnet', amount: 95,      weight: 10   },
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

function generateHotDeal(periodKey) {
    const rng = hotdealRng(hotdealPeriodSeed(periodKey));
    const sectorIdx = hotdealPeriodIndex(periodKey) % HOTDEAL_SECTORS.length;
    const sector = HOTDEAL_SECTORS[sectorIdx];
    const firstIdx = sector.items.indexOf(hotdealWeightedPick(sector.items, rng));
    const pool2 = sector.items.filter((_, i) => i !== firstIdx);
    const second = hotdealWeightedPick(pool2, rng);
    const picks = [sector.items[firstIdx], second].map(item => ({
        ...item,
        amount: item.amounts ? item.amounts[Math.floor(rng() * item.amounts.length)] : item.amount,
    }));
    return { sectorName: sector.name, picks };
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

server.post('/api/party/rooms', requirePartyQuest, (req, res) => {
    const questId = String((req.body && req.body.questId) || '').trim();
    const password = String((req.body && req.body.password) || '');
    const out = partyquest.createRoom(req.session.name, questId, password);
    if (out.error) return res.status(400).json({ error: out.error });
    res.json(out);
});

server.post('/api/party/rooms/:id/join', requirePartyQuest, (req, res) => {
    const out = partyquest.joinRoom(String(req.params.id || ''), req.session.name, String((req.body && req.body.password) || ''));
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
            return {
                periodKey,
                sectorName: d.sectorName,
                slots: d.picks.map(p => ({
                    itemId: p.id,
                    name: itemName(p.id),
                    iconUrl: itemIcon(p.id),
                    count: p.count,
                    goods: p.goods,
                    amount: p.amount,
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

function getCharacterCoverImageUrl(data) {
    if (!data || !data.name) return null;
    const file = '캐릭터표지.png';
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
            starText: s.starText,
            name: s.name,
            formatted: s.formatted,
            imageUrl: s.imageUrl,
            combinable: !!rpgenius.getCardCombineInfo(star)
        };
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
    return characterCards.map((data, id) => {
        if (!data) return null;
        const baseCard = { id, star: 0, type: '일반' };
        const slotEffect = buildSlotEffectInfo({ id, star: 4 }, data);
        return {
            kind: 'character',
            type: 'character',
            typeLabel: '캐릭터 카드',
            id,
            name: data.name,
            formatted: rpgenius.formatUserCard(baseCard),
            imageUrl: getCardImageUrl(baseCard, { prestige: false }),
            coverUrl: getCharacterCoverImageUrl(data),
            slotEffect,
            skills: Array.isArray(data.skills) ? data.skills.map(skillId => {
                const skill = skills[Number(skillId)];
                if (!skill) return null;
                return {
                    id: Number(skillId),
                    name: skill.name,
                    mpCost: Number(skill.mp_cost || 0),
                    cooltimeText: rpgenius.formatCooltime(Number(skill.cooltime || 0)),
                    descLines: rpgenius.formatSkillDescWithIncrease(skill).split('\n').filter(Boolean)
                };
            }).filter(Boolean) : []
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
            isAdmin: !!user.isAdmin,
            canPartyQuest: !!user.canPartyQuest
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
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent;-webkit-touch-callout:none}
body{margin:0;background:#06070d;background-image:radial-gradient(ellipse 100% 55% at -5% 0%,rgba(30,41,59,.8),transparent 55%),radial-gradient(ellipse 60% 40% at 110% 100%,rgba(88,101,242,.07),transparent);color:#e5e7eb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
header{position:sticky;top:0;z-index:5;display:flex;justify-content:space-between;align-items:center;padding:14px 24px;background:rgba(5,6,12,.9);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);border-bottom:1px solid rgba(255,255,255,.06);box-shadow:0 1px 0 rgba(99,102,241,.12)}
h1{margin:0;font-size:21px;font-weight:900;white-space:nowrap;background:linear-gradient(135deg,#818cf8,#a78bfa 60%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;letter-spacing:.01em}.who{color:#a5b4fc;font-weight:700;white-space:nowrap;min-width:0;overflow:hidden;text-overflow:ellipsis}.bar{display:flex;gap:8px;align-items:center;justify-content:flex-end;min-width:0;flex-shrink:0}.top-left{display:flex;gap:16px;align-items:center;min-width:0;flex:1}.group-tabs{display:flex;gap:2px;min-width:0;overflow:hidden}.group-tab{white-space:nowrap;background:transparent;border:0;color:#64748b;padding:8px 12px;border-radius:9px;font-weight:700;font-size:13px;cursor:pointer;transition:all .15s;flex-shrink:0}.group-tab:hover{background:rgba(255,255,255,.06);color:#e5e7eb}.group-tab.active{background:rgba(88,101,242,.2);color:#e5e7eb;box-shadow:0 0 0 1px rgba(99,102,241,.28)}.subnav-bar{display:flex;gap:2px;padding:0 20px;background:rgba(4,6,14,.82);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);border-bottom:1px solid rgba(255,255,255,.05);overflow-x:auto;scrollbar-width:none;flex-shrink:0}.subnav-bar::-webkit-scrollbar{display:none}.subnav-tab{flex-shrink:0;padding:9px 14px;background:transparent;border:0;border-bottom:2px solid transparent;border-radius:6px 6px 0 0;color:#64748b;font-size:13px;font-weight:600;cursor:pointer;transition:all .15s;margin-bottom:-1px}.subnav-tab:hover{color:#cbd5e1;background:rgba(255,255,255,.05)}.subnav-tab.active{color:#e5e7eb;border-bottom-color:#818cf8}.bottom-tabs{display:none;position:fixed;bottom:0;left:0;right:0;z-index:50;padding:8px 4px calc(8px + env(safe-area-inset-bottom));background:rgba(5,6,12,.94);backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);border-top:1px solid rgba(255,255,255,.07);justify-content:space-around;align-items:flex-start}.bottom-tab{flex:1;display:flex;flex-direction:column;align-items:center;gap:3px;padding:5px 2px;background:transparent;border:0;color:#475569;cursor:pointer;transition:color .15s;border-radius:0;font-weight:700;min-width:0}.bottom-tab:hover{color:#94a3b8;background:transparent}.tab-icon-wrap{display:flex;align-items:center;justify-content:center;width:44px;height:28px;border-radius:14px;background:transparent;transition:background .15s}.tab-icon-wrap svg{width:22px;height:22px;display:block;flex-shrink:0;transition:filter .15s}.tab-label{font-size:10px;letter-spacing:.03em;white-space:nowrap}.bottom-tab.active{color:#818cf8}.bottom-tab.active .tab-icon-wrap{background:rgba(88,101,242,.22);box-shadow:0 0 10px rgba(88,101,242,.3)}.bottom-tab.active .tab-icon-wrap svg{filter:drop-shadow(0 0 3px rgba(129,140,248,.7))}.group-tab{gap:6px;display:flex;align-items:center}.group-tab svg{width:15px;height:15px;display:block;flex-shrink:0;opacity:.75;transition:opacity .15s}.group-tab:hover svg,.group-tab.active svg{opacity:1}
button{border:0;border-radius:10px;padding:10px 13px;background:#141c2e;color:#e5e7eb;font-weight:700;cursor:pointer;transition:background .15s,box-shadow .15s,transform .1s}button:hover{background:#1a2540}.primary{background:linear-gradient(135deg,#5865f2,#4338ca);box-shadow:0 4px 12px rgba(88,101,242,.32)}.primary:hover{background:linear-gradient(135deg,#4752c4,#3730a3);box-shadow:0 6px 18px rgba(88,101,242,.48)}
main{width:min(1180px,94vw);margin:26px auto 50px;display:grid;gap:18px}.page{display:none;gap:18px}.page.active{display:grid}.profile-hero{display:grid;grid-template-columns:170px 1fr;gap:18px;align-items:start}.profile-card{text-align:center}.profile-card .card-tile{padding:0;background:transparent;border:0;box-shadow:none}.profile-card img{width:160px;aspect-ratio:3/4;object-fit:cover;border-radius:4px;border:4px solid #020617;background:#f8fafc}.profile-card .card-name{font-size:16px;color:#f8fafc}.profile-summary{padding-top:4px}.name-line{font-size:20px;margin-bottom:8px}.status-row{display:grid;grid-template-columns:32px minmax(160px,300px) auto;gap:10px;align-items:center;margin:10px 0;font-size:18px}.meter{height:22px;border-radius:6px;background:rgba(2,6,23,.65);overflow:hidden}.meter-fill{height:100%;width:0%}.meter.hp .meter-fill{background:#ef171e}.meter.mp .meter-fill{background:#4140c8}.power-line{font-size:18px;margin-top:14px}.pet-row{display:flex;flex-direction:column;gap:8px;margin-top:14px}.pet-item{display:flex;align-items:center;gap:10px}.pet-thumb{position:relative;width:52px;height:52px;flex:0 0 auto;background:rgba(15,23,42,.7);border-radius:10px;overflow:visible}.pet-thumb .frame{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;z-index:1}.pet-thumb .icon{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);z-index:2;width:120%;height:120%;object-fit:contain;filter:drop-shadow(0 3px 6px rgba(0,0,0,.5))}.pet-thumb .icon-fallback{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);z-index:2;font-size:26px;line-height:1}.pet-thumb.expired .icon{filter:grayscale(1) brightness(.6)}.pet-name{font-size:15px;color:#f8fafc}.pet-item.expired .pet-name{color:#94a3b8}.panel{background:rgba(8,10,20,.82);border:1px solid rgba(255,255,255,.07);border-radius:20px;padding:20px;box-shadow:0 4px 24px rgba(0,0,0,.38),0 0 0 1px rgba(255,255,255,.02) inset;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px)}
h2{margin:0 0 16px;font-size:16px;font-weight:800;letter-spacing:.01em;color:#f1f5f9}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.kv{display:flex;justify-content:space-between;gap:12px;padding:10px 14px;background:rgba(4,6,18,.65);border:1px solid rgba(255,255,255,.06);border-radius:12px}.kv span{color:#94a3b8}.kv b{font-variant-numeric:tabular-nums}.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(132px,1fr));gap:12px}
.card-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:12px}.card-tile{background:rgba(4,6,18,.65);border:1px solid rgba(255,255,255,.07);border-radius:16px;padding:10px;text-align:center}.card-tile img{width:100%;border-radius:12px;display:block;box-shadow:0 10px 24px rgba(0,0,0,.35)}.card-tile.compact{padding:8px}.card-name{margin-top:8px;font-size:13px;font-weight:700}.no-img,.empty-card{min-height:180px;display:grid;place-items:center;color:#94a3b8;border:1px dashed #334155;border-radius:12px}.card-tile.compact .no-img,.card-tile.compact .empty-card{min-height:120px}
.actions{display:flex;gap:8px;flex-wrap:wrap}.view-btn{background:rgba(10,15,28,.8);border:1px solid rgba(255,255,255,.1)}.inv-kind-tabs{display:flex;gap:6px;overflow-x:auto;scrollbar-width:none;flex-wrap:nowrap;padding-bottom:2px}.inv-kind-tabs::-webkit-scrollbar{display:none}.inv-kind-tab{flex-shrink:0;white-space:nowrap;background:rgba(10,15,28,.8);border:1px solid rgba(255,255,255,.1);font-size:13px;padding:7px 14px}.inv-kind-tab.active{background:rgba(88,101,242,.22);border-color:rgba(99,102,241,.5);color:#e0e7ff}.viewer{display:grid;gap:18px}.cat{display:grid;gap:8px}.cat-title{font-size:14px;font-weight:800;color:#f1f5f9;padding:4px 4px 6px;border-bottom:1px solid rgba(148,163,184,.18);margin-bottom:2px}.inv-row{display:flex;justify-content:space-between;gap:12px;align-items:center;padding:12px 14px;background:rgba(4,6,18,.6);border:1px solid rgba(255,255,255,.06);border-radius:13px}.inv-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(72px,1fr));gap:6px}.inv-cell{position:relative;background:rgba(4,6,18,.7);border:1px solid rgba(255,255,255,.09);border-radius:10px;cursor:pointer;transition:border-color .15s,transform .12s,box-shadow .12s;overflow:hidden}.inv-cell:hover{border-color:rgba(99,102,241,.5);transform:translateY(-1px);box-shadow:0 6px 18px rgba(0,0,0,.4)}.inv-cell-img{aspect-ratio:1/1;position:relative;display:grid;place-items:center;background:rgba(15,23,42,.5)}.inv-cell-frame{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;z-index:1}.inv-cell-icon{position:relative;z-index:2;width:65%;height:65%;object-fit:contain;filter:drop-shadow(0 3px 6px rgba(0,0,0,.55))}.inv-cell-count{position:absolute;bottom:3px;right:5px;font-size:11px;font-weight:900;color:#f8fafc;text-shadow:0 1px 4px rgba(0,0,0,.9),0 0 2px rgba(0,0,0,1);line-height:1;z-index:3}.inv-cell-name{padding:3px 4px 5px;font-size:10px;font-weight:700;color:#94a3b8;text-align:center;line-height:1.2;word-break:break-word;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.equip-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px}.equip-card{position:relative;display:grid;grid-template-columns:48px 1fr auto;gap:12px;align-items:center;padding:14px;background:linear-gradient(135deg,rgba(4,6,18,.9),rgba(8,12,26,.75));border:1px solid var(--rar,rgba(255,255,255,.08));border-left:4px solid var(--rar,rgba(255,255,255,.15));border-radius:14px;box-shadow:0 8px 24px rgba(0,0,0,.3)}.equip-card .slot-icon{display:grid;place-items:center;width:48px;height:48px;border-radius:12px;background:rgba(148,163,184,.12);font-size:22px}.equip-card .equip-name{font-size:16px;font-weight:800;color:#f8fafc;margin-bottom:6px}.equip-card .equip-meta{display:flex;gap:6px;flex-wrap:wrap;align-items:center}.equip-card .level{font-size:20px;font-weight:900;font-variant-numeric:tabular-nums;color:#fbbf24}.card-tile,.equip-card{cursor:pointer;transition:transform .12s,box-shadow .12s}.card-tile:hover,.equip-card:hover{transform:translateY(-2px);box-shadow:0 14px 36px rgba(0,0,0,.45),0 0 0 1px rgba(99,102,241,.2)}.modal-bg{position:fixed;inset:0;background:rgba(0,0,0,.72);display:none;align-items:center;justify-content:center;z-index:70;backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);padding:16px}.modal-bg.active{display:flex}.modal{width:min(480px,100%);max-height:90vh;overflow-y:auto;background:rgba(7,10,20,.97);border:1px solid rgba(255,255,255,.1);border-radius:20px;padding:24px;box-shadow:0 30px 80px rgba(0,0,0,.7),0 0 0 1px rgba(255,255,255,.03) inset}.modal.wide{width:min(640px,100%)}.modal h3{margin:0 0 6px;font-size:18px;color:#f8fafc}.modal .sub{color:#94a3b8;font-size:13px;margin-bottom:14px}.modal .stat-line{padding:8px 12px;background:rgba(2,6,23,.6);border:1px solid rgba(148,163,184,.12);border-radius:10px;margin:6px 0;font-size:14px}.modal .close{margin-top:14px;width:100%}.modal .row{display:flex;gap:8px;margin-top:12px;flex-wrap:wrap}.modal .row>*{flex:1}.modal label{display:block;font-size:13px;color:#94a3b8;margin:10px 0 6px;font-weight:700}.modal input,.modal select{width:100%;padding:10px 12px;border-radius:10px;border:1px solid rgba(255,255,255,.1);background:rgba(4,6,18,.85);color:#e5e7eb;font-size:14px;font-weight:600;font-family:inherit;transition:border-color .15s}.modal input:focus,.modal select:focus{outline:none;border-color:rgba(99,102,241,.6);box-shadow:0 0 0 3px rgba(99,102,241,.1)}.seg{display:flex;gap:6px;background:rgba(4,6,18,.7);padding:4px;border-radius:12px;flex-wrap:wrap;border:1px solid rgba(255,255,255,.06)}.seg button{flex:1 0 auto;background:transparent;font-size:13px;padding:8px 12px;white-space:nowrap;color:#94a3b8;transition:all .15s}.seg button:hover{background:rgba(255,255,255,.06);color:#e5e7eb}.seg button.on{background:linear-gradient(135deg,#5865f2,#4338ca);color:#fff;box-shadow:0 2px 8px rgba(88,101,242,.35)}.pick-list{max-height:280px;overflow-y:auto;display:grid;gap:6px;margin-top:8px;padding:4px;background:rgba(4,6,18,.5);border-radius:10px}.pick-row{display:flex;justify-content:space-between;gap:10px;align-items:center;padding:10px 12px;background:rgba(10,15,30,.7);border:1px solid rgba(255,255,255,.06);border-radius:10px;cursor:pointer;font-size:13px;transition:border-color .15s,background .15s}.pick-row:hover{border-color:rgba(99,102,241,.5)}.pick-row.on{border-color:rgba(99,102,241,.55);background:rgba(88,101,242,.16)}.pick-row .meta{color:#94a3b8;font-size:12px;margin-top:2px}.danger{background:#dc2626}.danger:hover{background:#b91c1c}
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
.combine-wrap{display:grid;gap:14px;justify-items:center}
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
.profile-banner{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:12px 16px;background:linear-gradient(135deg,rgba(251,191,36,.18),rgba(88,101,242,.18));border:1px solid rgba(251,191,36,.4);border-radius:14px;color:#fde68a;font-weight:700}.profile-banner button{padding:8px 12px;font-size:13px}
.rank-section{display:grid;gap:14px}.rank-tabs{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px}.rank-tab{padding:9px 14px;border-radius:10px;background:rgba(20,28,46,.8);color:#94a3b8;cursor:pointer;font-weight:700;font-size:13px;border:1px solid rgba(255,255,255,.07);transition:all .15s}.rank-tab.active{background:linear-gradient(135deg,#5865f2,#4338ca);color:#fff;border-color:transparent;box-shadow:0 4px 12px rgba(88,101,242,.32)}
.rank-me{padding:14px 16px;background:linear-gradient(135deg,rgba(88,101,242,.15),rgba(4,6,18,.7));border:1px solid rgba(88,101,242,.4);border-radius:14px;display:grid;grid-template-columns:auto 1fr auto auto;gap:14px;align-items:center;font-weight:700;box-shadow:0 4px 16px rgba(88,101,242,.15)}.rank-me .rk{font-size:22px;color:#a5b4fc}.rank-me .nm{font-size:15px;color:#f8fafc}.rank-me .lv{font-size:12px;color:#94a3b8}.rank-me .vl{font-size:18px;color:#fbbf24;font-variant-numeric:tabular-nums}
.rank-list{display:grid;gap:8px}.rank-row{display:grid;grid-template-columns:60px 1fr auto;align-items:center;gap:12px;padding:12px 14px;background:rgba(4,6,18,.6);border:1px solid rgba(255,255,255,.06);border-radius:12px;cursor:pointer;transition:transform .12s,border-color .12s,background .12s,box-shadow .12s}.rank-row:hover{transform:translateX(3px);border-color:rgba(88,101,242,.5);background:rgba(88,101,242,.1);box-shadow:0 4px 14px rgba(88,101,242,.15)}.rank-row.me{border-color:#fbbf24;background:rgba(251,191,36,.08)}.rank-row .rk{font-size:16px;font-weight:800;color:#a5b4fc;text-align:center}.rank-row .rk.gold{color:#fbbf24;font-size:22px}.rank-row .rk.silver{color:#cbd5e1;font-size:20px}.rank-row .rk.bronze{color:#d97706;font-size:18px}.rank-row .nm{font-weight:700;color:#f1f5f9}.rank-row .lv{font-size:12px;color:#94a3b8;margin-left:6px}.rank-row .vl{font-weight:800;color:#fbbf24;font-variant-numeric:tabular-nums;font-size:15px}
.dex-tabs{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px}.dex-tab{padding:9px 14px;border-radius:10px;background:rgba(20,28,46,.8);color:#94a3b8;cursor:pointer;font-weight:700;font-size:13px;border:1px solid rgba(255,255,255,.07);transition:all .15s}.dex-tab.active{background:linear-gradient(135deg,#5865f2,#4338ca);color:#fff;border-color:transparent;box-shadow:0 4px 12px rgba(88,101,242,.32)}
.dex-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:14px}
.dex-card{display:grid;gap:12px;padding:14px;background:linear-gradient(135deg,rgba(4,6,18,.9),rgba(8,12,26,.75));border:1px solid var(--rar,rgba(255,255,255,.08));border-left:4px solid var(--rar,rgba(255,255,255,.15));border-radius:14px;box-shadow:0 8px 24px rgba(0,0,0,.3)}
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
.auction-bar{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:14px}.auction-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px}.auc-card{position:relative;display:flex;flex-direction:column;gap:8px;padding:14px;background:rgba(4,6,18,.65);border:1px solid rgba(255,255,255,.07);border-radius:16px;cursor:pointer;transition:transform .12s,box-shadow .12s,border-color .12s}.auc-card:hover{transform:translateY(-2px);box-shadow:0 14px 36px rgba(0,0,0,.45),0 0 0 1px rgba(88,101,242,.3);border-color:rgba(88,101,242,.45)}.auc-card.mine{border-color:#fbbf24}.auc-thumb{aspect-ratio:3/4;display:grid;place-items:center;background:rgba(15,23,42,.7);border-radius:10px;font-size:64px;overflow:hidden}.auc-thumb.square{aspect-ratio:1/1;position:relative;background:transparent}.auc-thumb img{width:100%;height:100%;object-fit:contain}.auc-thumb.card{background:transparent}.auc-frame{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;z-index:1}.auc-icon,.auc-item-img{position:relative;z-index:2}.auc-icon{font-size:64px;line-height:1;text-shadow:0 4px 14px rgba(0,0,0,.6)}.auc-item-img{width:62%;height:62%;object-fit:contain;filter:drop-shadow(0 6px 10px rgba(0,0,0,.55))}.currency-img{width:20px;height:20px;object-fit:contain;vertical-align:-4px;margin-right:5px}.auc-name{font-weight:800;font-size:15px;color:#f8fafc;line-height:1.3;word-break:break-word}.auc-sub{font-size:12px;color:#94a3b8}.auc-price{display:flex;justify-content:space-between;align-items:center;font-weight:800;font-size:15px;color:#fbbf24}.auc-seller{font-size:11px;color:#64748b}.auc-mine-badge{position:absolute;top:8px;right:8px;background:#fbbf24;color:#0f172a;font-size:11px;font-weight:800;padding:3px 7px;border-radius:999px}.tag{display:inline-block;padding:3px 8px;border-radius:999px;background:#263244;color:#cbd5e1;font-size:12px;font-weight:700}.tag.rarity{color:#fff;background:var(--rar,#334155)}.tag.on{background:#14532d;color:#bbf7d0}.empty,.loading{padding:24px;text-align:center;color:#94a3b8}.err{color:#f87171}.section-row{display:grid;grid-template-columns:1fr 1fr;gap:18px}
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
.shop-card-thumb-icon{position:relative;z-index:2;width:90%;height:90%;object-fit:contain;filter:drop-shadow(0 2px 8px rgba(0,0,0,.6))}
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
@media(max-width:520px){header{padding:10px 8px;gap:6px}h1{font-size:clamp(16px,5vw,20px)}.top-left{gap:8px}.bar{gap:5px}.who{max-width:30vw;font-size:clamp(10px,2.8vw,12px)}.subnav-bar{padding:0 8px}.tab-label{display:none}.tab-icon-wrap{width:36px;height:36px;border-radius:12px}.tab-icon-wrap svg{width:20px;height:20px}.search-input{flex:1;min-width:0}.shop-grid{grid-template-columns:repeat(2,1fr);gap:8px}.shop-currency-chip{font-size:11px;padding:4px 8px}.shop-currency-chip img{width:14px;height:14px}}
</style></head><body>
<header><div class="top-left"><h1>RPGenius</h1><nav class="group-tabs" id="groupTabs"></nav></div><div class="bar"><span class="who" id="who">${escapeHtml(sess.name)}</span><button id="adminLink" class="primary" style="display:none;padding:8px 12px;font-size:13px">관리자</button><button id="logout" style="padding:8px 12px;font-size:13px">로그아웃</button></div></header>
<div class="subnav-bar" id="subNavBar"></div>
<main id="app">
  <div class="page active" data-page="info">
    <div id="profileBanner" class="profile-banner" style="display:none"><span id="profileBannerText"></span><button id="profileBackBtn" class="primary">내 정보로 돌아가기</button></div>
    <section class="panel"><div class="profile-hero"><div id="mainCard" class="profile-card"></div><div class="profile-summary"><div class="name-line"><span id="level">-</span> <span id="profileName">-</span> <span id="exp" style="color:#94a3b8;font-size:15px">-</span></div><div class="status-row"><span>HP</span><div class="meter hp"><div class="meter-fill" id="hpFill"></div></div><b id="hp">-</b></div><div class="status-row"><span>MP</span><div class="meter mp"><div class="meter-fill" id="mpFill"></div></div><b id="mp">-</b></div><div class="power-line">⚔️ <b id="totalPower">-</b></div><div id="petRow" class="pet-row"></div></div></div></section>
    <section class="panel"><h2>장착 중인 카드 슬롯</h2><div id="slotCards" class="cards"></div></section>
    <section class="panel"><h2>재화</h2><div id="goods" class="grid"></div></section>
    <section class="panel"><h2>스탯</h2><div id="stats" class="grid"></div></section>
    <section class="panel"><h2>장착 장비</h2><div id="equippedGear" class="equip-grid"></div></section>
    <button id="viewInventoryBtn" class="primary" style="display:none;justify-self:center;padding:12px 22px;font-size:15px">인벤토리 보기</button>
  </div>
  <div class="page" data-page="inventory">
    <div id="inventoryBanner" class="profile-banner" style="display:none"><span id="inventoryBannerText"></span><button id="inventoryBackBtn" class="primary">내 인벤토리로 돌아가기</button></div>
    <section class="panel" style="min-width:0"><h2 id="viewerTitle" style="margin:0 0 10px">인벤토리</h2><div class="inv-kind-tabs"><button class="view-btn inv-kind-tab" data-kind="items">인벤토리</button><button class="view-btn inv-kind-tab" data-kind="cards">캐릭터 카드</button><button class="view-btn inv-kind-tab" data-kind="equipment">보유 장비</button><button class="view-btn inv-kind-tab" data-kind="pet">보유 펫</button></div><div id="viewer" class="viewer" style="margin-top:14px"></div></section>
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
  <div class="page" data-page="auction"><section class="panel"><div class="auction-bar"><h2 style="margin:0">팝니다</h2><div class="actions"><input id="aucSearch" class="search-input" placeholder="검색..." autocomplete="off"><div class="seg" id="aucFilter"><button data-filter="all" class="on">전체</button><button data-filter="card">카드</button><button data-filter="equipment">장비</button><button data-filter="pet">펫</button><button data-filter="item">아이템</button><button data-filter="mine">내 판매</button></div><button class="primary" id="aucNew">+ 등록</button></div></div><div id="auctionList" class="auction-grid"></div></section></div>
  <div class="page" data-page="ranking"><section class="panel rank-section"><div class="auction-bar"><h2 style="margin:0">랭킹</h2><div class="rank-tabs"><button class="rank-tab active" data-tab="cp">전투력 랭킹</button><button class="rank-tab" data-tab="exp">경험치 랭킹</button><button class="rank-tab" data-tab="worldBoss">월드보스 랭킹</button></div></div><div id="rankMe"></div><div id="rankList" class="rank-list"></div></section></div>
  <div class="page" data-page="dex"><section class="panel"><div class="auction-bar"><h2 style="margin:0">도감</h2><div class="dex-tabs"><button class="dex-tab active" data-tab="weapon">무기</button><button class="dex-tab" data-tab="armor">갑옷</button><button class="dex-tab" data-tab="accessory">장신구</button><button class="dex-tab" data-tab="support">보조</button><button class="dex-tab" data-tab="pet">펫</button><button class="dex-tab" data-tab="character">캐릭터 카드</button></div></div><div id="dexList" class="dex-grid"></div></section></div>
  <div class="page" data-page="shop"><section class="panel shop-wrap"><div id="shopBody"></div></section></div>
  <div class="page" data-page="buyorder"><section class="panel"><div class="auction-bar"><h2 style="margin:0">삽니다</h2><div class="actions"><input id="boSearch" class="search-input" placeholder="검색..." autocomplete="off"><div class="seg" id="boFilter"><button data-filter="all" class="on">전체</button><button data-filter="card">카드</button><button data-filter="equipment">장비</button><button data-filter="pet">펫</button><button data-filter="item">아이템</button><button data-filter="mine">내 구매</button></div><button class="primary" id="boNew">+ 구매 등록</button></div></div><div id="buyOrderList" class="auction-grid"></div></section></div>
  <div class="page" data-page="patchnotes"><section class="panel patch-wrap"><div class="auction-bar"><h2 style="margin:0">패치노트</h2><button class="primary" id="patchNew" style="display:none">+ 작성</button></div><div class="patch-editor" id="patchEditor"><input id="patchTitle" placeholder="제목"><input id="patchDate" placeholder="패치 일자 (비워두면 작성일시)" type="datetime-local"><textarea id="patchBody" placeholder="본문 (Markdown 지원)"></textarea><div class="actions"><button class="primary" id="patchSubmit">등록</button><button id="patchCancel">취소</button></div></div><div id="patchList" class="patch-list"></div></section></div>
</main>
<div id="modalBg" class="modal-bg"><div class="modal"><h3 id="modalTitle">-</h3><div class="sub" id="modalSub"></div><div id="modalBody"></div><button class="primary close" id="modalClose">닫기</button></div></div>
<div id="enhanceOverlay" class="enhance-overlay"><div class="enhance-wrap"><div id="enhanceContent"></div><div id="enhanceResultOverlay" class="enhance-result-overlay"></div></div></div>
<div id="aucDetailBg" class="modal-bg"><div class="modal" id="aucDetail"></div></div>
<div id="aucRegBg" class="modal-bg"><div class="modal wide" id="aucReg"></div></div>
<div id="boDetailBg" class="modal-bg"><div class="modal" id="boDetail"></div></div>
<div id="boRegBg" class="modal-bg"><div class="modal wide" id="boReg"></div></div>
<nav class="bottom-tabs" id="bottomTabs"></nav>
<script>window.HAS_PARTY=${sess.canPartyQuest ? 'true' : 'false'};</script>
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
      <select id="pqCreateQuest" class="pq-select"></select>
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
