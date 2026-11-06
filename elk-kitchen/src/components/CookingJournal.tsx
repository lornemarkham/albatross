import { useEffect, useState } from "react";
import { useKitchen } from "../context/KitchenContext";
import type { CookingSession, MediaRef, SessionEvent } from "../types/cooking";
import { TEMP_LABEL, durationText, qtyText, tempText } from "../lib/cooking/parse";
import { timeOf } from "../lib/cooking/summary";
import { PhotoImg } from "./Photos";

// A stored clip or voice note, loaded by id.
export function MediaView({ media, className = "" }: { media: MediaRef; className?: string }) {
  const { photos } = useKitchen();
  const [url, setUrl] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    if (media.type === "photo") return;
    let revoke: string | null = null, cancelled = false;
    photos.get(media.id).then((b) => {
      if (cancelled) return;
      if (!b) { setUrl(null); return; }
      revoke = URL.createObjectURL(b);
      setUrl(revoke);
    }, () => { if (!cancelled) setUrl(null); });
    return () => { cancelled = true; if (revoke) URL.revokeObjectURL(revoke); };
  }, [media.id, media.type, photos]);
  if (media.type === "photo") return <PhotoImg id={media.id} className={className} />;
  if (url === undefined) return <div className={`h-14 animate-pulse rounded-lg bg-clay/30 ${className}`} />;
  if (url === null) return <p className="rounded-lg bg-clay/20 p-2 text-xs text-bark/60">{media.type === "video" ? "Clip" : "Voice note"} not on this device</p>;
  return media.type === "video"
    ? <video src={url} controls playsInline preload="metadata" className={`w-full rounded-lg bg-black ${className}`} />
    : <audio src={url} controls preload="metadata" className="w-full" />;
}

const ICON: Record<string, string> = {
  started: "▶️", finished: "🏁", ingredient: "🧂", observation: "📝", "next-time": "🔁", tasting: "😋", equipment: "🔧",
  temperature: "🌡️", timer: "⏱", photo: "📷", video: "🎥", voice: "🎙", pantry: "🥫",
};

export function eventLine(e: SessionEvent): { icon: string; title: string; body?: string } | null {
  switch (e.kind) {
    case "started": return { icon: ICON.started, title: "Started cooking" };
    case "finished": return { icon: ICON.finished, title: "Finished" };
    case "ingredient": {
      const verb = { said: "Added", corrected: "Corrected", edited: "Edited", "added-more": "Added more", removed: "Removed" }[e.action];
      return { icon: ICON.ingredient, title: `${verb} ${e.name}`, body: e.action === "said" ? qtyText(e.after) : e.action === "removed" ? `was ${qtyText(e.before)}` : `${qtyText(e.before)} → ${qtyText(e.after)}` };
    }
    case "note": return { icon: ICON[e.category], title: { observation: "Note", "next-time": "Next time", tasting: "Tasting", equipment: "Equipment" }[e.category], body: e.text };
    case "temperature": return { icon: ICON.temperature, title: TEMP_LABEL[e.what], body: tempText(e.value, e.unit) };
    case "timer": return e.action === "started" ? { icon: ICON.timer, title: `Timer started: ${e.label}`, body: durationText(e.seconds) } : { icon: ICON.timer, title: `Timer ${e.action === "done" ? "done" : "cancelled"}: ${e.label}` };
    case "media": return { icon: ICON[e.media.type], title: e.media.finished ? `Finished ${{ photo: "photo", video: "clip", voice: "voice note" }[e.media.type]}` : { photo: "Photo", video: "Clip", voice: "Voice note" }[e.media.type], body: e.media.caption || undefined };
    case "pantry": {
      const a = e.action;
      return { icon: ICON.pantry, title: a.kind === "used" ? `Used from Pantry: ${a.quantity} ${a.unit} ${a.itemName}` : `Put in Pantry: ${a.quantity} ${a.unit} ${a.itemName}`, body: `${a.lotLabel}${a.undone ? " · undone" : ""}` };
    }
  }
}

// The whole session as a timeline: what happened, when, with the media inline.
export function CookingJournal({ session, compact = false }: { session: CookingSession; compact?: boolean }) {
  const events = compact ? session.events.slice(-6).reverse() : session.events;
  if (!events.length) return null;
  return (
    <ol className="relative space-y-3 border-l-2 border-clay pl-5">
      {events.map((e) => {
        const l = eventLine(e);
        if (!l) return null;
        return (
          <li key={e.id} className="relative">
            <span aria-hidden className="absolute -left-[1.95rem] top-0 flex h-7 w-7 items-center justify-center rounded-full border border-clay bg-cream text-sm">{l.icon}</span>
            <p className="text-sm text-bark"><span className="mr-2 font-mono text-xs text-bark/50">{timeOf(e.at)}</span><span className="font-semibold">{l.title}</span></p>
            {l.body && <p className="mt-0.5 whitespace-pre-wrap text-sm text-bark/80">{l.body}</p>}
            {e.kind === "media" && !compact && <div className={`mt-2 ${e.media.type === "photo" ? "max-w-xs" : "max-w-md"}`}><MediaView media={e.media} className={e.media.type === "photo" ? "aspect-square w-full rounded-xl" : ""} /></div>}
          </li>
        );
      })}
    </ol>
  );
}

// The original words, exactly as heard or typed, with what Kitchen made of them.
export function Transcript({ session }: { session: CookingSession }) {
  if (!session.transcript.length) return <p className="text-sm text-bark/60">Nothing was said or typed.</p>;
  return (
    <ol className="space-y-2">
      {session.transcript.map((l) => (
        <li key={l.id} className="rounded-xl border border-clay bg-white/70 px-3 py-2">
          <p className="text-sm text-bark"><span className="mr-2 font-mono text-xs text-bark/50">{timeOf(l.at)}</span>{l.source === "typed" ? "⌨️" : "🎤"} “{l.text}”</p>
          {l.understood && <p className="mt-0.5 text-xs text-sage">→ {l.understood}</p>}
        </li>
      ))}
    </ol>
  );
}
