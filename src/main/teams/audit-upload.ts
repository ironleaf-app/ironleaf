// SPDX-License-Identifier: AGPL-3.0-or-later
// Ironleaf Teams' opt-in audit upload: when the team's policy asks for it (policy.ts › audit.uploadAgentAccess), what
// AI apps and agents did on this PC ("What agents did") goes to the team's audit trail (POST /audit). Only the kind,
// the time, the agent, the tool and the outcome: never a note's name, path or words. Off, nothing is kept or sent.

import type { AuditEvent, AuditSink } from '../enterprise';
import type { AuditOut } from './api';

const MAX_QUEUE = 1000;
const BATCH = 100;

export interface AuditUploadDeps {
  /** Whether the team's policy asks for the upload, and the team it goes to. */
  target(): { teamId: string; deviceId: string | null } | null;
  upload(teamId: string, deviceId: string | null, events: AuditOut[]): Promise<void>;
  log?(m: string): void;
}

/** Turns one core audit event into what may leave the PC, or null for events that never do. */
export function auditOut(e: AuditEvent): AuditOut | null {
  if (!/^(agent|mcp)\./.test(e.kind)) return null;
  const d = e.detail ?? {};
  const pick = (v: unknown, max = 80) => (typeof v === 'string' ? v.slice(0, max) : typeof v === 'number' || typeof v === 'boolean' ? v : null);
  return {
    kind: e.kind.slice(0, 64),
    at: e.at,
    detail: { agent: pick(d.agent), agentName: pick(e.actor), tool: pick(d.tool), outcome: e.outcome ?? 'done' },
  };
}

export class AuditUploader implements AuditSink {
  private queue: AuditOut[] = [];
  private flushing: Promise<void> | null = null;
  private timer: NodeJS.Timeout | null = null;
  sent = 0;

  constructor(
    private readonly d: AuditUploadDeps,
    private readonly delayMs = 60_000,
  ) {}

  get waiting(): number {
    return this.queue.length;
  }

  write(e: AuditEvent): void {
    if (!this.d.target()) return;
    const out = auditOut(e);
    if (!out) return;
    this.queue.push(out);
    if (this.queue.length > MAX_QUEUE) this.queue.splice(0, this.queue.length - MAX_QUEUE);
    if (this.queue.length >= 20) void this.flush();
    else if (!this.timer) {
      this.timer = setTimeout(() => void this.flush(), this.delayMs);
      this.timer.unref?.();
    }
  }

  /** Sends what is queued, a batch at a time; a failure keeps the rest for the next try. */
  flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.flushing ??= (async () => {
      try {
        while (this.queue.length) {
          const t = this.d.target();
          if (!t) {
            this.queue = [];
            return;
          }
          const batch = this.queue.slice(0, BATCH);
          await this.d.upload(t.teamId, t.deviceId, batch);
          this.queue.splice(0, batch.length);
          this.sent += batch.length;
        }
      } catch (err) {
        this.d.log?.(`Teams audit upload waits: ${(err as Error).message}`);
      }
    })().finally(() => (this.flushing = null));
    return this.flushing;
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
