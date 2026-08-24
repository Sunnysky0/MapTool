import { DOMParser } from '@xmldom/xmldom';
import { describe, expect, it } from 'vitest';
import type { RenderPlan } from '../render/render-plan';
import { buildSvg } from './buildSvg';

function renderPlan(background: string | null = null): RenderPlan {
  return {
    revision: 1,
    width: 320,
    height: 180,
    projectionId: 'mercator',
    sourceHash: 'source-hash',
    boundary: [],
    lineRuns: [
      {
        layer: 'map-linework',
        countryCode: 'GB<&"',
        sourcePathId: 'coast<&"',
        points: [
          { x: 1, y: 2 },
          { x: 3.5, y: 4 },
        ],
      },
      {
        layer: 'graticule',
        points: [
          { x: 0, y: 90 },
          { x: 320, y: 90 },
        ],
      },
      {
        layer: 'extent-frame',
        points: [
          { x: 0, y: 0 },
          { x: 320, y: 0 },
          { x: 320, y: 180 },
          { x: 0, y: 180 },
        ],
        closed: true,
      },
    ],
    style: {
      lineColor: '#123<&"',
      lineWidth: 1.5,
      lineOpacity: 0.75,
      lineCap: 'round',
      lineJoin: 'bevel',
      background,
      graticuleColor: '#aaa',
      graticuleWidth: 0.5,
      graticuleOpacity: 0.4,
      extentColor: '#111',
      extentWidth: 2,
    },
    warnings: [],
    stats: { inputPoints: 8, outputPoints: 8, elapsedMs: 1 },
  };
}

function parse(svg: string): ReturnType<DOMParser['parseFromString']> {
  return new DOMParser().parseFromString(svg, 'image/svg+xml');
}

describe('buildSvg', () => {
  it('builds deterministic standalone SVG with ordered layer groups', () => {
    const plan = renderPlan();
    const first = buildSvg(plan);
    const second = buildSvg(plan);

    expect(first).toBe(second);
    expect(first).toContain(
      '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180">',
    );
    expect(first.indexOf('id="map-linework"')).toBeLessThan(first.indexOf('id="graticule"'));
    expect(first.indexOf('id="graticule"')).toBeLessThan(first.indexOf('id="extent-frame"'));
    expect(first).not.toMatch(/(?:href|src)=/);

    const document = parse(first);
    expect(document.getElementsByTagName('parsererror')).toHaveLength(0);
    expect(document.getElementById('map-linework')).not.toBeNull();
    expect(document.getElementById('graticule')).not.toBeNull();
    expect(document.getElementById('extent-frame')).not.toBeNull();
  });

  it('omits a background rect for alpha and emits it first for a color', () => {
    expect(parse(buildSvg(renderPlan())).getElementById('background')).toBeNull();

    const svg = buildSvg(renderPlan('rgba(1, 2, 3, 0.5)'));
    expect(svg.indexOf('id="background"')).toBeLessThan(svg.indexOf('id="map-linework"'));
    expect(parse(svg).getElementById('background')?.getAttribute('fill')).toBe(
      'rgba(1, 2, 3, 0.5)',
    );
  });

  it('escapes metadata and style attributes while creating safe unique ids', () => {
    const plan = renderPlan();
    plan.lineRuns.push(
      {
        layer: 'map-linework',
        countryCode: 'GB-&',
        sourcePathId: 'second',
        points: [
          { x: 5, y: 6 },
          { x: 7, y: 8 },
        ],
      },
      {
        layer: 'map-linework',
        countryCode: 'GB &',
        sourcePathId: 'third',
        points: [
          { x: 9, y: 10 },
          { x: 11, y: 12 },
        ],
      },
    );

    const svg = buildSvg(plan);
    expect(svg).toContain('data-country-code="GB&lt;&amp;&quot;"');
    expect(svg).toContain('data-source-path-id="coast&lt;&amp;&quot;"');
    expect(svg).toContain('stroke="#123&lt;&amp;&quot;"');

    const document = parse(svg);
    expect(document.getElementsByTagName('parsererror')).toHaveLength(0);
    const countryGroups = Array.from(document.getElementsByTagName('g')).filter((node) =>
      node.hasAttribute('data-country-code'),
    );
    expect(countryGroups.map((node) => node.getAttribute('id'))).toEqual([
      'country-GB',
      'country-GB-2',
      'country-GB-3',
    ]);
    expect(countryGroups[0]?.getAttribute('data-country-code')).toBe('GB<&"');
    expect(
      countryGroups[0]?.getElementsByTagName('path')[0]?.getAttribute('data-source-path-id'),
    ).toBe('coast<&"');
  });
});
