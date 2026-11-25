# Accounts, identity and the developer API

_25 November 2026._ This plan settles who a person is in Pavé (a local profile now, a hosted account later), organisations, roles and invitations, sign-in with Google, Microsoft and Apple, how a local install connects to hosted Pavé, token handling for the Diaex partner link, API keys, the public API with webhooks and file feeds, and the audit log. It rests on research `20-accounts-and-identity.md` and `21-connectors-and-developer-api.md` (§6, §10, §12.2), the server code, and pages of the auth library's documentation opened for this plan ("[V, this plan]"). It extends `deploy-and-durable-jobs.md` §4.8 and §4.9 and `docs/integrations/diaex-partner-api.md` §3 and §9. It replaces three lines of `publishing.md` §2 and §3: API keys are our own table, not `@better-auth/api-key`; a key acts as a service account, not as its creator; `secrets.ts` becomes the keyring of 4.3. It overrides `docs/ARCHITECTURE.md:177-182`: there is no "Continue with Diaex" sign-in. Connectors and the sync engine belong to the sister plan, `docs/plans/integrations-hub.md`. Labels: [V] verified at source, [S] search extract, [E] estimate.

## 1. Experience

**On your own computer: a profile, not a login.**
- First run asks one thing: "What should we call you?" A name, an optional photo, an optional email as a label. No password. History, exports and `.pave` files carry that name instead of "Designer".
- Pavé opens from its launcher (`pnpm start` opens the browser). A web page or another program calling the local server gets nothing. A tab without its link shows one quiet card: "Open Pavé from its launcher".
- Settings, Account says "This studio lives on this computer. Nobody else holds your designs", with one action below: **Connect to Pavé online**.

**Hosted Pavé: accounts.**
- Sign in with an email and a six-digit code, "Continue with Google" or "Continue with Microsoft". A passkey is offered after the first sign-in. A password is optional, added in Settings.
- If the address already has an account: "You already have a Pavé account with this email. Sign in the way you did before, then add Google in Settings."
- Everyone starts with a personal studio. Settings, Members lists people and roles, pending invitations and suspended people (history kept).
- **Share** on a project: add a guest by email at Review, View or Edit, or make a review link to one frozen version (expiry, passcode, revoke, "opened 3 times").
- Settings, Devices lists installs and render machines with Revoke. Settings, Activity is the admins' organisation log; each project has its own Activity.
- Settings, API and webhooks (admins): service accounts; keys shown once; scopes as plain checkboxes ("Read the catalogue", "See retail prices"); endpoints with a delivery log, Replay and "Send test event"; feed addresses; a Sandbox switch.

**Connecting an install.** Connect to Pavé online opens the system browser. The person signs in and allows "Pavé on this computer". Back in the app: "Connected as Maya. Plan: Pro, good offline until 9 December." Then one question: move this studio online, or stay local. Moving shows a preview, then progress that survives a restart.

**The Diaex link.** Only an owner or admin sees Connect. The dialog says: "Everyone in this studio will see stones, and prices if you allow them, under your Diaex access. Diaex staff can see that this link exists, not your designs." If the person who made it leaves: "This link was made by Ravi, who has left. Reconnect, or it ends on 12 December."

**AI jobs.** Activity reads "Assistant, for Maya: replaced the centre stone". The assistant cannot invite, change roles, make keys, share or connect; those are not tools. When a job needs a right the person lacks, it says so before it starts.

## 2. Structure

**`apps/server/src`**
- `http/guard.ts`: Host and Origin allowlist, mounted first in `buildRoutes` (`app.ts`). `http/local-session.ts`: the launcher token (local mode).
- `secrets/{keyring,seal,vault,migrate}.ts`. `assistant/keys.ts` calls `seal.ts`; `Runtime.deriveKey` stays for legacy reads only.
- `auth/auth.ts` gains plugins step by step. New: `auth/mailer.ts`, `auth/linking.ts` (the rules of 4.2 as hooks), `auth/hooks.ts` (sign-in events into the audit log), `auth/authorize.ts` (role rank, flags, then grants; called by `rpc/execute.ts`).
- `audit.ts` becomes `audit/{write,chain,list,export}.ts`. `context.ts` gains `request` (id, IP, user agent, session, key or install id).
- `api/{keys,rate-limit,idempotency,problem,cursor,events}.ts`, `http/v1.ts` (projected from the command registry), `webhooks/{sign,deliver}.ts`, `feeds/manifest.ts`.
- `oauth/{state,pkce,client,refresh}.ts`: the OAuth client for the partner link; the sister plan's connectors reuse it.
- `hosted/{link,lease,claim}.ts` (install side); `http/{installs,claim}.ts` (hosted side).
- `repo/public.ts`: the only cross-organisation reads (key hash, review-link and feed tokens).

**`packages/schema/src`**: `api/access.ts` (roles, grant levels, scopes), `api/public.ts`, `plans/{lease,lease-keys}.ts`. **`apps/studio/src`**: `pages/auth/*`; `pages/settings/{Account,SignIn,Members,Devices,Activity,Api}Settings.tsx`; `features/{share,connect}/*`; `pages/review/ReviewPage.tsx` (public).

**Hosted only:** accounts, email, invitations, guests and review links, devices, the hash chain, keys and `/v1`, events, webhooks, feeds, the sandbox, lease signing, claim intake. Everything else also runs in a local install.

A key request flows: `guard` → key lookup by hash → rate limit → `Runtime.contextForApiKey` → idempotency → `runtime.execute` (validation, `authorize` and audit as for people) → problem details.

## 3. Contract changes

Additive unless marked. Migrations take the next free numbers at build time (the assistant build is at `0015`).

**Config.** `PAVE_ALLOWED_HOSTS`; `PAVE_KEY_DIR`; `PAVE_SECRETS_KEY` and `PAVE_SECRETS_KEY_PREVIOUS` (accounts mode), later `PAVE_KMS_KEY`; `PAVE_MAIL` (`console` or an SMTP address), `PAVE_MAIL_FROM`; `PAVE_TRUSTED_PROXY_HOPS`; provider client ids and secrets; `PAVE_HOSTED_URL`; `PAVE_LEASE_SIGNING_KEY`. Accounts mode refuses to start with `ANTHROPIC_API_KEY` set, or in production with `PAVE_MAIL=console` or no secrets key.

**Schema.**
- `ROLES` gains `production`, between `viewer` and `designer`. `guest` now means "by grant only".
- `CommandDef` gains `needs?: 'billing'`, `scope?: 'piece' | 'folder'` with `grant?: 'review' | 'view' | 'edit'`, `rest?: { method, path, scope }` (as publishing), `audit?: { target, snapshot?, read? }`.
- `Actor` gains `apiKey` (`keyId`, `serviceAccountId`), `install` (`installId`) and `support` (`staffId`, `reason`).
- `ErrorCode` gains `rate_limited` (429), `email_unverified` (403), `local_token_required` (401). `session.get` gains `profile`, `lease`, `orgs[].kind`.
- **Breaking, accounts mode only:** password sign-up without a verified email is removed. Migration: unverified users verify by code at next sign-in; `test/harness.ts` signs up through a capturing mailer. Nothing is hosted yet [V: repo].

**Commands** (none is a tool except `activity.list`): `profile.get/update`; `org.invite` (gains `grants?`, calls the plugin), `org.invitations.*`, `org.removeMember`, `org.suspendMember`, `org.setBilling`, `org.transferOwnership`; `grants.*`; `reviewLinks.*`; `serviceAccounts.*`; `apiKeys.create/list/rotate/revoke`; `webhooks.*` (as publishing); `audit.list/export`, `activity.list`; `devices.list/revoke`; `hosted.link.*`, `lease.get`, `claim.*`; `partner.link.begin/paste/status/confirm/disconnect`; `account.export/delete`.

**Tables.**

| Table | Shape |
|---|---|
| `assistant_key` | + `key_version` (default 0); re-sealed at boot (4.3) |
| `credential` | `org_id, kind, ref_id, sealed, key_version, last4, scopes, expires_at, refreshing_until, status, made_by`; unique (`org_id`, `kind`, `ref_id`). Kinds: `image-key`, `partner`, `channel`, `webhook-secret`, `hosted-link`, `device-key` |
| `org_fingerprint` | `org_id, fingerprint, is_current, source` (`legacy`, `random`, `claimed`) |
| `user`, `member`, `organization` | + `user.contact_email`; `member.status`, `member.billing`; `organization.kind` (`personal`, `business`, `sandbox`), `region`, `parent_org_id` |
| `service_account` | `org_id, name, role, created_by, disabled_at` |
| `api_key` | `org_id, service_account_id, name, mode, prefix, last4, sha256, scopes, folder_ids, rate_per_min, expires_at, grace_until, last_used_at, revoked_at`; `sha256` unique |
| `api_request_log`, `idempotency_key`, `api_event` | Log and events kept 30 days. Idempotency rows unique on (`key_id`, `method`, `path`, `key`), pruned at 24 hours |
| `webhook_endpoint`, `webhook_delivery` | As named in publishing, plus `previous_secret_until` on the endpoint |
| `audit_log` | + `seq, on_behalf_of, target_type, project_id, folder_id, outcome, error_code, before, after, ip, user_agent, request_id, session_id, key_id, install_id, origin, prev_hash, hash`. `audit_checkpoint`: the daily signed head |
| `project_grant`, `review_link` | Grant: `user_id, target_type, target_id, level, expires_at, revoked_at`. Link: `piece_id, version, asset_ids, token_sha256, passcode_hash, expires_at, revoked_at` |
| `install`, `install_usage` | `user_id, org_id, kind, name, public_key, last_seen_at, revoked_at`; kinds `studio`, `render-node`; usage per period |
| `claim`, `claim_item` | State, cursor and report; items keyed on (`install_id`, `row_id`) |
| `oauth_pending`, `partner_link` | Pending: `state_sha256, provider, org_id, user_id, session_id, verifier, expires_at, used_at`. Link: `org_id, provider, credential_id, issuer, scopes, made_by, status, confirm_by`; one per organisation and provider in v1 |

**HTTP.** `POST /api/local/session`; `GET /link/callback`; `GET /oauth/:provider/callback` (the contract's `/oauth/diaex/callback`); `/api/installs/*`; `/api/claim/*`; `/v1/*` with `/v1/openapi.json` and `/v1/docs`; `GET /feeds/:token/manifest.json`; `GET /r/:token`.

**Formats.**
- API key: `pvk_live_` or `pvk_test_`, 30 base62 characters, then a 6-character base62 CRC32. Node tokens (`pvn_`) take the same tail; this changes deploy plan §4.9, which is not built.
- Sealed value: `pv2.<key version>.<wrapped data key>.<iv, tag, ciphertext>`. No prefix means legacy.
- Lease: Ed25519-signed JSON `{ v, kid, org, plan, limits, period, install, iat, exp }`.
- `/v1` errors: RFC 9457 with `code` and `request_id`. `/api/rpc` keeps today's shape.
- Feed manifest `pave.feed-manifest/1`: `{ generated_at, files: [{ path, bytes, sha256, url, updated_at }] }`.

## 4. Hard parts and decisions

### 4.1 The local server answers anyone (first gap)

`app.ts` checks neither `Host` nor `Origin` [V: repo]. A DNS-rebinding page is same-origin to the server, and any program on the machine can call it and spend the sealed Claude key [E: a standard attack].

1. **Guard.** Refuse any request whose `Host` is not `localhost`, `127.0.0.1` or `[::1]` with the server's port, the host of `PAVE_PUBLIC_URL`, or a name in `PAVE_ALLOWED_HOSTS`. An `Origin`, when sent, must be in that list or in `corsOrigins`; `Sec-Fetch-Site: cross-site` is refused. It runs in both modes, before `/api/auth`, `/mcp` and the callbacks.
2. **Launcher token, local mode.** A cookie handed out on a page load (the research's proposal) can be fetched by any local program that sends the right `Host`, so the token must arrive out of band. The server keeps 32 random bytes in `<dataDir>/studio-token` (0600). The launcher opens `http://localhost:<port>/#t=<token>`; the studio posts it to `/api/local/session`, gets an `HttpOnly`, `SameSite=Strict` cookie and strips the fragment. Without the cookie, or `Authorization: Bearer <token>` for a local MCP client, `/api` and `/mcp` answer 401. It lasts per data folder, so a restart strands no open tab.

Malware running as the same OS user can still read the file; the OS login is the boundary. *Rejected:* a local password or passkey: it protects nothing while the data folder is plain files, and a passkey cannot bind to `127.0.0.1` [V].

### 4.2 Only verified email, strict linking (second gap)

Sign-up needs no verification today. The library links a social sign-in to an existing user with the same address when the provider reports it verified; its docs do not say our side must be verified too [V, this plan]. An attacker can register a victim's address first and keep access after the victim signs in with Google. An invitation link can be taken the same way.

1. An identity is provider plus subject. Email is contact data.
2. Sign-up is by email code, so no account exists before the address is proven: six digits, five minutes, three tries [V, this plan], stored hashed (the default is plain text [V, this plan]). Passwords are optional, with `requireEmailVerification` and the breached-password check.
3. `account.accountLinking.disableImplicitLinking: true` [V, this plan]. Linking happens only in Settings, after a recent sign-in, and is audited.
4. An unverified account has no standing. When its address is first proven through the public sign-in form, every password, session and social identity it held is removed. The library removes the password and sessions [V, this plan]; `auth/linking.ts` adds identities. Verifying from inside the account's own session keeps them.
5. Microsoft's `email` claim is never trusted [V]. A Microsoft or Apple sign-up is unverified until our code confirms the address; until then the session reaches only the verify screen.
6. Invitations use the plugin's own path with `requireEmailVerificationOnInvitation`: seven days, single use, a new one cancels the old.

Option names not opened at source are [E]; the tests of step 5 decide.

### 4.3 One secret, three jobs (third gap)

The auth secret signs sessions, derives the key that seals AI keys, and derives the `.pave` fingerprint [V: `ab:runtime.ts:110-118,160`]. Rotating it destroys every stored key without an error.

- **A separate keyring.** Local: a random master key in a file under `PAVE_KEY_DIR`, by default the OS user's configuration folder, outside the data folder, so a copied or backed-up data folder no longer opens the keys. Hosted: `PAVE_SECRETS_KEY`, with the previous key readable during a rotation. Master keys are versioned.
- **Envelope format.** Each secret has its own AES-256-GCM data key, wrapped by the master key, with organisation, kind and reference id as associated data. Hosted can later wrap with Cloud KMS by changing one function; stored shapes stay.
- **Migration.** At boot, `secrets/migrate.ts` opens each `assistant_key` row at version 0 through the old derivation and re-seals it at version 1, one row per transaction, safe to repeat. A row that will not open is left; Settings asks for the key again.
- **Fingerprint** becomes stored data: the migration saves the current value as `legacy`; new organisations get a random one; `pavefile/open.ts` accepts any of the organisation's.
- **The vault** (`credential`) holds every other secret. Commands return the last four characters only.

*Rejected:* a key file beside the database (publishing §2); a folder backup would hold key and ciphertext together.

### 4.4 Keep the auth library; own what it does not prove

Keep Better Auth: MIT, in-process, $0 at any user count, the only option that runs offline and hosted from one codebase [V]. No reason to change was found. Pin it, and gate upgrades on `tenancy.test.ts` and the linking tests. We own three things: the API-key table (the plugin's page still does not say how keys are stored [V, this plan]), the audit log (theirs is a paid add-on with 1 to 7 days kept [V]) and email delivery.

### 4.5 Roles, guests, review links, service accounts

Rank: `guest` < `viewer` < `production` < `designer` < `admin` < `owner`. Billing is a flag beside the role. A guest is a member with role `guest` plus `project_grant` rows. The research has outsiders as non-members, but the pipeline builds a context only for members (`runtime.ts`), so this is the smallest change. Folder grants flow down; a lower level can add access, never remove it [V: Figma].

| Capability | Owner | Admin | Designer | Production | Viewer | Guest, by grant |
|---|---|---|---|---|---|---|
| See projects, renders, specs | all | all | all | all | all | Review: renders. View: also CAD, specs |
| Comment, approve | yes | yes | yes | yes | yes | yes |
| Design, AI jobs, render | yes | yes | yes | no | no | Edit grant |
| Packages, Rhino and STEP exports, production status | yes | yes | yes | yes | no | no |
| Share: grants, review links | yes | yes | yes | no | no | no |
| Members, invitations, roles below owner | yes | yes | no | no | no | no |
| Keys (AI, API), service accounts, webhooks, connections, the Diaex link, devices, organisation log | yes | yes | no | no | no | no |
| Plan, invoices, usage totals (also anyone with the billing flag) | yes | usage | no | no | no | no |
| Transfer ownership, delete the organisation | yes | no | no | no | no | no |

- **First hosted release:** owner, admin, designer, viewer, production; email invitations; suspension; service accounts. **Second:** guests and review links, which need projects and folders (assistant build step 17). **With billing:** the flag. **On demand:** section 6.
- **Review link:** an unguessable token (hash stored) to one frozen version; 30 days by default, optional passcode, every open logged.
- **Service account:** a non-human row with a role, so keys outlive people. A key's rights are its scopes, capped by that role.

### 4.6 Sign-in with Google, Microsoft and Apple

**Hosted web.** Authorization code with PKCE, a one-time `state` and a `nonce`; the ID token fully checked; one callback path per provider against mix-up [V: RFC 9700]. Microsoft is registered for work, school and personal accounts, with the issuer checked per tenant [V]. Passkeys ship beside them; TOTP is optional.

**Local or desktop.** A local install never talks to the providers; it signs in to hosted Pavé (4.7). Primary: the system browser with PKCE and a redirect to `http://127.0.0.1:<port>/link/callback`. Fallback, for a server on a studio network or without a browser: the device grant, with short-lived codes, rate limits and an approval page that says plainly what is being connected, because it can be phished remotely [V: RFC 8628]. The Electron shell later uses the library's custom-scheme flow [V].

**Apple** waits for a store listing: guideline 4.8 is an App Review rule [V], so a web app is outside it [E].

| Before launch | Needs | Owner |
|---|---|---|
| Legal entity for the registrations | The open `LICENSE` question | Founder, lawyer |
| Hosted domain; sending domain with SPF, DKIM, DMARC | DNS | Founder; builder configures |
| Privacy policy, terms, processor agreement | Both verifications and GDPR | Lawyer |
| Google brand verification | Capped at 100 users until verified [V]. Scopes `openid`, `email`, `profile` only; no scope review expected [E] | Founder |
| Microsoft multi-tenant registration, publisher verification | Free; a partner-programme account for the entity and a custom domain [V] | Founder |
| Apple, only with a store listing | 99 USD a year; a client secret re-minted within six months; relay domains [V] | Founder |
| Diaex: register both clients; agree 4.8 | Diaex's process | Founder, Diaex agent |

Both verifications take calendar time; file them when step 5 starts.

### 4.7 A local install connects to hosted Pavé

1. **Sign in.** Hosted Pavé runs `@better-auth/oauth-provider` with one first-party public client, `pave-install`. Public clients always need PKCE; a native client's loopback redirect matches any port, and `localhost` does not [V, this plan]. Consent is never skipped. The callback lands on `127.0.0.1`, where the studio's `localhost` cookie is absent, so pending state lives in server memory, single use, for five minutes.
2. **Register the install.** The app makes an Ed25519 key pair, keeps the private key in the vault, and sends the public key with a name. Render nodes become `install` rows of kind `render-node` and keep their pairing code (deploy plan §4.9): one device list, one revoke.
3. **Choose:** the personal organisation, a business where the person is designer or above, or stay local and just licensed.
4. **Lease.** The install signs a renewal with its device key; the server returns a signed lease good for 14 days, as Rhino's Cloud Zoo does [V; the figure is a 2019 staff post]. The app checks it against compiled-in public keys, renews at start and daily, and warns in the last three days. An expired lease drops to Free and never stops the app. A clock set back extends nothing: the app remembers the latest time it has seen.
5. **Honest-customer limits.** Renders and Rhino or STEP exports run on the person's machine, so editing the database or the clock lifts any local limit [E]. Pavé accepts that. Free is 5 renders and 5 exports a month, counted in local `plan_claim` rows and reported at renewal, so an organisation's installs share one allowance. Pro is unlimited locally within fair use. Without a link an install is Free; `PAVE_PLAN` stays a testing override. Hard enforcement stays where only the server can act: render nodes, hosted AI credits, team features, publishing, the API.
6. **Claim, once,** after a preview:

| Local thing | On claim |
|---|---|
| Organisation id; local user | Replaced by the target's and the signed-in user's on every row and in actor JSON |
| Other ids (96 random bits) | Kept; inserted with "do nothing on conflict" and reported |
| Blobs | Sent by hash; known ones skipped |
| Slug, SKU | The only real clashes: reported and renamed, never overwritten |
| `.pave` fingerprint | Added to the target as `claimed` |
| Sealed keys and tokens | Stay on the machine unless ticked one by one, then re-sealed |
| Audit and usage rows | Imported as `origin: 'local-install'`, unverified, never counted against hosted allowances |

   Keyed on install id plus row id, so a retry adds nothing; it resumes from its cursor.
7. **Afterwards** the local copy is a read-only archive ("Moved to Pavé online on 3 December"). Editing both would fork the work; there is no sync yet.

*Rejected:* a server grant per export, and server-only exports: both force the network on an offline CAD tool.

### 4.8 The partner link (OAuth 2.0 with PKCE)

The contract's design is sound [V]. Its eight gaps:

| # | Gap | Disposition |
|---|---|---|
| 1 | `state` not bound to session, organisation and user | **Fix.** 32 random bytes, stored hashed with all three, single use, five minutes; hosted adds a `__Host-` cookie; a mismatch is refused and audited. Goes into the contract's "Pavé's duties" |
| 2 | Who may connect, and that one consent serves all members | **Fix.** `partner.link.*` need admin and are never tools; the wording of section 1 on both consent screens; `made_by` stored and shown |
| 3 | No issuer identification | **Fix.** Ask Diaex to require RFC 8414 metadata and return `iss` (RFC 9207). Pavé pins the issuer at connect and compares it |
| 4 | PKCE not required of the hosted client | Pavé always sends it; ask for the wording |
| 5 | A code presented twice | Ask Diaex to refuse and revoke |
| 6 | The Pavé member who made the link leaves | Pavé's policy, below |
| 7, 8 | No token checksum; bearer refresh tokens | Low. Ask; leave room for DPoP |

- **Storage.** One `credential` of kind `partner` per link, bound to organisation and link id; granted scopes taken from the token response; nothing reaches the browser.
- **Refresh.** One at a time: a conditional update takes `refreshing_until` as a lease. Refresh under five minutes left. The new pair is stored in the transaction that clears the lease. After a crash, retrying the old token inside the contract's 30-second window returns the same pair; later, reuse detection ends the link (`needs_reconnect`).
- **Revocation.** Disconnect calls RFC 7009, then deletes our copy. 401 `token_revoked` deletes it. 403 `access_removed` keeps the row, marks it and names the maker.
- **A member leaves.** When the maker's membership ends or is suspended, the link becomes `needs_confirmation` with a banner for owners and admins. One of them reconnects or confirms; after 14 days [E] with no answer Pavé revokes and deletes.
- **Pasted token (v1).** Same vault, no refresh, expiry warned 14 days ahead.

### 4.9 Developer access

- **Keys.** Prefix and checksum let a scanner drop fakes offline [V: GitHub]. Stored as SHA-256, shown once; a slow hash adds nothing to about 178 random bits [E]. Owned by a service account. Expiry 90 days by default, a year at most, "never" for owners only; admins mailed 14 days before. Rotation keeps the old key up to 7 days. The pattern is registered with GitHub's secret scanning at general availability [V]. Hosted only; a local install uses the launcher token.
- **Scopes.** `catalog:read`, `media:read`, `prices:read` (retail), `trade:read` (trade price and cost, owner-granted), `files:read` (CAD, counted against allowances), `stock:read`, `inventory:write`, `orders:read`, `events:read`, `webhooks:manage`, `audit:read`, `mcp`. Price and cost never leave through a key without the scope. A key can be limited to named folders.
- **Rate limits.** A token bucket per key (120 a minute [E]) and per organisation (600 [E]); `429` with `Retry-After`. In memory, which suits one web instance (deploy plan §4.8).
- **Shape.** REST and JSON under `/v1`, projected from each command's `rest` entry. OpenAPI 3.1 is generated from the same zod schemas and is the source of truth; its snapshot is a test. *Rejected:* GraphQL (no named consumer).
- **Versioning.** Major in the path; additive inside a major; a retired major gets 12 months and a `Sunset` header [V: Shopify's window].
- **Errors, idempotency, pagination.** RFC 9457. `Idempotency-Key` on every write: 400 if missing, 409 in flight, 422 on reuse with another body, replayed for 24 hours [V: IETF draft, Stripe]. Lists take `limit` (50, at most 200) and an opaque `cursor` bound to key and query, newest first.
- **Events and webhooks.** The feed `GET /v1/events?after=` is the record: 30 days, then 410. Webhooks are the hint: Standard Webhooks signing, `webhook-id` equal to the event id, the spec's retries, two secrets during a roll, `410` disables, thin payloads `{ type, timestamp, data: { id, sku, url } }`, sent through `net/safe-fetch.ts` [V]. `emitApiEvent` writes in the change's transaction; once the sister plan's outbox exists, its relay feeds `api_event` and the public contract stays.
- **File feeds.** An HTTPS manifest of every file with size, SHA-256 and an immutable link, with SKU-named image paths. The files are the sister plan's `pave.item-master/1` export and publishing's `/m/...` media. No SFTP ($216 a month per endpoint [V]); never plain FTP.
- **Sandbox, SDK, reference.** `pvk_test_` keys see only a seeded sandbox organisation. A generated TypeScript client and a reference at `/v1/docs`; both tools are MIT [V].
- **First release:** all of the above. **Later:** third-party OAuth apps and the rest of section 6.

### 4.10 Audit log and privacy

- **Recorded.** Every mutation, as today; failed sensitive actions (forbidden, plan limit, bad key); sign-in events from the library's hooks; chosen reads (CAD and package downloads, review-link opens, audit exports, partner-price views).
- **Each row** has the columns of section 3, with before and after for settings, roles, grants and keys; the IP comes from the trusted proxy hop only.
- **AI actions.** The actor is the agent (run, tool call, model); `on_behalf_of` is the person who started the job, or the service account for a key.
- **Tamper evidence, hosted only.** Each row carries a hash over its content and the organisation's previous row; a daily signed checkpoint goes to locked object storage. It detects tampering by someone with database access; it does not prevent it [V: the CloudTrail scheme].
- **Retention and export.** Stored at least a year. Shown: project activity on every plan; the organisation log for 90 days on a team plan; a year, export and streaming on the top plan [E]. `audit.export` writes CSV or JSON and is audited.
- **Privacy, with dates.** GDPR: a breach goes to the regulator within 72 hours where feasible [V]. India's DPDP Rules: substantive duties from 13 May 2027, a 72-hour breach report, logs kept at least a year [V: a law-firm summary; confirm in the gazette]. California: requests answered in 45 days; Pavé is under the thresholds [V]. `account.export` and `account.delete` ship with production; a deleted user's audit rows keep a tombstone id; `organization.region` is recorded from day one.

### 4.11 Costs and third-party terms

- Better Auth: MIT, $0 [V]. Each added package (the OAuth provider, passkeys, an SMTP client, the SDK generator, the reference renderer) needs the founder's OK and a permissive licence, checked at install.
- Email: any SMTP provider. One price read: Amazon SES, $0.10 per 1,000 [V, this plan].
- Sign-in: Google and Microsoft free with the verifications of 4.6 [V]; Apple 99 USD a year, deferred [V].
- Later: Cloud KMS at $0.06 per key version a month and $0.03 per 10,000 operations [V, this plan]. Not built: hosted SFTP ($216 a month per endpoint [V]); SSO through WorkOS ($125 a month per connection [V]).
- Provider terms cover the names and emails sign-in returns [E]; the lawyer reviews them.

### Decisions that are the founder's

1. Is local-only use account-free for good? Recommend yes.
2. Honest-customer limits on local renders and exports (4.7)? Recommend yes.
3. Offline lease of 14 or 30 days? Recommend 14.
4. After a claim, is the local copy read-only? Recommend yes, until sync exists.
5. Google and Microsoft first, Apple deferred? Recommend yes.
6. Which legal entity registers the apps? It blocks steps 8 and 13.
7. Do sealed AI keys stay on the machine at claim unless ticked? Recommend yes.
8. When the maker of the Diaex link leaves: flag, then revoke after 14 days? Recommend yes.
9. Is Production a paid seat, and may a guest edit? Recommend paid, lower price; yes.
10. Email provider, hosting region, the plan that shows the organisation log. Recommend any SMTP provider, the United States, and 4.10.

## 5. Verification

- **Guard and token** (`http.test.ts`): `Host: evil.test` is refused on `/api/rpc`, `/api/assets`, `/api/events`, `/mcp` and the callbacks; a cross-site `Origin` is refused; the loopback names pass; no cookie means 401; the fragment exchange and the bearer form work. Each fails on today's code first.
- **Secrets.** Seed a row with the old sealing, boot, read the key, see version 1. Change the auth secret: the key still opens (fails today). Rotate the master key: rows re-seal. A row moved to another organisation will not open. An old `.pave` file is still "ours". No stored secret appears in any output, event, trace or log line.
- **Linking** (`auth-linking.test.ts`, an in-process fake OpenID provider): pre-registration takeover; an unverified provider claim squatting an address; an invitation taken by an unproven address; same-email social sign-in refused; link and unlink need a recent sign-in. `tenancy.test.ts` stays green.
- **Authorisation.** Every command against every role, the billing flag and each grant level, against a snapshot of the 4.5 table. An ungranted project is 404 to a guest; a suspended member gets 403.
- **Audit.** New fields written; sign-in events present; a denied action leaves a row; an agent row names its starter; the verifier catches an edited and a removed row.
- **API.** OpenAPI snapshot; every `rest` route against every scope; no price field without `prices:read`; idempotency (400, 409, 422, replay); another key's cursor refused; 429 with `Retry-After`; a mistyped key rejected by checksum with no database read. Webhooks: the spec's vectors, retries on a fake clock, the secret roll, 410, a private address refused. A manifest golden file. The sandbox reads no live row.
- **Link, lease, claim.** A wrong, used or expired state is refused; a bad or expired lease gives Free and the app still starts; a clock set back extends nothing; a claim killed at each stage (`PAVE_KILL_AT`) and rerun adds no row.
- **Partner link** (the contract's fixtures, a fake authorization server): another organisation's state refused; `iss` mismatch refused; two refreshes make one call; a crash before storing recovers inside the window; `access_removed` and a departed maker show the right states.
- **Review lenses.** Security against RFC 9700 and RFC 8252; privacy; the founder's first hour; premium design on every new screen (`apps/studio/e2e/shots.ts`). Nothing here adds local background work beyond one lease request a day.
- **By hand, the founder can:** run `curl -H 'Host: evil.test' http://127.0.0.1:8787/api/rpc/session.get` and see a refusal; delete `auth-secret`, restart, and find the AI key still works; with `PAVE_MAIL=console`, sign up by code and accept an invitation; make a test key, call `/v1/me`, press "Send test event".
- **Not verifiable here:** provider verification, mail delivery, Diaex's side.

## 6. Scope cuts

| Cut | Picked up when |
|---|---|
| Sign in with Apple | A store listing is wanted |
| Automatic linking when both sides are verified | "Account already exists" becomes a support load |
| Verified-domain join, SAML, SCIM, required MFA, audit streaming | A customer asks (WorkOS if needed) |
| Third-party OAuth apps, personal tokens, IP rules, a Zapier app | Developers ask; step 13's OAuth server is the base |
| Hosted SFTP | A named partner cannot use HTTPS |
| Sync between a local copy and hosted | Its own plan (`05-platform.md` §6) |
| Keychain storage of the master key (Electron `safeStorage` [V]) | The desktop shell exists |
| DPoP; several Diaex links | Diaex offers it; contract D15 |
| Billing, a second region, a SOC 2 report | Pricing is decided; a customer needs them |

## 7. Build order

Tests first in every step; the cases named are those of section 5. Steps 1 to 4 need no hosting and should land before the founder's first test. Steps 5 to 12 run in accounts mode on a laptop and go live with deploy plan steps 6 and 7. Efforts are [E].

1. **Host and Origin guard** (4.1 part 1). Files: `http/guard.ts`, `app.ts`, `config.ts`. Tests: the guard cases, failing first. Done: the rebinding test passes; other suites unchanged. Half a day. No dependencies.
2. **Launcher token** (4.1 part 2) and its card. Files: `http/local-session.ts`, `main.ts`, `scripts/install.mjs`, a `pnpm open` script, studio `lib/{rpc,session}`. Tests: the token cases; a browser run. Done: another OS user's `curl` gets 401; the studio opens in one step. One day. Depends on 1.
3. **Keyring and re-seal** (4.3). Files: `secrets/*`, `assistant/keys.ts`, `runtime.ts`, `pavefile/{save,open}.ts`, a migration, `AiSettings.tsx`. Tests: the secrets cases, failing first. Done: rotating the auth secret loses no key. Two days. No dependencies.
4. **Local profile:** the first-run question and `profile.*`. Files: `auth/workspace.ts`, `handlers/session.ts`, `AccountSettings.tsx`. Tests: harness; screenshots. Done: "Designer" appears nowhere once a name is set. One day. No dependencies.
5. **Verified accounts** (4.2): mailer, code sign-in, passwords with reset, linking rules, emailed invitations, rate limits, trusted proxy, start-up refusals. Files: `auth/{auth,mailer,linking}.ts`, `handlers/org.ts`, `test/harness.ts`, `pages/auth/*`. Tests: the linking cases, failing first. Done: no account acts before its address is proven. Four days. Depends on 1, 3.
6. **Audit v2** (4.10 without the chain). Files: `audit/*`, `context.ts`, `rpc/execute.ts`, `auth/hooks.ts`, `http/assets.ts`, the Activity screens. Tests: the audit cases. Done: "who exported this file, from where" has an answer on screen. Three days. Depends on 5 for sign-in events only.
7. **Roles v2 and service accounts** (4.5, first release): `production`, suspension, `kind` and `region`, ownership transfer. Files: `api/access.ts`, `commands.ts`, `auth/authorize.ts`, `handlers/org.ts`. Tests: the role-table snapshot. Done: the first-release rows of 4.5 hold. Three days. Depends on 5.
8. **Google, Microsoft, passkeys, TOTP** (4.6, hosted web). Files: `auth/auth.ts`, `SignInSettings.tsx`, `pages/auth/*`. Tests: the fake provider per quirk (tenant issuer, unverified email). Done: a staging sign-in with each provider; checklist rows filed. Three days plus verification time. Depends on 5 and decision 6.
9. **Guests and review links** (4.5, second release). Files: `handlers/{grants,review-links}.ts`, `features/share/*`, `pages/review/*`. Tests: the grant cases; expiry, passcode, revoke. Done: a client approves a render with no account. Four days. Depends on 7 and assistant build step 17.
10. **API keys and `/v1`** (4.9): keys, limits, idempotency, problem details, cursors, OpenAPI, `/v1/me`, read routes for pieces and takes. Files: `api/*`, `http/v1.ts`, `repo/public.ts`, `ApiSettings.tsx`. Tests: the API cases. Done: a script lists pieces with a key; the snapshot is committed. Four days. Depends on 6, 7. Catalogue routes arrive as publishing steps 1 to 4 add `rest` entries.
11. **Events, webhooks, sandbox:** `api_event`, the feed, signed delivery (as `work` rows if deploy plan step 1 has landed, else a leased table), replay, test events, the sandbox. Files: `api/events.ts`, `webhooks/*`. Tests: the webhook cases. Done: a loopback receiver verifies a test event and a replay. Four days. Depends on 10.
12. **Feeds, SDK, reference** (4.9). Files: `feeds/manifest.ts`, `packages/sdk` (generated). Tests: the manifest golden file; the client type-checks against the snapshot. Done: a mirror script fetches only what changed. Two days. Depends on 10 and the sister plan's item-master export.
13. **Device link** (4.7 steps 1 and 2) and Settings, Devices. **Gate:** a one-day spike proves that the provider package registers a fixed public native client, matches loopback on any port and rotates refresh tokens; if not, ship the device grant only. Files: `auth/auth.ts`, `hosted/link.ts`, `http/installs.ts`, `features/connect/*`. Tests: the link cases. Done: a laptop shows in the device list and Revoke cuts it off. Four days. Depends on 2, 3, 8 and a hosted dev environment.
14. **Leases and honest limits** (4.7 steps 4 and 5). Files: `plans/lease*.ts`, `hosted/lease.ts`, `plans.ts`. Tests: the lease cases. Done: a Pro laptop renders offline for 14 days, then falls to Free and still starts. Three days. Depends on 13.
15. **Claim** (4.7 steps 3, 6 and 7). Files: `hosted/claim.ts`, `http/claim.ts`, `features/connect/*`. Tests: the claim and kill cases. Done: the founder's studio opens online complete; a second run adds nothing. Five days. Depends on 14 and the hosted blob store (deploy plan step 6).
16. **Partner link, pasted token:** the `partner` credential, its commands, the Connect wording, the leaving rule. Files: `secrets/vault.ts`, `handlers/partner.ts`, the Connect dialog. Tests: the status cases with a fake. Done: the sister plan's connector uses a token it never sees in clear. Two days. Depends on 3, 7 and Diaex v1.
17. **Partner link, OAuth with PKCE:** both callbacks, single-flight refresh, revocation, and the three amendments as a proposal note for the Diaex agent. Files: `oauth/*`, `handlers/partner.ts`. Tests: the partner cases. Done: the shared v1.1 acceptance cases pass against the fake, then Diaex's test mode. Four days. Depends on 1, 16 and Diaex v1.1.
18. **Hosted hardening:** the hash chain and checkpoint, the KMS wrapper, `account.export/delete`, the secret-scanning registration. Files: `audit/chain.ts`, `secrets/keyring.ts`, `handlers/account.ts`. Tests: the chain cases; a KMS fake. Done: an edited audit row is detected; the master key is out of the environment. Four days. Depends on 6 and a production environment.
