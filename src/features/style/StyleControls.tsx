import { useId, type ChangeEvent } from 'react';
import type { MapStyle } from '../../core/model/map-document';

export interface StyleControlsProps {
  value: MapStyle;
  onChange: (style: MapStyle) => void;
  disabled?: boolean;
  className?: string;
}

function numberValue(event: ChangeEvent<HTMLInputElement>): number | null {
  const value = event.currentTarget.valueAsNumber;
  return Number.isFinite(value) ? value : null;
}

export function StyleControls({
  value,
  onChange,
  disabled = false,
  className,
}: StyleControlsProps) {
  const id = useId();

  const changeLinework = <Key extends keyof MapStyle['linework']>(
    key: Key,
    nextValue: MapStyle['linework'][Key],
  ) => onChange({ ...value, linework: { ...value.linework, [key]: nextValue } });

  const changeGraticule = <Key extends keyof MapStyle['graticule']>(
    key: Key,
    nextValue: MapStyle['graticule'][Key],
  ) => onChange({ ...value, graticule: { ...value.graticule, [key]: nextValue } });

  const changeFrame = <Key extends keyof MapStyle['extentFrame']>(
    key: Key,
    nextValue: MapStyle['extentFrame'][Key],
  ) => onChange({ ...value, extentFrame: { ...value.extentFrame, [key]: nextValue } });

  return (
    <section
      className={['tool-section', className].filter(Boolean).join(' ')}
      aria-labelledby={`${id}-title`}
    >
      <header className="tool-section__header">
        <h3 className="tool-section__title" id={`${id}-title`}>
          地图样式
        </h3>
      </header>

      <fieldset className="field-group" disabled={disabled}>
        <legend className="field-group__legend">底图线稿</legend>
        <div className="control-row">
          <div className="field">
            <label htmlFor={`${id}-line-color`}>线条颜色</label>
            <input
              id={`${id}-line-color`}
              type="color"
              value={value.linework.color}
              onChange={(event) => changeLinework('color', event.currentTarget.value)}
            />
          </div>
          <div className="field">
            <label htmlFor={`${id}-line-width`}>线宽（像素）</label>
            <input
              id={`${id}-line-width`}
              type="number"
              min={0.01}
              max={32}
              step={0.1}
              inputMode="decimal"
              value={value.linework.width}
              onChange={(event) => {
                const next = numberValue(event);
                if (next !== null) changeLinework('width', next);
              }}
            />
          </div>
          <div className="field">
            <label htmlFor={`${id}-line-opacity`}>不透明度（%）</label>
            <input
              id={`${id}-line-opacity`}
              type="number"
              min={0}
              max={100}
              step={1}
              inputMode="numeric"
              value={Math.round(value.linework.opacity * 100)}
              onChange={(event) => {
                const next = numberValue(event);
                if (next !== null)
                  changeLinework('opacity', Math.min(100, Math.max(0, next)) / 100);
              }}
            />
          </div>
          <div className="field">
            <label htmlFor={`${id}-line-cap`}>端点样式</label>
            <select
              id={`${id}-line-cap`}
              value={value.linework.lineCap}
              onChange={(event) =>
                changeLinework(
                  'lineCap',
                  event.currentTarget.value as MapStyle['linework']['lineCap'],
                )
              }
            >
              <option value="butt">平直</option>
              <option value="round">圆角</option>
              <option value="square">方形</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor={`${id}-line-join`}>转角样式</label>
            <select
              id={`${id}-line-join`}
              value={value.linework.lineJoin}
              onChange={(event) =>
                changeLinework(
                  'lineJoin',
                  event.currentTarget.value as MapStyle['linework']['lineJoin'],
                )
              }
            >
              <option value="miter">尖角</option>
              <option value="round">圆角</option>
              <option value="bevel">斜角</option>
            </select>
          </div>
        </div>
      </fieldset>

      <fieldset className="field-group" disabled={disabled}>
        <legend className="field-group__legend">背景</legend>
        <div className="field">
          <label htmlFor={`${id}-background-mode`}>背景类型</label>
          <select
            id={`${id}-background-mode`}
            value={value.background.color === null ? 'transparent' : 'solid'}
            onChange={(event) =>
              onChange({
                ...value,
                background: {
                  color:
                    event.currentTarget.value === 'transparent'
                      ? null
                      : (value.background.color ?? '#101416'),
                },
              })
            }
          >
            <option value="transparent">透明</option>
            <option value="solid">纯色</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor={`${id}-background-color`}>背景颜色</label>
          <input
            id={`${id}-background-color`}
            type="color"
            value={value.background.color ?? '#101416'}
            disabled={value.background.color === null}
            onChange={(event) =>
              onChange({ ...value, background: { color: event.currentTarget.value } })
            }
          />
        </div>
      </fieldset>

      <fieldset className="field-group" disabled={disabled}>
        <legend className="field-group__legend">经纬网</legend>
        <label className="switch-row">
          <span>显示经纬网</span>
          <input
            type="checkbox"
            checked={value.graticule.visible}
            onChange={(event) => changeGraticule('visible', event.currentTarget.checked)}
          />
        </label>
        <div className="control-row">
          <div className="field">
            <label htmlFor={`${id}-longitude-interval`}>经度间隔（度）</label>
            <input
              id={`${id}-longitude-interval`}
              type="number"
              min={0.1}
              max={360}
              step={1}
              inputMode="decimal"
              value={value.graticule.longitudeInterval}
              disabled={!value.graticule.visible}
              onChange={(event) => {
                const next = numberValue(event);
                if (next !== null) changeGraticule('longitudeInterval', next);
              }}
            />
          </div>
          <div className="field">
            <label htmlFor={`${id}-latitude-interval`}>纬度间隔（度）</label>
            <input
              id={`${id}-latitude-interval`}
              type="number"
              min={0.1}
              max={180}
              step={1}
              inputMode="decimal"
              value={value.graticule.latitudeInterval}
              disabled={!value.graticule.visible}
              onChange={(event) => {
                const next = numberValue(event);
                if (next !== null) changeGraticule('latitudeInterval', next);
              }}
            />
          </div>
          <div className="field">
            <label htmlFor={`${id}-graticule-color`}>网格颜色</label>
            <input
              id={`${id}-graticule-color`}
              type="color"
              value={value.graticule.color}
              disabled={!value.graticule.visible}
              onChange={(event) => changeGraticule('color', event.currentTarget.value)}
            />
          </div>
          <div className="field">
            <label htmlFor={`${id}-graticule-width`}>网格线宽（像素）</label>
            <input
              id={`${id}-graticule-width`}
              type="number"
              min={0.01}
              max={16}
              step={0.1}
              inputMode="decimal"
              value={value.graticule.width}
              disabled={!value.graticule.visible}
              onChange={(event) => {
                const next = numberValue(event);
                if (next !== null) changeGraticule('width', next);
              }}
            />
          </div>
          <div className="field">
            <label htmlFor={`${id}-graticule-opacity`}>网格不透明度（%）</label>
            <input
              id={`${id}-graticule-opacity`}
              type="number"
              min={0}
              max={100}
              step={1}
              inputMode="numeric"
              value={Math.round(value.graticule.opacity * 100)}
              disabled={!value.graticule.visible}
              onChange={(event) => {
                const next = numberValue(event);
                if (next !== null)
                  changeGraticule('opacity', Math.min(100, Math.max(0, next)) / 100);
              }}
            />
          </div>
        </div>
        <p className="field__hint">经纬网使用统一间隔，导出时与预览保持一致。</p>
      </fieldset>

      <fieldset className="field-group" disabled={disabled}>
        <legend className="field-group__legend">范围边框</legend>
        <label className="switch-row">
          <span>显示范围边框</span>
          <input
            type="checkbox"
            checked={value.extentFrame.visible}
            onChange={(event) => changeFrame('visible', event.currentTarget.checked)}
          />
        </label>
        <div className="control-row">
          <div className="field">
            <label htmlFor={`${id}-extent-color`}>边框颜色</label>
            <input
              id={`${id}-extent-color`}
              type="color"
              value={value.extentFrame.color}
              disabled={!value.extentFrame.visible}
              onChange={(event) => changeFrame('color', event.currentTarget.value)}
            />
          </div>
          <div className="field">
            <label htmlFor={`${id}-extent-width`}>边框线宽（像素）</label>
            <input
              id={`${id}-extent-width`}
              type="number"
              min={0.01}
              max={32}
              step={0.1}
              inputMode="decimal"
              value={value.extentFrame.width}
              disabled={!value.extentFrame.visible}
              onChange={(event) => {
                const next = numberValue(event);
                if (next !== null) changeFrame('width', next);
              }}
            />
          </div>
        </div>
      </fieldset>
    </section>
  );
}
