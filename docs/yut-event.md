# 관리자 전용 윷놀이

이벤트 그룹 첫 번째 메뉴에 `윷놀이`를 추가했다. 일반 계정의 HTML에는 게임 영역이 없고, 조회/던지기 API도 현재 유저의 `isAdmin`을 확인한다.

## 적용한 규칙

- 개인 말 한 개를 움직이며, 일반 던지기에 `윷` 4개를 사용한다.
- 네 윷 각각 앞/뒤 확률은 50%다. 도/개/걸/윷/모에 따라 1/2/3/4/5칸 이동한다.
- 모서리와 중앙에 정확히 멈춘 뒤 다음 던지기에 지름길을 탄다. 출발점을 지나면 완주하며 남는 칸은 이월하지 않는다.
- 윷·모가 나오면 무료 추가 던지기 1회를 받는다. 추가 던지기에서도 윷·모가 나오면 다시 이어진다. 윷이 0개여도 이용할 수 있고, 완주하거나 새로고침해도 기회가 보존된다. 빽도, 잡기, 업기는 적용하지 않는다.
- 완주마다 1개 지급: 장비 보호권 → 고급 장비 보호권 → 7성 전직 카드팩 → 8성 카드팩 → 8성 보호 카드 → 8성 전직 카드팩 → 9성 카드팩 → 9성 보호 카드 → 9성 전직 카드팩 → 제타 카드팩. 11회부터는 매번 5성 카드팩 1개다.

## 저장과 운영 데이터

아이템 소모, 이동, 완주 횟수, 보상과 추가 던지기(`bonusRoll`)는 기존 유저 레코드의 인벤토리와 `yutEvent`에 함께 저장한다. 무료 여부는 서버의 저장 기록으로만 판정한다. 같은 요청을 재전송하면 직전 결과를 반환하며 재차감하지 않는다. 다른 화면의 오래된 진행 번호는 거절한다. 기존 유저 캐시의 저장 성공 여부를 확인할 수 있도록 `RPGUser.save()`가 원래 저장 결과를 반환하게 했다. 동시 요청 잠금은 기존 서버의 단일 프로세스 운영을 기준으로 한다.

`node scripts/init_yut_item.js`를 명시적으로 실행해 운영 DB에 없던 윷 아이템만 추가했다(추가 당시 ID 386). 기존 386개 아이템이 동일함을 재조회로 확인했다. 스크립트는 기존 윷 정의를 보존하며, 동시 운영 수정이 감지되면 덮어쓰지 않고 실패한다. 서버 시작/import에서는 실행하지 않는다. 보상은 운영 Item 목록에서 이름으로 찾으며, 월별 보호카드 대신 기존 `8성 보호 카드` / `9성 보호 카드`를 지급한다. 기존 꾸러미·보상 아이템 정의·제작식·유저 보유량은 변경하지 않았다. 윷 획득처는 추가하지 않았으며 관리자 아이템 지급 기능에서 지급할 수 있다.

코드의 운영 배포 및 서버 재시작은 수행하지 않았다.

### 송편

`node scripts/init_songpyeon_item.js --apply`를 명시적으로 실행해 없던 송편만 운영 Item ID 387에 추가했다. 기존 387개 아이템이 동일함을 재조회로 확인했다. Bundle/Pack/제작식이나 기존 보상 정의는 수정하지 않았다. 송편 사용 기능은 새 서버 코드 배포 후 적용된다. 획득처나 유저 지급은 추가하지 않았다.

송편 1개마다 윷 1~4개(수량별 25%)를 받고, 익명 지렁이 5개 / 밍플 지렁이 1개 / 상급 강화석 3개 / 헬 초대장 3개 / 쥬얼 3개 중 하나(각 20%)를 별도로 받는다. 여러 개 사용 시 각 송편을 독립 추첨한다. `guaranteed`와 `choices`는 운영 Item 데이터에서 읽고 아이템 이름으로 현재 ID를 찾는다. 잘못되거나 누락된 보상은 차감 전에 거절한다.

기존 인벤토리 사용 화면과 채팅 `사용` 명령에 연결했다. 송편 소모와 두 종류 보상을 같은 유저 저장에 반영하며, 윷 던지기와 송편 사용은 같은 잠금을 사용한다. 저장 실패 후 같은 프로세스에서 다시 사용하면 이전 결과 저장을 재시도하며 재차감·재추첨하지 않는다. 기존 유저 캐시의 실패 재저장 동작도 유지한다.

이미지는 기존 S3 `tcgenius/assets/itemImage/이벤트/송편.png`를 그대로 사용한다. 새로 생성하거나 S3에 덮어쓰지 않았다.

### 추가 화면 정리

`완주`와 `한 번 더`도 투명 이미지로 표시한다. 무료 버튼은 보조 문구 없이 `윷 한 번 더 던지기` 한 줄로 표시하며 게임 방법은 제거했다. 소리는 기본 켜짐이며 첫 던지기 클릭에서 AudioContext를 활성화한다. 사용자가 소리를 끄는 기능은 유지한다.

- 추가 이미지: `DB/RPGenius/ui/윷놀이/result-finish.png`, `DB/RPGenius/ui/윷놀이/result-again.png`
- 새 미리보기: `output/yut/finish-v4.png`, `output/yut/again-v4.png`, `output/yut/mobile-v4.png`
- 송편 상세/사용 결과: `output/yut/songpyeon-detail.png`, `output/yut/songpyeon-use.png`
- 추가 검증: `node --test tests/songpyeon_item.test.js tests/yut_event.test.js tests/user_cache.test.js test/node-kakao-auth.test.js` — 23개 통과. 윷 수량 × 추가 보상 20개 조합, 여러 개 사용, 운영 보상 수량 반영, 부족/잘못된 입력, 공유 잠금, 저장 실패 후 재시도를 포함한다. 브라우저에서 기본 소리의 AudioContext `running`, 소리 토글, 두 축하 이미지, 한 줄 무료 버튼, 게임 방법 제거, 모바일 가로 넘침 없음, 동작 줄이기와 송편 실제 사용을 확인했다. 실행 오류와 자산 요청 실패는 없었다. 테스트는 DynamoDB/S3 경계를 격리했고, 로컬에 없는 상급 강화석과 헬 초대장 정의는 읽어서 확인한 운영 정의를 검증용 메모리에만 보충했다.

## 연출과 자산

화면 폭과 높이를 활용하는 배치에 단순한 나무 판, 별도 투척 쟁반과 하단 보상 목록을 사용한다. 꽃가지·한옥·비단·등롱을 그린 분홍빛 배경은 낮은 불투명도로 깔고, 모바일에서는 하단으로 자연스럽게 사라지게 했다. 타이틀과 도·개·걸·윷·모는 금빛 테두리의 입체 이미지로 만들었다. 장식 문구·궁서체·도장은 없으며 조작부는 앱의 기본 글꼴을 사용한다. 다른 탭으로 나가면 기존 레이아웃을 복원한다.

Three.js로 반원형 나무 윷, 앞뒷면의 나뭇결, 그림자와 조명을 렌더링한다. 약 0.46초 동안 윷을 모아 흔든 뒤, 각각 조금씩 다른 높이와 시간으로 던진다. 공중 회전은 낙하 전에 마무리하며 두 번의 작은 반동과 미끄러짐 후 잠시 멈춘다. 착지 이후에는 앞뒷면을 바꾸지 않고 약 0.54초 동안 수평 이동과 회전만으로 모은다. 전체 투척 연출은 약 3.1초이며, 확대된 결과 이미지·빛살·꽃잎 효과 → 칸별 이동 → 완주 축하 순서로 이어진다. 결과 이미지는 미리 읽어 두며 이미지 로드가 실패하면 글자로 표시한다. 모으는 과정은 실제 물리 시뮬레이션이 아니라 서버 결과에 맞춘 연출이다. 저장된 결과를 다시 불러올 때에도 해당 앞뒷면을 보여준다. 효과음 켜기/끄기와 시스템 동작 줄이기를 지원하며, 소리를 켜면 투척 바람음과 윷마다 다른 짧은 나무 타격음이 난다. Three.js는 `public/vendor/yut/`에서 관리자 페이지 진입 시에만 불러온다.

완성 그림은 내장 image_gen으로 생성했다.

- 판: `DB/RPGenius/ui/윷놀이/board-simple.png`
- 투명 윷 아이콘: `DB/RPGenius/itemImage/이벤트/윷.png`
- 배경·타이틀: `DB/RPGenius/ui/윷놀이/background.png`, `DB/RPGenius/ui/윷놀이/title.png`
- 결과 글자: `DB/RPGenius/ui/윷놀이/result-{do,gae,geol,yut,mo}.png` (각각 투명 PNG)
- 새 화면: `output/yut/desktop-final.png`, `output/yut/mobile-final.png`
- 배경·타이틀·결과 글자의 최종 생성/교정 프롬프트: [yut-art-prompts.md](yut-art-prompts.md)

### 판 생성 프롬프트

Use case: product-mockup. Asset type: playable Korean yutnori wooden board artwork for a browser game, square 1536x1536. Make a clean, simple, premium traditional Korean yutnori board, straight overhead orthographic view with NO perspective. Entire image filled by the square board. Pale blond maple wood with subtle natural grain, narrow softly beveled warm caramel wood frame, realistic soft diffuse daylight, delicate craft. Thin single dark brown engraved lines form a square outer track and two diagonal tracks crossing at center. Precisely 20 outer circular spaces: four larger corners at (12%,12%), (88%,12%), (88%,88%), (12%,88%), with exactly four equally spaced small circular spaces between corners on each side. Each small circle has an unfilled pale wood interior and one crisp brown ring. Center (50%,50%) is a larger unfilled circle. Each half-diagonal has exactly two equally spaced small unfilled circular nodes, so 8 interior small nodes total. Correct traditional board layout, clear thin engraved connections between nodes, generous clean empty wood. Very restrained detailing, pleasant warm neutral colors. NO landscape paintings, pine trees, mountains, birds, flowers, petals, painted ornament, text, numbers, letters, symbols, token pieces, sticks, dice, perspective, cast shadows from other objects, website UI or watermark. This is the final board artwork, not a website screenshot.

마지막 편집 프롬프트:

Use case: precise-object-edit. Edit target: the provided simple wooden Korean yutnori board. Preserve the entire board, wood grain, frame, existing lines and circles, lighting, camera and colors exactly. Add ONLY the TWO missing small circular spaces along the diagonal from top-right to bottom-left: one centered at exactly (60%,40%) of the image and one at exactly (40%,60%). They are between the central large circle and the existing small circles farther out on this diagonal. Match the size, thin engraved dark brown ring and plain wood interior of the existing small circle at (40%,40%). The connecting diagonal line must stop at the added circle's circumference, so no line runs inside its interior. After edit there must be two small circles on EACH of the four corner-to-center diagonal segments, eight small interior diagonal circles total. Do not remove or move any existing circles. Add no text, labels, flowers, pieces, decoration, or anything else.

### 아이템 생성 프롬프트

Use case: stylized-concept. Asset type: Korean yut stick inventory icon for a game, square 1024x1024, truly transparent alpha background. Primary request: precisely ONE traditional Korean wooden yut stick, elongated half-cylinder split wooden baton with rounded end bevels, gently curved dark honey chestnut bark back and light warm golden flat cut face, natural fine carved woodgrain and four small traditional dark burnt X markings on its rounded back, elegantly angled bottom-left to top-right. Premium hand-painted realistic Korean folk game inventory artwork with crisp readable silhouette, warm soft studio lighting, no ground plane. One object only, centered, fits within 80% of square canvas, no letters, text, numbers, watermark, frame, cards, props, bundles or additional sticks. Transparent background.

## 확인한 내용

`node --test tests/yut_event.test.js tests/user_cache.test.js test/node-kakao-auth.test.js` — 18개 통과.

새 이미지 적용 후 PC 1440×1000와 모바일 390×844에서 다시 확인했다. 다섯 결과 이미지를 실제 API 던지기로 각각 표시했고 모두 투명 PNG임을 확인했다. 각 결과에서 네 윷의 최종 면이 서버의 앞뒷면과 일치하고 착지 이후 모으는 동안 면이 바뀌지 않았다. 윷 0개에서 무료 윷·모 기회를 사용하고 도 이후 유료 버튼이 비활성화되는 흐름, 완주 보상과 새로고침 복원도 통과했다. 새 연출에서 브라우저 실행 오류·자산 요청 실패·모바일 가로 넘침은 없었다. 이 단계에서도 운영 DB를 사용하지 않았다.

실제 server.js와 public/app.js를 실행하고 DynamoDB/S3 경계만 격리한 상태에서 Chrome/Playwright로 확인했다. 테스트에서 운영 DB에 접근하거나 쓰지 않았다. 새 화면은 1440×1000에서 가로 전체와 내비게이션 아래 남은 높이를 채우고, 390px 모바일에서도 가로 넘침이 없다. 착지 이후의 실제 Three.js 회전값을 검사해 네 윷 모두 앞뒷면이 모으기 전후 동일함을 확인했다. 4개를 소모한 윷 → 0개 상태에서 무료 모 → 무료 도 → 다음 유료 던지기 비활성화를 확인했다. 완주 시 보상 지급과 무료 기회 유지, 새로고침 시 결과 면 및 무료 기회 복원, 요청 도중 탭 이동·복귀, 기본 레이아웃 복원과 동작 줄이기도 확인했다. 새 화면에서 실행 오류와 자산 요청 실패는 없었다. 관리자 권한, 동시 요청, 중복 재전송, 저장 실패 재시도도 테스트에 포함된다.


## S3 이미지 이전

`node scripts/migrate_yut_assets_to_s3.js`로 새 이미지 11개를 S3에 업로드했다. 화면 이미지 10개는 `tcgenius/assets/ui/윷놀이/`, 윷 아이콘은 `tcgenius/assets/itemImage/이벤트/윷.png`에 저장한다. 로컬 사본은 기존 `DB/RPGenius` 자산 폴더로 이동했고, 화면 참조는 기존 `/rpg-ui` 및 `/item-image` 경로로 변경했다. 서버 시작 시 기존 S3 자산 동기화를 사용한다. 송편 이미지는 기존 S3 자산을 유지한다. 이번 이전에서는 요청에 따라 검증·테스트를 실행하지 않았으며 코드 배포 및 서버 재시작도 수행하지 않았다.
