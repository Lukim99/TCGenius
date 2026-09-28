#!/usr/bin/env python3
"""Prepares the in-game image assets used by the pop film (film #2).

Reads the game's own art (DB/RPGenius/{ui,cardImage,itemImage}, restored from git history) and writes
src/assets/: trimmed sprites with white sticker outlines, individual monsters cropped from the field atlases,
ASCII-named effect illustrations, backgrounds, item icons, UI pieces, real card composites
(background + character art + border, exactly like the game draws them), the fusion effect GIF frames
and ad/sizes.js (pixel sizes for layout).
Usage: python3 prep_assets.py
"""
import glob
import json
import os

from PIL import Image, ImageFilter, ImageSequence

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, '..', '..', '..', 'DB', 'RPGenius')
UI = SRC + '/ui'
OUT = os.path.join(HERE, 'assets')


def trim(im, thr=8):
    bb = im.getchannel('A').point(lambda v: 255 if v > thr else 0).getbbox()
    return im.crop(bb) if bb else im


def sticker(im, r, color=(255, 255, 255, 255)):
    """White sticker border of ~r px around the alpha shape (smooth, via blur + threshold)."""
    pad = r * 2 + 4
    big = Image.new('RGBA', (im.width + 2 * pad, im.height + 2 * pad), (0, 0, 0, 0))
    big.paste(im, (pad, pad), im)
    a = big.getchannel('A').point(lambda v: 255 if v > 60 else 0)
    grown = a.filter(ImageFilter.GaussianBlur(r * .75)).point(lambda v: 255 if v > 14 else 0).filter(ImageFilter.GaussianBlur(1.2))
    layer = Image.new('RGBA', big.size, color)
    layer.putalpha(grown)
    layer.alpha_composite(big)
    return trim(layer, 4)


def save(im, path, maxw=None, maxh=None):
    if maxw or maxh:
        k = min((maxw or 1e9) / im.width, (maxh or 1e9) / im.height, 1)
        if k < 1:
            im = im.resize((round(im.width * k), round(im.height * k)), Image.LANCZOS)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if path.endswith('.jpg'):
        im.convert('RGB').save(path, quality=90)
    else:
        im.save(path, optimize=True)
    return im.size


# ---- heroine: the anime-style showcase character (no real-person likeness) ----
HERO = {'base': '오버라이드.png', 'chibi': '오버라이드__일반__백만뷰.png', 'job': '오버라이드__전직.png', 'star': '오버라이드__전직__1억뷰.png'}
for k, f in HERO.items():
    im = trim(Image.open(UI + '/필드/캐릭터/' + f).convert('RGBA'))
    save(im, OUT + '/hero/%s.png' % k, maxh=1300)
    save(sticker(im, 16), OUT + '/hero/%s_st.png' % k, maxh=1340)
save(sticker(trim(Image.open(UI + '/봉인된 자물쇠/캐릭터.png').convert('RGBA')), 12), OUT + '/hero/lockgirl_st.png', maxh=1000)

# ---- monsters: crop every cell of the field atlases (2 columns), then sticker them ----
for f in sorted(glob.glob(UI + '/필드/몬스터/*-clean.png')):
    im = Image.open(f).convert('RGBA')
    tag = os.path.basename(f).replace('field-atlas-', 'a').replace('-clean.png', '')
    cw = im.width // 2
    rows = im.height // cw
    ch = im.height // rows
    for r in range(rows):
        for c in range(2):
            cell = trim(im.crop((c * cw, r * ch, (c + 1) * cw, (r + 1) * ch)))
            save(cell, OUT + '/mon/%s_%d%d.png' % (tag, r, c))
            save(sticker(cell, 7), OUT + '/mon/%s_%d%d_st.png' % (tag, r, c))
for k, f in {'boss': 'hfield-buta.png', 'hunter': 'hfield-hunter.png', 'pillar': 'hfield-pillar.png'}.items():
    im = trim(Image.open(UI + '/필드/' + f).convert('RGBA'))
    save(im, OUT + '/mon/%s.png' % k, maxh=1100)
    save(sticker(im, 12), OUT + '/mon/%s_st.png' % k, maxh=1140)
for k, f in {'sigil_red': 'hfield-transcend-sigil.png', 'sigil_blue': 'hfield-mythic-sigil.png', 'impact': 'hfield-impact-v2.png'}.items():
    save(trim(Image.open(UI + '/필드/' + f).convert('RGBA')), OUT + '/fx/%s.png' % k, maxw=1000)

# ---- effect illustrations (skill / combat / element) ----
FX = {
    'phoenix': '스킬/불사조', 'ice': '스킬/빙결', 'goldpillar': '스킬/백억이요', 'stars': '스킬/SUPER EASY', 'clover': '스킬/럭키펀치',
    'cards': '스킬/포커 못 하시네', 'explode': '스킬/자폭', 'bigbang': '스킬/빅뱅', 'kick': '스킬/KICK BACK', 'burst54': '스킬/54버스트',
    'jackpot': '스킬/초특급한탕', 'clap': '스킬/처형박수', 'redrings': '스킬/핫식스의정력', 'bluewhirl': '스킬/이어브피', 'fist': '스킬/정권',
    'boss_end': '스킬/끝판왕', 'danger': '스킬/댄져', 'bolt': '스킬/자인', 'redstorm': '스킬/시벌론', 'goldstaff': '스킬/유드 알레프',
    'blueknight': '스킬/피아스트', 'bloodfang': '스킬/피의 맛', 'thanks': '스킬/감사합니다 친구야', 'swirl': '스킬/나인 멘스 모리스', 'accel': '스킬/가속',
    'karma': '스킬/카르마', 'counter_s': '스킬/카운터', 'redclaw': '스킬/안면강타', 'water_s': '스킬/청정수 투척',
    'fire': '속성/화', 'water': '속성/수', 'light': '속성/명', 'dark': '속성/암',
    'crit': '전투/치명타', 'critfix': '전투/치명타 확정', 'critup': '전투/치명타 피해 증가', 'critrate': '전투/치명타 확률 증가',
    'skyburst': '전투/천공 폭발', 'fireburst': '전투/화상 폭발', 'judge': '전투/심판 표식', 'prism': '전투/프리즘 추가 공격',
    'combo': '전투/연격 추가타', 'gold': '전투/골드 획득', 'heal': '전투/HP 회복', 'shield': '전투/보호막 부여', 'buff': '전투/버프',
    'atkup': '전투/공격력 강화', 'invincible': '전투/무적', 'crescent': '전투/기본 공격', 'shadow': '전투/그림자 공격', 'fate': '전투/운명 피해',
    'speed': '전투/쿨타임 감소', 'stack': '전투/중첩 획득', 'shieldbreak': '전투/보호막 파괴', 'freeze': '전투/빙결', 'mark': '전투/표식 부여',
}
for k, f in FX.items():
    save(Image.open(UI + '/필드/이펙트/' + f + '.png').convert('RGBA'), OUT + '/fx/%s.png' % k)

# ---- backgrounds (fields) + the heroine's key art ----
BG = {'woldo5': '월도랜드5', 'woldo1': '월도랜드1', 'resort': '리조트', 'pirate': '극한의농락전', 'arena': '스코어서바이벌', 'hell': '부타게임H',
      'mansion': '이세계대저택', 'war': '해고전쟁시대', 'motel': '더타임모텔', 'town': '뉴비즈', 'crystal': '밍닝스플랜', 'oracle': '예언의결속', 'castle': '관찰자들의 도시'}
for k, f in BG.items():
    im = Image.open(UI + '/필드/' + f + '.png').convert('RGB')
    im = im.resize((1920, round(im.height * 1920 / im.width)), Image.LANCZOS)
    if im.height < 1080:
        im = im.resize((round(im.width * 1080 / im.height), 1080), Image.LANCZOS)
    save(im, OUT + '/bg/%s.jpg' % k)
save(Image.open(SRC + '/cardImage/카드분리/캐릭터/오버라이드/캐릭터표지(각성).png').convert('RGB'), OUT + '/bg/cover_awaken.jpg')

# ---- real card composites: background + character art + border, as the game draws them ----
FR = SRC + '/cardImage/카드분리/프레임/'
CH = SRC + '/cardImage/카드분리/캐릭터/오버라이드/'
COMPOSE = {
    'c_nor5': ('일반카드/일반카드 5성 배경', '일반 오버라이드', '일반카드/일반카드 5성 테두리'),
    'c_nor6': ('일반카드/일반카드 6성 배경', '일반 백만뷰 오버라이드', '일반카드/일반카드 6성 테두리'),
    'c_nor7': ('일반카드/일반카드 7성 제타 배경', '일반 1억뷰 오버라이드', '일반카드/일반카드 제타 테두리'),
    'c_job8': ('전직카드/전직카드 8성 배경', '전직 오버라이드', '전직카드/전직카드 8성 테두리'),
    'c_jobS': ('전직카드/전직카드 시그마 배경', '전직 오버라이드', '전직카드/전직카드 시그마 테두리'),
    'c_jobO': ('전직카드/전직카드 오메가 배경', '전직 1억뷰 오버라이드', '전직카드/전직카드 오메가 테두리'),
    'c_pO': ('전직카드/전직카드 프레스티지 오메가 배경', '프레스티지 전직 1억뷰 오버라이드', None),
}
for k, (bg, art, border) in COMPOSE.items():
    base = Image.open(FR + bg + '.png').convert('RGBA')
    base.alpha_composite(Image.open(CH + art + '.png').convert('RGBA').resize(base.size))
    if border:
        base.alpha_composite(Image.open(FR + border + '.png').convert('RGBA').resize(base.size))
    save(base, OUT + '/cards/%s.png' % k)

# ---- items ----
ITEMS = {'eq_033': '레전더리 셀레스티아', 'eq_115': '신화 더 킹메이커', 'eq_025': '신화 정복자의 최후통첩', 'eq_039': '신화 종말을 걷는 장송곡',
         'eq_122': '초월 레인보우 프리즘', 'eq_035': '레전더리 운명의 아이온', 'eq_192': '신화 심판의 주사위', 'eq_163': '레전더리 불멸하는 업화의 용갑',
         'eq_060': '신화 블라디미르', 'eq_129': '신화 행운의 장갑'}
for k, name in ITEMS.items():
    p = glob.glob(SRC + '/itemImage/장비/**/' + name + '.png', recursive=True)
    save(trim(Image.open(p[0]).convert('RGBA')), OUT + '/items/%s.png' % k, maxw=360, maxh=360)
for k, f in {'pack5': '가챠/5성 카드팩', 'pack6j': '가챠/6성 전직 카드팩', 'gold': '화폐/골드'}.items():
    save(trim(Image.open(SRC + '/itemImage/' + f + '.png').convert('RGBA')), OUT + '/items/%s.png' % k, maxw=360, maxh=360)

# ---- UI pieces ----
UIP = {'t_god': '칭호/강화의 신', 't_master': '칭호/강화의 달인', 't_great': '칭호/강화의 대가', 't_mega': '칭호/MEGA BURNING',
       't_200': '칭호/200', 't_300': '칭호/300', 't_allstar': '칭호/2024올스타', 't_dva': '칭호/DVA온라인', 't_mz': '칭호/MZ사원', 't_newbie': '칭호/뉴비즈 학살자',
       't_rain': '칭호/나는 레인 수비해', 'lucky100': '조합/럭키100%', 'slot1': '조합/카드1', 'slot2': '조합/카드2', 'slot3': '조합/카드3',
       'lock_art': '봉인된 자물쇠/밑바탕', 'lock_title': '봉인된 자물쇠/글씨', 'buta_logo': '부타게임/부타게임표지', 'wb': '사냥/월드보스',
       'hunt_normal': '사냥/일반 필드', 'hunt_daily': '사냥/일일던전', 'hunt_hell': '사냥/헬 필드', 'coin100': '100일 캡슐/100일 기념 코인'}
for k, f in UIP.items():
    p = glob.glob(UI + '/' + f + '.*')[0]
    im = Image.open(p).convert('RGBA')
    save(trim(im) if p.endswith('.png') else im, OUT + '/ui/%s.png' % k, maxw=1400)

# ---- the real fusion effect (조합-이펙트.gif, 43 frames x 30 ms) ----
gif = Image.open(UI + '/조합/조합-이펙트.gif')
for i, fr in enumerate(ImageSequence.Iterator(gif)):
    save(fr.convert('RGBA'), OUT + '/gif/%02d.png' % i)

# ---- pixel sizes for layout ----
sizes = {}
for root, _, files in os.walk(OUT):
    for f in files:
        if f.endswith(('.png', '.jpg')):
            p = os.path.join(root, f)
            with Image.open(p) as im:
                sizes[os.path.relpath(p, OUT)] = list(im.size)
with open(os.path.join(HERE, 'ad', 'sizes.js'), 'w') as fh:
    fh.write('window.SIZES = ' + json.dumps(sizes, ensure_ascii=False) + ';\n')
print('assets:', len(sizes))
