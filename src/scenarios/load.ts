import { feature, mesh } from 'topojson-client';
import type { FeatureCollection, Geometry, MultiLineString, MultiPolygon, Polygon } from 'geojson';
import type { GeometryCollection, GeometryObject, Topology } from 'topojson-specification';
import type { HistoricalLabel, PoliticalUnit, ScenarioData, ScenarioRef } from '../types';
import { SCENARIO_1939 } from '../lib/presets';
import archive from './1939/atlas.json.gz?url&inline';
import gazetteer from './1939/gazetteer.json';
import originalArchive from './1939/v1/atlas.json.gz?url&inline';
import originalGazetteer from './1939/v1/gazetteer.json';

interface Archive {
  ref: ScenarioRef;
  topo: Topology<{ units: GeometryCollection<{unit:string; manager:string; groups:string[]}> }>;
  claims: MultiLineString;
  cityRivers: MultiLineString;
  waterlines: Geometry[];
  labels: HistoricalLabel[];
  groups: ScenarioData['islandGroups'];
  managers: Record<string,string>;
  geography?: ScenarioData['geography'];
  europeanNames?: ScenarioData['europeanNames'];
}

export async function loadScenario(revision:number): Promise<ScenarioData> {
  const response = await fetch(revision===1?originalArchive:archive);
  if (!response.ok || !response.body) throw new Error('无法读取情景地图');
  const raw = await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).json() as Archive;
  if (raw.ref.id !== SCENARIO_1939.id || raw.ref.revision !== revision) throw new Error('情景数据版本不符');
  const units = (revision===1?originalGazetteer:gazetteer) as unknown as Record<string,PoliticalUnit>;
  const collection = raw.topo.objects.units;
  const faces = feature(raw.topo,collection) as FeatureCollection<Polygon | MultiPolygon,{unit:string; manager:string; groups:string[]}>;
  const owner = (g: GeometryObject) => units[(g.properties as {unit:string}).unit];
  const sovereignBorders = mesh(raw.topo,collection,(a,b) => a===b ? revision===1 : owner(a).sovereign!==owner(b).sovereign);
  const coastline=revision===2?mesh(raw.topo,collection,(a,b)=>a===b):undefined;
  for (const g of raw.waterlines) {
    if (g.type==='LineString') sovereignBorders.coordinates.push(g.coordinates);
    if (g.type==='MultiLineString') sovereignBorders.coordinates.push(...g.coordinates);
  }
  const adminBorders = mesh(raw.topo,collection,(a,b) => a!==b && owner(a).id!==owner(b).id && owner(a).sovereign===owner(b).sovereign);
  // NE closes land on both sides of ±180°. Those closing edges are not coasts.
  const stripSeam=(lines:MultiLineString)=>lines.coordinates.flatMap(line=>{
    const runs:number[][][]=[];
    let run=[line[0]];
    for(let i=1;i<line.length;i++) {
      const a=line[i-1], b=line[i];
      if ((Math.abs(a[0])>179.99999 && Math.abs(b[0])>179.99999) || (a[1]<-89.99999 && b[1]<-89.99999)) {
        if(run.length>1) runs.push(run);
        run=[];
      }
      run.push(b);
    }
    if(run.length>1) runs.push(run);
    return runs;
  });
  sovereignBorders.coordinates=stripSeam(sovereignBorders);
  if(coastline) coastline.coordinates=stripSeam(coastline);
  return { units, faces:faces.features, islandGroups:raw.groups, sovereignBorders, adminBorders, coastline,claims:raw.claims, cityRivers:raw.cityRivers,
    labels:raw.labels, managers:raw.managers,geography:raw.geography,europeanNames:raw.europeanNames };
}
