import { useQuery } from "@tanstack/react-query";
import { View, Text, FlatList, Pressable, StyleSheet, ActivityIndicator } from "react-native";
import { router } from "expo-router";
import { AuthGate } from "@/components/AuthGate";

interface Claim {
  id: number;
  claimNumber: string;
  insuredName: string | null;
  propertyAddress: string | null;
  city: string | null;
  state: string | null;
  status: string;
  dateOfLoss?: string | null;
}

export default function ClaimsListScreen() {
  const { data: claims = [], isLoading, isError } = useQuery<Claim[]>({
    queryKey: ["/api/claims/my-claims"],
  });

  return (
    <AuthGate>
      <View style={styles.container}>
        <Text style={styles.title}>Claims</Text>
        {isLoading && (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color="#7763B7" />
          </View>
        )}
        {isError && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>Failed to load claims. Check your connection.</Text>
          </View>
        )}
        {!isLoading && !isError && (
          <FlatList
            data={claims}
            keyExtractor={(item) => String(item.id)}
            contentContainerStyle={styles.list}
            renderItem={({ item }) => (
              <Pressable
                style={styles.card}
                onPress={() => router.push({ pathname: "/inspection/[id]", params: { id: String(item.id) } })}
              >
                <Text style={styles.claimNumber}>{item.claimNumber}</Text>
                {(item.insuredName || item.propertyAddress) && (
                  <Text style={styles.subtitle} numberOfLines={1}>
                    {item.insuredName}
                    {item.insuredName && item.propertyAddress ? " — " : ""}
                    {item.propertyAddress}
                  </Text>
                )}
                <View style={styles.row}>
                  <View style={[styles.badge, styles.badge_default]}>
                    <Text style={styles.badgeText}>{item.status || "draft"}</Text>
                  </View>
                  {item.dateOfLoss && (
                    <Text style={styles.date}>{item.dateOfLoss}</Text>
                  )}
                </View>
              </Pressable>
            )}
          />
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
  list: { padding: 16, paddingBottom: 32 },
  card: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
  },
  claimNumber: { fontSize: 16, fontWeight: "600", color: "#342A4F" },
  subtitle: { fontSize: 14, color: "#6b7280", marginTop: 4 },
  row: { flexDirection: "row", alignItems: "center", marginTop: 8, gap: 8 },
  badge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  badge_default: { backgroundColor: "#e5e7eb" },
  badgeText: { fontSize: 12, fontWeight: "500", color: "#374151" },
  date: { fontSize: 12, color: "#9ca3af" },
});
