// Poses for the mannequin, as joint angles in radians. Forward is positive for hips and shoulders; knees and elbows only bend one way.
// Each action is a pure function of how far the figure has travelled (gait), the clock, and progress through a jump.
const { sin, cos, max, PI } = Math;
const REST = { lean: 0, pitch: 0, head: 0, turn: 0, thL: 0, knL: 0, thR: 0, knR: 0, shL: 0, shR: 0, abL: 0.06, abR: 0.06, elL: 0.18, elR: 0.18 };
const gait = (ph, hip, knee, arm, elbow, lean, hipFwd = 0) => {
  const leg = (p) => [hipFwd + hip * sin(p), 0.12 + knee * max(0, cos(p)) ** 1.3 + 0.1 * max(0, -sin(p))];
  const [thL, knL] = leg(ph), [thR, knR] = leg(ph + PI);
  return { ...REST, lean, thL, knL, thR, knR, shL: -arm * sin(ph), shR: arm * sin(ph), elL: elbow, elR: elbow, bob: 0.03 * Math.abs(cos(ph)) };
};
const POSES = {
  stand: (s) => ({ ...REST, shL: 0.04 * sin(s.time * 1.3), shR: -0.04 * sin(s.time * 1.3), head: 0.03 * sin(s.time * 0.9) }),
  walk: (s) => gait(s.dist * 4.4, 0.42, 0.75, 0.4, 0.3, 0.05),
  run: (s) => gait(s.dist * 2.6, 0.8, 1.45, 0.95, 1.5, 0.28, 0.18),
  // one knee on the floor, the other foot planted in front; "hands" tells the renderer to put both hands on that foot's laces
  kneel: (s) => ({ ...REST, hands: "footL", lean: 1.3, head: -0.35, thL: 1.5, knL: 1.5, thR: -0.1, knR: 1.6, shL: 0.75 + 0.06 * sin(s.time * 9), shR: 0.75 - 0.06 * sin(s.time * 9), elL: 0.5, elR: 0.5, abL: -0.1, abR: 0.02 }),
  sit: () => ({ ...REST, lean: -0.05, thL: 1.5, knL: 1.5, thR: 1.5, knR: 1.5, shL: 0.5, shR: 0.5, elL: 0.9, elR: 0.9 }),
  squat: () => ({ ...REST, lean: 0.5, thL: 1.25, knL: 2.3, thR: 1.25, knR: 2.3, shL: 0.9, shR: 0.9, elL: 0.6, elR: 0.6 }),
  // a running jump: drive off the back leg, split in the air, gather for the landing
  leap: (s) => {
    const u = s.air ?? 0, open = sin(PI * u);  // outside the jump window: the take-off pose
    return { ...REST, lean: 0.3 - 0.15 * open, thL: 0.5 + 0.9 * open, knL: 0.9 - 0.7 * open, thR: 0.2 - 1.0 * open, knR: 0.5 + 0.6 * open, shL: -0.9 * open, shR: 1.6 * open + 0.4, elL: 0.9, elR: 0.5, abL: 0.25, abR: 0.25 };
  },
  cheer: (s) => ({ ...REST, shL: 2.75, shR: 2.75, abL: 0.35, abR: 0.35, elL: 0.25 + 0.2 * sin(s.time * 10), elR: 0.25 - 0.2 * sin(s.time * 10), bob: 0.05 * Math.abs(sin(s.time * 10)), head: -0.2 }),
  reach: () => ({ ...REST, lean: 0.15, shR: 1.45, elR: 0.1, head: -0.05 }),
  wave: (s) => ({ ...REST, shR: 2.5, abR: 0.5, elR: 0.9 + 0.5 * sin(s.time * 9) }),
  talk: (s) => ({ ...REST, shR: 0.55 + 0.12 * sin(s.time * 3.1), elR: 1.3 + 0.25 * sin(s.time * 4.3), abR: 0.12, shL: 0.1, elL: 0.5, head: 0.04 * sin(s.time * 2.7) }),
  // one hand raised beside the face, holding something up to the camera
  show: (s) => ({ ...REST, shR: 0.9 + 0.03 * sin(s.time * 2.1), elR: 1.7, abR: 0.02, shL: 0.05, elL: 0.3, head: 0.02 * sin(s.time * 1.7) }),
  carry: (s) => { const g = gait(s.dist * 4.4, 0.36, 0.7, 0, 0, 0.04); return { ...g, shL: 0.35, shR: 0.35, elL: 1.35, elR: 1.35, abL: -0.05, abR: -0.05 }; },
  lie: () => ({ ...REST, pitch: PI / 2, shL: 0.1, shR: 0.1, abL: 0.25, abR: 0.25 }),
};
const ARMS = ["shL", "shR", "elL", "elR", "abL", "abR", "head"];
// "sit+talk": the body of the first action with the arms and head of the second
const one = (action, s) => {
  const [body, gesture] = String(action).split("+"), p = (POSES[body] ?? POSES.stand)(s);
  if (gesture && POSES[gesture]) { const g = POSES[gesture](s); for (const k of ARMS) p[k] = g[k]; delete p.hands; }
  return p;
};
// The pose for an actor state from stage.js, cross-faded for a moment after each change of action.
export function poseOf(state) {
  const p = one(state.action, state);
  p.turn += state.turn ?? 0;
  if (!state.blend) return p;
  const q = one(state.blend.from, state); q.turn += state.turn ?? 0;
  const k = state.blend.k, out = {};
  for (const key of Object.keys(REST)) out[key] = q[key] + (p[key] - q[key]) * k;
  out.bob = (q.bob ?? 0) + ((p.bob ?? 0) - (q.bob ?? 0)) * k;
  out.hands = (k > 0.5 ? p : q).hands;
  return out;
}
