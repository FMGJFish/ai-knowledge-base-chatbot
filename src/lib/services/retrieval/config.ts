import "server-only";
import { createServiceClient } from "@/lib/supabase/server";

// Retrieval Service — configuration access (Phase 5, Increment 1). Reads
// the runtime retrieval tuning parameters from the single Chatbot
// Configuration row (technical_specification_v1.md, Configuration
// Management). Read-only: this module never writes to
// chatbot_configuration -- ownership of the write path remains with
// whichever future capability edits chatbot configuration generally.
//
// Both columns are NOT NULL with a database-level default (Phase 5,
// Increment 1 migration), and are further constrained by CHECK
// constraints, so an "invalid" stored value cannot exist -- this module
// only ever needs to read whatever is present, never validate it.
export interface RetrievalConfig {
  similarityThreshold: number;
  topK: number;
}

export async function getRetrievalConfig(): Promise<RetrievalConfig> {
  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from("chatbot_configuration")
    .select("similarity_threshold, top_k")
    .eq("id", true)
    .single();

  if (error) {
    throw new Error(`Failed to read retrieval configuration: ${error.message}`);
  }

  return {
    similarityThreshold: data.similarity_threshold,
    topK: data.top_k,
  };
}
