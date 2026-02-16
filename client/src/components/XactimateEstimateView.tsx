import React from "react";
import { cn } from "@/lib/utils";

interface RoomMeasurements {
  sfWalls: number;
  sfCeiling: number;
  sfWallsAndCeiling: number;
  sfFloor: number;
  syFlooring: number;
  lfFloorPerimeter: number;
  lfCeilPerimeter: number;
}

interface LineItem {
  lineNumber: number;
  id: number;
  description: string;
  quantity: number | null;
  unit: string | null;
  action: string | null;
  xactCode: string | null;
  unitPrice: number;
  totalPrice: number;
  taxAmount?: number;
  depreciationAmount: number;
  depreciationType: string;
  depreciationPercentage: number;
  acv: number;
  age: number | null;
  lifeExpectancy: number | null;
}

interface RoomSection {
  id: number;
  name: string;
  roomType: string | null;
  structure: string;
  dimensions: { length: number; width: number; height: number };
  measurements: RoomMeasurements | null;
  items: LineItem[];
  subtotal: number;
  totalDepreciation: number;
  totalRecoverableDepreciation?: number;
  totalNonRecoverableDepreciation?: number;
  totalACV: number;
  status: string;
  damageCount: number;
  photoCount: number;
}

interface XactimateEstimateViewProps {
  data: {
    rooms: RoomSection[];
    grandTotal: number;
    grandDepreciation: number;
    grandRecoverableDepreciation?: number;
    grandNonRecoverableDepreciation?: number;
    grandACV: number;
    totalLineItems: number;
  } | null;
  claimNumber?: string;
  insuredName?: string;
}

function fmtDim(feet: number): string {
  const wholeFeet = Math.floor(feet);
  const inches = Math.round((feet - wholeFeet) * 12);
  if (inches === 0) return `${wholeFeet}'`;
  if (inches === 12) return `${wholeFeet + 1}'`;
  return `${wholeFeet}' ${inches}"`;
}

function fmtNum(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtAgeLife(age: number | null, life: number | null): string {
  const ageStr = age != null ? `${age}` : "—";
  const lifeStr = life != null && life > 0 ? `${life}` : "NA";
  return `${ageStr}/${lifeStr} yrs`;
}

function fmtDepreciation(amount: number, depType: string): string {
  if (amount <= 0.005) return "";
  const formatted = fmtNum(amount);
  if (depType === "Non-Recoverable") {
    return `<${formatted}>`;
  }
  return `(${formatted})`;
}

function RoomSketchSVG({ dimensions, name }: { dimensions: { length: number; width: number; height: number }; name: string }) {
  const { length, width } = dimensions;
  if (!length || !width) return null;

  const maxSvgW = 300;
  const maxSvgH = 200;
  const margin = 40;

  const aspect = length / width;
  let rectW: number, rectH: number;

  if (aspect > (maxSvgW - margin * 2) / (maxSvgH - margin * 2)) {
    rectW = Math.min(maxSvgW - margin * 2, 220);
    rectH = rectW / aspect;
  } else {
    rectH = Math.min(maxSvgH - margin * 2, 130);
    rectW = rectH * aspect;
  }

  rectW = Math.max(rectW, 90);
  rectH = Math.max(rectH, 55);

  const svgW = rectW + margin * 2;
  const svgH = rectH + margin * 2;
  const rx = margin;
  const ry = margin;
  const dimFont = "9";
  const dimColor = "#333";
  const lineColor = "#555";
  const tickLen = 8;
  const tickOff = 4;
  const labelOff = 16;

  return (
    <svg viewBox={`0 0 ${svgW} ${svgH}`} className="w-full max-w-[300px]" style={{ maxHeight: 210 }}>
      <rect x={rx} y={ry} width={rectW} height={rectH}
        fill="none" stroke="#1a1a1a" strokeWidth={2} />

      <text x={rx + rectW / 2} y={ry + rectH / 2}
        textAnchor="middle" dominantBaseline="middle"
        fontSize="11" fontFamily="Work Sans, sans-serif" fontWeight="600" fill="#333">
        {name}
      </text>

      <line x1={rx} y1={ry - tickOff} x2={rx} y2={ry - tickOff - tickLen} stroke={lineColor} strokeWidth={0.8} />
      <line x1={rx + rectW} y1={ry - tickOff} x2={rx + rectW} y2={ry - tickOff - tickLen} stroke={lineColor} strokeWidth={0.8} />
      <line x1={rx} y1={ry - tickOff - tickLen / 2} x2={rx + rectW} y2={ry - tickOff - tickLen / 2} stroke={lineColor} strokeWidth={0.8} />
      <text x={rx + rectW / 2} y={ry - labelOff}
        textAnchor="middle" fontSize={dimFont} fontFamily="monospace" fill={dimColor}>
        {fmtDim(length)}
      </text>

      <line x1={rx} y1={ry + rectH + tickOff} x2={rx} y2={ry + rectH + tickOff + tickLen} stroke={lineColor} strokeWidth={0.8} />
      <line x1={rx + rectW} y1={ry + rectH + tickOff} x2={rx + rectW} y2={ry + rectH + tickOff + tickLen} stroke={lineColor} strokeWidth={0.8} />
      <line x1={rx} y1={ry + rectH + tickOff + tickLen / 2} x2={rx + rectW} y2={ry + rectH + tickOff + tickLen / 2} stroke={lineColor} strokeWidth={0.8} />
      <text x={rx + rectW / 2} y={ry + rectH + labelOff + 6}
        textAnchor="middle" fontSize={dimFont} fontFamily="monospace" fill={dimColor}>
        {fmtDim(length)}
      </text>

      <line x1={rx + rectW + tickOff} y1={ry} x2={rx + rectW + tickOff + tickLen} y2={ry} stroke={lineColor} strokeWidth={0.8} />
      <line x1={rx + rectW + tickOff} y1={ry + rectH} x2={rx + rectW + tickOff + tickLen} y2={ry + rectH} stroke={lineColor} strokeWidth={0.8} />
      <line x1={rx + rectW + tickOff + tickLen / 2} y1={ry} x2={rx + rectW + tickOff + tickLen / 2} y2={ry + rectH} stroke={lineColor} strokeWidth={0.8} />
      <text x={rx + rectW + labelOff + 4} y={ry + rectH / 2}
        textAnchor="start" dominantBaseline="middle"
        fontSize={dimFont} fontFamily="monospace" fill={dimColor}>
        {fmtDim(width)}
      </text>

      <line x1={rx - tickOff} y1={ry} x2={rx - tickOff - tickLen} y2={ry} stroke={lineColor} strokeWidth={0.8} />
      <line x1={rx - tickOff} y1={ry + rectH} x2={rx - tickOff - tickLen} y2={ry + rectH} stroke={lineColor} strokeWidth={0.8} />
      <line x1={rx - tickOff - tickLen / 2} y1={ry} x2={rx - tickOff - tickLen / 2} y2={ry + rectH} stroke={lineColor} strokeWidth={0.8} />
      <text x={rx - labelOff - 4} y={ry + rectH / 2}
        textAnchor="end" dominantBaseline="middle"
        fontSize={dimFont} fontFamily="monospace" fill={dimColor}>
        {fmtDim(width)}
      </text>
    </svg>
  );
}

function MeasurementsBlock({ m }: { m: RoomMeasurements }) {
  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-0.5 text-[11px] font-mono text-slate-700" data-testid="measurements-block">
      <div className="flex justify-between">
        <span>{fmtNum(m.sfWalls)} SF Walls</span>
      </div>
      <div className="flex justify-between">
        <span>{fmtNum(m.sfCeiling)} SF Ceiling</span>
      </div>
      <div className="flex justify-between">
        <span>{fmtNum(m.sfWallsAndCeiling)} SF Walls &amp; Ceiling</span>
      </div>
      <div className="flex justify-between">
        <span>{fmtNum(m.sfFloor)} SF Floor</span>
      </div>
      <div className="flex justify-between">
        <span>{fmtNum(m.syFlooring)} SY Flooring</span>
      </div>
      <div className="flex justify-between">
        <span>{fmtNum(m.lfFloorPerimeter)} LF Floor Perimeter</span>
      </div>
      <div>&nbsp;</div>
      <div className="flex justify-between">
        <span>{fmtNum(m.lfCeilPerimeter)} LF Ceil. Perimeter</span>
      </div>
    </div>
  );
}

function LineItemsTable({ items, roomName, subtotal, totalDepreciation, totalRecoverableDepreciation, totalNonRecoverableDepreciation, totalACV }: {
  items: LineItem[];
  roomName: string;
  subtotal: number;
  totalDepreciation: number;
  totalRecoverableDepreciation?: number;
  totalNonRecoverableDepreciation?: number;
  totalACV: number;
}) {
  if (items.length === 0) return null;

  return (
    <div className="mt-3" data-testid="line-items-table">
      <table className="w-full text-[11px] border-collapse">
        <thead>
          <tr className="border-b border-slate-300">
            <th className="text-left py-1.5 pr-1 font-semibold text-slate-600" style={{ width: "6%" }}></th>
            <th className="text-right py-1.5 px-1 font-semibold text-slate-600" style={{ width: "10%" }}>QUANTITY</th>
            <th className="text-right py-1.5 px-1 font-semibold text-slate-600" style={{ width: "8%" }}>UNIT</th>
            <th className="text-right py-1.5 px-1 font-semibold text-slate-600" style={{ width: "7%" }}>TAX</th>
            <th className="text-right py-1.5 px-1 font-semibold text-slate-600" style={{ width: "10%" }}>RCV</th>
            <th className="text-center py-1.5 px-1 font-semibold text-slate-600" style={{ width: "10%" }}>AGE/LIFE</th>
            <th className="text-center py-1.5 px-1 font-semibold text-slate-600" style={{ width: "7%" }}>COND.</th>
            <th className="text-right py-1.5 px-1 font-semibold text-slate-600" style={{ width: "8%" }}>DEP %</th>
            <th className="text-right py-1.5 px-1 font-semibold text-slate-600" style={{ width: "12%" }}>DEPREC.</th>
            <th className="text-right py-1.5 pl-1 font-semibold text-slate-600" style={{ width: "10%" }}>ACV</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const qty = item.quantity || 0;
            const up = item.unitPrice || 0;
            const extendedCost = qty * up;
            const tax = item.taxAmount ?? Math.max(0, item.totalPrice - extendedCost);
            const depAmt = item.depreciationAmount || 0;
            const depPct = item.depreciationPercentage || 0;
            const depType = item.depreciationType || "Recoverable";
            const acv = item.acv != null ? item.acv : (item.totalPrice - depAmt);
            const isNonRecoverable = depType === "Non-Recoverable";
            const isPWI = depType === "Paid When Incurred";

            return (
              <React.Fragment key={item.id}>
                <tr className="border-b border-slate-100 hover:bg-slate-50/50">
                  <td colSpan={10} className="py-1 pr-2 text-slate-800">
                    <span className="text-slate-400 mr-1">{item.lineNumber}.</span>
                    {item.description}
                  </td>
                </tr>
                <tr className="border-b border-slate-100 hover:bg-slate-50/50">
                  <td></td>
                  <td className="text-right py-1 px-1 text-slate-600 font-mono whitespace-nowrap">
                    {qty > 0 ? `${fmtNum(qty)} ${item.unit || ""}`.trim() : ""}
                  </td>
                  <td className="text-right py-1 px-1 text-slate-600 font-mono">
                    {up > 0 ? fmtNum(up) : ""}
                  </td>
                  <td className="text-right py-1 px-1 text-slate-600 font-mono">
                    {tax > 0.005 ? fmtNum(tax) : "0.00"}
                  </td>
                  <td className="text-right py-1 px-1 font-mono text-slate-800">
                    {fmtNum(item.totalPrice)}
                  </td>
                  <td className="text-center py-1 px-1 font-mono text-slate-600 whitespace-nowrap" data-testid={`age-life-${item.id}`}>
                    {fmtAgeLife(item.age, item.lifeExpectancy)}
                  </td>
                  <td className="text-center py-1 px-1 font-mono text-slate-500">
                    Avg.
                  </td>
                  <td className="text-right py-1 px-1 font-mono text-slate-600 whitespace-nowrap">
                    {depPct > 0 ? (
                      <span>
                        {depPct % 1 === 0 ? `${depPct}%` : `${depPct.toFixed(2)}%`}
                        {isPWI ? "" : " [%]"}
                      </span>
                    ) : isPWI ? "PWI" : ""}
                  </td>
                  <td className={cn(
                    "text-right py-1 px-1 font-mono whitespace-nowrap",
                    isNonRecoverable ? "text-red-700" : isPWI ? "text-amber-700" : "text-slate-700"
                  )} data-testid={`depreciation-${item.id}`}>
                    {depAmt > 0.005 ? fmtDepreciation(depAmt, depType) : isPWI ? "PWI" : ""}
                  </td>
                  <td className="text-right py-1 pl-1 font-mono font-semibold text-slate-800" data-testid={`acv-${item.id}`}>
                    {fmtNum(acv)}
                  </td>
                </tr>
              </React.Fragment>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-slate-300">
            <td colSpan={3} className="py-2 pr-2 font-semibold text-slate-700">
              Totals: {roomName}
            </td>
            <td className="text-right py-2 px-1 font-mono font-bold text-slate-700">
              {(items.reduce((s, i) => s + (i.taxAmount ?? 0), 0)) > 0.005
                ? fmtNum(items.reduce((s, i) => s + (i.taxAmount ?? 0), 0))
                : ""}
            </td>
            <td className="text-right py-2 px-1 font-mono font-bold text-slate-900">
              {fmtNum(subtotal)}
            </td>
            <td colSpan={3}></td>
            <td className="text-right py-2 px-1 font-mono font-bold text-slate-700">
              {totalDepreciation > 0.005 ? fmtNum(totalDepreciation) : ""}
            </td>
            <td className="text-right py-2 pl-1 font-mono font-bold text-slate-900">
              {fmtNum(totalACV)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function RoomSectionView({ room }: { room: RoomSection }) {
  const hasDimensions = room.dimensions.length > 0 && room.dimensions.width > 0;
  const isExterior = (room.roomType || "").startsWith("exterior_");

  return (
    <div className="mb-8 break-inside-avoid" data-testid={`room-section-${room.id}`}>
      {isExterior ? (
        <div>
          <div className="flex items-baseline justify-between mb-2 border-b border-slate-200 pb-1">
            <h3 className="text-sm font-bold text-slate-800">{room.name}</h3>
            {hasDimensions && (
              <span className="text-[11px] font-mono text-slate-500">
                {room.dimensions.length > 0 && room.dimensions.width > 0
                  ? `${fmtDim(room.dimensions.length)} × ${fmtDim(room.dimensions.width)}`
                  : room.dimensions.length > 0 ? `${fmtDim(room.dimensions.length)} LF` : ""}
              </span>
            )}
          </div>
        </div>
      ) : (
        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex-shrink-0">
            {hasDimensions && (
              <RoomSketchSVG dimensions={room.dimensions} name={room.name} />
            )}
            {!hasDimensions && (
              <div className="w-[200px] h-[80px] border-2 border-dashed border-slate-300 flex items-center justify-center rounded">
                <span className="text-xs text-slate-400 text-center px-2">{room.name}</span>
              </div>
            )}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-baseline justify-between mb-2">
              <h3 className="text-sm font-bold text-slate-800">{room.name}</h3>
              <span className="text-[11px] font-mono text-slate-500">Height: {room.dimensions.height || 8}'</span>
            </div>

            {room.measurements && (
              <MeasurementsBlock m={room.measurements} />
            )}
          </div>
        </div>
      )}

      <LineItemsTable
        items={room.items}
        roomName={room.name}
        subtotal={room.subtotal}
        totalDepreciation={room.totalDepreciation || 0}
        totalRecoverableDepreciation={room.totalRecoverableDepreciation}
        totalNonRecoverableDepreciation={room.totalNonRecoverableDepreciation}
        totalACV={room.totalACV || 0}
      />

      {room.items.length === 0 && (
        <div className="mt-2 text-[11px] text-slate-400 italic">No line items recorded for this area.</div>
      )}
    </div>
  );
}

export default function XactimateEstimateView({ data, claimNumber, insuredName }: XactimateEstimateViewProps) {
  if (!data || data.rooms.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-slate-400">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="mb-3 opacity-40">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="16" y1="13" x2="8" y2="13" />
          <line x1="16" y1="17" x2="8" y2="17" />
        </svg>
        <p className="text-sm">No inspection data available yet</p>
      </div>
    );
  }

  const structures = new Map<string, RoomSection[]>();
  for (const room of data.rooms) {
    const s = room.structure || "Main Dwelling";
    if (!structures.has(s)) structures.set(s, []);
    structures.get(s)!.push(room);
  }

  let globalLineNum = 0;
  for (const room of data.rooms) {
    for (const item of room.items) {
      globalLineNum++;
      item.lineNumber = globalLineNum;
    }
  }

  const hasRecoverable = (data.grandRecoverableDepreciation || 0) > 0.005;
  const hasNonRecoverable = (data.grandNonRecoverableDepreciation || 0) > 0.005;

  return (
    <div className="bg-white" data-testid="xactimate-estimate-view">
      <div className="border-b border-slate-200 px-4 py-3 flex items-baseline justify-between">
        <div>
          {insuredName && (
            <p className="text-xs font-mono text-slate-500 uppercase tracking-wider">{insuredName}</p>
          )}
          <h2 className="text-base font-bold text-slate-800 font-mono">
            {claimNumber || "Estimate"}
          </h2>
        </div>
        <div className="text-right text-[11px] font-mono text-slate-400">
          <p>{data.totalLineItems} line items</p>
          <p>{data.rooms.length} area{data.rooms.length !== 1 ? "s" : ""}</p>
        </div>
      </div>

      <div className="px-4 py-4">
        {Array.from(structures.entries()).map(([structureName, rooms]) => (
          <div key={structureName}>
            {structures.size > 1 && (
              <div className="mb-4 pb-1 border-b-2 border-slate-300">
                <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wider font-mono">
                  {structureName}
                </h2>
              </div>
            )}

            {rooms.map((room) => (
              <RoomSectionView key={room.id} room={room} />
            ))}
          </div>
        ))}
      </div>

      {data.grandTotal > 0 && (
        <div className="border-t-2 border-slate-400 mx-4 py-3">
          <table className="w-full text-xs font-mono">
            <thead>
              <tr className="border-b border-slate-200">
                <th className="text-left py-1 font-semibold text-slate-600">Replacement Cost Value</th>
                {hasRecoverable && (
                  <th className="text-right py-1 font-semibold text-slate-600">Less Recoverable<br/>Depreciation</th>
                )}
                {hasNonRecoverable && (
                  <th className="text-right py-1 font-semibold text-slate-600">Less Non Recoverable<br/>Depreciation</th>
                )}
                <th className="text-right py-1 font-semibold text-slate-600">Actual Cash Value (ACV)</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="py-2 font-bold text-slate-900">${fmtNum(data.grandTotal)}</td>
                {hasRecoverable && (
                  <td className="text-right py-2 font-bold text-slate-700">({fmtNum(data.grandRecoverableDepreciation!)})</td>
                )}
                {hasNonRecoverable && (
                  <td className="text-right py-2 font-bold text-red-700">&lt;${fmtNum(data.grandNonRecoverableDepreciation!)}&gt;</td>
                )}
                <td className="text-right py-2 font-bold text-slate-900">${fmtNum(data.grandACV || data.grandTotal)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
