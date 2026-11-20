// A card or page that fails never blanks the window (8.7 urgent, 30 Oct 2026, the reviewer: one meeting time blanked
// the whole Vault). Each Home card sits in a CardGuard, each page's main area in a PageGuard, and the app itself in an
// AppGuard: a failure shows small plain words with Try again while everything else keeps working. What was caught is
// written to the guard's own log file too (8.7.1, 31 Oct 2026, never silent: the error only went to the console, so
// nobody could read it afterwards), and the card offers Copy details so the person can send it. Only React on purpose:
// a guard must never fail on what it leans on, so the fallbacks are plain markup on the kit's own classes, and
// reporting and copying are best-effort only.

import { Component, type ErrorInfo, type ReactNode } from 'react';

type GuardKind = 'card' | 'page' | 'app';

interface Caught {
  at: string;
  message: string;
  stack: string;
}

export class ErrorBoundary extends Component<{ children: ReactNode; kind: GuardKind; name?: string }, { failed: boolean; caught: Caught | null; copied: boolean }> {
  state = { failed: false, caught: null as Caught | null, copied: false };
  private standing = false;
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }
  componentDidMount(): void {
    this.standing = true;
  }
  componentWillUnmount(): void {
    this.standing = false;
  }
  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[neuralvault:${this.props.name ?? this.props.kind}]`, error);
    try {
      const message = error?.message || String(error);
      const stack = error?.stack ?? '';
      const components = info?.componentStack ?? '';
      if (this.standing) this.setState({ caught: { at: new Date().toISOString(), message: message.slice(0, 2000), stack: [stack, components].filter(Boolean).join('\n').slice(0, 8000) } });
      window.nv.errors.report({ kind: this.props.kind, name: this.props.name ?? this.props.kind, message: message.slice(0, 2000), stack: stack.slice(0, 8000), ...(components ? { components: components.slice(0, 4000) } : {}) }).catch(() => {});
    } catch {
      // Reporting is best-effort only.
    }
  }
  private retry = (): void => {
    if (this.props.kind === 'app') window.location.reload();
    else this.setState({ failed: false, caught: null, copied: false });
  };
  /** Copy what the guard caught, for a message to support (the page kind, the time and the error, never note words). */
  private copy = (): void => {
    const caught = this.state.caught;
    const words = ['Something in Ironleaf could not show.', `Where: ${this.props.kind} (${this.props.name ?? this.props.kind})`, `Time: ${caught?.at ?? ''}`, '', caught?.message ?? '', caught?.stack ?? '']
      .join('\n')
      .replace(/\n{3,}/g, '\n\n');
    const done = (): void => {
      if (this.standing) this.setState({ copied: true });
    };
    try {
      if (navigator.clipboard?.writeText) void navigator.clipboard.writeText(words).then(done, () => {});
      else {
        const box = document.createElement('textarea');
        box.value = words;
        document.body.appendChild(box);
        box.select();
        document.execCommand('copy');
        box.remove();
        done();
      }
    } catch {
      // Copying stays offering.
    }
  };
  render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    const copied = this.state.copied ? 'Copied' : 'Copy details';
    if (this.props.kind === 'card')
      return (
        <section aria-label="A card that could not show">
          <div className="card home-card">
            <div className="home-quiet">
              <b>This card couldn&apos;t show.</b>
              <p>Your notes are safe. Try again.</p>
              <button className="btn" onClick={this.retry}>Try again</button> <button className="btn" onClick={this.copy}>{copied}</button>
            </div>
          </div>
        </section>
      );
    if (this.props.kind === 'page')
      return (
        <div className="nv-empty is-page" role="alert">
          <p className="nv-empty-title">This page couldn&apos;t show.</p>
          <p className="nv-empty-line">Your notes are safe.</p>
          <div className="nv-empty-actions">
            <button type="button" className="button primary" onClick={this.retry}>Try again</button>
            <button type="button" className="button" onClick={this.copy}>{copied}</button>
          </div>
        </div>
      );
    return (
      <div className="nv-empty is-page" role="alert" style={{ minHeight: '100vh', justifyContent: 'center' }}>
        <p className="nv-empty-title">Something went wrong.</p>
        <p className="nv-empty-line">Your notes are safe.</p>
        <div className="nv-empty-actions">
          <button type="button" className="button primary" onClick={this.retry}>Try again</button>
          <button type="button" className="button" onClick={this.copy}>{copied}</button>
        </div>
      </div>
    );
  }
}

/** One Home card's guard: a card that fails shows small plain words while the rest of Home keeps working. */
export function CardGuard({ children, name }: { children: ReactNode; name?: string }) {
  return (
    <ErrorBoundary kind="card" name={name ?? 'card'}>
      {children}
    </ErrorBoundary>
  );
}

/** A page's main area's guard: a page that fails shows plain words with Try again instead of a blank window. */
export function PageGuard({ children, name }: { children: ReactNode; name?: string }) {
  return (
    <ErrorBoundary kind="page" name={name ?? 'page'}>
      {children}
    </ErrorBoundary>
  );
}

/** The whole app's guard: the last net under everything, whose Try again starts the window over. */
export function AppGuard({ children }: { children: ReactNode }) {
  return <ErrorBoundary kind="app">{children}</ErrorBoundary>;
}
