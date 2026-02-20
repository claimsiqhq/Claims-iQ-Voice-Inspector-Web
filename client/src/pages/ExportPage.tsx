import React, { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, getAuthHeaders } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import AIReviewPanel from "@/components/AIReviewPanel";
import {
  FileSpreadsheet, FileText, Send, CheckCircle2,
  AlertTriangle, Download, Loader2, ChevronLeft, ShieldCheck,
  XCircle, Camera, FileImage,
} from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useSettings } from "@/hooks/use-settings";

export default function ExportPage({ params }: { params: { id: string } }) {
  const claimId = parseInt(params.id);
  const [, setLocation] = useLocation();

  const { toast } = useToast();
  const { settings } = useSettings();
  const allowEsxExport = settings.exportFormat !== "pdf";
  const allowPdfExport = settings.exportFormat !== "esx";
  const [esxUrl, setEsxUrl] = useState<string | null>(null);
  const [esxFileName, setEsxFileName] = useState("");

  const { data: claimData } = useQuery({
    queryKey: [`/api/claims/${claimId}`],
    enabled: !!claimId,
  });

  const claim = claimData as any;

  // Get active session (use GET to avoid creating new sessions on refetch)
  const { data: sessionData } = useQuery({
    queryKey: [`/api/claims/${claimId}/inspection/active`],
    enabled: !!claimId,
  });

  const sessionId = (sessionData as any)?.id || (sessionData as any)?.sessionId;

  // Validation
  const { data: validation, isLoading: validationLoading } = useQuery({
    queryKey: [`/api/inspection/${sessionId}/export/validate`],
    queryFn: async () => {
      const res = await apiRequest("POST", `/api/inspection/${sessionId}/export/validate`);
      return res.json();
    },
    enabled: !!sessionId,
  });

  const validationData = validation as any;
  const canExport = validationData?.canExport ?? false;
  const blockers = validationData?.blockers || [];
  const warnings = validationData?.warnings || [];
  const summary = validationData?.summary || {};

  // Session data for status
  const { data: inspectionData, refetch: refetchInspection } = useQuery({
    queryKey: [`/api/inspection/${sessionId}`],
    enabled: !!sessionId,
  });

  const inspectionSession = (inspectionData as any)?.session;
  const currentStatus = inspectionSession?.status || "active";

  // ESX Export
  const esxMutation = useMutation({
    mutationFn: async () => {
      const authHeaders = await getAuthHeaders();
      const res = await fetch(`/api/inspection/${sessionId}/export/esx`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to generate ESX export");
      const blob = await res.blob();
      const contentDisposition = res.headers.get("Content-Disposition");
      const fileName = contentDisposition?.match(/filename="(.+)"/)?.[1] || "export.esx";
      setEsxFileName(fileName);
      const url = URL.createObjectURL(blob);
      setEsxUrl(url);
      return url;
    },
    onError: (error: Error) => {
      toast({ title: "ESX export failed", description: error.message, variant: "destructive" });
    },
  });

  // PDF Export
  const pdfMutation = useMutation({
    mutationFn: async () => {
      const authHeaders = await getAuthHeaders();
      const res = await fetch(`/api/inspection/${sessionId}/export/pdf`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        credentials: "include",
      });

      if (!res.ok) {
        throw new Error("Failed to generate PDF");
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);

      const a = document.createElement("a");
      a.href = url;
      a.download = `${claim?.claimNumber || "inspection"}_report.pdf`;
      a.click();
      URL.revokeObjectURL(url);

      return { success: true, message: "PDF downloaded successfully" };
    },
    onError: (error: Error) => {
      toast({ title: "PDF export failed", description: error.message, variant: "destructive" });
    },
  });

  const photoReportPdfMutation = useMutation({
    mutationFn: async () => {
      const authHeaders = await getAuthHeaders();
      const res = await fetch(`/api/inspection/${sessionId}/export/photo-report/pdf`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to generate photo report PDF");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${claim?.claimNumber || "inspection"}_photo_report.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      return { success: true };
    },
    onError: (error: Error) => {
      toast({ title: "Photo report PDF failed", description: error.message, variant: "destructive" });
    },
  });

  const photoReportDocxMutation = useMutation({
    mutationFn: async () => {
      const authHeaders = await getAuthHeaders();
      const res = await fetch(`/api/inspection/${sessionId}/export/photo-report/docx`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to generate photo report Word doc");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${claim?.claimNumber || "inspection"}_photo_report.docx`;
      a.click();
      URL.revokeObjectURL(url);
      return { success: true };
    },
    onError: (error: Error) => {
      toast({ title: "Photo report Word export failed", description: error.message, variant: "destructive" });
    },
  });

  // Submit for Review
  const submitMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PATCH", `/api/inspection/${sessionId}/status`, { status: "submitted" });
      return res.json();
    },
    onSuccess: () => {
      refetchInspection();
    },
  });

  const handleEsxDownload = () => {
    if (esxUrl) {
      const a = document.createElement("a");
      a.href = esxUrl;
      a.download = esxFileName;
      a.click();
    }
  };


  return (
    <div className="min-h-screen bg-background flex flex-col pb-20" data-testid="export-page">
      {/* Header */}
      <div className="h-14 bg-white border-b border-border flex items-center px-3 md:px-5 shrink-0">
        <button onClick={() => setLocation(`/inspection/${claimId}/review`)} className="text-muted-foreground hover:text-foreground mr-2 md:mr-3 shrink-0">
          <ChevronLeft size={20} />
        </button>
        <div className="min-w-0">
          <h1 className="font-display font-bold text-foreground text-sm md:text-base">Export</h1>
          <p className="text-xs text-muted-foreground truncate">{claim?.claimNumber || `Claim #${claimId}`}</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 md:p-5 space-y-4 md:space-y-5 max-w-2xl mx-auto w-full">
        {/* Loading State */}
        {validationLoading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        )}

        {/* Blockers */}
        {!validationLoading && blockers.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="border-2 border-destructive rounded-xl p-5 bg-destructive/5"
          >
            <div className="flex items-center gap-2 mb-3">
              <XCircle size={20} className="text-destructive" />
              <h3 className="font-display font-bold text-destructive">Cannot Export</h3>
            </div>
            <ul className="space-y-1.5">
              {blockers.map((b: string, i: number) => (
                <li key={i} className="flex items-center gap-2 text-sm text-destructive">
                  <XCircle size={14} /> {b}
                </li>
              ))}
            </ul>
            <Button
              variant="outline"
              className="mt-4 border-destructive text-destructive hover:bg-destructive/10"
              onClick={() => setLocation(`/inspection/${claimId}/review`)}
            >
              Return to Review
            </Button>
          </motion.div>
        )}

        {/* Warnings */}
        {!validationLoading && canExport && warnings.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="border border-[#F59E0B]/40 rounded-lg p-3 bg-[#F59E0B]/5"
          >
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle size={16} className="text-[#F59E0B]" />
              <span className="text-sm font-semibold text-[#342A4F]">Warnings</span>
            </div>
            <ul className="space-y-1">
              {warnings.map((w: string, i: number) => (
                <li key={i} className="flex items-center gap-2 text-xs text-[#342A4F]">
                  <AlertTriangle size={10} className="text-[#F59E0B]" /> {w}
                </li>
              ))}
            </ul>
          </motion.div>
        )}

        {/* AI Review Panel */}
        {!validationLoading && sessionId && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 }}
          >
            <AIReviewPanel sessionId={sessionId} />
          </motion.div>
        )}

        {/* Card 1: ESX Export */}
        {!validationLoading && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className={cn(
              "border border-border rounded-xl p-4 md:p-6 bg-card",
              !canExport && "opacity-50 pointer-events-none",
              !allowEsxExport && "opacity-60"
            )}
          >
            <div className="flex items-start gap-3 md:gap-4">
              <div className="h-10 w-10 md:h-12 md:w-12 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <FileSpreadsheet size={20} className="text-primary md:hidden" />
                <FileSpreadsheet size={24} className="text-primary hidden md:block" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-display font-bold text-foreground text-base md:text-lg">
                  ESX for Xactimate
                  {(settings.exportFormat === "esx" || settings.exportFormat === "both") && (
                    <span className="ml-2 text-xs font-medium text-primary bg-primary/10 px-2 py-0.5 rounded-full">Preferred</span>
                  )}
                </h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Export estimate as Xactimate-compatible ESX file
                </p>
                {!allowEsxExport && (
                  <p className="text-xs text-muted-foreground mt-1">Disabled by your default Export Format setting.</p>
                )}
                <p className="text-xs text-muted-foreground mt-2">
                  {summary.lineItemCount || 0} line items &bull; {summary.roomCount || 0} rooms
                </p>

                <div className="mt-4 flex gap-2">
                  {!esxUrl ? (
                    <Button
                      className="bg-primary hover:bg-primary/90 text-primary-foreground"
                      onClick={() => esxMutation.mutate()}
                      disabled={esxMutation.isPending || !allowEsxExport}
                    >
                      {esxMutation.isPending ? (
                        <><Loader2 size={14} className="mr-1 animate-spin" /> Generating...</>
                      ) : (
                        <>Generate ESX</>
                      )}
                    </Button>
                  ) : (
                    <div className="flex items-center gap-2">
                      <CheckCircle2 size={16} className="text-[#22C55E]" />
                      <span className="text-sm text-[#22C55E] font-medium">{esxFileName}</span>
                      <Button size="sm" variant="outline" onClick={handleEsxDownload}>
                        <Download size={14} className="mr-1" /> Download
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </motion.div>
        )}

        {/* Card 2: PDF Report */}
        {!validationLoading && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className={cn(
              "border border-border rounded-xl p-4 md:p-6 bg-card",
              !canExport && "opacity-50 pointer-events-none",
              !allowPdfExport && "opacity-60"
            )}
          >
            <div className="flex items-start gap-3 md:gap-4">
              <div className="h-10 w-10 md:h-12 md:w-12 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <FileText size={20} className="text-primary md:hidden" />
                <FileText size={24} className="text-primary hidden md:block" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-display font-bold text-foreground text-base md:text-lg">
                  PDF Inspection Report
                  {(settings.exportFormat === "pdf" || settings.exportFormat === "both") && (
                    <span className="ml-2 text-xs font-medium text-primary bg-primary/10 px-2 py-0.5 rounded-full">Preferred</span>
                  )}
                </h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Professional inspection report with photos, damage documentation, and estimate
                </p>
                {!allowPdfExport && (
                  <p className="text-xs text-muted-foreground mt-1">Disabled by your default Export Format setting.</p>
                )}
                <p className="text-xs text-muted-foreground mt-2">
                  {summary.photoCount || 0} photos &bull; {summary.lineItemCount || 0} line items &bull; {summary.roomCount || 0} rooms
                </p>

                <div className="mt-4 flex gap-2">
                  <Button
                    className="bg-primary hover:bg-primary/90 text-primary-foreground"
                    onClick={() => pdfMutation.mutate()}
                    disabled={pdfMutation.isPending || !allowPdfExport}
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

        {/* Card 3: Photo Report */}
        {!validationLoading && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.25 }}
            className={cn(
              "border border-border rounded-xl p-4 md:p-6 bg-card",
              !canExport && "opacity-50 pointer-events-none"
            )}
          >
            <div className="flex items-start gap-3 md:gap-4">
              <div className="h-10 w-10 md:h-12 md:w-12 rounded-lg bg-[#22C55E]/10 flex items-center justify-center shrink-0">
                <Camera size={20} className="text-[#22C55E] md:hidden" />
                <Camera size={24} className="text-[#22C55E] hidden md:block" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-display font-bold text-foreground text-base md:text-lg" data-testid="text-photo-report-title">Photo Report</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Xactimate-style photo sheet with 2 photos per page, headers, sequential numbering, and captions
                </p>
                <p className="text-xs text-muted-foreground mt-2">
                  {summary.photoCount || 0} photos &bull; Includes insured name, claim #, and policy #
                </p>

                <div className="mt-4 flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    className="border-[#22C55E] text-[#22C55E] hover:bg-[#22C55E]/10"
                    onClick={() => photoReportPdfMutation.mutate()}
                    disabled={photoReportPdfMutation.isPending || photoReportDocxMutation.isPending}
                    data-testid="button-photo-report-pdf"
                  >
                    {photoReportPdfMutation.isPending ? (
                      <><Loader2 size={14} className="mr-1 animate-spin" /> Generating PDF...</>
                    ) : (
                      <><FileText size={14} className="mr-1" /> Download PDF</>
                    )}
                  </Button>
                  <Button
                    variant="outline"
                    className="border-primary text-primary hover:bg-primary/10"
                    onClick={() => photoReportDocxMutation.mutate()}
                    disabled={photoReportPdfMutation.isPending || photoReportDocxMutation.isPending}
                    data-testid="button-photo-report-docx"
                  >
                    {photoReportDocxMutation.isPending ? (
                      <><Loader2 size={14} className="mr-1 animate-spin" /> Generating Word...</>
                    ) : (
                      <><FileImage size={14} className="mr-1" /> Download Word</>
                    )}
                  </Button>
                  {(photoReportPdfMutation.isSuccess || photoReportDocxMutation.isSuccess) && (
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

        {/* Card 4: Submit for Review */}
        {!validationLoading && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className={cn(
              "border border-border rounded-xl p-4 md:p-6 bg-card",
              !canExport && "opacity-50 pointer-events-none"
            )}
          >
            <div className="flex items-start gap-3 md:gap-4">
              <div className="h-10 w-10 md:h-12 md:w-12 rounded-lg bg-[#C6A54E]/10 flex items-center justify-center shrink-0">
                <Send size={20} className="text-[#C6A54E] md:hidden" />
                <Send size={24} className="text-[#C6A54E] hidden md:block" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-display font-bold text-foreground text-base md:text-lg">Submit for Review</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Send to carrier or supervisor for approval
                </p>

                {/* Status Badge */}
                <div className="mt-3">
                  <StatusBadge status={currentStatus} />
                </div>

                <div className="mt-4">
                  {currentStatus === "submitted" || currentStatus === "approved" ? (
                    <div className="flex items-center gap-2">
                      <CheckCircle2 size={16} className="text-[#22C55E]" />
                      <span className="text-sm text-[#22C55E] font-medium">
                        {currentStatus === "approved" ? "Approved" : "Submitted for review"}
                      </span>
                    </div>
                  ) : (
                    <Button
                      className="bg-[#C6A54E] hover:bg-[#C6A54E]/90 text-[#342A4F] font-semibold"
                      onClick={() => submitMutation.mutate()}
                      disabled={submitMutation.isPending}
                    >
                      {submitMutation.isPending ? (
                        <><Loader2 size={14} className="mr-1 animate-spin" /> Submitting...</>
                      ) : (
                        <><ShieldCheck size={14} className="mr-1" /> Submit</>
                      )}
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </motion.div>
        )}

      </div>

      {/* Bottom Link */}
      <div className="h-12 bg-white border-t border-border flex items-center justify-center shrink-0">
        <button
          onClick={() => setLocation(`/inspection/${claimId}/review`)}
          className="text-sm text-primary hover:underline"
        >
          &larr; Back to Review
        </button>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { label: string; color: string; bg: string }> = {
    active: { label: "Draft", color: "#6B7280", bg: "#F3F4F6" },
    review: { label: "Under Review", color: "#7763B7", bg: "#7763B7/10" },
    submitted: { label: "Submitted", color: "#C6A54E", bg: "#C6A54E/10" },
    exported: { label: "Exported", color: "#7763B7", bg: "#7763B7/10" },
    approved: { label: "Approved", color: "#22C55E", bg: "#22C55E/10" },
    completed: { label: "Completed", color: "#22C55E", bg: "#22C55E/10" },
  };

  const c = config[status] || config.active;

  return (
    <span
      className="text-xs font-semibold px-2.5 py-1 rounded-full inline-flex items-center gap-1"
      style={{ backgroundColor: `${c.color}15`, color: c.color }}
    >
      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: c.color }} />
      {c.label}
    </span>
  );
}
