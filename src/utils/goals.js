// Robust goals helpers with "finishedAt" stamping and safe guards.

import { getData, saveData } from './storage';

const KEY = 'goals';

export async function getGoals() {
  const raw = await getData(KEY);
  return Array.isArray(raw) ? raw.map(normalizeGoal) : [];
}

export async function saveGoals(arr) {
  const clean = Array.isArray(arr) ? arr : [];
  await saveData(KEY, clean);
  return clean.map(normalizeGoal);
}

export function normalizeGoal(g) {
  const schedule = Array.isArray(g?.schedule) ? g.schedule : [];
  const saved = schedule
    .filter(r => r && r.confirmed)
    .reduce((s, r) => s + Number(r.amount || 0), 0);
  const target = Number(g?.target || 0);
  const finished =
    target > 0 &&
    schedule.length > 0 &&
    schedule.every(r => r && !!r.confirmed);

  return {
    id: g?.id || `goal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: g?.name || 'Savings Goal',
    target,
    months: Number(g?.months || schedule.length || 1),
    deductFrom: g?.deductFrom || g?.from || 'total',
    schedule,
    createdAt: g?.createdAt || new Date().toISOString(),
    finishedAt: finished ? (g?.finishedAt || new Date().toISOString()) : (g?.finishedAt || null),
    saved,
    finished,
  };
}

export function computeStats(goalsArr) {
  const all = Array.isArray(goalsArr) ? goalsArr.map(normalizeGoal) : [];
  const finished = all.filter(g => g.finished).sort((a,b)=>new Date(b.finishedAt||0)-new Date(a.finishedAt||0));
  const ongoing = all.filter(g => !g.finished).sort((a,b)=> new Date(b.createdAt)-new Date(a.createdAt));
  return { all, ongoing, finished };
}

export async function createGoal(payload) {
  const current = await getGoals();
  const g = normalizeGoal({
    ...payload,
    id: `goal-${Date.now()}`,
    createdAt: new Date().toISOString(),
  });
  const next = [g, ...current];
  await saveGoals(next);
  return g;
}

export async function updateGoal(id, patch) {
  const current = await getGoals();
  const idx = current.findIndex(g => g.id === id);
  if (idx === -1) return null;

  const merged = normalizeGoal({ ...current[idx], ...patch });
  const next = [...current];
  next[idx] = merged;
  await saveGoals(next);
  return merged;
}

export async function toggleMonth(goalId, rowIndex) {
  const current = await getGoals();
  const i = current.findIndex(g => g.id === goalId);
  if (i === -1) return null;

  const g = normalizeGoal(current[i]);
  if (!Array.isArray(g.schedule) || !g.schedule[rowIndex]) return g;

  g.schedule[rowIndex] = {
    ...g.schedule[rowIndex],
    confirmed: !g.schedule[rowIndex].confirmed,
  };

  // recompute
  const after = normalizeGoal(g);

  // If just finished, stamp finishedAt
  if (after.finished && !after.finishedAt) {
    after.finishedAt = new Date().toISOString();
  }

  const next = [...current];
  next[i] = after;
  await saveGoals(next);
  return after;
}
