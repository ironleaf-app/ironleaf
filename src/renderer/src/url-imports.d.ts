// A file brought in as its URL (Vite's "?url"): the bundled PDF.js and its worker (lib/pdfThumb.ts).
declare module '*?url' {
  const url: string;
  export default url;
}

// A small file kept as a file of its own (never inlined as data:, which the window's security rules refuse): the meeting
// recorder's audio tap (lib/tap-worklet.js).
declare module '*?url&no-inline' {
  const url: string;
  export default url;
}
