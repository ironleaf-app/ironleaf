// The brand kits: each business's logos (primary, on dark, icon), its colours and its fonts, kept in the asset index
// (docs/ASSETS-STORE.md) for the assistant and other tools to read. A vault may hold several: one per area and
// project, with a clear default. The strip at the top of the Assets page shows the default at a glance; this page
// edits each kit and says which areas and projects use it.

import { useEffect, useMemo, useRef, useState } from 'react';
import { BRAND_ROLES, cleanHex, inkOn, isEmptyKit, kitId, type AssetEntry, type AssetListing, type BrandKit, type BrandRole, type NamedBrandKit } from '../../../../shared/assets';
import { brandKitHint, brandPreviewHtml } from '../../../../shared/brand-document';
import { isProjectProps } from '../../../../shared/project-file';
import { confirm, prompt } from '../../components/Dialogs';
import { Icon } from '../../components/Icon';
import { openMenu } from '../../components/Menu';
import { pickFile } from '../../components/Pickers';
import { fileUrl } from '../../lib/resolve';
import { useAreas } from '../../state/areas';
import { useApp } from '../../state/store';
import { addKit, clearAreaKit, clearProjectKit, removeKit, saveKit, setAreaKit, setDefaultKit, setProjectKit } from './actions';
import { pickAsset } from './AssetPicker';
import { Thumb } from './AssetTile';
import { SavedText } from './Fields';
import { setAssets } from './store';

const fontOk = (name: string) => /^[\p{L}\p{N} ._-]{1,80}$/u.test(name);

/** Every kit to show (an older file's single brand reads as its one kit). */
function viewKits(listing: AssetListing): NamedBrandKit[] {
  if (listing.kits?.length) return listing.kits;
  return isEmptyKit(listing.brand) ? [] : [{ ...listing.brand, id: kitId(listing.brand.name) }];
}

function LogoSlot({ role, asset, canEdit, onLogo }: { role: (typeof BRAND_ROLES)[number]; asset: AssetEntry | undefined; canEdit: boolean; onLogo: (rel: string | null) => void }) {
  const choose = async () => {
    const a = await pickAsset({ title: `Choose your ${role.label.toLowerCase()}`, pictures: true });
    if (a) onLogo(a.path);
  };
  return (
    <div className={`as-logo-slot role-${role.id}${asset ? '' : ' is-empty'}`}>
      <button className="as-logo-art" disabled={!canEdit && !asset} onClick={() => (asset ? setAssets({ selected: asset.path, section: { kind: 'all' } }) : canEdit && void choose())} title={asset ? `${asset.name}: show its details` : `Choose your ${role.label.toLowerCase()}`}>
        {asset ? (
          <span className="as-tile-art kind-logo">
            <Thumb a={asset} />
          </span>
        ) : (
          <span className="as-logo-empty">
            <Icon name="plus" size={16} />
            Choose a logo
          </span>
        )}
      </button>
      <div className="as-logo-words">
        <span className="as-logo-role">{role.label}</span>
        <span className="as-logo-name">{asset ? asset.name : role.hint}</span>
      </div>
      {asset && canEdit && (
        <div className="as-logo-actions">
          <button className="text-button" onClick={() => void choose()}>
            Change
          </button>
          <button className="text-button quiet" onClick={() => onLogo(null)}>
            Remove
          </button>
        </div>
      )}
    </div>
  );
}

function ColourCard({ c, i, brand, canEdit, onSave }: { c: BrandKit['colours'][number]; i: number; brand: BrandKit; canEdit: boolean; onSave: (next: BrandKit) => void }) {
  const set = (patch: Partial<BrandKit['colours'][number]>) => onSave({ ...brand, colours: brand.colours.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
  return (
    <div className="as-colour">
      <label className={`as-colour-chip ink-${inkOn(c.hex)}`} style={{ background: c.hex }} title={canEdit ? 'Pick the colour' : c.hex}>
        <span>{c.hex.toUpperCase()}</span>
        {canEdit && <input type="color" value={c.hex} onChange={(e) => set({ hex: e.target.value })} aria-label={`Change ${c.name}`} />}
      </label>
      <div className="as-colour-words">
        <SavedText label="Colour name" value={c.name} placeholder="Its name" disabled={!canEdit} onSave={(name) => set({ name: name || c.hex.toUpperCase() })} />
        <SavedText label="Colour hex" value={c.hex.toUpperCase()} placeholder="#1D4E89" disabled={!canEdit} onSave={(v) => {
          const hex = cleanHex(v);
          if (hex) set({ hex });
        }} />
        <SavedText label="What it is for" value={c.use ?? ''} placeholder="What it’s for" disabled={!canEdit} onSave={(use) => set({ use: use || undefined })} />
      </div>
      {canEdit && (
        <button className="icon-button small as-colour-remove" title={`Remove ${c.name}`} onClick={() => onSave({ ...brand, colours: brand.colours.filter((_, j) => j !== i) })}>
          <Icon name="close" size={12} />
        </button>
      )}
    </div>
  );
}

/** Page one of a small invented meeting in this kit, live: what Export to PDF makes from any note. The document draws
 *  itself in a frame (its own styles stay inside it), scaled to fit. */
function DocPreview({ brand }: { brand: BrandKit }) {
  const frame = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.4);
  const html = useMemo(() => brandPreviewHtml(brand, (rel) => fileUrl(rel)), [brand]);
  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const fit = () => setScale(Math.min(0.62, Math.max(0.2, el.clientWidth / 794)));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div className="as-doc-preview" ref={frame}>
      {/* The frame is the page's own size at its scale, so no blank strip stands beside the page. */}
      <div className="as-doc-frame" style={{ height: `${Math.round(1123 * scale)}px`, width: `${Math.round(794 * scale)}px`, maxWidth: '100%' }}>
        <iframe title="How your documents look" srcDoc={html} sandbox="allow-same-origin" style={{ width: '794px', height: '1123px', transform: `scale(${scale})` }} />
      </div>
      <p className="as-doc-hint">{brandKitHint(brand) ?? 'Your kit is complete: your documents carry it.'}</p>
    </div>
  );
}

/** Which areas and projects use the kit in hand: every area's choice, the projects with this kit, the default, and
 *  removing it. The one way to change which kit a note prints in. */
function KitUse({ listing, kit, canEdit }: { listing: AssetListing; kit: NamedBrandKit | null; canEdit: boolean }) {
  const kits = viewKits(listing);
  const areas = useAreas()?.areas ?? [];
  const notes = useApp((s) => s.notes);
  const projects = useMemo(() => notes.filter((n) => isProjectProps(n.props)).map((n) => ({ path: n.path, name: n.label || n.title })), [notes]);
  const projectName = (path: string) => projects.find((p) => p.path === path)?.name ?? path.split('/').pop()?.replace(/\.md$/i, '') ?? path;
  const kitName = (id: string) => kits.find((k) => k.id === id)?.name?.trim() || 'Untitled kit';
  const defaultKit = kits.find((k) => k.id === listing.brandDefault) ?? kits[0] ?? null;
  const defaultWords = defaultKit?.name?.trim() ? `Default (${defaultKit.name.trim()})` : 'Default';
  const areaChoice = (areaId: string) => {
    if (!(areaId in (listing.brandAreas ?? {}))) return defaultWords;
    const choice = (listing.brandAreas ?? {})[areaId];
    return choice === null ? 'No brand' : kitName(choice);
  };
  const pickArea = (e: React.MouseEvent, areaId: string) => {
    const current = (listing.brandAreas ?? {})[areaId];
    openMenu(e.currentTarget as HTMLElement, [
      { label: defaultWords, checked: !(areaId in (listing.brandAreas ?? {})), run: () => void clearAreaKit(areaId) },
      { label: 'No brand', checked: current === null, run: () => void setAreaKit(areaId, null) },
      { separator: true },
      ...kits.map((k) => ({ label: k.name?.trim() || 'Untitled kit', checked: current === k.id, run: () => void setAreaKit(areaId, k.id) })),
    ]);
  };
  const mine = Object.entries(listing.brandProjects ?? {}).filter(([, id]) => kit && id === kit.id).map(([p]) => p);
  const pickProject = (e: React.MouseEvent, path: string) => {
    openMenu(e.currentTarget as HTMLElement, [
      ...kits.map((k) => ({ label: k.name?.trim() || 'Untitled kit', checked: (listing.brandProjects ?? {})[path] === k.id, run: () => void setProjectKit(path, k.id) })),
      { separator: true },
      { label: 'Use its area’s', run: () => void clearProjectKit(path) },
    ]);
  };
  const giveProject = async () => {
    if (!kit) return;
    const picked = await pickFile('Give which project this kit?', projects.map((p) => p.path), (p) => projectName(p));
    if (picked) await setProjectKit(picked, kit.id);
  };
  const remove = async () => {
    if (!kit) return;
    if (!(await confirm(`Remove “${kit.name?.trim() || 'Untitled kit'}”?`, { message: 'Its areas and projects fall back to what covers them.', ok: 'Remove', danger: true }))) return;
    await removeKit(kit.id);
  };
  return (
    <section className="as-brand-section">
      <h3>Where it’s used</h3>
      {kit && kit.id !== listing.brandDefault && canEdit && (
        <p className="as-d-quiet">
          <button className="text-button" onClick={() => void setDefaultKit(kit.id)}>
            Make this the default
          </button>
        </p>
      )}
      {kit && kit.id === listing.brandDefault && kits.length > 1 && <p className="as-d-quiet">The default: anything with no other choice prints in this kit.</p>}
      <div className="as-use-rows">
        {areas.map((a) => (
          <div key={a.id} className="as-use-row">
            <span className="as-use-name">{a.name}</span>
            <button className="as-use-pick" disabled={!canEdit} title={canEdit ? `Choose ${a.name}’s kit` : areaChoice(a.id)} onClick={(e) => pickArea(e, a.id)}>
              <span>{areaChoice(a.id)}</span>
              <Icon name="palette" size={13} />
            </button>
          </div>
        ))}
      </div>
      <div className="as-use-rows">
        {mine.map((p) => (
          <div key={p} className="as-use-row">
            <span className="as-use-name">{projectName(p)}</span>
            <button className="as-use-pick" disabled={!canEdit} title={canEdit ? `Choose ${projectName(p)}’s kit` : kitName((listing.brandProjects ?? {})[p] ?? '')} onClick={(e) => pickProject(e, p)}>
              <span>{kitName((listing.brandProjects ?? {})[p] ?? '')}</span>
              <Icon name="palette" size={13} />
            </button>
          </div>
        ))}
        {mine.length === 0 && <p className="as-d-quiet">No project has this kit yet: projects print in their area’s unless given their own.</p>}
      </div>
      {canEdit && kit && (
        <p className="as-use-actions">
          <button className="text-button" onClick={() => void giveProject()}>
            Give a project this kit
          </button>
          {kits.length > 1 && (
            <button className="text-button quiet" onClick={() => void remove()}>
              Remove this kit
            </button>
          )}
        </p>
      )}
    </section>
  );
}

export function BrandKitView({ listing, assets }: { listing: AssetListing; assets: AssetEntry[] }) {
  const canEdit = useApp((s) => s.canEdit);
  const [newHex, setNewHex] = useState('#');
  const kits = viewKits(listing);
  const [sel, setSel] = useState<string | null>(() => {
    try {
      return localStorage.getItem('nv-brand-kit');
    } catch {
      return null;
    }
  });
  const kit = kits.find((k) => k.id === sel) ?? kits.find((k) => k.id === listing.brandDefault) ?? kits[0] ?? null;
  const brand: BrandKit = kit ?? listing.brand;
  const byPath = new Map(assets.map((a) => [a.path, a]));
  const save = (next: BrandKit) => void saveKit(kit?.id ?? null, next);
  const select = (id: string) => {
    setSel(id);
    try {
      localStorage.setItem('nv-brand-kit', id);
    } catch {
      // Remembering is a convenience; nothing breaks without it.
    }
  };
  const add = async () => {
    const name = await prompt('Name the new kit', { ok: 'Add a kit', message: 'A name for the business or area it prints for, such as Harbour Pine.' });
    if (!name?.trim()) return;
    const made = await addKit(name.trim());
    if (made) select(made.id);
  };
  const addColour = () => {
    const hex = cleanHex(newHex);
    if (!hex) return;
    setNewHex('#');
    save({ ...brand, colours: [...brand.colours, { name: hex.toUpperCase(), hex }] });
  };
  return (
    <div className="as-brand">
      <header className="as-brand-head">
        <div>
          <h2>Brand kit</h2>
          <p>
            {kits.length > 1
              ? 'Your brand kits in one place: one per area or project, the default covering the rest. Ask the assistant for “our logo” or “our colours” and it uses the right one; they’re kept in your assets’ index, a plain file other tools can read too.'
              : 'Your logos, colours and fonts in one place. Ask the assistant for “our logo” or “our colours” and it uses these; they’re kept in your assets’ index, a plain file other tools can read too.'}
          </p>
        </div>
      </header>

      <div className="as-kits" role="group" aria-label="Brand kits">
        {kits.map((k) => (
          <button key={k.id} className={`chip${kit?.id === k.id ? ' on' : ''}`} aria-pressed={kit?.id === k.id} onClick={() => select(k.id)}>
            <span>{`${k.name?.trim() || 'Untitled kit'}${k.id === listing.brandDefault && kits.length > 1 ? ' (default)' : ''}`}</span>
          </button>
        ))}
        {canEdit && (
          <button className="chip is-add" title="Add a brand kit" onClick={() => void add()}>
            <Icon name="plus" size={13} />
            <span>Add a kit</span>
          </button>
        )}
      </div>

      {/* Three zones (layout round 2, 20 Nov 2026, on a real vault: inputs stretched 500 px across a huge row, logos,
          colours and fonts small islands in a vast area, the preview alone at the left with blank under it): the
          document (left, sticky), the identity (name, footer, colours, fonts) as a compact form (middle), the
          logos and where the kit is used (right), top-aligned and filling the width. Narrower they reflow to two
          zones, then one. */}
      <div className="as-brand-grid as-brand-zones">
      <section className="as-brand-section as-brand-preview">
        <h3>How your documents look</h3>
        <DocPreview brand={brand} />
      </section>

      <div className="as-brand-form as-brand-identity">
      <div className="as-brand-fields">
      <section className="as-brand-section">
        <h3>Business name</h3>
        <div className="as-brand-name">
          <SavedText label="Business name" value={brand.name ?? ''} placeholder="How your business’s name is written" disabled={!canEdit} onSave={(name) => save({ ...brand, name: name || undefined })} />
        </div>
      </section>

      <section className="as-brand-section">
        <h3>Footer line</h3>
        <div className="as-brand-name">
          <SavedText label="Footer line" value={brand.footer ?? ''} placeholder="A line at the foot of your documents, such as Confidential, internal use" disabled={!canEdit} onSave={(footer) => save({ ...brand, footer: footer || undefined })} />
        </div>
      </section>
      </div>

      <section className="as-brand-section">
        <h3>Colours</h3>
        {brand.colours.length === 0 && <p className="as-d-quiet">No colours yet. Add your brand’s colours by their hex code, or open a logo and add the colours found in it.</p>}
        <div className="as-colours">
          {brand.colours.map((c, i) => (
            <ColourCard key={`${i}:${c.hex}`} c={c} i={i} brand={brand} canEdit={canEdit} onSave={save} />
          ))}
          {canEdit && (
            <div className="as-colour add">
              <label className="as-colour-chip is-new" style={cleanHex(newHex) ? { background: cleanHex(newHex) } : undefined}>
                <Icon name="plus" size={18} />
                <input type="color" value={cleanHex(newHex) ?? '#e85d3f'} onChange={(e) => setNewHex(e.target.value)} aria-label="Pick a new colour" />
              </label>
              <div className="as-colour-words">
                <input
                  className="as-field-input"
                  value={newHex}
                  aria-label="New colour’s hex code"
                  placeholder="#1D4E89"
                  onChange={(e) => setNewHex(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') addColour();
                  }}
                />
                <button className="button" disabled={!cleanHex(newHex)} onClick={addColour}>
                  Add colour
                </button>
              </div>
            </div>
          )}
        </div>
      </section>

      <section className="as-brand-section">
        <h3>Fonts</h3>
        {brand.fonts.length === 0 && <p className="as-d-quiet">No fonts yet. Name the fonts your brand uses, and what each is for.</p>}
        <div className="as-fonts">
          {brand.fonts.map((f, i) => (
            <div key={`${i}:${f.name}`} className="as-font">
              <span className="as-font-sample" style={fontOk(f.name) ? { fontFamily: `"${f.name}", var(--font-ui)` } : undefined}>
                Aa
              </span>
              <div className="as-font-words">
                <SavedText label="Font name" value={f.name} placeholder="Font name" disabled={!canEdit} onSave={(name) => name && save({ ...brand, fonts: brand.fonts.map((x, j) => (j === i ? { ...x, name } : x)) })} />
                <SavedText label="What it is for" value={f.use ?? ''} placeholder="Headings, body text…" disabled={!canEdit} onSave={(use) => save({ ...brand, fonts: brand.fonts.map((x, j) => (j === i ? { ...x, use: use || undefined } : x)) })} />
              </div>
              {canEdit && (
                <button className="icon-button small" title={`Remove ${f.name}`} onClick={() => save({ ...brand, fonts: brand.fonts.filter((_, j) => j !== i) })}>
                  <Icon name="close" size={12} />
                </button>
              )}
            </div>
          ))}
          {canEdit && (
            <button className="as-add-row" onClick={() => save({ ...brand, fonts: [...brand.fonts, { name: brand.fonts.length ? 'Body font' : 'Heading font' }] })}>
              <Icon name="plus" size={13} /> Add a font
            </button>
          )}
        </div>
      </section>

      </div>

      <div className="as-brand-side">
      <section className="as-brand-section">
        <h3>Logos</h3>
        <div className="as-logo-slots">
          {BRAND_ROLES.map((r) => (
            <LogoSlot key={r.id} role={r} asset={brand.logos[r.id] ? byPath.get(brand.logos[r.id]!) : undefined} canEdit={canEdit} onLogo={(rel) => save({ ...brand, logos: rel ? { ...brand.logos, [r.id]: rel } : Object.fromEntries(Object.entries(brand.logos).filter(([k]) => k !== r.id)) as BrandKit['logos'] })} />
          ))}
        </div>
      </section>
      <KitUse listing={listing} kit={kit} canEdit={canEdit} />
      </div>
      </div>
    </div>
  );
}

/** The default kit at a glance, above every asset: its logos, colours and fonts, or an invitation to set it up. */
export function BrandStrip({ listing, assets }: { listing: AssetListing; assets: AssetEntry[] }) {
  const brand = listing.brand;
  const kits = viewKits(listing);
  const byPath = new Map(assets.map((a) => [a.path, a]));
  const logos = BRAND_ROLES.map((r) => ({ role: r.id as BrandRole, a: brand.logos[r.id] ? byPath.get(brand.logos[r.id]!) : undefined })).filter((l) => l.a);
  const open = () => setAssets({ section: { kind: 'brand' }, selected: null });
  if (!logos.length && !brand.colours.length && !brand.fonts.length) {
    return (
      <button className="as-strip is-empty" onClick={open}>
        <span className="as-strip-icon">
          <Icon name="palette" size={16} />
        </span>
        <span className="as-strip-words">
          <strong>Set up your brand kit</strong>
          <span>Your logos, colours and fonts in one place, for the assistant and anything made with your brand.</span>
        </span>
        <Icon name="forward" size={14} />
      </button>
    );
  }
  return (
    <button className="as-strip" onClick={open} title="Open the brand kit">
      <span className="as-strip-label">{kits.length > 1 ? `${brand.name ?? 'Brand kit'} · ${kits.length} kits` : (brand.name ?? 'Brand kit')}</span>
      {logos.map((l) => (
        <span key={l.role} className={`as-strip-logo role-${l.role}`} title={BRAND_ROLES.find((r) => r.id === l.role)?.label}>
          <Thumb a={l.a!} small />
        </span>
      ))}
      {brand.colours.length > 0 && (
        <span className="as-strip-colours">
          {brand.colours.slice(0, 8).map((c) => (
            <span key={c.hex + c.name} className="as-strip-dot" style={{ background: c.hex }} title={`${c.name} ${c.hex.toUpperCase()}`} />
          ))}
        </span>
      )}
      {brand.fonts.length > 0 && <span className="as-strip-fonts">{brand.fonts.map((f) => f.name).join(' · ')}</span>}
      <span className="as-d-space" />
      <span className="as-strip-go">
        Brand kit <Icon name="forward" size={13} />
      </span>
    </button>
  );
}
