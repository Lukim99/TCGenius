let healnum = Math.round(hunt.tempObj.stat[user.playing.hunt.number].maxHp * 0.1);
hunt.tempObj.stat[user.playing.hunt.number].hp = Math.min(hunt.tempObj.stat[user.playing.hunt.number].maxHp, hunt.tempObj.stat[user.playing.hunt.number].hp + healnum);
eatMessage.push(hunt.tempObj.name[user.playing.hunt.number] + "님의 HP: " + hunt.tempObj.stat[user.playing.hunt.number].hp.toComma() + "/" + hunt.tempObj.stat[user.playing.hunt.number].maxHp.toComma() + " (+" + healnum + ")");
hunt.save();