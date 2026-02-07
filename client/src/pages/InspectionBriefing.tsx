import Layout from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useLocation } from "wouter";
import { Mic, Home, AlertTriangle, FileText, CheckSquare, CloudHail, Loader2, Shield } from "lucide-react";
import { motion } from "framer-motion";
import { useQuery } from "@tanstack/react-query";

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

export default function InspectionBriefing({ params }: { params: { id: string } }) {
  const [, setLocation] = useLocation();
  const claimId = params.id;

  const { data: briefing, isLoading } = useQuery<BriefingData>({
    queryKey: [`/api/claims/${claimId}/briefing`],
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

  return (
    <Layout title="Inspection Briefing" showBack>
      <div className="max-w-4xl mx-auto pb-20">
        <div className="bg-foreground text-white p-8 rounded-2xl mb-8 shadow-2xl relative overflow-hidden">
          <div className="absolute top-0 right-0 p-12 opacity-10">
            <CloudHail size={200} />
          </div>

          <div className="relative z-10">
            <div className="flex items-center gap-2 mb-4 text-white/70">
              <span className="uppercase tracking-widest text-xs font-bold">Mission Briefing</span>
              <span className="h-px w-8 bg-white/30"></span>
            </div>

            <h1 className="text-4xl font-display font-bold mb-2">
              {perilLabel} Inspection: {pp.address || "Property"}
            </h1>
            <p className="text-xl text-white/80 font-light mb-6">
              {cs.lossSettlement || "Standard"} Policy{cs.deductibleType ? ` \u2022 ${cs.deductibleType} Deductible` : ""}
            </p>

            <div className="flex gap-4">
              <Button
                data-testid="button-start-inspection"
                size="lg"
                className="bg-accent text-accent-foreground hover:bg-accent/90 border-0 h-14 px-8 text-lg shadow-lg font-semibold"
                onClick={() => setLocation(`/inspection/${claimId}`)}
              >
                <Mic className="mr-2 h-5 w-5" /> Start Active Inspection
              </Button>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 font-display text-primary">
                <Home className="h-5 w-5" /> Property Profile
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-4">{pp.summary}</p>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground">Year Built</p>
                  <p className="font-semibold">{pp.yearBuilt || "N/A"}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Roof Type</p>
                  <p className="font-semibold">{pp.roofType || "N/A"}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Stories</p>
                  <p className="font-semibold">{pp.stories ? `${pp.stories} Story` : "N/A"}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Construction</p>
                  <p className="font-semibold">{pp.constructionType || "N/A"}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-accent/50 bg-accent/5">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 font-display text-accent-foreground">
                <CloudHail className="h-5 w-5" /> Peril Analysis: {perilLabel}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {pa.inspectionPriorities && pa.inspectionPriorities.length > 0 && (
                <div className="p-3 bg-white rounded-lg border border-accent/20 shadow-sm">
                  <p className="font-semibold text-sm mb-1">Inspection Priorities</p>
                  <ul className="text-sm text-muted-foreground list-disc list-inside">
                    {pa.inspectionPriorities.map((p: string, i: number) => (
                      <li key={i}>{p}</li>
                    ))}
                  </ul>
                </div>
              )}
              {pa.whatToLookFor && pa.whatToLookFor.length > 0 && (
                <div className="p-3 bg-white rounded-lg border border-accent/20 shadow-sm">
                  <p className="font-semibold text-sm mb-1">What to Look For</p>
                  <ul className="text-sm text-muted-foreground list-disc list-inside">
                    {pa.whatToLookFor.map((w: string, i: number) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </div>
              )}
              {pa.typicalDamagePatterns && (
                <div className="p-3 bg-white rounded-lg border border-accent/20 shadow-sm">
                  <p className="font-semibold text-sm mb-1">Typical Damage Patterns</p>
                  <p className="text-sm text-muted-foreground">{pa.typicalDamagePatterns}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {ei.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 font-display text-foreground">
                  <FileText className="h-5 w-5" /> Critical Endorsements
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {ei.map((e: any, i: number) => (
                  <div key={i} className="flex gap-3 items-start p-3 bg-muted/30 rounded-lg">
                    <div className="bg-foreground text-white text-xs font-mono px-1.5 py-0.5 rounded mt-0.5">{e.endorsementId}</div>
                    <div>
                      <p className="text-sm font-semibold">{e.title}</p>
                      <p className="text-xs text-muted-foreground">{e.adjusterGuidance}</p>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 font-display text-foreground">
                <CheckSquare className="h-5 w-5" /> Inspection Plan
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {ic.exterior && ic.exterior.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Exterior</p>
                    {ic.exterior.map((item: string, i: number) => (
                      <div key={i} className="flex items-center gap-2 text-sm mb-1">
                        <div className="h-4 w-4 rounded border border-input shrink-0"></div>
                        <span>{item}</span>
                      </div>
                    ))}
                  </div>
                )}
                {ic.roof && ic.roof.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Roof</p>
                    {ic.roof.map((item: string, i: number) => (
                      <div key={i} className="flex items-center gap-2 text-sm mb-1">
                        <div className="h-4 w-4 rounded border border-input shrink-0"></div>
                        <span>{item}</span>
                      </div>
                    ))}
                  </div>
                )}
                {ic.interior && ic.interior.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Interior</p>
                    {ic.interior.map((item: string, i: number) => (
                      <div key={i} className="flex items-center gap-2 text-sm mb-1">
                        <div className="h-4 w-4 rounded border border-input shrink-0"></div>
                        <span>{item}</span>
                      </div>
                    ))}
                  </div>
                )}
                {ic.documentation && ic.documentation.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Documentation</p>
                    {ic.documentation.map((item: string, i: number) => (
                      <div key={i} className="flex items-center gap-2 text-sm mb-1">
                        <div className="h-4 w-4 rounded border border-input shrink-0"></div>
                        <span>{item}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {rf.length > 0 && (
            <Card className="border-red-200 bg-red-50/30">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 font-display text-red-800">
                  <AlertTriangle className="h-5 w-5" /> Red Flags
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {rf.map((flag: string, i: number) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-red-700">
                      <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                      <span>{flag}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {dal.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 font-display text-foreground">
                  <Shield className="h-5 w-5" /> Duties After Loss
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {dal.map((duty: string, i: number) => (
                    <li key={i} className="flex items-start gap-2 text-sm">
                      <span className="text-primary mt-0.5">&#8226;</span>
                      <span>{duty}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </Layout>
  );
}
