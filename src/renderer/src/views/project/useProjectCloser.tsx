// Closing a project with open tasks from anywhere but its own page (p12-close-and-noise round 2): the one shared
// mechanism the Projects home (Mark done, both boards), the canvas (a card's status, portfolio drags) and the peek (a
// project record's status) ask through. requestDone marks done when nothing is open, else opens the shared dialog;
// several at once (a bulk drag) queue up and ask one after another, never silently. The project page and the side
// panel keep their own ask (their edits batch with the page), through the same dialog and the same words.

import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { formatDate } from '../../../../shared/dates';
import { dropDecisionItem, openProjectTasks, type LooseTask } from '../../../../shared/project-close';
import { loadFiles, loadNotes, showError, toast } from '../../state/store';
import { CloseDialog, type CloseTarget } from './CloseDialog';

interface Ask {
  path: string;
  name: string;
  tasks: LooseTask[];
  targets: CloseTarget[];
}

export function useProjectCloser(): { closer: React.ReactNode; requestDone(path: string): void } {
  const [ask, setAsk] = useState<Ask | null>(null);
  const [busy, setBusy] = useState(false);
  const askRef = useRef<Ask | null>(null);
  askRef.current = ask;
  // Blocked projects waiting their turn (a bulk drag onto Done asks for each, one dialog after another).
  const queue = useRef<string[]>([]);
  const working = useRef(false);
  const flying = useRef<string | null>(null);

  /** Nothing open: marked done as before, with Undo. */
  const markDone = async (path: string) => {
    const r = await window.nv.projects.edit(path, { kind: 'set', field: 'status', value: 'done' });
    await Promise.all([loadNotes(), loadFiles()]);
    toast(r.words, { label: 'Undo', run: () => void window.nv.projects.undo(r.view.path).then(() => Promise.all([loadNotes(), loadFiles()])).catch(showError) });
  };
  const shut = () => {
    askRef.current = null;
    setAsk(null);
    pump();
  };
  function pump() {
    if (working.current || askRef.current) return;
    const next = queue.current.shift();
    if (next) resolve(next);
  }
  function resolve(next: string) {
    working.current = true;
    flying.current = next;
    void (async () => {
      try {
        const [v, cards] = await Promise.all([window.nv.projects.view(next), window.nv.projects.list()]);
        const tasks = openProjectTasks(v.project);
        if (!tasks.length) {
          await markDone(v.path);
          working.current = false;
          flying.current = null;
          pump();
          return;
        }
        setAsk({ path: v.path, name: v.project.name, tasks, targets: cards.filter((c) => c.path !== v.path).map((c) => ({ path: c.path, name: c.name })) });
      } catch (err) {
        showError(err);
      }
      working.current = false;
      flying.current = null;
    })();
  }
  /** Mark this project done, asking first when tasks are still open. Queued while another asks. */
  const requestDone = (path: string) => {
    if (askRef.current?.path === path || flying.current === path || queue.current.includes(path)) return;
    queue.current.push(path);
    pump();
  };
  /** The dialog's tasks again from the file: empty marks done and moves on, else it shows what is left. */
  const refresh = async (path: string) => {
    try {
      const v = await window.nv.projects.view(path);
      const tasks = openProjectTasks(v.project);
      if (!tasks.length) {
        await markDone(path);
        shut();
        return;
      }
      if (askRef.current?.path === path) setAsk({ ...askRef.current, name: v.project.name, tasks });
    } catch (err) {
      showError(err);
      shut();
    }
  };
  const undoAll = async (path: string, n: number) => {
    for (let i = 0; i < n; i++) await window.nv.projects.undo(path);
    await Promise.all([loadNotes(), loadFiles()]);
  };
  const onDone = (index: number) => {
    const now = askRef.current;
    if (!now) return;
    setBusy(true);
    void (async () => {
      try {
        const r = await window.nv.projects.edit(now.path, { kind: 'change', list: 'next', index, item: { done: true } });
        toast(r.words, { label: 'Undo', run: () => void undoAll(r.view.path, 1).then(() => refresh(r.view.path)).catch(showError) });
        await refresh(now.path);
      } catch (err) {
        showError(err);
      } finally {
        setBusy(false);
      }
    })();
  };
  const onDrop = (index: number) => {
    const now = askRef.current;
    const t = now?.tasks.find((x) => x.index === index);
    if (!now || !t) return;
    setBusy(true);
    void (async () => {
      try {
        await window.nv.projects.edit(now.path, { kind: 'remove', list: 'next', index });
        const r = await window.nv.projects.edit(now.path, { kind: 'add', list: 'decisions', item: dropDecisionItem(t.what, formatDate('D MMM YYYY')) });
        toast(`Dropped “${t.what}”. Kept under Decisions.`, { label: 'Undo', run: () => void undoAll(r.view.path, 2).then(() => refresh(r.view.path)).catch(showError) });
        await refresh(now.path);
      } catch (err) {
        showError(err);
      } finally {
        setBusy(false);
      }
    })();
  };
  const onMove = (index: number, target: string) => {
    const now = askRef.current;
    const t = now?.tasks.find((x) => x.index === index);
    if (!now || !t) return;
    const targetName = now.targets.find((x) => x.path === target)?.name ?? 'the other project';
    setBusy(true);
    void (async () => {
      try {
        await window.nv.projects.edit(target, { kind: 'add', list: 'next', item: { what: t.what, ...(t.who ? { who: t.who } : {}), ...(t.when ? { when: t.when } : {}) } });
        const r = await window.nv.projects.edit(now.path, { kind: 'remove', list: 'next', index });
        toast(`Moved “${t.what}” to ${targetName}.`, {
          label: 'Undo',
          run: () =>
            void (async () => {
              try {
                await window.nv.projects.undo(target);
                await window.nv.projects.undo(r.view.path);
                await Promise.all([loadNotes(), loadFiles()]);
                toast(`Moved “${t.what}” back.`);
              } catch (err) {
                showError(err);
              }
            })(),
        });
        await refresh(now.path);
      } catch (err) {
        showError(err);
      } finally {
        setBusy(false);
      }
    })();
  };
  const onAllDone = () => {
    const now = askRef.current;
    if (!now || !now.tasks.length) return;
    setBusy(true);
    void (async () => {
      try {
        for (const t of now.tasks) await window.nv.projects.edit(now.path, { kind: 'change', list: 'next', index: t.index, item: { done: true } });
        await markDone(now.path);
        shut();
      } catch (err) {
        showError(err);
        await refresh(now.path);
      } finally {
        setBusy(false);
      }
    })();
  };

  const closer = ask ? createPortal(<CloseDialog name={ask.name} tasks={ask.tasks} targets={ask.targets} mode="closing" busy={busy} onDone={onDone} onDrop={onDrop} onMove={onMove} onAllDone={onAllDone} onClose={shut} />, document.body) : null;
  return { closer, requestDone };
}
