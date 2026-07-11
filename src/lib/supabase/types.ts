// Generated from the Staging Supabase project schema (Phase 2 migrations).
// Regenerate whenever the schema changes; do not hand-edit.

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
      analytics_events: {
        Row: {
          event_type: string;
          id: string;
          occurred_at: string;
          reference_id: string | null;
          reference_type: string | null;
        };
        Insert: {
          event_type: string;
          id?: string;
          occurred_at?: string;
          reference_id?: string | null;
          reference_type?: string | null;
        };
        Update: {
          event_type?: string;
          id?: string;
          occurred_at?: string;
          reference_id?: string | null;
          reference_type?: string | null;
        };
        Relationships: [];
      };
      chatbot_configuration: {
        Row: {
          id: boolean;
          instructions: string | null;
          name: string;
          public_chatbot_identifier: string | null;
          welcome_message: string | null;
        };
        Insert: {
          id?: boolean;
          instructions?: string | null;
          name?: string;
          public_chatbot_identifier?: string | null;
          welcome_message?: string | null;
        };
        Update: {
          id?: boolean;
          instructions?: string | null;
          name?: string;
          public_chatbot_identifier?: string | null;
          welcome_message?: string | null;
        };
        Relationships: [];
      };
      conversations: {
        Row: {
          id: string;
          last_activity_at: string;
          started_at: string;
          visitor_session_id: string;
        };
        Insert: {
          id?: string;
          last_activity_at?: string;
          started_at?: string;
          visitor_session_id: string;
        };
        Update: {
          id?: string;
          last_activity_at?: string;
          started_at?: string;
          visitor_session_id?: string;
        };
        Relationships: [];
      };
      document_chunks: {
        Row: {
          chunk_order: number;
          content: string;
          document_id: string;
          embedding: string | null;
          id: string;
        };
        Insert: {
          chunk_order: number;
          content: string;
          document_id: string;
          embedding?: string | null;
          id?: string;
        };
        Update: {
          chunk_order?: number;
          content?: string;
          document_id?: string;
          embedding?: string | null;
          id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "document_chunks_document_id_fkey";
            columns: ["document_id"];
            isOneToOne: false;
            referencedRelation: "documents";
            referencedColumns: ["id"];
          },
        ];
      };
      documents: {
        Row: {
          filename: string;
          id: string;
          status: string;
          storage_reference: string | null;
          uploaded_at: string;
        };
        Insert: {
          filename: string;
          id?: string;
          status?: string;
          storage_reference?: string | null;
          uploaded_at?: string;
        };
        Update: {
          filename?: string;
          id?: string;
          status?: string;
          storage_reference?: string | null;
          uploaded_at?: string;
        };
        Relationships: [];
      };
      messages: {
        Row: {
          content: string;
          conversation_id: string;
          created_at: string;
          id: string;
          role: string;
        };
        Insert: {
          content: string;
          conversation_id: string;
          created_at?: string;
          id?: string;
          role: string;
        };
        Update: {
          content?: string;
          conversation_id?: string;
          created_at?: string;
          id?: string;
          role?: string;
        };
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey";
            columns: ["conversation_id"];
            isOneToOne: false;
            referencedRelation: "conversations";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      [_ in never]: never;
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};
