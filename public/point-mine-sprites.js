// Lukim99/point-mine src/lib/sprites.ts의 실제 그림 경계와 atlasSpriteStyle을 사용한다.
const bounds = {
    pickaxes: [[53,35,283,279],[356,36,586,279],[661,36,888,279],[967,35,1196,283],[41,340,275,595],[348,341,582,597],[652,341,887,596],[960,340,1195,597],[38,649,271,903],[346,647,583,905],[649,646,884,906],[956,646,1192,905],[32,953,269,1214],[341,952,579,1214],[647,952,884,1214],[955,951,1191,1214]],
    ores: [[128,31,286,168],[463,29,622,170],[795,30,956,170],[1130,30,1290,170],[127,220,287,360],[461,220,622,359],[801,228,949,351],[1138,221,1282,357],[148,410,260,550],[467,401,609,559],[824,410,926,550],[1162,410,1273,550],[128,602,280,732],[461,606,616,739],[793,605,958,739],[1143,588,1291,749]],
    chests: [[93,103,560,562]], openChests: [[120,53,594,574]]
};

export function sprite(sheet, index, name, size = '') {
    const [left, top, right, bottom] = bounds[sheet][index];
    const [width, height] = sheet === 'ores' ? [1408, 768] : [1254, 1254];
    const spriteWidth = right - left, spriteHeight = bottom - top;
    const frame = Math.max(spriteWidth, spriteHeight) * 1.06;
    const outer = document.createElement('span');
    outer.className = 'pm-sprite ' + size;
    outer.setAttribute('role', 'img'); outer.setAttribute('aria-label', name);
    const art = document.createElement('span');
    art.style.width = `${spriteWidth / frame * 100}%`;
    art.style.height = `${spriteHeight / frame * 100}%`;
    art.style.backgroundImage = `url(/static/assets/point-mine/${sheet === 'openChests' ? 'chests-open' : sheet}.png)`;
    art.style.backgroundSize = `${width / spriteWidth * 100}% ${height / spriteHeight * 100}%`;
    art.style.backgroundPosition = `${left / (width - spriteWidth) * 100}% ${top / (height - spriteHeight) * 100}%`;
    outer.appendChild(art);
    return outer;
}
