import { useLocalSearchParams, router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, Pressable } from "react-native";
import { AuthGate } from "@/components/AuthGate";
import * as WebBrowser from "expo-web-browser";
import { API_BASE, getAuthHeaders } from "@/lib/api";

interface Room { id: number; name: string; dimensions: any; damageCount: number; photoCount: number; status: string; }
interface LineItem { id: number; roomId: number | null; description: string; category: string; action: string | null; quantity: number | null; unit: string | null; unitPrice: number | null; totalPrice: number | null; }
interface Claim { id: number; claimNumber: string; insuredName: string | null; propertyAddress: string | null; }

export default function ReviewScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();

  const { data: claim } = useQuery<Claim | null>({ queryKey: [`/api/claims/${id}`], enabled: !!id });
  const sessionQuery = useQuery<{ id: number } | null>({ queryKey: [`/api/claims/${id}/inspection/active`], enabled: !!id, retry: false });
  const session = sessionQuery.data;

  const { data: rooms = [] } = useQuery<Room[]>({ queryKey: [`/api/inspection/${session?.id}/rooms`], enabled: !!session?.id });
  const { data: lineItems = [] } = useQuery<LineItem[]>({ queryKey: [`/api/inspection/${session?.id}/line-items`], enabled: !!session?.id });

  const totalEstimate = lineItems.reduce((s, li) => s + (li.totalPrice || 0), 0);
  const totalDamages = rooms.reduce((s, r) => s + (r.damageCount || 0), 0);
  const totalPhotos = rooms.reduce((s, r) => s + (r.photoCount || 0), 0);

  const trades = [...new Set(lineItems.map((li) => li.category).filter(Boolean))];
  const qualifiesOP = trades.length >= 3;

  const groupedByRoom = rooms.map((room) => ({
    room,
    items: lineItems.filter((li) => li.roomId === room.id),
    subtotal: lineItems.filter((li) => li.roomId === room.id).reduce((s, li) => s + (li.totalPrice || 0), 0),
  }));

  function SketchBox({ dims, name }: { dims: any; name: string }) {
    if (!dims?.length || !dims?.width) return null;
    return (
      <View style={s.sketch}>
        <View style={s.sketchBox}>
          <Text style={s.sketchName}>{name}</Text>
          <Text style={s.sketchDims}>{dims.length}' x {dims.width}'</Text>
        </View>
      </View>
    );
  }

  return (
    <AuthGate>
      <ScrollView style={s.container} contentContainerStyle={s.contentInner}>
        <Text style={s.title}>Scope Review & Export</Text>
        {claim && (
          <View style={s.claimHeader}>
            <Text style={s.claimNumber}>{claim.claimNumber}</Text>
            {claim.insuredName && <Text style={s.meta}>{claim.insuredName}</Text>}
            {claim.propertyAddress && <Text style={s.meta}>{claim.propertyAddress}</Text>}
          </View>
        )}

        {!session && <Text style={s.emptyText}>No active inspection session. Start an inspection first.</Text>}

        {session && (
          <>
            {/* Summary cards */}
            <View style={s.summaryRow}>
              <View style={s.summaryCard}><Text style={s.summaryNum}>{rooms.length}</Text><Text style={s.summaryLabel}>Rooms</Text></View>
              <View style={s.summaryCard}><Text style={s.summaryNum}>{totalDamages}</Text><Text style={s.summaryLabel}>Damages</Text></View>
              <View style={s.summaryCard}><Text style={s.summaryNum}>{lineItems.length}</Text><Text style={s.summaryLabel}>Line items</Text></View>
              <View style={s.summaryCard}><Text style={s.summaryNum}>{totalPhotos}</Text><Text style={s.summaryLabel}>Photos</Text></View>
            </View>

            {/* Total */}
            <View style={s.totalCard}>
              <View>
                <Text style={s.totalLabel}>Estimate total</Text>
                <Text style={s.totalMeta}>{trades.length} trades • {qualifiesOP ? "O&P eligible" : "O&P not eligible"}</Text>
              </View>
              <Text style={s.totalValue}>${totalEstimate.toFixed(2)}</Text>
            </View>

            {/* Room-by-room scope */}
            {groupedByRoom.map(({ room, items, subtotal }) => (
              <View key={room.id} style={s.roomSection}>
                <View style={s.roomHeader}>
                  <Text style={s.roomName}>{room.name}</Text>
                  <Text style={s.roomSubtotal}>${subtotal.toFixed(2)}</Text>
                </View>
                <SketchBox dims={room.dimensions} name={room.name} />
                {room.dimensions && (
                  <View style={s.measurements}>
                    <Text style={s.measText}>SF Walls: {((room.dimensions.length + room.dimensions.width) * 2 * (room.dimensions.height || 8)).toFixed(0)}</Text>
                    <Text style={s.measText}>SF Floor: {(room.dimensions.length * room.dimensions.width).toFixed(0)}</Text>
                    <Text style={s.measText}>LF Perimeter: {((room.dimensions.length + room.dimensions.width) * 2).toFixed(0)}</Text>
                  </View>
                )}
                {items.map((li) => (
                  <View key={li.id} style={s.lineItem}>
                    <View style={s.liLeft}>
                      <Text style={s.liDesc}>{li.description}</Text>
                      <Text style={s.liMeta}>{li.action} • {li.category}</Text>
                    </View>
                    <View style={s.liRight}>
                      <Text style={s.liQty}>{li.quantity} {li.unit}</Text>
                      <Text style={s.liPrice}>${(li.totalPrice || 0).toFixed(2)}</Text>
                    </View>
                  </View>
                ))}
                {items.length === 0 && <Text style={s.emptyText}>No line items for this room</Text>}
              </View>
            ))}

            {/* Actions */}
            <View style={s.actionsRow}>
              <Pressable style={s.actionBtn} onPress={() => router.push({ pathname: "/inspection/[id]", params: { id: String(id) } })}>
                <Text style={s.actionBtnText}>Back to inspection</Text>
              </Pressable>
            </View>
          </>
        )}
      </ScrollView>
    </AuthGate>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f8f7fc" },
  contentInner: { padding: 16, paddingBottom: 48 },
  title: { fontSize: 22, fontWeight: "bold", color: "#342A4F", marginBottom: 16 },
  claimHeader: { backgroundColor: "#fff", borderRadius: 12, padding: 16, marginBottom: 16, shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 2, elevation: 2 },
  claimNumber: { fontSize: 18, fontWeight: "700", color: "#342A4F" },
  meta: { fontSize: 14, color: "#6b7280", marginTop: 4 },
  emptyText: { fontSize: 14, color: "#9ca3af", textAlign: "center", padding: 24 },
  summaryRow: { flexDirection: "row", gap: 8, marginBottom: 16 },
  summaryCard: { flex: 1, backgroundColor: "#fff", borderRadius: 10, padding: 12, alignItems: "center", shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 2, elevation: 1 },
  summaryNum: { fontSize: 22, fontWeight: "700", color: "#7763B7" },
  summaryLabel: { fontSize: 11, color: "#6b7280", marginTop: 2 },
  totalCard: { backgroundColor: "#342A4F", borderRadius: 12, padding: 16, flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 24 },
  totalLabel: { fontSize: 16, fontWeight: "600", color: "#fff" },
  totalMeta: { fontSize: 12, color: "#9D8BBF", marginTop: 2 },
  totalValue: { fontSize: 24, fontWeight: "700", color: "#C6A54E" },
  roomSection: { backgroundColor: "#fff", borderRadius: 12, padding: 16, marginBottom: 16, shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 2, elevation: 2 },
  roomHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  roomName: { fontSize: 16, fontWeight: "600", color: "#342A4F" },
  roomSubtotal: { fontSize: 15, fontWeight: "600", color: "#7763B7" },
  sketch: { alignItems: "center", marginBottom: 12 },
  sketchBox: { width: 160, height: 100, borderWidth: 2, borderColor: "#342A4F", justifyContent: "center", alignItems: "center", borderRadius: 4 },
  sketchName: { fontSize: 10, color: "#6b7280" },
  sketchDims: { fontSize: 12, fontWeight: "600", color: "#342A4F", marginTop: 2 },
  measurements: { flexDirection: "row", gap: 12, marginBottom: 12, flexWrap: "wrap" },
  measText: { fontSize: 11, color: "#6b7280", backgroundColor: "#f3f4f6", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 4 },
  lineItem: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#f3f4f6" },
  liLeft: { flex: 1 },
  liDesc: { fontSize: 14, color: "#374151" },
  liMeta: { fontSize: 12, color: "#9ca3af", marginTop: 2 },
  liRight: { alignItems: "flex-end" },
  liQty: { fontSize: 12, color: "#6b7280" },
  liPrice: { fontSize: 14, fontWeight: "600", color: "#342A4F" },
  actionsRow: { marginTop: 16 },
  actionBtn: { backgroundColor: "#7763B7", padding: 16, borderRadius: 12, alignItems: "center" },
  actionBtnText: { fontSize: 16, fontWeight: "600", color: "#fff" },
});
