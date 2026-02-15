import React from "react";
import { View, Text, StyleSheet } from "react-native";
import Svg, { Rect, Line, Text as SvgText } from "react-native-svg";

interface Room {
  id: number;
  name: string;
  dimensions: { length: number; width: number; height?: number } | null;
}

interface PropertySketchProps {
  rooms: Room[];
  title?: string;
}

function fmtDim(feet: number): string {
  const wholeFeet = Math.floor(feet);
  const inches = Math.round((feet - wholeFeet) * 12);
  if (inches === 0) return `${wholeFeet}'`;
  if (inches === 12) return `${wholeFeet + 1}'`;
  return `${wholeFeet}' ${inches}"`;
}

function RoomSketch({ room, x, y, scale }: { room: Room; x: number; y: number; scale: number }) {
  const dims = room.dimensions;
  if (!dims?.length || !dims?.width) return null;

  const w = dims.length * scale;
  const h = dims.width * scale;
  const tickLen = 6;
  const labelOffset = 14;

  return (
    <>
      {/* Room rectangle */}
      <Rect x={x} y={y} width={w} height={h} fill="#f8f7fc" stroke="#342A4F" strokeWidth={2} />

      {/* Room name */}
      <SvgText x={x + w / 2} y={y + h / 2 - 6} textAnchor="middle" fontSize={10} fill="#6b7280">
        {room.name}
      </SvgText>
      <SvgText x={x + w / 2} y={y + h / 2 + 8} textAnchor="middle" fontSize={9} fill="#9ca3af">
        {dims.length}' x {dims.width}'
      </SvgText>

      {/* Top dimension */}
      <Line x1={x} y1={y - tickLen} x2={x} y2={y - 2} stroke="#555" strokeWidth={0.8} />
      <Line x1={x + w} y1={y - tickLen} x2={x + w} y2={y - 2} stroke="#555" strokeWidth={0.8} />
      <Line x1={x} y1={y - tickLen / 2 - 1} x2={x + w} y2={y - tickLen / 2 - 1} stroke="#555" strokeWidth={0.8} />
      <SvgText x={x + w / 2} y={y - labelOffset} textAnchor="middle" fontSize={9} fill="#333">
        {fmtDim(dims.length)}
      </SvgText>

      {/* Right dimension */}
      <Line x1={x + w + 2} y1={y} x2={x + w + tickLen} y2={y} stroke="#555" strokeWidth={0.8} />
      <Line x1={x + w + 2} y1={y + h} x2={x + w + tickLen} y2={y + h} stroke="#555" strokeWidth={0.8} />
      <Line x1={x + w + tickLen / 2 + 1} y1={y} x2={x + w + tickLen / 2 + 1} y2={y + h} stroke="#555" strokeWidth={0.8} />
      <SvgText
        x={x + w + labelOffset + 4}
        y={y + h / 2 + 3}
        textAnchor="middle"
        fontSize={9}
        fill="#333"
        rotation={90}
        origin={`${x + w + labelOffset + 4}, ${y + h / 2 + 3}`}
      >
        {fmtDim(dims.width)}
      </SvgText>
    </>
  );
}

export default function PropertySketch({ rooms, title }: PropertySketchProps) {
  const roomsWithDims = rooms.filter((r) => r.dimensions?.length && r.dimensions?.width);
  if (roomsWithDims.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>No room dimensions to sketch</Text>
      </View>
    );
  }

  // Layout rooms in a grid
  const maxCols = 3;
  const margin = 30;
  const spacing = 20;
  const scale = 8; // 1 foot = 8 pixels

  // Calculate max dimensions per row
  const cols = Math.min(roomsWithDims.length, maxCols);
  const rowHeights: number[] = [];
  const colWidths: number[] = new Array(cols).fill(0);

  for (let i = 0; i < roomsWithDims.length; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const dims = roomsWithDims[i].dimensions!;
    const w = dims.length * scale;
    const h = dims.width * scale;
    colWidths[col] = Math.max(colWidths[col], w);
    if (!rowHeights[row]) rowHeights[row] = 0;
    rowHeights[row] = Math.max(rowHeights[row], h);
  }

  const totalW = colWidths.reduce((s, w) => s + w, 0) + (cols - 1) * spacing + margin * 2 + 30;
  const totalH = rowHeights.reduce((s, h) => s + h, 0) + (rowHeights.length - 1) * spacing + margin * 2 + 20;

  return (
    <View style={styles.container}>
      {title && <Text style={styles.title}>{title}</Text>}
      <Svg width="100%" height={Math.max(totalH, 150)} viewBox={`0 0 ${Math.max(totalW, 200)} ${Math.max(totalH, 150)}`}>
        {roomsWithDims.map((room, i) => {
          const col = i % cols;
          const row = Math.floor(i / cols);
          let x = margin;
          for (let c = 0; c < col; c++) x += colWidths[c] + spacing;
          let y = margin;
          for (let r = 0; r < row; r++) y += rowHeights[r] + spacing;
          return <RoomSketch key={room.id} room={room} x={x} y={y} scale={scale} />;
        })}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: "#fff", borderRadius: 12, padding: 12, marginBottom: 16 },
  title: { fontSize: 14, fontWeight: "600", color: "#342A4F", marginBottom: 8 },
  empty: { padding: 24, alignItems: "center" },
  emptyText: { fontSize: 13, color: "#9ca3af" },
});
