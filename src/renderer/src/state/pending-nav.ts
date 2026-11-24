// Where to go, asked for while the notes are loading (one window, 9 Nov 2026: Today and Graph clicks stayed on People;
// 24 Nov 2026: About from the tray was replaced by the last page). The saved layout lands at the end of loading, over
// whatever was opened before it, so what is asked for meanwhile waits and is opened once the notes are there, in the
// order it came. The start itself counts as loading: the settings are read before the notes are.

export class PendingNav {
  private loads = 0;
  private starting = true;
  private queue: (() => void)[] = [];

  /** Now when nothing is loading, else when it has. */
  defer(run: () => void): void {
    if (this.starting || this.loads > 0) this.queue.push(run);
    else run();
  }

  begin(): void {
    this.loads++;
  }

  end(): void {
    this.loads = Math.max(0, this.loads - 1);
    this.land();
  }

  /** The start is over, whether notes opened or not. */
  started(): void {
    this.starting = false;
    this.land();
  }

  private land(): void {
    if (this.starting || this.loads > 0) return;
    const queue = this.queue;
    this.queue = [];
    for (const run of queue) {
      try {
        run();
      } catch {
        // A stale navigation lands nowhere.
      }
    }
  }
}

export const pendingNav = new PendingNav();
