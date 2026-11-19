// 천상의 전투 뒤 성장 선택(2026-11 개편). 증강 대신 스탯 증가, 체력 회복, 보상 획득 중 하나를 고르고 층 이동도 여기서 정한다.
// 스탯과 보상은 각각 무작위 후보 3개를 다시 보여 주고 하나를 고르게 한다. 전투에 크게 작용하는 스탯일수록 값과 등장 확률을 낮게 둔다.
// 층 수는 무작위가 아니라 그 선택지가 주는 영향이 클수록 높다(스탯 11~16층, 보상 7~11층, 회복은 실제로 채워지는 양에 따라 -3~3층).
const crypto = require('crypto');
const rpg = () => require('./rpgenius');
const corridor = () => require('./paradise');
const progression = () => require('./paradise_progression');

// kind: flat(현재 능력치의 비율을 고정 수치로 환산), enemyDef(현재 층 적 방어력의 비율), pct(퍼센트), chance(확률 %p),
//       ms(스킬 쿨타임 고정 감소), cut(퍼센트 감소), count(정수)
// floors: 이 스탯을 고르면 오르는 층 수. 전투 영향이 큰(등장 가중치가 낮은) 스탯일수록 높고, 굴린 수치가 범위의 가운데 이상이면 1층 더 오른다.
const STATS = [
    { id: 'atkFlat', label: '공격력', kind: 'flat', base: 'atk', range: [.06, .10], weight: 10, floors: 11 },
    { id: 'defFlat', label: '방어력', kind: 'flat', base: 'def', range: [.08, .14], weight: 10, floors: 11 },
    { id: 'mpFlat', label: 'MP', kind: 'flat', base: 'mp', range: [.08, .14], weight: 10, floors: 11, mp: true },
    { id: 'hpFlat', label: '체력', kind: 'flat', base: 'hp', range: [.06, .10], weight: 10, floors: 11 },
    { id: 'avd', label: '회피 확률', kind: 'chance', range: [.01, .02], step: .005, weight: 4, floors: 15 },
    { id: 'crit', label: '치명타 확률', kind: 'chance', range: [.02, .04], step: .005, weight: 7, floors: 13 },
    { id: 'critMul', label: '치명타 피해량', kind: 'pct', range: [.08, .15], step: .01, weight: 7, floors: 13 },
    { id: 'cmb', label: '연격 확률', kind: 'chance', range: [.02, .04], step: .005, weight: 7, floors: 13 },
    { id: 'pntFlat', label: '방어 관통력', kind: 'enemyDef', range: [.10, .16], weight: 7, floors: 13 },
    { id: 'pntPercent', label: '방어력 관통', kind: 'pct', range: [.02, .04], step: .005, weight: 6, floors: 14 },
    { id: 'cooldownFlat', label: '스킬 쿨타임', kind: 'ms', range: [300, 500], step: 100, weight: 6, floors: 14 },
    { id: 'cooldown', label: '스킬 쿨타임', kind: 'cut', range: [.03, .05], step: .01, weight: 6, floors: 14 },
    { id: 'extraDamage', label: '추가 피해', kind: 'pct', range: [.03, .05], step: .01, weight: 6, floors: 14 },
    { id: 'final', label: '최종 피해', kind: 'pct', range: [.02, .04], step: .01, weight: 4, floors: 15 },
    { id: 'atk', label: '최종 공격력', kind: 'pct', range: [.03, .06], step: .01, weight: 6, floors: 14 },
    { id: 'def', label: '최종 방어력', kind: 'pct', range: [.06, .10], step: .01, weight: 9, floors: 12 },
    { id: 'mp', label: '최종 MP', kind: 'pct', range: [.06, .10], step: .01, weight: 9, floors: 12, mp: true },
    { id: 'hp', label: '최종 체력', kind: 'pct', range: [.05, .08], step: .01, weight: 9, floors: 12 },
    { id: 'maxCmb', label: '최대 연격 횟수', kind: 'count', range: [1, 1], weight: 1.5, floors: 16 }
];
// 층 이동 범위. 영향이 클수록 높다: 능력이 영구히 오르는 스탯이 가장 높고, 전투력이 그대로인 보상은 낮고, 회복은 채워지는 양에 따라 내려갈 수도 있다.
const FLOORS = { stat: [11, 16], heal: [-3, 3], reward: [7, 11] };
const HEAL = .20;
const BONUS_WEIGHTS = [[3, 20], [4, 18], [5, 16], [6, 14], [7, 11], [8, 9], [9, 7], [10, 5]];
const STAR_WEIGHTS = [[5, 80], [6, 14.5], [7, 4], [8, 1.2], [9, .3]];
const TYPE_WEIGHTS = [['일반', 70], ['전직', 25], ['각성', 5]];
const CARD_CHANCE = .5;

const int = (random, [min, max]) => min + Math.min(max - min, Math.floor(random() * (max - min + 1)));
const weighted = (list, random) => { let roll = random() * list.reduce((sum, [, w]) => sum + w, 0); return (list.find(([, w]) => (roll -= w) < 0) || list.at(-1))[0]; };
// 큰 수치는 유효숫자 두 자리로 다듬는다(1,243 → 1,200).
function nice(value) {
    value = Math.max(1, Math.round(value));
    if (value < 100) return value;
    const unit = 10 ** (Math.floor(Math.log10(value)) - 1);
    return Math.round(value / unit) * unit;
}
// 굴린 수치와 그 수치가 범위 안에서 놓인 자리(0~1)를 돌려준다. 자리는 같은 스탯끼리 영향의 크기를 가른다.
function rollValue(stat, random, stats, floor) {
    const [min, max] = stat.range;
    if (stat.kind === 'flat' || stat.kind === 'enemyDef') {
        const position = random(), base = stat.kind === 'flat' ? Number(stat.base === 'atk' ? stats.baseAtk ?? stats.atk : stats[stat.base] || 0) : Number(corridor().heavenMonsterStats(floor, 'normal').def || 0);
        return { value: nice(base * (min + position * (max - min))), position };
    }
    if (stat.kind === 'count') return { value: min, position: 1 };
    const steps = Math.round((max - min) / stat.step), index = int(random, [0, steps]);
    return { value: Math.round((min + index * stat.step) * 1e6) / 1e6, position: steps ? index / steps : 1 };
}
const statFloors = (stat, position) => Math.min(FLOORS.stat[1], stat.floors + (stat.kind !== 'count' && position >= .5 ? 1 : 0));
// 보상 후보의 층 수: 귀한 보상일수록 높다. 카드는 5성 일반 7층에서 성급이 하나, 종류가 한 단계(일반, 전직, 각성) 오를 때마다 1층 더(최대 11층).
// 종료 보상은 +3~4% 7층에서 2%p마다 1층 더(+9~10% 10층).
const TYPE_RANK = { 일반: 0, 전직: 1, 각성: 2 };
const rewardFloors = reward => Math.min(FLOORS.reward[1], FLOORS.reward[0] + (reward.kind === 'bonus'
    ? Math.floor((Math.round(reward.bonus * 100) - 3) / 2)
    : (reward.star - 5) + (TYPE_RANK[reward.type] || 0)));
// 회복의 층 수: 실제로 채워지는 HP와 MP가 많을수록 높다. 둘 다 가득 차 있거나 회복 봉쇄면 가장 낮고(-3층), 둘 다 20% 넘게 비어 있으면 가장 높다(+3층).
function healFloors(user) {
    const [low, high] = FLOORS.heal;
    if (run(user).effects.noHealing) return low;
    const stats = rpg().calculateUserStats(user), resources = corridor().getResources(user);
    const filled = (current, max) => { const amount = Math.round(max * HEAL); return amount > 0 ? Math.min(amount, Math.max(0, max - Number(current ?? max))) / amount : null; };
    const parts = [filled(resources.hp, Number(stats.hp || 0)), filled(resources.mp, Number(stats.mp || 0))].filter(part => part != null);
    const impact = parts.length ? parts.reduce((sum, part) => sum + part, 0) / parts.length : 0;
    return low + Math.round(impact * (high - low));
}
function formatValue(stat, value) {
    const pct = n => (Math.round(n * 1000) / 10).toLocaleString('ko-KR');
    if (stat.kind === 'flat' || stat.kind === 'enemyDef') return '+' + value.toLocaleString('ko-KR');
    if (stat.kind === 'chance') return '+' + pct(value) + '%p';
    if (stat.kind === 'pct') return '+' + pct(value) + '%';
    if (stat.kind === 'cut') return '-' + pct(value) + '%';
    if (stat.kind === 'ms') return '-' + (value / 1000).toLocaleString('ko-KR') + '초';
    return '+' + value;
}
function rewardText(reward) {
    return reward.kind === 'bonus' ? '탐험 종료 보상 +' + Math.round(reward.bonus * 100) + '%' : `${reward.star}성 ${reward.type} 카드`;
}
function rollReward(random) {
    if (random() >= CARD_CHANCE) return { kind: 'bonus', bonus: weighted(BONUS_WEIGHTS, random) / 100 };
    return { kind: 'card', star: weighted(STAR_WEIGHTS, random), type: weighted(TYPE_WEIGHTS, random) };
}
const sameReward = (a, b) => a.kind === b.kind && (a.kind === 'bonus' ? a.bonus === b.bonus : a.star === b.star && a.type === b.type);

const run = user => user.paradise;
function playerPower(user) { return rpg().calculateCombatPower(user).total; }

function offer(user) {
    const r = run(user);
    r.boon = { id: crypto.randomUUID(), stage: 'pick', floors: { heal: healFloors(user) }, options: [] };
    r.choices = []; r.event = null;
    corridor().setPhase(user, 'boon');
}
function pickStats(user, random) {
    const stats = rpg().calculateUserStats(user), pool = STATS.filter(stat => !(stat.mp && stats.kino)), picked = [];
    while (picked.length < 3 && pool.length) {
        let roll = random() * pool.reduce((sum, stat) => sum + stat.weight, 0);
        const stat = pool.find(entry => (roll -= entry.weight) < 0) || pool.at(-1);
        pool.splice(pool.indexOf(stat), 1);
        // 같은 이름(스킬 쿨타임 고정/퍼센트)이 한 번에 두 번 나오지 않게 한다.
        for (let i = pool.length - 1; i >= 0; i--) if (pool[i].label === stat.label) pool.splice(i, 1);
        const { value, position } = rollValue(stat, random, stats, run(user).floor);
        picked.push({ id: stat.id, value, floors: statFloors(stat, position) });
    }
    return picked;
}
function pickRewards(random) {
    const picked = [];
    for (let guard = 0; picked.length < 3 && guard < 40; guard++) {
        const reward = rollReward(random);
        if (!picked.some(other => sameReward(other, reward))) picked.push(reward);
    }
    return picked;
}
// 1단계: 스탯/회복/보상 중 고르기. 2단계: 스탯과 보상은 후보 3개 중 하나.
function choose(user, input, random = Math.random) {
    const r = run(user), boon = r.boon;
    if (!corridor().active(user) || r.mode === 'hell' || r.phase !== 'boon' || !boon) return { error: '지금은 성장 선택지를 고를 수 없습니다.' };
    if (boon.stage === 'pick') {
        if (!['stat', 'heal', 'reward'].includes(input.choice)) return { error: '스탯 증가, 체력 회복, 보상 획득 중 하나를 골라주세요.' };
        if (input.choice === 'heal') {
            corridor().heal(user, HEAL, HEAL);
            const message = r.effects.noHealing ? '체력 회복\n회복 봉쇄 상태입니다.' : '체력 회복\nHP와 MP 20% 회복';
            return finish(user, 'heal', message, random, boon.floors.heal);
        }
        boon.stage = input.choice;
        boon.options = input.choice === 'stat' ? pickStats(user, random) : pickRewards(random).map(reward => ({ ...reward, floors: rewardFloors(reward) }));
        boon.id = crypto.randomUUID();
        return { message: input.choice === 'stat' ? '올릴 스탯을 골라주세요.' : '받을 보상을 골라주세요.' };
    }
    const index = Number(input.index);
    const option = Number.isInteger(index) ? boon.options[index] : null;
    if (!option) return { error: '제시된 후보 중 하나를 골라주세요.' };
    let message;
    if (boon.stage === 'stat') {
        const stat = STATS.find(entry => entry.id === option.id);
        applyStat(user, stat, option.value);
        message = '스탯 증가\n' + stat.label + ' ' + formatValue(stat, option.value);
    } else {
        if (option.kind === 'bonus') r.effects.reward = Number(r.effects.reward || 0) + option.bonus;
        else r.contracts.push({ star: option.star, type: option.type, name: `${option.star}성 ${option.type} 카드` });
        message = '보상 획득\n' + rewardText(option) + (option.kind === 'card' ? '\n탐험을 마치고 귀환하면 받습니다.' : '');
    }
    return finish(user, boon.stage, message, random, optionFloors(boon, option));
}
// 후보마다 정해 둔 층 수. 분류마다 층 수가 하나였던 때 저장된 선택지는 그 값을 쓴다.
const optionFloors = (boon, option) => Number(option.floors ?? boon.floors?.[boon.stage] ?? 0);
function applyStat(user, stat, value) {
    const r = run(user);
    if (stat.kind === 'flat' || stat.kind === 'enemyDef' || stat.kind === 'ms') {
        const key = { atkFlat: 'atk', defFlat: 'def', mpFlat: 'mp', hpFlat: 'hp', pntFlat: 'pnt', cooldownFlat: 'cooldownMs' }[stat.id];
        (r.boonStats ||= {})[key] = Number(r.boonStats[key] || 0) + value;
        corridor().clampResources(user);
    } else corridor().addEffect(user, { [stat.id]: stat.kind === 'cut' ? -value : value });
    (r.boonLog ||= []).push({ id: stat.id, value });
}
function finish(user, kind, message, random, floors) {
    const r = run(user), moved = progression().augmentMovement(r, floors);
    delete r.boon;
    corridor().move(user, floors, false, true);
    corridor().afterChoice(user);
    corridor().log(r, `${message.split('\n').slice(0, 2).join(', ')}, ${moved > 0 ? '+' : ''}${moved}층`);
    r.lastOutcome = message;
    corridor().offerRoutes(user, random);
    return { message: message + `\n${moved > 0 ? '+' : ''}${moved}층`, reveal: kind === 'heal' ? null : { motif: kind === 'stat' ? 'focus' : 'contract', positive: true, text: message } };
}
function view(user, power = playerPower(user)) {
    const r = run(user), boon = r?.boon;
    if (!boon || r.phase !== 'boon') return null;
    const warning = floors => corridor().powerWarning(user, floors, r.forceElite ? 'elite' : 'normal', false, power, true);
    const moved = floors => progression().augmentMovement(r, floors), heal = Number(boon.floors?.heal ?? 0);
    // 처음 화면: 회복은 정해진 층 수, 스탯과 보상은 후보마다 달라 범위로 보인다. 위험 표시는 가장 멀리 가는 경우를 기준으로 한다.
    const result = { id: boon.id, stage: boon.stage,
        floors: { stat: FLOORS.stat.map(moved), heal: moved(heal), reward: FLOORS.reward.map(moved) },
        powerWarning: { stat: warning(FLOORS.stat[1]), heal: warning(heal), reward: warning(FLOORS.reward[1]) },
        healPercent: Math.round(HEAL * 100) };
    const each = option => { const floors = optionFloors(boon, option); return { floors: moved(floors), powerWarning: warning(floors) }; };
    if (boon.stage === 'stat') result.options = boon.options.map(option => {
        const stat = STATS.find(entry => entry.id === option.id);
        return { id: stat.id, label: stat.label, value: formatValue(stat, option.value), impact: stat.weight <= 4 ? 'high' : stat.weight <= 7 ? 'mid' : 'low', ...each(option) };
    });
    if (boon.stage === 'reward') result.options = boon.options.map(option => ({ ...(option.kind === 'bonus'
        ? { kind: 'bonus', label: '탐험 종료 보상', value: '+' + Math.round(option.bonus * 100) + '%' }
        : { kind: 'card', label: `${option.type} 카드`, value: `${option.star}성`, star: option.star, type: option.type }), ...each(option) }));
    return result;
}
// 성장 선택으로 얻은 고정 수치를 전투 능력치에 더한다. 퍼센트 수치는 탐험 효과(run.effects)로 합산된다.
function applyStats(r, stats) {
    const flat = r.boonStats;
    if (!flat) return;
    stats.def = Math.max(0, Math.round(Number(stats.def || 0) + Number(flat.def || 0)));
    stats.hp = Math.max(1, Math.round(Number(stats.hp || 0) + Number(flat.hp || 0)));
    stats.mp = Math.max(0, Math.round(Number(stats.mp || 0) + Number(flat.mp || 0)));
    stats.pnt = Number(stats.pnt || 0) + Number(flat.pnt || 0);
    stats.skillCooldown = Number(stats.skillCooldown || 0) - Number(flat.cooldownMs || 0);
}
module.exports = { STATS, FLOORS, HEAL, BONUS_WEIGHTS, STAR_WEIGHTS, TYPE_WEIGHTS, CARD_CHANCE, nice, formatValue, rewardText, statFloors, rewardFloors, healFloors, offer, choose, view, applyStats };
