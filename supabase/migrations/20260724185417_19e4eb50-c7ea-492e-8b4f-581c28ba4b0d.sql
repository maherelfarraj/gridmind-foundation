-- 0027_po_share_lookup.sql — P-065
create or replace function public.get_po_by_share_token(p_token uuid)
returns table (
  id uuid,
  po_number text,
  status po_status,
  currency_code text,
  lines jsonb,
  subtotal numeric,
  tax_pct numeric,
  tax_amount numeric,
  total_amount numeric,
  payment_terms text,
  incoterms text,
  delivery_address text,
  required_by_date date,
  issued_at timestamptz,
  pdf_path text,
  vendor_name text,
  project_name text,
  company_name text,
  primary_color text,
  accent_color text,
  footer_text text,
  logo_url text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.id,
    p.po_number,
    p.status,
    p.currency_code,
    p.lines,
    p.subtotal,
    p.tax_pct,
    p.tax_amount,
    p.total_amount,
    p.payment_terms,
    p.incoterms,
    p.delivery_address,
    p.required_by_date,
    p.issued_at,
    p.pdf_path,
    v.name  as vendor_name,
    pr.name as project_name,
    c.name  as company_name,
    cb.primary_color,
    cb.accent_color,
    cb.footer_text,
    cb.logo_url
  from public.purchase_orders p
  join public.companies c on c.id = p.company_id
  left join public.vendors v on v.id = p.vendor_id
  left join public.projects pr on pr.id = p.project_id
  left join public.company_branding cb on cb.company_id = p.company_id
  where p.share_token = p_token
    and p.share_token_expires_at is not null
    and p.share_token_expires_at > now()
    and p.status <> 'cancelled';
$$;

revoke execute on function public.get_po_by_share_token(uuid) from public;
grant execute on function public.get_po_by_share_token(uuid) to anon, authenticated;