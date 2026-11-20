// Private notes' folder at the top of the notes (src/main/private-notes.ts): the encrypted store's alone; the vault never
// lists, watches, reads or writes in it (src/main/vault.ts), and the window opens its notes only through the store.

export const PRIVATE_DIR = 'Private notes';

/** A path in the notes that is a private note's (or the folder itself). */
export const isPrivatePath = (rel: string | undefined | null): boolean => {
  const top = String(rel ?? '').replace(/\\/g, '/').replace(/^\/+/, '').split('/')[0];
  return top.toLowerCase() === PRIVATE_DIR.toLowerCase();
};
