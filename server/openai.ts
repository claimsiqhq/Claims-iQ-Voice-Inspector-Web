import OpenAI from "openai";
import { logger } from "./logger";

if (!process.env.OPENAI_API_KEY) {
  logger.warn("OpenAI", "OPENAI_API_KEY is not set. AI features will return default values.");
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

function parseJsonResponse(text: string): any {
  try {
    const cleaned = text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
    return JSON.parse(cleaned);
  } catch (e) {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    throw new Error("Failed to parse AI response as JSON");
  }
}

export async function extractFNOL(rawText: string): Promise<{ extractedData: any; confidence: any }> {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4.1",
      messages: [
        {
          role: "system",
          content: `You are a claims document parser for an insurance inspection platform.
Extract ALL structured data from this First Notice of Loss (FNOL) / Claim Information Report.

These reports are often comprehensive and contain claim details, insured contact info, property details, policy coverages, deductibles, endorsement lists, and more. Extract EVERYTHING available.

Return a JSON object with these fields:
{
  "claimNumber": string (include CAT code if present, e.g. "01-009-018332(CAT - PCS2540-2540)"),
  "catCode": string | null (e.g. "PCS2540-2540"),
  "claimStatus": string | null (e.g. "Open"),
  "operatingCompany": string | null (e.g. "American Family Insurance"),
  "dateOfLoss": string (ISO date),
  "timeOfLoss": string | null (e.g. "4:00 PM"),
  "policyNumber": string,
  "insuredName": string (primary policyholder),
  "insuredName2": string | null (secondary named insured),
  "propertyAddress": { "street": string, "city": string, "state": string, "zip": string },
  "contactInfo": {
    "homePhone": string | null,
    "mobilePhone": string | null,
    "primaryPhone": string | null (which phone is primary),
    "email": string | null
  },
  "perilType": "hail" | "wind" | "water" | "fire" | "freeze" | "multi",
  "reportedDamage": string (detailed summary of all reported damages),
  "damageAreas": string | null (e.g. "Exterior", "Interior", "Both"),
  "roofDamage": boolean | null,
  "propertyType": "single_family" | "townhouse" | "condo" | "multi_family",
  "yearBuilt": number | null,
  "yearRoofInstalled": number | null,
  "woodRoof": boolean | null,
  "stories": number | null,
  "squareFootage": number | null,
  "thirdPartyInterest": string | null (mortgagee/bank name, e.g. "NATIONAL BANK COLORADO ISAOA"),
  "producer": {
    "name": string | null,
    "address": string | null,
    "phone": string | null,
    "email": string | null
  } | null,
  "policyInfo": {
    "type": string | null (e.g. "Homeowners"),
    "status": string | null (e.g. "In force"),
    "inceptionDate": string | null
  },
  "deductibles": {
    "policyDeductible": number | null,
    "windHailDeductible": number | null,
    "windHailDeductibleType": "flat" | "percentage" | null,
    "windHailDeductiblePercentage": number | null (e.g. 1 for 1%)
  },
  "coverages": {
    "coverageA": { "label": "Dwelling", "limit": number | null, "valuationMethod": string | null },
    "coverageB": { "label": "Other Structures", "limit": number | null },
    "coverageC": { "label": "Personal Property", "limit": number | null, "limitPercentage": number | null },
    "coverageD": { "label": "Loss of Use", "limit": number | null },
    "coverageE": { "label": "Personal Liability", "limit": number | null },
    "coverageF": { "label": "Medical Expense", "limit": number | null }
  },
  "additionalCoverages": [
    { "name": string, "limit": number | null, "deductible": number | null, "details": string | null }
  ] | null,
  "endorsementList": [
    { "formNumber": string, "title": string }
  ] | null,
  "endorsementAlerts": string[] | null (any endorsement alerts highlighted in the report),
  "reportedBy": string | null,
  "reportedDate": string | null,
  "confidence": {
    [field]: "high" | "medium" | "low"
  }
}

IMPORTANT:
- Extract ALL coverage amounts including additional coverages like Ordinance/Law, Service Line, Sewer Back-Up, Hidden Water, Increased Dwelling Limit, etc.
- Extract the full endorsement list with form numbers and titles.
- For deductibles, distinguish between the general policy deductible and the wind/hail specific deductible.
- If the wind/hail deductible is listed with both a dollar amount and percentage, capture both.
- If a field cannot be determined, set to null with confidence "low".
Return ONLY valid JSON.`,
        },
        { role: "user", content: rawText },
      ],
      temperature: 0.1,
      max_tokens: 32000,
    });

    const parsed = parseJsonResponse(response.choices[0].message.content || "{}");
    const confidence = parsed.confidence || {};
    delete parsed.confidence;
    return { extractedData: parsed, confidence };
  } catch (error) {
    logger.error("OpenAI", "Error extracting FNOL data", error);
    return {
      extractedData: { insuredName: "", dateOfLoss: "", perilType: "", propertyAddress: "" },
      confidence: {},
    };
  }
}

export async function extractPolicy(rawText: string): Promise<{ extractedData: any; confidence: any }> {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4.1",
      messages: [
        {
          role: "system",
          content: `You are a claims document parser for an insurance inspection platform.
You will receive text from a homeowner insurance policy document. This may be:
- A Declarations page with specific coverage amounts and property details, OR
- A policy form (e.g. HO 80 03, HO 00 03) with terms, conditions, and coverage definitions.

Extract what is available. If coverage dollar amounts are not in the document (common with policy forms that only have terms/conditions), set them to null.

Return a JSON object with these fields:
{
  "policyFormNumber": string (e.g. "HO 80 03 01 14" — the form number printed at bottom of pages),
  "policyNumber": string | null (the actual policy number from declarations, if present),
  "policyType": string (e.g. "HO-3 Special Form", "Homeowners Form"),
  "coverageA": number | null (Dwelling limit in dollars from declarations),
  "coverageB": number | null (Other Structures limit),
  "coverageC": number | null (Personal Property limit),
  "coverageD": number | null (Loss of Use limit),
  "coverageE": number | null (Personal Liability limit),
  "coverageF": number | null (Medical Expense limit),
  "deductible": { "amount": number | null, "type": "flat" | "percentage" | "wind_hail_specific" | null, "windHailDeductible": number | null },
  "lossSettlement": "replacement_cost" | "actual_cash_value" | "functional_replacement" | null,
  "constructionType": string | null,
  "roofType": string | null,
  "yearBuilt": number | null,
  "namedPerils": string[] (list of covered perils from Section I Perils, e.g. ["Fire or Lightning", "Windstorm or Hail", "Explosion", ...]),
  "keyExclusions": string[] (important exclusions from Section I Exclusions, summarized briefly),
  "lossSettlementTerms": {
    "dwellingSettlement": string (how dwelling losses are settled — replacement cost, ACV, etc.),
    "personalPropertySettlement": string (how personal property losses are settled),
    "roofSettlement": string | null (any special roof settlement terms)
  },
  "dutiesAfterLoss": string[] (insured's duties after a loss from Section I Conditions),
  "specialConditions": string[] | null (notable conditions or provisions),
  "confidence": { [field]: "high" | "medium" | "low" }
}

IMPORTANT: Extract ALL available information. For a policy form document, the named perils, exclusions, loss settlement terms, and duties after loss are the most critical fields. Do not leave them empty.
Return ONLY valid JSON.`,
        },
        { role: "user", content: rawText },
      ],
      temperature: 0.1,
      max_tokens: 32000,
    });

    const parsed = parseJsonResponse(response.choices[0].message.content || "{}");
    const confidence = parsed.confidence || {};
    delete parsed.confidence;
    return { extractedData: parsed, confidence };
  } catch (error) {
    logger.error("OpenAI", "Error extracting policy data", error);
    return {
      extractedData: { policyNumber: "", coverageA: 0, coverageB: 0, deductible: 0 },
      confidence: {},
    };
  }
}

export async function extractEndorsements(rawText: string): Promise<{ extractedData: any; confidence: any }> {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4.1",
      messages: [
        {
          role: "system",
          content: `You are a claims document parser for an insurance inspection platform.
Extract ALL endorsements from this insurance policy endorsements document. The text may contain multiple endorsements concatenated together from separate PDFs.

For each endorsement, extract as much detail as possible. Pay special attention to:
- Roof Surface Payment Schedules (HO 88 02) — extract the full depreciation schedule by roof age and material type
- Amendatory Endorsements (HO 81 06) — extract modified definitions, exclusion changes, settlement modifications
- Water Back-Up endorsements (HO 81 17) — extract sublimits and coverage additions
- Ordinance or Law endorsements (HO 86 05) — extract coverage percentages
- Any endorsement that modifies how losses are settled, what is excluded, or what sublimits apply

Return a JSON object:
{
  "endorsements": [
    {
      "endorsementId": string (e.g. "HO 88 02 10 22"),
      "title": string,
      "formEdition": string | null (edition date like "10 22" or "12 23"),
      "whatItModifies": string (which sections/coverages it changes),
      "keyProvisions": string[] (detailed list of what it changes — be specific and thorough),
      "modifiedDefinitions": [{ "term": string, "change": string }] | null,
      "modifiedExclusions": [{ "exclusion": string, "change": string }] | null,
      "modifiedSettlement": string | null (how it changes loss settlement),
      "sublimits": [{ "description": string, "amount": number }] | null,
      "roofPaymentSchedule": {
        "hasSchedule": boolean,
        "materialTypes": string[],
        "maxAge": number,
        "summary": string
      } | null,
      "claimImpact": string (practical impact for a field adjuster handling a claim)
    }
  ],
  "totalEndorsements": number,
  "confidence": "high" | "medium" | "low"
}

IMPORTANT:
- Each separate endorsement form (identified by its form number like HO 88 02, HO 81 06) should be a separate entry.
- For roof payment schedules, summarize the depreciation tiers rather than listing every row.
- The claimImpact field should explain what the adjuster needs to know in plain language.
Return ONLY valid JSON.`,
        },
        { role: "user", content: rawText },
      ],
      temperature: 0.1,
      max_tokens: 32000,
    });

    const parsed = parseJsonResponse(response.choices[0].message.content || "{}");
    const confidence = parsed.confidence || "medium";
    delete parsed.confidence;
    return { extractedData: parsed, confidence: { overall: confidence } };
  } catch (error) {
    logger.error("OpenAI", "Error extracting endorsements data", error);
    return {
      extractedData: { endorsements: [] },
      confidence: { overall: "low" },
    };
  }
}

export async function generateBriefing(
  fnolData: any,
  policyData: any,
  endorsementsData: any
): Promise<any> {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4.1",
      messages: [
        {
          role: "system",
          content: `You are an expert insurance claims analyst preparing an inspection briefing for a field adjuster.
Synthesize the FNOL, Policy, and Endorsements data into a comprehensive pre-inspection briefing.

The policy data may come from a policy form (terms/conditions) rather than a declarations page, so coverage dollar amounts may be null. In that case, focus on the policy provisions, settlement terms, and exclusions rather than dollar limits.

Return a JSON object:
{
  "propertyProfile": {
    "address": string, "propertyType": string, "yearBuilt": number | null,
    "stories": number | null, "constructionType": string | null, "roofType": string | null,
    "squareFootage": number | null, "summary": string
  },
  "coverageSnapshot": {
    "coverageA": { "label": "Dwelling", "limit": number | null },
    "coverageB": { "label": "Other Structures", "limit": number | null },
    "coverageC": { "label": "Personal Property", "limit": number | null },
    "coverageD": { "label": "Loss of Use", "limit": number | null },
    "deductible": number | null, "deductibleType": string | null,
    "lossSettlement": string,
    "summary": string
  },
  "perilAnalysis": {
    "perilType": string,
    "whatToLookFor": string[],
    "inspectionPriorities": string[],
    "typicalDamagePatterns": string,
    "commonMistakes": string[]
  },
  "endorsementImpacts": [
    { "endorsementId": string, "title": string, "adjusterGuidance": string }
  ],
  "inspectionChecklist": {
    "exterior": string[], "roof": string[],
    "interior": string[], "systems": string[],
    "documentation": string[]
  },
  "dutiesAfterLoss": string[],
  "redFlags": string[]
}
Return ONLY valid JSON.`,
        },
        {
          role: "user",
          content: `Generate an inspection briefing from this claim data:

FNOL: ${JSON.stringify(fnolData)}
Policy: ${JSON.stringify(policyData)}
Endorsements: ${JSON.stringify(endorsementsData)}`,
        },
      ],
      temperature: 0.2,
      max_tokens: 32000,
    });

    return parseJsonResponse(response.choices[0].message.content || "{}");
  } catch (error) {
    logger.error("OpenAI", "Error generating briefing", error);
    return {
      propertyProfile: {},
      coverageSnapshot: {},
      perilAnalysis: {},
      endorsementImpacts: [],
      inspectionChecklist: {},
      dutiesAfterLoss: [],
      redFlags: [],
    };
  }
}

export async function analyzePhotoDamage(imageUrl: string): Promise<{
  summary: string;
  damageDetections: Array<{
    damageType: string;
    description: string;
    severity: "none" | "minor" | "moderate" | "severe" | "critical";
    confidence: number;
    bbox: { x: number; y: number; width: number; height: number };
    repairSuggestion: string;
  }>;
  overallSeverity: number;
  damageTypes: string[];
  suggestedRepairs: string[];
  propertyContext: string;
}> {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      max_tokens: 4096,
      messages: [
        {
          role: "system",
          content: `You are an expert insurance property damage analyst. Analyze the provided photo for any property damage.

For each damage area you detect, provide:
1. The type of damage (e.g., "hail damage", "water stain", "wind uplift", "cracking", "missing shingles", "mold", "fire damage", "structural damage", "rot/decay")
2. A detailed description of what you see
3. Severity rating: none, minor, moderate, severe, or critical
4. Confidence score 0-1 of your detection
5. A bounding box (normalized 0-1 coordinates relative to image dimensions) indicating WHERE in the image the damage is located: { x, y, width, height } where x,y is the top-left corner
6. A specific repair suggestion

Also provide:
- An overall severity score (1-10, where 1 = no damage, 10 = catastrophic)
- Property context (what type of surface/material/area you're looking at)
- A summary of all findings

Return JSON:
{
  "summary": "Brief overview of damage found",
  "damageDetections": [
    {
      "damageType": "type",
      "description": "detailed description",
      "severity": "minor|moderate|severe|critical",
      "confidence": 0.85,
      "bbox": { "x": 0.1, "y": 0.2, "width": 0.3, "height": 0.25 },
      "repairSuggestion": "specific repair action"
    }
  ],
  "overallSeverity": 5,
  "damageTypes": ["hail damage", "missing shingles"],
  "suggestedRepairs": ["Replace damaged shingles", "Apply sealant"],
  "propertyContext": "Asphalt shingle roof, approximately 15 years old"
}

If no damage is detected, return an empty damageDetections array with overallSeverity of 1 and a summary indicating no visible damage.`,
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Analyze this property photo for damage. Identify all visible damage areas with precise bounding box locations.",
            },
            {
              type: "image_url",
              image_url: {
                url: imageUrl,
                detail: "high",
              },
            },
          ],
        },
      ],
    });

    const text = response.choices[0]?.message?.content || "{}";
    const result = parseJsonResponse(text);

    return {
      summary: result.summary || "Analysis complete",
      damageDetections: result.damageDetections || [],
      overallSeverity: result.overallSeverity || 1,
      damageTypes: result.damageTypes || [],
      suggestedRepairs: result.suggestedRepairs || [],
      propertyContext: result.propertyContext || "Unknown",
    };
  } catch (error) {
    logger.error("OpenAI", "Error analyzing photo damage", error);
    throw new Error("Failed to analyze photo for damage");
  }
}
