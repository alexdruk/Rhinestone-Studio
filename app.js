// Live browser application entry point. Loaded by index.html as
// `<script type="module" src="./app.js">`. Owns application state, UI event
// wiring, the legacy inline GeometryEngine (now a thin bridge to the
// permanent engine), and drag/selection UI. 2D/cup rendering and SVG export
// live in the permanent src/renderer/** and src/export/** modules.
// Migrated from the previous inline <script> block in index.html (RS-0003.5B1).
// RS-0003.5B2 added the browser dependency probe proving the permanent
// module graph resolves. RS-0003.5B3 wired the permanent GeometryEngine,
// the OpenType-backed font provider (via FontProviderRegistry), and
// FontManager into live text-layer generation. RS-0003.5C1 wired circle and
// rectangle layers to the same permanent GeometryEngine via
// generateShapeLayout(), so text and shapes now share one Geometry Engine and
// one StoneLayout/Stone product. RS-0003.5C2 extracted the 2D canvas
// renderer, cup renderer, and SVG exporter into src/renderer/** and
// src/export/** modules that consume only StoneLayout; app.js's generate()
// now returns a real StoneLayout (merged across layers) instead of an ad hoc
// plain object, and app.js itself keeps only the layer-aware editor overlay
// (selection outline/handles, grid transform reuse, HUD text, drag/resize
// UI). app.js only ever talks to the geometry/fonts/text/renderer/export
// barrel modules, never the provider class directly, keeping the module
// boundaries from docs/ARCHITECTURE.md intact. RS-0003.5D1 added a Project
// JSON import path (validated against the same ad hoc project/layer shape
// #exportProject already produces) and guarded every export button handler
// against a not-yet-ready layout / a thrown exporter error, so export
// failures surface a specific #status message instead of an uncaught
// exception. See docs/specifications/RS-0003.5D1-ProductionExportValidation.md. RS-1001 added SVG
// import: an 'svg' layer type reusing the same generic x/y/w/h shape-editing UI/drag/resize code
// rectangle already uses, generated via the permanent engine's generateSvgLayout(). src/svg/**
// parses the SVG; app.js never parses SVG geometry itself, it only calls parseSvgDocument() once
// at import time to validate/measure. See docs/specifications/RS-1001-SvgImport.md. RS-1002 added
// unlimited (configurably bounded) undo/redo via src/history/HistoryManager.js: every editing
// action commits a `{project,selectedLayerId}` JSON snapshot (never generated geometry) before
// mutating; continuous controls coalesce one undo step per edit session instead of one per input
// event. See docs/specifications/RS-1002-UndoRedo.md. RS-1003 added curved text: six new per-text-
// layer fields (curveEnabled/curveRadiusMm/curveDirection/curveStartAngleDeg/curveSweepAngleDeg/
// curveAlignment) passed straight through to the permanent engine's generateTextLayout(), which now
// arc-projects glyph geometry via the new src/geometry/ArcProjection.js before stone sampling.
// app.js only forwards the six fields; it generates no stones itself. See
// docs/specifications/RS-1003-CurvedText.md. RS-1004 activated the previously-inert
// src/products/** module and project.product field: an "Object type" control lets the user switch
// the active ObjectTemplate (mug/tumbler/bottle), which resets project.canvas/project.wrap to that
// template's defaults and is forwarded to renderCup() as a plain `objectTemplate` display option —
// exactly like cupColor/wrap already are, not a new geometry concept. GeometryEngine/StoneLayout
// are untouched; only the schematic preview silhouette and a new safe-area editor-overlay guide
// (drawn here, not inside CanvasRenderer2D.js) vary by object type. See
// docs/specifications/RS-1004-MultiObjectTemplates.md.
import './src/browser/BrowserDependencyProbe.js';
import { GeometryEngine as PermanentGeometryEngine, Stone, StoneLayout } from './src/geometry/index.js';
import { FontManager } from './src/fonts/index.js';
import { createDefaultFontProviderRegistry } from './src/text/index.js';
import { renderProductionLayout } from './src/renderer/CanvasRenderer2D.js';
import { renderCup } from './src/renderer/CupRenderer.js';
import { STONE_COLORS } from './src/renderer/StoneColors.js';
import { stoneLayoutToSvg } from './src/export/SvgExporter.js';
import { parseSvgDocument } from './src/svg/index.js';
import { HistoryManager } from './src/history/index.js';
import { getObjectTemplate, getSafeAreaRectMm } from './src/products/index.js';
'use strict';
const FONT5={
' ':['00000','00000','00000','00000','00000','00000','00000'],
'A':['01110','10001','10001','11111','10001','10001','10001'],B:['11110','10001','10001','11110','10001','10001','11110'],C:['01111','10000','10000','10000','10000','10000','01111'],D:['11110','10001','10001','10001','10001','10001','11110'],E:['11111','10000','10000','11110','10000','10000','11111'],F:['11111','10000','10000','11110','10000','10000','10000'],G:['01111','10000','10000','10011','10001','10001','01111'],H:['10001','10001','10001','11111','10001','10001','10001'],I:['11111','00100','00100','00100','00100','00100','11111'],J:['00111','00010','00010','00010','10010','10010','01100'],K:['10001','10010','10100','11000','10100','10010','10001'],L:['10000','10000','10000','10000','10000','10000','11111'],M:['10001','11011','10101','10101','10001','10001','10001'],N:['10001','11001','10101','10011','10001','10001','10001'],O:['01110','10001','10001','10001','10001','10001','01110'],P:['11110','10001','10001','11110','10000','10000','10000'],Q:['01110','10001','10001','10001','10101','10010','01101'],R:['11110','10001','10001','11110','10100','10010','10001'],S:['01111','10000','10000','01110','00001','00001','11110'],T:['11111','00100','00100','00100','00100','00100','00100'],U:['10001','10001','10001','10001','10001','10001','01110'],V:['10001','10001','10001','10001','10001','01010','00100'],W:['10001','10001','10001','10101','10101','10101','01010'],X:['10001','10001','01010','00100','01010','10001','10001'],Y:['10001','10001','01010','00100','00100','00100','00100'],Z:['11111','00001','00010','00100','01000','10000','11111'],
'a':['00000','00000','01110','00001','01111','10001','01111'],b:['10000','10000','10110','11001','10001','10001','11110'],c:['00000','00000','01111','10000','10000','10000','01111'],d:['00001','00001','01101','10011','10001','10001','01111'],e:['00000','00000','01110','10001','11111','10000','01111'],f:['00111','01000','01000','11110','01000','01000','01000'],g:['00000','01111','10001','10001','01111','00001','01110'],h:['10000','10000','10110','11001','10001','10001','10001'],i:['00100','00000','01100','00100','00100','00100','01110'],j:['00010','00000','00110','00010','00010','10010','01100'],k:['10000','10001','10010','10100','11000','10100','10010'],l:['01100','00100','00100','00100','00100','00100','01110'],m:['00000','00000','11010','10101','10101','10101','10101'],n:['00000','00000','10110','11001','10001','10001','10001'],o:['00000','00000','01110','10001','10001','10001','01110'],p:['00000','11110','10001','10001','11110','10000','10000'],q:['00000','01111','10001','10001','01111','00001','00001'],r:['00000','00000','10110','11001','10000','10000','10000'],s:['00000','00000','01111','10000','01110','00001','11110'],t:['01000','01000','11110','01000','01000','01001','00110'],u:['00000','00000','10001','10001','10001','10011','01101'],v:['00000','00000','10001','10001','10001','01010','00100'],w:['00000','00000','10001','10001','10101','10101','01010'],x:['00000','00000','10001','01010','00100','01010','10001'],y:['00000','10001','10001','10001','01111','00001','01110'],z:['00000','00000','11111','00010','00100','01000','11111'],
'0':['01110','10001','10011','10101','11001','10001','01110'],'1':['00100','01100','00100','00100','00100','00100','01110'],'2':['01110','10001','00001','00010','00100','01000','11111'],'3':['11110','00001','00001','01110','00001','00001','11110'],'4':['00010','00110','01010','10010','11111','00010','00010'],'5':['11111','10000','10000','11110','00001','00001','11110'],'6':['01110','10000','10000','11110','10001','10001','01110'],'7':['11111','00001','00010','00100','01000','01000','01000'],'8':['01110','10001','10001','01110','10001','10001','01110'],'9':['01110','10001','10001','01111','00001','00001','01110'],'.':['00000','00000','00000','00000','00000','01100','01100'],'-':['00000','00000','00000','11111','00000','00000','00000'],':':['00000','01100','01100','00000','01100','01100','00000']
};
const TEXT_ENGINE_FONT_IDS=new Set(['courier-prime-regular','great-vibes-regular']);
const DEFAULT_TEXT_FONT_ID='courier-prime-regular';
// RS-0003.5D2: named UI-interaction constants (previously an unexplained inline 1:1 multiplier
// and no explicit zoom clamp). CUP_ROTATION_SENSITIVITY is degrees of cup rotation per pixel of
// horizontal drag on the cup preview canvas — substantially below 1 so small mouse movements stay
// controllable. ZOOM_MIN/ZOOM_MAX mirror the #zoom range input's min="70"/max="140" (percent) and
// defensively clamp zoom in case an out-of-range or non-finite value ever reaches it.
const CUP_ROTATION_SENSITIVITY=0.35;
const ZOOM_MIN=0.7,ZOOM_MAX=1.4;
// S-001: how close `rotation` must be to a .viewBtn's data-view (in degrees, mod 360, so -180 and
// 180 both match Back) for that button to show as the active/highlighted view.
const VIEW_ANGLE_EPSILON_DEG=0.5;
// RS-1002: bounds HistoryManager's undo/redo depth. Undo/redo is otherwise unlimited -- normal
// editing sessions never come close to 100 steps -- this only caps worst-case memory use.
const HISTORY_MAX_SIZE=100;
// RS-0003.5D2: resolves a <select>'s value by nearest numeric match instead of an exact string
// match. Fixes the #stoneSize dropdown showing blank on load: a layer's stoneSize is a plain JS
// number (e.g. 2), but String(2)==='2' matches no <option> (index.html's options are formatted
// like "2.0"), so the browser rendered no selection even though the underlying mm value was
// valid. Never mutates the numeric value itself, only the displayed selection.
function setNumericSelectValue(select,num){let best=null,bestDiff=Infinity;for(const opt of select.options){const v=parseFloat(opt.value);if(Number.isFinite(v)){const diff=Math.abs(v-num);if(diff<bestDiff){bestDiff=diff;best=opt.value}}}select.value=best!==null?best:String(num)}
class GeometryEngine{constructor(permanentEngine=null){this.permanentEngine=permanentEngine}
 // Geometry generation happens exactly once here, per docs/ARCHITECTURE.md: every layer's stones
 // come straight from the permanent engine's per-layer StoneLayout; dedupe() below only filters
 // already-generated stones by proximity across layers, it invents no new positions. The survivors
 // are wrapped into one real StoneLayout ('project' is a sentinel layerId — StoneLayout requires
 // one non-empty layerId per instance; each Stone still carries its own real layer id) so every
 // renderer/exporter downstream consumes the same canonical product.
 async generate(project){let raw=[];for(const l of project.layers){if(!l.visible)continue;if(l.type==='text')raw.push(...await this.generateTextStonesLive(l,project));if(l.type==='circle'||l.type==='rectangle')raw.push(...await this.generateShapeStonesLive(l));if(l.type==='svg')raw.push(...await this.generateSvgStonesLive(l));}const stones=this.dedupe(raw,Math.min(...raw.map(s=>s.d||2),2)*0.58).map(s=>new Stone({xMm:s.x,yMm:s.y,sizeMm:s.d,color:s.color,layerId:s.layerId}));return new StoneLayout({layerId:'project',stones})}
 async generateTextStonesLive(layer,project){if(!this.permanentEngine||!this.permanentEngine.canGenerateText||!layer.text)return[];const fontId=TEXT_ENGINE_FONT_IDS.has(layer.font)?layer.font:DEFAULT_TEXT_FONT_ID;const mode=layer.textMode==='fill'?'fill':'outline';const base={text:layer.text,fontId,layerId:layer.id,heightMm:layer.height,stoneSizeMm:layer.stoneSize,gapMm:layer.gap,mode,color:layer.color,curveEnabled:Boolean(layer.curveEnabled),curveRadiusMm:layer.curveRadiusMm,curveDirection:layer.curveDirection,curveStartAngleDeg:layer.curveStartAngleDeg,curveSweepAngleDeg:layer.curveSweepAngleDeg,curveAlignment:layer.curveAlignment};let result=await this.permanentEngine.generateTextLayout(base);if(layer.autoFit){const maxWidth=project.canvas.width-10;if(result.widthMm>maxWidth&&result.widthMm>0){const scale=maxWidth/result.widthMm;const scaledHeight=Math.max(1,layer.height*scale);result=await this.permanentEngine.generateTextLayout({...base,heightMm:scaledHeight})}}const bb=result.getBoundingBox();const offsetX=bb?(project.canvas.width-bb.widthMm)/2-bb.minXmm:0;const offsetY=bb?(project.canvas.height-bb.heightMm)/2-bb.minYmm:0;return result.stones.map(s=>({x:s.xMm+offsetX,y:s.yMm+offsetY,d:s.sizeMm,color:s.color,layerId:s.layerId}))}
 // RS-0003.5C1: circle/rectangle layers are generated by the same permanent engine's
 // generateShapeLayout(), mirroring generateTextStonesLive() above.
 async generateShapeStonesLive(layer){if(!this.permanentEngine)return[];const isCircle=layer.type==='circle';const params={shape:layer.type,layerId:layer.id,stoneSizeMm:layer.stoneSize,gapMm:layer.gap,mode:'outline',color:layer.color,...(isCircle?{cxMm:layer.cx,cyMm:layer.cy,radiusMm:layer.r}:{xMm:layer.x,yMm:layer.y,widthMm:layer.w,heightMm:layer.h})};const result=this.permanentEngine.generateShapeLayout(params);return result.stones.map(s=>({x:s.xMm,y:s.yMm,d:s.sizeMm,color:s.color,layerId:s.layerId}))}
 // RS-1001: svg layers reuse the same x/y/w/h placement box rectangle layers use; src/svg/**
 // (not app.js) does the actual SVG parsing, inside generateSvgLayout().
 async generateSvgStonesLive(layer){if(!this.permanentEngine)return[];const params={svgSource:layer.svgSource,layerId:layer.id,xMm:layer.x,yMm:layer.y,widthMm:layer.w,heightMm:layer.h,stoneSizeMm:layer.stoneSize,gapMm:layer.gap,mode:layer.mode==='fill'?'fill':'outline',color:layer.color};const result=this.permanentEngine.generateSvgLayout(params);return result.stones.map(s=>({x:s.xMm,y:s.yMm,d:s.sizeMm,color:s.color,layerId:s.layerId}))}
 // Legacy bitmap text path below (generateText/sampleGlyphFill/sampleGlyphStroke) and the legacy
 // generateCircle/generateRect shape path are kept but no longer called now that
 // generateTextStonesLive/generateShapeStonesLive use the permanent engine. Retained per
 // "do not remove the legacy engine until no live behavior depends on it" since line()/dedupe()/
 // bbox() are still shared between the legacy bitmap text stroke sampler and the unused legacy
 // shape generators below.
 generateText(layer,project){const d=layer.stoneSize,g=layer.gap,step=d+g;const mode=layer.textMode||'stroke';const unit=mode==='fill'?layer.height/7:layer.height/8.5;const charW=5*unit,charGap=1.55*unit;let width=0;for(const ch of layer.text)width+=(FONT5[ch]||FONT5['?']||FONT5[' '])?charW+charGap:charW+charGap;width=Math.max(0,width-charGap);let scale=1;if(layer.autoFit&&width>project.canvas.width-10)scale=(project.canvas.width-10)/width;const u=unit*scale;const sx=(project.canvas.width-width*scale)/2;const sy=(project.canvas.height-7*u)/2;const stones=[];let cursor=sx;for(const ch of layer.text){const grid=FONT5[ch]||FONT5[ch.toUpperCase()]||FONT5[' '];if(mode==='fill')this.sampleGlyphFill(grid,cursor,sy,u,step,d,layer.color,layer.id,stones);else this.sampleGlyphStroke(grid,cursor,sy,u,step,d,layer.color,layer.id,stones);cursor+=(5*unit+charGap)*scale;}return this.dedupe(stones,step*0.62)}
 sampleGlyphFill(grid,x0,y0,u,step,d,color,layerId,out){const pitch=Math.max(step,u*.88);for(let r=0;r<7;r++)for(let c=0;c<5;c++)if(grid[r][c]==='1'){const cx=x0+(c+.5)*u,cy=y0+(r+.5)*u;for(let y=cy-u*.28;y<=cy+u*.28;y+=pitch)for(let x=cx-u*.28;x<=cx+u*.28;x+=pitch)out.push({x,y,d,color,layerId});}}
 sampleGlyphStroke(grid,x0,y0,u,step,d,color,layerId,out){const pitch=step;const cell=(r,c)=>r>=0&&r<7&&c>=0&&c<5&&grid[r][c]==='1';for(let r=0;r<7;r++)for(let c=0;c<5;c++)if(cell(r,c)){const cx=x0+(c+.5)*u,cy=y0+(r+.5)*u;if(cell(r,c+1))this.line(out,cx,cy,x0+(c+1.5)*u,cy,pitch,d,color,layerId);if(cell(r+1,c))this.line(out,cx,cy,cx,y0+(r+1.5)*u,pitch,d,color,layerId);if(!cell(r,c+1)&&!cell(r+1,c)&&!cell(r,c-1)&&!cell(r-1,c))out.push({x:cx,y:cy,d,color,layerId});}}
 line(out,x1,y1,x2,y2,pitch,d,color,layerId){const len=Math.hypot(x2-x1,y2-y1),n=Math.max(1,Math.round(len/pitch));for(let i=0;i<=n;i++){const t=i/n;out.push({x:x1+(x2-x1)*t,y:y1+(y2-y1)*t,d,color,layerId});}}
 generateCircle(l){const out=[],d=l.stoneSize,step=d+l.gap,r=Math.max(1,l.r);const n=Math.max(8,Math.round(2*Math.PI*r/step));for(let i=0;i<n;i++){const a=i/n*Math.PI*2;out.push({x:l.cx+Math.cos(a)*r,y:l.cy+Math.sin(a)*r,d,color:l.color,layerId:l.id});}return out}
 generateRect(l){const out=[],d=l.stoneSize,step=d+l.gap,x0=l.x,y0=l.y,x1=l.x+l.w,y1=l.y+l.h;const addLine=(a,b,c,d2)=>this.line(out,a,b,c,d2,step,d,l.color,l.id);addLine(x0,y0,x1,y0);addLine(x1,y0,x1,y1);addLine(x1,y1,x0,y1);addLine(x0,y1,x0,y0);return this.dedupe(out,step*.62)}
 dedupe(stones,minDist){const cell=Math.max(minDist,0.5),grid=new Map(),out=[],m2=minDist*minDist;for(const s of stones){const gx=Math.floor(s.x/cell),gy=Math.floor(s.y/cell);let ok=true;for(let yy=gy-1;yy<=gy+1;yy++)for(let xx=gx-1;xx<=gx+1;xx++){const arr=grid.get(xx+','+yy)||[];for(const o of arr){const dx=s.x-o.x,dy=s.y-o.y;if(dx*dx+dy*dy<m2){ok=false;break}}if(!ok)break}if(ok){out.push(s);const k=gx+','+gy;if(!grid.has(k))grid.set(k,[]);grid.get(k).push(s)}}return out}
 bbox(stones){if(!stones.length)return{x:0,y:0,width:0,height:0,x2:0,y2:0};let x=Infinity,y=Infinity,x2=-Infinity,y2=-Infinity;for(const s of stones){x=Math.min(x,s.x-s.d/2);y=Math.min(y,s.y-s.d/2);x2=Math.max(x2,s.x+s.d/2);y2=Math.max(y2,s.y+s.d/2)}return{x,y,x2,y2,width:x2-x,height:y2-y}}
 layerBBox(layer){if(layer.type==='circle')return{x:layer.cx-layer.r,y:layer.cy-layer.r,width:layer.r*2,height:layer.r*2,x2:layer.cx+layer.r,y2:layer.cy+layer.r};if(layer.type==='rectangle')return{x:layer.x,y:layer.y,width:layer.w,height:layer.h,x2:layer.x+layer.w,y2:layer.y+layer.h};const stones=this.generateText(layer,project);return this.bbox(stones)} }
function defaultProject(){return{version:2,units:'mm',product:'mug',canvas:{width:210,height:90},cupColor:'#1f3556',wrap:'front',layers:[{id:'text',type:'text',visible:true,text:'Vitalina Serbin',font:DEFAULT_TEXT_FONT_ID,height:25,textMode:'stroke',stoneSize:2,gap:.3,color:'gold',autoFit:true,curveEnabled:false,curveRadiusMm:40,curveDirection:'outside',curveStartAngleDeg:0,curveSweepAngleDeg:360,curveAlignment:'center'}]}}
// RS-0003.5D1: validates an imported Project JSON file against the exact ad hoc project/layer
// shape #exportProject already produces (JSON.stringify(project)). Throws a specific Error
// describing the first problem found instead of silently accepting a malformed project; the
// caller (the #importProjectFile change handler) surfaces that message via #status and leaves
// the current `project` untouched on failure. Returns a normalized copy on success — it never
// mutates its input.
const SUPPORTED_LAYER_TYPES=new Set(['text','circle','rectangle','svg']);
function validateProject(obj){
  if(!obj||typeof obj!=='object'||Array.isArray(obj))throw new Error('Project file must contain a JSON object.');
  const canvas=obj.canvas;
  if(!canvas||typeof canvas.width!=='number'||!Number.isFinite(canvas.width)||canvas.width<=0)throw new Error('project.canvas.width must be a positive number.');
  if(typeof canvas.height!=='number'||!Number.isFinite(canvas.height)||canvas.height<=0)throw new Error('project.canvas.height must be a positive number.');
  if(!Array.isArray(obj.layers)||obj.layers.length===0)throw new Error('project.layers must be a non-empty array.');
  const ids=new Set();
  for(let i=0;i<obj.layers.length;i++){
    const l=obj.layers[i];
    if(!l||typeof l!=='object'||Array.isArray(l))throw new Error(`layers[${i}] must be an object.`);
    if(typeof l.id!=='string'||l.id.length===0)throw new Error(`layers[${i}] is missing a non-empty string id.`);
    if(ids.has(l.id))throw new Error(`Duplicate layer id: ${l.id}`);
    ids.add(l.id);
    if(!SUPPORTED_LAYER_TYPES.has(l.type))throw new Error(`Layer "${l.id}" has unsupported type: ${l.type}`);
    if(l.type==='text'&&typeof l.text!=='string')throw new Error(`Text layer "${l.id}" is missing a string 'text' field.`);
    if(l.type==='circle'&&![l.cx,l.cy,l.r].every(n=>typeof n==='number'&&Number.isFinite(n)))throw new Error(`Circle layer "${l.id}" is missing numeric cx/cy/r fields.`);
    if(l.type==='rectangle'&&![l.x,l.y,l.w,l.h].every(n=>typeof n==='number'&&Number.isFinite(n)))throw new Error(`Rectangle layer "${l.id}" is missing numeric x/y/w/h fields.`);
    if(l.type==='svg'&&(typeof l.svgSource!=='string'||l.svgSource.length===0))throw new Error(`SVG layer "${l.id}" is missing a non-empty 'svgSource' string.`);
    if(l.type==='svg'&&![l.x,l.y,l.w,l.h].every(n=>typeof n==='number'&&Number.isFinite(n)))throw new Error(`SVG layer "${l.id}" is missing numeric x/y/w/h fields.`);
    if(typeof l.stoneSize!=='number'||!Number.isFinite(l.stoneSize)||l.stoneSize<=0)throw new Error(`Layer "${l.id}" is missing a positive numeric stoneSize.`);
    if(typeof l.gap!=='number'||!Number.isFinite(l.gap)||l.gap<0)throw new Error(`Layer "${l.id}" is missing a non-negative numeric gap.`);
  }
  // RS-1004: product is normalized through getObjectTemplate()'s own permissive fallback (unknown
  // or missing ids resolve to 'mug'), so project.product is always a real, known template id —
  // matching this function's existing permissive style for cupColor/wrap (never throws for
  // unrecognized values).
  return{version:Number(obj.version)||2,units:'mm',product:getObjectTemplate(obj.product).id,canvas:{width:canvas.width,height:canvas.height},cupColor:typeof obj.cupColor==='string'?obj.cupColor:'#1f3556',wrap:typeof obj.wrap==='string'?obj.wrap:'front',layers:obj.layers.map(l=>({...l,visible:l.visible!==false}))}
}
let fontProviderRegistry=null,permanentEngineError=null;
try{const fontManager=await FontManager.fromUrl('./assets/fonts/manifest.json');fontProviderRegistry=createDefaultFontProviderRegistry(fontManager)}catch(error){permanentEngineError=error;console.error('Font manifest failed to load; text layers will render empty until this is resolved. Shape layers are unaffected.',error)}
const permanentEngine=new PermanentGeometryEngine({fontProviderRegistry});
const engine=new GeometryEngine(permanentEngine);let project=defaultProject(),selectedLayerId='text',layout=null,rotation=0,zoom=1,layoutTransform=null,drag=null,generationToken=0;const el=id=>document.getElementById(id);const layoutCanvas=el('layout'),cupCanvas=el('cup');function selectedLayer(){return project.layers.find(l=>l.id===selectedLayerId)||project.layers[0]}
// RS-1004: resolves project.product (the pre-existing, previously-unread ad hoc field) to its real
// ObjectTemplate record. getObjectTemplate() itself falls back to 'mug' for any unknown/missing id,
// so this never throws.
function currentObjectTemplate(){return getObjectTemplate(project.product)}
// RS-1002: undo/redo history. HistoryManager (src/history/**) stores only serialized
// {project,selectedLayerId} snapshots -- never the generated StoneLayout -- so history never
// duplicates geometry, and geometry is always regenerated fresh from the restored project via
// updateAll() inside applyHistorySnapshot(). commitHistory() is used for discrete actions
// (add/duplicate/delete/visibility/SVG-import/drag-start), one call per action; openHistorySession/
// closeHistorySession coalesce every keystroke/slider-tick of one continuous field edit (text,
// font, stone size, gap, color, wrap, text mode, shape x/y/w/h, svg mode) into a single undo step,
// opened on the field's first 'input' event and closed on its 'change' event. `rotation`/`zoom` are
// view-only (not part of `project`, not in the required undoable-operation list) and are
// deliberately excluded. Importing a Project JSON file clears history entirely (a fresh project,
// not an undoable edit); exporting never touches history at all.
const history=new HistoryManager({maxSize:HISTORY_MAX_SIZE});
let cleanProjectJson=JSON.stringify(project);
function currentSnapshot(){return{project:JSON.parse(JSON.stringify(project)),selectedLayerId}}
function commitHistory(){history.commit(currentSnapshot());updateHistoryUI()}
function openHistorySession(){if(history.sessionOpen)return;history.beginSession(currentSnapshot());updateHistoryUI()}
function closeHistorySession(){history.endSession()}
function applyHistorySnapshot(snap){project=snap.project;selectedLayerId=snap.selectedLayerId;syncSelectedControlsFromLayer();updateAll(true)}
function performUndo(){closeHistorySession();const snap=history.undo(currentSnapshot());if(!snap){el('status').textContent='Nothing to undo';updateHistoryUI();return}applyHistorySnapshot(snap);el('status').textContent='Undo'}
function performRedo(){closeHistorySession();const snap=history.redo(currentSnapshot());if(!snap){el('status').textContent='Nothing to redo';updateHistoryUI();return}applyHistorySnapshot(snap);el('status').textContent='Redo'}
function updateHistoryUI(){const undoBtn=el('undoBtn'),redoBtn=el('redoBtn'),dirtyEl=el('dirtyIndicator');if(undoBtn)undoBtn.disabled=!history.canUndo;if(redoBtn)redoBtn.disabled=!history.canRedo;if(dirtyEl)dirtyEl.textContent=JSON.stringify(project)!==cleanProjectJson?'Unsaved changes':'Saved'}function syncSelectedControlsFromLayer(){const l=selectedLayer();el('selectedLayer').value=l.id;const isText=l.type==='text';el('textControls').style.display=isText?'block':'none';el('shapeControls').style.display=isText?'none':'block';el('svgControls').style.display=l.type==='svg'?'block':'none';if(isText){el('text').value=l.text;el('font').value=l.font;el('height').value=l.height;el('autoFit').value=l.autoFit?'on':'off';el('textMode').value=l.textMode||'stroke';el('curveEnabled').value=l.curveEnabled?'on':'off';el('curveRadiusMm').value=l.curveRadiusMm??40;el('curveDirection').value=l.curveDirection||'outside';el('curveStartAngleDeg').value=l.curveStartAngleDeg??0;el('curveSweepAngleDeg').value=l.curveSweepAngleDeg??360;el('curveAlignment').value=l.curveAlignment||'center';el('curveControls').style.display=l.curveEnabled?'block':'none'}else{el('shapeX').value=l.type==='circle'?l.cx:l.x;el('shapeY').value=l.type==='circle'?l.cy:l.y;el('shapeW').value=l.type==='circle'?l.r:l.w;el('shapeH').value=l.type==='circle'?'':l.h;if(l.type==='svg')el('svgMode').value=l.mode||'outline'}setNumericSelectValue(el('stoneSize'),l.stoneSize);el('gap').value=l.gap;el('stoneColor').value=l.color;
  // RS-1002: project.cupColor/project.wrap are project-level (not per-layer) fields, so they must
  // be resynced here too -- otherwise an undo/redo restore (or a Project JSON import) leaves these
  // two dropdowns stale, and the *next* edit's writeSelectedControlsToLayer() would silently write
  // the stale displayed value back into `project`, undoing the very restore that just happened.
  el('cupColor').value=project.cupColor;el('wrap').value=project.wrap;
  // RS-1004: project.product is likewise project-level, not per-layer -- resync on every selection
  // change/undo/redo/import for the same reason cupColor/wrap are resynced above.
  el('objectType').value=project.product;
}
function writeSelectedControlsToLayer(){const l=selectedLayer();if(l.type==='text'){l.text=el('text').value;l.font=el('font').value;l.height=parseFloat(el('height').value)||25;l.autoFit=el('autoFit').value==='on';l.textMode=el('textMode').value;l.curveEnabled=el('curveEnabled').value==='on';l.curveRadiusMm=Math.max(0.1,parseFloat(el('curveRadiusMm').value)||40);l.curveDirection=el('curveDirection').value==='inside'?'inside':'outside';l.curveStartAngleDeg=parseFloat(el('curveStartAngleDeg').value)||0;l.curveSweepAngleDeg=parseFloat(el('curveSweepAngleDeg').value)||360;l.curveAlignment=el('curveAlignment').value;el('curveControls').style.display=l.curveEnabled?'block':'none'}else if(l.type==='circle'){l.cx=parseFloat(el('shapeX').value)||105;l.cy=parseFloat(el('shapeY').value)||45;l.r=Math.max(1,parseFloat(el('shapeW').value)||18)}else if(l.type==='rectangle'){l.x=parseFloat(el('shapeX').value)||65;l.y=parseFloat(el('shapeY').value)||30;l.w=Math.max(1,parseFloat(el('shapeW').value)||80);l.h=Math.max(1,parseFloat(el('shapeH').value)||30)}else if(l.type==='svg'){l.x=parseFloat(el('shapeX').value)||0;l.y=parseFloat(el('shapeY').value)||0;l.w=Math.max(1,parseFloat(el('shapeW').value)||10);l.h=Math.max(1,parseFloat(el('shapeH').value)||10);l.mode=el('svgMode').value==='fill'?'fill':'outline'}l.stoneSize=parseFloat(el('stoneSize').value)||2;l.gap=parseFloat(el('gap').value)||.3;l.color=el('stoneColor').value;project.cupColor=el('cupColor').value;project.wrap=el('wrap').value;rotation=parseFloat(el('rotation').value)||0;zoom=Math.max(ZOOM_MIN,Math.min(ZOOM_MAX,(parseFloat(el('zoom').value)||100)/100))}
async function updateAll(skipWrite=false){if(!skipWrite)writeSelectedControlsToLayer();const token=++generationToken;let generated;try{generated=await engine.generate(project)}catch(error){if(token!==generationToken)return;console.error('Layout generation failed',error);el('status').textContent=`Text generation failed: ${error.message}`;return}if(token!==generationToken)return;layout=generated;renderLayerUI();drawLayout();drawCup();updateStats();updateHistoryUI();updateViewButtons();if(permanentEngineError)el('status').textContent=`Font manifest failed to load (${permanentEngineError.message}); text layers are empty. Shape layers are unaffected.`}// S-003: a project must always keep at least one layer (deleteLayer()'s guard below), so once
// only one layer remains, every delete affordance -- the per-row trash icon and the sidebar
// "Delete selected layer" button -- is disabled here (not just left clickable-but-a-no-op) and
// #layerRuleHint (sitting directly under the button, always in view) explains why. This runs on
// every renderLayerUI() call (i.e. after every add/delete/duplicate/undo/redo/import), so the
// disabled state and hint never go stale relative to the current layer count.
function renderLayerUI(){const onlyOneLayer=project.layers.length<=1;el('selectedLayer').innerHTML=project.layers.map(l=>`<option value="${l.id}">${escapeHtml(layerLabel(l))}</option>`).join('');el('selectedLayer').value=selectedLayerId;el('layersList').innerHTML=project.layers.map(l=>`<div class="layer ${l.id===selectedLayerId?'selected':''}" data-layer="${l.id}"><input type="checkbox" ${l.visible?'checked':''} data-action="visible"><div class="name" data-action="select">${escapeHtml(layerLabel(l))}</div><div class="type">${l.type.toUpperCase()}</div><button data-action="select">✎</button><button data-action="duplicate">⧉</button><button data-action="delete" ${onlyOneLayer?'disabled title="At least one layer is required"':''}>🗑</button></div>`).join('');el('deleteSelected').disabled=onlyOneLayer;el('deleteSelected').title=onlyOneLayer?'At least one layer is required':'';el('layerRuleHint').style.display=onlyOneLayer?'block':'none'}function layerLabel(l){return l.type==='text'?(l.text||'Text'):l.type==='circle'?'Circle':l.type==='svg'?(l.svgName||'SVG'):'Rectangle'}function escapeHtml(s){return String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}
function resizeCanvas(c){const r=c.getBoundingClientRect(),dpr=Math.max(1,devicePixelRatio||1),w=Math.floor(r.width*dpr),h=Math.floor(r.height*dpr);if(c.width!==w||c.height!==h){c.width=w;c.height=h}return{w,h,dpr}}
function layoutMmToPx(p){return{x:layoutTransform.ox+p.x*layoutTransform.s,y:layoutTransform.oy+p.y*layoutTransform.s}}function layoutPxToMm(x,y){return{x:(x-layoutTransform.ox)/layoutTransform.s,y:(y-layoutTransform.oy)/layoutTransform.s}}
function drawLayout(){const{w,h,dpr}=resizeCanvas(layoutCanvas),ctx=layoutCanvas.getContext('2d');const{s,ox,oy}=renderProductionLayout(ctx,layout,{widthPx:w,heightPx:h,paddingPx:38*dpr});layoutTransform={s,ox,oy,dpr};drawSafeAreaGuide(ctx,s,ox,oy,dpr,getSafeAreaRectMm(currentObjectTemplate(),project.canvas.width,project.canvas.height));drawSelection(ctx,s,ox,oy,dpr);ctx.fillStyle='#516071';ctx.font=`${12*dpr}px Arial`;ctx.fillText(`${layout.count} stones · ${layout.widthMm.toFixed(1)}×${layout.heightMm.toFixed(1)} mm · ${selectedLayer().textMode||''}`,20*dpr,h-18*dpr);el('fitNotice').textContent='Drag shapes with mouse. Text uses readable stroke font.'}
// RS-1004: a dashed guide rectangle for the active object template's safe design area, derived from
// the current project.canvas size. This is a layer-agnostic editor overlay (like drawSelection()
// below), not a CanvasRenderer2D.js change -- it reuses the exact mm->px transform
// renderProductionLayout() already returned, drawn before the selection outline so selection always
// reads on top.
function drawSafeAreaGuide(ctx,s,ox,oy,dpr,rectMm){const rx=ox+rectMm.xMm*s,ry=oy+rectMm.yMm*s,rw=rectMm.widthMm*s,rh=rectMm.heightMm*s;ctx.save();ctx.strokeStyle='rgba(20,120,255,.45)';ctx.lineWidth=1.25*dpr;ctx.setLineDash([5*dpr,4*dpr]);ctx.strokeRect(rx,ry,rw,rh);ctx.setLineDash([]);ctx.restore()}
// Text layers have no plain layer fields to compute a bbox from directly (unlike circle/
// rectangle), so their selection bbox is derived from the already-generated StoneLayout, filtered
// to this layer's stones and wrapped in a fresh StoneLayout to reuse its getBoundingBox() math.
function getLayerBBox(l){if(l.type==='circle')return{x:l.cx-l.r,y:l.cy-l.r,width:l.r*2,height:l.r*2,x2:l.cx+l.r,y2:l.cy+l.r};if(l.type==='rectangle'||l.type==='svg')return{x:l.x,y:l.y,width:l.w,height:l.h,x2:l.x+l.w,y2:l.y+l.h};const stones=layout.stones.filter(s=>s.layerId===l.id);if(!stones.length)return{x:0,y:0,x2:0,y2:0,width:0,height:0};const b=new StoneLayout({layerId:l.id,stones}).getBoundingBox();return{x:b.minXmm,y:b.minYmm,x2:b.maxXmm,y2:b.maxYmm,width:b.widthMm,height:b.heightMm}}
// RS-0003.5D2: SELECTION_HANDLE_SIZE_PX enlarges the resize handles slightly (was a bare 10px
// square) and a white halo is stroked behind the dashed outline so the selection reads clearly
// against any background (light grid, light/dark stones), not just against the plain canvas.
const SELECTION_HANDLE_SIZE_PX=11;
function drawSelection(ctx,s,ox,oy,dpr){const l=selectedLayer();const b=getLayerBBox(l);const rx=ox+b.x*s,ry=oy+b.y*s,rw=b.width*s,rh=b.height*s;ctx.save();ctx.strokeStyle='rgba(255,255,255,.9)';ctx.lineWidth=4*dpr;ctx.setLineDash([]);ctx.strokeRect(rx,ry,rw,rh);ctx.strokeStyle='#1478ff';ctx.lineWidth=1.75*dpr;ctx.setLineDash([6*dpr,3*dpr]);ctx.strokeRect(rx,ry,rw,rh);ctx.setLineDash([]);if(l.type!=='text'){for(const h of handlesFor(b)){const hs=SELECTION_HANDLE_SIZE_PX*dpr;ctx.shadowColor='rgba(20,30,50,.35)';ctx.shadowBlur=3*dpr;ctx.fillStyle='white';ctx.strokeStyle='#1478ff';ctx.lineWidth=1.75*dpr;ctx.beginPath();ctx.rect(ox+h.x*s-hs/2,oy+h.y*s-hs/2,hs,hs);ctx.fill();ctx.shadowColor='transparent';ctx.shadowBlur=0;ctx.stroke()}}ctx.restore()}
function handlesFor(b){return[{name:'nw',x:b.x,y:b.y},{name:'ne',x:b.x2,y:b.y},{name:'se',x:b.x2,y:b.y2},{name:'sw',x:b.x,y:b.y2},{name:'n',x:b.x+b.width/2,y:b.y},{name:'e',x:b.x2,y:b.y+b.height/2},{name:'s',x:b.x+b.width/2,y:b.y2},{name:'w',x:b.x,y:b.y+b.height/2}]}
function drawCup(){const{w,h,dpr}=resizeCanvas(cupCanvas),ctx=cupCanvas.getContext('2d');renderCup(ctx,layout,{widthPx:w,heightPx:h,dpr,cupColor:project.cupColor,wrap:project.wrap,rotationDeg:rotation,zoom,objectTemplate:currentObjectTemplate()})}
// S-001: keeps the Front/Left/Right/Back buttons' highlighted state synchronized with `rotation`
// regardless of how it changed (view-button click, reset, slider, or manual cup-drag), since this
// is called from updateAll() rather than duplicated at each rotation-changing call site.
function angleDiffDeg(a,b){const norm=x=>((x%360)+360)%360;const d=Math.abs(norm(a)-norm(b))%360;return Math.min(d,360-d)}
function updateViewButtons(){document.querySelectorAll('.viewBtn').forEach(b=>b.classList.toggle('primary',angleDiffDeg(rotation,parseFloat(b.dataset.view))<VIEW_ANGLE_EPSILON_DEG))}
function updateStats(){el('layoutStats').innerHTML=`<b>${layout.count}</b> stones <span>${layout.widthMm.toFixed(1)}×${layout.heightMm.toFixed(1)} mm</span><span>selected: ${escapeHtml(layerLabel(selectedLayer()))}</span>`;el('cupStats').innerHTML=`<span>${escapeHtml(currentObjectTemplate().displayName)}</span><span>same generated layout</span><span>${STONE_COLORS[selectedLayer().color]?.name||''}</span><span>rotation ${Math.round(rotation)}°</span>`}
function download(name,mime,data){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([data],{type:mime}));a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),800);el('status').textContent=`Downloaded ${name}`}function exportCanvas(name,canvas){canvas.toBlob(b=>{const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),800)},'image/png')}
function duplicateLayer(id){const l=project.layers.find(x=>x.id===id);if(!l)return;commitHistory();const copy=JSON.parse(JSON.stringify(l));copy.id=l.type+Date.now();if(copy.type==='circle'){copy.cx+=8;copy.cy+=8}if(copy.type==='rectangle'){copy.x+=8;copy.y+=8}if(copy.type==='svg'){copy.x+=8;copy.y+=8}if(copy.type==='text'){copy.text+=' copy'}project.layers.push(copy);selectedLayerId=copy.id;syncSelectedControlsFromLayer();updateAll()}function deleteLayer(id){if(project.layers.length<=1){el('status').textContent='Cannot delete the last layer';const hint=el('layerRuleHint');hint.style.display='block';hint.scrollIntoView({block:'nearest'});return}commitHistory();project.layers=project.layers.filter(l=>l.id!==id);selectedLayerId=project.layers[0].id;syncSelectedControlsFromLayer();updateAll(true)}
function pointerToLayout(e){const r=layoutCanvas.getBoundingClientRect(),dpr=layoutTransform.dpr;return layoutPxToMm((e.clientX-r.left)*dpr,(e.clientY-r.top)*dpr)}function hitTest(mm){const layers=[...project.layers].reverse();for(const l of layers){const b=getLayerBBox(l);for(const h of handlesFor(b)){if(Math.abs(mm.x-h.x)<3&&Math.abs(mm.y-h.y)<3&&l.type!=='text')return{layer:l,kind:'resize',handle:h.name,b0:b}}if(mm.x>=b.x&&mm.x<=b.x2&&mm.y>=b.y&&mm.y<=b.y2)return{layer:l,kind:l.type==='text'?'select':'move',b0:b}}return null}
layoutCanvas.addEventListener('pointerdown',e=>{const mm=pointerToLayout(e);const hit=hitTest(mm);if(!hit)return;selectedLayerId=hit.layer.id;syncSelectedControlsFromLayer();if(hit.kind==='select'){updateAll();return}commitHistory();drag={kind:hit.kind,handle:hit.handle,layerId:hit.layer.id,start:mm,b0:hit.b0,l0:JSON.parse(JSON.stringify(hit.layer))};layoutCanvas.setPointerCapture(e.pointerId);updateAll(true)});layoutCanvas.addEventListener('pointermove',e=>{if(!drag)return;const mm=pointerToLayout(e),dx=mm.x-drag.start.x,dy=mm.y-drag.start.y,l=project.layers.find(x=>x.id===drag.layerId);if(!l)return;if(drag.kind==='move'){if(l.type==='circle'){l.cx=drag.l0.cx+dx;l.cy=drag.l0.cy+dy}else if(l.type==='rectangle'||l.type==='svg'){l.x=drag.l0.x+dx;l.y=drag.l0.y+dy}}else if(drag.kind==='resize'){if(l.type==='circle'){l.r=Math.max(2,Math.hypot(mm.x-drag.l0.cx,mm.y-drag.l0.cy))}else if(l.type==='rectangle'||l.type==='svg'){let x0=drag.b0.x,y0=drag.b0.y,x1=drag.b0.x2,y1=drag.b0.y2;if(drag.handle.includes('w'))x0=mm.x;if(drag.handle.includes('e'))x1=mm.x;if(drag.handle.includes('n'))y0=mm.y;if(drag.handle.includes('s'))y1=mm.y;l.x=Math.min(x0,x1);l.y=Math.min(y0,y1);l.w=Math.max(2,Math.abs(x1-x0));l.h=Math.max(2,Math.abs(y1-y0))}}syncSelectedControlsFromLayer();updateAll(true)});window.addEventListener('pointerup',()=>drag=null);window.addEventListener('keydown',e=>{
  const key=e.key.toLowerCase(),mod=e.ctrlKey||e.metaKey;
  // RS-1002: app-level undo/redo takes precedence over any native browser input-level undo, so
  // these fire (and preventDefault) even while a text/number field has focus.
  if(mod&&key==='z'){e.preventDefault();if(e.shiftKey)performRedo();else performUndo();return}
  if(mod&&key==='y'){e.preventDefault();performRedo();return}
  if(e.key==='Delete'||e.key==='Backspace'){const t=document.activeElement?.tagName;if(t==='INPUT'||t==='SELECT')return;deleteLayer(selectedLayerId)}
});
// RS-1002: these controls edit `project` fields, so one undo step is committed per edit session
// (opened on the first 'input' event, closed on 'change'). `rotation`/`zoom` are view-only (not
// part of `project`) and keep their original plain 'input' listener, untouched.
const HISTORY_TRACKED_CONTROL_IDS=['text','font','height','stoneSize','gap','stoneColor','cupColor','autoFit','wrap','textMode','shapeX','shapeY','shapeW','shapeH','svgMode','curveEnabled','curveRadiusMm','curveDirection','curveStartAngleDeg','curveSweepAngleDeg','curveAlignment'];
for(const id of HISTORY_TRACKED_CONTROL_IDS){el(id).addEventListener('input',()=>{openHistorySession();updateAll()});el(id).addEventListener('change',()=>closeHistorySession())}
for(const id of ['rotation','zoom'])el(id).addEventListener('input',()=>updateAll());
el('selectedLayer').addEventListener('change',()=>{selectedLayerId=el('selectedLayer').value;syncSelectedControlsFromLayer();updateAll(true)});
// RS-1004: switching the object template is one discrete, undoable action (matching addCircle/
// addRect/deleteLayer's commitHistory()-then-mutate pattern below), not a continuous-session field
// -- it also resets project.canvas/project.wrap to the new template's own defaults, so those two
// resets are always committed together with the switch, never independently.
el('objectType').addEventListener('change',()=>{commitHistory();const template=getObjectTemplate(el('objectType').value);project.product=template.id;project.canvas={width:template.productionWidthMm,height:template.productionHeightMm};project.wrap=template.wrap.default;syncSelectedControlsFromLayer();updateAll(true)});el('layersList').addEventListener('click',e=>{const row=e.target.closest('.layer');if(!row)return;const id=row.dataset.layer,action=e.target.dataset.action;if(action==='visible'){const l=project.layers.find(x=>x.id===id);commitHistory();l.visible=e.target.checked;updateAll(true);return}if(action==='duplicate'){duplicateLayer(id);return}if(action==='delete'){deleteLayer(id);return}selectedLayerId=id;syncSelectedControlsFromLayer();updateAll(true)});el('deleteSelected').onclick=()=>deleteLayer(selectedLayerId);document.querySelectorAll('.viewBtn').forEach(b=>b.onclick=()=>{rotation=parseFloat(b.dataset.view);el('rotation').value=rotation;updateAll()});el('resetView').onclick=()=>{rotation=0;zoom=1;el('rotation').value=0;el('zoom').value=100;updateAll()};el('undoBtn').onclick=()=>performUndo();el('redoBtn').onclick=()=>performRedo();el('addCircle').onclick=()=>{const l=selectedLayer();commitHistory();const layer={id:'circle'+Date.now(),type:'circle',visible:true,cx:105,cy:45,r:18,stoneSize:l.stoneSize||2,gap:l.gap||.3,color:l.color||'gold'};project.layers.push(layer);selectedLayerId=layer.id;syncSelectedControlsFromLayer();updateAll(true)};el('addRect').onclick=()=>{const l=selectedLayer();commitHistory();const layer={id:'rect'+Date.now(),type:'rectangle',visible:true,x:65,y:30,w:80,h:30,stoneSize:l.stoneSize||2,gap:l.gap||.3,color:l.color||'gold'};project.layers.push(layer);selectedLayerId=layer.id;syncSelectedControlsFromLayer();updateAll(true)};el('importProject').onclick=()=>el('importProjectFile').click();
el('importProjectFile').addEventListener('change',async e=>{const file=e.target.files[0];e.target.value='';if(!file)return;try{const parsed=validateProject(JSON.parse(await file.text()));project=parsed;selectedLayerId=project.layers[0].id;
  // RS-1002: loading a project is a fresh start, not an undoable edit -- clear history entirely
  // (matches "history cleared on project load") and reset the dirty baseline to this load.
  history.clear();cleanProjectJson=JSON.stringify(project);
  syncSelectedControlsFromLayer();await updateAll(true);el('status').textContent=`Imported ${file.name}: ${project.layers.length} layer(s)`}catch(error){console.error('Project import failed',error);el('status').textContent=`Import failed: ${error.message}`}});
el('importSvg').onclick=()=>el('importSvgFile').click();
// RS-1001: parseSvgDocument() here only validates/measures the file (naturalWidthMm/heightMm,
// shape count, warnings) — it invents no stone positions, so this direct src/svg call does not
// violate "only the Geometry Engine generates stone positions". Actual stone generation for the
// new layer still runs through generate() -> generateSvgStonesLive() -> permanentEngine.generateSvgLayout().
el('importSvgFile').addEventListener('change',async e=>{const file=e.target.files[0];e.target.value='';if(!file)return;try{const svgSource=await file.text();const parsed=parseSvgDocument(svgSource);const maxW=project.canvas.width-20,maxH=project.canvas.height-20;let w=parsed.naturalWidthMm,h=parsed.naturalHeightMm;if(w>maxW||h>maxH){const s=Math.min(maxW/w,maxH/h);w*=s;h*=s}const x=(project.canvas.width-w)/2,y=(project.canvas.height-h)/2;const base=selectedLayer();const layer={id:'svg'+Date.now(),type:'svg',visible:true,svgSource,svgName:file.name,x,y,w,h,mode:'outline',stoneSize:base.stoneSize||2,gap:base.gap||.3,color:base.color||'gold'};commitHistory();project.layers.push(layer);selectedLayerId=layer.id;syncSelectedControlsFromLayer();await updateAll(true);const warningNote=parsed.warnings.length?` (${parsed.warnings.length} element(s) skipped, see console)`:'';if(parsed.warnings.length)console.warn('SVG import warnings for',file.name,parsed.warnings);el('status').textContent=`Imported ${file.name}: ${parsed.shapes.length} shape(s)${warningNote}`}catch(error){console.error('SVG import failed',error);el('status').textContent=`SVG import failed: ${error.message}`}});
el('exportProject').onclick=()=>{try{download('rhinestone-project.json','application/json',JSON.stringify(project,null,2));cleanProjectJson=JSON.stringify(project);updateHistoryUI()}catch(error){el('status').textContent=`Export failed: ${error.message}`}};
el('exportLayout').onclick=()=>{if(!layout){el('status').textContent='Export failed: layout is not ready yet.';return}try{download('rhinestone-generated-layout.json','application/json',JSON.stringify(layout,null,2))}catch(error){el('status').textContent=`Export failed: ${error.message}`}};
el('exportSVG').onclick=()=>{if(!layout){el('status').textContent='Export failed: layout is not ready yet.';return}try{download('rhinestone-layout.svg','image/svg+xml',stoneLayoutToSvg(layout,{widthMm:project.canvas.width,heightMm:project.canvas.height}))}catch(error){el('status').textContent=`Export failed: ${error.message}`}};
el('exportPNG').onclick=()=>{if(!layout){el('status').textContent='Export failed: layout is not ready yet.';return}try{exportCanvas('rhinestone-layout.png',layoutCanvas)}catch(error){el('status').textContent=`Export failed: ${error.message}`}};
el('exportCup').onclick=()=>{if(!layout){el('status').textContent='Export failed: layout is not ready yet.';return}try{exportCanvas('rhinestone-cup-preview.png',cupCanvas)}catch(error){el('status').textContent=`Export failed: ${error.message}`}};
let cupDrag=false,lastX=0;cupCanvas.addEventListener('pointerdown',e=>{cupDrag=true;lastX=e.clientX;cupCanvas.setPointerCapture(e.pointerId)});cupCanvas.addEventListener('pointermove',e=>{if(!cupDrag)return;rotation+=(e.clientX-lastX)*CUP_ROTATION_SENSITIVITY;lastX=e.clientX;rotation=Math.max(-180,Math.min(180,rotation));el('rotation').value=rotation;updateAll()});window.addEventListener('pointerup',()=>cupDrag=false);window.addEventListener('resize',()=>updateAll(true));syncSelectedControlsFromLayer();updateAll(true);
