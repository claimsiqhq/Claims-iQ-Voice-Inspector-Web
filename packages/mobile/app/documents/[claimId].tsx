import { useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { View, Text, FlatList, StyleSheet, ActivityIndicator } from "react-native";
import { AuthGate } from "@/components/AuthGate";

interface Document {
  id: number;
  documentType: string;
  fileName: string | null;
  status: string | null;
  createdAt: string;
}

export default function ClaimDocumentsScreen() {
  const { claimId } = useLocalSearchParams<{ claimId: string }>();
  const { data: documents = [], isLoading, isError } = useQuery<Document[]>({
    queryKey: [`/api/claims/${claimId}/documents`],
    enabled: !!claimId,
  });

  return (
    <AuthGate>
      <View style={styles.container}>
        <Text style={styles.title}>Documents</Text>
        <Text style={styles.subtitle}>Claim #{claimId}</Text>
        {isLoading && (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color="#7763B7" />
          </View>
        )}
        {isError && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>Failed to load documents.</Text>
          </View>
        )}
        {!isLoading && !isError && documents.length === 0 && (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No documents yet.</Text>
            <Text style={styles.emptySubtext}>Upload documents from the web app.</Text>
          </View>
        )}
        {!isLoading && !isError && documents.length > 0 && (
          <FlatList
            data={documents}
            keyExtractor={(item) => String(item.id)}
            contentContainerStyle={styles.list}
            renderItem={({ item }) => (
              <View style={styles.card}>
                <Text style={styles.docType}>{item.documentType}</Text>
                <Text style={styles.fileName}>{item.fileName || "Untitled"}</Text>
                <Text style={styles.status}>{item.status || "uploaded"}</Text>
              </View>
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
  subtitle: { fontSize: 14, color: "#6b7280", paddingHorizontal: 16 },
  centered: { flex: 1, justifyContent: "center", alignItems: "center" },
  errorBox: { padding: 16, backgroundColor: "#fef2f2", margin: 16, borderRadius: 8 },
  errorText: { color: "#b91c1c" },
  empty: { flex: 1, justifyContent: "center", alignItems: "center", padding: 24 },
  emptyText: { fontSize: 18, color: "#6b7280" },
  emptySubtext: { fontSize: 14, color: "#9ca3af", marginTop: 8 },
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
  docType: { fontSize: 12, color: "#7763B7", fontWeight: "600", textTransform: "uppercase" },
  fileName: { fontSize: 16, color: "#342A4F", marginTop: 4 },
  status: { fontSize: 12, color: "#9ca3af", marginTop: 4 },
});
