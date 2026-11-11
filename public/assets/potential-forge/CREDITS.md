# 잠재능력 각인 효과음

게임에 배포하는 아래 MP3는 외부 제작자가 CC0로 공개한 음원을 편집한 파일이다. 효과음은 브라우저에서 실제 오디오 샘플을 재생하며 오실레이터로 합성하지 않는다.

| 배포 파일 | 원본과 제작자 | 편집 |
| --- | --- | --- |
| `select.mp3` | Kenney의 [RPG Audio](https://kenney.nl/assets/rpg-audio), `metalClick.ogg` | 0.2초 길이와 페이드 |
| `impact.mp3` | Kenney의 [Impact Sounds](https://kenney.nl/assets/impact-sounds), `impactMining_000.ogg` | 프로젝트에 보관된 `point-mine/mine-hit.wav`를 사용, 낮은 피치와 저음 강조, 잔향 |
| `charge.mp3` | JaggedStone의 [Magic Spell SFX](https://opengameart.org/content/magic-spell-sfx), `magical_4.ogg` | 역재생, 1.05초 길이와 페이드 |
| `resonance.mp3` | 같은 팩의 `magical_1_0.ogg` | 짧은 잔향과 페이드 |
| `bloom.mp3` | 같은 팩의 `magical_7_0.ogg` | 페이드 |
| `victory.mp3` | ARoachIFoundOnMyPillow의 [Victory Fanfare](https://opengameart.org/content/victory-fanfare), `fanfare1.mp3` | 최대 6.8초 길이와 페이드 |

라이선스: [Creative Commons Zero 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/). 원본 공개 페이지의 라이선스를 2026-10-30에 확인했다. Kenney 원문 라이선스는 함께 보관한 `LICENSE-rpg.txt`, `LICENSE-impact.txt`에 있다. Magic Spell SFX 페이지는 별도 표기가 필요 없음을 밝히고 있으며, Victory Fanfare 페이지도 CC0로 공개되어 있다.

각 파일은 최대 음량을 약 -4 dBFS로 맞추고 MP3로 인코딩했다. 선택은 짧은 금속음, 각인 시작은 상승하는 공명음, 줄 공개는 타격과 등급별 공명으로 구분한다. 목표 달성과 승급에서는 낮은 타격음에 오르간 팡파르를 겹쳐 재생한다. 반복 각인의 타격음은 작게 재생하며 동시 음원 수와 전체 출력을 제한한다. 효과음 설정은 브라우저에 저장하고 창 닫기, 음소거, 페이지 숨김 시 재생을 정지한다.
