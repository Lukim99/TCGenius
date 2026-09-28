#!/usr/bin/env python3
"""Original soundtrack + SFX for the RPGenius pop film ("딱 한 판만…"), synthesized with numpy.

Bright future-bass / electro-pop, 128 BPM, C major, "royal road" progression (IV-V-iii-vi: Fmaj7 G7 Em7 Am7).
Lo-fi night intro -> build -> drop 1 -> half-time groove -> WARNING build -> drop 2 -> bouncy bridge
-> full stop + alarm + record scratch -> final chorus. SFX are placed from the shared cue sheet.
Usage: python3 music2.py cues.json out.wav
"""
import json
import sys

import numpy as np

import synth as S
from synth import SR, secs, note_hz, bp, lp, hp, env_adsr, supersaw, reverb, pan, add, IR_BIG, IR_MID

BPM = 128
BEAT = 60 / BPM
BAR = BEAT * 4
rng = np.random.default_rng(128)

# ---------------------------------------------------------------- extra instruments
def ep_chord(freqs, length, level=0.22):
    """Soft electric-piano chord (sine + tine) for the lo-fi intro / bridge."""
    n = secs(length + 0.8)
    t = np.arange(n) / SR
    x = np.zeros(n)
    for i, f in enumerate(freqs):
        tine = np.sin(2 * np.pi * f * 4.02 * t) * np.exp(-t * 9) * 0.18
        body = np.sin(2 * np.pi * f * t + 0.3 * np.sin(2 * np.pi * f * 2 * t) * np.exp(-t * 3))
        x += (body + tine) * np.exp(-t * (1.6 + i * 0.1))
    x *= np.minimum(1, t / 0.006) * env_adsr(n, 0.004, 0.2, 0.9, 0.5, gate=length)
    x = lp(x / len(freqs), 3200)
    l = x * level
    return np.stack([l, np.roll(l, secs(0.009))])


def pluck2(freq, level=0.3, length=0.4, bright=6500):
    n = secs(length)
    t = np.arange(n) / SR
    x = supersaw(freq, n, 3, 0.006, seed=int(freq)) * 0.6 + np.sin(2 * np.pi * freq * t) * 0.6
    x = lp(x, bright, 2) * np.exp(-t * 7) * np.minimum(1, t / 0.002)
    return x * level


def uke(freq, level=0.25):
    """Karplus-Strong-ish nylon pluck for the comedic morning groove."""
    n = secs(0.6)
    period = int(SR / freq)
    buf = rng.uniform(-1, 1, period)
    out = np.zeros(n)
    for i in range(n):
        v = buf[i % period]
        out[i] = v
        buf[i % period] = 0.5 * (v + buf[(i + 1) % period]) * 0.994
    return lp(out, 5000) * level


def fb_stab(freqs, level=0.5, length=0.3):
    """Future-bass chord chop: bright supersaw stack with a fast filter close."""
    n = secs(length)
    t = np.arange(n) / SR
    x = np.zeros(n)
    for i, f in enumerate(freqs):
        x += supersaw(f, n, 7, 0.028, seed=90 + i)
    x /= len(freqs)
    out = np.zeros(n)
    chunks = 12
    for c in range(chunks):
        a, b = c * n // chunks, (c + 1) * n // chunks
        out[a:b] = lp(x[a:b], 1500 + 9000 * np.exp(-(a / SR) * 9), 1)
    e = np.minimum(1, t / 0.003) * np.exp(-t * 4)
    l = out * e * level
    return np.stack([l, np.roll(l, secs(0.014))])


# ---------------------------------------------------------------- SFX
def tick(level=0.3, hi=True):
    n = secs(0.05)
    t = np.arange(n) / SR
    f = 3200 if hi else 2400
    x = np.sin(2 * np.pi * f * t) * np.exp(-t * 180) + bp(rng.standard_normal(n), 2000, 8000) * np.exp(-t * 400) * 0.5
    return x * level


def hit(level=0.8):
    n = secs(0.4)
    t = np.arange(n) / SR
    f = 50 + 160 * np.exp(-t * 40)
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 12)
    snap = bp(rng.standard_normal(n), 1500, 9000) * np.exp(-t * 45)
    return np.tanh((body * 1.2 + snap * .8) * 1.5) * level


def thud(level=0.9):
    n = secs(0.7)
    t = np.arange(n) / SR
    f = 34 + 60 * np.exp(-t * 18)
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 6) + lp(rng.standard_normal(n), 400) * np.exp(-t * 20) * .4
    return np.tanh(x * 1.6) * level


def swish(level=0.35):
    return S.whoosh(level, 0.22, up=True)


def card(level=0.4):
    n = secs(0.12)
    t = np.arange(n) / SR
    x = bp(rng.standard_normal(n), 2500, 11000) * np.exp(-t * 60) + bp(rng.standard_normal(n), 600, 2400) * np.exp(-t * 90) * .6
    return x * level


def crit(level=0.8):
    n = secs(0.9)
    t = np.arange(n) / SR
    ring = sum(np.sin(2 * np.pi * f * t) * np.exp(-t * d) for f, d in ((note_hz('E6'), 6), (note_hz('B6'), 7), (note_hz('E7'), 9))) * .18
    out = np.zeros(n)
    h = hit(1.0)
    out[:len(h)] += h
    return (out + ring) * level


def fire(level=0.6):
    n = secs(0.9)
    t = np.arange(n) / SR
    roar = lp(rng.standard_normal(n), 1800) * (np.minimum(1, t / 0.04) * np.exp(-t * 3.2))
    crackle = (rng.random(n) > 0.9975) * rng.uniform(-1, 1, n)
    crackle = bp(crackle, 1500, 9000) * 6 * np.exp(-t * 2)
    return pan((roar + crackle) * level, -0.1)


def ice(level=0.5):
    n = secs(1.0)
    t = np.arange(n) / SR
    x = np.zeros(n)
    for i in range(7):
        f0 = 1800 + i * 520
        tt = np.clip(t - i * 0.03, 0, None)
        x += np.sin(2 * np.pi * (f0 + 900 * tt) * tt) * np.exp(-tt * 7) * (t >= i * 0.03)
    crack = hp(rng.standard_normal(n), 3000) * np.exp(-t * 25) * .6
    return reverb(pan((x / 4 + crack) * level, 0.2), IR_MID, 0.35)


def cards(level=0.5):
    n = secs(0.5)
    out = np.zeros(n)
    for i in range(7):
        c = card(1.0)
        i0 = secs(i * 0.045)
        out[i0:i0 + len(c)] += c[:max(0, min(len(c), n - i0))] * (1 - i * .08)
    return out * level


def zap(level=0.5):
    n = secs(0.45)
    t = np.arange(n) / SR
    f = 900 * np.exp(-t * 6) + 120
    x = np.sign(np.sin(2 * np.pi * np.cumsum(f * (1 + 0.3 * rng.standard_normal(n))) / SR))
    return bp(x, 400, 7000) * np.exp(-t * 7) * level


def levelup(level=0.5):
    n = secs(1.6)
    x = np.zeros(n)
    for i, nn in enumerate(('C5', 'E5', 'G5', 'C6', 'E6', 'G6')):
        p = pluck2(note_hz(nn), 1.0, 0.5, 9000)
        i0 = secs(i * 0.07)
        x[i0:i0 + len(p)] += p[:max(0, min(len(p), n - i0))]
    out = reverb(pan(x * level, 0.1), IR_BIG, 0.3)
    add(out, S.sparkle(level * .8), 0.4)
    return out


def success(level=0.7):
    out = S.stab([note_hz(nn) for nn in ('C4', 'E4', 'G4', 'C5', 'E5')], level * .8, 1.2)
    add(out, S.sparkle(level * .9), 0.05)
    return out


def stamp(level=0.7):
    n = secs(0.35)
    t = np.arange(n) / SR
    x = np.sin(2 * np.pi * (70 + 120 * np.exp(-t * 50)) * t) * np.exp(-t * 20) + bp(rng.standard_normal(n), 300, 3000) * np.exp(-t * 40) * .7
    return np.tanh(x * 1.4) * level


def alarm_short(level=0.3):
    n = secs(0.6)
    t = np.arange(n) / SR
    beep = np.sign(np.sin(2 * np.pi * 1400 * t)) * (((t // 0.12) % 2) == 0)
    return lp(beep, 5000) * np.exp(-t * 1.5) * level


def alarm(level=0.5, length=1.3):
    """Mechanical alarm-clock bell: hammer strikes alternating between two bells."""
    n = secs(length)
    t = np.arange(n) / SR
    x = np.zeros(n)
    k = 0
    tt0 = 0.0
    while tt0 < length - 0.03:
        f = 2350 if k % 2 else 2650
        seg = np.clip(t - tt0, 0, None)
        partials = sum(np.sin(2 * np.pi * f * m * seg) / m for m in (1, 2.76, 5.4))
        x += partials * np.exp(-seg * 30) * (t >= tt0)
        tt0 += 0.032
        k += 1
    x *= np.minimum(1, t / 0.01) * np.clip((length - t) / 0.15, 0, 1)
    return pan(hp(x, 800) * level / 3, 0.1)


def roar(level=0.8):
    n = secs(1.1)
    t = np.arange(n) / SR
    f = 70 + 25 * np.sin(2 * np.pi * 7 * t)
    growl = np.tanh(S.saw(1, n) * 0 + np.sign(np.sin(2 * np.pi * np.cumsum(f) / SR)) * 0.8)
    noise = bp(rng.standard_normal(n), 150, 1500)
    e = np.minimum(1, t / 0.06) * np.exp(-t * 1.8)
    x = lp(growl * .6 + noise * .8, 1800) * e
    return reverb(pan(np.tanh(x * 2) * level), IR_BIG, 0.25)


def shield(level=0.6):
    n = secs(1.0)
    t = np.arange(n) / SR
    clang = sum(np.sin(2 * np.pi * f * t) * np.exp(-t * d) for f, d in ((523, 5), (1340, 7), (2210, 9), (3080, 12))) * .3
    thump = hit(0.7)
    out = np.zeros(n)
    out[:len(thump)] += thump
    return reverb(pan((out + clang) * level), IR_MID, 0.3)


def crunch(level=0.8):
    n = secs(0.8)
    t = np.arange(n) / SR
    debris = np.zeros(n)
    for i in range(24):
        i0 = secs(0.02 + rng.random() * 0.5)
        m = min(secs(0.03), n - i0)
        debris[i0:i0 + m] += bp(rng.standard_normal(m), 800, 6000) * np.exp(-np.arange(m) / SR * 90) * (1 - i / 30)
    boomx = thud(1.0)
    out = np.zeros(n)
    out[:len(boomx)] += boomx * .9
    return np.tanh((out + debris * .8 + bp(rng.standard_normal(n), 200, 3000) * np.exp(-t * 14) * .6) * 1.3) * level


def tape_stop(level=0.4):
    n = secs(0.5)
    t = np.arange(n) / SR
    f = 220 * (1 - t / 0.5) ** 2 + 20
    x = S.saw(1, n) * 0 + np.sin(2 * np.pi * np.cumsum(f) / SR)
    return lp(x, 1200) * (1 - t / 0.5) * level


def scratch(level=0.6):
    n = secs(0.55)
    t = np.arange(n) / SR
    pos = np.sin(2 * np.pi * 3.2 * t) * 0.5 + 0.5 * np.sin(2 * np.pi * 7 * t) ** 3
    speed = np.gradient(pos) * SR / 40
    noise = rng.standard_normal(n)
    out = np.zeros(n)
    for c in range(40):
        a, b = c * n // 40, (c + 1) * n // 40
        center = 300 + 3000 * abs(speed[a])
        out[a:b] = bp(noise[a:b], max(60, center * .5), min(16000, center * 1.6), 1)
    tone = np.sin(2 * np.pi * np.cumsum(180 + 900 * np.abs(speed)) / SR) * .4
    return np.tanh((out + tone) * np.minimum(1, np.abs(speed) * 2 + .1) * 1.5) * level


def chat(level=0.35):
    n = secs(0.22)
    t = np.arange(n) / SR
    x = np.where(t < 0.07, np.sin(2 * np.pi * 1320 * t), np.sin(2 * np.pi * 1760 * t)) * np.exp(-t * 14)
    return x * np.minimum(1, t / 0.003) * level


SFX = {
    'tick': lambda g, i: tick(0.32 * g), 'tick_up': lambda g, i: pluck2(note_hz('C6') * 2 ** ((i or 0) * 2 / 12), 0.28 * g, 0.12, 9000),
    'pop': lambda g, i: S.pop(0.42 * g), 'hit': lambda g, i: hit(0.75 * g), 'type': lambda g, i: S.click(0.22 * g),
    'whoosh': lambda g, i: S.whoosh(0.5 * g, 0.5, up=True), 'swish': lambda g, i: swish(0.4 * g), 'click': lambda g, i: S.click(0.5 * g) * 1.4,
    'riser_short': lambda g, i: S.riser(0.5, 0.5 * g), 'thud': lambda g, i: thud(0.8 * g), 'boom': lambda g, i: S.boom(0.9 * g, 2.2),
    'crash': lambda g, i: S.crash(0.35 * g, 2.6), 'sparkle': lambda g, i: S.sparkle(0.5 * g), 'card': lambda g, i: card(0.5 * g),
    'slash': lambda g, i: S.slash(0.6 * g), 'crit': lambda g, i: crit(0.8 * g), 'fire': lambda g, i: fire(0.55 * g), 'ice': lambda g, i: ice(0.6 * g),
    'cards': lambda g, i: cards(0.6 * g), 'zap': lambda g, i: zap(0.45 * g), 'levelup': lambda g, i: levelup(0.6 * g), 'coin': lambda g, i: S.coin(0.35 * g),
    'success': lambda g, i: success(0.7 * g), 'stamp': lambda g, i: stamp(0.7 * g), 'alarm_short': lambda g, i: alarm_short(0.3 * g),
    'alarm': lambda g, i: alarm(0.55 * g, 1.3), 'roar': lambda g, i: roar(0.75 * g), 'shield': lambda g, i: shield(0.6 * g), 'break': lambda g, i: crunch(0.8 * g),
    'stop': lambda g, i: tape_stop(0.45 * g), 'scratch': lambda g, i: scratch(0.6 * g), 'chat': lambda g, i: chat(0.38 * g),
}

# ---------------------------------------------------------------- composition
CH = {
    'F': (['F3', 'A3', 'C4', 'E4'], 'F1'),
    'G': (['G3', 'B3', 'D4', 'F4'], 'G1'),
    'Em': (['E3', 'G3', 'B3', 'D4'], 'E1'),
    'Am': (['A3', 'C4', 'E4', 'G4'], 'A1'),
}
PROG = ['F', 'G', 'Em', 'Am']
LEAD_A = [['A4', None, 'C5', None, 'E5', 'D5', 'C5', None], ['B4', None, 'D5', None, 'G5', 'F5', 'E5', 'D5'],
          ['E5', None, 'G5', None, 'B5', 'A5', 'G5', None], ['A5', None, 'G5', 'E5', 'C5', None, 'D5', 'E5']]
LEAD_B = [['C6', None, 'A5', None, 'G5', 'A5', 'C6', None], ['D6', None, 'B5', None, 'G5', None, 'D6', 'E6'],
          ['E6', None, 'D6', 'B5', 'G5', None, 'B5', 'D6'], ['E6', None, None, 'D6', 'C6', None, 'A5', None]]
FB_RHYTHM = [1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 1, 0]  # 16th grid chops per bar


def hz(names):
    return [note_hz(nn) for nn in names]


def section_of(t, cues):
    for s in cues['sections']:
        if s['start'] <= t < s['end']:
            return s['name']
    return 'outro'


def build(cues):
    total = cues['duration']
    n = secs(total + 1.0)
    tt = np.arange(n) / SR
    drums = np.zeros((2, n)); bass = np.zeros((2, n)); music = np.zeros((2, n)); fx = np.zeros((2, n))
    kicks = []
    # silences: the morning stop and the one-beat gaps before drops
    STOP = (75.0, 76.875)
    gaps = [(14.85, 15.0), (52.35, 52.5), (82.38, 82.5)]

    def silent(t):
        return any(a <= t < b for a, b in gaps) or STOP[0] <= t < STOP[1]

    # ---------------- drums on a 16th grid
    steps = int(total / (BEAT / 4))
    for i in range(steps):
        t = i * BEAT / 4
        if silent(t) or t >= 88.2:
            continue
        sec = section_of(t, cues)
        beat_i, sub = divmod(i, 4)
        bpos = beat_i % 4
        full = sec in ('drop1', 'drop2', 'outro') and not (sec == 'outro' and t >= 86.25)
        if sec == 'intro':
            if sub == 0 and bpos in (0, 2) and t >= 1.875:
                add(drums, S.kick(0.45, 0.35), t); kicks.append((t, .35))
            if sub == 0 and bpos in (1, 3) and t >= 1.875:
                add(drums, S.clap(0.16), t)
        elif sec == 'build':
            if t < 13.125:
                if sub == 0:
                    add(drums, S.kick(0.55 + 0.35 * (t - 7.5) / 5.6), t); kicks.append((t, .5))
                if sub == 0 and bpos in (1, 3):
                    add(drums, S.clap(0.35), t)
                if sub == 2 and t >= 9.375:
                    add(drums, pan(S.hat(0.14), 0.2), t)
            else:
                # snare roll: 8ths -> 16ths -> 32nds, rising
                prog_ = (t - 13.125) / (14.85 - 13.125)
                every = 2 if t < 14.0625 else 1
                if i % every == 0:
                    add(drums, S.snare(0.25 + 0.5 * prog_, 0.2, 180 + 140 * prog_), t)
                if t >= 14.53 and sub % 1 == 0:
                    add(drums, S.snare(0.35 + 0.4 * prog_, 0.12, 300), t + BEAT / 8)
        elif full or sec == 'bridge':
            if sub == 0:
                add(drums, S.kick(1.0 if full else 0.8), t); kicks.append((t, 1.0 if full else .7))
            if sub == 0 and bpos in (1, 3):
                add(drums, S.clap(0.75 if full else 0.6), t)
                if full:
                    add(drums, S.snare(0.35), t)
            if full:
                add(drums, pan(S.hat(0.12 if sub % 2 else 0.2), 0.25), t)
                if sub == 2:
                    add(drums, pan(S.hat(0.16, True), -0.2), t)
            elif sub == 2:
                add(drums, pan(S.hat(0.15), 0.2), t)
        elif sec == 'groove':
            # half-time bounce
            if sub == 0 and bpos == 0:
                add(drums, S.kick(0.95), t); kicks.append((t, .9))
            if sub == 2 and bpos == 1:
                add(drums, S.kick(0.7), t); kicks.append((t, .6))
            if sub == 0 and bpos == 2:
                add(drums, S.snare(0.6), t); add(drums, S.clap(0.45), t)
            if sub in (0, 2):
                add(drums, pan(S.hat(0.14 if sub else 0.2), 0.3), t + (BEAT * 0.06 if sub == 2 else 0))
        elif sec == 'build2':
            if t >= 51.56:
                prog_ = (t - 51.56) / (52.35 - 51.56)
                add(drums, S.snare(0.3 + 0.5 * prog_, 0.15, 220 + 120 * prog_), t)
        elif sec == 'morning':
            if 76.875 <= t < 80.625:
                if sub == 0 and bpos in (0, 2):
                    add(drums, S.kick(0.6), t); kicks.append((t, .5))
                if sub == 0 and bpos in (1, 3):
                    add(drums, S.clap(0.4), t)
                if sub == 2:
                    add(drums, pan(S.hat(0.12), 0.2), t)
            elif t >= 80.625:
                prog_ = (t - 80.625) / (82.38 - 80.625)
                every = 2 if t < 81.56 else 1
                if i % every == 0:
                    add(drums, S.snare(0.25 + 0.55 * prog_, 0.16, 190 + 150 * prog_), t)
                if sub == 0:
                    add(drums, S.kick(0.5 + 0.4 * prog_), t)
    for tc in (15.0, 22.5, 30.0, 52.5, 60.0, 82.5):
        add(drums, S.crash(0.5, 2.6), tc)
    add(drums, S.crash(0.6, 3.5), 86.25)

    # ---------------- harmony, bass, lead
    nbars = int(total / BAR) + 1
    for b in range(nbars):
        t0 = b * BAR
        sec = section_of(t0 + 0.01, cues)
        chord = PROG[b % 4]
        voic, root = CH[chord]
        f_ch, f_root = hz(voic), note_hz(root)
        if sec == 'intro':
            add(music, ep_chord(f_ch, BAR * 0.95, 0.2), t0)
            add(music, ep_chord([f * 2 for f in f_ch[1:3]], BEAT * .5, 0.08), t0 + BEAT * 2.5)
        elif sec == 'build':
            add(music, ep_chord(f_ch, BAR * 0.95, 0.18), t0)
            cut = 900 + 4000 * (t0 - 7.5) / 7.5
            add(music, S.pad_chord(f_ch, BAR, 0.1 + 0.08 * (t0 - 7.5) / 7.5, cut, 0.2, 0.3, seed=b), t0)
            add(bass, pan(S.sub_bass(f_root * 2, BAR * .95, 0.35)), t0)
            for k in range(8):  # arp
                nn = voic[k % 4]
                add(music, pan(pluck2(note_hz(nn) * 2, 0.07 + 0.05 * (t0 - 7.5) / 7.5, 0.3), 0.3 if k % 2 else -0.3), t0 + k * BEAT / 2)
        elif sec in ('drop1', 'drop2', 'outro') and not (sec == 'outro' and t0 >= 86.25):
            add(music, S.pad_chord(f_ch, BAR, 0.1, 3800, 0.05, 0.2, seed=b), t0)
            for k, on in enumerate(FB_RHYTHM):
                if on:
                    tc = t0 + k * BEAT / 4
                    if not silent(tc):
                        add(music, fb_stab(f_ch + [f_ch[0] * 2], 0.34, 0.28), tc)
            if sec == 'drop2' and t0 < 60:
                add(bass, pan(S.reese(f_root * 2, BAR * .96, 0.34, 700)), t0)
            for k in range(8):
                tb = t0 + k * BEAT / 2
                if not silent(tb):
                    add(bass, pan(S.sub_bass(f_root * (2 if k % 2 else 1), BEAT * .45, 0.62)), tb)
            lead = (LEAD_B if (b // 4) % 2 else LEAD_A)[b % 4]
            for k, nn in enumerate(lead):
                tl = t0 + k * BEAT / 2
                if nn and not silent(tl):
                    add(music, pan(pluck2(note_hz(nn), 0.2, 0.4, 7500), 0.12), tl)
        elif sec == 'groove':
            add(music, ep_chord(f_ch, BEAT * 1.4, 0.15), t0)
            add(music, ep_chord(f_ch, BEAT * 0.6, 0.11), t0 + BEAT * 2.5)
            for k in range(16):
                if k % 3 != 1:
                    nn = voic[(k * 2) % 4]
                    add(music, pan(pluck2(note_hz(nn) * 2, 0.1, 0.25, 8000), -0.35 if k % 2 else 0.35), t0 + k * BEAT / 4)
            add(bass, pan(S.sub_bass(f_root * 2, BEAT * 1.4, 0.6)), t0)
            add(bass, pan(S.sub_bass(f_root * 2, BEAT * .4, 0.5)), t0 + BEAT * 1.5)
            add(bass, pan(S.sub_bass(f_root * 2, BEAT * .9, 0.55)), t0 + BEAT * 2.5)
        elif sec == 'build2':
            am, am_root = hz(CH['Am'][0]), note_hz('A1')
            add(music, S.pad_chord([f / 2 for f in am], BAR, 0.14, 1400, 0.3, 0.4, seed=77), t0)
            add(bass, pan(S.reese(am_root * 2, BAR * .98, 0.3, 500)), t0)
        elif sec == 'bridge':
            add(music, ep_chord(f_ch, BEAT * .9, 0.17), t0 + BEAT * .5)
            add(music, ep_chord(f_ch, BEAT * .9, 0.14), t0 + BEAT * 2.5)
            for k in range(8):
                nn = LEAD_A[b % 4][k]
                if nn:
                    add(music, pan(pluck2(note_hz(nn), 0.14, 0.35, 6000), 0.2), t0 + k * BEAT / 2)
            for k in range(4):
                add(bass, pan(S.sub_bass(f_root * 2, BEAT * .45, 0.55)), t0 + k * BEAT)
        elif sec == 'morning' and t0 >= 76.875 - 0.01:
            # comedic ukulele groove (C - G - Am - F), then the final build
            MCH = [['C4', 'E4', 'G4'], ['B3', 'D4', 'G4'], ['C4', 'E4', 'A4'], ['C4', 'F4', 'A4']][b % 4]
            for k in range(8):
                tu = t0 + k * BEAT / 2
                if tu < 80.625:
                    for j, nn in enumerate(MCH):
                        add(music, pan(uke(note_hz(nn), 0.1 if k % 2 else 0.14), -0.2 + j * .2), tu + j * 0.008)
            if t0 >= 78.7:
                add(music, S.pad_chord(f_ch, BAR, 0.1, 2000 + 5000 * (t0 - 78.75) / 3.75, 0.2, 0.3, seed=b), t0)
    # final chord hit ringing out (86.25 -> 90)
    fin = hz(['C3', 'G3', 'C4', 'E4', 'G4', 'C5'])
    add(music, S.stab(fin, 0.7, 2.6), 86.25)
    add(music, S.pad_chord(fin, 3.2, 0.16, 3000, 0.02, 1.0, seed=5), 86.25)
    add(bass, pan(S.sub_bass(note_hz('C2'), 2.4, 0.7)), 86.25)
    add(fx, S.boom(0.7, 2.4), 86.25)
    add(fx, S.shimmer(0.4, 3.2), 86.3)
    # risers into the drops + a reverse cymbal into the final chorus
    for (a, b_, lv) in [(11.25, 14.85, 0.55), (48.75, 52.35, 0.65), (80.625, 82.38, 0.7)]:
        add(fx, S.riser(b_ - a, lv), a)
    add(fx, S.reverse_cymbal(0.9, 0.4), 82.5 - 0.9)
    # vinyl crackle + room tone in the lo-fi night
    crack = ((rng.random(secs(7.5)) > 0.9993) * rng.uniform(-1, 1, secs(7.5)))
    crack = bp(crack, 800, 8000) * 3 + lp(rng.standard_normal(secs(7.5)), 3000) * 0.012
    add(music, pan(crack * 0.3), 0)
    # clock ticks keep going on the end card: the night starts again
    for k in range(8):
        add(fx, tick(0.18, k % 2 == 0), 86.25 + BEAT + k * BEAT)

    # ---------------- sidechain pumping (music + bass duck on every kick)
    env = np.ones(n)
    for (k, depth) in kicks:
        i0 = secs(k)
        seg = slice(i0, min(n, i0 + secs(0.34)))
        local = tt[seg] - k
        env[seg] = np.minimum(env[seg], 1 - 0.72 * depth * np.exp(-local / 0.1))
    music *= env
    bass *= env

    # ---------------- SFX from the cue sheet
    for c in cues.get('sfx', []):
        fn = SFX.get(c['k'])
        if fn is None:
            print('unknown sfx', c['k'])
            continue
        sig = fn(c.get('g', 1.0), c.get('i'))
        add(fx, sig if getattr(sig, 'ndim', 1) == 2 else pan(sig, 0), c['t'])

    # ---------------- mix
    music = hp(music, 160)
    music = reverb(music, IR_MID, 0.2)
    music = S.delay(music, BEAT * 0.75, 0.3, 0.1)
    keys = [(0, .8), (7.4, .8), (7.5, .7), (14.8, 1.0), (15.0, 1.0), (37.4, 1.0), (37.5, .85), (48.7, .85), (48.75, .8), (52.4, 1.0),
            (52.5, 1.0), (67.4, 1.0), (67.5, .88), (74.95, .88), (75.0, .9), (82.5, 1.0), (90, 1.0)]
    auto = np.interp(tt, np.array([k[0] for k in keys]), np.array([k[1] for k in keys]))
    # hard mute of the bed during the stop and the pre-drop gaps (SFX stay audible)
    mute = np.ones(n)
    for (a, b_) in gaps + [STOP]:
        ia, ib = secs(a), secs(b_)
        mute[ia:ib] = 0.0
        r = secs(0.02)
        mute[max(0, ia - r):ia] = np.linspace(1, 0, ia - max(0, ia - r))
    bed = (drums * 0.9 + bass * 0.95 + music) * auto * mute
    mix = bed + fx * 0.8
    mix = hp(mix, 28)
    mix = np.tanh(mix * 1.05)
    rms = np.sqrt(np.mean(mix[:, :secs(total)] ** 2))
    mix *= 0.2 / max(rms, 1e-6)
    peak = np.max(np.abs(mix))
    if peak > 0.89:
        mix = np.tanh(mix / 0.89) * 0.89
    fi = secs(0.02)
    mix[:, :fi] *= np.linspace(0, 1, fi)
    fo0 = secs(total - 1.2)
    mix[:, fo0:secs(total)] *= np.linspace(1, 0, secs(total) - fo0) ** 1.4
    return mix[:, :secs(total)]


if __name__ == '__main__':
    cues = json.load(open(sys.argv[1]))
    out = build(cues)
    S.write_wav(sys.argv[2], out)
    print('wrote', sys.argv[2], out.shape[1] / SR, 's')
