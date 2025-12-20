# RPG 시스템 개발 문서

## 📋 목차
1. [프로젝트 개요](#프로젝트-개요)
2. [파일 구조](#파일-구조)
3. [직업 시스템](#직업-시스템)
4. [장비 시스템](#장비-시스템)
5. [장비 경제 시스템](#장비-경제-시스템)
6. [클래스 구조](#클래스-구조)
7. [사용 예시](#사용-예시)
8. [데이터 구조 명세](#데이터-구조-명세)

---

## 프로젝트 개요

### 목적
RPG 시스템을 **데이터 중심(Data-Driven)** 아키텍처로 리팩토링하여, 코드 수정 없이 JSON 파일만으로 직업, 장비, 스킬 등을 추가/수정할 수 있도록 구현했습니다.

### 주요 특징
- ✅ **모듈화**: 각 시스템을 독립적인 클래스로 분리
- ✅ **데이터 중심**: 모든 게임 데이터를 JSON 파일로 관리
- ✅ **확장성**: 새로운 직업, 장비 추가가 용이
- ✅ **유지보수성**: 코드와 데이터의 분리로 버그 최소화

---

## 파일 구조

```
tcgenius/
├── rpg_system.js              # RPG 시스템 핵심 클래스들
├── new_engine.js              # 메인 엔진 (RPG 시스템 사용)
├── RPGUser_refactored.js      # 리팩토링된 RPGUser 클래스
├── RPGenius.txt               # 게임 디자인 문서
└── DB/RPG/
    ├── jobs.json              # 직업 데이터
    ├── weapons.json           # 무기 데이터 (72개)
    ├── armors.json            # 방어구 데이터 (60개)
    ├── accessories.json       # 악세서리 데이터 (45개)
    └── equipment_sets.json    # 세트 아이템 데이터 (2개)
```

---

## 직업 시스템

### 파일 위치
`DB/RPG/jobs.json`

### 직업 목록
- **먼마**: 힘 기반 근접 딜러 (건틀릿)
- **성준호**: 속도 기반 암살자 (쌍검)
- **빵귤**: 지능 기반 마법사 (지팡이/마도장갑)
- **호르아크티**: 행운 기반 도박사 (아르카나)
- **건마**: 힘 기반 탱커 딜러 (권총)

### 데이터 구조

```json
{
  "먼마": {
    "name": "먼마",
    "description": "강력한 주먹으로 적을 제압하는 근접 전투의 달인",
    "mainStat": "power",
    "weapon": "건틀릿",
    "initialStats": { "power": 10, "speed": 5, "int": 3, "luck": 2 },
    "initialHp": 1500,
    "hpPerLevel": 1200,
    "resources": {},
    "initialSkills": {
      "passive": ["분노의 주먹"],
      "active": ["강력한 일격"]
    },
    "levelUnlockSkills": {
      "5": ["연속 공격"],
      "10": ["대지 강타"],
      "15": ["철권 난무"]
    },
    "awakenSkills": ["불멸의 투지", "분노 폭발"]
  }
}
```

### RPGJobManager 클래스

#### 주요 메서드

```javascript
const { jobManager } = require('./rpg_system.js');

// 직업 정보 조회
jobManager.getJob('먼마');                    // 전체 직업 데이터
jobManager.getAllJobs();                     // 모든 직업 이름 배열
jobManager.isValidJob('먼마');               // 직업 유효성 검증

// 직업 스탯 정보
jobManager.getJobInitialStats('먼마');       // 초기 스탯
jobManager.getJobInitialHp('먼마');          // 초기 HP
jobManager.getJobHpPerLevel('먼마');         // 레벨당 HP 증가량
jobManager.getJobMainStat('먼마');           // 주 스탯
jobManager.getJobWeapon('먼마');             // 착용 무기

// 스킬 정보
jobManager.getJobInitialSkills('먼마');      // 초기 스킬
jobManager.getJobLevelUnlockSkills('먼마', 5); // 레벨 5 해금 스킬
jobManager.getJobAwakenSkills('먼마');       // 각성 스킬

// 리소스 정보
jobManager.getJobResources('성준호');        // GP 정보
```

---

## 장비 시스템

### 파일 구조

#### 1. weapons.json (72개 무기)
- 레벨: 1, 10, 20, 30, 40, 50
- 직업: 먼마, 성준호, 빵귤, 호르아크티, 건마
- 등급: 일반, 레어, 레전더리

#### 2. armors.json (60개 방어구)
- 종류: 투구, 상의, 하의, 장갑, 신발
- 레벨: 1, 10, 20, 30, 40, 50
- 등급: 일반, 레어
- 특징: 랜덤 스탯 시스템

#### 3. accessories.json (45개 악세서리)
- 종류: 목걸이, 반지, 팔찌
- 레벨: 1, 10, 20, 30, 40, 50
- 등급: 일반, 레어, 레전더리
- 특징: 세트 아이템 포함

#### 4. equipment_sets.json (2개 세트)
- **심연을 마주한 콰트로** (20렙)
- **징벌** (40렙)

### 장비 데이터 구조

#### 무기 예시
```json
{
  "name": "무쇠의 건틀릿",
  "type": "weapon",
  "weaponType": "건틀릿",
  "rarity": "레전더리",
  "level": 20,
  "jobRestriction": "먼마",
  "stats": { "power": 8 },
  "effects": { 
    "normalAttackDamage": 8, 
    "critDamage": 15 
  },
  "uniqueEffect": {
    "name": "강타 증폭",
    "description": "일반 공격 적중 시 15% 확률로 추가 타격 1회 발생 (공격력의 20% 피해)",
    "procChance": 15,
    "damageMultiplier": 0.2
  }
}
```

#### 방어구 예시
```json
{
  "name": "빛나는 수련자의 투구",
  "type": "helmet",
  "rarity": "레어",
  "level": 20,
  "stats": { "hp": 330 },
  "randomStat": 2
}
```

#### 악세서리 예시 (세트 아이템)
```json
{
  "name": "정령의 목걸이",
  "type": "necklace",
  "rarity": "레전더리",
  "level": 40,
  "randomStat": 12,
  "effects": { "allDamage": 4 },
  "uniqueEffect": {
    "name": "리소스 회복",
    "description": "스킬 사용 시 10% 확률로 MP/GP/건력 3 회복",
    "procChance": 10,
    "resourceRecovery": 3
  },
  "setName": "징벌"
}
```

### RPGEquipmentManager 클래스

#### 주요 메서드

```javascript
const { equipmentManager } = require('./rpg_system.js');

// 1. 장비 조회
equipmentManager.getWeapon(0);               // 인덱스로 무기 조회
equipmentManager.getArmor(5);                // 인덱스로 방어구 조회
equipmentManager.getAccessory(10);           // 인덱스로 악세서리 조회
equipmentManager.findEquipmentByName('무쇠의 건틀릿'); // 이름으로 검색

// 2. 필터링
equipmentManager.getWeaponsByLevelAndJob(20, '먼마'); // 레벨/직업별 무기
equipmentManager.getArmorsByLevel(20, 'helmet');      // 레벨별 방어구
equipmentManager.getAccessoriesByLevel(20, 'ring');   // 레벨별 악세서리
equipmentManager.filterByRarity(weapons, '레전더리'); // 등급별 필터

// 3. 랜덤 스탯 생성
const randomStats = equipmentManager.generateRandomStat(equipment);
// → { power: 2 } 또는 { speed: 3 } 등

// 4. 장비 인스턴스 생성 (랜덤 스탯 포함)
const equipment = equipmentManager.createEquipmentInstance(10, 'armor');
// equipment.generatedStats = { luck: 2 }

// 5. 세트 효과 계산
const equippedItems = [necklace, ring, bracelet];
const setEffects = equipmentManager.calculateSetEffects(equippedItems);
// → [{ setName: '징벌', requiredCount: 3, effects: {...} }]

// 6. 추천 장비
const recommended = equipmentManager.getRecommendedEquipments(20, '먼마');
// → { weapon: {...}, helmet: {...}, ... }

// 7. 통계
equipmentManager.getWeaponCount();      // 72
equipmentManager.getArmorCount();       // 60
equipmentManager.getAccessoryCount();   // 45
```

---

## 장비 경제 시스템

RPGenius.txt의 1013번째 줄부터 명세된 장비 되팔기, 분해, 강화 시스템입니다.

### 1. 되팔기 가격

#### 공식
```
판매 가격 = (장비 레벨 × 5) × 등급 배수
```

#### 등급 배수
- 일반: ×1
- 레어: ×3
- 레전더리: ×12
- 에픽: ×15

#### 예시
| 레벨 | 일반 | 레어 | 레전더리 |
|------|------|------|----------|
| 1    | 5G   | 15G  | 60G      |
| 10   | 50G  | 150G | 600G     |
| 20   | 100G | 300G | 1,200G   |
| 50   | 250G | 750G | 3,000G   |

#### 사용법
```javascript
const equipment = equipmentManager.getWeapon(20); // 무쇠의 건틀릿 (20렙 레전더리)
const sellPrice = equipmentManager.calculateSellPrice(equipment);
// → 1,200G
```

### 2. 장비 분해

#### 보상 테이블

**일반 장비**
| 레벨      | 강화석     |
|-----------|------------|
| 1렙       | 80~120     |
| 10, 20렙  | 180~220    |
| 30, 40렙  | 270~330    |
| 50렙      | 370~430    |

**레어 장비**
| 레벨      | 강화석     |
|-----------|------------|
| 1렙       | 180~220    |
| 10, 20렙  | 270~330    |
| 30, 40렙  | 370~430    |
| 50렙      | 470~550    |

**레전더리 장비**
| 레벨 | 강화석    | 레전더리 정수 |
|------|-----------|---------------|
| 20렙 | 450~530   | ×1            |
| 40렙 | 560~640   | ×2            |
| 50렙 | 770~810   | ×3            |

**에픽 장비**
| 레벨 | 강화석      | 에픽 소울 |
|------|-------------|-----------|
| 30렙 | 980~1,200   | ×3~5      |

#### 사용법
```javascript
const rewards = equipmentManager.disassembleEquipment(equipment);
// → {
//   enhancementStone: 489,
//   legendaryEssence: 1,
//   epicSoul: 0
// }
```

### 3. 장비 강화

#### 강화 확률표

| 강화 | 대성공 | 성공  | 하락   | 초기화 |
|------|--------|-------|--------|--------|
| 1강  | 10%    | 90%   | 0%     | 0%     |
| 2강  | 8%     | 91%   | 1%     | 0%     |
| 3강  | 6%     | 91%   | 3%     | 0%     |
| 4강  | 5%     | 85%   | 10%    | 0%     |
| 5강  | 4%     | 80%   | 16%    | 0%     |
| 6강  | 3%     | 75%   | 22%    | 0%     |
| 7강  | 2%     | 70%   | 28%    | 0%     |
| 8강  | 1.5%   | 60%   | 38.5%  | 0%     |
| 9강  | 1.2%   | 50%   | 38.8%  | 10%    |
| 10강 | 1%     | 30%   | 54%    | 15%    |
| 11강 | 0.5%   | 15%   | 54.5%  | 30%    |
| 12강 | 0%     | 10%   | 50%    | 40%    |
| 13강 | 0%     | 3%    | 47%    | 50%    |
| 14강 | 0%     | 1.5%  | 33.5%  | 65%    |
| 15강 | 0%     | 0.7%  | 19.3%  | 80%    |

#### 결과 유형
- **대성공**: +2강
- **성공**: +1강
- **하락**: -1강
- **초기화**: 0강으로 리셋

#### 난이도 참고
- **10강**: 완전 기본
- **11~12강**: 국민 스펙
- **13강**: 조금 쎄고
- **14~15강**: 사실상 못 가는 영역

#### 사용법
```javascript
let currentEnhancement = 0;

// 강화 시도
const result = equipmentManager.attemptEnhancement(currentEnhancement);
// → {
//   success: true,
//   result: 'success',  // 'great', 'success', 'downgrade', 'reset'
//   newEnhancement: 1
// }

// 장비에 강화 적용
if (result.success) {
    equipment.applyEnhancement(result.newEnhancement);
}
```

### 4. 강화 보너스

#### 무기 강화
- **공식**: 강화당 공격력 +3%
- **예시**: +10강 = 공격력 +30%

```javascript
const bonus = equipmentManager.getWeaponEnhancementBonus(10);
// → 30 (%)
```

#### 방어구 강화
- **공식**: 강화당 기본 HP의 5% 증가
- **예시**: 기본 HP 500 → +10강 = +250 HP

```javascript
const bonus = equipmentManager.getArmorEnhancementBonus(10, 500);
// → 250 (HP)
```

### 5. 증폭 시스템 (방어구 전용)

#### 특징
- 증폭서를 사용하면 **강화 대신 증폭**으로 변환
- 12증폭도 12강화와 동일한 난이도
- **10증폭부터 1증폭당 주스탯 +1**

#### 주스탯 보너스
| 증폭 | 주스탯 |
|------|--------|
| 9    | +0     |
| 10   | +1     |
| 11   | +2     |
| 12   | +3     |

#### 사용법
```javascript
// 증폭 적용
equipment.applyAmplification(12);

// 주스탯 보너스 계산
const statBonus = equipmentManager.getAmplificationStatBonus(12);
// → 3

// 표시
console.log(equipment.getEnhancementDisplay());
// → "+12증폭"
```

---

## 클래스 구조

### RPGEquipment 클래스

#### 속성
```javascript
{
  id: 0,                    // 장비 고유 ID
  name: "무쇠의 건틀릿",    // 장비 이름
  type: "weapon",           // 장비 타입
  rarity: "레전더리",       // 등급
  level: 20,                // 요구 레벨
  stats: { power: 8 },      // 기본 스탯
  tradeable: true,          // 거래 가능 여부
  enhancement: 0,           // 강화 수치 (0~15)
  amplification: 0,         // 증폭 수치 (0~12)
  isAmplified: false        // 증폭 여부
}
```

#### 메서드
```javascript
// 강화 적용
equipment.applyEnhancement(10);

// 증폭 적용
equipment.applyAmplification(12);

// 현재 강화/증폭 수치
equipment.getEnhancementLevel();

// 표시용 문자열
equipment.getEnhancementDisplay();
// → "+10" 또는 "+12증폭"
```

---

## 사용 예시

### 캐릭터 생성 시 초기 장비 지급

```javascript
async function createCharacter(name, jobName) {
    // 직업 유효성 검증
    if (!jobManager.isValidJob(jobName)) {
        throw new Error('유효하지 않은 직업입니다.');
    }

    // 캐릭터 생성
    const character = new RPGUser(name, generateId(), ownerId);
    character.setJob(jobName);

    // 추천 장비 지급 (레벨 1)
    const recommendedEquipments = equipmentManager.getRecommendedEquipments(1, jobName);
    
    // 무기 지급
    if (recommendedEquipments.weapon) {
        const weaponInstance = equipmentManager.createEquipmentInstance(
            weapons.indexOf(recommendedEquipments.weapon),
            'weapon'
        );
        character.inventory.addItem(weaponInstance);
    }

    // 방어구 지급
    ['helmet', 'chest', 'legs', 'gloves', 'boots'].forEach(slot => {
        if (recommendedEquipments[slot]) {
            const armorInstance = equipmentManager.createEquipmentInstance(
                armors.indexOf(recommendedEquipments[slot]),
                'armor'
            );
            character.inventory.addItem(armorInstance);
        }
    });

    return character;
}
```

### 장비 강화

```javascript
async function enhanceEquipment(character, equipmentId) {
    const equipment = character.inventory.findById(equipmentId);
    
    if (!equipment) {
        return { success: false, message: '장비를 찾을 수 없습니다.' };
    }

    const currentEnhancement = equipment.enhancement;
    
    // 강화 시도
    const result = equipmentManager.attemptEnhancement(currentEnhancement);
    
    // 결과 처리
    equipment.applyEnhancement(result.newEnhancement);
    
    let message = '';
    switch (result.result) {
        case 'great':
            message = `대성공! ${currentEnhancement}강 → ${result.newEnhancement}강`;
            break;
        case 'success':
            message = `성공! ${currentEnhancement}강 → ${result.newEnhancement}강`;
            break;
        case 'downgrade':
            message = `실패... ${currentEnhancement}강 → ${result.newEnhancement}강`;
            break;
        case 'reset':
            message = `파괴! ${currentEnhancement}강 → 0강으로 초기화`;
            break;
    }
    
    return { success: result.success, message, equipment };
}
```

### 장비 분해

```javascript
async function disassembleEquipment(character, equipmentId) {
    const equipment = character.inventory.findById(equipmentId);
    
    if (!equipment) {
        return { success: false, message: '장비를 찾을 수 없습니다.' };
    }

    // 분해 보상 계산
    const rewards = equipmentManager.disassembleEquipment(equipment);
    
    // 인벤토리에서 장비 제거
    character.inventory.removeItem(equipmentId);
    
    // 보상 지급
    character.inventory.addItem('강화석', rewards.enhancementStone);
    if (rewards.legendaryEssence > 0) {
        character.inventory.addItem('레전더리 정수', rewards.legendaryEssence);
    }
    if (rewards.epicSoul > 0) {
        character.inventory.addItem('에픽 소울', rewards.epicSoul);
    }
    
    return {
        success: true,
        message: `${equipment.name}을(를) 분해했습니다.`,
        rewards
    };
}
```

### 세트 효과 계산

```javascript
function calculateCharacterSetEffects(character) {
    const equippedItems = [
        character.equips.necklace,
        character.equips.ring,
        character.equips.bracelet
    ].filter(item => item !== null);

    const setEffects = equipmentManager.calculateSetEffects(equippedItems);
    
    // 세트 효과 적용
    let totalDamageBonus = 0;
    let hasShield = false;
    let shieldAmount = 0;

    setEffects.forEach(effect => {
        if (effect.effects.allDamage) {
            totalDamageBonus += effect.effects.allDamage;
        }
        if (effect.effects.startingShield) {
            hasShield = true;
            shieldAmount = effect.effects.startingShield;
        }
    });

    return {
        setEffects,
        totalDamageBonus,
        hasShield,
        shieldAmount
    };
}
```

---

## 데이터 구조 명세

### jobs.json 구조

```typescript
interface Job {
  name: string;                    // 직업 이름
  description: string;             // 직업 설명
  mainStat: 'power' | 'speed' | 'int' | 'luck';  // 주 스탯
  weapon: string;                  // 착용 무기
  initialStats: {                  // 초기 스탯
    power: number;
    speed: number;
    int: number;
    luck: number;
  };
  initialHp: number;               // 초기 HP
  hpPerLevel: number;              // 레벨당 HP 증가량
  resources: {                     // 리소스 (직업별 상이)
    gp?: number;                   // 성준호: GP
    maxGp?: number;
    mp?: number;                   // 빵귤: MP
    maxMp?: number;
    gunpower?: number;             // 건마: 건력
    maxGunpower?: number;
  };
  initialSkills: {                 // 초기 스킬
    passive: string[];
    active: string[];
  };
  levelUnlockSkills: {             // 레벨별 해금 스킬
    [level: string]: string[];     // "5": ["연속 공격"]
  };
  awakenSkills: string[];          // 각성 스킬
}
```

### weapons.json 구조

```typescript
interface Weapon {
  name: string;                    // 무기 이름
  type: "weapon";                  // 타입
  weaponType: string;              // 무기 종류 (건틀릿, 쌍검 등)
  rarity: "일반" | "레어" | "레전더리" | "에픽";
  level: number;                   // 요구 레벨
  jobRestriction?: string;         // 직업 제한
  stats: {                         // 기본 스탯
    power?: number;
    speed?: number;
    int?: number;
    luck?: number;
    hp?: number;
  };
  effects?: {                      // 효과
    normalAttackDamage?: number;   // 일반 공격 데미지 (%)
    critDamage?: number;           // 치명타 피해량 (%)
    critChance?: number;           // 치명타 확률 (%)
    evasion?: number;              // 회피율 (%)
    skillDamage?: number;          // 스킬 데미지 (%)
    startingMp?: number;           // 전투 시작 시 MP
    mpRegenPerTurn?: number;       // 턴당 MP 회복
    aoeSkillDamage?: number;       // 광역 스킬 데미지 (%)
    // ... 기타
  };
  uniqueEffect?: {                 // 고유 효과 (레전더리 전용)
    name: string;
    description: string;
    procChance?: number;           // 발동 확률
    damageMultiplier?: number;     // 데미지 배율
    cooldownReset?: boolean;       // 쿨타임 초기화
    // ... 기타
  };
}
```

### armors.json 구조

```typescript
interface Armor {
  name: string;
  type: "helmet" | "chest" | "legs" | "gloves" | "boots";
  rarity: "일반" | "레어";
  level: number;
  stats: {
    hp: number;                    // 체력 증가
  };
  randomStat?: number | {          // 랜덤 스탯
    min: number;
    max: number;
  };
}
```

### accessories.json 구조

```typescript
interface Accessory {
  name: string;
  type: "necklace" | "ring" | "bracelet";
  rarity: "일반" | "레어" | "레전더리";
  level: number;
  randomStat?: number;             // 랜덤 스탯
  stats?: {
    attackPower?: number;
  };
  effects?: {
    critChance?: number;           // 치명타 확률 (%)
    critDamage?: number;           // 치명타 피해량 (%)
    allDamage?: number;            // 모든 피해 (%)
    skillDamage?: number;          // 스킬 데미지 (%)
    hpRecoveryOnHit?: number;      // 적중 시 HP 회복 (%)
  };
  uniqueEffect?: {                 // 고유 효과
    name: string;
    description: string;
    procChance?: number;
    resourceRecovery?: number;
    hpRecoveryOnKill?: number;
    hpRecoveryOnDamaged?: number;
    // ... 기타
  };
  setName?: string;                // 세트 이름
}
```

### equipment_sets.json 구조

```typescript
interface EquipmentSet {
  name: string;                    // 세트 이름
  level: number;                   // 세트 레벨
  rarity: "레전더리" | "에픽";
  pieces: string[];                // 세트 구성 아이템 이름
  setEffects: {
    [count: string]: {             // "3": 3세트 효과
      description: string;
      effects: {
        allDamage?: number;
        startingShield?: number;
        shieldDuration?: number;
        // ... 기타
      };
    };
  };
}
```

---

## 개발 가이드

### 새 직업 추가하기

1. `DB/RPG/jobs.json`에 새 직업 데이터 추가
2. 직업 전용 무기를 `weapons.json`에 추가
3. 직업 전용 스킬 구현 (별도 작업)

```json
{
  "새직업": {
    "name": "새직업",
    "description": "새로운 직업입니다",
    "mainStat": "power",
    "weapon": "새무기",
    "initialStats": { "power": 10, "speed": 5, "int": 3, "luck": 2 },
    "initialHp": 1200,
    "hpPerLevel": 1000,
    "resources": {},
    "initialSkills": { "passive": [], "active": [] },
    "levelUnlockSkills": {},
    "awakenSkills": []
  }
}
```

### 새 장비 추가하기

1. 해당 JSON 파일의 배열 끝에 새 장비 추가
2. 인덱스는 자동으로 할당됨 (배열 순서)

```json
{
  "name": "신규 무기",
  "type": "weapon",
  "weaponType": "건틀릿",
  "rarity": "레어",
  "level": 30,
  "jobRestriction": "먼마",
  "stats": { "power": 7 },
  "effects": { "normalAttackDamage": 8 }
}
```

### 새 세트 추가하기

1. `equipment_sets.json`에 세트 데이터 추가
2. 세트 구성 아이템을 `accessories.json`에 추가하고 `setName` 속성 지정

```json
{
  "name": "새로운 세트",
  "level": 30,
  "rarity": "레전더리",
  "pieces": ["아이템1", "아이템2", "아이템3"],
  "setEffects": {
    "2": {
      "description": "2세트 효과",
      "effects": { "allDamage": 5 }
    },
    "3": {
      "description": "3세트 효과",
      "effects": { "allDamage": 10, "critChance": 5 }
    }
  }
}
```

---

## 주의사항

### 1. 인덱스 관리
- JSON 파일의 배열 순서가 곧 **인덱스(ID)**입니다
- 중간에 아이템을 삭제하면 이후 모든 인덱스가 변경되므로 주의
- 삭제보다는 비활성화 속성 추가를 권장

### 2. 랜덤 스탯
- 방어구와 악세서리는 생성 시마다 랜덤 스탯이 달라집니다
- `createEquipmentInstance()` 사용 시 자동으로 랜덤 스탯 생성
- `generatedStats` 필드에 생성된 랜덤 스탯 기록

### 3. 강화/증폭
- 무기와 악세서리: **강화만 가능**
- 방어구: **강화 또는 증폭** (증폭서 사용 시)
- 한번 증폭된 장비는 강화로 되돌릴 수 없음

### 4. 세트 효과
- 세트 아이템은 `setName` 속성으로 세트 판별
- `calculateSetEffects()`는 장착된 아이템 배열을 받아 활성화된 세트 효과 반환
- 여러 세트 동시 적용 가능

---

## 버전 정보

- **작성일**: 2024년 12월 20일
- **버전**: 1.0.0
- **작성자**: Cascade AI
- **상태**: 프로덕션 준비 완료

---

## 추가 구현 필요 사항

### 단기 과제
- [ ] 장비 강화 UI 구현
- [ ] 장비 분해 UI 구현
- [ ] 세트 효과 UI 표시
- [ ] 강화 성공/실패 이펙트

### 중기 과제
- [ ] 에픽 장비 추가
- [ ] 증폭 시스템 UI 구현
- [ ] 장비 거래 시스템
- [ ] 장비 강화 보호 아이템

### 장기 과제
- [ ] 장비 옵션 변경 시스템
- [ ] 장비 세공 시스템
- [ ] 커스텀 장비 제작
- [ ] 장비 외형 변경

---

## 문의 및 지원

본 문서에 대한 문의사항이나 버그 리포트는 다음 경로로 연락 바랍니다:
- 이슈 트래커: [GitHub Issues]
- 문서 업데이트: 이 파일을 직접 수정

**Happy Coding! 🚀**
