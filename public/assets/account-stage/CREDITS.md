# 계정 화면(로그인, 캐릭터 선택) 자산: 거울 호수

`public/account-stage.js`와 `public/account-stage.css`가 쓴다.

전체 화면 물품 이전은 `public/account-transfer.js`와 `public/account-transfer.css`가 같은 배경, 마법진, 버튼 그림과 CC0 `tap`, `whoosh`, `coin`, `deny` 녹음을 재사용한다. 추가 합성 음원은 없다. 시각 구성과 전송 연출은 Claude CLI의 `claude-fable-5-2`에 맡겼으며 브라우저 검증은 Codex가 수행했다. 이후 사용자 피드백에 따라 카드 정보 축약, 레벨 위치, 할로윈 표시와 좁은 화면의 상세 배치를 조정했다.

2026-11-23 사용자가 제공한 `캐릭터 (2)/캐릭터`의 일반 및 전직 표지 34장과 `.새 아이템들 (17)/.새 아이템들`의 닉네임 변경권, 카드 전송기, 장비 전송기, 캐릭터 슬롯 확장권 PNG 4장을 그대로 사용한다. 원본은 S3 기존 자산 경로로 연결했으며 `scripts/character_account_assets.json`에 파일별 해시를 기록했다. 각성 표지와 기존 일반 표지에서 추출한 소개는 유지한다. 장비 아이콘은 기존 거래 화면처럼 투명 여백을 제외한 실제 그림을 표시 영역에 맞춘다. 원본 파일은 변경하지 않는다.

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

전체 화면 캐릭터 생성은 같은 API의 `iconUrl`과 `covers`로 프레임을 합성하지 않은 기존 캐릭터 아이콘과 일반, 전직, 각성 표지를 사용한다. 표지는 원본 비율과 내용을 유지하며 별도 그림을 생성하거나 외부 이미지를 덧붙이지 않았다. `DB/RPGenius/CharacterIntroductions.json`은 17개 일반 표지의 흰색 소개 문구만 옮겼다. 문장의 줄바꿈을 합치고 문장 사이 마침표를 정리했으며, 노란색 능력 문구는 포함하지 않는다. 선택 효과음은 아래의 기존 `tap.mp3`를 재사용하며, 마우스 올리기와 같은 캐릭터 재선택에는 재생하지 않는다.

## 배경 음악

`portraits-of-dawn.mp3`는 2026-11-23에 사용자의 Suno 계정 Lukim9에서 v6-wild 모델로 생성하고 Pro 플랜에서 Unlock & Download로 받은 원본 MP3다. 기존 생성 크레딧 10개와 다운로드 1회를 사용했다. 곡명은 **RPGENIUS Portraits of Dawn**, [Suno 원본](https://suno.com/song/b71c634c-9cc6-409e-b68b-5413e60e3bb6)이다. 새 구독이나 결제, Publish는 실행하지 않았다.

[Suno 유료 플랜 권리 안내](https://help.suno.com/en/articles/9601665)에 따라 Pro 플랜에서 다운로드한 곡의 상업적 이용 권한을 확인했다. 이 곡은 아래 효과음의 CC0 라이선스에 포함되지 않는다.

- 179.720초, 48kHz 스테레오, 4,051,822바이트. 다운로드 파일을 변환 없이 사용한다.
- 디코드 검사 결과 평균 -18.7dBFS, 최대 -5.4dBFS. 직접 청감 평가는 하지 않았다.
- 로그인과 캐릭터 선택에서 같은 곡 하나를 반복한다. HTMLAudioElement로 스트리밍하며 앱 볼륨은 0.28이다. 캐릭터나 표지를 바꿔도 재시작하지 않는다. 기존 소리 버튼과 설정을 공유하고, 숨긴 탭과 음소거 중에는 일시 정지한다.
- 가사는 비워 두고 보컬, 합창, 말소리, 물소리, 물방울, 비, 강한 타격음과 전투 드럼을 제외하도록 요청했다. Suno 결과 페이지는 Instrumental로 표시된다.

생성 지시문:

> Original instrumental fantasy RPG character selection theme, 3 minutes, 76 BPM. A luminous portrait hall floating above a moonlit kingdom, solemn wonder turning into quiet hope. Intimate felt piano melody, warm legato chamber strings, airy woodwinds, soft harp harmonics, deep gentle orchestral cushion. Elegant memorable four-note motif with patient variations and spacious pauses. Restrained dynamics, rounded transients, clear warm mix, calm enough for long menu browsing. Slowly evolving harmony, no big climax, no combat drums, no vocals or choir, no speech, no environmental sounds, no water, splashes, rain or droplets. Begin softly, end with a sustained harmonic tail suitable for a gentle loop. High quality orchestral game soundtrack, entirely original.

## 효과음

모두 원작자가 Freesound에 CC0 1.0으로 올린 실제 녹음이며 코드로 합성한 소리는 없다.
각 소리 페이지의 라이선스 표기(CC0 1.0)를 확인하고 HQ 미리듣기 MP3를 받았다(2026-11-23).
FFmpeg로 앞의 무음을 자르고(-48dB 기준) 모노 44.1kHz 128kbps MP3로 저장했다. 디코드한 최대 음량은 -2dBFS 안팎으로 맞췄고 음색은 바꾸지 않았다.
이전에 사용하던 반복 환경음은 구간을 잘라 끝 3초를 처음과 겹쳤으며 `night.mp3`는 -12dBFS, `lake.mp3`는 -6dBFS로 낮췄다. 두 파일은 보관만 하고 더 이상 요청하거나 재생하지 않는다.

| 파일 | 쓰는 곳 | 제작자 | 원본 | 구간, 길이 |
| --- | --- | --- | --- | --- |
| night.mp3 | 보관 음원(재생하지 않음) | alfrd_jpn | [amb-night-cricets_montenegro.aif](https://freesound.org/people/alfrd_jpn/sounds/264506/) | 2초부터 34초, 반복 31초 |
| lake.mp3 | 보관 음원(재생하지 않음) | salilnair | [Water-lap-against-rocks-lake.wav](https://freesound.org/people/salilnair/sounds/524688/) | 4초부터 38초, 반복 31초 |
| ripple.mp3 | 보관 음원(재생하지 않음) | alegemaate | [Water Splash](https://freesound.org/people/alegemaate/sounds/364700/) | 전체 0.80초 |
| plunge.mp3 | 게임 시작 시 한 번 | cribbler | [Splash_throw_2.wav](https://freesound.org/people/cribbler/sounds/440431/) | 1.49초(끝 0.25초 줄임) |
| whoosh.mp3 | 제목에서 입장, 코드 단계, 세계가 뒤집힐 때 | Khrinx | [Deep whosh - Short](https://freesound.org/people/Khrinx/sounds/523978/) | 2.18초(끝 0.25초 줄임) |
| star.mp3 | 닉네임 글자를 적을 때 | nettimato | [tap stone](https://freesound.org/people/nettimato/sounds/350343/) | 전체 0.16초 |
| tap.mp3 | 단추, 탭, 창 열기 | NoisyRedFox | [SingleKnock_Wood](https://freesound.org/people/NoisyRedFox/sounds/742356/) | 전체 0.20초 |
| deny.mp3 | 오류, 거절 | TriqyStudio | [DullThud.wav](https://freesound.org/people/TriqyStudio/sounds/653370/) | 전체 0.58초 |
| coin.mp3 | 포인트나 전송기를 쓴 뒤 | The_Frisbee_of_Peace | [Pouch ofGold Coins Place Down on Wood.wav](https://freesound.org/people/The_Frisbee_of_Peace/sounds/575583/) | 전체 0.77초 |

아무도 직접 듣고 고르지 않았다. 길이, 최대 음량, 150Hz 아래와 200Hz~2kHz, 4kHz 위 대역 비율을 재서 골랐다.

## 파견과 도감

2026-11-23 파견 화면과 도감의 디자인 구현에는 Claude CLI의 `claude-fable-5-2`를 사용했다. 기존 게임 이미지를 재사용한다.
파견 배경은 게임의 `필드/부타게임H.png`와 `public/assets/paradise/corridor.webp`, 출발과 귀환의 표식은 위의 `sigil.webp`, `marker.webp`를 재사용한다.
파견 출발에는 `whoosh.mp3`, 보상을 지급한 귀환에는 `coin.mp3`, 선택에는 `tap.mp3`, 거절에는 `deny.mp3`를 사용한다. 도감의 선택 효과음은 `tap.mp3`다. 모두 위 표의 CC0 원본에서 가져온 기존 파일이며 새로 합성한 소리나 반복 환경음을 추가하지 않았다.
화면별 효과음 끄기를 제공하고, 동작 줄이기 설정에서는 파견 전환 연출을 생략한다.

## 글꼴

사용자 요청에 따라 도감, 파견, 캐릭터 선택에는 제공받은 `NEXON_Warhaven.zip`의 워헤이븐 Regular와 Bold 원본 OTF를 사용한다. 변환이나 서브셋 처리는 하지 않았다. 저작권 안내는 `public/assets/fonts/warhaven/LICENSE.txt`에 있으며 [넥슨 공식 서체 안내](https://brand.nexon.com/ko/ci-brand-guidelines/typeface#section-warhaven)를 확인했다. 아래의 기존 서체는 로그인 화면에 남는다.

| 파일 | 원본 | 라이선스 |
| --- | --- | --- |
| as-serif.woff2 | Hahmlet 가변 글꼴(굵기 100~900, Google Fonts 배포본)에서 한글 11,172자와 라틴, 기호만 남기고 WOFF2로 압축 | SIL Open Font License 1.1, `Hahmlet-OFL.txt` |
| as-wordmark.woff2 | Cormorant Garamond 가변 글꼴의 굵기 700을 뽑아 기본 라틴만 남기고 WOFF2로 압축 | SIL Open Font License 1.1, `CormorantGaramond-OFL.txt` |

글자 수를 줄인 파생본이라 `AS Serif`, `AS Wordmark`라는 이름으로 불러 쓴다. 로그인 화면의 한글과 숫자는 `AS Serif`, RPGENIUS 제목은 `AS Wordmark`를 쓴다.
