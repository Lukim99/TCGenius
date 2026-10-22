// 메인 캐릭터를 사용하는 천상 탐험에만 적용한다. 카드·장비의 원본 수치는 변경하지 않는다.
const CHARACTERS = require('./DB/RPGenius/CharacterCards.json');
const a = (id, character, name, floors, rarity, category, desc, skill) => ({
    id, character, characterName: CHARACTERS[character].name, name, floors, rarity, category, desc, effect: {}, ...(skill == null ? {} : { requiresSkill: skill })
});
const AUGMENTS = [
    a('zainRefrain', 0, '자인 리프레인', 8, 'gold', 'skill', '자인을 사용한 뒤 일반 공격을 적중시키면 자인의 쿨타임을 초기화합니다.'),
    a('timeThief', 0, '시간 도둑', 15, 'prismatic', 'skill', '자인을 3회 사용할 때마다 유드 알레프의 쿨타임을 초기화합니다.', 12),
    a('sivalonWarmup', 1, '시벌론 예열', 4, 'silver', 'basic', '시벌론이 아닌 상태에서 일반 공격을 사용하면 충전을 2개씩 획득합니다.'),
    a('endlessFrenzy', 1, '끝나지 않는 광란', 10, 'gold', 'basic', '시벌론 상태에서 일반 공격을 적중시킬 때마다 지속시간을 0.5초 연장합니다. 전투마다 최대 5초까지 연장합니다.'),
    a('shieldFist', 2, '방패 속의 주먹', 10, 'gold', 'defense', '보호막이 흡수한 피해의 30%를 저장했다가 다음 일반 공격에 추가합니다. 최대 HP의 50%까지 저장합니다.'),
    a('glenCheers', 2, '든든한 첫잔', 5, 'silver', 'recovery', '글버지를 사용한 뒤 다음 일반 공격을 적중시키면 최대 HP의 10%를 회복합니다.'),
    a('phoenixAsh', 3, '잿더미에서', 20, 'prismatic', 'defense', '탐험 중 한 번, 치명적인 피해를 받으면 HP를 1 남기고 생존하며 불사조와 처형박수의 쿨타임을 초기화합니다. 이후 처음 사용하는 불사조는 최대 HP의 30%를 회복합니다.'),
    a('phoenixEmber', 3, '불사조의 잔불', 5, 'silver', 'recovery', '불사조를 사용한 뒤 다음 일반 공격을 적중시키면 최대 HP의 5%를 회복합니다.'),
    a('manaSpring', 4, '마나의 샘', 4, 'silver', 'recovery', '피아스트를 사용한 뒤 다음 일반 공격을 적중시키면 최대 MP의 10%를 회복합니다.'),
    a('tidalBarrier', 4, '파도 장벽', 10, 'gold', 'defense', '보호막으로 적의 공격을 완전히 막을 때마다 이어브피의 남은 쿨타임을 5초 줄입니다.', 19),
    a('extraClass', 5, '끝나지 않는 수업', 8, 'gold', 'skill', '수업끝을 사용한 뒤 일반 공격을 2회 적중시키면 수업끝의 쿨타임을 초기화합니다.'),
    a('thanksFist', 5, '답례의 주먹', 5, 'silver', 'defense', '수업끝 또는 감사합니다 친구야의 피해 감소 효과가 유지되는 동안 피격되면 수업끝의 남은 쿨타임을 1초 줄입니다.'),
    a('failedEncore', 6, '실패한 앵콜', 8, 'gold', 'critical', 'SUPER EASY에서 치명타가 발생하지 않으면 쿨타임을 초기화합니다. 전투마다 한 번 발동합니다.'),
    a('lastChorus', 6, '마지막 후렴', 15, 'prismatic', 'critical', 'SUPER EASY로 치명타를 2회 발생시키면 KICK BACK의 쿨타임을 초기화하고 다음 KICK BACK을 확정 치명타로 만듭니다.', 15),
    { ...a('jackpotSavings', 7, '한탕 적금', 8, 'gold', 'reward', '백억이요로 적을 5회 처치할 때마다 5성 일반 카드 계약을 획득합니다. 탐험 중 최대 2회 획득합니다.'), cardContract: 'combat' },
    a('riggedJackpot', 7, '조작된 잭팟', 15, 'prismatic', 'skill', '매 전투 처음 사용하는 초특급한탕은 반드시 대박으로 발동합니다.', 22),
    a('sealDividend', 8, '봉인의 대가', 5, 'silver', 'defense', '건력 상태에서 일반 공격을 3회 적중시킬 때마다 현재 최대 HP의 20%만큼 보호막을 생성합니다. 보호막은 8초간 유지하며 기존 효과를 교체합니다.'),
    a('endlessMight', 8, '끝나지 않는 건력', 15, 'prismatic', 'skill', '건력 상태에서 다른 스킬을 사용해도 건력이 해제되지 않습니다. 건력을 다시 사용하면 직접 해제합니다.', 21),
    a('pureChain', 9, '청정한 연쇄', 8, 'gold', 'basic', '청정수 투척을 사용한 뒤 다음 일반 공격은 적의 방어력을 50% 무시합니다.'),
    a('deepSpring', 9, '깊어지는 수맥', 15, 'prismatic', 'skill', '청정수 투척을 3회 사용할 때마다 댄져의 쿨타임을 초기화합니다.', 20),
    a('bribeLedger', 10, '비리 장부', 10, 'gold', 'basic', '비리를 3회 사용할 때마다 다음 일반 공격의 피해량이 2배로 증가합니다.'),
    a('burstReprise', 10, '끝나지 않은 버스트', 15, 'prismatic', 'skill', '54버스트를 사용하면 비리의 쿨타임을 초기화합니다. 이후 처음 사용하는 비리는 MP를 소모하지 않습니다.', 16),
    a('frenziedIktaeBot', 11, '광란의 익테봇', 10, 'gold', 'skill', '익테봇의 공격 속도가 2배로 빨라집니다.'),
    a('solitaryIktae', 11, '고독한 이익태', 15, 'prismatic', 'basic', '스킬을 봉인합니다. 일반 공격 피해량이 100% 증가합니다.'),
    a('threeMoves', 12, '남겨 둔 세 수', 5, 'silver', 'skill', '나인 멘스 모리스를 사용한 뒤 최소 3중첩을 유지합니다.'),
    a('perfectNine', 12, '완벽한 아홉 수', 10, 'gold', 'skill', '9중첩으로 나인 멘스 모리스를 사용하면 쿨타임을 초기화합니다. 전투마다 한 번 발동합니다.'),
    a('willMargin', 13, '유서의 여백', 5, 'silver', 'skill', '유서새김의 지속시간이 2배로 증가합니다.'),
    a('lastSentence', 13, '마지막 문장', 15, 'prismatic', 'skill', '표식이 있는 적에게 범인은 이 안에를 사용하면 표식을 거두고 남은 지속 피해를 다음 일반 공격에 추가합니다.', 27),
    a('doubleDraw', 14, '더블 드로우', 15, 'prismatic', 'skill', '헤즈업을 사용할 때 카드를 연속으로 2장 뽑습니다.'),
    a('lingeringFate', 14, '늘어진 운명', 10, 'gold', 'skill', '헤즈업으로 뽑은 카드의 지속시간이 2배로 증가합니다.'),
    a('guaranteedLucky', 15, '확정 럭키비키', 10, 'gold', 'skill', '모드 전환을 3회 사용할 때마다 럭키비키 모드로 전환합니다.'),
    a('maskCycle', 15, '가면의 순환', 5, 'silver', 'recovery', '기본·즐리·쉐비 모드에서 각각 일반 공격을 적중시키면 최대 HP와 MP의 25%를 회복합니다. 전투마다 한 번 발동합니다.'),
    a('stageHeat', 16, '무대의 열기', 5, 'silver', 'recovery', '아이돌 할래?를 적중시키면 정신력을 추가로 15 회복합니다.'),
    a('emergencyComeback', 16, '앙코르 요청', 15, 'prismatic', 'skill', '아이돌 할래?를 적중시킨 뒤 일반 공격을 3회 적중시키면 해당 스킬의 쿨타임을 초기화하고 다음 아이돌 할래?의 피해량이 2배로 증가합니다.')
];
const BY_ID = new Map(AUGMENTS.map(augment => [augment.id, augment]));
const corridor = () => require('./paradise');
const rpg = () => require('./rpgenius');
const active = user => corridor().active(user) && user.paradise.mode !== 'hell';
const eligible = (user, augment) => Number(user.main_card?.id) === augment.character
    && (augment.requiresSkill == null || rpg().getMainCardSkills(user).some(entry => entry.index === augment.requiresSkill));
const has = (user, id) => active(user) && !!user.paradise.acquired[id] && eligible(user, BY_ID.get(id));
const state = user => user.paradise.battle.characters ||= {};
const direct = extra => !extra.summonAttack && !extra.dotAttack && !extra.isBotAutoAttack;
const notice = (extra, text) => { extra.notice = [extra.notice, text].filter(Boolean).join(' / '); };
function reduceCooldown(user, name, amount = Infinity) {
    const now = Date.now(), until = Number(user.field.skillCooldowns[name] || 0);
    if (until > now) user.field.skillCooldowns[name] = Math.max(now, until - amount);
}
function skillBlocked(user) { return has(user, 'solitaryIktae') ? '고독한 이익태로 스킬이 봉인되어 있습니다.' : null; }
function iktaeInterval(user) { return has(user, 'frenziedIktaeBot') ? 2000 : 4000; }
function freeSkill(user, name) { return has(user, 'burstReprise') && name === '비리' && !!state(user).freeBribe; }
function forceJackpot(user) { return has(user, 'riggedJackpot') && !state(user).jackpotUsed; }
function onSkill(user, skill, stats, extra) {
    if (!active(user)) return;
    const s = state(user), name = skill.name;
    if (name === '자인') {
        if (has(user, 'zainRefrain')) s.zainReady = true;
        if (has(user, 'timeThief') && (s.zainCount = (s.zainCount || 0) + 1) % 3 === 0) { reduceCooldown(user, '유드 알레프'); notice(extra, '시간 도둑 · 유드 알레프 재사용'); }
    }
    if (name === '글버지' && has(user, 'glenCheers')) s.glenReady = true;
    if (name === '불사조') {
        if (has(user, 'phoenixEmber')) s.emberReady = true;
        if (has(user, 'phoenixAsh') && user.paradise.phoenixAshRecovery) { delete user.paradise.phoenixAshRecovery; corridor().heal(user, .30); notice(extra, '잿더미에서 · 생명 회복'); }
    }
    if (name === '피아스트' && has(user, 'manaSpring')) s.manaReady = true;
    if (name === '수업끝' && has(user, 'extraClass')) s.classHits = 0;
    if (name === '초특급한탕' && forceJackpot(user)) s.jackpotUsed = true;
    if (name === '청정수 투척') {
        if (has(user, 'pureChain')) s.pureReady = true;
        if (has(user, 'deepSpring') && (s.waterCount = (s.waterCount || 0) + 1) % 3 === 0) { reduceCooldown(user, '댄져'); notice(extra, '깊어지는 수맥 · 댄져 재사용'); }
    }
    if (name === '비리') {
        if (has(user, 'burstReprise')) s.freeBribe = false;
        if (has(user, 'bribeLedger') && (s.bribeCount = (s.bribeCount || 0) + 1) % 3 === 0) s.bribeReady = true;
    }
    if (name === '54버스트' && has(user, 'burstReprise')) { s.freeBribe = true; reduceCooldown(user, '비리'); notice(extra, '끝나지 않은 버스트 · 비리 재사용'); }
    if (name === '나인 멘스 모리스') s.nmmSpent = Math.min(9, Number(user.field.nmmStacks || 0));
    if (name === '범인은 이 안에' && has(user, 'lastSentence') && user.field.mark?.expired_at > Date.now()) {
        s.lastSentence = Number(user.field.mark.dot || 0) * Math.ceil((user.field.mark.expired_at - Date.now()) / 2000);
        delete user.field.mark;
        notice(extra, '마지막 문장 · 다음 일반 공격에 유서의 피해를 추가합니다.');
    }
}
function afterCooldown(user, name) {
    if (name === '나인 멘스 모리스' && has(user, 'perfectNine') && state(user).nmmSpent === 9 && !state(user).nineUsed) {
        state(user).nineUsed = true; reduceCooldown(user, name);
    }
}
function afterDraw(user, now) {
    if (!has(user, 'lingeringFate')) return;
    const drawn = user.field.ilion?.deck.at(-1);
    if (drawn?.until > now) drawn.until = now + (drawn.until - now) * 2;
}
function afterModeSwitch(user, name, mode) {
    if (!has(user, 'guaranteedLucky') || name !== '모드 전환') return;
    const s = state(user);
    if ((s.switches = (s.switches || 0) + 1) % 3 === 0) user.field.wonyoddi.mode = mode.mode = '럭키비키';
}
function prepareAttack(user, stats, extra) {
    if (!active(user) || !direct(extra)) return;
    const s = state(user);
    if (extra.isBasic && has(user, 'pureChain') && s.pureReady) { s.pureReady = false; extra.defReductionBonus = Number(extra.defReductionBonus || 0) + .50; notice(extra, '청정한 연쇄 · 방어력 무시'); }
    if (extra.skillName === 'KICK BACK' && has(user, 'lastChorus') && s.chorusReady) { s.chorusReady = false; extra.forceCritical = true; notice(extra, '마지막 후렴 · 확정 치명타'); }
}
function modifyHit(user, extra, hit) {
    if (!active(user) || !direct(extra) || hit.finalDamage <= 0) return;
    const s = state(user);
    if (extra.skillName === '아이돌 할래?' && has(user, 'emergencyComeback') && s.kinoEncoreReady) {
        s.kinoEncoreReady = false; hit.finalDamage *= 2;
        for (const detail of hit.hitDetails || []) { detail.damage *= 2; if (detail.fixedDamage) detail.fixedDamage *= 2; }
        notice(extra, '앙코르 요청 · 아이돌 할래? 피해 2배');
    }
    if (!extra.isBasic) return;
    const add = (amount, label) => {
        amount = Math.round(amount);
        if (amount <= 0) return;
        hit.finalDamage += amount;
        (hit.hitDetails ||= []).push({ damage: amount, isCritical: false, label });
        notice(extra, label + ' · 추가 피해 ' + amount.toLocaleString('ko-KR'));
    };
    if (has(user, 'solitaryIktae')) add(hit.finalDamage, '고독한 이익태');
    if (has(user, 'bribeLedger') && s.bribeReady) { s.bribeReady = false; add(hit.finalDamage, '비리 장부'); }
    if (has(user, 'shieldFist') && s.shieldDamage) { add(s.shieldDamage, '방패 속의 주먹'); s.shieldDamage = 0; }
    if (has(user, 'lastSentence') && s.lastSentence) { add(s.lastSentence, '마지막 문장'); s.lastSentence = 0; }
}
function afterHit(user, stats, extra, hit) {
    if (!active(user) || !direct(extra) || hit.finalDamage <= 0) return;
    const s = state(user), now = Date.now(), name = extra.skillName;
    if (extra.isBasic) {
        if (has(user, 'emergencyComeback') && s.kinoEncoreHits != null && ++s.kinoEncoreHits >= 3) {
            delete s.kinoEncoreHits; s.kinoEncoreReady = true; reduceCooldown(user, '아이돌 할래?'); notice(extra, '앙코르 요청 · 아이돌 할래? 재사용');
        }
        if (has(user, 'zainRefrain') && s.zainReady) { s.zainReady = false; reduceCooldown(user, '자인'); notice(extra, '자인 리프레인 · 자인 재사용'); }
        if (has(user, 'endlessFrenzy') && user.field.sivalon?.expired_at > now && (s.frenzyExtension || 0) < 5000) { user.field.sivalon.expired_at += 500; s.frenzyExtension = (s.frenzyExtension || 0) + 500; }
        if (has(user, 'glenCheers') && s.glenReady) { s.glenReady = false; corridor().heal(user, .10); }
        if (has(user, 'phoenixEmber') && s.emberReady) { s.emberReady = false; corridor().heal(user, .05); }
        if (has(user, 'manaSpring') && s.manaReady) { s.manaReady = false; corridor().heal(user, 0, .10); }
        if (has(user, 'extraClass') && s.classHits != null && ++s.classHits >= 2) { delete s.classHits; reduceCooldown(user, '수업끝'); notice(extra, '끝나지 않는 수업 · 수업끝 재사용'); }
        if (has(user, 'sealDividend') && user.field.gunryeok?.expired_at > now && (s.sealHits = (s.sealHits || 0) + 1) % 3 === 0 && !stats.disableShield) {
            require('./combat_shields').grant(user.field, { source: 'paradise:sealDividend', caster: user.name, amount: Math.round(stats.hp * .20), expiresAt: now + 8000 });
            notice(extra, '봉인의 대가 · 보호막 획득');
        }
        if (has(user, 'maskCycle') && !s.maskHealed) {
            s.modes = [...new Set([...(s.modes || []), user.field.wonyoddi?.mode || '기본'])];
            if (['기본', '즐리', '쉐비'].every(mode => s.modes.includes(mode))) { s.maskHealed = true; corridor().heal(user, .25, .25); notice(extra, '가면의 순환 · HP·MP 회복'); }
        }
    }
    if (name === 'SUPER EASY') {
        if (has(user, 'failedEncore') && !hit.criticalCount && !s.encoreUsed) { s.encoreUsed = true; reduceCooldown(user, name); notice(extra, '실패한 앵콜 · SUPER EASY 재사용'); }
        if (has(user, 'lastChorus') && hit.criticalCount) {
            s.chorusCrits = Number(s.chorusCrits || 0) + Number(hit.criticalCount);
            if (s.chorusCrits >= 2) {
                s.chorusCrits %= 2;
                s.chorusReady = true; reduceCooldown(user, 'KICK BACK'); notice(extra, '마지막 후렴 · KICK BACK 준비');
            }
        }
    }
    if (name === '백억이요' && has(user, 'jackpotSavings') && user.paradise.enemy.hp <= 0) {
        const run = user.paradise;
        run.jackpotPrizes ??= run.contracts.filter(c => c.name?.startsWith('한탕 적금')).length;
        if ((run.jackpotKills = (run.jackpotKills || 0) + 1) % 5 === 0 && Number(run.jackpotPrizes || 0) < 2) {
            run.jackpotPrizes = Number(run.jackpotPrizes || 0) + 1;
            run.contracts.push({ star: 5, type: '일반', name: '한탕 적금, 5성 일반 카드' });
            const text = '한탕 적금, 5성 일반 카드 계약을 획득했습니다.';
            run.rewardReveal = { motif: 'contract', positive: true, text };
            run.history.unshift({ floor: run.floor, text });
            notice(extra, text);
        }
    }
    if (name === '아이돌 할래?') {
        if (has(user, 'emergencyComeback')) s.kinoEncoreHits = 0;
        if (has(user, 'stageHeat') && !user.paradise.effects.noHealing) require('./rando_characters').recoverMental(stats, user.field, 15, now);
    }
}
function onDamage(user, stats, absorbed, received) {
    if (!active(user)) return;
    if (absorbed > 0 && has(user, 'shieldFist')) {
        const s = state(user); s.shieldDamage = Math.min(stats.hp * .50, Number(s.shieldDamage || 0) + absorbed * .30);
    }
    if (absorbed > 0 && received === 0 && has(user, 'tidalBarrier')) reduceCooldown(user, '이어브피', 5000);
    if (absorbed + received > 0 && has(user, 'thanksFist') && user.field.buffs?.receivedDamageReduction?.expired_at > Date.now()) reduceCooldown(user, '수업끝', 1000);
}
function survive(user, nextHp) {
    if (nextHp > 0 || !has(user, 'phoenixAsh') || user.paradise.phoenixAshUsed) return nextHp;
    user.paradise.phoenixAshUsed = user.paradise.phoenixAshRecovery = true;
    for (const name of ['불사조', '처형박수']) reduceCooldown(user, name);
    user.paradise.history.unshift({ floor: user.paradise.floor, text: '잿더미에서 · HP 1로 생존했습니다.' });
    return 1;
}
Object.assign(AUGMENTS, { eligible, has, skillBlocked, iktaeInterval, freeSkill, forceJackpot, onSkill, afterCooldown, afterDraw, afterModeSwitch, prepareAttack, modifyHit, afterHit, onDamage, survive });
module.exports = AUGMENTS;
