# Pavé

AI-native jewelry design, from an idea to the manufacturer's bench in one workspace: ideate,
CAD, render, on-model, sourcing, production package.

This page is how to run it on your own computer. How it is built is in
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

- [What works today](#what-works-today)
- [Install](#install)
- [Start it](#start-it)
- [A first tour](#a-first-tour)
- [Where your work is kept](#where-your-work-is-kept)
- [Settings](#settings)
- [Photoreal renders with Blender](#photoreal-renders-with-blender-optional)
- [Accounts and teams](#accounts-and-teams)
- [Using it from scripts](#using-it-from-scripts)
- [Updating](#updating)
- [Troubleshooting](#troubleshooting)
- [Working on the code](#working-on-the-code)

## What works today

Pavé is under construction. The engine and the CAD workspace come first; the rest follows.

| Area | State |
| --- | --- |
| Workspace: home, collections, pieces, library of metals, stones, cuts and ring sizes | Works |
| Templates: 14 starting points, from a solitaire to an iced-out trophy pendant | Works |
| CAD (the **Design** tab): feature list, inspector, live weight, carats and stone count, manufacturability checks, undo and redo | Works; being tested and fixed, so expect rough edges |
| Exports: STL, 3MF, OBJ, GLB, STEP, 3DM | Works |
| Production package: spec sheet, drawings, files, stone list, cost estimate, checks, as a zip | Works [from a script](#using-it-from-scripts); its screen is not built yet |
| Photoreal renders through Blender | The renderer works and is tested; its screen is not built yet |
| Assistant, ideas boards, brand models, sourcing, publishing | Not built yet. Their pages are placeholders |
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
git clone -b claude/busy-bardeen-o482lo https://github.com/tejjogani/ffdraft.git pave
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
6. says whether the optional Blender renderer is installed (and installs it with `--render`);
7. starts Pavé once on a spare port with a throwaway data folder, checks that it answers, and
   stops it.

It installs nothing outside this folder apart from pnpm, deletes nothing, and can be run again
at any time.

| Option | What it does |
| --- | --- |
| `--start` | Start Pavé as soon as the install finishes |
| `--render` | Also install the Blender renderer (see [below](#photoreal-renders-with-blender-optional)) |
| `--check` | Change nothing; report what is ready and what is not |
| `--no-smoke` | Skip the start-up check in step 7 |

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

## A first tour

1. On **Home**, pick a piece under *Jump back in*, or a template under *Start from a template*.
2. Open the **Design** tab. The first time takes a few seconds while the geometry engine loads.
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

Undo and redo work for every change, and the **History** tab lists them.

## Where your work is kept

Everything is in one folder, `.data`, inside the Pavé folder: the database, uploaded and
exported files, and a generated key.

| To | Do this |
| --- | --- |
| Back up | Stop Pavé, copy the `.data` folder somewhere safe |
| Move to another computer | Install Pavé there, stop it, copy your `.data` folder in |
| Start over with a fresh workspace | Stop Pavé, delete (or rename) `.data`, start it again |
| Keep the data somewhere else | Set `PAVE_DATA_DIR` (see Settings) |

Your designs stay on your computer: set up this way, Pavé has no outside services to talk to.

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

The full list, with comments, is in [`apps/server/.env.example`](apps/server/.env.example).

To use a different port once, without editing the file:

```bash
PORT=9000 pnpm start
```

On Windows PowerShell: `$env:PORT=9000; pnpm start`.

## Photoreal renders with Blender (optional)

Pavé's own 3D view needs nothing extra. Final-quality stills use Blender's Cycles renderer, which
is a separate, optional install.

```bash
./install.sh --render
```

This needs **Python 3.13** on your computer (Blender 5.3's Python module supports only that
version) and downloads about 1 GB. If you already have Blender 5.3 installed, skip this and set
`PAVE_BLENDER` in `apps/server/.env` to the Blender program instead.

Renders run on your processor unless Blender finds a supported graphics card; a 512-pixel
preview took about 20 seconds on a four-core machine without one.

The render screen in the application is not built yet, so for now this install is only useful
to developers calling the `renders.create` command.

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
| The Design tab stays on "Preparing the workbench…" | The first load can take up to half a minute on a slow computer. If it never finishes, reload the page and check the terminal for errors |
| A heavily iced piece is slow | Pieces with hundreds of stones take a second or two per change today. This is being worked on |
| `--render` fails with "CPython 3.13 not found" | Install Python 3.13, or install Blender 5.3 and set `PAVE_BLENDER` |
| PowerShell: "running scripts is disabled on this system" | `powershell -ExecutionPolicy Bypass -File .\install.ps1` |
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

| Folder | What is in it |
| --- | --- |
| `packages/schema` | The contract: metals, stones and sizes, the design document, templates, every command |
| `packages/kernel` | Geometry: builds a design into solids and stones; exports |
| `packages/canon` | Design rules, style guides and reference designs |
| `packages/render` | Materials, lighting, scene description, the Blender job runner |
| `packages/production` | Drawings, bill of materials, costing, the manufacturer's package |
| `packages/sourcing` | Stone requirements from CAD; marketplace links |
| `packages/ui` | Colours, type and components |
| `apps/server` | The local server: storage, commands, files, usage, history |
| `apps/studio` | The application you see in the browser |
| `workers/render` | The program that runs inside Blender |
| `docs` | Architecture, research, build briefs, strategy |

## Licence

Pavé is proprietary software; see [`LICENSE`](LICENSE). The render runner in `workers/render` is
a separate program under the GPL, because it runs inside Blender.
