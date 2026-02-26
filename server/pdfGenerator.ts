import PDFDocument from "pdfkit";
import { InspectionSession, InspectionRoom, DamageObservation, LineItem, InspectionPhoto } from "../shared/schema";
import { Claim, MoistureReading } from "../shared/schema";

interface RoomEstimateItem {
  lineNumber: number;
  description: string;
  category: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  totalPrice: number;
  taxAmount: number;
  depreciationAmount: number;
  depreciationType: string;
  depreciationPercentage: number;
  acv: number;
  age: number | null;
  lifeExpectancy: number | null;
  action: string | null;
  provenance: string | null;
}

interface RoomOpeningData {
  openingType: string;
  widthFt: number;
  heightFt: number;
  opensInto: string;
  goesToFloor: boolean;
  quantity: number;
  label: string;
}

interface RoomEstimate {
  id: number;
  name: string;
  structure: string;
  items: RoomEstimateItem[];
  subtotal: number;
  totalTax: number;
  totalDepreciation: number;
  totalRecoverableDepreciation: number;
  totalNonRecoverableDepreciation: number;
  totalACV: number;
  dimensions?: { length: number; width: number; height: number };
  viewType?: string;
  openings?: RoomOpeningData[];
}

interface CategoryRecapEntry {
  category: string;
  itemCount: number;
  rcv: number;
  depreciation: number;
  acv: number;
  isOP?: boolean;
}

interface RoomEstimateData {
  rooms: RoomEstimate[];
  grandTotal: number;
  grandTax: number;
  grandDepreciation: number;
  grandRecoverableDepreciation: number;
  grandNonRecoverableDepreciation: number;
  grandACV: number;
  totalLineItems: number;
  categoryRecap?: CategoryRecapEntry[];
}

interface BriefingData {
  coverageSnapshot: {
    coverageA: number;
    coverageB: number;
    coverageC: number;
    coverageD: number;
    deductible: number;
    policyNumber: string;
  };
  propertyProfile: {
    yearBuilt: number;
  };
}

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
  roomEstimate?: RoomEstimateData;
  briefing?: BriefingData;
}

const MARGIN = 40;
const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const BOTTOM_MARGIN = 60;

const COLORS = {
  black: "#000000",
  darkGray: "#333333",
  medGray: "#666666",
  lightGray: "#999999",
  headerBg: "#E8E8E8",
  lineBg: "#F5F5F5",
  white: "#FFFFFF",
  ruleLine: "#CCCCCC",
};

const FONTS = {
  normal: "Helvetica",
  bold: "Helvetica-Bold",
  mono: "Courier",
};

function fmt(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtParen(n: number): string {
  return `(${fmt(Math.abs(n))})`;
}

function fmtAngle(n: number): string {
  return `<${fmt(Math.abs(n))}>`;
}

function fmtDeprecAmount(amount: number, type: string): string {
  if (Math.abs(amount) < 0.005) return "0.00";
  const t = type.toLowerCase();
  if (t === "non-recoverable" || t === "non_recoverable") {
    return fmtAngle(amount);
  }
  return fmtParen(amount);
}

function fmtAgeLife(age: number | null, life: number | null): string {
  const a = age != null ? age : 0;
  if (life == null || life <= 0) return `${a}/NA`;
  return `${a}/${life} yrs`;
}

function fmtDepPercent(pct: number, type: string): string {
  if (pct <= 0) return "0%";
  const pctStr = Number.isInteger(pct) ? `${pct}%` : `${pct.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")}%`;
  const t = type.toLowerCase();
  if (t === "non-recoverable" || t === "non_recoverable") {
    return `${pctStr} [%]`;
  }
  return pctStr;
}

type Doc = InstanceType<typeof PDFDocument>;

let pageNumber = 0;
let currentDate = "";

function addFooter(doc: Doc) {
  pageNumber++;
  doc.font(FONTS.normal, 8).fill(COLORS.lightGray);
  doc.text(currentDate, MARGIN, PAGE_HEIGHT - 30, { width: CONTENT_WIDTH / 2, align: "left", lineBreak: false });
  doc.text(`Page: ${pageNumber}`, MARGIN + CONTENT_WIDTH / 2, PAGE_HEIGHT - 30, { width: CONTENT_WIDTH / 2, align: "right", lineBreak: false });
}

function newPage(doc: Doc) {
  doc.addPage({ margins: { top: MARGIN, bottom: 0, left: MARGIN, right: MARGIN } });
  addFooter(doc);
}

function checkPageBreak(doc: Doc, yNeeded: number, currentY: number): number {
  if (currentY + yNeeded > PAGE_HEIGHT - BOTTOM_MARGIN) {
    newPage(doc);
    return MARGIN;
  }
  return currentY;
}

function drawHLine(doc: Doc, y: number, x1: number = MARGIN, x2: number = PAGE_WIDTH - MARGIN) {
  doc.moveTo(x1, y).lineTo(x2, y).lineWidth(0.5).stroke(COLORS.ruleLine);
}

function drawThickLine(doc: Doc, y: number) {
  doc.moveTo(MARGIN, y).lineTo(PAGE_WIDTH - MARGIN, y).lineWidth(1.5).stroke(COLORS.black);
}

export async function generateInspectionPDF(data: PDFReportData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "letter",
      margins: { top: MARGIN, bottom: 0, left: MARGIN, right: MARGIN },
    });
    const chunks: Buffer[] = [];

    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    pageNumber = 0;
    const now = new Date();
    currentDate = `${now.getMonth() + 1}/${now.getDate()}/${now.getFullYear()}`;

    const re = data.roomEstimate;
    const br = data.briefing;

    if (re) {
      renderCoverageSummaryPage(doc, data, re, br);
      newPage(doc);
      renderClaimInfoPage(doc, data, br);
      newPage(doc);
      renderEstimateRecapPage(doc, data, re);
      renderLineItemPages(doc, data, re);
      renderGrandTotalAreasPage(doc, re);
      renderSettlementSummaryPage(doc, data, re);
      renderRecapOfTaxesAndOP(doc, data, re);
      renderRecapByRoom(doc, data, re);
      renderRecapByCategory(doc, data, re);
    } else {
      renderLegacyCoverPage(doc, data);
      addFooter(doc);
      newPage(doc);
      renderLegacyEstimate(doc, data);
    }

    if (data.claim?.perilType?.toLowerCase().includes("water") && data.moistureReadings.length > 0) {
      newPage(doc);
      renderMoistureReport(doc, data.moistureReadings);
    }

    if (data.transcript && data.transcript.length > 0) {
      newPage(doc);
      renderTranscript(doc, data.transcript);
    }

    if (data.photos && data.photos.length > 0) {
      newPage(doc);
      renderPhotoAppendix(doc, data.photos);
    }

    doc.end();
  });
}

function renderCoverageSummaryPage(doc: Doc, data: PDFReportData, re: RoomEstimateData, br?: BriefingData) {
  addFooter(doc);

  const claim = data.claim;
  let y = MARGIN;

  doc.font(FONTS.normal, 9).fill(COLORS.black);
  doc.text(currentDate, MARGIN, y, { width: CONTENT_WIDTH, align: "left" });
  y += 16;

  const insuredName = claim?.insuredName || "Insured";
  const address = claim?.propertyAddress || "";
  const cityStateZip = [claim?.city, claim?.state, claim?.zip].filter(Boolean).join(", ");
  const claimNumber = claim?.claimNumber || br?.coverageSnapshot?.policyNumber || "N/A";
  const dateOfLoss = claim?.dateOfLoss || "N/A";

  doc.font(FONTS.bold, 10).fill(COLORS.black).text(insuredName, MARGIN, y);
  y += 12;
  if (address) {
    doc.font(FONTS.normal, 9).text(address, MARGIN, y);
    y += 11;
  }
  if (cityStateZip) {
    doc.font(FONTS.normal, 9).text(cityStateZip, MARGIN, y);
    y += 11;
  }

  const rightCol = 380;
  doc.font(FONTS.normal, 9).fill(COLORS.black);
  doc.text("Claim Number:", rightCol, y - 34);
  doc.font(FONTS.bold, 9).text(claimNumber, rightCol + 85, y - 34);
  doc.font(FONTS.normal, 9).text("Date of Loss:", rightCol, y - 22);
  doc.text(dateOfLoss, rightCol + 85, y - 22);

  y += 14;
  drawThickLine(doc, y);
  y += 10;

  doc.font(FONTS.bold, 12).fill(COLORS.black);
  doc.text("Summary For Coverage A - Dwelling", MARGIN, y, { width: CONTENT_WIDTH, align: "center" });
  y += 20;

  const col1 = MARGIN;
  const col2 = MARGIN + 140;
  const col3 = MARGIN + 280;
  const col4 = MARGIN + 400;

  doc.font(FONTS.bold, 7).fill(COLORS.medGray);
  doc.text("Replacement Cost Value", col1, y, { width: 130, align: "center" });
  doc.text("Less Recoverable\nDepreciation", col2, y, { width: 130, align: "center" });
  doc.text("Less Non Recoverable\nDepreciation", col3, y, { width: 110, align: "center" });
  doc.text("Actual Cash Value (ACV)", col4, y, { width: 130, align: "center" });
  y += 22;
  drawHLine(doc, y);
  y += 5;

  const rcv = re.grandTotal + re.grandTax;
  const recDep = re.grandRecoverableDepreciation;
  const nonRecDep = re.grandNonRecoverableDepreciation;
  const acv = rcv - re.grandDepreciation;
  const deductible = br?.coverageSnapshot?.deductible ?? data.estimate.deductible ?? 0;

  doc.font(FONTS.bold, 10).fill(COLORS.black);
  doc.text(`$${fmt(rcv)}`, col1, y, { width: 130, align: "center" });
  doc.text(fmtParen(recDep), col2, y, { width: 130, align: "center" });
  doc.text(fmtAngle(nonRecDep), col3, y, { width: 110, align: "center" });
  doc.text(`$${fmt(acv)}`, col4, y, { width: 130, align: "center" });
  y += 16;

  doc.font(FONTS.normal, 9).fill(COLORS.black);
  doc.text("Less Deductible", col1, y);
  doc.text(fmtParen(deductible), col4, y, { width: 130, align: "center" });
  y += 13;

  doc.font(FONTS.bold, 10).fill(COLORS.black);
  doc.text("Total ACV Settlement", col1, y);
  const settlement = Math.max(0, acv - deductible);
  doc.text(`$${fmt(settlement)}`, col4, y, { width: 130, align: "center" });
  y += 18;
  drawThickLine(doc, y);
  y += 12;

  doc.font(FONTS.bold, 10).fill(COLORS.black);
  doc.text("Understanding Your Property Estimate", MARGIN, y, { width: CONTENT_WIDTH, align: "center" });
  y += 14;

  doc.font(FONTS.bold, 7).fill(COLORS.medGray);
  const uomY = y;
  const uomCol = 100;
  const units = [
    ["HR", "Hour"], ["LF", "Linear Foot"], ["EA", "Each"], ["SQ", "Square"], ["SF", "Square Foot"],
    ["SY", "Square Yard"], ["DA", "Day"], ["CY", "Cubic Yard"], ["CF", "Cubic Foot"], ["RM", "Room"],
  ];
  doc.font(FONTS.normal, 7).fill(COLORS.medGray);
  doc.text("Unit of Measure", MARGIN, uomY, { width: CONTENT_WIDTH, align: "center" });
  y += 11;
  let ux = MARGIN + 20;
  for (let i = 0; i < units.length; i++) {
    if (i === 5) { y += 10; ux = MARGIN + 20; }
    doc.font(FONTS.bold, 6.5).text(`${units[i][0]}`, ux, y, { continued: true });
    doc.font(FONTS.normal, 6.5).text(` – ${units[i][1]}`, { continued: false });
    ux += uomCol;
  }

  y += 16;
  doc.font(FONTS.bold, 10).fill(COLORS.black);
  doc.text("Estimate: Property Damage Repair", MARGIN, y, { width: CONTENT_WIDTH, align: "center" });
}

function renderClaimInfoPage(doc: Doc, data: PDFReportData, br?: BriefingData) {
  const claim = data.claim;
  let y = MARGIN;

  const insuredName = claim?.insuredName || "Insured";
  const address = claim?.propertyAddress || "";
  const cityStateZip = [claim?.city, claim?.state, claim?.zip].filter(Boolean).join(", ");
  const phone = (claim as any)?.phone || "";
  const cellPhone = (claim as any)?.cellPhone || phone || "";
  const email = (claim as any)?.email || "";
  const businessPhone = (claim as any)?.businessPhone || "";

  doc.font(FONTS.bold, 9).fill(COLORS.black).text("Insured:", MARGIN, y);
  doc.font(FONTS.normal, 9).text(insuredName, MARGIN + 75, y);

  const rightContactX = 380;
  doc.font(FONTS.bold, 8).fill(COLORS.black).text("Cell:", rightContactX, y);
  doc.font(FONTS.normal, 8).text(cellPhone || "N/A", rightContactX + 85, y);
  y += 11;

  if (address) {
    doc.font(FONTS.normal, 9).fill(COLORS.black).text(address, MARGIN + 75, y);
    doc.font(FONTS.bold, 8).text("E-mail:", rightContactX, y);
    doc.font(FONTS.normal, 8).text(email || "N/A", rightContactX + 85, y);
    y += 11;
  }
  if (cityStateZip) {
    doc.font(FONTS.normal, 9).fill(COLORS.black).text(cityStateZip, MARGIN + 75, y);
    doc.font(FONTS.bold, 8).text("Business Phone:", rightContactX, y);
    doc.font(FONTS.normal, 8).text(businessPhone || "N/A", rightContactX + 85, y);
    y += 11;
  }

  y += 6;
  doc.font(FONTS.bold, 9).fill(COLORS.black).text("Claim Rep.:", MARGIN, y);
  doc.font(FONTS.normal, 9).text(data.inspectorName || "Inspector", MARGIN + 75, y);
  y += 11;
  doc.font(FONTS.bold, 9).text("Estimator:", MARGIN, y);
  doc.font(FONTS.normal, 9).text(data.inspectorName || "Inspector", MARGIN + 75, y);
  y += 11;
  doc.font(FONTS.bold, 9).text("Estimator Company:", MARGIN, y);
  doc.font(FONTS.normal, 9).text(data.companyName || "N/A", MARGIN + 115, y);
  y += 11;
  doc.font(FONTS.bold, 9).text("Reference Company:", MARGIN, y);
  doc.font(FONTS.normal, 9).text(data.companyName || "N/A", MARGIN + 115, y);
  y += 11;

  if (data.adjusterLicense) {
    doc.font(FONTS.bold, 9).text("Adjuster License #:", MARGIN, y);
    doc.font(FONTS.normal, 9).text(data.adjusterLicense, MARGIN + 115, y);
    y += 11;
  }

  y += 6;
  drawHLine(doc, y);
  y += 6;

  const claimNum = claim?.claimNumber || "N/A";
  const policyNum = br?.coverageSnapshot?.policyNumber || "N/A";
  const lossType = claim?.perilType || "N/A";

  doc.font(FONTS.bold, 8).fill(COLORS.black);
  doc.text("Claim Number:", MARGIN, y);
  doc.font(FONTS.bold, 8).text(claimNum, MARGIN + 85, y);
  doc.font(FONTS.bold, 8).text("Policy Number:", 230, y);
  doc.font(FONTS.bold, 8).text(policyNum, 320, y);
  doc.font(FONTS.bold, 8).text("Type of Loss:", 430, y);
  doc.font(FONTS.bold, 8).text(lossType, 510, y);
  y += 14;

  function extractLimit(val: unknown): number {
    if (val == null) return 0;
    if (typeof val === "number") return val;
    if (typeof val === "object" && val !== null && "limit" in val) return Number((val as any).limit) || 0;
    return Number(val) || 0;
  }
  const covA = extractLimit(br?.coverageSnapshot?.coverageA);
  const covB = extractLimit(br?.coverageSnapshot?.coverageB);
  const covC = extractLimit(br?.coverageSnapshot?.coverageC);
  const covD = extractLimit(br?.coverageSnapshot?.coverageD);
  const ded = Number(br?.coverageSnapshot?.deductible) || data.estimate.deductible || 0;

  doc.rect(MARGIN, y, CONTENT_WIDTH, 12).fill(COLORS.headerBg);
  doc.font(FONTS.bold, 7).fill(COLORS.black);
  doc.text("Coverage", MARGIN + 5, y + 3, { width: 250 });
  doc.text("Deductible", 350, y + 3, { width: 90, align: "right" });
  doc.text("Policy Limit", 450, y + 3, { width: 90, align: "right" });
  y += 14;

  const coverageRows = [
    ["Coverage A - Dwelling", ded, covA],
    ["Coverage B - Other Structures Blanket", 0, covB],
    ["Coverage C - Personal Property", 0, covC],
    ["Coverage D - Loss Of Use", 0, covD],
  ];

  for (const [name, d, limit] of coverageRows) {
    doc.font(FONTS.normal, 7.5).fill(COLORS.black);
    doc.text(name as string, MARGIN + 5, y, { width: 300 });
    doc.text(`$${fmt(d as number)}`, 350, y, { width: 90, align: "right" });
    doc.text(`$${fmt(limit as number)}`, 450, y, { width: 90, align: "right" });
    y += 11;
  }

  y += 6;
  drawHLine(doc, y);
  y += 6;

  const dateOfLoss = claim?.dateOfLoss || "N/A";
  const dateCompleted = currentDate;
  const dateContacted = (claim as any)?.dateContacted || "N/A";
  const dateInspected = (claim as any)?.dateInspected || currentDate;
  const dateReceived = (claim as any)?.dateReceived || "N/A";
  const dateEntered = (claim as any)?.dateEntered || "N/A";

  const datesLeftX = MARGIN;
  const datesRightX = PAGE_WIDTH / 2 + 20;
  const datesLabelW = 120;

  doc.font(FONTS.bold, 8).fill(COLORS.black).text("Date Contacted:", datesLeftX, y);
  doc.font(FONTS.normal, 8).text(dateContacted, datesLeftX + datesLabelW, y);
  doc.font(FONTS.bold, 8).text("Date Received:", datesRightX, y);
  doc.font(FONTS.normal, 8).text(dateReceived, datesRightX + datesLabelW, y);
  y += 11;

  doc.font(FONTS.bold, 8).text("Date of Loss:", datesLeftX, y);
  doc.font(FONTS.normal, 8).text(dateOfLoss, datesLeftX + datesLabelW, y);
  doc.font(FONTS.bold, 8).text("Date Entered:", datesRightX, y);
  doc.font(FONTS.normal, 8).text(dateEntered, datesRightX + datesLabelW, y);
  y += 11;

  doc.font(FONTS.bold, 8).text("Date Inspected:", datesLeftX, y);
  doc.font(FONTS.normal, 8).text(dateInspected, datesLeftX + datesLabelW, y);
  y += 11;

  doc.font(FONTS.bold, 8).text("Date Est. Completed:", datesLeftX, y);
  doc.font(FONTS.normal, 8).text(dateCompleted, datesLeftX + datesLabelW, y);
  y += 14;

  drawHLine(doc, y);
  y += 6;

  doc.font(FONTS.bold, 8).fill(COLORS.black).text("Price List:", MARGIN, y);
  doc.font(FONTS.normal, 8).text("CLAIMS_IQ_CURRENT", MARGIN + 110, y);
  y += 12;

  doc.font(FONTS.bold, 8).text("Sales Taxes:", MARGIN, y);
  doc.font(FONTS.normal, 8).text("Material Sales Tax", MARGIN + 110, y);
  y += 10;
}

function renderEstimateRecapPage(doc: Doc, data: PDFReportData, re: RoomEstimateData) {
  let y = MARGIN;

  doc.font(FONTS.bold, 11).fill(COLORS.black);
  doc.text("Estimate Recap For Coverage A - Dwelling", MARGIN, y, { width: CONTENT_WIDTH, align: "center" });
  y += 18;

  const descX = MARGIN;
  const rcvX = 290;
  const recDepX = 365;
  const nonRecDepX = 430;
  const acvX = PAGE_WIDTH - MARGIN - 60;

  doc.rect(MARGIN, y, CONTENT_WIDTH, 12).fill(COLORS.headerBg);
  doc.font(FONTS.bold, 6.5).fill(COLORS.black);
  doc.text("Description", descX + 5, y + 3, { width: 240 });
  doc.text("RCV", rcvX, y + 3, { width: 65, align: "right" });
  doc.text("Recoverable\nDepreciation", recDepX, y + 1, { width: 60, align: "right" });
  doc.text("Non-recoverable\nDepreciation", nonRecDepX, y + 1, { width: 70, align: "right" });
  doc.text("ACV", acvX, y + 3, { width: 60, align: "right" });
  y += 14;
  drawHLine(doc, y);
  y += 4;

  const structureGroups: Record<string, RoomEstimate[]> = {};
  for (const room of re.rooms) {
    const key = room.structure || "Dwelling";
    if (!structureGroups[key]) structureGroups[key] = [];
    structureGroups[key].push(room);
  }

  for (const [structure, rooms] of Object.entries(structureGroups)) {
    for (const room of rooms) {
      if (room.items.length === 0) continue;
      y = checkPageBreak(doc, 14, y);
      const rcvVal = room.subtotal + room.totalTax;
      doc.font(FONTS.normal, 7.5).fill(COLORS.black);
      doc.text(`${structure} - ${room.name}`, descX + 5, y, { width: 240 });
      doc.text(fmt(rcvVal), rcvX, y, { width: 65, align: "right" });
      doc.text(fmt(room.totalRecoverableDepreciation), recDepX, y, { width: 60, align: "right" });
      doc.text(fmt(room.totalNonRecoverableDepreciation), nonRecDepX, y, { width: 70, align: "right" });
      const roomAcvCorrected = rcvVal - room.totalDepreciation;
      doc.text(fmt(roomAcvCorrected), acvX, y, { width: 60, align: "right" });
      y += 11;
    }
  }

  y += 6;
  drawThickLine(doc, y);
  y += 6;

  const totalRCV = re.grandTotal + re.grandTax;
  const totalACV = totalRCV - re.grandDepreciation;
  doc.font(FONTS.bold, 9).fill(COLORS.black);
  doc.text("Total", descX + 5, y, { width: 240 });
  doc.text(fmt(totalRCV), rcvX, y, { width: 65, align: "right" });
  doc.text(fmt(re.grandRecoverableDepreciation), recDepX, y, { width: 60, align: "right" });
  doc.text(fmt(re.grandNonRecoverableDepreciation), nonRecDepX, y, { width: 70, align: "right" });
  doc.text(fmt(totalACV), acvX, y, { width: 60, align: "right" });
}

function renderRoomDimensionsBlock(doc: Doc, y: number, room: RoomEstimate): number {
  const dims = room.dimensions;
  if (!dims || (dims.length === 0 && dims.width === 0)) return y;

  const openingCount = room.openings?.length || 0;
  const estimatedHeight = 72 + openingCount * 9;
  y = checkPageBreak(doc, estimatedHeight, y);

  const L = dims.length;
  const W = dims.width;
  const H = dims.height || 8;
  const isRoof = (room.viewType || "").includes("roof");

  const sketchW = 80;
  const sketchH = 55;
  const sketchX = MARGIN;
  const sketchY = y;

  doc.save();
  doc.rect(sketchX, sketchY, sketchW, sketchH).lineWidth(0.75).stroke(COLORS.black);
  doc.font(FONTS.normal, 6.5).fill(COLORS.medGray);
  doc.text(`${L.toFixed(1)}'`, sketchX + sketchW / 2 - 10, sketchY + sketchH + 1);
  doc.text(`${W.toFixed(1)}'`, sketchX + sketchW + 3, sketchY + sketchH / 2 - 4);
  doc.restore();

  const dimX = sketchX + sketchW + 20;
  const dimLabelW = 120;
  const dimValW = 80;
  let dy = sketchY;

  doc.font(FONTS.bold, 8).fill(COLORS.black);

  if (isRoof) {
    const surfaceArea = L * W;
    const squares = surfaceArea / 100;
    const perim = 2 * (L + W);
    const dimRows = [
      ["Surface Area", `${fmt(surfaceArea)} SF`],
      ["Number of Squares", `${squares.toFixed(2)} SQ`],
      ["Total Perimeter Length", `${fmt(perim)} LF`],
    ];
    for (const [label, val] of dimRows) {
      doc.font(FONTS.normal, 7).fill(COLORS.darkGray);
      doc.text(label, dimX, dy, { width: dimLabelW });
      doc.text(val, dimX + dimLabelW, dy, { width: dimValW, align: "right" });
      dy += 9;
    }
  } else {
    const sfWalls = 2 * (L + W) * H;
    const sfCeiling = L * W;
    const sfFloor = L * W;
    const syFlooring = sfFloor / 9;
    const lfFloorPerim = 2 * (L + W);
    const lfCeilPerim = 2 * (L + W);
    const dimRows = [
      ["SF Walls", `${fmt(sfWalls)} SF`],
      ["SF Ceiling", `${fmt(sfCeiling)} SF`],
      ["SF Walls & Ceiling", `${fmt(sfWalls + sfCeiling)} SF`],
      ["SF Floor", `${fmt(sfFloor)} SF`],
      ["SY Flooring", `${syFlooring.toFixed(2)} SY`],
      ["LF Floor Perimeter", `${fmt(lfFloorPerim)} LF`],
      ["LF Ceil. Perimeter", `${fmt(lfCeilPerim)} LF`],
    ];
    for (const [label, val] of dimRows) {
      doc.font(FONTS.normal, 7).fill(COLORS.darkGray);
      doc.text(label, dimX, dy, { width: dimLabelW });
      doc.text(val, dimX + dimLabelW, dy, { width: dimValW, align: "right" });
      dy += 8;
    }
  }

  y = Math.max(sketchY + sketchH + 8, dy + 2);

  if (room.openings && room.openings.length > 0) {
    doc.font(FONTS.bold, 7).fill(COLORS.black);
    doc.text("Openings:", MARGIN, y);
    y += 8;
    for (const op of room.openings) {
      const wFeet = Math.floor(op.widthFt);
      const wInches = Math.round((op.widthFt - wFeet) * 12);
      const hFeet = Math.floor(op.heightFt);
      const hInches = Math.round((op.heightFt - hFeet) * 12);
      const label = op.label || op.openingType.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
      const sizeStr = `${wFeet}' ${wInches}" X ${hFeet}' ${hInches}"`;
      const openStr = op.opensInto ? `Opens into ${op.opensInto}` : "";
      doc.font(FONTS.normal, 6.5).fill(COLORS.darkGray);
      doc.text(`${label} ${sizeStr} ${openStr}`, MARGIN + 10, y, { width: CONTENT_WIDTH - 20 });
      y += 8;
    }
  }

  y += 3;
  drawHLine(doc, y);
  y += 3;
  return y;
}

function renderLineItemPages(doc: Doc, data: PDFReportData, re: RoomEstimateData) {
  newPage(doc);
  let y = MARGIN;

  for (let ri = 0; ri < re.rooms.length; ri++) {
    const room = re.rooms[ri];
    if (room.items.length === 0) continue;

    const roomHeaderHeight = 14 + (room.dimensions && (room.dimensions.length > 0 || room.dimensions.width > 0) ? 70 : 0) + 14 + 22;
    y = checkPageBreak(doc, roomHeaderHeight, y);
    if (y === MARGIN && ri > 0) {
    } else if (ri > 0) {
      y += 4;
      drawHLine(doc, y);
      y += 6;
    }

    doc.font(FONTS.bold, 10).fill(COLORS.black);
    doc.text(room.name, MARGIN, y, { width: CONTENT_WIDTH, align: "center", lineBreak: false });
    y += 14;

    y = renderRoomDimensionsBlock(doc, y, room);

    y = drawLineItemHeader(doc, y);

    for (const item of room.items) {
      y = checkPageBreak(doc, 22, y);
      if (y === MARGIN) {
        doc.font(FONTS.bold, 9).fill(COLORS.black);
        doc.text(`CONTINUED - ${room.name}`, MARGIN, y, { width: CONTENT_WIDTH, align: "center", lineBreak: false });
        y += 12;
        y = drawLineItemHeader(doc, y);
      }
      y = drawLineItem(doc, y, item);
    }

    y += 3;
    drawHLine(doc, y);
    y += 3;

    const roomRCV = room.subtotal + room.totalTax;
    const roomACVCorrected = roomRCV - room.totalDepreciation;
    doc.font(FONTS.bold, 7).fill(COLORS.black);
    doc.text(`Totals: ${room.name}`, MARGIN + 5, y, { width: 150, lineBreak: false });
    doc.text(fmt(room.totalTax), COL.taxX, y, { width: COL.taxW, align: "right", lineBreak: false });
    doc.text(fmt(roomRCV), COL.rcvX, y, { width: COL.rcvW, align: "right", lineBreak: false });
    doc.text(fmt(room.totalDepreciation), COL.deprecX, y, { width: COL.deprecW, align: "right", lineBreak: false });
    doc.text(fmt(roomACVCorrected), COL.acvX, y, { width: COL.acvW, align: "right", lineBreak: false });
    y += 12;
  }

  y = checkPageBreak(doc, 30, y);
  y += 2;

  drawThickLine(doc, y);
  y += 4;

  const totalRCV = re.grandTotal + re.grandTax;
  const totalACV = totalRCV - re.grandDepreciation;
  doc.font(FONTS.bold, 8).fill(COLORS.black);
  doc.text("Line Item Totals:", MARGIN + 5, y, { width: 180, lineBreak: false });
  doc.text(fmt(re.grandTax), COL.taxX, y, { width: COL.taxW, align: "right", lineBreak: false });
  doc.text(fmt(totalRCV), COL.rcvX, y, { width: COL.rcvW, align: "right", lineBreak: false });
  doc.text(fmt(re.grandDepreciation), COL.deprecX, y, { width: COL.deprecW, align: "right", lineBreak: false });
  doc.text(fmt(totalACV), COL.acvX, y, { width: COL.acvW, align: "right", lineBreak: false });
  y += 12;

  doc.font(FONTS.normal, 6.5).fill(COLORS.medGray);
  doc.text("[%] - Indicates that depreciate by percent was used for this item", MARGIN, y, { lineBreak: false });
}

const COL = {
  qtyX: MARGIN,
  qtyW: 140,
  taxX: 185,
  taxW: 45,
  rcvX: 235,
  rcvW: 60,
  ageX: 300,
  ageW: 50,
  condX: 355,
  condW: 30,
  depPctX: 385,
  depPctW: 40,
  deprecX: 425,
  deprecW: 55,
  acvX: PAGE_WIDTH - MARGIN - 55,
  acvW: 55,
};

function drawLineItemHeader(doc: Doc, y: number): number {
  doc.rect(MARGIN, y, CONTENT_WIDTH, 11).fill(COLORS.headerBg);
  doc.font(FONTS.bold, 5.5).fill(COLORS.black);
  doc.text("QUANTITY / UNIT PRICE", COL.qtyX + 5, y + 3, { width: COL.qtyW, lineBreak: false });
  doc.text("TAX", COL.taxX, y + 3, { width: COL.taxW, align: "right", lineBreak: false });
  doc.text("RCV", COL.rcvX, y + 3, { width: COL.rcvW, align: "right", lineBreak: false });
  doc.text("AGE/LIFE", COL.ageX, y + 3, { width: COL.ageW, align: "right", lineBreak: false });
  doc.text("COND.", COL.condX, y + 3, { width: COL.condW, align: "right", lineBreak: false });
  doc.text("DEP %", COL.depPctX, y + 3, { width: COL.depPctW, align: "right", lineBreak: false });
  doc.text("DEPREC.", COL.deprecX, y + 3, { width: COL.deprecW, align: "right", lineBreak: false });
  doc.text("ACV", COL.acvX, y + 3, { width: COL.acvW, align: "right", lineBreak: false });
  return y + 13;
}

function drawLineItem(doc: Doc, y: number, item: RoomEstimateItem): number {
  const qty = Number(item.quantity) || 0;
  const unitPrice = Number(item.unitPrice) || 0;
  const rcv = Number(item.totalPrice) || 0;
  const tax = Number(item.taxAmount) || 0;
  const depAmt = Number(item.depreciationAmount) || 0;
  const depPct = Number(item.depreciationPercentage) || 0;
  const depType = item.depreciationType || "recoverable";
  const unitLabel = item.unit || "EA";
  const itemRCV = rcv + tax;
  const itemACV = itemRCV - depAmt;

  doc.font(FONTS.normal, 7).fill(COLORS.black);
  const descText = `${item.lineNumber}. ${item.description}`;
  const descW = CONTENT_WIDTH - 10;
  const descHeight = doc.heightOfString(descText, { width: descW });
  doc.text(descText, MARGIN + 5, y, { width: descW, height: descHeight + 2, ellipsis: false });
  y += Math.max(9, Math.ceil(descHeight) + 1);

  doc.font(FONTS.normal, 6.5).fill(COLORS.darkGray);
  const qtyLine = `${qty.toFixed(2)} ${unitLabel} @ ${fmt(unitPrice)}`;
  doc.text(qtyLine, COL.qtyX + 15, y, { width: COL.qtyW - 10, lineBreak: false });
  doc.text(fmt(tax), COL.taxX, y, { width: COL.taxW, align: "right", lineBreak: false });
  doc.text(fmt(itemRCV), COL.rcvX, y, { width: COL.rcvW, align: "right", lineBreak: false });
  doc.text(fmtAgeLife(item.age, item.lifeExpectancy), COL.ageX, y, { width: COL.ageW, align: "right", lineBreak: false });
  doc.text("Avg.", COL.condX, y, { width: COL.condW, align: "right", lineBreak: false });
  doc.text(fmtDepPercent(depPct, depType), COL.depPctX, y, { width: COL.depPctW, align: "right", lineBreak: false });
  doc.text(fmtDeprecAmount(depAmt, depType), COL.deprecX, y, { width: COL.deprecW, align: "right", lineBreak: false });
  doc.text(fmt(itemACV), COL.acvX, y, { width: COL.acvW, align: "right", lineBreak: false });
  y += 10;
  return y;
}

function renderGrandTotalAreasPage(doc: Doc, re: RoomEstimateData) {
  newPage(doc);
  let y = MARGIN;
  doc.font(FONTS.bold, 11).fill(COLORS.black);
  doc.text("Grand Total Areas", MARGIN, y, { width: CONTENT_WIDTH, align: "center" });
  y += 18;

  let totalSFWalls = 0, totalSFCeiling = 0, totalSFFloor = 0;
  let totalSYFlooring = 0, totalLFFloorPerim = 0, totalLFCeilPerim = 0;
  let totalRoofSurface = 0, totalSquares = 0, totalRoofPerim = 0;
  let hasInterior = false, hasRoof = false;

  for (const room of re.rooms) {
    const dims = room.dimensions;
    if (!dims || (dims.length === 0 && dims.width === 0)) continue;
    const L = dims.length, W = dims.width, H = dims.height || 8;
    const isRoof = (room.viewType || "").includes("roof");

    if (isRoof) {
      hasRoof = true;
      totalRoofSurface += L * W;
      totalSquares += (L * W) / 100;
      totalRoofPerim += 2 * (L + W);
    } else {
      hasInterior = true;
      totalSFWalls += 2 * (L + W) * H;
      totalSFCeiling += L * W;
      totalSFFloor += L * W;
      totalSYFlooring += (L * W) / 9;
      totalLFFloorPerim += 2 * (L + W);
      totalLFCeilPerim += 2 * (L + W);
    }
  }

  const labelX = MARGIN + 20;
  const valX = PAGE_WIDTH / 2;
  const valW = 120;

  if (hasInterior) {
    doc.font(FONTS.bold, 9).fill(COLORS.black);
    doc.text("Interior Areas", labelX, y);
    y += 12;

    const rows = [
      ["Total SF Walls", `${fmt(totalSFWalls)} SF`],
      ["Total SF Ceiling", `${fmt(totalSFCeiling)} SF`],
      ["Total SF Walls & Ceiling", `${fmt(totalSFWalls + totalSFCeiling)} SF`],
      ["Total SF Floor", `${fmt(totalSFFloor)} SF`],
      ["Total SY Flooring", `${totalSYFlooring.toFixed(2)} SY`],
      ["Total LF Floor Perimeter", `${fmt(totalLFFloorPerim)} LF`],
      ["Total LF Ceiling Perimeter", `${fmt(totalLFCeilPerim)} LF`],
    ];
    for (const [label, val] of rows) {
      doc.font(FONTS.normal, 8).fill(COLORS.darkGray);
      doc.text(label, labelX + 10, y, { width: 200 });
      doc.text(val, valX, y, { width: valW, align: "right" });
      y += 11;
    }
    y += 6;
  }

  if (hasRoof) {
    doc.font(FONTS.bold, 9).fill(COLORS.black);
    doc.text("Roof Areas", labelX, y);
    y += 12;

    const rows = [
      ["Total Surface Area", `${fmt(totalRoofSurface)} SF`],
      ["Total Number of Squares", `${totalSquares.toFixed(2)} SQ`],
      ["Total Perimeter Length", `${fmt(totalRoofPerim)} LF`],
    ];
    for (const [label, val] of rows) {
      doc.font(FONTS.normal, 8).fill(COLORS.darkGray);
      doc.text(label, labelX + 10, y, { width: 200 });
      doc.text(val, valX, y, { width: valW, align: "right" });
      y += 11;
    }
  }

  if (!hasInterior && !hasRoof) {
    doc.font(FONTS.normal, 9).fill(COLORS.medGray);
    doc.text("No room dimensions recorded for this inspection.", labelX, y);
  }

  addFooter(doc);
}

function renderSettlementSummaryPage(doc: Doc, data: PDFReportData, re: RoomEstimateData) {
  newPage(doc);
  let y = MARGIN;
  const br = data.briefing;

  doc.font(FONTS.bold, 11).fill(COLORS.black);
  doc.text("Summary for Coverage A - Dwelling", MARGIN, y, { width: CONTENT_WIDTH, align: "center" });
  y += 18;

  const covBreakdown = data.estimate.coverageBreakdown;
  if (covBreakdown && Array.isArray(covBreakdown) && covBreakdown.length > 0) {
    const totalCovRCV = covBreakdown.reduce((s, c) => s + (c.totalRCV || 0), 0);
    const totalCovACV = covBreakdown.reduce((s, c) => s + (c.totalACV || 0), 0);

    doc.rect(MARGIN, y, CONTENT_WIDTH, 11).fill(COLORS.headerBg);
    doc.font(FONTS.bold, 6.5).fill(COLORS.black);
    doc.text("COVERAGE", MARGIN + 5, y + 3, { width: 130 });
    doc.text("ITEM TOTAL", 180, y + 3, { width: 70, align: "right" });
    doc.text("%", 255, y + 3, { width: 35, align: "right" });
    doc.text("ACV TOTAL", 295, y + 3, { width: 70, align: "right" });
    doc.text("%", 370, y + 3, { width: 35, align: "right" });
    y += 13;

    for (const cov of covBreakdown) {
      const covRcvPct = totalCovRCV > 0 ? ((cov.totalRCV || 0) / totalCovRCV) * 100 : 0;
      const covAcvPct = totalCovACV > 0 ? ((cov.totalACV || 0) / totalCovACV) * 100 : 0;
      doc.font(FONTS.normal, 7).fill(COLORS.darkGray);
      doc.text(cov.coverageType || "Dwelling", MARGIN + 5, y, { width: 130 });
      doc.text(fmt(cov.totalRCV || 0), 180, y, { width: 70, align: "right" });
      doc.text(`${covRcvPct.toFixed(1)}%`, 255, y, { width: 35, align: "right" });
      doc.text(fmt(cov.totalACV || 0), 295, y, { width: 70, align: "right" });
      doc.text(`${covAcvPct.toFixed(1)}%`, 370, y, { width: 35, align: "right" });
      y += 10;
    }
    y += 6;
  }

  const labelX = MARGIN + 30;
  const valX = PAGE_WIDTH - MARGIN - 90;
  const valW = 90;

  const lineItemTotal = re.grandTotal;
  const materialTax = re.grandTax;
  const overheadAmt = Number((data.estimate as any).overheadAmount) || 0;
  const profitAmt = Number((data.estimate as any).profitAmount) || 0;
  const subtotal = lineItemTotal + materialTax;
  const rcv = subtotal + overheadAmt + profitAmt;
  const totalDep = re.grandDepreciation;
  const acv = rcv - totalDep;
  const deductible = br?.coverageSnapshot?.deductible ?? data.estimate.deductible ?? 0;
  const netClaim = Math.max(0, acv - deductible);
  const nonRecDep = re.grandNonRecoverableDepreciation;
  const recDep = re.grandRecoverableDepreciation;

  doc.font(FONTS.normal, 9).fill(COLORS.black);
  doc.text("Line Item Total", labelX, y);
  doc.text(fmt(lineItemTotal), valX, y, { width: valW, align: "right" });
  y += 12;

  doc.text("Material Sales Tax", labelX, y);
  doc.text(fmt(materialTax), valX, y, { width: valW, align: "right" });
  y += 12;

  drawHLine(doc, y, labelX, valX + valW);
  y += 5;

  doc.text("Subtotal", labelX, y);
  doc.text(fmt(subtotal), valX, y, { width: valW, align: "right" });
  y += 12;

  if (overheadAmt > 0) {
    doc.text("Overhead", labelX, y);
    doc.text(fmt(overheadAmt), valX, y, { width: valW, align: "right" });
    y += 12;
  }

  if (profitAmt > 0) {
    doc.text("Profit", labelX, y);
    doc.text(fmt(profitAmt), valX, y, { width: valW, align: "right" });
    y += 12;
  }

  if (overheadAmt > 0 || profitAmt > 0) {
    drawHLine(doc, y, labelX, valX + valW);
    y += 5;
  }

  doc.font(FONTS.bold, 9);
  doc.text("Replacement Cost Value", labelX, y);
  doc.text(`$${fmt(rcv)}`, valX, y, { width: valW, align: "right" });
  y += 12;

  doc.font(FONTS.normal, 9);
  doc.text("Less Depreciation", labelX, y);
  doc.text(fmtParen(totalDep), valX, y, { width: valW, align: "right" });
  y += 14;
  drawHLine(doc, y, labelX, valX + valW);
  y += 5;

  doc.font(FONTS.bold, 9);
  doc.text("Actual Cash Value", labelX, y);
  doc.text(`$${fmt(acv)}`, valX, y, { width: valW, align: "right" });
  y += 12;

  doc.font(FONTS.normal, 9);
  doc.text("Less Deductible", labelX, y);
  doc.text(fmtParen(deductible), valX, y, { width: valW, align: "right" });
  y += 14;
  drawHLine(doc, y, labelX, valX + valW);
  y += 5;

  doc.font(FONTS.bold, 10);
  doc.text("Net Claim", labelX, y);
  doc.text(`$${fmt(netClaim)}`, valX, y, { width: valW, align: "right" });
  y += 20;

  drawThickLine(doc, y);
  y += 10;

  doc.font(FONTS.normal, 9);
  doc.text("Total Depreciation", labelX, y);
  doc.text(fmt(totalDep), valX, y, { width: valW, align: "right" });
  y += 12;
  doc.text("Less Non-Recoverable Depreciation", labelX, y);
  doc.text(fmtAngle(nonRecDep), valX, y, { width: valW, align: "right" });
  y += 14;
  drawHLine(doc, y, labelX, valX + valW);
  y += 5;

  doc.font(FONTS.bold, 9);
  doc.text("Total Recoverable Depreciation", labelX, y);
  doc.text(fmt(recDep), valX + 10, y, { width: valW - 10, align: "right" });
  y += 14;

  doc.font(FONTS.normal, 9);
  const netIfRecovered = netClaim + recDep;
  doc.text("Net Claim if Depreciation is Recovered", labelX, y);
  doc.font(FONTS.bold, 9);
  doc.text(`$${fmt(netIfRecovered)}`, valX, y, { width: valW, align: "right" });
  y += 30;

  if (data.inspectorName) {
    doc.font(FONTS.bold, 10).fill(COLORS.black);
    doc.text(data.inspectorName, MARGIN, y, { width: CONTENT_WIDTH, align: "center" });
    y += 12;
    doc.font(FONTS.normal, 8).fill(COLORS.medGray);
    doc.text("Catastrophe Adjuster", MARGIN, y, { width: CONTENT_WIDTH, align: "center" });
  }
}

function renderRecapOfTaxesAndOP(doc: Doc, data: PDFReportData, re: RoomEstimateData) {
  newPage(doc);
  let y = MARGIN;
  doc.font(FONTS.bold, 11).fill(COLORS.black);
  doc.text("Recap of Taxes, Overhead and Profit", MARGIN, y, { width: CONTENT_WIDTH, align: "center" });
  y += 18;

  const overheadAmt = Number((data.estimate as any).overheadAmount) || 0;
  const profitAmt = Number((data.estimate as any).profitAmount) || 0;

  doc.rect(MARGIN, y, CONTENT_WIDTH, 12).fill(COLORS.headerBg);
  doc.font(FONTS.bold, 6.5).fill(COLORS.black);
  doc.text("ITEM", MARGIN + 5, y + 3, { width: 200 });
  doc.text("AMOUNT", PAGE_WIDTH - MARGIN - 100, y + 3, { width: 95, align: "right" });
  y += 14;

  const rows = [
    ["Material Sales Tax", re.grandTax],
    ["Overhead", overheadAmt],
    ["Profit", profitAmt],
  ];
  for (const [label, val] of rows) {
    doc.font(FONTS.normal, 8).fill(COLORS.darkGray);
    doc.text(label as string, MARGIN + 5, y, { width: 200 });
    doc.text(fmt(val as number), PAGE_WIDTH - MARGIN - 100, y, { width: 95, align: "right" });
    y += 11;
    drawHLine(doc, y - 2);
  }

  y += 4;
  doc.font(FONTS.bold, 8).fill(COLORS.black);
  doc.text("Total", MARGIN + 5, y, { width: 200 });
  doc.text(fmt(re.grandTax + overheadAmt + profitAmt), PAGE_WIDTH - MARGIN - 100, y, { width: 95, align: "right" });

  addFooter(doc);
}

function renderRecapByRoom(doc: Doc, data: PDFReportData, re: RoomEstimateData) {
  newPage(doc);
  let y = MARGIN;
  doc.font(FONTS.bold, 11).fill(COLORS.black);
  doc.text("Recap by Room", MARGIN, y, { width: CONTENT_WIDTH, align: "center" });
  y += 18;

  const totalRCV = re.grandTotal + re.grandTax;

  doc.rect(MARGIN, y, CONTENT_WIDTH, 12).fill(COLORS.headerBg);
  doc.font(FONTS.bold, 6.5).fill(COLORS.black);
  doc.text("ROOM", MARGIN + 5, y + 3, { width: 200 });
  doc.text("RCV", 340, y + 3, { width: 70, align: "right" });
  doc.text("% OF TOTAL", 415, y + 3, { width: 70, align: "right" });
  y += 14;

  const structureGroups = new Map<string, typeof re.rooms>();
  for (const room of re.rooms) {
    const struct = room.structure || "Main Dwelling";
    if (!structureGroups.has(struct)) structureGroups.set(struct, []);
    structureGroups.get(struct)!.push(room);
  }

  for (const [structure, rooms] of structureGroups) {
    y = checkPageBreak(doc, 24, y);
    doc.font(FONTS.bold, 8).fill(COLORS.black);
    doc.text(structure, MARGIN + 5, y);
    y += 11;

    let structSubtotal = 0;
    for (const room of rooms) {
      y = checkPageBreak(doc, 11, y);
      const roomRCV = room.subtotal + room.totalTax;
      structSubtotal += roomRCV;
      const pct = totalRCV > 0 ? (roomRCV / totalRCV) * 100 : 0;

      doc.font(FONTS.normal, 7.5).fill(COLORS.darkGray);
      doc.text(room.name, MARGIN + 20, y, { width: 200 });
      doc.text(fmt(roomRCV), 340, y, { width: 70, align: "right" });
      doc.text(`${pct.toFixed(1)}%`, 415, y, { width: 70, align: "right" });
      y += 10;
    }

    const structPct = totalRCV > 0 ? (structSubtotal / totalRCV) * 100 : 0;
    doc.font(FONTS.bold, 7.5).fill(COLORS.black);
    doc.text(`Subtotal: ${structure}`, MARGIN + 10, y, { width: 200 });
    doc.text(fmt(structSubtotal), 340, y, { width: 70, align: "right" });
    doc.text(`${structPct.toFixed(1)}%`, 415, y, { width: 70, align: "right" });
    y += 12;
    drawHLine(doc, y - 3);
  }

  y += 4;
  doc.font(FONTS.bold, 8).fill(COLORS.black);
  doc.text("Grand Total", MARGIN + 5, y, { width: 200 });
  doc.text(fmt(totalRCV), 340, y, { width: 70, align: "right" });
  doc.text("100.0%", 415, y, { width: 70, align: "right" });

  addFooter(doc);
}

function renderRecapByCategory(doc: Doc, data: PDFReportData, re: RoomEstimateData) {
  newPage(doc);
  let y = MARGIN;
  doc.font(FONTS.bold, 11).fill(COLORS.black);
  doc.text("Recap by Category", MARGIN, y, { width: CONTENT_WIDTH, align: "center" });
  y += 18;

  const recap = re.categoryRecap || [];
  if (recap.length === 0) {
    doc.font(FONTS.normal, 9).fill(COLORS.medGray);
    doc.text("No category data available.", MARGIN, y);
    addFooter(doc);
    return;
  }

  doc.rect(MARGIN, y, CONTENT_WIDTH, 12).fill(COLORS.headerBg);
  doc.font(FONTS.bold, 6.5).fill(COLORS.black);
  doc.text("CATEGORY", MARGIN + 5, y + 3, { width: 160 });
  doc.text("ITEMS", 210, y + 3, { width: 40, align: "right" });
  doc.text("RCV", 260, y + 3, { width: 70, align: "right" });
  doc.text("DEPREC.", 340, y + 3, { width: 70, align: "right" });
  doc.text("ACV", 420, y + 3, { width: 70, align: "right" });
  y += 14;

  let totalItems = 0, totalRCV = 0, totalDep = 0, totalACV = 0;

  for (const cat of recap) {
    y = checkPageBreak(doc, 11, y);
    doc.font(FONTS.normal, 7.5).fill(COLORS.darkGray);
    doc.text(cat.category.toUpperCase(), MARGIN + 5, y, { width: 160 });
    doc.text(String(cat.itemCount), 210, y, { width: 40, align: "right" });
    doc.text(fmt(cat.rcv), 260, y, { width: 70, align: "right" });
    doc.text(fmt(cat.depreciation), 340, y, { width: 70, align: "right" });
    doc.text(fmt(cat.acv), 420, y, { width: 70, align: "right" });
    y += 10;
    drawHLine(doc, y - 2);

    totalItems += cat.itemCount;
    totalRCV += cat.rcv;
    totalDep += cat.depreciation;
    totalACV += cat.acv;
  }

  y += 4;
  drawThickLine(doc, y);
  y += 4;
  doc.font(FONTS.bold, 7.5).fill(COLORS.black);
  doc.text("TOTAL", MARGIN + 5, y, { width: 160 });
  doc.text(String(totalItems), 210, y, { width: 40, align: "right" });
  doc.text(fmt(totalRCV), 260, y, { width: 70, align: "right" });
  doc.text(fmt(totalDep), 340, y, { width: 70, align: "right" });
  doc.text(fmt(totalACV), 420, y, { width: 70, align: "right" });

  addFooter(doc);
}

function renderLegacyCoverPage(doc: Doc, data: PDFReportData) {
  let y = MARGIN;
  doc.font(FONTS.bold, 20).fill(COLORS.black).text("INSPECTION REPORT", MARGIN, y);
  y += 30;
  doc.font(FONTS.normal, 11).fill(COLORS.darkGray);
  doc.text(`Claim #${data.claim?.claimNumber || "N/A"}`, MARGIN, y);
  y += 16;
  doc.text(data.claim?.insuredName || "", MARGIN, y);
  y += 14;
  doc.text(data.claim?.propertyAddress || "", MARGIN, y);
  y += 25;

  doc.font(FONTS.bold, 10).text("RCV:", MARGIN, y);
  doc.font(FONTS.normal, 10).text(`$${fmt(data.estimate.totalRCV)}`, MARGIN + 120, y);
  y += 14;
  doc.font(FONTS.bold, 10).text("Depreciation:", MARGIN, y);
  doc.font(FONTS.normal, 10).text(`$${fmt(data.estimate.totalDepreciation)}`, MARGIN + 120, y);
  y += 14;
  doc.font(FONTS.bold, 10).text("ACV:", MARGIN, y);
  doc.font(FONTS.normal, 10).text(`$${fmt(data.estimate.totalACV)}`, MARGIN + 120, y);
}

function renderLegacyEstimate(doc: Doc, data: PDFReportData) {
  let y = MARGIN;
  doc.font(FONTS.bold, 14).fill(COLORS.black).text("Estimate Summary", MARGIN, y);
  y += 20;

  for (const cat of data.estimate.categories) {
    y = checkPageBreak(doc, 30, y);
    doc.font(FONTS.bold, 10).fill(COLORS.darkGray).text(cat.category, MARGIN, y);
    y += 14;

    for (const item of cat.items) {
      y = checkPageBreak(doc, 14, y);
      const totalPrice = (Number(item.quantity) || 0) * (Number(item.unitPrice) || 0);
      doc.font(FONTS.normal, 8).fill(COLORS.darkGray).text(item.description, MARGIN + 10, y, { width: 300 });
      doc.text(`$${totalPrice.toFixed(2)}`, 400, y, { width: 100, align: "right" });
      y += 12;
    }

    doc.font(FONTS.bold, 9).fill(COLORS.black).text(`Subtotal: $${fmt(cat.subtotal)}`, MARGIN + 10, y);
    y += 16;
  }

  y += 10;
  drawThickLine(doc, y);
  y += 8;
  doc.font(FONTS.bold, 10).fill(COLORS.black);
  doc.text("RCV:", MARGIN, y);
  doc.text(`$${fmt(data.estimate.totalRCV)}`, 350, y, { width: 150, align: "right" });
  y += 14;
  doc.text("Depreciation:", MARGIN, y);
  doc.text(`-$${fmt(data.estimate.totalDepreciation)}`, 350, y, { width: 150, align: "right" });
  y += 14;
  doc.text("ACV:", MARGIN, y);
  doc.text(`$${fmt(data.estimate.totalACV)}`, 350, y, { width: 150, align: "right" });
  y += 14;

  if (data.estimate.deductible != null) {
    doc.text("Deductible:", MARGIN, y);
    doc.text(`-$${fmt(data.estimate.deductible)}`, 350, y, { width: 150, align: "right" });
    y += 14;
  }
  if (data.estimate.netClaim != null) {
    drawHLine(doc, y);
    y += 6;
    doc.font(FONTS.bold, 11);
    doc.text("Net Claim:", MARGIN, y);
    doc.text(`$${fmt(data.estimate.netClaim)}`, 350, y, { width: 150, align: "right" });
  }
}

function renderMoistureReport(doc: Doc, readings: MoistureReading[]) {
  let y = MARGIN;
  doc.font(FONTS.bold, 14).fill(COLORS.black).text("Moisture Report", MARGIN, y);
  y += 20;
  drawHLine(doc, y);
  y += 8;

  doc.rect(MARGIN, y, CONTENT_WIDTH, 16).fill(COLORS.headerBg);
  doc.font(FONTS.bold, 8).fill(COLORS.black);
  doc.text("Location", MARGIN + 5, y + 4, { width: 150 });
  doc.text("Material", 200, y + 4, { width: 120 });
  doc.text("Reading", 340, y + 4, { width: 60, align: "right" });
  doc.text("Dry Std", 420, y + 4, { width: 60, align: "right" });
  y += 18;

  for (const reading of readings) {
    y = checkPageBreak(doc, 16, y);
    doc.font(FONTS.normal, 8).fill(COLORS.darkGray);
    doc.text(reading.location || "—", MARGIN + 5, y, { width: 150 });
    doc.text(reading.materialType || "—", 200, y, { width: 120 });
    doc.text(`${reading.reading}%`, 340, y, { width: 60, align: "right" });
    doc.text(`${reading.dryStandard || "—"}%`, 420, y, { width: 60, align: "right" });
    y += 14;
    drawHLine(doc, y - 2);
  }
}

function renderTranscript(doc: Doc, transcript: any[]) {
  let y = MARGIN;
  doc.font(FONTS.bold, 14).fill(COLORS.black).text("VOICE TRANSCRIPT", MARGIN, y, { width: CONTENT_WIDTH, align: "center", lineBreak: false });
  y += 20;
  drawHLine(doc, y);
  y += 8;

  const labelWidth = 75;
  const contentX = MARGIN + labelWidth + 5;
  const contentWidth = CONTENT_WIDTH - labelWidth - 5;

  for (const entry of transcript) {
    const speaker = entry.speaker === "agent" ? "AI Inspector:" : "Adjuster:";
    const content = (entry.content || "").trim();
    if (!content) continue;

    const textHeight = doc.font(FONTS.normal, 7.5).heightOfString(content, { width: contentWidth });
    const rowHeight = Math.max(12, textHeight + 4);
    y = checkPageBreak(doc, rowHeight, y);
    if (y === MARGIN) {
      doc.font(FONTS.bold, 14).fill(COLORS.black).text("VOICE TRANSCRIPT (Continued)", MARGIN, y, { width: CONTENT_WIDTH, align: "center", lineBreak: false });
      y += 20;
      drawHLine(doc, y);
      y += 8;
    }

    doc.font(FONTS.bold, 7.5).fill(COLORS.darkGray);
    doc.text(speaker, MARGIN, y, { width: labelWidth, lineBreak: false });
    doc.font(FONTS.normal, 7.5).fill(COLORS.black);
    doc.text(content, contentX, y, { width: contentWidth, height: textHeight + 2 });
    y += rowHeight;
  }
}

function renderPhotoAppendix(doc: Doc, photos: InspectionPhoto[]) {
  let y = MARGIN;
  doc.font(FONTS.bold, 14).fill(COLORS.black).text("PHOTO APPENDIX", MARGIN, y, { width: CONTENT_WIDTH, align: "center", lineBreak: false });
  y += 20;
  drawHLine(doc, y);
  y += 10;

  doc.font(FONTS.normal, 8).fill(COLORS.medGray);
  doc.text("Note: Photos are referenced by caption and storage path in this report.", MARGIN, y, { width: CONTENT_WIDTH, lineBreak: false });
  y += 16;

  doc.rect(MARGIN, y, CONTENT_WIDTH, 16).fill(COLORS.headerBg);
  doc.font(FONTS.bold, 8).fill(COLORS.black);
  doc.text("#", MARGIN + 5, y + 4, { width: 20, lineBreak: false });
  doc.text("Caption", MARGIN + 30, y + 4, { width: 220, lineBreak: false });
  doc.text("Type", MARGIN + 255, y + 4, { width: 90, lineBreak: false });
  doc.text("Storage Path", MARGIN + 350, y + 4, { width: CONTENT_WIDTH - 350, lineBreak: false });
  y += 18;

  for (let i = 0; i < photos.length; i++) {
    const p = photos[i];
    const caption = p.caption || `Photo ${i + 1}`;
    const type = (p.photoType as any) || "photo";
    const storagePath = p.storagePath || "";

    y = checkPageBreak(doc, 34, y);
    doc.font(FONTS.normal, 8).fill(COLORS.black);
    doc.text(String(i + 1), MARGIN + 5, y, { width: 20, lineBreak: false });
    doc.text(caption, MARGIN + 30, y, { width: 220, lineBreak: false });
    doc.text(String(type), MARGIN + 255, y, { width: 90, lineBreak: false });
    doc.text(String(storagePath), MARGIN + 350, y, { width: CONTENT_WIDTH - 350, lineBreak: false });

    const analysisDesc = (p as any)?.analysis?.description;
    if (analysisDesc && typeof analysisDesc === "string") {
      const text = `AI: ${analysisDesc}`;
      const h = doc.heightOfString(text, { width: CONTENT_WIDTH - 40 });
      y += 12;
      y = checkPageBreak(doc, h + 6, y);
      doc.font(FONTS.normal, 7).fill(COLORS.darkGray);
      doc.text(text, MARGIN + 30, y, { width: CONTENT_WIDTH - 40, height: h + 2 });
      y += Math.max(10, h);
    } else {
      y += 14;
    }

    drawHLine(doc, y - 2);
  }
}
