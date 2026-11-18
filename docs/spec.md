# The konte spec

A spec is one JSON file: who is in the story, and a list of scenes. Each scene is one shot: where everyone stands or moves, what the set is, how the camera frames it, and the words that go with it (a note and, if you like, dialogue). `konte lint` checks it; `konte render` draws it.

**Words never go in the picture.** Titles, notes, dialogue, camera directions and cast names are written on the storyboard sheet (`board-<look>.png`) and in `prompts.md`. The animatic, the shot clips and the review copy are pictures only.

## Units and directions

- Distances are **metres**. Times are **seconds from the start of the scene**, not of the film. Angles are **degrees**.
- The floor is the x–z plane; **y is up**. Positions on the floor are written `[x, z]`. Only a raw camera (`from`, `to`, `look`) uses `[x, y, z]`.
- `face: 0` looks along **+z**; `face: 90` looks along **+x**.
- A person is 1.75 m tall unless `cast.<id>.height` says otherwise.

## Top level

```json
{
  "konte": 1,
  "title": "Rooftop Chase",
  "logline": "One sentence about the whole piece.",
  "aspect": "9:16",
  "fps": 12,
  "cast": { },
  "scenes": [ ]
}
```

| Key | Meaning |
|---|---|
| `aspect` | `9:16` (default), `16:9`, `1:1`, `4:5` |
| `fps` | How many frames are drawn per second of story: 1 to 60, default 12. A sketch does not need more. In the mp4 each drawn frame is held for a whole number of video frames, enough to reach at least 24 frames a second (12 gives 24, 5 gives 25, 60 stays 60). Every scene gets at least one frame. |
| `cast` | Everyone and everything the story follows, by id |
| `scenes` | 1 to 60 scenes, played in order |

Numbers must be finite and positions within 100 km of the origin. A mistake in the spec (an unknown action, a missing cast id, a string where a number belongs) is reported as one sentence naming the scene and the key, and nothing is drawn.

## Cast

```json
"cast": {
  "courier": { "label": "Courier", "color": "#ff7a1a", "shoes": "#1b1b20" },
  "package": { "label": "Package", "kind": "object", "shape": "box", "size": [0.3, 0.22, 0.24] }
}
```

| Key | Meaning |
|---|---|
| `label` | The name on the board (cast legend, "In shot", dialogue), in the prompts and in `shots.json`. Any language works. |
| `kind` | `person` (default) or `object` |
| `color` | A hex colour (`#e8457e` or `#e47`). One colour per cast member is how they stay recognisable across cuts. |
| `height` | Person only, 0.3 to 4 metres |
| `shoes` | Person only, a second colour for the feet |
| `shape`, `size` | Object only. `shape` is `box`, `ball`, `cyl`, `bottle` or `shoe`; `size` is `[width, height, depth]`, all above 0, default `[0.4, 0.4, 0.4]` |

## Scene

```json
{
  "title": "The Gap",
  "seconds": 6,
  "note": "What happens, in a sentence or two. This is the Action line on the board.",
  "dialogue": [["courier", "Not today."]],
  "set": [ ],
  "actors": [ ],
  "camera": { },
  "beats": [3.0, 3.65, 4.6]
}
```

| Key | Meaning |
|---|---|
| `seconds` | Length of the scene, 0.5 to 600 |
| `note` | The **Action** line under the shot on the board, and the scene line of its prompts. Never drawn on any video. |
| `dialogue` | Spoken lines for the **Dialogue** row on the board and a `Dialogue:` line in both prompts. One line as a string (`"Go."`), or a list of `["who", "line"]` pairs or `{"who": "...", "line": "..."}` objects, up to 12. `who` is a cast id (the board shows that member's label and colour) or any other name, kept as written; leave it out for a line with no speaker. Never drawn on any video. |
| `floor` | Height of the ground, default 0. Use a negative floor with tall set pieces for rooftops. |
| `sky`, `ground` | Colours for the 3d look |
| `beats` | 1 to 4 times inside the scene that the board shows. Leave it out and konte picks the opening, the event (the top of a jump, the moment two people pass, or just after a change of action) and the end. |

### Set

Each piece is `{ "kind", "at": [x, z] }` plus:

| Key | Meaning |
|---|---|
| `kind` | `box`, `cyl`, `ball` (these need `size: [w, h, d]`), or a ready-made piece: `tree`, `table`, `chair`, `lamp`, `door`, `car` |
| `scale` | 0.05 to 50. Widens a ready-made piece. Trees, lamps, doors and cars also grow taller; tables and chairs keep their real height. |
| `turn` | Rotation about the vertical axis |
| `y` | Height of the piece's base, default the scene's floor |
| `label` | A name for your own reference in the spec. It is not drawn anywhere. |
| `color` | Override the grey |

Set pieces are solid. A camera described by size and angle looks for a clear view round them, and lint reports an actor who walks through one. Each piece is treated as a box on the world axes, so a wall turned 45° blocks a little more than it draws.

### Actors

```json
{ "who": "runner", "path": [[0, 0, -34], [5.4, 0, -2.2], [6.3, 0, 2.7], [12, 0, 22]],
  "do": [[0, "run"], [5.4, "leap"], [6.3, "run"]], "jump": [5.4, 6.3, 1.3] }
```

| Key | Meaning |
|---|---|
| `who` | An id from `cast` |
| `at` | `[x, z]`: stands here for the whole scene |
| `path` | `[[t, x, z], ...]`: is at each point at each time, moving in straight lines between them. Before the first key and after the last, the actor holds still at that key. Repeat a point with a later time to make someone wait. |
| `do` | One action, or `[[t, "action"], ...]` starting at 0 |
| `face` | Fixes the facing. Without it, a moving actor faces the way they travel. |
| `look` | Id of another actor in the scene: the head turns to them |
| `jump` | `[t0, t1, height]`. `leap` only gives the pose; `jump` is what lifts the body. |
| `floor` | This actor's ground height, when it differs from the scene's (a rooftop over a street) |
| `heldBy` | Object only: id of the person carrying it, for the whole scene. It needs no `at`. It rides at the waist, or beside the face when the holder does `show`. The camera can be `on` it. |
| `lift`, `turns` | Object only: height it hovers above its floor (0 or more); full turns over the scene when it does `spin` (default 1) |

**Actions.** Body: `stand`, `walk`, `run`, `kneel`, `sit`, `squat`, `leap`, `lie`. Gestures: `cheer`, `reach`, `wave`, `talk`, `carry`, `show` (one hand raised beside the face, holding a `heldBy` object up to the camera). Objects: `still`, `spin`, `float`.

A gesture can ride on a body action with `+`: `"sit+talk"`, `"walk+carry"`. The legs and torso come from the first, the arms from the second.

Walking reads right at about 1.4 m/s and running at 3 to 8 m/s. Lint tells you when a path and its body action disagree.

## Camera

Describe the shot the way a storyboard does, relative to the subject. konte works out where the camera has to be.

```json
"camera": { "on": "runner", "size": "FS", "angle": "side", "height": "eye", "move": "track" }
```

| Key | Values | Default |
|---|---|---|
| `on` | Id of the actor the shot is about | The first actor |
| `size` | `ECU`, `CU`, `MCU`, `MS`, `MLS`, `FS`, `WS`, `EWS` | `MS` |
| `angle` | `front`, `front34`, `side`, `back34`, `back`, or degrees round the subject from their front | `front34` |
| `height` | `ground`, `low`, `eye`, `high`, `bird`, `top`, or degrees above the horizon | `eye` |
| `move` | `static`, `pan`, `track`, `handheld`, `push`, `pull`, `orbit`, `crane-up`, `crane-down` | `static` |
| `part` | `face`, `chest`, `hands`, `feet`: aim at this part instead of the whole figure | |
| `side` | `left` or `right`: which side of the subject the camera takes | `right` |
| `strength` | 0 to 3: how far a `push`, `pull`, `orbit` or crane goes | 1 |
| `to` | `{ "size", "angle", "height", "part" }`: where the framing ends, for a move that changes the shot | |
| `fov` | Lens angle, 5 to 120 degrees, to override the one that comes with the size. `to.fov` changes it over the move. | |
| `avoid` | `false` to keep the requested angle even when the set blocks the view | |

What the moves mean:

- `static` and `pan` keep the camera where the subject is **at the middle of the scene**. `static` does not turn; `pan` turns to follow.
- `track`, `handheld`, `push`, `pull`, `orbit` and the cranes travel with the subject.
- The angle is measured from the subject's facing at the middle of the scene and then held, so the camera does not swing when a path bends.

If a set piece hides the subject, the camera tries the mirrored side and then a fixed list of other angles, takes the first with a clear enough view, and lint reports how far it moved (`info`). If none works, that is a lint error. Over-the-shoulder and raw cameras are checked the same way but never moved.

### Over the shoulder

```json
"camera": { "on": "mina", "over": "joon" }
```

The camera sits behind `over`'s shoulder and frames `on` from the chest up. `side` picks the shoulder; `distance` moves the camera further back.

### Raw camera

When you need an exact position:

```json
"camera": { "from": [0, 1.6, 6], "to": [0, 1.6, 3], "look": "runner", "fov": 40 }
```

`from` and `to` are `[x, y, z]` positions (here `to` is a position, not a framing). `look` is a point or an actor id. Nothing is solved for you, but lint still checks that the camera is not inside the set and that it can see the actor it looks at.

## Lint

`konte lint spec.json` reads the spec, solves every camera and reports problems without drawing a frame. It samples each scene about four times a second on the same staging model the renderer draws, with people and set pieces simplified to boxes. It catches staging mistakes; it does not replace looking at the board.

- **error**: the picture would be wrong. The camera is inside a set piece or passes through an actor, the subject is hidden from every angle, or out of frame for most of a moving shot. `konte render` still writes its files but exits with status 1.
- **warn**: it will look odd. Someone slides while standing, runs faster than a sprinter, leaps without a jump, walks through a set piece, outgrows the frame, has their head cut off in a medium or wider shot, is completely hidden for a second or more, the camera dips under the floor, or a note is too long for the board (over 160 characters).
- **info**: konte changed something to keep the shot working, such as swinging the camera round a wall, or something worth knowing, such as a scene longer than the reference clip a video model accepts (Seedance 2.0 documents 15 seconds of reference video in total, Kling 4.0 up to 30 seconds per clip).

## What comes out

| File | What it is |
|---|---|
| `board-<look>.png` | The storyboard sheet, laid out like a film storyboard: title, logline, runtime and a cast legend with each colour; then one card per shot with up to four numbered panels (1A, 1B, ...) and their timecodes, and Camera, Action, Dialogue and In shot rows under them; the lint report at the foot. This is the only output with words on it. |
| `sketch-<look>.mp4` | The animatic: the picture alone, with no words on it |
| `shots/NN-<look>.mp4` | One clip per scene, cut from the sketch on exact frames, meant as a reference video for a video model |
| `shots/NN-<look>-first.png`, `-last.png` | The first and last frame of each scene, for models that start from an image |
| `prompts.md` | Two prompts per shot: one for use with the clip as a reference video, one that describes the action in words for image-to-video models |
| `review-<look>.mp4` | With `--review`: the animatic with a line on the floor for where each actor travels in the shot. Still no words. (`--captions` from earlier versions is accepted and draws this same review copy.) |
| `shots.json` | Scene list for scripts: start, `seconds` as asked and `clipSeconds` as written, frame range, note, dialogue, camera (short and in words), beats and cast. `fps` is the rate frames were drawn at and `videoFps` the rate of the mp4. `files` lists everything this render wrote. `picture` is the size of the sketch. |

A render replaces what konte wrote in that folder before: files from an earlier render that this one did not write again (a fourth clip after the spec dropped to three scenes, the other look) are removed, so an old clip cannot be mistaken for a current one. konte only removes files that the earlier render listed in its own `shots.json`; anything else in the folder, and anything behind a link, is left alone. `--board-only` writes the board and nothing else, and says so if older files are beside it.

A scene's length is rounded to whole frames. At the default 12 frames a second that is invisible; at very low rates konte prints how long each clip really is and `prompts.md` uses that length. In the mp4 each drawn frame is held for a whole number of video frames, giving at least 24 frames a second.

Board timecodes are video time: each shot's range and each panel's time are read from the frames that were really drawn, so they match the mp4 even when a scene was rounded to whole frames.

Board text in any script needs a font for it on the machine that renders. macOS and Windows have them; on Linux, install one (for Korean, Japanese or Chinese, `fonts-noto-cjk`).

The camera line on the board and in the prompts is measured from the camera konte solved, so if it swung round a wall the words say where it ended up.

Looks: `3d` is a lit greybox; `2d` is flat three-tone fills with ink lines on paper. Both draw the same staging.
