import { Color, type ColorRepresentation } from 'three';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import type {
  CalibrationSnapshot,
  LoadedSourceMap,
  SourceLayer,
  SourceMapSubpath,
} from '../../types/source-map';
import {
  angularDistanceDegrees,
  interpolateGreatCircle,
  LINE_RADIUS,
  lonLatToVector3,
  type LonLat,
} from './globe-math';

export interface GlobeGeometryOptions {
  radius?: number;
  maxAngularStepDegrees?: number;
  maxSourceJumpDegrees?: number;
  landColor?: ColorRepresentation;
  lakeColor?: ColorRepresentation;
  landLineWidth?: number;
  lakeLineWidth?: number;
}

export interface GlobeLineBatch {
  layer: SourceLayer;
  geometry: LineSegmentsGeometry;
  material: LineMaterial;
  line: LineSegments2;
  segmentCount: number;
}

export interface GlobeGeometry {
  land: GlobeLineBatch;
  lake: GlobeLineBatch;
  dispose: () => void;
}

interface ResolvedOptions {
  radius: number;
  maxAngularStepDegrees: number;
  maxSourceJumpDegrees: number;
  landColor: ColorRepresentation;
  lakeColor: ColorRepresentation;
  landLineWidth: number;
  lakeLineWidth: number;
}

const DEFAULT_OPTIONS: ResolvedOptions = {
  radius: LINE_RADIUS,
  maxAngularStepDegrees: 2,
  maxSourceJumpDegrees: 120,
  landColor: '#e8edf2',
  lakeColor: '#7897ad',
  landLineWidth: 1.25,
  lakeLineWidth: 1,
};

function sourcePointToLonLat(
  x: number,
  y: number,
  calibration: CalibrationSnapshot,
): LonLat | null {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

  const width = calibration.xMax - calibration.xMin;
  const height = calibration.yMax - calibration.yMin;
  if (!(width > 0) || !(height > 0)) {
    throw new Error('Globe calibration bounds must have positive width and height.');
  }

  const [longitudeMin, longitudeMax] = calibration.longitudeRange;
  const [latitudeMin, latitudeMax] = calibration.latitudeRange;
  return {
    longitude: longitudeMin + ((x - calibration.xMin) / width) * (longitudeMax - longitudeMin),
    latitude:
      calibration.yAxis === 'down'
        ? latitudeMax - ((y - calibration.yMin) / height) * (latitudeMax - latitudeMin)
        : latitudeMin + ((y - calibration.yMin) / height) * (latitudeMax - latitudeMin),
  };
}

function appendSegment(
  positions: number[],
  start: LonLat,
  end: LonLat,
  radius: number,
  maxAngularStepDegrees: number,
): void {
  const angle = angularDistanceDegrees(start, end);
  if (!Number.isFinite(angle) || angle === 0) return;

  const stepCount = Math.max(1, Math.ceil(angle / maxAngularStepDegrees));
  let previous = lonLatToVector3(start.longitude, start.latitude, radius);

  for (let step = 1; step <= stepCount; step += 1) {
    const currentLonLat =
      step === stepCount ? end : interpolateGreatCircle(start, end, step / stepCount);
    const current = lonLatToVector3(currentLonLat.longitude, currentLonLat.latitude, radius);
    positions.push(previous.x, previous.y, previous.z, current.x, current.y, current.z);
    previous = current;
  }
}

function appendSubpath(
  positions: number[],
  points: Float32Array,
  subpath: SourceMapSubpath,
  calibration: CalibrationSnapshot,
  options: ResolvedOptions,
): void {
  if (subpath.pointCount < 2) return;

  const pointAt = (index: number): LonLat | null => {
    const scalarOffset = (subpath.pointOffset + index) * 2;
    const x = points[scalarOffset];
    const y = points[scalarOffset + 1];
    return x === undefined || y === undefined ? null : sourcePointToLonLat(x, y, calibration);
  };

  const appendPair = (start: LonLat | null, end: LonLat | null): void => {
    if (!start || !end) return;

    const rawLongitudeJump = Math.abs(end.longitude - start.longitude);
    const latitudeJump = Math.abs(end.latitude - start.latitude);
    if (
      rawLongitudeJump > 180 ||
      Math.max(rawLongitudeJump, latitudeJump) > options.maxSourceJumpDegrees
    ) {
      return;
    }

    appendSegment(positions, start, end, options.radius, options.maxAngularStepDegrees);
  };

  const first = pointAt(0);
  let previous = first;
  for (let index = 1; index < subpath.pointCount; index += 1) {
    const current = pointAt(index);
    appendPair(previous, current);
    previous = current;
  }

  if (subpath.closed) appendPair(previous, first);
}

function makeBatch(
  layer: SourceLayer,
  positions: number[],
  color: ColorRepresentation,
  lineWidth: number,
): GlobeLineBatch {
  const geometry = new LineSegmentsGeometry();
  geometry.setPositions(new Float32Array(positions));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  const material = new LineMaterial({
    color: new Color(color),
    linewidth: lineWidth,
    transparent: true,
    opacity: layer === 'land' ? 0.94 : 0.84,
    depthWrite: false,
    alphaToCoverage: true,
    worldUnits: false,
  });
  const line = new LineSegments2(geometry, material);
  line.name = `globe-${layer}-linework`;
  line.renderOrder = layer === 'land' ? 2 : 3;
  line.frustumCulled = true;

  return {
    layer,
    geometry,
    material,
    line,
    segmentCount: positions.length / 6,
  };
}

export function buildGlobeGeometry(
  sourceMap: LoadedSourceMap,
  options: GlobeGeometryOptions = {},
): GlobeGeometry {
  const resolved: ResolvedOptions = { ...DEFAULT_OPTIONS, ...options };
  if (!(resolved.radius > 0)) {
    throw new Error('radius must be greater than zero.');
  }
  if (!(resolved.maxAngularStepDegrees > 0)) {
    throw new Error('maxAngularStepDegrees must be greater than zero.');
  }
  if (!(resolved.maxSourceJumpDegrees > 0)) {
    throw new Error('maxSourceJumpDegrees must be greater than zero.');
  }

  const { manifest, points } = sourceMap;
  const globeLod = manifest.lods.globe;
  const expectedScalarCount = globeLod.pointCount * 2;
  if (points.length !== expectedScalarCount) {
    throw new Error(
      `Globe point buffer length mismatch: expected ${expectedScalarCount}, received ${points.length}.`,
    );
  }

  const positions: Record<SourceLayer, number[]> = { land: [], lake: [] };
  for (const feature of globeLod.features) {
    const featureEnd = feature.pointOffset + feature.pointCount;
    if (feature.pointOffset < 0 || feature.pointCount < 0 || featureEnd > points.length / 2) {
      throw new Error(`Feature ${feature.index} points are outside the globe point buffer.`);
    }

    for (const subpath of feature.subpaths) {
      const subpathEnd = subpath.pointOffset + subpath.pointCount;
      if (
        subpath.pointOffset < feature.pointOffset ||
        subpathEnd > featureEnd ||
        subpath.pointCount < 0
      ) {
        throw new Error(`Feature ${feature.index} has an invalid subpath range.`);
      }
      appendSubpath(positions[feature.layer], points, subpath, manifest.calibration, resolved);
    }
  }

  const land = makeBatch('land', positions.land, resolved.landColor, resolved.landLineWidth);
  const lake = makeBatch('lake', positions.lake, resolved.lakeColor, resolved.lakeLineWidth);

  return {
    land,
    lake,
    dispose: () => {
      land.geometry.dispose();
      land.material.dispose();
      lake.geometry.dispose();
      lake.material.dispose();
    },
  };
}
