import { createHash } from 'node:crypto';
import { readProps } from '../../shared/frontmatter';
import { isMeetingNote } from '../../shared/meetings';
import { isPrivatePath } from '../../shared/private';
import { setNoteProp } from '../../shared/views';
import type { WorkModules } from '../work-modules';

export interface DeliveryRow {
  address: string;
  status: 'draft saved' | 'sent' | 'check sent mail' | 'failed' | 'cancelled';
  detail?: string;
}

/** A receipt belongs to this exact message and recipient. Save an intent before a network send so that
 * a lost acknowledgement or a restart can't silently send a second copy. */
export function meetingDelivery(w: WorkModules) {
  const active = new Set<string>();
  return async (rel: string, audience: unknown, subject: unknown, body: unknown, mode: unknown): Promise<DeliveryRow[]> => {
    const vault = w.d.vault().root;
    const checkVault = () => {
      if (w.d.vault().root !== vault) throw new Error('Open the original vault to continue this follow-up.');
    };
    if (!Array.isArray(audience) || audience.length > 40 || !audience.length) throw new Error('Choose between one and forty recipients.');
    const addresses = [...new Set(audience.map(a => String(a).trim().toLowerCase()))];
    if (addresses.some(a => a.length > 254 || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(a))) throw new Error('Check each email address before continuing.');
    if (typeof subject !== 'string' || !subject.trim() || subject.length > 200 || /[\r\n]/.test(subject)) throw new Error('Give the message a single-line subject of up to 200 characters.');
    if (typeof body !== 'string' || !body.trim() || body.length > 60000) throw new Error('Review the message. It needs 1 to 60,000 characters.');
    if (mode !== 'draft' && mode !== 'send') throw new Error('Choose how to deliver the follow-up.');
    if (mode === 'send' && !w.d.sendMail) throw new Error('Save email drafts to send with your mail app.');
    if (isPrivatePath(rel) || !isMeetingNote(rel, readProps(w.noteText(rel)))) throw new Error('Choose a meeting note for this follow-up.');
    const key = JSON.stringify([vault, rel]);
    if (active.has(key)) throw new Error('This meeting’s follow-up is already being prepared.');
    active.add(key);
    try {
      await w.d.requireCreate();
      const rows: DeliveryRow[] = [];
      for (const address of addresses) {
        checkVault();
        const id = createHash('sha256').update(JSON.stringify([mode, address, subject, body])).digest('hex');
        const receipts = (text: string): string[] => {
          const value = readProps(text).follow_up_receipts;
          return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
        };
        const record = async (state: string) => {
          checkVault();
          await w.change(rel, text => {
            const keep = receipts(text).filter(r => !r.startsWith(id + ':'));
            if (state) keep.push(id + ':' + state);
            return setNoteProp(text, 'follow_up_receipts', keep.length ? keep : null);
          });
        };
        const previous = receipts(w.noteText(rel)).find(r => r.startsWith(id + ':'));
        if (previous) {
          rows.push({ address, status: previous.endsWith(':pending') ? 'check sent mail' : mode === 'send' ? 'sent' : 'draft saved' });
          continue;
        }
        if (mode === 'draft') {
          const payload = Buffer.from(body.replace(/\r?\n/g, '\r\n')).toString('base64').match(/.{1,76}/g)!.join('\r\n');
          const header = [...subject].reduce<string[]>((parts, ch) => {
            if (Buffer.byteLength(parts.at(-1)! + ch) > 42) parts.push('');
            parts[parts.length - 1] += ch;
            return parts;
          }, ['']).map(part => '=?UTF-8?B?' + Buffer.from(part).toString('base64') + '?=').join('\r\n ');
          const data = ['X-Unsent: 1', 'To: ' + address, 'Subject: ' + header, 'MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', payload, ''].join('\r\n');
          try {
            const saved = await w.d.saveFile({ title: 'Save email draft for ' + address, name: 'Meeting follow-up ' + address + ' ' + id.slice(0, 8), ext: 'eml', filter: 'Email draft', data });
            if (!saved) { rows.push({ address, status: 'cancelled' }); break; }
          } catch (e) { rows.push({ address, status: 'failed', detail: e instanceof Error ? e.message : 'Could not save this draft.' }); continue; }
          await record('saved');
          rows.push({ address, status: 'draft saved' });
        } else {
          await record('pending');
          checkVault();
          try {
            const result = await w.d.sendMail!({ to: [address], subject, text: body });
            await record(result.ok ? 'sent' : '');
            rows.push({ address, status: result.ok ? 'sent' : 'failed', detail: result.ok ? undefined : result.words });
          } catch {
            rows.push({ address, status: 'check sent mail' });
          }
        }
      }
      return rows;
    } finally { active.delete(key); }
  };
}
