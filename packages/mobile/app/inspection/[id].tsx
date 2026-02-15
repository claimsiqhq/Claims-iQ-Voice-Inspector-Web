import { useLocalSearchParams, router } from "expo-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  ScrollView,
  Alert,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system";
import { AuthGate } from "@/components/AuthGate";
import { API_BASE, getAuthHeaders } from "@/lib/api";
import { Mic, FileText, Camera, Image as ImageIcon } from "@expo/vector-icons";

interface Claim {
  id: number;
  claimNumber: string;
  insuredName: string | null;
  propertyAddress: string | null;
  status: string;
  dateOfLoss: string | null;
}

async function fileToBase64(uri: string): Promise<string> {
  const base64 = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  return `data:image/jpeg;base64,${base64}`;
}

export default function InspectionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const qc = useQueryClient();
  const [uploading, setUploading] = useState(false);

  const { data: claim, isLoading, isError } = useQuery<Claim | null>({
    queryKey: [`/api/claims/${id}`],
    enabled: !!id,
  });

  const uploadPhotoMutation = useMutation({
    mutationFn: async (payload: { imageData: string; fileName: string }) => {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API_BASE}/api/photolab/upload`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(await res.text());
      const photo = await res.json();
      const attachRes = await fetch(`${API_BASE}/api/photolab/photos/${photo.id}/attach`, {
        method: "PATCH",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ claimId: parseInt(String(id)) }),
      });
      if (!attachRes.ok) throw new Error(await attachRes.text());
      return photo;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [`/api/claims/${id}`] });
      setUploading(false);
    },
    onError: (e) => {
      setUploading(false);
      Alert.alert("Upload failed", String(e));
    },
  });

  async function takePhoto() {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission needed", "Camera access is required.");
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ["images"],
      quality: 0.8,
      base64: true,
    });
    if (result.canceled || !result.assets[0].base64) return;
    setUploading(true);
    uploadPhotoMutation.mutate({
      imageData: `data:image/jpeg;base64,${result.assets[0].base64}`,
      fileName: `inspection_${Date.now()}.jpg`,
    });
  }

  async function pickPhoto() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.8,
      base64: true,
    });
    if (result.canceled || !result.assets[0].base64) return;
    setUploading(true);
    uploadPhotoMutation.mutate({
      imageData: `data:image/jpeg;base64,${result.assets[0].base64}`,
      fileName: result.assets[0].fileName || `inspection_${Date.now()}.jpg`,
    });
  }

  return (
    <AuthGate>
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
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

            <Text style={styles.sectionTitle}>Capture photos</Text>
            <View style={styles.photoRow}>
              <Pressable style={[styles.actionBtn, uploading && styles.disabled]} onPress={takePhoto} disabled={uploading}>
                <Camera size={28} color="#fff" />
                <Text style={styles.actionText}>Camera</Text>
              </Pressable>
              <Pressable style={[styles.actionBtn, styles.actionBtnSecondary, uploading && styles.disabled]} onPress={pickPhoto} disabled={uploading}>
                <ImageIcon size={24} color="#7763B7" />
                <Text style={[styles.actionText, styles.actionTextSecondary]}>Gallery</Text>
              </Pressable>
            </View>
            {uploading && <Text style={styles.uploading}>Uploading photo...</Text>}

            <Text style={styles.sectionTitle}>Actions</Text>
            <View style={styles.actions}>
              <Pressable
                style={styles.actionBtnWide}
                onPress={() => router.push({ pathname: "/briefing/[id]", params: { id: String(id) } })}
              >
                <Mic size={24} color="#fff" />
                <Text style={styles.actionText}>Voice inspection</Text>
              </Pressable>
              <Pressable
                style={[styles.actionBtnWide, styles.actionBtnSecondary]}
                onPress={() => router.push({ pathname: "/documents/[claimId]", params: { claimId: String(id) } })}
              >
                <FileText size={24} color="#7763B7" />
                <Text style={[styles.actionText, styles.actionTextSecondary]}>Documents</Text>
              </Pressable>
              <Pressable
                style={[styles.actionBtnWide, styles.actionBtnSecondary]}
                onPress={() => router.push({ pathname: "/inspection/[id]/review", params: { id: String(id) } })}
              >
                <Text style={[styles.actionText, styles.actionTextSecondary]}>Review & export</Text>
              </Pressable>
            </View>
          </>
        )}
      </ScrollView>
    </AuthGate>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f8f7fc" },
  content: { padding: 16, paddingBottom: 48 },
  title: { fontSize: 24, fontWeight: "bold", color: "#342A4F", marginBottom: 16 },
  centered: { padding: 48 },
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
  sectionTitle: { fontSize: 16, fontWeight: "600", color: "#342A4F", marginBottom: 12 },
  photoRow: { flexDirection: "row", gap: 12, marginBottom: 8 },
  actionBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    backgroundColor: "#7763B7",
    padding: 16,
    borderRadius: 12,
  },
  actionBtnSecondary: { backgroundColor: "#fff", borderWidth: 2, borderColor: "#7763B7" },
  actionBtnWide: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    backgroundColor: "#7763B7",
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
  },
  disabled: { opacity: 0.6 },
  actionText: { fontSize: 16, fontWeight: "600", color: "#fff" },
  actionTextSecondary: { color: "#7763B7" },
  uploading: { fontSize: 14, color: "#6b7280", marginBottom: 16 },
  actions: { marginTop: 8 },
});
