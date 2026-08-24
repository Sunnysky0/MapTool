import { useId, type ChangeEvent } from 'react';
import type { GeographicExtent } from '../../core/model/map-document';
import {
  MAX_LATITUDE,
  MAX_LONGITUDE,
  MIN_LATITUDE,
  MIN_LONGITUDE,
  longitudeSpan,
  validateExtent,
} from '../../core/geo/extent';

export interface ExtentControlsProps {
  value: GeographicExtent;
  onChange: (extent: GeographicExtent) => void;
  onFullWorld?: (extent: GeographicExtent) => void;
  onReset?: () => void;
  /** Optional deterministic preset supplied by the globe viewport. */
  visibleHemisphere?: GeographicExtent;
  onVisibleHemisphere?: (extent: GeographicExtent) => void;
  disabled?: boolean;
  className?: string;
}

type CoordinateKey = 'west' | 'east' | 'south' | 'north';

interface CoordinateField {
  key: CoordinateKey;
  label: string;
  direction: 'W' | 'E' | 'S' | 'N';
  min: number;
  max: number;
}

const COORDINATE_FIELDS: readonly CoordinateField[] = [
  { key: 'west', label: '西界', direction: 'W', min: MIN_LONGITUDE, max: MAX_LONGITUDE },
  { key: 'east', label: '东界', direction: 'E', min: MIN_LONGITUDE, max: MAX_LONGITUDE },
  { key: 'south', label: '南界', direction: 'S', min: MIN_LATITUDE, max: MAX_LATITUDE },
  { key: 'north', label: '北界', direction: 'N', min: MIN_LATITUDE, max: MAX_LATITUDE },
];

const FULL_WORLD: GeographicExtent = {
  west: MIN_LONGITUDE,
  east: MAX_LONGITUDE,
  south: MIN_LATITUDE,
  north: MAX_LATITUDE,
  wrapsAntimeridian: false,
};

function formatDegrees(value: number): string {
  return `${value.toLocaleString('zh-CN', { maximumFractionDigits: 4 })}°`;
}

export function ExtentControls({
  value,
  onChange,
  onFullWorld,
  onReset,
  visibleHemisphere,
  onVisibleHemisphere,
  disabled = false,
  className,
}: ExtentControlsProps) {
  const id = useId();
  const issues = validateExtent(value);
  const issueByField = new Map(issues.map((issue) => [issue.field, issue.message]));
  const valid = issues.length === 0;
  const latitudeSpan = value.north - value.south;

  const updateCoordinate = (key: CoordinateKey, event: ChangeEvent<HTMLInputElement>) => {
    const coordinate = event.currentTarget.valueAsNumber;
    if (!Number.isFinite(coordinate)) return;
    const next = { ...value, [key]: coordinate };
    if (key === 'west' || key === 'east') {
      next.wrapsAntimeridian = next.west > next.east;
    }
    onChange(next);
  };

  const applyFullWorld = () => {
    const next = { ...FULL_WORLD };
    onChange(next);
    onFullWorld?.(next);
  };

  const applyVisibleHemisphere = () => {
    if (!visibleHemisphere) return;
    const next = { ...visibleHemisphere };
    onChange(next);
    onVisibleHemisphere?.(next);
  };

  return (
    <section
      className={['tool-section', className].filter(Boolean).join(' ')}
      aria-labelledby={`${id}-title`}
    >
      <header className="tool-section__header">
        <h3 className="tool-section__title" id={`${id}-title`}>
          地理范围
        </h3>
        <output className="tool-section__meta" aria-live="polite">
          {value.wrapsAntimeridian ? '跨越日期变更线' : '连续范围'}
        </output>
      </header>

      <fieldset className="field-group" disabled={disabled}>
        <legend className="field-group__legend">边界坐标（度）</legend>
        <div className="control-row">
          {COORDINATE_FIELDS.map(({ key, label, direction, min, max }) => {
            const error = issueByField.get(key);
            const errorId = error ? `${id}-${key}-error` : undefined;
            return (
              <div className="field" key={key}>
                <label htmlFor={`${id}-${key}`}>
                  {label} {direction}
                </label>
                <input
                  id={`${id}-${key}`}
                  name={key}
                  type="number"
                  min={min}
                  max={max}
                  step="any"
                  inputMode="decimal"
                  value={value[key]}
                  aria-invalid={Boolean(error)}
                  aria-describedby={errorId}
                  onChange={(event) => updateCoordinate(key, event)}
                />
                {error ? (
                  <p className="field__error" id={errorId}>
                    坐标无效，请检查边界顺序和允许范围。
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>
      </fieldset>

      <dl className="coordinate-readout" aria-label="范围摘要">
        <dt>东西跨度</dt>
        <dd>{valid ? formatDegrees(longitudeSpan(value)) : '无效'}</dd>
        <dt>南北跨度</dt>
        <dd>{Number.isFinite(latitudeSpan) ? formatDegrees(latitudeSpan) : '无效'}</dd>
        <dt>日期变更线</dt>
        <dd>{value.wrapsAntimeridian ? '跨越' : '不跨越'}</dd>
      </dl>

      {!valid ? (
        <div className="error-message" role="alert">
          经度须在 -180° 至 180°，纬度须在 -90° 至 90°，北界必须大于南界。
        </div>
      ) : null}

      <div className="button-row">
        <button className="button" type="button" onClick={applyFullWorld} disabled={disabled}>
          全世界
        </button>
        <button
          className="button"
          type="button"
          onClick={applyVisibleHemisphere}
          disabled={disabled || !visibleHemisphere}
          title={visibleHemisphere ? undefined : '等待地球视图提供可见半球范围'}
        >
          可见半球
        </button>
        <button className="button" type="button" onClick={onReset} disabled={disabled || !onReset}>
          重置
        </button>
      </div>
    </section>
  );
}
