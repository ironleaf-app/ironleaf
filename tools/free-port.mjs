// A free port for a screenshot or check run's own window: several Electron apps may run on this PC at once, and a run
// must never drive (or be confused by) someone else's window. SHOT_PORT / SMOKE_PORT still choose one by hand.
import net from 'node:net';

export const freePort = (wanted) =>
  Number(wanted) ||
  new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
