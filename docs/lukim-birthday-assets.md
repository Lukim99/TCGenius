# 루킴의 생일파티 에셋

2026-10-05에 보스, 전투 배경과 직접 편곡한 1페이즈 BGM을 준비했다. 2026-10-06에 배너, 전투 소품, 보스 동작, 케이크 아이콘과 외부 패턴 효과음을 추가하고 사용자가 제공한 2페이즈 BGM을 연결했다. 전투 규칙과 구현은 [생일 레이드 문서](lukim-birthday-raid.md)를 따른다. 이전 Suno 후보는 별도로 보관한다.

## 이미지

첨부한 낙서 얼굴을 정체성 참조로 사용했다. 두 개의 빈 타원 눈, 위쪽의 짧은 검정 획과 w형 입을 유지하고 생일 모자, 촛불 지팡이와 버건디 망토를 추가했다. 이미지는 내장 imagegen으로 제작했다. Claude Opus 5.5는 시각 구성과 생성 요청 문안을 검토했다.

| 파일 | 용도 | 크기 | 형식 |
| --- | --- | --- | --- |
| DB/RPGenius/ui/레이드/lukim-birthday-boss-v1.png | 독립 보스 스프라이트 | 1206 × 1305 | RGBA, 투명 알파 |
| DB/RPGenius/ui/레이드/lukim-birthday-hall-v1.png | 생일 연회장 전투 배경 | 1672 × 941 | RGB, 화면 전체 배경 |

얼굴은 보스에만 존재한다. 배경 중앙은 전투 공간으로 비우고 케이크, 풍선과 선물은 가장자리에 배치했다. 두 이미지의 버건디, 아이보리, 금색 재질과 왼쪽 위의 따뜻한 조명을 맞췄다. 구현 시 [공통 레이드 연출 기준](raid-presentation.md)에 따라 독립 스프라이트와 배경으로 연결한다. 원본 이미지 파일을 수동으로 편집하거나 기존 레이드 이미지를 교체하지 않았다.

S3 대상은 아래 두 경로다. 기존 마이그레이션 스크립트에 등록했으며 다른 내용의 기존 파일을 덮어쓰지 않는다.

- tcgenius/assets/ui/레이드/lukim-birthday-boss-v1.png
- tcgenius/assets/ui/레이드/lukim-birthday-hall-v1.png

2026-10-05에 eefl-image 버킷으로 위 두 파일을 업로드했다. 스크립트의 전체 대상 57개에서 MD5, 파일 크기와 MIME 형식이 일치함을 확인했다.

### 보스 생성 요청

```text
Use case: stylized-concept. Asset type: transparent full-body boss sprite for the Korean fantasy RPG event raid "루킴의 생일파티". The attached image is an identity reference for the FACE, not a background.
Reproduce the face recognizably and faithfully: two large imperfect EMPTY black-outline oval eyes with no pupils and no iris, each with the short curved upper eyebrow stroke as drawn, and the small black w-shaped mouth low between the eyes. Preserve the wide spacing, asymmetry and hand-drawn monoline black marker quality. No nose, blush, eyelashes, human or anime face. The face remains a flat black doodle on the white body.
Subject: a large round white Birthday Host creature, nearly spherical like a satin-white marshmallow or fondant-covered cake, gently shaded dimensional smooth surface, short stubby rounded arms and small feet. Confident playful boss presence, slightly tilted body, one hand on hip and the other holding a tall ornate birthday candle scepter with spiral ivory and gold wax and a real warm flame. Cream-and-gold striped cone party hat with tiny gold pom-pom at a jaunty angle. Rich deep burgundy velvet cape with embroidered gold trim and small gold gift-shaped clasp. Full face unobstructed.
Premium painterly 3D hybrid RPG production art, detailed velvet, wax and metal, restrained sophisticated birthday colors, readable silhouette and facial identity at mobile game sizes. Slightly low camera, near-frontal three-quarter body view while the face faces the viewer. Warm amber upper-left key light, soft golden candle rim light behind, warm cream bounce. Entire body, hat tip, flame and cape visible, centered, 10-12% transparent margin on each edge.
Output genuine transparent alpha PNG, no background, no floor, no baked ground shadow, no text, no UI, no watermark, no added characters, no opaque aura, no toy clipart.
```

### 배경 생성 요청

```text
Use case: stylized-concept. Asset type: full-bleed landscape 16:9 fantasy RPG battle BACKGROUND for "루킴의 생일파티".
The supplied image is a LIGHTING AND MATERIALS reference for a separate boss sprite. Do NOT include its character or face anywhere in the background. The boss will be placed later as a separate transparent layer.
Environment only: a magnificent warm fantasy banquet hall prepared for a grand birthday party. Tall cream marble columns with gilded capitals, arched windows, deep burgundy velvet drapes, candle-lit crystal and gold chandeliers. Blank burgundy and gold triangular fabric bunting, absolutely no writing. Clusters of champagne gold, ivory and dusty rose balloons at the side edges and ceiling, a few subdued teal balloons as accents. Multi-tier ivory birthday cake with gold leaf, burgundy ribbon and burning candles on a table toward one far side. On the other side, gold candelabras, beautifully wrapped gifts and pastries on long banquet tables.
Composition: generous EMPTY central arena floor, a large clear cream marble circular medallion with fine gold inlay in the center-lower area, plenty of room for the round birthday boss from the reference to stand. Cake, gifts, tables and balloon clusters pushed to outer edges and upper corners. No props blocking the central combat space. Golden confetti and ribbon curls only sparsely around the floor edges. The architecture fills every edge of the image, no letterbox or frame. Low near-frontal three-quarter game camera, horizon around upper third, central standing point around x=.5,y=.72. Use broad coherent floor perspective and rich believable depth.
Light and materials match the boss: warm amber key light from upper LEFT chandeliers, golden candle backlight, soft warm cream bounce, refined burgundy velvet and gold metal. Premium painterly 3D hybrid fantasy game environment, sumptuous surfaces with restrained detail, clear spatial composition, softly atmospheric distance, sharp central floor. Celebratory and magical, no nightclub neon or modern conference room.
WIDE landscape 16:9. No people, creatures, boss, faces, statues of the boss, text, letters, logos, UI, health bars, watermark, border, or blank colored margins.
```

## 1페이즈 직접 편곡 BGM

생일 축하합니다 원곡의 25개 음과 리듬을 그대로 사용해 직접 편곡했다. 첫 음부터 익숙한 선율을 연주하며 76 BPM, 3박자, C장조의 잔잔한 피아노 왈츠로 구성했다. 총 48마디, 약 1분 54초이며 원곡 선율을 다섯 번 반복한다. 낮은 피아노 반주 위에 첼레스타와 현악기를 조용히 더하고 중간에 짧은 간주를 넣었다. 보컬과 드럼은 없다.

| 파일 | 용도 |
| --- | --- |
| DB/RPGenius/ui/sfx/lukim-birthday-phase1-v1.mp3 | 게임용 MP3, 44.1kHz 스테레오, 192kbps |
| output/lukim-birthday/bgm/lukim-birthday-phase1-v1.wav | 무손실 제작 원본 |
| output/lukim-birthday/bgm/lukim-birthday-phase1-v1.ogg | OGG 출력본 |
| output/lukim-birthday/bgm/lukim-birthday-phase1-v1.mid | 악보와 악기 설정 |
| output/lukim-birthday/bgm/lukim-birthday-phase1-v1.json | 제작 수치 기록 |
| scripts/compose_lukim_birthday_bgm.py | 악보, 편곡과 렌더링 소스 |

악기 소리는 [GeneralUser GS 2.0.3](https://github.com/mrbumpy409/GeneralUser-GS)의 녹음 샘플을 [FluidSynth 2.6.1](https://github.com/FluidSynth/fluidsynth/releases/tag/v2.6.1)로 연주해 만들었다. [GeneralUser GS 라이선스](https://raw.githubusercontent.com/mrbumpy409/GeneralUser-GS/main/documentation/LICENSE.txt)는 해당 악기를 사용한 개인용 및 상업용 음악 제작을 허용한다. SoundFont와 렌더러 바이너리는 게임이나 Git에 포함하지 않는다. 이 음원은 Suno 생성 파일을 사용하지 않는다.

재현에는 Python의 NumPy, 해당 SoundFont, FluidSynth와 FFmpeg가 필요하다. 도구 경로를 지정해서 실행한다.

```text
python scripts/compose_lukim_birthday_bgm.py --soundfont GeneralUser-GS.sf2 --fluidsynth fluidsynth.exe --ffmpeg ffmpeg
```

세 번 이어서 연주한 결과의 가운데 반복 구간을 추출해 이전 음의 여운을 보존했다. 양 끝 8ms만 다듬어 경계 클릭을 줄였으며 곡 전체에는 페이드아웃을 넣지 않았다. 음량은 일정한 배율로 조정했다. 최종 MP3에서 FFmpeg로 측정한 평균 음량은 -21.26 LUFS, 최대 실제 피크는 -7.74 dBTP로 클리핑이 없다. 디코딩한 길이는 WAV 원본과 같은 5,013,474프레임(113.684초)이고 반복 경계의 샘플 차이는 0.000092 이하다.

2026-10-05에 eefl-image 버킷의 `tcgenius/assets/ui/sfx/lukim-birthday-phase1-v1.mp3`로 업로드했다. 파일 크기는 2,729,855바이트, MD5는 `ba19052320be0a8a82244695c4190964`다. 마이그레이션 대상 58개에서 내용, 크기와 MIME 형식이 일치함을 확인했으며 이번에 추가한 MP3 한 개만 새로 업로드했다. 출력 폴더의 원본과 이전 Suno 미리보기는 S3에 올리지 않는다.

## 2페이즈 BGM

사용자가 지정한 `DB/RPGenius/ui/sfx/lukim-birthday-phase2.mp3`를 변환 없이 사용한다. MP3 오디오는 48kHz 스테레오이며 파일 길이는 159.294초, 크기는 3,679,520바이트, MD5는 `b79f8f9bf5fa8e6e5877056fb76b2b8c`다. 관문 배열의 두 번째 음원으로 등록해 공통 1.5초 교차 재생을 사용한다. 기존 Suno 미리보기 파일을 대신 연결하지 않는다.

2026-10-06에 eefl-image 버킷의 `tcgenius/assets/ui/sfx/lukim-birthday-phase2.mp3`로 업로드했다. 전체 대상 75개의 MD5, 크기와 MIME 형식이 일치했고 이번에는 2페이즈 MP3 한 개만 추가했다.

## 2026-10-06 전투 이미지

내장 imagegen으로 생성한 PNG를 변환 없이 복사했다. 소품, 동작과 아이템의 투명 알파를 유지한다. Claude Opus 5.5가 보스와 연회장 원본을 보고 물리적인 소품 동선과 조명, 모바일 구성을 제안했고, 아래 제작 규격과 Canvas 합성에 반영했다.

| 파일 | 규격과 배치 | 바이트 | MD5 |
| --- | --- | --- | --- |
| ui/레이드/lukim-birthday-banner-v1.png | 1672×941 RGB. 버건디와 금색 연회장, 오른쪽 루킴과 케이크, 왼쪽 제목 공간 | 2320797 | 7e1809260c22efcc38a8581d53d287a7 |
| ui/레이드/lukim-birthday-props-v1.png | 1536×1024 RGBA. 케이크/촛불/성냥/케이크 조각/노트북/쟁반을 3열 2행에 배치. 균등 셀 대신 실제 소품 영역을 지정 | 2239221 | 366d43cb543c390fd1b364c05fa317a1 |
| ui/레이드/lukim-birthday-poses-v1.png | 1254×1254 RGBA. 2열 2행, 불기/던지기/손을 내리기/마시기 순서. 최종 코딩은 별도 이미지 사용 | 1568863 | 4486f78a7b54dec49979c17c3b28bd5d |
| ui/레이드/lukim-birthday-coding-v1.png | 1254×1254 RGBA. 키보드에 손을 얹은 루킴과 낮은 강연대, 얼굴이 모두 보이는 노트북 | 1373502 | ffc9a8a7df05a8c07f38ea8c5ff89325 |
| itemImage/소모품/케이크.png | 1254×1254 RGBA. 케이크와 접시가 가로 48.1%, 세로 41.9%를 차지하고 좌우 약 26% 투명 여백 유지 | 559571 | ef90cc17ff35ea4e81ac4f7da3d8bec2 |

소품은 보스와 같은 아이보리, 버건디 벨벳, 금박과 따뜻한 왼쪽 위 광원을 사용한다. 촛불은 심지가 보이는 꺼진 상태, 성냥은 오른쪽 끝에서 타는 수평 형태로 제작했다. 균등 셀 경계를 넘는 그림은 실제 픽셀 영역을 사용해 잘림을 피한다. UI, 문자와 바탕은 넣지 않았다. 보스 동작은 빈 타원 눈, w형 입, 생일 모자와 망토를 유지하고 같은 발 위치와 시점으로 제작했다.

### 박수 동작 에셋

2026-10-06에 내장 imagegen으로 박수 손의 초안 `DB/RPGenius/ui/레이드/lukim-birthday-clap-v1.png`를 만들었다. 1774×887 RGBA이며, 크기는 1,071,194바이트, MD5는 `a52f5970649a749d47ca2066a326c93f`다. S3의 `tcgenius/assets/ui/레이드/lukim-birthday-clap-v1.png`에 보관했다. 최종 화면은 아래 v2를 사용한다.

최종 프롬프트:

```text
Use case: stylized-concept. Asset type: transparent RPG animation source sheet of TWO INDIVIDUAL human hands for applause, 2 columns and 1 row. The supplied birthday mascot pose image is ONLY a lighting/material style reference; do not draw its character. Primary request: create two separate realistically proportioned white ivory satin-gloved hands with short burgundy velvet cuffs and delicate gold piping, palms facing each other inward in natural clapping profile, four joined relaxed fingers extended diagonally upward and a visible thumb. LEFT HALF: a left hand with the wrist entering from the bottom left, fingertips pointing toward the upper right, palm facing right toward the sheet center. RIGHT HALF: corresponding right hand, wrist entering from the bottom right, fingertips toward upper left, palm facing left. The hands are SEPARATE with ample transparent space between them, not already touching. Identical scale, camera, warm chandelier light, cohesive high quality painterly 3D Korean fantasy RPG inventory/game asset. Very clear human finger and palm silhouettes readable at 60px, full wrists and cuffs within the frame. Keep each whole hand fully within its own half with 15 percent transparent safe padding to every cell edge, no objects crossing the midpoint. Transparent background with actual alpha zero, no gray fill or checkerboard, no shadow on a floor, no text, no labels, no borders, no UI, no sparkles, no emoji symbols, no mascot or face. These hands will move together and contact for a true clapping animation, so profile rather than palms facing the camera.
```

### 박수 동작 최종본

Claude Opus 5.5가 실제 화면 코드와 소품 이미지를 검토한 뒤 손의 측면, 접촉 동작, 얼굴과 체력 표시를 가리지 않는 배치를 제안했다. 내장 imagegen으로 `DB/RPGenius/ui/레이드/lukim-birthday-clap-v2.png`를 생성했다. 2172×724 RGBA, 1,040,524바이트이며 MD5는 `f30514251df886ff64ca1fb94331f88d`다. 가로 세 칸에 왼손 측면, 오른손 측면, 두 손이 맞닿는 모습을 담았다. 손목을 축으로 접근하고 실제 접촉 순간에 녹음된 박수음을 재생한다.

2026-10-06에 S3의 `tcgenius/assets/ui/레이드/lukim-birthday-clap-v2.png`에 신규 업로드했다. 마이그레이션 대상 77개 파일의 MD5, 크기와 MIME 일치를 확인했고 v2 한 개만 신규 업로드했다. 기존 소품 시트는 바꾸지 않고 케이크, 촛불의 왁스와 심지, 불꽃의 실제 픽셀 영역을 각각 사용한다. 촛대가 없는 루킴 동작을 케이크 뒤에 배치한다.

최종 프롬프트:

```text
Use case: precise-object-edit. Asset type: production RPG clapping animation sprite sheet, THREE SQUARE CELLS in a single horizontal row, canvas 3:1. Image 1 is the edit/style target of ivory gloves and burgundy gold-trimmed cuffs; correct their camera-facing palms into real three-quarter SIDE PROFILE for clapping and add the actual contact frame. Image 2 is a supporting material/lighting reference only. Keep white ivory satin formal gloves, wine red velvet cuffs, delicate gold braid embroidery and warm chandelier light. CELL 1: LEFT HAND ALONE, accurate three-quarter profile from its thumb side, PALM FACING RIGHT INTO THE SHEET, NOT FACING THE CAMERA, four joined fingers pointing up and a little right, thumb naturally placed, wrist and complete cuff at the bottom. CELL 2: RIGHT HAND ALONE, same scale and camera, PALM FACING LEFT, NOT FACING CAMERA, fingers upward slightly left, wrist and complete cuff at bottom. These two profiles have narrow silhouettes so that their actual palm surfaces can meet. CELL 3: a pair of these same gloved hands AT THE INSTANT OF A CLAP, palms pressed flat together, fingers aligned and slightly splayed from physical contact, thumbs naturally side by side, both burgundy cuffs visible. This cell is the unmistakable applause/contact pose, not two hands separated. Match wrist and fingertip heights, scale and illumination across every cell, whole hands and cuffs fully visible, 12 percent genuine transparent padding to all cell edges, no crossing cell boundaries. High quality realistic painterly 3D fantasy game sprite with visible satin seams and finger creases, strong readable side silhouettes at 60 pixels, precise anatomy. True transparent alpha outside subjects. No glow, no bright halo, no drop shadow, no floor, no motion blur, no confetti, no glitter, no gold particles, no lens flare, no text, no grid, no labels, no extra hands, no characters, no praying emoji style.
```

### 케이크 여백 수정

2026-10-06에 사용자의 요청으로 내장 imagegen을 사용해 케이크와 접시를 함께 축소했다. 기존 엘릭서, 파이브의 빵과 황금 주머니의 투명 여백을 참조했다. 이전 케이크는 가로폭의 94.5%를 차지했으며 수정본은 48.1%로, 황금 주머니의 47.1%와 비슷하다. 투명 알파와 원래 케이크의 모양을 유지했다. 기존 파일을 백업한 뒤 S3의 같은 경로만 교체했고, S3에서 다시 받은 PNG와 로컬 파일의 바이트 및 MD5가 일치함을 확인했다.

최종 편집 요청:

```text
Use case: precise-object-edit. Asset type: existing Korean fantasy RPG inventory item icon, transparent PNG. Image 1 is the EDIT TARGET, the existing cake on its gold plate. Images 2, 3, and 4 are ONLY references for the amount of empty padding used by other inventory item icons (bread, elixir, golden pouch). Change ONLY the scale and padding of Image 1: uniformly reduce the entire existing cake AND its ornate gold plate together so that the complete visible silhouette occupies approximately 42% of the square canvas WIDTH and 37% of its HEIGHT, and center this silhouette exactly horizontally and vertically. Leave approximately 29% genuinely transparent empty margin on both left and right, and approximately 31.5% on both top and bottom. The cake must feel the same icon size as the reference items in an inventory slot, not fill the canvas. Preserve the exact original cake identity, single triangular slice, pale cream piping, raspberry on top, golden beads, burgundy ribbon, golden crest, ornate plate, perspective, proportions, baked texture, colors, warm light, and visual finish. No redesign, no new garnish, no new objects, no perspective change. Preserve all plate edges and fine details; no cropping. The complete exterior padding must have true zero alpha, with no white fill, no black fill, no checkerboard, no glow, no frame, no shadow outside the cake/plate, no text, no UI. Single square icon with a small central subject and generous transparent padding.
```

### 코딩 동작의 최종 생성 요청

```text
Use case: precise-object-edit. Production transparent full-body action sprite for an existing fantasy RPG boss. Use the provided boss image as exact identity reference: round satin ivory creature, two empty black oval outline eyes with tiny top strokes, w shaped mouth, ivory and gold striped party hat, burgundy velvet cape with intricate gold brocade, gold gift necklace and short rounded feet. Preserve this identity, proportions, color, material, warm upper-left banquet lighting and near frontal three-quarter camera. Change ONLY the pose and prop: REMOVE the tall candle scepter. The boss is quietly coding, both rounded hands naturally resting on the keyboard of a SMALL believable laptop sitting firmly on a narrow dark burgundy and carved gold waist-high lectern. Render the boss, lectern, laptop and hands together as one coherent physical scene, correctly occluded, with no floating props. Laptop is modest, about one third of boss body width. It is open toward the boss so the viewer sees the back of its thin lid, restrained burgundy with fine gold trim; only a little amber screen light falls upward onto the lower face. The lid and lectern stay BELOW THE MOUTH, do not cover either eye or mouth; face remains completely visible. Keyboard at waist height and both hands touch it, slight forward intent, no cartoon typing symbols. Boss keeps same feet baseline at 91% canvas height, hat top at 6%, centered, full body fully contained with 6% transparent margin. Near-square composition, one single sprite only, no grid or sheet. Premium painterly physically shaded Korean RPG item/character art matched to reference, not flat vector. True RGBA transparent alpha everywhere outside character and lectern, preserve fine cape edges; no floor, no background, no cast shadow extending beyond feet, no glow rings, no neon, no emoji, no text, no code letters, no UI, no watermark, no checkerboard. This image will replace the standing boss momentarily at the same screen size.
```

## 외부 패턴 효과음

아래는 새 생일 패턴 전용 음원이다. 모두 원본 게시자가 CC0로 제공한다. 기존 카운트다운과 일반 전투 효과음은 바꾸지 않았고, 기본 합성음 또는 대체 발진음을 새 패턴에 추가하지 않았다.

| 게임 파일 (`ui/sfx/birthday/`) | 원본과 제작자 | 원본 파일 | 출력 길이 |
| --- | --- | --- | --- |
| match-v1.mp3 | qubodup, [Flare Ignition](https://opengameart.org/content/flare-ignition) | ignition.flac, 처음 0.35초 | 0.350초 |
| ignite-v1.mp3 | qubodup, Flare Ignition | ignition.flac, 0.30초부터 0.65초 | 0.650초 |
| blow-v1.mp3 | AntumDeluge, [Jug Instrument](https://opengameart.org/content/jug-instrument) | jug-1.wav, 0.15초부터 1.40초 | 1.400초 |
| clap-v1.mp3 | qubodup, [Well Done](https://opengameart.org/content/well-done) | Well Done CCBY3.ogg, 0.12초부터 0.90초 | 0.900초 |
| throw-v1.mp3 | artisticdude, [Swishes Sound Pack](https://opengameart.org/content/swishes-sound-pack) | swishes/swish-6.wav | 0.138초 |
| cream-v1.mp3 | EZduzziteh, [Squish Sounds Effects](https://opengameart.org/content/squish-sounds-effects) | squishsplat_impact.mp3 | 0.239초 |
| cork-v1.mp3 | qubodup, [Liquid Bottle Drink Set](https://opengameart.org/content/liquid-bottle-drink-set) | bottle-open-02.flac | 0.358초 |
| drink-v1.mp3 | qubodup, Liquid Bottle Drink Set | swallow-03.flac | 0.461초 |
| typing-v1.mp3 | unicaegames, [Keyboard Soundpack 1](https://opengameart.org/content/keyboard-soundpack-1-typing-and-single-keystrokes) | Human Typing/human_vel-003.wav, 처음 4초 | 4.000초 |
| shuffle-v1.mp3 | Kenney, [RPG Audio](https://kenney.nl/assets/rpg-audio) | Audio/bookFlip2.ogg | 0.430초 |
| gift-v1.mp3 | Kenney, RPG Audio | Audio/metalPot2.ogg, 처음 0.55초 | 0.550초 |

`Well Done CCBY3.ogg`는 예전 라이선스가 파일명에 남아 있으나 원본 페이지는 2024-10-05 업데이트에서 CC0로 변경됐다. 타자음은 실제 키보드를 녹음한 Human Typing 파일이다.

FFmpeg로 필요한 구간을 추출하고 `highpass=f=90,loudnorm=I=-20:TP=-2:LRA=7,afade=t=in:d=0.005`를 적용해 모노 44.1kHz, MP3 160kbps로 변환했다. 원본이 요청 구간보다 짧은 경우 원본 길이를 유지했다. 게임 효과음 볼륨과 음소거에 연결하고, 숨겨진 탭과 전투 종료에서는 재생 중인 음원을 정리한다.

2026-10-06에 eefl-image의 `tcgenius/assets/` 아래로 신규 이미지 5개와 효과음 11개를 업로드했다. `scripts/migrate_raid_presentation_assets_to_s3.js`가 전체 74개 파일의 MD5, 바이트 수와 MIME 형식 일치를 검증했다. 기존 파일은 덮어쓰지 않았다. 운영 Item에는 엘릭서 기능을 복사한 케이크 ID 415만 추가했고, 기존 30일 축복 사용권 ID 370과 모든 기존 아이템 설정은 보존했다.

## Suno BGM 후보

Suno의 로그인된 lukim9 계정에서 v6-mini, Advanced 모드로 생성했다. Lyrics는 빈 상태로 유지해 보컬 없는 BGM을 요청했다. 생일 축하합니다 멜로디를 주요 선율로 반복하고 전투 리듬, 현악기, 금관악기와 벨을 결합하도록 지정했다. Suno가 한 번의 생성으로 두 후보를 반환했다.

| 후보 | Suno 원본 | 화면에 표시된 길이 |
| --- | --- | --- |
| A | [555a391f-98d8-4f0d-b49e-c6cbefe1c985](https://suno.com/song/555a391f-98d8-4f0d-b49e-c6cbefe1c985) | 2:39 |
| B | [890a4ef2-db29-4276-8d4e-69d37dd97574](https://suno.com/song/890a4ef2-db29-4276-8d4e-69d37dd97574) | 2:50 |

후보 A의 무료 미리보기 파일은 output/lukim-birthday/bgm/lukim-birthday-preview-a.mp3에 보관한다. 실제 생성 선율을 음악적으로 판정하거나 반복 구간을 편집하지 않았다. 최종 채택 전 감상과 게임 내 반복 구간 확인이 필요하다.

다운로드 화면에서 현재 플랜이 Free임을 확인했다. [Suno의 2026-08-10 안내](https://suno.com/blog/suno-updates-tos)에 따르면 무료 trial 다운로드는 개인용이며 상업 이용 권한은 유료 플랜에서 다운로드한 곡에 적용된다. 따라서 현재 미리보기 MP3는 공개 게임 자산 경로, S3와 Git 커밋에 넣지 않는다. 사용자가 두 후보를 직접 감상하고 다운로드한 뒤 최종 음원을 알려주기로 했다. 구독, 결제 또는 계정 설정은 변경하지 않았다.

### Suno 생성 요청

```text
Instrumental fantasy RPG birthday boss battle BGM. Use the familiar traditional Happy Birthday to You tune as a clearly recognizable recurring main melody, first on celesta and glockenspiel, then boldly on brass and strings. Festive grand birthday banquet with mischievous battle energy, 144 BPM driving 6/8 groove, staccato strings, triumphant brass, sparkling bells, energetic rock drums, orchestral snare and timpani, rhythmic electric guitar and warm bass. Bright major-key melody with brief minor-key battle tension, clear hook, controlled bass and spacious mix so combat sounds stay readable. Short musical pickup, strong 8-bar phrases, tense break and bigger theme return, 2-3 minutes, loop-friendly ending on the opening groove. No vocals, no spoken words, no choir, no fade out.
```
