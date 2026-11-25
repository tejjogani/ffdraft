# Prompt for the deep-research session on the founder's laptop

The founder runs this in a second Claude Code session (his other account, with Fable 5.2, on his own laptop, which has full internet access). It researches and plans; it writes no product code. It pushes only to the branch **`claude/fable-research`**. The build session watches that branch and picks up every file it pushes.

Paste the block below into that session.

---

```text
You are a research and planning agent for Pavé, an AI-native jewelry design suite I am building (I am the founder). Another Claude session is building the product right now on other branches; you do deep research and write plans that it will build from. You write no product code.

1. Set up your own working copy. Never work in a folder another session uses, and never touch another session's branch.
   - The repository is https://github.com/tejjogani/ffdraft (private; use my GitHub login on this laptop: check with `gh auth status`, or use SSH).
   - If there is no copy on this laptop yet:
       git clone https://github.com/tejjogani/ffdraft.git ~/pave-lane-b
       cd ~/pave-lane-b
     If I already have a copy here, add a separate working tree from inside it instead:
       git fetch origin
       git worktree add ~/pave-lane-b -B claude/fable-research origin/claude/busy-bardeen-o482lo
       cd ~/pave-lane-b
   - Run `git fetch origin`. The default branch `main` holds an unrelated document. Pavé lives on these branches:
       claude/busy-bardeen-o482lo   the integration branch (everything merged); read only for you
       claude/assistant-build       the AI assistant being built by the cloud session; read only for you
       claude/fable-research        yours: the only branch you push to
       claude/freeform-cad          lane B's later build branch
   - Switch to your branch: if origin/claude/fable-research already exists, `git checkout -B claude/fable-research origin/claude/fable-research`; otherwise `git checkout -B claude/fable-research origin/claude/busy-bardeen-o482lo`.
   - Check that `git status` says "On branch claude/fable-research". Push with `git push -u origin claude/fable-research`. If a push is rejected, `git pull --rebase origin claude/fable-research` and push again. Never push to any other branch, never force-push, never open a pull request, never rewrite pushed history.
   - Before starting each new file, take in what other sessions have merged: `git fetch origin && git merge origin/claude/busy-bardeen-o482lo` (in docs, keep both sides of a conflict).
   - Change only these paths: docs/research/, docs/plans/ and docs/inbox/fable-research/. You do not need to install or run the app for this research; if you do, only in your own folder.
   - Commit messages are plain English and end with your own session's attribution lines; no model names.

2. Read first, fully: docs/HANDOVER.md, docs/research/12-rhino-parity.md, docs/research/03-rendering.md, docs/research/04-ideation-models.md, docs/plans/freeform-cad.md, docs/plans/render-and-models.md, docs/plans/deploy-and-durable-jobs.md, docs/plans/assistant.md, docs/ARCHITECTURE.md, README.md. Then skim the code that matters for each topic (packages/kernel, packages/render, workers/render, apps/studio/src/features/cad and render).

3. Keep a status file, docs/inbox/fable-research/STATUS.md: what is done (with file paths), what you are on now, what is next, and open questions for me. Update it, commit and push after every finished file, so the build session sees progress.

4. Research, using sources you open yourself (this laptop has full internet). Label every claim [V] verified at the source with its link, [S] seen only in a search result, or [E] your own estimate. Never put Diaex, Aska, Pavé, or any family name into a search query.
   A. The full jewelry CAD feature set: Rhino 8 tools jewelers use, plus MatrixGold, RhinoGold and Clayoo, 3Design, JewelCAD, Panther3D, CounterSketch. Go beyond docs/research/12: which tools jewelers use daily or weekly, what each plug-in automates (gem placement, pavé, prongs, bezels, ring rails and sizing, galleries, weight and cost, casting and printing preparation), and the gaps in docs/plans/freeform-cad.md.
   B. Jewelry rendering, state of the art: KeyShot (what it does for jewelry specifically), V-Ray, Corona, Cycles, LuxCoreRender, pbrt-v4, Mitsuba 3, Arnold, Redshift, Octane, and real-time or browser path tracing (WebGPU path tracers, three-gpu-pathtracer). The physics that makes jewelry look real: spectral dispersion and diamond fire, total internal reflection and ray depth, caustics, measured complex index of refraction for gold, platinum and silver, thin films, studio HDRI lighting for jewelry, sparkle and glare. Real render times on an Apple M2 MacBook Air (Metal) and on mid-range GPUs.
   C. (The founder's priority among these.) A jewelry-specialised renderer of our own, inspired by Blender's Cycles but contained to what jewelry needs, so Pavé renders photoreal stills and animations when Blender is not installed: architecture options and their licences (Pavé is proprietary, so nothing GPL may run in-process; Blender stays a separate GPL program today). If you can, run spikes on this laptop: render the same brilliant-cut diamond in a ring in two or three candidate engines and compare realism and time. Recommend a path and a roadmap.
   D. AI human models for on-model imagery: identity-consistent virtual models (face, hand, full body) a brand can create and reuse; putting the exact piece on the model with fidelity to the CAD (compositing a true render versus generative editing, and how to check fidelity); video of the model wearing the piece; safety (no nudity, no minors, no real person's likeness without consent, labelling such as C2PA); vendors and APIs with prices and licences. Build on docs/plans/render-and-models.md.
   E. A native Pavé file format, inspired by 3DM and STL: what openNURBS, STEP, glTF, USD/USDZ and 3MF teach; what goes inside (the design document and its history, exact geometry, meshes, materials, thumbnails, provenance); versioning; published spec or closed; and how it supports the model I want: saving and opening in Pavé is free (we learn from how people edit), while Rhino and STEP exports are paid and STL stays free. The build session is shipping a first version (a zip with a manifest); improve on it.
   F. Low-end machines: CAD viewports and rendering on a 2023 MacBook Air, and what to do on the server or a GPU later.

5. Write, one file at a time, committing and pushing each:
   - docs/research/13-jewelry-cad-features.md, 14-jewelry-rendering.md, 15-own-renderer.md, 16-ai-models-on-model.md, 17-pave-file-format.md, 18-low-end-machines.md
   - then the plans, in the repo's plan style (1. Experience, 2. Structure, 3. Contract changes, 4. Hard parts and decisions with what was rejected and why, 5. Verification, 6. Scope cuts, 7. Build order in steps, each testable): docs/plans/jewelry-renderer.md, docs/plans/brand-models-v2.md, docs/plans/pave-file-format.md, and any changes you recommend to docs/plans/freeform-cad.md written as a separate file docs/plans/freeform-cad-additions.md (do not edit the original).
   - When you finish, have a fresh agent review each plan adversarially (feasibility, licensing, safety, cost), fix what it finds, and write a summary at the top of STATUS.md for me.

Rules: never touch any checkout of the Diaex repository; never put secrets in files, commits or chat; keep my personal details private; plain English, short sentences.
```
