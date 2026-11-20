// A text file brought in as its text (Vite's "?raw"): the bundled version history (CHANGELOG.md, components/about).
declare module '*?raw' {
  const text: string;
  export default text;
}
