(function(){
    'use strict';
    const canvas=document.getElementById('wbCanvas'),hudCanvas=document.getElementById('wbHud');
    if(!canvas||!hudCanvas)return;
    const clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),ratio=(v,m)=>m>0?clamp(Number(v||0)/Number(m),0,1):0;
    const number=v=>Math.round(Number(v||0)).toLocaleString('ko-KR');
    const uiAsset=file=>'/rpg-ui?file='+encodeURIComponent(file),effectCatalog=window.CombatEffects;
    const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)').matches;
    const sideX=(side,narrow)=>side==='target'?(narrow?.70:.67):(narrow?.23:.27);
    const combatPopY=()=>innerWidth<700?.6:.44,recoveryPopY=()=>innerWidth<700?.66:.5;
    const SOUNDS={bgm:uiAsset('boss fight.mp3'),start:uiAsset('sfx/start.mp3'),hit0:uiAsset('sfx/hit_0.mp3'),hit1:uiAsset('sfx/hit_1.mp3'),hit2:uiAsset('sfx/hit_2.mp3'),crit:uiAsset('sfx/crit.mp3'),skill:uiAsset('sfx/skill.mp3'),clear:uiAsset('sfx/clear.mp3'),fail:uiAsset('sfx/fail.mp3'),count:uiAsset('sfx/count.mp3'),potion:uiAsset('sfx/potion.mp3')};
    let state=null,busy=false,syncing=false,clockOffset=0,logs=[],selectedBoss='',notice=null,noticeUntil=0,presentationEpoch=0;

    // Use the same audio assets, levels and gesture unlock as the other WebGL fields.
    class WorldBossAudio{
        constructor(){this.muted=false;try{this.muted=localStorage.getItem('worldboss-muted')==='1';}catch(_){}this.bgm=new Audio(SOUNDS.bgm);this.bgm.loop=true;this.bgm.volume=.2;}
        unlock(){if(this.muted)return;const Context=window.AudioContext||window.webkitAudioContext;if(Context&&!this.context)this.context=new Context();if(this.context&&this.context.state==='suspended')this.context.resume().catch(()=>{});this.playBgm();}
        play(name,volume){if(this.muted||!SOUNDS[name])return;const sound=new Audio(SOUNDS[name]);sound.volume=volume==null?.5:volume;sound.play().catch(()=>{});}
        hit(){this.play('hit'+Math.floor(Math.random()*3),.48);}
        playBgm(){if(!this.muted&&state&&state.inField&&this.bgm.paused&&!document.hidden)this.bgm.play().catch(()=>{});}
        stopBgm(){this.bgm.pause();}
        toggle(){this.muted=!this.muted;try{localStorage.setItem('worldboss-muted',this.muted?'1':'0');}catch(_){}if(this.muted)this.stopBgm();else{this.unlock();this.play('count',.32);}}
    }

    async function request(path,body){
        const response=await fetch(path,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined,credentials:'same-origin'});
        const data=await response.json().catch(()=>({}));
        if(!response.ok)throw new Error(data.error||'요청을 처리하지 못했습니다.');
        return data;
    }
    function addLog(text,tone){String(text||'').split(/\r?\n/).filter(line=>line&&!/^[-\s]*$/.test(line)).slice(0,4).forEach(line=>logs.push({text:line.replace(/^[-*]\s*/,''),tone:tone||''}));if(logs.length>20)logs=logs.slice(-20);}
    function showNotice(text){notice=String(text||'');noticeUntil=performance.now()+1800;}
    function applyState(next){if(!next)return;const entering=next.inField&&!(state&&state.inField);state=next;clockOffset=Number(next.serverNow||Date.now())-Date.now();if(!selectedBoss&&next.bosses&&next.bosses.length)selectedBoss=next.bosses[0].name;renderer.applyState(next);if(entering){logs=[];presentationEpoch++;hud.damagePops=[];audio.play('start',.76);hud.showBanner('전투 시작',next.current.name);hud.impact(true);}if(next.inField)audio.playBgm();else{audio.stopBgm();hud.consumableMenu=false;}renderSelection();}

    const selectionLayer=document.getElementById('wbSelection'),skillCards=document.getElementById('wbSkillCards');
    let selectionKey='';
    function renderSelection(){
        if(!selectionLayer)return;
        const visible=!!(state&&state.selecting);selectionLayer.hidden=!visible;
        if(!visible){selectionKey='';return;}
        const candidates=state.candidates||[],key=JSON.stringify(candidates);
        if(key!==selectionKey){
            selectionKey=key;skillCards.replaceChildren();
            candidates.forEach((skill,index)=>{
                const card=document.createElement('article');card.className='wb-skill-card';
                const number=document.createElement('span');number.className='wb-skill-number';number.textContent='0'+(index+1);
                const title=document.createElement('h2');title.textContent=skill.name;
                const meta=document.createElement('div');meta.className='wb-skill-meta';
                ['MP '+skill.mpCost,'재사용 '+skill.cooldownMs/1000+'초'].forEach(text=>{const badge=document.createElement('span');badge.textContent=text;meta.append(badge);});
                const description=document.createElement('div');description.className='wb-skill-desc';
                String(skill.desc||'').split(/\n+|(?<=\.)\s+/).filter(Boolean).forEach(line=>{
                    const paragraph=document.createElement('p');
                    line.split(/(\d+(?:\.\d+)?%?)/g).forEach(part=>{
                        if(/^\d/.test(part)){const strong=document.createElement('strong');strong.textContent=part;paragraph.append(strong);}
                        else paragraph.append(document.createTextNode(part));
                    });
                    description.append(paragraph);
                });
                const button=document.createElement('button');button.type='button';button.className='wb-skill-select';
                button.textContent='선택';button.setAttribute('aria-label',skill.name+' 선택');button.onclick=()=>selectSkill(index+1);
                card.append(number,title,meta,description,button);skillCards.append(card);
            });
            selectionLayer.scrollTop=0;
        }
        selectionLayer.querySelectorAll('button').forEach(button=>button.disabled=busy);
    }

    class Renderer{
        constructor(canvas){
            this.canvas=canvas;this.gl=canvas.getContext('webgl',{alpha:false,antialias:true});
            this.textures=new Map();this.active='idle';this.animationAt=performance.now();
            this.effect=null;this.lastState=null;this.lastPose=null;this.previousPose=null;this.effectSprites=[];this.recentEffects=new Map();this.playerAttackAt=-1000;this.hitUntil=0;
            this.frame=requestAnimationFrame(t=>this.render(t));
            if(!this.gl)return;
            const gl=this.gl,vs=gl.createShader(gl.VERTEX_SHADER),fs=gl.createShader(gl.FRAGMENT_SHADER);
            gl.shaderSource(vs,'attribute vec2 p;attribute vec2 t;varying vec2 uv;void main(){gl_Position=vec4(p,0.,1.);uv=t;}');
            gl.shaderSource(fs,'precision mediump float;varying vec2 uv;uniform sampler2D tex;uniform float mode;uniform vec4 tint;void main(){if(mode<.5){gl_FragColor=vec4(.025,.035,.045,1.);}else{vec4 c=texture2D(tex,uv)*tint;if(c.a<.005)discard;gl_FragColor=c;}}');
            gl.compileShader(vs);gl.compileShader(fs);this.program=gl.createProgram();
            gl.attachShader(this.program,vs);gl.attachShader(this.program,fs);gl.linkProgram(this.program);gl.useProgram(this.program);
            this.buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);
            this.p=gl.getAttribLocation(this.program,'p');this.t=gl.getAttribLocation(this.program,'t');
            gl.enableVertexAttribArray(this.p);gl.enableVertexAttribArray(this.t);
            this.mode=gl.getUniformLocation(this.program,'mode');this.tint=gl.getUniformLocation(this.program,'tint');
            gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);
        }
        boss(){return this.lastState&&(this.lastState.current||(this.lastState.bosses||[]).find(b=>b.name===selectedBoss)||(this.lastState.bosses||[])[0]);}
        texture(url){
            if(!url||!this.gl)return null;
            if(!this.textures.has(url)){
                const holder={texture:null,width:0,height:0};this.textures.set(url,holder);
                const img=new Image();img.decoding='async';
                img.onload=()=>{
                    const gl=this.gl,tex=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,tex);
                    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);
                    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
                    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
                    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
                    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
                    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,img);
                    holder.texture=tex;holder.width=img.naturalWidth;holder.height=img.naturalHeight;
                };
                img.onerror=()=>{holder.failed=true;};
                img.src=url;
            }
            return this.textures.get(url);
        }
        applyState(next){
            if(next.inField&&!(this.lastState&&this.lastState.inField)){
                this.active='idle';this.animationAt=performance.now();this.lastPose=null;this.previousPose=null;this.effect=null;this.effectSprites=[];this.recentEffects.clear();
            }
            this.lastState=next;const boss=this.boss();if(!boss)return;
            const assets=boss.assets||{};
            this.texture(assets.backgroundUrl);
            Object.values(assets.animations||{}).forEach(a=>this.texture(a.url));
            Object.values(assets.effects||{}).forEach(url=>this.texture(url));
            this.texture(next.player&&next.player.spriteUrl);
            if(effectCatalog){
                const ids=['combat:기본 공격','combat:치명타','combat:HP 회복','combat:MP 회복'];
                (next.skills||[]).forEach(skill=>ids.push(...effectCatalog.skillEffects(skill.name)));
                ids.forEach(id=>this.texture(effectCatalog.assetUrl(id)));
            }
        }
        transition(action,time,impact){
            const boss=this.boss(),animation=boss&&boss.assets.animations[action];
            // Damage is authoritative on receipt. Show its contact pose immediately,
            // not a new wind-up after the HP has already changed.
            this.previousPose=impact?null:this.lastPose;this.transitionAt=time;
            this.active=action;this.animationAt=time-(impact&&animation?Number(animation.hitFrame||0)/animation.fps*1000:0);
        }
        playEffects(event,role,hit){
            if(!effectCatalog)return;
            const now=performance.now(),candidates=effectCatalog.unique(effectCatalog.effectIdsFor(event,role,hit)).filter(id=>now-(this.recentEffects.get(role+':'+id)??-Infinity)>=760);
            effectCatalog.presentationEffectIds(candidates,2).forEach((id,index)=>{
                const url=effectCatalog.assetUrl(id),profile=effectCatalog.motionProfile(id);this.texture(url);
                this.recentEffects.set(role+':'+id,now);
                this.effectSprites.push({url,role,at:now+index*80,duration:reducedMotion?Math.max(320,profile.duration*.7):profile.duration,profile});
            });
            this.effectSprites=this.effectSprites.slice(-8);
        }
        animate(event){
            if(!event||event.skipped)return;
            const action=event.bossAction||(event.bossRetaliation?'retaliation':'');
            const time=performance.now();
            if(action){
                const key=action==='percentSlash'||action==='retaliation'?'icham':action;
                this.transition(key,time,true);
                const boss=this.boss(),effects=boss&&boss.assets&&boss.assets.effects||{};
                this.effect={url:effects[key],at:time,duration:key==='curse'?700:450};
            }
            if(event.action==='skill'||event.action==='consumable'||event.action==='heal'||event.action==='shield')this.playEffects(event,'actor');
            if((event.action==='attack'||event.action==='skill')&&(Number(event.damage)>0||(event.hits||[]).length))this.playerAttackAt=time;
            if(event.bossDefeated)this.transition('defeat',time);
        }
        strike(side,event,hit){
            if(side==='target')this.playEffects(event,'target',hit);
            else if(!event.bossAction&&!event.bossRetaliation)this.playEffects(event,'actor',hit);
            if(side==='actor'&&Number(hit.damage)>0&&hit.type!=='absorbed'&&hit.type!=='summonAbsorbed')this.hitUntil=performance.now()+180;
        }
        resize(){
            if(!this.gl)return;
            const dpr=Math.min(2,devicePixelRatio||1),w=Math.round(innerWidth*dpr),h=Math.round(innerHeight*dpr);
            if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}
            this.gl.viewport(0,0,w,h);
        }
        draw(texture,x,y,w,h,uv,alpha){
            const gl=this.gl;if(!gl||texture&&!texture.texture)return;
            const x0=x*2-1,x1=(x+w)*2-1,y0=1-(y+h)*2,y1=1-y*2,u=uv||[0,0,1,1];
            const data=new Float32Array([x0,y0,u[0],u[1],x1,y0,u[2],u[1],x0,y1,u[0],u[3],x0,y1,u[0],u[3],x1,y0,u[2],u[1],x1,y1,u[2],u[3]]);
            gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);gl.bufferData(gl.ARRAY_BUFFER,data,gl.DYNAMIC_DRAW);
            gl.vertexAttribPointer(this.p,2,gl.FLOAT,false,16,0);gl.vertexAttribPointer(this.t,2,gl.FLOAT,false,16,8);
            gl.uniform1f(this.mode,texture?1:0);gl.uniform4f(this.tint,1,1,1,alpha==null?1:alpha);
            if(texture)gl.bindTexture(gl.TEXTURE_2D,texture.texture);
            gl.drawArrays(gl.TRIANGLES,0,6);
        }
        drawCover(texture){
            if(!texture||!texture.texture)return;
            const screenAspect=innerWidth/innerHeight,imageAspect=texture.width/texture.height;
            const uw=Math.min(1,screenAspect/imageAspect),vh=Math.min(1,imageAspect/screenAspect);
            // Keep the backlit arena visible in portrait view.
            const u0=(1-uw)*.64,v0=(1-vh)/2;
            this.draw(texture,0,0,1,1,[u0,v0,u0+uw,v0+vh],1);
        }
        pose(animation,time){
            const texture=this.texture(animation.url);
            if(!texture||!texture.texture)return null;
            const count=Math.max(1,Number(animation.frames)),columns=Number(animation.columns);
            let frame=Math.floor(Math.max(0,time-this.animationAt)*Number(animation.fps||8)/1000);
            frame=animation.loop?frame%count:Math.min(count-1,frame);
            const col=frame%columns,row=Math.floor(frame/columns);
            const fw=animation.frameWidth,fh=animation.frameHeight;
            // Sheet rows are top-to-bottom; uploaded WebGL textures are flipped vertically.
            const uv=[(col*fw+.5)/texture.width,1-((row+1)*fh-.5)/texture.height,((col+1)*fw-.5)/texture.width,1-(row*fh+.5)/texture.height];
            return {texture,uv,frame};
        }
        drawSheet(animation,x,y,w,h,time){
            if(!animation)return;
            let pose=this.pose(animation,time);
            if(!pose){
                this.animationAt=time;
                pose=this.lastPose;
                if(!pose)return;
            }
            const mix=clamp((time-Number(this.transitionAt||0))/80,0,1);
            if(this.previousPose&&mix<1)this.draw(this.previousPose.texture,x,y,w,h,this.previousPose.uv,1-mix);
            this.draw(pose.texture,x,y,w,h,pose.uv,this.previousPose?mix:1);
            this.lastPose=pose;
            if(mix>=1)this.previousPose=null;
            if(!animation.loop&&pose.frame===animation.frames-1&&time-this.animationAt>=animation.frames/animation.fps*1000&&this.active!=='defeat'){
                this.transition('idle',time);
            }
        }
        render(time){
            this.resize();const gl=this.gl;
            if(gl){
                gl.useProgram(this.program);gl.clearColor(.025,.035,.045,1);gl.clear(gl.COLOR_BUFFER_BIT);
                const boss=this.boss();
                if(boss){
                    const assets=boss.assets||{};this.drawCover(this.texture(assets.backgroundUrl));
                    if(this.lastState.inField||this.active==='defeat'){
                        const w=innerWidth,h=innerHeight,narrow=w<680,animations=assets.animations||{};
                        const animation=animations[this.active]||animations.idle;
                        // Fit in CSS pixels, preserve the source aspect and never stretch the 480px sheet.
                        const height=Math.min(480,h*.57,w*(narrow?.43:.32)*480/270);
                        const shake=!reducedMotion&&time<this.hitUntil?Math.sin(time*.12)*4:0;
                        const width=height*270/480,center=w*(narrow?.70:.67)+shake,floor=h*(narrow?.75:.79);
                        this.drawSheet(animation,(center-width/2)/w,(floor-height)/h,width/w,height/h,time);
                        const player=this.texture(this.lastState.player&&this.lastState.player.spriteUrl);
                        if(player&&player.texture){
                            const ph=Math.min(height*.72,320),pw=Math.min(ph*player.width/player.height,w*.32);
                            const fitH=pw*player.height/player.width;
                            const lunge=reducedMotion?0:Math.sin(clamp((time-this.playerAttackAt)/240,0,1)*Math.PI)*Math.min(22,w*.035);
                            this.draw(player,(w*(narrow?.23:.27)-pw/2+lunge+shake)/w,(floor-fitH)/h,pw/w,fitH/h,null,1);
                        }
                        if(this.effect&&time-this.effect.at<this.effect.duration){
                            const progress=(time-this.effect.at)/this.effect.duration;
                            const texture=this.texture(this.effect.url);
                            if(texture&&texture.texture){
                                const size=Math.min(w*.42,320)*(.7+Math.sin(progress*Math.PI)*.3);
                                const eh=size*texture.height/texture.width;
                                this.draw(texture,(w*(narrow?.23:.27)-size/2)/w,(floor-height*.42-eh/2)/h,size/w,eh/h,null,1-progress);
                            }
                        }else this.effect=null;
                        this.effectSprites=this.effectSprites.filter(sprite=>{
                            const p=(time-sprite.at)/sprite.duration;if(p<0)return true;if(p>=1)return false;
                            const texture=this.texture(sprite.url);if(!texture||texture.failed)return false;if(!texture.texture)return true;
                            const profile=sprite.profile,pulse=Math.sin(p*Math.PI),scale=(.72+pulse*.3)*(profile.aura?.92+p*.08:1);
                            const maxWidth=w*(sprite.role==='actor'?.32:.36);
                            let eh=h*profile.size*scale,size=eh*texture.width/texture.height;
                            if(size>maxWidth){eh*=maxWidth/size;size=maxWidth;}
                            const x=w*(sprite.role==='actor'?(narrow?.23:.27):(narrow?.70:.67));
                            const y=floor-height*.45-(profile.aura?p*.018*h:0),alpha=clamp(Math.min(p*6,(1-p)*2.8),0,1)*profile.alpha;
                            this.draw(texture,(x-size/2)/w,(y-eh/2)/h,size/w,eh/h,null,alpha);
                            return true;
                        });
                    }
                }
            }
            this.frame=requestAnimationFrame(t=>this.render(t));
        }
    }

    class Hud{
        constructor(canvas){this.canvas=canvas;this.ctx=canvas.getContext('2d');this.regions=[];this.pointer=null;this.damagePops=[];this.flashUntil=0;this.shakeUntil=0;canvas.addEventListener('pointerdown',e=>{this.pointer={x:e.clientX,y:e.clientY,id:e.pointerId};canvas.setPointerCapture(e.pointerId);});canvas.addEventListener('pointerup',e=>{if(!this.pointer||this.pointer.id!==e.pointerId)return;const hit=this.regions.slice().reverse().find(r=>e.clientX>=r.x&&e.clientX<=r.x+r.w&&e.clientY>=r.y&&e.clientY<=r.y+r.h);this.pointer=null;if(hit&&!busy)hit.fn();});canvas.addEventListener('pointercancel',()=>this.pointer=null);this.frame=requestAnimationFrame(()=>this.draw());}
        resize(){const dpr=Math.min(2,devicePixelRatio||1),w=innerWidth,h=innerHeight;if(this.canvas.width!==Math.round(w*dpr)||this.canvas.height!==Math.round(h*dpr)){this.canvas.width=Math.round(w*dpr);this.canvas.height=Math.round(h*dpr);this.canvas.style.width=w+'px';this.canvas.style.height=h+'px';}this.ctx.setTransform(dpr,0,0,dpr,0,0);return{w,h};}
        text(v,x,y,s,weight,align,color,max){const c=this.ctx;c.font=(weight||700)+' '+s+'px Pretendard,sans-serif';c.textAlign=align||'left';c.textBaseline='middle';c.fillStyle=color||'#fff';c.fillText(String(v||''),x,y,max);}
        title(v,x,y,s,align,color,max){const c=this.ctx;c.font='400 '+s+'px "Black Han Sans",Pretendard,sans-serif';c.textAlign=align||'center';c.textBaseline='middle';c.fillStyle=color||'#fff';c.fillText(String(v||''),x,y,max);}
        panel(x,y,w,h,accent,solid){const c=this.ctx,g=c.createLinearGradient(x,y,x,y+h);g.addColorStop(0,solid?'rgba(26,29,36,.98)':'rgba(18,21,28,.91)');g.addColorStop(1,solid?'rgba(8,10,14,.99)':'rgba(6,8,13,.82)');this.cutPath(x,y,w,h,9);c.fillStyle=g;c.fill();c.strokeStyle=accent||'rgba(92,100,116,.72)';c.lineWidth=1;c.stroke();this.line(x+10,y+.5,x+Math.min(w*.44,150),y+.5,accent||'rgba(232,176,75,.72)',2);this.line(x+w-14,y+h-.5,x+w-3,y+h-11,accent||'rgba(232,176,75,.45)',1);}
        region(x,y,w,h,fn){this.regions.push({x,y,w,h,fn});}
        bar(x,y,w,h,value,max,color,lagValue){const c=this.ctx;this.cutPath(x,y,w,h,3);c.fillStyle='rgba(0,0,0,.8)';c.fill();if(lagValue!=null){const lag=w*ratio(lagValue,max);if(lag>0){this.cutPath(x,y,lag,h,3);c.fillStyle='rgba(240,176,75,.62)';c.fill();}}const fill=w*ratio(value,max);if(fill>0){this.cutPath(x,y,fill,h,3);const g=c.createLinearGradient(x,y,x+w,y);g.addColorStop(0,color);g.addColorStop(1,color==='#b92d2d'?'#f25b42':'#37a4ec');c.fillStyle=g;c.fill();}this.cutPath(x,y,w,h,3);c.strokeStyle='rgba(255,255,255,.24)';c.lineWidth=1;c.stroke();this.line(x+2,y+2,x+Math.max(2,fill-2),y+2,'rgba(255,255,255,.28)',1);}
        line(x1,y1,x2,y2,color,width){const c=this.ctx;c.beginPath();c.moveTo(x1,y1);c.lineTo(x2,y2);c.strokeStyle=color;c.lineWidth=width||1;c.stroke();}
        cutPath(x,y,w,h,cut){const c=this.ctx,k=Math.min(cut||7,w*.2,h*.35);c.beginPath();c.moveTo(x+k,y);c.lineTo(x+w,y);c.lineTo(x+w,y+h-k);c.lineTo(x+w-k,y+h);c.lineTo(x,y+h);c.lineTo(x,y+k);c.closePath();}
        playerHud(w,h){if(!state||!state.inField)return;const mobile=w<650||h<520,landscape=h<520&&w>=650,pw=mobile?Math.min(238,w*.61):304,ph=mobile?84:94,x=landscape?w-pw-12:mobile?12:24,y=mobile?72:h-178;this.panel(x,y,pw,ph,'rgba(232,176,75,.58)');const portrait=this.image(state.player.cardImageUrl),ps=mobile?50:58,px=x+8,py=y+8,infoX=px+ps+9,infoRight=x+pw-9,infoW=infoRight-infoX;this.ctx.save();this.cutPath(px,py,ps,ps,6);this.ctx.clip();if(portrait)this.ctx.drawImage(portrait,px,py,ps,ps);else{this.ctx.fillStyle='#11141b';this.ctx.fillRect(px,py,ps,ps);}this.ctx.restore();this.cutPath(px,py,ps,ps,6);this.ctx.strokeStyle='rgba(232,176,75,.72)';this.ctx.stroke();this.text(state.player.name,infoX,y+16,mobile?13:15,900,'left','#fff5df',infoW);const cardLabel=state.player.cardFormatted||[state.player.cardSkin,state.player.cardName].filter(Boolean).join(' ');this.text(cardLabel,infoX,y+34,mobile?8:10,700,'left','#aeb4bf',infoW);const hpTextY=y+(mobile?48:52),hpBarY=y+(mobile?54:59),mpTextY=y+(mobile?65:71),mpBarY=y+(mobile?71:78);this.text('HP',infoX,hpTextY,8,800,'left','#bbb1a0');this.text(number(state.player.hp),infoRight,hpTextY,8,800,'right','#e9e5dc');this.bar(infoX,hpBarY,infoW,6,state.player.hp,state.player.maxHp,'#b92d2d');this.text('MP',infoX,mpTextY,8,800,'left','#bbb1a0');this.text(number(state.player.mp),infoRight,mpTextY,8,800,'right','#e9e5dc');this.bar(infoX,mpBarY,infoW,6,state.player.mp,state.player.maxMp,'#147fc4');}
        combatLog(w,h){if(!state||!state.inField||!logs.length)return;const narrow=w<650,lines=logs.slice(-4),x=narrow?12:26,base=h-(narrow?201:196),lineH=narrow?14:16;lines.forEach((entry,index)=>{const alpha=.42+(index+1)/lines.length*.58,col=entry.tone==='bad'?'224,101,92':entry.tone==='good'?'240,197,110':'220,224,230';this.text(entry.text,x,base-(lines.length-1-index)*lineH,narrow?9:10,entry.tone==='good'?800:650,'left','rgba('+col+','+alpha+')',Math.min(narrow?w-24:460,w*.48));});}
        actions(w,h){if(!state||!state.inField)return;const narrow=w<650,now=Date.now()+clockOffset,actionLeft=Math.max(0,Number(state.nextActionAt||0)-now)/1000,skills=(state.skills||[]).slice(0,narrow?4:7),gap=narrow?5:7,maxW=Math.min(narrow?w-24:780,w-40),y=h-(narrow?82:76),ah=narrow?68:62,attackW=narrow?86:122,sw=skills.length?Math.min(narrow?62:94,(maxW-attackW-gap*skills.length)/skills.length):0,usedW=skills.length*sw+gap*skills.length+attackW,x=(w-usedW)/2;skills.forEach((skill,index)=>{const left=Math.max(actionLeft,(Number(skill.cooldownEnd||0)-now)/1000),mpLow=Number(state.player.mp)<Number(skill.mpCost||0),disabled=busy||left>0||mpLow;this.actionButton(x+index*(sw+gap),y,sw,ah,{label:skill.name.slice(0,6),sub:Number(skill.mpCost||0)+' MP',key:String(index+1),disabled,cooldown:Math.max(0,left),action:()=>useSkill(skill.name)});});const ax=x+usedW-attackW;this.actionButton(ax,y,attackW,ah,{label:'공격',sub:narrow?'J':'SPACE / J',key:'J',kind:'attack',disabled:busy||actionLeft>0,cooldown:actionLeft,action:()=>attack()});}
        topControls(w){const p=w<650?12:22,bw=42,bh=34;this.panel(p,p,bw,bh,'rgba(170,180,194,.45)');this.line(p+25,p+9,p+15,p+17,'#e4e8ed',2);this.line(p+15,p+17,p+25,p+25,'#e4e8ed',2);this.region(p,p,bw,bh,()=>backOrLeave());const x=w-p-bw;this.panel(x,p,bw,bh,'rgba(170,180,194,.45)');const sx=x+20;this.line(sx-7,p+14,sx-2,p+14,'#e4e8ed',2);this.line(sx-2,p+14,sx+4,p+9,'#e4e8ed',2);this.line(sx+4,p+9,sx+4,p+25,'#e4e8ed',2);if(!audio.muted){this.ctx.beginPath();this.ctx.arc(sx+5,p+17,8,-.8,.8);this.ctx.strokeStyle='#e4e8ed';this.ctx.stroke();}else this.line(sx-7,p+9,sx+10,p+26,'#e0655c',2);this.region(x,p,bw,bh,()=>audio.toggle());}
        actionButton(x,y,w,h,opts){
            const c=this.ctx,o=opts||{},kind=o.kind||'skill',disabled=!!o.disabled;
            this.cutPath(x,y,w,h,kind==='attack'?12:7);const g=c.createLinearGradient(x,y,x,y+h);
            if(kind==='attack'){g.addColorStop(0,disabled?'#3d3233':'#dd5a4e');g.addColorStop(.55,disabled?'#282327':'#9e241e');g.addColorStop(1,'#42100d');}
            else if(kind==='gold'){g.addColorStop(0,disabled?'#34312c':'#f0c56e');g.addColorStop(1,disabled?'#1b1b1d':'#a85f12');}
            else{g.addColorStop(0,disabled?'#272b32':'#252b36');g.addColorStop(1,disabled?'#15171c':'#11151d');}
            c.fillStyle=g;c.fill();c.strokeStyle=disabled?'rgba(100,105,115,.48)':kind==='attack'?'rgba(255,170,155,.85)':kind==='gold'?'rgba(255,225,154,.9)':'rgba(232,176,75,.58)';c.lineWidth=1;c.stroke();
            if(!disabled)this.line(x+8,y+1,x+w*.55,y+1,kind==='attack'?'rgba(255,210,190,.72)':'rgba(232,176,75,.75)',2);
            if(o.key)this.text(o.key,x+7,y+9,8,800,'left',disabled?'#656a74':'#b9ad92');
            const labelX=x+w*(Number(o.labelRatio)||.5),labelY=y+h*(Number(o.labelYRatio)||(o.sub?.42:.51)),labelSize=kind==='gold'?19:kind==='attack'?18:Math.min(13,w*.16),labelColor=disabled?'#747982':kind==='gold'?'#261704':'#f4f1e8';
            if(kind==='gold'||kind==='attack')this.gameText(o.label,labelX,labelY,labelSize,'center',labelColor,w-12);else this.text(o.label,labelX,labelY,labelSize,900,'center',labelColor,w-12);
            if(o.sub)this.text(o.sub,labelX,y+h*.72,9,700,'center',disabled?'#626771':kind==='gold'?'#3e290c':'#9da5b3',w-10);
            if(o.cooldown>0){this.cutPath(x,y,w,h,kind==='attack'?12:7);c.fillStyle='rgba(0,0,0,.64)';c.fill();this.gameText(o.cooldown<10?o.cooldown.toFixed(1):Math.ceil(o.cooldown),x+w/2,y+h/2,16,'center','#ffe28a');}
            if(!disabled)this.region(x,y,w,h,o.action);
        }
        gameText(...args){this.title(...args);}
        button(x,y,w,h,label,sub,fn,disabled,kind){this.actionButton(x,y,w,h,{label,sub,action:fn,disabled,kind});}
        image(url){
            if(!url)return null;
            if(!this.images)this.images=new Map();
            if(!this.images.has(url)){
                const image=new Image();this.images.set(url,image);
                image.onload=()=>{
                    const scratch=document.createElement('canvas');scratch.width=image.naturalWidth;scratch.height=image.naturalHeight;
                    const context=scratch.getContext('2d');context.drawImage(image,0,0);
                    const pixels=context.getImageData(0,0,scratch.width,scratch.height).data;
                    let left=scratch.width,top=scratch.height,right=-1,bottom=-1;
                    for(let y=0;y<scratch.height;y++)for(let x=0;x<scratch.width;x++)if(pixels[(y*scratch.width+x)*4+3]>16){left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}
                    if(right>=left)image.trim=[left,top,right-left+1,bottom-top+1];
                };
                image.src=url;
            }
            const image=this.images.get(url);return image.complete&&image.naturalWidth?image:null;
        }
        lobby(w,h){
            const boss=(state.bosses||[]).find(b=>b.name===selectedBoss)||(state.bosses||[])[0];
            if(!boss)return this.text('월드보스 데이터가 없습니다.',w/2,h/2,16,800,'center','#ddd');
            const c=this.ctx,narrow=w<680,cx=w/2,cy=h*.39,daily=state.daily||{};
            const shade=c.createLinearGradient(0,0,0,h);
            shade.addColorStop(0,'rgba(2,6,10,.28)');shade.addColorStop(.45,'rgba(2,6,10,.20)');shade.addColorStop(1,'rgba(2,6,10,.75)');
            c.fillStyle=shade;c.fillRect(0,0,w,h);
            this.text('W O R L D   B O S S',cx,cy-64,11,800,'center','#b9c5d2');
            this.title(boss.name,cx,cy-12,narrow?44:56,'center','#f4f6fa');
            c.fillStyle='rgba(198,211,226,.65)';c.fillRect(cx-32,cy+31,64,1);
            const freeLeft=Math.max(0,Number(daily.limit)-Number(daily.count));
            const extraLeft=Math.max(0,Number(daily.tokenLimit)-Number(daily.tokenCount));
            const free=freeLeft>0;
            const can=state.canEnter&&boss.alive&&(free||daily.valorCount>0&&extraLeft>0);
            this.text(free?'오늘 무료 도전 '+freeLeft+'회 남음':'추가 도전 '+extraLeft+'회 남음',cx,cy+63,12,700,'center','#ccd5df');
            const bw=narrow?190:210,bh=78,bx=cx-bw/2,by=cy+96;
            this.actionButton(bx,by,bw,bh,{label:boss.alive?(can?'입장':'입장 불가'):'부활 대기',labelYRatio:.32,kind:'gold',key:'E',disabled:busy||!can,action:()=>enterBoss(boss.name)});
            const icon=this.image(daily.valorIconUrl),iconSize=28,label=free?'미소모 · 보유 '+number(daily.valorCount):number(daily.valorCount)+' / 1';
            c.font='800 11px Pretendard,sans-serif';const rowWidth=iconSize+7+c.measureText(label).width,ix=cx-rowWidth/2,rowY=by+56;
            if(icon){const crop=icon.trim||[0,0,icon.naturalWidth,icon.naturalHeight],scale=iconSize/Math.max(crop[2],crop[3]);c.drawImage(icon,...crop,ix+(iconSize-crop[2]*scale)/2,rowY-crop[3]*scale/2,crop[2]*scale,crop[3]*scale);}
            this.text(label,ix+iconSize+7,rowY,11,800,'left',can?'#2b1b05':'#a3adb8');
            const reason=state.entryError||(!boss.alive&&boss.respawnAt?'부활 '+new Date(boss.respawnAt).toLocaleString('ko-KR'):!can?(extraLeft<=0?'오늘의 도전을 모두 마쳤습니다.':'용맹의 증표가 부족합니다.'):'');
            if(reason)this.text(reason,cx,by+101,narrow?10:12,650,'center','#d7bec1',w-36);
            this.button(w-180,18,106,34,'보상 수령','',claimRewards,busy);
            if(boss.contribution>0)this.text('누적 피해 '+number(boss.contribution)+(boss.myRank?'  ·  '+boss.myRank+'위':''),cx,h-30,11,700,'center','#b4c0ce');
        }
        battle(w,h){
            const boss=state.current;if(!boss)return;
            const narrow=w<650,bw=Math.min(w-120,720),bx=(w-bw)/2,by=18;
            this.text(boss.name,w/2,by+8,narrow?18:22,900,'center','#f7f2e8');
            this.bar(bx,by+26,bw,narrow?15:19,boss.hp,boss.maxHp,'#b92d2d');
            this.text(number(boss.hp)+' / '+number(boss.maxHp),w/2,by+35,narrow?8:10,800,'center','#fff');
            this.text('전투 '+(Number(state.elapsedMs||0)/1000).toFixed(1)+'초',narrow?w-12:w/2,by+(narrow?67:58),10,750,narrow?'right':'center','#d8c89f');
            if(state.curseApplied)this.text('회복 봉인',narrow?w-12:w/2,by+(narrow?86:77),11,900,narrow?'right':'center','#e0655c');
            this.playerHud(w,h);this.combatLog(w,h);this.actions(w,h);
            const hx=narrow?12:24,hy=narrow?h-126:h-66;
            this.button(hx,hy,70,34,state.curseApplied?'봉인':'회복','P',()=>this.toggleConsumables(),busy||state.curseApplied||!(state.consumables||[]).length);
        }
        toggleConsumables(){if(!state||!state.inField||state.curseApplied)return;this.consumableMenu=!this.consumableMenu;this.consumablePage=0;}
        closeConsumables(){this.consumableMenu=false;}
        consumablePageSize(w,h){return w<650?6:10;}
        changeConsumablePage(delta,w,h){const list=state&&state.consumables||[],pages=Math.max(1,Math.ceil(list.length/this.consumablePageSize(w,h)));this.consumablePage=(this.consumablePage+delta+pages)%pages;}
        useConsumableAt(index,w,h){const list=state&&state.consumables||[],item=list[this.consumablePage*this.consumablePageSize(w,h)+index];if(item)useConsumable(item.id);}
        consumableLayer(w,h){if(!this.consumableMenu)return;this.regions=[];const c=this.ctx,narrow=w<650,compact=h<520,cols=narrow?(compact?3:2):5,perPage=this.consumablePageSize(w,h),list=state&&state.consumables||[],pages=Math.max(1,Math.ceil(list.length/perPage));this.consumablePage=clamp(this.consumablePage,0,pages-1);const bh=Math.min(h-20,narrow?(compact?310:460):330),bw=Math.min(w-20,narrow?560:760),x=(w-bw)/2,y=(h-bh)/2,gap=8,gridTop=y+62,rows=Math.ceil(perPage/cols),cellW=(bw-32-gap*(cols-1))/cols,cellH=(bh-122-gap*(rows-1))/rows;c.fillStyle='rgba(1,4,7,.84)';c.fillRect(0,0,w,h);this.panel(x,y,bw,bh,'rgba(98,225,157,.68)',true);this.gameText('회복 소모품',w/2,y+29,narrow?20:24,'center','#ecfff4');this.text('P',x+12,y+15,8,900,'left','#91cbaa');if(pages>1)this.text((this.consumablePage+1)+' / '+pages,w/2,y+49,9,800,'center','#9da5b3');const pageItems=list.slice(this.consumablePage*perPage,(this.consumablePage+1)*perPage);if(!pageItems.length)this.text('보유 중인 회복 소모품이 없습니다.',w/2,y+bh*.48,narrow?11:13,700,'center','#a9afb8');pageItems.forEach((item,index)=>{const col=index%cols,row=Math.floor(index/cols),cx=x+16+col*(cellW+gap),cy=gridTop+row*(cellH+gap),disabled=busy||Number(item.count||0)<1;this.panel(cx,cy,cellW,cellH,disabled?'rgba(95,101,110,.4)':'rgba(98,225,157,.48)',true);const art=Math.min(narrow?42:48,cellH-30),ax=cx+8,ay=cy+(cellH-art)/2,frame=this.image(item.frameUrl),icon=this.image(item.iconUrl);if(frame)c.drawImage(frame,ax,ay,art,art);if(icon)c.drawImage(icon,ax,ay,art,art);const tx=ax+art+8,tw=cellW-art-24,key=index===9?'0':String(index+1);this.text(key,cx+6,cy+8,7,900,'left',disabled?'#676c74':'#a5d8bb');this.text(item.name,tx,cy+cellH*.31,narrow?9:10,900,'left',disabled?'#737983':'#f0f5f1',tw);this.text(item.effect,tx,cy+cellH*.56,narrow?8:9,700,'left',disabled?'#636971':'#87d9aa',tw);this.text('x'+number(item.count),tx,cy+cellH*.78,8,800,'left',disabled?'#62676e':'#d6c28b',tw);if(!disabled)this.region(cx,cy,cellW,cellH,()=>useConsumable(item.id));});const footerY=y+bh-45,buttonW=narrow?68:82;if(pages>1){this.actionButton(x+16,footerY,buttonW,32,{label:'이전',disabled:busy,action:()=>this.changeConsumablePage(-1,w,h)});this.actionButton(x+bw-16-buttonW,footerY,buttonW,32,{label:'다음',disabled:busy,action:()=>this.changeConsumablePage(1,w,h)});}this.actionButton(w/2-42,footerY,84,32,{label:'닫기',disabled:busy,action:()=>this.closeConsumables()});}
        // PVP pop typography, easing, colors and lifetime; anchors follow this arena.
        addPop(pop){this.damagePops.push(Object.assign({start:performance.now()+(Number(pop&&pop.delay)||0),side:'target',y:combatPopY(),size:30,color:'#ffe06e',label:'',sub:''},pop));}
        damageLayer(w,h){
            const time=performance.now(),narrow=w<700;
            this.damagePops=this.damagePops.filter(pop=>{
                const p=(time-pop.start)/950;
                if(p<0)return true;
                if(p>=1)return false;
                const ease=1-Math.pow(1-clamp(p,0,1),3),x=w*sideX(pop.side,w<680),y=h*pop.y-(reducedMotion?0:ease*62),
                    alpha=clamp(Math.min(p*8,(1-p)*3.4),0,1),scale=reducedMotion?1:.7+Math.sin(Math.min(1,p)*Math.PI)*.36;
                this.ctx.save();this.ctx.globalAlpha=alpha;this.ctx.translate(x,y);this.ctx.scale(scale,scale);
                if(pop.label)this.text(pop.label,0,-26,narrow?10:12,900,'center','#ffb0a8');
                this.text(pop.text,0,0,narrow?pop.size*.76:pop.size,900,'center',pop.color);
                if(pop.sub)this.text(pop.sub,0,25,narrow?9:11,800,'center','#efe4cd');
                this.ctx.restore();
                return true;
            });
        }
        bannerLayer(w,h){
            if(!this.banner||this.bannerUntil<=performance.now())return;
            const remain=this.bannerUntil-performance.now(),age=1-clamp(remain/1250,0,1),alpha=clamp(Math.min(age*5,remain/220),0,1),narrow=w<700,c=this.ctx,cx=w/2,y=h*(narrow?.3:.33),bw=Math.max(60,Math.min(w-40,narrow?310:460));
            c.save();c.globalAlpha=alpha;
            const glow=c.createRadialGradient(cx,y,0,cx,y,bw*.58);glow.addColorStop(0,'rgba(232,176,75,.2)');glow.addColorStop(1,'rgba(0,0,0,0)');c.fillStyle=glow;c.fillRect(cx-bw*.7,y-70,bw*1.4,140);
            this.line(cx-bw/2,y-22,cx-72,y-22,'rgba(232,176,75,.8)',1);this.line(cx+72,y-22,cx+bw/2,y-22,'rgba(232,176,75,.8)',1);
            this.text(this.banner,cx,y,narrow?25:36,900,'center','#fff8e8');
            if(this.bannerSub)this.text(this.bannerSub,cx,y+29,narrow?10:12,800,'center','#e8b04b');
            c.restore();
        }
        impact(strong){if(reducedMotion)return;this.flashDuration=strong?260:130;this.flashUntil=performance.now()+this.flashDuration;if(strong)this.shakeUntil=performance.now()+380;}
        showBanner(text,sub){this.banner=text;this.bannerSub=sub||'';this.bannerUntil=performance.now()+1250;}
        draw(){
            const {w,h}=this.resize(),c=this.ctx;c.clearRect(0,0,w,h);this.regions=[];
            const shake=this.shakeUntil>performance.now()&&!reducedMotion?(Math.random()-.5)*8:0;
            c.save();c.translate(shake,0);
            if(state){if(!state.selecting){if(state.inField)this.battle(w,h);else this.lobby(w,h);this.topControls(w);}}
            else this.text('월드보스 정보를 불러오는 중…',w/2,h/2,14,700,'center','#d8cbd4');
            this.damageLayer(w,h);this.bannerLayer(w,h);this.consumableLayer(w,h);
            if(notice&&performance.now()<noticeUntil){const nw=Math.min(w-30,520);this.panel((w-nw)/2,h*.22,nw,46,'#e8b04b');this.text(notice,w/2,h*.22+23,11,800,'center','#fff',nw-20);}
            if(this.flashUntil>performance.now()){const left=this.flashUntil-performance.now();c.fillStyle='rgba(255,255,255,'+clamp(left/this.flashDuration,0,.34)+')';c.fillRect(0,0,w,h);}
            c.restore();
            this.frame=requestAnimationFrame(()=>this.draw());
        }
    }

    const audio=new WorldBossAudio(),renderer=new Renderer(canvas),hud=new Hud(hudCanvas);
    function schedulePresentation(callback,delay){
        if(!delay)return callback();
        const epoch=presentationEpoch;
        setTimeout(()=>{if(epoch===presentationEpoch)callback();},delay);
    }
    function presentHit(event,hit,side,index){
        const shield=hit.type==='absorbed',summon=hit.type==='summonAbsorbed';
        const tick=side==='target'&&['tick','dot','summon'].includes(event.action),critical=!tick&&!!hit.critical;
        const avoided=!!hit.avoided,received=side==='actor',amount=Number(hit.damage||0);
        if(amount<=0&&!avoided)return;
        let sub=hit.label||(!index?event.skillName||event.source||(tick?'지속 피해':''):'');
        if(received&&(event.bossAction||event.bossRetaliation))sub=event.bossAction==='darkPulse'?'암흑 파동':'일참';
        if(!avoided)renderer.strike(side,event,hit);
        hud.addPop({
            side,text:avoided?'회피':shield?'흡수 '+number(amount):summon?'대행 '+number(amount):(received?'-':'')+number(amount),
            color:avoided?'#cdd6e2':shield?'#b8d8ff':summon?'#61e7ff':received?'#ff8f87':tick?'#ffd88a':critical?'#ff5d4d':'#ffe06e',
            size:avoided?26:shield||summon?(tick?22:24):tick?24:received?28:critical?46:34,
            label:critical?'치명타':'',sub
        });
        if(amount>0&&!avoided&&!shield&&!summon){audio.hit();if(critical)audio.play('crit',.82);hud.impact(critical);}
    }
    function presentEvent(event){
        if(!event)return;
        if(event.message)addLog(event.message,event.defeated?'bad':'');
        if(event.skipped)return;
        renderer.animate(event);
        const hits=event.hits&&event.hits.length?event.hits:Number(event.damage)>0?[{damage:event.damage,critical:Number(event.criticalCount)>0}]:[];
        const received=event.receivedHits&&event.receivedHits.length?event.receivedHits:Number(event.received)>0?[{damage:event.received}]:[];
        // Match PVP: each hit's pop, effect, sound and impact share one 95ms cue.
        // Incoming damage starts immediately; never put a wind-up after the HP update.
        hits.forEach((hit,i)=>schedulePresentation(()=>presentHit(event,hit,'target',i),i*95));
        received.forEach((hit,i)=>schedulePresentation(()=>presentHit(event,hit,'actor',i),i*95));
        if(event.dodged){renderer.playEffects({action:'attack',effectIds:['combat:회피']},'target');hud.addPop({side:'target',text:'회피',color:'#cdd6e2',size:26});}
        if(event.counterDamage)presentHit({action:'attack',skillName:'카운터',effectIds:['skill:카운터']},{damage:event.counterDamage},'target',0);
        const reflected=event.reflectedHits||[];
        reflected.forEach((hit,i)=>schedulePresentation(()=>{renderer.strike('actor',{action:'dot',effectIds:hit.effectIds},hit);hud.addPop({side:'actor',text:'-'+number(hit.damage),color:'#d7a2ff',size:22,sub:hit.label||'가시 반사'});},(hits.length+i)*95));
        if(!reflected.length&&Number(event.selfDamage)>0)hud.addPop({side:'actor',text:'-'+number(event.selfDamage),color:'#ff8f87',size:22,delay:120});
        const hp=Number(event.recoveredHp||event.heal||0),mp=Number(event.recoveredMp||event.mpRecovery||0);
        if(event.action==='shield'){
            const amount=Number(event.shield||event.heal||0);if(amount>0)hud.addPop({side:'actor',text:'+'+number(amount)+' 보호막',color:'#eaf2ff',size:22,y:recoveryPopY()});
        }else if(hp>0)hud.addPop({side:'actor',text:'HP +'+number(hp),color:'#63f29b',size:22,y:recoveryPopY(),delay:hits.length?120:0});
        if(mp>0)hud.addPop({side:'actor',text:'MP +'+number(mp),color:'#72c7ff',size:21,y:recoveryPopY()+.04,delay:150});
        if(event.action==='consumable'||event.action==='heal')audio.play('potion',.68);
        else if(event.action==='skill'||event.curseApplied)audio.play('skill',.68);
        if(event.curseApplied){hud.consumableMenu=false;hud.showBanner('회복 봉인','흑막의 저주');}
        if(event.defeated){audio.play('fail',.72);hud.showBanner('전투 패배','도전을 마쳤습니다.');}
        else if(event.bossDefeated){audio.play('clear',.82);hud.showBanner('월드보스 처치','흑막');}
    }
    async function mutate(path,body){if(busy)return;audio.unlock();busy=true;renderSelection();try{if(syncing)await syncing;const result=await request(path,body||{});const next=result.state||result;applyState(next);(next.events||[]).forEach(presentEvent);if(result.message)addLog(result.message,result.ok?'good':'bad');if(result.ok&&result.event)presentEvent(result.event);if(!result.ok)showNotice(result.message);return result;}catch(error){addLog(error.message,'bad');showNotice(error.message);}finally{busy=false;renderSelection();}}
    const enterBoss=name=>mutate('/api/worldboss/enter',{bossName:name});
    const selectSkill=index=>mutate('/api/worldboss/select',{index});
    const cancelSelection=()=>mutate('/api/worldboss/cancel',{});
    document.getElementById('wbCancelSelection').onclick=cancelSelection;
    const claimRewards=()=>mutate('/api/worldboss/claim',{});
    const attack=()=>{if(!state||!state.inField||Date.now()+clockOffset<Number(state.nextActionAt||0))return;mutate('/api/worldboss/attack',{});};
    const useSkill=name=>mutate('/api/worldboss/skill',{skillName:name});
    const useConsumable=itemId=>mutate('/api/worldboss/use-consumable',{itemId});
    function backOrLeave(){if(state&&state.inField)showNotice('월드보스 전투 중에는 퇴장할 수 없습니다.');else if(state&&state.selecting)cancelSelection();else location.href='/';}
    function sync(){if(busy||syncing)return;syncing=(async()=>{try{const next=await request('/api/worldboss');applyState(next);(next.events||[]).forEach(presentEvent);}catch(error){showNotice(error.message);}finally{syncing=null;}})();return syncing;}
    addEventListener('pointerdown',()=>audio.unlock(),{passive:true});
    document.addEventListener('visibilitychange',()=>{if(document.hidden)audio.stopBgm();else{audio.playBgm();sync();}});
    addEventListener('pagehide',()=>audio.stopBgm());
    addEventListener('keydown',event=>{
        if(event.repeat||!state)return;audio.unlock();const key=event.key.toLowerCase();
        if(event.target instanceof HTMLElement&&event.target.closest('button,input,select,textarea')&&!/^[1-3]$/.test(key))return;
        if(state.selecting&&/^[1-3]$/.test(key)){selectSkill(Number(key));event.preventDefault();return;}
        if(!state.inField){if(key==='e'&&state.canEnter)enterBoss(selectedBoss);return;}
        if(key==='p'||key==='escape'&&hud.consumableMenu){hud.toggleConsumables();event.preventDefault();return;}
        if(hud.consumableMenu){if(/^[0-9]$/.test(key))hud.useConsumableAt(key==='0'?9:Number(key)-1,innerWidth,innerHeight);event.preventDefault();return;}
        if(key===' '||key==='j'){attack();event.preventDefault();}else if(/^[1-9]$/.test(key)){const skill=(state.skills||[])[Number(key)-1];if(skill)useSkill(skill.name);event.preventDefault();}
    });
    sync();setInterval(sync,700);
})();
