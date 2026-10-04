# 레이드 화면 에셋

보스의 기존 이미지에서 보스만 투명 배경으로 분리하고, 같은 장면의 빈 배경을 별도로 만들었다. 원본의 캔버스 크기와 보스 위치를 유지해 두 이미지를 겹치면 기존 구도가 이어진다. 기존 원본은 보존하며, 생성과 편집에는 내장 imagegen을 사용했다.

저장 위치는 `DB/RPGenius/ui/레이드/`이다. 이 폴더는 다른 게임 이미지와 같이 S3에서 서버 디스크로 동기화된다.

| 파일 | 원본 | 요청 |
| --- | --- | --- |
| sculpture-scene.png | 대저택/조각.png | 원본 좌표의 청동 황소만 분리. 받침대는 배경에 유지 |
| sculpture-hall.png | 대저택/조각.png | 황소만 제거하고 받침대, 촛불, 계단과 카메라 유지 |
| whiplash-scene.png | 대저택/위플래쉬.png | 원본 좌표의 스피커와 안테나, 녹색 표시등, 필기 유지 |
| whiplash-hall.png | 대저택/위플래쉬.png | 스피커와 안테나를 제거하고 원래 계단과 푸른 조명 복원 |
| whiplash-echo-scene.png | 대저택/위플래쉬(0줄).png | 원본 좌표의 인물과 갑옷, 왕관, 머리카락, 뻗은 손 유지 |
| whiplash-echo-hall.png | 대저택/위플래쉬(0줄).png | 인물만 제거하고 붉게 부서진 스피커와 원래 파편 유지 |
| tabujago-scene.png | 부타게임/타부자고.png | 원본 좌표의 분홍 머리 캐릭터와 지팡이 분리 |
| dungeon-gate.png | 부타게임/타부자고.png | 캐릭터와 지팡이를 제거하고 철문과 젖은 바닥 복원 |
| ingyeo.png | 부타게임/잉여왕(기본).png | 중앙 인물과 검은 용 분리. 얼굴, 갑옷, 왕관, 자세와 날개 유지 |
| volcanic-arena.png | 부타게임/잉여왕(기본).png | 인물과 용을 제거하고 원래 현무암, 용암과 연기 복원 |
| ingyeo-berserk.png | 부타게임/잉여왕(하드 부활).png | 중앙 인물과 검은 용 분리. 폐허, 불꽃과 바위 제거 |
| ingyeo-berserk-arena.png | 부타게임/잉여왕(하드 부활).png | 인물과 용을 제거하고 원래 동굴과 불꽃 복원 |
| black-hodu.png | 흑화 호두.png | 모자, 꽃, 의상, 머리카락, 팔과 연결된 붉은 기운 유지. 검은 배경과 떨어진 점 제거 |
| black-hodu-aura.png | 흑화 호두.png | 원래 검정과 진홍색 먹빛 기운을 이어 빈 배경 생성 |
| hodu-retainer.png | 신규 | 검은 장례복, 붉은 매듭, 부적과 장병기를 가진 호두 부하. 투명 배경의 전신 |
| hodu-retainer-court.png | 신규 | 붉은 등불과 봉인된 문이 있는 장례 사원 안뜰. 부하와 같은 조명 |
| fx-dark-mist.png | 신규 | 정화 효과용 검정과 진홍색 연기. 가장자리는 알파 투명 |
| fx-bronze-shard.png | 신규 | 조각 패턴용 입체 청동 파편. 알파 투명 배경 |
| fx-fire-plume-v1.png | 신규 | 난류와 미세한 불꽃 결이 있는 화염. 예열과 분출, 폭주지대에서 사용 |
| fx-healing-wisp-v1.png | 신규 | 옅은 비취색과 금빛 실이 섞인 투명 회복 기운. 실제 HP 회복 때 사용 |
| fx-puzzle-piece-v1.png | 신규 | 두께, 흠집과 황동 테두리가 있는 석재 퍼즐 조각. 회전하며 날아가는 패턴에서 사용 |

공통 생성 조건: 기존 인물의 정체성, 표현, 색과 자세를 유지한다. 기존 보스 전경은 실제 알파 투명 배경에 원본 좌표와 크기를 유지하며, 배경도 같은 카메라와 원근을 사용한다. 두 레이어는 화면 크기에 따라 함께 확대하고 잘라낸다. 신규 부하는 안뜰 바닥과 맞도록 따로 배치한다. 새 글자, 워터마크, 테두리는 추가하지 않는다.

첫 분리 시안인 `sculpture.png`, `whiplash.png`, `whiplash-echo.png`, `tabujago.png`, `mansion-hall.png`는 현재 화면 매핑에서 사용하지 않는다. 작은 여백으로 자른 보스를 임의로 배치하면 원본의 받침대와 바닥 위치가 어긋나므로 등록된 전체 캔버스 전경을 사용한다.

## 외부 효과음

Kenney의 [Interface Sounds](https://kenney.nl/assets/interface-sounds), [Impact Sounds](https://kenney.nl/assets/impact-sounds), [Sci-fi Sounds](https://kenney.nl/assets/sci-fi-sounds)를 사용한다. 각 배포본의 `License.txt`에서 CC0를 확인했다. 합성 기본 효과음 대신 아래 실제 샘플을 재생한다.

저장 위치는 `DB/RPGenius/ui/sfx/raid/`이다.

| 파일 | 배포본 | 원본 파일 | 최대 길이 |
| --- | --- | --- | --- |
| beep.mp3 | Interface Sounds | confirmation_002.ogg | 0.10초 |
| gloss.mp3 | Interface Sounds | glass_004.ogg | 0.8초 |
| shards-fall.mp3 | Impact Sounds | impactGlass_light_003.ogg | 0.6초 |
| shards-impact.mp3 | Impact Sounds | impactGeneric_light_001.ogg | 0.7초 |
| resonance-blast.mp3 | Sci-fi Sounds | explosionCrunch_001.ogg | 1초 |
| wall-hum.mp3 | Sci-fi Sounds | forceField_003.ogg | 1.2초 |
| rupture.mp3 | Impact Sounds | impactGlass_heavy_003.ogg | 0.8초 |
| charge.mp3 | Sci-fi Sounds | forceField_002.ogg | 1초 |

FFmpeg로 시작 무음을 제거하고 피크를 제한해 모노 44.1kHz, MP3 128k로 변환했다. 필터는 `silenceremove=start_periods=1:start_duration=0.005:start_threshold=-45dB,alimiter=limit=0.7:level=false`이다. 공명 폭발의 세 번 신호와 되울림의 두 번 신호는 동일한 외부 샘플을 정해진 시각에 재생한다.

## S3 반영

`scripts/migrate_raid_presentation_assets_to_s3.js`는 현재 화면에서 쓰는 이미지 21개와 외부 효과음 8개를 `tcgenius/assets/ui/`에 업로드한다. `--dry-run`으로 대상과 크기를 확인할 수 있다. 내용이 다른 기존 파일은 덮어쓰지 않으며, 업로드의 MD5, 크기와 MIME 형식을 확인한다. 운영 DB, 아이템 설정, 기존 이미지와 레이드 음악은 변경하지 않는다.

2026-10-04에 `eefl-image` 버킷의 현재 사용 파일 26개를 확인했다. 마지막 수정의 신규 이미지 13개를 업로드했으며 모든 파일의 MD5, 크기와 MIME 형식이 일치했다.

2026-10-05에 신규 효과 질감 3개를 업로드했다. 현재 사용 파일 29개의 MD5, 크기와 MIME 형식을 확인했다. 시각 방향은 Claude Opus 5.5가 실제 전투 화면과 질감을 읽고 검토했으며, 최종 합성은 PC와 320px 모바일의 실제 레이드 화면에서 확인했다.

## 효과 질감 생성 프롬프트

내장 imagegen을 사용했다. 생성된 PNG의 알파를 보존해 위 표의 프로젝트 경로로 복사했다. Canvas에서 위치, 회전, 높이와 광량을 바꾸며 이미지 자체는 수정하지 않는다.

### fx-fire-plume-v1.png

```text
Create one production quality raster VFX texture for a dark fantasy RPG raid, isolated on a truly transparent background. A single irregular vertical turbulent flame plume, narrow at its rooted base, rises upward and spreads into torn wispy curls. Physically convincing fire with fine lacy orange tongues, warm amber yellow hot filaments, deep reddish orange translucent outer edges, a few tiny incandescent sparks. Dense rich painterly detail matched to high end realistic fantasy game paintings, like a fire explosion from molten rock. The upper and side edges dissolve organically into transparency; no opaque smoke, no ground, no object. Moderate controlled luminance: NO broad white center, NO white flash. Leave 10 percent transparent padding at all edges. This is a reusable small alpha billboard texture that must still read as real fire when rendered at 150 to 250 pixels high. It must NOT look like flat vector flames, leaf shapes, smooth petal shapes, neon graphic, cartoon, logo, emoji, diagram, icon, radial sun, solid shape, sticker or UI element. One single plume only, no sheet, no grid, no text, no border, no watermark, no background, no checkerboard painted into image.
```

### fx-healing-wisp-v1.png

```text
A production raster VFX billboard texture for a realistic painted dark fantasy RPG, isolated on a truly transparent background. One delicate vertical wisp of healing energy made of semi-transparent pale emerald and antique gold luminous vapor, wispy filament threads and very fine tiny light motes. Natural flowing curling vapor, light gently soaking into skin, elegant controlled luminance, painterly physical atmosphere at high detail. Sparse irregular wisps, open empty space between strands, softly dissolving alpha edges. The effect rises gently from a small lower base and curves inward near the middle, occupies the central 70 percent of the image with transparent padding. This is a MATERIAL texture for game healing, NOT a logo or diagram. No crosses, leaves, diamonds, petals, glyphs, rings, geometric pattern, hard edges, UI symbols, objects, person, floor, text, white core, border, watermark, opaque cloud or colored background. Keep it subtle enough not to cover a character portrait when layered at low opacity. One continuous energy wisp only, no grid, no animation sheet.
```

### fx-puzzle-piece-v1.png

```text
One small thick interlocking jigsaw puzzle piece, production game VFX sprite for a realistic painted dark fantasy RPG. A single heavy piece seen in a three quarter tilted perspective, made of worn blue gray stone and antique brass edge, visible thickness, chipped corners, subtle engraved surface grooves, physical shadows inside the shape, sharp small pale warm highlight on its upper left beveled edge. Muted rich colors, realistic painterly material matching fantasy boss artwork, intricate tactile detail, intended to be rendered only 24 to 45 pixels across as a thrown tumbling object. Jigsaw shape clearly has one rounded tab and one rounded recess. Fully isolated on a truly transparent background, 15 percent empty padding, no cast shadow outside the object. No bright saturated primary colors, cartoon, vector icon, black outline, emoji, logo, text, background, border, watermark, halo, UI graphic, checkerboard. One object only, not a grid or sheet.
```
