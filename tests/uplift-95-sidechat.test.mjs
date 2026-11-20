// node --test tests/uplift-95-sidechat.test.mjs — the 9.5 polished round's side-chat batch: the chat follows
// new messages only while the person is at the bottom (scrolled up reading, it stays put; the floating Ask is gone);
// Stop holds the waiting questions, which run in order behind the next one asked; saving two answers in a minute
// falls back to seconds, never a " 2". The views are guarded by the mechanism they carry, so each check fails
// without its fix.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const root = path.join(import.meta.dirname, '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');

test('the log follows only at the bottom: scrolled up reading, it stays put', () => {
  const panel = read('src/renderer/src/panels/ChatPanel.tsx');
  assert.ok(panel.includes('const stick = useRef(true);'), 'the side chat remembers whether the person is at the bottom');
  assert.ok(panel.includes('stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;'), 'scrolling says so');
  assert.ok(panel.includes('if (stick.current) log.current?.scrollTo({ top: log.current.scrollHeight });'), 'new messages scroll only then');
  assert.doesNotMatch(panel, /useEffect\(\(\) => \{\n    log\.current\?\.scrollTo/, 'never unconditionally');
});

test('Stop holds the waiting questions: they run in order behind the next one asked', () => {
  const chat = read('src/renderer/src/state/chat.ts');
  assert.ok(chat.includes('let heldAfterStop = false;'), 'the hold');
  assert.ok(chat.includes('heldAfterStop = true;'), 'stopping holds');
  assert.ok(chat.includes('if (heldAfterStop) {'), 'the drain respects the hold');
  assert.ok(chat.includes('still waiting: it sends first when you ask next.'), 'and says what waits');
  // The t50 break-it (9 Nov 2026) gave sendChat a fifth askedIn scope after fromQueue (pinned by
  // chat-aware-panel.test.mjs), so these two pins match the marked drains without their closing bracket.
  assert.ok(chat.includes('export async function sendChat(question: string, note?: string, attachments?: ChatAttachment[], fromQueue = false'), 'drains marked');
  assert.ok(chat.includes('export async function askChosen(question: string, folder: string, fromQueue = false)'), 'both entries');
  assert.ok(chat.includes('if (store.queued.length && !fromQueue) {'), 'a new question joins behind the waiting ones');
  assert.ok(chat.includes('void askChosen(next.question, next.folder, true);'), 'the drain runs oldest first');
  assert.ok(chat.includes('void sendChat(next.question, next.note, next.attachments ?? [], true'), 'in both shapes');
  assert.doesNotMatch(chat, /function sendQueued\(\): void \{\n  const \[next/, 'never straight to the oldest after a stop');
});

test('two answers saved in a minute fall back to seconds, never a " 2"', () => {
  const panel = read('src/renderer/src/panels/ChatPanel.tsx');
  assert.ok(panel.includes("formatDate('h:mm:ss A')"), 'seconds when the minute is taken');
  assert.ok(panel.includes('never a " 2"'), 'said at the fallback');
});
