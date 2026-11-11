# 보주 합성 에셋

## 이미지와 디자인

- `chamber.webp`, `ritual-ring.webp`: OpenAI ImageGen으로 생성 후 WebP로 인코딩. 생성 프롬프트는 `docs/orb-fusion-design.md`의 배경/마법진 항목에 기록되어 있다.
- 보주 합성 시각 디자인과 WebGL 연출: 사용자 요청에 따라 Claude CLI `claude-opus-5-5`에 위임. 게임 통합과 동작 검증은 Codex에서 수행.
- 보주 이미지 28종과 아이돌 카드 초상 4종: 사용자가 제공한 `새로 추가된 아이템` 폴더의 원본. 이름 정규화 외에 이미지 변경 없음.
- 필드 이미지 4종: ChatGPT 웹에서 생성한 투명 PNG. 설치 경로와 SHA-256은 `scripts/orb_idol_assets.json` 참조. 원본 파일은 S3 `tcgenius/assets/ui/필드/캐릭터/`에 저장한다.

필드 이미지 출처:

- 고급 아이돌 워뇨띠: 사용자가 제공한 [현실적 전신 캐릭터 생성](https://chatgpt.com/c/6adc7a8b-4910-83ec-b4df-a20374b4a6f2)의 결과를 그대로 사용.
- 아이돌 워뇨띠: [전신 캐릭터 에셋 생성](https://chatgpt.com/c/6adc7ace-cca0-83ee-bd90-acb89b5ae47b).
- 아이돌 키노: [캐릭터 에셋 생성](https://chatgpt.com/c/6adc7a28-3ddc-83ee-b25c-6656d21e8cf5).
- 고급 아이돌 키노: [전신 캐릭터 생성](https://chatgpt.com/c/6adc7a5a-e5fc-83e8-93cf-bffa63986101).

공통 필드 프롬프트: 첨부 인물을 RPG 게임 필드용 전신 캐릭터 에셋으로 제작. 원본 얼굴, 헤어스타일, 의상, 장식과 사실적인 스타일을 유지. 자연스러운 대기 자세로 머리부터 신발까지 완성. 세로 구도와 실제 투명 PNG, 선명한 가장자리, 머리와 발끝 여백. 배경 장식, 후광, 그림자 없음. 각 이미지에는 원본의 모자/헤드셋, 푸른 머리/검은 재킷, 분홍 머리/안경/푸른 니트 등 보존할 요소를 명시했다.

## 효과음

선택과 취소는 Kenney CC0 음원이다. 합성음은 아래 CC0 음원에 직접 합성한 바람 소리와 유리 공명음을 겹쳐 제작했다.

| 사용 파일 | 원본 | 출처 |
| --- | --- | --- |
| `select.ogg` | `metalClick.ogg` | [RPG Audio](https://kenney.nl/assets/rpg-audio) |
| `cancel.ogg` | `bookClose.ogg` | [RPG Audio](https://kenney.nl/assets/rpg-audio) |
| `charge-v2.ogg` | 역재생한 `fantasy_magic_button_1.mp3` + 상승하는 세 겹의 바람 소리 | Almitory, [Fantasy Magic Spell](https://opengameart.org/content/fantasy-magic-spell), CC0 |
| `reveal-v2.ogg` | `magical_1_0.ogg` + 빠르게 흩어지는 유리 공명음 | JaggedStone, [Magic Spell SFX](https://opengameart.org/content/magic-spell-sfx), CC0 |

음원은 사용자의 첫 조작 이후에만 재생하며 화면의 음소거 버튼으로 끌 수 있다.

2026-10-24 수정: 충전 1.36초, 결과 2.25초. 48kHz 스테레오, 피크 -1.72dBFS. 원본을 필터링하고 속도/역재생/볼륨을 조절했으며, 공명음과 짧은 스테레오 잔향을 추가했다. [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/)에 따라 사용한다. 결과 공개 시 남아 있는 충전음을 멈추고 결과음을 재생한다.
