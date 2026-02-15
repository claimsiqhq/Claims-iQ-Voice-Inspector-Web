import { useLocalSearchParams, router } from "expo-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useRef, useEffect } from "react";
import {
  View, Text, StyleSheet, Pressable, ActivityIndicator,
  ScrollView, Alert, TextInput, FlatList, Modal,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import { AuthGate } from "@/components/AuthGate";
import { API_BASE, getAuthHeaders, apiRequest } from "@/lib/api";

interface Claim { id: number; claimNumber: string; insuredName: string | null; propertyAddress: string | null; status: string; }
interface Room { id: number; name: string; roomType: string | null; status: string; damageCount: number; photoCount: number; dimensions: any; }
interface Damage { id: number; roomId: number; description: string; damageType: string | null; severity: string | null; location: string | null; }
interface LineItem { id: number; roomId: number | null; description: string; category: string; action: string | null; quantity: number | null; unit: string | null; unitPrice: number | null; totalPrice: number | null; }

export default function InspectionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<"rooms" | "damages" | "scope" | "photos">("rooms");
  const [showAddRoom, setShowAddRoom] = useState(false);
  const [showAddDamage, setShowAddDamage] = useState(false);
  const [showAddLineItem, setShowAddLineItem] = useState(false);
  const [selectedRoomId, setSelectedRoomId] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);

  // Form state
  const [roomName, setRoomName] = useState("");
  const [roomType, setRoomType] = useState("");
  const [roomLength, setRoomLength] = useState("");
  const [roomWidth, setRoomWidth] = useState("");
  const [roomHeight, setRoomHeight] = useState("8");
  const [dmgDesc, setDmgDesc] = useState("");
  const [dmgType, setDmgType] = useState("");
  const [dmgSeverity, setDmgSeverity] = useState("moderate");
  const [dmgLocation, setDmgLocation] = useState("");
  const [liDesc, setLiDesc] = useState("");
  const [liCategory, setLiCategory] = useState("");
  const [liAction, setLiAction] = useState("R&R");
  const [liQty, setLiQty] = useState("1");
  const [liUnit, setLiUnit] = useState("SF");

  const { data: claim, isLoading: claimLoading } = useQuery<Claim | null>({ queryKey: [`/api/claims/${id}`], enabled: !!id });

  // Start or get session
  const sessionQuery = useQuery<{ id: number; status: string; currentPhase: number } | null>({
    queryKey: [`/api/claims/${id}/inspection/active`],
    enabled: !!id,
    retry: false,
  });
  const session = sessionQuery.data;

  const startSessionMut = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/claims/${id}/inspection/start`);
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [`/api/claims/${id}/inspection/active`] }),
    onError: (e) => Alert.alert("Error", String(e)),
  });

  const roomsQuery = useQuery<Room[]>({
    queryKey: [`/api/inspection/${session?.id}/rooms`],
    enabled: !!session?.id,
  });
  const rooms = roomsQuery.data || [];

  const damagesQuery = useQuery<Damage[]>({
    queryKey: [`/api/inspection/${session?.id}/damages`],
    enabled: !!session?.id,
  });
  const damages = damagesQuery.data || [];

  const lineItemsQuery = useQuery<LineItem[]>({
    queryKey: [`/api/inspection/${session?.id}/line-items`],
    enabled: !!session?.id,
  });
  const lineItems = lineItemsQuery.data || [];

  const addRoomMut = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/inspection/${session!.id}/rooms`, {
        name: roomName, roomType: roomType || "interior",
        dimensions: { length: parseFloat(roomLength) || 12, width: parseFloat(roomWidth) || 10, height: parseFloat(roomHeight) || 8 },
      });
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [`/api/inspection/${session?.id}/rooms`] });
      setShowAddRoom(false); setRoomName(""); setRoomType(""); setRoomLength(""); setRoomWidth("");
    },
    onError: (e) => Alert.alert("Error", String(e)),
  });

  const addDamageMut = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/inspection/${session!.id}/rooms/${selectedRoomId}/damages`, {
        description: dmgDesc, damageType: dmgType || "general",
        severity: dmgSeverity, location: dmgLocation,
      });
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [`/api/inspection/${session?.id}/damages`] });
      qc.invalidateQueries({ queryKey: [`/api/inspection/${session?.id}/rooms`] });
      setShowAddDamage(false); setDmgDesc(""); setDmgType(""); setDmgLocation("");
    },
    onError: (e) => Alert.alert("Error", String(e)),
  });

  const addLineItemMut = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/inspection/${session!.id}/line-items`, {
        roomId: selectedRoomId, description: liDesc, category: liCategory || "General",
        action: liAction, quantity: parseFloat(liQty) || 1, unit: liUnit,
      });
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [`/api/inspection/${session?.id}/line-items`] });
      setShowAddLineItem(false); setLiDesc(""); setLiCategory(""); setLiQty("1");
    },
    onError: (e) => Alert.alert("Error", String(e)),
  });

  async function takePhoto(roomId: number) {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== "granted") { Alert.alert("Permission needed"); return; }
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.8, base64: true });
    if (result.canceled || !result.assets[0].base64) return;
    setUploading(true);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API_BASE}/api/photolab/upload`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ imageData: `data:image/jpeg;base64,${result.assets[0].base64}`, fileName: `inspection_${Date.now()}.jpg` }),
      });
      if (res.ok) {
        const photo = await res.json();
        await fetch(`${API_BASE}/api/photolab/photos/${photo.id}/attach`, {
          method: "PATCH",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({ claimId: parseInt(String(id)) }),
        });
        qc.invalidateQueries({ queryKey: [`/api/inspection/${session?.id}/rooms`] });
      }
    } catch {}
    setUploading(false);
  }

  if (claimLoading) return <View style={s.centered}><ActivityIndicator size="large" color="#7763B7" /></View>;

  return (
    <AuthGate>
      <View style={s.container}>
        {/* Header */}
        <View style={s.header}>
          <View style={s.headerLeft}>
            <Text style={s.title}>{claim?.claimNumber || "Inspection"}</Text>
            {claim?.insuredName && <Text style={s.subtitle}>{claim.insuredName}</Text>}
          </View>
          {session && <View style={s.sessionBadge}><Text style={s.sessionBadgeText}>Session #{session.id}</Text></View>}
        </View>

        {/* No session: start */}
        {!session && !sessionQuery.isLoading && (
          <View style={s.startContainer}>
            <Text style={s.startTitle}>Ready to inspect</Text>
            <Text style={s.startHint}>Start a new inspection session to add rooms, document damages, capture photos, and build your scope.</Text>
            <Pressable style={s.startBtn} onPress={() => startSessionMut.mutate()}>
              <Text style={s.startBtnText}>Start inspection</Text>
            </Pressable>
          </View>
        )}

        {/* Session active */}
        {session && (
          <>
            {/* Tabs */}
            <View style={s.tabs}>
              {(["rooms", "damages", "scope", "photos"] as const).map((tab) => (
                <Pressable key={tab} style={[s.tab, activeTab === tab && s.tabActive]} onPress={() => setActiveTab(tab)}>
                  <Text style={[s.tabText, activeTab === tab && s.tabTextActive]}>
                    {tab === "rooms" ? `Rooms (${rooms.length})` : tab === "damages" ? `Damages (${damages.length})` : tab === "scope" ? `Scope (${lineItems.length})` : "Photos"}
                  </Text>
                </Pressable>
              ))}
            </View>

            {/* Rooms tab */}
            {activeTab === "rooms" && (
              <ScrollView style={s.content} contentContainerStyle={s.contentInner}>
                {rooms.map((room) => (
                  <View key={room.id} style={s.card}>
                    <View style={s.cardHeader}>
                      <Text style={s.cardTitle}>{room.name}</Text>
                      <Text style={s.cardBadge}>{room.status}</Text>
                    </View>
                    {room.dimensions && <Text style={s.cardMeta}>{room.dimensions.length}' x {room.dimensions.width}' x {room.dimensions.height}'</Text>}
                    <Text style={s.cardMeta}>{room.damageCount} damages • {room.photoCount} photos</Text>
                    <View style={s.cardActions}>
                      <Pressable style={s.smallBtn} onPress={() => { setSelectedRoomId(room.id); setShowAddDamage(true); }}>
                        <Text style={s.smallBtnText}>+ Damage</Text>
                      </Pressable>
                      <Pressable style={s.smallBtn} onPress={() => { setSelectedRoomId(room.id); setShowAddLineItem(true); }}>
                        <Text style={s.smallBtnText}>+ Line item</Text>
                      </Pressable>
                      <Pressable style={[s.smallBtn, s.smallBtnOutline]} onPress={() => takePhoto(room.id)}>
                        <Text style={[s.smallBtnText, s.smallBtnTextOutline]}>📷 Photo</Text>
                      </Pressable>
                    </View>
                  </View>
                ))}
                <Pressable style={s.addBtn} onPress={() => setShowAddRoom(true)}>
                  <Text style={s.addBtnText}>+ Add room</Text>
                </Pressable>
              </ScrollView>
            )}

            {/* Damages tab */}
            {activeTab === "damages" && (
              <ScrollView style={s.content} contentContainerStyle={s.contentInner}>
                {damages.length === 0 && <Text style={s.emptyText}>No damages recorded. Add rooms first, then add damages.</Text>}
                {damages.map((dmg) => {
                  const room = rooms.find((r) => r.id === dmg.roomId);
                  return (
                    <View key={dmg.id} style={s.card}>
                      <Text style={s.cardTitle}>{dmg.description}</Text>
                      <Text style={s.cardMeta}>{room?.name || "Unknown room"} • {dmg.damageType} • {dmg.severity}</Text>
                      {dmg.location && <Text style={s.cardMeta}>Location: {dmg.location}</Text>}
                    </View>
                  );
                })}
              </ScrollView>
            )}

            {/* Scope tab */}
            {activeTab === "scope" && (
              <ScrollView style={s.content} contentContainerStyle={s.contentInner}>
                {lineItems.length === 0 && <Text style={s.emptyText}>No line items yet. Add from the Rooms tab.</Text>}
                {lineItems.map((li) => {
                  const room = rooms.find((r) => r.id === li.roomId);
                  return (
                    <View key={li.id} style={s.card}>
                      <Text style={s.cardTitle}>{li.description}</Text>
                      <Text style={s.cardMeta}>{room?.name || ""} • {li.category} • {li.action}</Text>
                      <Text style={s.cardMeta}>{li.quantity} {li.unit} @ ${li.unitPrice?.toFixed(2) || "0.00"} = ${li.totalPrice?.toFixed(2) || "0.00"}</Text>
                    </View>
                  );
                })}
                {lineItems.length > 0 && (
                  <View style={s.totalCard}>
                    <Text style={s.totalLabel}>Total estimate</Text>
                    <Text style={s.totalValue}>${lineItems.reduce((sum, li) => sum + (li.totalPrice || 0), 0).toFixed(2)}</Text>
                  </View>
                )}
              </ScrollView>
            )}

            {/* Photos tab */}
            {activeTab === "photos" && (
              <ScrollView style={s.content} contentContainerStyle={s.contentInner}>
                <Text style={s.emptyText}>Capture photos from the Rooms tab. All inspection photos will appear here.</Text>
                {rooms.filter(r => r.photoCount > 0).map(r => (
                  <View key={r.id} style={s.card}>
                    <Text style={s.cardTitle}>{r.name}</Text>
                    <Text style={s.cardMeta}>{r.photoCount} photos captured</Text>
                  </View>
                ))}
                {uploading && <ActivityIndicator size="small" color="#7763B7" />}
              </ScrollView>
            )}

            {/* Bottom actions */}
            <View style={s.bottomBar}>
              <Pressable style={s.bottomBtn} onPress={() => router.push({ pathname: "/documents/[claimId]", params: { claimId: String(id) } })}>
                <Text style={s.bottomBtnText}>Documents</Text>
              </Pressable>
              <Pressable style={[s.bottomBtn, s.bottomBtnPrimary]} onPress={() => router.push({ pathname: "/inspection/[id]/review", params: { id: String(id) } })}>
                <Text style={[s.bottomBtnText, s.bottomBtnTextPrimary]}>Review & export</Text>
              </Pressable>
            </View>
          </>
        )}

        {/* Add room modal */}
        <Modal visible={showAddRoom} transparent animationType="slide">
          <View style={s.modal}><View style={s.modalContent}>
            <Text style={s.modalTitle}>Add room</Text>
            <TextInput style={s.input} placeholder="Room name (e.g. Kitchen)" value={roomName} onChangeText={setRoomName} />
            <TextInput style={s.input} placeholder="Type (interior, exterior_roof...)" value={roomType} onChangeText={setRoomType} />
            <View style={s.row}>
              <TextInput style={[s.input, s.flex1]} placeholder="Length (ft)" value={roomLength} onChangeText={setRoomLength} keyboardType="numeric" />
              <TextInput style={[s.input, s.flex1]} placeholder="Width (ft)" value={roomWidth} onChangeText={setRoomWidth} keyboardType="numeric" />
              <TextInput style={[s.input, s.flex1]} placeholder="Height" value={roomHeight} onChangeText={setRoomHeight} keyboardType="numeric" />
            </View>
            <Pressable style={s.modalBtn} onPress={() => addRoomMut.mutate()} disabled={!roomName}>
              <Text style={s.modalBtnText}>Add</Text>
            </Pressable>
            <Pressable onPress={() => setShowAddRoom(false)}><Text style={s.cancelText}>Cancel</Text></Pressable>
          </View></View>
        </Modal>

        {/* Add damage modal */}
        <Modal visible={showAddDamage} transparent animationType="slide">
          <View style={s.modal}><View style={s.modalContent}>
            <Text style={s.modalTitle}>Add damage</Text>
            <TextInput style={s.input} placeholder="Description" value={dmgDesc} onChangeText={setDmgDesc} />
            <TextInput style={s.input} placeholder="Type (hail_impact, water_stain...)" value={dmgType} onChangeText={setDmgType} />
            <TextInput style={s.input} placeholder="Location (NE corner, ceiling...)" value={dmgLocation} onChangeText={setDmgLocation} />
            <View style={s.row}>
              {["minor", "moderate", "severe"].map((sev) => (
                <Pressable key={sev} style={[s.sevBtn, dmgSeverity === sev && s.sevBtnActive]} onPress={() => setDmgSeverity(sev)}>
                  <Text style={[s.sevBtnText, dmgSeverity === sev && s.sevBtnTextActive]}>{sev}</Text>
                </Pressable>
              ))}
            </View>
            <Pressable style={s.modalBtn} onPress={() => addDamageMut.mutate()} disabled={!dmgDesc}>
              <Text style={s.modalBtnText}>Add</Text>
            </Pressable>
            <Pressable onPress={() => setShowAddDamage(false)}><Text style={s.cancelText}>Cancel</Text></Pressable>
          </View></View>
        </Modal>

        {/* Add line item modal */}
        <Modal visible={showAddLineItem} transparent animationType="slide">
          <View style={s.modal}><View style={s.modalContent}>
            <Text style={s.modalTitle}>Add line item</Text>
            <TextInput style={s.input} placeholder="Description" value={liDesc} onChangeText={setLiDesc} />
            <TextInput style={s.input} placeholder="Category (Roofing, Drywall...)" value={liCategory} onChangeText={setLiCategory} />
            <View style={s.row}>
              {["R&R", "Repair", "Paint", "Tear Off"].map((a) => (
                <Pressable key={a} style={[s.sevBtn, liAction === a && s.sevBtnActive]} onPress={() => setLiAction(a)}>
                  <Text style={[s.sevBtnText, liAction === a && s.sevBtnTextActive]}>{a}</Text>
                </Pressable>
              ))}
            </View>
            <View style={s.row}>
              <TextInput style={[s.input, s.flex1]} placeholder="Qty" value={liQty} onChangeText={setLiQty} keyboardType="numeric" />
              <TextInput style={[s.input, s.flex1]} placeholder="Unit" value={liUnit} onChangeText={setLiUnit} />
            </View>
            <Pressable style={s.modalBtn} onPress={() => addLineItemMut.mutate()} disabled={!liDesc}>
              <Text style={s.modalBtnText}>Add</Text>
            </Pressable>
            <Pressable onPress={() => setShowAddLineItem(false)}><Text style={s.cancelText}>Cancel</Text></Pressable>
          </View></View>
        </Modal>
      </View>
    </AuthGate>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f8f7fc" },
  centered: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#f8f7fc" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16, paddingBottom: 8 },
  headerLeft: { flex: 1 },
  title: { fontSize: 20, fontWeight: "bold", color: "#342A4F" },
  subtitle: { fontSize: 13, color: "#6b7280", marginTop: 2 },
  sessionBadge: { backgroundColor: "#7763B7", paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  sessionBadgeText: { color: "#fff", fontSize: 12, fontWeight: "600" },
  startContainer: { flex: 1, justifyContent: "center", alignItems: "center", padding: 32 },
  startTitle: { fontSize: 22, fontWeight: "700", color: "#342A4F" },
  startHint: { fontSize: 15, color: "#6b7280", textAlign: "center", marginTop: 12, lineHeight: 22 },
  startBtn: { marginTop: 24, backgroundColor: "#7763B7", paddingHorizontal: 32, paddingVertical: 16, borderRadius: 12 },
  startBtnText: { color: "#fff", fontSize: 18, fontWeight: "600" },
  tabs: { flexDirection: "row", paddingHorizontal: 12, gap: 4 },
  tab: { flex: 1, paddingVertical: 10, alignItems: "center", borderBottomWidth: 2, borderBottomColor: "transparent" },
  tabActive: { borderBottomColor: "#7763B7" },
  tabText: { fontSize: 13, fontWeight: "500", color: "#6b7280" },
  tabTextActive: { color: "#7763B7", fontWeight: "600" },
  content: { flex: 1 },
  contentInner: { padding: 16, paddingBottom: 120 },
  card: { backgroundColor: "#fff", borderRadius: 12, padding: 14, marginBottom: 12, shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 2, elevation: 2 },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  cardTitle: { fontSize: 15, fontWeight: "600", color: "#342A4F" },
  cardBadge: { fontSize: 11, color: "#7763B7", fontWeight: "600", textTransform: "uppercase" },
  cardMeta: { fontSize: 13, color: "#6b7280", marginTop: 4 },
  cardActions: { flexDirection: "row", gap: 8, marginTop: 10 },
  smallBtn: { backgroundColor: "#7763B7", paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  smallBtnOutline: { backgroundColor: "#fff", borderWidth: 1.5, borderColor: "#7763B7" },
  smallBtnText: { fontSize: 12, fontWeight: "600", color: "#fff" },
  smallBtnTextOutline: { color: "#7763B7" },
  addBtn: { borderWidth: 2, borderColor: "#7763B7", borderStyle: "dashed", borderRadius: 12, padding: 16, alignItems: "center" },
  addBtnText: { fontSize: 15, fontWeight: "600", color: "#7763B7" },
  emptyText: { fontSize: 14, color: "#9ca3af", textAlign: "center", padding: 24 },
  totalCard: { backgroundColor: "#342A4F", borderRadius: 12, padding: 16, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  totalLabel: { fontSize: 16, fontWeight: "600", color: "#fff" },
  totalValue: { fontSize: 22, fontWeight: "700", color: "#C6A54E" },
  bottomBar: { flexDirection: "row", gap: 12, padding: 16, backgroundColor: "#fff", borderTopWidth: 1, borderTopColor: "#e5e7eb" },
  bottomBtn: { flex: 1, paddingVertical: 14, alignItems: "center", borderRadius: 10, borderWidth: 2, borderColor: "#7763B7" },
  bottomBtnPrimary: { backgroundColor: "#7763B7", borderColor: "#7763B7" },
  bottomBtnText: { fontSize: 15, fontWeight: "600", color: "#7763B7" },
  bottomBtnTextPrimary: { color: "#fff" },
  modal: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.4)" },
  modalContent: { backgroundColor: "#fff", borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, paddingBottom: 40 },
  modalTitle: { fontSize: 20, fontWeight: "700", color: "#342A4F", marginBottom: 16 },
  input: { borderWidth: 1, borderColor: "#d1d5db", borderRadius: 10, padding: 14, fontSize: 15, marginBottom: 12, color: "#374151" },
  row: { flexDirection: "row", gap: 8, marginBottom: 12 },
  flex1: { flex: 1 },
  modalBtn: { backgroundColor: "#7763B7", paddingVertical: 14, borderRadius: 12, alignItems: "center", marginBottom: 12 },
  modalBtnText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  cancelText: { textAlign: "center", color: "#6b7280", fontSize: 15 },
  sevBtn: { flex: 1, paddingVertical: 10, alignItems: "center", borderRadius: 8, borderWidth: 1.5, borderColor: "#d1d5db" },
  sevBtnActive: { borderColor: "#7763B7", backgroundColor: "#f3f0ff" },
  sevBtnText: { fontSize: 13, fontWeight: "500", color: "#6b7280" },
  sevBtnTextActive: { color: "#7763B7" },
});
