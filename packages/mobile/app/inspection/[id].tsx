import { useLocalSearchParams, router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from "react-native";
import { AuthGate } from "@/components/AuthGate";
import { Mic, FileText, Camera } from "@expo/vector-icons";

interface Claim {
  id: number;
  claimNumber: string;
  insuredName: string | null;
  propertyAddress: string | null;
  status: string;
  dateOfLoss: string | null;
}

export default function InspectionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: claim, isLoading, isError } = useQuery<Claim | null>({
    queryKey: [`/api/claims/${id}`],
    enabled: !!id,
  });

  return (
    <AuthGate>
      <View style={styles.container}>
        <Text style={styles.title}>Inspection</Text>
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
          <>
            <View style={styles.card}>
              <Text style={styles.claimNumber}>{claim.claimNumber}</Text>
              {claim.insuredName && <Text style={styles.subtitle}>{claim.insuredName}</Text>}
              {claim.propertyAddress && <Text style={styles.address}>{claim.propertyAddress}</Text>}
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{claim.status}</Text>
              </View>
            </View>

            <View style={styles.actions}>
              <Pressable style={styles.actionBtn} onPress={() => {}}>
                <Mic size={28} color="#fff" />
                <Text style={styles.actionText}>Start voice inspection</Text>
                <Text style={styles.actionHint}>Coming soon</Text>
              </Pressable>
              <Pressable
                style={[styles.actionBtn, styles.actionBtnSecondary]}
                onPress={() => router.push({ pathname: "/documents/[claimId]", params: { claimId: String(id) } })}
              >
                <FileText size={24} color="#7763B7" />
                <Text style={[styles.actionText, styles.actionTextSecondary]}>View documents</Text>
              </Pressable>
            </View>
          </>
        )}
      </View>
    </AuthGate>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f8f7fc", padding: 16 },
  title: { fontSize: 24, fontWeight: "bold", color: "#342A4F", marginBottom: 16 },
  centered: { flex: 1, justifyContent: "center", alignItems: "center" },
  errorBox: { padding: 16, backgroundColor: "#fef2f2", borderRadius: 8 },
  errorText: { color: "#b91c1c" },
  card: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 16,
    marginBottom: 24,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
  },
  claimNumber: { fontSize: 18, fontWeight: "600", color: "#342A4F" },
  subtitle: { fontSize: 14, color: "#6b7280", marginTop: 4 },
  address: { fontSize: 14, color: "#9ca3af", marginTop: 2 },
  badge: { alignSelf: "flex-start", marginTop: 8, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, backgroundColor: "#e5e7eb" },
  badgeText: { fontSize: 12, fontWeight: "500", color: "#374151" },
  actions: { gap: 12 },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "#7763B7",
    padding: 16,
    borderRadius: 12,
  },
  actionBtnSecondary: { backgroundColor: "#fff", borderWidth: 2, borderColor: "#7763B7" },
  actionText: { fontSize: 16, fontWeight: "600", color: "#fff" },
  actionTextSecondary: { color: "#7763B7" },
  actionHint: { marginLeft: "auto", fontSize: 12, color: "rgba(255,255,255,0.8)" },
});
