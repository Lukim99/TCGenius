// 기존 파티 전투의 피해·회복·그로기·HP 기믹 처리에 연결되는 대저택 패턴.
function createMansionRaid(engine) {
    const E = engine;
    const labels = { pillars: '기둥 하중 이동', sculpture: '완성하면 안 되는 작품', burden: '조의 의지', blessing: '미완성의 축복', dictation: 'edaa 받아쓰기', pulse: '맥동 제어', inversion: '봉인 역전', shards: '쏟아지는 조각', resonance: '공명 폭발', echo: '되울림', wall: '울리는 벽', rupture: '잔향 파열', harden: '단단해지기', trial: '잔향 보호막 시련' };
    const messages = {
        pillars: '네 개의 기둥이 비명을 지릅니다. 무게를 옮겨 붕괴를 막으십시오.',
        sculpture: '그의 큰 그림을 완성시켜 주세요',
        burden: '{user}에게 조의 의지를 수여하겠습니다.',
        blessing: '조각이 {user}를 본인의 일부로 지정합니다.',
        dictation: '그가 이상한 언어를 읊습니다...',
        pulse: '[System]기운 봉인',
        inversion: '조형물의 안과 밖이 뒤집혔습니다.',
        shards: '조각의 파편들이 무수히 쏟아집니다.',
        resonance: '삐비빅',
        echo: '삐빅. 삐빅.',
        wall: '우우웅.... 위잉....',
        rupture: '...',
        harden: '조각의 피부가 윤택해집니다.',
        trial: '플레이어들에게 [시련]이 주어집니다.',
        transition: '틀이 깨졌다'
    };
    const alive = room => E.getAliveMembers(room);
    const pick = values => values[Math.floor(Math.random() * values.length)];
    const hard = mon => mon.bossState.difficulty !== 'normal';
    const nightmare = mon => mon.bossState.difficulty === 'nightmare';
    const byDifficulty = (mon, n, h, nm = h) => nightmare(mon) ? nm : hard(mon) ? h : n;

    function init(def) {
        return { mansion: true, difficulty: def.mansionDifficulty, events: [], serial: 0, elapsed: 0, blessingAt: -100, timers: { shards: 22, burden: 50, blessing: 40, harden: 75, dictation: 80, resonance: 30, echo: 21, wall: 19, pulse: 36 }, form: 'body', echoElapsed: 0, inversionIndex: 0, inversionTargetIndex: -1, outcome: null };
    }
    function start(room, mon, kind, duration, fields = {}) {
        const st = mon.bossState;
        const event = { id: room.id + ':' + room.startedAt + ':' + room.phaseIndex + ':mansion-' + (++st.serial), kind, label: labels[kind], remain: duration, duration, responded: [], ...fields };
        event.message = messages[kind].replace('{user}', () => event.target);
        if (kind === 'pulse' || kind === 'inversion') event.cueText = event.pulse === 'gather' ? '기운이 한점으로 모여듭니다' : '기운이 사방으로 흩어집니다';
        st.events.push(event);
        mon.nextPattern = event.label;
        E.pushCombat(room, mon.name + ' [' + event.label + '] ' + event.message, 'danger');
        return event;
    }
    function remove(mon, event) {
        mon.bossState.events = mon.bossState.events.filter(value => value !== event);
        mon.nextPattern = mon.bossState.events.at(-1)?.label || null;
    }
    function outcome(room, mon, event, ok, label) {
        mon.bossState.outcome = { id: event.id, ok, label: label || event.label + (ok ? ' 성공' : ' 실패') };
        E.pushNotice(room, mon.bossState.outcome.label, ok ? 'success' : 'danger', 3500);
        remove(mon, event);
    }
    function fixedAoe(room, pct, label) {
        for (const member of alive(room)) {
            E.applyFixedDamageToMember(room, member, Math.round(member.runtime.hpMax * pct), label);
            if (room.state !== 'inProgress') break;
        }
    }
    function attack(room, mon, ratio, targets = alive(room), element) {
        const attackMon = { ...mon, stats: { ...mon.stats, atk: E.bossAtk(mon) * ratio }, atk: E.bossAtk(mon) * ratio, element: element || mon.element };
        for (const member of targets) {
            if (!member?.runtime || member.runtime.dead) continue;
            E.applyDamageToMember(room, member, E.computeMonsterDamage(room, attackMon, member), mon.name + ' [' + (mon.nextPattern || '공격') + ']');
            if (room.state !== 'inProgress') break;
        }
    }
    function rewardGimmick(room, mon, event, seconds = 6, taken = .2) {
        E.endBossGimmick(mon);
        outcome(room, mon, event, true);
        E.applyBossGroggy(room, mon, seconds, taken);
        E.addSupportGauge(room, 30);
    }
    function failGimmick(room, mon, event, pct) {
        E.endBossGimmick(mon);
        outcome(room, mon, event, false);
        if (hard(mon)) E.wipeParty(room, event.label + ' 실패');
        else fixedAoe(room, pct, event.label);
    }
    function pillars(room, mon) {
        const loads = byDifficulty(mon, [3, 5, 7, 9], [0, 4, 8, 12]).slice();
        for (let i = loads.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [loads[i], loads[j]] = [loads[j], loads[i]]; }
        const event = start(room, mon, 'pillars', 9, { loads, lastTransfer: {} });
        mon.bossState.gimmickActive.tick = (room, mon, dt) => { event.remain -= dt; if (event.remain <= 1e-6) failGimmick(room, mon, event, .5); };
    }
    function sculpture(room, mon) {
        const event = start(room, mon, 'sculpture', byDifficulty(mon, 20, 18), { hpMax: byDifficulty(mon, 1000000, 1600000, 2800000), damage: 0, decayAt: Date.now(), decaySteps: 0, carveHits: 0, minPct: byDifficulty(mon, .65, .7), maxPct: byDifficulty(mon, .95, .9) });
        mon.bossState.gimmickActive.tick = (room, mon, dt) => {
            if (!advanceSculpture(room, mon, event)) return;
            event.remain -= dt;
            if (event.remain <= 1e-6) failGimmick(room, mon, event, .5);
        };
    }
    function sculptureProgress(event) {
        const steps = Math.max(event.decaySteps, Math.min(event.duration * 10, Math.floor((Date.now() - event.decayAt) / 100)));
        return { steps, damage: Math.max(0, event.damage - (steps - event.decaySteps) * event.hpMax / 1000) };
    }
    function advanceSculpture(room, mon, event) {
        const progress = sculptureProgress(event);
        event.damage = progress.damage; event.decaySteps = progress.steps;
        if (event.damage >= event.hpMax) { failGimmick(room, mon, event, .5); return false; }
        return true;
    }
    function trial(room, mon) {
        const event = start(room, mon, 'trial', 8, { stage: 'record', recorded: 0 });
        mon.bossState.gimmickActive.tick = (room, mon, dt) => {
            event.remain -= dt;
            if (event.stage === 'shield' && mon.shield <= 0) {
                E.clearBossShield(mon);
                for (const member of alive(room)) E.upsertMemberBuff(member, { id: 'mansionTrial', label: '잔향 시련 (최종 피해 +20%)', value: .2, remain: 8 });
                rewardGimmick(room, mon, event, 8, 0);
            } else if (event.remain <= 1e-6 && event.stage === 'record') {
                const amount = Math.max(byDifficulty(mon, 350000, 600000, 1000000), Math.min(byDifficulty(mon, 900000, 1600000, 2700000), Math.round(event.recorded * byDifficulty(mon, 1.1, 1.2))));
                E.setBossShield(room, mon, amount, event.label);
                event.stage = 'shield'; event.remain = event.duration = byDifficulty(mon, 12, 10);
            } else if (event.remain <= 1e-6) {
                E.clearBossShield(mon);
                failGimmick(room, mon, event, .6);
            }
        };
    }
    function onSpawn(room, mon) {
        if (mon.bossKey === '조각') {
            const thresholds = byDifficulty(mon, [[.7, pillars], [.3, sculpture]], [[.7, pillars], [.5125, sculpture], [.3, sculpture]], [[.7, pillars], [1250 / 2700, sculpture], [700 / 2700, sculpture]]);
            E.registerHpGimmicks(mon, thresholds.map(([ratio, run]) => ({ ratio, run })));
        } else {
            if (hard(mon)) mon.hpFloor = 1;
            const thresholds = byDifficulty(mon, [1100 / 1500, 500 / 1500], [.75, .35], [.7, .3]);
            E.registerHpGimmicks(mon, thresholds.map(ratio => ({ ratio, run: trial })));
        }
    }
    function busy(mon) {
        return mon.bossState.events.some(event => ['shards', 'resonance', 'echo'].includes(event.kind) || event.kind === 'harden' && event.stage === 'wait');
    }
    function hasPendingAction(mon) {
        return mon.bossState.events.length > 0;
    }
    function dictationResult(room, mon, event, member) {
        if (event.responded.includes(member.name)) return;
        event.responded.push(member.name);
        const answer = event.answers[member.name] || [];
        const ok = answer.length === event.sequence.length && answer.every((letter, i) => letter === event.sequence[i]);
        const field = ok ? 'mansionDictationDamage' : 'mansionDictationTaken';
        member.runtime[field] = Number(member.runtime[field] || 0) + .1;
        E.upsertMemberBuff(member, { id: field, label: '받아쓰기 (' + (ok ? '최종 피해' : '받는 피해') + ' +' + Math.round(member.runtime[field] * 100) + '%)', remain: 100000 });
        E.pushCombat(room, member.name + ' 받아쓰기 ' + (ok ? '성공' : '실패'), ok ? 'buff' : 'danger');
    }
    function tickEvents(room, mon, dt) {
        const st = mon.bossState;
        for (const event of st.events.slice()) {
            if (['pillars', 'sculpture', 'trial'].includes(event.kind)) continue;
            event.remain -= dt;
            if (event.kind === 'shards' && event.remain <= 2 - Number(event.hits || 0) + 1e-6) {
                attack(room, mon, byDifficulty(mon, .6, .8, .85));
                event.hits = Number(event.hits || 0) + 1;
                if (event.hits === 3) remove(mon, event);
            } else if (event.kind === 'echo' && (!event.hits && event.remain <= 3 || event.hits === 1 && event.remain <= 1e-6)) {
                attack(room, mon, event.hits ? byDifficulty(mon, 1.2, 1.5, 1.6) : 1, event.targets.map(name => E.findMember(room, name)));
                event.hits = Number(event.hits || 0) + 1;
                if (event.hits === 2) remove(mon, event);
            } else if (event.kind === 'harden' && event.remain <= 3 && event.stage === 'wait') event.stage = 'active';
            if (room.state !== 'inProgress') return;
            if (event.remain > 1e-6 || !st.events.includes(event)) continue;
            if (event.kind === 'burden') {
                const participants = event.responded.map(name => E.findMember(room, name)).filter(member => member?.runtime && !member.runtime.dead);
                for (const member of participants) E.applyFixedDamageToMember(room, member, Math.round(event.damage / participants.length), event.label);
            } else if (event.kind === 'blessing' && event.stage === 'accepted') {
                const target = E.findMember(room, event.target);
                if (target && !target.runtime.dead) E.applyFixedDamageToMember(room, target, Math.round(target.runtime.hpMax * byDifficulty(mon, .12, .18)), event.label);
            } else if (event.kind === 'dictation') {
                for (const member of alive(room)) dictationResult(room, mon, event, member);
            } else if (event.kind === 'pulse' || event.kind === 'inversion') {
                resolvePulse(room, mon, event, false);
            } else if (event.kind === 'resonance') attack(room, mon, byDifficulty(mon, 1.5, 1.5, 1.6), alive(room), 'dark');
            remove(mon, event);
            if (room.state !== 'inProgress') return;
        }
    }
    function resolvePulse(room, mon, event, ok) {
        outcome(room, mon, event, ok);
        if (ok && event.kind === 'inversion') {
            E.applyBossHpDamage(room, mon, Math.round(mon.hpMax * .1)); E.addSupportGauge(room, 48);
        } else if (ok) {
            E.applyBossGroggy(room, mon, 3, 0);
            for (const member of alive(room)) E.healMember(member, Math.round(member.runtime.hpMax * .08));
        } else fixedAoe(room, event.kind === 'inversion' ? byDifficulty(mon, .25, .25, .28) : byDifficulty(mon, .25, .35), event.label);
    }
    function startTransition(room, mon) {
        const st = mon.bossState;
        st.form = 'transition'; st.transitionRemain = 4; st.events = []; st.gimmickActive = null; mon.nextPattern = null;
        E.clearBossShield(mon);
        E.pushNotice(room, messages.transition, 'big', 4000);
    }
    function transition(room, dt) {
        const mon = room.monster;
        if (!mon?.bossState?.mansion || mon.bossState.form !== 'transition') return false;
        // 실제 시계로 저장된 플레이어 타이머도 전환 시간만큼 연장한다.
        const shift = value => {
            if (!value || typeof value !== 'object') return;
            for (const key of Object.keys(value)) {
                if (typeof value[key] === 'number' && /(?:Until|ReadyAt|ExpireAt|expired_at|expiredAt|expiresAt|nextTickAt)$/.test(key) && value[key] > Date.now() - 1000) value[key] += dt * 1000;
                else if (key === 'cooldownsUntil') for (const skill of Object.keys(value[key] || {})) value[key][skill] += dt * 1000;
                else if (value[key] && typeof value[key] === 'object') shift(value[key]);
            }
        };
        for (const member of room.members) shift(member.runtime);
        const st = mon.bossState;
        st.transitionRemain = Math.max(0, st.transitionRemain - dt);
        if (st.transitionRemain <= 1e-6) {
            st.form = 'echo'; st.echoElapsed = 0; st.echoTimer = 10; st.inversionIndex = 0; st.inversionTargetIndex = -1;
            st.hpGimmicks = []; mon.hpFloor = 0;
            mon.name = '위플래쉬 (잔향)'; mon.image = '대저택/위플래쉬(0줄).png';
            mon.hp = mon.hpMax = byDifficulty(mon, 4000000, 4000000, 7000000);
            mon.atk = byDifficulty(mon, 14000, 14000, 14800); mon.def = byDifficulty(mon, 450, 450, 500); mon.pnt = byDifficulty(mon, 1050, 1050, 1150);
            Object.assign(mon.stats, { hp: mon.hpMax, atk: mon.atk, def: mon.def, pnt: mon.pnt, crit: .6, critMul: byDifficulty(mon, 2, 2, 2.25) });
            mon.actionInterval = 2; mon.gauge = 0; mon.stunRemain = 0; mon.debuffs = []; mon.hpLines = mon.hpMax / 10000;
            mon.enrageSec = mon.enrageRemain = 60; mon.enraged = false;
            E.addSupportGauge(room, 20);
        }
        return true;
    }
    function step(room, mon, dt) {
        const st = mon.bossState;
        st.elapsed += dt;
        if (mon.bossKey === '위플래쉬' && hard(mon) && st.form === 'body' && mon.hp <= 1) { startTransition(room, mon); return true; }
        const kinds = mon.bossKey === '조각' ? ['shards', 'burden', 'blessing', 'harden', 'dictation'] : ['resonance', 'echo', 'wall', 'pulse'];
        if (st.form === 'echo') { st.echoElapsed += dt; st.echoTimer -= dt; }
        else for (const kind of kinds) st.timers[kind] -= dt;
        const active = hasPendingAction(mon);
        tickEvents(room, mon, dt);
        if (room.state !== 'inProgress' || busy(mon)) return true;
        // 종료한 패턴의 다음 tick에서 체력 기믹을 먼저 확인하고 다음 패턴을 시작한다.
        if (active) return false;
        if (st.form === 'echo') {
            const times = [10, 22, 34, 46];
            if (st.inversionIndex < times.length && st.echoElapsed >= times[st.inversionIndex]) {
                for (let offset = 1; offset <= room.members.length; offset++) {
                    const index = (st.inversionTargetIndex + offset) % room.members.length;
                    const member = room.members[index];
                    if (!member.runtime || member.runtime.dead) continue;
                    st.inversionTargetIndex = index;
                    start(room, mon, 'inversion', 3, { target: member.name, pulse: pick(['gather', 'scatter']) });
                    break;
                }
                st.inversionIndex++;
                return true;
            }
            if (mon.stunRemain > 0) return true;
            if (st.echoTimer <= 1e-6) {
                st.echoTimer += 10; start(room, mon, 'rupture', 1.5); attack(room, mon, .8);
                return true;
            }
            return false;
        }
        if (mon.stunRemain > 0) return true;
        const kind = kinds.find(kind => st.timers[kind] <= 1e-6 && (kind !== 'harden' || st.elapsed - st.blessingAt >= 8));
        if (!kind) return false;
        const intervals = { shards: 22, burden: 50, blessing: 40, harden: 75, dictation: 80, resonance: 30, echo: 21, wall: 19, pulse: 36 };
        st.timers[kind] += intervals[kind];
        if (kind === 'shards') start(room, mon, kind, 4, { hits: 0 });
        else if (kind === 'burden') { const target = pick(alive(room)); if (target) start(room, mon, kind, 4, { target: target.name, responded: [target.name], damage: byDifficulty(mon, 18000, 28000, 30000) }); }
        else if (kind === 'blessing') { const target = pick(alive(room)); if (target) start(room, mon, kind, 5, { target: target.name, stage: 'choice' }); st.blessingAt = st.elapsed; }
        else if (kind === 'harden') start(room, mon, kind, 4, { stage: 'wait' });
        else if (kind === 'dictation') start(room, mon, kind, 6, { sequence: Array.from({ length: byDifficulty(mon, 4, 6) }, () => pick(['a', 'b', 'c', 'd', 'e'])), answers: {} });
        else if (kind === 'resonance') start(room, mon, kind, 3);
        else if (kind === 'echo') { const members = alive(room).slice(); const targets = []; while (members.length && targets.length < 2) targets.push(members.splice(Math.floor(Math.random() * members.length), 1)[0].name); start(room, mon, kind, 4, { targets, hits: 0 }); }
        else if (kind === 'wall') {
            start(room, mon, kind, 1.5);
            fixedAoe(room, byDifficulty(mon, .04, .06), '울리는 벽');
        }
        else if (kind === 'pulse') { const target = pick(alive(room)); if (target) start(room, mon, kind, byDifficulty(mon, 4, 3), { target: target.name, pulse: pick(['gather', 'scatter']) }); }
        return ['shards', 'resonance', 'echo', 'harden', 'wall'].includes(kind);
    }
    function interceptDamage(room, mon, damage, source) {
        const st = mon.bossState;
        if (!st?.mansion) return null;
        if (st.form === 'transition') return 0;
        const stone = st.events.find(event => event.kind === 'sculpture');
        if (stone) {
            if (!advanceSculpture(room, mon, stone)) return 0;
            const dealt = Math.min(damage, Math.max(0, stone.hpMax - stone.damage));
            stone.damage += dealt;
            if (dealt > 0) stone.carveHits++;
            if (stone.damage >= stone.hpMax) failGimmick(room, mon, stone, .5);
            return dealt;
        }
        const harden = st.events.find(event => event.kind === 'harden' && event.stage === 'active');
        if (harden) {
            const prevented = Math.round(damage * byDifficulty(mon, .6, .8, .9));
            mon.hp = Math.min(mon.hpMax, mon.hp + prevented);
            damage -= prevented;
        }
        if (mon.shield > 0) { const absorbed = Math.min(mon.shield, damage); mon.shield = Math.max(0, mon.shield - damage); return absorbed; }
        const dealt = Math.min(damage, Math.max(0, mon.hp - Number(mon.hpFloor || 0)));
        mon.hp -= dealt;
        const record = st.events.find(event => event.kind === 'trial' && event.stage === 'record');
        if (record && source !== 'support') record.recorded += dealt;
        if (hard(mon) && mon.bossKey === '위플래쉬' && st.form === 'body' && mon.hp <= 1) startTransition(room, mon);
        return dealt;
    }
    function action(room, name, payload) {
        const mon = room.monster, st = mon?.bossState;
        const member = E.findMember(room, name);
        if (room.state !== 'inProgress' || !st?.mansion || st.form === 'transition' || !member?.runtime || member.runtime.dead) return { error: '기믹에 참여할 수 없습니다.' };
        const event = st.events.find(event => event.id === payload.eventId && event.remain > 1e-6);
        if (!event) return { error: '이미 종료된 기믹입니다.' };
        if (event.kind === 'pillars' && payload.action === 'transfer') {
            const { from, to } = payload;
            if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || from > 3 || to < 0 || to > 3 || from === to || event.loads[from] < 1) return { error: '이동할 기둥을 확인하세요.' };
            if (Date.now() - Number(event.lastTransfer[name] || 0) < 500) return { error: '하중 이동은 0.5초마다 가능합니다.' };
            event.lastTransfer[name] = Date.now(); event.loads[from]--; event.loads[to]++;
            if (event.loads.every(load => load === 6)) rewardGimmick(room, mon, event);
        } else if (event.kind === 'sculpture' && payload.action === 'finish') {
            if (room.hostName !== name) return { error: '공대장만 완성 판정을 할 수 있습니다.' };
            if (!advanceSculpture(room, mon, event)) return { ok: true };
            const pct = event.damage / event.hpMax;
            if (pct >= event.minPct && pct <= event.maxPct) rewardGimmick(room, mon, event);
            else failGimmick(room, mon, event, .5);
        } else if (event.kind === 'burden' && payload.action === 'support') {
            if (!event.responded.includes(name)) event.responded.push(name);
        } else if (event.kind === 'blessing' && ['accept', 'reject'].includes(payload.action)) {
            if (event.target !== name || event.stage !== 'choice') return { error: '지정 대상만 선택할 수 있습니다.' };
            if (payload.action === 'reject') outcome(room, mon, event, true, '축복을 거절했습니다');
            else { event.stage = 'accepted'; event.remain = event.duration = 8; E.upsertMemberBuff(member, { id: 'mansionBlessing', label: '미완성의 축복 (최종 피해 +20%)', value: .2, remain: 8 }); }
        } else if (event.kind === 'dictation' && payload.action === 'letter') {
            if (!['a', 'b', 'c', 'd', 'e'].includes(payload.letter) || event.responded.includes(name)) return { error: '입력할 수 없습니다.' };
            if (!event.answers[name]) event.answers[name] = [];
            event.answers[name].push(payload.letter);
            if (event.answers[name].length === event.sequence.length) dictationResult(room, mon, event, member);
            if (alive(room).every(member => event.responded.includes(member.name))) remove(mon, event);
        } else if (['pulse', 'inversion'].includes(event.kind) && ['absorb', 'release'].includes(payload.action)) {
            if (event.target !== name) return { error: '지정 대상만 선택할 수 있습니다.' };
            const expected = event.kind === 'pulse' ? event.pulse === 'gather' ? 'release' : 'absorb' : event.pulse === 'gather' ? 'absorb' : 'release';
            resolvePulse(room, mon, event, payload.action === expected);
        } else return { error: '잘못된 기믹 조작입니다.' };
        E.broadcastRoom(room);
        return { ok: true };
    }
    function support(room, source, name) {
        const mon = room.monster;
        if (name === '피카츄' && mon) {
            const dealt = E.applyBossHpDamage(room, mon, byDifficulty(mon, 400000, 650000, 1100000), 'support');
            E.recordPartyDamage(source, { damage: dealt, fixedDamage: 0, destinyDamage: 0, hitDetails: [], isCrit: false }, '지원군 피카츄');
            E.pushCombat(room, '피카츄 → ' + mon.name + ' [-' + dealt + ']', 'skill');
        } else if (name === '오로라') {
            for (const member of alive(room)) {
                if (E.canPartyApplyShield(null, member)) { member.runtime.shield = Number(member.runtime.shield || 0) + 50000; member.runtime.shieldHits = 99; member.runtime.shieldExpireAt = Date.now() + 12000; }
            }
            room.mansionAurora = { remain: 4, tick: 1, sourceName: source.name };
        } else if (name === '눈뜬 장님') {
            for (const member of room.members) if (member.runtime) member.runtime.cooldownsUntil = {};
            const stone = mon?.bossState?.events.find(event => event.kind === 'sculpture');
            if (stone && advanceSculpture(room, mon, stone)) { stone.damage = Math.round(stone.hpMax * .75); stone.carveHits++; E.pushNotice(room, '내가 맞춰주겠다.', 'big', 4000); E.grantTitleAsync(room, room.hostName, 'mansionEyes'); }
        }
    }
    function tickAurora(room, dt) {
        const buff = room.mansionAurora;
        if (!buff) return;
        buff.remain -= dt; buff.tick -= dt;
        if (buff.tick <= 1e-6) { buff.tick += 1; for (const member of alive(room)) E.healMember(member, Math.round(member.runtime.hpMax * .075), E.findMember(room, buff.sourceName)); }
        if (buff.remain <= 1e-6) room.mansionAurora = null;
    }
    function view(mon) {
        const st = mon?.bossState;
        if (!st?.mansion) return null;
        const fields = ['id', 'kind', 'label', 'message', 'cueText', 'remain', 'duration', 'target', 'targets', 'responded', 'loads', 'damage', 'hpMax', 'minPct', 'maxPct', 'carveHits', 'sequence', 'answers', 'pulse', 'stage', 'recorded'];
        return { difficulty: st.difficulty, form: st.form, transitionRemain: st.transitionRemain || 0, transitionMessage: st.form === 'transition' ? messages.transition : '', outcome: st.outcome, events: st.events.map(event => {
            const out = {}; for (const key of fields) if (event[key] !== undefined) out[key] = event[key];
            if (event.kind === 'sculpture') { const progress = sculptureProgress(event); out.damage = progress.damage; out.decayNextAt = event.decayAt + (progress.steps + 1) * 100; }
            if (event.kind === 'trial') { out.shield = mon.shield; out.shieldMax = mon.shieldMax; }
            return out;
        }) };
    }
    return { init, onSpawn, step, busy, hasPendingAction, tickEvents, transition, interceptDamage, action, support, tickAurora, view };
}

module.exports = { createMansionRaid };
