import type { MapConfig, TitlePosition } from '../types';
import { applyTheme, FONTS, THEMES } from '../lib/presets';
import { LAYER_DEFS } from '../lib/data';
import { cn } from '../utils/cn';
import { ColorField, Row, Section, Segmented, Select, Slider, Toggle } from './ui';

interface Props {
  config: MapConfig;
  update: (fn: (c: MapConfig) => MapConfig, transient?: boolean) => void;
  commit: () => void;
}

const POSITIONS: TitlePosition[] = ['top-left', 'top-center', 'top-right', 'center', 'bottom-left', 'bottom-center', 'bottom-right'];

export default function StylePanel({ config, update, commit }: Props) {
  const setTitle = (patch: Partial<MapConfig['title']>, transient = false) => update((c) => ({ ...c, title: { ...c.title, ...patch } }), transient);

  const setAllLineColors = (color: string) =>
    update((c) => {
      const layers = { ...c.layers };
      for (const d of LAYER_DEFS) layers[d.id] = { ...layers[d.id], color };
      return { ...c, layers };
    });

  const scaleAllWidths = (factor: number) =>
    update((c) => {
      const layers = { ...c.layers };
      for (const d of LAYER_DEFS) layers[d.id] = { ...layers[d.id], width: Math.round(layers[d.id].width * factor * 100) / 100 };
      return { ...c, layers };
    });

  return (
    <div>
      <Section title="Themes">
        <div className="grid grid-cols-3 gap-2">
          {THEMES.map((t) => (
            <button
              key={t.id}
              onClick={() => update((c) => applyTheme(c, t))}
              className={cn('group overflow-hidden rounded-lg border border-white/10 text-left transition hover:border-amber-400/60', config.background === t.background && 'border-amber-400/80')}
              title={t.name}
            >
              <div className="relative h-12" style={{ background: t.gradient ? `linear-gradient(135deg, ${t.background}, ${t.gradient})` : t.background }}>
                <svg viewBox="0 0 60 30" className="absolute inset-0 h-full w-full">
                  <path d="M2 20 C 10 10, 18 26, 28 16 S 44 6, 58 14" fill="none" stroke={t.line} strokeWidth="1" />
                  <path d="M6 8 C 14 12, 22 4, 34 9" fill="none" stroke={t.accent} strokeWidth="0.8" strokeDasharray="2 1.5" />
                  <circle cx="44" cy="22" r="1.3" fill={t.accent2} />
                </svg>
              </div>
              <div className="px-2 py-1 text-[10px] text-zinc-300">{t.name}</div>
            </button>
          ))}
        </div>
      </Section>

      <Section title="Background">
        <Row label="Color">
          <ColorField value={config.background} onChange={(v) => update((c) => ({ ...c, background: v }))} />
        </Row>
        <Row label="Gradient">
          <Toggle checked={config.bgGradient} onChange={(v) => update((c) => ({ ...c, bgGradient: v }))} size="sm" />
        </Row>
        {config.bgGradient && (
          <Row label="Gradient end">
            <ColorField value={config.bgGradientColor} onChange={(v) => update((c) => ({ ...c, bgGradientColor: v }))} />
          </Row>
        )}
        <Slider label="Vignette" value={config.vignette} min={0} max={1} step={0.01} onChange={(v) => update((c) => ({ ...c, vignette: v }), true)} onCommit={commit} format={(v) => `${Math.round(v * 100)}%`} />
        <Slider label="Film grain" value={config.grain} min={0} max={1} step={0.01} onChange={(v) => update((c) => ({ ...c, grain: v }), true)} onCommit={commit} format={(v) => `${Math.round(v * 100)}%`} />
      </Section>

      <Section title="Lines (all layers)">
        <Row label="Set every line color">
          <ColorField value={config.layers.coast.color} onChange={setAllLineColors} />
        </Row>
        <Row label="Scale all widths">
          <div className="inline-flex gap-1">
            {[0.5, 0.8, 1.25, 2].map((f) => (
              <button key={f} onClick={() => scaleAllWidths(f)} className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-zinc-200 hover:bg-white/10">
                ×{f}
              </button>
            ))}
          </div>
        </Row>
        <Row label="Line caps">
          <Segmented
            value={config.lineCap}
            onChange={(v) => update((c) => ({ ...c, lineCap: v }))}
            options={[
              { value: 'round', label: 'Round' },
              { value: 'butt', label: 'Sharp' },
            ]}
          />
        </Row>
      </Section>

      <Section title="Title & caption">
        <input
          value={config.title.text}
          onChange={(e) => setTitle({ text: e.target.value })}
          placeholder="Title (e.g. The Atlantic)"
          className="w-full rounded-md border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-amber-400/60"
        />
        <input
          value={config.title.subtitle}
          onChange={(e) => setTitle({ subtitle: e.target.value })}
          placeholder="Subtitle (e.g. 24°N · 22°W)"
          className="w-full rounded-md border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-amber-400/60"
        />
        <Row label="Font">
          <Select value={config.title.font} onChange={(v) => setTitle({ font: v })} options={FONTS.map((f) => ({ value: f, label: f }))} className="w-44" />
        </Row>
        <Row label="Color">
          <ColorField value={config.title.color} onChange={(v) => setTitle({ color: v })} />
        </Row>
        <Slider label="Size" value={config.title.size} min={12} max={240} step={1} onChange={(v) => setTitle({ size: v }, true)} onCommit={commit} format={(v) => `${v}`} />
        <Slider label="Letter spacing" value={config.title.letterSpacing} min={-0.05} max={0.8} step={0.01} onChange={(v) => setTitle({ letterSpacing: v }, true)} onCommit={commit} format={(v) => `${Math.round(v * 100)}%`} />
        <Row label="Uppercase">
          <Toggle checked={config.title.uppercase} onChange={(v) => setTitle({ uppercase: v })} size="sm" />
        </Row>
        <div>
          <div className="mb-1 text-xs text-zinc-300">Position</div>
          <div className="grid w-28 grid-cols-3 gap-1">
            {['top-left', 'top-center', 'top-right', 'x', 'center', 'x2', 'bottom-left', 'bottom-center', 'bottom-right'].map((p) =>
              POSITIONS.includes(p as TitlePosition) ? (
                <button
                  key={p}
                  onClick={() => setTitle({ position: p as TitlePosition })}
                  className={cn('h-7 rounded border border-white/10 transition', config.title.position === p ? 'bg-amber-400' : 'bg-white/5 hover:bg-white/10')}
                  title={p}
                />
              ) : (
                <span key={p} />
              ),
            )}
          </div>
        </div>
      </Section>
    </div>
  );
}
