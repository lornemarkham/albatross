import { useState, type FormEvent } from "react";
import { supabase } from "../lib/supabase";

// Same sign-in as ELK Inventory: an email link, no passwords.
export function LoginPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!supabase || !email.trim()) return;
    setBusy(true);
    setError("");
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: window.location.origin, shouldCreateUser: true },
    });
    if (error) setError(error.message);
    else setSent(true);
    setBusy(false);
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-md">
        <h1 className="text-3xl font-bold tracking-tight text-bark">ELK Kitchen</h1>
        <p className="mt-1 text-bark/70">Family recipes. Sign in with your email.</p>
        {sent ? (
          <p className="mt-8 rounded-2xl border border-clay bg-cream p-5 text-bark">
            Check <strong>{email.trim()}</strong> for a sign-in link. Open it on this device.
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="mt-8 space-y-4">
            <label htmlFor="email" className="block text-sm font-medium text-bark">Email</label>
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-xl border border-clay bg-white px-3 py-2 text-bark shadow-sm focus:border-sage focus:outline-none focus:ring-1 focus:ring-sage"
            />
            <button type="submit" disabled={busy} className="w-full rounded-xl bg-sage py-3 text-sm font-semibold text-white shadow-sm disabled:opacity-60">
              {busy ? "Sending…" : "Email me a sign-in link"}
            </button>
            {error && <p className="text-sm text-red-700">{error}</p>}
          </form>
        )}
      </div>
    </div>
  );
}
