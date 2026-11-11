# 거래, 메일 무대 효과음

`public/market-stage.js`가 1:1 거래와 우편함에서 재생한다. 모두 원작자가 CC0 1.0으로 배포한 실제 녹음이며 코드로 합성한 소리는 없다.
2026-11-11에 받은 배포본에서 골랐다. 가공은 FFmpeg로 앞의 무음을 자르고(-48dB 기준), 최대 음량을 -1.5dBFS로 맞춘 뒤 모노 128kbps MP3로 저장한 것뿐이다. 음색은 바꾸지 않았다.

## 출처

| 제작자 | 배포본 | 라이선스 |
| --- | --- | --- |
| Kenney | [RPG Audio](https://kenney.nl/assets/rpg-audio) | CC0 1.0 |
| Kenney | [Casino Audio](https://kenney.nl/assets/casino-audio) | CC0 1.0 |
| rubberduck | [80 CC0 RPG SFX](https://opengameart.org/node/86018) | CC0 1.0 |
| rubberduck | [100 CC0 SFX](https://opengameart.org/content/100-cc0-sfx) | CC0 1.0 |

## 파일

| 파일 | 쓰는 곳 | 제작자 | 원본 파일 | 길이 |
| --- | --- | --- | --- | --- |
| select.mp3 | 탭, 칸, 버튼 선택 | Kenney RPG Audio | metalClick.ogg | 0.45초 |
| card.mp3 | 거래판에 카드를 올림 | Kenney Casino Audio | card-place-1.ogg | 0.60초 |
| slide.mp3 | 상대가 거래판 물품을 바꿈 | Kenney Casino Audio | card-slide-3.ogg | 0.60초 |
| chips.mp3 | 골드나 가넷을 올림 | Kenney Casino Audio | chips-stack-2.ogg | 0.16초 |
| drop.mp3 | 장비나 아이템을 올림 | Kenney RPG Audio | dropLeather.ogg | 0.41초 |
| lock.mp3 | 거래 확정 (나 또는 상대) | rubberduck 80 CC0 RPG SFX | lock_01.ogg | 0.38초 |
| unlock.mp3 | 확정 취소 | rubberduck 100 CC0 SFX | key_open_01.ogg | 0.39초 |
| deal.mp3 | 거래 완료 | rubberduck 80 CC0 RPG SFX | item_coins_04.ogg | 1.56초 |
| cancel.mp3 | 거래 취소, 창 닫기 | Kenney RPG Audio | bookClose.ogg | 0.20초 |
| paper.mp3 | 보관함, 편지 쓰기를 펼침 | rubberduck 100 CC0 SFX | paper_02.ogg | 0.52초 |
| letter.mp3 | 편지를 엶 | rubberduck 100 CC0 SFX | paper_01.ogg | 0.40초 |
| pack.mp3 | 소포에 선물을 담음 | Kenney RPG Audio | cloth2.ogg | 0.37초 |
| stamp.mp3 | 편지 발송 | Kenney RPG Audio | bookPlace1.ogg | 0.28초 |
| claim.mp3 | 선물 받기 | Kenney RPG Audio | handleCoins.ogg | 0.79초 |

상점과 마찬가지로 효과음 조작 버튼은 두지 않는다. 화면을 떠나거나 탭이 가려지면 재생 중인 소리를 멈춘다.
