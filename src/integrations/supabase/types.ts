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
      alarm_rules: {
        Row: {
          company_id: string
          condition: Database["public"]["Enums"]["alarm_condition"]
          created_at: string
          created_by: string | null
          dead_band: number
          duration_seconds: number
          enabled: boolean
          escalation_route: Json
          id: string
          metric: string
          name: string
          project_id: string | null
          severity: Database["public"]["Enums"]["alarm_severity"]
          threshold: number
          updated_at: string
        }
        Insert: {
          company_id: string
          condition: Database["public"]["Enums"]["alarm_condition"]
          created_at?: string
          created_by?: string | null
          dead_band?: number
          duration_seconds?: number
          enabled?: boolean
          escalation_route?: Json
          id?: string
          metric: string
          name: string
          project_id?: string | null
          severity?: Database["public"]["Enums"]["alarm_severity"]
          threshold: number
          updated_at?: string
        }
        Update: {
          company_id?: string
          condition?: Database["public"]["Enums"]["alarm_condition"]
          created_at?: string
          created_by?: string | null
          dead_band?: number
          duration_seconds?: number
          enabled?: boolean
          escalation_route?: Json
          id?: string
          metric?: string
          name?: string
          project_id?: string | null
          severity?: Database["public"]["Enums"]["alarm_severity"]
          threshold?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "alarm_rules_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alarm_rules_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alarm_rules_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      api_keys: {
        Row: {
          allowed_ips: string[]
          company_id: string
          created_at: string
          created_by: string | null
          expires_at: string | null
          hmac_secret: string | null
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
          allowed_ips?: string[]
          company_id: string
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          hmac_secret?: string | null
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
          allowed_ips?: string[]
          company_id?: string
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          hmac_secret?: string | null
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
      approval_chain_steps: {
        Row: {
          company_id: string
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          rule_id: string
          sla_hours: number | null
          step_order: number
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          rule_id: string
          sla_hours?: number | null
          step_order: number
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          rule_id?: string
          sla_hours?: number | null
          step_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "approval_chain_steps_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approval_chain_steps_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "approval_rules"
            referencedColumns: ["id"]
          },
        ]
      }
      approval_instances: {
        Row: {
          amount: number | null
          company_id: string
          completed_at: string | null
          created_at: string
          current_step: number
          decided_at: string | null
          decided_by: string | null
          entity: string
          entity_id: string
          entity_type: string
          id: string
          metadata: Json
          requested_at: string
          requested_by: string | null
          rule_id: string | null
          rule_key: string | null
          sla_due_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          amount?: number | null
          company_id: string
          completed_at?: string | null
          created_at?: string
          current_step?: number
          decided_at?: string | null
          decided_by?: string | null
          entity: string
          entity_id: string
          entity_type?: string
          id?: string
          metadata?: Json
          requested_at?: string
          requested_by?: string | null
          rule_id?: string | null
          rule_key?: string | null
          sla_due_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          amount?: number | null
          company_id?: string
          completed_at?: string | null
          created_at?: string
          current_step?: number
          decided_at?: string | null
          decided_by?: string | null
          entity?: string
          entity_id?: string
          entity_type?: string
          id?: string
          metadata?: Json
          requested_at?: string
          requested_by?: string | null
          rule_id?: string | null
          rule_key?: string | null
          sla_due_at?: string | null
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
          {
            foreignKeyName: "approval_instances_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "approval_rules"
            referencedColumns: ["id"]
          },
        ]
      }
      approval_rules: {
        Row: {
          blocks_export: boolean
          company_id: string
          created_at: string
          created_by: string | null
          description: string | null
          entity_type: string
          escalation_role: Database["public"]["Enums"]["app_role"] | null
          id: string
          is_active: boolean
          name: string
          rule_key: string
          sla_hours: number
          threshold_amount: number | null
          threshold_currency: string
          updated_at: string
        }
        Insert: {
          blocks_export?: boolean
          company_id: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          entity_type: string
          escalation_role?: Database["public"]["Enums"]["app_role"] | null
          id?: string
          is_active?: boolean
          name: string
          rule_key: string
          sla_hours?: number
          threshold_amount?: number | null
          threshold_currency?: string
          updated_at?: string
        }
        Update: {
          blocks_export?: boolean
          company_id?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          entity_type?: string
          escalation_role?: Database["public"]["Enums"]["app_role"] | null
          id?: string
          is_active?: boolean
          name?: string
          rule_key?: string
          sla_hours?: number
          threshold_amount?: number | null
          threshold_currency?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "approval_rules_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approval_rules_created_by_fkey"
            columns: ["created_by"]
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
          due_at: string | null
          id: string
          instance_id: string
          status: string
          step_id: string | null
          step_order: number
          updated_at: string
        }
        Insert: {
          approver_id: string
          comment?: string | null
          company_id: string
          created_at?: string
          decided_at?: string | null
          due_at?: string | null
          id?: string
          instance_id: string
          status?: string
          step_id?: string | null
          step_order?: number
          updated_at?: string
        }
        Update: {
          approver_id?: string
          comment?: string | null
          company_id?: string
          created_at?: string
          decided_at?: string | null
          due_at?: string | null
          id?: string
          instance_id?: string
          status?: string
          step_id?: string | null
          step_order?: number
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
          {
            foreignKeyName: "approvals_step_id_fkey"
            columns: ["step_id"]
            isOneToOne: false
            referencedRelation: "approval_chain_steps"
            referencedColumns: ["id"]
          },
        ]
      }
      asset_nodes: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          equipment_id: string | null
          id: string
          metadata: Json
          name: string
          node_type: Database["public"]["Enums"]["asset_node_type"]
          parent_id: string | null
          project_id: string
          scada_asset_id: string | null
          sort_order: number
          tag: string | null
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          equipment_id?: string | null
          id?: string
          metadata?: Json
          name: string
          node_type: Database["public"]["Enums"]["asset_node_type"]
          parent_id?: string | null
          project_id: string
          scada_asset_id?: string | null
          sort_order?: number
          tag?: string | null
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          equipment_id?: string | null
          id?: string
          metadata?: Json
          name?: string
          node_type?: Database["public"]["Enums"]["asset_node_type"]
          parent_id?: string | null
          project_id?: string
          scada_asset_id?: string | null
          sort_order?: number
          tag?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "asset_nodes_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_nodes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_nodes_equipment_id_fkey"
            columns: ["equipment_id"]
            isOneToOne: false
            referencedRelation: "equipment_registry"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_nodes_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "asset_nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_nodes_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_nodes_scada_asset_id_fkey"
            columns: ["scada_asset_id"]
            isOneToOne: false
            referencedRelation: "scada_assets"
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
      bank_facilities: {
        Row: {
          commitment_amount: number
          company_id: string
          covenants: Json
          created_at: string
          created_by: string | null
          currency_code: string
          drawn_amount: number
          facility_type: Database["public"]["Enums"]["facility_type"]
          id: string
          interest_rate_pct: number | null
          lender_name: string
          margin_pct: number | null
          maturity_date: string | null
          project_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          commitment_amount: number
          company_id: string
          covenants?: Json
          created_at?: string
          created_by?: string | null
          currency_code: string
          drawn_amount?: number
          facility_type: Database["public"]["Enums"]["facility_type"]
          id?: string
          interest_rate_pct?: number | null
          lender_name: string
          margin_pct?: number | null
          maturity_date?: string | null
          project_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          commitment_amount?: number
          company_id?: string
          covenants?: Json
          created_at?: string
          created_by?: string | null
          currency_code?: string
          drawn_amount?: number
          facility_type?: Database["public"]["Enums"]["facility_type"]
          id?: string
          interest_rate_pct?: number | null
          lender_name?: string
          margin_pct?: number | null
          maturity_date?: string | null
          project_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bank_facilities_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_facilities_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_facilities_currency_code_fkey"
            columns: ["currency_code"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "bank_facilities_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      baseline_snapshots: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          id: string
          locked: boolean
          locked_at: string | null
          locked_by: string | null
          name: string
          notes: string | null
          project_id: string
          snapshot: Json
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          locked?: boolean
          locked_at?: string | null
          locked_by?: string | null
          name: string
          notes?: string | null
          project_id: string
          snapshot?: Json
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          locked?: boolean
          locked_at?: string | null
          locked_by?: string | null
          name?: string
          notes?: string | null
          project_id?: string
          snapshot?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "baseline_snapshots_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "baseline_snapshots_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "baseline_snapshots_locked_by_fkey"
            columns: ["locked_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "baseline_snapshots_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      bom_lines: {
        Row: {
          buffer_pct: number
          category: string
          company_id: string
          created_at: string
          id: string
          item: string
          notes: string | null
          qty: number
          qty_buffered: number
          snapshot_id: string
          spec: string | null
          unit: string
          unit_cost: number | null
          updated_at: string
        }
        Insert: {
          buffer_pct?: number
          category: string
          company_id: string
          created_at?: string
          id?: string
          item: string
          notes?: string | null
          qty?: number
          qty_buffered?: number
          snapshot_id: string
          spec?: string | null
          unit?: string
          unit_cost?: number | null
          updated_at?: string
        }
        Update: {
          buffer_pct?: number
          category?: string
          company_id?: string
          created_at?: string
          id?: string
          item?: string
          notes?: string | null
          qty?: number
          qty_buffered?: number
          snapshot_id?: string
          spec?: string | null
          unit?: string
          unit_cost?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bom_lines_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bom_lines_snapshot_id_fkey"
            columns: ["snapshot_id"]
            isOneToOne: false
            referencedRelation: "bom_snapshots"
            referencedColumns: ["id"]
          },
        ]
      }
      bom_snapshots: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          id: string
          params: Json
          project_id: string
          status: string
          totals: Json
          updated_at: string
          version: number
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          params?: Json
          project_id: string
          status?: string
          totals?: Json
          updated_at?: string
          version: number
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          params?: Json
          project_id?: string
          status?: string
          totals?: Json
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "bom_snapshots_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bom_snapshots_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      budgets: {
        Row: {
          actual_amount: number
          approved_changes: number
          committed_amount: number
          company_id: string
          cost_code_id: string
          created_at: string
          created_by: string | null
          currency_code: string
          current_amount: number | null
          id: string
          notes: string | null
          original_amount: number
          po_commitments: Json
          project_id: string
          updated_at: string
          version: number
          wbs_item_id: string | null
        }
        Insert: {
          actual_amount?: number
          approved_changes?: number
          committed_amount?: number
          company_id: string
          cost_code_id: string
          created_at?: string
          created_by?: string | null
          currency_code: string
          current_amount?: number | null
          id?: string
          notes?: string | null
          original_amount?: number
          po_commitments?: Json
          project_id: string
          updated_at?: string
          version?: number
          wbs_item_id?: string | null
        }
        Update: {
          actual_amount?: number
          approved_changes?: number
          committed_amount?: number
          company_id?: string
          cost_code_id?: string
          created_at?: string
          created_by?: string | null
          currency_code?: string
          current_amount?: number | null
          id?: string
          notes?: string | null
          original_amount?: number
          po_commitments?: Json
          project_id?: string
          updated_at?: string
          version?: number
          wbs_item_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "budgets_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budgets_cost_code_id_fkey"
            columns: ["cost_code_id"]
            isOneToOne: false
            referencedRelation: "cost_codes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budgets_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budgets_currency_code_fkey"
            columns: ["currency_code"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "budgets_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budgets_wbs_item_id_fkey"
            columns: ["wbs_item_id"]
            isOneToOne: false
            referencedRelation: "wbs_items"
            referencedColumns: ["id"]
          },
        ]
      }
      cash_flows: {
        Row: {
          amount: number
          amount_base: number | null
          base_currency_code: string | null
          category: string
          company_id: string
          created_at: string
          created_by: string | null
          currency_code: string
          direction: Database["public"]["Enums"]["cash_flow_direction"]
          fx_rate_to_base: number | null
          id: string
          kind: Database["public"]["Enums"]["cash_flow_kind"]
          notes: string | null
          period: string
          project_id: string
          reference_id: string | null
          reference_type: string | null
          updated_at: string
          voided: boolean
          voided_at: string | null
          voided_by: string | null
        }
        Insert: {
          amount: number
          amount_base?: number | null
          base_currency_code?: string | null
          category: string
          company_id: string
          created_at?: string
          created_by?: string | null
          currency_code: string
          direction: Database["public"]["Enums"]["cash_flow_direction"]
          fx_rate_to_base?: number | null
          id?: string
          kind: Database["public"]["Enums"]["cash_flow_kind"]
          notes?: string | null
          period: string
          project_id: string
          reference_id?: string | null
          reference_type?: string | null
          updated_at?: string
          voided?: boolean
          voided_at?: string | null
          voided_by?: string | null
        }
        Update: {
          amount?: number
          amount_base?: number | null
          base_currency_code?: string | null
          category?: string
          company_id?: string
          created_at?: string
          created_by?: string | null
          currency_code?: string
          direction?: Database["public"]["Enums"]["cash_flow_direction"]
          fx_rate_to_base?: number | null
          id?: string
          kind?: Database["public"]["Enums"]["cash_flow_kind"]
          notes?: string | null
          period?: string
          project_id?: string
          reference_id?: string | null
          reference_type?: string | null
          updated_at?: string
          voided?: boolean
          voided_at?: string | null
          voided_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cash_flows_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_flows_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_flows_currency_code_fkey"
            columns: ["currency_code"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "cash_flows_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_flows_voided_by_fkey"
            columns: ["voided_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      change_orders: {
        Row: {
          amount: number
          approval_instance_id: string | null
          approved_at: string | null
          approved_by: string | null
          budget_impact: Json
          co_number: string
          company_id: string
          contract_id: string | null
          created_at: string
          created_by: string | null
          currency_code: string | null
          description: string | null
          id: string
          project_id: string
          schedule_impact_days: number
          status: Database["public"]["Enums"]["change_order_status"]
          submitted_at: string | null
          submitted_by: string | null
          title: string
          updated_at: string
          wbs_item_id: string | null
        }
        Insert: {
          amount?: number
          approval_instance_id?: string | null
          approved_at?: string | null
          approved_by?: string | null
          budget_impact?: Json
          co_number: string
          company_id: string
          contract_id?: string | null
          created_at?: string
          created_by?: string | null
          currency_code?: string | null
          description?: string | null
          id?: string
          project_id: string
          schedule_impact_days?: number
          status?: Database["public"]["Enums"]["change_order_status"]
          submitted_at?: string | null
          submitted_by?: string | null
          title: string
          updated_at?: string
          wbs_item_id?: string | null
        }
        Update: {
          amount?: number
          approval_instance_id?: string | null
          approved_at?: string | null
          approved_by?: string | null
          budget_impact?: Json
          co_number?: string
          company_id?: string
          contract_id?: string | null
          created_at?: string
          created_by?: string | null
          currency_code?: string | null
          description?: string | null
          id?: string
          project_id?: string
          schedule_impact_days?: number
          status?: Database["public"]["Enums"]["change_order_status"]
          submitted_at?: string | null
          submitted_by?: string | null
          title?: string
          updated_at?: string
          wbs_item_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "change_orders_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "change_orders_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "change_orders_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "change_orders_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "change_orders_currency_code_fkey"
            columns: ["currency_code"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "change_orders_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "change_orders_submitted_by_fkey"
            columns: ["submitted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "change_orders_wbs_item_id_fkey"
            columns: ["wbs_item_id"]
            isOneToOne: false
            referencedRelation: "wbs_items"
            referencedColumns: ["id"]
          },
        ]
      }
      civil_features: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          feature_ref: string
          feature_type: Database["public"]["Enums"]["civil_feature_type"]
          geometry: Json
          id: string
          name: string
          project_id: string
          properties: Json
          revision_code: string
          status: string
          surface_id: string | null
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          feature_ref: string
          feature_type: Database["public"]["Enums"]["civil_feature_type"]
          geometry: Json
          id?: string
          name: string
          project_id: string
          properties?: Json
          revision_code?: string
          status?: string
          surface_id?: string | null
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          feature_ref?: string
          feature_type?: Database["public"]["Enums"]["civil_feature_type"]
          geometry?: Json
          id?: string
          name?: string
          project_id?: string
          properties?: Json
          revision_code?: string
          status?: string
          surface_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "civil_features_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "civil_features_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "civil_features_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "civil_features_surface_id_fkey"
            columns: ["surface_id"]
            isOneToOne: false
            referencedRelation: "terrain_surfaces"
            referencedColumns: ["id"]
          },
        ]
      }
      commissioning_certificates: {
        Row: {
          certificate_number: string
          certificate_type: Database["public"]["Enums"]["commissioning_certificate_type"]
          company_id: string
          created_at: string
          created_by: string | null
          effective_date: string | null
          id: string
          payload: Json
          pr_at_cod: number | null
          project_id: string
          signatures: Json
          signed_pdf_path: string | null
          status: string
          updated_at: string
        }
        Insert: {
          certificate_number: string
          certificate_type: Database["public"]["Enums"]["commissioning_certificate_type"]
          company_id: string
          created_at?: string
          created_by?: string | null
          effective_date?: string | null
          id?: string
          payload?: Json
          pr_at_cod?: number | null
          project_id: string
          signatures?: Json
          signed_pdf_path?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          certificate_number?: string
          certificate_type?: Database["public"]["Enums"]["commissioning_certificate_type"]
          company_id?: string
          created_at?: string
          created_by?: string | null
          effective_date?: string | null
          id?: string
          payload?: Json
          pr_at_cod?: number | null
          project_id?: string
          signatures?: Json
          signed_pdf_path?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "commissioning_certificates_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commissioning_certificates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commissioning_certificates_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      commissioning_tests: {
        Row: {
          area: string
          assigned_to: string | null
          company_id: string
          completed_at: string | null
          created_at: string
          created_by: string | null
          equipment_ref: string | null
          id: string
          notes: string | null
          planned_date: string | null
          project_id: string
          result: Json
          started_at: string | null
          status: Database["public"]["Enums"]["commissioning_test_status"]
          string_ref: string | null
          test_type: Database["public"]["Enums"]["commissioning_test_type"]
          updated_at: string
          utility_witness_name: string | null
          utility_witness_required: boolean
          utility_witnessed_at: string | null
          witness_file_path: string | null
        }
        Insert: {
          area: string
          assigned_to?: string | null
          company_id: string
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          equipment_ref?: string | null
          id?: string
          notes?: string | null
          planned_date?: string | null
          project_id: string
          result?: Json
          started_at?: string | null
          status?: Database["public"]["Enums"]["commissioning_test_status"]
          string_ref?: string | null
          test_type: Database["public"]["Enums"]["commissioning_test_type"]
          updated_at?: string
          utility_witness_name?: string | null
          utility_witness_required?: boolean
          utility_witnessed_at?: string | null
          witness_file_path?: string | null
        }
        Update: {
          area?: string
          assigned_to?: string | null
          company_id?: string
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          equipment_ref?: string | null
          id?: string
          notes?: string | null
          planned_date?: string | null
          project_id?: string
          result?: Json
          started_at?: string | null
          status?: Database["public"]["Enums"]["commissioning_test_status"]
          string_ref?: string | null
          test_type?: Database["public"]["Enums"]["commissioning_test_type"]
          updated_at?: string
          utility_witness_name?: string | null
          utility_witness_required?: boolean
          utility_witnessed_at?: string | null
          witness_file_path?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "commissioning_tests_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commissioning_tests_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commissioning_tests_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commissioning_tests_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
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
          po_approval_threshold: number
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
          po_approval_threshold?: number
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
          po_approval_threshold?: number
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
      construction_daily_reports: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          company_id: string
          constraints_notes: string | null
          created_at: string
          created_by: string | null
          gps_captured_at: string | null
          id: string
          latitude: number | null
          longitude: number | null
          project_id: string
          quantities: Json
          report_date: string
          shift: string
          status: Database["public"]["Enums"]["dpr_status"]
          submitted_at: string | null
          submitted_by: string | null
          temperature_high_c: number | null
          temperature_low_c: number | null
          total_hours: number
          total_manpower: number
          updated_at: string
          weather_summary: string | null
          work_summary: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          company_id: string
          constraints_notes?: string | null
          created_at?: string
          created_by?: string | null
          gps_captured_at?: string | null
          id?: string
          latitude?: number | null
          longitude?: number | null
          project_id: string
          quantities?: Json
          report_date: string
          shift?: string
          status?: Database["public"]["Enums"]["dpr_status"]
          submitted_at?: string | null
          submitted_by?: string | null
          temperature_high_c?: number | null
          temperature_low_c?: number | null
          total_hours?: number
          total_manpower?: number
          updated_at?: string
          weather_summary?: string | null
          work_summary?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          company_id?: string
          constraints_notes?: string | null
          created_at?: string
          created_by?: string | null
          gps_captured_at?: string | null
          id?: string
          latitude?: number | null
          longitude?: number | null
          project_id?: string
          quantities?: Json
          report_date?: string
          shift?: string
          status?: Database["public"]["Enums"]["dpr_status"]
          submitted_at?: string | null
          submitted_by?: string | null
          temperature_high_c?: number | null
          temperature_low_c?: number | null
          total_hours?: number
          total_manpower?: number
          updated_at?: string
          weather_summary?: string | null
          work_summary?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "construction_daily_reports_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "construction_daily_reports_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "construction_daily_reports_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "construction_daily_reports_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "construction_daily_reports_submitted_by_fkey"
            columns: ["submitted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      construction_work_packages: {
        Row: {
          area: string | null
          company_id: string
          created_at: string
          created_by: string | null
          cwp_number: string
          description: string | null
          discipline: string
          id: string
          planned_end: string | null
          planned_start: string | null
          progress_pct: number
          project_id: string
          status: Database["public"]["Enums"]["cwp_status"]
          title: string
          updated_at: string
          wbs_item_id: string | null
          weight: number
        }
        Insert: {
          area?: string | null
          company_id: string
          created_at?: string
          created_by?: string | null
          cwp_number: string
          description?: string | null
          discipline?: string
          id?: string
          planned_end?: string | null
          planned_start?: string | null
          progress_pct?: number
          project_id: string
          status?: Database["public"]["Enums"]["cwp_status"]
          title: string
          updated_at?: string
          wbs_item_id?: string | null
          weight?: number
        }
        Update: {
          area?: string | null
          company_id?: string
          created_at?: string
          created_by?: string | null
          cwp_number?: string
          description?: string | null
          discipline?: string
          id?: string
          planned_end?: string | null
          planned_start?: string | null
          progress_pct?: number
          project_id?: string
          status?: Database["public"]["Enums"]["cwp_status"]
          title?: string
          updated_at?: string
          wbs_item_id?: string | null
          weight?: number
        }
        Relationships: [
          {
            foreignKeyName: "construction_work_packages_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "construction_work_packages_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "construction_work_packages_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "construction_work_packages_wbs_item_id_fkey"
            columns: ["wbs_item_id"]
            isOneToOne: false
            referencedRelation: "wbs_items"
            referencedColumns: ["id"]
          },
        ]
      }
      contacts: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          email: string | null
          full_name: string
          id: string
          is_primary: boolean
          lead_id: string | null
          notes: string | null
          opportunity_id: string | null
          phone: string | null
          title: string | null
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          email?: string | null
          full_name: string
          id?: string
          is_primary?: boolean
          lead_id?: string | null
          notes?: string | null
          opportunity_id?: string | null
          phone?: string | null
          title?: string | null
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          email?: string | null
          full_name?: string
          id?: string
          is_primary?: boolean
          lead_id?: string | null
          notes?: string | null
          opportunity_id?: string | null
          phone?: string | null
          title?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "contacts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contacts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contacts_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contacts_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
        ]
      }
      contour_lines: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          elevation_m: number
          geometry: Json
          id: string
          is_major: boolean
          surface_id: string
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          elevation_m: number
          geometry: Json
          id?: string
          is_major?: boolean
          surface_id: string
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          elevation_m?: number
          geometry?: Json
          id?: string
          is_major?: boolean
          surface_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "contour_lines_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contour_lines_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contour_lines_surface_id_fkey"
            columns: ["surface_id"]
            isOneToOne: false
            referencedRelation: "terrain_surfaces"
            referencedColumns: ["id"]
          },
        ]
      }
      contract_obligations: {
        Row: {
          clause_ref: string | null
          company_id: string
          contract_id: string
          created_at: string
          created_by: string | null
          description: string | null
          due_date: string | null
          extracted_by_ai: boolean
          id: string
          owner_id: string | null
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          clause_ref?: string | null
          company_id: string
          contract_id: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          due_date?: string | null
          extracted_by_ai?: boolean
          id?: string
          owner_id?: string | null
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          clause_ref?: string | null
          company_id?: string
          contract_id?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          due_date?: string | null
          extracted_by_ai?: boolean
          id?: string
          owner_id?: string | null
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "contract_obligations_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contract_obligations_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contract_obligations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contract_obligations_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      contracts: {
        Row: {
          company_id: string
          contract_number: string
          contract_type: Database["public"]["Enums"]["contract_type"]
          counterparty: string
          created_at: string
          created_by: string | null
          currency_code: string | null
          effective_date: string | null
          expiry_date: string | null
          file_path: string | null
          id: string
          project_id: string | null
          retention_until: string | null
          schedule_of_values: Json
          signed_at: string | null
          status: Database["public"]["Enums"]["contract_status"]
          title: string
          updated_at: string
          value: number | null
        }
        Insert: {
          company_id: string
          contract_number: string
          contract_type?: Database["public"]["Enums"]["contract_type"]
          counterparty: string
          created_at?: string
          created_by?: string | null
          currency_code?: string | null
          effective_date?: string | null
          expiry_date?: string | null
          file_path?: string | null
          id?: string
          project_id?: string | null
          retention_until?: string | null
          schedule_of_values?: Json
          signed_at?: string | null
          status?: Database["public"]["Enums"]["contract_status"]
          title: string
          updated_at?: string
          value?: number | null
        }
        Update: {
          company_id?: string
          contract_number?: string
          contract_type?: Database["public"]["Enums"]["contract_type"]
          counterparty?: string
          created_at?: string
          created_by?: string | null
          currency_code?: string | null
          effective_date?: string | null
          expiry_date?: string | null
          file_path?: string | null
          id?: string
          project_id?: string | null
          retention_until?: string | null
          schedule_of_values?: Json
          signed_at?: string | null
          status?: Database["public"]["Enums"]["contract_status"]
          title?: string
          updated_at?: string
          value?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "contracts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contracts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contracts_currency_code_fkey"
            columns: ["currency_code"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "contracts_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      cost_codes: {
        Row: {
          code: string
          company_id: string
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_active: boolean
          name: string
          parent_id: string | null
          project_id: string
          updated_at: string
          wbs_item_id: string | null
        }
        Insert: {
          code: string
          company_id: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          parent_id?: string | null
          project_id: string
          updated_at?: string
          wbs_item_id?: string | null
        }
        Update: {
          code?: string
          company_id?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          parent_id?: string | null
          project_id?: string
          updated_at?: string
          wbs_item_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cost_codes_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cost_codes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cost_codes_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "cost_codes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cost_codes_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cost_codes_wbs_item_id_fkey"
            columns: ["wbs_item_id"]
            isOneToOne: false
            referencedRelation: "wbs_items"
            referencedColumns: ["id"]
          },
        ]
      }
      crew_assignments: {
        Row: {
          assignment_date: string
          company_id: string
          contractor: string | null
          created_at: string
          created_by: string | null
          cwp_id: string | null
          dpr_id: string | null
          foreman: string | null
          headcount: number
          id: string
          notes: string | null
          project_id: string
          trade: string
          updated_at: string
          work_front_id: string
        }
        Insert: {
          assignment_date: string
          company_id: string
          contractor?: string | null
          created_at?: string
          created_by?: string | null
          cwp_id?: string | null
          dpr_id?: string | null
          foreman?: string | null
          headcount: number
          id?: string
          notes?: string | null
          project_id: string
          trade: string
          updated_at?: string
          work_front_id: string
        }
        Update: {
          assignment_date?: string
          company_id?: string
          contractor?: string | null
          created_at?: string
          created_by?: string | null
          cwp_id?: string | null
          dpr_id?: string | null
          foreman?: string | null
          headcount?: number
          id?: string
          notes?: string | null
          project_id?: string
          trade?: string
          updated_at?: string
          work_front_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crew_assignments_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crew_assignments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crew_assignments_cwp_id_fkey"
            columns: ["cwp_id"]
            isOneToOne: false
            referencedRelation: "construction_work_packages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crew_assignments_dpr_id_fkey"
            columns: ["dpr_id"]
            isOneToOne: false
            referencedRelation: "construction_daily_reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crew_assignments_foreman_fkey"
            columns: ["foreman"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crew_assignments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crew_assignments_work_front_id_fkey"
            columns: ["work_front_id"]
            isOneToOne: false
            referencedRelation: "work_fronts"
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
      debit_notes: {
        Row: {
          amount: number
          company_id: string
          contract_id: string | null
          created_at: string
          created_by: string | null
          currency_code: string
          id: string
          invoice_id: string | null
          issued_at: string | null
          note_number: string
          notes: string | null
          project_id: string | null
          reason: string
          settled_at: string | null
          status: Database["public"]["Enums"]["debit_note_status"]
          updated_at: string
        }
        Insert: {
          amount: number
          company_id: string
          contract_id?: string | null
          created_at?: string
          created_by?: string | null
          currency_code: string
          id?: string
          invoice_id?: string | null
          issued_at?: string | null
          note_number: string
          notes?: string | null
          project_id?: string | null
          reason: string
          settled_at?: string | null
          status?: Database["public"]["Enums"]["debit_note_status"]
          updated_at?: string
        }
        Update: {
          amount?: number
          company_id?: string
          contract_id?: string | null
          created_at?: string
          created_by?: string | null
          currency_code?: string
          id?: string
          invoice_id?: string | null
          issued_at?: string | null
          note_number?: string
          notes?: string | null
          project_id?: string | null
          reason?: string
          settled_at?: string | null
          status?: Database["public"]["Enums"]["debit_note_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "debit_notes_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "debit_notes_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "debit_notes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "debit_notes_currency_code_fkey"
            columns: ["currency_code"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "debit_notes_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "debit_notes_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      delay_analysis: {
        Row: {
          cause: Database["public"]["Enums"]["delay_cause"]
          company_id: string
          created_at: string
          created_by: string | null
          cwp_id: string | null
          delay_date: string
          eot_claim: boolean
          id: string
          lost_days: number
          narrative: string | null
          project_id: string
          schedule_task_id: string | null
          updated_at: string
          weather_delay_id: string | null
        }
        Insert: {
          cause: Database["public"]["Enums"]["delay_cause"]
          company_id: string
          created_at?: string
          created_by?: string | null
          cwp_id?: string | null
          delay_date: string
          eot_claim?: boolean
          id?: string
          lost_days?: number
          narrative?: string | null
          project_id: string
          schedule_task_id?: string | null
          updated_at?: string
          weather_delay_id?: string | null
        }
        Update: {
          cause?: Database["public"]["Enums"]["delay_cause"]
          company_id?: string
          created_at?: string
          created_by?: string | null
          cwp_id?: string | null
          delay_date?: string
          eot_claim?: boolean
          id?: string
          lost_days?: number
          narrative?: string | null
          project_id?: string
          schedule_task_id?: string | null
          updated_at?: string
          weather_delay_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "delay_analysis_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delay_analysis_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delay_analysis_cwp_id_fkey"
            columns: ["cwp_id"]
            isOneToOne: false
            referencedRelation: "construction_work_packages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delay_analysis_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delay_analysis_schedule_task_id_fkey"
            columns: ["schedule_task_id"]
            isOneToOne: false
            referencedRelation: "schedule_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delay_analysis_weather_delay_id_fkey"
            columns: ["weather_delay_id"]
            isOneToOne: false
            referencedRelation: "weather_delays"
            referencedColumns: ["id"]
          },
        ]
      }
      delivery_tracking: {
        Row: {
          carrier: string | null
          company_id: string
          created_at: string
          created_by: string | null
          delivered_at: string | null
          expected_date: string | null
          id: string
          notes: string | null
          project_id: string
          purchase_order_id: string | null
          reference: string | null
          status: Database["public"]["Enums"]["field_delivery_status"]
          updated_at: string
        }
        Insert: {
          carrier?: string | null
          company_id: string
          created_at?: string
          created_by?: string | null
          delivered_at?: string | null
          expected_date?: string | null
          id?: string
          notes?: string | null
          project_id: string
          purchase_order_id?: string | null
          reference?: string | null
          status?: Database["public"]["Enums"]["field_delivery_status"]
          updated_at?: string
        }
        Update: {
          carrier?: string | null
          company_id?: string
          created_at?: string
          created_by?: string | null
          delivered_at?: string | null
          expected_date?: string | null
          id?: string
          notes?: string | null
          project_id?: string
          purchase_order_id?: string | null
          reference?: string | null
          status?: Database["public"]["Enums"]["field_delivery_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "delivery_tracking_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_tracking_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_tracking_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_tracking_purchase_order_id_fkey"
            columns: ["purchase_order_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      document_markups: {
        Row: {
          annotation: Json
          company_id: string
          created_at: string
          id: string
          page_number: number | null
          resolution_note: string | null
          reviewer_id: string | null
          reviewer_org: string | null
          revision_id: string
          status: string
          updated_at: string
        }
        Insert: {
          annotation: Json
          company_id: string
          created_at?: string
          id?: string
          page_number?: number | null
          resolution_note?: string | null
          reviewer_id?: string | null
          reviewer_org?: string | null
          revision_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          annotation?: Json
          company_id?: string
          created_at?: string
          id?: string
          page_number?: number | null
          resolution_note?: string | null
          reviewer_id?: string | null
          reviewer_org?: string | null
          revision_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_markups_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_markups_reviewer_id_fkey"
            columns: ["reviewer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_markups_revision_id_fkey"
            columns: ["revision_id"]
            isOneToOne: false
            referencedRelation: "drawing_revisions"
            referencedColumns: ["id"]
          },
        ]
      }
      documents: {
        Row: {
          category: Database["public"]["Enums"]["document_category"]
          company_id: string
          created_at: string
          created_by: string | null
          file_name: string | null
          file_size_bytes: number | null
          id: string
          metadata: Json
          mime_type: string | null
          project_id: string
          storage_path: string | null
          tags: string[]
          title: string
          updated_at: string
        }
        Insert: {
          category?: Database["public"]["Enums"]["document_category"]
          company_id: string
          created_at?: string
          created_by?: string | null
          file_name?: string | null
          file_size_bytes?: number | null
          id?: string
          metadata?: Json
          mime_type?: string | null
          project_id: string
          storage_path?: string | null
          tags?: string[]
          title: string
          updated_at?: string
        }
        Update: {
          category?: Database["public"]["Enums"]["document_category"]
          company_id?: string
          created_at?: string
          created_by?: string | null
          file_name?: string | null
          file_size_bytes?: number | null
          id?: string
          metadata?: Json
          mime_type?: string | null
          project_id?: string
          storage_path?: string | null
          tags?: string[]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "documents_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      drawing_register: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          current_revision_id: string | null
          current_status: Database["public"]["Enums"]["drawing_status"]
          discipline: Database["public"]["Enums"]["drawing_discipline"]
          drawing_number: string
          id: string
          locked: boolean
          project_id: string
          tags: string[]
          title: string
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          current_revision_id?: string | null
          current_status?: Database["public"]["Enums"]["drawing_status"]
          discipline?: Database["public"]["Enums"]["drawing_discipline"]
          drawing_number: string
          id?: string
          locked?: boolean
          project_id: string
          tags?: string[]
          title: string
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          current_revision_id?: string | null
          current_status?: Database["public"]["Enums"]["drawing_status"]
          discipline?: Database["public"]["Enums"]["drawing_discipline"]
          drawing_number?: string
          id?: string
          locked?: boolean
          project_id?: string
          tags?: string[]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "drawing_register_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "drawing_register_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "drawing_register_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_current_revision"
            columns: ["current_revision_id"]
            isOneToOne: false
            referencedRelation: "drawing_revisions"
            referencedColumns: ["id"]
          },
        ]
      }
      drawing_review_rounds: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          due_date: string | null
          id: string
          metadata: Json
          project_id: string
          revision_id: string | null
          round_no: number
          status: string
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          due_date?: string | null
          id?: string
          metadata?: Json
          project_id: string
          revision_id?: string | null
          round_no: number
          status?: string
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          due_date?: string | null
          id?: string
          metadata?: Json
          project_id?: string
          revision_id?: string | null
          round_no?: number
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "drawing_review_rounds_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "drawing_review_rounds_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "drawing_review_rounds_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "drawing_review_rounds_revision_id_fkey"
            columns: ["revision_id"]
            isOneToOne: false
            referencedRelation: "drawing_revisions"
            referencedColumns: ["id"]
          },
        ]
      }
      drawing_review_signoffs: {
        Row: {
          comment: string | null
          company_id: string
          created_at: string
          decision: string | null
          id: string
          reviewer_id: string
          reviewer_org: string
          round_id: string
          signed_at: string | null
          updated_at: string
        }
        Insert: {
          comment?: string | null
          company_id: string
          created_at?: string
          decision?: string | null
          id?: string
          reviewer_id: string
          reviewer_org: string
          round_id: string
          signed_at?: string | null
          updated_at?: string
        }
        Update: {
          comment?: string | null
          company_id?: string
          created_at?: string
          decision?: string | null
          id?: string
          reviewer_id?: string
          reviewer_org?: string
          round_id?: string
          signed_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "drawing_review_signoffs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "drawing_review_signoffs_reviewer_id_fkey"
            columns: ["reviewer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "drawing_review_signoffs_round_id_fkey"
            columns: ["round_id"]
            isOneToOne: false
            referencedRelation: "drawing_review_rounds"
            referencedColumns: ["id"]
          },
        ]
      }
      drawing_revisions: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          drawing_id: string
          file_name: string | null
          file_size_bytes: number | null
          id: string
          issue_reason: string | null
          issued_at: string | null
          issued_by: string | null
          mime_type: string | null
          revision_code: string
          status: Database["public"]["Enums"]["drawing_status"]
          storage_path: string
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          drawing_id: string
          file_name?: string | null
          file_size_bytes?: number | null
          id?: string
          issue_reason?: string | null
          issued_at?: string | null
          issued_by?: string | null
          mime_type?: string | null
          revision_code: string
          status?: Database["public"]["Enums"]["drawing_status"]
          storage_path: string
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          drawing_id?: string
          file_name?: string | null
          file_size_bytes?: number | null
          id?: string
          issue_reason?: string | null
          issued_at?: string | null
          issued_by?: string | null
          mime_type?: string | null
          revision_code?: string
          status?: Database["public"]["Enums"]["drawing_status"]
          storage_path?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "drawing_revisions_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "drawing_revisions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "drawing_revisions_drawing_id_fkey"
            columns: ["drawing_id"]
            isOneToOne: false
            referencedRelation: "drawing_register"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "drawing_revisions_issued_by_fkey"
            columns: ["issued_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ea_grid_code_responses: {
        Row: {
          comment: string | null
          company_id: string
          created_at: string
          evidence: string | null
          id: string
          item_index: number
          project_id: string
          responded_by: string | null
          status: string
          study_id: string | null
          template_id: string
          updated_at: string
        }
        Insert: {
          comment?: string | null
          company_id: string
          created_at?: string
          evidence?: string | null
          id?: string
          item_index: number
          project_id: string
          responded_by?: string | null
          status?: string
          study_id?: string | null
          template_id: string
          updated_at?: string
        }
        Update: {
          comment?: string | null
          company_id?: string
          created_at?: string
          evidence?: string | null
          id?: string
          item_index?: number
          project_id?: string
          responded_by?: string | null
          status?: string
          study_id?: string | null
          template_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ea_grid_code_responses_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ea_grid_code_responses_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ea_grid_code_responses_responded_by_fkey"
            columns: ["responded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ea_grid_code_responses_study_id_fkey"
            columns: ["study_id"]
            isOneToOne: false
            referencedRelation: "ea_studies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ea_grid_code_responses_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "ea_grid_code_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      ea_grid_code_templates: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          items: Json
          market: string
          name: string
          updated_at: string
          version: string
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          items?: Json
          market: string
          name: string
          updated_at?: string
          version?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          items?: Json
          market?: string
          name?: string
          updated_at?: string
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "ea_grid_code_templates_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ea_grid_code_templates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ea_protection_devices: {
        Row: {
          ansi_codes: string[]
          breaking_capacity_ka: number | null
          company_id: string
          created_at: string
          created_by: string | null
          ct_ratio: string | null
          curve_type: string | null
          device_type: string
          id: string
          making_capacity_ka: number | null
          notes: string | null
          project_id: string
          rated_current_a: number | null
          sld_object_id: string | null
          sort_order: number
          source: string
          study_id: string | null
          tag: string
          updated_at: string
          voltage_kv: number | null
          vt_ratio: string | null
        }
        Insert: {
          ansi_codes?: string[]
          breaking_capacity_ka?: number | null
          company_id: string
          created_at?: string
          created_by?: string | null
          ct_ratio?: string | null
          curve_type?: string | null
          device_type?: string
          id?: string
          making_capacity_ka?: number | null
          notes?: string | null
          project_id: string
          rated_current_a?: number | null
          sld_object_id?: string | null
          sort_order?: number
          source?: string
          study_id?: string | null
          tag: string
          updated_at?: string
          voltage_kv?: number | null
          vt_ratio?: string | null
        }
        Update: {
          ansi_codes?: string[]
          breaking_capacity_ka?: number | null
          company_id?: string
          created_at?: string
          created_by?: string | null
          ct_ratio?: string | null
          curve_type?: string | null
          device_type?: string
          id?: string
          making_capacity_ka?: number | null
          notes?: string | null
          project_id?: string
          rated_current_a?: number | null
          sld_object_id?: string | null
          sort_order?: number
          source?: string
          study_id?: string | null
          tag?: string
          updated_at?: string
          voltage_kv?: number | null
          vt_ratio?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ea_protection_devices_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ea_protection_devices_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ea_protection_devices_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ea_protection_devices_study_id_fkey"
            columns: ["study_id"]
            isOneToOne: false
            referencedRelation: "ea_studies"
            referencedColumns: ["id"]
          },
        ]
      }
      ea_relay_settings: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          curve: string | null
          delay_s: number | null
          device_id: string
          function_code: string
          id: string
          notes: string | null
          pickup: number | null
          project_id: string
          revision: number
          set_at: string | null
          set_by: string | null
          setting_group: number
          settings: Json
          time_dial: number | null
          unit: string | null
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          curve?: string | null
          delay_s?: number | null
          device_id: string
          function_code: string
          id?: string
          notes?: string | null
          pickup?: number | null
          project_id: string
          revision?: number
          set_at?: string | null
          set_by?: string | null
          setting_group?: number
          settings?: Json
          time_dial?: number | null
          unit?: string | null
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          curve?: string | null
          delay_s?: number | null
          device_id?: string
          function_code?: string
          id?: string
          notes?: string | null
          pickup?: number | null
          project_id?: string
          revision?: number
          set_at?: string | null
          set_by?: string | null
          setting_group?: number
          settings?: Json
          time_dial?: number | null
          unit?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ea_relay_settings_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ea_relay_settings_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ea_relay_settings_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "ea_protection_devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ea_relay_settings_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ea_relay_settings_set_by_fkey"
            columns: ["set_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ea_studies: {
        Row: {
          approval_instance_id: string | null
          approved_at: string | null
          assumptions: Json
          company_id: string
          created_at: string
          created_by: string | null
          id: string
          input_sheet: Json
          method: string
          project_id: string
          results: Json
          reviewer_id: string | null
          revision: number
          standards_ref: string[]
          status: Database["public"]["Enums"]["ea_study_status"]
          study_number: string
          study_type: Database["public"]["Enums"]["ea_study_type"]
          submitted_at: string | null
          title: string
          updated_at: string
          warnings: Json
        }
        Insert: {
          approval_instance_id?: string | null
          approved_at?: string | null
          assumptions?: Json
          company_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          input_sheet?: Json
          method?: string
          project_id: string
          results?: Json
          reviewer_id?: string | null
          revision?: number
          standards_ref?: string[]
          status?: Database["public"]["Enums"]["ea_study_status"]
          study_number: string
          study_type: Database["public"]["Enums"]["ea_study_type"]
          submitted_at?: string | null
          title: string
          updated_at?: string
          warnings?: Json
        }
        Update: {
          approval_instance_id?: string | null
          approved_at?: string | null
          assumptions?: Json
          company_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          input_sheet?: Json
          method?: string
          project_id?: string
          results?: Json
          reviewer_id?: string | null
          revision?: number
          standards_ref?: string[]
          status?: Database["public"]["Enums"]["ea_study_status"]
          study_number?: string
          study_type?: Database["public"]["Enums"]["ea_study_type"]
          submitted_at?: string | null
          title?: string
          updated_at?: string
          warnings?: Json
        }
        Relationships: [
          {
            foreignKeyName: "ea_studies_approval_instance_id_fkey"
            columns: ["approval_instance_id"]
            isOneToOne: false
            referencedRelation: "approval_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ea_studies_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ea_studies_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ea_studies_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ea_studies_reviewer_id_fkey"
            columns: ["reviewer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ea_study_revisions: {
        Row: {
          approval_instance_id: string | null
          assumptions: Json
          change_summary: string | null
          company_id: string
          created_at: string
          created_by: string | null
          id: string
          input_sheet: Json
          method: string
          results: Json
          reviewer_id: string | null
          revision: number
          standards_ref: string[]
          status: Database["public"]["Enums"]["ea_study_status"]
          study_id: string
          updated_at: string
          warnings: Json
        }
        Insert: {
          approval_instance_id?: string | null
          assumptions?: Json
          change_summary?: string | null
          company_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          input_sheet?: Json
          method?: string
          results?: Json
          reviewer_id?: string | null
          revision: number
          standards_ref?: string[]
          status?: Database["public"]["Enums"]["ea_study_status"]
          study_id: string
          updated_at?: string
          warnings?: Json
        }
        Update: {
          approval_instance_id?: string | null
          assumptions?: Json
          change_summary?: string | null
          company_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          input_sheet?: Json
          method?: string
          results?: Json
          reviewer_id?: string | null
          revision?: number
          standards_ref?: string[]
          status?: Database["public"]["Enums"]["ea_study_status"]
          study_id?: string
          updated_at?: string
          warnings?: Json
        }
        Relationships: [
          {
            foreignKeyName: "ea_study_revisions_approval_instance_id_fkey"
            columns: ["approval_instance_id"]
            isOneToOne: false
            referencedRelation: "approval_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ea_study_revisions_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ea_study_revisions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ea_study_revisions_reviewer_id_fkey"
            columns: ["reviewer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ea_study_revisions_study_id_fkey"
            columns: ["study_id"]
            isOneToOne: false
            referencedRelation: "ea_studies"
            referencedColumns: ["id"]
          },
        ]
      }
      equipment_library: {
        Row: {
          category: string
          certifications: string[]
          company_id: string
          country_of_origin: string | null
          created_at: string
          created_by: string | null
          datasheet_url: string | null
          id: string
          is_active: boolean
          manufacturer: string
          model: string
          notes: string | null
          series: string | null
          specs: Json
          updated_at: string
          warranty_years: number | null
        }
        Insert: {
          category: string
          certifications?: string[]
          company_id: string
          country_of_origin?: string | null
          created_at?: string
          created_by?: string | null
          datasheet_url?: string | null
          id?: string
          is_active?: boolean
          manufacturer: string
          model: string
          notes?: string | null
          series?: string | null
          specs?: Json
          updated_at?: string
          warranty_years?: number | null
        }
        Update: {
          category?: string
          certifications?: string[]
          company_id?: string
          country_of_origin?: string | null
          created_at?: string
          created_by?: string | null
          datasheet_url?: string | null
          id?: string
          is_active?: boolean
          manufacturer?: string
          model?: string
          notes?: string | null
          series?: string | null
          specs?: Json
          updated_at?: string
          warranty_years?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "equipment_library_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      equipment_records: {
        Row: {
          category: string | null
          company_id: string
          created_at: string
          created_by: string | null
          description: string | null
          dpr_id: string | null
          equipment_tag: string
          fuel_litres: number | null
          hours: number
          id: string
          log_date: string
          notes: string | null
          operator_name: string | null
          project_id: string
          status: Database["public"]["Enums"]["field_equipment_status"]
          updated_at: string
        }
        Insert: {
          category?: string | null
          company_id: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          dpr_id?: string | null
          equipment_tag: string
          fuel_litres?: number | null
          hours?: number
          id?: string
          log_date: string
          notes?: string | null
          operator_name?: string | null
          project_id: string
          status?: Database["public"]["Enums"]["field_equipment_status"]
          updated_at?: string
        }
        Update: {
          category?: string | null
          company_id?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          dpr_id?: string | null
          equipment_tag?: string
          fuel_litres?: number | null
          hours?: number
          id?: string
          log_date?: string
          notes?: string | null
          operator_name?: string | null
          project_id?: string
          status?: Database["public"]["Enums"]["field_equipment_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "equipment_records_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "equipment_records_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "equipment_records_dpr_id_fkey"
            columns: ["dpr_id"]
            isOneToOne: false
            referencedRelation: "construction_daily_reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "equipment_records_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      equipment_registry: {
        Row: {
          commissioning_date: string | null
          company_id: string
          created_at: string
          created_by: string | null
          equipment_type: Database["public"]["Enums"]["equipment_type"]
          id: string
          install_date: string | null
          location_text: string | null
          manufacturer: string | null
          model: string | null
          nameplate_capacity_kw: number | null
          project_id: string
          serial_number: string | null
          specs: Json
          status: Database["public"]["Enums"]["equipment_status"]
          tag: string
          updated_at: string
          warranty_end_date: string | null
        }
        Insert: {
          commissioning_date?: string | null
          company_id: string
          created_at?: string
          created_by?: string | null
          equipment_type: Database["public"]["Enums"]["equipment_type"]
          id?: string
          install_date?: string | null
          location_text?: string | null
          manufacturer?: string | null
          model?: string | null
          nameplate_capacity_kw?: number | null
          project_id: string
          serial_number?: string | null
          specs?: Json
          status?: Database["public"]["Enums"]["equipment_status"]
          tag: string
          updated_at?: string
          warranty_end_date?: string | null
        }
        Update: {
          commissioning_date?: string | null
          company_id?: string
          created_at?: string
          created_by?: string | null
          equipment_type?: Database["public"]["Enums"]["equipment_type"]
          id?: string
          install_date?: string | null
          location_text?: string | null
          manufacturer?: string | null
          model?: string | null
          nameplate_capacity_kw?: number | null
          project_id?: string
          serial_number?: string | null
          specs?: Json
          status?: Database["public"]["Enums"]["equipment_status"]
          tag?: string
          updated_at?: string
          warranty_end_date?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "equipment_registry_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "equipment_registry_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "equipment_registry_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      event_action_log: {
        Row: {
          action_type: Database["public"]["Enums"]["event_action_type"]
          ai_suggestion: Json | null
          approval_instance_id: string | null
          company_id: string
          created_at: string
          error: string | null
          executed_at: string | null
          executed_by: string | null
          id: string
          project_id: string
          result_entity: string | null
          result_entity_id: string | null
          rule_id: string | null
          scada_event_id: string | null
          status: Database["public"]["Enums"]["event_action_status"]
          updated_at: string
        }
        Insert: {
          action_type: Database["public"]["Enums"]["event_action_type"]
          ai_suggestion?: Json | null
          approval_instance_id?: string | null
          company_id: string
          created_at?: string
          error?: string | null
          executed_at?: string | null
          executed_by?: string | null
          id?: string
          project_id: string
          result_entity?: string | null
          result_entity_id?: string | null
          rule_id?: string | null
          scada_event_id?: string | null
          status?: Database["public"]["Enums"]["event_action_status"]
          updated_at?: string
        }
        Update: {
          action_type?: Database["public"]["Enums"]["event_action_type"]
          ai_suggestion?: Json | null
          approval_instance_id?: string | null
          company_id?: string
          created_at?: string
          error?: string | null
          executed_at?: string | null
          executed_by?: string | null
          id?: string
          project_id?: string
          result_entity?: string | null
          result_entity_id?: string | null
          rule_id?: string | null
          scada_event_id?: string | null
          status?: Database["public"]["Enums"]["event_action_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_action_log_approval_instance_id_fkey"
            columns: ["approval_instance_id"]
            isOneToOne: false
            referencedRelation: "approval_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_action_log_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_action_log_executed_by_fkey"
            columns: ["executed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_action_log_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_action_log_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "event_action_rules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_action_log_scada_event_id_fkey"
            columns: ["scada_event_id"]
            isOneToOne: false
            referencedRelation: "scada_events"
            referencedColumns: ["id"]
          },
        ]
      }
      event_action_rules: {
        Row: {
          action_config: Json
          action_type: Database["public"]["Enums"]["event_action_type"]
          ai_assist: boolean
          approval_rule_key: string
          company_id: string
          created_at: string
          created_by: string | null
          enabled: boolean
          event_type: Database["public"]["Enums"]["scada_event_type"]
          id: string
          match: Json
          min_severity: Database["public"]["Enums"]["alarm_severity"]
          name: string
          project_id: string | null
          requires_approval: boolean
          updated_at: string
        }
        Insert: {
          action_config?: Json
          action_type: Database["public"]["Enums"]["event_action_type"]
          ai_assist?: boolean
          approval_rule_key?: string
          company_id: string
          created_at?: string
          created_by?: string | null
          enabled?: boolean
          event_type: Database["public"]["Enums"]["scada_event_type"]
          id?: string
          match?: Json
          min_severity?: Database["public"]["Enums"]["alarm_severity"]
          name: string
          project_id?: string | null
          requires_approval?: boolean
          updated_at?: string
        }
        Update: {
          action_config?: Json
          action_type?: Database["public"]["Enums"]["event_action_type"]
          ai_assist?: boolean
          approval_rule_key?: string
          company_id?: string
          created_at?: string
          created_by?: string | null
          enabled?: boolean
          event_type?: Database["public"]["Enums"]["scada_event_type"]
          id?: string
          match?: Json
          min_severity?: Database["public"]["Enums"]["alarm_severity"]
          name?: string
          project_id?: string | null
          requires_approval?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_action_rules_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_action_rules_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_action_rules_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      evm_snapshots: {
        Row: {
          actual_cost: number
          budget_at_completion: number
          company_id: string
          cpi: number | null
          created_at: string
          created_by: string | null
          currency_code: string
          earned_value: number
          estimate_at_completion: number | null
          id: string
          planned_value: number
          project_id: string
          snapshot_date: string
          source: string
          spi: number | null
          updated_at: string
        }
        Insert: {
          actual_cost?: number
          budget_at_completion?: number
          company_id: string
          cpi?: number | null
          created_at?: string
          created_by?: string | null
          currency_code: string
          earned_value?: number
          estimate_at_completion?: number | null
          id?: string
          planned_value?: number
          project_id: string
          snapshot_date: string
          source?: string
          spi?: number | null
          updated_at?: string
        }
        Update: {
          actual_cost?: number
          budget_at_completion?: number
          company_id?: string
          cpi?: number | null
          created_at?: string
          created_by?: string | null
          currency_code?: string
          earned_value?: number
          estimate_at_completion?: number | null
          id?: string
          planned_value?: number
          project_id?: string
          snapshot_date?: string
          source?: string
          spi?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "evm_snapshots_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evm_snapshots_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evm_snapshots_currency_code_fkey"
            columns: ["currency_code"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "evm_snapshots_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      expediting_logs: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          current_eta: string | null
          delivery_window_end: string | null
          delivery_window_start: string | null
          eta_confirmed: boolean
          id: string
          is_long_lead: boolean
          item_description: string
          last_vendor_contact_at: string | null
          notes: string | null
          po_id: string
          po_line_no: number | null
          project_id: string
          promised_delivery_date: string | null
          site_need_date: string
          status: Database["public"]["Enums"]["expediting_status"]
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          current_eta?: string | null
          delivery_window_end?: string | null
          delivery_window_start?: string | null
          eta_confirmed?: boolean
          id?: string
          is_long_lead?: boolean
          item_description: string
          last_vendor_contact_at?: string | null
          notes?: string | null
          po_id: string
          po_line_no?: number | null
          project_id: string
          promised_delivery_date?: string | null
          site_need_date: string
          status?: Database["public"]["Enums"]["expediting_status"]
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          current_eta?: string | null
          delivery_window_end?: string | null
          delivery_window_start?: string | null
          eta_confirmed?: boolean
          id?: string
          is_long_lead?: boolean
          item_description?: string
          last_vendor_contact_at?: string | null
          notes?: string | null
          po_id?: string
          po_line_no?: number | null
          project_id?: string
          promised_delivery_date?: string | null
          site_need_date?: string
          status?: Database["public"]["Enums"]["expediting_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "expediting_logs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expediting_logs_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expediting_logs_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expediting_logs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      export_packages: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          file_path: string | null
          id: string
          metadata: Json
          package_type: string
          project_id: string | null
          title: string
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          file_path?: string | null
          id?: string
          metadata?: Json
          package_type: string
          project_id?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          file_path?: string | null
          id?: string
          metadata?: Json
          package_type?: string
          project_id?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "export_packages_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "export_packages_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "export_packages_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      field_observations: {
        Row: {
          action_required: string | null
          area: string | null
          closed_at: string | null
          closed_by: string | null
          company_id: string
          created_at: string
          description: string
          discipline: string
          dpr_id: string | null
          due_date: string | null
          id: string
          project_id: string
          raised_by: string | null
          severity: Database["public"]["Enums"]["observation_severity"]
          status: Database["public"]["Enums"]["observation_status"]
          updated_at: string
        }
        Insert: {
          action_required?: string | null
          area?: string | null
          closed_at?: string | null
          closed_by?: string | null
          company_id: string
          created_at?: string
          description: string
          discipline?: string
          dpr_id?: string | null
          due_date?: string | null
          id?: string
          project_id: string
          raised_by?: string | null
          severity?: Database["public"]["Enums"]["observation_severity"]
          status?: Database["public"]["Enums"]["observation_status"]
          updated_at?: string
        }
        Update: {
          action_required?: string | null
          area?: string | null
          closed_at?: string | null
          closed_by?: string | null
          company_id?: string
          created_at?: string
          description?: string
          discipline?: string
          dpr_id?: string | null
          due_date?: string | null
          id?: string
          project_id?: string
          raised_by?: string | null
          severity?: Database["public"]["Enums"]["observation_severity"]
          status?: Database["public"]["Enums"]["observation_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "field_observations_closed_by_fkey"
            columns: ["closed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "field_observations_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "field_observations_dpr_id_fkey"
            columns: ["dpr_id"]
            isOneToOne: false
            referencedRelation: "construction_daily_reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "field_observations_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "field_observations_raised_by_fkey"
            columns: ["raised_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
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
      goods_receipts: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          defects_count: number
          grn_number: string
          id: string
          lines: Json
          notes: string | null
          photos: Json
          po_id: string
          project_id: string
          received_at: string | null
          received_by: string | null
          status: Database["public"]["Enums"]["grn_status"]
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          defects_count?: number
          grn_number: string
          id?: string
          lines?: Json
          notes?: string | null
          photos?: Json
          po_id: string
          project_id: string
          received_at?: string | null
          received_by?: string | null
          status?: Database["public"]["Enums"]["grn_status"]
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          defects_count?: number
          grn_number?: string
          id?: string
          lines?: Json
          notes?: string | null
          photos?: Json
          po_id?: string
          project_id?: string
          received_at?: string | null
          received_by?: string | null
          status?: Database["public"]["Enums"]["grn_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "goods_receipts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goods_receipts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goods_receipts_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goods_receipts_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goods_receipts_received_by_fkey"
            columns: ["received_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      hse_incidents: {
        Row: {
          closed_at: string | null
          closed_by: string | null
          company_id: string
          corrective_actions: Json
          created_at: string
          created_by: string | null
          days_away_from_work: number
          description: string
          id: string
          incident_number: string
          incident_type: Database["public"]["Enums"]["hse_incident_type"]
          location: string | null
          medical_treatment: boolean
          occurred_at: string
          osha_recordable: boolean
          persons_involved: string | null
          project_id: string
          reported_at: string
          restricted_duty: boolean
          severity: Database["public"]["Enums"]["hse_incident_severity"]
          status: Database["public"]["Enums"]["hse_incident_status"]
          updated_at: string
        }
        Insert: {
          closed_at?: string | null
          closed_by?: string | null
          company_id: string
          corrective_actions?: Json
          created_at?: string
          created_by?: string | null
          days_away_from_work?: number
          description: string
          id?: string
          incident_number: string
          incident_type: Database["public"]["Enums"]["hse_incident_type"]
          location?: string | null
          medical_treatment?: boolean
          occurred_at: string
          osha_recordable?: boolean
          persons_involved?: string | null
          project_id: string
          reported_at?: string
          restricted_duty?: boolean
          severity?: Database["public"]["Enums"]["hse_incident_severity"]
          status?: Database["public"]["Enums"]["hse_incident_status"]
          updated_at?: string
        }
        Update: {
          closed_at?: string | null
          closed_by?: string | null
          company_id?: string
          corrective_actions?: Json
          created_at?: string
          created_by?: string | null
          days_away_from_work?: number
          description?: string
          id?: string
          incident_number?: string
          incident_type?: Database["public"]["Enums"]["hse_incident_type"]
          location?: string | null
          medical_treatment?: boolean
          occurred_at?: string
          osha_recordable?: boolean
          persons_involved?: string | null
          project_id?: string
          reported_at?: string
          restricted_duty?: boolean
          severity?: Database["public"]["Enums"]["hse_incident_severity"]
          status?: Database["public"]["Enums"]["hse_incident_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "hse_incidents_closed_by_fkey"
            columns: ["closed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hse_incidents_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hse_incidents_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hse_incidents_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      hse_inspections: {
        Row: {
          area: string | null
          checklist: Json
          closed_at: string | null
          company_id: string
          created_at: string
          created_by: string | null
          due_date: string | null
          findings_count: number
          id: string
          inspection_date: string
          inspection_type: string
          inspector_id: string | null
          open_findings: number
          project_id: string
          status: Database["public"]["Enums"]["hse_inspection_status"]
          updated_at: string
        }
        Insert: {
          area?: string | null
          checklist?: Json
          closed_at?: string | null
          company_id: string
          created_at?: string
          created_by?: string | null
          due_date?: string | null
          findings_count?: number
          id?: string
          inspection_date: string
          inspection_type?: string
          inspector_id?: string | null
          open_findings?: number
          project_id: string
          status?: Database["public"]["Enums"]["hse_inspection_status"]
          updated_at?: string
        }
        Update: {
          area?: string | null
          checklist?: Json
          closed_at?: string | null
          company_id?: string
          created_at?: string
          created_by?: string | null
          due_date?: string | null
          findings_count?: number
          id?: string
          inspection_date?: string
          inspection_type?: string
          inspector_id?: string | null
          open_findings?: number
          project_id?: string
          status?: Database["public"]["Enums"]["hse_inspection_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "hse_inspections_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hse_inspections_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hse_inspections_inspector_id_fkey"
            columns: ["inspector_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hse_inspections_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      hse_training_records: {
        Row: {
          certificate_path: string | null
          company_id: string
          completed_on: string
          course: string
          created_at: string
          created_by: string | null
          expires_on: string | null
          id: string
          person_name: string
          profile_id: string | null
          project_id: string | null
          provider: string | null
          updated_at: string
        }
        Insert: {
          certificate_path?: string | null
          company_id: string
          completed_on: string
          course: string
          created_at?: string
          created_by?: string | null
          expires_on?: string | null
          id?: string
          person_name: string
          profile_id?: string | null
          project_id?: string | null
          provider?: string | null
          updated_at?: string
        }
        Update: {
          certificate_path?: string | null
          company_id?: string
          completed_on?: string
          course?: string
          created_at?: string
          created_by?: string | null
          expires_on?: string | null
          id?: string
          person_name?: string
          profile_id?: string | null
          project_id?: string | null
          provider?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "hse_training_records_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hse_training_records_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hse_training_records_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hse_training_records_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      ifc_release_signoffs: {
        Row: {
          company_id: string
          created_at: string
          id: string
          release_id: string
          role_label: string
          signature_text: string
          signed_at: string
          signer_id: string
        }
        Insert: {
          company_id: string
          created_at?: string
          id?: string
          release_id: string
          role_label: string
          signature_text: string
          signed_at?: string
          signer_id: string
        }
        Update: {
          company_id?: string
          created_at?: string
          id?: string
          release_id?: string
          role_label?: string
          signature_text?: string
          signed_at?: string
          signer_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ifc_release_signoffs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ifc_release_signoffs_release_id_fkey"
            columns: ["release_id"]
            isOneToOne: false
            referencedRelation: "ifc_releases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ifc_release_signoffs_signer_id_fkey"
            columns: ["signer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ifc_releases: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          distribution_list: Json
          id: string
          notes: string | null
          package_name: string
          prepared_by: string | null
          project_id: string
          released_at: string | null
          released_by: string | null
          revision_snapshot: Json
          status: string
          updated_at: string
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          distribution_list?: Json
          id?: string
          notes?: string | null
          package_name: string
          prepared_by?: string | null
          project_id: string
          released_at?: string | null
          released_by?: string | null
          revision_snapshot?: Json
          status?: string
          updated_at?: string
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          distribution_list?: Json
          id?: string
          notes?: string | null
          package_name?: string
          prepared_by?: string | null
          project_id?: string
          released_at?: string | null
          released_by?: string | null
          revision_snapshot?: Json
          status?: string
          updated_at?: string
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ifc_releases_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ifc_releases_prepared_by_fkey"
            columns: ["prepared_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ifc_releases_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ifc_releases_released_by_fkey"
            columns: ["released_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ifc_releases_voided_by_fkey"
            columns: ["voided_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ingestion_dead_letter: {
        Row: {
          attempts: number
          company_id: string
          connector_id: string | null
          created_at: string
          failed_at: string
          final_error: string
          first_error: string | null
          id: string
          payload: Json
          payload_kind: string
          project_id: string | null
          replayed_at: string | null
          replayed_by: string | null
        }
        Insert: {
          attempts: number
          company_id: string
          connector_id?: string | null
          created_at?: string
          failed_at?: string
          final_error: string
          first_error?: string | null
          id?: string
          payload: Json
          payload_kind?: string
          project_id?: string | null
          replayed_at?: string | null
          replayed_by?: string | null
        }
        Update: {
          attempts?: number
          company_id?: string
          connector_id?: string | null
          created_at?: string
          failed_at?: string
          final_error?: string
          first_error?: string | null
          id?: string
          payload?: Json
          payload_kind?: string
          project_id?: string | null
          replayed_at?: string | null
          replayed_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ingestion_dead_letter_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ingestion_dead_letter_connector_id_fkey"
            columns: ["connector_id"]
            isOneToOne: false
            referencedRelation: "scada_connectors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ingestion_dead_letter_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ingestion_dead_letter_replayed_by_fkey"
            columns: ["replayed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ingestion_retry_queue: {
        Row: {
          attempts: number
          company_id: string
          connector_id: string | null
          created_at: string
          error: string
          id: string
          max_attempts: number
          next_retry_at: string
          payload: Json
          payload_kind: string
          project_id: string | null
          status: Database["public"]["Enums"]["ingestion_queue_status"]
          updated_at: string
        }
        Insert: {
          attempts?: number
          company_id: string
          connector_id?: string | null
          created_at?: string
          error: string
          id?: string
          max_attempts?: number
          next_retry_at?: string
          payload: Json
          payload_kind?: string
          project_id?: string | null
          status?: Database["public"]["Enums"]["ingestion_queue_status"]
          updated_at?: string
        }
        Update: {
          attempts?: number
          company_id?: string
          connector_id?: string | null
          created_at?: string
          error?: string
          id?: string
          max_attempts?: number
          next_retry_at?: string
          payload?: Json
          payload_kind?: string
          project_id?: string | null
          status?: Database["public"]["Enums"]["ingestion_queue_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ingestion_retry_queue_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ingestion_retry_queue_connector_id_fkey"
            columns: ["connector_id"]
            isOneToOne: false
            referencedRelation: "scada_connectors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ingestion_retry_queue_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      ingestion_runs: {
        Row: {
          company_id: string
          connector_id: string | null
          created_at: string
          created_by: string | null
          details: Json
          duration_ms: number | null
          error_text: string | null
          finished_at: string | null
          id: string
          project_id: string | null
          rows_accepted: number
          rows_received: number
          rows_rejected: number
          source_label: string | null
          started_at: string
          status: Database["public"]["Enums"]["ingestion_run_status"]
          trigger: Database["public"]["Enums"]["ingestion_trigger"]
          updated_at: string
        }
        Insert: {
          company_id: string
          connector_id?: string | null
          created_at?: string
          created_by?: string | null
          details?: Json
          duration_ms?: number | null
          error_text?: string | null
          finished_at?: string | null
          id?: string
          project_id?: string | null
          rows_accepted?: number
          rows_received?: number
          rows_rejected?: number
          source_label?: string | null
          started_at?: string
          status?: Database["public"]["Enums"]["ingestion_run_status"]
          trigger?: Database["public"]["Enums"]["ingestion_trigger"]
          updated_at?: string
        }
        Update: {
          company_id?: string
          connector_id?: string | null
          created_at?: string
          created_by?: string | null
          details?: Json
          duration_ms?: number | null
          error_text?: string | null
          finished_at?: string | null
          id?: string
          project_id?: string | null
          rows_accepted?: number
          rows_received?: number
          rows_rejected?: number
          source_label?: string | null
          started_at?: string
          status?: Database["public"]["Enums"]["ingestion_run_status"]
          trigger?: Database["public"]["Enums"]["ingestion_trigger"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ingestion_runs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ingestion_runs_connector_id_fkey"
            columns: ["connector_id"]
            isOneToOne: false
            referencedRelation: "scada_connectors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ingestion_runs_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ingestion_runs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      investor_share_links: {
        Row: {
          access_count: number
          company_id: string
          created_at: string
          created_by: string | null
          expires_at: string
          id: string
          label: string
          last_accessed_at: string | null
          revoked_at: string | null
          revoked_by: string | null
          role: Database["public"]["Enums"]["app_role"]
          scope: Json
          token_hash: string
          updated_at: string
        }
        Insert: {
          access_count?: number
          company_id: string
          created_at?: string
          created_by?: string | null
          expires_at: string
          id?: string
          label: string
          last_accessed_at?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          role: Database["public"]["Enums"]["app_role"]
          scope?: Json
          token_hash: string
          updated_at?: string
        }
        Update: {
          access_count?: number
          company_id?: string
          created_at?: string
          created_by?: string | null
          expires_at?: string
          id?: string
          label?: string
          last_accessed_at?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          scope?: Json
          token_hash?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "investor_share_links_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "investor_share_links_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "investor_share_links_revoked_by_fkey"
            columns: ["revoked_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
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
      invoices: {
        Row: {
          amount: number
          company_id: string
          contract_id: string | null
          created_at: string
          created_by: string | null
          currency_code: string
          direction: Database["public"]["Enums"]["invoice_direction"]
          due_date: string | null
          file_path: string | null
          id: string
          invoice_number: string
          issue_date: string | null
          milestone_label: string | null
          paid_at: string | null
          project_id: string | null
          retention_pct: number
          status: Database["public"]["Enums"]["invoice_status"]
          tax_amount: number
          updated_at: string
          vendor_id: string | null
        }
        Insert: {
          amount?: number
          company_id: string
          contract_id?: string | null
          created_at?: string
          created_by?: string | null
          currency_code: string
          direction: Database["public"]["Enums"]["invoice_direction"]
          due_date?: string | null
          file_path?: string | null
          id?: string
          invoice_number: string
          issue_date?: string | null
          milestone_label?: string | null
          paid_at?: string | null
          project_id?: string | null
          retention_pct?: number
          status?: Database["public"]["Enums"]["invoice_status"]
          tax_amount?: number
          updated_at?: string
          vendor_id?: string | null
        }
        Update: {
          amount?: number
          company_id?: string
          contract_id?: string | null
          created_at?: string
          created_by?: string | null
          currency_code?: string
          direction?: Database["public"]["Enums"]["invoice_direction"]
          due_date?: string | null
          file_path?: string | null
          id?: string
          invoice_number?: string
          issue_date?: string | null
          milestone_label?: string | null
          paid_at?: string | null
          project_id?: string | null
          retention_pct?: number
          status?: Database["public"]["Enums"]["invoice_status"]
          tax_amount?: number
          updated_at?: string
          vendor_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoices_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_currency_code_fkey"
            columns: ["currency_code"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "invoices_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      layout_optimization_runs: {
        Row: {
          approval_instance_id: string | null
          chosen_candidate: number | null
          company_id: string
          constraints: Json
          created_at: string
          created_by: string | null
          id: string
          inputs: Json
          name: string
          project_id: string
          results: Json | null
          revision_code: string
          run_ref: string
          scenario_type: Database["public"]["Enums"]["layout_scenario_type"]
          score: number | null
          status: string
          surface_id: string | null
          updated_at: string
          weights: Json
        }
        Insert: {
          approval_instance_id?: string | null
          chosen_candidate?: number | null
          company_id: string
          constraints?: Json
          created_at?: string
          created_by?: string | null
          id?: string
          inputs?: Json
          name: string
          project_id: string
          results?: Json | null
          revision_code?: string
          run_ref: string
          scenario_type: Database["public"]["Enums"]["layout_scenario_type"]
          score?: number | null
          status?: string
          surface_id?: string | null
          updated_at?: string
          weights?: Json
        }
        Update: {
          approval_instance_id?: string | null
          chosen_candidate?: number | null
          company_id?: string
          constraints?: Json
          created_at?: string
          created_by?: string | null
          id?: string
          inputs?: Json
          name?: string
          project_id?: string
          results?: Json | null
          revision_code?: string
          run_ref?: string
          scenario_type?: Database["public"]["Enums"]["layout_scenario_type"]
          score?: number | null
          status?: string
          surface_id?: string | null
          updated_at?: string
          weights?: Json
        }
        Relationships: [
          {
            foreignKeyName: "layout_optimization_runs_approval_instance_id_fkey"
            columns: ["approval_instance_id"]
            isOneToOne: false
            referencedRelation: "approval_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "layout_optimization_runs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "layout_optimization_runs_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "layout_optimization_runs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "layout_optimization_runs_surface_id_fkey"
            columns: ["surface_id"]
            isOneToOne: false
            referencedRelation: "terrain_surfaces"
            referencedColumns: ["id"]
          },
        ]
      }
      lcoe_scenarios: {
        Row: {
          annual_energy_mwh: number
          assumptions: Json
          capex: number
          company_id: string
          created_at: string
          created_by: string | null
          currency_code: string
          degradation_pct: number
          discount_rate_pct: number
          id: string
          lcoe: number | null
          name: string
          opex_annual: number
          project_id: string
          project_life_years: number
          updated_at: string
        }
        Insert: {
          annual_energy_mwh: number
          assumptions?: Json
          capex: number
          company_id: string
          created_at?: string
          created_by?: string | null
          currency_code: string
          degradation_pct?: number
          discount_rate_pct: number
          id?: string
          lcoe?: number | null
          name: string
          opex_annual: number
          project_id: string
          project_life_years?: number
          updated_at?: string
        }
        Update: {
          annual_energy_mwh?: number
          assumptions?: Json
          capex?: number
          company_id?: string
          created_at?: string
          created_by?: string | null
          currency_code?: string
          degradation_pct?: number
          discount_rate_pct?: number
          id?: string
          lcoe?: number | null
          name?: string
          opex_annual?: number
          project_id?: string
          project_life_years?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lcoe_scenarios_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lcoe_scenarios_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lcoe_scenarios_currency_code_fkey"
            columns: ["currency_code"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "lcoe_scenarios_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      leads: {
        Row: {
          account_name: string | null
          company_id: string
          created_at: string
          created_by: string | null
          email: string | null
          id: string
          name: string
          notes: string | null
          owner_id: string | null
          phone: string | null
          source: Database["public"]["Enums"]["lead_source"]
          status: Database["public"]["Enums"]["lead_status"]
          updated_at: string
        }
        Insert: {
          account_name?: string | null
          company_id: string
          created_at?: string
          created_by?: string | null
          email?: string | null
          id?: string
          name: string
          notes?: string | null
          owner_id?: string | null
          phone?: string | null
          source?: Database["public"]["Enums"]["lead_source"]
          status?: Database["public"]["Enums"]["lead_status"]
          updated_at?: string
        }
        Update: {
          account_name?: string | null
          company_id?: string
          created_at?: string
          created_by?: string | null
          email?: string | null
          id?: string
          name?: string
          notes?: string | null
          owner_id?: string | null
          phone?: string | null
          source?: Database["public"]["Enums"]["lead_source"]
          status?: Database["public"]["Enums"]["lead_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "leads_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      lender_dd_items: {
        Row: {
          category: string
          company_id: string
          created_at: string
          created_by: string | null
          description: string | null
          document_path: string | null
          due_date: string | null
          id: string
          owner_id: string | null
          project_id: string
          response_note: string | null
          status: Database["public"]["Enums"]["dd_item_status"]
          title: string
          updated_at: string
        }
        Insert: {
          category: string
          company_id: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          document_path?: string | null
          due_date?: string | null
          id?: string
          owner_id?: string | null
          project_id: string
          response_note?: string | null
          status?: Database["public"]["Enums"]["dd_item_status"]
          title: string
          updated_at?: string
        }
        Update: {
          category?: string
          company_id?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          document_path?: string | null
          due_date?: string | null
          id?: string
          owner_id?: string | null
          project_id?: string
          response_note?: string | null
          status?: Database["public"]["Enums"]["dd_item_status"]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lender_dd_items_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lender_dd_items_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lender_dd_items_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lender_dd_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      look_ahead_plans: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          entries: Json
          id: string
          notes: string | null
          project_id: string
          published_at: string | null
          published_by: string | null
          status: Database["public"]["Enums"]["look_ahead_status"]
          updated_at: string
          week_start: string
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          entries?: Json
          id?: string
          notes?: string | null
          project_id: string
          published_at?: string | null
          published_by?: string | null
          status?: Database["public"]["Enums"]["look_ahead_status"]
          updated_at?: string
          week_start: string
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          entries?: Json
          id?: string
          notes?: string | null
          project_id?: string
          published_at?: string | null
          published_by?: string | null
          status?: Database["public"]["Enums"]["look_ahead_status"]
          updated_at?: string
          week_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "look_ahead_plans_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "look_ahead_plans_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "look_ahead_plans_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "look_ahead_plans_published_by_fkey"
            columns: ["published_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      manpower_logs: {
        Row: {
          company_id: string
          contractor: string | null
          created_at: string
          dpr_id: string
          headcount: number
          hours: number
          id: string
          notes: string | null
          trade: string
          updated_at: string
        }
        Insert: {
          company_id: string
          contractor?: string | null
          created_at?: string
          dpr_id: string
          headcount: number
          hours?: number
          id?: string
          notes?: string | null
          trade: string
          updated_at?: string
        }
        Update: {
          company_id?: string
          contractor?: string | null
          created_at?: string
          dpr_id?: string
          headcount?: number
          hours?: number
          id?: string
          notes?: string | null
          trade?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "manpower_logs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manpower_logs_dpr_id_fkey"
            columns: ["dpr_id"]
            isOneToOne: false
            referencedRelation: "construction_daily_reports"
            referencedColumns: ["id"]
          },
        ]
      }
      material_consumption: {
        Row: {
          batch_serial_id: string | null
          company_id: string
          created_at: string
          cwp_id: string | null
          dpr_id: string
          id: string
          material: string
          project_id: string
          qty: number
          recorded_by: string | null
          uom: string
          updated_at: string
        }
        Insert: {
          batch_serial_id?: string | null
          company_id: string
          created_at?: string
          cwp_id?: string | null
          dpr_id: string
          id?: string
          material: string
          project_id: string
          qty: number
          recorded_by?: string | null
          uom: string
          updated_at?: string
        }
        Update: {
          batch_serial_id?: string | null
          company_id?: string
          created_at?: string
          cwp_id?: string | null
          dpr_id?: string
          id?: string
          material?: string
          project_id?: string
          qty?: number
          recorded_by?: string | null
          uom?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "material_consumption_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "material_consumption_cwp_id_fkey"
            columns: ["cwp_id"]
            isOneToOne: false
            referencedRelation: "construction_work_packages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "material_consumption_dpr_id_fkey"
            columns: ["dpr_id"]
            isOneToOne: false
            referencedRelation: "construction_daily_reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "material_consumption_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "material_consumption_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      material_price_alerts: {
        Row: {
          alert_threshold_pct: number
          category: Database["public"]["Enums"]["material_category"]
          change_pct: number | null
          company_id: string
          created_at: string
          created_by: string | null
          currency_code: string
          id: string
          index_price: number | null
          observed_at: string
          previous_price: number | null
          region: string
          source: string | null
          triggered: boolean
          triggered_at: string | null
          unit: string
          updated_at: string
        }
        Insert: {
          alert_threshold_pct?: number
          category: Database["public"]["Enums"]["material_category"]
          change_pct?: number | null
          company_id: string
          created_at?: string
          created_by?: string | null
          currency_code: string
          id?: string
          index_price?: number | null
          observed_at?: string
          previous_price?: number | null
          region?: string
          source?: string | null
          triggered?: boolean
          triggered_at?: string | null
          unit: string
          updated_at?: string
        }
        Update: {
          alert_threshold_pct?: number
          category?: Database["public"]["Enums"]["material_category"]
          change_pct?: number | null
          company_id?: string
          created_at?: string
          created_by?: string | null
          currency_code?: string
          id?: string
          index_price?: number | null
          observed_at?: string
          previous_price?: number | null
          region?: string
          source?: string | null
          triggered?: boolean
          triggered_at?: string | null
          unit?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "material_price_alerts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "material_price_alerts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "material_price_alerts_currency_code_fkey"
            columns: ["currency_code"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
        ]
      }
      method_statements: {
        Row: {
          activity: string
          approved_at: string | null
          approved_by: string | null
          company_id: string
          created_at: string
          created_by: string | null
          file_path: string | null
          id: string
          ms_number: string
          project_id: string
          revision: string
          status: Database["public"]["Enums"]["gov_doc_status"]
          title: string
          updated_at: string
        }
        Insert: {
          activity: string
          approved_at?: string | null
          approved_by?: string | null
          company_id: string
          created_at?: string
          created_by?: string | null
          file_path?: string | null
          id?: string
          ms_number: string
          project_id: string
          revision?: string
          status?: Database["public"]["Enums"]["gov_doc_status"]
          title: string
          updated_at?: string
        }
        Update: {
          activity?: string
          approved_at?: string | null
          approved_by?: string | null
          company_id?: string
          created_at?: string
          created_by?: string | null
          file_path?: string | null
          id?: string
          ms_number?: string
          project_id?: string
          revision?: string
          status?: Database["public"]["Enums"]["gov_doc_status"]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "method_statements_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "method_statements_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "method_statements_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "method_statements_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      mobilization_checklists: {
        Row: {
          company_id: string
          completed_at: string | null
          created_at: string
          created_by: string | null
          id: string
          items: Json
          name: string
          project_id: string
          started_at: string | null
          status: Database["public"]["Enums"]["mobilization_status"]
          updated_at: string
        }
        Insert: {
          company_id: string
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          items?: Json
          name: string
          project_id: string
          started_at?: string | null
          status?: Database["public"]["Enums"]["mobilization_status"]
          updated_at?: string
        }
        Update: {
          company_id?: string
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          items?: Json
          name?: string
          project_id?: string
          started_at?: string | null
          status?: Database["public"]["Enums"]["mobilization_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "mobilization_checklists_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mobilization_checklists_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mobilization_checklists_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
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
      ncrs: {
        Row: {
          area: string | null
          closed_at: string | null
          closed_by: string | null
          company_id: string
          corrective_action: string | null
          cost_impact: number | null
          created_at: string
          created_by: string | null
          currency_code: string | null
          description: string
          discipline: string | null
          disposition: Database["public"]["Enums"]["ncr_disposition"]
          id: string
          ncr_number: string
          project_id: string
          raised_by: string | null
          root_cause: string | null
          source: Database["public"]["Enums"]["ncr_source"]
          source_id: string | null
          status: Database["public"]["Enums"]["ncr_status"]
          updated_at: string
        }
        Insert: {
          area?: string | null
          closed_at?: string | null
          closed_by?: string | null
          company_id: string
          corrective_action?: string | null
          cost_impact?: number | null
          created_at?: string
          created_by?: string | null
          currency_code?: string | null
          description: string
          discipline?: string | null
          disposition?: Database["public"]["Enums"]["ncr_disposition"]
          id?: string
          ncr_number: string
          project_id: string
          raised_by?: string | null
          root_cause?: string | null
          source?: Database["public"]["Enums"]["ncr_source"]
          source_id?: string | null
          status?: Database["public"]["Enums"]["ncr_status"]
          updated_at?: string
        }
        Update: {
          area?: string | null
          closed_at?: string | null
          closed_by?: string | null
          company_id?: string
          corrective_action?: string | null
          cost_impact?: number | null
          created_at?: string
          created_by?: string | null
          currency_code?: string | null
          description?: string
          discipline?: string | null
          disposition?: Database["public"]["Enums"]["ncr_disposition"]
          id?: string
          ncr_number?: string
          project_id?: string
          raised_by?: string | null
          root_cause?: string | null
          source?: Database["public"]["Enums"]["ncr_source"]
          source_id?: string | null
          status?: Database["public"]["Enums"]["ncr_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ncrs_closed_by_fkey"
            columns: ["closed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ncrs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ncrs_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ncrs_currency_code_fkey"
            columns: ["currency_code"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "ncrs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ncrs_raised_by_fkey"
            columns: ["raised_by"]
            isOneToOne: false
            referencedRelation: "profiles"
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
      notifications: {
        Row: {
          body: string | null
          company_id: string
          created_at: string
          id: string
          link: string | null
          read_at: string | null
          title: string
          type: string
          user_id: string
        }
        Insert: {
          body?: string | null
          company_id: string
          created_at?: string
          id?: string
          link?: string | null
          read_at?: string | null
          title: string
          type: string
          user_id: string
        }
        Update: {
          body?: string | null
          company_id?: string
          created_at?: string
          id?: string
          link?: string | null
          read_at?: string | null
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      offline_queue: {
        Row: {
          action: string
          client_idempotency_key: string
          company_id: string
          created_at: string
          entity: string
          error: string | null
          id: string
          payload: Json
          project_id: string | null
          status: Database["public"]["Enums"]["offline_queue_status"]
          synced_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          action: string
          client_idempotency_key: string
          company_id: string
          created_at?: string
          entity: string
          error?: string | null
          id?: string
          payload?: Json
          project_id?: string | null
          status?: Database["public"]["Enums"]["offline_queue_status"]
          synced_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          action?: string
          client_idempotency_key?: string
          company_id?: string
          created_at?: string
          entity?: string
          error?: string | null
          id?: string
          payload?: Json
          project_id?: string | null
          status?: Database["public"]["Enums"]["offline_queue_status"]
          synced_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "offline_queue_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "offline_queue_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "offline_queue_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      om_reports: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          data: Json
          generated_at: string | null
          generated_by: string | null
          id: string
          pdf_path: string | null
          period_end: string
          period_start: string
          project_id: string
          report_type: Database["public"]["Enums"]["om_report_type"]
          status: Database["public"]["Enums"]["om_report_status"]
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          data?: Json
          generated_at?: string | null
          generated_by?: string | null
          id?: string
          pdf_path?: string | null
          period_end: string
          period_start: string
          project_id: string
          report_type?: Database["public"]["Enums"]["om_report_type"]
          status?: Database["public"]["Enums"]["om_report_status"]
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          data?: Json
          generated_at?: string | null
          generated_by?: string | null
          id?: string
          pdf_path?: string | null
          period_end?: string
          period_start?: string
          project_id?: string
          report_type?: Database["public"]["Enums"]["om_report_type"]
          status?: Database["public"]["Enums"]["om_report_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "om_reports_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "om_reports_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "om_reports_generated_by_fkey"
            columns: ["generated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "om_reports_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      opportunities: {
        Row: {
          account_name: string | null
          archetype: Database["public"]["Enums"]["project_archetype"] | null
          capacity_mw: number | null
          company_id: string
          competitor: string | null
          converted_intake_id: string | null
          created_at: string
          created_by: string | null
          currency_code: string
          estimated_value: number | null
          expected_decision_date: string | null
          id: string
          lead_id: string | null
          loss_reason: string | null
          lost_at: string | null
          name: string
          notes: string | null
          owner_id: string | null
          probability: number | null
          stage: Database["public"]["Enums"]["opportunity_stage"]
          updated_at: string
          won_at: string | null
        }
        Insert: {
          account_name?: string | null
          archetype?: Database["public"]["Enums"]["project_archetype"] | null
          capacity_mw?: number | null
          company_id: string
          competitor?: string | null
          converted_intake_id?: string | null
          created_at?: string
          created_by?: string | null
          currency_code?: string
          estimated_value?: number | null
          expected_decision_date?: string | null
          id?: string
          lead_id?: string | null
          loss_reason?: string | null
          lost_at?: string | null
          name: string
          notes?: string | null
          owner_id?: string | null
          probability?: number | null
          stage?: Database["public"]["Enums"]["opportunity_stage"]
          updated_at?: string
          won_at?: string | null
        }
        Update: {
          account_name?: string | null
          archetype?: Database["public"]["Enums"]["project_archetype"] | null
          capacity_mw?: number | null
          company_id?: string
          competitor?: string | null
          converted_intake_id?: string | null
          created_at?: string
          created_by?: string | null
          currency_code?: string
          estimated_value?: number | null
          expected_decision_date?: string | null
          id?: string
          lead_id?: string | null
          loss_reason?: string | null
          lost_at?: string | null
          name?: string
          notes?: string | null
          owner_id?: string | null
          probability?: number | null
          stage?: Database["public"]["Enums"]["opportunity_stage"]
          updated_at?: string
          won_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "opportunities_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunities_converted_intake_id_fkey"
            columns: ["converted_intake_id"]
            isOneToOne: false
            referencedRelation: "project_intake"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunities_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunities_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      pay_applications: {
        Row: {
          application_number: number
          approved_at: string | null
          approved_by: string | null
          certified_at: string | null
          certified_by: string | null
          company_id: string
          contract_id: string
          created_at: string
          created_by: string | null
          id: string
          invoice_id: string | null
          lines: Json
          net_amount: number
          period_end: string
          period_start: string
          project_id: string
          reconciliation: Json
          reject_note: string | null
          retention_amount: number
          retention_pct: number
          status: Database["public"]["Enums"]["pay_app_status"]
          total_certified: number
          total_scheduled: number
          updated_at: string
        }
        Insert: {
          application_number: number
          approved_at?: string | null
          approved_by?: string | null
          certified_at?: string | null
          certified_by?: string | null
          company_id: string
          contract_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          invoice_id?: string | null
          lines?: Json
          net_amount?: number
          period_end: string
          period_start: string
          project_id: string
          reconciliation?: Json
          reject_note?: string | null
          retention_amount?: number
          retention_pct?: number
          status?: Database["public"]["Enums"]["pay_app_status"]
          total_certified?: number
          total_scheduled?: number
          updated_at?: string
        }
        Update: {
          application_number?: number
          approved_at?: string | null
          approved_by?: string | null
          certified_at?: string | null
          certified_by?: string | null
          company_id?: string
          contract_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          invoice_id?: string | null
          lines?: Json
          net_amount?: number
          period_end?: string
          period_start?: string
          project_id?: string
          reconciliation?: Json
          reject_note?: string | null
          retention_amount?: number
          retention_pct?: number
          status?: Database["public"]["Enums"]["pay_app_status"]
          total_certified?: number
          total_scheduled?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pay_applications_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pay_applications_certified_by_fkey"
            columns: ["certified_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pay_applications_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pay_applications_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pay_applications_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pay_applications_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pay_applications_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      performance_tests: {
        Row: {
          company_id: string
          contract_value: number | null
          created_at: string
          created_by: string | null
          id: string
          measured_value: number | null
          metered_energy_mwh: number | null
          notes: string | null
          period_end: string | null
          period_start: string | null
          plane_of_array_kwh_m2: number | null
          project_id: string
          report_file_path: string | null
          results: Json
          status: string
          test_type: string
          unit: string
          updated_at: string
        }
        Insert: {
          company_id: string
          contract_value?: number | null
          created_at?: string
          created_by?: string | null
          id?: string
          measured_value?: number | null
          metered_energy_mwh?: number | null
          notes?: string | null
          period_end?: string | null
          period_start?: string | null
          plane_of_array_kwh_m2?: number | null
          project_id: string
          report_file_path?: string | null
          results?: Json
          status?: string
          test_type?: string
          unit?: string
          updated_at?: string
        }
        Update: {
          company_id?: string
          contract_value?: number | null
          created_at?: string
          created_by?: string | null
          id?: string
          measured_value?: number | null
          metered_energy_mwh?: number | null
          notes?: string | null
          period_end?: string | null
          period_start?: string | null
          plane_of_array_kwh_m2?: number | null
          project_id?: string
          report_file_path?: string | null
          results?: Json
          status?: string
          test_type?: string
          unit?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "performance_tests_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "performance_tests_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "performance_tests_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      permits_to_work: {
        Row: {
          closed_at: string | null
          closed_by: string | null
          company_id: string
          created_at: string
          created_by: string | null
          description: string
          id: string
          isolations: Json
          isolations_confirmed: boolean
          issued_by: string | null
          location: string
          permit_type: Database["public"]["Enums"]["ptw_type"]
          project_id: string
          ptw_number: string
          requested_by: string | null
          status: Database["public"]["Enums"]["ptw_status"]
          updated_at: string
          valid_from: string
          valid_to: string
        }
        Insert: {
          closed_at?: string | null
          closed_by?: string | null
          company_id: string
          created_at?: string
          created_by?: string | null
          description: string
          id?: string
          isolations?: Json
          isolations_confirmed?: boolean
          issued_by?: string | null
          location: string
          permit_type: Database["public"]["Enums"]["ptw_type"]
          project_id: string
          ptw_number: string
          requested_by?: string | null
          status?: Database["public"]["Enums"]["ptw_status"]
          updated_at?: string
          valid_from: string
          valid_to: string
        }
        Update: {
          closed_at?: string | null
          closed_by?: string | null
          company_id?: string
          created_at?: string
          created_by?: string | null
          description?: string
          id?: string
          isolations?: Json
          isolations_confirmed?: boolean
          issued_by?: string | null
          location?: string
          permit_type?: Database["public"]["Enums"]["ptw_type"]
          project_id?: string
          ptw_number?: string
          requested_by?: string | null
          status?: Database["public"]["Enums"]["ptw_status"]
          updated_at?: string
          valid_from?: string
          valid_to?: string
        }
        Relationships: [
          {
            foreignKeyName: "permits_to_work_closed_by_fkey"
            columns: ["closed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "permits_to_work_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "permits_to_work_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "permits_to_work_issued_by_fkey"
            columns: ["issued_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "permits_to_work_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "permits_to_work_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      portal_audit_events: {
        Row: {
          actor_id: string | null
          company_id: string
          created_at: string
          event: string
          id: string
          membership_id: string | null
          metadata: Json
          project_id: string
        }
        Insert: {
          actor_id?: string | null
          company_id: string
          created_at?: string
          event: string
          id?: string
          membership_id?: string | null
          metadata?: Json
          project_id: string
        }
        Update: {
          actor_id?: string | null
          company_id?: string
          created_at?: string
          event?: string
          id?: string
          membership_id?: string | null
          metadata?: Json
          project_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "portal_audit_events_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portal_audit_events_membership_id_fkey"
            columns: ["membership_id"]
            isOneToOne: false
            referencedRelation: "portal_memberships"
            referencedColumns: ["id"]
          },
        ]
      }
      portal_memberships: {
        Row: {
          accepted_at: string | null
          company_id: string
          created_at: string
          email: string
          expires_at: string | null
          exposure: Json
          id: string
          invite_id: string | null
          invited_by: string | null
          last_seen_at: string | null
          project_id: string
          role: Database["public"]["Enums"]["app_role"]
          status: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          accepted_at?: string | null
          company_id: string
          created_at?: string
          email: string
          expires_at?: string | null
          exposure?: Json
          id?: string
          invite_id?: string | null
          invited_by?: string | null
          last_seen_at?: string | null
          project_id: string
          role?: Database["public"]["Enums"]["app_role"]
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          accepted_at?: string | null
          company_id?: string
          created_at?: string
          email?: string
          expires_at?: string | null
          exposure?: Json
          id?: string
          invite_id?: string | null
          invited_by?: string | null
          last_seen_at?: string | null
          project_id?: string
          role?: Database["public"]["Enums"]["app_role"]
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "portal_memberships_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portal_memberships_invite_id_fkey"
            columns: ["invite_id"]
            isOneToOne: false
            referencedRelation: "invites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portal_memberships_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portal_memberships_project_fk"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portal_memberships_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      portal_tickets: {
        Row: {
          body: string | null
          category: string
          company_id: string
          created_at: string
          id: string
          membership_id: string | null
          priority: string
          project_id: string
          raised_by: string | null
          resolved_at: string | null
          resolved_by: string | null
          status: string
          subject: string
          updated_at: string
        }
        Insert: {
          body?: string | null
          category?: string
          company_id: string
          created_at?: string
          id?: string
          membership_id?: string | null
          priority?: string
          project_id: string
          raised_by?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          subject: string
          updated_at?: string
        }
        Update: {
          body?: string | null
          category?: string
          company_id?: string
          created_at?: string
          id?: string
          membership_id?: string | null
          priority?: string
          project_id?: string
          raised_by?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          subject?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "portal_tickets_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portal_tickets_membership_id_fkey"
            columns: ["membership_id"]
            isOneToOne: false
            referencedRelation: "portal_memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portal_tickets_raised_by_fkey"
            columns: ["raised_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portal_tickets_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ppa_terms: {
        Row: {
          annual_energy_mwh: number | null
          availability_target_pct: number | null
          capacity_mw: number | null
          company_id: string
          contract_id: string | null
          counterparty: string | null
          created_at: string
          created_by: string | null
          currency_code: string
          escalation_pct: number
          id: string
          liquidated_damages: Json
          name: string
          notes: string | null
          project_id: string
          tariff: number
          term_years: number
          updated_at: string
        }
        Insert: {
          annual_energy_mwh?: number | null
          availability_target_pct?: number | null
          capacity_mw?: number | null
          company_id: string
          contract_id?: string | null
          counterparty?: string | null
          created_at?: string
          created_by?: string | null
          currency_code: string
          escalation_pct?: number
          id?: string
          liquidated_damages?: Json
          name: string
          notes?: string | null
          project_id: string
          tariff: number
          term_years: number
          updated_at?: string
        }
        Update: {
          annual_energy_mwh?: number | null
          availability_target_pct?: number | null
          capacity_mw?: number | null
          company_id?: string
          contract_id?: string | null
          counterparty?: string | null
          created_at?: string
          created_by?: string | null
          currency_code?: string
          escalation_pct?: number
          id?: string
          liquidated_damages?: Json
          name?: string
          notes?: string | null
          project_id?: string
          tariff?: number
          term_years?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ppa_terms_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ppa_terms_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ppa_terms_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ppa_terms_currency_code_fkey"
            columns: ["currency_code"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "ppa_terms_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      preventive_maintenance_plans: {
        Row: {
          active: boolean
          auto_generate: boolean
          checklist: Json
          company_id: string
          created_at: string
          created_by: string | null
          default_assignee: string | null
          description: string | null
          equipment_id: string | null
          estimated_hours: number | null
          frequency: Database["public"]["Enums"]["pm_frequency"]
          id: string
          interval_days: number
          last_generated_at: string | null
          next_due_date: string
          project_id: string
          title: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          auto_generate?: boolean
          checklist?: Json
          company_id: string
          created_at?: string
          created_by?: string | null
          default_assignee?: string | null
          description?: string | null
          equipment_id?: string | null
          estimated_hours?: number | null
          frequency: Database["public"]["Enums"]["pm_frequency"]
          id?: string
          interval_days?: number
          last_generated_at?: string | null
          next_due_date: string
          project_id: string
          title: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          auto_generate?: boolean
          checklist?: Json
          company_id?: string
          created_at?: string
          created_by?: string | null
          default_assignee?: string | null
          description?: string | null
          equipment_id?: string | null
          estimated_hours?: number | null
          frequency?: Database["public"]["Enums"]["pm_frequency"]
          id?: string
          interval_days?: number
          last_generated_at?: string | null
          next_due_date?: string
          project_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "preventive_maintenance_plans_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "preventive_maintenance_plans_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "preventive_maintenance_plans_default_assignee_fkey"
            columns: ["default_assignee"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "preventive_maintenance_plans_equipment_id_fkey"
            columns: ["equipment_id"]
            isOneToOne: false
            referencedRelation: "equipment_registry"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "preventive_maintenance_plans_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
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
      progress_weighting_rules: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          discipline: string
          id: string
          is_active: boolean
          name: string
          project_id: string | null
          target_qty: number
          uom: string
          updated_at: string
          weight_pct: number
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          discipline: string
          id?: string
          is_active?: boolean
          name: string
          project_id?: string | null
          target_qty: number
          uom: string
          updated_at?: string
          weight_pct: number
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          discipline?: string
          id?: string
          is_active?: boolean
          name?: string
          project_id?: string | null
          target_qty?: number
          uom?: string
          updated_at?: string
          weight_pct?: number
        }
        Relationships: [
          {
            foreignKeyName: "progress_weighting_rules_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "progress_weighting_rules_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "progress_weighting_rules_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
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
      project_export_locks: {
        Row: {
          approval_instance_id: string | null
          company_id: string
          created_at: string
          export_type: string
          id: string
          locked_at: string
          locked_by: string | null
          project_id: string
          reason: string
          unlocked_at: string | null
          updated_at: string
        }
        Insert: {
          approval_instance_id?: string | null
          company_id: string
          created_at?: string
          export_type: string
          id?: string
          locked_at?: string
          locked_by?: string | null
          project_id: string
          reason?: string
          unlocked_at?: string | null
          updated_at?: string
        }
        Update: {
          approval_instance_id?: string | null
          company_id?: string
          created_at?: string
          export_type?: string
          id?: string
          locked_at?: string
          locked_by?: string | null
          project_id?: string
          reason?: string
          unlocked_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "export_locks_project_fk"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_export_locks_approval_instance_id_fkey"
            columns: ["approval_instance_id"]
            isOneToOne: false
            referencedRelation: "approval_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_export_locks_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_export_locks_locked_by_fkey"
            columns: ["locked_by"]
            isOneToOne: false
            referencedRelation: "profiles"
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
      project_intake: {
        Row: {
          archetype: Database["public"]["Enums"]["project_archetype"] | null
          capacity_mw: number | null
          company_id: string
          created_at: string
          created_by: string | null
          id: string
          name: string
          notes: string | null
          offtaker: string | null
          site_location: string | null
          source: Database["public"]["Enums"]["project_intake_source"]
          source_opportunity_id: string | null
          status: Database["public"]["Enums"]["project_intake_status"]
          target_cod: string | null
          updated_at: string
        }
        Insert: {
          archetype?: Database["public"]["Enums"]["project_archetype"] | null
          capacity_mw?: number | null
          company_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          notes?: string | null
          offtaker?: string | null
          site_location?: string | null
          source?: Database["public"]["Enums"]["project_intake_source"]
          source_opportunity_id?: string | null
          status?: Database["public"]["Enums"]["project_intake_status"]
          target_cod?: string | null
          updated_at?: string
        }
        Update: {
          archetype?: Database["public"]["Enums"]["project_archetype"] | null
          capacity_mw?: number | null
          company_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          notes?: string | null
          offtaker?: string | null
          site_location?: string | null
          source?: Database["public"]["Enums"]["project_intake_source"]
          source_opportunity_id?: string | null
          status?: Database["public"]["Enums"]["project_intake_status"]
          target_cod?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_intake_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_intake_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_intake_source_opportunity_id_fkey"
            columns: ["source_opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
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
          params: Json
          project_id: string
          pvsyst_version: string | null
          scenario_name: string
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
          params?: Json
          project_id: string
          pvsyst_version?: string | null
          scenario_name?: string
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
          params?: Json
          project_id?: string
          pvsyst_version?: string | null
          scenario_name?: string
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
            isOneToOne: false
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
          bus_config: string | null
          company_id: string
          created_at: string
          hv_voltage_kv: number | null
          id: string
          lv_voltage_kv: number | null
          metering_points: Json | null
          mv_voltage_kv: number | null
          notes: string | null
          project_id: string
          protection_scheme: string | null
          updated_at: string
          voltage_levels: Json
        }
        Insert: {
          bus_config?: string | null
          company_id: string
          created_at?: string
          hv_voltage_kv?: number | null
          id?: string
          lv_voltage_kv?: number | null
          metering_points?: Json | null
          mv_voltage_kv?: number | null
          notes?: string | null
          project_id: string
          protection_scheme?: string | null
          updated_at?: string
          voltage_levels?: Json
        }
        Update: {
          bus_config?: string | null
          company_id?: string
          created_at?: string
          hv_voltage_kv?: number | null
          id?: string
          lv_voltage_kv?: number | null
          metering_points?: Json | null
          mv_voltage_kv?: number | null
          notes?: string | null
          project_id?: string
          protection_scheme?: string | null
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
          contract_pr: number | null
          created_at: string
          degradation_pct: number | null
          ghi_kwh_m2: number | null
          id: string
          losses_pct: number | null
          p50_mwh: number | null
          p90_mwh: number | null
          params: Json
          project_id: string
          results: Json
          scenario_name: string
          updated_at: string
        }
        Insert: {
          availability_pct?: number | null
          company_id: string
          contract_pr?: number | null
          created_at?: string
          degradation_pct?: number | null
          ghi_kwh_m2?: number | null
          id?: string
          losses_pct?: number | null
          p50_mwh?: number | null
          p90_mwh?: number | null
          params?: Json
          project_id: string
          results?: Json
          scenario_name?: string
          updated_at?: string
        }
        Update: {
          availability_pct?: number | null
          company_id?: string
          contract_pr?: number | null
          created_at?: string
          degradation_pct?: number | null
          ghi_kwh_m2?: number | null
          id?: string
          losses_pct?: number | null
          p50_mwh?: number | null
          p90_mwh?: number | null
          params?: Json
          project_id?: string
          results?: Json
          scenario_name?: string
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
            isOneToOne: false
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
      proposal_line_items: {
        Row: {
          category: string
          company_id: string
          created_at: string
          created_by: string | null
          description: string
          id: string
          line_total: number
          proposal_id: string
          qty: number
          sort_order: number
          unit: string
          unit_price: number
          updated_at: string
        }
        Insert: {
          category?: string
          company_id: string
          created_at?: string
          created_by?: string | null
          description: string
          id?: string
          line_total?: number
          proposal_id: string
          qty?: number
          sort_order?: number
          unit?: string
          unit_price?: number
          updated_at?: string
        }
        Update: {
          category?: string
          company_id?: string
          created_at?: string
          created_by?: string | null
          description?: string
          id?: string
          line_total?: number
          proposal_id?: string
          qty?: number
          sort_order?: number
          unit?: string
          unit_price?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "proposal_line_items_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proposal_line_items_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proposal_line_items_proposal_id_fkey"
            columns: ["proposal_id"]
            isOneToOne: false
            referencedRelation: "proposals"
            referencedColumns: ["id"]
          },
        ]
      }
      proposals: {
        Row: {
          accepted_at: string | null
          array_config: Json
          company_id: string
          contingency_pct: number
          created_at: string
          created_by: string | null
          currency_code: string
          esign_completed_at: string | null
          esign_envelope_id: string | null
          esign_history: Json
          esign_provider: string | null
          esign_sent_at: string | null
          esign_status: string | null
          fx_rate_snapshot: number | null
          id: string
          margin_pct: number | null
          notes: string | null
          opportunity_id: string
          previous_version_id: string | null
          pricing_lock: Json | null
          project_id: string | null
          sent_at: string | null
          signed_copy_path: string | null
          status: Database["public"]["Enums"]["proposal_status"]
          subtotal: number
          title: string
          total: number
          updated_at: string
          valid_until: string | null
          version: number
          yield_result: Json | null
        }
        Insert: {
          accepted_at?: string | null
          array_config?: Json
          company_id: string
          contingency_pct?: number
          created_at?: string
          created_by?: string | null
          currency_code?: string
          esign_completed_at?: string | null
          esign_envelope_id?: string | null
          esign_history?: Json
          esign_provider?: string | null
          esign_sent_at?: string | null
          esign_status?: string | null
          fx_rate_snapshot?: number | null
          id?: string
          margin_pct?: number | null
          notes?: string | null
          opportunity_id: string
          previous_version_id?: string | null
          pricing_lock?: Json | null
          project_id?: string | null
          sent_at?: string | null
          signed_copy_path?: string | null
          status?: Database["public"]["Enums"]["proposal_status"]
          subtotal?: number
          title: string
          total?: number
          updated_at?: string
          valid_until?: string | null
          version?: number
          yield_result?: Json | null
        }
        Update: {
          accepted_at?: string | null
          array_config?: Json
          company_id?: string
          contingency_pct?: number
          created_at?: string
          created_by?: string | null
          currency_code?: string
          esign_completed_at?: string | null
          esign_envelope_id?: string | null
          esign_history?: Json
          esign_provider?: string | null
          esign_sent_at?: string | null
          esign_status?: string | null
          fx_rate_snapshot?: number | null
          id?: string
          margin_pct?: number | null
          notes?: string | null
          opportunity_id?: string
          previous_version_id?: string | null
          pricing_lock?: Json | null
          project_id?: string | null
          sent_at?: string | null
          signed_copy_path?: string | null
          status?: Database["public"]["Enums"]["proposal_status"]
          subtotal?: number
          title?: string
          total?: number
          updated_at?: string
          valid_until?: string | null
          version?: number
          yield_result?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "proposals_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proposals_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proposals_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proposals_previous_version_id_fkey"
            columns: ["previous_version_id"]
            isOneToOne: false
            referencedRelation: "proposals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proposals_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      punch_signoffs: {
        Row: {
          category: string
          company_id: string
          created_at: string
          evidence_file_path: string | null
          id: string
          notes: string | null
          project_id: string
          punch_item_id: string
          signed_at: string
          signed_by: string | null
          signer_name: string | null
          signoff_party: string
          updated_at: string
        }
        Insert: {
          category: string
          company_id: string
          created_at?: string
          evidence_file_path?: string | null
          id?: string
          notes?: string | null
          project_id: string
          punch_item_id: string
          signed_at?: string
          signed_by?: string | null
          signer_name?: string | null
          signoff_party: string
          updated_at?: string
        }
        Update: {
          category?: string
          company_id?: string
          created_at?: string
          evidence_file_path?: string | null
          id?: string
          notes?: string | null
          project_id?: string
          punch_item_id?: string
          signed_at?: string
          signed_by?: string | null
          signer_name?: string | null
          signoff_party?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "punch_signoffs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "punch_signoffs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "punch_signoffs_punch_item_id_fkey"
            columns: ["punch_item_id"]
            isOneToOne: false
            referencedRelation: "qaqc_punch_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "punch_signoffs_signed_by_fkey"
            columns: ["signed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_orders: {
        Row: {
          approval_note: string | null
          approved_at: string | null
          approved_by: string | null
          company_id: string
          created_at: string
          created_by: string | null
          currency_code: string
          delivery_address: string | null
          id: string
          incoterms: string | null
          issued_at: string | null
          lines: Json
          payment_terms: string | null
          pdf_path: string | null
          po_number: string
          project_id: string
          required_by_date: string | null
          rfq_id: string | null
          share_token: string | null
          share_token_expires_at: string | null
          status: Database["public"]["Enums"]["po_status"]
          subtotal: number
          tax_amount: number
          tax_pct: number
          total_amount: number
          updated_at: string
          vendor_id: string
        }
        Insert: {
          approval_note?: string | null
          approved_at?: string | null
          approved_by?: string | null
          company_id: string
          created_at?: string
          created_by?: string | null
          currency_code: string
          delivery_address?: string | null
          id?: string
          incoterms?: string | null
          issued_at?: string | null
          lines?: Json
          payment_terms?: string | null
          pdf_path?: string | null
          po_number: string
          project_id: string
          required_by_date?: string | null
          rfq_id?: string | null
          share_token?: string | null
          share_token_expires_at?: string | null
          status?: Database["public"]["Enums"]["po_status"]
          subtotal?: number
          tax_amount?: number
          tax_pct?: number
          total_amount?: number
          updated_at?: string
          vendor_id: string
        }
        Update: {
          approval_note?: string | null
          approved_at?: string | null
          approved_by?: string | null
          company_id?: string
          created_at?: string
          created_by?: string | null
          currency_code?: string
          delivery_address?: string | null
          id?: string
          incoterms?: string | null
          issued_at?: string | null
          lines?: Json
          payment_terms?: string | null
          pdf_path?: string | null
          po_number?: string
          project_id?: string
          required_by_date?: string | null
          rfq_id?: string | null
          share_token?: string | null
          share_token_expires_at?: string | null
          status?: Database["public"]["Enums"]["po_status"]
          subtotal?: number
          tax_amount?: number
          tax_pct?: number
          total_amount?: number
          updated_at?: string
          vendor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_orders_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_currency_code_fkey"
            columns: ["currency_code"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "purchase_orders_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_rfq_id_fkey"
            columns: ["rfq_id"]
            isOneToOne: false
            referencedRelation: "rfqs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      pv_equipment_library: {
        Row: {
          category: Database["public"]["Enums"]["pv_equipment_category"]
          certifications: Json
          company_id: string
          created_at: string
          created_by: string | null
          datasheet_path: string | null
          degradation: Json
          dimensions: Json
          docs: Json
          electrical: Json
          id: string
          is_active: boolean
          limits: Json
          manufacturer: string
          model: string
          temp_coefficients: Json
          updated_at: string
          warranties: Json
        }
        Insert: {
          category: Database["public"]["Enums"]["pv_equipment_category"]
          certifications?: Json
          company_id: string
          created_at?: string
          created_by?: string | null
          datasheet_path?: string | null
          degradation?: Json
          dimensions?: Json
          docs?: Json
          electrical?: Json
          id?: string
          is_active?: boolean
          limits?: Json
          manufacturer: string
          model: string
          temp_coefficients?: Json
          updated_at?: string
          warranties?: Json
        }
        Update: {
          category?: Database["public"]["Enums"]["pv_equipment_category"]
          certifications?: Json
          company_id?: string
          created_at?: string
          created_by?: string | null
          datasheet_path?: string | null
          degradation?: Json
          dimensions?: Json
          docs?: Json
          electrical?: Json
          id?: string
          is_active?: boolean
          limits?: Json
          manufacturer?: string
          model?: string
          temp_coefficients?: Json
          updated_at?: string
          warranties?: Json
        }
        Relationships: [
          {
            foreignKeyName: "pv_equipment_library_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pv_equipment_library_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      pv_layout_blocks: {
        Row: {
          block_type: Database["public"]["Enums"]["pv_layout_block_type"]
          company_id: string
          created_at: string
          dc_kwp: number
          equipment_id: string | null
          geometry: Json
          id: string
          label: string | null
          layout_id: string
          module_count: number
          module_rows: number | null
          modules_per_row: number | null
          sort_order: number
          updated_at: string
        }
        Insert: {
          block_type: Database["public"]["Enums"]["pv_layout_block_type"]
          company_id: string
          created_at?: string
          dc_kwp?: number
          equipment_id?: string | null
          geometry: Json
          id?: string
          label?: string | null
          layout_id: string
          module_count?: number
          module_rows?: number | null
          modules_per_row?: number | null
          sort_order?: number
          updated_at?: string
        }
        Update: {
          block_type?: Database["public"]["Enums"]["pv_layout_block_type"]
          company_id?: string
          created_at?: string
          dc_kwp?: number
          equipment_id?: string | null
          geometry?: Json
          id?: string
          label?: string | null
          layout_id?: string
          module_count?: number
          module_rows?: number | null
          modules_per_row?: number | null
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pv_layout_blocks_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pv_layout_blocks_equipment_id_fkey"
            columns: ["equipment_id"]
            isOneToOne: false
            referencedRelation: "pv_equipment_library"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pv_layout_blocks_layout_id_fkey"
            columns: ["layout_id"]
            isOneToOne: false
            referencedRelation: "pv_layouts"
            referencedColumns: ["id"]
          },
        ]
      }
      pv_layouts: {
        Row: {
          approval_instance_id: string | null
          company_id: string
          created_at: string
          created_by: string | null
          id: string
          layout_number: string | null
          name: string
          params: Json
          project_id: string
          site_config_id: string | null
          status: string
          totals: Json
          updated_at: string
          version: number
        }
        Insert: {
          approval_instance_id?: string | null
          company_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          layout_number?: string | null
          name: string
          params?: Json
          project_id: string
          site_config_id?: string | null
          status?: string
          totals?: Json
          updated_at?: string
          version?: number
        }
        Update: {
          approval_instance_id?: string | null
          company_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          layout_number?: string | null
          name?: string
          params?: Json
          project_id?: string
          site_config_id?: string | null
          status?: string
          totals?: Json
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "pv_layouts_approval_instance_id_fkey"
            columns: ["approval_instance_id"]
            isOneToOne: false
            referencedRelation: "approval_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pv_layouts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pv_layouts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pv_layouts_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pv_layouts_site_config_id_fkey"
            columns: ["site_config_id"]
            isOneToOne: false
            referencedRelation: "pv_site_configs"
            referencedColumns: ["id"]
          },
        ]
      }
      pv_simulation_results: {
        Row: {
          annual: Json
          calc_version: number
          company_id: string
          computed_at: string
          created_at: string
          engine_id: string
          id: string
          loss_chain: Json
          monthly: Json
          p_scenarios: Json
          simulation_id: string
          updated_at: string
        }
        Insert: {
          annual?: Json
          calc_version?: number
          company_id: string
          computed_at?: string
          created_at?: string
          engine_id?: string
          id?: string
          loss_chain?: Json
          monthly?: Json
          p_scenarios?: Json
          simulation_id: string
          updated_at?: string
        }
        Update: {
          annual?: Json
          calc_version?: number
          company_id?: string
          computed_at?: string
          created_at?: string
          engine_id?: string
          id?: string
          loss_chain?: Json
          monthly?: Json
          p_scenarios?: Json
          simulation_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pv_simulation_results_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pv_simulation_results_simulation_id_fkey"
            columns: ["simulation_id"]
            isOneToOne: false
            referencedRelation: "pv_simulations"
            referencedColumns: ["id"]
          },
        ]
      }
      pv_simulations: {
        Row: {
          approval_instance_id: string | null
          calc_version: number
          company_id: string
          computed_at: string | null
          created_at: string
          created_by: string | null
          engine_id: string
          id: string
          input_sources: Json
          inputs: Json
          is_baseline: boolean
          layout_id: string | null
          name: string
          project_id: string
          site_config_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          approval_instance_id?: string | null
          calc_version?: number
          company_id: string
          computed_at?: string | null
          created_at?: string
          created_by?: string | null
          engine_id?: string
          id?: string
          input_sources?: Json
          inputs?: Json
          is_baseline?: boolean
          layout_id?: string | null
          name: string
          project_id: string
          site_config_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          approval_instance_id?: string | null
          calc_version?: number
          company_id?: string
          computed_at?: string | null
          created_at?: string
          created_by?: string | null
          engine_id?: string
          id?: string
          input_sources?: Json
          inputs?: Json
          is_baseline?: boolean
          layout_id?: string | null
          name?: string
          project_id?: string
          site_config_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pv_simulations_approval_instance_id_fkey"
            columns: ["approval_instance_id"]
            isOneToOne: false
            referencedRelation: "approval_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pv_simulations_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pv_simulations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pv_simulations_layout_id_fkey"
            columns: ["layout_id"]
            isOneToOne: false
            referencedRelation: "pv_layouts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pv_simulations_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pv_simulations_site_config_id_fkey"
            columns: ["site_config_id"]
            isOneToOne: false
            referencedRelation: "pv_site_configs"
            referencedColumns: ["id"]
          },
        ]
      }
      pv_site_configs: {
        Row: {
          albedo: number
          altitude_m: number | null
          approved_at: string | null
          approved_by: string | null
          boundary: Json
          company_id: string
          created_at: string
          created_by: string | null
          exclusions: Json
          id: string
          latitude: number | null
          longitude: number | null
          name: string
          project_id: string
          status: string
          terrain_azimuth_deg: number | null
          terrain_slope_pct: number | null
          timezone: string | null
          updated_at: string
          usable_area_ha: number | null
          weather_meta: Json
          weather_source: string
        }
        Insert: {
          albedo?: number
          altitude_m?: number | null
          approved_at?: string | null
          approved_by?: string | null
          boundary?: Json
          company_id: string
          created_at?: string
          created_by?: string | null
          exclusions?: Json
          id?: string
          latitude?: number | null
          longitude?: number | null
          name: string
          project_id: string
          status?: string
          terrain_azimuth_deg?: number | null
          terrain_slope_pct?: number | null
          timezone?: string | null
          updated_at?: string
          usable_area_ha?: number | null
          weather_meta?: Json
          weather_source?: string
        }
        Update: {
          albedo?: number
          altitude_m?: number | null
          approved_at?: string | null
          approved_by?: string | null
          boundary?: Json
          company_id?: string
          created_at?: string
          created_by?: string | null
          exclusions?: Json
          id?: string
          latitude?: number | null
          longitude?: number | null
          name?: string
          project_id?: string
          status?: string
          terrain_azimuth_deg?: number | null
          terrain_slope_pct?: number | null
          timezone?: string | null
          updated_at?: string
          usable_area_ha?: number | null
          weather_meta?: Json
          weather_source?: string
        }
        Relationships: [
          {
            foreignKeyName: "pv_site_configs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pv_site_configs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      pv_string_assignments: {
        Row: {
          combiner_assignment: Json
          company_id: string
          created_at: string
          created_by: string | null
          dc_ac_ratio: number | null
          dc_kwp_on_mppt: number | null
          equipment_counts: Json
          id: string
          inverter_ac_kw: number | null
          inverter_dc_kwp: number | null
          inverter_id: string | null
          inverter_station_label: string
          layout_id: string
          loading_pct: number | null
          mppt_index: number
          mv_feeder: Json
          string_ids: string[]
          transformer: Json
          updated_at: string
          warnings: Json
        }
        Insert: {
          combiner_assignment?: Json
          company_id: string
          created_at?: string
          created_by?: string | null
          dc_ac_ratio?: number | null
          dc_kwp_on_mppt?: number | null
          equipment_counts?: Json
          id?: string
          inverter_ac_kw?: number | null
          inverter_dc_kwp?: number | null
          inverter_id?: string | null
          inverter_station_label: string
          layout_id: string
          loading_pct?: number | null
          mppt_index: number
          mv_feeder?: Json
          string_ids?: string[]
          transformer?: Json
          updated_at?: string
          warnings?: Json
        }
        Update: {
          combiner_assignment?: Json
          company_id?: string
          created_at?: string
          created_by?: string | null
          dc_ac_ratio?: number | null
          dc_kwp_on_mppt?: number | null
          equipment_counts?: Json
          id?: string
          inverter_ac_kw?: number | null
          inverter_dc_kwp?: number | null
          inverter_id?: string | null
          inverter_station_label?: string
          layout_id?: string
          loading_pct?: number | null
          mppt_index?: number
          mv_feeder?: Json
          string_ids?: string[]
          transformer?: Json
          updated_at?: string
          warnings?: Json
        }
        Relationships: [
          {
            foreignKeyName: "pv_string_assignments_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pv_string_assignments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pv_string_assignments_inverter_id_fkey"
            columns: ["inverter_id"]
            isOneToOne: false
            referencedRelation: "pv_equipment_library"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pv_string_assignments_layout_id_fkey"
            columns: ["layout_id"]
            isOneToOne: false
            referencedRelation: "pv_layouts"
            referencedColumns: ["id"]
          },
        ]
      }
      pv_strings: {
        Row: {
          block_id: string | null
          cable: Json
          combiner_label: string | null
          company_id: string
          created_at: string
          created_by: string | null
          dc_power_kwp: number | null
          id: string
          inverter_station_label: string | null
          layout_id: string
          module_id: string | null
          modules_in_series: number
          mppt_index: number | null
          string_label: string
          updated_at: string
          valid: boolean
          vmp_at_max_temp_v: number | null
          voc_at_min_temp_v: number | null
          warnings: Json
        }
        Insert: {
          block_id?: string | null
          cable?: Json
          combiner_label?: string | null
          company_id: string
          created_at?: string
          created_by?: string | null
          dc_power_kwp?: number | null
          id?: string
          inverter_station_label?: string | null
          layout_id: string
          module_id?: string | null
          modules_in_series: number
          mppt_index?: number | null
          string_label: string
          updated_at?: string
          valid?: boolean
          vmp_at_max_temp_v?: number | null
          voc_at_min_temp_v?: number | null
          warnings?: Json
        }
        Update: {
          block_id?: string | null
          cable?: Json
          combiner_label?: string | null
          company_id?: string
          created_at?: string
          created_by?: string | null
          dc_power_kwp?: number | null
          id?: string
          inverter_station_label?: string | null
          layout_id?: string
          module_id?: string | null
          modules_in_series?: number
          mppt_index?: number | null
          string_label?: string
          updated_at?: string
          valid?: boolean
          vmp_at_max_temp_v?: number | null
          voc_at_min_temp_v?: number | null
          warnings?: Json
        }
        Relationships: [
          {
            foreignKeyName: "pv_strings_block_id_fkey"
            columns: ["block_id"]
            isOneToOne: false
            referencedRelation: "pv_layout_blocks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pv_strings_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pv_strings_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pv_strings_layout_id_fkey"
            columns: ["layout_id"]
            isOneToOne: false
            referencedRelation: "pv_layouts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pv_strings_module_id_fkey"
            columns: ["module_id"]
            isOneToOne: false
            referencedRelation: "pv_equipment_library"
            referencedColumns: ["id"]
          },
        ]
      }
      qaqc_inspections: {
        Row: {
          area: string
          attachments: Json
          company_id: string
          created_at: string
          created_by: string | null
          discipline: Database["public"]["Enums"]["qaqc_discipline"]
          id: string
          inspection_date: string
          inspection_number: string
          inspector_id: string | null
          itp_reference: string | null
          project_id: string
          result: Database["public"]["Enums"]["qaqc_result"]
          rework_notes: string | null
          rework_required: boolean
          updated_at: string
          wbs_item_id: string | null
        }
        Insert: {
          area: string
          attachments?: Json
          company_id: string
          created_at?: string
          created_by?: string | null
          discipline: Database["public"]["Enums"]["qaqc_discipline"]
          id?: string
          inspection_date: string
          inspection_number: string
          inspector_id?: string | null
          itp_reference?: string | null
          project_id: string
          result?: Database["public"]["Enums"]["qaqc_result"]
          rework_notes?: string | null
          rework_required?: boolean
          updated_at?: string
          wbs_item_id?: string | null
        }
        Update: {
          area?: string
          attachments?: Json
          company_id?: string
          created_at?: string
          created_by?: string | null
          discipline?: Database["public"]["Enums"]["qaqc_discipline"]
          id?: string
          inspection_date?: string
          inspection_number?: string
          inspector_id?: string | null
          itp_reference?: string | null
          project_id?: string
          result?: Database["public"]["Enums"]["qaqc_result"]
          rework_notes?: string | null
          rework_required?: boolean
          updated_at?: string
          wbs_item_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "qaqc_inspections_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qaqc_inspections_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qaqc_inspections_inspector_id_fkey"
            columns: ["inspector_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qaqc_inspections_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qaqc_inspections_wbs_item_id_fkey"
            columns: ["wbs_item_id"]
            isOneToOne: false
            referencedRelation: "wbs_items"
            referencedColumns: ["id"]
          },
        ]
      }
      qaqc_punch_items: {
        Row: {
          area: string
          assigned_to: string | null
          category: Database["public"]["Enums"]["punch_category"]
          closed_at: string | null
          closed_by: string | null
          company_id: string
          created_at: string
          created_by: string | null
          description: string
          discipline: Database["public"]["Enums"]["qaqc_discipline"]
          due_date: string | null
          id: string
          photo_ids: Json
          project_id: string
          punch_number: string
          raised_by: string | null
          signoff_at: string | null
          signoff_by: string | null
          signoff_name: string | null
          status: Database["public"]["Enums"]["punch_status"]
          updated_at: string
          utility_witness_required: boolean
          walk_date: string
        }
        Insert: {
          area: string
          assigned_to?: string | null
          category?: Database["public"]["Enums"]["punch_category"]
          closed_at?: string | null
          closed_by?: string | null
          company_id: string
          created_at?: string
          created_by?: string | null
          description: string
          discipline: Database["public"]["Enums"]["qaqc_discipline"]
          due_date?: string | null
          id?: string
          photo_ids?: Json
          project_id: string
          punch_number: string
          raised_by?: string | null
          signoff_at?: string | null
          signoff_by?: string | null
          signoff_name?: string | null
          status?: Database["public"]["Enums"]["punch_status"]
          updated_at?: string
          utility_witness_required?: boolean
          walk_date: string
        }
        Update: {
          area?: string
          assigned_to?: string | null
          category?: Database["public"]["Enums"]["punch_category"]
          closed_at?: string | null
          closed_by?: string | null
          company_id?: string
          created_at?: string
          created_by?: string | null
          description?: string
          discipline?: Database["public"]["Enums"]["qaqc_discipline"]
          due_date?: string | null
          id?: string
          photo_ids?: Json
          project_id?: string
          punch_number?: string
          raised_by?: string | null
          signoff_at?: string | null
          signoff_by?: string | null
          signoff_name?: string | null
          status?: Database["public"]["Enums"]["punch_status"]
          updated_at?: string
          utility_witness_required?: boolean
          walk_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "qaqc_punch_items_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qaqc_punch_items_closed_by_fkey"
            columns: ["closed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qaqc_punch_items_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qaqc_punch_items_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qaqc_punch_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qaqc_punch_items_raised_by_fkey"
            columns: ["raised_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qaqc_punch_items_signoff_by_fkey"
            columns: ["signoff_by"]
            isOneToOne: false
            referencedRelation: "profiles"
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
      recovery_plans: {
        Row: {
          actions: Json
          approved_at: string | null
          approved_by: string | null
          company_id: string
          created_at: string
          created_by: string | null
          delay_analysis_id: string | null
          id: string
          plan_number: string
          project_id: string
          status: Database["public"]["Enums"]["recovery_plan_status"]
          target_recovery_date: string | null
          title: string
          updated_at: string
        }
        Insert: {
          actions?: Json
          approved_at?: string | null
          approved_by?: string | null
          company_id: string
          created_at?: string
          created_by?: string | null
          delay_analysis_id?: string | null
          id?: string
          plan_number: string
          project_id: string
          status?: Database["public"]["Enums"]["recovery_plan_status"]
          target_recovery_date?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          actions?: Json
          approved_at?: string | null
          approved_by?: string | null
          company_id?: string
          created_at?: string
          created_by?: string | null
          delay_analysis_id?: string | null
          id?: string
          plan_number?: string
          project_id?: string
          status?: Database["public"]["Enums"]["recovery_plan_status"]
          target_recovery_date?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "recovery_plans_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recovery_plans_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recovery_plans_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recovery_plans_delay_analysis_id_fkey"
            columns: ["delay_analysis_id"]
            isOneToOne: false
            referencedRelation: "delay_analysis"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recovery_plans_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      rfis: {
        Row: {
          answer: string | null
          answered_at: string | null
          answered_by: string | null
          closed_at: string | null
          company_id: string
          cost_impact: boolean
          created_at: string
          created_by: string | null
          discipline: Database["public"]["Enums"]["drawing_discipline"]
          drawing_id: string | null
          due_date: string | null
          id: string
          priority: string
          project_id: string
          question: string
          raised_by: string | null
          rfi_number: string
          routed_to: string | null
          schedule_impact: boolean
          status: string
          subject: string
          updated_at: string
        }
        Insert: {
          answer?: string | null
          answered_at?: string | null
          answered_by?: string | null
          closed_at?: string | null
          company_id: string
          cost_impact?: boolean
          created_at?: string
          created_by?: string | null
          discipline?: Database["public"]["Enums"]["drawing_discipline"]
          drawing_id?: string | null
          due_date?: string | null
          id?: string
          priority?: string
          project_id: string
          question: string
          raised_by?: string | null
          rfi_number: string
          routed_to?: string | null
          schedule_impact?: boolean
          status?: string
          subject: string
          updated_at?: string
        }
        Update: {
          answer?: string | null
          answered_at?: string | null
          answered_by?: string | null
          closed_at?: string | null
          company_id?: string
          cost_impact?: boolean
          created_at?: string
          created_by?: string | null
          discipline?: Database["public"]["Enums"]["drawing_discipline"]
          drawing_id?: string | null
          due_date?: string | null
          id?: string
          priority?: string
          project_id?: string
          question?: string
          raised_by?: string | null
          rfi_number?: string
          routed_to?: string | null
          schedule_impact?: boolean
          status?: string
          subject?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rfis_answered_by_fkey"
            columns: ["answered_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rfis_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rfis_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rfis_drawing_id_fkey"
            columns: ["drawing_id"]
            isOneToOne: false
            referencedRelation: "drawing_register"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rfis_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rfis_raised_by_fkey"
            columns: ["raised_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rfis_routed_to_fkey"
            columns: ["routed_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      rfq_bids: {
        Row: {
          attachments: Json
          company_id: string
          created_at: string
          created_by: string | null
          currency_code: string | null
          id: string
          lead_time_days: number | null
          lines: Json
          rfq_id: string
          status: Database["public"]["Enums"]["rfq_bid_status"]
          submitted_at: string | null
          total_price: number | null
          updated_at: string
          validity_date: string | null
          vendor_id: string
        }
        Insert: {
          attachments?: Json
          company_id: string
          created_at?: string
          created_by?: string | null
          currency_code?: string | null
          id?: string
          lead_time_days?: number | null
          lines?: Json
          rfq_id: string
          status?: Database["public"]["Enums"]["rfq_bid_status"]
          submitted_at?: string | null
          total_price?: number | null
          updated_at?: string
          validity_date?: string | null
          vendor_id: string
        }
        Update: {
          attachments?: Json
          company_id?: string
          created_at?: string
          created_by?: string | null
          currency_code?: string | null
          id?: string
          lead_time_days?: number | null
          lines?: Json
          rfq_id?: string
          status?: Database["public"]["Enums"]["rfq_bid_status"]
          submitted_at?: string | null
          total_price?: number | null
          updated_at?: string
          validity_date?: string | null
          vendor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rfq_bids_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rfq_bids_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rfq_bids_currency_code_fkey"
            columns: ["currency_code"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "rfq_bids_rfq_id_fkey"
            columns: ["rfq_id"]
            isOneToOne: false
            referencedRelation: "rfqs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rfq_bids_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      rfq_line_awards: {
        Row: {
          award_note: string | null
          awarded_amount: number
          awarded_at: string
          awarded_by: string | null
          awarded_qty: number
          awarded_unit_price: number
          company_id: string
          created_at: string
          id: string
          line_no: number
          rfq_bid_id: string
          rfq_id: string
          tco_score: number | null
          updated_at: string
        }
        Insert: {
          award_note?: string | null
          awarded_amount: number
          awarded_at?: string
          awarded_by?: string | null
          awarded_qty: number
          awarded_unit_price: number
          company_id: string
          created_at?: string
          id?: string
          line_no: number
          rfq_bid_id: string
          rfq_id: string
          tco_score?: number | null
          updated_at?: string
        }
        Update: {
          award_note?: string | null
          awarded_amount?: number
          awarded_at?: string
          awarded_by?: string | null
          awarded_qty?: number
          awarded_unit_price?: number
          company_id?: string
          created_at?: string
          id?: string
          line_no?: number
          rfq_bid_id?: string
          rfq_id?: string
          tco_score?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rfq_line_awards_awarded_by_fkey"
            columns: ["awarded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rfq_line_awards_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rfq_line_awards_rfq_bid_id_fkey"
            columns: ["rfq_bid_id"]
            isOneToOne: false
            referencedRelation: "rfq_bids"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rfq_line_awards_rfq_id_fkey"
            columns: ["rfq_id"]
            isOneToOne: false
            referencedRelation: "rfqs"
            referencedColumns: ["id"]
          },
        ]
      }
      rfqs: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          currency_code: string
          description: string | null
          due_date: string | null
          id: string
          issue_date: string | null
          lines: Json
          project_id: string
          rfq_number: string
          status: Database["public"]["Enums"]["rfq_status"]
          terms: string | null
          title: string
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          currency_code: string
          description?: string | null
          due_date?: string | null
          id?: string
          issue_date?: string | null
          lines?: Json
          project_id: string
          rfq_number: string
          status?: Database["public"]["Enums"]["rfq_status"]
          terms?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          currency_code?: string
          description?: string | null
          due_date?: string | null
          id?: string
          issue_date?: string | null
          lines?: Json
          project_id?: string
          rfq_number?: string
          status?: Database["public"]["Enums"]["rfq_status"]
          terms?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rfqs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rfqs_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rfqs_currency_code_fkey"
            columns: ["currency_code"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "rfqs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      risks: {
        Row: {
          category: string
          closed_at: string | null
          company_id: string
          contingency_amount: number | null
          created_at: string
          created_by: string | null
          currency_code: string | null
          description: string | null
          id: string
          identified_at: string
          impact: number
          mitigation: string | null
          owner_id: string | null
          probability: number
          project_id: string
          score: number | null
          status: Database["public"]["Enums"]["risk_status"]
          target_close_date: string | null
          title: string
          updated_at: string
        }
        Insert: {
          category?: string
          closed_at?: string | null
          company_id: string
          contingency_amount?: number | null
          created_at?: string
          created_by?: string | null
          currency_code?: string | null
          description?: string | null
          id?: string
          identified_at?: string
          impact: number
          mitigation?: string | null
          owner_id?: string | null
          probability: number
          project_id: string
          score?: number | null
          status?: Database["public"]["Enums"]["risk_status"]
          target_close_date?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          category?: string
          closed_at?: string | null
          company_id?: string
          contingency_amount?: number | null
          created_at?: string
          created_by?: string | null
          currency_code?: string | null
          description?: string | null
          id?: string
          identified_at?: string
          impact?: number
          mitigation?: string | null
          owner_id?: string | null
          probability?: number
          project_id?: string
          score?: number | null
          status?: Database["public"]["Enums"]["risk_status"]
          target_close_date?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "risks_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "risks_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "risks_currency_code_fkey"
            columns: ["currency_code"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "risks_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "risks_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      scada_alarms: {
        Row: {
          acknowledge_note: string | null
          acknowledged_at: string | null
          acknowledged_by: string | null
          assigned_to: string | null
          cleared_at: string | null
          company_id: string
          created_at: string
          escalation_level: number
          id: string
          message: string
          project_id: string
          raised_at: string
          rca_notes: string | null
          rca_status: string
          root_cause: string | null
          rule_id: string | null
          scada_asset_id: string | null
          severity: Database["public"]["Enums"]["alarm_severity"]
          status: Database["public"]["Enums"]["alarm_status"]
          updated_at: string
          value: number | null
        }
        Insert: {
          acknowledge_note?: string | null
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          assigned_to?: string | null
          cleared_at?: string | null
          company_id: string
          created_at?: string
          escalation_level?: number
          id?: string
          message: string
          project_id: string
          raised_at?: string
          rca_notes?: string | null
          rca_status?: string
          root_cause?: string | null
          rule_id?: string | null
          scada_asset_id?: string | null
          severity: Database["public"]["Enums"]["alarm_severity"]
          status?: Database["public"]["Enums"]["alarm_status"]
          updated_at?: string
          value?: number | null
        }
        Update: {
          acknowledge_note?: string | null
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          assigned_to?: string | null
          cleared_at?: string | null
          company_id?: string
          created_at?: string
          escalation_level?: number
          id?: string
          message?: string
          project_id?: string
          raised_at?: string
          rca_notes?: string | null
          rca_status?: string
          root_cause?: string | null
          rule_id?: string | null
          scada_asset_id?: string | null
          severity?: Database["public"]["Enums"]["alarm_severity"]
          status?: Database["public"]["Enums"]["alarm_status"]
          updated_at?: string
          value?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "scada_alarms_acknowledged_by_fkey"
            columns: ["acknowledged_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scada_alarms_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scada_alarms_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scada_alarms_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scada_alarms_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "alarm_rules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scada_alarms_scada_asset_id_fkey"
            columns: ["scada_asset_id"]
            isOneToOne: false
            referencedRelation: "scada_assets"
            referencedColumns: ["id"]
          },
        ]
      }
      scada_assets: {
        Row: {
          asset_key: string
          asset_type: Database["public"]["Enums"]["scada_asset_type"]
          company_id: string
          created_at: string
          created_by: string | null
          equipment_id: string | null
          hierarchy_path: string | null
          id: string
          metadata: Json
          name: string
          parent_asset_id: string | null
          project_id: string
          site_label: string | null
          sort_order: number
          updated_at: string
        }
        Insert: {
          asset_key: string
          asset_type: Database["public"]["Enums"]["scada_asset_type"]
          company_id: string
          created_at?: string
          created_by?: string | null
          equipment_id?: string | null
          hierarchy_path?: string | null
          id?: string
          metadata?: Json
          name: string
          parent_asset_id?: string | null
          project_id: string
          site_label?: string | null
          sort_order?: number
          updated_at?: string
        }
        Update: {
          asset_key?: string
          asset_type?: Database["public"]["Enums"]["scada_asset_type"]
          company_id?: string
          created_at?: string
          created_by?: string | null
          equipment_id?: string | null
          hierarchy_path?: string | null
          id?: string
          metadata?: Json
          name?: string
          parent_asset_id?: string | null
          project_id?: string
          site_label?: string | null
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "scada_assets_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scada_assets_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scada_assets_equipment_id_fkey"
            columns: ["equipment_id"]
            isOneToOne: false
            referencedRelation: "equipment_registry"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scada_assets_parent_asset_id_fkey"
            columns: ["parent_asset_id"]
            isOneToOne: false
            referencedRelation: "scada_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scada_assets_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      scada_connectors: {
        Row: {
          company_id: string
          config: Json
          connector_type: Database["public"]["Enums"]["scada_connector_type"]
          created_at: string
          created_by: string | null
          enabled: boolean
          id: string
          last_error: string | null
          last_seen_at: string | null
          name: string
          project_id: string
          status: Database["public"]["Enums"]["scada_connector_status"]
          updated_at: string
        }
        Insert: {
          company_id: string
          config?: Json
          connector_type: Database["public"]["Enums"]["scada_connector_type"]
          created_at?: string
          created_by?: string | null
          enabled?: boolean
          id?: string
          last_error?: string | null
          last_seen_at?: string | null
          name: string
          project_id: string
          status?: Database["public"]["Enums"]["scada_connector_status"]
          updated_at?: string
        }
        Update: {
          company_id?: string
          config?: Json
          connector_type?: Database["public"]["Enums"]["scada_connector_type"]
          created_at?: string
          created_by?: string | null
          enabled?: boolean
          id?: string
          last_error?: string | null
          last_seen_at?: string | null
          name?: string
          project_id?: string
          status?: Database["public"]["Enums"]["scada_connector_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "scada_connectors_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scada_connectors_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scada_connectors_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      scada_events: {
        Row: {
          actor_id: string | null
          asset_node_id: string | null
          code: string | null
          company_id: string
          created_at: string
          dedupe_key: string | null
          event_type: Database["public"]["Enums"]["scada_event_type"]
          id: string
          message: string
          occurred_at: string
          payload: Json
          project_id: string
          scada_asset_id: string | null
          severity: Database["public"]["Enums"]["alarm_severity"]
          source: string
        }
        Insert: {
          actor_id?: string | null
          asset_node_id?: string | null
          code?: string | null
          company_id: string
          created_at?: string
          dedupe_key?: string | null
          event_type?: Database["public"]["Enums"]["scada_event_type"]
          id?: string
          message: string
          occurred_at?: string
          payload?: Json
          project_id: string
          scada_asset_id?: string | null
          severity?: Database["public"]["Enums"]["alarm_severity"]
          source?: string
        }
        Update: {
          actor_id?: string | null
          asset_node_id?: string | null
          code?: string | null
          company_id?: string
          created_at?: string
          dedupe_key?: string | null
          event_type?: Database["public"]["Enums"]["scada_event_type"]
          id?: string
          message?: string
          occurred_at?: string
          payload?: Json
          project_id?: string
          scada_asset_id?: string | null
          severity?: Database["public"]["Enums"]["alarm_severity"]
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "scada_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scada_events_asset_node_id_fkey"
            columns: ["asset_node_id"]
            isOneToOne: false
            referencedRelation: "asset_nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scada_events_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scada_events_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scada_events_scada_asset_id_fkey"
            columns: ["scada_asset_id"]
            isOneToOne: false
            referencedRelation: "scada_assets"
            referencedColumns: ["id"]
          },
        ]
      }
      scada_kpi_daily: {
        Row: {
          actual_energy_kwh: number | null
          availability_pct: number | null
          company_id: string
          computed_at: string
          created_at: string
          created_by: string | null
          data_quality_pct: number | null
          day: string
          downtime_breakdown: Json
          downtime_minutes: number
          expected_energy_kwh: number | null
          guarantee_check: Json
          id: string
          lost_energy_kwh: number | null
          performance_ratio_pct: number | null
          project_id: string
          updated_at: string
        }
        Insert: {
          actual_energy_kwh?: number | null
          availability_pct?: number | null
          company_id: string
          computed_at?: string
          created_at?: string
          created_by?: string | null
          data_quality_pct?: number | null
          day: string
          downtime_breakdown?: Json
          downtime_minutes?: number
          expected_energy_kwh?: number | null
          guarantee_check?: Json
          id?: string
          lost_energy_kwh?: number | null
          performance_ratio_pct?: number | null
          project_id: string
          updated_at?: string
        }
        Update: {
          actual_energy_kwh?: number | null
          availability_pct?: number | null
          company_id?: string
          computed_at?: string
          created_at?: string
          created_by?: string | null
          data_quality_pct?: number | null
          day?: string
          downtime_breakdown?: Json
          downtime_minutes?: number
          expected_energy_kwh?: number | null
          guarantee_check?: Json
          id?: string
          lost_energy_kwh?: number | null
          performance_ratio_pct?: number | null
          project_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "scada_kpi_daily_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scada_kpi_daily_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scada_kpi_daily_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      scada_tags: {
        Row: {
          alarm_high: number | null
          alarm_low: number | null
          company_id: string
          created_at: string
          created_by: string | null
          data_type: string
          deadband: number
          description: string | null
          frozen_after_samples: number
          id: string
          is_active: boolean
          max_value: number | null
          metric: string | null
          min_value: number | null
          name: string
          project_id: string
          quality_rules: Json
          sample_interval_s: number
          scada_asset_id: string | null
          scale_factor: number
          scale_offset: number
          source_address: string | null
          source_system: string
          stale_after_s: number
          tag_key: string
          unit: string
          updated_at: string
          warn_high: number | null
          warn_low: number | null
        }
        Insert: {
          alarm_high?: number | null
          alarm_low?: number | null
          company_id: string
          created_at?: string
          created_by?: string | null
          data_type?: string
          deadband?: number
          description?: string | null
          frozen_after_samples?: number
          id?: string
          is_active?: boolean
          max_value?: number | null
          metric?: string | null
          min_value?: number | null
          name: string
          project_id: string
          quality_rules?: Json
          sample_interval_s?: number
          scada_asset_id?: string | null
          scale_factor?: number
          scale_offset?: number
          source_address?: string | null
          source_system?: string
          stale_after_s?: number
          tag_key: string
          unit?: string
          updated_at?: string
          warn_high?: number | null
          warn_low?: number | null
        }
        Update: {
          alarm_high?: number | null
          alarm_low?: number | null
          company_id?: string
          created_at?: string
          created_by?: string | null
          data_type?: string
          deadband?: number
          description?: string | null
          frozen_after_samples?: number
          id?: string
          is_active?: boolean
          max_value?: number | null
          metric?: string | null
          min_value?: number | null
          name?: string
          project_id?: string
          quality_rules?: Json
          sample_interval_s?: number
          scada_asset_id?: string | null
          scale_factor?: number
          scale_offset?: number
          source_address?: string | null
          source_system?: string
          stale_after_s?: number
          tag_key?: string
          unit?: string
          updated_at?: string
          warn_high?: number | null
          warn_low?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "scada_tags_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scada_tags_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scada_tags_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scada_tags_scada_asset_id_fkey"
            columns: ["scada_asset_id"]
            isOneToOne: false
            referencedRelation: "scada_assets"
            referencedColumns: ["id"]
          },
        ]
      }
      scada_telemetry: {
        Row: {
          company_id: string
          created_at: string
          metric: string
          project_id: string
          quality: string
          scada_asset_id: string
          ts: string
          value: number
        }
        Insert: {
          company_id: string
          created_at?: string
          metric: string
          project_id: string
          quality?: string
          scada_asset_id: string
          ts: string
          value: number
        }
        Update: {
          company_id?: string
          created_at?: string
          metric?: string
          project_id?: string
          quality?: string
          scada_asset_id?: string
          ts?: string
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "scada_telemetry_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scada_telemetry_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scada_telemetry_scada_asset_id_fkey"
            columns: ["scada_asset_id"]
            isOneToOne: false
            referencedRelation: "scada_assets"
            referencedColumns: ["id"]
          },
        ]
      }
      schedule_tasks: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          cwp_id: string | null
          discipline: string | null
          end_date: string
          id: string
          is_critical: boolean
          is_milestone: boolean
          name: string
          predecessor_ids: string[]
          progress_pct: number
          project_id: string
          sort_order: number
          start_date: string
          status: Database["public"]["Enums"]["schedule_task_status"]
          updated_at: string
          wbs_item_id: string | null
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          cwp_id?: string | null
          discipline?: string | null
          end_date: string
          id?: string
          is_critical?: boolean
          is_milestone?: boolean
          name: string
          predecessor_ids?: string[]
          progress_pct?: number
          project_id: string
          sort_order?: number
          start_date: string
          status?: Database["public"]["Enums"]["schedule_task_status"]
          updated_at?: string
          wbs_item_id?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          cwp_id?: string | null
          discipline?: string | null
          end_date?: string
          id?: string
          is_critical?: boolean
          is_milestone?: boolean
          name?: string
          predecessor_ids?: string[]
          progress_pct?: number
          project_id?: string
          sort_order?: number
          start_date?: string
          status?: Database["public"]["Enums"]["schedule_task_status"]
          updated_at?: string
          wbs_item_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "schedule_tasks_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_tasks_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_tasks_cwp_id_fkey"
            columns: ["cwp_id"]
            isOneToOne: false
            referencedRelation: "construction_work_packages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_tasks_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_tasks_wbs_item_id_fkey"
            columns: ["wbs_item_id"]
            isOneToOne: false
            referencedRelation: "wbs_items"
            referencedColumns: ["id"]
          },
        ]
      }
      scheduled_reports: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          day_of_month: number | null
          day_of_week: number | null
          frequency: string
          hour_utc: number
          id: string
          is_active: boolean
          last_run_at: string | null
          last_run_error: string | null
          last_run_status: string | null
          name: string
          next_run_at: string | null
          project_id: string | null
          recipients: string[]
          report_type: string
          template_sections: Json
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          day_of_month?: number | null
          day_of_week?: number | null
          frequency: string
          hour_utc?: number
          id?: string
          is_active?: boolean
          last_run_at?: string | null
          last_run_error?: string | null
          last_run_status?: string | null
          name: string
          next_run_at?: string | null
          project_id?: string | null
          recipients?: string[]
          report_type?: string
          template_sections?: Json
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          day_of_month?: number | null
          day_of_week?: number | null
          frequency?: string
          hour_utc?: number
          id?: string
          is_active?: boolean
          last_run_at?: string | null
          last_run_error?: string | null
          last_run_status?: string | null
          name?: string
          next_run_at?: string | null
          project_id?: string | null
          recipients?: string[]
          report_type?: string
          template_sections?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "scheduled_reports_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduled_reports_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduled_reports_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      service_tickets: {
        Row: {
          assigned_to: string | null
          category: Database["public"]["Enums"]["ticket_category"]
          company_id: string
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          priority: Database["public"]["Enums"]["work_order_priority"]
          project_id: string
          related_work_order_id: string | null
          reported_by: string | null
          resolved_at: string | null
          status: Database["public"]["Enums"]["ticket_status"]
          ticket_number: string
          title: string
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          category?: Database["public"]["Enums"]["ticket_category"]
          company_id: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          priority?: Database["public"]["Enums"]["work_order_priority"]
          project_id: string
          related_work_order_id?: string | null
          reported_by?: string | null
          resolved_at?: string | null
          status?: Database["public"]["Enums"]["ticket_status"]
          ticket_number: string
          title: string
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          category?: Database["public"]["Enums"]["ticket_category"]
          company_id?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          priority?: Database["public"]["Enums"]["work_order_priority"]
          project_id?: string
          related_work_order_id?: string | null
          reported_by?: string | null
          resolved_at?: string | null
          status?: Database["public"]["Enums"]["ticket_status"]
          ticket_number?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_tickets_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_tickets_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_tickets_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_tickets_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_tickets_related_work_order_id_fkey"
            columns: ["related_work_order_id"]
            isOneToOne: false
            referencedRelation: "work_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_tickets_reported_by_fkey"
            columns: ["reported_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      site_instructions: {
        Row: {
          acknowledged_at: string | null
          company_id: string
          completed_at: string | null
          created_at: string
          created_by: string | null
          cwp_id: string | null
          due_date: string | null
          id: string
          instruction: string
          issued_to: string
          project_id: string
          si_number: string
          status: Database["public"]["Enums"]["si_status"]
          updated_at: string
        }
        Insert: {
          acknowledged_at?: string | null
          company_id: string
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          cwp_id?: string | null
          due_date?: string | null
          id?: string
          instruction: string
          issued_to: string
          project_id: string
          si_number: string
          status?: Database["public"]["Enums"]["si_status"]
          updated_at?: string
        }
        Update: {
          acknowledged_at?: string | null
          company_id?: string
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          cwp_id?: string | null
          due_date?: string | null
          id?: string
          instruction?: string
          issued_to?: string
          project_id?: string
          si_number?: string
          status?: Database["public"]["Enums"]["si_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "site_instructions_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_instructions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_instructions_cwp_id_fkey"
            columns: ["cwp_id"]
            isOneToOne: false
            referencedRelation: "construction_work_packages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_instructions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      site_photos: {
        Row: {
          area: string | null
          caption: string | null
          company_id: string
          created_at: string
          discipline: string | null
          dpr_id: string | null
          file_path: string
          id: string
          latitude: number | null
          longitude: number | null
          media_type: string
          observation_id: string | null
          project_id: string
          taken_at: string
          updated_at: string
          uploaded_by: string | null
        }
        Insert: {
          area?: string | null
          caption?: string | null
          company_id: string
          created_at?: string
          discipline?: string | null
          dpr_id?: string | null
          file_path: string
          id?: string
          latitude?: number | null
          longitude?: number | null
          media_type?: string
          observation_id?: string | null
          project_id: string
          taken_at?: string
          updated_at?: string
          uploaded_by?: string | null
        }
        Update: {
          area?: string | null
          caption?: string | null
          company_id?: string
          created_at?: string
          discipline?: string | null
          dpr_id?: string | null
          file_path?: string
          id?: string
          latitude?: number | null
          longitude?: number | null
          media_type?: string
          observation_id?: string | null
          project_id?: string
          taken_at?: string
          updated_at?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "site_photos_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_photos_dpr_id_fkey"
            columns: ["dpr_id"]
            isOneToOne: false
            referencedRelation: "construction_daily_reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_photos_observation_id_fkey"
            columns: ["observation_id"]
            isOneToOne: false
            referencedRelation: "field_observations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_photos_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_photos_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      sla_records: {
        Row: {
          breach_minutes: number
          company_id: string
          created_at: string
          credit_amount: number | null
          credit_pct: number
          currency_code: string | null
          id: string
          resolution_breached: boolean
          resolution_due_at: string
          resolved_at: string | null
          responded_at: string | null
          response_breached: boolean
          response_due_at: string
          service_ticket_id: string
          updated_at: string
        }
        Insert: {
          breach_minutes?: number
          company_id: string
          created_at?: string
          credit_amount?: number | null
          credit_pct?: number
          currency_code?: string | null
          id?: string
          resolution_breached?: boolean
          resolution_due_at: string
          resolved_at?: string | null
          responded_at?: string | null
          response_breached?: boolean
          response_due_at: string
          service_ticket_id: string
          updated_at?: string
        }
        Update: {
          breach_minutes?: number
          company_id?: string
          created_at?: string
          credit_amount?: number | null
          credit_pct?: number
          currency_code?: string | null
          id?: string
          resolution_breached?: boolean
          resolution_due_at?: string
          resolved_at?: string | null
          responded_at?: string | null
          response_breached?: boolean
          response_due_at?: string
          service_ticket_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sla_records_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sla_records_currency_code_fkey"
            columns: ["currency_code"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "sla_records_service_ticket_id_fkey"
            columns: ["service_ticket_id"]
            isOneToOne: true
            referencedRelation: "service_tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      sld_connections: {
        Row: {
          cable_number: string | null
          company_id: string
          connection_type: string
          created_at: string
          created_by: string | null
          from_object_id: string
          from_port: string
          id: string
          properties: Json
          revision_id: string
          to_object_id: string
          to_port: string
          updated_at: string
        }
        Insert: {
          cable_number?: string | null
          company_id: string
          connection_type?: string
          created_at?: string
          created_by?: string | null
          from_object_id: string
          from_port?: string
          id?: string
          properties?: Json
          revision_id: string
          to_object_id: string
          to_port?: string
          updated_at?: string
        }
        Update: {
          cable_number?: string | null
          company_id?: string
          connection_type?: string
          created_at?: string
          created_by?: string | null
          from_object_id?: string
          from_port?: string
          id?: string
          properties?: Json
          revision_id?: string
          to_object_id?: string
          to_port?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sld_connections_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sld_connections_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sld_connections_from_object_id_fkey"
            columns: ["from_object_id"]
            isOneToOne: false
            referencedRelation: "sld_objects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sld_connections_revision_id_fkey"
            columns: ["revision_id"]
            isOneToOne: false
            referencedRelation: "sld_revisions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sld_connections_to_object_id_fkey"
            columns: ["to_object_id"]
            isOneToOne: false
            referencedRelation: "sld_objects"
            referencedColumns: ["id"]
          },
        ]
      }
      sld_drawings: {
        Row: {
          border_template: string
          company_id: string
          created_at: string
          created_by: string | null
          current_revision_id: string | null
          drawing_number: string
          drawing_register_id: string | null
          id: string
          locked: boolean
          project_id: string
          sheet_size: string
          status: Database["public"]["Enums"]["sld_status"]
          title: string
          updated_at: string
        }
        Insert: {
          border_template?: string
          company_id: string
          created_at?: string
          created_by?: string | null
          current_revision_id?: string | null
          drawing_number: string
          drawing_register_id?: string | null
          id?: string
          locked?: boolean
          project_id: string
          sheet_size?: string
          status?: Database["public"]["Enums"]["sld_status"]
          title: string
          updated_at?: string
        }
        Update: {
          border_template?: string
          company_id?: string
          created_at?: string
          created_by?: string | null
          current_revision_id?: string | null
          drawing_number?: string
          drawing_register_id?: string | null
          id?: string
          locked?: boolean
          project_id?: string
          sheet_size?: string
          status?: Database["public"]["Enums"]["sld_status"]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_sld_current_revision"
            columns: ["current_revision_id"]
            isOneToOne: false
            referencedRelation: "sld_revisions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sld_drawings_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sld_drawings_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sld_drawings_drawing_register_id_fkey"
            columns: ["drawing_register_id"]
            isOneToOne: false
            referencedRelation: "drawing_register"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sld_drawings_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      sld_export_artifacts: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          file_name: string
          file_size_bytes: number | null
          format: string
          id: string
          revision_id: string
          storage_path: string
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          file_name: string
          file_size_bytes?: number | null
          format: string
          id?: string
          revision_id: string
          storage_path: string
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          file_name?: string
          file_size_bytes?: number | null
          format?: string
          id?: string
          revision_id?: string
          storage_path?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sld_export_artifacts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sld_export_artifacts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sld_export_artifacts_revision_id_fkey"
            columns: ["revision_id"]
            isOneToOne: false
            referencedRelation: "sld_revisions"
            referencedColumns: ["id"]
          },
        ]
      }
      sld_objects: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          group_id: string | null
          id: string
          label: string | null
          layer_id: string
          mirrored: boolean
          properties: Json
          revision_id: string
          rotation: number
          symbol_type: string
          tag: string | null
          updated_at: string
          x: number
          y: number
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          group_id?: string | null
          id?: string
          label?: string | null
          layer_id?: string
          mirrored?: boolean
          properties?: Json
          revision_id: string
          rotation?: number
          symbol_type: string
          tag?: string | null
          updated_at?: string
          x?: number
          y?: number
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          group_id?: string | null
          id?: string
          label?: string | null
          layer_id?: string
          mirrored?: boolean
          properties?: Json
          revision_id?: string
          rotation?: number
          symbol_type?: string
          tag?: string | null
          updated_at?: string
          x?: number
          y?: number
        }
        Relationships: [
          {
            foreignKeyName: "sld_objects_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sld_objects_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sld_objects_revision_id_fkey"
            columns: ["revision_id"]
            isOneToOne: false
            referencedRelation: "sld_revisions"
            referencedColumns: ["id"]
          },
        ]
      }
      sld_revisions: {
        Row: {
          canvas: Json
          company_id: string
          created_at: string
          created_by: string | null
          drawing_id: string
          graph_hash: string | null
          id: string
          issue_reason: string | null
          issued_at: string | null
          issued_by: string | null
          revision_code: string
          status: Database["public"]["Enums"]["sld_status"]
          updated_at: string
        }
        Insert: {
          canvas?: Json
          company_id: string
          created_at?: string
          created_by?: string | null
          drawing_id: string
          graph_hash?: string | null
          id?: string
          issue_reason?: string | null
          issued_at?: string | null
          issued_by?: string | null
          revision_code: string
          status?: Database["public"]["Enums"]["sld_status"]
          updated_at?: string
        }
        Update: {
          canvas?: Json
          company_id?: string
          created_at?: string
          created_by?: string | null
          drawing_id?: string
          graph_hash?: string | null
          id?: string
          issue_reason?: string | null
          issued_at?: string | null
          issued_by?: string | null
          revision_code?: string
          status?: Database["public"]["Enums"]["sld_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sld_revisions_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sld_revisions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sld_revisions_drawing_id_fkey"
            columns: ["drawing_id"]
            isOneToOne: false
            referencedRelation: "sld_drawings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sld_revisions_issued_by_fkey"
            columns: ["issued_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      sld_schedules: {
        Row: {
          company_id: string
          created_at: string
          generated_at: string
          generated_by: string | null
          id: string
          revision_id: string
          row_count: number
          rows: Json
          schedule_type: string
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          generated_at?: string
          generated_by?: string | null
          id?: string
          revision_id: string
          row_count?: number
          rows?: Json
          schedule_type: string
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          generated_at?: string
          generated_by?: string | null
          id?: string
          revision_id?: string
          row_count?: number
          rows?: Json
          schedule_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sld_schedules_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sld_schedules_generated_by_fkey"
            columns: ["generated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sld_schedules_revision_id_fkey"
            columns: ["revision_id"]
            isOneToOne: false
            referencedRelation: "sld_revisions"
            referencedColumns: ["id"]
          },
        ]
      }
      sld_symbol_types: {
        Row: {
          category: string
          company_id: string | null
          created_at: string
          default_properties: Json
          display_name: string
          id: string
          ports: Json
          property_schema: Json
          sort_order: number
          svg_body: string
          tag_prefix: string
          type_key: string
          updated_at: string
        }
        Insert: {
          category: string
          company_id?: string | null
          created_at?: string
          default_properties?: Json
          display_name: string
          id?: string
          ports?: Json
          property_schema?: Json
          sort_order?: number
          svg_body: string
          tag_prefix: string
          type_key: string
          updated_at?: string
        }
        Update: {
          category?: string
          company_id?: string | null
          created_at?: string
          default_properties?: Json
          display_name?: string
          id?: string
          ports?: Json
          property_schema?: Json
          sort_order?: number
          svg_body?: string
          tag_prefix?: string
          type_key?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sld_symbol_types_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      spare_parts: {
        Row: {
          category: Database["public"]["Enums"]["material_category"]
          company_id: string
          compatible_equipment: string | null
          created_at: string
          created_by: string | null
          currency_code: string | null
          description: string | null
          id: string
          lead_time_days: number | null
          location: string | null
          name: string
          part_number: string
          preferred_vendor_id: string | null
          qty_on_hand: number
          reorder_point: number
          safety_stock: number
          unit_cost: number | null
          uom: string
          updated_at: string
        }
        Insert: {
          category?: Database["public"]["Enums"]["material_category"]
          company_id: string
          compatible_equipment?: string | null
          created_at?: string
          created_by?: string | null
          currency_code?: string | null
          description?: string | null
          id?: string
          lead_time_days?: number | null
          location?: string | null
          name: string
          part_number: string
          preferred_vendor_id?: string | null
          qty_on_hand?: number
          reorder_point?: number
          safety_stock?: number
          unit_cost?: number | null
          uom?: string
          updated_at?: string
        }
        Update: {
          category?: Database["public"]["Enums"]["material_category"]
          company_id?: string
          compatible_equipment?: string | null
          created_at?: string
          created_by?: string | null
          currency_code?: string | null
          description?: string | null
          id?: string
          lead_time_days?: number | null
          location?: string | null
          name?: string
          part_number?: string
          preferred_vendor_id?: string | null
          qty_on_hand?: number
          reorder_point?: number
          safety_stock?: number
          unit_cost?: number | null
          uom?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "spare_parts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "spare_parts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "spare_parts_currency_code_fkey"
            columns: ["currency_code"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "spare_parts_preferred_vendor_id_fkey"
            columns: ["preferred_vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      submittals: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          due_date: string | null
          file_path: string | null
          id: string
          project_id: string
          review_notes: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          revision: string
          spec_section: string | null
          status: Database["public"]["Enums"]["submittal_status"]
          submittal_number: string
          submitted_at: string | null
          title: string
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          due_date?: string | null
          file_path?: string | null
          id?: string
          project_id: string
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          revision?: string
          spec_section?: string | null
          status?: Database["public"]["Enums"]["submittal_status"]
          submittal_number: string
          submitted_at?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          due_date?: string | null
          file_path?: string | null
          id?: string
          project_id?: string
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          revision?: string
          spec_section?: string | null
          status?: Database["public"]["Enums"]["submittal_status"]
          submittal_number?: string
          submitted_at?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "submittals_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "submittals_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "submittals_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "submittals_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      tag_dictionary: {
        Row: {
          alarm_deadband: number
          alarm_hi: number | null
          alarm_hi_hi: number | null
          alarm_lo: number | null
          alarm_lo_lo: number | null
          asset_node_id: string | null
          company_id: string
          created_at: string
          created_by: string | null
          description: string | null
          downsample_interval: string
          enabled: boolean
          id: string
          metric: string
          project_id: string
          quality_flags: Json
          raw_retention_days: number
          scaling_factor: number
          scaling_offset: number
          tag: string
          unit: string
          updated_at: string
        }
        Insert: {
          alarm_deadband?: number
          alarm_hi?: number | null
          alarm_hi_hi?: number | null
          alarm_lo?: number | null
          alarm_lo_lo?: number | null
          asset_node_id?: string | null
          company_id: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          downsample_interval?: string
          enabled?: boolean
          id?: string
          metric: string
          project_id: string
          quality_flags?: Json
          raw_retention_days?: number
          scaling_factor?: number
          scaling_offset?: number
          tag: string
          unit: string
          updated_at?: string
        }
        Update: {
          alarm_deadband?: number
          alarm_hi?: number | null
          alarm_hi_hi?: number | null
          alarm_lo?: number | null
          alarm_lo_lo?: number | null
          asset_node_id?: string | null
          company_id?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          downsample_interval?: string
          enabled?: boolean
          id?: string
          metric?: string
          project_id?: string
          quality_flags?: Json
          raw_retention_days?: number
          scaling_factor?: number
          scaling_offset?: number
          tag?: string
          unit?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tag_dictionary_asset_node_id_fkey"
            columns: ["asset_node_id"]
            isOneToOne: false
            referencedRelation: "asset_nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tag_dictionary_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tag_dictionary_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tag_dictionary_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      tag_mappings: {
        Row: {
          byte_order: string
          company_id: string
          connector_id: string | null
          created_at: string
          created_by: string | null
          data_type: string
          enabled: boolean
          id: string
          poll_interval_s: number
          project_id: string
          protocol: Database["public"]["Enums"]["tag_mapping_protocol"]
          scaling_factor: number
          scaling_offset: number
          source_address: string
          source_details: Json
          tag_dictionary_id: string
          updated_at: string
        }
        Insert: {
          byte_order?: string
          company_id: string
          connector_id?: string | null
          created_at?: string
          created_by?: string | null
          data_type?: string
          enabled?: boolean
          id?: string
          poll_interval_s?: number
          project_id: string
          protocol: Database["public"]["Enums"]["tag_mapping_protocol"]
          scaling_factor?: number
          scaling_offset?: number
          source_address: string
          source_details?: Json
          tag_dictionary_id: string
          updated_at?: string
        }
        Update: {
          byte_order?: string
          company_id?: string
          connector_id?: string | null
          created_at?: string
          created_by?: string | null
          data_type?: string
          enabled?: boolean
          id?: string
          poll_interval_s?: number
          project_id?: string
          protocol?: Database["public"]["Enums"]["tag_mapping_protocol"]
          scaling_factor?: number
          scaling_offset?: number
          source_address?: string
          source_details?: Json
          tag_dictionary_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tag_mappings_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tag_mappings_connector_id_fkey"
            columns: ["connector_id"]
            isOneToOne: false
            referencedRelation: "scada_connectors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tag_mappings_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tag_mappings_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tag_mappings_tag_dictionary_id_fkey"
            columns: ["tag_dictionary_id"]
            isOneToOne: false
            referencedRelation: "tag_dictionary"
            referencedColumns: ["id"]
          },
        ]
      }
      technical_queries: {
        Row: {
          answered_at: string | null
          answered_by: string | null
          company_id: string
          created_at: string
          created_by: string | null
          due_date: string | null
          id: string
          priority: string
          project_id: string
          question: string
          raised_by: string | null
          response: string | null
          rfi_id: string | null
          status: Database["public"]["Enums"]["tq_status"]
          subject: string
          tq_number: string
          updated_at: string
        }
        Insert: {
          answered_at?: string | null
          answered_by?: string | null
          company_id: string
          created_at?: string
          created_by?: string | null
          due_date?: string | null
          id?: string
          priority?: string
          project_id: string
          question: string
          raised_by?: string | null
          response?: string | null
          rfi_id?: string | null
          status?: Database["public"]["Enums"]["tq_status"]
          subject: string
          tq_number: string
          updated_at?: string
        }
        Update: {
          answered_at?: string | null
          answered_by?: string | null
          company_id?: string
          created_at?: string
          created_by?: string | null
          due_date?: string | null
          id?: string
          priority?: string
          project_id?: string
          question?: string
          raised_by?: string | null
          response?: string | null
          rfi_id?: string | null
          status?: Database["public"]["Enums"]["tq_status"]
          subject?: string
          tq_number?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "technical_queries_answered_by_fkey"
            columns: ["answered_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "technical_queries_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "technical_queries_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "technical_queries_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "technical_queries_raised_by_fkey"
            columns: ["raised_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "technical_queries_rfi_id_fkey"
            columns: ["rfi_id"]
            isOneToOne: false
            referencedRelation: "rfis"
            referencedColumns: ["id"]
          },
        ]
      }
      tender_events: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          event_at: string
          event_type: Database["public"]["Enums"]["tender_event_type"]
          id: string
          location: string | null
          notes: string | null
          opportunity_id: string
          reminder_sent_at: string | null
          title: string
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          event_at: string
          event_type: Database["public"]["Enums"]["tender_event_type"]
          id?: string
          location?: string | null
          notes?: string | null
          opportunity_id: string
          reminder_sent_at?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          event_at?: string
          event_type?: Database["public"]["Enums"]["tender_event_type"]
          id?: string
          location?: string | null
          notes?: string | null
          opportunity_id?: string
          reminder_sent_at?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tender_events_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tender_events_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tender_events_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
        ]
      }
      terrain_points: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          easting: number
          elevation_m: number
          grid_col: number | null
          grid_row: number | null
          id: string
          northing: number
          point_kind: string
          surface_id: string
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          easting: number
          elevation_m: number
          grid_col?: number | null
          grid_row?: number | null
          id?: string
          northing: number
          point_kind?: string
          surface_id: string
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          easting?: number
          elevation_m?: number
          grid_col?: number | null
          grid_row?: number | null
          id?: string
          northing?: number
          point_kind?: string
          surface_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "terrain_points_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "terrain_points_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "terrain_points_surface_id_fkey"
            columns: ["surface_id"]
            isOneToOne: false
            referencedRelation: "terrain_surfaces"
            referencedColumns: ["id"]
          },
        ]
      }
      terrain_surfaces: {
        Row: {
          analysis: Json
          company_id: string
          created_at: string
          created_by: string | null
          crs: string
          grid_cols: number | null
          grid_rows: number | null
          grid_spacing_m: number
          id: string
          max_elevation_m: number | null
          min_elevation_m: number | null
          name: string
          origin_easting: number | null
          origin_northing: number | null
          project_id: string
          revision_code: string
          source_document_id: string | null
          source_notes: string | null
          source_type: string
          status: string
          updated_at: string
        }
        Insert: {
          analysis?: Json
          company_id: string
          created_at?: string
          created_by?: string | null
          crs?: string
          grid_cols?: number | null
          grid_rows?: number | null
          grid_spacing_m?: number
          id?: string
          max_elevation_m?: number | null
          min_elevation_m?: number | null
          name: string
          origin_easting?: number | null
          origin_northing?: number | null
          project_id: string
          revision_code?: string
          source_document_id?: string | null
          source_notes?: string | null
          source_type?: string
          status?: string
          updated_at?: string
        }
        Update: {
          analysis?: Json
          company_id?: string
          created_at?: string
          created_by?: string | null
          crs?: string
          grid_cols?: number | null
          grid_rows?: number | null
          grid_spacing_m?: number
          id?: string
          max_elevation_m?: number | null
          min_elevation_m?: number | null
          name?: string
          origin_easting?: number | null
          origin_northing?: number | null
          project_id?: string
          revision_code?: string
          source_document_id?: string | null
          source_notes?: string | null
          source_type?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "terrain_surfaces_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "terrain_surfaces_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "terrain_surfaces_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "terrain_surfaces_source_document_id_fkey"
            columns: ["source_document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      three_way_matches: {
        Row: {
          amount_variance: number | null
          company_id: string
          created_at: string
          created_by: string | null
          goods_receipt_id: string | null
          id: string
          invoice_amount: number
          invoice_currency_code: string
          invoice_date: string | null
          invoice_file_path: string | null
          invoice_id: string | null
          matched_at: string | null
          matched_by: string | null
          payment_release_blocked: boolean
          po_id: string
          price_variance_pct: number | null
          qty_variance_pct: number | null
          resolution_note: string | null
          status: Database["public"]["Enums"]["match_status"]
          updated_at: string
          variance_threshold_pct: number
          vendor_invoice_number: string
        }
        Insert: {
          amount_variance?: number | null
          company_id: string
          created_at?: string
          created_by?: string | null
          goods_receipt_id?: string | null
          id?: string
          invoice_amount: number
          invoice_currency_code: string
          invoice_date?: string | null
          invoice_file_path?: string | null
          invoice_id?: string | null
          matched_at?: string | null
          matched_by?: string | null
          payment_release_blocked?: boolean
          po_id: string
          price_variance_pct?: number | null
          qty_variance_pct?: number | null
          resolution_note?: string | null
          status?: Database["public"]["Enums"]["match_status"]
          updated_at?: string
          variance_threshold_pct?: number
          vendor_invoice_number: string
        }
        Update: {
          amount_variance?: number | null
          company_id?: string
          created_at?: string
          created_by?: string | null
          goods_receipt_id?: string | null
          id?: string
          invoice_amount?: number
          invoice_currency_code?: string
          invoice_date?: string | null
          invoice_file_path?: string | null
          invoice_id?: string | null
          matched_at?: string | null
          matched_by?: string | null
          payment_release_blocked?: boolean
          po_id?: string
          price_variance_pct?: number | null
          qty_variance_pct?: number | null
          resolution_note?: string | null
          status?: Database["public"]["Enums"]["match_status"]
          updated_at?: string
          variance_threshold_pct?: number
          vendor_invoice_number?: string
        }
        Relationships: [
          {
            foreignKeyName: "three_way_matches_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "three_way_matches_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "three_way_matches_goods_receipt_id_fkey"
            columns: ["goods_receipt_id"]
            isOneToOne: false
            referencedRelation: "goods_receipts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "three_way_matches_invoice_currency_code_fkey"
            columns: ["invoice_currency_code"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "three_way_matches_invoice_fk"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "three_way_matches_matched_by_fkey"
            columns: ["matched_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "three_way_matches_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      toolbox_talk_attendance: {
        Row: {
          attended: boolean
          company_id: string
          created_at: string
          employer: string | null
          id: string
          signature_path: string | null
          talk_id: string
          trade: string | null
          updated_at: string
          worker_name: string
        }
        Insert: {
          attended?: boolean
          company_id: string
          created_at?: string
          employer?: string | null
          id?: string
          signature_path?: string | null
          talk_id: string
          trade?: string | null
          updated_at?: string
          worker_name: string
        }
        Update: {
          attended?: boolean
          company_id?: string
          created_at?: string
          employer?: string | null
          id?: string
          signature_path?: string | null
          talk_id?: string
          trade?: string | null
          updated_at?: string
          worker_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "toolbox_talk_attendance_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "toolbox_talk_attendance_talk_id_fkey"
            columns: ["talk_id"]
            isOneToOne: false
            referencedRelation: "toolbox_talks"
            referencedColumns: ["id"]
          },
        ]
      }
      toolbox_talks: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          id: string
          location: string | null
          notes: string | null
          presenter: string | null
          project_id: string
          status: Database["public"]["Enums"]["tbt_status"]
          talk_date: string
          tbt_number: string
          topic: string
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          location?: string | null
          notes?: string | null
          presenter?: string | null
          project_id: string
          status?: Database["public"]["Enums"]["tbt_status"]
          talk_date: string
          tbt_number: string
          topic: string
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          location?: string | null
          notes?: string | null
          presenter?: string | null
          project_id?: string
          status?: Database["public"]["Enums"]["tbt_status"]
          talk_date?: string
          tbt_number?: string
          topic?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "toolbox_talks_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "toolbox_talks_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "toolbox_talks_presenter_fkey"
            columns: ["presenter"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "toolbox_talks_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      transmittals: {
        Row: {
          acknowledged_at: string | null
          company_id: string
          created_at: string
          created_by: string | null
          direction: Database["public"]["Enums"]["transmittal_direction"]
          from_party: string
          id: string
          items: Json
          project_id: string
          response_due: string | null
          sent_at: string | null
          subject: string
          to_party: string
          transmittal_number: string
          updated_at: string
        }
        Insert: {
          acknowledged_at?: string | null
          company_id: string
          created_at?: string
          created_by?: string | null
          direction?: Database["public"]["Enums"]["transmittal_direction"]
          from_party: string
          id?: string
          items?: Json
          project_id: string
          response_due?: string | null
          sent_at?: string | null
          subject: string
          to_party: string
          transmittal_number: string
          updated_at?: string
        }
        Update: {
          acknowledged_at?: string | null
          company_id?: string
          created_at?: string
          created_by?: string | null
          direction?: Database["public"]["Enums"]["transmittal_direction"]
          from_party?: string
          id?: string
          items?: Json
          project_id?: string
          response_due?: string | null
          sent_at?: string | null
          subject?: string
          to_party?: string
          transmittal_number?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "transmittals_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transmittals_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transmittals_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      turnover_packages: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          company_id: string
          compiled_at: string | null
          compiled_by: string | null
          created_at: string
          created_by: string | null
          delivered_at: string | null
          id: string
          index_pdf_path: string | null
          project_id: string
          sections: Json
          status: string
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          company_id: string
          compiled_at?: string | null
          compiled_by?: string | null
          created_at?: string
          created_by?: string | null
          delivered_at?: string | null
          id?: string
          index_pdf_path?: string | null
          project_id: string
          sections?: Json
          status?: string
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          company_id?: string
          compiled_at?: string | null
          compiled_by?: string | null
          created_at?: string
          created_by?: string | null
          delivered_at?: string | null
          id?: string
          index_pdf_path?: string | null
          project_id?: string
          sections?: Json
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "turnover_packages_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "turnover_packages_compiled_by_fkey"
            columns: ["compiled_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "turnover_packages_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "turnover_packages_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: true
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
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
      vendor_scorecards: {
        Row: {
          company_id: string
          computed_at: string | null
          created_at: string
          defects_count: number | null
          id: string
          on_time_delivery_pct: number | null
          period_end: string
          period_start: string
          project_id: string | null
          quality_score: number | null
          responsiveness_score: number | null
          total_pos: number | null
          total_receipts: number | null
          updated_at: string
          vendor_id: string
        }
        Insert: {
          company_id: string
          computed_at?: string | null
          created_at?: string
          defects_count?: number | null
          id?: string
          on_time_delivery_pct?: number | null
          period_end: string
          period_start: string
          project_id?: string | null
          quality_score?: number | null
          responsiveness_score?: number | null
          total_pos?: number | null
          total_receipts?: number | null
          updated_at?: string
          vendor_id: string
        }
        Update: {
          company_id?: string
          computed_at?: string | null
          created_at?: string
          defects_count?: number | null
          id?: string
          on_time_delivery_pct?: number | null
          period_end?: string
          period_start?: string
          project_id?: string | null
          quality_score?: number | null
          responsiveness_score?: number | null
          total_pos?: number | null
          total_receipts?: number | null
          updated_at?: string
          vendor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vendor_scorecards_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_scorecards_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_scorecards_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      vendors: {
        Row: {
          address_line: string | null
          categories: string[]
          certifications: Json
          city: string | null
          company_id: string
          country: string | null
          created_at: string
          created_by: string | null
          currency_code: string | null
          email: string | null
          id: string
          incoterms: string | null
          legal_name: string | null
          name: string
          notes: string | null
          onboarded_at: string | null
          payment_terms: string | null
          phone: string | null
          status: Database["public"]["Enums"]["vendor_status"]
          tax_id: string | null
          updated_at: string
          website: string | null
        }
        Insert: {
          address_line?: string | null
          categories?: string[]
          certifications?: Json
          city?: string | null
          company_id: string
          country?: string | null
          created_at?: string
          created_by?: string | null
          currency_code?: string | null
          email?: string | null
          id?: string
          incoterms?: string | null
          legal_name?: string | null
          name: string
          notes?: string | null
          onboarded_at?: string | null
          payment_terms?: string | null
          phone?: string | null
          status?: Database["public"]["Enums"]["vendor_status"]
          tax_id?: string | null
          updated_at?: string
          website?: string | null
        }
        Update: {
          address_line?: string | null
          categories?: string[]
          certifications?: Json
          city?: string | null
          company_id?: string
          country?: string | null
          created_at?: string
          created_by?: string | null
          currency_code?: string | null
          email?: string | null
          id?: string
          incoterms?: string | null
          legal_name?: string | null
          name?: string
          notes?: string | null
          onboarded_at?: string | null
          payment_terms?: string | null
          phone?: string | null
          status?: Database["public"]["Enums"]["vendor_status"]
          tax_id?: string | null
          updated_at?: string
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vendors_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendors_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendors_currency_code_fkey"
            columns: ["currency_code"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
        ]
      }
      warranty_claims: {
        Row: {
          attachments: Json
          claim_number: string
          claimed_amount: number | null
          company_id: string
          created_at: string
          created_by: string | null
          currency_code: string | null
          description: string | null
          id: string
          resolved_at: string | null
          settled_amount: number | null
          status: Database["public"]["Enums"]["warranty_claim_status"]
          submitted_at: string | null
          title: string
          updated_at: string
          warranty_id: string
        }
        Insert: {
          attachments?: Json
          claim_number: string
          claimed_amount?: number | null
          company_id: string
          created_at?: string
          created_by?: string | null
          currency_code?: string | null
          description?: string | null
          id?: string
          resolved_at?: string | null
          settled_amount?: number | null
          status?: Database["public"]["Enums"]["warranty_claim_status"]
          submitted_at?: string | null
          title: string
          updated_at?: string
          warranty_id: string
        }
        Update: {
          attachments?: Json
          claim_number?: string
          claimed_amount?: number | null
          company_id?: string
          created_at?: string
          created_by?: string | null
          currency_code?: string | null
          description?: string | null
          id?: string
          resolved_at?: string | null
          settled_amount?: number | null
          status?: Database["public"]["Enums"]["warranty_claim_status"]
          submitted_at?: string | null
          title?: string
          updated_at?: string
          warranty_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "warranty_claims_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "warranty_claims_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "warranty_claims_currency_code_fkey"
            columns: ["currency_code"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "warranty_claims_warranty_id_fkey"
            columns: ["warranty_id"]
            isOneToOne: false
            referencedRelation: "warranty_contracts"
            referencedColumns: ["id"]
          },
        ]
      }
      warranty_contracts: {
        Row: {
          company_id: string
          coverage_notes: string | null
          created_at: string
          created_by: string | null
          document_path: string | null
          end_date: string
          equipment_id: string | null
          id: string
          project_id: string
          start_date: string
          terms: string | null
          updated_at: string
          vendor_id: string | null
          warranty_type: Database["public"]["Enums"]["warranty_type"]
        }
        Insert: {
          company_id: string
          coverage_notes?: string | null
          created_at?: string
          created_by?: string | null
          document_path?: string | null
          end_date: string
          equipment_id?: string | null
          id?: string
          project_id: string
          start_date: string
          terms?: string | null
          updated_at?: string
          vendor_id?: string | null
          warranty_type?: Database["public"]["Enums"]["warranty_type"]
        }
        Update: {
          company_id?: string
          coverage_notes?: string | null
          created_at?: string
          created_by?: string | null
          document_path?: string | null
          end_date?: string
          equipment_id?: string | null
          id?: string
          project_id?: string
          start_date?: string
          terms?: string | null
          updated_at?: string
          vendor_id?: string | null
          warranty_type?: Database["public"]["Enums"]["warranty_type"]
        }
        Relationships: [
          {
            foreignKeyName: "warranty_contracts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "warranty_contracts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "warranty_contracts_equipment_id_fkey"
            columns: ["equipment_id"]
            isOneToOne: false
            referencedRelation: "equipment_registry"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "warranty_contracts_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "warranty_contracts_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      wbs_items: {
        Row: {
          area: string | null
          budgeted_amount: number | null
          code: string
          company_id: string
          created_at: string
          created_by: string | null
          currency_code: string | null
          description: string | null
          discipline: string | null
          id: string
          ifc_package_ref: string | null
          item_type: Database["public"]["Enums"]["wbs_item_type"]
          name: string
          parent_id: string | null
          planned_quantity: number | null
          project_id: string
          sort_order: number
          uom: string | null
          updated_at: string
        }
        Insert: {
          area?: string | null
          budgeted_amount?: number | null
          code: string
          company_id: string
          created_at?: string
          created_by?: string | null
          currency_code?: string | null
          description?: string | null
          discipline?: string | null
          id?: string
          ifc_package_ref?: string | null
          item_type?: Database["public"]["Enums"]["wbs_item_type"]
          name: string
          parent_id?: string | null
          planned_quantity?: number | null
          project_id: string
          sort_order?: number
          uom?: string | null
          updated_at?: string
        }
        Update: {
          area?: string | null
          budgeted_amount?: number | null
          code?: string
          company_id?: string
          created_at?: string
          created_by?: string | null
          currency_code?: string | null
          description?: string | null
          discipline?: string | null
          id?: string
          ifc_package_ref?: string | null
          item_type?: Database["public"]["Enums"]["wbs_item_type"]
          name?: string
          parent_id?: string | null
          planned_quantity?: number | null
          project_id?: string
          sort_order?: number
          uom?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "wbs_items_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wbs_items_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wbs_items_currency_code_fkey"
            columns: ["currency_code"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "wbs_items_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "wbs_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wbs_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      weather_delays: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          delay_date: string
          delay_type: Database["public"]["Enums"]["weather_delay_type"]
          dpr_id: string | null
          end_time: string | null
          id: string
          impact_notes: string | null
          lost_hours: number
          project_id: string
          start_time: string | null
          updated_at: string
          wbs_item_id: string | null
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          delay_date: string
          delay_type: Database["public"]["Enums"]["weather_delay_type"]
          dpr_id?: string | null
          end_time?: string | null
          id?: string
          impact_notes?: string | null
          lost_hours?: number
          project_id: string
          start_time?: string | null
          updated_at?: string
          wbs_item_id?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          delay_date?: string
          delay_type?: Database["public"]["Enums"]["weather_delay_type"]
          dpr_id?: string | null
          end_time?: string | null
          id?: string
          impact_notes?: string | null
          lost_hours?: number
          project_id?: string
          start_time?: string | null
          updated_at?: string
          wbs_item_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "weather_delays_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "weather_delays_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "weather_delays_dpr_id_fkey"
            columns: ["dpr_id"]
            isOneToOne: false
            referencedRelation: "construction_daily_reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "weather_delays_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "weather_delays_wbs_item_id_fkey"
            columns: ["wbs_item_id"]
            isOneToOne: false
            referencedRelation: "wbs_items"
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
      webhook_endpoint_secrets: {
        Row: {
          company_id: string
          created_at: string
          endpoint_id: string
          secret: string
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          endpoint_id: string
          secret: string
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          endpoint_id?: string
          secret?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "webhook_endpoint_secrets_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "webhook_endpoint_secrets_endpoint_id_fkey"
            columns: ["endpoint_id"]
            isOneToOne: true
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
      webhook_export_allowlist: {
        Row: {
          company_id: string
          created_at: string
          id: string
          is_enabled: boolean
          table_name: string
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          id?: string
          is_enabled?: boolean
          table_name: string
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          id?: string
          is_enabled?: boolean
          table_name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "webhook_export_allowlist_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      work_fronts: {
        Row: {
          area: string | null
          company_id: string
          created_at: string
          created_by: string | null
          discipline: string
          id: string
          is_active: boolean
          name: string
          project_id: string
          updated_at: string
        }
        Insert: {
          area?: string | null
          company_id: string
          created_at?: string
          created_by?: string | null
          discipline?: string
          id?: string
          is_active?: boolean
          name: string
          project_id: string
          updated_at?: string
        }
        Update: {
          area?: string | null
          company_id?: string
          created_at?: string
          created_by?: string | null
          discipline?: string
          id?: string
          is_active?: boolean
          name?: string
          project_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_fronts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_fronts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_fronts_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      work_orders: {
        Row: {
          assigned_to: string | null
          closed_at: string | null
          company_id: string
          completed_at: string | null
          created_at: string
          created_by: string | null
          currency_code: string | null
          description: string | null
          due_date: string | null
          equipment_id: string | null
          failure_cause: string | null
          id: string
          labor: Json
          parts: Json
          priority: Database["public"]["Enums"]["work_order_priority"]
          project_id: string
          resolution_notes: string | null
          scheduled_date: string | null
          source: string
          status: Database["public"]["Enums"]["work_order_status"]
          title: string
          total_cost: number
          type: Database["public"]["Enums"]["work_order_type"]
          updated_at: string
          wo_number: string
        }
        Insert: {
          assigned_to?: string | null
          closed_at?: string | null
          company_id: string
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          currency_code?: string | null
          description?: string | null
          due_date?: string | null
          equipment_id?: string | null
          failure_cause?: string | null
          id?: string
          labor?: Json
          parts?: Json
          priority?: Database["public"]["Enums"]["work_order_priority"]
          project_id: string
          resolution_notes?: string | null
          scheduled_date?: string | null
          source?: string
          status?: Database["public"]["Enums"]["work_order_status"]
          title: string
          total_cost?: number
          type?: Database["public"]["Enums"]["work_order_type"]
          updated_at?: string
          wo_number: string
        }
        Update: {
          assigned_to?: string | null
          closed_at?: string | null
          company_id?: string
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          currency_code?: string | null
          description?: string | null
          due_date?: string | null
          equipment_id?: string | null
          failure_cause?: string | null
          id?: string
          labor?: Json
          parts?: Json
          priority?: Database["public"]["Enums"]["work_order_priority"]
          project_id?: string
          resolution_notes?: string | null
          scheduled_date?: string | null
          source?: string
          status?: Database["public"]["Enums"]["work_order_status"]
          title?: string
          total_cost?: number
          type?: Database["public"]["Enums"]["work_order_type"]
          updated_at?: string
          wo_number?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_orders_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_orders_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_orders_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_orders_currency_code_fkey"
            columns: ["currency_code"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "work_orders_equipment_id_fkey"
            columns: ["equipment_id"]
            isOneToOne: false
            referencedRelation: "equipment_registry"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_orders_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      v_bess_daily: {
        Row: {
          avg_soc_pct: number | null
          company_id: string | null
          day: string | null
          latest_soh_pct: number | null
          max_soc_pct: number | null
          min_soc_pct: number | null
          project_id: string | null
          scada_asset_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "scada_telemetry_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scada_telemetry_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scada_telemetry_scada_asset_id_fkey"
            columns: ["scada_asset_id"]
            isOneToOne: false
            referencedRelation: "scada_assets"
            referencedColumns: ["id"]
          },
        ]
      }
      v_curtailment_daily: {
        Row: {
          avg_curtailment_kw: number | null
          avg_setpoint_kw: number | null
          company_id: string | null
          day: string | null
          max_curtailment_kw: number | null
          project_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "scada_telemetry_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scada_telemetry_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      v_meter_daily_energy: {
        Row: {
          company_id: string | null
          day: string | null
          energy_kwh: number | null
          project_id: string | null
          scada_asset_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "scada_telemetry_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scada_telemetry_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scada_telemetry_scada_asset_id_fkey"
            columns: ["scada_asset_id"]
            isOneToOne: false
            referencedRelation: "scada_assets"
            referencedColumns: ["id"]
          },
        ]
      }
      v_weather_daily: {
        Row: {
          avg_ambient_temp_c: number | null
          avg_irradiance_wm2: number | null
          avg_module_temp_c: number | null
          avg_wind_speed_ms: number | null
          company_id: string | null
          day: string | null
          irradiance_sample_sum: number | null
          project_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "scada_telemetry_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scada_telemetry_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      _portal_log: {
        Args: {
          p_actor_id: string
          p_company_id: string
          p_event: string
          p_membership_id: string
          p_metadata: Json
          p_project_id: string
        }
        Returns: undefined
      }
      approve_change_order: {
        Args: { p_co_id: string; p_note?: string }
        Returns: Json
      }
      assert_can_grant_role: {
        Args: {
          p_company_id: string
          p_role: Database["public"]["Enums"]["app_role"]
          p_target_user_id: string
        }
        Returns: undefined
      }
      assert_export_unlocked: {
        Args: { p_export_type: string; p_project_id: string }
        Returns: undefined
      }
      cancel_approval_instance: {
        Args: { p_instance_id: string }
        Returns: undefined
      }
      civil_geometry_kind: {
        Args: { p_type: Database["public"]["Enums"]["civil_feature_type"] }
        Returns: string
      }
      civil_geometry_matches: {
        Args: {
          p_geometry: Json
          p_type: Database["public"]["Enums"]["civil_feature_type"]
        }
        Returns: boolean
      }
      compute_next_run: {
        Args: {
          p_day_of_month: number
          p_day_of_week: number
          p_frequency: string
          p_from?: string
          p_hour_utc: number
        }
        Returns: string
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
      create_pv_layout: {
        Args: {
          p_blocks: Json
          p_name: string
          p_params: Json
          p_project_id: string
          p_site_config_id: string
          p_totals: Json
        }
        Returns: {
          approval_instance_id: string | null
          company_id: string
          created_at: string
          created_by: string | null
          id: string
          layout_number: string | null
          name: string
          params: Json
          project_id: string
          site_config_id: string | null
          status: string
          totals: Json
          updated_at: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "pv_layouts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      decide_approval: {
        Args: { p_approval_id: string; p_comment?: string; p_decision: string }
        Returns: undefined
      }
      decide_pv_layout_approval: {
        Args: { p_layout_id: string }
        Returns: {
          approval_instance_id: string | null
          company_id: string
          created_at: string
          created_by: string | null
          id: string
          layout_number: string | null
          name: string
          params: Json
          project_id: string
          site_config_id: string | null
          status: string
          totals: Json
          updated_at: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "pv_layouts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      enforce_audit_log_retention: {
        Args: never
        Returns: {
          company_id: string
          deleted_count: number
          entity: string
        }[]
      }
      ensure_pv_layout_rule: { Args: { p_company_id: string }; Returns: string }
      ensure_pv_simulation_rule: {
        Args: { p_company_id: string }
        Returns: string
      }
      escalate_overdue_approvals: { Args: never; Returns: number }
      get_po_by_share_token: {
        Args: { p_token: string }
        Returns: {
          accent_color: string
          company_name: string
          currency_code: string
          delivery_address: string
          footer_text: string
          id: string
          incoterms: string
          issued_at: string
          lines: Json
          logo_url: string
          payment_terms: string
          pdf_path: string
          po_number: string
          primary_color: string
          project_name: string
          required_by_date: string
          status: Database["public"]["Enums"]["po_status"]
          subtotal: number
          tax_amount: number
          tax_pct: number
          total_amount: number
          vendor_name: string
        }[]
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
      incorporate_change_order: { Args: { p_co_id: string }; Returns: Json }
      is_company_admin: { Args: { _company_id: string }; Returns: boolean }
      is_company_member: { Args: { p_company_id: string }; Returns: boolean }
      is_export_locked: {
        Args: { p_export_type: string; p_project_id: string }
        Returns: boolean
      }
      is_external_viewer: { Args: never; Returns: boolean }
      list_storage_buckets_status: {
        Args: { _ids: string[] }
        Returns: {
          id: string
          is_public: boolean
          name: string
        }[]
      }
      list_storage_object_policies: {
        Args: never
        Returns: {
          policyname: string
        }[]
      }
      next_sld_drawing_number: {
        Args: { p_project_id: string }
        Returns: string
      }
      portal_assert_access: {
        Args: { p_project_id: string }
        Returns: {
          accepted_at: string | null
          company_id: string
          created_at: string
          email: string
          expires_at: string | null
          exposure: Json
          id: string
          invite_id: string | null
          invited_by: string | null
          last_seen_at: string | null
          project_id: string
          role: Database["public"]["Enums"]["app_role"]
          status: string
          updated_at: string
          user_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "portal_memberships"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      portal_decide_approval: {
        Args: { p_approval_id: string; p_comment: string; p_decision: string }
        Returns: undefined
      }
      portal_get_feed: { Args: { p_project_id: string }; Returns: Json }
      portal_raise_ticket: {
        Args: {
          p_body: string
          p_category: string
          p_priority: string
          p_project_id: string
          p_subject: string
        }
        Returns: string
      }
      redeem_invite: { Args: { p_token: string }; Returns: string }
      resolve_share_link: { Args: { p_token_hash: string }; Returns: Json }
      save_pv_layout_blocks: {
        Args: { p_blocks: Json; p_layout_id: string; p_totals?: Json }
        Returns: number
      }
      set_pv_layout_status: {
        Args: { p_layout_id: string; p_status: string }
        Returns: {
          approval_instance_id: string | null
          company_id: string
          created_at: string
          created_by: string | null
          id: string
          layout_number: string | null
          name: string
          params: Json
          project_id: string
          site_config_id: string | null
          status: string
          totals: Json
          updated_at: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "pv_layouts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      start_approval_instance: {
        Args: {
          p_amount?: number
          p_entity_id: string
          p_entity_type: string
          p_metadata?: Json
          p_rule_key: string
        }
        Returns: string
      }
      storage_company_id: { Args: { p_name: string }; Returns: string }
      submit_pv_layout: {
        Args: { p_layout_id: string }
        Returns: {
          approval_instance_id: string | null
          company_id: string
          created_at: string
          created_by: string | null
          id: string
          layout_number: string | null
          name: string
          params: Json
          project_id: string
          site_config_id: string | null
          status: string
          totals: Json
          updated_at: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "pv_layouts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      sync_export_locks: { Args: { p_project_id: string }; Returns: number }
      verify_api_key: {
        Args: { p_raw_key: string }
        Returns: {
          allowed_ips: string[]
          company_id: string
          hmac_secret: string
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
      alarm_condition: "gt" | "gte" | "lt" | "lte" | "eq" | "ne"
      alarm_severity: "info" | "warning" | "major" | "critical"
      alarm_status: "active" | "acknowledged" | "cleared"
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
      asset_node_type:
        | "plant"
        | "site"
        | "block"
        | "inverter_station"
        | "inverter"
        | "transformer"
        | "switchgear"
        | "meter"
        | "weather_station"
        | "bess_container"
        | "battery_rack"
        | "battery_module"
        | "string"
        | "sensor"
      cash_flow_direction: "inflow" | "outflow"
      cash_flow_kind: "forecast" | "actual"
      change_order_status:
        | "draft"
        | "submitted"
        | "under_review"
        | "approved"
        | "rejected"
        | "incorporated"
      civil_feature_type:
        | "grading_zone"
        | "flood_risk_zone"
        | "drainage_path"
        | "road_alignment"
        | "trench_route"
        | "equipment_platform"
        | "fence_line"
        | "gate"
        | "laydown_area"
        | "construction_compound"
        | "crane_access"
        | "emergency_access"
      commissioning_certificate_type:
        | "mechanical_completion"
        | "cod"
        | "ccc_transfer"
      commissioning_test_status:
        | "not_started"
        | "scheduled"
        | "in_progress"
        | "passed"
        | "failed"
        | "on_hold"
      commissioning_test_type:
        | "insulation_resistance"
        | "hipot"
        | "iv_curve"
        | "string_test"
        | "continuity"
        | "earth_resistance"
        | "functional"
        | "other"
      contract_status:
        | "draft"
        | "negotiation"
        | "signed"
        | "active"
        | "completed"
        | "terminated"
      contract_type:
        | "epc"
        | "ppa"
        | "supply"
        | "service"
        | "consulting"
        | "lease"
        | "other"
      cwp_status:
        | "draft"
        | "planned"
        | "in_progress"
        | "on_hold"
        | "complete"
        | "cancelled"
      dd_item_status:
        | "not_started"
        | "in_progress"
        | "submitted"
        | "accepted"
        | "waived"
      debit_note_status: "draft" | "issued" | "settled" | "cancelled"
      delay_cause:
        | "weather"
        | "material"
        | "design"
        | "labor"
        | "equipment"
        | "client"
        | "permit"
        | "access"
        | "other"
      delivery_status: "pending" | "success" | "failed"
      document_category:
        | "drawing"
        | "report"
        | "calculation"
        | "datasheet"
        | "correspondence"
        | "contract_doc"
        | "other"
      dpr_status: "draft" | "submitted" | "approved"
      drawing_discipline:
        | "civil"
        | "structural"
        | "electrical"
        | "mechanical"
        | "scada_controls"
        | "survey"
        | "general"
      drawing_status: "draft" | "IFD" | "IFC" | "as_built" | "superseded"
      ea_study_status: "draft" | "under_review" | "approved"
      ea_study_type:
        | "load_flow"
        | "short_circuit"
        | "cable_ampacity"
        | "voltage_drop"
        | "transformer_loading"
        | "motor_starting"
        | "protection_schedule"
        | "harmonics"
        | "grounding"
        | "arc_flash"
        | "dc_system"
        | "aux_ac"
        | "ups_battery"
        | "generator_sizing"
        | "capacitor_bank"
        | "reactive_power"
        | "pf_correction"
        | "grid_code_checklist"
      equipment_status: "active" | "inactive" | "spare" | "decommissioned"
      equipment_type:
        | "inverter"
        | "module_string"
        | "tracker"
        | "transformer"
        | "meter"
        | "weather_station"
        | "bess_container"
        | "battery_rack"
        | "pcs"
        | "switchgear"
        | "other"
      event_action_status:
        | "pending_approval"
        | "approved"
        | "executed"
        | "rejected"
        | "failed"
        | "skipped"
      event_action_type:
        | "create_incident"
        | "create_work_order"
        | "assign_technician"
        | "spare_parts_request"
        | "warranty_claim"
        | "hse_escalation"
        | "client_notification"
        | "lender_report_exception"
        | "performance_ld_assessment"
      expediting_status: "on_track" | "at_risk" | "delayed" | "delivered"
      facility_type:
        | "term_loan"
        | "revolver"
        | "construction_loan"
        | "letter_of_credit"
        | "bond"
        | "equity"
      field_delivery_status:
        | "expected"
        | "in_transit"
        | "delivered"
        | "partially_delivered"
        | "rejected"
      field_equipment_status: "on_site" | "standby" | "off_hired" | "breakdown"
      gov_doc_status:
        | "draft"
        | "submitted"
        | "under_review"
        | "approved"
        | "rejected"
        | "superseded"
      grn_status: "draft" | "confirmed" | "has_defects" | "closed"
      hse_incident_severity:
        | "minor"
        | "moderate"
        | "major"
        | "critical"
        | "fatal"
      hse_incident_status: "open" | "investigating" | "closed"
      hse_incident_type:
        | "injury"
        | "near_miss"
        | "property_damage"
        | "environmental"
        | "security"
      hse_inspection_status: "scheduled" | "completed" | "closed"
      ingestion_queue_status: "pending" | "processing" | "retried" | "dead"
      ingestion_run_status: "running" | "success" | "partial" | "failed"
      ingestion_trigger: "manual" | "scheduled" | "push" | "import"
      invite_status: "pending" | "accepted" | "revoked" | "expired"
      invoice_direction: "receivable" | "payable"
      invoice_status:
        | "draft"
        | "submitted"
        | "under_review"
        | "approved"
        | "paid"
        | "disputed"
        | "cancelled"
      layout_scenario_type:
        | "max_capacity"
        | "min_grading"
        | "min_cable_length"
        | "min_road_length"
        | "lowest_epc_cost"
        | "max_energy_yield"
        | "balanced"
      lead_source:
        | "referral"
        | "inbound"
        | "outbound"
        | "event"
        | "partner"
        | "other"
      lead_status: "new" | "working" | "qualified" | "unqualified" | "converted"
      look_ahead_status: "draft" | "published" | "locked"
      match_status:
        | "pending"
        | "matched"
        | "variance_blocked"
        | "approved_with_variance"
      material_category:
        | "module"
        | "inverter"
        | "tracker"
        | "battery_cell"
        | "transformer"
        | "cable_copper"
        | "cable_alu"
        | "steel"
        | "concrete"
        | "other"
      mobilization_category:
        | "cabins_facilities"
        | "fencing_security"
        | "hse_induction"
        | "utilities_comms"
        | "access_logistics"
        | "permits_licenses"
      mobilization_status: "not_started" | "in_progress" | "complete"
      ncr_disposition: "pending" | "rework" | "repair" | "use_as_is" | "scrap"
      ncr_source: "inspection" | "punch_item" | "observation" | "other"
      ncr_status: "open" | "in_progress" | "closed" | "void"
      observation_severity: "low" | "medium" | "high" | "critical"
      observation_status: "open" | "in_progress" | "closed"
      offline_queue_status: "pending" | "synced" | "failed"
      om_report_status: "draft" | "generated" | "sent"
      om_report_type: "monthly" | "quarterly" | "annual"
      opportunity_stage:
        | "prospecting"
        | "qualification"
        | "proposal"
        | "negotiation"
        | "won"
        | "lost"
      pay_app_status:
        | "draft"
        | "submitted"
        | "certified"
        | "approved"
        | "rejected"
        | "invoiced"
      pm_frequency: "weekly" | "monthly" | "quarterly" | "semiannual" | "annual"
      po_status:
        | "draft"
        | "pending_approval"
        | "approved"
        | "issued"
        | "partially_received"
        | "received"
        | "closed"
        | "cancelled"
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
      project_intake_source: "manual" | "opportunity" | "api" | "other"
      project_intake_status:
        | "new"
        | "in_review"
        | "accepted"
        | "rejected"
        | "converted"
      project_phase: "development" | "ntp" | "cod" | "handover"
      project_status: "active" | "on_hold" | "completed" | "archived"
      proposal_status:
        | "draft"
        | "in_review"
        | "approved"
        | "sent"
        | "viewed"
        | "accepted"
        | "rejected"
        | "expired"
        | "superseded"
      ptw_status:
        | "requested"
        | "active"
        | "suspended"
        | "closed"
        | "expired"
        | "cancelled"
      ptw_type:
        | "hot_work"
        | "confined_space"
        | "working_at_height"
        | "electrical"
        | "excavation"
        | "lifting"
        | "general"
      punch_category: "A" | "B" | "C"
      punch_status: "open" | "ready_for_review" | "closed" | "void"
      pv_equipment_category:
        | "module"
        | "inverter"
        | "optimizer"
        | "tracker"
        | "structure"
        | "transformer"
        | "cable"
        | "combiner_box"
        | "switchgear"
        | "bess"
      pv_layout_block_type:
        | "array_table"
        | "setback"
        | "access_road"
        | "internal_road"
        | "equipment_pad"
        | "inverter_station"
        | "transformer_station"
        | "substation_zone"
        | "drainage_corridor"
        | "cable_corridor"
      pv_mounting_type:
        | "fixed_tilt"
        | "single_axis_tracker"
        | "dual_axis_tracker"
      qaqc_discipline: "civil" | "mechanical" | "electrical"
      qaqc_result: "pending" | "pass" | "fail" | "conditional"
      recovery_plan_status: "draft" | "active" | "achieved" | "abandoned"
      rfq_bid_status:
        | "invited"
        | "submitted"
        | "under_review"
        | "awarded"
        | "rejected"
        | "withdrawn"
      rfq_status: "draft" | "issued" | "closed" | "awarded" | "cancelled"
      risk_status: "open" | "mitigating" | "realized" | "closed"
      scada_asset_type:
        | "inverter"
        | "meter"
        | "weather_station"
        | "plant_controller"
        | "bess"
        | "combiner"
      scada_connector_status: "active" | "disabled" | "error"
      scada_connector_type:
        | "modbus_tcp"
        | "iec61850"
        | "sunspec"
        | "mqtt"
        | "vendor_api"
        | "csv_import"
      scada_event_type:
        | "event"
        | "warning"
        | "trip"
        | "comm_failure"
        | "status_change"
        | "operator_action"
        | "setpoint_change"
        | "maintenance"
        | "protection"
      schedule_task_status:
        | "not_started"
        | "in_progress"
        | "completed"
        | "on_hold"
        | "cancelled"
      si_status: "issued" | "acknowledged" | "completed" | "cancelled"
      sld_status:
        | "draft"
        | "under_review"
        | "approved"
        | "ifc"
        | "as_built"
        | "superseded"
      submittal_status:
        | "draft"
        | "submitted"
        | "under_review"
        | "approved"
        | "approved_as_noted"
        | "revise_resubmit"
        | "rejected"
      tag_mapping_protocol:
        | "mqtt"
        | "opcua"
        | "modbus"
        | "historian_csv"
        | "vendor_api"
      tbt_status: "scheduled" | "held" | "cancelled"
      tender_event_type:
        | "pre_bid_meeting"
        | "site_visit"
        | "qa_deadline"
        | "submission_deadline"
        | "bid_opening"
        | "clarification"
        | "award_announcement"
        | "other"
      ticket_category:
        | "corrective"
        | "inspection"
        | "warranty"
        | "monitoring"
        | "other"
      ticket_status:
        | "open"
        | "in_progress"
        | "waiting_client"
        | "resolved"
        | "closed"
      tq_status: "draft" | "submitted" | "answered" | "closed" | "void"
      transmittal_direction: "outgoing" | "incoming"
      vendor_status: "onboarding" | "active" | "suspended" | "blacklisted"
      warranty_claim_status:
        | "draft"
        | "submitted"
        | "under_review"
        | "approved"
        | "rejected"
        | "settled"
      warranty_type:
        | "manufacturer"
        | "epc_workmanship"
        | "extended"
        | "performance"
      wbs_item_type: "phase" | "package" | "discipline" | "task_group"
      weather_delay_type:
        | "rain"
        | "wind"
        | "heat"
        | "cold"
        | "dust_storm"
        | "lightning"
        | "other"
      work_order_priority: "low" | "medium" | "high" | "emergency"
      work_order_status:
        | "open"
        | "assigned"
        | "in_progress"
        | "on_hold"
        | "completed"
        | "closed"
        | "cancelled"
      work_order_type: "preventive" | "corrective" | "predictive" | "inspection"
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
      alarm_condition: ["gt", "gte", "lt", "lte", "eq", "ne"],
      alarm_severity: ["info", "warning", "major", "critical"],
      alarm_status: ["active", "acknowledged", "cleared"],
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
      asset_node_type: [
        "plant",
        "site",
        "block",
        "inverter_station",
        "inverter",
        "transformer",
        "switchgear",
        "meter",
        "weather_station",
        "bess_container",
        "battery_rack",
        "battery_module",
        "string",
        "sensor",
      ],
      cash_flow_direction: ["inflow", "outflow"],
      cash_flow_kind: ["forecast", "actual"],
      change_order_status: [
        "draft",
        "submitted",
        "under_review",
        "approved",
        "rejected",
        "incorporated",
      ],
      civil_feature_type: [
        "grading_zone",
        "flood_risk_zone",
        "drainage_path",
        "road_alignment",
        "trench_route",
        "equipment_platform",
        "fence_line",
        "gate",
        "laydown_area",
        "construction_compound",
        "crane_access",
        "emergency_access",
      ],
      commissioning_certificate_type: [
        "mechanical_completion",
        "cod",
        "ccc_transfer",
      ],
      commissioning_test_status: [
        "not_started",
        "scheduled",
        "in_progress",
        "passed",
        "failed",
        "on_hold",
      ],
      commissioning_test_type: [
        "insulation_resistance",
        "hipot",
        "iv_curve",
        "string_test",
        "continuity",
        "earth_resistance",
        "functional",
        "other",
      ],
      contract_status: [
        "draft",
        "negotiation",
        "signed",
        "active",
        "completed",
        "terminated",
      ],
      contract_type: [
        "epc",
        "ppa",
        "supply",
        "service",
        "consulting",
        "lease",
        "other",
      ],
      cwp_status: [
        "draft",
        "planned",
        "in_progress",
        "on_hold",
        "complete",
        "cancelled",
      ],
      dd_item_status: [
        "not_started",
        "in_progress",
        "submitted",
        "accepted",
        "waived",
      ],
      debit_note_status: ["draft", "issued", "settled", "cancelled"],
      delay_cause: [
        "weather",
        "material",
        "design",
        "labor",
        "equipment",
        "client",
        "permit",
        "access",
        "other",
      ],
      delivery_status: ["pending", "success", "failed"],
      document_category: [
        "drawing",
        "report",
        "calculation",
        "datasheet",
        "correspondence",
        "contract_doc",
        "other",
      ],
      dpr_status: ["draft", "submitted", "approved"],
      drawing_discipline: [
        "civil",
        "structural",
        "electrical",
        "mechanical",
        "scada_controls",
        "survey",
        "general",
      ],
      drawing_status: ["draft", "IFD", "IFC", "as_built", "superseded"],
      ea_study_status: ["draft", "under_review", "approved"],
      ea_study_type: [
        "load_flow",
        "short_circuit",
        "cable_ampacity",
        "voltage_drop",
        "transformer_loading",
        "motor_starting",
        "protection_schedule",
        "harmonics",
        "grounding",
        "arc_flash",
        "dc_system",
        "aux_ac",
        "ups_battery",
        "generator_sizing",
        "capacitor_bank",
        "reactive_power",
        "pf_correction",
        "grid_code_checklist",
      ],
      equipment_status: ["active", "inactive", "spare", "decommissioned"],
      equipment_type: [
        "inverter",
        "module_string",
        "tracker",
        "transformer",
        "meter",
        "weather_station",
        "bess_container",
        "battery_rack",
        "pcs",
        "switchgear",
        "other",
      ],
      event_action_status: [
        "pending_approval",
        "approved",
        "executed",
        "rejected",
        "failed",
        "skipped",
      ],
      event_action_type: [
        "create_incident",
        "create_work_order",
        "assign_technician",
        "spare_parts_request",
        "warranty_claim",
        "hse_escalation",
        "client_notification",
        "lender_report_exception",
        "performance_ld_assessment",
      ],
      expediting_status: ["on_track", "at_risk", "delayed", "delivered"],
      facility_type: [
        "term_loan",
        "revolver",
        "construction_loan",
        "letter_of_credit",
        "bond",
        "equity",
      ],
      field_delivery_status: [
        "expected",
        "in_transit",
        "delivered",
        "partially_delivered",
        "rejected",
      ],
      field_equipment_status: ["on_site", "standby", "off_hired", "breakdown"],
      gov_doc_status: [
        "draft",
        "submitted",
        "under_review",
        "approved",
        "rejected",
        "superseded",
      ],
      grn_status: ["draft", "confirmed", "has_defects", "closed"],
      hse_incident_severity: [
        "minor",
        "moderate",
        "major",
        "critical",
        "fatal",
      ],
      hse_incident_status: ["open", "investigating", "closed"],
      hse_incident_type: [
        "injury",
        "near_miss",
        "property_damage",
        "environmental",
        "security",
      ],
      hse_inspection_status: ["scheduled", "completed", "closed"],
      ingestion_queue_status: ["pending", "processing", "retried", "dead"],
      ingestion_run_status: ["running", "success", "partial", "failed"],
      ingestion_trigger: ["manual", "scheduled", "push", "import"],
      invite_status: ["pending", "accepted", "revoked", "expired"],
      invoice_direction: ["receivable", "payable"],
      invoice_status: [
        "draft",
        "submitted",
        "under_review",
        "approved",
        "paid",
        "disputed",
        "cancelled",
      ],
      layout_scenario_type: [
        "max_capacity",
        "min_grading",
        "min_cable_length",
        "min_road_length",
        "lowest_epc_cost",
        "max_energy_yield",
        "balanced",
      ],
      lead_source: [
        "referral",
        "inbound",
        "outbound",
        "event",
        "partner",
        "other",
      ],
      lead_status: ["new", "working", "qualified", "unqualified", "converted"],
      look_ahead_status: ["draft", "published", "locked"],
      match_status: [
        "pending",
        "matched",
        "variance_blocked",
        "approved_with_variance",
      ],
      material_category: [
        "module",
        "inverter",
        "tracker",
        "battery_cell",
        "transformer",
        "cable_copper",
        "cable_alu",
        "steel",
        "concrete",
        "other",
      ],
      mobilization_category: [
        "cabins_facilities",
        "fencing_security",
        "hse_induction",
        "utilities_comms",
        "access_logistics",
        "permits_licenses",
      ],
      mobilization_status: ["not_started", "in_progress", "complete"],
      ncr_disposition: ["pending", "rework", "repair", "use_as_is", "scrap"],
      ncr_source: ["inspection", "punch_item", "observation", "other"],
      ncr_status: ["open", "in_progress", "closed", "void"],
      observation_severity: ["low", "medium", "high", "critical"],
      observation_status: ["open", "in_progress", "closed"],
      offline_queue_status: ["pending", "synced", "failed"],
      om_report_status: ["draft", "generated", "sent"],
      om_report_type: ["monthly", "quarterly", "annual"],
      opportunity_stage: [
        "prospecting",
        "qualification",
        "proposal",
        "negotiation",
        "won",
        "lost",
      ],
      pay_app_status: [
        "draft",
        "submitted",
        "certified",
        "approved",
        "rejected",
        "invoiced",
      ],
      pm_frequency: ["weekly", "monthly", "quarterly", "semiannual", "annual"],
      po_status: [
        "draft",
        "pending_approval",
        "approved",
        "issued",
        "partially_received",
        "received",
        "closed",
        "cancelled",
      ],
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
      project_intake_source: ["manual", "opportunity", "api", "other"],
      project_intake_status: [
        "new",
        "in_review",
        "accepted",
        "rejected",
        "converted",
      ],
      project_phase: ["development", "ntp", "cod", "handover"],
      project_status: ["active", "on_hold", "completed", "archived"],
      proposal_status: [
        "draft",
        "in_review",
        "approved",
        "sent",
        "viewed",
        "accepted",
        "rejected",
        "expired",
        "superseded",
      ],
      ptw_status: [
        "requested",
        "active",
        "suspended",
        "closed",
        "expired",
        "cancelled",
      ],
      ptw_type: [
        "hot_work",
        "confined_space",
        "working_at_height",
        "electrical",
        "excavation",
        "lifting",
        "general",
      ],
      punch_category: ["A", "B", "C"],
      punch_status: ["open", "ready_for_review", "closed", "void"],
      pv_equipment_category: [
        "module",
        "inverter",
        "optimizer",
        "tracker",
        "structure",
        "transformer",
        "cable",
        "combiner_box",
        "switchgear",
        "bess",
      ],
      pv_layout_block_type: [
        "array_table",
        "setback",
        "access_road",
        "internal_road",
        "equipment_pad",
        "inverter_station",
        "transformer_station",
        "substation_zone",
        "drainage_corridor",
        "cable_corridor",
      ],
      pv_mounting_type: [
        "fixed_tilt",
        "single_axis_tracker",
        "dual_axis_tracker",
      ],
      qaqc_discipline: ["civil", "mechanical", "electrical"],
      qaqc_result: ["pending", "pass", "fail", "conditional"],
      recovery_plan_status: ["draft", "active", "achieved", "abandoned"],
      rfq_bid_status: [
        "invited",
        "submitted",
        "under_review",
        "awarded",
        "rejected",
        "withdrawn",
      ],
      rfq_status: ["draft", "issued", "closed", "awarded", "cancelled"],
      risk_status: ["open", "mitigating", "realized", "closed"],
      scada_asset_type: [
        "inverter",
        "meter",
        "weather_station",
        "plant_controller",
        "bess",
        "combiner",
      ],
      scada_connector_status: ["active", "disabled", "error"],
      scada_connector_type: [
        "modbus_tcp",
        "iec61850",
        "sunspec",
        "mqtt",
        "vendor_api",
        "csv_import",
      ],
      scada_event_type: [
        "event",
        "warning",
        "trip",
        "comm_failure",
        "status_change",
        "operator_action",
        "setpoint_change",
        "maintenance",
        "protection",
      ],
      schedule_task_status: [
        "not_started",
        "in_progress",
        "completed",
        "on_hold",
        "cancelled",
      ],
      si_status: ["issued", "acknowledged", "completed", "cancelled"],
      sld_status: [
        "draft",
        "under_review",
        "approved",
        "ifc",
        "as_built",
        "superseded",
      ],
      submittal_status: [
        "draft",
        "submitted",
        "under_review",
        "approved",
        "approved_as_noted",
        "revise_resubmit",
        "rejected",
      ],
      tag_mapping_protocol: [
        "mqtt",
        "opcua",
        "modbus",
        "historian_csv",
        "vendor_api",
      ],
      tbt_status: ["scheduled", "held", "cancelled"],
      tender_event_type: [
        "pre_bid_meeting",
        "site_visit",
        "qa_deadline",
        "submission_deadline",
        "bid_opening",
        "clarification",
        "award_announcement",
        "other",
      ],
      ticket_category: [
        "corrective",
        "inspection",
        "warranty",
        "monitoring",
        "other",
      ],
      ticket_status: [
        "open",
        "in_progress",
        "waiting_client",
        "resolved",
        "closed",
      ],
      tq_status: ["draft", "submitted", "answered", "closed", "void"],
      transmittal_direction: ["outgoing", "incoming"],
      vendor_status: ["onboarding", "active", "suspended", "blacklisted"],
      warranty_claim_status: [
        "draft",
        "submitted",
        "under_review",
        "approved",
        "rejected",
        "settled",
      ],
      warranty_type: [
        "manufacturer",
        "epc_workmanship",
        "extended",
        "performance",
      ],
      wbs_item_type: ["phase", "package", "discipline", "task_group"],
      weather_delay_type: [
        "rain",
        "wind",
        "heat",
        "cold",
        "dust_storm",
        "lightning",
        "other",
      ],
      work_order_priority: ["low", "medium", "high", "emergency"],
      work_order_status: [
        "open",
        "assigned",
        "in_progress",
        "on_hold",
        "completed",
        "closed",
        "cancelled",
      ],
      work_order_type: ["preventive", "corrective", "predictive", "inspection"],
    },
  },
} as const
