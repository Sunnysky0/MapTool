import { useEffect, useMemo, useState } from 'react';
import { loadSourceMap } from '../core/assets/load-source-map';
import { geographicToSvg, svgToGeographic } from '../core/geo/calibration';
import type {
  CalibrationSnapshot,
  LoadedSourceMap,
  SourceMapFeature,
  SourceMapManifest,
  SourceMapSubpath,
} from '../types/source-map';
import './CalibrationHarness.css';

type AssetState<T> =
  { status: 'loading' } | { status: 'ready'; value: T } | { status: 'error'; message: string };

type OverlayMode = 'overlay' | 'difference';
type DataSpace = 'geographic' | 'source-svg';
type ViewId = 'world' | 'greenwich' | 'pacific' | 'north' | 'south' | 'sudan';

type LayerState = {
  original: boolean;
  detail: boolean;
  globe: boolean;
  land: boolean;
  lake: boolean;
  graticule: boolean;
};

interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface OriginalSource {
  image: HTMLImageElement;
  objectUrl: string;
  viewBox: Bounds;
  byteLength: number;
  sha256: string | null;
}

interface ViewPreset {
  id: ViewId;
  label: string;
  shortLabel: string;
  longitude: number;
  latitude: number;
  longitudeSpan: number;
  latitudeSpan: number;
}

interface PlanarViewportProps {
  original: OriginalSource | null;
  detail: LoadedSourceMap | null;
  layers: LayerState;
  mode: OverlayMode;
  originalOpacity: number;
  compiledOpacity: number;
  view: ViewPreset;
}

interface GlobeViewportProps {
  globe: LoadedSourceMap | null;
  layers: LayerState;
  view: ViewPreset;
}

const VIEW_PRESETS: readonly ViewPreset[] = [
  {
    id: 'world',
    label: 'World',
    shortLabel: 'World',
    longitude: 0,
    latitude: 0,
    longitudeSpan: 360,
    latitudeSpan: 180,
  },
  {
    id: 'greenwich',
    label: 'Greenwich',
    shortLabel: '0°',
    longitude: 0,
    latitude: 18,
    longitudeSpan: 84,
    latitudeSpan: 84,
  },
  {
    id: 'pacific',
    label: 'Pacific seam',
    shortLabel: '180°',
    longitude: 180,
    latitude: 2,
    longitudeSpan: 86,
    latitudeSpan: 86,
  },
  {
    id: 'north',
    label: 'North pole',
    shortLabel: 'N',
    longitude: 0,
    latitude: 90,
    longitudeSpan: 190,
    latitudeSpan: 62,
  },
  {
    id: 'south',
    label: 'South pole',
    shortLabel: 'S',
    longitude: 0,
    latitude: -90,
    longitudeSpan: 190,
    latitudeSpan: 62,
  },
  {
    id: 'sudan',
    label: 'Sudan / South Sudan',
    shortLabel: 'SD',
    longitude: 30.5,
    latitude: 10.5,
    longitudeSpan: 26,
    latitudeSpan: 22,
  },
];

const INITIAL_LAYERS: LayerState = {
  original: true,
  detail: true,
  globe: true,
  land: true,
  lake: true,
  graticule: true,
};

const NUMBER_FORMAT = new Intl.NumberFormat('en-US');

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function sha256Hex(value: string): Promise<string | null> {
  if (!globalThis.crypto?.subtle) return null;
  const bytes = new TextEncoder().encode(value);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function parseViewBox(svgText: string): Bounds {
  const documentNode = new DOMParser().parseFromString(svgText, 'image/svg+xml');
  if (documentNode.querySelector('parsererror')) {
    throw new Error('The source-map response is not valid SVG.');
  }
  const root = documentNode.documentElement;
  if (root.localName !== 'svg') {
    throw new Error('The /source_map.svg response did not contain an SVG document.');
  }
  const values = root
    .getAttribute('viewBox')
    ?.trim()
    .split(/[\s,]+/)
    .map(Number);
  if (!values || values.length !== 4 || values.some((value) => !Number.isFinite(value))) {
    throw new Error('The source SVG has no valid viewBox.');
  }
  const [x, y, width, height] = values as [number, number, number, number];
  if (width <= 0 || height <= 0) throw new Error('The source SVG viewBox is empty.');
  return { x, y, width, height };
}

async function decodeImage(source: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.decoding = 'async';
  image.src = source;
  await new Promise<void>((resolve, reject) => {
    image.addEventListener('load', () => resolve(), { once: true });
    image.addEventListener(
      'error',
      () => reject(new Error('The source SVG could not be decoded.')),
      {
        once: true,
      },
    );
  });
  return image;
}

async function loadOriginalSource(): Promise<OriginalSource> {
  const response = await fetch('/source_map.svg', { cache: 'no-store' });
  if (!response.ok)
    throw new Error(`HTTP ${String(response.status)} while loading /source_map.svg.`);
  const text = await response.text();
  const viewBox = parseViewBox(text);
  const objectUrl = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' }));
  try {
    const image = await decodeImage(objectUrl);
    return {
      image,
      objectUrl,
      viewBox,
      byteLength: new TextEncoder().encode(text).byteLength,
      sha256: await sha256Hex(text),
    };
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    throw error;
  }
}

function inferDataSpace(points: Float32Array): DataSpace {
  let xMin = Number.POSITIVE_INFINITY;
  let xMax = Number.NEGATIVE_INFINITY;
  let yMin = Number.POSITIVE_INFINITY;
  let yMax = Number.NEGATIVE_INFINITY;
  const stride = Math.max(2, Math.floor(points.length / 4096 / 2) * 2);
  for (let index = 0; index + 1 < points.length; index += stride) {
    const x = points[index];
    const y = points[index + 1];
    if (x === undefined || y === undefined || !Number.isFinite(x) || !Number.isFinite(y)) continue;
    xMin = Math.min(xMin, x);
    xMax = Math.max(xMax, x);
    yMin = Math.min(yMin, y);
    yMax = Math.max(yMax, y);
  }
  return xMin >= -180.5 && xMax <= 180.5 && yMin >= -90.5 && yMax <= 90.5
    ? 'geographic'
    : 'source-svg';
}

function pointToSource(
  x: number,
  y: number,
  dataSpace: DataSpace,
  calibration: CalibrationSnapshot,
): readonly [number, number] {
  if (dataSpace === 'source-svg') return [x, y];
  const source = geographicToSvg({ longitude: x, latitude: y }, calibration);
  return [source.x, source.y];
}

function pointToGeographic(
  x: number,
  y: number,
  dataSpace: DataSpace,
  calibration: CalibrationSnapshot,
): readonly [number, number] {
  if (dataSpace === 'geographic') return [x, y];
  const geographic = svgToGeographic({ x, y }, calibration);
  return [geographic.longitude, geographic.latitude];
}

function sourceSubpaths(feature: SourceMapFeature): readonly SourceMapSubpath[] {
  if (feature.subpaths.length > 0) return feature.subpaths;
  return [
    {
      pointOffset: feature.pointOffset,
      pointCount: feature.pointCount,
      closed: false,
    },
  ];
}

function absolutePointOffset(feature: SourceMapFeature, subpath: SourceMapSubpath): number {
  const isAbsolute =
    subpath.pointOffset >= feature.pointOffset &&
    subpath.pointOffset + subpath.pointCount <= feature.pointOffset + feature.pointCount;
  return isAbsolute ? subpath.pointOffset : feature.pointOffset + subpath.pointOffset;
}

function isLayerVisible(feature: SourceMapFeature, layers: LayerState): boolean {
  return feature.layer === 'land' ? layers.land : layers.lake;
}

function wrapSourceX(x: number, centerX: number, worldWidth: number): number {
  return x + Math.round((centerX - x) / worldWidth) * worldWidth;
}

function setupCanvas(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
  const bounds = canvas.getBoundingClientRect();
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.round(bounds.width * pixelRatio));
  const height = Math.max(1, Math.round(bounds.height * pixelRatio));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const context = canvas.getContext('2d');
  context?.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  return context;
}

function drawPlanarViewport(canvas: HTMLCanvasElement, props: PlanarViewportProps): void {
  const context = setupCanvas(canvas);
  if (!context) return;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  context.clearRect(0, 0, width, height);
  context.fillStyle = '#071114';
  context.fillRect(0, 0, width, height);

  const manifest = props.detail?.manifest;
  const calibration: CalibrationSnapshot | null =
    manifest?.calibration ??
    (props.original
      ? {
          version: 1,
          method: 'artistic-plate-carree',
          xMin: props.original.viewBox.x,
          xMax: props.original.viewBox.x + props.original.viewBox.width,
          yMin: props.original.viewBox.y,
          yMax: props.original.viewBox.y + props.original.viewBox.height,
          longitudeRange: [-180, 180],
          latitudeRange: [-90, 90],
          yAxis: 'down',
        }
      : null);
  if (!calibration) {
    context.fillStyle = '#849397';
    context.font = '12px ui-monospace, SFMono-Regular, Consolas, monospace';
    context.textAlign = 'center';
    context.fillText('Waiting for source or compiled detail data', width / 2, height / 2);
    return;
  }
  const worldWidth = calibration.xMax - calibration.xMin;
  const worldHeight = calibration.yMax - calibration.yMin;
  const center = geographicToSvg(
    { longitude: props.view.longitude, latitude: props.view.latitude },
    calibration,
  );
  const spanX = (props.view.longitudeSpan / 360) * worldWidth;
  const spanY = (props.view.latitudeSpan / 180) * worldHeight;
  const padding = Math.min(24, Math.max(10, Math.min(width, height) * 0.035));
  const scale = Math.min((width - padding * 2) / spanX, (height - padding * 2) / spanY);
  const screenX = (x: number) => width / 2 + (x - center.x) * scale;
  const screenY = (y: number) => height / 2 + (y - center.y) * scale;

  context.save();
  context.beginPath();
  context.rect(padding, padding, width - padding * 2, height - padding * 2);
  context.clip();

  if (props.layers.graticule) {
    const interval = props.view.longitudeSpan <= 30 ? 5 : props.view.longitudeSpan <= 100 ? 15 : 30;
    context.strokeStyle = 'rgba(130, 159, 164, 0.18)';
    context.lineWidth = 1;
    context.setLineDash([2, 5]);
    for (let longitude = -180; longitude <= 180; longitude += interval) {
      const source = geographicToSvg({ longitude, latitude: 0 }, calibration);
      const x = screenX(wrapSourceX(source.x, center.x, worldWidth));
      context.beginPath();
      context.moveTo(x, screenY(calibration.yMin));
      context.lineTo(x, screenY(calibration.yMax));
      context.stroke();
    }
    const latitudeInterval =
      props.view.latitudeSpan <= 30 ? 5 : props.view.latitudeSpan <= 100 ? 15 : 30;
    for (let latitude = -90; latitude <= 90; latitude += latitudeInterval) {
      const source = geographicToSvg({ longitude: props.view.longitude, latitude }, calibration);
      context.beginPath();
      context.moveTo(padding, screenY(source.y));
      context.lineTo(width - padding, screenY(source.y));
      context.stroke();
    }
    context.setLineDash([]);
  }

  if (props.layers.original && props.original) {
    context.save();
    context.globalAlpha = props.originalOpacity;
    for (let copy = -2; copy <= 2; copy += 1) {
      const x = props.original.viewBox.x + copy * worldWidth;
      context.drawImage(
        props.original.image,
        screenX(x),
        screenY(props.original.viewBox.y),
        props.original.viewBox.width * scale,
        props.original.viewBox.height * scale,
      );
    }
    context.restore();
  }

  if (props.layers.detail && props.detail && manifest) {
    const { points } = props.detail;
    const dataSpace = inferDataSpace(points);
    context.save();
    context.globalAlpha = props.compiledOpacity;
    context.globalCompositeOperation = props.mode === 'difference' ? 'difference' : 'source-over';
    context.lineWidth = Math.max(0.7, Math.min(1.45, scale * 0.8));
    context.lineCap = 'round';
    context.lineJoin = 'round';

    for (const feature of props.detail.manifest.lods.detail.features) {
      if (!isLayerVisible(feature, props.layers)) continue;
      context.strokeStyle =
        props.mode === 'difference' ? '#ffffff' : feature.layer === 'lake' ? '#34d7b5' : '#39c7ef';
      for (const subpath of sourceSubpaths(feature)) {
        const offset = absolutePointOffset(feature, subpath);
        const end = Math.min(offset + subpath.pointCount, points.length / 2);
        let hasPoint = false;
        let previousX = 0;
        context.beginPath();
        for (let pointIndex = Math.max(0, offset); pointIndex < end; pointIndex += 1) {
          const x = points[pointIndex * 2];
          const y = points[pointIndex * 2 + 1];
          if (x === undefined || y === undefined || !Number.isFinite(x) || !Number.isFinite(y)) {
            hasPoint = false;
            continue;
          }
          const source = pointToSource(x, y, dataSpace, calibration);
          const wrappedX = wrapSourceX(source[0], center.x, worldWidth);
          const outputX = screenX(wrappedX);
          const outputY = screenY(source[1]);
          if (!hasPoint || Math.abs(wrappedX - previousX) > worldWidth * 0.48) {
            context.moveTo(outputX, outputY);
          } else {
            context.lineTo(outputX, outputY);
          }
          previousX = wrappedX;
          hasPoint = true;
        }
        if (subpath.closed && hasPoint) context.closePath();
        context.stroke();
      }
    }
    context.restore();
  }

  context.restore();
  context.strokeStyle = 'rgba(182, 208, 211, 0.22)';
  context.lineWidth = 1;
  context.strokeRect(
    padding + 0.5,
    padding + 0.5,
    width - padding * 2 - 1,
    height - padding * 2 - 1,
  );

  context.fillStyle = 'rgba(7, 17, 20, 0.78)';
  context.fillRect(padding + 8, padding + 8, Math.min(280, width - padding * 2 - 16), 25);
  context.fillStyle = '#b8c9cc';
  context.font = '11px ui-monospace, SFMono-Regular, Consolas, monospace';
  context.textAlign = 'left';
  context.fillText(
    `${props.view.label.toUpperCase()}  ${formatCoordinate(props.view.longitude, 'longitude')} / ${formatCoordinate(props.view.latitude, 'latitude')}`,
    padding + 16,
    padding + 25,
  );
}

function projectOrthographic(
  longitude: number,
  latitude: number,
  centerLongitude: number,
  centerLatitude: number,
): readonly [number, number, number] {
  const radians = Math.PI / 180;
  const lambda = (longitude - centerLongitude) * radians;
  const phi = latitude * radians;
  const phi0 = centerLatitude * radians;
  const cosPhi = Math.cos(phi);
  const visibility = Math.sin(phi) * Math.sin(phi0) + cosPhi * Math.cos(phi0) * Math.cos(lambda);
  return [
    cosPhi * Math.sin(lambda),
    Math.sin(phi) * Math.cos(phi0) - cosPhi * Math.cos(lambda) * Math.sin(phi0),
    visibility,
  ];
}

function drawGlobeViewport(canvas: HTMLCanvasElement, props: GlobeViewportProps): void {
  const context = setupCanvas(canvas);
  if (!context) return;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  context.clearRect(0, 0, width, height);
  context.fillStyle = '#071114';
  context.fillRect(0, 0, width, height);

  if (!props.layers.globe) {
    context.fillStyle = '#67777b';
    context.font = '12px ui-monospace, SFMono-Regular, Consolas, monospace';
    context.textAlign = 'center';
    context.fillText('GLOBE LAYER DISABLED', width / 2, height / 2);
    return;
  }
  if (!props.globe) {
    context.fillStyle = '#849397';
    context.font = '12px ui-monospace, SFMono-Regular, Consolas, monospace';
    context.textAlign = 'center';
    context.fillText('Waiting for compiled globe data', width / 2, height / 2);
    return;
  }

  const radius = Math.max(20, Math.min(width, height) * 0.4);
  const centerX = width / 2;
  const centerY = height / 2;
  const project = (longitude: number, latitude: number) => {
    const value = projectOrthographic(
      longitude,
      latitude,
      props.view.longitude,
      props.view.latitude,
    );
    return [centerX + value[0] * radius, centerY - value[1] * radius, value[2]] as const;
  };

  context.beginPath();
  context.arc(centerX, centerY, radius, 0, Math.PI * 2);
  context.fillStyle = '#0a191d';
  context.fill();
  context.strokeStyle = 'rgba(172, 204, 208, 0.5)';
  context.lineWidth = 1;
  context.stroke();

  if (props.layers.graticule) {
    context.strokeStyle = 'rgba(126, 157, 161, 0.2)';
    context.lineWidth = 0.8;
    for (let longitude = -180; longitude < 180; longitude += 30) {
      context.beginPath();
      let drawing = false;
      for (let latitude = -90; latitude <= 90; latitude += 2) {
        const point = project(longitude, latitude);
        if (point[2] < 0) {
          drawing = false;
          continue;
        }
        if (!drawing) context.moveTo(point[0], point[1]);
        else context.lineTo(point[0], point[1]);
        drawing = true;
      }
      context.stroke();
    }
    for (let latitude = -60; latitude <= 60; latitude += 30) {
      context.beginPath();
      let drawing = false;
      for (let longitude = -180; longitude <= 180; longitude += 2) {
        const point = project(longitude, latitude);
        if (point[2] < 0) {
          drawing = false;
          continue;
        }
        if (!drawing) context.moveTo(point[0], point[1]);
        else context.lineTo(point[0], point[1]);
        drawing = true;
      }
      context.stroke();
    }
  }

  const { points, manifest } = props.globe;
  const dataSpace = inferDataSpace(points);
  context.lineCap = 'round';
  context.lineJoin = 'round';
  for (const feature of manifest.lods.globe.features) {
    if (!isLayerVisible(feature, props.layers)) continue;
    const code = feature.countryCode?.toLowerCase() ?? '';
    const isSudan = code === 'sd' || code === 'ss';
    context.strokeStyle =
      isSudan && props.view.id === 'sudan'
        ? '#ffd166'
        : feature.layer === 'lake'
          ? '#34d7b5'
          : '#d8e9eb';
    context.globalAlpha = isSudan && props.view.id === 'sudan' ? 1 : 0.78;
    context.lineWidth = isSudan && props.view.id === 'sudan' ? 2 : 0.9;
    for (const subpath of sourceSubpaths(feature)) {
      const offset = absolutePointOffset(feature, subpath);
      const end = Math.min(offset + subpath.pointCount, points.length / 2);
      let drawing = false;
      let previousLongitude: number | null = null;
      context.beginPath();
      for (let pointIndex = Math.max(0, offset); pointIndex < end; pointIndex += 1) {
        const x = points[pointIndex * 2];
        const y = points[pointIndex * 2 + 1];
        if (x === undefined || y === undefined || !Number.isFinite(x) || !Number.isFinite(y)) {
          drawing = false;
          previousLongitude = null;
          continue;
        }
        const geographic = pointToGeographic(x, y, dataSpace, manifest.calibration);
        const projected = project(geographic[0], geographic[1]);
        const crossesSeam =
          previousLongitude !== null && Math.abs(geographic[0] - previousLongitude) > 180;
        if (projected[2] < 0 || crossesSeam) {
          drawing = false;
          previousLongitude = geographic[0];
          continue;
        }
        if (!drawing) context.moveTo(projected[0], projected[1]);
        else context.lineTo(projected[0], projected[1]);
        drawing = true;
        previousLongitude = geographic[0];
      }
      if (subpath.closed && drawing) context.closePath();
      context.stroke();
    }
  }
  context.globalAlpha = 1;

  context.fillStyle = 'rgba(7, 17, 20, 0.78)';
  context.fillRect(12, 12, Math.min(210, width - 24), 25);
  context.fillStyle = '#b8c9cc';
  context.font = '11px ui-monospace, SFMono-Regular, Consolas, monospace';
  context.textAlign = 'left';
  context.fillText(`ORTHOGRAPHIC · ${props.view.label.toUpperCase()}`, 20, 29);
}

function useCanvasRenderer(
  draw: (canvas: HTMLCanvasElement) => void,
  dependencies: readonly unknown[],
): (canvas: HTMLCanvasElement | null) => void {
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  useEffect(() => {
    if (!canvas) return undefined;
    const render = () => draw(canvas);
    render();
    const observer = new ResizeObserver(render);
    observer.observe(canvas);
    return () => observer.disconnect();
    // The caller provides the complete renderer dependency list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvas, ...dependencies]);
  return setCanvas;
}

function PlanarViewport(props: PlanarViewportProps) {
  const canvasRef = useCanvasRenderer(
    (canvas) => drawPlanarViewport(canvas, props),
    [
      props.original,
      props.detail,
      props.layers,
      props.mode,
      props.originalOpacity,
      props.compiledOpacity,
      props.view,
    ],
  );
  return (
    <canvas
      ref={canvasRef}
      className="calibration-harness__canvas"
      aria-label="Planar source overlay"
    />
  );
}

function GlobeViewport(props: GlobeViewportProps) {
  const canvasRef = useCanvasRenderer(
    (canvas) => drawGlobeViewport(canvas, props),
    [props.globe, props.layers, props.view],
  );
  return (
    <canvas
      ref={canvasRef}
      className="calibration-harness__canvas"
      aria-label="Compiled globe preview"
    />
  );
}

function StatusPill({ label, state }: { label: string; state: AssetState<unknown> }) {
  return (
    <span
      className={`asset-pill asset-pill--${state.status}`}
      title={state.status === 'error' ? state.message : undefined}
    >
      <span className="asset-pill__dot" aria-hidden="true" />
      {label}
      <span className="asset-pill__status">{state.status}</span>
    </span>
  );
}

function LayerToggle({
  checked,
  disabled = false,
  label,
  detail,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  detail: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className={`layer-toggle${disabled ? ' layer-toggle--disabled' : ''}`}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
      <span className="layer-toggle__indicator" aria-hidden="true" />
      <span>
        <strong>{label}</strong>
        <small>{detail}</small>
      </span>
    </label>
  );
}

function InspectorRow({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="inspector-row">
      <dt>{label}</dt>
      <dd className={mono ? 'is-mono' : undefined}>{value}</dd>
    </div>
  );
}

function formatCoordinate(value: number, axis: 'longitude' | 'latitude'): string {
  if (value === 0) return axis === 'longitude' ? '0°' : '0°';
  const suffix = axis === 'longitude' ? (value < 0 ? 'W' : 'E') : value < 0 ? 'S' : 'N';
  return `${Math.abs(value).toFixed(1).replace('.0', '')}°${suffix}`;
}

function formatNumber(value: number | null | undefined): string {
  return value === null || value === undefined ? 'not reported' : NUMBER_FORMAT.format(value);
}

function formatBytes(value: number): string {
  if (value < 1024) return `${String(value)} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
  return `${(value / (1024 * 1024)).toFixed(2)} MiB`;
}

function extendedStat(manifest: SourceMapManifest, names: readonly string[]): number | null {
  const stats = manifest.stats as unknown as Record<string, unknown>;
  for (const name of names) {
    const value = stats[name];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return null;
}

function countSeamSplits(manifest: SourceMapManifest, points: Float32Array | null): number | null {
  if (!points) return null;
  const calibration = manifest.calibration;
  const dataSpace = inferDataSpace(points);
  let splitCount = 0;
  for (const feature of manifest.lods.globe.features) {
    for (const subpath of sourceSubpaths(feature)) {
      const offset = absolutePointOffset(feature, subpath);
      const end = Math.min(offset + subpath.pointCount, points.length / 2);
      let previousLongitude: number | null = null;
      for (let pointIndex = Math.max(0, offset); pointIndex < end; pointIndex += 1) {
        const x = points[pointIndex * 2];
        const y = points[pointIndex * 2 + 1];
        if (x === undefined || y === undefined || !Number.isFinite(x) || !Number.isFinite(y)) {
          previousLongitude = null;
          continue;
        }
        const longitude = pointToGeographic(x, y, dataSpace, calibration)[0];
        if (previousLongitude !== null && Math.abs(longitude - previousLongitude) > 180) {
          splitCount += 1;
        }
        previousLongitude = longitude;
      }
    }
  }
  return splitCount;
}

function manifestFrom(
  detail: AssetState<LoadedSourceMap>,
  globe: AssetState<LoadedSourceMap>,
): SourceMapManifest | null {
  if (detail.status === 'ready') return detail.value.manifest;
  if (globe.status === 'ready') return globe.value.manifest;
  return null;
}

function assetError(label: string, state: AssetState<unknown>) {
  if (state.status !== 'error') return null;
  return (
    <li>
      <strong>{label}</strong>
      <span>{state.message}</span>
    </li>
  );
}

export function CalibrationHarness() {
  const [original, setOriginal] = useState<AssetState<OriginalSource>>({ status: 'loading' });
  const [detail, setDetail] = useState<AssetState<LoadedSourceMap>>({ status: 'loading' });
  const [globe, setGlobe] = useState<AssetState<LoadedSourceMap>>({ status: 'loading' });
  const [layers, setLayers] = useState<LayerState>(INITIAL_LAYERS);
  const [mode, setMode] = useState<OverlayMode>('overlay');
  const [originalOpacity, setOriginalOpacity] = useState(0.55);
  const [compiledOpacity, setCompiledOpacity] = useState(0.92);
  const [viewId, setViewId] = useState<ViewId>('world');

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;

    void loadOriginalSource().then(
      (value) => {
        objectUrl = value.objectUrl;
        if (cancelled) URL.revokeObjectURL(value.objectUrl);
        else setOriginal({ status: 'ready', value });
      },
      (error: unknown) => {
        if (!cancelled) setOriginal({ status: 'error', message: errorMessage(error) });
      },
    );

    void loadSourceMap('detail').then(
      (value) => {
        if (!cancelled) setDetail({ status: 'ready', value });
      },
      (error: unknown) => {
        if (!cancelled) setDetail({ status: 'error', message: errorMessage(error) });
      },
    );

    void loadSourceMap('globe').then(
      (value) => {
        if (!cancelled) setGlobe({ status: 'ready', value });
      },
      (error: unknown) => {
        if (!cancelled) setGlobe({ status: 'error', message: errorMessage(error) });
      },
    );

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, []);

  const view = VIEW_PRESETS.find((preset) => preset.id === viewId) ?? VIEW_PRESETS[0]!;
  const manifest = manifestFrom(detail, globe);
  const detailValue = detail.status === 'ready' ? detail.value : null;
  const globeValue = globe.status === 'ready' ? globe.value : null;
  const originalValue = original.status === 'ready' ? original.value : null;
  const hasErrors =
    original.status === 'error' || detail.status === 'error' || globe.status === 'error';
  const manifestStats = useMemo(() => {
    if (!manifest) return null;
    const reportedSeamSplits = extendedStat(manifest, [
      'seamSplitCount',
      'seamSplitPathCount',
      'seamSplitSegmentCount',
    ]);
    return {
      dropped: extendedStat(manifest, [
        'droppedPathCount',
        'droppedFeatureCount',
        'rejectedPathCount',
      ]),
      seamSplit: reportedSeamSplits ?? countSeamSplits(manifest, globeValue?.points ?? null),
      seamSplitIsDerived: reportedSeamSplits === null,
    };
  }, [manifest, globeValue]);

  const setLayer = (layer: keyof LayerState, checked: boolean) => {
    setLayers((current) => ({ ...current, [layer]: checked }));
  };

  const hashMatches =
    originalValue?.sha256 && manifest?.source.sha256
      ? originalValue.sha256.toLowerCase() === manifest.source.sha256.toLowerCase()
      : null;

  return (
    <main className="calibration-harness">
      <header className="calibration-harness__header">
        <div className="calibration-harness__identity">
          <span className="calibration-harness__eyebrow">Development instrument</span>
          <h1>Source map calibration</h1>
        </div>
        <div className="calibration-harness__asset-status" aria-label="Asset status">
          <StatusPill label="SVG" state={original} />
          <StatusPill label="Detail" state={detail} />
          <StatusPill label="Globe" state={globe} />
        </div>
      </header>

      <nav className="view-strip" aria-label="Fixed calibration views">
        <span className="view-strip__label">Fixed views</span>
        {VIEW_PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            className={preset.id === view.id ? 'is-active' : undefined}
            aria-pressed={preset.id === view.id}
            title={`${preset.label}: ${formatCoordinate(preset.longitude, 'longitude')}, ${formatCoordinate(preset.latitude, 'latitude')}`}
            onClick={() => setViewId(preset.id)}
          >
            <span>{preset.label}</span>
            <small>{preset.shortLabel}</small>
          </button>
        ))}
      </nav>

      <div className="calibration-harness__body">
        <aside className="control-rail" aria-label="Overlay controls">
          <section className="control-section">
            <div className="control-section__heading">
              <h2>Layers</h2>
              <span>{Object.values(layers).filter(Boolean).length}/6</span>
            </div>
            <LayerToggle
              checked={layers.original}
              disabled={original.status !== 'ready'}
              label="Original SVG"
              detail="/source_map.svg"
              onChange={(checked) => setLayer('original', checked)}
            />
            <LayerToggle
              checked={layers.detail}
              disabled={detail.status !== 'ready'}
              label="Detail linework"
              detail="Flat re-projection"
              onChange={(checked) => setLayer('detail', checked)}
            />
            <LayerToggle
              checked={layers.globe}
              disabled={globe.status !== 'ready'}
              label="Globe linework"
              detail="Orthographic check"
              onChange={(checked) => setLayer('globe', checked)}
            />
            <div className="control-section__rule" />
            <LayerToggle
              checked={layers.land}
              disabled={!manifest}
              label="Land"
              detail="Semantic layer"
              onChange={(checked) => setLayer('land', checked)}
            />
            <LayerToggle
              checked={layers.lake}
              disabled={!manifest}
              label="Lakes"
              detail="Semantic layer"
              onChange={(checked) => setLayer('lake', checked)}
            />
            <LayerToggle
              checked={layers.graticule}
              disabled={!manifest}
              label="Graticule"
              detail="Reference only"
              onChange={(checked) => setLayer('graticule', checked)}
            />
          </section>

          <section className="control-section">
            <div className="control-section__heading">
              <h2>Comparison</h2>
            </div>
            <div className="segmented-control" aria-label="Overlay comparison mode">
              <button
                type="button"
                className={mode === 'overlay' ? 'is-active' : undefined}
                aria-pressed={mode === 'overlay'}
                onClick={() => setMode('overlay')}
              >
                Overlay
              </button>
              <button
                type="button"
                className={mode === 'difference' ? 'is-active' : undefined}
                aria-pressed={mode === 'difference'}
                onClick={() => setMode('difference')}
              >
                Difference
              </button>
            </div>
            <label className="range-control">
              <span>
                Original opacity <output>{Math.round(originalOpacity * 100)}%</output>
              </span>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={originalOpacity}
                onChange={(event) => setOriginalOpacity(event.currentTarget.valueAsNumber)}
              />
            </label>
            <label className="range-control">
              <span>
                Compiled opacity <output>{Math.round(compiledOpacity * 100)}%</output>
              </span>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={compiledOpacity}
                onChange={(event) => setCompiledOpacity(event.currentTarget.valueAsNumber)}
              />
            </label>
            <p className="control-section__note">
              Difference mode cancels matching white linework. Use equal opacities for the clearest
              residual.
            </p>
          </section>
        </aside>

        <section className="calibration-workspace" aria-label="Calibration comparison workspace">
          {hasErrors ? (
            <div className="asset-errors" role="status">
              <strong>Partial asset load</strong>
              <ul>
                {assetError('Original SVG', original)}
                {assetError('Detail LOD', detail)}
                {assetError('Globe LOD', globe)}
              </ul>
            </div>
          ) : null}
          <div className="calibration-workspace__planar">
            <div className="viewport-title">
              <span>01</span>
              <strong>Original / compiled detail</strong>
              <small>{mode}</small>
            </div>
            <PlanarViewport
              original={originalValue}
              detail={detailValue}
              layers={layers}
              mode={mode}
              originalOpacity={originalOpacity}
              compiledOpacity={compiledOpacity}
              view={view}
            />
            <div className="viewport-legend" aria-hidden="true">
              <span>
                <i className="legend-original" />
                Original
              </span>
              <span>
                <i className="legend-land" />
                Compiled land
              </span>
              <span>
                <i className="legend-lake" />
                Compiled lake
              </span>
            </div>
          </div>
          <div className="calibration-workspace__globe">
            <div className="viewport-title">
              <span>02</span>
              <strong>Compiled globe</strong>
              <small>{view.label}</small>
            </div>
            <GlobeViewport globe={globeValue} layers={layers} view={view} />
          </div>
        </section>

        <aside className="inspector" aria-label="Compiler and calibration information">
          <section className="inspector-section">
            <div className="inspector-section__heading">
              <h2>Provenance</h2>
              <span className={hashMatches === false ? 'status-bad' : 'status-good'}>
                {hashMatches === null ? 'unverified' : hashMatches ? 'hash match' : 'hash mismatch'}
              </span>
            </div>
            <dl>
              <InspectorRow
                label="Compiler"
                value={manifest?.compilerVersion ?? 'unavailable'}
                mono
              />
              <InspectorRow label="Source" value={manifest?.source.file ?? 'source_map.svg'} mono />
              <InspectorRow
                label="SHA-256"
                value={manifest?.source.sha256 ?? originalValue?.sha256 ?? 'unavailable'}
                mono
              />
              <InspectorRow label="License" value={manifest?.source.license ?? 'unavailable'} />
            </dl>
          </section>

          <section className="inspector-section">
            <div className="inspector-section__heading">
              <h2>Calibration</h2>
              <span>v{manifest?.calibration.version ?? '—'}</span>
            </div>
            <dl>
              <InspectorRow
                label="Method"
                value={manifest?.calibration.method ?? 'unavailable'}
                mono
              />
              <InspectorRow
                label="X bounds"
                value={
                  manifest
                    ? `${manifest.calibration.xMin.toFixed(4)} → ${manifest.calibration.xMax.toFixed(4)}`
                    : 'unavailable'
                }
                mono
              />
              <InspectorRow
                label="Y bounds"
                value={
                  manifest
                    ? `${manifest.calibration.yMin.toFixed(4)} → ${manifest.calibration.yMax.toFixed(4)}`
                    : 'unavailable'
                }
                mono
              />
              <InspectorRow
                label="Axis"
                value={manifest ? `Y ${manifest.calibration.yAxis}` : 'unavailable'}
                mono
              />
              <InspectorRow label="Longitude" value="−180° → 180°" mono />
              <InspectorRow label="Latitude" value="90° → −90°" mono />
            </dl>
          </section>

          <section className="inspector-section">
            <div className="inspector-section__heading">
              <h2>Compiler stats</h2>
              <span>manifest</span>
            </div>
            <dl className="stats-list">
              <InspectorRow
                label="Source paths"
                value={formatNumber(manifest?.stats.sourcePathCount)}
                mono
              />
              <InspectorRow
                label="Geographic"
                value={formatNumber(manifest?.stats.geographicPathCount)}
                mono
              />
              <InspectorRow
                label="Decorative"
                value={formatNumber(manifest?.stats.decorativePathCount)}
                mono
              />
              <InspectorRow
                label="Dropped / rejected"
                value={formatNumber(manifestStats?.dropped)}
                mono
              />
              <InspectorRow
                label="Non-finite"
                value={formatNumber(manifest?.stats.nonFinitePointCount)}
                mono
              />
              <InspectorRow
                label="Seam split"
                value={`${formatNumber(manifestStats?.seamSplit)}${manifestStats?.seamSplitIsDerived ? ' (derived)' : ''}`}
                mono
              />
              <InspectorRow
                label="Land paths"
                value={formatNumber(manifest?.stats.landPathCount)}
                mono
              />
              <InspectorRow
                label="Lake paths"
                value={formatNumber(manifest?.stats.lakePathCount)}
                mono
              />
              <InspectorRow
                label="Detail points"
                value={formatNumber(manifest?.stats.detailPointCount)}
                mono
              />
              <InspectorRow
                label="Globe points"
                value={formatNumber(manifest?.stats.globePointCount)}
                mono
              />
            </dl>
          </section>

          <section className="inspector-section inspector-section--runtime">
            <div className="inspector-section__heading">
              <h2>Loaded assets</h2>
              <span>runtime</span>
            </div>
            <dl>
              <InspectorRow
                label="Original"
                value={originalValue ? formatBytes(originalValue.byteLength) : original.status}
                mono
              />
              <InspectorRow
                label="Detail"
                value={
                  detailValue
                    ? `${formatBytes(detailValue.points.byteLength)} · ${inferDataSpace(detailValue.points)}`
                    : detail.status
                }
                mono
              />
              <InspectorRow
                label="Globe"
                value={
                  globeValue
                    ? `${formatBytes(globeValue.points.byteLength)} · ${inferDataSpace(globeValue.points)}`
                    : globe.status
                }
                mono
              />
            </dl>
          </section>
        </aside>
      </div>

      <footer className="calibration-harness__footer">
        <span>Deterministic dev view</span>
        <span>
          {view.label} · {formatCoordinate(view.longitude, 'longitude')} ·{' '}
          {formatCoordinate(view.latitude, 'latitude')}
        </span>
        <span className="calibration-harness__footer-path">
          /generated/source-map.manifest.json
        </span>
      </footer>
    </main>
  );
}

export default CalibrationHarness;
