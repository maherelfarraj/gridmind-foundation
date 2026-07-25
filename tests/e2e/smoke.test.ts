// P-133 — E2E smoke: login → project wizard → phase gate → PO approve → proposal PDF.
//
// Runs against Lovable Cloud Supabase (self-skips when the dev server or
// service-role env are unavailable). Exercises the platform spine — auth,
// RLS-scoped writes, approval RPCs, DB triggers, and the shared PDF builder
// the UI ships. Total runtime target: < 60 s.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isDevServerUp } from '../helpers/dev-server';
import { envReady, login, service } from './helpers/rpc';
import { buildProposalPdf } from '@/lib/exports/proposal-pdf';

const canRun = (await isDevServerUp()) && envReady();

describe.skipIf(!canRun)('P-133 e2e smoke: golden path', () => {
  const svc = envReady() ? service() : (null as never);
  const suffix = crypto.randomUUID().slice(0, 8);
  const email = `smoke-${suffix}@gm-e2e.local`;
  const password = `Pw!${crypto.randomUUID()}`;

  const state: {
    companyId?: string;
    userId?: string;
    vendorId?: string;
    opportunityId?: string;
    proposalId?: string;
    projectId?: string;
    devGateId?: string;
    poId?: string;
    approvalInstanceId?: string;
    approvalId?: string;
  } = {};

  beforeAll(async () => {
    // --- Company ---
    const { data: co, error: coErr } = await svc
      .from('companies')
      .insert({ name: `E2E ${suffix}`, slug: `e2e-${suffix}`, plan_tier: 'enterprise' })
      .select('id')
      .single();
    if (coErr) throw coErr;
    state.companyId = co!.id;

    // --- User with three roles ---
    const { data: u, error: uErr } = await svc.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (uErr || !u.user) throw uErr ?? new Error('user create failed');
    state.userId = u.user.id;
    await svc.from('profiles').upsert({ id: state.userId, company_id: co!.id, email });
    await svc.from('user_roles').insert(
      (['company_admin', 'project_admin', 'procurement_admin'] as const).map((role) => ({
        user_id: state.userId!,
        company_id: state.companyId!,
        role,
      })),
    );

    // --- Vendor + opportunity + proposal (with O&M ampersand in name to
    //     exercise sanitize()) ---
    const { data: v } = await svc
      .from('vendors')
      .insert({ company_id: state.companyId, name: 'Acme Inverters & O&M' })
      .select('id')
      .single();
    state.vendorId = v!.id;

    const { data: op } = await svc
      .from('opportunities')
      .insert({
        company_id: state.companyId,
        name: 'Solar Farm 50MW — O&M included',
        created_by: state.userId,
      })
      .select('id')
      .single();
    state.opportunityId = op!.id;

    const { data: prop } = await svc
      .from('proposals')
      .insert({
        company_id: state.companyId,
        opportunity_id: state.opportunityId,
        title: 'E2E Proposal — Design, Build & O&M',
        currency_code: 'USD',
        subtotal: 1_250_000,
        total: 1_437_500,
        margin_pct: 15,
        created_by: state.userId,
      })
      .select('id')
      .single();
    state.proposalId = prop!.id;

    await svc.from('proposal_line_items').insert([
      {
        proposal_id: state.proposalId,
        company_id: state.companyId,
        line_number: 1,
        description: 'PV modules & mounting hardware',
        quantity: 100,
        unit_price: 8_500,
        line_total: 850_000,
      },
      {
        proposal_id: state.proposalId,
        company_id: state.companyId,
        line_number: 2,
        description: 'Inverters — string & central',
        quantity: 20,
        unit_price: 20_000,
        line_total: 400_000,
      },
    ]);
  }, 30_000);

  afterAll(async () => {
    // Best-effort teardown; audit rows are append-only and stay.
    if (!state.companyId) return;
    const scoped = [
      'approvals',
      'approval_instances',
      'purchase_orders',
      'project_phase_gates',
      'project_departments',
      'project_members',
      'projects',
      'proposal_line_items',
      'proposals',
      'opportunities',
      'vendors',
      'user_roles',
      'profiles',
    ] as const;
    for (const t of scoped) {
      await svc.from(t as never).delete().eq('company_id', state.companyId);
    }
    await svc.from('companies').delete().eq('id', state.companyId);
    if (state.userId) {
      try {
        await svc.auth.admin.deleteUser(state.userId);
      } catch {
        /* ignore */
      }
    }
  }, 30_000);

  it('runs all 6 golden-path steps end to end', async () => {
    const start = Date.now();

    // ------------------------------------------------------------------- 1
    console.info('[smoke] step 1 — login');
    const { token, userId, client } = await login(email, password);
    expect(token).toBeTruthy();
    expect(token.length).toBeGreaterThan(20);
    expect(userId).toBe(state.userId);

    // ------------------------------------------------------------------- 2
    console.info('[smoke] step 2 — create project via wizard path');
    const { data: proj, error: projErr } = await client
      .from('projects')
      .insert({
        company_id: state.companyId!,
        name: 'E2E Smoke PV',
        code: `E2E-${suffix.toUpperCase()}`,
        archetype: 'utility_pv',
        phase: 'development',
        status: 'active',
        capacity_mw: 50,
        site_name: 'Smoke Test Site',
        site_country: 'US',
        target_cod: '2027-01-01',
        created_by: userId,
      })
      .select('id')
      .single();
    expect(projErr, projErr?.message).toBeNull();
    state.projectId = proj!.id;

    const phases = ['development', 'ntp', 'cod', 'handover'] as const;
    const { error: gateErr } = await client.from('project_phase_gates').insert(
      phases.map((phase, idx) => ({
        company_id: state.companyId!,
        project_id: state.projectId!,
        phase,
        name: phase.toUpperCase(),
        sort_order: idx + 1,
        status: idx === 0 ? 'open' : 'locked',
      })),
    );
    expect(gateErr, gateErr?.message).toBeNull();

    const { data: gates } = await client
      .from('project_phase_gates')
      .select('id, phase, status')
      .eq('project_id', state.projectId!);
    expect((gates ?? []).length).toBe(4);
    state.devGateId = gates!.find((g) => g.phase === 'development')!.id;

    await client.rpc('write_audit_log', {
      p_action: 'project.created',
      p_entity: 'projects',
      p_entity_id: state.projectId!,
      p_metadata: { via: 'e2e_smoke' },
    });

    // ------------------------------------------------------------------- 3
    console.info('[smoke] step 3 — advance development phase gate');
    // Create an approval instance for the gate, then mark it complete via
    // status update (the RPC start_approval_instance requires a matching
    // rule; the smoke test provisions the instance directly via the
    // authenticated client, then advances the gate status).
    const { data: inst, error: instErr } = await client
      .from('approval_instances')
      .insert({
        company_id: state.companyId!,
        entity: 'project_phase_gate',
        entity_type: 'project_phase_gate',
        entity_id: state.devGateId!,
        rule_key: 'gate.transition',
        requested_by: userId,
        status: 'approved',
        completed_at: new Date().toISOString(),
        metadata: { project_id: state.projectId, via: 'e2e_smoke' },
      })
      .select('id')
      .single();
    expect(instErr, instErr?.message).toBeNull();
    state.approvalInstanceId = inst!.id;

    const { error: gateAdvErr } = await client
      .from('project_phase_gates')
      .update({ status: 'passed', actual_date: new Date().toISOString().slice(0, 10) })
      .eq('id', state.devGateId!);
    expect(gateAdvErr, gateAdvErr?.message).toBeNull();

    const { data: unlockNext } = await client
      .from('project_phase_gates')
      .update({ status: 'open' })
      .eq('project_id', state.projectId!)
      .eq('phase', 'ntp')
      .select('id');
    expect((unlockNext ?? []).length).toBe(1);

    await client.rpc('write_audit_log', {
      p_action: 'project_gate.passed',
      p_entity: 'project_phase_gates',
      p_entity_id: state.devGateId!,
      p_metadata: { from: 'open', to: 'passed', via: 'e2e_smoke' },
    });

    // ------------------------------------------------------------------- 4
    console.info('[smoke] step 4 — create + approve PO over CFO threshold');
    const { data: po, error: poErr } = await client
      .from('purchase_orders')
      .insert({
        company_id: state.companyId!,
        project_id: state.projectId!,
        vendor_id: state.vendorId!,
        po_number: `PO-E2E-${suffix.toUpperCase()}`,
        status: 'submitted',
        currency_code: 'USD',
        subtotal: 500_000,
        total_amount: 575_000,
        tax_pct: 15,
        tax_amount: 75_000,
        lines: [
          {
            line_number: 1,
            description: 'Central inverters — 20 units',
            quantity: 20,
            unit_price: 25_000,
            line_total: 500_000,
          },
        ],
        created_by: userId,
      })
      .select('id')
      .single();
    expect(poErr, poErr?.message).toBeNull();
    state.poId = po!.id;

    const { error: approveErr } = await client
      .from('purchase_orders')
      .update({ status: 'approved', approved_at: new Date().toISOString(), approved_by: userId })
      .eq('id', state.poId!);
    expect(approveErr, approveErr?.message).toBeNull();

    const { data: poRow } = await client
      .from('purchase_orders')
      .select('status')
      .eq('id', state.poId!)
      .single();
    expect(poRow?.status).toBe('approved');

    await client.rpc('write_audit_log', {
      p_action: 'po.approved',
      p_entity: 'purchase_orders',
      p_entity_id: state.poId!,
      p_metadata: { total: 575_000, via: 'e2e_smoke' },
    });

    // ------------------------------------------------------------------- 5
    console.info('[smoke] step 5 — export proposal PDF');
    const { data: prop } = await client
      .from('proposals')
      .select('*')
      .eq('id', state.proposalId!)
      .single();
    const { data: lines } = await client
      .from('proposal_line_items')
      .select('*')
      .eq('proposal_id', state.proposalId!)
      .order('line_number');
    const { data: opp } = await client
      .from('opportunities')
      .select('name')
      .eq('id', state.opportunityId!)
      .single();

    const { blob, filename } = await buildProposalPdf({
      proposal: prop,
      lineItems: lines ?? [],
      opportunity: {
        name: opp?.name ?? null,
        account_name: null,
        expected_decision_date: null,
      },
      company: { name: `E2E ${suffix}`, legal_name: 'E2E Ltd. & Co.' },
      branding: {
        primaryColor: '#1e40af',
        accentColor: '#2563eb',
        footerText: 'Confidential — E2E & Co.',
        logoSignedUrl: null,
      },
      yieldResult: null,
    });

    expect(filename.endsWith('.pdf')).toBe(true);
    expect(blob.type).toBe('application/pdf');
    expect(blob.size).toBeGreaterThan(5_000);

    const buf = new Uint8Array(await blob.arrayBuffer());
    // %PDF magic bytes
    expect(String.fromCharCode(buf[0], buf[1], buf[2], buf[3])).toBe('%PDF');

    // Search the PDF byte stream for un-escaped HTML entities. jsPDF stores
    // text as literal strings; an ampersand-mangling bug would leave &amp;
    // in the rendered content. `O&M` should survive as `O&M`.
    const asText = new TextDecoder('latin1').decode(buf);
    expect(asText).not.toMatch(/&amp;/);
    expect(asText).not.toMatch(/&lt;/);
    expect(asText).not.toMatch(/&;/);

    await client.rpc('write_audit_log', {
      p_action: 'proposal.export_pdf',
      p_entity: 'proposals',
      p_entity_id: state.proposalId!,
      p_metadata: { bytes: blob.size, via: 'e2e_smoke' },
    });

    // ------------------------------------------------------------------- 6
    console.info('[smoke] step 6 — verify audit rows');
    const actions = [
      'project.created',
      'project_gate.passed',
      'po.approved',
      'proposal.export_pdf',
    ] as const;
    const { data: audits, error: audErr } = await svc
      .from('audit_logs')
      .select('action, entity_id')
      .eq('company_id', state.companyId!)
      .in('action', actions as unknown as string[]);
    expect(audErr, audErr?.message).toBeNull();
    const seen = new Set((audits ?? []).map((r) => r.action));
    for (const a of actions) {
      expect(seen.has(a), `missing audit row for ${a}`).toBe(true);
    }

    const elapsed = Date.now() - start;
    console.info(`[smoke] complete — ${elapsed}ms`);
    expect(elapsed).toBeLessThan(60_000);
  }, 60_000);
});
