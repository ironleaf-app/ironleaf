// The details panel beside the assets: a large preview, what the asset is, its colours, the words people write about it
// (description, alt text, tags, collections, brand role), where it is used, and what to do with it.

import { useEffect, useState } from 'react';
import { ASSET_KINDS, BRAND_ROLES, inkOn, isPicture, isSvg, kindInfo, sizeWords, type AssetDetails as Details, type AssetEntry, type AssetKind, type AssetPatch } from '../../../../shared/assets';
import { Icon } from '../../components/Icon';
import { openMenu } from '../../components/Menu';
import { fileUrl, isAudio, isPdf, isVideo } from '../../lib/resolve';
import { whenAgo } from '../../lib/projectLook';
import * as A from '../../state/actions';
import { showError, toast, useApp } from '../../state/store';
import { addBrandColour, assetMenu, deleteAsset, openAsset, renameAsset, setRole } from './actions';
import { backdropFor, PdfPage, TypeTile } from './AssetTile';
import { Chips, SavedText } from './Fields';
import { copyLink, insertIntoNote, noteTarget } from './insert';
import { patchAsset, reloadAssets, useAssets } from './store';
import { absUrl } from './thumbs';
import { LEVELS, levelLabel, type Level } from '../../../../shared/sensitivity';
import { levelHere, setLevel, usePrivacy } from '../../state/privacy';
import { readersOf } from '../../components/LevelPicker';

type Backdrop = 'light' | 'dark' | 'check' | 'none';

/** A logo or drawing is shown on light (or dark, when it is made for dark); a photo on the page's own colour. */
const backdropOf = (a: AssetEntry): Backdrop => backdropFor(a);

function Preview({ a }: { a: AssetEntry }) {
  const [svgUrl, setSvgUrl] = useState<string | null>(null);
  const [backdrop, setBackdrop] = useState<Backdrop>(backdropOf(a));
  useEffect(() => setBackdrop(backdropOf(a)), [a.path, a.role, a.kind]);
  useEffect(() => {
    if (!isSvg(a.path)) return;
    let url: string | null = null;
    let alive = true;
    // An SVG is shown made safe (no scripts, nothing fetched), and only ever as a picture.
    void window.nv.assets.source(a.path).then((src) => {
      if (!alive || !src || !('svg' in src)) return;
      url = URL.createObjectURL(new Blob([src.svg], { type: 'image/svg+xml' }));
      setSvgUrl(url);
    });
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
      setSvgUrl(null);
    };
  }, [a.path, a.mtime]);
  const picture = isPicture(a.path);
  const src = isSvg(a.path) ? svgUrl : picture ? `${fileUrl(a.path)}?v=${Math.round(a.mtime)}` : null;
  return (
    <div className={`as-preview backdrop-${picture ? backdrop : 'none'}`}>
      {picture ? (
        src ? <img src={src} alt={a.alt ?? ''} draggable={false} onDoubleClick={() => openAsset(a)} /> : a.thumb ? <img src={absUrl(a.thumb, a.mtime)} alt={a.alt ?? ''} /> : <span className="as-thumb-wait" />
      ) : isVideo(a.path) ? (
        <video controls preload="metadata" src={fileUrl(a.path)} />
      ) : isAudio(a.path) ? (
        <div className="as-preview-audio">
          <TypeTile a={a} />
          <audio controls preload="metadata" src={fileUrl(a.path)} />
        </div>
      ) : (
        <button className={`as-preview-doc${isPdf(a.path) ? ' is-pdf' : ''}`} title="Open it" onClick={() => openAsset(a)}>
          {isPdf(a.path) ? <PdfPage a={a} className="as-pdf-page" /> : <TypeTile a={a} />}
        </button>
      )}
      {picture && (
        <div className="as-backdrops" role="radiogroup" aria-label="Background">
          {(['light', 'dark', 'check'] as const).map((b) => (
            <button key={b} role="radio" aria-checked={backdrop === b} title={b === 'light' ? 'On light' : b === 'dark' ? 'On dark' : 'On a see-through grid'} className={`as-backdrop-dot dot-${b}${backdrop === b ? ' is-on' : ''}`} onClick={() => setBackdrop(b)} />
          ))}
        </div>
      )}
    </div>
  );
}

function Section({ title, children, hint }: { title: string; children: React.ReactNode; hint?: string }) {
  return (
    <section className="as-d-section">
      <h3>
        {title}
        {hint && <span className="as-d-hint">{hint}</span>}
      </h3>
      {children}
    </section>
  );
}

/** Its sensitivity (Wave 4): the level agents see it at; a Family-private photo needs the person's OK for each use. */
function AssetLevel({ path }: { path: string }) {
  usePrivacy();
  const canEdit = useApp((s) => s.canEdit);
  const now = levelHere(path);
  const own = now.from === 'file' ? now.level : '';
  return (
    <select className={`as-field-input lv-${now.level}`} value={own} disabled={!canEdit} aria-label="Sensitivity" onChange={(e) => void setLevel(path, (e.target.value || null) as Level | null)}>
      <option value="">{now.from === 'folder' && now.folder ? `${levelLabel(now.level)} (from ${now.folder})` : 'Open (as its folder says)'}</option>
      {LEVELS.map((l) => (
        <option key={l.id} value={l.id}>
          {l.label}
        </option>
      ))}
    </select>
  );
}

export function AssetDetails({ a, onClose }: { a: AssetEntry; onClose(): void }) {
  const canEdit = useApp((s) => s.canEdit);
  const revision = useApp((s) => s.revision);
  const listing = useAssets((s) => s.listing);
  const [details, setDetails] = useState<Details | null>(null);
  useEffect(() => {
    let alive = true;
    window.nv.assets.details(a.path).then((d) => alive && setDetails(d), () => alive && setDetails(null));
    return () => {
      alive = false;
    };
  }, [a.path, a.mtime, revision]);

  const save = async (patch: AssetPatch) => {
    try {
      const d = await window.nv.assets.update(a.path, patch);
      setDetails(d);
      patchAsset(a.path, { kind: d.kind, description: d.description, alt: d.alt, tags: d.tags, collections: d.collections, role: d.role });
      void reloadAssets();
    } catch (err) {
      showError(err);
    }
  };

  const picture = isPicture(a.path);
  const target = noteTarget();
  const tags = listing?.tags.map((t) => t.tag) ?? [];
  const collections = listing?.collections ?? [];
  const used = details?.usedIn ?? [];
  const folder = a.path.includes('/') ? a.path.slice(0, a.path.lastIndexOf('/')) : '';

  return (
    <aside className="as-details" aria-label={`Details of ${a.name}`}>
      <header className="as-d-top">
        <span className="as-d-top-kind">{kindInfo(a.kind).one}</span>
        <span className="as-d-space" />
        <button className="icon-button" title="Open" onClick={() => openAsset(a)}>
          <Icon name="external" size={15} />
        </button>
        <button className="icon-button" title="Show in folder" onClick={() => void A.revealInSystem(a.path)}>
          <Icon name="reveal" size={15} />
        </button>
        <button className="icon-button" title="More" onClick={(e) => openMenu(e.currentTarget, assetMenu(a))}>
          <Icon name="more" size={15} />
        </button>
        <button className="icon-button" title="Close (Esc)" onClick={onClose}>
          <Icon name="close" size={15} />
        </button>
      </header>
      <div className="as-d-scroll">
        <Preview a={a} />
        <div className="as-d-head">
          <button className="as-d-name" title={canEdit ? 'Rename' : a.name} disabled={!canEdit} onClick={() => void renameAsset(a)}>
            <span>{a.name}</span>
            {canEdit && <Icon name="edit" size={13} />}
          </button>
          <p className="as-d-facts">
            <span>{sizeWords(a.size)}</span>
            {a.width && a.height ? <span>{a.width} × {a.height} px</span> : null}
            <span>Changed {whenAgo(a.mtime)}</span>
          </p>
          <p className="as-d-where" title={a.path}>
            <Icon name="folder" size={12} /> {folder || 'The top of your notes'}
            {a.attachment && <span className="as-badge">Pasted into a note</span>}
          </p>
        </div>

        <div className="as-d-cta">
          <button className="button primary" disabled={!canEdit || !target} title={target ? `At the cursor in “${A.titleOf(target.path)}”` : 'Open a note to insert into'} onClick={() => void insertIntoNote(a)}>
            <Icon name="plus" size={14} /> {target ? <span className="as-ellipsis">Insert into “{A.titleOf(target.path)}”</span> : 'Insert into a note'}
          </button>
          <button className="button" onClick={() => void copyLink(a)} title="An embed to paste into any note">
            <Icon name="link" size={14} /> Copy link
          </button>
        </div>

        {picture && a.palette && a.palette.length > 0 && (
          <Section title="Colours" hint="Click to copy">
            <div className="as-swatches">
              {a.palette.map((hex) => (
                <span key={hex} className="as-swatch-wrap">
                  <button
                    className={`as-swatch ink-${inkOn(hex)}`}
                    style={{ background: hex }}
                    title={`Copy ${hex.toUpperCase()}`}
                    onClick={() => void navigator.clipboard.writeText(hex.toUpperCase()).then(() => toast(`${hex.toUpperCase()} copied.`), showError)}
                  >
                    <span>{hex.toUpperCase()}</span>
                  </button>
                  {canEdit && (
                    <button className="as-swatch-add" title="Add to brand colours" aria-label={`Add ${hex} to brand colours`} onClick={() => void addBrandColour(hex)}>
                      <Icon name="plus" size={11} />
                    </button>
                  )}
                </span>
              ))}
            </div>
          </Section>
        )}

        <Section title="Sensitivity" hint={readersOf(levelHere(a.path).level)}>
          <AssetLevel path={a.path} />
        </Section>
        <Section title="Description">
          <SavedText label="Description" multiline value={a.description ?? ''} placeholder="What it is and when to use it" disabled={!canEdit} onSave={(v) => void save({ description: v || null })} />
        </Section>
        {picture && (
          <Section title="Alt text" hint="Written into notes with it">
            <SavedText label="Alt text" value={a.alt ?? ''} placeholder="What it shows, for people who can’t see it" disabled={!canEdit} onSave={(v) => void save({ alt: v || null })} />
          </Section>
        )}
        <div className="as-d-pair">
          <Section title="Kind">
            <select className="as-field-input" value={a.kind} disabled={!canEdit} onChange={(e) => void save({ kind: e.target.value as AssetKind })} aria-label="Kind">
              {ASSET_KINDS.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.one}
                  {k.id === a.inferred && a.kind !== a.inferred ? ' (by its name)' : ''}
                </option>
              ))}
            </select>
          </Section>
          {picture && (
            <Section title="Brand role">
              <select className="as-field-input" value={a.role ?? ''} disabled={!canEdit} onChange={(e) => void setRole(a, (e.target.value || null) as never)} aria-label="Brand role">
                <option value="">None</option>
                {BRAND_ROLES.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </select>
            </Section>
          )}
        </div>
        <Section title="Tags">
          <Chips label="Add a tag" values={a.tags} prefix="#" suggestions={tags} placeholder="Add a tag" disabled={!canEdit} onChange={(next) => void save({ tags: next })} />
        </Section>
        <Section title="Collections">
          <Chips label="Add to a collection" values={a.collections} suggestions={collections} placeholder="Add to a collection" disabled={!canEdit} onChange={(next) => void save({ collections: next })} />
        </Section>

        <Section title="Where it’s used">
          {details === null ? (
            <p className="as-d-quiet">Looking…</p>
          ) : used.length === 0 ? (
            <p className="as-d-quiet">Not in any note or canvas yet. Drag it into a note, or use Insert.</p>
          ) : (
            <ul className="as-uses">
              {used.map((u) => (
                <li key={`${u.kind}:${u.path}`}>
                  <button onClick={() => A.openPath(u.path, { where: 'tab', reuse: true })}>
                    <Icon name={u.kind === 'canvas' ? 'canvas' : u.kind === 'project' ? 'layers' : 'notes'} size={14} />
                    <span className="as-ellipsis">{u.title}</span>
                    <span className="as-uses-kind">{u.kind === 'project' ? 'Project' : u.kind === 'canvas' ? 'Canvas' : 'Note'}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Section>

        {canEdit && (
          <button className="as-d-delete" onClick={() => void deleteAsset(a)}>
            <Icon name="trash" size={13} /> Delete…
          </button>
        )}
      </div>
    </aside>
  );
}
