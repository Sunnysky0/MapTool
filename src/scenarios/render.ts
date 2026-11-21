import { geoPath } from 'd3-geo';
import type { AtlasLayer, MapConfig, ScenarioData, HistoricalLabel, ReferenceLabel } from '../types';
import { ATLAS_STYLES } from '../lib/presets';
import { buildProjection } from '../lib/projections';
import { territoryColor } from './colors';

const W = 1920;
const FAMILY = '"Microsoft YaHei","Noto Sans CJK SC",sans-serif';
const LETTERING = '"FZBeiWeiKaiShu-S19","方正北魏楷书_GBK","KaiTi","DFKai-SB","Noto Serif CJK SC",serif';
const escape = (text:string) => text.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]!));
interface Face { unit:string; d:string }
interface Projected {
  faces: Face[];
  sovereignBorders:string; adminBorders:string; coastline:string; claims:string; cityRivers:string;
  rivers:string[]; lakes:string[]; rails:string;
  towns: {x:number;y:number;rank:number;name:string}[];
  islandLocators:{x:number;y:number;owner:string}[];
  points: { label:HistoricalLabel; x:number; y:number; reference?:ReferenceLabel; leader?:string }[];
}
let cached: {atlas:ScenarioData; key:string; result:Projected} | undefined;
function project(atlas:ScenarioData, config:MapConfig): Projected {
  const h=W*config.height/config.width;
  const european=config.atlasSheet==='europe' && config.view.zoom>=2.4;
  const key=JSON.stringify([config.view,h,config.atlasSheet]);
  if (cached?.atlas===atlas && cached.key===key) return cached.result;
  const inset=config.atlasSheet==='europe'?W*7.2/583.56:config.atlasSheet==='africa'?W*.008:0;
  const proj=buildProjection(config.view,W,h).clipExtent([[inset,inset],[W-inset,h-inset]]);
  const path=geoPath(proj);
  const faces=atlas.faces.map(f=>({unit:f.properties.unit,d:path(f)??''})).filter(f=>f.d);
  const points:Projected['points']=[];
  // The projection stream uses exactly the same hemisphere, antimeridian and
  // rectangular clipping rules for point symbols as for the polygon paths.
  let projected:[number,number]|undefined;
  const sink=proj.stream({point(x,y){projected=[x,y];}, lineStart(){},lineEnd(){},polygonStart(){},polygonEnd(){},sphere(){}});
  const projectPoint=(at:[number,number])=>{
    projected=undefined;sink.point(...at);return projected as [number,number]|undefined;
  };
  for (const label of atlas.labels) {
    const reference=european && label.kind==='name'?atlas.europeanNames?.[label.unit]:undefined;
    const capitalSymbol=!!atlas.geography && label.kind==='capital' && config.view.zoom>=1.9;
    if (!reference && !capitalSymbol && label.zoom>config.view.zoom) continue;
    const at=projectPoint(reference?.at??label.at);
    if(at) points.push({label,x:at[0],y:at[1],reference,
      leader:reference?.leader?path({type:'LineString',coordinates:reference.leader})??undefined:undefined});
  }
  const towns:Projected['towns']=[];
  for(const [lon,lat,rank,name] of atlas.geography?.towns??[]) {
    const point=projectPoint([lon,lat]);if(point) towns.push({x:point[0],y:point[1],rank,name});
  }
  const tiers=config.view.zoom<1.9?1:config.view.zoom<2.4?2:3;
  const islandLocators:Projected['islandLocators']=[];
  if(config.atlasSheet==='africa' && config.view.zoom<12) for(const [lon,lat,owner] of atlas.geography?.africanIslands??[]) {
    const at=projectPoint([lon,lat]);if(at)islandLocators.push({x:at[0],y:at[1],owner});
  }
  const result={faces,sovereignBorders:path(atlas.sovereignBorders)??'',adminBorders:path(atlas.adminBorders)??'',
    coastline:atlas.coastline?path(atlas.coastline)??'':'',claims:path(atlas.claims)??'',
    cityRivers:config.view.zoom>=80?path(atlas.cityRivers)??'':'',points,towns,islandLocators,
    rivers:atlas.geography?.rivers.slice(0,tiers).map(g=>path(g)??'')??[],lakes:atlas.geography?.lakes.slice(0,tiers).map(g=>path(g)??'')??[],
    rails:atlas.geography&&config.view.zoom>=2.4?path(atlas.geography.rails)??'':''};
  cached={atlas,key,result}; return result;
}

type Mark = {type:'fill';d:string;color:string;id?:string;hatch?:boolean;alpha?:number}
  | {type:'line';d:string;color:string;width:number;dash:number[];alpha?:number}
  | {type:'symbol';x:number;y:number;r:number;color:string;outline:string;star?:boolean}
  | {type:'text';x:number;y:number;size:number;text:string;color:string;leader?:[number,number];leaderPath?:string;id:string;reference?:ReferenceLabel};

function star(x:number,y:number,r:number) {
  const points=Array.from({length:10},(_,i)=>{
    const a=(i*.2-.5)*Math.PI, distance=i%2===0?r:r*.43;
    return [x+Math.cos(a)*distance,y+Math.sin(a)*distance].join(',');
  });
  return 'M'+points.join('L')+'Z';
}

type TextMark=Extract<Mark,{type:'text'}>;
function glyphs(m:TextMark) {
  const ref=m.reference!;
  const chars=Array.from(m.text), advance=m.size*(1+ref.tracking), length=Math.max(advance,(chars.length-1)*advance);
  const bend=ref.turn*Math.PI/180/length, direction=ref.angle*Math.PI/180;
  return chars.map((letter,i)=>{
    const dist=(i-(chars.length-1)/2)*advance;
    const dx=bend?Math.sin(dist*bend)/bend:dist,dy=bend?(1-Math.cos(dist*bend))/bend:0;
    return {letter,x:m.x+dx*Math.cos(direction)-dy*Math.sin(direction),y:m.y+dx*Math.sin(direction)+dy*Math.cos(direction),
      angle:ref.angle+dist*bend*180/Math.PI};
  });
}

function labelMarks(config:MapConfig,atlas:ScenarioData,points:Projected['points']): Mark[] {
  const h=W*config.height/config.width, style=config.layers.historicalLabels;
  const placed: {x:number;y:number;w:number;h:number}[]=[];
  const symbols:Mark[]=[], words:Mark[]=[];
  const modern=config.scenario?.revision===2;
  const ordered=[...points].sort((a,b)=>Number(!!config.labelEdits[b.label.id])-Number(!!config.labelEdits[a.label.id])||
    Number(!!b.reference)-Number(!!a.reference) || (b.reference?.size??0)-(a.reference?.size??0));
  for (const {label,x,y,reference,leader:refLeader} of ordered) {
    const edit=config.labelEdits[label.id]??{};
    if (edit.hidden) continue;
    const unit=atlas.units[label.unit], text=edit.text??reference?.text??label.text;
    if(modern && label.kind==='capital' && (!config.layers.cities.labels || label.zoom>config.view.zoom)) continue;
    if(modern && config.atlasSheet==='europe' && !reference && !config.labelEdits[label.id] && config.view.zoom<6 &&
      (label.kind!=='name' || unit.parent && !['BOH','GEO','AZE','ARM'].includes(unit.id))) continue;
    const micro=!reference && label.kind==='name' && (label.zoom>=6 || unit.id==='HAW');
    const pin=label.kind!=='name'||micro;
    const size=reference?reference.size*(W/583.56)*(style.labelSize??13)/13:
      (style.labelSize??13)*(label.kind==='name'&&!unit.parent?1.08:label.kind==='capital'?.82:.9);
    if (pin && (!modern || label.kind!=='capital')) symbols.push({type:'symbol',x,y,r:label.kind==='capital'?2.25:micro||label.kind==='island'?3:2.7,
      color:label.kind==='capital'?style.color:territoryColor(unit.id,config,atlas.units),outline:style.color});
    if (!text) continue;
    const baseWidth=Array.from(text).reduce((s,c)=>s+(c.charCodeAt(0)>255?1:.64),0)*size;
    const angle=(reference?.angle??0)*Math.PI/180;
    const width=baseWidth*(1+(reference?.tracking??0));
    const w=Math.abs(Math.cos(angle))*width+Math.abs(Math.sin(angle))*size;
    const th=Math.abs(Math.sin(angle))*width+Math.abs(Math.cos(angle))*size;
    const manual=edit.dx!==undefined||edit.dy!==undefined;
    const offsets=manual?[[edit.dx??0,edit.dy??0]]:pin?[[w/2+8,0],[-w/2-8,0],[0,-size-5],[0,size+5]]:
      [[0,0],[0,-size-3],[0,size+3]];
    for (const [dx,dy] of offsets) {
      const tx=x+dx,ty=y+dy, box={x:tx-w/2-2,y:ty-th*.6-1,w:w+4,h:th*1.2+2};
      if (box.x<0 || box.y<0 || box.x+box.w>W || box.y+box.h>h) continue;
      if (!manual && !reference && placed.some(b=>box.x<b.x+b.w && box.x+box.w>b.x && box.y<b.y+b.h && box.y+box.h>b.y)) continue;
      placed.push(box);
      words.push({type:'text',x:tx,y:ty,size,text,color:style.color,id:label.id,reference,
        leaderPath:manual?undefined:refLeader,leader:pin||manual?[x,y]:undefined});
      break;
    }
  }
  return symbols.concat(words);
}

function marks(layer:AtlasLayer,config:MapConfig,atlas:ScenarioData): Mark[] {
  const geo=project(atlas,config), style=config.layers[layer];
  const theme=ATLAS_STYLES[config.atlasTheme??'reference'];
  const line=(d:string,color:string,width:number,alpha=1,dash:number[]=[]):Mark=>({type:'line',d,color,width,dash,alpha});
  if(layer==='lakes') return geo.lakes.flatMap(d=>[
    ...(style.fill?[{type:'fill' as const,d,color:style.fillColor,alpha:style.fillOpacity}]:[]),line(d,style.color,style.width,.74)]);
  if(layer==='rivers') {
    const widths=config.atlasSheet==='europe'?[2.95,1.98,1.25]:config.atlasSheet==='africa'?[1.74,1.15,.72]:[1.55,1.02,.65];
    return geo.rivers.map((d,i)=>line(d,i===0&&style.color===theme.river&&config.atlasTheme!=='paper'?'#557793':style.color,
      style.width*widths[i]*(config.view.zoom<1.9?.63:1)));
  }
  if(layer==='railways') return geo.rails?[line(geo.rails,style.color,style.width)]:[];
  if(layer==='cities') {
    const markers:Mark[]=[],seen=new Set<string>();
    const r=(style.dotSize??2.1)*(config.atlasSheet==='europe'?1.55:config.atlasSheet==='africa'?1.12:1);
    const maxRank=Math.min(style.minRank??5,config.view.zoom<1.9?1:8);
    const occupied:{x:number;y:number}[]=[];
    for(const {label,x,y} of geo.points) {
      const unit=atlas.units[label.unit];
      if(label.kind!=='capital' || (unit.parent && !['BOH','IND','BAA','GEO','ARM','AZE'].includes(unit.id)) || config.view.zoom<1.9) continue;
      const key=Math.round(x)+','+Math.round(y); if(seen.has(key)) continue;seen.add(key);
      const useStar=config.atlasSheet!=='africa';
      markers.push({type:'symbol',x,y,r:useStar?r*2.45:r*1.1,star:useStar,color:useStar?(config.atlasTheme==='paper'?theme.ink:'#ffd9f4'):style.color,outline:useStar?theme.ocean:'none'});
      occupied.push({x,y});
    }
    for(const town of geo.towns) {
      if(town.rank>maxRank || occupied.some(p=>Math.hypot(p.x-town.x,p.y-town.y)<8))continue;
      markers.push({type:'symbol',x:town.x,y:town.y,r,color:style.color,outline:'none'});
    }
    return markers;
  }
  if (layer==='historicalLabels') return labelMarks(config,atlas,geo.points);
  if (layer==='territories') {
    const fills:Mark[]=geo.faces.map(({unit:id,d})=>({type:'fill',id,d,color:territoryColor(id,config,atlas.units),hatch:!!atlas.units[id].claims?.length}));
    for(const {x,y,owner} of geo.islandLocators) {
      fills.push({type:'symbol',x,y,r:3.7,color:'none',outline:config.layers.sovereignBorders.color},
        {type:'symbol',x,y,r:2.1,color:territoryColor(owner,config,atlas.units),outline:theme.ink});
    }
    if (geo.claims) fills.push({type:'line',d:geo.claims,color:'#80888e',width:.6,dash:[3,4]});
    if (geo.cityRivers) fills.push({type:'line',d:geo.cityRivers,color:config.scenario?.revision===2?theme.river:'#aac6d3',width:Math.max(.75,config.view.zoom*.0014),dash:[]});
    return fills;
  }
  const width=style.width, dash=style.dash==='dashed'?[4*width,3*width]:style.dash==='dotted'?[.1*width,3*width]:[];
  if(config.scenario?.revision===2) {
    const thin=width*(config.view.zoom<1.9?.56:1);
    const strokes=(d:string,coast:boolean):Mark[]=>[
      ...(config.atlasTheme!=='paper'?[line(d,theme.glow,thin*(coast?5.2:3.6),coast?.10:.14,dash),
        line(d,theme.glow,thin*(coast?2.8:1.8),coast?.22:.28,dash)]:[]),
      line(d,style.color,thin,1,dash)];
    return layer==='sovereignBorders'?[...strokes(geo.coastline,true),...strokes(geo.sovereignBorders,false)]:strokes(geo.adminBorders,false);
  }
  return [{type:'line',d:geo[layer],color:style.color,width,dash}];
}

let tile: HTMLCanvasElement | undefined;
function hatch(ctx:CanvasRenderingContext2D) {
  if (!tile) {
    tile=document.createElement('canvas');tile.width=tile.height=24;
    const g=tile.getContext('2d')!;
    g.strokeStyle='#695747';g.lineWidth=2;
    g.beginPath();g.moveTo(-1,1);g.lineTo(1,-1);g.moveTo(0,24);g.lineTo(24,0);g.moveTo(23,25);g.lineTo(25,23);g.stroke();
  }
  const pattern=ctx.createPattern(tile,'repeat');
  pattern?.setTransform(new DOMMatrix().scale(.25));return pattern;
}
function leader(mark: Extract<Mark,{type:'text'}>) {
  if(mark.leaderPath) return mark.leaderPath;
  if (!mark.leader) return;
  const [x,y]=mark.leader, dx=mark.x-x,dy=mark.y-y;
  if (Math.hypot(dx,dy)<5) return;
  const halfWidth=Array.from(mark.text).reduce((n,c)=>n+(c.charCodeAt(0)>255?1:.64),0)*mark.size/2;
  const edge=Math.min(Math.abs(halfWidth/(dx||.001)),Math.abs(mark.size*.55/(dy||.001)),1);
  return `M${x},${y}L${mark.x-dx*edge},${mark.y-dy*edge}`;
}
export function paintScenario(ctx:CanvasRenderingContext2D,layer:AtlasLayer,config:MapConfig,atlas:ScenarioData,width:number) {
  ctx.save();ctx.scale(width/W,width/W);
  const modern=config.scenario?.revision===2;
  const halo=modern?ATLAS_STYLES[config.atlasTheme??'reference'].halo:'#f1f0e9';
  for (const m of marks(layer,config,atlas)) {
    ctx.globalAlpha=config.layers[layer].opacity*('alpha' in m?m.alpha??1:1);
    if (m.type==='fill') {
      const p=new Path2D(m.d);ctx.fillStyle=m.color;ctx.fill(p);
      if (m.hatch) {const pattern=hatch(ctx);if (pattern) {ctx.fillStyle=pattern;ctx.fill(p);}}
    } else if (m.type==='line') {
      if (!m.width) continue;
      ctx.strokeStyle=m.color;ctx.lineWidth=m.width;ctx.setLineDash(m.dash);ctx.stroke(new Path2D(m.d));
    } else if (m.type==='symbol') {
      ctx.fillStyle=m.color;ctx.lineWidth=m.star?1.05:.7;
      const p=m.star?new Path2D(star(m.x,m.y,m.r)):new Path2D();
      if(!m.star)p.arc(m.x,m.y,m.r,0,2*Math.PI);
      if(m.color!=='none')ctx.fill(p);
      if(m.outline!=='none'){ctx.strokeStyle=m.outline;ctx.stroke(p);}
    } else {
      const d=leader(m);
      if(d){ctx.strokeStyle=m.color;ctx.lineWidth=.65;ctx.stroke(new Path2D(d));}
      ctx.font=`500 ${m.size}px ${modern?LETTERING:FAMILY}`;ctx.textAlign='center';ctx.textBaseline='middle';
      ctx.strokeStyle=halo;ctx.lineWidth=modern?Math.max(1,m.size*.085):2;ctx.fillStyle=m.color;
      if(m.reference) {
        for(const g of glyphs(m)){ctx.save();ctx.translate(g.x,g.y);ctx.rotate(g.angle*Math.PI/180);ctx.strokeText(g.letter,0,0);ctx.fillText(g.letter,0,0);ctx.restore();}
      } else {ctx.strokeText(m.text,m.x,m.y);ctx.fillText(m.text,m.x,m.y);}
    }
  }
  ctx.restore();
}
export function scenarioSVG(layer:AtlasLayer,config:MapConfig,atlas:ScenarioData,width:number) {
  const out=[`<g id="${layer}" transform="scale(${width/W})">`];
  const paths=new Map<string,string>(), modern=config.scenario?.revision===2;
  const halo=modern?ATLAS_STYLES[config.atlasTheme??'reference'].halo:'#f1f0e9';
  if (layer==='territories') out.push('<defs><pattern id="claim-hatch" width="6" height="6" patternUnits="userSpaceOnUse"><path d="M-1 1L1 -1M0 6L6 0M5 7L7 5" stroke="#695747" stroke-width=".5"/></pattern></defs>');
  for (const m of marks(layer,config,atlas)) {
    const opacity=config.layers[layer].opacity*('alpha' in m?m.alpha??1:1);
    if(m.type==='fill'){
      out.push(`<path${m.id?` data-unit="${m.id}"`:''} fill="${m.color}" opacity="${opacity}" d="${m.d}"/>`);
      if(m.hatch) out.push(`<path fill="url(#claim-hatch)" d="${m.d}"/>`);
    } else if(m.type==='line') {
      if(!m.d || !m.width) continue;
      let id=paths.get(m.d);
      if(!id) {id=layer+'-path-'+paths.size;paths.set(m.d,id);out.push(`<defs><path id="${id}" d="${m.d}"/></defs>`);}
      out.push(`<use href="#${id}" fill="none" stroke="${m.color}" opacity="${opacity}" stroke-width="${m.width}" stroke-dasharray="${m.dash.join(' ')||'none'}"/>`);
    }
    else if(m.type==='symbol') {
      const attrs=`fill="${m.color}" stroke="${m.outline}" opacity="${opacity}" stroke-width="${m.star?1.05:.7}"`;
      out.push(m.star?`<path d="${star(m.x,m.y,m.r)}" ${attrs}/>`:`<circle cx="${m.x}" cy="${m.y}" r="${m.r}" ${attrs}/>`);
    }
    else {
      const d=leader(m);
      if(d) out.push(`<path d="${d}" stroke="${m.color}" stroke-width=".65"/>`);
      const attrs=`data-label="${m.id}" font-family="${escape(modern?LETTERING:FAMILY)}" font-size="${m.size}" font-weight="500" text-anchor="middle" dominant-baseline="central" fill="${m.color}" stroke="${halo}" opacity="${opacity}" stroke-width="${modern?Math.max(1,m.size*.085):2}" paint-order="stroke"`;
      if(m.reference) out.push(`<g ${attrs} aria-label="${escape(m.text)}">${glyphs(m).map(g=>`<text transform="translate(${g.x} ${g.y}) rotate(${g.angle})" paint-order="stroke">${escape(g.letter)}</text>`).join('')}</g>`);
      else out.push(`<text ${attrs} x="${m.x}" y="${m.y}">${escape(m.text)}</text>`);
    }
  }
  out.push('</g>');return out.join('\n');
}
