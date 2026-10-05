// src/utils/profile.js
import { getData, saveData } from './storage';

const KEY = 'user_profile';

/** Create/replace the whole profile object (used by onboarding) */
export async function saveProfile(profile) {
  await saveData(KEY, profile);
  return true;
}

/** Merge updates into existing profile and return the updated object */
export async function updateProfile(patch) {
  const current = (await getData(KEY)) || {};
  const updated = { ...current, ...patch };
  await saveData(KEY, updated);
  return updated;
}

export async function getProfile() {
  return (await getData(KEY)) || null;
}

export async function isOnboardingComplete() {
  const p = await getProfile();
  return !!(p && p.name);
}

/** Low-funds % chosen in profiling (number like 20) */
export async function getLowFundsThresholdPercent(defaultPct = 20) {
  const p = await getProfile();
  const raw = p?.lowFundsThresholdPercent;
  const val = Number(raw);
  return Number.isFinite(val) && val > 0 ? val : defaultPct;
}

/** What the % applies to */
export async function getLowFundsBasis(defaultBasis = 'monthly_income') {
  const p = await getProfile();
  const b = p?.lowFundsBasis || defaultBasis;
  return ['monthly_income', 'discretionary', 'income_minus_bills'].includes(b)
    ? b
    : defaultBasis;
}

/* Convenience getters if needed */
export async function getGoalInfo() {
  const p = await getProfile();
  return {
    title: p?.goal || '',
    target: Number(p?.goalTarget || 0),
    saved: Number(p?.goalSaved || 0),
  };
}
