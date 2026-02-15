import { useLocalSearchParams, router } from "expo-router";
import { useEffect } from "react";
import { View, Text, StyleSheet, ActivityIndicator } from "react-native";
import { AuthGate } from "@/components/AuthGate";

export default function UploadScreen() {
  const { claimId } = useLocalSearchParams<{ claimId: string }>();
  useEffect(() => {
    if (claimId) router.replace({ pathname: "/documents/[claimId]", params: { claimId } });
  }, [claimId]);
  return (
    <AuthGate>
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#7763B7" />
        <Text style={styles.subtitle}>Opening documents...</Text>
      </View>
    </AuthGate>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f8f7fc", padding: 16 },
  title: { fontSize: 24, fontWeight: "bold", color: "#342A4F" },
  subtitle: { fontSize: 14, color: "#6b7280", marginTop: 8 },
});
