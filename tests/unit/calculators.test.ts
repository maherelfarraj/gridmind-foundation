// P-130 — Calculator regression coverage: cable / transformer / solar-string
// sizing and a static-import audit proving calculators stay pure.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  selectCableSize,
  IEC_60228_SIZES_MM2,
} from '@/lib/calculators/cable';
import { selectTransformer, STANDARD_KVA } from '@/lib/calculators/transformer';
import { evaluateSolarString } from '@/lib/calculators/solar-string';

describe('selectCableSize (IEC 60228)', () => {
  it('rounds UP to the next standard size when voltage drop binds', () => {
    // Long run at moderate current on 400 V: ampacity is fine on small
    // conductors but vDrop forces a much larger cross-section.
    const short = selectCableSize({ loadA: 60, lengthM: 20, voltageV: 400, maxDropPct: 3 });
    const long = selectCableSize({ loadA: 60, lengthM: 400, voltageV: 400, maxDropPct: 3 });
    expect(long.sizeMm2).toBeGreaterThan(short.sizeMm2);
    expect(long.valid).toBe(true);
    expect(long.voltageDropPct).toBeLessThanOrEqual(3);
    expect((IEC_60228_SIZES_MM2 as readonly number[]).includes(long.sizeMm2)).toBe(true);
    expect(long.ampacityOk).toBe(true);
  });

  it('reports voltageDropPct correctly for a known case', () => {
    // 100 A × 100 m single-phase copper 25 mm², 230 V:
    //   R = 0.0175 * 100 / 25 = 0.07 Ω;  vDrop = 2 * 0.07 * 100 = 14 V;
    //   drop% = 14 / 230 = 6.09%
    const res = selectCableSize({ loadA: 100, lengthM: 100, voltageV: 230, maxDropPct: 100, phase: 1 });
    // Ampacity for 25 mm² is 119 A → satisfies at first pass.
    expect(res.sizeMm2).toBe(25);
    expect(res.voltageDropPct).toBeCloseTo(6.087, 2);
  });

  it('flags invalid when even the largest size cannot carry the load', () => {
    const res = selectCableSize({ loadA: 2000, lengthM: 10, voltageV: 400, maxDropPct: 3 });
    expect(res.valid).toBe(false);
    expect(res.sizeMm2).toBe(630);
    expect(res.ampacityOk).toBe(false);
  });
});

describe('selectTransformer (standard kVA)', () => {
  it('rounds required kVA up to a standard nameplate rating', () => {
    // 500 kW at pf 0.95 → 526.3 kVA. Target 80% → 657.9 kVA required.
    // Next standard step = 800 kVA.
    const res = selectTransformer({ loadKw: 500, powerFactor: 0.95, loadingPctTarget: 80 });
    expect((STANDARD_KVA as readonly number[]).includes(res.nameplateKva)).toBe(true);
    expect(res.nameplateKva).toBe(800);
    expect(res.loadKva).toBeCloseTo(526.316, 2);
    expect(res.utilizationPct).toBeLessThanOrEqual(80);
    expect(res.meetsTarget).toBe(true);
  });

  it('respects a lower loadingPctTarget by picking a larger transformer', () => {
    const at80 = selectTransformer({ loadKw: 500, loadingPctTarget: 80 });
    const at50 = selectTransformer({ loadKw: 500, loadingPctTarget: 50 });
    expect(at50.nameplateKva).toBeGreaterThan(at80.nameplateKva);
  });
});

describe('evaluateSolarString', () => {
  const module = {
    moduleVoc: 41.0,
    moduleVmp: 34.0,
    tempCoeffVocPctPerC: -0.28,
    tempCoeffVmpPctPerC: -0.35,
  };
  const site = { minTempC: -20, maxTempC: 70 };
  const inv1500 = { inverterMaxVdc: 1500, inverterMpptMinVdc: 550, inverterMpptMaxVdc: 1500 };

  it('marks valid=false with reason voc_exceeds_inverter_max at record cold', () => {
    // 32 modules × cold Voc ≈ 41 * (1 + (-0.28/100) * (-45)) ≈ 46.16 V → 1477 V string.
    // 33 modules → ~1523 V > 1500 → invalid.
    const res = evaluateSolarString({ ...module, ...site, ...inv1500, modulesPerString: 33 });
    expect(res.valid).toBe(false);
    expect(res.reason).toBe('voc_exceeds_inverter_max');
    expect(res.stringVocCold).toBeGreaterThan(inv1500.inverterMaxVdc);
  });

  it('accepts a configuration that stays below Vdc-max and above MPPT-min', () => {
    const res = evaluateSolarString({ ...module, ...site, ...inv1500, modulesPerString: 28 });
    expect(res.valid).toBe(true);
    expect(res.stringVocCold).toBeLessThanOrEqual(inv1500.inverterMaxVdc);
    expect(res.stringVmpHot).toBeGreaterThanOrEqual(inv1500.inverterMpptMinVdc);
  });

  it('computes minModulesForMpptMin from MPPT-min at record hot', () => {
    // hot Vmp ≈ 34 * (1 + (-0.35/100) * 45) ≈ 28.65 V.
    // Ceil(550 / 28.65) = 20.
    const res = evaluateSolarString({ ...module, ...site, ...inv1500, modulesPerString: 28 });
    expect(res.minModulesForMpptMin).toBe(20);
    expect(res.hotVmpPerModule).toBeCloseTo(28.645, 1);
  });
});

describe('calculators have zero React/Supabase imports', () => {
  const CALC_DIR = join(process.cwd(), 'src/lib/calculators');

  it('every calculator source file is pure', () => {
    const files = readdirSync(CALC_DIR).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
    expect(files.length).toBeGreaterThan(0);
    const banned = [
      /from\s+['"]react['"]/,
      /from\s+['"]react-dom['"]/,
      /from\s+['"]@\/integrations\/supabase\//,
      /from\s+['"]@supabase\/supabase-js['"]/,
      /from\s+['"]@tanstack\//,
    ];
    for (const file of files) {
      const src = readFileSync(join(CALC_DIR, file), 'utf8');
      for (const re of banned) {
        expect(re.test(src), `${file} must not import ${re.source}`).toBe(false);
      }
    }
  });
});
