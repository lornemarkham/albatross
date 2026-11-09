import { useMemo, useState } from "react";
import { useKitchen } from "../context/KitchenContext";
import { supabase } from "../lib/supabase";
import { useLoad } from "../lib/useLoad";
import { newId } from "../lib/recipeModel";
import { candidates, loadStock, lotLabel, receiveFinished, type StockItem } from "../lib/pantryStock";
import { returnUnused, undoFood, useFood, type UseFor } from "../lib/food/consume";
import { FoodStore } from "../lib/food/notes";
import { recordPantry } from "../lib/cooking/session";
import { qtyText } from "../lib/cooking/parse";
import { dateOf } from "../lib/cooking/summary";
import type { CookingSession, PantryAction } from "../types/cooking";
import { inputClass, secondaryButton, sectionLabel } from "./ui";

// The latest state of each Pantry change this cook made (undo is a later event).
export function pantryReceipts(s: CookingSession): PantryAction[] {
  const by = new Map<string, PantryAction>();
  for (const e of s.events) if (e.kind === "pantry") by.set(e.action.requestId, e.action);
  return [...by.values()];
}

type Update = (f: (s: CookingSession) => CookingSession) => void;

// Confirm what came out of ELK Pantry, and put the finished food in.
// Nothing changes in Inventory until the person taps and confirms.
export function PantryUse({ session, update, defaultName }: { session: CookingSession; update: Update; defaultName: string }) {
  const { member } = useKitchen();
  const client = supabase;
  const { data: stock, error, reload } = useLoad(async () => (member && client ? loadStock(client) : null), [member, client]);
  const receipts = pantryReceipts(session);
  const foodStore = useMemo(() => new FoodStore(window.localStorage), []);
  // What came out of Pantry is remembered against this cook, so it shows in the food's history after it's all gone.
  const why: UseFor = { label: session.recipeTitle || "cooking", sessionId: session.id };

  if (!member || !client) {
    return (
      <p className="rounded-xl border border-dashed border-clay bg-cream/60 p-4 text-sm text-bark/70">
        ELK Pantry isn't connected on this device{client ? " (sign in as a family member)" : ""}, so nothing in Inventory changes. Once Kitchen is connected, you'll confirm what you used here and Pantry's stock updates.
      </p>
    );
  }
  if (error) return <p className="text-sm text-red-700">Couldn't read ELK Pantry: {error}</p>;
  if (stock === undefined || stock === null) return <p className="text-sm text-bark/60">Reading ELK Pantry…</p>;
  if (stock.status === "not-set-up") return <p className="text-sm text-bark/70">ELK Pantry isn't set up in this database yet. Nothing in Inventory changes.</p>;
  if (stock.status === "error") return <p className="text-sm text-red-700">Couldn't read ELK Pantry: {stock.error}</p>;
  const items = stock.items;

  const record = (a: PantryAction) => { update((s) => recordPantry(s, a, a.at)); reload(); };

  return (
    <div className="space-y-4">
      <p className="text-sm text-bark/70">
        Pantry counts packages, not grams. Choose what came out of which batch; Kitchen asks before changing anything, and ELK Inventory keeps the stock history.
      </p>
      {session.ingredients.filter((i) => !i.removed).map((i) => (
        <UseRow key={i.id} label={`${i.name} · ${qtyText(i.qty)} said`} items={items} suggested={candidates(i.name, items)} onDone={record} client={client} store={foodStore} why={why} />
      ))}
      {/* Cooking a chef idea: what it planned to use from Pantry, offered one by one (nothing is taken until confirmed). */}
      {(session.draft?.ingredients ?? [])
        .filter((d) => d.status === "have" && d.evidence.startsWith("Pantry") && !session.ingredients.some((i) => !i.removed && i.name.toLowerCase() === d.name.toLowerCase()))
        .map((d) => (
          <UseRow key={`draft-${d.name}`} label={`${d.name} · planned in the idea${d.amount ? ` (${d.amount})` : ""}`} items={items} suggested={candidates(d.name, items)} onDone={record} client={client} store={foodStore} why={why} />
        ))}
      <UseRow label="Something else from Pantry" items={items} suggested={[]} onDone={record} client={client} store={foodStore} why={why} />

      <Finished items={items} defaultName={defaultName} madeOn={dateOf(session.startedAt)} onDone={record} client={client} />

      {receipts.length > 0 && (
        <div>
          <p className={sectionLabel}>Pantry changes from this cook</p>
          <ul className="mt-2 space-y-2">
            {receipts.map((a) => <Receipt key={a.requestId} a={a} items={items} client={client} store={foodStore} why={why} onUndone={(u) => record(u)} />)}
          </ul>
        </div>
      )}
    </div>
  );
}

type Client = NonNullable<typeof supabase>;

function UseRow({ label, items, suggested, onDone, client, store, why }: { label: string; items: StockItem[]; suggested: StockItem[]; onDone: (a: PantryAction) => void; client: Client; store: FoodStore; why: UseFor }) {
  const [itemId, setItemId] = useState(suggested[0]?.id ?? "");
  const [lotId, setLotId] = useState("");
  const [count, setCount] = useState("1");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  // Kept until it succeeds, so a retry after a lost reply can't use twice.
  const [requestId, setRequestId] = useState(newId);
  const item = items.find((x) => x.id === itemId) ?? null;
  const lot = item?.lots.find((l) => l.id === lotId) ?? null;
  const others = useMemo(() => items.filter((x) => !suggested.includes(x)).sort((a, b) => a.name.localeCompare(b.name)), [items, suggested]);

  async function use(all = false) {
    if (!item) return;
    const n = all ? (lot ? lot.remaining : item.onHand) : Number(count);
    if (!Number.isInteger(n) || n < 1) { setMsg("Use a whole number of packages, 1 or more."); return; }
    if (!window.confirm(`Take ${n} ${item.unit} of ${item.name} out of ELK Pantry?\n\nFrom: ${lotLabel(lot)}\nPantry has ${item.onHand} now; it will have ${item.onHand - n}.`)) return;
    setBusy(true); setMsg(null);
    const r = await useFood(client, store, { item, lot, quantity: n, requestId, why });
    setBusy(false);
    if (!r.ok) { setMsg(r.error); return; }
    setRequestId(newId());
    setMsg(`Done: ${item.name} ${item.onHand} → ${item.onHand - n} ${item.unit}.`);
    onDone(r.action);
  }

  return (
    <div className="rounded-xl border border-clay bg-white/70 p-3">
      <p className="font-medium text-bark">{label}</p>
      {suggested.length === 0 && label !== "Something else from Pantry" && <p className="text-xs text-bark/60">Pantry has nothing with that name. Pick an item if it's under another name, or skip it.</p>}
      <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_1fr_5rem]">
        <select aria-label="Pantry item" value={itemId} onChange={(e) => { setItemId(e.target.value); setLotId(""); }} className={`${inputClass} mt-0`}>
          <option value="">— Not from Pantry —</option>
          {suggested.length > 0 && <optgroup label="Likely">{suggested.map((x) => <option key={x.id} value={x.id}>{x.name} ({x.onHand} {x.unit})</option>)}</optgroup>}
          <optgroup label="Everything in Pantry">{others.map((x) => <option key={x.id} value={x.id}>{x.name} ({x.onHand} {x.unit})</option>)}</optgroup>
        </select>
        <select aria-label="Which batch" value={lotId} onChange={(e) => setLotId(e.target.value)} disabled={!item} className={`${inputClass} mt-0`}>
          <option value="">Oldest first</option>
          {item?.lots.map((l) => <option key={l.id} value={l.id}>{lotLabel(l)}</option>)}
        </select>
        <input aria-label="How many" type="number" inputMode="numeric" min={1} step={1} value={count} onChange={(e) => setCount(e.target.value)} disabled={!item} className={`${inputClass} mt-0`} />
      </div>
      {item && (
        <div className="mt-2 grid grid-cols-2 gap-2">
          <button type="button" disabled={busy} onClick={() => use()} className={secondaryButton}>{busy ? "Updating Pantry…" : `Use ${count || "?"} ${item.unit}`}</button>
          <button type="button" disabled={busy || (lot ? lot.remaining : item.onHand) < 1} onClick={() => use(true)} className={secondaryButton}>Use all ({lot ? lot.remaining : item.onHand})</button>
        </div>
      )}
      {msg && <p role="status" className="mt-2 text-sm text-bark">{msg}</p>}
    </div>
  );
}

function Finished({ items, defaultName, madeOn, onDone, client }: { items: StockItem[]; defaultName: string; madeOn: string; onDone: (a: PantryAction) => void; client: Client }) {
  const [name, setName] = useState(defaultName);
  const [count, setCount] = useState("");
  const [unit, setUnit] = useState("packs");
  const [place, setPlace] = useState("Freezer");
  const [bestBefore, setBestBefore] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [requestId, setRequestId] = useState(newId);
  const [newItemId] = useState(newId);
  const existing = items.find((x) => x.name.trim().toLowerCase() === name.trim().toLowerCase()) ?? null;

  async function put() {
    const n = Number(count);
    if (!Number.isInteger(n) || n < 1) { setMsg("How many packages? A whole number, 1 or more."); return; }
    if (!window.confirm(`Put ${n} ${existing?.unit ?? unit} of ${existing?.name ?? name.trim()} into ELK Pantry?\n\nPlace: ${place || "not set"}\nBest before: ${bestBefore || "not set"}\nMade on: ${madeOn}${existing ? "" : "\n\nThis adds a new item to Pantry."}`)) return;
    setBusy(true); setMsg(null);
    const r = await receiveFinished(client, { item: existing, newName: name, unit, quantity: n, location: place, bestBefore: bestBefore || null, madeOn, requestId, newItemId });
    setBusy(false);
    if (!r.ok) { setMsg(r.error); return; }
    setRequestId(newId());
    setMsg(`Added to Pantry: ${n} ${r.action.unit} of ${r.action.itemName}.`);
    setCount("");
    onDone(r.action);
  }

  return (
    <div className="rounded-xl border border-sage/40 bg-sage/10 p-3">
      <p className="font-medium text-bark">Put the finished food in Pantry</p>
      <p className="text-xs text-bark/60">For the freezer or pantry shelf. Inventory keeps it as its own batch with this date.</p>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <input aria-label="Finished food" value={name} onChange={(e) => setName(e.target.value)} className={`${inputClass} mt-0`} placeholder="e.g. Garlic pork sausage" />
        <div className="grid grid-cols-2 gap-2">
          <input aria-label="How many packages" type="number" inputMode="numeric" min={1} step={1} value={count} onChange={(e) => setCount(e.target.value)} placeholder="How many" className={`${inputClass} mt-0`} />
          <input aria-label="Unit" value={existing?.unit ?? unit} disabled={!!existing} onChange={(e) => setUnit(e.target.value)} className={`${inputClass} mt-0`} />
        </div>
        <input aria-label="Where" value={place} onChange={(e) => setPlace(e.target.value)} className={`${inputClass} mt-0`} placeholder="Chest freezer" />
        <label className="text-sm text-bark/70">Best before
          <input aria-label="Best before" type="date" value={bestBefore} onChange={(e) => setBestBefore(e.target.value)} className={`${inputClass} mt-0`} />
        </label>
      </div>
      {existing && <p className="mt-1 text-xs text-bark/60">Adds to the existing Pantry item “{existing.name}” ({existing.onHand} {existing.unit} now).</p>}
      <button type="button" disabled={busy || !name.trim()} onClick={put} className={`${secondaryButton} mt-2 w-full`}>{busy ? "Updating Pantry…" : "Put in Pantry"}</button>
      {msg && <p role="status" className="mt-2 text-sm text-bark">{msg}</p>}
    </div>
  );
}

function Receipt({ a, items, client, store, why, onUndone }: { a: PantryAction; items: StockItem[]; client: Client; store: FoodStore; why: UseFor; onUndone: (a: PantryAction) => void }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const now = items.find((x) => x.id === a.itemId);
  const verb = a.kind === "used" ? "Used" : a.kind === "moved" ? "Moved" : "Added";
  async function undo() {
    if (!window.confirm(`Undo: ${a.kind === "received" ? "take out" : a.kind === "moved" ? "move back" : "put back"} ${a.quantity} ${a.unit} of ${a.itemName}?`)) return;
    setBusy(true);
    const r = await undoFood(client, store, a);
    setBusy(false);
    if (!r.ok) { setMsg(r.error); return; }
    onUndone({ ...a, undone: true, undoBatchId: r.undoBatchId, at: new Date().toISOString() });
  }
  // "We didn't use all of it": put the rest back, keep what was used.
  async function giveBack() {
    const ask = window.prompt(`How many of the ${a.quantity} ${a.unit} of ${a.itemName} did you NOT use? They go back into Pantry.`, "1");
    if (ask === null) return;
    const n = Number(ask);
    if (!Number.isInteger(n) || n < 1 || n > a.quantity) { setMsg(`Enter a whole number from 1 to ${a.quantity}.`); return; }
    if (!window.confirm(`Put ${n} ${a.unit} of ${a.itemName} back${n < a.quantity ? ` and keep ${a.quantity - n} as used` : ""}?`)) return;
    setBusy(true);
    const r = await returnUnused(client, store, { action: a, returning: n, why });
    setBusy(false);
    if (!r.ok) { setMsg(r.error); return; }
    onUndone({ ...a, undone: true, undoBatchId: r.undoBatchId, at: new Date().toISOString() });
    if (r.remaining) onUndone(r.remaining);
  }
  return (
    <li className={`rounded-xl border border-clay bg-white/70 p-3 text-sm ${a.undone ? "opacity-60" : ""}`}>
      <p className="font-medium text-bark">{verb} {a.quantity} {a.unit} · {a.itemName}{a.undone && " — undone"}</p>
      <p className="text-xs text-bark/60">{a.lotLabel}{now ? ` · Pantry has ${now.onHand} ${now.unit} now` : ""}</p>
      {!a.undone && (
        <div className="mt-1 flex gap-4">
          <button type="button" disabled={busy} onClick={undo} className="text-xs text-bark/60 underline">Undo</button>
          {a.kind === "used" && <button type="button" disabled={busy} onClick={giveBack} className="text-xs text-bark/60 underline">Return some unused</button>}
        </div>
      )}
      {msg && <p className="mt-1 text-xs text-red-700">{msg}</p>}
    </li>
  );
}
