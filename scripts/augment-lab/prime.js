// 실전의 '증강 상태 채우기': 고른 증강이 다음 한두 번의 행동으로 발동하도록 상태를 발동 직전까지 채운다.
// 상태 이름과 의미는 paradise_prism.js를 따른다(탐험 run.prism / 2마리 전투 run.prismEncounter / 적 한 마리 run.battle.prism).
// 실험자 캐릭터는 치명타 확률이 0이라, 치명타가 있어야 발동하는 증강은 탐험의 치명타 효과(run.effects.crit)를 올린다.
const sandbox = require('../paradise-lab/sandbox');
const mechanics = require('../../paradise_mechanics');
const shields = require('../../combat_shields');
const cards = require('../../DB/RPGenius/CharacterCards.json');
const skillData = require('../../DB/RPGenius/Skills.json');
const { rpg, corridor, prism, AUGMENTS } = sandbox;

const expedition = user => user.paradise.prism ||= {};
const battle = user => user.paradise.battle.prism ||= {};
const stats = user => rpg.calculateUserStats(user);
// 2마리 전투 한 번의 상태. paradise_prism.js의 encounter()와 같은 규칙으로 꺼낸다.
function encounter(user) {
    const run = user.paradise;
    if (!run.prismEncounter || run.prismEncounter.id !== run.encounterId) run.prismEncounter = { id: run.encounterId || null };
    return run.prismEncounter;
}
// 소환수나 지속 피해 하나를 거둔다(run.battle.mechanics.dots).
function dismiss(user, key) { delete user.paradise.battle.mechanics?.dots?.[key]; }
// 탐험의 치명타 효과를 올려 치명타 확률이 적어도 chance가 되게 한다.
function critAtLeast(user, chance) { const effects = user.paradise.effects; effects.crit = Math.max(Number(effects.crit || 0), chance); }
// 내 캐릭터의 첫 일반 스킬(궁극기 제외). 실험자 캐릭터는 자인이다. 없으면 이름만 '일반'으로 안내한다.
function normalSkill(user) {
    const ultimates = new Set(rpg.getUltimateSkills(user).map(entry => entry.skill.name));
    return rpg.getMainCardSkills(user).map(entry => entry.skill).find(skill => !ultimates.has(skill.name)) || { name: '일반', mp_cost: 0 };
}
// 스킬을 바로 쓸 수 있게 쿨타임과 행동 대기를 비우고, MP가 모자라면 채운다.
function ready(user, name, cost = 0) {
    delete user.field.skillCooldowns[name];
    user.field.nextActionAt = 0;
    const resources = corridor.getResources(user);
    if (Number(resources.mp) < cost) resources.mp = stats(user).mp;
}
// 적의 보통 한 방(치명타와 연격이 섞이지 않은 피해). 서버와 같은 계산을 여러 번 굴려 가운데 값을 쓴다.
function usualHit(user) {
    const now = stats(user), slots = rpg.calculateCardSlotEffects(user);
    const list = Array.from({ length: 101 }, () => rpg.calculateMonsterAttackHitResult(user.paradise.enemy, now, slots, {}).finalDamage).sort((a, b) => a - b);
    return list[50];
}
// 적의 다음 보통 공격 한 번이 HP를 20% 아래로 떨어뜨리되 쓰러뜨리지는 않게 HP를 맞추고, 그 HP를 %로 돌려준다.
function edgeHp(user) {
    const resources = corridor.getResources(user), max = stats(user).hp;
    resources.hp = max; // 20% 아래에서 붙는 받는 피해 증가(죽을 각오로)가 섞이지 않은 피해로 잰다
    resources.hp = Math.min(max, Math.ceil(max * .2) - 1 + Math.floor(usualHit(user) * .97));
    return Math.round(resources.hp / max * 100);
}
const SEASON_HINT = { spring: '봄에는 매초 최대 HP의 1%를 회복합니다', summer: '여름에는 공격할 때마다 화상을 남깁니다', autumn: '가을에는 MP 소모량과 스킬 쿨타임이 30% 줄어듭니다', winter: '겨울에는 적의 행동이 1초 느려집니다' };

// id → (user) => 안내 문구.
const PRIME = {
    fruition: user => { expedition(user).fruition = 2; return '다음 공격이 세 번째 공격이라 확정 치명타가 터집니다. 일반 공격과 스킬을 모두 셉니다.'; },
    deathWish: user => {
        delete battle(user).deathWishAwake;
        return `내 HP를 ${edgeHp(user)}%로 맞췄습니다. "적이 바로 공격"을 누르면 HP가 20% 아래로 떨어지며 각성합니다. 그 뒤로는 내 공격이 모두 고정 피해가 되고 받는 피해가 2배라, 적의 다음 공격에 쓰러지기 쉽습니다. 그 전에 일반 공격으로 고정 피해를 확인하세요.`;
    },
    conqueror: user => { encounter(user).conqueror = 9; dismiss(user, 'prism:cavalry'); return '정복자 9중첩을 채웠습니다. 일반 공격을 한 번 하면 10중첩이 되어 기병이 달려옵니다.'; },
    fatalDestiny: user => {
        // 처형은 치명타 확률 20%에 달려 있어, 운명을 다섯 번 쓸 수 있게 35중첩을 채운다(서버 상한 99).
        battle(user).fate = 35; critAtLeast(user, .20);
        return '운명 35중첩을 채우고 치명타 확률을 상한인 20%로 올렸습니다. 운명 스킬은 7중첩씩 써서 공격력의 7% 피해를 주고, 치명타가 터지면 적을 처형합니다. 처형은 대략 다섯 번에 한 번 나옵니다.';
    },
    holyLightning: user => { expedition(user).lightning = 2; return '다음 공격이 세 번째 공격이라 번개가 내리칩니다. 일반 공격과 스킬을 모두 셉니다.'; },
    dotCritical: user => {
        const now = stats(user); critAtLeast(user, 1);
        mechanics.addDot(user, 'lab:burn', '화상', now.atk * .5 * (1 + Number(now.dotDamage || 0)), 5, 2000, false, { element: '화' });
        return '치명타 확률을 100%로 올리고 적에게 10초 동안 화상을 걸었습니다. 2초마다 화상이 치명타로 들어갑니다.';
    },
    eternalFlame: user => {
        // 전투 시작(prism.onBattle)과 같은 불꽃을 지금 적에게 새로 붙이고 점화 사건을 보낸다.
        // 새 전투 시작은 화면을 다시 불러 점화 사건을 건너뛰고, 둘째 적의 점화는 처치 사건과 한 응답에 와서 화면에 보이지 않는다.
        const now = stats(user);
        mechanics.addDot(user, 'prism:flame', '꺼지지 않는 불꽃', now.atk * .25 * (1 + Number(now.dotDamage || 0)), 9999, 2000, false, { element: '화' });
        prism.pushEvent(user, { action: 'augment', actor: 'player', effectTarget: 'target', triggeredEffectIds: ['augment:eternalFlame.ignite'] });
        return '지금 적에게 불꽃을 새로 붙였습니다. 2초마다 공격력의 25% 화상 피해가 들어갑니다.';
    },
    haste: () => '채울 상태가 없습니다. 공격한 뒤 다음 행동까지의 대기가 2~3초에서 1.5~2.5초로 줄어듭니다. 공격 단추의 대기 시간을 보세요.',
    replay: user => {
        const known = prism.replayTarget(user), name = known || (expedition(user).lastSkill = normalSkill(user).name);
        delete user.field.skillCooldowns['리플레이']; user.field.nextActionAt = 0;
        return (known ? '리플레이 쿨타임을 비웠습니다.' : `마지막으로 쓴 스킬을 ${name} 스킬로 두고 리플레이 쿨타임을 비웠습니다.`) + ` 리플레이 스킬을 누르면 ${name} 스킬을 자원 소모 없이 한 번 더 씁니다.`;
    },
    timeOfChoice: user => {
        const skill = normalSkill(user), resources = corridor.getResources(user); battle(user).marked = true; ready(user, skill.name, Number(skill.mp_cost || 0));
        resources.hp = Math.min(Number(resources.hp), Math.round(stats(user).hp * .7));
        return `적에게 표식을 남기고, 회복이 보이도록 내 HP를 70%로 낮췄습니다. ${skill.name} 스킬을 쓰면 표식이 터지고, 일반 공격을 하면 표식을 소비해 HP와 MP를 10% 회복합니다. 표식이 없을 때 ${skill.name} 스킬로 공격하면 새 표식이 생깁니다.`;
    },
    flyingSword: user => { battle(user).lastAttackAt = Date.now() - 4000; return '4초 동안 공격하지 않은 상태로 만들었습니다. 다음 일반 공격이 떠다니는 검을 부르고, 검은 1초마다 세 번 벱니다.'; },
    duelChallenge: user => {
        const skill = normalSkill(user); battle(user).duel = 'ready'; delete battle(user).duelUntil; ready(user, skill.name, Number(skill.mp_cost || 0));
        return `결투를 다시 신청할 수 있게 했습니다. ${skill.name} 스킬로 피해를 입히면 적이 바로 반격하고(피해 75% 감소), 그 뒤 10초 동안 나와 적의 행동 쿨타임이 절반이 됩니다.`;
    },
    onePunch: () => '채울 상태가 없습니다. 일반 공격마다 피해가 2배가 되고 적이 바로 맞공격합니다. 맞공격 뒤에는 적의 다음 공격 시간이 처음부터 다시 흐릅니다.',
    seasons: user => {
        const season = expedition(user).season || 'spring', next = prism.SEASONS[(prism.SEASONS.indexOf(season) + 1) % prism.SEASONS.length], skill = normalSkill(user);
        ready(user, skill.name, Number(skill.mp_cost || 0));
        return `지금은 ${prism.SEASON_NAMES[season]}입니다. ${skill.name} 스킬을 쓰면 ${prism.SEASON_NAMES[next]}이 되고, ${SEASON_HINT[next]}.`;
    },
    manualShift: user => { Object.assign(expedition(user), { shift: 3, armed: false }); return '운명 3중첩을 채웠습니다. 변속 스킬을 누른 뒤 공격하면 확정 치명타가 터집니다.'; },
    deepeningBleed: user => { delete battle(user).bleedApplied; return '이번 전투의 첫 일반 공격 전으로 되돌렸습니다. 일반 공격을 하면 출혈을 남기고, 그 뒤 "적이 바로 공격"을 누를 때마다 출혈이 터집니다.'; },
    soulReaper: user => { expedition(user).souls = 3; return '영혼 3개를 채웠습니다. 명계의 부름 스킬을 누르면 사신이 영혼 하나당 공격력의 144% 고정 피해를 줍니다. 수확은 "적 HP 1"을 누르고 적을 쓰러뜨리면 보입니다.'; },
    readIntent: user => {
        // 서버(advanceParadiseCombat)와 같은 방법으로 다음 적 공격을 미리 굴려 둔다.
        const b = battle(user), now = stats(user), avoided = Math.random() < Number(now.avd || 0);
        const roll = avoided ? null : rpg.calculateMonsterAttackHitResult(user.paradise.enemy, now, rpg.calculateCardSlotEffects(user), {});
        Object.assign(b, { intentCount: 2, parry: false, foresight: { avoided, finalDamage: Number(roll?.finalDamage || 0), hitCount: Number(roll?.hitCount || 0), criticalCount: Number(roll?.criticalCount || 0) } });
        user.field.nextEnemyAttackAt = Date.now() + 10000; // 안내를 읽는 동안 적의 공격이 예정 피해를 먼저 써 버리지 않게 한다
        return '적의 공격을 두 번 읽은 상태라 다음 공격의 예정 피해가 보입니다. 간파 스킬을 누르고 "적이 바로 공격"을 누르면 그 공격을 무효화합니다. 적의 다음 공격은 10초 뒤로 미뤘습니다.';
    },
    timeRewind: user => {
        const run = user.paradise, b = battle(user), max = stats(user).hp, now = Date.now();
        corridor.getResources(user).hp = max; b.hpLog = [[now, max]];
        delete b.rewindUsed; delete b.rewindGuardUntil;
        // 실험자 캐릭터는 적의 보통 공격이 최대 HP의 16%쯤이라, 적 공격력을 올려 한 방이 30%쯤 되게 한다.
        const hit = usualHit(user);
        if (hit > 0 && hit < max * .27) run.enemy.atk = Math.ceil(run.enemy.atk * max * .30 / hit);
        return '되감기를 다시 쓸 수 있게 하고 HP를 가득 채웠습니다. 적 공격력을 올려 이제 한 방이 최대 HP의 30%쯤 들어옵니다. "적이 바로 공격"을 누르면 HP가 3초 전으로 돌아갑니다. 올린 공격력은 이 적이 쓰러질 때까지 남습니다.';
    },
    demonHunter: user => { expedition(user).demon = 2; return '다음 공격이 세 번째 직접 공격이라 대상 최대 HP의 6% 고정 피해가 더해집니다.'; },
    angelDescent: user => {
        const e = expedition(user); delete e.angelUsed; delete e.angelUntil; dismiss(user, 'prism:angel');
        return `천사를 다시 부를 수 있게 하고 내 HP를 ${edgeHp(user)}%로 맞췄습니다. "적이 바로 공격"을 누르면 HP가 20% 아래로 떨어지며 천사가 내려옵니다.`;
    },
    transcendDeath: user => {
        if (battle(user).transcend) return '마지막 기회가 진행 중입니다. "적 HP 1"을 누르고 공격하면 HP 30%로 부활합니다.';
        corridor.getResources(user).hp = 1;
        return '내 HP를 1로 낮췄습니다. "적이 바로 공격"을 누르면 쓰러지는 대신 10초 동안 마지막 기회가 주어집니다. 그 안에 "적 HP 1"을 누르고 공격하면 HP 30%로 부활하고, 적을 쓰러뜨리지 못한 채 두 번 공격하면 쓰러집니다.';
    },
    dualIdentity: user => {
        const e = expedition(user), own = new Set(cards[user.main_card?.id]?.skills || []);
        const borrowed = (cards[e.identity?.id]?.skills || []).filter(index => !own.has(index)).map(index => skillData[index]).filter(Boolean);
        if (!borrowed.length) return '빌려 온 스킬이 없습니다. "새 전투 시작"을 다시 누르세요.';
        borrowed.forEach(skill => ready(user, skill.name, Number(skill.mp_cost || 0)));
        return `${e.identityName}의 스킬을 빌려 왔습니다. 스킬 목록의 ${borrowed[0].name} 스킬을 눌러 써 보세요. 쿨타임은 비워 두었습니다.`;
    },
    comboStaircase: user => { (user.paradise.battle.mechanics ||= {}).stairStep = 2; return '다음 일반 공격이 3단계라 최소 3연격으로 나갑니다.'; }, // 계단은 paradise_mechanics.js가 센다
    painfulWound: user => {
        battle(user).woundCrits = 4; critAtLeast(user, 1);
        return '치명타 4회를 쌓고 치명타 확률을 100%로 올렸습니다. 일반 공격을 하면 다섯 번째 치명타로 상처를 남기고, 상처는 2초마다 대상 최대 HP의 4% 피해를 줍니다.';
    },
    shieldSiphon: user => {
        const enemy = user.paradise.enemy;
        shields.grant(enemy.mirror || enemy, { source: 'lab:shield', caster: '', amount: Math.round(stats(user).atk * 4) });
        return '적에게 공격력 4배만큼의 보호막을 씌웠습니다. 보호막이 남아 있는 동안 공격하면 10% 추가 피해를 주고, 그 절반만큼 보호막을 얻습니다.';
    },
    armorShred: user => { battle(user).shred = .24; return '방어 감소를 24%까지 채웠습니다. 다음 공격으로 최대치인 30%에 닿습니다.'; },
    thornArmor: () => '채울 상태가 없습니다. "적이 바로 공격"을 누르면 맞을 때마다 방어력의 300%를 고정 피해로 되돌려 줍니다.',
    hundredFlowers: user => { battle(user).flowers = 5; return '꽃 5송이를 채웠습니다. 다음 공격으로 6송이가 되면 모든 꽃이 한꺼번에 피어납니다.'; },
    swordDance: user => {
        const skill = prism.SKILLS.find(entry => entry.id === 'swordDance');
        ready(user, skill.name, prism.skillCost(user, skill, stats(user)));
        return '검무를 바로 쓸 수 있게 했습니다. 검무 스킬을 누르면 공격력의 50%로 8번 벱니다.';
    }
};

function prime(user, id) {
    const augment = AUGMENTS.find(a => a.id === id);
    if (!augment) return '증강을 골라주세요.';
    if (!user.paradise.acquired?.[id]) return `${augment.name} 증강을 가지고 있지 않습니다. "새 전투 시작"을 먼저 누르세요.`;
    if (!PRIME[id]) return `${augment.name} 증강은 따로 채울 상태가 없습니다. 그대로 써 보세요.`;
    // 다음 공격에 적이 쓰러져 발동이 끊기지 않게, 적 체력이 4분의 1 아래면 가득 채운다.
    const enemy = user.paradise.enemy, low = enemy.hp < enemy.maxHp * .25;
    if (low) enemy.hp = enemy.maxHp;
    return PRIME[id](user) + (low ? ' 적 체력이 적어 가득 채웠습니다.' : '');
}

module.exports = { prime, PRIME };
