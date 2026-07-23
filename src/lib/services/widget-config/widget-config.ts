import "server-only";
import { createServiceClient } from "@/lib/supabase/server";

// Widget Configuration Service — resolves the public-safe subset of
// Chatbot Configuration for the widget bootstrap endpoint (Phase 7,
// Increment 3, AD-028). Returns only the explicit allowlist AD-028
// authorizes (display name, welcome message) -- never instructions,
// retrieval configuration, or the identifier itself. This is not the
// administrative Chatbot Configuration resource (04_api_design_v1.md,
// not yet implemented) and introduces no new persistent entity -- it
// reads the same single-row table Increment 2's Rate Limit Service
// already reads.
export type PublicWidgetConfiguration = {
  name: string;
  welcomeMessage: string | null;
};

export async function getPublicWidgetConfiguration(): Promise<PublicWidgetConfiguration | null> {
  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from("chatbot_configuration")
    .select("name, welcome_message")
    .eq("id", true)
    .single();

  if (error || !data) {
    return null;
  }

  return { name: data.name, welcomeMessage: data.welcome_message };
}
