import "server-only";
import { createServiceClient } from "@/lib/supabase/server";

// AI Response Service — configuration access (Phase 6, Increment 1). Reads
// the Chatbot Configuration fields that govern prompt construction (name,
// welcome message, instructions) from the single Chatbot Configuration row
// (technical_specification_v1.md, AI Integration / Configuration
// Management). Read-only.
//
// Owned independently by the AI Response Service, separate from the
// Retrieval Service's own configuration reader
// (services/retrieval/config.ts), which reads different fields
// (similarity_threshold, top_k) from the same table for a different
// purpose. Ownership follows service responsibility, not the underlying
// table (phase6_execution_strategy_v1.md, Establishment Package Decision 3).
export interface ChatbotConfiguration {
  name: string;
  welcomeMessage: string | null;
  instructions: string | null;
}

export async function getChatbotConfiguration(): Promise<ChatbotConfiguration> {
  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from("chatbot_configuration")
    .select("name, welcome_message, instructions")
    .eq("id", true)
    .single();

  if (error) {
    throw new Error(`Failed to read chatbot configuration: ${error.message}`);
  }

  return {
    name: data.name,
    welcomeMessage: data.welcome_message,
    instructions: data.instructions,
  };
}
