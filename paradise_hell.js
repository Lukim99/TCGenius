const crypto = require('crypto');
const { KEYS } = require('./paradise_hell_content');
const rpg = () => require('./rpgenius');
const corridor = () => require('./paradise');
const pick = (list, random) => list[Math.min(list.length - 1, Math.floor(random() * list.length))];
const recommendedPower = floor => 30000 * (1 + Math.floor(Math.max(1, Math.min(100, floor)) / 10));
const tierOf = floor => Math.min(10, Math.floor(Math.max(1, floor) / 10));
const tierName = tier => tier === 0 ? '최소 단계' : tier === 10 ? '최고 단계' : tier + '단계';

function validateConfig(config) {
    if (!config || typeof config.enabled !== 'boolean' || !Array.isArray(config.rewards) || !config.rewards.length) return '지옥 enabled와 rewards 보상표가 필요합니다.';
    const ids = new Set(), validCounts = values => Array.isArray(values) && values.length === 11 && values.every(v => Number.isSafeInteger(v) && v > 0);
    for (const reward of config.rewards) {
        if (!reward || typeof reward.id !== 'string' || ids.has(reward.id) || !reward.name || !validCounts(reward.counts) || !['orb','item','card'].includes(reward.kind)) return '지옥 보상에는 고유 id, name, kind, 11개 구간의 양의 정수 counts가 필요합니다.';
        ids.add(reward.id);
        if (reward.kind === 'item' && !(typeof reward.item === 'string' && reward.item.trim()) && !(Array.isArray(reward.items) && reward.items.length === 11 && reward.items.every(name => typeof name === 'string' && name.trim()))) return '아이템 보상에는 item 또는 11개 구간의 items 이름이 필요합니다.';
        if (reward.kind === 'card' && (!['일반','전직','각성'].includes(reward.cardType) || !validCounts(reward.stars) || reward.stars.some(star => star > 12))) return '카드 보상에는 cardType과 11개 구간의 표시 등급 stars가 필요합니다.';
    }
    return null;
}
function checkRewardItems(config) {
    const items = rpg().getDataCache('Item', []), names = new Set(['상급 강화석']);
    for (const reward of config.rewards) {
        if (reward.kind === 'item') for (const name of reward.items || [reward.item]) names.add(name);
        if (reward.kind === 'orb' && !items.some(item => item?.use === '보주')) return '등록된 보주가 없습니다.';
    }
    for (const name of names) if (!items.some(item => item?.name === name)) return '지옥 보상 아이템 미등록: ' + name;
    return null;
}
function enter(user, keyName, random = Math.random) {
    if (user.paradise?.status === 'active' || user.field || require('./partyquest').getRoomOf(user.name) || user.pvp?.battle && user.pvp.battle.phase !== 'ended') return { error: '진행 중인 전투나 탐험을 먼저 마쳐주세요.' };
    if (user.paradise?.status === 'ended' && !user.paradise.claimed) return { error: '지난 탐험의 보상을 먼저 수령해주세요.' };
    if (!user.main_card || user.need_character_card_select) return { error: '메인 카드를 먼저 선택해주세요.' };
    if (user.pendingAction || user.pendingFragment || user.fishing === true) return { error: '진행 중인 작업이나 보상 선택을 먼저 완료해주세요.' };
    const config = rpg().getDataCache('Paradise', null)?.hell;
    if (validateConfig(config) || !config.enabled) return { error: '지옥 입장이 아직 열리지 않았습니다.' };
    const rewardError = checkRewardItems(config);
    if (rewardError) return { error: rewardError };
    const key = KEYS.find(key => key.name === keyName), items = rpg().getDataCache('Item', []), id = items.findIndex(item => item?.name === keyName);
    if (!key || id < 0 || rpg().getInventoryItemCount(user, id) < 1) return { error: '보유한 지옥 열쇠를 선택해주세요.' };
    const stats = rpg().calculateUserStats(user);
    rpg().removeInventoryItem(user, id, 1);
    user.hp = stats.hp; user.mp = stats.mp;
    user.paradise = { id: crypto.randomUUID(), revision: 0, mode: 'hell', status: 'active', phase: 'combat', floor: 1, highestFloor: 1, clearedFloor: 0,
        effects: {}, relics: [], temporary: [], equipmentPermanent: {}, history: [], acquired: {}, contracts: [], choices: [], distortion: 0,
        battlesWon: 0, elitesWon: 0, rewardUnits: 0, eliteUnits: 0, startedAt: Date.now(), baseRewards: [], milestoneRewards: [],
        key: key.name, dropsRemaining: key.drops, bonusChests: 0, richChests: 0, rocketJump: false, altarUsed: false, altarResult: null,
        chests: [], opensRemaining: 0, rewardSummary: [], rewardTable: structuredClone(config.rewards) };
    corridor().startCombat(user, 'normal', null, random);
    return { message: key.name + ' 1개를 사용해 지옥에 입장했습니다.' };
}
function enterFloor(user, random) {
    const run = user.paradise;
    run.highestFloor = Math.max(run.highestFloor, run.floor);
    run.altarUsed = false; run.altarResult = null;
    if (run.floor % 11 === 0) {
        rpg().clearFieldRuntimeTimers(user.name);
        run.phase = 'altar'; run.enemy = null;
        user.field.elite = null;
        return;
    }
    const roll = random();
    corridor().startCombat(user, run.floor === 100 || roll >= .90 ? 'boss' : roll >= .60 ? 'elite' : 'normal', null, random);
}
function descend(user, side, random = Math.random) {
    const run = user.paradise;
    if (run?.mode !== 'hell' || run.phase !== 'descent' || run.dropsRemaining <= 0 || !['left','right'].includes(side)) return { error: '현재는 낙하할 수 없습니다.' };
    const min = run.rocketJump ? 16 : 1, distance = min + Math.min(20 - min, Math.floor(random() * (21 - min))), from = run.floor;
    run.floor = Math.min(100, from + distance); run.dropsRemaining--; run.rocketJump = false;
    run.lastDrop = { side, from, to: run.floor, distance: run.floor - from };
    enterFloor(user, random);
    return { message: '지하 ' + run.floor + '층 도착' };
}
function altar(user, random = Math.random) {
    const run = user.paradise;
    if (run?.mode !== 'hell' || run.phase !== 'altar' || run.altarUsed) return { error: '사용할 수 있는 제단이 없습니다.' };
    const roll = random();
    if (roll < .4) { run.bonusChests++; run.altarResult = { id: 'chest', name: '상자 개수 +1' }; }
    else if (roll < .6) { run.dropsRemaining++; run.altarResult = { id: 'drop', name: '낙하 횟수 +1' }; }
    else if (roll < .8) { run.rocketJump = true; run.altarResult = { id: 'rocket', name: '로켓 점프' }; }
    else { run.richChests++; run.altarResult = { id: 'rich', name: '풍요로운 상자 +1' }; }
    run.altarUsed = true; run.clearedFloor = run.floor;
    return { message: run.altarResult.name };
}
function continueAltar(user, random = Math.random) {
    const run = user.paradise;
    if (run?.mode !== 'hell' || run.phase !== 'altar' || !run.altarUsed) return { error: '제단을 먼저 사용해주세요.' };
    afterFloor(user, random);
    return { message: '제단을 떠납니다.' };
}
function afterFloor(user, random) {
    const run = user.paradise;
    if (run.floor === 100 || run.dropsRemaining === 0) finish(user, 'cleared', random);
    else run.phase = 'descent';
}
function victory(user, random = Math.random) {
    const run = user.paradise;
    run.battlesWon++; if (run.enemy.kind === 'elite') run.elitesWon++;
    run.clearedFloor = run.floor;
    rpg().clearFieldRuntimeTimers(user.name);
    afterFloor(user, random);
}
function makeChest(reward, tier, rich, random) {
    const items = rpg().getDataCache('Item', []), count = reward.counts[tier], stones = (tier + 1) * 10 * (rich ? 3 : 1), loot = [];
    const addItem = (name, quantity) => {
        const id = items.findIndex(item => item?.name === name);
        if (id < 0) throw new Error('지옥 보상 아이템 미등록: ' + name);
        const existing = loot.find(entry => entry.kind === 'item' && entry.id === id);
        if (existing) existing.count += quantity; else loot.push({ kind: 'item', id, name, count: quantity });
    };
    addItem('상급 강화석', stones);
    let description;
    if (reward.kind === 'orb') {
        const pool = items.filter(item => item?.use === '보주');
        if (!pool.length) throw new Error('등록된 보주가 없습니다.');
        for (let i = 0; i < count; i++) addItem(pick(pool, random).name, 1);
        description = '랜덤 보주 ' + count + '개';
    } else if (reward.kind === 'card') {
        for (let i = 0; i < count; i++) {
            const card = rpg().buildCharacterCardReward({ card_type: reward.cardType, display_star: reward.stars[tier] });
            if (!card) throw new Error('지옥 카드 보상 데이터가 없습니다.');
            loot.push({ kind: 'card', card, name: rpg().formatUserCard(card), count: 1 });
        }
        description = `${reward.stars[tier] === 10 ? 'Z' : reward.stars[tier] + '성'} ${reward.cardType} 카드 ${count}장`;
    } else { const name = reward.items?.[tier] || reward.item; addItem(name, count); description = name + ' ' + count + '개'; }
    return { id: crypto.randomUUID(), category: reward.id, tier, rich, stones, name: `${rich ? '풍요로운 ' : ''}${tierName(tier)} ${reward.name} 상자`, description: description + ' · 상급 강화석 ' + stones + '개', loot, opened: false };
}
function finish(user, outcome = 'retired', random = Math.random) {
    const run = user.paradise;
    // 상자 선택 도중 귀환 명령을 반복해도 후보와 남은 개봉 횟수를 다시 만들지 않는다.
    if (run.status === 'ended') return;
    const chests = [];
    if (run.clearedFloor > 0) {
        let pool = [];
        for (let i = 0; i < 3 + run.bonusChests + run.richChests; i++) {
            if (!pool.length) pool = [...run.rewardTable];
            const reward = pick(pool, random); pool.splice(pool.indexOf(reward), 1);
            chests.push(makeChest(reward, tierOf(run.clearedFloor), i >= 3 + run.bonusChests || random() < .1, random));
        }
    }
    rpg().clearFieldRuntimeTimers(user.name);
    user.field = null;
    if (outcome === 'defeated') user.hp = 1;
    run.status = 'ended'; run.outcome = outcome; run.endedAt = Date.now(); run.enemy = null; run.event = null; run.choices = [];
    run.chests = chests; run.opensRemaining = chests.length ? 1 : 0;
    run.claimed = !chests.length; run.phase = chests.length ? 'chests' : 'ended';
}
function normalizeChestSelection(user) {
    const run = user.paradise;
    if (run?.mode !== 'hell' || run.phase !== 'chests') return false;
    // 이전 규칙으로 저장된 후보는 보존하고, 이미 개봉한 탐험은 추가 지급 없이 마친다.
    const opened = run.chests.some(chest => chest.opened), remaining = opened ? 0 : 1;
    if (!opened && run.opensRemaining === remaining) return false;
    run.opensRemaining = remaining;
    if (opened) { run.claimed = true; run.claimedAt ||= Date.now(); run.phase = 'ended'; }
    run.revision++;
    return true;
}
function openChest(user, id) {
    const run = user.paradise;
    if (run?.mode !== 'hell' || run.phase !== 'chests' || run.claimed || run.opensRemaining <= 0 || run.chests.some(chest => chest.opened)) return { error: '선택할 보상 상자가 없습니다.' };
    const chest = run.chests.find(chest => chest.id === id);
    if (!chest || chest.opened) return { error: '아직 열지 않은 상자를 선택해주세요.' };
    const cards = chest.loot.filter(entry => entry.kind === 'card');
    if (user.inventory.card.length + cards.length > Number(user.maxCardLimit || 52)) return { error: `카드 보관함에 ${cards.length}칸이 필요합니다. 정리 후 다시 선택해주세요.` };
    const items = rpg().getDataCache('Item', []);
    if (chest.loot.some(entry => entry.kind === 'item' && items[entry.id]?.name !== entry.name)) return { error: '보상 아이템 설정을 확인해주세요. 상자는 보존됩니다.' };
    for (const entry of chest.loot) {
        if (entry.kind === 'card') user.inventory.card.push(structuredClone(entry.card));
        else rpg().grantItemReward(user, entry.id, entry.count);
        const existing = run.rewardSummary.find(row => row.kind === entry.kind && (entry.kind === 'item' ? row.id === entry.id : JSON.stringify(row.card) === JSON.stringify(entry.card)));
        if (existing) existing.count += entry.count; else run.rewardSummary.push(structuredClone(entry));
    }
    chest.opened = true; run.opensRemaining = 0;
    run.claimed = true; run.claimedAt = Date.now(); run.phase = 'ended';
    return { message: chest.name + ' 개봉', reveal: { kind: 'rewards', title: chest.name, rich: chest.rich, items: structuredClone(chest.loot) } };
}
function decorateView(view, user) {
    const config = rpg().getDataCache('Paradise', null)?.hell, items = rpg().getDataCache('Item', []);
    view.hell = { enabled: !validateConfig(config) && config.enabled, keys: KEYS.map(key => ({ name: key.name, drops: key.drops, iconUrl: '/rpg-ui?file=%EB%82%99%EC%9B%90%2F' + key.icon + '.webp', count: rpg().getInventoryItemCount(user, items.findIndex(item => item?.name === key.name)) })) };
    if (!view.run) return view;
    const run = user.paradise;
    view.run.mode = run.mode || 'heaven'; view.run.maxFloor = run.mode === 'hell' ? 100 : 999;
    if (run.mode !== 'hell') return view;
    for (const key of ['dropsRemaining','bonusChests','richChests','rocketJump','lastDrop','altarUsed','altarResult','opensRemaining','rewardSummary']) view.run[key] = run[key] ?? null;
    view.run.chests = (run.chests || []).map(({ loot, ...chest }) => chest);
    return view;
}
module.exports = { KEYS, recommendedPower, tierOf, validateConfig, enter, descend, altar, continueAltar, victory, finish, normalizeChestSelection, openChest, decorateView };
