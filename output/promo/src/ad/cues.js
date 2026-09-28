// Shared cue sheet (seconds). Read by scenes.js (visual sync) and music.py (soundtrack + SFX).
// 120 BPM, 4/4: beat = 0.5 s, bar = 2 s. Keep this file JSON-compatible after the '=' sign.
window.CUES = {
  "bpm": 120,
  "duration": 60,
  "sections": [
    { "name": "hook",      "start": 0,  "end": 4 },
    { "name": "logo",      "start": 4,  "end": 8 },
    { "name": "build",     "start": 8,  "end": 16 },
    { "name": "drop1",     "start": 16, "end": 32 },
    { "name": "breakdown", "start": 32, "end": 40 },
    { "name": "drop2",     "start": 40, "end": 52 },
    { "name": "outro",     "start": 52, "end": 60 }
  ],
  "impacts": [3.0, 5.5, 16.0, 40.0, 52.0, 58.0],
  "hits": [8.0, 10.5, 13.0, 20.0, 22.0, 26.0, 29.0, 32.0, 34.5, 37.0, 43.5, 46.5],
  "whooshes": [2.9, 4.55, 7.75, 10.3, 12.8, 19.8, 21.8, 25.8, 28.8, 31.8, 34.3, 36.8, 43.3, 46.3],
  "risers": [[6.0, 8.0, 0.35], [13.0, 15.75, 1.0], [36.0, 39.75, 0.9], [50.0, 51.9, 1.0]],
  "gaps": [[15.75, 16.0], [39.75, 40.0], [51.9, 52.0]],
  "typing": [],
  "pops": [0.95, 1.85],
  "glitch": [[2.55, 3.0]],
  "shimmer": [5.5, 52.25],
  "coin": [32.35],
  "sparkle": [12.45, 13.35],
  "battle": [],
  "stutter": [[50.0, 52.0]]
};
