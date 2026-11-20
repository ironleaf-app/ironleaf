// The albums' shared pieces (Wave 7 part b; src/shared/memories.ts, src/main/life-records/memories.ts), shown under
// Family since the packs uplift item 5 merged Memories into Family: new-album and new-project forms, photo tiles and
// cards, and one person's and one project's pages. Albums by event, trip, person and year; who is in each photo and
// its caption written by the person; creative projects from idea to shared, each with its brief and every version.
// Every photo is protected: Family-private, so an assistant needs the person's OK for each use.

import { CREATIVE_KINDS, CREATIVE_STATUSES } from '../../../../../shared/life-records';
import { BRIEF_KEYS, type Album, type Creative, type MemoriesModel, type Photo } from '../../../../../shared/memories';
import { EmptyState } from '../../../components/EmptyState';
import { Icon } from '../../../components/Icon';
import { openMenu, type MenuItem } from '../../../components/Menu';
import { fileUrl } from '../../../lib/resolve';
import * as A from '../../../state/actions';
import { peek } from '../../../state/peek';
import { workCall, workDid } from '../../../state/workModules';
import { openRecordForm, valueWords } from '../RecordForm';
import { Avatar } from '../../workspace/recordParts';
import { Card, dayText, inDays, openDetail, Pill } from '../work/WorkShell';
import { Fact, Inline, plural, saved } from './parts';

export type MemoriesView = MemoriesModel & { folder: string; peopleNames: string[] };

const call = <T,>(name: string, ...args: unknown[]) => workCall<T>('memories', name, ...args);
export const openAlbum = (rel: string) => openDetail('family', 'album', rel);
export const openCreative = (rel: string) => openDetail('family', 'creative', rel);
export const openPerson = (name: string) => openDetail('family', 'person', name);
export const set = (kind: string, rel: string, field: string) => (v: string) => saved(call('set-field', { kind, path: rel, field, value: v }));
export const span = (a: { date: string | null; end: string | null }) => (a.date ? `${dayText(a.date)}${a.end && a.end !== a.date ? ` to ${dayText(a.end)}` : ''}` : 'No day');
export const statusTone = (s: string): 'ok' | 'warn' | undefined => (/^(done|shared)$/i.test(s) ? 'ok' : /^making$/i.test(s) ? 'warn' : undefined);

// ── Doing things ─────────────────────────────────────────────────────────────────────────────────────────────────────

export function newAlbum(m: MemoriesView | null): void {
  openRecordForm({
    title: 'New album',
    icon: 'image',
    line: 'Photos and videos of one event, trip, person or year. They are kept beside it and stay Family-private.',
    ok: 'Make the album',
    fields: [
      { key: 'name', label: 'Album', kind: 'text', required: true, wide: true, placeholder: 'Beach weekend' },
      { key: 'kind', label: 'Kind', kind: 'segment', options: ['Event', 'Trip', 'Person', 'Year', 'Everyday'], value: 'Event' },
      { key: 'date', label: 'Day', kind: 'date' },
      { key: 'end', label: 'Last day', kind: 'date', hint: 'For a trip or a few days away.' },
      { key: 'place', label: 'Place', kind: 'text' },
      { key: 'people', label: 'Who was there', kind: 'text', wide: true, placeholder: m?.peopleNames.slice(0, 3).join(', ') || 'Names, separated by commas' },
    ],
    submit: async (v) => {
      const rel = await call<string>('add-album', Object.fromEntries(['name', 'kind', 'date', 'end', 'place', 'people'].map((k) => [k, valueWords(v, k)])));
      await workDid(Promise.resolve(rel), `Made the album ${valueWords(v, 'name')}.`, { label: 'Open', run: () => openAlbum(rel) });
    },
  });
}

export function newCreative(m: MemoriesView | null): void {
  openRecordForm({
    title: 'New creative project',
    icon: 'canvas',
    line: 'A poster, card, invitation, photo book or video. Start with its brief: what it is for, who sees it, how it should feel and what it must have.',
    ok: 'Start it',
    fields: [
      { key: 'name', label: 'Project', kind: 'text', required: true, wide: true, placeholder: 'Sports day poster' },
      { key: 'kind', label: 'Kind', kind: 'choice', options: [...CREATIVE_KINDS], value: 'Poster' },
      { key: 'occasion', label: 'Occasion', kind: 'text', placeholder: 'School sports day' },
      { key: 'people', label: 'For', kind: 'text', placeholder: m?.peopleNames.slice(0, 2).join(', ') || 'Names' },
      { key: 'due', label: 'Needed by', kind: 'date' },
      { key: 'purpose', label: 'Purpose', kind: 'text', wide: true, placeholder: 'Cheer the girls on at sports day' },
      { key: 'audience', label: 'Audience', kind: 'text', placeholder: 'The whole school' },
      { key: 'tone', label: 'Tone', kind: 'text', placeholder: 'Bright and funny' },
      { key: 'must', label: 'Must-haves', kind: 'text', wide: true, placeholder: 'Both girls’ photos, the house colours' },
    ],
    submit: async (v) => {
      const rel = await call<string>('add-creative', Object.fromEntries(['name', 'kind', 'occasion', 'people', 'due', 'purpose', 'audience', 'tone', 'must'].map((k) => [k, valueWords(v, k)])));
      await workDid(Promise.resolve(rel), `Started ${valueWords(v, 'name')}.`, { label: 'Open', run: () => openCreative(rel) });
    },
  });
}

export function photoForm(p: Photo, people: string[]): void {
  openRecordForm({
    title: p.caption || p.name,
    icon: 'image',
    line: 'Who is in it, written by you (never worked out from faces), and what it was.',
    ok: 'Save',
    fields: [
      { key: 'who', label: 'Who is in it', kind: 'text', wide: true, value: p.who.join(', '), placeholder: people.slice(0, 3).join(', ') || 'Names, separated by commas' },
      { key: 'caption', label: 'Caption', kind: 'text', wide: true, value: p.caption },
      { key: 'date', label: 'Day', kind: 'date', value: p.date ?? '' },
    ],
    submit: async (v) => {
      await call('photo', p.album, p.name, { who: valueWords(v, 'who'), caption: valueWords(v, 'caption'), date: valueWords(v, 'date') });
      await workDid(Promise.resolve(null), 'Saved.');
    },
  });
}

export async function addPhotos(rel: string, name: string): Promise<void> {
  const files = await workDid(call<string[]>('pick-photos', `Photos and videos for ${name}`), '');
  if (files?.length) await workDid(call<string>('keep-photos', rel, files));
}

export const peekPhoto = (p: { rel: string; name: string }) => peek({ type: 'file', path: p.rel }, { title: p.name, type: 'file' });

// ── Pieces ───────────────────────────────────────────────────────────────────────────────────────────────────────────

export function Protected({ wide }: { wide?: boolean }) {
  return (
    <span className={`lr-protected${wide ? ' is-wide' : ''}`} title="Family-private: an assistant needs your OK each time it uses one of these photos.">
      <Icon name="lock" size={11} /> {wide ? 'Protected: an assistant needs your OK each time it uses a photo here' : 'Protected'}
    </span>
  );
}

export function Thumb({ rel, video, alt, size = 'm' }: { rel: string | null; video?: boolean; alt: string; size?: 's' | 'm' | 'l' }) {
  if (!rel) return <span className={`lr-thumb is-empty size-${size}`} aria-hidden="true"><Icon name="image" size={size === 's' ? 14 : 22} /></span>;
  if (video)
    return (
      <span className={`lr-thumb is-video size-${size}`} aria-label={alt}>
        <Icon name="play" size={size === 's' ? 14 : 20} />
      </span>
    );
  return (
    <span className={`lr-thumb size-${size}`}>
      <img src={fileUrl(rel)} alt={alt} loading="lazy" />
    </span>
  );
}

export function AlbumCard({ a }: { a: Album }) {
  return (
    <li className="lr-album">
      <button type="button" className="lr-album-main" onClick={() => openAlbum(a.path)}>
        <Thumb rel={a.cover} alt="" size="l" />
        <span className="lr-album-words">
          <span className="lr-album-name">{a.name}</span>
          <span className="lr-album-sub">{[a.kind, span(a), a.place].filter(Boolean).join(' · ')}</span>
          <span className="lr-album-foot">
            <span>
              {plural(a.photos.length - a.videos, 'photo')}
              {a.videos ? `, ${plural(a.videos, 'video')}` : ''}
            </span>
            {a.people.length > 0 && (
              <span className="lr-faces" aria-label={`With ${a.people.join(', ')}`}>
                {a.people.slice(0, 4).map((n) => (
                  <Avatar key={n} name={n} size={20} />
                ))}
              </span>
            )}
          </span>
        </span>
      </button>
    </li>
  );
}

function PhotoTile({ p, people, canEdit, showAlbum }: { p: Photo; people: string[]; canEdit: boolean; showAlbum?: boolean }) {
  const menu = (): MenuItem[] => [
    { label: 'Open', icon: 'eye', run: () => peekPhoto(p) },
    { label: 'Who is in it, caption and day…', icon: 'people', disabled: !canEdit, run: () => photoForm(p, people) },
    { label: 'Make it the album’s cover', icon: 'image', disabled: !canEdit || p.video, run: () => void workDid(call<string>('cover', p.album, p.name)) },
    { separator: true },
    { label: 'Show in its folder', icon: 'folder', run: () => A.revealInExplorer(p.rel) },
  ];
  return (
    <li className="lr-photo">
      <button type="button" className="lr-photo-main" onClick={() => peekPhoto(p)} onContextMenu={(e) => {
          e.preventDefault();
          openMenu({ clientX: e.clientX, clientY: e.clientY }, menu());
        }} title={p.name}>
        <Thumb rel={p.rel} video={p.video} alt={p.caption || p.name} />
      </button>
      <div className="lr-photo-foot">
        <button type="button" className="lr-photo-words" disabled={!canEdit} onClick={() => photoForm(p, people)} title={canEdit ? 'Who is in it, caption and day' : undefined}>
          <span className={`lr-photo-caption${p.caption ? '' : ' is-empty'}`}>{p.caption || (canEdit ? 'Add a caption' : p.name)}</span>
          <span className="lr-photo-who">{p.who.length ? p.who.join(', ') : showAlbum ? p.albumName : canEdit ? 'Who is in it?' : ''}</span>
        </button>
        <button type="button" className="icon-button small" aria-label={`More for ${p.name}`} onClick={(e) => openMenu(e.currentTarget, menu())}>
          <Icon name="more" size={13} />
        </button>
      </div>
    </li>
  );
}

export function PersonCard({ name, photos, albums }: { name: string; photos: Photo[]; albums: number }) {
  const pics = photos.filter((p) => !p.video).slice(0, 4);
  return (
    <li className="lr-person">
      <button type="button" className="lr-person-main" onClick={() => openPerson(name)}>
        <span className={`lr-mosaic n-${Math.max(1, pics.length)}`}>
          {pics.length ? pics.map((p) => <img key={p.rel} src={fileUrl(p.rel)} alt="" loading="lazy" />) : <Avatar name={name} size={44} />}
        </span>
        <span className="lr-person-words">
          <span className="lr-person-name">{name}</span>
          <span className="lr-person-sub">
            {plural(photos.length, 'photo')} · {plural(albums, 'album')}
          </span>
        </span>
      </button>
    </li>
  );
}

export function CreativeCard({ c, today }: { c: Creative; today: string }) {
  const latest = c.versions.find((v) => v.picture);
  return (
    <li className="lr-creative">
      <button type="button" className="lr-creative-main" onClick={() => openCreative(c.path)}>
        <Thumb rel={latest?.rel ?? null} alt="" size="s" />
        <span className="lr-creative-words">
          <span className="lr-creative-name">{c.name}</span>
          <span className="lr-creative-sub">{[c.kind, c.occasion, c.due && (c.dueDays !== null && c.dueDays < 0 ? `was needed ${dayText(c.due)}` : `needed ${dayText(c.due)}, ${inDays(c.due, today)}`)].filter(Boolean).join(' · ')}</span>
        </span>
        <Pill tone={statusTone(c.status)}>{c.status}</Pill>
      </button>
    </li>
  );
}

// ── One person, one project ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export function PersonPage({ name, m, canEdit }: { name: string; m: MemoriesView; canEdit: boolean }) {
  const p = m.people.find((x) => x.name.toLowerCase() === name.toLowerCase());
  const people = [...new Set([...m.peopleNames, ...m.people.map((x) => x.name)])];
  if (!p) return <EmptyState noFills icon="people" title={`No photos of ${name} yet`} line="Say who is in a photo (its caption, on an album’s page) to see it here." />;
  const byAlbum = p.albums.map((rel) => m.albums.find((a) => a.path === rel)!).filter(Boolean);
  return (
    <div className="rm-overview">
      {byAlbum.map((a) => {
        const photos = p.photos.filter((x) => x.album === a.path);
        return (
          <Card key={a.path} id={`a-${a.path}`} title={a.name} count={photos.length} link={{ label: 'Open the album', run: () => openAlbum(a.path) }}>
            {photos.length ? (
              <ul className="lr-photos">
                {photos.map((x) => (
                  <PhotoTile key={x.rel} p={x} people={people} canEdit={canEdit} />
                ))}
              </ul>
            ) : (
              <p className="rm-none">Named in this album; no photo of {name} is marked yet.</p>
            )}
          </Card>
        );
      })}
    </div>
  );
}

export function CreativePage({ c, m, canEdit }: { c: Creative; m: MemoriesView; canEdit: boolean }) {
  const addVersion = async () => {
    const files = await workDid(call<string[]>('pick-files', `A new version of ${c.name}`), '');
    if (files?.length) await workDid(call<string>('keep-files', c.path, files));
  };
  return (
    <div className="lr-detail">
      <div className="lr-detail-main">
        <Card id="brief" title="Brief">
          <div className="lr-brief">
            {BRIEF_KEYS.map((k) => (
              <div key={k.key} className="lr-brief-row">
                <span className="lr-brief-label">{k.label}</span>
                <Inline value={c.brief[k.key]} label={k.label} placeholder={k.key === 'purpose' ? 'What is it for?' : k.key === 'audience' ? 'Who will see it?' : k.key === 'tone' ? 'Funny, formal, playful…' : 'What it must have'} canEdit={canEdit} onSave={(v) => saved(call('brief', c.path, k.key, v))} />
              </div>
            ))}
          </div>
        </Card>
        <Card id="versions" title="Versions" count={c.versions.length} actions={canEdit ? <button type="button" className="text-button" onClick={() => void addVersion()}><Icon name="plus" size={12} /> Add a version</button> : undefined}>
          {c.versions.length ? (
            <ul className="lr-versions">
              {c.versions.map((v, i) => (
                <li key={v.rel} className={`lr-version-card${i === 0 ? ' is-latest' : ''}`}>
                  <button type="button" onClick={() => peekPhoto(v)} title={v.name}>
                    <Thumb rel={v.picture ? v.rel : null} video={!v.picture} alt={v.name} />
                    <span className="lr-version-words">
                      <span className="lr-version-label">
                        {v.label}
                        {i === 0 && <span className="lr-tag">Latest</span>}
                      </span>
                      <span className="lr-version-name">{v.name}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="rm-none">No versions yet. Keep each draft here (a picture, a PDF or a video) so you can go back to any of them.</p>
          )}
          {c.files.length > 0 && <p className="lr-hint">{plural(c.files.length, 'other file')} kept with it.</p>}
        </Card>
      </div>
      <aside className="lr-detail-side">
        <Card id="details" title="Details">
          <div className="lr-facts">
            <Fact label="Status">
              <Inline value={c.status} shown={<Pill tone={statusTone(c.status)}>{c.status}</Pill>} label="Status" kind="choice" options={[...CREATIVE_STATUSES]} canEdit={canEdit} onSave={set('creative', c.path, 'status')} />
            </Fact>
            <Fact label="Kind">
              <Inline value={c.kind} label="Kind" kind="choice" options={[...CREATIVE_KINDS]} canEdit={canEdit} onSave={set('creative', c.path, 'creative_kind')} />
            </Fact>
            <Fact label="Occasion" wide>
              <Inline value={c.occasion} label="Occasion" placeholder="Add" canEdit={canEdit} onSave={set('creative', c.path, 'occasion')} />
            </Fact>
            <Fact label="For" wide>
              <Inline value={c.people.join(', ')} label="For" kind="choice" own options={m.peopleNames} placeholder="Add names" canEdit={canEdit} onSave={set('creative', c.path, 'people')} />
            </Fact>
            <Fact label="Needed by">
              <Inline value={c.due ?? ''} shown={c.due ? `${dayText(c.due)} · ${inDays(c.due, m.today)}` : undefined} label="Needed by" kind="date" placeholder="Add" canEdit={canEdit} onSave={set('creative', c.path, 'due')} />
            </Fact>
            <Fact label="Photos from">
              <Inline value={c.album} label="Album" kind="choice" options={['', ...m.albums.map((a) => a.name)]} placeholder="Choose an album" canEdit={canEdit} onSave={set('creative', c.path, 'album')} />
            </Fact>
          </div>
          {c.albumPath && (
            <button type="button" className="text-button lr-goto" onClick={() => openAlbum(c.albumPath!)}>
              <Icon name="image" size={12} /> {c.album}
            </button>
          )}
        </Card>
      </aside>
    </div>
  );
}

// ── The page ─────────────────────────────────────────────────────────────────────────────────────────────────────────

