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
  doc.text(currentDate, MARGIN, PAGE_HEIGHT - 30, { width: CONTENT_WIDTH / 2, align: "left" });
  doc.text(`Page: ${pageNumber}`, MARGIN + CONTENT_WIDTH / 2, PAGE_HEIGHT - 30, { width: CONTENT_WIDTH / 2, align: "right" });
}

function newPage(doc: Doc) {
  doc.addPage();
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
    const doc = new PDFDocument({ size: "letter", margin: MARGIN });
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
      newPage(doc);
      renderSettlementSummaryPage(doc, data, re);
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

    doc.end();
  });
}

function renderCoverageSummaryPage(doc: Doc, data: PDFReportData, re: RoomEstimateData, br?: BriefingData) {
  addFooter(doc);

  const claim = data.claim;
  let y = MARGIN;

  doc.font(FONTS.normal, 11).fill(COLORS.black);
  doc.text(currentDate, MARGIN, y, { width: CONTENT_WIDTH, align: "left" });
  y += 30;

  const insuredName = claim?.insuredName || "Insured";
  const address = claim?.propertyAddress || "";
  const cityStateZip = [claim?.city, claim?.state, claim?.zip].filter(Boolean).join(", ");
  const claimNumber = claim?.claimNumber || br?.coverageSnapshot?.policyNumber || "N/A";
  const dateOfLoss = claim?.dateOfLoss || "N/A";

  doc.font(FONTS.bold, 11).fill(COLORS.black).text(insuredName, MARGIN, y);
  y += 14;
  if (address) {
    doc.font(FONTS.normal, 10).text(address, MARGIN, y);
    y += 13;
  }
  if (cityStateZip) {
    doc.font(FONTS.normal, 10).text(cityStateZip, MARGIN, y);
    y += 13;
  }

  const rightCol = 380;
  doc.font(FONTS.normal, 10).fill(COLORS.black);
  doc.text("Claim Number:", rightCol, y - 40);
  doc.font(FONTS.bold, 10).text(claimNumber, rightCol + 90, y - 40);
  doc.font(FONTS.normal, 10).text("Date of Loss:", rightCol, y - 26);
  doc.text(dateOfLoss, rightCol + 90, y - 26);

  y += 30;
  drawThickLine(doc, y);
  y += 15;

  doc.font(FONTS.bold, 14).fill(COLORS.black);
  doc.text("Summary For Coverage A - Dwelling", MARGIN, y, { width: CONTENT_WIDTH, align: "center" });
  y += 30;

  const col1 = MARGIN;
  const col2 = MARGIN + 140;
  const col3 = MARGIN + 280;
  const col4 = MARGIN + 400;

  doc.font(FONTS.bold, 8).fill(COLORS.medGray);
  doc.text("Replacement Cost Value", col1, y, { width: 130, align: "center" });
  doc.text("Less Recoverable\nDepreciation", col2, y, { width: 130, align: "center" });
  doc.text("Less Non Recoverable\nDepreciation", col3, y, { width: 110, align: "center" });
  doc.text("Actual Cash Value (ACV)", col4, y, { width: 130, align: "center" });
  y += 28;
  drawHLine(doc, y);
  y += 8;

  const rcv = re.grandTotal + re.grandTax;
  const recDep = re.grandRecoverableDepreciation;
  const nonRecDep = re.grandNonRecoverableDepreciation;
  const acv = rcv - re.grandDepreciation;
  const deductible = br?.coverageSnapshot?.deductible ?? data.estimate.deductible ?? 0;

  doc.font(FONTS.bold, 11).fill(COLORS.black);
  doc.text(`$${fmt(rcv)}`, col1, y, { width: 130, align: "center" });
  doc.text(fmtParen(recDep), col2, y, { width: 130, align: "center" });
  doc.text(fmtAngle(nonRecDep), col3, y, { width: 110, align: "center" });
  doc.text(`$${fmt(acv)}`, col4, y, { width: 130, align: "center" });
  y += 20;

  doc.font(FONTS.normal, 10).fill(COLORS.black);
  doc.text("Less Deductible", col1, y);
  doc.text(fmtParen(deductible), col4, y, { width: 130, align: "center" });
  y += 16;

  doc.font(FONTS.bold, 11).fill(COLORS.black);
  doc.text("Total ACV Settlement", col1, y);
  const settlement = Math.max(0, acv - deductible);
  doc.text(`$${fmt(settlement)}`, col4, y, { width: 130, align: "center" });
  y += 30;
  drawThickLine(doc, y);
  y += 20;

  doc.font(FONTS.bold, 12).fill(COLORS.black);
  doc.text("Understanding Your Property Estimate", MARGIN, y, { width: CONTENT_WIDTH, align: "center" });
  y += 20;

  doc.font(FONTS.bold, 8).fill(COLORS.medGray);
  const uomY = y;
  const uomCol = 100;
  const units = [
    ["HR", "Hour"], ["LF", "Linear Foot"], ["EA", "Each"], ["SQ", "Square"], ["SF", "Square Foot"],
    ["SY", "Square Yard"], ["DA", "Day"], ["CY", "Cubic Yard"], ["CF", "Cubic Foot"], ["RM", "Room"],
  ];
  doc.font(FONTS.normal, 8).fill(COLORS.medGray);
  doc.text("Unit of Measure", MARGIN, uomY, { width: CONTENT_WIDTH, align: "center" });
  y += 14;
  let ux = MARGIN + 20;
  for (let i = 0; i < units.length; i++) {
    if (i === 5) { y += 12; ux = MARGIN + 20; }
    doc.font(FONTS.bold, 7).text(`${units[i][0]}`, ux, y, { continued: true });
    doc.font(FONTS.normal, 7).text(` – ${units[i][1]}`, { continued: false });
    ux += uomCol;
  }
}

function renderClaimInfoPage(doc: Doc, data: PDFReportData, br?: BriefingData) {
  const claim = data.claim;
  let y = MARGIN;

  const insuredName = claim?.insuredName || "Insured";
  const address = claim?.propertyAddress || "";
  const cityStateZip = [claim?.city, claim?.state, claim?.zip].filter(Boolean).join(", ");
  const phone = (claim as any)?.phone || "";

  doc.font(FONTS.bold, 10).fill(COLORS.black).text("Insured:", MARGIN, y);
  doc.font(FONTS.normal, 10).text(insuredName, MARGIN + 80, y);
  y += 14;
  if (address) { doc.text(address, MARGIN + 80, y); y += 13; }
  if (cityStateZip) { doc.text(cityStateZip, MARGIN + 80, y); y += 13; }

  if (phone) {
    doc.font(FONTS.bold, 10).text("Phone:", 380, MARGIN);
    doc.font(FONTS.normal, 10).text(phone, 430, MARGIN);
  }

  y += 10;
  doc.font(FONTS.bold, 10).text("Claim Rep.:", MARGIN, y);
  doc.font(FONTS.normal, 10).text(data.inspectorName || "Inspector", MARGIN + 80, y);
  y += 14;
  doc.font(FONTS.bold, 10).text("Estimator:", MARGIN, y);
  doc.font(FONTS.normal, 10).text(data.inspectorName || "Inspector", MARGIN + 80, y);
  y += 25;

  drawHLine(doc, y);
  y += 10;

  const claimNum = claim?.claimNumber || "N/A";
  const policyNum = br?.coverageSnapshot?.policyNumber || "N/A";
  const lossType = claim?.perilType || "N/A";

  doc.font(FONTS.bold, 9).fill(COLORS.black);
  doc.text("Claim Number:", MARGIN, y);
  doc.font(FONTS.normal, 9).text(claimNum, MARGIN + 90, y);
  doc.font(FONTS.bold, 9).text("Policy Number:", 230, y);
  doc.font(FONTS.normal, 9).text(policyNum, 320, y);
  doc.font(FONTS.bold, 9).text("Type of Loss:", 430, y);
  doc.font(FONTS.normal, 9).text(lossType, 510, y);
  y += 20;

  const covA = br?.coverageSnapshot?.coverageA ?? 0;
  const covB = br?.coverageSnapshot?.coverageB ?? 0;
  const covC = br?.coverageSnapshot?.coverageC ?? 0;
  const covD = br?.coverageSnapshot?.coverageD ?? 0;
  const ded = br?.coverageSnapshot?.deductible ?? data.estimate.deductible ?? 0;

  doc.rect(MARGIN, y, CONTENT_WIDTH, 16).fill(COLORS.headerBg);
  doc.font(FONTS.bold, 8).fill(COLORS.black);
  doc.text("Coverage", MARGIN + 5, y + 4, { width: 250 });
  doc.text("Deductible", 350, y + 4, { width: 90, align: "right" });
  doc.text("Policy Limit", 450, y + 4, { width: 90, align: "right" });
  y += 18;

  const coverageRows = [
    ["Coverage A - Dwelling", ded, covA],
    ["Coverage B - Other Structures Blanket", 0, covB],
    ["Coverage C - Personal Property", 0, covC],
    ["Coverage D - Loss Of Use", 0, covD],
  ];

  for (const [name, d, limit] of coverageRows) {
    doc.font(FONTS.normal, 8).fill(COLORS.black);
    doc.text(name as string, MARGIN + 5, y, { width: 300 });
    doc.text(`$${fmt(d as number)}`, 350, y, { width: 90, align: "right" });
    doc.text(`$${fmt(limit as number)}`, 450, y, { width: 90, align: "right" });
    y += 14;
  }

  y += 15;
  drawHLine(doc, y);
  y += 10;

  const dateOfLoss = claim?.dateOfLoss || "N/A";
  const dateCompleted = currentDate;

  doc.font(FONTS.bold, 9).text("Date of Loss:", MARGIN, y);
  doc.font(FONTS.normal, 9).text(dateOfLoss, MARGIN + 120, y);
  y += 14;
  doc.font(FONTS.bold, 9).text("Date Est. Completed:", MARGIN, y);
  doc.font(FONTS.normal, 9).text(dateCompleted, MARGIN + 120, y);
  y += 25;

  drawHLine(doc, y);
  y += 10;

  doc.font(FONTS.bold, 9).text("Sales Taxes:", MARGIN, y);
  doc.font(FONTS.normal, 9).text("Material Sales Tax", MARGIN + 120, y);
  y += 14;
}

function renderEstimateRecapPage(doc: Doc, data: PDFReportData, re: RoomEstimateData) {
  let y = MARGIN;

  doc.font(FONTS.bold, 13).fill(COLORS.black);
  doc.text("Estimate Recap For Coverage A - Dwelling", MARGIN, y, { width: CONTENT_WIDTH, align: "center" });
  y += 25;

  const descX = MARGIN;
  const rcvX = 290;
  const recDepX = 365;
  const nonRecDepX = 430;
  const acvX = PAGE_WIDTH - MARGIN - 60;

  doc.rect(MARGIN, y, CONTENT_WIDTH, 16).fill(COLORS.headerBg);
  doc.font(FONTS.bold, 7).fill(COLORS.black);
  doc.text("Description", descX + 5, y + 4, { width: 240 });
  doc.text("RCV", rcvX, y + 4, { width: 65, align: "right" });
  doc.text("Recoverable\nDepreciation", recDepX, y + 2, { width: 60, align: "right" });
  doc.text("Non-recoverable\nDepreciation", nonRecDepX, y + 2, { width: 70, align: "right" });
  doc.text("ACV", acvX, y + 4, { width: 60, align: "right" });
  y += 20;
  drawHLine(doc, y);
  y += 6;

  const structureGroups: Record<string, RoomEstimate[]> = {};
  for (const room of re.rooms) {
    const key = room.structure || "Dwelling";
    if (!structureGroups[key]) structureGroups[key] = [];
    structureGroups[key].push(room);
  }

  for (const [structure, rooms] of Object.entries(structureGroups)) {
    for (const room of rooms) {
      y = checkPageBreak(doc, 20, y);
      const rcvVal = room.subtotal + room.totalTax;
      doc.font(FONTS.normal, 8).fill(COLORS.black);
      doc.text(`${structure} - ${room.name}`, descX + 5, y, { width: 240 });
      doc.text(fmt(rcvVal), rcvX, y, { width: 65, align: "right" });
      doc.text(fmt(room.totalRecoverableDepreciation), recDepX, y, { width: 60, align: "right" });
      doc.text(fmt(room.totalNonRecoverableDepreciation), nonRecDepX, y, { width: 70, align: "right" });
      const roomAcvCorrected = rcvVal - room.totalDepreciation;
      doc.text(fmt(roomAcvCorrected), acvX, y, { width: 60, align: "right" });
      y += 14;
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

function renderLineItemPages(doc: Doc, data: PDFReportData, re: RoomEstimateData) {
  for (const room of re.rooms) {
    newPage(doc);
    let y = MARGIN;

    doc.font(FONTS.bold, 12).fill(COLORS.black);
    doc.text(room.name, MARGIN, y, { width: CONTENT_WIDTH, align: "center" });
    y += 20;

    y = drawLineItemHeader(doc, y);

    for (const item of room.items) {
      y = checkPageBreak(doc, 30, y);
      if (y === MARGIN) {
        doc.font(FONTS.bold, 10).fill(COLORS.black);
        doc.text(`CONTINUED - ${room.name}`, MARGIN, y, { width: CONTENT_WIDTH, align: "center" });
        y += 18;
        y = drawLineItemHeader(doc, y);
      }
      y = drawLineItem(doc, y, item);
    }

    y += 6;
    drawHLine(doc, y);
    y += 4;

    const roomRCV = room.subtotal + room.totalTax;
    const roomACVCorrected = roomRCV - room.totalDepreciation;
    doc.font(FONTS.bold, 8).fill(COLORS.black);
    doc.text(`Totals: ${room.name}`, MARGIN + 5, y, { width: 150 });
    doc.text(fmt(room.totalTax), 228, y, { width: 45, align: "right" });
    doc.text(fmt(roomRCV), 278, y, { width: 60, align: "right" });
    doc.text(fmt(room.totalDepreciation), 438, y, { width: 55, align: "right" });
    doc.text(fmt(roomACVCorrected), PAGE_WIDTH - MARGIN - 55, y, { width: 55, align: "right" });
    y += 18;
  }

  let y = (doc as any).y || MARGIN + 200;
  y = checkPageBreak(doc, 40, y);

  drawThickLine(doc, y);
  y += 6;

  const totalRCV = re.grandTotal + re.grandTax;
  const totalACV = totalRCV - re.grandDepreciation;
  doc.font(FONTS.bold, 9).fill(COLORS.black);
  doc.text("Line Item Totals:", MARGIN + 5, y, { width: 180 });
  doc.text(fmt(re.grandTax), 228, y, { width: 45, align: "right" });
  doc.text(fmt(totalRCV), 278, y, { width: 60, align: "right" });
  doc.text(fmt(re.grandDepreciation), 438, y, { width: 55, align: "right" });
  doc.text(fmt(totalACV), PAGE_WIDTH - MARGIN - 55, y, { width: 55, align: "right" });
  y += 20;

  doc.font(FONTS.normal, 7).fill(COLORS.medGray);
  doc.text("[%] - Indicates that depreciate by percent was used for this item", MARGIN, y);
}

function drawLineItemHeader(doc: Doc, y: number): number {
  doc.rect(MARGIN, y, CONTENT_WIDTH, 14).fill(COLORS.headerBg);
  doc.font(FONTS.bold, 6).fill(COLORS.black);
  doc.text("QUANTITY", 115, y + 4, { width: 50, align: "right" });
  doc.text("UNIT", 170, y + 4, { width: 50, align: "right" });
  doc.text("TAX", 228, y + 4, { width: 45, align: "right" });
  doc.text("RCV", 278, y + 4, { width: 60, align: "right" });
  doc.text("AGE/LIFE", 343, y + 4, { width: 45, align: "right" });
  doc.text("COND.", 390, y + 4, { width: 30, align: "right" });
  doc.text("DEP %", 418, y + 4, { width: 35, align: "right" });
  doc.text("DEPREC.", 453, y + 4, { width: 50, align: "right" });
  doc.text("ACV", PAGE_WIDTH - MARGIN - 55, y + 4, { width: 55, align: "right" });
  return y + 16;
}

function drawLineItem(doc: Doc, y: number, item: RoomEstimateItem): number {
  doc.font(FONTS.normal, 8).fill(COLORS.black);
  doc.text(`${item.lineNumber}. ${item.description}`, MARGIN + 5, y, { width: 500 });
  const descHeight = doc.heightOfString(`${item.lineNumber}. ${item.description}`, { width: 500 });
  const descLines = Math.max(1, Math.ceil(descHeight / 10));
  y += Math.max(12, descLines * 10);

  doc.font(FONTS.normal, 7).fill(COLORS.darkGray);
  const qty = Number(item.quantity) || 0;
  const unitPrice = Number(item.unitPrice) || 0;
  const rcv = Number(item.totalPrice) || 0;
  const tax = Number(item.taxAmount) || 0;
  const depAmt = Number(item.depreciationAmount) || 0;
  const depPct = Number(item.depreciationPercentage) || 0;
  const acv = Number(item.acv) || 0;
  const depType = item.depreciationType || "recoverable";

  doc.text(qty.toFixed(2), 100, y, { width: 65, align: "right" });
  doc.text(`${item.unit || "EA"}`, 170, y, { width: 25, align: "left" });
  doc.text(fmt(unitPrice), 170, y, { width: 50, align: "right" });
  doc.text(fmt(tax), 228, y, { width: 45, align: "right" });
  const itemRCV = rcv + tax;
  const itemACV = itemRCV - depAmt;
  doc.text(fmt(itemRCV), 278, y, { width: 60, align: "right" });
  doc.text(fmtAgeLife(item.age, item.lifeExpectancy), 338, y, { width: 50, align: "right" });
  doc.text("Avg.", 393, y, { width: 27, align: "right" });
  doc.text(fmtDepPercent(depPct, depType), 418, y, { width: 40, align: "right" });
  doc.text(fmtDeprecAmount(depAmt, depType), 455, y, { width: 50, align: "right" });
  doc.text(fmt(itemACV), PAGE_WIDTH - MARGIN - 55, y, { width: 55, align: "right" });
  y += 14;
  return y;
}

function renderSettlementSummaryPage(doc: Doc, data: PDFReportData, re: RoomEstimateData) {
  let y = MARGIN;
  const br = data.briefing;

  doc.font(FONTS.bold, 13).fill(COLORS.black);
  doc.text("Summary for Coverage A - Dwelling", MARGIN, y, { width: CONTENT_WIDTH, align: "center" });
  y += 35;

  const labelX = MARGIN + 40;
  const valX = PAGE_WIDTH - MARGIN - 100;
  const valW = 100;

  const lineItemTotal = re.grandTotal;
  const materialTax = re.grandTax;
  const rcv = lineItemTotal + materialTax;
  const totalDep = re.grandDepreciation;
  const acv = rcv - totalDep;
  const deductible = br?.coverageSnapshot?.deductible ?? data.estimate.deductible ?? 0;
  const netClaim = Math.max(0, acv - deductible);
  const nonRecDep = re.grandNonRecoverableDepreciation;
  const recDep = re.grandRecoverableDepreciation;

  doc.font(FONTS.normal, 10).fill(COLORS.black);
  doc.text("Line Item Total", labelX, y);
  doc.text(fmt(lineItemTotal), valX, y, { width: valW, align: "right" });
  y += 16;

  doc.text("Material Sales Tax", labelX, y);
  doc.text(fmt(materialTax), valX, y, { width: valW, align: "right" });
  y += 20;
  drawHLine(doc, y, labelX, valX + valW);
  y += 8;

  doc.font(FONTS.bold, 10);
  doc.text("Replacement Cost Value", labelX, y);
  doc.text(`$${fmt(rcv)}`, valX, y, { width: valW, align: "right" });
  y += 16;

  doc.font(FONTS.normal, 10);
  doc.text("Less Depreciation", labelX, y);
  doc.text(fmtParen(totalDep), valX, y, { width: valW, align: "right" });
  y += 20;
  drawHLine(doc, y, labelX, valX + valW);
  y += 8;

  doc.font(FONTS.bold, 10);
  doc.text("Actual Cash Value", labelX, y);
  doc.text(`$${fmt(acv)}`, valX, y, { width: valW, align: "right" });
  y += 16;

  doc.font(FONTS.normal, 10);
  doc.text("Less Deductible", labelX, y);
  doc.text(fmtParen(deductible), valX, y, { width: valW, align: "right" });
  y += 20;
  drawHLine(doc, y, labelX, valX + valW);
  y += 8;

  doc.font(FONTS.bold, 11);
  doc.text("Net Claim", labelX, y);
  doc.text(`$${fmt(netClaim)}`, valX, y, { width: valW, align: "right" });
  y += 35;

  drawThickLine(doc, y);
  y += 15;

  doc.font(FONTS.normal, 10);
  doc.text("Total Depreciation", labelX, y);
  doc.text(fmt(totalDep), valX, y, { width: valW, align: "right" });
  y += 16;
  doc.text("Less Non-Recoverable Depreciation", labelX, y);
  doc.text(fmtAngle(nonRecDep), valX, y, { width: valW, align: "right" });
  y += 20;
  drawHLine(doc, y, labelX, valX + valW);
  y += 8;

  doc.font(FONTS.bold, 10);
  doc.text("Total Recoverable Depreciation", labelX, y);
  doc.text(fmt(recDep), valX + 20, y, { width: valW - 20, align: "right" });
  y += 20;

  doc.font(FONTS.normal, 10);
  const netIfRecovered = netClaim + recDep;
  doc.text("Net Claim if Depreciation is Recovered", labelX, y);
  doc.font(FONTS.bold, 10);
  doc.text(`$${fmt(netIfRecovered)}`, valX, y, { width: valW, align: "right" });
  y += 50;

  if (data.inspectorName) {
    doc.font(FONTS.bold, 11).fill(COLORS.black);
    doc.text(data.inspectorName, MARGIN, y, { width: CONTENT_WIDTH, align: "center" });
    y += 16;
    doc.font(FONTS.normal, 9).fill(COLORS.medGray);
    doc.text("Catastrophe Adjuster", MARGIN, y, { width: CONTENT_WIDTH, align: "center" });
  }
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
  doc.font(FONTS.bold, 14).fill(COLORS.black).text("VOICE TRANSCRIPT", MARGIN, y, { width: CONTENT_WIDTH, align: "center" });
  y += 20;
  drawHLine(doc, y);
  y += 8;

  for (const entry of transcript) {
    y = checkPageBreak(doc, 16, y);
    const speaker = entry.speaker === "agent" ? "AI Inspector" : "Adjuster";
    doc.font(FONTS.bold, 8).fill(COLORS.darkGray).text(speaker, MARGIN, y, { continued: true });
    doc.font(FONTS.normal, 8).fill(COLORS.black).text(`: ${entry.content}`);
    y += 12;
  }
}
