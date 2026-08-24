import type { GeoProjection } from 'd3-geo';
import {
  assertValidExtent,
  extentCenterLatitude,
  extentCenterLongitude,
  longitudeSpan,
} from '../geo/extent';
import type { GeographicExtent } from '../model/map-document';
import { createD3Projection, getProjectionMetadata } from './catalog';
import { assertProjectionValid } from './validation';
import type {
  CreateProjectionOptions,
  CreatedProjection,
  GeographicPosition,
  ProjectionId,
  ProjectionParameters,
  ProjectionViewport,
} from './types';

interface SampleSettings {
  tolerance: number;
  maxDepth: number;
  maxPoints: number;
}

const DEFAULT_SAMPLE_SETTINGS: SampleSettings = {
  tolerance: 0.0001,
  maxDepth: 12,
  maxPoints: 16_384,
};

function canonicalLongitude(longitude: number): number {
  const normalized = ((((longitude + 180) % 360) + 360) % 360) - 180;
  return normalized === -180 && longitude > 0 ? 180 : normalized;
}

function resolveCenter(
  extent: GeographicExtent,
  requested: ProjectionParameters['center'],
): [number, number] {
  if (requested && requested !== 'auto') return [requested[0], requested[1]];
  return [extentCenterLongitude(extent), extentCenterLatitude(extent)];
}

function buildUnwrappedCorners(extent: GeographicExtent): GeographicPosition[] {
  const east = extent.wrapsAntimeridian ? extent.east + 360 : extent.east;
  return [
    [extent.west, extent.south],
    [east, extent.south],
    [east, extent.north],
    [extent.west, extent.north],
    [extent.west, extent.south],
  ];
}

function projectedAtUnitScale(
  projection: GeoProjection,
  point: GeographicPosition,
): [number, number] | null {
  const projected = projection([canonicalLongitude(point[0]), point[1]]);
  if (!projected || !Number.isFinite(projected[0]) || !Number.isFinite(projected[1])) return null;
  return projected;
}

function adaptiveSampleEdge(
  projection: GeoProjection,
  start: GeographicPosition,
  end: GeographicPosition,
  settings: SampleSettings,
  total: { count: number },
): GeographicPosition[] {
  const startProjected = projectedAtUnitScale(projection, start);
  const endProjected = projectedAtUnitScale(projection, end);
  if (!startProjected || !endProjected) return [start, end];

  const visit = (
    left: GeographicPosition,
    right: GeographicPosition,
    leftProjected: [number, number],
    rightProjected: [number, number],
    depth: number,
  ): GeographicPosition[] => {
    if (total.count >= settings.maxPoints || depth >= settings.maxDepth) return [right];
    const middle: GeographicPosition = [(left[0] + right[0]) / 2, (left[1] + right[1]) / 2];
    const middleProjected = projectedAtUnitScale(projection, middle);
    if (!middleProjected) return [right];
    const error = Math.hypot(
      middleProjected[0] - (leftProjected[0] + rightProjected[0]) / 2,
      middleProjected[1] - (leftProjected[1] + rightProjected[1]) / 2,
    );
    if (error <= settings.tolerance) return [right];
    total.count += 1;
    return [
      ...visit(left, middle, leftProjected, middleProjected, depth + 1),
      ...visit(middle, right, middleProjected, rightProjected, depth + 1),
    ];
  };

  return [start, ...visit(start, end, startProjected, endProjected, 0)];
}

function sampleExtentBoundary(
  extent: GeographicExtent,
  projection: GeoProjection,
  settings: SampleSettings,
): GeographicPosition[] {
  const corners = buildUnwrappedCorners(extent);
  const boundary: GeographicPosition[] = [];
  const total = { count: 4 };
  for (let index = 1; index < corners.length; index += 1) {
    const edge = adaptiveSampleEdge(
      projection,
      corners[index - 1]!,
      corners[index]!,
      settings,
      total,
    );
    if (boundary.length > 0) edge.shift();
    boundary.push(...edge);
  }
  return boundary;
}

function fitProjection(
  projection: GeoProjection,
  geographicBoundary: readonly GeographicPosition[],
  viewport: ProjectionViewport,
  requestedScale?: number,
): [number, number][] {
  if (
    !Number.isFinite(viewport.width) ||
    viewport.width <= 0 ||
    !Number.isFinite(viewport.height) ||
    viewport.height <= 0
  ) {
    throw new RangeError('Projection viewport dimensions must be finite and greater than zero.');
  }
  const padding = viewport.padding ?? 0;
  if (
    !Number.isFinite(padding) ||
    padding < 0 ||
    padding * 2 >= Math.min(viewport.width, viewport.height)
  ) {
    throw new RangeError('Projection viewport padding leaves no drawable area.');
  }

  const unitBoundary = geographicBoundary
    .map((point) => projectedAtUnitScale(projection, point))
    .filter((point): point is [number, number] => point !== null);
  if (unitBoundary.length < 2)
    throw new RangeError('Projection extent boundary cannot be projected.');

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const [x, y] of unitBoundary) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  const projectedWidth = maxX - minX;
  const projectedHeight = maxY - minY;
  if (!(projectedWidth > 0) || !(projectedHeight > 0)) {
    throw new RangeError('Projection extent boundary has no projected area.');
  }

  const fittedScale = Math.min(
    (viewport.width - padding * 2) / projectedWidth,
    (viewport.height - padding * 2) / projectedHeight,
  );
  const scale = requestedScale === undefined ? fittedScale : fittedScale * requestedScale;
  if (!Number.isFinite(scale) || scale <= 0)
    throw new RangeError('Projection scale must be greater than zero.');
  const middleX = (minX + maxX) / 2;
  const middleY = (minY + maxY) / 2;
  projection
    .scale(scale)
    .translate([viewport.width / 2 - scale * middleX, viewport.height / 2 - scale * middleY]);

  return geographicBoundary
    .map((point) => projection([canonicalLongitude(point[0]), point[1]]))
    .filter(
      (point): point is [number, number] =>
        point !== null && Number.isFinite(point[0]) && Number.isFinite(point[1]),
    );
}

export function createProjection(options: CreateProjectionOptions): CreatedProjection {
  assertValidExtent(options.extent);
  const center = resolveCenter(options.extent, options.parameters?.center);
  assertProjectionValid(options.id, options.extent, center);

  const projection = createD3Projection(options.id)
    .scale(1)
    .translate([0, 0])
    .precision(options.parameters?.precision ?? 0.1);

  if (options.id === 'lambert-azimuthal-equal-area') {
    projection.rotate([-center[0], -center[1], 0]).center([0, 0]);
  } else {
    // Rotation establishes the central meridian and keeps wrapped selections
    // continuous. Centering only translates vertically, preserving north-up.
    projection.rotate([-center[0], 0, 0]).center([0, center[1]]);
  }
  if (options.parameters?.rotate) projection.rotate([...options.parameters.rotate]);

  const boundaryGeographic = sampleExtentBoundary(options.extent, projection, {
    tolerance: options.boundaryTolerance ?? DEFAULT_SAMPLE_SETTINGS.tolerance,
    maxDepth: options.boundaryMaxDepth ?? DEFAULT_SAMPLE_SETTINGS.maxDepth,
    maxPoints: options.boundaryMaxPoints ?? DEFAULT_SAMPLE_SETTINGS.maxPoints,
  });
  const boundary = fitProjection(
    projection,
    boundaryGeographic,
    options.viewport,
    options.parameters?.scale,
  );

  return {
    id: options.id,
    metadata: getProjectionMetadata(options.id),
    projection,
    extent: options.extent,
    center,
    boundaryGeographic,
    boundary,
  };
}

export function autoProjectionCenter(extent: GeographicExtent): [number, number] {
  assertValidExtent(extent);
  return [extentCenterLongitude(extent), extentCenterLatitude(extent)];
}

export function projectionExtentSpan(extent: GeographicExtent): number {
  return longitudeSpan(extent);
}

export function validateProjectionId(id: string): asserts id is ProjectionId {
  const supported: ProjectionId[] = [
    'plate-carree',
    'mercator',
    'equal-earth',
    'natural-earth-1',
    'winkel-tripel',
    'lambert-azimuthal-equal-area',
  ];
  if (!supported.includes(id as ProjectionId)) throw new RangeError(`Unknown projection: ${id}`);
}
