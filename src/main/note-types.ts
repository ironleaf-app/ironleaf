// The vault's note types file (src/shared/note-types.ts; 20 Oct 2026, Ironleaf Calm): .neuralvault/types.json inside
// the notes, so renamed and hidden types, the person's own types and how each type's page looks travel with the notes
// (synced, copied, backed up with them). The .neuralvault folder is Ironleaf's own and reserved from the window's
// file reads and writes (src/main/vault.ts), so this is the one way in: read as text, written whole after checking it.

import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { readTypes, resolveTypes, typesForAssistant, TYPES_FILE, writeTypes, type TypeContext } from '../shared/note-types';

const MAX_BYTES = 512 * 1024;

const fileOf = (root: string) => path.join(root, ...TYPES_FILE.split('/'));

/** The types file's words ('' when the vault has none yet: the built-in types as they come). */
export async function readTypesFile(root: string): Promise<string> {
  try {
    const text = await fsp.readFile(fileOf(root), 'utf8');
    return text.length > MAX_BYTES ? '' : text;
  } catch {
    return '';
  }
}

/** The types file written whole (only what readTypes understands is kept), through a temporary file so it is never half
 *  written. */
export async function writeTypesFile(root: string, text: unknown): Promise<void> {
  if (typeof text !== 'string' || text.length > MAX_BYTES) throw new Error('Those note types can’t be saved.');
  const { config, problem } = readTypes(text);
  if (problem) throw new Error('Those note types can’t be saved.');
  const file = fileOf(root);
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  await fsp.writeFile(temp, writeTypes(config), 'utf8');
  await fsp.rename(temp, file);
}

/** The vault's types in a few lines for the assistant (its folders as this vault has them). */
export async function typesWords(root: string, ctx: TypeContext): Promise<string> {
  return typesForAssistant(resolveTypes(readTypes(await readTypesFile(root)).config, ctx));
}
