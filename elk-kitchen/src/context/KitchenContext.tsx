import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import { classifyAccess } from "../lib/familyAccess";
import { DeviceRecipeStore, type RecipeStore } from "../lib/recipeStorage";
import { SharedRecipeStore, sharedTablesReady } from "../lib/sharedRecipeStore";
import { IndexedDbPhotoStore, SharedPhotoStore, requestPersistence, type PhotoStore } from "../lib/photos";
import { LoginPage } from "../pages/LoginPage";
import { DownloadDeviceExport } from "../components/DownloadDeviceExport";
import { OfflineBoard } from "../components/KitchenPanels";
import { readSnapshot } from "../lib/home/snapshot";

type Kitchen = {
  store: RecipeStore;
  // Where photo bytes go: this device (IndexedDB) or the family bucket.
  photos: PhotoStore;
  // Always this browser's own storage — for exporting/importing what's here.
  deviceStore: DeviceRecipeStore;
  myName: string;
  email: string | null;
  // Why recipes are on this device only (null when they're shared).
  notice: "not-connected" | "shared-off" | null;
  // Signed in and confirmed on the ELK family list (by the database). Reading
  // recipe photos and ELK Pantry need this; both are re-checked server-side.
  member: boolean;
  signOut: (() => void) | null;
};

const KitchenContext = createContext<Kitchen | null>(null);

export function useKitchen(): Kitchen {
  const k = useContext(KitchenContext);
  if (!k) throw new Error("useKitchen outside KitchenProvider");
  return k;
}

type Phase =
  | { kind: "loading" }
  | { kind: "signed-out" }
  | { kind: "not-member"; email: string }
  | { kind: "error"; error: string }
  | { kind: "ready"; kitchen: Omit<Kitchen, "deviceStore" | "photos"> };

export function KitchenProvider({ children }: { children: ReactNode }) {
  const deviceStore = useMemo(() => new DeviceRecipeStore(window.localStorage), []);
  const devicePhotos = useMemo(() => new IndexedDbPhotoStore(), []);
  useEffect(() => { requestPersistence(); }, []);
  const [user, setUser] = useState<User | null | undefined>(supabase ? undefined : null);
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const readyStore = phase.kind === "ready" ? phase.kitchen.store : null;
  const photos = useMemo<PhotoStore>(
    () => (readyStore?.mode === "family" && supabase ? new SharedPhotoStore(supabase) : devicePhotos),
    [readyStore, devicePhotos]);
  const [attempt, setAttempt] = useState(0);
  // Back online after failing to check access: check again rather than
  // leaving the wall on an error. (A working session is left alone.)
  const failed = phase.kind === "error";
  useEffect(() => {
    if (!failed) return;
    const again = () => setAttempt((n) => n + 1);
    window.addEventListener("online", again);
    return () => window.removeEventListener("online", again);
  }, [failed]);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data: { session } }) => setUser(session?.user ?? null));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => setUser(session?.user ?? null));
    return () => subscription.unsubscribe();
  }, []);

  const userId = user?.id;
  const email = user?.email ?? null;
  useEffect(() => {
    const client = supabase;
    if (!client) {
      setPhase({ kind: "ready", kitchen: { store: deviceStore, myName: "", email: null, notice: "not-connected", member: false, signOut: null } });
      return;
    }
    if (user === undefined) return;
    if (!userId) { setPhase({ kind: "signed-out" }); return; }

    let cancelled = false;
    const signOut = () => { client.auth.signOut(); };
    setPhase({ kind: "loading" });
    (async () => {
      const { data, error } = await client.rpc("elk_is_family_member");
      const access = classifyAccess(data, error);
      let next: Phase;
      if (access.status === "not-member") next = { kind: "not-member", email: email ?? "" };
      else if (access.status === "error") next = { kind: "error", error: access.error };
      else if (access.status === "not-set-up") {
        next = { kind: "ready", kitchen: { store: deviceStore, myName: "", email, notice: "shared-off", member: false, signOut } };
      } else {
        const tables = await sharedTablesReady(client);
        if (tables === "ready") {
          const store = new SharedRecipeStore(client, userId);
          const myName = await store.myName();
          next = { kind: "ready", kitchen: { store, myName, email, notice: null, member: true, signOut } };
        } else if (tables === "not-set-up") {
          next = { kind: "ready", kitchen: { store: deviceStore, myName: "", email, notice: "shared-off", member: true, signOut } };
        } else {
          next = { kind: "error", error: tables.error };
        }
      }
      if (!cancelled) setPhase(next);
    })();
    return () => { cancelled = true; };
  }, [userId, user === undefined, attempt, deviceStore]);

  if (phase.kind === "loading") {
    return <Centered><p className="text-bark/70">Loading…</p></Centered>;
  }
  if (phase.kind === "signed-out") return <LoginPage />;
  // No internet, so access can't be checked: show what this screen last saw
  // (read-only, timed), never anything new, and nothing can change.
  const offlineSnap = phase.kind === "error" && !navigator.onLine ? readSnapshot(window.localStorage) : null;
  if (offlineSnap) {
    return (
      <div className="mx-auto max-w-[1400px] px-4 py-5">
        <p role="status" className="mb-4 rounded-2xl bg-saffron px-4 py-3 text-lg font-semibold text-cocoa">Offline — this is what the kitchen screen last saw. It will refresh when the internet is back.</p>
        <OfflineBoard snap={offlineSnap} />
        <button type="button" onClick={() => setAttempt((n) => n + 1)} className="mt-4 min-h-14 rounded-2xl border border-clay bg-cream px-5 text-lg">Try again</button>
      </div>
    );
  }
  if (phase.kind === "not-member" || phase.kind === "error") {
    return (
      <Centered>
        {phase.kind === "not-member" ? (
          <>
            <h1 className="text-xl font-bold">You're not on the family list yet</h1>
            <p className="mt-2 text-bark/70">
              You're signed in as <strong>{phase.email}</strong>. Ask whoever runs ELK to add this email, then reload this page.
            </p>
          </>
        ) : (
          <>
            <h1 className="text-xl font-bold">Couldn't check your access</h1>
            <p className="mt-2 text-bark/70">{phase.error}</p>
            <button type="button" onClick={() => setAttempt((n) => n + 1)} className="mt-4 rounded-xl border border-clay bg-cream px-4 py-2 text-sm">
              Try again
            </button>
          </>
        )}
        <div className="mt-6 flex flex-col items-center gap-3">
          <DownloadDeviceExport store={deviceStore} />
          <button type="button" onClick={() => supabase?.auth.signOut()} className="text-sm text-sage underline">
            Sign out
          </button>
        </div>
      </Centered>
    );
  }
  return (
    <KitchenContext.Provider value={{ ...phase.kitchen, deviceStore, photos }}>
      {children}
    </KitchenContext.Provider>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-md text-center">
        <p className="mb-4 text-2xl font-bold tracking-tight text-bark">ELK Kitchen</p>
        {children}
      </div>
    </div>
  );
}
