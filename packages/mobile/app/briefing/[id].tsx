import { useLocalSearchParams, router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { View, Text, StyleSheet, Pressable, ActivityIndicator, ScrollView } from "react-native";
import { AuthGate } from "@/components/AuthGate";
import { Mic, ChevronRight } from "@expo/vector-icons";

interface Claim {
  id: number;
  claimNumber: string;
  insuredName: string | null;
  propertyAddress: string | null;
  city: string | null;
  state: string | null;
  dateOfLoss: string | null;
  perilType: string | null;
}

export default function BriefingScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: claim, isLoading, isError } = useQuery<Claim | null>({
    queryKey: [`/api/claims/${id}`],
    enabled: !!id,
  });

  return (
    <AuthGate>
      <View style={styles.container}>
        <Text style={styles.title}>Inspection Briefing</Text>
        {isLoading && (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color="#7763B7" />
          </View>
        )}
        {isError && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>Failed to load claim.</Text>
          </View>
        )}
        {claim && (
          <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
            <View style={styles.card}>
              <Text style={styles.claimNumber}>{claim.claimNumber}</Text>
              {claim.insuredName && <Text style={styles.row}>{claim.insuredName}</Text>}
              {claim.propertyAddress && (
                <Text style={styles.row}>{[claim.propertyAddress, claim.city, claim.state].filter(Boolean).join(", ")}</Text>
              )}
              {claim.dateOfLoss && <Text style={styles.muted}>Date of loss: {claim.dateOfLoss}</Text>}
              {claim.perilType && <Text style={styles.muted}>Peril: {claim.perilType}</Text>}
            </View>
            <Text style={styles.sectionTitle}>Ready to inspect</Text>
            <Text style={styles.hint}>Review the claim details above. When ready, start the voice inspection to document rooms, damages, and photos.</Text>
            <Pressable
              style={styles.startBtn}
              onPress={() => router.replace({ pathname: "/inspection/[id]", params: { id: String(id) } })}
            >
              <Mic size={28} color="#fff" />
              <Text style={styles.startBtnText}>Start voice inspection</Text>
              <ChevronRight size={24} color="#fff" />
            </Pressable>
          </ScrollView>
        )}
      </View>
    </AuthGate>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f8f7fc" },
  title: { fontSize: 24, fontWeight: "bold", color: "#342A4F", padding: 16 },
  centered: { flex: 1, justifyContent: "center", alignItems: "center" },
  errorBox: { padding: 16, backgroundColor: "#fef2f2", margin: 16, borderRadius: 8 },
  errorText: { color: "#b91c1c" },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 48 },
  card: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 20,
    marginBottom: 24,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
  },
  claimNumber: { fontSize: 20, fontWeight: "700", color: "#342A4F" },
  row: { fontSize: 15, color: "#374151", marginTop: 6 },
  muted: { fontSize: 13, color: "#9ca3af", marginTop: 4 },
  sectionTitle: { fontSize: 18, fontWeight: "600", color: "#342A4F", marginBottom: 8 },
  hint: { fontSize: 14, color: "#6b7280", marginBottom: 24, lineHeight: 22 },
  startBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    backgroundColor: "#7763B7",
    padding: 18,
    borderRadius: 12,
  },
  startBtnText: { fontSize: 18, fontWeight: "600", color: "#fff" },
});
