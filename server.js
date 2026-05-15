const express = require('express');
const crypto = require('crypto');
const path = require('path');
const rpgenius = require('./rpgenius.js');

const SESSION_SECRET = process.env.ADMIN_SESSION_SECRET || 'rpgenius-default-secret-change-me';
const SESSION_COOKIE = 'rpg_admin';
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

const fs = require('fs');

const server = express();
server.use(express.json({ limit: '5mb' }));
server.use(express.urlencoded({ extended: false }));

const ADMIN_HTML_PATH = path.join(__dirname, 'public', 'admin.html');
const ADMIN_JS_PATH = path.join(__dirname, 'public', 'admin.js');
const APP_JS_PATH = path.join(__dirname, 'public', 'app.js');
const CHARACTER_CARDS_PATH = path.join(__dirname, 'DB', 'RPGenius', 'CharacterCards.json');
const CARD_IMAGE_PATH = path.join(__dirname, 'DB', 'RPGenius', 'cardImage');
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

server.get('/card-image', requireUser, (req, res) => {
    const name = String(req.query.name || '');
    const file = String(req.query.file || '');
    if (!name || !file || name.includes('..') || file.includes('..') || path.basename(name) != name || path.basename(file) != file) return res.status(400).end();
    const filePath = path.join(CARD_IMAGE_PATH, name, file);
    if (!filePath.startsWith(path.join(CARD_IMAGE_PATH, name)) || !fs.existsSync(filePath)) return res.status(404).end();
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
    res.json({ weapon: pack(eq.weapon), armor: pack(eq.armor), accessory: pack(eq.accessory) });
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
        slotEffect: buildSlotEffectInfo(card, data)
    };
}

function buildInventoryItems(user) {
    const items = rpgenius.getDataCache('Item', []);
    return (user.inventory && Array.isArray(user.inventory.item) ? user.inventory.item : [])
        .map(inv => {
            const data = items[inv.id];
            return data ? { id: Number(inv.id), name: data.name, type: data.type, desc: data.desc || '', count: Number(inv.count || 0) } : null;
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
    const labels = { weapon: '무기', armor: '갑옷', accessory: '장신구' };
    const add = (equip, type, equipped) => {
        const data = equip && getEquipmentData(equip.type || type, equip.id);
        if (!data) return;
        const level = Number(equip.level || 0);
        const statText = rpgenius.formatCurrentEquipmentStatLines(data, level);
        const statLines = String(statText || '').split('\n').filter(line => line && line.trim());
        result.push({
            type: equip.type || type,
            typeLabel: labels[equip.type || type] || (equip.type || type),
            id: Number(equip.id),
            name: data.name,
            rarity: data.rarity,
            level,
            equipped: !!equipped,
            statLines
        });
    };
    (user.inventory && Array.isArray(user.inventory.equipment) ? user.inventory.equipment : []).forEach(equip => add(equip, equip.type, false));
    if (user.equipments && user.equipments.weapon) add(user.equipments.weapon, 'weapon', true);
    if (user.equipments && user.equipments.armor) add(user.equipments.armor, 'armor', true);
    const accessories = user.equipments && user.equipments.accessory || {};
    Object.keys(accessories).forEach(key => add(accessories[key], 'accessory', true));
    return result;
}

// ===== 경매장 헬퍼 =====

const AUCTION_FEE_RATE = 0.05;
const AUCTION_MAX_PER_USER = 20;
const AUCTION_MAX_PRICE = 1_000_000_000_000;

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
            sub: data ? (data.rarity + ' · ' + ({ weapon: '무기', armor: '갑옷', accessory: '장신구' }[entry.payload.type] || entry.payload.type)) : '',
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
    let statLines = null;
    if (entry.kind == 'card') {
        imageUrl = getCardImageUrl(entry.payload || {}, { prestige: false });
    } else if (entry.kind == 'equipment') {
        const data = getEquipmentData(entry.payload && entry.payload.type, entry.payload && entry.payload.id);
        if (data) {
            const text = rpgenius.formatCurrentEquipmentStatLines(data, Number(entry.payload && entry.payload.level || 0));
            statLines = String(text || '').split('\n').filter(line => line && line.trim()).map(line => line.replace(/^-\s*/, ''));
        }
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
            if (!data) return null;
            const level = Number(eq.level || 0);
            const statText = rpgenius.formatCurrentEquipmentStatLines(data, level);
            return {
                index,
                type: eq.type,
                typeLabel: { weapon: '무기', armor: '갑옷', accessory: '장신구' }[eq.type] || eq.type,
                id: Number(eq.id),
                name: data.name,
                rarity: data.rarity,
                level,
                statLines: String(statText || '').split('\n').filter(line => line && line.trim()).map(line => line.replace(/^-\s*/, ''))
            };
        })
        .filter(Boolean);
    const items = buildInventoryItems(user);
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
        payload = { type: eq.type, id: Number(eq.id), level: Number(eq.level || 0) };
        equips.splice(index, 1);
    } else if (kind == 'item') {
        const itemId = Number(body.itemId);
        count = Math.floor(Number(body.count || 1));
        if (!Number.isInteger(itemId) || itemId < 0) return { error: '아이템을 선택해주세요.' };
        if (!Number.isInteger(count) || count < 1) return { error: '갯수는 1 이상의 정수여야 합니다.' };
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
    return { id: entry.id };
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
        buyer.inventory.equipment.push({
            type: entry.payload.type,
            id: Number(entry.payload.id),
            level: Number(entry.payload.level || 0)
        });
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
    return {};
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
        user.inventory.equipment.push({
            type: entry.payload.type,
            id: Number(entry.payload.id),
            level: Number(entry.payload.level || 0)
        });
    } else if (entry.kind == 'item') {
        rpgenius.addInventoryItem(user, Number(entry.payload.id), Number(entry.count || 1));
    }

    list.splice(index, 1);
    await saveAuctionList(list);
    await user.save();
    return {};
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
h1{margin:0;font-size:22px}.who{color:#a5b4fc;font-weight:700}.bar{display:flex;gap:8px;align-items:center}.top-left{display:flex;gap:22px;align-items:center}.nav{display:flex;gap:6px}.nav-btn.active{background:#5865f2}
button{border:0;border-radius:10px;padding:10px 13px;background:#1f2937;color:#e5e7eb;font-weight:700;cursor:pointer}button:hover{background:#374151}.primary{background:#5865f2}.primary:hover{background:#4752c4}
main{width:min(1180px,94vw);margin:26px auto 50px;display:grid;gap:18px}.page{display:none;gap:18px}.page.active{display:grid}.profile-hero{display:grid;grid-template-columns:170px 1fr;gap:18px;align-items:start}.profile-card{text-align:center}.profile-card .card-tile{padding:0;background:transparent;border:0;box-shadow:none}.profile-card img{width:160px;aspect-ratio:3/4;object-fit:cover;border-radius:4px;border:4px solid #020617;background:#f8fafc}.profile-card .card-name{font-size:16px;color:#f8fafc}.profile-summary{padding-top:4px}.name-line{font-size:20px;margin-bottom:8px}.status-row{display:grid;grid-template-columns:32px minmax(160px,300px) auto;gap:10px;align-items:center;margin:10px 0;font-size:18px}.meter{height:22px;border-radius:6px;background:rgba(2,6,23,.65);overflow:hidden}.meter-fill{height:100%;width:0%}.meter.hp .meter-fill{background:#ef171e}.meter.mp .meter-fill{background:#4140c8}.power-line{font-size:18px;margin-top:14px}.panel{background:rgba(15,23,42,.82);border:1px solid rgba(148,163,184,.16);border-radius:18px;padding:18px;box-shadow:0 16px 50px rgba(0,0,0,.25)}
h2{margin:0 0 14px;font-size:17px}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.kv{display:flex;justify-content:space-between;gap:12px;padding:10px 12px;background:rgba(2,6,23,.52);border:1px solid rgba(148,163,184,.12);border-radius:12px}.kv span{color:#94a3b8}.kv b{font-variant-numeric:tabular-nums}.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(132px,1fr));gap:12px}
.card-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:12px}.card-tile{background:rgba(2,6,23,.58);border:1px solid rgba(148,163,184,.14);border-radius:16px;padding:10px;text-align:center}.card-tile img{width:100%;border-radius:12px;display:block;box-shadow:0 10px 24px rgba(0,0,0,.35)}.card-tile.compact{padding:8px}.card-name{margin-top:8px;font-size:13px;font-weight:700}.no-img,.empty-card{min-height:180px;display:grid;place-items:center;color:#94a3b8;border:1px dashed #334155;border-radius:12px}.card-tile.compact .no-img,.card-tile.compact .empty-card{min-height:120px}
.actions{display:flex;gap:8px;flex-wrap:wrap}.view-btn{background:#111827;border:1px solid #334155}.viewer{display:grid;gap:18px}.cat{display:grid;gap:8px}.cat-title{font-size:14px;font-weight:800;color:#f1f5f9;padding:4px 4px 6px;border-bottom:1px solid rgba(148,163,184,.18);margin-bottom:2px}.inv-row{display:flex;justify-content:space-between;gap:12px;align-items:center;padding:12px 14px;background:rgba(2,6,23,.52);border:1px solid rgba(148,163,184,.12);border-radius:13px}.equip-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px}.equip-card{position:relative;display:grid;grid-template-columns:48px 1fr auto;gap:12px;align-items:center;padding:14px;background:linear-gradient(135deg,rgba(2,6,23,.85),rgba(15,23,42,.7));border:1px solid var(--rar,#334155);border-left:5px solid var(--rar,#334155);border-radius:14px;box-shadow:0 8px 24px rgba(0,0,0,.25)}.equip-card .slot-icon{display:grid;place-items:center;width:48px;height:48px;border-radius:12px;background:rgba(148,163,184,.12);font-size:22px}.equip-card .equip-name{font-size:16px;font-weight:800;color:#f8fafc;margin-bottom:6px}.equip-card .equip-meta{display:flex;gap:6px;flex-wrap:wrap;align-items:center}.equip-card .level{font-size:20px;font-weight:900;font-variant-numeric:tabular-nums;color:#fbbf24}.card-tile,.equip-card{cursor:pointer;transition:transform .12s,box-shadow .12s}.card-tile:hover,.equip-card:hover{transform:translateY(-2px);box-shadow:0 14px 36px rgba(0,0,0,.4)}.modal-bg{position:fixed;inset:0;background:rgba(0,0,0,.65);display:none;align-items:center;justify-content:center;z-index:50;backdrop-filter:blur(4px);padding:16px}.modal-bg.active{display:flex}.modal{width:min(480px,100%);max-height:90vh;overflow-y:auto;background:#0f172a;border:1px solid rgba(148,163,184,.25);border-radius:18px;padding:22px;box-shadow:0 30px 80px rgba(0,0,0,.6)}.modal.wide{width:min(640px,100%)}.modal h3{margin:0 0 6px;font-size:18px;color:#f8fafc}.modal .sub{color:#94a3b8;font-size:13px;margin-bottom:14px}.modal .stat-line{padding:8px 12px;background:rgba(2,6,23,.6);border:1px solid rgba(148,163,184,.12);border-radius:10px;margin:6px 0;font-size:14px}.modal .close{margin-top:14px;width:100%}.modal .row{display:flex;gap:8px;margin-top:12px;flex-wrap:wrap}.modal .row>*{flex:1}.modal label{display:block;font-size:13px;color:#94a3b8;margin:10px 0 6px;font-weight:700}.modal input,.modal select{width:100%;padding:10px 12px;border-radius:10px;border:1px solid #334155;background:#0b1220;color:#e5e7eb;font-size:14px;font-weight:600;font-family:inherit}.modal input:focus,.modal select:focus{outline:none;border-color:#5865f2}.seg{display:flex;gap:6px;background:rgba(2,6,23,.6);padding:4px;border-radius:12px;flex-wrap:wrap}.seg button{flex:1 0 auto;background:transparent;font-size:13px;padding:8px 12px;white-space:nowrap}.seg button.on{background:#5865f2}.pick-list{max-height:280px;overflow-y:auto;display:grid;gap:6px;margin-top:8px;padding:4px;background:rgba(2,6,23,.4);border-radius:10px}.pick-row{display:flex;justify-content:space-between;gap:10px;align-items:center;padding:10px 12px;background:rgba(15,23,42,.7);border:1px solid transparent;border-radius:10px;cursor:pointer;font-size:13px}.pick-row:hover{border-color:#5865f2}.pick-row.on{border-color:#5865f2;background:rgba(88,101,242,.18)}.pick-row .meta{color:#94a3b8;font-size:12px;margin-top:2px}.danger{background:#dc2626}.danger:hover{background:#b91c1c}
.auction-bar{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:14px}.auction-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px}.auc-card{position:relative;display:flex;flex-direction:column;gap:8px;padding:14px;background:rgba(2,6,23,.62);border:1px solid rgba(148,163,184,.16);border-radius:14px;cursor:pointer;transition:transform .12s,box-shadow .12s,border-color .12s}.auc-card:hover{transform:translateY(-2px);box-shadow:0 14px 36px rgba(0,0,0,.4);border-color:#5865f2}.auc-card.mine{border-color:#fbbf24}.auc-thumb{aspect-ratio:3/4;display:grid;place-items:center;background:rgba(15,23,42,.7);border-radius:10px;font-size:64px;overflow:hidden}.auc-thumb img{width:100%;height:100%;object-fit:contain}.auc-thumb.card{background:transparent}.auc-name{font-weight:800;font-size:15px;color:#f8fafc;line-height:1.3;word-break:break-word}.auc-sub{font-size:12px;color:#94a3b8}.auc-price{display:flex;justify-content:space-between;align-items:center;font-weight:800;font-size:15px;color:#fbbf24}.auc-seller{font-size:11px;color:#64748b}.auc-mine-badge{position:absolute;top:8px;right:8px;background:#fbbf24;color:#0f172a;font-size:11px;font-weight:800;padding:3px 7px;border-radius:999px}.tag{display:inline-block;padding:3px 8px;border-radius:999px;background:#263244;color:#cbd5e1;font-size:12px;font-weight:700}.tag.rarity{color:#fff;background:var(--rar,#334155)}.tag.on{background:#14532d;color:#bbf7d0}.empty,.loading{padding:24px;text-align:center;color:#94a3b8}.err{color:#f87171}.section-row{display:grid;grid-template-columns:1fr 1fr;gap:18px}
@media(max-width:860px){.profile-hero,.section-row{grid-template-columns:1fr}header{padding:14px 16px;align-items:flex-start}.top-left{display:grid;gap:10px}.grid{grid-template-columns:1fr}}
</style></head><body>
<header><div class="top-left"><h1>RPGenius</h1><nav class="nav"><button class="nav-btn active" data-page="info">정보</button><button class="nav-btn" data-page="inventory">인벤토리</button><button class="nav-btn" data-page="auction">경매장</button></nav></div><div class="bar"><span class="who" id="who">${escapeHtml(sess.name)}</span><button id="adminLink" class="primary" style="display:none">관리자</button><button id="logout">로그아웃</button></div></header>
<main id="app">
  <div class="page active" data-page="info">
    <section class="panel"><div class="profile-hero"><div id="mainCard" class="profile-card"></div><div class="profile-summary"><div class="name-line"><span id="level">-</span> <span id="profileName">-</span> <span id="exp" style="color:#94a3b8;font-size:15px">-</span></div><div class="status-row"><span>HP</span><div class="meter hp"><div class="meter-fill" id="hpFill"></div></div><b id="hp">-</b></div><div class="status-row"><span>MP</span><div class="meter mp"><div class="meter-fill" id="mpFill"></div></div><b id="mp">-</b></div><div class="power-line">⚔️ <b id="totalPower">-</b></div></div></div></section>
    <section class="panel"><h2>장착 중인 카드 슬롯</h2><div id="slotCards" class="cards"></div></section>
    <section class="panel"><h2>재화</h2><div id="goods" class="grid"></div></section>
    <section class="panel"><h2>스탯</h2><div id="stats" class="grid"></div></section>
    <section class="panel"><h2>장착 장비</h2><div id="equippedGear" class="equip-grid"></div></section>
  </div>
  <div class="page" data-page="inventory">
    <section class="panel"><div class="bar" style="justify-content:space-between;margin-bottom:14px"><h2 id="viewerTitle" style="margin:0">인벤토리</h2><div class="actions"><button class="view-btn" data-kind="items">인벤토리</button><button class="view-btn" data-kind="cards">보유 캐릭터 카드</button><button class="view-btn" data-kind="equipment">보유 장비</button></div></div><div id="viewer" class="viewer"></div></section>
  </div>
  <div class="page" data-page="auction"><section class="panel"><div class="auction-bar"><h2 style="margin:0">경매장</h2><div class="actions"><div class="seg" id="aucFilter"><button data-filter="all" class="on">전체</button><button data-filter="card">카드</button><button data-filter="equipment">장비</button><button data-filter="item">아이템</button><button data-filter="mine">내 경매</button></div><button class="primary" id="aucNew">+ 등록</button></div></div><div id="auctionList" class="auction-grid"></div></section></div>
</main>
<div id="modalBg" class="modal-bg"><div class="modal"><h3 id="modalTitle">-</h3><div class="sub" id="modalSub"></div><div id="modalBody"></div><button class="primary close" id="modalClose">닫기</button></div></div>
<div id="aucDetailBg" class="modal-bg"><div class="modal" id="aucDetail"></div></div>
<div id="aucRegBg" class="modal-bg"><div class="modal wide" id="aucReg"></div></div>
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

module.exports = keepAlive;
