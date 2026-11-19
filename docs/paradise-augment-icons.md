# 천상 증강 문장 아이콘

2026-11-18. 천상 증강 30종이 등급 없이 프리즘 한 가지로 표시되도록 바뀌면서, 증강 선택 카드(`public/paradise.js`의 `paintCard`) 상단 원형 메달 안에 들어갈 문장 35개를 새로 만들었다. 증강 30개와 전투 후 성장 선택지·보상용 5개다.

## 규격

- 위치: `public/assets/paradise/augments/<id>.webp`. `paradise_augments_prism.js`의 `iconUrl`(`/static/assets/paradise/augments/<id>.webp`)과 이름이 같다.
- 320×320 투명 WebP. 그림을 알파 기준으로 잘라 긴 변이 288px(사방 여백 5%)가 되도록 중앙에 놓았다.
- 글자, 숫자, 테두리, 받침, 배경, 그림자가 없다. 어두운 남색 메달(`#0d131a`) 위에서 64px로 줄여 식별되는지 확인했다.
- 가장 큰 파일은 `hundredFlowers.webp` 57 KB, 나머지는 55 KB 이하다.

## 그림 방향

한 가족으로 보이도록 재질을 통일했다. 면이 깎인 무지갯빛 수정 유리, 얇은 막의 간섭색, 가장자리 분광, 안쪽에서 비치는 빛이다. 대신 증강마다 주조색과 윤곽을 다르게 주어 서로 헷갈리지 않게 했다. 무지개 분산은 가장자리와 하이라이트에만 쓴다.

## 파일 목록

| 파일 | 크기 | 문장 |
| --- | --- | --- |
| `fruition.webp` | 38.5 KB | 결실 — 세 알로 갈라진 수정 석류, 세 번째 씨앗만 별빛으로 터진다 |
| `deathWish.webp` | 36.8 KB | 죽을 각오로 — 부서지기 직전의 수정 심장을 붙드는 백열 불꽃 |
| `conqueror.webp` | 41.5 KB | 정복자 — 깃 장식 마갑을 쓴 군마 옆얼굴과 기병창 깃발 |
| `fatalDestiny.webp` | 33.5 KB | 치명적인 운명 — 구슬 일곱 알이 꿰인 실을 자르려는 운명의 가위 |
| `holyLightning.webp` | 26.0 KB | 신성한 번개 — 후광 고리를 가르며 내리꽂히는 수정 번개 |
| `dotCritical.webp` | 30.0 KB | 취약 — 금이 간 독 방울 한가운데를 뚫은 치명타 별 |
| `eternalFlame.webp` | 31.6 KB | 꺼지지 않는 불꽃 — 밑동이 무한대 고리로 꼬인 수정 불꽃 |
| `haste.webp` | 28.7 KB | 가속 — 앞으로 기운 날개 달린 장화와 속도 파편 |
| `replay.webp` | 41.4 KB | 리플레이 — 제 꼬리를 무는 원형 화살표 안의 삼각 보석과 잔상 |
| `timeOfChoice.webp` | 25.8 KB | 선택의 시간 — 반은 터지는 루비 칼날, 반은 에메랄드 잎인 마름모 표식 |
| `flyingSword.webp` | 45.2 KB | 이기어검술 — 궤도 고리에 묶여 떠 있는 세 자루 검 |
| `duelChallenge.webp` | 41.6 KB | 결투 신청 — 내던진 건틀릿과 그 위를 가로지른 레이피어 |
| `onePunch.webp` | 53.1 KB | 원펀치 룰 — 정면으로 날아오는 주먹 하나와 충격 고리 |
| `seasons.webp` | 53.0 KB | 주문의 계절 — 벚꽃·태양·단풍·눈꽃이 맞물려 도는 사계 바람개비 |
| `manualShift.webp` | 29.9 KB | 운명의 수동변속 — 톱니바퀴에서 솟은 별 보석 변속 레버와 충전 보석 셋 |
| `deepeningBleed.webp` | 32.3 KB | 움직일수록 깊게 — 톱니 갈고리 초승달과 점점 커지는 핏방울 다섯 |
| `soulReaper.webp` | 37.7 KB | 영혼 수확자 — 낫의 품에 안긴 영혼 불꽃 셋 |
| `readIntent.webp` | 30.6 KB | 읽어 낸 살의 — 동공이 다가오는 단검 끝인 눈 |
| `timeRewind.webp` | 39.0 KB | 되감기 — 반시계 화살표가 감싼 회중시계, 제자리로 돌아오는 파편 |
| `demonHunter.webp` | 33.7 KB | 악마 사냥꾼 — 뿔 달린 악마 가면을 꿰뚫은 은빛 쇠뇌 화살 |
| `angelDescent.webp` | 43.9 KB | 천사강림 — 후광을 쓰고 검을 내려 든 채 강림하는 두건 천사 |
| `transcendDeath.webp` | 34.0 KB | 죽음을 초월하는 자 — 갈라진 해골에서 솟는 불사조 날개와 빛의 관 |
| `dualIdentity.webp` | 36.3 KB | 두 가지 정체성 — 해와 달, 두 얼굴이 붙은 가면 |
| `comboStaircase.webp` | 32.3 KB | 한 칸씩 오르는 검무 — 계단마다 검이 하나, 둘, 셋으로 늘어난다 |
| `painfulWound.webp` | 27.4 KB | 고통스러운 상처 — 끊어진 봉합사와 칼날 조각이 박힌 벌어진 상처 |
| `shieldSiphon.webp` | 39.3 KB | 보호막 흡수 — 아래쪽이 소용돌이로 빨려 나가는 유리 방패 |
| `armorShred.webp` | 36.1 KB | 갑옷 깎아내기 — 세 줄로 깎여 조각이 벗겨지는 흉갑 |
| `thornArmor.webp` | 36.2 KB | 가시 갑옷 — 장미 가시가 돋은 에메랄드 흉갑 |
| `hundredFlowers.webp` | 56.1 KB | 백화요란 — 한 점에서 한꺼번에 터지는 여섯 가지 꽃 |
| `swordDance.webp` | 43.6 KB | 검무 — 8자 리본을 휘감은 곡도와 잔상 |
| `boon-stat.webp` | 30.7 KB | 스탯 증가 — 보석에서 자라나는 세 겹 상승 쐐기 |
| `boon-heal.webp` | 31.4 KB | 체력 회복 — 붉은 HP와 푸른 MP가 반씩 담긴 하트 플라스크 |
| `boon-reward.webp` | 39.9 KB | 보상 획득 — 뚜껑이 열려 보석이 솟는 수정 상자 |
| `reward-bonus.webp` | 29.8 KB | 종료 보상 증가 — 주화 더미 위 프리즘 보석과 상승 화살표 |
| `reward-card.webp` | 30.6 KB | 캐릭터 카드 계약 — 실루엣과 별 문장, 봉랍 리본이 달린 유리 카드 |

## 제작 방법

codex CLI 0.158의 내장 이미지 생성으로 1024×1024 투명 PNG를 만들었다. 손으로 덧칠하거나 배경을 지운 것은 없다. 문장마다 빈 작업 폴더에서 아래처럼 실행했고 여섯 개씩 병렬로 돌렸다.

```bash
codex exec --skip-git-repo-check -s workspace-write -C <작업 폴더> - < p.txt
```

`p.txt`는 아래 지시문 뒤에 이미지 프롬프트를 붙인 것이다.

```text
Use your built-in image generation tool (not code, not SVG, not Python drawing) to generate exactly one image, then save the resulting PNG into the current directory as out.png. It must be a square 1024x1024 PNG with a genuinely transparent alpha background (if the generated image has an opaque background, regenerate with a transparent background rather than hand-editing). Do not create any other files. Image prompt: <이미지 프롬프트>
```

WebP 변환은 Python Pillow 12.3으로 했다. 알파 10 초과 영역으로 자르고, 알파를 곱한 색 공간(`RGBa`)에서 Lanczos로 줄여 투명 가장자리에 어두운 테가 생기지 않게 했다. 품질 92에서 시작해 60 KB 이하가 될 때까지 낮췄고(`hundredFlowers`만 88, 나머지는 92), 저장한 파일을 다시 열어 알파 범위가 0~255인지 확인했다.

## 최종 프롬프트

모든 문장이 같은 틀을 쓰고 `{tint}`와 `{motif}`만 바꾼다.

```text
Game UI emblem icon, one single isolated object on a genuinely transparent background. Prismatic emblem art family: faceted iridescent crystal-glass with thin-film rainbow sheen, spectral edge light, soft inner glow, crisp clean bold silhouette, precise detailed high-end fantasy game icon rendering, original design. Dominant tint: {tint}, with rainbow dispersion mainly on edges and highlights. Motif: {motif} Centered, the motif fills about 82 percent of the canvas with a small even margin, nothing cropped, instantly readable when shrunk to 64 pixels on a very dark navy disc. No text, letters, numerals, runes, frame, border, medallion, pedestal, background, floor, scenery, smoke or glow cloud, no drop shadow.
```

| id | tint | motif |
| --- | --- | --- |
| `fruition` | magenta, violet and gold | a luminous crystal pomegranate-like fruit split open into exactly three glowing facet seeds, the third seed blazing brightest with a sharp four-point star flare, a small glass leaf on its stem. |
| `deathWish` | deep crimson and white-hot | a cracked crystal heart on the verge of shattering, shards drifting off one side, held together by a defiant blazing white-red flame core burning through the cracks. |
| `conqueror` | royal gold and amber | an armored war-horse head in proud profile wearing a plumed crystal chamfron, a cavalry lance with a small swallow-tail pennant crossing diagonally behind it. |
| `fatalDestiny` | deep violet and cold silver | a pair of ornate open crystal shears of fate about to cut a single taut glowing thread strung with seven small bright beads. |
| `holyLightning` | radiant yellow-white and pale gold | a sharp jagged lightning bolt of solid crystal striking downward through a thin tilted halo ring, splitting the ring where it passes. |
| `dotCritical` | acid green and toxic lime | a heavy venom droplet of crystal with a deep fracture across it, a sharp four-point critical starburst shard punched through its center. |
| `eternalFlame` | ember orange and molten gold | an everlasting flame sculpted from crystal whose base twists into a closed infinity loop, a tiny unburnt blue core at its heart. |
| `haste` | electric cyan and ice white | a sleek crystal winged boot leaning forward at speed, a swept-back feather wing at the ankle and three tapering speed shards trailing behind. |
| `replay` | teal and aqua | a thick glass ribbon arrow curling in a full circle back onto itself, its arrowhead overlapping its tail, enclosing a faceted triangular gem pointing right and a faint echo copy of that gem. |
| `timeOfChoice` | ruby red on the left, emerald green on the right | a diamond-shaped crystal mark seal split cleanly down the middle: the left half is a jagged bursting ruby blade shard, the right half is a smooth emerald leaf-shaped healing gem, a thin white seam of light between them. |
| `flyingSword` | azure blue and jade white | three slender elegant straight crystal swords hovering point-down in a loose fan, linked by a single thin circling orbit trail of light, no hand holding them. |
| `duelChallenge` | silver and rose | an armored crystal gauntlet glove thrown down at an angle, crossed by a single slim dueling rapier with a swept hilt, a small spark where they meet. |
| `onePunch` | fiery red-orange | one single clenched fist seen head-on punching toward the viewer, faceted crystal knuckles, one clean concentric impact shock ring bursting behind it. |
| `seasons` | four colors: blossom pink, sun gold, maple orange-red, frost blue | a four-blade pinwheel wheel of the seasons made of crystal: a cherry blossom, a blazing sun, a maple leaf and a snowflake, one in each quadrant, flowing clockwise into each other around a small bright hub. |
| `manualShift` | chrome violet and steel blue | a manual gear-shift lever with a large faceted star-gem knob, tilted mid-shift, its shaft rising from the hub of a thick toothed crystal cog; three small round glowing charge gems set in a row on the cog face. The cog face is plain smooth glass with absolutely no grooves, no shift-pattern lines, no engraved shapes or symbols. |
| `deepeningBleed` | dark crimson and garnet | a broad heavy crescent hook-blade of crystal with large serrated barbs along its inner edge, thick and chunky, and beneath it five blood-red faceted crystal droplets arranged in a short curved row, each one bigger than the last. Compact squarish composition, thick shapes, not thin. |
| `soulReaper` | spectral teal and ghost green | a long curved reaper scythe with a crescent crystal blade, three small wispy soul-flames with tiny hollow eyes cradled in the hollow of the blade arc. |
| `readIntent` | indigo and pale cyan | a single wide open crystal eye with sharp lashes, its pupil is the narrow gleaming tip of an incoming dagger seen head-on. |
| `timeRewind` | sapphire blue and silver | a round crystal pocket-watch dial without digits, its two hands swept backward leaving afterimages, wrapped by a bold counter-clockwise arrow ribbon, a few broken shards flying back into place on one edge. |
| `demonHunter` | moonlit silver with magenta accents | a heavy silver crystal crossbow bolt driven diagonally through a small horned demon mask, the mask cracking around the impact. |
| `angelDescent` | pure white and warm gold | a clearly readable humanoid angel of white crystal seen from the front, descending from above with robes trailing upward: a visible hooded faceless head with a bright halo ring above it, torso and arms, both hands lowering a slim sword point-down, and two broad feathered wings spread wide to the sides. Chunky bold proportions, wide compact silhouette rather than tall and thin. |
| `transcendDeath` | bone white and royal violet | a crystal skull cracked open across the crown, and out of the crack rises a blazing phoenix wing of light on one side, a small unbroken crown of light floating above. |
| `dualIdentity` | sun gold on the left half, moon violet on the right half | a single masquerade mask split vertically into two different faces fused together: left half serene and rounded with a sunray brow, right half sharp and angular with a crescent brow. |
| `comboStaircase` | teal rising to gold | a compact staircase of three chunky crystal steps climbing from lower left to upper right, a short broad sword standing upright on each step: one sword on the first step, two crossed swords on the second, three fanned swords on the third and highest step, the top glowing gold. Bold thick shapes, squarish composition. |
| `painfulWound` | crimson and hot magenta | a wide almond-shaped open wound gash of glowing crimson-magenta crystal, ragged thorny edges, held half shut by three thick snapped stitches, with a short broken blade shard lodged in its center. Compact chunky shape nearly as wide as tall, bold and thick, not a thin line. |
| `shieldSiphon` | aqua and pale turquoise | a round buckler shield of clear glass whose lower rim is dissolving into a spiral stream of shards that swirls into a small bright orb beside it. |
| `armorShred` | steel grey and amber sparks | a crystal breastplate cuirass with three deep diagonal shave marks, thin curled slivers and chips of armor peeling away from the cuts. |
| `thornArmor` | dark emerald and rose thorn tips | a sturdy rounded crystal shoulder-and-chest armor plate bristling with long sharp curved thorns like a rose stem, one thorn tip glinting. |
| `hundredFlowers` | blossom pink, peach and lilac | a bursting bouquet explosion of six different crystal flowers blooming outward from one point all at once, petals flying off in every direction. |
| `swordDance` | pearl white and scarlet ribbon | a single curved dancing saber wrapped by a long flowing silk ribbon that traces a figure-eight swirl around it, with several faint afterimage blade arcs fanning out. |
| `boon-stat` | emerald and gold | a faceted gem from which three stacked upward-pointing chevrons grow like a sprouting crystal, each larger and brighter than the one below. |
| `boon-heal` | rose red on the left half, azure blue on the right half | a heart-shaped crystal flask with a small stopper, filled half with rose-red and half with azure liquid light, a soft plus-shaped sparkle rising from it. |
| `boon-reward` | warm gold and jewel tones | a small ornate crystal treasure chest with its lid open, light and a few faceted gems spilling upward out of it. |
| `reward-bonus` | gold and prism white | a short stack of thick crystal coins crowned by a large faceted prism gem, with a bold upward arrow of light rising behind the stack. |
| `reward-card` | midnight blue and gold | an ornate tall collectible character card made of glass, standing slightly tilted, showing a blank heroic silhouette bust and a single large star crest, tied with a ribbon and a round wax seal at the bottom corner. |

## 다시 만든 것

첫 결과를 메달 색 위에 180px와 64px로 나란히 놓고 검토해 다섯 개를 프롬프트를 고쳐 다시 만들었다. 위 표는 고친 뒤의 프롬프트다.

- `angelDescent`: 첫 결과가 날개 달린 검처럼 보였다. 두건 쓴 머리, 후광, 몸통이 보이는 넓은 윤곽을 요구했다.
- `manualShift`: 변속 게이트 홈이 알파벳 H로 읽혔다. 톱니 면에 홈이나 문양을 넣지 않도록 했다.
- `deepeningBleed`, `painfulWound`: 가늘고 길어 64px에서 묻혔다. 정사각형에 가까운 두꺼운 구도로 바꿨다.
- `comboStaircase`: 가로로 누운 검 세 자루가 계단으로 읽히지 않았다. 실제 계단 위에 검이 1, 2, 3자루로 늘어나게 했다.

## 남은 약점

- `hundredFlowers`는 꽃이 많아 64px에서 세부가 뭉친다. 분홍 꽃다발이라는 인상은 남는다.
- `painfulWound`는 64px에서 상처보다 붉은 가시 덩어리로 보일 수 있다.
- `replay`는 빨리 감기 버튼과 닮아 뜻은 바로 읽히지만 독창성은 가장 낮다.
- `shieldSiphon`은 빨려 나가는 아래쪽 소용돌이가 어두워 메달 위에서 방패 본체만 눈에 띈다.


## 참고

`fruition`은 틀을 확정하기 전 첫 시험 생성분을 그대로 쓴다. 문장 묘사는 표와 같고, 주조색 지정이 없으며 채움 비율을 80%로 적은 것만 다르다.
