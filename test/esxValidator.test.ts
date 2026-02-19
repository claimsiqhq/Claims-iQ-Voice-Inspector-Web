import { describe, it, expect } from 'vitest';
import {
  validateESXData,
  validateMLEPercentages,
  validateACVvsRCV,
  validateDepreciationPercentage,
} from '../server/esxValidator';

const validLineItem = {
  id: 1,
  description: 'Drywall repair',
  quantity: 100,
  rcvTotal: 165,
  acvTotal: 140,
  material: 66,
  laborTotal: 74.25,
  equipment: 24.75,
  depreciationAmount: 25,
};

const validMetadata = {
  transactionId: 'CLAIMSIQ-EST-123',
  claimNumber: 'CLM-2025-001',
  lossLocation: { propertyAddress: '123 Main St' },
  peril: { dateOfLoss: '2025-01-15' },
  priceListId: 'FLFM8X_NOV22',
  coverage: { deductibleAmount: 1000 },
  summary: {
    totalRCV: 165,
    totalACV: 140,
    totalDepreciation: 25,
  },
  adjusterInfo: { name: 'Jane Adjuster' },
};

describe('esxValidator', () => {
  describe('validateESXData', () => {
    it('passes with valid data', () => {
      const result = validateESXData({
        lineItems: [validLineItem],
        metadata: validMetadata,
        claim: { claimNumber: 'CLM-2025-001', perilType: 'water' },
      });
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('returns error when transactionId is missing', () => {
      const result = validateESXData({
        lineItems: [validLineItem],
        metadata: { ...validMetadata, transactionId: '' },
        claim: {},
      });
      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.field.includes('transactionId'))).toBe(true);
    });

    it('returns error when claimNumber is missing', () => {
      const result = validateESXData({
        lineItems: [validLineItem],
        metadata: { ...validMetadata, claimNumber: '' },
        claim: {},
      });
      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.field.includes('claimNumber'))).toBe(true);
    });

    it('returns error when property address is missing', () => {
      const result = validateESXData({
        lineItems: [validLineItem],
        metadata: { ...validMetadata, lossLocation: { propertyAddress: '' } },
        claim: {},
      });
      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.field.includes('propertyAddress'))).toBe(true);
    });

    it('returns error when dateOfLoss is missing', () => {
      const result = validateESXData({
        lineItems: [validLineItem],
        metadata: { ...validMetadata, peril: {} },
        claim: {},
      });
      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.field.includes('dateOfLoss'))).toBe(true);
    });

    it('returns error when ACV exceeds RCV', () => {
      const result = validateESXData({
        lineItems: [{ ...validLineItem, acvTotal: 200, rcvTotal: 165 }],
        metadata: validMetadata,
        claim: {},
      });
      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.message.includes('ACV'))).toBe(true);
    });

    it('returns error when item description is empty', () => {
      const result = validateESXData({
        lineItems: [{ ...validLineItem, description: '' }],
        metadata: validMetadata,
        claim: {},
      });
      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.message.includes('Description'))).toBe(true);
    });

    it('returns error when depreciation percentage is invalid', () => {
      const result = validateESXData({
        lineItems: [{ ...validLineItem, depreciationPercentage: 150 }],
        metadata: validMetadata,
        claim: {},
      });
      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.field.includes('depreciationPercentage'))).toBe(true);
    });

    it('returns error when summary totals do not match', () => {
      const result = validateESXData({
        lineItems: [validLineItem],
        metadata: { ...validMetadata, summary: { totalRCV: 999, totalACV: 450, totalDepreciation: 50 } },
        claim: {},
      });
      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.field.includes('totalRCV'))).toBe(true);
    });

    it('returns warning for USNATNL price list', () => {
      const result = validateESXData({
        lineItems: [validLineItem],
        metadata: { ...validMetadata, priceListId: 'USNATNL' },
        claim: {},
      });
      expect(result.warnings.some((w) => w.field.includes('priceListId'))).toBe(true);
    });

    it('returns warning for wind/hail claim without roof info', () => {
      const result = validateESXData({
        lineItems: [validLineItem],
        metadata: validMetadata,
        claim: { perilType: 'wind' },
      });
      expect(result.warnings.some((w) => w.field.includes('roofInfo'))).toBe(true);
    });

    it('includes summary in result', () => {
      const result = validateESXData({
        lineItems: [validLineItem],
        metadata: validMetadata,
        claim: {},
      });
      expect(result.summary).toContain('passed');
      expect(result.summary).toContain('errors');
      expect(result.summary).toContain('warnings');
    });
  });

  describe('validateMLEPercentages', () => {
    it('returns true when sum is 100', () => {
      expect(validateMLEPercentages(50, 45, 5)).toBe(true);
    });

    it('returns true within 1% tolerance', () => {
      expect(validateMLEPercentages(33.33, 33.33, 33.34)).toBe(true);
    });

    it('returns false when sum deviates', () => {
      expect(validateMLEPercentages(50, 50, 5)).toBe(false);
    });
  });

  describe('validateACVvsRCV', () => {
    it('returns true when ACV <= RCV', () => {
      expect(validateACVvsRCV(100, 85)).toBe(true);
      expect(validateACVvsRCV(100, 100)).toBe(true);
    });

    it('allows 1 cent rounding tolerance', () => {
      expect(validateACVvsRCV(100, 100.01)).toBe(true);
    });

    it('returns false when ACV exceeds RCV', () => {
      expect(validateACVvsRCV(100, 101)).toBe(false);
    });
  });

  describe('validateDepreciationPercentage', () => {
    it('returns true for 0-100', () => {
      expect(validateDepreciationPercentage(0)).toBe(true);
      expect(validateDepreciationPercentage(50)).toBe(true);
      expect(validateDepreciationPercentage(100)).toBe(true);
    });

    it('returns false for negative or over 100', () => {
      expect(validateDepreciationPercentage(-1)).toBe(false);
      expect(validateDepreciationPercentage(101)).toBe(false);
    });
  });
});
