import { View, Text, Pressable, StyleSheet, ScrollView } from "react-native";
import { router } from "expo-router";
import { useAuth } from "@/contexts/AuthContext";
import { AuthGate } from "@/components/AuthGate";

function SettingsRow({ label, value, onPress }: { label: string; value?: string; onPress?: () => void }) {
  return (
    <Pressable style={s.row} onPress={onPress} disabled={!onPress}>
      <Text style={s.rowLabel}>{label}</Text>
      <Text style={s.rowValue}>{value || ""}</Text>
      {onPress && <Text style={s.rowArrow}>›</Text>}
    </Pressable>
  );
}

export default function SettingsScreen() {
  const { user, signOut } = useAuth();

  return (
    <AuthGate>
      <ScrollView style={s.container} contentContainerStyle={s.content}>
        <Text style={s.title}>Settings</Text>

        <Text style={s.sectionTitle}>Account</Text>
        <View style={s.card}>
          <SettingsRow label="Profile" value={user?.fullName || user?.email || "—"} onPress={() => router.push("/profile")} />
          <SettingsRow label="Email" value={user?.email || "—"} />
          <SettingsRow label="Role" value={user?.role || "—"} />
        </View>

        <Text style={s.sectionTitle}>Inspection</Text>
        <View style={s.card}>
          <SettingsRow label="Default structure" value="Main Dwelling" />
          <SettingsRow label="Default height" value="8 ft" />
          <SettingsRow label="Auto-photo analysis" value="On" />
        </View>

        <Text style={s.sectionTitle}>Export</Text>
        <View style={s.card}>
          <SettingsRow label="Export format" value="ESX + PDF" />
          <SettingsRow label="Include photos" value="Yes" />
          <SettingsRow label="Include sketches" value="Yes" />
        </View>

        <Text style={s.sectionTitle}>About</Text>
        <View style={s.card}>
          <SettingsRow label="App" value="Claims IQ Voice Inspector" />
          <SettingsRow label="Version" value="1.0.0" />
          <SettingsRow label="Bundle ID" value="com.voiceinspect.app" />
        </View>

        <Pressable style={s.signOutBtn} onPress={() => signOut()}>
          <Text style={s.signOutBtnText}>Sign out</Text>
        </Pressable>
      </ScrollView>
    </AuthGate>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f8f7fc" },
  content: { padding: 16, paddingBottom: 48 },
  title: { fontSize: 24, fontWeight: "bold", color: "#342A4F", marginBottom: 16 },
  sectionTitle: { fontSize: 13, fontWeight: "600", color: "#6b7280", textTransform: "uppercase", marginTop: 24, marginBottom: 8, paddingHorizontal: 4 },
  card: { backgroundColor: "#fff", borderRadius: 12, overflow: "hidden", shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 2, elevation: 2 },
  row: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: "#f3f4f6" },
  rowLabel: { flex: 1, fontSize: 15, color: "#374151" },
  rowValue: { fontSize: 14, color: "#9ca3af", marginRight: 8 },
  rowArrow: { fontSize: 20, color: "#d1d5db" },
  signOutBtn: { backgroundColor: "#dc2626", padding: 16, borderRadius: 12, alignItems: "center", marginTop: 32 },
  signOutBtnText: { fontSize: 16, fontWeight: "600", color: "#fff" },
});
