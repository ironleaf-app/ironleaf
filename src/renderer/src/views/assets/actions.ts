// What can be done with an asset, the same from the details panel, the right-click menu and the keys: open it, show it
// in File Explorer, rename it (links in notes changed to match, as any rename in Ironleaf), delete it (asked first,
// to Recently deleted, saying where it is used), insert it into a note, copy its link.

import { BRAND_ROLES, isPicture, kitId, type AssetEntry, type BrandAction, type BrandKit, type BrandRole, type BrandSection, type NamedBrandKit } from '../../../../shared/assets';
import { confirm, prompt } from '../../components/Dialogs';
import type { MenuItem } from '../../components/Menu';
import { isAudio, isImage, isPdf, isVideo } from '../../lib/resolve';
import * as A from '../../state/actions';
import { setWorkspace } from '../../state/layout';
import { getState, loadFiles, loadNotes, showError, toast } from '../../state/store';
import * as W from '../../state/workspace';
import { copyLink, insertIntoNote, noteTarget } from './insert';
import { getAssets, patchAsset, reloadAssets, setAssets } from './store';

/** Pictures, PDFs, sound and video open in a tab here; documents in the program they belong to. */
export function openAsset(a: AssetEntry, where: W.Where = 'tab'): void {
  if (isImage(a.path) || isPdf(a.path) || isAudio(a.path) || isVideo(a.path)) A.openPath(a.path, { where, reuse: true });
  else void A.openInDefaultApp(a.path);
}

export async function renameAsset(a: AssetEntry): Promise<void> {
  const dot = a.name.lastIndexOf('.');
  const name = await prompt('Rename the asset', { value: a.name, ok: 'Rename', select: [0, dot > 0 ? dot : a.name.length], message: 'Notes that show or link it are changed to match, so they keep working.' });
  if (!name || name === a.name) return;
  const next = await A.renamePath(a.path, name);
  if (next) {
    setAssets({ selected: next });
    await reloadAssets();
  }
}

export async function deleteAsset(a: AssetEntry): Promise<void> {
  const details = await window.nv.assets.details(a.path).catch(() => null);
  const used = details?.usedIn ?? [];
  const count = (kind: string, one: string, many: string) => {
    const n = used.filter((u) => u.kind === kind).length;
    return n ? `${n} ${n === 1 ? one : many}` : '';
  };
  const where = [count('note', 'note', 'notes'), count('canvas', 'canvas', 'canvases'), count('project', 'project', 'projects')].filter(Boolean);
  const role = a.role ? BRAND_ROLES.find((r) => r.id === a.role)?.label : '';
  const message = [
    'It goes to Recently deleted, where it stays for 30 days.',
    where.length ? `It’s used in ${where.join(', ').replace(/, ([^,]*)$/, ' and $1')}: they will show it as missing.` : '',
    role ? `It’s your brand kit’s ${role.toLowerCase()}.` : '',
  ].filter(Boolean).join(' ');
  if (!(await confirm(`Delete “${a.name}”?`, { message, ok: 'Delete', danger: true }))) return;
  try {
    const binId = await window.nv.files.trash(a.path);
    setWorkspace((ws) => W.removed(ws, (p) => p !== a.path));
    if (getAssets().selected === a.path) setAssets({ selected: null });
    await Promise.all([loadNotes(), loadFiles(), reloadAssets()]);
    toast(`Deleted “${a.name}”. It stays in Recently deleted for 30 days.`, { label: 'Undo', run: () => void A.restoreBinItem(binId, a.path).then(() => Promise.all([loadNotes(), loadFiles(), reloadAssets()])).then(() => toast(`“${a.name}” is back.`), showError) }, 9000);
  } catch (err) {
    showError(err);
  }
}

/** Gives an asset a brand role (or none). */
export async function setRole(a: AssetEntry, role: BrandRole | null): Promise<void> {
  try {
    const d = await window.nv.assets.update(a.path, { role });
    patchAsset(a.path, { role: d.role });
    await reloadAssets();
  } catch (err) {
    showError(err);
  }
}

/** Adds a colour to the default kit (named by its hex until the person names it). */
export async function addBrandColour(hex: string): Promise<void> {
  const listing = getAssets().listing;
  const brand = listing?.brand;
  if (!brand) return;
  if (brand.colours.some((c) => c.hex.toLowerCase() === hex.toLowerCase())) {
    toast(`${hex.toUpperCase()} is already in your brand colours.`);
    return;
  }
  await saveBrand({ ...brand, colours: [...brand.colours, { name: hex.toUpperCase(), hex }] });
  const multi = (listing.kits?.length ?? 0) > 1;
  toast(multi && brand.name ? `${hex.toUpperCase()} added to your ${brand.name} brand colours.` : `${hex.toUpperCase()} added to your brand colours.`, { label: 'See the brand kit', run: () => setAssets({ section: { kind: 'brand' }, selected: null }) });
}

export async function saveBrand(brand: BrandKit): Promise<void> {
  try {
    const next = await window.nv.assets.setBrand(brand);
    const l = getAssets().listing;
    if (!l) return;
    // The default kit's content, kept as one in both places (a first save makes the one kit).
    const kits = l.kits ?? [];
    const whole = kits.length ? kits.map((k) => (k.id === l.brandDefault ? { ...next, id: k.id } : k)) : [{ ...next, id: kitId(next.name) }];
    setAssets({ listing: { ...l, brand: next, kits: whole, brandDefault: l.brandDefault || whole[0]?.id || '' } });
  } catch (err) {
    showError(err);
  }
}

/** The listing's kits kept as one with the window's copy after a kit change. */
function patchBrand(section: BrandSection): void {
  const l = getAssets().listing;
  if (l) setAssets({ listing: { ...l, brand: section.brand, kits: section.kits, brandDefault: section.brandDefault, brandAreas: section.brandAreas, brandProjects: section.brandProjects } });
}

/** A change to the kits, kept as one with the window's copy. */
async function changeKits(action: BrandAction): Promise<(BrandSection & { kit?: NamedBrandKit }) | null> {
  try {
    const section = await window.nv.assets.brands(action);
    patchBrand(section);
    return section;
  } catch (err) {
    showError(err);
    return null;
  }
}

/** Saves one kit's content (or the default's, when the vault holds none yet). */
export async function saveKit(id: string | null, kit: BrandKit): Promise<void> {
  if (!id) return saveBrand(kit);
  await changeKits({ kind: 'save', id, kit });
}

/** A new empty kit by its name (the default when it is the first). */
export async function addKit(name: string): Promise<NamedBrandKit | null> {
  return (await changeKits({ kind: 'add', name }))?.kit ?? null;
}

/** A kit gone (its areas and projects fall back to what covers them). Asked first by the caller. */
export async function removeKit(id: string): Promise<void> {
  await changeKits({ kind: 'remove', id });
}

/** The kit covering what nothing else chooses. */
export async function setDefaultKit(id: string): Promise<void> {
  await changeKits({ kind: 'default', id });
}

/** An area's kit (or no brand, with null). */
export async function setAreaKit(area: string, kit: string | null): Promise<void> {
  await changeKits({ kind: 'area', area, kit });
}

/** An area handed back to the default. */
export async function clearAreaKit(area: string): Promise<void> {
  await changeKits({ kind: 'area-clear', area });
}

/** A project's own kit. */
export async function setProjectKit(project: string, kit: string): Promise<void> {
  await changeKits({ kind: 'project', project, kit });
}

/** A project handed back to its area. */
export async function clearProjectKit(project: string): Promise<void> {
  await changeKits({ kind: 'project-clear', project });
}

export function assetMenu(a: AssetEntry): MenuItem[] {
  const canEdit = getState().canEdit;
  const target = noteTarget();
  return [
    { label: 'Open', icon: 'external', run: () => openAsset(a) },
    { label: target ? `Insert into “${A.titleOf(target.path)}”` : 'Insert into a note', icon: 'plus', disabled: !target || !canEdit, run: () => void insertIntoNote(a) },
    { label: 'Copy link', icon: 'link', run: () => void copyLink(a) },
    { separator: true },
    ...(isPicture(a.name)
      ? [
          {
            label: 'Brand role',
            icon: 'spark',
            disabled: !canEdit,
            submenu: [
              { label: 'None', checked: !a.role, run: () => void setRole(a, null) },
              ...BRAND_ROLES.map((r) => ({ label: r.label, checked: a.role === r.id, run: () => void setRole(a, r.id) })),
            ],
          } as MenuItem,
        ]
      : []),
    { label: 'Show in folder', icon: 'reveal', run: () => void A.revealInSystem(a.path) },
    { label: 'Rename…', icon: 'edit', disabled: !canEdit, run: () => void renameAsset(a) },
    { separator: true },
    { label: 'Delete', icon: 'trash', danger: true, disabled: !canEdit, run: () => void deleteAsset(a) },
  ];
}
