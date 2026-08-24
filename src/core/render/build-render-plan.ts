import { geoGraticule } from 'd3-geo';
import { svgToGeographic } from '../geo/calibration';
import { clipPolylineToExtent } from '../geo/clip-polyline';
import { longitudeSpan } from '../geo/extent';
import type { LonLat } from '../geo/spherical';
import type { MapDocument } from '../model/map-document';
import { createProjection, validateProjectionId } from '../projection';
import { densifyProjectedPolyline } from '../projection/densify';
import type { LoadedSourceMap, SourceMapFeature, SourceMapSubpath } from '../../types/source-map';
import type { RenderLineRun, RenderPlan, RenderWarning } from './render-plan';

export interface BuildRenderPlanOptions {
  revision?: number;
  precision?: 'preview' | 'export';
  now?: () => number;
}

function absoluteOffset(feature: SourceMapFeature, subpath: SourceMapSubpath): number {
  return subpath.pointOffset >= feature.pointOffset
    ? subpath.pointOffset
    : feature.pointOffset + subpath.pointOffset;
}

function readGeographicRun(
  source: LoadedSourceMap,
  feature: SourceMapFeature,
  subpath: SourceMapSubpath,
): LonLat[] {
  const points: LonLat[] = [];
  const offset = absoluteOffset(feature, subpath);
  const limit = Math.min(offset + subpath.pointCount, source.points.length / 2);
  for (let pointIndex = offset; pointIndex < limit; pointIndex += 1) {
    const x = source.points[pointIndex * 2];
    const y = source.points[pointIndex * 2 + 1];
    if (x === undefined || y === undefined || !Number.isFinite(x) || !Number.isFinite(y)) continue;
    const geographic = svgToGeographic({ x, y }, source.manifest.calibration);
    points.push({ longitude: geographic.longitude, latitude: geographic.latitude });
  }
  return points;
}

function addProjectedRun(
  runs: RenderLineRun[],
  geographic: readonly LonLat[],
  projection: ReturnType<typeof createProjection>['projection'],
  tolerance: number,
  metadata: Omit<RenderLineRun, 'points'>,
  warnings: RenderWarning[],
): number {
  const result = densifyProjectedPolyline(geographic, projection, {
    tolerance,
    maxDepth: 18,
    maxPoints: 250_000,
  });
  if (
    (result.stats.maxDepthReached || result.stats.pointLimitReached) &&
    !warnings.some((warning) => warning.code === 'DENSIFICATION_LIMIT')
  ) {
    warnings.push({
      code: 'DENSIFICATION_LIMIT',
      message: '部分线段达到投影加密保护上限。',
      severity: 'warning',
    });
  }
  if (result.points.length >= 2) runs.push({ ...metadata, points: result.points });
  return result.points.length;
}

function extentBoundary(extent: MapDocument['extent'], step = 2): LonLat[] {
  const east = extent.wrapsAntimeridian ? extent.east + 360 : extent.east;
  const appendEdge = (result: LonLat[], start: LonLat, end: LonLat) => {
    const count = Math.max(
      1,
      Math.ceil(
        Math.max(
          Math.abs(end.longitude - start.longitude),
          Math.abs(end.latitude - start.latitude),
        ) / step,
      ),
    );
    for (let index = result.length ? 1 : 0; index <= count; index += 1) {
      const t = index / count;
      let longitude = start.longitude + (end.longitude - start.longitude) * t;
      while (longitude > 180) longitude -= 360;
      result.push({ longitude, latitude: start.latitude + (end.latitude - start.latitude) * t });
    }
  };
  const result: LonLat[] = [];
  appendEdge(
    result,
    { longitude: extent.west, latitude: extent.south },
    { longitude: east, latitude: extent.south },
  );
  appendEdge(
    result,
    { longitude: east, latitude: extent.south },
    { longitude: east, latitude: extent.north },
  );
  appendEdge(
    result,
    { longitude: east, latitude: extent.north },
    { longitude: extent.west, latitude: extent.north },
  );
  appendEdge(
    result,
    { longitude: extent.west, latitude: extent.north },
    { longitude: extent.west, latitude: extent.south },
  );
  return result;
}

function buildGraticule(document: MapDocument): LonLat[][] {
  if (!document.style.graticule.visible) return [];
  const geometry = geoGraticule()
    .stepMinor([
      document.style.graticule.longitudeInterval,
      document.style.graticule.latitudeInterval,
    ])
    .lines();
  return geometry.flatMap((line) => {
    const points = line.coordinates.map((coordinate) => ({
      longitude: coordinate[0]!,
      latitude: coordinate[1]!,
    }));
    return clipPolylineToExtent(points, document.extent);
  });
}

export function buildRenderPlan(
  document: MapDocument,
  source: LoadedSourceMap,
  options: BuildRenderPlanOptions = {},
): RenderPlan {
  const startedAt = options.now?.() ?? performance.now();
  validateProjectionId(document.projection.id);
  if (source.manifest.source.sha256 !== document.source.sha256) {
    throw new Error('项目引用的源图哈希与已加载资产不一致。');
  }

  const parameters = document.projection.parameters;
  const scale = typeof parameters.scale === 'number' ? parameters.scale : undefined;
  const created = createProjection({
    id: document.projection.id,
    extent: document.extent,
    viewport: document.canvas,
    parameters: { scale },
  });
  const tolerance = options.precision === 'export' ? 0.1 : 0.35;
  const lineRuns: RenderLineRun[] = [];
  const warnings: RenderWarning[] = [];
  let inputPoints = 0;
  let outputPoints = 0;

  const features =
    source.manifest.lods.detail.pointCount === source.points.length / 2
      ? source.manifest.lods.detail.features
      : source.manifest.lods.globe.features;
  for (const feature of features) {
    for (const subpath of feature.subpaths) {
      const geographic = readGeographicRun(source, feature, subpath);
      inputPoints += geographic.length;
      for (const clipped of clipPolylineToExtent(geographic, document.extent)) {
        outputPoints += addProjectedRun(
          lineRuns,
          clipped,
          created.projection,
          tolerance,
          {
            layer: 'map-linework',
            sourceLayer: feature.layer,
            ...(feature.countryCode ? { countryCode: feature.countryCode } : {}),
            sourcePathId: feature.sourcePathId,
            closed: subpath.closed,
          },
          warnings,
        );
      }
    }
  }

  for (const line of buildGraticule(document)) {
    outputPoints += addProjectedRun(
      lineRuns,
      line,
      created.projection,
      tolerance,
      { layer: 'graticule' },
      warnings,
    );
  }

  if (document.style.extentFrame.visible) {
    const boundary = extentBoundary(
      document.extent,
      Math.max(1, longitudeSpan(document.extent) / 180),
    );
    outputPoints += addProjectedRun(
      lineRuns,
      boundary,
      created.projection,
      tolerance,
      { layer: 'extent-frame', closed: true },
      warnings,
    );
  }

  const elapsedMs = (options.now?.() ?? performance.now()) - startedAt;
  return {
    revision: options.revision ?? 0,
    width: document.canvas.width,
    height: document.canvas.height,
    projectionId: document.projection.id,
    sourceHash: source.manifest.source.sha256,
    boundary: created.boundary.map(([x, y]) => ({ x, y })),
    lineRuns,
    style: {
      lineColor: document.style.linework.color,
      lineWidth: document.style.linework.width,
      lineOpacity: document.style.linework.opacity,
      lineCap: document.style.linework.lineCap,
      lineJoin: document.style.linework.lineJoin,
      background: document.style.background.color,
      graticuleColor: document.style.graticule.color,
      graticuleWidth: document.style.graticule.width,
      graticuleOpacity: document.style.graticule.opacity,
      extentColor: document.style.extentFrame.color,
      extentWidth: document.style.extentFrame.width,
    },
    warnings,
    stats: { inputPoints, outputPoints, elapsedMs },
  };
}
