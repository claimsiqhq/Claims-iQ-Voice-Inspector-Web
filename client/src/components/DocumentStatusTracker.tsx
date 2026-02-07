import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { FileText, Upload, Loader2, Brain, CheckCircle2, Circle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Link } from "wouter";

interface DocStatus {
  documentId: number;
  documentType: string;
  fileName: string | null;
  stage: "empty" | "uploaded" | "processing" | "extracted" | "reviewed";
}

interface ClaimDocSummary {
  claimId: number;
  claimNumber: string;
  insuredName: string | null;
  documents: DocStatus[];
}

const STAGES = ["uploaded", "processing", "extracted", "reviewed"] as const;

const STAGE_CONFIG: Record<string, { label: string; icon: typeof Upload; color: string; bgColor: string }> = {
  uploaded: { label: "Uploaded", icon: Upload, color: "text-blue-600", bgColor: "bg-blue-100" },
  processing: { label: "Processing", icon: Loader2, color: "text-amber-600", bgColor: "bg-amber-100" },
  extracted: { label: "Extracted", icon: Brain, color: "text-purple-600", bgColor: "bg-purple-100" },
  reviewed: { label: "Reviewed", icon: CheckCircle2, color: "text-emerald-600", bgColor: "bg-emerald-100" },
};

const DOC_TYPE_LABELS: Record<string, string> = {
  fnol: "FNOL / Claim Report",
  policy: "Policy Form",
  endorsement: "Endorsements",
};

function StageIndicator({ stage }: { stage: string }) {
  const stageIndex = STAGES.indexOf(stage as any);

  return (
    <div className="flex items-center gap-0.5">
      {STAGES.map((s, i) => {
        const config = STAGE_CONFIG[s];
        const Icon = config.icon;
        const isActive = i <= stageIndex;
        const isCurrent = i === stageIndex;

        return (
          <div key={s} className="flex items-center">
            {i > 0 && (
              <div
                className={cn(
                  "h-0.5 w-3 md:w-5 transition-colors",
                  isActive ? "bg-emerald-400" : "bg-gray-200"
                )}
              />
            )}
            <div className="relative group">
              <div
                className={cn(
                  "h-6 w-6 md:h-7 md:w-7 rounded-full flex items-center justify-center transition-all",
                  isCurrent ? `${config.bgColor} ${config.color} ring-2 ring-offset-1 ring-current` :
                  isActive ? "bg-emerald-100 text-emerald-600" :
                  "bg-gray-100 text-gray-300"
                )}
              >
                {isActive ? (
                  <Icon className={cn("h-3 w-3 md:h-3.5 md:w-3.5", s === "processing" && isCurrent && "animate-spin")} />
                ) : (
                  <Circle className="h-3 w-3 md:h-3.5 md:w-3.5" />
                )}
              </div>
              <span className={cn(
                "absolute -bottom-5 left-1/2 -translate-x-1/2 text-[9px] md:text-[10px] whitespace-nowrap font-medium transition-colors",
                isCurrent ? config.color : isActive ? "text-emerald-600" : "text-gray-300"
              )}>
                {config.label}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DocTypeIcon({ type }: { type: string }) {
  const colors: Record<string, string> = {
    fnol: "bg-blue-100 text-blue-700",
    policy: "bg-purple-100 text-purple-700",
    endorsement: "bg-amber-100 text-amber-700",
  };
  return (
    <div className={cn("h-8 w-8 rounded-lg flex items-center justify-center shrink-0", colors[type] || "bg-gray-100 text-gray-700")}>
      <FileText className="h-4 w-4" />
    </div>
  );
}

export default function DocumentStatusTracker() {
  const { data: summaries = [], isLoading } = useQuery<ClaimDocSummary[]>({
    queryKey: ["/api/documents/status-summary"],
    refetchInterval: 10000,
  });

  if (isLoading) {
    return (
      <Card className="p-5 border-border">
        <div className="flex items-center gap-3">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
          <span className="text-sm text-muted-foreground">Loading document status...</span>
        </div>
      </Card>
    );
  }

  if (summaries.length === 0) return null;

  const totalDocs = summaries.reduce((sum, s) => sum + s.documents.length, 0);
  const reviewedDocs = summaries.reduce((sum, s) => sum + s.documents.filter(d => d.stage === "reviewed").length, 0);
  const extractedDocs = summaries.reduce((sum, s) => sum + s.documents.filter(d => d.stage === "extracted").length, 0);
  const processingDocs = summaries.reduce((sum, s) => sum + s.documents.filter(d => d.stage === "processing").length, 0);

  return (
    <Card className="border-border overflow-hidden" data-testid="card-document-status-tracker">
      <div className="px-4 md:px-5 pt-4 md:pt-5 pb-3 border-b border-border/50">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <FileText className="h-4 w-4 text-primary" />
            </div>
            <div>
              <h3 className="font-display font-semibold text-sm md:text-base text-foreground">Document Status</h3>
              <p className="text-[11px] md:text-xs text-muted-foreground" data-testid="text-doc-summary-count">{totalDocs} document{totalDocs !== 1 ? "s" : ""} across {summaries.length} claim{summaries.length !== 1 ? "s" : ""}</p>
            </div>
          </div>
          <div className="flex items-center gap-3 text-[11px] md:text-xs">
            {processingDocs > 0 && (
              <span className="flex items-center gap-1 text-amber-600 font-medium">
                <Loader2 className="h-3 w-3 animate-spin" />
                {processingDocs} processing
              </span>
            )}
            {extractedDocs > 0 && (
              <span className="flex items-center gap-1 text-purple-600 font-medium">
                <Brain className="h-3 w-3" />
                {extractedDocs} to review
              </span>
            )}
            {reviewedDocs > 0 && (
              <span className="flex items-center gap-1 text-emerald-600 font-medium">
                <CheckCircle2 className="h-3 w-3" />
                {reviewedDocs} done
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="divide-y divide-border/30">
        {summaries.map((summary) => (
          <Link
            key={summary.claimId}
            href={`/review/${summary.claimId}`}
            className="block hover:bg-muted/30 transition-colors"
            data-testid={`link-claim-review-${summary.claimId}`}
          >
            <div className="px-4 md:px-5 py-3">
              <div className="flex items-center gap-2 mb-2.5">
                <span className="font-mono text-[11px] md:text-xs font-semibold text-foreground/60 tracking-wide" data-testid={`text-tracker-claim-${summary.claimId}`}>
                  {summary.claimNumber}
                </span>
                {summary.insuredName && (
                  <>
                    <span className="text-muted-foreground/30">|</span>
                    <span className="text-xs text-muted-foreground truncate" data-testid={`text-tracker-insured-${summary.claimId}`}>{summary.insuredName}</span>
                  </>
                )}
              </div>
              <div className="space-y-2.5">
                {summary.documents
                  .filter(doc => doc.stage !== "empty")
                  .map((doc) => (
                  <div key={doc.documentId} className="flex items-center gap-3" data-testid={`status-doc-${doc.documentId}`}>
                    <DocTypeIcon type={doc.documentType} />
                    <div className="min-w-0 flex-shrink">
                      <p className="text-xs md:text-sm font-medium text-foreground truncate">
                        {DOC_TYPE_LABELS[doc.documentType] || doc.documentType}
                      </p>
                      {doc.fileName && (
                        <p className="text-[10px] md:text-[11px] text-muted-foreground truncate">{doc.fileName}</p>
                      )}
                    </div>
                    <div className="ml-auto pl-2 pb-5" data-testid={`status-stage-${doc.documentId}`}>
                      <StageIndicator stage={doc.stage} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </Link>
        ))}
      </div>
    </Card>
  );
}
