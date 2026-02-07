import { useQuery } from "@tanstack/react-query";
import Layout from "@/components/Layout";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, FileText, Shield, ScrollText, ChevronRight, CheckCircle2, Upload, AlertCircle, Clock } from "lucide-react";
import { Link } from "wouter";

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
}

const DOC_TYPES = [
  { key: "fnol", label: "FNOL", icon: FileText, color: "text-blue-600 bg-blue-50" },
  { key: "policy", label: "Policy", icon: Shield, color: "text-emerald-600 bg-emerald-50" },
  { key: "endorsements", label: "Endorsements", icon: ScrollText, color: "text-amber-600 bg-amber-50" },
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

export default function DocumentsHub() {
  const { data: claims = [], isLoading: loadingClaims } = useQuery<Claim[]>({
    queryKey: ["/api/claims"],
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
            Document status across all your claims.
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
            {claims.map((claim) => {
              const docs = docsByClaim[claim.id] || [];
              const overall = getOverallStatus(docs);
              const address = claim.propertyAddress
                ? `${claim.propertyAddress}${claim.city ? `, ${claim.city}` : ""}${claim.state ? `, ${claim.state}` : ""}`
                : null;

              return (
                <Link key={claim.id} href={`/upload/${claim.id}`}>
                  <Card
                    data-testid={`card-docs-claim-${claim.id}`}
                    className="hover:shadow-md transition-all cursor-pointer border-border p-4"
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
                          {DOC_TYPES.map(({ key, label, icon: Icon, color }) => {
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
                                  <span className="text-[10px] font-medium text-muted-foreground leading-tight">{label}</span>
                                  <DocStatusPill status={doc?.status} />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      <ChevronRight className="h-5 w-5 text-muted-foreground shrink-0 mt-1" />
                    </div>
                  </Card>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </Layout>
  );
}
