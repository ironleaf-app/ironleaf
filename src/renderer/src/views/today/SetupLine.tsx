// "Set up your life" as one quiet line (29 Oct 2026, the redesign plan Job A): under Today's subtitle, opening the
// existing questions (views/modules/RecordModulesToday.tsx SetUpYourLife) in a dialog; gone for good once done or
// dismissed (that component keeps the choice on this PC). The count is the questions still to ask.
import { useState } from 'react';
import { LIFE_MODULES, modulesOn } from '../../../../shared/life-modules';
import { Icon } from '../../components/Icon';
import { useModules } from '../../state/modules';
import { useApp } from '../../state/store';
import { SetUpYourLife } from '../modules/RecordModulesToday';

const SETUP_SEEN = 'nv.setup-your-life.done';
const SETUP_NO = 'nv.setup-your-life.no';

export function SetupLine() {
  const modules = useModules();
  const canEdit = useApp((s) => s.canEdit);
  const [open, setOpen] = useState(false);
  const [gone, setGone] = useState(() => {
    try {
      return localStorage.getItem(SETUP_SEEN) === '1';
    } catch {
      return false;
    }
  });
  if (!canEdit || gone) return null;
  let saidNo: string[] = [];
  try {
    const v = JSON.parse(localStorage.getItem(SETUP_NO) ?? '[]');
    if (Array.isArray(v)) saidNo = v.filter((x) => typeof x === 'string');
  } catch {
    // Nothing put away.
  }
  const on = new Set(modulesOn(modules).map((m) => m.id));
  const left = LIFE_MODULES.filter((m) => !on.has(m.id) && !saidNo.includes(m.id)).length;
  if (!left) return null;
  const close = () => {
    setOpen(false);
    try {
      if (localStorage.getItem(SETUP_SEEN) === '1') setGone(true);
    } catch {
      // Still open next time.
    }
  };
  return (
    <>
      <button type="button" className="td-setup-line" onClick={() => setOpen(true)}>
        <Icon name="layers" size={13} />
        <span>Set up the parts of your life Ironleaf keeps · {left} {left === 1 ? 'question' : 'questions'}</span>
        <Icon name="forward" size={12} />
      </button>
      {open && (
        <div className="td-setup-overlay" role="presentation" onClick={close}>
          <div className="td-setup-dialog" role="dialog" aria-modal="true" aria-label="Set up your life" onClick={(e) => e.stopPropagation()}>
            <SetUpYourLife />
            <button type="button" className="text-button td-setup-close" onClick={close}>
              Close
            </button>
          </div>
        </div>
      )}
    </>
  );
}
