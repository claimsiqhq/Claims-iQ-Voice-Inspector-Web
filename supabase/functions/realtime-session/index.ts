import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const realtimeTools = [
  { type: "function", name: "set_inspection_context", description: "Sets current location context.", parameters: { type: "object", properties: { structure: { type: "string" }, area: { type: "string" }, phase: { type: "integer" } }, required: ["area"] } },
  { type: "function", name: "create_room", description: "Creates a new room/area with optional dimensions.", parameters: { type: "object", properties: { name: { type: "string" }, roomType: { type: "string" }, structure: { type: "string" }, length: { type: "number" }, width: { type: "number" }, height: { type: "number" }, phase: { type: "integer" } }, required: ["name"] } },
  { type: "function", name: "add_damage", description: "Records a damage observation.", parameters: { type: "object", properties: { description: { type: "string" }, damageType: { type: "string", enum: ["hail_impact","wind_damage","water_stain","water_intrusion","crack","dent","missing","rot","mold","mechanical","wear_tear","other"] }, severity: { type: "string", enum: ["minor","moderate","severe"] }, location: { type: "string" }, extent: { type: "string" } }, required: ["description","damageType"] } },
  { type: "function", name: "add_line_item", description: "Adds an Xactimate-compatible estimate line item.", parameters: { type: "object", properties: { category: { type: "string", enum: ["Roofing","Siding","Soffit/Fascia","Gutters","Windows","Doors","Drywall","Painting","Flooring","Plumbing","Electrical","HVAC","Debris","General","Fencing"] }, action: { type: "string", enum: ["R&R","Detach & Reset","Repair","Paint","Clean","Tear Off","Labor Only","Install"] }, description: { type: "string" }, quantity: { type: "number" }, unit: { type: "string", enum: ["SF","LF","EA","SQ","HR","DAY"] }, unitPrice: { type: "number" } }, required: ["category","action","description"] } },
  { type: "function", name: "trigger_photo_capture", description: "Triggers camera to capture a photo.", parameters: { type: "object", properties: { label: { type: "string" }, photoType: { type: "string", enum: ["overview","damage_detail","test_square","moisture","pre_existing"] } }, required: ["label","photoType"] } },
  { type: "function", name: "log_moisture_reading", description: "Records a moisture reading.", parameters: { type: "object", properties: { location: { type: "string" }, reading: { type: "number" }, materialType: { type: "string" } }, required: ["location","reading"] } },
  { type: "function", name: "add_opening", description: "Records a wall opening (door, window, etc.).", parameters: { type: "object", properties: { openingType: { type: "string", enum: ["window","standard_door","overhead_door","missing_wall","pass_through","archway","cased_opening"] }, wallDirection: { type: "string", enum: ["north","south","east","west"] }, widthFt: { type: "number" }, heightFt: { type: "number" }, opensInto: { type: "string" } }, required: ["openingType","widthFt","heightFt"] } },
  { type: "function", name: "set_room_adjacency", description: "Records two rooms sharing a wall.", parameters: { type: "object", properties: { roomNameA: { type: "string" }, roomNameB: { type: "string" }, wallDirectionA: { type: "string", enum: ["north","south","east","west"] }, sharedWallLengthFt: { type: "number" } }, required: ["roomNameA","roomNameB"] } },
  { type: "function", name: "update_room_dimensions", description: "Updates a room's dimensions.", parameters: { type: "object", properties: { roomName: { type: "string" }, length: { type: "number" }, width: { type: "number" }, height: { type: "number" }, ceilingType: { type: "string", enum: ["flat","cathedral","tray","vaulted"] } }, required: ["roomName"] } },
  { type: "function", name: "complete_room", description: "Marks room as complete.", parameters: { type: "object", properties: { roomName: { type: "string" } }, required: ["roomName"] } },
  { type: "function", name: "get_estimate_summary", description: "Returns running estimate totals.", parameters: { type: "object", properties: {} } },
  { type: "function", name: "complete_inspection", description: "Finalizes the inspection.", parameters: { type: "object", properties: { notes: { type: "string" } } } },
];

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { claimId, sessionId } = await req.json();
    if (!claimId) return new Response(JSON.stringify({ error: "claimId required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const apiKey = Deno.env.get("OPENAI_API_KEY");
    if (!apiKey) return new Response(JSON.stringify({ error: "OPENAI_API_KEY not set" }), { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: claim } = await supabase.from("claims").select("*").eq("id", claimId).limit(1).single();
    if (!claim) return new Response(JSON.stringify({ error: "Claim not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const instructions = `You are an expert insurance inspection assistant for Claims IQ. You are guiding a field adjuster through a property inspection via voice conversation.

## Your Identity
- Name: Claims IQ Inspector
- Voice: Professional, concise, efficient.
- Confirm every action with a brief spoken acknowledgment.

## This Claim
- Claim: ${claim.claim_number}
- Insured: ${claim.insured_name || "Unknown"}
- Property: ${claim.property_address || ""}, ${claim.city || ""}, ${claim.state || ""} ${claim.zip || ""}
- Date of Loss: ${claim.date_of_loss || "Unknown"}
- Peril: ${claim.peril_type || "Unknown"}

## Core Behaviors
1. Always know which structure and room the adjuster is in.
2. Follow the 8-phase inspection flow.
3. After documenting damage, suggest related items.
4. If the adjuster is vague, ask for specifics.
5. Call trigger_photo_capture when entering a new area or when damage is described.
6. Keep responses to 1-2 sentences.`;

    const response = await fetch("https://api.openai.com/v1/realtime/sessions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-realtime-preview",
        voice: "alloy",
        instructions,
        tools: realtimeTools,
        input_audio_transcription: { model: "whisper-1" },
        modalities: ["audio", "text"],
      }),
    });

    const data = await response.json();
    if (!response.ok) return new Response(JSON.stringify({ error: "Failed to create session", details: data }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    return new Response(JSON.stringify({ clientSecret: data.client_secret?.value, sessionId }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
