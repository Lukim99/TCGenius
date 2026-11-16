"""Render two original raid BGM sketches. Requires NumPy and FFmpeg; no game DB access."""
import math
from pathlib import Path
import subprocess
import tempfile
import wave

import numpy as np

RATE = 44100
OUTPUT = Path(__file__).resolve().parents[1] / 'public' / 'assets' / 'raid-bgm'


def compose(name, bpm, mansion=False):
    rng = np.random.default_rng(20261004 + int(mansion))
    beat = 60 / bpm
    length = round(32 * 4 * beat * RATE)
    mix = np.zeros((length, 2), dtype=np.float32)

    def add(signal, at, gain, pan=0):
        indices = (round(at * beat * RATE) + np.arange(len(signal))) % length
        angle = (pan + 1) * math.pi / 4
        for channel, level in enumerate((math.cos(angle), math.sin(angle))):
            np.add.at(mix[:, channel], indices, signal * gain * level)

    def note(pitch, at, duration, gain, voice='pluck', pan=0):
        seconds = duration * beat
        release = .35 if voice == 'strings' else .18
        t = np.arange(round((seconds + release) * RATE)) / RATE
        freq = 440 * 2 ** ((pitch - 69) / 12)
        phase = 2 * np.pi * freq * t
        attack = np.minimum(t / (.09 if voice == 'strings' else .009), 1)
        tail = np.clip((seconds + release - t) / release, 0, 1)
        if voice == 'bell':
            signal = np.sin(phase + 2.6 * np.exp(-t * 4) * np.sin(phase * 2.01))
            envelope = np.exp(-t * 2.3)
        elif voice == 'pluck':
            signal = np.sin(phase + 1.7 * np.exp(-t * 8) * np.sin(phase * 2))
            signal += .22 * np.sin(phase * 3) * np.exp(-t * 9)
            envelope = .55 * np.exp(-t * 7) + .45 * np.exp(-t * 1.8)
        elif voice == 'strings':
            signal = np.zeros_like(t)
            for harmonic in range(1, 7):
                for detune in (-.0025, .0025):
                    signal += np.sin(phase * harmonic * (1 + detune) + .012 * np.sin(2 * np.pi * 5 * t)) / (harmonic ** 1.6 * 2)
            envelope = np.ones_like(t) * .65
        elif voice == 'lead':
            signal = np.sin(phase + .55 * np.sin(phase * 2)) + .16 * np.sin(phase * 3)
            envelope = .75 + .25 * np.exp(-t * 12)
        else:
            signal = np.sin(phase) + .25 * np.sin(phase * 2) + .12 * np.sin(phase * 3)
            envelope = np.exp(-t * 2)
        add((signal * attack * tail * envelope).astype(np.float32), at, gain, pan)

    def drum(kind, at, gain):
        seconds = {'kick': .42, 'snare': .24, 'hat': .09, 'boom': 1.1}[kind]
        t = np.arange(round(seconds * RATE)) / RATE
        noise = rng.normal(0, 1, len(t))
        if kind == 'kick':
            signal = np.sin(2 * np.pi * (48 * t + 70 * .025 * (1 - np.exp(-t / .025)))) * np.exp(-t * 11)
            signal += .08 * noise * np.exp(-t * 100)
        elif kind == 'snare':
            signal = (.55 * noise + .3 * np.sin(2 * np.pi * 180 * t)) * np.exp(-t * 20)
        elif kind == 'hat':
            high = noise - np.roll(noise, 1)
            signal = high * np.exp(-t * 65) * .22
        else:
            signal = np.sin(2 * np.pi * (42 * t + 32 * .06 * (1 - np.exp(-t / .06)))) * np.exp(-t * 5)
            signal += .18 * noise * np.exp(-t * 13)
        signal *= np.minimum(t / .002, 1) * np.clip((seconds - t) / .012, 0, 1)
        add(signal.astype(np.float32), at, gain, -.15 if kind == 'hat' else 0)

    # Four eight-bar sections: motif, reply, contrasting harmony, and return.
    roots = ([40, 40, 36, 38, 40, 43, 36, 35] if mansion else [38, 38, 34, 36, 38, 41, 34, 33])
    chords = ([0, 3, 7], [0, 3, 7], [0, 4, 7], [0, 4, 7],
              [0, 3, 7], [0, 4, 7], [0, 4, 7], [0, 4, 7])
    buta_motifs = [
        [74, 77, 81, 79, 77, 74, 72, 77],
        [74, 77, 81, 84, 81, 79, 77, 76],
        [70, 74, 77, 81, 79, 77, 74, 72],
        [72, 76, 79, 82, 81, 79, 76, 73],
    ]
    mansion_motifs = [
        [76, 79, 78, 76, 71, 74],
        [76, 83, 81, 79, 78, 75],
        [72, 76, 79, 78, 76, 74],
        [74, 78, 81, 79, 78, 75],
    ]
    for bar in range(32):
        at = bar * 4
        section = bar // 8
        root = roots[bar % 8]
        chord = chords[bar % 8]
        if section == 2:
            root += 5 if bar % 8 < 4 else 0
        for i, interval in enumerate(chord):
            note(root + 12 + interval, at, 3.85, .045 if mansion else .027, 'strings', (i - 1) * .55)
        for step in range(8):
            bass_pitch = root + (12 if step % 4 == 3 else 0)
            note(bass_pitch, at + step / 2, .4, .16 if mansion else .19, 'bass')
            arp = root + 24 + chord[step % 3] + (12 if step % 4 == 3 else 0)
            note(arp, at + step / 2, .32, .036 if mansion else .065, 'bell' if mansion else 'pluck', -.45)
        motif = (mansion_motifs if mansion else buta_motifs)[(bar % 8) // 2]
        if mansion:
            rhythm = [0, .75, 1.5, 2, 2.75, 3.5]
            for i, pitch in enumerate(motif):
                note(pitch + (12 if section == 3 and bar % 2 else 0), at + rhythm[i], .62, .09, 'bell', .25)
            for offset in (0, 2.5):
                drum('boom', at + offset, .24 if offset else .32)
            for offset in (1, 3):
                drum('snare', at + offset, .075)
        else:
            for i, pitch in enumerate(motif):
                note(pitch + (12 if section == 3 else 0), at + i / 2, .38, .09, 'lead' if section in (1, 3) else 'pluck', .2)
            for offset in (0, 1.5, 2, 3.5):
                drum('kick', at + offset, .35)
            for offset in (1, 3):
                drum('snare', at + offset, .18)
        for step in range(8):
            drum('hat', at + step / 2, .10 if mansion else .14)
        if bar % 8 == 7:
            for step in range(4):
                drum('snare', at + 3 + step / 4, .08 + step * .025)

    # Circular stereo echoes carry the release across the loop boundary.
    dry = mix.copy()
    for delay, gain in ((beat * .75, .14), (beat * 1.5, .085), (.047, .08)):
        mix += np.roll(dry[:, ::-1], round(delay * RATE), axis=0) * gain
    mix = np.tanh(mix * 1.2)
    mix *= .88 / max(float(np.abs(mix).max()), .001)
    OUTPUT.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='raid-bgm-') as temp:
        wav = Path(temp) / (name + '.wav')
        with wave.open(str(wav), 'wb') as audio:
            audio.setnchannels(2)
            audio.setsampwidth(2)
            audio.setframerate(RATE)
            audio.writeframes((mix * 32767).astype('<i2').tobytes())
        subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', str(wav),
                        '-af', 'loudnorm=I=-18:TP=-2:LRA=8', '-ar', str(RATE),
                        '-c:a', 'libmp3lame', '-b:a', '192k', str(OUTPUT / (name + '.mp3'))], check=True)
    print(f'{name}: {length / RATE:.2f}s, {bpm} BPM')


if __name__ == '__main__':
    compose('buta-game-v1', 132)
    compose('mansion-v1', 108, mansion=True)
