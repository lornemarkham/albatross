// P4 "back up before sharing": a phone's backup carries its Sausage Days, tasting
// cards and recipe versions (with their photos), and restoring only adds.
process.env.TZ = "UTC";
import { test } from "node:test";
import assert from "node:assert/strict";
import { DeviceRecipeStore } from "../src/lib/recipeStorage";
import { PlanStore } from "../src/lib/sausage/preferences";
import { SessionDrafts } from "../src/lib/cooking/drafts";
import { ensureSausageDay } from "../src/lib/sausage/today";
import { finishSausageDay } from "../src/lib/sausage/record";
import { addDayPhoto } from "../src/lib/sausage/day";
import { TastingStore } from "../src/lib/sausage/tasting";
import { VersionStore } from "../src/lib/sausage/versions";
import { bundleWithPhotos, type PhotoStore } from "../src/lib/photos";
import { parseImportFile } from "../src/lib/recipeModel";
import { mergeDeviceRecords, readDeviceRecords } from "../src/lib/deviceRecords";

class Mem { m = new Map<string, string>(); getItem(k: string) { return this.m.get(k) ?? null; } setItem(k: string, v: string) { this.m.set(k, v); } removeItem(k: string) { this.m.delete(k); } }
const T0 = "2026-11-07T19:00:00.000Z";

test("a phone's full backup carries Sausage Day, tasting cards and versions with their photos; restoring twice adds once and never overwrites", async () => {
  const phone = new Mem();
  const store = new DeviceRecipeStore(phone, () => T0);
  const plans = new PlanStore(phone);
  let plan = await ensureSausageDay(store, plans, T0, "Lorne");
  plan = addDayPhoto(plan, { id: "day-ph", caption: "stuffing", addedAt: T0, phase: "during", recipeId: null });
  plans.put(plan);
  plan = await finishSausageDay(store, plans, new SessionDrafts(phone), plan, [{ title: "Bratwurst" }], "2026-11-07T23:00:00.000Z", "Lorne");
  const brat = (await store.listRecipes()).find((r) => r.title === "Bratwurst")!;
  new TastingStore(phone).save(plan.id, brat.id, { author: "Kathy", scores: { overall: 7, seasoning: 5, texture: 8, juiciness: 9 }, makeAgain: "yes", change: "less salt", notes: "", photos: [{ id: "taste-ph", caption: "", addedAt: T0 }] }, null);
  new VersionStore(phone).add({ recipeId: "brat-v2", parentId: brat.id, label: "v2", reason: "less salt", createdAt: T0, by: "Lorne" });

  const blobs = new Map([["day-ph", new Blob(["a"], { type: "image/jpeg" })], ["taste-ph", new Blob(["b"], { type: "image/jpeg" })]]);
  const photos = { get: async (id: string) => blobs.get(id) ?? null, has: async (id: string) => blobs.has(id), put: async () => undefined } as unknown as PhotoStore;
  const bundle = await bundleWithPhotos(store, photos, readDeviceRecords(phone));
  assert.equal(bundle.deviceRecords!.sausagePlans.length, 1);
  assert.equal(bundle.deviceRecords!.tastings[0].scores.juiciness, 9);
  assert.deepEqual(bundle.deviceRecords!.recipeVersions.map((v) => v.recipeId), ["brat-v2"]);
  assert.ok(["day-ph", "taste-ph"].every((id) => bundle.photos!.some((p) => p.id === id)), "their photos are in the file");

  // A new phone: restore, then restore again.
  const data = parseImportFile(JSON.stringify(bundle), T0);
  const other = new Mem();
  assert.deepEqual(mergeDeviceRecords(other, data.deviceRecords!), { plans: 1, tastings: 1, versions: 1, food: 0 });
  assert.deepEqual(mergeDeviceRecords(other, data.deviceRecords!), { plans: 0, tastings: 0, versions: 0, food: 0 });
  assert.equal(new PlanStore(other).list()[0].id, plan.id);
  // The phone's own (newer) card is never overwritten by an older backup.
  const t = new TastingStore(other).list()[0];
  new TastingStore(other).save(plan.id, brat.id, { author: "Kathy", scores: { ...t.scores, overall: 9 }, makeAgain: "yes", change: "", notes: "", photos: [] }, t);
  mergeDeviceRecords(other, data.deviceRecords!);
  assert.equal(new TastingStore(other).list()[0].scores.overall, 9);
  // Older backups without these records still import.
  assert.equal(parseImportFile(JSON.stringify({ ...bundle, deviceRecords: undefined }), T0).deviceRecords, undefined);
});
