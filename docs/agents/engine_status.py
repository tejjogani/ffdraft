import json, sys, glob, os
J = sys.argv[1]; R1 = sys.argv[2]; out = sys.argv[3]; stamp = sys.argv[4]
lab, res = {}, []
for l in open(J):
    e = json.loads(l)
    if e.get('type') == 'started': lab[e['key']] = e.get('label')
    elif e.get('type') == 'result': res.append((lab.get(e['key'], '?'), e.get('result')))
L = [f"# Engine test pass: status snapshot", "",
     f"_Generated {stamp} from the running workflow's journal. The pass is still running; this is the latest known state, not the final one. Re-generate it or read the final commit message when the pass ends._", "",
     "How the pass works: six testers (stones, pendants, freeform and pavé, core, exports and checks, performance and worker) tried to break the engine; fixers own one area each and fix blockers and majors; a fresh verifier re-runs every repro; up to three rounds per area. Scripts: `docs/agents/workflows/engine-test-pass.js` (round 1) and `engine-test-pass-continue.js` (rounds 2 and 3, the stone replacement build and the studio menus).", ""]
r1 = sorted(glob.glob(os.path.join(R1, '*-findings.json')))
if r1:
    L += ["## Round 1 (testers)", "", "| Area | Blockers | Majors | Minors |", "|---|---|---|---|"]
    for f in r1:
        try: d = json.load(open(f))
        except Exception: continue
        fs = d if isinstance(d, list) else d.get('findings', [])
        c = {s: sum(1 for x in fs if x.get('severity') == s) for s in ('blocker', 'major', 'minor')}
        L.append(f"| {os.path.basename(f).replace('-findings.json','')} | {c['blocker']} | {c['major']} | {c['minor']} |")
    L.append("")
L += ["## Later results, newest last", ""]
for name, v in res:
    L.append(f"### {name}")
    if isinstance(v, str):
        L += ["", v.strip()[:3000], ""]; continue
    if isinstance(v, dict):
        if isinstance(v.get('summary'), str): L += ["", v['summary'].strip()[:1500], ""]
        fs = v.get('findings') or []
        if fs:
            L += ["| Id | Severity | Summary |", "|---|---|---|"]
            for x in fs:
                s = (x.get('summary') or x.get('title') or '').replace('|', '\\|').replace('\n', ' ')
                L.append(f"| {x.get('id','')} | {x.get('severity','')} | {s[:300]} |")
            L.append("")
open(out, 'w').write('\n'.join(L) + '\n')
print(len(res), 'results;', out)
