import { useRef, useState } from 'react';
import { Download, FileCode2, FileJson, Layers, Loader2, Upload } from 'lucide-react';
import type { LayerData, LayerId, MapConfig } from '../types';
import { SIZE_PRESETS, defaultConfig, hydrateConfig } from '../lib/presets';
import { LAYER_DEFS, scenarioKey } from '../lib/data';
import { drawMap, renderSVG } from '../lib/render';
import { Button, NumberField, Row, Section, Select, Toggle } from './ui';

interface Props {
  config: MapConfig;
  data: Record<string, LayerData | undefined>;
  update: (fn: (c: MapConfig) => MapConfig, transient?: boolean) => void;
  replace: (c: MapConfig) => void;
  loadingCount: number;
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

const slug = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'map';
const filename = (s: string, fallback: string) => s.trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').replace(/[. ]+$/g, '') || fallback;
const layerFilename = (s: string) => filename(s, 'layer').replace(/\s+/g, '-');

export default function ExportPanel({ config, data, update, replace, loadingCount }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [scale, setScale] = useState(1);
  const [fileName, setFileName] = useState(() => config.scenario ? '世界政治地图-1939-01-01' : slug(config.title.text || 'map-art'));
  const [perLayer, setPerLayer] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const presetIdx = SIZE_PRESETS.findIndex((p) => p.width === config.width && p.height === config.height);
  const unavailable = busy !== null || !!(config.scenario && !data[scenarioKey(config.scenario)]?.scenario);

  const layerConfig = (id: LayerId): MapConfig => ({
    ...config,
    transparentBackground: true,
    vignette: 0,
    grain: 0,
    title: { ...config.title, text: '', subtitle: '' },
    layers: Object.fromEntries(LAYER_DEFS.map((def) => [def.id, { ...config.layers[def.id], visible: def.id === id }])) as MapConfig['layers'],
  });

  const visibleLayers = () => LAYER_DEFS.filter((def) => config.layers[def.id].visible);

  const exportPNG = async () => {
    setBusy('png');
    await new Promise((r) => setTimeout(r, 30));
    try {
      const w = Math.round(config.width * scale);
      const h = Math.round(config.height * scale);
      try {
        await Promise.all([
          document.fonts.load(`500 40px "${config.title.font}"`),
          document.fonts.load('400 40px "Noto Serif"'),
          document.fonts.load('400 40px "Noto Serif SC"'),
          document.fonts.load('500 40px "Noto Serif SC"'),
        ]);
      } catch {
        /* ignore */
      }
      const layers = perLayer ? visibleLayers() : [{ id: undefined, name: '' }];
      for (const layer of layers) {
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('no canvas');
        drawMap(ctx, { config: layer.id ? layerConfig(layer.id) : config, data, width: w, height: h });
        const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'));
        if (blob) download(blob, `${filename(fileName, 'map')}${layer.id ? `-${layerFilename(layer.name)}` : ''}-${w}x${h}.png`);
        if (layers.length > 1) await new Promise((r) => setTimeout(r, 100));
      }
    } finally {
      setBusy(null);
    }
  };

  const exportSVG = async () => {
    setBusy('svg');
    await new Promise((r) => setTimeout(r, 30));
    try {
      const layers = perLayer ? visibleLayers() : [{ id: undefined, name: '' }];
      for (const layer of layers) {
        const svg = renderSVG({ config: layer.id ? layerConfig(layer.id) : config, data, width: config.width, height: config.height });
        download(new Blob([svg], { type: 'image/svg+xml' }), `${filename(fileName, 'map')}${layer.id ? `-${layerFilename(layer.name)}` : ''}.svg`);
        if (layers.length > 1) await new Promise((r) => setTimeout(r, 100));
      }
    } finally {
      setBusy(null);
    }
  };

  const exportJSON = () => download(new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' }), `${filename(fileName, 'map')}-style.json`);

  const importJSON = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result)) as Partial<MapConfig>;
        replace(hydrateConfig(parsed));
      } catch {
        alert('Could not read that file.');
      }
    };
    reader.readAsText(file);
  };

  return (
    <div>
      <Section title="Canvas size">
        <Select<number>
          value={presetIdx}
          onChange={(i) => {
            if (i >= 0) update((c) => ({ ...c, width: SIZE_PRESETS[i].width, height: SIZE_PRESETS[i].height }));
          }}
          options={[{ value: -1, label: 'Custom' }, ...SIZE_PRESETS.map((p, i) => ({ value: i, label: p.name }))]}
          className="w-full"
        />
        <div className="flex items-center gap-2">
          <NumberField value={config.width} onChange={(n) => n >= 100 && n <= 12000 && update((c) => ({ ...c, width: Math.round(n) }))} className="flex-1" suffix="px" />
          <span className="text-xs text-zinc-500">×</span>
          <NumberField value={config.height} onChange={(n) => n >= 100 && n <= 12000 && update((c) => ({ ...c, height: Math.round(n) }))} className="flex-1" suffix="px" />
        </div>
        <div className="flex gap-1.5">
          {[
            ['16:9', 16 / 9],
            ['3:2', 3 / 2],
            ['4:3', 4 / 3],
            ['1:1', 1],
            ['4:5', 4 / 5],
            ['9:16', 9 / 16],
          ].map(([label, r]) => (
            <button
              key={label as string}
              onClick={() => update((c) => ({ ...c, height: Math.round(c.width / (r as number)) }))}
              className="flex-1 rounded-md border border-white/10 bg-white/5 py-1 text-[10px] text-zinc-300 hover:bg-white/10"
            >
              {label}
            </button>
          ))}
        </div>
        <p className="text-[10px] leading-relaxed text-zinc-500">Line widths are relative to the canvas, so the exported image looks exactly like the preview.</p>
      </Section>

      <Section title="Export image">
        <div>
          <label htmlFor="export-filename" className="mb-1 block text-xs text-zinc-300">File name</label>
          <input
            id="export-filename"
            value={fileName}
            onChange={(e) => setFileName(e.target.value)}
            placeholder="map-art"
            className="w-full rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-zinc-200 outline-none focus:border-amber-400/60"
          />
          <p className="mt-1 text-[10px] text-zinc-500">The extension and image size are added automatically.</p>
        </div>
        <Row label="PNG scale" hint={`${Math.round(config.width * scale)} × ${Math.round(config.height * scale)} px`}>
          <Select<number> value={scale} onChange={setScale} options={[0.5, 1, 1.5, 2].map((s) => ({ value: s, label: `${s}×` }))} />
        </Row>
        <Row label="Export each visible layer" hint={perLayer ? `${visibleLayers().length} files per format` : 'One complete image'}>
          <Toggle checked={perLayer} onChange={setPerLayer} />
        </Row>
        {loadingCount > 0 && <div className="rounded-md border border-amber-400/30 bg-amber-400/10 px-2 py-1.5 text-[11px] text-amber-200">Still loading {loadingCount} layer{loadingCount > 1 ? 's' : ''} — wait for a complete export.</div>}
        <Button variant="primary" onClick={exportPNG} disabled={unavailable} className="w-full py-2">
          {busy === 'png' ? <Loader2 className="h-4 w-4 animate-spin" /> : perLayer ? <Layers className="h-4 w-4" /> : <Download className="h-4 w-4" />} {perLayer ? 'Export PNG layers' : 'Download PNG'}
        </Button>
        <Button onClick={exportSVG} disabled={unavailable} className="w-full py-2">
          {busy === 'svg' ? <Loader2 className="h-4 w-4 animate-spin" /> : perLayer ? <Layers className="h-4 w-4" /> : <FileCode2 className="h-4 w-4" />} {perLayer ? 'Export SVG layers' : 'Download SVG (vector)'}
        </Button>
      </Section>

      <Section title="Save & load style">
        <div className="flex gap-2">
          <Button onClick={exportJSON} className="flex-1">
            <FileJson className="h-3.5 w-3.5" /> Save JSON
          </Button>
          <Button onClick={() => fileRef.current?.click()} className="flex-1">
            <Upload className="h-3.5 w-3.5" /> Load JSON
          </Button>
          <input ref={fileRef} type="file" accept="application/json" className="hidden" onChange={(e) => {const file=e.target.files?.[0];if(file) importJSON(file);e.target.value='';}} />
        </div>
        <Button variant="ghost" onClick={() => confirm('Reset everything to defaults?') && replace(defaultConfig())} className="w-full text-red-300 hover:bg-red-500/10">
          Reset to defaults
        </Button>
      </Section>
    </div>
  );
}
