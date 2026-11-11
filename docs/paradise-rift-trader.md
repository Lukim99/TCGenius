# 균열의 거래상

천상 이벤트 후보에 추가한 뒤틀림 거래 방이다. 전체 이벤트방 확률 15%와 갈림길 기믹 확률 20%는 유지한다.

| 선택 | 이번 탐험 동안 얻는 효과 | 대가 |
| --- | --- | --- |
| 파괴의 힘을 받는다 | 공격력 +25% | 뒤틀림 +20 |
| 불굴의 육신을 받는다 | 최대 HP와 방어력 각각 +25% | 뒤틀림 +20 |
| 꿰뚫는 눈을 받는다 | 방어 관통력 +300, 방어력 무시 +10%p | 뒤틀림 +25 |
| 도망친다 | 5층 이동 | 없음 |

기존 탐험 효과에 합산하며, 관통 수치는 공통 전투 계산에 전달한다. 최대 HP 증가는 현재 HP를 회복시키지 않는다. 바깥 캐릭터의 능력치와 HP/MP는 바뀌지 않는다. 뒤틀림은 100에서 제한하고 이후 진행은 기존 붕괴 규칙을 따른다. 완료 후 기존 이벤트 보상 흐름으로 증강을 제시하며, 갈림길의 기습/유물 보상도 유지한다. 거래 결과는 기존 획득 연출로 표시한다.

## 시각 자산

- Claude CLI `claude-opus-5-5`에 시각 방향만 1회 요청했다. 비용 $0.0984256, 상한 $0.80. 상세 결과는 `output/distortion-event/design-result.json`.
- 배경은 내장 imagegen으로 신규 생성했다. 아래 프롬프트를 사용해 1672×941 그림을 만들고 WebP로 변환했다.
- 프로젝트 파일: `DB/RPGenius/ui/낙원/riftTrader.webp`
- S3: `s3://eefl-image/tcgenius/assets/ui/낙원/riftTrader.webp`
- SHA-256: `91c80d774d81b2a26cc3c54870a47d89a22997173c2a160ee7a58f338edb51ed`
- `scripts/paradise_assets.json`에 등록하고 기존 마이그레이션 스크립트로 새 파일만 업로드했다. S3 객체를 다시 읽어 해시와 MIME을 확인했다.
- WebGL 배경, 보라색 균열 맥동, 구리/녹청/강철/회색 선택지 테두리를 사용한다. 작은 모바일에서는 패널 여백을 줄이며 글꼴은 기존 것을 유지한다.

최종 생성 프롬프트:

```text
Use case: stylized-concept. Asset type: finished full-screen background for a Korean dark fantasy roguelike WebGL game event, 16:9 landscape. Primary request: 'The Rift Merchant', a mysterious merchant who grants strength in return for accumulating distortion in a heavenly corridor. A magnificent ancient ivory-marble arcade floats above clouds, aged gold ornament, monumental receding pillars, fractured celestial architecture. A single tall, thin violet tear in reality opens behind a hooded merchant at the horizontal center. The merchant has an enigmatic half-shadowed face, exquisite weathered robes, and open hands presenting three small levitating enchanted objects: a copper blade, a patina shield, a sharp steel needle. No fourth item. Soft cold heavenly backlight and restrained purple rim light, luminous fractured slivers circling the tear. Detailed painterly high-end fantasy game illustration, atmospheric depth, beautiful tactile stone and metal, ominous elegant mood. Composition: merchant face in the upper third, hands just above the center, all important subjects in the central 30% of width so a narrow mobile crop still works. Lower 35% is quiet dark marble floor suitable behind game choices. Wide side architecture, clearly readable silhouette and sharp detailed central subject. No text, letters, numbers, labels, HUD, cards, borders, watermark, logos or interface. Avoid neon cyberpunk, cartoon, photoreal cosplay, flat web graphics. Output 1920x1080 or higher landscape.
```

기존 격리 테스트 중 관련 8개가 통과했다. 거래 효과, 전투 관통 계산, 탐험 종료 후 효과 해제, 도망, 잘못된 선택과 재선택, 무작위 등장, 뒤틀림 상한을 검증했다. 브라우저에서 PC 1440×900, 모바일 390×844와 360×640의 네 선택지 표시를 확인했다.

