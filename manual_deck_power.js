/**
 * Manual Deck Power Calculator
 * AI 없이 순수 코드로 덱파워를 측정하는 모듈
 */

const fs = require('fs');

// ==================== 유틸리티 함수 ====================

function read(path) {
    try {
        return fs.readFileSync(path, 'utf-8');
    } catch(e) {
        console.error("파일 읽기 실패:", path, e);
        return null;
    }
}

// ==================== 계산 상태 클래스 ====================

class PowerCalculationState {
    constructor(deck, deckType, user) {
        this.deck = deck;                    // 원본 덱 (카드 ID 배열)
        this.deckType = deckType;            // "content1", "content2", "gold"
        this.user = user;                    // 유저 객체
        
        // 카드 데이터
        this.cards = [];                     // 파싱된 카드 객체들
        this.cardPowers = [];                // 각 카드의 현재 파워
        this.cardGolds = [];                 // 각 카드의 현재 골드 (골드덱만)
        
        // 전역 배율
        this.globalMultipliers = {
            power: 1.0,
            gold: 1.0
        };
        
        // 로그
        this.appliedAbilities = [];          // 적용된 능력 로그
        this.calculationLog = [];            // 계산 과정 로그
        
        // 대화형 입력 관련
        this.pendingInput = null;            // 현재 대기 중인 입력
        this.abilityOrder = [];              // 능력 적용 순서
        this.currentAbilityIndex = 0;        // 현재 처리 중인 능력 인덱스
    }
    
    // 카드 데이터 로드 및 파싱
    parseCards() {
        const allCards = JSON.parse(read("DB/TCG/card.json"));
        
        this.cards = this.deck.map(cardId => {
            const card = JSON.parse(JSON.stringify(allCards[cardId])); // 깊은 복사
            card.originalId = cardId;
            return card;
        });
        
        // 초기 파워 설정
        this.cardPowers = this.cards.map(card => card.power || 0);
        
        // 골드덱인 경우 초기 골드 설정
        if (this.deckType === "gold") {
            this.cardGolds = this.cards.map(card => card.dailyGold || 0);
        }
        
        this.log(`📋 덱 파싱 완료: ${this.cards.length}장의 카드`);
    }
    
    // 로그 기록
    log(message) {
        this.calculationLog.push(message);
    }
    
    // 현재 상태 스냅샷
    snapshot() {
        return {
            cardPowers: [...this.cardPowers],
            cardGolds: this.deckType === "gold" ? [...this.cardGolds] : null,
            globalMultipliers: {...this.globalMultipliers}
        };
    }
    
    // 최종 파워 계산
    getFinalPower() {
        const basePower = this.cardPowers.reduce((sum, p) => sum + p, 0);
        const finalPower = Math.floor(basePower * this.globalMultipliers.power);
        return finalPower;
    }
    
    // 최종 골드 계산
    getFinalGold() {
        if (this.deckType !== "gold") return null;
        const baseGold = this.cardGolds.reduce((sum, g) => sum + g, 0);
        const finalGold = Math.floor(baseGold * this.globalMultipliers.gold);
        return finalGold;
    }
    
    // 계산 결과 반환
    getResult() {
        return {
            power: this.getFinalPower(),
            dailyGold: this.getFinalGold(),
            log: this.calculationLog.join("\n"),
            appliedAbilities: this.appliedAbilities
        };
    }
}

// ==================== 능력 타입 정의 ====================

const AbilityType = {
    IMMEDIATE: "immediate",           // 즉시 적용
    TARGET_REQUIRED: "target",        // 대상 선택 필요
    CONDITIONAL: "conditional",       // 조건부
    SPECIAL: "special"                // 특수 처리
};

// 능력 타입별 분류 맵
const abilityTypeMap = {
    // 즉시 적용 능력
    "단일 파워 증가": AbilityType.IMMEDIATE,
    "단일 파워 증가%": AbilityType.IMMEDIATE,
    "전체 덱 파워 증가": AbilityType.IMMEDIATE,
    "전체 덱 파워 증가%": AbilityType.IMMEDIATE,
    "데일리 골드 증가": AbilityType.IMMEDIATE,
    "데일리 골드 증가%": AbilityType.IMMEDIATE,
    "전체 덱 골드 증가%": AbilityType.IMMEDIATE,
    
    // 대상 선택 필요
    "다른 카드 1장 파워 증가": AbilityType.TARGET_REQUIRED,
    "다른 카드 1장 파워 증가%": AbilityType.TARGET_REQUIRED,
    
    // 조건부
    "덱에 X가 있으면 Y": AbilityType.CONDITIONAL,
    "X 등급 카드 N장당 Y": AbilityType.CONDITIONAL,
    "이 카드가 N번째면 Y": AbilityType.CONDITIONAL,
    "X 등급 카드가 있으면 Y": AbilityType.CONDITIONAL,
    "X 카드가 있으면 Y": AbilityType.CONDITIONAL,
    "특정 카드 N장당 Y": AbilityType.CONDITIONAL,
};

// 능력 타입 판별
function getAbilityType(abilityTypeString) {
    return abilityTypeMap[abilityTypeString] || AbilityType.SPECIAL;
}

// ==================== 능력 핸들러 ====================

const abilityHandlers = {
    /**
     * 단일 파워 증가
     * 자기 자신의 파워에 고정값 추가
     */
    "단일 파워 증가": (state, cardIdx, ability) => {
        const value = ability.value || 0;
        const oldPower = state.cardPowers[cardIdx];
        state.cardPowers[cardIdx] += value;
        
        state.log(`  └─ [${state.cards[cardIdx].name}] 파워 ${oldPower.toLocaleString()} → ${state.cardPowers[cardIdx].toLocaleString()} (+${value.toLocaleString()})`);
    },
    
    /**
     * 단일 파워 증가%
     * 자기 자신의 파워에 퍼센트 증가
     */
    "단일 파워 증가%": (state, cardIdx, ability) => {
        const percent = ability.value || 0;
        const oldPower = state.cardPowers[cardIdx];
        const increase = Math.floor(oldPower * percent / 100);
        state.cardPowers[cardIdx] += increase;
        
        state.log(`  └─ [${state.cards[cardIdx].name}] 파워 ${oldPower.toLocaleString()} → ${state.cardPowers[cardIdx].toLocaleString()} (+${percent}%, +${increase.toLocaleString()})`);
    },
    
    /**
     * 전체 덱 파워 증가
     * 모든 카드에 고정값 추가
     */
    "전체 덱 파워 증가": (state, cardIdx, ability) => {
        const value = ability.value || 0;
        for (let i = 0; i < state.cardPowers.length; i++) {
            state.cardPowers[i] += value;
        }
        state.log(`  └─ 모든 카드 파워 +${value.toLocaleString()}`);
    },
    
    /**
     * 전체 덱 파워 증가%
     * 전역 파워 배율 증가
     */
    "전체 덱 파워 증가%": (state, cardIdx, ability) => {
        const percent = ability.value || 0;
        const oldMultiplier = state.globalMultipliers.power;
        state.globalMultipliers.power *= (1 + percent / 100);
        
        state.log(`  └─ 전체 덱 파워 배율 ${(oldMultiplier * 100).toFixed(1)}% → ${(state.globalMultipliers.power * 100).toFixed(1)}% (+${percent}%)`);
    },
    
    /**
     * 데일리 골드 증가
     */
    "데일리 골드 증가": (state, cardIdx, ability) => {
        if (state.deckType !== "gold") return;
        const value = ability.value || 0;
        const oldGold = state.cardGolds[cardIdx];
        state.cardGolds[cardIdx] += value;
        
        state.log(`  └─ [${state.cards[cardIdx].name}] 골드 ${oldGold.toLocaleString()} → ${state.cardGolds[cardIdx].toLocaleString()} (+${value.toLocaleString()})`);
    },
    
    /**
     * 데일리 골드 증가%
     */
    "데일리 골드 증가%": (state, cardIdx, ability) => {
        if (state.deckType !== "gold") return;
        const percent = ability.value || 0;
        const oldGold = state.cardGolds[cardIdx];
        const increase = Math.floor(oldGold * percent / 100);
        state.cardGolds[cardIdx] += increase;
        
        state.log(`  └─ [${state.cards[cardIdx].name}] 골드 ${oldGold.toLocaleString()} → ${state.cardGolds[cardIdx].toLocaleString()} (+${percent}%, +${increase.toLocaleString()})`);
    },
    
    /**
     * 전체 덱 골드 증가%
     */
    "전체 덱 골드 증가%": (state, cardIdx, ability) => {
        if (state.deckType !== "gold") return;
        const percent = ability.value || 0;
        const oldMultiplier = state.globalMultipliers.gold;
        state.globalMultipliers.gold *= (1 + percent / 100);
        
        state.log(`  └─ 전체 덱 골드 배율 ${(oldMultiplier * 100).toFixed(1)}% → ${(state.globalMultipliers.gold * 100).toFixed(1)}% (+${percent}%)`);
    },
    
    /**
     * 다른 카드 1장 파워 증가
     * targetIdx가 필요함
     */
    "다른 카드 1장 파워 증가": (state, cardIdx, ability, targetIdx) => {
        if (targetIdx === undefined || targetIdx === cardIdx) {
            state.log(`  └─ ⚠️ 대상 카드가 지정되지 않았거나 자기 자신입니다.`);
            return;
        }
        
        const value = ability.value || 0;
        const oldPower = state.cardPowers[targetIdx];
        state.cardPowers[targetIdx] += value;
        
        state.log(`  └─ [${state.cards[targetIdx].name}] 파워 ${oldPower.toLocaleString()} → ${state.cardPowers[targetIdx].toLocaleString()} (+${value.toLocaleString()})`);
    },
    
    /**
     * 다른 카드 1장 파워 증가%
     */
    "다른 카드 1장 파워 증가%": (state, cardIdx, ability, targetIdx) => {
        if (targetIdx === undefined || targetIdx === cardIdx) {
            state.log(`  └─ ⚠️ 대상 카드가 지정되지 않았거나 자기 자신입니다.`);
            return;
        }
        
        const percent = ability.value || 0;
        const oldPower = state.cardPowers[targetIdx];
        const increase = Math.floor(oldPower * percent / 100);
        state.cardPowers[targetIdx] += increase;
        
        state.log(`  └─ [${state.cards[targetIdx].name}] 파워 ${oldPower.toLocaleString()} → ${state.cardPowers[targetIdx].toLocaleString()} (+${percent}%, +${increase.toLocaleString()})`);
    },
};

// ==================== 조건부 능력 핸들러 ====================

/**
 * 조건 체크 함수들
 */
const conditionCheckers = {
    /**
     * 덱에 특정 카드가 있는지 체크
     */
    hasCard: (state, cardId) => {
        return state.deck.includes(cardId);
    },
    
    /**
     * 덱에 특정 등급 카드가 있는지 체크
     */
    hasRarity: (state, rarity) => {
        return state.cards.some(card => card.rarity === rarity);
    },
    
    /**
     * 덱에 특정 등급 카드가 몇 장 있는지 카운트
     */
    countRarity: (state, rarity) => {
        return state.cards.filter(card => card.rarity === rarity).length;
    },
    
    /**
     * 덱에 특정 카드가 몇 장 있는지 카운트
     */
    countCard: (state, cardId) => {
        return state.deck.filter(id => id === cardId).length;
    },
    
    /**
     * 현재 카드의 위치 체크
     */
    isPosition: (state, cardIdx, position) => {
        return cardIdx === (position - 1); // 1-based to 0-based
    }
};

/**
 * 조건부 능력 핸들러
 */
const conditionalHandlers = {
    /**
     * 덱에 특정 카드가 있으면 효과 발동
     * ability.condition: { type: "hasCard", cardId: 123 }
     * ability.effect: { type: "단일 파워 증가", value: 1000 }
     */
    "덱에 X가 있으면 Y": (state, cardIdx, ability) => {
        if (!ability.condition || !ability.effect) {
            state.log(`  └─ ⚠️ 조건 또는 효과가 지정되지 않았습니다.`);
            return false;
        }
        
        const hasCard = conditionCheckers.hasCard(state, ability.condition.cardId);
        
        if (hasCard) {
            state.log(`  └─ ✅ 조건 충족: 덱에 카드 ID ${ability.condition.cardId} 존재`);
            // 효과 적용
            const effectHandler = abilityHandlers[ability.effect.type];
            if (effectHandler) {
                effectHandler(state, cardIdx, ability.effect);
                return true;
            } else {
                state.log(`  └─ ⚠️ 미구현 효과: ${ability.effect.type}`);
            }
        } else {
            state.log(`  └─ ❌ 조건 미충족: 덱에 카드 ID ${ability.condition.cardId} 없음`);
        }
        return false;
    },
    
    /**
     * X 등급 카드가 있으면 Y
     * ability.condition: { type: "hasRarity", rarity: "전설" }
     * ability.effect: { type: "단일 파워 증가%", value: 10 }
     */
    "X 등급 카드가 있으면 Y": (state, cardIdx, ability) => {
        if (!ability.condition || !ability.effect) {
            state.log(`  └─ ⚠️ 조건 또는 효과가 지정되지 않았습니다.`);
            return false;
        }
        
        const hasRarity = conditionCheckers.hasRarity(state, ability.condition.rarity);
        
        if (hasRarity) {
            state.log(`  └─ ✅ 조건 충족: 덱에 ${ability.condition.rarity} 등급 카드 존재`);
            const effectHandler = abilityHandlers[ability.effect.type];
            if (effectHandler) {
                effectHandler(state, cardIdx, ability.effect);
                return true;
            }
        } else {
            state.log(`  └─ ❌ 조건 미충족: 덱에 ${ability.condition.rarity} 등급 카드 없음`);
        }
        return false;
    },
    
    /**
     * X 등급 카드 N장당 Y
     * ability.condition: { type: "countRarity", rarity: "전설", per: 1 }
     * ability.effect: { type: "단일 파워 증가", value: 500 }
     */
    "X 등급 카드 N장당 Y": (state, cardIdx, ability) => {
        if (!ability.condition || !ability.effect) {
            state.log(`  └─ ⚠️ 조건 또는 효과가 지정되지 않았습니다.`);
            return false;
        }
        
        const count = conditionCheckers.countRarity(state, ability.condition.rarity);
        const per = ability.condition.per || 1;
        const times = Math.floor(count / per);
        
        if (times > 0) {
            state.log(`  └─ ✅ 조건 충족: ${ability.condition.rarity} 등급 카드 ${count}장 → ${times}회 적용`);
            
            const effectHandler = abilityHandlers[ability.effect.type];
            if (effectHandler) {
                // times만큼 반복 적용
                for (let i = 0; i < times; i++) {
                    effectHandler(state, cardIdx, ability.effect);
                }
                return true;
            }
        } else {
            state.log(`  └─ ❌ 조건 미충족: ${ability.condition.rarity} 등급 카드 ${count}장 (${per}장당 1회)`);
        }
        return false;
    },
    
    /**
     * 특정 카드 N장당 Y
     * ability.condition: { type: "countCard", cardId: 123, per: 1 }
     * ability.effect: { type: "단일 파워 증가%", value: 5 }
     */
    "특정 카드 N장당 Y": (state, cardIdx, ability) => {
        if (!ability.condition || !ability.effect) {
            state.log(`  └─ ⚠️ 조건 또는 효과가 지정되지 않았습니다.`);
            return false;
        }
        
        const count = conditionCheckers.countCard(state, ability.condition.cardId);
        const per = ability.condition.per || 1;
        const times = Math.floor(count / per);
        
        if (times > 0) {
            state.log(`  └─ ✅ 조건 충족: 카드 ID ${ability.condition.cardId} ${count}장 → ${times}회 적용`);
            
            const effectHandler = abilityHandlers[ability.effect.type];
            if (effectHandler) {
                for (let i = 0; i < times; i++) {
                    effectHandler(state, cardIdx, ability.effect);
                }
                return true;
            }
        } else {
            state.log(`  └─ ❌ 조건 미충족: 카드 ID ${ability.condition.cardId} ${count}장 (${per}장당 1회)`);
        }
        return false;
    },
    
    /**
     * 이 카드가 N번째면 Y
     * ability.condition: { type: "isPosition", position: 1 }
     * ability.effect: { type: "전체 덱 파워 증가%", value: 15 }
     */
    "이 카드가 N번째면 Y": (state, cardIdx, ability) => {
        if (!ability.condition || !ability.effect) {
            state.log(`  └─ ⚠️ 조건 또는 효과가 지정되지 않았습니다.`);
            return false;
        }
        
        const position = ability.condition.position;
        const isMatch = conditionCheckers.isPosition(state, cardIdx, position);
        
        if (isMatch) {
            state.log(`  └─ ✅ 조건 충족: 이 카드는 ${position}번째 카드입니다`);
            
            const effectHandler = abilityHandlers[ability.effect.type];
            if (effectHandler) {
                effectHandler(state, cardIdx, ability.effect);
                return true;
            }
        } else {
            state.log(`  └─ ❌ 조건 미충족: 이 카드는 ${cardIdx + 1}번째 (요구: ${position}번째)`);
        }
        return false;
    },
    
    /**
     * X 카드가 있으면 Y
     * ability.condition: { type: "hasCard", cardId: 123 }
     * ability.effect: { type: "단일 파워 증가", value: 2000 }
     */
    "X 카드가 있으면 Y": (state, cardIdx, ability) => {
        // "덱에 X가 있으면 Y"와 동일
        return conditionalHandlers["덱에 X가 있으면 Y"](state, cardIdx, ability);
    }
};

// ==================== 능력 적용 함수 ====================

/**
 * 능력 적용
 */
function applyAbility(state, cardIdx, ability, additionalParams = {}) {
    const handler = abilityHandlers[ability.type];
    
    if (!handler) {
        state.log(`  └─ ⚠️ 미구현 능력: ${ability.type}`);
        return false;
    }
    
    try {
        state.log(`\n📍 카드 ${cardIdx + 1}: [${state.cards[cardIdx].name}] - ${ability.type}`);
        handler(state, cardIdx, ability, additionalParams.targetIdx);
        
        // 적용 기록
        state.appliedAbilities.push({
            cardIndex: cardIdx,
            cardName: state.cards[cardIdx].name,
            abilityType: ability.type,
            value: ability.value,
            targetIdx: additionalParams.targetIdx,
            snapshot: state.snapshot()
        });
        
        return true;
    } catch(e) {
        state.log(`  └─ ❌ 능력 적용 중 오류: ${e.message}`);
        return false;
    }
}

// ==================== 메인 계산 함수 ====================

/**
 * 수동 덱파워 계산 (동기 버전 - 순서만 입력)
 * 모든 능력이 즉시 적용 가능한 경우
 */
function calculateDeckPowerSync(user, deck, deckType, abilityOrder) {
    const state = new PowerCalculationState(deck, deckType, user);
    
    // 1. 카드 파싱
    state.parseCards();
    
    // 2. 능력 적용 순서대로 처리
    state.log("\n\n=== 능력 적용 시작 ===");
    state.log(`적용 순서: ${abilityOrder.join(" → ")}`);
    
    for (let i = 0; i < abilityOrder.length; i++) {
        const cardIdx = abilityOrder[i] - 1; // 1-based to 0-based
        
        if (cardIdx < 0 || cardIdx >= state.cards.length) {
            state.log(`\n⚠️ 잘못된 카드 번호: ${abilityOrder[i]}`);
            continue;
        }
        
        const card = state.cards[cardIdx];
        const abilities = card.abilities || [];
        
        // 해당 카드의 모든 능력 적용
        for (let ability of abilities) {
            const abilityType = getAbilityType(ability.type);
            
            if (abilityType === AbilityType.IMMEDIATE) {
                // 즉시 적용 능력
                applyAbility(state, cardIdx, ability);
            } else if (abilityType === AbilityType.CONDITIONAL) {
                // 조건부 능력
                state.log(`\n📍 카드 ${cardIdx + 1}: [${card.name}] - ${ability.type}`);
                const condHandler = conditionalHandlers[ability.type];
                if (condHandler) {
                    condHandler(state, cardIdx, ability);
                } else {
                    state.log(`  └─ ⚠️ 미구현 조건부 능력: ${ability.type}`);
                }
            } else if (abilityType === AbilityType.TARGET_REQUIRED) {
                // 대상 선택이 필요한 경우 - 일단 스킵하고 로그만
                state.log(`\n📍 카드 ${cardIdx + 1}: [${card.name}] - ${ability.type}`);
                state.log(`  └─ ⚠️ 대상 선택이 필요합니다. (대화형 모드에서 처리)`);
            } else {
                state.log(`\n📍 카드 ${cardIdx + 1}: [${card.name}] - ${ability.type}`);
                state.log(`  └─ ⚠️ 아직 구현되지 않은 능력 타입입니다.`);
            }
        }
    }
    
    // 3. 최종 결과
    state.log("\n\n=== 최종 결과 ===");
    state.log(`\n💪 총 덱 파워: ${state.getFinalPower().toLocaleString()}`);
    
    if (deckType === "gold") {
        state.log(`💰 데일리 골드: ${state.getFinalGold().toLocaleString()}`);
    }
    
    state.log("\n\n=== 카드별 최종 파워 ===");
    for (let i = 0; i < state.cards.length; i++) {
        state.log(`${i + 1}. [${state.cards[i].name}]: ${state.cardPowers[i].toLocaleString()}`);
    }
    
    return state.getResult();
}

// ==================== 모듈 내보내기 ====================

module.exports = {
    PowerCalculationState,
    calculateDeckPowerSync,
    applyAbility,
    abilityHandlers,
    conditionalHandlers,
    conditionCheckers,
    AbilityType,
    getAbilityType
};
