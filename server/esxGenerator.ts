import archiver from "archiver";
import { IStorage } from "./storage";
import {
  generateSubroomXml,
  type RoomDimensions, type OpeningData
} from "./estimateEngine";

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
  provenance?: string;
}

export interface ESXOptions {
  claim: any;
  session: any;
  rooms: any[];
  lineItems: any[];
  briefing?: any;
  openings?: any[];
  isSupplemental?: boolean;
  supplementalReason?: string;
  removedItemIds?: number[];
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
  const briefing = await storage.getBriefing(session.claimId);
  const openings = await storage.getOpeningsForSession(sessionId);

  return generateESXFromData({ claim, session, rooms, lineItems: items, briefing, openings });
}

/**
 * Generates ESX from pre-built data — used by both full export and supplemental delta export
 */
export async function generateESXFromData(options: ESXOptions): Promise<Buffer> {
  const { claim, session, rooms, lineItems, briefing, openings, isSupplemental, supplementalReason, removedItemIds } = options;

  // Map line items to XML format with ACTUAL M/L/E from regional prices when available
  const lineItemsXML: LineItemXML[] = [];
  const { getRegionalPrice } = await import("./estimateEngine");

  for (const item of lineItems) {
    const qty = item.quantity || 0;
    const rcvTotal = item.totalPrice || 0;
    let laborTotal: number;
    let material: number;
    let tax: number;
    let laborHours: number;

    if (item.xactCode) {
      let regionalPrice = await getRegionalPrice(item.xactCode, "FLFM8X_NOV22", "install");
      if (!regionalPrice) regionalPrice = await getRegionalPrice(item.xactCode, "US_NATIONAL", "install");
      if (regionalPrice) {
        const wasteFactor = item.wasteFactor || 0;
        const matCost = Number(regionalPrice.materialCost || 0) * (1 + wasteFactor / 100) * qty;
        const labCost = Number(regionalPrice.laborCost || 0) * qty;
        const equipCost = Number(regionalPrice.equipmentCost || 0) * qty;
        material = Math.round(matCost * 100) / 100;
        laborTotal = Math.round(labCost * 100) / 100;
        tax = Math.round(material * 0.08 * 100) / 100;
        laborHours = Math.round((laborTotal / 75) * 100) / 100;
      } else {
        laborTotal = Math.round(rcvTotal * 0.35 * 100) / 100;
        material = Math.round(rcvTotal * 0.65 * 100) / 100;
        tax = Math.round(material * 0.08 * 100) / 100;
        laborHours = Math.round((laborTotal / 75) * 100) / 100;
      }
    } else {
      laborTotal = Math.round(rcvTotal * 0.35 * 100) / 100;
      material = Math.round(rcvTotal * 0.65 * 100) / 100;
      tax = Math.round(material * 0.08 * 100) / 100;
      laborHours = Math.round((laborTotal / 75) * 100) / 100;
    }

    const acvTotal = Math.round(rcvTotal * 0.85 * 100) / 100;

    lineItemsXML.push({
      id: item.id,
      description: item.description,
      category: item.category,
      action: item.action || "R",
      quantity: qty,
      unit: item.unit || "EA",
      unitPrice: item.unitPrice || 0,
      laborTotal,
      laborHours,
      material,
      tax,
      acvTotal,
      rcvTotal,
      room: rooms.find((r: any) => r.id === item.roomId)?.name || "Unassigned",
      provenance: item.provenance,
    });
  }

  const summary = {
    totalRCV: lineItemsXML.reduce((sum, i) => sum + i.rcvTotal, 0),
    totalACV: lineItemsXML.reduce((sum, i) => sum + i.acvTotal, 0),
    totalDepreciation: lineItemsXML.reduce((sum, i) => sum + (i.rcvTotal - i.acvTotal), 0),
  };

  // Generate XACTDOC.XML
  const xactdocXml = generateXactdoc(claim, summary, lineItemsXML, isSupplemental, supplementalReason, briefing);

  // Generate GENERIC_ROUGHDRAFT.XML
  const roughdraftXml = generateRoughDraft(rooms, lineItemsXML, lineItems, openings || []);

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

function generateXactdoc(claim: any, summary: any, lineItems: LineItemXML[], isSupplemental?: boolean, supplementalReason?: string, briefing?: any): string {
  const transactionId = `CLAIMSIQ-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const estimateType = isSupplemental ? 'SUPPLEMENT' : 'ESTIMATE';

  let notesSection = '';
  if (isSupplemental) {
    notesSection = `
  <NOTES>
    <NOTE type="SUPPLEMENTAL" date="${new Date().toISOString().split('T')[0]}">
      <TEXT>${escapeXml(supplementalReason || 'Supplemental claim')}</TEXT>
    </NOTE>
  </NOTES>`;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<XACTDOC>
  <XACTNET_INFO>
    <transactionId>${transactionId}</transactionId>
    <carrierId>CLAIMSIQ</carrierId>
    <carrierName>Claims IQ</carrierName>
    <CONTROL_POINTS>
      <CONTROL_POINT name="ASSIGNMENT" status="COMPLETE"/>
      <CONTROL_POINT name="${estimateType}" status="COMPLETE"/>
    </CONTROL_POINTS>
    <SUMMARY>
      <totalRCV>${summary.totalRCV.toFixed(2)}</totalRCV>
      <totalACV>${summary.totalACV.toFixed(2)}</totalACV>
      <totalDepreciation>${summary.totalDepreciation.toFixed(2)}</totalDepreciation>
      <deductible>${(briefing?.coverageSnapshot?.deductible || 0).toFixed ? (briefing?.coverageSnapshot?.deductible || 0).toFixed(2) : "0.00"}</deductible>
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
      <policyNumber>${escapeXml(briefing?.coverageSnapshot?.policyNumber || claim?.policyNumber || "")}</policyNumber>
    </COVERAGE_LOSS>
    <PARAMS>
      <priceList>USNATNL</priceList>
      <laborEfficiency>100</laborEfficiency>
      <depreciationType>${claim?.perilType === "water" ? "Recoverable" : "Standard"}</depreciationType>
    </PARAMS>
  </ADM>${notesSection}
</XACTDOC>`;
}

function generateRoughDraft(rooms: any[], lineItems: LineItemXML[], originalItems: any[], openings: any[] = []): string {
  const roomGroups: { [key: string]: LineItemXML[] } = {};
  lineItems.forEach((item) => {
    const roomKey = item.room || "Unassigned";
    if (!roomGroups[roomKey]) roomGroups[roomKey] = [];
    roomGroups[roomKey].push(item);
  });

  let subroomsXml = "";
  let itemGroupsXml = "";

  Object.entries(roomGroups).forEach(([roomName, roomItems]) => {
    const room = rooms.find((r) => r.name === roomName);
    const dims: RoomDimensions = {
      length: room?.dimensions?.length || 10,
      width: room?.dimensions?.width || 10,
      height: room?.dimensions?.height || 8,
      elevationType: room?.roomType?.includes("elevation") ? "elevation" : "box",
    };

    const roomOpeningsList: OpeningData[] = (room ? openings.filter((o: any) => o.roomId === room.id) : []).map((o: any) => ({
      openingType: o.openingType,
      widthFt: o.widthFt || o.width || 0,
      heightFt: o.heightFt || o.height || 0,
      quantity: o.quantity || 1,
      opensInto: o.opensInto || null,
      goesToFloor: o.goesToFloor || false,
      goesToCeiling: o.goesToCeiling || false,
    }));

    subroomsXml += generateSubroomXml(roomName, dims, roomOpeningsList) + "\n";

    const isSketchRoom = room?.roomType?.startsWith("exterior_");
    itemGroupsXml += `        <GROUP type="room" name="${escapeXml(roomName)}"${isSketchRoom ? ' source="Sketch" isRoom="1"' : ""}>\n`;
    itemGroupsXml += `          <ITEMS>\n`;

    const tradeToCategory: Record<string, string> = {
      MIT: "WTR", DEM: "DEM", DRY: "DRY", PNT: "PNT", FLR: "FLR",
      INS: "INS", CAR: "FRM", CAB: "CAB", CTR: "CTR", RFG: "RFG",
      WIN: "WIN", EXT: "SDG", ELE: "ELE", PLM: "PLM", HVAC: "HVA", GEN: "GEN",
    };
    const actionToAct: Record<string, string> = {
      "R&R": "&", "Detach & Reset": "O", "Repair": "R", "Paint": "P",
      "Clean": "C", "Tear Off": "-", "Labor Only": "L", "Install": "+",
    };

    roomItems.forEach((item, idx) => {
      const origItem = originalItems.find((oi: any) => oi.id === item.id);
      const tradeCode = origItem?.tradeCode || "";
      const category = tradeToCategory[tradeCode] || item.category.substring(0, 3).toUpperCase();
      const act = item.provenance === "supplemental_new" ? "ADD" :
        item.provenance === "supplemental_modified" ? "MOD" :
        actionToAct[item.action] || "&";
      const selector = origItem?.xactCode ? String(origItem.xactCode).split("-").slice(-1)[0] || "1/2++" : "1/2++";

      itemGroupsXml += `            <ITEM lineNum="${idx + 1}" cat="${escapeXml(category)}" sel="${escapeXml(selector)}" act="${escapeXml(act)}" desc="${escapeXml(item.description)}" qty="${item.quantity.toFixed(2)}" unit="${escapeXml(item.unit)}" remove="0" replace="${item.rcvTotal.toFixed(2)}" total="${item.rcvTotal.toFixed(2)}" laborTotal="${item.laborTotal.toFixed(2)}" laborHours="${item.laborHours.toFixed(2)}" material="${item.material.toFixed(2)}" tax="${item.tax.toFixed(2)}" acvTotal="${item.acvTotal.toFixed(2)}" rcvTotal="${item.rcvTotal.toFixed(2)}"/>\n`;
    });

    itemGroupsXml += `          </ITEMS>\n`;
    itemGroupsXml += `        </GROUP>\n`;
  });

  return `<?xml version="1.0" encoding="UTF-8"?>
<GENERIC_ROUGHDRAFT>
  <DIM>
${subroomsXml}
  </DIM>
  <LINE_ITEM_DETAIL>
    <GROUP type="estimate" name="Estimate">
      <GROUP type="level" name="HOUSE">
        <GROUP type="sublevel" name="EXTERIOR">
${itemGroupsXml}
        </GROUP>
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
