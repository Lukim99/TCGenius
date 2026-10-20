# 낙원 연출 에셋

2026-10-20. 전투는 `public/hfield.js`의 필드 WebGL 렌더러, 스킬 이펙트, 피해 숫자와 HUD를 공유한다. 낙원 화면은 탐험 전이와 증강 선택을 담당한다. 권장 전투력은 수치로 표시하지 않고 이동할 층의 권장 전투력이 현재 전투력의 1.5배 이상일 때 선택지에 붉은 `위험!`만 표시한다.

## 심판자

`public/assets/paradise/judge-boss.webp`: 내장 imagegen으로 기존 `judge.webp`의 검은 갑옷 심판자를 전투용 투명 전신으로 분리했다. 이벤트 배경은 보존했다. 원본 PNG를 높이 1100px, WebP 품질 90으로 변환했으며 알파를 유지했다.

최종 프롬프트:

```text
Use case: background-extraction. Asset type: transparent full-body fantasy RPG boss combat sprite. Edit the attached Corridor Judge artwork: extract the ONE central black-armored judge with his tall spiked crown helmet, red eye slits, engraved black and antique gold armor, ragged black cloak and ornate grounded greatsword. Preserve his identity, material detail and imposing front three-quarter stance. Reconstruct the missing feet and sword tip naturally so his complete body is visible. Remove the entire cathedral, columns, floor, fog, background and unrelated objects. Center the full character on a genuinely transparent canvas with roughly 8% empty margin all around. Crisp readable silhouette, both feet aligned to bottom, no glow cloud, no pedestal, no text or border. Detailed painterly fantasy game art matching the input.
```

## Suno 배경음

사용자의 Suno 계정에서 v6-mini, 가사 없는 기악곡으로 각각 한 번 생성했다. 두 후보 중 각 첫 번째 곡을 MP3로 다운로드했다. 공개 게시나 구독 변경은 하지 않았다. 아래 파일을 게임에서 반복 재생한다.

| 파일 | 곡 | 길이 |
| --- | --- | --- |
| `public/assets/paradise/audio/heaven.mp3` | [천상의 회랑 — 끝없는 계단](https://suno.com/song/795cb414-c7f0-4d99-afc3-2a87cfa40369) | 3:19 |
| `public/assets/paradise/audio/hell.mp3` | [지옥 — 붉은 심연](https://suno.com/song/db586fab-bbb6-463c-a8cd-d421d14f78e4) | 3:25 |

천상 Styles 프롬프트:

```text
Instrumental dark celestial fantasy roguelike game soundtrack, endless tower of ivory and ancient gold suspended in clouds. Luminous celesta and harp motif, restless chamber strings, low warm organ, restrained brass, deep frame drums, subtle glass harmonics. 112 BPM in D minor with moments of Lydian wonder. Elegant mystery and tactical battle tension, memorable evolving four-note theme, 8-bar phrases, quiet breath between escalating passages. Clear spacious mix leaving room for combat effects, no vocals, no spoken words, no pop song structure, no explosive trailer drops. 3-minute extended instrumental with a short opening and a loop-friendly return to the opening ostinato.
```

지옥 Styles 프롬프트:

```text
Instrumental infernal dungeon descent battle soundtrack. Basalt citadel above lava, perilous leaps through a hundred subterranean floors. Heavy low string ostinato, hammered dulcimer, ominous pipe organ, growling bowed bass, metallic percussion and deep tribal toms, restrained distorted guitar. 128 BPM in E minor, tight driving rhythm, descending four-note motif with dramatic suspended chords. Menacing and propulsive, memorable game melody, alternating tense quiet passages and controlled combat intensity. Clean detailed mix with space for attack sounds, no vocals or speech, no pop chorus, no trailer impacts. Three minutes, brief intro, end returning to the opening rhythmic vamp for looping.
```

`public/paradise-audio.js`는 같은 곡의 재생 위치를 유지하며, 다른 곡은 재생 성공 후 1.5초 동안 교차한다. 음소거, 탭 숨김, 탐험 종료와 페이지 이탈 시 재생 및 진행 중인 요청을 정리한다.

전투 글꼴은 기존 필드와 같은 Pretendard와 Black Han Sans를 사용한다. 서버 시각 보정은 새 응답을 받을 때만 적용해 남은 쿨타임이 매 프레임 흐르도록 한다. 천상의 회랑은 입장 시에만 HP·MP를 최대치로 채운다.

## 외부 효과음

탐험 조작의 브라우저 오실레이터 합성음을 제거했다. 전투 타격·스킬·치명타·승패 음원과 음량은 기존 필드의 `SOUNDS` 매핑을 그대로 사용하고, 낙원 음소거와 탭 숨김 상태를 따른다. 아래 CC0 외부 음원의 기존 변환본을 낙원용 경로로 복사했다. 원본과 기존 레이드 매핑은 [레이드 에셋](raid-assets.md)에 기록돼 있다. 출처와 라이선스를 다시 확인했다: [rubberduck — 80 CC0 RPG SFX](https://opengameart.org/node/86018), [Lentikula — Basic Spell Impacts](https://lentikula.itch.io/freecc0-basic-spell-impacts-sfx), [Druid Spell Impacts](https://lentikula.itch.io/druid-spell-impacts), [Healing Spell Impacts](https://lentikula.itch.io/healing-spell-impacts).

| 낙원 파일 (`public/assets/paradise/audio/`) | 기존 변환본 (`ui/sfx/raid/`) | 용도 |
| --- | --- | --- |
| `hover.mp3` | `mirror-glint-v2.mp3`, 첫 0.12초, 끝 0.065초 페이드 | 증강 호버·버튼 |
| `reveal.mp3` | `dealing-aura-v2.mp3` | 증강 등장·제단 |
| `select.mp3` | `bronze-set-v2.mp3` | 증강 확정 |
| `descent.mp3` | `wall-pressure-v2.mp3` | 지옥 낙하 |
| `land.mp3` | `ground-land-v2.mp3` | 착지 |
| `chest.mp3` | `mirror-glint-v2.mp3` | 상자 개봉 |

증강 호버는 Claude CLI의 `claude-opus-5-5`에 한 번 디자인 검토를 맡겼다($0.10, 예산 상한 $1). 기울임을 제거하고, 원래 카드 슬롯을 클릭 영역으로 유지하며, 최대 4px 들림·1.025배 확대·6% 밝기 변화와 얇은 등급색 테두리로 반응한다. DOM 버튼과 키보드 포커스는 프레임마다 교체하지 않는다. 동작 줄이기에서는 이동과 확대를 생략한다.

## 검증

격리 DB/S3 대역을 사용하는 기존 테스트 51개 통과: `node --test tests/paradise.test.js tests/paradise_audio.test.js tests/combat_effect_assets.test.js tests/pvp_engine.test.js tests/pvp_web.test.js tests/wisdom_puzzle.test.js`. 운영 DB에 쓰지 않았다.

Chrome에서 HP 1·MP 0 입장 후 최대치 회복, 스킬 쿨타임의 0.1초 단위 갱신, 기존 필드 음원 요청, 심판자 전투·승리 후 증강 전환, 데스크톱·390px 모바일 배치, 호버 전후 동일 버튼 및 클릭 영역, 기존 필드 입장·공격·패배 표시를 확인했다. 브라우저 앱 오류는 없었다.

별도로 확인한 기존 소스 문자열 검사 `hfield_web.test.js`, `general_field_parity.test.js`는 변경 전 HEAD에서도 실패한다. `hfield_flow.test.js`는 `.env.local` 및 실제 DB 초기화에 의존해 격리 검증에서 제외했다.
