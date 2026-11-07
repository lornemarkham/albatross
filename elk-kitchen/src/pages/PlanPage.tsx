import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useKitchen } from "../context/KitchenContext";
import { useLoad } from "../lib/useLoad";
import { usePantry } from "../lib/usePantry";
import { addToShoppingList } from "../lib/pantry";
import { mentions } from "../lib/pantryCheck";
import { supabase } from "../lib/supabase";
import { newSession } from "../lib/cooking/session";
import { useDrafts } from "../lib/cooking/useCookingSession";
import {
  approve, blankPurchase, costPerUsableKg, costsFor, fatOf, gramsText, leftoverOf, money, neededItems, newPlan, parsePurchases,
  planProblems, planRecipe, suggestSplit, usableOf, type RecipePlan,
} from "../lib/sausage/plan";
import { cutOf } from "../lib/sausage/cuts";
import { PlanStore, loadPrefs, savePrefs } from "../lib/sausage/preferences";
import { inputClass, primaryButton, secondaryButton, sectionLabel } from "../components/ui";
import type { Recipe, RecipeSummary } from "../types/recipe";
import type { Preferences, Purchase, SausagePlan } from "../types/sausage";

const usePlans = () => useMemo(() => new PlanStore(window.localStorage), []);
const kg = (g: number | null) => (g == null ? "" : String(Math.round(g) / 1000));
const toG = (v: string) => { const n = Number(v.replace(",", ".")); return v.trim() && Number.isFinite(n) && n >= 0 ? Math.round(n * 1000) : null; };
const num = (v: string) => { const n = Number(v.replace(",", ".")); return v.trim() && Number.isFinite(n) ? n : null; };
const isSausageish = (r: Recipe) => r.kind === "sausage" || /sausage|brat|smok|wurst|kielbasa|chorizo/i.test(`${r.category} ${r.title}`);

// Sausage day: what you bought + your sausage recipes → a plan you approve →
// one cooking session per recipe. Kept on this device; recipes and Pantry's
// stock are never changed from here.
export function PlanPage() {
  const { id } = useParams<{ id: string }>();
  const plans = usePlans();
  const navigate = useNavigate();
  if (!id) {
    const all = plans.list();
    return (
      <div className="mx-auto max-w-2xl px-4 py-6">
        <Link to="/" className="text-sm font-medium text-sage hover:underline">← Kitchen</Link>
        <h1 className="mt-3 font-display text-3xl font-bold text-bark">Cook with what I bought</h1>
        <p className="mt-1 text-bark/70">Tell Kitchen what meat you have and which sausage recipes you're making. It splits the meat, checks the fat, works out every seasoning in grams for the real weight, lists what's missing and adds up the cost. Nothing happens until you approve the plan. Your recipes stay exactly as written.</p>
        <button type="button" className={`${primaryButton} mt-5 w-full`} onClick={() => { const p = newPlan(new Date().toISOString(), `Sausage day ${new Date().toLocaleDateString()}`); plans.put(p); navigate(`/plan/${p.id}`); }}>
          Start a new plan
        </button>
        {all.length > 0 && (
          <ul className="mt-6 space-y-2">
            {all.map((p) => (
              <li key={p.id}>
                <Link to={`/plan/${p.id}`} className="block rounded-2xl border border-clay bg-cream p-4">
                  <span className="font-semibold text-bark">{p.title}</span>
                  <span className="block text-sm text-bark/60">{p.status === "approved" ? "Approved" : "Draft"} · {p.purchases.length} purchases · {p.recipeIds.length} recipes</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }
  return <PlanEditor id={id} />;
}

function PlanEditor({ id }: { id: string }) {
  const { store, myName, member } = useKitchen();
  const plans = usePlans();
  const drafts = useDrafts();
  const navigate = useNavigate();
  const { pantry } = usePantry();
  const { data: recipes, error } = useLoad(() => store.listRecipes(), [store]);
  const [plan, setPlanState] = useState<SausagePlan | null>(() => plans.get(id));
  const [prefs, setPrefsState] = useState<Preferences>(() => loadPrefs(window.localStorage));
  const [paste, setPaste] = useState("");
  const [shopMsg, setShopMsg] = useState("");
  const [showAll, setShowAll] = useState(false);

  useEffect(() => { savePrefs(window.localStorage, prefs); }, [prefs]);

  if (!plan) return <div className="p-8 text-center text-bark/70">That plan isn't on this device. <Link to="/plan" className="text-sage underline">Plans</Link></div>;

  // Every change is saved at once. Changing meat or recipes after approval needs approving again.
  const setPlan = (f: (p: SausagePlan) => SausagePlan, reopen = true) => {
    setPlanState((p) => {
      if (!p) return p;
      let next = { ...f(p), updatedAt: new Date().toISOString() };
      if (reopen && p.status === "approved") next = { ...next, status: "draft" };
      plans.put(next);
      return next;
    });
  };
  const setPurchase = (pid: string, patch: Partial<Purchase>) => setPlan((p) => ({ ...p, purchases: p.purchases.map((x) => (x.id === pid ? { ...x, ...patch } : x)) }));

  const byId = new Map((recipes ?? []).map((r) => [r.id, r]));
  const chosen = plan.recipeIds.map((rid) => byId.get(rid)).filter((r): r is RecipeSummary => !!r);
  const rplans: RecipePlan[] = chosen.map((r) => planRecipe(r, plan.purchases, plan.alloc[r.id] ?? {}));
  const problems = planProblems(plan);
  const needed = neededItems(rplans);
  const pantryItems = pantry && pantry !== "off" && pantry.status === "ready" ? pantry.items : null;
  const candidates = (recipes ?? []).filter((r) => showAll || isSausageish(r));
  const totalBought = plan.purchases.reduce((n, p) => n + (p.weightG ?? 0), 0);
  const totalPaid = plan.purchases.reduce((n, p) => n + (p.price ?? 0), 0);

  function split() {
    const s = suggestSplit(plan!.purchases, chosen);
    setPlan((p) => ({ ...p, alloc: s.alloc }));
  }

  function startCook(r: Recipe) {
    const existing = plan!.sessions[r.id];
    if (existing && drafts.get(existing)) { navigate(`/cook/${encodeURIComponent(existing)}`); return; }
    const s = newSession({ recipe: r, cookName: myName, now: new Date().toISOString(), plan: plan!.snapshots[r.id] });
    drafts.put(s);
    setPlan((p) => ({ ...p, sessions: { ...p.sessions, [r.id]: s.id } }), false);
    navigate(`/cook/${encodeURIComponent(s.id)}`);
  }

  const toBuy = needed.filter((n) => !plan.have.includes(n.name.toLowerCase()));
  async function shop() {
    setShopMsg("");
    if (!supabase || !member) {
      try { await navigator.clipboard.writeText(toBuy.map((n) => n.name).join("\n")); setShopMsg("Copied the list. (Pantry's shopping list needs the family sign-in, which this copy of Kitchen isn't connected to yet.)"); }
      catch { setShopMsg("Pantry's shopping list needs the family sign-in. Write these down for now."); }
      return;
    }
    const r = await addToShoppingList(supabase, toBuy.map((n) => n.name), "", `for ${plan!.title}`);
    setShopMsg(r.ok ? `Added ${r.added} to Pantry's shopping list (anything already on it was skipped).` : r.error);
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 pb-24">
      <Link to="/plan" className="text-sm font-medium text-sage hover:underline">← Plans</Link>
      <input value={plan.title} onChange={(e) => setPlan((p) => ({ ...p, title: e.target.value.slice(0, 120) }), false)} aria-label="Plan name"
        className="mt-2 w-full bg-transparent font-display text-3xl font-bold text-bark focus:outline-none" />
      <p className={`mt-1 inline-block rounded-full px-3 py-1 text-sm font-semibold ${plan.status === "approved" ? "bg-sage text-white" : "bg-butter text-cocoa"}`}>
        {plan.status === "approved" ? `Approved ${plan.approvedAt ? new Date(plan.approvedAt).toLocaleString([], { hour: "2-digit", minute: "2-digit", weekday: "short" }) : ""}` : "Draft — nothing is final until you approve"}
      </p>

      <details className="mt-5 rounded-2xl border border-clay bg-cream p-4">
        <summary className="cursor-pointer font-semibold text-bark">Your preferences {prefs.grind || prefs.plate ? `· ${[prefs.grind && `${prefs.grind} grind`, prefs.plate, prefs.seasoningsInGrams && "grams"].filter(Boolean).join(", ")}` : "· not set"}</summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-sm text-bark">Grind
            <select aria-label="Grind" value={prefs.grind} onChange={(e) => setPrefsState({ ...prefs, grind: e.target.value as Preferences["grind"] })} className={inputClass}>
              <option value="">Not set</option><option value="coarse">Coarse</option><option value="medium">Medium</option><option value="fine">Fine</option>
            </select>
          </label>
          <label className="text-sm text-bark">Grinder plate
            <input aria-label="Grinder plate" value={prefs.plate} onChange={(e) => setPrefsState({ ...prefs, plate: e.target.value })} placeholder="e.g. large plate (10 mm)" className={inputClass} />
          </label>
          <label className="flex items-center gap-2 text-sm text-bark sm:col-span-2">
            <input type="checkbox" checked={prefs.seasoningsInGrams} onChange={(e) => setPrefsState({ ...prefs, seasoningsInGrams: e.target.checked })} className="h-5 w-5" />
            I weigh seasonings in grams
          </label>
          <label className="text-sm text-bark sm:col-span-2">What you're aiming for
            <input value={prefs.goals} onChange={(e) => setPrefsState({ ...prefs, goals: e.target.value })} placeholder="e.g. reproduce and improve my old recipes" className={inputClass} />
          </label>
        </div>
        <p className="mt-2 text-xs text-bark/60">Kept on this phone. Used in the cooking helper's advice.</p>
      </details>

      <section className="mt-6">
        <h2 className={sectionLabel}>1 · What you bought</h2>
        <textarea value={paste} onChange={(e) => setPaste(e.target.value)} rows={3} className={inputClass}
          placeholder={"One per line, as on the label:\nPork butt 3.705 kg $31.45\nChicken thighs bone-in skin-on 2.62 kg $32.20"} />
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" disabled={!paste.trim()} className={secondaryButton} onClick={() => { const ps = parsePurchases(paste); setPlan((p) => ({ ...p, purchases: [...p.purchases, ...ps] })); setPaste(""); }}>Add these</button>
          <button type="button" className={secondaryButton} onClick={() => setPlan((p) => ({ ...p, purchases: [...p.purchases, blankPurchase()] }))}>+ One by hand</button>
        </div>
        <p className="mt-1 text-xs text-bark/60">Kitchen fills in only what you wrote. A missing weight or price stays blank.</p>
        <ul className="mt-3 space-y-3">
          {plan.purchases.map((p) => <PurchaseRow key={p.id} p={p} plan={plan} onChange={(patch) => setPurchase(p.id, patch)} />)}
        </ul>
        {plan.purchases.length > 0 && <p className="mt-2 text-sm text-bark/70">Bought: {gramsText(totalBought)} ({(totalBought / 453.592).toFixed(1)} lb) · {money(totalPaid)}</p>}
      </section>

      <section className="mt-8">
        <h2 className={sectionLabel}>2 · What you're making</h2>
        {error ? <p className="text-red-700">{error}</p> : !recipes ? <p className="text-bark/60">Loading…</p> : (
          <>
            <div className="mt-2 flex flex-wrap gap-2">
              {candidates.map((r) => {
                const on = plan.recipeIds.includes(r.id);
                return (
                  <button key={r.id} type="button" aria-pressed={on}
                    onClick={() => setPlan((p) => ({ ...p, recipeIds: on ? p.recipeIds.filter((x) => x !== r.id) : [...p.recipeIds, r.id] }))}
                    className={`min-h-12 rounded-full border px-4 text-base font-semibold ${on ? "border-sage bg-sage text-white" : "border-clay bg-cream text-bark"}`}>
                    {on ? "✓ " : ""}{r.title}
                  </button>
                );
              })}
            </div>
            <p className="mt-2 text-sm text-bark/70">
              {candidates.length === 0 && "No sausage recipes yet. "}
              <Link to="/add?kind=sausage" className="text-sage underline">Type a recipe</Link>
              {member && <> · <Link to="/add/photo" className="text-sage underline">Photograph a handwritten recipe</Link></>}
              {" · "}<button type="button" className="text-sage underline" onClick={() => setShowAll((v) => !v)}>{showAll ? "Sausage recipes only" : "Show all recipes"}</button>
            </p>
            <p className="mt-1 text-xs text-bark/60">For the best plan, each recipe should have its meat (with weights, like “2 lb pork tenderloin”), its target fat % and its seasoning amounts.</p>
          </>
        )}
      </section>

      {chosen.length > 0 && plan.purchases.length > 0 && (
        <section className="mt-8">
          <div className="flex items-center justify-between gap-2">
            <h2 className={sectionLabel}>3 · The plan</h2>
            <button type="button" className={secondaryButton} onClick={split}>Suggest a split</button>
          </div>
          <ul className="mt-2 space-y-1 text-sm text-bark/80">
            {plan.purchases.map((p) => { const left = leftoverOf(plan, p); return left !== 0 && usableOf(p).g ? <li key={p.id} className={left < 0 ? "font-semibold text-red-700" : ""}>{p.name}: {left > 0 ? `${gramsText(left)} not in any recipe yet` : `${gramsText(-left)} more planned than there is`}</li> : null; })}
          </ul>
          <div className="mt-3 space-y-4">
            {rplans.map((rp) => <RecipeCard key={rp.recipe.id} rp={rp} plan={plan} prefs={prefs}
              setAlloc={(pid, g) => setPlan((p) => ({ ...p, alloc: { ...p.alloc, [rp.recipe.id]: { ...(p.alloc[rp.recipe.id] ?? {}), [pid]: g } } }))}
              setResult={(patch) => setPlan((p) => ({ ...p, results: { ...p.results, [rp.recipe.id]: { ...(p.results[rp.recipe.id] ?? { finishedG: null, count: null, servings: null }), ...patch } } }), false)}
              onCook={() => startCook(rp.recipe)} />)}
          </div>
        </section>
      )}

      {needed.length > 0 && (
        <section className="mt-8 rounded-2xl border border-clay bg-cream p-4">
          <h2 className={sectionLabel}>4 · Do you have everything?</h2>
          <ul className="mt-2 space-y-1">
            {needed.map((n) => {
              const k = n.name.toLowerCase();
              const p = pantryItems?.find((x) => mentions(x.name, n.name)) ?? null;
              return (
                <li key={k}>
                  <label className="flex min-h-11 items-center gap-3 text-bark">
                    <input type="checkbox" className="h-6 w-6" checked={plan.have.includes(k)} onChange={(e) => setPlan((pl) => ({ ...pl, have: e.target.checked ? [...pl.have, k] : pl.have.filter((x) => x !== k) }), false)} />
                    <span className="flex-1">{n.name} <span className="text-xs text-bark/55">for {n.for.join(", ")}</span>
                      {pantryItems && <span className="block text-xs text-bark/60">{p ? (p.onHand > 0 ? `✓ Pantry shows ${p.onHand} ${p.unit}` : "Pantry shows none left") : "Pantry has no record — check the cupboard"}</span>}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
          <p className="mt-1 text-xs text-bark/60">Tick what you have. Kitchen doesn't know amounts on hand for seasonings unless Pantry does.</p>
          {toBuy.length > 0 && <button type="button" className={`${secondaryButton} mt-3`} onClick={shop}>You're missing {toBuy.length}: {member && supabase ? "add them to Pantry's shopping list" : "copy the list"}</button>}
          {shopMsg && <p role="status" className="mt-2 text-sm text-bark">{shopMsg}</p>}
        </section>
      )}

      {chosen.length > 0 && plan.purchases.length > 0 && (
        <section className="mt-8">
          {problems.length > 0 && <ul className="mb-3 list-disc rounded-xl border border-red-200 bg-red-50 py-2 pl-8 pr-3 text-sm text-red-800">{problems.map((p) => <li key={p}>{p}</li>)}</ul>}
          {plan.status !== "approved" ? (
            <button type="button" disabled={problems.length > 0 || rplans.every((r) => !r.meatG)} className={`${primaryButton} w-full py-4 text-lg`}
              onClick={() => setPlan((p) => approve(p, rplans, prefs, myName || "this phone", new Date().toISOString()), false)}>
              Approve this plan
            </button>
          ) : <p className="rounded-xl bg-sage/10 p-3 text-sm text-bark">Approved. Tap <b>Cook this</b> on a recipe to start its cooking helper. Changing the meat or recipes will ask you to approve again.</p>}
        </section>
      )}
    </div>
  );
}

function PurchaseRow({ p, plan, onChange }: { p: Purchase; plan: SausagePlan; onChange: (patch: Partial<Purchase>) => void }) {
  const u = usableOf(p);
  const f = fatOf(p);
  const cut = cutOf(p.name);
  const cpk = costPerUsableKg(p);
  return (
    <li className="rounded-2xl border border-clay bg-white p-3">
      <input value={p.name} onChange={(e) => onChange({ name: e.target.value })} placeholder="What is it? e.g. Pork butt" aria-label="Name" className={`${inputClass} mt-0 font-semibold`} />
      <div className="mt-2 grid grid-cols-3 gap-2">
        <label className="text-xs text-bark/70">Bought (kg)<input inputMode="decimal" defaultValue={kg(p.weightG)} onBlur={(e) => onChange({ weightG: toG(e.target.value) })} className={inputClass} placeholder="weight?" /></label>
        <label className="text-xs text-bark/70">Price ($)<input inputMode="decimal" defaultValue={p.price ?? ""} onBlur={(e) => onChange({ price: num(e.target.value) })} className={inputClass} placeholder="—" /></label>
        <label className="text-xs text-bark/70">Fat %<input inputMode="decimal" defaultValue={p.fatPercent ?? ""} onBlur={(e) => onChange({ fatPercent: num(e.target.value) })} className={inputClass} placeholder={`≈ ${f.pct}`} /></label>
      </div>
      <div className="mt-2 flex flex-wrap gap-4 text-sm text-bark">
        <label className="flex items-center gap-2"><input type="checkbox" className="h-5 w-5" checked={p.boneIn === true} onChange={(e) => onChange({ boneIn: e.target.checked })} /> Bone-in</label>
        <label className="flex items-center gap-2"><input type="checkbox" className="h-5 w-5" checked={p.skinOn === true} onChange={(e) => onChange({ skinOn: e.target.checked })} /> Skin-on</label>
      </div>
      <label className="mt-2 block text-xs text-bark/70">Usable meat, weighed after trimming / boning (kg)
        <input inputMode="decimal" defaultValue={kg(p.usableG)} onBlur={(e) => onChange({ usableG: toG(e.target.value) })} className={inputClass} placeholder={u.g ? `not weighed — estimate ${kg(u.g)}` : "weigh it"} />
      </label>
      <p className="mt-1 text-xs text-bark/60">
        {u.measured ? `Usable: ${gramsText(u.g!)} (weighed${u.pct ? `, ${Math.round(u.pct)}% of bought` : ""}).` : u.g ? `Usable: about ${gramsText(u.g)} — an estimate (${gramsText(u.range![0])}–${gramsText(u.range![1])}). ${cut.note} Weigh it to replace the estimate.` : "Add the weight from the label."}
        {" "}{f.estimated ? `Fat ≈ ${f.pct}% (typical for ${cut.label.toLowerCase()}, ${f.range![0]}–${f.range![1]}%; an estimate).` : `Fat ${f.pct}% (yours).`}
        {cpk != null && ` ${money(cpk, p.currency)}/kg usable.`}
        {plan.status === "approved" && " · Editing will ask you to approve again."}
      </p>
    </li>
  );
}

function RecipeCard({ rp, plan, prefs, setAlloc, setResult, onCook }: {
  rp: RecipePlan; plan: SausagePlan; prefs: Preferences;
  setAlloc: (purchaseId: string, g: number) => void; setResult: (patch: Partial<{ finishedG: number | null; count: number | null; servings: number | null }>) => void; onCook: () => void;
}) {
  const res = plan.results[rp.recipe.id];
  const c = costsFor(rp, res);
  const approved = plan.status === "approved";
  return (
    <article className="rounded-2xl border border-clay bg-cream p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="font-display text-xl font-bold text-bark">{rp.recipe.title}</h3>
          <p className="text-sm text-bark/70">{gramsText(rp.meatG)} meat{rp.measured ? " (weighed)" : rp.meatG ? " (planned — weigh before seasoning)" : ""} · {rp.kind === "fresh" ? "Fresh" : rp.kind === "smoked" ? "Smoked, no cure" : rp.kind === "cured" ? "Cured" : "Fermented"}{rp.poultry ? " · contains chicken" : ""}</p>
        </div>
        <Link to={`/recipe/${encodeURIComponent(rp.recipe.id)}`} className="shrink-0 text-sm text-sage underline">Original</Link>
      </div>

      <table className="mt-3 w-full text-sm">
        <tbody>
          {plan.purchases.filter((p) => usableOf(p).g).map((p) => (
            <tr key={p.id} className="border-t border-clay/50">
              <td className="py-1.5 pr-2 text-bark">{p.name}</td>
              <td className="w-28 py-1"><input inputMode="decimal" key={`${p.id}-${plan.alloc[rp.recipe.id]?.[p.id] ?? 0}`} defaultValue={kg(plan.alloc[rp.recipe.id]?.[p.id] ?? 0)} aria-label={`${p.name} for ${rp.recipe.title}, kg`}
                onBlur={(e) => setAlloc(p.id, toG(e.target.value) ?? 0)} className="w-full rounded-lg border border-clay bg-white px-2 py-2 text-right text-base" /></td>
              <td className="pl-1 text-bark/60">kg</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rp.substitutions.map((s) => <p key={s} className="mt-2 text-sm text-bark"><b>Adapted:</b> {s}</p>)}
      {rp.fatAdvice && <p className="mt-2 text-sm text-bark">🥓 {rp.fatAdvice}</p>}

      {rp.seasonings.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-sage">Weigh out {rp.measured ? "" : "(for the planned weight — the cooking helper redoes this when you say the real weight)"}</p>
          <ul className="mt-1 divide-y divide-clay/40">
            {rp.seasonings.map(({ s, text }) => (
              <li key={s.raw} className="flex items-baseline justify-between gap-3 py-1.5">
                <span className="text-bark">{s.name}{s.cure && " ⚠"}<span className="block text-xs text-bark/50">recipe: “{s.raw}”</span></span>
                <span className="shrink-0 text-lg font-bold tabular-nums text-bark">{text || <span className="text-sm font-normal text-bark/50">no amount</span>}
                  {text && s.basis === "volume" && prefs.seasoningsInGrams && <span className="block text-xs font-normal text-bark/55">by volume — weigh once</span>}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {rp.unscaled && <p className="mt-2 rounded-lg bg-butter p-2 text-sm text-cocoa">{rp.unscaled}</p>}
      {rp.casing && <p className="mt-2 text-sm text-bark">Casing: {rp.casing}</p>}

      <ul className="mt-3 space-y-1">
        {rp.safety.map((s) => <li key={s.text} className={`rounded-lg px-2 py-1 text-sm ${s.level === "warn" ? "bg-red-50 text-red-800" : "bg-white text-bark/80"}`}>{s.level === "warn" ? "⚠ " : "🛡 "}{s.text}</li>)}
      </ul>

      <div className="mt-3 rounded-xl bg-white p-3 text-sm text-bark">
        <p><b>Meat cost:</b> {money(c.meatCost)}{c.perKg != null && ` · ${money(c.perKg)}/kg (${c.perKgBasis})`}{c.perSausage != null && ` · ${money(c.perSausage)} per sausage`}{c.perServing != null && ` · ${money(c.perServing)} per serving`}</p>
        <p className="text-xs text-bark/55">Seasonings and casings aren't counted. Add the finished numbers after cooking for real costs.</p>
        <div className="mt-2 grid grid-cols-3 gap-2">
          <label className="text-xs text-bark/70">Finished (kg)<input inputMode="decimal" defaultValue={kg(res?.finishedG ?? null)} onBlur={(e) => setResult({ finishedG: toG(e.target.value) })} className={inputClass} /></label>
          <label className="text-xs text-bark/70">Sausages<input inputMode="numeric" defaultValue={res?.count ?? ""} onBlur={(e) => setResult({ count: num(e.target.value) })} className={inputClass} /></label>
          <label className="text-xs text-bark/70">Servings<input inputMode="numeric" defaultValue={res?.servings ?? ""} onBlur={(e) => setResult({ servings: num(e.target.value) })} className={inputClass} /></label>
        </div>
      </div>

      {approved && plan.snapshots[rp.recipe.id] && (
        <button type="button" onClick={onCook} className="mt-4 flex min-h-16 w-full items-center justify-center gap-3 rounded-2xl bg-tomato text-xl font-bold text-white shadow-md">
          <span aria-hidden>🎤</span> {plan.sessions[rp.recipe.id] ? "Back to cooking" : "Cook this"}
        </button>
      )}
    </article>
  );
}
