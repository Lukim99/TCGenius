# 전투 연출 효과음

`public/combat-fx.js`가 재생하는 효과음이다. 아래 "사용자 제공 음원" 하나를 뺀 나머지는 모두 원작자가 CC0 1.0으로 배포한 녹음 음원이며, 코드로 합성한 소리는 없다.
받은 날짜는 2026-11-11이다.

## 출처

| 제작자 | 배포본 | 라이선스 |
| --- | --- | --- |
| Lentikula | [Basic Spell Impacts](https://lentikula.itch.io/freecc0-basic-spell-impacts-sfx) | CC0 1.0 |
| Lentikula | [Druid Spell Impacts](https://lentikula.itch.io/druid-spell-impacts) | CC0 1.0 |
| Lentikula | [Healing Spell Impacts](https://lentikula.itch.io/healing-spell-impacts) | CC0 1.0 |
| Lentikula | [Sci-Fi Weapon Shots SFX](https://lentikula.itch.io/sci-fi-weapon-shots-sfx-freecc0) | CC0 1.0 |
| Kenney | [Impact Sounds](https://kenney.nl/assets/impact-sounds) | CC0 1.0 |
| rubberduck | [75 CC0 breaking / falling / hit sfx](https://opengameart.org/content/75-cc0-breaking-falling-hit-sfx) | CC0 1.0 |
| rubberduck | [100 CC0 SFX](https://opengameart.org/content/100-cc0-sfx) | CC0 1.0 |
| Kenney | [Sci-Fi Sounds](https://kenney.nl/assets/sci-fi-sounds) | CC0 1.0 |
| rubberduck | [25 CC0 bang / firework SFX](https://opengameart.org/content/25-cc0-bang-firework-sfx) | CC0 1.0 |
| artisticdude | [Swishes Sound Pack](https://opengameart.org/content/swishes-sound-pack) | CC0 1.0 |
| rubberduck | [100 CC0 SFX #2](https://opengameart.org/content/100-cc0-sfx-2) | CC0 1.0 |
| rubberduck | [50 CC0 Sci-Fi SFX](https://opengameart.org/content/50-cc0-sci-fi-sfx) | CC0 1.0 |
| Kenney | [RPG Audio](https://kenney.nl/assets/rpg-audio) | CC0 1.0 |
| rubberduck | [80 CC0 RPG SFX](https://opengameart.org/node/86018) | CC0 1.0 |
| Kenney | [Casino Audio](https://kenney.nl/assets/casino-audio) | CC0 1.0 |
| rubberduck | [40 CC0 water / splash / slime SFX](https://opengameart.org/content/40-cc0-water-splash-slime-sfx) | CC0 1.0 |

## 가공

FFmpeg로 앞의 무음을 잘라내고(-48dB 기준), 최대 음량이 -1.5dBFS가 되도록 전체 음량만 맞춘 뒤 128kbps MP3로 저장했다.
긴 음원은 표의 길이에서 끊고 끝을 0.25초 이내로 줄여 닫았다. 음색을 바꾸는 처리는 하지 않았다.

`타격점`은 소리가 가장 커지는 순간까지 걸리는 시간이다. 주문 계열 음원은 앞에 시전음이 붙어 있어서,
장면이 `S.hit(이름, 시각)`으로 틀면 엔진이 이만큼 앞당겨 재생해 타격점이 화면의 타격 순간에 떨어지게 한다
(`combat-fx-scenes.js`의 `F.soundHits`).

## 파일

| 파일 | 제작자 | 원본 파일 | 길이 | 타격점 |
| --- | --- | --- | --- | --- |
| fire_a.mp3 | Lentikula | Fire Spell Impact 4.wav | 1.70초 | 0.18초 |
| fire_b.mp3 | Lentikula | Fire Spell Impact 5.wav | 1.80초 | 0.37초 |
| fire_big.mp3 | Lentikula | Fire Spell Impact 1.wav | 2.40초 | 0.47초 |
| fire_long.mp3 | Lentikula | Fire Spell Impact 3.wav | 1.88초 | 0.51초 |
| ice_a.mp3 | Lentikula | Ice Spell Impact 5.wav | 1.70초 | 0.14초 |
| ice_b.mp3 | Lentikula | Ice Spell Impact 3.wav | 1.80초 | 0.47초 |
| ice_big.mp3 | Lentikula | Ice Spell Impact 2.wav | 2.20초 | 0.53초 |
| water_a.mp3 | Lentikula | Water Spell Impact 4.wav | 1.76초 | 0.36초 |
| water_b.mp3 | Lentikula | Water Spell Impact 1.wav | 2.00초 | 0.5초 |
| bolt_a.mp3 | Lentikula | Lightning Spell Impact 1.wav | 2.20초 | 0.46초 |
| earth_a.mp3 | Lentikula | Earth Spell Impact 4.wav | 1.80초 | 0.16초 |
| earth_b.mp3 | Lentikula | Earth Spell Impact 2.wav | 1.78초 | 0.37초 |
| wind_a.mp3 | Lentikula | Wind Spell Impact 5.wav | 2.00초 | 0.2초 |
| wind_b.mp3 | Lentikula | Wind Spell Impact 3.wav | 2.00초 | 0.33초 |
| plant_a.mp3 | Lentikula | Plant Spell Impact 1.wav | 1.80초 | 0.19초 |
| plant_b.mp3 | Lentikula | Plant Spell Impact 3.wav | 2.00초 | 0.39초 |
| heal_a.mp3 | Lentikula | Healing Spell Impact 1.wav | 2.20초 | 0.44초 |
| heal_b.mp3 | Lentikula | Healing Spell Impact 7.wav | 2.20초 | 0.37초 |
| holy_a.mp3 | Lentikula | Healing Spell Impact 15.wav | 1.90초 | 0.27초 |
| holy_b.mp3 | Lentikula | Healing Spell Impact 9.wav | 1.80초 | 0.28초 |
| holy_c.mp3 | Lentikula | Healing Spell Impact 4.wav | 1.90초 | 0.34초 |
| holy_big.mp3 | Lentikula | Healing Spell Impact 3.wav | 2.17초 | 0.43초 |
| shimmer.mp3 | Lentikula | Healing Spell Impact 10.wav | 1.80초 | 0.19초 |
| laser_a.mp3 | Lentikula | Laser Pistol 1.wav | 1.20초 | 0.08초 |
| laser_rifle.mp3 | Lentikula | Laser Rifle 2.wav | 1.80초 | 0.25초 |
| punch_a.mp3 | Kenney | impactPunch_heavy_000.ogg | 0.65초 | - |
| punch_b.mp3 | Kenney | impactPunch_heavy_002.ogg | 0.46초 | - |
| punch_c.mp3 | Kenney | impactPunch_heavy_004.ogg | 0.54초 | - |
| punch_m.mp3 | Kenney | impactPunch_medium_000.ogg | 0.43초 | - |
| metal_a.mp3 | Kenney | impactMetal_heavy_001.ogg | 0.36초 | - |
| metal_b.mp3 | Kenney | impactPlate_heavy_000.ogg | 0.49초 | - |
| metal_ring.mp3 | Kenney | impactMetal_light_003.ogg | 0.48초 | - |
| glass_a.mp3 | Kenney | impactGlass_medium_000.ogg | 0.54초 | - |
| glass_big.mp3 | rubberduck | bfh1_glass_breaking_06.ogg | 0.92초 | - |
| glass_b.mp3 | rubberduck | bfh1_glass_breaking_01.ogg | 0.75초 | - |
| plank.mp3 | Kenney | impactPlank_medium_000.ogg | 0.78초 | - |
| stone.mp3 | Kenney | impactMining_000.ogg | 0.94초 | - |
| rock_break.mp3 | rubberduck | bfh1_rock_breaking_01.ogg | 1.14초 | - |
| bell_a.mp3 | Kenney | impactBell_heavy_001.ogg | 1.74초 | - |
| bell_b.mp3 | Kenney | impactBell_heavy_000.ogg | 1.48초 | - |
| gong.mp3 | rubberduck | gong_01.ogg | 1.42초 | - |
| boom_a.mp3 | Kenney | explosionCrunch_001.ogg | 1.36초 | - |
| boom_b.mp3 | Kenney | explosionCrunch_003.ogg | 1.55초 | - |
| boom_low.mp3 | Kenney | lowFrequency_explosion_000.ogg | 2.00초 | 0.22초 |
| cannon.mp3 | rubberduck | cannon_01.ogg | 1.22초 | 0.08초 |
| firework.mp3 | rubberduck | fw_03.ogg | 1.31초 | - |
| gunshot.mp3 | rubberduck | shot_01.ogg | 0.46초 | - |
| swish_a.mp3 | artisticdude | swish-7.wav | 0.17초 | - |
| swish_b.mp3 | artisticdude | swish-9.wav | 0.17초 | - |
| swish_c.mp3 | artisticdude | swish-3.wav | 0.12초 | - |
| swish_s.mp3 | artisticdude | swish-12.wav | 0.07초 | - |
| air_whoosh.mp3 | rubberduck | sfx100v2_air_02.ogg | 1.10초 | - |
| air_puff.mp3 | rubberduck | sfx100v2_air_03.ogg | 0.28초 | - |
| air_long.mp3 | rubberduck | sfx100v2_air_01.ogg | 2.00초 | - |
| rocket.mp3 | rubberduck | rocket_01.ogg | 1.60초 | 0.41초 |
| slash_a.mp3 | Kenney | knifeSlice2.ogg | 0.56초 | - |
| slash_b.mp3 | Kenney | drawKnife3.ogg | 0.40초 | - |
| slash_c.mp3 | rubberduck | blade_02.ogg | 0.31초 | - |
| slash_d.mp3 | rubberduck | blade_03.ogg | 0.39초 | - |
| chain_a.mp3 | rubberduck | chain_01.ogg | 0.49초 | 0.08초 |
| chain_b.mp3 | rubberduck | chain_03.ogg | 0.91초 | - |
| coins_a.mp3 | Kenney | handleCoins.ogg | 0.80초 | 0.1초 |
| coins_b.mp3 | rubberduck | item_coins_02.ogg | 0.61초 | - |
| coins_big.mp3 | rubberduck | item_coins_04.ogg | 1.56초 | - |
| gem.mp3 | rubberduck | item_gem_01.ogg | 0.25초 | - |
| gem_b.mp3 | rubberduck | item_gem_03.ogg | 0.28초 | - |
| card_a.mp3 | Kenney | card-slide-1.ogg | 0.49초 | - |
| card_fan.mp3 | Kenney | card-fan-1.ogg | 0.72초 | 0.47초 |
| card_snap.mp3 | Kenney | card-place-1.ogg | 0.60초 | - |
| dice.mp3 | Kenney | dice-throw-1.ogg | 0.60초 | - |
| chip.mp3 | Kenney | chips-collide-1.ogg | 0.18초 | - |
| field.mp3 | Kenney | forceField_000.ogg | 0.95초 | 0.09초 |
| servo.mp3 | Kenney | doorOpen_000.ogg | 0.53초 | - |
| zap_big.mp3 | Kenney | laserLarge_001.ogg | 0.72초 | - |
| teleport.mp3 | rubberduck | teleport_01.ogg | 0.40초 | 0.13초 |
| warp.mp3 | rubberduck | teleport_02.ogg | 1.62초 | 0.83초 |
| beep.mp3 | rubberduck | beep_01.ogg | 0.31초 | - |
| splash_big.mp3 | rubberduck | splash_01.ogg | 1.35초 | 0.14초 |
| splash.mp3 | rubberduck | splash_03.ogg | 0.74초 | - |
| bubble.mp3 | rubberduck | bubble_01.ogg | 0.70초 | 0.09초 |
| squish.mp3 | rubberduck | slime_04.ogg | 0.46초 | - |
| thunder.mp3 | rubberduck | sfx100v2_thunder_01.ogg | 2.40초 | 0.84초 |
| tick.mp3 | Kenney | metalLatch.ogg | 0.25초 | - |
| lock.mp3 | rubberduck | lock_01.ogg | 0.39초 | - |
| cast_a.mp3 | rubberduck | spell_02.ogg | 0.53초 | - |
| cast_b.mp3 | rubberduck | spell_01.ogg | 0.63초 | - |
| growl.mp3 | rubberduck | creature_monster_03.ogg | 0.88초 | 0.24초 |

## 사용자 제공 음원

| 파일 | 원본 | 가공 | 길이 | 타격점 |
| --- | --- | --- | --- | --- |
| execution_clap.mp3 | 사용자가 준 `처형박수.m4a`(1.21초, 2026-11-11) | 0.513초부터 끝까지 사용. 앞 6ms와 끝 90ms를 줄여 닫고 최대 음량을 -1.5dBFS로 맞춤. 음색은 바꾸지 않음 | 0.69초 | 0.47초 |

처형박수 스킬 전용이다. 원본은 저음이 0.9초쯤 이어진 뒤 박수가 한 번 울린다. 저음의 뒷부분 0.46초와 그 박수만 남겨, 박수가 장면의 타격(0.5초)에 오게 했다.
이 음원은 CC0 배포본이 아니다. 사용 권리는 제공자가 확인한다.
