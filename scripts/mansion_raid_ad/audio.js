// E세계 대저택 레이드 광고 — 음악 편집과 효과음 믹스
// 레이드 BGM을 박자 단위로 잘라 잇고, 레이드 효과음(CC0)과 합성 효과음을 시간표대로 얹는다.
// 결과: .cache/audio.wav (48kHz 스테레오, -14 LUFS / -2.5 dBTP: AAC 인코딩 뒤에도 -1 dBTP 아래)
const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const TL = require('./timeline');

const SR = 48000;
const CACHE = path.join(__dirname, '.cache');
const SND = path.join(CACHE, 'snd');
const N = Math.round(TL.DURATION * SR);

function decode(file) {
    const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'f32le', '-ac', '2', '-ar', String(SR), '-'], { maxBuffer: 1 << 30 });
    const f = new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4);
    const L = new Float32Array(f.length / 2), R = new Float32Array(f.length / 2);
    for (let i = 0; i < L.length; i++) {
        L[i] = f[i * 2];
        R[i] = f[i * 2 + 1];
    }
    return [L, R];
}
const cache = {};
const load = name => (cache[name] = cache[name] || decode(path.join(SND, name)));
const db = v => Math.pow(10, v / 20);

// 결정적 난수
let seed = 12345;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const noise = () => rand() * 2 - 1;

// RBJ 바이쿼드
function biquad(type, f, q) {
    const w = (2 * Math.PI * Math.min(f, SR * 0.45)) / SR, c = Math.cos(w), s = Math.sin(w), a = s / (2 * q);
    let b0, b1, b2;
    if (type === 'lp') [b0, b1, b2] = [(1 - c) / 2, 1 - c, (1 - c) / 2];
    else if (type === 'hp') [b0, b1, b2] = [(1 + c) / 2, -(1 + c), (1 + c) / 2];
    else [b0, b1, b2] = [a, 0, -a];
    const a0 = 1 + a;
    return [b0 / a0, b1 / a0, b2 / a0, (-2 * c) / a0, (1 - a) / a0];
}
// 차단 주파수가 시간에 따라 변하는 필터
function sweepFilter(x, type, fAt, q = 0.8) {
    const y = new Float32Array(x.length);
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0, co = null;
    for (let i = 0; i < x.length; i++) {
        if (i % 32 === 0) co = biquad(type, fAt(i / x.length), q);
        const [b0, b1, b2, a1, a2] = co;
        const v = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
        x2 = x1;
        x1 = x[i];
        y2 = y1;
        y1 = v;
        y[i] = v;
    }
    return y;
}
// 간단한 잔향(콤 + 올패스)
function reverb(x, size = 1, wet = 0.35, tail = 1.6) {
    const out = new Float32Array(x.length + Math.round(tail * SR));
    const combs = [1557, 1617, 1491, 1422].map(d => Math.round(d * size * (SR / 44100)));
    const fb = 0.84;
    for (const d of combs) {
        const b = new Float32Array(d);
        let k = 0, lp = 0;
        for (let i = 0; i < out.length; i++) {
            const inp = i < x.length ? x[i] : 0;
            const v = b[k];
            lp = v * 0.7 + lp * 0.3;
            b[k] = inp + lp * fb;
            out[i] += v * 0.25;
            k = (k + 1) % d;
        }
    }
    for (const d of [225, 556, 441].map(v => Math.round(v * (SR / 44100)))) {
        const b = new Float32Array(d);
        let k = 0;
        for (let i = 0; i < out.length; i++) {
            const v = b[k], inp = out[i];
            b[k] = inp + v * 0.5;
            out[i] = v - inp * 0.5;
            k = (k + 1) % d;
        }
    }
    for (let i = 0; i < out.length; i++) out[i] = out[i] * wet + (i < x.length ? x[i] : 0) * (1 - wet);
    return out;
}
const buf = sec => new Float32Array(Math.round(sec * SR));
function env(i, n, a, r) {
    const t = i / SR, T = n / SR;
    return Math.min(1, t / a) * Math.min(1, (T - t) / r);
}
function sinePitch(sec, f0, f1, curve = 3) {
    const n = Math.round(sec * SR), y = new Float32Array(n);
    let ph = 0;
    for (let i = 0; i < n; i++) {
        const p = i / n;
        ph += (2 * Math.PI * (f1 + (f0 - f1) * Math.exp(-p * curve * 3))) / SR;
        y[i] = Math.sin(ph);
    }
    return y;
}

const SYN = {
    drone(o) {
        const n = Math.round(o.dur * SR), y = new Float32Array(n);
        let p1 = 0, p2 = 0;
        const nz = sweepFilter(Float32Array.from({ length: n }, noise), 'lp', p => 180 + 400 * p, 0.7);
        for (let i = 0; i < n; i++) {
            const t = i / SR;
            p1 += (2 * Math.PI * 41.2) / SR;
            p2 += (2 * Math.PI * 61.8 * (1 + 0.002 * Math.sin(t * 0.7))) / SR;
            const e = Math.min(1, t / 3) * Math.min(1, (o.dur - t) / 0.4) * (0.6 + 0.4 * (t / o.dur));
            y[i] = (Math.sin(p1) * 0.5 + Math.sin(p2) * 0.3 + nz[i] * 0.6) * e;
        }
        return reverb(y, 1.2, 0.3, 1);
    },
    whoosh(o) {
        const d = o.dur || 0.5, n = Math.round(d * SR);
        const x = Float32Array.from({ length: n }, noise);
        const y = sweepFilter(x, 'bp', p => 300 * Math.pow(12, Math.sin(Math.PI * p)), 1.2);
        for (let i = 0; i < n; i++) y[i] *= Math.pow(Math.sin((Math.PI * i) / n), 2) * 1.6;
        return y;
    },
    riser(o) {
        const d = o.dur || 2, n = Math.round(d * SR);
        const x = Float32Array.from({ length: n }, noise);
        const y = sweepFilter(x, 'bp', p => 400 + 7000 * p * p, 1.5);
        let ph = 0;
        for (let i = 0; i < n; i++) {
            const p = i / n;
            ph += (2 * Math.PI * (110 + 660 * p * p)) / SR;
            y[i] = (y[i] * 1.2 + Math.sin(ph) * 0.15) * Math.pow(p, 2.2);
        }
        return y;
    },
    hit() {
        const y = sinePitch(0.35, 150, 48, 2.5);
        for (let i = 0; i < y.length; i++) y[i] = y[i] * Math.exp(-i / (0.09 * SR)) + (i < 0.012 * SR ? noise() * 0.6 * (1 - i / (0.012 * SR)) : 0);
        return y;
    },
    boom() {
        const n = Math.round(2.2 * SR);
        const sub = sinePitch(2.2, 72, 26, 1.2);
        const nz = sweepFilter(Float32Array.from({ length: n }, noise), 'lp', p => 2400 * Math.exp(-p * 6) + 120, 0.7);
        const y = new Float32Array(n);
        for (let i = 0; i < n; i++) {
            const t = i / SR;
            y[i] = sub[i] * Math.exp(-t / 0.6) * 1.1 + nz[i] * Math.exp(-t / 0.25) * 0.9;
        }
        return reverb(y, 1.4, 0.35, 2);
    },
    thunder() {
        const n = Math.round(2.6 * SR);
        const x = new Float32Array(n);
        for (let i = 0; i < n; i++) {
            const t = i / SR;
            const crackle = rand() < 0.004 * Math.exp(-t * 2) ? 6 : 1;
            x[i] = noise() * crackle * Math.exp(-t / 0.7);
        }
        const y = sweepFilter(x, 'lp', p => 3000 * Math.exp(-p * 3) + 150, 0.6);
        return reverb(y, 1.5, 0.4, 2);
    },
    slam() {
        const y = sinePitch(0.3, 200, 60, 2);
        const n = y.length;
        const nz = sweepFilter(Float32Array.from({ length: n }, noise), 'bp', () => 2200, 0.9);
        for (let i = 0; i < n; i++) {
            const t = i / SR;
            y[i] = y[i] * Math.exp(-t / 0.08) + nz[i] * Math.exp(-t / 0.03) * 1.4;
        }
        return reverb(y, 0.8, 0.2, 0.6);
    },
    door(o) {
        return SYN.reverse({ dur: o.dur || TL.B1 });
    },
    reverse(o) {
        const d = o.dur || 1, n = Math.round(d * SR);
        const x = Float32Array.from({ length: n }, noise);
        const y = sweepFilter(x, 'lp', p => 300 + 5000 * p * p, 0.9);
        for (let i = 0; i < n; i++) y[i] *= Math.pow(i / n, 3) * 1.4;
        return y;
    },
    freeze() {
        const n = Math.round(1.6 * SR), y = new Float32Array(n);
        const sub = sinePitch(1.6, 90, 30, 1);
        let ph = 0;
        for (let i = 0; i < n; i++) {
            const t = i / SR;
            ph += (2 * Math.PI * 2093) / SR;
            y[i] = sub[i] * Math.exp(-t / 0.5) + Math.sin(ph) * 0.12 * Math.exp(-t / 0.9);
        }
        return reverb(y, 1.6, 0.45, 2.5);
    },
    heartbeat() {
        const y = buf(0.5);
        for (const off of [0, 0.17]) {
            const b = sinePitch(0.2, 70, 40, 2);
            const s = Math.round(off * SR);
            for (let i = 0; i < b.length && s + i < y.length; i++) y[s + i] += b[i] * Math.exp(-i / (0.05 * SR)) * (off ? 0.7 : 1);
        }
        return y;
    },
    shatter() {
        const n = Math.round(0.9 * SR), x = new Float32Array(n);
        for (let k = 0; k < 40; k++) {
            const s = Math.round(rand() * 0.5 * SR), f = 2500 + rand() * 5000, d = 0.02 + rand() * 0.08;
            let ph = 0;
            for (let i = 0; i < d * SR * 4 && s + i < n; i++) {
                ph += (2 * Math.PI * f) / SR;
                x[s + i] += (Math.sin(ph) * 0.25 + noise() * 0.35) * Math.exp(-i / (d * SR));
            }
        }
        return reverb(sweepFilter(x, 'hp', () => 1800, 0.7), 1, 0.35, 1.2);
    }
};

function mixInto(L, R, src, at, gain, pan = 0) {
    const [sl, sr] = Array.isArray(src) ? src : [src, src];
    const s0 = Math.round(at * SR);
    const gl = gain * Math.min(1, 1 - pan), gr = gain * Math.min(1, 1 + pan);
    for (let i = 0; i < sl.length; i++) {
        const k = s0 + i;
        if (k < 0) continue;
        if (k >= N) break;
        L[k] += sl[i] * gl;
        R[k] += sr[i] * gr;
    }
}

function buildMusic() {
    const L = new Float32Array(N), R = new Float32Array(N);
    const XF = Math.round(0.012 * SR);
    for (const [file, s0, s1, d0, opt] of TL.MUSIC) {
        const [sl, sr] = load(file);
        const a = Math.round(s0 * SR), b = Math.min(Math.round(s1 * SR), sl.length), d = Math.round(d0 * SR);
        const len = b - a;
        for (let i = 0; i < len; i++) {
            const k = d + i;
            if (k >= N) break;
            let g = Math.min(1, i / XF, (len - i) / XF);
            if (opt.fadeIn) g *= Math.min(1, i / (opt.fadeIn * SR));
            if (opt.fadeOutAt) {
                const t = k / SR;
                g *= Math.max(0, Math.min(1, 1 - (t - opt.fadeOutAt) / (TL.DURATION - 0.05 - opt.fadeOutAt)));
            }
            L[k] += sl[a + i] * g;
            R[k] += sr[a + i] * g;
        }
        // 시간이 멈추는 순간: 재생 속도가 0까지 떨어진다
        if (opt.tapeStop) {
            const T = opt.tapeStop, n = Math.round(T * SR);
            for (let i = 0; i < n; i++) {
                const tau = i / SR;
                const p = tau - (tau * tau) / (2 * T);
                const pos = b + p * SR;
                const j = Math.floor(pos), f = pos - j;
                if (j + 1 >= sl.length) break;
                const g = Math.pow(1 - tau / T, 0.6) * Math.min(1, i / XF);
                const k = d + len + i;
                if (k >= N) break;
                L[k] += (sl[j] * (1 - f) + sl[j + 1] * f) * g;
                R[k] += (sr[j] * (1 - f) + sr[j + 1] * f) * g;
            }
        }
    }
    return [L, R];
}

function buildSfx() {
    const L = new Float32Array(N), R = new Float32Array(N);
    for (const [t, name, gdb, opt] of TL.SFX) {
        let src;
        if (name.startsWith('synth:')) {
            const fn = SYN[name.slice(6)];
            if (!fn) throw new Error('unknown synth ' + name);
            src = fn(opt || {});
        } else src = load(name);
        const pan = opt && opt.pan ? opt.pan : 0;
        mixInto(L, R, src, t, db(gdb), pan);
    }
    return [L, R];
}

function writeWav(file, L, R) {
    const n = L.length, data = Buffer.alloc(n * 8);
    for (let i = 0; i < n; i++) {
        data.writeFloatLE(L[i], i * 8);
        data.writeFloatLE(R[i], i * 8 + 4);
    }
    const h = Buffer.alloc(44);
    h.write('RIFF', 0);
    h.writeUInt32LE(36 + data.length, 4);
    h.write('WAVE', 8);
    h.write('fmt ', 12);
    h.writeUInt32LE(16, 16);
    h.writeUInt16LE(3, 20);
    h.writeUInt16LE(2, 22);
    h.writeUInt32LE(SR, 24);
    h.writeUInt32LE(SR * 8, 28);
    h.writeUInt16LE(8, 32);
    h.writeUInt16LE(32, 34);
    h.write('data', 36);
    h.writeUInt32LE(data.length, 40);
    fs.writeFileSync(file, Buffer.concat([h, data]));
}

(() => {
    const [mL, mR] = buildMusic();
    const [sL, sR] = buildSfx();
    // 효과음이 클 때 음악을 살짝 낮춘다
    const L = new Float32Array(N), R = new Float32Array(N);
    let envl = 0;
    const att = Math.exp(-1 / (0.005 * SR)), rel = Math.exp(-1 / (0.25 * SR));
    for (let i = 0; i < N; i++) {
        const lv = Math.max(Math.abs(sL[i]), Math.abs(sR[i]));
        envl = lv > envl ? att * envl + (1 - att) * lv : rel * envl + (1 - rel) * lv;
        const duck = 1 / (1 + envl * 1.2);
        L[i] = mL[i] * 0.82 * duck + sL[i] * 0.9;
        R[i] = mR[i] * 0.82 * duck + sR[i] * 0.9;
    }
    // 부드러운 클리핑
    for (let i = 0; i < N; i++) {
        L[i] = Math.tanh(L[i] * 1.1) / 1.1;
        R[i] = Math.tanh(R[i] * 1.1) / 1.1;
    }
    const raw = path.join(CACHE, 'audio_raw.wav');
    writeWav(raw, L, R);
    // 2회 loudnorm: 측정 후 선형 보정
    const r = spawnSync('ffmpeg', ['-hide_banner', '-i', raw, '-af', 'loudnorm=I=-14:TP=-2.5:LRA=11:print_format=json', '-f', 'null', '-'], { encoding: 'utf8' });
    const j = JSON.parse(r.stderr.slice(r.stderr.lastIndexOf('{'), r.stderr.lastIndexOf('}') + 1));
    const af = `loudnorm=I=-14:TP=-2.5:LRA=11:measured_I=${j.input_i}:measured_TP=${j.input_tp}:measured_LRA=${j.input_lra}:measured_thresh=${j.input_thresh}:offset=${j.target_offset}:linear=true`;
    const out = path.join(CACHE, 'audio.wav');
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', raw, '-af', af, '-ar', String(SR), '-c:a', 'pcm_s24le', out]);
    console.log(`audio: input ${j.input_i} LUFS / ${j.input_tp} dBTP → ${path.relative(process.cwd(), out)}`);
})();
