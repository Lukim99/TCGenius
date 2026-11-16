# Raid BGM assets

## Active user-provided audio

On 2026-10-04 the user supplied these MP3 files in `DB/RPGenius/ui/sfx`. The frontend serves them through the authenticated `/rpg-ui?file=...` route. They were uploaded to bucket `eefl-image` under `tcgenius/assets/ui/sfx/` and their stored bytes and `audio/mpeg` content type were verified. Existing server startup synchronization supplies them to other checkouts.

| File | Raid / gate | Measured duration |
| --- | --- | --- |
| `부타게임.mp3` | 부타게임 normal / hard | 3:39.73 |
| `E세계대저택 1관문.mp3` | All mansion difficulties, `phaseIndex: 0` | 3:23.17 |
| `E세계대저택 2관문.mp3` | All mansion difficulties, `phaseIndex: 1` | 3:49.69 |

`부타게임H.mp3` is for 헬필드, according to the user. It is excluded from the raid mapping and this migration. 흑화 호두 retains `boss fight.mp3`.

To inspect or repeat the explicit migration, run `node scripts/migrate_raid_bgm_to_s3.js` (read-only plan) or append `--apply`. Identical remote audio is skipped; replacements are backed up locally before conditional upload. This command does not run on startup or access the operational database.

## Original synthesized previews

The two sketches below remain available as previews; the game now uses the supplied audio above.

Composed and synthesized for RPGenius on 2026-10-04. No external recordings or samples are used. These are synthesized instrumental sketches, not output from an AI music-generation service.

| File | Raid | Musical direction | Duration |
| --- | --- | --- | --- |
| `buta-game-v1.mp3` | 부타게임 (normal / hard) | 132 BPM, D minor, playful electronic lead, plucked arpeggios, bass and drums | 58.18 s |
| `mansion-v1.mp3` | E세계대저택 (normal / hard / nightmare) | 108 BPM, E minor, ominous bells, synthesized strings, low drums | 71.11 s |

Each track has 32 bars with a motif, reply, contrasting section and return. Note releases and stereo echoes wrap across the loop boundary. Files are stereo MP3, 44.1 kHz / 192 kbps, normalized toward -18 LUFS with a -2 dBTP ceiling.

흑화 호두 (normal / extreme) retains the existing `boss fight.mp3` asset unchanged. Its provenance is separate from these two original pieces.

The score and synthesis source is `scripts/compose_raid_bgm.py`. To regenerate, run `python scripts/compose_raid_bgm.py` with NumPy and FFmpeg available. This is an explicit asset-generation command; it is not run on server startup or deployment and does not access the operational database.

## Earlier Suno selections

The user selected these original Suno V6-MINI instrumental candidates on 2026-10-04 for all E세계대저택 difficulties:

| Gate | Selected song | Duration |
| --- | --- | --- |
| 1관문 조각 (`phaseIndex: 0`) | [E세계대저택 — 깨어난 저택](https://suno.com/song/74962c93-b52a-4066-9ea6-06ffefa90318) | 3:23 |
| 2관문 위플래쉬 (`phaseIndex: 1`) | [E세계대저택 — 깨어난 저택](https://suno.com/song/172f4bd7-74fa-4a12-880f-2d83e10e300e) | 3:50 |

The user subsequently supplied the gate files listed above, replacing the synthesized mansion preview in the game's mapping.

부타게임's first Suno candidates (`부타게임 — 장난의 끝`) were requested to be revised: retain the electronic-rock pace and hooks while making the mood darker and more serious, with less playful arcade texture. New candidates are titled `부타게임 — 어둠의 승부`: [candidate 1](https://suno.com/song/030b9055-ba89-47d4-9daf-1071b1db9446), [candidate 2](https://suno.com/song/412b0bcd-65a5-47d9-b95b-2be0b2b02a10). The user later supplied `부타게임.mp3`; its source is not inferred from these candidate links.
