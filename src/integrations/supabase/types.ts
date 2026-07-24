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
          project_id: string
          revision_id: string
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
          project_id: string
          revision_id: string
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
          project_id?: string
          revision_id?: string
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
      document_category:
        | "drawing"
        | "report"
        | "calculation"
        | "datasheet"
        | "correspondence"
        | "contract_doc"
        | "other"
      drawing_discipline:
        | "civil"
        | "structural"
        | "electrical"
        | "mechanical"
        | "scada_controls"
        | "survey"
        | "general"
      drawing_status: "draft" | "IFD" | "IFC" | "as_built" | "superseded"
      invite_status: "pending" | "accepted" | "revoked" | "expired"
      lead_source:
        | "referral"
        | "inbound"
        | "outbound"
        | "event"
        | "partner"
        | "other"
      lead_status: "new" | "working" | "qualified" | "unqualified" | "converted"
      opportunity_stage:
        | "prospecting"
        | "qualification"
        | "proposal"
        | "negotiation"
        | "won"
        | "lost"
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
      rfq_bid_status:
        | "invited"
        | "submitted"
        | "under_review"
        | "awarded"
        | "rejected"
        | "withdrawn"
      rfq_status: "draft" | "issued" | "closed" | "awarded" | "cancelled"
      tender_event_type:
        | "pre_bid_meeting"
        | "site_visit"
        | "qa_deadline"
        | "submission_deadline"
        | "bid_opening"
        | "clarification"
        | "award_announcement"
        | "other"
      vendor_status: "onboarding" | "active" | "suspended" | "blacklisted"
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
      document_category: [
        "drawing",
        "report",
        "calculation",
        "datasheet",
        "correspondence",
        "contract_doc",
        "other",
      ],
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
      invite_status: ["pending", "accepted", "revoked", "expired"],
      lead_source: [
        "referral",
        "inbound",
        "outbound",
        "event",
        "partner",
        "other",
      ],
      lead_status: ["new", "working", "qualified", "unqualified", "converted"],
      opportunity_stage: [
        "prospecting",
        "qualification",
        "proposal",
        "negotiation",
        "won",
        "lost",
      ],
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
      rfq_bid_status: [
        "invited",
        "submitted",
        "under_review",
        "awarded",
        "rejected",
        "withdrawn",
      ],
      rfq_status: ["draft", "issued", "closed", "awarded", "cancelled"],
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
      vendor_status: ["onboarding", "active", "suspended", "blacklisted"],
    },
  },
} as const
