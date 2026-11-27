// Settings as a page in the frame (8.7 w4a round 2; a page, not a dialog: the side bar stays, the crumb says Settings,
// the groups are a quiet column at the left with the search above them, the chosen group fills the rest; 10.0 Endless
// Tech: the rail groups them around jobs, SETTINGS_JOB_GROUPS in lib/settingsSearch.ts; 3 Nov 2026 polish: the former
// host app's five parents You, AI, Connections, Your work and Help, title + one-line subtitle + cards): General (the
// licence, where the notes are, writing, types and templates), Look, Home cards, Calendar (8.9), Packs, Quick add,
// Backups and sync, Keys, Models, Privacy and secrets, Agents, Plugins, Publish. The old sixteen sections fold into
// these (lib/settingsSearch.ts maps every old id); nothing the person could do is lost. Every change applies at once.

import { MicPicker } from '../views/MeetingRecorder';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { formatDate } from '../../../shared/dates';
import { ACCENTS, PALETTES, HIDEABLE_ITEMS, shows, type Prefs } from '../../../shared/prefs';
import type { TidyStatus } from '../../../main/weekly-tidy';
import { tidyKindCountWords } from '../../../shared/weekly-tidy';
import { plural } from '../../../shared/words';
import { todayHidden } from '../../../shared/hub';
import { defaultHomeLayout, homeOffers, HOME_CARDS, moveHomeCard, normalizeHomeLayout, setHomeCard, type HomeCardDef, type HomeCardId, type HomeLayout } from '../../../shared/home-cards';
import { moduleOn as moduleIsOn } from '../../../shared/life-modules';
import { INTERFACE_SIZES, nearestSize, sizeWords } from '../../../shared/interface-size';
import { useEscape } from '../lib/useEscape';
import { comboFromEvent, formatHotkey } from '../lib/hotkeys';
import * as A from '../state/actions';
import { alsoKeys, COMMANDS, type Command, hotkeyOf, listedCommands } from '../state/commands';
import { keyedAliases } from '../lib/commandAliases';
import { setWorkspace, useWorkspace } from '../state/layout';
import { closeModal, openModal, takeSettingsDoor, useSettingsDoor } from '../state/modals';
import { useModules } from '../state/modules';
import { useAllNoteTypes } from '../state/noteTypes';
import { openTemplates } from '../state/templates';
import * as W from '../state/workspace';
import { savePrefs, setState, showError, toast, useApp, usePrefs } from '../state/store';
import { ensurePlugins, refreshPlugins, usePlugins } from '../state/plugins';
import { pluginPermissionWords, type PluginView } from '../../../shared/plugins';
import { confirm } from './Dialogs';
import { ViewHeader } from '../views/ViewHeader';
import { Icon, type IconName } from './Icon';
import { VarWords } from './TemplateVar';
import { CaptureSettings } from './CaptureSettings';
import { BackupSettings } from './BackupSettings';
import { SyncSettings } from './SyncSettings';
import { TeamsSettings } from './TeamsSettings';
import { FILE_INDEX_LIMITS } from '../../../shared/file-index';
import { progressWords, useFileIndexStatus } from '../state/fileSearch';
import { ocrProgressLine, useOcrStatus } from '../state/ocr';
import { OCR_LIMITS, ocrProgressWords } from '../../../shared/ocr';
import { AgentsSettings } from './AgentsSettings';
import { ManagedNotice } from './ManagedNotice';
import { AiSettings } from './AiSettings';
import { ExternalSettings } from './ExternalSettings';
import { TraySettings } from './TraySettings';
import { NoteTypesSettings } from './NoteTypesSettings';
import { openAnotherVault, usePlace, VaultPlaceSection } from './VaultPlace';
import { PrivacySettings } from './PrivacySettings';
import { PublishSettings } from './PublishSettings';
import { ModulesSettings } from './ModulesSettings';
import { VaultHomeSection } from './VaultHome';
import { EmptyState } from './EmptyState';
import { AboutPage } from './about/AboutPage';
import { AccountSettings } from './account/AccountSettings';
import { openAboutPage } from './about/aboutState';
import { commandEntries, PACK_PART_ENTRIES, searchSettings, SETTINGS_GROUPS, SETTINGS_INDEX, SETTINGS_JOB_GROUPS, resolveSection, type SettingEntry, type SettingsSectionId } from '../lib/settingsSearch';

type Section = SettingsSectionId;

const SECTIONS: { id: Section; label: string; icon: IconName }[] = [
  { id: 'general', label: 'General', icon: 'settings' },
  { id: 'look', label: 'Look', icon: 'palette' },
  { id: 'home', label: 'Home cards', icon: 'home' },
  { id: 'account', label: 'Account and plan', icon: 'person' },
  { id: 'teams', label: 'Teams', icon: 'people' },
  { id: 'packs', label: 'Packs', icon: 'layers' },
  { id: 'quick-add', label: 'Capture', icon: 'inbox' },
  { id: 'backups', label: 'Backups and sync', icon: 'cloud' },
  { id: 'keys', label: 'Keyboard shortcuts', icon: 'keyboard' },
  { id: 'models', label: 'AI', icon: 'sparkle' },
  { id: 'privacy', label: 'Privacy and secrets', icon: 'lock' },
  { id: 'agents', label: 'Connect an AI', icon: 'agent' },
  { id: 'plugins', label: 'Plugins', icon: 'grid' },
  { id: 'publish', label: 'Publish', icon: 'globe' },
  { id: 'about', label: 'About and updates', icon: 'info' },
];
const SECTION_LABELS = Object.fromEntries(SECTIONS.map((s) => [s.id, s.label])) as Record<Section, string>;
const SECTION_WORDS = Object.fromEntries(SETTINGS_GROUPS.map((g) => [g.id, g.words])) as Record<Section, string>;

export function Row({ title, hint, children, wide, stacked, oneLine }: { title: string; hint?: ReactNode; children: ReactNode; wide?: boolean; stacked?: boolean; oneLine?: boolean }) {
  return (
    <div className={`setting-row${wide ? ' wide' : ''}${stacked ? ' stacked' : ''}${oneLine ? ' one-line' : ''}`} data-setting={title}>
      <div className="setting-text">
        <div className="setting-title">{title}</div>
        {/* A one-line hint (never the licence: its words always show whole, they wrap) keeps its full words on hover (10.0 rooms critique, 2 Nov 2026: the licence's "Until
            the…" was cut with the rest unreachable anywhere). */}
        {hint && <div className="setting-hint" title={oneLine && typeof hint === 'string' ? hint : undefined}>{hint}</div>}
      </div>
      <div className="setting-control">{children}</div>
    </div>
  );
}

export function Toggle({ value, onChange, label }: { value: boolean; onChange(v: boolean): void; label: string }) {
  return <input type="checkbox" className="switch" aria-label={label} checked={value} onChange={(e) => onChange(e.target.checked)} />;
}

/** The one disclosure for long explanations (9.5 polished, 1 Nov 2026, one short line per row, detail behind Learn
 *  more): the link reads inline after the lead sentence, the detail opens below it. Every group with more to say
 *  shares this, never its own expander. */
export function LearnMore({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="learnmore">
      <button type="button" className="link-button" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        Learn more
      </button>
      {open && <span className="learnmore-body">{children}</span>}
    </span>
  );
}

/** The one Details button (9.5 polished): every row's details open from the same quiet link at the row's edge. */
export function DetailsButton({ open, onToggle }: { open: boolean; onToggle(): void }) {
  return (
    <button type="button" className="link-button" aria-expanded={open} onClick={onToggle}>
      Details
    </button>
  );
}

function TextSetting({ value, placeholder, onSave, width = 220 }: { value: string; placeholder?: string; onSave(v: string): void; width?: number }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return <input className="setting-input" style={{ width }} value={draft} placeholder={placeholder} spellCheck={false} onChange={(e) => setDraft(e.target.value)} onBlur={() => draft !== value && onSave(draft)} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />;
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { id: T; label: string }[]; onChange(v: T): void }) {
  return (
    <div className="segmented">
      {options.map((o) => (
        <button key={o.id} className={value === o.id ? 'active' : ''} onClick={() => onChange(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Where the notes are: the row as drawn (the former host app's row: the folder on one line left, Move… and Details right,
 *  the status tags under the folder, never crowding the controls — 3 Nov 2026 sweep D: the title wrapped into two lines
 *  beside two tags, Move… and Details); where the vault is, this PC's sync, the other vaults and folders open under it.
 *  The row names the folder of the vault that is open, not the usual library (31 Oct 2026 live check: it named the
 *  library while another vault was open); when that is not the usual place a tag says so, under the folder. Details'
 *  Show opens the folder named. */
function VaultRow({ details, onToggle, library }: { details: boolean; onToggle(): void; library: string }) {
  const { status } = usePlace();
  const vault = useApp((s) => s.vault);
  const local = status?.place.kind === 'local';
  const openPath = vault?.path ?? library;
  const other = !!vault && (vault.library === false || (!!library && vault.path !== library));
  return (
    <>
      <Row title="Where your notes are kept" hint={<><span className="setting-folder" title={openPath}>{folderTail(openPath)}</span>{(local || other) && <span className="setting-tags">{local && <span className="tag slate">Only on this PC</span>}{other && <span className="tag slate">Not your usual vault</span>}</span>}</>}>
        <button className="button" style={{ height: 32 }} onClick={() => openModal({ kind: 'move-vault', from: 'settings' })}>
          Move…
        </button>
        <DetailsButton open={details} onToggle={onToggle} />
      </Row>
      {details && (
        <div className="set-details">
          <VaultPlaceSection />
          <VaultHomeSection />
          <Row title="Your vault is somewhere else?" hint={<>Open its folder, and Ironleaf keeps your notes there from now on. <LearnMore>On another drive, a USB drive or a folder a sync service keeps. This moves your vault there; to look at a folder without moving your vault, use Another folder of notes below.</LearnMore></>}>
            <button className="button" onClick={() => void openAnotherVault()}>
              Use another folder as your vault…
            </button>
          </Row>
          <Row title="Another folder of notes" hint={vault && vault.library === false ? `Open now: ${vault.path}` : <>Open a folder of Markdown notes from another app, without making it your vault. <LearnMore>It is read where it is, and nothing in it changes unless you edit a note: no templates added, nothing tidied or moved.</LearnMore></>}>
            <div className="field-row">
              {vault && vault.library === false && (
                <button className="button" onClick={() => void window.nv.vault.library().catch(showError)}>
                  Back to your notes
                </button>
              )}
              <button className="button" onClick={() => void window.nv.vault.pick().catch(showError)}>
                Open another folder…
              </button>
            </div>
          </Row>
        </div>
      )}
    </>
  );
}

/** Which Details hold each row, so a setting found by search opens what holds it. */
const GENERAL_DETAILS: Record<string, string[]> = {
  vault: ['Where your notes are kept', 'Your vaults', 'Your PCs', 'Your vault is somewhere else?', 'Another folder of notes'],
  files: ['That folder', 'Files already in one folder', 'Your assets are kept in'],
  links: ['Write new links as [[Note name]]', 'A new link names its note by'],
  leftout: ['Folders left out of search, the graph and suggestions'],
  filelist: ['Show pictures, PDFs and other files'],
  deletecheck: ['Ask before deleting'],
  datetime: ['Date', 'Time'],
  searchfiles: ['Search inside project files', 'What is read'],
  external: ['Links that change notes', 'The ironleaf command', 'Markdown files from outside your notes'],
  writing: ['New tabs open in', 'The note’s name as its title', 'Close brackets and marks', 'Line numbers', 'A note’s properties', 'One Enter starts a new line in Reading too', 'Indent with tabs', 'Indent width'],
  notetypes: ['Your note types', 'Add a type of your own'],
  templatesfolder: ['Templates folder'],
};
const detailsFor = (title: string): string[] => Object.keys(GENERAL_DETAILS).filter((k) => GENERAL_DETAILS[k].includes(title));

/** General: the mock-ups' four sections, each setting one row (label, one line of help, the control at the right edge).
 *  Everything else General held opens behind a quiet Details or from the Also line — nothing is lost. */
function General({ onShow, reveal }: { onShow(title: string): void; reveal: string | null }) {
  const settings = useApp((s) => s.settings);
  const prefs = usePrefs();
  const set = (patch: Partial<Prefs>) => void savePrefs(patch).catch(showError);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const toggle = (k: string) => setOpen((o) => ({ ...o, [k]: !o[k] }));
  // A setting found by search: what holds it opens, then the page scrolls to it.
  useEffect(() => {
    if (!reveal) return;
    const keys = detailsFor(reveal);
    if (keys.length) setOpen((o) => ({ ...o, ...Object.fromEntries(keys.map((k) => [k, true])) }));
  }, [reveal]);
  const also = (k: string, title: string) => {
    setOpen((o) => ({ ...o, [k]: true }));
    window.setTimeout(() => onShow(title), 60);
  };
  const types = useAllNoteTypes();
  const [templates, setTemplates] = useState<{ name: string }[] | null>(null);
  useEffect(() => {
    void window.nv.templates.list().then((r: unknown) => setTemplates(((r as { templates?: { name: string }[] }).templates ?? [])), () => setTemplates([]));
  }, []);
  if (!settings) return null;
  const typeNames = types.map((t) => t.name).filter(Boolean);
  const templateWords = templates === null ? `Starting points for notes live in ${prefs.templatesFolder || 'Templates'}.` : !templates.length ? `None yet. They live in ${prefs.templatesFolder || 'Templates'}.` : templates.length <= 2 ? `${templates.map((t) => t.name).join(', ')} live in ${prefs.templatesFolder || 'Templates'}.` : `${templates.slice(0, 2).map((t) => t.name).join(', ')} and ${templates.length - 2} more live in ${prefs.templatesFolder || 'Templates'}.`;
  return (
    <>
      <h3>About</h3>
      <Row title="About and updates" hint={`Ironleaf ${settings.about.version}: updates and the version history.`} oneLine><button type="button" className="link-button" onClick={() => openAboutPage()}>Open</button></Row>
      <VaultRow details={!!open.vault} onToggle={() => toggle('vault')} library={settings.library ?? ''} />
      {/* What the Vault can do (8.8): every ability in one place, from About where people look for it. */}
      <Row title="What Ironleaf can do" hint="Every ability, grouped, each with its Open." oneLine>
        <button className="button" style={{ height: 32 }} onClick={() => A.openAbilities()}>
          Open
        </button>
      </Row>
      <h3>Notes and files</h3>
      <NewNotesRows prefs={prefs} set={set} />
      <FilesGoRows prefs={prefs} set={set} details={!!open.files} onToggle={() => toggle('files')} />
      <WeeklyTidyRows />
      <RenameRows prefs={prefs} set={set} />
      <QuietFolders prefs={prefs} set={set} />
      {open.links && <div className="set-details"><LinkStyleRows prefs={prefs} set={set} /></div>}
      {open.leftout && <div className="set-details"><LeftOutRows prefs={prefs} set={set} /></div>}
      {open.filelist && <div className="set-details"><FileListRows prefs={prefs} set={set} /></div>}
      {open.deletecheck && <div className="set-details"><DeleteCheckRows prefs={prefs} set={set} /></div>}
      <div className="set-mores">
        <button type="button" className="set-more" aria-expanded={!!open.searchfiles} onClick={() => toggle('searchfiles')}>
          <span>Search inside project files</span><span aria-hidden="true"><Icon name={open.searchfiles ? 'chevronDown' : 'chevron'} size={13} /></span>
        </button>
        {open.searchfiles && <div className="set-details"><SearchSettings prefs={prefs} set={set} /></div>}
        <button type="button" className="set-more" aria-expanded={!!open.external} onClick={() => toggle('external')}>
          <span>Links from other apps</span><span aria-hidden="true"><Icon name={open.external ? 'chevronDown' : 'chevron'} size={13} /></span>
        </button>
        {open.external && <div className="set-details"><ExternalSettings /></div>}
      </div>
      {/* Words in pictures and scans sits in the open, by search (9.0 w123ocr round 2: it hid inside the closed "Search inside project files", so its own palette command and settings search never reached it). */}
      <OcrSettings prefs={prefs} set={set} />
      <TraySettings />
      <h3>Writing</h3>
      <WritingTop prefs={prefs} set={set} />
      <div className="set-mores">
        <button type="button" className="set-more" aria-expanded={!!open.writing} onClick={() => toggle('writing')}>
          <span>More writing choices</span><span aria-hidden="true"><Icon name={open.writing ? 'chevronDown' : 'chevron'} size={13} /></span>
        </button>
        {open.writing && <div className="set-details"><WritingMore prefs={prefs} set={set} /></div>}
      </div>
      <h3>Types and templates</h3>
      <Row title="Your note types" hint={typeNames.length ? `${plural(typeNames.length, 'type')}: ${typeNames.join(', ').toLowerCase()}.` : 'What a note can be: note, person, meeting and more.'} oneLine>
        <button className="button" style={{ height: 32 }} aria-expanded={!!open.notetypes} onClick={() => toggle('notetypes')}>
          Manage
        </button>
      </Row>
      {open.notetypes && <div className="set-details"><NoteTypesSettings /></div>}
      <Row title="Templates" hint={templateWords} oneLine>
        <button className="button" style={{ height: 32 }} onClick={() => openTemplates()}>
          Open
        </button>
        <DetailsButton open={!!open.templatesfolder} onToggle={() => toggle('templatesfolder')} />
      </Row>
      {open.templatesfolder && <div className="set-details"><TemplatesFolderRows prefs={prefs} set={set} /></div>}
      {open.datetime && <div className="set-details"><DateTimeRows prefs={prefs} set={set} /></div>}
      <p className="also">
        Also in General:{' '}
        <button type="button" className="link-button" onClick={() => also('vault', 'Another folder of notes')}>another folder of notes</button>
        {' · '}
        <button type="button" className="link-button" onClick={() => also('links', 'Write new links as [[Note name]]')}>link style</button>
        {' · '}
        <button type="button" className="link-button" onClick={() => also('leftout', 'Folders left out of search, the graph and suggestions')}>folders left out of search</button>
        {' · '}
        <button type="button" className="link-button" onClick={() => also('filelist', 'Show pictures, PDFs and other files')}>file list</button>
        {' · '}
        <button type="button" className="link-button" onClick={() => also('deletecheck', 'Ask before deleting')}>delete checks</button>
        {' · '}
        <button type="button" className="link-button" onClick={() => also('datetime', 'Date')}>date and time formats</button>.
      </p>
    </>
  );
}

/** The colour well: the window takes the colour live while it's dragged, and it's kept once it rests. */
function OwnColour({ value, onSave }: { value: string; onSave(hex: string): void }) {
  const timer = useRef(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return (
    <input
      type="color"
      defaultValue={value}
      key={value}
      aria-label="Pick any accent colour"
      onChange={(e) => {
        const hex = e.target.value;
        document.documentElement.style.setProperty('--accent-base', hex);
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => onSave(hex), 350);
      }}
    />
  );
}

/** Look: theme, colours, sizes, the window and fonts. The former host app follows the same choice. */
function Look({ prefs, set }: { prefs: Prefs; set(p: Partial<Prefs>): void }) {
  // No h3 here (sweep-vault-b F-B13): the page title is already "Look", and no other section repeats its title.
  return (
    <>
      <Row title="Theme">
        <Segmented value={prefs.theme} options={[{ id: 'light', label: 'Light' }, { id: 'dark', label: 'Dark' }, { id: 'system', label: 'Match Windows' }]} onChange={(theme) => set({ theme })} />
      </Row>
      {/* 5.2.0: the light look's colours and the accent, live as they're clicked; the former host app follows the same choice. 4
          Nov 2026: the look picker sits directly above the accent picker and both show together, as in the former host
          app. */}
      <Row title="Colours" hint={prefs.theme === 'dark' ? 'For the Light theme: Dark keeps its own colours.' : 'The page and side bar.'} stacked>
        <div className="palette-row" role="radiogroup" aria-label="Colours">
          {PALETTES.map((p) => (
            <button key={p.id} role="radio" aria-checked={prefs.palette === p.id} className={`palette-swatch${prefs.palette === p.id ? ' active' : ''}`} title={p.name} onClick={() => set({ palette: p.id })}>
              <span className="palette-chip" style={{ background: `linear-gradient(90deg, ${p.side} 0 38%, ${p.page} 38%)` }}>
                <i style={{ background: prefs.accent }} />
              </span>
              <span className="palette-name">{p.name}</span>
            </button>
          ))}
        </div>
      </Row>
      <Row title="Accent colour" hint="Buttons, links, the cursor, highlights and what's selected." stacked>
        <div className="accent-row" role="radiogroup" aria-label="Accent colour">
          {ACCENTS.map((a) => (
            <button key={a.value} role="radio" aria-checked={prefs.accent === a.value} className={`accent-swatch${prefs.accent === a.value ? ' active' : ''}`} title={a.name} aria-label={a.name} onClick={() => set({ accent: a.value })}>
              <span className="accent-chip" style={{ background: a.value }} />
              <span className="accent-name">{a.name}</span>
            </button>
          ))}
          <label className={`accent-swatch accent-own${ACCENTS.some((a) => a.value === prefs.accent) ? '' : ' active'}`} title="Any colour you like">
            <span className="accent-chip accent-own-chip" style={ACCENTS.some((a) => a.value === prefs.accent) ? undefined : { background: prefs.accent }} />
            <span className="accent-name">Any colour</span>
            <OwnColour value={prefs.accent} onSave={(accent) => set({ accent })} />
          </label>
        </div>
      </Row>
      <h3>Size</h3>
      <Row title="Text size in notes" hint={`${prefs.fontSize} px`}>
        <input type="range" min={12} max={26} step={1} value={prefs.fontSize} onChange={(e) => set({ fontSize: Number(e.target.value) })} />
      </Row>
      {/* The whole window, in six sizes (5.0.0; src/shared/interface-size.ts), and how close rows sit (styles/feel.css). */}
      <Row title="Interface size" hint={`The whole window: side bars, menus, pages and words. ${formatHotkey('Mod')} + plus and ${formatHotkey('Mod')} + minus anywhere in Ironleaf, ${formatHotkey('Mod')} + 0 for 100%.`}>
        <Segmented value={String(nearestSize(prefs.zoom))} options={INTERFACE_SIZES.map((z) => ({ id: String(z), label: sizeWords(z) }))} onChange={(v) => set({ zoom: Number(v) })} />
      </Row>
      <Row title="Density" hint="Compact fits more rows in the side bar, the file list, tabs and lists.">
        <Segmented value={prefs.density} options={[{ id: 'comfortable', label: 'Comfortable' }, { id: 'compact', label: 'Compact' }]} onChange={(density) => set({ density })} />
      </Row>
      <h3>Window</h3>
      {/* Ironleaf Calm (20 Oct 2026). */}
      <Row title="Open pages in tabs" hint={prefs.showTabs ? 'Pages open in tabs along the top: Ctrl+click or middle-click opens one in a new tab.' : 'One page at a time: a page opened from the left side replaces the page on show. Ctrl+click opens a note beside it.'}>
        <Toggle label="Open pages in tabs" value={prefs.showTabs} onChange={(showTabs) => set({ showTabs, tabsChosen: true })} />
      </Row>
      <EmptyTabRow prefs={prefs} set={set} />
      <ShowChips prefs={prefs} set={set} group="ribbon" title="Places on the left side and in More" hint="Every one is in Commands (Ctrl+K) too." />
      <Row title="Status line" hint="Along the bottom of the window: words, links and whether the note is saved. Off, a save that fails still says so in the corner, and Ctrl+S says Saved.">
        <Toggle label="Status line" value={prefs.statusLine} onChange={(statusLine) => set({ statusLine })} />
      </Row>
      {prefs.statusLine && <ShowChips prefs={prefs} set={set} group="status" title="Along the bottom" />}
      <ShowChips prefs={prefs} set={set} group="project" title="On project pages" hint="Buttons and cards on every project’s page." />
      <Row title="Preview links on hover" hint="Rest the pointer on a link to see the note it leads to in a small card. Off: hold Ctrl over a link to see one.">
        <Toggle label="Preview links on hover" value={prefs.hoverPreview} onChange={(hoverPreview) => set({ hoverPreview })} />
      </Row>
      <Row title="Suggested questions in the chat" hint="Shown while a chat is empty, to match where you are.">
        <Toggle label="Suggestions" value={prefs.chatSuggestions} onChange={(chatSuggestions) => set({ chatSuggestions })} />
      </Row>
      <h3>Fonts</h3>
      <Row title="The window" hint="Menus, lists and buttons. Any font on this PC, by its name; empty is Ironleaf’s own.">
        <TextSetting value={prefs.uiFont} placeholder="Inter" onSave={(uiFont) => set({ uiFont: uiFont.trim() })} />
      </Row>
      <Row title="Notes" hint="The words in your notes.">
        <TextSetting value={prefs.textFont} placeholder="Inter" onSave={(textFont) => set({ textFont: textFont.trim() })} />
      </Row>
      <Row title="Code" hint="Code blocks and Source view.">
        <TextSetting value={prefs.codeFont} placeholder="Cascadia Code" onSave={(codeFont) => set({ codeFont: codeFont.trim() })} />
      </Row>
    </>
  );
}

/** What an empty tab shows (Home or nothing). Home is the one start to the day (10.0): the morning brief, the Ask
 *  box, the day, what needs you, and the person's cards (arranged on the page itself, with Change Home, or in
 *  Settings › Home cards). */
function EmptyTabRow({ prefs, set }: { prefs: Prefs; set(p: Partial<Prefs>): void }) {
  return (
    <Row title="An empty tab shows" hint={!prefs.home ? 'A quiet page with the keys to open or start a note.' : 'Home: the morning brief, the Ask box, your day, and your cards.'}>
      <Segmented value={!prefs.home ? 'quiet' : 'today'} options={[{ id: 'today', label: 'Home' }, { id: 'quiet', label: 'Nothing' }]} onChange={(v) => set(v === 'quiet' ? { home: false } : { home: true })} />
    </Row>
  );
}

/** What Today shows (10.0): Today is the one place to start, from the side bar or the palette (Ctrl+K). */
function TodayChips({ prefs, set }: { prefs: Prefs; set(p: Partial<Prefs>): void }) {
  const today = { ...prefs, hidden: todayHidden(prefs) };
  return <ShowChips prefs={today} set={(p) => set({ ...p, today: true })} group="today" title="On Today" hint="Today is the one place to start: the brief, your day, and what needs you." />;
}

/** A group of buttons or items, each switched on or off with a tap (Settings › Look › Window). */
function ShowChips({ prefs, set, group, title, hint }: { prefs: Prefs; set(p: Partial<Prefs>): void; group: (typeof HIDEABLE_ITEMS)[number]['group']; title: string; hint?: string }) {
  const items = HIDEABLE_ITEMS.filter((i) => i.group === group);
  return (
    <Row title={title} hint={hint} stacked>
      <div className="show-chips">
        {items.map((i) => {
          const on = shows(prefs, i.id);
          return (
            <button key={i.id} className={`show-chip${on ? ' on' : ''}`} aria-pressed={on} onClick={() => set({ hidden: on ? [...prefs.hidden, i.id] : prefs.hidden.filter((h) => h !== i.id) })}>
              <Icon name={on ? 'check' : 'plus'} size={12} />
              {i.label}
            </button>
          );
        })}
      </div>
    </Row>
  );
}

/** Writing as drawn: three rows, one line of help each. The rest opens behind More writing choices. */
function WritingTop({ prefs, set }: { prefs: Prefs; set(p: Partial<Prefs>): void }) {
  return (
    <>
      <Row title="Check spelling" hint="Squiggles as you type." oneLine>
        <Toggle label="Spelling" value={prefs.spellcheck} onChange={(spellcheck) => set({ spellcheck })} />
      </Row>
      <Row title="Fold headings" hint="An arrow beside each heading folds what is under it." oneLine>
        <Toggle label="Fold" value={prefs.foldHeadings} onChange={(foldHeadings) => set({ foldHeadings })} />
      </Row>
      <Row title="Comfortable line length" hint="Easy to read, however wide the window." oneLine>
        <Toggle label="Comfortable line length" value={prefs.readableWidth} onChange={(readableWidth) => set({ readableWidth })} />
      </Row>
    </>
  );
}

/** Writing: how notes open and behave. Dictation lives in Quick add now, beside the meeting microphone. */
function WritingMore({ prefs, set }: { prefs: Prefs; set(p: Partial<Prefs>): void }) {
  return (
    <>
      <Row title="New tabs open in" hint="Live Preview shows the note as it will read while you write; Source shows every mark.">
        <Segmented value={prefs.defaultMode} options={[{ id: 'live', label: 'Live Preview' }, { id: 'source', label: 'Source' }, { id: 'reading', label: 'Reading' }]} onChange={(defaultMode) => set({ defaultMode })} />
      </Row>
      <Row title="The note’s name as its title" hint="Shown above the note; type there to rename it.">
        <Toggle label="Title" value={prefs.inlineTitle} onChange={(inlineTitle) => set({ inlineTitle })} />
      </Row>
      <Row title="Close brackets and marks" hint="Typing ( [ { or a quote adds its pair.">
        <Toggle label="Pairs" value={prefs.autoPair} onChange={(autoPair) => set({ autoPair })} />
      </Row>
      <Row title="Line numbers">
        <Toggle label="Line numbers" value={prefs.lineNumbers} onChange={(lineNumbers) => set({ lineNumbers })} />
      </Row>
      <Row title="A note’s properties" hint="Its details at the top (tags, status, dates…).">
        <Segmented value={prefs.propertiesShow} options={[{ id: 'shown', label: 'Above the note' }, { id: 'hidden', label: 'Hidden' }, { id: 'source', label: 'As text' }]} onChange={(propertiesShow) => set({ propertiesShow })} />
      </Row>
      <Row title="One Enter starts a new line in Reading too" hint="Off: lines run together until a blank line, as Markdown has it.">
        <Toggle label="Single line breaks" value={!prefs.strictBreaks} onChange={(on) => set({ strictBreaks: !on })} />
      </Row>
      <Row title="Indent with tabs" hint="Off indents with spaces.">
        <Toggle label="Tabs" value={prefs.indentWithTabs} onChange={(indentWithTabs) => set({ indentWithTabs })} />
      </Row>
      <Row title="Indent width">
        <Segmented value={String(prefs.tabSize) as '2' | '4' | '8'} options={[{ id: '2', label: '2' }, { id: '4', label: '4' }, { id: '8', label: '8' }]} onChange={(v) => set({ tabSize: Number(v) })} />
      </Row>
    </>
  );
}

/** New notes: where unfiled notes land first. */
function NewNotesRows({ prefs, set }: { prefs: Prefs; set(p: Partial<Prefs>): void }) {
  const folders = useApp((s) => s.folders);
  return (
    <>
      <Row title="New notes go" hint="Unfiled notes land here first." oneLine>
        <select className="setting-input" value={prefs.newNotePlace} onChange={(e) => set({ newNotePlace: e.target.value as Prefs['newNotePlace'] })}>
          <option value="root">At the top of your notes</option>
          <option value="current">In the folder of the open note</option>
          <option value="folder">In a folder I choose</option>
        </select>
      </Row>
      {prefs.newNotePlace === 'folder' && (
        <Row title="Folder for new notes">
          <select className="setting-input" value={prefs.newNoteFolder} onChange={(e) => set({ newNoteFolder: e.target.value })}>
            <option value="">The top of your notes</option>
            {folders.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </Row>
      )}
    </>
  );
}

/** Files added to a note: beside the note (each with where it came from and its versions) or all in one folder. */
function FilesGoRows({ prefs, set, details, onToggle }: { prefs: Prefs; set(p: Partial<Prefs>): void; details: boolean; onToggle(): void }) {
  return (
    <>
      <Row title="Files you add to a note go" hint="Kept with what they belong to, in its Files folder." oneLine>
        <select className="setting-input" style={{ minWidth: 180 }} value={prefs.filesWithRecord === false ? 'folder' : 'record'} onChange={(e) => set({ filesWithRecord: e.target.value === 'record' })}>
          <option value="record">Beside the note</option>
          <option value="folder">All in one folder</option>
        </select>
        <DetailsButton open={details} onToggle={onToggle} />
      </Row>
      {details && (
        <div className="set-details">
          {prefs.filesWithRecord === false && (
            <Row title="That folder" hint="A folder in your notes, or ./ for the note’s own folder (./Pictures for a folder beside it).">
              <TextSetting value={prefs.attachmentsFolder} placeholder="Attachments" onSave={(attachmentsFolder) => set({ attachmentsFolder })} />
            </Row>
          )}
          <Row title="Files already in one folder" hint={<>Moves the files in {prefs.attachmentsFolder || 'Attachments'} beside the notes that link to them. <LearnMore>You see where each goes first; a safety copy is kept, every link keeps working, and you can undo it.</LearnMore></>}>
            <button type="button" className="button" onClick={() => void import('./FilesMove').then((m) => m.openFilesMove())}>
              Review the move…
            </button>
          </Row>
          <Row title="Your assets are kept in" hint={<>A folder in your notes for logos, pictures, icons and documents (the Assets page). <LearnMore>Changing it moves nothing: files already there stay where they are.</LearnMore></>}>
            <TextSetting value={prefs.assetsFolder} placeholder="Assets" onSave={(assetsFolder) => set({ assetsFolder: assetsFolder.trim() || 'Assets' })} />
          </Row>
        </div>
      )}
    </>
  );
}

/** The weekly tidy (10.0 whole, 2 Nov 2026: Settings, Files is its home): this week's standing, opened in full. */
function WeeklyTidyRows() {
  const [status, setStatus] = useState<TidyStatus | null>(null);
  useEffect(() => {
    let live = true;
    void window.nv.tidy.status().then((s) => live && setStatus(s), () => undefined);
    const off = window.nv.on.tidyChanged((s) => live && setStatus(s));
    return () => {
      live = false;
      off();
    };
  }, []);
  const hint = !status
    ? 'This week’s small fixes, each with its own fix button.'
    : !status.week
      ? 'Open a folder of notes first. The tidy looks over the notes you have open.'
      : status.waiting > 0
        ? `${status.waiting} ${status.waiting === 1 ? 'small fix waits' : 'small fixes wait'} for a look: ${tidyKindCountWords(status.byKind)}. Nothing is deleted for good.`
        : 'Everything is tidy. Next week’s tidy prepares itself.';
  return (
    <Row title="Weekly tidy" hint={hint}>
      <button type="button" className="button" onClick={() => (closeModal(), A.openTidy())}>
        Open
      </button>
    </Row>
  );
}

/** Links keep working when a note is renamed or moved. */
function RenameRows({ prefs, set }: { prefs: Prefs; set(p: Partial<Prefs>): void }) {
  return (
    <Row title="When a note is renamed or moved" hint="Links to it keep working." oneLine>
      <select className="setting-input" value={prefs.linkUpdate} onChange={(e) => set({ linkUpdate: e.target.value as Prefs['linkUpdate'] })}>
        <option value="always">Change the links</option>
        <option value="ask">Ask me first</option>
        <option value="never">Leave the links</option>
      </select>
    </Row>
  );
}

/** Link style (the Also line): [[Note name]] or standard Markdown links, named short or by path. */
function LinkStyleRows({ prefs, set }: { prefs: Prefs; set(p: Partial<Prefs>): void }) {
  return (
    <>
      <Row title="Write new links as [[Note name]]" hint="Off writes standard Markdown links, [Note name](Note%20name.md).">
        <Toggle label="Wikilinks" value={prefs.wikilinks} onChange={(wikilinks) => set({ wikilinks })} />
      </Row>
      <Row title="A new link names its note by" hint="The shortest name finds it while names are different; a path always finds the one meant.">
        <select className="setting-input" value={prefs.linkFormat} onChange={(e) => set({ linkFormat: e.target.value as Prefs['linkFormat'] })}>
          <option value="shortest">The shortest name</option>
          <option value="relative">The path from the note</option>
          <option value="absolute">The path from the top</option>
        </select>
      </Row>
    </>
  );
}

/** Folders left out of search, the graph and suggestions (the Also line): still in the file list, opening as usual. */
function LeftOutRows({ prefs, set }: { prefs: Prefs; set(p: Partial<Prefs>): void }) {
  return (
    <Row title="Folders left out of search, the graph and suggestions" hint="They stay in the file list and open as usual." wide>
      <Excluded prefs={prefs} set={set} />
    </Row>
  );
}

/** The file list (the Also line): pictures, PDFs and other files, or only notes and canvases. */
function FileListRows({ prefs, set }: { prefs: Prefs; set(p: Partial<Prefs>): void }) {
  return (
    <Row title="Show pictures, PDFs and other files" hint="Off shows only notes and canvases.">
      <Toggle label="All files" value={prefs.showAllFiles} onChange={(showAllFiles) => set({ showAllFiles })} />
    </Row>
  );
}

/** Delete checks (the Also line): folders, pictures and other files ask first. */
function DeleteCheckRows({ prefs, set }: { prefs: Prefs; set(p: Partial<Prefs>): void }) {
  return (
    <Row title="Ask before deleting" hint="Folders, pictures and other files. A note goes at once with Undo on the message; everything deleted goes to Recently deleted either way.">
      <Toggle label="Confirm" value={prefs.confirmDelete} onChange={(confirmDelete) => set({ confirmDelete })} />
    </Row>
  );
}

/** Folders kept out of view (8 Nov 2026): each with Bring back beside it. The folder menu keeps them out;
 *  Settings only lists them back. Shown only while any are kept out. */
function QuietFolders({ prefs, set }: { prefs: Prefs; set(p: Partial<Prefs>): void }) {
  const quiet = prefs.quietFolders ?? [];
  if (!quiet.length) return null;
  return (
    <Row title="Folders kept out of view" hint="Hidden from Notes, Today, the graph, Related and the chat. Search still finds them, and links still open." wide>
      <div className="excluded-list">
        {quiet.map((f) => (
          <span key={f} className="excluded-chip">
            <Icon name="folder" size={12} />
            {f}
            <button type="button" className="link-button" onClick={() => set({ quietFolders: quiet.filter((x) => x !== f) })}>
              Bring back
            </button>
          </span>
        ))}
      </div>
    </Row>
  );
}

/** Folders left out (Settings › General): each with a remove button, and another to add. */
function Excluded({ prefs, set }: { prefs: Prefs; set(p: Partial<Prefs>): void }) {
  const folders = useApp((s) => s.folders);
  const left = folders.filter((f) => !prefs.excluded.includes(f));
  return (
    <div className="excluded-list">
      {prefs.excluded.map((f) => (
        <span key={f} className="excluded-chip">
          <Icon name="folder" size={12} />
          {f}
          <button className="icon-button small" title={`Bring back ${f}`} onClick={() => set({ excluded: prefs.excluded.filter((x) => x !== f) })}>
            <Icon name="close" size={11} />
          </button>
        </span>
      ))}
      <select className="setting-input" value="" onChange={(e) => e.target.value && set({ excluded: [...prefs.excluded, e.target.value] })} disabled={!left.length}>
        <option value="">{left.length ? 'Leave out a folder…' : 'No other folders'}</option>
        {left.map((f) => (
          <option key={f} value={f}>
            {f}
          </option>
        ))}
      </select>
    </div>
  );
}

/** The end of a folder's path, where its name is ("…\Projects\01 Studio upgrade"); the whole path on hover. */
function folderTail(folder: string): string {
  const parts = folder.split(/[\\/]+/).filter(Boolean);
  const sep = folder.includes('\\') ? '\\' : '/';
  return parts.length > 2 ? `…${sep}${parts.slice(-2).join(sep)}` : folder;
}

/** Settings › General › Search: searching inside the documents in projects' folders, on or off, project by project. */
function SearchSettings({ prefs, set }: { prefs: Prefs; set(p: Partial<Prefs>): void }) {
  const status = useFileIndexStatus();
  const [again, setAgain] = useState(false);
  const progress = progressWords(status);
  const projects = status?.projects ?? [];
  const mb = (n: number) => `${Math.round(n / (1024 * 1024))} MB`;
  const setProject = (path: string, on: boolean) => set({ fileSearchOff: on ? prefs.fileSearchOff.filter((p) => p.toLowerCase() !== path.toLowerCase()) : [...prefs.fileSearchOff, path] });
  return (
    <>
      <h3>Inside project files</h3>
      <Row
        title="Search inside project files"
        hint="Search, Open a note, the commands, the file list’s find box, each project’s Files and the assistant also find words inside the documents in your projects’ folders: Word, Excel, PowerPoint, PDF, text and CSV. What they say is kept in Ironleaf’s own data on this PC, never in your notes or the project folders, and nothing in a folder is ever changed."
      >
        <Toggle label="Search inside project files" value={prefs.fileSearch} onChange={(fileSearch) => set({ fileSearch })} />
      </Row>
      {prefs.fileSearch && status && (
        <div className="fs-settings">
          <div className="fs-summary">
            <span className="fs-summary-words">
              {progress ||
                (status.files
                  ? `${status.withText.toLocaleString('en-AU')} of ${status.files.toLocaleString('en-AU')} ${status.files === 1 ? 'file' : 'files'} read inside, across ${projects.filter((p) => p.on).length} ${projects.filter((p) => p.on).length === 1 ? 'project' : 'projects'}.`
                  : projects.some((p) => p.on)
                    ? 'Nothing read yet.'
                    : 'No project has a folder on this PC yet. Give a project its folder and its files are searched.')}
            </span>
            <button
              className="button"
              disabled={status.busy || again || !projects.some((p) => p.on)}
              onClick={() => {
                setAgain(true);
                void window.nv.fileIndex.rebuild().catch(showError).finally(() => setAgain(false));
              }}
            >
              <Icon name="refresh" size={13} /> Read again
            </button>
          </div>
          {status.busy && status.todo > 0 && (
            <span className="fh-progress-bar fs-bar" aria-hidden="true">
              <i style={{ width: `${Math.min(100, Math.round((status.done / status.todo) * 100))}%` }} />
            </span>
          )}
          {projects.length > 0 && (
            <ul className="fs-projects" aria-label="Projects searched inside">
              {projects.map((x) => {
                // The switch follows the setting at once (the index catches up a moment later).
                const p = { ...x, on: !prefs.fileSearchOff.some((o) => o.toLowerCase() === x.path.toLowerCase()) };
                return (
                <li key={p.path} className={`fs-project${p.on ? '' : ' is-off'}`}>
                  <span className="fs-project-words">
                    <span className="fs-project-name">{p.name}</span>
                    <span className="fs-project-meta" title={p.folder}>
                      {!p.exists ? 'Its folder isn’t on this PC now' : !p.on ? 'Not searched inside' : p.files ? `${p.withText} of ${p.files} ${p.files === 1 ? 'file' : 'files'} read inside` : 'Waiting to be read'} · {folderTail(p.folder)}
                    </span>
                  </span>
                  <Toggle label={`Search inside ${p.name}’s files`} value={p.on} onChange={(on) => setProject(p.path, on)} />
                </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
      <h3>What is read</h3>
      <ul className="fs-limits">
        <li>Word, Excel and PowerPoint files up to {mb(FILE_INDEX_LIMITS.docBytes)}, PDFs up to {mb(FILE_INDEX_LIMITS.docBytes)} and {FILE_INDEX_LIMITS.pages} pages, text and CSV files up to {mb(FILE_INDEX_LIMITS.textBytes)}.</li>
        <li>In projects’ folders, pictures, recordings and other files are found by their names and dates.</li>
        <li>Hidden files, caches, build output and package folders are left out, as on the project page. Up to {FILE_INDEX_LIMITS.files.toLocaleString('en-AU')} files a project, the newest first.</li>
        <li>When a file changes, only that file is read again. A project switched off, or this switched off, forgets what was kept for it.</li>
      </ul>
    </>
  );
}

/** Why pictures have no words yet, in plain words (the recogniser only exists on Windows, with a language for it). */
function ocrWhy(reason: string): string {
  switch (reason) {
    case 'starting':
      return 'Checking what Windows has for reading…';
    case 'not-windows':
      return 'Windows reads the words in pictures, so on this PC pictures and scans are found by their names.';
    case 'no-ocr':
      return 'This copy of Windows has no text recogniser, so pictures and scans are found by their names.';
    case 'no-languages':
      return 'No language for reading is installed in Windows, so pictures and scans are found by their names. Add one in Windows Settings, under Time and language, in your language’s options (Optical character recognition), then press Read again.';
    default:
      return 'Pictures and scans are found by their names for now.';
  }
}

/** Settings › General › Words in pictures and scans: the switch, the progress with Read again, the language — the
 *  app's own rows, one line each, like the rows above them (9.0 w123ocr round 3). The longer words sit behind
 *  Learn more, not in the rows. */
function OcrSettings({ prefs, set }: { prefs: Prefs; set(p: Partial<Prefs>): void }) {
  const status = useOcrStatus();
  const [again, setAgain] = useState(false);
  const [more, setMore] = useState(false);
  const progress = ocrProgressLine(status);
  const readAgain = () => {
    setAgain(true);
    void window.nv.ocr.rebuild().catch(showError).finally(() => setAgain(false));
  };
  const progressWords = progress || (status?.files ? ocrProgressWords(status.withWords, status.files) : 'No pictures or scanned PDFs among the notes yet.');
  return (
    <>
      <h3>Words in pictures and scans</h3>
      <Row title="Read words in pictures and scans" hint="Search finds the words in photos and scanned PDFs, read on this PC.">
        <Toggle label="Read words in pictures and scans" value={prefs.ocrRead} onChange={(ocrRead) => set({ ocrRead })} />
        <button type="button" className="link-button" aria-expanded={more} onClick={() => setMore((m) => !m)}>
          Learn more
        </button>
      </Row>
      {more && (
        <div className="set-details">
          <p className="hint">Photos of receipts, whiteboards and letters, and scanned pages in PDFs, are read by Windows itself. Nothing is downloaded and no account is needed, and the files are never changed. What was read is kept in Ironleaf’s own data on this PC; switched off, it is forgotten.</p>
          <p className="hint">
            Pictures up to {Math.round(OCR_LIMITS.imageBytes / (1024 * 1024))} MB, and a PDF’s first {OCR_LIMITS.pages} scanned pages. A PDF whose pages all have words is left as it is.
          </p>
          <p className="hint">Private notes are never read. When a file changes, only that file is read again.</p>
        </div>
      )}
      {prefs.ocrRead &&
        (!status || !status.available ? (
          <div className="fs-settings">
            <div className="fs-summary">
              <span className="fs-summary-words">{ocrWhy(status?.reason ?? 'starting')}</span>
              {status?.reason === 'no-languages' && (
                <button className="button" disabled={again} onClick={readAgain}>
                  <Icon name="refresh" size={13} /> Read again
                </button>
              )}
            </div>
          </div>
        ) : (
          <>
            <Row title={progressWords}>
              <button className="button" disabled={status.busy || again} onClick={readAgain}>
                <Icon name="refresh" size={13} /> Read again
              </button>
            </Row>
            {status.busy && status.todo > 0 && (
              <span className="fh-progress-bar fs-bar" aria-hidden="true">
                <i style={{ width: `${Math.min(100, Math.round((status.done / status.todo) * 100))}%` }} />
              </span>
            )}
            <Row title="Language" hint="The language Windows reads." oneLine>
              <select className="setting-input" aria-label="Language for reading pictures" value={prefs.ocrLang} disabled={!status.languages} onChange={(e) => set({ ocrLang: e.target.value })}>
                {!status.languages ? (
                  <option value="">Checking…</option>
                ) : (
                  <>
                    <option value="">Automatic</option>
                    {status.languages.map((l) => (
                      <option key={l.tag} value={l.tag}>
                        {l.name}
                      </option>
                    ))}
                  </>
                )}
              </select>
            </Row>
          </>
        ))}
    </>
  );
}

/** The day note: where it goes, what it is called, and what it starts with. */
function DayNote() {
  const settings = useApp((s) => s.settings);
  const [example, setExample] = useState('');
  useEffect(() => setExample(formatDate(settings?.dailyFormat || 'YYYY-MM-DD')), [settings?.dailyFormat]);
  // Where the days live when they don't live here (5 Nov 2026, u3 moving-in): one suggestion line, never switching.
  const [hint, setHint] = useState<{ folder: string; count: number } | null>(null);
  useEffect(() => {
    window.nv.daily.folderHint().then(setHint, () => setHint(null));
  }, [settings?.dailyFolder]);
  if (!settings) return null;
  const save = async (patch: { dailyFolder?: string; dailyFormat?: string; dailyTemplate?: string }) => {
    try {
      setState({ settings: await window.nv.settings.update(patch) });
    } catch (err) {
      showError(err);
    }
  };
  return (
    <>
      <h3>Day note</h3>
      <Row title="Day notes go" hint="Where each day’s note goes.">
        <TextSetting value={settings.dailyFolder} placeholder="Daily" onSave={(dailyFolder) => void save({ dailyFolder })} />
      </Row>
      {hint && (
        <Row title="Days found elsewhere" hint={`${hint.count} day-shaped notes live in ${hint.folder}/, another app’s days perhaps.`}>
          <button className="btn small" onClick={() => void save({ dailyFolder: hint.folder })}>
            Point day notes there
          </button>
        </Row>
      )}
      <Row title="Day note names" hint={`Today’s would be “${example}”. YYYY year, MM month, DD day, dddd weekday, MMMM month name.`}>
        <TextSetting value={settings.dailyFormat} placeholder="YYYY-MM-DD" onSave={(dailyFormat) => void save({ dailyFormat })} />
      </Row>
      <Row title="Day notes start with" hint={<VarWords text="A note whose words start each day’s note ({{date}} and {{title}} filled in). Left empty, the Daily note template is used when it’s there." />}>
        <TextSetting value={settings.dailyTemplate} placeholder="Templates/Notes/Daily note" onSave={(dailyTemplate) => void save({ dailyTemplate })} />
      </Row>
    </>
  );
}

/** The weekly review's Friday notice (views/WeeklyReview.tsx, components/ReviewNotice.tsx): on or off, which day, what time. */
function WeeklyReviewRows({ prefs, set }: { prefs: Prefs; set(p: Partial<Prefs>): void }) {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return (
    <>
      <h3>Review</h3>
      <Row title="Weekly review reminder" hint={<>On the day, Today offers it up front, with a quiet card elsewhere until it’s done. <LearnMore>Never a Windows notification. Start it any time from Today, Projects or Commands (Ctrl+K).</LearnMore></>}>
        <Toggle label="Weekly review reminder" value={prefs.weeklyReview} onChange={(weeklyReview) => set({ weeklyReview })} />
      </Row>
      {prefs.weeklyReview && (
        <Row title="When" hint="From this time on that day, until the review is done or put off for the week.">
          <div className="field-row">
            <select className="setting-input" aria-label="Day" value={prefs.weeklyReviewDay} onChange={(e) => set({ weeklyReviewDay: Number(e.target.value) })}>
              {days.map((d, i) => (
                <option key={d} value={i}>
                  {d}
                </option>
              ))}
            </select>
            <input className="setting-input" type="time" aria-label="Time" style={{ width: 120 }} value={prefs.weeklyReviewTime} onChange={(e) => e.target.value && set({ weeklyReviewTime: e.target.value })} />
          </div>
        </Row>
      )}
    </>
  );
}

/** Record meeting (21 Oct 2026, gap G18; state/recorder.ts): what becomes of a recording once its notes are made, and
 *  whether the PC's own sound is recorded too (Windows). */
function MeetingRecordingRows({ prefs, set }: { prefs: Prefs; set(p: Partial<Prefs>): void }) {
  return (
    <>
      <Row title="Meeting microphone" hint="The one meetings are recorded with. You can change it in the meeting too, even while it records.">
        <MicPicker always />
      </Row>
      <Row title="After notes are made" hint="Kept, the meeting plays it back beside its transcript. Deleted, it goes to Recently deleted and the notes and transcript stay. Always kept when part of it couldn’t be written down.">
        <Segmented value={prefs.meetingAudio} options={[{ id: 'keep', label: 'Keep the recording' }, { id: 'delete', label: 'Delete the recording' }]} onChange={(meetingAudio) => set({ meetingAudio, meetingAudioChosen: true })} />
      </Row>
      {window.nv.window.platform === 'win32' && (
        <Row title="Record the PC’s sound too" hint="The other people on a call, as your speakers or headset play them, as well as your microphone.">
          <Toggle label="PC sound" value={prefs.meetingSystemAudio} onChange={(meetingSystemAudio) => set({ meetingSystemAudio })} />
        </Row>
      )}
    </>
  );
}

/** Dictation: speak instead of typing, in a note or quick capture. */
function DictationRow({ prefs, set }: { prefs: Prefs; set(p: Partial<Prefs>): void }) {
  return (
    <Row
      title="Dictation microphone"
      hint={<>Windows voice typing writes where the cursor is: press the microphone in a note, or Windows key + H anywhere. <LearnMore>It listens in your Windows keyboard language, through Microsoft’s online speech recognition; the gear on its bar switches on automatic punctuation.</LearnMore></>}
    >
      <Toggle label="Dictation" value={prefs.dictation} onChange={(dictation) => set({ dictation })} />
    </Row>
  );
}

/** Where templates live: every note in the folder is one. */
function TemplatesFolderRows({ prefs, set }: { prefs: Prefs; set(p: Partial<Prefs>): void }) {
  return (
    <Row title="Templates folder" hint="Every note in it is a template: Notes, Projects and Reports inside it keep them in order. Use one with New note from a template, or / Template inside a note.">
      <TextSetting value={prefs.templatesFolder} placeholder="Templates" onSave={(templatesFolder) => set({ templatesFolder })} />
    </Row>
  );
}

/** Date and time formats (the Also line): how {{date}} and {{time}} are written in a template. */
function DateTimeRows({ prefs, set }: { prefs: Prefs; set(p: Partial<Prefs>): void }) {
  return (
    <>
      <Row title="Date" hint={<VarWords text={`{{date}} becomes “${formatDate(prefs.dateFormat)}”.`} />}>
        <TextSetting value={prefs.dateFormat} placeholder="YYYY-MM-DD" onSave={(dateFormat) => set({ dateFormat })} />
      </Row>
      <Row title="Time" hint={<VarWords text={`{{time}} becomes “${formatDate(prefs.timeFormat)}”.`} />}>
        <TextSetting value={prefs.timeFormat} placeholder="HH:mm" onSave={(timeFormat) => set({ timeFormat })} />
      </Row>
      <p className="setting-said"><VarWords text="In a template, {{title}} is the note’s name, {{project}} the project it’s made from, {{date+2w}} a date from today, and {{date:dddd D MMMM}} writes a date your own way." /></p>
    </>
  );
}

/** File recovery: how often a copy is kept, for how long, and bringing one back. */
function Recovery({ prefs, set }: { prefs: Prefs; set(p: Partial<Prefs>): void }) {
  return (
    <>
      <h3>Recovery</h3>
      <Row title="Keep a copy of a changed note every" hint={prefs.recoveryMinutes ? `${plural(prefs.recoveryMinutes, 'minute')}, at most.` : 'Off.'}>
        <input type="range" min={0} max={60} step={1} value={prefs.recoveryMinutes} onChange={(e) => set({ recoveryMinutes: Number(e.target.value) })} />
      </Row>
      <Row title="Keep copies for" hint={`${plural(prefs.recoveryDays, 'day')}.`}>
        <input type="range" min={1} max={90} step={1} value={prefs.recoveryDays} onChange={(e) => set({ recoveryDays: Number(e.target.value) })} />
      </Row>
      <Row title="Earlier versions" hint="Copies stay on this PC, away from your notes, and include notes you deleted.">
        <button className="button" onClick={() => openModal({ kind: 'recovery' })}>
          <Icon name="history" size={15} /> Bring one back…
        </button>
      </Row>
    </>
  );
}

/** Home cards: which cards show on Home and in what order, what Today shows, the day note and the review. The same
 *  arrangement Change Home on Home itself keeps (views/HomeView.tsx, the home-cards state key). */
function HomeGroup({ prefs, set }: { prefs: Prefs; set(p: Partial<Prefs>): void }) {
  const vault = useApp((s) => s.vault);
  const sw = useModules();
  const [layout, setLayout] = useState<HomeLayout>(defaultHomeLayout());
  useEffect(() => {
    setLayout(defaultHomeLayout());
    if (!vault?.path) return;
    let live = true;
    void window.nv.state.load('home-cards').then(
      (saved) => live && saved !== null && setLayout(normalizeHomeLayout(saved)),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [vault?.path]);
  const save = useCallback(
    (next: HomeLayout) => {
      setLayout(next);
      if (vault?.path) void window.nv.state.save('home-cards', next).catch(() => undefined);
    },
    [vault?.path],
  );
  const defOf = (id: HomeCardId): HomeCardDef => HOME_CARDS.find((c) => c.id === id)!;
  const offers = useMemo(() => homeOffers(layout.on), [layout]);
  const move = (id: HomeCardId, dir: -1 | 1) => save(moveHomeCard(layout, id, layout.on.indexOf(id) + dir));
  // Each card's own icon on one quiet tile (phase 2, 23 Nov 2026: a solid red "!" beside Today's due items read as an
  // alert with no words; the tile says which card, never a state).
  const tile = (id: HomeCardId): IconName =>
    ({ due: 'task', brief: 'sun', inbox: 'inbox', 'day-note': 'calendar', waiting: 'clock', recent: 'history', upcoming: 'calendar', activity: 'refresh', bills: 'receipt', habits: 'check', weekly: 'star', family: 'heart' } as Record<string, IconName>)[id] ?? 'notes';
  const cardRow = (def: HomeCardDef, on: boolean, i?: number) => {
    const locked = !!def.pack && !moduleIsOn(sw, def.pack.module);
    return (
      <div key={def.id} className={`cardrow${on ? '' : ' off'}`} data-setting={def.title}>
        <span className="grip" aria-hidden="true"><Icon name="grip" size={14} /></span>
        <span className="gtile xs slate" aria-hidden="true"><Icon name={tile(def.id)} size={13} /></span>
        <span className="nm">
          {def.title}
          <span className="ds">{locked ? `Switch on the ${def.pack!.name} pack` : def.words}</span>
        </span>
        {locked ? (
          <span className="ctl"><button className="button" onClick={() => openModal({ kind: 'settings', section: 'packs' })}>Packs</button></span>
        ) : (
          <span className="ctl">
            {on && i !== undefined && (
              <span className="card-move">
                <button className="icon-button small" title="Move up" aria-label={`Move ${def.title} up`} disabled={i === 0} onClick={() => move(def.id, -1)}><Icon name="chevronUp" size={14} /></button>
                <button className="icon-button small" title="Move down" aria-label={`Move ${def.title} down`} disabled={i === layout.on.length - 1} onClick={() => move(def.id, 1)}><Icon name="chevronDown" size={14} /></button>
              </span>
            )}
            <Toggle label={`${def.title} on Home`} value={on} onChange={(v) => save(setHomeCard(layout, def.id, v))} />
          </span>
        )}
      </div>
    );
  };
  return (
    <>
      <h3>On Home · {layout.on.length}</h3>
      <Row title="Home cards" hint="Each card has one job and one action. Cards from packs you switch on appear here too." stacked>
        <div className="home-cards-list">
          {layout.on.map((id, i) => cardRow(defOf(id), true, i))}
        </div>
      </Row>
      <h3>More cards</h3>
      <div className="home-cards-list">{offers.map((def) => cardRow(def, false))}</div>
      <h3>Today</h3>
      <TodayChips prefs={prefs} set={set} />
      <DayNote />
      <WeeklyReviewRows prefs={prefs} set={set} />
    </>
  );
}

/** Quick add: the box, where captures go, the flows, voice and meeting recording. */
function QuickAddGroup({ prefs, set }: { prefs: Prefs; set(p: Partial<Prefs>): void }) {
  return (
    <>
      <CaptureSettings prefs={prefs} set={set} />
      <h3>Voice and meetings</h3>
      <DictationRow prefs={prefs} set={set} />
      <MeetingRecordingRows prefs={prefs} set={set} />
    </>
  );
}

/** Backups and sync: the Git backup, the encrypted sync folder, recovery, Recently deleted and Import. */
function BackupsGroup({ prefs, set }: { prefs: Prefs; set(p: Partial<Prefs>): void }) {
  const [binCount, setBinCount] = useState<number | null>(null);
  useEffect(() => {
    void window.nv.bin
      .call({ action: 'list' })
      .then((raw: unknown) => {
        const v = raw as { items?: unknown[]; others?: unknown[] };
        setBinCount((v.items ?? []).length + (v.others ?? []).length);
      })
      .catch(() => setBinCount(null));
  }, []);
  return (
    <>
      <SyncSettings />
      <BackupSettings />
      <Recovery prefs={prefs} set={set} />
      <h3>Tidy up</h3>
      <Row title="Bin" hint={`One bin, 30 days, with Restore.${binCount === null ? '' : binCount === 0 ? ' Nothing in it now.' : ` ${binCount} ${binCount === 1 ? 'item' : 'items'} in it now.`}`}>
        <button className="button" onClick={() => (closeModal(), A.openBin())}>
          Open
        </button>
      </Row>
      <Row title="Import" hint="Spreadsheets, Markdown files and folders of notes. You see where each bit goes first, and you can undo it.">
        <button className="button" onClick={() => (closeModal(), A.openImport())}>
          Open
        </button>
      </Row>
    </>
  );
}

function Keys({ prefs, set, find }: { prefs: Prefs; set(p: Partial<Prefs>): void; find?: string }) {
  const [filter, setFilter] = useState(find ?? '');
  // A command chosen in Settings search: its row alone.
  useEffect(() => {
    if (find !== undefined) setFilter(find);
  }, [find]);
  const [recording, setRecording] = useState<string | null>(null);
  // An alias's keys show under its survivor (t28 follow-up, 8 Nov 2026: an alias's keys "show
  // under the survivor in Settings › Keys, so they can be changed there"): the survivors list once, as before,
  // each followed by its aliases with keys now (lib/commandAliases.ts) — a key that fires is always
  // changeable. The filter matches an alias's own name or keys too, so the old name finds its row.
  const rows = useMemo(() => {
    const hits = (c: Command) => !filter || c.name.toLowerCase().includes(filter.toLowerCase()) || (hotkeyOf(c) ?? '').toLowerCase().includes(filter.toLowerCase());
    return listedCommands()
      .filter((c) => hits(c) || keyedAliases(COMMANDS, prefs.hotkeys, c.id).some(hits))
      .flatMap((c) => [{ cmd: c, sub: false }, ...keyedAliases(COMMANDS, prefs.hotkeys, c.id).map((a) => ({ cmd: a, sub: true }))]);
  }, [filter, prefs.hotkeys]);
  useEffect(() => {
    if (!recording) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') return setRecording(null);
      const combo = comboFromEvent(e);
      if (!combo) return;
      // Another command's also key counts as taken too (fnv3 F48): a primary key is stripped as before; an
      // also key cannot be stripped, so the person's own key wins over it (App.tsx yields) and they are told.
      const taken = COMMANDS.find((c) => c.id !== recording && (hotkeyOf(c) === combo || alsoKeys(c).includes(combo)));
      const prev = prefs.hotkeys;
      const next = { ...prev, [recording]: combo };
      if (taken && hotkeyOf(taken) === combo) next[taken.id] = '';
      set({ hotkeys: next });
      setRecording(null);
      // Taken keys are never stripped silently (9.2 uplift F134): the displaced command is named, with Undo.
      if (taken) {
        const to = COMMANDS.find((c) => c.id === recording)?.name ?? 'The command';
        toast(`${taken.name} lost ${combo} to ${to}.`, { label: 'Undo', run: () => set({ hotkeys: prev }) }, 7000);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [recording, prefs.hotkeys, set]);
  // The count counts the shown rows (t21, 8 Nov 2026; t28: a shown alias sub-row counts with its survivor).
  const changed = rows.filter((r) => prefs.hotkeys[r.cmd.id] !== undefined).length;
  return (
    <>
      <h3>Every command</h3>
      <input className="setting-input keys-filter" value={filter} placeholder="Find a command or keys…" onChange={(e) => setFilter(e.target.value)} />
      {changed > 0 && (
        <p className="setting-said">
          {changed} changed from the default. <button type="button" className="link-button" onClick={() => set({ hotkeys: {} })}>Back to the defaults</button>
        </p>
      )}
      <div className="keys-list">
        {rows.map((r) => {
          const c = r.cmd;
          const combo = hotkeyOf(c);
          const isChanged = prefs.hotkeys[c.id] !== undefined;
          return (
            <div key={c.id} className={`keys-row${r.sub ? ' is-sub' : ''}`}>
              <span className="keys-name">{c.name}</span>
              {recording === c.id ? (
                <span className="keys-recording">Press the keys… (Esc to stop)</span>
              ) : (
                <button className="keys-combo" onClick={() => setRecording(c.id)} title="Change">
                  {combo ? <kbd>{formatHotkey(combo)}</kbd> : <span className="keys-none">None</span>}
                </button>
              )}
              {isChanged && (
                <button
                  className="icon-button small"
                  title="Back to the default"
                  onClick={() => {
                    const next = { ...prefs.hotkeys };
                    delete next[c.id];
                    set({ hotkeys: next });
                  }}
                >
                  <Icon name="undo" size={13} />
                </button>
              )}
              {combo && (
                <button className="icon-button small" title="No keys" onClick={() => set({ hotkeys: { ...prefs.hotkeys, [c.id]: '' } })}>
                  <Icon name="close" size={13} />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

/**
 * The search box at the top of Settings (lib/settingsSearch.ts): what it finds shows over the group, ↑ ↓ choose and
 * Enter goes; Escape empties the box before it closes Settings.
 */
function SettingsSearchBox({ query, onQuery, onMove, onGo }: { query: string; onQuery(q: string): void; onMove(by: number): void; onGo(): void }) {
  const field = useRef<HTMLInputElement>(null);
  const now = useRef({ query, onQuery });
  now.current = { query, onQuery };
  // Before Settings' own Escape (useEscape, registered after this one, which is registered once so it stays first): a
  // search typed is emptied first.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !now.current.query || document.activeElement !== field.current) return;
      e.preventDefault();
      now.current.onQuery('');
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
  return (
    <label className="set-search">
      <Icon name="search" size={14} />
      <input
        ref={field}
        value={query}
        placeholder="Search settings"
        aria-label="Search settings"
        aria-controls="set-results"
        spellCheck={false}
        onChange={(e) => onQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            onMove(e.key === 'ArrowDown' ? 1 : -1);
          } else if (e.key === 'Enter') {
            e.preventDefault();
            onGo();
          }
        }}
      />
    </label>
  );
}

/** What a search found: each setting with its group, the one chosen by the keys marked. */
function SettingsResults({ query, hits, at, onAt, onGo }: { query: string; hits: SettingEntry[]; at: number; onAt(i: number): void; onGo(entry: SettingEntry): void }) {
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [at]);
  if (!hits.length) return <EmptyState icon="search" title="No setting called that" line={`Nothing in Settings matches “${query.trim()}”. Try another word for it.`} />;
  return (
    <div className="set-results" id="set-results" role="listbox" aria-label="Settings found" ref={list}>
      {hits.map((h, i) => (
        <button key={`${h.section}:${h.command ?? ''}:${h.title}`} type="button" role="option" aria-selected={i === at} className="set-hit" onMouseMove={() => i !== at && onAt(i)} onClick={() => onGo(h)}>
          <span className="set-hit-words">
            <span className="set-hit-title">{h.title}</span>
            {h.hint && <span className="set-hit-hint">{h.hint}</span>}
          </span>
          <span className="set-hit-where">{SECTION_LABELS[h.section]}</span>
        </button>
      ))}
    </div>
  );
}

/** The setting found, in its group: scrolled to the middle with a short glow; its heading when the row isn't shown
 *  now (an h3, or the group's own title for a landing with no row of its own, like the Packs list). True when it landed. */
function showFound(body: HTMLElement | null, title: string, command: boolean): boolean {
  if (!body) return false;
  const rows = command ? [...body.querySelectorAll<HTMLElement>('.keys-row')] : [...body.querySelectorAll<HTMLElement>('[data-setting]')].filter((el) => el.dataset.setting === title);
  const target = rows[0] ?? [...body.querySelectorAll<HTMLElement>('h3')].find((h) => h.textContent?.trim() === title) ?? [...body.querySelectorAll<HTMLElement>('h1')].find((h) => h.textContent?.trim() === title);
  if (!target) return false;
  const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (target.classList.contains('ms-part')) {
    (target.querySelector<HTMLInputElement>('input:enabled') ?? target).focus({ preventScroll: true });
  }
  target.scrollIntoView({ block: 'center', behavior: still ? 'auto' : 'smooth' });
  target.classList.remove('setting-found');
  void target.offsetWidth;
  target.classList.add('setting-found');
  window.setTimeout(() => target.classList.remove('setting-found'), 2400);
  return true;
}

/** Plugins, a first small door (8.9): each plugin with on/off and Remove. Off until switched on; switching one on the
 *  first time asks for it, with what it wants (and a changed plugin asks again). The example present the first time
 *  the group opens in any vault (8.9 round 3: written then, never into a read-only vault). */
function PluginsGroup() {
  const list = usePlugins();
  useEffect(() => {
    void ensurePlugins();
  }, []);
  useEffect(() => {
    const off = window.nv.on.vaultOpened(() => void ensurePlugins());
    return off;
  }, []);
  if (!list) return <p className="hint">Reading your plugins…</p>;
  const switchPlugin = async (p: PluginView, on: boolean) => {
    if (on && !p.allowed) {
      const wants = p.permissions.length ? p.permissions.map(pluginPermissionWords).join('; ') : 'Nothing: it only shows its card and answers its command.';
      const ok = await confirm(`Allow ${p.name}?`, {
        message: `${p.description} It wants: ${wants}. Private notes and Secrets stay out of reach either way.`,
        ok: `Allow ${p.name}`,
      });
      if (!ok) return;
      try {
        await window.nv.plugins.allow(p.id);
      } catch (err) {
        showError(err);
        return;
      }
    }
    try {
      await window.nv.plugins.set(p.id, on);
    } catch (err) {
      showError(err);
    }
    void refreshPlugins();
  };
  const removePlugin = async (p: PluginView) => {
    const ok = await confirm(`Remove ${p.name}?`, {
      message: 'Its folder moves to the Bin, where it can be brought back. Anything it added goes away.',
      ok: 'Remove',
      danger: true,
    });
    if (!ok) return;
    try {
      await window.nv.plugins.remove(p.id);
      toast(`${p.name} was removed. Its folder is in the Bin.`);
    } catch (err) {
      showError(err);
    }
    void refreshPlugins();
  };
  return (
    <>
      {list.length === 0 && <p className="hint">No plugins yet. Your own go in the plugins folder below.</p>}
      {list.map((p) => (
        <Row
          key={p.id}
          title={p.name}
          hint={p.error ? p.error : `${p.description} Wants: ${p.permissions.length ? p.permissions.map(pluginPermissionWords).join('; ') : 'nothing'}.`}
        >
          <Toggle label={`${p.name} on or off`} value={p.on} onChange={(on) => void switchPlugin(p, on)} />
          <button className="button" style={{ height: 32 }} onClick={() => void removePlugin(p)}>
            Remove
          </button>
        </Row>
      ))}
      <Row title="Add your own" hint="A plugin adds a command you can run and a card on Home. Put your own in this folder, then switch it on above.">
        <button className="button" style={{ height: 32 }} onClick={() => void window.nv.plugins.openFolder().catch(showError)}>
          Open plugins folder
        </button>
      </Row>
    </>
  );
}

/** Settings as a page (8.7 w4a round 2): the top bar's crumb says Settings; the rail holds the search and the groups;
 *  the group fills the rest. The group is the tab's path, so asking for a group from anywhere switches the open page,
 *  and switching groups never resizes the frame. Escape goes back to the page Settings replaced. */
export function SettingsPage({ tab }: { tab: W.TabState }) {
  const current = resolveSection(tab.path);
  const [query, setQuery] = useState('');
  const [at, setAt] = useState(0);
  const [found, setFound] = useState<{ title: string; command: boolean; n: number } | null>(null);
  const [keysFind, setKeysFind] = useState<string | undefined>(undefined);
  const page = useRef<HTMLDivElement>(null);
  // The packs are in the index already (moduleEntries, with each pack's earlier names), so nothing is spread twice.
  const hits = useMemo(() => (query.trim() ? searchSettings(query, [...SETTINGS_INDEX, ...PACK_PART_ENTRIES, ...commandEntries(COMMANDS)], SECTION_LABELS).map((h) => h.entry) : []), [query]);
  useEffect(() => {
    setAt(0);
    if (query.trim() && page.current) page.current.scrollTop = 0;
  }, [query]);
  const showGroup = useCallback((id: Section) => {
    setQuery('');
    setKeysFind(undefined);
    setFound(null);
    setWorkspace((ws) => W.updateTab(ws, tab.id, { path: id }));
    page.current?.scrollTo(0, 0);
  }, [tab.id]);
  const go = (entry: SettingEntry | undefined) => {
    if (!entry) return;
    setQuery('');
    if (entry.command) setKeysFind(entry.title);
    setWorkspace((ws) => W.updateTab(ws, tab.id, { path: entry.section }));
    setFound({ title: entry.title, command: !!entry.command, n: Date.now() });
  };
  // A door naming its row (4 Nov 2026, the 14 doors): taken once, landed on the same way as a search hit.
  const door = useSettingsDoor();
  useEffect(() => {
    if (!door) return;
    const req = takeSettingsDoor();
    if (!req) return;
    setQuery('');
    setKeysFind(undefined);
    setFound({ title: req.row, command: false, n: req.at });
  }, [door]);
  // After the group has drawn (its Details opened, the Keys list filtered), the setting is brought into view. Groups
  // that read their rows over IPC (Backups, Privacy, Agents) may still be loading, so a missed row is tried again for
  // a moment instead of the highlight silently never landing.
  useEffect(() => {
    if (!found) return;
    let stop = false;
    let tries = 0;
    let frame = 0;
    const tick = (): void => {
      if (stop) return;
      if (showFound(page.current, found.title, found.command)) return;
      if (++tries > 24) return;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(tick);
    });
    return () => {
      stop = true;
      cancelAnimationFrame(frame);
    };
  }, [found, current]);
  const prefs = usePrefs();
  const ws = useWorkspace();
  const set = (patch: Partial<Prefs>) => void savePrefs(patch).catch(showError);
  useEscape(() => {
    const live = W.groups(ws.root).flatMap((g) => g.tabs).find((t) => t.id === tab.id) ?? tab;
    if (live.back.length) setWorkspace((w) => W.navigate(w, tab.id, -1));
  });
  const showTitle = (title: string) => showFound(page.current, title, false);
  return (
    <>
      <ViewHeader tab={tab} crumb={<b>Settings</b>} />
      <div className="nv-page-scroll settings-scroll" ref={page}>
        <div className="settings settings-page">
          <nav className="settings-nav" aria-label="Settings groups">
            <SettingsSearchBox query={query} onQuery={setQuery} onMove={(by) => hits.length && setAt((i) => (i + by + hits.length) % hits.length)} onGo={() => go(hits[at])} />
            {SETTINGS_JOB_GROUPS.map((g) => (
              <div key={g.id} className="set-nav-group">
                <div className="set-nav-name">{g.label}</div>
                {g.sections.map((id) => {
                  const s = SECTIONS.find((x) => x.id === id)!;
                  return (
                    <button
                      key={s.id}
                      className={current === s.id && !query.trim() ? 'active' : ''}
                      onClick={() => showGroup(s.id)}
                    >
                      <Icon name={s.icon} size={15} />
                      {s.label}
                    </button>
                  );
                })}
              </div>
            ))}
          </nav>
          <div className={`settings-body${query.trim() ? ' is-searching' : ''}`}>
            {query.trim() && (
              <div className="set-results-page">
                <h2>Settings found</h2>
                <SettingsResults query={query} hits={hits} at={at} onAt={setAt} onGo={go} />
              </div>
            )}
            <h1>{SECTIONS.find((s) => s.id === current)?.label}</h1>
            <p className="setting-words">{SECTION_WORDS[current]}</p>
            <ManagedNotice section={current} />
            <div className="card settings-card" data-section={current}>
              {current === 'general' && <General onShow={showTitle} reveal={found && !found.command ? found.title : null} />}
              {current === 'look' && <Look prefs={prefs} set={set} />}
              {current === 'home' && <HomeGroup prefs={prefs} set={set} />}
              {current === 'packs' && <ModulesSettings reveal={found?.title} />}
              {current === 'quick-add' && <QuickAddGroup prefs={prefs} set={set} />}
              {current === 'backups' && <BackupsGroup prefs={prefs} set={set} />}
              {current === 'keys' && <Keys prefs={prefs} set={set} find={keysFind} />}
              {current === 'models' && <AiSettings prefs={prefs} set={set} />}
              {current === 'agents' && <AgentsSettings />}
              {current === 'privacy' && <PrivacySettings />}
              {current === 'plugins' && <PluginsGroup />}
              {current === 'publish' && <PublishSettings />}
              {current === 'about' && <AboutPage />}
              {current === 'account' && <AccountSettings />}
              {current === 'teams' && <TeamsSettings />}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
