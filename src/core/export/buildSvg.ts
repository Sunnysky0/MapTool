import type { RenderLineRun, RenderPlan } from '../render/render-plan';
import { downloadBlob } from '../utils/download';

const SVG_LAYERS: RenderLineRun['layer'][] = ['map-linework', 'graticule', 'extent-frame'];

function assertFiniteNumber(value: number, field: string): void {
  if (!Number.isFinite(value)) {
    throw new TypeError(`${field} must be a finite number.`);
  }
}

function formatNumber(value: number): string {
  return Object.is(value, -0) ? '0' : String(value);
}

function validXmlText(value: string): string {
  // XML 1.0 excludes most C0 controls, even when escaped as character references.
  let result = '';
  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    const excludedControl =
      codePoint < 0x20 && codePoint !== 0x09 && codePoint !== 0x0a && codePoint !== 0x0d;
    result += excludedControl ? '�' : character;
  }
  return result;
}

function escapeXmlAttribute(value: string): string {
  return validXmlText(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function safeIdPart(value: string): string {
  const safe = validXmlText(value)
    .normalize('NFKC')
    .replace(/[^A-Za-z0-9_.-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return safe || 'unknown';
}

function pathData(run: RenderLineRun, runIndex: number): string | null {
  if (run.points.length < 2) return null;

  for (let pointIndex = 0; pointIndex < run.points.length; pointIndex += 1) {
    const point = run.points[pointIndex]!;
    assertFiniteNumber(point.x, `lineRuns[${runIndex}].points[${pointIndex}].x`);
    assertFiniteNumber(point.y, `lineRuns[${runIndex}].points[${pointIndex}].y`);
  }

  const [first, ...rest] = run.points;
  let data = `M ${formatNumber(first!.x)} ${formatNumber(first!.y)}`;
  for (const point of rest) {
    data += ` L ${formatNumber(point.x)} ${formatNumber(point.y)}`;
  }
  if (run.closed) data += ' Z';
  return data;
}

function pathElement(run: RenderLineRun, data: string): string {
  const sourcePath = run.sourcePathId
    ? ` data-source-path-id="${escapeXmlAttribute(run.sourcePathId)}"`
    : '';
  return `    <path${sourcePath} d="${data}" />`;
}

function layerStyle(plan: RenderPlan, layer: RenderLineRun['layer']): string {
  const { style } = plan;
  if (layer === 'graticule') {
    return `fill="none" stroke="${escapeXmlAttribute(style.graticuleColor)}" stroke-width="${formatNumber(style.graticuleWidth)}" stroke-opacity="${formatNumber(style.graticuleOpacity)}" stroke-linecap="${style.lineCap}" stroke-linejoin="${style.lineJoin}"`;
  }
  if (layer === 'extent-frame') {
    return `fill="none" stroke="${escapeXmlAttribute(style.extentColor)}" stroke-width="${formatNumber(style.extentWidth)}" stroke-linecap="${style.lineCap}" stroke-linejoin="${style.lineJoin}"`;
  }
  return `fill="none" stroke="${escapeXmlAttribute(style.lineColor)}" stroke-width="${formatNumber(style.lineWidth)}" stroke-opacity="${formatNumber(style.lineOpacity)}" stroke-linecap="${style.lineCap}" stroke-linejoin="${style.lineJoin}"`;
}

function buildMapLinework(
  runs: Array<{ run: RenderLineRun; data: string }>,
  plan: RenderPlan,
): string[] {
  const lines = [`  <g id="map-linework" ${layerStyle(plan, 'map-linework')}>`];
  const countries = new Map<string, Array<{ run: RenderLineRun; data: string }>>();
  const ungrouped: Array<{ run: RenderLineRun; data: string }> = [];

  for (const item of runs) {
    if (item.run.countryCode) {
      const countryRuns = countries.get(item.run.countryCode) ?? [];
      countryRuns.push(item);
      countries.set(item.run.countryCode, countryRuns);
    } else {
      ungrouped.push(item);
    }
  }

  const usedIds = new Set<string>();
  for (const [countryCode, countryRuns] of countries) {
    const idBase = `country-${safeIdPart(countryCode)}`;
    let id = idBase;
    let suffix = 2;
    while (usedIds.has(id)) {
      id = `${idBase}-${suffix}`;
      suffix += 1;
    }
    usedIds.add(id);
    lines.push(`    <g id="${id}" data-country-code="${escapeXmlAttribute(countryCode)}">`);
    for (const { run, data } of countryRuns) {
      lines.push(`  ${pathElement(run, data)}`);
    }
    lines.push('    </g>');
  }

  for (const { run, data } of ungrouped) {
    lines.push(pathElement(run, data));
  }
  lines.push('  </g>');
  return lines;
}

function buildSimpleLayer(
  layer: Exclude<RenderLineRun['layer'], 'map-linework'>,
  runs: Array<{ run: RenderLineRun; data: string }>,
  plan: RenderPlan,
): string[] {
  const lines = [`  <g id="${layer}" ${layerStyle(plan, layer)}>`];
  for (const { run, data } of runs) {
    lines.push(pathElement(run, data));
  }
  lines.push('  </g>');
  return lines;
}

export function buildSvg(plan: RenderPlan): string {
  assertFiniteNumber(plan.width, 'width');
  assertFiniteNumber(plan.height, 'height');
  if (plan.width <= 0 || plan.height <= 0) {
    throw new RangeError('SVG width and height must be greater than zero.');
  }

  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" width="${formatNumber(plan.width)}" height="${formatNumber(plan.height)}" viewBox="0 0 ${formatNumber(plan.width)} ${formatNumber(plan.height)}">`,
  ];

  if (plan.style.background) {
    lines.push(
      `  <rect id="background" x="0" y="0" width="${formatNumber(plan.width)}" height="${formatNumber(plan.height)}" fill="${escapeXmlAttribute(plan.style.background)}" />`,
    );
  }

  const layerRuns = new Map(
    SVG_LAYERS.map((layer) => [layer, [] as Array<{ run: RenderLineRun; data: string }>]),
  );
  for (let index = 0; index < plan.lineRuns.length; index += 1) {
    const run = plan.lineRuns[index]!;
    const data = pathData(run, index);
    if (data) layerRuns.get(run.layer)!.push({ run, data });
  }

  lines.push(...buildMapLinework(layerRuns.get('map-linework')!, plan));
  lines.push(...buildSimpleLayer('graticule', layerRuns.get('graticule')!, plan));
  lines.push(...buildSimpleLayer('extent-frame', layerRuns.get('extent-frame')!, plan));
  lines.push('</svg>');
  return `${lines.join('\n')}\n`;
}

export function svgBlob(plan: RenderPlan): Blob {
  return new Blob([buildSvg(plan)], { type: 'image/svg+xml;charset=utf-8' });
}

export function downloadSvg(plan: RenderPlan, filename = 'map.svg'): void {
  downloadBlob(svgBlob(plan), filename);
}
