// Full-body A/B: two sessions a week, each hits legs, push, pull and core.
// Exercise names match the old push/pull program so history, "last session"
// prefill and progress charts carry over.
//
// `inc` is the weight jump (in kg) suggested once every working set hits the
// top of the rep range. Doubled automatically when units are lb.
const W3 = ['Warm-up', 'Set 1', 'Set 2', 'Set 3'];
const W2 = ['Warm-up', 'Set 1', 'Set 2'];
const S2 = ['Set 1', 'Set 2'];

export const PROGRAMS = {
  A: {
    name: 'Full Body A',
    exercises: [
      { name: 'Squat', muscle: 'Quads / Glutes', reps: '6–10', sets: W3, inc: 2.5 },
      { name: 'Bench Press', muscle: 'Chest', reps: '6–10', sets: W3, inc: 2.5 },
      { name: 'Seated Cable Row', muscle: 'Mid Back', reps: '8–12', sets: W2, inc: 2.5 },
      { name: 'Leg Curl', muscle: 'Hamstrings', reps: '10–12', sets: S2, inc: 2.5 },
      { name: 'Lateral Raises', muscle: 'Delts', reps: '12–15', sets: S2, inc: 2 },
      { name: 'DB Bicep Curl', muscle: 'Biceps', reps: '10–15', sets: S2, inc: 2 },
      { name: 'Plank', muscle: 'Core', reps: '45–90', sets: ['Round 1', 'Round 2'], isTime: true },
    ],
  },
  B: {
    name: 'Full Body B',
    exercises: [
      { name: 'Deadlift', muscle: 'Posterior Chain', reps: '5–8', sets: W3, inc: 5 },
      { name: 'Pull-ups', muscle: 'Back / Lats', reps: '6–10', sets: ['Set 1', 'Set 2', 'Set 3'], isBodyweight: true },
      { name: 'Overhead Press', muscle: 'Shoulders', reps: '6–10', sets: W2, inc: 2.5 },
      { name: 'Incline DB Press', muscle: 'Upper Chest', reps: '8–12', sets: S2, inc: 2 },
      { name: 'Tricep Dips', muscle: 'Triceps', reps: '8–12', sets: S2, inc: 2.5 },
      { name: 'Rear Delt Fly', muscle: 'Rear Delts', reps: '12–15', sets: S2, inc: 2.5 },
      { name: 'Russian Twists', muscle: 'Obliques', reps: '20 total', sets: ['Round 1', 'Round 2'] },
    ],
  },
};

// Every exercise in the current program, plus any older ones found in
// `sessions` so retired lifts stay viewable in Progress.
export function allExercises(sessions = []) {
  const out = [];
  const seen = new Set();
  for (const [day, prog] of Object.entries(PROGRAMS)) {
    for (const ex of prog.exercises) {
      seen.add(ex.name);
      out.push({ day, name: ex.name, muscle: ex.muscle, isTime: !!ex.isTime, isBodyweight: !!ex.isBodyweight });
    }
  }
  for (const s of sessions) {
    for (const ex of s.exercises || []) {
      if (seen.has(ex.name)) continue;
      seen.add(ex.name);
      const first = (ex.sets || [])[0] || {};
      out.push({ day: 'old', name: ex.name, muscle: ex.muscle, isTime: !!first.isTime, isBodyweight: !!first.isBodyweight });
    }
  }
  return out;
}

function parseRange(reps) {
  const m = String(reps).match(/(\d+)\s*[–-]\s*(\d+)/);
  return m ? { lo: +m[1], hi: +m[2] } : null;
}

function round(n) {
  return Math.round(n * 100) / 100;
}

// Double progression, per set: if a working set reached the top of the rep
// range last time, add `inc` and drop back to the bottom of the range;
// otherwise keep the weight and aim for one more rep. Warm-ups repeat as-is.
// Returns [{ weight, reps, bump }] aligned with `ex.sets`, or null with no history.
export function suggestSets(ex, lastSets, units = 'kg') {
  if (!lastSets || !lastSets.length) return null;
  const range = parseRange(ex.reps);
  const inc = (ex.inc || 2.5) * (units === 'lb' ? 2 : 1);
  const byLabel = new Map(lastSets.filter(Boolean).map((s) => [s.label, s]));
  const working = lastSets.filter((s) => s && s.label !== 'Warm-up' && (s.reps || s.weight));
  const lastWorking = working[working.length - 1];

  return ex.sets.map((label) => {
    const prev = byLabel.get(label) || (label === 'Warm-up' ? null : lastWorking);
    if (!prev) return { weight: '', reps: '', bump: false };
    const w = parseFloat(prev.weight);
    const r = parseInt(prev.reps, 10);
    if (label === 'Warm-up' || !Number.isFinite(r)) {
      return { weight: prev.weight ?? '', reps: prev.reps ?? '', bump: false };
    }
    if (ex.isTime) return { weight: '', reps: String(r + 5), bump: false };
    if (!range) return { weight: prev.weight ?? '', reps: String(r), bump: false };
    if (ex.isBodyweight) return { weight: '', reps: String(r + 1), bump: false };
    if (r >= range.hi && Number.isFinite(w) && w > 0) {
      return { weight: String(round(w + inc)), reps: String(range.lo), bump: true };
    }
    return {
      weight: Number.isFinite(w) ? String(w) : '',
      reps: String(Math.min(r + 1, range.hi)),
      bump: false,
    };
  });
}
