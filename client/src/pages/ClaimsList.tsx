import { useState } from "react";
import Layout from "@/components/Layout";
import ClaimCard from "@/components/ClaimCard";
import DocumentStatusTracker from "@/components/DocumentStatusTracker";
import { Button } from "@/components/ui/button";
import { Plus, Filter, Loader2, ClipboardList, FileText } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useLocation } from "wouter";

interface Claim {
  id: number;
  claimNumber: string;
  insuredName: string | null;
  propertyAddress: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  dateOfLoss: string | null;
  perilType: string | null;
  status: string;
}

export default function ClaimsList() {
  const [activeTab, setActiveTab] = useState<"claims" | "documents">("claims");
  const [filter, setFilter] = useState("all");
  const [, setLocation] = useLocation();

  const { data: claims = [], isLoading } = useQuery<Claim[]>({
    queryKey: ["/api/claims"],
  });

  const createClaimMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/claims", {
        claimNumber: `CLM-${new Date().getFullYear()}-${String(Math.floor(Math.random() * 99999)).padStart(5, "0")}`,
        status: "draft",
      });
      return res.json();
    },
    onSuccess: (newClaim: Claim) => {
      queryClient.invalidateQueries({ queryKey: ["/api/claims"] });
      setLocation(`/upload/${newClaim.id}`);
    },
  });

  const filteredClaims = claims.filter((claim) => {
    if (filter === "all") return true;
    const s = claim.status.toLowerCase().replace(/\s+/g, "_");
    if (filter === "pending") return s === "draft" || s === "documents_uploaded";
    if (filter === "in-progress") return s === "extractions_confirmed" || s === "briefing_ready" || s === "inspecting";
    if (filter === "complete") return s === "complete" || s === "review";
    return true;
  });

  return (
    <Layout>
      <div className="flex flex-col space-y-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl md:text-3xl font-display font-bold text-foreground">
              {activeTab === "claims" ? "My Claims" : "Documents"}
            </h2>
            <p className="text-sm md:text-base text-muted-foreground mt-1">
              {activeTab === "claims"
                ? "Manage your active inspections and assignments."
                : "Track document processing status across all claims."}
            </p>
          </div>

          {activeTab === "claims" && (
            <Button
              data-testid="button-new-claim"
              size="lg"
              className="bg-primary hover:bg-primary/90 shadow-lg shadow-primary/20"
              onClick={() => createClaimMutation.mutate()}
              disabled={createClaimMutation.isPending}
            >
              {createClaimMutation.isPending ? (
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              ) : (
                <Plus className="mr-2 h-5 w-5" />
              )}
              New Claim
            </Button>
          )}
        </div>

        <div className="flex items-center justify-between bg-white p-2 rounded-xl shadow-sm border border-border overflow-hidden">
          <Tabs value={activeTab} className="w-full overflow-x-auto" onValueChange={(v) => setActiveTab(v as "claims" | "documents")}>
            <TabsList className="bg-transparent p-0 gap-1 md:gap-2 h-auto flex-nowrap">
              <TabsTrigger
                value="claims"
                data-testid="tab-claims"
                className="data-[state=active]:bg-primary/10 data-[state=active]:text-primary rounded-full px-3 md:px-4 py-1.5 md:py-2 h-auto text-xs md:text-sm whitespace-nowrap flex items-center gap-1.5"
              >
                <ClipboardList className="h-3.5 w-3.5" />
                Claims
              </TabsTrigger>
              <TabsTrigger
                value="documents"
                data-testid="tab-documents"
                className="data-[state=active]:bg-primary/10 data-[state=active]:text-primary rounded-full px-3 md:px-4 py-1.5 md:py-2 h-auto text-xs md:text-sm whitespace-nowrap flex items-center gap-1.5"
              >
                <FileText className="h-3.5 w-3.5" />
                Documents
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        {activeTab === "documents" ? (
          <DocumentStatusTracker />
        ) : (
          <>
            <div className="flex items-center justify-between bg-white p-2 rounded-xl shadow-sm border border-border overflow-hidden">
              <Tabs defaultValue="all" className="w-full max-w-2xl overflow-x-auto" onValueChange={setFilter}>
                <TabsList className="bg-transparent p-0 gap-1 md:gap-2 h-auto flex-nowrap">
                  <TabsTrigger value="all" data-testid="filter-all" className="data-[state=active]:bg-primary/10 data-[state=active]:text-primary rounded-full px-3 md:px-4 py-1.5 md:py-2 h-auto text-xs md:text-sm whitespace-nowrap">All Claims</TabsTrigger>
                  <TabsTrigger value="pending" data-testid="filter-pending" className="data-[state=active]:bg-primary/10 data-[state=active]:text-primary rounded-full px-3 md:px-4 py-1.5 md:py-2 h-auto text-xs md:text-sm whitespace-nowrap">Pending</TabsTrigger>
                  <TabsTrigger value="in-progress" data-testid="filter-in-progress" className="data-[state=active]:bg-primary/10 data-[state=active]:text-primary rounded-full px-3 md:px-4 py-1.5 md:py-2 h-auto text-xs md:text-sm whitespace-nowrap">In Progress</TabsTrigger>
                  <TabsTrigger value="complete" data-testid="filter-complete" className="data-[state=active]:bg-primary/10 data-[state=active]:text-primary rounded-full px-3 md:px-4 py-1.5 md:py-2 h-auto text-xs md:text-sm whitespace-nowrap">Complete</TabsTrigger>
                </TabsList>
              </Tabs>

              <Button variant="outline" size="sm" className="hidden md:flex gap-2 shrink-0" data-testid="button-filter">
                <Filter className="h-4 w-4" /> Filter
              </Button>
            </div>

            {isLoading ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
            ) : filteredClaims.length === 0 ? (
              <div className="text-center py-20 text-muted-foreground">
                <p className="text-lg mb-2">No claims yet</p>
                <p className="text-sm">Click "New Claim" to create your first inspection.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {filteredClaims.map((claim) => (
                  <ClaimCard
                    key={claim.id}
                    id={claim.id}
                    claimNumber={claim.claimNumber}
                    insuredName={claim.insuredName}
                    address={claim.propertyAddress ? `${claim.propertyAddress}${claim.city ? `, ${claim.city}` : ""}${claim.state ? `, ${claim.state}` : ""} ${claim.zip || ""}`.trim() : null}
                    peril={claim.perilType}
                    status={claim.status}
                    dateOfLoss={claim.dateOfLoss}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </Layout>
  );
}
