import PDFDocument from "pdfkit";
import { InspectionSession, InspectionRoom, DamageObservation, LineItem, InspectionPhoto } from "../shared/schema";
import { Claim, MoistureReading } from "../shared/schema";

interface PDFReportData {
  claim: Claim | null;
  session: InspectionSession;
  rooms: InspectionRoom[];
  damages: DamageObservation[];
  lineItems: LineItem[];
  photos: InspectionPhoto[];
  moistureReadings: MoistureReading[];
  estimate: {
    totalRCV: number;
    totalDepreciation: number;
    totalACV: number;
    itemCount: number;
    categories: Array<{
      category: string;
      subtotal: number;
      items: LineItem[];
    }>;
    // ── Settlement details ──
    recoverableDepreciation?: number;
    nonRecoverableDepreciation?: number;
    deductible?: number;
    netClaim?: number;
    overheadAmount?: number;
    profitAmount?: number;
    qualifiesForOP?: boolean;
    coverageBreakdown?: Array<{
      coverageType: string;
      totalRCV: number;
      totalACV: number;
      deductible: number;
      netClaim: number;
    }>;
  };
  inspectorName?: string;
  transcript?: any[];
  companyName?: string;
  adjusterLicense?: string;
}

// Claims IQ brand colors
const COLORS = {
  primary: "#7763B7",
  deep: "#342A4F",
  gold: "#C6A54E",
  lightGray: "#F3F4F6",
  darkGray: "#6B7280",
  red: "#EF4444",
  green: "#22C55E",
  amber: "#F59E0B",
};

const FONTS = {
  normal: "Helvetica",
  bold: "Helvetica-Bold",
  mono: "Courier",
};

export async function generateInspectionPDF(data: PDFReportData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "letter", margin: 40 });
    const chunks: Buffer[] = [];

    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    // Page 1: Cover Page
    renderCoverPage(doc, data);
    doc.addPage();

    // Page 2: Claim Information
    renderClaimInfo(doc, data);

    // Pages 3+: Room-by-Room Details
    for (const room of data.rooms) {
      const roomDamages = data.damages.filter((d) => d.roomId === room.id);
      const roomItems = data.lineItems.filter((li) => li.roomId === room.id);
      const roomPhotos = data.photos.filter((p) => p.roomId === room.id);

      doc.addPage();
      renderRoomDetail(doc, room, roomDamages, roomItems, roomPhotos);
    }

    // Page N: Estimate Summary
    doc.addPage();
    renderEstimateSummary(doc, data);

    // Page N+1: Photo Appendix (if photos exist)
    if (data.photos.length > 0) {
      doc.addPage();
      renderPhotoAppendix(doc, data.photos);
    }

    // Page N+2: Moisture Report (if water peril and readings exist)
    if (data.claim?.perilType?.toLowerCase().includes("water") && data.moistureReadings.length > 0) {
      doc.addPage();
      renderMoistureReport(doc, data.moistureReadings);
    }

    // Page N+3: Transcript Appendix (if transcript entries exist)
    if (data.transcript && data.transcript.length > 0) {
      doc.addPage();
      doc.font(FONTS.bold, 18).fill(COLORS.deep).text('VOICE TRANSCRIPT', { align: 'center' });
      doc.moveDown();
      for (const entry of data.transcript) {
        const speaker = entry.speaker === 'agent' ? 'AI Inspector' : 'Adjuster';
        doc.font(FONTS.bold, 8).fill(COLORS.darkGray).text(speaker, { continued: true });
        doc.font(FONTS.normal, 8).fill(COLORS.deep).text(`: ${entry.content}`);
        doc.moveDown(0.3);
      }
    }

    doc.end();
  });
}

function renderCoverPage(doc: InstanceType<typeof PDFDocument>, data: PDFReportData) {
  // Background color
  doc.rect(0, 0, doc.page.width, doc.page.height).fill(COLORS.deep);

  // Title
  doc.font(FONTS.bold, 40).fill("white").text("INSPECTION REPORT", 40, 60);

  // Claim info box
  doc.font(FONTS.normal, 12).fill(COLORS.gold).text(`Claim #${data.claim?.claimNumber || "N/A"}`, 40, 130);
  doc.font(FONTS.normal, 11).fill("white").text(data.claim?.insuredName || "", 40, 155);
  doc.font(FONTS.normal, 10).fill("#E5E7EB").text(data.claim?.propertyAddress || "", 40, 175);

  // Key info grid
  const gridY = 250;
  const gridX = 40;
  const colWidth = 150;

  doc.font(FONTS.bold, 10).fill(COLORS.gold).text("Date of Loss", gridX, gridY);
  doc.font(FONTS.normal, 10).fill("white").text(data.claim?.dateOfLoss || "—", gridX, gridY + 18);

  doc.font(FONTS.bold, 10).fill(COLORS.gold).text("Peril", gridX + colWidth, gridY);
  doc.font(FONTS.normal, 10).fill("white").text(data.claim?.perilType || "—", gridX + colWidth, gridY + 18);

  doc.font(FONTS.bold, 10).fill(COLORS.gold).text("Inspection Date", gridX, gridY + 50);
  doc.font(FONTS.normal, 10)
    .fill("white")
    .text(data.session.startedAt ? new Date(data.session.startedAt).toLocaleDateString() : "—", gridX, gridY + 68);

  doc.font(FONTS.bold, 10).fill(COLORS.gold).text("Inspector", gridX + colWidth, gridY + 50);
  doc.font(FONTS.normal, 10).fill("white").text(data.inspectorName || "Claims IQ Agent", gridX + colWidth, gridY + 68);
  if (data.adjusterLicense) {
    doc.font(FONTS.normal, 8).fill("#9CA3AF").text(`License: ${data.adjusterLicense}`, gridX + colWidth, gridY + 84);
  }

  // Estimate snapshot
  const estimateY = 400;
  doc.fontSize(10)
    .fill("#E5E7EB")
    .text("ESTIMATE SUMMARY", gridX, estimateY);

  doc.font(FONTS.bold, 14).fill(COLORS.gold).text(`$${data.estimate.totalRCV.toLocaleString("en-US", { minimumFractionDigits: 2 })}`, gridX, estimateY + 25);
  doc.font(FONTS.normal, 9).fill("#9CA3AF").text("RCV Total", gridX, estimateY + 42);

  doc.font(FONTS.bold, 12).fill("white").text(`$${data.estimate.totalACV.toLocaleString("en-US", { minimumFractionDigits: 2 })}`, gridX + 150, estimateY + 25);
  doc.font(FONTS.normal, 9).fill("#9CA3AF").text("ACV Total", gridX + 150, estimateY + 42);

  // Footer
  const company = data.companyName || 'Claims IQ';
  doc.font(FONTS.normal, 8).fill("#6B7280").text(`Generated by ${company} — Insurance Property Inspection Platform`, 40, doc.page.height - 30);
}

function renderClaimInfo(doc: InstanceType<typeof PDFDocument>, data: PDFReportData) {
  doc.font(FONTS.bold, 16).fill(COLORS.deep).text("Claim Information", 40, 40);
  doc.moveTo(40, 62).lineTo(doc.page.width - 40, 62).stroke(COLORS.primary);

  const infoY = 80;
  const lineHeight = 18;

  renderInfoRow(doc, infoY, "Claim Number:", data.claim?.claimNumber || "—");
  renderInfoRow(doc, infoY + lineHeight, "Insured Name:", data.claim?.insuredName || "—");
  renderInfoRow(doc, infoY + lineHeight * 2, "Property Address:", `${data.claim?.propertyAddress || ""}, ${data.claim?.city || ""}, ${data.claim?.state || ""} ${data.claim?.zip || ""}`);
  renderInfoRow(doc, infoY + lineHeight * 3, "Date of Loss:", data.claim?.dateOfLoss || "—");
  renderInfoRow(doc, infoY + lineHeight * 4, "Peril Type:", data.claim?.perilType || "—");
  renderInfoRow(doc, infoY + lineHeight * 5, "Inspection Started:", data.session.startedAt ? new Date(data.session.startedAt).toLocaleString() : "—");

  doc.font(FONTS.bold, 12)
    .fill(COLORS.deep)
    .text("Property Summary", 40, infoY + lineHeight * 7);

  const summary = data.estimate;
  doc.font(FONTS.normal, 10)
    .fill(COLORS.darkGray)
    .text(`${summary.itemCount} line items across ${data.rooms.length} rooms/areas`, 40, infoY + lineHeight * 8.5);
}

function renderRoomDetail(
  doc: InstanceType<typeof PDFDocument>,
  room: InspectionRoom,
  damages: DamageObservation[],
  items: LineItem[],
  photos: InspectionPhoto[],
) {
  // Room header
  doc.font(FONTS.bold, 14).fill(COLORS.deep).text(`${room.name} (${room.structure || "Structure"})`, 40, 40);
  doc.moveTo(40, 62).lineTo(doc.page.width - 40, 62).stroke(COLORS.primary);

  let yPos = 80;

  // Room details
  if (room.dimensions) {
    const dims = room.dimensions as any;
    const dimText = dims.length && dims.width ? `${dims.length}' × ${dims.width}'` : "N/A";
    doc.font(FONTS.normal, 9)
      .fill(COLORS.darkGray)
      .text(`Dimensions: ${dimText} | Status: ${room.status || "not_started"}`, 40, yPos);
    yPos += 18;
  }

  // Damages
  if (damages.length > 0) {
    yPos += 10;
    doc.font(FONTS.bold, 10).fill(COLORS.red).text("Damage Observations", 40, yPos);
    yPos += 14;

    for (const dmg of damages) {
      doc.font(FONTS.normal, 9)
        .fill(COLORS.darkGray)
        .text(`• ${dmg.description}`, 50, yPos, { width: 400 });
      yPos += 14;

      doc.font(FONTS.normal, 8)
        .fill("#9CA3AF")
        .text(`${dmg.damageType || "—"} | Severity: ${dmg.severity || "Unknown"}`, 50, yPos);
      yPos += 12;

      if (yPos > 700) {
        doc.addPage();
        yPos = 40;
      }
    }
  }

  // Line Items
  if (items.length > 0) {
    yPos += 10;
    doc.font(FONTS.bold, 10).fill(COLORS.deep).text("Line Items", 40, yPos);
    yPos += 14;

    for (const item of items) {
      const qty = Number(item.quantity) || 0;
      const uPrice = Number(item.unitPrice) || 0;
      const totalPrice = qty * uPrice;
      doc.font(FONTS.normal, 9)
        .fill(COLORS.darkGray)
        .text(`${item.description}`, 50, yPos, { width: 350 });
      yPos += 12;

      doc.font(FONTS.mono, 8)
        .fill("#9CA3AF")
        .text(
          `${qty} ${item.unit} @ $${uPrice.toFixed(2)} = $${totalPrice.toFixed(2)}`,
          50,
          yPos
        );
      yPos += 12;

      if (yPos > 700) {
        doc.addPage();
        yPos = 40;
      }
    }
  }

  // Photos for this room
  if (photos.length > 0) {
    yPos += 10;
    doc.font(FONTS.bold, 10).fill(COLORS.deep).text(`Photos (${photos.length})`, 40, yPos);
    yPos += 14;

    for (const photo of photos) {
      doc.font(FONTS.normal, 8)
        .fill(COLORS.darkGray)
        .text(`• ${photo.caption || "Photo"}`, 50, yPos);
      yPos += 10;

      const analysis = photo.analysis as any;
      if (analysis?.description) {
        doc.font(FONTS.normal, 7)
          .fill("#9CA3AF")
          .text(analysis.description, 50, yPos, { width: 350 });
        yPos += 14;
      }

      if (yPos > 700) {
        doc.addPage();
        yPos = 40;
      }
    }
  }
}

function renderEstimateSummary(doc: InstanceType<typeof PDFDocument>, data: PDFReportData) {
  doc.font(FONTS.bold, 16).fill(COLORS.deep).text("Estimate Summary", 40, 40);
  doc.moveTo(40, 62).lineTo(doc.page.width - 40, 62).stroke(COLORS.primary);

  let yPos = 80;

  // Line items by category
  for (const cat of data.estimate.categories) {
    doc.font(FONTS.bold, 11).fill(COLORS.primary).text(cat.category, 40, yPos);
    yPos += 16;

    for (const item of cat.items) {
      const totalPrice = (Number(item.quantity) || 0) * (Number(item.unitPrice) || 0);
      doc.font(FONTS.normal, 9)
        .fill(COLORS.darkGray)
        .text(item.description, 50, yPos, { width: 300 });

      doc.font(FONTS.mono, 9)
        .fill(COLORS.darkGray)
        .text(`$${totalPrice.toFixed(2)}`, 400, yPos, { align: "right" });
      yPos += 12;

      if (yPos > 700) {
        doc.addPage();
        yPos = 40;
      }
    }

    // Subtotal
    doc.font(FONTS.bold, 10)
      .fill(COLORS.gold)
      .text(`Subtotal: $${cat.subtotal.toFixed(2)}`, 50, yPos);
    yPos += 14;
  }

  // Totals box — expanded with full settlement breakdown
  yPos += 10;
  const boxHeight = data.estimate.netClaim != null ? 160 : 80;
  doc.rect(40, yPos, doc.page.width - 80, boxHeight).fill(COLORS.lightGray);

  // RCV
  doc.font(FONTS.normal, 10).fill(COLORS.darkGray)
    .text("RCV (Replacement Cost Value):", 50, yPos + 10);
  doc.font(FONTS.bold, 12).fill(COLORS.deep)
    .text(`$${data.estimate.totalRCV.toFixed(2)}`, 400, yPos + 10, { align: "right" });

  // O&P (if applicable)
  let lineY = yPos + 26;
  if (data.estimate.qualifiesForOP && data.estimate.overheadAmount) {
    doc.font(FONTS.normal, 9).fill(COLORS.darkGray)
      .text(`  Includes O&P: $${(data.estimate.overheadAmount + (data.estimate.profitAmount || 0)).toFixed(2)} (OH: $${data.estimate.overheadAmount.toFixed(2)} + Profit: $${(data.estimate.profitAmount || 0).toFixed(2)})`, 50, lineY);
    lineY += 14;
  }

  // Depreciation breakdown
  doc.font(FONTS.normal, 10).fill(COLORS.darkGray)
    .text("Total Depreciation:", 50, lineY);
  doc.font(FONTS.bold, 12).fill(COLORS.deep)
    .text(`-$${data.estimate.totalDepreciation.toFixed(2)}`, 400, lineY, { align: "right" });
  lineY += 16;

  if (data.estimate.recoverableDepreciation != null) {
    doc.font(FONTS.normal, 9).fill(COLORS.darkGray)
      .text(`  Recoverable (holdback): ($${data.estimate.recoverableDepreciation.toFixed(2)})`, 50, lineY);
    lineY += 12;
    doc.font(FONTS.normal, 9).fill(COLORS.darkGray)
      .text(`  Non-Recoverable: <$${(data.estimate.nonRecoverableDepreciation || 0).toFixed(2)}>`, 50, lineY);
    lineY += 14;
  }

  // ACV
  doc.font(FONTS.bold, 11).fill(COLORS.primary)
    .text("ACV (Actual Cash Value):", 50, lineY);
  doc.font(FONTS.bold, 14).fill(COLORS.gold)
    .text(`$${data.estimate.totalACV.toFixed(2)}`, 400, lineY, { align: "right" });
  lineY += 18;

  // Deductible and Net Claim
  if (data.estimate.deductible != null) {
    doc.font(FONTS.normal, 10).fill(COLORS.darkGray)
      .text("Less Deductible:", 50, lineY);
    doc.font(FONTS.bold, 12).fill(COLORS.deep)
      .text(`-$${data.estimate.deductible.toFixed(2)}`, 400, lineY, { align: "right" });
    lineY += 16;
  }

  if (data.estimate.netClaim != null) {
    doc.moveTo(50, lineY).lineTo(doc.page.width - 50, lineY).stroke(COLORS.gold);
    lineY += 6;
    doc.font(FONTS.bold, 12).fill(COLORS.primary)
      .text("NET CLAIM (Check Amount):", 50, lineY);
    doc.font(FONTS.bold, 16).fill(COLORS.gold)
      .text(`$${data.estimate.netClaim.toFixed(2)}`, 400, lineY, { align: "right" });
  }
}

function renderPhotoAppendix(doc: InstanceType<typeof PDFDocument>, photos: InspectionPhoto[]) {
  doc.font(FONTS.bold, 16).fill(COLORS.deep).text("Photo Appendix", 40, 40);
  doc.moveTo(40, 62).lineTo(doc.page.width - 40, 62).stroke(COLORS.primary);

  let yPos = 80;

  for (const photo of photos) {
    doc.font(FONTS.bold, 10)
      .fill(COLORS.primary)
      .text(photo.caption || "Photo", 40, yPos);
    yPos += 14;

    const analysis = photo.analysis as any;
    if (analysis?.description) {
      doc.font(FONTS.normal, 8)
        .fill(COLORS.darkGray)
        .text(analysis.description, 40, yPos, { width: 480 });
      yPos += 20;
    }

    if (photo.photoType) {
      doc.font(FONTS.normal, 8)
        .fill("#9CA3AF")
        .text(`Type: ${photo.photoType.replace(/_/g, " ")}`, 40, yPos);
      yPos += 10;
    }

    yPos += 4;

    if (yPos > 700) {
      doc.addPage();
      yPos = 40;
    }
  }
}

function renderMoistureReport(doc: InstanceType<typeof PDFDocument>, readings: MoistureReading[]) {
  doc.font(FONTS.bold, 16).fill(COLORS.deep).text("Moisture Report", 40, 40);
  doc.moveTo(40, 62).lineTo(doc.page.width - 40, 62).stroke(COLORS.primary);

  let yPos = 85;

  // Table header
  doc.rect(40, yPos - 5, doc.page.width - 80, 20).fill(COLORS.lightGray);
  doc.font(FONTS.bold, 9).fill(COLORS.deep).text("Location", 50, yPos);
  doc.text("Material", 200, yPos);
  doc.text("Reading", 350, yPos);
  doc.text("Dry Std", 450, yPos);

  yPos += 24;

  for (const reading of readings) {
    doc.rect(40, yPos - 2, doc.page.width - 80, 16).stroke(COLORS.primary);
    doc.font(FONTS.normal, 8)
      .fill(COLORS.darkGray)
      .text(reading.location || "—", 50, yPos);
    doc.text(reading.materialType || "—", 200, yPos);
    doc.text(`${reading.reading}%`, 350, yPos);
    doc.text(`${reading.dryStandard || "—"}%`, 450, yPos);

    yPos += 18;

    if (yPos > 700) {
      doc.addPage();
      yPos = 40;
    }
  }
}

function renderInfoRow(doc: InstanceType<typeof PDFDocument>, yPos: number, label: string, value: string) {
  doc.font(FONTS.bold, 10).fill(COLORS.primary).text(label, 40, yPos);
  doc.font(FONTS.normal, 10).fill(COLORS.darkGray).text(value, 150, yPos);
}
