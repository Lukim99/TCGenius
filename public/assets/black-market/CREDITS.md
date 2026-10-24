# 암시장 에셋

## 이미지

`vault.webp`, `seal.webp`는 2026-10-24에 내장 ImageGen 도구로 생성했다. 웹 전송용으로 WebP로 인코딩했으며 봉인 아이콘은 384px로 축소했다. 생성 원본은 `output/black-market/`에 보관한다.

배경 프롬프트:

> Use case: stylized-concept. Asset type: production background illustration for a Korean RPG secret Black Market auction screen, landscape 1536x1024. A luxurious hidden underground auction chamber in a hand-painted premium 2.5D fantasy game style. Obsidian stone, aged dark brass ornamental pointed arches, deep indigo velvet, subtle amethyst crystals and warm gold lanterns at outer left and right edges, a mysterious hazy central vault entrance in the far distance. Composition intended behind four UI loot displays: broad quiet low-contrast dark center and lower middle with almost no objects; architectural detail mostly along the top border and far edges, two balanced arcades to suggest left card section and right item section. Rich painterly materials, nuanced color, soft volumetric shafts and fine dust, theatrical but understated, sophisticated game environment not photorealistic. The center must stay very dark navy so pale Korean interface labels remain readable. No characters, no visible items for sale, no text, no letters, no logos, no UI panels, no cards, no watermark. Full bleed, atmospheric environment only.

봉인 프롬프트 (투명 배경):

> Use case: stylized-concept. Asset type: transparent game UI ornament, for an underground auction RPG. A single exquisite circular dark bronze auction seal, a sealed envelope embossed in the middle with a small faceted glowing amethyst wax emblem, concentric fine engraved bronze filigree and a few teal iridescent accents. Premium hand-painted fantasy inventory object icon, crisp silhouette, readable when scaled down to 100px, weathered metal and deep violet wax, beautiful selective warm rim light, fully isolated on a genuinely transparent background. Centered with substantial transparent margin, mostly frontal with just enough bevel to feel three dimensional. No words, numbers, letters, watermark, no background scenery, no surrounding objects. Output 1024 square.

## 미사용 생성 시안

제타·시그마 변환석 아이콘 시안은 생성했으나, 사용자 요청에 따라 게임에서는 둘 다 기존 각성 캐릭터 변환석 이미지를 사용한다. 아래 프롬프트의 원본은 `output/black-market/zeta-original.png`, `sigma-original.png`에만 보관하며 서비스 에셋에는 포함하지 않는다.

제타 프롬프트:

> Use case: stylized-concept. Asset type: transparent inventory icon for a Korean fantasy RPG, Zeta awakening character transformation stone. One irregular, softly star-shaped faceted magical gemstone, luminous rainbow core dominated by turquoise and emerald with a small opalescent warm highlight, enclosed by a thin antique gold rim. Around its lower edge a small pair of flowing gold wings like awakening energy. Premium hand-painted 2.5D collectible item art, crisp and readable at 64 pixels, centered, full silhouette in frame with 15 percent transparent padding. Single isolated object on a genuinely transparent background. No rectangle, no white box, no letter, no text, no numbers, no watermark.

시그마 프롬프트:

> Use case: stylized-concept. Asset type: transparent inventory icon for a Korean fantasy RPG, Sigma awakening character transformation stone. One irregular, softly star-shaped faceted magical gemstone, luminous rainbow core dominated by royal amethyst and rose-magenta with a bright opalescent warm highlight, enclosed by an ornate antique gold rim. Around its lower edge a small pair of flowing gold wings like awakening energy, a tiny crown-shaped gold crest at its top. Premium hand-painted 2.5D collectible item art, crisp and readable at 64 pixels, centered, full silhouette in frame with 15 percent transparent padding. Single isolated object on a genuinely transparent background. No rectangle, no white box, no letter, no text, no numbers, no watermark.

## 외부 효과음

[Kenney — RPG Audio](https://kenney.nl/assets/rpg-audio), Kenney Vleugels. [Creative Commons Zero (CC0)](https://creativecommons.org/publicdomain/zero/1.0/). 기존 프로젝트에 보관된 원본 팩에서 복사했다. 원본 라이선스: `output/lukim-birthday/sfx/source/rpg/License.txt`.

| 파일 | 원본 |
|---|---|
| `coins.ogg` | `Audio/handleCoins.ogg` |
| `seal.ogg` | `Audio/metalLatch.ogg` |
| `cancel.ogg` | `Audio/bookClose.ogg` |
| `click.ogg` | `Audio/metalClick.ogg` |

게임 화면의 WebGL 셰이더와 CSS 효과는 코드로 구현한다.

## 기존 게임 에셋과 글꼴

골드·가넷은 기존 `DB/RPGenius/itemImage/화폐/` 이미지를 사용한다. 제타·시그마 각성 변환석은 기존 `사용/각성 캐릭터 변환석.png`를 공용으로 사용한다. 화면에서는 원본 파일을 바꾸지 않고 투명 여백에 맞춰 표시 크기만 조정한다.

Pretendard Variable은 프로젝트의 `public/fonts/pretendard/PretendardVariable.woff2`를 사용한다. Kil Hyung-jin 저작, SIL Open Font License 1.1. 라이선스는 같은 폴더의 `LICENSE`에 보관한다.

화면 시각 디자인 및 정리 작업에는 Claude CLI의 `claude-opus-5-5`를 사용했다. 게임 동작·WebGL·거래 연결과 브라우저 검증은 별도로 구현했다.
