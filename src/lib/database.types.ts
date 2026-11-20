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
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      activity_log: {
        Row: {
          created_at: string
          detail: Json
          event: string
          id: number
          path: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          detail?: Json
          event: string
          id?: number
          path?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          detail?: Json
          event?: string
          id?: number
          path?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "activity_log_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profile_names"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_log_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      contacts: {
        Row: {
          attributes: Json
          client: string | null
          company: string | null
          contact_name: string | null
          email: string | null
          id: string
          linked_deals: string[]
          mobile: string | null
          notes: string | null
          office: string | null
          title: string | null
          vertical: string | null
        }
        Insert: {
          attributes?: Json
          client?: string | null
          company?: string | null
          contact_name?: string | null
          email?: string | null
          id: string
          linked_deals?: string[]
          mobile?: string | null
          notes?: string | null
          office?: string | null
          title?: string | null
          vertical?: string | null
        }
        Update: {
          attributes?: Json
          client?: string | null
          company?: string | null
          contact_name?: string | null
          email?: string | null
          id?: string
          linked_deals?: string[]
          mobile?: string | null
          notes?: string | null
          office?: string | null
          title?: string | null
          vertical?: string | null
        }
        Relationships: []
      }
      deal_history: {
        Row: {
          changed_at: string
          changed_by: string | null
          deal_id: string
          field: string
          id: number
          new_value: Json | null
          old_value: Json | null
          seed_source: string | null
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          deal_id: string
          field: string
          id?: number
          new_value?: Json | null
          old_value?: Json | null
          seed_source?: string | null
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          deal_id?: string
          field?: string
          id?: number
          new_value?: Json | null
          old_value?: Json | null
          seed_source?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "deal_history_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "profile_names"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deal_history_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deal_history_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
        ]
      }
      deals: {
        Row: {
          address: string | null
          attributes: Json
          attributes_raw: Json
          bldg_sf: number | null
          broker: string | null
          broker_phone: string | null
          city: string | null
          client: string | null
          created_at: string
          field_provenance: Json
          id: string
          list_price: number | null
          lot_sf: number | null
          market: string | null
          needs_review: boolean
          notes: string | null
          notes_extracted: Json | null
          price_per_lot_sf: number | null
          price_per_sf: number | null
          review_reasons: string[]
          show_in_weekly: boolean
          source_row: number | null
          source_tab: string | null
          stage: Database["public"]["Enums"]["deal_stage"]
          stage_entered_at: string
          stage_raw: string | null
          state: string | null
          state_inferred: boolean
          updated_at: string
          updated_by: string | null
          version: number
          vertical: string | null
          weekly_note: string | null
        }
        Insert: {
          address?: string | null
          attributes?: Json
          attributes_raw?: Json
          bldg_sf?: number | null
          broker?: string | null
          broker_phone?: string | null
          city?: string | null
          client?: string | null
          created_at?: string
          field_provenance?: Json
          id: string
          list_price?: number | null
          lot_sf?: number | null
          market?: string | null
          needs_review?: boolean
          notes?: string | null
          notes_extracted?: Json | null
          price_per_lot_sf?: number | null
          price_per_sf?: number | null
          review_reasons?: string[]
          show_in_weekly?: boolean
          source_row?: number | null
          source_tab?: string | null
          stage?: Database["public"]["Enums"]["deal_stage"]
          stage_entered_at?: string
          stage_raw?: string | null
          state?: string | null
          state_inferred?: boolean
          updated_at?: string
          updated_by?: string | null
          version?: number
          vertical?: string | null
          weekly_note?: string | null
        }
        Update: {
          address?: string | null
          attributes?: Json
          attributes_raw?: Json
          bldg_sf?: number | null
          broker?: string | null
          broker_phone?: string | null
          city?: string | null
          client?: string | null
          created_at?: string
          field_provenance?: Json
          id?: string
          list_price?: number | null
          lot_sf?: number | null
          market?: string | null
          needs_review?: boolean
          notes?: string | null
          notes_extracted?: Json | null
          price_per_lot_sf?: number | null
          price_per_sf?: number | null
          review_reasons?: string[]
          show_in_weekly?: boolean
          source_row?: number | null
          source_tab?: string | null
          stage?: Database["public"]["Enums"]["deal_stage"]
          stage_entered_at?: string
          stage_raw?: string | null
          state?: string | null
          state_inferred?: boolean
          updated_at?: string
          updated_by?: string | null
          version?: number
          vertical?: string | null
          weekly_note?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "deals_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profile_names"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          active: boolean
          clients: string[]
          created_at: string
          email: string
          full_name: string
          id: string
          role: Database["public"]["Enums"]["user_role"]
          verticals: string[]
        }
        Insert: {
          active?: boolean
          clients?: string[]
          created_at?: string
          email: string
          full_name: string
          id: string
          role?: Database["public"]["Enums"]["user_role"]
          verticals?: string[]
        }
        Update: {
          active?: boolean
          clients?: string[]
          created_at?: string
          email?: string
          full_name?: string
          id?: string
          role?: Database["public"]["Enums"]["user_role"]
          verticals?: string[]
        }
        Relationships: []
      }
      vertical_config: {
        Row: {
          columns: Json
          sort_order: number
          tab_prefix: string
          vertical: string
        }
        Insert: {
          columns?: Json
          sort_order: number
          tab_prefix: string
          vertical: string
        }
        Update: {
          columns?: Json
          sort_order?: number
          tab_prefix?: string
          vertical?: string
        }
        Relationships: []
      }
      weekly_snapshots: {
        Row: {
          created_at: string
          created_by: string | null
          data: Json
          id: number
          week_start: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          data: Json
          id?: number
          week_start: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          data?: Json
          id?: number
          week_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "weekly_snapshots_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profile_names"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "weekly_snapshots_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      profile_names: {
        Row: {
          full_name: string | null
          id: string | null
          role: Database["public"]["Enums"]["user_role"] | null
        }
        Insert: {
          full_name?: string | null
          id?: string | null
          role?: Database["public"]["Enums"]["user_role"] | null
        }
        Update: {
          full_name?: string | null
          id?: string | null
          role?: Database["public"]["Enums"]["user_role"] | null
        }
        Relationships: []
      }
      v_stage_rollup: {
        Row: {
          avg_days_in_stage: number | null
          deal_count: number | null
          market: string | null
          stage: Database["public"]["Enums"]["deal_stage"] | null
          vertical: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      app_role: {
        Args: never
        Returns: Database["public"]["Enums"]["user_role"]
      }
      current_profile: {
        Args: never
        Returns: {
          active: boolean
          clients: string[]
          created_at: string
          email: string
          full_name: string
          id: string
          role: Database["public"]["Enums"]["user_role"]
          verticals: string[]
        }
        SetofOptions: {
          from: "*"
          to: "profiles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      current_user_active: { Args: never; Returns: boolean }
    }
    Enums: {
      deal_stage:
        | "Sourcing"
        | "In Pipeline"
        | "Pre LOI"
        | "Negotiating LOI"
        | "Negotiating PSA"
        | "In Contract"
        | "Closed"
        | "On Hold"
        | "Needs review"
      user_role: "admin" | "leadership" | "acq_lead" | "analyst" | "viewer"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      deal_stage: [
        "Sourcing",
        "In Pipeline",
        "Pre LOI",
        "Negotiating LOI",
        "Negotiating PSA",
        "In Contract",
        "Closed",
        "On Hold",
        "Needs review",
      ],
      user_role: ["admin", "leadership", "acq_lead", "analyst", "viewer"],
    },
  },
} as const
