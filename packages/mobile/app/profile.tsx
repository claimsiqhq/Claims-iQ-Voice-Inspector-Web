import { useState } from "react";
import { View, Text, StyleSheet, TextInput, Pressable, Alert, ActivityIndicator } from "react-native";
import { useMutation } from "@tanstack/react-query";
import { useAuth, AuthUser } from "@/contexts/AuthContext";
import { apiRequest } from "@/lib/api";
import { AuthGate } from "@/components/AuthGate";
import { router } from "expo-router";

export default function ProfileScreen() {
  const { user, refreshSession } = useAuth();
  const [fullName, setFullName] = useState(user?.fullName || "");
  const [title, setTitle] = useState(user?.title || "");

  const updateMut = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PATCH", "/api/profile", { fullName, title });
      return res.json();
    },
    onSuccess: () => {
      refreshSession();
      Alert.alert("Updated", "Profile saved.");
    },
    onError: (e) => Alert.alert("Error", String(e)),
  });

  return (
    <AuthGate>
      <View style={s.container}>
        <Text style={s.title}>Profile</Text>
        <View style={s.avatar}>
          <Text style={s.avatarText}>{(user?.fullName || user?.email || "?")[0].toUpperCase()}</Text>
        </View>
        <View style={s.field}>
          <Text style={s.label}>Full name</Text>
          <TextInput style={s.input} value={fullName} onChangeText={setFullName} placeholder="Your name" />
        </View>
        <View style={s.field}>
          <Text style={s.label}>Title</Text>
          <TextInput style={s.input} value={title} onChangeText={setTitle} placeholder="e.g. Field Adjuster" />
        </View>
        <View style={s.field}>
          <Text style={s.label}>Email</Text>
          <Text style={s.readOnly}>{user?.email || "—"}</Text>
        </View>
        <View style={s.field}>
          <Text style={s.label}>Role</Text>
          <Text style={s.readOnly}>{user?.role || "—"}</Text>
        </View>
        <Pressable style={s.saveBtn} onPress={() => updateMut.mutate()} disabled={updateMut.isPending}>
          <Text style={s.saveBtnText}>{updateMut.isPending ? "Saving..." : "Save profile"}</Text>
        </Pressable>
        <Pressable style={s.link} onPress={() => router.push("/(tabs)/settings")}>
          <Text style={s.linkText}>Settings</Text>
        </Pressable>
      </View>
    </AuthGate>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f8f7fc", padding: 16 },
  title: { fontSize: 22, fontWeight: "bold", color: "#342A4F", marginBottom: 16 },
  avatar: { width: 80, height: 80, borderRadius: 40, backgroundColor: "#7763B7", alignSelf: "center", justifyContent: "center", alignItems: "center", marginBottom: 24 },
  avatarText: { fontSize: 32, fontWeight: "700", color: "#fff" },
  field: { marginBottom: 16 },
  label: { fontSize: 13, fontWeight: "500", color: "#6b7280", marginBottom: 4 },
  input: { borderWidth: 1, borderColor: "#d1d5db", borderRadius: 10, padding: 14, fontSize: 15, color: "#374151", backgroundColor: "#fff" },
  readOnly: { fontSize: 15, color: "#9ca3af", paddingVertical: 14 },
  saveBtn: { backgroundColor: "#7763B7", padding: 16, borderRadius: 12, alignItems: "center", marginTop: 8, marginBottom: 12 },
  saveBtnText: { fontSize: 16, fontWeight: "600", color: "#fff" },
  link: { alignItems: "center", paddingVertical: 12 },
  linkText: { fontSize: 15, color: "#7763B7", fontWeight: "500" },
});
