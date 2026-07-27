// Repository-local developer utility (Phase 7, Increment 3, Task 4D --
// AD-023): generates the real Public Chat Widget embed snippet by
// resolving the live public_chatbot_identifier from chatbot_configuration
// and rendering it into the snippet shape public/widget-embed.js already
// parses (a `data-public-chatbot-identifier` attribute on its own
// `<script>` tag; the widget origin is what widget-embed.js itself
// resolves via `new URL(currentScript.src).origin`). This file is never
// imported by any application route or component and is never part of
// the deployed build -- run it directly:
//
//   node scripts/generate-embed-snippet.ts --target=staging
//   node scripts/generate-embed-snippet.ts --target=production
//
// Deployment profile isolation (CSA adjudication, corrective round): each
// --target resolves one complete, self-contained deployment profile --
// widget host, Supabase project URL, and Supabase secret key all sourced
// from that same target's own dedicated environment variables. This
// utility never reads the app's generic NEXT_PUBLIC_SUPABASE_URL /
// SUPABASE_SECRET_KEY -- doing so previously allowed a widget host from
// one environment to be paired with credentials (and therefore an
// identifier) from a different, unrelated environment, silently
// producing a mixed-environment snippet. Each of the six target-specific
// variables below must be present and valid for its own target, with no
// fallback to the other target's variables or to any generic variable.
// Standalone Node execution does not automatically load .env.local (that
// only happens within Next's own dev/build/start lifecycle), so these
// must be present in the shell environment this script runs in. See
// README.md's "Embed Snippet Generation" section for full usage.
//
// Note on Supabase access: src/lib/supabase/server.ts's
// createServiceClient() cannot be reused here -- it is guarded by the
// "server-only" package, which throws unconditionally when imported
// outside a Next.js Server Component module graph (confirmed by direct
// test; plain Node execution never sets the "react-server" export
// condition that package relies on). This script instead constructs its
// own client via @supabase/supabase-js's createClient() directly, using
// the target-specific credentials resolved above, with the identical
// query shape already established in
// src/lib/services/rate-limit/rate-limit.ts's
// resolvePublicChatbotIdentifier() -- no reimplementation of query
// semantics, only of the unavoidable client-construction call.
// src/lib/supabase/server.ts itself is not modified, and its server-only
// boundary is not weakened.

import { createClient } from "@supabase/supabase-js";
import { pathToFileURL } from "node:url";
import type { Database } from "../src/lib/supabase/types.ts";

export const SNIPPET_TEMPLATE_VERSION = 1;

export type WidgetTarget = "staging" | "production";

export interface DeploymentProfile {
  target: WidgetTarget;
  widgetOrigin: string;
  supabaseUrl: string;
  supabaseSecretKey: string;
}

interface DeploymentProfileEnvVarNames {
  widgetHost: string;
  supabaseUrl: string;
  supabaseSecretKey: string;
}

const ENV_VAR_NAMES_BY_TARGET: Record<WidgetTarget, DeploymentProfileEnvVarNames> = {
  staging: {
    widgetHost: "WIDGET_HOST_STAGING",
    supabaseUrl: "SUPABASE_URL_STAGING",
    supabaseSecretKey: "SUPABASE_SECRET_KEY_STAGING",
  },
  production: {
    widgetHost: "WIDGET_HOST_PRODUCTION",
    supabaseUrl: "SUPABASE_URL_PRODUCTION",
    supabaseSecretKey: "SUPABASE_SECRET_KEY_PRODUCTION",
  },
};

export function parseTarget(argv: readonly string[]): WidgetTarget {
  const flag = argv.find((arg) => arg.startsWith("--target="));

  if (!flag) {
    throw new Error(
      "Missing required --target flag. Usage: node scripts/generate-embed-snippet.ts --target=staging|production"
    );
  }

  const value = flag.slice("--target=".length);

  if (value !== "staging" && value !== "production") {
    throw new Error(`Invalid --target value "${value}". Must be "staging" or "production".`);
  }

  return value;
}

// Resolves a required absolute HTTPS URL from a single, named environment
// variable and normalizes it to its origin. Never echoes any variable's
// value except the URL itself, which is not a secret.
function resolveHttpsOrigin(envVarName: string, env: Record<string, string | undefined>): string {
  const raw = env[envVarName];

  if (!raw) {
    throw new Error(`Missing ${envVarName}. It must be set to an absolute https:// URL.`);
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`${envVarName} ("${raw}") is not a valid absolute URL.`);
  }

  if (parsed.protocol !== "https:") {
    throw new Error(`${envVarName} ("${raw}") must use https:.`);
  }

  return parsed.origin;
}

// Resolves a required non-empty secret value from a single, named
// environment variable. Never includes the value itself in any error
// message or log line -- only the variable's name.
function resolveRequiredSecret(
  envVarName: string,
  env: Record<string, string | undefined>
): string {
  const raw = env[envVarName];

  if (!raw || raw.trim().length === 0) {
    throw new Error(`Missing ${envVarName}. It must be set to the target's Supabase secret key.`);
  }

  return raw;
}

// Resolves one complete, target-specific deployment profile. Fails closed
// -- throws on the first missing or invalid variable -- rather than
// resolving a partial profile from a mix of targets or falling back to
// any generic (non-target-specific) variable.
export function resolveDeploymentProfile(
  target: WidgetTarget,
  env: Record<string, string | undefined> = process.env
): DeploymentProfile {
  const envVarNames = ENV_VAR_NAMES_BY_TARGET[target];

  return {
    target,
    widgetOrigin: resolveHttpsOrigin(envVarNames.widgetHost, env),
    supabaseUrl: resolveHttpsOrigin(envVarNames.supabaseUrl, env),
    supabaseSecretKey: resolveRequiredSecret(envVarNames.supabaseSecretKey, env),
  };
}

export function renderEmbedSnippet(widgetOrigin: string, publicChatbotIdentifier: string): string {
  return `<script src="${widgetOrigin}/widget-embed.js" data-public-chatbot-identifier="${publicChatbotIdentifier}"></script>`;
}

async function resolvePublicChatbotIdentifier(profile: DeploymentProfile): Promise<string> {
  const supabase = createClient<Database>(profile.supabaseUrl, profile.supabaseSecretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await supabase
    .from("chatbot_configuration")
    .select("public_chatbot_identifier")
    .eq("id", true)
    .single();

  if (error || !data?.public_chatbot_identifier) {
    throw new Error(
      `Could not resolve public_chatbot_identifier from chatbot_configuration for target ` +
        `"${profile.target}": ${error?.message ?? "no row returned"}`
    );
  }

  return data.public_chatbot_identifier;
}

async function main(): Promise<void> {
  const target = parseTarget(process.argv.slice(2));
  const profile = resolveDeploymentProfile(target);
  const publicChatbotIdentifier = await resolvePublicChatbotIdentifier(profile);
  const snippet = renderEmbedSnippet(profile.widgetOrigin, publicChatbotIdentifier);

  console.log(`Target:                    ${profile.target}`);
  console.log(`Widget origin:             ${profile.widgetOrigin}`);
  console.log(`Supabase project URL:      ${profile.supabaseUrl}`);
  console.log(`Public Chatbot Identifier: ${publicChatbotIdentifier}`);
  console.log(`Template version:          ${SNIPPET_TEMPLATE_VERSION}`);
  console.log("");
  console.log(snippet);
}

// Only run the live-resolution path when this file is executed directly
// (not when imported for its pure functions, e.g. by
// verify-embed-snippet.ts). pathToFileURL is used rather than a raw
// `file://${process.argv[1]}` string comparison because that idiom does
// not reliably match import.meta.url on Windows (backslash paths vs.
// forward-slash file URLs).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
