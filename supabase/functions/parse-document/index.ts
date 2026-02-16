import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function parseJsonResponse(text: string): any {
  try {
    const cleaned = text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
    return JSON.parse(cleaned);
  } catch {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
    throw new Error("Failed to parse AI response as JSON");
  }
}

async function callOpenAI(systemPrompt: string, userContent: string): Promise<any> {
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) throw new Error("OPENAI_API_KEY not set");

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o",
      messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userContent.substring(0, 30000) }],
      temperature: 0.1,
      max_tokens: 3000,
    }),
  });
  if (!res.ok) throw new Error(`OpenAI error: ${await res.text()}`);
  const data = await res.json();
  return parseJsonResponse(data.choices?.[0]?.message?.content || "{}");
}

const FNOL_PROMPT = `You are a claims document parser for an insurance inspection platform.
Extract structured data from this First Notice of Loss (FNOL) document.
Return a JSON object with these fields:
{
  "claimNumber": string, "insuredName": string,
  "propertyAddress": { "street": string, "city": string, "state": string, "zip": string },
  "dateOfLoss": string (ISO date),
  "perilType": "hail" | "wind" | "water" | "fire" | "freeze" | "multi",
  "reportedDamage": string, "propertyType": "single_family" | "townhouse" | "condo" | "multi_family",
  "yearBuilt": number | null, "stories": number | null, "squareFootage": number | null,
  "confidence": { [field]: "high" | "medium" | "low" }
}
If a field cannot be determined, set to null with confidence "low". Return ONLY valid JSON.`;

const POLICY_PROMPT = `You are a claims document parser for an insurance inspection platform.
Extract structured data from this Homeowner Insurance Policy.
Return a JSON object with these fields:
{
  "policyNumber": string, "policyType": string,
  "coverageA": number, "coverageB": number, "coverageC": number, "coverageD": number,
  "coverageE": number | null, "coverageF": number | null,
  "deductible": { "amount": number, "type": "flat" | "percentage" | "wind_hail_specific", "windHailDeductible": number | null },
  "lossSettlement": "replacement_cost" | "actual_cash_value" | "functional_replacement",
  "constructionType": string, "roofType": string | null, "yearBuilt": number | null,
  "specialConditions": string[] | null,
  "confidence": { [field]: "high" | "medium" | "low" }
}
Return ONLY valid JSON.`;

const ENDORSEMENTS_PROMPT = `You are a claims document parser for an insurance inspection platform.
Extract all endorsements from this insurance policy endorsements document.
Return a JSON object:
{
  "endorsements": [
    { "endorsementId": string, "title": string, "whatItModifies": string, "effectiveDate": string | null,
      "keyProvisions": string[], "sublimits": [{ "description": string, "amount": number }] | null, "claimImpact": string }
  ],
  "totalEndorsements": number, "confidence": "high" | "medium" | "low"
}
Return ONLY valid JSON.`;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { claimId, documentType, pdfText } = await req.json();
    if (!claimId || !documentType || !pdfText) {
      return new Response(JSON.stringify({ error: "claimId, documentType, pdfText required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    let prompt: string;
    if (documentType === "fnol") prompt = FNOL_PROMPT;
    else if (documentType === "policy") prompt = POLICY_PROMPT;
    else if (documentType === "endorsements") prompt = ENDORSEMENTS_PROMPT;
    else return new Response(JSON.stringify({ error: "Invalid documentType" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const parsed = await callOpenAI(prompt, pdfText);
    const confidence = parsed.confidence || {};
    delete parsed.confidence;

    // Save extraction to DB
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: existing } = await supabase.from("extractions").select("id").eq("claim_id", claimId).eq("document_type", documentType).limit(1).single();

    if (existing) {
      await supabase.from("extractions").update({ extracted_data: parsed, confidence, updated_at: new Date().toISOString() }).eq("id", existing.id);
    } else {
      await supabase.from("extractions").insert({ claim_id: claimId, document_type: documentType, extracted_data: parsed, confidence });
    }

    // Update document status
    await supabase.from("documents").update({ status: "parsed" }).eq("claim_id", claimId).eq("document_type", documentType);

    // Update claim status
    await supabase.from("claims").update({ status: "documents_uploaded", updated_at: new Date().toISOString() }).eq("id", claimId);

    // Auto-populate claim from FNOL
    if (documentType === "fnol") {
      const updates: Record<string, any> = {};
      if (parsed.insuredName) updates.insured_name = parsed.insuredName;
      if (parsed.propertyAddress?.street) updates.property_address = parsed.propertyAddress.street;
      if (parsed.propertyAddress?.city) updates.city = parsed.propertyAddress.city;
      if (parsed.propertyAddress?.state) updates.state = parsed.propertyAddress.state;
      if (parsed.propertyAddress?.zip) updates.zip = parsed.propertyAddress.zip;
      if (parsed.dateOfLoss) updates.date_of_loss = parsed.dateOfLoss;
      if (parsed.perilType) updates.peril_type = parsed.perilType;
      if (Object.keys(updates).length > 0) {
        await supabase.from("claims").update(updates).eq("id", claimId);
      }
    }

    return new Response(JSON.stringify({ extractedData: parsed, confidence }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
