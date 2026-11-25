# Accounts, identity and the developer API

_25 November 2026, revised the same day after an adversarial review._ This plan settles who a person is in Pavé (a local profile now, a hosted account later), organisations, roles and invitations, sign-in with Google, Microsoft and Apple, how a local install connects to hosted Pavé, token handling for the Diaex partner link, API keys, the public API with webhooks and file feeds, and the audit log. It rests on research `20-accounts-and-identity.md` and `21-connectors-and-developer-api.md` (§6, §10, §12.2), the server code, and web pages and the pinned auth library's package source (`better-auth@1.7.27`) opened for this plan ("[V, this plan]"). It builds on the bug-sweep branch `claude/bugsweep-server` (4.1). It extends `deploy-and-durable-jobs.md` §4.8 and §4.9 and `docs/integrations/diaex-partner-api.md` §3 and §9. It takes over build step 5 of `publishing.md` (keys, `/v1`, OpenAPI, outbound webhooks, API settings: read that step as moved here), with our own key table, keys that act as service accounts, and the keyring of 4.3 in place of its `secrets.ts`. It overrides `docs/ARCHITECTURE.md:177-182`: there is no "Continue with Diaex" sign-in. Connectors and the sync engine belong to `docs/plans/integrations-hub.md`. Labels: [V] verified at source, [S] search extract, [E] estimate; "[V: review]" was opened by the reviewer, not by this plan.

## 1. Experience

**On your own computer: a profile, not a login.**
- First run asks one thing: "What should we call you?" No password. History, exports and `.pave` files carry that name instead of "Designer".
- Pavé opens from its launcher (`pnpm start`). A web page or another computer calling the local server gets nothing. A browser that has not been let in shows one quiet card: "Open Pavé from its launcher, or run `pnpm open --print` and paste the link here."
- Settings, Account says "This studio lives on this computer. Nobody else holds your designs", with one action: **Connect to Pavé online**.

**Hosted Pavé: accounts.**
- Sign in with an email and a six-digit code, or with Google, Microsoft or Apple. A passkey is offered after the first sign-in. A password is optional, added in Settings.
- If the address already has an account: "You already have a Pavé account with this email. Sign in the way you did before, then add Google in Settings."
- An invitation is for one address: "This invitation is for maya@studio.example. Sign in with that address, or ask Ravi to invite another."
- Settings, Members lists people, roles, invitations and suspended people (history kept). **Share** on a project adds a guest at Review, View or Edit, or makes a review link to one frozen version (expiry, passcode, revoke, "opened 3 times").
- Settings also has Devices (with Revoke), Activity (each project has its own too), and API and webhooks: service accounts, keys shown once, scopes as plain checkboxes, a delivery log, "Send test event", feeds, a Sandbox switch.

**Connecting an install.** Connect to Pavé online opens the system browser. The person signs in and allows "Pavé on Studio MacBook". Back in the app: "Connected as Maya. Plan: Pro, good offline until 9 December." Then **Copy online**: pick projects, see a preview, watch progress that survives a restart. The local studio stays editable and keeps rendering. A copied project shows "Copied online 3 December", later "Changed since · Send update". Any online project has "Bring back to this computer".

**The Diaex link.** Only an owner or admin sees Connect. The dialog says: "Everyone in this studio will see stones, and prices if you allow them, under your Diaex access. Diaex staff can see that this link exists, not your designs." If its maker leaves: "This link was made by Ravi, who has left. Prices are hidden. Reconnect, or it ends on 12 December."

**AI jobs.** Activity reads "Assistant, for Maya, approved by Maya: replaced the centre stone". The assistant cannot invite, change roles, make keys, share or connect; those are not tools. When a job needs a right the person lacks, it says so before it starts.

## 2. Structure

**`apps/server/src`**
- `http/guard.ts`: host names and route classes, beside the bug-sweep's `refuseForeignWrites` in `app.ts`. `http/local-access.ts`: the install secret, one-time codes, sessions, named tokens (local mode).
- `secrets/{keyring,seal,vault,migrate}.ts`. `assistant/keys.ts` calls `seal.ts`; `Runtime.deriveKey` stays for legacy reads only.
- `auth/routes.ts` (the allowlist in front of `/api/auth/*`), `auth/mailer.ts`, `auth/linking.ts`, `auth/hooks.ts`, `auth/authorize.ts` (role, flags, grants). `runtime.ts` `#build` reads member status and the verify-only rule, so every route sees them.
- `audit/{write,personal,chain,list,export}.ts`. `context.ts` gains `request` (id, IP, user agent, session, key or install id).
- `api/{keys,mask,rate-limit,idempotency,problem,cursor,events}.ts`, `http/v1.ts` (projected from the command registry), `webhooks/{sign,deliver}.ts`, `net/safe-post.ts`, `feeds/{manifest,tokens}.ts`.
- `oauth/{state,pkce,client,refresh}.ts`: the partner link's OAuth client; the sister plan's connectors reuse it.
- `hosted/{link,lease,copy}.ts` and `copy/map.ts` (install side); `http/{installs,copy}.ts` (hosted side).
- `repo/public.ts`: the only cross-organisation reads (key, feed and review-link hashes).

**`packages/schema/src`**: `api/access.ts` (roles, grant levels, key scopes, sensitive-field tags), `api/public.ts`, `plans/{lease,lease-keys}.ts`. **`apps/studio/src`**: `pages/auth/*`; `pages/settings/{Account,SignIn,Members,Devices,Activity,Api}Settings.tsx`; `features/{share,connect}/*`; `pages/review/ReviewPage.tsx`.

**Hosted only:** accounts, email, invitations, guests, review links, devices, the audit chain, keys and `/v1`, events, webhooks, feeds, the sandbox, lease signing, copy intake. The rest also runs locally.

## 3. Contract changes

Additive unless marked. Migrations take the next free numbers at build time (the assistant build is at `0015`).

**Config.** `PAVE_ALLOWED_HOSTS`; `PAVE_KEY_DIR`; `PAVE_SECRETS_KEY`, `PAVE_SECRETS_KEY_PREVIOUS`, later `PAVE_KMS_KEY`; `PAVE_MAIL`, `PAVE_MAIL_FROM`; `PAVE_TRUSTED_PROXY_HOPS`; provider ids and secrets; `PAVE_HOSTED_URL`; `PAVE_LEASE_SIGNING_KEY`. Accounts mode refuses to start with `ANTHROPIC_API_KEY` set, or in production with `PAVE_MAIL=console` or no secrets key. **Breaking:** `PAVE_CORS_ORIGINS` defaults to empty (the studio uses the Vite proxy, not CORS); `http.test.ts` sets it.

**Schema.**
- `ROLES` gains `production`, between `viewer` and `designer`. `guest` means "by grant only".
- `CommandDef` gains `needs?: 'billing'`, `on?: 'piece' | 'folder'` with `grant?: 'review' | 'view' | 'edit'`, `rest?: { method, path }`, `keyScope?` (without it a command is closed to keys), `audit?: { target, snapshot?, read? }`. Output fields carry `.meta({ sensitive: 'price' | 'cost' })`.
- `Actor` gains `apiKey` (`keyId`, `serviceAccountId`) and `install` (`installId`). Agent actors gain `approvedBy`.
- `ErrorCode` gains `rate_limited` (429), `email_unverified` (403), `local_access_required` (401).
- **Breaking, accounts mode only:** password sign-up without a proven email is removed, and the library's own HTTP routes close except those listed in 4.2. Migration: unverified users verify by code at next sign-in; `test/harness.ts` signs up through a capturing mailer and joins through `org.invitations.accept`. Nothing is hosted yet [V: repo].

**Commands** (none is a tool except `activity.list`, which returns no emails, IPs or user agents): `profile.*`; `org.create/update/delete/leave/invite/removeMember/suspendMember/setBilling/transferOwnership`, `org.invitations.list/cancel/resend/accept`; `account.link.begin/unlink`, `account.changeEmail/export/delete`; `grants.*`; `reviewLinks.*`; `serviceAccounts.*`; `apiKeys.*` and `feeds.*` (create, list, rotate, revoke); `webhooks.*`; `audit.list/export`, `activity.list`; `devices.list/revoke`; `local.tokens.*`; `hosted.link.*`, `lease.get`, `hosted.copy.preview/start/status/send/bringBack`; `partner.link.begin/paste/status/confirm/disconnect`.

**Tables.**

| Table | Shape |
|---|---|
| `assistant_key` | + `sealed_v2`, `sealed_v2_of` (digest of the legacy value it came from). The legacy `sealed` column stays one more release (4.3) |
| `credential` | `org_id, kind, ref_id, sealed, last4, scopes, expires_at, refreshing_until, status, made_by`; unique (`org_id`, `kind`, `ref_id`). Kinds: `image-key`, `partner`, `channel`, `webhook-secret`, `hosted-link`, `device-key` |
| `local_session`, `local_token` | Local mode: `id_sha256, name, last_seen_at, expires_at, revoked_at` |
| `org_fingerprint` | `org_id, fingerprint, is_current, source` (`legacy`, `random`, `copied`) |
| `user`, `member`, `organization` | + `user.kind` (`person`, `service`), `user.contact_email` (the local label; never used to sign in or match); `member.status`, `member.billing`; `organization.kind` (`personal`, `business`, `sandbox`), `region`, `parent_org_id` |
| `service_account` | `user_id, org_id, created_by, disabled_at` (4.5) |
| `api_key`, `feed` | `org_id, name, mode, prefix, last4, sha256, scopes, folder_ids, rate_per_min, expires_at, grace_until, last_used_at, revoked_at`; `sha256` unique. A key adds `service_account_id`; a feed adds `link_allowed` |
| `api_request_log`, `api_event`, `idempotency_key` | Log and events kept 30 days; idempotency rows unique on (`key_id`, `method`, `path`, `key`), pruned at 24 hours |
| `webhook_endpoint`, `webhook_delivery` | As in publishing, plus `previous_secret_until` |
| `audit_log`, `audit_personal`, `audit_checkpoint` | Log: + `seq, on_behalf_of, approved_by, target_type, project_id, folder_id, outcome, error_code, before, after, request_id, session_id, key_id, install_id, origin, personal_id, personal_digest, prev_hash, hash`. Personal: `id, org_id, subject_user_id, salt, data` (4.10). Checkpoint: the daily signed head |
| `project_grant`, `review_link` | Grant: `user_id, target_type, target_id, level, expires_at`. Link: `piece_id, version, asset_ids, token_sha256, passcode_hash, failed_tries, locked_until, expires_at` |
| `install`, `install_usage` | `user_id, org_id, kind, name, public_key, last_seen_at, revoked_at`; kinds `studio`, `render-node`; usage per period |
| `online_copy`, `online_copy_item` | State, cursor, report; items keyed on (`install_id`, `row_id`) with `sent_digest` |
| `oauth_pending`, `partner_link` | Pending (hosted; in memory locally): `state_sha256, provider, org_id, user_id, session_id, verifier_sealed, expires_at, used_at`. Link: `org_id, provider, credential_id, issuer, scopes, made_by, status, confirm_by` |

**HTTP.** `POST /api/local/code`, `POST /api/local/session`; `GET /link/callback`; `GET /oauth/:provider/callback` (the contract's `/oauth/diaex/callback`); `/api/installs/*`; `/api/copy/*`; `/v1/*` with `/v1/openapi.json` and `/v1/docs`; `GET /feeds/:id/manifest.json`; `GET /r/:token`.

**Formats.**
- Secrets we mint: `pvk_live_` and `pvk_test_` (API keys), `pvf_` (feeds), `pvl_` (local tokens), `pvn_` (node tokens; this changes deploy plan §4.9, not built). Each is the prefix, 30 base62 characters and a 6-character base62 CRC32.
- Sealed value: `pv2.<key version>.<wrapped data key>.<iv, tag, ciphertext>`. The prefix alone says the format and version.
- Lease: Ed25519-signed JSON `{ v, kid, org, plan, limits, period, install, iat, exp }`.
- Feed manifest `pave.feed-manifest/1`: `{ generated_at, images, files: [{ path, bytes, sha256, url, updated_at }] }`.

## 4. Hard parts and decisions

### 4.1 The local server answers anyone (first gap)

**What exists.** The bug-sweep branch already refuses writes sent with a foreign `Origin` (`e813c79`, `refuseForeignWrites`), makes assets and the event stream need the viewer role (`eca02bf`), and records the any-host-name gap as an expected-failure test awaiting a decision (`4cf476c`). Step 1 repeats none of it: it decides that gap and makes that test pass.

**Host names.** A request is refused unless its host name is `localhost`, `127.0.0.1`, `[::1]`, the name in `PAVE_PUBLIC_URL`, `HOST` when it is a name or address, or one in `PAVE_ALLOWED_HOSTS`. The name is read from the request URL, as `refuseForeignWrites` does, and ports are ignored. A rebinding page fails on the name alone, and the test harness (`http://localhost/…`, no port), the Vite proxy (`Host: localhost:5173` [E]), the e2e scripts and the README's `curl` lines keep working with no change. `/health` is exempt.

**Route classes.** Refusing `Sec-Fetch-Site: cross-site` everywhere would break every sign-in callback and every link opened from mail: a browser sends it through a whole redirect chain [V: review; W3C Fetch Metadata]. So:

| Class | Routes | Rule beyond the host name |
|---|---|---|
| API | `/api/rpc`, `/api/assets`, `/api/events`, `/api/runs`, `/mcp`, `/api/local/*`, `/api/installs`, `/api/copy`, `/api/auth/*` except callbacks | Foreign-`Origin` writes refused (exists). New: `Sec-Fetch-Site`, when sent, must be `same-origin` or `none`, on reads too, unless the `Origin` is in `corsOrigins` |
| Navigation | Studio pages, `/invite/*`, `/r/*`, the device page, `/api/auth/callback/*`, the OAuth server's authorize page, `/link/callback`, `/oauth/:provider/callback` | `GET` only; cross-site allowed. Protected by `state`, PKCE and `nonce`, not by the guard. One exception: Apple's `POST` to its own callback from `https://appleid.apple.com` (step 10) |
| Keyed or public | `/v1/*`, `/feeds/*`, `/m/*`, static files | Cookies never read |

A test walks every mounted route and fails if one has no class. Step 1 also sends a simulated provider redirect (a `GET` with `Sec-Fetch-Site: cross-site`, `Sec-Fetch-Mode: navigate`) to each navigation path through stub routes, so a regression cannot hide until step 9.

**Local access (step 2).** No permanent secret travels in a URL or on a command line.
- The install secret is 32 random bytes in `PAVE_KEY_DIR/local-access`, outside the data folder: mode 0600, and on Windows an ACL for the current user, as the deploy plan does for node tokens.
- The launcher reads it, asks `POST /api/local/code` (bearer header) for a one-time code that lives 60 seconds in server memory, and opens `http://127.0.0.1:<port>/#c=<code>`. The studio trades the code at `/api/local/session` for an `HttpOnly`, `SameSite=Strict` cookie holding a random session id (stored hashed, 30 days sliding), so a restart strands no tab. History and process lists only ever hold a dead code.
- A second browser, a private window, cleared cookies: `pnpm open --print` prints a fresh link. `pnpm open --rotate` replaces the secret and ends every session.
- Scripts run by the same user (test harness, e2e, `install.mjs --check`, README `curl`) send the install secret as a bearer through one helper that reads the file; nothing switches the guard off. An MCP client gets its own named, revocable `pvl_` token (`pnpm token`).
- A LAN address: local mode with `HOST` set starts only when `PAVE_ALLOWED_HOSTS` names it; other machines enter by a pasted link valid 10 minutes. One shared identity is not a team product; the docs point to accounts mode.

**What this is for.** It stops web pages, other OS users, other machines and sandboxed apps. A program running as the same OS user can read the key folder, the data folder and the browser's cookies; nothing here stops it, and the OS login is the boundary. Cookies ignore ports, so the API rule refuses `same-site` requests too. *Rejected:* a local password or passkey: it protects nothing while the data folder is plain files, and a passkey cannot bind to `127.0.0.1` [V].

### 4.2 Only proven email; the library's routes closed (second gap)

**What is true at the pinned version** [V, this plan: package source]. Implicit linking into an unverified local account is already refused (`requireLocalEmailVerified`), so the research's exact takeover does not occur. These do. Sign-up needs no proof, so an invited address can be registered and the invitation taken. An account made from an unverified provider claim (Microsoft) keeps that identity when the address is later proven by password reset or the verify-email route; the library strips an unproven account only on code and magic-link sign-in. And the library's own routes, 36 under `/organization/` alone, are mounted whole and know none of our rules.

1. An identity is provider plus subject. `user.email` is the one proven sign-in address.
2. Sign-up is by email code: six digits, five minutes, three tries, stored hashed (the default is plain) [V, this plan]; at most five codes an hour per address [E]. Passwords are optional, need `requireEmailVerification` and the breached-password check; `revokeSessionsOnPasswordReset` is on; an unverified account is offered a sign-in code, never a reset.
3. **One strip, every path.** A database hook on `user` runs when `emailVerified` turns true outside that account's own session: password, sessions and social identities are removed first. It covers code sign-in, reset, verify-email and change-email.
4. `disableImplicitLinking: true`. A person links a provider in Settings after a recent sign-in, through `account.link.begin`. `allowDifferentEmails: true`, with Microsoft and Apple as trusted providers, applies to that explicit path only, because implicit linking is off [V, this plan].
5. Microsoft's `email` claim is never trusted [V]. A Microsoft or Apple sign-up is unverified until our code confirms the address. The verify screen offers "Use another address"; if that address has an account, the unproven row is deleted and the person is told to sign in there and add the provider.
6. **The allowlist.** `auth/routes.ts` marks each library route open or closed. Open: sign-in and sign-out, session, callbacks, passkey, two-factor, `set-active`. Everything else is closed over HTTP and done by Pavé commands that call the library server-side, so suspension, roles, grants, limits and audit always apply. An unverified session reaches only the verify routes.
7. Invitations: seven days, single use, a new one cancels the old, `requireEmailVerificationOnInvitation`. The library requires the signed-in address to equal the invited one [V, this plan]; the screen says so (section 1).

A hook nulls provider tokens, which `openid email profile` never needs; the library's versioned `secrets` option covers what it encrypts itself [V: review].

### 4.3 One secret, three jobs (third gap)

The auth secret signs sessions, derives the key that seals AI keys, and derives the `.pave` fingerprint [V: `ab:runtime.ts:110-118,160`]. Rotating it destroys every stored key without an error.

- **A separate keyring.** Local: a random master key in `PAVE_KEY_DIR`, by default the OS user's configuration folder, so a copied data folder no longer opens the keys. Mode 0600; a Windows ACL. Hosted: `PAVE_SECRETS_KEY`, the previous key readable during a rotation.
- **Envelope format.** Each secret has its own AES-256-GCM data key, wrapped by the master key, with organisation, kind and reference id as associated data. Hosted can later wrap with Cloud KMS by changing one function.
- **Migration, in this order.** (1) Write the key file to a temporary name, fsync, rename, fsync the folder. (2) Only then, row by row, seal into `sealed_v2`; the legacy `sealed` column is not touched. (3) Reads prefer `sealed_v2`. A crash at any point loses nothing.
- **Downgrade.** Older code still reads `sealed`. If it saves a new key, `sealed_v2_of` no longer matches, and newer code migrates again from the legacy value. A later release drops `sealed`.
- **Lost keyring** (a restored backup, a new laptop, a container without a persistent `PAVE_KEY_DIR`): the server starts, never overwrites a row, recovers from the legacy column where it can, marks the rest "needs saving again", says so in Settings, and writes one audit row and one log line with counts, never values. A lost device key means "Reconnect this computer".
- **Fingerprint** becomes stored data: the migration saves the current value as `legacy`; `pavefile/open.ts` accepts any of the organisation's.
- **The vault** (`credential`) holds every other secret. Commands return the last four characters only.

*Rejected:* a key file beside the database (publishing §2); a folder backup would hold key and ciphertext together.

### 4.4 Keep the auth library; own what it does not prove

Keep Better Auth: MIT, in-process, $0 at any user count, the only option that runs offline and hosted from one codebase [V]. No reason to change was found. Pin it; gate upgrades on `tenancy.test.ts`, the linking tests and the route-list snapshot of 4.2. We own the audit log (theirs is a paid add-on with 1 to 7 days kept [V]), email delivery, and the API-key table: the plugin does hash keys [V: review], but our keys belong to service accounts and carry a checksum.

### 4.5 Roles, guests, review links, service accounts

Rank: `guest` < `viewer` < `production` < `designer` < `admin` < `owner`. Billing is a flag. A guest is a member with role `guest` plus `project_grant` rows; the pipeline builds a context only for members (`runtime.ts`), so this is the smallest change. Folder grants flow down [V: Figma].

| Capability | Owner | Admin | Designer | Production | Viewer | Guest, by grant |
|---|---|---|---|---|---|---|
| See, comment, approve | all | all | all | all | all | Review: renders. View: also CAD, specs |
| Design, AI jobs, render | yes | yes | yes | no | no | Edit grant |
| Packages, Rhino and STEP exports, production status | yes | yes | yes | yes | no | no |
| Share: grants, review links | yes | yes | yes | no | no | no |
| Members, invitations, roles below owner; copy into a business | yes | yes | no | no | no | no |
| Keys, service accounts, feeds, webhooks, connections, the Diaex link, devices, organisation log | yes | yes | no | no | no | no |
| Plan, invoices, usage totals (also the billing flag) | yes | usage | no | no | no | no |
| Transfer ownership, delete the organisation | yes | no | no | no | no | no |

- **Outside the command pipeline.** Member status is read in `Runtime.#build`, so a suspended or removed member is refused on every route. The bug-sweep closed assets and the event stream to guests. When guests arrive (step 11), an asset read checks the grant of the asset's project, the stream sends a guest only events of granted projects, and `/api/runs/:id/events` uses the same check. Open streams close when a membership ends, is suspended or changes role.
- **Service account:** a `user` row of kind `service` with a `member` row, so `Ctx.user` and every `created_by` reference work unchanged. It has no credentials, a `.invalid` address the mailer refuses, and a session hook that refuses it. A key's rights are its scopes, capped by that role.
- **Review link:** an unguessable token (hash stored) to one frozen version; 30 days by default; a passcode locks for 15 minutes after five wrong tries; every open logged. Files are served as fixed image types with `nosniff`, never HTML or SVG. The page carries "Report this page".
- **First hosted release:** owner, admin, designer, viewer, production; invitations; suspension; service accounts. **Second:** guests and review links (they need assistant build step 17). **With billing:** the flag.

### 4.6 Sign-in with Google, Microsoft and Apple

**Hosted web.** Authorization code with PKCE, a one-time `state` and a `nonce`; the ID token fully checked; one callback path per provider against mix-up [V: RFC 9700]. Microsoft: work, school and personal accounts, the issuer checked per tenant [V]. Passkeys ship beside them; TOTP is optional.

**Apple** is step 10, built if decision 5 says so. Its web flow posts the result (`form_post`; the library does this [V, this plan]), the one cross-site `POST` of 4.1. The return address cannot be an IP address or `localhost` [V: review], so Apple works on hosted Pavé only, like the others. Name and email arrive once and are stored at once; a private-relay address needs our sending domains registered [V]. A relay address never equals an invited one, so that person accepts by code at the invited address and adds Apple in Settings. The client secret is a signed token that lasts six months at most [V]; a scheduled job re-mints it and a start-up check warns 30 days ahead.

**Local or desktop.** A local install never talks to the providers; it signs in to hosted Pavé (4.7) through the system browser with PKCE and a redirect to `http://127.0.0.1:<port>/link/callback`. Fallback for a server without a browser: the device grant, with short-lived codes, rate limits and a plain approval page, because it can be phished remotely [V: RFC 8628].

| Before launch | Needs | Owner |
|---|---|---|
| Legal entity for the registrations | The open `LICENSE` question | Founder, lawyer |
| Hosted domain; sending domain with SPF, DKIM, DMARC; the mail provider's approval to send to strangers [E] | DNS; calendar time | Founder |
| Privacy policy, terms, processor agreement | Unpriced legal work; names the breached-password service | Lawyer |
| Google brand verification | Puts name and logo on the consent screen. The 100-user cap is for apps that show the unverified-app screen; basic sign-in scopes are not said to trigger it [V: review] | Founder |
| Microsoft publisher verification | Free; the app registered in a work tenant; a partner-programme account that passed business verification; a custom domain [V] | Founder |
| Apple Developer Program, as an organisation | 99 USD a year; a legal entity with a D-U-N-S number, a working website and work email on its domain [V, this plan] | Founder |
| Diaex: register both clients; agree 4.8 | Diaex's process | Founder, Diaex agent |

File these when step 5 starts; all take calendar time.

### 4.7 A local install connects to hosted Pavé

1. **Sign in.** Hosted Pavé runs `@better-auth/oauth-provider` (MIT [V: review]) with one public client, `pave-install`. Public clients always need PKCE; a native loopback redirect matches any port, `localhost` does not [V, this plan]. Consent is never skipped and names the device. Pending state is bound to the local session of 4.1: the launcher opens on `127.0.0.1`, so the callback carries the cookie. (Under Vite dev the studio is on `localhost:5173`; there the state is held in server memory only, and PKCE still applies.)
2. **A narrow token.** `pave-install` may ask only for `install:register`, `install:lease` and `install:copy`. That token cannot call `/api/rpc` or `/v1`, so a copied keyring is not the person's account.
3. **Register the install.** The app makes an Ed25519 key pair and sends the public key with a name. Every `/api/installs` and `/api/copy` call carries the token and a device-key signature over the request and a server nonce. An install stops when Revoke is pressed or its membership ends; an offline machine keeps its lease until expiry, up to 14 days. Render nodes are `install` rows of kind `render-node` with their pairing code; whichever of deploy step 8 and step 16 lands first creates the table.
4. **Lease.** A signed lease good for 14 days, as Rhino's Cloud Zoo does [V; a 2019 staff post]. The app checks it against compiled-in public keys (the next key ships ahead of use), renews at start and daily, and warns in the last three days. Expiry drops to Free and never stops the app. The app remembers the latest time seen; a successful renewal resets that mark to the server's signed time, so a wrong clock heals.
5. **Honest-customer limits.** Renders and Rhino or STEP exports run on the person's machine, so editing the database or the clock lifts any local limit, and a copied lease runs as Pro elsewhere for 14 days [E]. Pavé accepts that. Free is 5 and 5 a month, counted locally and reported at renewal; Pro is unlimited within fair use; no link means Free. Hard enforcement stays where only the server acts.
6. **Copy online. Nothing is moved.** The local studio stays the working copy: editable, rendering, offline. Making it a read-only archive would end offline work with no way back, and hosted Pavé cannot render until render nodes exist.
   - **Send update** re-sends a project. The server replaces its copy only if that copy is unchanged since the last send (`sent_digest`); otherwise the person picks "keep the online version" or "save as a new project online". Nothing merges; nothing is overwritten silently. **Bring back** downloads an online project as a `.pave` file and opens it locally.
   - **A hash is never a capability.** The blob store is global and keyed by SHA-256 [V: `ab:assets/blob-store.ts`]. An organisation holds a blob only through its own `blob` row, written only after the server has hashed bytes that organisation sent. Intake skips an upload only when the target organisation already has that row, and its answer never shows whether the bytes exist elsewhere.
   - **Every reference is checked.** `copy/map.ts` lists, per table, the organisation column, user columns, actor JSON paths and foreign keys. A row whose reference is neither in the same upload nor already in the target organisation is refused as `dangling_reference`, with the same answer whether or not the id exists elsewhere. An id that clashes with a row this install did not send gets a new id, with its references rewritten; the report gives counts only.
   - **Mapping.** Organisation id and local user become the target's and the signed-in user's. Slug and SKU clashes are reported and renamed. The local fingerprint is added as `copied`. Sealed keys stay on the machine unless ticked one by one. Audit and usage rows arrive as `origin: 'local-install'`, never counted against hosted allowances.
   - **Limits.** Copying into a business needs admin. The payload carries a format and schema version; a mismatch is refused with "Update Pavé first". Storage is capped per plan (decision 10). Keyed on install id plus row id; it resumes from its cursor.

*Rejected:* a server grant per export and server-only exports (they force the network on an offline CAD tool). Hashes also appear in asset ETags and the feed manifest; that is safe once no route treats a hash as proof.

### 4.8 The partner link (OAuth 2.0 with PKCE)

The contract's design is sound [V]. Its eight gaps:

| # | Gap | Disposition |
|---|---|---|
| 1 | `state` not bound to session, organisation and user | **Fix.** 32 random bytes, stored hashed with all three, single use, five minutes; the verifier sealed; hosted adds a `__Host-` cookie; after the callback the browser goes to one fixed studio address. Into the contract's "Pavé's duties" |
| 2 | Who may connect; one consent serves all members | **Fix.** `partner.link.*` need admin and are never tools; the wording of section 1 on both consent screens; `made_by` stored and shown |
| 3 | No issuer identification | **Fix.** Ask Diaex to require RFC 8414 metadata and return `iss` (RFC 9207). Pavé pins the issuer at connect and compares it; without `iss` it relies on the per-provider callback path |
| 4 | PKCE not required of the hosted client | Pavé always sends it; ask for the wording |
| 5 | A code presented twice | Ask Diaex to refuse and revoke |
| 6 | The Pavé member who made the link leaves | Pavé's policy, below |
| 7, 8 | No token checksum; bearer refresh tokens | Low. Ask; leave room for DPoP |

- **Storage.** One `credential` of kind `partner` per link; scopes from the token response; nothing reaches the browser. The proposal note also corrects contract §9: a copy of the data folder no longer opens the token.
- **Refresh.** One at a time: a conditional update takes `refreshing_until` as a lease, and the new pair is stored in the transaction that clears it. A laptop that sleeps between receiving and storing a pair, past the contract's 30-second window, trips reuse detection and ends the link; ask in D13 for a window of minutes.
- **Revocation.** Disconnect calls RFC 7009, then deletes our copy. 401 `token_revoked` deletes it. 403 `access_removed` keeps the row, marks it and names the maker.
- **The maker leaves, is suspended or drops below admin.** Prices are hidden at once. The link becomes `needs_confirmation`; a current owner or admin reconnects or confirms; after 14 days [E] Pavé revokes and deletes.
- **Pasted token (v1).** Same vault, no refresh, expiry warned 14 days ahead.

### 4.9 Developer access

- **Keys.** Prefix and checksum let a scanner drop fakes offline [V: GitHub]. Stored as SHA-256, shown once. Owned by a service account. Expiry 90 days by default, a year at most, "never" for owners only. Rotation keeps the old key up to 7 days. Hosted only.
- **Scopes.** `catalog:read`, `media:read`, `prices:read` (retail), `trade:read` (trade price and cost, owner-granted), `files:read`, `stock:read`, `inventory:write`, `orders:read`, `events:read`, `webhooks:manage` (admin service accounts only), `audit:read`, `mcp`.
- **One rule for every transport.** A key may run a command only if the command declares a `keyScope` the key holds. `mcp` only opens the `/mcp` door; each tool call still needs its command's scope. Fields tagged `price` or `cost` are stripped from any output for an `apiKey` actor without `prices:read` or `trade:read` (`api/mask.ts`). Member, key, service-account, grant and link commands declare no `keyScope`, so no key can run them.
- **Rate limits.** A token bucket per key (120 a minute [E]) and per organisation (600 [E]); `429` with `Retry-After`. In memory, which suits one web instance.
- **Shape.** REST and JSON under `/v1`, projected from each command's `rest` entry. OpenAPI 3.1 is generated from the same zod schemas and is the source of truth; its snapshot is a test. *Rejected:* GraphQL (no named consumer).
- **Conventions.** Major in the path, additive inside it; a retired major gets 12 months and a `Sunset` header [V: Shopify's window]. Errors are RFC 9457 with `code` and `request_id`. `Idempotency-Key` on every write: 400 if missing, 409 in flight, 422 on reuse with another body, replayed for 24 hours [V: IETF draft, Stripe]. Lists take `limit` (50, at most 200) and an opaque `cursor` bound to key and query, newest first.
- **Events and webhooks.** The feed `GET /v1/events?after=` is the record: 30 days, then 410. Webhooks are the hint: Standard Webhooks signing, `webhook-id` equal to the event id, the spec's retries, two secrets during a roll, `410` disables, thin payloads [V]. They go out through a new `net/safe-post.ts` (the address check of `safe-fetch.ts`, `POST`, no redirects, any status). `api_event` is written in the change's transaction, as the sister plan says.
- **File feeds.** Each feed is a row with its own `pvf_` token, scopes, folders, expiry (a year by default), rotation, revoke, last used and a rate limit. The token goes in a header. A plain link (`?token=`) is an opt-in per feed for importers that take only a URL; it is cut from request logs, and such a feed can never hold `trade:read`. The files are the sister plan's `pave.item-master/1` export, with `price` empty without `prices:read` and cost columns empty without `trade:read`. Image links come from publishing's `/m/…` media (its step 4); until then the manifest says `images: false`. No SFTP ($216 a month per endpoint [V]); never plain FTP.
- **Sandbox, SDK, reference.** `pvk_test_` keys see only a seeded sandbox organisation. A generated TypeScript client; a reference at `/v1/docs` with its script served by us; both tools MIT [V].

### 4.10 Audit log and privacy

- **Recorded.** Every mutation, as today; failed sensitive actions; sign-in events from the library's hooks; chosen reads (CAD and package downloads, review-link opens, audit exports, partner-price views).
- **AI actions.** The actor is the agent; `on_behalf_of` is the person who started the job, `approved_by` the person who approved a confirmed step. For a key, the service account.
- **Erasure and tamper evidence together.** Personal data (names, emails, IP, user agent, personal parts of an input) never sits in a chained row. It goes to `audit_personal`; the log row holds its id and a salted digest. Erasing a person deletes those records and their salts, and a chained `audit.erased` row records it; the chain still verifies. This form is fixed in step 7, and in accounts mode the hashes are written from the first row.
- **Checkpoints, hosted.** A daily job signs each organisation's head and stores it in locked object storage. Its key lives in that job's environment, never in the web service; the public key is published so a customer can check an export. This detects tampering by someone with database access; it does not prevent it [V: the CloudTrail scheme].
- **Retention and export.** Stored at least a year. Shown: project activity on every plan; the organisation log for 90 days on a team plan; a year, export and streaming on the top plan [E].
- **Deleting an account.** A person with work in a business is anonymised in place: the `user` row stays as a tombstone, so `created_by` and the business's threads survive; credentials, identities, sessions and memberships go; the personal organisation is deleted after 30 days [E].
- **Dates.** GDPR: a breach goes to the regulator within 72 hours where feasible [V]. India's DPDP Rules: substantive duties from 13 May 2027; notice of a breach without delay and a fuller report within 72 hours; logs kept a year [V: law-firm summaries; confirm in the gazette]. California: requests answered in 45 days; Pavé is under the thresholds [V]. `organization.region` is recorded from day one.

### 4.11 Costs and third-party terms

- Better Auth and the packages added (OAuth provider, passkey, an SMTP client, the SDK generator, the reference renderer): MIT or MIT-0 [V: review]; each needs the founder's OK.
- Email: any SMTP provider. One price read: Amazon SES, $0.10 per 1,000 [V, this plan].
- Sign-in: Google and Microsoft free; Apple 99 USD a year [V, this plan].
- Later: Cloud KMS at $0.06 per key version a month and $0.03 per 10,000 operations, the same for the asymmetric key that will sign leases [V, this plan]. Not built: hosted SFTP ($216 a month per endpoint [V]); SSO through WorkOS ($125 a month per connection [V]).
- Legal work is unpriced. Provider terms cover the names and emails sign-in returns [E].

### Decisions that are the founder's

1. Is local-only use account-free for good? Recommend yes.
2. Which host names does a local install answer to (the bug-sweep's open question)? Recommend loopback plus `PAVE_ALLOWED_HOSTS`; LAN machines enter by a pasted link.
3. Honest-customer limits and a 14-day lease? Recommend yes.
4. After copying online, does local stay the working copy with Send update (recommended), or does hosted become the only editable copy? The second ends that person's offline editing and local rendering until sync and render nodes exist.
5. Apple at launch? Step 10 is ready (three days, plus the organisation enrolment). Recommend yes if the entity has a D-U-N-S number; else straight after launch.
6. Which legal entity registers the apps? It blocks steps 9, 10 and 16.
7. Do sealed AI keys stay on the machine unless ticked? Recommend yes.
8. When the Diaex link's maker leaves: prices hidden at once, the link ended after 14 days? Recommend yes.
9. Is Production a paid seat, and may a guest edit? Recommend paid, lower price; yes.
10. Storage caps for copies online (suggest 2 GB Free, 100 GB Pro [E]); email provider; region; which plan shows the organisation log.
11. Hold steps 17 and 18 until Pro can be bought? Recommend build 16, hold 17 and 18.

## 5. Verification

- **Guard** (`http.test.ts`): the bug-sweep's host-name test passes without `it.fails`; a cross-site and a same-site `fetch` to each API route are refused; a cross-site navigation to each callback and page passes; an unclassified route fails the walk; the harness, the proxy host and `/health` pass.
- **Local access.** No cookie means 401; a code works once and dies in 60 seconds; a session survives a restart; `--rotate` ends sessions; a `pvl_` token opens `/mcp` and can be revoked; the secret appears in no URL, argument or log; key-folder permissions hold on macOS, Linux and Windows CI.
- **Secrets.** Kills (`PAVE_KILL_AT`) after the key file is written and between rows lose nothing. Changing the auth secret loses no key (fails today). A lost keyring starts, overwrites nothing and reports counts. A simulated older writer is migrated again. A row moved to another organisation will not open. No stored secret, provider tokens included, appears in any output, event, trace or log line.
- **Accounts** (an in-process fake OpenID provider): an invitation cannot be taken by an unproven address (fails today); the provider squat is stripped on each proving path (code, reset, verify-email, change-email); same-email social sign-in is refused; an explicit link with a different email works after a recent sign-in; "use another address" works. The route snapshot fails when the library adds a route; a suspended admin and an unverified user are refused on every closed route.
- **Authorisation.** Every command against every role, the billing flag and each grant level, against a snapshot of the 4.5 table; a suspended member and a guest on `/api/events`, `/api/assets/:id` and `/api/runs/:id/events`; a stream closes on suspension. A tool-list snapshot holds no member, key, share or link command.
- **Audit.** New fields written; a denied action leaves a row; an agent row names starter and approver; the verifier catches an edited and a removed row, and passes after an erasure.
- **API.** OpenAPI snapshot; every command against a key with and without its scope, over REST and MCP; price and cost absent without their scopes in `/v1`, MCP and each feed file; idempotency; another key's cursor refused; 429; a mistyped key rejected by checksum. Webhooks: the spec's vectors, retries on a fake clock, the secret roll, 410, a private address refused. A feed's link token is absent from logs.
- **Link and lease.** A wrong, used or expired state is refused; the install token is refused on `/api/rpc`; a call without the device signature is refused; a bad lease gives Free and the app starts; a clock set forward heals on renewal.
- **Copy.** Naming another organisation's blob hash, piece id or asset id imports nothing and answers as for an unknown id; a designer cannot copy into a business; a version mismatch and an over-cap upload are refused; a schema test fails when a table with an organisation or user column is missing from `copy/map.ts`; Send update refuses a project changed online; kill and rerun adds no row.
- **Partner link** (the contract's fixtures, a fake authorization server): another organisation's state refused; `iss` mismatch refused; two refreshes make one call; `access_removed`, a departed and a demoted maker show the right states and hide prices.
- **Review lenses.** Security against RFC 9700 and RFC 8252; privacy; the founder's first hour; premium design on every new screen (`apps/studio/e2e/shots.ts`). Nothing here adds local background work beyond one lease request a day.
- **By hand, the founder can:** run `curl -H 'Host: evil.test' http://127.0.0.1:8787/api/rpc/session.get` and see a refusal; open Pavé in a second browser with `pnpm open --print`; delete `auth-secret`, restart, and find the AI key still works; with `PAVE_MAIL=console`, sign up by code and accept an invitation; make a test key, call `/v1/me`, press "Send test event".
- **Not verifiable here:** provider verification, mail delivery, Diaex's side.

## 6. Scope cuts

| Cut | Picked up when |
|---|---|
| Merging two accounts; several sign-in addresses per person | Support load; the library keys a user on one address |
| Automatic linking when both sides are verified | "Account already exists" becomes a support load |
| Verified-domain join, SAML, SCIM, required MFA, audit streaming | A customer asks (WorkOS if needed) |
| Third-party OAuth apps, personal tokens, IP rules, a Zapier app | Developers ask; step 16's OAuth server is the base |
| Staff access to a customer's organisation (a `support` actor) | It has its own written rule |
| Hosted SFTP; a separate origin for public media | A named partner cannot use HTTPS; publishing's media step |
| Sync between a local copy and hosted | Its own plan (`05-platform.md` §6) |
| Keychain storage of the master key (Electron `safeStorage` [V]) | The desktop shell exists |
| DPoP; several Diaex links | Diaex offers it; contract D15 |
| Billing, a second region, a SOC 2 report | Pricing is decided; a customer needs them |

## 7. Build order

Every step writes its tests first; "Tests" names the section 5 bullet it must turn green. Steps 1, 2 and 4 need no hosting and should land before the founder's first test; tell the board before merging 1 and 2, because they change how every lane opens the app. Steps touching `assistant/`, `pavefile/`, `net/` or `plans.ts` follow the assistant build's merge (A3). Steps 5 to 15 run in accounts mode on a laptop and go live with deploy steps 6 and 7. Efforts are [E], about 68 days in all.

1. **Host names and route classes** (4.1), on top of `claude/bugsweep-server`. Files: `http/guard.ts`, `app.ts`, `config.ts`. Tests: Guard, with the simulated provider redirect. Done: the bug-sweep's expected failure passes; harness, Vite dev and e2e run unchanged. 1 day. Needs the bug-sweep merge.
2. **Local access** (4.1). Files: `http/local-access.ts`, `main.ts`, `scripts/install.mjs`, `pnpm open`, `pnpm token`, `test/harness.ts`, `apps/studio/e2e/harness.ts`, studio `lib/{rpc,session}`, `README.md`. Tests: Local access. Done: another OS user's `curl` gets 401; every suite, e2e script and README example passes through the bearer helper. 2 days. Needs 1.
3. **Keyring and re-seal** (4.3). Files: `secrets/*`, `assistant/keys.ts`, `runtime.ts`, `pavefile/{save,open}.ts`, `AiSettings.tsx`. Tests: Secrets. Done: rotating the auth secret, a crash or a downgrade loses no key. 3 days. Needs A3.
4. **Local profile:** the first-run question, `profile.*`. Files: `auth/workspace.ts`, `handlers/session.ts`, `AccountSettings.tsx`. Tests: harness, screenshots. Done: "Designer" appears nowhere once a name is set. 1 day.
5. **Mail, code sign-in, closed routes** (4.2 rules 2, 6): the mailer, the allowlist, status and verify-only in `#build`, rate limits, trusted proxy, start-up refusals. Files: `auth/{auth,mailer,routes}.ts`, `runtime.ts`, `test/harness.ts`, `pages/auth/*`. Tests: Accounts (routes). Done: no account acts before its address is proven. 3 days. Needs 1, 3.
6. **Passwords, linking, invitations** (4.2 rules 3, 4, 5, 7). Files: `auth/linking.ts`, `handlers/{org,account}.ts`, `MembersSettings.tsx`. Tests: Accounts, failing first. Done: every squat test passes. 3 days. Needs 5.
7. **Audit v2** (4.10): columns, the personal side table, the hashed form, hooks, denied outcomes, list, export, both screens. Files: `audit/*`, `context.ts`, `rpc/execute.ts`, `auth/hooks.ts`. Tests: Audit. Done: "who exported this file, from where" has an answer; an erasure keeps the chain valid. 4 days. Needs 5.
8. **Roles v2 and service accounts** (4.5): `authorize.ts`, `production`, suspension, `kind`, `region`, ownership transfer, service accounts as users, stream closing. Files: `api/access.ts`, `commands.ts`, `auth/authorize.ts`, `handlers/org.ts`, `http/events.ts`, a migration. Tests: Authorisation. Done: the first-release rows of 4.5 hold on every route. 4 days. Needs 6.
9. **Google, Microsoft, passkeys, TOTP** (4.6). Files: `auth/auth.ts`, `SignInSettings.tsx`, `pages/auth/*`. Tests: the fake provider per quirk. Done: a staging sign-in with each; checklist rows filed. 3 days plus verification time. Needs 6, decision 6.
10. **Apple** (4.6), if decision 5 is yes. Files: `auth/auth.ts`, `auth/apple-secret.ts`, `http/guard.ts`. Tests: the posted callback passes the guard from Apple's origin only; the name is stored on first sign-in; a relay address cannot take an invitation. Done: a staging sign-in with an Apple account. 3 days. Needs 9, the enrolment.
11. **Guests and review links** (4.5). Files: `handlers/{grants,review-links}.ts`, `http/{assets,events}.ts`, `features/share/*`, `pages/review/*`. Tests: Authorisation for guests; the passcode lock. Done: a client approves a render with no account. 4 days. Needs 8, assistant build step 17.
12. **API keys and `/v1`** (4.9): keys, `keyScope`, masking, limits, idempotency, problem details, cursors, OpenAPI, `/v1/me`, read routes for pieces and takes. Files: `api/*`, `http/v1.ts`, `repo/public.ts`, `ApiSettings.tsx`. Tests: API. Done: a script lists pieces with a key; the snapshot is committed. 4 days. Needs 7, 8. Catalogue routes arrive as publishing steps 1 to 4 add `rest` entries.
13. **Events and webhooks.** Files: `api/events.ts`, `webhooks/*`, `net/safe-post.ts`. Tests: API (webhooks). Done: a loopback receiver verifies a test event and a replay. 3 days. Needs 12; delivery uses `work` rows if deploy step 1 has landed, else a leased table.
14. **Sandbox:** the sandbox organisation, its seed, test keys. Files: `seed.ts`, `api/keys.ts`. Tests: a test key reads no live row. Done: "Send test event" works in the sandbox. 2 days. Needs 13.
15. **Feeds, SDK, reference.** Files: `feeds/*`, `packages/sdk` (generated). Tests: a manifest golden file; API (feeds). Done: a mirror script fetches only what changed. 3 days. Needs 12, the sister plan's item-master export, publishing step 4 for images.
16. **Device link** (4.7 steps 1 to 3) and Settings, Devices. **Gate:** a one-day spike proves that the provider package registers a fixed public native client with custom scopes, matches loopback on any port and rotates refresh tokens, and that the loopback return works in current Chrome, Safari and Firefox; if not, ship the device grant only. Files: `auth/auth.ts`, `hosted/link.ts`, `http/installs.ts`, `features/connect/*`. Tests: Link and lease. Done: a laptop shows in the device list and Revoke cuts it off. 4 days. Needs 2, 3, 9, a hosted dev environment.
17. **Leases** (4.7 steps 4, 5). Files: `plans/lease*.ts`, `hosted/lease.ts`, `plans.ts`. Tests: Link and lease. Done: a Pro laptop renders offline for 14 days, then falls to Free and still starts. 3 days. Needs 16.
18. **Copy online** (4.7 step 6). Files: `hosted/copy.ts`, `copy/map.ts`, `http/copy.ts`, `features/connect/*`. Tests: Copy. Done: the founder's studio is online complete, still editable locally; a second run adds nothing. 6 days. Needs 16, the hosted blob store (deploy step 6).
19. **Partner link, pasted token:** the `partner` credential, its commands, the Connect wording, the leaving rule. Files: `secrets/vault.ts`, `handlers/partner.ts`. Tests: Partner link (states). Done: the sister plan's connector uses a token it never sees in clear. 2 days. Needs 3, 8, Diaex v1.
20. **Partner link, OAuth with PKCE:** both callbacks, single-flight refresh, revocation, and the amendments (gaps 1 to 5, D13's window, §9) as a proposal note for the Diaex agent. Files: `oauth/*`, `handlers/partner.ts`. Tests: Partner link. Done: the shared v1.1 cases pass against the fake, then Diaex's test mode. 4 days. Needs 1, 19, Diaex v1.1.
21. **Audit verifier and checkpoints.** Files: `audit/chain.ts`, a scheduled job. Tests: Audit (chain). Done: an edited row is detected; a customer can check an export. 2 days. Needs 7, production.
22. **Keys out of the web service:** the KMS wrapper for the master key, an asymmetric key for leases. Files: `secrets/keyring.ts`, `hosted/lease.ts`. Tests: a KMS fake. Done: neither key is in the environment. 2 days. Needs 3, 17, production.
23. **Account export and delete; secret scanning.** Files: `handlers/account.ts`. Tests: anonymise in place keeps a business's work; Audit (erasure). Done: both requests complete in the product; the `pvk_` pattern is registered with GitHub [V]. 2 days. Needs 7, 12.
