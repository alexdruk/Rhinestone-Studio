const $ = (id) => document.getElementById(id);
const layoutCanvas = $('layoutCanvas');
const cupCanvas = $('cupCanvas');
const lctx = layoutCanvas.getContext('2d');
const cctx = cupCanvas.getContext('2d');

const state = {
  text: 'Vitalina', font: 'Courier New', stoneSize: 2.0, gap: 0.3,
  stoneColor: 'crystal', cupColor: '#ffffff', wrap: 0.42, rotation: 0, stones: []
};

const colors = {
  crystal: ['#f8fbff','#a7d9ff','#ffe072','#dc9cff','#ffffff'],
  clear: ['#ffffff','#d8e9ff','#f6f6f6','#ffffff','#cfd6dd'],
  gold: ['#ffe27a','#c58a10','#fff0a8','#f8c232','#805300'],
  pink: ['#ffd4e6','#f478b1','#fff','#f7a3c7','#a81658'],
  sapphire: ['#8ec7ff','#145bc0','#e8f4ff','#357ee4','#06316c'],
  black: ['#333','#050505','#777','#111','#000']
};

function syncState(){
  state.text = $('textInput').value || ' ';
  state.font = $('fontSelect').value;
  state.stoneSize = parseFloat($('stoneSizeSelect').value);
  state.gap = parseFloat($('gapInput').value) || 0;
  state.stoneColor = $('stoneColorSelect').value;
  state.cupColor = $('cupColorSelect').value;
  state.wrap = parseFloat($('wrapSelect').value);
  state.rotation = (parseFloat($('rotationSlider')?.value || '0') * Math.PI) / 180;
}

function sampleText(){
  const mmW = 170, mmH = 100;
  const pxPerMm = 6;
  const off = document.createElement('canvas');
  off.width = Math.round(mmW * pxPerMm);
  off.height = Math.round(mmH * pxPerMm);
  const ctx = off.getContext('2d', { willReadFrequently: true });
  ctx.clearRect(0,0,off.width,off.height);
  ctx.fillStyle = '#000';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const fontPx = 32 * pxPerMm;
  ctx.font = `bold ${fontPx}px "${state.font}", monospace`;
  let w = ctx.measureText(state.text).width;
  const maxW = off.width * 0.88;
  const sizePx = Math.min(fontPx, fontPx * maxW / Math.max(1,w));
  ctx.font = `bold ${sizePx}px "${state.font}", monospace`;
  ctx.fillText(state.text, off.width/2, off.height/2 + sizePx*0.05);
  const img = ctx.getImageData(0,0,off.width,off.height).data;
  const stepMm = state.stoneSize + state.gap;
  const stones = [];
  for(let y=0; y<mmH; y+=stepMm){
    const rowOffset = Math.round(y / stepMm) % 2 ? stepMm/2 : 0;
    for(let x=0; x<mmW; x+=stepMm){
      const sx = Math.round((x + rowOffset) * pxPerMm);
      const sy = Math.round(y * pxPerMm);
      if(sx<0 || sx>=off.width || sy<0 || sy>=off.height) continue;
      const a = img[(sy*off.width + sx)*4 + 3];
      if(a > 30) stones.push({x:x + rowOffset, y, d:state.stoneSize, color:state.stoneColor});
    }
  }
  state.stones = stones;
}

function drawStone2D(ctx,x,y,r,type){
  const p = colors[type] || colors.crystal;
  const g = ctx.createRadialGradient(x-r*.35,y-r*.45,r*.1,x,y,r);
  g.addColorStop(0,p[2]); g.addColorStop(.42,p[0]); g.addColorStop(.72,p[1]); g.addColorStop(1,p[3]);
  ctx.fillStyle=g; ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2); ctx.fill();
  ctx.strokeStyle='rgba(80,80,80,.45)'; ctx.lineWidth=Math.max(.45,r*.11); ctx.stroke();
  ctx.fillStyle='rgba(255,255,255,.85)'; ctx.beginPath(); ctx.arc(x-r*.25,y-r*.32,Math.max(.5,r*.18),0,Math.PI*2); ctx.fill();
}

function drawLayout(){
  const ctx = lctx, W = layoutCanvas.width, H = layoutCanvas.height;
  ctx.clearRect(0,0,W,H); ctx.fillStyle='#fff'; ctx.fillRect(0,0,W,H);
  const pad=55, mmW=170, mmH=100, scale=Math.min((W-pad*2)/mmW,(H-pad*2)/mmH);
  ctx.strokeStyle='#e7ebef'; ctx.lineWidth=1;
  for(let x=0;x<=mmW;x+=10){ctx.beginPath();ctx.moveTo(pad+x*scale,pad);ctx.lineTo(pad+x*scale,pad+mmH*scale);ctx.stroke();}
  for(let y=0;y<=mmH;y+=10){ctx.beginPath();ctx.moveTo(pad,pad+y*scale);ctx.lineTo(pad+mmW*scale,pad+y*scale);ctx.stroke();}
  ctx.strokeStyle='#b9c0c8'; ctx.strokeRect(pad,pad,mmW*scale,mmH*scale);
  ctx.fillStyle='#555'; ctx.font='13px Arial'; ctx.fillText('0',pad-20,pad+4); ctx.fillText('170 mm',pad+mmW*scale-42,pad-12); ctx.fillText('100 mm',pad-48,pad+mmH*scale);
  for(const s of state.stones){ drawStone2D(ctx,pad+s.x*scale,pad+s.y*scale,(s.d*scale)/2,state.stoneColor); }
  $('stats').textContent = `${state.stones.length} stones · layout ${mmW} × ${mmH} mm`;
}

function hexToRgb(hex){const v=parseInt(hex.slice(1),16);return {r:(v>>16)&255,g:(v>>8)&255,b:v&255};}
function mix(hex,a){const c=hexToRgb(hex); return `rgb(${Math.round(c.r*a+255*(1-a))},${Math.round(c.g*a+255*(1-a))},${Math.round(c.b*a+255*(1-a))})`;}

function roundedRectPath(ctx,x,y,w,h,r){
  ctx.beginPath();
  ctx.moveTo(x+r,y); ctx.lineTo(x+w-r,y); ctx.quadraticCurveTo(x+w,y,x+w,y+r);
  ctx.lineTo(x+w,y+h-r); ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
  ctx.lineTo(x+r,y+h); ctx.quadraticCurveTo(x,y+h,x,y+h-r);
  ctx.lineTo(x,y+r); ctx.quadraticCurveTo(x,y,x+r,y); ctx.closePath();
}

function drawCup(){
  const ctx=cctx,W=cupCanvas.width,H=cupCanvas.height; ctx.clearRect(0,0,W,H);

  // softer studio background
  const bg=ctx.createLinearGradient(0,0,0,H);
  bg.addColorStop(0,'#d8d0c4'); bg.addColorStop(.68,'#bfb4a6'); bg.addColorStop(.681,'#aaa398'); bg.addColorStop(1,'#8f8a83');
  ctx.fillStyle=bg; ctx.fillRect(0,0,W,H);

  const cup={x:W*.5,y:H*.50,w:390,h:520,top:345,bottom:390};
  const topY=cup.y-cup.h/2, bottomY=cup.y+cup.h/2;
  const leftTop=cup.x-cup.top/2, rightTop=cup.x+cup.top/2;
  const leftBottom=cup.x-cup.bottom/2, rightBottom=cup.x+cup.bottom/2;
  const isBlack = state.cupColor.toLowerCase()==='#111111' || state.cupColor.toLowerCase()==='#000000';

  const bodyGrad=ctx.createLinearGradient(leftBottom,0,rightBottom,0);
  if(isBlack){
    bodyGrad.addColorStop(0,'#090909'); bodyGrad.addColorStop(.18,'#151515'); bodyGrad.addColorStop(.46,'#20201e');
    bodyGrad.addColorStop(.58,'#2c2c2a'); bodyGrad.addColorStop(.74,'#181817'); bodyGrad.addColorStop(1,'#080808');
  } else {
    bodyGrad.addColorStop(0,mix(state.cupColor,.76)); bodyGrad.addColorStop(.18,mix(state.cupColor,.96)); bodyGrad.addColorStop(.46,mix(state.cupColor,.9));
    bodyGrad.addColorStop(.60,mix(state.cupColor,.72)); bodyGrad.addColorStop(.78,mix(state.cupColor,.93)); bodyGrad.addColorStop(1,mix(state.cupColor,.76));
  }

  // Handle is now connected with ceramic sockets, not floating.
  const side = Math.cos(state.rotation) >= 0 ? 1 : -1;
  const handleVisible = Math.abs(Math.cos(state.rotation)) > .18;
  const handleBehind = Math.cos(state.rotation) > 0;
  const handleRootX = cup.x + side*(cup.top/2 - 8);
  const handleCenterX = cup.x + side*(cup.top/2 + 100*Math.abs(Math.cos(state.rotation)) + 25);
  function drawHandle(behind=false){
    if(!handleVisible) return;
    ctx.save();
    ctx.globalAlpha = behind ? .72 : 1;
    ctx.lineCap='round';
    ctx.lineJoin='round';
    // outer ceramic loop
    ctx.lineWidth=56; ctx.strokeStyle=isBlack ? '#151514' : mix(state.cupColor,.84);
    ctx.beginPath();
    ctx.ellipse(handleCenterX,cup.y+22,102,176,0,side<0?Math.PI/2:-Math.PI/2,side<0?Math.PI*1.5:Math.PI/2, side<0);
    ctx.stroke();
    // inner shadow cutout
    ctx.lineWidth=31; ctx.strokeStyle=isBlack ? '#2a2a28' : mix(state.cupColor,.55);
    ctx.stroke();
    // attachment pads: cover the seam so the handle visually grows from the mug.
    const padW=56, padH=72;
    ctx.fillStyle=isBlack ? '#171716' : mix(state.cupColor,.88);
    roundedRectPath(ctx, handleRootX - (side>0?8:padW-8), cup.y-102, padW, padH, 22); ctx.fill();
    roundedRectPath(ctx, handleRootX - (side>0?8:padW-8), cup.y+88, padW, padH, 22); ctx.fill();
    // soft dark inner edge
    ctx.strokeStyle='rgba(0,0,0,.18)'; ctx.lineWidth=3;
    roundedRectPath(ctx, handleRootX - (side>0?8:padW-8), cup.y-102, padW, padH, 22); ctx.stroke();
    roundedRectPath(ctx, handleRootX - (side>0?8:padW-8), cup.y+88, padW, padH, 22); ctx.stroke();
    ctx.restore();
  }
  if(handleBehind) drawHandle(true);

  // cup body path
  ctx.beginPath();
  ctx.ellipse(cup.x,topY,cup.top/2,34,0,Math.PI,0,true);
  ctx.bezierCurveTo(rightTop,topY+110,rightBottom,bottomY-120,rightBottom,bottomY-25);
  ctx.quadraticCurveTo(cup.x,bottomY+28,leftBottom,bottomY-25);
  ctx.bezierCurveTo(leftBottom,bottomY-120,leftTop,topY+110,leftTop,topY);
  ctx.closePath(); ctx.fillStyle=bodyGrad; ctx.fill();
  ctx.strokeStyle=isBlack?'rgba(255,255,255,.07)':'rgba(0,0,0,.16)'; ctx.lineWidth=2; ctx.stroke();

  // Lip and inside.
  ctx.fillStyle=isBlack ? '#252522' : mix(state.cupColor,.82);
  ctx.beginPath(); ctx.ellipse(cup.x,topY,cup.top/2,34,0,0,Math.PI*2); ctx.fill();
  ctx.strokeStyle=isBlack?'rgba(255,255,255,.38)':'rgba(255,255,255,.70)'; ctx.lineWidth=4; ctx.stroke();
  ctx.fillStyle=isBlack ? 'rgba(0,0,0,.58)' : 'rgba(0,0,0,.20)';
  ctx.beginPath(); ctx.ellipse(cup.x,topY+2,cup.top/2-30,20,0,0,Math.PI*2); ctx.fill();

  // Much softer studio reflections. No more hard white blocks.
  const h1 = cup.x + Math.sin(state.rotation + 0.35) * 90;
  const h2 = cup.x + Math.sin(state.rotation + 0.80) * 122;
  const gloss = isBlack ? .16 : .20;
  const g1=ctx.createLinearGradient(h1-20,0,h1+34,0);
  g1.addColorStop(0,'rgba(255,255,255,0)'); g1.addColorStop(.48,`rgba(255,255,255,${gloss})`); g1.addColorStop(1,'rgba(255,255,255,0)');
  ctx.fillStyle=g1; ctx.fillRect(h1-20,topY+40,54,cup.h-95);
  const g2=ctx.createLinearGradient(h2-13,0,h2+22,0);
  g2.addColorStop(0,'rgba(255,255,255,0)'); g2.addColorStop(.5,`rgba(255,255,255,${gloss*.55})`); g2.addColorStop(1,'rgba(255,255,255,0)');
  ctx.fillStyle=g2; ctx.fillRect(h2-13,topY+58,35,cup.h-135);

  if(!handleBehind) drawHandle(false);

  // stones on curved cup surface
  const mmW=170, mmH=100;
  const minY=cup.y-72, maxY=cup.y+92;
  const visualWidth = cup.w * state.wrap;
  const radiusScale = visualWidth/mmW;
  for(const s of state.stones){
    const nx=(s.x/mmW-.5)*state.wrap;
    const theta=nx*Math.PI + state.rotation;
    const curveDepth=Math.cos(theta);
    if(curveDepth < .08) continue;
    const cx=cup.x + Math.sin(theta)*(cup.w*.495);
    const cy=minY+(s.y/mmH)*(maxY-minY);
    const r=Math.max(1.25,(s.d*radiusScale)/2);
    drawFacetedStone3D(ctx,cx,cy,r*curveDepth,r,state.stoneColor,curveDepth);
  }
}

function drawFacetedStone3D(ctx,x,y,rx,ry,type,light){
  const p=colors[type]||colors.crystal;
  ctx.save();
  ctx.shadowColor='rgba(0,0,0,.18)'; ctx.shadowBlur=3; ctx.shadowOffsetY=1;
  const g=ctx.createRadialGradient(x-rx*.35,y-ry*.45,0.5,x,y,Math.max(rx,ry));
  g.addColorStop(0,p[2]); g.addColorStop(.22,'#fff'); g.addColorStop(.5,p[0]); g.addColorStop(.78,p[1]); g.addColorStop(1,p[3]);
  ctx.fillStyle=g; ctx.beginPath(); ctx.ellipse(x,y,rx,ry,0,0,Math.PI*2); ctx.fill();
  ctx.shadowColor='transparent';
  ctx.strokeStyle='rgba(70,70,70,.35)'; ctx.lineWidth=Math.max(.6,ry*.12); ctx.stroke();
  ctx.strokeStyle='rgba(255,255,255,.8)'; ctx.lineWidth=Math.max(.4,ry*.06);
  for(let i=0;i<6;i++){const a=i*Math.PI/3;ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+Math.cos(a)*rx*.88,y+Math.sin(a)*ry*.88);ctx.stroke();}
  ctx.fillStyle=`rgba(255,255,255,${.45+.35*light})`; ctx.beginPath(); ctx.ellipse(x-rx*.25,y-ry*.35,rx*.22,ry*.16,0,0,Math.PI*2); ctx.fill();
  ctx.restore();
}

function render(){ syncState(); sampleText(); drawLayout(); drawCup(); }

function download(name, blob){ const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=name; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),1000); }
function exportCanvas(canvas,name){ canvas.toBlob(b=>download(name,b),'image/png'); }
function exportJSON(){ download('rhinestone-project.json', new Blob([JSON.stringify(state,null,2)],{type:'application/json'})); }
function exportSVG(){
  const mmW=170,mmH=100; let s=`<svg xmlns="http://www.w3.org/2000/svg" width="${mmW}mm" height="${mmH}mm" viewBox="0 0 ${mmW} ${mmH}">\n<rect width="100%" height="100%" fill="white"/>\n`;
  for(const st of state.stones) s+=`<circle cx="${st.x.toFixed(2)}" cy="${st.y.toFixed(2)}" r="${(st.d/2).toFixed(2)}" fill="none" stroke="black" stroke-width="0.12"/>\n`;
  s+='</svg>'; download('rhinestone-production-layout.svg', new Blob([s],{type:'image/svg+xml'}));
}

['textInput','fontSelect','stoneSizeSelect','gapInput','stoneColorSelect','cupColorSelect','wrapSelect','rotationSlider'].forEach(id=>$(id).addEventListener('input',render));
function setRotation(deg){ $('rotationSlider').value=String(deg); render(); }
$('frontViewBtn').onclick=()=>setRotation(0);
$('leftViewBtn').onclick=()=>setRotation(-90);
$('rightViewBtn').onclick=()=>setRotation(90);
$('backViewBtn').onclick=()=>setRotation(180);
let dragging=false, lastX=0;
cupCanvas.addEventListener('pointerdown', e=>{ dragging=true; lastX=e.clientX; cupCanvas.setPointerCapture(e.pointerId); });
cupCanvas.addEventListener('pointermove', e=>{
  if(!dragging) return;
  const dx=e.clientX-lastX; lastX=e.clientX;
  const slider=$('rotationSlider');
  let deg=parseFloat(slider.value)+dx*0.55;
  while(deg>180) deg-=360; while(deg<-180) deg+=360;
  slider.value=String(deg); render();
});
cupCanvas.addEventListener('pointerup', ()=>{ dragging=false; });
cupCanvas.addEventListener('pointercancel', ()=>{ dragging=false; });
$('newBtn').onclick=()=>{$('textInput').value='Vitalina'; setRotation(0);};
$('exportJsonBtn').onclick=exportJSON; $('exportSvgBtn').onclick=exportSVG; $('exportPngBtn').onclick=()=>exportCanvas(layoutCanvas,'rhinestone-2d-layout.png'); $('export3dBtn').onclick=()=>exportCanvas(cupCanvas,'rhinestone-cup-preview.png');
$('importJsonBtn').onclick=()=>$('importFile').click();
$('importFile').addEventListener('change', async e=>{ const file=e.target.files[0]; if(!file)return; const data=JSON.parse(await file.text()); Object.assign(state,data); $('textInput').value=state.text; $('fontSelect').value=state.font; $('stoneSizeSelect').value=String(state.stoneSize); $('gapInput').value=state.gap; $('stoneColorSelect').value=state.stoneColor; $('cupColorSelect').value=state.cupColor; $('wrapSelect').value=String(state.wrap); $('rotationSlider').value=String(Math.round((state.rotation||0)*180/Math.PI)); render(); });

render();
