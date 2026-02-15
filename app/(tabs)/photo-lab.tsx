import { useQuery } from "@tanstack/react-query";
import { View, Text, FlatList, StyleSheet, ActivityIndicator, Image, Pressable } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AuthGate } from "@/components/AuthGate";
import { API_BASE, getAuthHeaders } from "@/lib/api";
import { Camera, Image as ImageIcon } from "@expo/vector-icons";

interface Photo {
  id: number;
  fileName: string | null;
  signedUrl: string | null;
  analysisStatus: string | null;
}

export default function PhotoLabTabScreen() {
  const qc = useQueryClient();
  const [uploading, setUploading] = useState(false);

  const { data: photos = [], isLoading, isError } = useQuery<Photo[]>({
    queryKey: ["/api/photolab/photos"],
  });

  const uploadMutation = useMutation({
    mutationFn: async (payload: { imageData: string; fileName: string }) => {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API_BASE}/api/photolab/upload`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/photolab/photos"] });
      setUploading(false);
    },
    onError: () => setUploading(false),
  });

  async function takePhoto() {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== "granted") return;
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ["images"],
      quality: 0.8,
      base64: true,
    });
    if (result.canceled || !result.assets[0].base64) return;
    setUploading(true);
    uploadMutation.mutate({
      imageData: `data:image/jpeg;base64,${result.assets[0].base64}`,
      fileName: `photo_${Date.now()}.jpg`,
    });
  }

  async function pickImage() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.8,
      base64: true,
    });
    if (result.canceled || !result.assets[0].base64) return;
    setUploading(true);
    uploadMutation.mutate({
      imageData: `data:image/jpeg;base64,${result.assets[0].base64}`,
      fileName: result.assets[0].fileName || `photo_${Date.now()}.jpg`,
    });
  }

  return (
    <AuthGate>
      <View style={styles.container}>
        <Text style={styles.title}>Photo Lab</Text>
        <View style={styles.uploadRow}>
          <Pressable style={[styles.uploadBtn, uploading && styles.uploadBtnDisabled]} onPress={takePhoto} disabled={uploading}>
            <Camera size={24} color="#fff" />
            <Text style={styles.uploadBtnText}>Camera</Text>
          </Pressable>
          <Pressable style={[styles.uploadBtn, styles.uploadBtnOutline, uploading && styles.uploadBtnDisabled]} onPress={pickImage} disabled={uploading}>
            <ImageIcon size={24} color="#7763B7" />
            <Text style={[styles.uploadBtnText, styles.uploadBtnTextOutline]}>Gallery</Text>
          </Pressable>
        </View>
        {uploading && <Text style={styles.uploading}>Uploading...</Text>}
        {isLoading && <ActivityIndicator size="large" color="#7763B7" style={styles.loader} />}
        {isError && <Text style={styles.error}>Failed to load photos</Text>}
        {!isLoading && !isError && photos.length === 0 && (
          <View style={styles.empty}>
            <ImageIcon size={64} color="#9ca3af" />
            <Text style={styles.emptyText}>No photos yet</Text>
            <Text style={styles.emptyHint}>Take or upload photos above</Text>
          </View>
        )}
        {!isLoading && !isError && photos.length > 0 && (
          <FlatList
            data={photos}
            numColumns={2}
            keyExtractor={(item) => String(item.id)}
            contentContainerStyle={styles.grid}
            columnWrapperStyle={styles.row}
            renderItem={({ item }) => (
              <View style={styles.photoCard}>
                {item.signedUrl ? (
                  <Image source={{ uri: item.signedUrl }} style={styles.thumb} />
                ) : (
                  <View style={[styles.thumb, styles.thumbPlaceholder]}>
                    <ImageIcon size={32} color="#9ca3af" />
                  </View>
                )}
                <Text style={styles.photoName} numberOfLines={1}>{item.fileName || "Photo"}</Text>
                <Text style={styles.photoStatus}>{item.analysisStatus || "pending"}</Text>
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
  uploadRow: { flexDirection: "row", gap: 12, paddingHorizontal: 16, marginBottom: 16 },
  uploadBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: "#7763B7", padding: 14, borderRadius: 12 },
  uploadBtnOutline: { backgroundColor: "#fff", borderWidth: 2, borderColor: "#7763B7" },
  uploadBtnDisabled: { opacity: 0.6 },
  uploadBtnText: { fontSize: 15, fontWeight: "600", color: "#fff" },
  uploadBtnTextOutline: { color: "#7763B7" },
  uploading: { paddingHorizontal: 16, fontSize: 14, color: "#6b7280", marginBottom: 8 },
  loader: { marginTop: 48 },
  error: { padding: 16, color: "#b91c1c" },
  empty: { flex: 1, justifyContent: "center", alignItems: "center", padding: 24 },
  emptyText: { fontSize: 18, color: "#6b7280", marginTop: 12 },
  emptyHint: { fontSize: 14, color: "#9ca3af", marginTop: 4 },
  grid: { padding: 16, paddingBottom: 48 },
  row: { gap: 12, marginBottom: 12 },
  photoCard: { flex: 1, backgroundColor: "#fff", borderRadius: 12, overflow: "hidden", shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 2, elevation: 2 },
  thumb: { width: "100%", aspectRatio: 1, backgroundColor: "#f3f4f6" },
  thumbPlaceholder: { justifyContent: "center", alignItems: "center" },
  photoName: { padding: 8, fontSize: 13, color: "#374151" },
  photoStatus: { paddingHorizontal: 8, paddingBottom: 8, fontSize: 11, color: "#9ca3af" },
});
