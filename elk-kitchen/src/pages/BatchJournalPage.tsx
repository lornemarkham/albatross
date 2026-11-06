import type { ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { useKitchen } from "../context/KitchenContext";
import { useLoad } from "../lib/useLoad";
import { CookingJournal, MediaView, Transcript } from "../components/CookingJournal";
import { PhotoGallery } from "../components/Photos";
import { DetailsSummary, SafetyNotes } from "../components/MeatFields";
import { pantryReceipts } from "../components/PantryUse";
import { safetyChecks } from "../lib/meat";
import { clock } from "../lib/cooking/parse";
import { sectionLabel } from "../components/ui";
import { StartCookingButton } from "./StartCookingPage";

// One batch, everything that was kept about it: the summary, the timeline
// with photos, clips and voice notes, the transcript, and Pantry changes.
export function BatchJournalPage() {
  const { id = "", entryId = "" } = useParams<{ id: string; entryId: string }>();
  const { store } = useKitchen();
  const { data, error } = useLoad(() => store.getRecipe(id), [store, id]);
  if (error) return <Message>{error}</Message>;
  if (data === undefined) return <Message>Loading…</Message>;
  const e = data?.entries.find((x) => x.id === entryId);
  if (!data || !e) return <Message>That batch isn't here.</Message>;
  const { recipe } = data;
  const s = e.session ?? null;
  const media = s ? s.events.flatMap((x) => (x.kind === "media" && x.media.type !== "photo" ? [x.media] : [])) : [];
  const finished = s ? s.events.flatMap((x) => (x.kind === "media" && x.media.finished ? [x.media] : [])) : [];
  const receipts = s ? pantryReceipts(s) : [];

  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <Link to={`/recipe/${encodeURIComponent(recipe.id)}`} className="text-sm font-medium text-sage hover:underline">← {recipe.title}</Link>
      <h1 className="mt-3 font-display text-3xl font-bold text-bark">{e.cookedOn || "Date unknown"}{e.cookName && <span className="font-normal text-bark/60"> · {e.cookName}</span>}</h1>
      <p className="mt-1 text-bark/70">
        {recipe.title}{e.rating != null && ` · ★ ${e.rating}/10`}
        {s?.endedAt && ` · cooked for ${clock((Date.parse(s.endedAt) - Date.parse(s.startedAt)) / 1000)}`}
      </p>

      {finished[0] && <div className="mt-4 overflow-hidden rounded-2xl"><MediaView media={finished[0]} className="aspect-[4/3] w-full" /></div>}

      <Section title="Summary">
        {recipe.kind !== "general" && <div className="mb-3"><DetailsSummary kind={recipe.kind} d={e.details} /><div className="mt-2"><SafetyNotes notes={safetyChecks(recipe.kind, e.details)} /></div></div>}
        <dl className="space-y-3 text-sm">
          {([["What went in", e.ingredientsUsed], ["Equipment", e.equipment], ["Temperatures & times", e.timesAndTemps], ["Finished yield", e.yieldNote],
            ["Tasting notes", e.tastingNotes], ["Substitutions & changes", e.substitutions], ["Family reaction", e.familyReaction], ["Next time", e.improveNextTime], ["Notes", e.notes]] as const)
            .filter(([, v]) => v.trim()).map(([k, v]) => (
              <div key={k}><dt className="text-xs font-semibold text-sage">{k}</dt><dd className="whitespace-pre-wrap text-bark">{v}</dd></div>
            ))}
        </dl>
      </Section>

      {e.photos.length > 0 && <Section title="Photos"><PhotoGallery photos={e.photos} /></Section>}
      {media.length > 0 && (
        <Section title="Clips & voice notes">
          <ul className="space-y-3">{media.map((m) => <li key={m.id}><MediaView media={m} /></li>)}</ul>
        </Section>
      )}

      {receipts.length > 0 && (
        <Section title="ELK Pantry">
          <ul className="space-y-1 text-sm">
            {receipts.map((a) => <li key={a.requestId} className={a.undone ? "text-bark/50 line-through" : "text-bark"}>{a.kind === "used" ? "Used" : "Added"} {a.quantity} {a.unit} · {a.itemName} <span className="text-bark/60">({a.lotLabel})</span></li>)}
          </ul>
          <p className="mt-2 text-xs text-bark/60">Stock and its history live in ELK Inventory. Change them there from now on.</p>
        </Section>
      )}

      {s ? (
        <>
          <Section title="Cooking journal"><CookingJournal session={s} /></Section>
          <Section title="Transcript (as heard)"><Transcript session={s} /></Section>
        </>
      ) : (
        <p className="mt-6 text-sm text-bark/60">This batch was recorded by hand, without a cooking session.</p>
      )}

      {!recipe.removedAt && <div className="mt-8"><StartCookingButton recipe={recipe} /></div>}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-5 rounded-2xl border border-clay bg-cream p-5 shadow-sm">
      <h2 className={`${sectionLabel} mb-3`}>{title}</h2>
      {children}
    </section>
  );
}

function Message({ children }: { children: ReactNode }) {
  return <div className="mx-auto max-w-2xl px-4 py-12 text-center text-bark/70">{children}<p><Link to="/" className="mt-4 inline-block text-sage underline">Back to recipes</Link></p></div>;
}
