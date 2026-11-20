// The example plugin (8.9): a word-count card, kept here so every vault gets it with nothing to download. Written into
// .neuralvault/plugins/word-count/ when the plugins folder is first made (src/main/plugins.ts); off until the person
// switches it on and allows it to read notes. docs/PLUGINS.md walks through it line by line.

export const EXAMPLE_PLUGIN_ID = 'word-count';
export const EXAMPLE_PLUGIN_FOLDER = 'word-count';

export const EXAMPLE_PLUGIN_MANIFEST = `{
  "id": "word-count",
  "name": "Word count",
  "version": "1.0.0",
  "description": "How many words your notes hold, on Home.",
  "permissions": ["read-notes"],
  "command": { "id": "count", "title": "Count words in notes" },
  "card": { "id": "count", "title": "Word count" }
}
`;

export const EXAMPLE_PLUGIN_SCRIPT = `// Word count, the example plugin: a Home card (and a palette command) counting the words in your notes.
// Private notes and Secrets are never counted: the API refuses them before your code sees them.
module.exports.activate = async (api) => {
  const count = async () => {
    const paths = await api.listNotes();
    let words = 0;
    for (const p of paths) {
      const text = await api.readNote(p);
      words += text.split(/\\s+/).filter(Boolean).length;
    }
    const s = (n, one, many) => n + ' ' + (n === 1 ? one : many);
    return s(words, 'word', 'words') + ' in ' + s(paths.length, 'note', 'notes');
  };
  api.setCard(async () => ({ title: 'Word count', lines: [await count()] }));
  api.addCommand({ id: 'count', title: 'Count words in notes' }, async () => {
    api.toast(await count() + '.');
  });
};
`;
