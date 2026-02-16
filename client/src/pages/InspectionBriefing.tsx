import Layout from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { useLocation } from "wouter";
import { Mic, Home, AlertTriangle, FileText, CheckSquare, CloudHail, Loader2, Shield, DollarSign, Calendar, MapPin, User, ChevronDown, ChevronUp } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import WeatherCorrelation from "@/components/WeatherCorrelation";
import { useState } from "react";

interface BriefingData {
  id: number;
  claimId: number;
  propertyProfile: any;
  coverageSnapshot: any;
  perilAnalysis: any;
  endorsementImpacts: any[];
  inspectionChecklist: any;
  dutiesAfterLoss: string[];
  redFlags: string[];
}

function SectionHeader({ icon: Icon, title, accent }: { icon: any; title: string; accent?: boolean }) {
  return (
    <div className={`flex items-center gap-2 mb-3 ${accent ? "text-accent-foreground" : "text-foreground"}`}>
      <Icon className="h-4 w-4 shrink-0" />
      <h2 className="text-sm font-display font-bold uppercase tracking-wider">{title}</h2>
      <div className="h-px flex-1 bg-border/60" />
    </div>
  );
}

function CollapsibleSection({ icon: Icon, title, children, defaultOpen = true, accent, badge }: { icon: any; title: string; children: React.ReactNode; defaultOpen?: boolean; accent?: boolean; badge?: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  const testId = `button-toggle-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-4 py-3 hover:bg-muted/30 transition-colors"
        data-testid={testId}
      >
        <Icon className={`h-4 w-4 shrink-0 ${accent ? "text-accent-foreground" : "text-primary"}`} />
        <span className="text-sm font-display font-semibold text-foreground">{title}</span>
        {badge && <span className="ml-1">{badge}</span>}
        <span className="ml-auto">
          {open ? <ChevronUp size={16} className="text-muted-foreground" /> : <ChevronDown size={16} className="text-muted-foreground" />}
        </span>
      </button>
      {open && <div className="px-4 pb-4 border-t border-border/50 pt-3">{children}</div>}
    </div>
  );
}

export default function InspectionBriefing({ params }: { params: { id: string } }) {
  const [, setLocation] = useLocation();
  const claimId = params.id;

  const { data: briefing, isLoading } = useQuery<BriefingData>({
    queryKey: [`/api/claims/${claimId}/briefing`],
  });

  const { data: claimDetail } = useQuery<any>({
    queryKey: [`/api/claims/${claimId}`],
  });

  if (isLoading) {
    return (
      <Layout title="Inspection Briefing" showBack>
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <span className="ml-3 text-muted-foreground">Loading briefing...</span>
        </div>
      </Layout>
    );
  }

  if (!briefing) {
    return (
      <Layout title="Inspection Briefing" showBack>
        <div className="text-center py-20 text-muted-foreground">
          <p className="text-lg mb-2">No briefing generated yet</p>
          <p className="text-sm">Go back to Extraction Review to confirm and generate.</p>
        </div>
      </Layout>
    );
  }

  const pp = briefing.propertyProfile || {};
  const cs = briefing.coverageSnapshot || {};
  const pa = briefing.perilAnalysis || {};
  const ei = briefing.endorsementImpacts || [];
  const ic = briefing.inspectionChecklist || {};
  const rf = briefing.redFlags || [];
  const dal = briefing.dutiesAfterLoss || [];

  const perilLabel = (pa.perilType || "Unknown").charAt(0).toUpperCase() + (pa.perilType || "unknown").slice(1);

  const fnolExtraction = claimDetail?.extractions?.find((e: any) => e.documentType === "fnol");
  const fnolData = fnolExtraction?.extractedData || {};
  const lossDescription = fnolData.reportedDamage || fnolData.lossDescription || pa.typicalDamagePatterns || "";
  const dateOfLoss = claimDetail?.dateOfLoss || fnolData.dateOfLoss || "";
  const propertyAddress = pp.address || claimDetail?.propertyAddress || "";

  return (
    <Layout title="Inspection Briefing" showBack>
      <div className="max-w-3xl mx-auto pb-20 px-3 md:px-0">

        {/* ─── HEADER ─── */}
        <div className="bg-foreground text-white p-5 md:p-7 rounded-2xl mb-5 shadow-xl relative overflow-hidden">
          <div className="absolute top-0 right-0 p-6 md:p-10 opacity-10">
            <CloudHail size={100} className="md:hidden" />
            <CloudHail size={160} className="hidden md:block" />
          </div>
          <div className="relative z-10">
            <div className="flex items-center gap-2 mb-2 text-white/60">
              <span className="uppercase tracking-widest text-[9px] md:text-[10px] font-bold">Mission Briefing</span>
              <span className="h-px w-6 bg-white/30" />
              <span className="text-[10px] font-mono">{claimDetail?.claimNumber || ""}</span>
            </div>
            <h1 className="text-xl md:text-3xl font-display font-bold mb-1">
              {perilLabel} Inspection
            </h1>
            <p className="text-sm md:text-base text-white/70 mb-4">
              {propertyAddress || "Property"}
            </p>
            <Button
              data-testid="button-start-inspection"
              size="lg"
              className="bg-accent text-accent-foreground hover:bg-accent/90 border-0 h-11 md:h-12 px-5 md:px-7 text-sm md:text-base shadow-lg font-semibold w-full sm:w-auto"
              onClick={() => setLocation(`/inspection/${claimId}`)}
            >
              <Mic className="mr-2 h-4 w-4" /> Start Active Inspection
            </Button>
          </div>
        </div>

        <div className="space-y-3">

          {/* ─── 1. LOSS DESCRIPTION ─── */}
          <div className="rounded-xl border border-border bg-card p-4" data-testid="section-loss-description">
            <SectionHeader icon={FileText} title="Loss Description" />
            <div className="grid grid-cols-3 gap-3 mb-3">
              <div className="flex items-center gap-1.5">
                <Calendar size={13} className="text-muted-foreground shrink-0" />
                <div>
                  <p className="text-[9px] text-muted-foreground">Date of Loss</p>
                  <p className="text-xs font-semibold">{dateOfLoss || "N/A"}</p>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <CloudHail size={13} className="text-muted-foreground shrink-0" />
                <div>
                  <p className="text-[9px] text-muted-foreground">Peril</p>
                  <p className="text-xs font-semibold">{perilLabel}</p>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <User size={13} className="text-muted-foreground shrink-0" />
                <div>
                  <p className="text-[9px] text-muted-foreground">Insured</p>
                  <p className="text-xs font-semibold truncate">{claimDetail?.insuredName || fnolData.insuredName || "N/A"}</p>
                </div>
              </div>
            </div>
            {lossDescription ? (
              <p className="text-sm text-foreground leading-relaxed bg-muted/30 rounded-lg p-3">{lossDescription}</p>
            ) : (
              <p className="text-sm text-muted-foreground italic">No loss description available. Upload FNOL documents to populate.</p>
            )}
          </div>

          {/* ─── 2. WEATHER CORRELATION (compact by default) ─── */}
          <WeatherCorrelation claimId={claimId} />

          {/* ─── 3. PROPERTY PROFILE ─── */}
          <CollapsibleSection icon={Home} title="Property Profile">
            {pp.summary && <p className="text-xs text-muted-foreground mb-3">{pp.summary}</p>}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <p className="text-[9px] text-muted-foreground uppercase">Year Built</p>
                <p className="text-sm font-semibold">{pp.yearBuilt || "N/A"}</p>
              </div>
              <div>
                <p className="text-[9px] text-muted-foreground uppercase">Roof Type</p>
                <p className="text-sm font-semibold">{pp.roofType || "N/A"}</p>
              </div>
              <div>
                <p className="text-[9px] text-muted-foreground uppercase">Stories</p>
                <p className="text-sm font-semibold">{pp.stories ? `${pp.stories} Story` : "N/A"}</p>
              </div>
              <div>
                <p className="text-[9px] text-muted-foreground uppercase">Construction</p>
                <p className="text-sm font-semibold">{pp.constructionType || "N/A"}</p>
              </div>
            </div>
          </CollapsibleSection>

          {/* ─── 4. COVERAGE SNAPSHOT ─── */}
          <CollapsibleSection icon={DollarSign} title="Coverage Snapshot" defaultOpen={false}>
            <div className="grid grid-cols-2 gap-3 text-sm">
              {cs.coverageA != null && (
                <div>
                  <p className="text-[9px] text-muted-foreground uppercase">Coverage A (Dwelling)</p>
                  <p className="font-semibold">{typeof cs.coverageA === "number" ? `$${cs.coverageA.toLocaleString()}` : cs.coverageA}</p>
                </div>
              )}
              {cs.coverageB != null && (
                <div>
                  <p className="text-[9px] text-muted-foreground uppercase">Coverage B (Other Structures)</p>
                  <p className="font-semibold">{typeof cs.coverageB === "number" ? `$${cs.coverageB.toLocaleString()}` : cs.coverageB}</p>
                </div>
              )}
              {cs.coverageC != null && (
                <div>
                  <p className="text-[9px] text-muted-foreground uppercase">Coverage C (Contents)</p>
                  <p className="font-semibold">{typeof cs.coverageC === "number" ? `$${cs.coverageC.toLocaleString()}` : cs.coverageC}</p>
                </div>
              )}
              {cs.deductible != null && (
                <div>
                  <p className="text-[9px] text-muted-foreground uppercase">Deductible</p>
                  <p className="font-semibold">{typeof cs.deductible === "number" ? `$${cs.deductible.toLocaleString()}` : cs.deductible}</p>
                </div>
              )}
              {cs.deductibleType && (
                <div>
                  <p className="text-[9px] text-muted-foreground uppercase">Deductible Type</p>
                  <p className="font-semibold">{cs.deductibleType}</p>
                </div>
              )}
              {cs.lossSettlement && (
                <div>
                  <p className="text-[9px] text-muted-foreground uppercase">Settlement Type</p>
                  <p className="font-semibold">{cs.lossSettlement}</p>
                </div>
              )}
            </div>
          </CollapsibleSection>

          {/* ─── 5. PERIL ANALYSIS ─── */}
          <CollapsibleSection icon={CloudHail} title={`Peril Analysis: ${perilLabel}`} accent>
            <div className="space-y-3">
              {pa.inspectionPriorities && pa.inspectionPriorities.length > 0 && (
                <div>
                  <p className="text-xs font-semibold mb-1">Inspection Priorities</p>
                  <ul className="text-xs text-muted-foreground list-disc list-inside space-y-0.5">
                    {pa.inspectionPriorities.map((p: string, i: number) => (
                      <li key={i}>{p}</li>
                    ))}
                  </ul>
                </div>
              )}
              {pa.whatToLookFor && pa.whatToLookFor.length > 0 && (
                <div>
                  <p className="text-xs font-semibold mb-1">What to Look For</p>
                  <ul className="text-xs text-muted-foreground list-disc list-inside space-y-0.5">
                    {pa.whatToLookFor.map((w: string, i: number) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </div>
              )}
              {pa.typicalDamagePatterns && (
                <div>
                  <p className="text-xs font-semibold mb-1">Typical Damage Patterns</p>
                  <p className="text-xs text-muted-foreground">{pa.typicalDamagePatterns}</p>
                </div>
              )}
            </div>
          </CollapsibleSection>

          {/* ─── 6. ENDORSEMENTS ─── */}
          {ei.length > 0 && (
            <CollapsibleSection icon={FileText} title="Critical Endorsements" defaultOpen={false}
              badge={<span className="text-[9px] bg-primary/10 text-primary px-1.5 py-0.5 rounded-full font-medium">{ei.length}</span>}
            >
              <div className="space-y-2">
                {ei.map((e: any, i: number) => (
                  <div key={i} className="flex gap-2 items-start p-2.5 bg-muted/30 rounded-lg">
                    <span className="bg-foreground text-white text-[9px] font-mono px-1.5 py-0.5 rounded mt-0.5 shrink-0">{e.endorsementId}</span>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold">{e.title}</p>
                      <p className="text-[10px] text-muted-foreground">{e.adjusterGuidance}</p>
                    </div>
                  </div>
                ))}
              </div>
            </CollapsibleSection>
          )}

          {/* ─── 7. INSPECTION CHECKLIST ─── */}
          <CollapsibleSection icon={CheckSquare} title="Inspection Plan" defaultOpen={false}>
            <div className="space-y-3">
              {["exterior", "roof", "interior", "documentation"].map((section) => {
                const items = ic[section];
                if (!items || items.length === 0) return null;
                return (
                  <div key={section}>
                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">{section}</p>
                    {items.map((item: string, i: number) => (
                      <div key={i} className="flex items-center gap-2 text-xs mb-1">
                        <div className="h-3.5 w-3.5 rounded border border-input shrink-0" />
                        <span>{item}</span>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          </CollapsibleSection>

          {/* ─── 8. RED FLAGS ─── */}
          {rf.length > 0 && (
            <div className="rounded-xl border border-red-200 bg-red-50/30 p-4" data-testid="section-red-flags">
              <SectionHeader icon={AlertTriangle} title="Red Flags" />
              <ul className="space-y-1.5">
                {rf.map((flag: string, i: number) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-red-700">
                    <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                    <span>{flag}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* ─── 9. DUTIES AFTER LOSS ─── */}
          {dal.length > 0 && (
            <CollapsibleSection icon={Shield} title="Duties After Loss" defaultOpen={false}>
              <ul className="space-y-1">
                {dal.map((duty: string, i: number) => (
                  <li key={i} className="flex items-start gap-2 text-xs">
                    <span className="text-primary mt-0.5 shrink-0">&#8226;</span>
                    <span>{duty}</span>
                  </li>
                ))}
              </ul>
            </CollapsibleSection>
          )}

        </div>
      </div>
    </Layout>
  );
}
