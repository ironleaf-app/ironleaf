// The window's way to Publish as a website (9.0 w122publish; src/main/site-publish.ts). Built by the preload bridge
// with its own invoke, so every channel is Ironleaf's.

import type { HostView, PublishedSiteView } from '../main/site-publish';
import type { ResolvedSite, SiteDef, SiteSource } from './site-publish';

export interface SiteDraft {
  name: string;
  description: string;
  source: SiteSource;
}

export interface SitePreview {
  url: string;
  dir: string;
  included: ResolvedSite['included'];
  excluded: ResolvedSite['excluded'];
  warnings: string[];
  words: string;
}

export interface SiteHosts {
  available: boolean;
  hosts: HostView[];
  last: string;
}

export function sitePublishApi(invoke: <T>(channel: string, ...args: unknown[]) => Promise<T>) {
  return {
    list: () => invoke<SiteDef[]>('site:list'),
    save: (input: Partial<SiteDef> & { source: SiteSource }) => invoke<SiteDef>('site:save', input),
    remove: (id: string) => invoke<{ removed: boolean; words: string }>('site:remove', id),
    resolve: (ref: string | SiteDraft) => invoke<ResolvedSite & { words: string }>('site:resolve', ref),
    preview: (ref: string | SiteDraft) => invoke<SitePreview>('site:preview', ref),
    publish: (id: string) => invoke<{ words: string; site: SiteDef; host?: PublishedSiteView } | null>('site:publish', id),
    unpublish: (id: string, confirm: boolean) => invoke<{ words: string } | { ask: { title: string; text: string; confirm: string; cancel: string } }>('site:unpublish', id, confirm),
    marks: () => invoke<{ path: string; sites: { id: string; name: string }[] }[]>('site:marks'),
    hosts: () => invoke<SiteHosts>('site:hosts'),
    connect: (host: string, keys: Record<string, string>) => invoke<{ connected: boolean; account: string }>('site:host-connect', { host, keys }),
    disconnect: (host: string) => invoke<{ connected: boolean }>('site:host-disconnect', { host }),
    options: (host: string, accountId?: string) => invoke<{ accounts: { id: string; label: string; needsSignIn: boolean }[]; accountId: string; repositories: { fullName: string; private: boolean }[]; computers: { id: string; label: string; address: string }[]; starting: boolean }>('site:host-options', { host, accountId }),
    pickFolder: () => invoke<string | null>('site:pick-folder'),
    open: (id: string) => invoke<string>('site:open', id),
  };
}

export type SitePublishApi = ReturnType<typeof sitePublishApi>;
