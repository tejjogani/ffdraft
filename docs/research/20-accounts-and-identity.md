# 20 — Accounts and identity: local today, hosted later

Research date: 2026-11-25. Scope: what Pavé's server does today to identify a person; the identity model to aim for (users, organisations, roles, invitations, sharing, guests, service accounts); what an account means on a local install and what changes when that install connects to hosted Pavé; sign-in with Google, Microsoft and Apple; build or buy; linking an organisation to a partner company by OAuth 2.0 with PKCE, checked against current best practice; developer API keys; audit logs and privacy law; secrets handling. Builds on [`05-platform.md`](./05-platform.md) §2, [`docs/plans/deploy-and-durable-jobs.md`](../plans/deploy-and-durable-jobs.md) §4.8–4.9, [`docs/plans/publishing.md`](../plans/publishing.md) (API keys, `/v1`), [`docs/integrations/diaex-partner-api.md`](../integrations/diaex-partner-api.md) §3, and [`docs/strategy/catalog-import-and-store.md`](../strategy/catalog-import-and-store.md) §2.7. It feeds `docs/plans/accounts-and-developer-api.md`.

**How to read the evidence.** `[V]` = I opened the page this session and the claim is on it (link beside it). `[S]` = seen only in a search summary or an earlier repo file, not opened. `[E]` = my estimate or working knowledge; the basis is stated. Prices and limits were read on 25 November 2026 and change often. Code references are `path:line` in this branch; `ab:` means the read-only assistant-build export (`/home/claude/ref/assistant-build`), which is newer.

## 1. The short answer

1. **Today there is one real identity mode and one skeleton.** Local mode has no sign-in at all: one fixed user and one organisation, created at first boot, on a server bound to 127.0.0.1. Accounts mode is Better Auth 1.7 with email and password, organisations, five roles and invitations, tested for tenant isolation, but with no email sending, no email verification, no password reset, no social sign-in, no MFA and no API keys. It is a correct base, not a launchable service.
2. **Keep Better Auth (build, do not buy).** It is the only option in the comparison that runs inside the product's own process and database, so the same code serves an offline laptop and the hosted service. Every hosted vendor (Clerk, WorkOS, Auth0, Stytch) needs the network and would split identity into two systems. Costs at 1k, 10k and 100k users are zero in licence fees. The price is that Pavé owns email delivery, the audit log, and security upkeep. Revisit only when an enterprise buyer asks for SAML and SCIM; even then Better Auth has plugins, and WorkOS can be added per connection.
3. **A local install should have a profile, not a login.** A password on a local web server protects nothing (the data folder is unencrypted and the operating-system login is the real boundary), and passkeys do not work on `127.0.0.1`. Give the local user a name and avatar, fix the local server's missing Host check, and stop there. "Sign in" appears only when the install connects to hosted Pavé.
4. **Connecting to hosted is a device link plus a one-time claim.** The local app signs in through the system browser (authorization code with PKCE, loopback redirect), registers the install, and offers to move the local studio into a hosted organisation with an explicit id map. From then on the plan and allowances come from the server as a short signed lease (about two weeks offline, as Rhino's Cloud Zoo does). Local enforcement of renders and paid exports can always be bypassed on a machine the user owns; decide to accept that rather than fight it.
5. **Sign-in order: Google and Microsoft first, passkeys and email codes alongside, Apple only if the app goes into Apple's store.** Never join accounts on an email address that either side has not verified, and never trust Microsoft's `email` claim; key every identity on provider plus subject.
6. **The partner contract's OAuth design is sound** (code flow, S256 PKCE, loopback IP redirect, rotation with reuse detection, per-request token checks). Eight gaps are listed in §7.4; the three that matter are: bind `state` to the Pavé session and organisation; say who on the Pavé side may connect and what the consent covers for the rest of the organisation; and add an issuer check (RFC 9207) because Pavé will talk to several authorization servers.
7. **Audit log and secrets need a second pass before hosting.** The audit row lacks before/after, IP, request id, outcome and every authentication event, and nothing reads it. One secret currently signs sessions and derives the keys that seal customers' AI keys; split them and move the hosted key-wrapping key into a KMS.

## 2. What exists today

### 2.1 The two modes

| | Local (`PAVE_AUTH=local`) | Accounts (`PAVE_AUTH=accounts`) |
|---|---|---|
| Chosen by | Default when `DATABASE_URL` is unset (`apps/server/src/config.ts:55`) | Default when `DATABASE_URL` is set |
| Who you are | One user, `local@pave.invalid`, named "Designer", owner of one organisation "Studio", created at first boot (`auth/workspace.ts:9,41-64`). Every request gets that identity (`runtime.ts:101-102`) | The Better Auth session's user; the active organisation from the session, else the first membership (`runtime.ts:103-108`) |
| Sign-in | None | Email and password only (`auth/auth.ts:23`); screen in `ab:apps/studio/src/pages/auth/AuthScreen.tsx` |
| Network | Binds `127.0.0.1` unless `HOST` is set (`config.ts:58`) | Binds `0.0.0.0` |
| Signing secret | 32 random bytes in `<dataDir>/auth-secret`, mode 0600 (`auth/workspace.ts:66-82`) | `BETTER_AUTH_SECRET`, required (`app.ts:44-49`) |
| Plan | `PAVE_PLAN` env override, else Free (`ab:config.ts:84`, `ab:plans.ts`) | `org_settings.plan`, "set by billing" (no billing exists) |

### 2.2 What accounts mode has

- **Library:** Better Auth 1.7.27 with the Drizzle adapter and the organization plugin, teams off, telemetry off (`auth/auth.ts:15-49`). Tables `user`, `session`, `account`, `verification`, `organization`, `member`, `invitation` (`db/schema/auth.ts`).
- **Passwords:** nothing is configured, so Better Auth's default applies: scrypt [V: [security reference](https://better-auth.com/docs/reference/security)]. The form asks for 8 characters; the server-side minimum is whatever Better Auth defaults to (8, [E]), since none is set.
- **Sessions:** cookie sessions stored in `session` with token, expiry, IP and user agent (`db/schema/auth.ts:20-36`). Defaults: 7 days, extended once a day when used [V: same page].
- **Organisations:** every new user gets "<First name>'s studio" as owner through a database hook (`auth/auth.ts:25-34`, `auth/workspace.ts:21-39`), so a session always has an organisation. A user can belong to several; `session.get` lists them (`handlers/session.ts`).
- **Roles:** `owner > admin > designer > viewer > guest` (`packages/schema/src/api/commands.ts:1177`). Each command has a minimum role (queries default to viewer, mutations to designer, `commands.ts:1171-1174`), checked in one pipeline for people, the assistant and in-process callers (`rpc/execute.ts:27-30`). The last owner cannot be demoted (`handlers/org.ts:57-70`).
- **Invitations:** `org.invite` writes a row in Better Auth's shape with a 7-day expiry and cancels an older pending one for the same address (`handlers/org.ts:10,31-55`). No email is sent; the link is `/invite/<id>`, and acceptance goes through Better Auth's endpoint, which requires a signed-in user whose email matches the invitation [V: [organization plugin](https://better-auth.com/docs/plugins/organization)].
- **Tenancy:** handlers hold no database handle, only a `Repo` bound to one organisation that stamps and filters every row (`repo/index.ts`, `repo/scoped.ts`). `tenancy.test.ts` proves cross-organisation reads and writes answer 404, events stay inside the organisation, and viewer, designer and admin limits hold.
- **Audit:** every mutation command writes `action`, `actor` (user, agent with run id, tool call and model, or system), `userId`, `targetId`, the validated input and a time (`audit.ts`, `rpc/execute.ts:48-53`, `db/schema/domain.ts:544-557`); uploads too (`http/assets.ts:67`). The assistant build replaces fields a command marks `secret` with a marker (`ab:rpc/execute.ts`, `redact`).
- **Usage and allowances:** an append-only `usage_event` ledger with idempotency keys and a monthly budget (`usage.ts`); in the assistant build, `plan_claim` rows decide who gets the last free render or export, by a unique index (`ab:plans.ts`, `ab:packages/schema/src/plans/config.ts`: Free 5 renders and 5 Rhino/STEP exports a month, Pro unlimited with fair-use ceilings of 1,000 and 2,000).
- **The Claude key (assistant build):** one row per organisation in `assistant_key`, sealed with AES-256-GCM under a key derived by HKDF-SHA256 from the auth secret, with the organisation id as associated data; only the last four characters are shown; `ANTHROPIC_API_KEY` in the environment wins for every organisation (`ab:assistant/keys.ts`, `ab:runtime.ts:110-112`). Set, test and remove are admin-only commands. Image-model keys are not in the export yet (assistant build step 18 is "Next").

### 2.3 What does not exist

Email sending of any kind; email verification; password reset; social sign-in; passkeys; MFA; rate-limit or proxy configuration for Better Auth; a way to read the audit log; API keys or a public REST surface; service accounts; per-project or per-folder permissions; share links; any OAuth client code or partner-token store; any device or licence concept; billing.

### 2.4 Gaps and risks, in order

| # | Gap | Why it matters | Fix |
|---|---|---|---|
| 1 | **The local server accepts any request that reaches its port.** There is no `Host` or `Origin` check (`app.ts:95-128`). CORS and the JSON content-type rule (`http/rpc.ts:13-15`) stop ordinary cross-site requests, but a DNS-rebinding page is same-origin to the server, and any other program or user on the machine can call it [E: standard attack on unauthenticated loopback services]. | The server holds a sealed Claude key it will spend on request, all designs, and later a partner token with prices. | Refuse requests whose `Host` is not `localhost`, `127.0.0.1` or `[::1]` with the right port; give the studio a random per-start token (cookie or header) that other origins cannot read. Small; do it before the founder's first test. |
| 2 | **Accounts mode trusts unverified emails.** Sign-up needs no verification. Better Auth links a social sign-in to an existing user with the same address when the provider reports it verified [V: [users and accounts](https://better-auth.com/docs/concepts/users-accounts)]. | An attacker can register a victim's address with a password first, then keep access after the victim "signs in with Google" into that same account. The same weakness lets anyone holding an invitation link join by registering the invited address. | Require verified email before a password account can do anything; set `requireEmailVerificationOnInvitation`; decide the linking rules in §5.5 before enabling any provider. |
| 3 | **One secret, three jobs.** The auth secret signs sessions, derives the key that seals AI keys, and derives the `.pave` organisation fingerprint (`ab:runtime.ts:110-118,160-163`). | Rotating it after a session-signing leak silently destroys every stored key (noted in the deploy plan §4.8). On a local install the secret file sits beside the database, so any backup of the folder opens the keys. | Separate keys with versions (§10). |
| 4 | **Roles are organisation-wide ranks only.** A viewer reads every piece; `guest` can call nothing, because every query needs viewer (`commands.ts:1173`). | The people the trade most needs to share with (a client approving a design, an out-worker setting stones, a caster) need one project, not the whole studio. | Per-project grants and review links (§3). |
| 5 | **Audit is write-only and thin** (§9). | Cannot answer "who exported this file" or "who signed in from where"; nothing for a customer to see. | Audit v2. |
| 6 | **Local allowances are advisory.** `PAVE_PLAN=pro` or deleting `plan_claim` rows lifts every limit. | Fine today (documented as testing); it becomes the licence model unless decided otherwise (§4.4). | Founder decision. |
| 7 | `org.invite` bypasses Better Auth's own create-invitation path, so its limits, hooks and `sendInvitationEmail` never run. | Two invitation code paths will drift. | Call the plugin's API once email exists. |

## 3. The identity model to aim for

### 3.1 How six products model the same things

| | Top container | Roles | Outside people | Joining | Sub-structure and sharing |
|---|---|---|---|---|---|
| **Figma** | Organisation → (workspace, Enterprise only) → team → folder → file | Team owner (one), admin, can edit, can view; a paid **seat type** is separate from permission and both are needed to edit [V: [roles and seats](https://help.figma.com/hc/en-us/articles/360039970673-Guide-to-roles-and-seats)] | **Guests are defined by email domain**: anyone whose address is not on the organisation's domains. They see only what they were invited to and cannot browse teams [V: [guests](https://help.figma.com/hc/en-us/articles/4420557314967-Guests-and-external-users)] | Email invites to a team, folder or file | Access set higher up flows down; lower levels can add access but not remove it [V: roles page] |
| **Notion** | Workspace → teamspace → page | Workspace owner, membership admin (Enterprise), member, guest [V: [who's who](https://www.notion.com/help/whos-who-in-a-workspace)] | Guests are invited to single pages, cannot join groups or get workspace-wide access; members are billed per seat [V: same] | Email invite, a reusable invite link, or **allowed email domains** that let anyone with a matching address join as a billed member [V: [add members](https://www.notion.com/help/add-members-admins-guests-and-groups)] | Page-level sharing, groups, temporary members with an end date |
| **Linear** | Workspace → team | Owner (Enterprise), admin, team owner, member, guest; on Free everyone is an admin [V: [members and roles](https://linear.app/docs/members-roles)] | Guests see only the teams they are added to; Business and Enterprise plans only [V: same] | Email invites with a role; persistent reusable invite link that an admin can reset; approved email domains for joining without an invite [V: [invite members](https://linear.app/docs/invite-members)] | Suspended members lose access at once but stay visible for history [V: roles page] |
| **Onshape** | Company or a single user owns each document | Document owner and company admins control sharing [V: [sharing](https://cad.onshape.com/help/Content/Collaboration/sharing_and_collaboration.htm)] | Share with individuals, teams or companies; a document can be made public [V: same]. The finer permission list (view, copy, export, re-share) is [E], not on the page I could open | — | Per-document permissions; members of a company can only create company-owned documents [V: same] |
| **Shopify** | Organisation → store | Roles hold permissions and come in categories: store, organisation, POS app, partner [V: [permissions](https://help.shopify.com/en/manual/your-account/users/roles/permissions)] | **Collaborator accounts** let an outside agency (a Shopify Partner) work in a store with limited permissions [V: same page, one line; request-code details not verified] | Staff invited by the owner | — |
| **GitHub** | Organisation → team → repository | Owner, member, moderator, **billing manager**, security manager, App manager [V: [roles](https://docs.github.com/en/organizations/managing-peoples-access-to-your-organization-with-roles/roles-in-an-organization)] | **Outside collaborator**: access to named repositories without being a member [V: same] | Invitations | Repository-level roles; at least two owners advised [V: same] |

What they agree on [E, from the table]: (a) organisation membership and access to one item are two different relations; (b) the outsider is a first-class kind of person with access to named items only; (c) billing is a permission that can be given to someone who cannot see the work; (d) joining by verified email domain is a paid-tier convenience; (e) removing a person suspends them and keeps their history.

### 3.2 The target model

**Entities**

| Entity | Meaning | Notes |
|---|---|---|
| **User** | A person. Identified by an internal id; has one or more sign-in identities `(provider, subject)`, zero or one password, passkeys, verified emails | Never keyed on email |
| **Organisation** | A jeweler's business: the owner of projects, folders, keys, the plan and the bill | `kind: personal \| business`. A personal organisation is the one-person studio every account starts with (today's behaviour); it can be renamed and upgraded into a business rather than abandoned |
| **Membership** | User in organisation with one role | Status `active \| suspended`; suspension keeps history |
| **Invitation** | Email, role, optional project grants, inviter, expiry, single use | 7 days; re-invite cancels the old one; accepted only by a verified matching email |
| **Folder** | A client, brand or collection (today's `collection`) | Grants can be attached here and flow down, Figma-style: add lower, never remove lower |
| **Project grant** | A user (member or external) given a level on one project or folder | Levels: `review` (see renders and approve or comment), `view` (also CAD and specs), `edit` |
| **Review link** | An unguessable link to one frozen version of a project's images or package, with expiry, optional passcode, revocation, and every open logged | No account needed; this is what a retail client uses. `05-platform.md` §2 already sketches it for manufacturers |
| **Service account** | A non-human member of an organisation that owns API keys and render-node tokens | So keys do not die when a person leaves (§8) |
| **Install** | One copy of the app on one machine, linked to a user | For device lists, leases and revocation (§4) |

**Roles**

| Role | Can | Billed seat? [E] |
|---|---|---|
| Owner | Everything, including delete organisation, transfer ownership, link partner company, manage billing | Yes |
| Admin | Members, roles below owner, settings, AI keys, API keys, partner link, audit log | Yes |
| Designer | Create and edit projects, run AI jobs, render, export | Yes |
| Production | Read all projects; create production packages and exports; update production status; cannot edit design | Yes (cheaper, or free: founder decision) |
| Viewer | Read everything in the organisation, comment | Free |
| Billing | Plan, invoices, usage totals; no projects | Free |
| External collaborator | Not a member. Only the projects or folders granted, at the granted level. Covers a client with an account, an out-worker (setter, caster, CAD freelancer) | Free for `review` and `view`; `edit` is a founder decision |

Billing is better as a flag beside a role than as a rank, because the current code compares ranks (`roleAllows`) and "billing" does not sit on that line. External collaborators also sit outside the rank: they need a second check, "does this user hold a grant on this project", in the same pipeline that checks roles today (`rpc/execute.ts`). Every project-scoped command already carries a `pieceId` or resolves one, so the check has one home.

**Domain capture** (later tier): an organisation proves a domain by DNS record; then people who verify an address on it are offered the organisation and join as a default role, and admins can require SSO for that domain. Do not ship the unverified version (Notion and Linear let an admin type any domain [V: links above]; both warn to remove domains no longer controlled).

## 4. Local today versus hosted later

### 4.1 What an account can mean on one offline machine

| Option | What it gives | Problem | Verdict |
|---|---|---|---|
| No identity (today) | Zero friction | Changes are attributed to "Designer"; nothing to carry to hosted | Replace with a profile |
| **Local profile**: name, optional email (unverified, a label), avatar | Honest attribution in history, exports and `.pave` files; a natural thing to claim later | None | **Recommended now** |
| Local password or PIN | A screen lock | The database and blobs are plain files; anyone with the folder bypasses it. No email means no reset. A password on an HTTP loopback page teaches bad habits [E] | Reject, unless the data folder is itself encrypted (not planned) |
| OS keychain | A place for secrets (AI keys, partner token, device key) guarded by the OS login | It is storage, not identity | Use for secrets (§10) |
| Passkey bound to the local server | Phishing-resistant unlock | WebAuthn is allowed on `http://localhost` but an IP address is not a valid relying-party id, so `127.0.0.1` cannot be used; a credential is bound to its relying-party id, so one made for `localhost` can never sign in to the hosted domain [V: [WebAuthn Level 3](https://www.w3.org/TR/webauthn-3/)]. The id `localhost` is also shared by every other local web app on the machine [E] | Reject |
| The OS user | The real security boundary on a single machine [E] | Not visible to a browser-served app | Rely on it; say so in the docs |

Several people sharing one local install (a small workshop on one PC, or a server on the studio's network with `HOST` set) is the case local mode does not serve. The honest answer today is "run accounts mode on your own Postgres" or wait for hosted; a LAN server with no sign-in must not be encouraged.

### 4.2 How others went from local to cloud

| Product | Local use | The cloud step | Lesson |
|---|---|---|---|
| **Rhino (Cloud Zoo)** | A licence key can also sit on one computer or a LAN server [E] | The key is added to a Rhino account or a team; a signed-in Rhino gets a **lease, not the licence**; leases last a few weeks and are renewed often while online; concurrent use is capped at the number of licences; a lease can be voided at any time, for example on refund [V: [Cloud Zoo overview](https://developer.rhino3d.com/guides/rhinocommon/cloudzoo/cloudzoo-overview)]. A McNeel staff answer from 2019 puts the offline window at about two weeks, renewed at start-up once more than a tenth is used, with warnings in the last days and no start after expiry [V: [forum](https://discourse.mcneel.com/t/cloud-zoo-how-it-works-if-the-internet-connection-is-temporary-broken/86869); old, may have changed] | The closest precedent: account-held entitlement, short offline lease, team pool, same tool the trade already uses |
| **Autodesk** (named user) | — | Sign-in required; about 30 days offline with a reminder 7 days before [V: a reseller's how-to, [IMAGINiT](https://resources.imaginit.com/how-tos/how-long-can-an-autodesk-product-on-subscription-be-used-without-an-internet-connection); Autodesk's own page did not show the number] | Thirty days is the generous end |
| **Sketch** | A Mac-only licence works on local documents and has no web app or collaboration | A subscription adds the workspace, web app and real-time collaboration, billed per editor [V: [account differences](https://www.sketch.com/support/general/subscriptions/account-differences)] | Local and workspace documents can be two honest product tiers |
| **Obsidian** | The app works on local folders; Sync needs an account [V: [Sync setup](https://obsidian.md/help/sync/setup); that the app itself needs none is [E]] | Log in, create a remote vault with its own encryption password, connect the existing local vault; existing notes are merged, with a warning [V: same] | Claiming local data is an explicit, warned, per-container act, and the secret that protects content can be separate from the account |
| **Blender ID** | Blender needs no account [E] | One login for the services around it: fund, studio, conference, developer site [V: [about](https://id.blender.org/about/)] | The free tool stays anonymous; identity begins where services begin. This matches "free CAD, charge for the intelligence" |
| **Linear** | The client keeps a local copy and syncs deltas ordered by a server sync id [S: `05-platform.md` §4b, from a reverse-engineering study; Linear's own post I opened had no detail] | — | A sync engine is a product in itself; not needed for the claim step |

### 4.3 Connecting an install to hosted Pavé, step by step

1. **Sign in from the app through the system browser.** Authorization code with PKCE; the redirect returns to the local server on the loopback IP (RFC 8252 §7.3) or, in the Electron shell, to the app's registered link. Better Auth's Electron package does the browser, PKCE and state steps with a custom scheme and a paste-a-code fallback, and stores tokens in a plain file by default [V: [Electron integration](https://better-auth.com/docs/integrations/electron)]; point its storage at the OS keychain. For a headless or LAN server, the device authorization grant (RFC 8628) is the fallback; Better Auth ships a plugin [V: [device authorization](https://better-auth.com/docs/plugins/device-authorization)].
2. **Register the install.** The app generates an Ed25519 key pair on first run, keeps the private key in the keychain, and sends the public key with a name ("Studio MacBook") [E: standard device-binding design]. The hosted account shows a device list with last seen and a revoke button. The deploy plan's render-node pairing (§4.9) is the same idea for a narrower token; build one mechanism.
3. **Choose where the local studio goes.** Into the user's personal organisation, into a business they belong to (designer or above), or nowhere (stay local, just licensed).
4. **Claim.** The app sends rows and blobs; the server rewrites ownership. Mapping rules:

| Local thing | On claim |
|---|---|
| Organisation id (`org_…` of "Studio") | Replaced by the target organisation's id on every row |
| Local user (`local@pave.invalid`) | Replaced by the signed-in user's id in `created_by`, `user_id`, and in `actor` JSON on changes and audit rows |
| All other ids (`pc_…`, `as_…`, `run_…`) | Kept. They carry 96 random bits (`ids.ts`), so a clash between installs is not a practical risk [E: birthday bound far above any row count]; the import still inserts with "do nothing on conflict" and reports |
| Blobs | Content-addressed already, so they de-duplicate by hash |
| Unique business keys (organisation slug, a future per-organisation SKU) | The only real collisions. Report and let the person rename; never overwrite |
| `.pave` organisation fingerprint (HMAC of the organisation id under a local secret, `ab:runtime.ts:160`) | Changes after the claim; keep the old value as an alias so files exported earlier are still recognised as "ours" |
| Sealed AI keys and partner tokens | **Not uploaded by default.** They are sealed under the local secret; ask whether to move each one, then re-seal under the hosted key |
| Local audit and usage rows | Imported as history, marked "from a local install, not verified"; they never count against hosted allowances |
| Claim idempotency | Keyed on install id plus row id, so a retried or repeated claim adds nothing |

5. **After the claim** the install is either a client of the hosted service, or keeps a local copy that syncs. Syncing design documents is the op-log path `05-platform.md` §6 already proposes; it is not needed for the claim and should be planned separately.

### 4.4 Licence and allowance enforcement

Today a local install decides its own plan (`PAVE_PLAN`) and counts its own renders in its own database. Once hosted exists:

- **Signed entitlements.** The server issues a small signed statement: organisation, plan, limits, period, install id, issued and expiry times. The app verifies it with a public key compiled in and renews it whenever online. Offline grace is the expiry: two weeks matches Rhino; thirty days matches Autodesk [V/E: §4.2]. An expired lease drops the install to Free, never to "will not start", because the CAD is free.
- **Counting offline.** Renders and paid exports done offline are counted locally and reported at the next renewal. This can be reset by anyone who edits the local database or the clock.
- **What cannot be enforced.** Rendering and Rhino/STEP export run on the user's machine with code they hold. No lease stops a determined person [E]. Three positions: (a) accept it, treat local limits as honest-customer limits, and keep hard enforcement for things only the server can do (hosted render nodes, hosted AI credits, team features, publishing); (b) make paid exports need a per-export server grant, which forces the network for an offline CAD tool; (c) run paid exports only on the server. Rhino itself chose leases and trust. **Recommendation: (a).**

## 5. Sign-in with Google, Microsoft and Apple

### 5.1 The OpenID Connect details that matter

- **Flow:** authorization code with PKCE (S256) for every client, public or confidential. The security BCP requires PKCE for public clients and recommends it for the rest; the implicit grant should not be used and the password grant must not [V: [RFC 9700](https://www.rfc-editor.org/rfc/rfc9700) §2.1.1, §2.1.2, §2.4].
- **Bind the response to the browser that started it:** a one-time `state`, plus `nonce` echoed inside the ID token [V: RFC 9700 §4.7.1].
- **Validate the ID token:** signature against the provider's published keys, `iss`, `aud` equal to our client id, `exp`, and `nonce` [V: [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect)].
- **Store `(iss, sub)` as the identity.** Google says to use `sub`, never email [V: same]. Microsoft says the same of `sub` (per-app) and `oid`+`tid` (per-tenant) [V: [ID token claims](https://learn.microsoft.com/en-us/entra/identity-platform/id-token-claims-reference)].
- **Mix-up defence** is needed as soon as one client uses several providers: check the `iss` parameter in the response (RFC 9207), or at least use a different redirect path per provider [V: RFC 9700 §4.4.2]. Better Auth uses a path per provider [E: from its callback route shape].

### 5.2 Provider quirks

| | Google | Microsoft | Apple |
|---|---|---|---|
| Who can sign in | Any Google account; `hd` claim names the Workspace domain and can be trusted, the `hd` request parameter cannot [V: Google OIDC page] | Depends on the registration: one tenant, any work or school tenant (`/organizations`), or those plus personal accounts (`/common`) [V: [multitenant how-to](https://learn.microsoft.com/en-us/entra/identity-platform/howto-convert-app-to-be-multi-tenant)] | Any Apple Account |
| Issuer | `https://accounts.google.com` or `accounts.google.com` [V] | Differs per tenant; a multi-tenant app must validate each token's issuer against its `tid`; personal accounts use tenant `9188040d-6c67-4c5b-b112-36a304b66dad` [V: both Microsoft pages] | `https://appleid.apple.com` [E] |
| Email | `email_verified` claim is reliable [V] | The `email` claim is not guaranteed correct and must never be used to authorise or to key data [V: claims reference] | May be a private relay address; mail to it bounces unless every sending domain is registered with Apple and passes SPF [V: [private relay](https://developer.apple.com/help/account/configure-app-capabilities/configure-private-email-relay-service/)] |
| Name | In the ID token | In the ID token | Given only at the first authorisation; later sign-ins carry the email in the token but not the name, so store it at once [V: [Apple docs](https://developer.apple.com/documentation/signinwithapple/authenticating-users-with-sign-in-with-apple.md)] |
| Client secret | A string | A string or certificate | A JWT we sign (ES256) with a key from the developer account; it may live at most 15,777,000 seconds, six months, so it must be re-minted on a schedule [V: [client secret](https://developer.apple.com/documentation/accountorganizationaldatasharing/creating-a-client-secret.md)] |
| Review and consent | Apps using only non-sensitive scopes need no scope verification (that `openid`, `email` and `profile` are in that class is [E]; the page does not list them); brand verification is the lighter step that puts the name and logo on the consent screen; apps showing the "unverified" screen are capped at 100 users [V: [verification](https://support.google.com/cloud/answer/13463073), [unverified apps](https://support.google.com/cloud/answer/7454865)] | Publisher verification is free, needs a verified partner-programme account tied to the tenant and a custom domain; without it, users in other tenants may be blocked from consenting to anything beyond sign-in and profile; a tenant admin can turn user consent off entirely, so offer an admin-consent link [V: [publisher verification](https://learn.microsoft.com/en-us/entra/identity-platform/publisher-verification-overview), multitenant how-to] | Needs the Apple Developer Program, 99 USD a year [V: [what's included](https://developer.apple.com/programs/whats-included/)] |
| Desktop | Loopback IP redirect is the supported method on macOS, Windows and Linux; custom URI schemes and copy-paste are no longer supported; always PKCE; the "secret" of a desktop client is not a secret [V: [native apps](https://developers.google.com/identity/protocols/oauth2/native-app)] | Loopback is supported [E] | Web flow needs a registered HTTPS return address [E]; not usable against a loopback server |

**The Apple rule, as worded today.** Guideline 4.8 says an app that uses a third-party or social login for the primary account must also offer another login service that limits data to name and email, lets the user keep the email private, and does not track for advertising without consent. It does not name Sign in with Apple. Exceptions include apps that use only the company's own sign-in, and business apps that require an existing enterprise account [V: [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)]. It binds apps reviewed for Apple's stores; a web app or a notarised Mac download is outside App Review [E]. So Apple sign-in is optional until a store listing is wanted.

### 5.3 Desktop and local flows

RFC 8252 in four lines [V: [RFC 8252](https://www.rfc-editor.org/rfc/rfc8252) §6, §7.3, §8.3–8.6]: use the system browser, never an embedded web view; a native app is a public client and must use PKCE; for a loopback redirect use the IP literal (`127.0.0.1` or `[::1]`), not `localhost`, and the server must accept any port; because anyone can imitate a public client, the server should not skip consent for it.

Social sign-in has no meaning on a local-only install: there is no account to sign in to, and no provider will redirect to a per-install address except loopback. So **Google, Microsoft and Apple are configured once, on hosted Pavé**; the local app signs in to hosted Pavé (§4.3 step 1) and never talks to the providers itself.

The device authorization grant suits a server with no browser: the device shows a short code, the person approves on another device, the device polls. Its known weakness is remote phishing (an attacker starts the flow and mails the victim the code), so the approval page must say plainly what is being connected and codes must be short-lived and rate-limited [V: [RFC 8628](https://www.rfc-editor.org/rfc/rfc8628) §5.1, §5.4].

### 5.4 Other factors

| Method | Use | Note |
|---|---|---|
| Passkeys (WebAuthn) | Offer at sign-up on hosted; best phishing resistance | Bound to the hosted domain; plugin exists in Better Auth [V: plugin list on the device-authorization page] |
| Email one-time code or magic link | The password-free default for small studios | Needs deliverable email (SPF, DKIM); prefer a typed code over a link, because mail scanners open links [E] |
| Password | Keep, with verified email and breached-password check | Better Auth lists a "Have I Been Pwned" plugin [V: same list] |
| TOTP and recovery codes | Optional per user; an organisation setting "require MFA" on a paid tier | SMS is costly and weak; skip [E] |
| SAML and SCIM | Enterprise tier, per customer | Better Auth lists SSO and SCIM plugins [V: same list]; WorkOS and Clerk sell it per connection (§6) |

### 5.5 Account linking rules

1. An identity is `(provider, subject)`. Email is contact data.
2. Link automatically only when the address is verified **on both sides**: by us for the existing account, by the provider's own claim for the new sign-in. Better Auth does the provider half by default and can be told to refuse implicit linking (`disableImplicitLinking`) or to trust named providers regardless (`trustedProviders`, which the docs flag as a takeover risk) [V: [users and accounts](https://better-auth.com/docs/concepts/users-accounts)].
3. Do not auto-link Microsoft sign-ins by email at all (§5.2); ask the signed-in user to link explicitly.
4. An Apple relay address will not match anything; offer "already have an account?" as Apple itself suggests [V: Apple docs above].
5. No password account is usable before its email is verified (closes gap 2 in §2.4).
6. Linking and unlinking are audited and need a recent sign-in.

## 6. Build or buy

Prices are list prices seen on 25 November 2026. "Runs offline" means it can run inside a local install with no network. Costs at 1k, 10k and 100k monthly users are my arithmetic on those prices [E], before tax and before any SSO connection.

| Option | Shape and licence | Organisations, roles, invitations | Runs offline | 1k | 10k | 100k | Lock-in |
|---|---|---|---|---|---|---|---|
| **Better Auth** (in use) | MIT library in our server and database [V: [repo](https://github.com/better-auth/better-auth)] | Yes, plugin: invitations, custom and runtime roles, teams, member limits; no domain capture [V: [organization](https://better-auth.com/docs/plugins/organization)] | **Yes** | $0 | $0 | $0 | Low: our tables. Optional paid dashboard: free, or $20/mo with 7-day audit retention and SSO at $50 per extra connection [V: [pricing](https://better-auth.com/pricing)] |
| Auth.js | ISC; README says it is now part of Better Auth and points new projects there [V: [repo](https://github.com/nextauthjs/next-auth)] | No | Yes | — | — | — | Superseded |
| Lucia | README: deprecated March 2025, replaced by a single example file and a guide [V: [repo](https://github.com/lucia-auth/lucia)] | No | — | — | — | — | Dead end |
| Clerk | Hosted, closed | Yes: 100 active organisations and 20 members each included; unlimited members is a $85–100/mo add-on plus $1 per extra active organisation [V: [pricing](https://clerk.com/pricing)] | No | $0 | $0 | ≈ $1,020/mo (Pro $20–25 plus 50k users at $0.02) | High: users and sessions live there |
| WorkOS AuthKit | Hosted, closed | Yes, organisations and roles included | No | $0 | $0 | $0 (free to 1M users) | Medium. Cost arrives per enterprise customer: $125/mo per SSO connection and again per directory connection (falling to $65 at volume), $99/mo custom domain, audit streaming $125/mo per destination [V: [pricing](https://workos.com/pricing)] |
| Auth0 | Hosted, closed | Yes; the page showed Free up to 25,000 users with 5 organisations, Essentials from $35/mo, Professional from $240/mo [V: [pricing](https://auth0.com/pricing); the per-volume slider was not readable] | No | $0? | $0? | not shown | High |
| Stytch | Hosted, closed | Yes; free tier 10,000 users, unlimited organisations, 5 SSO/SCIM connections, then $125 per connection [V: [pricing](https://stytch.com/pricing)] | No | $0 | $0 | rate not listed | High |
| Supabase Auth | Open-source service, part of a larger stack | No organisation model [S: `05-platform.md`] | No (a service) | $0 | $0 | $25/mo (Pro includes 100k) [V: [pricing](https://supabase.com/pricing)] | Medium |
| Firebase / Identity Platform | Hosted (Google) | Tenants, not business organisations with roles [E] | No | $0 | $0 | ≈ $275/mo (50k free, then $0.0055) [V: [pricing](https://cloud.google.com/identity-platform/pricing)] | High. Note the partner marketplace signs in with Firebase (contract §3.4) |
| AWS Cognito | Hosted | User pools and groups; no organisation model [E] | No | $0 | $0 | ≈ $1,350/mo on Essentials (10k free, then $0.015); ≈ $495 on Lite [V: [pricing](https://aws.amazon.com/cognito/pricing/)] | High |
| Microsoft Entra External ID | Hosted | Tenant-based [E] | No | $0 | $0 | first 50,000 free; the rate above was blank on the page [V: [pricing](https://azure.microsoft.com/pricing/details/microsoft-entra-external-id/)] | High |
| Keycloak | Apache-2.0 Java service [V: [repo](https://github.com/keycloak/keycloak)] | Realms, groups; an organisations feature exists [S] | No (a second service) | hosting | hosting | hosting | Low, but heavy to run |
| Ory (Kratos, Hydra) | Apache-2.0 Go services; organisations, SAML and SCIM are in the paid enterprise licence [V: [Kratos repo](https://github.com/ory/kratos)] | Hosted: organisations only from Growth ($9,350/yr, max 3) [V: [pricing](https://www.ory.com/pricing)] | No | $770/yr + $0.14 per average daily user | same | same | Medium |
| Zitadel | AGPL-3.0 Go service with stated exceptions [V: [repo](https://github.com/zitadel/zitadel)] | Strong: organisations are core | No | Cloud free to 100 daily users | $100/mo (25k daily users) | $100/mo or custom [V: [pricing](https://zitadel.com/pricing)] | Medium. AGPL is a separate service, not linked code, but needs a licence review before shipping it to customers |
| SuperTokens | Apache-2.0 core in Java, separate `ee/` licence [V: [repo](https://github.com/supertokens/supertokens-core)] | Multi-tenancy is a priced add-on with no public price | No (needs its core) | Cloud $0 (under 5k) | $200/mo | $2,000/mo list; self-host core free [V: [pricing](https://supertokens.com/pricing)] | Medium |
| FusionAuth | Proprietary; Community edition free to self-host; the licence forbids redistribution and letting third parties install it [V: [pricing](https://fusionauth.io/pricing), [licence](https://fusionauth.io/license)] | Tenants; entity management from Starter ($162/mo) | No, and cannot be bundled | $0 self-host | $0 | $0 | Medium |
| Logto | MPL-2.0, Node and Postgres [V: [repo](https://github.com/logto-io/logto)] | Yes, but on cloud organisations are a $48/mo add-on over Pro $24 [V: [pricing](https://logto.io/pricing)] | No (a service) | $72/mo | $72/mo | $72/mo plus token overage | Medium |

**Recommendation: stay on Better Auth, and own three things around it.**

- *Why.* The product must work on a laptop with no network, and the hosted service must run the same code. Only an in-process library does both. The tenancy tests, the role pipeline and the per-organisation key store are already built on it. Hosted vendors would make local mode a second identity system and put the customer list in someone else's database.
- *What we own as a result:* (1) email delivery and its reputation; (2) the audit log (Better Auth's own is a paid hosted add-on with 1 to 7 days' retention [V: pricing]); (3) security upkeep: it moves fast (`05-platform.md` notes 1.7 changed the account model), so pin versions, upgrade all its packages together, and keep `tenancy.test.ts` plus an invitation-and-linking test as the gate.
- *What would change the answer:* a first enterprise customer who needs SAML, SCIM and a self-service setup page next quarter. Then add WorkOS for those connections only (its user management is free; you pay per connection) and keep Better Auth as the session and organisation store.
- *Rejected:* Clerk and Auth0 (cost at scale, lock-in, no offline); Keycloak, Zitadel, Ory, Logto, SuperTokens (each is a second service to run beside a product that today is one process); FusionAuth (licence blocks bundling).

## 7. Linking an organisation to a partner company (OAuth 2.0 with PKCE)

The contract (`docs/integrations/diaex-partner-api.md` §3) links one Pavé organisation to one company on a B2B diamond marketplace, through one person there. v1 is a pasted token; v1.1 is the authorization code flow with PKCE.

### 7.1 Who consents

| Side | Who | Contract says | Should also say |
|---|---|---|---|
| Marketplace | An owner or admin of the company, on a consent page naming the company, the scopes, and "an app on this computer" with its port (§3.4, D1, D14) | Yes | — |
| Pavé | Whoever clicks Connect | Only that the token is stored "admin-only" (§9) | Only an owner or admin may start or remove a link; the Connect screen states that **every member of this organisation will see stones, and prices if granted, under that person's authority**; the link records who made it |

The link is an organisation-level asset made from one person's delegated authority. That is the same shape as a Shopify collaborator or a GitHub App installation, and it has the same two leaving cases:

- **The marketplace person leaves their company or the company loses verification:** every call answers 403 `access_removed` (§3.5). Pavé must show "the link was made by N and no longer has access; an owner or admin must reconnect", not a generic error.
- **The Pavé admin who connected leaves the Pavé organisation:** nothing on the marketplace side changes, so the link keeps working with that person's authority though they no longer work with the studio. Pavé should flag the link for re-confirmation by a current owner when its maker's membership ends, and revoke after a grace period if nobody does [E: this is how I read "acts as the person who made it"; the contract is silent].

### 7.2 Tokens

- **Storage:** sealed per organisation and per link id (so several links can exist later, D15), never sent to the browser, last four characters shown; on a local install in the OS keychain (§10).
- **Rotation and reuse detection:** the contract rotates the refresh token on every use and revokes the link when an old one is replayed, with a 30-second window in which the previous token returns the same new pair. RFC 9700 asks public clients for either sender-constrained refresh tokens or rotation in which a replayed old token revokes the active one [V: [RFC 9700 §4.14](https://www.rfc-editor.org/rfc/rfc9700)]. A grace window is a common softening: Linear lets a lost refresh be retried with the same token for 30 minutes [V: [Linear OAuth](https://linear.app/developers/oauth-2-0-authentication)]. Thirty seconds is tight and acceptable.
- **One refresh at a time per link** (contract) needs a database lock when hosted and an in-process lock locally; the publishing plan already has `refreshing_until` for channels. Use one implementation.
- **Scopes:** ask for the least (`stones:read`; `prices:read` only when an admin ticks it); store the scopes actually granted from the token response, which the OpenAPI file makes required.
- **Revocation:** RFC 7009 from Pavé, the account page on the marketplace; both take effect on the next request because tokens are checked per request (§3.5). Pavé deletes its copy on disconnect and on `token_revoked`.

### 7.3 Attacks to design against

| Attack | What happens | Defence |
|---|---|---|
| **Link CSRF (confused deputy on the callback)** | An attacker gets a Pavé admin's browser to finish a flow the attacker started, attaching the attacker's company to the victim's organisation; the victim's sourcing activity then shows up under the attacker's link | One-time `state` bound to the Pavé session **and organisation and user**, plus PKCE (the verifier never leaves the server that started the flow). RFC 9700 requires CSRF protection by PKCE, nonce or bound state [V: §4.7.1] |
| **Code injection** | A stolen code is replayed into another session | PKCE [V: RFC 9700 §4.5] |
| **Mix-up** | A client that uses several authorization servers is tricked into sending one server's code to another | Hosted Pavé will have Google, Microsoft, maybe Apple, the marketplace, Etsy and Shopify. Use a distinct redirect path per server (the contract's `/oauth/diaex/callback` already is one) and check `iss` in the response when the server sends it [V: RFC 9700 §4.4.2] |
| **Client impersonation** | Anyone can claim to be the public client `pave-local` | Consent every time, never silently; the contract's consent page and D14 cover this [V: RFC 8252 §8.6] |
| **Using the link as a login** | "Continue with the marketplace" built on an access token proves nothing about who is at the keyboard | If sign-in with the marketplace is ever wanted, it needs OpenID Connect with an ID token and `nonce`, not this flow |
| **Token theft from the install** | Malware or a copied data folder | Keychain storage; short access tokens (1 hour); refresh rotation; later DPoP |

**State and PKCE in a local install.** The local server has no public address, so the redirect is `http://127.0.0.1:{port}/oauth/diaex/callback` (contract §3.4, correct per RFC 8252). Three practical points the contract leaves to Pavé:

- The studio is opened at `http://localhost:{port}` (`config.ts:64`) but the callback arrives on `127.0.0.1`. Those are different sites to a browser, so no cookie from the studio is present. In local mode that is fine: keep the pending `state` and verifier in server memory, single use, five-minute life, and after success redirect the browser back to the studio's own address.
- RFC 8252 advises opening the loopback port only while a request is pending [V: §8.3]. The local server listens all the time, so the callback route must refuse anything without a live pending `state`, and gap 1 in §2.4 (Host check) should be fixed first.
- A server reached over a studio network cannot use loopback; the contract already sends those installs to the pasted token, with the device flow as a later option.

### 7.4 The contract against current best practice

Status of the standards: RFC 9700 (BCP 240) was published in January 2025 [V]. OAuth 2.1 is still a draft, version 17 dated 31 October 2026, with a working-group milestone to send it to the IESG in December 2026; it requires PKCE, drops the implicit and password grants, and requires exact redirect matching [V: [datatracker](https://datatracker.ietf.org/doc/draft-ietf-oauth-v2-1/)]. DPoP (RFC 9449, 2023) binds access and, for public clients, refresh tokens to a key the client holds [V: [RFC 9449](https://www.rfc-editor.org/rfc/rfc9449)]. PAR (RFC 9126, 2021) sends the request parameters server-to-server first [V: [RFC 9126](https://www.rfc-editor.org/rfc/rfc9126)].

What the contract already gets right: code flow only; S256 only; loopback IP literal with any port and `localhost` refused; public versus confidential client split with exact HTTPS redirects for hosted; single-use five-minute codes; one-hour access tokens checked on every request; rotation with reuse detection; idle expiry; RFC 7009 revocation; hashed storage of pasted tokens with show-once; OAuth-shaped errors at the token endpoint; scopes with a separate price scope the person can untick.

Gaps:

| # | Gap | Fix | Weight |
|---|---|---|---|
| 1 | `state` is checked, but nothing says it is bound to the Pavé session, organisation and user | Add to Pavé's duties (§7.3) | High |
| 2 | Nothing says who in the Pavé organisation may connect, or that one person's consent serves every member | Owner or admin only; wording on both consent screens; record the maker | High |
| 3 | No issuer identification. Discovery is "optional" | Make RFC 8414 metadata required and return `iss` in the authorization response (RFC 9207) | Medium |
| 4 | PKCE is stated for the public client; the hosted confidential client is not told to use it | Require it for both (OAuth 2.1 does) | Medium |
| 5 | Nothing about a code presented twice | Refuse and revoke the tokens issued from it [E: RFC 6749 §4.1.2] | Medium |
| 6 | The Pavé member who made the link leaving is not covered | §7.1 | Medium |
| 7 | Token format `dxp_live_` + 43 base64url characters has no checksum, and base64url contains `-` and `_` | Base62 body plus a CRC32 suffix, as GitHub does, so leaked tokens can be recognised offline and registered for secret scanning (§8) | Low |
| 8 | Refresh tokens of the public client are bearer tokens | Leave a path to DPoP: allow `token_type` to become `DPoP` later (the OpenAPI enum is `[Bearer]` only). Not needed for v1.1 | Low |

Not worth adopting now: PAR (the request has nothing sensitive and the public client cannot authenticate to it); mutual TLS; JWT access tokens (opaque tokens checked per request give instant revocation, which the contract relies on).

## 8. API keys and scopes for developers

### 8.1 How five platforms do it

| | Key kinds | Scoping | Lifetime and rotation | Notable |
|---|---|---|---|---|
| **Stripe** | Publishable `pk_`, secret `sk_`, restricted `rk_`, organisation `sk_org_`; `_test_` and `_live_` in the prefix | Restricted keys carry per-resource permissions and are the recommended default; **access policies** limit a key by IP range, network, country | Live keys are shown once; rotation gives a new key and keeps the old one alive for up to 7 days; per-key request logs | Keys can be tagged as belonging to an autonomous agent, which puts sensitive actions behind human approval rules [V for the whole row: [API keys](https://docs.stripe.com/keys)] |
| **GitHub** | Fine-grained personal tokens; classic tokens; GitHub Apps | Fine-grained: one resource owner, chosen repositories, per-permission read or write; an organisation can require approval | Expiry chosen at creation (default 30 days, 1–366 or none unless policy forbids); tokens unused for a year are removed; a token stops working when its user loses access | For organisation-wide or long-lived automation GitHub says to use an App, not a personal token [V: [personal access tokens](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)] |
| **Shopify** | App access tokens; apps on a merchant's own stores use the client credentials grant | Scopes are whatever the store granted the app installation | Tokens last 24 hours [V: [client credentials](https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/client-credentials-grant)] | Long-lived tokens pasted from the admin are being retired: no new legacy custom apps from 1 January 2026 [S: [changelog](https://shopify.dev/changelog/posts/legacy-custom-apps-can-t-be-created-after-january-1-2026.md)] |
| **Linear** | Personal API keys; OAuth apps (user actor or app actor); client credentials | Keys can be limited to read, write, admin, create issues or create comments, and to chosen teams; admins can stop members creating keys [V: [API and webhooks](https://linear.app/docs/api-and-webhooks)] | OAuth access tokens 24 hours; refresh tokens 30 days, rotating; client-credentials tokens 30 days [V: [OAuth](https://linear.app/developers/oauth-2-0-authentication)] | `actor=app` makes changes appear as the application, for agents and service accounts [V: same] |
| **OpenAI** | User-owned project keys; **service account** keys; admin keys; workload identity federation | A key can never exceed its owner's permissions; keys belong to a project | Full value returned only at creation; expirations follow organisation policy | Service accounts, not user keys, for deployed software [V: [API keys guide](https://developers.openai.com/api/docs/guides/api-keys.md)] |

### 8.2 Recommended design

- **Format:** `pvk_live_<30+ base62 characters><6-character CRC32 in base62>`; `pvk_test_…` for fixtures. A fixed prefix cuts false positives in scanning to about half a percent and the checksum lets a scanner discard fakes without a database lookup; the underscore keeps the token selectable by double-click [V: [GitHub token formats](https://github.blog/engineering/platform-security/behind-githubs-new-authentication-token-formats/)]. Give render-node tokens (`pvn_`, deploy plan §4.9) the same checksum.
- **At rest:** SHA-256 of the key, plus prefix and last four characters. A slow password hash is unnecessary for 178-bit random secrets [E]. Show once.
- **Owner:** keys belong to the **organisation**, attached to a service account, created by an admin. Personal tokens (acting as one member, dying with their membership, as GitHub's do) come later if developers ask.
- **Scopes:** the publishing plan's names (`catalog:read` and so on); `rest.scope` on each command definition is already planned there. A key's rights are the intersection of its scopes and its service account's role.
- **Resource limits:** optional restriction to named folders or projects, reusing the grant check from §3.2.
- **Expiry:** default 90 days, maximum one year, "no expiry" only for owners with a warning; mail the admin two weeks before.
- **Rotation:** create the replacement, keep the old key valid for up to 7 days, show last-used time and a per-key request log.
- **Rate limits:** per key, with `429` and `Retry-After`. Better Auth's API-key plugin has per-key rate limits, permissions as resource-to-actions maps, expiry, metadata and organisation-owned keys, and returns the value only at creation [V: [API key plugin](https://better-auth.com/docs/plugins/api-key)]; the page does not say how keys are stored at rest, so read the source or own the table before relying on it.
- **Attribution:** `Actor` gains `{ type: 'apiKey', keyId }` (already in the publishing plan), so audit rows name the key.
- **Secret scanning:** once keys are public, register the pattern with GitHub's partner programme: email them, supply a regular expression and an endpoint, verify their ECDSA P-256 signature over the raw body, and treat every reported key as compromised [V: [partner program](https://docs.github.com/en/code-security/secret-scanning/secret-scanning-partnership-program/secret-scanning-partner-program)]. Revoke automatically and mail the organisation's admins.
- **OAuth apps for third parties:** out of v1, as the publishing plan already cuts. The one early need is MCP clients, for which Better Auth lists MCP and OAuth-provider plugins [V: plugin list]. On a local install the MCP client is on the same machine and needs only the local token from §2.4 gap 1.

## 9. Audit logs and privacy

### 9.1 What to record

| Field | Today (`db/schema/domain.ts:544-557`) | Target |
|---|---|---|
| Time, organisation, action | Yes | Yes |
| Actor | Yes: user, agent (run, tool call, model) or system | Add `apiKey`, `serviceAccount`, `node`, `support` (our staff, with a reason) |
| The person behind an AI action | `userId` is the run's starter (`audit.ts:13`, since an agent context is the user's context with another actor) | Keep, and name it `onBehalfOf` so it is unambiguous |
| Target | One id guessed from the input (`rpc/execute.ts:8-15,52`) | Type and id, plus the project or folder it belongs to, so a project's history can be listed |
| Input | Full validated input, secrets redacted in the assistant build | Keep, with a size cap; large inputs by reference |
| Before and after | No (design changes keep their own inverse ops; scenes keep before/after in `ab:render_scene_change`) | For settings, roles, grants, keys and plan: store both. For designs: link to the change row |
| Outcome | Only successes are written (the write is after the handler) | Also failures of sensitive actions: forbidden, plan limit, bad key |
| IP, user agent, request id, session or key id, install id | No | Yes. Take the IP from the proxy's trusted hop only (deploy plan §4.9; Better Auth reads `X-Forwarded-For` unless `trustedProxies` is set [V: security reference]) |
| Authentication events | None: sign-in, failure, reset, MFA change, link and unlink, invitation sent and accepted all go through Better Auth's routes, not commands | Write them from Better Auth hooks |
| Reads worth recording | None | Exports and downloads of CAD and packages, review-link opens, audit-log exports, partner-price views [E: the events a jeweler would ask about] |
| Reading it | No command | `audit.list` (admin), filter by actor, action, project, date; CSV and JSON export |

**Tamper evidence.** Add to each row a hash over its content and the previous row's hash for that organisation, and publish a daily signed checkpoint outside the database (object storage with retention lock). That is the scheme AWS uses for CloudTrail: a SHA-256 per log file, hourly digest files that each carry the previous digest's signature, RSA-signed, proving that nothing was changed or removed [V: [CloudTrail validation](https://docs.aws.amazon.com/awscloudtrail/latest/userguide/cloudtrail-log-file-validation-intro.html)]. It detects tampering by someone with database access; it does not prevent it. On a local install it proves little, because the user holds the keys; do it hosted only.

**Retention and tiers.**

| Product | Plan | Retention | Export and streaming |
|---|---|---|---|
| GitHub | Organisation owners | 180 days | CSV and JSON export; API on Enterprise Cloud [V: [audit log](https://docs.github.com/en/organizations/keeping-your-organization-secure/managing-security-settings-for-your-organization/reviewing-the-audit-log-for-your-organization)] |
| Notion | Enterprise only | 365 days, from the day of upgrade | CSV; one webhook stream for SIEM [V: [audit log](https://www.notion.com/help/audit-log)] |
| Linear | Enterprise only | 90 days | API and webhook stream [V: [audit log](https://linear.app/docs/audit-log)] |

Proposal [E]: record everything for every organisation from day one (it is also product: "who changed this ring"). Show members the per-project activity on every plan; give admins the organisation log with 90 days on the team plan and a year, export and streaming on the top plan. Store at least a year regardless, because of the Indian rule below.

### 9.2 Privacy law basics for the markets in play

| Law | Status | What it asks of this feature |
|---|---|---|
| **GDPR** (EU, and the UK equivalent) | In force | Lawful basis and notice; access, correction, deletion and portability on request; security appropriate to risk; a processor agreement with customers, since hosted Pavé processes their staff's and clients' data; limits on transfers out of the EU [E: Arts 5, 15–20, 28, 32, Chapter V]. A breach goes to the regulator without undue delay and where feasible within 72 hours; a processor tells the controller without undue delay [V: [Art. 33](https://gdpr-info.eu/art-33-gdpr/)] |
| **India: DPDP Act 2023 and Rules 2025** | Rules notified 13 November 2025. The Board's rules applied at once; consent-manager rules from 13 November 2026; the substantive duties (notice, consent, security safeguards, rights, children's data, cross-border) from **13 May 2027** [V: [Bar and Bench summary](https://www.barandbench.com/view-point/meity-notifies-final-digital-personal-data-protection-rules-2025); the government page would not render] | Same family of duties. Two specifics from that summary: a 72-hour breach report, and a rule to keep personal data, traffic data and processing logs for at least one year for stated purposes [V: same; secondary source, confirm against the gazette text]. General transfers abroad are allowed unless the government restricts a country [E]; counsel should confirm |
| **California: CCPA/CPRA** | In force | Applies to a for-profit doing business in California above any of: gross annual revenue over $25 million, personal information of 100,000 or more residents or households, or half of revenue from selling personal information; business contacts and employees have been covered since 2023; requests answered in 45 days [V: [Attorney General](https://oag.ca.gov/privacy/ccpa); the revenue figure is inflation-adjusted and I did not verify the current number]. Pavé is under the thresholds for now, but customers will ask for the same terms |

Practical consequences [E]:

- Personal data here is account data (names, emails, IPs, devices), anything personal a jeweler types into a project (client names, engraving text, a client's photo or hand shot), and brand-model images of people. Designs themselves are trade secrets rather than personal data; protect them at least as well.
- Deleting a user must not break the audit log: keep the row, replace the name and email with a tombstone id.
- A local install with no hosted link makes the jeweler the only party holding the data; say so, it is a selling point.
- **Residency.** The deploy plan puts hosting in the United States (Ohio). Record a `region` on each organisation from the first hosted release even if only one exists, so a second region later is a routing problem and not a migration. Which regions to offer is a founder decision driven by the first customers (India, EU, US).
- An outside security report (SOC 2 or similar) will be asked for by larger buyers [E]; out of scope here.

## 10. Secrets: customers' AI keys and connector credentials

**Today (assistant build):** AES-256-GCM, a key per organisation and purpose derived by HKDF from the auth secret, organisation id as associated data, last four characters stored for display, never returned by any command, redacted from audit input (`ab:assistant/keys.ts`, `ab:rpc/execute.ts`). That is a good local design. Its limits are in §2.4 row 3.

**Target.**

| Topic | Hosted | Local install |
|---|---|---|
| Key hierarchy | Envelope encryption: a fresh data key per secret (AES-256-GCM, generated locally), wrapped by a key-encryption key that stays inside a KMS; store the wrapped data key beside the ciphertext; rotate the KMS key on a schedule and after any incident [V: [Cloud KMS envelope encryption](https://docs.cloud.google.com/kms/docs/envelope-encryption)]. Google Cloud KMS is the natural choice since blobs are planned on Google Cloud Storage (deploy plan §4.8) [E] | A random master key kept in the OS keychain, not in a file beside the database |
| Separation | The session-signing secret is no longer an input to secret sealing. Each sealed row carries a `key_version` (the publishing plan's `channel_connection` already has one), so rotation re-wraps instead of destroying | Same columns, so the code path is one |
| Where the keychain comes from | — | Electron's `safeStorage`: Keychain on macOS (protected from other apps), DPAPI on Windows (protected from other users, not from other apps of the same user), a desktop secret store on Linux; with no secret store it falls back to a hardcoded password, detectable as `basic_text`, which is no protection [V: [safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage)]. The older `keytar` module was archived in December 2022 [V: [repo](https://github.com/atom/node-keytar)] |
| Before the desktop shell exists | — | Today's 0600 file is the honest best for a plain Node server on macOS and Linux; POSIX modes do not restrict NTFS, so on Windows set an ACL for the current user (the deploy plan says the same for node tokens). Warn that a backup of the data folder contains the keys |
| Binding | Associated data = organisation id, secret kind, connection or link id (already done for the organisation) | Same |
| Never to the browser | Commands return source, last four characters and updated time only (true today). Calls to model and partner APIs are made by the server only (contract principle 13) | Same |
| Environment keys | Accounts mode must refuse to start with a global `ANTHROPIC_API_KEY` (deploy plan; not yet built) | Allowed; it is the user's own machine |
| Logging hygiene | No secret in a URL, ever (headers or body only); the request logger prints paths; errors from providers are scrubbed of headers before they reach traces or run events; a test asserts that no stored secret appears in any command output, event, trace or log line (the publishing plan lists "no secret in any output" as a harness test; extend it to AI keys) | Same |
| Use-time controls | Per-organisation budget exists (`usage.ts`). Add: only admins can set or replace keys (true), every use attributed to a run and user (true), an audit row on set, test and remove (true, redacted) | Same |
| Whose key | A key belongs to the organisation today. Consider a per-user key later so a freelancer's key is not spent by colleagues [E] | Not needed |

## 11. What this means for the plan

Inputs for `docs/plans/accounts-and-developer-api.md`.

**The target model.** §3.2: users with multiple sign-in identities; organisations of kind personal or business; memberships with roles owner, admin, designer, production, viewer, plus a billing flag; external collaborators by project or folder grant; review links for clients; service accounts for keys and nodes; installs as registered devices. Authorisation stays in the one command pipeline: role rank first, then grant check for project-scoped commands.

**Migration from local to hosted, in build order.**

| Step | What | Depends on |
|---|---|---|
| 0 | **Harden local now:** Host-header allowlist and a per-start studio token; a local profile (name, avatar) replacing "Designer"; split sealing keys from the auth secret with a `key_version` | Nothing. Before the founder's first test if possible |
| 1 | **Make accounts mode launchable:** an email sender; verified email required; password reset; rate limits and `trustedProxies`; `requireEmailVerificationOnInvitation`; invitations sent by email through the plugin's own path; refuse to boot with a global AI key | Hosting step 6 of the deploy plan |
| 2 | **Sign-in methods:** Google and Microsoft (multi-tenant plus personal), passkeys, email codes, optional TOTP; linking rules of §5.5 with tests for the pre-registration takeover | Step 1; Google brand verification and Microsoft publisher verification filed early, they take calendar time |
| 3 | **Audit v2** (§9.1): new fields, auth events from hooks, `audit.list` and export; hash chain when hosted | Step 1 |
| 4 | **Model changes:** production role, billing flag, external collaborators, folder and project grants, review links | Projects and folders (assistant build step 17) |
| 5 | **Device link and entitlements:** system-browser sign-in from the app, install registration, signed lease with a two-week life, device list and revoke; render-node pairing folded into the same mechanism | Hosted accounts; the desktop shell for keychain storage |
| 6 | **Claim local data** into a hosted organisation with the id map of §4.3 | Step 5; hosted blob store |
| 7 | **Developer API:** service accounts, organisation keys in the `pvk_` format, scopes, per-key limits, `/v1` from command definitions | Publishing plan P1 |
| 8 | **Partner link:** pasted token first (contract v1), then OAuth with PKCE (v1.1) using the same sealed token store and single-flight refresh as channels | Contract gaps 1–6 of §7.4 agreed with the marketplace side |
| 9 | **Enterprise tier, on demand:** verified domain capture, SAML, SCIM, audit streaming, required MFA | A customer asking |

**Build or buy.** Build on Better Auth (§6). Budget for owning email, the audit log and upgrades. Add WorkOS per connection only if enterprise SSO is sold before the plugins are proven.

**Reject, and why.** A local password or passkey (protects nothing; §4.1). A hosted identity vendor as the primary store (no offline; lock-in). Hard licence enforcement on local renders and exports (cannot hold; costs offline use; §4.4). Sign-in with the partner marketplace built on its OAuth access token (not an authentication protocol; §7.3). Unverified email-domain auto-join (takeover by typo or lapsed domain).

**Decisions for the founder.**

1. Is local-only use permanently account-free (Blender's stance), or will a free hosted account eventually be required to unlock the monthly free renders and exports?
2. Accept that local allowances are honest-customer limits (§4.4 option a), or require the network for paid exports?
3. Offline lease length for paid plans: 14 days (Rhino) or 30 (Autodesk)?
4. Which roles cost a seat: is Production paid, and may an external collaborator ever edit for free?
5. First sign-in providers: Google and Microsoft only, with Apple deferred until a store listing? (Apple costs 99 USD a year and a six-monthly secret refresh.)
6. Which legal entity registers the Google, Microsoft and Apple applications and appears on consent screens? (Tied to the open `LICENSE` copyright-holder question; Microsoft publisher verification needs a partner-programme account for that entity.)
7. Hosting region for the first release, and whether an India or EU region is a launch requirement.
8. Audit log on which plan: proposal is project activity for all, organisation log for teams, a year plus export and streaming at the top.
9. Do sealed AI keys move to hosted on claim by default, or stay on the machine unless the person opts in (proposed)?
10. For the partner link: who on the Pavé side may connect (proposed: owner or admin), and what happens to a link when its maker leaves the Pavé organisation (proposed: flag, then revoke after a grace period)? These join D1, D13, D14 and D15 in the contract.

**Could not verify.** Onshape's full permission list and guest or light-user types; Shopify's collaborator request code and staff limits; Linear's sync internals from a primary source; Rhino's current lease length (the two-week figure is a 2019 staff post; the developer page says "a few weeks"); Autodesk's 30 days from Autodesk itself; Auth0's price at each volume; Stytch's per-user rate above the free tier; Microsoft Entra External ID's rate above 50,000 users; OpenAI key prefixes and permission levels; Google's 7-day refresh-token expiry for apps in testing status; Microsoft's unverified-email-claim setting names; the DPDP rules from the gazette text itself (read through a law-firm summary); the current inflation-adjusted CCPA revenue threshold; how Better Auth's API-key plugin stores keys at rest.

## Repo notes for the lead

1. `docs/ARCHITECTURE.md:177-182` describes "Continue with Diaex" as a sign-in on Pavé's sign-in page, through a generic OpenID provider in Better Auth that links by verified email. The contract (`docs/integrations/diaex-partner-api.md` §3) defines an organisation link by plain OAuth with no ID token. They are different designs; `catalog-import-and-store.md:248` already notes two designs exist. The contract should win; the architecture file needs the correction.
2. `docs/research/05-platform.md` §2 names a role `manufacturer_guest`; the code has `guest` (`packages/schema/src/api/entities.ts:14`), and `guest` can currently call no command at all because every query defaults to viewer (`commands.ts:1171-1174`).
3. `05-platform.md` "Decisions" says passkeys and 2FA at launch; nothing is configured in `auth/auth.ts`.
4. `handlers/org.ts` writes invitations directly with a 7-day expiry; Better Auth's default is 48 hours and its own create path (limits, hooks, email) is bypassed. Not a bug today; it will be once email exists.
5. The contract §9 says local Pavé keeps the partner token in the OS keychain "where it can". No keychain code exists, and there is no desktop shell yet, so today "where it can" is nowhere.
6. The contract fixes the loopback redirect on `127.0.0.1` while `publicUrl` defaults to `http://localhost:{port}` (`config.ts:64`). Cookies and passkeys are per host name, so nothing set on `localhost` is present on the callback. Harmless in local mode if state is kept server-side (§7.3), but worth stating in the contract's "Pavé's duties".
7. `deploy-and-durable-jobs.md` §4.8 cites `config.ts:66` for the loopback bind; in this branch it is `config.ts:58` (the assistant build's file is longer). Its "accounts mode refuses to start with `ANTHROPIC_API_KEY` set" is still a plan, not code.
8. The local server has no Host or Origin validation (`app.ts:95-128`). This is a security finding rather than a doc mismatch; it belongs on the board before the founder installs a build that stores his key.
9. Earlier `[S]`/† facts in `05-platform.md` §2 that I opened and confirmed: Better Auth's audit log is a paid hosted add-on; Auth.js now points new projects to Better Auth; Kratos keeps SAML, SCIM and organisations in its enterprise licence; Zitadel is AGPL-3.0; WorkOS charges per connection ($125); Clerk organisations have a paid tier; Keycloak is Apache-2.0. One addition to its Electron row: Better Auth's Electron package returns by custom scheme (not loopback) and stores tokens in a plain file by default. Still unverified: Supabase having no organisation model.

## Sources

Every link below was opened this session ([V]) unless marked.

**Repository:** `apps/server/src/{auth/*,db/schema/*,audit,context,service-context,config,runtime,app,usage,ids}.ts`, `repo/*`, `http/{rpc,events,assets}.ts`, `rpc/execute.ts`, `handlers/{org,session,usage}.ts`, `tenancy.test.ts`; `packages/schema/src/api/{commands,entities}.ts`; assistant build: `apps/server/src/{assistant/keys,plans,runtime,config}.ts`, `rpc/execute.ts`, `packages/schema/src/plans/config.ts`, `apps/studio/src/{pages/auth/AuthScreen.tsx,lib/session.tsx}`; docs: `PLAN.md`, `HANDOVER.md`, `ARCHITECTURE.md`, `integrations/diaex-partner-api.md` and its OpenAPI file, `plans/{deploy-and-durable-jobs,publishing}.md`, `research/05-platform.md`, `strategy/catalog-import-and-store.md`.

**Better Auth:** [organization](https://better-auth.com/docs/plugins/organization) · [users and accounts](https://better-auth.com/docs/concepts/users-accounts) · [security](https://better-auth.com/docs/reference/security) · [API key](https://better-auth.com/docs/plugins/api-key) · [Electron](https://better-auth.com/docs/integrations/electron) · [device authorization](https://better-auth.com/docs/plugins/device-authorization) · [pricing](https://better-auth.com/pricing) · [repo](https://github.com/better-auth/better-auth)

**Standards:** [RFC 8252](https://www.rfc-editor.org/rfc/rfc8252) · [RFC 9700](https://www.rfc-editor.org/rfc/rfc9700) · [RFC 8628](https://www.rfc-editor.org/rfc/rfc8628) · [RFC 9449](https://www.rfc-editor.org/rfc/rfc9449) · [RFC 9126](https://www.rfc-editor.org/rfc/rfc9126) · [OAuth 2.1 draft](https://datatracker.ietf.org/doc/draft-ietf-oauth-v2-1/) · [WebAuthn 3](https://www.w3.org/TR/webauthn-3/)

**Sign-in providers:** Google [OIDC](https://developers.google.com/identity/openid-connect/openid-connect), [native apps](https://developers.google.com/identity/protocols/oauth2/native-app), [verification](https://support.google.com/cloud/answer/13463073), [unverified apps](https://support.google.com/cloud/answer/7454865) · Microsoft [multitenant](https://learn.microsoft.com/en-us/entra/identity-platform/howto-convert-app-to-be-multi-tenant), [claims](https://learn.microsoft.com/en-us/entra/identity-platform/id-token-claims-reference), [publisher verification](https://learn.microsoft.com/en-us/entra/identity-platform/publisher-verification-overview) · Apple [authenticating](https://developer.apple.com/documentation/signinwithapple/authenticating-users-with-sign-in-with-apple.md), [client secret](https://developer.apple.com/documentation/accountorganizationaldatasharing/creating-a-client-secret.md), [private relay](https://developer.apple.com/help/account/configure-app-capabilities/configure-private-email-relay-service/), [guidelines](https://developer.apple.com/app-store/review/guidelines/), [programme](https://developer.apple.com/programs/whats-included/)

**Product models and keys:** Figma [roles](https://help.figma.com/hc/en-us/articles/360039970673-Guide-to-roles-and-seats), [guests](https://help.figma.com/hc/en-us/articles/4420557314967-Guests-and-external-users) · Notion [roles](https://www.notion.com/help/whos-who-in-a-workspace), [adding people](https://www.notion.com/help/add-members-admins-guests-and-groups), [audit](https://www.notion.com/help/audit-log) · Linear [roles](https://linear.app/docs/members-roles), [invites](https://linear.app/docs/invite-members), [API keys](https://linear.app/docs/api-and-webhooks), [OAuth](https://linear.app/developers/oauth-2-0-authentication), [audit](https://linear.app/docs/audit-log) · Onshape [sharing](https://cad.onshape.com/help/Content/Collaboration/sharing_and_collaboration.htm) · Shopify [permissions](https://help.shopify.com/en/manual/your-account/users/roles/permissions), [client credentials](https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/client-credentials-grant), [legacy apps changelog](https://shopify.dev/changelog/posts/legacy-custom-apps-can-t-be-created-after-january-1-2026.md) [S] · GitHub [roles](https://docs.github.com/en/organizations/managing-peoples-access-to-your-organization-with-roles/roles-in-an-organization), [tokens](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens), [token formats](https://github.blog/engineering/platform-security/behind-githubs-new-authentication-token-formats/), [secret scanning](https://docs.github.com/en/code-security/secret-scanning/secret-scanning-partnership-program/secret-scanning-partner-program), [audit](https://docs.github.com/en/organizations/keeping-your-organization-secure/managing-security-settings-for-your-organization/reviewing-the-audit-log-for-your-organization) · Stripe [keys](https://docs.stripe.com/keys) · OpenAI [keys](https://developers.openai.com/api/docs/guides/api-keys.md)

**Local then cloud:** Rhino [Cloud Zoo](https://developer.rhino3d.com/guides/rhinocommon/cloudzoo/cloudzoo-overview), [forum, 2019](https://discourse.mcneel.com/t/cloud-zoo-how-it-works-if-the-internet-connection-is-temporary-broken/86869) · Autodesk via [IMAGINiT](https://resources.imaginit.com/how-tos/how-long-can-an-autodesk-product-on-subscription-be-used-without-an-internet-connection) (secondary) · [Sketch](https://www.sketch.com/support/general/subscriptions/account-differences) · [Obsidian Sync](https://obsidian.md/help/sync/setup) · [Blender ID](https://id.blender.org/about/)

**Identity vendors:** [Auth0](https://auth0.com/pricing) · [Clerk](https://clerk.com/pricing) · [WorkOS](https://workos.com/pricing) · [Stytch](https://stytch.com/pricing) · [Supabase](https://supabase.com/pricing) · [Identity Platform](https://cloud.google.com/identity-platform/pricing) · [Cognito](https://aws.amazon.com/cognito/pricing/) · [Entra External ID](https://azure.microsoft.com/pricing/details/microsoft-entra-external-id/) · Zitadel [pricing](https://zitadel.com/pricing), [repo](https://github.com/zitadel/zitadel) · Ory [pricing](https://www.ory.com/pricing), [Kratos](https://github.com/ory/kratos) · SuperTokens [pricing](https://supertokens.com/pricing), [repo](https://github.com/supertokens/supertokens-core) · FusionAuth [pricing](https://fusionauth.io/pricing), [licence](https://fusionauth.io/license) · Logto [pricing](https://logto.io/pricing), [repo](https://github.com/logto-io/logto) · [Keycloak](https://github.com/keycloak/keycloak) · [Lucia](https://github.com/lucia-auth/lucia) · [Auth.js](https://github.com/nextauthjs/next-auth)

**Audit, privacy, secrets:** [CloudTrail validation](https://docs.aws.amazon.com/awscloudtrail/latest/userguide/cloudtrail-log-file-validation-intro.html) · [GDPR Art. 33](https://gdpr-info.eu/art-33-gdpr/) · [DPDP Rules, Bar and Bench](https://www.barandbench.com/view-point/meity-notifies-final-digital-personal-data-protection-rules-2025) (secondary) · [CCPA](https://oag.ca.gov/privacy/ccpa) · [Cloud KMS](https://docs.cloud.google.com/kms/docs/envelope-encryption) · [safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage) · [keytar](https://github.com/atom/node-keytar)

**Would not open or had no content (claims kept as [S] or [E]):** rhino3d.com Cloud Zoo feature page; sketch.com licences doc; platform.openai.com service-accounts reference; meity.gov.in rules page; Autodesk's licensing page (no numbers); Linear's sync-engine post (video only); Microsoft's email-claim migration page (redirected to a hub).
