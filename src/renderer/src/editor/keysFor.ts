// The keys a command uses now (its default, or the person's own from Settings › Keys), as the person reads them
// ("Ctrl+B", "⌘B"), for hints in the editor's own menus (the slash menu's previews, the formatting bar's tips). The
// command list is loaded late because it reaches back into the editor's commands; until then there are no hints.

let lookup: (command: string) => string | undefined = () => undefined;

void Promise.all([import('../state/commands'), import('../lib/hotkeys')]).then(([{ COMMANDS, hotkeyOf }, { formatHotkey }]) => {
  lookup = (id) => {
    const cmd = COMMANDS.find((c) => c.id === id);
    const combo = cmd && hotkeyOf(cmd);
    return combo ? formatHotkey(combo) : undefined;
  };
});

export function keysFor(command: string): string | undefined {
  return lookup(command);
}
