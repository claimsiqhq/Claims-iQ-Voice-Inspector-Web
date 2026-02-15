import { useLocalSearchParams, router } from "expo-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, Pressable, Alert } from "react-native";
import { AuthGate } from "@/components/AuthGate";
import { apiRequest } from "@/lib/api";

interface Extraction { id: number; claimId: number; documentType: string; extractedData: any; confidence: any; confirmedByUser: boolean; }

const SEV_COLORS: Record<string, string> = { high: "#16a34a", medium: "#d97706", low: "#dc2626" };

export default function ExtractionScreen() {
  const { claimId } = useLocalSearchParams<{ claimId: string }>();
  const qc = useQueryClient();

  const { data: extractions = [], isLoading } = useQuery<Extraction[]>({
    queryKey: [`/api/claims/${claimId}/extractions`],
    enabled: !!claimId,
  });

  const confirmMut = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", `/api/claims/${claimId}/extractions/confirm-all`);
      await apiRequest("POST", `/api/claims/${claimId}/briefing/generate`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [`/api/claims/${claimId}/extractions`] });
      Alert.alert("Done", "Extractions confirmed and briefing generated.", [
        { text: "Go to briefing", onPress: () => router.push({ pathname: "/briefing/[id]", params: { id: String(claimId) } }) },
      ]);
    },
    onError: (e) => Alert.alert("Error", String(e)),
  });

  function renderFields(data: any, confidence: any) {
    if (!data || typeof data !== "object") return null;
    return Object.entries(data).map(([key, val]) => {
      const level = confidence?.[key] || "medium";
      return (
        <View key={key} style={s.field}>
          <View style={s.fieldHeader}>
            <Text style={s.fieldKey}>{key.replace(/_/g, " ")}</Text>
            <View style={[s.confBadge, { backgroundColor: SEV_COLORS[level] || "#9ca3af" }]}>
              <Text style={s.confText}>{level}</Text>
            </View>
          </View>
          <Text style={s.fieldValue}>{typeof val === "string" ? val : JSON.stringify(val)}</Text>
        </View>
      );
    });
  }

  return (
    <AuthGate>
      <ScrollView style={s.container} contentContainerStyle={s.content}>
        <Text style={s.title}>Extraction Review</Text>
        <Text style={s.subtitle}>Claim #{claimId}</Text>
        {isLoading && <ActivityIndicator size="large" color="#7763B7" style={{ marginTop: 48 }} />}
        {!isLoading && extractions.length === 0 && (
          <View style={s.empty}>
            <Text style={s.emptyText}>No extractions yet.</Text>
            <Text style={s.emptyHint}>Upload and parse documents first.</Text>
          </View>
        )}
        {extractions.map((ext) => (
          <View key={ext.id} style={s.card}>
            <View style={s.cardHeader}>
              <Text style={s.docType}>{ext.documentType.toUpperCase()}</Text>
              {ext.confirmedByUser && <Text style={s.confirmed}>Confirmed</Text>}
            </View>
            {renderFields(ext.extractedData, ext.confidence)}
          </View>
        ))}
        {extractions.length > 0 && !extractions.every((e) => e.confirmedByUser) && (
          <Pressable style={s.confirmBtn} onPress={() => confirmMut.mutate()}>
            <Text style={s.confirmBtnText}>{confirmMut.isPending ? "Processing..." : "Confirm all & generate briefing"}</Text>
          </Pressable>
        )}
      </ScrollView>
    </AuthGate>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f8f7fc" },
  content: { padding: 16, paddingBottom: 48 },
  title: { fontSize: 22, fontWeight: "bold", color: "#342A4F" },
  subtitle: { fontSize: 14, color: "#6b7280", marginTop: 4, marginBottom: 16 },
  empty: { padding: 48, alignItems: "center" },
  emptyText: { fontSize: 16, color: "#6b7280" },
  emptyHint: { fontSize: 14, color: "#9ca3af", marginTop: 8 },
  card: { backgroundColor: "#fff", borderRadius: 12, padding: 16, marginBottom: 16, shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 2, elevation: 2 },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  docType: { fontSize: 14, fontWeight: "700", color: "#7763B7" },
  confirmed: { fontSize: 12, color: "#16a34a", fontWeight: "600" },
  field: { marginBottom: 12 },
  fieldHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  fieldKey: { fontSize: 12, fontWeight: "500", color: "#6b7280", textTransform: "capitalize" },
  confBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  confText: { fontSize: 10, color: "#fff", fontWeight: "600" },
  fieldValue: { fontSize: 15, color: "#374151", marginTop: 4 },
  confirmBtn: { backgroundColor: "#7763B7", padding: 16, borderRadius: 12, alignItems: "center", marginTop: 8 },
  confirmBtnText: { fontSize: 16, fontWeight: "600", color: "#fff" },
});
