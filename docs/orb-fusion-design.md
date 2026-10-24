# 보주 합성 — 디자인 문서

`public/orb-fusion.js` / `public/orb-fusion.css` 구현 기준 문서. 아트 디렉션, 필요한 래스터와 오디오 자산과 생성 프롬프트, 화면 구조, 연출 타임라인을 기록한다.

## 1. 아트 디렉션: 성운 도가니

- 콘셉트: 밤하늘 아래 오래된 천문 연성실. 검푸른 흑요석 돌바닥 위에 문스틸(은빛 금속)과 옅은 금 상감이 들어간 소켓 세 개, 그 중심에 결과 소켓이 있다. 빛은 마법 에너지(에테르)에서만 나온다.
- 팔레트
  - 바탕 `#05070f` / `#0a1020` (밤 흑요석)
  - 에테르 `#8fe9ff` (기본 마력 빛, 트레일)
  - 성운 보라 `#a48bff` (주변광, 파티클 보조)
  - 문스틸 `#cfd8e6` → `#5d6878` (소켓 테두리 금속)
  - 연금 `#ffd88a` (실행 버튼, 결과 강조)
  - 결과 순간에는 결과 보주 이미지에서 추출한 색으로 광원이 바뀐다.
- 암시장(자수정과 청동)과 겹치지 않게 차가운 청은색 금속과 에테르 빛을 중심으로 잡고, 따뜻한 금색은 실행 버튼과 결과에만 쓴다.
- 타이포그래피: 로컬 Pretendard 하나만 쓴다. 제목은 작고 단단하게 처리하고 설명 문구는 넣지 않는다. 규칙은 `?` 버튼을 눌렀을 때만 보인다. 가운뎃점(·)은 쓰지 않는다.
- 보주 이미지(API `imageUrl`)가 화면의 주인공이다. 소켓 유리 돔 안에 크게 넣고, 인벤토리에서도 56px 유리 소켓 안에 보여준다. 이미지를 불러오지 못하면 이름 해시 색으로 CSS 유리 구체를 그려서 같은 자리를 채운다. 빈 회색 실루엣은 쓰지 않는다.

## 2. 래스터 자산 (부모 작업에서 생성)

경로: `/static/assets/orb-fusion/`

### 2.1 `chamber.webp` — 연성실 배경

- 용도: 왼쪽 의식 무대(데스크톱 기준 폭 65%) 전체 배경. `background-size: cover; background-position: 50% 58%`로 쓰고 위에 비네트와 색 그라디언트를 깐다. 모바일에서는 무대 영역(대략 1:1)에 맞춰 가운데가 크롭된다. 오른쪽 인벤토리 패널은 이 이미지를 쓰지 않고 짙은 유리 패널로 처리한다.
- 규격: 2400×1600(3:2), 불투명 WebP, 품질 82 안팎, 400KB 이하 권장.
- 구도 요구
  - 원형 석제 제단(dais)의 중심이 이미지 가로 50%, 세로 58%에 오게 한다. 지름은 이미지 높이의 약 70%이고, 정면에서 약간 내려다보는 시점이다.
  - 제단 위는 비워 둔다(보주, 인물, 물체, 빛기둥 모두 없음). UI 소켓과 WebGL 링이 그 자리에 올라간다.
  - 중앙 1:1 영역 안에 핵심 요소를 모두 넣는다. 좌우 가장자리는 어둡고 디테일이 적어야 한다.
  - 전체 밝기는 낮게(로우키) 잡는다. 제단 둘레와 아래쪽이 가장 어둡고, 위쪽 창 너머 성운이 가장 밝은 영역이다.
- 생성 프롬프트 (EN)

```
Fantasy RPG game background, interior of an ancient circular astral alchemy chamber at night,
slightly elevated frontal view looking at an empty round obsidian stone dais in the center
(dais center at 50% width, 58% height, diameter about 70% of image height),
the dais surface is completely empty and flat with subtle engraved concentric grooves,
dark navy-black obsidian walls with faint carved constellation lines,
tall gothic arched windows in the far background showing a deep blue and violet nebula with tiny stars,
huge moonsilver armillary rings suspended high above in shadow, thin pale-gold inlay on stone,
cool cyan rim light grazing the edges of the dais, faint drifting mist near the floor,
low-key cinematic lighting, strong dark vignette, edges of the frame very dark and low detail,
painterly semi-realistic concept art, high detail, rich but restrained color,
palette: #05070f, #0a1020, #8fe9ff, #a48bff, #cfd8e6, small touches of #ffd88a,
no characters, no orbs, no objects on the dais, no text, no letters, no UI, no logo, no watermark
```

- 네거티브: `text, letters, runes readable as alphabet, UI, frame, border, characters, creatures, orb, crystal ball, objects on the dais, bright floor, daylight, warm orange dominant, watermark, signature, blurry`

### 2.2 `ritual-ring.webp` — 의식 문양 (투명)

- 용도: 결과 소켓을 중심으로 제단 위에 놓이는 바닥 문양. 지름은 정사각형 제단 영역의 98%이고, 재료 소켓 세 개는 문양 반지름의 약 73% 원 위에 놓인다. CSS로 아주 천천히(240초에 한 바퀴) 회전시키므로 완전히 방사 대칭이어야 하고, 삼각형이나 특정 방향을 가리키는 요소가 있으면 안 된다. 위에 WebGL 캔버스(`mix-blend-mode: screen`)가 겹친다. 움직임 줄이기 설정에서는 회전을 멈춘다.
- 규격: 2048×2048, 알파 채널 포함 WebP(무손실 또는 품질 90), 배경 완전 투명, 정중앙 정렬.
- 구성 요구
  - 반지름 0~30%: 완전 투명(결과 소켓 자리).
  - 30~38%: 가는 이중 원과 작은 눈금.
  - 70~76%: 가장 밝고 굵은 주 링(재료 소켓이 놓이는 궤도). 문스틸과 옅은 금 상감.
  - 80~96%: 읽을 수 없는 추상 글리프 띠와 별자리 점선, 가장 바깥의 가는 테두리.
  - 사이사이에 가는 별 격자(12각 대칭) 선을 넣는다.
  - 선은 금속 상감 질감에 약한 시안 발광을 준다. 그림자, 바닥 질감, 배경은 넣지 않는다.
- 생성 프롬프트 (EN)

```
Top-down orthographic view of an engraved magical ritual circle, isolated on a fully transparent background,
perfectly centered and perfectly radially symmetric (12-fold symmetry), rotation-safe,
fine moonsilver metal inlay lines with thin pale-gold accents and a faint cyan luminous glow in the grooves,
composition by radius: the inner 30% radius is completely empty and transparent,
a thin double ring with tiny tick marks at 30-38% radius,
the brightest and thickest main ring at 70-76% radius,
an outer band of abstract non-alphabetic arcane glyphs and dotted constellation arcs at 80-96% radius,
a delicate 12-pointed star lattice of hairlines connecting the rings,
crisp anti-aliased linework, elegant jewelry-like precision, game UI asset,
palette: #cfd8e6, #8fe9ff, #ffd88a on transparency,
no background, no floor, no shadow, no triangle, no pentagram, no readable letters or numbers, no text, no watermark
```

- 네거티브: `background, stone floor texture, shadow, perspective, tilt, asymmetric, triangle, pentagram, readable letters, numbers, text, watermark, thick blobs, color fill inside center`

### 2.3 오디오 (CC0, 부모 작업에서 준비)

같은 디렉터리의 `select.ogg`, `charge.ogg`, `reveal.ogg`, `cancel.ogg`.

| 파일 | 재생 시점 | 볼륨 | 성격 |
| --- | --- | --- | --- |
| `select.ogg` | 재료를 소켓에 넣을 때 | 0.30 | 짧은 유리 또는 크리스털 탭, 0.3초 이하 |
| `charge.ogg` | 합성 확정 직후(충전 시작) | 0.42 | 1.2~2초 상승음 |
| `reveal.ogg` | 결과 공개 순간 | 0.50 | 맑은 차임과 저음 임팩트, 2초 이하 |
| `cancel.ogg` | 재료 빼기, 확인창 닫기, 실패 | 0.26 | 부드럽게 내려가는 짧은 소리 |

- 효과음 설정은 `localStorage.orbFusionSound`(`on` 또는 `off`)에 저장한다. 처음 사용자 입력이 있기 전에는 재생하지 않는다. 재생 실패는 조용히 무시하고 게임 진행을 막지 않는다.

## 3. 화면 구조

```
데스크톱 (>1080px, 전역 내비게이션 아래 뷰포트를 꽉 채움)
┌───────────────── 무대 65% ─────────────────┬──── 인벤토리 35% ────┐
│ 보주 합성                     [?] [♪] [⟳]  │ 보유 보주        12  │
│                ( 재료 1 )                  │ [전체][시리즈…]      │
│                                            │ ┌ 보주 행 ─────────┐ │
│                ( 결과 )                    │ │ ◉ 이름   ×3 귀속1 │ │
│      ( 재료 2 )            ( 재료 3 )      │ └──────────────────┘ │
│                                            │ …(내부 스크롤)       │
│        [비우기]   [ 합성 ●●● ]             │                      │
└────────────────────────────────────────────┴──────────────────────┘
```

- 태블릿(761~1080px): 두 열을 유지하고 인벤토리 폭을 `minmax(300px, 40%)`로 둔다. 소켓 크기는 제단 크기에 비례한다.
- 모바일(≤760px): 세로 흐름. 무대가 맨 위에 오고, 제단은 `min(100vw, 52svh)` 정사각형이다. 그 아래 인벤토리가 이어지고(페이지 스크롤), 실행 바는 root의 마지막 자식으로 `position: sticky; bottom: 하단탭 높이`에 둔다. 스크롤 중에는 하단에 붙어 있다가 끝에 다다르면 원래 자리로 돌아가므로 마지막 행을 가리지 않는다. 하단 탭 높이는 JS로 재서 `--of-dock`에 넣는다.
- 제단은 container query(`cqw`/`cqh`)로 항상 정사각형을 유지한다. 소켓 좌표는 정사각형 기준 백분율이다.
  - 결과: (50%, 52%)
  - 재료 1: (50%, 16%)
  - 재료 2: (19%, 70%)
  - 재료 3: (81%, 70%)
- WebGL 캔버스는 제단보다 사방으로 14% 크게 깔아 빛 번짐이 잘리지 않게 한다. 소켓 중심 좌표는 매 리사이즈마다 DOM에서 직접 측정해 셰이더 유니폼으로 넘긴다.

## 4. 소켓 디자인

- 재료 소켓: 3겹 구조. ① 문스틸 링(원뿔 그라디언트로 브러시 금속 표현) ② 어두운 홈(inset 그림자) ③ 유리 돔(위쪽 하이라이트, 아래 반사). 비어 있으면 돔 안에 희미한 에테르 결정 문양(CSS 그라디언트)만 보인다. 채워지면 보주 이미지가 돔을 가득 채우고 테두리에 에테르 빛이 돈다. 누르면 비운다.
- 결과 소켓: 재료 소켓보다 1.3배 크고 금 상감 링이 이중으로 둘러져 있다. 결과가 나오기 전에는 WebGL 코어 빛만 보이고, 공개되면 보주 이미지와 이름판이 나타난다.
- 재료 번호(1, 2, 3)는 소켓 바깥 링에 작은 각인 숫자로만 표시한다.

## 4.1 보유 보주 진열장 (인벤토리)

- 방향: 웹 목록이 아니라 마법 공방의 보석 진열장으로 보이게 한다. 패널 내부는 밤색 칠기 느낌의 짙은 남색 바탕에 45도 격자 음각을 넣고, 위쪽에서 램프 빛이 떨어지게 한다. 테두리에는 금색 모서리 브래킷 네 개만 둔다. 보주 수가 적어 남는 공간도 진열장 내부처럼 보인다.
- 칸(타일) 그리드: 데스크톱은 `auto-fill, minmax(124px, 1fr)`(1440px에서 3열), 태블릿은 `minmax(118px, 1fr)`(820px에서 2열), 휴대폰은 고정 3열(340px 이하는 2열)이다.
- 타일 구성 (위에서 아래로)
  - 보석 소켓: 문스틸 베젤(원뿔 그라디언트 테두리), 벨벳 홈, 유리 광택을 겹친다. 홈 안쪽에 보주 이미지 평균색(`--oc`)으로 은은한 후광을 깐다.
  - 보주 이미지: 원본 PNG의 투명 여백을 측정해 확대하므로(`fitImage`) 보주가 소켓을 꽉 채운다. 같은 처리가 제단 소켓과 결과 소켓에도 적용된다. CORS 등으로 측정하지 못하면 원래 비율대로 둔다.
  - 수량 명판: 베젤 아래쪽에 걸친 금 테두리 알약 모양으로 `×30`처럼 표시한다.
  - 선택 보석: 제단에 올린 개수만큼 베젤 위쪽에 금 다이아 보석이 놓인다. 같은 보주를 여러 개 올리면 보석도 늘어난다. 타일에는 금 테두리와 안쪽 금 필리그리 선이 켜진다.
  - 귀속: 왼쪽 위 보라색 자물쇠 인장과 숫자.
  - 설명 버튼: 오른쪽 위 `i`.
  - 이름(두 줄까지)과 시리즈(한 줄).
- 설명을 열면 해당 칸이 그리드 한 줄 전체로 넓어져, 왼쪽은 타일, 오른쪽은 설명판인 조사판이 된다. 빈칸은 `grid-auto-flow: dense`로 채운다.
- 상태: 호버하면 타일이 3px 떠오르고 소켓에 보주 색 광채가 생기며 보주가 1.06배로 커진다. 모두 올린 보주는 채도와 불투명도를 낮추고, 잠금 중에는 전체를 흐리게 한다. 새로 얻은 보주에는 금빛 맥동(`of-new`)을 준다.
- 테스트 훅 유지: `.of-list > .of-item > button.of-row`, `.of-info`(aria-expanded, aria-controls), `.of-desc`. 접근성 이름은 `.of-row`의 aria-label(이름, 보유, 귀속, 선택 수)로 제공하며, 장식 요소는 `aria-hidden`이다.

## 5. 합성 연출 타임라인

1. **대기**: 링이 천천히 돌고, 혜성 같은 빛이 주 링을 따라 공전한다. 파티클은 느리게 떠다닌다. 채워진 소켓에서 중심으로 에테르 트레일이 흐르고, 세 칸이 모두 차면 삼각형 테두리에도 불이 들어온다.
2. **확인창**: 소모될 재료 세 개(이미지, 이름)와 "무작위 보주 1개, 거래 가능"을 보여주고 "되돌릴 수 없음" 경고를 함께 띄운다. 확정하면 요청을 보낸다.
3. **충전**(요청 진행 중, 최소 1.1초): `charge` 값이 0에서 0.92까지 지수적으로 오른다. 링이 빨라지고 파티클이 나선을 그리며 중심으로 모이며, 재료 소켓 이미지는 빛으로 녹아든다. 이 단계에서는 결과를 표시하지 않는다.
4. **해방**(서버 성공 확인 후에만): `burst` 값이 0에서 1까지 1.3초 동안 진행된다. 섬광, 충격파 링, 빛살이 퍼지고 광원 색이 결과 보주 색으로 바뀐다. `burst`가 0.18에 이르면 결과 이미지가 확대와 블러 해제와 함께 나타나고 이름판이 올라온다.
5. **정착**: 결과 색 광륜이 천천히 숨쉬듯 맥동한다. 인벤토리의 해당 행이 잠깐 빛난다. 새 재료를 고르면 결과 표시가 사라진다.

- 실패: 충전이 빠르게 식고 `cancel` 소리가 난다. 상태 줄에 오류를 띄우고 "다시 시도"(같은 requestId, revision, materialIds 재사용)와 "선택 초기화" 버튼을 보여준다. 초기화는 목록을 다시 불러오며, 이미 전송한 합성을 취소하지 않는다는 안내를 표시한다.
- 연출은 표시만 담당한다. 서버 응답(`orbs`, `revision`, `result`)은 연출을 시작하기 전에 바로 상태에 반영하며, 결과를 뒤섞어 보여주는 슬롯머신식 연출은 쓰지 않는다.
- 움직임 줄이기: RAF 루프를 돌리지 않고 상태가 바뀔 때만 한 프레임씩 정적으로 그린다. 해방 단계를 건너뛰고 결과를 페이드로 바로 보여준다. 문양 회전과 CSS 애니메이션도 끈다.
- WebGL을 쓸 수 없거나 컨텍스트를 잃으면 `data-gl="off"`로 전환해 CSS 정적 광륜과 트레일로 대신한다. 컨텍스트가 복원되면 다시 초기화한다.

## 6. 셰이더 구성 (단일 풀스크린 패스)

- 유니폼: 해상도, 시간, 중심 좌표, 단위 반지름(중심에서 소켓까지 거리), 소켓 반지름, 소켓 3개(xy와 채워짐 여부), 소켓별 색(이미지 평균색), 결과색, `charge`, `burst`, `result`, `ready`
- 레이어: 성운 안개(값 노이즈) → 동심 링 3개와 룬 대시 띠 → 공전 혜성 → 소켓 광륜 → 소켓에서 중심으로 흐르는 트레일과 삼각 테두리 → 나선 파티클 40개(꼬리 포함) → 중심 코어 → 해방(섬광, 충격파, 빛살) → 결과 광륜
- 출력: 지수 톤맵 `1 - exp(-c)`를 거쳐 프리멀티플라이드 알파로 내보내고, `mix-blend-mode: screen`으로 배경 위에 더한다.
- DPR은 최대 1.5로 제한하고, 캔버스 긴 변은 1400px로 제한한다. 대기 중에는 30fps, 연출 중에는 60fps로 그리며, 탭이 숨겨지거나 화면 밖에 있으면 멈춘다.

## 7. 통합 계약

- `window.OrbFusionUI.mount(root, { api, postApi })`와 `unmount()`
- `mount`는 root 안에 DOM을 직접 만들고 `.orb-fusion-root` 클래스를 붙인다.
- `unmount`는 리스너(AbortController), RAF, ResizeObserver, IntersectionObserver, 타이머, WebGL(버퍼, 프로그램, 컨텍스트), 오디오를 정리한다.
- 페이지 래퍼 `.page[data-page="orb-fusion"]`는 CSS로 전체 폭(full-bleed)이 되고, 활성화되면 `display:block`이 된다. 데스크톱과 태블릿 높이는 JS가 측정한 root의 문서 상단 오프셋(`--of-top`)과 하단 메뉴 높이(`--of-dock`)를 제외한 `100dvh - top - dock`이다.
- API 문자열은 모두 `textContent`로만 렌더링한다(`innerHTML`을 쓰지 않음).
