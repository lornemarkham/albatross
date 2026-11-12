import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { PhotoImg } from "../components/Photos";
import { inputClass, primaryButton, secondaryButton, sectionLabel } from "../components/ui";
import { useKitchen } from "../context/KitchenContext";
import { useListening } from "../lib/cooking/device";
import { addFood, identify, planAdd, type CapturedPhoto, type Duplicate } from "../lib/food/capture";
import { parseCommand, resolveCommand, type CommandPlan, type ChangePlan } from "../lib/food/commands";
import { moveFood, undoFood, useFood } from "../lib/food/consume";
import { parseFoodDescription, type FoodDraft } from "../lib/food/describe";
import { foodHistory } from "../lib/food/history";
import { FoodStore, fingerprintBytes } from "../lib/food/notes";
import { askFoodPhoto, downscaleForAi, type FoodSuggestion } from "../lib/food/vision";
import { addPhoto } from "../lib/photos";
import { newId } from "../lib/recipeModel";
import { loadStock, undoStock, type StockItem } from "../lib/pantryStock";
import { supabase } from "../lib/supabase";
import { useLoad } from "../lib/useLoad";
import { localToday } from "../prototype/ideas/context";
import type { PantryAction } from "../types/cooking";

const PLACES = ["Freezer", "Fridge", "Pantry", "Chest freezer", "Garage freezer"];
const EXAMPLES = ["Add these two pork bones to my freezer", "I made three containers of chicken stock", "What's in my freezer?", "Show me what needs using", "I used the last of the stew meat"];

// `file` stays in memory for the photo helper; the saved copy goes through the photo store.
type Shot = CapturedPhoto & { url: string; file: File };
type Draft = { key: string; draft: FoodDraft; itemId: string | null; bestBefore: string; requestId: string; newItemId: string; allowDuplicate: boolean; state: "idle" | "saving" | { done: PantryAction } | { error: string; duplicates?: Duplicate[] } };

// Photograph it, say it, confirm it: food goes into ELK Inventory (its own
// pantry functions) with a Kitchen note beside it. Nothing is saved until the
// person taps Save on the exact record they can see.
export function AddFoodPage() {
  const { member, myName, photos } = useKitchen();
  const client = supabase;
  const notes = useMemo(() => new FoodStore(window.localStorage), []);
  const stock = useLoad(async () => (member && client ? loadStock(client) : null), [member, client]);
  // The kitchen screen's shortcuts start the sentence ("Leftover …"); nothing is saved until Save.
  const [params] = useSearchParams();
  const [text, setText] = useState(() => params.get("say") ?? "");
  const [shots, setShots] = useState<Shot[]>([]);
  const [suggestions, setSuggestions] = useState<FoodSuggestion[] | null>(null);
  const [picked, setPicked] = useState<FoodSuggestion | null>(null);
  const [helper, setHelper] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [place, setPlace] = useState("");
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [answer, setAnswer] = useState<{ title: string; lines: string[] } | null>(null);
  const [change, setChange] = useState<{ plan: ChangePlan; verb: "use" | "move"; to: string } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [undo, setUndo] = useState<{ action: PantryAction } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const previews = useRef<string[]>([]);
  useEffect(() => () => previews.current.forEach((u) => URL.revokeObjectURL(u)), []);

  const listening = useListening({ onHeard: (t) => setText((prev) => (prev.trim() ? `${prev.trim()} ${t}` : t)), keepListening: false });

  const items: StockItem[] = stock.data && stock.data.status === "ready" ? stock.data.items : [];
  const places = useMemo(() => [...new Set([...PLACES, ...items.flatMap((i) => i.lots.map((l) => l.location)).filter(Boolean)])], [items]);
  const history = useMemo(() => foodHistory(notes.list(), items), [notes, items, stock.data]);

  async function pickFiles(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    setError(null);
    for (const f of files) {
      if (!f.type.startsWith("image/") && !/\.(heic|heif)$/i.test(f.name)) { setError("Only photos can be added here."); continue; }
      try {
        const fingerprint = await fingerprintBytes(await f.arrayBuffer());
        // Saved on this phone the moment it's chosen, like recipe photos.
        const ref = await addPhoto(photos, f);
        const url = URL.createObjectURL(f);
        previews.current.push(url);
        setShots((s) => [...s, { ref, fingerprint, url, file: f }]);
      } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    }
  }

  async function suggest() {
    if (!shots.length || !client) return;
    setAsking(true); setHelper(null);
    try {
      const token = (await client.auth.getSession()).data.session?.access_token;
      if (!token) { setHelper("Sign in again to use photo suggestions. You can describe the food instead."); return; }
      const r = await askFoodPhoto({ mode: "food-photo", image: await downscaleForAi(shots[0].file), hint: text.slice(0, 300) }, token);
      if (!r.ok) { setHelper(r.error); return; }
      setSuggestions(r.reply.suggestions);
      setHelper(r.reply.cannotTell ? "Couldn't tell what this is from the photo. Describe it instead." : null);
    } catch { setHelper("Couldn't read the photo for a suggestion. Describe it instead."); }
    finally { setAsking(false); }
  }

  function toDrafts(list: FoodDraft[]) {
    const fixed = list.map((d) => ({ ...d, location: d.location || place }));
    setDrafts(fixed.map((d) => {
      const plan = planAdd(d, items, notes.list(), shots.map((s) => s.fingerprint), new Date().toISOString());
      return { key: newId(), draft: d, itemId: plan.existing?.id ?? null, bestBefore: "", requestId: newId(), newItemId: newId(), allowDuplicate: false, state: "idle" as const };
    }));
  }

  // "Check it": a description, or the photo's suggestion with no amount.
  function check() {
    setError(null); setAnswer(null); setChange(null); setNote(null);
    const parsed = parseFoodDescription(text, localToday());
    if (parsed.length) { toDrafts(parsed); return; }
    if (picked) { toDrafts(parseFoodDescription(picked.name, localToday())); return; }
    if (text.trim()) setError("Couldn't tell what food that is. Try “two pork bones in the freezer”.");
    else setError("Take a photo or describe the food first.");
  }

  // The "Tell Kitchen" line: add, list, needs using, used, move.
  function tell(sentence: string) {
    setError(null); setAnswer(null); setChange(null); setNote(null);
    const cmd = parseCommand(sentence, localToday());
    const plan: CommandPlan = resolveCommand(cmd, items, notes.list(), localToday());
    if (plan.kind === "add") { setText(sentence); toDrafts(plan.drafts); }
    else if (plan.kind === "answer") setAnswer({ title: plan.title, lines: plan.lines });
    else if (plan.kind === "used") setChange({ plan: plan.plan, verb: "use", to: "" });
    else if (plan.kind === "move") setChange({ plan: plan.plan, verb: "move", to: plan.to });
    else setNote(plan.reply);
  }

  const patch = (key: string, f: (d: Draft) => Draft) => setDrafts((all) => all.map((d) => (d.key === key ? f(d) : d)));

  async function save(d: Draft) {
    if (!client) return;
    patch(d.key, (x) => ({ ...x, state: "saving" }));
    const sugg = picked && suggestions ? { name: picked.name, confidence: picked.confidence } : null;
    const r = await addFood(client, notes, {
      stock: items, draft: d.draft, itemId: d.itemId, photos: shots, identification: identify(d.draft.name, sugg), bestBefore: d.bestBefore || null,
      allowDuplicate: d.allowDuplicate, requestId: d.requestId, newItemId: d.newItemId, addedBy: myName, newId,
    });
    if (!r.ok) { patch(d.key, (x) => ({ ...x, state: { error: r.error, duplicates: r.duplicates } })); return; }
    patch(d.key, (x) => ({ ...x, state: { done: r.action } }));
    // Once everything from this photo and description is saved, the next add starts clean (its photo is already attached to what was saved).
    if (drafts.every((x) => x.key === d.key || (typeof x.state === "object" && "done" in x.state))) { setShots([]); setSuggestions(null); setPicked(null); setText(""); }
    stock.reload();
  }

  async function undoAdd(d: Draft, a: PantryAction) {
    if (!client || !window.confirm(`Take ${a.quantity} ${a.unit} of ${a.itemName} back out of Inventory? (Only works if none has been used.)`)) return;
    const r = await undoStock(client, a);
    if (!r.ok) { setError(r.error); return; }
    notes.recordUse({ id: a.itemId, name: a.itemName }, { id: r.undoBatchId, at: new Date().toISOString(), kind: "undone", quantity: a.quantity, unit: a.unit, requestId: a.requestId, for: "adding it was undone", sessionId: null }, new Date().toISOString());
    patch(d.key, (x) => ({ ...x, state: "idle", requestId: newId(), newItemId: newId() }));
    stock.reload();
  }

  async function runChange() {
    if (!client || !change || change.plan.status !== "ready") return;
    const { item, lot, quantity } = change.plan;
    const r = change.verb === "use"
      ? await useFood(client, notes, { item, lot, quantity, why: { label: "eaten or used up" } })
      : lot ? await moveFood(client, notes, { item, lot, quantity, toLocation: change.to }) : { ok: false as const, error: "Pick a single batch to move." };
    if (!r.ok) { setError(r.error); return; }
    setNote(`${change.verb === "use" ? "Took out" : "Moved"} ${quantity} ${item.unit} of ${item.name}.`);
    setUndo({ action: r.action });
    setChange(null);
    stock.reload();
  }
  async function undoLast() {
    if (!client || !undo) return;
    const r = await undoFood(client, notes, undo.action);
    if (!r.ok) { setError(r.error); return; }
    setNote(`Undone: ${undo.action.quantity} ${undo.action.unit} of ${undo.action.itemName} is back in Inventory.`);
    setUndo(null);
    stock.reload();
  }

  if (!member || !client) {
    return (
      <Shell>
        <p className="mt-4 rounded-xl border border-clay bg-cream p-4 text-sm text-bark/80">Adding food saves it to ELK Inventory, which is for people signed in and on the family list. Sign in as a family member to use this page.</p>
      </Shell>
    );
  }
  if (stock.data && stock.data.status === "not-set-up") return <Shell><p className="mt-4 rounded-xl border border-clay bg-cream p-4 text-sm text-bark/80">ELK Pantry isn't set up in the family account yet, so there's nowhere to put food.</p></Shell>;
  if (stock.data && stock.data.status === "error") return <Shell><p className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">Couldn't read ELK Pantry: {stock.data.error}</p></Shell>;

  return (
    <Shell>
      <section className="mt-5 rounded-3xl border border-clay bg-cream p-5 shadow-sm">
        <div className="grid grid-cols-2 gap-3">
          <label className={`${primaryButton} cursor-pointer text-center`}>📷 Take a photo
            <input type="file" accept="image/*" capture="environment" onChange={pickFiles} className="sr-only" />
          </label>
          <label className={`${secondaryButton} cursor-pointer text-center`}>🖼 Upload a photo
            <input type="file" accept="image/*" multiple onChange={pickFiles} className="sr-only" />
          </label>
        </div>

        {shots.length > 0 && (
          <div className="mt-3">
            <ul className="flex flex-wrap gap-2">{shots.map((s) => <li key={s.ref.id}><img src={s.url} alt="" className="h-20 w-20 rounded-xl border border-clay object-cover" /></li>)}</ul>
            <button type="button" disabled={asking} onClick={suggest} className={`${secondaryButton} mt-2 w-full`}>{asking ? "Looking at the photo…" : "Suggest what it is from the photo"}</button>
            <p className="mt-1 text-xs text-bark/60">Optional. A small copy of the first photo goes to Kitchen's AI helper, which only suggests names. You decide what it is.</p>
            {helper && <p role="status" className="mt-2 text-sm text-bark/80">{helper}</p>}
            {suggestions && suggestions.length > 0 && (
              <div className="mt-2">
                <p className="text-sm text-bark">Possibly (not confirmed):</p>
                <div className="mt-1 flex flex-wrap gap-2">
                  {suggestions.map((s) => (
                    <button key={s.name} type="button" aria-pressed={picked?.name === s.name} onClick={() => { setPicked(s); if (!text.trim()) setText(s.name); }}
                      className={`rounded-full px-3 py-1 text-sm ring-1 ${picked?.name === s.name ? "bg-sage text-white ring-sage" : "bg-white text-bark ring-clay"}`}>
                      {s.name} · {s.confidence} confidence
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <label htmlFor="describe" className="mt-4 block text-base font-medium text-bark">Describe it</label>
        <textarea id="describe" rows={2} value={text} onChange={(e) => setText(e.target.value)} className={inputClass}
          placeholder="e.g. two frozen pork shoulder bones with meat attached" />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {listening.supported && (
            <button type="button" onClick={listening.state === "off" ? listening.start : listening.stop} aria-pressed={listening.state !== "off"} className={secondaryButton}>
              {listening.state === "off" ? "🎤 Speak" : "⏹ Stop"}
            </button>
          )}
          {listening.interim && <span className="text-sm italic text-bark/60">{listening.interim}</span>}
          {listening.error && <span className="text-sm text-red-700">{listening.error}</span>}
        </div>

        <p className={`${sectionLabel} mt-4`}>Where does it go?</p>
        <div className="mt-1 flex flex-wrap gap-2" role="group" aria-label="Storage location">
          {places.map((p) => (
            <button key={p} type="button" aria-pressed={place === p} onClick={() => setPlace(place === p ? "" : p)}
              className={`rounded-full px-3 py-1 text-sm ring-1 ${place === p ? "bg-sage text-white ring-sage" : "bg-white text-bark ring-clay"}`}>{p}</button>
          ))}
        </div>

        <button type="button" onClick={check} className={`${primaryButton} mt-4 w-full`}>Check it →</button>
        <p className="mt-2 text-xs text-bark/60">Amounts are optional. “Two bones”, “half a bag” and “one batch” are fine; if you don't know, leave it out.</p>
      </section>

      {error && <p role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}

      {drafts.length > 0 && (
        <section className="mt-5 space-y-4" aria-label="Check before saving">
          <h2 className="text-xl font-bold text-bark">Check before saving</h2>
          {drafts.map((d) => <DraftCard key={d.key} d={d} items={items} notes={notes} shots={shots} places={places} onChange={(f) => patch(d.key, f)} onSave={() => save(d)} onUndo={(a) => undoAdd(d, a)} />)}
          <button type="button" className="text-sm text-bark/60 underline" onClick={() => { setDrafts([]); setText(""); setShots([]); setSuggestions(null); setPicked(null); }}>Start over</button>
        </section>
      )}

      <section className="mt-8 rounded-3xl border border-clay bg-white/70 p-5">
        <h2 className="text-lg font-bold text-bark">Tell Kitchen</h2>
        <TellBox onTell={tell} />
        <p className="mt-2 text-xs text-bark/60">Try: {EXAMPLES.map((e) => `“${e}”`).join(" · ")}</p>
        {note && <p role="status" className="mt-3 text-sm text-bark">{note}</p>}
        {undo && <button type="button" onClick={undoLast} className="mt-1 text-sm text-bark/70 underline">Undo that</button>}
        {answer && (
          <div className="mt-3">
            <p className="font-medium text-bark">{answer.title}</p>
            <ul className="mt-1 list-disc pl-5 text-sm text-bark/80">{answer.lines.map((l) => <li key={l}>{l}</li>)}</ul>
          </div>
        )}
        {change && <ChangeCard c={change} onPick={(item) => setChange({ ...change, plan: { status: "ask", question: "", options: [item], needsCount: true } })} onCount={(n) => {
          const item = change.plan.status === "ask" ? change.plan.options[0] : null;
          if (!item) return;
          const lot = change.verb === "move" ? item.lots.find((l) => l.remaining >= n) ?? null : null;
          setChange({ ...change, plan: n > item.onHand ? { status: "none", reply: `Inventory only has ${item.onHand} ${item.unit} of ${item.name}. Nothing was changed.` } : { status: "ready", item, lot, quantity: n, summary: `${change.verb === "use" ? "Take out" : "Move"} ${n} ${item.unit} of ${item.name}`, lines: [`Inventory has ${item.onHand} ${item.unit} now; you can undo this afterwards.`] } });
        }} onConfirm={runChange} onCancel={() => setChange(null)} />}
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-bold text-bark">In your kitchen now</h2>
        <p className="text-sm text-bark/70">From ELK Inventory. Only food it shows as in stock is listed here.</p>
        {stock.data === undefined ? <p className="mt-2 text-bark/60">Reading Inventory…</p> : (
          <ul className="mt-2 divide-y divide-clay/60 rounded-2xl border border-clay bg-cream">
            {items.filter((i) => i.onHand > 0).sort((a, b) => a.name.localeCompare(b.name)).map((i) => {
              const n = notes.byItem(i.id).find((x) => x.photos.length);
              return (
                <li key={i.id} className="flex items-center gap-3 px-4 py-3">
                  {n ? <PhotoImg id={n.photos[0].id} className="h-12 w-12 shrink-0 rounded-lg" /> : null}
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-bark">{i.name}</p>
                    <p className="text-sm text-bark/70">{i.onHand} {i.unit}{i.lots.length ? ` · ${[...new Set(i.lots.map((l) => l.location || "no place"))].join(", ")}` : ""}{n && !n.amountKnown && n.origin === "kitchen" ? " · amount not known" : ""}{n?.approximate ? ` · ${n.quantityText}` : ""}</p>
                  </div>
                  <button type="button" className="text-sm text-bark/70 underline" onClick={() => tell(`I used the last of the ${i.name.toLowerCase()}`)}>Used up</button>
                </li>
              );
            })}
            {items.every((i) => i.onHand <= 0) && <li className="px-4 py-4 text-bark/70">Nothing in stock yet. Add something above.</li>}
          </ul>
        )}
      </section>

      {(history.usedUp.length > 0 || history.inStock.length > 0) && (
        <section className="mt-8">
          <h2 className="text-lg font-bold text-bark">Used before</h2>
          <p className="text-sm text-bark/70">What happened to food Kitchen has records for. Used-up food stays here as history, not as stock.</p>
          <ul className="mt-2 divide-y divide-clay/60 rounded-2xl border border-clay bg-cream">
            {[...history.usedUp, ...history.inStock].map((h) => (
              <li key={h.itemId} className="px-4 py-3 text-sm">
                <span className="font-medium text-bark">{h.itemName}</span>
                <span className="text-bark/70"> · {h.onHand <= 0 ? "used up" : `${h.onHand} ${h.unit} left`} · {h.used} {h.unit} used{h.lastFor ? ` for ${h.lastFor}` : ""}{h.lastAt ? ` · ${h.lastAt.slice(0, 10)}` : ""}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <Link to="/" className="text-sm font-medium text-sage hover:underline">← Recipes</Link>
      <h1 className="mt-4 font-display text-3xl font-bold text-bark">Add food</h1>
      <p className="mt-1 text-bark/70">Photograph it, say what it is, and it goes into ELK Inventory, where Kitchen can cook with it.</p>
      {children}
    </div>
  );
}

function TellBox({ onTell }: { onTell: (s: string) => void }) {
  const [v, setV] = useState("");
  const heard = useListening({ onHeard: (t) => { setV(t); onTell(t); }, keepListening: false });
  return (
    <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (v.trim()) onTell(v.trim()); }}>
      <input value={v} onChange={(e) => setV(e.target.value)} aria-label="Tell Kitchen" placeholder="“I made three containers of chicken stock”" className={`${inputClass} mt-0`} />
      {heard.supported && <button type="button" className={secondaryButton} aria-label="Speak" onClick={heard.state === "off" ? heard.start : heard.stop}>{heard.state === "off" ? "🎤" : "⏹"}</button>}
      <button type="submit" className={primaryButton}>Go</button>
    </form>
  );
}

function ChangeCard({ c, onPick, onCount, onConfirm, onCancel }: { c: { plan: ChangePlan; verb: "use" | "move"; to: string }; onPick: (i: StockItem) => void; onCount: (n: number) => void; onConfirm: () => void; onCancel: () => void }) {
  const [n, setN] = useState("1");
  const p = c.plan;
  return (
    <div className="mt-3 rounded-xl border border-clay bg-cream p-3 text-sm" role="group" aria-label="Confirm change">
      {p.status === "none" && <p className="text-bark">{p.reply}</p>}
      {p.status === "ask" && !p.needsCount && (
        <>
          <p className="text-bark">{p.question}</p>
          <div className="mt-2 flex flex-wrap gap-2">{p.options.map((o) => <button key={o.id} type="button" className={secondaryButton} onClick={() => onPick(o)}>{o.name} ({o.onHand} {o.unit})</button>)}</div>
        </>
      )}
      {p.status === "ask" && p.needsCount && (
        <>
          <p className="text-bark">{p.question || `How many ${p.options[0].unit} of ${p.options[0].name} (Inventory has ${p.options[0].onHand})?`}</p>
          <div className="mt-2 flex gap-2">
            <input aria-label="How many" type="number" inputMode="numeric" min={1} step={1} value={n} onChange={(e) => setN(e.target.value)} className={`${inputClass} mt-0 w-24`} />
            <button type="button" className={secondaryButton} onClick={() => Number.isInteger(Number(n)) && Number(n) >= 1 ? onCount(Number(n)) : undefined}>Next</button>
          </div>
        </>
      )}
      {p.status === "ready" && (
        <>
          <p className="font-medium text-bark">{p.summary}{c.verb === "move" ? ` to ${c.to}` : ""}?</p>
          {p.lines.map((l) => <p key={l} className="text-bark/70">{l}</p>)}
          <div className="mt-2 flex gap-2">
            <button type="button" className={primaryButton} onClick={onConfirm}>Yes, do it</button>
            <button type="button" className={secondaryButton} onClick={onCancel}>No</button>
          </div>
        </>
      )}
      {p.status !== "ready" && <button type="button" className="mt-2 text-xs text-bark/60 underline" onClick={onCancel}>Dismiss</button>}
    </div>
  );
}

function DraftCard({ d, items, notes, shots, places, onChange, onSave, onUndo }: {
  d: Draft; items: StockItem[]; notes: FoodStore; shots: Shot[]; places: string[];
  onChange: (f: (d: Draft) => Draft) => void; onSave: () => void; onUndo: (a: PantryAction) => void;
}) {
  const plan = planAdd(d.draft, items, notes.list(), shots.map((s) => s.fingerprint), new Date().toISOString());
  const target = d.itemId ? items.find((i) => i.id === d.itemId) ?? null : null;
  const set = (p: Partial<FoodDraft>) => onChange((x) => ({ ...x, draft: { ...x.draft, ...p } }));
  if (typeof d.state === "object" && "done" in d.state) {
    const a = d.state.done;
    return (
      <div className="rounded-2xl border border-sage/40 bg-sage/10 p-4">
        <p className="font-medium text-bark">✓ Saved to Inventory: {a.quantity} {a.unit} of {a.itemName}{a.location ? ` · ${a.location}` : ""}</p>
        {d.draft.amountKnown ? null : <p className="text-sm text-bark/70">Amount not known: Inventory holds it as 1 portion.</p>}
        <button type="button" onClick={() => onUndo(a)} className="mt-1 text-sm text-bark/70 underline">Undo</button>
      </div>
    );
  }
  const dups = typeof d.state === "object" && "duplicates" in d.state && d.state.duplicates ? d.state.duplicates : plan.duplicates;
  return (
    <div className="rounded-2xl border border-clay bg-white/80 p-4">
      <p className="text-xs text-bark/60">You said: “{d.draft.said}”</p>
      <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_5rem_7rem]">
        <input aria-label="Name" value={d.draft.name} onChange={(e) => set({ name: e.target.value })} className={`${inputClass} mt-0`} />
        <input aria-label="How many" type="number" inputMode="numeric" min={1} step={1} value={d.draft.count} onChange={(e) => set({ count: Math.max(1, Math.floor(Number(e.target.value) || 1)), amountKnown: true })} className={`${inputClass} mt-0`} />
        <input aria-label="Unit" value={target?.unit ?? d.draft.unit} disabled={!!target} onChange={(e) => set({ unit: e.target.value })} className={`${inputClass} mt-0`} />
      </div>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <input aria-label="Where" list={`places-${d.key}`} value={d.draft.location} onChange={(e) => set({ location: e.target.value })} placeholder="Where (Freezer, Fridge…)" className={`${inputClass} mt-0`} />
        <label className="text-sm text-bark/70">Best before (optional)
          <input aria-label="Best before" type="date" value={d.bestBefore} onChange={(e) => onChange((x) => ({ ...x, bestBefore: e.target.value }))} className={`${inputClass} mt-0`} />
        </label>
      </div>
      <datalist id={`places-${d.key}`}>{places.map((p) => <option key={p} value={p} />)}</datalist>
      <input aria-label="Notes" value={d.draft.notes} onChange={(e) => set({ notes: e.target.value })} placeholder="Notes (optional)" className={`${inputClass} mt-2`} />

      <ul className="mt-3 space-y-0.5 text-sm text-bark/80">{plan.summary.map((l) => <li key={l}>• {l}</li>)}</ul>
      {d.draft.approximate && d.draft.amountKnown && <p className="mt-1 text-sm text-bark">Inventory holds {d.draft.count} {d.draft.unit}; your words “{d.draft.quantityText}” are kept in the note.</p>}
      {plan.unitMismatch && <p className="mt-1 text-sm text-amber-800">Inventory counts “{plan.existing?.name}” in {plan.unitMismatch}, so this adds {d.draft.count} {plan.unitMismatch}.</p>}
      {plan.similar.length > 0 && (
        <fieldset className="mt-2 text-sm">
          <legend className="text-bark">Is it the same as something Inventory already has?</legend>
          <label className="mr-3"><input type="radio" name={`t-${d.key}`} checked={!d.itemId || d.itemId === plan.existing?.id} onChange={() => onChange((x) => ({ ...x, itemId: plan.existing?.id ?? null }))} /> {plan.existing ? `Yes, ${plan.existing.name}` : "No, it's new"}</label>
          {plan.similar.map((s) => <label key={s.id} className="mr-3"><input type="radio" name={`t-${d.key}`} checked={d.itemId === s.id} onChange={() => onChange((x) => ({ ...x, itemId: s.id }))} /> Add to {s.name} ({s.onHand} {s.unit})</label>)}
        </fieldset>
      )}
      {dups.map((u) => (
        <p key={u.note.id} className="mt-2 rounded-lg bg-butter px-3 py-2 text-sm text-cocoa">
          {u.kind === "photo" ? `This photo is already saved with “${u.note.itemName}”.` : `“${u.note.itemName}” was added to ${u.note.location || "Inventory"} ${u.minutes} minute${u.minutes === 1 ? "" : "s"} ago.`}
          <label className="ml-2"><input type="checkbox" checked={d.allowDuplicate} onChange={(e) => onChange((x) => ({ ...x, allowDuplicate: e.target.checked }))} /> Add anyway</label>
        </p>
      ))}
      <button type="button" disabled={d.state === "saving" || !d.draft.name.trim() || (dups.length > 0 && !d.allowDuplicate)} onClick={onSave} className={`${primaryButton} mt-3 w-full`}>{d.state === "saving" ? "Saving…" : "Save to Inventory"}</button>
      {typeof d.state === "object" && "error" in d.state && !d.state.duplicates && <p role="alert" className="mt-2 text-sm text-red-700">{d.state.error}</p>}
    </div>
  );
}
