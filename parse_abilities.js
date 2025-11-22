/**
 * Card Description Parser
 * desc 필드를 파싱하여 abilities 필드를 자동 생성
 */

const fs = require('fs');

function read(path) {
    return fs.readFileSync(path, 'utf-8');
}

function save(path, data) {
    fs.writeFileSync(path, data, 'utf-8');
}

// ==================== 파싱 패턴 정의 ====================

const patterns = [
    // ==================== 복합 조건 (우선 순위 높음) ====================
    
    // "덱에 편성 시 X, Y와 함께 편성 시 Z"
    {
        regex: /^덱에 편성 시 (.+?)[,] (.+?)와 함께 편성 시 (.+)$/,
        parse: (match, allCards) => {
            const effect1 = parseEffect(match[1]);
            const targetName = match[2].trim();
            const effect2 = parseEffect(match[3]);
            
            const cardId = allCards.findIndex(c => c.name === targetName);
            
            return [
                effect1,
                {
                    type: "덱에 X가 있으면 Y",
                    condition: {
                        type: "hasCard",
                        cardId: cardId,
                        cardName: targetName
                    },
                    effect: effect2
                }
            ];
        }
    },
    
    // ==================== 즉시 적용 능력 ====================
    {
        regex: /단일 파워[가]? (\d+) 증가/,
        parse: (match) => ({
            type: "단일 파워 증가",
            value: parseInt(match[1])
        })
    },
    {
        regex: /단일 파워[가]? (\d+)% 증가/,
        parse: (match) => ({
            type: "단일 파워 증가%",
            value: parseInt(match[1])
        })
    },
    {
        regex: /덱 파워[가]? (\d+) 증가/,
        parse: (match) => ({
            type: "전체 덱 파워 증가",
            value: parseInt(match[1])
        })
    },
    {
        regex: /덱 파워[가]? (\d+)% 증가/,
        parse: (match) => ({
            type: "전체 덱 파워 증가%",
            value: parseInt(match[1])
        })
    },
    {
        regex: /덱 전체 파워[가]? (\d+)% 증가/,
        parse: (match) => ({
            type: "전체 덱 파워 증가%",
            value: parseInt(match[1])
        })
    },
    {
        regex: /모든 카드 단일 파워[가]? (\d+) 증가/,
        parse: (match) => ({
            type: "전체 덱 파워 증가",
            value: parseInt(match[1])
        })
    },
    {
        regex: /데일리 골드[가]? (\d+) 증가/,
        parse: (match) => ({
            type: "데일리 골드 증가",
            value: parseInt(match[1])
        })
    },
    {
        regex: /데일리 골드[가]? (\d+)% 증가/,
        parse: (match) => ({
            type: "데일리 골드 증가%",
            value: parseInt(match[1])
        })
    },
    {
        regex: /데일리골드[가]? ([\d,]+) 증가/,
        parse: (match) => ({
            type: "데일리 골드 증가",
            value: parseInt(match[1].replace(/,/g, ''))
        })
    },
    {
        regex: /데일리 골드값을 -([\d,]+)하고 (\d+)% 증가/,
        parse: (match) => ([
            {
                type: "데일리 골드 증가",
                value: -parseInt(match[1].replace(/,/g, ''))
            },
            {
                type: "데일리 골드 증가%",
                value: parseInt(match[2])
            }
        ])
    },
    {
        regex: /파워[가]? (\d+) 증가/,
        parse: (match) => ({
            type: "단일 파워 증가",
            value: parseInt(match[1])
        })
    },
    {
        regex: /파워[가]? (\d+)% 증가/,
        parse: (match) => ({
            type: "단일 파워 증가%",
            value: parseInt(match[1])
        })
    },
    {
        regex: /파워[가]? (\d+) 감소/,
        parse: (match) => ({
            type: "단일 파워 증가",
            value: -parseInt(match[1])
        })
    },
    {
        regex: /파워[가]? (\d+)% 감소/,
        parse: (match) => ({
            type: "단일 파워 증가%",
            value: -parseInt(match[1])
        })
    },
    {
        regex: /덱 파워[가]? (\d+) 감소/,
        parse: (match) => ({
            type: "전체 덱 파워 증가",
            value: -parseInt(match[1])
        })
    },
    {
        regex: /덱 파워[가]? (\d+)% 감소/,
        parse: (match) => ({
            type: "전체 덱 파워 증가%",
            value: -parseInt(match[1])
        })
    },
    
    // 조건부 능력 - 덱 타입 (콘텐츠덱, 골드덱)
    {
        regex: /^콘텐츠덱에 편성 시[,]? (.+)$/,
        parse: (match) => {
            const effect = parseEffect(match[1]);
            return {
                type: "특정 덱 타입일 때 Y",
                condition: {
                    type: "deckType",
                    deckType: "content"
                },
                effect: effect
            };
        }
    },
    {
        regex: /^골드덱 편성 시[,]? (.+)$/,
        parse: (match) => {
            const effect = parseEffect(match[1]);
            return {
                type: "특정 덱 타입일 때 Y",
                condition: {
                    type: "deckType",
                    deckType: "gold"
                },
                effect: effect
            };
        }
    },
    {
        regex: /^덱에 편성 시 (.+)$/,
        parse: (match) => {
            // "덱에 편성 시"는 항상 발동 (조건 없음) - 효과만 파싱
            return parseEffect(match[1]);
        }
    },
    
    // 조건부 능력 - 카드 존재
    {
        regex: /^(.+?)와? 함께 편성 시 (.+)$/,
        parse: (match, allCards) => {
            const targetName = match[1].trim();
            const effect = parseEffect(match[2]);
            
            // 이름으로 카드 ID 찾기 (첫 번째 매칭)
            const cardId = allCards.findIndex(c => c.name === targetName);
            
            return {
                type: "덱에 X가 있으면 Y",
                condition: {
                    type: "hasCard",
                    cardId: cardId,
                    cardName: targetName
                },
                effect: effect
            };
        }
    },
    {
        regex: /^\[(.+?)\](.+?)와? 함께 편성 시 (.+)$/,
        parse: (match, allCards) => {
            const targetTitle = match[1];
            const targetName = match[2];
            const effect = parseEffect(match[3]);
            
            // 카드 ID 찾기
            const cardId = allCards.findIndex(c => c.title === targetTitle && c.name === targetName);
            
            return {
                type: "덱에 X가 있으면 Y",
                condition: {
                    type: "hasCard",
                    cardId: cardId,
                    cardName: targetName
                },
                effect: effect
            };
        }
    },
    {
        regex: /^(.+?)와? 같은 덱에 편성될 시 (.+)$/,
        parse: (match, allCards) => {
            const targetName = match[1].trim();
            const effect = parseEffect(match[2]);
            
            // 이름으로 카드 ID 찾기 (첫 번째 매칭)
            const cardId = allCards.findIndex(c => c.name === targetName);
            
            return {
                type: "덱에 X가 있으면 Y",
                condition: {
                    type: "hasCard",
                    cardId: cardId,
                    cardName: targetName
                },
                effect: effect
            };
        }
    },
    
    // 조건부 능력 - 등급 조건
    {
        regex: /편성된 카드 중[,]? (전설|영웅|희귀|고급|일반)이 없다면 (.+)/,
        parse: (match) => {
            const rarity = match[1];
            const effect = parseEffect(match[2]);
            
            return {
                type: "X 등급 카드가 없으면 Y",
                condition: {
                    type: "noRarity",
                    rarity: rarity
                },
                effect: effect
            };
        }
    },
    {
        regex: /정확히 (\d+)장의 (전설|영웅|희귀|고급|일반) 카드 편성 시[,]? (.+)/,
        parse: (match) => {
            const count = parseInt(match[1]);
            const rarity = match[2];
            const effect = parseEffect(match[3]);
            
            return {
                type: "X 등급 카드 정확히 N장이면 Y",
                condition: {
                    type: "exactRarity",
                    rarity: rarity,
                    count: count
                },
                effect: effect
            };
        }
    },
    
    // 조건부 능력 - 위치
    {
        regex: /(\d+)번째 자리 편성 시[,]? (.+)/,
        parse: (match) => {
            const position = parseInt(match[1]);
            const effect = parseEffect(match[2]);
            
            return {
                type: "이 카드가 N번째면 Y",
                condition: {
                    type: "isPosition",
                    position: position
                },
                effect: effect
            };
        }
    },
    
    // 조건부 능력 - 초월
    {
        regex: /초월당 (.+)/,
        parse: (match) => {
            const effect = parseEffect(match[1]);
            
            return {
                type: "초월 레벨당 Y",
                condition: {
                    type: "perTranscend",
                    per: 1
                },
                effect: effect
            };
        }
    },
    {
        regex: /강화당 (.+)/,
        parse: (match) => {
            const effect = parseEffect(match[1]);
            
            return {
                type: "강화 레벨당 Y",
                condition: {
                    type: "perLevel",
                    per: 1
                },
                effect: effect
            };
        }
    },
    
    // 조건부 능력 - 테마/키워드
    {
        regex: /[''](.+?)[''] 테마 카드가 덱에 있을 시[,]? (.+)/,
        parse: (match) => {
            const theme = match[1];
            const effect = parseEffect(match[2]);
            
            return {
                type: "특정 테마 카드가 있으면 Y",
                condition: {
                    type: "hasTheme",
                    theme: theme
                },
                effect: effect
            };
        }
    },
    {
        regex: /컨텐츠 내 (.+?) 키워드가 들어갈 시[,]? (.+)/,
        parse: (match) => {
            const keyword = match[1];
            const effect = parseEffect(match[2]);
            
            return {
                type: "콘텐츠 키워드 일치 시 Y",
                condition: {
                    type: "contentKeyword",
                    keyword: keyword
                },
                effect: effect
            };
        }
    },
    
    // 조건부 능력 - 속성/키워드
    {
        regex: /덱 내 \((.+?)\)속성이 있을 시[,]? (.+)/,
        parse: (match) => {
            const attribute = match[1];
            const effect = parseEffect(match[2]);
            
            return {
                type: "특정 속성이 있으면 Y",
                condition: {
                    type: "hasAttribute",
                    attribute: attribute
                },
                effect: effect
            };
        }
    },
    {
        regex: /덱 내 \{(.+?)\}(.+?)와 함께 편성 시[,]? (.+)/,
        parse: (match, allCards) => {
            const theme = match[1];
            const name = match[2];
            const effect = parseEffect(match[3]);
            
            // 테마와 이름으로 카드 찾기
            const cardId = allCards.findIndex(c => c.title === theme && c.name === name);
            
            return {
                type: "덱에 X가 있으면 Y",
                condition: {
                    type: "hasCard",
                    cardId: cardId
                },
                effect: effect
            };
        }
    },
    {
        regex: /(.+?) 카드와 함께 편성될 시[,]? (.+)/,
        parse: (match, allCards) => {
            const name = match[1];
            const effect = parseEffect(match[2]);
            
            const cardId = allCards.findIndex(c => c.name === name);
            
            return {
                type: "덱에 X가 있으면 Y",
                condition: {
                    type: "hasCard",
                    cardId: cardId
                },
                effect: effect
            };
        }
    },
    
    // 조건부 능력 - N장당
    {
        regex: /(.+?)팀원 수만큼 (.+)/,
        parse: (match) => {
            const team = match[1];
            const effect = parseEffect(match[2]);
            
            return {
                type: "특정 조건 카드 N장당 Y",
                condition: {
                    type: "countTeam",
                    team: team,
                    per: 1
                },
                effect: effect
            };
        }
    },
    {
        regex: /\((.+?)\)가 들어간 카드 장 수 만큼 (.+)/,
        parse: (match) => {
            const keyword = match[1];
            const effect = parseEffect(match[2]);
            
            return {
                type: "이름에 X가 들어간 카드 N장당 Y",
                condition: {
                    type: "countNameKeyword",
                    keyword: keyword,
                    per: 1
                },
                effect: effect
            };
        }
    },
    
    // 덱 파워 측정과 무관한 능력 (SKIP)
    {
        regex: /(자리를? 봉인|능력치를? 공유|파워 흡수|조합에 실패|차감되는 효과를 모두 방지)/,
        parse: (match) => {
            return {
                type: "DECK_BUILDER_ONLY",
                note: "덱 편성/조합 전용 능력"
            };
        }
    },
    
    // 특수 능력 - 대상 선택
    {
        regex: /선택한 (.+?) 등급 카드 (\d+)장과 (.+)/,
        parse: (match) => {
            const rarity = match[1];
            const count = parseInt(match[2]);
            const action = match[3];
            
            return {
                type: "선택한 카드와 특수 효과",
                target: {
                    type: "selectCard",
                    rarity: rarity,
                    count: count
                },
                action: action
            };
        }
    },
    {
        regex: /이 카드 파워의 (\d+)%를 다른 카드 중 한 장에 부여/,
        parse: (match) => {
            const percent = parseInt(match[1]);
            
            return {
                type: "다른 카드 1장 파워 증가%",
                targetSelect: true,
                value: percent
            };
        }
    },
    {
        regex: /(.+?)들에게 (.+)/,
        parse: (match) => {
            const targetName = match[1];
            const effect = parseEffect(match[2]);
            
            return {
                type: "특정 이름 카드들에게 Y",
                condition: {
                    type: "nameContains",
                    keyword: targetName
                },
                effect: effect
            };
        }
    },
    
    // 복잡한 조건
    {
        regex: /덱 내 카드들의 단일 파워에 들어간 숫자 [''](\d+)['']의 갯수만큼 (.+)/,
        parse: (match) => {
            const digit = match[1];
            const effect = parseEffect(match[2]);
            
            return {
                type: "파워에 특정 숫자 개수만큼 Y",
                condition: {
                    type: "countDigitInPower",
                    digit: digit,
                    per: 1
                },
                effect: effect
            };
        }
    },
    {
        regex: /이 카드의 파워가 덱 내에서 가장 높을 시[,]? (.+)/,
        parse: (match) => {
            const effect = parseEffect(match[1]);
            
            return {
                type: "이 카드가 최고 파워면 Y",
                condition: {
                    type: "isHighestPower"
                },
                effect: effect
            };
        }
    },
    {
        regex: /(.+?) 능력이 활성화되어있을 시[,]? (.+)/,
        parse: (match) => {
            const abilityName = match[1];
            const effect = parseEffect(match[2]);
            
            return {
                type: "특정 능력 활성화 시 Y",
                condition: {
                    type: "abilityActive",
                    ability: abilityName
                },
                effect: effect
            };
        }
    },
    {
        regex: /모두 다 다른 등급으로 덱이 구성되면 (.+)/,
        parse: (match) => {
            const effect = parseEffect(match[1]);
            
            return {
                type: "모든 등급 다르면 Y",
                condition: {
                    type: "allDifferentRarity"
                },
                effect: effect
            };
        }
    },
    {
        regex: /단일 파워가 (\d+) 이하인 카드가 있다면[,]? (.+) 후 (.+)/,
        parse: (match) => {
            const threshold = parseInt(match[1]);
            const action1 = match[2];
            const action2 = match[3];
            
            return {
                type: "조건부 복합 효과",
                condition: {
                    type: "hasPowerBelow",
                    threshold: threshold
                },
                actions: [action1, action2]
            };
        }
    },
    
    // 추가 조건부 능력
    {
        regex: /(.+?)와 함께 골드덱에 편성될 시[,]? (.+)/,
        parse: (match, allCards) => {
            const name = match[1];
            const effect = parseEffect(match[2]);
            
            const cardId = allCards.findIndex(c => c.name === name);
            
            return {
                type: "특정 덱 타입 + 카드 조건",
                condition: {
                    type: "deckTypeAndCard",
                    deckType: "gold",
                    cardId: cardId
                },
                effect: effect
            };
        }
    },
    {
        regex: /(.+?)와 함께 콘텐츠덱에 편성될 시[,]? (.+)/,
        parse: (match, allCards) => {
            const name = match[1];
            const effect = parseEffect(match[2]);
            
            const cardId = allCards.findIndex(c => c.name === name);
            
            return {
                type: "특정 덱 타입 + 카드 조건",
                condition: {
                    type: "deckTypeAndCard",
                    deckType: "content",
                    cardId: cardId
                },
                effect: effect
            };
        }
    },
    {
        regex: /데일리 골드가 ([\d,]+) 이하일 시[,]? (.+)/,
        parse: (match) => {
            const threshold = parseInt(match[1].replace(/,/g, ''));
            const effect = parseEffect(match[2]);
            
            return {
                type: "골드 임계값 조건",
                condition: {
                    type: "goldBelow",
                    threshold: threshold
                },
                effect: effect
            };
        }
    },
    {
        regex: /획득 골드 \+(\d+)%/,
        parse: (match) => ({
            type: "데일리 골드 증가%",
            value: parseInt(match[1])
        })
    },
    
    // 속성 관련
    {
        regex: /파이브팀속성/,
        parse: (match) => {
            return {
                type: "SPECIAL_ATTRIBUTE",
                note: "파이브팀 속성 (특수 처리 필요)"
            };
        }
    },
    
    // 대상 부여
    {
        regex: /다른 카드 중 한 장에 단일 파워 (\d+) 증가/,
        parse: (match) => ({
            type: "다른 카드 1장 파워 증가",
            targetSelect: true,
            value: parseInt(match[1])
        })
    },
    {
        regex: /(.+?)에게 단일 파워 (\d+)/,
        parse: (match, allCards) => {
            const targetName = match[1];
            const value = parseInt(match[2]);
            
            return {
                type: "특정 이름 카드들에게 Y",
                condition: {
                    type: "nameContains",
                    keyword: targetName
                },
                effect: {
                    type: "단일 파워 증가",
                    value: value
                }
            };
        }
    },
    
    // 게임 메커니즘 관련 (덱파워 측정과 무관)
    {
        regex: /(번째 자리밖에 배치할 수 없다|조합에 사용될 시|강화할 때는 골드가 소모되지|강화가 불가능|클리어 시|특수능력을 모두 무효화|효과 활성화|침묵시킨다|회수 당합니다|룰렛을 돌립니다|파워.*흡수|능력 반전|노스타코인)/,
        parse: (match) => {
            return {
                type: "GAME_MECHANIC_ONLY",
                note: "게임 메커니즘 전용 능력 (덱파워 측정 무관)"
            };
        }
    },
    
    // 속성 태그 (덱파워 측정과 무관)
    {
        regex: /(마동속성|높동속성|파이브팀속성)$/,
        parse: (match) => {
            return {
                type: "ATTRIBUTE_TAG",
                attribute: match[1],
                note: "속성 태그 (덱 편성 참고용)"
            };
        }
    },
    
    // 상대적 능력치 (복잡한 계산)
    {
        regex: /(.+?) 카드가 있을 시[,]? 그 카드 능력치의 (\d+)%만큼 (.+)/,
        parse: (match, allCards) => {
            const name = match[1];
            const percent = parseInt(match[2]);
            const effect = match[3];
            
            const cardId = allCards.findIndex(c => c.name === name);
            
            return {
                type: "다른 카드 능력치 비례",
                condition: {
                    type: "hasCard",
                    cardId: cardId
                },
                percent: percent,
                effect: effect
            };
        }
    },
    
    // 효과 활성화 조건
    {
        regex: /[''](.+?)[''] 효과 활성화가 되어 있을 시[,]? (.+)/,
        parse: (match) => {
            const effectName = match[1];
            const effect = parseEffect(match[2]);
            
            return {
                type: "특정 효과 활성화 시 Y",
                condition: {
                    type: "effectActive",
                    effectName: effectName
                },
                effect: effect
            };
        }
    },
    {
        regex: /덱 편성 시 [''](.+?)[''] 효과 활성화/,
        parse: (match) => {
            const effectName = match[1];
            
            return {
                type: "효과 활성화",
                effectName: effectName,
                note: "덱 편성 시 활성화되는 효과"
            };
        }
    },
];

// 특수 케이스들
patterns.push({
    regex: /골드덱 편성 시 데일리골드 (\d+)% 증가[,]? 대신 이 카드가 덱에 포함될 시 데일리골드 % 증가값은 (\d+)% 초과할 수 없음/,
    parse: (match) => {
        return {
            type: "특정 덱 타입일 때 Y",
            condition: {
                type: "deckType",
                deckType: "gold"
            },
            effect: {
                type: "골드 증가 (상한선)",
                value: parseInt(match[1]),
                cap: parseInt(match[2])
            }
        };
    }
});

patterns.push({
    regex: /골드덱 편성 시[,]? 데일리골드 \+([\d,]+)/,
    parse: (match) => {
        return {
            type: "특정 덱 타입일 때 Y",
            condition: {
                type: "deckType",
                deckType: "gold"
            },
            effect: {
                type: "데일리 골드 증가",
                value: parseInt(match[1].replace(/,/g, ''))
            }
        };
    }
});

patterns.push({
    regex: /골드덱 편성 시[,]? 덱 내 카드들의 초월 횟수만큼 데일리골드 ([\d,]+)골드 증가/,
    parse: (match) => {
        return {
            type: "특정 덱 타입일 때 Y",
            condition: {
                type: "deckType",
                deckType: "gold"
            },
            effect: {
                type: "초월 횟수당 골드 증가",
                value: parseInt(match[1].replace(/,/g, ''))
            }
        };
    }
});

patterns.push({
    regex: /(.+?) 카드와 함께 편성될 시[,]? 파워 (\d+) 감소/,
    parse: (match, allCards) => {
        const name = match[1];
        const value = parseInt(match[2]);
        
        const cardId = allCards.findIndex(c => c.name === name);
        
        return {
            type: "덱에 X가 있으면 Y",
            condition: {
                type: "hasCard",
                cardId: cardId
            },
            effect: {
                type: "단일 파워 증가",
                value: -value
            }
        };
    }
});

patterns.push({
    regex: /(.+?) 능력이 활성화되어있을 시[,]?[,] (.+)/,
    parse: (match) => {
        const abilityName = match[1];
        const effect = parseEffect(match[2]);
        
        return {
            type: "특정 능력 활성화 시 Y",
            condition: {
                type: "abilityActive",
                ability: abilityName
            },
            effect: effect
        };
    }
});

// ==================== 효과 파싱 함수 ====================

function parseEffect(effectStr) {
    // 단일 파워 증가 (구체적인 것부터 먼저)
    let match = effectStr.match(/단일 파워[가]? (\d+) 증가/);
    if (match) return { type: "단일 파워 증가", value: parseInt(match[1]) };
    
    match = effectStr.match(/단일 파워[가]? (\d+)% 증가/);
    if (match) return { type: "단일 파워 증가%", value: parseInt(match[1]) };
    
    match = effectStr.match(/단일 파워[가]? (\d+) 감소/);
    if (match) return { type: "단일 파워 증가", value: -parseInt(match[1]) };
    
    match = effectStr.match(/단일 파워[가]? (\d+)% 감소/);
    if (match) return { type: "단일 파워 증가%", value: -parseInt(match[1]) };
    
    // 덱 파워 증가
    match = effectStr.match(/덱파워 (\d+) 증가/);
    if (match) return { type: "전체 덱 파워 증가", value: parseInt(match[1]) };
    
    match = effectStr.match(/덱 파워[가]? (\d+) 증가/);
    if (match) return { type: "전체 덱 파워 증가", value: parseInt(match[1]) };
    
    match = effectStr.match(/덱파워 (\d+)% 증가/);
    if (match) return { type: "전체 덱 파워 증가%", value: parseInt(match[1]) };
    
    match = effectStr.match(/덱 파워[가]? (\d+)% 증가/);
    if (match) return { type: "전체 덱 파워 증가%", value: parseInt(match[1]) };
    
    match = effectStr.match(/덱 전체 파워[가]? (\d+)% 증가/);
    if (match) return { type: "전체 덱 파워 증가%", value: parseInt(match[1]) };
    
    // 데일리 골드 증가
    match = effectStr.match(/데일리 골드[가]? ([\d,]+) 증가/);
    if (match) return { type: "데일리 골드 증가", value: parseInt(match[1].replace(/,/g, '')) };
    
    match = effectStr.match(/데일리 골드[가]? (\d+)% 증가/);
    if (match) return { type: "데일리 골드 증가%", value: parseInt(match[1]) };
    
    match = effectStr.match(/데일리골드[가]? ([\d,]+) 증가/);
    if (match) return { type: "데일리 골드 증가", value: parseInt(match[1].replace(/,/g, '')) };
    
    // 일반 "파워 N 증가" (단일 파워로 처리)
    match = effectStr.match(/^파워[가]? (\d+) 증가$/);
    if (match) return { type: "단일 파워 증가", value: parseInt(match[1]) };
    
    match = effectStr.match(/^파워[가]? (\d+)% 증가$/);
    if (match) return { type: "단일 파워 증가%", value: parseInt(match[1]) };
    
    // 파싱 실패
    return { type: "UNPARSED", raw: effectStr };
}

// ==================== 메인 파서 함수 ====================

function parseCardAbilities(desc, allCards) {
    if (!desc) return [];
    
    // 능력명 제거 (콜론 앞부분)
    const colonIndex = desc.indexOf(':');
    const actualDesc = colonIndex !== -1 ? desc.substring(colonIndex + 1).trim() : desc;
    
    const abilities = [];
    
    // 먼저 전체 desc로 파싱 시도
    const parsedAbility = parseSingleAbility(actualDesc, allCards);
    
    // UNPARSED가 아니면 성공
    if (parsedAbility && parsedAbility.type !== "UNPARSED") {
        if (Array.isArray(parsedAbility)) {
            abilities.push(...parsedAbility);
        } else {
            abilities.push(parsedAbility);
        }
    } else {
        // 실패하면 복합 조건 분리 시도
        // "X, Y" 형태 찾기
        const commaMatch = actualDesc.match(/^(.+?)\s*[,]\s*(.+)$/);
        if (commaMatch) {
            // 앞부분과 뒷부분 각각 파싱
            const part1 = parseSingleAbility(commaMatch[1], allCards);
            const part2 = parseSingleAbility(commaMatch[2], allCards);
            
            if (part1 && part1.type !== "UNPARSED") {
                if (Array.isArray(part1)) abilities.push(...part1);
                else abilities.push(part1);
            }
            
            if (part2 && part2.type !== "UNPARSED") {
                if (Array.isArray(part2)) abilities.push(...part2);
                else abilities.push(part2);
            }
        }
        
        // 여전히 파싱 못했으면 UNPARSED
        if (abilities.length === 0) {
            abilities.push({
                type: "UNPARSED",
                raw: desc
            });
        }
    }
    
    return abilities;
}

function parseSingleAbility(text, allCards) {
    // 각 패턴을 순회하며 매칭 시도 (첫 번째 매칭만 사용)
    for (let pattern of patterns) {
        const match = text.match(pattern.regex);
        if (match) {
            try {
                return pattern.parse(match, allCards);
            } catch(e) {
                console.error(`파싱 오류: ${text}`, e);
                continue;
            }
        }
    }
    
    // 파싱 실패
    return {
        type: "UNPARSED",
        raw: text
    };
}

// ==================== 실행 ====================

function main() {
    console.log("📋 card.json 로드 중...");
    const cards = JSON.parse(read("DB/TCG/card.json"));
    
    console.log(`✅ ${cards.length}개 카드 로드 완료`);
    console.log("\n🔧 abilities 필드 생성 중...\n");
    
    let parsedCount = 0;
    let unparsedCount = 0;
    
    for (let i = 0; i < cards.length; i++) {
        const card = cards[i];
        
        // 이미 abilities가 있으면 스킵
        if (card.abilities) {
            continue;
        }
        
        // desc 파싱
        const abilities = parseCardAbilities(card.desc, cards);
        card.abilities = abilities;
        
        // 통계
        if (abilities.some(a => a.type === "UNPARSED")) {
            unparsedCount++;
            if (unparsedCount <= 10) {
                console.log(`⚠️  [${card.title}]${card.name}: ${card.desc}`);
            }
        } else {
            parsedCount++;
        }
    }
    
    console.log(`\n\n=== 파싱 결과 ===`);
    console.log(`✅ 성공: ${parsedCount}개`);
    console.log(`⚠️  실패: ${unparsedCount}개`);
    console.log(`📊 성공률: ${(parsedCount / cards.length * 100).toFixed(1)}%`);
    
    // 백업
    console.log("\n💾 원본 백업 중...");
    save("DB/TCG/card.json.backup", read("DB/TCG/card.json"));
    
    // 저장
    console.log("💾 card.json 저장 중...");
    save("DB/TCG/card.json", JSON.stringify(cards, null, 4));
    
    console.log("\n✅ 완료!");
}

// 실행
if (require.main === module) {
    main();
}

module.exports = { parseCardAbilities, parseEffect };
