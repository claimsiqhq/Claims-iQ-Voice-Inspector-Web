import { useLocalSearchParams, router } from "expo-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  Pressable,
  Alert,
  Modal,
} from "react-native";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system";
import * as WebBrowser from "expo-web-browser";
import { AuthGate } from "@/components/AuthGate";
import { API_BASE, getAuthHeaders } from "@/lib/api";
import { Upload, FileText, Camera, CheckCircle } from "@expo/vector-icons";

const DOC_TYPES = [
  { key: "fnol", label: "FNOL", description: "First Notice of Loss" },
  { key: "policy", label: "Policy", description: "Insurance Policy" },
  { key: "endorsements", label: "Endorsements", description: "Policy Endorsements" },
  { key: "photo", label: "Photo", description: "Inspection Photo" },
  { key: "other", label: "Other", description: "Other Document" },
] as const;

interface Document {
  id: number;
  documentType: string;
  fileName: string | null;
  status: string | null;
  storagePath: string | null;
}

async function fileToBase64(uri: string): Promise<string> {
  const base64 = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  const mime = uri.endsWith(".pdf") ? "application/pdf" : "image/jpeg";
  return `data:${mime};base64,${base64}`;
}

export default function ClaimDocumentsScreen() {
  const { claimId } = useLocalSearchParams<{ claimId: string }>();
  const qc = useQueryClient();
  const [uploading, setUploading] = useState(false);
  const [showDocTypePicker, setShowDocTypePicker] = useState(false);
  const [pendingFile, setPendingFile] = useState<{ fileData: string; fileName: string } | null>(null);

  const { data: documents = [], isLoading, isError } = useQuery<Document[]>({
    queryKey: [`/api/claims/${claimId}/documents`],
    enabled: !!claimId,
  });

  const uploadMutation = useMutation({
    mutationFn: async (payload: { fileData: string; fileName: string; documentType: string }) => {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API_BASE}/api/claims/${claimId}/documents/upload`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [`/api/claims/${claimId}/documents`] });
      setUploading(false);
    },
    onError: (e) => {
      setUploading(false);
      Alert.alert("Upload failed", String(e));
    },
  });

  const openPdfMutation = useMutation({
    mutationFn: async (docId: number) => {
      const headers = await getAuthHeaders();
      const res = await fetch(
        `${API_BASE}/api/claims/${claimId}/documents/${docId}/url`,
        { headers: { ...headers } }
      );
      if (!res.ok) throw new Error(await res.text());
      const { url } = await res.json();
      await WebBrowser.openBrowserAsync(url);
    },
    onError: (e) => Alert.alert("Could not open document", String(e)),
  });

  async function pickDocument() {
    const result = await DocumentPicker.getDocumentAsync({
      type: "application/pdf",
      copyToCacheDirectory: true,
    });
    if (result.canceled) return;
    const file = result.assets[0];
    const fileData = await fileToBase64(file.uri);
    setPendingFile({ fileData, fileName: file.name });
    setShowDocTypePicker(true);
  }

  function uploadWithType(documentType: string) {
    if (!pendingFile) return;
    setShowDocTypePicker(false);
    setUploading(true);
    uploadMutation.mutate({
      fileData: pendingFile.fileData,
      fileName: pendingFile.fileName,
      documentType,
    });
    setPendingFile(null);
  }

  async function takePhoto() {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission needed", "Camera access is required to take photos.");
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ["images"],
      quality: 0.8,
      base64: true,
    });
    if (result.canceled || !result.assets[0].base64) return;
    setUploading(true);
    const fileData = `data:image/jpeg;base64,${result.assets[0].base64}`;
    uploadMutation.mutate({
      fileData,
      fileName: `photo_${Date.now()}.jpg`,
      documentType: "photo",
    });
  }

  return (
    <AuthGate>
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>Documents</Text>
          <Text style={styles.subtitle}>Claim #{claimId}</Text>
        </View>

        <View style={styles.uploadRow}>
          <Pressable
            style={[styles.uploadBtn, uploading && styles.uploadBtnDisabled]}
            onPress={pickDocument}
            disabled={uploading}
          >
            <Upload size={22} color="#fff" />
            <Text style={styles.uploadBtnText}>Upload PDF</Text>
          </Pressable>
          <Pressable
            style={[styles.uploadBtn, styles.uploadBtnSecondary, uploading && styles.uploadBtnDisabled]}
            onPress={takePhoto}
            disabled={uploading}
          >
            <Camera size={22} color="#7763B7" />
            <Text style={[styles.uploadBtnText, styles.uploadBtnTextSecondary]}>Take Photo</Text>
          </Pressable>
        </View>
        {uploading && (
          <View style={styles.uploadingBar}>
            <ActivityIndicator size="small" color="#7763B7" />
            <Text style={styles.uploadingText}>Uploading...</Text>
          </View>
        )}

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
            <FileText size={48} color="#9ca3af" />
            <Text style={styles.emptyText}>No documents yet</Text>
            <Text style={styles.emptySubtext}>Upload a PDF or take a photo above</Text>
          </View>
        )}
        {/* Extraction status + generate briefing */}
        {!isLoading && !isError && documents.some(d => ["fnol", "policy", "endorsements"].includes(d.documentType)) && (
          <View style={styles.extractionBox}>
            <Text style={styles.extractionTitle}>Document extraction</Text>
            {["fnol", "policy", "endorsements"].map((type) => {
              const doc = documents.find(d => d.documentType === type);
              return (
                <View key={type} style={styles.extractionRow}>
                  <Text style={styles.extractionType}>{type.toUpperCase()}</Text>
                  {doc ? (
                    <View style={styles.extractionStatus}>
                      <CheckCircle size={16} color={doc.status === "parsed" ? "#16a34a" : doc.status === "parse_failed" ? "#dc2626" : "#d97706"} />
                      <Text style={styles.extractionStatusText}>{doc.status === "parsed" ? "Extracted" : doc.status === "parse_failed" ? "Failed" : "Processing..."}</Text>
                    </View>
                  ) : (
                    <Text style={styles.extractionMissing}>Not uploaded</Text>
                  )}
                </View>
              );
            })}
            {documents.some(d => d.status === "parsed") && (
              <View style={styles.extractionActions}>
                <Pressable
                  style={styles.reviewBtn}
                  onPress={() => router.push({ pathname: "/extraction/[claimId]", params: { claimId: String(claimId) } })}
                >
                  <Text style={styles.reviewBtnText}>Review extractions</Text>
                </Pressable>
              </View>
            )}
          </View>
        )}

        {!isLoading && !isError && documents.length > 0 && (
          <FlatList
            data={documents}
            keyExtractor={(item) => String(item.id)}
            contentContainerStyle={styles.list}
            renderItem={({ item }) => (
              <Pressable
                style={styles.card}
                onPress={() => item.fileName?.endsWith(".pdf") && openPdfMutation.mutate(item.id)}
              >
                <FileText size={24} color="#7763B7" />
                <View style={styles.cardContent}>
                  <Text style={styles.fileName}>{item.fileName || "Untitled"}</Text>
                  <Text style={styles.status}>{item.documentType} • {item.status || "uploaded"}</Text>
                </View>
                {item.fileName?.endsWith(".pdf") && (
                  <Text style={styles.viewLink}>View</Text>
                )}
              </Pressable>
            )}
          />
        )}
        {/* Document type picker modal */}
        <Modal visible={showDocTypePicker} transparent animationType="slide">
          <View style={styles.modal}>
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>What type of document is this?</Text>
              <Text style={styles.modalSubtitle}>{pendingFile?.fileName}</Text>
              {DOC_TYPES.filter(t => t.key !== "photo").map((type) => (
                <Pressable
                  key={type.key}
                  style={styles.docTypeBtn}
                  onPress={() => uploadWithType(type.key)}
                >
                  <Text style={styles.docTypeBtnLabel}>{type.label}</Text>
                  <Text style={styles.docTypeBtnDesc}>{type.description}</Text>
                </Pressable>
              ))}
              <Pressable onPress={() => { setShowDocTypePicker(false); setPendingFile(null); }}>
                <Text style={styles.cancelText}>Cancel</Text>
              </Pressable>
            </View>
          </View>
        </Modal>
      </View>
    </AuthGate>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f8f7fc" },
  header: { padding: 16 },
  title: { fontSize: 24, fontWeight: "bold", color: "#342A4F" },
  subtitle: { fontSize: 14, color: "#6b7280", marginTop: 4 },
  uploadRow: { flexDirection: "row", gap: 12, paddingHorizontal: 16, marginBottom: 8 },
  uploadBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#7763B7",
    padding: 14,
    borderRadius: 12,
  },
  uploadBtnSecondary: { backgroundColor: "#fff", borderWidth: 2, borderColor: "#7763B7" },
  uploadBtnDisabled: { opacity: 0.6 },
  uploadBtnText: { fontSize: 15, fontWeight: "600", color: "#fff" },
  uploadBtnTextSecondary: { color: "#7763B7" },
  uploadingBar: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, marginBottom: 8 },
  uploadingText: { fontSize: 14, color: "#6b7280" },
  centered: { flex: 1, justifyContent: "center", alignItems: "center" },
  errorBox: { padding: 16, backgroundColor: "#fef2f2", margin: 16, borderRadius: 8 },
  errorText: { color: "#b91c1c" },
  empty: { flex: 1, justifyContent: "center", alignItems: "center", padding: 24 },
  emptyText: { fontSize: 18, color: "#6b7280", marginTop: 12 },
  emptySubtext: { fontSize: 14, color: "#9ca3af", marginTop: 8 },
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
  cardContent: { flex: 1, marginLeft: 12 },
  docType: { fontSize: 12, color: "#7763B7", fontWeight: "600", textTransform: "uppercase" },
  fileName: { fontSize: 16, color: "#342A4F", fontWeight: "500" },
  status: { fontSize: 12, color: "#9ca3af", marginTop: 4 },
  extractionBox: { backgroundColor: "#fff", borderRadius: 12, padding: 16, marginHorizontal: 16, marginBottom: 12, shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 2, elevation: 2 },
  extractionTitle: { fontSize: 15, fontWeight: "600", color: "#342A4F", marginBottom: 12 },
  extractionRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 6 },
  extractionType: { fontSize: 13, fontWeight: "600", color: "#7763B7" },
  extractionStatus: { flexDirection: "row", alignItems: "center", gap: 6 },
  extractionStatusText: { fontSize: 13, color: "#374151" },
  extractionMissing: { fontSize: 13, color: "#9ca3af", fontStyle: "italic" },
  extractionActions: { marginTop: 12 },
  reviewBtn: { backgroundColor: "#7763B7", padding: 12, borderRadius: 10, alignItems: "center" },
  reviewBtnText: { color: "#fff", fontSize: 14, fontWeight: "600" },
  modal: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.4)" },
  modalContent: { backgroundColor: "#fff", borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, paddingBottom: 40 },
  modalTitle: { fontSize: 20, fontWeight: "700", color: "#342A4F", marginBottom: 4 },
  modalSubtitle: { fontSize: 14, color: "#6b7280", marginBottom: 16 },
  docTypeBtn: { backgroundColor: "#f8f7fc", borderRadius: 12, padding: 16, marginBottom: 10, borderWidth: 1, borderColor: "#e5e7eb" },
  docTypeBtnLabel: { fontSize: 16, fontWeight: "600", color: "#342A4F" },
  docTypeBtnDesc: { fontSize: 13, color: "#6b7280", marginTop: 2 },
  cancelText: { textAlign: "center", color: "#6b7280", fontSize: 15, marginTop: 8 },
  viewLink: { fontSize: 14, color: "#7763B7", fontWeight: "600" },
});
