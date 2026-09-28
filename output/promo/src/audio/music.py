#!/usr/bin/env python3
"""Original 60 s soundtrack + SFX for the RPGenius web film, synthesized from scratch with numpy.

Epic electronic trailer cue, 120 BPM, D minor (i-VI-III-VII: Dm Bb F C).
Every hit, whoosh, riser and typing click is placed from the shared cue sheet (cues.json),
so the audio lands on the same frames as the visuals.
Usage: python3 music.py cues.json out.wav
"""
import json
import sys

import numpy as np
from scipy.signal import butter, sosfilt, fftconvolve

SR = 48000
BPM = 120
BEAT = 60 / BPM
BAR = BEAT * 4
rng = np.random.default_rng(2026)


def secs(n):
    return int(round(n * SR))


def note_hz(name):
    names = {'C': -9, 'C#': -8, 'Db': -8, 'D': -7, 'D#': -6, 'Eb': -6, 'E': -5, 'F': -4, 'F#': -3, 'Gb': -3,
             'G': -2, 'G#': -1, 'Ab': -1, 'A': 0, 'A#': 1, 'Bb': 1, 'B': 2}
    pitch, octave = name[:-1], int(name[-1])
    return 440.0 * 2 ** ((names[pitch] + (octave - 4) * 12) / 12)


# ---------------------------------------------------------------- filters / fx
def bp(x, lo, hi, order=2):
    return sosfilt(butter(order, [lo, hi], btype='band', fs=SR, output='sos'), x)


def lp(x, cut, order=2):
    return sosfilt(butter(order, cut, btype='low', fs=SR, output='sos'), x)


def hp(x, cut, order=2):
    return sosfilt(butter(order, cut, btype='high', fs=SR, output='sos'), x)


def env_adsr(n, a=0.005, d=0.1, s=0.6, r=0.2, gate=None):
    gate = n / SR if gate is None else gate
    t = np.arange(n) / SR
    e = np.where(t < a, t / max(a, 1e-6), 1.0)
    e = np.where((t >= a) & (t < a + d), 1 - (1 - s) * (t - a) / max(d, 1e-6), e)
    e = np.where((t >= a + d) & (t < gate), s, e)
    e = np.where(t >= gate, s * np.exp(-(t - gate) / max(r, 1e-6)), e)
    return e


def saw(freq, n, phase=0.0):
    t = np.arange(n) / SR
    p = (freq * t + phase) % 1.0
    return 2 * p - 1


def supersaw(freq, n, voices=7, detune=0.018, seed=0):
    r = np.random.default_rng(seed)
    out = np.zeros(n)
    for v in range(voices):
        d = (v - (voices - 1) / 2) / ((voices - 1) / 2) * detune
        out += saw(freq * (1 + d), n, r.random())
    return out / voices


def make_ir(seconds=2.6, decay=3.2, seed=5, bright=6500):
    n = secs(seconds)
    r = np.random.default_rng(seed)
    t = np.arange(n) / SR
    irs = []
    for ch in range(2):
        noise = r.standard_normal(n) * np.exp(-t * decay)
        noise = lp(noise, bright)
        noise[:secs(0.012)] *= np.linspace(0, 1, secs(0.012))
        irs.append(noise / np.sqrt(np.sum(noise ** 2)))
    return irs


IR_BIG = make_ir(3.2, 2.2, 5, 7000)
IR_MID = make_ir(1.6, 4.5, 9, 6000)


def reverb(stereo, ir=IR_MID, wet=0.25):
    out = np.zeros_like(stereo)
    for ch in range(2):
        out[ch] = fftconvolve(stereo[ch], ir[ch], mode='full')[:stereo.shape[1]]
    return stereo * (1 - wet) + out * wet * 3.0


def pan(mono, p=0.0):
    l = np.cos((p + 1) * np.pi / 4)
    r = np.sin((p + 1) * np.pi / 4)
    return np.stack([mono * l, mono * r])


def add(buf, sig, t0, gain=1.0):
    i0 = secs(t0)
    if i0 >= buf.shape[-1]:
        return
    if sig.ndim == 1:
        sig = np.stack([sig, sig])
    n = min(sig.shape[1], buf.shape[1] - max(i0, 0))
    if i0 < 0:
        sig = sig[:, -i0:]
        i0 = 0
        n = min(sig.shape[1], buf.shape[1])
    buf[:, i0:i0 + n] += sig[:, :n] * gain


def delay(stereo, time=BEAT * 0.75, fb=0.35, mix=0.3):
    d = secs(time)
    out = stereo.copy()
    tap = stereo.copy()
    for k in range(1, 6):
        shifted = np.zeros_like(stereo)
        shifted[:, d * k:] = tap[:, :-d * k] if d * k < stereo.shape[1] else 0
        g = mix * fb ** (k - 1)
        # ping-pong
        if k % 2:
            out[0] += shifted[1] * g
            out[1] += shifted[0] * g
        else:
            out += shifted * g
    return out


# ---------------------------------------------------------------- instruments
def kick(level=1.0, length=0.42):
    n = secs(length)
    t = np.arange(n) / SR
    f = 44 + 115 * np.exp(-t * 32)
    ph = 2 * np.pi * np.cumsum(f) / SR
    body = np.sin(ph) * np.exp(-t * 7.5)
    click = hp(rng.standard_normal(n), 2500) * np.exp(-t * 300) * 0.35
    k = np.tanh((body + click) * 1.6) * level
    return k


def snare(level=1.0, length=0.35, tone=190):
    n = secs(length)
    t = np.arange(n) / SR
    noise = bp(rng.standard_normal(n), 1200, 7500) * np.exp(-t * 18)
    body = np.sin(2 * np.pi * tone * t) * np.exp(-t * 28) * 0.7
    return np.tanh((noise * 0.9 + body) * 1.2) * level


def clap(level=1.0):
    n = secs(0.45)
    t = np.arange(n) / SR
    base = bp(rng.standard_normal(n), 900, 6000)
    e = np.zeros(n)
    for off in (0, 0.011, 0.022, 0.034):
        e += np.where(t >= off, np.exp(-(t - off) * 55), 0)
    tail = np.exp(-t * 11) * 0.5
    return np.tanh(base * (e * 0.8 + tail) * 1.4) * level


def hat(level=0.3, open_=False):
    n = secs(0.32 if open_ else 0.07)
    t = np.arange(n) / SR
    x = hp(rng.standard_normal(n), 7500, 4) * np.exp(-t * (9 if open_ else 70))
    return x * level


def crash(level=0.5, length=2.8):
    n = secs(length)
    t = np.arange(n) / SR
    x = hp(rng.standard_normal(n), 4200, 2) * np.exp(-t * 1.6)
    return pan(x * level, 0) + pan(hp(rng.standard_normal(n), 5000, 2) * np.exp(-t * 1.9) * level * 0.6, 0.5)


def sub_bass(freq, length, level=0.8, drive=1.8):
    n = secs(length)
    t = np.arange(n) / SR
    x = np.sin(2 * np.pi * freq * t) + 0.25 * np.sin(2 * np.pi * freq * 2 * t)
    e = env_adsr(n, 0.004, 0.08, 0.85, 0.06, gate=length - 0.06)
    return np.tanh(x * drive) / np.tanh(drive) * e * level


def reese(freq, length, level=0.5, cutoff=900):
    n = secs(length)
    x = supersaw(freq, n, 5, 0.012, seed=int(freq))
    x = lp(x, cutoff, 2)
    e = env_adsr(n, 0.01, 0.1, 0.8, 0.08, gate=length - 0.08)
    return x * e * level


def pad_chord(freqs, length, level=0.25, cutoff=2400, attack=0.4, release=0.6, seed=1):
    n = secs(length + release)
    x = np.zeros(n)
    for i, f in enumerate(freqs):
        x += supersaw(f, n, 7, 0.02, seed=seed + i)
    x = lp(x / len(freqs), cutoff, 2)
    e = env_adsr(n, attack, 0.5, 0.8, release, gate=length)
    left = x * e * level
    right = np.roll(left, secs(0.011))
    return np.stack([left, right])


def pluck(freq, level=0.3, length=0.35, bright=5200):
    n = secs(length)
    t = np.arange(n) / SR
    x = supersaw(freq, n, 3, 0.008, seed=int(freq * 3)) * 0.7 + np.sign(np.sin(2 * np.pi * freq * t)) * 0.3
    cutoff = bright
    x = lp(x, cutoff, 2) * np.exp(-t * 9)
    return x * level


def stab(freqs, level=0.6, length=0.9):
    n = secs(length)
    t = np.arange(n) / SR
    x = np.zeros(n)
    for i, f in enumerate(freqs):
        x += supersaw(f, n, 7, 0.024, seed=40 + i)
    x /= len(freqs)
    # filter envelope: bright attack closing down
    sweep = np.zeros(n)
    chunks = 32
    for c in range(chunks):
        a, b = c * n // chunks, (c + 1) * n // chunks
        cut = 800 + 7000 * np.exp(-(a / SR) * 6)
        sweep[a:b] = lp(x[a:b], cut, 1)
    e = np.exp(-t * 3.2) * np.minimum(1, t / 0.004)
    return np.stack([sweep * e * level, np.roll(sweep * e * level, secs(0.013))])


# ---------------------------------------------------------------- fx
def boom(level=1.0, length=2.6):
    n = secs(length)
    t = np.arange(n) / SR
    f = 30 + 70 * np.exp(-t * 6)
    sub = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 1.8)
    noise = lp(rng.standard_normal(n), 900) * np.exp(-t * 5) * 0.6
    crack = hp(rng.standard_normal(n), 2000) * np.exp(-t * 40) * 0.5
    x = np.tanh((sub * 1.4 + noise + crack) * 1.3) * level
    return reverb(pan(x), IR_BIG, 0.28)


def whoosh(level=0.5, length=0.55, up=False):
    n = secs(length)
    t = np.arange(n) / SR
    x = rng.standard_normal(n)
    out = np.zeros(n)
    chunks = 40
    for c in range(chunks):
        a, b = c * n // chunks, (c + 1) * n // chunks
        p = c / chunks
        center = (300 + 5500 * p) if up else (5500 - 5000 * p)
        out[a:b] = bp(x[a:b], max(80, center * 0.6), min(15000, center * 1.6), 1)
    e = np.sin(np.pi * np.clip(t / length, 0, 1)) ** 1.5
    l = out * e * level
    return np.stack([l, np.roll(l, secs(0.007))])


def riser(length, level=0.5):
    n = secs(length)
    t = np.arange(n) / SR
    p = t / length
    noise = rng.standard_normal(n)
    out = np.zeros(n)
    chunks = 60
    for c in range(chunks):
        a, b = c * n // chunks, (c + 1) * n // chunks
        q = c / chunks
        center = 400 * (1 + 20 * q ** 2)
        out[a:b] = bp(noise[a:b], center * 0.5, min(18000, center * 1.8), 1)
    f = 110 * 2 ** (p * 3)
    tone = np.sin(2 * np.pi * np.cumsum(f) / SR) * 0.25 + saw(1, n) * 0
    e = p ** 2.2
    x = (out * 0.8 + tone) * e * level
    return reverb(pan(x), IR_MID, 0.2)


def reverse_cymbal(length=0.8, level=0.45):
    n = secs(length)
    t = np.arange(n) / SR
    x = hp(rng.standard_normal(n), 3000) * np.exp(-(length - t) * 5)
    return pan(x * level)


def click(level=0.18):
    n = secs(0.03)
    t = np.arange(n) / SR
    x = bp(rng.standard_normal(n), 1800, 9000) * np.exp(-t * 400) + np.sin(2 * np.pi * 2600 * t) * np.exp(-t * 500) * 0.4
    return x * level


def pop(level=0.3):
    n = secs(0.18)
    t = np.arange(n) / SR
    f = 700 + 900 * np.exp(-t * 40)
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 26)
    return x * level


def shimmer(level=0.35, length=3.0):
    n = secs(length)
    t = np.arange(n) / SR
    x = np.zeros(n)
    for i, f in enumerate([note_hz(nn) for nn in ('A5', 'D6', 'F6', 'A6', 'E7', 'D7')]):
        x += np.sin(2 * np.pi * f * t + i) * (0.5 + 0.5 * np.sin(2 * np.pi * (5 + i) * t)) * np.exp(-t * (1.4 + i * 0.25))
    x *= np.minimum(1, t / 0.02)
    return reverb(pan(x * level / 3, 0.2), IR_BIG, 0.45)


def sparkle(level=0.35):
    n = secs(1.6)
    t = np.arange(n) / SR
    x = np.zeros(n)
    for i, nn in enumerate(('D6', 'F6', 'A6', 'D7', 'F7')):
        t0 = i * 0.045
        tt = np.clip(t - t0, 0, None)
        x += np.sin(2 * np.pi * note_hz(nn) * tt) * np.exp(-tt * 5.5) * (t >= t0)
    x *= np.minimum(1, t / 0.004)
    return reverb(pan(x * level / 2.5, -0.15), IR_BIG, 0.4)


def coin(level=0.35):
    n = secs(0.6)
    t = np.arange(n) / SR
    a = np.sin(2 * np.pi * note_hz('B6') * t) * np.exp(-t * 18) * (t < 0.07)
    b = np.sin(2 * np.pi * note_hz('E7') * t) * np.exp(-np.maximum(t - 0.07, 0) * 7) * (t >= 0.07)
    return reverb(pan((a + b) * level, 0.25), IR_MID, 0.3)


def slash(level=0.5):
    n = secs(0.35)
    t = np.arange(n) / SR
    noise = rng.standard_normal(n)
    out = np.zeros(n)
    for c in range(20):
        a, b = c * n // 20, (c + 1) * n // 20
        center = 7000 - 5500 * c / 20
        out[a:b] = bp(noise[a:b], center * 0.6, min(16000, center * 1.5), 1)
    ring = sum(np.sin(2 * np.pi * f * t) * np.exp(-t * d) for f, d in ((1840, 14), (2710, 18), (3990, 22))) * 0.15
    thump = np.sin(2 * np.pi * (60 + 90 * np.exp(-t * 30)) * t) * np.exp(-t * 16) * 0.8
    return np.tanh((out * np.exp(-t * 10) + ring + thump) * 1.3) * level


def glitch(length, level=0.3):
    n = secs(length)
    t = np.arange(n) / SR
    x = np.zeros(n)
    step = secs(0.035)
    for i in range(0, n, step):
        f = rng.choice([220, 330, 440, 880, 1320, 1760])
        seg = min(step, n - i)
        tt = np.arange(seg) / SR
        x[i:i + seg] = np.sign(np.sin(2 * np.pi * f * tt)) * (0.3 + 0.7 * rng.random()) * (rng.random() > 0.35)
    x = lp(x, 6000) * (t / length) ** 1.5
    return x * level


# ---------------------------------------------------------------- composition
CHORDS = {  # voicings (pad) + root (bass)
    'Dm': (['D3', 'A3', 'D4', 'F4', 'A4'], 'D2'),
    'Bb': (['Bb2', 'F3', 'Bb3', 'D4', 'F4'], 'Bb1'),
    'F': (['F3', 'A3', 'C4', 'F4', 'A4'], 'F2'),
    'C': (['C3', 'G3', 'C4', 'E4', 'G4'], 'C2'),
}
PROG = ['Dm', 'Bb', 'F', 'C']
ARP = {
    'Dm': ['D5', 'A4', 'F5', 'A4', 'D5', 'A5', 'F5', 'A4'],
    'Bb': ['D5', 'Bb4', 'F5', 'Bb4', 'D5', 'Bb5', 'F5', 'Bb4'],
    'F': ['C5', 'A4', 'F5', 'A4', 'C5', 'A5', 'F5', 'A4'],
    'C': ['E5', 'C5', 'G5', 'C5', 'E5', 'C6', 'G5', 'C5'],
}
# drop-2 lead (8 bars, one chord per bar): (beat offset, note, length in beats)
LEAD = [
    [(0, 'D5', 1), (1, 'F5', 0.5), (1.5, 'A5', 1.5), (3, 'G5', 1)],
    [(0, 'F5', 1), (1, 'D5', 0.5), (1.5, 'F5', 1), (2.5, 'Bb5', 1.5)],
    [(0, 'A5', 1.5), (1.5, 'C6', 0.5), (2, 'A5', 1), (3, 'F5', 1)],
    [(0, 'G5', 1), (1, 'E5', 1), (2, 'C5', 1), (3, 'E5', 1)],
    [(0, 'D5', 1), (1, 'F5', 0.5), (1.5, 'A5', 1.5), (3, 'D6', 1)],
    [(0, 'C6', 1), (1, 'Bb5', 0.5), (1.5, 'A5', 1), (2.5, 'F5', 1.5)],
    [(0, 'A5', 1), (1, 'C6', 1), (2, 'F6', 1.5), (3.5, 'E6', 0.5)],
    [(0, 'E6', 2), (2, 'D6', 1), (3, 'C6', 1)],
]
BREAK_MELODY = [  # breakdown pluck melody (4 bars)
    [(0, 'A5', 0.5), (0.5, 'F5', 0.5), (1, 'D5', 1), (2.5, 'E5', 0.5), (3, 'F5', 1)],
    [(0, 'F5', 0.5), (0.5, 'D5', 0.5), (1, 'Bb4', 1), (2.5, 'C5', 0.5), (3, 'D5', 1)],
    [(0, 'C5', 0.5), (0.5, 'F5', 0.5), (1, 'A5', 1), (2.5, 'G5', 0.5), (3, 'F5', 1)],
    [(0, 'E5', 0.5), (0.5, 'G5', 0.5), (1, 'C6', 1.5), (3, 'G5', 1)],
]


def in_gap(t, gaps):
    return any(a <= t < b for a, b in gaps)


def build(cues):
    total = cues['duration']
    n = secs(total + 0.5)
    drums = np.zeros((2, n))
    bass = np.zeros((2, n))
    music = np.zeros((2, n))
    fx = np.zeros((2, n))
    gaps = [tuple(g) for g in cues['gaps']]
    kicks = []

    def section(t):
        for s in cues['sections']:
            if s['start'] <= t < s['end']:
                return s['name']
        return 'outro'

    # ---- drums & groove, 16th grid
    steps = int(total / (BEAT / 4))
    for i in range(steps):
        t = i * BEAT / 4
        if in_gap(t, gaps):
            continue
        sec = section(t)
        beat_i, sub = divmod(i, 4)
        bar_pos = beat_i % 4
        if sec in ('drop1', 'drop2'):
            if sub == 0:
                add(drums, kick(1.0), t)
                kicks.append(t)
            if sub == 0 and bar_pos in (1, 3):
                add(drums, pan(clap(0.62), 0), t)
                add(drums, pan(snare(0.35), 0), t)
            if sub == 2:
                add(drums, pan(hat(0.16, True), 0.2), t)
            add(drums, pan(hat(0.11 if sub % 2 else 0.07), -0.3 if sub % 2 else 0.3), t)
        elif sec == 'build':
            if sub == 0:
                add(drums, kick(0.92), t)
                kicks.append(t)
            if sub == 2:
                add(drums, pan(hat(0.12, True), 0.2), t)
            if t >= 12 and sub % 2 == 1:
                add(drums, pan(hat(0.06), -0.3), t)
        elif sec == 'breakdown':
            if t < 36:
                if sub == 0 and bar_pos == 0:
                    add(drums, kick(0.85), t)
                    kicks.append(t)
                if sub == 0 and bar_pos == 2:
                    add(drums, pan(clap(0.45), 0), t)
                if sub == 2:
                    add(drums, pan(hat(0.06), 0.3), t)
            else:
                if sub == 0:
                    add(drums, kick(0.8), t)
                    kicks.append(t)
        elif sec == 'hook':
            if t >= 0.3 and t < 2.6 and sub % 2 == 0:
                add(drums, pan(hat(0.035), 0.4 if sub == 0 else -0.4), t)
            if t >= 3.0 and sub == 0 and bar_pos in (0, 2):
                add(drums, kick(0.7), t)
                kicks.append(t)
        elif sec == 'logo':
            if t >= 5.5 and sub == 0:
                add(drums, kick(0.75 if bar_pos % 2 == 0 else 0.55), t)
                kicks.append(t)
            if t >= 6.0 and sub == 2:
                add(drums, pan(hat(0.08, True), 0.2), t)
        elif sec == 'outro':
            if t in (54.0, 56.0, 56.5):
                add(drums, kick(0.6), t)
                kicks.append(t)

    # snare rolls into drops (accelerating)
    for (a, b) in ((14.0, 15.75), (38.0, 39.75), (50.0, 51.9)):
        t = a
        while t < b:
            p = (t - a) / (b - a)
            div = 2 if p < 0.35 else (4 if p < 0.7 else 8)
            add(drums, pan(snare(0.18 + 0.5 * p, 0.2), 0.1 * np.sin(t * 7)), t)
            t += BEAT / div
    # breakdown-end fill + drop1 end fill
    for t in np.arange(31.0, 32.0, BEAT / 4):
        add(drums, pan(snare(0.22 + 0.25 * (t - 31), 0.18), 0), float(t))

    # ---- harmony
    def chord_at(t):
        return PROG[int(t // BAR) % 4]

    for bar_i in range(int(total / BAR)):
        t = bar_i * BAR
        sec = section(t)
        name = chord_at(t)
        voicing, root = CHORDS[name]
        freqs = [note_hz(v) for v in voicing]
        if sec == 'hook':
            add(music, pad_chord([note_hz('D3'), note_hz('A3'), note_hz('D4')], BAR, 0.10, 900, 0.8, 0.8, seed=bar_i), t)
        elif sec == 'logo':
            add(music, pad_chord(freqs, BAR, 0.14, 1400 + 600 * (t - 4), 0.2, 0.6, seed=bar_i), t)
        elif sec == 'build':
            add(music, pad_chord(freqs, BAR, 0.14, 1500 + 450 * (t - 8), 0.1, 0.5, seed=bar_i), t)
        elif sec in ('drop1', 'drop2'):
            add(music, pad_chord(freqs, BAR, 0.24, 5200, 0.02, 0.35, seed=bar_i), t)
        elif sec == 'breakdown':
            add(music, pad_chord(freqs, BAR, 0.16, 2600, 0.3, 0.8, seed=bar_i), t)
        elif sec == 'outro' and t < 56:
            pass

        # bass
        rf = note_hz(root)
        if sec in ('drop1', 'drop2'):
            for k in range(8):
                tt = t + k * BEAT / 2
                if in_gap(tt, gaps):
                    continue
                oct_ = 2 if k in (3, 7) else 1
                add(bass, pan(sub_bass(rf * oct_, BEAT / 2 - 0.02, 0.62)), tt)
                add(bass, pan(reese(rf * 2 * oct_, BEAT / 2 - 0.02, 0.12, 1300)), tt)
        elif sec == 'build':
            for k in range(8):
                tt = t + k * BEAT / 2
                if in_gap(tt, gaps):
                    continue
                add(bass, pan(sub_bass(rf, BEAT / 2 - 0.03, 0.5)), tt)
        elif sec == 'breakdown':
            add(bass, pan(sub_bass(rf, BAR - 0.05, 0.42, 1.2)), t)
        elif sec == 'logo' and t >= 4:
            for k in range(4):
                tt = t + k * BEAT
                if tt >= 5.5:
                    add(bass, pan(sub_bass(rf, BEAT - 0.04, 0.45)), tt)

        # arp (16ths)
        if sec in ('logo', 'build', 'drop1', 'drop2', 'breakdown'):
            seq = ARP[name]
            for k in range(16):
                tt = t + k * BEAT / 4
                if tt < 5.5 or in_gap(tt, gaps):
                    continue
                lvl = {'logo': 0.07, 'build': 0.09, 'drop1': 0.10, 'drop2': 0.11, 'breakdown': 0.06}[sec]
                bright = {'logo': 2200, 'build': 2200 + 700 * (tt - 8), 'drop1': 6500, 'drop2': 7000, 'breakdown': 3000}[sec]
                add(music, pan(pluck(note_hz(seq[k % 8]), lvl, 0.22, bright), -0.35 if k % 2 else 0.35), tt)

    # breakdown melody (32-40)
    for b, bar_notes in enumerate(BREAK_MELODY):
        for (off, nn, ln) in bar_notes:
            tt = 32 + b * BAR + off * BEAT
            add(music, pan(pluck(note_hz(nn), 0.16, ln * BEAT + 0.3, 4200), 0.1), tt)
    # drop-2 lead
    for b, bar_notes in enumerate(LEAD[:6]):
        for (off, nn, ln) in bar_notes:
            tt = 40 + b * BAR + off * BEAT
            if in_gap(tt, gaps):
                continue
            n_ = secs(ln * BEAT)
            x = supersaw(note_hz(nn), n_ + secs(0.2), 7, 0.016, seed=b * 10 + int(off * 2))
            x = lp(x, 5200) * env_adsr(n_ + secs(0.2), 0.01, 0.15, 0.75, 0.15, gate=ln * BEAT)
            add(music, np.stack([x * 0.11, np.roll(x, secs(0.012)) * 0.11]), tt)

    # outro: final big chord + ring
    final = [note_hz(v) for v in ('D3', 'A3', 'D4', 'F4', 'A4', 'E5', 'D5')]
    add(music, pad_chord(final, 5.2, 0.26, 4200, 0.02, 2.4, seed=77), 52.0)
    add(music, pad_chord([note_hz(v) for v in ('D3', 'A3', 'D4', 'A4', 'D5')], 1.4, 0.22, 3800, 0.01, 1.2, seed=91), 58.0)

    # ---- stabs & impacts on cues
    stab_voicing = {'Dm': ['D4', 'F4', 'A4', 'D5'], 'Bb': ['Bb3', 'D4', 'F4', 'Bb4'], 'F': ['F4', 'A4', 'C5', 'F5'], 'C': ['C4', 'E4', 'G4', 'C5']}
    for t in cues['impacts']:
        add(fx, boom(0.95 if t in (16.0, 40.0, 52.0) else 0.75), t)
        add(fx, crash(0.42), t)
        add(music, stab([note_hz(v) for v in stab_voicing[chord_at(t)]], 0.55, 1.2), t)
    for t in cues['hits']:
        add(fx, stab([note_hz(v) for v in stab_voicing[chord_at(t)]], 0.32, 0.6), t)
        add(fx, pan(kick(0.5, 0.3)), t)
    for t in cues['whooshes']:
        add(fx, whoosh(0.28, 0.5), t - 0.1)
    for (a, b, lvl) in cues['risers']:
        add(fx, riser(b - a, 0.5 * lvl), a)
    for t in cues['shimmer']:
        add(fx, shimmer(0.5), t)
    for t in cues.get('sparkle', []):
        add(fx, sparkle(0.42), t)
    for t in cues['coin']:
        add(fx, coin(0.4), t)
    for t in cues['pops']:
        add(fx, pan(pop(0.26), -0.2), t)
    for t in cues['typing']:
        add(fx, pan(click(0.16), 0.15 * np.sin(t * 50)), t)
    for (a, b) in cues['glitch']:
        add(fx, pan(glitch(b - a, 0.2), 0), a)
        add(fx, reverse_cymbal(b - a + 0.1, 0.5), a)
    for ev in cues['battle']:
        t = ev['t'] if isinstance(ev, dict) else ev
        kind = ev.get('kind', 'hit') if isinstance(ev, dict) else 'hit'
        add(fx, pan(slash(0.42 if kind == 'skill' else 0.3), 0.1), t)
    for (a, b) in cues['stutter']:
        t = a
        while t < b:
            add(fx, pan(click(0.1), 0), t)
            t += BEAT / 4

    # ---- sidechain pump on music + bass from kick times
    env = np.ones(n)
    tt = np.arange(n) / SR
    for k in kicks:
        i0 = secs(k)
        seg = slice(i0, min(n, i0 + secs(0.3)))
        local = tt[seg] - k
        env[seg] = np.minimum(env[seg], 1 - 0.6 * np.exp(-local / 0.09))
    music *= env
    bass *= env

    # ---- mix
    music = hp(music, 190)  # keep the low end for kick + bass
    music = reverb(music, IR_MID, 0.22)
    music = delay(music, BEAT * 0.75, 0.3, 0.12)
    # section automation: build grows, breakdown dips, drops hit full
    keys = [(0, .55), (3.0, .75), (5.4, .75), (5.6, .82), (8.0, .6), (15.7, .9), (16.0, 1.0), (31.9, 1.0), (32.0, .62), (36.0, .66), (39.7, .92),
            (40.0, 1.0), (51.9, 1.0), (52.0, .95), (60.0, .9)]
    kt = np.array([k[0] for k in keys]); kv = np.array([k[1] for k in keys])
    auto = np.interp(tt, kt, kv)
    # true silence before each drop (everything but the incoming impact)
    gap = np.zeros(n)
    for (a, b) in gaps:
        ia, ib = secs(a), secs(b)
        ramp = secs(0.03)
        gap[ia:ib] = 1.0
        gap[max(0, ia - ramp):ia] = np.linspace(0, 1, ia - max(0, ia - ramp))
    duck = 1 - 0.97 * gap
    bed = (drums * 0.9 + bass * 0.95 + music * 1.0) * auto * duck
    fx_bed = fx * np.where(gap > 0, 0.08, 1.0)
    mix = bed + fx_bed * 0.85
    mix = hp(mix, 28)
    # soft clip + normalize (target ~ -13 LUFS-ish via RMS)
    mix = np.tanh(mix * 1.05)
    rms = np.sqrt(np.mean(mix ** 2))
    mix *= 0.2 / max(rms, 1e-6)
    peak = np.max(np.abs(mix))
    if peak > 0.89:
        mix = np.tanh(mix / 0.89) * 0.89
    # fades: tiny fade in, fade out over the last 0.6 s of the film
    fi = secs(0.02)
    mix[:, :fi] *= np.linspace(0, 1, fi)
    fo0 = secs(total - 0.6)
    mix[:, fo0:secs(total)] *= np.linspace(1, 0, secs(total) - fo0) ** 1.5
    return mix[:, :secs(total)]


def write_wav(path, stereo):
    from scipy.io import wavfile
    data = np.clip(stereo.T, -1, 1)
    wavfile.write(path, SR, (data * 32767).astype(np.int16))


if __name__ == '__main__':
    cues = json.load(open(sys.argv[1]))
    out = build(cues)
    write_wav(sys.argv[2], out)
    print('wrote', sys.argv[2], out.shape[1] / SR, 's')
