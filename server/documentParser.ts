import pdfParse from "pdf-parse";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

async function callOpenAI(prompt: string, pdfText: string): Promise<any> {
  if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY not configured");

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o",
      messages: [
        { role: "system", content: prompt },
        { role: "user", content: pdfText.substring(0, 30000) },
      ],
      response_format: { type: "json_object" },
      temperature: 0.1,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI API error: ${err}`);
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("Empty OpenAI response");
  return JSON.parse(content);
}

export async function extractFNOL(pdfBuffer: Buffer): Promise<{ extractedData: any; confidence: any }> {
  const { text } = await pdfParse(pdfBuffer);

  const extractedData = await callOpenAI(
    `You are an insurance document parser. Extract the following fields from this FNOL (First Notice of Loss) document. Return a JSON object with these fields and a separate "confidence" object with "high", "medium", or "low" for each field.

Fields to extract:
- claimNumber: The claim/loss number
- dateOfLoss: Date the loss occurred (YYYY-MM-DD)
- dateReported: Date the loss was reported
- insuredName: Full name of the insured
- propertyAddress: Full street address
- city, state, zip: Location components
- lossDescription: Description of what happened
- perilType: Type of peril (hail, wind, water, fire, etc.)
- reportedBy: Who reported the claim
- contactPhone: Contact phone number
- contactEmail: Contact email
- propertyType: Type of property (single family, condo, etc.)
- yearBuilt: Year the property was built
- numberOfStories: Number of stories
- roofType: Roof material type
- estimatedDamage: Estimated damage amount if mentioned

Return format: { "data": { ...fields }, "confidence": { ...fieldName: "high"|"medium"|"low" } }`,
    text
  );

  return {
    extractedData: extractedData.data || extractedData,
    confidence: extractedData.confidence || {},
  };
}

export async function extractPolicy(pdfBuffer: Buffer): Promise<{ extractedData: any; confidence: any }> {
  const { text } = await pdfParse(pdfBuffer);

  const extractedData = await callOpenAI(
    `You are an insurance policy parser. Extract coverage and policy details from this insurance policy document. Return JSON.

Fields to extract:
- policyNumber: Policy number
- effectiveDate: Policy start date
- expirationDate: Policy end date
- insuredName: Named insured
- propertyAddress: Insured property address
- coverage: Object with:
  - coverageA: { limit: number, description: "Dwelling" }
  - coverageB: { limit: number, description: "Other Structures" }
  - coverageC: { limit: number, description: "Personal Property" }
  - coverageD: { limit: number, description: "Loss of Use" }
- deductible: Dollar amount of deductible
- windHailDeductible: Separate wind/hail deductible if any
- roofSchedule: Whether actual cash value (ACV) or replacement cost applies to roof
- applyRoofSchedule: true if roof has ACV schedule (depreciation is non-recoverable)
- overheadAndProfit: Whether O&P is allowed
- taxRate: Applicable tax rate percentage
- mortgagee: Name of mortgage company if listed
- agent: Insurance agent name/agency

Return format: { "data": { ...fields }, "confidence": { ...fieldName: "high"|"medium"|"low" } }`,
    text
  );

  return {
    extractedData: extractedData.data || extractedData,
    confidence: extractedData.confidence || {},
  };
}

export async function extractEndorsements(pdfBuffer: Buffer): Promise<{ extractedData: any; confidence: any }> {
  const { text } = await pdfParse(pdfBuffer);

  const extractedData = await callOpenAI(
    `You are an insurance endorsement parser. Extract all endorsements and their impacts from this document. Return JSON.

For each endorsement found, extract:
- endorsementNumber: The form number
- title: Endorsement title
- description: What it does
- impact: How it affects coverage (increases limit, excludes coverage, adds coverage, modifies deductible, etc.)
- affectedCoverage: Which coverage it modifies (A, B, C, D, or "all")
- limitChange: Any dollar amount change to limits
- deductibleChange: Any change to deductible

Return format: { "data": { "endorsements": [...], "impacts": [...summary impacts] }, "confidence": { "overall": "high"|"medium"|"low" } }`,
    text
  );

  return {
    extractedData: extractedData.data || extractedData,
    confidence: extractedData.confidence || {},
  };
}

export async function parsePdfBuffer(pdfBuffer: Buffer, documentType: string): Promise<{ extractedData: any; confidence: any }> {
  switch (documentType) {
    case "fnol": return extractFNOL(pdfBuffer);
    case "policy": return extractPolicy(pdfBuffer);
    case "endorsements": return extractEndorsements(pdfBuffer);
    default: throw new Error(`Unknown document type: ${documentType}`);
  }
}
