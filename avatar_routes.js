'use strict';

const unique = require('./unique_avatar');
function registerAvatarRoutes(server, deps) {
    const { rpg, requireUser, characters, assets, cardImage, itemImage, uiImage, blocked, profile } = deps;
    const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
    const portrait = name => {
        const fashion = rpg.getFashionData().find(f => f.name === name && unique.isUnique(f));
        return fashion ? uiImage('유니크아바타/전신/' + characters[fashion.primary_card[0]].name + '.png') : null;
    };
    const view = (avatar, characterId) => {
        const display = assets(avatar.name);
        const fashion = rpg.getFashionData().find(f => f.name === avatar.name && f.primary_card?.includes(characterId));
        return { ...avatar, ...display, imageUrl: Number.isInteger(characterId)
            ? cardImage({ id: characterId, star: 6, type: fashion?.type === '전직' ? '전직' : '일반', skin: avatar.name }, {}) : display.imageUrl || display.iconUrl,
            portraitUrl: portrait(avatar.name), remainingTrades: rpg.getAvatarGradeByName(avatar.name) === '유니크' ? Math.max(0, 3 - Number(avatar.trades || 0)) : null };
    };
    function state(user) {
        const avatars = rpg.getUserAvatars(user).filter(entry => rpg.getAvatarGradeByName(entry.name)).map(entry => ({ ...view(entry),
            equipped: [user.main_card, ...(user.card_slot || []), ...(user.inventory?.card || [])].some(card => card?.avatarId === entry.id || card?.statAvatarId === entry.id || (!card?.avatarId && card?.skin === entry.name) || (!card?.statAvatarId && card?.statSkin === entry.name)) }));
        const items = rpg.getDataCache('Item', []);
        return { version: unique.version(user), avatars, attempts: Number(user.avatarSynthesisFailures || 0), guaranteedAt: 15,
            blockedReason: blocked(user), options: unique.OPTIONS.map(({ id, label }) => ({ id, label })),
            characters: characters.map((character, id) => ({ id, name: character.name, imageUrl: cardImage({ id, star: 6, type: '일반', skin: unique.nameFor(character.name) }, user), portraitUrl: portrait(unique.nameFor(character.name)) })).filter(character => rpg.getAvatarGradeByName(unique.nameFor(character.name)) === '유니크'),
            cubes: unique.CUBES.map(cube => { const id = items.findIndex(item => item?.name === cube.name); return { id, name: cube.name, chance: cube.chance,
                count: id < 0 ? 0 : rpg.getInventoryItemCount(user, id), iconUrl: id < 0 ? null : itemImage(items[id]), priceLabel: cube.price + (cube.goods === 'point' ? 'P' : ' 마일리지') }; }),
            lastResult: user.lastAvatarSynthesis ? { ...user.lastAvatarSynthesis.result, avatar: view(user.lastAvatarSynthesis.result.avatar, user.lastAvatarSynthesis.result.characterId) } : null };
    }
    function route(method, url, handler, read = false) {
        server[method](url, requireUser, async (req, res) => {
            res.setHeader('Cache-Control', 'no-store');
            try {
                const seed = await rpg.getRPGUserByName(req.session.name);
                if (!seed) fail('유저를 찾을 수 없습니다.', 404);
                const payload = await rpg.enqueueFieldAction(seed, async () => {
                    const user = await rpg.getRPGUserByName(req.session.name);
                    if (!read && blocked(user)) fail(blocked(user));
                    return handler(user, req.body || {});
                });
                res.json(payload);
            } catch (error) {
                if (!error.status) console.error('[avatar]', error.name);
                res.status(error.status || 409).json({ error: error.status ? error.message : '저장 상태가 변경되었거나 저장에 실패했습니다. 목록을 다시 열어주세요.' });
            }
        });
    }
    route('get', '/api/avatars/synthesis', user => state(user), true);
    route('post', '/api/avatars/synthesis', async (user, body) => {
        rpg.getUserAvatars(user);
        const result = unique.synthesize(user, body, rpg);
        if (result.error) fail(result.error, 409);
        if (!result.replayed) await rpg.commitProtectedUserChange(user, ['avatars', 'inventory', 'main_card', 'card_slot', 'avatarSynthesisFailures', 'lastAvatarSynthesis']);
        return { ok: true, result: { ...result, avatar: view(result.avatar, result.characterId) }, state: state(user), profile: profile(user) };
    });
    route('post', '/api/avatars/option', async (user, body) => {
        const avatar = rpg.getUserAvatars(user).find(entry => entry.id === body.avatarId);
        if (!avatar || rpg.getAvatarGradeByName(avatar.name) !== '유니크') fail('보유한 유니크 아바타를 선택해주세요.');
        if (!unique.OPTIONS.some(entry => entry.id === body.option)) fail('추가 옵션 1개를 선택해주세요.');
        avatar.option = body.option;
        await rpg.commitProtectedUserChange(user, ['avatars']);
        return { ok: true, avatar: view(avatar), profile: profile(user) };
    });
    return { state, portrait };
}
module.exports = { registerAvatarRoutes };
