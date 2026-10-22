'use strict';

// 저장된 장비가 참조하는 고정 ID. 초월 패시브의 97~99번은 이 세 효과에 예약한다.
const PASSIVE_IDS = { clairvoyance: 97, hellfire: 98, stormWalker: 99 };
const passives = {
    97: { name: '천리안', desc: '치명타 확률이 30% 이상이면 치명타 피해량이 20% 증가합니다.', format: [] },
    98: { name: '업화', desc: '화속성 저항이 200 증가합니다. 현재 HP가 최대 HP의 20% 이하로 내려가면 5초 동안 공격력이 20% 증가합니다. 재사용 대기시간은 15초입니다.', format: [], cooltime: 15000 },
    99: { name: '폭풍을 걷는 자', desc: '스킬 쿨타임 감소량이 20%를 초과하면 추가로 5%p 감소합니다.', format: [] }
};
// 기존 동급 갑옷의 강화 성장 곡선을 유지하면서 요청된 15강 합계에 맞춘다.
const curves = {
    '일반': { def: [1,1,1,1,2,2,2,2,2,3,4,5,6,7,8], hp: [] },
    '레어': { def: [2,2,3,3,4,4,4,5,5,6,7,8,9,11,15], hp: [25,30,35,40,50,55,60,70,80,95,110,130,150,180,290] },
    '유니크': { def: [4,4,5,6,7,8,9,10,11,13,15,17,20,24,30], hp: [45,55,65,80,95,110,130,150,175,210,250,300,387,546,834] },
    '레전더리': { def: [8,9,10,12,15,17,19,22,27,32,38,46,56,68,93], hp: [140,170,200,240,290,350,420,500,600,720,860,1040,1260,1520,1695] }
};
const rows = [
    ['일반','hat','여행자의 가죽 두건',2,30,31,30],
    ['일반','pants','여행자의 가죽 바지',2,40,42,40],
    ['일반','shoes','여행자의 가죽 장화',2,25,29,25],
    ['레어','hat','흑철 전투 투구',14,67,66,907],
    ['레어','pants','흑철 판금 하의',18,90,88,1210],
    ['레어','shoes','흑철 전투 장화',12,56,60,758],
    ['유니크','hat','매의 눈 투구',34,395,143,2454,{crit:.02}],
    ['유니크','pants','화룡의 비늘 하의',46,526,192,3272,{}, {hp:.05}],
    ['유니크','shoes','바람결의 장화',29,329,124,2048,{avd:.01}],
    ['레전더리','hat','천리안의 왕관',91,725,374,6728,{crit:.04},{},97],
    ['레전더리','pants','불멸하는 업화의 하의',122,967,500,8971,{fireRes:200},{hp:.08},98],
    ['레전더리','shoes','폭풍을 걷는 발걸음',76,605,315,5608,{avd:.02},{cooldown:.02},99]
];
function increments(weights, total) {
    const sum = weights.reduce((a,b) => a+b, 0); let accumulated = 0, previous = 0;
    return Array.from({length:15}, (_,i) => {
        accumulated += weights[i] || 0;
        const current = sum ? Math.round(total * accumulated / sum) : 0, value = current - previous;
        previous = current; return value;
    });
}
const definitions = { hat: [], pants: [], shoes: [] };
for (const [rarity,slot,name,def,hp,endDef,endHp,stat={},plusStat={},passiveId] of rows) {
    const defense = increments(curves[rarity].def, endDef-def), health = increments(curves[rarity].hp, endHp-hp);
    definitions[slot].push({ name, rarity, armorSlot:slot, no_trade:false, require:[], stat:{def,hp,...stat}, plusStat,
        desc: passiveId == null ? name + '입니다.' : passives[passiveId].desc,
        ...(passiveId == null ? {} : {passive_id:passiveId}),
        upgrade:defense.map((value,i) => ({stat:{def:value,...(health[i] ? {hp:health[i]} : {})},plusStat:{}})) });
}
function criticalBonus(stats, chance = stats.fixedCriticalChance ?? stats.crit) {
    return stats.hasClairvoyance && Number(chance || 0) >= .30 - 1e-9 ? .20 : 0;
}
function cooldownBonus(stats) {
    const base = Number(stats.cooldown || 0) - Number(stats.stormWalkerBonus || 0);
    return stats.hasStormWalker && base > .20 + 1e-9 ? .05 : 0;
}
function applyConditionalStats(stats) {
    if (stats.hasClairvoyance || stats.clairvoyanceBonus) {
        const bonus = criticalBonus(stats);
        stats.critMul = Number(stats.critMul || 1.4) - Number(stats.clairvoyanceBonus || 0) + bonus;
        stats.clairvoyanceBonus = bonus;
    }
    if (stats.hasStormWalker || stats.stormWalkerBonus) {
        const bonus = cooldownBonus(stats);
        stats.cooldown = Number(stats.cooldown || 0) - Number(stats.stormWalkerBonus || 0) + bonus;
        stats.stormWalkerBonus = bonus;
    }
    return stats;
}
function triggerHellfire(stats, state, hp, maxHp, now = Date.now()) {
    if (!stats.hasHellfireRage || hp <= 0 || hp > maxHp * .20 || now < Number(state.hellfireRageReadyAt || 0)) return false;
    state.hellfireRage = { attack:.20 * (1 + Number(stats.attackBuffEfficiency || 0)), until:now+5000 };
    state.hellfireRageReadyAt = now+15000;
    return true;
}
function attackBonus(state, now = Date.now()) {
    const buff = state?.hellfireRage;
    return buff && now < Number(buff.until ?? buff.expiredAt ?? 0) ? Number(buff.attack || 0) : 0;
}
module.exports = { PASSIVE_IDS, passives, definitions, criticalBonus, cooldownBonus, applyConditionalStats, triggerHellfire, attackBonus };
