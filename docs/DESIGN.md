# Ironleaf design rules

How Ironleaf should look, feel and read, for everyone who changes its screens: people and coding agents alike
([AGENTS.md](../AGENTS.md)). The ideas come from three places, written here in our own words for a desktop notes app:
the design principles of Meta's open-source Astryx design system (MIT), Anthropic's frontend-design guidance
(Apache-2.0) and the Chrome team's Modern Web Guidance (Apache-2.0). Ironleaf uses none of their code or components.

The bar: every screen looks considered at 1000 px and at 2560 px, in light and dark, and works from the keyboard
alone. Calm, dense where the work is dense, never decorated for its own sake.

## 1. Principles

1. **Closeness shows what belongs together.** Related things sit close; unrelated groups are set apart by space,
   not by another box. Reach for a border or a card only when space alone cannot carry the grouping.
2. **Hierarchy comes from type, not from containers.** One clear title per view, then size, weight and colour
   contrast. If two things on a screen look equally important, one of them is wrong.
3. **Colour is for meaning, and it is scarce.** Neutral surfaces and text carry the screen; the accent marks the one
   action or state that matters there; red, amber and green mean danger, caution and done, nothing else.
4. **Elevation means layering.** A shadow says "this sits above the page" (a menu, a dialog, a dragged card). Cards at
   rest on the page are flat or carry the hairline `--e-1`, never a heavy shadow.
5. **Shape follows role.** Radius grows with the size and importance of the thing: tags `--r-1`, controls `--r-2`,
   cards `--r-3`, hero panels `--r-4`. Not one radius on everything.
6. **Compose from frames.** A page is a frame (header, reading column, side column) filled with parts that already
   exist. Before inventing a layout, find the page that already solves it and use its frame.
7. **Spend boldness in one place.** One memorable element per screen (a big number, the graph, the note itself);
   everything around it quiet. Before you finish, take one thing away.

## 2. Tokens

Use tokens, never raw values. They live in `src/renderer/src/styles.css` (scales) and
`src/renderer/src/styles/palettes.css` (colour, per palette, light and dark).

| What | Use | Never |
|---|---|---|
| Colour | role tokens: `--bg`, `--bg-soft`, `--bg-raised`, `--bg-hover`, `--border`, `--text`, `--text-strong`, `--text-muted`, `--text-faint`, `--accent-*`, `--focus-ring` | a hex or `rgb()` outside `palettes.css` |
| Type | `--fs-display` 52, `--fs-page` 38, `--fs-section` 20, `--fs-card` 17, `--fs-reading` 16.5, `--fs-body` 15, `--fs-md` 14, `--fs-small` 13, `--fs-caption` 12, `--fs-xs` 11 | a pixel font size |
| Spacing | `--space-0…7` (below) | a raw pixel padding, margin or gap |
| Radius | `--r-1` 4, `--r-2` 6, `--r-3` 8, `--r-4` 10 | a raw radius |
| Elevation | `--e-1` resting hairline, `--e-2` lifted (menus, popovers), `--e-3` dialog | a hand-made `box-shadow` |
| Fonts | `--font-ui`, `--font-text` | a font family name in a rule |

**The spacing scale** (styles.css): `--space-0` 2, `--space-1` 4, `--space-2` 8, `--space-3` 12, `--space-4` 16,
`--space-5` 24, `--space-6` 36, `--space-7` 64. Pick by relationship, not by eye: 2 and 4 inside a control, 8 and 12
between related items, 16 and 24 between groups, 36 and 64 around a page. Many older rules still use off-scale pixels
(6, 10, 14, 18, 20 px); move each onto the nearest step when you touch it, and look at the result. The UI ratchet
holds the line.

## 3. Layout and density

- **No dead white space.** A wide window gets a second column or a wider grid, never a stretched row, a narrow
  centred column with empty bands, or a tiny panel in a corner. Check every change at about 2560 px with the
  assistant panel open.
- Reading text stays under about 80 characters a line (`--reading`); tools, tables and boards use the room.
- Use container queries for parts that live in panes of changing width, not window media queries.
- Nothing cut off with "...": wrap, give the name its room, or show the whole of it on hover.
- Sticky headers and footers never cover content; the last row of a scroller can always be reached.

## 4. Controls and states

- Native first: `<dialog>` for modals, `popover` for menus and tooltips, `<details>` for disclosure, real `<button>`
  and `<a>` for anything clickable. A clickable `div` needs a role, a tab stop and keys, and is a last resort.
- Every control has a visible focus ring (`--focus-ring`), a hover and a pressed state, and a disabled state that
  says why when it matters.
- Every icon-only button has an accessible name (`aria-label` or `title`).
- Enter submits only when no text is being composed (`event.isComposing`), so people typing in Chinese, Japanese or
  Korean are not cut off mid-word.
- Empty states say what to do next. Errors say what happened and how to fix it, in plain words, without apologising.

## 5. Accessibility floor

WCAG 2.2 AA: text contrast at least 4.5:1 (3:1 for large text and control edges) in every palette; everything
reachable and usable from the keyboard in a sensible order; names and roles for assistive technology; motion off or
reduced under `prefers-reduced-motion`; nothing that relies on colour alone.

## 6. Motion

Motion answers a person's action: opening, expanding, moving, confirming. Short (120–200 ms), eased, and never on
every card or every hover. Prefer view transitions and `@starting-style` over JavaScript animation.

## 7. Words

Plain Australian English, sentence case, active voice. Name things by what people do, not how the system works. A
button says exactly what happens ("Save as PowerPoint", not "Submit"), and the result uses the same word ("Saved as
PowerPoint"). One job per piece of text; no filler, no selling.

## 8. Tells of a generated, templated look (avoid unless a brief asks)

- a tracked-out capitals label above every heading;
- content chopped into identical rounded cards with the same soft shadow;
- one word of a heading picked out in another colour or italic;
- a coloured stripe down the side of cards;
- numbered markers (01, 02, 03) on things that are not a sequence;
- meta strings joined with middle dots, arrows appended to button text, gradient washes as decoration;
- fade-and-slide entrances on every section.

## 9. How a change is checked

1. `npm run test:fast`: house rules, layout walks and the UI ratchet (`tests/ui-ratchet.test.mjs`).
2. Modern Web Guidance for the capability you touched (`npx modern-web-guidance search …`).
3. Look at it: narrow and wide, light and dark, keyboard only. A picture finds what tests miss.
