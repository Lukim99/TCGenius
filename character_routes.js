'use strict';

const crypto = require('node:crypto');
const { SHARED_FIELDS } = require('./character_accounts');
const pointUsage = require('./point_usage');
// 일반 표지에 인쇄된 소개만 옮긴 읽기 전용 문구. 운영 카드/스킬 데이터와 분리한다.
const introductions = require('./DB/RPGenius/CharacterIntroductions.json');

function registerCharacterRoutes(server, deps) {
    const { rpg, partyquest, requireAccount, setCharacterSession, cards, skills, sprite, cardIcon, cardCover, cardImage, itemIcon, inventoryEquipment } = deps;
    const store = () => rpg.getCharacterStore();
    const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
    const itemId = name => rpg.getDataCache('Item', []).findIndex(item => item?.name === name);
    const ticketName = kind => kind === 'card' ? '카드 전송기' : '장비 전송기';
    const count = (user, name) => rpg.getInventoryItemCount(user, itemId(name));
    const itemToken = (user, kind, index) => crypto.createHash('sha256').update(JSON.stringify([user.id, kind, index, user.inventory[kind]?.[index]])).digest('hex');
    const names = new Map();

    function assertIdle(user, allowDispatch = false) {
        const reason = rpg.getWebGameActionBlock(allowDispatch ? { ...user, dispatch: null } : user, true);
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
            imageUrl: sprite(display), renameTickets: count(user, '닉네임 변경권'), expandTickets: count(user, '캐릭터 슬롯 확장권'),
            dispatch: user.dispatch ? { status: user.dispatch.status, endsAt: user.dispatch.endsAt, destination: user.dispatch.destination } : null,
            needsStarter: !!user.need_character_card_select, isActive: user.id === account.activeCharacterId };
    }

    function starterPreview(data, id, type, skillData) {
        const card = { id, type, star: 4 };
        const skillGroups = [{ ids: data.skills || [], label: '기본 스킬' }];
        if (type !== '일반') skillGroups.push({ ids: data.class?.skills || [], label: '궁극기' });
        return {
            skills: skillGroups.flatMap(group => group.ids.map(skillId => {
                const skill = skillData[skillId];
                return skill ? { name: skill.name, kind: group.label,
                    description: rpg.cardAwakening.formatSkillDescription(card, skill, rpg.formatCurrentSkillDesc(skill, card.star)),
                    cost: Number(skill.mental_cost ?? skill.mp_cost ?? 0), resource: skill.mental_cost != null ? '정신력' : 'MP',
                    cooldown: rpg.formatCooltime(skill.cooltime) } : null;
            }).filter(Boolean)),
            passive: type === '각성' ? rpg.cardAwakening.formatPassive(card) : '',
            effects: rpg.getCardSlotEffectDefinitions(card).map(effect => {
                const value = rpg.getSlotEffectValueAtStar(effect, card.star);
                return { name: effect.name, value: effect.type === 'flat' ? String(value)
                    : effect.type === 'seconds' ? value + '초' : Math.round(value * 1000) / 10 + '%' };
            })
        };
    }

    server.get('/api/characters', requireAccount, async (req, res, next) => {
        try {
            const user = req.accountUser, account = store().accountFor(user);
            const members = await Promise.all(account.characterIds.map(id => member(account, id)));
            const skillData = skills();
            res.json({ accountName: account.name, activeId: account.activeCharacterId, capacity: account.capacity,
                slotCost: 800, renameCost: 300, renameTickets: count(user, '닉네임 변경권'),
                itemIcons: Object.fromEntries(['닉네임 변경권', '캐릭터 슬롯 확장권'].map(name => [name, itemIcon({ name, type: '티켓' })])),
                wallet: { gold: user.gold, garnet: user.garnet, point: user.point }, goldCap: rpg.getAccountGoldState(user),
                characters: members.map(character => summary(character, account)),
                starters: cards().map((card, id) => {
                    if (!card?.name) return null;
                    const previews = Object.fromEntries(['일반', '전직', '각성'].map(type => [type, starterPreview(card, id, type, skillData)]));
                    return {
                        id, name: card.name, star: 5, imageUrl: sprite(card),
                        iconUrl: cardIcon({ id, star: 4, type: '일반' }, null, card)?.concat('&portrait=1') || null,
                        coverUrl: cardCover(card),
                        covers: Object.fromEntries(['일반', '전직', '각성'].map(type => [type, cardCover(card, type)])),
                        description: introductions[card.name] || '',
                        skills: previews['일반'].skills, effects: previews['일반'].effects, previews
                    };
                }).filter(Boolean),
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
        user.raidRewardProgress = {};
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
        assertIdle(current, true);
        assertIdle(target, true);
        await rpg.stopFishingForCommand(current);
        await store().commit([current], { keys: [], accountChange: { id: account.id,
            changes: { activeCharacterId: target.id, selectionRevision: account.selectionRevision + 1 },
            before: { activeCharacterId: account.activeCharacterId, selectionRevision: account.selectionRevision } }, extras: [receipt(result)] });
        setCharacterSession(res, target);
        res.json(result);
    });

    action('expand', async ({ req, res, current, account, receipt }) => {
        const owner = req.body.sourceId ? await member(account, req.body.sourceId) : current;
        const ticket = itemId('캐릭터 슬롯 확장권');
        const payment = count(owner, '캐릭터 슬롯 확장권') > 0 ? 'ticket' : 'point';
        if (req.body.payment !== payment) fail('확장권 보유 수량과 사용 비용이 바뀌었습니다. 창을 다시 열어 확인해주세요.', 409);
        if (payment === 'ticket') rpg.removeInventoryItem(owner, ticket, 1);
        else {
            if (Number(current.point || 0) < 800) fail('포인트가 부족합니다.');
            current.point -= 800;
            rpg.addPointSpendMileage(current, 800);
            pointUsage.record(current, { amount: 800, category: 'character', action: 'expand', productName: '캐릭터 슬롯 확장' });
        }
        const result = { ok: true, capacity: account.capacity + 1 };
        await store().commit([payment === 'ticket' ? owner : current], { accountChange: { id: account.id, changes: { capacity: account.capacity + 1 },
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
            res.json({ cards: (user.inventory.card || []).map((card, index) => ({ index, token: itemToken(user, 'card', index), name: rpg.formatUserCard(card), imageUrl: cardImage(card, user), locked: !!card.locked,
                details: card.skin || card.statSkin || card.avatarId || card.statAvatarId ? ['아바타 장착은 이전되지 않습니다.'] : [] })).filter(card => !card.locked),
                equipment: inventoryEquipment(user).filter(entry => entry.source === 'inventory' && entry.baseRarity === '초월' && !entry.locked)
                    .map(entry => ({ index: entry.index, token: itemToken(user, 'equipment', entry.index), name: entry.baseName,
                        displayName: entry.name, imageUrl: entry.iconUrl, detail: entry, details: [] })),
                ticketIcons: Object.fromEntries(['card', 'equipment'].map(kind => [kind, itemIcon({ name: ticketName(kind), type: '티켓' })])),
                tickets: { card: count(user, ticketName('card')), equipment: count(user, ticketName('equipment')) } });
        } catch (error) { res.status(error.status || 500).json({ error: error.message }); }
    });

    server.get('/api/characters/links', requireAccount, async (req, res) => {
        const user = req.accountUser, account = store().accountFor(user);
        const members = store().members(user).filter(member => member.id !== user.id);
        const portrait = member => sprite({ ...cards()[member.main_card?.id], ...member.main_card });
        const mainEffects = rpg.calculateCardSlotEffects({ main_card: user.main_card });
        function details(member, isMain = false) {
            const card = member.main_card, star = Math.max(isMain ? 4 : 0, Number(card?.star || 0));
            const combined = isMain ? mainEffects : rpg.calculateCardSlotEffects({ main_card: user.main_card, card_slot: card ? [card] : [] });
            const effects = rpg.getCardSlotEffectDefinitions(card).map(effect => {
                const value = rpg.getSlotEffectValueAtStar(effect, star);
                const key = { skillDamageReduction: 'skillDamageBonus', basicDamageReduction: 'basicDamageBonus' }[effect.effect] || effect.effect;
                const active = !!value && Math.abs(Number(combined[key] || 0) - (isMain ? 0 : Number(mainEffects[key] || 0))) > 1e-9;
                const name = value < 0 ? effect.name.replace(/증가$/, '감소') + (/감소$|증가$/.test(effect.name) ? '' : ' 감소') : effect.name;
                const amount = effect.type === 'seconds' ? Math.abs(value) + '초' : effect.type === 'flat' ? Math.abs(value).toLocaleString('ko-KR') : Math.round(Math.abs(value) * 1000) / 10 + '%';
                return { name, value: (value >= 0 ? '+' : '') + amount, active,
                    negative: value < 0 || ['skillDamageReduction', 'basicDamageReduction', 'takenDamageIncrease'].includes(effect.effect),
                    condition: !active ? star < 4 ? '5성부터 적용' : value ? '메인 조건 미충족' : '' : '' };
            });
            if (!isMain) effects.push({ name: '등급 공격력', value: '+' + Math.round(rpg.getCardSlotGradeBonus(card) * 100) + '%', active: star >= 4, grade: true });
            return { id: member.id, name: member.name, level: member.level, cardLabel: rpg.formatUserCard(card), imageUrl: portrait(member), effects };
        }
        const candidates = members.map(member => details(member));
        res.json({ characterId: user.id, character: details(user, true), slots: rpg.getCharacterSlots(user).map(slot => {
            const assigned = candidates.find(member => member.id === slot.id);
            return { index: slot.index, name: assigned?.cardLabel || '빈 슬롯', memberName: assigned?.name || '',
                level: assigned?.level || 0, imageUrl: assigned?.imageUrl || null, effects: assigned?.effects || [],
                error: slot.error, linkedId: slot.id,
                candidates: candidates.map(member => {
                    const links = Array.from({ length: 5 }, (_, index) => index === slot.index ? member.id : user.slotCharacterLinks?.[index] || null);
                    const error = rpg.getCharacterSlots(user, links).find(entry => entry.error)?.error || null;
                    return { ...member, error };
                }) };
        }), levelSum: rpg.getLinkedCharacterLevelSum(user), accountName: account.name });
    });

    action('link', async ({ req, res, current, account, receipt }) => {
        assertIdle(current);
        if (req.body.characterId !== current.id) fail('현재 플레이 중인 캐릭터가 변경되었습니다.', 409);
        const index = Number(req.body.index), id = req.body.linkedId;
        if (!Number.isInteger(index) || index < 0 || index >= 5) fail('1~5번 슬롯을 선택해주세요.');
        if (id != null && typeof id !== 'string') fail('슬롯에 지정할 부캐를 선택해주세요.');
        if (id) await member(account, id);
        const links = Array.from({ length: 5 }, (_, slot) => slot === index ? id || null : current.slotCharacterLinks?.[slot] || null);
        const error = id && rpg.getCharacterSlots(current, links).find(slot => slot.error)?.error;
        if (error) fail(error);
        current.slotCharacterLinks = links;
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
