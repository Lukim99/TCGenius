# 전직(Job Class) 시스템

구현 날짜: 2026-06-13

---

## 개요

캐릭터 카드에 **전직** 개념을 도입. 별도 캐릭터 id를 만들지 않고, 카드 인스턴스의 `type` 필드로 일반/전직을 구분한다.

- **일반 카드**: `{ id, star, type: '일반' }` (또는 type 미지정)
- **전직 카드**: `{ id, star, type: '전직' }` — 같은 id, 성급 유지

`CharacterCards.json` 엔트리에 `class` 필드가 있으면 전직이 존재하는 캐릭터다. 1차 대상: **빵귤(id 0)**, **뭔마(id 1)**.

---

## 변경 파일 목록

| 파일 | 변경 내용 |
|------|-----------|
| `DB/RPGenius/CharacterCards.json` | id 0·1에 `class` 필드 추가 |
| `DB/RPGenius/Skills.json` | 인덱스 12(유드 알레프)·13(안면강타) 추가 |
| `DB/RPGenius/Item.json` | 전직 변환석·전직 프레스티지 증표 추가 |
| `rpgenius.js` | 전직조합, 슬롯효과, 궁극기, 패션 필터, 프레스티지, 캐릭터변환 |
| `partyquest.js` | 궁극기 특수효과(파티 퀘스트 내) |
| `server.js` | /api/jobcombine API, HTML 탭, CSS |
| `public/app.js` | 전직조합 탭 UI |

---

## 1. 데이터

### CharacterCards.json — `class` 필드

빵귤(id 0)과 뭔마(id 1)에 추가. 기존 `slot_effect`(단수)·`skills`는 일반 카드용으로 그대로 유지.

```json
"class": {
  "name": "전직",
  "slot_effects": [
    { "effect": "expBonus",          "name": "경험치 획득 증가량", "base": 0.005, "per_level": 0.005 },
    { "effect": "hpDamageReduction", "name": "받는 피해량",        "base": 0.025, "per_level": 0.0125 }
  ],
  "skills": [12]   // 빵귤: [12], 뭔마: [13]
}
```

**전직 슬롯효과 (5성 기준, 성급당 증가)**

| 효과 | 5성 | 성급당 |
|------|-----|--------|
| 경험치 획득 증가량 | +0.5% | +0.5% |
| 받는 피해량 감소 | -2.5% | -1.25% |

> 슬롯효과는 `star >= 4`(5성)부터 활성화. `base + per_level * (star - 4)` 공식.

### Skills.json — 신규 궁극기

| 인덱스 | 이름 | 배율(5성) | 배율(12성) | MP | 쿨타임 |
|--------|------|-----------|------------|----|--------|
| 12 | 유드 알레프 | 600% | 775% | 560 | 120초 |
| 13 | 안면강타 | 530% | 740% | 440 | 116초 |

- **유드 알레프** `format.base: 5.0, per_star: 0.25` → 5성: 500%+100%=600%
- **안면강타** `format.base: 4.1, per_star: 0.30` → 5성: 410%+120%=530%

### Item.json — 신규 아이템

| 이름 | use 키 | 설명 |
|------|--------|------|
| 전직 변환석 | `전직캐릭터변환` | 전직 카드의 캐릭터를 다른 전직 가능 캐릭터로 랜덤 변환 |
| 전직 프레스티지 증표 | `전직프레스티지` | `user.jobPrestige = true`, 골드 획득 영구 +3% |

두 아이템 모두 `no_trade: true`.

---

## 2. rpgenius.js

### 신규 함수

#### `hasJobClass(id)`
`CharacterCards.json[id].class` 존재 여부 반환. 전직 가능 캐릭터 판별에 사용.

#### `getJobCombineSelection(user, numberArgs)`
전직조합 재료 검증. 실패 시 `{ error: '...' }` 반환, 성공 시 `{ numbers, cards, gold, sameCardId, star }`.

검증 조건:
- 3장 선택
- 모두 같은 캐릭터 id
- 모두 `type !== '전직'` (일반 카드만)
- 모두 `star >= 4` (5성 이상)
- 해당 캐릭터가 `hasJobClass` 통과
- 골드 충분

#### `runJobCombine(user)`
`pendingAction.type === '전직조합'` 처리.
- 골드 차감 (`getCardCombineInfo(star).gold` × **2배**)
- 재료 3장 제거
- 결과: `{ id: sameCardId, star: <동일>, type: '전직' }` 추가 — **성급 +1 없음, 100% 성공, 보호 없음**

#### `convertJobCharacterCard(user, numberArg)`
`전직캐릭터변환` 아이템 사용 처리.
- 대상이 `type === '전직'`인지 확인
- `hasJobClass`인 캐릭터 중 현재와 다른 것으로 랜덤 교체
- 성급·`type: '전직'` 유지, skin 제거

#### `consumeNextDamageReduction(user, damage)`
`getFieldBuffs(user).nextDamageReduction`이 있으면 1회 소비 후 피해 감소 적용.

---

### 수정 함수

#### `calculateUserStats` — 전직 메인 카드 BaseStat +2%
`user.main_card.type === '전직'`이면 `getBaseStat` 반환 직후 `atk/def/hp/mp/pnt`에 ×1.02 적용.
장비·펫·패션 등 이후 누적 스탯에는 영향 없음 (베이스만 증가).

#### `calculateCardSlotEffects` — 전직 분기 추가
`card.type === '전직'`이면 기존 이름 기반 단일 슬롯효과 대신 `class.slot_effects` 배열을 순회해 누적.

```
일반 카드: card.slot_effect (단수) → 이름 매칭으로 효과 적용
전직 카드: card.class.slot_effects (복수) → effect 키로 expBonus/hpDamageReduction 직접 누적
```

#### `getMainCardSkills` — type-aware
`main_card.type === '전직'`이면 `card.skills + card.class.skills` 합집합 반환.
→ 전직 빵귤은 자인(0) + 유드 알레프(12) 모두 사용 가능.

#### `executeMainCardSkillInField` — 궁극기 특수효과 (솔로/월드보스)

| 스킬 | 효과 | 저장소 |
|------|------|--------|
| 유드 알레프 | 다음 스킬 공격 피해 +10% (1회) | `getFieldBuffs(user).nextSkillDamageBonus` |
| 안면강타 | 다음 받는 피해 30% 감소 (1회) | `getFieldBuffs(user).nextDamageReduction` |

- `nextSkillDamageBonus`: 다음 스킬 rawDamage 계산 시 소비 (유드 알레프 자신은 제외)
- `nextDamageReduction`: elite/사냥/월드보스 피격 처리 직전 `consumeNextDamageReduction` 호출로 소비

#### `getCardFashion` / `getApplicableFashionsForCard`
`card.type === '전직'`이면 `fashion.type === '전직'` 패션만, 일반 카드이면 전직 패션 제외.

#### `convertCharacterCard` — 전직 카드 거부
`card.type === '전직'`이면 `❌ 전직 카드는 캐릭터 변환석을 사용할 수 없습니다.` 반환.

#### `RPGUser` — `jobPrestige` 필드
- constructor: `this.jobPrestige = false`
- load(): `if (typeof this.jobPrestige == 'undefined') this.jobPrestige = false`
- `전직프레스티지` 아이템 사용 시 `user.jobPrestige = true`

#### 골드 획득 +3%
elite·사냥·월드보스 골드 계산에 `+ (user.jobPrestige === true ? 0.03 : 0)` 추가.

---

## 3. partyquest.js

#### `executeMainCardSkillEffect` — 궁극기 특수효과

| 스킬 | 효과 | 저장소 |
|------|------|--------|
| 유드 알레프 | 다음 스킬 피해 +10% (1회) | `caster.runtime.nextSkillDamageBonus` |
| 안면강타 | 다음 받는 피해 -30% (1회) | `caster.runtime.nextDamageReduction` |

- rawDamage 계산 시 `nextSkillDamageBonus` 소비해 합산
- 각각 `upsertMemberBuff`로 버프 UI에도 표시 (remain: 1 → 다음 행동 후 자동 소멸)

#### `applyIncomingDamage` — `nextDamageReduction` 소비
보호막 흡수 직전에 `caster.runtime.nextDamageReduction` 있으면 피해에 (1 - 0.30) 곱 후 0으로 초기화.

---

## 4. server.js

### 신규 API

#### `GET /api/jobcombine/cards`
재료 후보 목록 반환. 조건: 일반 카드(`type !== '전직'`) + `star >= 4` + `hasJobClass(id)`.
성급 내림차순 정렬.

#### `POST /api/jobcombine`
`getJobCombineSelection` 검증 → pendingAction 설정 → `runJobCombine` 실행.
결과 카드를 `serializeCard`로 직렬화해 반환.

### HTML 탭
`data-page="jobcombine"` 페이지 추가. 구성:
- `.jobcombine-stage` — 조합 UI 이미지 오버레이 (슬롯 3개 + 결과 슬롯 + 조합 버튼)
- `#jobCombinePool` — 보유 가능 재료 카드 그리드

### CSS 슬롯 위치 (`전직조합원본.jpg` 기준)

| 슬롯 | left | top | 의미 |
|------|------|-----|------|
| `.m0` | 6.6% | 56.4% | CARD I (좌하) |
| `.m1` | 38.8% | 3.3% | CARD II (상중) |
| `.m2` | 71.3% | 56.4% | CARD III (우하) |
| `.result` | 39.2% | 39.3% | RESULT (중앙) |
| `.jobcombine-btn` | 38.5% | 94.5% | 조합 버튼 |

---

## 5. public/app.js

### 네비게이션
- `GROUPS.content.pages`에 `'jobcombine'` 추가
- `PAGE_LABELS`에 `jobcombine: '전직조합'` 추가
- `navigatePage`에 `loadJobCombine()` 진입 훅 추가

### `jobCombineState`
```
{ slots: [null, null, null], result: null, pool: [] }
```

### 주요 함수

| 함수 | 역할 |
|------|------|
| `loadJobCombine()` | `/api/jobcombine/cards` 호출 후 풀·스테이지 렌더 |
| `renderJobCombinePool()` | 재료 후보 카드 그리드 렌더. 이미 슬롯에 있는 카드 비활성화. 같은 캐릭터·성급만 슬롯 추가 허용 |
| `renderJobCombineStage()` | 슬롯 3개·결과 슬롯 오버레이 렌더 |
| `renderJobCombineInfo()` | 조합 비용·조건 안내 텍스트 |
| `addJobCardToSlot(card)` | 슬롯에 카드 추가. 같은 캐릭터·같은 성급 검증 |
| `removeFromJobSlotByIndex(i)` | 슬롯에서 카드 제거 |
| `submitJobCombine()` | `POST /api/jobcombine` 호출, 성공 시 결과 슬롯에 렌더 후 풀 갱신 |

**클라이언트 측 검증**: 슬롯에 담을 때 같은 캐릭터·같은 성급·일반 카드인지 확인 (서버에서도 재검증).

---

## 전직 카드 운용 규칙 요약

| 항목 | 일반 카드 | 전직 카드 |
|------|-----------|-----------|
| 슬롯효과 | `slot_effect` 단수 (이름 매칭) | `class.slot_effects` 복수 (2종 동시) |
| 사용 가능 스킬 | `card.skills` | `card.skills + card.class.skills` |
| 패션 | `type !== '전직'` 패션 | `type === '전직'` 패션 |
| 캐릭터변환 | 가능 (캐릭터변환석) | 불가 (전직 변환석 사용) |
| 조합 재료 | 전직조합 재료 가능 | 재료로 사용 불가 |
| 가챠/랜덤 생성 | 항상 일반으로 생성 | 전직조합으로만 획득 |
