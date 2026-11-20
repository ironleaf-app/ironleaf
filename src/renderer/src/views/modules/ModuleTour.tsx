// A module's tour, opened only when the person asks (8.0 SPEC section D, 29 Oct 2026: "The module tour never
// opens by itself; a 'Show me around' link opens it"). The link sits at the end of the page header's summary
// line, inline with it (8.0 polish round 3, item 3), never on its own line above the tabs and never floating
// at the foot of the page; the tour itself says in three steps what the module keeps, how it fills itself,
// and what one of its records looks like (a made-up example, labelled so). Got it puts it away;
// Settings › Packs › Show me around clears what this PC remembers, and the link is there whenever the
// person wants it again.

import { useEffect, useState } from 'react';
import type { LifeModule } from '../../../../shared/life-modules';
import { tourSteps } from '../../../../shared/module-purpose';
import { Icon, type IconName } from '../../components/Icon';
import { TOUR_CLOSE, TOUR_OPEN, setTourSeen, takePendingTour } from '../../state/moduleFills';
import '../../styles/module-purpose.css';

export function ModuleTour({ module, sep = true, link = true }: { module: LifeModule; sep?: boolean; link?: boolean }) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  useEffect(() => {
    // Only the pack's mounted host (no link) answers openTour: the shells' own links open by a click, so two
    // dialogs never open at once.
    if (link) return;
    if (takePendingTour(module.id)) {
      setStep(0);
      setOpen(true);
    }
    const onOpen = (e: Event) => {
      if ((e as CustomEvent<string>).detail === module.id) {
        setStep(0);
        setOpen(true);
      }
    };
    window.addEventListener(TOUR_OPEN, onOpen);
    return () => window.removeEventListener(TOUR_OPEN, onOpen);
  }, [module.id, link]);
  useEffect(() => {
    // A dialog opened over the tour puts it away (every host answers, link or not). Not marked seen: the
    // person never finished it, and the link stays for when they want it again.
    const onClose = () => {
      setStep(0);
      setOpen(false);
    };
    window.addEventListener(TOUR_CLOSE, onClose);
    return () => window.removeEventListener(TOUR_CLOSE, onClose);
  }, []);
  if (!open) {
    if (!link) return null;
    return (
      <span className="mp-tour-link">
        {sep ? <span className="mp-tour-sep" aria-hidden="true"> · </span> : null}
        <button type="button" className="text-button mp-tour-button" onClick={() => { setStep(0); setOpen(true); }}>
          Show me around {module.name}
        </button>
      </span>
    );
  }
  const done = () => {
    setTourSeen(module.id, true);
    setOpen(false);
  };
  const steps = tourSteps(module);
  const s = steps[step];
  return (
    <aside className="mt-tour" role="dialog" aria-label={`${module.name}: a short tour`}>
      <header className="mt-head">
        <span className="mt-icon" aria-hidden="true">
          <Icon name={module.icon as IconName} size={15} />
        </span>
        <span className="mt-step">
          {step + 1} of {steps.length}
        </span>
        <button type="button" className="mt-close" aria-label="Close the tour" title="Close" onClick={done}>
          <Icon name="close" size={13} />
        </button>
      </header>
      <h2 className="mt-title">{s.title}</h2>
      <div className="mt-body">
        {s.example ? (
          <div className="mt-example" aria-label="An example record, made up">
            <span className="mt-example-tag">Example</span>
            <b>{s.example.title}</b>
            <ul>
              {s.example.lines.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          </div>
        ) : (
          <p>{s.body}</p>
        )}
      </div>
      <footer className="mt-foot">
        <span className="mt-dots" aria-hidden="true">
          {steps.map((_, i) => (
            <i key={i} className={i === step ? 'is-on' : ''} />
          ))}
        </span>
        {step > 0 && (
          <button type="button" className="text-button" onClick={() => setStep(step - 1)}>
            Back
          </button>
        )}
        {step < steps.length - 1 ? (
          <button type="button" className="button small primary" onClick={() => setStep(step + 1)}>
            Next
          </button>
        ) : (
          <button type="button" className="button small primary" onClick={done}>
            Got it
          </button>
        )}
      </footer>
    </aside>
  );
}
