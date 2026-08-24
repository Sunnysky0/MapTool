import type { MapDocument } from '../model/map-document';
import { CURRENT_SCHEMA_VERSION, migrateProject } from './migrations';
import { mapDocumentSchema, projectFileV1Schema, type ProjectFileV1 } from './schema';

export interface ProjectFieldError {
  path: string;
  message: string;
}

export class ProjectValidationError extends Error {
  constructor(
    message: string,
    public readonly fieldErrors: readonly ProjectFieldError[],
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'ProjectValidationError';
  }
}

function pathToString(path: PropertyKey[]): string {
  if (path.length === 0) return '$';
  return path.reduce<string>((result, part) => {
    if (typeof part === 'number') return `${result}[${part}]`;
    const key = String(part);
    return result.length === 0 ? key : `${result}.${key}`;
  }, '');
}

function validationErrorFromIssues(
  issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>,
): ProjectValidationError {
  const fieldErrors = issues.map((issue) => ({
    path: pathToString(issue.path),
    message: issue.message,
  }));
  const summary = fieldErrors
    .slice(0, 3)
    .map((issue) => `${issue.path}: ${issue.message}`)
    .join('; ');
  return new ProjectValidationError(
    `Project validation failed${summary ? `: ${summary}` : '.'}`,
    fieldErrors,
  );
}

export function createProjectFile(document: MapDocument): ProjectFileV1 {
  const parsedDocument = mapDocumentSchema.safeParse(document);
  if (!parsedDocument.success) throw validationErrorFromIssues(parsedDocument.error.issues);
  return { schemaVersion: CURRENT_SCHEMA_VERSION, document: parsedDocument.data };
}

export function serializeProject(document: MapDocument, space = 2): string {
  return JSON.stringify(createProjectFile(document), null, space);
}

/** Parses, migrates, and validates fully before returning any document state. */
export function deserializeProject(serialized: string): MapDocument {
  let decoded: unknown;
  try {
    decoded = JSON.parse(serialized) as unknown;
  } catch (error) {
    throw new ProjectValidationError(
      'Project JSON is malformed.',
      [{ path: '$', message: error instanceof Error ? error.message : 'Invalid JSON.' }],
      { cause: error },
    );
  }

  let migrated: unknown;
  try {
    migrated = migrateProject(decoded);
  } catch (error) {
    throw new ProjectValidationError(
      error instanceof Error ? error.message : 'Project migration failed.',
      [
        {
          path: 'schemaVersion',
          message: error instanceof Error ? error.message : 'Unsupported version.',
        },
      ],
      { cause: error },
    );
  }

  const result = projectFileV1Schema.safeParse(migrated);
  if (!result.success) throw validationErrorFromIssues(result.error.issues);
  return result.data.document;
}
