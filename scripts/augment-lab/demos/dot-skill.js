// 증강 연출 흐름: 지속 피해와 스킬 계열(취약, 꺼지지 않는 불꽃, 움직일수록 깊게, 리플레이, 선택의 시간, 주문의 계절).
// 형식은 ../lab.js의 AugLab.define 설명을 본다. 사건과 지속 상태의 모양은 docs/paradise-augment-fx.md, 서버의 실제 순서는
// paradise_prism.js(증강), paradise_mechanics.js(지속 피해 틱, 취약의 치명타), rpgenius.js(공격, 적의 행동, 리플레이)를 따른다.
// 시간은 서버 값이다: 지속 피해 틱 2초(addDot), 일반 적의 공격 3.5초(겨울 4.5초), 새 적의 첫 공격은 나온 뒤 3.5초.
// 플레이어 행동만 보기 좋게 1초 남짓으로 당겼다(실제 행동 쿨타임 2~3초). 스킬 쿨타임(자인 8초)은 화면에 보일 때만 지킨다.
(function () {
    'use strict';
    const CRIT = 1.9;                  // 치명타 틱의 피해 배수(실험자 캐릭터 기준 어림)
    const SEASONS = ['spring', 'summer', 'autumn', 'winter'];
    // 흐름 시계: at(초)는 흐름을 시작한 뒤 그 초가 될 때까지 기다린다. 앞의 일이 늦어져도 틱과 적 공격의 주기가 밀리지 않는다.
    function clock(L) { const start = L.now(); return seconds => L.wait(Math.max(0, seconds - (L.now() - start) / 1000)); }
    const vary = (value, spread) => Math.max(1, Math.round(value * (1 + (Math.random() * 2 - 1) * (spread == null ? .03 : spread))));
    // 받침에 맞는 조사(자인을, 자인은).
    const josa = (word, withFinal, withoutFinal) => { const code = String(word).charCodeAt(String(word).length - 1) - 0xac00; return word + (code >= 0 && code < 11172 && code % 28 ? withFinal : withoutFinal); };
    // 실험자 캐릭터의 일반 스킬(빵귤의 자인). 무대 HUD의 첫 스킬이다.
    const baseSkill = L => (L.model.skills || []).find(skill => !skill.augmentSkill) || null;
    const mainSkill = L => (baseSkill(L) || {}).name || '자인';
    // L.skills()는 내 캐릭터 스킬을 처음 값(쿨타임 0, 원래 MP)으로 다시 만든다(lab.js baseSkills). L에는 그 스킬의 쿨타임과 MP를 고칠 도구가 없어서,
    // 화면에 보여야 할 때만 L.skills() 다음에 무대 모델의 그 스킬을 직접 고친다. labMp는 고치기 전의 MP 소모량이다.
    function patchBase(L, patch) { const skill = baseSkill(L); if (!skill) return; if (skill.labMp == null) skill.labMp = skill.mpCost; Object.assign(skill, patch); L.player({}); }
    const baseMp = L => { const skill = baseSkill(L) || {}; return Number(skill.labMp != null ? skill.labMp : skill.mpCost || 0); };
    const baseCooldown = L => (parseFloat((baseSkill(L) || {}).cooltimeText) || 8) * 1000;
    const spendMp = (L, cost) => L.player({ mp: Math.max(0, Number(L.model.player.mp) - cost) });
    function heal(L, hp, mp) { const p = L.model.player; L.player({ hp: Math.min(p.maxHp, p.hp + Math.round(p.maxHp * hp)), mp: Math.min(p.maxMp, p.mp + Math.round(p.maxMp * mp)) }); }
    // 무대의 실제 스킬 이름(장면 단추와 조절 칸이 정의될 때는 무대가 아직 없을 수 있다).
    function stageSkill() { try { return document.getElementById('stage').contentWindow.AugStage.scene.battle.skills[0].name || '자인'; } catch (_) { return '자인'; } }
    // 화상 틱은 화속성으로 온다(takeTicks의 element). 출혈 틱은 속성이 없다.
    const flameTick = (L, crit, more) => { const damage = vary(L.atk * .25); return L.tick('꺼지지 않는 불꽃', { dot: true, crit, damage: crit ? Math.round(damage * CRIT) : damage, cues: ['eternalFlame'].concat(more || []), extra: { effectElement: '화' } }); };
    const bleedTick = (L, crit, more) => { const damage = vary(L.atk * 1.5, .02); return L.tick('행동성 출혈', { dot: true, crit, damage: crit ? Math.round(damage * CRIT) : damage, cues: ['deepeningBleed'].concat(more || []) }); };
    const burnTick = L => L.tick('여름의 열기', { dot: true, damage: vary(L.atk * .5), cues: ['seasons.burn'], extra: { effectElement: '화' } });
    const ignite = L => L.cue(['eternalFlame.ignite'], 'target', { actor: 'player' });

    // 취약: 지속 피해 틱(paradiseDot)이 내 치명타 확률과 치명타 피해량으로 치명타를 굴린다(paradise_mechanics.modifyHit).
    // 치명타가 난 틱에는 그 틱의 신호 뒤에 augment:dotCritical이 붙는다. 지속 상태는 id만 있다(대상 위를 옮겨 다니는 급소의 반짝임).
    // 지속 피해가 있어야 보이므로 꺼지지 않는 불꽃을 함께 켠다.
    AugLab.define('dotCritical', {
        aura: {},
        auras: { eternalFlame: { burning: true } },
        demo: async L => {
            const at = clock(L);
            L.caption('꺼지지 않는 불꽃이 2초마다 타고 있습니다');
            await at(.6); flameTick(L);
            await at(1.4); L.attack();
            await at(2.0); L.enemy();
            await at(2.6); flameTick(L); L.caption('보통의 틱: 치명타 없음');
            await at(3.4); L.attack();
            await at(4.6); flameTick(L, true, ['dotCritical']); L.caption('취약: 지속 피해 틱이 치명타로 터집니다');
            await at(5.5); L.enemy();
            await at(6.0); L.skill();
            await at(6.6); flameTick(L); L.caption('확률과 피해량은 내 치명타 능력치 그대로');
            await at(7.6); L.attack();
            await at(8.6); flameTick(L, true, ['dotCritical']); L.caption('다시 치명타: 급소가 깨지는 빛');
            await at(9.0); L.enemy();
            await at(9.6); L.attack();
            await at(10.6); flameTick(L); L.caption('치명타가 아니면 평범하게 탑니다');
            await at(11.4);
        },
        signals: [
            { label: '불꽃 틱이 치명타로 터짐', run: L => { L.auraOf('eternalFlame', { burning: true }); flameTick(L, true, ['dotCritical']); } },
            { label: '출혈 틱이 치명타로 터짐(적이 행동할 때)', run: L => {
                const entry = L.model.auras.find(item => item.id === 'deepeningBleed'), left = entry && entry.left > 0 ? entry.left : 5;
                L.auraOf('deepeningBleed', { left: left - 1 }); L.enemy(); bleedTick(L, true, ['dotCritical']);
            } },
            { label: '치명타가 아닌 틱(견주어 보기)', run: L => { L.auraOf('eternalFlame', { burning: true }); flameTick(L); } }
        ],
        notes: [
            '지속 피해 틱마다 내 치명타 확률로 치명타를 굴리고, 터지면 내 치명타 피해량만큼 커집니다. 꺼지지 않는 불꽃, 여름의 열기, 고통스러운 상처, 행동성 출혈과 장비나 캐릭터 스킬의 화상이 대상입니다.',
            '정복자의 기병, 떠다니는 검, 천사의 공격은 소환수 공격이라 지속 피해가 아닙니다. 취약이 있어도 치명타가 나지 않습니다.',
            '결실과 운명의 수동변속이 막는 것은 직접 공격의 자연 치명타뿐입니다. 지속 피해의 치명타는 그대로 터지고 결실의 치명타 피해량 +100%도 받습니다.',
            '지속 피해의 치명타는 운명 중첩과 고통스러운 상처의 치명타 수에 들어가지 않습니다.'
        ],
        live: '취약만으로는 지속 피해가 생기지 않습니다. 함께 가질 증강에 꺼지지 않는 불꽃을 더하고 새 전투 시작을 누르세요. 2초마다 타는 불꽃 가운데 치명타가 난 틱에서 급소가 깨지는 장면이 나옵니다. 치명타는 내 치명타 확률로 정해지므로 몇 번 기다려야 할 수 있습니다.'
    });

    // 꺼지지 않는 불꽃: 적이 나올 때마다(2마리 전투의 둘째 적 포함) onBattle이 화상(2초마다 공격력의 25%, 사실상 끝나지 않음)을 붙이고
    // 점화 신호를 공격 없는 증강 사건(action 'augment', 적 쪽)으로 보낸다. 틱은 '꺼지지 않는 불꽃' 이름의 지속 피해 틱이다.
    AugLab.define('eternalFlame', {
        aura: { burning: true },
        demo: async L => {
            const at = clock(L);
            // 전투 전에는 지속 상태가 없다. 지웠다가 점화와 함께 다시 넣어야 불이 실제처럼 그 순간 피어난다.
            L.aura(null); L.caption('전투가 시작되면 적에게 불을 붙입니다');
            await at(.8); L.aura({ burning: true }); ignite(L); L.caption('전투 시작: 불씨가 날아가 발밑에서 치솟습니다');
            await at(1.9); L.attack();
            await at(2.8); flameTick(L); L.caption('2초마다 공격력의 25% 화상 피해');
            await at(3.3); L.skill();
            await at(4.3); L.enemy();                     // 전투 시작 3.5초 뒤 적의 첫 공격
            await at(4.8); flameTick(L);
            await at(5.6); L.attack();
            await at(6.8); flameTick(L); L.caption('불은 적이 쓰러질 때까지 꺼지지 않습니다');
            await at(7.6); L.caption('첫 적 처치: 다음 적이 나옵니다'); await L.kill();
            // 둘째 적이 나오면 서버는 쓰러진 적의 화상을 지우고 새 적에게 다시 붙인다(burning은 계속 true).
            const next = clock(L);
            ignite(L); L.caption('둘째 적에게도 새로 불이 붙습니다');
            await next(1.1); L.attack();
            await next(2.0); flameTick(L); L.caption('둘째 적에서도 2초마다 탑니다');
            await next(2.8); L.attack();
            await next(3.5); L.enemy();
            await next(4.0); flameTick(L);
            await next(4.8);
        },
        signals: [
            { label: '전투 시작: 불씨가 날아가 불이 붙음', run: L => { L.aura(null); L.aura({ burning: true }); ignite(L); } },
            { label: '화상 틱(2초마다 공격력의 25%)', run: L => { L.aura({ burning: true }); flameTick(L); } }
        ],
        controls: [{ key: 'burning', label: '적의 발밑에서 불이 타는 중', type: 'toggle' }],
        notes: [
            '화상은 적이 나올 때마다 붙습니다. 2마리 전투의 둘째 적에게도 점화 장면과 함께 새로 붙고, 쓰러진 적의 화상은 함께 사라집니다.',
            '피해는 그 적이 나올 때의 공격력의 25%로 정해 두고 2초마다 방어력을 거쳐 들어갑니다. 전투 중에 공격력이 올라도 이미 붙은 화상은 그대로입니다.',
            '적이 쓰러질 때까지 꺼지지 않습니다. 지속 피해라 취약이 있으면 치명타가 날 수 있습니다.'
        ],
        live: '새 전투 시작을 누르면 적의 발밑에 푸른 불이 붙어 2초마다 탑니다. 적 HP 1을 누르고 공격해 첫 적을 쓰러뜨리면 둘째 적에게 다시 붙습니다. 다만 지금 실전 화면은 화면을 새로 연 직후의 첫 적과 둘째 적의 점화 장면을 건너뜁니다(화면 쪽 문제로 따로 보고했습니다). 점화 장면은 두 적을 쓰러뜨리고 성장 선택을 마친 다음 전투의 시작에서 보입니다.'
    });

    // 움직일수록 깊게: 2마리 전투의 첫 일반 공격(prismBleed)이 출혈 5회를 남긴다(bleedLeft, 피해는 그때 공격력의 150%로 고정).
    // 적이 행동할 때마다(advanceParadiseCombat, 반격 포함) 적의 사건 바로 뒤에 '행동성 출혈' 지속 피해 틱이 같은 응답으로 온다.
    // bleedApplied는 둘째 적에도 남고 bleedLeft만 지워지므로, 둘째 적에게는 출혈이 다시 걸리지 않는다.
    const bleedLeft = L => Number(L.state && L.state.left || 0);
    function bleedOnce(L, left, avoided) { L.aura({ left }); L.enemy(avoided ? { avoided: true } : {}); bleedTick(L); }
    AugLab.define('deepeningBleed', {
        aura: { left: 0 },
        demo: async L => {
            const at = clock(L);
            L.caption('전투 시작: 아직 출혈이 없습니다');
            await at(.8); L.aura({ left: 5 }); L.attack({ cues: ['deepeningBleed.apply'] }); L.caption('첫 일반 공격이 출혈을 남깁니다(5회)');
            await at(2.2); L.attack(); L.caption('다음 일반 공격은 출혈을 다시 걸지 않습니다');
            await at(3.5); bleedOnce(L, 4); L.caption('적이 공격하면 출혈이 터집니다(4회 남음)');
            await at(4.8); L.skill();
            await at(6.0); L.attack();
            await at(7.0); bleedOnce(L, 3, true); L.caption('회피해도 적이 행동해 터집니다(3회 남음)');
            await at(8.2); L.attack();
            await at(9.4); L.attack();
            await at(10.5); bleedOnce(L, 2); L.caption('출혈 2회 남음');
            await at(11.6); L.caption('첫 적 처치: 남은 출혈은 사라집니다'); await L.kill();
            L.aura({ left: 0 }); L.caption('둘째 적에게는 출혈이 다시 걸리지 않습니다');
            const next = clock(L);
            await next(1.0); L.attack();
            await next(2.2);
        },
        signals: [
            { label: '첫 일반 공격: 출혈을 남김(5회)', run: L => { L.aura({ left: 5 }); L.attack({ cues: ['deepeningBleed.apply'] }); } },
            { label: '적이 공격하면 출혈이 한 번 터짐', run: async L => { if (!bleedLeft(L)) { L.aura({ left: 5 }); await L.wait(.4); } bleedOnce(L, bleedLeft(L) - 1); } },
            { label: '회피한 공격에도 출혈이 터짐', run: async L => { if (!bleedLeft(L)) { L.aura({ left: 5 }); await L.wait(.4); } bleedOnce(L, bleedLeft(L) - 1, true); } },
            { label: '다섯 번째 출혈: 핏방울이 모두 사라짐', run: async L => { if (bleedLeft(L) !== 1) { L.aura({ left: 1 }); await L.wait(.4); } bleedOnce(L, 0); } }
        ],
        controls: [{ key: 'left', label: '남은 출혈 수(0이면 출혈 없음)', type: 'range', min: 0, max: 5 }],
        notes: [
            '출혈은 2마리 전투에서 한 번, 첫 일반 공격에만 남습니다. 스킬을 먼저 써도 첫 일반 공격을 기다리고, 검무도 일반 공격으로 셉니다.',
            '적이 행동할 때마다 한 번 터집니다. 회피하거나 막아 낸 공격과 결투 신청, 원펀치 룰의 반격도 행동으로 셉니다.',
            '첫 적이 쓰러지면 남은 출혈은 사라지고 둘째 적에게는 다시 걸리지 않습니다.',
            '피해는 출혈을 남긴 순간의 공격력의 150%로 정해 두고 매번 방어력을 거쳐 들어갑니다. 지속 피해라 취약이 있으면 치명타가 날 수 있습니다.'
        ],
        live: '새 전투 시작 뒤 첫 일반 공격이 출혈을 남깁니다. 적이 바로 공격을 누르면 적이 행동할 때마다 출혈이 한 번씩 터지는 것을 볼 수 있습니다. 적 HP 1을 누르고 공격해 첫 적을 쓰러뜨리면 둘째 적에게는 출혈이 걸리지 않습니다. 증강 상태 채우기를 누르면 발동 직전 상태로 맞춰 둡니다.'
    });

    // 리플레이: 마지막으로 쓴 일반 스킬(lastSkill, 탐험 내내 남음)을 자원 없이 다시 쓴다(rpgenius.replayParadiseSkill).
    // 사건은 다시 쓴 스킬 자신의 스킬 사건이고 augment:replay가 얹힌다. 그 스킬의 쿨타임은 그대로, 리플레이에는 30초 쿨타임이 돈다.
    AugLab.define('replay', {
        aura: { skill: null },
        skills: [{ name: '리플레이', disabledReason: '다시 쓸 스킬 없음' }],
        demo: async L => {
            const at = clock(L), name = mainSkill(L);
            L.caption('리플레이: 아직 다시 쓸 스킬이 없습니다');
            await at(.8); L.attack(); L.caption('일반 공격은 기억하지 않습니다');
            await at(2.0);
            const ready = L.now() + baseCooldown(L);
            L.aura({ skill: name }); L.skills([{ name: '리플레이' }]); patchBase(L, { cooldownEnd: ready }); spendMp(L, baseMp(L)); L.skill(name);
            L.caption(josa(name, '을', '를') + ' 쓰자 리플레이가 켜집니다');
            await at(2.9); L.enemy();
            await at(3.6); L.attack(); L.caption(josa(name, '은', '는') + ' 쿨타임 중입니다');
            await at(5.0);
            L.skills([{ name: '리플레이', cooldownEnd: L.now() + 30000 }]); patchBase(L, { cooldownEnd: ready });
            L.skill(name, { cues: ['replay'] }); L.caption('리플레이: ' + josa(name, '을', '를') + ' MP 없이 한 번 더');
            await at(6.4); L.enemy();
            await at(7.0); L.attack(); L.caption(name + '의 쿨타임은 그대로, 리플레이는 30초');
            await at(8.4);
        },
        signals: [
            { label: '리플레이: 마지막 스킬을 MP 없이 한 번 더', run: L => {
                const name = mainSkill(L);
                L.aura({ skill: name }); L.skills([{ name: '리플레이', cooldownEnd: L.now() + 30000 }]); L.skill(name, { cues: ['replay'] });
            } }
        ],
        controls: [{ key: 'skill', label: '다시 쓸 스킬', type: 'choice', get options() { const name = stageSkill(); return [{ label: '없음', value: null }, { label: name, value: name }]; } }],
        notes: [
            '다시 쓰는 스킬은 마지막으로 쓴 내 캐릭터의 일반 스킬(두 가지 정체성으로 얻은 스킬 포함)이나 검무입니다. 궁극기와 운명, 명계의 부름, 변속, 간파는 다시 쓸 수 없고, 써도 기억한 스킬이 바뀌지 않습니다.',
            '다시 쓴 스킬은 MP를 쓰지 않고 그 스킬의 쿨타임도 건드리지 않습니다. 쿨타임 중인 스킬도 다시 쓸 수 있습니다.',
            '리플레이도 행동 한 번을 씁니다. 쿨타임 30초에는 스킬 쿨타임 감소와 가을의 효과가 적용됩니다.',
            '기억한 스킬은 탐험 내내 남아 다음 전투에서도 바로 쓸 수 있습니다. 다시 쓴 스킬도 스킬을 쓴 것으로 쳐서 계절을 바꾸고 선택의 시간의 표식을 남깁니다.'
        ],
        live: '자인을 한 번 쓰면 리플레이 단추가 켜집니다. 리플레이를 누르면 자인이 MP 없이 다시 나가고 자인의 쿨타임은 그대로입니다. 리플레이 쿨타임은 30초이고 쿨타임 초기화로 바로 다시 쓸 수 있습니다. 증강 상태 채우기를 누르면 발동 직전 상태로 맞춰 둡니다.'
    });

    // 선택의 시간: 궁극기가 아닌 스킬이 적중하면(적이 살아 있을 때) 표식(b.marked)을 남긴다. 표식이 있으면 다음 직접 공격이 소비한다:
    // 스킬은 '표식 폭발'(대상 최대 HP 10%, 방어력을 거치는 일반 피해) 타격이 같은 사건에 붙고, 일반 공격은 최대 HP와 MP의 10%를 회복한다. 소비한 공격은 새 표식을 남기지 않는다.
    const burstHit = L => ({ damage: Math.round(Number(L.model.target.maxHp || 0) * .10), label: '표식 폭발' });
    async function marked(L) { if (!(L.state && L.state.marked)) { L.aura({ marked: true }); await L.wait(.5); } }
    AugLab.define('timeOfChoice', {
        aura: { marked: false },
        demo: async L => {
            const at = clock(L), name = mainSkill(L), cost = baseMp(L);
            L.caption('일반 스킬로 공격하면 적에게 표식이 남습니다');
            await at(.6); L.aura({ marked: true }); spendMp(L, cost); L.skill(name, { cues: ['timeOfChoice.mark'] });
            await at(2.0); L.aura({ marked: false }); spendMp(L, cost); L.skill(name, { cues: ['timeOfChoice.burst'], extraHits: [burstHit(L)] }); L.caption('표식이 있을 때 스킬: 표식 폭발');
            await at(3.1); L.caption('폭발은 대상 최대 HP의 10% 일반 피해(방어력 적용)');
            await at(3.5); L.enemy();
            await at(4.4); L.aura({ marked: true }); spendMp(L, cost); L.skill(name, { cues: ['timeOfChoice.mark'] }); L.caption('다시 스킬로 공격해 표식을 남깁니다');
            await at(5.9); L.aura({ marked: false }); heal(L, .10, .10); L.attack({ cues: ['timeOfChoice.heal'] }); L.caption('표식이 있을 때 일반 공격: HP와 MP 10% 회복');
            await at(7.0); L.enemy();
            await at(7.4); L.caption('표식을 소비한 공격은 새 표식을 남기지 않습니다');
            await at(8.4); L.attack(); L.caption('표식이 없으니 일반 공격은 그대로입니다');
            await at(9.8);
        },
        signals: [
            { label: '스킬 적중: 표식을 남김', run: L => { L.aura({ marked: true }); L.skill(mainSkill(L), { cues: ['timeOfChoice.mark'] }); } },
            { label: '스킬: 표식 폭발(최대 HP 10%)', run: async L => { await marked(L); L.aura({ marked: false }); L.skill(mainSkill(L), { cues: ['timeOfChoice.burst'], extraHits: [burstHit(L)] }); } },
            { label: '일반 공격: 표식을 소비해 HP와 MP 회복', run: async L => { await marked(L); L.aura({ marked: false }); heal(L, .10, .10); L.attack({ cues: ['timeOfChoice.heal'] }); } }
        ],
        controls: [{ key: 'marked', label: '적에게 표식이 있음', type: 'toggle' }],
        notes: [
            '표식은 궁극기가 아닌 스킬이 적중하고 적이 살아 있을 때 남습니다. 운명, 명계의 부름 같은 증강 스킬과 리플레이로 다시 쓴 스킬도 남깁니다.',
            '표식이 있을 때 스킬은 표식을 터뜨려 대상 최대 HP의 10%를 피해로 더합니다. 고정 피해가 아닌 일반 피해라 적의 방어력에 줄어듭니다(갑옷 깎아내기와 죽을 각오로가 적용됩니다). 궁극기로도 터뜨릴 수 있고, 터뜨린 스킬은 새 표식을 남기지 않습니다.',
            '표식이 있을 때 일반 공격은 표식을 소비해 최대 HP와 MP의 10%를 회복합니다. 검무도 일반 공격으로 쳐서 첫 타가 표식을 소비합니다.',
            '표식은 적의 몸에 붙어 있어 2마리 전투의 둘째 적에게 넘어가지 않습니다.'
        ],
        live: '자인으로 공격하면 적에게 표식이 남습니다. 그다음 쿨타임 초기화를 누르고 자인을 다시 써서 표식을 터뜨리거나, 일반 공격으로 표식을 소비해 회복을 보세요. 회복은 내 HP 25%를 먼저 누르면 잘 보입니다. 증강 상태 채우기를 누르면 발동 직전 상태로 맞춰 둡니다.'
    });

    // 주문의 계절: 궁극기가 아닌 스킬을 쓰면(onSkillUsed, 피해 계산 전) 계절이 한 칸 돌고 그 스킬 사건에 augment:seasons.<새 계절>이 붙는다.
    // 봄은 전투 중 1초마다 최대 HP 1% 회복(advance), 여름은 공격이 닿을 때마다 '여름의 열기'(2초마다 공격력의 50%, 3회)를 새로 건다.
    // 가을은 MP 소모와 스킬 쿨타임 -30%, 겨울은 적의 공격 간격 +1초. 스킬 MP는 바뀌기 전 계절로, 쿨타임은 바뀐 계절로 계산한다.
    const SEASON_SIGNALS = { spring: '봄으로: 덩굴이 감기고 꽃잎이 날림', summer: '여름으로: 머리 위에 한낮의 해', autumn: '가을로: 낙엽의 회오리', winter: '겨울로: 서리 결정과 눈' };
    // 가을에는 무대 HUD의 스킬 MP도 -30%로 보인다.
    const autumnMp = (L, on) => patchBase(L, { mpCost: on ? Math.round(baseMp(L) * .7) : baseMp(L) });
    AugLab.define('seasons', {
        aura: { season: 'spring' },
        demo: async L => {
            const at = clock(L), name = mainSkill(L), cost = baseMp(L), p = () => L.model.player;
            const regen = () => L.player({ hp: Math.min(p().maxHp, p().hp + Math.round(p().maxHp * .01)) });
            const turn = (season, paid) => { L.aura({ season }); spendMp(L, paid); L.skill(name, { cues: ['seasons.' + season] }); };
            L.caption('봄: 1초마다 최대 HP의 1% 회복');
            await at(.3); L.enemy();
            await at(1.3); regen();
            await at(1.6); L.attack();
            await at(2.3); regen();
            // 여름으로 바꾼 스킬이 닿으면 곧바로 화상이 걸린다(2초 뒤 첫 틱).
            await at(2.6); turn('summer', cost); L.caption(josa(name, '을', '를') + ' 쓰자 여름: 이 스킬부터 화상');
            await at(3.8); L.enemy();
            await at(4.6); burnTick(L); L.caption('여름의 열기: 2초마다 공격력의 50%');
            // 공격이 닿을 때마다 화상을 새로 걸어 6초와 다음 틱(2초)을 처음부터 다시 센다.
            await at(5.0); L.attack(); L.caption('공격이 닿으면 화상이 처음부터 다시 걸립니다');
            await at(7.0); burnTick(L); L.caption('새로 건 화상: 6초 동안 세 번, 1/3');
            await at(7.3); L.enemy();
            await at(7.6); turn('autumn', cost); autumnMp(L, true); L.caption('가을: MP 소모와 스킬 쿨타임 -30%');
            await at(9.0); burnTick(L); L.caption('가을에도 남은 화상은 탑니다, 2/3');
            await at(9.6); L.attack();
            await at(10.8); L.enemy();
            await at(11.0); burnTick(L); L.caption('화상 3/3: 6초가 지나 꺼집니다');
            // 가을에 쓴 스킬이라 MP는 -30%로 낸다. 겨울이 되면 HUD의 MP는 원래대로 돌아온다.
            await at(11.6); turn('winter', Math.round(cost * .7)); autumnMp(L, false); L.caption('겨울: 적의 행동 쿨타임 +1초');
            await at(13.0); L.attack();
            await at(14.3); L.enemy(); L.caption('이 공격 다음부터 적이 4.5초마다 옵니다');
            await at(15.2); turn('spring', cost); L.caption('다시 봄: 사계절이 한 바퀴 돌았습니다');
            await at(16.2); regen();
            await at(17.2); regen();
            await at(17.6);
        },
        signals: SEASONS.map((season, index) => ({
            label: SEASON_SIGNALS[season],
            run: async L => {
                const before = SEASONS[(index + 3) % 4];
                if ((L.state || {}).season !== before) { L.aura({ season: before }); autumnMp(L, before === 'autumn'); await L.wait(.5); }
                L.aura({ season }); autumnMp(L, season === 'autumn'); L.skill(mainSkill(L), { cues: ['seasons.' + season] });
            }
        })).concat([{ label: '여름의 열기 틱(2초마다 공격력의 50%)', run: L => { const now = (L.state || {}).season; if (now !== 'summer' && now !== 'autumn') { L.aura({ season: 'summer' }); autumnMp(L, false); } burnTick(L); } }]),
        controls: [{ key: 'season', label: '지금 계절', type: 'choice', options: [{ label: '봄', value: 'spring' }, { label: '여름', value: 'summer' }, { label: '가을', value: 'autumn' }, { label: '겨울', value: 'winter' }] }],
        notes: [
            '계절은 궁극기가 아닌 스킬을 쓸 때마다 바뀌고 탐험 내내 이어집니다. 증강 스킬과 리플레이로 다시 쓴 스킬도 바꾸고, 변속, 간파와 리플레이 자체는 바꾸지 않습니다.',
            '바뀐 계절은 그 스킬부터 적용됩니다. 여름으로 바꾼 스킬에 바로 화상이 붙고 쿨타임도 바뀐 계절로 셉니다. MP만 바뀌기 전 계절로 냅니다.',
            '여름의 열기는 겹치지 않고 공격(소환수의 공격 포함)이 닿을 때마다 새로 걸려 6초와 2초 틱을 처음부터 다시 셉니다. 그래서 공격 간격이 2초보다 짧으면(가속) 그사이의 틱이 나오지 않습니다. 의도와 다를 수 있습니다.',
            '봄의 회복은 전투 중에만 1초마다 들어갑니다. 겨울의 +1초는 적이 공격한 뒤의 다음 공격부터 붙어, 겨울 전에 잡힌 공격과 새 적의 첫 공격은 그대로 옵니다.'
        ],
        live: '자인을 쓸 때마다 계절이 봄, 여름, 가을, 겨울 순으로 바뀝니다. 쿨타임 초기화를 누르면 바로 다시 쓸 수 있습니다. 봄의 회복은 내 HP 25%를 누른 뒤 지켜보세요. 여름에는 공격이 닿을 때마다 적에게 화상이 걸립니다. 증강 상태 채우기를 누르면 발동 직전 상태로 맞춰 둡니다.'
    });
})();
