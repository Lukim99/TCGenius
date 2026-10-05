# 홍보영상 사운드 믹스: 실제 레이드 BGM 두 곡 + 게임 효과음 샘플을 영상 타이밍에 배치한다.
import subprocess, sys, random
U = '/home/user/TCGenius/DB/RPGenius/ui/sfx/'
OUT = sys.argv[1]
DUR = 50.0
random.seed(7)

inputs, chains, labels = [], [], []
def add(path, at, vol=1.0, extra='', trim=None):
    i = len(inputs) // 2
    inputs.extend(['-i', path])
    f = f'[{i}:a]aformat=sample_rates=48000:channel_layouts=stereo'
    if trim: f += f',atrim={trim[0]}:{trim[1]},asetpts=PTS-STARTPTS'
    if extra: f += ',' + extra
    f += f',volume={vol},adelay={int(at*1000)}|{int(at*1000)}[s{i}]'
    chains.append(f); labels.append(f'[s{i}]')

# --- 음악 ---
# 1관문: 0초부터, 22.3~23.1 교차
add(U + 'E세계대저택 1관문.mp3', 0, 0.9, 'atrim=0:23.2,afade=t=in:st=0:d=1.2,afade=t=out:st=22.3:d=0.9')
# 2관문: 곡의 4.3초 타격이 2관문 표제(22.7초)에 맞도록 3.9초부터 재생
m2 = ('atrim=3.9:31.6,asetpts=PTS-STARTPTS,afade=t=in:st=0:d=0.5,'
      # 틀이 깨졌다(33.9~35.6)에서 숨을 죽였다가 잔향 등장에서 복귀
      "volume='if(between(t,11.5,13.3),0.18,if(between(t,11.0,11.5),1-(t-11.0)*1.64,if(between(t,13.3,13.6),0.18+(t-13.3)*2.73,1)))':eval=frame,"
      'afade=t=out:st=25.0:d=2.6')
add(U + 'E세계대저택 2관문.mp3', 22.4, 0.95, m2)

# --- 효과음 ---
R = U + 'raid/'
low_boom = 'asetrate=48000*0.62,aresample=48000,aecho=0.8:0.7:120|260:0.45|0.3,lowpass=f=3200'
boom = 'aecho=0.8:0.6:90|200:0.35|0.22'
add(R + 'resonance-blast.mp3', 4.2, 1.0, low_boom)                       # 표지 등장
add(R + 'shards-impact.mp3', 8.0, 0.8, boom)
for at in (11.55, 12.05, 12.6, 13.1):
    add(R + 'shards-fall.mp3', at, 0.75)
add(R + 'shards-impact.mp3', 12.95, 0.9, boom)
add(R + 'gloss.mp3', 13.85, 0.9, boom)                                   # 단단해지기
add(R + 'beep.mp3', 15.45, 0.5)
add(R + 'charge.mp3', 16.8, 0.6)                                         # 기둥
add(R + 'gloss.mp3', 18.05, 0.9, boom)                                   # 눈뜬 장님
add(R + 'shards-impact.mp3', 18.3, 0.7)
add(R + 'wall-hum.mp3', 20.2, 0.7, 'asetrate=48000*0.8,aresample=48000,' + boom)   # 관문 전환
add(R + 'resonance-blast.mp3', 22.7, 0.9, low_boom)                      # 2관문
for at in (24.34, 25.34):
    add(R + 'beep.mp3', at, 0.7)
add(R + 'charge.mp3', 24.6, 0.7)
add(R + 'resonance-blast.mp3', 26.3, 1.0, boom)                          # 공명 폭발
for at in (26.75, 26.95):
    add(R + 'beep.mp3', at, 0.6)
add(R + 'rupture.mp3', 27.0, 0.7)                                        # 되울림
add(R + 'wall-hum.mp3', 28.0, 0.9, boom)                                 # 울리는 벽
add(R + 'charge.mp3', 29.25, 0.7, boom)                                  # 시련
add(U + 'crit.mp3', 30.85, 0.9, boom)                                    # 피카츄
add(R + 'rupture.mp3', 31.65, 1.0, boom)                                 # 보호막 파괴
add(R + 'wall-hum.mp3', 32.6, 0.7, 'asetrate=48000*0.7,aresample=48000')
add(R + 'charge.mp3', 33.0, 0.6, 'asetrate=48000*0.75,aresample=48000')
add(R + 'resonance-blast.mp3', 33.9, 1.0, low_boom)                      # 틀이 깨졌다
add(R + 'rupture.mp3', 33.92, 0.9, boom)
add(R + 'resonance-blast.mp3', 35.7, 1.0, low_boom)                      # 잔향 등장
add(R + 'rupture.mp3', 38.75, 0.9, boom)                                 # 붉은 파열
add(U + 'crit.mp3', 39.3, 0.8)
add(U + 'clear.mp3', 40.55, 1.0, boom)                                   # 클리어
add(R + 'gloss.mp3', 41.2, 0.6, boom)
add(R + 'resonance-blast.mp3', 43.9, 0.85, low_boom)                     # 엔딩 타이틀

# 전투 타격음: 실제 플레이 구간에 공격 리듬으로 낮게 깐다
quiet = [(20.2, 22.9), (33.8, 35.8)]
t = 8.3
while t < 40.3:
    if not any(a <= t <= b for a, b in quiet):
        add(U + f'hit_{random.randint(0, 2)}.mp3', t, 0.22 + random.random() * .12)
    t += 0.38 + random.random() * 0.3

n = len(labels)
graph = ';'.join(chains) + ';' + ''.join(labels) + f'amix=inputs={n}:normalize=0:dropout_transition=0,' \
        f'alimiter=limit=0.92:level=false,atrim=0:{DUR},afade=t=out:st={DUR-1.2}:d=1.2[out]'
cmd = ['ffmpeg', '-v', 'error', '-y'] + inputs + ['-filter_complex', graph, '-map', '[out]', '-ar', '48000', '-c:a', 'pcm_s16le', OUT]
subprocess.run(cmd, check=True)
print('mixed', n, 'tracks')
