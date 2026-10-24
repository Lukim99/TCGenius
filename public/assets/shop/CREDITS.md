# 상점 배경과 효과음

`backdrop.webp`는 2026-10-24 내장 ImageGen으로 생성한 정적 배경이다. 원본 PNG를 WebP 품질 85로 인코딩했다.

생성 요청: 어두운 흑연색 무광 표면, 미세한 금속 결, 넓고 부드러운 조명, 낮은 대비. 글자, 상징, 물체, 입자, 빛줄기, 받침대, 건축물 없이 아이템을 방해하지 않는 단순한 배경.

효과음은 기존 [Kenney RPG Audio](https://kenney.nl/assets/rpg-audio)의 CC0 에셋을 공용으로 사용한다. 원본 매핑과 라이선스는 [암시장 에셋 출처](../black-market/CREDITS.md)에 있다.

- 선택 및 버튼: `../black-market/click.ogg` (metalClick)
- 구매 완료: `../black-market/coins.ogg` (handleCoins)
- 입찰 완료: `../black-market/seal.ogg` (metalLatch)
- 입찰 취소: `../black-market/cancel.ogg` (bookClose)

암시장은 기존 음량과 순서를 유지하며, 입찰 완료와 취소 효과음 후 180ms 뒤 동전 소리를 재생한다.

효과음 조작 버튼은 표시하지 않는다. 탭이 보이지 않거나 상점을 떠나면 재생 중인 소리를 정지한다.
