# 뒤틀림 붕괴 배경

내장 imagegen으로 생성한 천상 붕괴 이벤트 전용 배경이다. 기존 회랑의 석조 아치, 금빛 장식, 검은 대리석과 연결되는 붉은 균열을 표현했다. 천상 회랑의 기본 배경은 유지한다.

- 프로젝트 자산: `DB/RPGenius/ui/낙원/collapse.webp`
- S3: `s3://eefl-image/tcgenius/assets/ui/낙원/collapse.webp`
- SHA-256: `4ec456a5c6d9f450a65c5a56905eecf9d219197cc80b8807ab9fe2518674f305`
- 생성된 PNG를 FFmpeg로 WebP 인코딩했다. 그림의 크기나 구성은 변경하지 않았다.
- `scripts/paradise_assets.json`에 등록하고 기존 마이그레이션으로 새 파일 1개만 업로드했다. S3 재조회로 해시와 MIME을 확인했다.
- 기존 `/rpg-ui` 경로와 WebGL 배경 렌더러를 사용한다. 최초 붕괴 선택지와 두 번째 붕괴의 강제 귀환 화면에 적용한다.
- Claude CLI `claude-opus-5-5`에 시각 방향을 1회 요청했다. 비용 $0.1525376, 상한 $0.50. 제안 중 기존 금속 선택지 유지, 붉은색/보라색 균열빛, 기존 페이드 전환을 적용했다. 새 UI 문구나 장식 패널은 추가하지 않았다.

최종 생성 프롬프트:

```text
Use case: stylized-concept.
Asset type: 16:9 high-resolution in-game background for the distortion collapse event in a dark fantasy roguelike Heaven corridor.
Primary request: Create a dramatic environmental painting of a celestial gothic corridor tearing apart under catastrophic spatial distortion. The architecture is monumental pale stone arches with aged gold trim, a black marble floor engraved with subtle golden circular patterns, and a distant luminous tower. The tower and arches are now fractured and bent impossibly, floating slabs and broken bridges suspended in a stormy void. A jagged crimson-violet spatial tear cuts the far tower, with restrained white-hot light at its center and drifting stone shards.
Composition: player-level wide cinematic view, central distant focal point, broad dark readable foreground for game choice overlays. Strong depth and fine architectural texture, realistic game environment concept art, crisp detail. Upper two-thirds show the spectacular fracture; lower third remains comparatively calm, dark cracked stone.
Mood: ominous final warning, beautiful and terrifying, no literal hell or lava.
Constraints: environment only, no characters, no monsters, no text, no letters, no UI, no logos, no watermark. Not a website mockup. 2560x1440 landscape.
```
