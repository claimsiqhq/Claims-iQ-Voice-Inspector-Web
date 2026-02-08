import PDFDocument from "pdfkit";
import {
  Document, Packer, Paragraph, TextRun, ImageRun, Table, TableRow, TableCell,
  WidthType, AlignmentType, BorderStyle, Header, PageNumber, NumberFormat,
  Footer, HeadingLevel, SectionType,
} from "docx";
import { InspectionPhoto, InspectionRoom, Claim, InspectionSession } from "../shared/schema";
import { supabase, PHOTOS_BUCKET } from "./supabase";

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
        console.error(`Failed to download photo ${photo.id}:`, err);
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

// ─── PDF Photo Report ───────────────────────────────────────────

const PDF_COLORS = {
  headerBg: "#1a1a2e",
  headerText: "#FFFFFF",
  labelText: "#333333",
  captionText: "#555555",
  borderColor: "#cccccc",
  pageBg: "#FFFFFF",
};

export async function generatePhotoReportPDF(data: PhotoReportData): Promise<Buffer> {
  const entries = await fetchPhotoBuffers(data.photos, data.rooms);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "letter",
      margin: 36,
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

    const insuredName = data.claim?.insuredName || "N/A";
    const claimNumber = data.claim?.claimNumber || "N/A";
    const policyNumber = (data.claim as any)?.policyNumber || "N/A";
    const dateOfLoss = formatDate(data.claim?.dateOfLoss);
    const reportDate = formatDate(new Date());

    function renderPageHeader() {
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

    function renderPageFooter(pageNum: number, totalPages: number) {
      doc.font("Helvetica", 8)
        .fill("#999999")
        .text(
          `Page ${pageNum} of ${totalPages}`,
          margin,
          pageHeight - margin - 10,
          { width: contentWidth, align: "center" }
        );
    }

    const photosPerPage = 2;
    const totalPages = Math.ceil(entries.length / photosPerPage);
    let pageNum = 0;

    for (let i = 0; i < entries.length; i += photosPerPage) {
      if (i > 0) doc.addPage();
      pageNum++;

      let yPos = renderPageHeader();

      const pagePhotos = entries.slice(i, i + photosPerPage);

      for (let j = 0; j < pagePhotos.length; j++) {
        const entry = pagePhotos[j];
        const photoAreaHeight = 290;

        doc.font("Helvetica-Bold", 9)
          .fill(PDF_COLORS.labelText)
          .text(`${entry.index}.`, margin, yPos);

        doc.font("Helvetica-Bold", 9)
          .fill(PDF_COLORS.labelText)
          .text(getPhotoLabel(entry), margin + 18, yPos, { width: contentWidth - 18 });

        yPos += 14;

        doc.font("Helvetica", 8)
          .fill(PDF_COLORS.captionText)
          .text(`Room: ${entry.roomName}`, margin + 18, yPos);

        const dateTaken = formatDate(entry.photo.createdAt);
        if (dateTaken) {
          doc.text(`Date: ${dateTaken}`, margin + 200, yPos);
        }

        if (data.inspectorName) {
          doc.text(`Taken by: ${data.inspectorName}`, margin + 360, yPos);
        }

        yPos += 14;

        if (entry.imageBuffer) {
          try {
            const maxImgWidth = contentWidth - 36;
            const maxImgHeight = photoAreaHeight - 50;
            doc.image(entry.imageBuffer, margin + 18, yPos, {
              fit: [maxImgWidth, maxImgHeight],
              align: "center",
              valign: "center",
            });
          } catch (err) {
            console.error(`Failed to embed photo ${entry.photo.id} in PDF:`, err);
            doc.rect(margin + 18, yPos, contentWidth - 36, photoAreaHeight - 50)
              .stroke(PDF_COLORS.borderColor);
            doc.font("Helvetica", 10)
              .fill("#999999")
              .text("[Photo could not be loaded]", margin + 18, yPos + 80, {
                width: contentWidth - 36,
                align: "center",
              });
          }
        } else {
          doc.rect(margin + 18, yPos, contentWidth - 36, photoAreaHeight - 50)
            .stroke(PDF_COLORS.borderColor);
          doc.font("Helvetica", 10)
            .fill("#999999")
            .text("[Photo not available]", margin + 18, yPos + 80, {
              width: contentWidth - 36,
              align: "center",
            });
        }

        yPos += photoAreaHeight - 35;

        const analysis = entry.photo.analysis as any;
        if (analysis?.description) {
          doc.font("Helvetica", 8)
            .fill(PDF_COLORS.captionText)
            .text(analysis.description, margin + 18, yPos, {
              width: contentWidth - 36,
              lineGap: 2,
            });
          yPos += 20;
        }

        yPos += 15;
      }

      renderPageFooter(pageNum, totalPages);
    }

    if (entries.length === 0) {
      renderPageHeader();
      doc.font("Helvetica", 12)
        .fill(PDF_COLORS.labelText)
        .text("No photos captured for this inspection.", margin, 140, {
          width: contentWidth,
          align: "center",
        });
      renderPageFooter(1, 1);
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
  const photosPerPage = 2;

  for (let i = 0; i < entries.length; i += photosPerPage) {
    const pagePhotos = entries.slice(i, i + photosPerPage);
    const children: Paragraph[] = [...makeHeaderParagraphs()];

    for (const entry of pagePhotos) {
      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: `${entry.index}. ${getPhotoLabel(entry)}`,
              bold: true,
              size: 20,
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

      if (entry.imageBuffer) {
        try {
          const imgType = entry.photo.storagePath?.toLowerCase().endsWith(".png") ? "png" : "jpg";
          children.push(
            new Paragraph({
              children: [
                new ImageRun({
                  data: entry.imageBuffer,
                  transformation: { width: 480, height: 320 },
                  type: imgType as "jpg" | "png",
                }),
              ],
              alignment: AlignmentType.CENTER,
              spacing: { after: 80 },
            })
          );
        } catch (err) {
          console.error(`Failed to embed photo ${entry.photo.id} in DOCX:`, err);
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

      const analysis = entry.photo.analysis as any;
      if (analysis?.description) {
        children.push(
          new Paragraph({
            children: [
              new TextRun({
                text: analysis.description,
                size: 16,
                font: "Arial",
                color: "555555",
              }),
            ],
            spacing: { after: 160 },
          })
        );
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
