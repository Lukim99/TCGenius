'use strict';

const shields = require('./combat_shields');
const rpg = () => require('./rpgenius');
const corridor = () => require('./paradise');
const TRAITS = [
    ['subjectMajor', '전공필수', '처음 선택한 장비 전용 증강이 아닌 증강의 분류를 기억합니다. 이후 증강을 고를 때 같은 등급에 해당 분류의 후보가 남아 있다면 하나 이상 제시합니다.', '선택'],
    ['waitingList', '다음 학기 수강신청', '증강을 고른 뒤 선택하지 않은 가장 오른쪽 후보 하나를 예약합니다. 다음에 같은 등급의 선택지가 나오고 획득 조건을 만족하면 다시 제시합니다. 예약은 하나만 보관합니다.', '선택'],
    ['rerollStamp', '꽝도장 모으기', '증강 선택지를 3회 새로고침할 때마다 다음 전투의 첫 직접 공격이 확정 치명타가 되며 적의 방어력을 25% 무시합니다. 탐험마다 최대 4회 준비하며 준비된 효과는 중첩하지 않습니다.', '선택'],
    ['reservedSeat', '좌석 지정제', '왼쪽 증강을 고르면 다음 전투 첫 일반 스킬의 쿨타임이 50% 감소합니다. 가운데를 고르면 첫 일반 공격이 확정 치명타가 됩니다. 오른쪽을 고르면 처음 받는 공격 피해가 50% 감소합니다.', '선택'],
    ['uncutPilgrim', '무편집 순례', '새로고침하지 않고 증강을 선택하면 HP와 MP 중 남은 비율이 낮은 자원을 최대치의 10%만큼 회복합니다. 비율이 같으면 두 자원을 최대치의 5%만큼 회복합니다.', '선택'],
    ['zigzagTicket', '지그재그 승차권', '왼쪽과 오른쪽 길을 번갈아 3회 선택하면 다음 전투에서 처음 받는 공격을 무효화합니다. 같은 쪽을 고르면 연속 횟수를 다시 셉니다. 탐험마다 최대 3회 발동합니다.', '탐험'],
    ['twinDoor', '같은 문 다른 표정', '두 갈림길이 같은 종류의 전투라면 첫 전투의 적을 바꿉니다. 왼쪽 길의 적은 최대 HP가 20% 감소하고 공격력이 15% 증가합니다. 오른쪽 길의 적은 최대 HP가 15% 증가하고 공격력이 20% 감소합니다.', '탐험'],
    ['gimmickWarranty', '기믹 품질보증서', '기믹이 있는 길의 첫 전투에서 최대 HP의 15%만큼 보호막을 8초간 생성합니다. 이 보호막이 피격으로 깨지면 다음 직접 공격이 적의 방어력을 25% 무시합니다.', '탐험'],
    ['eliteWarmup', '정예전 몸풀기', '일반 몬스터를 처치하면 준비를 1회, 최대 3회 저장합니다. 다음 엘리트 전투에서 준비를 모두 소모하여 저장한 횟수만큼 직접 공격의 피해를 20% 증가시킵니다.', '탐험'],
    ['picnicParcel', '소풍 도시락', '이벤트 길을 선택하면 다음 전투를 위한 도시락을 준비합니다. 해당 전투가 시작될 때 최대 HP의 15%만큼 보호막을 15초간 생성합니다. 도시락은 하나만 보관합니다.', '탐험'],
    ['finishWord', '전투 끝말잇기', '직접 공격으로 전투를 마치면 마지막 공격의 종류를 기억합니다. 다음 전투의 첫 직접 공격이 일반 공격과 스킬 중 다른 종류라면 피해가 50% 증가합니다. 같은 종류라면 피해가 10% 감소합니다.', '연계'],
    ['overpack', '과잉 포장 서비스', '직접 공격으로 적을 처치하면 남은 HP를 초과한 피해의 30%를 포장합니다. 다음 전투에서 그만큼 보호막을 12초간 생성하며 최대 HP의 20%까지 포장합니다.', '연계'],
    ['manaLunch', '마나 도시락통', 'MP가 80% 이상 남은 채 승리하면 최대 MP의 15%를 도시락에 보관합니다. 이후 전투에서 직접 공격 후 MP가 20% 이하라면 도시락을 소모하여 보관량을 회복합니다. 최대 MP의 30%까지 보관합니다.', '연계'],
    ['spotlessRations', '흠 없는 비상식량', 'HP 피해 없이 승리하면 비상식량을 1개, 최대 3개 저장합니다. 이후 피격을 버티고 HP가 30% 이하가 되면 식량을 모두 소모하여 하나당 최대 HP의 8%를 회복합니다.', '연계'],
    ['levelBalance', '물과 기름', '전투 중 직접 공격 후 HP와 MP의 남은 비율 중 더 높은 쪽이 서로 뒤바뀌면 다음 직접 공격에 공격력의 200%만큼 고정 피해를 추가합니다. 전투마다 한 번 준비합니다.', '연계'],
    ['awkwardGreeting', '민망한 첫인사', '매 전투 첫 직접 공격의 피해가 50% 감소합니다. 이후 일반 공격과 스킬 중 다른 종류로 공격하면 줄어든 피해의 2배를 고정 피해로 돌려받습니다. 추가 피해는 공격력의 600%를 넘지 않습니다.', '전투'],
    ['singleShell', '단발 탄피 수거', '연격 없이 일반 공격을 적중시키면 공격력의 25%만큼 피해를 저장합니다. 최대 4회 저장하며 다음 직접 사용하는 스킬 공격에 저장한 피해를 고정 피해로 추가합니다.', '전투'],
    ['coldApplause', '식어버린 박수', '직접 공격에서 3회 연속 치명타가 발생하면 다음 직접 공격은 치명타가 발생하지 않는 대신 피해가 2배로 증가합니다. 연격에서 여러 번 치명타가 발생해도 한 번으로 계산합니다.', '전투'],
    ['courteousSpell', '주문부터 양보합니다', '매 전투 처음 직접 사용하는 스킬 공격에서는 치명타가 발생하지 않습니다. 대신 다음 일반 공격은 확정 치명타가 됩니다.', '전투'],
    ['wardCustoms', '보호막 세관', '직접 공격으로 적의 보호막을 깎으면 흡수된 피해의 50%를 보관합니다. 다음 스킬 공격에 고정 피해로 추가하며 공격력의 300%까지 보관합니다. 이 효과가 실린 공격은 피해를 다시 보관하지 않습니다.', '전투'],
    ['softPoisonWard', '독 묻은 솜갑옷', '매 전투 처음 입히는 지속 피해 3회의 피해를 모읍니다. 세 번째 피해를 입히면 합계만큼 보호막을 8초간 생성합니다. 보호막은 최대 HP의 20%를 넘지 않습니다.', '방어'],
    ['pairedDrops', '같은 방울 두 방울', '지속 피해가 연속으로 같은 피해량을 기록하면 두 피해의 합계를 다음 일반 공격에 고정 피해로 추가합니다. 공격력의 300%까지 저장하며 전투마다 최대 3회 준비합니다. 준비된 효과는 중첩하지 않습니다.', '방어'],
    ['meltingUmbrella', '녹아내리는 우산', '전투 시작 시 최대 HP의 8%만큼 보호막을 12초간 생성합니다. 이 보호막을 깨뜨리지 않고 만료시킨 뒤 직접 공격하면 최대 MP의 15%를 회복합니다. 전투마다 한 번 발동합니다.', '방어'],
    ['wardReturn', '방패 반납 창구', '승리할 때 남은 보호막을 반납합니다. 최대 HP에 대한 보호막의 비율만큼 최대 MP를 회복하며 한 전투에서 최대 MP의 20%까지 회복합니다.', '방어'],
    ['thirdRepair', '세 번째 무상수리', '보호막으로 적의 공격을 3회 막으면 그동안 흡수한 피해의 30%만큼 보호막을 10초간 추가합니다. 최대 HP의 15%까지 생성하며 전투마다 한 번 발동합니다.', '방어'],
    ['timeMortgage', '시간 담보 대출', '치명적인 피해를 받을 때 제한 시간이 90초 이상 남았다면 60초를 바쳐 HP를 1 남기고 생존합니다. 최대 HP의 20%만큼 보호막을 10초간 생성하며 탐험마다 한 번 발동합니다.', '운용'],
    ['reverseCooling', '역주행 냉각장치', '실제로 층을 내려가면 다음 전투에서 처음 사용하는 일반 스킬 2회의 쿨타임이 50% 감소합니다. 준비된 효과는 중첩하지 않습니다.', '운용'],
    ['chaosThermometer', '혼돈 온도계', '뒤틀림이 처음 25, 50, 75에 도달할 때마다 냉각판을 1개 얻습니다. 적의 공격을 받으면 하나를 소모하여 받는 피해를 30% 줄입니다. 각 기준에서 탐험마다 한 번씩 얻습니다.', '운용'],
    ['relicWelcome', '새 식구 환영회', '새 일반 유물을 얻은 뒤 처음 시작하는 전투에서 일반 공격 2회가 최소 2연격으로 발동합니다. 여러 유물을 한꺼번에 얻어도 횟수는 늘어나지 않습니다.', '운용'],
    ['oddEvenLuggage', '홀짝 짐 정리', '유물을 하나 이상 보유하면 전투마다 짐을 셉니다. 홀수 개라면 첫 일반 스킬의 쿨타임이 50% 감소합니다. 짝수 개라면 첫 일반 공격의 피해가 35% 증가합니다.', '운용']
].map(([id, name, desc, category]) => ({ id, name, desc, category }));

const active = user => user?.paradise?.status === 'active' && user.paradise.mode !== 'hell' && user.field?.paradise === true;
const has = (user, id) => active(user) && user.paradise.celestial?.traits?.includes(id);
const expedition = user => user.paradise.traitState ||= {};
const battle = user => user.paradise.battle.traits ||= {};
const direct = extra => !extra.dotAttack && !extra.summonAttack && !extra.isBotAutoAttack && !extra.traitProc;
const kind = extra => extra.isBasic ? 'basic' : 'skill';
const resources = user => corridor().getResources(user);
const statsFor = user => rpg().calculateUserStats(user);
const count = (object, key, n = 1) => (object[key] = Number(object[key] || 0) + n);
const generalSkill = (user, name) => !rpg().getUltimateSkills(user).some(entry => entry.skill.name === name);
const notice = (extra, message) => { extra.notice = [extra.notice, message].filter(Boolean).join(' / '); };
function reveal(user, text) {
    const run = user.paradise;
    run.rewardReveal = { motif: 'clarity', positive: true, text: [run.rewardReveal?.text, text].filter(Boolean).join('\n') };
}
function shield(user, id, amount, seconds) {
    if (statsFor(user).disableShield) return 0;
    amount = Math.max(0, Math.round(amount));
    shields.grant(user.field, { source: 'trait:' + id, caster: user.name, amount, expiresAt: Date.now() + seconds * 1000 });
    return amount;
}
function scale(hit, multiplier) {
    hit.finalDamage = Math.round(hit.finalDamage * multiplier);
    for (const detail of hit.hitDetails || []) { detail.damage = Math.round(detail.damage * multiplier); if (detail.fixedDamage) detail.fixedDamage = Math.round(detail.fixedDamage * multiplier); }
}
function add(hit, amount, label) {
    amount = Math.max(0, Math.round(amount));
    if (!amount) return;
    hit.finalDamage += amount;
    (hit.hitDetails ||= []).push({ damage: amount, fixedDamage: amount, label, isCritical: false });
}
function chaos(user) {
    if (!has(user, 'chaosThermometer')) return;
    const e = expedition(user); e.chaosSteps ||= [];
    for (const threshold of [25, 50, 75]) if (user.paradise.distortion >= threshold && !e.chaosSteps.includes(threshold)) {
        e.chaosSteps.push(threshold); count(e, 'coolingPlates');
    }
}
function onEnter(user) { if (active(user)) expedition(user); }
function onChoose(user, choice) {
    if (!active(user)) return;
    const run = user.paradise, e = expedition(user), index = run.choices?.indexOf(choice.id) ?? -1;
    const lines = [];
    if (has(user, 'subjectMajor') && !e.subject && choice.category && !choice.equipment) {
        e.subject = choice.category; lines.push('전공필수, ' + categoryName(e.subject) + ' 분류를 기억합니다.');
    }
    if (has(user, 'waitingList') && !e.waiting) {
        e.waiting = (run.choices || []).filter(id => id !== choice.id).at(-1) || null;
        const name = require('./paradise_content').AUGMENTS?.find(a => a.id === e.waiting)?.name;
        if (name) lines.push('대기명단에 ' + name + ' 증강을 보관합니다.');
    }
    if (has(user, 'reservedSeat') && index >= 0) e.seat = ['spell', 'critical', 'guard'][index];
    if (has(user, 'uncutPilgrim') && !(run.rerolled || []).some(Boolean)) {
        const stats = statsFor(user), r = resources(user), hp = r.hp / stats.hp, mp = stats.mp > 0 ? r.mp / stats.mp : hp;
        corridor().heal(user, hp <= mp ? hp === mp ? .05 : .10 : 0, mp <= hp ? hp === mp ? .05 : .10 : 0);
    }
    if (lines.length) reveal(user, lines.join('\n'));
}
function modifyOffers(user, choices, pool, random = Math.random) {
    if (!active(user)) return choices;
    const e = expedition(user); let reserved = null;
    e.offerProtected = [];
    if (has(user, 'waitingList') && e.waiting && pool.some(a => a.id === e.waiting)) {
        reserved = e.waiting;
        if (!choices.includes(e.waiting) && choices.length) choices[choices.length - 1] = e.waiting;
        delete e.waiting;
    }
    if (has(user, 'subjectMajor') && e.subject && !choices.some(id => pool.some(a => a.id === id && a.category === e.subject))) {
        const candidates = pool.filter(a => a.category === e.subject && !choices.includes(a.id));
        const index = choices.findIndex(id => id !== reserved);
        if (candidates.length && index >= 0) choices[index] = candidates[Math.min(candidates.length - 1, Math.floor(random() * candidates.length))].id;
    }
    if (reserved && choices.includes(reserved)) e.offerProtected.push(reserved);
    if (has(user, 'subjectMajor') && e.subject) {
        const id = choices.find(id => pool.some(a => a.id === id && a.category === e.subject));
        if (id && !e.offerProtected.includes(id)) e.offerProtected.push(id);
    }
    return choices;
}
function onReroll(user) {
    if (!has(user, 'rerollStamp')) return;
    const e = expedition(user);
    if (count(e, 'rerolls') % 3 === 0 && Number(e.stampUses || 0) < 4) {
        count(e, 'stampUses'); e.luckyOpening = true; reveal(user, '꽝도장 완성! 다음 전투의 첫 직접 공격을 강화합니다.');
    }
}
function onRoute(user, route) {
    if (!active(user)) return;
    const e = expedition(user), routes = user.paradise.routes || [], index = routes.findIndex(r => r.id === route.id);
    if (has(user, 'zigzagTicket') && index >= 0 && Number(e.zigzags || 0) < 3) {
        e.zigzagStreak = e.lastSide != null && e.lastSide !== index ? Number(e.zigzagStreak || 0) + 1 : 1;
        e.lastSide = index;
        if (e.zigzagStreak >= 3) { e.zigzagStreak = 0; count(e, 'zigzags'); e.routeGuard = true; }
    }
    if (has(user, 'twinDoor') && routes.length === 2 && routes.every(r => r.kind === route.kind) && ['normal', 'elite'].includes(route.kind)) e.door = index;
    if (has(user, 'gimmickWarranty') && route.gimmick) e.warranty = true;
    if (has(user, 'picnicParcel') && route.kind === 'event') e.picnic = true;
}
function afterMove(user, delta) {
    if (!active(user)) return;
    if (has(user, 'reverseCooling') && delta < 0) expedition(user).reverseCooling = true;
    chaos(user);
}
function scaleDoor(enemy, side) {
    const hpScale = side === 0 ? .80 : 1.15, atkScale = side === 0 ? 1.15 : .80;
    enemy.hp = Math.max(1, Math.round(enemy.hp * hpScale));
    if (enemy.maxHp != null) { enemy.maxHp = Math.max(1, Math.round(enemy.maxHp * hpScale)); enemy.hp = Math.min(enemy.maxHp, enemy.hp); }
    enemy.atk = Math.max(1, Math.round(enemy.atk * atkScale));
}
function previewRoute(user, route, enemy) {
    if (!has(user, 'twinDoor')) return;
    const routes = user.paradise.routes || [], index = routes.findIndex(r => r.id === route.id);
    if (index >= 0 && routes.length === 2 && routes.every(r => r.kind === route.kind) && ['normal', 'elite'].includes(route.kind)) scaleDoor(enemy, index);
}
function onBattle(user) {
    if (!active(user)) return;
    const run = user.paradise, e = expedition(user), s = battle(user), stats = statsFor(user);
    chaos(user);
    if (e.seat) { s.seat = e.seat; delete e.seat; }
    for (const key of ['luckyOpening', 'routeGuard']) if (e[key]) { s[key] = true; delete e[key]; }
    if (e.reverseCooling) { s.reverseCooling = 2; delete e.reverseCooling; }
    if (e.door != null) {
        scaleDoor(run.enemy, e.door);
        run.enemy.recommendedPower = rpg().computeCombatPowerFromStats({ ...run.enemy, hp: run.enemy.maxHp }).total;
        delete e.door;
    }
    if (e.warranty) { if (shield(user, 'warranty', stats.hp * .15, 8) > 0) s.warrantyUntil = Date.now() + 8000; delete e.warranty; }
    if (e.picnic) { shield(user, 'picnic', stats.hp * .15, 15); delete e.picnic; }
    if (has(user, 'eliteWarmup') && run.enemy.kind === 'elite') { s.warmup = Number(e.warmup || 0); e.warmup = 0; }
    if (has(user, 'overpack') && e.package) { shield(user, 'package', Math.min(e.package, stats.hp * .20), 12); delete e.package; }
    if (has(user, 'meltingUmbrella')) { s.umbrellaRemaining = shield(user, 'umbrella', stats.hp * .08, 12); s.umbrellaUntil = Date.now() + 12000; }
    if (has(user, 'relicWelcome')) {
        const normal = require('./paradise_content').RELICS.filter(r => r.rarity === 'normal' && run.relics.includes(r.id)).map(r => r.id);
        e.seenRelics ||= [];
        if (normal.some(id => !e.seenRelics.includes(id))) s.welcome = 2;
        e.seenRelics = [...new Set([...e.seenRelics, ...normal])];
    }
    if (has(user, 'oddEvenLuggage') && run.relics.length) s.luggage = run.relics.length % 2 ? 'spell' : 'basic';
}
function afterCooldown(user, name) {
    if (!active(user) || !generalSkill(user, name)) return;
    const s = battle(user), now = Date.now(); let multiplier = 1;
    if (s.seat === 'spell') { multiplier *= .50; delete s.seat; }
    if (s.reverseCooling > 0) { multiplier *= .50; s.reverseCooling--; }
    if (s.luggage === 'spell') { multiplier *= .50; delete s.luggage; }
    if (user.field.skillCooldowns?.[name] > now) user.field.skillCooldowns[name] = now + Math.round((user.field.skillCooldowns[name] - now) * multiplier);
}
function prepareAttack(user, stats, extra) {
    if (!active(user) || !direct(extra)) return;
    const s = battle(user);
    if (s.luckyOpening) { extra.forceCritical = true; extra.defReductionBonus = Number(extra.defReductionBonus || 0) + .25; delete s.luckyOpening; notice(extra, '꽝도장 개봉'); }
    if (s.warrantyReady) { extra.defReductionBonus = Number(extra.defReductionBonus || 0) + .25; delete s.warrantyReady; }
    if (s.coldReady) { extra.disableCritical = true; stats.ilionForceCritical = false; extra.traitCold = true; delete s.coldReady; }
    if (has(user, 'courteousSpell') && extra.isSkill && !s.courtesyUsed) {
        s.courtesyUsed = true; s.courtesyReady = true; extra.disableCritical = true; stats.ilionForceCritical = false;
    }
    if (extra.isBasic) {
        if (s.seat === 'critical') { extra.forceCritical = true; delete s.seat; }
        if (s.courtesyReady) { extra.forceCritical = true; delete s.courtesyReady; }
        if (s.welcome > 0 && !extra.hitCount) { s.welcome--; extra.comboHitCount = Math.max(2, Number(extra.comboHitCount || 1)); }
    }
    if (has(user, 'meltingUmbrella') && !s.umbrellaPaid && Date.now() >= s.umbrellaUntil) {
        s.umbrellaPaid = true;
        if (s.umbrellaRemaining > 0) { corridor().heal(user, 0, .15); notice(extra, '우산을 지켜 MP를 회복합니다.'); }
    }
    if (has(user, 'levelBalance')) {
        const r = resources(user); extra.traitBalanceBefore = Math.sign(r.hp / stats.hp - (stats.mp > 0 ? r.mp / stats.mp : 0));
    }
}
function modifyHit(user, stats, extra, hit) {
    if (!active(user) || !direct(extra) || hit.finalDamage <= 0) return;
    const s = battle(user), e = expedition(user), type = kind(extra);
    if (!s.firstDirect) {
        s.firstDirect = true;
        if (has(user, 'finishWord') && e.lastFinish) scale(hit, type !== e.lastFinish ? 1.50 : .90);
        if (has(user, 'awkwardGreeting')) { const before = hit.finalDamage; scale(hit, .50); s.greeting = { type, damage: Math.min(stats.atk * 3, before - hit.finalDamage) }; }
    } else if (s.greeting && s.greeting.type !== type) { add(hit, Math.min(stats.atk * 6, s.greeting.damage * 2), '민망한 첫인사'); delete s.greeting; }
    if (extra.traitCold) scale(hit, 2);
    if (s.warmup > 0) { scale(hit, 1.20); s.warmup--; }
    if (s.balanceReady) { add(hit, stats.atk * 2, '물과 기름'); delete s.balanceReady; }
    if (extra.isBasic) {
        if (s.luggage === 'basic') { scale(hit, 1.35); delete s.luggage; }
        if (s.pairedDamage) { add(hit, Math.min(stats.atk * 3, s.pairedDamage), '같은 방울 두 방울'); delete s.pairedDamage; }
    } else {
        if (s.shellDamage) { add(hit, Math.min(stats.atk, s.shellDamage), '단발 탄피 수거'); s.shellDamage = 0; s.shells = 0; }
        if (s.customsDamage) { extra.traitCustomsPaid = true; add(hit, Math.min(stats.atk * 3, s.customsDamage), '보호막 세관'); s.customsDamage = 0; }
    }
}
function afterHit(user, stats, extra, hit) {
    if (!active(user)) return;
    const s = battle(user), e = expedition(user), run = user.paradise;
    if (hit.finalDamage > 0) s.lastDamageDirect = direct(extra);
    if (extra.dotAttack) {
        if (!(hit.finalDamage > 0)) return;
        if (has(user, 'softPoisonWard') && Number(s.poisonTicks || 0) < 3) {
            count(s, 'poisonTicks'); count(s, 'poisonDamage', hit.finalDamage);
            if (s.poisonTicks === 3) shield(user, 'poisonWard', Math.min(stats.hp * .20, s.poisonDamage), 8);
        }
        if (has(user, 'pairedDrops') && Number(s.pairedUses || 0) < 3 && !s.pairedDamage) {
            if (s.lastDrop === hit.finalDamage) { s.pairedDamage = Math.min(stats.atk * 3, hit.finalDamage * 2); count(s, 'pairedUses'); delete s.lastDrop; }
            else s.lastDrop = hit.finalDamage;
        }
        return;
    }
    if (!direct(extra)) return;
    const absorbed = Number(extra.enemyShieldAbsorbed ?? extra.routeShieldAbsorbed ?? 0);
    if (has(user, 'wardCustoms') && absorbed > 0 && !extra.traitCustomsPaid) s.customsDamage = Math.min(stats.atk * 3, Number(s.customsDamage || 0) + absorbed * .50);
    if (!(hit.finalDamage > 0)) return;
    s.lastDirect = kind(extra);
    if (has(user, 'singleShell') && extra.isBasic && Number(hit.comboHitCount || 1) === 1 && Number(s.shells || 0) < 4) { count(s, 'shells'); count(s, 'shellDamage', stats.atk * .25); }
    if (has(user, 'coldApplause')) {
        s.critStreak = hit.criticalCount > 0 ? Number(s.critStreak || 0) + 1 : 0;
        if (s.critStreak >= 3) { s.critStreak = 0; s.coldReady = true; }
    }
    if (has(user, 'overpack') && run.enemy.hp <= 0 && extra.paradiseEnemyHpBefore > 0) e.package = Math.min(stats.hp * .20, Math.max(0, hit.finalDamage - extra.paradiseEnemyHpBefore) * .30);
    if (has(user, 'manaLunch') && e.manaLunch > 0 && resources(user).mp <= stats.mp * .20 && !run.effects.noHealing) {
        const amount = Math.min(stats.mp * .30, e.manaLunch); corridor().heal(user, 0, stats.mp > 0 ? amount / stats.mp : 0); e.manaLunch = 0;
    }
    if (has(user, 'levelBalance') && !s.balanceUsed) {
        const r = resources(user), sign = Math.sign(r.hp / stats.hp - (stats.mp > 0 ? r.mp / stats.mp : 0));
        const previous = s.balanceSign || extra.traitBalanceBefore;
        if (previous && sign && sign !== previous) { s.balanceUsed = true; s.balanceReady = true; }
        if (sign) s.balanceSign = sign;
    }
}
function incomingMultiplier(user, damage) {
    if (!active(user) || damage <= 0) return 1;
    const s = battle(user), e = expedition(user); let multiplier = 1;
    if (s.routeGuard) { delete s.routeGuard; return 0; }
    if (s.seat === 'guard') { delete s.seat; multiplier *= .50; }
    if (has(user, 'chaosThermometer') && e.coolingPlates > 0) { e.coolingPlates--; multiplier *= .70; }
    return multiplier;
}
function onDamage(user, stats, absorbed, lostHp) {
    if (!active(user)) return;
    const s = battle(user), e = expedition(user), now = Date.now();
    if (lostHp > 0) s.hpDamaged = true;
    if (has(user, 'spotlessRations') && e.rations > 0 && lostHp > 0 && resources(user).hp > 0 && resources(user).hp <= stats.hp * .30 && !user.paradise.effects.noHealing) {
        corridor().heal(user, Math.min(3, e.rations) * .08); e.rations = 0;
    }
    if (has(user, 'thirdRepair') && absorbed > 0 && Number(s.repairHits || 0) < 3) {
        count(s, 'repairHits'); count(s, 'repairDamage', absorbed);
        if (s.repairHits === 3) shield(user, 'repair', Math.min(stats.hp * .15, s.repairDamage * .30), 10);
    }
    if (s.umbrellaUntil > now) s.umbrellaRemaining = user.field.shieldLayers?.find(layer => layer.source === 'trait:umbrella')?.amount || 0;
    if (s.warrantyUntil > now && absorbed > 0 && !s.warrantyBroken && !user.field.shieldLayers?.some(layer => layer.source === 'trait:warranty' && layer.amount > 0)) {
        s.warrantyBroken = true; s.warrantyReady = true;
    }
}
function onVictory(user) {
    if (!active(user)) return;
    const run = user.paradise, e = expedition(user), s = battle(user), stats = statsFor(user);
    if (has(user, 'eliteWarmup') && run.enemy.kind === 'normal') e.warmup = Math.min(3, Number(e.warmup || 0) + 1);
    if (has(user, 'finishWord')) e.lastFinish = run.enemy.hp <= 0 && s.lastDirect && s.lastDamageDirect ? s.lastDirect : null;
    if (has(user, 'manaLunch') && resources(user).mp >= stats.mp * .80) e.manaLunch = Math.min(stats.mp * .30, Number(e.manaLunch || 0) + stats.mp * .15);
    if (has(user, 'spotlessRations') && !s.hpDamaged) e.rations = Math.min(3, Number(e.rations || 0) + 1);
    if (has(user, 'wardReturn')) {
        const amount = shields.summary(user.field, Date.now()).amount;
        if (amount > 0) { shields.absorb(user.field, amount); corridor().heal(user, 0, Math.min(.20, amount / stats.hp)); }
    }
}
function survive(user, nextHp, maxHp) {
    if (!has(user, 'timeMortgage') || nextHp > 0 || expedition(user).mortgageUsed) return null;
    const run = user.paradise, now = Date.now(), remaining = corridor().remainingTime(run, now);
    if (remaining < 90000) return null;
    expedition(user).mortgageUsed = true;
    run.clock = { ...run.clock, remainingMs: remaining - 60000, updatedAt: now };
    shield(user, 'mortgage', maxHp * .20, 10); reveal(user, '시간 담보 대출로 60초를 바치고 생존합니다.');
    return 1;
}
function categoryName(id) {
    return ({ dot: '지속 피해', combo: '연격', shield: '보호막', ultimate: '궁극기', skill: '기술', active: '액티브 스킬', passive: '패시브', adventure: '모험', contract: '계약', combat: '전투', stone: '돌 던지기', risk: '위험', basic: '일반 공격', defense: '방어', recovery: '회복', critical: '치명타', exploration: '탐험', reward: '보상' })[id] || id;
}
function view(user) {
    if (!active(user)) return [];
    const e = user.paradise.traitState || {}, s = user.paradise.battle?.traits || {}, result = [];
    const push = (label, value, max) => result.push({ label, value, ...(max == null ? {} : { max }) });
    if (s.luckyOpening || e.luckyOpening) push('꽝도장', '첫 공격 준비');
    if (s.routeGuard || e.routeGuard) push('승차권', '피격 무효 준비');
    if (s.shells) push('단발 탄피', s.shells, 4);
    if (s.customsDamage) push('보호막 세관', Math.round(s.customsDamage));
    if (s.pairedDamage) push('방울 피해', Math.round(s.pairedDamage));
    if (e.manaLunch) push('마나 도시락', Math.round(e.manaLunch));
    if (e.rations) push('비상식량', e.rations, 3);
    if (e.coolingPlates) push('냉각판', e.coolingPlates, 3);
    if (s.warmup || e.warmup) push('정예전 준비', s.warmup || e.warmup, 3);
    if (e.subject) push('전공필수', categoryName(e.subject));
    if (e.waiting) {
        const name = require('./paradise_content').AUGMENTS?.find(a => a.id === e.waiting)?.name;
        if (name) push('대기명단', name);
    }
    return result.slice(0, 4);
}
module.exports = { TRAITS, active, onEnter, onChoose, modifyOffers, onReroll, onRoute, previewRoute, afterMove, onBattle, afterCooldown, prepareAttack, modifyHit, afterHit, incomingMultiplier, onDamage, onVictory, survive, view };
