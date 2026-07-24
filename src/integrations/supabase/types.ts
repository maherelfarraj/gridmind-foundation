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
      api_keys: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          expires_at: string | null
          id: string
          key_hash: string
          key_prefix: string
          last_used_at: string | null
          name: string
          revoked_at: string | null
          scopes: string[]
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          key_hash: string
          key_prefix: string
          last_used_at?: string | null
          name: string
          revoked_at?: string | null
          scopes?: string[]
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          key_hash?: string
          key_prefix?: string
          last_used_at?: string | null
          name?: string
          revoked_at?: string | null
          scopes?: string[]
          updated_at?: string
        }
        Relationships: []
      }
      approval_instances: {
        Row: {
          company_id: string
          created_at: string
          decided_at: string | null
          decided_by: string | null
          entity: string
          entity_id: string
          id: string
          metadata: Json
          requested_by: string | null
          status: string
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          entity: string
          entity_id: string
          id?: string
          metadata?: Json
          requested_by?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          entity?: string
          entity_id?: string
          id?: string
          metadata?: Json
          requested_by?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "approval_instances_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approval_instances_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approval_instances_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      approvals: {
        Row: {
          approver_id: string
          comment: string | null
          company_id: string
          created_at: string
          decided_at: string | null
          id: string
          instance_id: string
          status: string
          updated_at: string
        }
        Insert: {
          approver_id: string
          comment?: string | null
          company_id: string
          created_at?: string
          decided_at?: string | null
          id?: string
          instance_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          approver_id?: string
          comment?: string | null
          company_id?: string
          created_at?: string
          decided_at?: string | null
          id?: string
          instance_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "approvals_approver_id_fkey"
            columns: ["approver_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approvals_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approvals_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "approval_instances"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log_retention_policies: {
        Row: {
          company_id: string
          created_at: string
          entity: string
          id: string
          retention_days: number
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          entity: string
          id?: string
          retention_days?: number
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          entity?: string
          id?: string
          retention_days?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_retention_policies_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          actor_id: string | null
          company_id: string
          created_at: string
          entity: string
          entity_id: string | null
          id: string
          metadata: Json
        }
        Insert: {
          action: string
          actor_id?: string | null
          company_id: string
          created_at?: string
          entity: string
          entity_id?: string | null
          id?: string
          metadata?: Json
        }
        Update: {
          action?: string
          actor_id?: string | null
          company_id?: string
          created_at?: string
          entity?: string
          entity_id?: string | null
          id?: string
          metadata?: Json
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_logs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      companies: {
        Row: {
          address: string | null
          contact_email: string | null
          created_at: string
          id: string
          legal_name: string | null
          name: string
          phone: string | null
          plan_tier: string
          slug: string
          updated_at: string
        }
        Insert: {
          address?: string | null
          contact_email?: string | null
          created_at?: string
          id?: string
          legal_name?: string | null
          name: string
          phone?: string | null
          plan_tier?: string
          slug: string
          updated_at?: string
        }
        Update: {
          address?: string | null
          contact_email?: string | null
          created_at?: string
          id?: string
          legal_name?: string | null
          name?: string
          phone?: string | null
          plan_tier?: string
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      company_branding: {
        Row: {
          accent_color: string | null
          company_id: string
          created_at: string
          footer_text: string | null
          logo_url: string | null
          primary_color: string | null
          updated_at: string
        }
        Insert: {
          accent_color?: string | null
          company_id: string
          created_at?: string
          footer_text?: string | null
          logo_url?: string | null
          primary_color?: string | null
          updated_at?: string
        }
        Update: {
          accent_color?: string | null
          company_id?: string
          created_at?: string
          footer_text?: string | null
          logo_url?: string | null
          primary_color?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_branding_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      currencies: {
        Row: {
          code: string
          created_at: string
          minor_unit: number
          name: string
          symbol: string
        }
        Insert: {
          code: string
          created_at?: string
          minor_unit?: number
          name: string
          symbol: string
        }
        Update: {
          code?: string
          created_at?: string
          minor_unit?: number
          name?: string
          symbol?: string
        }
        Relationships: []
      }
      fx_rates: {
        Row: {
          as_of: string
          base_code: string
          created_at: string
          id: string
          quote_code: string
          rate: number
          source: string
        }
        Insert: {
          as_of: string
          base_code: string
          created_at?: string
          id?: string
          quote_code: string
          rate: number
          source?: string
        }
        Update: {
          as_of?: string
          base_code?: string
          created_at?: string
          id?: string
          quote_code?: string
          rate?: number
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "fx_rates_base_code_fkey"
            columns: ["base_code"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "fx_rates_quote_code_fkey"
            columns: ["quote_code"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
        ]
      }
      invites: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          company_id: string
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string
          role: Database["public"]["Enums"]["app_role"]
          status: Database["public"]["Enums"]["invite_status"]
          token_hash: string
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          company_id: string
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          invited_by: string
          role: Database["public"]["Enums"]["app_role"]
          status?: Database["public"]["Enums"]["invite_status"]
          token_hash: string
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          company_id?: string
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string
          role?: Database["public"]["Enums"]["app_role"]
          status?: Database["public"]["Enums"]["invite_status"]
          token_hash?: string
          updated_at?: string
        }
        Relationships: []
      }
      module_access_rules: {
        Row: {
          company_id: string
          created_at: string
          enabled: boolean
          id: string
          module: string
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          enabled?: boolean
          id?: string
          module: string
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          enabled?: boolean
          id?: string
          module?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "module_access_rules_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_prefs: {
        Row: {
          email_enabled: boolean
          in_app_enabled: boolean
          prefs: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          email_enabled?: boolean
          in_app_enabled?: boolean
          prefs?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          email_enabled?: boolean
          in_app_enabled?: boolean
          prefs?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_prefs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          company_id: string
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          locale: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          company_id: string
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          locale?: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          company_id?: string
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          locale?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      project_bess_config: {
        Row: {
          augmentation_strategy: string | null
          chemistry: string
          company_id: string
          container_count: number | null
          created_at: string
          cycles_per_day: number | null
          duration_hours: number | null
          energy_mwh: number | null
          id: string
          pcs_count: number | null
          power_mw: number | null
          project_id: string
          updated_at: string
        }
        Insert: {
          augmentation_strategy?: string | null
          chemistry?: string
          company_id: string
          container_count?: number | null
          created_at?: string
          cycles_per_day?: number | null
          duration_hours?: number | null
          energy_mwh?: number | null
          id?: string
          pcs_count?: number | null
          power_mw?: number | null
          project_id: string
          updated_at?: string
        }
        Update: {
          augmentation_strategy?: string | null
          chemistry?: string
          company_id?: string
          container_count?: number | null
          created_at?: string
          cycles_per_day?: number | null
          duration_hours?: number | null
          energy_mwh?: number | null
          id?: string
          pcs_count?: number | null
          power_mw?: number | null
          project_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_bess_config_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_bess_config_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: true
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_cybersecurity_config: {
        Row: {
          company_id: string
          created_at: string
          id: string
          project_id: string
          remote_access_policy: string | null
          soc_monitoring: boolean
          standard: string
          updated_at: string
          zones_conduits: Json
        }
        Insert: {
          company_id: string
          created_at?: string
          id?: string
          project_id: string
          remote_access_policy?: string | null
          soc_monitoring?: boolean
          standard?: string
          updated_at?: string
          zones_conduits?: Json
        }
        Update: {
          company_id?: string
          created_at?: string
          id?: string
          project_id?: string
          remote_access_policy?: string | null
          soc_monitoring?: boolean
          standard?: string
          updated_at?: string
          zones_conduits?: Json
        }
        Relationships: [
          {
            foreignKeyName: "project_cybersecurity_config_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_cybersecurity_config_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: true
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_departments: {
        Row: {
          company_id: string
          created_at: string
          department: Database["public"]["Enums"]["project_department"]
          id: string
          lead_user_id: string | null
          project_id: string
          started_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          department: Database["public"]["Enums"]["project_department"]
          id?: string
          lead_user_id?: string | null
          project_id: string
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          department?: Database["public"]["Enums"]["project_department"]
          id?: string
          lead_user_id?: string | null
          project_id?: string
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_departments_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_departments_lead_user_id_fkey"
            columns: ["lead_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_departments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_financial_config: {
        Row: {
          capex_total: number | null
          company_id: string
          contingency_pct: number | null
          contract_years: number | null
          created_at: string
          currency_code: string
          debt_ratio_pct: number | null
          discount_rate_pct: number | null
          id: string
          ppa_price: number | null
          project_id: string
          updated_at: string
        }
        Insert: {
          capex_total?: number | null
          company_id: string
          contingency_pct?: number | null
          contract_years?: number | null
          created_at?: string
          currency_code?: string
          debt_ratio_pct?: number | null
          discount_rate_pct?: number | null
          id?: string
          ppa_price?: number | null
          project_id: string
          updated_at?: string
        }
        Update: {
          capex_total?: number | null
          company_id?: string
          contingency_pct?: number | null
          contract_years?: number | null
          created_at?: string
          currency_code?: string
          debt_ratio_pct?: number | null
          discount_rate_pct?: number | null
          id?: string
          ppa_price?: number | null
          project_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_financial_config_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_financial_config_currency_code_fkey"
            columns: ["currency_code"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "project_financial_config_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: true
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_members: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          id: string
          project_id: string
          project_role: string
          updated_at: string
          user_id: string
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          project_id: string
          project_role?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          project_id?: string
          project_role?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_members_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_members_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_members_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      project_phase_gates: {
        Row: {
          approval_instance_id: string | null
          approved_at: string | null
          approved_by: string | null
          checklist: Json
          company_id: string
          created_at: string
          id: string
          name: string
          phase: Database["public"]["Enums"]["project_phase"]
          project_id: string
          sort_order: number
          status: string
          updated_at: string
        }
        Insert: {
          approval_instance_id?: string | null
          approved_at?: string | null
          approved_by?: string | null
          checklist?: Json
          company_id: string
          created_at?: string
          id?: string
          name: string
          phase: Database["public"]["Enums"]["project_phase"]
          project_id: string
          sort_order: number
          status?: string
          updated_at?: string
        }
        Update: {
          approval_instance_id?: string | null
          approved_at?: string | null
          approved_by?: string | null
          checklist?: Json
          company_id?: string
          created_at?: string
          id?: string
          name?: string
          phase?: Database["public"]["Enums"]["project_phase"]
          project_id?: string
          sort_order?: number
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "gates_approval_fk"
            columns: ["approval_instance_id"]
            isOneToOne: false
            referencedRelation: "approval_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_phase_gates_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_phase_gates_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_phase_gates_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_pv_config: {
        Row: {
          company_id: string
          created_at: string
          dc_ac_ratio: number | null
          dc_capacity_mwp: number | null
          gcr: number | null
          id: string
          inverter_count: number | null
          module_type: string | null
          project_id: string
          tilt_deg: number | null
          tracker_type: string
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          dc_ac_ratio?: number | null
          dc_capacity_mwp?: number | null
          gcr?: number | null
          id?: string
          inverter_count?: number | null
          module_type?: string | null
          project_id: string
          tilt_deg?: number | null
          tracker_type?: string
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          dc_ac_ratio?: number | null
          dc_capacity_mwp?: number | null
          gcr?: number | null
          id?: string
          inverter_count?: number | null
          module_type?: string | null
          project_id?: string
          tilt_deg?: number | null
          tracker_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_pv_config_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_pv_config_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: true
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_pvsyst_config: {
        Row: {
          albedo: number | null
          bifacial: boolean
          company_id: string
          created_at: string
          id: string
          meteo_source: string | null
          near_shading_pct: number | null
          project_id: string
          pvsyst_version: string | null
          sim_report_url: string | null
          updated_at: string
        }
        Insert: {
          albedo?: number | null
          bifacial?: boolean
          company_id: string
          created_at?: string
          id?: string
          meteo_source?: string | null
          near_shading_pct?: number | null
          project_id: string
          pvsyst_version?: string | null
          sim_report_url?: string | null
          updated_at?: string
        }
        Update: {
          albedo?: number | null
          bifacial?: boolean
          company_id?: string
          created_at?: string
          id?: string
          meteo_source?: string | null
          near_shading_pct?: number | null
          project_id?: string
          pvsyst_version?: string | null
          sim_report_url?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_pvsyst_config_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_pvsyst_config_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: true
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_scada_config: {
        Row: {
          company_id: string
          created_at: string
          historian_retention_days: number
          id: string
          points_count: number | null
          polling_interval_sec: number
          project_id: string
          protocol: string
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          historian_retention_days?: number
          id?: string
          points_count?: number | null
          polling_interval_sec?: number
          project_id: string
          protocol?: string
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          historian_retention_days?: number
          id?: string
          points_count?: number | null
          polling_interval_sec?: number
          project_id?: string
          protocol?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_scada_config_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_scada_config_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: true
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_sld_config: {
        Row: {
          company_id: string
          created_at: string
          hv_voltage_kv: number | null
          id: string
          lv_voltage_kv: number | null
          mv_voltage_kv: number | null
          project_id: string
          updated_at: string
          voltage_levels: Json
        }
        Insert: {
          company_id: string
          created_at?: string
          hv_voltage_kv?: number | null
          id?: string
          lv_voltage_kv?: number | null
          mv_voltage_kv?: number | null
          project_id: string
          updated_at?: string
          voltage_levels?: Json
        }
        Update: {
          company_id?: string
          created_at?: string
          hv_voltage_kv?: number | null
          id?: string
          lv_voltage_kv?: number | null
          mv_voltage_kv?: number | null
          project_id?: string
          updated_at?: string
          voltage_levels?: Json
        }
        Relationships: [
          {
            foreignKeyName: "project_sld_config_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_sld_config_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: true
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_substation_config: {
        Row: {
          bay_count: number | null
          busbar_scheme: string | null
          company_id: string
          created_at: string
          grid_code: string | null
          id: string
          project_id: string
          transformer_count: number | null
          transformer_mva: number | null
          updated_at: string
          voltage_kv: number | null
        }
        Insert: {
          bay_count?: number | null
          busbar_scheme?: string | null
          company_id: string
          created_at?: string
          grid_code?: string | null
          id?: string
          project_id: string
          transformer_count?: number | null
          transformer_mva?: number | null
          updated_at?: string
          voltage_kv?: number | null
        }
        Update: {
          bay_count?: number | null
          busbar_scheme?: string | null
          company_id?: string
          created_at?: string
          grid_code?: string | null
          id?: string
          project_id?: string
          transformer_count?: number | null
          transformer_mva?: number | null
          updated_at?: string
          voltage_kv?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "project_substation_config_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_substation_config_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: true
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_templates: {
        Row: {
          archetype: Database["public"]["Enums"]["project_archetype"]
          company_id: string
          created_at: string
          created_by: string | null
          default_budget_lines: Json
          default_departments: Database["public"]["Enums"]["project_department"][]
          default_gates: Json
          description: string | null
          id: string
          is_system: boolean
          name: string
          updated_at: string
        }
        Insert: {
          archetype: Database["public"]["Enums"]["project_archetype"]
          company_id: string
          created_at?: string
          created_by?: string | null
          default_budget_lines?: Json
          default_departments?: Database["public"]["Enums"]["project_department"][]
          default_gates?: Json
          description?: string | null
          id?: string
          is_system?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          archetype?: Database["public"]["Enums"]["project_archetype"]
          company_id?: string
          created_at?: string
          created_by?: string | null
          default_budget_lines?: Json
          default_departments?: Database["public"]["Enums"]["project_department"][]
          default_gates?: Json
          description?: string | null
          id?: string
          is_system?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_templates_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_templates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      project_yield_config: {
        Row: {
          availability_pct: number | null
          company_id: string
          created_at: string
          degradation_pct: number | null
          ghi_kwh_m2: number | null
          id: string
          losses_pct: number | null
          p50_mwh: number | null
          p90_mwh: number | null
          project_id: string
          updated_at: string
        }
        Insert: {
          availability_pct?: number | null
          company_id: string
          created_at?: string
          degradation_pct?: number | null
          ghi_kwh_m2?: number | null
          id?: string
          losses_pct?: number | null
          p50_mwh?: number | null
          p90_mwh?: number | null
          project_id: string
          updated_at?: string
        }
        Update: {
          availability_pct?: number | null
          company_id?: string
          created_at?: string
          degradation_pct?: number | null
          ghi_kwh_m2?: number | null
          id?: string
          losses_pct?: number | null
          p50_mwh?: number | null
          p90_mwh?: number | null
          project_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_yield_config_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_yield_config_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: true
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          archetype: Database["public"]["Enums"]["project_archetype"]
          capacity_mw: number | null
          capacity_mwh: number | null
          code: string
          company_id: string
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          name: string
          offtaker: string | null
          phase: Database["public"]["Enums"]["project_phase"]
          project_admin_id: string | null
          site_country: string | null
          site_lat: number | null
          site_lng: number | null
          site_name: string | null
          site_region: string | null
          status: Database["public"]["Enums"]["project_status"]
          target_cod: string | null
          template_id: string | null
          updated_at: string
        }
        Insert: {
          archetype: Database["public"]["Enums"]["project_archetype"]
          capacity_mw?: number | null
          capacity_mwh?: number | null
          code: string
          company_id: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name: string
          offtaker?: string | null
          phase?: Database["public"]["Enums"]["project_phase"]
          project_admin_id?: string | null
          site_country?: string | null
          site_lat?: number | null
          site_lng?: number | null
          site_name?: string | null
          site_region?: string | null
          status?: Database["public"]["Enums"]["project_status"]
          target_cod?: string | null
          template_id?: string | null
          updated_at?: string
        }
        Update: {
          archetype?: Database["public"]["Enums"]["project_archetype"]
          capacity_mw?: number | null
          capacity_mwh?: number | null
          code?: string
          company_id?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name?: string
          offtaker?: string | null
          phase?: Database["public"]["Enums"]["project_phase"]
          project_admin_id?: string | null
          site_country?: string | null
          site_lat?: number | null
          site_lng?: number | null
          site_name?: string | null
          site_region?: string | null
          status?: Database["public"]["Enums"]["project_status"]
          target_cod?: string | null
          template_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_project_admin_id_fkey"
            columns: ["project_admin_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_template_fk"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "project_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      rate_limit_buckets: {
        Row: {
          capacity: number
          key: string
          refill_per_sec: number
          tokens: number
          updated_at: string
        }
        Insert: {
          capacity: number
          key: string
          refill_per_sec: number
          tokens: number
          updated_at?: string
        }
        Update: {
          capacity?: number
          key?: string
          refill_per_sec?: number
          tokens?: number
          updated_at?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          company_id: string
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          updated_at: string
          user_id: string
        }
        Insert: {
          company_id: string
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          updated_at?: string
          user_id: string
        }
        Update: {
          company_id?: string
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_roles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      webhook_deliveries: {
        Row: {
          attempts: number
          company_id: string
          created_at: string
          delivered_at: string | null
          endpoint_id: string
          event: string
          id: string
          next_retry_at: string | null
          payload: Json
          response_body: string | null
          response_status: number | null
          status: Database["public"]["Enums"]["delivery_status"]
          updated_at: string
        }
        Insert: {
          attempts?: number
          company_id: string
          created_at?: string
          delivered_at?: string | null
          endpoint_id: string
          event: string
          id?: string
          next_retry_at?: string | null
          payload?: Json
          response_body?: string | null
          response_status?: number | null
          status?: Database["public"]["Enums"]["delivery_status"]
          updated_at?: string
        }
        Update: {
          attempts?: number
          company_id?: string
          created_at?: string
          delivered_at?: string | null
          endpoint_id?: string
          event?: string
          id?: string
          next_retry_at?: string | null
          payload?: Json
          response_body?: string | null
          response_status?: number | null
          status?: Database["public"]["Enums"]["delivery_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "webhook_deliveries_endpoint_id_fkey"
            columns: ["endpoint_id"]
            isOneToOne: false
            referencedRelation: "webhook_endpoints"
            referencedColumns: ["id"]
          },
        ]
      }
      webhook_endpoints: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          description: string | null
          events: string[]
          id: string
          is_active: boolean
          signing_secret_hash: string
          updated_at: string
          url: string
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          events?: string[]
          id?: string
          is_active?: boolean
          signing_secret_hash: string
          updated_at?: string
          url: string
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          events?: string[]
          id?: string
          is_active?: boolean
          signing_secret_hash?: string
          updated_at?: string
          url?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      assert_can_grant_role: {
        Args: {
          p_company_id: string
          p_role: Database["public"]["Enums"]["app_role"]
          p_target_user_id: string
        }
        Returns: undefined
      }
      consume_rate_limit: {
        Args: { p_capacity: number; p_key: string; p_refill_per_sec: number }
        Returns: boolean
      }
      create_invite: {
        Args: {
          p_company_id: string
          p_email: string
          p_role: Database["public"]["Enums"]["app_role"]
        }
        Returns: string
      }
      has_company_role: {
        Args: { p_role: Database["public"]["Enums"]["app_role"] }
        Returns: boolean
      }
      has_module_access: {
        Args: { p_company_id: string; p_module: string }
        Returns: boolean
      }
      has_role: {
        Args: {
          p_role: Database["public"]["Enums"]["app_role"]
          p_user_id: string
        }
        Returns: boolean
      }
      is_company_admin: { Args: { _company_id: string }; Returns: boolean }
      is_company_member: { Args: { p_company_id: string }; Returns: boolean }
      redeem_invite: { Args: { p_token: string }; Returns: string }
      storage_company_id: { Args: { p_name: string }; Returns: string }
      verify_api_key: {
        Args: { p_raw_key: string }
        Returns: {
          company_id: string
          key_id: string
          scopes: string[]
        }[]
      }
      write_audit_log: {
        Args: {
          p_action: string
          p_entity: string
          p_entity_id: string
          p_metadata?: Json
        }
        Returns: string
      }
    }
    Enums: {
      app_role:
        | "super_admin"
        | "company_admin"
        | "billing_admin"
        | "project_admin"
        | "engineering_admin"
        | "procurement_admin"
        | "construction_admin"
        | "hse_admin"
        | "finance_admin"
        | "legal_admin"
        | "om_admin"
        | "scada_admin"
        | "engineer"
        | "sales"
        | "procurement_officer"
        | "foreman"
        | "field_technician"
        | "client_viewer"
        | "investor_viewer"
        | "lender_viewer"
      delivery_status: "pending" | "success" | "failed"
      invite_status: "pending" | "accepted" | "revoked" | "expired"
      project_archetype:
        | "utility_pv"
        | "standalone_bess"
        | "c_and_i_rooftop"
        | "hybrid_pv_bess"
        | "onshore_wind"
        | "green_hydrogen"
        | "transmission_substation"
      project_department:
        | "engineering"
        | "procurement"
        | "construction"
        | "hse"
        | "finance"
        | "legal"
        | "om"
        | "scada"
        | "billing"
      project_phase: "development" | "ntp" | "cod" | "handover"
      project_status: "active" | "on_hold" | "completed" | "archived"
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
    Enums: {
      app_role: [
        "super_admin",
        "company_admin",
        "billing_admin",
        "project_admin",
        "engineering_admin",
        "procurement_admin",
        "construction_admin",
        "hse_admin",
        "finance_admin",
        "legal_admin",
        "om_admin",
        "scada_admin",
        "engineer",
        "sales",
        "procurement_officer",
        "foreman",
        "field_technician",
        "client_viewer",
        "investor_viewer",
        "lender_viewer",
      ],
      delivery_status: ["pending", "success", "failed"],
      invite_status: ["pending", "accepted", "revoked", "expired"],
      project_archetype: [
        "utility_pv",
        "standalone_bess",
        "c_and_i_rooftop",
        "hybrid_pv_bess",
        "onshore_wind",
        "green_hydrogen",
        "transmission_substation",
      ],
      project_department: [
        "engineering",
        "procurement",
        "construction",
        "hse",
        "finance",
        "legal",
        "om",
        "scada",
        "billing",
      ],
      project_phase: ["development", "ntp", "cod", "handover"],
      project_status: ["active", "on_hold", "completed", "archived"],
    },
  },
} as const
