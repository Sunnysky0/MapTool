import {
  geoAzimuthalEqualArea,
  geoEqualEarth,
  geoEquirectangular,
  geoMercator,
  geoNaturalEarth1,
  type GeoProjection,
} from 'd3-geo';
import { geoWinkel3 } from 'd3-geo-projection';
import type { ProjectionId, ProjectionMetadata } from './types';

export const PROJECTION_CATALOG: readonly ProjectionMetadata[] = [
  {
    id: 'plate-carree',
    name: '等距圆柱投影（Plate Carrée）',
    category: '圆柱投影',
    description: '经纬线等间距且相互垂直，便于直接读取经纬度。',
    property: '等距（沿经线与赤道）',
    validation: '纬度必须在 −90° 到 90° 之间。',
  },
  {
    id: 'mercator',
    name: '墨卡托投影',
    category: '圆柱投影',
    description: '保角航海投影，高纬地区面积变形显著。',
    property: '保角',
    validation: '纬度必须在 ±85.05112878° 以内。',
  },
  {
    id: 'equal-earth',
    name: 'Equal Earth 等积投影',
    category: '伪圆柱投影',
    description: '适合全球专题地图，保持区域面积比例。',
    property: '等积',
    validation: '纬度必须在 −90° 到 90° 之间。',
  },
  {
    id: 'natural-earth-1',
    name: 'Natural Earth I 投影',
    category: '伪圆柱投影',
    description: '为世界地图设计的折衷外观，整体变形均衡。',
    property: '折衷',
    validation: '纬度必须在 −90° 到 90° 之间。',
  },
  {
    id: 'winkel-tripel',
    name: '温克尔三重投影',
    category: '折衷投影',
    description: '综合降低面积、方向与距离三类变形。',
    property: '折衷',
    validation: '纬度必须在 −90° 到 90° 之间。',
  },
  {
    id: 'lambert-azimuthal-equal-area',
    name: '兰伯特方位等积投影',
    category: '方位投影',
    description: '以地图中心为基点保持面积，适合半球与区域地图。',
    property: '等积、方位',
    validation: '纬度必须有效，且不可投影中心的球面反极点。',
  },
] as const;

const metadataById = new Map(PROJECTION_CATALOG.map((metadata) => [metadata.id, metadata]));

export function isProjectionId(value: string): value is ProjectionId {
  return metadataById.has(value as ProjectionId);
}

export function getProjectionMetadata(id: ProjectionId): ProjectionMetadata {
  return metadataById.get(id)!;
}

export function createD3Projection(id: ProjectionId): GeoProjection {
  switch (id) {
    case 'plate-carree':
      return geoEquirectangular();
    case 'mercator':
      return geoMercator();
    case 'equal-earth':
      return geoEqualEarth();
    case 'natural-earth-1':
      return geoNaturalEarth1();
    case 'winkel-tripel':
      return geoWinkel3();
    case 'lambert-azimuthal-equal-area':
      return geoAzimuthalEqualArea();
  }
}
