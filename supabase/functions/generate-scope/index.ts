import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const DAMAGE_TO_SCOPE: Record<string, Array<{ description: string; category: string; action: string; unit: string; quantitySource: string; fixedQty?: number }>> = {
  hail_impact: [
    { description: "R&R Composition shingles", category: "Roofing", action: "R&R", unit: "SQ", quantitySource: "fixed", fixedQty: 1 },
    { description: "R&R Roofing felt", category: "Roofing", action: "R&R", unit: "SQ", quantitySource: "fixed", fixedQty: 1 },
    { description: "R&R Drip edge", category: "Roofing", action: "R&R", unit: "LF", quantitySource: "perimeter" },
    { description: "R&R Ridge cap", category: "Roofing", action: "R&R", unit: "LF", quantitySource: "fixed", fixedQty: 30 },
  ],
  wind_damage: [
    { description: "R&R Composition shingles", category: "Roofing", action: "R&R", unit: "SQ", quantitySource: "fixed", fixedQty: 1 },
    { description: "R&R Siding", category: "Siding", action: "R&R", unit: "SF", quantitySource: "walls" },
  ],
  water_stain: [
    { description: "R&R Drywall - ceiling", category: "Drywall", action: "R&R", unit: "SF", quantitySource: "ceiling" },
    { description: "Paint ceiling", category: "Painting", action: "Paint", unit: "SF", quantitySource: "ceiling" },
  ],
  water_intrusion: [
    { description: "R&R Drywall", category: "Drywall", action: "R&R", unit: "SF", quantitySource: "walls" },
    { description: "Paint walls", category: "Painting", action: "Paint", unit: "SF", quantitySource: "walls" },
    { description: "R&R Flooring", category: "Flooring", action: "R&R", unit: "SF", quantitySource: "floor" },
  ],
  crack: [
    { description: "Repair drywall crack", category: "Drywall", action: "Repair", unit: "LF", quantitySource: "fixed", fixedQty: 10 },
    { description: "Paint repaired area", category: "Painting", action: "Paint", unit: "SF", quantitySource: "fixed", fixedQty: 50 },
  ],
  rot: [
    { description: "R&R rotted wood", category: "Carpentry", action: "R&R", unit: "LF", quantitySource: "fixed", fixedQty: 8 },
    { description: "Prime and paint", category: "Painting", action: "Paint", unit: "SF", quantitySource: "fixed", fixedQty: 20 },
  ],
  mold: [
    { description: "Mold remediation", category: "General", action: "Clean", unit: "SF", quantitySource: "walls" },
    { description: "R&R contaminated drywall", category: "Drywall", action: "R&R", unit: "SF", quantitySource: "walls" },
  ],
  other: [{ description: "General repair", category: "General", action: "Repair", unit: "EA", quantitySource: "each" }],
};

function calcQty(source: string, dims: any, fixedQty?: number): number {
  if (!dims) return fixedQty || 1;
  const h = dims.height || 8;
  switch (source) {
    case "walls": return (dims.length + dims.width) * 2 * h;
    case "ceiling": case "floor": return dims.length * dims.width;
    case "perimeter": return (dims.length + dims.width) * 2;
    case "fixed": return fixedQty || 1;
    default: return 1;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { sessionId, roomId, damageType, severity, dimensions } = await req.json();
    const templates = DAMAGE_TO_SCOPE[damageType] || DAMAGE_TO_SCOPE["other"]!;
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Try to look up pricing from catalog
    const items = [];
    for (const tmpl of templates) {
      let qty = calcQty(tmpl.quantitySource, dimensions, tmpl.fixedQty);
      if (severity === "minor") qty = Math.ceil(qty * 0.5);
      if (severity === "severe") qty = Math.ceil(qty * 1.2);

      // Look up catalog pricing
      let unitPrice = 0;
      const { data: catalogItems } = await supabase.from("scope_line_items").select("code, trade_code").ilike("description", `%${tmpl.description.split(" ").slice(-1)[0]}%`).limit(1);
      if (catalogItems?.[0]) {
        const { data: price } = await supabase.from("regional_price_sets").select("material_cost, labor_cost, equipment_cost").eq("line_item_code", catalogItems[0].code).limit(1).single();
        if (price) unitPrice = (price.material_cost || 0) + (price.labor_cost || 0) + (price.equipment_cost || 0);
      }

      const { data: inserted } = await supabase.from("line_items").insert({
        session_id: sessionId,
        room_id: roomId,
        description: tmpl.description,
        category: tmpl.category,
        action: tmpl.action,
        quantity: Math.round(qty * 100) / 100,
        unit: tmpl.unit,
        unit_price: unitPrice,
        total_price: Math.round(unitPrice * qty * 100) / 100,
        provenance: "auto",
      }).select().single();

      items.push(inserted);
    }

    return new Response(JSON.stringify({ generatedItems: items }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
