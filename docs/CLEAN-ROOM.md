# How Ironleaf is made (clean room)

Ironleaf is written from scratch by Kaitiaki IT. People who use other Markdown notes apps should feel at home in it,
and their folders of notes should open and work. It must never contain, or come from, another company's software.

## The rules

1. **Never open, run or study Obsidian, and never use its website as a source.** Obsidian's Terms of Service (Dynalist
   Inc., updated 20 February 2025) forbid reverse engineering, and forbid accessing the software or its services, which
   include its published content, "in order to develop a competing product or service". So Obsidian is not installed
   anywhere for this work, and its help pages are not read for it.
2. **Build from open formats anyone may use:**
   - Markdown: CommonMark and GitHub Flavored Markdown (tables, tick-boxes, strikethrough, autolinks);
   - YAML front matter (properties);
   - wiki-style `[[links]]`, `![[embeds]]` and `#tags`, conventions shared by many wikis and notes tools;
   - GitHub's published "alerts" syntax for callouts (`> [!note]`);
   - LaTeX maths (rendered by KaTeX) and Mermaid diagrams (rendered by Mermaid);
   - the JSON Canvas format (jsoncanvas.org, MIT licence) for `.canvas` files.
3. **Write every line fresh**, from general knowledge of how notes apps work. No code, CSS, text or layout values are
   copied from any notes app.
4. **No vendor assets.** No other company's icons, fonts, images, templates, sample notes or colours. Every asset in the
   app is listed in [ASSETS.md](../ASSETS.md) with where it came from and its licence. `npm test` fails if an asset is
   not listed, if a bundled package carries a licence outside the allowed list, or if a vendor's name appears in the
   source.
5. **Our own brand.** Ironleaf has its own palette, type and icons (Kaitiaki IT's). Another product's name appears
   only in public words that say a folder of its notes opens in Ironleaf, always with: "Ironleaf is not
   affiliated with or endorsed by the makers of other notes apps."
6. **Apps to watch for feel** may only be open-source ones whose licences and terms allow it (for example Logseq or
   Zettlr), watched through their screens only.

## History

On 16 October 2026 a feature list made in an earlier session (by unpacking another app's program files and reading its
text) was taken out of this repository and set aside, unused. Nothing in Ironleaf's code came from it; features are
built from the open formats and general knowledge above.
