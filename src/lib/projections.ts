import {
  geoMercator,
  geoTransverseMercator,
  geoEquirectangular,
  geoNaturalEarth1,
  geoEqualEarth,
  geoOrthographic,
  geoStereographic,
  geoAzimuthalEqualArea,
  geoGnomonic,
  geoConicEqualArea,
  geoConicConformal,
  type GeoProjection,
} from 'd3-geo';
import { geoRobinson, geoWinkel3, geoMollweide, geoBertin1953 } from 'd3-geo-projection';
import type { ProjectionId, ViewState } from '../types';

export interface ProjectionDef {
  id: ProjectionId;
  name: string;
  group: 'World' | 'Regional' | 'Globe';
  factory: () => GeoProjection;
  /** Globe-like projections rotate latitude instead of re-centering */
  globe: boolean;
  maxLat: number;
  hint: string;
}

export const PROJECTIONS: ProjectionDef[] = [
  { id:'lambertEurope',name:'Lambert Conformal Conic · Europe',group:'Regional',factory:()=>geoConicConformal().parallels([40,62]),globe:false,maxLat:84,hint:'European atlas, standard parallels 40° and 62°' },
  { id: 'mercator', name: 'Mercator', group: 'Regional', factory: () => geoMercator(), globe: false, maxLat: 84, hint: 'Classic web-map look, straight coastlines' },
  { id: 'transverseMercator', name: 'Transverse Mercator', group: 'Regional', factory: () => geoTransverseMercator(), globe: false, maxLat: 89, hint: 'Great for north–south regions' },
  { id: 'albers', name: 'Albers Conic', group: 'Regional', factory: () => geoConicEqualArea().parallels([20, 50]), globe: false, maxLat: 89, hint: 'Gently curved, ideal for continents' },
  { id: 'equirectangular', name: 'Equirectangular', group: 'World', factory: () => geoEquirectangular(), globe: false, maxLat: 90, hint: 'Simple plate carrée grid' },
  { id: 'naturalEarth', name: 'Natural Earth', group: 'World', factory: () => geoNaturalEarth1(), globe: false, maxLat: 90, hint: 'Pleasant world overview' },
  { id: 'equalEarth', name: 'Equal Earth', group: 'World', factory: () => geoEqualEarth(), globe: false, maxLat: 90, hint: 'Modern equal-area world' },
  { id: 'robinson', name: 'Robinson', group: 'World', factory: () => geoRobinson() as unknown as GeoProjection, globe: false, maxLat: 90, hint: 'Atlas classic' },
  { id: 'winkel3', name: 'Winkel Tripel', group: 'World', factory: () => geoWinkel3() as unknown as GeoProjection, globe: false, maxLat: 90, hint: 'National Geographic style' },
  { id: 'mollweide', name: 'Mollweide', group: 'World', factory: () => geoMollweide() as unknown as GeoProjection, globe: false, maxLat: 90, hint: 'Elliptical equal-area' },
  { id: 'bertin', name: 'Bertin 1953', group: 'World', factory: () => geoBertin1953() as unknown as GeoProjection, globe: false, maxLat: 90, hint: 'Artistic, continent-centric' },
  { id: 'orthographic', name: 'Globe (Orthographic)', group: 'Globe', factory: () => geoOrthographic().clipAngle(90), globe: true, maxLat: 90, hint: 'Earth as seen from space' },
  { id: 'stereographic', name: 'Stereographic', group: 'Globe', factory: () => geoStereographic().clipAngle(120), globe: true, maxLat: 90, hint: 'Polar & hemispheric views' },
  { id: 'azimuthalEqualArea', name: 'Azimuthal Equal Area', group: 'Globe', factory: () => geoAzimuthalEqualArea().clipAngle(150), globe: true, maxLat: 90, hint: 'Balanced hemispheric look' },
  { id: 'gnomonic', name: 'Gnomonic', group: 'Globe', factory: () => geoGnomonic().clipAngle(60), globe: true, maxLat: 90, hint: 'Dramatic, great circles are straight' },
];

export function getProjectionDef(id: ProjectionId): ProjectionDef {
  return PROJECTIONS.find((p) => p.id === id) ?? PROJECTIONS[0];
}

const SPHERE = { type: 'Sphere' } as const;
const baseScaleCache = new Map<string, number>();

/** Scale at which the whole world fits inside a w×h box (zoom = 1). */
export function baseScale(def: ProjectionDef, w: number, h: number): number {
  if (def.id==='lambertEurope') return Math.min(w,h)/Math.PI;
  const key = `${def.id}:${Math.round(w)}x${Math.round(h)}`;
  const cached = baseScaleCache.get(key);
  if (cached) return cached;
  let s: number;
  try {
    const p = def.factory();
    p.fitSize([w, h], SPHERE as never);
    s = p.scale();
    if (!isFinite(s) || s <= 0) s = Math.min(w, h) / 6.3;
  } catch {
    s = Math.min(w, h) / 6.3;
  }
  baseScaleCache.set(key, s);
  return s;
}

export function buildProjection(view: ViewState, w: number, h: number): GeoProjection {
  const def = getProjectionDef(view.projection);
  const p = def.factory();
  p.translate([w / 2, h / 2]);
  if (def.id==='lambertEurope') {
    p.rotate([-10,0,0]).center([view.lon-10,view.lat]);
  } else if (def.globe) {
    p.rotate([-view.lon, -view.lat, 0]);
  } else {
    p.rotate([-view.lon, 0, 0]);
    p.center([0, view.lat]);
  }
  if (typeof (p as GeoProjection).angle === 'function') {
    (p as GeoProjection).angle(view.angle);
  }
  p.scale(baseScale(def, w, h) * view.zoom);
  return p;
}

/** Geographic bounds of a disposable equirectangular editing texture, in degrees. */
export interface TextureArea { lon: number; lat: number; span: number }
export function textureProjection(area: TextureArea, w: number, h: number) {
  return geoEquirectangular().rotate([-area.lon, 0]).center([0, area.lat]).translate([w / 2, h / 2])
    .scale(w * 180 / (area.span * Math.PI)).clipExtent([[0,0],[w,h]]);
}
