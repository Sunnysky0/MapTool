import { useId, type ChangeEvent } from 'react';
import type { CanvasSettings, ProjectionSettings } from '../../core/model/map-document';
import {
  PROJECTION_CATALOG,
  getProjectionMetadata,
  isProjectionId,
} from '../../core/projection/catalog';
import type { ProjectionId } from '../../core/projection/types';

export type ProjectionValidationStatus = 'valid' | 'warning' | 'error' | 'pending';

export interface ProjectionValidation {
  status: ProjectionValidationStatus;
  message: string;
}

export interface ProjectionControlsProps {
  value: ProjectionSettings;
  onChange: (projection: ProjectionSettings) => void;
  canvas: CanvasSettings;
  onCanvasChange: (canvas: CanvasSettings) => void;
  validation?: ProjectionValidation;
  onAutoCenter?: () => void;
  onReset?: () => void;
  disabled?: boolean;
  className?: string;
}

const STATUS_LABEL: Record<ProjectionValidationStatus, string> = {
  valid: '投影有效',
  warning: '需要注意',
  error: '不可生成',
  pending: '正在验证',
};

function projectionId(value: ProjectionSettings): ProjectionId {
  return isProjectionId(value.id) ? value.id : 'plate-carree';
}

export function ProjectionControls({
  value,
  onChange,
  canvas,
  onCanvasChange,
  validation = { status: 'valid', message: '当前投影与地理范围有效。' },
  onAutoCenter,
  onReset,
  disabled = false,
  className,
}: ProjectionControlsProps) {
  const id = useId();
  const selectedId = projectionId(value);
  const metadata = getProjectionMetadata(selectedId);
  const widthInvalid = !Number.isInteger(canvas.width) || canvas.width < 1 || canvas.width > 8192;
  const heightInvalid =
    !Number.isInteger(canvas.height) || canvas.height < 1 || canvas.height > 8192;
  const paddingInvalid =
    !Number.isFinite(canvas.padding) ||
    canvas.padding < 0 ||
    canvas.padding * 2 >= Math.min(canvas.width, canvas.height);

  const selectProjection = (event: ChangeEvent<HTMLSelectElement>) => {
    const nextId = event.currentTarget.value;
    if (!isProjectionId(nextId)) return;
    onChange({ ...value, id: nextId });
  };

  const updateCanvas = (key: keyof CanvasSettings, event: ChangeEvent<HTMLInputElement>) => {
    const nextValue = event.currentTarget.valueAsNumber;
    if (!Number.isFinite(nextValue)) return;
    onCanvasChange({ ...canvas, [key]: nextValue });
  };

  return (
    <section
      className={['tool-section', className].filter(Boolean).join(' ')}
      aria-labelledby={`${id}-title`}
    >
      <header className="tool-section__header">
        <h3 className="tool-section__title" id={`${id}-title`}>
          投影与画布
        </h3>
        <span className="tool-section__meta">{metadata.property}</span>
      </header>

      <fieldset className="field-group" disabled={disabled}>
        <legend className="field-group__legend">投影</legend>
        <div className="field">
          <label htmlFor={`${id}-projection`}>投影方式</label>
          <select id={`${id}-projection`} value={selectedId} onChange={selectProjection}>
            {PROJECTION_CATALOG.map((projection) => (
              <option key={projection.id} value={projection.id}>
                {projection.name}
              </option>
            ))}
          </select>
          <p className="field__hint">{metadata.description}</p>
        </div>
        <div className="button-row">
          <button className="button" type="button" onClick={onAutoCenter} disabled={!onAutoCenter}>
            自动居中
          </button>
          <button className="button" type="button" onClick={onReset} disabled={!onReset}>
            重置投影
          </button>
        </div>
      </fieldset>

      <fieldset className="field-group" disabled={disabled}>
        <legend className="field-group__legend">画布尺寸（像素）</legend>
        <div className="control-row">
          <div className="field">
            <label htmlFor={`${id}-width`}>宽度</label>
            <input
              id={`${id}-width`}
              type="number"
              min={1}
              max={8192}
              step={1}
              inputMode="numeric"
              value={canvas.width}
              aria-invalid={widthInvalid}
              onChange={(event) => updateCanvas('width', event)}
            />
          </div>
          <div className="field">
            <label htmlFor={`${id}-height`}>高度</label>
            <input
              id={`${id}-height`}
              type="number"
              min={1}
              max={8192}
              step={1}
              inputMode="numeric"
              value={canvas.height}
              aria-invalid={heightInvalid}
              onChange={(event) => updateCanvas('height', event)}
            />
          </div>
        </div>
        <div className="field">
          <label htmlFor={`${id}-padding`}>内边距</label>
          <input
            id={`${id}-padding`}
            type="number"
            min={0}
            max={4096}
            step={1}
            inputMode="numeric"
            value={canvas.padding}
            aria-invalid={paddingInvalid}
            onChange={(event) => updateCanvas('padding', event)}
          />
          <p className="field__hint">四边使用相同内边距，内容保持等比缩放。</p>
        </div>
        {widthInvalid || heightInvalid || paddingInvalid ? (
          <p className="field__error" role="alert">
            宽高须为 1 至 8192 的整数；内边距须非负，并为内容保留可用区域。
          </p>
        ) : null}
      </fieldset>

      <div
        className={
          validation.status === 'error'
            ? 'error-message'
            : validation.status === 'warning'
              ? 'warning-message'
              : 'status-line'
        }
        data-state={validation.status === 'pending' ? 'busy' : validation.status}
        role={validation.status === 'error' ? 'alert' : 'status'}
        aria-live="polite"
      >
        <strong>{STATUS_LABEL[validation.status]}：</strong> {validation.message}
      </div>
    </section>
  );
}
