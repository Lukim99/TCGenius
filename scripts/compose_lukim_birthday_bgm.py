"""Arrange the birthday tune for phase 1. Render sampled instruments, never game data."""
import argparse
import json
import math
from pathlib import Path
import re
import struct
import subprocess
import tempfile
import wave

import numpy as np

BPM, PPQ, RATE, BARS = 76, 480, 44100, 48
BEATS = BARS * 3
ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'output' / 'lukim-birthday' / 'bgm'
NAME = 'lukim-birthday-phase1-v1'

# Complete original tune in C major, including its dotted pickup rhythm.
MELODY = [
    [(67, .75), (67, .25), (69, 1), (67, 1), (72, 1), (71, 2)],
    [(67, .75), (67, .25), (69, 1), (67, 1), (74, 1), (72, 2)],
    [(67, .75), (67, .25), (79, 1), (76, 1), (72, 1), (71, 1), (69, 1)],
    [(77, .75), (77, .25), (76, 1), (72, 1), (74, 1), (72, 2)],
]
CHORDS = [
    (48, [52, 55, 60]), (43, [53, 59, 62]),
    (43, [53, 59, 62]), (48, [52, 55, 60]),
    (48, [52, 58, 60]), (41, [53, 57, 60]),
    (43, [52, 55, 60]), (48, [52, 55, 60]),
]
BRIDGES = {
    16: (41, [53, 57, 60, 64]), 17: (40, [52, 55, 59, 62]),
    18: (38, [53, 57, 60, 62]), 19: (43, [53, 59, 62]),
    28: (38, [53, 57, 60, 62]), 29: (40, [52, 55, 60]),
    30: (41, [53, 57, 60]), 31: (43, [53, 59, 62]),
}


def arrangement():
    notes, pedals = [], []

    def note(channel, pitch, beat, duration, velocity):
        notes.append((channel, pitch, beat, duration, velocity))

    for section, start_bar in enumerate((0, 8, 20, 32, 40)):
        at = start_bar * 3
        for phrase, melody in enumerate(MELODY):
            for i, (pitch, duration) in enumerate(melody):
                velocity = (64 if i < 2 else 72) + (0, -3, 1, -1, -4)[section]
                velocity += (0, -3, 1, -1, 2, -2, -1)[i]
                gate = duration * (.88 if duration < 1 else .94)
                note(0, pitch, at, gate, velocity)
                # Celesta joins selected phrases quietly, keeping the piano melody dominant.
                if (section == 2 and phrase in (1, 3)) or (section == 4 and phrase == 3):
                    note(2, pitch, at + .018, duration * .7, 32 if i < 2 else 39)
                at += duration

    for bar in range(BARS):
        at = 1 + bar * 3  # The first beat of the file is the melody's pickup.
        index = bar % 8 if bar < 16 else (bar - 20) % 8 if bar < 28 else (bar - 32) % 8
        bass, chord = BRIDGES.get(bar, CHORDS[index])
        quiet = bar < 8 or bar >= 40
        note(1, bass, at, 1.45, 42 if quiet else 46)
        # Soft left-hand waltz, with a slightly rolled, lower-register response.
        for i, pitch in enumerate(chord):
            note(1, pitch, at + .94 + i * .018, 1.65 - i * .02, 36 if quiet else 40)
        note(1, chord[-1], at + 2.03, .66, 33 if quiet else 37)
        pedals += [(at - .02, 0), (at + .06, 127)]
        if bar >= 8:
            for pitch in chord[:3]:
                note(3, pitch, at + .10, 2.86, 28 if quiet else 32)
        if bar in BRIDGES:
            # A short breathing space, not a competing second melody.
            note(2, chord[-1] + 12, at + .05, 2.4, 34)
            note(1, chord[1] + 12, at + 1.6, .78, 33)
    return notes, pedals


def vlq(number):
    data = [number & 127]
    while number >> 7:
        number >>= 7
        data.insert(0, 128 | (number & 127))
    return bytes(data)


def write_midi(path, cycles):
    notes, pedals = arrangement()
    title = 'Lukim Birthday Party - Phase 1'.encode()
    events = [(0, b'\xff\x03' + vlq(len(title)) + title),
              (0, b'\xff\x51\x03' + round(60_000_000 / BPM).to_bytes(3, 'big')),
              (0, b'\xff\x58\x04\x03\x02\x18\x08')]
    for channel, program, volume, pan in [(0, 0, 98, 65), (1, 0, 78, 54),
                                          (2, 8, 58, 78), (3, 48, 36, 62)]:
        events += [(0, bytes([0xC0 + channel, program])),
                   (0, bytes([0xB0 + channel, 7, volume])),
                   (0, bytes([0xB0 + channel, 10, pan]))]
    for cycle in range(cycles):
        offset = cycle * BEATS
        for channel, pitch, at, duration, velocity in notes:
            start = round((offset + at) * PPQ)
            end = round((offset + at + duration) * PPQ)
            events += [(start, bytes([0x90 + channel, pitch, velocity])),
                       (end, bytes([0x80 + channel, pitch, 0]))]
        for at, value in pedals:
            events.append((round((offset + at) * PPQ), bytes([0xB1, 64, value])))
    end = round((cycles * BEATS + 4) * PPQ)
    for channel in range(4):
        events.append((end, bytes([0xB0 + channel, 64, 0])))
        events.append((end, bytes([0xB0 + channel, 123, 0])))
    events.append((end + PPQ * 2, b'\xff\x2f\x00'))
    events.sort(key=lambda event: (event[0], event[1]))
    track, previous = bytearray(), 0
    for tick, data in events:
        track += vlq(tick - previous) + data
        previous = tick
    path.write_bytes(b'MThd' + struct.pack('>IHHH', 6, 0, 1, PPQ)
                     + b'MTrk' + struct.pack('>I', len(track)) + track)


def write_wave(path, samples):
    with wave.open(str(path), 'wb') as audio:
        audio.setnchannels(2)
        audio.setsampwidth(2)
        audio.setframerate(RATE)
        audio.writeframes(np.clip(samples * 32767, -32768, 32767).astype('<i2').tobytes())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--soundfont', type=Path, required=True)
    parser.add_argument('--fluidsynth', type=Path, required=True)
    parser.add_argument('--ffmpeg', default='ffmpeg')
    args = parser.parse_args()
    OUTPUT.mkdir(parents=True, exist_ok=True)
    write_midi(OUTPUT / (NAME + '.mid'), 1)
    with tempfile.TemporaryDirectory(prefix='birthday-render-') as temp:
        temp = Path(temp)
        midi, raw = temp / 'performance.mid', temp / 'performance.wav'
        write_midi(midi, 3)
        subprocess.run([str(args.fluidsynth), '-n', '-i', '-q', '-C', '0', '-R', '1',
                        '-g', '.55', '-r', str(RATE), '-T', 'wav', '-O', 's16',
                        '-o', 'synth.reverb.room-size=0.55', '-o', 'synth.reverb.damp=0.65',
                        '-o', 'synth.reverb.level=0.23', '-o', 'synth.reverb.width=60',
                        '-F', str(raw), str(args.soundfont), str(midi)], check=True)
        with wave.open(str(raw), 'rb') as audio:
            samples = np.frombuffer(audio.readframes(audio.getnframes()), dtype='<i2').reshape(-1, 2).astype(np.float32) / 32768
        # Take the middle performance, with preceding sustain and reverberation already present.
        length = round(BEATS * 60 / BPM * RATE)
        samples = samples[length:2 * length].copy()
        # Close only the first/last 8ms, avoiding a click from MIDI renderer block timing.
        edge = round(RATE * .008)
        ramp = np.sin(np.linspace(0, math.pi / 2, edge)) ** 2
        samples[:edge] *= ramp[:, None]
        samples[-edge:] *= ramp[::-1, None]
        draft = temp / 'loop.wav'
        write_wave(draft, samples)
        analysis = subprocess.run([args.ffmpeg, '-hide_banner', '-i', str(draft), '-af',
                                   'loudnorm=I=-21:TP=-3:LRA=10:print_format=json', '-f', 'null', '-'],
                                  capture_output=True, text=True, check=True)
        levels = json.loads(re.search(r'\{\s*"input_i".*?\}', analysis.stderr, re.S).group())
        gain_db = min(-21 - float(levels['input_i']), -3 - float(levels['input_tp']))
        samples *= 10 ** (gain_db / 20)
        master = OUTPUT / (NAME + '.wav')
        write_wave(master, samples)
        for extension, codec in [('mp3', ['-c:a', 'libmp3lame', '-b:a', '192k']),
                                 ('ogg', ['-c:a', 'libvorbis', '-q:a', '6'])]:
            subprocess.run([args.ffmpeg, '-hide_banner', '-loglevel', 'error', '-y',
                            '-i', str(master), '-metadata', 'title=루킴의 생일파티 1페이즈',
                            '-metadata', 'comment=Direct piano arrangement of Happy Birthday; 76 BPM; 3/4',
                            *codec, str(OUTPUT / (NAME + '.' + extension))], check=True)
        manifest = {'bpm': BPM, 'time_signature': '3/4', 'bars': BARS, 'seconds': length / RATE,
                    'sample_rate': RATE, 'channels': 2, 'melody_notes': sum(map(len, MELODY)),
                    'input_lufs': levels['input_i'], 'gain_db': round(gain_db, 3),
                    'estimated_lufs': round(float(levels['input_i']) + gain_db, 2),
                    'peak_dbfs': round(20 * math.log10(float(np.max(np.abs(samples)))), 2),
                    'boundary_jump': float(np.max(np.abs(samples[-1] - samples[0]))),
                    'soundfont': 'GeneralUser GS 2.0.3'}
        (OUTPUT / (NAME + '.json')).write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf8')
        print(json.dumps(manifest, ensure_ascii=False))


if __name__ == '__main__':
    main()
