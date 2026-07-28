"use client";

import { useEffect, useState } from "react";

type Configuration = {
  name: string;
  welcomeMessage: string | null;
  instructions: string | null;
};

const NAME_MAX_LENGTH = 100;
const WELCOME_MESSAGE_MAX_LENGTH = 500;
const INSTRUCTIONS_MAX_LENGTH = 4000;

// Administrative Configuration form (Phase 8, Increment 2). Presentation
// only: reads via GET /api/v1/configuration, writes via a full-resource
// PUT /api/v1/configuration (the singleton resource's canonical
// operation -- every field is always submitted together). Validation
// limits mirror the Route Handler's own enforcement exactly, so invalid
// input is prevented client-side without duplicating business logic --
// the server remains the source of truth and re-validates independently.
export function ConfigurationForm() {
  const [name, setName] = useState("");
  const [welcomeMessage, setWelcomeMessage] = useState("");
  const [instructions, setInstructions] = useState("");

  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [savePending, setSavePending] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  useEffect(() => {
    let cancelled = false;

    fetch("/api/v1/configuration").then(
      async (response) => {
        if (cancelled) {
          return;
        }

        if (!response.ok) {
          setLoadError(`Failed to load configuration (status ${response.status}).`);
          return;
        }

        const data = (await response.json()) as Configuration;

        if (!cancelled) {
          setName(data.name);
          setWelcomeMessage(data.welcomeMessage ?? "");
          setInstructions(data.instructions ?? "");
          setLoaded(true);
        }
      },
      () => {
        if (!cancelled) {
          setLoadError("Failed to load configuration.");
        }
      }
    );

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setSavePending(true);
    setSaveError(null);
    setSaveSuccess(false);

    try {
      const response = await fetch("/api/v1/configuration", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          welcomeMessage: welcomeMessage.length > 0 ? welcomeMessage : null,
          instructions: instructions.length > 0 ? instructions : null,
        }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        setSaveError(body?.error ?? `Save failed (status ${response.status}).`);
        return;
      }

      const data = (await response.json()) as Configuration;
      setName(data.name);
      setWelcomeMessage(data.welcomeMessage ?? "");
      setInstructions(data.instructions ?? "");
      setSaveSuccess(true);
    } catch {
      setSaveError("Save failed.");
    } finally {
      setSavePending(false);
    }
  }

  if (loadError) {
    return (
      <p role="alert" className="text-sm text-red-700">
        {loadError}
      </p>
    );
  }

  if (!loaded) {
    return <p>Loading configuration…</p>;
  }

  return (
    <form onSubmit={handleSubmit} className="flex max-w-xl flex-col gap-4">
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Name</span>
        <input
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={NAME_MAX_LENGTH}
          required
          className="rounded border px-3 py-2"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Welcome message</span>
        <textarea
          value={welcomeMessage}
          onChange={(event) => setWelcomeMessage(event.target.value)}
          maxLength={WELCOME_MESSAGE_MAX_LENGTH}
          rows={3}
          className="rounded border px-3 py-2"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Instructions</span>
        <textarea
          value={instructions}
          onChange={(event) => setInstructions(event.target.value)}
          maxLength={INSTRUCTIONS_MAX_LENGTH}
          rows={6}
          className="rounded border px-3 py-2"
        />
      </label>

      <button
        type="submit"
        disabled={savePending}
        className="w-fit rounded border px-3 py-2 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {savePending ? "Saving…" : "Save"}
      </button>

      {saveError ? (
        <p role="alert" className="text-sm text-red-700">
          {saveError}
        </p>
      ) : null}

      {saveSuccess ? (
        <p role="status" className="text-sm text-green-700">
          Configuration saved.
        </p>
      ) : null}
    </form>
  );
}
