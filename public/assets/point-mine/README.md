포인트 광산 이벤트의 그림과 효과음은 사용자가 지정한 https://github.com/Lukim99/point-mine 에서 가져왔다.

참조 커밋: 63480eaca6e34cb78b2f229dff1846a6d17ae033

- `src/assets`: bg_pc.png, bg_mobile.png, pickaxes.png, ores.png, chests.png, chests-open.png, mine-rock.webp
- `src/lib/sprites.ts`: 실제 그림 경계와 시트 표시 계산을 public/point-mine-sprites.js에 적용
- `src/components/MiningStrike.tsx`, `src/MiningStrike.css`: 640ms 채굴 동작과 280ms 타격 시점 참고
- `src/components/GameScreen.tsx`, `src/App.css`, `src/InventoryControls.css`, `src/ArcaneWorkshop.css`: 나무·돌 패널, PC 3단 배치, 모바일 하단 메뉴, 인벤토리와 획득 창 스타일 참고
- `public/audio`: mine-hit.wav, reward.wav 및 원본 라이선스 두 파일
- `key.png`: 이 저장소의 기존 아티팩트 옵션 변경열쇠 아이콘을 복사해 사용

효과음 출처는 Kenney Interface Sounds와 Impact Sounds(CC0 1.0)다. mine-hit.wav는 impactMining_000.ogg, reward.wav는 confirmation_001.ogg에서 변환된 원본 저장소의 WAV를 그대로 사용한다. 라이선스는 LICENSE-impact.txt와 LICENSE-interface.txt에 보관한다.

곡괭이 내구도, 광물 해금·가중치, 수리 재료는 원본 game.ts, repair.ts 및 mining-expected-values.md를 참고했다. 이벤트 상자는 모든 16종이 나올 수 있도록 별도 확률을 사용한다. 외부 로그인, 계정 포인트 정산과 Supabase 데이터는 사용하지 않는다.
