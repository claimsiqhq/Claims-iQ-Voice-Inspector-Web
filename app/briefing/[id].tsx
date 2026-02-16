import { useLocalSearchParams, router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { View, Text, StyleSheet, Pressable, ActivityIndicator, ScrollView } from "react-native";
import { AuthGate } from "@/components/AuthGate";
import { callEdgeFunction } from "@/lib/api";
import { supabase } from "@/lib/supabase";

interface Claim {
  id: number; claimNumber: string; insuredName: string | null; propertyAddress: string | null;
  city: string | null; state: string | null; dateOfLoss: string | null; perilType: string | null;
}

interface Briefing {
  propertyProfile: any; coverageSnapshot: any; perilAnalysis: any;
  endorsementImpacts: any[]; inspectionChecklist: any; dutiesAfterLoss: string[]; redFlags: string[];
}

interface WeatherCorrelation {
  location: string; weatherSummary: string; overallRiskScore: number;
  perilAnalysis: { claimedPeril: string; weatherSupportsPeril: boolean; confidence: string; details: string; relevantConditions: string[]; severityLevel: string };
  fraudIndicators: Array<{ type: string; category: string; message: string; severity: string }>;
  lossDateWeather: any; surroundingDays: any[];
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={s.section}>
      <Text style={s.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function BulletList({ items }: { items: string[] }) {
  if (!items || items.length === 0) return <Text style={s.muted}>None</Text>;
  return <>{items.map((item, i) => <Text key={i} style={s.bullet}>• {item}</Text>)}</>;
}

function ConfidenceBadge({ level }: { level: string }) {
  const color = level === "high" ? "#16a34a" : level === "medium" ? "#d97706" : "#dc2626";
  return <View style={[s.badge, { backgroundColor: color }]}><Text style={s.badgeText}>{level}</Text></View>;
}

export default function BriefingScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();

  const claimQuery = useQuery<Claim | null>({
    queryKey: ["claim", id],
    queryFn: async () => {
      const { data } = await supabase.from("claims").select("*").eq("id", parseInt(String(id))).limit(1).single();
      return data;
    },
    enabled: !!id,
  });
  const claim = claimQuery.data;

  const briefingQuery = useQuery<Briefing | null>({
    queryKey: ["briefing", id],
    queryFn: async () => {
      const { data } = await supabase.from("briefings").select("*").eq("claim_id", parseInt(String(id))).limit(1).single();
      return data ? {
        propertyProfile: data.property_profile,
        coverageSnapshot: data.coverage_snapshot,
        perilAnalysis: data.peril_analysis,
        endorsementImpacts: data.endorsement_impacts || [],
        inspectionChecklist: data.inspection_checklist,
        dutiesAfterLoss: data.duties_after_loss || [],
        redFlags: data.red_flags || [],
      } : null;
    },
    enabled: !!id,
  });
  const briefing = briefingQuery.data;

  const weatherQuery = useQuery<WeatherCorrelation | null>({
    queryKey: ["weather", id],
    queryFn: async () => {
      try {
        return await callEdgeFunction("weather-correlation", { claimId: parseInt(String(id)) });
      } catch { return null; }
    },
    enabled: !!id && !!claim?.dateOfLoss,
    retry: false,
  });
  const weather = weatherQuery.data;

  const isLoading = claimQuery.isLoading;

  return (
    <AuthGate>
      <ScrollView style={s.container} contentContainerStyle={s.content}>
        <Text style={s.title}>Inspection Briefing</Text>

        {isLoading && <ActivityIndicator size="large" color="#7763B7" style={{ marginTop: 48 }} />}

        {claim && (
          <>
            {/* Claim header */}
            <View style={s.card}>
              <Text style={s.claimNumber}>{claim.claimNumber}</Text>
              {claim.insuredName && <Text style={s.row}>{claim.insuredName}</Text>}
              {claim.propertyAddress && <Text style={s.row}>{[claim.propertyAddress, claim.city, claim.state].filter(Boolean).join(", ")}</Text>}
              {claim.dateOfLoss && <Text style={s.muted}>Date of loss: {claim.dateOfLoss}</Text>}
              {claim.perilType && <Text style={s.muted}>Peril: {claim.perilType}</Text>}
            </View>

            {/* Weather Correlation */}
            {weather && (
              <Section title="Weather Correlation">
                <View style={s.card}>
                  <View style={s.weatherHeader}>
                    <Text style={s.weatherSummary}>{weather.weatherSummary}</Text>
                    <View style={[s.riskBadge, { backgroundColor: weather.overallRiskScore > 60 ? "#dc2626" : weather.overallRiskScore > 30 ? "#d97706" : "#16a34a" }]}>
                      <Text style={s.riskText}>Risk: {weather.overallRiskScore}</Text>
                    </View>
                  </View>
                  <View style={s.perilRow}>
                    <Text style={s.perilLabel}>Supports {weather.perilAnalysis.claimedPeril}?</Text>
                    <ConfidenceBadge level={weather.perilAnalysis.confidence} />
                    <Text style={s.perilResult}>{weather.perilAnalysis.weatherSupportsPeril ? "Yes" : "No"}</Text>
                  </View>
                  <Text style={s.perilDetails}>{weather.perilAnalysis.details}</Text>
                  {weather.perilAnalysis.relevantConditions.length > 0 && (
                    <BulletList items={weather.perilAnalysis.relevantConditions} />
                  )}
                  {weather.fraudIndicators.map((ind, i) => (
                    <View key={i} style={[s.indicator, { borderLeftColor: ind.type === "mismatch" ? "#dc2626" : ind.type === "warning" ? "#d97706" : "#16a34a" }]}>
                      <Text style={s.indicatorText}>{ind.message}</Text>
                    </View>
                  ))}
                  {weather.lossDateWeather && (
                    <View style={s.weatherGrid}>
                      <View style={s.weatherCell}><Text style={s.weatherVal}>{weather.lossDateWeather.tempmin}–{weather.lossDateWeather.tempmax}°F</Text><Text style={s.weatherLabel}>Temp</Text></View>
                      <View style={s.weatherCell}><Text style={s.weatherVal}>{weather.lossDateWeather.windspeed}/{weather.lossDateWeather.windgust} mph</Text><Text style={s.weatherLabel}>Wind/Gust</Text></View>
                      <View style={s.weatherCell}><Text style={s.weatherVal}>{weather.lossDateWeather.precip}"</Text><Text style={s.weatherLabel}>Precip</Text></View>
                      <View style={s.weatherCell}><Text style={s.weatherVal}>{weather.lossDateWeather.humidity}%</Text><Text style={s.weatherLabel}>Humidity</Text></View>
                    </View>
                  )}
                </View>
              </Section>
            )}
            {weatherQuery.isLoading && <Text style={s.loadingText}>Loading weather data...</Text>}

            {/* Briefing sections */}
            {briefing ? (
              <>
                {briefing.propertyProfile && (
                  <Section title="Property Profile">
                    <View style={s.card}>
                      {briefing.propertyProfile.summary && <Text style={s.row}>{briefing.propertyProfile.summary}</Text>}
                      {briefing.propertyProfile.propertyType && <Text style={s.muted}>Type: {briefing.propertyProfile.propertyType}</Text>}
                      {briefing.propertyProfile.yearBuilt && <Text style={s.muted}>Built: {briefing.propertyProfile.yearBuilt}</Text>}
                      {briefing.propertyProfile.constructionType && <Text style={s.muted}>Construction: {briefing.propertyProfile.constructionType}</Text>}
                      {briefing.propertyProfile.roofType && <Text style={s.muted}>Roof: {briefing.propertyProfile.roofType}</Text>}
                    </View>
                  </Section>
                )}

                {briefing.coverageSnapshot && (
                  <Section title="Coverage Snapshot">
                    <View style={s.card}>
                      {briefing.coverageSnapshot.summary && <Text style={s.row}>{briefing.coverageSnapshot.summary}</Text>}
                      {briefing.coverageSnapshot.coverageA && <Text style={s.muted}>Coverage A (Dwelling): ${briefing.coverageSnapshot.coverageA.limit?.toLocaleString()}</Text>}
                      {briefing.coverageSnapshot.coverageB && <Text style={s.muted}>Coverage B (Other Structures): ${briefing.coverageSnapshot.coverageB.limit?.toLocaleString()}</Text>}
                      {briefing.coverageSnapshot.coverageC && <Text style={s.muted}>Coverage C (Personal Property): ${briefing.coverageSnapshot.coverageC.limit?.toLocaleString()}</Text>}
                      {briefing.coverageSnapshot.coverageD && <Text style={s.muted}>Coverage D (Loss of Use): ${briefing.coverageSnapshot.coverageD.limit?.toLocaleString()}</Text>}
                      {briefing.coverageSnapshot.deductible != null && <Text style={s.muted}>Deductible: ${briefing.coverageSnapshot.deductible.toLocaleString()}</Text>}
                      {briefing.coverageSnapshot.lossSettlement && <Text style={s.muted}>Settlement: {briefing.coverageSnapshot.lossSettlement}</Text>}
                    </View>
                  </Section>
                )}

                {briefing.perilAnalysis && (
                  <Section title="Peril Analysis">
                    <View style={s.card}>
                      {briefing.perilAnalysis.typicalDamagePatterns && <Text style={s.row}>{briefing.perilAnalysis.typicalDamagePatterns}</Text>}
                      {briefing.perilAnalysis.whatToLookFor && <><Text style={s.subhead}>What to look for</Text><BulletList items={briefing.perilAnalysis.whatToLookFor} /></>}
                      {briefing.perilAnalysis.inspectionPriorities && <><Text style={s.subhead}>Priorities</Text><BulletList items={briefing.perilAnalysis.inspectionPriorities} /></>}
                      {briefing.perilAnalysis.commonMistakes && <><Text style={s.subhead}>Common mistakes</Text><BulletList items={briefing.perilAnalysis.commonMistakes} /></>}
                    </View>
                  </Section>
                )}

                {briefing.endorsementImpacts && briefing.endorsementImpacts.length > 0 && (
                  <Section title="Endorsement Impacts">
                    <View style={s.card}>
                      {briefing.endorsementImpacts.map((e: any, i: number) => (
                        <View key={i} style={s.endorsement}>
                          <Text style={s.endorsementId}>{e.endorsementId || e.title}</Text>
                          <Text style={s.muted}>{e.adjusterGuidance || e.title}</Text>
                        </View>
                      ))}
                    </View>
                  </Section>
                )}

                {briefing.inspectionChecklist && (
                  <Section title="Inspection Checklist">
                    <View style={s.card}>
                      {Object.entries(briefing.inspectionChecklist).map(([category, items]) => (
                        <View key={category} style={s.checklistGroup}>
                          <Text style={s.subhead}>{category.charAt(0).toUpperCase() + category.slice(1)}</Text>
                          <BulletList items={items as string[]} />
                        </View>
                      ))}
                    </View>
                  </Section>
                )}

                {briefing.redFlags && briefing.redFlags.length > 0 && (
                  <Section title="Red Flags">
                    <View style={[s.card, { borderLeftWidth: 4, borderLeftColor: "#dc2626" }]}>
                      <BulletList items={briefing.redFlags} />
                    </View>
                  </Section>
                )}

                {briefing.dutiesAfterLoss && briefing.dutiesAfterLoss.length > 0 && (
                  <Section title="Duties After Loss">
                    <View style={s.card}><BulletList items={briefing.dutiesAfterLoss} /></View>
                  </Section>
                )}
              </>
            ) : (
              !briefingQuery.isLoading && <Text style={s.loadingText}>No briefing generated yet. Upload and confirm document extractions first.</Text>
            )}

            {/* Start inspection button */}
            <Pressable style={s.startBtn} onPress={() => router.replace({ pathname: "/inspection/[id]", params: { id: String(id) } })}>
              <Text style={s.startBtnText}>Start voice inspection</Text>
            </Pressable>
          </>
        )}
      </ScrollView>
    </AuthGate>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f8f7fc" },
  content: { padding: 16, paddingBottom: 48 },
  title: { fontSize: 24, fontWeight: "bold", color: "#342A4F", marginBottom: 16 },
  card: { backgroundColor: "#fff", borderRadius: 12, padding: 16, marginBottom: 12, shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 2, elevation: 2 },
  claimNumber: { fontSize: 20, fontWeight: "700", color: "#342A4F" },
  row: { fontSize: 15, color: "#374151", marginTop: 6 },
  muted: { fontSize: 13, color: "#9ca3af", marginTop: 4 },
  section: { marginBottom: 8 },
  sectionTitle: { fontSize: 16, fontWeight: "600", color: "#342A4F", marginBottom: 8 },
  subhead: { fontSize: 13, fontWeight: "600", color: "#6b7280", marginTop: 10, marginBottom: 4 },
  bullet: { fontSize: 14, color: "#374151", marginTop: 3, paddingLeft: 8 },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  badgeText: { color: "#fff", fontSize: 11, fontWeight: "600" },
  loadingText: { fontSize: 14, color: "#9ca3af", textAlign: "center", padding: 16 },
  // Weather
  weatherHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 },
  weatherSummary: { flex: 1, fontSize: 14, color: "#374151", lineHeight: 20, marginRight: 8 },
  riskBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  riskText: { color: "#fff", fontSize: 12, fontWeight: "700" },
  perilRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
  perilLabel: { fontSize: 13, color: "#6b7280" },
  perilResult: { fontSize: 13, fontWeight: "600", color: "#342A4F" },
  perilDetails: { fontSize: 13, color: "#6b7280", lineHeight: 20, marginBottom: 8 },
  indicator: { borderLeftWidth: 3, paddingLeft: 10, paddingVertical: 6, marginTop: 6 },
  indicatorText: { fontSize: 13, color: "#374151" },
  weatherGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 },
  weatherCell: { flex: 1, minWidth: 70, backgroundColor: "#f8f7fc", borderRadius: 8, padding: 8, alignItems: "center" },
  weatherVal: { fontSize: 14, fontWeight: "600", color: "#342A4F" },
  weatherLabel: { fontSize: 10, color: "#9ca3af", marginTop: 2 },
  // Endorsements
  endorsement: { marginBottom: 10, borderBottomWidth: 1, borderBottomColor: "#f3f4f6", paddingBottom: 8 },
  endorsementId: { fontSize: 13, fontWeight: "600", color: "#7763B7" },
  checklistGroup: { marginBottom: 8 },
  // Start button
  startBtn: { backgroundColor: "#7763B7", padding: 18, borderRadius: 12, alignItems: "center", marginTop: 16 },
  startBtnText: { fontSize: 18, fontWeight: "600", color: "#fff" },
});
