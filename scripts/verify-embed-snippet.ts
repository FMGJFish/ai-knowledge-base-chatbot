// Narrowly scoped deterministic verification for the Task 4D embed
// snippet utility (scripts/generate-embed-snippet.ts). No live Supabase
// connection and no real environment variables required -- this
// exercises the module's real, exported pure functions (target parsing,
// deployment-profile resolution, snippet rendering) against fixture
// input, no reimplementation of their logic. It never triggers main()'s
// live Supabase resolution -- that path only runs when the module is
// executed directly (see the import.meta.url guard at the bottom of
// generate-embed-snippet.ts).
//
// Coverage:
// - --target parsing (valid, missing, invalid).
// - Complete deployment-profile resolution for staging and production.
// - Deployment-profile isolation (CSA adjudication, corrective round):
//   a target's profile must resolve entirely from that target's own
//   three variables, must reject when any one of them is missing --
//   including when the *other* target's variables, or the app's generic
//   NEXT_PUBLIC_SUPABASE_URL/SUPABASE_SECRET_KEY, are present instead --
//   and must never include a resolved secret's value in a thrown error
//   message.
// - Host/URL validation: malformed URL rejection, non-HTTPS rejection,
//   trailing-path/slash normalization to origin, applied independently
//   to both the widget host and the Supabase project URL.
// - Drift protection against the real public/widget-embed.js artifact:
//   the attribute name it actually reads via
//   `currentScript.getAttribute(...)` is extracted from the real file on
//   disk (not re-hardcoded) and used to assert renderEmbedSnippet's
//   output is compatible with it -- a future rename of that attribute in
//   widget-embed.js without a matching update here will fail this check.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  parseTarget,
  resolveDeploymentProfile,
  renderEmbedSnippet,
} from "./generate-embed-snippet.ts";

let passed = 0;

function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`ok   ${name}`);
}

// --- --target parsing ---

check("parses --target=staging", () => {
  assert.equal(parseTarget(["--target=staging"]), "staging");
});

check("parses --target=production", () => {
  assert.equal(parseTarget(["--target=production"]), "production");
});

check("rejects a missing --target flag", () => {
  assert.throws(() => parseTarget([]), /Missing required --target flag/);
});

check("rejects an invalid --target value", () => {
  assert.throws(() => parseTarget(["--target=dev"]), /Invalid --target value/);
});

// --- Complete deployment-profile resolution ---

check("resolves a complete staging deployment profile", () => {
  const profile = resolveDeploymentProfile("staging", {
    WIDGET_HOST_STAGING: "https://staging.example.com/",
    SUPABASE_URL_STAGING: "https://staging-project.supabase.co",
    SUPABASE_SECRET_KEY_STAGING: "staging-secret-value",
  });
  assert.deepEqual(profile, {
    target: "staging",
    widgetOrigin: "https://staging.example.com",
    supabaseUrl: "https://staging-project.supabase.co",
    supabaseSecretKey: "staging-secret-value",
  });
});

check("resolves a complete production deployment profile", () => {
  const profile = resolveDeploymentProfile("production", {
    WIDGET_HOST_PRODUCTION: "https://app.example.com",
    SUPABASE_URL_PRODUCTION: "https://prod-project.supabase.co/",
    SUPABASE_SECRET_KEY_PRODUCTION: "production-secret-value",
  });
  assert.deepEqual(profile, {
    target: "production",
    widgetOrigin: "https://app.example.com",
    supabaseUrl: "https://prod-project.supabase.co",
    supabaseSecretKey: "production-secret-value",
  });
});

// --- Deployment-profile isolation (the defect this round corrects) ---

check(
  "rejects a staging profile missing SUPABASE_URL_STAGING even though generic Supabase vars are set",
  () => {
    assert.throws(
      () =>
        resolveDeploymentProfile("staging", {
          WIDGET_HOST_STAGING: "https://staging.example.com",
          SUPABASE_SECRET_KEY_STAGING: "staging-secret",
          NEXT_PUBLIC_SUPABASE_URL: "https://generic-project.supabase.co",
          SUPABASE_SECRET_KEY: "generic-secret",
        }),
      /Missing SUPABASE_URL_STAGING/
    );
  }
);

check(
  "rejects a production profile missing SUPABASE_SECRET_KEY_PRODUCTION even though generic vars are set",
  () => {
    assert.throws(
      () =>
        resolveDeploymentProfile("production", {
          WIDGET_HOST_PRODUCTION: "https://app.example.com",
          SUPABASE_URL_PRODUCTION: "https://prod-project.supabase.co",
          NEXT_PUBLIC_SUPABASE_URL: "https://generic-project.supabase.co",
          SUPABASE_SECRET_KEY: "generic-secret",
        }),
      /Missing SUPABASE_SECRET_KEY_PRODUCTION/
    );
  }
);

check("never falls back to generic NEXT_PUBLIC_SUPABASE_URL/SUPABASE_SECRET_KEY at all", () => {
  assert.throws(
    () =>
      resolveDeploymentProfile("staging", {
        NEXT_PUBLIC_SUPABASE_URL: "https://generic-project.supabase.co",
        SUPABASE_SECRET_KEY: "generic-secret",
      }),
    /Missing WIDGET_HOST_STAGING/
  );
});

check("does not cross-read the other target's deployment profile", () => {
  assert.throws(
    () =>
      resolveDeploymentProfile("staging", {
        WIDGET_HOST_PRODUCTION: "https://app.example.com",
        SUPABASE_URL_PRODUCTION: "https://prod-project.supabase.co",
        SUPABASE_SECRET_KEY_PRODUCTION: "prod-secret",
      }),
    /Missing WIDGET_HOST_STAGING/
  );
});

check("rejects an empty (whitespace-only) secret key as missing", () => {
  assert.throws(
    () =>
      resolveDeploymentProfile("staging", {
        WIDGET_HOST_STAGING: "https://staging.example.com",
        SUPABASE_URL_STAGING: "https://staging-project.supabase.co",
        SUPABASE_SECRET_KEY_STAGING: "   ",
      }),
    /Missing SUPABASE_SECRET_KEY_STAGING/
  );
});

check("never includes a resolved secret's value in a thrown error message", () => {
  const distinctiveSecret = "sb_secret_should_never_appear_in_output_9f3a";
  assert.throws(
    () =>
      resolveDeploymentProfile("staging", {
        SUPABASE_URL_STAGING: "https://staging-project.supabase.co",
        SUPABASE_SECRET_KEY_STAGING: distinctiveSecret,
        // WIDGET_HOST_STAGING intentionally omitted -- the failure this
        // triggers happens after the secret would have been read into
        // the environment, so this proves it is never echoed regardless
        // of which check fails.
      }),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /WIDGET_HOST_STAGING/);
      assert.ok(!err.message.includes(distinctiveSecret));
      return true;
    }
  );
});

// --- Host/URL validation, applied to both URL-shaped variables ---

check("rejects a malformed WIDGET_HOST_STAGING URL", () => {
  assert.throws(
    () =>
      resolveDeploymentProfile("staging", {
        WIDGET_HOST_STAGING: "not-a-url",
        SUPABASE_URL_STAGING: "https://staging-project.supabase.co",
        SUPABASE_SECRET_KEY_STAGING: "staging-secret",
      }),
    /WIDGET_HOST_STAGING \("not-a-url"\) is not a valid absolute URL/
  );
});

check("rejects a non-HTTPS WIDGET_HOST_STAGING", () => {
  assert.throws(
    () =>
      resolveDeploymentProfile("staging", {
        WIDGET_HOST_STAGING: "http://staging.example.com",
        SUPABASE_URL_STAGING: "https://staging-project.supabase.co",
        SUPABASE_SECRET_KEY_STAGING: "staging-secret",
      }),
    /WIDGET_HOST_STAGING \("http:\/\/staging\.example\.com"\) must use https:/
  );
});

check("rejects a malformed SUPABASE_URL_PRODUCTION URL", () => {
  assert.throws(
    () =>
      resolveDeploymentProfile("production", {
        WIDGET_HOST_PRODUCTION: "https://app.example.com",
        SUPABASE_URL_PRODUCTION: "not-a-url",
        SUPABASE_SECRET_KEY_PRODUCTION: "production-secret",
      }),
    /SUPABASE_URL_PRODUCTION \("not-a-url"\) is not a valid absolute URL/
  );
});

check("rejects a non-HTTPS SUPABASE_URL_PRODUCTION", () => {
  assert.throws(
    () =>
      resolveDeploymentProfile("production", {
        WIDGET_HOST_PRODUCTION: "https://app.example.com",
        SUPABASE_URL_PRODUCTION: "http://prod-project.supabase.co",
        SUPABASE_SECRET_KEY_PRODUCTION: "production-secret",
      }),
    /SUPABASE_URL_PRODUCTION \("http:\/\/prod-project\.supabase\.co"\) must use https:/
  );
});

// --- Drift protection against the real public/widget-embed.js artifact ---

const WIDGET_EMBED_SCRIPT_PATH = new URL("../public/widget-embed.js", import.meta.url);

function extractPublicChatbotIdentifierAttributeName(): string {
  const source = readFileSync(WIDGET_EMBED_SCRIPT_PATH, "utf8");
  const match = source.match(/currentScript\.getAttribute\("([^"]+)"\)/);

  if (!match) {
    throw new Error(
      `Could not find currentScript.getAttribute("...") in ${WIDGET_EMBED_SCRIPT_PATH}. ` +
        "public/widget-embed.js's publicChatbotIdentifier contract may have changed -- " +
        "scripts/generate-embed-snippet.ts's renderEmbedSnippet must be updated to match " +
        "before this check can pass."
    );
  }

  const attributeName = match[1];
  if (!attributeName) {
    throw new Error(
      `Matched an empty attribute name in ${WIDGET_EMBED_SCRIPT_PATH}'s ` +
        "currentScript.getAttribute(...) call."
    );
  }

  return attributeName;
}

check(
  "public/widget-embed.js still reads the expected publicChatbotIdentifier attribute name",
  () => {
    assert.equal(extractPublicChatbotIdentifierAttributeName(), "data-public-chatbot-identifier");
  }
);

check(
  "renderEmbedSnippet's output is compatible with the real widget-embed.js attribute contract",
  () => {
    const attributeName = extractPublicChatbotIdentifierAttributeName();
    const snippet = renderEmbedSnippet(
      "https://staging.example.com",
      "11111111-1111-1111-1111-111111111111"
    );
    assert.match(snippet, new RegExp(`${attributeName}="11111111-1111-1111-1111-111111111111"`));
  }
);

check("renders exactly the attribute name and script shape public/widget-embed.js expects", () => {
  const snippet = renderEmbedSnippet(
    "https://staging.example.com",
    "11111111-1111-1111-1111-111111111111"
  );
  assert.equal(
    snippet,
    '<script src="https://staging.example.com/widget-embed.js" data-public-chatbot-identifier="11111111-1111-1111-1111-111111111111"></script>'
  );
});

console.log(`\n${passed} embed snippet verification checks passed.`);
