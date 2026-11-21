import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { feature, neighbors } from 'topojson-client';
import { geoArea, geoCentroid, geoContains, geoConicConformal } from 'd3-geo';

const work = process.argv[2];
const dest = fileURLToPath(new URL('../../src/scenarios/1939/', import.meta.url));
const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const topo = read(path.join(work, 'world.topo.json'));
const inputs = read(path.join(work, 'inputs.json'));
const units = read(path.join(dest, 'gazetteer.json'));
const geometries = Object.values(topo.objects)[0];
topo.objects = { units: geometries };
const fc = feature(topo, geometries);
const entries = Object.values(units);
const reference = inputs.referencePalette;
const names = {ROC:'Chinese Republic',QING:'Chinese Empire',JPN:'Japan',GBR:'United Kingdom',USA:'United States',DEU:'Germany',FRA:'France',RUS:'Russia',
  ITA:'Italy',OTT:'Ottoman Empire',SAU:'Saudi Arabia',PAL:'International Palestine',IRN:'Persia',ETH:'Ethiopia',LBR:'Liberia',PRT:'Portugal',
  BEL:'Belgium',ESP:'Spain',NLD:'Netherlands',HUN:'Austria-Hungary',BALTD:'Baltic Duchy',LTU:'Lithuania',POL:'Poland',UKR:'Ukraine',BLR:'Belarus',
  NOR:'Norway',DNK:'Denmark',SWE:'Sweden',FIN:'Finland',ISL:'Iceland',GRC:'Greece',BGR:'Bulgaria',ROU:'Romania',MNE:'Montenegro',
  SRB:'Serbia',ALB:'Albania',CHE:'Switzerland',THA:'Thailand',VNM:'Vietnam',PHL:'Philippines',AFG:'Afghanistan',MEX:'Mexico',BRA:'Brazil',
  GTM:'Guatemala',HND:'Honduras',SLV:'El Salvador',NIC:'Nicaragua',CRI:'Costa Rica',PAN:'Panama',COL:'Colombia',VEN:'Venezuela',
  HTI:'Haiti',DOM:'Dominican Republic',VAN:'Anglo-French condominium'};
const fixed=Object.fromEntries(Object.entries(names).map(([id,name])=>[id,reference[name]]));
Object.assign(fixed,{HAW:'#a4afb2',KANT:'#847284',QUE:'#877b9a',ATA:'#82898d',TROM:'#676b74',HRV:'#af957e',BIH:'#877d90'});
const palette=['#8c796a','#8c7892','#638987','#a39665','#647a9a','#a47872','#7d8e6b','#a68a62','#788b9a'];
const adjacent = Object.fromEntries(entries.map(u=>[u.id,new Set()]));
const largest = {};
const area = {};
function ancestry(id) {
  const result = [];
  while (id) { result.push(id); id=units[id].parent; }
  return result;
}
const groups = new Map(inputs.groups.map(g=>[g.id,g]));
const byUnit = Object.groupBy(inputs.groups,g=>g.unit);
let componentCount = 0;
for (const [i, g] of geometries.geometries.entries()) {
  const id = g.properties.unit;
  const shape = fc.features[i].geometry;
  const pieces = shape.type === 'Polygon' ? [shape.coordinates] : shape.coordinates;
  // Component metadata follows the geometry's polygon order, including polar
  // and antimeridian pieces. The common owner is stored once on the feature.
  g.properties.manager = units[id].manager;
  g.properties.groups = pieces.map((ring) => {
    const polygon = {type:'Polygon',coordinates:ring};
    const a = geoArea(polygon);
    if (!(a>=0 && a<2*Math.PI)) throw Error(`Winding: ${id} (${a})`);
    for (const key of ancestry(id)) {
      area[key]=(area[key]??0)+a;
      if (!largest[key] || largest[key].a<a) largest[key]={a,polygon};
    }
    const [x,y] = geoCentroid(polygon);
    let group, best = Infinity;
    for (const entry of byUnit[id]??[]) {
      const dx = Math.abs(x-entry.at[0]);
      const d = Math.hypot(Math.min(dx,360-dx)*Math.cos(y*Math.PI/180),y-entry.at[1]);
      if (d<entry.radius && d<best) {best=d;group=entry.id;}
    }
    componentCount++;
    if (!group) {
      group = id+'-land';
      if (!groups.has(group)) groups.set(group,{id:group,unit:id,name:units[id].name+'陆地及附岛'});
    }
    return group;
  });
}
const graph=neighbors(geometries.geometries);
for (const [i,row] of graph.entries()) for (const j of row) {
  const a=units[geometries.geometries[i].properties.unit].sovereign, b=units[geometries.geometries[j].properties.unit].sovereign;
  if (a!==b) adjacent[a].add(b);
}
const rgb = c=>[1,3,5].map(k=>parseInt(c.slice(k,k+2),16));
const distance=(a,b)=>Math.hypot(...rgb(a).map((v,i)=>v-rgb(b)[i]));
const hex = channels=>'#'+channels.map(x=>Math.round(x).toString(16).padStart(2,'0')).join('');
const colors={...fixed};
for (const u of entries.filter(x=>x.sovereign===x.id&&!colors[x.id]).sort((a,b)=>adjacent[b.id].size-adjacent[a.id].size || a.id.localeCompare(b.id))) {
  const used=[...adjacent[u.id]].map(id=>colors[id]).filter(Boolean);
  const offset=[...u.id].reduce((s,c)=>s+c.charCodeAt(0),0)%palette.length;
  const order=palette.slice(offset).concat(palette.slice(0,offset));
  colors[u.id]=used.length?order.sort((a,b)=>Math.min(...used.map(c=>distance(b,c)))-Math.min(...used.map(c=>distance(a,c))))[0]:order[0];
}
const labels=[];
const anchor={ROC:[111,30],QING:[126,45.9],RUS:[80,58],USA:[-105,38.8],QUE:[-77,53],NWD:[-110,59],GBR:[-3,54.5],DNK:[9.4,56.2],DEU:[12.8,51.1],FRA:[2.0,46.6],
  HAW:[-157.98,21.49],BAA:[-84,34],OTT:[36,38.6],SAU:[43.4,24.3],PAL:[35.05,31.65],BALTD:[25.1,57.8],
  EGY:[29,26.8],LIB:[17.8,27.5],ALG:[3.0,28.2],TIB:[87.8,32.0],XJ:[84,40.8],IM:[113.1,42],OM:[103.6,47.3],IND:[79,23],AUS:[134,-25],ATA:[12,-80]};
for (const u of entries) {
  const root=colors[u.sovereign];
  u.color=root;
  if (['GEO','ARM','AZE','TURK','STEP','SEMI','CASP','KHIV','BUKH','PAM','BOH'].includes(u.id))
    u.color=hex(rgb(root).map(x=>x+(220-x)*.09));
  const specialColors={BIN:fixed.ROC,MNLPORT:'#80989e',INTRA:'#9a829b',SHINT:'#829598',SHFR:fixed.FRA,KWAN:fixed.FRA,KIAO:fixed.DEU,CYP:fixed.GBR,
    FMOR:reference.Morocco,AUS:reference.Australia,NZL:reference.Australia};
  if (specialColors[u.id]) u.color=specialColors[u.id];
  u.basis=inputs.bases[u.id]??[];
  const p=largest[u.id]?.polygon;
  let point=anchor[u.id]??(p?geoCentroid(p):u.seat);
  if (p && !anchor[u.id] && !geoContains(p,point)) point=u.seat&&geoContains(p,u.seat)?u.seat:p.coordinates[0][0];
  const a=area[u.id]??0;
  const parent=!!u.parent;
  const city=['租界','国际自由港','非军事区','特别港区'].includes(u.status);
  const headline=['HAW','BAA','NWD','IND','AUS','GRL','OM','JPN','UKR','DEU','VNM','PHL','NZL'].includes(u.id);
  const zoom=headline?1:city?120:parent?(a>.16?1.2:a>.028?2:a>.004?3:a>.0004?5:9):(a>.019?1:a>.003?1.6:a>.0002?3:6);
  const short={GBR:'英国',FRA:'法国',RUS:'俄罗斯联邦',HAW:'夏威夷托管领（美国管理）',NWD:'美属西北开发区',AUS:'澳大利亚自治领'};
  if (point) labels.push({id:'name-'+u.id,unit:u.id,kind:'name',at:point,text:short[u.id]??u.name,
    zoom,priority:headline?20:parent?55:Math.min(40,6+1/Math.sqrt(a+.001))});
  if (u.seat && u.capital && !city) labels.push({id:'capital-'+u.id,unit:u.id,kind:'capital',at:u.seat,text:u.capital,zoom:Math.max(3.2,zoom*1.35),priority:parent?71:47});
}
for (const g of inputs.groups) labels.push({id:'island-'+g.id,unit:g.unit,kind:'island',at:g.at,text:g.name,zoom:g.id==='midway'?2.3:4.5,priority:65});
for (const [id,unit,text,x,y,zoom,kind] of [
  ['keelung','TAI','基隆 · 紫竹学园舰母港',121.745,25.147,5,'site'],
  ['shanhai','ROC','山海关',119.78,40.01,6,'site'],['xifeng','ROC','喜峰口',118.30,40.43,12,'site'],
  ['gubei','ROC','古北口',117.16,40.68,12,'site'],['dushi','ROC','独石口',115.81,41.30,12,'site'],
  ['zhangjiakou','ROC','张家口',114.88,40.81,10,'site'],['indiana','USA','印第安纳通道',-86.25,40.05,6,'site'],
  ['portsaid','EGY','塞得港',32.29,31.26,10,'site'],['suez','EGY','苏伊士',32.55,29.97,10,'site'],
  ['jerusalem','PAL','耶路撒冷圣城',35.23,31.78,14,'site'],['mecca','SAU','麦加圣地',39.83,21.42,12,'site'],
  ['medina','SAU','麦地那',39.61,24.47,10,'site'],['vilnius','LTU','维尔纽斯',25.28,54.69,6,'site'],
  ['memel','DEU','梅梅尔',21.13,55.70,6,'site'],['danzig','DANZ','但泽 · 波兰铁路过境权',18.65,54.35,9,'site'],
  ['crimea','CRIM','俄联邦实控 · 乌克兰主张',34.2,45.25,6,'claim'],['viborg','FIN','维堡',28.75,60.71,6,'site'],
  ['strasbourg','DEU','阿尔萨斯 · 斯特拉斯堡',7.75,48.58,9,'site'],['metz','DEU','洛林 · 梅斯',6.18,49.12,9,'site'],
  ['ljubljana','DEU','斯洛文尼亚 · 卢布尔雅那',14.51,46.06,9,'site'],['trieste','DEU','的里雅斯特',13.77,45.65,10,'site'],
  ['pula','DEU','伊斯特拉 · 普拉',13.85,44.87,10,'site'],['rijeka','HRV','里耶卡',14.44,45.34,10,'site'],
  ['amman','OTT','外约旦 · 安曼',35.93,31.95,10,'site'],['mosul','OTT','摩苏尔',43.13,36.34,9,'site'],
  ['warkan','AFG','瓦罕走廊',73.07,37.04,9,'site'],['aksai','TAR','阿克赛钦',79.6,35.2,9,'site'],
  ['oecusse','TIM','欧库西飞地',124.32,-9.22,10,'site'],['gwadar','OMAN','瓜达尔',62.32,25.19,10,'site'],
  ['peter','ATA','彼得一世岛（挪威主张）',-90.58,-68.77,1.4,'claim'],
  ['british-sector','ATA','英国主张',-49,-77,1.4,'claim'],['ross','ATA','新西兰主张',178,-80,1.4,'claim'],
  ['adelie','ATA','法国主张',139,-70,1.4,'claim'],['australian-sector','ATA','澳大利亚主张',89,-75,1.4,'claim']
]) labels.push({id,unit,text,at:[x,y],zoom,kind,priority:kind==='claim'?38:32});
const claims = {type:'MultiLineString',coordinates:[-80,-20,45,136,142,160,-150].map(x=>[[x,-89.999],[x,-60]])};
const managers={PALCOM:'国际托管当局（受托方未指定）',NWCO:'美属西北特许开发公司',PORTBOARD:'马尼拉国际港务委员会',SPORT:'国际战车道联盟',SMC:'上海公共租界工部局',
 COLONIAL:'英国殖民地部',ANGLOUS:'英美联合驻管机构',ANGLOFR:'英法共管委员会',ANGLOEG:'英埃共管当局',TANGCOM:'丹吉尔国际管理委员会',UNALLOC:'无常设主权管理者',BNBC:'英国北婆罗洲特许公司'};
for (const u of entries) {
  if (!(u.manager in units || u.manager in managers) || !u.color) throw Error('Incomplete record '+u.id);
}
fs.writeFileSync(path.join(dest,'gazetteer.json'),JSON.stringify(units,null,1)+'\n');
const nameOf=id=>units[id]?.name??managers[id]??id??'';
const table=[['稳定ID','政区名称','身份','首府','上级ID','宗主ID','主权ID','实际管理者ID','实际管理者','主张方','中立保障','岛群','边界依据','设定说明']];
for(const u of entries) table.push([u.id,u.name,u.status,u.capital,u.parent,u.suzerain,u.coSovereigns?.join('、')??u.sovereign,u.manager,nameOf(u.manager),
  u.claims?.map(nameOf).join('、'),u.guarantors?.map(nameOf).join('、'),(byUnit[u.id]??[]).map(g=>g.name).join('、'),u.basis.join('、')||'由下级政区组成',u.note]);
const csv=table.map(row=>row.map(v=>'"'+String(v??'').replaceAll('"','""')+'"').join(',')).join('\r\n');
fs.writeFileSync(new URL('./政区归属表.csv',import.meta.url),'\ufeff'+csv+'\r\n');
// The mainland admin-1 data ends at the Lake Michigan coastline. The maritime
// boundary joins the Indiana shore to the Menominee estuary via Green Bay.
const michigan={type:'LineString',coordinates:[[-86.824,41.76],[-87.05,41.85],[-87.19,42.15],[-87.11,42.62],[-87.12,43.10],[-87.14,43.55],[-87.01,44.12],[-86.87,44.67],[-86.68,45.09],[-86.61,45.31],[-86.77,45.45],[-86.98,45.55],[-87.16,45.46],[-87.30,45.32],[-87.45,45.18],[-87.59,45.10]]};
const cityRivers={type:'MultiLineString',coordinates:[
  [[120.9515,14.5977],[120.9597,14.5973],[120.9646,14.5971],[120.9691,14.5957],[120.9721,14.5954],[120.9748,14.5964],[120.9772,14.5963],[120.9803,14.5955],[120.9826,14.5940],[120.9850,14.5939],[120.9895,14.5952],[120.9941,14.5945],[121.0014,14.5970]],
  [[121.487,31.207],[121.500,31.215],[121.498,31.226],[121.490,31.238],[121.490,31.246],[121.503,31.249],[121.516,31.245],[121.527,31.251],[121.543,31.267],[121.560,31.284]],
  [[117.178,39.153],[117.189,39.143],[117.194,39.137],[117.202,39.132],[117.207,39.125],[117.216,39.122],[117.226,39.116],[117.235,39.111],[117.244,39.104],[117.254,39.094]]
]};
const geography=read(path.join(work,'geography.json'));
const namesToUnits=Object.fromEntries(Object.entries(names).map(([id,name])=>[name,id]));
Object.assign(namesToUnits,{'United-Kingdom-of-Great-Britain-and-Ireland':'GBR','Greater-German-Empire':'DEU','Russian-Empire':'RUS','Kingdom-of-Italy':'ITA',
  'Austro-Hungarian-Empire':'HUN','Ottoman-Empire':'OTT','United-Baltic-Duchy':'BALTD','Duchy-of-Lithuania':'LTU','Kingdom-of-Poland':'POL',
  'Ukrainian-Republic':'UKR','International-Palestine':'PAL','Saudi-Arabia':'SAU','Morocco':'FMOR','Egypt':'EGY','Libya':'LIB','Algeria':'ALG',
  'Tunisia':'TUN','Malta':'MLT','Spanish-Morocco':'SMOR','Spanish-Sahara':'SAG'});
const lamp=geoConicConformal().parallels([40,62]).rotate([-10,0]).center([0,52]).scale(6371008.8).translate([0,0]);
const refPoint=(x,y)=>lamp.invert([-2295476.713+(x-7.2)*5723558.961/569.16,-2593638.532+(y-7.2)*5036391.990/500.227861]);
const europeanNames={};
for(const source of read(path.join(work,'reference-labels.json'))) {
  const id=namesToUnits[source.country];
  if(!id || !units[id]) continue;
  const text=({HUN:'聖斯蒂芬王國',ESP:'西班牙',ALG:'法屬阿爾及利亞'})[id]??source.text;
  europeanNames[id]={text,at:refPoint(source.x,source.y),size:source.size,angle:source.angle,turn:source.turn,tracking:source.tracking,
    ...(source.leader.length?{leader:source.leader.map(([x,y])=>refPoint(x,y))}:{})};
}
const result={ref:{id:'peace-senshado-1939',revision:2},topo,labels:labels.sort((a,b)=>a.priority-b.priority||a.id.localeCompare(b.id)),claims,geography,europeanNames,cityRivers,waterlines:[...inputs.waterlines,michigan],groups:[...groups.values()],managers};
fs.writeFileSync(path.join(dest,'atlas.json.gz'),gzipSync(JSON.stringify(result),{level:9}));
console.log(`${entries.length} units, ${componentCount} land components, ${labels.length} labels, ${topo.arcs.length} shared arcs`);
