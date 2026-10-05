// 생일 이벤트의 판정만 담당한다. 전투, 피해와 관문 전환은 공통 레이드 엔진을 사용한다.
const ID = 'lukimBirthday2026';
const START = Date.parse('2026-10-06T00:00:00+09:00');
const END = Date.parse('2026-10-07T00:00:00+09:00');
const CLAIM = 'lukimBirthday2026Reward';

function available(now = Date.now()) { return now >= START && now < END; }
function admissionError(id, now) {
    return id === ID && !available(now) ? '루킴의 생일파티는 10월 6일에만 입장할 수 있습니다.' : null;
}

function createBirthdayRaid(ctx) {
    const alive = ctx.getAliveMembers;
    const pick = list => list[Math.floor(Math.random() * list.length)];
    function event(mon, kind, duration, extra = {}) {
        const st = mon.bossState;
        const ev = { id: 'birthday:' + kind + ':' + (++st.serial), kind, effect: kind, duration,
            startedAt: Date.now(), remain: duration, ...extra };
        st.events.push(ev);
        return ev;
    }
    function init(def) {
        return { birthday: true, candles: def.name === '생일 케이크', elapsed: 0, serial: 0,
            events: [], lit: [], responses: [], candle: 0, stage: 'lighting',
            cakeAt: 3, stealAt: 27, codeAt: 70, frenzyDone: false, giftDone: false };
    }
    function onSpawn(room, mon) {
        const st = mon.bossState;
        if (st.candles) {
            event(mon, 'birthdayCandles', null, { label: '촛불', remain: null });
        } else {
            st.stage = 'battle';
            if (room.phaseTransition?.presentation === 'birthdayThrow') throwCake(room, mon, true);
        }
    }
    function throwCake(room, mon, opening = false) {
        return event(mon, 'birthdayThrow', 1.45, { label: '케이크 투척', opening, impactDelay: .6,
            ...(opening ? { startedAt: room.phaseTransition.startedAt } : {}),
            stage: 'flying', targets: alive(room).map(m => m.name) });
    }
    function cakeImpact(room, ev) {
        if (ev.stage === 'resolved') return;
        ev.stage = 'resolved';
        ev.impactAt = Date.now();
        for (const m of alive(room)) ctx.applyFixedDamageToMember(room, m, Math.max(1, Math.round(m.runtime.hpMax * .025)), '루킴 [케이크 투척]');
    }
    function transition(room) {
        if (room.phaseTransition?.presentation !== 'birthdayThrow') return false;
        const ev = room.monster?.bossState?.events.find(e => e.kind === 'birthdayThrow' && e.opening);
        if (!ev) return false;
        const age = Math.max(0, (Date.now() - ev.startedAt) / 1000);
        ev.remain = Math.max(0, ev.duration - age);
        if (age >= ev.impactDelay) cakeImpact(room, ev);
        return true;
    }
    function fail(room, reason) { ctx.wipeParty(room, reason, reason + ': 파티 전멸'); }
    function lightAttack(room, member) {
        const mon = room.monster, st = mon?.bossState;
        if (!st?.birthday || !st.candles) return null;
        if (st.stage !== 'lighting') return { ok: true, damage: 0 };
        const centre = 3 + st.candle * 3;
        const elapsed = st.elapsed + Math.max(0, Date.now() - (st.updatedAt || Date.now())) / 1000;
        if (elapsed >= centre - .75 && elapsed <= centre + .75 && !st.responses.includes(member.name)) {
            st.responses.push(member.name);
            event(mon, 'birthdaySpark', .35, { candle: st.candle });
            if (alive(room).every(m => st.responses.includes(m.name)) && !st.lit.includes(st.candle)) {
                st.lit.push(st.candle);
                ctx.pushCombat(room, '촛불 ' + (st.candle + 1) + ' 점화', 'info');
            }
            ctx.broadcastRoom(room);
        }
        return { ok: true, damage: 0 };
    }
    function action(room, name, payload) {
        const mon = room.monster, st = mon?.bossState;
        const member = ctx.findMember(room, name);
        if (!st?.birthday || !member?.runtime || member.runtime.dead) return { error: '행동할 수 없습니다.' };
        const ev = st.events.find(e => e.id === payload.eventId && e.remain > 0 && Date.now() < e.startedAt + e.duration * 1000);
        if (!ev || room.state !== 'inProgress') return { error: '종료된 패턴입니다.' };
        if (ev.kind === 'birthdayClap' && payload.action === 'clap') {
            if (!ev.responded.includes(name)) ev.responded.push(name);
            if (alive(room).every(m => ev.responded.includes(m.name))) {
                st.stage = 'celebrate';
                st.events = [event(mon, 'birthdayCelebrate', .8, { label: '생일 축하', responded: ev.responded.slice() })];
            }
        } else if (ev.kind === 'birthdayGift' && payload.action === 'gift') {
            if (ev.responded.includes(name)) return { ok: true };
            const potion = (member.potions || []).find(p => p.count > 0 && (!payload.potion || p.name === payload.potion));
            if (!potion) return { error: '건넬 물약이 없습니다.' };
            potion.count--;
            ev.responded.push(name);
            ev.gifts.push({ by: name, name: potion.name });
            ctx.pushCombat(room, name + ' → 루킴 [' + potion.name + '] 선물', 'info');
        } else return { error: '사용할 수 없는 행동입니다.' };
        ctx.broadcastRoom(room);
        return { ok: true };
    }
    function interceptDamage(room, mon, damage, hits = 1) {
        const st = mon?.bossState;
        if (!st?.birthday) return null;
        if (st.candles || st.frenzy || st.gift || damage <= 0) return 0;
        const before = mon.hp;
        const floor = !st.frenzyDone ? 514 : 1;
        mon.hp = Math.max(floor, mon.hp - Math.min(Math.max(1, hits), Math.max(1, damage)));
        if (mon.hp === 514 && !st.frenzyDone) {
            st.frenzyDone = true;
            st.frenzy = event(mon, 'birthdayFrenzy', 10, { label: '514', nextAttack: .5 });
            ctx.pushCombat(room, '루킴 [514] 광란', 'danger');
        } else if (mon.hp === 1 && !st.giftDone) {
            st.giftDone = true;
            st.gift = event(mon, 'birthdayGift', 10, { label: '생일 선물', responded: [], gifts: [] });
            event(mon, 'birthdaySpeech', 10, { presentation: 'speech', message: '오늘은 내 생일!' });
            ctx.pushCombat(room, '루킴: 오늘은 내 생일!', 'info');
        }
        return before - mon.hp;
    }
    function finishEvent(room, mon, ev) {
        const st = mon.bossState;
        if (ev.kind === 'birthdayBlow') {
            st.stage = 'clap';
            st.lit = [];
            event(mon, 'birthdayClap', 2.5, { label: '박수', responded: [] });
        } else if (ev.kind === 'birthdayClap') fail(room, '박수가 멈췄습니다.');
        else if (ev.kind === 'birthdayCelebrate') ctx.endPhase(room);
        else if (ev.kind === 'birthdayFrenzy') st.frenzy = null;
        else if (ev.kind === 'birthdayGift') {
            if (alive(room).every(m => ev.responded.includes(m.name))) ctx.endQuest(room, true);
            else fail(room, '생일 선물이 부족합니다.');
        } else if (ev.kind === 'birthdaySteal') {
            const target = ctx.findMember(room, ev.target);
            const potion = target && (target.potions || []).find(p => p.count > 0);
            if (!potion) { fail(room, '루킴이 물약을 찾지 못했습니다.'); return; }
            potion.count--;
            event(mon, 'birthdayDrink', 1, { label: '물약 강탈', target: ev.target, potion: potion.name });
            ctx.pushCombat(room, '루킴 → ' + ev.target + ' [' + potion.name + '] 강탈', 'info');
        } else if (ev.kind === 'birthdayCoding') {
            st.coding = null;
            ctx.shuffleCards(room);
            st.shuffle = event(mon, 'birthdayShuffle', 15, { label: '코딩' });
        } else if (ev.kind === 'birthdayShuffle') {
            ctx.restoreCards(room);
            st.shuffle = null;
            st.codeAt = st.elapsed + 70;
        }
    }
    function step(room, mon, dt) {
        const st = mon.bossState;
        st.elapsed += dt;
        st.updatedAt = Date.now();
        const codingPause = st.coding ? Math.min(dt, st.coding.remain) : 0;
        st.cakeAt += codingPause;
        st.stealAt += codingPause;
        // 신규 사건을 같은 틱에 감소시키지 않는다.
        for (const ev of st.events.slice()) {
            if (ev.remain == null) continue;
            const used = Math.min(dt, ev.remain);
            if (ev.kind === 'birthdayFrenzy') {
                ev.nextAttack -= used;
                while (ev.nextAttack <= 1e-9 && room.state === 'inProgress') {
                    ev.nextAttack += .5;
                    const target = pick(alive(room));
                    if (!target) break;
                    const amount = 10 + Math.floor(Math.random() * 9991);
                    ctx.applyFixedDamageToMember(room, target, amount, '루킴 [514]');
                    event(mon, 'birthdayStrike', .55, { target: target.name, amount });
                }
            } else if (ev.kind === 'birthdayThrow' && ev.duration - ev.remain + used >= ev.impactDelay - 1e-9) cakeImpact(room, ev);
            if (room.state !== 'inProgress' || room.monster !== mon) return true;
            ev.remain = Math.max(0, ev.remain - dt);
            if (ev.remain <= 1e-9) {
                st.events = st.events.filter(e => e !== ev);
                finishEvent(room, mon, ev);
                if (room.state !== 'inProgress' || room.monster !== mon) return true;
            }
        }
        if (st.candles) {
            if (st.stage === 'lighting') {
                const end = 3 + st.candle * 3 + .75;
                if (st.elapsed >= end) {
                    if (!alive(room).every(m => st.responses.includes(m.name))) { fail(room, '촛불을 붙이지 못했습니다.'); return true; }
                    if (!st.lit.includes(st.candle)) st.lit.push(st.candle);
                    st.candle++;
                    st.responses = [];
                    if (st.candle === 6) {
                        st.stage = 'blow';
                        st.events = [];
                        event(mon, 'birthdayBlow', 1.4, { label: '촛불 끄기' });
                    }
                }
            }
            return true;
        }
        if (st.coding) return true;
        if (st.elapsed >= st.cakeAt) {
            st.cakeAt += 3;
            throwCake(room, mon);
        }
        if (room.state !== 'inProgress') return true;
        if (st.elapsed >= st.stealAt) {
            st.stealAt += 27;
            const target = pick(alive(room));
            if (target) event(mon, 'birthdaySteal', 2, { label: '물약 강탈', target: target.name });
        }
        if (!st.frenzy && !st.gift && !st.shuffle && st.elapsed >= st.codeAt) st.coding = event(mon, 'birthdayCoding', 5, { label: '코딩' });
        return true; // 이벤트 보스는 ATB 일반 공격을 사용하지 않는다.
    }
    function view(mon) {
        const st = mon.bossState;
        return { birthday: true, generic: true, stage: st.stage, candles: st.candles, elapsed: st.elapsed, updatedAt: st.updatedAt,
            lit: st.lit.slice(), candle: st.candle,
            events: st.events.map(({ nextAttack, ...ev }) => ({ ...ev, targets: ev.target ? [ev.target] : ev.targets || [] })) };
    }
    return { init, onSpawn, step, view, lightAttack, action, interceptDamage, transition };
}

module.exports = { ID, START, END, CLAIM, available, admissionError, createBirthdayRaid };
