import { describe, it, expect } from 'vitest';
import {
  resolveCategory,
  resolveMitigationCategory,
  COMPLETE_TRADE_CODE_MAP,
} from '../server/tradeCodeMapping';

describe('tradeCodeMapping', () => {
  describe('resolveMitigationCategory', () => {
    it('returns WTR for water peril', () => {
      expect(resolveMitigationCategory('water')).toBe('WTR');
      expect(resolveMitigationCategory('flood')).toBe('WTR');
      expect(resolveMitigationCategory('flooding')).toBe('WTR');
    });

    it('returns FIR for fire peril', () => {
      expect(resolveMitigationCategory('fire')).toBe('FIR');
      expect(resolveMitigationCategory('smoke')).toBe('FIR');
    });

    it('returns WND for wind/hail peril', () => {
      expect(resolveMitigationCategory('wind')).toBe('WND');
      expect(resolveMitigationCategory('hail')).toBe('WND');
      expect(resolveMitigationCategory('windstorm')).toBe('WND');
    });

    it('returns MLR for mold peril', () => {
      expect(resolveMitigationCategory('mold')).toBe('MLR');
    });

    it('returns WTR when peril is undefined', () => {
      expect(resolveMitigationCategory(undefined)).toBe('WTR');
    });

    it('returns WTR for unknown peril', () => {
      expect(resolveMitigationCategory('unknown')).toBe('WTR');
    });
  });

  describe('resolveCategory', () => {
    it('maps RFG to RFG', () => {
      expect(resolveCategory('RFG')).toBe('RFG');
      expect(resolveCategory('ROOF')).toBe('RFG');
      expect(resolveCategory('GUT')).toBe('RFG');
    });

    it('maps DRY to DRY', () => {
      expect(resolveCategory('DRY')).toBe('DRY');
      expect(resolveCategory('DRYWALL')).toBe('DRY');
    });

    it('maps PNT to PNT', () => {
      expect(resolveCategory('PNT')).toBe('PNT');
      expect(resolveCategory('PAINT')).toBe('PNT');
    });

    it('maps FLR to FLR', () => {
      expect(resolveCategory('FLR')).toBe('FLR');
      expect(resolveCategory('CAR')).toBe('FLR');
    });

    it('maps ELE, PLM, HVA to correct categories', () => {
      expect(resolveCategory('ELE')).toBe('ELE');
      expect(resolveCategory('PLM')).toBe('PLM');
      expect(resolveCategory('HVA')).toBe('HVA');
      expect(resolveCategory('HVAC')).toBe('HVA');
      expect(resolveCategory('MEC')).toBe('HVA');
    });

    it('maps DEM and MIT', () => {
      expect(resolveCategory('DEM')).toBe('DEM');
      expect(resolveCategory('MIT')).toBe('WTR'); // default peril = water
      expect(resolveCategory('MIT', 'fire')).toBe('FIR');
      expect(resolveCategory('MIT', 'wind')).toBe('WND');
      expect(resolveCategory('MIT', 'mold')).toBe('MLR');
    });

    it('returns GEN for unknown trade code', () => {
      expect(resolveCategory('UNKNOWN')).toBe('GEN');
      expect(resolveCategory('XYZ')).toBe('GEN');
    });

    it('returns GEN when tradeCode is empty', () => {
      expect(resolveCategory('')).toBe('GEN');
      expect(resolveCategory(undefined as any)).toBe('GEN');
    });

    it('normalizes case', () => {
      expect(resolveCategory('dry')).toBe('DRY');
      expect(resolveCategory('  rfg  ')).toBe('RFG');
    });
  });

  describe('COMPLETE_TRADE_CODE_MAP', () => {
    it('includes all major trade codes', () => {
      const majorCodes = ['RFG', 'DRY', 'PNT', 'FLR', 'ELE', 'PLM', 'HVA', 'DEM', 'MIT', 'SDG', 'INS', 'CAB', 'CTR', 'WIN', 'EXT', 'APL', 'GEN'];
      for (const code of majorCodes) {
        expect(COMPLETE_TRADE_CODE_MAP[code]).toBeDefined();
      }
    });
  });
});
