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

## 천상 증강 음원 (2026-11-18)

천상 증강 연출(`public/combat-fx-augments.js`)에 쓰려고 더한 음원이다(성가대 소리 `choir.mp3`는 2026-11-19에 뺐다. 악기나 노래 같은 소리는 쓰지 않는다). 모두 Freesound에 원작자가 CC0 1.0으로 올린 녹음이며, 받은 파일은 Freesound가 제공하는 고음질 미리듣기(MP3)다.
가공은 위와 같다: 쓸 구간만 잘라 앞뒤를 짧게 줄여 닫고, 최대 음량을 -1.5dBFS로 맞춰 128kbps MP3로 저장했다. 음색을 바꾸는 처리는 하지 않았다.
2026-11-19에 `choir`를 뺀 네 개(`horse_neigh`, `horse_gallop`, `sword_draw`, `tape_rewind`)는 디코드한 최대값이 0dBFS를 넘어서, 받은 원본에서 같은 구간을 다시 잘라 아래 개편과 같은 방법(인코딩 전 -3dBFS, 디코드 최대값 -1dBFS 이하)으로 다시 만들었다.

| 파일 | 제작자 | 원본 | 사용 구간 | 길이 | 타격점 | 쓰는 곳 |
| --- | --- | --- | --- | --- | --- | --- |
| horse_neigh.mp3 | craigsmith | [G38-15-Perfect Horse Whinny.wav](https://freesound.org/people/craigsmith/sounds/437110/) (CC0 1.0) | 11.5초부터 1.9초 | 1.90초 | - | 정복자 10중첩(기병 등장) |
| horse_gallop.mp3 | gbnelso | [HorseGallop1.wav](https://freesound.org/people/gbnelso/sounds/684446/) (CC0 1.0) | 0.15초부터 2.2초 | 2.20초 | - | 정복자의 기병 등장과 돌격 |
| sword_draw.mp3 | Vrymaa | [Sword - Unsheathe](https://freesound.org/people/Vrymaa/sounds/770035/) (CC0 1.0) | 0.18초부터 0.85초 | 0.85초 | - | 이기어검술 소환, 검무 |
| tape_rewind.mp3 | hydroxian | [Tape Spinback](https://freesound.org/people/hydroxian/sounds/753653/) (CC0 1.0) | 2.25초부터 1.2초 | 1.20초 | - | 되감기, 리플레이 |

## 천상 증강 음원 개편 (2026-11-19)

천상 증강 장면과 검무, 2마리 전투의 적 교체에서 가늘고 힘없게 들리던 층(`metal_ring`, `shimmer`, `bell_a`, `bell_b`, `gem`, `gem_b`, `glass_a`, `lock`, `chip`, `servo`, `field`, `laser_rifle`)과 무게가 모자라던 타격을 실제 녹음으로 바꿨다. 예전 파일은 다른 스킬 장면이 계속 쓰므로 지우지 않았다.
모두 Freesound에 원작자가 CC0 1.0으로 올린 소리이고(소리마다 쪽의 라이선스 표기를 확인했다), 받은 파일은 Freesound가 제공하는 고음질 미리듣기(MP3)다. 받은 날짜는 2026-11-19이다.
가공은 위와 같다: 쓸 구간만 잘라 앞뒤를 짧게 줄여 닫고, 인코딩 전에 최대 음량을 -3dBFS로 맞추고 128kbps MP3로 저장한 뒤, 디코드한 최대값이 -1dBFS를 넘지 않는지 확인했다(MP3 인코딩이 봉우리를 조금 키우기 때문이다). 음색을 바꾸는 처리는 하지 않았다. `bolt_impact`는 `crossbow`와 같은 녹음의 뒷부분(명중)이다.
고른 근거는 올린 사람의 설명과 태그, 평점과 내려받은 수, 그리고 파형과 주파수 분포(타격의 날카로움, 150Hz 아래의 무게, 길이)다.

| 파일 | 제작자 | 원본 | 사용 구간 | 길이 | 타격점 | 쓰는 곳 | 대신한 소리 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| blade_cut_a.mp3 | ethanchase7744 | [sword slash.wav](https://freesound.org/people/ethanchase7744/sounds/441666/) (CC0 1.0) | 0.02초부터 0.5초 | 0.50초 | - | 검무의 베기(1), 한 칸씩 오르는 검무, 결투의 치명타 | slash_a, slash_c |
| blade_cut_b.mp3 | Kreastricon62 | [Bloody Blade 2.wav](https://freesound.org/people/Kreastricon62/sounds/323526/) (CC0 1.0) | 0.06초부터 0.55초 | 0.55초 | - | 검무의 베기(2), 출혈 부여, 결투의 반격 | slash_b |
| blade_cut_c.mp3 | Wenpire | [Slash1.ogg](https://freesound.org/people/Wenpire/sounds/574821/) (CC0 1.0) | 0.02초부터 0.5초 | 0.50초 | - | 검무의 베기(3), 운명 스킬, 변속의 치명타 | slash_c, metal_ring |
| blade_finish.mp3 | nekoninja | [samurai slash](https://freesound.org/people/nekoninja/sounds/370204/) (CC0 1.0) | 0초부터 0.62초 | 0.62초 | - | 검무의 마지막 베기, 운명의 처형, 명계의 부름의 낫, 고통스러운 상처 | slash_d |
| blade_ring.mp3 | Aleks41 | [Sword from sheath.wav](https://freesound.org/people/Aleks41/sounds/449552/) (CC0 1.0) | 0초부터 1.2초 | 1.20초 | - | 칼 울림: 검무의 맺음, 결투 신청, 이기어검술 소환, 한 칸씩 오르는 검무 | metal_ring, shimmer, bell_a |
| blade_sheath.mp3 | Qat | [sheath_sword.wav](https://freesound.org/people/Qat/sounds/107590/) (CC0 1.0) | 0.02초부터 0.6초 | 0.60초 | 0.44초 | 검무의 맺음(칼을 거둠) | metal_ring |
| blade_clash.mp3 | CogFireStudios | [Hit Impact Sword 3](https://freesound.org/people/CogFireStudios/sounds/547042/) (CC0 1.0) | 0초부터 0.7초 | 0.70초 | - | 간파, 결투의 반격 | metal_ring, metal_b |
| armor_crack.mp3 | Q.K. | [Shatter.wav](https://freesound.org/people/Q.K./sounds/56262/) (CC0 1.0) | 0초부터 0.3초 | 0.30초 | - | 갑옷 깎아내기(중첩마다, 최대) | metal_ring, metal_a |
| metal_slam.mp3 | Sheyvan | [Impact: Metal 1](https://freesound.org/people/Sheyvan/sounds/475221/) (CC0 1.0) | 0초부터 0.5초 | 0.50초 | - | 갑옷 깎아내기 최대, 정복자의 기병 돌격, 운명 스킬의 맺음, 운명의 처형, 명계의 부름의 시작, 마지막 기회의 시작과 소진 | metal_a |
| punch_heavy.mp3 | janbezouska | [Major punch](https://freesound.org/people/janbezouska/sounds/399183/) (CC0 1.0) | 0.05초부터 0.42초 | 0.42초 | - | 원펀치 룰, 결실, 결투의 치명타 | punch_b, plant_a |
| punch_body.mp3 | thebondman | [indiana-jones-style-punch.wav](https://freesound.org/people/thebondman/sounds/111739/) (CC0 1.0) | 0.07초부터 0.5초 | 0.50초 | - | 원펀치 룰(무게)과 맞공격, 기병 돌격 | punch_c, punch_b, boom_low |
| glove_slap.mp3 | MootMcnoodles | [Slap.wav](https://freesound.org/people/MootMcnoodles/sounds/444407/) (CC0 1.0) | 0초부터 0.4초 | 0.40초 | - | 결투 신청 | metal_ring |
| land_thud.mp3 | stephenbist | [Luggage Drop 1.wav](https://freesound.org/people/stephenbist/sounds/434781/) (CC0 1.0) | 0.04초부터 0.56초 | 0.56초 | - | 다음 적의 등장(착지), 마지막 기회 소진(쓰러짐), 심장 소리의 몸통 | (새로 넣음) |
| thunder_crack.mp3 | Josh74000MC | [thunder3.ogg](https://freesound.org/people/Josh74000MC/sounds/475094/) (CC0 1.0) | 0.2초부터 1.8초 | 1.80초 | 0.12초 | 신성한 번개 | thunder |
| war_horn.mp3 | kirmm | [Battle_horn_1.wav](https://freesound.org/people/kirmm/sounds/392180/) (CC0 1.0) | 0.04초부터 2.2초 | 2.20초 | - | 정복자 10중첩 | holy_b |
| crossbow.mp3 | Ali_6868 | [Crossbow Firing and Hitting Target](https://freesound.org/people/Ali_6868/sounds/384919/) (CC0 1.0) | 0초부터 0.42초 | 0.42초 | - | 악마 사냥꾼(발사) | gunshot |
| bolt_impact.mp3 | Ali_6868 | [Crossbow Firing and Hitting Target](https://freesound.org/people/Ali_6868/sounds/384919/) (CC0 1.0) | 0.7초부터 0.4초 | 0.40초 | - | 악마 사냥꾼(명중) | (새로 넣음) |
| gear_shift.mp3 | E-Audio | [Column Gear Select Up (mono).wav](https://freesound.org/people/E-Audio/sounds/118243/) (CC0 1.0) | 0.26초부터 0.46초 | 0.46초 | 0.22초 | 변속 | lock |
| ratchet.mp3 | jhka | [Revolver Chamber Spin (Ratchet Sound)](https://freesound.org/people/jhka/sounds/139001/) (CC0 1.0) | 0.02초부터 0.7초 | 0.70초 | - | 변속(톱니가 도는 소리) | servo |
| splat.mp3 | nebulasnails | [Wet Splat 1.mp3](https://freesound.org/people/nebulasnails/sounds/495118/) (CC0 1.0) | 0.05초부터 0.44초 | 0.44초 | - | 결실(과즙) | plant_a, gem_b |
| flesh_rip.mp3 | magnuswaker | [Gut Rip (Bladed)](https://freesound.org/people/magnuswaker/sounds/522168/) (CC0 1.0) | 0초부터 0.7초 | 0.70초 | - | 고통스러운 상처 부여, 출혈 부여 | squish, slash_b |
| blood_squirt.mp3 | kyles | [blood squirt gob splash sponge.flac](https://freesound.org/people/kyles/sounds/453769/) (CC0 1.0) | 0.08초부터 0.5초 | 0.50초 | - | 출혈 발동, 상처 틱 | squish |
| stab.mp3 | minituffy | [Large Swede Stab with Whoosh.wav](https://freesound.org/people/minituffy/sounds/385966/) (CC0 1.0) | 0.18초부터 0.32초 | 0.32초 | - | 이기어검술의 찌르기, 가시 갑옷 | slash_d, chip |
| shield_block.mp3 | nekoninja | [shield guard](https://freesound.org/people/nekoninja/sounds/370203/) (CC0 1.0) | 0초부터 0.7초 | 0.70초 | - | 천사의 가호, 보호막 흡수, 간파로 막아 낸 공격 | metal_b, field |
| whoosh_heavy.mp3 | bolkmar | [FX - Swoosh - Low Pitch](https://freesound.org/people/bolkmar/sounds/475135/) (CC0 1.0) | 0.04초부터 0.76초 | 0.76초 | - | 명계의 부름의 낫 휘두름, 다음 적의 등장, 운명 스킬(모여드는 별)과 처형, 계절이 바뀔 때, 간파 | (새로 넣음) |
| soul_breath.mp3 | timgormly | [Spirit-Breath1.aif](https://freesound.org/people/timgormly/sounds/152721/) (CC0 1.0) | 0.3초부터 1.7초 | 1.70초 | - | 영혼 수확, 명계의 부름, 적의 소멸, 간파, 마지막 기회 소진 | warp |
| soul_hit.mp3 | ToastHatter | [Soul Hit](https://freesound.org/people/ToastHatter/sounds/561544/) (CC0 1.0) | 0초부터 0.5초 | 0.50초 | - | 영혼 수확(흡수), 간파한 살의가 보일 때 | heal_b |
| heartbeat.mp3 | PollyannaMedia | [heartbeat.wav](https://freesound.org/people/PollyannaMedia/sounds/541434/) (CC0 1.0) | 0.28초부터 0.5초 | 0.50초 | - | 죽음을 초월하는 자의 마지막 기회, 죽을 각오로 | (새로 넣음) |
| fire_whoosh.mp3 | wjl | [Short-Fireball-Woosh.flac](https://freesound.org/people/wjl/sounds/267887/) (CC0 1.0) | 0초부터 1초 | 1.00초 | 0.18초 | 꺼지지 않는 불꽃 점화, 죽을 각오로 | shimmer |
| flame_burst.mp3 | kyles | [flame burst ignite bbq barbecue.flac](https://freesound.org/people/kyles/sounds/637533/) (CC0 1.0) | 0초부터 0.62초 | 0.62초 | 0.12초 | 화상 틱, 여름 | fire_a, fire_b |
| bird_call.mp3 | nfrae | [Black Capped Chickadee bird call](https://freesound.org/people/nfrae/sounds/703254/) (CC0 1.0) | 0.04초부터 1.16초 | 1.16초 | - | 봄 | (새로 넣음) |
| cicada.mp3 | cartoonrob | [Cicadas in Japan.wav](https://freesound.org/people/cartoonrob/sounds/643877/) (CC0 1.0) | 0.6초부터 1.2초 | 1.20초 | - | 여름 | (새로 넣음) |
| leaf_rustle.mp3 | j1987 | [leafpilehit.wav](https://freesound.org/people/j1987/sounds/106130/) (CC0 1.0) | 0.08초부터 0.92초 | 0.92초 | - | 가을, 백화요란 | (새로 넣음) |
| ice_crack.mp3 | wwstudioswastaken | [ice_cracking_01.flac](https://freesound.org/people/wwstudioswastaken/sounds/624163/) (CC0 1.0) | 0초부터 0.64초 | 0.64초 | - | 겨울 | ice_a |
| wing_flap.mp3 | _stubb | [Wing Flap 1.wav](https://freesound.org/people/_stubb/sounds/389634/) (CC0 1.0) | 0.08초부터 0.48초 | 0.48초 | - | 천사 강림, 천사의 공격과 가호, 검무의 맺음(흩날리는 비단), 부활, 간파 | laser_rifle, field |
| bone_crack.mp3 | clif_creates | [Hard Candy / Bone Crunch](https://freesound.org/people/clif_creates/sounds/392883/) (CC0 1.0) | 0초부터 0.45초 | 0.45초 | - | 취약(지속 피해 치명타) | glass_a |
| branch_snap.mp3 | deleted_user_2104797 | [Crack of branch 3.wav](https://freesound.org/people/deleted_user_2104797/sounds/164472/) (CC0 1.0) | 0.1초부터 0.52초 | 0.52초 | - | 가시 갑옷 | chip |
| reverse_swell.mp3 | loganzsound | [Reverse Cymbal Shiny](https://freesound.org/people/loganzsound/sounds/774635/) (CC0 1.0) | 1.5초부터 1.4초 | 1.40초 | 1.36초 | 보호막 흡수, 되감기, 부활, 천사 강림 | field, warp |
| stamp.mp3 | I.fekry | [traditional stamp.wav](https://freesound.org/people/I.fekry/sounds/470710/) (CC0 1.0) | 0.48초부터 0.56초 | 0.56초 | - | 선택의 시간(표식) | lock |

## 사용자 제공 음원

| 파일 | 원본 | 가공 | 길이 | 타격점 |
| --- | --- | --- | --- | --- |
| execution_clap.mp3 | 사용자가 준 `처형박수.m4a`(1.21초, 2026-11-11) | 0.513초부터 끝까지 사용. 앞 6ms와 끝 90ms를 줄여 닫고 최대 음량을 -1.5dBFS로 맞춤. 음색은 바꾸지 않음 | 0.69초 | 0.47초 |

처형박수 스킬 전용이다. 원본은 저음이 0.9초쯤 이어진 뒤 박수가 한 번 울린다. 저음의 뒷부분 0.46초와 그 박수만 남겨, 박수가 장면의 타격(0.5초)에 오게 했다.
이 음원은 CC0 배포본이 아니다. 사용 권리는 제공자가 확인한다.
