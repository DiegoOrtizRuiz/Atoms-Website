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
          {
            foreignKeyName: "activity_log_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "v_user_usage"
            referencedColumns: ["user_id"]
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
          detail: Json | null
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
          detail?: Json | null
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
          detail?: Json | null
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
            foreignKeyName: "deal_history_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "v_user_usage"
            referencedColumns: ["user_id"]
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
          census_tract_geoid: string | null
          city: string | null
          client: string | null
          created_at: string
          field_provenance: Json
          geocode_source: string | null
          geocode_status: "ok" | "no_address" | "not_found" | "error" | null
          geocoded_address: string | null
          geocoded_at: string | null
          id: string
          lat: number | null
          list_price: number | null
          lng: number | null
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
          census_tract_geoid?: string | null
          city?: string | null
          client?: string | null
          created_at?: string
          field_provenance?: Json
          geocode_source?: string | null
          geocode_status?: "ok" | "no_address" | "not_found" | "error" | null
          geocoded_address?: string | null
          geocoded_at?: string | null
          id: string
          lat?: number | null
          list_price?: number | null
          lng?: number | null
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
          census_tract_geoid?: string | null
          city?: string | null
          client?: string | null
          created_at?: string
          field_provenance?: Json
          geocode_source?: string | null
          geocode_status?: "ok" | "no_address" | "not_found" | "error" | null
          geocoded_address?: string | null
          geocoded_at?: string | null
          id?: string
          lat?: number | null
          list_price?: number | null
          lng?: number | null
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
          {
            foreignKeyName: "deals_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "v_user_usage"
            referencedColumns: ["user_id"]
          },
        ]
      }
      import_runs: {
        Row: {
          applied_at: string | null
          applied_by: string | null
          created_at: string
          created_by: string
          diff: Json
          error_message: string | null
          file_name: string
          file_sha256: string
          id: number
          status: "previewed" | "applied" | "discarded" | "failed"
          storage_path: string | null
          summary: Json
        }
        Insert: {
          applied_at?: string | null
          applied_by?: string | null
          created_at?: string
          created_by: string
          diff?: Json
          error_message?: string | null
          file_name: string
          file_sha256: string
          id?: number
          status: "previewed" | "applied" | "discarded" | "failed"
          storage_path?: string | null
          summary?: Json
        }
        Update: {
          applied_at?: string | null
          applied_by?: string | null
          created_at?: string
          created_by?: string
          diff?: Json
          error_message?: string | null
          file_name?: string
          file_sha256?: string
          id?: number
          status?: "previewed" | "applied" | "discarded" | "failed"
          storage_path?: string | null
          summary?: Json
        }
        Relationships: [
          {
            foreignKeyName: "import_runs_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_runs_applied_by_fkey"
            columns: ["applied_by"]
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
          must_change_password: boolean
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
          must_change_password?: boolean
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
          must_change_password?: boolean
          role?: Database["public"]["Enums"]["user_role"]
          verticals?: string[]
        }
        Relationships: []
      }
      tract_demographics: {
        Row: {
          fetched_at: string
          geoid: string
          households: number | null
          median_age: number | null
          median_household_income: number | null
          pct_bachelors: number | null
          population: number | null
          source: string
        }
        Insert: {
          fetched_at?: string
          geoid: string
          households?: number | null
          median_age?: number | null
          median_household_income?: number | null
          pct_bachelors?: number | null
          population?: number | null
          source: string
        }
        Update: {
          fetched_at?: string
          geoid?: string
          households?: number | null
          median_age?: number | null
          median_household_income?: number | null
          pct_bachelors?: number | null
          population?: number | null
          source?: string
        }
        Relationships: []
      }
      vertical_config: {
        Row: {
          active: boolean
          columns: Json
          description: string | null
          sort_order: number
          tab_prefix: string
          updated_at: string
          updated_by: string | null
          vertical: string
        }
        Insert: {
          active?: boolean
          columns?: Json
          description?: string | null
          sort_order: number
          tab_prefix: string
          updated_at?: string
          updated_by?: string | null
          vertical: string
        }
        Update: {
          active?: boolean
          columns?: Json
          description?: string | null
          sort_order?: number
          tab_prefix?: string
          updated_at?: string
          updated_by?: string | null
          vertical?: string
        }
        Relationships: [
          {
            foreignKeyName: "vertical_config_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profile_names"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vertical_config_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vertical_config_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "v_user_usage"
            referencedColumns: ["user_id"]
          },
        ]
      }
      source_tabs: {
        Row: {
          active: boolean
          client: string | null
          last_imported_at: string | null
          market: string | null
          row_count: number | null
          tab_name: string
          tab_prefix: string | null
        }
        Insert: {
          active?: boolean
          client?: string | null
          last_imported_at?: string | null
          market?: string | null
          row_count?: number | null
          tab_name: string
          tab_prefix?: string | null
        }
        Update: {
          active?: boolean
          client?: string | null
          last_imported_at?: string | null
          market?: string | null
          row_count?: number | null
          tab_name?: string
          tab_prefix?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "source_tabs_tab_prefix_fkey"
            columns: ["tab_prefix"]
            isOneToOne: false
            referencedRelation: "vertical_config"
            referencedColumns: ["tab_prefix"]
          },
        ]
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
          {
            foreignKeyName: "weekly_snapshots_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "v_user_usage"
            referencedColumns: ["user_id"]
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
      v_user_usage: {
        Row: {
          edits_7d: number | null
          last_active: string | null
          last_login: string | null
          logins_30d: number | null
          logins_7d: number | null
          page_views_7d: number | null
          top_page: string | null
          user_id: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      admin_logins_per_day: {
        Args: { days: number }
        Returns: {
          day: string
          login_count: number
        }[]
      }
      admin_rename_vertical: {
        Args: { new_vertical: string; old_vertical: string }
        Returns: undefined
      }
      admin_reorder_verticals: {
        Args: { prefixes: string[] }
        Returns: undefined
      }
      app_role: {
        Args: never
        Returns: Database["public"]["Enums"]["user_role"]
      }
      apply_import: {
        Args: { decisions?: Json; run_id: number }
        Returns: Json
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
          must_change_password: boolean
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
