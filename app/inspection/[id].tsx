import { useLocalSearchParams, router } from "expo-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useRef, useCallback } from "react";
import {
  View, Text, StyleSheet, Pressable, ActivityIndicator,
  ScrollView, Alert, TextInput, FlatList, Modal, Platform,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import { AuthGate } from "@/components/AuthGate";
import { API_BASE, getAuthHeaders, apiRequest } from "@/lib/api";
import type { VoiceState, TranscriptEntry } from "@/lib/voiceSession";
import SketchEditor from "@/components/SketchEditor";

interface Claim { id: number; claimNumber: string; insuredName: string | null; propertyAddress: string | null; status: string; }
interface Room { id: number; name: string; roomType: string | null; status: string; damageCount: number; photoCount: number; dimensions: any; }
interface Damage { id: number; roomId: number; description: string; damageType: string | null; severity: string | null; location: string | null; }
interface LineItem { id: number; roomId: number | null; description: string; category: string; action: string | null; quantity: number | null; unit: string | null; unitPrice: number | null; totalPrice: number | null; }

const VOICE_COLORS: Record<VoiceState, string> = {
  idle: "#6b7280", connecting: "#d97706", listening: "#16a34a",
  processing: "#2563eb", speaking: "#7763B7", error: "#dc2626",
};
const VOICE_LABELS: Record<VoiceState, string> = {
  idle: "Tap mic to start", connecting: "Connecting...", listening: "Listening...",
  processing: "Thinking...", speaking: "Speaking...", error: "Error — tap to retry",
};

export default function InspectionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<"voice" | "rooms" | "sketch" | "scope">("voice");
  const [showAddRoom, setShowAddRoom] = useState(false);
  const [showAddDamage, setShowAddDamage] = useState(false);
  const [showAddLineItem, setShowAddLineItem] = useState(false);
  const [selectedRoomId, setSelectedRoomId] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);

  // Voice state
  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const voiceSessionRef = useRef<any>(null);
  const transcriptScrollRef = useRef<ScrollView>(null);

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

  const sessionQuery = useQuery<{ id: number; status: string; currentPhase: number } | null>({
    queryKey: [`/api/claims/${id}/inspection/active`], enabled: !!id, retry: false,
  });
  const session = sessionQuery.data;

  const startSessionMut = useMutation({
    mutationFn: async () => { const res = await apiRequest("POST", `/api/claims/${id}/inspection/start`); return res.json(); },
    onSuccess: () => qc.invalidateQueries({ queryKey: [`/api/claims/${id}/inspection/active`] }),
    onError: (e) => Alert.alert("Error", String(e)),
  });

  const roomsQuery = useQuery<Room[]>({ queryKey: [`/api/inspection/${session?.id}/rooms`], enabled: !!session?.id });
  const rooms = roomsQuery.data || [];
  const damagesQuery = useQuery<Damage[]>({ queryKey: [`/api/inspection/${session?.id}/damages`], enabled: !!session?.id });
  const damages = damagesQuery.data || [];
  const lineItemsQuery = useQuery<LineItem[]>({ queryKey: [`/api/inspection/${session?.id}/line-items`], enabled: !!session?.id });
  const lineItems = lineItemsQuery.data || [];

  const invalidateAll = useCallback(() => {
    qc.invalidateQueries({ queryKey: [`/api/inspection/${session?.id}/rooms`] });
    qc.invalidateQueries({ queryKey: [`/api/inspection/${session?.id}/damages`] });
    qc.invalidateQueries({ queryKey: [`/api/inspection/${session?.id}/line-items`] });
  }, [qc, session?.id]);

  // Voice: handle tool calls from the AI
  const handleToolCall = useCallback(async (name: string, args: any): Promise<any> => {
    if (!session) return { error: "No session" };
    const headers = await getAuthHeaders();
    const post = async (path: string, body: any) => {
      const res = await fetch(`${API_BASE}${path}`, { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify(body) });
      return res.json();
    };
    const patch = async (path: string, body: any) => {
      const res = await fetch(`${API_BASE}${path}`, { method: "PATCH", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify(body) });
      return res.json();
    };

    switch (name) {
      case "set_inspection_context":
        return { success: true, context: args };
      case "create_room": {
        const room = await post(`/api/inspection/${session.id}/rooms`, {
          name: args.name, roomType: args.roomType || "interior",
          structure: args.structure || "Main Dwelling",
          dimensions: { length: args.length || 12, width: args.width || 10, height: args.height || 8 },
          phase: args.phase,
        });
        invalidateAll();
        return { success: true, roomId: room.id, name: room.name };
      }
      case "add_damage": {
        const currentRoom = rooms[rooms.length - 1];
        if (!currentRoom) return { error: "No room — create a room first" };
        const dmg = await post(`/api/inspection/${session.id}/rooms/${currentRoom.id}/damages`, {
          description: args.description, damageType: args.damageType,
          severity: args.severity, location: args.location,
        });
        invalidateAll();
        return { success: true, damageId: dmg.id };
      }
      case "add_line_item": {
        const currentRoom = rooms[rooms.length - 1];
        const li = await post(`/api/inspection/${session.id}/line-items`, {
          roomId: currentRoom?.id, description: args.description,
          category: args.category || "General", action: args.action || "R&R",
          quantity: args.quantity || 1, unit: args.unit || "EA",
          unitPrice: args.unitPrice || 0,
        });
        invalidateAll();
        return { success: true, lineItemId: li.id, totalPrice: li.totalPrice };
      }
      case "trigger_photo_capture":
        // Trigger camera
        takePhotoForRoom(rooms[rooms.length - 1]?.id || 0);
        return { success: true, label: args.label };
      case "log_moisture_reading":
        return { success: true, reading: args.reading, location: args.location };
      case "complete_room": {
        const rm = rooms.find((r) => r.name.toLowerCase().includes((args.roomName || "").toLowerCase()));
        if (rm) {
          await patch(`/api/inspection/${session.id}/rooms/${rm.id}`, { status: "complete" });
          invalidateAll();
        }
        return { success: true, roomName: args.roomName };
      }
      case "get_estimate_summary": {
        const total = lineItems.reduce((s, li) => s + (li.totalPrice || 0), 0);
        return { totalRCV: total, itemCount: lineItems.length, roomCount: rooms.length };
      }
      case "add_opening":
        return { success: true, openingType: args.openingType, wall: args.wallDirection };
      case "set_room_adjacency":
        return { success: true, roomA: args.roomNameA, roomB: args.roomNameB };
      case "update_room_dimensions": {
        const rm = rooms.find((r) => r.name.toLowerCase().includes((args.roomName || "").toLowerCase()));
        if (rm) {
          await patch(`/api/inspection/${session.id}/rooms/${rm.id}`, {
            dimensions: {
              length: args.length || rm.dimensions?.length || 12,
              width: args.width || rm.dimensions?.width || 10,
              height: args.height || rm.dimensions?.height || 8,
              ceilingType: args.ceilingType,
            },
          });
          invalidateAll();
        }
        return { success: true, roomName: args.roomName };
      }
      case "complete_inspection":
        return { success: true, notes: args.notes };
      default:
        return { error: `Unknown tool: ${name}` };
    }
  }, [session, rooms, lineItems, invalidateAll]);

  // Start/stop voice
  async function toggleVoice() {
    if (voiceSessionRef.current?.active) {
      voiceSessionRef.current.stop();
      voiceSessionRef.current = null;
      setVoiceState("idle");
      return;
    }
    if (!session) { Alert.alert("Start inspection first"); return; }

    try {
      const { VoiceSession } = await import("@/lib/voiceSession");
      const vs = new VoiceSession({
        onVoiceStateChange: setVoiceState,
        onTranscript: (entry) => {
          setTranscript((prev) => [...prev, entry]);
          setTimeout(() => transcriptScrollRef.current?.scrollToEnd({ animated: true }), 100);
        },
        onToolCall: handleToolCall,
        onError: (err) => Alert.alert("Voice error", err),
        onPhotoRequested: (label, _photoType) => {
          // Auto-trigger camera when AI asks for a photo
          const currentRoom = rooms[rooms.length - 1];
          if (currentRoom) takePhotoForRoom(currentRoom.id);
          setTranscript((prev) => [...prev, { speaker: "agent", text: `📷 Photo requested: ${label}`, timestamp: Date.now() }]);
        },
      });
      voiceSessionRef.current = vs;
      await vs.start(parseInt(String(id)), session.id);
    } catch (err: any) {
      Alert.alert("Voice error", err.message || "Failed to start voice");
    }
  }

  // Manual mutations
  const addRoomMut = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/inspection/${session!.id}/rooms`, {
        name: roomName, roomType: roomType || "interior",
        dimensions: { length: parseFloat(roomLength) || 12, width: parseFloat(roomWidth) || 10, height: parseFloat(roomHeight) || 8 },
      });
      return res.json();
    },
    onSuccess: () => { invalidateAll(); setShowAddRoom(false); setRoomName(""); setRoomType(""); setRoomLength(""); setRoomWidth(""); },
  });

  const addDamageMut = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/inspection/${session!.id}/rooms/${selectedRoomId}/damages`, {
        description: dmgDesc, damageType: dmgType || "general", severity: dmgSeverity, location: dmgLocation,
      });
      return res.json();
    },
    onSuccess: () => { invalidateAll(); setShowAddDamage(false); setDmgDesc(""); },
  });

  const addLineItemMut = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/inspection/${session!.id}/line-items`, {
        roomId: selectedRoomId, description: liDesc, category: liCategory || "General",
        action: liAction, quantity: parseFloat(liQty) || 1, unit: liUnit,
      });
      return res.json();
    },
    onSuccess: () => { invalidateAll(); setShowAddLineItem(false); setLiDesc(""); },
  });

  async function takePhotoForRoom(roomId: number) {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== "granted") return;
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.8, base64: true });
    if (result.canceled || !result.assets[0].base64) return;
    setUploading(true);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API_BASE}/api/photolab/upload`, {
        method: "POST", headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ imageData: `data:image/jpeg;base64,${result.assets[0].base64}`, fileName: `inspection_${Date.now()}.jpg` }),
      });
      if (res.ok) {
        const photo = await res.json();
        await fetch(`${API_BASE}/api/photolab/photos/${photo.id}/attach`, {
          method: "PATCH", headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({ claimId: parseInt(String(id)) }),
        });
        invalidateAll();
      }
    } catch {}
    setUploading(false);
  }

  if (claimLoading) return <View style={s.centered}><ActivityIndicator size="large" color="#7763B7" /></View>;

  const totalEstimate = lineItems.reduce((sum, li) => sum + (li.totalPrice || 0), 0);

  return (
    <AuthGate>
      <View style={s.container}>
        {/* Header */}
        <View style={s.header}>
          <View style={s.headerLeft}>
            <Text style={s.title}>{claim?.claimNumber || "Inspection"}</Text>
            {claim?.insuredName && <Text style={s.sub}>{claim.insuredName}</Text>}
          </View>
          {session && <View style={s.sessionBadge}><Text style={s.sessionBadgeText}>Session #{session.id}</Text></View>}
        </View>

        {/* No session */}
        {!session && !sessionQuery.isLoading && (
          <View style={s.startBox}>
            <Text style={s.startTitle}>Ready to inspect</Text>
            <Text style={s.startHint}>Start an inspection to add rooms, document damages, capture photos, and build your scope — by voice or manually.</Text>
            <Pressable style={s.startBtn} onPress={() => startSessionMut.mutate()}>
              <Text style={s.startBtnText}>Start inspection</Text>
            </Pressable>
          </View>
        )}

        {/* Active session */}
        {session && (
          <>
            {/* Tabs */}
            <View style={s.tabs}>
              {(["voice", "rooms", "sketch", "scope"] as const).map((tab) => (
                <Pressable key={tab} style={[s.tab, activeTab === tab && s.tabActive]} onPress={() => setActiveTab(tab)}>
                  <Text style={[s.tabText, activeTab === tab && s.tabTextActive]}>
                    {tab === "voice" ? "🎙 Voice" : tab === "rooms" ? `Rooms (${rooms.length})` : tab === "sketch" ? "✏️ Sketch" : `Scope (${lineItems.length})`}
                  </Text>
                </Pressable>
              ))}
            </View>

            {/* Voice tab */}
            {activeTab === "voice" && (
              <View style={s.voiceContainer}>
                {/* Voice button */}
                <Pressable style={[s.micBtn, { backgroundColor: VOICE_COLORS[voiceState] }]} onPress={toggleVoice}>
                  <Text style={s.micIcon}>{voiceState === "idle" || voiceState === "error" ? "🎙" : voiceState === "connecting" ? "⏳" : voiceState === "listening" ? "👂" : voiceState === "processing" ? "🧠" : "🔊"}</Text>
                </Pressable>
                <Text style={[s.voiceLabel, { color: VOICE_COLORS[voiceState] }]}>{VOICE_LABELS[voiceState]}</Text>

                {/* Quick stats */}
                <View style={s.statsRow}>
                  <View style={s.stat}><Text style={s.statNum}>{rooms.length}</Text><Text style={s.statLabel}>Rooms</Text></View>
                  <View style={s.stat}><Text style={s.statNum}>{damages.length}</Text><Text style={s.statLabel}>Damages</Text></View>
                  <View style={s.stat}><Text style={s.statNum}>{lineItems.length}</Text><Text style={s.statLabel}>Items</Text></View>
                  <View style={s.stat}><Text style={[s.statNum, { color: "#C6A54E" }]}>${totalEstimate.toFixed(0)}</Text><Text style={s.statLabel}>Estimate</Text></View>
                </View>

                {/* Transcript */}
                <ScrollView ref={transcriptScrollRef} style={s.transcriptBox} contentContainerStyle={s.transcriptContent}>
                  {transcript.length === 0 && <Text style={s.transcriptEmpty}>Voice transcript will appear here. {Platform.OS !== "web" ? "Voice uses WebRTC (web only). Use Rooms/Scope tabs for manual entry." : "Tap the mic to begin."}</Text>}
                  {transcript.map((entry, i) => (
                    <View key={i} style={[s.transcriptEntry, entry.speaker === "agent" && s.transcriptAgent]}>
                      <Text style={s.transcriptSpeaker}>{entry.speaker === "user" ? "You" : "Inspector"}</Text>
                      <Text style={s.transcriptText}>{entry.text}</Text>
                    </View>
                  ))}
                </ScrollView>
              </View>
            )}

            {/* Rooms tab */}
            {activeTab === "rooms" && (
              <ScrollView style={s.content} contentContainerStyle={s.contentInner}>
                {rooms.map((room) => (
                  <View key={room.id} style={s.card}>
                    <View style={s.cardHeader}><Text style={s.cardTitle}>{room.name}</Text><Text style={s.cardBadge}>{room.status}</Text></View>
                    {room.dimensions && <Text style={s.cardMeta}>{room.dimensions.length}' x {room.dimensions.width}' x {room.dimensions.height}'</Text>}
                    <Text style={s.cardMeta}>{room.damageCount} damages • {room.photoCount} photos</Text>
                    <View style={s.cardActions}>
                      <Pressable style={s.smallBtn} onPress={() => { setSelectedRoomId(room.id); setShowAddDamage(true); }}><Text style={s.smallBtnText}>+ Damage</Text></Pressable>
                      <Pressable style={s.smallBtn} onPress={() => { setSelectedRoomId(room.id); setShowAddLineItem(true); }}><Text style={s.smallBtnText}>+ Item</Text></Pressable>
                      <Pressable style={[s.smallBtn, s.smallBtnO]} onPress={() => takePhotoForRoom(room.id)}><Text style={[s.smallBtnText, s.smallBtnTextO]}>📷</Text></Pressable>
                    </View>
                  </View>
                ))}
                <Pressable style={s.addBtn} onPress={() => setShowAddRoom(true)}><Text style={s.addBtnText}>+ Add room</Text></Pressable>
              </ScrollView>
            )}

            {/* Sketch tab */}
            {activeTab === "sketch" && (
              <ScrollView style={s.content} contentContainerStyle={s.contentInner}>
                <SketchEditor
                  rooms={rooms.map((r) => ({ id: r.id, name: r.name, dimensions: r.dimensions || { length: 12, width: 10 } }))}
                  openings={[]}
                  adjacencies={[]}
                  selectedRoomId={selectedRoomId}
                  onSelectRoom={(id) => setSelectedRoomId(id)}
                  onAddRoom={(name, length, width, height) => {
                    apiRequest("POST", `/api/inspection/${session!.id}/rooms`, {
                      name, roomType: "interior", dimensions: { length, width, height },
                    }).then(() => invalidateAll());
                  }}
                  onMoveRoom={() => {}}
                  onAddOpening={() => {}}
                  onAddAdjacency={() => {}}
                />
              </ScrollView>
            )}

            {/* Scope tab */}
            {activeTab === "scope" && (
              <ScrollView style={s.content} contentContainerStyle={s.contentInner}>
                {lineItems.length === 0 && <Text style={s.emptyText}>No line items yet.</Text>}
                {lineItems.map((li) => {
                  const room = rooms.find((r) => r.id === li.roomId);
                  return (
                    <View key={li.id} style={s.card}>
                      <Text style={s.cardTitle}>{li.description}</Text>
                      <Text style={s.cardMeta}>{room?.name || ""} • {li.category} • {li.action}</Text>
                      <Text style={s.cardMeta}>{li.quantity} {li.unit} @ ${(li.unitPrice || 0).toFixed(2)} = ${(li.totalPrice || 0).toFixed(2)}</Text>
                    </View>
                  );
                })}
                {lineItems.length > 0 && (
                  <View style={s.totalCard}><Text style={s.totalLabel}>Total</Text><Text style={s.totalValue}>${totalEstimate.toFixed(2)}</Text></View>
                )}
              </ScrollView>
            )}

            {/* Bottom bar */}
            <View style={s.bottomBar}>
              <Pressable style={s.bottomBtn} onPress={() => router.push({ pathname: "/documents/[claimId]", params: { claimId: String(id) } })}>
                <Text style={s.bottomBtnText}>Docs</Text>
              </Pressable>
              <Pressable style={[s.bottomBtn, s.bottomBtnP]} onPress={() => router.push({ pathname: "/inspection/[id]/review", params: { id: String(id) } })}>
                <Text style={[s.bottomBtnText, s.bottomBtnTextP]}>Review & export</Text>
              </Pressable>
            </View>
          </>
        )}

        {/* Modals */}
        <Modal visible={showAddRoom} transparent animationType="slide">
          <View style={s.modal}><View style={s.modalC}>
            <Text style={s.modalT}>Add room</Text>
            <TextInput style={s.input} placeholder="Room name" value={roomName} onChangeText={setRoomName} />
            <TextInput style={s.input} placeholder="Type (interior, exterior_roof...)" value={roomType} onChangeText={setRoomType} />
            <View style={s.row}>
              <TextInput style={[s.input, s.f1]} placeholder="Length" value={roomLength} onChangeText={setRoomLength} keyboardType="numeric" />
              <TextInput style={[s.input, s.f1]} placeholder="Width" value={roomWidth} onChangeText={setRoomWidth} keyboardType="numeric" />
              <TextInput style={[s.input, s.f1]} placeholder="Height" value={roomHeight} onChangeText={setRoomHeight} keyboardType="numeric" />
            </View>
            <Pressable style={s.modalBtn} onPress={() => addRoomMut.mutate()} disabled={!roomName}><Text style={s.modalBtnT}>Add</Text></Pressable>
            <Pressable onPress={() => setShowAddRoom(false)}><Text style={s.cancel}>Cancel</Text></Pressable>
          </View></View>
        </Modal>
        <Modal visible={showAddDamage} transparent animationType="slide">
          <View style={s.modal}><View style={s.modalC}>
            <Text style={s.modalT}>Add damage</Text>
            <TextInput style={s.input} placeholder="Description" value={dmgDesc} onChangeText={setDmgDesc} />
            <TextInput style={s.input} placeholder="Type (hail_impact, water_stain...)" value={dmgType} onChangeText={setDmgType} />
            <TextInput style={s.input} placeholder="Location" value={dmgLocation} onChangeText={setDmgLocation} />
            <View style={s.row}>
              {["minor", "moderate", "severe"].map((sev) => (
                <Pressable key={sev} style={[s.sevBtn, dmgSeverity === sev && s.sevA]} onPress={() => setDmgSeverity(sev)}><Text style={[s.sevT, dmgSeverity === sev && s.sevTA]}>{sev}</Text></Pressable>
              ))}
            </View>
            <Pressable style={s.modalBtn} onPress={() => addDamageMut.mutate()} disabled={!dmgDesc}><Text style={s.modalBtnT}>Add</Text></Pressable>
            <Pressable onPress={() => setShowAddDamage(false)}><Text style={s.cancel}>Cancel</Text></Pressable>
          </View></View>
        </Modal>
        <Modal visible={showAddLineItem} transparent animationType="slide">
          <View style={s.modal}><View style={s.modalC}>
            <Text style={s.modalT}>Add line item</Text>
            <TextInput style={s.input} placeholder="Description" value={liDesc} onChangeText={setLiDesc} />
            <TextInput style={s.input} placeholder="Category (Roofing, Drywall...)" value={liCategory} onChangeText={setLiCategory} />
            <View style={s.row}>
              {["R&R", "Repair", "Paint", "Tear Off"].map((a) => (
                <Pressable key={a} style={[s.sevBtn, liAction === a && s.sevA]} onPress={() => setLiAction(a)}><Text style={[s.sevT, liAction === a && s.sevTA]}>{a}</Text></Pressable>
              ))}
            </View>
            <View style={s.row}>
              <TextInput style={[s.input, s.f1]} placeholder="Qty" value={liQty} onChangeText={setLiQty} keyboardType="numeric" />
              <TextInput style={[s.input, s.f1]} placeholder="Unit" value={liUnit} onChangeText={setLiUnit} />
            </View>
            <Pressable style={s.modalBtn} onPress={() => addLineItemMut.mutate()} disabled={!liDesc}><Text style={s.modalBtnT}>Add</Text></Pressable>
            <Pressable onPress={() => setShowAddLineItem(false)}><Text style={s.cancel}>Cancel</Text></Pressable>
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
  headerLeft: { flex: 1 }, title: { fontSize: 20, fontWeight: "bold", color: "#342A4F" },
  sub: { fontSize: 13, color: "#6b7280", marginTop: 2 },
  sessionBadge: { backgroundColor: "#7763B7", paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  sessionBadgeText: { color: "#fff", fontSize: 12, fontWeight: "600" },
  startBox: { flex: 1, justifyContent: "center", alignItems: "center", padding: 32 },
  startTitle: { fontSize: 22, fontWeight: "700", color: "#342A4F" },
  startHint: { fontSize: 15, color: "#6b7280", textAlign: "center", marginTop: 12, lineHeight: 22 },
  startBtn: { marginTop: 24, backgroundColor: "#7763B7", paddingHorizontal: 32, paddingVertical: 16, borderRadius: 12 },
  startBtnText: { color: "#fff", fontSize: 18, fontWeight: "600" },
  tabs: { flexDirection: "row", paddingHorizontal: 12, gap: 4 },
  tab: { flex: 1, paddingVertical: 10, alignItems: "center", borderBottomWidth: 2, borderBottomColor: "transparent" },
  tabActive: { borderBottomColor: "#7763B7" },
  tabText: { fontSize: 13, fontWeight: "500", color: "#6b7280" },
  tabTextActive: { color: "#7763B7", fontWeight: "600" },
  // Voice
  voiceContainer: { flex: 1, alignItems: "center", paddingTop: 24 },
  micBtn: { width: 100, height: 100, borderRadius: 50, justifyContent: "center", alignItems: "center", shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.2, shadowRadius: 8, elevation: 6 },
  micIcon: { fontSize: 40 },
  voiceLabel: { fontSize: 16, fontWeight: "600", marginTop: 12, marginBottom: 16 },
  statsRow: { flexDirection: "row", gap: 12, marginBottom: 16 },
  stat: { alignItems: "center", minWidth: 60 },
  statNum: { fontSize: 18, fontWeight: "700", color: "#7763B7" },
  statLabel: { fontSize: 11, color: "#6b7280" },
  transcriptBox: { flex: 1, width: "100%", backgroundColor: "#fff", borderTopLeftRadius: 16, borderTopRightRadius: 16 },
  transcriptContent: { padding: 16, paddingBottom: 32 },
  transcriptEmpty: { color: "#9ca3af", fontSize: 14, textAlign: "center", paddingVertical: 24, lineHeight: 22 },
  transcriptEntry: { marginBottom: 12, paddingLeft: 12, borderLeftWidth: 3, borderLeftColor: "#e5e7eb" },
  transcriptAgent: { borderLeftColor: "#7763B7" },
  transcriptSpeaker: { fontSize: 11, fontWeight: "600", color: "#6b7280", marginBottom: 2 },
  transcriptText: { fontSize: 14, color: "#374151", lineHeight: 20 },
  // Content
  content: { flex: 1 }, contentInner: { padding: 16, paddingBottom: 120 },
  card: { backgroundColor: "#fff", borderRadius: 12, padding: 14, marginBottom: 12, shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 2, elevation: 2 },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  cardTitle: { fontSize: 15, fontWeight: "600", color: "#342A4F" },
  cardBadge: { fontSize: 11, color: "#7763B7", fontWeight: "600" },
  cardMeta: { fontSize: 13, color: "#6b7280", marginTop: 4 },
  cardActions: { flexDirection: "row", gap: 8, marginTop: 10 },
  smallBtn: { backgroundColor: "#7763B7", paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  smallBtnO: { backgroundColor: "#fff", borderWidth: 1.5, borderColor: "#7763B7" },
  smallBtnText: { fontSize: 12, fontWeight: "600", color: "#fff" },
  smallBtnTextO: { color: "#7763B7" },
  addBtn: { borderWidth: 2, borderColor: "#7763B7", borderStyle: "dashed", borderRadius: 12, padding: 16, alignItems: "center" },
  addBtnText: { fontSize: 15, fontWeight: "600", color: "#7763B7" },
  emptyText: { fontSize: 14, color: "#9ca3af", textAlign: "center", padding: 24 },
  totalCard: { backgroundColor: "#342A4F", borderRadius: 12, padding: 16, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  totalLabel: { fontSize: 16, fontWeight: "600", color: "#fff" },
  totalValue: { fontSize: 22, fontWeight: "700", color: "#C6A54E" },
  bottomBar: { flexDirection: "row", gap: 12, padding: 16, backgroundColor: "#fff", borderTopWidth: 1, borderTopColor: "#e5e7eb" },
  bottomBtn: { flex: 1, paddingVertical: 14, alignItems: "center", borderRadius: 10, borderWidth: 2, borderColor: "#7763B7" },
  bottomBtnP: { backgroundColor: "#7763B7", borderColor: "#7763B7" },
  bottomBtnText: { fontSize: 15, fontWeight: "600", color: "#7763B7" },
  bottomBtnTextP: { color: "#fff" },
  // Modals
  modal: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.4)" },
  modalC: { backgroundColor: "#fff", borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, paddingBottom: 40 },
  modalT: { fontSize: 20, fontWeight: "700", color: "#342A4F", marginBottom: 16 },
  input: { borderWidth: 1, borderColor: "#d1d5db", borderRadius: 10, padding: 14, fontSize: 15, marginBottom: 12, color: "#374151" },
  row: { flexDirection: "row", gap: 8, marginBottom: 12 }, f1: { flex: 1 },
  modalBtn: { backgroundColor: "#7763B7", paddingVertical: 14, borderRadius: 12, alignItems: "center", marginBottom: 12 },
  modalBtnT: { color: "#fff", fontSize: 16, fontWeight: "600" },
  cancel: { textAlign: "center", color: "#6b7280", fontSize: 15 },
  sevBtn: { flex: 1, paddingVertical: 10, alignItems: "center", borderRadius: 8, borderWidth: 1.5, borderColor: "#d1d5db" },
  sevA: { borderColor: "#7763B7", backgroundColor: "#f3f0ff" },
  sevT: { fontSize: 13, fontWeight: "500", color: "#6b7280" },
  sevTA: { color: "#7763B7" },
});
