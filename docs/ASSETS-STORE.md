# The asset store (17 Oct 2026)

One store for every asset: files, images, logos, SVGs and documents.

## What it is

A business's logos, photos, icons, PDFs, Word, Excel and PowerPoint files, videos and recordings, kept in the library
as ordinary files and found on the **Assets** page (the left ribbon, or "Open your assets" in the command list).

- **Where the files are**: the library's Assets folder (Settings › Files and links › "Your assets are kept in", `Assets`
  by default). Files added on the page are copied into a folder per kind: `Assets/Logos`, `Assets/Images`,
  `Assets/Icons`, `Assets/Documents`, `Assets/Video and audio`, `Assets/Other`. The pictures and files pasted or dropped
  into notes (the attachments folder) are shown too, marked "In a note"; they are never moved.
- **Kinds** come from the file's name (a picture whose name says logo, wordmark or monogram is a logo; an SVG or ICO is
  an icon; and so on) and can be changed per asset.
- **Nothing binary is made in the library.** Thumbnails, picture sizes and colours, and content hashes are kept in
  Ironleaf's own data (`asset-thumbnails/` beside its settings), never in the library.
- **Duplicates** are found by content (SHA-256, only for files of the same size): the person chooses "Use the one there"
  or "Keep both".
- **SVGs** are made safe before they are drawn (no scripts, event handlers, outside links or fetched styles) and are only
  ever drawn as pictures, where scripts never run.

## The index file: `<Assets folder>/assets.json`

Plain JSON beside the files: what the person wrote about each asset, the collections, and the brand kits. Safe to edit by
hand; Ironleaf reads it leniently (anything it doesn't understand is left out, never an error) and writes it back in a
stable order. Paths are library paths with forward slashes. When a file is renamed or moved in Ironleaf its entry
follows; when it goes to the Recycle Bin its entry goes.

```json
{
  "about": "Ironleaf’s asset index: …",
  "version": 1,
  "brand": {
    "name": "Saltwater Bakehouse",
    "logos": {
      "primary": "Assets/Logos/Saltwater logo.svg",
      "onDark": "Assets/Logos/Saltwater logo on dark.svg",
      "icon": "Assets/Logos/Saltwater mark.svg"
    },
    "colours": [
      { "name": "Harbour blue", "hex": "#1d4e89", "use": "Headings and the logo" },
      { "name": "Sand", "hex": "#e8a838", "use": "Highlights and buttons" }
    ],
    "fonts": [
      { "name": "Georgia", "use": "Headings" },
      { "name": "Arial", "use": "Body text" }
    ]
  },
  "collections": ["Brand", "Wexley St photos"],
  "assets": {
    "Assets/Logos/Saltwater logo.svg": {
      "description": "The main logo. Use it on light backgrounds.",
      "alt": "Saltwater Bakehouse logo",
      "tags": ["brand", "print"],
      "collections": ["Brand"],
      "added": "2026-10-17"
    },
    "Assets/Images/Wexley St shopfront.jpg": {
      "kind": "image",
      "alt": "The shopfront with its striped awning",
      "collections": ["Wexley St photos"]
    }
  }
}
```

| Field | Meaning |
| --- | --- |
| `brand.name` | The business's name as it is written. |
| `brand.logos.primary` / `onDark` / `icon` | The logo used first (light backgrounds), the one for dark backgrounds and photos, the small square mark. Each is a library path to an asset. |
| `brand.colours[]` | `hex` is `#rrggbb` (lower case); `name` and `use` are the person's words. |
| `brand.fonts[]` | Font names as the person writes them, with what each is for. |
| `collections` | Every collection in the person's order (an empty one is kept). |
| `assets[path].kind` | Present only when the person chose a kind other than the one its name gives: `logo`, `image`, `icon`, `document`, `media`, `other`. |
| `assets[path].description` | What it is and when to use it. |
| `assets[path].alt` | What a picture shows, for people who can't see it; written into a note with the picture (`![[file|alt]]`). |
| `assets[path].tags`, `collections` | Labels; an asset can be in several collections. |
| `assets[path].added` | The day it was added on the Assets page (`YYYY-MM-DD`). |

A vault may hold several brand kits: one per area and project, with a clear default. A note takes its project's kit,
otherwise its area's, otherwise the default; an area set to `null` takes no brand, and the clean neutral document prints.
With one kit and no choices the file reads as above, so nothing changes for someone with one kit. With several (or any
choices), the kits read as `brands` with ids, the default as `brandDefault`, and each area's and project's choice beside
them; there is no second copy of the default:

```json
{
  "about": "Ironleaf’s asset index: …",
  "version": 1,
  "brands": [
    {
      "id": "redline-co",
      "name": "Redline Co",
      "logos": { "primary": "Assets/Logos/Redline logo.svg" },
      "colours": [{ "name": "Signal red", "hex": "#b3261e", "use": "Headings" }],
      "fonts": []
    },
    {
      "id": "tealwork-studio",
      "name": "Tealwork Studio",
      "logos": { "primary": "Assets/Logos/Teal logo.svg" },
      "colours": [{ "name": "Pine", "hex": "#0f6b5c", "use": "Headings" }],
      "fonts": []
    }
  ],
  "brandDefault": "redline-co",
  "brandAreas": { "work": "redline-co", "business": "tealwork-studio", "family": null },
  "brandProjects": { "Work/Projects/Harbour fit-out/Harbour fit-out.md": "tealwork-studio" },
  "collections": [],
  "assets": {}
}
```

| Field | Meaning |
| --- | --- |
| `brands[].id` | The kit's own id (lower case, words joined by a dash); names may change, ids never do. |
| `brandDefault` | The default kit's id: what a note with no other choice takes. |
| `brandAreas` | An area's kit by its area id, or `null` for no brand (an area missing here takes the default). |
| `brandProjects` | A project's kit by its project file's library path (a project missing here takes its area's). |

Which kit a note takes is answered in one place: `src/shared/brand-kits.ts` (`kitForNote`, from the note's path and
properties with the vault's areas and projects). The branded document, the share header, the weekly update and the agent
bridge all read through it.

**For other tools** (design tools reading the brand kits): read `brands` for every kit (an older file's single `brand` reads
as its one kit, the default). For "use my logo" prefer `primary`, `onDark` on dark backgrounds, `icon` where it must be
square; `colours` / `fonts` give the palette and type. Ironleaf's code for the shape is `src/shared/assets.ts`
(`parseIndex`, `serializeIndex`, `cleanBrand`, `withBrand`).

## Where it reaches

- **Notes**: the `/` menu's "Picture from assets" and the command "Insert a picture or file from your assets" open a
  picker; dragging an asset from the page into a note or onto a canvas embeds it (with its alt text). The details panel's
  Insert puts it at the cursor of the note being worked on beside the page.
- **The chat's assistant** (src/main/agent.ts) has read-only tools: `list_assets`, `asset_details` (with the embed to
  write) and `brand_kit`.
- **Where it's used**: notes that link or embed an asset, canvases with it on a card, and the projects those notes
  belong to, shown in the details panel and counted on each tile.

Code: `src/shared/assets.ts` (kinds, the index, safe SVGs, colours, where used), `src/shared/brand-kits.ts` (which kit
a note takes), `src/main/assets.ts` (the store on disk), `src/renderer/src/views/AssetsPage.tsx` and `views/assets/`,
`styles/assets.css`; tests in `tests/assets.test.mjs`; screens by `tools/shots-assets.mjs`.
