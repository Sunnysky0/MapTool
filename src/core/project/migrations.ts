export const CURRENT_SCHEMA_VERSION = 1 as const;

export class UnsupportedProjectVersionError extends Error {
  constructor(public readonly version: unknown) {
    super(
      `Unsupported project schemaVersion ${String(version)}; expected ${CURRENT_SCHEMA_VERSION}.`,
    );
    this.name = 'UnsupportedProjectVersionError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Version dispatch is intentionally separate from validation. Future migrations
 * can transform older records here, after which the current strict schema is
 * still the sole authority for accepted project data.
 */
export function migrateProject(input: unknown): unknown {
  if (!isRecord(input)) return input;
  const version = input.schemaVersion;
  if (version === CURRENT_SCHEMA_VERSION) return input;
  throw new UnsupportedProjectVersionError(version);
}
