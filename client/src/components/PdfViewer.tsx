import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut, X, Loader2, FileText } from "lucide-react";
import * as pdfjsLib from "pdfjs-dist";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

interface PdfViewerProps {
  urls: string[];
  fileName?: string;
  onClose: () => void;
}

export default function PdfViewer({ urls, fileName, onClose }: PdfViewerProps) {
  const [pages, setPages] = useState<{ pageNum: number; docIndex: number }[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [scale, setScale] = useState(1.2);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pdfDocsRef = useRef<any[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function loadPdfs() {
      setLoading(true);
      setError(null);
      try {
        const docs: any[] = [];
        const allPages: { pageNum: number; docIndex: number }[] = [];
        let pageOffset = 0;

        for (let i = 0; i < urls.length; i++) {
          const pdf = await pdfjsLib.getDocument(urls[i]).promise;
          docs.push(pdf);
          for (let p = 1; p <= pdf.numPages; p++) {
            allPages.push({ pageNum: p, docIndex: i });
          }
          pageOffset += pdf.numPages;
        }

        if (!cancelled) {
          pdfDocsRef.current = docs;
          setPages(allPages);
          setTotalPages(allPages.length);
          setCurrentPage(1);
          setLoading(false);
        }
      } catch (e: unknown) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load PDF");
          setLoading(false);
        }
      }
    }
    loadPdfs();
    return () => { cancelled = true; };
  }, [urls]);

  const renderPage = useCallback(async (pageIndex: number) => {
    if (!canvasRef.current || pages.length === 0 || pageIndex < 1 || pageIndex > pages.length) return;
    const { pageNum, docIndex } = pages[pageIndex - 1];
    const pdf = pdfDocsRef.current[docIndex];
    if (!pdf) return;

    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale });
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvas.height = viewport.height;
    canvas.width = viewport.width;

    await page.render({ canvasContext: ctx, viewport }).promise;
  }, [pages, scale]);

  useEffect(() => {
    if (!loading && pages.length > 0) {
      renderPage(currentPage);
    }
  }, [currentPage, loading, pages, renderPage]);

  const prevPage = () => setCurrentPage(p => Math.max(1, p - 1));
  const nextPage = () => setCurrentPage(p => Math.min(totalPages, p + 1));
  const zoomIn = () => setScale(s => Math.min(3, s + 0.3));
  const zoomOut = () => setScale(s => Math.max(0.5, s - 0.3));

  return (
    <div className="flex flex-col h-full bg-background">
      <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/30">
        <div className="flex items-center gap-2 min-w-0">
          <FileText className="h-4 w-4 text-primary shrink-0" />
          <span className="text-sm font-medium truncate">{fileName || "Document"}</span>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={zoomOut} data-testid="button-zoom-out">
            <ZoomOut className="h-4 w-4" />
          </Button>
          <span className="text-xs text-muted-foreground w-12 text-center">{Math.round(scale * 100)}%</span>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={zoomIn} data-testid="button-zoom-in">
            <ZoomIn className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8 ml-2" onClick={onClose} data-testid="button-close-pdf">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Loading document...</p>
          </div>
        </div>
      ) : error ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-3 text-center px-4">
            <FileText className="h-10 w-10 text-muted-foreground/40" />
            <p className="text-sm text-destructive">{error}</p>
            <Button variant="outline" size="sm" onClick={onClose}>Close</Button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex-1 overflow-auto flex justify-center p-4 bg-muted/10">
            <canvas
              ref={canvasRef}
              className="shadow-lg rounded-sm max-w-full"
              style={{ height: "auto" }}
              data-testid="canvas-pdf-page"
            />
          </div>

          <div className="flex items-center justify-center gap-3 px-4 py-2 border-t bg-muted/30">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={prevPage}
              disabled={currentPage <= 1}
              data-testid="button-prev-page"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm text-muted-foreground">
              Page <span className="font-medium text-foreground">{currentPage}</span> of {totalPages}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={nextPage}
              disabled={currentPage >= totalPages}
              data-testid="button-next-page"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
