import { useId, type HTMLAttributes, type ReactNode } from 'react';
import { useControllableBoolean } from './useControllableBoolean';

export interface PreviewDrawerProps extends Omit<
  HTMLAttributes<HTMLElement>,
  'children' | 'title'
> {
  title?: ReactNode;
  eyebrow?: ReactNode;
  children: ReactNode;
  controls?: ReactNode;
  metadata?: ReactNode;
  status?: ReactNode;
  error?: ReactNode;
  /** Controlled expansion state. When omitted, the drawer manages its own state. */
  expanded?: boolean;
  defaultExpanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  isBusy?: boolean;
  /** An accessible label is required when title is not plain text. */
  'aria-label'?: string;
  expandLabel?: string;
  collapseLabel?: string;
}

export function PreviewDrawer({
  title = 'Projection preview',
  eyebrow,
  children,
  controls,
  metadata,
  status,
  error,
  expanded: controlledExpanded,
  defaultExpanded = false,
  onExpandedChange,
  isBusy = false,
  'aria-label': ariaLabel,
  expandLabel = 'Expand projection preview',
  collapseLabel = 'Collapse projection preview',
  className,
  ...props
}: PreviewDrawerProps) {
  const generatedId = useId();
  const contentId = `preview-${generatedId.replaceAll(':', '')}`;
  const headingId = `${contentId}-heading`;
  const [expanded, setExpanded] = useControllableBoolean({
    value: controlledExpanded,
    defaultValue: defaultExpanded,
    onChange: onExpandedChange,
  });
  const label = ariaLabel ?? (typeof title === 'string' ? title : undefined);
  const drawerClassName = ['preview-drawer', className].filter(Boolean).join(' ');

  return (
    <section
      className={drawerClassName}
      aria-label={label}
      aria-labelledby={label === undefined ? headingId : undefined}
      aria-busy={isBusy || undefined}
      data-expanded={expanded ? 'true' : 'false'}
      {...props}
    >
      <header className="preview-drawer__header">
        <button
          className="preview-drawer__toggle"
          type="button"
          aria-expanded={expanded}
          aria-controls={contentId}
          aria-label={expanded ? collapseLabel : expandLabel}
          onClick={() => setExpanded(!expanded)}
        >
          <span className="preview-drawer__handle" aria-hidden="true" />
          <span className="preview-drawer__heading-group">
            {eyebrow !== undefined ? (
              <span className="preview-drawer__eyebrow">{eyebrow}</span>
            ) : null}
            <span className="preview-drawer__title" id={headingId}>
              {title}
            </span>
          </span>
          <span className="preview-drawer__toggle-text" aria-hidden="true">
            {expanded ? 'Collapse' : 'Expand'}
          </span>
          <svg className="preview-drawer__chevron" viewBox="0 0 16 16" aria-hidden="true">
            <path d="m3.5 10 4.5-4 4.5 4" />
          </svg>
        </button>

        {controls !== undefined ? <div className="preview-drawer__controls">{controls}</div> : null}
      </header>

      <div className="preview-drawer__content" id={contentId}>
        <div className="preview-drawer__canvas">{children}</div>
        {metadata !== undefined ? (
          <aside className="preview-drawer__metadata" aria-label="Preview details">
            {metadata}
          </aside>
        ) : null}
      </div>

      {error !== undefined ? (
        <div className="preview-drawer__message preview-drawer__message--error" role="alert">
          {error}
        </div>
      ) : null}

      {status !== undefined ? (
        <div
          className="preview-drawer__message preview-drawer__message--status"
          role="status"
          aria-live="polite"
        >
          {status}
        </div>
      ) : null}

      {isBusy ? <span className="preview-drawer__busy" aria-hidden="true" /> : null}
    </section>
  );
}
