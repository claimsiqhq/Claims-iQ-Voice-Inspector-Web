import { useLocalSearchParams } from "expo-router";
import { View, Text, StyleSheet } from "react-native";
import { AuthGate } from "@/components/AuthGate";

export default function InspectionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();

  return (
    <AuthGate>
      <View style={styles.container}>
        <Text style={styles.title}>Inspection</Text>
        <Text style={styles.subtitle}>Claim ID: {id} — Active inspection coming soon</Text>
      </View>
    </AuthGate>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f8f7fc", padding: 16 },
  title: { fontSize: 24, fontWeight: "bold", color: "#342A4F" },
  subtitle: { fontSize: 14, color: "#6b7280", marginTop: 8 },
});
