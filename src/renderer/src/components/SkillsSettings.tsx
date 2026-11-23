// Settings › AI › Skills (24 Nov 2026, phase 3; src/shared/skills.ts): the know-how the assistant, and every AI
// connected to Ironleaf, can load for a job. Each skill on its own switch; the person's own open as notes; a built-in
// one can be made their own (a copy in their notes, used in its place); and a new one starts from a short outline.
// SKILL.md files that can't be read say why, so they can be mended.

import { useCallback, useEffect, useState } from 'react';
import type { Prefs } from '../../../shared/prefs';
import { skillText, type SkillsView } from '../../../shared/skills';
import { errorMessage } from '../lib/errors';
import * as A from '../state/actions';
import { closeModal } from '../state/modals';
import { showError } from '../state/store';
import { LearnMore, Row, Toggle } from './Settings';

const NEW_SKILL = `# What this skill does

1. The first step, as you do it.
2. The next step.

## What good looks like
- …

## What to avoid
- …
`;

export function SkillsSettings({ prefs, set }: { prefs: Prefs; set(p: Partial<Prefs>): void }) {
  const [view, setView] = useState<SkillsView | null>(null);
  const [said, setSaid] = useState('');
  const load = useCallback(() => {
    window.nv.skills
      .list()
      .then(setView)
      .catch(() => setView(null));
  }, []);
  // Read again when a switch changes (a skill switched off, or one of theirs saved meanwhile).
  useEffect(load, [load, prefs.skillsOff]);
  if (!view) return null;

  const open = (path: string) => {
    closeModal();
    A.openPath(path, { where: 'tab' });
  };
  const turn = (name: string, on: boolean) => {
    const off = new Set(prefs.skillsOff);
    if (on) off.delete(name);
    else off.add(name);
    set({ skillsOff: [...off].sort() });
  };
  const write = async (name: string, text: string) => {
    try {
      const rel = await window.nv.notes.create(`${view.home}/${name}/SKILL.md`, text);
      open(rel);
    } catch (e) {
      showError(errorMessage(e));
    }
  };
  const makeMine = async (name: string) => {
    const text = await window.nv.skills.text(name).catch(() => null);
    if (text) await write(name, text);
  };
  const add = async () => {
    try {
      const r = await window.nv.skills.add();
      if (!r) return;
      setSaid(`Added ${r.name}.${r.skipped.length ? ` Left out: ${r.skipped.slice(0, 5).join(', ')}${r.skipped.length > 5 ? ` and ${r.skipped.length - 5} more` : ''} (programs, hidden files or too big).` : ''}`);
      load();
    } catch (e) {
      showError(errorMessage(e));
    }
  };
  const newSkill = () => {
    const taken = new Set(view.skills.map((s) => s.name));
    let name = 'my-skill';
    for (let i = 2; taken.has(name); i++) name = `my-skill-${i}`;
    void write(name, skillText(name, 'What it does, and when to use it: the words you would say when you want it.', NEW_SKILL));
  };

  const byTitle = view.skills.toSorted((a, b) => a.title.localeCompare(b.title));
  const builtIn = byTitle.filter((s) => s.source === 'built-in');
  const mine = byTitle.filter((s) => s.source === 'notes');
  return (
    <>
      <h3 data-setting="Skills">Skills</h3>
      <p className="setting-hint">
        Know-how for particular jobs. The assistant, and any AI you connect to Ironleaf, sees what each is for and reads it when a job needs it. <LearnMore>A skill is a folder in your notes with a SKILL.md: a name, a line on when to use it, and the steps. Ask the assistant to “make that a skill” and it writes one for you. Skills are words only: nothing in one is ever run, and none can do more than the assistant may.</LearnMore>
      </p>
      <Row title="Your skills" hint={said || (mine.length ? `Kept in your notes, in ${view.home}.` : `None yet. New ones go in ${view.home}.`)}>
        <button className="button" title="A skill someone published: pick its SKILL.md, or the skill as a .zip or .skill file" onClick={() => void add()}>
          Add a skill
        </button>
        <button className="button" onClick={newSkill}>
          New skill
        </button>
      </Row>
      {mine.map((s) => (
        <Row key={s.path} title={s.title} hint={`${s.replaces ? 'Used in place of the built-in skill. ' : ''}${s.about}`}>
          <button className="button" onClick={() => open(s.path!)}>
            Open
          </button>
          <Toggle label={`Use ${s.title}`} value={s.on} onChange={(on) => turn(s.name, on)} />
        </Row>
      ))}
      {view.problems.map((p) => (
        <Row key={p.path} title={p.path.split('/').slice(-2, -1)[0] ?? p.path} hint={`Not used: ${p.problem}`}>
          <button className="button" onClick={() => open(p.path)}>
            Mend
          </button>
        </Row>
      ))}
      <h3>Built into Ironleaf</h3>
      {builtIn.map((s) => (
        <Row key={s.name} title={s.title} hint={s.about}>
          <button className="button" title="A copy in your notes to change, used in place of this one" onClick={() => void makeMine(s.name)}>
            Make it mine
          </button>
          <Toggle label={`Use ${s.title}`} value={s.on} onChange={(on) => turn(s.name, on)} />
        </Row>
      ))}
    </>
  );
}
