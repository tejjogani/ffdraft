# The native Pavé file (`.pave`), version 2

_25 November 2026._ This plan turns the first `.pave` file (assistant build step 12: a zip with a manifest) into a format that can grow, can be handed to strangers, and keeps the pricing model whole: saving and opening in Pavé is free, STL is free, Rhino and STEP exports are paid. It rests on [`docs/research/17-pave-file-format.md`](../research/17-pave-file-format.md), on `docs/research/05-platform.md` §4, on `docs/plans/freeform-cad.md` §3 and on the v1 code. **It replaces** the "Versioning rules" and "Opening" sections of the assistant build's `docs/pave-file.md`, and, for files only, the line "No schema version bump" in `freeform-cad.md` §3 (see 4.2).

The spine: **a small envelope that a reader of any age can check first** (format, version, what the file needs), a design that is the only truth, a free mesh and picture for instant preview, and a history that travels only as far as the person chose.

Paths are in the assistant build tree (branch `claude/assistant-build`). Labels: `[V]` verified at source (by research 17 unless a link is given here), `[E]` estimate. Nothing was run: no size or timing below is measured.

## 1. Experience

**Saving.** "Save as Pavé file" (piece menu, CAD export menu, ⌘K) opens one glass sheet over the piece. It asks one question, **Who is this for?**, with three cards:

- **Just me** (Working copy). "Everything, for backup or another computer of yours."
- **Someone I work with** (Share copy). "The design and how it was made. Names, prices and suppliers stay here."
- **Anyone** (Clean copy). "The finished design only. No history, no pins."

Under the cards, a list headed **What this file contains** updates with the choice: "The design · 214 changes by 2 people and the assistant · 6 pins (2 pictures stay here: their licence does not travel) · 3 shots · a preview". Share copy has two switches: *Include the history* (on) and *Include the brief* (off). A footnote: "Saving and opening Pavé files is free." One button: **Save**. The sheet remembers the last choice; the first time it is on *Someone I work with*.

**Opening.** Drop a file anywhere, or Open Pavé file (⌘O). Before anything is uploaded, a card shows what the file says about itself, read in the browser: the picture, title and kind, "Saved with Pavé 0.4 on 12 March", the copy type, what is inside, and one line of origin: "Saved here", "Saved elsewhere" or "Signed by the same studio as 3 pieces you have". Buttons: **Open** and Cancel. On Open the piece appears at once with its mesh; a hairline shows while the exact geometry rebuilds. Notes appear as today. Links from the file show as text and open only on a click.

**A file from a newer Pavé.** The card says "This file needs a newer Pavé" and names what it needs in plain words ("curves and lofts"). One button: **How to update**. It never shows a schema error. A damaged file, or one that is not a Pavé file, gets one sentence that says what is wrong; nothing is written.

**Settings → Privacy** has one switch, **Help improve Pavé with how I edit**, with two sentences on what is used and what never is. Whether it starts on is the founder's decision (4.5).

**With the AI.** "Send this to my caster" in chat: the assistant first asks who it is for and whether the history should go, then shows the same *What this file contains* list as an approval card. The person can change the copy type on the card, then approves; the file downloads. The assistant never proposes a Working copy for sending, and never opens a file by itself: that is a person's choice.

No screen says zip, manifest, hash or schema.

## 2. Structure

**New package `packages/file` (`@pave/file`)**: the envelope. Pure TypeScript over `Uint8Array`, Web Crypto for SHA-256 and signatures, `fflate` for deflate, no database, **no import from any other `@pave/*` package** (so publishing it is a copy, 4.10).

- `zip/read.ts`: the strict reader (moved from `apps/server/src/pavefile/zip.ts`, tightened as in 3.2). `openContainer(bytes)` returns `{ entries, read(name) }`; entries are inflated on demand and hashed as they stream.
- `zip/write.ts`: our own writer (fixed order, no extra fields, no data descriptors, a 20-line CRC-32). `fflate.zipSync` does not promise these [E].
- `probe.ts`: `probe(bytes)` reads only `manifest.json` (4.1). `manifest.ts`: the schema, `PAVE_READER = [2, 0]`, `canRead(probe) → ok | { update: string[] }`.
- `limits.ts`: `PAVE_LIMITS` and `checkLimits(entries)`, used by the reader **and** the writer.
- `features.ts` (3.4), `names.ts` (entry-name patterns), `thumbnail.ts` (`readThumbnail` reads entry 3 without inflating anything), `sign.ts` (verify Ed25519), `carry.ts` (`residue`, `mergeUnder`, 4.2), `fixtures/` (section 5).

**`packages/schema/src/files/pave.ts`** keeps the *record* schemas and imports the envelope from `@pave/file`. New here: `featuresOf(design)`, `redactDesign`, `redactOps`, `SAVE_PROFILES`.

**`apps/server/src/pavefile/`**: `save.ts` (collect, apply the profile, write), `open.ts` (the ordered checks, then one transaction), new `migrate-v1.ts`, `profile.ts` (pseudonyms, rounding, redaction), `history.ts` (segments, base, replay), `seal.ts` and `signing.ts` (keys from `runtime.deriveKey`), `describe.ts` (the contents summary, shared by the sheet and the approval card). `zip.ts` is deleted.

**`packages/kernel/src/export/glbDisplay.ts`**: the compressed display mesh. `glb.ts` stays as it is for Blender.

**Studio, `apps/studio/src/features/pavefile/`**: `SaveSheet.tsx`, `OpenCard.tsx` (uses `@pave/file` in the browser), `index.ts` (today's functions, now opening the sheet and the card). `lib/kernel/usePieceEvaluation.ts` shows the stored preview mesh while its first evaluation runs.

**Save:** sheet → `pieces.describeFile` (live summary) → `pieces.saveFile` → records → profile filter → `checkLimits` → writer → read back (a file we cannot read is a bug, never a download) → asset → browser.

**Open:** file → `OpenCard` probes locally → upload → `pieces.openFile` → ordered checks (4.1) → transaction → preview mesh shown → kernel rebuild in the browser.

**Local and hosted.** All of this runs locally today. Hosting adds limits on opens, a registry of known signing keys, the service's counter-signature and the learning pipeline; none is built here (section 6).

## 3. Contract changes

### 3.1 The version 2 layout (breaking against v1; v1 files migrate on open, 3.7)

Order is fixed for the first three entries, then as listed. W, S, C = Working, Share, Clean copy.

| Entry | Holds | W | S | C | Depends on |
|---|---|---|---|---|---|
| `mimetype` | the media type, stored, no extra field, first | ✓ | ✓ | ✓ | – |
| `manifest.json` | 3.3; second | ✓ | ✓ | ✓ | – |
| `thumbnails/thumbnail.png` | 512 px on the long side, stored, third; left out when the cover may not travel. W and S may add `preview.jpg`, about 1600 px | ✓ | ✓ | ✓ | design |
| `design.json` | the design document alone, canonical JSON. **The truth.** | ✓ | redacted | redacted | – |
| `piece.json` | title, kind, stage, spec, facts, cover id, origin; `brief` (S: if ticked; C: never); `attestation` (W only) | ✓ | ✓ | ✓ | nothing |
| `directions.json` | the variants, each with its design | ✓ | ✓, no costs | – | nothing |
| `history/base.json` | the design before the first kept change | ✓ | if history on | – | nothing |
| `history/000001.jsonl` … | 2,000 changes a segment [E], one JSON object a line, oldest first | ✓ | if on, pseudonymous | – | nothing |
| `geometry/display.glb` | display mesh (4.6) | ✓ | ✓ | ✓ | design |
| `looks/shots.json` | saved shots with their render scenes | ✓ | ✓ | – | nothing |
| `references.json`, `assets.json`, `assets/<sha256>.<ext>` | pins and pictures whose rights travel (v1's rule); never `thumbUrl`; prompts and seeds W only | ✓ | ✓ | cover only | nothing |
| `provenance.json` | 3.5 | full | reduced | minimal | nothing |
| `sourcing.json`, `production.json`, `view.json` | reserved, not written in 2.0: supplier and cost records outside the design; view state | ✓ | – | – | nothing |
| `ext/<reverse-dns>/<name>` | third-party and future data, inert bytes | carried | carried | – | per its manifest row |
| `signatures/seal.mac`, `signatures/manifest.sig` | 4.8; not listed in the manifest | ✓ | seal; sig if ticked | – | – |
| `META-INF/…` | reserved for C2PA [V]; not written, skipped by the reader; built only if a customer asks | – | – | – | – |

Gone from v1: `checksum.sha256` (per-entry hashes and the zip CRC catch damage; the seal and signature cover the manifest), `history.json`, `shots.json`, `thumbnails/cover.webp`, **`geometry/exact.step`** (4.3).

### 3.2 The strict zip profile

Stored or deflate only. No ZIP64, encryption, split archives, data descriptors, archive comment, or bytes before the first entry or after the end record. Names are ASCII, at most 120 bytes, matched against patterns, never used as paths. The reader refuses: duplicate names; overlapping entries; any difference between a local header and the directory (name, sizes, method, CRC); a `mimetype` that is not first, stored and without an extra field (so the type starts at byte 38 [V, ODF]); an unpacked total above 100 times the file size [E: keep it at least three times the worst golden file]. Output is deterministic: sorted JSON keys, fixed order, entry times equal to the save time; two saves of one piece with one profile differ only in the save record and `signatures/`.

`PAVE_LIMITS` gains `manifestBytes` 1 MiB, `thumbnailBytes` 2 MiB, `segmentChanges` 2,000, `carried` 64 entries and 16 MiB, `displayTriangles` 5,000,000 [E]; v1's numbers stay.

### 3.3 `manifest.json` (breaking: new shape; v1 manifests are migrated)

```jsonc
{
  "format": "pave",
  "formatVersion": 2,            // changes only when an older reader would misread
  "minorVersion": 0,             // additions
  "minReaderVersion": [2, 0],    // oldest reader that may open THIS file
  "requires": [],                // features a reader must know, e.g. "design.freeform.curves"
  "uses": ["mesh.meshopt"],      // features a reader may ignore
  "labels": {},                  // plain words for each feature named above, for the update message
  "writer": { "app": "Pavé", "version": "0.4.0",
              "kernel": { "pave": "0.4.0", "occt": "<package version>", "manifold": "<package version>" } },
  "units": "mm",
  "document": { "id": "doc_…", "revision": 57 },   // stable across saves and opens; new in a Clean copy
  "profile": "working" | "share" | "clean",
  "piece": { "title": "…", "kind": "ring" },
  "createdAt": "…", "modifiedAt": "…", "savedAt": "…", // S and C: rounded to the day
  "design": { "sha256": "…", "schemaVersion": 1 },
  "history": { "kind": "full" | "none", "firstSeq": 1, "lastSeq": 57, "changes": 57,
               "learning": "allowed" | "not-allowed" | "unknown" },
  "contents": { "directions": 0, "references": 6, "referencesWithoutPictures": 2, "shots": 3, "assets": 5 },
  "entries": { "design.json": { "bytes": 1234, "sha256": "…", "mediaType": "application/json", "dependsOn": "nothing" }, … }
}
```

Every entry except `mimetype`, `manifest.json` and `signatures/*` is in `entries`; the mesh's row also has `designSha256`. `tolerance` is added when the kernel exposes its modelling tolerance as a constant; the builder must not invent a number. A reader of the same major carries manifest keys it does not know (4.2).

### 3.4 Features (new; `packages/file/src/features.ts`)

`requires` is computed by `featuresOf` from what the file really holds (the design, every direction's design, the history base), so a ring with no freeform nodes still opens in an older reader. Version 2.0 knows today's 19 node kinds (implicit, never listed) and `mesh.meshopt` (`uses`). Reserved for the freeform build, one per family: `design.freeform.curves` (`curve`, `curveOp`, the `curve`/`path` fields on `revolve`, `pipe`, `pattern`), `design.freeform.solids` (`extrude`, `loft`, `sweep`), `design.freeform.edges` (`fillet`, `shell`, `boolean.op: split`), `design.freeform.deform` (`flow`, `deform`), `design.import.brep` (`brepBody`). **Rule for every later build step:** a new node kind, or a new field that changes geometry, adds a feature to `featuresOf` in the same commit. A test walks `NODE_KINDS` and fails for a kind with no mapping.

### 3.5 Records (breaking against v1, migrated)

- `piece.json` loses `design`, `directions`, `version` (now `history.lastSeq`), `createdAt`, `updatedAt`.
- A history line: `{ id, seq, ops, inverse, actor, label, at, reverts }`. W keeps v1's `actor` and `userId`. S writes `actor: { type: 'person', as: 'author-1' } | { type: 'assistant', model? } | { type: 'system' }`, no user, run or tool-call ids, and `at` rounded to the day. Pseudonyms are random for each file.
- `provenance.json`: `{ origin, attested, ai: { changesByPeople, changesByAssistant, models[] }, hops: { count, last } }`. W also keeps the full hop list. C keeps only `{ ai: { involved } }`.
- Redaction outside W: on stone nodes `sourcing.provider`, `sku`, `url`, `priceUsd` and `certificate` are removed; `sourcing.measured` stays (the seat is cut to it). The same keys go from every op, inverse and the base checkpoint. Directions lose `costUsd`.

### 3.6 Commands (`packages/schema/src/api/commands.ts`; all additive)

- `pieces.saveFile { id, profile?: 'working'|'share'|'clean', history?: 'full'|'none', brief?: boolean, sign?: boolean }` → `{ asset, notes, summary }`. Defaults: `share`, `full`, `false`, `false`. Still never counted by the plan.
- `pieces.describeFile` (query, same input) → `{ summary }`: counts, authors by pseudonym, what stays behind and why, a size estimate.
- `pieces.openFile`: output adds `summary`. `Piece.provenance` gains `profile`, `savedHere`, `signedBy`, `historyVerified`, `learning`, `documentId`. `Piece` gains `previewMesh: { assetId, version } | null`.
- Step 15 only: `pieces.describeFile` becomes an assistant tool; `pieces.saveFile` a tool that always needs approval and refuses `profile: 'working'`.

### 3.7 Database and migration

One additive migration, the next free number after `0015_pave_file.sql`: `piece.document_id text`, `piece.preview_mesh jsonb`, `piece.file_extra jsonb` (carried unknown fields, at most 1 MiB), table `piece_attachment(id, org_id, piece_id, name, blob_sha, bytes, media_type, depends_on, at_version)`, table `file_signing_key(key_id, org_id, public_key, created_at, retired_at)`.

**v1 files** are migrated in memory by `PAVE_FILE_MIGRATIONS[1]` (`migrate-v1.ts`): split `piece.json` into `piece.json`, `design.json`, `directions.json`; turn `history.json` into segments (no base, so `historyVerified` is false); drop `geometry/exact.step` and every `thumbUrl`; move hops into `provenance.json`; check `save.org` as the step 2 seal (a static fingerprint from before step 2 never matches, so the attestation is asked again); `learning: 'unknown'`; profile `working`. No "save as version 1" is offered: no v1 build has reached a user.

### 3.8 Config and names

`packages/schema/src/plans/config.ts` gains `learning: 'opt-in' | 'with-free-plan'` per plan (today `opt-in` on both, matching `org_settings.allow_eval_use`, default off).

Extension `.pave`, unchanged. Media type: `application/vnd.<VENDOR>.pave-piece+zip`; until the founder gives the legal name the writer keeps v1's `application/vnd.pave.piece+zip`, and `PAVE_MIMES` lists every string a reader accepts. macOS type identifier: `<REVERSE-DOMAIN>.pave-piece`, conforming to `public.data` [E: not to an archive type, so Finder does not unpack it], declared by the future desktop app [V]. IANA registration is open to anyone through expert review; `+zip` is a registered suffix [V].

## 4. Hard parts and decisions

### 4.1 The order of checks, so a newer file says "update"

v1 checks names, then the media type, then the version (`open.ts` `readFile`). So a future file fails as "contains an entry a .pave file never has" (research §2.3 rows 1–2), and a renamed media type would fail as "not a Pavé file".

**Decision: a promise that never changes, checked first.** In every future version the file is a classic zip with an entry named `manifest.json`, stored or deflated, at most 1 MiB unpacked, whose JSON has `format`, `formatVersion` and, from v2, `minorVersion`, `minReaderVersion`, `requires`. A change that breaks this takes a new extension. The reader's order:

1. File size against the limit.
2. **Probe:** find the end record, cap the entry count, inflate `manifest.json` with a hard stop, parse with a depth cap, read the five fields. Not `format: "pave"`: "not a Pavé file".
3. **Version:** major newer than ours, or `minReaderVersion` newer than `PAVE_READER`, or a `requires` name we do not know → stop with `newer_pave_file`, "This file needs a newer Pavé (…)". Each unknown feature is named by the label the file gives for it (`labels` in the manifest: plain text, at most 60 characters), else by its name.
4. Strict zip profile and `checkLimits` (3.2); media type in `PAVE_MIMES`.
5. Names: known patterns, `ext/…`, or a safe unknown name listed in the manifest (4.2). Anything else refuses the file.
6. Manifest schema; every entry's size and SHA-256 against `entries`, both ways.
7. Seal and signature, if present (4.8). A signature that does not verify refuses the file; a seal that does not match only means "saved elsewhere".
8. File migrations from older majors; record schemas; a pre-scan of node kinds (an unknown one not declared in `requires` is a writer bug and gets the "newer Pavé" message, never a schema dump); `migrateDesign`; cross-references.
9. History: order, then replay from `history/base.json` to `design.json` (4.4).
10. Display mesh caps and hash (4.6).
11. One transaction, new ids.

Rejected: the strict profile before the version. A later major may relax the profile (ZIP64 for very large pieces), and the old reader must still say "update".

### 4.2 Carrying what a reader does not know

v1 strips unknown fields (Zod's default [V]) and refuses unknown entries (rows 1, 3, 4), so an older build would lose a newer file's data without a word.

**Decisions.**
- **Geometry is never carried blind.** Anything that changes the shape is a `requires` feature, so an older reader refuses instead of building the wrong ring. `freeform-cad.md`'s "no schema version bump" is right for the database and wrong for files: under it a v1 reader fails on a `loft` with a validation error.
- **Unknown entries** under `ext/<reverse-dns>/<name>` (`ext/[a-z0-9.-]{3,64}/[a-z0-9._-]{1,64}`), and any other name that passes the safe grammar (lower-case ASCII segments, at most four deep, no dot-only segment) **and** is listed in the manifest, are stored as `piece_attachment` rows and written back on the next Working or Share save. One whose `dependsOn` is `design` is dropped once the piece's version passes `at_version` (PNG's safe-to-copy rule; openNURBS keeps unknown user data the same way [V]).
- **Unknown fields** in a known record: `residue(raw, parsed)` is what the raw JSON had and the schema parse dropped (objects walked by key; arrays of objects matched by `id`). It is kept in `piece.file_extra` under the record's new id and merged back under the known fields on save. A node's residue goes when the node is deleted.
- **Unknown enum values degrade where the meaning allows:** asset kind → `document`; rights → `viewOnly` (the most restrictive); piece kind → `other`. An unknown op type drops the history with a note; the design still opens. An unknown node kind refuses (step 8 of 4.1).
- Clean copies carry nothing unknown.

Rejected: loose Zod objects everywhere (changes every design type); an `ext` column on each table (four migrations for one result).

### 4.3 Exact geometry: none in the file

v1 writes `geometry/exact.step`, never reads it back, and waits up to 90 s for it (`save.ts`). Anyone can rename the file to `.zip` and take the paid export.

**Decision: version 2 holds the design and a display mesh, and no exact geometry.** Step 1 stops writing the STEP entry; readers drop it from old files. The pricing model stays whole: the free file holds the recipe and a mesh (the same class of data as the free STL); the paid exports are what the server produces on request: named solids in STEP, layers and curves in `.3dm`, checks passed. A user's own imported STEP in a `brepBody` node travels as an ordinary asset: it is theirs and import is free.

Rejected: an OpenCascade BREP cache (a speed bump only: the format is public and other tools read it [V]); an encrypted cache (the key would sit in an app on the user's machine). Honest limit, from the research: while the app runs on the user's laptop the plan check is a local setting, so the file is not the weakest link; the gate becomes real when exports run on the hosted service. The spec carries one sentence: reading and writing is free; rebuilding exact geometry from the design to avoid the paid export breaks the terms. **Gate:** step 11 measures cold open on the 2023 MacBook Air; a cache is reconsidered only if the exact rebuild of the reference ring takes over 20 s [E].

### 4.4 Profiles and history

v1 writes every change with user ids, run ids and exact times and cannot leave the history out (row 8). Stone nodes also hold `sourcing` with supplier, SKU, price and certificate (`packages/schema/src/design/nodes.ts`), so a v1 file hands a manufacturer the stone's cost.

**Decision: one format, three writers** (3.1; precedents: Rhino's save options, Figma's history-free local copy [V]). One function, `applyProfile`, does all filtering; the summary and the file are both built from its output, so the sheet cannot promise what the file does not do.

- **Segments.** History is written in fixed segments after `history/base.json`. Past 100,000 changes the writer keeps the newest 100,000, sets `firstSeq`, drops revert links that point before it, and says so in the summary. The base is computed by applying inverses backwards from the current design.
- **Replay.** The reader replays the kept changes from the base. If the result equals `design.json`, `historyVerified` is true. If not, or with no base, the piece still opens and undo works as in v1 (guarded `applyOps`), but the history is never eligible for learning.
- **Redaction is consistent.** `redactOps` removes the same keys from ops, inverses, base and design, so a Share copy's history still replays (section 5).
- **Clean copy:** no history entries; the opener writes one system change, "Opened from a clean copy". A new `document.id`.

### 4.5 Learning from edits, and consent

The founder's model: the file is free because Pavé learns from how people edit. `05-platform.md` §4 decided the opposite default: use for evaluation or training is opt-in for each organisation, off by default (`org_settings.allow_eval_use` exists). **These conflict and this plan does not pick.** Either answer is a config value:

- Learning reads the **op log and traces on the server**, never files. No file feature uploads anything.
- `learningAllowed(org, plan)` is the only gate. `opt-in`: the organisation's switch. `with-free-plan`: always on for Free, the switch on Pro; this value needs a sentence at sign-up, which is the founder's and counsel's text.
- The file records the author's answer at save time in `history.learning`. **Consent travels with the author, not the opener.** A history that arrives in a file is eligible only if all four hold: the flag is `allowed`, the file is signed by a known key, `historyVerified` is true, and the opening organisation's own gate is on. An unsigned history is text anyone could forge to poison training data.
- Honest limit: a local install sends nothing anywhere. Under either answer nothing is learned until the product is hosted or an upload is built; neither is in this plan.

### 4.6 The display mesh

**Decision: GLB with `EXT_meshopt_compression`, stones as `EXT_mesh_gpu_instancing`, materials through the ratified KHR extensions** [V]. three.js lists both extensions as built in and needs a decoder set for meshopt [V] ([GLTFLoader](https://threejs.org/docs/pages/GLTFLoader.html)). The encoder is the `meshoptimizer` npm package, MIT [V] ([js README](https://github.com/zeux/meshoptimizer/blob/master/js/README.md)). Draco is rejected: such codecs reorder vertices and indices [V].

- **Trap, verified:** the JS encoder's default vertex codec is version 1, which does not match `EXT_meshopt_compression`; use `encodeGltfBuffer` (version 0 by default) [V]. Never call `reorderMesh`: it changes vertex and index order [V], and `freeform-cad.md` maps faces to triangle ranges. A test decodes and compares triangle order.
- **Making it pay.** The mesh's manifest row records the design hash it was built from. The reader keeps the mesh only when that equals `design.sha256`; the viewport shows it until the first evaluation is ready or the piece's version changes.
- **From strangers:** the GLB JSON is parsed with caps (accessor counts, buffer sizes, triangles) before storing. It is decoded only in the browser. Nothing from a file is ever fed to the kernel.

### 4.7 Thumbnails and OS previews

`thumbnails/thumbnail.png`: 512 px, PNG, stored, third. Windows caches up to 1024 px and never scales up [V], so v1's 256 px WebP is too small. `sharp` re-encodes it from the cover with metadata stripped. With no cover, the studio captures the viewport through the existing auto-cover path first.

Finder and Explorer previews need an installed helper: a Quick Look extension inside an app on macOS, an `IThumbnailProvider` on Windows [V]. A web app cannot register one. **Decision: build no handler now; make one trivial later.** With a stored third entry and no data descriptors, a handler reads two local headers and copies PNG bytes; `readThumbnail` is that code.

### 4.8 "Saved here", signing and provenance

**Finding 1 (row 10).** `runtime.ts` computes one HMAC of the organisation id, the same in every file, and `open.ts` keeps a rights attestation when it matches. One file from an organisation lets anyone stamp a crafted file as "saved here"; the value also links that organisation's files. Step 2 fixes it in v1's shape; version 2 does this:

**Decision: two proofs, both bound to the content.**
- **Seal** (`signatures/seal.mac`, Working and Share): `HMAC-SHA-256(key, orgId ‖ SHA-256(manifest.json))`, key from `runtime.deriveKey('pave-file-seal')`. It cannot be copied to other content, and two seals cannot be linked without the key. "Saved here" means the seal verifies, compared in constant time. If the auth secret is rotated, old files read as saved elsewhere: the safe failure.
- **Signature** (`signatures/manifest.sig`, optional): Ed25519 over the manifest bytes, with the key id and public key [E]. One key for each organisation, its seed from `deriveKey('pave-file-sign:' + orgId)`, its public half kept in `file_signing_key`. Web Crypto has Ed25519 from Chrome and Edge 137, Firefox 129 and Safari 17 [V] ([caniuse](https://caniuse.com/mdn-api_subtlecrypto_verify_ed25519)); the server verifies in any case. A signature links an organisation's files to each other, so it is **on in Working copies, a tick in Share copies, never in Clean copies**.
- The **attestation** travels only in Working copies and is honoured only when the seal verifies. Share and Clean copies carry `attested: true|false`; someone at the opener confirms again.

### 4.9 Files from strangers

- **Finding 2 (row 11): `thumbUrl`.** A remote thumbnail URL survives save and open, and `ReferencePanel.tsx` shows it when there is no asset, so a stranger's file can make the studio call their server. Decision: never written; nulled on open and in the v1 migration (step 3).
- **Finding 3 (row 9): limits on save.** `save.ts` never consults `PAVE_LIMITS`, so a long-lived piece can be saved into a file nothing opens. Decision: the writer runs the reader's `checkLimits`, leaves out what does not fit with a note, and reads back its output (step 4).
- **Zip and JSON:** the strict profile (3.2) removes the cases where two tools read the same bytes differently (row 13). JSON: a size cap for each entry, depth at most 64, no duplicate keys, own-property lookups only.
- **Code:** none, ever: no scripts, formulas, macros or plug-in binaries; `ext/` is inert bytes. **Links:** none is followed on open; a click opens `http` or `https` only.
- **Pictures:** decoded in the browser or by `sharp`, never a system previewer; served with `nosniff` and the sandbox policy (`http/assets.ts`, kept); EXIF stripped in Share and Clean copies.
- **Memory (row 12):** entries are inflated on demand; the server opens at most two files at once [E].

### 4.10 Open or closed

Precedents [V]: 3MF, glTF and Sketch published their formats; Figma's file is closed and third parties read it anyway. A closed `.pave` would not be secret: it is JSON in a zip.

**Decision (recommended, and cheap to reverse): publish the envelope first.** The spec text (`docs/spec/pave-file-envelope.md`: container, manifest, features, thumbnail, display mesh, facts, provenance, `ext/` rules, the sentence of 4.3) is written in step 14 either way, because builders need it. `@pave/file` imports nothing proprietary, so publishing is a copy plus licence files. `design.json` is "readable, not promised stable" until the freeform schema settles. **If the founder says closed, only the publication half of step 14 is skipped.** Proposed licences: Apache-2.0 for the reader, CC BY 4.0 for the text. Publishing a file spec does not change the product's own licence, which stays proprietary.

New dependencies: `meshoptimizer` (MIT [V]); `fast-check` for property tests (MIT [E], dev only; check at install). Nothing GPL, no paid service.

### Decisions that are the founder's

1. **Exact geometry in the file.** Recommended: none; the exact export stays paid; revisit a cache only if the step 11 gate fails.
2. **Learning and consent.** Is learning a condition of the free plan (said at sign-up) or opt-in for each organisation (today's decision)? Recommended: keep opt-in until the product is hosted and counsel has read the sign-up sentence. And: may Pavé learn from a history inside another organisation's file? Recommended: only under the four conditions in 4.5.
3. **Open or closed spec.** Recommended: publish the envelope now, the design schema after freeform settles; Apache-2.0 and CC BY 4.0.
4. **The default copy and what Share strips.** Recommended: Share first, with pseudonyms, day-level dates, and no prices, suppliers, prompts or brief.
5. **Names.** Keep `.pave`? Neither the research nor this plan checked for a clash. The media type and type identifier need the company's legal name and domain.
6. **Signing.** Recommended: on for Working copies, a tick for Share, off for Clean; a registry of known keys only when hosted.
7. **A piece whose artwork rights are unconfirmed.** Recommended: saved without thumbnail or mesh, as v1 does for geometry.

## 5. Verification

- **Golden files** (`packages/file/fixtures/golden/`): `v1/` is written by the *untouched* v1 writer in step 1 (a template, an edited piece with pins and shots, a piece from artwork; with the STEP entry, a `thumbUrl` and the static fingerprint). `v2.0/` gains one file for each profile and feature, with its expected design and facts. Every build opens all of them; with injected time and ids the v2 files are compared by bytes.
- **Old readers on new files.** Step 1 bundles the fixed v1 reader as `fixtures/readers/v1.mjs`; each released minor freezes its reader the same way. CI runs every golden file through every frozen reader; the expected result comes from the manifest alone: opens, or `newer_pave_file`. Synthetic futures run against the current reader: major 3 with unknown entries and another media type; `minReaderVersion [2, 9]`; an unknown `requires`; an unknown `uses` (must open).
- **Round trip of the unknown:** a file with an `ext/` entry, an unknown safe entry and unknown fields in every record is opened and saved; the unknowns come back equal. Property: `mergeUnder(parse(raw), residue(raw, parse(raw)))` equals `raw`.
- **Torture corpus** (generated by `fixtures/torture.ts`): the list in research 17 §6 (bomb, overlaps, bad names, header disagreement, ZIP64, data descriptors, a fake end record, stray bytes, 65,535 entries, deep JSON, bad UTF-8, a history that does not replay), plus duplicate JSON keys and an over-size GLB accessor. Each is refused with its own sentence; nothing is written.
- **Fuzzing in CI** (`fast-check`, a fixed seed plus a nightly random one): on mutated golden files the reader either opens to the expected design or throws `PaveRefused`; never another exception, a database write, or an allocation above the limits. **Differential:** our entry list equals `fflate.unzipSync`'s on every golden file, and `unzip -Z1`'s where that tool is installed.
- **Writer and limits** (property): whatever the piece (up to 120,000 generated changes, an over-size picture), the writer's output passes `checkLimits` and opens.
- **Profiles:** a Share and a Clean copy of a fixture piece are searched as raw bytes for every user id, run id, supplier, SKU, price, prompt and exact timestamp in the fixture: none may appear. `redact(replay(base, ops))` equals `replay(redact(base), redact(ops))`.
- **Benchmarks on the 2023 MacBook Air, pass marks [E]:** probe of a 50 MB file under 50 ms; Share-copy save of the reference pavé ring under 3 s plus mesh time; open to a visible mesh under 1 s after upload; that file under 3 MB; cold exact rebuild recorded for the 4.3 gate.
- **Review lenses:** security and privacy (forge "saved here", make the app call out through a file, find an identity in a Share copy); the compatibility matrix; the founder's first hour in a browser; premium design.
- **By hand, for the founder:** save a ring as each copy type; rename a Share copy to `.zip` and look inside (no names, no prices, no STEP); open it and watch the mesh appear before the rebuild; open the "from the future" sample; open a Working copy and see "Saved here".

## 6. Scope cuts

| Not in this plan | Picked up when |
|---|---|
| OS thumbnail and Quick Look handlers; the type declaration | a desktop shell exists (`05-platform.md` §1) |
| An exact (BREP) cache | the step 11 gate fails and the founder agrees |
| Milestones-only history | the product has named versions |
| Updating a piece in place from a returned file (same `document.id`) | a manufacturer round trip is asked for; until then the card says "a newer copy of *X*" |
| The learning pipeline and any upload from local installs | hosting, after decision 2 |
| Known-signer registry across installs; the service's counter-signature | hosting |
| Encryption inside the file | never; wrap the whole file outside the format (OPC's rule [V]) |
| Renders, conversations and traces in the file | renders: a customer asks; the rest: never |
| A memory-limited worker for opens; open-rate limits | hosting (`deploy-and-durable-jobs.md` stage 3) |
| Quantized meshes; reusing unchanged history segments | measured size or save time demands it |
| Publishing the design schema | the freeform build's eight steps are done |

## 7. Build order

Steps 1 to 4 are the urgent fixes to v1, wanted before any build reaches a user. Each step writes its tests first and leaves a handoff note. Effort is builder time [E]; every step ships alone.

1. **Freeze v1, fix the order, drop the STEP.** First commit `v1/` golden files from the untouched writer (under `apps/server/src/pavefile/fixtures/` until step 5). Then: read `manifest.json` and the version before the name and media-type checks; stop writing `geometry/exact.step` (old files with it still open); bundle the fixed reader as `readers/v1.mjs`. *Files:* `pavefile/{open,save,zip}.ts`, `files/pave.ts`, `docs/pave-file.md`. *Tests:* a format-2 file with an unknown entry and another media type gives `newer_pave_file`; a saved file has no STEP entry and the engine is asked for `glb` only. *Done means:* the v1 suite is green with only those expectations changed. Half a day. Depends on nothing.
2. **Finding 1: "saved here" bound to the content.** *Failing test first:* copy `save.org` from a saved file into a crafted file with a forged attestation and open it at home; today the attestation survives. *Fix, in v1's shape:* `save.org` becomes `HMAC(key, orgId ‖ fileId ‖ SHA-256(canonical files table))`, checked on open in constant time (`runtime.ts`, `pavefile/{save,open}.ts`, new `seal.ts`). *Done means:* the forged file opens as saved elsewhere, an honest one as saved here, and two files of one organisation share no value. Half a day. After 1.
3. **Finding 2: no remote thumbnails.** *Failing test first:* a file whose pin has `thumbUrl: https://tracker.example/p.gif` and no asset still has it after open. *Fix:* never write it; null it on open; a pin without a picture shows its title and credit on a neutral tile (`ReferencePanel.tsx`); links in file-opened pieces are text until clicked. *Done means:* an e2e run that opens that file makes no request outside the origin. Half a day. After 1.
4. **Finding 3: the writer obeys the limits.** *Failing test first:* a piece with 100,001 changes saves and then cannot be opened. *Fix:* shared `checkLimits`; oldest history and over-size pictures left out with a note; compact history JSON; read-back. *Done means:* the writer property test of section 5 passes at v1. One day. After 1.
5. **`@pave/file`.** Move the zip code; strict reader (3.2); own writer; `probe`; `limits`; Web Crypto hashing. Still writes v1. *Tests:* the zip half of the torture corpus; byte positions of `mimetype`; the differential test. *Done means:* the server and a browser test both import it; `zip.ts` is gone. Two days. After 4.
6. **Format 2.** Manifest (3.3); layout (3.1) with every save a Working copy and the mesh as today; the writer writes one history segment and the reader accepts any number, with or without a base; `featuresOf`; the reader order of 4.1; `migrate-v1.ts`. *Tests:* v1 goldens open to their expected designs; first v2 goldens; the frozen v1 reader says "update" on every v2 golden; synthetic futures; the `NODE_KINDS` feature test. Three days. After 5.
7. **Carry the unknown.** `carry.ts`, the database migration (3.7), attachments, enum degrading. *Tests:* round trip of the unknown; the residue property. Two days. After 6.
8. **Profiles and the save sheet.** `applyProfile`, pseudonyms, redaction, `pieces.describeFile`, `SaveSheet.tsx`, `history.learning`, `learningAllowed`, the Privacy switch on the existing setting. *Tests:* the raw-byte search; the redaction property; the summary equals the file; screenshots. Three days. After 6.
9. **History segments, base and replay** (`history.ts`). *Tests:* 120,000 changes; a forged history is unverified; undo works after open. Two days. After 8.
10. **Thumbnail and the open card.** 512 px PNG third; `readThumbnail`; `OpenCard.tsx` reading locally; the update message; `document.id` ("a newer copy of *X*"). *Tests:* the picture is read without inflating; e2e of the three card states. Two days. After 6.
11. **Display mesh.** `glbDisplay.ts`, caps, `piece.preview_mesh`, the viewport shows it until evaluated; the benchmarks and the 4.3 gate. *Tests:* triangle order survives; a wrong design hash is ignored; an over-size accessor is refused; three.js loads the fixture. Three days. After 6.
12. **Seal and signature in `signatures/`.** Move the step 2 seal; Ed25519 signing and verifying; `file_signing_key`; the origin line on the card; the attestation rule of 4.8. *Tests:* step 2's forgery at v2; one changed byte breaks the signature. Two days. After 8 and 10.
13. **Corpus and fuzzing in CI.** The full torture generator, the fuzz job, the frozen-reader runner as a script. *Done means:* the job fails on a planted regression of each kind. Two days. After 9, 11, 12.
14. **The spec, and publication if the founder says open.** Write `docs/spec/pave-file-envelope.md`; rewrite `docs/pave-file.md`. Only if open: licence files, a public copy of `@pave/file` with its golden files, and (after decision 5) the IANA registration and final media type. *Done means:* a fresh agent given only the spec writes a reader that lists a golden file's title, thumbnail and facts. Two days. After 13.
15. **The assistant.** `pieces.describeFile` as a tool; `pieces.saveFile` as an approval-only tool that refuses a Working copy; the tool-list snapshot. *Test:* a replay where the assistant asks who the file is for, then waits on the approval card. One day. After 8.

Each freeform step (`freeform-cad.md` steps 1 to 8) that lands after step 6 adds its feature (3.4) and one golden file.
