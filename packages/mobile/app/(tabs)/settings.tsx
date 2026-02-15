import { View, Text, Pressable, StyleSheet } from "react-native";
import { router } from "expo-router";
import { useAuth } from "@/contexts/AuthContext";
import { AuthGate } from "@/components/AuthGate";

export default function SettingsScreen() {
  const { user, signOut } = useAuth();

  return (
    <AuthGate>
      <View style={styles.container}>
        <Text style={styles.title}>Settings</Text>
        {user && (
          <View style={styles.section}>
            <Text style={styles.label}>Signed in as</Text>
            <Text style={styles.value}>{user.email || user.fullName || "User"}</Text>
          </View>
        )}
        <Pressable style={styles.button} onPress={() => signOut()}>
          <Text style={styles.buttonText}>Sign Out</Text>
        </Pressable>
      </View>
    </AuthGate>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f8f7fc", padding: 16 },
  title: { fontSize: 24, fontWeight: "bold", color: "#342A4F" },
  section: { marginTop: 24, marginBottom: 16 },
  label: { fontSize: 14, color: "#6b7280" },
  value: { fontSize: 16, fontWeight: "500", color: "#342A4F", marginTop: 4 },
  button: { backgroundColor: "#7763B7", padding: 14, borderRadius: 8, alignItems: "center", marginTop: 8 },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
});
