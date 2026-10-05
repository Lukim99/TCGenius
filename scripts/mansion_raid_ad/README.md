# E세계 대저택 레이드 60초 광고

RPGenius 신규 레이드 「E세계 대저택」을 소개하는 1920×1080, 60fps, 60초 가로 광고 영상의 제작 소스다. 결과물은 `output/mansion-raid-ad/mansion-raid-ad-60s.mp4`에 있다.

## 구성

| 시간 | 장면 | 내용 |
| --- | --- | --- |
| 0:00–0:08 | 인트로 | 빛의 틈 → 저택 외경과 번개 → 세 보스 티저 컷 → 문이 열리는 빛 |
| 0:08–0:22 | 1관문 조각 | 표지, 쏟아지는 조각, 기둥 하중 이동(0/4/8/12 → 6/6/6/6), 완성하면 안 되는 작품(돌덩이를 정으로 쪼아 조각을 드러냄), edaa 받아쓰기, 단단해지기 |
| 0:22–0:33 | 2관문 위플래쉬 | 표지, 공명 폭발(신호 3회 → 폭발), 되울림, 울리는 벽, 맥동 제어(맥동과 대상의 흡수/방출 버튼), HP 1까지 연타 |
| 0:33–0:36 | 4초 정지 | 테이프 정지음, 흑백 정지 화면, 4, 3, 2, 1 카운트, 붉은 균열 |
| 0:36–0:51 | 잔향, 난이도, 지원군, 보상 | 화면이 깨지며 잔향 등장, 노말/하드/나이트메어 카드, 피카츄/오로라/눈뜬 장님, 아티팩트와 보상 |
| 0:51–1:00 | 칭호, 타이틀 | 칭호 5종 → 마지막 타격에 키 비주얼, 입장 조건과 입장 버튼 |

컷과 효과음은 두 레이드 BGM을 분석한 박자 격자(1관문 107.99 BPM, 2관문 110.62 BPM)에 맞췄다. 수치는 `MANSION_RAID_DESIGN.md`의 값을 사용한다(최대 HP는 나이트메어 기준, 난이도 카드의 TOTAL HP는 관문 보스 HP 합).

화면 문구 원칙: 가운뎃점(·) 구분자를 쓰지 않고 배지, 줄바꿈, 간격으로 나눈다. 패턴의 공략(성공 구간, 맥동 제어의 정답과 결과)과 난이도 해금 방식은 표시하지 않는다.

## 파일

- `timeline.js` — 구간, 박자, 음악 편집 목록, 효과음 큐. 영상과 오디오가 함께 사용한다.
- `ad.js`, `index.html` — Canvas 2D 렌더러. `renderFrame(t)`는 시각만으로 화면을 결정하므로 병렬 렌더가 가능하다.
- `audio.js` — BGM을 박자 단위로 잘라 잇고(정지 구간은 테이프 정지), 레이드 효과음과 합성 효과음을 얹어 -14 LUFS / -2.5 dBTP(AAC 인코딩 뒤 -1 dBTP 이하)로 맞춘다.
- `prepare.js` — 게임 이미지·음원을 `DB/RPGenius/`(없으면 S3 `tcgenius/assets/`)에서 읽어 `.cache/`에 가공하고 Google Fonts(OFL)를 받는다. 운영 데이터와 S3에는 쓰지 않는다.
- `render.js` — 검토용 정지 화면, 전체 프레임, 최종 인코딩.

## 다시 만들기

ImageMagick, FFmpeg, Playwright(Chromium)가 필요하다.

```sh
cd scripts/mansion_raid_ad
node prepare.js                     # 에셋과 폰트 → .cache/
node audio.js                       # .cache/audio.wav
node render.js stills 10.4 36.6     # 원하는 시각 확인 → .cache/stills/
node render.js frames --workers 4   # 3600프레임 → .cache/frames/
node render.js encode               # output/mansion-raid-ad/mansion-raid-ad-60s.mp4
```

`frames`는 이미 있는 프레임을 건너뛴다. 장면을 고친 뒤에는 해당 구간의 `.cache/frames/f_*.jpg`를 지우고 다시 실행한다.

## 사용한 에셋

- 게임 이미지: 대저택 표지·보스 장면 레이어, 지원군, 아이템·펫 아이콘, 칭호 이미지(모두 게임 원본, `docs/raid-assets.md`).
- 음악: `E세계대저택 1관문.mp3`, `E세계대저택 2관문.mp3`(게임 레이드 BGM).
- 효과음: `DB/RPGenius/ui/sfx/raid/`의 CC0 효과음(출처는 `docs/raid-assets.md`)과 `audio.js`에서 합성한 소리.
- 글꼴: Noto Serif KR, Noto Sans KR, Cinzel, Barlow Condensed, JetBrains Mono, Black Han Sans(모두 SIL OFL).
