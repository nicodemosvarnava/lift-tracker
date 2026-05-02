export const PROGRAMS = {
  A: {
    name: 'Push + Core',
    exercises: [
      { name: 'Plank', muscle: 'Core', reps: 'Seconds', sets: ['Round 1', 'Round 2'], isTime: true },
      { name: 'Russian Twists', muscle: 'Obliques', reps: '20 total', sets: ['Round 1', 'Round 2'] },
      { name: '45deg Back Extension', muscle: 'Lower Back', reps: '12–15', sets: ['Warm-up', 'Set 1', 'Set 2'] },
      { name: 'Bench Press', muscle: 'Chest', reps: '6–10', sets: ['Warm-up', 'Set 1', 'Set 2'] },
      { name: 'Incline DB Press', muscle: 'Upper Chest', reps: '8–12', sets: ['Warm-up', 'Set 1', 'Set 2'] },
      { name: 'Overhead Press', muscle: 'Shoulders', reps: '6–10', sets: ['Warm-up', 'Set 1', 'Set 2'] },
      { name: 'Lateral Raises', muscle: 'Delts', reps: '12–15', sets: ['Warm-up', 'Set 1', 'Set 2'] },
      { name: 'Tricep Dips', muscle: 'Triceps', reps: '8–12', sets: ['Warm-up', 'Set 1', 'Set 2'] },
    ],
  },
  B: {
    name: 'Pull + Legs',
    exercises: [
      { name: 'Deadlift', muscle: 'Posterior Chain', reps: '5–8', sets: ['Warm-up', 'Set 1', 'Set 2'] },
      { name: 'Pull-ups', muscle: 'Back / Lats', reps: '6–10', sets: ['Warm-up', 'Set 1', 'Set 2'] },
      { name: 'Seated Cable Row', muscle: 'Mid Back', reps: '8–12', sets: ['Warm-up', 'Set 1', 'Set 2'] },
      { name: 'Leg Press', muscle: 'Quads', reps: '8–12', sets: ['Warm-up', 'Set 1', 'Set 2'] },
      { name: 'Leg Curl', muscle: 'Hamstrings', reps: '10–12', sets: ['Warm-up', 'Set 1', 'Set 2'] },
      { name: 'Romanian Deadlift', muscle: 'Hamstrings / Glutes', reps: '8–12', sets: ['Warm-up', 'Set 1', 'Set 2'] },
      { name: 'DB Bicep Curl', muscle: 'Biceps', reps: '10–15', sets: ['Warm-up', 'Set 1', 'Set 2'] },
      { name: 'Rear Delt Fly', muscle: 'Rear Delts', reps: '12–15', sets: ['Warm-up', 'Set 1', 'Set 2'] },
    ],
  },
};

export function allExercises() {
  const out = [];
  for (const [day, prog] of Object.entries(PROGRAMS)) {
    for (const ex of prog.exercises) {
      out.push({ day, name: ex.name, muscle: ex.muscle, isTime: !!ex.isTime });
    }
  }
  return out;
}
