# 천상 증강 연출 계약 (2026-11 개편)

천상 증강 30종(`paradise_augments_prism.js`)이 전투 중에 보내는 신호와, 클라이언트가 그것을 그리는 규칙이다.
판정과 수치는 서버(`paradise_prism.js`)가 정한다. 연출은 서버가 보낸 사건과 상태를 보이는 것으로 옮길 뿐이다.

## 사건 (run.combatEvents → `ParadiseBattle.update(state, events)`)

기존 사건 모양은 그대로다: `{ id, at, enemyId, actor?, action, skillName, dot, triggeredEffectIds, hits, damage, receivedHits, received, criticalCount, targetHp, cleared, defeated, effectIds }`.
`combat-effects.js`의 `annotateEvent`가 `triggeredEffectIds`를 `effectIds`와 각 타격의 `effectIds`에 넣는다. 증강 id의 종류는 `augment`다(`augment:<id>[.<variant>]`, 우선순위 90).

| 사건 | 언제 | 증강 신호 |
| --- | --- | --- |
| 플레이어 공격 (`action: 'basic' \| 'skill'`) | 증강이 발동한 공격 | `triggeredEffectIds`에 `augment:*` |
| 지속 피해/소환수 틱 (`action: 'tick'`, `dot: true`) | 증강의 화상, 출혈, 소환수 공격 | `skillName`은 아래 한국어 이름, `triggeredEffectIds`에 `augment:*` |
| 적의 공격 (`actor: 'enemy'`) | 방어 증강이 발동한 피격, 맞공격 | `triggeredEffectIds`에 `augment:*`. 가시 갑옷 반사는 `reflectedHits: [{ damage, label: '가시 갑옷' }]` |
| 증강 신호 (`action: 'augment'`) | 공격이 없는 순간(전투 시작 등) | `triggeredEffectIds`, `effectTarget: 'actor' \| 'target'`, `hits: []`, `damage: 0`. 수치 없음, 돌진 없음 |
| 증강 스킬 (`action: 'skill'`) | 증강이 준 스킬 사용 | `skillName`: `운명`, `명계의 부름`, `검무`(8타), `변속`, `간파`(피해 없음, 시전자 쪽) |
| 처치 사건 (`cleared: true`) | 2마리 전투의 첫 적 처치 | `nextWave: 2, waveTotal: 2` (배너는 hfield가 이미 처리) |
| 반격 (`actor: 'enemy'`, `counter: true`) | 결투 신청(첫 일반 스킬), 원펀치 룰(일반 공격) | 같은 응답에서 플레이어 공격 사건 바로 뒤에 온다. 플레이어의 타격이 닿은 뒤에 보이도록 늦춘다. `triggeredEffectIds`에 `augment:duelChallenge.counter` / `augment:onePunch.counter` |
| 마지막 기회 시간 초과 (`action: 'augment'`, `defeated: true`) | 죽음을 초월하는 자의 10초가 지남 | `augment:transcendDeath.fail` |

### 검무: 한 타씩 보이기 (`strikes`)

검무는 서버에서 일반 공격 8번이지만(`rpgenius.js`의 `swordDanceInField`) 화면에는 검무 사건 하나와, 맞공격이 있으면 반격 사건 하나로 온다.

- `strikeInterval: 100`: 타 사이 간격(ms). 화면은 이 간격으로 한 타씩 보인다.
- `strikes[i] = { cues, auras }`: i+1번째 타에서 터진 신호와 그 타 직후의 지속 상태(`augmentAuras`와 같은 모양). 적을 쓰러뜨린 타는 `auras: null`이다(그 뒤는 다음 적의 상태라서).
- `hits[].strike`: 그 타격이 몇 번째 타인지(1~8). 같은 타에서 나온 타격은 같은 번호다.
- 사건 전체의 `triggeredEffectIds`는 모든 타의 합집합이다. 타마다 장면을 틀 때는 `strikes[].cues`를 쓴다.
- 반격 사건(`counter: true`)의 `receivedHits[].strike`: 그 맞공격이 몇 번째 타 뒤에 왔는지. 화면은 그 타 직후에 맞는다.
- hfield(embedded)는 타마다 신호 장면을 작은 변형(`minor`)으로 틀고, 지속 상태를 한 단계씩 바꾸며, 피해 숫자를 계단처럼 쌓는다. 낙원 화면의 칩은 아직 마지막 상태만 보인다.

### 2마리 전투: 다음 적으로 넘어갈 때

첫 적을 쓰러뜨린 사건(`cleared: true`, `nextWave: 2`)이 오면 hfield(embedded)는 처치 연출을 그대로 둔 채, 쓰러진 적을 `WAVE_FALL`(480 ms) 동안 흰 실루엣으로 바래게 하며 사라지게 하고 배너를 띄운다. 이어서 둘째 적이 `WAVE_ENTER`(420 ms) 동안 들어오고, HUD의 이름과 HP 막대도 함께 바뀐다. 마지막 적을 쓰러뜨릴 때는 이 쓰러짐 연출이 아직 없다.

### 발동 신호 목록

| id | 뜻 |
| --- | --- |
| `augment:fruition` | 결실: 3번째 공격의 확정 치명타 |
| `augment:deathWish.awaken` | 죽을 각오로: 이번 전투에서 HP가 처음 20% 미만이 된 피격 |
| `augment:conqueror.max` | 정복자: 10중첩 도달, 기병 소환 |
| `augment:conqueror.cavalry` | 정복자의 기병 공격(틱, `정복자의 기병`) |
| `augment:fatalDestiny.execute` | 운명 스킬의 처형 |
| `augment:holyLightning` | 신성한 번개 낙뢰 |
| `augment:dotCritical` | 취약: 지속 피해 치명타(틱) |
| `augment:eternalFlame.ignite` | 꺼지지 않는 불꽃 점화(전투 시작 신호 사건) |
| `augment:eternalFlame` | 화상 틱(`꺼지지 않는 불꽃`) |
| `augment:replay` | 리플레이로 다시 쓴 스킬의 사건에 얹힘(그 스킬 장면과 함께) |
| `augment:timeOfChoice.mark` / `.burst` / `.heal` | 표식 남김 / 스킬로 폭발 / 일반 공격으로 소비해 회복 |
| `augment:flyingSword.summon` | 떠다니는 검 소환 |
| `augment:flyingSword` | 떠다니는 검 공격(틱, `떠다니는 검`) |
| `augment:duelChallenge` | 결투 신청: 매 전투 첫 일반 스킬이 적에게 피해를 입힘(내 스킬 사건) |
| `augment:duelChallenge.counter` | 적의 즉시 반격, 피해 -75%(적 사건) |
| `augment:duelChallenge.haste` | 반격 직후 10초 동안 나와 적의 행동 쿨타임 -50% 시작(같은 적 사건에 함께 실림) |
| `augment:onePunch` | 원펀치 룰의 2배 일반 공격(매 일반 공격) |
| `augment:onePunch.counter` | 적의 맞공격(적 사건) |
| `augment:seasons.spring` / `.summer` / `.autumn` / `.winter` | 계절이 바뀐 스킬 사건(시전자 쪽) |
| `augment:seasons.burn` | 여름 화상 틱(`여름의 열기`) |
| `augment:manualShift.crit` | 변속으로 만든 확정 치명타 공격 |
| `augment:deepeningBleed.apply` | 출혈 부여(첫 일반 공격) |
| `augment:deepeningBleed` | 적이 행동할 때 출혈 발동(틱, `행동성 출혈`) |
| `augment:soulReaper.harvest` | 처치 사건: 영혼이 적에게서 플레이어에게 |
| `augment:readIntent.parry` | 간파로 무효화한 적 공격(적 사건) |
| `augment:timeRewind` | 되감기 발동(적 사건): HP가 3초 전으로 |
| `augment:demonHunter` | 악마 사냥꾼 추가 고정 피해 |
| `augment:angelDescent.descend` | 천사 강림(적 사건) |
| `augment:angelDescent` | 천사의 공격(틱, `천사`) |
| `augment:angelDescent.guard` | 천사가 막은 적 공격(적 사건) |
| `augment:transcendDeath.trigger` | HP 0, 마지막 기회 시작(적 사건) |
| `augment:transcendDeath.revive` | 기회 안에 처치, 부활(처치 사건) |
| `augment:transcendDeath.fail` | 기회 소진, 패배 |
| `augment:comboStaircase.3` | 3단계(최소 3연격) 일반 공격 |
| `augment:painfulWound.apply` / `augment:painfulWound` | 상처 부여 / 상처 틱(`고통스러운 상처`) |
| `augment:shieldSiphon` | 보호막 흡수 |
| `augment:armorShred.max` | 갑옷 깎아내기 -30% 도달 |
| `augment:thornArmor` | 가시 갑옷 반사(적 사건) |
| `augment:hundredFlowers.bloom` | 백화요란 만개 |

## 지속 상태 (`state.augmentAuras`)

hfield가 받는 전투 상태(`ParadiseBattle.update`의 `next`)에 `augmentAuras` 배열이 있다. 보유한 증강만 들어 있고, 상태가 바뀔 때마다 갱신된다. 시각은 서버 epoch ms(`clockOffset`으로 보정).

```js
{ id: 'conqueror', stacks, max: 10 }                 // stacks >= max면 기병이 곁에 있다
{ id: 'fatalDestiny', stacks }                        // 대상 위의 운명 중첩, 7이면 스킬 사용 가능
{ id: 'seasons', season: 'spring'|'summer'|'autumn'|'winter' }
{ id: 'manualShift', stacks, max: 3, armed }          // armed: 다음 공격 확정 치명타
{ id: 'soulReaper', souls }
{ id: 'readIntent', count, foresight: null | { damage, critical, avoided }, parry }  // foresight: 다음 적 공격의 예정 피해
{ id: 'timeOfChoice', marked }
{ id: 'flyingSword', swords, ready }                  // swords: 떠 있는 검 수, ready: 다음 일반 공격이 소환
{ id: 'deathWish', active }
{ id: 'eternalFlame', burning }
{ id: 'deepeningBleed', left }                        // 남은 발동 수(0~5)
{ id: 'angelDescent', until, used }                   // until > 지금이면 천사가 싸우는 중
{ id: 'transcendDeath', until, attacksLeft }          // until > 지금이면 마지막 기회 중(HP 0으로 표시)
{ id: 'hundredFlowers', flowers }
{ id: 'armorShred', percent }                         // 0~30
{ id: 'painfulWound', until, crits }                  // crits: 다음 상처까지 쌓인 치명타(0~4)
{ id: 'comboStaircase', step }                        // 다음 일반 공격의 최소 연격(1~3)
{ id: 'fruition', count } / { id: 'holyLightning', count } / { id: 'demonHunter', count }  // 지난 발동 뒤 공격 수(2면 다음이 발동)
{ id: 'timeRewind', used, guardUntil }
{ id: 'duelChallenge', stage: 'ready'|'pending'|'haste'|'done', until }  // haste: until까지 서로 가속(10초)
{ id: 'thornArmor' } { id: 'haste' } { id: 'onePunch' } { id: 'dotCritical' } { id: 'shieldSiphon' } { id: 'swordDance' }
{ id: 'replay', skill }                               // 다시 쓸 스킬 이름
{ id: 'dualIdentity', cardName }
```

같은 정보를 전투 화면 가장자리에 증강 그림으로도 보인다(아래 '전투 중 상태 표시'). 연출은 글자 대신 움직임과 빛으로 상태를 느끼게 한다.

## 전투 중 상태 표시 (`run.mechanicStatus`, 2026-11-19 개편)

예전의 글자 칩(스킬 단추 위 '정복자 9 / 10')을 없애고, 낙원 화면(`public/paradise.js`의 `augmentStatus`)이 증강 그림(`public/assets/paradise/augments/<id>.webp`)을 작은 문장으로 그린다.

- **자리**: 내 상태(`side: 'self'`)는 내 정보 카드 곁(데스크톱은 오른쪽, 세로 모바일은 아래, 가로 모바일은 카드 왼쪽), 적에게 걸린 상태(`side: 'enemy'`)는 적 체력 막대 아래 오른쪽 끝(적 머리 위)이다. 카드와 막대의 자리는 hfield의 `ParadiseBattle.hudRects()`가 마지막으로 그린 대로 준다. 봉인 배지와 겹치면 그 밑으로 비킨다. 자리가 모자라면 문장을 조금 줄이고, 그래도 넘치면 마지막 칸이 '+N'(누르면 전체 목록)이다.
- **서버 항목**(`paradise_prism.js`의 `statusView`): `{ id, side, label, value, max?, until?, total?, percent?, season?, ready?, dim?, urgent?, state }`. `value/max`는 둘레 눈금, `until/total`은 줄어드는 테두리와 남은 초, `percent`는 비율 호, `ready`는 증강 색으로 번지는 테두리, `dim`은 흐린 그림, `state`는 자세히 볼 때의 한 줄이다. 순서는 고정이라 표시가 자리를 바꾸지 않는다.
- **표시하는 증강**: 마지막 기회, 천사, 결투(대기와 가속 10초), 정복자, 결실, 변속, 영혼, 계절(내 상태), 방어 감소, 출혈, 상처(적). 신성한 번개, 치명적인 운명, 백화요란, 악마 사냥꾼, 선택의 시간, 읽어 낸 살의는 사용자 지시로 표시하지 않는다(전장 연출로만 보인다).
- **증강마다 다른 점**: 색(`STATUS_TONE`), 눈금 수(정복자 10, 출혈과 상처 5, 결실과 변속 3), 숫자(정복자와 영혼은 쌓인 수, 시간이 있는 것은 남은 초, 마지막 기회는 남은 횟수), 아래 패(방어 감소 비율). 계절은 그림 자체가 사계절 바퀴라 지금 계절이 맨 위로 오게 돌린다. 둘레를 도는 빛은 바로 써먹을 순간(결실과 변속의 다음 확정 치명타)에만 낸다.
- **자세히**: 마우스를 올리면(터치 기기는 누르면 4초) 증강 그림과 이름, `state` 한 줄, 증강 설명(`text`, `note`)이 뜬다. 데스크톱의 내 상태는 위로, 나머지는 아래로 띄운다.
- 증강이 아닌 천상 기능(돌, 예전 증강)의 상태는 `id`가 없어 같은 결의 작은 글자 패로 내 상태 줄 뒤에 붙는다.

## 파일과 책임

- `public/combat-fx-augments.js`: 증강 장면과 지속 상태 연출. `combat-fx-skills.js` 다음에 싣는다(`paradise_web.js`에 이미 연결).
- `public/hfield.js`: 천상(embedded) 연출 연결 부분만(지속 상태 동기화, `action: 'augment'` 사건, 예정 피해 표시).
- 그림: `public/assets/combat-fx/augments/`(연출용), `public/assets/paradise/augments/<id>.webp`(증강 카드 문장). 효과음: `public/assets/combat-fx/sfx/`와 `CREDITS.md`.
- 확인: 증강 연출 실험실 `scripts/augment-lab/`(`node scripts/augment-lab/server.js` → 4176). 증강마다 이 계약대로 만든 사건과 지속 상태를 실제 hfield에 넣어 보여 주고(`demos/*.js`), 실전은 메모리 DB의 실제 천상 전투다. 연출을 바꾸면 여기서 흐름 재생과 장면 단추로 확인한다. 개발용 패널은 `scripts/combat-fx-lab/paradise.html`(4173 `/lab/paradise`, 영문 id 단추와 검수용 촬영 도구).
