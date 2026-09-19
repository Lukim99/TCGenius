'use strict';

const crypto = require('crypto');

// 번호가 이동하거나 장착/잠금 상태가 바뀐 뒤에는 이전 화면의 대상을 처리하지 않는다.
function inventoryVersion(user, kind) {
    const inv = user.inventory || {};
    const value = kind === 'cards' ? inv.card : kind === 'items' ? inv.item
        : kind === 'equipment' ? [inv.equipment, user.equipments]
        : [inv.pet, user.equipments && user.equipments.pet];
    return crypto.createHash('sha256').update(JSON.stringify([user.id, kind, value])).digest('hex');
}

// 웹 결과는 계정의 실제 변경 데이터로 구성한다. 명령어 응답 문자열을 변환하지 않는다.
function createGamePresentation({ inventories, card, itemAssets, rpg }) {
    const currencies = { gold: '골드', garnet: '가넷', point: '포인트', mileage: '마일리지' };
    function snapshot(user) {
        user = JSON.parse(JSON.stringify(user));
        const entries = [];
        Object.entries(inventories).forEach(([kind, build]) => build(user).forEach(entry => {
            const key = JSON.stringify([kind, entry.id, entry.type, entry.star, entry.level, entry.skin,
                entry.potentialDisplay, entry.specter, entry.orb, entry.soul, entry.expireAt, entry.statLines]);
            entries.push({ key, kind, name: entry.name, detail: (entry.starText || entry.rarity || entry.typeLabel || '') + (entry.level > 0 ? ' · +' + entry.level : ''),
                iconUrl: entry.imageUrl || entry.iconUrl, frameUrl: entry.frameUrl, count: kind === 'items' ? entry.count : 1 });
        }));
        for (const [key, name] of Object.entries(currencies)) entries.push({ key, kind: 'currency', name, count: Number(user[key] || 0) });
        (user.avatars || []).forEach(avatar => entries.push({ key: 'avatar:' + avatar.name, kind: '아바타', name: avatar.name, count: 1 }));
        (user.titles || []).forEach(id => { const title = rpg.getTitleById(id); entries.push({ key: 'title:' + id, kind: '칭호', name: title?.name || '칭호', count: 1 }); });
        return { entries, level: Number(user.level || 1), hp: Number(user.hp || 0), mp: Number(user.mp || 0),
            exp: Number(user.exp || 0), mainCard: user.main_card && card(user.main_card, user),
            effects: JSON.stringify([user.blessings, user.expPotion, user.goldPotion, user.stat]) };
    }
    function changes(before, user) {
        const after = snapshot(user);
        const previous = new Map();
        before.entries.forEach(entry => previous.set(entry.key, (previous.get(entry.key) || 0) + entry.count));
        const current = new Map();
        after.entries.forEach(entry => {
            const found = current.get(entry.key);
            current.set(entry.key, { ...entry, count: (found?.count || 0) + entry.count });
        });
        const rewards = [...current.values()].map(entry => ({ ...entry, count: entry.count - (previous.get(entry.key) || 0) })).filter(entry => entry.count > 0);
        const stats = ['level', 'hp', 'mp', 'exp'].filter(key => after[key] !== before[key] && !(key === 'exp' && before.level !== after.level))
            .map(key => ({ label: { level: '레벨', hp: 'HP', mp: 'MP', exp: '경험치' }[key], before: before[key], after: after[key] }));
        const mainChanged = JSON.stringify(before.mainCard) !== JSON.stringify(after.mainCard);
        return { rewards, stats, mainCard: mainChanged ? after.mainCard : null, effectsChanged: before.effects !== after.effects };
    }
    function itemReward(name, min, max = min) {
        const item = rpg.getDataCache('Item', []).find(item => item && item.name === name);
        return { kind: 'items', name, min, max, ...itemAssets(item) };
    }
    return { snapshot, changes, itemReward };
}

function registerGameActionRoutes(server, deps) {
    const { rpg, requireUser, serializeItemUse, getPartyBlock, buildProfile, buildCards, getStarterCards, itemAssets, inventories, presentation } = deps;
    const fail = (message, status = 400) => { throw Object.assign(new Error(String(message).replace(/^❌\s*/, '')), { status }); };
    const checked = message => { if (String(message).startsWith('❌')) fail(message); return message; };
    const assertVersion = (user, kind, version) => {
        if (!version || version !== inventoryVersion(user, kind)) fail('보유 목록이 변경되었습니다. 목록을 새로 열고 다시 선택해주세요.', 409);
    };
    function fishingState(user) {
        const items = rpg.getDataCache('Item', []);
        const count = rpg.getFishingNetCount(user);
        return {
            active: !!user.fishing, count, capacity: rpg.getEffectiveFishingNetLimit(user),
            bait: rpg.getCurrentBaitName(user), baitCount: rpg.getInventoryItemCount(user, rpg.getCurrentBaitItemId(user)),
            baits: (user.inventory.item || []).filter(e => items[e.id] && items[e.id].type === '미끼' && e.count > 0)
                .map(e => ({ name: items[e.id].name, count: e.count })),
            items: Object.entries(user.fishingNet || {}).filter(([, count]) => count > 0).map(([id, count]) => ({
                name: items[id] ? items[id].name : '알 수 없는 아이템', count,
                ...itemAssets(items[id])
            }))
        };
    }
    function state(user) {
        return {
            needsStarter: !!user.need_character_card_select,
            attended: user.lastAttendanceDate === rpg.getKoreanDateKey(new Date()),
            canPartyQuest: rpg.canUsePartyQuest(user),
            fishing: fishingState(user)
        };
    }
    function route(method, path, handler, options = {}) {
        const handle = async (req, res) => {
            try {
                const seed = await rpg.getRPGUserByName(req.session.name);
                if (!seed) fail('유저를 찾을 수 없습니다.', 404);
                const payload = await rpg.enqueueFieldAction(seed, async () => {
                    const user = await rpg.getRPGUserByName(req.session.name);
                    if (!user) fail('유저를 찾을 수 없습니다.', 404);
                    if (!options.read) {
                        const block = rpg.getWebGameActionBlock(user, options.starter) || getPartyBlock(user);
                        if (block) fail(block, 409);
                    }
                    const before = !options.read && !options.preview ? presentation.snapshot(user) : null;
                    const result = await handler(user, req.body || {}, req);
                    if (!options.read && !options.preview) {
                        await user.save();
                        return { ok: true, ...result, changes: presentation.changes(before, user), state: state(user), profile: buildProfile(user) };
                    }
                    return result;
                });
                res.json(payload);
            } catch (error) {
                if (!error.status) console.error('[web game action]', error);
                res.status(error.status || 500).json({ error: error.status ? error.message : '처리 중 오류가 발생했습니다. 상태를 확인하고 다시 시도해주세요.' });
            }
        };
        server[method](path, requireUser, method === 'post' ? serializeItemUse(handle) : handle);
    }

    route('get', '/api/game/state', user => state(user), { read: true });
    route('get', '/api/game/starter-cards', user => ({ needsStarter: !!user.need_character_card_select, cards: getStarterCards(user) }), { read: true });
    route('post', '/api/game/starter-card', (user, body) => { checked(rpg.selectStarterCard(user, String(body.name || ''))); return { action: 'starter' }; }, { starter: true });
    route('post', '/api/game/attendance', async user => {
        await rpg.stopFishingForCommand(user);
        checked(rpg.checkAttendance(user));
        return { action: 'attendance' };
    });
    route('post', '/api/game/coupon', async (user, body) => {
        const code = String(body.code || '').trim();
        if (!code || code.length > 200) fail('쿠폰 코드를 입력해주세요.');
        await rpg.stopFishingForCommand(user);
        checked(await rpg.useCoupon(user, code));
        return { action: 'coupon' };
    });
    route('get', '/api/fishing', user => fishingState(user), { read: true });
    route('post', '/api/fishing/start', async user => { if (!user.fishing) checked(await rpg.toggleFishing(user)); return { action: 'fishing-start' }; });
    route('post', '/api/fishing/stop', async user => {
        await rpg.stopFishingForCommand(user);
        return { action: 'fishing-stop' };
    });
    route('post', '/api/fishing/collect', async user => { checked(await rpg.clearFishingNet(user)); return { action: 'fishing-collect' }; });
    route('post', '/api/fishing/bait', async (user, body) => {
        const item = rpg.getDataCache('Item', []).find(item => item && item.name === body.name && item.type === '미끼');
        if (!item || rpg.getInventoryItemCount(user, rpg.getDataCache('Item', []).indexOf(item)) < 1) fail('보유한 미끼를 선택해주세요.');
        await rpg.stopFishingForCommand(user);
        checked(await rpg.useItem(user, item.name, 1));
        return { action: 'fishing-bait' };
    });
    route('post', '/api/combine/auto-select', (user, body) => {
        const selected = rpg.getRandomCardCombineNumbers(user, body.star);
        if (selected.error) fail(selected.error);
        return { cards: buildCards(user), numbers: selected.numbers };
    }, { read: true });

    const kinds = { 'cards-sell': 'cards', 'items-sell': 'items', 'equipment-disassemble': 'equipment', 'pets-extract': 'pet' };
    function preview(user, body) {
        if (!Object.prototype.hasOwnProperty.call(kinds, body.action)) fail('지원하지 않는 작업입니다.');
        const kind = kinds[body.action];
        assertVersion(user, kind, body.version);
        const copy = JSON.parse(JSON.stringify(user));
        const numbers = Array.isArray(body.numbers) ? body.numbers.map(Number) : [];
        if (kind !== 'items' && (!numbers.length || numbers.some(n => !Number.isSafeInteger(n) || n < 1) || new Set(numbers).size !== numbers.length)) fail('처리할 대상을 선택해주세요.');
        let rewards = [];
        if (body.action === 'cards-sell') {
            const selection = rpg.getCardSaleSelection(user, numbers);
            if (selection.error) fail(selection.error);
            rewards = [{ kind: 'currency', name: '골드', min: selection.gold, max: selection.gold }];
        }
        if (body.action === 'equipment-disassemble') {
            const selection = rpg.getDisassemblePreviewData(user, numbers);
            if (selection.error) fail(selection.error);
            rewards = selection.rewards.map(reward => presentation.itemReward(reward.name, reward.min, reward.max));
        }
        if (body.action === 'pets-extract') {
            checked(rpg.extractPetsByNumbers(copy, numbers));
            rewards = presentation.changes(presentation.snapshot(user), copy).rewards.map(entry => ({ ...entry, min: entry.count, max: entry.count }));
        }
        if (body.action === 'items-sell') {
            if (!Number.isSafeInteger(body.count) || body.count < 1) fail('수량은 1 이상의 정수여야 합니다.');
            const item = rpg.getDataCache('Item', [])[body.id];
            if (!Number.isInteger(body.id) || !item) fail('아이템을 찾을 수 없습니다.');
            checked(rpg.sellItemByName(copy, [item.name, String(body.count)]));
            rewards = [{ kind: 'currency', name: '골드', min: Number(item.sellPrice) * body.count, max: Number(item.sellPrice) * body.count }];
        }
        const targets = inventories[kind](user).filter(entry => kind === 'items' ? entry.id === body.id : numbers.includes(entry.number))
            .map(entry => ({ name: entry.name, detail: entry.starText || entry.rarity || entry.typeLabel || '',
                iconUrl: entry.imageUrl || entry.iconUrl, frameUrl: entry.frameUrl, count: kind === 'items' ? body.count : 1 }));
        const token = crypto.createHash('sha256').update(JSON.stringify([body.action, body.version, numbers, body.id, body.count, targets, rewards])).digest('hex');
        return { token, action: body.action, targets, rewards };
    }
    route('post', '/api/inventory/actions/preview', (user, body) => preview(user, body), { preview: true });
    route('post', '/api/inventory/actions/confirm', async (user, body) => {
        const current = preview(user, body);
        if (body.token !== current.token) fail('대상 또는 보상이 변경되었습니다. 다시 확인해주세요.', 409);
        await rpg.stopFishingForCommand(user);
        let message;
        if (body.action === 'cards-sell') {
            user.pendingAction = { type: '카드판매', numbers: body.numbers };
            message = rpg.runCardSale(user);
        } else if (body.action === 'equipment-disassemble') {
            user.pendingAction = { type: '장비분해', numbers: body.numbers };
            message = rpg.runDisassemble(user);
        } else if (body.action === 'pets-extract') message = rpg.extractPetsByNumbers(user, body.numbers);
        else message = rpg.sellItemByName(user, [rpg.getDataCache('Item', [])[body.id].name, String(body.count)]);
        checked(message);
        return { action: body.action, targets: current.targets };
    });
    route('post', '/api/inventory/equipment/lock', async (user, body) => {
        assertVersion(user, 'equipment', body.version);
        await rpg.stopFishingForCommand(user);
        checked(rpg.toggleEquipmentLock(user, body.number));
        const target = inventories.equipment(user).find(entry => entry.number === Number(body.number));
        return { action: target.locked ? 'equipment-locked' : 'equipment-unlocked', target };
    });
    route('post', '/api/inventory/pet/equip', async (user, body) => {
        assertVersion(user, 'pet', body.version);
        await rpg.stopFishingForCommand(user);
        checked(rpg.equipPetByNumber(user, body.number));
        rpg.refreshPetShortcuts(user);
        return { action: 'pet-equipped' };
    });
    route('post', '/api/inventory/pet/unequip', async (user, body) => {
        assertVersion(user, 'pet', body.version);
        await rpg.stopFishingForCommand(user);
        checked(rpg.unequipPetByNumber(user, body.number));
        rpg.refreshPetShortcuts(user);
        return { action: 'pet-unequipped' };
    });
}

module.exports = { inventoryVersion, registerGameActionRoutes, createGamePresentation };
