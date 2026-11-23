'use strict';

const crypto = require('node:crypto');
const { SHARED_FIELDS } = require('./character_accounts');
const pointUsage = require('./point_usage');

function registerCharacterRoutes(server, deps) {
    const { rpg, partyquest, requireAccount, setCharacterSession, cards, sprite, cardImage, equipmentImage } = deps;
    const store = () => rpg.getCharacterStore();
    const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
    const itemId = name => rpg.getDataCache('Item', []).findIndex(item => item?.name === name);
    const ticketName = kind => kind === 'card' ? '카드 전송기' : '장비 전송기';
    const count = (user, name) => rpg.getInventoryItemCount(user, itemId(name));
    const itemToken = (user, kind, index) => crypto.createHash('sha256').update(JSON.stringify([user.id, kind, index, user.inventory[kind]?.[index]])).digest('hex');
    const names = new Map();

    function assertIdle(user) {
        const reason = rpg.getWebGameActionBlock(user, true);
        if (reason) fail(reason, 409);
        if (user.paradise?.status === 'active' || partyquest.getRoomOf(user.name)
            || user.pvp?.battle && user.pvp.battle.phase !== 'ended') fail('진행 중인 전투나 탐험을 먼저 마쳐주세요.', 409);
        if (rpg.getDirectTradeState(user.name).status !== 'idle') fail('거래 요청을 완료하거나 취소한 뒤 이용해주세요.', 409);
    }

    async function member(account, id) {
        if (!account.characterIds.includes(id)) fail('내 계정의 캐릭터를 선택해주세요.', 403);
        const user = await rpg.getUserByPrimaryId(id);
        if (!user || user.accountId !== account.id) fail('캐릭터 정보를 찾을 수 없습니다.', 404);
        return user;
    }

    async function validateName(value) {
        const name = String(value || '').trim();
        if (!name || name.length > 10 || /[^가-힣ㄱ-ㅎa-zA-Z0-9\s]/.test(name)) fail('이름은 한글, 영어, 숫자, 공백으로 1~10글자까지 입력해주세요.');
        if (await rpg.isCharacterNameTaken(name)) fail('이미 사용 중인 이름입니다.');
        return name;
    }

    function reserveName(name, id) {
        return { Put: { TableName: 'rpgenius_sid', Item: { senderId: 'character-name:' + name, characterId: id },
            ConditionExpression: 'attribute_not_exists(senderId)' } };
    }

    async function withName(value, task) {
        const key = String(value || '').trim(), previous = names.get(key);
        const job = Promise.resolve(previous).catch(() => {}).then(task);
        names.set(key, job);
        try { return await job; } finally { if (names.get(key) === job) names.delete(key); }
    }

    function starter(user, cardId) {
        const id = Number(cardId), data = Number.isInteger(id) && cards()[id];
        if (!data?.name) fail('시작 캐릭터를 선택해주세요.');
        const result = rpg.selectStarterCard(user, data.name);
        if (result.startsWith('❌')) fail(result.slice(2).trim());
    }

    function summary(user, account) {
        const data = cards()[user.main_card?.id];
        const display = data ? { ...data, ...user.main_card } : null;
        return { id: user.id, name: user.name, level: Number(user.level || 1), characterName: data?.name || '',
            type: user.main_card?.type || '일반', power: rpg.calculateTownCombatPower(user).total,
            cardLabel: data ? rpg.formatUserCard(user.main_card) : '',
            imageUrl: sprite(display), renameTickets: count(user, '닉네임 변경권'),
            needsStarter: !!user.need_character_card_select, isActive: user.id === account.activeCharacterId };
    }

    server.get('/api/characters', requireAccount, async (req, res, next) => {
        try {
            const user = req.accountUser, account = store().accountFor(user);
            const members = await Promise.all(account.characterIds.map(id => member(account, id)));
            res.json({ accountName: account.name, activeId: account.activeCharacterId, capacity: account.capacity,
                slotCost: 800, renameCost: 300, renameTickets: count(user, '닉네임 변경권'),
                wallet: { gold: user.gold, garnet: user.garnet, point: user.point }, goldCap: rpg.getAccountGoldState(user),
                characters: members.map(character => summary(character, account)),
                starters: cards().map((card, id) => card?.name ? { id, name: card.name, imageUrl: sprite(card) } : null).filter(Boolean),
                transferItems: { card: count(user, ticketName('card')), equipment: count(user, ticketName('equipment')) } });
        } catch (error) { next(error); }
    });

    function action(path, task) {
        server.post('/api/characters/' + path, requireAccount, async (req, res) => {
            try {
                const requestId = req.body?.requestId;
                if (typeof requestId !== 'string' || !/^[\w-]{8,100}$/.test(requestId)) fail('요청 번호가 올바르지 않습니다. 새로고침 후 다시 시도해주세요.');
                const fingerprint = crypto.createHash('sha256').update(JSON.stringify([path, req.body])).digest('hex');
                await rpg.enqueueFieldAction(req.accountUser, async () => {
                    const current = await rpg.getUserByPrimaryId(req.accountUser.accountId);
                    const account = store().accountFor(current);
                    const previous = await store().readReceipt(account.id, requestId);
                    if (previous) {
                        if (previous.fingerprint !== fingerprint) fail('같은 요청 번호로 다른 작업을 실행할 수 없습니다.', 409);
                        if (['select', 'rename'].includes(path)) setCharacterSession(res, current);
                        return res.json(previous.result);
                    }
                    const receipt = result => store().receiptOperation(account.id, requestId, fingerprint, result);
                    try { await task({ req, res, current, account, receipt }); }
                    catch (error) {
                        // A transaction receipt resolves retries even after the response was lost.
                        const completed = await store().readReceipt(account.id, requestId);
                        if (completed?.fingerprint === fingerprint) {
                            if (['select', 'rename'].includes(path)) setCharacterSession(res, await rpg.getUserByPrimaryId(account.id));
                            return res.json(completed.result);
                        }
                        throw error;
                    }
                });
            } catch (error) {
                res.status(error.status || 500).json({ error: error.status ? error.message : '처리에 실패했습니다. 새로고침 후 다시 시도해주세요.' });
                if (!error.status) console.error('character ' + path, error);
            }
        });
    }

    action('create', async ({ req, res, current, account, receipt }) => withName(req.body.name, async () => {
        if (account.characterIds.length >= account.capacity) fail('캐릭터 슬롯이 가득 찼습니다.');
        const name = await validateName(req.body.name);
        const user = new rpg.RPGUser(name, 'character:' + crypto.randomUUID());
        for (const key of SHARED_FIELDS) delete user[key];
        user.accountId = account.id;
        user.characterNumber = account.characterIds.length + 1;
        user.boundItems = {};
        starter(user, req.body.cardId);
        const raw = JSON.parse(JSON.stringify(user)), result = { ok: true, id: user.id };
        await store().commit([current], { keys: [], accountChange: { id: account.id,
            changes: { characterIds: [...account.characterIds, user.id] }, before: { characterIds: account.characterIds } },
            extras: [{ Put: { TableName: 'rpgenius_user', Item: raw, ConditionExpression: 'attribute_not_exists(id)' } }, reserveName(name, user.id), receipt(result)] });
        store().remember(raw);
        res.json(result);
    }));

    action('starter', async ({ req, res, account, receipt }) => {
        const user = await member(account, req.body.id);
        assertIdle(user);
        starter(user, req.body.cardId);
        const result = { ok: true, id: user.id };
        await store().commit([user], { extras: [receipt(result)] });
        res.json(result);
    });

    action('select', async ({ req, res, current, account, receipt }) => {
        const target = await member(account, req.body.id);
        if (target.need_character_card_select) fail('시작 캐릭터를 먼저 선택해주세요.');
        const result = { ok: true, id: target.id };
        if (target.id === current.id) {
            // Re-entering the active character resumes its field or fishing session.
            await store().commit([current], { keys: [], extras: [receipt(result)] });
            setCharacterSession(res, current);
            return res.json(result);
        }
        assertIdle(current);
        assertIdle(target);
        await rpg.stopFishingForCommand(current);
        await store().commit([current], { keys: [], accountChange: { id: account.id,
            changes: { activeCharacterId: target.id, selectionRevision: account.selectionRevision + 1 },
            before: { activeCharacterId: account.activeCharacterId, selectionRevision: account.selectionRevision } }, extras: [receipt(result)] });
        setCharacterSession(res, target);
        res.json(result);
    });

    action('expand', async ({ res, current, account, receipt }) => {
        if (Number(current.point || 0) < 800) fail('포인트가 부족합니다.');
        current.point -= 800;
        rpg.addPointSpendMileage(current, 800);
        pointUsage.record(current, { amount: 800, category: 'character', action: 'expand', productName: '캐릭터 슬롯 확장' });
        const result = { ok: true, capacity: account.capacity + 1 };
        await store().commit([current], { accountChange: { id: account.id, changes: { capacity: account.capacity + 1 },
            before: { capacity: account.capacity } }, extras: [receipt(result)] });
        res.json(result);
    });

    action('rename', async ({ req, res, current, account, receipt }) => withName(req.body.name, async () => {
        const user = await member(account, req.body.id);
        assertIdle(user);
        const name = await validateName(req.body.name);
        const ticket = itemId('닉네임 변경권');
        const payment = rpg.getInventoryItemCount(user, ticket) > 0 ? 'ticket' : 'point';
        if (req.body.payment !== payment) fail('변경권 보유 수량과 사용 비용을 다시 확인해주세요. 화면을 새로고침한 뒤 시도해주세요.', 409);
        if (payment === 'point' && Number(user.point || 0) < 300) fail('닉네임 변경권 또는 300포인트가 필요합니다.');
        await rpg.stopFishingForCommand(user);
        if (payment === 'ticket') rpg.removeInventoryItem(user, ticket, 1);
        else {
            user.point -= 300;
            rpg.addPointSpendMileage(user, 300);
            pointUsage.record(user, { amount: 300, category: 'character', action: 'rename', productName: '닉네임 변경권' });
        }
        user.formerNames = [...new Set([...(user.formerNames || []), user.name])];
        user.name = name;
        const result = { ok: true, id: user.id, name };
        await store().commit([user], { extras: [reserveName(name, user.id), receipt(result)] });
        if (user.id === current.id) setCharacterSession(res, user);
        res.json(result);
    }));

    server.get('/api/characters/transferable', requireAccount, async (req, res) => {
        try {
            const account = store().accountFor(req.accountUser), user = await member(account, req.query.sourceId);
            res.json({ cards: (user.inventory.card || []).map((card, index) => ({ index, token: itemToken(user, 'card', index), name: rpg.formatUserCard(card), imageUrl: cardImage(card, user), locked: !!card.locked })).filter(card => !card.locked),
                equipment: (user.inventory.equipment || []).map((equip, index) => ({ equip, index, data: rpg.getEquipmentData(equip.type, equip.id) }))
                    .filter(entry => entry.data?.rarity === '초월' && !entry.equip.locked)
                    .map(({ equip, index, data }) => ({ index, token: itemToken(user, 'equipment', index), name: data.name, imageUrl: equipmentImage(equip.type, equip.id) })),
                tickets: { card: count(user, ticketName('card')), equipment: count(user, ticketName('equipment')) } });
        } catch (error) { res.status(error.status || 500).json({ error: error.message }); }
    });

    server.get('/api/characters/links', requireAccount, async (req, res) => {
        const user = req.accountUser, account = store().accountFor(user);
        const members = store().members(user).filter(member => member.id !== user.id);
        res.json({ characterId: user.id, slots: (user.card_slot || []).map((card, index) => ({
            index, name: rpg.formatUserCard(card), imageUrl: cardImage(card, user), linkedId: user.slotCharacterLinks?.[index] || null,
            candidates: members.filter(member => Number(member.main_card?.id) === Number(card.id))
                .map(member => ({ id: member.id, name: member.name, level: member.level, type: member.main_card?.type || '일반' }))
        })), levelSum: rpg.getLinkedCharacterLevelSum(user), accountName: account.name });
    });

    action('link', async ({ req, res, current, account, receipt }) => {
        assertIdle(current);
        if (req.body.characterId !== current.id) fail('현재 플레이 중인 캐릭터가 변경되었습니다.', 409);
        const index = Number(req.body.index), card = current.card_slot?.[index], id = req.body.linkedId;
        if (!Number.isInteger(index) || index < 0 || !card) fail('연결할 슬롯을 선택해주세요.');
        if (id) {
            const linked = await member(account, id);
            if (linked.id === current.id || Number(linked.main_card?.id) !== Number(card.id)) fail('같은 캐릭터 카드를 사용하는 다른 부캐를 선택해주세요. 타입은 달라도 됩니다.');
        }
        current.slotCharacterLinks = (current.card_slot || []).map((_, slot) => current.slotCharacterLinks?.[slot] || null);
        current.slotCharacterLinks[index] = id || null;
        const result = { ok: true, levelSum: rpg.getLinkedCharacterLevelSum(current) };
        await store().commit([current], { keys: ['slotCharacterLinks'], extras: [receipt(result)] });
        res.json(result);
    });

    action('transfer', async ({ req, res, account, receipt }) => {
        const { sourceId, targetId, kind } = req.body, index = Number(req.body.index);
        if (sourceId === targetId || !['card', 'equipment'].includes(kind) || !Number.isInteger(index) || index < 0) fail('전송할 아이템과 다른 캐릭터를 선택해주세요.');
        const source = await member(account, sourceId), target = await member(account, targetId);
        assertIdle(source); assertIdle(target);
        const entry = source.inventory[kind]?.[index];
        if (!entry || entry.locked) fail('전송할 수 없는 아이템입니다.');
        if (req.body.itemToken !== itemToken(source, kind, index)) fail('보유 아이템이 변경되었습니다. 전송할 아이템을 다시 선택해주세요.', 409);
        if (kind === 'equipment' && rpg.getEquipmentData(entry.type, entry.id)?.rarity !== '초월') fail('장비 전송기는 초월 장비에만 사용할 수 있습니다.');
        if (kind === 'card' && rpg.getRemainingCardInventorySpace(target) < 1) fail('받는 캐릭터의 카드 가방이 가득 찼습니다.');
        const ticket = itemId(ticketName(kind));
        if (ticket < 0 || rpg.getInventoryItemCount(source, ticket) < 1) fail(ticketName(kind) + '가 필요합니다.');
        rpg.removeInventoryItem(source, ticket, 1);
        source.inventory[kind].splice(index, 1);
        const transferred = structuredClone(entry);
        if (kind === 'card') for (const key of ['skin', 'statSkin', 'avatarId', 'statAvatarId']) delete transferred[key];
        if (kind === 'equipment' && transferred.boundOwner) transferred.boundOwner = target.name;
        target.inventory[kind].push(transferred);
        const result = { ok: true };
        await store().commit([source, target], { keys: ['inventory', 'boundItems'], extras: [receipt(result)] });
        res.json(result);
    });
}

module.exports = { registerCharacterRoutes };
