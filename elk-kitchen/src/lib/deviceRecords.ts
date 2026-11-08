// Records Kitchen keeps only on this phone (no shared table yet): Sausage Day
// plans and their day logs, tasting cards, and recipe-version lineage. They go
// into Backup & import with everything else, so a phone can be backed up in
// full before shared mode is switched on, and nothing is stranded on it.
//
// Restoring only ever ADDS: a record whose id is already on the phone is left
// exactly as it is (the phone's copy may be newer). Importing the same file
// twice adds nothing.

import type { SausagePlan } from "../types/sausage";
import { PLANS_KEY, normalizePlan } from "./sausage/preferences";
import { TASTINGS_KEY, TastingStore, type Tasting } from "./sausage/tasting";
import { VERSIONS_KEY, VersionStore, type VersionLink } from "./sausage/versions";
import { dayOf } from "./sausage/day";

type KV = Pick<Storage, "getItem" | "setItem">;

export type DeviceRecords = { sausagePlans: SausagePlan[]; tastings: Tasting[]; recipeVersions: VersionLink[] };

function rawList(storage: KV, key: string): unknown[] {
  try { const v = JSON.parse(storage.getItem(key) ?? "[]"); return Array.isArray(v) ? v : []; } catch { return []; }
}

export function readDeviceRecords(storage: KV): DeviceRecords {
  return {
    sausagePlans: rawList(storage, PLANS_KEY).map(normalizePlan).filter((p): p is SausagePlan => !!p),
    tastings: new TastingStore(storage).list(),
    recipeVersions: new VersionStore(storage).list(),
  };
}

export const hasDeviceRecords = (r: DeviceRecords | undefined) => !!r && (r.sausagePlans.length + r.tastings.length + r.recipeVersions.length) > 0;

// Photos those records point to (Sausage Day photos, tasting-card photos).
export const deviceRecordPhotoIds = (r: DeviceRecords | undefined): string[] =>
  r ? [...r.sausagePlans.flatMap((p) => dayOf(p).photos.map((x) => x.id)), ...r.tastings.flatMap((t) => t.photos.map((x) => x.id))] : [];

// From a backup file: anything unreadable is dropped, never guessed.
export function parseDeviceRecords(v: unknown): DeviceRecords | undefined {
  if (!v || typeof v !== "object") return undefined;
  const o = v as Record<string, unknown>;
  const arr = (x: unknown) => (Array.isArray(x) ? x : []);
  const mem = new Map<string, string>([[TASTINGS_KEY, JSON.stringify(arr(o.tastings))], [VERSIONS_KEY, JSON.stringify(arr(o.recipeVersions))]]);
  const kv: KV = { getItem: (k) => mem.get(k) ?? null, setItem: (k, val) => { mem.set(k, val); } };
  return {
    sausagePlans: arr(o.sausagePlans).map(normalizePlan).filter((p): p is SausagePlan => !!p),
    tastings: new TastingStore(kv).list(),
    recipeVersions: new VersionStore(kv).list(),
  };
}

export type DeviceMerge = { plans: number; tastings: number; versions: number };

export function mergeDeviceRecords(storage: KV, incoming: DeviceRecords): DeviceMerge {
  const have = readDeviceRecords(storage);
  const planIds = new Set(rawList(storage, PLANS_KEY).map((p) => (p as { id?: unknown })?.id));
  const newPlans = incoming.sausagePlans.filter((p) => !planIds.has(p.id));
  if (newPlans.length) storage.setItem(PLANS_KEY, JSON.stringify([...rawList(storage, PLANS_KEY), ...newPlans]));
  const tIds = new Set(have.tastings.map((t) => t.id));
  const newT = incoming.tastings.filter((t) => !tIds.has(t.id));
  if (newT.length) storage.setItem(TASTINGS_KEY, JSON.stringify([...rawList(storage, TASTINGS_KEY), ...newT]));
  const vIds = new Set(have.recipeVersions.map((v) => v.recipeId));
  const newV = incoming.recipeVersions.filter((v) => !vIds.has(v.recipeId));
  if (newV.length) storage.setItem(VERSIONS_KEY, JSON.stringify([...rawList(storage, VERSIONS_KEY), ...newV]));
  return { plans: newPlans.length, tastings: newT.length, versions: newV.length };
}
