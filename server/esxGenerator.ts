import archiver from "archiver";
import { IStorage } from "./storage";

interface LineItemXML {
  id: number;
  description: string;
  category: string;
  action: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  laborTotal: number;
  laborHours: number;
  material: number;
  tax: number;
  acvTotal: number;
  rcvTotal: number;
  room?: string;
}

/**
 * Generates a Xactimate-compatible ESX file (ZIP with XACTDOC.XML + GENERIC_ROUGHDRAFT.XML)
 */
export async function generateESXFile(sessionId: number, storage: IStorage): Promise<Buffer> {
  // Fetch all data for the session
  const session = await storage.getInspectionSession(sessionId);
  if (!session) throw new Error("Session not found");

  const claim = await storage.getClaim(session.claimId);
  if (!claim) throw new Error("Claim not found");

  const items = await storage.getLineItems(sessionId);
  const rooms = await storage.getRooms(sessionId);
  const summary = await storage.getEstimateSummary(sessionId);

  // Map line items to XML format with calculated values
  const lineItemsXML: LineItemXML[] = items.map((item) => ({
    id: item.id,
    description: item.description,
    category: item.category,
    action: item.action || "&",
    quantity: item.quantity || 0,
    unit: item.unit || "EA",
    unitPrice: item.unitPrice || 0,
    laborTotal: (item.totalPrice || 0) * 0.35,
    laborHours: ((item.totalPrice || 0) * 0.35) / 75,
    material: (item.totalPrice || 0) * 0.65,
    tax: (item.totalPrice || 0) * 0.05,
    acvTotal: (item.totalPrice || 0) * 0.7,
    rcvTotal: item.totalPrice || 0,
    room: rooms.find((r) => r.id === item.roomId)?.name || "Unassigned",
  }));

  // Generate XACTDOC.XML
  const xactdocXml = generateXactdoc(claim, summary, lineItemsXML);

  // Generate GENERIC_ROUGHDRAFT.XML
  const roughdraftXml = generateRoughDraft(rooms, lineItemsXML, items);

  // Create ZIP archive
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const archive = archiver("zip", { zlib: { level: 9 } });

    archive.on("data", (data) => chunks.push(data));
    archive.on("error", reject);
    archive.on("end", () => {
      resolve(Buffer.concat(chunks));
    });

    archive.append(Buffer.from(xactdocXml), { name: "XACTDOC.XML" });
    archive.append(Buffer.from(roughdraftXml), { name: "GENERIC_ROUGHDRAFT.XML" });
    archive.finalize();
  });
}

function generateXactdoc(claim: any, summary: any, lineItems: LineItemXML[]): string {
  const transactionId = `CLAIMSIQ-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<XACTDOC>
  <XACTNET_INFO>
    <transactionId>${transactionId}</transactionId>
    <carrierId>CLAIMSIQ</carrierId>
    <carrierName>Claims IQ</carrierName>
    <CONTROL_POINTS>
      <CONTROL_POINT name="ASSIGNMENT" status="COMPLETE"/>
      <CONTROL_POINT name="ESTIMATE" status="COMPLETE"/>
    </CONTROL_POINTS>
    <SUMMARY>
      <totalRCV>${summary.totalRCV.toFixed(2)}</totalRCV>
      <totalACV>${summary.totalACV.toFixed(2)}</totalACV>
      <totalDepreciation>${summary.totalDepreciation.toFixed(2)}</totalDepreciation>
      <deductible>0.00</deductible>
      <lineItemCount>${lineItems.length}</lineItemCount>
    </SUMMARY>
  </XACTNET_INFO>
  <CONTACTS>
    <CONTACT type="INSURED">
      <name>${escapeXml(claim?.insuredName || "")}</name>
      <address>${escapeXml(claim?.propertyAddress || "")}</address>
      <city>${escapeXml(claim?.city || "")}</city>
      <state>${claim?.state || ""}</state>
      <zip>${claim?.zip || ""}</zip>
    </CONTACT>
    <CONTACT type="ADJUSTER">
      <name>Claims IQ Inspector</name>
    </CONTACT>
  </CONTACTS>
  <ADM>
    <dateOfLoss>${claim?.dateOfLoss || ""}</dateOfLoss>
    <dateInspected>${new Date().toISOString().split("T")[0]}</dateInspected>
    <COVERAGE_LOSS>
      <claimNumber>${escapeXml(claim?.claimNumber || "")}</claimNumber>
      <policyNumber></policyNumber>
    </COVERAGE_LOSS>
    <PARAMS>
      <priceList>USNATNL</priceList>
      <laborEfficiency>100</laborEfficiency>
      <depreciationType>${claim?.perilType === "water" ? "Recoverable" : "Standard"}</depreciationType>
    </PARAMS>
  </ADM>
</XACTDOC>`;
}

function generateRoughDraft(rooms: any[], lineItems: LineItemXML[], originalItems: any[]): string {
  // Group line items by room
  const roomGroups: { [key: string]: LineItemXML[] } = {};
  lineItems.forEach((item) => {
    const roomKey = item.room || "Unassigned";
    if (!roomGroups[roomKey]) roomGroups[roomKey] = [];
    roomGroups[roomKey].push(item);
  });

  let itemsXml = "";

  Object.entries(roomGroups).forEach(([roomName, roomItems]) => {
    // Find room dimensions
    const room = rooms.find((r) => r.name === roomName);
    const dims = room?.dimensions || { length: 0, width: 0, height: 8 };

    const wallSF = ((dims.length || 0) + (dims.width || 0)) * 2 * (dims.height || 8);
    const floorSF = (dims.length || 0) * (dims.width || 0);
    const ceilSF = floorSF;
    const perimLF = ((dims.length || 0) + (dims.width || 0)) * 2;

    itemsXml += `        <GROUP type="room" name="${escapeXml(roomName)}">
          <ROOM_INFO roomType="${room?.roomType || "room"}" length="${dims.length || 0}" width="${dims.width || 0}" height="${dims.height || 8}"/>
          <ROOM_DIM_VARS>
            <WALL_SF>${wallSF}</WALL_SF>
            <FLOOR_SF>${floorSF}</FLOOR_SF>
            <CEIL_SF>${ceilSF}</CEIL_SF>
            <PERIM_LF>${perimLF}</PERIM_LF>
          </ROOM_DIM_VARS>
          <ITEMS>
`;

    roomItems.forEach((item, idx) => {
      const origItem = originalItems.find((oi) => oi.id === item.id);
      const xactCode = origItem?.xactCode || "000000";
      const category = item.category.substring(0, 3).toUpperCase();
      const selector = "1/2++";

      itemsXml += `            <ITEM lineNum="${idx + 1}" cat="${category}" sel="${selector}" act="${item.action}" desc="${escapeXml(item.description)}" qty="${item.quantity.toFixed(2)}" unit="${item.unit}" remove="0" replace="${item.rcvTotal.toFixed(2)}" total="${item.rcvTotal.toFixed(2)}" laborTotal="${item.laborTotal.toFixed(2)}" laborHours="${item.laborHours.toFixed(2)}" material="${item.material.toFixed(2)}" tax="${item.tax.toFixed(2)}" acvTotal="${item.acvTotal.toFixed(2)}" rcvTotal="${item.rcvTotal.toFixed(2)}"/>
`;
    });

    itemsXml += `          </ITEMS>
        </GROUP>
`;
  });

  return `<?xml version="1.0" encoding="UTF-8"?>
<GENERIC_ROUGHDRAFT>
  <LINE_ITEM_DETAIL>
    <GROUP type="estimate" name="Estimate">
      <GROUP type="level" name="Property Estimate">
${itemsXml}
      </GROUP>
    </GROUP>
  </LINE_ITEM_DETAIL>
</GENERIC_ROUGHDRAFT>`;
}

function escapeXml(str: string): string {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
