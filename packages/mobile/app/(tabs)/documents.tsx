import { useQuery } from "@tanstack/react-query";
import { View, Text, FlatList, Pressable, StyleSheet, ActivityIndicator } from "react-native";
import { router } from "expo-router";
import { AuthGate } from "@/components/AuthGate";
import { FileText } from "@expo/vector-icons";

interface Claim {
  id: number;
  claimNumber: string;
  insuredName: string | null;
  propertyAddress: string | null;
  status: string;
}

export default function DocumentsScreen() {
  const { data: claims = [], isLoading, isError } = useQuery<Claim[]>({
    queryKey: ["/api/claims/my-claims"],
  });

  return (
    <AuthGate>
      <View style={styles.container}>
        <Text style={styles.title}>Documents</Text>
        <Text style={styles.subtitle}>Select a claim to view or upload documents</Text>
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
                onPress={() => router.push({ pathname: "/documents/[claimId]", params: { claimId: String(item.id) } })}
              >
                <FileText size={24} color="#7763B7" style={styles.icon} />
                <View style={styles.cardContent}>
                  <Text style={styles.claimNumber}>{item.claimNumber}</Text>
                  {(item.insuredName || item.propertyAddress) && (
                    <Text style={styles.subtitle} numberOfLines={1}>
                      {item.insuredName}
                      {item.insuredName && item.propertyAddress ? " — " : ""}
                      {item.propertyAddress}
                    </Text>
                  )}
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>{item.status || "draft"}</Text>
                  </View>
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
  subtitle: { fontSize: 14, color: "#6b7280", marginTop: 4, paddingHorizontal: 16 },
  centered: { flex: 1, justifyContent: "center", alignItems: "center" },
  errorBox: { padding: 16, backgroundColor: "#fef2f2", margin: 16, borderRadius: 8 },
  errorText: { color: "#b91c1c" },
  list: { padding: 16, paddingBottom: 32 },
  card: {
    flexDirection: "row",
    alignItems: "center",
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
  icon: { marginRight: 12 },
  cardContent: { flex: 1 },
  claimNumber: { fontSize: 16, fontWeight: "600", color: "#342A4F" },
  badge: { alignSelf: "flex-start", marginTop: 8, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, backgroundColor: "#e5e7eb" },
  badgeText: { fontSize: 12, fontWeight: "500", color: "#374151" },
});
