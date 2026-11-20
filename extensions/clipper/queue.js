// Clips waiting for the Vault (kept when it is not running, sent when it is): newest last, sent in order, each kept
// until the Vault says it landed. The store is injected (chrome.storage.local in the extension, memory in the tests),
// so nothing here touches the browser.

const QUEUE_KEY = 'nvault.clipper.queue';

const makeId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export function createQueue(storage, key = QUEUE_KEY) {
  const all = async () => {
    const list = await storage.get(key);
    return Array.isArray(list) ? list : [];
  };
  return {
    /** Every waiting clip, oldest first. */
    all,
    /** How many wait. */
    async count() {
      return (await all()).length;
    },
    /** Keep a clip to send later (the payload, ready to send). */
    async add(clip) {
      const list = await all();
      const item = { id: makeId(), queuedAt: Date.now(), clip };
      list.push(item);
      await storage.set(key, list);
      return item;
    },
    /** One clip sent: taken off. */
    async remove(id) {
      await storage.set(key, (await all()).filter((item) => item.id !== id));
    },
    /** All waiting clips, taken off together (after every one landed). */
    async clear() {
      await storage.set(key, []);
    },
  };
}
