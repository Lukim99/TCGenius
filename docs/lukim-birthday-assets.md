# 루킴의 생일파티 에셋

2026-10-05 제작. 이벤트 레이드 구현에 앞서 보스, 전투 배경과 BGM 후보를 준비했다. 전투 패턴, 능력치, 보상과 입장 규칙은 아직 구현하지 않았다.

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
