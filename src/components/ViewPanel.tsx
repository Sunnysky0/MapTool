import { useState } from 'react';
import { Loader2, Search } from 'lucide-react';
import type { MapConfig, ProjectionId, ViewState } from '../types';
import { PROJECTIONS, getProjectionDef } from '../lib/projections';
import { LOCATIONS } from '../lib/presets';
import { clampView } from '../lib/view';
import { Button, NumberField, Row, Section, Select } from './ui';

interface Props {
  config: MapConfig;
  update: (fn: (c: MapConfig) => MapConfig, transient?: boolean) => void;
}

export default function ViewPanel({ config, update }: Props) {
  const v = config.view;
  const setView = (patch: Partial<ViewState>) => update((c) => ({ ...c, view: clampView({ ...c.view, ...patch }) }));
  const [q, setQ] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchMsg, setSearchMsg] = useState<string | null>(null);

  const search = async () => {
    if (!q.trim()) return;
    setSearching(true);
    setSearchMsg(null);
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q.trim())}`, {
        headers: { Accept: 'application/json' },
      });
      const json = (await res.json()) as Array<{ lat: string; lon: string; boundingbox: string[]; display_name: string }>;
      if (!json.length) {
        setSearchMsg('No results');
        return;
      }
      const r = json[0];
      const [s, n, w, e] = r.boundingbox.map(Number);
      const span = Math.max(Math.abs(e - w), Math.abs(n - s) * (config.width / config.height), 0.02);
      const zoom = Math.min(600, Math.max(0.5, (360 / span) * 0.55));
      const def = getProjectionDef(v.projection);
      setView({ lon: Number(r.lon), lat: Number(r.lat), zoom: def.globe ? Math.min(zoom, 60) : zoom });
      setSearchMsg(r.display_name.split(',').slice(0, 2).join(','));
    } catch {
      setSearchMsg('Search unavailable (offline?)');
    } finally {
      setSearching(false);
    }
  };

  return (
    <div>
      <Section title="Go to place">
        <div className="flex gap-2">
          <div className="flex flex-1 items-center gap-2 rounded-md border border-white/10 bg-white/5 px-2 focus-within:border-amber-400/60">
            <Search className="h-3.5 w-3.5 text-zinc-500" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && search()}
              placeholder="City, country, sea…"
              className="w-full bg-transparent py-1.5 text-xs text-zinc-100 outline-none placeholder:text-zinc-600"
            />
          </div>
          <Button onClick={search} disabled={searching}>
            {searching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Go'}
          </Button>
        </div>
        {searchMsg && <div className="text-[10px] text-zinc-500">{searchMsg}</div>}
      </Section>

      <Section title="Bookmarks">
        <div className="flex flex-wrap gap-1.5">
          {LOCATIONS.map((l) => (
            <button key={l.id} onClick={() => setView(l.view)} className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-zinc-200 hover:border-amber-400/60 hover:bg-white/10">
              {l.name}
            </button>
          ))}
        </div>
      </Section>

      <Section title="Projection">
        <Select<ProjectionId>
          value={v.projection}
          onChange={(p) => setView({ projection: p })}
          options={PROJECTIONS.map((p) => ({ value: p.id, label: p.name, group: p.group }))}
          className="w-full"
        />
        <div className="text-[10px] text-zinc-500">{getProjectionDef(v.projection).hint}</div>
      </Section>

      <Section title="Camera">
        <Row label="Longitude">
          <NumberField value={v.lon} onChange={(n) => setView({ lon: n })} step={1} className="w-24" suffix="°" />
        </Row>
        <Row label="Latitude">
          <NumberField value={v.lat} onChange={(n) => setView({ lat: n })} step={1} className="w-24" suffix="°" />
        </Row>
        <Row label="Zoom">
          <NumberField value={v.zoom} onChange={(n) => setView({ zoom: n })} step={0.1} min={0.25} className="w-24" suffix="×" />
        </Row>
        <Row label="Rotation">
          <NumberField value={v.angle} onChange={(n) => setView({ angle: n })} step={1} className="w-24" suffix="°" />
        </Row>
        <div className="flex gap-2">
          <Button onClick={() => setView({ angle: 0 })} className="flex-1">
            Straighten
          </Button>
          <Button onClick={() => setView({ lon: 10, lat: 0, zoom: 1, angle: 0 })} className="flex-1">
            Whole world
          </Button>
        </div>
      </Section>

      <Section title="Controls" defaultOpen={false}>
        <ul className="space-y-1 text-[11px] text-zinc-400">
          <li><b className="text-zinc-200">Drag</b> — move the map</li>
          <li><b className="text-zinc-200">Scroll / pinch</b> — zoom at the cursor</li>
          <li><b className="text-zinc-200">Shift + drag</b> or right-drag — rotate around the centre</li>
          <li><b className="text-zinc-200">Alt + scroll</b> or two-finger twist — rotate</li>
          <li><b className="text-zinc-200">Double-click</b> — zoom in (Shift: out)</li>
          <li><b className="text-zinc-200">Arrow keys</b> pan · <b className="text-zinc-200">+ / −</b> zoom · <b className="text-zinc-200">Q / E</b> rotate · <b className="text-zinc-200">0</b> straighten</li>
          <li><b className="text-zinc-200">Ctrl/⌘ + Z</b> undo · <b className="text-zinc-200">Ctrl/⌘ + Shift + Z</b> redo</li>
        </ul>
      </Section>
    </div>
  );
}
