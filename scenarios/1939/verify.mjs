import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { feature } from 'topojson-client';
import { geoArea, geoContains } from 'd3-geo';

const dir=new URL('../../src/scenarios/1939/',import.meta.url);
const units=JSON.parse(readFileSync(new URL('gazetteer.json',dir)));
const {topo,labels,groups,managers}=JSON.parse(gunzipSync(readFileSync(new URL('atlas.json.gz',dir))));
const faces=feature(topo,topo.objects.units).features;
const groupMap=new Map(groups.map(g=>[g.id,g]));
const arcUse=new Map();
let count=0;
for (const [i,f] of faces.entries()) {
  const {unit,manager,groups:ids}=f.properties;
  assert.equal(manager,units[unit].manager);
  assert.ok(units[manager]||managers[manager],manager);
  const rings=f.geometry.type==='Polygon'?[f.geometry.coordinates]:f.geometry.coordinates;
  assert.equal(rings.length,ids.length);
  for (const [j,poly] of rings.entries()) {
    assert.equal(groupMap.get(ids[j])?.unit,unit);
    assert.ok(geoArea({type:'Polygon',coordinates:poly})<Math.PI*2,unit);
    for (const ring of poly) {assert.ok(ring.length>=4,unit);assert.deepEqual(ring.at(-1),ring[0]);}
    count++;
  }
  for (const arc of topo.objects.units.geometries[i].arcs.flat(Infinity)) {
    const key=arc<0?~arc:arc;
    const list=arcUse.get(key)??[];
    list.push(arc);arcUse.set(key,list);
  }
}
for (const [i,refs] of arcUse) {
  assert.ok(refs.length<=2,'non-manifold arc '+i);
  if (refs.length===2) assert.equal(refs[0],~refs[1],'shared arc orientation '+i);
}
const checks=[
 ['南京',118.80,32.06,'ROC'],['北京',116.4,39.91,'ROC'],['天津',117.18,39.14,'ROC'],['山海关南侧',119.72,39.98,'ROC'],
 ['盛京',123.43,41.80,'FENG'],['承德',117.94,40.97,'JOS'],['鄂尔多斯',109.99,39.82,'ORD'],['库伦',106.92,47.92,'TUSH'],
 ['迪化',87.62,43.82,'DZU'],['伊宁',81.32,43.92,'ILI'],['阿克赛钦',79.6,35.2,'TAR'],['康定',101.96,30.05,'XK'],
 ['昌都',97.18,31.14,'XK'],['拉萨',91.13,29.65,'TIB'],['门隅',91.86,27.59,'TIB'],['基隆',121.74,25.13,'TAI'],
 ['金门',118.36,24.45,'FJ'],['京城',126.98,37.57,'KOR'],['济州',126.53,33.38,'KOR'],['库页',142.74,50.6,'RUS'],
 ['国后',145.85,44.1,'JPN'],['顺化',107.59,16.46,'ANNAM'],['西贡',106.70,10.78,'COCHIN'],['河内',105.85,21.03,'TONKIN'],
 ['比农多',120.974,14.601,'BIN'],['马尼拉港池',120.959,14.596,'MNLPORT'],['王城区',120.974,14.590,'INTRA'],
 ['肯塔基',-84.50,38.04,'VIRG'],['查尔斯顿',-79.94,32.79,'SCAR'],['路易斯安那教区',-90.5,30.6,'FPAR'],
 ['印第安纳',-86.16,39.77,'USA'],['密歇根上半岛',-87.39,46.54,'QUE'],['密歇根下半岛',-84.55,42.73,'QUE'],
 ['温尼伯',-97.14,49.90,'NWS'],['温哥华岛',-125.80,49.66,'NWP'],['巴芬岛',-70,67,'QUE'],['德文岛',-88,75.4,'QUE'],
 ['埃尔斯米尔岛',-80,80,'QUE'],['班克斯岛',-122,73,'NWA'],['下加利福尼亚',-111.65,25.88,'MEX'],
 ['瓦胡',-157.98,21.49,'HAW'],['中途岛沙岛',-177.379,28.209,'HAW'],['关岛',144.78,13.46,'GUAM'],
 ['波多黎各',-66.45,18.19,'PRI'],['古巴',-80.2,22.39,'CUB'],['牙买加',-77.25,18.1,'JAM'],
 ['塞瓦斯托波尔',33.54,44.60,'CRIM'],['乌克兰哈尔科夫',36.23,49.99,'UKR'],['乌日霍罗德',22.30,48.62,'RUTH'],
 ['但泽',18.65,54.35,'DANZ'],['布拉格',14.42,50.08,'BOH'],['维尔纽斯',25.28,54.69,'LTU'],['维堡',28.75,60.71,'FIN'],
 ['布尔根兰',16.52,47.85,'HUN'],['南蒂罗尔',11.35,46.50,'GAT'],['布哈拉',64.42,39.77,'BUKH'],['希瓦',60.36,41.38,'KHIV'],
 ['摩苏尔',43.13,36.34,'OTT'],['耶路撒冷',35.21,31.78,'PAL'],['贝鲁特',35.50,33.90,'OTT'],['亚丁克雷特区',45.04,12.78,'ADEN'],
 ['阿比西尼亚',38.75,9.03,'ETH'],['奥加登',44.26,6.45,'ETH'],['开罗',31.24,30.05,'EGY'],['伊斯梅利亚',32.28,30.59,'EGY'],
 ['鲸湾港',14.52,-22.95,'WALV'],['达累斯萨拉姆',39.27,-6.82,'GEA'],['基加利',30.06,-1.95,'GEA'],
 ['亚温得',11.52,3.87,'KAM'],['东北新几内亚',145.3,-5.4,'GNG'],['莫尔兹比港',147.18,-9.46,'PAP'],
 ['阿皮亚',-171.75,-13.85,'WSAM'],['南极',10,-80,'ATA'],
 ['斯特拉斯堡',7.75,48.58,'DEU'],['梅斯',6.18,49.12,'DEU'],['南锡',6.18,48.69,'FRA'],['贝尔福',6.86,47.64,'FRA'],
 ['卢布尔雅那',14.51,46.06,'DEU'],['马里博尔',15.65,46.56,'DEU'],['的里雅斯特',13.77,45.65,'DEU'],['普拉',13.85,44.87,'DEU'],
 ['里耶卡',14.44,45.34,'HRV'],['克尔克岛',14.59,45.04,'HRV'],['萨格勒布',15.98,45.81,'HRV'],['萨拉热窝',18.41,43.86,'BIH'],
 ['那格浦尔',79.08,21.15,'IND'],['克什米尔',74.80,34.08,'IND'],['达卡',90.41,23.81,'IND'],['卡拉奇',67.01,24.86,'IND'],
 ['格罗兹尼',45.69,43.32,'RUS'],['雅库茨克',129.73,62.03,'RUS'],['喀山',49.12,55.79,'RUS'],['第比利斯',44.80,41.72,'GEO'],
 ['埃里温',44.51,40.18,'ARM'],['巴库',49.87,40.41,'AZE'],['安曼',35.93,31.95,'OTT'],['加沙',34.46,31.50,'PAL'],
 ['戈兰',35.74,33.00,'OTT'],['麦加',39.83,21.42,'SAU'],['哈萨',49.59,25.38,'SAU'],['利雅得',46.68,24.69,'SAU'],
 ['卡诺',8.52,12.0,'NNORTH'],['拉各斯',3.38,6.49,'NSOUTH'],['利文斯通',25.85,-17.85,'NRHW'],['詹姆森堡',32.65,-13.64,'NRHE'],
 ['班吉',18.56,4.37,'USC'],['巴马科',-8,12.65,'USN'],['卢本巴希',27.48,-11.67,'BCON'],['的黎波里',13.19,32.87,'LIB'],
 ['阿尤恩',-13.20,27.15,'SAG'],['里奥德奥罗西部',-14.8,23.95,'RIO'],['外朱巴',42.30,.18,'KEN'],
 ['库夫拉西部界段',23.0,20.0,'USC'],['法拉桑',41.90,16.72,'SAU'],['蒂朗',34.55,27.96,'SAU'],
 ['塞纳菲尔',34.70,27.94,'SAU'],['多哈',51.53,25.29,'QAT'],['科威特城',47.98,29.38,'KUW'],['萨那',44.21,15.35,'OTT']
];
const failures=[];
for(const [place,x,y,id] of checks) {
  const found=faces.filter(f=>geoContains(f,[x,y])).map(f=>f.properties.unit);
  if(found.length!==1||found[0]!==id) failures.push({place,expected:id,found});
}
for(const [unit,id] of [['HAW','kure'],['HAW','midway'],['TAI','diaoyu'],['SEA','scarborough'],['JPN','okinotori']]) {
  assert.ok(labels.some(l=>l.unit===unit&&l.id==='island-'+id),id);
}
assert.equal(units.HAW.manager,'USA');assert.deepEqual(units.HAW.guarantors,['GBR','USA','ROC','JPN']);
assert.deepEqual(units.CRIM.claims,['UKR']);assert.equal(units.BIN.sovereign,'PHL');
assert.ok(!Object.values(units).some(u=>u.parent==='IND'));
for(const id of ['GEO','ARM','AZE','STEP','TURK','SEMI']) assert.equal(units[id].sovereign,'RUS');
for(const label of labels) assert.ok(units[label.unit],label.id);
assert.equal(units.PAL.parent,null);assert.equal(units.PAL.manager,'PALCOM');
console.log(JSON.stringify({units:Object.keys(units).length,components:count,arcs:arcUse.size,locations:checks.length,failures},null,2));
assert.equal(failures.length,0);
