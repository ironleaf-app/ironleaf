// A zip of a folder, made in Node (no `zip` command needed): what `zip -qr out.zip <folder>` run in the folder's parent
// makes, enough for the import tests. Written apart from the app's own zip code so a test never checks that code
// against itself. Entries are deflated, names are UTF-8, folders get their own entries.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

/** Zips `folder` (its name kept as the top folder in the zip, as `zip -r` does from the parent) into `dest`. */
export function zipFolder(dest, folder) {
  const entries = [];
  const walk = (abs, rel) => {
    entries.push({ name: rel + '/', data: null });
    for (const name of readdirSync(abs).sort()) {
      const a = path.join(abs, name);
      const r = `${rel}/${name}`;
      if (statSync(a).isDirectory()) walk(a, r);
      else entries.push({ name: r, data: readFileSync(a) });
    }
  };
  walk(folder, path.basename(folder));
  const locals = [];
  const central = [];
  let offset = 0;
  for (const e of entries) {
    const data = e.data ?? Buffer.alloc(0);
    const store = e.data === null;
    const packed = store ? data : zlib.deflateRawSync(data);
    const n = Buffer.from(e.name, 'utf8');
    const crc = zlib.crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x800, 6);
    local.writeUInt16LE(store ? 0 : 8, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(n.length, 26);
    locals.push(local, n, packed);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(0x800, 8);
    c.writeUInt16LE(store ? 0 : 8, 10);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(packed.length, 20);
    c.writeUInt32LE(data.length, 24);
    c.writeUInt16LE(n.length, 28);
    if (store) c.writeUInt32LE(0x10, 38); // a folder
    c.writeUInt32LE(offset, 42);
    central.push(c, n);
    offset += 30 + n.length + packed.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  writeFileSync(dest, Buffer.concat([...locals, cd, end]));
}
