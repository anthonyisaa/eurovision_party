export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      chat_messages: {
        Row: {
          content: string
          created_at: string
          event_idx_at_post: number | null
          guest_id: string | null
          id: string
          is_commentator: boolean
          party_id: string
          speaker: string | null
        }
        Insert: {
          content: string
          created_at?: string
          event_idx_at_post?: number | null
          guest_id?: string | null
          id?: string
          is_commentator?: boolean
          party_id: string
          speaker?: string | null
        }
        Update: {
          content?: string
          created_at?: string
          event_idx_at_post?: number | null
          guest_id?: string | null
          id?: string
          is_commentator?: boolean
          party_id?: string
          speaker?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_guest_id_fkey"
            columns: ["guest_id"]
            isOneToOne: false
            referencedRelation: "guests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_messages_party_id_fkey"
            columns: ["party_id"]
            isOneToOne: false
            referencedRelation: "parties"
            referencedColumns: ["id"]
          },
        ]
      }
      countries: {
        Row: {
          artist: string | null
          code: string
          flag_emoji: string
          fun_fact: string | null
          name: string
          running_order: number | null
          semi_or_final: string | null
          song_title: string | null
          spotify_url: string | null
          vibe_blurb: string | null
          youtube_url: string | null
        }
        Insert: {
          artist?: string | null
          code: string
          flag_emoji: string
          fun_fact?: string | null
          name: string
          running_order?: number | null
          semi_or_final?: string | null
          song_title?: string | null
          spotify_url?: string | null
          vibe_blurb?: string | null
          youtube_url?: string | null
        }
        Update: {
          artist?: string | null
          code?: string
          flag_emoji?: string
          fun_fact?: string | null
          name?: string
          running_order?: number | null
          semi_or_final?: string | null
          song_title?: string | null
          spotify_url?: string | null
          vibe_blurb?: string | null
          youtube_url?: string | null
        }
        Relationships: []
      }
      event_timeline: {
        Row: {
          category: string
          country_code: string | null
          description: string
          end_seconds: number | null
          idx: number
          party_id: string
          song_idx: number | null
          start_seconds: number
        }
        Insert: {
          category: string
          country_code?: string | null
          description: string
          end_seconds?: number | null
          idx: number
          party_id: string
          song_idx?: number | null
          start_seconds: number
        }
        Update: {
          category?: string
          country_code?: string | null
          description?: string
          end_seconds?: number | null
          idx?: number
          party_id?: string
          song_idx?: number | null
          start_seconds?: number
        }
        Relationships: [
          {
            foreignKeyName: "event_timeline_country_code_fkey"
            columns: ["country_code"]
            isOneToOne: false
            referencedRelation: "countries"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "event_timeline_party_id_fkey"
            columns: ["party_id"]
            isOneToOne: false
            referencedRelation: "parties"
            referencedColumns: ["id"]
          },
        ]
      }
      guests: {
        Row: {
          assigned_country_1: string | null
          assigned_country_2: string | null
          display_name: string
          id: string
          joined_at: string
          party_id: string
        }
        Insert: {
          assigned_country_1?: string | null
          assigned_country_2?: string | null
          display_name: string
          id?: string
          joined_at?: string
          party_id: string
        }
        Update: {
          assigned_country_1?: string | null
          assigned_country_2?: string | null
          display_name?: string
          id?: string
          joined_at?: string
          party_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "guests_assigned_country_1_fkey"
            columns: ["assigned_country_1"]
            isOneToOne: false
            referencedRelation: "countries"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "guests_assigned_country_2_fkey"
            columns: ["assigned_country_2"]
            isOneToOne: false
            referencedRelation: "countries"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "guests_party_id_fkey"
            columns: ["party_id"]
            isOneToOne: false
            referencedRelation: "parties"
            referencedColumns: ["id"]
          },
        ]
      }
      parties: {
        Row: {
          actual_results: Json | null
          cohost_guest_id: string | null
          commentator_tone: number
          contest_year: number
          created_at: string
          fake_broadcast: boolean
          fake_broadcast_started_at: string | null
          highest_event_idx_reached: number
          host_guest_id: string | null
          id: string
          manual_event_idx: number | null
          name: string
          party_pause_reason: string | null
          party_paused: boolean
          party_paused_at: string | null
          phase: string
          reveal_step: number
          yt_current_seconds: number | null
          yt_last_update_at: string | null
          yt_player_state: string | null
          yt_video_id: string | null
        }
        Insert: {
          actual_results?: Json | null
          cohost_guest_id?: string | null
          commentator_tone?: number
          contest_year?: number
          created_at?: string
          fake_broadcast?: boolean
          fake_broadcast_started_at?: string | null
          highest_event_idx_reached?: number
          host_guest_id?: string | null
          id?: string
          manual_event_idx?: number | null
          name: string
          party_pause_reason?: string | null
          party_paused?: boolean
          party_paused_at?: string | null
          phase?: string
          reveal_step?: number
          yt_current_seconds?: number | null
          yt_last_update_at?: string | null
          yt_player_state?: string | null
          yt_video_id?: string | null
        }
        Update: {
          actual_results?: Json | null
          cohost_guest_id?: string | null
          commentator_tone?: number
          contest_year?: number
          created_at?: string
          fake_broadcast?: boolean
          fake_broadcast_started_at?: string | null
          highest_event_idx_reached?: number
          host_guest_id?: string | null
          id?: string
          manual_event_idx?: number | null
          name?: string
          party_pause_reason?: string | null
          party_paused?: boolean
          party_paused_at?: string | null
          phase?: string
          reveal_step?: number
          yt_current_seconds?: number | null
          yt_last_update_at?: string | null
          yt_player_state?: string | null
          yt_video_id?: string | null
        }
        Relationships: []
      }
      predictions: {
        Row: {
          cast_at: string
          country_code: string
          guest_id: string
          position: number
        }
        Insert: {
          cast_at?: string
          country_code: string
          guest_id: string
          position: number
        }
        Update: {
          cast_at?: string
          country_code?: string
          guest_id?: string
          position?: number
        }
        Relationships: [
          {
            foreignKeyName: "predictions_country_code_fkey"
            columns: ["country_code"]
            isOneToOne: false
            referencedRelation: "countries"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "predictions_guest_id_fkey"
            columns: ["guest_id"]
            isOneToOne: false
            referencedRelation: "guests"
            referencedColumns: ["id"]
          },
        ]
      }
      reactions: {
        Row: {
          cast_at: string
          country_code: string
          guest_id: string
          rating: number
        }
        Insert: {
          cast_at?: string
          country_code: string
          guest_id: string
          rating: number
        }
        Update: {
          cast_at?: string
          country_code?: string
          guest_id?: string
          rating?: number
        }
        Relationships: [
          {
            foreignKeyName: "reactions_country_code_fkey"
            columns: ["country_code"]
            isOneToOne: false
            referencedRelation: "countries"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "reactions_guest_id_fkey"
            columns: ["guest_id"]
            isOneToOne: false
            referencedRelation: "guests"
            referencedColumns: ["id"]
          },
        ]
      }
      scheduled_commentary: {
        Row: {
          category: string
          content: string
          event_idx: number | null
          fired: boolean
          fired_at: string | null
          id: string
          party_id: string
          speaker: string
          trigger_seconds: number | null
        }
        Insert: {
          category?: string
          content: string
          event_idx?: number | null
          fired?: boolean
          fired_at?: string | null
          id?: string
          party_id: string
          speaker: string
          trigger_seconds?: number | null
        }
        Update: {
          category?: string
          content?: string
          event_idx?: number | null
          fired?: boolean
          fired_at?: string | null
          id?: string
          party_id?: string
          speaker?: string
          trigger_seconds?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "scheduled_commentary_party_id_fkey"
            columns: ["party_id"]
            isOneToOne: false
            referencedRelation: "parties"
            referencedColumns: ["id"]
          },
        ]
      }
      side_bet_picks: {
        Row: {
          bet_id: string
          guest_id: string
          pick: string
          placed_at: string
        }
        Insert: {
          bet_id: string
          guest_id: string
          pick: string
          placed_at?: string
        }
        Update: {
          bet_id?: string
          guest_id?: string
          pick?: string
          placed_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "side_bet_picks_bet_id_fkey"
            columns: ["bet_id"]
            isOneToOne: false
            referencedRelation: "side_bets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "side_bet_picks_guest_id_fkey"
            columns: ["guest_id"]
            isOneToOne: false
            referencedRelation: "guests"
            referencedColumns: ["id"]
          },
        ]
      }
      side_bets: {
        Row: {
          bet_type: string
          created_at: string
          id: string
          options_json: Json
          party_id: string
          question: string
          resolved_at: string | null
          resolved_value: string | null
        }
        Insert: {
          bet_type: string
          created_at?: string
          id?: string
          options_json: Json
          party_id: string
          question: string
          resolved_at?: string | null
          resolved_value?: string | null
        }
        Update: {
          bet_type?: string
          created_at?: string
          id?: string
          options_json?: Json
          party_id?: string
          question?: string
          resolved_at?: string | null
          resolved_value?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "side_bets_party_id_fkey"
            columns: ["party_id"]
            isOneToOne: false
            referencedRelation: "parties"
            referencedColumns: ["id"]
          },
        ]
      }
      votes: {
        Row: {
          cast_at: string
          country_code: string
          guest_id: string
          points: number
        }
        Insert: {
          cast_at?: string
          country_code: string
          guest_id: string
          points: number
        }
        Update: {
          cast_at?: string
          country_code?: string
          guest_id?: string
          points?: number
        }
        Relationships: [
          {
            foreignKeyName: "votes_country_code_fkey"
            columns: ["country_code"]
            isOneToOne: false
            referencedRelation: "countries"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "votes_guest_id_fkey"
            columns: ["guest_id"]
            isOneToOne: false
            referencedRelation: "guests"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
