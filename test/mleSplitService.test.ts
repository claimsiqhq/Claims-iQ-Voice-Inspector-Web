import { describe, it, expect } from 'vitest';
import {
  resolveMLE,
  validateMLESplit,
  applyMLEToPrice,
  type MLESplit,
} from '../server/mleSplitService';

describe('mleSplitService', () => {
  describe('resolveMLE', () => {
    it('uses regional price data when available (tier 1)', async () => {
      const getRegionalPrice = async () => ({
        materialCost: 50,
        laborCost: 40,
        equipmentCost: 10,
      });

      const result = await resolveMLE({
        xactCode: 'DRY-12-SF',
        category: 'DRY',
        priceListId: 'FLFM8X_NOV22',
        getRegionalPrice,
      });

      expect(result.source).toBe('regional');
      expect(result.priceListId).toBe('FLFM8X_NOV22');
      expect(result.material).toBeCloseTo(50, 1);   // 50/100 = 50%
      expect(result.labor).toBeCloseTo(40, 1);     // 40/100 = 40%
      expect(result.equipment).toBeCloseTo(10, 1); // 10/100 = 10%
    });

    it('falls back to category defaults when regional lookup returns no data (tier 2)', async () => {
      const getRegionalPrice = async () => null;

      const result = await resolveMLE({
        xactCode: 'DRY-12-SF',
        category: 'DRY',
        priceListId: 'FLFM8X_NOV22',
        getRegionalPrice,
      });

      expect(result.source).toBe('category');
      expect(result.material).toBe(40);
      expect(result.labor).toBe(55);
      expect(result.equipment).toBe(5);
    });

    it('uses RFG category defaults for roofing', async () => {
      const result = await resolveMLE({ category: 'RFG' });
      expect(result.source).toBe('category');
      expect(result.material).toBe(55);
      expect(result.labor).toBe(40);
      expect(result.equipment).toBe(5);
    });

    it('uses HVA category defaults for HVAC (equipment-heavy)', async () => {
      const result = await resolveMLE({ category: 'HVA' });
      expect(result.source).toBe('category');
      expect(result.material).toBe(40);
      expect(result.labor).toBe(45);
      expect(result.equipment).toBe(15);
    });

    it('falls back to GEN (50/45/5) for unknown category (tier 3)', async () => {
      const result = await resolveMLE({ category: 'XYZ' });
      expect(result.source).toBe('fallback');
      expect(result.material).toBe(50);
      expect(result.labor).toBe(45);
      expect(result.equipment).toBe(5);
    });

    it('falls back when getRegionalPrice throws', async () => {
      const getRegionalPrice = async () => {
        throw new Error('DB error');
      };

      const result = await resolveMLE({
        xactCode: 'DRY-12-SF',
        category: 'DRY',
        getRegionalPrice,
      });

      expect(result.source).toBe('category');
      expect(result.material).toBe(40);
    });

    it('falls back when regional data has zero total', async () => {
      const getRegionalPrice = async () => ({
        materialCost: 0,
        laborCost: 0,
        equipmentCost: 0,
      });

      const result = await resolveMLE({
        xactCode: 'DRY-12-SF',
        category: 'DRY',
        getRegionalPrice,
      });

      expect(result.source).toBe('category');
    });
  });

  describe('validateMLESplit', () => {
    it('returns true when percentages sum to 100', () => {
      expect(validateMLESplit({ material: 50, labor: 45, equipment: 5, source: 'category' })).toBe(true);
      expect(validateMLESplit({ material: 100, labor: 0, equipment: 0, source: 'category' })).toBe(true);
    });

    it('returns true within 1% tolerance', () => {
      expect(validateMLESplit({ material: 50, labor: 45, equipment: 5.5, source: 'category' })).toBe(true);
      expect(validateMLESplit({ material: 33.33, labor: 33.33, equipment: 33.34, source: 'regional' })).toBe(true);
    });

    it('returns false when sum deviates more than 1%', () => {
      expect(validateMLESplit({ material: 60, labor: 50, equipment: 5, source: 'category' })).toBe(false);
      expect(validateMLESplit({ material: 40, labor: 40, equipment: 10, source: 'category' })).toBe(false);
    });
  });

  describe('applyMLEToPrice', () => {
    it('splits total price by M/L/E percentages', () => {
      const split: MLESplit = { material: 50, labor: 45, equipment: 5, source: 'category' };
      const result = applyMLEToPrice(100, split);

      expect(result.material).toBe(50);
      expect(result.labor).toBe(45);
      expect(result.equipment).toBe(5);
    });

    it('rounds to 2 decimal places', () => {
      const split: MLESplit = { material: 33.33, labor: 33.33, equipment: 33.34, source: 'category' };
      const result = applyMLEToPrice(100, split);

      expect(result.material).toBeCloseTo(33.33, 2);
      expect(result.labor).toBeCloseTo(33.33, 2);
      expect(result.equipment).toBeCloseTo(33.34, 2);
    });

    it('handles zero total', () => {
      const split: MLESplit = { material: 50, labor: 45, equipment: 5, source: 'category' };
      const result = applyMLEToPrice(0, split);

      expect(result.material).toBe(0);
      expect(result.labor).toBe(0);
      expect(result.equipment).toBe(0);
    });
  });
});
