# PROMPT-08 — PDF Report Generation & Photo Annotation Canvas

> **Run this prompt in Replit after PROMPT-05 or later has been applied.**
> This prompt implements professional PDF report generation (server-side using pdfkit) and adds a photo annotation canvas overlay that allows adjusters to draw arrows, circles, rectangles, freehand lines, and text annotations directly on captured photos before inclusion in the PDF report.

---

## WHAT NOT TO CHANGE

The same frozen file lists from previous prompts apply. Additionally:

- Do NOT refactor the Realtime WebRTC connection logic
- Do NOT change the OpenAI Realtime schema or system instructions structure
- Do NOT modify the voice agent tool definitions beyond adding the photo annotation endpoint
- Do NOT change the existing export endpoints in `routes.ts` — we're replacing the PDF endpoint, not adding new ones

This prompt makes **surgical changes** to:
- `server/routes.ts` — Replace the PDF export endpoint with real PDF generation; add annotation save endpoint
- `shared/schema.ts` — already has `annotations` field (jsonb) in inspectionPhotos; we're just using it
- `client/src/components/PhotoGallery.tsx` — add "Annotate" button to photo viewer
- `client/src/pages/ExportPage.tsx` — integrate PDF generation with progress indicator
- Creates **new file:** `server/pdfGenerator.ts` — Professional PDF report builder
- Creates **new file:** `client/src/components/PhotoAnnotator.tsx` — Canvas-based annotation tool

---

## 1. INSTALL DEPENDENCIES

The project needs pdfkit (server-side PDF generation) and canvas manipulation libraries.

```bash
npm install pdfkit
npm install --save-dev @types/pdfkit
```

Verify the installation:

```bash
npm list pdfkit
```

---

## 2. CREATE `server/pdfGenerator.ts`

This file generates a professional, Claims IQ branded PDF inspection report with all inspection data.

### In `server/pdfGenerator.ts` (NEW FILE)

```typescript
import PDFDocument from "pdfkit";
import { Readable } from "stream";
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
  };
  inspectorName?: string;
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
      renderRoomDetail(doc, room, roomDamages, roomItems, roomPhotos, data.photos);
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

    doc.end();
  });
}

function renderCoverPage(doc: PDFDocument, data: PDFReportData) {
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
  doc.font(FONTS.normal, 8).fill("#6B7280").text("Generated by Claims IQ — Insurance Property Inspection Platform", 40, doc.page.height - 30);
}

function renderClaimInfo(doc: PDFDocument, data: PDFReportData) {
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
  doc: PDFDocument,
  room: InspectionRoom,
  damages: DamageObservation[],
  items: LineItem[],
  photos: InspectionPhoto[],
  allPhotos: InspectionPhoto[]
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
      const severityBg = dmg.severity === "Severe" ? COLORS.red : dmg.severity === "Moderate" ? COLORS.amber : COLORS.gold;
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
      const totalPrice = (item.quantity || 0) * (item.unitPrice || 0);
      doc.font(FONTS.normal, 9)
        .fill(COLORS.darkGray)
        .text(`${item.description}`, 50, yPos, { width: 350 });
      yPos += 12;

      doc.font(FONTS.mono, 8)
        .fill("#9CA3AF")
        .text(
          `${item.quantity} ${item.unit} @ $${(item.unitPrice || 0).toFixed(2)} = $${totalPrice.toFixed(2)}`,
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

      if (photo.analysis?.description) {
        doc.font(FONTS.normal, 7)
          .fill("#9CA3AF")
          .text(photo.analysis.description, 50, yPos, { width: 350 });
        yPos += 14;
      }

      if (yPos > 700) {
        doc.addPage();
        yPos = 40;
      }
    }
  }
}

function renderEstimateSummary(doc: PDFDocument, data: PDFReportData) {
  doc.font(FONTS.bold, 16).fill(COLORS.deep).text("Estimate Summary", 40, 40);
  doc.moveTo(40, 62).lineTo(doc.page.width - 40, 62).stroke(COLORS.primary);

  let yPos = 80;

  // Line items by category
  for (const cat of data.estimate.categories) {
    doc.font(FONTS.bold, 11).fill(COLORS.primary).text(cat.category, 40, yPos);
    yPos += 16;

    for (const item of cat.items) {
      const totalPrice = (item.quantity || 0) * (item.unitPrice || 0);
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

  // Totals box
  yPos += 10;
  doc.rect(40, yPos, doc.page.width - 80, 80).fill(COLORS.lightGray);

  doc.font(FONTS.normal, 10)
    .fill(COLORS.deepGray)
    .text("RCV (Replacement Cost Value):", 50, yPos + 10);
  doc.font(FONTS.bold, 12)
    .fill(COLORS.deep)
    .text(`$${data.estimate.totalRCV.toFixed(2)}`, 400, yPos + 10, { align: "right" });

  doc.font(FONTS.normal, 10)
    .fill(COLORS.darkGray)
    .text("Depreciation:", 50, yPos + 30);
  doc.font(FONTS.bold, 12)
    .fill(COLORS.deep)
    .text(`-$${data.estimate.totalDepreciation.toFixed(2)}`, 400, yPos + 30, { align: "right" });

  doc.font(FONTS.bold, 11)
    .fill(COLORS.primary)
    .text("ACV (Actual Cash Value):", 50, yPos + 50);
  doc.font(FONTS.bold, 14)
    .fill(COLORS.gold)
    .text(`$${data.estimate.totalACV.toFixed(2)}`, 400, yPos + 50, { align: "right" });
}

function renderPhotoAppendix(doc: PDFDocument, photos: InspectionPhoto[]) {
  doc.font(FONTS.bold, 16).fill(COLORS.deep).text("Photo Appendix", 40, 40);
  doc.moveTo(40, 62).lineTo(doc.page.width - 40, 62).stroke(COLORS.primary);

  let yPos = 80;

  for (const photo of photos) {
    doc.font(FONTS.bold, 10)
      .fill(COLORS.primary)
      .text(photo.caption || "Photo", 40, yPos);
    yPos += 14;

    if (photo.analysis?.description) {
      doc.font(FONTS.normal, 8)
        .fill(COLORS.darkGray)
        .text(photo.analysis.description, 40, yPos, { width: 480 });
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

function renderMoistureReport(doc: PDFDocument, readings: MoistureReading[]) {
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

function renderInfoRow(doc: PDFDocument, yPos: number, label: string, value: string) {
  doc.font(FONTS.bold, 10).fill(COLORS.primary).text(label, 40, yPos);
  doc.font(FONTS.normal, 10).fill(COLORS.darkGray).text(value, 150, yPos);
}
```

---

## 3. CREATE `client/src/components/PhotoAnnotator.tsx`

This component provides a canvas-based drawing interface for annotating photos.

### In `client/src/components/PhotoAnnotator.tsx` (NEW FILE)

```typescript
import React, { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
  X, RotateCcw, Undo2, Redo2,
  ArrowRight, Circle, Square, Pen, Type, Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";

export interface AnnotationShape {
  type: "arrow" | "circle" | "rectangle" | "freehand" | "text";
  color: string;
  lineWidth: number;
  points: Array<{ x: number; y: number }>;
  text?: string;
  fontSize?: number;
  x?: number;
  y?: number;
}

interface PhotoAnnotatorProps {
  imageUrl: string;
  imageBase64: string;
  photoCaption: string;
  onSaveAnnotations: (annotatedBase64: string, shapes: AnnotationShape[]) => void;
  onCancel: () => void;
}

const COLORS = ["#FF0000", "#FFFF00", "#0000FF", "#FFFFFF", "#000000"];
const LINE_WIDTHS = [2, 4, 8];
const TOOLS = ["arrow", "circle", "rectangle", "freehand", "text"] as const;

export default function PhotoAnnotator({
  imageUrl,
  imageBase64,
  photoCaption,
  onSaveAnnotations,
  onCancel,
}: PhotoAnnotatorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [shapes, setShapes] = useState<AnnotationShape[]>([]);
  const [undoStack, setUndoStack] = useState<AnnotationShape[][]>([]);
  const [redoStack, setRedoStack] = useState<AnnotationShape[][]>([]);

  const [selectedTool, setSelectedTool] = useState<typeof TOOLS[number]>("arrow");
  const [selectedColor, setSelectedColor] = useState(COLORS[0]);
  const [selectedLineWidth, setSelectedLineWidth] = useState(LINE_WIDTHS[1]);
  const [isDrawing, setIsDrawing] = useState(false);
  const [startPoint, setStartPoint] = useState<{ x: number; y: number } | null>(null);
  const [currentText, setCurrentText] = useState("");
  const [textInputPos, setTextInputPos] = useState<{ x: number; y: number } | null>(null);

  // Load image on mount
  useEffect(() => {
    const img = new Image();
    img.onload = () => setImage(img);
    img.src = imageUrl;
  }, [imageUrl]);

  // Draw canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !image) return;

    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Draw image
    ctx.drawImage(image, 0, 0);

    // Draw all shapes
    for (const shape of shapes) {
      drawShape(ctx, shape);
    }
  }, [image, shapes]);

  const drawShape = (ctx: CanvasRenderingContext2D, shape: AnnotationShape) => {
    ctx.strokeStyle = shape.color;
    ctx.fillStyle = shape.color;
    ctx.lineWidth = shape.lineWidth;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    if (shape.type === "freehand") {
      if (shape.points.length < 2) return;
      ctx.beginPath();
      ctx.moveTo(shape.points[0].x, shape.points[0].y);
      for (let i = 1; i < shape.points.length; i++) {
        ctx.lineTo(shape.points[i].x, shape.points[i].y);
      }
      ctx.stroke();
    } else if (shape.type === "arrow") {
      if (shape.points.length < 2) return;
      const start = shape.points[0];
      const end = shape.points[1];
      drawArrow(ctx, start.x, start.y, end.x, end.y, shape.lineWidth);
    } else if (shape.type === "circle") {
      if (shape.points.length < 2) return;
      const start = shape.points[0];
      const end = shape.points[1];
      const radius = Math.sqrt((end.x - start.x) ** 2 + (end.y - start.y) ** 2);
      ctx.beginPath();
      ctx.arc(start.x, start.y, radius, 0, 2 * Math.PI);
      ctx.stroke();
    } else if (shape.type === "rectangle") {
      if (shape.points.length < 2) return;
      const start = shape.points[0];
      const end = shape.points[1];
      ctx.strokeRect(start.x, start.y, end.x - start.x, end.y - start.y);
    } else if (shape.type === "text") {
      if (!shape.text) return;
      ctx.font = `${shape.fontSize || 16}px Arial`;
      ctx.fillText(shape.text, shape.x || 0, shape.y || 0);
    }
  };

  const drawArrow = (
    ctx: CanvasRenderingContext2D,
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    headlen: number
  ) => {
    const angle = Math.atan2(toY - fromY, toX - fromX);

    ctx.beginPath();
    ctx.moveTo(fromX, fromY);
    ctx.lineTo(toX, toY);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(toX, toY);
    ctx.lineTo(toX - headlen * Math.cos(angle - Math.PI / 6), toY - headlen * Math.sin(angle - Math.PI / 6));
    ctx.moveTo(toX, toY);
    ctx.lineTo(toX - headlen * Math.cos(angle + Math.PI / 6), toY - headlen * Math.sin(angle + Math.PI / 6));
    ctx.stroke();
  };

  const getCanvasPoint = (e: React.MouseEvent<HTMLCanvasElement>): { x: number; y: number } | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const point = getCanvasPoint(e);
    if (!point) return;

    if (selectedTool === "text") {
      setTextInputPos(point);
      return;
    }

    setIsDrawing(true);
    setStartPoint(point);
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing || !startPoint || selectedTool === "text") return;

    const point = getCanvasPoint(e);
    if (!point) return;

    if (selectedTool === "freehand") {
      const newShapes = [...shapes];
      if (newShapes.length === 0 || newShapes[newShapes.length - 1].type !== "freehand") {
        newShapes.push({
          type: "freehand",
          color: selectedColor,
          lineWidth: selectedLineWidth,
          points: [point],
        });
      } else {
        newShapes[newShapes.length - 1].points.push(point);
      }
      setShapes(newShapes);
    }
  };

  const handleMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing || !startPoint) return;

    const point = getCanvasPoint(e);
    if (!point) return;

    setIsDrawing(false);

    if (selectedTool !== "freehand") {
      const newShape: AnnotationShape = {
        type: selectedTool,
        color: selectedColor,
        lineWidth: selectedLineWidth,
        points: [startPoint, point],
      };
      addShape(newShape);
    }

    setStartPoint(null);
  };

  const addShape = (shape: AnnotationShape) => {
    const newShapes = [...shapes, shape];
    setUndoStack([...undoStack, shapes]);
    setRedoStack([]);
    setShapes(newShapes);
  };

  const undo = () => {
    if (undoStack.length === 0) return;
    const lastState = undoStack[undoStack.length - 1];
    setRedoStack([...redoStack, shapes]);
    setUndoStack(undoStack.slice(0, -1));
    setShapes(lastState);
  };

  const redo = () => {
    if (redoStack.length === 0) return;
    const nextState = redoStack[redoStack.length - 1];
    setUndoStack([...undoStack, shapes]);
    setRedoStack(redoStack.slice(0, -1));
    setShapes(nextState);
  };

  const handleSaveAnnotations = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const annotatedBase64 = canvas.toDataURL("image/jpeg", 0.95);
    onSaveAnnotations(annotatedBase64, shapes);
  };

  const handleAddText = () => {
    if (!currentText || !textInputPos) return;
    const shape: AnnotationShape = {
      type: "text",
      color: selectedColor,
      lineWidth: 0,
      points: [],
      text: currentText,
      fontSize: 20,
      x: textInputPos.x,
      y: textInputPos.y,
    };
    addShape(shape);
    setCurrentText("");
    setTextInputPos(null);
  };

  const handleClearAll = () => {
    if (confirm("Clear all annotations?")) {
      setShapes([]);
      setUndoStack([]);
      setRedoStack([]);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[70] bg-black/80 flex flex-col"
    >
      {/* Header */}
      <div className="h-14 bg-white border-b border-gray-300 flex items-center justify-between px-4">
        <div>
          <p className="text-sm font-semibold text-gray-900">{photoCaption}</p>
          <p className="text-xs text-gray-500">Annotate photo before saving</p>
        </div>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          <X size={18} />
        </Button>
      </div>

      {/* Canvas Area */}
      <div className="flex-1 flex items-center justify-center overflow-auto bg-black">
        {image && (
          <div className="relative">
            <canvas
              ref={canvasRef}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              className="max-w-full max-h-full cursor-crosshair border-2 border-white/20"
            />

            {/* Text Input Overlay */}
            {textInputPos && (
              <div
                className="absolute bg-white rounded shadow-lg p-2 flex gap-1"
                style={{
                  left: `${(textInputPos.x / (image?.width || 1)) * 100}%`,
                  top: `${(textInputPos.y / (image?.height || 1)) * 100}%`,
                }}
              >
                <input
                  type="text"
                  value={currentText}
                  onChange={(e) => setCurrentText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleAddText();
                    if (e.key === "Escape") setTextInputPos(null);
                  }}
                  autoFocus
                  className="px-2 py-1 border border-gray-300 rounded text-sm w-32"
                  placeholder="Enter text..."
                />
                <Button size="sm" onClick={handleAddText}>
                  Add
                </Button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Toolbar */}
      <div className="bg-white border-t border-gray-300 p-3 flex flex-wrap gap-3 items-center">
        {/* Tool Selection */}
        <div className="flex gap-1 border-r border-gray-300 pr-3">
          <Button
            size="sm"
            variant={selectedTool === "arrow" ? "default" : "outline"}
            onClick={() => setSelectedTool("arrow")}
            title="Arrow"
          >
            <ArrowRight size={16} />
          </Button>
          <Button
            size="sm"
            variant={selectedTool === "circle" ? "default" : "outline"}
            onClick={() => setSelectedTool("circle")}
            title="Circle"
          >
            <Circle size={16} />
          </Button>
          <Button
            size="sm"
            variant={selectedTool === "rectangle" ? "default" : "outline"}
            onClick={() => setSelectedTool("rectangle")}
            title="Rectangle"
          >
            <Square size={16} />
          </Button>
          <Button
            size="sm"
            variant={selectedTool === "freehand" ? "default" : "outline"}
            onClick={() => setSelectedTool("freehand")}
            title="Freehand"
          >
            <Pen size={16} />
          </Button>
          <Button
            size="sm"
            variant={selectedTool === "text" ? "default" : "outline"}
            onClick={() => setSelectedTool("text")}
            title="Text"
          >
            <Type size={16} />
          </Button>
        </div>

        {/* Color Selection */}
        <div className="flex gap-1 border-r border-gray-300 pr-3">
          {COLORS.map((color) => (
            <button
              key={color}
              onClick={() => setSelectedColor(color)}
              className={cn(
                "w-6 h-6 rounded border-2",
                selectedColor === color ? "border-black" : "border-gray-300"
              )}
              style={{ backgroundColor: color }}
              title={color}
            />
          ))}
        </div>

        {/* Line Width Selection */}
        <div className="flex gap-1 border-r border-gray-300 pr-3">
          {LINE_WIDTHS.map((width) => (
            <button
              key={width}
              onClick={() => setSelectedLineWidth(width)}
              className={cn(
                "px-2 py-1 rounded border text-xs font-medium",
                selectedLineWidth === width
                  ? "bg-gray-900 text-white border-gray-900"
                  : "bg-white text-gray-900 border-gray-300 hover:bg-gray-100"
              )}
            >
              {width}px
            </button>
          ))}
        </div>

        {/* Undo/Redo */}
        <Button
          size="sm"
          variant="outline"
          onClick={undo}
          disabled={undoStack.length === 0}
          title="Undo"
        >
          <Undo2 size={16} />
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={redo}
          disabled={redoStack.length === 0}
          title="Redo"
        >
          <Redo2 size={16} />
        </Button>

        <div className="flex-1" />

        {/* Clear & Save */}
        <Button size="sm" variant="outline" onClick={handleClearAll} className="text-red-600 hover:bg-red-50">
          <Trash2 size={14} className="mr-1" /> Clear All
        </Button>
        <Button
          size="sm"
          className="bg-green-600 hover:bg-green-700 text-white"
          onClick={handleSaveAnnotations}
        >
          Save Annotations
        </Button>
      </div>
    </motion.div>
  );
}
```

---

## 4. UPDATE `server/routes.ts`

Replace the PDF export endpoint with real PDF generation and add an annotation save endpoint.

### In `server/routes.ts`

**Find:** The `POST /api/inspection/:sessionId/export/pdf` endpoint (lines ~1342-1412)

**Replace with:**

```typescript
// ── PDF Export Data ─────────────────────────────────

app.post("/api/inspection/:sessionId/export/pdf", async (req, res) => {
  try {
    const sessionId = parseInt(req.params.sessionId);
    const session = await storage.getInspectionSession(sessionId);
    if (!session) return res.status(404).json({ message: "Session not found" });

    const claim = await storage.getClaim(session.claimId);
    const rooms = await storage.getRooms(sessionId);
    const items = await storage.getLineItems(sessionId);
    const photos = await storage.getPhotos(sessionId);
    const damages = await storage.getDamagesForSession(sessionId);
    const moisture = await storage.getMoistureReadingsForSession(sessionId);
    const estimate = await storage.getEstimateSummary(sessionId);

    // Import the PDF generator
    const { generateInspectionPDF } = await import("./pdfGenerator.js");

    // Build the data object for PDF generation
    const pdfData = {
      claim,
      session,
      rooms,
      damages,
      lineItems: items,
      photos,
      moistureReadings: moisture,
      estimate: {
        totalRCV: estimate?.totalRCV || 0,
        totalDepreciation: estimate?.totalDepreciation || 0,
        totalACV: estimate?.totalACV || 0,
        itemCount: items.length,
        categories: estimate?.categories || [],
      },
      inspectorName: "Claims IQ Agent",
    };

    // Generate the PDF buffer
    const pdfBuffer = await generateInspectionPDF(pdfData);

    // Send as attachment
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${claim?.claimNumber || "inspection"}_report.pdf"`
    );
    res.send(pdfBuffer);
  } catch (error: any) {
    console.error("PDF generation error:", error);
    res.status(500).json({ message: error.message });
  }
});

// ── Photo Annotations Endpoint ──────────────────────

app.put("/api/inspection/:sessionId/photos/:photoId/annotations", async (req, res) => {
  try {
    const photoId = parseInt(req.params.photoId);
    const { shapes, annotatedImageBase64 } = req.body;

    if (!shapes || !Array.isArray(shapes)) {
      return res.status(400).json({ message: "shapes array is required" });
    }

    // Save annotation data to the photo record
    const updatedPhoto = await storage.updatePhoto(photoId, {
      annotations: shapes,
    });

    // If annotatedImageBase64 is provided, optionally save it
    // (For now, we store only the shape data; you can extend this to store the image too)

    res.json({ success: true, photo: updatedPhoto });
  } catch (error: any) {
    console.error("Photo annotation save error:", error);
    res.status(500).json({ message: error.message });
  }
});
```

**Also verify:** The `storage.updatePhoto()` method exists in `server/storage.ts`. (It was added in PROMPT-05. If missing, add it now.)

---

## 5. UPDATE `client/src/components/PhotoGallery.tsx`

Add an "Annotate" button to the full-screen photo viewer and integrate the PhotoAnnotator component.

### In `client/src/components/PhotoGallery.tsx`

**Find:** The imports section at the top (lines ~1-18)

**Add to imports:**

```typescript
import { Pen } from "lucide-react";
import PhotoAnnotator from "./PhotoAnnotator";
```

**Find:** The useState declarations inside the component (around line 67-70)

**Add a new state:**

```typescript
const [annotatingPhoto, setAnnotatingPhoto] = useState<any>(null);
```

**Find:** The full-screen photo viewer section (the `<AnimatePresence>` around line 279-404)

**In the viewer header, after the close button (around line 295), add:**

```typescript
{currentPhoto && !annotatingPhoto && (
  <Button
    size="sm"
    variant="ghost"
    className="text-white/60 hover:text-white h-8 px-2"
    onClick={() => setAnnotatingPhoto(currentPhoto)}
    title="Annotate photo"
  >
    <Pen size={16} className="mr-1" />
    Annotate
  </Button>
)}
```

**At the end of the component (after the closing `</AnimatePresence>`), add the PhotoAnnotator modal:**

```typescript
{/* Photo Annotator Modal */}
<AnimatePresence>
  {annotatingPhoto && (
    <PhotoAnnotator
      imageUrl={annotatingPhoto.thumbnail || ""}
      imageBase64={annotatingPhoto.storagePath || ""}
      photoCaption={annotatingPhoto.caption || "Photo"}
      onSaveAnnotations={async (annotatedBase64, shapes) => {
        // Save annotation data to backend
        try {
          const res = await fetch(
            `/api/inspection/${sessionId}/photos/${annotatingPhoto.id}/annotations`,
            {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                shapes,
                annotatedImageBase64: annotatedBase64,
              }),
            }
          );
          if (res.ok) {
            // Update the photo in the gallery with the new annotated image
            setAnnotatingPhoto(null);
            // Optionally refresh the photos list
          }
        } catch (e) {
          console.error("Error saving annotations:", e);
        }
      }}
      onCancel={() => setAnnotatingPhoto(null)}
    />
  )}
</AnimatePresence>
```

You'll need access to `sessionId`. If it's not already available in PhotoGallery props, pass it through:

```typescript
interface PhotoGalleryProps {
  photos: PhotoData[];
  className?: string;
  sessionId?: number;  // Add this
}
```

---

## 6. UPDATE `client/src/pages/ExportPage.tsx`

Integrate PDF generation to return an actual PDF file instead of JSON preview.

### In `client/src/pages/ExportPage.tsx`

**Find:** The PDF mutation (lines ~85-96)

**Replace with:**

```typescript
// PDF Export
const pdfMutation = useMutation({
  mutationFn: async () => {
    const res = await fetch(`/api/inspection/${sessionId}/export/pdf`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });

    if (!res.ok) {
      throw new Error("Failed to generate PDF");
    }

    // Get the PDF as a blob
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);

    // Trigger download
    const a = document.createElement("a");
    a.href = url;
    a.download = `${claim?.claimNumber || "inspection"}_report.pdf`;
    a.click();
    URL.revokeObjectURL(url);

    return { success: true, message: "PDF downloaded successfully" };
  },
});
```

**Find:** The PDF card UI (lines ~245-296)

**Replace the button section with:**

```typescript
{/* Card 2: PDF Report */}
{!validationLoading && (
  <motion.div
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ delay: 0.2 }}
    className={cn(
      "border border-border rounded-xl p-4 md:p-6 bg-card",
      !canExport && "opacity-50 pointer-events-none"
    )}
  >
    <div className="flex items-start gap-3 md:gap-4">
      <div className="h-10 w-10 md:h-12 md:w-12 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
        <FileText size={20} className="text-primary md:hidden" />
        <FileText size={24} className="text-primary hidden md:block" />
      </div>
      <div className="flex-1 min-w-0">
        <h3 className="font-display font-bold text-foreground text-base md:text-lg">PDF Inspection Report</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Professional inspection report with photos, damage documentation, and estimate
        </p>
        <p className="text-xs text-muted-foreground mt-2">
          {summary.photoCount || 0} photos &bullet; {summary.lineItemCount || 0} line items &bullet; {summary.roomCount || 0} rooms
        </p>

        <div className="mt-4 flex gap-2">
          <Button
            className="bg-primary hover:bg-primary/90 text-primary-foreground"
            onClick={() => pdfMutation.mutate()}
            disabled={pdfMutation.isPending}
          >
            {pdfMutation.isPending ? (
              <><Loader2 size={14} className="mr-1 animate-spin" /> Generating PDF...</>
            ) : (
              <>Generate & Download PDF</>
            )}
          </Button>
          {pdfMutation.isSuccess && (
            <div className="flex items-center gap-2">
              <CheckCircle2 size={16} className="text-[#22C55E]" />
              <span className="text-sm text-[#22C55E] font-medium">Downloaded</span>
            </div>
          )}
        </div>
      </div>
    </div>
  </motion.div>
)}
```

---

## 7. UPDATE `package.json` (Verify Dependencies)

Verify that pdfkit is now listed in dependencies:

```bash
npm list | grep pdfkit
```

Should output something like:
```
└── pdfkit@0.13.0
```

If not listed, the install from Step 1 will add it.

---

## 8. SCHEMA MIGRATION (Already Exists)

The `inspectionPhotos` table already has `annotations` (jsonb) and `matchesRequest` (boolean) columns from PROMPT-05. No schema changes needed.

---

## 9. TESTING CHECKLIST

### PDF Generation
1. Complete a full inspection with multiple rooms, damages, and line items
2. Navigate to the Export page
3. Click "Generate & Download PDF"
   - PDF download starts ✓
   - File named correctly (claimNumber_report.pdf) ✓
4. Open the PDF and verify:
   - Cover page with claim info and estimate snapshot ✓
   - Claim information page ✓
   - Room-by-room details with damages and line items ✓
   - Estimate summary with category breakdown and totals ✓
   - Photo appendix with captions and AI analysis ✓
   - Moisture report (if water peril) ✓
   - Claims IQ branding (purple/gold colors) ✓
   - All text legible and properly formatted ✓

### Photo Annotation
1. Open a photo in the gallery full-screen viewer
2. Click the "Annotate" button
   - Annotation canvas opens with the photo ✓
   - Toolbar shows all tools: arrow, circle, rectangle, freehand, text ✓
   - Color picker shows all 5 colors ✓
   - Line width selector shows thin/medium/thick ✓

3. Draw shapes:
   - Select "Arrow" tool, draw from point A to point B → arrow appears ✓
   - Select "Circle" tool, draw from center outward → circle appears ✓
   - Select "Rectangle" tool, draw diagonal → rectangle appears ✓
   - Select "Freehand" tool, draw freely → line follows mouse ✓
   - Select "Text" tool, click on canvas, type text → text appears ✓

4. Use controls:
   - Change color and draw again → new shape uses selected color ✓
   - Change line width and draw → line width changes ✓
   - Click Undo → last shape disappears ✓
   - Click Redo → shape reappears ✓
   - Click "Clear All" → all shapes removed ✓

5. Save annotations:
   - Click "Save Annotations"
   - Annotation shapes saved to backend ✓
   - Canvas closes and returns to gallery ✓
   - Annotated image is now associated with the photo ✓

### PDF with Annotated Photos
1. Complete inspection with annotated photos
2. Export to PDF
3. Open PDF and navigate to Photo Appendix
   - Annotated versions of photos appear (if images are embedded) ✓
   - Photo captions and AI analysis still displayed ✓

---

## 10. FILE CHECKLIST

| File | Action | What Changed |
|---|---|---|
| `shared/schema.ts` | No change | `annotations` already exists |
| `server/pdfGenerator.ts` | NEW | Professional PDF report builder with 6+ sections |
| `server/routes.ts` | MODIFIED | Replaced PDF endpoint with real generation; added annotation save endpoint |
| `client/src/components/PhotoAnnotator.tsx` | NEW | Canvas-based annotation tool with arrow/circle/rectangle/freehand/text |
| `client/src/components/PhotoGallery.tsx` | MODIFIED | Added "Annotate" button to photo viewer; integrated PhotoAnnotator modal |
| `client/src/pages/ExportPage.tsx` | MODIFIED | PDF mutation now downloads real PDF file instead of showing JSON preview |
| `package.json` | MODIFIED | pdfkit and @types/pdfkit added to dependencies |

---

## 11. DEPLOYMENT NOTES

### Environment Variables
- Ensure `OPENAI_API_KEY` is set (already required for vision analysis from PROMPT-05)
- No new environment variables needed for PDF generation

### Database
- No schema migrations needed (columns already exist)
- Photo annotations stored in existing `annotations` jsonb field

### Performance
- PDF generation is synchronous; large inspections (50+ rooms, 200+ line items) may take 3-5 seconds
- Consider adding a loading state if PDF takes >2 seconds (already present in ExportPage)

---

## Summary

PROMPT-08 adds two major features:

**Professional PDF Reports:** Using pdfkit, we generate a branded Claims IQ inspection report with:
- Cover page with claim summary and estimate overview
- Claim information and property details
- Room-by-room breakdown with damages, line items, and photos
- Estimate summary with category subtotals and ACV/RCV calculation
- Photo appendix with AI analysis notes
- Moisture report (if applicable)

**Photo Annotation Canvas:** Adjusters can now draw directly on captured photos:
- Multiple tools: arrows, circles, rectangles, freehand drawing, text
- Color and line width options
- Undo/redo stack
- Annotations saved as JSON shapes and optionally as modified images
- Tight integration with the photo gallery
- Mobile-friendly touch support
