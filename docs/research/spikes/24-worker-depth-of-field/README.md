# Depth of field in the render worker

26 November 2026. Measured in Blender 5.3.0 (`bpy`), Cycles on two CPU threads, on the fixture
solitaire (a 6.5 mm round diamond in yellow gold), through the real worker
(`workers/render/pave_worker`). Stills at 512 to 1024 px, preview quality unless said.

**What was wrong.** The job is in millimetres and the worker builds its scene in metres. Cycles
sizes the aperture as focal length ÷ (2 × f-stop) and reads it as metres whatever the unit
scale, so in the worker an f-stop is a real lens's. A real lens that close to a ring holds a
fraction of a millimetre sharp:

- The cinematographer's macro (105 mm, 60 mm from the stone, f/5.6): the whole stone out of
  focus. This is the release check's "macro out of focus".
- A rack focus at its old default f/2.8 on the hero shot: nothing in focus at either end.
- Any shot given an f-stop by hand (the hero at f/4): the stone it is focused on is soft and
  the band dissolves.

The laptop's finding (a scene at 1 unit = 1 mm, where the same f-number gives no blur at all)
is the same rule seen from the other side.

**The rule that predicts it.** A point `d` mm from the camera, with the lens focused at `D` mm,
is smeared over this share of the frame's larger side:

    blur = f² × |d − D| ÷ (36 × N × D × d)        f = focal length in mm, N = f-stop

`workers/render/tests/test_camera.py` renders an edge 4 mm behind the focus through the
worker's own camera and measures it: 10.1 px against 10.0 predicted at f/5.6, 2.7 against 2.6
at f/22 (256 px frame).

**What the product does now** (`packages/render/src/camera.ts`, `animation.ts`):

- A shot with an f-stop is rendered at the aperture that keeps its stone in focus sharp front
  to back (blur under 0.15 % of the frame): about f/240 for the macro, f/73 for the hero. The
  band behind stays a little soft. A higher f-stop in the scene deepens the focus in proportion.
- A rack focus sets its own aperture: the one that blurs the far end of the pull by 2 % of the
  frame while the near end is sharp (f/28 on the hero, f/93 on the macro).
- A shot focused on a metal part, or a piece with no centre stone, still gets its f-stop as a
  real lens's.

| Picture | Left to right |
|---|---|
| `macro-f5.6-real_closed_none.jpg` | The macro at a real f/5.6 (before); closed to f/244 (now); no depth of field |
| `macro-stone-crop.jpg` | The same three, cropped on the stone |
| `rack-focus-f2.8-real_near_far.jpg` | Hero rack focus: the near end at a real f/2.8 (before); the near end now; the far end now |

**Not looked at.** No rack focus was rendered as a moving sequence, only its two ends. At the
near end of the hero's pull the focus plane is in front of the ring, so the whole piece is soft
there: where the pull starts and ends is a question for the animation work. Only this one ring
was rendered.
