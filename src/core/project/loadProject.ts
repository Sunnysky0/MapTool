import type { MapDocument } from '../model/map-document';
import { deserializeProject } from './serialization';

export interface ProjectTextFile {
  text(): Promise<string>;
}

export type ReplaceProject = (document: MapDocument) => void;

/** Reads and validates a project without mutating application state. */
export async function parseProjectFile(file: ProjectTextFile): Promise<MapDocument> {
  return deserializeProject(await file.text());
}

/**
 * Replaces state exactly once, and only after the complete file has been read,
 * migrated, and strictly validated.
 */
export async function loadProject(
  file: ProjectTextFile,
  replaceProject: ReplaceProject,
): Promise<MapDocument> {
  const document = await parseProjectFile(file);
  replaceProject(document);
  return document;
}
