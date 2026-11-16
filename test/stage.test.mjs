import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadSpec, lint, actorAt, project, safeName, frameOfBeat, frameRanges } from "../src/stage.js";
import { poseOf } from "../src/pose.js";

const one = (scene, cast = { a: {}, b: {}, box: { kind: "object", size: [0.2, 0.2, 0.2] } }) => loadSpec({ cast, scenes: [{ seconds: 4, ...scene }] });
const msgs = (stage) => lint(stage).map((n) => `${n.level}: ${n.msg}`);

test("every shipped example loads and lints without errors", () => {
  for (const f of readdirSync(new URL("../examples/", import.meta.url))) {
    const stage = loadSpec(JSON.parse(readFileSync(new URL("../examples/" + f, import.meta.url), "utf8")));
    assert.deepEqual(stage.errors, [], f);
    assert.deepEqual(lint(stage).filter((n) => n.level === "error"), [], f);
  }
});

test("bad specs come back as sentences, never as a throw", () => {
  const bad = [
    null, {}, { scenes: [] }, { scenes: [null] }, { cast: { a: null }, scenes: [{ seconds: 2 }] },
    { cast: { a: {} }, scenes: [{ seconds: "2", actors: [{ who: "a", at: [0, 0] }] }] },
    { fps: 0, cast: { a: {} }, scenes: [{ seconds: 2, actors: [{ who: "a", at: [0, 0] }] }] },
    { cast: { a: {} }, scenes: [{ seconds: 2, actors: [{ who: "a", at: [0, 0], do: [] }] }] },
    { cast: { a: {} }, scenes: [{ seconds: 2, actors: [{ who: "a", path: [[0, "x", 0], [2, 1, 0]] }] }] },
    { cast: { a: {} }, scenes: [{ seconds: 2, actors: [{ who: "a", at: [0, 0] }], camera: { to: { size: "XX" } } }] },
    { cast: { a: {} }, scenes: [{ seconds: 2, actors: [{ who: "a", at: [0, 0] }], camera: { from: [0, 1, 5], look: "missing" } }] },
    { cast: { a: {} }, scenes: [{ seconds: 2, actors: [{ who: "a", at: [0, 0] }], camera: { size: "toString" } }] },
    { cast: { a: {} }, scenes: [{ seconds: 2, set: [{ kind: "constructor", at: [0, 0] }], actors: [{ who: "a", at: [0, 0] }] }] },
    { cast: { a: {} }, scenes: [{ seconds: 2, actors: [{ who: "a", at: [0, 0], do: "fly" }] }] },
    { cast: { a: {} }, scenes: [{ seconds: 2, actors: [{ who: "a", at: [0, 0], jump: [1, 0.5, 1] }] }] },
    { cast: { a: {} }, scenes: [{ seconds: 2, actors: [{ who: "a", at: [0, 0], look: "a" }] }] },
    { cast: { a: {} }, scenes: [{ seconds: 2, actors: [{ who: "a", at: [0, 0] }], camera: { move: "push", to: { size: "CU", fov: "bad" } } }] },
    { cast: { a: {} }, scenes: [{ seconds: 2, actors: [{ who: "a", at: [0, 0] }], camera: { move: "push", to: { size: "CU", fov: 0 } } }] },
    { cast: { a: {}, b: {} }, scenes: [{ seconds: 2, actors: [{ who: "a", at: [0, 0] }, { who: "b", at: [2, 0] }], camera: { on: "typo", over: "b" } }] },
    { cast: { a: {} }, scenes: [{ seconds: 2, actors: [{ who: "a", at: [0, 0] }], camera: { size: ["FS"] } }] },
    { cast: { a: {} }, scenes: [{ seconds: 2, actors: [{ who: "a", at: [0, 0, 55] }] }] },
    { cast: { a: {} }, scenes: [{ seconds: 2, actors: [{ who: "a", path: [[0, -1e308, 0], [2, 1e308, 0]] }] }] },
    { cast: { a: {} }, scenes: [{ seconds: 0.01, actors: [{ who: "a", at: [0, 0] }] }] },
    { cast: { a: {} }, scenes: [{ seconds: 2, beats: [3], actors: [{ who: "a", at: [0, 0] }] }] },
    { aspect: ["16:9"], cast: { a: {} }, scenes: [{ seconds: 2, actors: [{ who: "a", at: [0, 0] }] }] },
    { cast: { a: {} }, scenes: [{ seconds: 2, floor: 1e308, actors: [{ who: "a", at: [0, 0] }] }] },
  ];
  for (const spec of bad) {
    const stage = loadSpec(spec);
    assert.ok(stage.errors.length > 0, JSON.stringify(spec));
    for (const e of stage.errors) assert.equal(typeof e, "string");
  }
});

test("an actor is exactly where the path says at each key, and holds outside it", () => {
  const st = one({ actors: [{ who: "a", path: [[1, 0, 0], [3, 4, 0]] }] }), a = st.scenes[0].actors[0];
  assert.deepEqual(actorAt(a, 0, 4).pos, [0, 0, 0]);
  assert.deepEqual(actorAt(a, 2, 4).pos, [2, 0, 0]);
  assert.deepEqual(actorAt(a, 4, 4).pos, [4, 0, 0]);
  assert.ok(Math.abs(actorAt(a, 2, 4).face - Math.PI / 2) < 1e-6, "faces the way it travels (+x is 90°)");
});

test("two people can look at each other", () => {
  const st = one({ actors: [{ who: "a", at: [0, 0], face: 0, look: "b" }, { who: "b", at: [2, 0], face: 0, look: "a" }] });
  assert.deepEqual(st.errors, []);
  const [a, b] = st.scenes[0].actors;
  assert.ok(actorAt(a, 1, 4).turn > 1 && actorAt(b, 1, 4).turn < -1);
});

test("a held object rides in front of its holder", () => {
  const st = one({ actors: [{ who: "a", path: [[0, 0, 0], [4, 0, 4]], do: "walk+carry" }, { who: "box", heldBy: "a", at: [9, 9] }] });
  assert.deepEqual(st.errors, []);
  const [a, box] = st.scenes[0].actors, p = actorAt(a, 2, 4).pos, q = actorAt(box, 2, 4).pos;
  assert.ok(Math.hypot(p[0] - q[0], p[2] - q[2]) < 0.5 && q[1] > 0.7);
});

test("a jump starts and ends on the floor, with the take-off and landing poses at its ends", () => {
  const st = one({ actors: [{ who: "a", path: [[0, 0, 0], [4, 0, 8]], do: [[0, "run"], [1, "leap"], [2, "run"]], jump: [1, 2, 1.2] }] }), a = st.scenes[0].actors[0];
  assert.equal(actorAt(a, 1, 4).air, 0); assert.equal(actorAt(a, 2, 4).air, 1);
  assert.ok(Math.abs(actorAt(a, 1.5, 4).pos[1] - 1.2) < 1e-9);
  assert.ok(Math.abs(actorAt(a, 2, 4).pos[1]) < 1e-9);
});

test("the camera keeps its subject in frame for every size and move", () => {
  for (const size of ["ECU", "CU", "MCU", "MS", "MLS", "FS", "WS", "EWS"]) for (const move of ["static", "pan", "track", "push", "pull", "orbit", "crane-up", "crane-down", "handheld"]) {
    const st = one({ actors: [{ who: "a", path: [[0, 0, 0], [4, 0, 3]], do: "walk" }], camera: { on: "a", size, move } }), sc = st.scenes[0];
    assert.deepEqual(st.errors, []);
    if (move === "static") continue;  // a locked-off camera lets a walker leave: lint says so instead
    for (const t of [0, 2, 4]) { const c = sc.camera.at(t), q = project(c, st.aspect, c.aim); assert.ok(q.z > 0 && Math.abs(q.x) < 1 && Math.abs(q.y) < 1, `${size} ${move} at ${t}s`); }
  }
});

test("the camera swings round a wall that hides the subject, and says so", () => {
  const st = one({ set: [{ kind: "box", at: [0, 2], size: [6, 3, 0.2] }], actors: [{ who: "a", at: [0, 0], face: 0 }], camera: { on: "a", size: "FS", angle: "front" } });
  assert.ok(st.scenes[0].camera.moved !== 0);
  assert.ok(msgs(st).some((m) => m.startsWith("info: camera swung")));
});

test("lint catches what would look wrong on screen", () => {
  const has = (scene, text) => assert.ok(msgs(one(scene)).some((m) => m.includes(text)), `${text} ← ${JSON.stringify(msgs(one(scene)))}`);
  has({ actors: [{ who: "a", path: [[0, 0, 0], [4, 0, 60]], do: "run" }], camera: { on: "a", move: "track" } }, "runs at");
  has({ actors: [{ who: "a", path: [[0, 0, 0], [4, 0, 6]], do: "stand" }], camera: { on: "a", move: "track" } }, "slides");
  has({ actors: [{ who: "a", path: [[0, 0, 0], [4, 0, 6]], do: [[0, "run"], [1, "leap"]] }], camera: { on: "a", move: "track" } }, "without a \"jump\"");
  has({ actors: [{ who: "a", path: [[0, 0, 0], [4, 0, 30]], do: "run" }], camera: { on: "a", size: "MS", move: "static" } }, "out of frame");
  has({ set: [{ kind: "box", at: [0, 5], size: [2, 3, 2] }], actors: [{ who: "a", at: [0, 0] }], camera: { from: [0, 1, 5], look: "a" } }, "inside a set piece");
  has({ set: [{ kind: "box", at: [0, 3], size: [2, 3, 2] }], actors: [{ who: "a", path: [[0, 0, 0], [4, 0, 6]], do: "walk" }], camera: { on: "a", move: "track", angle: "side" } }, "passes through a set piece");
});

test("a set piece turned a full circle blocks the same space as one not turned", () => {
  for (const turn of [0, 360]) assert.deepEqual(msgs(one({ set: [{ kind: "box", at: [0, 0], size: [0.1, 2, 4], turn }], actors: [{ who: "a", at: [1, 0] }], camera: { from: [4, 1, 0], look: "a" } })), []);
});

test("the board shows the event: the top of a jump, or the moment two people pass", () => {
  const jump = one({ actors: [{ who: "a", path: [[0, 0, 0], [4, 0, 8]], do: [[0, "run"], [1, "leap"], [2, "run"]], jump: [1, 2, 1] }] });
  assert.equal(jump.scenes[0].beats[1], 1.5);
  const pass = one({ actors: [{ who: "a", path: [[0, 0, -6], [4, 0, 6]], do: "walk" }, { who: "b", at: [0.8, 1.5] }], camera: { on: "a", move: "track" } });
  assert.ok(Math.abs(pass.scenes[0].beats[1] - 2.5) < 0.2);
  assert.deepEqual(one({ beats: [0.5, 3], actors: [{ who: "a", at: [0, 0] }] }).scenes[0].beats, [0.5, 3]);
});

test("poses are finite, and a combined action takes the body of one and the arms of the other", () => {
  for (const action of ["stand", "walk", "run", "kneel", "sit", "squat", "leap", "cheer", "reach", "wave", "talk", "carry", "lie", "sit+talk", "walk+carry"]) {
    for (const blend of [null, { from: "run", k: 0.4 }]) { const p = poseOf({ action, blend, time: 1.3, dist: 2.1, air: 0.3, turn: 0.2 }); for (const [k, v] of Object.entries(p)) if (k !== "hands") assert.ok(Number.isFinite(v), `${action}.${k}`); }
  }
  const sit = poseOf({ action: "sit", time: 1, dist: 0 }), both = poseOf({ action: "sit+talk", time: 1, dist: 0 }), talk = poseOf({ action: "talk", time: 1, dist: 0 });
  assert.equal(both.thL, sit.thL); assert.equal(both.elR, talk.elR);
});

test("a combined action is linted by its body action", () => {
  const m1 = msgs(one({ actors: [{ who: "a", path: [[0, 0, 0], [4, 0, 60]], do: "run+carry" }], camera: { on: "a", move: "track" } }));
  assert.ok(m1.some((m) => m.includes("runs at")), JSON.stringify(m1));
  const m2 = msgs(one({ actors: [{ who: "a", path: [[0, 0, 0], [4, 0, 6]], do: [[0, "run"], [1, "leap+wave"]] }], camera: { on: "a", move: "track" } }));
  assert.ok(m2.some((m) => m.includes("without a \"jump\"")), JSON.stringify(m2));
});

test("a raw camera is linted too: a wall crossed mid-move and a camera under the floor", () => {
  const wall = loadSpec({ cast: { a: {} }, scenes: [{ seconds: 60, set: [{ kind: "box", at: [0, 3], size: [2, 3, 0.05] }], actors: [{ who: "a", at: [0, 0] }], camera: { from: [-15, 1, 5], to: [15, 1, 5], look: "a" } }] });
  assert.ok(msgs(wall).some((m) => m.includes("completely hidden")), JSON.stringify(msgs(wall)));
  assert.ok(msgs(one({ actors: [{ who: "a", at: [0, 0] }], camera: { from: [0, -1, 6], look: "a" } })).some((m) => m.includes("below the floor")));
});

test("a held object needs no position of its own", () => {
  assert.deepEqual(one({ actors: [{ who: "a", at: [0, 0] }, { who: "box", heldBy: "a" }] }).errors, []);
});

test("every scene owns its frames: no scene is lost and a beat never shows a neighbour", () => {
  const mk = (lens, fps) => { const st = loadSpec({ fps, cast: { a: {} }, scenes: lens.map((seconds) => ({ seconds, beats: [0, seconds], actors: [{ who: "a", at: [0, 0] }] })) }); assert.deepEqual(st.errors, []); return [st, frameRanges(st, fps)]; };
  for (const [lens, fps] of [[[1, 1], 12], [[0.5, 0.5], 1], [[0.7, 2.2, 0.6, 1], 12], [[0.5, 0.5, 0.5, 0.5, 0.5], 3], [[14, 16, 12, 18], 12], [[1.3, 0.9, 2.05], 24]]) {
    const [st, R] = mk(lens, fps);
    assert.equal(R[0].first, 0);
    R.forEach((r, i) => { assert.ok(r.last >= r.first, `scene ${i + 1} has a frame`); if (i) assert.equal(r.first, R[i - 1].last + 1); });
    st.scenes.forEach((sc, i) => { for (const bt of sc.beats) { const f = frameOfBeat(R[i], bt, fps); assert.ok(f >= R[i].first && f <= R[i].last, `${lens} @${fps}: scene ${i + 1} beat ${bt}`); } });
  }
  const [, R] = mk([1, 1], 12);
  assert.deepEqual(R, [{ first: 0, last: 11 }, { first: 12, last: 23 }]);
});

test("a title cannot name a folder outside the output directory", () => {
  for (const t of ["..", "../../etc", "/abs", ".", "", "a/b", "..\\x"]) { const n = safeName(t); assert.ok(n && !n.startsWith(".") && !/[\\/]/.test(n), `${t} → ${n}`); }
  assert.equal(safeName("카페, 오후"), "카페-오후");
});

test("the CLI exits 0 on a clean spec, 1 on a broken one, and names what is wrong", () => {
  const cli = fileURLToPath(new URL("../cli.mjs", import.meta.url)), run = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });
  const ok = run("lint", fileURLToPath(new URL("../examples/cafe.json", import.meta.url)));
  assert.equal(ok.status, 0); assert.match(ok.stdout, /ok\s*$/);
  assert.equal(run("lint", "/no/such/file.json").status, 1);
  const noValue = run("render", "x.json", "--look"); assert.equal(noValue.status, 1); assert.match(noValue.stderr, /--look needs a value/);
  assert.equal(run("frobnicate").status, 1);
});

test("a lens change alone is a zoom", () => {
  const cam = one({ actors: [{ who: "a", at: [0, 0] }], camera: { on: "a", fov: 45, to: { fov: 90 } } }).scenes[0].camera;
  assert.equal(cam.at(0).fov, 45); assert.equal(cam.at(4).fov, 90);
});

test("a camera on a held object stays at the height of the hand", () => {
  const st = one({ actors: [{ who: "a", at: [0, 0], face: 0, do: "stand+show" }, { who: "box", heldBy: "a" }], camera: { on: "box", size: "MS", angle: "front", avoid: false } });
  assert.deepEqual(st.errors, []);
  const c = st.scenes[0].camera.at(2), box = actorAt(st.scenes[0].actors[1], 2, 4);
  assert.ok(box.pos[1] > 1.3, "raised beside the face");
  assert.ok(Math.abs(c.pos[1] - c.look[1]) < 0.2 && c.pos[1] > 1.2, `camera at ${c.pos[1].toFixed(2)} looks level at ${c.look[1].toFixed(2)}`);
});

// ── the words that go with each shot ────────────────────────────────────────
import { colourName, colourNames, actionsOf, cameraWords, promptsFor } from "../src/prompts.js";

test("colours get plain names, and two figures never share one", () => {
  assert.equal(colourName("#8f6bff"), "purple"); assert.equal(colourName("#abc"), colourName("#aabbcc"));
  const st = loadSpec({ cast: { a: { color: "#1040c0" }, b: { color: "#9ab8ff" }, c: { color: "#2050d0" } }, scenes: [{ seconds: 2, actors: [{ who: "a", at: [-1, 0] }, { who: "b", at: [0, 0] }, { who: "c", at: [1, 0] }], camera: { on: "b", size: "WS", angle: "front" } }] });
  assert.deepEqual(st.errors, []);
  const names = colourNames(st.scenes[0], st.aspect);
  assert.equal(new Set(names).size, 3, names.join(" | "));
  const reds = loadSpec({ aspect: "16:9", cast: { a: { color: "#f00" }, b: { color: "#f00" }, c: { color: "#f00" } }, scenes: [{ seconds: 2, actors: [{ who: "a", at: [-3, 0] }, { who: "b", at: [-2, 0] }, { who: "c", at: [-1, 0] }], camera: { from: [0, 2, 12], look: [0, 1, 0], fov: 60 } }] });
  const three = colourNames(reds.scenes[0], reds.aspect);
  assert.equal(new Set(three).size, 3, three.join(" | ")); assert.match(three[0], /first red one from the left/); assert.match(three[2], /third/);
});

test("a colour that is not a colour is an error, not a crash later", () => {
  for (const bad of [{ toString: null }, 12, "#12", "rgb(1,2,3)", "notacolor", "transparent"]) assert.match(loadSpec({ cast: { a: { color: bad } }, scenes: [{ seconds: 1, actors: [{ who: "a", at: [0, 0] }] }] }).errors.join(), /cast\.a\.color/);
  assert.match(one({ sky: 5, actors: [{ who: "a", at: [0, 0] }] }).errors.join(), /"sky"/);
});

test("the action line keeps the times, the jump, the held thing and a label with odd characters", () => {
  const st = loadSpec({ cast: { a: { label: "$& Ann" }, box: { label: "$1 box", kind: "object" }, toy: { label: "Toy", kind: "object" } }, scenes: [{ seconds: 10,
    actors: [{ who: "a", path: [[0, 0, 0], [10, 20, 0]], do: [[0, "run"], [4, "leap"], [5, "run+show"]], jump: [4, 5, 1.2] }, { who: "box", heldBy: "a" }, { who: "toy", at: [3, 3], do: "spin", turns: 2 }], camera: { on: "a", size: "WS", angle: "side", move: "track" } }] });
  assert.deepEqual(st.errors, []);
  const [ann, toy] = actionsOf(st.scenes[0]);
  assert.match(ann, /^\$& Ann: 0-4s runs; 4-5s is in a running jump pose/); assert.match(ann, /off the ground from 4s to 5s/); assert.match(ann, /holding \$1 box up/); assert.match(ann, /1\.2 m high/); assert.match(ann, /covers about 20 m, heading towards the (left|right) of the frame while the camera keeps pace/);
  assert.match(toy, /^Toy: turns on the spot, 2 turns/);
  const whole = actionsOf(one({ actors: [{ who: "a", at: [0, 0], do: "leap", jump: [1, 2, 1] }] }).scenes[0])[0];
  assert.match(whole, /off the ground from 1s to 2s/);
  const crosses = actionsOf(one({ actors: [{ who: "a", path: [[0, -4, 0], [4, 4, 0]], do: "walk" }], camera: { from: [0, 1.5, 9], look: [0, 1, 0] } }).scenes[0], 9 / 16)[0];
  assert.match(crosses, /moving left to right across the frame/);
  assert.equal(actionsOf(one({ actors: [{ who: "a", at: [0, 0], do: "kneel" }] }).scenes[0])[0], "a: is down on one knee");
});

test("the camera line describes the camera that was solved", () => {
  const wall = { kind: "box", at: [0, 1.5], size: [6, 3, 0.3] };
  const swung = one({ set: [wall], actors: [{ who: "a", at: [0, 0], face: 0 }], camera: { on: "a", size: "FS", angle: "front" } }).scenes[0];
  assert.notEqual(swung.camera.moved, 0); assert.doesNotMatch(cameraWords(swung), /from the front/);
  assert.match(cameraWords(one({ actors: [{ who: "a", at: [0, 0], face: 0 }], camera: { on: "a", size: "FS", angle: "front" } }).scenes[0]), /full shot on a, eye level, from the front, locked off/);
  assert.match(cameraWords(one({ actors: [{ who: "a", at: [0, 0] }], camera: { on: "a", fov: 45, to: { fov: 20 } } }).scenes[0]), /zooming in/);
  assert.match(cameraWords(one({ actors: [{ who: "a", at: [0, 0] }], camera: { from: [0, 1.5, 8], to: [0, 1.5, 3], look: "a" } }).scenes[0]), /on a, .*pushing in/);
  assert.match(cameraWords(one({ actors: [{ who: "a", path: [[0, -10, 0], [4, 10, 0]], do: "run" }], camera: { on: "a", size: "FS", angle: "side", move: "track" } }).scenes[0]), /tracking with a/);
  assert.match(cameraWords(one({ actors: [{ who: "a", at: [0, 0], face: 0 }], camera: { on: "a", size: "MS", angle: "front", move: "push", strength: 0.3 } }).scenes[0]), /pushing in/);
  assert.match(cameraWords(one({ actors: [], camera: { from: [-3, 2, 5], to: [3, 2, 5], look: [0, 1, 0] } }).scenes[0]), /orbiting/);
  assert.match(cameraWords(one({ actors: [{ who: "a", at: [0, 0], face: 0 }], camera: { on: "a", size: "FS", angle: -45, to: { angle: 45 } } }).scenes[0]), /orbiting/);
  const fixed = cameraWords(one({ actors: [{ who: "a", path: [[0, 0, 0], [2, 3, 0], [4, 3, 3]], do: "walk" }], camera: { on: "a", size: "WS", angle: "front", move: "static" } }).scenes[0]);
  assert.match(fixed, /locked off/); assert.doesNotMatch(fixed, /pushing|panning/);
  assert.match(cameraWords(one({ actors: [{ who: "a", at: [0, 0], face: 0 }], camera: { on: "a", size: "WS", angle: 0, to: { angle: 360 } } }).scenes[0]), /orbiting a full circle/);
  assert.match(cameraWords(loadSpec({ cast: { a: {} }, scenes: [{ seconds: 6, actors: [{ who: "a", path: [[0, 0, 0], [3, 3, 0], [6, 0, 0]], do: "walk" }], camera: { on: "a", size: "FS", angle: "side", move: "track" } }] }).scenes[0]), /tracking with a/);
  const tiny = loadSpec({ cast: { a: { kind: "object", shape: "bottle", size: [0.08, 0.16, 0.08] } }, scenes: [{ seconds: 5, actors: [{ who: "a", at: [0, 0], floor: 0.9 }], camera: { on: "a", size: "CU", move: "push", strength: 0.3 } }] });
  assert.deepEqual(tiny.errors, []); assert.match(cameraWords(tiny.scenes[0]), /pushing in/);
  assert.match(cameraWords(one({ actors: [{ who: "a", at: [0, 0], face: 0 }], camera: { on: "a", size: "MS", angle: "front", move: "handheld" } }).scenes[0]), /from the front, handheld$/);
  const spun = one({ actors: [{ who: "box", at: [0, 0], do: "spin" }], camera: { on: "box", size: "MS", angle: "front" } });
  assert.doesNotMatch(cameraWords(spun.scenes[0]), /from the front/);
});

test("a held object follows the holder's cross-fade instead of jumping", () => {
  const st = one({ actors: [{ who: "a", at: [0, 0], face: 0, do: [[0, "stand"], [1, "stand+show"]] }, { who: "box", heldBy: "a" }] }), box = st.scenes[0].actors[1];
  const before = actorAt(box, 0.99, 4).pos[1], just = actorAt(box, 1.01, 4).pos[1], after = actorAt(box, 1.5, 4).pos[1];
  assert.ok(Math.abs(just - before) < 0.05, `jumped ${(just - before).toFixed(2)} m in 20 ms`); assert.ok(after - before > 0.3);
});

test("an object turns only while it spins: no jump when the spin starts, no snap back when it ends", () => {
  const box = one({ actors: [{ who: "box", at: [0, 0], do: [[0, "still"], [1, "spin"], [3, "still"]] }] }).scenes[0].actors[0];
  assert.equal(actorAt(box, 1, 4).spin, 0); assert.equal(actorAt(box, 2, 4).spin, 0.5); assert.equal(actorAt(box, 3.5, 4).spin, 1);
});

test("prompts use the length each clip was written at and say they are untested", () => {
  const st = loadSpec({ title: "t", scenes: [{ seconds: 0.5, actors: [] , camera: { from: [0, 1, 5] } }] });
  const text = promptsFor(st, "3d", [{ seconds: 1 }]);
  assert.match(text, /Not yet tested with a video model/); assert.match(text, /Length: 1 seconds/); assert.match(text, /the spec asks for 0\.5s/);
});
