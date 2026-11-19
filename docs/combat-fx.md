# 전투 연출 (combat fx)

필드, 일일 던전, 훈련장, 부타게임 [H], 월드보스, PVP의 전투 이펙트를 그리는 계층이다.
이펙트 그림(`DB/RPGenius/ui/필드/이펙트/`, 512×512 PNG 224장, S3 자산)은 그대로 쓰고,
그 그림을 조각내고 입자로 풀고 흐르게 해서 시전자와 대상 사이의 장면으로 재생한다.
판정과 수치는 다루지 않는다. 서버가 보낸 사건을 보이는 것으로 옮길 뿐이다.

## 파일

| 파일 | 역할 |
| --- | --- |
| `public/combat-effects.js` | 사건에서 이펙트 id를 뽑는 기존 카탈로그. 바뀌지 않았다. |
| `public/combat-fx.js` | 엔진. 전투 캔버스 위에 WebGL 캔버스를 한 장 얹고 장면을 그린다. 화면 흔들림, 타격 정지, 효과음 재생도 맡는다. |
| `public/combat-fx-kit.js` | 재료집. 그림 없이 실시간으로 계산하는 재료(불, 구체, 광선, 충격파, 마법진, 결정, 번개, 참격 궤적, 화면 렌즈)의 셰이더와 그것을 부르는 도우미(`CombatFX.kit`). 엔진 다음, 장면집보다 먼저 싣는다. |
| `public/combat-fx-scenes.js` | 장면집. 전투 공통·속성·장비·세트 이펙트의 장면, 예전 그대로 두는 스킬(처형박수, 익테봇 소환, 자폭), 동행 소환수(익테봇, 수나타)가 여기 있다. |
| `public/combat-fx-skills.js` | 스킬 장면집. 나머지 스킬 42개의 장면. 재료집의 재료로 스킬마다 한 편의 장면을 짠다. 장면집 다음에 싣는다. |
| `public/assets/combat-fx/sfx/` | 효과음 88개. 출처와 가공 내용은 같은 폴더의 `CREDITS.md`. |
| `scripts/combat-fx-lab/` | 실험실. 게임 서버 없이 모든 장면을 재생해 본다. |
| `tests/combat_fx_scenes.test.js` | 모든 그림에 장면이 있는지, 장면이 부르는 소리와 조각이 실재하는지 확인한다. |

## 그림을 움직이는 방법

- **드러내기**: 그림을 한 방향(발사체, 참격), 중심에서 바깥(폭발), 아래에서 위(분출), 각도 순서(부채꼴 카드)로 그려 나가고 같은 순서로 지운다. 앞선 가장자리는 그림의 색으로 빛난다.
- **흐름**: 그림의 밝은 부분(불, 물, 기운)만 노이즈로 일렁이게 한다. 왕관이나 단두대 같은 단단한 부분은 덜 움직인다.
- **조각**: `F.parts(id, { 이름: { poly, pivot } })`로 그림 위의 다각형을 잘라 따로 움직인다. 처형박수의 불타는 두 손, 익테봇의 몸통과 날개 넷이 이렇게 나온다. `'~rest'`는 조각을 뺀 나머지 그림이다.
- **화소 입자**: 그림의 화소를 뽑아 입자로 쓴다. 그림이 제 색의 입자에서 모이고(`gather`), 맞은 자리에서 터지고(`shatter`), 대상에서 시전자로 흘러가고(`stream`), 위로 흩어진다(`rise`).
- **직접 그린 도형**: `F.paint(id, 너비, 높이, draw)`로 캔버스에 그린 실루엣을 텍스처로 쓴다. 처형박수의 박수 줄(검은 합장 손, 흰 테두리)과 검은 십자가가 이렇게 나온다.
- 고리, 섬광, 번개, 집중선, 육각 방벽 같은 보조 빛은 그림 없이 셰이더로 그린다. 색은 그림에서 가장 눈에 띄는 빛의 색을 뽑아 쓴다(`S.color()`).

## 실시간 재료 (2026-11-12)

그림을 옮기거나 키우는 것만으로는 정적으로 보인다. 스킬 장면은 아래 재료로 짜고, 원본 그림은 타격 순간의 빛깔(화소 입자)이나 짧은 강조로만 쓴다.

- **입자** `S.burst({...})`: 불티, 불씨, 연기, 파편, 물방울, 별, 동전, 카드, 음표, 0과 1. 태어날 때 한 번만 버퍼에 쓰고 그 뒤의 운동(속도, 감쇠, 중력, 흔들림, 크기와 색의 변화)은 정점 셰이더가 계산한다. 2048개짜리 버퍼 하나를 돌려 쓰고 그리기는 두 번(그림 뒤, 그림 앞)이다.
- **리본** `S.trail(종류, { path, head, tail, ... })`: 경로를 따라 그리는 띠. 참격(`slash`), 기운(`energy`), 번개(`bolt`), 물줄기(`water`), 사슬(`chain`), 먹(`ink`). `path(s, t)`가 시간을 받으므로 날갯짓처럼 스스로 움직이는 모양도 된다.
- **절차 셰이더 면** `S.field(이름, {...})`: `flame`, `orb`, `beam`, `shock`, `vortex`, `hole`, `circle`, `crack`, `smoke`, `rays`, `aura`, `crystal`, `comet`. `CombatFX.shader(이름, 본문)`으로 등록하고 처음 쓰일 때 컴파일한다(한가한 틈에 미리 만들어 둔다). 노이즈는 256² 텍스처에서 읽는다.
- **화면 렌즈** `S.lens(이름, {...})`: 전투 화면(호스트 캔버스)을 찍어 일그러뜨린다. 굴절하는 충격파(`ripple`), 화면 절단(`slice`), 유리처럼 깨짐(`shatter`), 빨려 듦(`pinch`), 무채색(`mono`), 지직거림(`glitch`), 방사형 번짐(`zoom`), 서리(`frost`). 찍힌 그림이 비어 있으면(호스트가 그리기 전) 그 렌즈는 그리지 않는다.
- **몸짓** `S.pose('a' | 't', {...})`: 시전자와 대상의 캐릭터 그림을 장면이 직접 움직인다(돌진, 도약, 회전, 사라짐, 넉백, 떨림, 번쩍임). 호스트가 `fx.pose(이름)`으로 읽어 반영한다. `dx`, `dy`는 픽셀, `sx`, `sy`는 발 기준 배율, `rot`은 몸 가운데 기준 기울기다. 끝날 때는 제자리로 돌려놓는다.
- 재료집의 도우미(`K.slash`, `K.dart`, `K.bolt`, `K.fire`, `K.impact` 등)가 위의 것들을 한 줄로 부른다.

## 장면 쓰기

모든 장면은 왼쪽의 시전자(`S.A`)가 오른쪽의 대상(`S.T`)을 치는 방향으로 쓴다. 상대가 쓰는 스킬처럼 방향이 반대이면 엔진이 뒤집어 그린다. 좌표는 화면 픽셀, 크기 단위는 `S.U`(화면 높이 기준)다.

```js
def(skill('정권'), { impact: .18, sounds: ['air_puff', 'punch_a'] }, S => {
    S.sfx('air_puff', 0, { vol: .55 }); S.sfx('punch_a', .18, { vol: .95 });
    sweep(S, { size: .58, t: .18, head: [.84, .52], native: 0, power: 1, zoom: .045 });
});
```

- `impact`는 장면이 대상에 닿는 시각(초)이다. 호스트는 이 시각에 피해 수치, 피격 반응, 타격음, 체력 표시를 낸다. 스킬은 시전하는 동안 전투가 멈추므로 늦어도 된다(일반 스킬 0.3~0.75초, 궁극기 1~1.5초). 전투 공통 이펙트는 0.6초를 넘기지 않는다.
- `hits`는 여러 번 때리는 스킬의 타수별 시각이다(포커 못 하시네의 아홉 장). 첫 값은 `impact`와 같다. `cast`는 장면이 끝나 전투를 다시 흘려도 되는 시각이다.
- 전투 공통·속성 이펙트(기본 공격, 치명타, 화상, 표식, 보호막, 회복, 강화와 약화 등)도 같은 재료로 짠다. 자주 나오므로 0.6초 안에 닿고, 전투를 멈추지 않으며, 화면 렌즈는 쓰지 않는다. 색은 그 이펙트의 그림에서 뽑아 채도를 올려 쓴다(`tint`). 맞은 쪽은 `hit`이 살짝 밀고 번쩍이게 한다.
- 장비와 세트의 발동은 `proc`이 그린다: 문장이 주인 어깨 위의 작은 진에서 맺히고, 공격이면 그 빛이 0.12초에 대상에게 꽂히고, 아니면 띠가 되어 주인에게 감겨 든다. 따로 적지 않은 장비와 세트도 이것으로 자동 재생되므로, 새 그림을 넣으면 코드 없이 나온다. 그림 원형은 익테봇 자폭이 쓰는 `pop`만 남아 있다.
- 스킬 장면은 호스트가 시전자 쪽 사건으로 불렀든 대상 쪽 사건으로 불렀든 같은 무대를 쓴다. 한 사건에서 스킬 id가 두 번 와도 한 번만 재생한다.
- 한 사건에 이펙트가 여럿이면 가장 무게 있는 것이 주 장면이고, 나머지(치명타, 속성, 장비 발동)는 작은 곁장면으로 주 장면의 타격 순간에 맞춰 터진다.
- 소리는 `S.sfx(이름, 시각)`으로 그 시각에 틀거나, `S.hit(이름, 시각)`으로 음원의 타격점이 그 시각에 오도록 앞당겨 튼다. 음원은 CC0로 배포된 녹음과 사용자가 직접 준 음원(처형박수)만 쓴다. 코드로 소리를 합성하지 않는다.

## 동행 소환수

서버가 `player.summons`(필드, 월드보스)와 `side.summon`(PVP)으로 유지 중인 소환수를 내려보내면, 호스트가 `CombatFX.companions(fx, 쪽, 목록, { src, dst })`를 부른다.
소환수는 주인 곁에 떠 있다가 `summon:익테봇 공격`, `summon:수나타 공격` 사건이 오면 직접 쏘고, `summon:익테봇 피해대행`이 오면 주인 앞으로 끼어들어 방벽으로 받는다. `자폭`은 곁의 소환수가 대상에게 날아가 터진다. 목록에서 빠지면 흩어져 사라진다.

## 호스트 연결

`public/hfield.js`, `public/pvp.js`, `public/worldboss.js`가 `CombatFX.create({ scene, muted })`로 엔진을 만든다. 엔진을 만들 수 없으면(WebGL 불가) 기존의 정적 그림 표시가 그대로 동작한다.
`fx.play(ids, { role, src, dst, event, hit, after, tags })`는 `{ delay, sound, count, hits, cast }`를 돌려준다. `delay`(ms) 뒤에 수치와 피격 반응을 내고, `hits`가 있으면 타수마다 그 시각에 낸다. `cast`(ms) 동안은 전투를 멈춘다. `tags: { a, t }`는 장면의 몸짓을 받을 캐릭터의 이름이다(`me`, `foe`, `opp`).

### 시전 중 일시 정지와 타격 순간의 반영

- 필드(`hfield.js`): 스킬을 쓰면 `cast`가 끝날 때까지 입력, 훈련장 자동 공격, 틱 갱신(폴링)을 쉰다. 대상의 체력 표시는 타격 순간까지 맞기 전 값으로 붙들어 둔다(`hud.holdTarget`).
- PVP(`pvp.js`): 사건을 큐에 넣어 한 번에 하나씩 보인다. 스킬 사건은 `cast`만큼 다음 사건(상대의 반격, 소환수, 지속 피해)을 기다리게 한다. 서버의 전투는 계속 흐르므로 멈추는 것은 보여 주는 순서다. 밀린 사건이 여섯 개를 넘으면 기다림을 줄인다. 결과 화면은 남은 사건을 다 보인 뒤에 띄운다.
- 월드보스(`worldboss.js`): `cast` 동안 입력과 갱신을 쉰다. 보스의 체력 표시도 타격 순간까지 붙든다.
- 천상과 지옥: 수치를 타격 순간에 띄우고, 잠금 시간에 `cast`를 반영한다.
- 기본 공격은 멈추지 않는다.

천상과 지옥(`paradise_web.js`, `FIELD_MODE=paradise`)은 `hfield.js`를 내장해 쓰므로 그 페이지도 `hfield.js`보다 먼저 엔진과 장면집을 싣는다. 연출 캔버스는 `#paBattle` 안의 `hfCanvas` 바로 뒤에 붙어 전투 화면과 함께 숨고 나타난다. 효과음은 낙원의 소리 끄기(`ParadiseAudio.muted`)를 따른다. 천상의 돌 던지기는 엔진을 쓰지 않고 기존의 자체 비행 연출(`flight`)을 그대로 쓴다.

### 궁극기 컷씬과의 순서

궁극기는 **컷씬이 먼저 나오고, 컷씬이 접힌 뒤에 장면이 시작한다**(사용자 지정 2026-11-12. 같은 날 앞서 정한 '함께 시작'에서 바뀌었다).

- 전투 화면은 컷씬을 `UltimateCutscene.create({ fold: .64 })`로 만든다. 클립을 길이의 64%만 보이고(1.8초 클립이면 1.15초) 띠를 0.15초에 위아래로 접는다. `play()`가 돌려주는 값이 접히기 시작하는 시각이다. 레이드는 이 옵션을 쓰지 않아 예전 길이 그대로다.
- 호스트는 그 값에서 70ms를 뺀 만큼을 `fx.play`의 `after`로 넘긴다. 엔진은 그만큼 뒤에 장면을 시작하고, `delay`, `hits`, `cast`에 그 시간을 더해 돌려준다.
- 스킬 장면은 타수마다 다시 요청되지만 장면이 끝날 때까지 다시 시작하지 않는다. 이 시간은 `after`와 장면의 길이(마지막 타격 + 0.7초)를 더한 것이다. 예전에 장면만 미루고 이 시간을 그대로 둬서 처형박수가 두 번 나온 적이 있다(`tests/combat_fx_replay.test.js`).
- 주 장면이 닿기 전에 오는 같은 사건의 곁장면(치명타, 속성, 장비 발동)은 그 타격 순간에 맞춰 터진다.

## 전투 수치 (`public/damage-numbers.js`, 2026-11-19)

필드(H필드, 일일 던전 포함), 천상, PVP, 월드보스의 피해, 회복, 처치 수치는 모두 공용 `DamageNumbers`가 그린다. 화면은 기준점과 뜻만 넘기고, 글꼴, 색, 움직임, 겹침 피하기, 그림 캐시는 이 모듈이 정한다.

- 쓰는 법: `this.pops = DamageNumbers.create({ reducedMotion })`, `this.pops.add({ x, y, start 또는 delay, amount, kind, critical, destiny, received, dot, minor, fixed, shield, label, ratio, chain, text })`, 그리는 곳은 `damageLayer(w,h){this.pops.draw(this.ctx,w,h);}`. `x, y`는 화면 비율, `kind`는 기본 피해 외에 heal, mana, guard, kill, miss, proxy, absorb, reflect.
- 모양: Black Han Sans 굵은 숫자(오기 전에는 Pretendard 900으로 그리고, 오면 다시 그림)에 두꺼운 외곽선과 세로 그라데이션(`TONES`). 크게 내리찍고 살짝 눌렸다가 느려지며 떠오른다. 치명타는 더 크고 붉게, 섬광과 베임 줄, 짧은 떨림. `치명타`, `운명`은 숫자 위의 기울어진 꼬리표(가운뎃점 없음). 대상 최대 HP에 견준 피해(`ratio`)가 클수록 최대 1.32배.
- 연타 합계: 3타 이상인 행동은 머리 위에 `N연타`와 합계가 타마다 올라가고 마지막 타에서 한 번 뛴다(받은 피해, 지속 피해, 소환수, 막힌 타격은 세지 않음).
- 겹침: 새 수치는 다른 수치의 지금 자리와 머물 자리를 피해 빈자리를 고른다. 천상 검무의 계단 배치는 그대로 두고 겹칠 때만 밀린다.
- 성능: 수치 하나(꼬리표, 숫자, 이름)를 한 장으로 미리 그려 두고 프레임마다 그 그림만 찍는다. 움직임 줄이기 설정이면 떨림, 내리찍기, 섬광 없이 페이드와 짧은 상승만.
- 페이지: `server.js`의 필드, H필드, 월드보스, PVP 페이지와 `paradise_web.js`, 실험실(`scripts/augment-lab/stage.html`, `scripts/combat-fx-lab/`)이 `combat-effects.js` 앞에 싣는다.
- 검수 화면: `tmp/damage-numbers-check/harness.html`(`node tmp/damage-numbers-check/shot.js [mobile] [reduced]`). `tmp/`는 git 밖이다.

## 실험실

```
node scripts/combat-fx-lab/server.js
```

- `http://localhost:4173/` 이펙트 목록에서 골라 재생. 좌우 반전, 소환수, 전체 재생.
- `/lab/field`, `/lab/pvp`, `/lab/worldboss` 실제 클라이언트 코드를 가짜 전투 API로 돌리는 모의 화면. 운영 데이터에 닿지 않는다.
- 이미지 자산은 git 밖에 있다. 다른 작업 사본에서 돌릴 때는 `RPG_UI_DIR`로 자산 폴더를, `RPG_UI_FALLBACK`(경로 목록)으로 그 폴더에 없는 자산(예: 궁극기 컷씬)을 찾을 폴더를 가리킨다. `PORT`로 포트를 바꾼다.
- 콘솔에서 `lab.sheet([[id, 초], ...], 열)`은 각 순간을 멈춰 한 화면에 타일로 모은다. 모의 화면에서는 `window.__freezeOn = { id, t }`로 그 이펙트가 재생된 t초 뒤에 멈춘다.

## 천상 증강 (2026-11-18)

천상 증강 30종의 전투 연출은 `public/combat-fx-augments.js`가 맡는다(스킬 장면집 다음에 싣는다). 서버가 보내는 신호와 상태의 모양은 `docs/paradise-augment-fx.md`가 정한다.

- **발동 장면** `augment:<id>[.<variant>]` 45개. 이펙트 그림이 없으므로 모두 `images: []`로 등록해 엔진이 `/rpg-ui`에서 없는 그림을 찾지 않게 한다. 공격에 얹히는 것은 0.6초 안에 닿고 전투를 멈추지 않는다. 드문 순간(천사 강림, 마지막 기회, 죽을 각오, 되감기, 처형)만 렌즈와 어둠을 쓴다.
- **증강이 준 스킬** `skill:운명`, `skill:명계의 부름`, `skill:검무`(8타, `hits`), `skill:변속`, `skill:간파`.
- **주인과 적**: 천상에서는 플레이어가 늘 왼쪽이다. 적의 사건으로 불린 장면은 엔진이 뒤집어 그리므로, 장면은 `side(S)`가 돌려주는 주인(`O`), 적(`E`), 방향(`d`), 몸짓 대상(`o`, `e`)으로 쓴다. `O`와 `E`에는 몸의 실제 범위(`top`, `bot`, `w`, `h`)가 들어 있다.
- **지속 상태** `CombatFX.augmentAuras(fx, state.augmentAuras, { clock, fig })`. 호스트가 매 프레임 불러도 된다: 목록(배열 참조)과 화면 배치가 그대로이면 바로 돌아온다. 증강마다 계속 남는 노드 한두 개가 `tick`에서 상태를 따라가고, 값이 바뀐 순간(중첩 획득, 꽃 한 송이, 영혼 하나)에는 작은 빛이 튄다. 서른 개를 다 가져도 노드는 90개 안쪽이다. `fig()`는 플레이어와 적의 몸이 차지하는 범위(화면 비율)를 돌려준다. 창 크기나 적이 바뀌면 다시 세운다.
- **글자가 필요한 표시** `CombatFX.augmentHud(fx, ctx, w, h, time)`: 읽어 낸 살의의 예정 피해를 HUD 캔버스에 그린다(눈 아래의 겹글자, 주사선, 눈금). 눈과 궤적은 연출 캔버스가 그린다.
- **그림**: 생성한 그림은 `public/assets/combat-fx/augments/`에 있고, 그 증강을 가졌을 때만 받는다. 엔진의 그림 표는 `/rpg-ui` 경로만 알기 때문에, 받은 뒤 `F.paint`로 등록해 쓴다. 받기 전에는 빛으로만 그린다(`pic(name)`이 null).

### 호스트 연결 (`public/hfield.js`, 천상 내장 경로만)

- `syncFx`가 지속 상태를 동기화한다. `augmentFigures()`가 몸의 범위를 계산한다.
- `action: 'augment'` 사건은 `augmentCue`가 장면만 낸다(돌진, 수치, 타격음 없음). `defeated`가 있으면 전투 종료 배너를 띄운다.
- 한 사건의 증강 장면은 한 번만 재생한다(`freshAugments`). `annotateEvent`가 타수마다 같은 신호를 실어 주기 때문이다. 증강 신호가 여럿이면 곁장면을 그만큼(최대 3개) 더 허락한다.
- 타격에 실리지 못한 증강 신호(피해 없는 사건, 간파나 천사가 막아 낸 공격)는 `augmentRest`가 재생한다.
- 맞공격(`counter: true`)은 같은 응답에 함께 오므로 플레이어의 타격이 닿은 뒤로 미룬다.
- 가시 갑옷의 `reflectedHits`는 적의 몸 위에 고정 피해 수치로 띄운다.
- 마지막 기회(`transcendDeath.until`이 지금보다 뒤) 동안에는 플레이어의 HP를 0으로 보인다.
- 연출 엔진이 있을 때 적의 피격 번쩍임은 타격 순간부터 시작하고(예전에는 사건 시작부터 하얗게 떴다) 조금 약하다(.65 → .42). 장면이 하얗게 가려지지 않게 하려는 것이다.

### 그림과 생성 프롬프트

codex CLI(0.158)의 내장 이미지 생성으로 만들고(`codex exec --sandbox workspace-write`), 알파 경계로 잘라 줄인 뒤 WebP(품질 84)로 저장했다. S3에는 올리지 않았다.

| 파일 | 크기 | 쓰는 곳 |
| --- | --- | --- |
| `angel.webp` | 628×640, 135KB | 천사강림: 내려와 주인 앞에서 싸우는 천사(날개 없는 몸) |
| `wing.webp` | 560×372, 46KB | 천사의 날개 한 짝. 뒤집어 두 짝으로 쓰고, 등의 뿌리를 축으로 따로 퍼덕인다 |
| `reaper.webp` | 640×585, 112KB | 명계의 부름: 땅의 문에서 솟는 사신 |
| `cavalry.webp` | 720×360, 104KB | 정복자의 기병: 곁에 서 있다가 돌격한다 |
| `sword.webp` | 114×520, 14KB | 이기어검술의 떠다니는 검, 검무 |

모든 프롬프트 앞에 붙인 지시: `Use your built-in image generation tool (imagegen) exactly once to create ONE image with a genuinely transparent (alpha) background, then copy the resulting PNG file into the current working directory as <name>.png. Do not draw it with code, do not post-process it, do not generate anything else.`

천사:

```text
Use case: concept-character. Production fantasy RPG ally combat sprite, transparent full-body isolated cutout. 'Seraph of the Last Stair', a guardian angel who descends to fight in place of a dying hero inside an endless celestial tower. A serene, formidable warrior-maiden in layered ivory silk and burnished antique-gold filigree armor with cathedral engraving, long pale hair and thin ribbon sashes lifted as if weightless, calm face with softly glowing closed eyes, a thin fragmented golden halo ring floating behind her head. She hovers (toes pointed down, not standing), body in three-quarter view facing toward the RIGHT, her right arm thrusting a long slender golden lance of light forward to the RIGHT, left hand open in a gesture of protection. IMPORTANT: she has NO WINGS in this image, her back and shoulders are clean because wings are composited separately. High-end painterly Korean fantasy game illustration, precise readable silhouette, warm ivory and gold palette with restrained pale-blue shadow tones, detailed precious metal and fabric. Entire figure, lance tip and hair fully visible with about 8 percent empty margin on all sides. Single character on a genuinely transparent alpha background. No wings, no floor, no scenery, no clouds, no large aura or bloom, no lettering, no border.
```

날개:

```text
Use case: game asset. ONE single large feathered angel wing, isolated transparent cutout, to be attached to a character's shoulder in a 2D game. The wing joint (root) sits at the LOWER-LEFT of the canvas and the wing spreads open toward the UPPER-RIGHT, fully extended and majestic: short dense covert feathers near the root, three layered rows, long elegant primary feathers fanning out at the tip. Ivory-white feathers with warm antique-gold rims and faint pale-blue shadow between layers, softly luminous as if lit from within, a few gold filigree clasps near the root. High-end painterly Korean fantasy game illustration, crisp readable silhouette with individually defined feathers. The whole wing visible with about 6 percent margin. Exactly one wing, no body, no second wing, no loose floating feathers, no glow cloud, no background, genuinely transparent alpha background, no text, no border.
```

사신:

```text
Use case: concept-character. Production fantasy RPG summon sprite, transparent isolated cutout. 'The Reaper answering the Call of the Underworld'. A towering hooded death spirit in a tattered black and deep-violet cloak; the lower body has no legs and tapers into long ragged cloth tatters as if rising out of the ground. Inside the hollow hood only darkness with two cold pale-cyan eye glints. Long skeletal armored hands grip an enormous crescent scythe held high behind its shoulder, wound up and ready to sweep down toward the RIGHT; the scythe has a pale bone-and-tarnished-silver shaft and a huge engraved blade with a thin cold cyan edge light. Small chains with tiny soul lanterns hang from its belt. Three-quarter view facing toward the RIGHT, dynamic leaning-forward pose. Dark high-end painterly Korean fantasy game illustration, strong readable silhouette, black, violet and tarnished silver with restrained cyan highlights. Entire figure and entire scythe blade visible with about 8 percent empty margin. Single figure on a genuinely transparent alpha background. No floor, no scenery, no smoke clouds, no large aura, no text, no border.
```

기병:

```text
Use case: concept-character. Production fantasy RPG summon sprite, transparent isolated cutout. 'The Conqueror's Cavalry': one heavily armored imperial lancer riding a barded warhorse at full gallop, strict side view charging toward the RIGHT. The knight leans forward with a long lance couched and pointing to the RIGHT, plumed closed helm, a long torn crimson-and-gold war banner cape streaming back to the left. The horse is mid-gallop with front legs reaching forward, armored chamfron and flowing mane and tail. Rendered as a phantom of conquest: the whole rider and horse are painted in a limited palette of molten gold, amber and deep bronze with dark burnt-umber armor edges and bright white-gold highlights, as if forged from living golden light, but fully opaque and crisply detailed. High-end painterly Korean fantasy game illustration, powerful readable silhouette, sense of speed. Entire horse, rider, lance tip and cape visible with about 6 percent empty margin. Single mounted figure on a genuinely transparent alpha background. No ground, no dust, no scenery, no glow cloud, no text, no border.
```

검:

```text
Use case: game asset. ONE single ornate flying spirit sword, isolated transparent cutout for a 2D game effect. The sword is perfectly vertical and centered with the tip pointing straight UP and the pommel at the bottom. Slender straight double-edged blade of pale polished steel with a luminous cyan-white engraved fuller running along its center, a compact antique-gold crossguard shaped like two small swept wings, a dark indigo wrapped grip, a small gold ring pommel with a short pale tassel. Elegant East-Asian immortal-cultivator flying sword mixed with celestial knight styling. High-end painterly Korean fantasy game illustration, crisp clean edges, symmetrical, highly detailed metal. The whole sword visible with about 6 percent margin, tall portrait composition. Exactly one sword, no hand, no scabbard, no duplicate swords, no glow cloud, no background, genuinely transparent alpha background, no text, no border.
```

### 효과음

기존 음원을 다시 배치하고, 전용 음원 다섯 개(말 울음, 말발굽, 칼 뽑는 소리, 합창, 테이프 되감기)를 더했다. 모두 Freesound의 CC0 녹음이며 출처는 `public/assets/combat-fx/CREDITS.md`의 "천상 증강 음원"에 있다.

### 검증

- `node tests/combat_fx_augments.test.js`: 계약서의 모든 신호에 장면이 있는지, 흉내 낸 WebGL에서 모든 장면과 지속 상태 연출이 오류 없이 도는지, 호스트 연결이 남아 있는지 본다.
- 실험실 `http://localhost:4173/lab/paradise`: 실제 `hfield.js`를 천상 내장 방식으로 돌리고, 서버가 보낼 사건과 `augmentAuras`를 버튼과 슬라이더로 넣는다. `?ui=0&mute=1`로 패널과 소리를 끈다. 콘솔에서 `plab.play(이름)`, `plab.aura(id, 상태)`, `plab.sheet(이름, [[사건, [초, ...], 준비 함수], ...], 영역, 열)`(`?shots=<PNG를 받을 주소>`가 있을 때 그 순간들을 한 장으로 보낸다).
- 실제 낙원 화면은 `node scripts/paradise-lab/server.js`(4175)의 `/lab?scenario=combat&augments=...`로 본다.
