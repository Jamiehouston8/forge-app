// Forge Gym — exercise library and strength standards.
//
// muscles.p = primary (a set counts fully toward that muscle's weekly volume)
// muscles.s = secondary (counts as half a set)
// std = estimated 1-rep max, as a multiple of bodyweight, that earns BLACK BELT
//       on that lift. Belts below black are fractions of it (see BELTS).
//       Numbers are rough "advanced lifter" standards, not medical advice.
// bw  = bodyweight exercise: load = bodyweight + any added weight
// bb  = barbell lift (gets the plate calculator)
// std null = accessory lift that adds volume but doesn't set a rank

const MUSCLES = {
  chest:      'Chest',
  shoulders:  'Shoulders',
  triceps:    'Triceps',
  biceps:     'Biceps',
  forearms:   'Forearms',
  traps:      'Traps',
  back:       'Back',
  lowerback:  'Lower back',
  abs:        'Core',
  glutes:     'Glutes',
  quads:      'Quads',
  hamstrings: 'Hamstrings',
  calves:     'Calves',
};

const EXERCISES = [
  // Chest
  { id: 'bench',        name: 'Bench Press',            muscles: { p: ['chest'], s: ['triceps', 'shoulders'] }, std: 1.75, bb: true },
  { id: 'incline_bench',name: 'Incline Bench Press',    muscles: { p: ['chest', 'shoulders'], s: ['triceps'] }, std: 1.45, bb: true },
  { id: 'db_bench',     name: 'Dumbbell Bench Press',   muscles: { p: ['chest'], s: ['triceps', 'shoulders'] }, std: 0.65 },
  { id: 'dips',         name: 'Dips',                   muscles: { p: ['chest', 'triceps'], s: ['shoulders'] }, std: 1.75, bw: true },
  { id: 'pushup',       name: 'Push-up',                muscles: { p: ['chest'], s: ['triceps', 'shoulders'] }, std: null, bw: true },
  { id: 'cable_fly',    name: 'Cable Fly',              muscles: { p: ['chest'], s: [] }, std: null },

  // Shoulders
  { id: 'ohp',          name: 'Overhead Press',         muscles: { p: ['shoulders'], s: ['triceps'] }, std: 1.1, bb: true },
  { id: 'db_shoulder',  name: 'Dumbbell Shoulder Press',muscles: { p: ['shoulders'], s: ['triceps'] }, std: 0.45 },
  { id: 'lat_raise',    name: 'Lateral Raise',          muscles: { p: ['shoulders'], s: [] }, std: null },
  { id: 'face_pull',    name: 'Face Pull',              muscles: { p: ['shoulders'], s: ['traps'] }, std: null },

  // Arms
  { id: 'curl',         name: 'Barbell Curl',           muscles: { p: ['biceps'], s: ['forearms'] }, std: 0.75, bb: true },
  { id: 'db_curl',      name: 'Dumbbell Curl',          muscles: { p: ['biceps'], s: ['forearms'] }, std: 0.32 },
  { id: 'hammer_curl',  name: 'Hammer Curl',            muscles: { p: ['biceps', 'forearms'], s: [] }, std: null },
  { id: 'skullcrusher', name: 'Skull Crusher',          muscles: { p: ['triceps'], s: [] }, std: 0.7, bb: true },
  { id: 'pushdown',     name: 'Triceps Pushdown',       muscles: { p: ['triceps'], s: [] }, std: null },
  { id: 'close_bench',  name: 'Close-Grip Bench',       muscles: { p: ['triceps', 'chest'], s: ['shoulders'] }, std: 1.5, bb: true },

  // Back
  { id: 'deadlift',     name: 'Deadlift',               muscles: { p: ['back', 'lowerback', 'hamstrings', 'glutes'], s: ['traps', 'forearms', 'quads'] }, std: 2.75, bb: true },
  { id: 'row',          name: 'Barbell Row',            muscles: { p: ['back'], s: ['biceps', 'lowerback', 'traps'] }, std: 1.5, bb: true },
  { id: 'pullup',       name: 'Pull-up',                muscles: { p: ['back'], s: ['biceps', 'forearms'] }, std: 1.6, bw: true },
  { id: 'chinup',       name: 'Chin-up',                muscles: { p: ['back', 'biceps'], s: ['forearms'] }, std: 1.65, bw: true },
  { id: 'lat_pulldown', name: 'Lat Pulldown',           muscles: { p: ['back'], s: ['biceps'] }, std: 1.2 },
  { id: 'cable_row',    name: 'Seated Cable Row',       muscles: { p: ['back'], s: ['biceps', 'traps'] }, std: 1.2 },
  { id: 'shrug',        name: 'Barbell Shrug',          muscles: { p: ['traps'], s: ['forearms'] }, std: 2.2, bb: true },
  { id: 'back_ext',     name: 'Back Extension',         muscles: { p: ['lowerback'], s: ['glutes', 'hamstrings'] }, std: null, bw: true },

  // Legs
  { id: 'squat',        name: 'Back Squat',             muscles: { p: ['quads', 'glutes'], s: ['lowerback', 'hamstrings'] }, std: 2.35, bb: true },
  { id: 'front_squat',  name: 'Front Squat',            muscles: { p: ['quads'], s: ['glutes', 'abs'] }, std: 1.9, bb: true },
  { id: 'leg_press',    name: 'Leg Press',              muscles: { p: ['quads', 'glutes'], s: ['hamstrings'] }, std: 4.25 },
  { id: 'lunge',        name: 'Walking Lunge',          muscles: { p: ['quads', 'glutes'], s: ['hamstrings'] }, std: null },
  { id: 'leg_ext',      name: 'Leg Extension',          muscles: { p: ['quads'], s: [] }, std: null },
  { id: 'rdl',          name: 'Romanian Deadlift',      muscles: { p: ['hamstrings', 'glutes'], s: ['lowerback'] }, std: 2.1, bb: true },
  { id: 'leg_curl',     name: 'Leg Curl',               muscles: { p: ['hamstrings'], s: [] }, std: null },
  { id: 'hip_thrust',   name: 'Hip Thrust',             muscles: { p: ['glutes'], s: ['hamstrings'] }, std: 2.9, bb: true },
  { id: 'calf_raise',   name: 'Standing Calf Raise',    muscles: { p: ['calves'], s: [] }, std: 2.4 },

  // Core
  { id: 'plank',        name: 'Plank (reps = seconds)', muscles: { p: ['abs'], s: [] }, std: null, bw: true },
  { id: 'hanging_leg',  name: 'Hanging Leg Raise',      muscles: { p: ['abs'], s: ['forearms'] }, std: null, bw: true },
  { id: 'cable_crunch', name: 'Cable Crunch',           muscles: { p: ['abs'], s: [] }, std: 1.3 },
];

const EX = Object.fromEntries(EXERCISES.map(e => [e.id, e]));

// Belt ladder. `at` = fraction of the lift's black-belt standard needed.
// Forge already uses belts for overall progress, so gym ranks use the same language.
const BELTS = [
  { name: 'White',  color: '#e8e8e8', at: 0    },
  { name: 'Yellow', color: '#ffd166', at: 0.25 },
  { name: 'Orange', color: '#ff8c42', at: 0.38 },
  { name: 'Green',  color: '#3ddc84', at: 0.5  },
  { name: 'Blue',   color: '#4d9fff', at: 0.62 },
  { name: 'Purple', color: '#9b6bff', at: 0.74 },
  { name: 'Brown',  color: '#b07a4f', at: 0.87 },
  { name: 'Black',  color: '#000000', at: 1    },
];

const TEMPLATES = [
  { id: 'push',  name: 'Push',       note: 'Chest · shoulders · triceps', exercises: ['bench', 'ohp', 'incline_bench', 'lat_raise', 'pushdown'] },
  { id: 'pull',  name: 'Pull',       note: 'Back · biceps',               exercises: ['deadlift', 'pullup', 'row', 'face_pull', 'curl'] },
  { id: 'legs',  name: 'Legs',       note: 'Quads · hamstrings · glutes', exercises: ['squat', 'rdl', 'leg_press', 'leg_curl', 'calf_raise'] },
  { id: 'upper', name: 'Upper',      note: 'Full upper body',             exercises: ['bench', 'row', 'ohp', 'lat_pulldown', 'db_curl', 'skullcrusher'] },
  { id: 'lower', name: 'Lower',      note: 'Full lower body',             exercises: ['squat', 'rdl', 'lunge', 'leg_curl', 'calf_raise'] },
  { id: 'full',  name: 'Full Body',  note: 'Big lifts, all over',         exercises: ['squat', 'bench', 'row', 'ohp', 'hanging_leg'] },
];
