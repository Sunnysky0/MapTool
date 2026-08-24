import type { MapDocument } from '../model/map-document';
import { downloadBlob } from '../utils/download';
import { serializeProject } from './serialization';

export function projectBlob(document: MapDocument): Blob {
  const json = `${serializeProject(document, 2)}\n`;
  return new Blob([json], { type: 'application/json;charset=utf-8' });
}

export function downloadProject(document: MapDocument, filename = 'maptool-project.json'): void {
  downloadBlob(projectBlob(document), filename);
}
