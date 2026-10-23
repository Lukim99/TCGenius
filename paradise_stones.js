const catalog = require('./paradise_augments_stones');
const shields = require('./combat_shields');
const power = require('./paradise_power');
const rpg = () => require('./rpgenius');
const corridor = () => require('./paradise');
const mechanics = () => require('./paradise_mechanics');
const NAME = '돌 던지기';
const FLAT_DAMAGE = new Map(catalog.map(augment => [augment.id, augment.stoneFlatDamage]));
const flatDamage = user => Object.keys(user.paradise?.acquired || {}).reduce((sum, id) => sum + (user.paradise.acquired[id] ? FLAT_DAMAGE.get(id) || 0 : 0), 0);
const own = (user, id) => !!user.paradise?.acquired?.[id];
const active = user => corridor().active(user) && user.paradise.mode !== 'hell' && user.paradise.phase === 'combat' && !!user.field?.paradise && own(user, 'stoneThrow');
const has = (user, id) => active(user) && own(user, id);
const state = user => user.paradise.battle.stones ||= {};
const expedition = user => user.paradise.stoneState ||= {};
const manual = extra => !extra.dotAttack && !extra.summonAttack && !extra.isBotAutoAttack && !extra.stoneSecondary;
const count = (s, key, value = 1) => (s[key] = Number(s[key] || 0) + value);
const notice = (extra, text) => { extra.notice = [extra.notice, text].filter(Boolean).join(' / '); };
const packet = (extra, ratio, label, options = {}) => (extra.stonePackets ||= []).push({ ratio, label, ...options });
const ammoMax = user => has(user, 'stoneHeavyAmmo') ? 4 : 3;
const towerMax = user => has(user, 'stoneAvalanche') ? 10 : has(user, 'stoneLeaning') ? 4 : 5;
const orbitMax = user => has(user, 'stoneLagrange') ? 5 : 3;
const digTarget = user => has(user, 'stoneBrush') ? 2 : 3;
const ultimate = (user, name) => rpg().getUltimateSkills(user).some(entry => entry.skill.name === name);
function load(user, amount = 1) { const s = state(user); s.ammo = Math.min(ammoMax(user), Number(s.ammo || 0) + amount); }
function stack(user, amount = 1) { const s = state(user); s.tower = Math.min(towerMax(user), Number(s.tower || 0) + amount); }
function orbit(user, amount = 1) { const s = state(user); s.orbits = Math.min(orbitMax(user), Number(s.orbits || 0) + amount); }
function ward(user, id, ratio, seconds = 10, stats = rpg().calculateUserStats(user)) {
    if (stats.disableShield) return;
    shields.grant(user.field, { source: 'paradise:stone:' + id, caster: user.name,
        amount: Math.round(stats.hp * ratio * (1 + Number(stats.shieldEfficiency || 0))), expiresAt: Date.now() + seconds * 1000 });
}
function hpCost(user, ratio) {
    const resources = corridor().getResources(user), before = resources.hp;
    if (before <= 1) return false;
    resources.hp = Math.max(1, before - Math.max(1, Math.floor(before * ratio)));
    return true;
}
function reward(user, id, amount, max, extra) {
    const e = expedition(user), before = Number(e[id] || 0), granted = Math.min(amount, Math.max(0, max - before));
    if (!granted) return;
    e[id] = Math.round((before + granted) * 1e9) / 1e9;
    const run = user.paradise;
    run.effects.reward = Math.round((Number(run.effects.reward || 0) + granted) * 1e9) / 1e9;
    const text = catalog.find(a => a.id === id).name + ' 종료 보상 +' + Math.round(granted * 100) + '%p';
    if (extra) notice(extra, text);
    else { run.history.unshift({ floor: run.floor, text }); run.rewardReveal = { motif: 'contract', positive: true, text }; }
}
function reduceOther(user, ms) {
    const now = Date.now(), cooldowns = user.field.skillCooldowns;
    const names = rpg().getMainCardSkills(user).filter(entry => !ultimate(user, entry.skill.name)).map(entry => entry.skill.name)
        .concat(mechanics().skills(user).map(entry => entry.name)).filter(name => name !== NAME);
    const entry = Object.entries(cooldowns).filter(([name, until]) => names.includes(name) && until > now).sort((a, b) => b[1] - a[1])[0];
    if (entry) cooldowns[entry[0]] = Math.max(now, entry[1] - ms);
}
function eligible(user, choice) {
    if (choice.category !== 'stone') return true;
    return (choice.stoneRequires || []).every(id => own(user, id))
        && (!choice.stoneRequiresAny?.length || choice.stoneRequiresAny.some(id => own(user, id)))
        && !(choice.stoneExcludes || []).some(id => own(user, id));
}
function skill(user) { return active(user) ? { id: 'stoneThrow', name: NAME, ratio: 0, mp_cost: 0, cooldown: 2000, cooltime: 2000, stoneSkill: true } : null; }
function skillView(user) {
    if (!active(user)) return [];
    return [{ name: NAME, element: null, mpCost: 0, resourceLabel: 'MP', cooldownEnd: Number(user.field.skillCooldowns[NAME] || 0),
        cooltimeText: has(user, 'stoneRailgun') ? '6초' : '2초', descLines: [`마나를 소모하지 않고 공격력의 ${has(user, 'stonePolish') ? 40 : 10}%만큼 피해를 입히며 고정 피해 ${(flatDamage(user) * (has(user, 'stoneRailgun') ? 3 : 1)).toLocaleString('ko-KR')}을 추가합니다.`, '돌 강화의 추가 투사체는 공격력 비례 피해가 10% 증가하며 공격력 100%당 고정 피해 4,000을 추가합니다.'], augmentSkill: true, stoneSkill: true }];
}
function onChoose(user, choice) {
    if (choice.category !== 'stone') return;
    const e = expedition(user);
    if (choice.isStoneEntry) e.branches = [...new Set([...(e.branches || []), choice.stoneBranch])];
}
function onBattle(user) {
    if (!active(user)) return;
    const e = expedition(user);
    user.paradise.battle.stones = { casts: 0, actions: 0, queue: [], ammo: has(user, 'stonePocket') ? 2 : 0,
        tower: has(user, 'stoneTower') ? 2 + Number(e.carriedTower || 0) : 0, orbits: has(user, 'stoneOrbit') ? 1 : 0,
        dig: has(user, 'stoneCrate') ? Number(e.carriedDig || 0) : 0, gem: has(user, 'stoneCrate') ? Number(e.carriedGem || 0) : 0,
        carriedDamage: Number(e.carriedDamage || 0) };
    delete e.carriedTower; delete e.carriedDig; delete e.carriedGem; delete e.carriedDamage;
}
function deliver(user, item, extra) {
    packet(extra, item.ratio, item.label, { critical: item.critical, element: item.element, pierce: item.pierce });
    if (item.kind !== 'time') return;
    const s = state(user);
    if (has(user, 'stoneElementTime')) packet(extra, 1, '제철 돌', { element: item.element || '화' });
    if (has(user, 'stoneTimeBank')) packet(extra, .8, '과거의 도탄');
    if (has(user, 'stoneHourglass') && count(s, 'delivered') % 3 === 0 && Number(s.deliveryPrizes || 0) < 3) {
        count(s, 'deliveryPrizes'); user.field.skillCooldowns[NAME] = Date.now(); ward(user, 'delivery', .10);
        notice(extra, '배송 완료! 돌 던지기를 다시 사용할 수 있습니다.');
    }
}
function enqueue(user, extra, ratio, actions, options = {}) {
    const s = state(user), kind = options.kind || 'time';
    s.queue ||= [];
    const same = s.queue.filter(item => item.kind === kind);
    if (same.length >= 4) { const first = same[0]; s.queue.splice(s.queue.indexOf(first), 1); deliver(user, first, extra); }
    const item = { id: count(s, 'queueId'), ratio, remaining: actions + 1, label: '시간의 돌', kind, sourceCast: s.casts, ...options };
    s.queue.push(item);
    return item;
}
function demolish(user, stats, extra, leaning = false) {
    const s = state(user), blocks = Number(s.tower || 0);
    if (!blocks) return;
    s.tower = has(user, 'stoneKeystone') ? 1 : 0;
    packet(extra, blocks * (leaning ? .9 : .7), '돌탑 붕괴');
    if (has(user, 'stoneQuake')) packet(extra, blocks * .4, '층간 소음', { pierce: .30 });
    if (has(user, 'stoneBell') && blocks >= 3 && Number(s.bellUses || 0) < 5) {
        count(s, 'bellUses'); corridor().heal(user, 0, .05); reduceOther(user, 2000);
    }
    if (has(user, 'stoneCathedral') && blocks >= 5) { ward(user, 'cathedral', .20, 12, stats); corridor().heal(user, .05); }
    if (has(user, 'stoneTowerGuard')) ward(user, 'demolish', Math.min(.30, blocks * .03), 10, stats);
    if (has(user, 'stoneTowerDice')) {
        if (power.random(user) < .5) { stack(user, 2); notice(extra, '철거 뽑기 당첨! 돌 두 개를 다시 쌓았습니다.'); }
        else { corridor().heal(user, .08); notice(extra, '철거 뽑기 실패, HP를 8% 회복합니다.'); }
    }
    notice(extra, '돌탑 ' + blocks + '개 붕괴!');
}
function rollDice(user, stats, extra, fullAmmo) {
    const s = state(user), die = () => Math.min(6, 1 + Math.floor(power.random(user) * 6));
    let face, forced = false;
    if (has(user, 'stoneSiegeDice') && fullAmmo && Number(s.siegeRigged || 0) < 2) { count(s, 'siegeRigged'); face = 6; forced = true; }
    else if (has(user, 'stoneHouseWins')) face = (Number(s.casts || 1) - 1) % 6 + 1;
    else if (s.cashout) { face = 4; s.cashout = false; ward(user, 'cashout', .10, 10, stats); forced = true; }
    else if (s.sixReady) { face = 6; s.sixReady = false; s.badDice = 0; forced = true; }
    else {
        face = die();
        if (has(user, 'stoneRoulette')) {
            const second = die();
            if (face === second) packet(extra, 2, '더블 주사위');
            face = Math.max(face, second);
        }
    }
    if (!forced && face === 1 && has(user, 'stoneLoadedDice')) { hpCost(user, .03); face = 6; }
    const rates = [.2, .4, .8, 1.2, 2, has(user, 'stoneHouseWins') ? 10 : 4];
    packet(extra, rates[face - 1], '주사위 ' + face);
    notice(extra, '주사위 ' + face + (face === 6 ? '! 대박입니다.' : '이 나왔습니다.'));
    if (face <= 2) {
        if (has(user, 'stonePity') && count(s, 'badDice') >= 3) s.sixReady = true;
        if (has(user, 'stoneInsurance') && Number(s.insuranceUses || 0) < 3) { count(s, 'insuranceUses'); corridor().heal(user, .03); }
    }
    if (has(user, 'stoneOddEven')) {
        if (s.lastDie && s.lastDie % 2 !== face % 2) { packet(extra, .7, '홀짝 적중'); if (count(s, 'parityStreak') >= 5) { s.sixReady = true; s.parityStreak = 0; } }
        else s.parityStreak = 0;
    }
    if (has(user, 'stoneStreak') && s.lastDie === face) s.streakStrike = 1.8;
    if (face === 6) {
        if (has(user, 'stoneCashOut')) s.cashout = true;
        if (has(user, 'stoneJackpot') && count(s, 'sixes') >= 2 && !s.jackpot) { s.jackpot = true; packet(extra, 8, '육육 잭팟'); notice(extra, '육육 잭팟!'); }
        if (has(user, 'stoneHouseWins')) reward(user, 'stoneHouseWins', .01, .10, extra);
    }
    s.lastDie = face;
}
function elementCast(user, stats, extra) {
    const s = state(user), all = ['화', '수', '명', '암'];
    let element = has(user, 'stoneVolcano') ? '화' : has(user, 'stoneEclipse') ? ['명', '암'][(s.casts - 1) % 2] : all[(s.casts - 1) % 4];
    if (has(user, 'stoneWeather') && !s.rained && corridor().getResources(user).hp <= stats.hp * .30) {
        element = '수'; s.rained = true; corridor().heal(user, .10); notice(extra, '소나기가 내려 HP를 회복했습니다.');
    }
    packet(extra, 1, element + '속성 돌', { element, critical: !!s.elementCritical, pierce: Number(s.elementPierce || 0) });
    s.elementCritical = false; s.elementPierce = 0;
    if (element === '화') extra.stoneBurn = has(user, 'stoneEmber') ? .40 : .20;
    if (element === '수') {
        const fullMp = corridor().getResources(user).mp >= stats.mp;
        corridor().heal(user, .02);
        if (has(user, 'stoneRain')) { if (fullMp) ward(user, 'rain', .05, 10, stats); else corridor().heal(user, 0, .05); }
        if (has(user, 'stoneSteam') && s.lastElement === '화') packet(extra, 2.4, '뜨거운 증기', { element: '수' });
    }
    if (element === '명') { s.elementCritical = true; if (has(user, 'stoneThunder')) s.thunder = true; }
    if (element === '암') {
        s.elementPierce = .20;
        if (has(user, 'stoneObsidian')) s.obsidianGuard = true;
        if (has(user, 'stoneEclipse')) packet(extra, 2, '일식', { element: '암', pierce: .25 });
    }
    if (has(user, 'stoneVolcano') && s.casts % 3 === 0) packet(extra, 5, '화산 분화', { element: '화' });
    if (has(user, 'stonePrismLens') && s.lastElement && s.lastElement !== element) s.prismStrike = element;
    s.lastElement = element; extra.stoneElement = element;
    s.elements = [...new Set([...(s.elements || []), element])];
    if (has(user, 'stoneElementDig') && s.elements.length === 4 && !s.elementDig) { s.elementDig = true; excavate(user, stats, extra, true); }
}
function excavate(user, stats, extra, single = false) {
    const s = state(user), names = has(user, 'stoneTrap') ? ['화석', '보석', '호박', '함정'] : ['화석', '보석', '호박'];
    const draws = !single && has(user, 'stoneGoldRush') ? 2 : 1;
    if (draws === 2) hpCost(user, .05);
    for (let i = 0; i < draws; i++) {
        const index = has(user, 'stoneSurvey') ? count(s, 'survey') - 1 : Math.floor(power.random(user) * names.length);
        const found = names[index % names.length];
        notice(extra, found + ' 발굴!');
        s.finds = [...new Set([...(s.finds || []), found])];
        if (found === '화석') {
            packet(extra, 3, '발굴한 화석');
            if (has(user, 'stoneFossil')) s.fossilStrike = true;
            if (has(user, 'stoneDigOrbit')) orbit(user, 2);
        } else if (found === '보석') {
            s.gem = Math.min(6, Number(s.gem || 0) + 3);
            if (has(user, 'stoneGem')) reward(user, 'stoneGem', .02, .10, extra);
        } else if (found === '호박') {
            ward(user, 'amber' + i, .10, 10, stats);
            if (has(user, 'stoneAmber')) corridor().heal(user, .05, .05);
        } else { hpCost(user, .05); packet(extra, 6, '고대 함정'); }
    }
    if (has(user, 'stoneMuseum') && !s.broadcast && ['화석', '보석', '호박'].every(name => s.finds.includes(name))) {
        s.broadcast = true; packet(extra, 9, '발굴 생중계'); corridor().heal(user, .10);
        reward(user, 'stoneMuseum', .03, .12, extra); notice(extra, '발굴 생중계 대성공!');
    }
}
function cast(user, stats, extra) {
    if (!active(user)) return 0;
    const s = state(user), e = expedition(user), n = count(s, 'casts');
    extra.stoneCast = true; extra.hitCount = 1; extra.stoneCastNumber = n;
    packet(extra, 0, '돌 던지기', { fixed: flatDamage(user) * (has(user, 'stoneRailgun') ? 3 : 1), stoneBase: true });
    extra.stoneBranch = (e.branches || []).filter(branch => catalog.some(a => a.isStoneEntry && a.stoneBranch === branch && own(user, a.id))).at(-1) || 'shared';
    const oldWard = shields.summary(user.field, Date.now()).amount;
    if (has(user, 'stonePolish') && n === 1 || has(user, 'stoneCritTicket') && s.noCrit >= 4) { extra.forceCritical = true; s.noCrit = 0; }
    if (has(user, 'stoneAlternator') && s.lastAction === 'basic') extra.defReductionBonus = Number(extra.defReductionBonus || 0) + .30;
    if (s.carriedDamage) { packet(extra, 0, '남는 힘 택배', { fixed: Math.min(s.carriedDamage, stats.atk * 3) }); s.carriedDamage = 0; }
    if (s.gem) { packet(extra, s.gem, '발굴한 보석'); s.gem = 0; }
    if (has(user, 'stoneBloodBond') && hpCost(user, .02)) packet(extra, 1.2, '피의 돌');
    if (has(user, 'stoneManaVault') && n % 3 === 0) {
        if (corridor().getResources(user).mp >= stats.mp) ward(user, 'mana', .05, 10, stats); else corridor().heal(user, 0, .05);
    }
    if (has(user, 'stonePetRock') && !s.petAwake) { s.petAwake = true; s.petWokeAt = Number(s.actions || 0) + 1; }
    if (has(user, 'stoneBankShot')) {
        let shots = has(user, 'stonePinball') ? Array(6).fill(.5) : [.4, .6, .8];
        if (has(user, 'stoneCushion')) shots.push(.4);
        if (has(user, 'stoneSpareCue') && n === 1) shots.push(1.2);
        if (has(user, 'stoneTrickRail') && user.paradise.enemy.hp >= user.paradise.enemy.maxHp * .5) shots.push(1);
        if (has(user, 'stoneComboRail')) { shots.push(...Array(Number(s.railCombos || 0)).fill(.6)); s.railCombos = 0; }
        const chalk = !!s.chalk; s.chalk = false;
        if (has(user, 'stoneBilliardOrbit') && shots.length >= 5 && !has(user, 'stoneStraightShot')) orbit(user);
        const lastCritical = has(user, 'stoneCornerPocket') && n % 3 === 0;
        if (has(user, 'stoneStraightShot')) packet(extra, shots.reduce((a, b) => a + b, 0) * 1.5, '직선 관통탄', { pierce: chalk ? .50 : .30, critical: lastCritical });
        else shots.forEach((ratio, i) => packet(extra, ratio, '도탄 ' + (i + 1), { pierce: chalk ? .50 : has(user, 'stoneTrickRail') && shields.summary(user.paradise.enemy, Date.now()).amount > 0 && i === shots.length - 1 ? .50 : 0, critical: lastCritical && i === shots.length - 1 }));
        if (has(user, 'stoneEightBall') && n % 8 === 0 && Number(s.blackBalls || 0) < 3) { count(s, 'blackBalls'); packet(extra, 6, '검은 공'); }
    }
    let fullAmmo = false;
    if (has(user, 'stonePocket')) {
        const ammo = Number(s.ammo || 0); fullAmmo = ammo >= ammoMax(user); s.ammo = 0;
        if (has(user, 'stoneRailgun')) packet(extra, ammo * 1.8, '투석 관통탄', { pierce: .75 });
        else if (has(user, 'stoneShotgun')) for (let i = 0; i < ammo * 3; i++) packet(extra, .4 + (has(user, 'stoneHeavyAmmo') ? .1 : 0), '장전 산탄');
        else if (ammo) packet(extra, ammo * (.9 + (has(user, 'stoneHeavyAmmo') ? .30 : 0)), '장전 투석');
        if (!ammo && has(user, 'stoneDryFire')) { packet(extra, 1, '빈 주머니'); load(user); }
        if (fullAmmo && has(user, 'stoneFuse')) enqueue(user, extra, ammo * .8, 2, { kind: 'fuse', label: '불발탄' });
        if (ammo >= 3 && has(user, 'stoneShrapnel')) for (let i = 0; i < 3; i++) packet(extra, .4, '투석 파편');
        if (fullAmmo && has(user, 'stoneRecoil')) s.recoil = 1.5;
    }
    if (has(user, 'stoneTower')) {
        stack(user, has(user, 'stoneAvalanche') ? 2 : 1);
        if (has(user, 'stoneMortar') && n === 1) { stack(user); ward(user, 'mortar', .06, 10, stats); }
        if (has(user, 'stoneLeaning') && s.tower >= 4) demolish(user, stats, extra, true);
    }
    if (has(user, 'stoneDice')) rollDice(user, stats, extra, fullAmmo);
    if (has(user, 'stoneSeasons')) elementCast(user, stats, extra);
    if (has(user, 'stoneOrbit')) {
        const before = Number(s.orbits || 0);
        if (has(user, 'stoneBlackHole') && before >= 3) { s.orbits = 0; packet(extra, before * 2.2, '사건의 지평선', { element: '암' }); corridor().heal(user, before * .03); }
        else if (has(user, 'stoneMeteor') && before >= orbitMax(user)) { s.orbits = 0; packet(extra, before, '위성 추락'); orbit(user); }
        else orbit(user);
    }
    if (has(user, 'stoneDig')) {
        packet(extra, .8, '발굴 타격');
        if (count(s, 'dig') >= digTarget(user)) { s.dig = 0; excavate(user, stats, extra); }
    }
    if (has(user, 'stoneGuard')) {
        if (has(user, 'stoneGolem') && s.counter > 0) {
            shields.expire(user.field, Date.now()); shields.absorb(user.field, oldWard);
            packet(extra, 0, '골렘의 오른손', { raw: Math.min(stats.atk * 8, oldWard * 2) }); corridor().heal(user, .03);
        } else if (has(user, 'stoneSlingShield') && oldWard > 0) {
            const spent = oldWard * .20; shields.expire(user.field, Date.now()); shields.absorb(user.field, spent);
            packet(extra, 0, '방벽 투척', { raw: Math.min(stats.atk * 3, spent) });
        }
        if (s.counter > 0) {
            packet(extra, 0, '돌 반격', { raw: Math.min(stats.atk * 3.5, s.counter) }); s.counter = 0; extra.stoneCounter = true;
            if (has(user, 'stoneRevenge') && Number(s.blocks || 0) >= 3) { s.blocks -= 3; packet(extra, 8, '세 번 참은 돌'); }
        }
        if (s.splinters > 0) { s.splinters--; packet(extra, 1, '부서진 방패'); }
        ward(user, 'guard', .08, 8, stats);
    }
    if (s.obsidianStrike) { s.obsidianStrike = false; packet(extra, 1.8, '흑요석의 앙심', { element: '암' }); }
    if (has(user, 'stoneTime')) {
        let ratio = has(user, 'stonePendulum') ? 4 : 2, actions = 2;
        if (has(user, 'stoneEarlyBird') && n === 1) actions = 1;
        if (has(user, 'stonePendulum') && n % 2 === 1) packet(extra, 2.5, '오늘의 돌');
        else {
            if (has(user, 'stoneDelay')) { ratio *= 1.75; actions++; }
            enqueue(user, extra, ratio, actions, { element: extra.stoneElement || null });
        }
        if (has(user, 'stoneMeteorShower')) {
            const merge = s.queue.filter(item => item.kind === 'time' && !item.meteor).slice(0, 3);
            if (merge.length === 3) {
                s.queue = s.queue.filter(item => !merge.includes(item));
                enqueue(user, extra, merge.reduce((sum, item) => sum + item.ratio, 0) * 1.5, 3, { meteor: true, label: '예약 운석', element: merge.at(-1).element });
                notice(extra, '시간의 돌 세 개가 거대한 운석으로 합쳐졌습니다.');
            }
        }
    }
    const slot = rpg().calculateCardSlotEffects(user);
    return Math.max(0, stats.atk * (has(user, 'stonePolish') ? .40 : .10) * (1 + Number(stats.afterSkill || 0) + Number(slot.skillDamageBonus || 0)));
}
function onSkill(user, name, stats, extra = {}) {
    if (!active(user) || !ultimate(user, name)) return;
    const s = state(user);
    if (has(user, 'stoneCounterweight') && !s.ultimateLoad) { s.ultimateLoad = true; load(user, ammoMax(user)); notice(extra, '궁극기로 돌을 모두 장전했습니다.'); }
    if (has(user, 'stoneLaunchpad') && !s.ultimateOrbit) { s.ultimateOrbit = true; orbit(user, orbitMax(user)); notice(extra, '위성을 보유 한도까지 띄웠습니다.'); }
    if (has(user, 'stoneAfterimage') && !s.ultimateTime) {
        s.ultimateTime = true;
        for (const item of state(user).queue || []) if (item.kind === 'time') item.remaining = 2;
        enqueue(user, extra, 3, 1, { label: '궁극기의 잔상' });
    }
}
function afterCooldown(user, name) {
    if (!active(user) || name !== NAME) return;
    const minimum = has(user, 'stoneRailgun') ? 6000 : 500;
    user.field.skillCooldowns[NAME] = Math.max(Number(user.field.skillCooldowns[NAME] || 0), Date.now() + minimum);
}
function prepareAttack(user, stats, extra) {
    if (!active(user) || !manual(extra)) return;
    const s = state(user); count(s, 'actions');
    const queued = s.queue || []; s.queue = [];
    for (const item of queued) {
        item.remaining--;
        if (item.remaining <= 0) deliver(user, item, extra); else s.queue.push(item);
    }
    if (s.petAwake && s.actions > s.petWokeAt && has(user, 'stonePetRock') && (s.actions - s.petWokeAt) % 3 === 0 && Number(s.petHits || 0) < 3) {
        count(s, 'petHits'); packet(extra, 3, '애완돌 산책');
    }
    if (!extra.isBasic) return;
    if (s.recoil) { packet(extra, s.recoil, '반동 휘두르기'); s.recoil = 0; }
    if (s.streakStrike) { packet(extra, s.streakStrike, '같은 눈금'); s.streakStrike = 0; }
    if (s.thunder) { packet(extra, 1.8, '돌려준 번개', { element: '명' }); s.thunder = false; }
    if (s.prismStrike) { packet(extra, 1.6, '쪼개진 빛', { element: s.prismStrike }); s.prismStrike = null; }
    if (s.fossilStrike) { packet(extra, 1.8, '깨어난 화석'); extra.forceCritical = true; s.fossilStrike = false; }
    if (has(user, 'stoneTower')) {
        const threshold = has(user, 'stoneAvalanche') ? 6 : has(user, 'stoneCathedral') ? 5 : 3;
        if (s.tower >= threshold) demolish(user, stats, extra);
    }
    if (has(user, 'stoneOrbit') && s.orbits > 0) {
        const many = has(user, 'stoneSolarSystem') ? s.orbits : 1;
        if (has(user, 'stoneLagrange') && s.orbits >= 3 && Number(s.orbitMana || 0) < 3) { count(s, 'orbitMana'); corridor().heal(user, 0, .05); }
        s.orbits = has(user, 'stoneSolarSystem') ? 1 : s.orbits - 1;
        for (let i = 0; i < many; i++) packet(extra, has(user, 'stoneSolarSystem') ? 1.1 : 1.6, '돌 위성');
        if (has(user, 'stoneMoonDust')) extra.stoneDust = true;
    }
    if (has(user, 'stoneSpareHand') && count(s, 'offHandBasics') % 3 === 0) packet(extra, 1.5, '왼손의 돌');
    if (has(user, 'stoneTimeline') && (s.queue || []).filter(item => item.kind === 'time').length === 1 && Number(s.timelineClones || 0) < 3) {
        count(s, 'timelineClones'); enqueue(user, extra, 1, 1, { label: '평행세계의 돌' });
    }
}
function prepareHit(user, stats, extra, hit) {
    if (!active(user) || !manual(extra) || !extra.stonePackets?.length) return;
    const enemy = user.paradise.enemy, target = enemy.mirror ? { ...enemy, ...require('./pvp').getCorridorMirrorStats(enemy.mirror) } : enemy;
    const slots = rpg().calculateCardSlotEffects(user);
    // 부가 투사체는 피해 계산만 한다. 공격/스킬 사용 함수를 재호출하지 않는다.
    for (const item of extra.stonePackets) {
        let amount, fixedDamage = 0, critical = false, destiny = false;
        if (item.fixed != null) { amount = Math.max(0, Math.round(item.fixed)); fixedDamage = amount; }
        else {
            const bonus = enemy.kind === 'normal' ? Number(stats.damageBonus || 0) + Number(slots.damageBonus || 0) : enemy.kind === 'elite' ? Number(stats.eliteDmg || 0) : Number(stats.bossDmg || 0);
            const base = item.raw != null ? item.raw * 1.10 : stats.atk * item.ratio * 1.10;
            const result = rpg().calculateAttackHitResult(base * Math.max(0, 1 + Number(stats.afterSkill || 0) + Number(slots.skillDamageBonus || 0)) * Math.max(0, 1 + bonus),
                Math.max(0, Number(target.def || 0) - Number(stats.atkDefReduce || 0)), Number(stats.pnt || 0), stats, slots,
                { hitCount: 1, isSkill: true, summonAttack: true, stoneSecondary: true, attackElement: item.element || extra.attackElement || null,
                    ...(power.context(user) ? { powerPreview: true, random: power.context(user).random } : {}),
                    forceCritical: !!item.critical, defReductionBonus: Number(item.pierce || 0) }, target);
            const multiplier = Number(extra.paradiseAttackMultiplier ?? 1);
            amount = Math.max(0, Math.round(result.finalDamage * multiplier)); critical = result.criticalCount > 0;
            fixedDamage = Math.min(amount, Math.round((result.hitDetails || []).reduce((sum, detail) => sum + Number(detail.fixedDamage || 0), 0) * multiplier));
            destiny = result.destinyDamageCount > 0;
            const flat = Math.round((item.ratio || 0) * 4000 * multiplier);
            amount += flat; fixedDamage += flat;
            if (power.context(user) && item.pierce) {
                const pen = 1 + Number(stats.pnt || 0) / 280, rate = Math.min(1, Number(stats.pntPercent || 0) + Number(slots.defReduction || 0));
                amount = fixedDamage + Math.round((amount - fixedDamage) * (pen + Math.min(1, rate + item.pierce) * .5) / (pen + rate * .5));
            }
        }
        if (item.stoneBase) { amount = Math.round(amount * Number(extra.paradiseAttackMultiplier ?? 1)); fixedDamage = amount; }
        if (!(amount > 0)) continue;
        hit.finalDamage += amount;
        const parts = fixedDamage > 0 && fixedDamage < amount
            ? [{ damage: amount - fixedDamage, label: item.label, fixed: false }, { damage: fixedDamage, label: '돌 강화 고정 피해', fixed: true }]
            : [{ damage: amount, label: item.label, fixed: fixedDamage === amount }];
        for (const part of parts) {
            (hit.hitDetails ||= []).push({ damage: part.damage, fixedDamage: part.fixed ? part.damage : 0, isCritical: !part.fixed && critical, isDestinyDamage: !part.fixed && destiny, label: part.label, stoneSecondary: true });
            (hit.damageComponents ||= []).push({ ...part, type: 'additional', isCritical: !part.fixed && critical, stoneSecondary: true });
        }
    }
}
function afterHit(user, stats, extra, hit) {
    if (!active(user) || !manual(extra) || hit.finalDamage <= 0) return;
    const s = state(user);
    if (extra.stoneBurn) mechanics().addDot(user, 'stoneBurn', '돌의 화상', stats.atk * extra.stoneBurn * (1 + Number(stats.dotDamage || 0)), 3, 2000);
    if (extra.stoneDust) mechanics().addDot(user, 'stoneDust', '달가루', stats.atk * .20 * (1 + Number(stats.dotDamage || 0)), 3, 2000);
    if (extra.stoneCast) {
        if (hit.criticalCount > 0) {
            s.noCrit = 0;
            if (has(user, 'stoneEcho')) for (const item of s.queue || []) if (item.kind === 'time' && item.sourceCast === extra.stoneCastNumber) item.critical = true;
        } else if (has(user, 'stoneCritTicket')) count(s, 'noCrit');
        if (extra.stoneCounter && has(user, 'stoneFortress') && count(s, 'counters') % 3 === 0 && Number(s.fortressUses || 0) < 3) {
            count(s, 'fortressUses'); ward(user, 'fortress', .20, 12, stats); s.fortressGuard = true;
        }
        if (has(user, 'stoneOverkill') && user.paradise.enemy.hp <= 0) {
            const excess = Math.max(0, hit.finalDamage - Number(extra.paradiseEnemyHpBefore || 0));
            expedition(user).carriedDamage = Math.min(stats.atk * 3, excess * .30);
        }
    }
    if (extra.isBasic) {
        if (has(user, 'stonePocket')) { load(user); if (has(user, 'stoneQuickLoad') && hit.criticalCount > 0) load(user); }
        if (has(user, 'stoneChalk')) s.chalk = true;
        if (has(user, 'stoneComboRail')) s.railCombos = Math.min(3, Number(s.railCombos || 0) + Math.max(0, Number(hit.comboHitCount || 1) - 1));
        if (has(user, 'stoneMoss') && s.counter > 0 && Number(s.mossUses || 0) < 3) { count(s, 'mossUses'); corridor().heal(user, .03); }
    }
    if (has(user, 'stoneRetrograde')) {
        const kind = extra.isBasic ? 'basic' : extra.stoneCast ? 'stone' : 'other';
        s.retrograde = [...(s.retrograde || []), kind].slice(-3);
        if (s.retrograde.join(',') === 'basic,stone,basic') { orbit(user); s.retrograde = []; }
    }
    s.lastAction = extra.isBasic ? 'basic' : extra.stoneCast ? 'stone' : 'other';
}
function incomingMultiplier(user) {
    if (!active(user)) return 1;
    const s = state(user); let multiplier = 1;
    if (has(user, 'stoneGravity') && s.orbits >= 3) multiplier *= .8;
    if (has(user, 'stoneSatelliteShield') && s.orbits > 0) { s.orbits--; multiplier *= .7; }
    if (s.obsidianGuard) { s.obsidianGuard = false; s.obsidianStrike = true; multiplier *= .75; }
    if (s.fortressGuard) { s.fortressGuard = false; multiplier *= .5; }
    const waiting = (s.queue || []).filter(item => item.kind === 'time').sort((a, b) => a.remaining - b.remaining);
    if (has(user, 'stonePause') && waiting.length && Number(s.pauseUses || 0) < 3) {
        count(s, 'pauseUses'); multiplier *= .8; waiting[0].remaining = Math.max(1, waiting[0].remaining - 1);
    }
    return multiplier;
}
function onDamage(user, stats, absorbed, lostHp, shieldBefore, extra = {}) {
    if (!active(user)) return;
    const s = state(user), broken = shieldBefore > 0 && absorbed > 0 && shields.summary(user.field, Date.now()).amount <= 0;
    if (absorbed > 0 && has(user, 'stoneGuard')) {
        const factor = has(user, 'stoneParry') && lostHp <= 0 ? 2.5 : 1.5;
        s.counter = Math.min(stats.atk * 3.5, stats.atk * factor + absorbed * .5);
        s.blocks = Math.min(3, Number(s.blocks || 0) + 1);
        if (has(user, 'stoneGuardSiege')) load(user);
    }
    if (broken && has(user, 'stoneSplinter')) { s.splinters = 3; notice(extra, '방패에서 돌 파편 세 개를 얻었습니다.'); }
    if (lostHp > 0) {
        if (has(user, 'stoneRepair')) stack(user);
        if (has(user, 'stoneSpite')) s.counter = Math.min(stats.atk * 3.5, Number(s.counter || 0) + stats.atk);
    }
    if (has(user, 'stoneLastStand') && !s.lastStand && lostHp > 0 && corridor().getResources(user).hp > 0 && corridor().getResources(user).hp <= stats.hp * .30) {
        s.lastStand = true; ward(user, 'lastStand', .25, 10, stats);
    }
}
function onVictory(user) {
    if (!active(user)) return;
    const s = state(user), e = expedition(user);
    if (has(user, 'stoneWelcome') && s.tower >= 3) e.carriedTower = 1;
    if (has(user, 'stoneCrate')) { e.carriedDig = Math.min(digTarget(user) - 1, Number(s.dig || 0)); e.carriedGem = s.gem ? 3 : 0; }
    if (has(user, 'stoneLuckyReceipt') && user.paradise.enemy.kind === 'elite' && s.casts >= 3) reward(user, 'stoneLuckyReceipt', .03, .15);
}
function view(user) {
    if (!active(user)) return [];
    const s = state(user), result = [];
    if (has(user, 'stonePocket')) result.push({ label: '장전', value: Number(s.ammo || 0), max: ammoMax(user) });
    if (has(user, 'stoneTower')) result.push({ label: '돌탑', value: Number(s.tower || 0), max: towerMax(user) });
    if (has(user, 'stoneDice') && s.lastDie) result.push({ label: '눈금', value: s.lastDie, max: 6 });
    if (has(user, 'stoneSeasons') && s.lastElement) result.push({ label: '속성', value: s.lastElement });
    if (has(user, 'stoneOrbit')) result.push({ label: '위성', value: Number(s.orbits || 0), max: orbitMax(user) });
    if (has(user, 'stoneDig')) result.push({ label: '발굴', value: Number(s.dig || 0), max: digTarget(user) });
    if (has(user, 'stoneGuard') && s.counter > 0) result.push({ label: '반격', value: '준비' });
    if (has(user, 'stoneTime')) result.push({ label: '배송', value: (s.queue || []).filter(item => item.kind === 'time').length, max: 4 });
    return result;
}
module.exports = { NAME, active, has, eligible, skill, skillView, flatDamage, onChoose, onBattle, cast, onSkill, afterCooldown, prepareAttack, prepareHit, afterHit, incomingMultiplier, onDamage, onVictory, view };
