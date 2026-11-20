// Line icons drawn for Ironleaf (24×24 grid, stroke only, round ends). Our own drawings, except settings and bell:
// the former host app's gear and bell (p11-uniform-account round 2, 4 Nov 2026), the Feather icons (MIT, Copyright
// (c) 2013-present Cole Bemis; permission is hereby granted, free of charge, to deal in them without restriction,
// including to use, copy, modify, merge, publish, distribute, sublicense, and sell copies, provided this notice is
// kept. THEY ARE PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND). The gear's circle (the former host app draws
// circle + path; this component draws one path) is the same r3 ring as a subpath.

const PATHS = {
  // Flows (views/flow): a letter, a clock, a fork in the way, a bell, cards joined.
  mail: 'M4.5 6h15A1.5 1.5 0 0 1 21 7.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 16.5v-9A1.5 1.5 0 0 1 4.5 6zM3.6 7.2l8.4 6.3 8.4-6.3',
  clock: 'M12 3.5a8.5 8.5 0 1 1 0 17 8.5 8.5 0 0 1 0-17zM12 7.5V12l3 2',
  branch: 'M4 12h4.5l4-5.5H20M12.5 17.5H20M8.5 12l4 5.5M17 4l3 2.5L17 9M17 15l3 2.5-3 2.5',
  bell: 'M6 8.5a6 6 0 0 1 12 0c0 6.5 2.5 8.5 2.5 8.5h-17S6 15 6 8.5ZM10.3 20.5a2 2 0 0 0 3.4 0',
  flow: 'M3.5 9.5h5v5h-5zM15.5 4h5v5h-5zM15.5 15h5v5h-5zM8.5 12h3.5V6.5h3.5M12 12v5.5h3.5',
  files: 'M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2h8.5A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z',
  folder: 'M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2h8.5A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z',
  folderOpen: 'M3 17.5v-11A1.5 1.5 0 0 1 4.5 5H9l2 2h7a1.5 1.5 0 0 1 1.5 1.5V10M3 17.5 5.6 11a1.5 1.5 0 0 1 1.4-1h13a1 1 0 0 1 .9 1.4l-2.6 6.6a1.5 1.5 0 0 1-1.4 1H4.5A1.5 1.5 0 0 1 3 17.5z',
  folderPlus: 'M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2h8.5A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5zM12 10v6M9 13h6',
  file: 'M6.5 3H14l4.5 4.5V19.5A1.5 1.5 0 0 1 17 21H6.5A1.5 1.5 0 0 1 5 19.5v-15A1.5 1.5 0 0 1 6.5 3zM14 3v4.5h4.5',
  filePlus: 'M6.5 3H14l4.5 4.5V19.5A1.5 1.5 0 0 1 17 21H6.5A1.5 1.5 0 0 1 5 19.5v-15A1.5 1.5 0 0 1 6.5 3zM14 3v4.5h4.5M11.75 11v6M8.75 14h6',
  image: 'M4.5 5h15A1.5 1.5 0 0 1 21 6.5v11a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5v-11A1.5 1.5 0 0 1 4.5 5zM3 16l5-5 4.5 4.5L15 13l6 6M15.5 9.5a1.25 1.25 0 1 0 0-.01',
  pdf: 'M6.5 3H14l4.5 4.5V19.5A1.5 1.5 0 0 1 17 21H6.5A1.5 1.5 0 0 1 5 19.5v-15A1.5 1.5 0 0 1 6.5 3zM14 3v4.5h4.5M8.5 12.5h7M8.5 16h5',
  // A doc (how something is set up and run): a sheet with a heading and lines.
  doc: 'M6.5 3h11A1.5 1.5 0 0 1 19 4.5v15a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 19.5v-15A1.5 1.5 0 0 1 6.5 3zM8.5 7.5h5M8.5 11h7M8.5 14h7M8.5 17h4.5',
  audio: 'M9 18V6.5l10-2V16M9 18a2.5 2.5 0 1 1-2.5-2.5H9zM19 16a2.5 2.5 0 1 1-2.5-2.5H19z',
  video: 'M4.5 6h9A1.5 1.5 0 0 1 15 7.5v9a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 3 16.5v-9A1.5 1.5 0 0 1 4.5 6zM15 10.5l6-3.5v10l-6-3.5',
  canvas: 'M4 4.5h6.5v6H4zM13.5 13.5H20v6h-6.5zM10.5 7.5h4a1.5 1.5 0 0 1 1.5 1.5v4.5',
  // A view over notes (src/shared/views.ts): a sheet with a heading row and a name column; a board's three lanes.
  views: 'M4.5 4.5h15A1.5 1.5 0 0 1 21 6v12a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18V6a1.5 1.5 0 0 1 1.5-1.5zM3 9.5h18M9 9.5v10',
  board: 'M5 4h3.5a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM12.25 4h3.5a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1h-3.5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM19.5 4H19a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h.5a1 1 0 0 0 1-1V5a1 1 0 0 0-1-1z',
  search: 'M10.5 4a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13zM15.5 15.5 20 20',
  graph: 'M6 7a2 2 0 1 0 0-.01M18 6a2 2 0 1 0 0-.01M12 18a2 2 0 1 0 0-.01M7.7 8.2l3.2 7.9M16.6 7.6l-3.6 8.6M8 6.8l8-.6',
  localGraph: 'M12 12a2.2 2.2 0 1 0 0-.01M5 6a1.6 1.6 0 1 0 0-.01M19 7a1.6 1.6 0 1 0 0-.01M17 19a1.6 1.6 0 1 0 0-.01M6.3 6.9l4 3.8M17.6 7.8l-4 3M15.9 17.8l-2.6-4.3',
  inbox: 'M4 13l2.4-7.4A1.5 1.5 0 0 1 7.8 4.5h8.4a1.5 1.5 0 0 1 1.4 1.1L20 13v5.5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5zM4 13h4.5l1.5 2.5h4l1.5-2.5H20',
  review: 'M5.5 5h13A1.5 1.5 0 0 1 20 6.5v12a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5v-12A1.5 1.5 0 0 1 5.5 5zM4 10h16M8 3v4M16 3v4M9 15l2.2 2.2L15.5 13',
  calendar: 'M5.5 5h13A1.5 1.5 0 0 1 20 6.5v12a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5v-12A1.5 1.5 0 0 1 5.5 5zM4 10h16M8 3v4M16 3v4',
  command: 'M9 9h6v6H9zM9 9V6.5A2.5 2.5 0 1 0 6.5 9H9M15 9V6.5A2.5 2.5 0 1 1 17.5 9H15M9 15v2.5A2.5 2.5 0 1 1 6.5 15H9M15 15v2.5a2.5 2.5 0 1 0 2.5-2.5H15',
  chat: 'M5 5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H10l-5 4v-4H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z',
  link: 'M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1',
  backlinks: 'M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11',
  outgoing: 'M7 17 17 7M9 7h8v8',
  settings: 'M9 12a3 3 0 1 0 6 0 3 3 0 1 0-6 0z M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  back: 'M15 5l-7 7 7 7',
  forward: 'M9 5l7 7-7 7',
  book: 'M4 5.5A1.5 1.5 0 0 1 5.5 4H11v16H5.5A1.5 1.5 0 0 1 4 18.5zM13 4h5.5A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5H13z',
  pencil: 'M4 20l4-1L19 8l-3-3L5 16zM14 7l3 3',
  code: 'M9 7l-5 5 5 5M15 7l5 5-5 5',
  sparkle: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z',
  spark: 'M12 2.5l2 7.5 7.5 2-7.5 2-2 7.5-2-7.5-7.5-2 7.5-2z',
  sidebarLeft: 'M5 5h14a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM9.5 5v14',
  sidebarRight: 'M5 5h14a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM14.5 5v14',
  chevron: 'M9 6l6 6-6 6',
  chevronDown: 'M6 9l6 6 6-6',
  // The upward twin of chevronDown (9.5 polished, 1 Nov 2026): move-up controls draw the kit, never a typed arrow.
  chevronUp: 'M6 15l6-6 6 6',
  stop: 'M7 7h10v10H7z',
  send: 'M4 12l16-8-6 16-2-6z',
  more: 'M5.5 12h.5M11.75 12h.5M18 12h.5',
  close: 'M6.5 6.5l11 11M17.5 6.5l-11 11',
  pin: 'M9 4h6l-1 6 3 3H7l3-3zM12 13v7',
  splitRight: 'M5 5h14a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM12 5v14',
  splitDown: 'M5 5h14a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM4 12h16',
  newTab: 'M5 6h14a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1zM12 9.5v6M9 12.5h6',
  bookmark: 'M7.5 4h9a1 1 0 0 1 1 1v15l-5.5-4-5.5 4V5a1 1 0 0 1 1-1z',
  tag: 'M3.5 11.6V5A1.5 1.5 0 0 1 5 3.5h6.6a1.5 1.5 0 0 1 1.06.44l7.4 7.4a1.5 1.5 0 0 1 0 2.12l-6.62 6.62a1.5 1.5 0 0 1-2.12 0l-7.4-7.4a1.5 1.5 0 0 1-.42-1.08zM8 8h.01',
  outline: 'M9 6h11M11 12h9M11 18h9M4 6h1.5M6 12h1.5M6 18h1.5',
  list: 'M9 6h11M9 12h11M9 18h11M4.5 6h.5M4.5 12h.5M4.5 18h.5',
  grid: 'M5 4h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM14 4h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM5 13h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-5a1 1 0 0 1 1-1zM14 13h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-5a1 1 0 0 1-1-1v-5a1 1 0 0 1 1-1z',
  numbered: 'M10 6h10M10 12h10M10 18h10M4 5l1.5-1v5M3.5 14.6A1.5 1.5 0 0 1 6.2 15c0 1.2-2.7 2-2.7 3.4h2.8',
  task: 'M5.5 4h13A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5v-13A1.5 1.5 0 0 1 5.5 4zM8 12.2l2.8 2.8 5.2-6',
  quote: 'M6 10.5h4V16H5v-4a6 6 0 0 1 3-5.2M15 10.5h4V16h-5v-4a6 6 0 0 1 3-5.2',
  table: 'M5.5 5h13A1.5 1.5 0 0 1 20 6.5v11a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5v-11A1.5 1.5 0 0 1 5.5 5zM4 10h16M4 14.5h16M10 5v14',
  callout: 'M5.5 4h13A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5v-13A1.5 1.5 0 0 1 5.5 4zM8 4v16M11 9h5.5M11 13h4',
  math: 'M4 7h6M7 4v6M14 7h6M4 17h6M15 15l4 4M19 15l-4 4',
  diagram: 'M4.5 4h5v4.5h-5zM14.5 15.5h5V20h-5zM7 8.5V12h10v3.5',
  divider: 'M3.5 12h17M7 7.5h10M7 16.5h10',
  heading: 'M5 5v14M14 5v14M5 12h9M17.5 10.5l2-1.2V19',
  bold: 'M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7a3.5 3.5 0 0 1 0 7H7z',
  italic: 'M10 5h8M6 19h8M14 5l-4 14',
  strike: 'M5 12h14M16 7.5A4.2 3.2 0 0 0 12 5C9.8 5 8 6.1 8 8s2 2.5 4 3M8 16.5a4.2 3.2 0 0 0 4 2.5c2.2 0 4-1.1 4-3',
  highlight: 'M8.5 15.5 5 19h5l1.2-1.2M8.5 15.5l8.3-8.3a1.4 1.4 0 0 1 2 0l1 1a1.4 1.4 0 0 1 0 2l-8.3 8.3zM14 9.8l2.2 2.2',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 12.5A1.5 1.5 0 0 0 8.5 21h7a1.5 1.5 0 0 0 1.5-1.5L18 7M9 7V4h6v3',
  copy: 'M9.5 8h9A1.5 1.5 0 0 1 20 9.5v9a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 8 18.5v-9A1.5 1.5 0 0 1 9.5 8zM5 16V5.5A1.5 1.5 0 0 1 6.5 4H16',
  external: 'M14 4h6v6M20 4l-9 9M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10',
  reveal: 'M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2h8.5A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5zM12 10.5v5M9.5 13l2.5 2.5 2.5-2.5',
  sort: 'M7 4v16M4 7l3-3 3 3M17 20V4M14 17l3 3 3-3',
  collapse: 'M8 4l4 4 4-4M8 20l4-4 4 4',
  expand: 'M8 9l4-4 4 4M8 15l4 4 4-4',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  eye: 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12zM12 9.25a2.75 2.75 0 1 1 0 5.5 2.75 2.75 0 0 1 0-5.5z',
  template: 'M5.5 4h13A1.5 1.5 0 0 1 20 5.5V9H4V5.5A1.5 1.5 0 0 1 5.5 4zM4 13h7v7H5.5A1.5 1.5 0 0 1 4 18.5zM15 13h5M15 16.5h5M15 20h3',
  dice: 'M6.5 4h11A2.5 2.5 0 0 1 20 6.5v11a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 17.5v-11A2.5 2.5 0 0 1 6.5 4zM9 9h.5M15 15h.5M15 9h.5M9 15h.5M12 12h.5',
  present: 'M3 4h18M5 4v9.5A1.5 1.5 0 0 0 6.5 15h11a1.5 1.5 0 0 0 1.5-1.5V4M12 15v3.5M8.5 21l3.5-2.5 3.5 2.5',
  download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  history: 'M3.5 12a8.5 8.5 0 1 0 2.8-6.3M3.5 4.5v4.5H8M12 7.5V12l3 2',
  merge: 'M7 4v5c0 3 2 5 5 5h5M14 11l3 3-3 3M7 20v-6',
  scissors: 'M6 9a2.75 2.75 0 1 0 0-.01M6 19.5a2.75 2.75 0 1 0 0-.01M8.4 7.6 20 18M8.4 16.9 20 6',
  hash: 'M5 9h14M5 15h14M10 4 8 20M16 4l-2 16',
  text: 'M5 6.5V4.5h14v2M12 4.5v15M9 19.5h6',
  frame: 'M3 7.5h18M3 16.5h18M7.5 3v18M16.5 3v18',
  zoomIn: 'M10.5 4a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13zM15.5 15.5 20 20M10.5 8v5M8 10.5h5',
  zoomOut: 'M10.5 4a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13zM15.5 15.5 20 20M8 10.5h5',
  fit: 'M4 9V5a1 1 0 0 1 1-1h4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4',
  palette: 'M12 3.5a8.5 8.5 0 1 0 0 17c1.1 0 1.6-.8 1.6-1.6 0-1.2-1-1.4-1-2.4 0-.9.7-1.5 1.6-1.5h2.6a3.7 3.7 0 0 0 3.7-3.7C20.5 7.2 16.7 3.5 12 3.5zM7.6 11.2h.5M9.8 7.3h.5M14.5 7.4h.5',
  info: 'M12 3.5a8.5 8.5 0 1 1 0 17 8.5 8.5 0 0 1 0-17zM12 11v5.5M12 8h.01',
  warning: 'M12 3.5 21.5 20h-19zM12 10v5M12 17.5h.01',
  help: 'M12 3.5a8.5 8.5 0 1 1 0 17 8.5 8.5 0 0 1 0-17zM9.6 9.6a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1.1.8-1.1 1.5v.6M12 17h.01',
  grip: 'M9 6h.5M14.5 6h.5M9 12h.5M14.5 12h.5M9 18h.5M14.5 18h.5',
  properties: 'M4 6.5h4M4 12h4M4 17.5h4M11 6.5h9M11 12h9M11 17.5h9',
  // A remote computer (a project's folder on one the former host app connects to): a screen on its
  // stand. Where the vault is: a synced folder (a cloud), a network drive (a server's two drawers).
  cloud: 'M7.2 18.5h10.3a4 4 0 0 0 .7-7.94A6 6 0 0 0 6.6 9.3a4.6 4.6 0 0 0 .6 9.2z',
  server: 'M5 4.5h14a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1zM5 13.5h14a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1zM7.5 7.5h.01M7.5 16.5h.01',
  computer: 'M4.5 4.5h15a1.5 1.5 0 0 1 1.5 1.5v8.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 14.5V6a1.5 1.5 0 0 1 1.5-1.5zM12 16v3.5M8 19.5h8',
  lock: 'M6.5 11h11a1 1 0 0 1 1 1v7.5a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1V12a1 1 0 0 1 1-1zM8.5 11V8a3.5 3.5 0 0 1 7 0v3',
  mic: 'M12 3.5a3 3 0 0 1 3 3V12a3 3 0 0 1-6 0V6.5a3 3 0 0 1 3-3zM5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v2.5',
  // A paper clip (the chat's Attach): two loops, one inside the other.
  paperclip: 'M16 7.5V16a4 4 0 0 1-8 0V6.5a2.75 2.75 0 0 1 5.5 0v9a1.5 1.5 0 0 1-3 0V8',
  refresh: 'M20 12a8 8 0 1 1-2.3-5.7M20 4.5V9h-4.5',
  filter: 'M4 5h16l-6.2 7.8V19l-3.6-1.8v-4.4z',
  layers: 'M12 4 3 9l9 5 9-5zM3 14l9 5 9-5',
  // A report: bars rising on a page edge.
  chart: 'M4 4v16h16M8 16v-4M12 16V8M16 16v-6',
  sun: 'M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8zM12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4',
  keyboard: 'M4.5 6.5h15A1.5 1.5 0 0 1 21 8v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 16V8a1.5 1.5 0 0 1 1.5-1.5zM7 10h.5M10.5 10h.5M14 10h.5M17 10h.5M8 14h8',
  people: 'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3.5 19c.5-3 2.6-4.8 5.5-4.8s5 1.8 5.5 4.8M16 5.3a3 3 0 0 1 0 5.4M17.6 14.5c1.6.6 2.6 2.1 2.9 4.5',
  person: 'M12 11.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM5 20c.6-3.6 3.4-5.5 7-5.5s6.4 1.9 7 5.5',
  notes: 'M6.5 3H14l4.5 4.5V19.5A1.5 1.5 0 0 1 17 21H6.5A1.5 1.5 0 0 1 5 19.5v-15A1.5 1.5 0 0 1 6.5 3zM14 3v4.5h4.5M8.5 12h7M8.5 15.5h7',
  vault: 'M12 3.5a8.5 8.5 0 1 1 0 17 8.5 8.5 0 0 1 0-17zM12 8.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7zM12 3.5v5M12 15.5v5M3.5 12h5M15.5 12h5',
  undo: 'M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3',
  edit: 'M4 20l4-1L19 8l-3-3L5 16zM14 7l3 3',
  // The timeline: bars set along a line of days.
  timeline: 'M4 4v16M8 7.5h7M11 12h9M7 16.5h5',
  bolt: 'M13.5 3 5.5 13.5H12L10.5 21l8-10.5H12z',
  play: 'M7.5 5.2v13.6a.8.8 0 0 0 1.2.7l10.6-6.8a.8.8 0 0 0 0-1.4L8.7 4.5a.8.8 0 0 0-1.2.7z',
  pause: 'M8 5v14M16 5v14',
  // The asset store: a picture on a stack of them.
  assets: 'M7.5 4h11A1.5 1.5 0 0 1 20 5.5v10M4.5 7.5h11A1.5 1.5 0 0 1 17 9v9.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 18.5V9a1.5 1.5 0 0 1 1.5-1.5zM3 17.5l4-4 3 3 2-2 5 5M12.5 11.25a1 1 0 1 0 0-.01',
  // AI agents (Settings › AI agents): a small robot's head with its aerial.
  agent: 'M7 8.5h10a2.5 2.5 0 0 1 2.5 2.5v5.5A2.5 2.5 0 0 1 17 19H7a2.5 2.5 0 0 1-2.5-2.5V11A2.5 2.5 0 0 1 7 8.5zM12 8.5V5.5M12 4a.6.6 0 1 0 0 .01M9.5 13.5v.5M14.5 13.5v.5M2.5 12.5v3M21.5 12.5v3',
  // A key (an agent's key, shown once).
  key: 'M14.5 4a5.5 5.5 0 1 1-4.9 8L4 17.6V20h2.6v-2h2v-2h2l1.1-1.1A5.5 5.5 0 0 1 14.5 4zM16 8.5a.5.5 0 1 0 0 .01',
  // Note types (src/shared/note-types.ts): a light bulb (an idea), a star, a flag, a globe, a briefcase, a heart, a house.
  bulb: 'M9 17.5h6M10 20.5h4M12 3.5a5.5 5.5 0 0 0-3.2 10c.7.5 1.2 1.3 1.2 2.2v1.8h4v-1.8c0-.9.5-1.7 1.2-2.2a5.5 5.5 0 0 0-3.2-10z',
  star: 'M12 3.8l2.5 5.2 5.7.8-4.1 4 1 5.6-5.1-2.7-5.1 2.7 1-5.6-4.1-4 5.7-.8z',
  flag: 'M5.5 21V4M5.5 4.5h11l-2.2 4 2.2 4h-11',
  globe: 'M12 3.5a8.5 8.5 0 1 1 0 17 8.5 8.5 0 0 1 0-17zM3.5 12h17M12 3.5c2.3 2.3 3.4 5.2 3.4 8.5s-1.1 6.2-3.4 8.5M12 3.5C9.7 5.8 8.6 8.7 8.6 12s1.1 6.2 3.4 8.5',
  briefcase: 'M4.5 7.5h15A1.5 1.5 0 0 1 21 9v9.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5V9a1.5 1.5 0 0 1 1.5-1.5zM9 7.5V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5v2M3 13h18',
  heart: 'M12 19.5s-7.5-4.4-7.5-10A4 4 0 0 1 12 7.3a4 4 0 0 1 7.5 2.2c0 5.6-7.5 10-7.5 10z',
  home: 'M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1z',
  // Modules (src/shared/module-records.ts; Wave 5): a wallet (Finance), a receipt (a bill), a bank (an account), an ID card (a
  // document), a target (a budget), and a tray with an arrow out of it (import a file).
  wallet: 'M4.5 7h13A1.5 1.5 0 0 1 19 8.5V10M4.5 7A1.5 1.5 0 0 0 3 8.5v9A1.5 1.5 0 0 0 4.5 19h15a1.5 1.5 0 0 0 1.5-1.5v-6a1.5 1.5 0 0 0-1.5-1.5H4.5A1.5 1.5 0 0 1 3 8.5M16.5 14.5h.01M6.5 7l8.5-3 1 3',
  receipt: 'M6 3.5h12v17l-2-1.3-2 1.3-2-1.3-2 1.3-2-1.3-2 1.3zM9 8h6M9 11.5h6M9 15h3.5',
  bank: 'M3.5 9.5 12 4l8.5 5.5zM5.5 10v7M9.5 10v7M14.5 10v7M18.5 10v7M3.5 19.5h17',
  idcard: 'M4.5 5.5h15A1.5 1.5 0 0 1 21 7v10a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17V7a1.5 1.5 0 0 1 1.5-1.5zM9 12.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM5.8 16c.4-1.5 1.6-2.3 3.2-2.3s2.8.8 3.2 2.3M14.5 10h4M14.5 13.5h3',
  target: 'M12 3.5a8.5 8.5 0 1 1 0 17 8.5 8.5 0 0 1 0-17zM12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8zM12 11.5a.5.5 0 1 0 0 1 .5.5 0 0 0 0-1z',
  // The personal modules (Wave 7 part a): a car (Vehicles), a plane from above (Travel), steps going up (Career) and a fuel
  // pump (a fill-up).
  car: 'M3.5 16.5v-3.4a2 2 0 0 1 1.2-1.8l1.8-.8 1.9-3.7A1.5 1.5 0 0 1 9.7 6h4.6a1.5 1.5 0 0 1 1.3.8l1.9 3.7 1.8.8a2 2 0 0 1 1.2 1.8v3.4h-2M6.5 10.5h11M5.5 16.5h-2M9.5 16.5h5M7.5 18.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM16.5 18.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  plane: 'M12 3c.8 0 1.4.7 1.4 1.6v4.9l6.6 3.8v1.9l-6.6-2v4.1l2.1 1.5v1.7L12 19.6l-3.5.9v-1.7l2.1-1.5v-4.1l-6.6 2v-1.9l6.6-3.8V4.6c0-.9.6-1.6 1.4-1.6z',
  career: 'M3.5 20h4.5v-4.5h4.5V11h4.5V6.5h3.5M17.5 3.5l3 3-3 3',
  fuel: 'M5 20V5.5A1.5 1.5 0 0 1 6.5 4h6A1.5 1.5 0 0 1 14 5.5V20M3.5 20h12M5 10h9M14 9h2a1.5 1.5 0 0 1 1.5 1.5v5a1.5 1.5 0 0 0 3 0V8.5L18 6',
  upload: 'M12 15V4.5M7.5 9 12 4.5 16.5 9M4.5 15v3.5A1.5 1.5 0 0 0 6 20h12a1.5 1.5 0 0 0 1.5-1.5V15',
  newspaper: 'M5 4.5h11.5V18a2 2 0 0 0 2 2H6.5A1.5 1.5 0 0 1 5 18.5zM16.5 9H19v9a2 2 0 0 1-2 2M7.5 8h6.5M7.5 11.5h2.8v4H7.5zM12.5 11.5h1.5M12.5 15.5h1.5',
} as const;

export type IconName = keyof typeof PATHS;

/** Icons made of dots draw with a heavier line so the dots read. */
const HEAVY = new Set<IconName>(['more', 'grip', 'dice']);

export function Icon({ name, size = 18, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={HEAVY.has(name) ? 2.6 : 1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  );
}

/** The same drawing as markup, for parts of the page React does not draw (the editor's formatting bar). */
export function iconMarkup(name: IconName, size = 16): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${HEAVY.has(name) ? 2.6 : 1.7}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${PATHS[name]}"/></svg>`;
}

/** The icon for a file, by what it is. */
export function fileIcon(path: string): IconName {
  if (/\.md$/i.test(path)) return 'notes';
  if (/\.canvas$/i.test(path)) return 'canvas';
  if (/\.nvdraw$/i.test(path)) return 'pencil';
  if (/\.(?:view\.json|base)$/i.test(path)) return 'views';
  if (/\.(png|jpe?g|gif|webp|svg|bmp|avif|ico)$/i.test(path)) return 'image';
  if (/\.pdf$/i.test(path)) return 'pdf';
  if (/\.(mp3|wav|m4a|ogg|oga|flac|aac|weba)$/i.test(path)) return 'audio';
  if (/\.(mp4|mov|mkv|webm|ogv|m4v)$/i.test(path)) return 'video';
  return 'file';
}
