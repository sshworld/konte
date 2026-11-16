#!/usr/bin/env node
// konte: a storyboard spec in, a rough animatic and a board out.
//   konte lint   <spec.json>
//   konte render <spec.json> [-o dir] [--look 3d,2d] [--review] [--captions] [--fps n] [--board-only] [--jobs n]
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, lstatSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, renameSync, rmSync } from "node:fs";
import { tmpdir, availableParallelism } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadSpec, lint, safeName } from "./src/stage.js";
import { promptsFor, cameraWords } from "./src/prompts.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const VERSION = JSON.parse(readFileSync(join(HERE, "package.json"), "utf8")).version;
const USAGE = `konte ${VERSION}
  konte lint   <spec.json>                     check a spec without drawing anything
  konte render <spec.json> [options]           draw the board and the animatic
  konte render sneaker-ad                      draw a bundled example: sneaker-ad, skincare-ad, explainer, cafe
    -o, --out <dir>     where to write (default: ./konte-out/<title>)
    --look <3d,2d>      which looks to draw (default: both)
    --review            also write review-<look>.mp4, with a slate strip, name tags and travel lines
    --captions          like --review, with each scene's note under the picture
    --fps <n>           frames per second (default: the spec's, else 12)
    --board-only        stop after the board
    --jobs <n>          browser tabs drawing frames at once (default: half the cores, up to 6)
See docs/spec.md for the spec.`;

const die = (msg) => { console.error("konte: " + msg); process.exit(1); };
const argv = process.argv.slice(2), cmd = argv.shift();
if (!cmd || cmd === "-h" || cmd === "--help") { console.log(USAGE); process.exit(0); }
if (cmd === "-v" || cmd === "--version") { console.log(VERSION); process.exit(0); }
const opt = { look: "3d,2d" }, rest = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  const value = () => { const v = argv[++i]; if (v == null || v.startsWith("-")) die(`${a} needs a value\n\n${USAGE}`); return v; };
  if (a === "-o" || a === "--out") opt.out = value(); else if (a === "--look") opt.look = value(); else if (a === "--fps") opt.fps = Number(value()); else if (a === "--jobs") opt.jobs = Number(value());
  else if (a === "--review") opt.review = true; else if (a === "--captions") opt.review = opt.captions = true; else if (a === "--board-only") opt.boardOnly = true;
  else if (a.startsWith("-")) die(`unknown option ${a}\n\n${USAGE}`); else rest.push(a);
}
if (!["lint", "render"].includes(cmd)) die(`unknown command "${cmd}"\n\n${USAGE}`);
if (!rest[0]) die(`${cmd} needs a spec file\n\n${USAGE}`);
// a bare name such as "sneaker-ad" means the example shipped with konte, unless a file of that name is here
const bundled = /^[a-z0-9-]+$/.test(rest[0]) && !existsSync(resolve(rest[0])) ? join(HERE, "examples", rest[0] + ".json") : null;
const specFile = bundled && existsSync(bundled) ? bundled : resolve(rest[0]);
let spec;
try { spec = JSON.parse(readFileSync(specFile, "utf8")); } catch (e) { die(`cannot read ${specFile}: ${e.message}`); }
const stage = loadSpec(spec);
if (stage.errors.length) { console.error(`konte: ${specFile} has ${stage.errors.length} error(s):`); for (const e of stage.errors) console.error("  error  " + e); process.exit(1); }
const notes = lint(stage);
const printLint = () => { for (const n of notes) console.log(`  ${n.level.padEnd(5)}  ${n.scene ? `scene ${n.scene}: ` : ""}${n.msg}`); };
const nErr = notes.filter((n) => n.level === "error").length;
if (cmd === "lint") {
  console.log(`${stage.title}: ${stage.scenes.length} scene(s), ${stage.seconds}s, ${stage.width}x${stage.height}`);
  stage.scenes.forEach((s, i) => console.log(`  scene ${i + 1}  ${String(s.seconds).padStart(4)}s  ${s.camera.desc}  on ${s.camera.subject ?? "-"}  ·  ${s.title}`));
  printLint(); console.log(nErr ? `${nErr} error(s)` : "ok"); process.exit(nErr ? 1 : 0);
}

// Each drawn frame is held for a whole number of video frames, so the video plays at 24 fps or more and every cut falls exactly on a frame.
const HOLD = (fps) => Math.max(1, Math.ceil(24 / fps));

// ── render ─────────────────────────────────────────────────────────────────
const looks = [...new Set(opt.look.split(",").filter(Boolean))];
if (!looks.length) die("--look takes 3d and/or 2d");
for (const l of looks) if (!["3d", "2d"].includes(l)) die(`--look takes 3d and/or 2d, not "${l}"`);
if (opt.fps != null && !(opt.fps >= 1 && opt.fps <= 60)) die("--fps must be between 1 and 60");
if (opt.jobs != null && !(Number.isInteger(opt.jobs) && opt.jobs >= 1)) die("--jobs must be a whole number, 1 or more");
const CHROME = [process.env.CHROME, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium", "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge", "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"].find((p) => p && existsSync(p));
if (!CHROME) die("no Chrome or Chromium found. Install one, or set CHROME to its executable.");
if (!opt.boardOnly && spawnSync("ffmpeg", ["-version"]).status !== 0) die("ffmpeg is not on PATH. Install it (brew install ffmpeg), or pass --board-only.");
const out = resolve(opt.out ?? join("konte-out", safeName(stage.title)));  // a title can never name a folder outside konte-out
mkdirSync(out, { recursive: true });
const JOBS = Math.max(1, Math.min(opt.jobs ?? Math.min(6, Math.floor(availableParallelism() / 2)), 12));
// On a machine with no graphics card (a server, a CI runner) Chrome has to be told it may draw WebGL in software.
const GL = process.platform === "linux" ? ["--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] : [];
const T0 = Date.now(), secs = (t) => ((Date.now() - t) / 1000).toFixed(1) + "s";

// The page may fetch exactly these and nothing else.
const SERVED = { "/src/render.html": "text/html; charset=utf-8", "/src/stage.js": "text/javascript", "/src/pose.js": "text/javascript", "/src/math.js": "text/javascript", "/src/prompts.js": "text/javascript", "/vendor/three.module.js": "text/javascript" };
const server = createServer((req, res) => {
  const path = (req.url ?? "").split("?")[0];
  if (path === "/spec.json") return res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(spec));
  if (!Object.hasOwn(SERVED, path)) return res.writeHead(404).end();
  res.writeHead(200, { "content-type": SERVED[path] }).end(readFileSync(join(HERE, path)));
});
let chrome, ws, profile, encoder, partFile;
// Wait for a child to exit; one that ignores the polite signal for 3 s is killed outright, so nothing it owns is deleted under it.
const gone = (child) => new Promise((ok) => {
  if (!child || child.exitCode != null || child.signalCode != null) return ok();
  const timer = setTimeout(() => { try { child.kill("SIGKILL"); } catch {} setTimeout(ok, 500); }, 3000);
  child.once("exit", () => { clearTimeout(timer); ok(); });
});
let cleaning = null;
const cleanup = () => (cleaning ??= (async () => {
  try { ws?.close(); } catch {}
  try { encoder?.kill(); } catch {} try { chrome?.kill(); } catch {} try { server.close(); } catch {}
  await Promise.all([gone(encoder), gone(chrome)]);  // the profile and the half-written video can only go once their owners have
  if (partFile) try { rmSync(partFile, { force: true }); } catch {}
  if (profile) try { rmSync(profile, { recursive: true, force: true, maxRetries: 3 }); } catch {}
})());
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => cleanup().then(() => process.exit(sig === "SIGINT" ? 130 : 143)));

try {
  await new Promise((ok, no) => { server.once("error", (e) => no(new Error("could not open a local port: " + e.message))); server.listen(0, "127.0.0.1", ok); });
  const base = `http://127.0.0.1:${server.address().port}`;
  profile = mkdtempSync(join(tmpdir(), "konte-chrome-"));
  chrome = spawn(CHROME, ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--hide-scrollbars", "--no-first-run", ...GL, ...(process.env.KONTE_CHROME_FLAGS ?? "").split(/\s+/).filter(Boolean), "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
  const wsUrl = await new Promise((ok0, no0) => {
    let err = ""; const timer = setTimeout(() => no(new Error("Chrome did not start within 20s")), 20000);
    const ok = (v) => { clearTimeout(timer); ok0(v); }, no = (e) => { clearTimeout(timer); no0(e); };
    chrome.on("error", (e) => no(new Error("could not start Chrome: " + e.message)));
    chrome.stderr.on("data", (d) => { err += d; const m = err.match(/DevTools listening on (ws:\/\/\S+)/); if (m) ok(m[1]); });
    chrome.on("exit", () => no(new Error("Chrome exited before it was ready: " + err.slice(0, 300))));
  });
  const debug = `http://127.0.0.1:${new URL(wsUrl).port}`;
  // One tab = one renderer. Frames are independent of each other, so several tabs draw them side by side.
  const sockets = []; let runs = 0;
  const attach = async (target) => {
    const sock = new WebSocket(target.webSocketDebuggerUrl); sockets.push(sock);
    await new Promise((ok, no) => { sock.onopen = ok; sock.onerror = () => no(new Error("could not connect to Chrome")); });
    let id = 0; const waiting = new Map();
    sock.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && waiting.has(d.id)) { waiting.get(d.id)(d); waiting.delete(d.id); } };
    sock.onclose = () => { for (const f of waiting.values()) f({ error: { message: "Chrome went away" } }); waiting.clear(); };
    const send = (method, params = {}) => new Promise((ok, no) => {
      const i = ++id, timer = setTimeout(() => { waiting.delete(i); no(new Error(method + " timed out after 120s")); }, 120000);  // software rendering is slow on its first frame
      waiting.set(i, (d) => { clearTimeout(timer); d.error ? no(new Error(method + ": " + d.error.message)) : ok(d.result); });
      sock.send(JSON.stringify({ id: i, method, params }));
    });
    const evaluate = async (expression) => {
      const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
      return r.result.value;
    };
    await send("Page.enable");
    // Each load carries its own run id, and the page is only "ready" when it reports that id: a tab that still holds
    // the previous page (or the board) cannot be mistaken for the new one.
    const open = async (look, hud, scale = 2) => {
      const run = `${process.pid}-${++runs}`;
      await send("Emulation.setDeviceMetricsOverride", { width: stage.width, height: stage.height + 80, deviceScaleFactor: scale, mobile: false });
      await send("Page.navigate", { url: `${base}/src/render.html?spec=/spec.json&look=${look}&hud=${hud}${opt.captions ? "&captions=1" : ""}${opt.fps ? "&fps=" + opt.fps : ""}&run=${run}#capture` });
      for (let i = 0; ; i++) {
        let ok = false; try { ok = await evaluate(`!!(window.KONTE && window.KONTE.ready && window.KONTE.run === "${run}")`); } catch {}  // the old page's context may vanish mid-question
        if (ok) break; if (i > 300) throw new Error("the renderer did not become ready"); await new Promise((r) => setTimeout(r, 50));
      }
      const K = JSON.parse(await evaluate("JSON.stringify(window.KONTE)"));
      if (K.errors.length) throw new Error("spec errors: " + K.errors.join("; "));
      await send("Emulation.setDeviceMetricsOverride", { width: K.width, height: K.height, deviceScaleFactor: scale, mobile: false });
      return K;
    };
    const grab = async (f, quality = 90, format = "jpeg") => { await evaluate(`setFrame(${f})`); return Buffer.from((await send("Page.captureScreenshot", format === "png" ? { format } : { format, quality })).data, "base64"); };
    return { send, evaluate, open, grab };
  };
  const first = (await (await fetch(`${debug}/json`)).json()).find((t) => t.type === "page");
  const tabs = [await attach(first)];
  ws = { close: () => { for (const sock of sockets) try { sock.close(); } catch {} } };
  const { send, evaluate, open, grab } = tabs[0];
  if (!opt.boardOnly) for (let i = 1; i < JOBS; i++) tabs.push(await attach(await (await fetch(`${debug}/json/new?about:blank`, { method: "PUT" })).json()));
  // Frames go to ffmpeg through a pipe. The video is written beside its final name and renamed only when ffmpeg succeeds,
  // so a failed run never leaves a broken file where a good one is expected.
  const video = async (look, hud, file) => {
    const K = (await Promise.all(tabs.map((tab) => tab.open(look, hud))))[0];
    partFile = file.replace(/\.mp4$/, ".part.mp4");
    const ff = encoder = spawn("ffmpeg", ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(K.fps), "-c:v", "mjpeg", "-i", "-", "-vf", "pad=ceil(iw/2)*2:ceil(ih/2)*2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-r", String(K.fps * HOLD(K.fps)), "-movflags", "+faststart", partFile], { stdio: ["pipe", "inherit", "inherit"] });
    let failed = null;
    const done = new Promise((ok) => { ff.once("error", (e) => { failed ??= e; ok(-1); }); ff.once("close", (code) => ok(code)); });  // listening from the start: an early death is not missed
    ff.stdin.on("error", (e) => (failed ??= e));
    let over = false; done.then(() => (over = true));
    for (let f = 0; f < K.frames && !failed && !over; f += tabs.length) {
      const imgs = await Promise.all(tabs.map((tab, k) => (f + k < K.frames ? tab.grab(f + k) : null)));
      for (const img of imgs) if (img && !failed && !over && !ff.stdin.write(img)) await Promise.race([new Promise((r) => ff.stdin.once("drain", r)), done]);  // if ffmpeg dies while the pipe is full, stop waiting
    }
    try { ff.stdin.end(); } catch {}
    const code = await done; encoder = null;
    if (failed || code !== 0) { try { rmSync(partFile, { force: true }); } catch {} partFile = null; throw new Error(`ffmpeg failed writing ${file}${failed ? ": " + failed.message : ` (exit ${code})`}`); }
    renameSync(partFile, file); partFile = null;
    return K;
  };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  let drawn = null;
  const written = [], kept = new Set();
  // Every file konte writes goes through here. A name that is already a link is refused, so a render can never write into a file somewhere else.
  const link = (p) => { try { return lstatSync(p).isSymbolicLink(); } catch { return false; } };
  const keep = (name) => { const p = join(out, name); for (const q of [p, p.replace(/\.mp4$/, ".part.mp4")]) if (link(q)) throw new Error(`${q} is a link; konte will not write through it`); kept.add(name); return p; };
  for (const look of looks) {
    // 1. the board: three moments per scene, the note under them. This is where the words live.
    let t = Date.now(), K = await open(look, "clean", 1.5);
    drawn = { fps: K.fps, shots: K.ranges.map((r) => ({ first: r.first, last: r.last, seconds: (r.last - r.first + 1) / K.fps })) };
    const rows = [];
    for (const s of K.scenes) {
      const imgs = [];
      for (let b = 0; b < s.beats.length; b++) imgs.push([(await grab(s.frames[b], 86)).toString("base64"), s.beats[b]]);  // the page worked out which of the scene's own frames shows each beat
      rows.push({ s, imgs });
    }
    const two = look === "2d", wide = stage.width > stage.height, cols = wide ? 1 : 2, pw = wide ? 300 : 150, most = Math.max(...rows.map((r) => r.imgs.length));
    const html = `<!doctype html><meta charset="utf-8"><style>
      body{margin:0;padding:28px 30px 20px;width:${cols * (pw * most + (most - 1) * 26) + (cols - 1) * 26}px;background:${two ? "#f4f0e6" : "#fff"};color:#1b1b20;font:13px/1.45 "Helvetica Neue","Apple SD Gothic Neo","Noto Sans KR",system-ui,sans-serif}
      h1{font-size:20px;margin:0 0 2px} .log{color:#555;margin:0 0 18px;max-width:760px} .grid{display:grid;grid-template-columns:repeat(${cols},1fr);gap:22px 26px}
      .sc{break-inside:avoid} .hd{display:flex;gap:8px;align-items:baseline;border-bottom:1.5px solid #1b1b20;padding-bottom:4px;margin-bottom:5px}
      .n{font-weight:800;font-size:15px} .ti{font-weight:700} .len{margin-left:auto;color:#555;font-size:11px} .cam{color:#555;font-size:11px;margin:0 0 7px}
      .fr{display:flex;gap:5px;align-items:center} .fr img{width:${pw}px;border:1.5px solid #1b1b20;border-radius:2px;display:block} .ar{color:#1b1b20;font-size:18px;width:16px;text-align:center;margin-top:-14px}
      .fr span.t{display:block;font-size:10px;color:#666;margin-top:2px;font-variant-numeric:tabular-nums}
      .note{margin:7px 0 0;font-size:13px} .lint{margin-top:20px;padding-top:10px;border-top:1px solid #bbb;font-size:11.5px;color:#444} .lint b{color:#b3261e}
      .ft{margin-top:14px;font-size:10.5px;color:#888}</style>
      <h1>${esc(stage.title)}</h1><p class="log">${stage.logline ? esc(stage.logline) + " · " : ""}${stage.scenes.length} scene${stage.scenes.length > 1 ? "s" : ""} · ${+stage.seconds.toFixed(1)}s</p><div class="grid">
      ${rows.map(({ s, imgs }, i) => `<div class="sc"><div class="hd"><span class="n">${i + 1}</span><span class="ti">${esc(s.title)}</span><span class="len">${s.seconds}s</span></div><p class="cam">${esc(s.cameraLong)}</p>
        <div class="fr">${imgs.map(([b, bt]) => `<div><img src="data:image/jpeg;base64,${b}"><span class="t">${bt.toFixed(1)}s</span></div>`).join('<span class="ar">→</span>')}</div><p class="note">${esc(s.note)}</p></div>`).join("")}
      </div>${notes.length ? `<div class="lint">${notes.map((n) => `${n.level === "error" ? "<b>error</b>" : n.level} · ${n.scene ? "scene " + n.scene + ": " : ""}${esc(n.msg)}`).join("<br>")}</div>` : ""}
      <div class="ft">konte ${VERSION} · ${look} look</div>`;
    const tree = await send("Page.getFrameTree");
    await send("Emulation.setDeviceMetricsOverride", { width: 1400, height: 900, deviceScaleFactor: 2, mobile: false });
    await send("Page.setDocumentContent", { frameId: tree.frameTree.frame.id, html });
    await new Promise((r) => setTimeout(r, 150));
    const size = JSON.parse(await evaluate("Promise.all([...document.images].map(i => i.decode().catch(() => 0))).then(() => JSON.stringify([document.body.offsetWidth, document.documentElement.scrollHeight]))"));
    const shot = await send("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: size[0], height: size[1], scale: 1 }, captureBeyondViewport: true });
    writeFileSync(keep(`board-${look}.png`), Buffer.from(shot.data, "base64")); written.push([`board-${look}.png`, secs(t)]);
    if (opt.boardOnly) continue;
    // 2. the sketch: the picture alone, no words on it, so it can be watched as it is or handed to a video model
    t = Date.now(); K = await video(look, "clean", keep(`sketch-${look}.mp4`)); written.push([`sketch-${look}.mp4`, `${secs(t)}, ${K.frames} frames at ${K.fps}fps`]);
    // 3. one clip per scene, cut from the sketch: video models take a short single shot as a reference, not a whole film
    t = Date.now(); mkdirSync(join(out, "shots"), { recursive: true });
    if (!lstatSync(join(out, "shots")).isDirectory()) throw new Error(`${join(out, "shots")} is a link, not a folder; konte will not write through it`);
    K.ranges.forEach((r, i) => {
      const name = `${String(i + 1).padStart(2, "0")}-${look}.mp4`, final = keep(`shots/${name}`), part = final.replace(/\.mp4$/, ".part.mp4");  // keep() refuses links before anything is written
      const m = HOLD(K.fps);  // cut on whole frames of the sketch, so a clip never carries a frame of its neighbour
      const cut = spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-i", join(out, `sketch-${look}.mp4`), "-vf", `trim=start_frame=${r.first * m}:end_frame=${(r.last + 1) * m},setpts=PTS-STARTPTS`, "-r", String(K.fps * m), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-an", "-movflags", "+faststart", part], { encoding: "utf8" });
      if (cut.status !== 0) { try { rmSync(part, { force: true }); } catch {} throw new Error(`ffmpeg failed cutting shots/${name}: ${(cut.stderr || "").trim().slice(0, 200)}`); }
      renameSync(part, final);
    });
    // the first and last frame of each shot as stills, for models that start from an image instead of a video
    for (let i = 0; i < K.ranges.length; i++) for (const [end, f] of [["first", K.ranges[i].first], ["last", K.ranges[i].last]]) writeFileSync(keep(`shots/${String(i + 1).padStart(2, "0")}-${look}-${end}.png`), await tabs[0].grab(f, 90, "png"));
    written.push([`shots/NN-${look}.mp4`, `${secs(t)}, ${K.ranges.length} clips, each with -first.png and -last.png`]);
    // 4. on request, the review copy: slate strip, name tags, travel lines
    if (opt.review) { t = Date.now(); await video(look, "review", keep(`review-${look}.mp4`)); written.push([`review-${look}.mp4`, secs(t)]); }
  }
  const MANAGED = /^(?:(?:board|sketch|review)-(?:3d|2d)\.(?:png|mp4)|prompts\.md|shots\.json|shots\/\d{2,}-(?:3d|2d)(?:-first|-last)?\.(?:mp4|png))$/;
  // What an earlier render left here and this one did not write again. Only names that render listed in its own shots.json count,
  // and only plain files in a plain shots/ folder: konte never removes a file it has no record of writing, and never follows a link.
  const plain = (p) => { try { return lstatSync(p).isFile(); } catch { return false; } };
  const folder = (p) => { try { return lstatSync(p).isDirectory(); } catch { return false; } };
  let before = []; try { const old = JSON.parse(readFileSync(join(out, "shots.json"), "utf8")); if (Array.isArray(old.files)) before = old.files.filter((f) => typeof f === "string" && MANAGED.test(f)); } catch {}
  const leftover = () => before.filter((f) => !kept.has(f) && (!f.startsWith("shots/") || folder(join(out, "shots"))) && plain(join(out, f)));
  let stale = [];
  if (opt.boardOnly) stale = leftover();  // a board alone replaces nothing else, so say what is older than it
  else {
    writeFileSync(keep("prompts.md"), promptsFor(stage, looks[0], drawn.shots)); written.push(["prompts.md", "two prompts per shot"]);
    // shots.json lists exactly what this run wrote; anything konte wrote here before and did not write now is removed, so an old clip cannot pass for a current one
    writeFileSync(keep("shots.json"), JSON.stringify({ konte: VERSION, title: stage.title, seconds: stage.seconds, fps: drawn.fps, videoFps: drawn.fps * HOLD(drawn.fps), looks, picture: { width: stage.width * 2, height: stage.height * 2 },
      scenes: stage.scenes.map((s, i) => ({ n: i + 1, title: s.title, start: s.start, seconds: s.seconds, clipSeconds: +drawn.shots[i].seconds.toFixed(3), frames: [drawn.shots[i].first, drawn.shots[i].last], note: s.note, camera: s.camera.desc, cameraWords: cameraWords(s), subject: s.camera.subject, beats: s.beats.map((t) => +t.toFixed(2)), cast: s.actors.map((a) => a.who) })),
      cast: Object.values(stage.cast).map((c) => ({ id: c.id, label: c.label, color: c.color, kind: c.kind })), files: [...kept, "shots.json"].filter((f, i, all) => all.indexOf(f) === i).sort(), lint: notes }, null, 1));
    for (const f of leftover()) rmSync(join(out, f), { force: true });
  }
  console.log(out);
  for (const [f, how] of written) console.log(`  ${f.padEnd(18)} ${how}`);
  console.log(`${opt.boardOnly ? "" : "  shots.json\n"}  total ${secs(T0)}`);
  drawn.shots.forEach((r, i) => { if (Math.abs(r.seconds - stage.scenes[i].seconds) > 0.011) console.log(`  info   scene ${i + 1}: ${stage.scenes[i].seconds}s in the spec is ${+r.seconds.toFixed(2)}s at ${drawn.fps} fps`); });
  if (stale.length) console.log(`  note   only the board was drawn; ${stale.length} file(s) in this folder are from an earlier render`);
  printLint();
  if (nErr) { console.log(`${nErr} lint error(s): the files were written, but fix these before trusting them`); process.exitCode = 1; }
} catch (e) { console.error("konte: " + e.message); process.exitCode = 1; } finally { await cleanup(); }
