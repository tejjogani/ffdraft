# Export local CAD evaluation examples

With your local Pavé server running, enable **Allow evaluation use** in **Settings → Privacy**
if you want to export examples. Use the project ID from its URL and choose a new file path in a
directory you control.

```bash
pnpm cad:examples --piece=pc_… --out=./cad-examples.jsonl
```

The command reads from the local server at `127.0.0.1:8787`. Set `PORT` in the terminal if Pavé
uses a different port. The running server's `PAVE_DATA_DIR` determines which workspace it reads.
The command checks consent before reading the project and again before publishing the file.
An export already on disk stays there until you remove it. The command writes locally and performs
no uploads or model calls.

Each JSONL row is one committed CAD edit from the project's starting snapshot, newest first.
Version 1 captures a single numeric band width or thickness change, or a single numbered prong-tip
offset. Each row contains the feature and field, the before and after values in millimetres,
the actor type, and whether the edit was an undo. For a tip with no offset, the value is zero.
The file contains no project or actor identifiers, labels, project text, conversation or trace
content, timestamps, or geometry.

These examples cover measurable changes in contiguous CAD history. Multi-operation and
multi-field changes, no-op edits, and fields outside the format are skipped. If the snapshot
cannot be backed out through its recorded edits, the export stops without publishing a file.
An edit example records a change in parameters, so it gives no evidence about design intent,
user satisfaction, or manufacturability.
