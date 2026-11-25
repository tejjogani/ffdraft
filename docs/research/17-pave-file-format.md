# 17 — The native Pavé file (`.pave`): what v1 is, what other formats teach, and a v2 proposal

Research date: 2026-11-25. Scope: the native file. What the first version on the assistant build branch contains and where it is weak; lessons from 3DM/openNURBS, STEP, STL, 3MF, glTF, USD and from document formats built as a zip with a manifest; a concrete proposal for what goes inside, the container, versioning, an open or closed specification, and security for files from strangers. Builds on: [`01-cad.md`](./01-cad.md) (export matrix), [`05-platform.md`](./05-platform.md) §4 (op log, traces, privacy switches), [`docs/plans/freeform-cad.md`](../plans/freeform-cad.md) (how freeform geometry and history are stored), `packages/kernel/src/export/`, and the v1 code read at `/home/claude/ref/assistant-build`.

**How to read the evidence.** `[V]` = I opened the page this session and the claim is on it; the link is next to the claim. `[S]` = seen only in a search result list; not opened, or the page refused to open. `[E]` = my own estimate or working knowledge; I say what it rests on. Facts about our own code are given with a file path and were read this session; nothing was run (no `node_modules` on this machine, so no spike was possible). Sizes and timings are `[E]` throughout: nobody has measured a real `.pave` file yet.

## 1. The short answer

- **v1 is a sound start, and a zip with a manifest is the right container. Keep it.** v1 already does the hard hygiene well: `mimetype` first and uncompressed, a fixed list of allowed names, size limits checked before and during unpacking, a SHA-256 for every entry, a transaction on open. The same shape is used by 3MF, EPUB, ODF, Sketch, FreeCAD and USDZ.
- **v1 is an export package, not yet a format that can evolve.** Three things would hurt as soon as a second version exists:
  1. **Old readers cannot skip what they do not know.** The docs say adding an entry or a field is not a breaking change, but the code refuses any unknown entry name, rejects any new enum value (a new node kind, a new geometry type), and drops unknown fields. The freeform plan adds about ten node kinds with "no schema version bump"; a v1 reader will fail on those files with a validation error, not with "update Pavé".
  2. **The reader checks names before it checks the version**, so a future file gets the wrong error message.
  3. **Nothing says what a reader must understand** (no minimum reader version, no feature list).
  These are cheap to fix now, before any build reaches a user, and expensive later.
- **v1 puts a plain STEP file in an ordinary zip.** Anyone can rename `.pave` to `.zip` and take the exact solid, so the paid STEP export is bypassed with no skill. The file is also never read back: opening rebuilds from the design. **Recommendation: remove `geometry/exact.step`.** Keep the design as the truth and the mesh for preview. If measured open times later need an exact cache, store OpenCascade's own BREP, as a cache only. That is a speed bump, not protection: OpenCascade is open source and FreeCAD reads BREP.
- **Be honest about the paid line.** While the product runs on the user's own laptop, the plan check is a setting on that laptop. The file is not the weakest link. The paid exports are protected by convenience, quality (layers, names, validation), licence terms and, later, the hosted service. Do not spend engineering on encryption inside the file.
- **The edit history is the valuable and the sensitive part.** v1 writes every change with user ids, assistant run ids and timestamps, and offers no way to leave it out. Proposal: three save profiles (**Working copy**, **Share copy**, **Clean copy**), authors replaced by per-file pseudonyms outside the working copy, and a consent flag in the file that says whether its history may be used for learning. Learning itself happens from the op log on the server, not from files; a history that arrives in a file from elsewhere is unverified and must not be learned from unless it is signed and flagged.
- **Open or closed: publish the outer layer now, the design schema later.** Publish (permissive licence, small TypeScript reference reader) the container, manifest, thumbnail, display mesh, facts and provenance, so any tool, marketplace, ERP or OS can preview and catalogue a `.pave` file. Keep the design document "readable but not promised stable" until the freeform schema settles, then publish it too. A closed format would not be secret anyway: it is JSON in a zip.
- **Three security findings in v1** (section 8): the "saved here" proof can be copied from any file of the same organisation, which lets a crafted file keep a rights confirmation; a reference's remote thumbnail URL survives opening, so a stranger's file can make the app call a server of their choice; the writer does not enforce the reader's limits, so a long-lived piece can be saved into a file that will not open.

## 2. What v1 is, exactly

### 2.1 Where it lives

The contract (names, limits, schemas, MIME type, version) is `packages/schema/src/files/pave.ts`. The server writes and opens files in `apps/server/src/pavefile/` (`save.ts`, `open.ts`, and `zip.ts`, an own central-directory parser on top of `fflate`). The commands are `pieces.saveFile` and `pieces.openFile`; they are not assistant tools. The studio offers save, open and drop-anywhere in `apps/studio/src/features/pavefile/index.ts`. The design document, its ops and `migrateDesign` are in `packages/schema/src/design/design.ts`. `packages/schema/src/plans/config.ts` lists `.pave` as unlimited on Free and Pro; only renders and Rhino/STEP exports are counted. The human-readable description is `docs/pave-file.md`.

`apps/server/src/traces.ts` (threads, runs, steps, messages, feedback) is **not** written to the file. The only trace of the assistant in a file is the `actor` on each change.

### 2.2 What is inside

A zip, deflate or stored only, no ZIP64, no encryption, fixed names. Format version 1. MIME `application/vnd.pave.piece+zip`.

| Entry | Content | Notes |
|---|---|---|
| `mimetype` | the MIME string | first, stored |
| `manifest.json` | `format`, `formatVersion`, app name and version, created/modified/saved times, this save's "hop" (`fileId`, `pieceId`, org fingerprint), up to 31 earlier hops, title and kind, counts of contents, and size + SHA-256 of every other entry | |
| `checksum.sha256` | SHA-256 of `manifest.json` | detects damage, not tampering |
| `piece.json` | title, kind, stage, brief (up to 200,000 characters), spec, **the design document**, its version, cover, cached facts (metal mass, carats, stone count, metal), origin with any rights attestation, **directions each with a full design**, chosen direction | |
| `history.json` | **every change**: `id`, `seq`, `ops`, `inverse`, `actor` (user id, or assistant `runId`, `toolCallId`, `model`), `userId`, label, time, `reverts` | up to 100,000 changes |
| `references.json` | the pin board and its pins: source URL, credit, licence, rights, tags, palette, generation record (prompt, model, seed), canvas placement, image plane, `thumbUrl` | |
| `shots.json` | saved shots with the full render scene (camera, look, lights, motion, output) | |
| `assets.json`, `assets/<sha256>.<ext>` | pictures, content-addressed; only those whose rights are `open` or `own` travel | |
| `thumbnails/cover.webp` | 256 px WebP of the cover, when the cover travels | |
| `geometry/exact.step` | the exact solid as STEP | written by the geometry service without claiming an export |
| `geometry/display.glb` | display meshes with stones and materials, uncompressed | |

Save waits up to 90 s for the two geometry entries and saves without them on a slow machine (`save.ts`, `GEOMETRY_BUDGET_MS`). Geometry is also left out when the piece comes from artwork whose rights nobody has confirmed.

Open does, in order: zip limits and the name allow-list; `mimetype`; the manifest checksum; the format version (newer refused); manifest schema; every entry's size and hash; file migrations (none yet); schemas for every record; `migrateDesign`; cross-reference checks; then one transaction that writes everything under new ids. **Opening never reads the STEP or the GLB.** A piece opened from a file gets a `provenance` record; a rights attestation is kept only if the file's org fingerprint equals this install's.

### 2.3 What is missing or risky

| # | Weakness | Where | Why it matters |
|---|---|---|---|
| 1 | Unknown entries refuse the whole file | `isPaveEntryName` in `pave.ts`; called first in `open.ts` `readFile` | The docs promise that adding an entry is not a version change. In code it is. No reader in the field can ever be sent a new entry. |
| 2 | Names are checked before the version | `open.ts`: `readZip(..., isPaveEntryName)` runs before `formatVersion` is read | A v2 file opened in a v1 build says "contains an entry … a .pave file never has" instead of "update Pavé". |
| 3 | New enum values fail validation | `PaveManifestSchema.contents.geometry` (only `step` or `glb`), `PIECE_KINDS`, `ASSET_KINDS`, `RIGHTS`, op type `t`, node kinds, `schemaVersion: z.literal(1)` | The freeform plan adds node kinds without a version bump. Old readers will reject those files with a schema error. |
| 4 | Unknown fields are dropped | Zod `z.object` strips unknown keys by default [V] ([Zod API](https://zod.dev/api)); open imports into the database and discards the file | A file saved by a newer build, opened and re-saved by an older one, silently loses data. |
| 5 | No "what a reader must understand" | manifest has only `formatVersion` | No way to say "needs freeform curves" or "minimum reader 2.3". |
| 6 | Exact geometry as plain STEP | `geometry/exact.step` | Bypasses the paid STEP export by unzipping. `docs/pave-file.md` says so itself. |
| 7 | Geometry entries are write-only | `open.ts` never reads them; no design hash or kernel version ties them to the design | The largest entries cost up to 90 s at save and give nothing at open. No "instant preview" yet. |
| 8 | History is all or nothing, with identities | `history.json`; `actor.id`, `userId`, `runId`, `toolCallId`, `model`, exact times | No clean copy, no consent, no pseudonyms. A manufacturer who receives a file sees who did what, when, and how much the AI did. |
| 9 | Writer does not enforce reader limits | `save.ts` never consults `PAVE_LIMITS` | A piece with more than 100,000 changes, or a history over 32 MB of JSON, saves fine and then cannot be opened anywhere. |
| 10 | "Saved here" is a static fingerprint | `runtime.ts`: HMAC of the org id, same value in every file; `open.ts` keeps the attestation when it matches | Anyone holding one file from an organisation can stamp that value on a crafted file. If someone in that organisation opens it, a forged rights confirmation is accepted. The value also links all of an organisation's files, and it changes if the auth secret is rotated. |
| 11 | Remote thumbnail URLs survive | `ReferenceSchema.thumbUrl` is written and restored; `ReferencePanel.tsx` shows it when there is no asset | Opening a stranger's file can make the studio fetch a URL of their choice (a tracking pixel: IP address, time). |
| 12 | Whole file and all entries in memory | `readZip` takes a `Uint8Array` and returns a `Map` of unpacked entries: up to 256 MB + 512 MB per open | Fine on a laptop for one user. On a hosted server it is a memory-exhaustion lever. |
| 13 | Zip reader accepts some irregular files | `zip.ts`: local header size and method are not compared with the directory; overlapping entries, leading or trailing bytes and a non-empty comment are allowed; `mimetype` need not be first or stored | Not exploitable today because of the limits and the hash check, but other tools may read the same bytes differently. A strict profile is cheap. |
| 14 | No signature | `checksum.sha256` only | Integrity against damage, none against editing. |
| 15 | Thumbnail is small, WebP, and only the cover | `save.ts`: 256 px | Too small for large icons (Windows caches up to 1024 px, §3.9). No OS handler exists yet. |
| 16 | Smaller gaps | manifest and `open.ts` | No units, tolerance or kernel version (millimetres are implied; a cache cannot be judged stale). The chain of `earlier` hops tells a recipient how many organisations handled the piece. No stable document id, so a returned file cannot update the piece that was sent. A new `fileId` and time on every save, so two saves of the same piece cannot be compared by hash. |

Things v1 gets right and v2 should keep: content-addressed assets, the rights rule for pictures (`RIGHTS_THAT_TRAVEL`), attestation not travelling between organisations, chunked inflate with a hard stop, assets served with `nosniff` and a content security policy (`apps/server/src/http/assets.ts`), facts recomputed after open rather than trusted.

## 3. Lessons from existing formats

### 3.1 CAD and mesh formats

| Format | What it is | What to copy | What to avoid |
|---|---|---|---|
| **3DM / openNURBS** | A chunked binary. Each chunk has a typecode and a length, with an optional 16- or 32-bit CRC [V] ([chunk class](https://developer.rhino3d.com/api/cpp/class_o_n__3_d_m___b_i_g___c_h_u_n_k.html)). McNeel gives away a C++ toolkit that reads and writes it, and says neither copyright nor copyleft restrictions apply [V] ([what is openNURBS](https://developer.rhino3d.com/guides/opennurbs/what-is-opennurbs/)). The repository's licence file is a copyright line and a warranty disclaimer, not a named licence [V] ([LICENSE](https://github.com/mcneel/opennurbs/blob/8.x/LICENSE)). The toolkit has no meshing, booleans, intersections or mass properties [V] (same page). | (a) One file carries everything: geometry, layers, materials, units and tolerances, notes, a preview image, plug-in data ([E] for notes and preview: openNURBS property classes; units, tolerances and user strings were checked against `rhino3dm` in `01-cad.md`). (b) Plug-in data is tagged with the plug-in's id. When the plug-in is missing, the bytes are held as "unknown user data" together with the file version they were written in, so the plug-in can read them later [V] ([ON_UnknownUserData](https://developer.rhino3d.com/api/cpp/class_o_n___unknown_user_data.html), [user data guide](https://developer.rhino3d.com/guides/cpp/user-data/)). (c) Save options: **Save small** (drop render meshes), **Save geometry only**, **Save plug-in data** on or off, **Save textures** (embed) [V] ([Save](https://docs.mcneel.com/rhino/8/help/en-us/commands/save.htm)). (d) Current Rhino can save to every earlier version except 1 [V] ([Library of Congress](https://loc.gov/preservation/digital/formats/fdd/fdd000601.shtml)). | There is no written specification. The toolkit source is the only detailed description, and the Library of Congress calls the format "partially disclosed" [V] (same page). That works for McNeel because the toolkit is free and old. It would not work for us: we have no toolkit that people already trust. |
| **STEP** | AP242 replaced AP203 and AP214 and covers their functionality; edition 1 in 2014, edition 2 in 2020, edition 3 a maintenance edition, edition 4 in development [V] ([prostep fact sheet](https://www.prostep.org/mediathek/fact-sheets/iso-10303-242)). It carries exact B-rep, assemblies, colours, names and PMI. | It is the neutral exact hand-off. Every CAD system reads it. | It carries the result, not the recipe: no feature history, no parameters, no constraints [E] (long-standing limit of B-rep exchange; a NIST report on exchanging construction history exists [S] ([NISTIR 7433](https://nvlpubs.nist.gov/nistpubs/Legacy/IR/nistir7433.pdf))). Text encoding is large. It is exactly what the paid export sells, so it must not sit in the free file. |
| **STL** | Triangles with normals, ASCII or binary; first documented by 3D Systems in 1988 [V] ([Library of Congress](https://www.loc.gov/preservation/digital/formats/fdd/fdd000504.shtml)). | Why it is loved: a reader is a page of code, every tool has one, and nothing can go out of date. | No colour or texture [V] (same page); no units, no names, no materials, no topology [E] (the binary layout is an 80-byte header, a count, and 50 bytes per triangle). Each triangle repeats its vertices. |
| **3MF** | A zip following the Open Packaging Conventions. Core spec 1.4.0, February 2025 [V] ([core spec](https://github.com/3MFConsortium/spec_core/blob/master/3MF%20Core%20Specification.md)). Published as ISO/IEC 25422:2025; royalty-free; the consortium is a Linux Foundation affiliate project [V] ([3mf.io/spec](https://3mf.io/spec/)). Extensions: Materials 1.2.1, Production 1.2.0, Secure Content 1.0.3, Beam Lattice, Slice, Boolean, Volumetric, Displacement, Toolpath [V] (same page). | (a) **Two lists of extensions**: a reader must not process a file whose `requiredextensions` it lacks; for `recommendedextensions` it should warn and ask; anything from an unknown namespace must be ignored [V] (core spec). (b) Units stated on the model, millimetre by default [V]. (c) Thumbnails are JPEG or PNG parts found through a relationship [V]. (d) External references are forbidden unless an extension allows them [V]. (e) Deflate or stored only [V]. | XML signatures need canonicalisation [V]; heavy for us. Content types and relationship parts add indirection that a fixed-name layout does not need. |
| **glTF 2.0 / GLB** | JSON plus binary buffers; GLB is a 12-byte header and chunks [V] ([spec](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html)). Metres, +Y up [V]. | (a) `asset.version` and `asset.minVersion`; minor versions must be readable by older 2.x clients, which ignore what they do not know [V]. (b) `extensionsUsed` versus `extensionsRequired` [V]. (c) **All the gem and metal material extensions we need are ratified**: transmission, volume, ior, dispersion, iridescence, anisotropy, clearcoat, sheen, specular, emissive strength, variants; also Draco, mesh quantization, Basis textures, XMP metadata; and, listed in the same ratified section, `EXT_meshopt_compression`, `EXT_mesh_gpu_instancing`, `EXT_texture_webp` [V] ([extension registry](https://github.com/KhronosGroup/glTF/blob/main/extensions/README.md), read 25 Nov 2026). | Not ratified yet: `KHR_materials_diffuse_transmission` (release candidate) and `KHR_materials_subsurface` (initial draft) [V] (same page). Those are the ones opal, jade and pearl would want; do not depend on them. |
| **USD / USDZ** | Layers composed by a strength order (sublayers, references, payloads, variants) [E] (working knowledge; the glossary page was too long to read to the definitions). USDZ is a zip with **no compression and no encryption**, each file aligned to 64 bytes, so a reader can memory-map the contents without unpacking; it is read-only: to edit, unpack and repackage [V] ([USDZ spec](https://openusd.org/release/spec_usdz.html)). Licence: a modified Apache 2.0 that differs only in the trademark clause [V] ([LICENSE](https://github.com/PixarAnimationStudios/OpenUSD/blob/release/LICENSE.txt)). AOUSD announced Core Specification 1.0 on 17 December 2025; 1.1 is planned for 2026; ISO standardisation is a stated goal, not done [V] ([AOUSD](https://aousd.org/uncategorized/core-spec-announcement/)). | The idea that a package is a **delivery** form and the working data lives elsewhere. That is our situation: the op log in the database is the working store. | Composition is far more than one piece of jewelry needs. Uncompressed zip is right for memory-mapped binary scene data, wrong for our JSON. |
| JT, Parasolid XT | JT is an ISO visualisation format with a published reference; Siemens documents the XT format [S] ([JT Open](https://plm.sw.siemens.com/en-US/plm-components/jt/jt-open-program), [Library of Congress](https://loc.gov/preservation/digital/formats/fdd/fdd000562.shtml)). | A kernel-native exact format (XT) is what Onshape- and SolidWorks-class tools store. | Our kernel's native format is OpenCascade BREP, which is open (§7.2). |

### 3.2 Zip-with-manifest document formats

| Format | Lesson |
|---|---|
| **OPC / OOXML** | A mandatory content-types part maps parts to MIME types; relationships make every part discoverable from the root; only deflate; zip encryption is not allowed inside the package (encrypt the whole file instead); its own signature scheme; DTDs are banned to stop entity-expansion attacks [V] ([Library of Congress](https://www.loc.gov/preservation/digital/formats/fdd/fdd000363.shtml)). |
| **ODF** | `mimetype` first, uncompressed, with no extra field, so that `PK` is at byte 0, the word `mimetype` at byte 30 and the type at byte 38, and a plain magic-number tool can identify the file. The manifest lists every file. A `Thumbnails/thumbnail.png` is recommended; desktops show it within 256×256. Encrypted documents must not carry a real preview. Its own encryption defaults are old (Blowfish, SHA-1, 1024 rounds) [V] ([ODF 1.3 part 2](https://docs.oasis-open.org/office/OpenDocument/v1.3/os/part2-packages/OpenDocument-v1.3-os-part2-packages.html)). |
| **EPUB** | Same `mimetype` rule as ODF [E] (the EPUB 3.3 page was too long to reach the container section; the rule is long-standing). |
| **Sketch** | A zip of JSON: `meta.json`, `document.json`, `user.json`, `pages/`, `images/`, `previews/`. Sketch published a JSON Schema and TypeScript types so that others can read and write documents without the app [V] ([Sketch developer docs](https://developer.sketch.com/file-format/)). Separating `user.json` (viewport, panels) from the document is worth copying: view state is not design. |
| **Figma** | A local copy (`.fig`) can be saved on all plans, but it has **no version history and no comments**, and Figma calls the format proprietary, liable to change, and advises against third-party tools [V] ([Figma help](https://help.figma.com/hc/en-us/articles/8403626871063)). An independent parser's author calls it an unstable internal detail [V] ([fig file parser](https://madebyevan.com/figma/fig-file-parser/)). Several third-party parsers exist anyway [S]. Lesson: closed did not mean unread; the lock-in is the cloud, not the file. |
| **SQLite as a file format** | The SQLite authors' case: no parser to write, one file, atomic commits, only changed pages are written, new tables extend the format, content is queryable; a zip must usually be rewritten whole to change one part; an SQLite archive of compressed files is within about 1 % of the zip's size [V] ([appfileformat](https://www.sqlite.org/appfileformat.html)). For untrusted files they recommend turning trusted schema off, disabling triggers and views if unused, running an integrity check first, cell-size checking, and no memory mapping [V] ([security](https://www.sqlite.org/security.html)). In browsers it needs the WASM build; the persistent options need a worker and, for the fullest one, cross-origin isolation headers [V] ([persistence](https://sqlite.org/wasm/doc/trunk/persistence.md)). |
| **Blender `.blend`** | A dump of memory structures plus a `DNA1` block that describes every structure's fields, so any version can map old data onto new structures at load time. Fast to save, self-describing, poorly documented, and compatibility lives in ever-growing loader code [V] ([The mystery of the blend](https://projects.blender.org/archive/blender-archive/raw/commit/41f8f08e5188ed3d859c8e896ce700cb15ddf67b/doc/blender_file_format/mystery_of_the_blend.html)). Lesson: ship the schema version with the data and migrate at load. v1 already does. |
| **FreeCAD `.FCStd`** | A zip with `Document.xml` (the parametric tree), `GuiDocument.xml` (view state), one BREP file per shape, and a thumbnail [S] ([wiki](https://wiki.freecad.org/File_Format_FCStd); the page refused to open). The closest precedent to us: recipe plus cached exact shapes in the kernel's own format. |
| **Onshape, Fusion** | Onshape has no files: every change is an increment in a database, old states are never overwritten, the kernel runs on their servers [V] ([Onshape](https://www.onshape.com/en/blog/how-does-onshape-really-work)). Fusion keeps data in its cloud with a closed archive format [E]. Our hosted mode will look like this internally; the `.pave` file is the promise that a customer can still take a piece away. |

### 3.3 Three rules that carry over

1. **Say what is required and what is optional, per file.** 3MF, glTF and PNG all do it. PNG encodes it in the chunk name: critical or ancillary, and whether an editor that does not understand a chunk may copy it [V] ([PNG](https://www.w3.org/TR/png-3/)).
2. **Carry what you do not understand, unless it depends on what you changed.** openNURBS keeps unknown plug-in data; PNG's safe-to-copy bit says when not to.
3. **Make the outer layer trivially readable.** STL's whole appeal. For us: a picture, a mesh and the facts should be reachable with unzip, a JSON parser and a GLB loader, and nothing else.

## 4. What goes inside a `.pave` file (proposal for v2)

**Save profiles.** One format, three writers. Rhino's Save small / Save geometry only / Save plug-in data [V] and Figma's history-free local copy [V] are the precedents.

| Profile | For | History | Identities | Costs, suppliers | Pins |
|---|---|---|---|---|---|
| **Working copy** | backup, moving between your own machines | full | kept (this org's ids) | kept | all that may travel |
| **Share copy** (default when sending) | a colleague, a manufacturer, a client | full or milestones, as chosen | per-file pseudonyms (`author-1`, `assistant`) | removed | all that may travel |
| **Clean copy** | publishing, strangers | none (one "created" entry) | none | removed | none unless ticked |

**Contents.**

| Item | Verdict | Why, and how |
|---|---|---|
| Manifest | **Include** | `format`, `formatVersion` (integer, the major), `minorVersion`, `minReaderVersion`, `requires[]`, `uses[]` (feature names: `freeform.curves`, `mesh.meshopt` …), writer app and version, kernel versions (OpenCascade build, Manifold), `units: "mm"`, modelling tolerance, document id and revision, save profile, design hash, times, entry table (size, SHA-256, media type, `dependsOn`). |
| Design document | **Include, always** | The parametric schema the repo has. It is the truth. Its own `schemaVersion` stays. Move it to `design.json` so it can be hashed and read alone. |
| Variants (directions) | **Optional** | Each carries a whole design today. Working and share copies only. |
| Edit history | **Optional, by profile** | §4.1. |
| Exact geometry | **Leave out** (optional cache later) | §7.2. |
| Display mesh | **Include** | §4.2. |
| Materials and looks | **Include** | Metals and stones are in the design. Looks and render scenes are small JSON. |
| Shots (camera, lights, motion) | **Include** in working and share copies | Already in v1. Reproducible renders are part of the piece. |
| Renders and takes | **Leave out**; allow chosen finals as attachments later | Large, and they are outputs. |
| Thumbnail and preview | **Include, always** | §4.3. |
| Pins and reference images | **Optional, by rights** | Keep v1's rule. Drop `thumbUrl`. Keep source, credit and licence. |
| Provenance | **Include**, reduced in share and clean copies | Who made it (pseudonymous), which app, AI involvement as a summary (share of changes by people, by the assistant, model names), origin and source images, the rights attestation. Hops: keep only the count and the last hop in share copies. |
| Generation records (prompts, seeds) | **Working copy only** | Prompts can contain client names and briefs. |
| Stone data | **Include** | Cut, size, carat and material are part of the design. |
| Supplier references (listing ids, certificate numbers, stone prices) | **Working copy only**, separate `sourcing.json` | Commercially sensitive. The strategy file already says a quote shows the stone's specification, never its line price or supplier. |
| Production data: weights | **Include** (`facts`) | Derivable from the geometry anyway. |
| Production data: costs, labour, margins | **Working copy only**, separate `production.json` | Sensitive; never in a share copy by default. |
| Assistant conversations and tool traces | **Leave out** | They stay on the server under the organisation's retention setting (`05-platform.md` §4). Briefs and client talk do not belong in a file that travels. |
| View state (camera, panels, selection) | **Optional**, separate `view.json` | Sketch's `user.json` idea: never mixed with the design, never hashed into it. |
| Integrity hashes | **Include** | As v1: SHA-256 per entry in the manifest. |
| Signature | **Optional** | §4.4. |
| Encryption | **Leave out** | OPC forbids zip encryption inside a package and says to encrypt the whole file instead; ODF's built-in scheme has aged badly [V] (§3.2). If a customer needs it, wrap the whole file outside the format. |
| Scripts, macros, plug-in code | **Never** | §8. |
| Third-party or future data | **Allow under `ext/<reverse-dns>/…`** | Carried through open and save (§6). |

### 4.1 The edit history: file versus server

The business model says saving and opening are free because the product learns from how people edit. The learning does not need the file. It needs the op log and the traces, which the server already keeps.

| Captured | In the file | On the server |
|---|---|---|
| Design ops and their inverses, in order | yes (working, share) | yes (system of record) |
| Actor type: person, assistant, system; model name | yes | yes |
| Who exactly (user id), run id, tool-call id | working copy only; pseudonyms otherwise | yes |
| Exact timestamps | working copy; rounded to the day or dropped otherwise | yes |
| Assistant messages, tool inputs and results, feedback (undone, corrected, accepted) | no | yes, under the retention window |
| Interaction telemetry (commands used, time per tool) | no | yes, if consented |

Rules I recommend:

- **Consent lives with the author, not the opener.** The manifest carries `history.learning: "allowed" | "not-allowed" | "unknown"`, set from the saving organisation's setting. A server that opens a file from elsewhere must not learn from its history unless the flag says allowed **and** the file is signed by a known install. Without a signature the history is unverified text: anyone can forge one to poison training data.
- **Clean copy really removes it.** One synthetic change ("created from a clean copy"), no authors, no hops, no generation records, no `ext/`.
- **Segment the history.** `history/000001.jsonl`, `000002.jsonl` …, a few thousand changes each, append-only, with an optional design checkpoint every N changes. Old segments are byte-identical between saves, so they are copied without recompression, a reader can load only the tail for undo, and the writer never produces a history the reader refuses (weakness 9).
- **Milestones option.** Keep named versions and stage changes as checkpoints and drop the ops between them.

`05-platform.md` decided that use for evaluation or training is opt-in per organisation, off by default. The founder's sentence makes learning the reason the file is free. Those two are in tension and need a decision (§9).

### 4.2 Meshes for instant preview

- **Format: GLB.** It is what the viewport, three.js and every viewer already read, and the gem and metal material extensions are ratified (§3.1).
- **Compression: meshopt, not Draco.** Both are in the ratified list [V]. meshopt decodes at 3–6 GB/s and is MIT; its author notes that Draco-style codecs change vertex and index order [V] ([meshoptimizer](https://github.com/zeux/meshoptimizer)). The freeform plan maps picked faces to triangle ranges (`Part.topology`), so order must survive. meshopt is designed to be followed by a general compressor [V], so deflate in the zip still helps. Gems should use `EXT_mesh_gpu_instancing`: a pavé ring is hundreds of copies of a few stones.
- **This is not the mesh sent to Blender.** `packages/kernel/src/export/glb.ts` avoids both codecs because, by its own comment, Blender's importer could not decode them. That stays true for the render hand-off and does not bind the file's display mesh. I did not re-check the Blender claim.
- **Make it useful.** Record the design hash and kernel version next to it. On open, show the mesh at once and rebuild in the background; if the hash does not match the design, ignore it.
- Size [E]: a few hundred kilobytes to about 2 MB for a stone-heavy ring after meshopt and deflate. Measure before fixing limits.

### 4.3 Thumbnails and OS previews

- Write `thumbnails/thumbnail.png`, 512 px on the long side, stored, as the third entry. PNG or JPEG is what 3MF requires and what ODF uses [V]; OS code decodes both everywhere. Optionally `thumbnails/preview.jpg` at about 1600 px for a hover or a marketplace card.
- **Windows** asks a thumbnail handler (`IThumbnailProvider`) for an image, runs it in a separate process by default, caches 32, 96, 256 and 1024 px, and never scales up [V] ([Microsoft](https://learn.microsoft.com/windows/win32/shell/thumbnail-providers)). So 256 px is too small for the largest view; 512 is a fair compromise, 1024 if size allows.
- **macOS** asks an app extension shipped inside an application, chosen by the file's type identifier; with no extension the file shows a generic icon [V] ([Eclectic Light](https://eclecticlight.co/2026/05/18/how-quicklook-provides-thumbnails-and-previews/)). The format's owner declares the type with an exported declaration (reverse-DNS identifier, conformance, extension, MIME type) [V] ([Apple](https://developer.apple.com/library/content/documentation/FileManagement/Conceptual/understanding_utis/understand_utis_declare/understand_utis_declare.html)).
- Consequence: **OS thumbnails need an installed desktop app or helper.** A web app cannot register one. Until a desktop shell exists (`05-platform.md` discusses one), the embedded thumbnail serves the app's own open dialog, the marketplace and third parties. Putting it early and stored means a handler reads a few kilobytes, not the whole file.

### 4.4 Signatures and provenance assertions

- **Now:** replace the static org fingerprint with a proof bound to the content: a MAC or signature over the manifest's SHA-256. The manifest already lists every entry's hash, so signing the manifest covers the file. An Ed25519 signature in `signatures/manifest.sig` with a per-install key is enough [E].
- **Later, hosted:** a counter-signature from the service ("evaluated by kernel X, checks passed") is worth something to a manufacturer.
- **C2PA:** the specification defines embedding in zip-based formats: the manifest store goes at `META-INF/content_credential.c2pa`, stored and unencrypted, with a hash over every other entry and over the central directory. Zip support arrived in version 1.4; signing uses X.509 certificates only since 2.0 [V] ([C2PA 2.3](https://spec.c2pa.org/specifications/specifications/2.3/specs/_attachments/C2PA_Specification.pdf)). Do not build it now, but reserve the `META-INF/` name in the allow-list so it can be added without a format change. C2PA matters more for the renders (images people publish) than for the CAD file.

## 5. Container choice

In this product the working document is the op log in the database (`05-platform.md` §4b). The file is a portable snapshot. That weighs the comparison: incremental save and crash safety are the database's job.

| | Zip + manifest (v1, tightened) | Single SQLite file | Own chunked binary (3DM-style) | Folder bundle |
|---|---|---|---|---|
| Partial reads | Good: directory at the end, then any entry; over HTTP with range requests; fixed early entries for sequential readers | Best: query what you need | Good if chunks have a table of contents | Best |
| Incremental save, autosave | Whole file rewritten [V sqlite.org]; unchanged entries can be copied without recompression | Best: only changed pages | Append chunks possible, needs compaction | Best |
| Crash safety | Write a temporary file, then rename. In browsers a writable file stream is typically written to a temporary file and swapped in on close [V] ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/FileSystemFileHandle/createWritable)) | Built in | Must be designed | Poor: half-written sets of files |
| Size | Good | Same within ~1 % [V] | Best possible | Worst (no compression) |
| Diffability | Unzip, then text diff of sorted JSON | SQL dump | None without tools | Best |
| Merge and collaboration later | Carry document id + revision; merge by rebasing ops on the server, as `05-platform.md` decided | Same | Same | Same |
| Third-party readers | Easiest: every language has zip and JSON | Easy where SQLite exists | Hardest: needs our toolkit | Easy, but it is not one file |
| TypeScript, browser and server | `fflate` today; browsers can inflate natively with `deflate-raw` [V] ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/DecompressionStream/DecompressionStream)) | Needs the WASM build and, for persistence, workers and special headers [V] | All ours to write, fuzz and maintain | Cannot be uploaded, emailed or sent on WhatsApp as one thing |
| Untrusted-file surface | Small and well understood; we own the parser | Larger: schema, triggers, views; needs the hardening list [V] | Entirely ours | Path handling |
| Long-term stability | ZIP and JSON will outlive us | SQLite's format is stable since 2004 [V] | Depends on us | Fine |
| OS thumbnail handler | Read one stored entry | Link SQLite into the handler | Our parser in the handler | Not applicable |

**Recommendation: stay with zip + manifest, defined as a strict profile.** SQLite's real advantages (incremental writes, transactions) are already provided by the database that holds the working document. A custom binary buys speed we do not need and costs the third-party readability we want. Revisit only if a desktop build makes the file itself the working store with autosave into it.

**The zip profile (v2).**

- Entries: stored or deflate only. No ZIP64 while the limits are far below 4 GB, no encryption, no split archives, no data descriptors, empty archive comment, no bytes before the first entry or after the end record.
- Order: `mimetype` (stored, no extra field), `manifest.json`, `thumbnails/thumbnail.png` (stored), then the rest. A sequential reader can stop after three entries.
- Names: ASCII, matched against patterns, never used as paths. v2 adds `ext/…` and `META-INF/…` patterns.
- Reject duplicate names, entries that overlap, and any disagreement between a local header and the directory (name, sizes, method). The overlapping-entry zip bomb reaches ratios in the millions without nesting; deflate alone cannot exceed 1032:1; its author recommends parser limits and, optionally, rejecting overlaps [V] ([Fifield](https://www.bamsoftware.com/hacks/zipbomb/)). v1's limits already bound the damage; the overlap check makes the profile unambiguous.
- Keep deflate. Zstandard has a zip method number [S] and the browser decompression API lists `zstd` [V] (MDN, per-browser support not checked), but OS archive tools and `fflate` do not read it [E], and "any tool can list it" is the point.
- Deterministic output: sorted JSON keys, fixed entry order, entry times set to the save time. The same piece saved twice with the same profile should differ only in the save record.
- Read without loading everything: parse the directory, then inflate entries on demand, hashing as a stream. On the server, cap concurrent opens.

## 6. Versioning and compatibility

- **Three numbers and two lists.** `formatVersion` (integer; changes only when an older reader would misread), `minorVersion` (additions), `minReaderVersion` (the oldest reader that may open this particular file), `requires[]` (features a reader must know), `uses[]` (features it may ignore). This is glTF's `minVersion` and required/used extensions and 3MF's required/recommended lists [V].
- **Reader rule, in this order:** read `mimetype` and `manifest.json` first. If the major is newer, or `minReaderVersion` is newer, or `requires` names an unknown feature: stop with "saved by a newer Pavé (needs X). Update to open it." Only then check names and schemas.
- **A new node kind is a `requires` feature, not a silent addition.** A design that uses `loft` cannot be evaluated by a reader without it. The freeform plan's "no schema version bump" is fine for the database; for files each new family of node kinds needs a feature name.
- **Unknown data is carried, with a rule for when to drop it.** Each manifest entry has `dependsOn: "design" | "nothing"`. Because Pavé imports a file into its database, carrying means: unknown entries under `ext/` are stored as opaque attachments of the piece and written back on the next save; unknown JSON fields are kept (loose objects, an `ext` column). An entry that depends on the design is dropped once the design changes. This is PNG's safe-to-copy idea [V] and openNURBS's unknown user data [V].
- **Unknown enum values degrade, they do not fail**, where the meaning allows: unknown asset kind → `document`; unknown rights → the most restrictive; unknown piece kind → `other`.
- **Migrations:** keep v1's step-per-version functions for the file and for the design. A reader opens every older major. Offer "save as the previous major" for one major back, as Rhino does for all earlier versions [V].
- **Deprecation:** a feature is first marked deprecated in the spec, then no longer written, and readers keep reading it for at least two more majors.
- **Golden files:** commit one real `.pave` per released format version and per feature, plus the expected design and facts. Every build must open all of them. The deterministic writer lets a test compare bytes.
- **Torture corpus and fuzzing:** a folder of hostile files (bomb, overlapping entries, path-like names, duplicate names, header disagreement, ZIP64, data descriptors, an end-record signature inside the comment, leading and trailing bytes, 65,535 entries, deep JSON, huge numbers, bad UTF-8, a history that does not replay to the design). Property-based fuzzing of the zip parser and of each JSON schema in CI. A differential test: our reader and one independent unzip tool must agree on the entry list.

## 7. Open or closed specification

### 7.1 The options and what the precedents show

| Option | Precedent | What it did |
|---|---|---|
| **Published spec, permissive licence, reference reader** | 3MF (royalty-free, ISO) [V]; glTF (the specification may be used without fee; patent reciprocity comes through Khronos's Adopter programme) [V]; Sketch (published schema) [V]; openNURBS (free toolkit, no written spec) [V] | Fast adoption by other tools. 3DM became a trade interchange format because anyone could read it [E]. Sketch's open format also made it easy for competitors to import Sketch files [E]: openness lowers the cost of leaving as well as of joining. |
| **Published, partly documented, vendor-controlled** | PSD: Adobe publishes a specification that is incomplete and does not explain how to interpret the data; many tools read PSD regardless [V] ([Library of Congress](https://loc.gov/preservation/digital/formats/fdd/fdd000523.shtml)) | Wide reading support, no loss of position for the owner. |
| **Self-describing, code as the spec** | `.blend` [V] | Works for an open-source app; third-party readers are rare. |
| **Closed** | Figma `.fig` [V]; Fusion [E] | Read by reverse engineering anyway. The lock-in comes from the cloud and the network, not from the file. |

### 7.2 The paid exports and the file

The model: `.pave` free, STL free, Rhino and STEP paid.

| What the file holds | How a third party gets exact geometry | Verdict |
|---|---|---|
| STEP (v1) | Unzip. | Remove. |
| OpenCascade BREP (text, or the binary variant) | Open in any OpenCascade tool and export STEP. The BREP format is publicly documented, text, three versions, and can include triangulations [V] ([OCCT BREP format](https://occt3d.com/dev/doc/overview/html/specification__brep_format.html)). | A speed bump only. Use only as a cache, if at all. |
| Encrypted exact cache | Take the key from the app, which runs on the user's machine. | Theatre. Do not build. |
| Recipe + meshes (proposed) | Re-implement our feature library on a CAD kernel. Simple freeform nodes (curve, extrude, loft, sweep, revolve) map to standard kernel calls, so a converter is a real but modest project for those; the jewelry features (heads, shared prongs, pavé with seats, cutters) are the hard part and are the product. | Strongest practical position. |
| Nothing exact, and a licence | A published spec can say: reading and writing is free; a tool that reconstructs exact geometry from the design to avoid the paid export breaks the terms. | Deters companies, not hobbyists. Worth one paragraph. |
| Do nothing more | — | The value is elsewhere: see below. |

The honest picture:

- Today the app runs on the user's laptop and the plan is a server setting on that laptop. The exact shape exists in the app's memory, and in the browser when the kernel runs there. A determined person can already get it. The file is not the weakest link.
- A paying customer buys a STEP that opens as named, coloured solids, a `.3dm` on the right layers with curves, fidelity notes, checks that passed, and no afternoon lost. People who need Rhino or STEP are businesses handing work to another business.
- Meshes are free by design (STL is free), and they are in the file. That is consistent.
- When the product is hosted, exports run on the server and the gate is real, with or without an exact cache in the file.

**Recommendation:** store the recipe and the display mesh; no exact geometry in v2; add the licence sentence; do not encrypt. Decide on a BREP cache only after measuring cold-open time on the 2023 MacBook Air.

One exception already in the plan: a `brepBody` node stores an imported STEP as an asset (`freeform-cad.md`). That file is the user's own import and STEP import is free, so it travels as an ordinary asset.

### 7.3 Recommendation on openness: in two stages

1. **Now: an open envelope.** Publish the container profile, the manifest, thumbnails, the display GLB, facts, provenance and the `ext/` rules, with a small TypeScript reader under MIT or Apache-2.0 and the text under a Creative Commons attribution licence. Anyone can verify, preview and catalogue a `.pave` file. This is what a marketplace, an ERP, a manufacturer's intake or a chat preview needs, and it costs nothing we sell.
2. **When the freeform schema has settled: publish the design document** as a JSON Schema. Until then say plainly that `design.json` is readable and will change. Promising stability during eight build steps of schema growth would be a cost with no benefit.

The trade fears losing its designs to a vendor. "Your pieces are yours, in a documented file" is a selling point against tools that hold files hostage, and it fits "free CAD, as Blender is for 3D". Note that the product itself is proprietary; publishing a file specification does not change that.

## 8. Files received from strangers

| Risk | Defence |
|---|---|
| Zip bombs, path-like names, parser differences | v1's limits, chunked inflate with a hard stop and name patterns stay. Add the strict profile of §5 (reject overlaps and header disagreements) and a total-ratio cap. Keep names as patterns when `ext/` is added: fixed depth, ASCII, no dots-only segments. |
| Memory exhaustion on a server | Stream entries; cap concurrent opens and per-organisation open rate; open in a worker with a memory limit. |
| JSON abuse | Size cap per entry (v1), depth cap, string and array caps in every schema (v1 has most), reject duplicate keys, own-property lookups for ids (v1's `applyOps` already treats `__proto__` as an ordinary id). |
| Code | None in the format, ever: no scripts, expressions, macros or plug-in binaries. `ext/` data is inert bytes that Pavé never executes. If node parameters ever accept formulas, they need a non-Turing-complete grammar and an evaluator with limits. |
| External references | None are followed on open. Drop `thumbUrl`. Show source and licence URLs as text; open them only on a click, and only `http` or `https`. |
| Embedded images | Decode in the browser or in a sandboxed image library, never with a system previewer; re-encode thumbnails. SVG must never run script: the asset server already sends `nosniff` and a sandboxing content security policy (`apps/server/src/http/assets.ts`); keep that for every asset that came from a file. Strip EXIF (GPS, device, owner name) from pictures in share and clean copies. |
| GLB and any exact cache | Parse with caps on accessor counts and buffer sizes. Never feed a file's BREP or STEP to the kernel on open: OpenCascade's readers are large C++ code not written for hostile input [E]. If a cache is ever used, accept it only when signed by this install. |
| Forged history, forged "saved here" | Replay the history against the checkpoints before trusting it for undo; never learn from an unsigned history; bind the "saved here" proof to the manifest hash (§4.4). |
| Metadata leaks to the recipient | Share and clean profiles: pseudonyms, rounded times, no ids from the database, no hop chain, no prompts, no costs or suppliers, no file-system paths (v1 stores none). Show a "what this file contains" summary before sending. |
| Rights | v1's rule is good: pictures travel only if the rights allow; attestations do not cross organisations. |

## 9. What this means for the plan

Inputs for `docs/plans/pave-file-format.md`.

**The v2 layout.**

```
mimetype                          application/vnd.….piece+zip   (stored, first)
manifest.json                     versions, requires/uses, units, kernel, document id, profile, entry table
thumbnails/thumbnail.png          512 px, stored, third
thumbnails/preview.jpg            optional, ~1600 px
piece.json                        title, kind, stage, brief, spec, facts
design.json                       the design document (hashed; the truth)
directions.json                   optional variants
history/000001.jsonl …            optional op-log segments; history/checkpoints/<seq>.json
geometry/display.glb              meshopt + instancing, tagged with the design hash
looks/shots.json                  render scenes
references.json, assets/<sha256>.<ext>
provenance.json                   origin, AI involvement summary, attestation, last hop
sourcing.json, production.json    working copy only
view.json                         optional view state
ext/<reverse-dns>/…               carried third-party and future data
signatures/manifest.sig           optional
META-INF/…                        reserved (C2PA)
```

**Migration from v1.** One step in `PAVE_FILE_MIGRATIONS`: split `piece.json` into `piece.json`, `design.json`, `directions.json`; turn `history.json` into one segment; ignore `geometry/exact.step`; move hops into `provenance.json`; treat the old org fingerprint as "unknown origin" for attestation. v1 files keep opening. v2 files opened by a v1 build are refused; fix the order of checks in v1 first so the message is the right one.

**Build order.**

1. **Before any build reaches a user (small, v1):** read the manifest and version before the name check; make the writer obey `PAVE_LIMITS`; stop writing `geometry/exact.step`; drop `thumbUrl` on open; bind the "saved here" proof to the manifest hash.
2. **A shared `@pave/file` package:** pure TypeScript over byte arrays, Web Crypto instead of Node's, no database. The server, the studio (open and preview without upload), a future OS handler and the published reference reader all use it.
3. **The v2 manifest:** `minReaderVersion`, `requires`/`uses`, units, tolerance, kernel versions, document id and revision, design hash; loose parsing and carried `ext/` data.
4. **Save profiles**, with a "what this file contains" sheet; pseudonymous history; the learning-consent flag.
5. **Preview that pays off:** 512 px thumbnail; display GLB shown at once on open while the kernel rebuilds; meshopt and instancing.
6. **Golden corpus, torture corpus, fuzzing** in CI.
7. **History segments and checkpoints.**
8. **Signatures**; later the hosted counter-signature; C2PA only if a customer asks.
9. **Publish the envelope spec**, register the media type, declare the type identifier; OS thumbnail handlers when a desktop shell exists.

**Reject, and why.** SQLite or a custom binary as the container (the database already gives what they add; third-party reading gets harder). Encryption inside the file (theatre on a local app; whole-file encryption exists outside). STEP in the file (gives away a paid export). Conversations and traces in the file (private, and not needed to reopen a piece). A CRDT in the file (the plan of record is a server-ordered op log).

**Decisions for the founder.**

1. **Open or closed.** Recommended: open envelope now, design schema later (§7.3). Which licences for the spec text and the reader?
2. **Exact geometry in the file.** Recommended: none; decide on a BREP cache only after measuring open time.
3. **What history a file keeps by default** when it is sent to someone else: full, milestones or none? Recommended: share copy with pseudonymous full history, clean copy one click away.
4. **Learning and consent.** Is learning from edits a condition of the free plan (stated at sign-up) or opt-in per organisation (as `05-platform.md` decided)? And: may the product learn from the history inside a file saved by another organisation? Recommended: only when that organisation's flag allows it and the file is signed.
5. **Names.** Keep `.pave`? I did not check whether another product uses that extension. The MIME type needs a producer name in the vendor tree: registration is open to anyone and goes through IANA expert review; the template asks for security considerations, extension and magic number [V] ([RFC 6838](https://www.rfc-editor.org/rfc/rfc6838)); `+zip` is a registered suffix [V] ([RFC 6839](https://www.rfc-editor.org/rfc/rfc6839)). Proposed shape: `application/vnd.<company>.pave-piece+zip`, and a type identifier `<reverse company domain>.pave-piece` conforming to `public.data`. Both need the company's legal name and domain.
6. **Whose key signs files** on a local install, and whether the hosted service will keep a registry of install keys.
7. **What a share copy strips by default:** costs, suppliers, prompts, user names. Recommended: all four.
8. **Thumbnail on encrypted or rights-restricted pieces:** a generic image instead of the real one (ODF's rule)?

**Open questions I could not close.** Real file sizes and open times (nothing was run). Whether the kernel build exposes BREP read and write (`replicad` is said to have `serialize`; not checked here). Per-browser support for native `zstd` decompression. The exact text of the EPUB container rules and of the FreeCAD file description (pages too long or refused). Whether `.pave` collides with an existing extension.

## Repo notes for the lead

- `docs/pave-file.md` (assistant build) says "adding is not a change: readers ignore what they do not know". `isPaveEntryName` and the Zod enums contradict it (§2.3 rows 1–4).
- `docs/plans/freeform-cad.md` says new node kinds need "no schema version bump". True for the database; for files it breaks older readers without a clear message (§6).
- `docs/research/01-cad.md` names STEP **AP214** as the hand-off; `packages/kernel/src/export/step.ts` says it writes **AP242**. One of them is out of date.
- `docs/research/05-platform.md` §4 makes training use opt-in and off by default. The founder's wording for this topic makes learning the reason the file is free. Needs one decision (§9, item 4).
- `docs/PLAN.md` calls the product "a free, open CAD"; the shared brief and `HANDOVER.md` say proprietary. "Open" needs defining before a spec licence is chosen.
- `docs/HANDOVER.md` says pricing is "not built yet"; the assistant build has `packages/schema/src/plans/config.ts`. Expected between branches, noted for the merge.
- `packages/kernel/src/export/glb.ts` states that Blender's importer cannot decode Draco or meshopt. I did not verify it; it does not affect the file's display mesh.
- Security items for the assistant build's owner, independent of v2: §2.3 rows 9, 10 and 11.

## Sources

**Our code and docs (read this session):** assistant build `packages/schema/src/{files/pave.ts, pave.test.ts, design/design.ts, plans/config.ts, api/entities.ts, api/commands.ts}`, `apps/server/src/{pavefile/, traces.ts, runtime.ts, assets/assets.ts, http/assets.ts, handlers/pieces.ts}`, `apps/studio/src/features/{pavefile, references}`, `docs/pave-file.md`, `README.md`, `docs/ARCHITECTURE.md`; research repo `docs/PLAN.md`, `docs/HANDOVER.md`, `docs/research/{01-cad, 05-platform}.md`, `docs/plans/{freeform-cad, assistant}.md`, `docs/strategy/`, `packages/kernel/src/export/`.

**3DM / openNURBS:** [V] [What is openNURBS](https://developer.rhino3d.com/guides/opennurbs/what-is-opennurbs/) · [V] [opennurbs repository](https://github.com/mcneel/opennurbs) and [V] [LICENSE](https://github.com/mcneel/opennurbs/blob/8.x/LICENSE) · [V] [ON_3DM_BIG_CHUNK](https://developer.rhino3d.com/api/cpp/class_o_n__3_d_m___b_i_g___c_h_u_n_k.html) · [V] [ON_UnknownUserData](https://developer.rhino3d.com/api/cpp/class_o_n___unknown_user_data.html) · [V] [User data guide](https://developer.rhino3d.com/guides/cpp/user-data/) · [V] [Rhino Save command](https://docs.mcneel.com/rhino/8/help/en-us/commands/save.htm) · [V] [Library of Congress, 3DM](https://loc.gov/preservation/digital/formats/fdd/fdd000601.shtml)

**STEP, STL, kernel formats:** [V] [prostep ivip, AP242 fact sheet](https://www.prostep.org/mediathek/fact-sheets/iso-10303-242) · [S] [NISTIR 7433](https://nvlpubs.nist.gov/nistpubs/Legacy/IR/nistir7433.pdf) · [V] [Library of Congress, STL](https://www.loc.gov/preservation/digital/formats/fdd/fdd000504.shtml) · [V] [OCCT BREP format](https://occt3d.com/dev/doc/overview/html/specification__brep_format.html) · [S] [JT Open](https://plm.sw.siemens.com/en-US/plm-components/jt/jt-open-program) · [S] [Library of Congress fdd000562](https://loc.gov/preservation/digital/formats/fdd/fdd000562.shtml)

**3MF, glTF, USD:** [V] [3MF Core Specification](https://github.com/3MFConsortium/spec_core/blob/master/3MF%20Core%20Specification.md) (first 100,000 characters) · [V] [3mf.io specifications](https://3mf.io/spec/) · [V] [glTF 2.0](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html) (first 100,000 characters) · [V] [glTF extension registry](https://github.com/KhronosGroup/glTF/blob/main/extensions/README.md) · [V] [meshoptimizer](https://github.com/zeux/meshoptimizer) · [V] [USDZ specification](https://openusd.org/release/spec_usdz.html) · [V] [OpenUSD LICENSE](https://github.com/PixarAnimationStudios/OpenUSD/blob/release/LICENSE.txt) · [V] [AOUSD Core Specification 1.0 announcement](https://aousd.org/uncategorized/core-spec-announcement/) · opened but not reached far enough to use: [OpenUSD glossary](https://openusd.org/release/glossary.html)

**Document formats:** [V] [Library of Congress, OPC](https://www.loc.gov/preservation/digital/formats/fdd/fdd000363.shtml) · [V] [ODF 1.3 part 2, packages](https://docs.oasis-open.org/office/OpenDocument/v1.3/os/part2-packages/OpenDocument-v1.3-os-part2-packages.html) · opened, container section not reached: [EPUB 3.3](https://www.w3.org/TR/epub-33/) · [V] [Sketch file format](https://developer.sketch.com/file-format/) · [V] [Figma: save a local copy](https://help.figma.com/hc/en-us/articles/8403626871063) · [V] [fig file parser](https://madebyevan.com/figma/fig-file-parser/) · [V] [SQLite as an application file format](https://www.sqlite.org/appfileformat.html) · [V] [SQLite: defense against the dark arts](https://www.sqlite.org/security.html) · [V] [SQLite WASM persistence](https://sqlite.org/wasm/doc/trunk/persistence.md) · [V] [The mystery of the blend](https://projects.blender.org/archive/blender-archive/raw/commit/41f8f08e5188ed3d859c8e896ce700cb15ddf67b/doc/blender_file_format/mystery_of_the_blend.html) · [S] [FreeCAD FCStd](https://wiki.freecad.org/File_Format_FCStd) (refused) · [V] [How does Onshape really work](https://www.onshape.com/en/blog/how-does-onshape-really-work) · [V] [Library of Congress, PSD](https://loc.gov/preservation/digital/formats/fdd/fdd000523.shtml) · [V] [PNG, third edition](https://www.w3.org/TR/png-3/) (first 100,000 characters)

**Platform, security, provenance:** [V] [A better zip bomb](https://www.bamsoftware.com/hacks/zipbomb/) · [V] [Windows thumbnail handlers](https://learn.microsoft.com/windows/win32/shell/thumbnail-providers) · [V] [How QuickLook provides thumbnails and previews](https://eclecticlight.co/2026/05/18/how-quicklook-provides-thumbnails-and-previews/) · [V] [Apple: declaring new uniform type identifiers](https://developer.apple.com/library/content/documentation/FileManagement/Conceptual/understanding_utis/understand_utis_declare/understand_utis_declare.html) · [V] [RFC 6838](https://www.rfc-editor.org/rfc/rfc6838) · [V] [RFC 6839](https://www.rfc-editor.org/rfc/rfc6839) · [V] [MDN DecompressionStream](https://developer.mozilla.org/en-US/docs/Web/API/DecompressionStream/DecompressionStream) · [V] [MDN createWritable](https://developer.mozilla.org/en-US/docs/Web/API/FileSystemFileHandle/createWritable) · [V] [C2PA specification 2.3](https://spec.c2pa.org/specifications/specifications/2.3/specs/_attachments/C2PA_Specification.pdf) (two 100,000-character windows) · [V] [Zod API](https://zod.dev/api)
