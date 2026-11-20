# Ironleaf Sync

End-to-end encrypted sync of a notes vault across a person's PCs (and, later, a team's). The client engine is
`src/main/sync/` in this app; the server module is `src/sync/` in Ironleaf Cloud (private). This file is the design both
sides build to. It follows the Sync section of Ironleaf Cloud's `docs/CONTRACT.md`.

Sync is off by default and needs an Ironleaf account with the `sync` entitlement. Ironleaf stays fully usable
without it; turning it off never touches the notes.

## What the server sees

Only opaque ids, sizes and timestamps: a vault id (random), device ids (random UUIDs), slot ids (keyed hashes of
paths), blob hashes (SHA-256 of ciphertext), byte counts, sequence numbers and times. File names, folder names, device
names, contents and sizes of individual plaintext files are never sent in the clear. Nothing the client logs names a
file either: log lines carry counts and error codes only.

## Keys

| Key | How it is made | Used for |
|---|---|---|
| vault key `VK` | 32 random bytes, made once by the PC that creates the sync vault | root of everything below |
| passphrase key `PK` | `scrypt(passphrase NFC, salt 16 B, N=2^17, r=8, p=1)`, 32 B | wraps `VK` |
| recovery key `RK` | 32 random bytes, shown once as 52 base32 characters in groups (`XXXX-XXXX-…`) | wraps `VK` a second time |
| meta key | `HKDF-SHA256(VK, salt "", info "ironleaf-sync/meta/v1")` | seals each change's metadata, device names |
| slot key | `HKDF-SHA256(VK, salt "", info "ironleaf-sync/slot/v1")` | `slot = HMAC-SHA256(slot key, lower(NFC(path)))` |
| file key | `HKDF-SHA256(VK, salt fileId, info "ironleaf-sync/file/v1")` | seals the chunks of one file (per file, stable across renames) |

Cipher: AES-256-GCM (Node's built-in crypto), a random 96-bit nonce per sealed item, the 128-bit tag checked on open.
Every sealed item binds what it belongs to as associated data, so items cannot be swapped:

- chunk: `ironleaf-sync/chunk/v1|<fileId>|<index>` (format: `0x01 | nonce 12 | ciphertext | tag 16`)
- change metadata: `ironleaf-sync/meta/v1|<vaultId>|<slot>`
- device name: `ironleaf-sync/device/v1|<vaultId>|<deviceId>`
- wrapped vault key: `ironleaf-sync/vault-key/v1|passphrase` or `…|recovery`

The **key envelope** is a small JSON document the server stores as an opaque string:
`{v:1, kdf:{name:'scrypt',N,r,p,salt}, pass:<sealed VK>, recovery:<sealed VK>}`. Joining a vault on another PC
fetches it and opens `pass` with the passphrase; a forgotten passphrase is replaced by opening `recovery` with the
recovery key and sealing `VK` again. The unwrapped `VK` is kept on each PC encrypted by the operating system
(Electron `safeStorage`) in Ironleaf's data folder, never in the vault and never in plain text; the passphrase itself
is not kept.

Resumable uploads and random nonces: an upload in progress records its chunk nonces in the local journal. If it is
interrupted, the same bytes are sealed again with the same nonces (only when the file's SHA-256 is unchanged; a changed
file gets fresh nonces), giving the same blob hashes, so the chunks already on the server are not sent again.

## Objects and protocol

All under `https://ironleaf.kaitiaki-it.com/api/v1`, `Authorization: Bearer <access token>`, JSON unless noted.

| Call | Does |
|---|---|
| `GET /sync/vaults` | the account's sync vaults `[{id, created, head}]` |
| `POST /sync/vaults` `{envelope}` | makes a vault, returns `{id}` |
| `GET /sync/:vault` | `{id, envelope, head, usage:{bytes, quota, devices, maxDevices}}` |
| `PUT /sync/:vault/envelope` `{envelope}` | passphrase changed (VK sealed again) |
| `POST /sync/:vault/devices` `{device, name}` | this PC joins (`name` sealed); device quota enforced |
| `GET /sync/:vault/devices` | `[{device, name, cursor, lastSeen}]` |
| `DELETE /sync/:vault/devices/:device` | a PC removed |
| `POST /sync/:vault/blobs/missing` `{hashes}` | which of these the server does not have yet |
| `PUT /sync/:vault/blobs/:hash` (octet-stream) | one encrypted chunk, at most 4 MiB + 29 B; the server checks the hash and the quota |
| `GET /sync/:vault/blobs/:hash` | the chunk back |
| `POST /sync/:vault/changes` `{device, changes:[…]}` | appends to the change log (below) |
| `GET /sync/:vault/changes?since=<seq>&limit=<n>&wait=<s>&device=<id>` | changes after `seq`; with `wait` the call is held up to that many seconds (long poll) until something arrives; `device` records that PC's cursor and last seen |

A **change** is `{slot, base, meta, blobs, size, deleted}`:

- `slot`: the keyed hash of the path (64 hex). A path's slot never changes; a file's identity is the `fileId`
  inside `meta`.
- `base`: the `seq` of the slot's latest change this PC knew (0 for a new path). The server accepts the change only
  if it still is the slot's latest (compare-and-swap); otherwise that change answers `{conflict: true, head}` and the
  PC pulls first. This is what makes concurrent edits safe: one wins at the server, the other becomes a conflict copy
  on the PC that lost.
- `meta`: sealed JSON `{v:1, id:fileId, path, sha, size, mtime, chunks:[{h, n}], by:deviceId}` (`sha` and `size` of the
  plaintext; `chunks` the blob hashes and plaintext lengths), or `{v:1, id, path, deleted:true, to?:newPath}` for a
  delete.
- `blobs`: the blob hashes it refers to (the server checks they are all present and counts them for quota and
  clean-up), `size` their total bytes.
- `deleted`: a **tombstone**. The slot keeps its latest `seq`, so a later add at the same path still goes through the
  compare-and-swap.

Each accepted change gets the next **server sequence** number for the vault (monotonic, per vault). Pulling returns
`[{seq, slot, meta, blobs, size, deleted, device, at}]` in order, and `head`.

**Renames** are a delete plus an add, sent in one `POST` (add first). Both carry the same `fileId`; a PC applying
them sees the add's `fileId` already present locally at the old path with the same contents and moves the file instead
of downloading it again (so the index, links and earlier versions follow), then the delete finds nothing left.

**Chunking**: files are split into 4 MiB chunks; each chunk is a blob. Files up to 2 GiB.

**Quota** (server side): the account's stored bytes (every blob in its vaults) against the plan's quota (Sync: 10 GB,
10 devices). A blob over quota is refused with `413 {error:'quota'}`; the PC keeps the change queued and says
"Storage full" in Settings. Blobs no slot's latest change refers to are cleaned up by the server a day after they stop
being referred to.

## The client engine (`src/main/sync/`)

- `crypto.ts`: keys, sealing, the envelope, recovery key words.
- `protocol.ts`: the change and metadata shapes, chunking, the `SyncApi` interface, its HTTP implementation.
- `local.ts`: the vault as sync sees it: listing (skip-and-count, as `vault.ts` does), fingerprints cached by size and
  time, and the writes, through a `LocalWriter` (in the app: `Vault.writeTextChecked` for notes, canvases and views,
  the Bin for deletes, `Vault.move` for renames; atomic temp-and-rename for attachments and config).
- `engine.ts`: the loop. State per vault in Ironleaf's data (`sync/<library key>/state.json`): the cursor, the base
  (slot → `{path, fileId, head, sha, size}`: what this PC and the server last agreed), and the **journal**
  (uploads in flight with their nonces, remote changes that could not be applied yet). Nothing leaves the journal until
  it is done; a failure is retried with back-off and shown as a count in Settings.
- `service.ts`: Settings' IPC (`isync:*`), the vault key kept by the OS, the runner for the open vault, the writer through the Vault.
- `view.ts`, `window-api.ts`: what Settings shows and the window's calls (`window.nv.cloudSync`).
- `memory-api.ts`: an in-memory server with the real rules, for the checks.
- `account.ts`: the one seam to the account work (`getAccessToken()`, `hasEntitlement('sync')`).

The loop, run when the vault's watcher says something changed (debounced 2 s; the app's existing watcher, no second
one), after each long poll returns, and every 5 minutes regardless (it catches `.neuralvault`/`.ironleaf` config, which
the watcher leaves out):

1. **Pull** changes since the cursor; for each, open `meta` and apply it:
   - the PC's copy unchanged since the base → take the remote: write (verified against `sha` before it lands), move
     (same `fileId` elsewhere), or put in the Bin (tombstone);
   - changed on both sides to the same bytes → just agree;
   - changed on both sides differently → **conflict copy**, the app's existing behaviour: the server's version takes
     the path, this PC's is kept beside it as `Name (conflict, 20 Nov 2026 3.42 pm, from LAPTOP).md` and is sent up as a
     new file. A tombstone against a local edit keeps the edit (it goes up again as a new file); a local delete against a
     remote edit brings the file back.
   A change that cannot be applied (a locked file, a full disk) stays in the journal and is retried; the cursor moves on.
2. **Scan** the vault against the base: added, changed (size or time differ, then SHA-256), deleted, renamed (a delete
   and an add with the same SHA-256).
3. **Push**: upload missing chunks (resumable), then post the changes. A conflict answer leaves the change for the next
   pull to resolve. Loop until nothing is left (at most a few rounds).

Selective sync: folders the person excludes are neither sent nor written on this PC (the server's changes for them are
remembered in the base, so excluding a folder never deletes it anywhere). Pause stops the loop; resume starts it.
What is synced: every file in the vault except other dot folders (`.git`, `.trash`…), `node_modules`, temp files
(`*.nvtmp`, `~$*`, `Thumbs.db`…), `.neuralvault/writer.json` (this PC's lock) and anything over 2 GiB. `.neuralvault`
and `.ironleaf` (the vault's settings and state) travel.

## Settings › Backups and sync › Ironleaf Sync

Compact, at the top of the Backups and sync page. Off by default. Turning it on needs the account signed in with
Sync; then **create** a sync vault (passphrase twice, then the recovery key shown once with Copy and "I've kept it") or
**join** the one already there (its passphrase, or the recovery key). Then: status line (up to date / syncing / paused /
N waiting / problem), Sync now, Pause/Resume, storage used of quota, this vault's devices (names decrypted on this PC)
with Remove, excluded folders (add/remove), Turn off on this PC.

## Teams

A shared vault is the same vault with its key wrapped to each member device's X25519 public key instead of a
passphrase (`src/main/sync/team-keys.ts`; Ironleaf Cloud's `docs/TEAMS.md` for the server side). Each PC makes its key
pair once and keeps the private half like `VK` (Electron `safeStorage`); the public half is registered with the PC's
account device. Wrap: `ECDH(ephemeral, device public) → HKDF-SHA256(salt eph‖device, "ironleaf-sync/wrap/v1") →
AES-256-GCM` over `VK`, bound to `ironleaf-sync/vault-key/v1|member|<vault>|<epoch>|<device>`. The team envelope is
`{v:1, kind:'team', epoch, name, history:[{epoch, key}]}`: the name sealed with the current meta key, every earlier `VK`
sealed under the current one.

Removing a member means a new `VK` (they may have kept the old one): the server drops their wraps and marks the vault;
an admin's Ironleaf makes the next epoch's key, wraps it to every remaining device and posts it. New changes are sealed
with the newest key; the engine opens older ones with the earlier keys (`TeamKeyRing`, newest first). Slots stay keyed
by the first key so the change log and its compare-and-swap carry on; a former member could only test whether a path
they guess exists. The change log, blobs and the engine's loop are unchanged. Settings › Teams (`src/main/teams/`)
makes a team vault from the open notes or syncs the open notes with one, through this same service.
