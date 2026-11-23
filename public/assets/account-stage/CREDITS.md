# 계정 화면(로그인, 캐릭터 선택) 자산: 거울 호수

`public/account-stage.js`와 `public/account-stage.css`가 쓴다.

## 그림

스무 장 모두 `imagegen-brief.json`의 지시문 그대로 이미지 생성 도구로 만든 그림이다(2026-11-23). 코드로 그린 대체 그림은 없다.
받은 PNG를 화면에 맞게 다듬어 WebP로 저장했다. 그림 내용은 바꾸지 않았다.

- 투명 배경 그림은 알파 경계로 여백을 잘랐다. 먼 풍경과 문은 바닥이 물가에 닿도록 아래 여백을 없앴다.
- 긴 변을 화면에서 쓰는 크기로 줄였다(하늘과 먼 풍경 1536px, 문 1400px, 장식 360~1200px).

| 파일 | 쓰는 곳 |
| --- | --- |
| sky-night.webp, sky-realm.webp | 물 위 하늘, 그리고 반대편 화면의 물에 비치는 하늘 |
| horizon-night.webp, horizon-realm.webp | 물가에 선 먼 풍경(넓은 화면은 좌우를 뒤집어 잇는다) |
| gate-ruin.webp, gate-realm.webp | 반쪽 문. 물에 비친 반대편 문과 합쳐 하나의 고리가 된다 |
| fore-left.webp, fore-right.webp, fore-night.webp | 화면 모서리에 붙는 앞쪽 풍경 |
| sigil.webp | 캐릭터 발밑 마법진(캐릭터 그림의 대표 색으로 물들인다) |
| marker.webp | 고른 캐릭터 머리 위 표식 |
| lotus-bud.webp, lotus-sealed.webp | 빈 자리, 포인트로 여는 자리 |
| petals.webp | 꽃잎, 잎, 빛 알갱이(2x2 묶음) |
| crest.webp | 문장 |
| ui-frame.webp, ui-button-start.webp, ui-button.webp, ui-ledger.webp, ui-divider.webp | 창 테두리, 큰 단추, 작은 단추, 재화 장부의 금선, 구분 장식 |

캐릭터 그림은 `/api/characters`가 주는 주소의 실제 그림을 그대로 쓴다. 물결, 물그림자, 파문, 세계가 뒤집히는 연출은 WebGL 셰이더가 위 그림을 재료로 만든다.

## 효과음

모두 원작자가 Freesound에 CC0 1.0으로 올린 실제 녹음이며 코드로 합성한 소리는 없다.
각 소리 페이지의 라이선스 표기(CC0 1.0)를 확인하고 HQ 미리듣기 MP3를 받았다(2026-11-23).
FFmpeg로 앞의 무음을 자르고(-48dB 기준) 모노 44.1kHz 128kbps MP3로 저장했다. 디코드한 최대 음량은 -2dBFS 안팎으로 맞췄고 음색은 바꾸지 않았다.
반복 재생하는 배경음은 구간을 잘라 끝 3초를 처음과 겹쳐 이음매를 없앴다. `night.mp3`는 -12dBFS, `lake.mp3`는 -6dBFS로 낮췄다.

| 파일 | 쓰는 곳 | 제작자 | 원본 | 구간, 길이 |
| --- | --- | --- | --- | --- |
| night.mp3 | 로그인 밤 배경음(반복) | alfrd_jpn | [amb-night-cricets_montenegro.aif](https://freesound.org/people/alfrd_jpn/sounds/264506/) | 2초부터 34초, 반복 31초 |
| lake.mp3 | 두 화면의 호수 물소리(반복) | salilnair | [Water-lap-against-rocks-lake.wav](https://freesound.org/people/salilnair/sounds/524688/) | 4초부터 38초, 반복 31초 |
| ripple.mp3 | 캐릭터 고르기, 서포트 연결 | alegemaate | [Water Splash](https://freesound.org/people/alegemaate/sounds/364700/) | 전체 0.80초 |
| plunge.mp3 | 로그인 성공(세계가 뒤집힘), 게임 시작 | cribbler | [Splash_throw_2.wav](https://freesound.org/people/cribbler/sounds/440431/) | 1.49초(끝 0.25초 줄임) |
| whoosh.mp3 | 제목에서 입장, 코드 단계, 세계가 뒤집힐 때 | Khrinx | [Deep whosh - Short](https://freesound.org/people/Khrinx/sounds/523978/) | 2.18초(끝 0.25초 줄임) |
| star.mp3 | 닉네임 글자를 적을 때 | nettimato | [tap stone](https://freesound.org/people/nettimato/sounds/350343/) | 전체 0.16초 |
| tap.mp3 | 단추, 탭, 창 열기 | NoisyRedFox | [SingleKnock_Wood](https://freesound.org/people/NoisyRedFox/sounds/742356/) | 전체 0.20초 |
| deny.mp3 | 오류, 거절 | TriqyStudio | [DullThud.wav](https://freesound.org/people/TriqyStudio/sounds/653370/) | 전체 0.58초 |
| coin.mp3 | 포인트나 전송기를 쓴 뒤 | The_Frisbee_of_Peace | [Pouch ofGold Coins Place Down on Wood.wav](https://freesound.org/people/The_Frisbee_of_Peace/sounds/575583/) | 전체 0.77초 |

아무도 직접 듣고 고르지 않았다. 길이, 최대 음량, 150Hz 아래와 200Hz~2kHz, 4kHz 위 대역 비율을 재서 골랐다.

## 글꼴

| 파일 | 원본 | 라이선스 |
| --- | --- | --- |
| as-serif.woff2 | Hahmlet 가변 글꼴(굵기 100~900, Google Fonts 배포본)에서 한글 11,172자와 라틴, 기호만 남기고 WOFF2로 압축 | SIL Open Font License 1.1, `Hahmlet-OFL.txt` |
| as-wordmark.woff2 | Cormorant Garamond 가변 글꼴의 굵기 700을 뽑아 기본 라틴만 남기고 WOFF2로 압축 | SIL Open Font License 1.1, `CormorantGaramond-OFL.txt` |

글자 수를 줄인 파생본이라 `AS Serif`, `AS Wordmark`라는 이름으로 불러 쓴다. 두 화면의 한글과 숫자는 모두 `AS Serif` 한 벌이고, `AS Wordmark`는 로그인 화면의 RPGENIUS 글자에만 쓴다.
