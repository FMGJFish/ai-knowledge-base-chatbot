"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";

// Admin Dashboard sign-in (Implementation Roadmap Phase 3). Supabase Auth
// is the sole administrator identity provider (ADR Decision 009, ADR
// Decision 011) — there is no application-level administrators table.
// This page only authenticates; it does not implement any Admin
// Dashboard functionality (document upload, configuration, analytics),
// which remains Phase 8 scope.
export default function AdminLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    const supabase = createBrowserClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });

    setIsSubmitting(false);

    if (signInError) {
      // Dev-only diagnostic: preserve the real Supabase Auth error shape
      // (code/status/message) without ever surfacing it to the UI or
      // logging any credential, token, or key value. This exists because
      // a prior incident (a truncated local Supabase publishable key)
      // was indistinguishable from a wrong-password error until server
      // logs were inspected — this at least makes the distinction
      // visible in the browser console during local development.
      if (process.env.NODE_ENV === "development") {
        console.error("Supabase Auth sign-in error:", {
          code: signInError.code,
          status: signInError.status,
          message: signInError.message,
        });
      }

      // Minimum useful classification: GoTrue's own credential-grant
      // rejection is a 400 (optionally with code "invalid_credentials").
      // Anything else — including the 401 seen in the incident above,
      // which came from the API gateway rejecting a malformed key before
      // GoTrue ever evaluated a password — is a service/configuration
      // failure, not evidence of a wrong email or password.
      const isCredentialFailure =
        signInError.status === 400 || signInError.code === "invalid_credentials";

      setError(
        isCredentialFailure
          ? "Sign-in failed. Check your email and password and try again."
          : "Sign-in could not be completed because of an authentication service or configuration problem. Please try again or contact support."
      );
      return;
    }

    router.push("/admin");
    router.refresh();
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-4">
        <h1 className="text-xl font-semibold">Admin Sign In</h1>

        <div className="space-y-1">
          <label htmlFor="email" className="block text-sm font-medium">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="w-full rounded border px-3 py-2"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="password" className="block text-sm font-medium">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="w-full rounded border px-3 py-2"
          />
        </div>

        {error ? (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full rounded bg-black px-3 py-2 text-white disabled:opacity-50"
        >
          {isSubmitting ? "Signing in…" : "Sign In"}
        </button>
      </form>
    </main>
  );
}
