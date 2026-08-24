import { useId, useRef, type ChangeEvent } from 'react';

export interface ExportProgress {
  active: boolean;
  label?: string;
  /** Completion from 0 to 100. Omit for indeterminate progress. */
  value?: number;
}

export interface ExportPanelProps {
  filename: string;
  onFilenameChange: (filename: string) => void;
  onExportSvg: () => void | Promise<void>;
  onExportPng: () => void | Promise<void>;
  onExportProject: () => void | Promise<void>;
  onImportProject: (file: File) => void | Promise<void>;
  progress?: ExportProgress;
  error?: string | null;
  disabled?: boolean;
  className?: string;
}

function progressValue(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  return Math.min(100, Math.max(0, value));
}

export function ExportPanel({
  filename,
  onFilenameChange,
  onExportSvg,
  onExportPng,
  onExportProject,
  onImportProject,
  progress = { active: false },
  error,
  disabled = false,
  className,
}: ExportPanelProps) {
  const id = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const busy = progress.active;
  const completion = progressValue(progress.value);
  const filenameMissing = filename.trim().length === 0;

  const importProject = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (file) void onImportProject(file);
  };

  return (
    <section
      className={['tool-section', className].filter(Boolean).join(' ')}
      aria-labelledby={`${id}-title`}
      aria-busy={busy}
    >
      <header className="tool-section__header">
        <h3 className="tool-section__title" id={`${id}-title`}>
          导出与项目文件
        </h3>
        <span className="tool-section__meta">SVG / PNG / JSON</span>
      </header>

      <div className="field-group">
        <div className="field">
          <label htmlFor={`${id}-filename`}>文件名</label>
          <input
            id={`${id}-filename`}
            type="text"
            value={filename}
            onChange={(event) => onFilenameChange(event.currentTarget.value)}
            disabled={disabled || busy}
            aria-invalid={filenameMissing}
            aria-describedby={filenameMissing ? `${id}-filename-error` : `${id}-filename-hint`}
            autoComplete="off"
            spellCheck={false}
          />
          <p className="field__hint" id={`${id}-filename-hint`}>
            扩展名会按导出格式自动添加。
          </p>
          {filenameMissing ? (
            <p className="field__error" id={`${id}-filename-error`} role="alert">
              请输入文件名。
            </p>
          ) : null}
        </div>

        <div className="button-row" aria-label="导出格式">
          <button
            className="button button--primary"
            type="button"
            onClick={() => void onExportSvg()}
            disabled={disabled || busy || filenameMissing}
          >
            导出 SVG
          </button>
          <button
            className="button"
            type="button"
            onClick={() => void onExportPng()}
            disabled={disabled || busy || filenameMissing}
          >
            导出 PNG
          </button>
          <button
            className="button"
            type="button"
            onClick={() => void onExportProject()}
            disabled={disabled || busy || filenameMissing}
          >
            导出项目 JSON
          </button>
        </div>
      </div>

      <fieldset className="field-group" disabled={disabled || busy}>
        <legend className="field-group__legend">继续编辑</legend>
        <input
          ref={fileInputRef}
          className="visually-hidden"
          type="file"
          accept=".json,application/json"
          onChange={importProject}
          aria-label="选择项目 JSON 文件"
        />
        <button className="button" type="button" onClick={() => fileInputRef.current?.click()}>
          导入项目 JSON
        </button>
        <p className="field__hint">文件验证成功后才会替换当前项目。</p>
      </fieldset>

      {busy ? (
        <div className="status-line" data-state="busy" role="status" aria-live="polite">
          <div className="tool-section__header">
            <span>{progress.label ?? '正在处理…'}</span>
            {completion !== undefined ? (
              <span className="numeric">{Math.round(completion)}%</span>
            ) : null}
          </div>
          <progress
            value={completion}
            max={completion === undefined ? undefined : 100}
            aria-label={progress.label ?? '导出或导入进度'}
            style={{ width: '100%', marginTop: '0.5rem', accentColor: 'var(--color-cyan)' }}
          />
        </div>
      ) : null}

      {error ? (
        <div className="error-message" role="alert">
          {error}
        </div>
      ) : null}
    </section>
  );
}
