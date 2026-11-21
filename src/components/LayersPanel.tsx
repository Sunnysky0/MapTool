import { useState } from 'react';
import { AlertTriangle, ChevronDown, Loader2, RotateCcw } from 'lucide-react';
import type { Detail, LayerId, LayerStyle, MapConfig } from '../types';
import { HISTORICAL_LABELS, HISTORICAL_YEARS, LAYER_DEFS, layerDataKey } from '../lib/data';
import { defaultLayers } from '../lib/presets';
import { cn } from '../utils/cn';
import { ColorField, Row, Segmented, Select, Slider, Toggle } from './ui';

interface Props {
  config: MapConfig;
  update: (fn: (c: MapConfig) => MapConfig, transient?: boolean) => void;
  commit: () => void;
  loading: string[];
  errors: Record<string, string>;
  retry: (key: string) => void;
}

const GROUPS: LayerStyle['dash'][] = ['solid', 'dashed', 'dotted'];

export default function LayersPanel({ config, update, commit, loading, errors, retry }: Props) {
  const [open, setOpen] = useState<LayerId | null>('coast');

  const setLayer = (id: LayerId, patch: Partial<LayerStyle>, transient = false) =>
    update((c) => ({ ...c, layers: { ...c.layers, [id]: { ...c.layers[id], ...patch } } }), transient);

  const groups = Array.from(new Set(LAYER_DEFS.filter((d) => d.group !== 'Scenario' || config.scenario).map((d) => d.group)));

  return (
    <div>
      <div className="space-y-2 border-b border-white/5 px-4 py-3">
        <Row label="Coastline detail" hint="Coastlines and borders">
          <Segmented<Detail>
            value={config.coastDetail}
            onChange={(v) => update((c) => ({ ...c, coastDetail: v }))}
            options={[
              { value: '110m', label: 'Low' },
              { value: '50m', label: 'Med' },
              { value: '10m', label: 'High' },
            ]}
          />
        </Row>
        <Row label="Water detail" hint="Lakes and rivers">
          <Segmented<Detail>
            value={config.waterDetail}
            onChange={(v) => update((c) => ({ ...c, waterDetail: v }))}
            options={[
              { value: '110m', label: 'Low' },
              { value: '50m', label: 'Med' },
              { value: '10m', label: 'High' },
            ]}
          />
        </Row>
      </div>

      {groups.map((group) => (
        <div key={group} className="border-b border-white/5">
          <div className="px-4 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500">{group}</div>
          {LAYER_DEFS.filter((d) => d.group === group).map((def) => {
            const style = config.layers[def.id];
            const key = layerDataKey(def.id, style, config.coastDetail, config.waterDetail, config.scenario);
            const isLoading = !!key && loading.includes(key);
            const error = key ? errors[key] : undefined;
            const expanded = open === def.id;
            return (
              <div key={def.id} className={cn('mx-2 mb-1 rounded-lg transition-colors', expanded ? 'bg-white/[0.04]' : 'hover:bg-white/[0.03]')}>
                <div className="flex cursor-pointer items-center gap-2 px-2 py-2" onClick={() => setOpen(expanded ? null : def.id)}>
                  <Toggle checked={style.visible} onChange={(v) => setLayer(def.id, { visible: v })} size="sm" />
                  <span className="h-3 w-3 shrink-0 rounded-full border border-white/20" style={{ background: style.color, opacity: style.visible ? 1 : 0.35 }} />
                  <div className="min-w-0 flex-1">
                    <div className={cn('truncate text-xs', style.visible ? 'text-zinc-100' : 'text-zinc-400')}>
                      {def.name}
                      {(def.id === 'histA' || def.id === 'histB') && style.visible && <span className="ml-1 text-amber-300/80">{style.year}</span>}
                    </div>
                    <div className="truncate text-[10px] text-zinc-500">{def.description}</div>
                  </div>
                  {isLoading && <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-300" />}
                  {error && !isLoading && (
                    <button
                      title={`${error} — click to retry`}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (key) retry(key);
                      }}
                      className="text-red-400"
                    >
                      <AlertTriangle className="h-3.5 w-3.5" />
                    </button>
                  )}
                  <ChevronDown className={cn('h-3.5 w-3.5 text-zinc-500 transition-transform', expanded && 'rotate-180')} />
                </div>

                {expanded && (
                  <div className="space-y-3 px-3 pb-3 pt-1">
                    {(def.id === 'histA' || def.id === 'histB') && (
                      <Row label="Year">
                        <Select<number>
                          value={style.year ?? 1914}
                          onChange={(y) => setLayer(def.id, { year: y })}
                          options={HISTORICAL_YEARS.map((y) => ({ value: y, label: HISTORICAL_LABELS[y] ?? String(y) }))}
                          className="w-44"
                        />
                      </Row>
                    )}
                    {def.id === 'roads' && (
                      <Row label="Road classes">
                        <Segmented
                          value={style.roadClass ?? 'major'}
                          onChange={(v) => setLayer(def.id, { roadClass: v })}
                          options={[
                            { value: 'major', label: 'Major' },
                            { value: 'secondary', label: '+Secondary' },
                            { value: 'all', label: 'All' },
                          ]}
                        />
                      </Row>
                    )}
                    {def.id === 'graticule' && (
                      <Row label="Grid step">
                        <Segmented
                          value={String(style.step ?? 10)}
                          onChange={(v) => setLayer(def.id, { step: Number(v) })}
                          options={[
                            { value: '5', label: '5°' },
                            { value: '10', label: '10°' },
                            { value: '15', label: '15°' },
                            { value: '30', label: '30°' },
                          ]}
                        />
                      </Row>
                    )}
                    {def.id === 'cities' && (
                      <>
                        <Slider label="How many cities" value={style.minRank ?? 1} min={0} max={8} step={1} onChange={(v) => setLayer(def.id, { minRank: v }, true)} onCommit={commit} format={(v) => (v === 0 ? 'Capitals only' : v <= 2 ? 'Major' : v <= 5 ? 'Many' : 'Lots')} />
                        <Row label="Labels">
                          <Toggle checked={style.labels ?? true} onChange={(v) => setLayer(def.id, { labels: v })} size="sm" />
                        </Row>
                        <Slider label="Label size" value={style.labelSize ?? 11} min={6} max={40} step={1} onChange={(v) => setLayer(def.id, { labelSize: v }, true)} onCommit={commit} />
                        <Slider label="Dot size" value={style.dotSize ?? 2} min={0} max={10} step={0.5} onChange={(v) => setLayer(def.id, { dotSize: v }, true)} onCommit={commit} />
                      </>
                    )}

                    {def.id==='historicalLabels' && <Slider label="字号" value={style.labelSize??13} min={6} max={32} onChange={v=>setLayer(def.id,{labelSize:v},true)} onCommit={commit}/>}
                    {def.id!=='territories' && <Row label={def.id==='historicalLabels'?'文字颜色':'Line color'}>
                      <ColorField value={style.color} onChange={(v) => setLayer(def.id, { color: v })} />
                    </Row>}
                    {def.kind !== 'point' && def.id!=='territories' && (
                      <>
                        <Slider label="Line width" value={style.width} min={0} max={6} step={0.05} onChange={(v) => setLayer(def.id, { width: v }, true)} onCommit={commit} format={(v) => `${v.toFixed(2)} px`} />
                        <Row label="Line style">
                          <Segmented
                            value={style.dash}
                            onChange={(v) => setLayer(def.id, { dash: v })}
                            options={[
                              ...GROUPS.map((g) => ({ value: g, label: g[0].toUpperCase() + g.slice(1) })),
                              ...(def.id === 'railways' ? [{ value: 'rail' as const, label: 'Rail' }] : []),
                            ]}
                          />
                        </Row>
                      </>
                    )}
                    <Slider label="Opacity" value={style.opacity} min={0} max={1} step={0.01} onChange={(v) => setLayer(def.id, { opacity: v }, true)} onCommit={commit} format={(v) => `${Math.round(v * 100)}%`} />

                    {def.canFill && (
                      <>
                        <Row label={def.id === 'outline' ? 'Fill globe' : 'Fill'} hint={def.id === 'coast' ? 'Tint the land' : def.id === 'lakes' ? 'Tint water bodies' : undefined}>
                          <Toggle checked={style.fill} onChange={(v) => setLayer(def.id, { fill: v })} size="sm" />
                        </Row>
                        {style.fill && (
                          <>
                            <Row label="Fill color">
                              <ColorField value={style.fillColor} onChange={(v) => setLayer(def.id, { fillColor: v })} />
                            </Row>
                            <Slider label="Fill opacity" value={style.fillOpacity} min={0} max={1} step={0.01} onChange={(v) => setLayer(def.id, { fillOpacity: v }, true)} onCommit={commit} format={(v) => `${Math.round(v * 100)}%`} />
                          </>
                        )}
                      </>
                    )}
                    <div className="flex items-center justify-between pt-1">
                      {def.sizeHint ? <span className="text-[10px] text-zinc-500">Download {def.sizeHint}</span> : <span />}
                      <button
                        onClick={() => setLayer(def.id, { ...defaultLayers()[def.id], visible: style.visible })}
                        className="inline-flex items-center gap-1 text-[10px] text-zinc-400 hover:text-zinc-200"
                      >
                        <RotateCcw className="h-3 w-3" /> Reset layer
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
