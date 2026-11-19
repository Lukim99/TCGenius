// 증강 연출 흐름: 기본 공격 계열(정복자, 신성한 번개, 가속, 원펀치 룰, 악마 사냥꾼, 갑옷 깎아내기). 형식은 ../lab.js의 AugLab.define 설명을 본다.
// 사건과 지속 상태의 모양은 docs/paradise-augment-fx.md, 서버의 실제 순서와 수치는 paradise_prism.js와 rpgenius.js(buildParadiseHuntResult)를 따른다.
// 시간은 서버 값이다: 일반 적의 공격 간격 3.5초, 정복자의 기병 3초, 행동 쿨타임 2~3초(가속 1.5~2.5초).
// 플레이어 행동은 보기 좋게 1초쯤 간격으로 줄였고, 시간이 주제인 가속과 원펀치 룰만 실제 행동 간격으로 보인다.
(function () {
    'use strict';
    const ENEMY = 3.5;   // 일반 적의 공격 간격(초): paradise.enemyAttackInterval('normal')
    const at = (t, run) => ({ t, run });
    // 시각(초)을 적은 일들을 시각 순서대로 실행한다. 앞의 일이 길어지면(처치 뒤 다음 적) 밀린 일은 곧바로 잇는다.
    async function timeline(L, steps) {
        const list = steps.map((step, i) => Object.assign({ i }, step)).sort((a, b) => a.t - b.t || a.i - b.i), began = L.now();
        for (const step of list) {
            const ahead = step.t - (L.now() - began) / 1000;
            if (ahead > 0) await L.wait(ahead);
            await step.run();
        }
    }
    // from초부터 until초 전까지 3.5초마다 오는 적의 보통 공격.
    const enemyTurns = (L, from, until) => { const out = []; for (let t = from; t < until; t += ENEMY) out.push(at(t, () => L.enemy())); return out; };
    const jitter = (value, spread) => Math.round(value * (1 + (Math.random() * 2 - 1) * (spread == null ? .03 : spread)));
    const fmt = n => Math.round(n).toLocaleString('ko-KR');
    const auraOf = (L, key) => Number(L.state && L.state[key] || 0);
    const stage = () => document.getElementById('stage').contentWindow.AugStage;
    // 서버는 일반 공격과 그 맞공격을 한 응답에 보낸다. hfield는 같은 갱신에 온 맞공격만 플레이어의 타격이 닿은 뒤로 늦추므로 두 사건을 무대에 한 번에 넘긴다.
    // L에는 사건 여럿을 한 번에 넣는 도구가 없어서, make()가 L로 만드는 사건들을 무대의 push를 잠깐 가로채 모은다.
    function together(make) {
        const S = stage(), push = S.push, batch = [];
        S.push = events => { batch.push(...events); return 0; };
        try { make(); } finally { S.push = push; }
        return push(batch);
    }

    // 정복자: 직접 공격마다 1중첩(공격력 +20, 최종 피해 +2%), 최대 10중첩. 10중첩이 된 공격에 conqueror.max가 붙고 기병이 3초 뒤부터 3초마다 돌격한다.
    // 중첩(run.prismEncounter)은 2마리 전투 한 번 동안 이어진다. k번째 공격은 k-1중첩의 능력치로 계산하고, 맞힌 뒤 k중첩이 된다.
    const conquered = (L, n) => (L.atk + 20 * n) * (1 + .02 * n);   // n중첩일 때의 공격 피해 기준
    const cavalry = L => L.tick('정복자의 기병', { cues: ['conqueror.cavalry'], damage: jitter(conquered(L, 10) * 1.2) });
    const stackCaption = k => k === 2 ? '스킬도 공격이라 2중첩, 공격력 +40'
        : k === 10 ? '10중첩: 공격력 +200, 기병이 달려옵니다'
        : k + '중첩: 공격력 +' + 20 * k + ', 최종 피해 +' + 2 * k + '%';
    AugLab.define('conqueror', {
        aura: { stacks: 0, max: 10 },
        demo: async L => {
            const gap = .8, tenth = .8 + 9 * gap, steps = [at(0, () => L.caption('정복자: 공격할 때마다 1중첩'))];
            for (let k = 1; k <= 10; k++) steps.push(at(.8 + (k - 1) * gap, () => {
                L.aura({ stacks: k });
                if (k === 2) L.skill(null, { base: conquered(L, 1) * 1.8 });
                else L.attack({ base: conquered(L, k - 1), cues: k === 10 ? ['conqueror.max'] : [] });
                L.caption(stackCaption(k));
            }));
            steps.push(...enemyTurns(L, ENEMY, tenth + 3.8),
                at(tenth + 3, () => { cavalry(L); L.caption('기병이 3초마다 공격력의 120%로 돌격'); }),
                at(tenth + 3.8, async () => { L.caption('첫 적 처치: 중첩과 기병은 남습니다'); await L.kill({ base: conquered(L, 10) }); }),
                at(tenth + 6, () => { cavalry(L); L.caption('둘째 적에게도 3초마다 돌격합니다'); }));
            await timeline(L, steps);
            await L.wait(1.2);
        },
        signals: [
            { label: '10중첩 도달: 기병 등장', run: async L => {
                // 이미 10중첩이면 곁의 기병이 물러난 뒤에 다시 달려오게 한다.
                if (auraOf(L, 'stacks') >= 10) { L.aura({ stacks: 9 }); await L.wait(.7); } else L.aura({ stacks: 9 });
                L.aura({ stacks: 10 }); L.attack({ base: conquered(L, 9), cues: ['conqueror.max'] });
            } },
            { label: '기병의 돌격(3초마다)', run: async L => {
                if (auraOf(L, 'stacks') < 10) { L.aura({ stacks: 10 }); await L.wait(1); }   // 기병이 곁에 선 뒤에 돌격한다
                cavalry(L);
            } },
            { label: '공격 한 번(1중첩 오름, 10에서 멈춤)', run: L => {
                const n = Math.min(10, auraOf(L, 'stacks'));
                L.aura({ stacks: Math.min(10, n + 1) }); L.attack({ base: conquered(L, n), cues: n === 9 ? ['conqueror.max'] : [] });
            } }
        ],
        controls: [{ key: 'stacks', label: '정복자 중첩(10이면 기병이 곁에 섭니다)', type: 'range', min: 0, max: 10 }],
        notes: [
            '공격 한 번에 1중첩입니다. 일반 공격, 스킬, 소환수의 공격을 모두 세고 연격은 한 번입니다. 검무는 8타가 각각 공격이라 8중첩이 쌓입니다. 지속 피해와 피해 없는 변속, 간파는 세지 않습니다.',
            '공격력 +20은 중첩당 고정 수치입니다. 10중첩이면 공격력 +200, 최종 피해 +20%이고, 기병의 피해도 그때의 공격력으로 계산합니다(방어력 적용, 치명타 없음).',
            '2마리 전투가 한 번의 전투라서 중첩과 기병이 둘째 적에게 이어지고, 다음 전투는 0중첩에서 시작합니다. 기병은 10중첩이 된 순간 불려 와 3초 뒤부터 3초마다 공격합니다.',
            '지금 코드는 첫 적을 쓰러뜨린 공격으로 10중첩이 되면 기병을 부르지 않고 둘째 적에게서도 부르지 않습니다. 화면에는 10중첩이라 기병이 곁에 서지만 공격하지 않습니다. 의도와 다를 수 있습니다.'
        ],
        live: '일반 공격이나 스킬을 열 번 쓰면 10중첩이 되고 기병이 곁에 서서 3초마다 돌격합니다. 실전의 적은 실제 체력이라 열 번째 공격 전에 첫 적이 쓰러질 수 있으니 "증강 상태 채우기"로 발동 직전까지 쌓은 뒤 공격하세요. 10중첩이 된 뒤 "적 HP 1"을 누르고 공격해 첫 적을 쓰러뜨리면 중첩과 기병이 둘째 적에게 이어집니다. 상태를 채운 뒤 바로 "적 HP 1"을 누르고 공격하면 열 번째 공격이 첫 적을 쓰러뜨려 기병이 오지 않는 경우를 볼 수 있습니다. "새 전투 시작"을 누르면 0중첩에서 다시 시작합니다.'
    });

    // 신성한 번개: 직접 공격 수를 탐험 내내 세어(run.prism.lightning) 3번째마다 같은 공격 사건에 '신성한 번개' 타격(공격력 200%, 명속성)이 붙는다.
    const bolt = L => ({ damage: jitter(L.atk * 2, .04), label: '신성한 번개' });
    AugLab.define('holyLightning', {
        aura: { count: 0 },
        demo: async L => {
            await timeline(L, [
                at(0, () => L.caption('신성한 번개: 공격 수를 셉니다')),
                at(.8, () => { L.aura({ count: 1 }); L.attack(); L.caption('첫 번째 공격: 적 머리 위에 빛이 맺힙니다'); }),
                at(1.8, () => { L.aura({ count: 2 }); L.skill(); L.caption('두 번째 공격: 스킬도 공격으로 셉니다'); }),
                at(2.9, () => { L.aura({ count: 0 }); L.attack({ cues: ['holyLightning'], extraHits: [bolt(L)] }); L.caption('세 번째 공격: 번개, 공격력의 200%'); }),
                at(ENEMY, () => { L.enemy(); L.caption('적의 공격은 박자에 들지 않습니다'); }),
                at(4.7, () => { L.aura({ count: 1 }); L.attack(); L.caption('번개 뒤 다시 첫 번째 공격'); }),
                at(5.7, async () => { L.aura({ count: 2 }); L.caption('두 번째 공격으로 첫 적 처치'); await L.kill(); }),
                at(7.6, () => { L.aura({ count: 0 }); L.attack({ cues: ['holyLightning'], extraHits: [bolt(L)] }); L.caption('박자가 이어져 둘째 적에게 번개'); })
            ]);
            await L.wait(1.4);
        },
        signals: [
            { label: '세 번째 공격: 번개', run: L => { L.aura({ count: 0 }); L.attack({ cues: ['holyLightning'], extraHits: [bolt(L)] }); } },
            { label: '공격 한 번(세 번째면 번개)', run: L => {
                const count = auraOf(L, 'count');
                if (count >= 2) { L.aura({ count: 0 }); L.attack({ cues: ['holyLightning'], extraHits: [bolt(L)] }); }
                else { L.aura({ count: count + 1 }); L.attack(); }
            } }
        ],
        controls: [{ key: 'count', label: '지난 번개 뒤 공격 수(2면 다음 공격에 번개)', type: 'range', min: 0, max: 2 }],
        notes: [
            '"공격"은 지속 피해를 뺀 모든 공격입니다. 일반 공격과 스킬뿐 아니라 정복자의 기병, 떠다니는 검, 천사 같은 소환수의 공격도 세고, 세 번째가 소환수면 그 공격에 번개가 붙습니다. 검무는 8타가 각각 공격입니다.',
            '번개는 그 공격에 "신성한 번개" 타격으로 붙고, 공격력의 200%를 명속성으로 계산합니다. 방어력을 거치고 치명타는 없습니다.',
            '세 번째 공격 박자는 탐험 내내 이어집니다. 2마리 전투의 둘째 적과 다음 전투로도 이어집니다.'
        ],
        live: '공격을 세 번 하면 세 번째 공격에 번개가 칩니다. "증강 상태 채우기"를 누르면 다음 공격이 세 번째가 됩니다. "적 HP 1"로 첫 적을 쓰러뜨려도 박자는 둘째 적으로 이어집니다. 실험실의 "새 전투 시작"은 탐험을 새로 시작하므로 박자도 처음부터 셉니다.'
    });

    // 가속: 행동 쿨타임(일반 공격이나 스킬 뒤 다음 행동까지, 서버의 randomInt(2000, 3000)ms)에서 0.5초를 뺀다. 최소 0.5초.
    // 실제 화면은 남은 행동 쿨타임(state.nextActionAt)을 모든 행동 단추에 보인다. 무대는 그 값을 0으로 고정해 두어서,
    // 공격 단추는 player.basicUntil, 스킬 단추는 cooldownEnd에 같은 시각을 넣어 흉내 낸다. 쓴 스킬은 제 쿨타임(8초 등)과 더 긴 쪽을 보인다.
    const roll = () => (2000 + Math.round(Math.random() * 10) * 100) / 1000;
    const secs = n => n.toFixed(1) + '초';
    const ownCooldown = name => { const skill = (stage().scene.battle.skills || []).find(s => s.name === name); return (parseFloat(skill && skill.cooltimeText) || 0) * 1000; };
    function act(L, cool, skill, own) {
        const now = L.now(), until = now + cool * 1000, S = stage();
        let used = null;
        if (skill) { used = (S.scene.battle.skills || [])[0]; used = used && used.name; L.skill(); if (used) own[used] = now + ownCooldown(used); }
        else L.attack();
        L.player({ basicUntil: until });
        S.set({ skills: S.model.skills.map(entry => Object.assign({}, entry, { cooldownEnd: Math.max(until, own[entry.name] || 0) })) });
    }
    AugLab.define('haste', {
        aura: {},
        demo: async L => {
            // 실제 행동 간격: 앞의 두 번은 가속이 없을 때, 나머지는 가속이 있을 때. 쿨타임이 끝나는 순간 바로 다음 행동을 한다.
            const plan = [{}, {}, { haste: true, gain: true }, { haste: true, skill: true }, { haste: true }, { haste: true }], own = {};
            const steps = [at(0, () => { L.aura(null); L.caption('비교: 가속이 없으면 행동 쿨타임 2~3초'); })];
            let t = .9;
            plan.forEach((p, i) => {
                const base = roll(), cool = Math.max(.5, base - (p.haste ? .5 : 0));
                steps.push(at(t, () => {
                    if (p.gain) L.aura({});
                    act(L, cool, p.skill, own);
                    L.caption(i === 0 ? '행동 쿨타임 ' + secs(base) + ', 단추마다 남은 시간'
                        : !p.haste ? '이번 행동 쿨타임 ' + secs(base)
                        : p.gain ? '가속이 있으면 ' + secs(base) + '에서 0.5초 줄어 ' + secs(cool)
                        : p.skill ? '스킬 뒤에도 ' + secs(base) + ' 대신 ' + secs(cool)
                        : '행동 쿨타임 ' + secs(cool) + '(원래 ' + secs(base) + ')');
                }));
                t += cool;
            });
            steps.push(...enemyTurns(L, ENEMY, t), at(t, () => L.caption('적의 공격 간격 3.5초는 그대로입니다')));
            await timeline(L, steps);
            await L.wait(1.2);
        },
        signals: [
            { label: '공격 한 번(가속이 줄인 행동 쿨타임)', run: L => {
                const base = roll(), cool = base - .5;
                L.aura({}); act(L, cool, false, {}); L.caption('행동 쿨타임 ' + secs(base) + '에서 0.5초 줄어 ' + secs(cool));
            } },
            { label: '비교: 가속이 없을 때의 행동 쿨타임', run: async L => {
                const base = roll();
                L.aura(null); act(L, base, false, {}); L.caption('가속이 없으면 행동 쿨타임 ' + secs(base));
                await L.wait(base); L.aura({});
            } }
        ],
        notes: [
            '행동 쿨타임은 일반 공격이나 스킬 뒤 다음 행동까지 기다리는 시간으로, 서버가 2~3초에서 무작위로 정합니다. 가속은 여기서 0.5초를 빼서 1.5~2.5초가 됩니다(최소 0.5초).',
            '스킬마다의 쿨타임과 적의 공격 간격(일반 적 3.5초)은 바뀌지 않습니다. 전투 중에만 적용됩니다.',
            '행동 쿨타임은 일반 공격과 스킬이 함께 써서 모든 행동 단추에 같은 남은 시간이 보입니다. 방금 쓴 스킬은 제 쿨타임이 더 길면 그쪽이 보입니다.'
        ],
        live: '공격하거나 스킬을 쓰면 단추마다 남은 행동 쿨타임이 보입니다. 가속이 있으면 2~3초 대신 1.5~2.5초입니다. 가속 없이 비교하려면 "함께 가질 증강"에 다른 증강을 더한 뒤 가속을 빼고 "새 전투 시작"을 누르세요. 채울 상태가 없어 "증강 상태 채우기"는 안내만 보입니다.'
    });

    // 원펀치 룰: 일반 공격 피해 2배(augment:onePunch). 적을 쓰러뜨리지 않은 일반 공격 바로 뒤에 같은 응답으로 맞공격(적 사건, counter: true,
    // 적의 보통 공격의 50%)이 오고, 적의 공격 타이머가 3.5초부터 다시 흐른다. 맞공격은 회피할 수 있다.
    const counterDamage = L => { const maxHp = Number(L.model.player.maxHp) || 2400; return Math.round(L.random(maxHp * .08, maxHp * .14) * .5); };
    const punch = (L, avoided) => together(() => {
        L.attack({ base: L.atk * 2, cues: ['onePunch'] });
        L.enemy(Object.assign({ counter: true, cues: ['onePunch.counter'] }, avoided ? { avoided: true } : { damage: counterDamage(L) }));
    });
    AugLab.define('onePunch', {
        aura: {},
        demo: async L => {
            await timeline(L, [
                at(0, () => L.caption('원펀치 룰: 일반 공격 피해 2배')),
                at(.6, () => { punch(L); L.caption('2배 일반 공격 뒤 적이 바로 맞공격'); }),
                at(2.8, () => { punch(L); L.caption('맞공격 피해는 보통 공격의 절반'); }),
                at(5, () => { punch(L); L.caption('맞공격 뒤 적의 공격 시간이 3.5초부터'); }),
                at(6.2, () => L.caption('적의 다음 공격까지 2.3초')),
                at(7.2, () => { L.skill(); L.caption('스킬은 2배도 맞공격도 없습니다, 1.3초 남음'); }),
                at(8.5, () => { L.enemy(); L.caption('3.5초가 지나 적의 보통 공격'); }),
                at(9.8, async () => { L.caption('쓰러뜨린 일반 공격에는 맞공격이 없습니다'); await L.kill({ base: L.atk * 2, cues: ['onePunch'] }); })
            ]);
            await L.wait(.6);
        },
        signals: [
            { label: '일반 공격 2배, 바로 맞공격', run: L => { punch(L); } },
            { label: '맞공격을 회피함', run: L => { punch(L, true); } },
            { label: '적을 쓰러뜨린 일반 공격: 맞공격 없음', run: L => L.kill({ base: L.atk * 2, cues: ['onePunch'] }) }
        ],
        notes: [
            '2배는 일반 공격 한 번의 피해 전체(연격 포함)에 붙고 스킬에는 붙지 않습니다. 검무는 8타가 각각 일반 공격이라 타마다 2배가 되고 맞공격도 8번 옵니다(화면에는 맞공격 한 번으로 묶여 보입니다).',
            '맞공격은 적의 보통 공격을 피해 50%로 한 번 계산해 플레이어 공격 바로 뒤에 옵니다. 회피할 수 있고, 적을 쓰러뜨린 일반 공격과 거울 전투에는 맞공격이 없습니다.',
            '맞공격 뒤 적의 다음 공격은 공격 주기(일반 적 3.5초)만큼 뒤로 다시 잡힙니다. 일반 공격을 그보다 자주 하면 적의 보통 공격은 오지 않고 맞공격만 받습니다.',
            '결투 신청과 함께 가지면 첫 일반 공격의 맞공격은 한 번입니다.'
        ],
        live: '일반 공격을 하면 피해가 2배가 되고 적이 바로 맞공격합니다. 스킬에는 2배와 맞공격이 없습니다. 일반 공격을 멈추면 마지막 맞공격 3.5초 뒤에 적의 보통 공격이 옵니다. "적 HP 1"을 누르고 일반 공격으로 쓰러뜨리면 맞공격이 없습니다. 채울 상태가 없어 "증강 상태 채우기"는 안내만 보입니다.'
    });

    // 악마 사냥꾼: 직접 공격 수를 탐험 내내 세어(run.prism.demon) 3번째마다 같은 공격 사건에 '악마 사냥꾼' 고정 피해(대상 최대 HP의 6%) 타격이 붙는다.
    const stake = L => ({ damage: Math.round(Number(L.model.target.maxHp || 0) * .06), fixed: true, label: '악마 사냥꾼' });
    const stakeCaption = (L, head) => head + '최대 HP ' + fmt(L.model.target.maxHp || 0) + '의 6% 고정 피해';
    AugLab.define('demonHunter', {
        aura: { count: 0 },
        demo: async L => {
            await timeline(L, [
                at(0, () => L.caption('악마 사냥꾼: 직접 공격 수를 셉니다')),
                at(.8, () => { L.aura({ count: 1 }); L.attack(); L.caption('첫 번째 공격: 적에게 조준이 걸립니다'); }),
                at(1.8, () => { L.aura({ count: 2 }); L.attack(); L.caption('두 번째 공격: 조준이 조여듭니다'); }),
                at(2.9, () => { L.aura({ count: 0 }); L.skill(null, { extraHits: [stake(L)], cues: ['demonHunter'] }); L.caption(stakeCaption(L, '세 번째는 스킬: ')); }),
                at(ENEMY, () => { L.enemy(); L.caption('적의 공격은 박자에 들지 않습니다'); }),
                at(4.7, () => { L.aura({ count: 1 }); L.attack(); L.caption('발동 뒤 다시 첫 번째 공격'); }),
                at(5.7, async () => { L.aura({ count: 2 }); L.caption('두 번째 공격으로 첫 적 처치'); await L.kill(); }),
                at(7.6, () => { L.aura({ count: 0 }); L.attack({ extraHits: [stake(L)], cues: ['demonHunter'] }); L.caption('박자가 이어져 둘째 적에게 고정 피해'); })
            ]);
            await L.wait(1.4);
        },
        signals: [
            { label: '세 번째 직접 공격: 최대 HP 6% 고정 피해', run: L => { L.aura({ count: 0 }); L.attack({ extraHits: [stake(L)], cues: ['demonHunter'] }); } },
            { label: '공격 한 번(세 번째면 발동)', run: L => {
                const count = auraOf(L, 'count');
                if (count >= 2) { L.aura({ count: 0 }); L.attack({ extraHits: [stake(L)], cues: ['demonHunter'] }); }
                else { L.aura({ count: count + 1 }); L.attack(); }
            } }
        ],
        controls: [{ key: 'count', label: '지난 발동 뒤 직접 공격 수(2면 다음 공격이 발동)', type: 'range', min: 0, max: 2 }],
        notes: [
            '직접 공격(내가 행동해서 한 일반 공격과 스킬, 피해를 주는 증강 스킬 포함)만 셉니다. 천사, 기병, 떠다니는 검 같은 소환수와 지속 피해는 세지 않습니다. 연격은 한 번이고, 검무는 8타가 각각 직접 공격입니다.',
            '추가 피해는 그 공격에 "악마 사냥꾼" 고정 피해 타격으로 붙습니다. 지금 대상의 최대 HP 기준이고, 방어력과 다른 피해 증가(원펀치 룰의 2배 포함)의 영향을 받지 않습니다.',
            '세 번째 공격 박자는 탐험 내내 이어집니다. 2마리 전투의 둘째 적과 다음 전투로도 이어집니다.'
        ],
        live: '직접 공격 세 번째마다 대상 최대 HP의 6%가 고정 피해로 붙습니다. "증강 상태 채우기"를 누르면 다음 공격이 세 번째가 됩니다. 실전의 적은 실제 체력이라 고정 피해도 실제 크기로 보입니다. "적 HP 1"로 첫 적을 쓰러뜨려도 박자는 둘째 적으로 이어집니다. 실험실의 "새 전투 시작"은 탐험을 새로 시작하므로 박자도 처음부터 셉니다.'
    });

    // 갑옷 깎아내기: 적중한 직접 공격마다 대상 방어력 -6%, 최대 -30%(run.battle.prism.shred, 적 한 마리마다). 깎인 값은 다음 공격부터 적용되고,
    // 30%가 된 공격에 armorShred.max가 붙는다. 피해 배율은 실험자의 실제 전투(적 방어력 50, 내 방어 관통 18)에서 방어력이 깎인 만큼이다.
    const shredHit = (L, shred, k) => jitter(L.atk * (k || 1) * (100 + 32) / (100 + Math.max(0, 50 * (1 - shred) - 18)), .02);
    AugLab.define('armorShred', {
        aura: { percent: 0 },
        demo: async L => {
            await timeline(L, [
                at(0, () => L.caption('갑옷 깎아내기: 직접 공격마다 방어력 -6%')),
                at(.8, () => { L.aura({ percent: 6 }); L.attack({ hits: [shredHit(L, 0)] }); L.caption('첫 공격이 맞자 방어력 -6%'); }),
                at(1.8, () => { L.aura({ percent: 12 }); L.attack({ hits: [shredHit(L, .06)] }); L.caption('깎인 방어력은 다음 공격부터 적용'); }),
                at(2.8, () => { L.aura({ percent: 18 }); L.skill(null, { hits: [shredHit(L, .12, 1.8)] }); L.caption('스킬도 맞히면 깎습니다, -18%'); }),
                at(ENEMY, () => L.enemy()),
                at(3.8, () => { L.aura({ percent: 24 }); L.attack({ hits: [shredHit(L, .18)] }); L.caption('방어력 -24%, 피해가 조금씩 커집니다'); }),
                at(4.8, () => { L.aura({ percent: 30 }); L.attack({ hits: [shredHit(L, .24)], cues: ['armorShred.max'] }); L.caption('다섯 번째 적중: 최대치 -30%'); }),
                at(5.9, () => { L.aura({ percent: 30 }); L.attack({ hits: [shredHit(L, .30)] }); L.caption('-30%에서 더 깎이지 않습니다'); }),
                at(6.9, async () => { L.caption('첫 적 처치'); await L.kill({ hits: [shredHit(L, .30)] }); L.aura({ percent: 0 }); L.caption('둘째 적은 방어 감소 0%부터'); }),
                at(9.3, () => { L.aura({ percent: 6 }); L.attack({ hits: [shredHit(L, 0)] }); L.caption('둘째 적의 방어력을 다시 -6%'); })
            ]);
            await L.wait(1.4);
        },
        signals: [
            { label: '다섯 번째 적중: 방어력 -30% 도달', run: async L => {
                // 이미 -30%면 금이 덜 간 모습에서 다시 달아오르게 한다.
                if (auraOf(L, 'percent') >= 30) { L.aura({ percent: 24 }); await L.wait(.6); }
                L.aura({ percent: 30 }); L.attack({ hits: [shredHit(L, .24)], cues: ['armorShred.max'] });
            } },
            { label: '공격 한 번(방어력 -6%, 30%에서 멈춤)', run: L => {
                const before = Math.min(30, auraOf(L, 'percent')), next = Math.min(30, before + 6);
                L.aura({ percent: next }); L.attack({ hits: [shredHit(L, before / 100)], cues: next >= 30 && before < 30 ? ['armorShred.max'] : [] });
            } }
        ],
        controls: [{ key: 'percent', label: '대상 방어력 감소(%)', type: 'range', min: 0, max: 30, step: 6 }],
        notes: [
            '적중한 직접 공격(일반 공격과 스킬, 적의 보호막에 막힌 공격 포함)마다 6%씩, 최대 30%까지 깎습니다. 검무는 8타가 각각 직접 공격이라 한 번에 최대치까지 깎습니다. 피해가 0인 공격, 지속 피해, 소환수의 공격은 깎지 않지만 깎인 방어력은 소환수의 피해에도 적용됩니다.',
            '깎인 방어력은 다음 공격부터 적용됩니다. 그래서 첫 공격에는 감소가 없고, 다섯 번째 적중 뒤에 30%가 됩니다. 방어력을 비율로 깎아 방어력 50이면 30%에서 35가 됩니다.',
            '방어 감소는 적에게 붙는 상태라 2마리 전투의 둘째 적은 0%부터 다시 깎습니다.',
            '깎인 방어력은 증강이 따로 내리치는 피해(신성한 번개, 정복자의 기병, 떠다니는 검, 천사, 백화요란)에도 적용됩니다.'
        ],
        live: '일반 공격이나 스킬을 맞힐 때마다 방어력이 6%씩 깎여 다섯 번째에 -30%가 됩니다. "증강 상태 채우기"를 누르면 발동 직전까지 깎아 둡니다. "적 HP 1"로 첫 적을 쓰러뜨리면 둘째 적은 0%부터 다시 깎습니다.'
    });
})();
