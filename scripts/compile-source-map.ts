import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { DOMParser } from '@xmldom/xmldom';
import type {
  Document as XmlDocument,
  Element as XmlElement,
  Node as XmlNode,
} from '@xmldom/xmldom';
import { SVGPathData } from 'svg-pathdata';
import type { CommandC, CommandL, CommandM, CommandZ } from 'svg-pathdata';
import {
  applyToPoint,
  compose,
  fromDefinition,
  fromTransformAttribute,
  identity,
} from 'transformation-matrix';
import type { Matrix } from 'transformation-matrix';

import type {
  CalibrationSnapshot,
  SourceLayer,
  SourceMapFeature,
  SourceMapManifest,
  SourceMapSubpath,
} from '../src/types/source-map.ts';

export const COMPILER_VERSION = '1.0.0';
export const SOURCE_FILE = 'source_map.svg';
export const GLOBE_FILE = 'source-map-globe.bin';
export const DETAIL_FILE = 'source-map-detail.bin';
export const MANIFEST_FILE = 'source-map.manifest.json';
export const GLOBE_TOLERANCE = 1;
export const DETAIL_TOLERANCE = 0.25;
const MAX_SOURCE_SEGMENT_LENGTH = 24;
const MAX_SUBDIVISION_DEPTH = 20;
const EXPECTED_SOURCE_PATH_COUNT = 2_288;
const EXPECTED_DECORATIVE_PATH_COUNT = 76;
const SVG_ELEMENT_NODE = 1;

interface Point {
  x: number;
  y: number;
}

interface CubicSegment {
  kind: 'cubic';
  start: Point;
  control1: Point;
  control2: Point;
  end: Point;
}

interface LineSegment {
  kind: 'line';
  start: Point;
  end: Point;
}

type Segment = CubicSegment | LineSegment;

interface ParsedSubpath {
  start: Point;
  segments: Segment[];
  closed: boolean;
}

interface ParsedFeature {
  index: number;
  layer: SourceLayer;
  countryCode: string | null;
  sourcePathId: string;
  subpaths: ParsedSubpath[];
}

interface LodedFeature {
  points: number[];
  subpaths: SourceMapSubpath[];
}

interface SourceStats {
  sourcePathCount: number;
  geographicPathCount: number;
  decorativePathCount: number;
  rejectedPathCount: number;
  landPathCount: number;
  lakePathCount: number;
}

export interface CompiledSourceMap {
  manifest: SourceMapManifest;
  globe: Uint8Array;
  detail: Uint8Array;
}

interface SemanticContext {
  classes: readonly string[];
  ids: readonly string[];
}

function isXmlElement(node: XmlNode | null): node is XmlElement {
  return node?.nodeType === SVG_ELEMENT_NODE;
}

function getXmlElementChildren(element: XmlElement): XmlElement[] {
  const result: XmlElement[] = [];
  for (let child = element.firstChild; child; child = child.nextSibling) {
    if (isXmlElement(child)) result.push(child);
  }
  return result;
}

function classTokens(element: XmlElement): string[] {
  return (element.getAttribute('class') ?? '').trim().split(/\s+/u).filter(Boolean);
}

function inheritedSemanticContext(element: XmlElement): SemanticContext {
  const lineage: XmlElement[] = [];
  for (let current: XmlNode | null = element; isXmlElement(current); current = current.parentNode) {
    lineage.push(current);
  }
  lineage.reverse();

  const classes: string[] = [];
  const ids: string[] = [];
  for (const current of lineage) {
    classes.push(...classTokens(current));
    const id = current.getAttribute('id');
    if (id) ids.push(id);
  }
  return { classes, ids };
}

function parseXmlElementTransform(element: XmlElement): Matrix {
  const attribute = element.getAttribute('transform');
  if (!attribute?.trim()) return identity();
  try {
    return compose(fromDefinition(fromTransformAttribute(attribute)));
  } catch (error) {
    throw new Error(
      `Invalid transform on ${describeXmlElement(element)}: ${attribute}. ${errorMessage(error)}`,
      { cause: error },
    );
  }
}

function collectPaths(
  element: XmlElement,
  parentTransform: Matrix,
  result: Array<{ element: XmlElement; transform: Matrix }>,
): void {
  const transform = compose(parentTransform, parseXmlElementTransform(element));
  if ((element.localName ?? element.tagName) === 'path') result.push({ element, transform });
  for (const child of getXmlElementChildren(element)) collectPaths(child, transform, result);
}

function describeXmlElement(element: XmlElement): string {
  const id = element.getAttribute('id');
  return `<${element.tagName}${id ? ` id="${id}"` : ''}>`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function applyMatrix(matrix: Matrix, point: Point): Point {
  const transformed = applyToPoint(matrix, point);
  return { x: transformed.x, y: transformed.y };
}

function parsePath(element: XmlElement, matrix: Matrix): ParsedSubpath[] {
  const data = element.getAttribute('d');
  if (!data?.trim()) throw new Error(`${describeXmlElement(element)} has no path data.`);

  let commands;
  try {
    commands = new SVGPathData(data)
      .toAbs()
      .normalizeHVZ(false)
      .normalizeST()
      .qtToC()
      .aToC().commands;
  } catch (error) {
    throw new Error(`Unable to parse ${describeXmlElement(element)}: ${errorMessage(error)}`, {
      cause: error,
    });
  }

  const subpaths: ParsedSubpath[] = [];
  let subpath: ParsedSubpath | null = null;
  let current: Point | null = null;

  for (const command of commands) {
    switch (command.type) {
      case SVGPathData.MOVE_TO: {
        const move = command as CommandM;
        current = { x: move.x, y: move.y };
        subpath = { start: current, segments: [], closed: false };
        subpaths.push(subpath);
        break;
      }
      case SVGPathData.LINE_TO: {
        if (!subpath || !current) throw new Error(`${describeXmlElement(element)} draws before M.`);
        const line = command as CommandL;
        const end = { x: line.x, y: line.y };
        subpath.segments.push({ kind: 'line', start: current, end });
        current = end;
        break;
      }
      case SVGPathData.CURVE_TO: {
        if (!subpath || !current) throw new Error(`${describeXmlElement(element)} draws before M.`);
        const curve = command as CommandC;
        const end = { x: curve.x, y: curve.y };
        subpath.segments.push({
          kind: 'cubic',
          start: current,
          control1: { x: curve.x1, y: curve.y1 },
          control2: { x: curve.x2, y: curve.y2 },
          end,
        });
        current = end;
        break;
      }
      case SVGPathData.CLOSE_PATH: {
        if (!subpath || !current)
          throw new Error(`${describeXmlElement(element)} closes before M.`);
        const close = command as CommandZ;
        void close;
        subpath.closed = true;
        if (!samePoint(current, subpath.start)) {
          subpath.segments.push({ kind: 'line', start: current, end: subpath.start });
        }
        current = subpath.start;
        break;
      }
      default:
        throw new Error(
          `${describeXmlElement(element)} retains unsupported command type ${String(command.type)} after normalization.`,
        );
    }
  }

  if (subpaths.length === 0)
    throw new Error(`${describeXmlElement(element)} contains no M command.`);
  return subpaths.map((sourceSubpath) => ({
    start: applyMatrix(matrix, sourceSubpath.start),
    closed: sourceSubpath.closed,
    segments: sourceSubpath.segments.map((segment): Segment => {
      if (segment.kind === 'line') {
        return {
          kind: 'line',
          start: applyMatrix(matrix, segment.start),
          end: applyMatrix(matrix, segment.end),
        };
      }
      return {
        kind: 'cubic',
        start: applyMatrix(matrix, segment.start),
        control1: applyMatrix(matrix, segment.control1),
        control2: applyMatrix(matrix, segment.control2),
        end: applyMatrix(matrix, segment.end),
      };
    }),
  }));
}

function samePoint(left: Point, right: Point): boolean {
  return left.x === right.x && left.y === right.y;
}

function countryCode(context: SemanticContext, layer: SourceLayer): string | null {
  if (layer === 'lake') return null;
  const classCode = [...context.classes].reverse().find((token) => /^[a-z]{2}$/u.test(token));
  if (classCode) return classCode;
  return [...context.ids].reverse().find((id) => /^[a-z]{2}$/u.test(id)) ?? null;
}

function classifyPath(
  element: XmlElement,
):
  | { classification: 'geographic'; layer: SourceLayer; countryCode: string | null }
  | { classification: 'decorative'; reason: 'ocean' | 'circle' } {
  const context = inheritedSemanticContext(element);
  const classes = new Set(context.classes);
  const pathId = element.getAttribute('id');
  const ocean = pathId === 'ocean' || context.ids.includes('ocean') || classes.has('ocean');
  const circle = classes.has('circle');
  const land = classes.has('land');
  const lake = classes.has('lake');
  const categories = Number(ocean) + Number(circle) + Number(land) + Number(lake);

  if (categories !== 1) {
    throw new Error(
      `${describeXmlElement(element)} has ambiguous or missing inherited semantics: classes=${JSON.stringify(context.classes)}, ids=${JSON.stringify(context.ids)}.`,
    );
  }
  if (ocean) return { classification: 'decorative', reason: 'ocean' };
  if (circle) return { classification: 'decorative', reason: 'circle' };
  const layer: SourceLayer = lake ? 'lake' : 'land';
  const code = countryCode(context, layer);
  if (layer === 'land' && code === null) {
    throw new Error(
      `${describeXmlElement(element)} is land but has no inherited country/region code.`,
    );
  }
  return { classification: 'geographic', layer, countryCode: code };
}

function distance(left: Point, right: Point): number {
  return Math.hypot(right.x - left.x, right.y - left.y);
}

function pointToChordDistance(point: Point, start: Point, end: Point): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const denominator = Math.hypot(dx, dy);
  if (denominator === 0) return distance(point, start);
  return Math.abs(dy * point.x - dx * point.y + end.x * start.y - end.y * start.x) / denominator;
}

function midpoint(left: Point, right: Point): Point {
  return { x: (left.x + right.x) / 2, y: (left.y + right.y) / 2 };
}

function flattenLine(start: Point, end: Point, tolerance: number, output: number[]): void {
  const steps = Math.max(1, Math.ceil(distance(start, end) / Math.max(tolerance * 16, 1)));
  for (let step = 1; step <= steps; step += 1) {
    const t = step / steps;
    output.push(start.x + (end.x - start.x) * t, start.y + (end.y - start.y) * t);
  }
}

function flattenCubic(curve: CubicSegment, tolerance: number, output: number[], depth = 0): void {
  const flatness = Math.max(
    pointToChordDistance(curve.control1, curve.start, curve.end),
    pointToChordDistance(curve.control2, curve.start, curve.end),
  );
  if (
    (flatness <= tolerance && distance(curve.start, curve.end) <= MAX_SOURCE_SEGMENT_LENGTH) ||
    depth >= MAX_SUBDIVISION_DEPTH
  ) {
    output.push(curve.end.x, curve.end.y);
    return;
  }

  const p01 = midpoint(curve.start, curve.control1);
  const p12 = midpoint(curve.control1, curve.control2);
  const p23 = midpoint(curve.control2, curve.end);
  const p012 = midpoint(p01, p12);
  const p123 = midpoint(p12, p23);
  const p0123 = midpoint(p012, p123);
  flattenCubic(
    {
      kind: 'cubic',
      start: curve.start,
      control1: p01,
      control2: p012,
      end: p0123,
    },
    tolerance,
    output,
    depth + 1,
  );
  flattenCubic(
    {
      kind: 'cubic',
      start: p0123,
      control1: p123,
      control2: p23,
      end: curve.end,
    },
    tolerance,
    output,
    depth + 1,
  );
}

function flattenFeature(feature: ParsedFeature, tolerance: number): LodedFeature {
  const points: number[] = [];
  const subpaths: SourceMapSubpath[] = [];
  for (const subpath of feature.subpaths) {
    const pointOffset = points.length / 2;
    points.push(subpath.start.x, subpath.start.y);
    for (const segment of subpath.segments) {
      if (segment.kind === 'line') flattenLine(segment.start, segment.end, tolerance, points);
      else flattenCubic(segment, tolerance, points);
    }
    const pointCount = points.length / 2 - pointOffset;
    if (pointCount < 1) throw new Error(`Path ${feature.sourcePathId} contains an empty subpath.`);
    subpaths.push({ pointOffset, pointCount, closed: subpath.closed });
  }
  return { points, subpaths };
}

function appendFeature(
  target: number[],
  lodedFeature: LodedFeature,
  feature: ParsedFeature,
): SourceMapFeature {
  const pointOffset = target.length / 2;
  target.push(...lodedFeature.points);
  return {
    index: feature.index,
    layer: feature.layer,
    countryCode: feature.countryCode,
    sourcePathId: feature.sourcePathId,
    pointOffset,
    pointCount: lodedFeature.points.length / 2,
    subpaths: lodedFeature.subpaths.map((subpath) => ({
      ...subpath,
      pointOffset: pointOffset + subpath.pointOffset,
    })),
  };
}

function deriveCalibration(ocean: XmlElement, matrix: Matrix): CalibrationSnapshot {
  const subpaths = parsePath(ocean, matrix);
  const horizontalLengths = new Map<number, number>();
  const verticalLengths = new Map<number, number>();
  for (const subpath of subpaths) {
    for (const segment of subpath.segments) {
      if (segment.start.y === segment.end.y && segment.start.x !== segment.end.x) {
        const y = segment.start.y;
        horizontalLengths.set(
          y,
          (horizontalLengths.get(y) ?? 0) + Math.abs(segment.end.x - segment.start.x),
        );
      }
      if (segment.start.x === segment.end.x && segment.start.y !== segment.end.y) {
        const x = segment.start.x;
        verticalLengths.set(
          x,
          (verticalLengths.get(x) ?? 0) + Math.abs(segment.end.y - segment.start.y),
        );
      }
    }
  }
  const dominantCoordinates = (
    lengths: ReadonlyMap<number, number>,
    axis: string,
  ): [number, number] => {
    const coordinates = [...lengths.entries()]
      .sort((left, right) => right[1] - left[1] || left[0] - right[0])
      .slice(0, 2)
      .map(([coordinate]) => coordinate)
      .sort((left, right) => left - right);
    const minimum = coordinates[0];
    const maximum = coordinates[1];
    if (minimum === undefined || maximum === undefined || !(maximum > minimum)) {
      throw new Error(`Unable to derive ocean inner-frame ${axis} bounds.`);
    }
    return [minimum, maximum];
  };
  const [xMin, xMax] = dominantCoordinates(verticalLengths, 'X');
  const [yMin, yMax] = dominantCoordinates(horizontalLengths, 'Y');
  if (![xMin, xMax, yMin, yMax].every(Number.isFinite)) {
    throw new Error('Unable to derive finite ocean inner-frame bounds.');
  }
  return {
    version: 1,
    method: 'artistic-plate-carree',
    xMin,
    xMax,
    yMin,
    yMax,
    longitudeRange: [-180, 180],
    latitudeRange: [-90, 90],
    yAxis: 'down',
  };
}

function parseTitle(document: XmlDocument): string {
  const titles = document.getElementsByTagName('dc:title');
  return titles.item(0)?.textContent?.trim() || 'Blank World Map';
}

function encodeFloat32LE(values: readonly number[]): Uint8Array {
  const buffer = new ArrayBuffer(values.length * Float32Array.BYTES_PER_ELEMENT);
  const view = new DataView(buffer);
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === undefined || !Number.isFinite(value)) {
      throw new Error(`Non-finite point component at index ${index}.`);
    }
    view.setFloat32(index * Float32Array.BYTES_PER_ELEMENT, value, true);
  }
  return new Uint8Array(buffer);
}

function stableManifestBytes(manifest: SourceMapManifest): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(manifest, null, 2)}\n`);
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function compileSourceMap(svgBytes: Uint8Array): CompiledSourceMap {
  const source = new TextDecoder('utf-8', { fatal: true }).decode(svgBytes);
  const parserErrors: string[] = [];
  const document = new DOMParser({
    locator: true,
    onError: (level, message) => parserErrors.push(`${level}: ${message}`),
  }).parseFromString(source, 'image/svg+xml');
  if (parserErrors.length > 0)
    throw new Error(`SVG XML parsing failed:\n${parserErrors.join('\n')}`);
  const root = document.documentElement;
  if (!root || (root.localName ?? root.tagName) !== 'svg')
    throw new Error('Source root is not SVG.');

  const sourcePaths: Array<{ element: XmlElement; transform: Matrix }> = [];
  collectPaths(root, identity(), sourcePaths);
  if (sourcePaths.length !== EXPECTED_SOURCE_PATH_COUNT) {
    throw new Error(
      `Expected ${EXPECTED_SOURCE_PATH_COUNT} source paths, found ${sourcePaths.length}; classify the source change explicitly.`,
    );
  }

  const parsedFeatures: ParsedFeature[] = [];
  let decorativePathCount = 0;
  let oceanRecord: { element: XmlElement; transform: Matrix } | null = null;
  let landPathCount = 0;
  let lakePathCount = 0;

  for (const record of sourcePaths) {
    const classification = classifyPath(record.element);
    if (classification.classification === 'decorative') {
      decorativePathCount += 1;
      if (classification.reason === 'ocean') {
        if (oceanRecord) throw new Error('Source contains more than one ocean calibration path.');
        oceanRecord = record;
      }
      continue;
    }
    const sourcePathId = record.element.getAttribute('id');
    if (!sourcePathId)
      throw new Error(`${describeXmlElement(record.element)} has no source path id.`);
    if (classification.layer === 'land') landPathCount += 1;
    else lakePathCount += 1;
    parsedFeatures.push({
      index: parsedFeatures.length,
      layer: classification.layer,
      countryCode: classification.countryCode,
      sourcePathId,
      subpaths: parsePath(record.element, record.transform),
    });
  }

  if (!oceanRecord) throw new Error('The ocean path required for calibration was not found.');
  if (decorativePathCount !== EXPECTED_DECORATIVE_PATH_COUNT) {
    throw new Error(
      `Expected ${EXPECTED_DECORATIVE_PATH_COUNT} decorative paths, found ${decorativePathCount}; classify the source change explicitly.`,
    );
  }

  const calibration = deriveCalibration(oceanRecord.element, oceanRecord.transform);
  const globePoints: number[] = [];
  const detailPoints: number[] = [];
  const globeFeatures: SourceMapFeature[] = [];
  const detailFeatures: SourceMapFeature[] = [];
  for (const feature of parsedFeatures) {
    globeFeatures.push(
      appendFeature(globePoints, flattenFeature(feature, GLOBE_TOLERANCE), feature),
    );
    detailFeatures.push(
      appendFeature(detailPoints, flattenFeature(feature, DETAIL_TOLERANCE), feature),
    );
  }

  const stats: SourceStats = {
    sourcePathCount: sourcePaths.length,
    geographicPathCount: parsedFeatures.length,
    decorativePathCount,
    rejectedPathCount: 0,
    landPathCount,
    lakePathCount,
  };
  const manifest: SourceMapManifest = {
    formatVersion: 1,
    compilerVersion: COMPILER_VERSION,
    source: {
      file: SOURCE_FILE,
      sha256: sha256(svgBytes),
      license: 'Public Domain',
      title: parseTitle(document),
    },
    calibration,
    stats: {
      ...stats,
      globePointCount: globePoints.length / 2,
      detailPointCount: detailPoints.length / 2,
      nonFinitePointCount: 0,
    },
    lods: {
      globe: {
        file: GLOBE_FILE,
        pointCount: globePoints.length / 2,
        tolerance: GLOBE_TOLERANCE,
        features: globeFeatures,
      },
      detail: {
        file: DETAIL_FILE,
        pointCount: detailPoints.length / 2,
        tolerance: DETAIL_TOLERANCE,
        features: detailFeatures,
      },
    },
    features: detailFeatures,
  };
  return {
    manifest,
    globe: encodeFloat32LE(globePoints),
    detail: encodeFloat32LE(detailPoints),
  };
}

async function readOptional(file: string): Promise<Uint8Array | null> {
  try {
    return await readFile(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

function firstDifference(actual: Uint8Array, expected: Uint8Array): number {
  const sharedLength = Math.min(actual.length, expected.length);
  for (let index = 0; index < sharedLength; index += 1) {
    if (actual[index] !== expected[index]) return index;
  }
  return actual.length === expected.length ? -1 : sharedLength;
}

async function checkOutput(file: string, expected: Uint8Array): Promise<void> {
  const actual = await readOptional(file);
  if (!actual) throw new Error(`Generated output is missing: ${file}`);
  const difference = firstDifference(actual, expected);
  if (difference !== -1) {
    throw new Error(
      `Generated output is stale: ${file} differs at byte ${difference} (actual ${actual.length} bytes, expected ${expected.length} bytes).`,
    );
  }
}

export async function runCompiler(
  options: {
    rootDir?: string;
    check?: boolean;
  } = {},
): Promise<CompiledSourceMap> {
  const rootDir =
    options.rootDir ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const outputDir = path.join(rootDir, 'public', 'generated');
  const compiled = compileSourceMap(await readFile(path.join(rootDir, SOURCE_FILE)));
  const outputs: Array<[string, Uint8Array]> = [
    [path.join(outputDir, MANIFEST_FILE), stableManifestBytes(compiled.manifest)],
    [path.join(outputDir, GLOBE_FILE), compiled.globe],
    [path.join(outputDir, DETAIL_FILE), compiled.detail],
  ];

  if (options.check) {
    for (const [file, bytes] of outputs) await checkOutput(file, bytes);
  } else {
    await mkdir(outputDir, { recursive: true });
    for (const [file, bytes] of outputs) await writeFile(file, bytes);
  }
  return compiled;
}

async function main(): Promise<void> {
  const unknownArguments = process.argv.slice(2).filter((argument) => argument !== '--check');
  if (unknownArguments.length > 0) {
    throw new Error(`Unknown compiler argument(s): ${unknownArguments.join(', ')}`);
  }
  const check = process.argv.includes('--check');
  const compiled = await runCompiler({ check });
  const stats = compiled.manifest.stats;
  console.log(
    `${check ? 'Verified' : 'Compiled'} ${stats.sourcePathCount} paths: ` +
      `${stats.geographicPathCount} geographic (${stats.landPathCount} land, ${stats.lakePathCount} lake), ` +
      `${stats.decorativePathCount} decorative; ${stats.globePointCount} globe points, ` +
      `${stats.detailPointCount} detail points; SHA-256 ${compiled.manifest.source.sha256}.`,
  );
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(errorMessage(error));
    process.exitCode = 1;
  });
}
