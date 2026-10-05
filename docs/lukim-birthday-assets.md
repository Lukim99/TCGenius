# 루킴의 생일파티 에셋

2026-10-05 제작. 이벤트 레이드 구현에 앞서 보스, 전투 배경과 직접 편곡한 1페이즈 BGM을 준비했다. 이전 Suno 후보는 별도로 보관한다. 전투 패턴, 능력치, 보상과 입장 규칙은 아직 구현하지 않았다.

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
