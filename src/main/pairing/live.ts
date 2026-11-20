// Keeping a live source in step (V10, V11, 29 Oct 2026): read it with the person's token, bring it in through the
// same engine as an export (src/main/pairing/engine.ts), and send back any note only the person changed. Nothing
// here holds a token beyond the call, and nothing writes one anywhere.

import { frontMatterRange } from '../../shared/frontmatter';
import type { LiveKind } from '../../shared/pairing/types';
import type { PairSummary } from '../../shared/pairing/types';
import { importSource, liveSource, type ImportOptions } from './engine';
import { pushNotion, readNotionLive, type FetchFn } from './notion-live';
import { pushTodoist, readTodoistLive } from './todoist-live';

export const LIVE_INTO: Record<LiveKind, string> = { notion: 'From Notion/Live', todoist: 'From Todoist/Live' };

/** One sync of a live source. `token` comes from the app's secret store and goes no further than the requests. */
export async function syncLive(root: string, kind: LiveKind, token: string, o: ImportOptions & { fetchFn?: FetchFn; base?: string } = {}): Promise<PairSummary> {
  const fetchFn = o.fetchFn ?? ((url: string, init?: any) => fetch(url, init) as any);
  const client = { fetchFn, token, ...(o.base ? { base: o.base } : {}) };
  const read = kind === 'notion' ? await readNotionLive(client) : await readTodoistLive(client);
  const src = await liveSource(root, read, { sourceFile: kind === 'notion' ? 'Notion (kept in step)' : 'Todoist (kept in step)', into: LIVE_INTO[kind] });
  try {
    return await importSource(root, src, {
      ...o,
      push: async (change) => {
        if (kind === 'notion') return pushNotion(client, { id: change.id, props: change.props, idOfLink: change.idOfLink });
        const fm = frontMatterRange(change.mine);
        // The file's name now vs what Todoist holds (F22: a rename here renames the task there).
        const title = change.rel.split('/').pop()?.replace(/\.md$/i, '') ?? '';
        return pushTodoist(client, { id: change.id, props: change.props, body: fm ? change.mine.slice(fm.to) : change.mine, title, itemTitle: change.item.title });
      },
    });
  } finally {
    await src.done();
  }
}
