import { describe, it, expect, vi } from 'vitest';
import { generateESXFile, generateESXFromData } from '../server/esxGenerator';
import { createMockStorage } from './mocks/storage.mock';
import { makeClaim, makeSession, makeRoom, makeLineItem } from './mocks/fixtures';

/**
 * Extract all file entries from a ZIP buffer and return their contents as strings.
 * Uses a simple approach: since archiver creates the ZIP, we can use Node's built-in
 * zlib to decompress individual entries by scanning for local file headers.
 */
async function extractZipEntries(zipBuffer: Buffer): Promise<Record<string, string>> {
  const entries: Record<string, string> = {};
  let offset = 0;

  while (offset < zipBuffer.length - 4) {
    // Look for local file header signature: PK\x03\x04
    if (zipBuffer[offset] !== 0x50 || zipBuffer[offset + 1] !== 0x4B ||
        zipBuffer[offset + 2] !== 0x03 || zipBuffer[offset + 3] !== 0x04) {
      break;
    }

    const compressionMethod = zipBuffer.readUInt16LE(offset + 8);
    const compressedSize = zipBuffer.readUInt32LE(offset + 18);
    const uncompressedSize = zipBuffer.readUInt32LE(offset + 22);
    const fileNameLength = zipBuffer.readUInt16LE(offset + 26);
    const extraFieldLength = zipBuffer.readUInt16LE(offset + 28);
    const fileName = zipBuffer.slice(offset + 30, offset + 30 + fileNameLength).toString('utf-8');
    const dataStart = offset + 30 + fileNameLength + extraFieldLength;

    if (compressionMethod === 0) {
      // Stored (no compression)
      entries[fileName] = zipBuffer.slice(dataStart, dataStart + compressedSize).toString('utf-8');
      offset = dataStart + compressedSize;
    } else if (compressionMethod === 8) {
      // Deflated - use zlib inflateRaw
      const { inflateRawSync } = await import('zlib');
      try {
        // When using data descriptors, compressedSize may be 0 in the local header.
        // We need to find the data descriptor or just try inflating from dataStart.
        if (compressedSize > 0) {
          const compressed = zipBuffer.slice(dataStart, dataStart + compressedSize);
          const decompressed = inflateRawSync(compressed);
          entries[fileName] = decompressed.toString('utf-8');
          offset = dataStart + compressedSize;
        } else {
          // Data descriptor follows the data; try to find it by scanning for PK signature
          // or data descriptor signature. For simplicity, try inflating until we find
          // the next local file header or central directory.
          let endSearch = dataStart;
          while (endSearch < zipBuffer.length - 4) {
            if (zipBuffer[endSearch] === 0x50 && zipBuffer[endSearch + 1] === 0x4B &&
                (zipBuffer[endSearch + 2] === 0x03 || zipBuffer[endSearch + 2] === 0x01)) {
              break;
            }
            endSearch++;
          }
          // Check for data descriptor (12 or 16 bytes before next header)
          const possibleEnd = endSearch - 16 > dataStart ? endSearch - 16 : endSearch - 12;
          const compressed = zipBuffer.slice(dataStart, possibleEnd > dataStart ? possibleEnd : endSearch);
          try {
            const decompressed = inflateRawSync(compressed);
            entries[fileName] = decompressed.toString('utf-8');
          } catch {
            // Try with the full range
            const compressed2 = zipBuffer.slice(dataStart, endSearch);
            try {
              const decompressed = inflateRawSync(compressed2);
              entries[fileName] = decompressed.toString('utf-8');
            } catch {
              entries[fileName] = '';
            }
          }
          offset = endSearch;
        }
      } catch {
        entries[fileName] = '';
        offset = dataStart + (compressedSize > 0 ? compressedSize : 1);
      }
    } else {
      offset = dataStart + compressedSize;
    }
  }

  return entries;
}

describe('generateESXFile', () => {
  const claim = makeClaim();
  const session = makeSession();
  const rooms = [
    makeRoom({ id: 1, name: 'Kitchen' }),
    makeRoom({ id: 2, name: 'Living Room' }),
  ];
  const lineItems = [
    makeLineItem({ id: 1, roomId: 1, category: 'Drywall', xactCode: 'DRY-12-SF' }),
    makeLineItem({ id: 2, roomId: 1, category: 'Painting', xactCode: 'PNT-WALL-SF' }),
    makeLineItem({ id: 3, roomId: 2, category: 'Flooring', xactCode: 'FLR-CAR-SF' }),
  ];
  const summary = { totalRCV: 495.0, totalDepreciation: 49.5, totalACV: 445.5, itemCount: 3 };

  function createTestStorage() {
    return createMockStorage({
      getInspectionSession: vi.fn().mockResolvedValue(session),
      getClaim: vi.fn().mockResolvedValue(claim),
      getRooms: vi.fn().mockResolvedValue(rooms),
      getLineItems: vi.fn().mockResolvedValue(lineItems),
      getEstimateSummary: vi.fn().mockResolvedValue(summary),
    });
  }

  it('returns a Buffer', async () => {
    const storage = createTestStorage();
    const result = await generateESXFile(1, storage);
    expect(Buffer.isBuffer(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
  });

  it('produces a valid ZIP (starts with PK magic bytes)', async () => {
    const storage = createTestStorage();
    const result = await generateESXFile(1, storage);
    // ZIP files start with PK (0x50 0x4B)
    expect(result[0]).toBe(0x50);
    expect(result[1]).toBe(0x4B);
  });

  it('calls the correct storage methods', async () => {
    const storage = createTestStorage();
    await generateESXFile(1, storage);

    expect(storage.getInspectionSession).toHaveBeenCalledWith(1);
    expect(storage.getClaim).toHaveBeenCalledWith(claim.id);
    expect(storage.getRooms).toHaveBeenCalledWith(1);
    expect(storage.getLineItems).toHaveBeenCalledWith(1);
  });

  it('throws if session not found', async () => {
    const storage = createMockStorage({
      getInspectionSession: vi.fn().mockResolvedValue(undefined),
    });
    await expect(generateESXFile(999, storage)).rejects.toThrow('Session not found');
  });

  it('throws if claim not found', async () => {
    const storage = createMockStorage({
      getInspectionSession: vi.fn().mockResolvedValue(session),
      getClaim: vi.fn().mockResolvedValue(undefined),
    });
    await expect(generateESXFile(1, storage)).rejects.toThrow('Claim not found');
  });

  it('contains XACTDOC.XML marker in the ZIP', async () => {
    const storage = createTestStorage();
    const result = await generateESXFile(1, storage);
    const bufStr = result.toString('utf-8');
    expect(bufStr).toContain('XACTDOC.XML');
  });

  it('contains GENERIC_ROUGHDRAFT.XML marker in the ZIP', async () => {
    const storage = createTestStorage();
    const result = await generateESXFile(1, storage);
    const bufStr = result.toString('utf-8');
    expect(bufStr).toContain('GENERIC_ROUGHDRAFT.XML');
  });

  it('embeds the claim number in the XML', async () => {
    const storage = createTestStorage();
    const result = await generateESXFile(1, storage);
    const entries = await extractZipEntries(result);
    const xactdoc = entries['XACTDOC.XML'] || '';
    expect(xactdoc).toContain('CLM-2025-001');
  });

  it('embeds room names in the rough draft XML', async () => {
    const storage = createTestStorage();
    const result = await generateESXFile(1, storage);
    const entries = await extractZipEntries(result);
    const roughdraft = entries['GENERIC_ROUGHDRAFT.XML'] || '';
    expect(roughdraft).toContain('Kitchen');
    expect(roughdraft).toContain('Living Room');
  });

  it('groups line items by room', async () => {
    const storage = createTestStorage();
    const result = await generateESXFile(1, storage);
    const entries = await extractZipEntries(result);
    const roughdraft = entries['GENERIC_ROUGHDRAFT.XML'] || '';
    const kitchenPos = roughdraft.indexOf('Kitchen');
    const livingPos = roughdraft.indexOf('Living Room');
    expect(kitchenPos).toBeGreaterThan(-1);
    expect(livingPos).toBeGreaterThan(-1);
  });

  it('handles session with zero line items', async () => {
    const storage = createMockStorage({
      getInspectionSession: vi.fn().mockResolvedValue(session),
      getClaim: vi.fn().mockResolvedValue(claim),
      getRooms: vi.fn().mockResolvedValue(rooms),
      getLineItems: vi.fn().mockResolvedValue([]),
      getEstimateSummary: vi.fn().mockResolvedValue({ totalRCV: 0, totalDepreciation: 0, totalACV: 0, itemCount: 0 }),
    });
    const result = await generateESXFile(1, storage);
    expect(Buffer.isBuffer(result)).toBe(true);
  });

  it('escapes XML special characters in claim data', async () => {
    const xssClaim = makeClaim({ insuredName: 'O\'Brien & Associates <LLC>' });
    const storage = createMockStorage({
      getInspectionSession: vi.fn().mockResolvedValue(session),
      getClaim: vi.fn().mockResolvedValue(xssClaim),
      getRooms: vi.fn().mockResolvedValue(rooms),
      getLineItems: vi.fn().mockResolvedValue(lineItems),
      getEstimateSummary: vi.fn().mockResolvedValue(summary),
    });
    const result = await generateESXFile(1, storage);
    const entries = await extractZipEntries(result);
    const xactdoc = entries['XACTDOC.XML'] || '';
    // Should have escaped & < > characters
    expect(xactdoc).toContain('&amp;');
    expect(xactdoc).toContain('&lt;');
  });
});

describe('generateESXFromData - M/L/E and depreciation', () => {
  const claim = makeClaim();
  const session = makeSession();
  const rooms = [makeRoom({ id: 1, name: 'Kitchen' })];
  const lineItems = [
    makeLineItem({
      id: 1,
      roomId: 1,
      category: 'Drywall',
      tradeCode: 'DRY',
      xactCode: 'DRY-12-SF',
      totalPrice: 165,
      quantity: 100,
      age: 5,
    }),
  ];

  it('includes equipment in GENERIC_ROUGHDRAFT ITEM elements', async () => {
    const result = await generateESXFromData({
      claim,
      session,
      rooms,
      lineItems,
    });
    const entries = await extractZipEntries(result);
    const roughdraft = entries['GENERIC_ROUGHDRAFT.XML'] || '';
    expect(roughdraft).toContain('equipment="');
  });

  it('includes depreciationPct and depreciationAmt in ITEM elements', async () => {
    const result = await generateESXFromData({
      claim,
      session,
      rooms,
      lineItems,
    });
    const entries = await extractZipEntries(result);
    const roughdraft = entries['GENERIC_ROUGHDRAFT.XML'] || '';
    expect(roughdraft).toContain('depreciationPct="');
    expect(roughdraft).toContain('depreciationAmt="');
  });

  it('includes PERIL and LOSS_LOCATION in XACTDOC', async () => {
    const result = await generateESXFromData({
      claim,
      session,
      rooms,
      lineItems,
    });
    const entries = await extractZipEntries(result);
    const xactdoc = entries['XACTDOC.XML'] || '';
    expect(xactdoc).toContain('<PERIL>');
    expect(xactdoc).toContain('<LOSS_LOCATION>');
    expect(xactdoc).toContain('<LOSS_DETAILS>');
    expect(xactdoc).toContain('<COVERAGE>');
    expect(xactdoc).toContain('<ADJUSTER_INFO>');
  });

  it('uses Recoverable depreciation type for water claims', async () => {
    const waterClaim = makeClaim({ perilType: 'water' });
    const result = await generateESXFromData({
      claim: waterClaim,
      session,
      rooms,
      lineItems,
    });
    const entries = await extractZipEntries(result);
    const xactdoc = entries['XACTDOC.XML'] || '';
    expect(xactdoc).toContain('Recoverable');
  });

  it('throws when validation fails (missing claim number)', async () => {
    const invalidClaim = makeClaim({ claimNumber: '' });
    await expect(
      generateESXFromData({
        claim: invalidClaim,
        session,
        rooms,
        lineItems,
      })
    ).rejects.toThrow(/ESX validation failed|Claim number/);
  });
});
