import { useId, type HTMLAttributes, type ReactNode } from 'react';
import { useControllableBoolean } from './useControllableBoolean';

export interface InspectorProps extends Omit<HTMLAttributes<HTMLElement>, 'children' | 'title'> {
  title?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  /** Controlled open state. When omitted, the inspector manages its own state. */
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** An accessible label is required when title is not plain text. */
  'aria-label'?: string;
  openLabel?: string;
  closeLabel?: string;
}

export function Inspector({
  title = 'Inspector',
  description,
  children,
  footer,
  open: controlledOpen,
  defaultOpen = true,
  onOpenChange,
  'aria-label': ariaLabel,
  openLabel = 'Open inspector',
  closeLabel = 'Close inspector',
  className,
  ...props
}: InspectorProps) {
  const generatedId = useId();
  const panelId = `inspector-${generatedId.replaceAll(':', '')}`;
  const headingId = `${panelId}-heading`;
  const [open, setOpen] = useControllableBoolean({
    value: controlledOpen,
    defaultValue: defaultOpen,
    onChange: onOpenChange,
  });
  const label = ariaLabel ?? (typeof title === 'string' ? title : undefined);
  const inspectorClassName = ['inspector', className].filter(Boolean).join(' ');

  return (
    <aside
      className={inspectorClassName}
      aria-label={label}
      aria-labelledby={label === undefined ? headingId : undefined}
      data-open={open ? 'true' : 'false'}
      {...props}
    >
      <button
        className="inspector__mobile-toggle"
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen(!open)}
      >
        <span className="inspector__mobile-handle" aria-hidden="true" />
        <span className="inspector__mobile-label">{title}</span>
        <span className="inspector__mobile-state">{open ? closeLabel : openLabel}</span>
      </button>

      <div className="inspector__panel" id={panelId}>
        <div className="inspector__header">
          <div className="inspector__heading-group">
            <h2 className="inspector__title" id={headingId}>
              {title}
            </h2>
            {description !== undefined ? (
              <div className="inspector__description">{description}</div>
            ) : null}
          </div>
          <button
            className="inspector__close"
            type="button"
            aria-label={closeLabel}
            onClick={() => setOpen(false)}
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>

        <div className="inspector__body">{children}</div>
        {footer !== undefined ? <footer className="inspector__footer">{footer}</footer> : null}
      </div>
    </aside>
  );
}
