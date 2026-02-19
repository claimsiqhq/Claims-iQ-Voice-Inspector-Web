import archiver from "archiver";
import { IStorage } from "./storage";
import {
  generateSubroomXml,
  type RoomDimensions, type OpeningData
} from "./estimateEngine";
import type { SettlementRules } from "./settlementRules";
import { getDefaultSettlementRules } from "./settlementRules";
import { resolveCategory } from "./tradeCodeMapping";
import type { XactdocMetadata } from "./xactdocMetadata";

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
  equipment: number;
  tax: number;
  acvTotal: number;
  rcvTotal: number;
  depreciationPercentage?: number;
  depreciationAmount?: number;
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
  /** Optional settlement rules for consistent tax/labor calculation */
  settlementRules?: SettlementRules;
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

  const { resolveSettlementRules } = await import("./settlementRules");
  const settlementRules = await resolveSettlementRules(
    String(session.claimId),
    (claim as { carrierCode?: string }).carrierCode ?? null
  );

  return generateESXFromData({
    claim,
    session,
    rooms,
    lineItems: items,
    briefing,
    openings,
    settlementRules,
  });
}

/**
 * Generates ESX from pre-built data — used by both full export and supplemental delta export.
 * Accepts optional settlementRules for consistent tax rates and labor treatment.
 */
export async function generateESXFromData(options: ESXOptions): Promise<Buffer> {
  const {
    claim,
    session,
    rooms,
    lineItems,
    briefing,
    openings,
    isSupplemental,
    supplementalReason,
    removedItemIds,
    settlementRules,
  } = options;

  const rules = settlementRules ?? getDefaultSettlementRules();
  const laborRatePerHour = claim?.laborRatePerHour ?? 75;
  const priceListId = claim?.regionalPriceListId ?? "FLFM8X_NOV22";

  const lineItemsXML: LineItemXML[] = [];
  const { getRegionalPrice } = await import("./estimateEngine");
  const { resolveMLE, applyMLEToPrice } = await import("./mleSplitService");
  const { calculateDepreciation } = await import("./depreciationEngine");

  for (const item of lineItems) {
    const qty = Number(item.quantity) || 0;
    const rcvTotal = Number(item.totalPrice) || 0;
    let laborTotal: number;
    let material: number;
    let equipment = 0;
    let tax: number;
    let laborHours: number;
    let depreciationPercentage = 0;
    let depreciationAmount = 0;

    const mleSplit = await resolveMLE({
      xactCode: item.xactCode,
      category: item.category || item.tradeCode,
      priceListId,
      activityType: "install",
      getRegionalPrice,
    });

    if (item.xactCode) {
      let regionalPrice = await getRegionalPrice(item.xactCode, priceListId, "install");
      if (!regionalPrice) regionalPrice = await getRegionalPrice(item.xactCode, "US_NATIONAL", "install");

      if (regionalPrice) {
        const wasteFactor = Number(item.wasteFactor) || 0;
        const matCost = Number(regionalPrice.materialCost || 0) * (1 + wasteFactor / 100) * qty;
        const labCost = Number(regionalPrice.laborCost || 0) * qty;
        const equipCost = Number(regionalPrice.equipmentCost || 0) * qty;

        material = Math.round(matCost * 100) / 100;
        laborTotal = Math.round(labCost * 100) / 100;
        equipment = Math.round(equipCost * 100) / 100;
        const taxBase = rules.taxOnLabor ? material + laborTotal + equipment : material;
        tax = Math.round(taxBase * (rules.defaultTaxRate / 100) * 100) / 100;
        laborHours = Math.round((laborTotal / laborRatePerHour) * 100) / 100;
      } else {
        const mlePrices = applyMLEToPrice(rcvTotal, mleSplit);
        material = mlePrices.material;
        laborTotal = mlePrices.labor;
        equipment = mlePrices.equipment;
        const taxBase = rules.taxOnLabor ? material + laborTotal + equipment : material;
        tax = Math.round(taxBase * (rules.defaultTaxRate / 100) * 100) / 100;
        laborHours = Math.round((laborTotal / laborRatePerHour) * 100) / 100;
      }
    } else {
      const mlePrices = applyMLEToPrice(rcvTotal, mleSplit);
      material = mlePrices.material;
      laborTotal = mlePrices.labor;
      equipment = mlePrices.equipment;
      const taxBase = rules.taxOnLabor ? material + laborTotal + equipment : material;
      tax = Math.round(taxBase * (rules.defaultTaxRate / 100) * 100) / 100;
      laborHours = Math.round((laborTotal / laborRatePerHour) * 100) / 100;
    }

    if (rules.laborEfficiency < 100) {
      laborHours = Math.round((laborHours * (rules.laborEfficiency / 100)) * 100) / 100;
    }

    const waterClass = session?.waterClassification as
      | { category?: number; waterClass?: number }
      | undefined;

    const depResult = calculateDepreciation({
      totalPrice: rcvTotal,
      age: item.age ?? item.itemAge ?? session?.yearsAfterLoss,
      lifeExpectancy: item.lifeExpectancy,
      category: item.category || item.tradeCode,
      description: item.description,
      depreciationType: claim?.depreciationType ?? "Standard",
      tradeCode: item.tradeCode,
      waterClassification: waterClass,
    });
    depreciationPercentage = depResult.depreciationPercentage;
    depreciationAmount = depResult.depreciationAmount;

    if (claim?.perilType === "water" && item.damageType === "saturated") {
      depreciationPercentage = 0;
      depreciationAmount = 0;
    }

    const acvTotal = Math.round((rcvTotal - depreciationAmount) * 100) / 100;

    lineItemsXML.push({
      id: item.id,
      description: item.description,
      category: item.category,
      action: item.action || "R",
      quantity: qty,
      unit: item.unit || "EA",
      unitPrice: Number(item.unitPrice) || 0,
      laborTotal,
      laborHours,
      material,
      equipment,
      tax,
      acvTotal,
      rcvTotal,
      depreciationPercentage,
      depreciationAmount,
      room: rooms.find((r: any) => r.id === item.roomId)?.name || "Unassigned",
      provenance: item.provenance,
    });
  }

  const summary = {
    totalRCV: lineItemsXML.reduce((sum, i) => sum + i.rcvTotal, 0),
    totalACV: lineItemsXML.reduce((sum, i) => sum + i.acvTotal, 0),
    totalDepreciation: lineItemsXML.reduce((sum, i) => sum + (i.depreciationAmount ?? 0), 0),
  };

  const { buildXactdocMetadata } = await import("./xactdocMetadata");
  const { validateESXData } = await import("./esxValidator");

  const metadata = buildXactdocMetadata({
    claim,
    session: session ?? {},
    briefing,
    lineItemsXML,
    isSupplemental,
    supplementalReason,
  });

  const validation = validateESXData({ lineItems: lineItemsXML, metadata, claim });
  if (!validation.isValid) {
    const msg = validation.errors.map((e) => `${e.field}: ${e.message}`).join("; ");
    throw new Error(`ESX validation failed: ${msg}`);
  }

  // Generate XACTDOC.XML
  const xactdocXml = generateXactdocFromMetadata(metadata, isSupplemental, supplementalReason);

  // Generate GENERIC_ROUGHDRAFT.XML
  const roughdraftXml = generateRoughDraft(rooms, lineItemsXML, lineItems, openings || [], claim);

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

function generateXactdocFromMetadata(
  metadata: XactdocMetadata,
  isSupplemental?: boolean,
  supplementalReason?: string
): string {
  const perilXml = `
  <PERIL>
    <type>${escapeXml(metadata.peril.type)}</type>
    <severity>${escapeXml(metadata.peril.severity)}</severity>
    <dateOfLoss>${metadata.peril.dateOfLoss}</dateOfLoss>
    <dateDiscovered>${metadata.peril.dateDiscovered || metadata.peril.dateOfLoss}</dateDiscovered>
    <dateReported>${metadata.peril.dateReported || new Date().toISOString().split("T")[0]}</dateReported>
    <affectedAreas>
      ${(metadata.peril.affectedAreas || []).map((area: string) => `<area>${escapeXml(area)}</area>`).join("\n      ")}
    </affectedAreas>
  </PERIL>`;

  const lossLocationXml = `
  <LOSS_LOCATION>
    <address>${escapeXml(metadata.lossLocation.propertyAddress)}</address>
    <city>${escapeXml(metadata.lossLocation.city)}</city>
    <state>${metadata.lossLocation.state}</state>
    <zip>${metadata.lossLocation.zip}</zip>
    <county>${escapeXml(metadata.lossLocation.county || "")}</county>
    <propertyType>${escapeXml(metadata.lossLocation.propertyType)}</propertyType>
    <yearBuilt>${metadata.lossLocation.yearBuilt ?? ""}</yearBuilt>
    <squareFootage>${metadata.lossLocation.squareFootage ?? ""}</squareFootage>
    ${metadata.lossLocation.latitude != null ? `<latitude>${metadata.lossLocation.latitude}</latitude>` : ""}
    ${metadata.lossLocation.longitude != null ? `<longitude>${metadata.lossLocation.longitude}</longitude>` : ""}
  </LOSS_LOCATION>`;

  const lossDetailsXml = `
  <LOSS_DETAILS>
    <causeOfLoss>${escapeXml(metadata.lossDetails.causeOfLoss)}</causeOfLoss>
    <catastrophicIndicator>${metadata.lossDetails.catastrophicIndicator ? "true" : "false"}</catastrophicIndicator>
    <salvageOpportunity>${metadata.lossDetails.salvageOpportunity ? "true" : "false"}</salvageOpportunity>
  </LOSS_DETAILS>`;

  const coverageXml = `
  <COVERAGE>
    <coverageALimit>${metadata.coverage.coverageALimit.toFixed(2)}</coverageALimit>
    <coverageBLimit>${metadata.coverage.coverageBLimit.toFixed(2)}</coverageBLimit>
    <coverageCLimit>${metadata.coverage.coverageCLimit.toFixed(2)}</coverageCLimit>
    <coverageDLimit>${metadata.coverage.coverageDLimit.toFixed(2)}</coverageDLimit>
    <coverageELimit>${metadata.coverage.coverageELimit.toFixed(2)}</coverageELimit>
    <coverageFLimit>${metadata.coverage.coverageFLimit.toFixed(2)}</coverageFLimit>
    <deductibleType>${escapeXml(metadata.coverage.deductibleType)}</deductibleType>
    <deductibleAmount>${metadata.coverage.deductibleAmount.toFixed(2)}</deductibleAmount>
    <coinsurancePercentage>${metadata.coverage.coinsurancePercentage}</coinsurancePercentage>
  </COVERAGE>`;

  const roofInfoXml = metadata.roofInfo
    ? `
  <ROOF_INFO>
    <roofType>${escapeXml(metadata.roofInfo.roofType)}</roofType>
    <roofAge>${metadata.roofInfo.roofAge}</roofAge>
    <roofMaterial>${escapeXml(metadata.roofInfo.roofMaterial)}</roofMaterial>
    <roofSlope>${escapeXml(metadata.roofInfo.roofSlope)}</roofSlope>
    <squareFootage>${metadata.roofInfo.squareFootage}</squareFootage>
    <condition>${escapeXml(metadata.roofInfo.condition)}</condition>
  </ROOF_INFO>`
    : "";

  const adjusterInfoXml = `
  <ADJUSTER_INFO>
    <name>${escapeXml(metadata.adjusterInfo.name)}</name>
    <company>${escapeXml(metadata.adjusterInfo.company)}</company>
    <licenseNumber>${escapeXml(metadata.adjusterInfo.licenseNumber || "")}</licenseNumber>
    <licenseState>${escapeXml(metadata.adjusterInfo.licenseState || "")}</licenseState>
    <phoneNumber>${escapeXml(metadata.adjusterInfo.phoneNumber || "")}</phoneNumber>
    <email>${escapeXml(metadata.adjusterInfo.email || "")}</email>
  </ADJUSTER_INFO>`;

  const contactsXml = `
  <CONTACTS>
    <CONTACT type="INSURED">
      <name>${escapeXml(metadata.insuredInfo.name)}</name>
      <address>${escapeXml(metadata.insuredInfo.address)}</address>
      <city>${escapeXml(metadata.insuredInfo.city)}</city>
      <state>${metadata.insuredInfo.state}</state>
      <zip>${metadata.insuredInfo.zip}</zip>
      <homePhone>${escapeXml(metadata.insuredInfo.homePhone || "")}</homePhone>
      <cellPhone>${escapeXml(metadata.insuredInfo.cellPhone || "")}</cellPhone>
      <email>${escapeXml(metadata.insuredInfo.email || "")}</email>
    </CONTACT>
    <CONTACT type="ADJUSTER">
      <name>${escapeXml(metadata.adjusterInfo.name)}</name>
      <company>${escapeXml(metadata.adjusterInfo.company)}</company>
      <email>${escapeXml(metadata.adjusterInfo.email || "")}</email>
    </CONTACT>
    <CONTACT type="INSPECTOR">
      <name>${escapeXml(metadata.inspectorInfo.name)}</name>
      <company>${escapeXml(metadata.inspectorInfo.company)}</company>
      <inspectionDate>${metadata.inspectorInfo.inspectionDate}</inspectionDate>
      <email>${escapeXml(metadata.inspectorInfo.email || "")}</email>
    </CONTACT>
  </CONTACTS>`;

  let notesSection = "";
  if (isSupplemental) {
    notesSection = `
  <NOTES>
    <NOTE type="SUPPLEMENTAL" date="${new Date().toISOString().split("T")[0]}">
      <TEXT>${escapeXml(supplementalReason || "Supplemental claim")}</TEXT>
    </NOTE>
  </NOTES>`;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<XACTDOC>
  <XACTNET_INFO>
    <transactionId>${metadata.transactionId}</transactionId>
    <carrierId>CLAIMSIQ</carrierId>
    <carrierName>${escapeXml(metadata.carrierName)}</carrierName>
    <CONTROL_POINTS>
      <CONTROL_POINT name="ASSIGNMENT" status="COMPLETE"/>
      <CONTROL_POINT name="${metadata.estimateType}" status="COMPLETE"/>
    </CONTROL_POINTS>
    <SUMMARY>
      <totalRCV>${metadata.summary.totalRCV.toFixed(2)}</totalRCV>
      <totalACV>${metadata.summary.totalACV.toFixed(2)}</totalACV>
      <totalDepreciation>${metadata.summary.totalDepreciation.toFixed(2)}</totalDepreciation>
      <totalMaterial>${metadata.summary.totalMaterial.toFixed(2)}</totalMaterial>
      <totalLabor>${metadata.summary.totalLabor.toFixed(2)}</totalLabor>
      <totalEquipment>${metadata.summary.totalEquipment.toFixed(2)}</totalEquipment>
      <deductible>${metadata.coverage.deductibleAmount.toFixed(2)}</deductible>
      <lineItemCount>${metadata.summary.lineItemCount}</lineItemCount>
    </SUMMARY>
  </XACTNET_INFO>
${contactsXml}
  <ADM>
    <dateOfLoss>${metadata.peril.dateOfLoss}</dateOfLoss>
    <dateInspected>${new Date().toISOString().split("T")[0]}</dateInspected>
    <COVERAGE_LOSS>
      <claimNumber>${escapeXml(metadata.claimNumber)}</claimNumber>
      <policyNumber>${escapeXml(metadata.policyNumber)}</policyNumber>
    </COVERAGE_LOSS>
    <PARAMS>
      <priceList>${escapeXml(metadata.priceListId)}</priceList>
      <laborEfficiency>${metadata.laborEfficiency}</laborEfficiency>
      <depreciationType>${escapeXml(metadata.depreciationType)}</depreciationType>
    </PARAMS>
  </ADM>
${perilXml}
${lossLocationXml}
${lossDetailsXml}
${coverageXml}
${roofInfoXml}
${adjusterInfoXml}
${notesSection}
</XACTDOC>`;
}

function generateRoughDraft(rooms: any[], lineItems: LineItemXML[], originalItems: any[], openings: any[] = [], claim?: any): string {
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

    const perilType = claim?.perilType;
    const actionToAct: Record<string, string> = {
      "R&R": "&", "Detach & Reset": "O", "Repair": "R", "Paint": "P",
      "Clean": "C", "Tear Off": "-", "Labor Only": "L", "Install": "+",
    };

    roomItems.forEach((item, idx) => {
      const origItem = originalItems.find((oi: any) => oi.id === item.id);
      const tradeCode = origItem?.tradeCode || "";
      const category = resolveCategory(tradeCode, perilType) || (item.category || "").substring(0, 3).toUpperCase() || "GEN";
      const act = item.provenance === "supplemental_new" ? "ADD" :
        item.provenance === "supplemental_modified" ? "MOD" :
        actionToAct[item.action] || "&";
      const selector = origItem?.xactCode ? String(origItem.xactCode).split("-").slice(-1)[0] || "1/2++" : "1/2++";

      itemGroupsXml += `            <ITEM lineNum="${idx + 1}" cat="${escapeXml(category)}" sel="${escapeXml(selector)}" act="${escapeXml(act)}" desc="${escapeXml(item.description)}" qty="${item.quantity.toFixed(2)}" unit="${escapeXml(item.unit)}" remove="0" replace="${item.rcvTotal.toFixed(2)}" total="${item.rcvTotal.toFixed(2)}" laborTotal="${item.laborTotal.toFixed(2)}" laborHours="${item.laborHours.toFixed(2)}" material="${item.material.toFixed(2)}" equipment="${(item.equipment ?? 0).toFixed(2)}" tax="${item.tax.toFixed(2)}" acvTotal="${item.acvTotal.toFixed(2)}" rcvTotal="${item.rcvTotal.toFixed(2)}" depreciationPct="${(item.depreciationPercentage ?? 0).toFixed(2)}" depreciationAmt="${(item.depreciationAmount ?? 0).toFixed(2)}"/>\n`;
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
