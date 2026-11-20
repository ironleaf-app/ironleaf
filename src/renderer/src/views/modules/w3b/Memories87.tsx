// An album's page (30 Oct 2026; memories-album.html: photo search, photos, who is in them), shown under Family
// since the packs uplift item 5 merged Memories into Family. Every ability the old pages had lives here: albums
// filled, their details changed and deleted to the Bin; photos opened, captioned, named, made the cover and
// deleted to the Bin. One primary button per screen.

import { useMemo, useState } from 'react';
import { ALBUM_KINDS } from '../../../../../shared/life-records';
import { type Album, type Photo } from '../../../../../shared/memories';
import { openMenu } from '../../../components/Menu';
import { writeLink } from '../../../lib/links';
import { fileUrl } from '../../../lib/resolve';
import * as A from '../../../state/actions';
import { openModule } from '../../../state/modules';
import { toast } from '../../../state/store';
import { useWork } from '../../../state/workModules';
import { Avatar } from '../../workspace/recordParts';
import { dayText } from '../work/WorkShell';
import { addPhotos, peekPhoto, photoForm, set, span, type MemoriesView } from '../life/MemoriesPage';
import { RecordFormHost } from '../RecordForm';
import { Inline, plural } from '../life/parts';
import { HomeCard, MoreButton, PackHead, PackPage, PageProps, Section, trashRecord, useCanEdit } from './W3b';
import { deleteToBin } from '../../../lib/removeWords';

const photoCount = (a: Album) => a.photos.length - a.videos;

/** An album's cover: the file, or the pack's tile when it is gone (p15, Nov 2026: a missing file never shows broken).
 *  Shared with Family's albums since the packs uplift item 5 merged Memories into Family. */
export function Cover({ cover, large }: { cover: string | null; large?: boolean }) {
  const [gone, setGone] = useState(false);
  const size = large ? { width: 120, height: 90 } : { width: 40, height: 40 };
  if (!cover || gone) return large ? <span className="gtile amber" style={{ width: 120, height: 90, fontSize: 24 }}>◍</span> : <span className="gtile xs amber">◍</span>;
  return <img src={fileUrl(cover)} alt="" loading="lazy" style={{ width: size.width, height: size.height, objectFit: 'cover', borderRadius: 10 }} onError={() => setGone(true)} />;
}

/** One photo's tile: the file, or the pack's mark when it is gone (p15, Nov 2026). */
function PhotoTile({ p, people, canEdit }: { p: Photo; people: string[]; canEdit: boolean }) {
  const [gone, setGone] = useState(false);
  return (
    <div className="w3b-photo" role="group" aria-label={p.caption || p.name}>
      <button type="button" className="ph slate" style={{ border: 0, padding: 0, width: '100%', cursor: 'pointer', background: 'var(--bg-side)' }} onClick={() => peekPhoto(p)} title={p.name} aria-label={`Open ${p.caption || p.name}`}>
        {p.video ? <span aria-hidden="true">▶</span> : gone ? <span aria-hidden="true">◍</span> : <img src={fileUrl(p.rel)} alt={p.caption || p.name} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', aspectRatio: '4 / 3' }} onError={() => setGone(true)} />}
      </button>
      <button type="button" className="cap" style={{ border: 0, background: 'none', cursor: canEdit ? 'pointer' : 'default', width: '100%', textAlign: 'left', font: 'inherit' }} disabled={!canEdit} onClick={() => photoForm(p, people)} title={canEdit ? 'Who is in it, caption and day' : undefined}>{p.caption || (canEdit ? 'Add a caption' : p.name)}</button>
      <span className="sub">{p.who.length ? p.who.join(', ') : 'Who is in it?'}</span>
      {canEdit && (
        <span style={{ display: 'flex', gap: 4, padding: '0 12px 10px' }}>
          <button type="button" className="btn quiet" style={{ height: 28 }} onClick={() => photoForm(p, people)}>Name and caption</button>
          <button type="button" className="btn quiet" style={{ height: 28 }} aria-label={`Delete ${p.caption || p.name} to the Bin`} title="Delete to the Bin" onClick={() => void trashRecord(p.rel)}>Delete</button>
        </span>
      )}
    </div>
  );
}

// ── An album's page ──────────────────────────────────────────────────────────────────────────────────────────────

export function AlbumDetail({ path }: { path: string }) {
  const canEdit = useCanEdit();
  const { data: m } = useWork<MemoriesView>('memories');
  const [q, setQ] = useState('');
  const a = m?.albums.find((x) => x.path === path);
  const people = useMemo(() => (m ? [...new Set([...m.peopleNames, ...m.people.map((p) => p.name)])] : []), [m]);
  const inIt = useMemo(() => (a ? [...new Set(a.photos.flatMap((p) => p.who))] : []), [a]);
  const shown = useMemo(() => {
    if (!a) return [];
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return a.photos;
    return a.photos.filter((p) => { const hay = `${p.name} ${p.caption} ${p.who.join(' ')} ${p.albumName}`.toLowerCase(); return words.every((w) => hay.includes(w)); });
  }, [a, q]);
  if (!m) return <div className="wm-memories"><PackPage label="Family"><p className="vsub">Reading your albums…</p></PackPage></div>;
  if (!a) return <div className="wm-memories"><PackPage label="Family"><div className="card" style={{ marginTop: 14 }}><p className="vsub">That album isn’t here any more.</p><p style={{ marginTop: 8 }}><button type="button" className="btn" onClick={() => openModule('family', 'albums')}>Albums</button></p></div></PackPage></div>;
  const videos = a.photos.filter((p) => p.video).length;
  const copyLink = () => { void navigator.clipboard.writeText(writeLink(a.path, undefined)).then(() => toast('A link to the album is on the clipboard.')); };
  // No videos is said by saying nothing (p15, Nov 2026): "10 photos and 0 videos" is a zero that says nothing.
  const kept = videos > 0 ? `${plural(photoCount(a), 'photo')} and ${plural(videos, 'video')}` : plural(photoCount(a), 'photo');
  return (
    <div className="wm-memories">
    <PackPage label={a.name}>
      <PackHead glyph="◍" tint="amber" title={a.name} sharePath={a.path} lead={`${kept}. Who is in them: ${inIt.join(', ') || 'no one named yet'}.`}
        actions={<>{canEdit && <button type="button" className="btn pri" onClick={() => void addPhotos(a.path, a.name)}>Add photos</button>}<MoreButton label={`More for ${a.name}`} onOpen={(el) => openMenu(el, [
          { label: 'Open its note', icon: 'notes', run: () => A.openPath(a.path, { where: 'tab' }) },
          { label: 'Copy link', icon: 'link', run: copyLink },
          { label: 'Show in its folder', icon: 'folder', run: () => A.revealInExplorer(a.path) },
          { separator: true },
          { label: deleteToBin('the album'), icon: 'trash', danger: true, disabled: !canEdit, run: () => void trashRecord(a.path).then((ok) => ok && openModule('family', 'albums')) },
        ])} /></>} />
      <PageProps facts={[{ k: 'Who is in', v: inIt.length ? <>{inIt.map((n, i) => <span key={n}>{i > 0 ? ' ' : ''}<span className="pill slate">{n} · {a.photos.filter((p) => p.who.includes(n)).length}</span></span>)}</> : 'No one named yet' }, { k: 'Details', v: [a.kind, span(a), a.place].filter(Boolean).join(' · ') || 'No day or place yet' }]} />
      <Section label="Photo search">
        <div className="searchbox" role="search"><span aria-hidden="true">⌕</span><input value={q} placeholder="A name, a place, a word…" aria-label="Search these photos" onChange={(e) => setQ(e.target.value)} /></div>
        {!!q.trim() && <p className="vsub" style={{ marginTop: 6 }}>{shown.length} of {a.photos.length} photos.</p>}
      </Section>
      <Section label="Photos">
        {!a.photos.length && <div className="card"><p className="vsub">No photos yet. Add the photos and videos from this {a.kind.toLowerCase()}: they are copied beside the album and stay Family-private.</p></div>}
        {!!shown.length && <div className="w3b-photos">{shown.map((p) => <PhotoTile key={p.rel} p={p} people={people} canEdit={canEdit} />)}</div>}
        {!!q.trim() && !shown.length && <div className="card"><p className="vsub">No photos match those words.</p></div>}
        {!!a.missing.length && <p className="vsub" style={{ marginTop: 8 }}>{plural(a.missing.length, 'photo')} named in the album isn’t beside it any more: {a.missing.slice(0, 4).join(', ')}.</p>}
      </Section>
      <Section label="Details">
        <div className="card" style={{ padding: '6px 20px' }}>
          <div className="trow"><span className="t">Kind</span><span style={{ marginLeft: 'auto' }}><Inline value={a.kind} label="Kind" kind="choice" options={[...ALBUM_KINDS]} canEdit={canEdit} onSave={set('album', a.path, 'album_kind')} /></span></div>
          <div className="trow"><span className="t">Place</span><span style={{ marginLeft: 'auto' }}><Inline value={a.place} label="Place" placeholder="Add" canEdit={canEdit} onSave={set('album', a.path, 'place')} /></span></div>
          <div className="trow"><span className="t">Day</span><span style={{ marginLeft: 'auto' }}><Inline value={a.date ?? ''} shown={a.date ? dayText(a.date) : undefined} label="Day" kind="date" placeholder="Add" canEdit={canEdit} onSave={set('album', a.path, 'date')} /></span></div>
          <div className="trow"><span className="t">Who was there</span><span style={{ marginLeft: 'auto' }}><Inline value={a.people.join(', ')} shown={a.people.length ? <span>{a.people.map((n) => <span key={n} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginRight: 8 }}><Avatar name={n} size={20} /> {n}</span>)}</span> : undefined} label="Who was there" placeholder="Add names" canEdit={canEdit} onSave={set('album', a.path, 'people')} /></span></div>
        </div>
      </Section>
      {m.onThisDay[0] && <HomeCard pack="On this day" glyph="◍" tint="amber" title={`This day ${m.onThisDay[0].years} ${m.onThisDay[0].years === 1 ? 'year' : 'years'} ago: ${m.onThisDay[0].album.name.toLowerCase()}`} meta={plural(m.onThisDay[0].album.photos.length, 'photo')} />}
      <RecordFormHost />
    </PackPage>
    </div>
  );
}
