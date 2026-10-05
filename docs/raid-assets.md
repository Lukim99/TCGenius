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
| fx-fire-flow-v2.png | highwizard의 [Animated Flame](https://opengameart.org/content/animated-flame-fire-sprite-sheet), CC0 | 원본 5×5 시트의 25프레임 화염. 예열, 분출과 폭주지대에서 사용 |
| fx-puzzle-piece-v1.png | 신규 | 두께, 흠집과 황동 테두리가 있는 석재 퍼즐 조각. 회전하며 날아가는 패턴에서 사용 |

imagegen으로 만든 이미지의 공통 생성 조건: 기존 인물의 정체성, 표현, 색과 자세를 유지한다. 기존 보스 전경은 실제 알파 투명 배경에 원본 좌표와 크기를 유지하며, 배경도 같은 카메라와 원근을 사용한다. 두 레이어는 화면 크기에 따라 함께 확대하고 잘라낸다. 신규 부하는 안뜰 바닥과 맞도록 따로 배치한다. 새 글자, 워터마크, 테두리는 추가하지 않는다.

첫 분리 시안인 `sculpture.png`, `whiplash.png`, `whiplash-echo.png`, `tabujago.png`, `mansion-hall.png`는 현재 화면 매핑에서 사용하지 않는다. 작은 여백으로 자른 보스를 임의로 배치하면 원본의 받침대와 바닥 위치가 어긋나므로 등록된 전체 캔버스 전경을 사용한다.

## 외부 효과음

레이드의 패턴과 클리어 및 실패 효과음은 아래 CC0 배포본에서 선택했다. 패턴의 공통 `charge.mp3` 매핑은 제거했다. 카운트다운, 일반 타격, 치명타, 스킬, 물약과 전투 시작은 기존 `public/party.js`의 효과음을 유지한다. 원래 파일은 보존한다.

| 제작자 | 배포본 | 라이선스 |
| --- | --- | --- |
| Lentikula | [Healing Spell Impacts](https://lentikula.itch.io/healing-spell-impacts) | CC0 |
| Lentikula | [Basic Spell Impacts](https://lentikula.itch.io/freecc0-basic-spell-impacts-sfx) | CC0 |
| Lentikula | [Druid Spell Impacts](https://lentikula.itch.io/druid-spell-impacts) | CC0 |
| rubberduck | [80 CC0 RPG SFX](https://opengameart.org/node/86018) | CC0 |
| yd | [Short Alarm](https://opengameart.org/content/short-alarm) | CC0 |

저장 위치는 `DB/RPGenius/ui/sfx/raid/`이다. 회복은 회복 마법, 화염은 점화와 분출, 보호막은 얼음, 흑화는 대지 충격과 괴물 소리처럼 사건의 성격에 맞춰 연결한다. 공명의 세 번 신호와 되울림의 두 번 신호는 외부 경보 샘플을 기존 시각에 재생한다. 길이는 변환된 MP3를 FFprobe로 확인한 값이다.

| 파일 | 제작자 | 원본 파일 | 길이 |
| --- | --- | --- | --- |
| signal-v2.mp3 | yd | alarm.ogg | 0.12초 |
| bronze-set-v2.mp3 | rubberduck | rubberduck/metal_01.ogg | 0.53초 |
| shards-rush-v2.mp3 | rubberduck | rubberduck/stones_03.ogg | 1.15초 |
| stone-hit-v2.mp3 | rubberduck | rubberduck/stones_01.ogg | 0.65초 |
| resonance-impact-v2.mp3 | Lentikula | basic/Lightning Spell Impacts/Lightning Spell Impact 3.wav | 1.35초 |
| wall-pressure-v2.mp3 | Lentikula | druid/Wind Spell Impacts/Wind Spell Impact 5.wav | 1.70초 |
| echo-break-v2.mp3 | Lentikula | basic/Ice Spell Impacts/Ice Spell Impact 2.wav | 1.30초 |
| ward-form-v2.mp3 | Lentikula | basic/Ice Spell Impacts/Ice Spell Impact 1.wav | 1.50초 |
| obsidian-close-v2.mp3 | Lentikula | druid/Earth Spell Impacts/Earth Spell Impact 4.wav | 1.35초 |
| mochi-flex-v2.mp3 | rubberduck | rubberduck/creature_slime_02.ogg | 0.69초 |
| rain-veil-v2.mp3 | Lentikula | basic/Water Spell Impacts/Water Spell Impact 4.wav | 1.60초 |
| mirror-glint-v2.mp3 | rubberduck | rubberduck/metal_03.ogg | 0.41초 |
| power-gather-v2.mp3 | Lentikula | druid/Wind Spell Impacts/Wind Spell Impact 1.wav | 1.70초 |
| life-drain-v2.mp3 | Lentikula | druid/Plant Spell Impacts/Plant Spell Impact 4.wav | 1.80초 |
| dark-surge-v2.mp3 | Lentikula | druid/Earth Spell Impacts/Earth Spell Impact 2.wav | 1.65초 |
| dark-growl-v2.mp3 | rubberduck | rubberduck/creature_monster_03.ogg | 0.84초 |
| dealing-aura-v2.mp3 | rubberduck | rubberduck/spell_02.ogg | 0.52초 |
| revival-bloom-v2.mp3 | Lentikula | healing/Impacts/Healing Spell Impact 11.wav | 1.90초 |
| fire-ignite-v2.mp3 | rubberduck | rubberduck/spell_fire_03.ogg | 1.80초 |
| fire-erupt-v2.mp3 | Lentikula | basic/Fire Spell Impacts/Fire Spell Impact 1.wav | 1.48초 |
| sky-load-v2.mp3 | Lentikula | druid/Wind Spell Impacts/Wind Spell Impact 3.wav | 1.50초 |
| sky-impact-v2.mp3 | Lentikula | basic/Fire Spell Impacts/Fire Spell Impact 5.wav | 0.80초 |
| doom-pressure-v2.mp3 | Lentikula | druid/Earth Spell Impacts/Earth Spell Impact 1.wav | 1.70초 |
| doom-cut-v2.mp3 | rubberduck | rubberduck/blade_03.ogg | 0.38초 |
| healing-absorb-v2.mp3 | Lentikula | healing/Impacts/Healing Spell Impact 4.wav | 1.40초 |
| dark-impact-v2.mp3 | Lentikula | druid/Earth Spell Impacts/Earth Spell Impact 3.wav | 1.20초 |
| dealing-cut-v2.mp3 | rubberduck | rubberduck/blade_02.ogg | 0.30초 |
| ground-land-v2.mp3 | rubberduck | rubberduck/stones_02.ogg | 0.65초 |
| puzzle-hit-v2.mp3 | rubberduck | rubberduck/item_stone_02.ogg | 0.27초 |
| raid-clear-v2.mp3 | Lentikula | healing/Impacts/Healing Spell Impact 10.wav | 1.60초 |
| raid-fail-v2.mp3 | rubberduck | rubberduck/creature_die_01.ogg | 0.97초 |

FFmpeg로 시작 무음을 제거하고 필요한 구간만 잘라 모노 44.1kHz, MP3 160k로 변환했다. `silenceremove=start_periods=1:start_duration=0.005:start_threshold=-45dB`, `atrim`, `asetpts=PTS-STARTPTS`, `loudnorm=I=-18:TP=-3:LRA=7`과 마지막 최대 0.18초의 `afade`를 적용했다. 브라우저에서 합성한 기본 효과음을 추가하지 않으며 기존 효과음 볼륨, 음소거, 중단 및 재접속 규칙을 유지한다.

## S3 반영

`scripts/migrate_raid_presentation_assets_to_s3.js`는 현재 화면에서 쓰는 이미지 20개와 외부 효과음 31개를 `tcgenius/assets/ui/`에 업로드한다. `--dry-run`으로 대상과 크기를 확인할 수 있다. 내용이 다른 기존 파일은 덮어쓰지 않으며, 업로드의 MD5, 크기와 MIME 형식을 확인한다. 운영 DB, 아이템 설정, 기존 이미지와 레이드 음악은 변경하지 않는다.

2026-10-04에 `eefl-image` 버킷의 현재 사용 파일 26개를 확인했다. 마지막 수정의 신규 이미지 13개를 업로드했으며 모든 파일의 MD5, 크기와 MIME 형식이 일치했다.

2026-10-05에 신규 효과 질감 3개를 업로드했다. 현재 사용 파일 29개의 MD5, 크기와 MIME 형식을 확인했다. 시각 방향은 Claude Opus 5.5가 실제 전투 화면과 질감을 읽고 검토했으며, 최종 합성은 PC와 320px 모바일의 실제 레이드 화면에서 확인했다.

2026-10-05 자연스러운 화염과 회복 동작을 적용하면서 신규 화염 시트 1개와 효과음 38개를 업로드했다. 업로드한 58개 파일의 MD5, 크기와 MIME 형식을 확인했다. 최종 적용 범위는 패턴과 종료 효과음 31개 및 이미지 20개이며, 이 51개 파일을 다시 검증했다. 적용하지 않은 일반 전투용 신규 음원 7개는 참조하지 않는다. 이전 화염과 회복 질감, 효과음은 삭제하거나 덮어쓰지 않았다. 새 화염 시트는 외부 원본을 그대로 저장한다. 검은 배경은 실행 중 한 번만 광량 알파로 변환해 합성하며 원본 파일을 편집하지 않는다.

## 이전 효과 질감 생성 프롬프트

아래 질감은 내장 imagegen으로 만들고 PNG 알파를 보존했다. `fx-fire-plume-v1.png`와 `fx-healing-wisp-v1.png`는 현재 레이드에서 사용하지 않는다. 퍼즐 조각 질감은 계속 사용한다.

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
