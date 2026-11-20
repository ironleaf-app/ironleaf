# Ironleaf editions: the open-core line

Ironleaf is **open core**. Everything a person needs is free and open source (AGPL-3.0-or-later) and always will be.
Kaitiaki IT earns its living from what organisations need on top: running Ironleaf for many people, centrally, with
support and on licence terms their lawyers accept.

The rule that decides where a feature goes: **if one person needs it on their own computer, it is Community.** If it
only makes sense when an organisation manages many people (shared infrastructure, central control, compliance), it
can be commercial. Nothing that is free today becomes paid later.

## The split

| Capability | Community (AGPL, free) | Teams / Enterprise (commercial) | Where the code lives | Why there |
| --- | --- | --- | --- | --- |
| Notes, links, graph, canvases, tasks, templates, search by meaning, OCR, recording, import, export | ✓ all of it | ✓ | open core | the product itself |
| AI with your own key (Anthropic, OpenAI, Gemini, Ollama, any OpenAI-compatible) | ✓ | ✓ | open core | personal use |
| MCP server (stdio and local URL), Read only / Read and write | ✓ | ✓ | open core | personal use |
| Sync folder (OneDrive, Dropbox, any folder), git backup | ✓ | ✓ | open core | personal use |
| Self-update (signed latest.json) | ✓ | ✓ | open core | personal use |
| **Managed policy** (registry / ProgramData / /etc): allowed AI providers, organisation-provided AI connections, no personal keys, MCP allowed and highest level, update channel / origin / off, ask-before-changes forced on | ✓ honoured | ✓ | open core (`src/main/policy.ts`) | Policy is how IT deploys any app. Honouring it costs nothing, and keeping the enforcement hooks in core means an enterprise build is a module, not a fork. |
| Edition and licence detection (offline signed licence file) | ✓ (always Community without a licence) | ✓ | open core (`src/main/edition.ts`) | Transparent: anyone can read what a licence does (it tells the enterprise module what was bought; it never gates a Community feature) |
| Extension point for the enterprise module (SSO, team vaults, audit sink interfaces) | ✓ interfaces + no-op | ✓ implementation | interfaces in open core (`src/main/enterprise.ts`); implementation in the private `ironleaf-enterprise` repo, published as `@ironleaf/enterprise` | a stable seam keeps the commercial code out of the AGPL tree and out of every fork |
| **Shared / team vaults** with a sync server (real-time, conflict-free, per-folder permissions) | – | ✓ | client in this app (Settings › Teams, on Ironleaf Sync); the server is hosted by Kaitiaki IT. Self-hosting is planned for Enterprise and available on request | shared infrastructure only organisations need |
| **SSO** (OIDC and SAML; Zitadel, Entra ID, Okta, Google) | – | ✓ | `ironleaf-enterprise` | identity is an organisation concern |
| **Central admin console** (people, seats, policies, team vaults, licence) | – | ✓ | server product | runs on the organisation's side |
| **Managed AI connections** with company keys and endpoints delivered securely (not just the policy-file form) | policy form ✓ (key from an environment variable) | ✓ keys fetched per user after SSO, rotated centrally | policy in core; key delivery in `ironleaf-enterprise` + server | the open form is enough for small sites; secure key distribution needs the server |
| **MCP and AI governance**: which AI apps may connect (by client identity), per-group levels, read-only enforcement, audit log of every AI read and change, export to SIEM | basic on/off and highest level via policy ✓; local "What agents did" with Undo ✓ | ✓ allow-lists, per-group rules, audit export | hooks + `audit()` events in core; rules, retention and export in `ironleaf-enterprise` | the decision points are in core so the module never patches them |
| **Private notes / DLP rules** (labels that never leave the machine, block sending tagged notes to AI, redact patterns) | personal Private notes and secret scanning ✓ | ✓ organisation-wide rules, enforced and audited | rules engine in `ironleaf-enterprise`, applied through core hooks | central rules are an organisation need |
| **Managed deployment**: MSI, Intune / GPO templates (ADMX for the policy keys), update channel pinning, offline/internal update server | policy keys documented ✓; internal update origin via policy ✓ | ✓ MSI, ADMX/ADML, signed channel builds, mirror tooling, deployment guide | packaging in `ironleaf-enterprise`; mirror tooling may be open | packaging and support for fleets |
| **Support SLA**, security advisories in advance, named contact | community issues | ✓ | contract | service |
| **Commercial licence** (no AGPL obligations) for organisations that cannot accept the AGPL or want to embed Ironleaf | – | ✓ | contract (made possible by the CLA) | dual licensing |

Teams is the self-serve tier (team vaults, SSO, basic admin, standard support). Enterprise adds governance, DLP,
audit export, managed deployment, the commercial licence and an SLA.

## How the seams work

### Edition (`src/main/edition.ts`)

- Default: **Community**. No licence file means Community, quietly, with every feature.
- A licence is a JWT signed with Kaitiaki IT's Ed25519 key (alg `EdDSA`), verified **offline** with the public key
  embedded in the app (`LICENCE_PUBLIC_KEY_PEM`; a placeholder in source, replaced at release). Issuer
  `https://kaitiaki-it.com/ironleaf`, audience `ironleaf-desktop`. Claims: `org`, `seats`, `edition`
  (`teams` | `enterprise`), `features` (ids such as `sso`, `team-vaults`, `audit-export`), `exp`, `iat`, `jti`.
- Read from the machine-wide file first (`%ProgramData%\Ironleaf\licence.jwt`, `/etc/ironleaf/licence.jwt`,
  `/Library/Application Support/Ironleaf/licence.jwt`), then `licence.jwt` in Ironleaf's data folder.
- Expired, not yet valid, wrong audience or issuer, bad signature, unreadable: Community, with the reason in plain
  words on the About page.
- **Signed out, nothing is sent.** Ironleaf makes no account or licence calls until someone signs in.
- **Signed in, the app checks in with Ironleaf Cloud** (`https://ironleaf.kaitiaki-it.com/api/v1`) at start and about
  once a day while online: `GET /me` (the account and what it has bought), `POST /devices` (registers this PC) and
  `POST /licence` (a fresh signed licence for this account and PC, `src/main/account/licence.ts`). With no answer
  the licence already in force stays until it expires. Signing out stops these calls. Seat counts for an
  organisation are a contract matter (the admin console reports them where an organisation uses SSO).
- Licences are issued with `tools/licence-issue.mjs --key <private.pem> --org … --seats … --edition … --days …`.
  The private key is never in a repository.

### Managed policy (`src/main/policy.ts`)

Read once at start (a change applies at the next start, like Group Policy). Sources, per-user locations never:

| Platform | Where |
| --- | --- |
| Windows | `HKLM\SOFTWARE\Policies\Ironleaf`: REG_SZ `Policy` holding the whole JSON, and/or one value per dotted name (REG_DWORD `mcp.allowed` = 0, REG_SZ `updates.channel` = `stable`, REG_SZ `ai.allowedProviders` = `["anthropic"]`); and `%ProgramData%\Ironleaf\policy.json`. The registry wins key by key. |
| Linux | `/etc/ironleaf/policy.json` |
| macOS | `/Library/Application Support/Ironleaf/policy.json` |

```json
{
  "ai": {
    "allowedProviders": ["anthropic", "custom"],
    "allowPersonalKeys": false,
    "managedConnections": [
      { "id": "gateway", "name": "Company AI", "kind": "custom", "baseURL": "https://ai.example.com/v1",
        "models": ["claude-sonnet"], "apiKeyEnv": "COMPANY_AI_KEY" }
    ]
  },
  "mcp": { "allowed": true, "maxLevel": "read" },
  "updates": { "disabled": false, "channel": "stable", "origin": "https://updates.example.com" },
  "telemetry": "none",
  "askBeforeChanges": { "forceOn": true }
}
```

Unknown keys are ignored; bad values are dropped and logged, never guessed. `telemetry` accepts only `"none"`:
Ironleaf has none to switch on.

Enforcement hooks (each one line at the existing decision point):

| Decision point | Hook | Effect |
| --- | --- | --- |
| Adding an AI connection (`providers/connections.ts › add`) | `assertCanAddConnection` | refused outside `allowedProviders`, or when `allowPersonalKeys` is false |
| Listing connections (`connections.ts › list/get`) | `connectionsUnderPolicy` | managed connections first; personal ones hidden (not deleted) while not allowed |
| Changing or removing a connection | `assertCanChangeConnection` | managed connections cannot be edited or removed |
| Keys (`providers/index.ts`) | `keysUnderPolicy` | a managed connection's key comes from the environment variable it names (never from policy); personal keys refused when not allowed |
| Other AI apps over MCP (`agent-access.ts › localMcpSettings`) | `localMcpUnderPolicy` | off when `mcp.allowed` is false; level never above `mcp.maxLevel` |
| Making an agent key (`agent-access.ts › add`) | `assertCanConnectAgents` | refused when `mcp.allowed` is false |
| Assistant edits (`app.ts`, suggest.on) | `askBeforeChangesUnderPolicy` | always asks when `forceOn` |
| Update checker (`update-check.ts › startUpdateCheck`, via `managed.ts › managedUpdates`) | `updatesUnderPolicy` | off (even "Check now"), or read from the organisation's origin and channel (`<origin>/download/<channel>/latest.json`) |

The window shows **"Managed by your organisation"** with what is fixed at the top of Settings › AI, Connect an AI
and General (`ManagedNotice.tsx`, reading `window.nvManaged`).

### Enterprise module (`src/main/enterprise.ts`)

If a package `@ironleaf/enterprise` is installed beside the app, Ironleaf loads it at start and calls its
`createEnterprise(ctx)` with the edition, the policy, the data folder and a logger. It returns any of:

```ts
interface EnterpriseModule {
  id: string; version: string;
  sso?: SsoProvider;            // signIn(), signOut(), current(): { subject, name, email?, groups? }
  teamVaults?: TeamVaultProvider; // list(), open(id) → local folder, changed(id, rel)
  audit?: AuditSink;            // write({ at, kind, actor, target?, outcome?, detail? }), flush()
  stop?(): void;
}
```

Absent, broken or throwing: the no-op Community module, and Ironleaf carries on. Core emits audit events through
`audit()`; the Community sink drops them. A development build may load a module from a path with
`IRONLEAF_ENTERPRISE_MODULE`; an installed copy ignores it.

The module is commercial and lives in the private `ironleaf-enterprise` repository. Because the interfaces are in
core, the module never patches core code, and core never imports it statically (the open build has no dependency on
it).

## Licensing model

- Code: AGPL-3.0-or-later. Contributions come in under the CLA (CLA.md), so Kaitiaki IT can also offer the same
  code under a commercial licence.
- Name and logo: trademarks (TRADEMARKS.md). Forks rename.
- Commercial licence: for organisations that cannot accept AGPL terms, or that ship Ironleaf inside their own
  products. It includes the enterprise module and support.
