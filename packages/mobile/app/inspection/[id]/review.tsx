import { useLocalSearchParams, router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from "react-native";
import { AuthGate } from "@/components/AuthGate";

interface Claim {
  id: number;
  claimNumber: string;
  insuredName: string | null;
  status: string;
}

export default function ReviewScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: claim, isLoading, isError } = useQuery<Claim | null>({
    queryKey: [`/api/claims/${id}`],
    enabled: !!id,
  });

  return (
    <AuthGate>
      <View style={styles.container}>
        <Text style={styles.title}>Review & Export</Text>
        {isLoading && <ActivityIndicator size="large" color="#7763B7" style={styles.loader} />}
        {isError && <Text style={styles.error}>Failed to load claim</Text>}
        {claim && (
          <>
            <View style={styles.card}>
              <Text style={styles.claimNumber}>{claim.claimNumber}</Text>
              {claim.insuredName && <Text style={styles.subtitle}>{claim.insuredName}</Text>}
              <View style={styles.badge}><Text style={styles.badgeText}>{claim.status}</Text></View>
            </View>
            <Text style={styles.hint}>Full scope review and export available on the web app. Use this screen to view claim summary.</Text>
            <Pressable style={styles.btn} onPress={() => router.back()}>
              <Text style={styles.btnText}>Back to inspection</Text>
            </Pressable>
          </>
        )}
      </View>
    </AuthGate>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f8f7fc", padding: 16 },
  title: { fontSize: 24, fontWeight: "bold", color: "#342A4F", marginBottom: 16 },
  loader: { marginTop: 48 },
  error: { color: "#b91c1c", padding: 16 },
  card: { backgroundColor: "#fff", borderRadius: 12, padding: 16, marginBottom: 24, shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 2, elevation: 2 },
  claimNumber: { fontSize: 18, fontWeight: "600", color: "#342A4F" },
  subtitle: { fontSize: 14, color: "#6b7280", marginTop: 4 },
  badge: { alignSelf: "flex-start", marginTop: 8, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, backgroundColor: "#e5e7eb" },
  badgeText: { fontSize: 12, fontWeight: "500", color: "#374151" },
  hint: { fontSize: 14, color: "#6b7280", marginBottom: 24, lineHeight: 22 },
  btn: { backgroundColor: "#7763B7", padding: 16, borderRadius: 12, alignItems: "center" },
  btnText: { fontSize: 16, fontWeight: "600", color: "#fff" },
});
