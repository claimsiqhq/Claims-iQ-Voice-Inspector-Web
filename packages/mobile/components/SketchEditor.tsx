import React, { useState, useRef } from "react";
import { View, Text, StyleSheet, Pressable, PanResponder, TextInput, Modal, ScrollView, Dimensions } from "react-native";
import Svg, { Rect, Line, Text as SvgText, Circle, G } from "react-native-svg";

interface Room {
  id: number;
  name: string;
  dimensions: { length: number; width: number; height?: number };
  position?: { x: number; y: number };
}

interface Opening {
  id: number;
  roomId: number;
  openingType: string;
  wallDirection: string | null;
  widthFt: number;
  heightFt: number;
  opensInto: string | null;
}

interface Adjacency {
  id: number;
  roomIdA: number;
  roomIdB: number;
  wallDirectionA: string | null;
  wallDirectionB: string | null;
  sharedWallLengthFt: number | null;
}

interface SketchEditorProps {
  rooms: Room[];
  openings: Opening[];
  adjacencies: Adjacency[];
  onAddRoom: (name: string, length: number, width: number, height: number) => void;
  onMoveRoom: (roomId: number, x: number, y: number) => void;
  onAddOpening: (roomId: number, type: string, wall: string, width: number, height: number, opensInto: string) => void;
  onAddAdjacency: (roomIdA: number, roomIdB: number, wallA: string, wallB: string) => void;
  onSelectRoom: (roomId: number) => void;
  selectedRoomId: number | null;
}

const SCALE = 6;
const GRID_SIZE = 10;
const CANVAS_W = Dimensions.get("window").width - 32;
const CANVAS_H = 400;

const OPENING_SYMBOLS: Record<string, string> = {
  standard_door: "D", window: "W", overhead_door: "G",
  missing_wall: "MW", pass_through: "PT", archway: "A", cased_opening: "CO",
};

const WALL_DIRS = ["north", "south", "east", "west"];
const OPENING_TYPES = ["standard_door", "window", "overhead_door", "missing_wall", "pass_through", "archway", "cased_opening"];

function snapToGrid(v: number): number {
  return Math.round(v / GRID_SIZE) * GRID_SIZE;
}

export default function SketchEditor({
  rooms, openings, adjacencies, onAddRoom, onMoveRoom, onAddOpening, onAddAdjacency, onSelectRoom, selectedRoomId,
}: SketchEditorProps) {
  const [showAddRoom, setShowAddRoom] = useState(false);
  const [showAddOpening, setShowAddOpening] = useState(false);
  const [showAddAdj, setShowAddAdj] = useState(false);
  const [dragging, setDragging] = useState<number | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

  // Form state
  const [rmName, setRmName] = useState("");
  const [rmLen, setRmLen] = useState("12");
  const [rmWid, setRmWid] = useState("10");
  const [rmHt, setRmHt] = useState("8");
  const [opType, setOpType] = useState("standard_door");
  const [opWall, setOpWall] = useState("north");
  const [opW, setOpW] = useState("3");
  const [opH, setOpH] = useState("7");
  const [opInto, setOpInto] = useState("");
  const [adjRoomB, setAdjRoomB] = useState<number | null>(null);
  const [adjWallA, setAdjWallA] = useState("east");
  const [adjWallB, setAdjWallB] = useState("west");

  // Auto-position rooms
  const positionedRooms = rooms.map((r, i) => ({
    ...r,
    px: r.position?.x ?? 20 + (i % 3) * 120,
    py: r.position?.y ?? 20 + Math.floor(i / 3) * 100,
    w: r.dimensions.length * SCALE,
    h: r.dimensions.width * SCALE,
  }));

  function getOpeningsForRoom(roomId: number) {
    return openings.filter((o) => o.roomId === roomId);
  }

  function renderOpening(room: typeof positionedRooms[0], opening: Opening) {
    const wall = opening.wallDirection || "north";
    const owPx = opening.widthFt * SCALE;
    const center = owPx / 2;
    let ox = 0, oy = 0, lx1 = 0, ly1 = 0, lx2 = 0, ly2 = 0;

    if (wall === "north") { ox = room.px + room.w / 2 - center; oy = room.py - 2; lx1 = ox; ly1 = oy; lx2 = ox + owPx; ly2 = oy; }
    else if (wall === "south") { ox = room.px + room.w / 2 - center; oy = room.py + room.h; lx1 = ox; ly1 = oy; lx2 = ox + owPx; ly2 = oy; }
    else if (wall === "west") { ox = room.px - 2; oy = room.py + room.h / 2 - center; lx1 = ox; ly1 = oy; lx2 = ox; ly2 = oy + owPx; }
    else { ox = room.px + room.w; oy = room.py + room.h / 2 - center; lx1 = ox; ly1 = oy; lx2 = ox; ly2 = oy + owPx; }

    const sym = OPENING_SYMBOLS[opening.openingType] || "?";
    const midX = (lx1 + lx2) / 2;
    const midY = (ly1 + ly2) / 2;

    return (
      <G key={`op-${opening.id}`}>
        <Line x1={lx1} y1={ly1} x2={lx2} y2={ly2} stroke="#dc2626" strokeWidth={3} />
        <SvgText x={midX} y={midY - 4} textAnchor="middle" fontSize={8} fill="#dc2626" fontWeight="bold">{sym}</SvgText>
      </G>
    );
  }

  function renderAdjacencyLine(adj: Adjacency) {
    const rA = positionedRooms.find((r) => r.id === adj.roomIdA);
    const rB = positionedRooms.find((r) => r.id === adj.roomIdB);
    if (!rA || !rB) return null;
    const ax = rA.px + rA.w / 2;
    const ay = rA.py + rA.h / 2;
    const bx = rB.px + rB.w / 2;
    const by = rB.py + rB.h / 2;
    return (
      <Line key={`adj-${adj.id}`} x1={ax} y1={ay} x2={bx} y2={by} stroke="#7763B7" strokeWidth={1} strokeDasharray="4,4" opacity={0.5} />
    );
  }

  return (
    <View style={s.container}>
      {/* Toolbar */}
      <View style={s.toolbar}>
        <Pressable style={s.toolBtn} onPress={() => setShowAddRoom(true)}><Text style={s.toolBtnText}>+ Room</Text></Pressable>
        <Pressable style={[s.toolBtn, !selectedRoomId && s.toolBtnDisabled]} onPress={() => selectedRoomId && setShowAddOpening(true)} disabled={!selectedRoomId}>
          <Text style={s.toolBtnText}>+ Opening</Text>
        </Pressable>
        <Pressable style={[s.toolBtn, !selectedRoomId && s.toolBtnDisabled]} onPress={() => selectedRoomId && setShowAddAdj(true)} disabled={!selectedRoomId}>
          <Text style={s.toolBtnText}>+ Adjacency</Text>
        </Pressable>
      </View>

      {/* Canvas */}
      <View style={s.canvas}>
        <Svg width={CANVAS_W} height={CANVAS_H} viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`}>
          {/* Grid */}
          {Array.from({ length: Math.ceil(CANVAS_W / GRID_SIZE) }).map((_, i) => (
            <Line key={`gv${i}`} x1={i * GRID_SIZE} y1={0} x2={i * GRID_SIZE} y2={CANVAS_H} stroke="#e5e7eb" strokeWidth={0.5} />
          ))}
          {Array.from({ length: Math.ceil(CANVAS_H / GRID_SIZE) }).map((_, i) => (
            <Line key={`gh${i}`} x1={0} y1={i * GRID_SIZE} x2={CANVAS_W} y2={i * GRID_SIZE} stroke="#e5e7eb" strokeWidth={0.5} />
          ))}

          {/* Adjacency lines */}
          {adjacencies.map(renderAdjacencyLine)}

          {/* Rooms */}
          {positionedRooms.map((room) => {
            const isSelected = room.id === selectedRoomId;
            return (
              <G key={room.id} onPress={() => onSelectRoom(room.id)}>
                <Rect x={room.px} y={room.py} width={room.w} height={room.h}
                  fill={isSelected ? "#f3f0ff" : "#f8f7fc"} stroke={isSelected ? "#7763B7" : "#342A4F"} strokeWidth={isSelected ? 2.5 : 1.5} />
                <SvgText x={room.px + room.w / 2} y={room.py + room.h / 2 - 5} textAnchor="middle" fontSize={9} fill="#342A4F" fontWeight="bold">
                  {room.name}
                </SvgText>
                <SvgText x={room.px + room.w / 2} y={room.py + room.h / 2 + 8} textAnchor="middle" fontSize={8} fill="#6b7280">
                  {room.dimensions.length}' x {room.dimensions.width}'
                </SvgText>
                {/* Dimension labels */}
                <SvgText x={room.px + room.w / 2} y={room.py - 4} textAnchor="middle" fontSize={7} fill="#9ca3af">
                  {room.dimensions.length}'
                </SvgText>
                <SvgText x={room.px + room.w + 4} y={room.py + room.h / 2 + 3} fontSize={7} fill="#9ca3af">
                  {room.dimensions.width}'
                </SvgText>
                {/* Openings */}
                {getOpeningsForRoom(room.id).map((op) => renderOpening(room, op))}
              </G>
            );
          })}
        </Svg>
      </View>

      {rooms.length === 0 && <Text style={s.hint}>Tap "+ Room" to add rooms to the sketch, or use voice to say room dimensions.</Text>}

      {/* Add room modal */}
      <Modal visible={showAddRoom} transparent animationType="slide">
        <View style={s.modal}><View style={s.modalC}>
          <Text style={s.modalT}>Add room to sketch</Text>
          <TextInput style={s.input} placeholder="Room name" value={rmName} onChangeText={setRmName} />
          <View style={s.row}>
            <TextInput style={[s.input, s.f1]} placeholder="Length (ft)" value={rmLen} onChangeText={setRmLen} keyboardType="numeric" />
            <TextInput style={[s.input, s.f1]} placeholder="Width (ft)" value={rmWid} onChangeText={setRmWid} keyboardType="numeric" />
            <TextInput style={[s.input, s.f1]} placeholder="Height" value={rmHt} onChangeText={setRmHt} keyboardType="numeric" />
          </View>
          <Pressable style={s.modalBtn} onPress={() => { onAddRoom(rmName, parseFloat(rmLen) || 12, parseFloat(rmWid) || 10, parseFloat(rmHt) || 8); setShowAddRoom(false); setRmName(""); }} disabled={!rmName}>
            <Text style={s.modalBtnT}>Add</Text>
          </Pressable>
          <Pressable onPress={() => setShowAddRoom(false)}><Text style={s.cancel}>Cancel</Text></Pressable>
        </View></View>
      </Modal>

      {/* Add opening modal */}
      <Modal visible={showAddOpening} transparent animationType="slide">
        <View style={s.modal}><View style={s.modalC}>
          <Text style={s.modalT}>Add opening</Text>
          <Text style={s.label}>Type</Text>
          <ScrollView horizontal style={s.chipRow}>
            {OPENING_TYPES.map((t) => (
              <Pressable key={t} style={[s.chip, opType === t && s.chipActive]} onPress={() => setOpType(t)}>
                <Text style={[s.chipText, opType === t && s.chipTextActive]}>{t.replace(/_/g, " ")}</Text>
              </Pressable>
            ))}
          </ScrollView>
          <Text style={s.label}>Wall</Text>
          <View style={s.row}>
            {WALL_DIRS.map((w) => (
              <Pressable key={w} style={[s.chip, opWall === w && s.chipActive]} onPress={() => setOpWall(w)}>
                <Text style={[s.chipText, opWall === w && s.chipTextActive]}>{w}</Text>
              </Pressable>
            ))}
          </View>
          <View style={s.row}>
            <TextInput style={[s.input, s.f1]} placeholder="Width (ft)" value={opW} onChangeText={setOpW} keyboardType="numeric" />
            <TextInput style={[s.input, s.f1]} placeholder="Height (ft)" value={opH} onChangeText={setOpH} keyboardType="numeric" />
          </View>
          <TextInput style={s.input} placeholder="Opens into (room name or E for exterior)" value={opInto} onChangeText={setOpInto} />
          <Pressable style={s.modalBtn} onPress={() => { onAddOpening(selectedRoomId!, opType, opWall, parseFloat(opW) || 3, parseFloat(opH) || 7, opInto || "E"); setShowAddOpening(false); }}>
            <Text style={s.modalBtnT}>Add</Text>
          </Pressable>
          <Pressable onPress={() => setShowAddOpening(false)}><Text style={s.cancel}>Cancel</Text></Pressable>
        </View></View>
      </Modal>

      {/* Add adjacency modal */}
      <Modal visible={showAddAdj} transparent animationType="slide">
        <View style={s.modal}><View style={s.modalC}>
          <Text style={s.modalT}>Connect rooms</Text>
          <Text style={s.label}>Connect to:</Text>
          <ScrollView horizontal style={s.chipRow}>
            {rooms.filter((r) => r.id !== selectedRoomId).map((r) => (
              <Pressable key={r.id} style={[s.chip, adjRoomB === r.id && s.chipActive]} onPress={() => setAdjRoomB(r.id)}>
                <Text style={[s.chipText, adjRoomB === r.id && s.chipTextActive]}>{r.name}</Text>
              </Pressable>
            ))}
          </ScrollView>
          <View style={s.row}>
            {WALL_DIRS.map((w) => (
              <Pressable key={w} style={[s.chip, adjWallA === w && s.chipActive]} onPress={() => setAdjWallA(w)}>
                <Text style={[s.chipText, adjWallA === w && s.chipTextActive]}>{w}</Text>
              </Pressable>
            ))}
          </View>
          <Pressable style={s.modalBtn} onPress={() => { if (adjRoomB) { onAddAdjacency(selectedRoomId!, adjRoomB, adjWallA, adjWallB); setShowAddAdj(false); } }} disabled={!adjRoomB}>
            <Text style={s.modalBtnT}>Connect</Text>
          </Pressable>
          <Pressable onPress={() => setShowAddAdj(false)}><Text style={s.cancel}>Cancel</Text></Pressable>
        </View></View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  container: { marginBottom: 16 },
  toolbar: { flexDirection: "row", gap: 8, marginBottom: 8 },
  toolBtn: { backgroundColor: "#7763B7", paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8 },
  toolBtnDisabled: { opacity: 0.4 },
  toolBtnText: { color: "#fff", fontSize: 13, fontWeight: "600" },
  canvas: { backgroundColor: "#fff", borderRadius: 12, borderWidth: 1, borderColor: "#e5e7eb", overflow: "hidden" },
  hint: { fontSize: 13, color: "#9ca3af", textAlign: "center", padding: 12 },
  modal: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.4)" },
  modalC: { backgroundColor: "#fff", borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, paddingBottom: 40 },
  modalT: { fontSize: 20, fontWeight: "700", color: "#342A4F", marginBottom: 16 },
  input: { borderWidth: 1, borderColor: "#d1d5db", borderRadius: 10, padding: 14, fontSize: 15, marginBottom: 12, color: "#374151" },
  row: { flexDirection: "row", gap: 8, marginBottom: 12, flexWrap: "wrap" },
  f1: { flex: 1 },
  label: { fontSize: 13, fontWeight: "500", color: "#6b7280", marginBottom: 6 },
  chipRow: { flexDirection: "row", marginBottom: 12 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: 1.5, borderColor: "#d1d5db", marginRight: 8 },
  chipActive: { borderColor: "#7763B7", backgroundColor: "#f3f0ff" },
  chipText: { fontSize: 12, fontWeight: "500", color: "#6b7280" },
  chipTextActive: { color: "#7763B7" },
  modalBtn: { backgroundColor: "#7763B7", paddingVertical: 14, borderRadius: 12, alignItems: "center", marginBottom: 12 },
  modalBtnT: { color: "#fff", fontSize: 16, fontWeight: "600" },
  cancel: { textAlign: "center", color: "#6b7280", fontSize: 15 },
});
