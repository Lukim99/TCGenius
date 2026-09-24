# 2026 Chuseok event assets

## Generated artwork

Created with the built-in `image_gen.imagegen` tool. PNG masters remain in the Codex generated image directory. The shipped WebP files preserve the composition and alpha, encoded with FFmpeg (quality 90; greeting 92).

- `moon.webp`: full-screen moon and night landscape.
- `greeting.webp`: exact greeting lettering; the two lines are revealed separately with CSS clipping.
- `reward.webp`: celebratory card-pack illustration. The reward is `[추석]5성 전직 카드팩`, quantity 1, cloned from the operational `5성 전직 카드팩` definition with only its name changed.
- `item-icon.png`: inventory icon, edited with the built-in imagegen tool using `reward.webp` as the art target and the existing `5성 전직 카드팩.png` as a layout reference. Transparent 800×800 PNG; the pack is fitted proportionally inside the reference's 261×306 occupied rectangle at (291, 236). Final pack bounds are (330, 236)–(513, 542), matching the reference's height and vertical margins. Registered as `itemImage/가챠/[추석]5성 전직 카드팩.png` in the existing S3 asset store.

### Moon prompt

Use case: stylized-concept. Asset type: production game cinematic background for a Korean Chuseok full-screen web event. Create an exquisite cinematic fantasy matte painting, landscape 1536x1024. A single enormous perfectly round luminous harvest full moon, centered horizontally at x 50%, y 40%, diameter about 44% of image height. Highly detailed ivory lunar craters and warm champagne-gold rim glow, deep midnight indigo sky, delicate glittering stars, wisps of painterly blue and gold clouds around the lower corners, subtle distant Korean mountain silhouettes at bottom, elegant magical atmosphere. The moon is unobstructed and precisely circular for a clickable interactive overlay. Rich polished game key art, soft volumetric moonlight, beautiful restrained gold particles. Lower third very dark open negative space for greeting lettering to be layered separately. No text, no letters, no logos, no UI, no watermark.

### Greeting prompt

Use case: ads-marketing. Asset type: Korean Chuseok game title typography overlay texture on a fully transparent alpha background. Wide landscape 1536x1024 image. Only two lines of exquisitely hand-painted Korean calligraphic lettering in luminous warm ivory with subtle champagne-gold leaf edges, fine brush strokes, premium fantasy game title art, beautifully legible. Centered first line exactly: "즐거운 추석 보내세요". Centered second line exactly: "추석엔 RPGenius". Preserve exact case RPGenius and Korean spelling. First line in graceful sweeping Korean brush calligraphy, second line slightly smaller elegant gold brush lettering matching a luxury fantasy RPG. First line occupies vertical 28-48%, second line 58-74%, wide generous margins. A very small delicate golden flourish under the second line. No moon, no objects, no background scene, no dark rectangle, no additional words, no border, no UI, no watermark. Genuinely transparent background around the lettering.

### Reward prompt

Use case: product-mockup. Asset type: premium fantasy RPG reward card pack artwork for Korean Chuseok event. Portrait 1024x1536. One sealed ornate midnight indigo and champagne gold collectible card pack, centered, front three-quarter view, large taking 70% of image, highly polished three-dimensional metallic detailing, glowing ivory full moon emblem with clouds, EXACTLY FIVE small gold stars in a row near top of pack, delicate gold filigree edges. Dark pitch-black background with a few restrained magical golden sparkles and subtle warm halo, no floor, no environment, no hands. A luxurious legendary gift appearing out of moonlight. No lettering or numbers, no logos, no UI, no watermark.

### Inventory icon edit prompt

Use case: background-extraction. Image 1 is the EDIT TARGET: the previously generated ornate midnight indigo and gold Chuseok card pack with a full moon emblem and exactly five stars. Image 2 is a LAYOUT REFERENCE ONLY showing the existing inventory item scale and transparent margins. Extract the exact sealed pack from Image 1 onto a genuinely transparent alpha background. Preserve its precise gold decoration, blue material, full moon, five stars, silhouette and proportions. Remove the black background and all detached sparks, swirling trails, outer glow and floating leaves outside the physical sealed pack. Do NOT replace the design with Image 2. Produce a square transparent inventory icon 800x800. Place the pack small, centered in the reference occupied rectangle x=291..552, y=236..542 on the 800x800 canvas: same top and bottom margins as Image 2, about 306 pixels tall, fitting within 261 pixels wide while preserving its original aspect ratio. Large fully transparent empty space around the object is intentional. No floor shadow, no frame, no text, no new objects, no checkerboard painted into pixels, no opaque black or white background. Real RGBA transparency.

After generation, FFmpeg normalized the cutout to the existing icon dimensions: crop the visible object (403×675 at 427,277), scale proportionally to 183×306, then pad with transparent pixels to 800×800 at 330,236. The generated master is retained in the Codex generated image directory.

## External sound effects

- `moonrise-v2.mp3`: **Teleport Spell — Ogrebane**, [OpenGameArt source](https://opengameart.org/content/teleport-spell), [original teleport.wav](https://opengameart.org/sites/default/files/teleport.wav). [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/). Retrieved 2026-09-25.
- `reward-v2.mp3`: **Fantasy Magic Spell — Almitory**, [OpenGameArt source](https://opengameart.org/content/fantasy-magic-spell), [original fantasy_magic_button_1.mp3](https://opengameart.org/sites/default/files/fantasy_magic_button_1.mp3). [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/). Retrieved 2026-09-25. Author contact: https://bit.ly/contactclair.

Edited with FFmpeg to replace the earlier lightweight cues with lower tones and layered resonance:

- Moon gathering: 75% playback rate, 55 Hz high-pass / 3.8 kHz low-pass, +5 dB bass at 180 Hz, echoes at 83/167/311 ms, 180 ms fade-in and 500 ms fade-out. Duration 2.2 seconds, matched to the reward reveal delay.
- Reward reveal: 80% playback rate, 70 Hz high-pass / 6 kHz low-pass, echoes at 137/293/487 ms, a quiet octave-down layer below 350 Hz, 70 ms fade-in and 1.2 second fade-out. Duration 5.6 seconds.

Both files are normalized to -18 LUFS with a -2 dBTP ceiling, encoded as stereo 44.1 kHz MP3 with libmp3lame quality 2, and served locally. Versioned filenames avoid stale cached sound effects. Playback starts on the moon click at 30% gain; no external audio service or sound toggle is needed.
