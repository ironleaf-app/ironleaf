// Health and Fitness (Wave 5, 24 Oct 2026; module 9 of the catalogue and their spec, 22 Oct: "Health data stays on this
// PC, encrypted, with the key protected by Windows, and is never sent to an AI provider unless the person asks for a
// specific answer (only the rows needed). Health tables live in their own database file. Body composition figures are
// labelled estimates, and nothing in the module is medical advice."). The records and every rule about them, pure: the
// encrypted file itself is src/main/health-store.ts.
//
// What it holds, all generic (nothing knows anyone's own topics): measures the person keeps (numbers, yes/no habits,
// 1-to-10 scores, words), one entry per measure per day; training plans and sessions with their exercises and sets; meals;
// appointments with their results; a profile (height, for the estimates); daily targets; the daily check-in's questions;
// and the log notes it was given, word for word, so one moved in can be put back exactly as it was.
//
// Pure: no files, no Node, no DOM (the window draws from these; the main side keeps them; agents get rows from them).

import { isoDay } from './days';
import { parseLog, readLogValue, type LogNote } from './layouts';

// ── The records ──────────────────────────────────────────────────────────────────────────────────────────────────────

export type MeasureKind = 'number' | 'yesno' | 'scale' | 'text';
export type MeasureGroup = 'checkin' | 'body' | 'sleep' | 'food' | 'habit' | 'other';

export interface Measure {
  id: string;
  name: string;
  kind: MeasureKind;
  group: MeasureGroup;
  unit?: string;
  /** A score's range (1 to 10 unless said). */
  min?: number;
  max?: number;
  /** A goal for the figure (a weight to reach), drawn as a line on its trend. */
  target?: number;
  /** Which way is better, for the words beside a change. */
  better?: 'up' | 'down';
  /** A daily amount to reach (water: 8 glasses), counted up through the day. */
  daily?: number;
  /** Asked in the daily check-in. */
  checkin?: boolean;
  /** Put away: kept with its entries, no longer asked or shown. */
  archived?: boolean;
  created: number;
}

export interface Entry {
  id: string;
  /** The day, YYYY-MM-DD. */
  day: string;
  measure: string;
  n?: number;
  yes?: boolean;
  /** The words as written ("104.2 kg after breakfast"), kept whole. */
  text?: string;
  note?: string;
  /** When it was written, and by whom ('you', or an assistant's name). */
  at: number;
  by?: string;
  /** The log note it came from (an import's id). */
  from?: string;
}

/** A day's free lines (a log's bullets without a field) and its label ("Day 1"). */
export interface DayNote {
  id: string;
  day: string;
  text: string;
  at: number;
  from?: string;
}

export type SetKind = 'warm-up' | 'working' | 'drop' | 'failure';
export interface WorkSet {
  reps?: number;
  /** kg. */
  weight?: number;
  seconds?: number;
  /** km. */
  distance?: number;
  /** Reps in reserve. */
  rir?: number;
  kind?: SetKind;
  done?: boolean;
}

export interface SessionExercise {
  name: string;
  /** The library's id, when it is one of them. */
  exercise?: string;
  sets: WorkSet[];
  note?: string;
}

export type SessionKind = 'strength' | 'cardio' | 'mobility' | 'sport' | 'other';
export const SESSION_KINDS: { id: SessionKind; label: string }[] = [
  { id: 'strength', label: 'Strength' },
  { id: 'cardio', label: 'Cardio' },
  { id: 'mobility', label: 'Mobility' },
  { id: 'sport', label: 'Sport' },
  { id: 'other', label: 'Other' },
];

export interface Session {
  id: string;
  day: string;
  title: string;
  kind: SessionKind;
  minutes?: number;
  /** How hard it felt, 1 to 10. */
  effort?: number;
  /** Pain before starting, 0 to 10 (no training through pain). */
  pain?: number;
  plan?: string;
  planDay?: string;
  exercises: SessionExercise[];
  notes?: string;
  at: number;
  by?: string;
}

export interface PlanExercise {
  name: string;
  exercise?: string;
  sets?: number;
  /** As the plan says it: "8-10", "5", "30 s". */
  reps?: string;
  /** Seconds of rest between sets. */
  rest?: number;
  note?: string;
}

export interface PlanDay {
  id: string;
  /** "Day A", "Monday". */
  label: string;
  title: string;
  /** The weekday it falls on (0 Sunday … 6 Saturday), or a rotation when none. */
  weekday?: number;
  exercises: PlanExercise[];
}

export interface Plan {
  id: string;
  name: string;
  /** How long it runs and from when (a programme), or open-ended. */
  weeks?: number;
  start?: string;
  days: PlanDay[];
  notes?: string;
  archived?: boolean;
  created: number;
}

export interface Exercise {
  id: string;
  name: string;
  muscles: string[];
  equipment?: string;
  pattern?: string;
  lowImpact?: boolean;
  custom?: boolean;
}

export type MealKind = 'breakfast' | 'lunch' | 'dinner' | 'snack';
export const MEAL_KINDS: { id: MealKind; label: string }[] = [
  { id: 'breakfast', label: 'Breakfast' },
  { id: 'lunch', label: 'Lunch' },
  { id: 'dinner', label: 'Dinner' },
  { id: 'snack', label: 'Snacks' },
];

export interface Meal {
  id: string;
  day: string;
  meal: MealKind;
  what: string;
  kcal?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  note?: string;
  at: number;
  by?: string;
}

export interface HealthResult {
  id: string;
  name: string;
  value: string;
  unit?: string;
  /** The range the result sheet gives ("3.5–5.5"). */
  range?: string;
  /** As the result sheet says it; never worked out here. */
  flag?: 'normal' | 'high' | 'low' | '';
  note?: string;
}

export type AppointmentStatus = 'booked' | 'done' | 'cancelled';
export interface Appointment {
  id: string;
  /** YYYY-MM-DD, and the time when known ("09:30"). */
  day: string;
  time?: string;
  /** Who it is with ("GP", "Dr Lee", "Physio"). */
  who: string;
  where?: string;
  why?: string;
  status: AppointmentStatus;
  /** Remind this many days before (0: on the day; null-ish: 1). */
  remind?: number;
  /** When the reminder was shown (so it shows once). */
  reminded?: number;
  notes?: string;
  results: HealthResult[];
  at: number;
  by?: string;
}

export interface Profile {
  /** cm. */
  height?: number;
  /** For the tape-measure body fat estimate only. */
  sex?: 'female' | 'male';
  born?: number;
}

export interface Targets {
  kcal?: number;
  protein?: number;
  sessionsPerWeek?: number;
  sleep?: number;
}

export interface CheckinConfig {
  /** From when in the day it is due ("08:00"). */
  time: string;
  /** The measures it asks, in order. */
  measures: string[];
}

/** A log note given to the store, word for word. */
export interface ImportRecord {
  id: string;
  path: string;
  title: string;
  text: string;
  at: number;
  entries: number;
  /** Moved in (the note went to the Bin) or copied (the note stays). */
  moved: boolean;
  /** Put back as a note since. */
  restored?: number;
}

export interface HealthDb {
  version: 1;
  created: number;
  profile: Profile;
  targets: Targets;
  checkin: CheckinConfig;
  measures: Measure[];
  entries: Entry[];
  notes: DayNote[];
  sessions: Session[];
  plans: Plan[];
  exercises: Exercise[];
  meals: Meal[];
  appointments: Appointment[];
  imports: ImportRecord[];
  /** Entries deleted in the last 30 days (8.0 U13), kept sealed here for the former host app's Recently deleted to put back. */
  binned?: BinnedEntry[];
}

export interface BinnedEntry {
  id: string;
  table: 'sessions' | 'plans' | 'exercises' | 'meals' | 'appointments' | 'notes';
  record: Record<string, unknown>;
  at: number;
}
export const BIN_TABLES = ['sessions', 'plans', 'exercises', 'meals', 'appointments', 'notes'] as const;
const BIN_DAYS_MS = 30 * 864e5;

// ── Starting out ─────────────────────────────────────────────────────────────────────────────────────────────────────

export function newId(): string {
  const bytes = new Uint8Array(9);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('');
}

const M = (id: string, name: string, kind: MeasureKind, group: MeasureGroup, more: Partial<Measure> = {}): Measure => ({ id, name, kind, group, created: 0, ...more });

/** The measures a new store starts with; every one is the person's to rename, change or put away. */
export const STARTING_MEASURES: Measure[] = [
  M('sleep', 'Sleep', 'number', 'sleep', { unit: 'h', checkin: true, better: 'up' }),
  M('sleep-quality', 'Sleep quality', 'scale', 'sleep', { min: 1, max: 5, checkin: true, better: 'up' }),
  M('energy', 'Energy', 'scale', 'checkin', { min: 1, max: 10, checkin: true, better: 'up' }),
  M('mood', 'Mood', 'scale', 'checkin', { min: 1, max: 10, checkin: true, better: 'up' }),
  M('water', 'Water', 'number', 'food', { unit: 'glasses', daily: 8, checkin: true, better: 'up' }),
  M('weight', 'Weight', 'number', 'body', { unit: 'kg' }),
  M('waist', 'Waist', 'number', 'body', { unit: 'cm' }),
  M('neck', 'Neck', 'number', 'body', { unit: 'cm' }),
  M('hips', 'Hips', 'number', 'body', { unit: 'cm' }),
  M('steps', 'Steps', 'number', 'other', { better: 'up' }),
];

// A small library to start from, written here (names, the muscles each works, what it needs); the person adds their own.
const X = (id: string, name: string, muscles: string[], equipment: string, pattern: string, lowImpact = false): Exercise => ({ id, name, muscles, equipment, pattern, ...(lowImpact ? { lowImpact } : {}) });
export const STARTING_EXERCISES: Exercise[] = [
  X('back-squat', 'Back squat', ['quads', 'glutes', 'core'], 'barbell', 'squat'),
  X('goblet-squat', 'Goblet squat', ['quads', 'glutes'], 'dumbbell', 'squat', true),
  X('leg-press', 'Leg press', ['quads', 'glutes'], 'machine', 'squat', true),
  X('split-squat', 'Split squat', ['quads', 'glutes'], 'bodyweight', 'lunge', true),
  X('walking-lunge', 'Walking lunge', ['quads', 'glutes'], 'dumbbell', 'lunge'),
  X('deadlift', 'Deadlift', ['hamstrings', 'glutes', 'back'], 'barbell', 'hinge'),
  X('romanian-deadlift', 'Romanian deadlift', ['hamstrings', 'glutes'], 'barbell', 'hinge'),
  X('hip-thrust', 'Hip thrust', ['glutes', 'hamstrings'], 'barbell', 'hinge', true),
  X('glute-bridge', 'Glute bridge', ['glutes'], 'bodyweight', 'hinge', true),
  X('kettlebell-swing', 'Kettlebell swing', ['glutes', 'hamstrings'], 'kettlebell', 'hinge'),
  X('bench-press', 'Bench press', ['chest', 'triceps', 'shoulders'], 'barbell', 'push'),
  X('db-bench-press', 'Dumbbell bench press', ['chest', 'triceps'], 'dumbbell', 'push'),
  X('incline-db-press', 'Incline dumbbell press', ['chest', 'shoulders'], 'dumbbell', 'push'),
  X('push-up', 'Push-up', ['chest', 'triceps', 'core'], 'bodyweight', 'push', true),
  X('overhead-press', 'Overhead press', ['shoulders', 'triceps'], 'barbell', 'push'),
  X('db-shoulder-press', 'Dumbbell shoulder press', ['shoulders', 'triceps'], 'dumbbell', 'push'),
  X('lateral-raise', 'Lateral raise', ['shoulders'], 'dumbbell', 'isolation', true),
  X('dip', 'Dip', ['chest', 'triceps'], 'bodyweight', 'push'),
  X('pull-up', 'Pull-up', ['back', 'biceps'], 'bodyweight', 'pull'),
  X('lat-pulldown', 'Lat pulldown', ['back', 'biceps'], 'machine', 'pull', true),
  X('barbell-row', 'Barbell row', ['back', 'biceps'], 'barbell', 'pull'),
  X('db-row', 'One-arm dumbbell row', ['back', 'biceps'], 'dumbbell', 'pull', true),
  X('seated-cable-row', 'Seated cable row', ['back', 'biceps'], 'cable', 'pull', true),
  X('face-pull', 'Face pull', ['shoulders', 'back'], 'cable', 'pull', true),
  X('bicep-curl', 'Biceps curl', ['biceps'], 'dumbbell', 'isolation', true),
  X('tricep-pushdown', 'Triceps pushdown', ['triceps'], 'cable', 'isolation', true),
  X('leg-curl', 'Leg curl', ['hamstrings'], 'machine', 'isolation', true),
  X('leg-extension', 'Leg extension', ['quads'], 'machine', 'isolation', true),
  X('calf-raise', 'Calf raise', ['calves'], 'bodyweight', 'isolation', true),
  X('plank', 'Plank', ['core'], 'bodyweight', 'core', true),
  X('side-plank', 'Side plank', ['core'], 'bodyweight', 'core', true),
  X('dead-bug', 'Dead bug', ['core'], 'bodyweight', 'core', true),
  X('farmers-carry', 'Farmer’s carry', ['grip', 'core', 'back'], 'dumbbell', 'carry'),
  X('walk', 'Walk', ['legs'], 'none', 'cardio', true),
  X('run', 'Run', ['legs'], 'none', 'cardio'),
  X('cycle', 'Cycle', ['legs'], 'bike', 'cardio', true),
  X('row-erg', 'Rowing machine', ['back', 'legs'], 'rower', 'cardio', true),
  X('swim', 'Swim', ['full body'], 'pool', 'cardio', true),
  X('stretch', 'Stretching', ['full body'], 'none', 'mobility', true),
];

export const MUSCLES = ['chest', 'back', 'shoulders', 'biceps', 'triceps', 'core', 'quads', 'hamstrings', 'glutes', 'calves', 'legs', 'grip', 'full body'];

export function emptyDb(now = Date.now()): HealthDb {
  return {
    version: 1,
    created: now,
    profile: {},
    targets: { sessionsPerWeek: 3, sleep: 8 },
    checkin: { time: '07:00', measures: STARTING_MEASURES.filter((m) => m.checkin).map((m) => m.id) },
    measures: STARTING_MEASURES.map((m) => ({ ...m, created: now })),
    entries: [],
    notes: [],
    sessions: [],
    plans: [],
    exercises: STARTING_EXERCISES.map((e) => ({ ...e, muscles: [...e.muscles] })),
    meals: [],
    appointments: [],
    imports: [],
  };
}

// ── Reading a store leniently ────────────────────────────────────────────────────────────────────────────────────────

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const s = (v: unknown, max = 400): string | undefined => (typeof v === 'string' && v.trim() ? v.replace(/[\u0000-\u0008\u000b-\u001f]/g, '').trim().slice(0, max) : undefined);
const n = (v: unknown, min = -1e15, max = 1e15): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : undefined);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const id = (v: unknown): string => (typeof v === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(v) ? v : newId());
const day = (v: unknown): string | undefined => (typeof v === 'string' && DAY.test(v) ? v : undefined);
function drop<T extends object>(o: T): T {
  for (const k of Object.keys(o) as (keyof T)[]) if (o[k] === undefined) delete o[k];
  return o;
}

const KINDS: MeasureKind[] = ['number', 'yesno', 'scale', 'text'];
const GROUPS: MeasureGroup[] = ['checkin', 'body', 'sleep', 'food', 'habit', 'other'];

function cleanMeasure(v: unknown): Measure | null {
  const o = obj(v);
  const name = s(o.name, 60);
  if (!name) return null;
  const kind = KINDS.includes(o.kind as MeasureKind) ? (o.kind as MeasureKind) : 'number';
  return drop({
    id: id(o.id),
    name,
    kind,
    group: GROUPS.includes(o.group as MeasureGroup) ? (o.group as MeasureGroup) : 'other',
    unit: s(o.unit, 20),
    min: kind === 'scale' ? (n(o.min, 0, 100) ?? 1) : undefined,
    max: kind === 'scale' ? (n(o.max, 1, 100) ?? 10) : undefined,
    target: n(o.target),
    better: o.better === 'up' || o.better === 'down' ? (o.better as 'up' | 'down') : undefined,
    daily: n(o.daily, 0, 1e6),
    checkin: o.checkin === true ? true : undefined,
    archived: o.archived === true ? true : undefined,
    created: n(o.created, 0) ?? 0,
  });
}

function cleanSet(v: unknown): WorkSet {
  const o = obj(v);
  return drop({
    reps: n(o.reps, 0, 10000),
    weight: n(o.weight, 0, 10000),
    seconds: n(o.seconds, 0, 86400),
    distance: n(o.distance, 0, 10000),
    rir: n(o.rir, 0, 20),
    kind: (['warm-up', 'working', 'drop', 'failure'] as SetKind[]).includes(o.kind as SetKind) ? (o.kind as SetKind) : undefined,
    done: o.done === true ? true : undefined,
  });
}

/** A store's contents as read from its file: anything it doesn't understand is left out, never an error. */
export function cleanDb(raw: unknown): HealthDb {
  const o = obj(raw);
  const base = emptyDb(n(o.created, 0) ?? Date.now());
  if (o.version !== 1) return base;
  const profile = obj(o.profile);
  const targets = obj(o.targets);
  const checkin = obj(o.checkin);
  const measures = arr(o.measures).map(cleanMeasure).filter((m): m is Measure => !!m);
  const ids = new Set(measures.map((m) => m.id));
  const db: HealthDb = {
    version: 1,
    created: base.created,
    profile: drop({ height: n(profile.height, 50, 260), sex: profile.sex === 'female' || profile.sex === 'male' ? profile.sex : undefined, born: n(profile.born, 1900, 2100) }),
    targets: drop({ kcal: n(targets.kcal, 0, 20000), protein: n(targets.protein, 0, 2000), sessionsPerWeek: n(targets.sessionsPerWeek, 0, 21), sleep: n(targets.sleep, 0, 24) }),
    checkin: { time: typeof checkin.time === 'string' && TIME.test(checkin.time) ? checkin.time : base.checkin.time, measures: arr(checkin.measures).filter((x): x is string => typeof x === 'string' && ids.has(x)) },
    measures,
    entries: arr(o.entries)
      .map((v) => {
        const e = obj(v);
        const d = day(e.day);
        const m = typeof e.measure === 'string' && ids.has(e.measure) ? e.measure : undefined;
        if (!d || !m) return null;
        return drop({ id: id(e.id), day: d, measure: m, n: n(e.n), yes: typeof e.yes === 'boolean' ? e.yes : undefined, text: s(e.text, 600), note: s(e.note, 600), at: n(e.at, 0) ?? 0, by: s(e.by, 80), from: s(e.from, 40) }) as Entry;
      })
      .filter((e): e is Entry => !!e),
    notes: arr(o.notes)
      .map((v) => {
        const x = obj(v);
        const d = day(x.day);
        const text = s(x.text, 2000);
        return d && text ? (drop({ id: id(x.id), day: d, text, at: n(x.at, 0) ?? 0, from: s(x.from, 40) }) as DayNote) : null;
      })
      .filter((x): x is DayNote => !!x),
    sessions: arr(o.sessions)
      .map((v) => {
        const x = obj(v);
        const d = day(x.day);
        if (!d) return null;
        return drop({
          id: id(x.id),
          day: d,
          title: s(x.title, 120) ?? 'Session',
          kind: SESSION_KINDS.some((k) => k.id === x.kind) ? (x.kind as SessionKind) : 'other',
          minutes: n(x.minutes, 0, 1440),
          effort: n(x.effort, 1, 10),
          pain: n(x.pain, 0, 10),
          plan: s(x.plan, 40),
          planDay: s(x.planDay, 40),
          exercises: arr(x.exercises)
            .map((ev) => {
              const e = obj(ev);
              const name = s(e.name, 100);
              return name ? (drop({ name, exercise: s(e.exercise, 60), sets: arr(e.sets).slice(0, 100).map(cleanSet), note: s(e.note, 400) }) as SessionExercise) : null;
            })
            .filter((e): e is SessionExercise => !!e),
          notes: s(x.notes, 4000),
          at: n(x.at, 0) ?? 0,
          by: s(x.by, 80),
        }) as Session;
      })
      .filter((x): x is Session => !!x),
    plans: arr(o.plans)
      .map((v) => {
        const x = obj(v);
        const name = s(x.name, 120);
        if (!name) return null;
        return drop({
          id: id(x.id),
          name,
          weeks: n(x.weeks, 1, 104),
          start: day(x.start),
          days: arr(x.days)
            .map((dv) => {
              const d = obj(dv);
              return drop({
                id: id(d.id),
                label: s(d.label, 40) ?? 'Day',
                title: s(d.title, 120) ?? '',
                weekday: n(d.weekday, 0, 6),
                exercises: arr(d.exercises)
                  .map((ev) => {
                    const e = obj(ev);
                    const nm = s(e.name, 100);
                    return nm ? (drop({ name: nm, exercise: s(e.exercise, 60), sets: n(e.sets, 0, 50), reps: s(e.reps, 30), rest: n(e.rest, 0, 3600), note: s(e.note, 300) }) as PlanExercise) : null;
                  })
                  .filter((e): e is PlanExercise => !!e),
              }) as PlanDay;
            })
            .slice(0, 14),
          notes: s(x.notes, 4000),
          archived: x.archived === true ? true : undefined,
          created: n(x.created, 0) ?? 0,
        }) as Plan;
      })
      .filter((x): x is Plan => !!x),
    exercises: (() => {
      const list = arr(o.exercises)
        .map((v) => {
          const x = obj(v);
          const name = s(x.name, 100);
          return name ? (drop({ id: id(x.id), name, muscles: arr(x.muscles).filter((m): m is string => typeof m === 'string').slice(0, 8), equipment: s(x.equipment, 40), pattern: s(x.pattern, 40), lowImpact: x.lowImpact === true ? true : undefined, custom: x.custom === true ? true : undefined }) as Exercise) : null;
        })
        .filter((x): x is Exercise => !!x);
      return list.length ? list : base.exercises;
    })(),
    meals: arr(o.meals)
      .map((v) => {
        const x = obj(v);
        const d = day(x.day);
        const what = s(x.what, 300);
        if (!d || !what) return null;
        return drop({ id: id(x.id), day: d, meal: MEAL_KINDS.some((k) => k.id === x.meal) ? (x.meal as MealKind) : 'snack', what, kcal: n(x.kcal, 0, 20000), protein: n(x.protein, 0, 2000), carbs: n(x.carbs, 0, 2000), fat: n(x.fat, 0, 2000), note: s(x.note, 400), at: n(x.at, 0) ?? 0, by: s(x.by, 80) }) as Meal;
      })
      .filter((x): x is Meal => !!x),
    appointments: arr(o.appointments)
      .map((v) => {
        const x = obj(v);
        const d = day(x.day);
        const who = s(x.who, 120);
        if (!d || !who) return null;
        return drop({
          id: id(x.id),
          day: d,
          time: typeof x.time === 'string' && TIME.test(x.time) ? x.time : undefined,
          who,
          where: s(x.where, 200),
          why: s(x.why, 300),
          status: (['booked', 'done', 'cancelled'] as AppointmentStatus[]).includes(x.status as AppointmentStatus) ? (x.status as AppointmentStatus) : 'booked',
          remind: n(x.remind, 0, 60),
          reminded: n(x.reminded, 0),
          notes: s(x.notes, 4000),
          results: arr(x.results)
            .map((rv) => {
              const r = obj(rv);
              const name = s(r.name, 120);
              const value = s(r.value, 120);
              return name && value ? (drop({ id: id(r.id), name, value, unit: s(r.unit, 30), range: s(r.range, 60), flag: r.flag === 'normal' || r.flag === 'high' || r.flag === 'low' ? r.flag : undefined, note: s(r.note, 400) }) as HealthResult) : null;
            })
            .filter((r): r is HealthResult => !!r),
          at: n(x.at, 0) ?? 0,
          by: s(x.by, 80),
        }) as Appointment;
      })
      .filter((x): x is Appointment => !!x),
    imports: arr(o.imports)
      .map((v) => {
        const x = obj(v);
        const path = s(x.path, 600);
        if (!path || typeof x.text !== 'string') return null;
        return drop({ id: id(x.id), path, title: s(x.title, 200) ?? path, text: x.text.slice(0, 2_000_000), at: n(x.at, 0) ?? 0, entries: n(x.entries, 0) ?? 0, moved: x.moved === true, restored: n(x.restored, 0) }) as ImportRecord;
      })
      .filter((x): x is ImportRecord => !!x),
  };
  // What was deleted in the last 30 days (8.0 U13); older is let go here, as Recently deleted lets it go.
  const binned = arr(o.binned)
    .map((v) => {
      const x = obj(v);
      const at = n(x.at, 0) ?? 0;
      const table = BIN_TABLES.find((t) => t === x.table);
      return table && typeof x.id === 'string' && x.record && typeof x.record === 'object' && Date.now() - at < BIN_DAYS_MS ? ({ id: x.id, table, record: x.record as Record<string, unknown>, at } as BinnedEntry) : null;
    })
    .filter((x): x is BinnedEntry => !!x);
  if (binned.length) db.binned = binned;
  return db;
}

// ── Days ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

const pad = (x: number) => String(x).padStart(2, '0');
export const todayIso = (now: Date = new Date()) => isoDay(now);
export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(y, m - 1, d + days);
  return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
}
export function daysBetween(a: string, b: string): number {
  const [y1, m1, d1] = a.split('-').map(Number);
  const [y2, m2, d2] = b.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}
export const weekdayOf = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).getDay();
};
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const weekdayName = (i: number) => WEEKDAYS[((i % 7) + 7) % 7];
/** "Sat 24 Oct" (and the year when it isn't this one). As written when the day cannot be read (8.7.1, 31 Oct 2026,
 *  pages that "couldn't show"): never a crash, never "undefined NaN undefined". */
export function dayWords(iso: string, today = todayIso()): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso.trim());
  if (!m) return iso.trim();
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  const dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return iso.trim();
  const w = WEEKDAYS[dt.getDay()].slice(0, 3);
  return `${w} ${d} ${MONTHS[mo - 1]}${String(y) !== today.slice(0, 4) ? ` ${y}` : ''}`;
}
/** "today", "tomorrow", "yesterday", "in 3 days", "4 days ago", else the day. */
export function whenWords(iso: string, today = todayIso()): string {
  const k = daysBetween(today, iso);
  if (k === 0) return 'today';
  if (k === 1) return 'tomorrow';
  if (k === -1) return 'yesterday';
  if (k > 1 && k < 7) return `in ${k} days`;
  if (k < -1 && k > -7) return `${-k} days ago`;
  return dayWords(iso, today);
}
/** "9:30 am" from "09:30". */
export function timeWords(t?: string): string {
  if (!t || !TIME.test(t)) return '';
  const [h, m] = t.split(':').map(Number);
  return `${h % 12 || 12}:${pad(m)} ${h < 12 ? 'am' : 'pm'}`;
}

// ── Measures and their entries ───────────────────────────────────────────────────────────────────────────────────────

export const measureOf = (db: HealthDb, idOrName: string): Measure | undefined => {
  const want = idOrName.trim().toLowerCase();
  const byId = db.measures.find((m) => m.id === idOrName);
  if (byId) return byId;
  const exact = db.measures.find((m) => m.name.toLowerCase() === want);
  if (exact) return exact;
  // "Weight (kg)" is "Weight" when the units agree (or one side says none); "Weight (lb)" against kilograms is
  // another measure, never merged.
  const base = (n: string) => n.toLowerCase().replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
  const paren = (n: string) => /\(([^)]*)\)/.exec(n)?.[1].trim().toLowerCase() ?? '';
  const wBase = base(idOrName);
  const wUnit = paren(idOrName);
  const clash = (m: Measure) => {
    const known = [paren(m.name), (m.unit ?? '').toLowerCase()].filter(Boolean);
    return !!wUnit && known.length > 0 && !known.includes(wUnit);
  };
  const singular = (n: string) => n.replace(/s$/, '');
  return db.measures.find((m) => base(m.name) === wBase && !clash(m)) ?? db.measures.find((m) => singular(base(m.name)) === singular(wBase) && !clash(m));
};

/** A value as people write it, read for a measure: a yes/no, a number (its unit taken off), a score, or words. */
export function readValue(m: Measure, raw: unknown): Pick<Entry, 'n' | 'yes' | 'text'> | null {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw === 'boolean') return m.kind === 'yesno' ? { yes: raw } : null;
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) return null;
    if (m.kind === 'yesno') return { yes: raw > 0 };
    return m.kind === 'text' ? { text: String(raw) } : { n: m.kind === 'scale' ? Math.min(m.max ?? 10, Math.max(m.min ?? 1, raw)) : raw };
  }
  const t = String(raw).trim().slice(0, 600);
  if (!t) return null;
  const v = readLogValue(t, true);
  if (m.kind === 'yesno') return v.kind === 'yes' ? { yes: v.yes, ...(v.text.length > 3 ? { text: t } : {}) } : null;
  if (m.kind === 'text') return { text: t };
  if (v.kind !== 'number') return null;
  const plain = /^-?\d+(?:[.,]\d+)?\s*(?:\/\s*\d+)?\s*[a-z%]{0,12}\.?$/i.test(t);
  const value = m.kind === 'scale' ? Math.min(m.max ?? 10, Math.max(m.min ?? 1, v.n)) : v.n;
  return { n: value, ...(plain ? {} : { text: t }) };
}

/** An entry's value in words ("104.2 kg", "Yes", "7/10"). */
export function valueWords(m: Measure | undefined, e: Pick<Entry, 'n' | 'yes' | 'text'>): string {
  if (!m) return e.text ?? (e.n !== undefined ? String(e.n) : e.yes !== undefined ? (e.yes ? 'Yes' : 'No') : '');
  if (m.kind === 'yesno') return e.yes === undefined ? (e.text ?? '') : e.yes ? 'Yes' : 'No';
  if (m.kind === 'text') return e.text ?? '';
  if (e.n === undefined) return e.text ?? '';
  const num = Number.isInteger(e.n) ? String(e.n) : String(Math.round(e.n * 100) / 100);
  if (m.kind === 'scale') return `${num}/${m.max ?? 10}`;
  return m.unit ? `${num} ${m.unit}` : num;
}

export const entryOn = (db: HealthDb, measure: string, iso: string): Entry | undefined => db.entries.find((e) => e.measure === measure && e.day === iso);

/** The store with a measure's value set for a day (one entry per measure per day; empty takes it away). */
export function setEntry(db: HealthDb, measure: string, iso: string, value: Pick<Entry, 'n' | 'yes' | 'text'> | null, o: { note?: string; by?: string; now?: number; from?: string } = {}): HealthDb {
  const had = entryOn(db, measure, iso);
  const rest = db.entries.filter((e) => e !== had);
  if (!value) return { ...db, entries: rest };
  const e: Entry = drop({ id: had?.id ?? newId(), day: iso, measure, ...value, note: o.note ?? had?.note, at: o.now ?? Date.now(), by: o.by, from: o.from ?? had?.from });
  return { ...db, entries: [...rest, e] };
}

/** One measure's figures by day, oldest first (between two days when given). */
export function seriesOf(db: HealthDb, measure: string, from?: string, to?: string): { day: string; n: number }[] {
  return db.entries
    .filter((e) => e.measure === measure && e.n !== undefined && (!from || e.day >= from) && (!to || e.day <= to))
    .sort((a, b) => a.day.localeCompare(b.day))
    .map((e) => ({ day: e.day, n: e.n! }));
}

export interface TrendSummary {
  count: number;
  latest?: { day: string; n: number };
  first?: { day: string; n: number };
  change?: number;
  min?: number;
  max?: number;
  average?: number;
  /** The average of the last 7 days that have a figure. */
  recent?: number;
  /** Per week, from a straight line through the figures (needs 3 days or more over a week). */
  perWeek?: number;
  /** Whether the change is the better way for this measure. */
  good?: boolean;
}

export function summarise(points: { day: string; n: number }[], better?: 'up' | 'down'): TrendSummary {
  if (!points.length) return { count: 0 };
  const ns = points.map((p) => p.n);
  const first = points[0];
  const latest = points[points.length - 1];
  const sum = ns.reduce((a, b) => a + b, 0);
  const last7 = points.filter((p) => daysBetween(p.day, latest.day) < 7).map((p) => p.n);
  let perWeek: number | undefined;
  const span = daysBetween(first.day, latest.day);
  if (points.length >= 3 && span >= 6) {
    const xs = points.map((p) => daysBetween(first.day, p.day));
    const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
    const my = sum / ns.length;
    let num = 0;
    let den = 0;
    xs.forEach((x, i) => {
      num += (x - mx) * (ns[i] - my);
      den += (x - mx) ** 2;
    });
    if (den > 0) perWeek = round((num / den) * 7, 2);
  }
  const change = round(latest.n - first.n, 2);
  return {
    count: points.length,
    latest,
    first,
    change,
    min: Math.min(...ns),
    max: Math.max(...ns),
    average: round(sum / ns.length, 2),
    recent: round(last7.reduce((a, b) => a + b, 0) / last7.length, 2),
    ...(perWeek !== undefined ? { perWeek } : {}),
    ...(better && change !== 0 ? { good: better === 'up' ? change > 0 : change < 0 } : {}),
  };
}
export const round = (x: number, places = 1) => Math.round(x * 10 ** places) / 10 ** places;

// ── Streaks: any yes/no, the check-in, a reward tracker's days ───────────────────────────────────────────────────────

export interface Streak {
  /** Days in a row up to today (today not answered yet doesn't break it: the run up to yesterday counts). */
  current: number;
  best: number;
  /** Whether today is answered yes. */
  today: boolean | null;
  /** The last 14 days, oldest first: true yes, false no, null not answered. */
  days: { day: string; yes: boolean | null }[];
  /** The next milestone ahead and the days to it. */
  next?: { at: number; left: number };
  /** Milestones reached in the current run. */
  reached: number[];
}

/** A run of yes days from answers by day (a day answered no breaks it; a day not answered breaks it unless it is today). */
export function streakOf(answers: Map<string, boolean>, today: string, milestones: number[] = [7, 14, 30, 60, 90]): Streak {
  const todayYes = answers.has(today) ? answers.get(today)! : null;
  let current = 0;
  let d = todayYes === true ? today : addDays(today, -1);
  if (todayYes === false) current = 0;
  else
    while (answers.get(d) === true) {
      current++;
      d = addDays(d, -1);
    }
  let best = 0;
  let run = 0;
  let prev: string | null = null;
  for (const k of [...answers.keys()].sort()) {
    if (answers.get(k) !== true) {
      run = 0;
      prev = k;
      continue;
    }
    run = prev && daysBetween(prev, k) === 1 && answers.get(prev) === true ? run + 1 : 1;
    best = Math.max(best, run);
    prev = k;
  }
  best = Math.max(best, current);
  const days = Array.from({ length: 14 }, (_, i) => {
    const k = addDays(today, i - 13);
    return { day: k, yes: answers.has(k) ? answers.get(k)! : null };
  });
  const sorted = [...new Set(milestones.filter((x) => Number.isFinite(x) && x > 0))].sort((a, b) => a - b);
  const ahead = sorted.find((x) => x > current);
  return { current, best, today: todayYes, days, ...(ahead ? { next: { at: ahead, left: ahead - current } } : {}), reached: sorted.filter((x) => x <= current) };
}

/** A yes/no measure's streak. */
export function measureStreak(db: HealthDb, measure: string, today = todayIso(), milestones?: number[]): Streak {
  const answers = new Map<string, boolean>();
  for (const e of db.entries) if (e.measure === measure && e.yes !== undefined) answers.set(e.day, e.yes);
  return streakOf(answers, today, milestones);
}

/** A completed check-in has an answer for each active question on that day. */
function completedCheckins(db: HealthDb): Map<string, boolean> {
  const asked = new Set(db.measures.filter(m => !m.archived && db.checkin.measures.includes(m.id)).map(m => m.id));
  const answers = new Map<string, Set<string>>();
  for (const e of db.entries) {
    if (!asked.has(e.measure)) continue;
    const day = answers.get(e.day) ?? new Set<string>();
    day.add(e.measure);
    answers.set(e.day, day);
  }
  return new Map([...answers].filter(([, measures]) => measures.size === asked.size).map(([day]) => [day, true]));
}

export function checkinStreak(db: HealthDb, today = todayIso()): Streak {
  return streakOf(completedCheckins(db), today);
}

// ── The daily check-in ───────────────────────────────────────────────────────────────────────────────────────────────

export interface CheckinState {
  /** The measures it asks (in use, not put away). */
  measures: Measure[];
  /** Answered today, by measure id. */
  answered: Record<string, Entry>;
  done: boolean;
  /** Due now: not done, and past its time. */
  due: boolean;
  streak: Streak;
}

export function checkinState(db: HealthDb, now: Date = new Date()): CheckinState {
  const today = todayIso(now);
  const measures = db.checkin.measures.map((m) => db.measures.find((x) => x.id === m)).filter((m): m is Measure => !!m && !m.archived);
  const answered: Record<string, Entry> = {};
  for (const m of measures) {
    const e = entryOn(db, m.id, today);
    if (e) answered[m.id] = e;
  }
  const done = measures.length > 0 && measures.every((m) => answered[m.id]);
  const hhmm = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  return { measures, answered, done, due: measures.length > 0 && !done && hhmm >= db.checkin.time, streak: checkinStreak(db, today) };
}

// ── Training ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The week (Monday to Sunday) a day falls in: its Monday. */
export function weekStart(iso: string): string {
  const w = weekdayOf(iso);
  return addDays(iso, -((w + 6) % 7));
}

/** The week's training in one line (8.5 uplift, 30 Oct 2026): sessions done against the aim the person set, and the
 *  days a check-in was answered. Counts only; no figures, no medical words. */
export function weekSessionSummary(db: HealthDb, iso: string): { done: number; target: number | null; checkinDays: number; start: string } {
  const done = sessionsInWeek(db, iso).length;
  const from = weekStart(iso);
  const checkinDays = [...completedCheckins(db).keys()].filter(day => day >= from && day <= addDays(from, 6)).length;
  return { done, target: db.targets.sessionsPerWeek || null, checkinDays, start: from };
}

export function sessionsInWeek(db: HealthDb, iso: string): Session[] {
  const from = weekStart(iso);
  const to = addDays(from, 6);
  return db.sessions.filter((x) => x.day >= from && x.day <= to);
}

/** A plan's day for a given day: the one on that weekday, else the next in its rotation after the last session done
 *  from the plan. */
export function planDayFor(db: HealthDb, plan: Plan, iso: string): PlanDay | undefined {
  if (!plan.days.length) return undefined;
  const w = weekdayOf(iso);
  const byWeekday = plan.days.filter((d) => d.weekday !== undefined);
  if (byWeekday.length) return byWeekday.find((d) => d.weekday === w);
  const last = db.sessions.filter((x) => x.plan === plan.id && x.planDay && x.day <= iso).sort((a, b) => b.day.localeCompare(a.day) || b.at - a.at)[0];
  if (!last) return plan.days[0];
  if (last.day === iso) return plan.days.find((d) => d.id === last.planDay);
  const i = plan.days.findIndex((d) => d.id === last.planDay);
  return plan.days[(i + 1) % plan.days.length];
}

/** "Week 3 of 8" for a programme with a start and a length. */
export function planWeek(plan: Plan, iso: string): { week: number; of: number } | null {
  if (!plan.start || !plan.weeks) return null;
  const k = daysBetween(plan.start, iso);
  if (k < 0) return { week: 0, of: plan.weeks };
  return { week: Math.min(plan.weeks, Math.floor(k / 7) + 1), of: plan.weeks };
}

/** An estimate of the most someone could lift once (Epley's formula), from a weight and reps. Labelled an estimate. */
export const oneRepMax = (weight: number, reps: number) => (reps <= 1 ? weight : round(weight * (1 + reps / 30), 1));

export interface PersonalBest {
  exercise: string;
  /** The heaviest set (and its reps). */
  weight: number;
  reps: number;
  day: string;
  /** The estimate from the best set (Epley). */
  estimate: number;
  /** Most reps without weight (a push-up), when no weight was ever used. */
  bodyweightReps?: number;
}

export function personalBests(db: HealthDb): PersonalBest[] {
  const out = new Map<string, PersonalBest>();
  for (const x of db.sessions)
    for (const e of x.exercises)
      for (const set of e.sets) {
        if (set.kind === 'warm-up') continue;
        const key = e.name.toLowerCase();
        const had = out.get(key);
        if (set.weight && set.reps) {
          const est = oneRepMax(set.weight, set.reps);
          if (!had || est > had.estimate) out.set(key, { exercise: e.name, weight: set.weight, reps: set.reps, day: x.day, estimate: est });
        } else if (set.reps && (!had || (!had.weight && set.reps > (had.bodyweightReps ?? 0)))) out.set(key, { exercise: e.name, weight: 0, reps: set.reps, day: x.day, estimate: 0, bodyweightReps: set.reps });
      }
  return [...out.values()].sort((a, b) => b.day.localeCompare(a.day));
}

/** What was done the last time an exercise came up (for the logger's "last time"). */
export function lastTime(db: HealthDb, exercise: string, before?: string): { day: string; sets: WorkSet[] } | null {
  const want = exercise.toLowerCase();
  const x = db.sessions
    .filter((s2) => (!before || s2.day < before) && s2.exercises.some((e) => e.name.toLowerCase() === want))
    .sort((a, b) => b.day.localeCompare(a.day) || b.at - a.at)[0];
  if (!x) return null;
  return { day: x.day, sets: x.exercises.find((e) => e.name.toLowerCase() === want)!.sets };
}

/** Sets done per muscle in a week (each set counts for every muscle the exercise works). */
export function volumeByMuscle(db: HealthDb, iso: string): { muscle: string; sets: number }[] {
  const counts = new Map<string, number>();
  for (const x of sessionsInWeek(db, iso))
    for (const e of x.exercises) {
      const lib = db.exercises.find((l) => l.id === e.exercise) ?? db.exercises.find((l) => l.name.toLowerCase() === e.name.toLowerCase());
      const sets = e.sets.filter((st) => st.kind !== 'warm-up').length;
      for (const m of lib?.muscles ?? []) counts.set(m, (counts.get(m) ?? 0) + sets);
    }
  return [...counts].map(([muscle, sets]) => ({ muscle, sets })).sort((a, b) => b.sets - a.sets);
}

/** A session's line: "4 exercises · 14 sets · 52 min". */
export function sessionLine(x: Session): string {
  const sets = x.exercises.reduce((a, e) => a + e.sets.filter((st) => st.kind !== 'warm-up').length, 0);
  return [x.exercises.length ? `${x.exercises.length} exercise${x.exercises.length === 1 ? '' : 's'}` : '', sets ? `${sets} set${sets === 1 ? '' : 's'}` : '', x.minutes ? `${x.minutes} min` : '', x.effort ? `effort ${x.effort}/10` : ''].filter(Boolean).join(' · ');
}

/** A set in words: "60 kg × 8", "45 s", "5 km". */
export function setWords(st: WorkSet): string {
  const parts: string[] = [];
  if (st.weight) parts.push(`${st.weight} kg`);
  if (st.reps) parts.push(st.weight ? `× ${st.reps}` : `${st.reps} reps`);
  if (st.seconds) parts.push(st.seconds >= 60 ? `${Math.floor(st.seconds / 60)}:${pad(st.seconds % 60)}` : `${st.seconds} s`);
  if (st.distance) parts.push(`${st.distance} km`);
  if (st.rir !== undefined) parts.push(`${st.rir} in reserve`);
  return parts.join(' ') || '—';
}

// ── Food and water ───────────────────────────────────────────────────────────────────────────────────────────────────

export interface DayFood {
  meals: Meal[];
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  /** Meals without a figure (the totals leave them out, and say so). */
  unknown: number;
}

export function foodOn(db: HealthDb, iso: string): DayFood {
  const meals = db.meals.filter((m) => m.day === iso).sort((a, b) => MEAL_KINDS.findIndex((k) => k.id === a.meal) - MEAL_KINDS.findIndex((k) => k.id === b.meal) || a.at - b.at);
  const sum = (k: 'kcal' | 'protein' | 'carbs' | 'fat') => round(meals.reduce((a, m) => a + (m[k] ?? 0), 0), 1);
  return { meals, kcal: sum('kcal'), protein: sum('protein'), carbs: sum('carbs'), fat: sum('fat'), unknown: meals.filter((m) => m.kcal === undefined).length };
}

// ── Body: the estimates (each says its method and what it used; none is medical advice) ──────────────────────────────

export interface Estimate {
  id: 'bmi' | 'waist-height' | 'body-fat-navy' | 'lean-mass' | 'ffmi';
  label: string;
  value: number;
  unit: string;
  method: string;
  inputs: string[];
}

export const ESTIMATE_WORDS = 'Estimates from formulas, not measurements: a guide to your own trend, not medical advice.';

/** The body estimates the latest figures allow (each with its method and inputs), labelled estimates. */
export function bodyEstimates(db: HealthDb): { estimates: Estimate[]; missing: string[] } {
  const latest = (mid: string) => {
    const pts = seriesOf(db, mid);
    return pts.length ? pts[pts.length - 1] : undefined;
  };
  const h = db.profile.height;
  const w = latest('weight');
  const waist = latest('waist');
  const neck = latest('neck');
  const hips = latest('hips');
  const out: Estimate[] = [];
  const missing: string[] = [];
  const at = (p?: { day: string; n: number }, unit = '') => (p ? `${p.n}${unit} (${dayWords(p.day)})` : '');
  if (h && w) out.push({ id: 'bmi', label: 'Body mass index', value: round(w.n / (h / 100) ** 2, 1), unit: '', method: 'Weight in kg divided by height in metres squared.', inputs: [`Weight ${at(w, ' kg')}`, `Height ${h} cm`] });
  else missing.push(h ? 'a weight' : 'your height (in Body › Profile)');
  if (h && waist) out.push({ id: 'waist-height', label: 'Waist to height', value: round(waist.n / h, 2), unit: '', method: 'Waist divided by height, both in cm.', inputs: [`Waist ${at(waist, ' cm')}`, `Height ${h} cm`] });
  let bf: number | undefined;
  const sex = db.profile.sex;
  if (h && waist && neck && sex === 'male' && waist.n > neck.n) {
    bf = 495 / (1.0324 - 0.19077 * Math.log10(waist.n - neck.n) + 0.15456 * Math.log10(h)) - 450;
    out.push({ id: 'body-fat-navy', label: 'Body fat', value: round(bf, 1), unit: '%', method: 'US Navy tape method (waist, neck and height).', inputs: [`Waist ${at(waist, ' cm')}`, `Neck ${at(neck, ' cm')}`, `Height ${h} cm`] });
  } else if (h && waist && neck && hips && sex === 'female' && waist.n + hips.n > neck.n) {
    bf = 495 / (1.29579 - 0.35004 * Math.log10(waist.n + hips.n - neck.n) + 0.221 * Math.log10(h)) - 450;
    out.push({ id: 'body-fat-navy', label: 'Body fat', value: round(bf, 1), unit: '%', method: 'US Navy tape method (waist, hips, neck and height).', inputs: [`Waist ${at(waist, ' cm')}`, `Hips ${at(hips, ' cm')}`, `Neck ${at(neck, ' cm')}`, `Height ${h} cm`] });
  } else if (!sex) missing.push('which formula to use for body fat (in Body › Profile)');
  else missing.push(`${sex === 'female' ? 'waist, hips and neck' : 'waist and neck'} measurements for body fat`);
  if (bf !== undefined && w && bf > 0 && bf < 75) {
    const lean = w.n * (1 - bf / 100);
    out.push({ id: 'lean-mass', label: 'Lean mass', value: round(lean, 1), unit: 'kg', method: 'Weight less the body fat estimate.', inputs: [`Weight ${at(w, ' kg')}`, `Body fat ${round(bf, 1)}% (estimate)`] });
    if (h) out.push({ id: 'ffmi', label: 'Fat-free mass index', value: round(lean / (h / 100) ** 2, 1), unit: '', method: 'Lean mass in kg divided by height in metres squared.', inputs: [`Lean mass ${round(lean, 1)} kg (estimate)`, `Height ${h} cm`] });
  }
  return { estimates: out, missing };
}

// ── Appointments ─────────────────────────────────────────────────────────────────────────────────────────────────────

export function upcoming(db: HealthDb, today = todayIso(), days = 30): Appointment[] {
  const to = addDays(today, days);
  return db.appointments.filter((a) => a.status === 'booked' && a.day >= today && a.day <= to).sort((a, b) => a.day.localeCompare(b.day) || (a.time ?? '').localeCompare(b.time ?? ''));
}

/** Booked appointments whose reminder day has come (today or a day before, as each asks), soonest first. */
export function remindersDue(db: HealthDb, today = todayIso()): Appointment[] {
  return db.appointments
    .filter((a) => a.status === 'booked' && a.day >= today && daysBetween(today, a.day) <= (a.remind ?? 1))
    .sort((a, b) => a.day.localeCompare(b.day) || (a.time ?? '').localeCompare(b.time ?? ''));
}

/** Booked appointments whose day has passed: asked whether they happened (and their results). */
export const pastBooked = (db: HealthDb, today = todayIso()) => db.appointments.filter((a) => a.status === 'booked' && a.day < today).sort((a, b) => b.day.localeCompare(a.day));

export function appointmentLine(a: Appointment, today = todayIso()): string {
  return `${a.who}${a.why ? ` · ${a.why}` : ''}, ${whenWords(a.day, today)}${a.time ? ` at ${timeWords(a.time)}` : ''}${a.where ? ` · ${a.where}` : ''}`;
}

// ── Log notes in, and back out word for word ─────────────────────────────────────────────────────────────────────────

export interface LogImportPlan {
  title: string;
  /** Each field of the log: the measure it goes to (one there, or a new one made like it). */
  fields: { field: string; measure: string; make?: Measure; values: number }[];
  entries: number;
  days: number;
  notes: number;
  /** The days it covers. */
  first?: string;
  last?: string;
}

const kindFromLog = (log: LogNote, field: string): MeasureKind => {
  let yes = 0;
  let num = 0;
  let words = 0;
  for (const e of log.entries)
    for (const [k, v] of Object.entries(e.values)) {
      if (k.toLowerCase() !== field.toLowerCase()) continue;
      if (v.kind === 'yes') yes++;
      else if (v.kind === 'number') num++;
      else words++;
    }
  if (yes >= num && yes >= words && yes > 0) return 'yesno';
  if (num >= words && num > 0) return 'number';
  return 'text';
};

/** What a log note would become in the store: its fields matched to measures (or new ones), its entries counted. */
export function planLogImport(db: HealthDb, text: string, title: string, ref: Date = new Date()): LogImportPlan {
  const log = parseLog(text, ref);
  const names: string[] = [];
  for (const e of log.entries) for (const k of Object.keys(e.values)) if (!names.some((x) => x.toLowerCase() === k.toLowerCase())) names.push(k);
  const fields = names.map((field) => {
    const had = measureOf(db, field);
    const values = log.entries.filter((e) => Object.keys(e.values).some((k) => k.toLowerCase() === field.toLowerCase())).length;
    if (had) return { field, measure: had.id, values };
    const kind = kindFromLog(log, field);
    const unit = Object.entries(log.units).find(([k]) => k.toLowerCase() === field.toLowerCase())?.[1];
    const make: Measure = drop({ id: newId(), name: field.slice(0, 60), kind, group: kind === 'yesno' ? 'habit' : 'other', unit: unit || undefined, created: Date.now() });
    return { field, measure: make.id, make, values };
  });
  const entries = log.entries.reduce((a, e) => a + Object.keys(e.values).length, 0);
  const notes = log.entries.reduce((a, e) => a + e.notes.length + (e.label ? 1 : 0), 0);
  return { title, fields, entries, days: log.entries.length, notes, ...(log.entries.length ? { first: log.entries[0].date, last: log.entries[log.entries.length - 1].date } : {}) };
}

/**
 * The store with a log note taken in: every field a measure's entry for its day (the words as written kept with the
 * figure), every free line and a day's label kept as the day's notes, and the note itself kept word for word (so it can
 * be put back exactly). An entry already there for the same measure and day is kept unless the log's is newer.
 */
export function importLog(db: HealthDb, o: { path: string; title: string; text: string; moved: boolean; now?: number }, ref: Date = new Date()): { db: HealthDb; record: ImportRecord; plan: LogImportPlan } {
  const now = o.now ?? Date.now();
  const plan = planLogImport(db, o.text, o.title, ref);
  const log = parseLog(o.text, ref);
  const record: ImportRecord = { id: newId(), path: o.path, title: o.title, text: o.text, at: now, entries: plan.entries, moved: o.moved };
  let next: HealthDb = { ...db, measures: [...db.measures, ...plan.fields.filter((f) => f.make).map((f) => f.make!)], imports: [...db.imports, record] };
  for (const e of log.entries) {
    for (const [field, v] of Object.entries(e.values)) {
      const f = plan.fields.find((x) => x.field.toLowerCase() === field.toLowerCase());
      const m = f ? next.measures.find((x) => x.id === f.measure) : undefined;
      if (!m) continue;
      let value: Pick<Entry, 'n' | 'yes' | 'text'>;
      if (m.kind === 'yesno') value = v.kind === 'yes' ? { yes: v.yes, text: v.text } : { text: v.text };
      else if (m.kind === 'text') value = { text: v.text };
      else value = v.kind === 'number' ? { n: m.kind === 'scale' ? Math.min(m.max ?? 10, Math.max(m.min ?? 1, v.n)) : v.n, text: v.text } : { text: v.text };
      next = setEntry(next, m.id, e.date, value, { now, by: 'imported', from: record.id });
    }
    const lines = [...(e.label ? [e.label] : []), ...e.notes];
    for (const line of lines) next = { ...next, notes: [...next.notes, { id: newId(), day: e.date, text: line.slice(0, 2000), at: now, from: record.id }] };
  }
  return { db: next, record, plan };
}

/** The note as it was given, word for word, for putting back; null when the store doesn't have it. */
export const importedText = (db: HealthDb, importId: string): string | null => db.imports.find((r) => r.id === importId)?.text ?? null;

// ── Rows for an assistant (only what answers the question) ───────────────────────────────────────────────────────────

export interface ToolRows {
  measure: string;
  unit?: string;
  from: string;
  to: string;
  rows: { day: string; value: string }[];
  summary: TrendSummary;
}

/** One measure's entries between two days, and their summary: nothing else from the store. */
export function rowsFor(db: HealthDb, m: Measure, from: string, to: string): ToolRows {
  const rows = db.entries
    .filter((e) => e.measure === m.id && e.day >= from && e.day <= to)
    .sort((a, b) => a.day.localeCompare(b.day))
    .map((e) => ({ day: e.day, value: valueWords(m, e) }));
  return { measure: m.name, ...(m.unit ? { unit: m.unit } : {}), from, to, rows, summary: summarise(seriesOf(db, m.id, from, to), m.better) };
}

/** A summary line for an assistant ("Weight: 9 entries from 1 Oct to 24 Oct; latest 82.4 kg (Fri 23 Oct); change −1.8 kg"). */
export function rowsWords(r: ToolRows): string {
  const unit = r.unit ? ` ${r.unit}` : '';
  const sm = r.summary;
  if (!r.rows.length) return `${r.measure}: nothing logged from ${dayWords(r.from)} to ${dayWords(r.to)}.`;
  const parts = [`${r.measure}: ${r.rows.length} entr${r.rows.length === 1 ? 'y' : 'ies'} from ${dayWords(r.from)} to ${dayWords(r.to)}`];
  if (sm.latest) parts.push(`latest ${sm.latest.n}${unit} (${dayWords(sm.latest.day)})`);
  if (sm.count > 1 && sm.change !== undefined) parts.push(`change ${sm.change > 0 ? '+' : sm.change < 0 ? '−' : ''}${Math.abs(sm.change)}${unit}`);
  if (sm.count > 1 && sm.average !== undefined) parts.push(`average ${sm.average}${unit}`);
  if (sm.perWeek !== undefined) parts.push(`about ${sm.perWeek > 0 ? '+' : sm.perWeek < 0 ? '−' : ''}${Math.abs(sm.perWeek)}${unit} a week`);
  return `${parts.join('; ')}.\n${r.rows.map((x) => `${x.day}: ${x.value}`).join('\n')}`;
}

/** Words every assistant is told about the health store. */
export const HEALTH_RULES =
  'Health records live in Ironleaf’s encrypted health store, not in notes. Use the health tools only when the person asks something specific (a measure over some days, a check-in to log, an appointment), ask for the one measure and the days that answer it, and never ask for more. Figures such as body fat are estimates. Never give medical advice: say what the figures show, and suggest a GP for anything medical.';

// ── Export and import back (a whole store, round trip) ───────────────────────────────────────────────────────────────

export const EXPORT_KIND = 'neuralvault-health-export';

export function exportJson(db: HealthDb, at = Date.now()): string {
  return `${JSON.stringify({ kind: EXPORT_KIND, version: 1, at, db }, null, 1)}\n`;
}

/** The person's data as one CSV table (packs uplift item 13): day, type, name, value, detail; oldest first. For
 *  reading anywhere — it honours "the person owns their data" without weakening the encryption (the store stays
 *  sealed; only this file, made on their PC, is plain). It is not an export to bring back: that stays JSON. */
export function exportCsv(db: HealthDb): string {
  const cell = (v: string | number | undefined | null): string => {
    const s = v === undefined || v === null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const mealLabel = (id: string): string => MEAL_KINDS.find((k) => k.id === id)?.label ?? id;
  const setWords = (s: WorkSet): string => [!s.reps && !s.weight && !s.seconds && !s.distance ? '—' : [s.reps ? `${s.reps}` : '', s.weight !== undefined ? `${s.weight}kg` : '', s.seconds !== undefined ? `${s.seconds}s` : '', s.distance !== undefined ? `${s.distance}km` : ''].filter(Boolean).join(' ')].join('');
  const measures = new Map(db.measures.map((m) => [m.id, m]));
  const rows: string[][] = [];
  for (const e of db.entries) {
    const m = measures.get(e.measure);
    const value = e.text ?? (e.n !== undefined ? `${e.n}${m?.unit ? ` ${m.unit}` : ''}` : e.yes !== undefined ? (e.yes ? 'Yes' : 'No') : '');
    rows.push([e.day, 'entry', m?.name ?? e.measure, value, e.note ?? '']);
  }
  for (const n of db.notes) rows.push([n.day, 'note', n.text, '', '']);
  for (const s of db.sessions) {
    const detail = [...s.exercises.map((x) => `${x.name}: ${x.sets.map(setWords).join(', ')}`), ...(s.notes ? [s.notes] : [])].join('; ');
    rows.push([s.day, 'session', s.title, s.minutes !== undefined ? `${s.minutes} min` : SESSION_KINDS.find((k) => k.id === s.kind)?.label ?? s.kind, detail]);
  }
  for (const f of db.meals) {
    const macros = [`${f.protein ?? 0}g protein`, `${f.carbs ?? 0}g carbs`, `${f.fat ?? 0}g fat`].join(' · ');
    rows.push([f.day, 'meal', `${mealLabel(f.meal)}: ${f.what}`, f.kcal !== undefined ? `${f.kcal} kcal` : '', [f.protein !== undefined || f.carbs !== undefined || f.fat !== undefined ? macros : '', f.note ?? ''].filter(Boolean).join(' · ')]);
  }
  for (const a of db.appointments) {
    rows.push([a.day, 'appointment', `${a.who}${a.why ? `: ${a.why}` : ''}`, [a.time, a.status].filter(Boolean).join(' · '), [a.where ?? '', a.notes ?? '', ...a.results.map((r) => `${r.name}: ${r.value}${r.unit ? ` ${r.unit}` : ''}`)].filter(Boolean).join(' · ')]);
  }
  rows.sort((x, y) => x[0].localeCompare(y[0]));
  return `${['day', 'type', 'name', 'value', 'detail'].join(',')}\n${rows.map((r) => r.map(cell).join(',')).join('\n')}\n`;
}

/** An export read back: the store it holds, checked; null when it isn't one. */
export function readExport(text: string): HealthDb | null {
  let v: unknown;
  try {
    v = JSON.parse(String(text ?? '').replace(/^﻿/, ''));
  } catch {
    return null;
  }
  const o = obj(v);
  if (o.kind !== EXPORT_KIND || o.version !== 1) return null;
  return cleanDb(o.db);
}

/** Two stores put together (an export brought in): records by id, the newer write winning. */
export function mergeDb(a: HealthDb, b: HealthDb): HealthDb {
  const by = <T extends { id: string; at?: number; created?: number }>(x: T[], y: T[]): T[] => {
    const m = new Map<string, T>();
    for (const r of [...x, ...y]) {
      const had = m.get(r.id);
      if (!had || (r.at ?? r.created ?? 0) >= (had.at ?? had.created ?? 0)) m.set(r.id, r);
    }
    return [...m.values()];
  };
  const entries = new Map<string, Entry>();
  for (const e of [...a.entries, ...b.entries]) {
    const k = `${e.measure}\n${e.day}`;
    const had = entries.get(k);
    if (!had || e.at >= had.at) entries.set(k, e);
  }
  return {
    ...a,
    profile: { ...a.profile, ...b.profile },
    targets: { ...a.targets, ...b.targets },
    measures: by(a.measures, b.measures),
    entries: [...entries.values()],
    notes: by(a.notes, b.notes),
    sessions: by(a.sessions, b.sessions),
    plans: by(a.plans, b.plans),
    exercises: by(a.exercises as (Exercise & { at?: number })[], b.exercises as (Exercise & { at?: number })[]),
    meals: by(a.meals, b.meals),
    appointments: by(a.appointments, b.appointments),
    imports: by(a.imports, b.imports),
  };
}

/** How much a store holds, in a line ("214 entries · 31 sessions · 2 plans · 3 appointments"). */
export function dbWords(db: HealthDb): string {
  const parts = [
    [db.entries.length, 'entry', 'entries'],
    [db.sessions.length, 'session', 'sessions'],
    [db.plans.length, 'plan', 'plans'],
    [db.meals.length, 'meal', 'meals'],
    [db.appointments.length, 'appointment', 'appointments'],
  ] as const;
  const said = parts.filter(([k]) => k > 0).map(([k, one, many]) => `${k.toLocaleString('en-AU')} ${k === 1 ? one : many}`);
  return said.join(' · ') || 'Nothing kept yet';
}
