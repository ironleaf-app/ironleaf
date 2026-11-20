# Assets and their licences

Every file Ironleaf ships that isn't our own code, and every asset of our own, with where it came from. `npm test`
(tests/clean-room.test.mjs) fails when a file under `resources/` or `src/renderer/src/assets/` is missing from this list.

## Our own

| File | What it is | Source |
|---|---|---|
| `resources/icon.png`, `resources/icon.ico`, `build-standalone/build/icon.ico` | Ironleaf's app icon (the leaf with its folded corner on the iron tile) | Drawn for Ironleaf by its brand kit (`ironleaf-brand (the brand kit, kept outside this repository)`), copied by `tools/make-icon.py` |
| `build-standalone/build/installerSidebar.bmp`, `uninstallerSidebar.bmp` | The Windows installer's side picture | Drawn by `tools/make-icon.py` from the icon and Geist |
| `resources/tray/ironleaf-tray-white.ico`, `ironleaf-tray-dark.ico`, `ironleaf-tray-white.png`, `ironleaf-tray-dark.png`, `ironleaf-tray-white@2x.png`, `ironleaf-tray-dark@2x.png` | The tray icon (the leaf alone, one colour) | Drawn for Ironleaf by its brand kit, copied by `tools/make-tray-icons.py` |
| `src/renderer/src/components/Icon.tsx` | Every interface icon | Drawn for Ironleaf (24 × 24 line paths) |
| `src/renderer/src/assets/ironleaf-mark-tile.svg` | Ironleaf's mark on its tile, at the top of Settings › About and updates | The brand kit's `mark-tile.svg` (kept outside this repository) |
| `src/renderer/src/assets/sub-vault-flat.svg` | Ironleaf's mark in the F2 Honey Glow family (8.1) | Drawn for Ironleaf (the F2 brand pack) |
| `tools/review-notes/Attachments/storefront.png` | A picture in the made-up review notes | A copy of Ironleaf's own icon |

## Fonts

| File | Font | Licence |
|---|---|---|
| `src/renderer/src/assets/fonts/inter-latin.woff2`, `inter-latin-italic.woff2` | Inter (Rasmus Andersson) | SIL Open Font License 1.1 (`Inter-OFL.txt`) |
| `src/renderer/src/assets/fonts/source-serif-4-latin.woff2` | Source Serif 4 (Adobe) | SIL Open Font License 1.1 (`SourceSerif4-OFL.txt`) |
| `src/renderer/src/assets/fonts/geist-latin.woff2`, `geist-mono-latin.woff2` | Geist and Geist Mono (Vercel), the interface type since 8.1 | SIL Open Font License 1.1 (`Geist-OFL.txt`) |
| `src/renderer/src/assets/fonts/Inter-OFL.txt`, `SourceSerif4-OFL.txt`, `Geist-OFL.txt` | The licences | — |
| KaTeX's fonts (bundled from `node_modules/katex/dist/fonts`) | Maths fonts | MIT (KaTeX) |

## Files of others we ship unchanged

| File | What it is | Licence |
|---|---|---|
| `resources/models/all-MiniLM-L6-v2/onnx/model_quantized.onnx`, `config.json`, `tokenizer.json`, `tokenizer_config.json`, `special_tokens_map.json` | all-MiniLM-L6-v2 (sentence-transformers), quantized ONNX export from https://huggingface.co/Xenova/all-MiniLM-L6-v2, unmodified: on-device embeddings for finding notes by meaning (10.0). Checksums in `SOURCE.md` | Apache-2.0 |
| `resources/models/all-MiniLM-L6-v2/SOURCE.md` | Where the model came from, its licence and checksums | Ours |
| `resources/models/ms-marco-MiniLM-L-6-v2/onnx/model_quantized.onnx`, `config.json`, `tokenizer.json`, `tokenizer_config.json`, `special_tokens_map.json` | ms-marco-MiniLM-L6-v2 (cross-encoder), quantized ONNX export from https://huggingface.co/Xenova/ms-marco-MiniLM-L-6-v2, unmodified: on-device reranking of search results (10.0). Checksums in `SOURCE.md` | Apache-2.0 |
| `resources/models/ms-marco-MiniLM-L-6-v2/SOURCE.md` | Where the reranker came from, its licence and checksums | Ours |
| `resources/models/speaker/segmentation-3-0-int8.onnx` | pyannote/segmentation-3.0 (https://huggingface.co/pyannote/segmentation-3.0), sherpa-onnx export (https://github.com/k2-fsa/sherpa-onnx, release speaker-segmentation-models), unmodified: who speaks when in each 10-second window for telling meeting voices apart on this PC only. Checksums in `SOURCE.md` | MIT (CNRS) (`LICENSE-pyannote-segmentation-3.0`) |
| `resources/models/speaker/campplus-zh-en-advanced.onnx` | iic/speech_campplus_sv_zh_en_16k-common_advanced (https://www.modelscope.cn/models/iic/speech_campplus_sv_zh_en_16k-common_advanced/summary), sherpa-onnx export (release speaker-recongition-models), unmodified: what each voice sounds like for telling meeting voices apart on this PC only. Checksums in `SOURCE.md` | Apache-2.0 (3D-Speaker, Alibaba DAMO) (`LICENSE-Apache-2.0`) |
| `resources/models/speaker/SOURCE.md` | Where the speaker models came from, their licences and checksums | Ours |
| `src/renderer/src/assets/pdfjs/pdf.min.mjs`, `pdf.worker.min.mjs` | PDF.js 6.3.289 (Mozilla, https://github.com/mozilla/pdf.js, from pdfjs-dist), unmodified except the source-map line. Draws a PDF's first page for the project Files grid, the Assets page and canvas cards (`src/renderer/src/lib/pdfThumb.ts`); reads PDFs' words for searching inside project files, in a worker thread on the main side (`src/main/doc-text.ts`, the same copy found beside the window's files) | Apache-2.0 (`PDFJS-LICENSE.txt`) |
| `src/renderer/src/assets/pdfjs/PDFJS-LICENSE.txt` | PDF.js's licence | — |

## Libraries bundled into the app

| Package | Used for | Licence |
|---|---|---|
| react, react-dom | The window's interface | MIT |
| @codemirror/*, @lezer/* | The note editor and Markdown parsing | MIT |
| markdown-it, markdown-it-footnote | Reading mode and previews | MIT |
| katex | Maths | MIT |
| mermaid (with its dependencies, including cytoscape and dompurify) | Diagrams | MIT (dompurify: MPL-2.0 or Apache-2.0) |
| d3-force | The graph's layout | ISC |
| yaml | Properties (front matter) | ISC |
| @earendil-works/pi-ai | Model calls when Ironleaf runs on its own (development) | MIT |
| jose | Verifying Teams/Enterprise licence files and the signature on update descriptions (latest.json.sig) | MIT |

The full list of bundled packages, with licence texts, is THIRD_PARTY_NOTICES.md (`node tools/third-party-notices.mjs`).
