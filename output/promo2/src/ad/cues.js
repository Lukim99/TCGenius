// Shared cue sheet for film #2 (seconds). scenes.js appends SFX cues; music2.py renders music + SFX from it.
// 128 BPM, 4/4: beat = 0.46875 s, bar = 1.875 s.
window.CUES = {
  "bpm": 128,
  "duration": 90,
  "sections": [
    { "name": "intro",   "start": 0,     "end": 7.5 },
    { "name": "build",   "start": 7.5,   "end": 15 },
    { "name": "drop1",   "start": 15,    "end": 37.5 },
    { "name": "groove",  "start": 37.5,  "end": 48.75 },
    { "name": "build2",  "start": 48.75, "end": 52.5 },
    { "name": "drop2",   "start": 52.5,  "end": 67.5 },
    { "name": "bridge",  "start": 67.5,  "end": 75 },
    { "name": "morning", "start": 75,    "end": 82.5 },
    { "name": "outro",   "start": 82.5,  "end": 90 }
  ],
  "sfx": []
};
