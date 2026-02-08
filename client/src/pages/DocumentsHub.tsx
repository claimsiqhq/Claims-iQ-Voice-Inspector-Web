import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getAuthHeaders } from "@/lib/queryClient";
import Layout from "@/components/Layout";
import { StageIndicator, getDocStage } from "@/components/DocumentStatusTracker";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Loader2, FileText, Shield, ScrollText, ChevronDown, ChevronUp,
  CheckCircle2, Upload, AlertCircle, Clock, Eye, ExternalLink, File
} from "lucide-react";
import { useLocation } from "wouter";
import PdfViewer from "@/components/PdfViewer";
import { useAuth } from "@/contexts/AuthContext";

interface Claim {
  id: number;
  claimNumber: string;
  insuredName: string | null;
  propertyAddress: string | null;
  city: string | null;
  state: string | null;
  status: string;
}

interface DocRecord {
  id: number;
  claimId: number;
  documentType: string;
  fileName: string | null;
  status: string;
  storagePath: string | null;
}

const DOC_TYPES = [
  { key: "fnol", label: "FNOL / Claim Report", shortLabel: "FNOL", icon: FileText, color: "text-blue-600 bg-blue-50", borderColor: "border-blue-200" },
  { key: "policy", label: "Policy Declarations", shortLabel: "Policy", icon: Shield, color: "text-emerald-600 bg-emerald-50", borderColor: "border-emerald-200" },
  { key: "endorsements", label: "Endorsements", shortLabel: "Endorse.", icon: ScrollText, color: "text-amber-600 bg-amber-50", borderColor: "border-amber-200" },
] as const;

function DocStatusPill({ status }: { status: string | undefined }) {
  if (!status || status === "empty") {
    return (
      <span data-testid="status-missing" className="inline-flex items-center gap-1 text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
        <Upload className="h-3 w-3" />
        Missing
      </span>
    );
  }
  if (status === "uploaded") {
    return (
      <span data-testid="status-uploaded" className="inline-flex items-center gap-1 text-xs text-blue-700 bg-blue-50 px-2 py-0.5 rounded-full">
        <Clock className="h-3 w-3" />
        Uploaded
      </span>
    );
  }
  if (status === "processing") {
    return (
      <span data-testid="status-processing" className="inline-flex items-center gap-1 text-xs text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full">
        <Loader2 className="h-3 w-3 animate-spin" />
        Processing
      </span>
    );
  }
  if (status === "parsed" || status === "complete") {
    return (
      <span data-testid="status-parsed" className="inline-flex items-center gap-1 text-xs text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">
        <CheckCircle2 className="h-3 w-3" />
        Parsed
      </span>
    );
  }
  if (status === "error") {
    return (
      <span data-testid="status-error" className="inline-flex items-center gap-1 text-xs text-red-700 bg-red-50 px-2 py-0.5 rounded-full">
        <AlertCircle className="h-3 w-3" />
        Error
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
      {status}
    </span>
  );
}

function getOverallStatus(docs: DocRecord[]): { label: string; color: string } {
  if (docs.length === 0) return { label: "No Documents", color: "bg-muted text-muted-foreground" };
  const hasError = docs.some(d => d.status === "error");
  if (hasError) return { label: "Needs Attention", color: "bg-red-50 text-red-700 border-red-200" };
  const allParsed = docs.every(d => d.status === "parsed" || d.status === "complete");
  if (allParsed && docs.length === 3) return { label: "All Parsed", color: "bg-emerald-50 text-emerald-700 border-emerald-200" };
  const someUploaded = docs.some(d => d.status === "uploaded" || d.status === "processing");
  if (someUploaded) return { label: "In Progress", color: "bg-blue-50 text-blue-700 border-blue-200" };
  const someParsed = docs.some(d => d.status === "parsed" || d.status === "complete");
  if (someParsed) return { label: "Partially Parsed", color: "bg-amber-50 text-amber-700 border-amber-200" };
  return { label: "Uploaded", color: "bg-blue-50 text-blue-700 border-blue-200" };
}

interface ViewingDoc {
  docId: number;
  fileName: string;
}

function ClaimCard({ claim, docs }: { claim: Claim; docs: DocRecord[] }) {
  const [expanded, setExpanded] = useState(false);
  const [viewingDoc, setViewingDoc] = useState<ViewingDoc | null>(null);
  const [pdfUrls, setPdfUrls] = useState<string[] | null>(null);
  const [loadingPdf, setLoadingPdf] = useState(false);
  const [, navigate] = useLocation();

  const overall = getOverallStatus(docs);
  const address = claim.propertyAddress
    ? `${claim.propertyAddress}${claim.city ? `, ${claim.city}` : ""}${claim.state ? `, ${claim.state}` : ""}`
    : null;

  async function openPdfViewer(doc: DocRecord) {
    if (!doc.storagePath) return;
    setLoadingPdf(true);
    setViewingDoc({ docId: doc.id, fileName: doc.fileName || "Document" });
    try {
      const authHeaders = await getAuthHeaders();
      const res = await fetch(`/api/documents/${doc.id}/signed-url`, {
        headers: authHeaders,
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to get document URL");
      const data = await res.json();
      setPdfUrls(data.urls);
    } catch {
      setPdfUrls(null);
    } finally {
      setLoadingPdf(false);
    }
  }

  function closePdfViewer() {
    setViewingDoc(null);
    setPdfUrls(null);
    setExpanded(true);
  }

  if (viewingDoc && (pdfUrls || loadingPdf)) {
    return (
      <Card
        data-testid={`card-docs-claim-${claim.id}`}
        className="border-border overflow-hidden"
      >
        <div className="h-[70vh] md:h-[75vh]">
          {loadingPdf ? (
            <div className="flex items-center justify-center h-full">
              <div className="flex flex-col items-center gap-3">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <p className="text-sm text-muted-foreground">Loading document...</p>
              </div>
            </div>
          ) : pdfUrls ? (
            <PdfViewer
              urls={pdfUrls}
              fileName={viewingDoc.fileName}
              onClose={closePdfViewer}
            />
          ) : (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <p className="text-sm text-destructive mb-2">Failed to load document</p>
                <Button variant="outline" size="sm" onClick={closePdfViewer}>Close</Button>
              </div>
            </div>
          )}
        </div>
      </Card>
    );
  }

  return (
    <Card
      data-testid={`card-docs-claim-${claim.id}`}
      className="border-border overflow-hidden transition-all"
    >
      <button
        className="w-full text-left p-4 hover:bg-muted/30 transition-colors"
        onClick={() => setExpanded(!expanded)}
        data-testid={`button-expand-claim-${claim.id}`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-display font-semibold text-foreground text-sm md:text-base">
                {claim.claimNumber}
              </span>
              <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${overall.color}`}>
                {overall.label}
              </Badge>
            </div>
            {(claim.insuredName || address) && (
              <p className="text-xs md:text-sm text-muted-foreground mt-0.5 truncate">
                {claim.insuredName}{address ? ` — ${address}` : ""}
              </p>
            )}

            <div className="flex items-center gap-3 mt-3">
              {DOC_TYPES.map(({ key, shortLabel, icon: Icon, color }) => {
                const doc = docs.find(d => d.documentType === key);
                return (
                  <div
                    key={key}
                    data-testid={`doc-status-${key}-${claim.id}`}
                    className="flex items-center gap-1.5"
                  >
                    <div className={`h-6 w-6 rounded flex items-center justify-center ${color}`}>
                      <Icon className="h-3.5 w-3.5" />
                    </div>
                    <div className="flex flex-col">
                      <span className="text-[10px] font-medium text-muted-foreground leading-tight">{shortLabel}</span>
                      <DocStatusPill status={doc?.status} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {expanded ? (
            <ChevronUp className="h-5 w-5 text-muted-foreground shrink-0 mt-1" />
          ) : (
            <ChevronDown className="h-5 w-5 text-muted-foreground shrink-0 mt-1" />
          )}
        </div>
      </button>

      {expanded && (
        <div className="border-t px-4 pb-4 pt-3 space-y-3 bg-muted/10">
          {DOC_TYPES.map(({ key, label, icon: Icon, color, borderColor }) => {
            const doc = docs.find(d => d.documentType === key);
            const hasFile = doc && doc.storagePath;
            const isParsed = doc && (doc.status === "parsed" || doc.status === "complete");

            return (
              <div
                key={key}
                data-testid={`doc-detail-${key}-${claim.id}`}
                className={`rounded-lg border ${borderColor} bg-background p-3`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className={`h-8 w-8 rounded-md flex items-center justify-center ${color}`}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground">{label}</p>
                      {doc?.fileName ? (
                        <p className="text-xs text-muted-foreground truncate max-w-[200px] md:max-w-none flex items-center gap-1">
                          <File className="h-3 w-3 shrink-0" />
                          {doc.fileName}
                        </p>
                      ) : (
                        <p className="text-xs text-muted-foreground">No file uploaded</p>
                      )}
                    </div>
                  </div>
                  <DocStatusPill status={doc?.status} />
                </div>

                {doc && doc.status && doc.status !== "empty" && (
                  <div className="mt-2.5 ml-10 pb-4" data-testid={`status-pipeline-${key}-${claim.id}`}>
                    <StageIndicator stage={getDocStage(doc.status)} />
                  </div>
                )}

                <div className="flex items-center gap-2 mt-3">
                  {hasFile && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs gap-1"
                      onClick={() => openPdfViewer(doc)}
                      data-testid={`button-view-pdf-${key}-${claim.id}`}
                    >
                      <Eye className="h-3 w-3" />
                      View PDF
                    </Button>
                  )}
                  {isParsed && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs gap-1"
                      onClick={() => navigate(`/review/${claim.id}`)}
                      data-testid={`button-view-extraction-${key}-${claim.id}`}
                    >
                      <ExternalLink className="h-3 w-3" />
                      View Extraction
                    </Button>
                  )}
                  {!hasFile && (
                    <Button
                      variant="default"
                      size="sm"
                      className="h-7 text-xs gap-1"
                      onClick={() => navigate(`/upload/${claim.id}`)}
                      data-testid={`button-upload-${key}-${claim.id}`}
                    >
                      <Upload className="h-3 w-3" />
                      Upload
                    </Button>
                  )}
                </div>
              </div>
            );
          })}

          <div className="pt-1">
            <Button
              variant="ghost"
              size="sm"
              className="w-full text-xs text-muted-foreground gap-1"
              onClick={() => navigate(`/upload/${claim.id}`)}
              data-testid={`button-manage-docs-${claim.id}`}
            >
              <ExternalLink className="h-3 w-3" />
              Manage All Documents
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

export default function DocumentsHub() {
  const { role } = useAuth();
  const claimsEndpoint = role === "supervisor" ? "/api/claims" : "/api/claims/my-claims";

  const { data: claims = [], isLoading: loadingClaims } = useQuery<Claim[]>({
    queryKey: [claimsEndpoint],
  });

  const { data: allDocs = [], isLoading: loadingDocs } = useQuery<DocRecord[]>({
    queryKey: ["/api/documents/all"],
    enabled: claims.length > 0,
  });

  const isLoading = loadingClaims || (claims.length > 0 && loadingDocs);

  const docsByClaim = claims.reduce<Record<number, DocRecord[]>>((acc, claim) => {
    acc[claim.id] = allDocs.filter(d => d.claimId === claim.id);
    return acc;
  }, {});

  return (
    <Layout title="Documents">
      <div className="flex flex-col space-y-6">
        <div>
          <h2 className="text-2xl md:text-3xl font-display font-bold text-foreground">Documents</h2>
          <p className="text-sm md:text-base text-muted-foreground mt-1">
            View and manage documents across all your claims.
          </p>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : claims.length === 0 ? (
          <div className="text-center py-20 text-muted-foreground">
            <FileText className="h-12 w-12 mx-auto mb-4 opacity-40" />
            <p className="text-lg mb-2">No claims yet</p>
            <p className="text-sm">Create a claim first to start uploading documents.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {claims.map((claim) => (
              <ClaimCard
                key={claim.id}
                claim={claim}
                docs={docsByClaim[claim.id] || []}
              />
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}
