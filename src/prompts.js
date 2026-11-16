// The words that go with each shot: who is which colour, what they do and when, and what the camera really does.
// Everything here is read off the solved stage, so the text cannot drift from what was drawn.
import { actorAt, project } from "./stage.js";

const RAD = Math.PI / 180;
const hexOf = (c) => { const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(c)); return m ? (m[1].length === 3 ? [...m[1]].map((x) => x + x).join("") : m[1]).toLowerCase() : null; };
const hsl = (hex) => {
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255), max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  return { h: d ? ((max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60 + 360) % 360 : 0, d, max, l: (max + min) / 2 };
};
// A plain colour word for a hex value, so a prompt can say "the pink figure".
export function colourName(colour) {
  const hex = hexOf(colour); if (!hex) return "coloured";
  const { h, d, max } = hsl(hex);
  if (d < 0.12) return max > 0.85 ? "white" : max < 0.25 ? "black" : "grey";
  return h < 15 ? "red" : h < 40 ? "orange" : h < 70 ? "yellow" : h < 160 ? "green" : h < 190 ? "teal" : h < 245 ? "blue" : h < 290 ? "purple" : h < 345 ? "pink" : "red";
}
const ORDINAL = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth"];
// One name per actor in a scene, never the same twice. Two that share a word are told apart as lighter and darker;
// three or more, or two of the same shade, by their order from the left in the opening frame.
export function colourNames(scene, aspect) {
  const base = scene.actors.map((a) => colourName(a.color)), names = base.slice(), cam = scene.camera.at(0);
  for (const word of new Set(base)) {
    const twins = base.map((n, i) => (n === word ? i : -1)).filter((i) => i >= 0);
    if (twins.length < 2) continue;
    const light = twins.map((i) => { const hex = hexOf(scene.actors[i].color); return hex ? hsl(hex).l : 0.5; });
    if (twins.length === 2 && Math.abs(light[0] - light[1]) > 0.12) { twins.forEach((i, k) => (names[i] = `${light[k] > light[1 - k] ? "light" : "dark"} ${word}`)); continue; }
    const x = twins.map((i) => { const v = project(cam, aspect, actorAt(scene.actors[i], 0, scene.seconds, true).pos).x; return Number.isFinite(v) ? v : 0; });
    const order = twins.map((_, k) => k).sort((p, q) => x[p] - x[q] || p - q);  // ties keep the order of the spec
    order.forEach((k, rank) => (names[twins[k]] = `${word} (the ${ORDINAL[rank] ?? `number ${rank + 1}`} ${word} one from the left at the start)`));
  }
  return names;
}

const sec = (t) => String(+t.toFixed(1));
// {it} is whatever the person holds. The phrases read as states, so a scene that opens with someone kneeling does not claim they kneel down.
const BODY = { stand: "stands", walk: "walks", run: "runs", kneel: "is down on one knee", sit: "sits", squat: "squats", leap: "is in a running jump pose, legs split", lie: "lies on the ground", cheer: "cheers with both arms up", reach: "reaches out with one arm", wave: "waves", talk: "talks, gesturing with one hand", carry: "walks carrying {it} in both hands", show: "holds {it} up beside the face, towards the camera", spin: "turns on the spot", float: "floats", still: "stays still" };
const WITH = { cheer: "cheering with both arms up", reach: "reaching out with one arm", wave: "waving", talk: "talking, gesturing with one hand", carry: "carrying {it} in both hands", show: "holding {it} up beside the face, towards the camera" };
const spinTime = (a, s) => a.acts.reduce((sum, [t, n], i) => sum + (n.split("+")[0] === "spin" ? (a.acts[i + 1]?.[0] ?? s) - t : 0), 0) || s;
// How someone's travel reads on screen: measured where they are in the first and the last frame, through the camera of each.
function travelOf(scene, a, aspect) {
  const s = scene.seconds, p0 = actorAt(a, 0, s, true).pos, p1 = actorAt(a, s, s, true).pos, c0 = scene.camera.at(0), c1 = scene.camera.at(s);
  const mid = (p) => [p[0], p[1] + (a.kind === "object" ? a.size[1] / 2 : a.height * 0.5), p[2]];
  const q0 = project(c0, aspect, mid(p0)), q1 = project(c1, aspect, mid(p1));
  if (![q0.x, q1.x, q0.z, q1.z].every(Number.isFinite) || q0.z <= 0 || q1.z <= 0) return "";
  if (Math.abs(q1.x - q0.x) > 0.4) return q1.x > q0.x ? "moving left to right across the frame" : "moving right to left across the frame";
  if (q0.z / q1.z > 1.3) return "coming towards the camera";
  if (q1.z / q0.z > 1.3) return "moving away from the camera";
  // the camera kept pace: say which way they head as the camera sees it
  const f = [c1.look[0] - c1.pos[0], c1.look[2] - c1.pos[2]], d = [p1[0] - p0[0], p1[2] - p0[2]], across = d[0] * -f[1] + d[1] * f[0];
  const moved = Math.hypot(c1.pos[0] - c0.pos[0], c1.pos[2] - c0.pos[2]) > 1;
  return moved && Math.abs(across) > 1e-6 ? `heading towards the ${across > 0 ? "right" : "left"} of the frame while the camera keeps pace and holds them in place in the picture` : "";
}
// What each person and each moving object does in a scene, with times, for a model that cannot watch the clip.
export function actionsOf(scene, aspect = 1) {
  const s = scene.seconds, out = [];
  for (const a of scene.actors) {
    if (a.heldBy) continue;  // a held object is told with its holder
    const held = scene.actors.filter((o) => o.heldBy === a).map((o) => o.label).join(" and "), it = held || "something";
    const steps = [];
    a.acts.forEach(([t, n], i) => {
      const [body, gesture] = n.split("+"), to = a.acts[i + 1]?.[0] ?? s;
      let words = ((BODY[body] ?? body) + (gesture ? ` while ${WITH[gesture] ?? gesture}` : "")).replace(/\{it\}/g, () => it);
      if (body === "spin" && a.kind === "object") { const n2 = +((Math.abs(a.turns) * (to - t)) / spinTime(a, s)).toFixed(2); words += `, ${n2} turn${n2 === 1 ? "" : "s"}`; }
      if (steps.length && steps.at(-1).words === words && body !== "spin") steps.at(-1).to = to; else steps.push({ from: t, to, words });
    });
    const moves = a.dist[120] > 1.5, lively = a.acts.some(([, n]) => ["spin", "float"].includes(n.split("+")[0]));
    if (a.kind === "object" && !moves && !lively) continue;  // an object that just sits there needs no instruction
    let text = steps.length === 1 ? steps[0].words : steps.map((k) => `${sec(k.from)}-${sec(k.to)}s ${k.words}`).join("; ");
    if (held && !text.includes(held)) text += `, holding ${held}`;
    if (a.jump) text += `; off the ground from ${sec(a.jump[0])}s to ${sec(a.jump[1])}s, about ${+a.jump[2].toFixed(1)} m high`;
    if (moves) { const way = travelOf(scene, a, aspect); text += `; covers about ${Math.round(a.dist[120])} m${way ? ", " + way : ""}`; }
    out.push(`${a.label}: ${text}`);
  }
  return out;
}

// The camera as it was solved, not as it was asked for: measured from where it stands and where it points in the first and the last frame.
const ANGLE = (deg) => (deg < 20 ? "from the front" : deg < 65 ? "three-quarter front" : deg < 115 ? "from the side" : deg < 160 ? "three-quarter back" : "from behind");
const HEIGHT = (deg) => (deg > 70 ? "top down" : deg > 40 ? "bird's eye" : deg > 12 ? "high angle" : deg < -10 ? "low angle" : "eye level");
const SIZE = { ECU: "extreme close-up", CU: "close-up", MCU: "medium close-up", MS: "medium shot", MLS: "medium long shot", FS: "full shot", WS: "wide shot", EWS: "extreme wide shot" };
const turnBetween = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a)) / RAD;
export function cameraWords(scene) {
  const s = scene.seconds, cam = scene.camera, subject = scene.actors.find((a) => a.who === cam.subject) ?? null;
  if (cam.size === "OTS") return cam.long;
  const view = (t) => {
    const c = cam.at(t), dx = c.pos[0] - c.look[0], dz = c.pos[2] - c.look[2], flat = Math.hypot(dx, dz), dist = Math.hypot(flat, c.pos[1] - c.look[1]);
    const st = subject ? actorAt(subject, t, s, true) : null;
    return { pos: c.pos, look: c.look, dist, bearing: Math.atan2(dx, dz), flat, el: Math.atan2(c.pos[1] - c.look[1], flat || 1e-6) / RAD, fov: c.fov, width: 2 * dist * Math.tan((c.fov * RAD) / 2),
      az: st && flat > 1e-6 ? Math.abs(turnBetween(st.face, Math.atan2(c.pos[0] - st.pos[0], c.pos[2] - st.pos[2]))) : null, at: st?.pos ?? null };
  };
  const a = view(0), b = view(s), parts = [];
  if (cam.size && SIZE[cam.size]) parts.push(SIZE[cam.size] + (!subject ? "" : subject.kind === "object" ? ` of ${subject.label}` : scene.cameraSpec.part ? ` on the ${scene.cameraSpec.part} of ${subject.label}` : ` on ${subject.label}`));
  else if (subject) parts.push(`on ${subject.label}`);
  parts.push(HEIGHT(a.el) + (HEIGHT(b.el) !== HEIGHT(a.el) ? `, ending ${HEIGHT(b.el)}` : ""));
  // which side of the subject the camera is on means little for a thing that is turning under it
  const spins = subject?.kind === "object" && subject.acts.some(([, n]) => n.split("+")[0] === "spin");
  if (a.az != null && a.el < 70 && !spins) parts.push(ANGLE(a.az) + (b.az != null && ANGLE(b.az) !== ANGLE(a.az) ? `, ending ${ANGLE(b.az)}` : ""));
  // the move, from what changed between the first and the last frame
  const d3 = (p, q) => Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]);
  // sampled along the way, so a camera that goes out and comes back, or circles once, is not mistaken for one that never moved
  const N = 24, vs = Array.from({ length: N + 1 }, (_, k) => view((k / N) * s)), sum = (f) => vs.slice(1).reduce((t, v, k) => t + f(vs[k], v), 0);
  const shaky = cam.move === "handheld";  // the shake is not a move: judge a handheld camera by where it starts and ends
  const travel = shaky ? d3(a.pos, b.pos) : sum((p, q) => d3(p.pos, q.pos)), lookTravel = shaky ? d3(a.look, b.look) : sum((p, q) => d3(p.look, q.look));
  const subjTravel = a.at ? sum((p, q) => d3(p.at, q.at)) : 0, swing = sum((p, q) => (p.flat > 1e-6 && q.flat > 1e-6 ? Math.abs(turnBetween(p.bearing, q.bearing)) : 0));
  const still = travel < Math.max(0.02, 0.03 * a.dist), closer = a.width / b.width;  // measured against how far away the camera is: 7 cm is a real move on a small product
  const follows = !still && lookTravel > 1 && subjTravel > 1, moves = [];
  if (still && Math.abs(a.fov - b.fov) > 1) moves.push(b.fov < a.fov ? "zooming in" : "zooming out");
  if (still && lookTravel > Math.max(0.3, 0.05 * a.dist)) moves.push(subject && subjTravel > 0.5 ? `panning with ${subject.label}` : "panning");
  if (!still) {
    if (follows) moves.push(`tracking with ${subject.label}`);
    if (closer > 1.05) moves.push("pushing in"); else if (closer < 0.95) moves.push("pulling out");
    if (!follows && !shaky && swing > 15) moves.push(swing >= 330 ? "orbiting a full circle" : "orbiting");
    if (!follows && b.pos[1] - a.pos[1] > 0.5) moves.push("craning up"); else if (!follows && a.pos[1] - b.pos[1] > 0.5) moves.push("craning down");
    if (!moves.length) moves.push("moving");
  }
  if (cam.move === "handheld") moves.push("handheld");
  parts.push(moves.length ? moves.join(", ") : "locked off");
  if (scene.cameraSpec.to?.size && SIZE[scene.cameraSpec.to.size]) parts.push(`ending on a ${SIZE[scene.cameraSpec.to.size]}`);
  return parts.join(", ");
}

// Prompts per shot, to paste next to the shot's clip or still in a video model. `shots` carries the length each clip was really written at.
export function promptsFor(stage, look, shots) {
  const lines = [`# ${stage.title}: prompts per shot`, "",
    "**Not yet tested with a video model.** These clips and prompts are intended for the documented workflows below. Nobody has checked the results in Seedance, Kling or Higgsfield yet, so treat the wording as a starting point and change what does not work.", "",
    "Every shot has three files in `shots/`, with nothing drawn over the picture: the clip (`NN-" + look + ".mp4`) and its first and last frame (`-first.png`, `-last.png`). The sketch carries the blocking, the camera move and the timing; the prompt says what the grey sketch should become. Add your own character, product and style references on top.", "",
    "## Which files for which model", "",
    "- **Seedance 2.5**: attach the clip as a reference video. ByteDance describes this kind of untextured 3D reference as a clay render, used for camera movement, pacing, subject path and blocking. Its announcement gives up to 10 reference videos and output up to 30 seconds; it does not say how long a reference clip may be. Use prompt A.",
    "- **Seedance 2.0**: attach the clip as a reference video, named `@Video1`. The fal.ai reference gives 2 to 15 seconds of reference video in total. Use prompt A.",
    "- **Kling 4.0, Omni Reference**: attach the clip as a reference video, also `@Video1`. The Kling guide gives 3 to 30 seconds per video and 30 seconds in total. Use prompt A.",
    "- **Models that start from an image and take no reference video, such as Seedance 1.5 Pro**: the clip cannot be used. An image-to-video model may keep the grey sketch look of its first frame, so if you want a finished-looking result, first turn `-first.png` (and `-last.png`, if the model takes an end frame) into finished images with an image model, keeping the composition; then use those as the first and last frame with prompt B, which describes the motion in words.",
    "- Names and limits differ between platforms and versions. If your platform labels the reference differently, replace `@Video1` with its label.", ""];
  stage.scenes.forEach((sc, i) => {
    const nn = String(i + 1).padStart(2, "0"), names = colourNames(sc, stage.aspect), who = sc.actors.map((a, k) => `the ${names[k]} ${a.kind === "object" ? "object" : "figure"} is ${a.label}`), acts = actionsOf(sc, stage.aspect);
    const len = shots?.[i]?.seconds ?? sc.seconds, lenText = String(+len.toFixed(2)), camera = cameraWords(sc);
    lines.push(`## Shot ${i + 1}: ${sc.title} (${lenText}s)`, "", `Files: \`shots/${nn}-${look}.mp4\`, \`shots/${nn}-${look}-first.png\`, \`shots/${nn}-${look}-last.png\``, "");
    if (Math.abs(len - sc.seconds) > 0.011) lines.push(`Note: the spec asks for ${+sc.seconds.toFixed(2)}s; at this frame rate the clip is ${lenText}s. Times in the action line are the spec's.`, "");
    if (len > 15) lines.push(`Note: this shot is ${lenText}s. Seedance 2.0 documents 15s of reference video in total${len > 30 ? " and Kling 4.0 30s" : ""}.`, "");
    if (len < 3) lines.push(`Note: this shot is ${lenText}s, shorter than the 3s Kling asks for${len < 2 ? " and the 2s Seedance 2.0 asks for" : ""}.`, "");
    if (sc.camera.moved) lines.push(`Note: the camera was swung ${Math.abs(sc.camera.moved)}° from the angle the spec asks for, because the set hid the subject. The camera line below describes where it ended up.`, "");
    lines.push("**A. With the clip as a reference video**", "", "```",
      "Refer to @Video1 for camera movement, pacing, shot size, subject path and blocking only. Replace the grey blocks and plain mannequins with a finished, realistic scene.",
      `Scene: ${sc.note || sc.title}`, `Camera: ${camera}.`, ...(who.length ? [`In the reference, ${who.join("; ")}.`] : []), "```", "",
      "**B. From a first frame, with no reference video**", "", "```",
      `Scene: ${sc.note || sc.title}`, ...(acts.length ? [`Action: ${acts.join(". ")}.`] : []), `Camera: ${camera}.`, `Length: ${lenText} seconds, one continuous shot.`, "```", "");
  });
  return lines.join("\n");
}
