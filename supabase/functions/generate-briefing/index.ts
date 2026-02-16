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

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { claimId } = await req.json();
    if (!claimId) return new Response(JSON.stringify({ error: "claimId required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const apiKey = Deno.env.get("OPENAI_API_KEY");
    if (!apiKey) throw new Error("OPENAI_API_KEY not set");

    const { data: exts } = await supabase.from("extractions").select("*").eq("claim_id", claimId);
    const fnol = exts?.find((e: any) => e.document_type === "fnol");
    const policy = exts?.find((e: any) => e.document_type === "policy");
    const endorsements = exts?.find((e: any) => e.document_type === "endorsements");

    if (!fnol) return new Response(JSON.stringify({ error: "FNOL extraction required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content: `You are an expert insurance claims analyst preparing an inspection briefing for a field adjuster.
Synthesize the FNOL, Policy, and Endorsements data into a comprehensive pre-inspection briefing.
Return a JSON object:
{
  "propertyProfile": { "address": string, "propertyType": string, "yearBuilt": number, "stories": number, "constructionType": string, "roofType": string, "squareFootage": number | null, "summary": string },
  "coverageSnapshot": { "coverageA": { "label": "Dwelling", "limit": number }, "coverageB": { "label": "Other Structures", "limit": number }, "coverageC": { "label": "Personal Property", "limit": number }, "coverageD": { "label": "Loss of Use", "limit": number }, "deductible": number, "deductibleType": string, "lossSettlement": string, "summary": string },
  "perilAnalysis": { "perilType": string, "whatToLookFor": string[], "inspectionPriorities": string[], "typicalDamagePatterns": string, "commonMistakes": string[] },
  "endorsementImpacts": [{ "endorsementId": string, "title": string, "adjusterGuidance": string }],
  "inspectionChecklist": { "exterior": string[], "roof": string[], "interior": string[], "systems": string[], "documentation": string[] },
  "dutiesAfterLoss": string[],
  "redFlags": string[]
}
Return ONLY valid JSON.`,
          },
          {
            role: "user",
            content: `FNOL: ${JSON.stringify(fnol.extracted_data)}\nPolicy: ${JSON.stringify(policy?.extracted_data || {})}\nEndorsements: ${JSON.stringify(endorsements?.extracted_data || {})}`,
          },
        ],
        temperature: 0.2,
        max_tokens: 4000,
      }),
    });

    const data = await res.json();
    const briefingData = parseJsonResponse(data.choices?.[0]?.message?.content || "{}");

    // Upsert briefing
    const { data: existing } = await supabase.from("briefings").select("id").eq("claim_id", claimId).limit(1).single();
    if (existing) {
      await supabase.from("briefings").update({
        property_profile: briefingData.propertyProfile,
        coverage_snapshot: briefingData.coverageSnapshot,
        peril_analysis: briefingData.perilAnalysis,
        endorsement_impacts: briefingData.endorsementImpacts,
        inspection_checklist: briefingData.inspectionChecklist,
        duties_after_loss: briefingData.dutiesAfterLoss,
        red_flags: briefingData.redFlags,
      }).eq("id", existing.id);
    } else {
      await supabase.from("briefings").insert({
        claim_id: claimId,
        property_profile: briefingData.propertyProfile,
        coverage_snapshot: briefingData.coverageSnapshot,
        peril_analysis: briefingData.perilAnalysis,
        endorsement_impacts: briefingData.endorsementImpacts,
        inspection_checklist: briefingData.inspectionChecklist,
        duties_after_loss: briefingData.dutiesAfterLoss,
        red_flags: briefingData.redFlags,
      });
    }

    await supabase.from("claims").update({ status: "briefing_ready", updated_at: new Date().toISOString() }).eq("id", claimId);

    return new Response(JSON.stringify(briefingData), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
