# Pavé

AI-native jewelry design, from an idea to the manufacturer's bench in one workspace: ideate,
CAD, render, on-model, sourcing, production package.

This page is how to run it on your own computer. How it is built is in
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

- [What works today](#what-works-today)
- [Install](#install)
- [Start it](#start-it)
- [Use the assistant with your Claude API key](#use-the-assistant-with-your-claude-api-key)
- [A first tour by hand](#a-first-tour-by-hand)
- [Plans: Free and Pro](#plans-free-and-pro)
- [Photoreal renders with Blender](#photoreal-renders-with-blender-optional)
- [References beside CAD](#references-beside-cad)
- [Where your work is kept](#where-your-work-is-kept)
- [Settings](#settings)
- [Accounts and teams](#accounts-and-teams)
- [Using it from scripts](#using-it-from-scripts)
- [Updating](#updating)
- [Troubleshooting](#troubleshooting)
- [Working on the code](#working-on-the-code)

## What works today

Pavé is under construction. A piece moves through three stages, **Design** (directions),
**CAD** and **Render**, and each can be done by hand or handed to the assistant as an AI job you
watch, pause, take over or stop.

| Area | State |
| --- | --- |
| Workspace: home, collections, pieces, library of metals, stones, cuts and ring sizes | Works |
| Templates: 14 starting points, from a solitaire to an iced-out trophy pendant | Works |
| **Design** tab: the brief, and directions to compare, mix and choose (by hand from templates, or proposed by the assistant) | Works |
| **CAD** tab: feature list, inspector, live weight, carats and stone count, manufacturability checks, undo and redo | Works; being tested and fixed, so expect rough edges |
| **Render** tab: shots, looks, framing a shot by hand in the viewfinder, animations (turntable, orbit, push-in, macro sweep, sparkle pass) as MP4 with a GIF, Blender takes, browser previews without Blender | Works; Blender is optional (animations need it) |
| The assistant: chat in the dock, AI jobs for each stage, a design from a written brief or from a photo, edits by chat, questions about a selected part | Works with your own Claude API key ([below](#use-the-assistant-with-your-claude-api-key)). Built and tested against recorded stand-ins for Claude, not yet against Claude itself: run `pnpm agent:smoke` once with your key to check it |
| Reference panel beside CAD: museum search, pins with their rights, pictures laid in a view as image planes | Works. The museum search was tested with recorded answers only |
| Exports: STL, 3MF, OBJ, GLB, STEP, 3DM | Works |
| Plans: Free and Pro, with monthly counts of Blender renders and Rhino/STEP exports | Counting works; there is no payment yet |
| Production package: spec sheet, drawings, files, stone list, cost estimate, checks, as a zip | Works [from a script](#using-it-from-scripts); its screen is not built yet |
| Connecting Claude Code to Pavé over MCP | Planned, not built |
| Ideas pages, brand models, on-model shots, sourcing, publishing | Not built yet. Their pages are placeholders |
| Desktop app | Not built yet. Pavé runs in your browser from a local server |

## Install

You need:

| | Version | Notes |
| --- | --- | --- |
| [Node.js](https://nodejs.org) | 22 or newer | The LTS installer is fine |
| [Git](https://git-scm.com) | any | To download the code |
| Disk space | about 1.5 GB | Another 1 GB if you add the Blender renderer |
| A browser | Chrome, Edge, Firefox or Safari, current | The 3D view needs WebGL 2 |

Everything else is installed for you. Works on macOS, Windows and Linux.

**1. Get the code**

```bash
git clone https://github.com/tejjogani/ffdraft.git pave
```

```bash
cd pave
```

**2. Run the installer**

macOS and Linux:

```bash
./install.sh
```

Windows (PowerShell):

```powershell
.\install.ps1
```

If PowerShell refuses to run scripts, use
`powershell -ExecutionPolicy Bypass -File .\install.ps1`.

The installer takes a few minutes the first time. It:

1. checks Node.js;
2. turns on pnpm, the package manager, through Node's own `corepack`;
3. downloads the dependencies;
4. builds the application;
5. creates `apps/server/.env`, a settings file where every line is optional;
6. says whether the assistant has a Claude API key and whether the Blender renderer is installed;
7. starts Pavé once on a spare port with a throwaway data folder, checks that it answers, and
   stops it.

It installs nothing outside this folder apart from pnpm, deletes nothing, and can be run again
at any time.

| Option | What it does |
| --- | --- |
| `--start` | Start Pavé as soon as the install finishes |
| `--render` | Also install the Blender renderer (see [below](#photoreal-renders-with-blender-optional)) |
| `--check` | Change nothing; report what is ready and what is not, including whether a Claude API key is set (never the key itself) |
| `--no-smoke` | Skip the start-up check in step 6 |

The same installer without the wrapper, on any system: `node scripts/install.mjs`.

## Start it

```bash
pnpm start
```

Then open **http://localhost:8787**.

Leave the terminal window open while you work; `Ctrl+C` stops Pavé. There is no sign-in: on your
own computer Pavé runs for one person, and it only listens to your computer, not to your network.

The first start creates a welcome workspace with eleven example pieces in three collections
(Bridal, Iced, Bands), so there is something to open straight away.

## Use the assistant with your Claude API key

The assistant is Claude, working inside Pavé with the same commands you use: it can turn a
written brief or a photo into a parametric design, change it when you ask in words, answer
questions about a part you selected, and run each stage as an AI job. It runs on your own Claude
API key and your computer: its tools act on your local Pavé, and only the conversation goes to
Claude.

### 1. Get a key

Create one on the API keys page of the Claude Console:
[platform.claude.com/settings/keys](https://platform.claude.com/settings/keys). It starts with
`sk-ant-`. Usage is billed to that Console account; Pavé shows what each run cost.

### 2. Give it to Pavé, in one of two ways

**In the app (simplest).** Start Pavé, open **Settings → AI**, paste the key, press **Test**
(it asks Claude's free Models API whether the key works and which models it can use), then
**Save**. The assistant is on at once; no restart. The key is kept on the server only, sealed
in the database with a key derived from your installation's secret; the page shows only its last
four characters, and it never reaches the browser, the logs or the traces. **Remove** turns the
assistant off again. The assistant's panel shows the same short form the first time you open it.

**In `apps/server/.env`.** Add a line, then restart Pavé:

```ini
ANTHROPIC_API_KEY=sk-ant-…
```

A key in `.env` (or set in your terminal) takes precedence over one saved in the app; Settings,
AI then says the key comes from the `.env` file and cannot be edited there.

`node scripts/install.mjs --check` says whether a key is set, and where, without printing it.

### 3. Check it once: `pnpm agent:smoke`

```bash
pnpm agent:smoke
```

This runs the whole journey against Claude on a throwaway copy of Pavé in memory (your own
pieces are not touched) and checks each step:

1. a written brief becomes directions (a Design job), and one of them becomes the built design;
2. a photo of a ring (drawn by Pavé's own geometry engine) becomes a parametric design;
3. one change asked for in words;
4. one low-quality Blender render and the assistant's critique of it (skipped, with a line
   saying so, if Blender is not installed).

It checks that every run finished, every design evaluates, the conversation is read back from
Claude's prompt cache (which makes later turns cheaper), and no reasoning was lost between
turns, and it prints the tokens and dollars of each run. It takes 10 to 30 minutes and costs a
few dollars on Standard. It reads the key from your terminal or `apps/server/.env` (not a key
saved in the app), refuses to start without one, and never prints it.

| Option | What it does |
| --- | --- |
| `--tier=power`, `--tier=light` | Run on another tier (default: Standard, or `PAVE_ASSISTANT_TIER`) |
| `--only=design,edit` | Only some of the journeys: `design`, `photo`, `edit`, `render` |
| `--tiers` | Also a quick check of each tier's model (a few cents to about a dollar more) |

### 4. Try the whole journey

Open the assistant with **Assistant** in the sidebar, or `Ctrl+J` (`⌘J` on a Mac). Each
stage of a piece also has its own AI button in the piece's header, which shows the plan before
anything starts. While a job works, a bar under the stage tabs shows its steps, the changes it
made (each can be undone), the time and the cost, with **Pause**, **Take over** and **Stop**.
Changing the piece by hand pauses the job; **Resume** carries on from the piece as it is.

1. **Design.** On Home, describe the piece in the box ("What are we making?"), or create a
   piece, write its brief on the **Design** tab and press **Propose directions with AI**. You
   get two to four directions, each built, weighed and roughly priced, with its trade-off.
   Compare them, **Mix…** parts of two (head, band, metal, style), and **Choose** one: it becomes
   the piece's design and the piece moves to CAD.
2. **CAD.** Press **Make the CAD with AI** to have the assistant take the chosen direction to
   production detail: it runs every check and fixes or explains each warning, then reports
   weight, carats and cost. Then keep editing both ways: drag a value in the inspector, or ask
   in words ("make the band 0.3 mm wider", "swap the centre stone for a 1.5 ct oval and keep the
   setting"). To ask about a part, select it in the model and press `Ctrl+J`: the part goes
   along with your question.
3. **Render.** Press **Render with AI** on the **Render** tab. The assistant looks at the piece
   (its centre stone, halo, pavé, gallery), then asks at most three quick questions in the dock:
   what the images are for, which shapes (1:1, 4:5, 9:16, 16:9) and which animations (a 360°
   turntable, a macro sweep, a sparkle pass, a half orbit). Good answers are already picked, so
   **Go** alone is enough; or type what you want instead. It then places every camera itself
   (hero three-quarter, profile, top-down, a macro on the stone, a low angle), checks each
   framing through the shot's own camera before spending render time, renders the stills and
   animations, looks at every still, re-renders what falls short and hands the set over for you
   to review. Animation takes play in the filmstrip; download them as MP4 (or a small GIF). With
   Blender these are photoreal takes; without it, your browser draws still previews.
   Whatever you then do to its work (star, swap, set a cover, move a camera, change the look,
   re-render, delete) is recorded on the run as feedback, so the shot choices can improve.

From a **photo**: drop a picture of a piece into the assistant's message box (or attach it to
**Make the CAD with AI**) and ask it to make the piece. It reads the photo, builds the design,
fits it to the photo's outline when the background is plain, and says what it assumed.

Three briefs to start with:

- *An engagement ring for someone who works with her hands: about a 1 carat round diamond,
  nothing that catches on gloves, yellow gold, US size 6. Budget around $4,000.*
- *A men's signet ring in 18k white gold, flat oval face about 14 × 11 mm, engraved initials
  "J.R.", size US 10, solid and heavy.*
- *A pendant for a 40th anniversary: a 0.5 carat pear-shaped ruby in a bezel, a halo of small
  diamonds, rose gold, on a fine 45 cm chain.*

### Power, Standard and Light

Each conversation runs on a tier, chosen under the message box; everything a run does uses that
tier's model. New conversations start on the default tier (Standard), which you can change in
Settings, AI.

| Tier | Model | Per million tokens: input / output / read from cache | A typical run, roughly |
| --- | --- | --- | --- |
| Power | Claude Fable 5.2, the most capable | $8 / $40 / $0.20 | $1.25 |
| Standard | Claude Opus 5.5 | $4 / $20 / $0.20 | $0.65 |
| Light | Claude Sonnet 5.5 | $2 / $10 / $0.10 | $0.35 |
| (Light, if you choose it) | Claude Haiku 5.5, the fastest and cheapest | $0.10 / $0.50 / $0.01 (prompts over 100K tokens: $0.50 / $2.50) | $0.02 |

Writing to the cache costs 1.25 times the input price. "A typical run" is six model calls on one
piece; a long AI job or a photo with several rounds of fitting costs more. Settings, AI shows the
same table, a rough cost per run for each tier, and this month's spend. A run pauses on its own
at $3 or 40 model calls, with **Continue** to go on.

To point a tier at another model, pick it in Settings, AI (any of Claude Fable 5.2, Claude Opus
5.5, Claude Sonnet 5.5 and Claude Haiku 5.5), or set it in `apps/server/.env`, which wins over
the app:

```ini
PAVE_ASSISTANT_TIER=standard
PAVE_ASSISTANT_MODEL_POWER=claude-fable-5-2
PAVE_ASSISTANT_MODEL_STANDARD=claude-opus-5-5
PAVE_ASSISTANT_MODEL_LIGHT=claude-haiku-5-5
```

Claude Fable 5.2 needs your Anthropic organisation to keep data for 30 days; without that, Power
answers with a message saying so, and Standard works.

### When something goes wrong

| What you see | What it means, and what to do |
| --- | --- |
| "Claude's API did not accept the API key" (401) | The key is wrong, revoked or cut short. Paste it again in Settings, AI and press Test, or fix the `.env` line and restart |
| "This API key is not allowed to use …" (403), or "… is not available to this API key" | The key's workspace cannot use that model. Pick another tier, or point the tier at a model the key can use (Test lists them) |
| "Claude is busy or this key has hit its rate limit" (429) | Wait a minute and press Retry. New Console accounts start with low limits; they rise with use |
| "Claude declined this request" (a refusal) | Claude's safety checks stopped the turn (except on Haiku, Claude's API first lets a fallback model try). Rephrase, or try another tier. Changes made before it stay |
| "Could not reach Claude's API" | No internet, or a firewall or proxy blocks `api.anthropic.com`. Test in Settings, AI says the same |
| Power fails with a message about data retention | See the note on Claude Fable 5.2 above; use Standard |
| "Paused at $3 · Continue" | The run reached its cost cap. Press Continue to go on |
| The assistant's panel asks for a key, and you are not an owner or admin | Only owners and admins can add the key (accounts mode); ask one of them |

Every run is recorded under **Settings → Traces**: each model call and tool call, its tokens and
cost, and the changes it made.

## A first tour by hand

1. On **Home**, pick a piece under *Jump back in*, or a template under *Start from a template*.
2. Open the **CAD** tab. The first time takes a few seconds while the geometry engine loads.
3. Click a part of the model, or a row in the feature list on the left. Its settings appear on
   the right. Change one — the ring size, the stone size, the number of prongs — and the model,
   the weight and the carat total follow.
4. The bar under the model shows metal weight, carats and stone count, and *things to check*:
   walls that are too thin, stones too close to an edge, and so on. Some come with a one-click
   fix.
5. **Export** (top right of the model) saves the piece as STL or 3MF for printing and casting,
   STEP for Rhino and MatrixGold, 3DM, OBJ or GLB.
6. **+** above the feature list adds a stone, a setting, a halo, a row of stones, pavé, a bail,
   a chain, text, an imported mesh and more.
7. The **Design** tab holds the brief and the directions. **Add from a template** adds a
   direction by hand; choosing one replaces the design as one change you can undo.
8. The **Render** tab draws the selected shot live. Pick a look (Studio white, Black acrylic,
   Soft gradient…), an angle and a size, then **Render** (or **Render all** for the whole set).

Undo and redo work for every change, and the **History** tab lists them.

## Plans: Free and Pro

Pavé has two plans. What they include is set in one file,
[`packages/schema/src/plans/config.ts`](packages/schema/src/plans/config.ts).

| | Free | Pro |
| --- | --- | --- |
| CAD, the assistant on your own key, browser previews, STL / 3MF / OBJ / GLB exports | Unlimited | Unlimited |
| Finished Blender renders | 5 a month | Unlimited (fair use: 1,000 a month) |
| Rhino (3DM) and STEP exports, and production packages that contain them | 5 a month | Unlimited (fair use: 2,000 a month) |

A finished Blender animation counts as two renders (`ANIMATION_RENDER_COST` in the same file):
the allowance counts pictures you take away, not frames, and a video does the work of a few
stills. Months are calendar months in UTC. A render or export that fails, is cancelled, or comes from
the render cache is not counted. When the month's allowance is used up, Pavé says so calmly and
offers the alternatives (a browser preview instead of a Blender render); the assistant asks
before it spends the last free one. **Settings → Plan** shows this month's use and when it
resets, and **Upgrade** compares the plans. There is no payment yet.

To try Pro on your own computer, add this to `apps/server/.env` and restart (Pavé prints a
warning when it starts):

```ini
PAVE_PLAN=pro
```

In accounts mode the plan belongs to each organisation instead, and `PAVE_PLAN` is ignored.

## Photoreal renders with Blender (optional)

Pavé's own 3D view and the Render tab's browser previews need nothing extra. Photoreal takes use
Blender's Cycles renderer, which is a separate, optional install.

```bash
node scripts/install.mjs --render
```

(`./install.sh --render` or `.\install.ps1 --render` do the same.) This needs **Python 3.13** on
your computer (Blender 5.3's Python module supports only that version) and downloads about 1 GB.
If you already have Blender 5.3 installed, skip this and set `PAVE_BLENDER` in
`apps/server/.env` to the Blender program instead; the Render tab's engine dialog can also point
Pavé at it. Restart Pavé after installing.

Renders run on your processor unless Blender finds a supported graphics card. On a shared
four-core machine without one, a 640-pixel draft took 35 to 60 seconds; the Render tab learns
this computer's speed from its own finished takes and shows an estimate before each render.

**Framing a shot and rendering exactly that view.** The picture on the Render tab is a
viewfinder: drag to orbit, Shift-drag or right-drag to pan, Alt-drag sideways to roll, scroll
or pinch to zoom (the arrow keys orbit, and Alt or Ctrl with the arrows pan). The overlay shows the output frame, a safe margin, an optional rule-of-thirds
grid and how much of the frame the piece fills. Each move is one change to the shot, with Undo,
Redo, Reset and Lock. A take renders exactly the framed view, with a fixed random seed, so the
same shot gives the same picture again on the same computer; a take that matches the viewfinder
says "= this view". **Render this view**, in the CAD tab's view toolbar (the Views menu on a
narrow screen), copies the CAD camera into a new shot. **Add shot** can also save a shot for the whole organisation and reuse it on
other pieces, scaled to fit.

**Animations.** Pick a motion under **Motion** in the shot's settings: a 360° turntable (it
loops without a jump), a half orbit, a slow push-in, a macro sweep across the centre stone, a
sparkle pass that sweeps the light, a short arc or a rack focus, with its length, frame rate and
loop. **Shape** sets 1:1, 4:5, 9:16 or 16:9. The viewfinder plays and scrubs the motion before
you render; the time estimate counts every frame (a 6-second turntable at 30 fps is 180 frames,
so start with Draft quality). A take is an MP4 (H.264, from Blender's own encoder) with a poster
frame and a small looping GIF; it plays in the filmstrip on hover and with controls when opened.

## References beside CAD

The **References** button beside the CAD and Render tabs opens a panel with four sources:

- **Search** the open collections of The Met, the Art Institute of Chicago and the Cleveland
  Museum of Art, with no key;
- **This piece**: the photo it was made from and its moodboards;
- **Boards**: your organisation's moodboards;
- **Pinned**: paste a link or a picture, or drop files.

Every result and pin shows its source, credit, licence and what you may do with it. A museum
picture is kept only when the museum marks it open access; a pasted link stays view-only until
you press **Capture image**. The assistant sees the pictures you may use, and only the details of
view-only ones.

Drag a pinned picture onto the model to lay it in the **Front**, **Top** or **Right** view as an
image plane (on a phone or with the keyboard, use the pin's menu). The view turns to face it.
Fade it, lock it, drag it, and scale it to size by clicking two points and typing the real
distance between them, or picking a known stone size. Image planes never appear in captures,
renders or exports, and their moves have their own undo.

## Where your work is kept

Everything is in one folder, `.data`, inside the Pavé folder: the database, uploaded and
exported files, and a generated key.

| To | Do this |
| --- | --- |
| Back up | Stop Pavé, copy the `.data` folder somewhere safe |
| Move to another computer | Install Pavé there, stop it, copy your `.data` folder in |
| Start over with a fresh workspace | Stop Pavé, delete (or rename) `.data`, start it again |
| Keep the data somewhere else | Set `PAVE_DATA_DIR` (see Settings) |

Your designs stay on your computer. Pavé talks to outside services only when you use them: the
assistant sends the conversation (your messages, photos you attach, and what its tools read
about the piece) to Claude's API on your key, and the reference panel's search asks the three
museums' open collections. A Claude API key saved in Settings, AI is kept sealed in the
database, and the generated key in `.data` is what opens it: copy the whole folder, not only
the database.

## Settings

Settings live in `apps/server/.env`. Every one is optional; remove the `#` in front of a line to
turn it on, then restart Pavé. A value set in your terminal wins over the file.

| Setting | Default | What it is for |
| --- | --- | --- |
| `PORT` | `8787` | The port Pavé listens on. Change it if something else uses 8787 |
| `HOST` | `127.0.0.1` | Set to `0.0.0.0` to let other computers on your network reach it. Only do that together with accounts (below) |
| `PAVE_DATA_DIR` | `.data` in the Pavé folder | Where the database and files are kept |
| `PAVE_SEED` | `1` | `0` skips the welcome workspace on a fresh data folder |
| `PAVE_AUTH` | `local` | `local`: no sign-in, one person. `accounts`: sign-in, organisations, invitations |
| `BETTER_AUTH_SECRET` | — | Required with `accounts`: 32 or more random characters |
| `PAVE_PUBLIC_URL` | `http://localhost:8787` | The address people reach Pavé at, when it is not your own computer |
| `DATABASE_URL` | — | A PostgreSQL 18 address. Without it Pavé uses its own built-in database in the data folder |
| `PAVE_MAX_UPLOAD_MB` | `200` | Largest file that can be uploaded |
| `PAVE_KERNEL_WORKERS` | processors − 1, at most 4 | How many geometry jobs run at once |
| `PAVE_KERNEL_MEMORY_MB` | `1536` | Memory a geometry worker may hold before it is restarted |
| `PAVE_PYTHON`, `PAVE_BLENDER` | — | Where Blender is, if not installed by `--render` |
| `ANTHROPIC_API_KEY` | — | Your Claude API key for the assistant. Wins over a key saved in Settings, AI |
| `PAVE_ASSISTANT_TIER` | `standard` | The tier new conversations start on: `power`, `standard` or `light` |
| `PAVE_ASSISTANT_MODEL_POWER`, `…_STANDARD`, `…_LIGHT` | Claude Fable 5.2, Claude Opus 5.5, Claude Sonnet 5.5 | The model of each tier: `claude-fable-5-2`, `claude-opus-5-5`, `claude-sonnet-5-5` or `claude-haiku-5-5`. Wins over Settings, AI |
| `PAVE_PLAN` | `free` | `pro` to try the Pro plan on your own computer (ignored in accounts mode) |

The full list, with comments, is in [`apps/server/.env.example`](apps/server/.env.example).

To use a different port once, without editing the file:

```bash
PORT=9000 pnpm start
```

On Windows PowerShell: `$env:PORT=9000; pnpm start`.

## Accounts and teams

Out of the box Pavé is for one person on one computer. The server also supports sign-in with
email and password, organisations, roles (owner, admin, designer, viewer, guest) and
invitations:

```ini
PAVE_AUTH=accounts
BETTER_AUTH_SECRET=<32 or more random characters>
```

Generate the secret with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

In accounts mode the Claude API key and the plan belong to the organisation: only its owners and
admins can add, test or remove the key, and members' runs use it.

This part has been tested through the server only. Invitation emails are not sent yet, and
running Pavé for several people on a network or the internet (HTTPS, backups, a PostgreSQL
database) is not documented yet.

## Using it from scripts

Everything the application does goes through one list of commands, and each is reachable at
`POST /api/rpc/<command>` with a JSON body. On your own computer no key is needed.

List the pieces:

```bash
curl -s -X POST http://localhost:8787/api/rpc/pieces.list -H 'content-type: application/json' -d '{}'
```

Export a piece as STL (use an `id` from the list above); the answer contains a download address
under `asset.url`:

```bash
curl -s -X POST http://localhost:8787/api/rpc/design.export -H 'content-type: application/json' -d '{"pieceId":"pc_…","format":"stl"}'
```

```bash
curl -s -o ring.stl http://localhost:8787/api/assets/as_…
```

Weights, carats, stone lots and checks for a piece:

```bash
curl -s -X POST http://localhost:8787/api/rpc/design.evaluate -H 'content-type: application/json' -d '{"pieceId":"pc_…"}'
```

Build a production package, then ask for it until its `status` is `done`; its `assetId` is the
zip, downloaded from `/api/assets/<assetId>`:

```bash
curl -s -X POST http://localhost:8787/api/rpc/production.create -H 'content-type: application/json' -d '{"pieceId":"pc_…"}'
```

```bash
curl -s -X POST http://localhost:8787/api/rpc/production.list -H 'content-type: application/json' -d '{"pieceId":"pc_…"}'
```

Every command, with its inputs and outputs, is declared in
[`packages/schema/src/api/commands.ts`](packages/schema/src/api/commands.ts).

## Updating

```bash
git pull
```

```bash
./install.sh
```

Your `.data` folder is left alone, and the database is brought up to date on the next start.
Back the folder up first if the work in it matters.

## Troubleshooting

| What you see | What to do |
| --- | --- |
| `node: command not found`, or the installer says Node is too old | Install Node.js 22 or newer from [nodejs.org](https://nodejs.org), open a new terminal, run the installer again |
| `pnpm: command not found` after installing | Open a new terminal. If it persists: `npm install --global pnpm@10` |
| The installer stops while downloading dependencies | Check the internet connection. Behind a company proxy, `registry.npmjs.org` must be reachable |
| `address already in use` on start | Another program, or another copy of Pavé, uses port 8787. Stop it, or start with a different `PORT` |
| The browser shows a blank page or "Not found" at `localhost:8787` | The application was not built. Run the installer again, or `pnpm build` |
| The model is a plain matt colour instead of polished metal | The browser is drawing without a graphics card, so Pavé switches to a simpler view. Turn on hardware acceleration in the browser's settings |
| The CAD tab stays on "Preparing the workbench…" | The first load can take up to half a minute on a slow computer. If it never finishes, reload the page and check the terminal for errors |
| A heavily iced piece is slow | Pieces with hundreds of stones take a second or two per change today. This is being worked on |
| `--render` fails with "CPython 3.13 not found" | Install Python 3.13, or install Blender 5.3 and set `PAVE_BLENDER` |
| PowerShell: "running scripts is disabled on this system" | `powershell -ExecutionPolicy Bypass -File .\install.ps1` |
| The assistant answers with an error | See [When something goes wrong](#when-something-goes-wrong) |
| The Render tab says Blender was not found | Install it with `node scripts/install.mjs --render`, or point the engine dialog (or `PAVE_BLENDER`) at Blender 5.3, then restart. Without it, takes are browser previews |
| Something is wrong and you want a clean start | Stop Pavé, rename `.data`, start again. Your old work stays in the renamed folder |

`pnpm check:install` checks the installation without changing anything.

## Working on the code

```bash
pnpm dev
```

runs the server on port 8787 and the application on **http://localhost:5173** with live reload:
use this address while editing code.

| Command | What it does |
| --- | --- |
| `pnpm test` | All tests (several minutes; the geometry tests are heavy) |
| `pnpm exec vitest run packages/kernel` | The tests of one package |
| `pnpm typecheck` | Type-check every package |
| `pnpm lint` / `pnpm format` | Check / fix style |
| `pnpm build` | Build the application into `apps/studio/dist` |
| `pnpm seed` | Create the welcome workspace again |
| `pnpm agent:smoke` | The assistant's live check against Claude ([above](#3-check-it-once-pnpm-agentsmoke)); needs a key and spends a few dollars |

| Folder | What is in it |
| --- | --- |
| `packages/schema` | The contract: metals, stones and sizes, the design document, templates, every command |
| `packages/kernel` | Geometry: builds a design into solids and stones; exports |
| `packages/canon` | Design rules, style guides and reference designs |
| `packages/agent` | The assistant: its tools, prompts, tiers and prices, and the Claude adapter |
| `packages/match` | Fitting a design to a photo |
| `packages/render` | Materials, lighting, scene description, the Blender job runner |
| `packages/production` | Drawings, bill of materials, costing, the manufacturer's package |
| `packages/sourcing` | Stone requirements from CAD; marketplace links |
| `packages/ui` | Colours, type and components |
| `apps/server` | The local server: storage, commands, files, usage, history, the assistant's runs |
| `apps/studio` | The application you see in the browser |
| `workers/render` | The program that runs inside Blender |
| `docs` | Architecture, research, build briefs, strategy |

## Licence

Pavé is proprietary software; see [`LICENSE`](LICENSE). The render runner in `workers/render` is
a separate program under the GPL, because it runs inside Blender.
