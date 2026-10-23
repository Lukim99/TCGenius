const catalog = require('./paradise_augments_playful');
const shields = require('./combat_shields');
const rpg = () => require('./rpgenius');
const corridor = () => require('./paradise');
const mechanics = () => require('./paradise_mechanics');
const enabled = user => user.paradise?.status === 'active' && user.paradise.mode !== 'hell';
const combat = user => enabled(user) && user.paradise.phase === 'combat' && !!user.field?.paradise;
const has = (user, id) => enabled(user) && !!user.paradise.acquired?.[id];
const state = user => user.paradise.battle.playful ||= {};
const expedition = user => user.paradise.playfulState ||= {};
const direct = extra => !extra.dotAttack && !extra.summonAttack && !extra.isBotAutoAttack && !extra.paradiseProc;
const count = (s, key, n = 1) => (s[key] = Number(s[key] || 0) + n);
const kind = extra => extra.isBasic ? 'basic' : 'skill';
const labels = { basic: '일반 공격', skill: '스킬' };
const enemyShields = user => user.paradise.enemy.mirror || user.paradise.enemy;
const title = id => catalog.find(entry => entry.id === id)?.name || id;
const notice = (extra, text) => { extra.notice = [extra.notice, text].filter(Boolean).join(' / '); };
const isUltimate = (user, name) => !!name && rpg().getUltimateSkills(user).some(entry => entry.skill.name === name);
function reveal(user, text, positive = true, motif = 'gambler') {
    const run = user.paradise;
    run.rewardReveal = { motif, positive, text: [run.rewardReveal?.text, text].filter(Boolean).join('\n') };
    (run.history ||= []).unshift({ floor: run.floor, text });
}
function shield(user, id, amount, seconds, stats) {
    stats ||= rpg().calculateUserStats(user);
    if (stats.disableShield) return;
    shields.grant(user.field, { source: 'playful:' + id, caster: user.name, amount: Math.round(amount), expiresAt: Date.now() + seconds * 1000 });
}
function delay(user, ms) {
    if (user.paradise.enemy.mirror) user.paradise.enemy.mirror.nextActionAt = Math.max(Date.now(), Number(user.paradise.enemy.mirror.nextActionAt || Date.now() + 4000)) + ms;
    else user.field.nextEnemyAttackAt = Math.max(Date.now(), Number(user.field.nextEnemyAttackAt || Date.now() + 4000)) + ms;
}
function normalCooldowns(user) {
    return Object.entries(user.field.skillCooldowns || {}).filter(([name]) => !isUltimate(user, name));
}
function resetLongest(user) {
    const entry = normalCooldowns(user).filter(([, until]) => until > Date.now()).sort((a, b) => b[1] - a[1])[0];
    if (entry) user.field.skillCooldowns[entry[0]] = Date.now();
}
function bonus(user, id, increment, maximum) {
    const e = expedition(user), before = Number(e[id + 'Bonus'] || 0), added = Math.min(increment, Math.max(0, maximum - before));
    if (!added) return;
    e[id + 'Bonus'] = Math.round((before + added) * 1e9) / 1e9;
    const effects = user.paradise.effects ||= {};
    effects.reward = Number(effects.reward || 0) + added;
    reveal(user, title(id) + '\n종료 보상 +' + Math.round(added * 100) + '%p', true, 'contract');
}
function shuffledDeck(random = Math.random) {
    const deck = [.6, .6, .6, .6, 3.6];
    for (let i = deck.length - 1; i > 0; i--) { const j = Math.min(i, Math.floor(random() * (i + 1))); [deck[i], deck[j]] = [deck[j], deck[i]]; }
    return deck;
}
function onEnter(user) { if (enabled(user)) expedition(user); }
function onChoose(user, choice, random = Math.random) {
    if (!enabled(user)) return;
    const e = expedition(user);
    if (choice.id === 'rouletteBrake') {
        e.rouletteMode = ['gravity', 'fire', 'recoil'][Math.min(2, Math.floor(random() * 3))];
        reveal(user, '룰렛에 손 올리기\n' + { gravity: '중력 당첨: 네 번째 일반 공격에 고정 피해를 추가합니다.', fire: '불꽃 당첨: 세 번째 스킬마다 불꽃을 남깁니다.', recoil: '반동 당첨: HP 피격으로 보호막을 얻습니다.' }[e.rouletteMode]);
    }
    if (has(user, 'rewardReceipt') && choice.id !== 'rewardReceipt' && choice.floors <= 6 && count(e, 'smallSteps') % 3 === 0)
        bonus(user, 'rewardReceipt', .08, .16);
}
function onReroll(user, oldChoice, newChoice, random = Math.random) {
    if (!enabled(user)) return;
    const e = expedition(user);
    if (has(user, 'fortuneReceipt')) e.lotteryTickets = Math.min(3, Number(e.lotteryTickets || 0) + 1);
    if (has(user, 'schrodingerBox') && e.boxWins > 0 && Number(e.boxOpened || 0) < 2) {
        const chance = Math.min(.8, .2 + e.boxWins * .15);
        count(e, 'boxOpened'); e.boxWins = 0;
        if (random() < chance) bonus(user, 'schrodingerBox', .10, .20);
        else { e.boxGuard = true; reveal(user, '열기 전엔 대박입니다\n꽝! 다음 전투의 첫 피격을 무효화합니다.', false); }
    }
}
function onRoute(user, route) {
    if (!enabled(user)) return;
    const e = expedition(user);
    if (has(user, 'windowSeat')) e.seat = user.paradise.routes?.findIndex(entry => entry.id === route.id) === 0 ? 'left' : 'right';
    if (has(user, 'doorPrize') && route.kind === 'event') e.door = true;
    if (has(user, 'misprintedMap') && user.paradise.routes?.length === 2 && user.paradise.routes.every(entry => entry.kind === route.kind)) e.mapGuard = true;
}
function afterMove(user, delta) { if (has(user, 'reverseParking') && delta < 0) expedition(user).parking = true; }
function onBattle(user, random = Math.random) {
    if (!combat(user)) return;
    const s = state(user), e = expedition(user), stats = rpg().calculateUserStats(user);
    s.actionHistory = []; s.basicHits = 0; s.skillHits = 0; s.skillUses = 0;
    if (has(user, 'fortuneReceipt') && e.lotteryTickets > 0) {
        e.lotteryTickets--;
        if (random() < .5) { s.receiptStrike = true; reveal(user, '영수증 뒷면 복권\n당첨! 첫 직접 공격에 공격력의 150%를 추가합니다.'); }
        else { shield(user, 'receipt', stats.hp * .15, 12, stats); reveal(user, '영수증 뒷면 복권\n위로상! 보호막을 얻었습니다.'); }
    }
    if (has(user, 'shoeLaces')) delay(user, 2000);
    if (has(user, 'reverseParking') && e.parking) { s.parking = 2; delete e.parking; }
    if (has(user, 'coldPizza') && e.pizza) { s.pizza = true; delete e.pizza; }
    if (has(user, 'sealedSnack') && e.snack) { s.storedSnack = true; delete e.snack; }
    if (has(user, 'paperAirplane') && e.airMail) { s.airMail = true; delete e.airMail; }
    if (has(user, 'meteorDelivery') && e.meteorMail) { s.meteorMail = true; delete e.meteorMail; }
    if (has(user, 'fingerPuzzle')) {
        const options = [['basic', 'basic', 'skill'], ['basic', 'skill', 'skill'], ['skill', 'skill', 'basic'], ['skill', 'basic', 'basic']];
        s.fingerPattern = options[Math.min(3, Math.floor(random() * options.length))];
    }
    if (has(user, 'windowSeat')) { s.seat = e.seat; s.seatUses = 0; delete e.seat; }
    if (has(user, 'doorPrize') && e.door) { s.doorPlanks = 3; delete e.door; }
    if (has(user, 'misprintedMap') && e.mapGuard) { s.mapGuard = true; delete e.mapGuard; }
    if (has(user, 'schrodingerBox') && e.boxGuard) { s.boxGuard = true; delete e.boxGuard; }
    if (has(user, 'audienceVote') && e.audience) { s.audience = { ...e.audience }; delete e.audience; }
    if (has(user, 'pocketNemesis') && e.nemesis) { s.nemesis = e.nemesis; s.nemesisHits = 3; delete e.nemesis; }
    if (has(user, 'loadedDeck')) s.deck = shuffledDeck(random);
    if (has(user, 'enemyGift')) shields.grant(enemyShields(user), { source: 'playful:gift', caster: user.name, amount: Math.round(stats.atk * 4) });
}
function onSkill(user, name, stats, extra) {
    if (!combat(user)) return;
    const s = state(user), e = expedition(user), ultimate = isUltimate(user, name);
    count(s, 'skillUses'); count(s, 'skillStreak');
    if (has(user, 'hotPotato')) {
        if (s.skillUses === 1) { s.potato = 2; notice(extra, '뜨거운 감자! 일반 공격 두 번으로 넘깁니다.'); }
        else if (s.potato > 0) { const res = corridor().getResources(user); res.hp = Math.max(1, res.hp - Math.round(res.hp * .05)); delete s.potato; notice(extra, '감자를 떨어뜨렸습니다. 현재 HP가 5% 감소합니다.'); }
    }
    if (has(user, 'windowSeat') && s.seat === 'right' && s.seatUses < 2) { s.seatUses++; corridor().heal(user, 0, .05); }
    if (has(user, 'ceasefireTea') && s.skillStreak >= 3 && !s.teaUsed) {
        s.teaUsed = true; corridor().heal(user, .20, .20);
        const enemy = user.paradise.enemy; enemy.hp = Math.min(enemy.maxHp, enemy.hp + Math.round(enemy.maxHp * .10));
        notice(extra, '휴전 티타임! 자신은 HP와 MP 20%, 적은 HP 10%를 회복합니다.');
    }
    if (has(user, 'damagedVending') && s.skillUses <= 3) {
        if (Math.random() < .35) { s.vending = Math.max(2, Number(s.vending || 0)); notice(extra, '자판기 당첨! 다음 일반 공격 피해가 2배가 됩니다.'); }
        else {
            count(s, 'vendingMisses');
            if (s.vendingMisses === 3) { s.vending = 4; notice(extra, '세 번 모두 꽝! 자판기를 털어 다음 일반 공격 피해가 4배가 됩니다.'); }
            else notice(extra, '자판기 꽝 (' + s.vendingMisses + '/3)');
        }
    }
    if (has(user, 'rouletteBrake') && e.rouletteMode === 'fire' && s.skillUses % 3 === 0)
        mechanics().addDot(user, 'playfulFire', '룰렛의 불꽃', stats.atk * .50 * (1 + Number(stats.dotDamage || 0)), 4);
    if (has(user, 'forcedMediation') && !ultimate && s.hpHits > 0 && !s.mediated) {
        s.mediated = true;
        const res = corridor().getResources(user), enemy = user.paradise.enemy;
        const difference = res.hp / stats.hp - enemy.hp / enemy.maxHp, shifted = Math.min(.20, Math.abs(difference) / 2);
        if (difference > 0) { res.hp = Math.max(1, res.hp - Math.round(stats.hp * shifted)); enemy.hp = Math.min(enemy.maxHp, enemy.hp + Math.round(enemy.maxHp * shifted)); }
        else if (difference < 0) { enemy.hp = Math.max(1, enemy.hp - Math.round(enemy.maxHp * shifted)); corridor().heal(user, shifted); }
        notice(extra, '쌍방 과실입니다! HP 비율 ' + (shifted * 100).toFixed(1) + '%p를 중재합니다.');
    }
    if (has(user, 'kitchenSink') && ultimate && !s.kitchenUsed) {
        s.kitchenUsed = true;
        const res = corridor().getResources(user), ward = shields.summary(user.field, Date.now()).amount;
        shields.expire(user.field, Date.now()); shields.absorb(user.field, ward);
        const manaRatio = stats.kino || !stats.mp ? 0 : res.mp / stats.mp;
        if (!stats.kino) res.mp = 0;
        extra.playfulKitchen = Math.min(stats.atk * 20, stats.atk * 10 * manaRatio + ward * 2);
        notice(extra, '있는 거 다 던져! 남은 마나와 보호막을 투척합니다.');
    }
}
function prepareAttack(user, stats, extra) {
    if (!combat(user) || !direct(extra)) return;
    const s = state(user), e = expedition(user), k = kind(extra), pending = extra.playful = { multiplier: 1, fixed: Number(extra.playfulKitchen || 0) };
    const add = amount => { pending.fixed += amount; };
    if (has(user, 'enemyGift') && !s.giftBroken && !shields.active(enemyShields(user), Date.now()).some(layer => layer.source === 'playful:gift')) s.giftBroken = true;
    if (s.glassInvoice && !s.glassPaid && !shields.active(enemyShields(user), Date.now()).some(layer => layer.source === 'playful:glassInvoice')) {
        s.glassPaid = true; resetLongest(user); corridor().heal(user, 0, .15); notice(extra, '파손 비용 정산! 일반 스킬을 초기화합니다.');
    }
    if (s.receiptStrike) { add(stats.atk * 1.5); delete s.receiptStrike; }
    if (s.airMail) { add(stats.atk); delete s.airMail; }
    if (s.meteorMail) { add(stats.atk * 1.5); delete s.meteorMail; }
    if (s.parcelStrike) { add(stats.atk * 2); delete s.parcelStrike; }
    if (s.doorReturn) { add(stats.atk * .8); delete s.doorReturn; }
    if (s.bananaStrike) { pending.multiplier *= 1.4; delay(user, 1000); delete s.bananaStrike; }
    if (s.escapeHits > 0) { s.escapeHits--; corridor().heal(user, .04); add(stats.atk * .8); }
    if (s.rescueHits > 0) { s.rescueHits--; corridor().heal(user, .10); add(stats.atk * 1.5); }
    if (s.noiseStrike) { add(stats.atk * 7); delete s.noiseStrike; }
    if (s.auctionStrike) { add(stats.atk * 7); delete s.auctionStrike; }
    if (s.heistDamage) { add(s.heistDamage); delete s.heistDamage; }
    if (s.snackVoucher) { corridor().heal(user, k === 'basic' ? .06 : 0, k === 'skill' ? .10 : 0); delete s.snackVoucher; }
    if (s.warranty) { if (k === 'basic') corridor().heal(user, .08); else shield(user, 'warranty', stats.hp * .25, 12, stats); delete s.warranty; }
    if (has(user, 'doorbell') && !s.doorbellUsed) { s.doorbellUsed = true; s.doorGuard = true; }
    if (has(user, 'fingerPuzzle') && !s.fingerSolved && [...(s.actionHistory || []).slice(-2), k].join() === s.fingerPattern?.join()) {
        s.fingerSolved = true; add(stats.atk * 2.5); notice(extra, '손가락 접기 성공!');
    }
    if (has(user, 'streetMagician') && Number(s.magicUses || 0) < 2) {
        const last = (s.actionHistory || []).slice(-2);
        if (last.length === 2 && last[0] === last[1] && last[0] !== k) { count(s, 'magicUses'); s.actionHistory = []; pending.multiplier *= 1.8; notice(extra, '소매 속 마술!'); }
    }
    if (has(user, 'troubleLottery') && !s.lotteryPlayed) {
        s.lotteryPlayed = true;
        const chance = Math.min(1, .2 + Number(e.lotteryMisses || 0) * .2);
        if (Math.random() < chance) { e.lotteryMisses = 0; add(stats.atk * 2); notice(extra, '꽝도 모으면 당첨!'); }
        else { count(e, 'lotteryMisses'); notice(extra, '꽝! 다음 전투 당첨 확률 ' + Math.min(100, 20 + e.lotteryMisses * 20) + '%'); }
    }
    if (has(user, 'healthTug') && corridor().getResources(user).hp / stats.hp < user.paradise.enemy.hp / user.paradise.enemy.maxHp) pending.multiplier *= 1.25;
    if (has(user, 'meteorDelivery')) {
        s.meteorAt ||= Date.now() + 12000;
        if (!s.meteorDelivered && Date.now() >= s.meteorAt) { s.meteorDelivered = true; add(stats.atk * 6); notice(extra, '별똥별 배송 완료!'); }
    }
    if (s.applauseHits > 0) { s.applauseHits--; extra.forceCritical = true; }
    if (s.audience?.[k] > 0) { s.audience[k]--; pending.multiplier *= 1.5; }
    if (has(user, 'loadedDeck')) {
        if (!s.deck?.length) s.deck = shuffledDeck();
        const multiplier = s.deck.shift(); pending.multiplier *= multiplier;
        notice(extra, '다음 장은 대박입니다! ' + Math.round(multiplier * 100) + '% 카드');
        if (!s.deck.length) s.deck = shuffledDeck();
    }
    if (has(user, 'pityMachine') && Number(s.pityWins || 0) < 5) {
        const chance = Math.min(1, .1 + Number(s.pityMisses || 0) * .1);
        if (Math.random() < chance) { s.pityMisses = 0; count(s, 'pityWins'); s.pityPenalty = true; add(stats.atk * 5); notice(extra, '천장 당첨! 다음 피격 피해가 20% 증가합니다.'); }
        else { count(s, 'pityMisses'); notice(extra, '천장 ' + Math.min(100, 10 + s.pityMisses * 10) + '%'); }
    }
    if (s.giftBroken && !s.giftClaimed) {
        s.giftClaimed = true;
        if (k === 'basic') corridor().heal(user, .15);
        else pending.multiplier *= 1.75;
        notice(extra, '적에게도 선물이! 선물값을 돌려받습니다.');
    }
    if (k === 'basic') {
        s.skillStreak = 0;
        if (s.vending) { pending.multiplier *= s.vending; delete s.vending; }
        if (has(user, 'hotPotato') && s.potato > 0 && --s.potato === 0) { add(stats.atk * 4); notice(extra, '뜨거운 감자 전달 완료!'); }
        if (has(user, 'bounceHouse') && s.balls > 0) { s.balls--; add(stats.atk * 1.2); }
        if (has(user, 'rouletteBrake') && e.rouletteMode === 'gravity' && (Number(s.basicHits || 0) + 1) % 4 === 0) add(stats.atk * 2);
    } else {
        if (s.pizza) { pending.multiplier *= 1.6; delete s.pizza; }
        if (s.bellReady) { pending.multiplier *= 2; delete s.bellReady; }
        if (has(user, 'blackjackCounter') && s.blackjack > 0) {
            const total = s.blackjack; s.blackjack = 0;
            pending.multiplier *= total === 21 ? 3 : total >= 18 ? 2 : total >= 12 ? 1.4 : 1;
            notice(extra, '블랙잭 ' + total + '점 정산!');
        }
        if (has(user, 'eraserCrumb') && !s.eraserUsed && shields.summary(enemyShields(user), Date.now()).amount > 0) {
            s.eraserUsed = true; shields.expire(enemyShields(user), Date.now());
            const erased = shields.absorb(enemyShields(user), stats.atk * 2).absorbed;
            shield(user, 'eraser', Math.min(stats.hp * .20, erased * .20), 10, stats);
            notice(extra, '지우개 한 조각! 보호막 ' + Math.round(erased).toLocaleString('ko-KR') + '을 지웁니다.');
        }
        if (has(user, 'bounceHouse') && s.balls > 0) {
            mechanics().addDot(user, 'playfulBounce', '트램펄린의 공', stats.atk * .6 * s.balls * (1 + Number(stats.dotDamage || 0)), 3); s.balls = 0;
        }
        if (s.nemesisHits > 0) { s.nemesisHits--; add(Math.min(stats.atk * 3, s.nemesis)); }
        if (has(user, 'cutsceneCoupon') && s.cutsceneDamage && isUltimate(user, extra.skillName)) { add(s.cutsceneDamage); delete s.cutsceneDamage; s.cutsceneUsed = true; }
    }
}
function scaleHit(hit, multiplier) {
    hit.finalDamage = Math.round(hit.finalDamage * multiplier);
    for (const detail of hit.hitDetails || []) {
        detail.damage = Math.round(detail.damage * multiplier);
        if (detail.fixedDamage) detail.fixedDamage = Math.round(detail.fixedDamage * multiplier);
    }
}
function addHit(hit, amount, label) {
    amount = Math.max(0, Math.round(amount));
    if (!amount) return;
    hit.finalDamage += amount;
    (hit.hitDetails ||= []).push({ damage: amount, fixedDamage: amount, isCritical: false, label });
}
function modifyHit(user, stats, extra, hit) {
    if (!combat(user) || !direct(extra) || hit.finalDamage <= 0) return;
    const s = state(user), k = kind(extra);
    if (extra.playful) {
        scaleHit(hit, extra.playful.multiplier);
        addHit(hit, extra.playful.fixed, '천상의 장난');
    }
    // 저장된 추가 피해는 새 적금에 재입금하지 않는다.
    const earnedDamage = Math.max(0, hit.finalDamage - Number(extra.playful?.fixed || 0));
    extra.playfulEarnedDamage = earnedDamage;
    if (has(user, 'sealedEnvelope')) {
        if (hit.criticalCount > 0 && s.envelope > 0) { addHit(hit, s.envelope * 1.5, '봉투 개봉'); s.envelope = 0; }
        else if (!hit.criticalCount) s.envelope = Math.min(stats.atk * 6, Number(s.envelope || 0) + earnedDamage * .20);
    }
    if (has(user, 'doubleEntry')) {
        if (s.entryKind && s.entryKind !== k) { addHit(hit, Math.min(stats.atk * 3, Math.abs(earnedDamage - s.entryDamage) * .5), '균등 정산'); delete s.entryKind; delete s.entryDamage; }
        else { s.entryKind = k; s.entryDamage = earnedDamage; }
    }
    if (has(user, 'damageDiet')) {
        const limit = user.paradise.enemy.maxHp * .08, excess = Math.max(0, hit.finalDamage - limit);
        if (excess > 0) {
            const old = mechanics().dots(user).find(dot => dot.key === 'playfulDiet');
            const total = Math.min(stats.atk * 15, (old ? old.damage * old.ticks : 0) + excess * 1.2);
            scaleHit(hit, limit / hit.finalDamage);
            mechanics().addDot(user, 'playfulDiet', '한입 크기', total / 3, 3, 2000, true);
            notice(extra, '한입 크기로 나눠 담았습니다.');
        }
    }
}
function checkPunchCard(user, stats, extra) {
    const s = state(user);
    if (has(user, 'punchCard') && !s.punched && s.basicHits > 0 && s.skillHits > 0 && s.hpHits > 0) {
        s.punched = true; shield(user, 'punchCard', stats.hp * .15, 12, stats); corridor().heal(user, 0, .05);
        notice(extra, '스탬프 세 개 완성!');
    }
}
function addBoo(user, extra) {
    const s = state(user);
    if (has(user, 'pendingApplause') && !s.applauseUsed && count(s, 'boos') >= 4) {
        s.applauseUsed = true; s.applauseHits = 2; notice(extra, '야유가 환호로! 다음 두 번의 직접 공격은 확정 치명타입니다.');
    }
}
function afterHit(user, stats, extra, hit) {
    if (!combat(user) || !direct(extra) || hit.finalDamage <= 0 || corridor().getResources(user).hp <= 0) return;
    const s = state(user), k = kind(extra), enemy = user.paradise.enemy;
    count(s, k === 'basic' ? 'basicHits' : 'skillHits'); count(s, 'directHits');
    s.actionHistory = [...(s.actionHistory || []), k].slice(-3);
    checkPunchCard(user, stats, extra);
    if (has(user, 'fragileParcel') && !s.parcelResolved && s.directHits >= 3) { s.parcelResolved = true; s.parcelStrike = true; notice(extra, '파손 없이 배송 완료!'); }
    if (has(user, 'paperAirplane') && k === 'skill' && s.skillHits === 2 && enemy.hp > 0)
        mechanics().addDot(user, 'playfulAirplane', '종이비행기', stats.atk * 1.6 * (1 + Number(stats.dotDamage || 0)), 1);
    if (has(user, 'refundStamp') && enemy.hp <= 0 && extra.paradiseEnemyHpBefore > 0 && Math.max(0, hit.finalDamage - extra.paradiseEnemyHpBefore) <= enemy.maxHp * .05) {
        corridor().heal(user, .10, .10); notice(extra, '깔끔한 마무리! HP와 MP를 10% 회복합니다.');
    }
    if (has(user, 'windowSeat') && s.seat === 'left' && s.seatUses < 2 && k === 'basic') { s.seatUses++; corridor().heal(user, .03); }
    if (has(user, 'blackjackCounter') && k === 'basic') {
        const drawn = 1 + Math.min(5, Math.floor(Math.random() * 6));
        s.blackjack = Number(s.blackjack || 0) + drawn;
        if (s.blackjack > 21) { notice(extra, '블랙잭 ' + s.blackjack + '점! 초과하여 MP 8%를 회복합니다.'); s.blackjack = 0; corridor().heal(user, 0, .08); }
        else notice(extra, '+' + drawn + ', 블랙잭 ' + s.blackjack + '점');
    }
    if (has(user, 'goldenBell') && !s.bellUsed && extra.paradiseEnemyHpBefore > 0) {
        const crossed = [.8, .6, .4, .2].filter(band => extra.paradiseEnemyHpBefore > enemy.maxHp * band && enemy.hp <= enemy.maxHp * band);
        if (crossed.length) {
            s.bellBands ||= [];
            if (!s.bellBands.includes(crossed[0])) s.bellBands.push(crossed[0]);
            if (s.bellBands.length === 4) { s.bellUsed = true; s.bellReady = true; shield(user, 'goldenBell', stats.hp * .25, 15, stats); notice(extra, '골든벨! 다음 스킬 피해가 2배가 됩니다.'); }
        }
    }
    if (has(user, 'pendingApplause') && k === 'skill' && !hit.criticalCount) addBoo(user, extra);
    if (s.doorPlanks > 0) { const index = 4 - s.doorPlanks--; shield(user, 'door' + index, stats.hp * .05, 12, stats); }
    if (has(user, 'enemyGift') && !s.giftBroken && !shields.active(enemyShields(user), Date.now()).some(layer => layer.source === 'playful:gift')) s.giftBroken = true;
    if (s.glassInvoice && !s.glassPaid && !shields.active(enemyShields(user), Date.now()).some(layer => layer.source === 'playful:glassInvoice')) {
        s.glassPaid = true; resetLongest(user); corridor().heal(user, 0, .15); notice(extra, '파손 비용 정산! 일반 스킬을 초기화합니다.');
    }
    if (has(user, 'noisyNeighbors') && !s.noiseUsed) {
        s.noiseStreak = s.lastKind === k ? Number(s.noiseStreak || 0) + 1 : 1;
        if (s.noiseStreak >= 5) { s.noiseUsed = true; s.noiseStrike = true; s.noisePenalty = true; notice(extra, '옆방에서 항의합니다! 큰 한 방과 큰 반격이 준비됩니다.'); }
    }
    s.lastKind = k;
    if (has(user, 'phaseExchange') && !s.phaseChanged && extra.paradiseEnemyHpBefore > enemy.maxHp * .5 && enemy.hp <= enemy.maxHp * .5 && enemy.hp > 0) {
        s.phaseChanged = true; normalCooldowns(user).forEach(([name]) => { user.field.skillCooldowns[name] = Date.now(); });
        corridor().heal(user, .20); enemy.atk = Math.round(enemy.atk * 1.30);
        if (enemy.mirror) enemy.mirror.snapshot.stats.atk = enemy.atk;
        notice(extra, '나도 2페이즈! 일반 스킬을 초기화하고 HP 20%를 회복합니다.');
    }
    if (has(user, 'cutsceneCoupon') && !s.cutsceneRecorded && k === 'skill' && !isUltimate(user, extra.skillName) && hit.criticalCount > 0) {
        s.cutsceneRecorded = true; s.cutsceneDamage = Math.min(stats.atk * 20, Number(extra.playfulEarnedDamage ?? hit.finalDamage) * .8); notice(extra, '명장면을 저장했습니다. 다음 궁극기에 재생합니다.');
    }
    if (has(user, 'theHeist') && !s.heistUsed && s.basicHits >= 3 && s.skillHits >= 2 && enemy.hp > 0) {
        s.heistUsed = true; const stolen = enemy.atk * .20;
        enemy.atk = Math.round(enemy.atk * .80); enemy.def = Math.round(enemy.def * .80);
        if (enemy.mirror) { enemy.mirror.snapshot.stats.atk = enemy.atk; enemy.mirror.snapshot.stats.def = enemy.def; }
        s.heistDamage = Math.min(stats.atk * 5, stolen * 3); shield(user, 'heist', stats.hp * .20, 12, stats);
        notice(extra, '도둑단 작전 성공! 적의 공격력과 방어력이 20% 감소합니다.');
    }
}
function incomingMultiplier(user, damage) {
    if (!combat(user) || damage <= 0) return 1;
    const s = state(user); let multiplier = 1;
    if (s.boxGuard) { delete s.boxGuard; return 0; }
    if (s.mapGuard) { delete s.mapGuard; s.mapPenalty = 2; return 0; }
    if (s.mapPenalty > 0) { s.mapPenalty--; multiplier *= 1.2; }
    if (s.parking > 0) { s.parking--; multiplier *= .7; }
    if (s.doorGuard) { delete s.doorGuard; s.doorReturn = true; multiplier *= .7; }
    if (s.noisePenalty) { delete s.noisePenalty; multiplier *= 1.5; }
    if (s.pityPenalty) { delete s.pityPenalty; multiplier *= 1.2; }
    if (has(user, 'healthTug')) {
        const stats = rpg().calculateUserStats(user), enemy = user.paradise.enemy;
        if (corridor().getResources(user).hp / stats.hp > enemy.hp / enemy.maxHp) multiplier *= .8;
    }
    if (has(user, 'scarecrowAuction') && Number(s.auctionAttacks || 0) < 3) {
        multiplier *= 1.3; if (count(s, 'auctionAttacks') === 3) s.auctionArrived = true;
    }
    return multiplier;
}
function onDamage(user, stats, absorbed, lostHp, shieldBefore, extra = {}) {
    if (!combat(user)) return;
    const s = state(user), e = expedition(user), alive = corridor().getResources(user).hp > 0;
    const broken = shieldBefore > 0 && absorbed > 0 && shields.summary(user.field, Date.now()).amount <= 0;
    if (has(user, 'bounceHouse') && absorbed > 0) s.balls = Math.min(3, Number(s.balls || 0) + 1);
    if (broken) {
        if (has(user, 'wardWarranty') && !s.warrantyUsed) { s.warrantyUsed = true; s.warranty = true; }
        if (has(user, 'breakGlass') && !s.glassInvoice) {
            s.glassInvoice = true;
            shields.grant(enemyShields(user), { source: 'playful:glassInvoice', caster: user.name, amount: Math.round(stats.hp * .10) });
        }
    }
    if (s.auctionArrived && alive) { delete s.auctionArrived; s.auctionStrike = true; shield(user, 'auction', stats.hp * .30, 15, stats); notice(extra, '경매 낙찰! 큰 반격을 준비합니다.'); }
    if (lostHp <= 0) return;
    count(s, 'hpHits');
    if (s.envelope) s.envelope *= .50;
    if (!alive) return;
    if (has(user, 'snackVoucher') && s.hpHits === 1) s.snackVoucher = true;
    if (has(user, 'fragileParcel') && !s.parcelResolved) { s.parcelResolved = true; corridor().heal(user, 0, .10); notice(extra, '택배 파손! MP 10%를 돌려받습니다.'); }
    if (s.storedSnack) { delete s.storedSnack; corridor().heal(user, .10); }
    if (has(user, 'rottenBanana') && s.hpHits % 2 === 0 && Number(s.bananaUses || 0) < 2) { count(s, 'bananaUses'); s.bananaStrike = true; }
    if (has(user, 'escapeArtist') && !s.escapeUsed && corridor().getResources(user).hp <= stats.hp * .35) { s.escapeUsed = true; s.escapeHits = 2; }
    if (has(user, 'rescuePunch') && !s.rescueUsed && lostHp >= stats.hp * .20) { s.rescueUsed = true; s.rescueHits = 3; }
    if (has(user, 'rouletteBrake') && e.rouletteMode === 'recoil' && s.hpHits <= 2) shield(user, 'rouletteRecoil', stats.hp * .15, 10, stats);
    addBoo(user, extra); checkPunchCard(user, stats, extra);
}
function onVictory(user) {
    if (!combat(user)) return;
    const s = state(user), e = expedition(user), stats = rpg().calculateUserStats(user);
    if (has(user, 'coldPizza') && !s.skillUses) e.pizza = true;
    if (has(user, 'sealedSnack') && corridor().getResources(user).hp >= stats.hp * .90) e.snack = true;
    if (has(user, 'paperAirplane') && mechanics().dots(user).some(dot => dot.key === 'playfulAirplane')) e.airMail = true;
    if (has(user, 'meteorDelivery') && s.meteorAt && !s.meteorDelivered) e.meteorMail = true;
    if (has(user, 'audienceVote')) e.audience = s.basicHits > s.skillHits ? { skill: 2 } : s.skillHits > s.basicHits ? { basic: 2 } : { basic: 1, skill: 1 };
    if (has(user, 'pocketNemesis') && user.paradise.enemy.kind === 'elite') e.nemesis = user.paradise.enemy.atk;
    if (has(user, 'schrodingerBox') && Number(e.boxOpened || 0) < 2) count(e, 'boxWins');
}
function view(user) {
    if (!enabled(user)) return [];
    const s = user.paradise.battle?.playful || {}, e = user.paradise.playfulState || {}, out = [];
    if (has(user, 'loadedDeck') && s.deck?.length) out.push({ label: '다음 피해 카드', value: Math.round(s.deck[0] * 100) + '%' });
    if (has(user, 'blackjackCounter')) out.push({ label: '블랙잭', value: Number(s.blackjack || 0), max: 21 });
    if (has(user, 'fingerPuzzle') && s.fingerPattern && !s.fingerSolved) out.push({ label: '손가락 순서', value: s.fingerPattern.map(entry => labels[entry]).join(' → ') });
    if (has(user, 'fingerPuzzle') && s.fingerPattern && !s.fingerSolved && s.actionHistory?.length) out.push({ label: '최근 입력', value: s.actionHistory.map(entry => labels[entry]).join(' → ') });
    if (has(user, 'hotPotato') && s.potato > 0) out.push({ label: '감자 전달', value: 2 - s.potato, max: 2 });
    if (has(user, 'schrodingerBox') && Number(e.boxOpened || 0) < 2) out.push({ label: '상자 당첨 확률', value: Math.min(80, 20 + Number(e.boxWins || 0) * 15) + '%' });
    if (has(user, 'pityMachine') && Number(s.pityWins || 0) < 5) out.push({ label: '다음 천장 확률', value: Math.min(100, 10 + Number(s.pityMisses || 0) * 10) + '%' });
    if (has(user, 'goldenBell') && !s.bellUsed) out.push({ label: '골든벨', value: Number(s.bellBands?.length || 0), max: 4 });
    if (has(user, 'sealedEnvelope') && s.envelope > 0) out.push({ label: '봉투에 보관', value: Math.round(s.envelope).toLocaleString('ko-KR') });
    return out;
}
module.exports = { onEnter, onChoose, onReroll, onRoute, afterMove, onBattle, onSkill, prepareAttack, modifyHit, afterHit, incomingMultiplier, onDamage, onVictory, view };
