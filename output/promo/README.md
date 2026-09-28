# RPGenius 웹 홍보 영상 (60초)

- `RPGenius_web_60s.mp4`: 1920×1080, 60fps, H.264 + AAC 48kHz, 60.0초
- `poster.jpg`: 썸네일/포스터 프레임

## 흐름

| 시간 | 장면 | 사용한 실제 화면 |
|---|---|---|
| 0:00 | 채팅창 속 텍스트 RPG | 웹 채팅 ‘RPGenius 개인 채팅’의 실제 봇 응답 문구 |
| 0:03 | 이제, 웹에서 펼쳐진다 | 일반 필드 전투(월도랜드5) |
| 0:05 | 로고 · 설치 없이, 브라우저 하나로 | 브라우저 속 전투 화면 |
| 0:08 | 키울수록 강해진다 | 캐릭터 정보(전투력 2,012,821 · 초월 3단계 +15 · 신화 장비) |
| 0:10 | 3장의 카드, 하나의 운명 | 카드 조합 화면 + 실제 조합 연출(럭키 카드 → 조합 성공) |
| 0:13 | 강화 성공의 짜릿함 | 실제 강화 연출(콰트로 1악장 +9 → +10 성공) |
| 0:16 | 실시간 전투 | WebGL 필드 전투: 스킬, 치명타 |
| 0:20 | 28개의 필드 | 일반 필드 선택 화면 |
| 0:22 | 헬 필드 보스전 | 헬 초대장 입장 연출 → 부타게임 [H] 보스·기둥 파괴 → 전리품 획득 |
| 0:26 | PVP 대전 | PVP 로비(VS) → 전투 → 승리(레이팅 1,000 → 1,016) |
| 0:29 | 혼자서도, 함께라면 더 | 사냥 메뉴 5종 + 5인 파티 레이드 편성 |
| 0:32 | 놓치면 사라지는 핫딜 | 핫딜 상점 |
| 0:34 | 유저가 만드는 거래소 | 팝니다 · 삽니다 |
| 0:37 | 정상을 향해, 함께 | 전투력 랭킹 · 채팅 |
| 0:40 | 시즌마다 새로운 이벤트 | 봉인된 자물쇠 오픈 영상 · 자물쇠 · 윷놀이 |
| 0:43 | 수백 종의 장비 · 카드 · 펫 | 인벤토리 · 도감 |
| 0:46 | PC에서도, 모바일에서도 | 데스크톱 + 모바일(반응형) 화면 |
| 0:50 | 하이퍼 몽타주 | 위 장면들 |
| 0:52 | 지금, 웹에서 시작하세요 | rpgenius.kro.kr · 지금 플레이 |

## 제작 방식

- 모든 게임 화면은 이 저장소의 실제 웹 코드(`server.js`, `public/*`)를 로컬에서 구동해 헤드리스 브라우저로 캡처했습니다.
  운영 DynamoDB 대신 인메모리 목을 썼고, 저장소의 게임 데이터(JSON), 저장소 `tmp/`에 있는 운영 스냅샷 파일, git 히스토리의 실제 이미지 에셋을 사용했습니다. 운영 DB·S3의 데이터는 읽지도 쓰지도 않았습니다.
- WebGL 전투와 조합·강화 연출은 페이지 시계를 멈춘 뒤 프레임마다 정확한 시간만큼 전진시키며 촬영했습니다. 그래서 소프트웨어 렌더링 환경에서도 끊김이 없습니다.
  조합(럭키 카드)과 강화 결과는 조작하지 않은, 실제 서버 로직의 결과입니다.
- 타격 순간 캐릭터가 하얗게 번쩍이는 게임 고유의 피격 연출(0.36~0.52초)은 편집에서 속도 램프로 빠르게 지나가게 했습니다. 프레임 자체는 고치지 않았습니다.
- 쇼케이스 계정(‘지니어스’)과 랭킹·채팅·거래소의 다른 닉네임은 모두 가상의 닉네임입니다. 실제 유저 닉네임은 나오지 않습니다.
- 음악과 효과음은 numpy로 직접 합성한 오리지널 사운드입니다(외부 음원 없음). 컷·타격·타이핑 소리는 화면과 같은 큐 시트(`src/ad/cues.js`)에 맞춰 나옵니다.

## 다시 만들기 (`src/`)

```
src/capture/   실서버 구동용 DynamoDB 목, 시드 계정, 화면·클립 캡처 스크립트
src/ad/        60초 타임라인(HTML/JS, 시간 t에 대한 순수 함수)
src/audio/     사운드트랙 합성기
src/render.js  프레임 렌더러,  src/build.sh  전체 빌드(렌더 → 합성 → 인코딩)
```

캡처 에셋(스크린샷·클립 프레임, 수백 MB)은 저장소에 넣지 않았습니다. 아래 순서로 다시 만들 수 있습니다(Node 18+, Python 3 + numpy/scipy/Pillow, ffmpeg).

```bash
cd output/promo/src && npm install
# 1) 실제 이미지 에셋 복원(.gitignore 대상, git 인덱스는 건드리지 않음)
(cd ../../.. && git archive 0206f3fd^ DB/RPGenius/cardImage DB/RPGenius/itemImage DB/RPGenius/ui | tar -x)
# 2) 시드 데이터 → 로컬 서버(인메모리 DynamoDB 목 + 가짜 AWS 자격 증명, 운영 접근 없음)
node capture/build_seed.js
capture/serve.sh 3900
# 3) 캡처 (전투 클립은 계정을 공유하므로 차례로 실행)
node capture/populate_chat.js
node capture/shots.js
node capture/raid_room2x.js
node capture/clips.js field '{"select":[[442,1034],[960,830]]}'
node capture/clips.js hfield
node capture/clips.js pvp
mkdir -p assets/gif_fusion assets/clips/lockbox_video assets/shots_extra
python3 -c "from PIL import Image, ImageSequence as S; [f.convert('RGBA').save('assets/gif_fusion/%02d.png' % i) for i, f in enumerate(S.Iterator(Image.open('../../../DB/RPGenius/ui/조합/조합-이펙트.gif')))]"
capture/run_dom2x.sh        # 카드 조합·강화: 실제 서버가 성공을 굴릴 때까지 새 서버로 재시도
ffmpeg -i ../../../public/assets/자물쇠.mp4 -vf fps=60 -q:v 2 -start_number 0 assets/clips/lockbox_video/%05d.jpg
echo '{"fps":60,"frames":600,"marks":[]}' > assets/clips/lockbox_video/log.json
cp ../../yut/desktop-final.png assets/shots_extra/yut.png
# 4) 렌더(3600프레임) + 사운드 합성 + 인코딩 → out/RPGenius_web_60s.mp4
./build.sh 4
```

조합·강화 결과는 확률이라서 다시 캡처하면 결과 카드가 달라질 수 있습니다. 그때는 `ad/scenes.js`의 해당 장면 타이밍을 다시 맞춰야 합니다.

## 게시 전 확인

캐릭터 카드와 스프라이트 일부는 실존 인물의 얼굴을 바탕으로 한 이미지입니다. 게임 밖 광고로 집행할 경우 초상권·퍼블리시티권을 먼저 검토하는 것을 권장합니다.
