// SPDX-License-Identifier: AGPL-3.0-or-later
// The skills in use (24 Nov 2026, phase 3; src/shared/skills.ts has the shape): the built-in ones and the person's own,
// read from their notes — any folder holding a SKILL.md — less those switched off in Settings › AI › Skills. Read again
// only when the notes change (the index's generation), so every answer can list them for nothing.

import { isPrivatePath } from '../shared/private';
import { builtInSkills } from '../shared/skills-builtin';
import { isSkillFile, mergeSkills, parseSkill, skillFolder, type Skill, type SkillProblem } from '../shared/skills';

/** What the library reads from the notes (the index's own methods). */
export interface SkillsIndex {
  allMeta(): { path: string }[];
  content(path: string): string | undefined;
  otherFiles(): string[];
  generation(): number;
  isExcluded?(path: string): boolean;
}

/** The person's own skills found in the notes, and the SKILL.md files that couldn't be read as skills. */
export function notesSkills(index: SkillsIndex): { skills: Skill[]; problems: SkillProblem[] } {
  const skills: Skill[] = [];
  const problems: SkillProblem[] = [];
  const notes = index.allMeta().map((m) => m.path);
  const everything = [...notes, ...index.otherFiles()];
  for (const rel of notes) {
    if (!isSkillFile(rel) || isPrivatePath(rel) || index.isExcluded?.(rel)) continue;
    const folder = skillFolder(rel);
    const read = parseSkill(index.content(rel) ?? '', folder.split('/').pop() ?? '');
    if ('problem' in read) {
      problems.push({ path: rel, problem: read.problem });
      continue;
    }
    const files = everything
      .filter((p) => p !== rel && p.startsWith(`${folder}/`) && !isPrivatePath(p))
      .map((p) => p.slice(folder.length + 1))
      .sort();
    skills.push({ ...read.skill, source: 'notes', path: rel, files });
  }
  return { skills, problems };
}

/** Where a new skill of the person's goes: Library/Skills when the notes have a Library, else Skills. */
export function skillsHome(index: Pick<SkillsIndex, 'allMeta'>, hasLibrary: boolean): string {
  if (hasLibrary || index.allMeta().some((m) => /^Library\//.test(m.path))) return 'Library/Skills';
  return 'Skills';
}

/** The skills in use, read again only when the notes or the switches change. */
export class SkillLibrary {
  private memo: { key: string; all: Skill[]; own: Skill[]; problems: SkillProblem[] } | null = null;
  private readonly builtIn = builtInSkills();

  constructor(private readonly index: () => SkillsIndex | null, private readonly off: () => readonly string[]) {}

  private read() {
    const index = this.index();
    const off = this.off();
    const key = `${index ? index.generation() : -1}\n${off.join(',')}`;
    if (this.memo?.key === key) return this.memo;
    const found = index ? notesSkills(index) : { skills: [], problems: [] };
    this.memo = { key, all: mergeSkills(this.builtIn, found.skills, off), own: found.skills, problems: found.problems };
    return this.memo;
  }

  /** The skills in use (switched on), the person's winning a name both have. */
  list(): Skill[] {
    return this.read().all;
  }

  /** Every skill there is, switched on or off, for Settings (the person's that stand in for a built-in say so). */
  every(): { skill: Skill; on: boolean; replaces: boolean }[] {
    const { own } = this.read();
    const off = new Set(this.off());
    const all = mergeSkills(this.builtIn, own, []);
    return all.map((skill) => ({ skill, on: !off.has(skill.name), replaces: skill.source === 'notes' && this.builtIn.some((b) => b.name === skill.name) }));
  }

  /** SKILL.md files in the notes that couldn't be read as skills, with why. */
  problems(): SkillProblem[] {
    return this.read().problems;
  }
}
