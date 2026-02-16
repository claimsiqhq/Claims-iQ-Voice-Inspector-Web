import { describe, it, expect } from 'vitest';
import { generateInspectionPDF } from '../server/pdfGenerator';
import {
  makeClaim,
  makeSession,
  makeRoom,
  makeDamage,
  makeLineItem,
  makePhoto,
  makeMoistureReading,
} from './mocks/fixtures';

function makeMinimalPDFData() {
  return {
    claim: makeClaim(),
    session: makeSession(),
    rooms: [makeRoom()],
    damages: [makeDamage()],
    lineItems: [makeLineItem()],
    photos: [] as any[],
    moistureReadings: [] as any[],
    estimate: {
      totalRCV: 165.0,
      totalDepreciation: 16.5,
      totalACV: 148.5,
      itemCount: 1,
      categories: [
        {
          category: 'Drywall',
          subtotal: 165.0,
          items: [makeLineItem()],
        },
      ],
    },
    inspectorName: 'Test Inspector',
  };
}

describe('generateInspectionPDF', () => {
  it('returns a Buffer', async () => {
    const result = await generateInspectionPDF(makeMinimalPDFData());
    expect(Buffer.isBuffer(result)).toBe(true);
  });

  it('produces a valid PDF (starts with %PDF magic bytes)', async () => {
    const result = await generateInspectionPDF(makeMinimalPDFData());
    const header = result.slice(0, 5).toString('ascii');
    expect(header).toBe('%PDF-');
  });

  it('produces a non-trivial PDF (at least 1KB)', async () => {
    const result = await generateInspectionPDF(makeMinimalPDFData());
    expect(result.length).toBeGreaterThan(1024);
  });

  it('handles empty rooms array', async () => {
    const data = makeMinimalPDFData();
    data.rooms = [];
    data.damages = [];
    data.lineItems = [];
    data.estimate.categories = [];
    const result = await generateInspectionPDF(data);
    expect(Buffer.isBuffer(result)).toBe(true);
  });

  it('handles null claim gracefully', async () => {
    const data = makeMinimalPDFData();
    data.claim = null as any;
    const result = await generateInspectionPDF(data);
    expect(Buffer.isBuffer(result)).toBe(true);
  });

  it('includes photo appendix when photos are present', async () => {
    const data = makeMinimalPDFData();
    data.photos = [makePhoto(), makePhoto({ id: 2, caption: 'Second photo' })];
    const result = await generateInspectionPDF(data);
    // A PDF with photos should be larger than one without
    const noPhotosResult = await generateInspectionPDF(makeMinimalPDFData());
    expect(result.length).toBeGreaterThan(noPhotosResult.length);
  });

  it('includes moisture report for water peril claims with readings', async () => {
    const data = makeMinimalPDFData();
    data.claim = makeClaim({ perilType: 'water' });
    data.moistureReadings = [
      makeMoistureReading(),
      makeMoistureReading({ id: 2, location: 'South wall', reading: 32.1 }),
    ];
    const result = await generateInspectionPDF(data);
    // Should be larger than a PDF without moisture data
    const noMoistureResult = await generateInspectionPDF(makeMinimalPDFData());
    expect(result.length).toBeGreaterThan(noMoistureResult.length);
  });

  it('skips moisture report for non-water perils', async () => {
    const data = makeMinimalPDFData();
    data.claim = makeClaim({ perilType: 'fire' });
    data.moistureReadings = [makeMoistureReading()];
    const resultFire = await generateInspectionPDF(data);

    data.claim = makeClaim({ perilType: 'water' });
    const resultWater = await generateInspectionPDF(data);

    // Water peril with readings should produce more pages/content
    expect(resultWater.length).toBeGreaterThan(resultFire.length);
  });

  it('handles large number of rooms without error', async () => {
    const data = makeMinimalPDFData();
    data.rooms = Array.from({ length: 20 }, (_, i) =>
      makeRoom({ id: i + 1, name: `Room ${i + 1}` }),
    );
    data.damages = data.rooms.map((r) => makeDamage({ roomId: r.id }));
    data.lineItems = data.rooms.map((r) => makeLineItem({ roomId: r.id }));
    const result = await generateInspectionPDF(data);
    expect(Buffer.isBuffer(result)).toBe(true);
  });

  it('uses default inspector name when not provided', async () => {
    const data = makeMinimalPDFData();
    delete (data as any).inspectorName;
    const result = await generateInspectionPDF(data);
    expect(Buffer.isBuffer(result)).toBe(true);
  });
});
