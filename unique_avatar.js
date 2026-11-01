'use strict';

const crypto = require('crypto');
const OPTIONS = Object.freeze([
    { id: 'finalDamage', label: '최종 피해 +3%', stats: { finalDamage: .03 } },
    { id: 'crit', label: '치명타 확률 +3%', stats: { crit: .03 } },
    { id: 'recovery', label: '회복 및 보호막 효과 +5%', stats: { recoveryEfficiency: .05, shieldEfficiency: .05 } },
    { id: 'defense', label: '받는 피해 감소 +3%', stats: { takenDamage: -.03 } },
    { id: 'drop', label: '아이템 드랍율 +5%', stats: { itemDropChance: .05 } }
]);
const CUBES = Object.freeze([
    { name: '바인드 큐브', chance: .10, goods: 'point', price: 300 },
    { name: '황금 바인드 큐브', chance: .15, goods: 'mileage', price: 300 },
    { name: '마스터 바인드 큐브', chance: .25, goods: 'mileage', price: 600 }
]);
const nameFor = name => '[1차]유니크 ' + name;
const isUnique = fashion => fashion?.uniqueSeries === 1;
const option = id => OPTIONS.find(entry => entry.id === id) || OPTIONS[0];
const version = user => crypto.createHash('sha256').update(JSON.stringify([
    user.id, user.avatars, user.inventory?.item, user.main_card, user.card_slot,
    user.inventory?.card, user.avatarSynthesisFailures || 0
])).digest('hex');
const fail = message => ({ error: message });

// The caller serializes account mutations and commits the entire change atomically.
function synthesize(user, body, rpg, random = Math.random) {
    if (!body.requestId || typeof body.requestId !== 'string' || body.requestId.length > 80) return fail('합성 요청을 다시 열어주세요.');
    if (user.lastAvatarSynthesis?.requestId === body.requestId) return { ...user.lastAvatarSynthesis.result, replayed: true };
    if (body.version !== version(user)) return fail('보유 목록이 변경되었습니다. 합성창을 다시 열어주세요.');
    const ids = body.avatarIds;
    if (!Array.isArray(ids) || ids.length !== 2 || ids.some(id => typeof id !== 'string') || ids[0] === ids[1]) return fail('서로 다른 아바타 2개를 등록해주세요.');
    const materials = ids.map(id => rpg.getUserAvatars(user).find(entry => entry.id === id));
    if (materials.some(entry => !entry || !rpg.getAvatarGradeByName(entry.name))) return fail('보유한 아바타 2개를 선택해주세요.');
    const item = rpg.getDataCache('Item', [])[body.cubeId];
    const cube = CUBES.find(entry => entry.name === item?.name);
    if (!Number.isInteger(body.cubeId) || !cube || rpg.getInventoryItemCount(user, body.cubeId) < 1) return fail('선택한 바인드 큐브가 부족합니다.');
    if (!Number.isInteger(body.characterId)) return fail('원하는 캐릭터를 선택해주세요.');
    const fashions = rpg.getFashionData();
    const unique = fashions.find(f => isUnique(f) && f.primary_card?.includes(body.characterId));
    const general = [...new Map(fashions.filter(f => !f.exclusive && !f.isHigh && !isUnique(f) && f.primary_card?.includes(body.characterId)).map(f => [f.name, f])).values()];
    if (!unique || !general.length) return fail('이 캐릭터의 합성 결과가 아직 등록되지 않았습니다.');
    const failures = Math.max(0, Number(user.avatarSynthesisFailures || 0));
    const guaranteed = failures >= 14;
    const won = guaranteed || random() < cube.chance;
    const resultFashion = won ? unique : general[Math.floor(random() * general.length)];
    materials.forEach(entry => rpg.removeUserAvatar(user, entry.name, entry.id));
    rpg.removeInventoryItem(user, body.cubeId, 1);
    rpg.unlockAvatar(user, resultFashion.name, 0);
    const avatar = user.avatars[user.avatars.length - 1];
    user.avatarSynthesisFailures = won ? 0 : failures + 1;
    const result = { unique: won, guaranteed, characterId: body.characterId, avatar: { ...avatar, grade: won ? '유니크' : '일반', remainingTrades: won ? 3 : null }, attempts: user.avatarSynthesisFailures };
    user.lastAvatarSynthesis = { requestId: body.requestId, result };
    return result;
}

module.exports = { OPTIONS, CUBES, nameFor, isUnique, option, version, synthesize };
