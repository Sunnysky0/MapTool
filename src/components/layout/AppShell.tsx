import type { CSSProperties, HTMLAttributes, ReactNode } from 'react';

function cssLength(value: CSSProperties['width']): CSSProperties['width'] {
  return typeof value === 'number' ? `${value}px` : value;
}

export interface AppShellProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  /** Persistent product mark or project identity shown above the workspace. */
  header?: ReactNode;
  /** Optional global tools rendered at the opposite edge of the header. */
  actions?: ReactNode;
  /** Primary interactive map or globe surface. */
  children: ReactNode;
  /** Contextual controls placed to the right on wide screens. */
  inspector?: ReactNode;
  /** Projection preview placed along the lower workspace edge. */
  preview?: ReactNode;
  /** Announced application state, such as render progress or save state. */
  status?: ReactNode;
  /** Blocking or recoverable application error. */
  error?: ReactNode;
  /** Accessible name for the main workspace. */
  workspaceLabel?: string;
  /** Target id used by the skip link. */
  workspaceId?: string;
  /** Text shown by the keyboard-visible skip link. */
  skipLinkLabel?: string;
  /** Override the inspector width while preserving responsive behavior. */
  inspectorWidth?: CSSProperties['width'];
  /** Override the compact preview height. */
  previewHeight?: CSSProperties['height'];
}

export function AppShell({
  header,
  actions,
  children,
  inspector,
  preview,
  status,
  error,
  workspaceLabel = 'Globe workspace',
  workspaceId = 'map-workspace',
  skipLinkLabel = 'Skip to map workspace',
  inspectorWidth,
  previewHeight,
  className,
  style,
  ...props
}: AppShellProps) {
  const shellStyle = {
    ...style,
    ...(inspectorWidth === undefined
      ? null
      : { '--app-inspector-width': cssLength(inspectorWidth) }),
    ...(previewHeight === undefined ? null : { '--app-preview-height': cssLength(previewHeight) }),
  } as CSSProperties;

  const shellClassName = ['app-shell', className].filter(Boolean).join(' ');
  const hasHeader = header !== undefined || actions !== undefined;

  return (
    <div
      className={shellClassName}
      style={shellStyle}
      data-has-header={hasHeader ? 'true' : 'false'}
      {...props}
    >
      <a className="skip-link" href={`#${workspaceId}`}>
        {skipLinkLabel}
      </a>

      {hasHeader ? (
        <header className="app-shell__header">
          <div className="app-shell__identity">{header}</div>
          {actions !== undefined ? (
            <nav className="app-shell__actions" aria-label="Application actions">
              {actions}
            </nav>
          ) : null}
        </header>
      ) : null}

      <div className="app-shell__stage">
        <main
          className="app-shell__workspace"
          id={workspaceId}
          aria-label={workspaceLabel}
          tabIndex={-1}
        >
          {children}
        </main>

        {inspector !== undefined ? (
          <div className="app-shell__inspector-slot">{inspector}</div>
        ) : null}

        {preview !== undefined ? <div className="app-shell__preview-slot">{preview}</div> : null}
      </div>

      {error !== undefined ? (
        <div className="app-shell__notice app-shell__notice--error" role="alert">
          <span className="app-shell__notice-mark" aria-hidden="true" />
          <div>{error}</div>
        </div>
      ) : null}

      {status !== undefined ? (
        <div
          className="app-shell__notice app-shell__notice--status"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          <span className="app-shell__notice-mark" aria-hidden="true" />
          <div>{status}</div>
        </div>
      ) : null}
    </div>
  );
}
