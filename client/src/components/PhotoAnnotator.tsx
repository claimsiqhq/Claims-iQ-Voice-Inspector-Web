import React, { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  X, Undo2, Redo2,
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
  const shapesBeforeStroke = useRef<AnnotationShape[]>([]);

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

  const getCanvasPoint = (clientX: number, clientY: number): { x: number; y: number } | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY,
    };
  };

  // --- Shared drawing logic used by both mouse and touch handlers ---

  const handleDrawStart = (clientX: number, clientY: number) => {
    const point = getCanvasPoint(clientX, clientY);
    if (!point) return;

    if (selectedTool === "text") {
      setTextInputPos(point);
      return;
    }

    shapesBeforeStroke.current = shapes;
    setIsDrawing(true);
    setStartPoint(point);
  };

  const handleDrawMove = (clientX: number, clientY: number) => {
    if (!isDrawing || !startPoint || selectedTool === "text") return;

    const point = getCanvasPoint(clientX, clientY);
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

  const handleDrawEnd = (clientX: number, clientY: number) => {
    if (!isDrawing || !startPoint) return;

    const point = getCanvasPoint(clientX, clientY);
    if (!point) return;

    setIsDrawing(false);

    if (selectedTool === "freehand") {
      // Push the pre-stroke shapes onto the undo stack so freehand strokes
      // can be undone just like every other tool.
      setUndoStack([...undoStack, shapesBeforeStroke.current]);
      setRedoStack([]);
    } else {
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

  // --- Mouse event handlers ---

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    handleDrawStart(e.clientX, e.clientY);
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    handleDrawMove(e.clientX, e.clientY);
  };

  const handleMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    handleDrawEnd(e.clientX, e.clientY);
  };

  // --- Touch event handlers ---

  const handleTouchStart = (e: React.TouchEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const touch = e.touches[0];
    handleDrawStart(touch.clientX, touch.clientY);
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const touch = e.touches[0];
    handleDrawMove(touch.clientX, touch.clientY);
  };

  const handleTouchEnd = (e: React.TouchEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    // Use changedTouches because touches list is empty on touchend
    const touch = e.changedTouches[0];
    handleDrawEnd(touch.clientX, touch.clientY);
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
              onTouchStart={handleTouchStart}
              onTouchMove={handleTouchMove}
              onTouchEnd={handleTouchEnd}
              className="max-w-full max-h-full cursor-crosshair border-2 border-white/20 touch-none"
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
