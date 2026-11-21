import { presimplify, simplify, filter, filterAttachedWeight, filterWeight, sphericalRingArea } from 'topojson-simplify';
import { geometrySimplifier, OVERVIEW, REGIONAL, withPreviews } from '../lib/previewData';
import { feature, mesh } from 'topojson-client';
import type { FeatureCollection, Geometry, MultiLineString, MultiPolygon, Polygon } from 'geojson';
import type { GeometryCollection, GeometryObject, Topology } from 'topojson-specification';
import type { HistoricalLabel, LayerData, PoliticalUnit, ScenarioData, ScenarioRef } from '../types';
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

export async function loadScenario(revision:number): Promise<LayerData> {
  const response = await fetch(revision===1?originalArchive:archive);
  if (!response.ok || !response.body) throw new Error('无法读取情景地图');
  const raw = await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).json() as Archive;
  if (raw.ref.id !== SCENARIO_1939.id || raw.ref.revision !== revision) throw new Error('情景数据版本不符');
  const units = (revision===1?originalGazetteer:gazetteer) as unknown as Record<string,PoliticalUnit>;
  const full = {scenario: unpack(raw, raw.topo, units)};
  const weighted = presimplify(raw.topo);
  function preview(tolerance: number): LayerData {
    const detail = simplify(weighted, tolerance * tolerance);
    const keep = filterAttachedWeight(detail, tolerance * tolerance * 2);
    // A collapsed ring with reversed winding would fill almost the entire globe.
    const valid = filterWeight(detail, 1e-14, (ring, interior?: boolean) => {
      const area = sphericalRingArea(ring, !!interior);
      return area < 2*Math.PI ? area : 0;
    });
    const topology = filter(detail, (ring, hole) => keep(ring, hole) && valid(ring, hole)) as Archive['topo'];
    const reduce = geometrySimplifier(tolerance);
    const geography = raw.geography && {...raw.geography,
      rivers: raw.geography.rivers.map(reduce), lakes: raw.geography.lakes.map(reduce), rails: reduce(raw.geography.rails)};
    return {scenario: unpack({...raw, geography, claims: reduce(raw.claims),
      cityRivers: reduce(raw.cityRivers), waterlines: raw.waterlines.map(reduce)}, topology, units)};
  }
  return withPreviews(full, preview(OVERVIEW), preview(REGIONAL));
}

function unpack(raw: Archive, topo: Archive['topo'], units: Record<string,PoliticalUnit>): ScenarioData {
  const revision = raw.ref.revision;
  const collection = topo.objects.units;
  const faces = feature(topo,collection) as FeatureCollection<Polygon | MultiPolygon,{unit:string; manager:string; groups:string[]}>;
  const owner = (g: GeometryObject) => units[(g.properties as {unit:string}).unit];
  const sovereignBorders = mesh(topo,collection,(a,b) => a===b ? revision===1 : owner(a).sovereign!==owner(b).sovereign);
  const coastline=revision===2?mesh(topo,collection,(a,b)=>a===b):undefined;
  for (const g of raw.waterlines) {
    if (g.type==='LineString') sovereignBorders.coordinates.push(g.coordinates);
    if (g.type==='MultiLineString') sovereignBorders.coordinates.push(...g.coordinates);
  }
  const adminBorders = mesh(topo,collection,(a,b) => a!==b && owner(a).id!==owner(b).id && owner(a).sovereign===owner(b).sovereign);
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
