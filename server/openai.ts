import OpenAI from "openai";

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
  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      {
        role: "system",
        content: `You are a claims document parser for an insurance inspection platform.
Extract structured data from this First Notice of Loss (FNOL) document.

Return a JSON object with these fields:
{
  "claimNumber": string,
  "insuredName": string,
  "propertyAddress": { "street": string, "city": string, "state": string, "zip": string },
  "dateOfLoss": string (ISO date),
  "perilType": "hail" | "wind" | "water" | "fire" | "freeze" | "multi",
  "reportedDamage": string,
  "propertyType": "single_family" | "townhouse" | "condo" | "multi_family",
  "yearBuilt": number | null,
  "stories": number | null,
  "squareFootage": number | null,
  "confidence": {
    [field]: "high" | "medium" | "low"
  }
}
If a field cannot be determined, set to null with confidence "low".
Return ONLY valid JSON.`,
      },
      { role: "user", content: rawText },
    ],
    temperature: 0.1,
    max_tokens: 2000,
  });

  const parsed = parseJsonResponse(response.choices[0].message.content || "{}");
  const confidence = parsed.confidence || {};
  delete parsed.confidence;
  return { extractedData: parsed, confidence };
}

export async function extractPolicy(rawText: string): Promise<{ extractedData: any; confidence: any }> {
  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      {
        role: "system",
        content: `You are a claims document parser for an insurance inspection platform.
Extract structured data from this Homeowner Insurance Policy (HO 80 03 or similar).

Return a JSON object with these fields:
{
  "policyNumber": string,
  "policyType": string,
  "coverageA": number,
  "coverageB": number,
  "coverageC": number,
  "coverageD": number,
  "coverageE": number | null,
  "coverageF": number | null,
  "deductible": { "amount": number, "type": "flat" | "percentage" | "wind_hail_specific", "windHailDeductible": number | null },
  "lossSettlement": "replacement_cost" | "actual_cash_value" | "functional_replacement",
  "constructionType": string,
  "roofType": string | null,
  "yearBuilt": number | null,
  "specialConditions": string[] | null,
  "confidence": { [field]: "high" | "medium" | "low" }
}
Return ONLY valid JSON.`,
      },
      { role: "user", content: rawText },
    ],
    temperature: 0.1,
    max_tokens: 2000,
  });

  const parsed = parseJsonResponse(response.choices[0].message.content || "{}");
  const confidence = parsed.confidence || {};
  delete parsed.confidence;
  return { extractedData: parsed, confidence };
}

export async function extractEndorsements(rawText: string): Promise<{ extractedData: any; confidence: any }> {
  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      {
        role: "system",
        content: `You are a claims document parser for an insurance inspection platform.
Extract all endorsements from this insurance policy endorsements document.

Return a JSON object:
{
  "endorsements": [
    {
      "endorsementId": string (e.g., "HO 88 02"),
      "title": string,
      "whatItModifies": string,
      "effectiveDate": string | null,
      "keyProvisions": string[],
      "sublimits": [{ "description": string, "amount": number }] | null,
      "claimImpact": string
    }
  ],
  "totalEndorsements": number,
  "confidence": "high" | "medium" | "low"
}

Common endorsements: HO 88 02 (Roof Surfaces), HO 81 17 (Water Back-Up), HO 86 05 (Ordinance/Law), HO 82 33 (Mine Subsidence), HO 84 19 (Personal Property RCV).
Return ONLY valid JSON.`,
      },
      { role: "user", content: rawText },
    ],
    temperature: 0.1,
    max_tokens: 3000,
  });

  const parsed = parseJsonResponse(response.choices[0].message.content || "{}");
  const confidence = parsed.confidence || "medium";
  delete parsed.confidence;
  return { extractedData: parsed, confidence: { overall: confidence } };
}

export async function generateBriefing(
  fnolData: any,
  policyData: any,
  endorsementsData: any
): Promise<any> {
  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      {
        role: "system",
        content: `You are an expert insurance claims analyst preparing an inspection briefing for a field adjuster.
Synthesize the FNOL, Policy, and Endorsements data into a comprehensive pre-inspection briefing.

Return a JSON object:
{
  "propertyProfile": {
    "address": string, "propertyType": string, "yearBuilt": number,
    "stories": number, "constructionType": string, "roofType": string,
    "squareFootage": number | null, "summary": string
  },
  "coverageSnapshot": {
    "coverageA": { "label": "Dwelling", "limit": number },
    "coverageB": { "label": "Other Structures", "limit": number },
    "coverageC": { "label": "Personal Property", "limit": number },
    "coverageD": { "label": "Loss of Use", "limit": number },
    "deductible": number, "deductibleType": string,
    "lossSettlement": string, "summary": string
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
    max_tokens: 4000,
  });

  return parseJsonResponse(response.choices[0].message.content || "{}");
}
