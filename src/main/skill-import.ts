// SPDX-License-Identifier: AGPL-3.0-or-later
// A skill someone else published, brought into the notes (24 Nov 2026, phase 3; Settings › AI › Skills › Add a skill).
// Skills travel as a folder with a SKILL.md, or that folder zipped (.zip, or .skill as some apps name it). The person
// picks the SKILL.md in its folder, or the zip; the skill's folder is copied into their skills folder, as notes and files
// like any other. Words only: nothing in a skill is ever run, and programs (.exe, .dll, .bat…) aren't brought in at all.

import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { parseSkill, SKILL_FILE } from '../shared/skills';
import { zipEntries, zipRead } from './doc-text';

/** A skill ready to copy: its name and its files by their path inside its folder. */
export interface SkillPack {
  name: string;
  description: string;
  files: Map<string, Buffer>;
  /** Files left out (programs, hidden files, too big), by path, said to the person. */
  skipped: string[];
}

export const PACK_MAX_FILES = 300;
export const PACK_MAX_BYTES = 20 * 1024 * 1024;
const PROGRAMS = /\.(exe|dll|so|dylib|bat|cmd|com|scr|msi|msix|appx|lnk|jar|app|apk|vbs|wsf|reg)$/i;
const LEFT_OUT = (p: string) => p.split('/').some((x) => x.startsWith('.') || x === '__MACOSX' || x === 'node_modules' || x === '__pycache__');

/** Whether a file of a skill is left out, and why (null: it is brought in). */
export function leftOut(rel: string, size: number): string | null {
  if (LEFT_OUT(rel)) return 'hidden or tool files';
  if (PROGRAMS.test(rel)) return 'a program';
  if (size > 8 * 1024 * 1024) return 'too big';
  return null;
}

function finish(entries: { rel: string; data: Buffer; size: number }[], where: string): SkillPack {
  const md = entries.find((e) => e.rel === SKILL_FILE);
  if (!md) throw new Error(`There is no ${SKILL_FILE} in ${where}.`);
  const read = parseSkill(md.data.toString('utf8'), path.basename(where).replace(/\.(zip|skill)$/i, ''));
  if ('problem' in read) throw new Error(`That skill can’t be used: ${read.problem}`);
  const files = new Map<string, Buffer>();
  const skipped: string[] = [];
  let bytes = 0;
  for (const e of entries.sort((a, b) => a.rel.localeCompare(b.rel))) {
    const why = leftOut(e.rel, e.size);
    if (why || files.size >= PACK_MAX_FILES || bytes + e.size > PACK_MAX_BYTES) {
      skipped.push(e.rel);
      continue;
    }
    files.set(e.rel, e.data);
    bytes += e.data.length;
  }
  return { name: read.skill.name, description: read.skill.description, files, skipped };
}

/** The shallowest SKILL.md's folder among paths ('' at the top; null when there is none). */
export function skillRoot(paths: string[]): string | null {
  const found = paths.filter((p) => p === SKILL_FILE || p.endsWith(`/${SKILL_FILE}`)).filter((p) => !LEFT_OUT(p));
  if (!found.length) return null;
  const top = found.sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b))[0];
  return top === SKILL_FILE ? '' : top.slice(0, -SKILL_FILE.length - 1);
}

/** A skill from a zip's bytes (.zip or .skill). */
export async function packFromZip(buf: Buffer, name = 'the zip'): Promise<SkillPack> {
  const all = zipEntries(buf).filter((e) => !e.name.endsWith('/'));
  const names = all.map((e) => e.name.replace(/\\/g, '/'));
  const root = skillRoot(names);
  if (root === null) throw new Error(`There is no ${SKILL_FILE} in ${name}.`);
  const entries: { rel: string; data: Buffer; size: number }[] = [];
  for (const e of all) {
    const n = e.name.replace(/\\/g, '/');
    if (root && !n.startsWith(`${root}/`)) continue;
    const rel = root ? n.slice(root.length + 1) : n;
    if (!rel || rel.split('/').some((x) => x === '..' || x === '.' || !x)) continue;
    if (entries.length > PACK_MAX_FILES * 2) break;
    entries.push({ rel, size: e.size, data: leftOut(rel, e.size) ? Buffer.alloc(0) : await zipRead(buf, e, 8 * 1024 * 1024) });
  }
  return finish(entries, name);
}

/** A skill from its folder on this PC (the folder holding SKILL.md). */
export async function packFromFolder(dir: string): Promise<SkillPack> {
  const entries: { rel: string; data: Buffer; size: number }[] = [];
  const walk = async (rel: string, depth: number): Promise<void> => {
    if (depth > 6 || entries.length > PACK_MAX_FILES * 2) return;
    const list = await fsp.readdir(path.join(dir, rel), { withFileTypes: true });
    for (const d of list) {
      const r = rel ? `${rel}/${d.name}` : d.name;
      if (d.isSymbolicLink()) continue;
      if (d.isDirectory()) {
        if (!LEFT_OUT(r)) await walk(r, depth + 1);
      } else if (d.isFile()) {
        const st = await fsp.stat(path.join(dir, r));
        entries.push({ rel: r, size: st.size, data: leftOut(r, st.size) ? Buffer.alloc(0) : await fsp.readFile(path.join(dir, r)) });
      }
    }
  };
  await walk('', 0);
  return finish(entries, path.basename(dir));
}

/** A skill from what the person picked: a SKILL.md (its folder is the skill), a folder, or a .zip or .skill file. */
export async function packFrom(picked: string): Promise<SkillPack> {
  const st = await fsp.stat(picked);
  if (st.isDirectory()) return packFromFolder(picked);
  if (path.basename(picked) === SKILL_FILE) return packFromFolder(path.dirname(picked));
  if (/\.(zip|skill)$/i.test(picked)) {
    if (st.size > PACK_MAX_BYTES * 2) throw new Error('That file is too big to be a skill.');
    return packFromZip(await fsp.readFile(picked), path.basename(picked));
  }
  throw new Error(`Pick a skill’s ${SKILL_FILE}, or the skill as a .zip or .skill file.`);
}
