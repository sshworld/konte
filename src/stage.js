// The staging model: reads a storyboard spec and answers, for any moment, where everyone is and where the camera is.
// Pure functions, no drawing: the renderer and `konte lint` both run on this, so what lint approves is what gets drawn.
import { smooth, clamp } from "./math.js";

const RAD = Math.PI / 180;
export const PALETTE = ["#ff2d95", "#ffd400", "#00b7ff", "#2bd94a", "#ff7a1a", "#8f6bff", "#00c2a8", "#e5484d"];
export const ASPECTS = { "9:16": [360, 640], "16:9": [640, 360], "1:1": [480, 480], "4:5": [400, 500] };
// Shot sizes: how much of a 1.75 m person the frame holds top to bottom, where it aims, and a lens that suits it.
export const SIZES = {
  ECU: { h: 0.3, aim: 1.62, fov: 26 }, CU: { h: 0.55, aim: 1.58, fov: 30 }, MCU: { h: 0.85, aim: 1.45, fov: 34 }, MS: { h: 1.25, aim: 1.22, fov: 38 },
  MLS: { h: 1.65, aim: 1.08, fov: 42 }, FS: { h: 2.35, aim: 0.92, fov: 45 }, WS: { h: 4.6, aim: 1.15, fov: 50 }, EWS: { h: 11, aim: 1.8, fov: 55 },
};
const OBJ_SIZES = { ECU: 0.55, CU: 1.25, MCU: 1.7, MS: 2.3, MLS: 3, FS: 3.6, WS: 7, EWS: 14 };  // frame height as a multiple of the object's largest side
export const ANGLES = { front: 0, front34: 35, side: 90, back34: 145, back: 180 };
export const HEIGHTS = { ground: null, low: -18, eye: 0, high: 25, bird: 55, top: 84 };  // camera elevation over the aim point, in degrees
const PARTS = { face: 1.6, chest: 1.35, hands: 1.0, feet: 0.1 };
// What each move does between the first and last frame of the scene. dist multiplies the distance, az/el add degrees.
export const MOVES = {
  static: { follow: false, look: "fixed" }, pan: { follow: false, look: "subject" }, track: {}, handheld: { shake: 1 },
  push: { end: { dist: 0.58 } }, pull: { end: { dist: 1.8 } }, orbit: { end: { az: 75 } },
  "crane-up": { end: { el: 32, dist: 1.5 } }, "crane-down": { start: { el: 32, dist: 1.5 } },
};
export const ACTIONS = ["stand", "walk", "run", "kneel", "sit", "squat", "leap", "cheer", "reach", "wave", "talk", "carry", "show", "lie", "spin", "float", "still"];
export const POSTURE = { kneel: 0.6, sit: 0.74, squat: 0.62, lie: 0.16 };  // head height as a share of standing, for aiming
export const SHAPES = ["box", "ball", "cyl", "bottle", "shoe"];
const GESTURES = ["talk", "wave", "reach", "cheer", "carry", "show"];  // can ride on a body action: "sit+talk"
const postureOf = (action) => POSTURE[String(action).split("+")[0]] ?? 1;
export const KIT = {
  // set pieces made of boxes and cylinders: [shape, [w,h,d], [x,y,z] of the piece's base centre]
  tree: (s) => [["cyl", [0.3 * s, 2.2 * s, 0.3 * s], [0, 0, 0]], ["ball", [2.4 * s, 2.2 * s, 2.4 * s], [0, 1.8 * s, 0]]],
  table: (s) => [["box", [1.4 * s, 0.06, 0.8 * s], [0, 0.72, 0]], ...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([a, b]) => ["box", [0.06, 0.72, 0.06], [a * 0.62 * s, 0, b * 0.33 * s]])],
  chair: (s) => [["box", [0.46 * s, 0.05, 0.46 * s], [0, 0.44, 0]], ["box", [0.46 * s, 0.5, 0.05], [0, 0.46, -0.21 * s]], ...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([a, b]) => ["box", [0.04, 0.44, 0.04], [a * 0.2 * s, 0, b * 0.2 * s]])],
  lamp: (s) => [["cyl", [0.1, 3.2 * s, 0.1], [0, 0, 0]], ["ball", [0.4, 0.4, 0.4], [0, 3.2 * s, 0]]],
  door: (s) => [["box", [1.0 * s, 2.1 * s, 0.08], [0, 0, 0]]],
  car: (s) => [["box", [1.8 * s, 0.7 * s, 4.3 * s], [0, 0.25 * s, 0]], ["box", [1.6 * s, 0.6 * s, 2.2 * s], [0, 0.95 * s, -0.2 * s]], ...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([a, b]) => ["cyl", [0.66 * s, 0.25, 0.66 * s], [a * 0.82 * s, 0, b * 1.35 * s, "x"]])],
};

const v3 = { sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], mul: (a, k) => [a[0] * k, a[1] * k, a[2] * k],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  len: (a) => Math.hypot(a[0], a[1], a[2]), norm: (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; } };
const lerp = (a, b, k) => a + (b - a) * k;

// ── spec → stage ───────────────────────────────────────────────────────────
const num = (x) => typeof x === "number" && Number.isFinite(x);
const vec = (x, n) => Array.isArray(x) && x.length === n && x.every((v) => num(v) && Math.abs(v) <= 1e5);  // finite and small enough that the maths stays finite
const has = (table, key) => typeof key === "string" && Object.hasOwn(table, key);
const isObj = (x) => x != null && typeof x === "object" && !Array.isArray(x);
const colour = (x) => typeof x === "string" && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(x);  // hex only: the renderer and the prompts read it the same way
const oneOf = (keys) => Object.keys(keys).join(", ");

// A folder-safe name for a title: no separators, no leading dots, never empty.
export const safeName = (title) => String(title ?? "").replace(/[^\p{L}\p{N}_.-]+/gu, "-").replace(/^[.-]+/, "").slice(0, 80) || "untitled";
// Which frames belong to which scene. Every scene owns at least one frame and no frame belongs to two, so the board,
// the video and the renderer can never disagree about where a cut falls.
export function frameRanges(stage, fps) {
  let next = 0;
  return stage.scenes.map((sc) => { const first = next, end = Math.max(first + 1, Math.round((sc.start + sc.seconds) * fps)); next = end; return { first, last: end - 1 }; });
}
// The frame that shows a beat: always one of the scene's own frames, even for a beat at the very end.
export const frameOfBeat = (range, t, fps) => clamp(range.first + Math.round(t * fps), range.first, range.last);
// Every problem is reported as a sentence in `errors`; a spec with errors is never solved or drawn.
export function loadSpec(spec) {
  const errors = [], err = (m) => errors.push(m);
  if (!isObj(spec) || !Array.isArray(spec.scenes) || !spec.scenes.length) return { errors: ["spec needs a non-empty \"scenes\" array"] };
  if (spec.scenes.length > 60) return { errors: [`${spec.scenes.length} scenes: a sketch holds up to 60; split the story into parts`] };
  try { return build(spec, errors, err); } catch (e) { errors.push(`the spec could not be read: ${e.message}`); return { errors }; }
}
function build(spec, errors, err) {
  const optNum = (x, what, lo = -Infinity, hi = Infinity) => { if (x != null && !(num(x) && x >= lo && x <= hi)) err(`${what} must be a number${lo > -Infinity ? ` from ${lo}` : ""}${hi < Infinity ? ` to ${hi}` : ""}`); };
  const [W, H] = (spec.aspect == null ? ASPECTS["9:16"] : has(ASPECTS, spec.aspect) ? ASPECTS[spec.aspect] : null) ?? (err(`aspect "${spec.aspect}" is not one of ${oneOf(ASPECTS)}`), ASPECTS["9:16"]);
  optNum(spec.fps, "fps", 1, 60);
  if (spec.cast != null && !isObj(spec.cast)) err("\"cast\" must be an object of id: {label, color, ...}");
  const cast = {}; let ci = 0;
  for (const [id, c] of Object.entries(isObj(spec.cast) ? spec.cast : {})) {
    if (!isObj(c)) { err(`cast.${id} must be an object`); continue; }
    const kind = c.kind ?? "person";
    if (kind !== "person" && kind !== "object") err(`cast.${id}.kind must be "person" or "object"`);
    if (c.size != null && !(vec(c.size, 3) && c.size.every((x) => x > 0))) err(`cast.${id}.size must be [w, h, d] in metres, all above 0`);
    if (c.shape != null && !(typeof c.shape === "string" && SHAPES.includes(c.shape))) err(`cast.${id}.shape "${c.shape}" is not one of ${SHAPES.join(", ")}`);
    optNum(c.height, `cast.${id}.height`, 0.3, 4);
    for (const key of ["color", "shoes"]) if (c[key] != null && !colour(c[key])) err(`cast.${id}.${key} must be a hex colour like "#e8457e"`);
    cast[id] = { id, label: String(c.label ?? id), kind: kind === "object" ? "object" : "person", color: colour(c.color) ? c.color : PALETTE[ci % PALETTE.length], shoes: colour(c.shoes) ? c.shoes : undefined, shape: c.shape ?? "box", size: vec(c.size, 3) ? c.size : [0.4, 0.4, 0.4], height: num(c.height) ? c.height : 1.75 };
    ci++;
  }
  let start = 0;
  const scenes = spec.scenes.map((s, si) => {
    const tag = `scene ${si + 1}`, before = errors.length;
    if (!isObj(s)) { err(`${tag} must be an object`); s = {}; }
    const sec = s.seconds;
    if (!(num(sec) && sec >= 0.5 && sec <= 600)) err(`${tag}: "seconds" must be a number from 0.5 to 600`);
    const seconds = num(sec) && sec >= 0.5 && sec <= 600 ? sec : 1;
    for (const key of ["sky", "ground"]) if (s[key] != null && !colour(s[key])) err(`${tag}: "${key}" must be a hex colour like "#efe3d6"`);
    optNum(s.floor, `${tag}: floor`, -1e5, 1e5);
    const floor = num(s.floor) ? s.floor : 0;
    const blocks = [];  // everything solid, as boxes, for sight lines and collisions
    const set = (Array.isArray(s.set) ? s.set : s.set == null ? [] : (err(`${tag}: "set" must be an array`), [])).map((p, pi) => {
      if (!isObj(p)) { err(`${tag}: set[${pi}] must be an object`); return null; }
      if (!vec(p.at, 2)) err(`${tag}: set[${pi}] needs "at": [x, z]`);
      if (p.color != null && !colour(p.color)) err(`${tag}: set[${pi}].color must be a hex colour like "#e8457e"`);
      optNum(p.y, `${tag}: set[${pi}].y`, -1e5, 1e5); optNum(p.turn, `${tag}: set[${pi}].turn`); optNum(p.scale, `${tag}: set[${pi}].scale`, 0.05, 50);
      const y = num(p.y) ? p.y : floor, k = p.kind ?? "box", scale = num(p.scale) ? p.scale : 1;
      let pieces = [];
      if (has(KIT, k)) pieces = KIT[k](scale);
      else if (["box", "cyl", "ball"].includes(k)) { if (!(vec(p.size, 3) && p.size.every((x) => x > 0))) err(`${tag}: set[${pi}] (${k}) needs "size": [w, h, d], all above 0`); else pieces = [[k, p.size, [0, 0, 0]]]; }
      else err(`${tag}: set[${pi}].kind "${k}" is not one of box, cyl, ball, ${oneOf(KIT)}`);
      const at = vec(p.at, 2) ? p.at : [0, 0], turn = (num(p.turn) ? p.turn : 0) * RAD, cs = Math.cos(turn), sn = Math.sin(turn);
      for (const [, sz, o] of pieces) {  // the piece turned about its anchor, then boxed on the world axes
        const cx = at[0] + o[0] * cs + o[2] * sn, cz = at[1] - o[0] * sn + o[2] * cs, hx = (Math.abs(sz[0] * cs) + Math.abs(sz[2] * sn)) / 2, hz = (Math.abs(sz[0] * sn) + Math.abs(sz[2] * cs)) / 2;
        blocks.push({ min: [cx - hx, y + o[1], cz - hz], max: [cx + hx, y + o[1] + sz[1], cz + hz] });
      }
      return { kind: k, at, y, turn, pieces, label: p.label == null ? null : String(p.label), color: colour(p.color) ? p.color : undefined };
    }).filter(Boolean);
    const actors = (Array.isArray(s.actors) ? s.actors : s.actors == null ? [] : (err(`${tag}: "actors" must be an array`), [])).map((a, ai) => {
      if (!isObj(a)) { err(`${tag}: actors[${ai}] must be an object`); return null; }
      const c = has(cast, a.who) ? cast[a.who] : null;
      if (!c) { err(`${tag}: actors[${ai}].who "${a.who}" is not in "cast"`); return null; }
      if (a.at != null && !vec(a.at, 2)) { err(`${tag}: ${a.who} "at" must be [x, z]`); return null; }
      const path = a.path ?? (a.at ? [[0, a.at[0], a.at[1]]] : a.heldBy != null ? [[0, 0, 0]] : null);  // a held object needs no place of its own
      if (!Array.isArray(path) || !path.length || path.some((k) => !vec(k, 3))) { err(`${tag}: ${a.who} needs "at": [x, z] or "path": [[t, x, z], ...], all numbers`); return null; }
      if (path.some((k, i) => i && k[0] <= path[i - 1][0])) err(`${tag}: ${a.who} path times must increase`);
      if (path[0][0] < 0 || path.at(-1)[0] > seconds + 1e-6) err(`${tag}: ${a.who} path runs from ${path[0][0]}s to ${path.at(-1)[0]}s but the scene is 0 to ${seconds}s`);
      let acts = typeof a.do === "string" || a.do == null ? [[0, a.do ?? (c.kind === "object" ? "still" : "stand")]] : a.do;
      if (!Array.isArray(acts) || !acts.length || acts.some((k) => !Array.isArray(k) || k.length !== 2 || !num(k[0]) || typeof k[1] !== "string")) { err(`${tag}: ${a.who} "do" must be an action name or [[t, "action"], ...]`); acts = [[0, "stand"]]; }
      if (acts.some((k, i) => (i && k[0] <= acts[i - 1][0]) || k[0] < 0 || k[0] > seconds)) err(`${tag}: ${a.who} "do" times must increase and stay within 0 to ${seconds}s`);
      if (acts[0][0] > 0) err(`${tag}: ${a.who} "do" must start at 0s (it starts at ${acts[0][0]}s)`);
      for (const [, n] of acts) {
        const [body, gesture, extra] = n.split("+");
        if (!ACTIONS.includes(body)) err(`${tag}: ${a.who} action "${body}" is not one of ${ACTIONS.join(", ")}`);
        if (gesture != null && (!GESTURES.includes(gesture) || extra != null)) err(`${tag}: ${a.who} action "${n}": after "+" use one of ${GESTURES.join(", ")}`);
      }
      const jump = a.jump == null ? null : vec(a.jump, 3) && a.jump[0] >= 0 && a.jump[1] > a.jump[0] && a.jump[1] <= seconds && a.jump[2] > 0 ? a.jump : (err(`${tag}: ${a.who} "jump" must be [t0, t1, height] inside the scene, with t1 after t0 and height above 0`), null);
      optNum(a.face, `${tag}: ${a.who} face`); optNum(a.floor, `${tag}: ${a.who} floor`, -1e5, 1e5); optNum(a.lift, `${tag}: ${a.who} lift`, 0, 1e5); optNum(a.turns, `${tag}: ${a.who} turns`, -1e4, 1e4);
      const T = path.map((k) => k[0]), P = path.map((k) => [k[1], k[2]]);
      const N = 120, dist = [0]; let prev = P[0];
      for (let i = 1; i <= N; i++) { const p = posAt({ T, P }, (i / N) * seconds); dist.push(dist[i - 1] + Math.hypot(p[0] - prev[0], p[1] - prev[1])); prev = p; }
      return { ...c, who: a.who, T, P, dist, acts, jump, face: num(a.face) ? a.face * RAD : null, floor: num(a.floor) ? a.floor : floor, lift: num(a.lift) ? a.lift : 0, turns: num(a.turns) ? a.turns : 1, trail: a.trail !== false, looksAt: a.look, heldBy: a.heldBy };
    }).filter(Boolean);
    for (const a of actors) {  // "look" turns the head to someone; "heldBy" puts an object in someone's hands
      for (const key of ["looksAt", "heldBy"]) {
        if (a[key] == null) continue;
        const name = key === "looksAt" ? "look" : "heldBy", other = actors.find((o) => o.who === a[key] && o !== a);
        if (!other) err(`${tag}: ${a.who} ${name} "${a[key]}" is not another actor in this scene`);
        else if (key === "heldBy" && (other.kind === "object" || typeof other.heldBy === "string" || other.heldBy)) err(`${tag}: ${a.who} must be held by a person who is not held`);
        else if (key === "heldBy" && a.kind !== "object") err(`${tag}: only objects can be "heldBy" someone (${a.who} is a person)`);
        a[key] = other ?? null;
      }
    }
    for (const a of actors) if (a.heldBy && (a.heldBy.kind === "object" || a.heldBy.heldBy)) a.heldBy = null;
    const scene = { index: si, title: String(s.title ?? `Scene ${si + 1}`), note: String(s.note ?? ""), seconds, start, floor, sky: colour(s.sky) ? s.sky : undefined, ground: colour(s.ground) ? s.ground : undefined, set, blocks, actors, cameraSpec: s.camera == null ? {} : s.camera };
    start += seconds;
    if (!isObj(scene.cameraSpec)) { err(`${tag}: "camera" must be an object`); scene.cameraSpec = {}; }
    // the camera is only solved for a scene that read cleanly, so a bad value never reaches the maths
    scene.camera = errors.length > before ? { desc: "none", at: () => ({ pos: [0, 1.6, 6], look: [0, 1, 0], fov: 45 }), subject: null, size: null, moved: 0 } : solveCamera(scene, W / H, (m) => err(`${tag}: ${m}`));
    if (s.beats != null && !(Array.isArray(s.beats) && s.beats.length >= 1 && s.beats.length <= 4 && s.beats.every((t) => num(t) && t >= 0 && t <= seconds))) err(`${tag}: "beats" must be 1 to 4 times inside the scene, the moments the board shows`);
    scene.beats = Array.isArray(s.beats) && s.beats.every(num) && s.beats.length ? s.beats.slice(0, 4) : beatsOf(scene);
    return scene;
  });
  return { title: String(spec.title ?? "untitled"), logline: String(spec.logline ?? ""), width: W, height: H, aspect: W / H, fps: num(spec.fps) ? spec.fps : 12, cast, scenes, seconds: start, errors };
}
// The moments a board should show when the spec does not name them: the opening, the event, the end.
// The event is a jump's high point, else the instant two people pass closest, else just after a change of action.
function beatsOf(scene) {
  const sec = scene.seconds, subj = scene.actors.find((a) => a.who === scene.camera.subject) ?? scene.actors[0];
  let mid = null;
  for (const a of scene.actors) if (a.jump && mid == null) mid = (a.jump[0] + a.jump[1]) / 2;
  if (mid == null && subj) {
    let best = Infinity, bt = null;
    for (const o of scene.actors) {
      if (o === subj || o.heldBy || o.kind === "object" || subj.dist[120] + o.dist[120] < 1.5) continue;
      for (let i = 0; i <= 60; i++) { const t = (i / 60) * sec, p = actorAt(subj, t, sec, true).pos, q = actorAt(o, t, sec, true).pos, d = Math.hypot(p[0] - q[0], p[2] - q[2]); if (d < best) { best = d; bt = t; } }
    }
    if (bt != null && bt > 0.12 * sec && bt < 0.88 * sec) mid = bt;
  }
  if (mid == null && subj && subj.acts.length > 1) { const changes = subj.acts.slice(1).map((k) => k[0]); mid = Math.min(0.9 * sec, changes.reduce((b, t) => (Math.abs(t - sec / 2) < Math.abs(b - sec / 2) ? t : b)) + 0.7); }
  return [0.06 * sec, mid ?? sec / 2, 0.94 * sec];
}

// ── actors ─────────────────────────────────────────────────────────────────
// Straight lines between keys: at each key time the actor is exactly where the spec says, and holds still between equal keys.
function posAt(a, t) {
  const T = a.T, P = a.P, n = T.length;
  if (t <= T[0]) return P[0].slice();
  if (t >= T[n - 1]) return P[n - 1].slice();
  let i = 0; while (t > T[i + 1]) i++;
  const u = (t - T[i]) / (T[i + 1] - T[i]);
  return [lerp(P[i][0], P[i + 1][0], u), lerp(P[i][1], P[i + 1][1], u)];
}
const distAt = (a, t, seconds) => { const x = clamp(t / seconds) * 120, i = Math.min(119, Math.floor(x)); return lerp(a.dist[i], a.dist[i + 1], x - i); };
function headingAt(a, t, seconds) {  // the way it travels, corners rounded over 0.4 s; while still, the last (or first upcoming) heading
  let sx = 0, sz = 0;
  for (const dt of [-0.2, -0.1, 0, 0.1, 0.2]) { const q0 = posAt(a, clamp(t + dt - 0.05, 0, seconds)), q1 = posAt(a, clamp(t + dt + 0.05, 0, seconds)), l = Math.hypot(q1[0] - q0[0], q1[1] - q0[1]); if (l > 0.002) { sx += (q1[0] - q0[0]) / l; sz += (q1[1] - q0[1]) / l; } }
  if (Math.hypot(sx, sz) > 0.3) return Math.atan2(sx, sz);
  for (const dt of [-0.5, -1, -2, -4, -8, -16, -32, 0.5, 1, 2, 4, 8, 16, 32]) {
    const q0 = posAt(a, clamp(t + dt, 0, seconds)), q1 = posAt(a, clamp(t + dt + 0.1, 0, seconds));
    if (Math.hypot(q1[0] - q0[0], q1[1] - q0[1]) > 0.002) return Math.atan2(q1[0] - q0[0], q1[1] - q0[1]);
  }
  return 0;
}
// bare: position and facing only, without the head turn, so two people looking at each other do not recurse
export function actorAt(a, t, seconds, bare = false) {
  t = clamp(t, 0, seconds);
  if (a.heldBy) {  // in both hands at the waist, or, when the holder does "show", raised in one hand beside the face
    const h = actorAt(a.heldBy, t, seconds, true), k = (a.heldBy.height ?? 1.75) / 1.75;
    const place = (action) => { const post = postureOf(action), up = String(action).split("+").includes("show"); return [(up ? 0.34 : 0.36) * k, (up ? 0.2 : 0) * k, up ? (1.44 - (1 - post) * 1.75) * k : (1.02 * post - a.size[1] / 2) * k]; };
    const now = place(h.action), was = h.blend ? place(h.blend.from) : now, [fwd, side, y] = now.map((x, i) => lerp(was[i], x, h.blend ? h.blend.k : 1));  // moves with the holder's cross-fade
    return { pos: [h.pos[0] + Math.sin(h.face) * fwd + Math.cos(h.face) * side, h.pos[1] + y, h.pos[2] + Math.cos(h.face) * fwd - Math.sin(h.face) * side], ground: h.pos[1] + y, shadow: h.ground, face: h.face, action: "still", blend: null, dist: 0, air: null, time: t, turn: 0 };
  }
  const p = posAt(a, t), d = distAt(a, t, seconds);
  const face = a.face ?? headingAt(a, t, seconds);
  let i = 0; while (i + 1 < a.acts.length && t >= a.acts[i + 1][0]) i++;
  const action = a.acts[i][1], since = t - a.acts[i][0];
  const blend = i > 0 && since < 0.35 ? { from: a.acts[i - 1][1], k: smooth(0, 0.35, since) } : null;
  let y = a.floor, air = null;
  if (a.jump && t >= a.jump[0] && t <= a.jump[1]) { air = (t - a.jump[0]) / (a.jump[1] - a.jump[0]); y += 4 * air * (1 - air) * a.jump[2]; }
  let turn = 0;
  if (a.looksAt && !bare) { const o = actorAt(a.looksAt, t, seconds, true).pos; let d2 = Math.atan2(o[0] - p[0], o[2] - p[1]) - face; d2 = Math.atan2(Math.sin(d2), Math.cos(d2)); turn = clamp(d2, -1.2, 1.2); }
  // how far through its turning an object is: only the time spent in "spin" counts, so it neither jumps when the spin starts nor snaps back when it ends
  let spun = 0, spinAll = 0;
  for (let k = 0; k < a.acts.length; k++) if (a.acts[k][1].split("+")[0] === "spin") { const t0 = a.acts[k][0], t1 = a.acts[k + 1]?.[0] ?? seconds; spinAll += t1 - t0; spun += clamp(t - t0, 0, t1 - t0); }
  return { pos: [p[0], y, p[1]], ground: a.floor, face, action, blend, dist: d, air, time: t, turn, spin: spinAll > 0 ? spun / spinAll : 0 };
}
const heightOf = (a, action) => (a.kind === "object" ? a.size[1] : a.height * (postureOf(action)));
function aimOf(scene, a, st, part, sizeKey) {
  if (a.kind === "object") return [st.pos[0], st.pos[1] + a.lift + a.size[1] / 2, st.pos[2]];
  const k = a.height / 1.75, post = postureOf(st.action);
  const y = part && PARTS[part] != null ? PARTS[part] * (part === "feet" ? 1 : post) : SIZES[sizeKey].aim * (SIZES[sizeKey].aim > 1.3 ? post : Math.min(1, post + 0.15));
  const fwd = part === "feet" ? (st.action === "kneel" ? 0.5 : 0.14) * k : 0;  // the feet sit ahead of the hips
  return [st.pos[0] + Math.sin(st.face) * fwd, st.pos[1] + y * k, st.pos[2] + Math.cos(st.face) * fwd];
}

// ── camera ─────────────────────────────────────────────────────────────────
function rayHits(blocks, from, to) {
  const d = v3.sub(to, from);
  for (const b of blocks) {
    let t0 = 0.02, t1 = 0.97, hit = true;
    for (let i = 0; i < 3; i++) {
      if (Math.abs(d[i]) < 1e-9) { if (from[i] < b.min[i] || from[i] > b.max[i]) { hit = false; break; } continue; }
      let a = (b.min[i] - from[i]) / d[i], c = (b.max[i] - from[i]) / d[i]; if (a > c) [a, c] = [c, a];
      t0 = Math.max(t0, a); t1 = Math.min(t1, c); if (t0 > t1) { hit = false; break; }
    }
    if (hit) return true;
  }
  return false;
}
const inside = (blocks, p, pad = 0.12) => blocks.some((b) => p[0] > b.min[0] - pad && p[0] < b.max[0] + pad && p[1] > b.min[1] - pad && p[1] < b.max[1] + pad && p[2] > b.min[2] - pad && p[2] < b.max[2] + pad);
export const blocked = (scene, from, to) => rayHits(scene.blocks, from, to);
export function project(cam, aspect, p) {
  const f = v3.norm(v3.sub(cam.look, cam.pos)); let r = v3.cross(f, [0, 1, 0]); if (v3.len(r) < 1e-5) r = [1, 0, 0]; r = v3.norm(r);
  const u = v3.cross(r, f), d = v3.sub(p, cam.pos), z = v3.dot(d, f), th = Math.tan((cam.fov * RAD) / 2);
  return { x: v3.dot(d, r) / (z * th * aspect), y: v3.dot(d, u) / (z * th), z };
}

// The board spells the camera out; the slate and shots.json keep the short form.
const SIZE_NAMES = { ECU: "extreme close-up", CU: "close-up", MCU: "medium close-up", MS: "medium shot", MLS: "medium long shot", FS: "full shot", WS: "wide shot", EWS: "extreme wide shot" };
const HEIGHT_NAMES = { ground: "from the ground", low: "low angle", eye: "eye level", high: "high angle", bird: "bird's eye", top: "top down" };
const ANGLE_NAMES = { front: "from the front", front34: "three-quarter front", side: "from the side", back34: "three-quarter back", back: "from behind" };
const MOVE_NAMES = { static: "locked off", pan: "panning", track: "tracking", handheld: "handheld", push: "pushing in", pull: "pulling out", orbit: "orbiting", "crane-up": "craning up", "crane-down": "craning down" };
// How much of the subject the camera sees through the set and the other people: 1 all of it, 0 none, -1 if the camera is inside something.
function sightOf(scene, at, subject, ignore, parts = [0.12, 0.5, 0.92]) {
  const sec = scene.seconds, others = scene.actors.filter((a) => a !== subject && a !== ignore && !a.heldBy && a.kind !== "object");
  const N = clamp(Math.round(sec * 4), 8, 240), step = sec / N;
  let seen = 0, n = 0, bad = false, run = 0, dark = 0;
  for (let i = 0; i <= N; i++) {
    const t = i * step, cam = at(t);
    if (inside(scene.blocks, cam.pos)) bad = true;
    if (!subject) continue;
    const st = actorAt(subject, t, sec, true), h = heightOf(subject, st.action);
    const obst = scene.blocks.concat(others.map((o) => { const q = actorAt(o, t, sec, true).pos; return { min: [q[0] - 0.25, q[1], q[2] - 0.25], max: [q[0] + 0.25, q[1] + heightOf(o, "stand"), q[2] + 0.25] }; }));
    const base = subject.kind === "object" ? st.pos[1] + subject.lift : st.pos[1];
    let any = false;
    for (const f of parts) { n++; if (!rayHits(obst, cam.pos, [st.pos[0], base + h * f, st.pos[2]])) { seen++; any = true; } }
    run = any ? 0 : run + step; dark = Math.max(dark, run);
  }
  return { score: bad ? -1 : n ? seen / n : 1, dark };
}

const NO_CAMERA = { desc: "none", at: () => ({ pos: [0, 1.6, 6], look: [0, 1, 0], fov: 45 }), subject: null, size: null, moved: 0 };
function solveCamera(scene, aspect, err) {
  const c = scene.cameraSpec, sec = scene.seconds;
  if (c.fov != null && !(num(c.fov) && c.fov >= 5 && c.fov <= 120)) { err("camera.fov must be a number from 5 to 120"); return NO_CAMERA; }
  if (c.from != null) {  // raw escape hatch: explicit positions, [x, y, z]
    const target = typeof c.look === "string" ? scene.actors.find((a) => a.who === c.look) : null;
    if (!vec(c.from, 3) || (c.to != null && !vec(c.to, 3))) { err("camera.from and camera.to must be [x, y, z] (with \"from\", \"to\" is a position, not a shot size)"); return NO_CAMERA; }
    if (typeof c.look === "string" ? !target : c.look != null && !vec(c.look, 3)) { err(`camera.look must be [x, y, z] or the id of an actor in this scene${typeof c.look === "string" ? ` ("${c.look}" is not one)` : ""}`); return NO_CAMERA; }
    const at = (t) => { const k = smooth(0, 1, t / sec), look = target ? aimOf(scene, target, actorAt(target, t, sec, true), null, "MS") : c.look ?? [0, 1, 0]; return { pos: c.from.map((x, i) => lerp(x, (c.to ?? c.from)[i], k)), look, aim: look, fov: c.fov ?? 45 }; };
    const sight = sightOf(scene, at, target);
    return { desc: "custom", at, subject: target?.who ?? null, size: null, move: c.to ? "custom" : "static", moved: 0, visible: sight.score, dark: sight.dark };
  }
  for (const [key, table] of [["size", SIZES], ["move", MOVES], ["part", PARTS]]) if (c[key] != null && !has(table, c[key])) { err(`camera.${key} "${c[key]}" is not one of ${oneOf(table)}`); return NO_CAMERA; }
  for (const [where, o] of [["camera", c], ["camera.to", c.to ?? {}]]) {
    if (!isObj(o)) { err(`${where} must be an object like {"size": "FS", "height": "eye"}`); return NO_CAMERA; }
    if (o.height != null && !has(HEIGHTS, o.height) && !num(o.height)) { err(`${where}.height "${o.height}" is not one of ${oneOf(HEIGHTS)}, or degrees`); return NO_CAMERA; }
    if (o.angle != null && !has(ANGLES, o.angle) && !num(o.angle)) { err(`${where}.angle "${o.angle}" is not one of ${oneOf(ANGLES)}, or degrees`); return NO_CAMERA; }
  }
  if (c.to?.fov != null && !(num(c.to.fov) && c.to.fov >= 5 && c.to.fov <= 120)) { err("camera.to.fov must be a number from 5 to 120"); return NO_CAMERA; }
  if (c.to?.size != null && !has(SIZES, c.to.size)) { err(`camera.to.size "${c.to.size}" is not one of ${oneOf(SIZES)}`); return NO_CAMERA; }
  if (c.to?.part != null && !has(PARTS, c.to.part)) { err(`camera.to.part "${c.to.part}" is not one of ${oneOf(PARTS)}`); return NO_CAMERA; }
  if (c.strength != null && !(num(c.strength) && c.strength >= 0 && c.strength <= 3)) { err("camera.strength must be a number from 0 to 3"); return NO_CAMERA; }
  if (c.side != null && !["left", "right"].includes(c.side)) { err("camera.side must be \"left\" or \"right\""); return NO_CAMERA; }
  if (c.distance != null && !num(c.distance)) { err("camera.distance must be a number of metres"); return NO_CAMERA; }
  if (c.on != null && !scene.actors.some((a) => a.who === c.on)) { err(`camera.on "${c.on}" is not an actor in this scene`); return NO_CAMERA; }
  const subject = scene.actors.find((a) => a.who === c.on) ?? scene.actors[0];
  if (c.over != null && subject) {  // over the shoulder: behind one person, looking at the other
    const other = scene.actors.find((a) => a.who === c.over && a !== subject);
    if (!other) { err(`camera.over "${c.over}" is not another actor in this scene`); return NO_CAMERA; }
    {
      const side = c.side === "left" ? -1 : 1;
      const at = (t) => {
        const s = actorAt(subject, t, sec, true), o = actorAt(other, t, sec, true), dx = o.pos[0] - s.pos[0], dz = o.pos[2] - s.pos[2], l = Math.hypot(dx, dz) || 1, n = [dx / l, dz / l];
        const oh = heightOf(other, o.action), sh = heightOf(subject, s.action), back = 0.85 + (c.distance ?? 0);
        const lens = c.fov ?? clamp(2 * Math.atan((0.42 * subject.height / 1.75) / (l + back)) / RAD, 14, 40);
        return { pos: [o.pos[0] + n[0] * back - n[1] * 0.42 * side, o.pos[1] + oh * 0.93, o.pos[2] + n[1] * back + n[0] * 0.42 * side], look: [s.pos[0] - n[1] * 0.12 * side, s.pos[1] + sh * 0.84, s.pos[2] + n[0] * 0.12 * side], aim: [s.pos[0], s.pos[1] + sh * 0.84, s.pos[2]], fov: lens };
      };
      const sight = sightOf(scene, at, subject, other, [0.7, 0.82, 0.94]);  // an over-the-shoulder shot is about the head and shoulders
      return { desc: `OTS over ${other.who}`, long: `over ${other.label}'s shoulder, on ${subject.label}`, at, subject: subject.who, size: "OTS", move: "static", moved: 0, visible: sight.score, dark: sight.dark };
    }
  }
  if (!subject) { err("camera needs a subject: add an actor or use camera.from/to/look"); return NO_CAMERA; }
  const sizeKey = c.size ?? "MS", moveKey = c.move ?? "static";
  const S = SIZES[sizeKey] ?? SIZES.MS, M = MOVES[moveKey] ?? MOVES.static, k = c.strength ?? 1;
  // an object is framed by its longest side, which in a tall frame has to fit the width
  const frame = (key) => (subject.kind === "object" ? (Math.max(...subject.size) * OBJ_SIZES[key]) / Math.min(1, aspect * 1.15) : SIZES[key].h * (subject.height / 1.75));
  const fov = c.fov ?? S.fov, side = c.side === "left" ? -1 : 1;
  const base = { dist: frame(SIZES[sizeKey] ? sizeKey : "MS") / 2 / Math.tan((fov * RAD) / 2), az: (typeof c.angle === "number" ? c.angle : ANGLES[c.angle ?? "front34"] ?? 35) * side, el: typeof c.height === "number" ? c.height : HEIGHTS[c.height ?? "eye"] ?? 0, groundHug: c.height === "ground", fov };
  const start = { ...base }, end = { ...base };
  if (M.start) { start.dist *= lerp(1, M.start.dist ?? 1, k); start.el += (M.start.el ?? 0) * k; }
  if (M.end) { end.dist *= lerp(1, M.end.dist ?? 1, k); end.az += (M.end.az ?? 0) * k * side; end.el += (M.end.el ?? 0) * k; }
  if (c.to) {
    if (c.to.size && SIZES[c.to.size]) { const f2 = c.to.fov ?? fov; end.dist = frame(c.to.size) / 2 / Math.tan((f2 * RAD) / 2); end.fov = f2; }
    else if (c.to.fov != null) end.fov = c.to.fov;  // a lens change alone: a zoom from where the camera stands
    if (c.to.angle != null) end.az = (typeof c.to.angle === "number" ? c.to.angle : ANGLES[c.to.angle] ?? base.az) * side;
    if (c.to.height != null) { end.el = typeof c.to.height === "number" ? c.to.height : HEIGHTS[c.to.height] ?? 0; end.groundHug = c.to.height === "ground"; }
  }
  const follow = c.follow ?? M.follow !== false, fixedLook = M.look === "fixed" && c.follow == null;
  const mid = actorAt(subject, sec / 2, sec), heading = mid.face;  // one heading for the whole scene, so the camera does not swing when the path bends
  const startSize = SIZES[sizeKey] ? sizeKey : "MS", endSize = c.to?.size && SIZES[c.to.size] ? c.to.size : startSize;
  const endPart = c.to && "part" in c.to ? c.to.part : c.to?.size ? null : c.part;  // a move to a new shot size frames the whole subject unless told otherwise
  const at = (t, azShift = 0) => {
    const u = clamp(t / sec), e = c.ease === "linear" ? u : smooth(0, 1, u);
    const st = actorAt(subject, t, sec), anchorState = follow ? st : mid;
    const aimFor = (state) => { const p0 = aimOf(scene, subject, state, c.part, startSize), p1 = aimOf(scene, subject, state, endPart, endSize); return p0.map((x, i) => lerp(x, p1[i], e)); };
    const aimNow = aimFor(st), anchor = aimFor({ ...anchorState, pos: [anchorState.pos[0], anchorState.ground, anchorState.pos[2]] });
    const dist = lerp(start.dist, end.dist, e), az = heading + (lerp(start.az, end.az, e) + azShift) * RAD;
    let el = lerp(start.el, end.el, e) * RAD;
    const hug = lerp(start.groundHug ? 1 : 0, end.groundHug ? 1 : 0, e);
    if (hug > 0) el = lerp(el, Math.asin(clamp((scene.floor + 0.18 - anchor[1]) / dist, -0.9, 0.9)), hug);
    let pos = [anchor[0] + Math.sin(az) * Math.cos(el) * dist, anchor[1] + Math.sin(el) * dist, anchor[2] + Math.cos(az) * Math.cos(el) * dist];
    if (pos[1] < scene.floor + 0.15 && anchorState.ground <= scene.floor + 0.01) pos[1] = scene.floor + 0.15;
    if (M.shake) pos = [pos[0] + 0.03 * Math.sin(t * 7.3), pos[1] + 0.025 * Math.sin(t * 9.1 + 1), pos[2] + 0.03 * Math.sin(t * 6.1 + 2)];
    const look = fixedLook ? aimOf(scene, subject, mid, c.part, startSize) : follow ? [aimNow[0], lerp(anchor[1], aimNow[1], 0.6), aimNow[2]] : aimNow;
    return { pos, look, aim: aimNow, fov: lerp(start.fov, end.fov, e) };
  };
  // keep the subject in view: if set pieces block the sight line, swing the camera round until they do not
  const score = (shift) => sightOf(scene, (t) => at(t, shift), subject).score;
  let best = 0, bestScore = score(0);
  if (bestScore < 0.85 && c.avoid !== false) for (const s of [-2 * start.az, 30, -30, 60, -60, 90, -90, 135, -135, 180]) { const v = score(s); if (v > bestScore + 0.05) { best = s; bestScore = v; if (v >= 0.85) break; } }
  const angleName = typeof (c.angle ?? "front34") === "number" ? c.angle + "°" : c.angle ?? "front34", heightName = c.height ?? "eye";
  const long = `${SIZE_NAMES[sizeKey]}${c.part ? " on the " + c.part : ""}, ${typeof heightName === "number" ? heightName + "° up" : HEIGHT_NAMES[heightName]}, ${ANGLE_NAMES[angleName] ?? angleName}, ${MOVE_NAMES[moveKey]}${c.to?.size ? " to " + SIZE_NAMES[c.to.size] : ""}`;
  return { desc: `${sizeKey} · ${angleName} · ${heightName} · ${moveKey}`, long, at: (t) => at(t, best), subject: subject.who, size: sizeKey, move: moveKey, moved: best, visible: bestScore, dark: sightOf(scene, (t) => at(t, best), subject).dark };
}

// ── lint: problems found without drawing a frame ───────────────────────────
export function lint(stage) {
  const out = [], add = (level, scene, msg) => out.push({ level, scene: scene.index + 1, msg });
  for (const sc of stage.scenes) {
    const sec = sc.seconds, cam = sc.camera;
    if (cam.moved) add("info", sc, `camera swung ${Math.round(cam.moved)}° from the requested angle to keep ${cam.subject} in view`);
    if (cam.visible != null && cam.visible < 0) add("error", sc, "the camera sits inside a set piece for part of the scene");
    else if (cam.visible != null && cam.visible < 0.6) add("error", sc, `${cam.subject} is hidden behind the set for ${Math.round((1 - cam.visible) * 100)}% of the scene${cam.size && cam.size !== "OTS" ? ", from every angle tried" : ""}`);
    else if (cam.dark >= 1) add("warn", sc, `${cam.subject} is completely hidden for about ${cam.dark.toFixed(1)}s in a row`);
    const subj = sc.actors.find((a) => a.who === cam.subject);
    let off = 0, near = false, under = false, big = 0, headOff = 0;
    const NS = Math.max(12, Math.round(sec * 4));
    for (let i = 0; i <= NS; i++) {
      const t = (i / NS) * sec, c = cam.at(t);
      if (c.pos[1] < sc.floor + 0.05) under = true;
      for (const a of sc.actors) { const p = actorAt(a, t, sec).pos; if (Math.hypot(c.pos[0] - p[0], c.pos[2] - p[2]) < (cam.size === "OTS" ? 0.2 : 0.35) && c.pos[1] > p[1] - 0.1 && c.pos[1] < p[1] + heightOf(a, "stand") + 0.2) near = true; }
      if (subj) { const st = actorAt(subj, t, sec), q = project(c, stage.aspect, c.aim ?? [st.pos[0], st.pos[1] + (subj.kind === "object" ? subj.lift + subj.size[1] / 2 : heightOf(subj, st.action) * 0.55), st.pos[2]]); if (!(q.z > 0 && Math.abs(q.x) < 1.02 && Math.abs(q.y) < 1.02)) off++;
        if (subj.kind !== "object" && !sc.cameraSpec.part && ["MCU", "MS", "MLS", "FS", "WS", "EWS", "OTS"].includes(cam.size)) { const hd = project(c, stage.aspect, [st.pos[0], st.pos[1] + heightOf(subj, st.action) * 0.94, st.pos[2]]); if (!(hd.z > 0 && Math.abs(hd.x) < 1.0 && Math.abs(hd.y) < 1.0)) headOff++; }
        if (subj.kind !== "object" && ["FS", "WS", "EWS"].includes(cam.size)) { const top = project(c, stage.aspect, [st.pos[0], st.pos[1] + heightOf(subj, st.action), st.pos[2]]), bot = project(c, stage.aspect, st.pos); if (top.z > 0 && bot.z > 0 && top.y - bot.y > 2.3) big++; } }
    }
    if (near) add("error", sc, "the camera passes through an actor");
    if (headOff / (NS + 1) > 0.3 && off / (NS + 1) <= 0.3) add("warn", sc, `${cam.subject}'s head is cut off for about ${Math.round((headOff / (NS + 1)) * 100)}% of the scene (use a wider size, or "part" to aim on purpose)`);
    if (big / (NS + 1) > 0.15) add("warn", sc, `${cam.subject} outgrows the ${cam.size} frame for about ${Math.round((big / (NS + 1)) * 100)}% of the scene: they walk towards a camera that stays put (use "track", or turn the angle)`);
    if (under) add("warn", sc, "the camera dips below the floor");
    if (subj && off / (NS + 1) > 0.3) add(cam.move === "static" ? "warn" : "error", sc, `${cam.subject} is out of frame for about ${Math.round((off / (NS + 1)) * 100)}% of the scene${cam.move === "static" ? " (a static camera: use \"pan\" or \"track\" to keep them in)" : ""}`);
    for (const a of sc.actors) {
      for (const [t0, full] of a.acts) {
        const name = full.split("+")[0];  // speed and posture belong to the body action
        const i = a.acts.findIndex((x) => x[0] === t0), t1 = a.acts[i + 1]?.[0] ?? sec, d = a.dist[Math.round((t1 / sec) * 120)] - a.dist[Math.round((t0 / sec) * 120)], v = d / Math.max(0.01, t1 - t0);
        if (name === "run" && v > 10) add("warn", sc, `${a.who} runs at ${v.toFixed(1)} m/s; a sprint is about 8`);
        if (name === "run" && v < 1.2 && t1 - t0 > 1) add("warn", sc, `${a.who} "run" covers only ${d.toFixed(1)} m in ${(t1 - t0).toFixed(1)}s: it will look like running on the spot`);
        if (name === "walk" && v > 2.6) add("warn", sc, `${a.who} walks at ${v.toFixed(1)} m/s; use "run" above 2.5`);
        if (name === "leap" && !a.jump) add("warn", sc, `${a.who} does "leap" without a "jump": [t0, t1, height]`);
        if (["stand", "kneel", "sit", "squat", "lie", "cheer", "wave", "reach", "talk"].includes(name) && v > 0.4) add("warn", sc, `${a.who} slides ${d.toFixed(1)} m while doing "${full}"`);
      }
      if (a.jump && a.jump[1] - a.jump[0] > 1.6) add("warn", sc, `${a.who} is in the air for ${(a.jump[1] - a.jump[0]).toFixed(1)}s; a real jump lasts about 0.5 to 1 (give the leap its own short scene for slow motion)`);
      for (let i = 0; i <= 24; i++) { const st = actorAt(a, (i / 24) * sec, sec); if (inside(sc.blocks, [st.pos[0], st.pos[1] + 0.5, st.pos[2]], -0.1)) { add("warn", sc, `${a.who} passes through a set piece at ${((i / 24) * sec).toFixed(1)}s`); break; } }
    }
    if (sec > 30) add("info", sc, `${sec}s is longer than the 30s Kling 4.0 documents for a reference clip; split it if you plan to use the clip that way`);
    else if (sec > 15) add("info", sc, `${sec}s is longer than the 15s of reference video Seedance 2.0 documents`);
    if (sc.note.length > 90) add("warn", sc, `note is ${sc.note.length} characters; a board caption reads best under 90`);
  }
  if (stage.seconds > 180) out.push({ level: "warn", scene: 0, msg: `total length ${stage.seconds}s: a sketch reads best under 3 minutes` });
  return out;
}
