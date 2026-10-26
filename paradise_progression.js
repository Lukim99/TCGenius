const crypto = require('crypto');
const rpg = () => require('./rpgenius');
const TOKEN = '천상의 증표';
const VALUES = [5,7,9,11,13,15,18,21,24,27,30,35,40,45,50,55,63,71,79,87,95,107,119,131,143,155];
const COSTS = [0,100,125,160,205,260,325,400,485,580,685,800,925,1060,1205,1360,1525,1700,1885,2080,2285,2500,2725,2960,3205,3460];
const CHANCES = [0,100,95,90,85,80,75,70,65,60,55,50,45,40,35,30,30,28,26,24,22,20,18,16,14,12];
const TRAITS = [
    ['ordinaryRelic', '순례자의 유산', '일반 유물 하나를 갖고 시작합니다.'],
    ['silverAugment', '은빛 예감', '실버 증강 3개 중 하나를 선택하고 시작합니다.'],
    ['fragileElites', '정예 사냥', '처음 조우하는 엘리트 2마리의 현재 HP가 1이 됩니다.'],
    ['firstTreasure', '보물의 이정표', '처음 조우하는 이벤트방이 상자방이 됩니다.'],
    ['advancedRelic', '금빛 대가', '최대 HP가 50% 감소하는 대신 고급 유물 하나를 갖고 시작합니다.'],
    ['prismaticAugment', '깨진 운명', '최대 HP와 방어력이 50% 감소하는 대신 프리즘 증강 3개 중 하나를 선택하고 시작합니다.'],
    ['augmentHp', '생명의 선택', '증강을 선택할 때마다 최대 HP의 2%를 회복합니다.'],
    ['augmentMp', '마력의 선택', '증강을 선택할 때마다 최대 MP의 2%를 회복합니다.'],
    ['woundedAscent', '고행의 계단', '현재 HP가 95% 감소한 상태로 시작합니다. 한 층을 올라갈 때마다 최대 HP의 5%를 회복합니다.'],
    ['distortedEdge', '뒤틀린 칼날', '뒤틀림이 20 이상이면 추가 피해가 20% 증가합니다.'],
    ['chaosCrown', '혼돈의 왕관', '뒤틀림이 60 이상이면 최종 피해가 30% 증가합니다.'],
    ['calmStrength', '고요한 힘', '뒤틀림이 0이면 공격력이 10% 증가합니다.'],
    ['upwardFate', '거스르는 운명', '층수가 감소하는 대신 1층을 올라갑니다.'],
    ['halfSteps', '느린 순례', '층을 올라갈 때 3층 덜 올라가되, 최소 1층은 올라갑니다. 하강 증강을 선택하면 대신 하강량의 절반(올림)만큼 올라가고 증강을 하나 더 선택합니다.'],
    ['extraTime', '머무는 시간', '탐험 제한 시간이 5분 늘어납니다.'],
    ['tokenBounty', '천상의 은혜', '탐험 종료 시 천상의 증표를 20% 추가로 획득합니다.'],
    ['deathInsurance', '마지막 은총', '사망해도 정산될 천상의 증표의 50%를 획득합니다. 다른 보상과 계약은 잃습니다.']
].map(([id, name, desc]) => ({ id, name, desc })).concat(require('./paradise_traits').TRAITS);
const icon = name => '/rpg-ui?file=' + encodeURIComponent('낙원/celestial-' + name + '.webp');
const state = user => user.paradiseProgression || { revision: 0, weapon: null, armor: null, traits: [] };
const locked = user => user.paradise?.status === 'active' || !!user.field || !!require('./partyquest').getRoomOf(user.name) || user.pvp?.battle && user.pvp.battle.phase !== 'ended';
const has = (run, id) => run?.mode !== 'hell' && !!run?.celestial?.traits?.includes(id);
function tokenId() { return rpg().getDataCache('Item', []).findIndex(item => item?.name === TOKEN); }
function pay(user, count) {
    const id = tokenId();
    if (id < 0 || rpg().getInventoryItemCount(user, id) < count) return false;
    rpg().removeInventoryItem(user, id, count); return true;
}
function gear(slot, level) {
    const unlocked = level != null;
    // 기존 강화 곡선을 유지하며 무기는 10배, 방어구는 3배의 고정 능력치를 부여한다.
    const stats = n => ({ atk: slot === 'weapon' ? VALUES[n] * 10 : 0, def: slot === 'armor' ? VALUES[n] * 3 : 0, hp: slot === 'armor' ? VALUES[n] * 60 : 0 });
    return { unlocked, level: level ?? 0, ...(unlocked ? stats(level) : { atk: 0, def: 0, hp: 0 }),
        iconUrl: icon(slot), unlockCost: 50,
        next: unlocked && level < 25 ? { level: level + 1, cost: Math.round(COSTS[level + 1] * (slot === 'armor' ? .8 : 1)), chance: CHANCES[level + 1], ...stats(level + 1) } : null };
}
function view(user) {
    const current = state(user), id = tokenId();
    return { revision: current.revision, tokens: id < 0 ? 0 : rpg().getInventoryItemCount(user, id), locked: !!locked(user),
        weapon: gear('weapon', current.weapon), armor: gear('armor', current.armor),
        traits: { lines: [0,1].map(i => TRAITS.find(t => t.id === current.traits[i]) || null), unlockCosts: [1000,3000], rerollCost: 100, iconUrl: icon('abilities') },
        lastResult: current.lastResult || null };
}
function mutate(user, action, input, random = Math.random) {
    if (locked(user)) return { error: '진행 중인 전투나 탐험을 마친 뒤 변경해주세요.' };
    const current = structuredClone(state(user));
    let message, success = true;
    const rollTrait = excluded => {
        const pool = TRAITS.filter(t => !excluded.includes(t.id));
        return pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))].id;
    };
    if (action === 'unlockEquipment' || action === 'enhance') {
        const slot = input.slot;
        if (!['weapon','armor'].includes(slot)) return { error: '천상 무기 또는 방어구를 선택해주세요.' };
        const name = slot === 'weapon' ? '천상 무기' : '천상 방어구', item = gear(slot, current[slot]);
        if (action === 'unlockEquipment') {
            if (item.unlocked) return { error: '이미 해금한 장비입니다.' };
            if (!pay(user, 50)) return { error: '천상의 증표 50개가 필요합니다.' };
            current[slot] = 0; message = name + '를 해금했습니다.';
        } else {
            if (!item.unlocked || !item.next) return { error: item.unlocked ? '최대 25강에 도달했습니다.' : '먼저 장비를 해금해주세요.' };
            if (!pay(user, item.next.cost)) return { error: `천상의 증표 ${item.next.cost.toLocaleString('ko-KR')}개가 필요합니다.` };
            success = random() < item.next.chance / 100;
            if (success) current[slot]++;
            message = name + ' ' + (success ? `+${current[slot]} 강화 성공` : `+${current[slot]} 유지`);
        }
    } else if (action === 'unlockTrait') {
        const index = input.index;
        if (![0,1].includes(index) || current.traits.length !== index) return { error: '순서대로 잠긴 특수능력을 해금해주세요.' };
        const cost = index === 0 ? 1000 : 3000;
        if (!pay(user, cost)) return { error: `천상의 증표 ${cost.toLocaleString('ko-KR')}개가 필요합니다.` };
        current.traits.push(rollTrait(current.traits)); message = '천상 특수능력을 해금했습니다.';
    } else if (action === 'rerollTrait') {
        const index = input.index;
        if (![0,1].includes(index) || !current.traits[index]) return { error: '해금한 특수능력 줄을 선택해주세요.' };
        if (!pay(user, 100)) return { error: '천상의 증표 100개가 필요합니다.' };
        current.traits[index] = rollTrait(current.traits.filter((_, i) => i !== index));
        message = (index + 1) + '번째 특수능력을 재설정했습니다.';
    } else return { error: '알 수 없는 천상 강화 동작입니다.' };
    current.revision++;
    current.lastResult = { id: crypto.randomUUID(), kind: action, success, slot: input.slot || null, index: input.index ?? null, level: input.slot ? current[input.slot] : null, message };
    user.paradiseProgression = current;
    return { message };
}
function snapshot(user) {
    const current = state(user);
    return { weapon: current.weapon, armor: current.armor, traits: [...current.traits], elites: 0, firstEvent: false };
}
function applyStats(run, stats) {
    if (!run.celestial || run.mode === 'hell') return;
    const weapon = gear('weapon', run.celestial.weapon), armor = gear('armor', run.celestial.armor);
    stats.atk += weapon.atk; stats.def += armor.def; stats.hp += armor.hp;
    if (has(run, 'advancedRelic')) stats.hp *= .5;
    if (has(run, 'prismaticAugment')) { stats.hp *= .5; stats.def *= .5; }
    if (has(run, 'calmStrength') && run.distortion === 0) stats.atk *= 1.10;
    for (const key of ['atk','def','hp']) stats[key] = Math.max(key === 'def' ? 0 : 1, Math.round(stats[key]));
}
function movement(run, floors) {
    if (floors < 0 && has(run, 'upwardFate')) return 1;
    return floors > 0 && has(run, 'halfSteps') ? Math.max(1, floors - 3) : floors;
}
function augmentMovement(run, floors) {
    return floors < 0 && has(run, 'halfSteps') ? Math.ceil(-floors / 2) : movement(run, floors);
}
module.exports = { TOKEN, VALUES, COSTS, CHANCES, TRAITS, has, view, mutate, snapshot, applyStats, movement, augmentMovement };
