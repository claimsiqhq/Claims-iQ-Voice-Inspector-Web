import PDFDocument from "pdfkit";
import {
  Document, Packer, Paragraph, TextRun, ImageRun, Table, TableRow, TableCell,
  WidthType, AlignmentType, BorderStyle, Header, PageNumber, NumberFormat,
  Footer, HeadingLevel, SectionType,
} from "docx";
import { InspectionPhoto, InspectionRoom, Claim, InspectionSession } from "../shared/schema";
import { supabase, PHOTOS_BUCKET } from "./supabase";
import { logger } from "./logger";

interface PhotoReportData {
  claim: Claim | null;
  session: InspectionSession;
  rooms: InspectionRoom[];
  photos: InspectionPhoto[];
  inspectorName?: string;
  companyName?: string;
}

interface PhotoEntry {
  index: number;
  photo: InspectionPhoto;
  roomName: string;
  imageBuffer: Buffer | null;
  signedUrl: string | null;
}

async function fetchPhotoBuffers(photos: InspectionPhoto[], rooms: InspectionRoom[]): Promise<PhotoEntry[]> {
  const entries: PhotoEntry[] = [];
  let index = 1;

  for (const photo of photos) {
    const room = rooms.find(r => r.id === photo.roomId);
    const roomName = room ? room.name : "General";
    let imageBuffer: Buffer | null = null;
    let signedUrl: string | null = null;

    if (photo.storagePath) {
      try {
        const { data } = await supabase.storage
          .from(PHOTOS_BUCKET)
          .download(photo.storagePath);
        if (data) {
          const arrayBuffer = await data.arrayBuffer();
          imageBuffer = Buffer.from(arrayBuffer);
        }
      } catch (err) {
        logger.error("PhotoReport", `Failed to download photo ${photo.id}`, err);
      }

      if (!imageBuffer) {
        try {
          const { data } = await supabase.storage
            .from(PHOTOS_BUCKET)
            .createSignedUrl(photo.storagePath, 3600);
          if (data?.signedUrl) signedUrl = data.signedUrl;
        } catch {}
      }
    }

    entries.push({ index, photo, roomName, imageBuffer, signedUrl });
    index++;
  }

  return entries;
}

function formatDate(date: Date | string | null | undefined): string {
  if (!date) return "";
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" });
}

function getPhotoLabel(entry: PhotoEntry): string {
  const caption = entry.photo.caption || "";
  const tag = entry.photo.autoTag || "";
  const type = entry.photo.photoType?.replace(/_/g, " ") || "";
  if (caption) return caption;
  if (tag) return tag;
  if (type) return type;
  return `Photo ${entry.index}`;
}

interface DamageDetection {
  type?: string;
  damageType?: string;
  severity?: string;
  notes?: string;
  description?: string;
  confidence?: number;
  bbox?: { x: number; y: number; width: number; height: number };
  repairSuggestion?: string;
}

function buildNarrativeText(analysis: any): string {
  if (!analysis) return "";

  const parts: string[] = [];

  const desc = analysis.description || analysis.summary || "";
  if (desc) parts.push(desc);

  const detections: DamageDetection[] = analysis.damageVisible || analysis.damageDetections || [];
  if (detections.length > 0) {
    const damageLines: string[] = [];
    for (const d of detections) {
      const dtype = d.type || d.damageType || "Unknown";
      const sev = d.severity || "";
      const notes = d.notes || d.description || "";
      const conf = d.confidence != null ? `${Math.round(d.confidence * 100)}%` : "";
      const repair = d.repairSuggestion || "";

      let line = `• ${dtype}`;
      if (sev) line += ` (${sev})`;
      if (conf) line += ` — Confidence: ${conf}`;
      if (notes) line += `. ${notes}`;
      if (repair) line += ` Repair: ${repair}`;
      damageLines.push(line);
    }
    parts.push("Damage Findings:\n" + damageLines.join("\n"));
  }

  const lineItems: any[] = analysis.suggestedLineItems || [];
  if (lineItems.length > 0) {
    const itemLines = lineItems.slice(0, 5).map((li: any) => {
      const name = li.item || li.description || "";
      const reason = li.reason || "";
      const details = li.materialDetails || "";
      let line = `• ${name}`;
      if (details) line += ` — ${details}`;
      if (reason) line += `. ${reason}`;
      return line;
    });
    parts.push("Materials & Line Items:\n" + itemLines.join("\n"));
  }

  const ctx = analysis.propertyContext || "";
  if (ctx) parts.push(`Property Context: ${ctx}`);

  const quality = analysis.qualityNotes || "";
  if (quality && analysis.qualityScore != null) {
    parts.push(`Quality: ${analysis.qualityScore}/5 — ${quality}`);
  }

  return parts.join("\n\n");
}

const ANNOTATION_COLORS = [
  { stroke: "#FF0000", fill: "rgba(255,0,0,0.15)", label: "#FF0000" },
  { stroke: "#FF6600", fill: "rgba(255,102,0,0.15)", label: "#FF6600" },
  { stroke: "#FFCC00", fill: "rgba(255,204,0,0.15)", label: "#996600" },
  { stroke: "#00AAFF", fill: "rgba(0,170,255,0.15)", label: "#0066CC" },
  { stroke: "#FF00FF", fill: "rgba(255,0,255,0.15)", label: "#CC00CC" },
];

// ─── PDF Photo Report ───────────────────────────────────────────

const PDF_COLORS = {
  headerBg: "#1a1a2e",
  headerText: "#FFFFFF",
  labelText: "#333333",
  captionText: "#555555",
  borderColor: "#cccccc",
  pageBg: "#FFFFFF",
  narrativeBg: "#f8f8f8",
  damageBadge: "#cc0000",
};

export async function generatePhotoReportPDF(data: PhotoReportData): Promise<Buffer> {
  const entries = await fetchPhotoBuffers(data.photos, data.rooms);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "letter",
      margin: 36,
      bufferPages: true,
      info: {
        Title: `Photo Report - ${data.claim?.claimNumber || "Inspection"}`,
        Author: data.inspectorName || data.companyName || "Claims IQ",
      },
    });

    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const pageWidth = 612;
    const pageHeight = 792;
    const margin = 36;
    const contentWidth = pageWidth - margin * 2;
    const footerY = pageHeight - margin - 12;
    const maxContentY = footerY - 10;

    const insuredName = data.claim?.insuredName || "N/A";
    const claimNumber = data.claim?.claimNumber || "N/A";
    const policyNumber = (data.claim as any)?.policyNumber || "N/A";
    const dateOfLoss = formatDate(data.claim?.dateOfLoss);
    const reportDate = formatDate(new Date());

    function renderPageHeader(): number {
      const headerHeight = 52;
      doc.save();
      doc.rect(margin, margin, contentWidth, headerHeight).fill(PDF_COLORS.headerBg);

      doc.font("Helvetica-Bold", 11)
        .fill(PDF_COLORS.headerText)
        .text("PHOTO REPORT", margin + 8, margin + 6, { width: contentWidth - 16 });

      doc.font("Helvetica", 8)
        .fill(PDF_COLORS.headerText)
        .text(`Insured: ${insuredName}`, margin + 8, margin + 22);
      doc.text(`Claim #: ${claimNumber}`, margin + 200, margin + 22);

      doc.text(`Policy #: ${policyNumber}`, margin + 8, margin + 34);
      doc.text(`Date of Loss: ${dateOfLoss}`, margin + 200, margin + 34);
      doc.text(`Report Date: ${reportDate}`, margin + 380, margin + 34);

      doc.restore();
      return margin + headerHeight + 10;
    }

    function startNewPage(): number {
      doc.addPage();
      return renderPageHeader();
    }

    function ensureSpace(yPos: number, needed: number): number {
      if (yPos + needed > maxContentY) {
        return startNewPage();
      }
      return yPos;
    }

    function drawDamageAnnotations(entry: PhotoEntry, imgX: number, imgY: number, imgW: number, imgH: number) {
      const analysis = entry.photo.analysis as any;
      if (!analysis) return;

      const detections: DamageDetection[] = analysis.damageVisible || analysis.damageDetections || [];
      const withBbox = detections.filter(d => d.bbox && d.bbox.width > 0 && d.bbox.height > 0);
      if (withBbox.length === 0) return;

      doc.save();
      for (let i = 0; i < withBbox.length; i++) {
        const d = withBbox[i];
        const bbox = d.bbox!;
        const color = ANNOTATION_COLORS[i % ANNOTATION_COLORS.length];

        const rx = imgX + bbox.x * imgW;
        const ry = imgY + bbox.y * imgH;
        const rw = bbox.width * imgW;
        const rh = bbox.height * imgH;

        doc.lineWidth(2)
          .strokeColor(color.stroke)
          .rect(rx, ry, rw, rh)
          .stroke();

        const cornerSize = Math.min(8, rw * 0.15, rh * 0.15);
        doc.lineWidth(3).strokeColor(color.stroke);
        doc.moveTo(rx, ry + cornerSize).lineTo(rx, ry).lineTo(rx + cornerSize, ry).stroke();
        doc.moveTo(rx + rw - cornerSize, ry).lineTo(rx + rw, ry).lineTo(rx + rw, ry + cornerSize).stroke();
        doc.moveTo(rx + rw, ry + rh - cornerSize).lineTo(rx + rw, ry + rh).lineTo(rx + rw - cornerSize, ry + rh).stroke();
        doc.moveTo(rx + cornerSize, ry + rh).lineTo(rx, ry + rh).lineTo(rx, ry + rh - cornerSize).stroke();

        const label = (d.type || d.damageType || "Damage").toUpperCase();
        const sev = d.severity ? ` (${d.severity})` : "";
        const tagText = `${label}${sev}`;

        doc.font("Helvetica-Bold", 7);
        const tagW = doc.widthOfString(tagText) + 8;
        const tagH = 12;
        const tagX = rx;
        const tagY = ry > tagH + 2 ? ry - tagH - 1 : ry + rh + 1;

        doc.rect(tagX, tagY, tagW, tagH).fill(color.stroke);
        doc.font("Helvetica-Bold", 7)
          .fill("#FFFFFF")
          .text(tagText, tagX + 4, tagY + 2, { width: tagW - 8, lineBreak: false });
      }
      doc.restore();
    }

    let yPos = renderPageHeader();

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const analysis = entry.photo.analysis as any;
      const narrative = buildNarrativeText(analysis);
      const detections: DamageDetection[] = analysis?.damageVisible || analysis?.damageDetections || [];
      const hasDamage = detections.length > 0;

      if (i > 0) {
        yPos = startNewPage();
      }

      doc.font("Helvetica-Bold", 10)
        .fill(PDF_COLORS.labelText)
        .text(`${entry.index}.`, margin, yPos);

      doc.font("Helvetica-Bold", 10)
        .fill(PDF_COLORS.labelText)
        .text(getPhotoLabel(entry), margin + 20, yPos, { width: contentWidth - 20 });

      yPos += 16;

      doc.font("Helvetica", 8)
        .fill(PDF_COLORS.captionText)
        .text(`Room: ${entry.roomName}`, margin + 20, yPos);

      const dateTaken = formatDate(entry.photo.createdAt);
      if (dateTaken) {
        doc.text(`Date: ${dateTaken}`, margin + 200, yPos);
      }
      if (data.inspectorName) {
        doc.text(`Taken by: ${data.inspectorName}`, margin + 360, yPos);
      }

      yPos += 14;

      if (hasDamage) {
        const badgeText = `${detections.length} DAMAGE AREA${detections.length > 1 ? "S" : ""} IDENTIFIED`;
        doc.font("Helvetica-Bold", 7);
        const badgeW = doc.widthOfString(badgeText) + 12;
        doc.rect(margin + 20, yPos, badgeW, 14).fill(PDF_COLORS.damageBadge);
        doc.font("Helvetica-Bold", 7)
          .fill("#FFFFFF")
          .text(badgeText, margin + 26, yPos + 3, { width: badgeW - 12, lineBreak: false });
        yPos += 18;
      }

      const maxImgWidth = contentWidth - 40;
      const maxImgHeight = 320;

      if (entry.imageBuffer) {
        try {
          const img = doc.openImage(entry.imageBuffer);
          const scale = Math.min(maxImgWidth / img.width, maxImgHeight / img.height, 1);
          const imgW = img.width * scale;
          const imgH = img.height * scale;
          const imgX = margin + 20 + (maxImgWidth - imgW) / 2;

          doc.image(img, imgX, yPos, { width: imgW, height: imgH });

          drawDamageAnnotations(entry, imgX, yPos, imgW, imgH);

          yPos += imgH + 8;
        } catch (err) {
          logger.error("PhotoReport", `Failed to embed photo ${entry.photo.id} in PDF`, err);
          doc.rect(margin + 20, yPos, maxImgWidth, 200)
            .stroke(PDF_COLORS.borderColor);
          doc.font("Helvetica", 10)
            .fill("#999999")
            .text("[Photo could not be loaded]", margin + 20, yPos + 90, {
              width: maxImgWidth,
              align: "center",
            });
          yPos += 210;
        }
      } else {
        doc.rect(margin + 20, yPos, maxImgWidth, 200)
          .stroke(PDF_COLORS.borderColor);
        doc.font("Helvetica", 10)
          .fill("#999999")
          .text("[Photo not available]", margin + 20, yPos + 90, {
            width: maxImgWidth,
            align: "center",
          });
        yPos += 210;
      }

      if (narrative) {
        const narrativeWidth = contentWidth - 40;
        doc.font("Helvetica", 8);
        const textHeight = doc.heightOfString(narrative, { width: narrativeWidth - 16, lineGap: 2 });
        const boxHeight = textHeight + 14;

        yPos = ensureSpace(yPos, boxHeight + 5);

        doc.rect(margin + 20, yPos, narrativeWidth, boxHeight)
          .fill(PDF_COLORS.narrativeBg);
        doc.rect(margin + 20, yPos, narrativeWidth, boxHeight)
          .strokeColor(PDF_COLORS.borderColor)
          .lineWidth(0.5)
          .stroke();

        doc.font("Helvetica", 8)
          .fill(PDF_COLORS.labelText)
          .text(narrative, margin + 28, yPos + 7, {
            width: narrativeWidth - 16,
            lineGap: 2,
          });

        yPos += boxHeight + 8;
      }
    }

    const totalPages = doc.bufferedPageRange().count || 1;
    for (let p = 0; p < totalPages; p++) {
      doc.switchToPage(p);
      doc.font("Helvetica", 8)
        .fill("#999999")
        .text(
          `Page ${p + 1} of ${totalPages}`,
          margin,
          footerY,
          { width: contentWidth, align: "center" }
        );
    }

    if (entries.length === 0) {
      renderPageHeader();
      doc.font("Helvetica", 12)
        .fill(PDF_COLORS.labelText)
        .text("No photos captured for this inspection.", margin, 140, {
          width: contentWidth,
          align: "center",
        });
    }

    doc.end();
  });
}

// ─── DOCX Photo Report ──────────────────────────────────────────

export async function generatePhotoReportDOCX(data: PhotoReportData): Promise<Buffer> {
  const entries = await fetchPhotoBuffers(data.photos, data.rooms);

  const insuredName = data.claim?.insuredName || "N/A";
  const claimNumber = data.claim?.claimNumber || "N/A";
  const policyNumber = (data.claim as any)?.policyNumber || "N/A";
  const dateOfLoss = formatDate(data.claim?.dateOfLoss);
  const reportDate = formatDate(new Date());

  function makeHeaderParagraphs(): Paragraph[] {
    return [
      new Paragraph({
        children: [
          new TextRun({ text: "PHOTO REPORT", bold: true, size: 24, font: "Arial" }),
        ],
        spacing: { after: 80 },
      }),
      new Paragraph({
        children: [
          new TextRun({ text: `Insured: ${insuredName}`, size: 16, font: "Arial" }),
          new TextRun({ text: `     Claim #: ${claimNumber}`, size: 16, font: "Arial" }),
        ],
        spacing: { after: 40 },
      }),
      new Paragraph({
        children: [
          new TextRun({ text: `Policy #: ${policyNumber}`, size: 16, font: "Arial" }),
          new TextRun({ text: `     Date of Loss: ${dateOfLoss}`, size: 16, font: "Arial" }),
          new TextRun({ text: `     Report Date: ${reportDate}`, size: 16, font: "Arial" }),
        ],
        spacing: { after: 120 },
      }),
      new Paragraph({
        children: [],
        border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "333333" } },
        spacing: { after: 200 },
      }),
    ];
  }

  const sections: any[] = [];

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const children: Paragraph[] = [...makeHeaderParagraphs()];

    children.push(
      new Paragraph({
        children: [
          new TextRun({
            text: `${entry.index}. ${getPhotoLabel(entry)}`,
            bold: true,
            size: 22,
            font: "Arial",
          }),
        ],
        spacing: { before: 120, after: 60 },
      })
    );

    const metaParts: string[] = [`Room: ${entry.roomName}`];
    const dateTaken = formatDate(entry.photo.createdAt);
    if (dateTaken) metaParts.push(`Date: ${dateTaken}`);
    if (data.inspectorName) metaParts.push(`Taken by: ${data.inspectorName}`);

    children.push(
      new Paragraph({
        children: [
          new TextRun({
            text: metaParts.join("     "),
            size: 16,
            font: "Arial",
            color: "666666",
          }),
        ],
        spacing: { after: 100 },
      })
    );

    const analysis = entry.photo.analysis as any;
    const detections: DamageDetection[] = analysis?.damageVisible || analysis?.damageDetections || [];

    if (detections.length > 0) {
      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: `⚠ ${detections.length} DAMAGE AREA${detections.length > 1 ? "S" : ""} IDENTIFIED`,
              bold: true,
              size: 16,
              font: "Arial",
              color: "CC0000",
            }),
          ],
          spacing: { after: 80 },
        })
      );
    }

    if (entry.imageBuffer) {
      try {
        const imgType = entry.photo.storagePath?.toLowerCase().endsWith(".png") ? "png" : "jpg";
        children.push(
          new Paragraph({
            children: [
              new ImageRun({
                data: entry.imageBuffer,
                transformation: { width: 500, height: 340 },
                type: imgType as "jpg" | "png",
              }),
            ],
            alignment: AlignmentType.CENTER,
            spacing: { after: 100 },
          })
        );
      } catch (err) {
        logger.error("PhotoReport", `Failed to embed photo ${entry.photo.id} in DOCX`, err);
        children.push(
          new Paragraph({
            children: [
              new TextRun({
                text: "[Photo could not be loaded]",
                italics: true,
                size: 18,
                color: "999999",
                font: "Arial",
              }),
            ],
            alignment: AlignmentType.CENTER,
            spacing: { after: 80 },
          })
        );
      }
    } else {
      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: "[Photo not available]",
              italics: true,
              size: 18,
              color: "999999",
              font: "Arial",
            }),
          ],
          alignment: AlignmentType.CENTER,
          spacing: { after: 80 },
        })
      );
    }

    const narrative = buildNarrativeText(analysis);
    if (narrative) {
      const lines = narrative.split("\n");
      for (const line of lines) {
        const isBullet = line.startsWith("•");
        const isHeader = line.startsWith("Damage Findings:") || line.startsWith("Materials & Line Items:") || line.startsWith("Property Context:") || line.startsWith("Quality:");
        children.push(
          new Paragraph({
            children: [
              new TextRun({
                text: line,
                size: isHeader ? 17 : 16,
                bold: isHeader,
                font: "Arial",
                color: isHeader ? "333333" : "555555",
              }),
            ],
            spacing: { after: isBullet ? 20 : 60 },
            indent: isBullet ? { left: 200 } : undefined,
          })
        );
      }
    }

    if (detections.length > 0) {
      children.push(
        new Paragraph({
          children: [
            new TextRun({ text: "Damage Details:", bold: true, size: 18, font: "Arial", color: "333333" }),
          ],
          spacing: { before: 120, after: 60 },
        })
      );

      for (let di = 0; di < detections.length; di++) {
        const d = detections[di];
        const dtype = d.type || d.damageType || "Unknown";
        const sev = d.severity || "N/A";
        const conf = d.confidence != null ? `${Math.round(d.confidence * 100)}%` : "N/A";

        children.push(
          new Paragraph({
            children: [
              new TextRun({ text: `${di + 1}. ${dtype}`, bold: true, size: 16, font: "Arial" }),
              new TextRun({ text: `  |  Severity: ${sev}  |  Confidence: ${conf}`, size: 16, font: "Arial", color: "666666" }),
            ],
            spacing: { after: 20 },
          })
        );

        const notes = d.notes || d.description || "";
        if (notes) {
          children.push(
            new Paragraph({
              children: [
                new TextRun({ text: notes, size: 16, font: "Arial", color: "555555" }),
              ],
              indent: { left: 200 },
              spacing: { after: 40 },
            })
          );
        }
      }
    }

    sections.push({
      properties: {
        page: {
          size: { width: 12240, height: 15840 },
          margin: { top: 720, right: 720, bottom: 720, left: 720 },
        },
        ...(i > 0 ? { type: SectionType.NEXT_PAGE } : {}),
      },
      children,
      footers: {
        default: new Footer({
          children: [
            new Paragraph({
              children: [
                new TextRun({ text: "Page ", size: 16, font: "Arial", color: "999999" }),
                new TextRun({ children: [PageNumber.CURRENT], size: 16, font: "Arial", color: "999999" }),
                new TextRun({ text: " of ", size: 16, font: "Arial", color: "999999" }),
                new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 16, font: "Arial", color: "999999" }),
              ],
              alignment: AlignmentType.CENTER,
            }),
          ],
        }),
      },
    });
  }

  if (entries.length === 0) {
    sections.push({
      properties: {
        page: {
          size: { width: 12240, height: 15840 },
          margin: { top: 720, right: 720, bottom: 720, left: 720 },
        },
      },
      children: [
        ...makeHeaderParagraphs(),
        new Paragraph({
          children: [
            new TextRun({
              text: "No photos captured for this inspection.",
              size: 22,
              font: "Arial",
              color: "666666",
            }),
          ],
          alignment: AlignmentType.CENTER,
          spacing: { before: 400 },
        }),
      ],
    });
  }

  const document = new Document({ sections });

  const buffer = await Packer.toBuffer(document);
  return Buffer.from(buffer);
}
