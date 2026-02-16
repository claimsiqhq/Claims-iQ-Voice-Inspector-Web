# PROMPT-20 — Voice Agent Intelligence & Conversational Protocol

## Context

PROMPT-18 wired five backend intelligence capabilities (auto-scope, photo→damage bridge, supplemental ESX, phase validation, catalog pricing). PROMPT-19 surfaced those capabilities in the client UI. But the voice agent itself — whose personality and knowledge live in `buildSystemInstructions()` (server/realtime.ts, lines 3–86) and whose callable tools live in `realtimeTools` (lines 88–228) — has **zero awareness** of any of it.

The current system prompt covers eight behaviors (Location Awareness, Guided Flow, Proactive Prompting, Ambiguity Resolution, Peril Awareness, Photo Triggers, Coverage Limits, Keep It Conversational) and ten tools. None mention auto-scope, phase validation, photo damage suggestions, catalog intelligence, completeness tracking, or companion items.

Meanwhile, PROMPT-19 Part A enriches the `add_damage` tool result to include an `autoScope` object with `itemsCreated`, `summary`, and `warnings`. But without system prompt guidance, the voice agent will either ignore this data or hallucinate a response about it. The same applies to photo damage suggestions flowing through `trigger_photo_capture` results and phase validation warnings.

This prompt closes the loop: it upgrades the voice agent's **knowledge** (system instructions), **capabilities** (new tools), and **conversational behavior** (dialogue patterns) so it can intelligently narrate, confirm, and coach the adjuster through every capability the backend now provides.

**Depends on**: PROMPT-18 (backend wiring), PROMPT-19 (client-side integration)

---

## Part A — System Instructions Enhancement

### File: `server/realtime.ts` — Modify `buildSystemInstructions()`

The current function (lines 3–86) returns a string with eight numbered behavior sections and dynamic claim/briefing injection. We add five new sections **after** the existing eight, before the closing backtick of the template literal.

#### A.1 — Insert After Existing Section 8 ("Keep It Conversational")

Find the end of section 8 in the system instructions string. Currently the last behavioral section ends around line 78 with the coverage-limits text and "Keep It Conversational" guidance. Insert the following five new sections immediately after, still inside the template literal:

```ts
// ─── INSERT AFTER EXISTING SECTION 8 ───
// These sections are appended to the system instructions string
// inside buildSystemInstructions(), before the final backtick.

`
9. **Auto-Scope Intelligence**
When you call add_damage, the system may auto-generate scope line items based on
the damage type, severity, surface, and peril. The tool result will include an
"autoScope" object when items are created:

  autoScope.itemsCreated — number of items generated
  autoScope.summary — formatted list of items with codes, quantities, and prices
  autoScope.warnings — any issues (e.g., "No catalog match for surface type")

When autoScope is present:
- Acknowledge the auto-generated items naturally: "Based on that water damage,
  I've auto-generated [N] scope items including [brief list]."
- If warnings exist, mention them: "One note — [warning text]. You may want to
  adjust that manually."
- Do NOT read every line item in detail unless the adjuster asks. Summarize.
- If autoScope.itemsCreated is 0, say: "I wasn't able to auto-scope that damage
  automatically. Let's add line items manually — what do you need?"

When autoScope is absent (older damage entries or manual flow):
- Continue normally. Not every damage triggers auto-scope.

10. **Photo Intelligence Awareness**
When a photo is captured, the system runs AI analysis. The tool result from
trigger_photo_capture may include:

  damageSuggestions[] — AI-detected damage types with severity and confidence
  qualityScore — 0-100 rating of photo quality
  analysisNotes — description of what was detected

When damageSuggestions are present:
- Acknowledge what the camera saw: "The photo analysis detected [damage type]
  damage with [severity] severity."
- If confidence is high (>0.8), offer to log it: "Want me to record that as a
  damage observation?"
- If confidence is moderate (0.5-0.8), be tentative: "The analysis suggests
  possible [type] — does that match what you're seeing?"
- If confidence is low (<0.5), mention it but don't push: "The photo picked up
  something that might be [type], but I'm not very confident. Your call."
- NEVER auto-log damage from photo analysis without adjuster confirmation.
- If qualityScore is below 50, suggest retaking: "That photo came out a bit
  unclear — want to try another shot?"

11. **Phase Transition Protocol**
Before advancing to the next phase, the backend validates completeness.
When you receive phase validation results (through set_inspection_context or
request_phase_validation), the result may include:

  warnings[] — things that should be addressed
  missingItems[] — specific items not yet documented
  completionScore — 0-100 percentage

If warnings exist:
- Read them conversationally: "Before we move on, I want to flag a few things..."
- List each warning naturally (don't read raw text verbatim)
- Ask: "Do you want to address these now, or proceed anyway?"
- If they want to proceed, continue. If they want to fix, guide them.

Common warning responses:
- "No property verification photo" → offer trigger_photo_capture for address_verification
- "Damages documented but no line items" → offer to review scope gaps
- "Drywall without painting" → suggest adding paint finish items
- "Elevated moisture but no mitigation" → suggest extraction/mitigation items
- "No overview photos" → offer to capture overview shots
- "[Room] has no photos" → offer to go back and photograph

If completionScore is below 60, gently note it: "We're at about [score]% complete
for this phase. There are a few gaps we should probably address."

12. **Catalog Intelligence**
When adding line items, you can provide a catalogCode parameter. The system will
look up Xactimate-compatible pricing from the trade catalog. Best practices:

- If you know the Xactimate code for an item (e.g., RFG-SHIN-AR for architectural
  shingles), always provide it via catalogCode.
- The system will return the matched unit price, unit type, and waste factor.
- If the catalog lookup fails or no match is found, the system falls back to
  the adjuster-provided price or defaults.
- For common items, suggest catalog codes when the adjuster describes work:
  "I'll add that as architectural shingles — I have the Xactimate code for that."
- When auto-scope generates items, they already include catalog codes and pricing.

13. **Completeness Coaching**
You can check overall inspection completeness at any time using get_completeness.
This returns a comprehensive analysis including:

  overallScore — 0-100 percentage
  scopeGaps[] — rooms with damage but no line items
  missingPhotos[] — areas that need photo documentation
  recommendations[] — AI suggestions for improving the estimate

Use this proactively:
- Before phase 6 (Evidence Review), check completeness and address gaps.
- Before phase 7 (Estimate Assembly), verify all damages have scope items.
- Before completing the inspection, run a final completeness check.
- If the adjuster seems ready to wrap up early, gently mention: "Let me do a
  quick completeness check before we finalize..." and use get_completeness.
`
```

#### A.2 — Dynamic Capability Injection

Below the static sections, add a dynamic block that activates based on what PROMPT-18 capabilities are available. Insert this in the `buildSystemInstructions()` function body, after the peril-specific text injection (currently around lines 70–73) and before the return:

```ts
// ─── Inside buildSystemInstructions(), after perilText construction ───

// Auto-scope awareness flag — active when scopeAssemblyHook is available
const autoScopeActive = true; // Set to false to disable auto-scope narration

const capabilityText = autoScopeActive
  ? `\n\nIMPORTANT: Auto-scope is ACTIVE for this session. Every add_damage call
will attempt to auto-generate line items. Pay attention to the autoScope field
in tool results and narrate the results to the adjuster.\n`
  : "";
```

Then append `${capabilityText}` to the returned template string, just before the final backtick.

---

## Part B — New Voice Agent Tools

### File: `server/realtime.ts` — Add to `realtimeTools` Array

Add four new tool definitions to the `realtimeTools` array (currently 10 tools, lines 88–228). Insert these after the existing `complete_inspection` tool definition (line 227), before the closing bracket of the array.

#### B.1 — `get_completeness` Tool

```ts
{
  type: "function",
  name: "get_completeness",
  description:
    "Returns a comprehensive completeness analysis for the current inspection. " +
    "Includes overall score, scope gaps (rooms with damage but no line items), " +
    "missing photo documentation, peril-specific checks, and AI recommendations. " +
    "Call this before phase transitions, before finalizing, or when the adjuster " +
    "asks how things are looking.",
  parameters: {
    type: "object",
    properties: {},
    required: [],
  },
},
```

#### B.2 — `confirm_damage_suggestion` Tool

```ts
{
  type: "function",
  name: "confirm_damage_suggestion",
  description:
    "Confirms or rejects a damage suggestion that was detected by photo AI analysis. " +
    "When a photo reveals potential damage, the adjuster must confirm before it is " +
    "logged as an observation. Call this after discussing photo analysis results " +
    "with the adjuster.",
  parameters: {
    type: "object",
    properties: {
      photoId: {
        type: "integer",
        description: "The ID of the photo that produced the suggestion",
      },
      damageType: {
        type: "string",
        description: "The damage type to confirm (from damageSuggestions)",
        enum: [
          "hail_impact", "wind_damage", "water_stain", "water_intrusion",
          "crack", "dent", "missing", "rot", "mold", "mechanical",
          "wear_tear", "other",
        ],
      },
      severity: {
        type: "string",
        description: "Confirmed severity level",
        enum: ["minor", "moderate", "severe"],
      },
      confirmed: {
        type: "boolean",
        description: "true if adjuster confirms the damage, false to reject",
      },
      location: {
        type: "string",
        description: "Where in the room the damage was detected",
      },
    },
    required: ["photoId", "damageType", "confirmed"],
  },
},
```

#### B.3 — `get_scope_gaps` Tool

```ts
{
  type: "function",
  name: "get_scope_gaps",
  description:
    "Returns a list of scope gaps — rooms or areas where damage has been documented " +
    "but no corresponding line items exist. Use this to identify missing scope items " +
    "and help the adjuster complete their estimate. Also flags common companion " +
    "item omissions (e.g., drywall without painting).",
  parameters: {
    type: "object",
    properties: {
      roomId: {
        type: "integer",
        description: "Optional: check gaps for a specific room only. Omit for all rooms.",
      },
    },
    required: [],
  },
},
```

#### B.4 — `request_phase_validation` Tool

```ts
{
  type: "function",
  name: "request_phase_validation",
  description:
    "Explicitly requests a phase validation check for the current phase before " +
    "transitioning. Returns warnings, missing items, and a completion score. " +
    "The adjuster can choose to address warnings or proceed anyway. " +
    "Call this before suggesting a phase change, or when the adjuster asks " +
    "'are we ready to move on?'",
  parameters: {
    type: "object",
    properties: {},
    required: [],
  },
},
```

---

## Part C — Enhanced Existing Tool Definitions

### File: `server/realtime.ts` — Modify Existing Tool Descriptions

Update the `description` field of three existing tools to reflect new capabilities. These are string replacements within the `realtimeTools` array.

#### C.1 — `add_damage` (Currently lines 135–149)

Replace the current description:

```
"Records a damage observation in the current room. Call whenever the adjuster describes damage they see."
```

With:

```
"Records a damage observation in the current room. Call whenever the adjuster describes damage they see. IMPORTANT: The system will attempt to auto-generate scope line items based on this damage (auto-scope). The tool result will include an 'autoScope' object with itemsCreated count, a summary of generated items, and any warnings. Always acknowledge auto-scope results to the adjuster."
```

#### C.2 — `add_line_item` (Currently lines 152–169)

Replace the current description:

```
"Adds an Xactimate-compatible estimate line item. When possible, provide a catalogCode (e.g., 'RFG-SHIN-AR') for accurate pricing lookup. Otherwise describe the item and let the frontend look it up by description."
```

With:

```
"Adds an Xactimate-compatible estimate line item. When possible, provide a catalogCode for accurate pricing lookup — the system will match it against the trade catalog for regional pricing, correct unit types, and default waste factors. If auto-scope already generated items for a damage, you typically don't need to add them manually — check the auto-scope summary first. Companion items (e.g., painting after drywall) may also be auto-generated."
```

#### C.3 — `trigger_photo_capture` (Currently lines 172–183)

Replace the current description:

```
"Triggers the iPad camera to capture a photo. Call for property verification (mandatory first step), damage evidence, overview shots, or test squares. The camera will open and wait for the adjuster to capture — do NOT continue talking until you receive the result."
```

With:

```
"Triggers the iPad camera to capture a photo. Call for property verification (mandatory first step), damage evidence, overview shots, or test squares. The camera will open and wait for the adjuster to capture — do NOT continue talking until you receive the tool result. The result will include AI analysis of the captured photo. If damageSuggestions are present, discuss them with the adjuster and use confirm_damage_suggestion to log confirmed damage. If qualityScore is below 50, suggest retaking the photo."
```

---

## Part D — Client-Side Tool Dispatch for New Tools

### File: `client/src/pages/ActiveInspection.tsx` — Extend `executeToolCall()`

The `executeToolCall` function (lines 219–465) uses a `switch(name)` to route tool calls. Add four new cases for the tools defined in Part B.

#### D.1 — `get_completeness` Case

Insert after the `get_estimate_summary` case (currently around line 440) and before the `complete_inspection` case:

```ts
case "get_completeness": {
  if (!sessionId) { result = { success: false, error: "No session" }; break; }
  const compHeaders = await getAuthHeaders();
  const compRes = await fetch(
    `/api/inspection/${sessionId}/completeness`,
    { headers: compHeaders }
  );
  if (!compRes.ok) {
    result = { success: false, error: "Could not retrieve completeness" };
    break;
  }
  const completeness = await compRes.json();

  // Build a voice-friendly summary
  const gaps = completeness.scopeGaps || [];
  const missingPhotos = completeness.missingPhotos || [];
  const recommendations = completeness.recommendations || [];

  let voiceSummary = `Overall completeness: ${completeness.overallScore || 0}%.`;
  if (gaps.length > 0) {
    voiceSummary += ` Scope gaps in ${gaps.length} room(s): ${gaps.map((g: any) => g.roomName).join(", ")}.`;
  }
  if (missingPhotos.length > 0) {
    voiceSummary += ` Missing photos for: ${missingPhotos.map((p: any) => p.area || p.roomName).join(", ")}.`;
  }
  if (recommendations.length > 0) {
    voiceSummary += ` Recommendations: ${recommendations.slice(0, 3).join("; ")}.`;
  }

  result = {
    success: true,
    overallScore: completeness.overallScore || 0,
    summary: voiceSummary,
    scopeGaps: gaps,
    missingPhotos: missingPhotos,
    recommendations: recommendations,
    perilSpecific: completeness.perilSpecificChecks || [],
  };
  break;
}
```

#### D.2 — `confirm_damage_suggestion` Case

Insert after the `get_completeness` case:

```ts
case "confirm_damage_suggestion": {
  if (!sessionId || !currentRoomId) {
    result = { success: false, error: "No room selected" };
    break;
  }

  if (!args.confirmed) {
    // Adjuster rejected the suggestion — just acknowledge
    result = {
      success: true,
      action: "rejected",
      message: "Damage suggestion dismissed",
    };
    break;
  }

  // Adjuster confirmed — create a damage observation from the suggestion
  const confirmHeaders = await getAuthHeaders();
  const confirmRes = await fetch(`/api/inspection/${sessionId}/damages`, {
    method: "POST",
    headers: confirmHeaders,
    body: JSON.stringify({
      roomId: currentRoomId,
      description: `Photo-detected ${args.damageType}${args.location ? ` at ${args.location}` : ""}`,
      damageType: args.damageType,
      severity: args.severity || "moderate",
      location: args.location || undefined,
      sourcePhotoId: args.photoId,
    }),
  });
  const confirmData = await confirmRes.json();
  await refreshRooms();

  // Parse auto-scope from damage creation (PROMPT-19 Part A enrichment)
  const autoScope = confirmData.autoScope || null;

  result = {
    success: true,
    action: "confirmed",
    damageId: confirmData.damage?.id || confirmData.id,
    autoScope: autoScope ? {
      itemsCreated: autoScope.itemsCreated,
      summary: autoScope.items?.map((i: any) =>
        `${i.code}: ${i.description} — ${i.quantity} ${i.unit} @ $${i.unitPrice?.toFixed(2)}`
      ).join("\n") || "No items matched",
      warnings: autoScope.warnings,
    } : undefined,
  };

  if (autoScope?.itemsCreated > 0) {
    await refreshLineItems();
    await refreshEstimate();
  }
  break;
}
```

#### D.3 — `get_scope_gaps` Case

```ts
case "get_scope_gaps": {
  if (!sessionId) { result = { success: false, error: "No session" }; break; }
  const gapHeaders = await getAuthHeaders();
  const gapUrl = args.roomId
    ? `/api/inspection/${sessionId}/completeness?roomId=${args.roomId}`
    : `/api/inspection/${sessionId}/completeness`;
  const gapRes = await fetch(gapUrl, { headers: gapHeaders });
  if (!gapRes.ok) {
    result = { success: false, error: "Could not retrieve scope gaps" };
    break;
  }
  const gapData = await gapRes.json();

  const gaps = gapData.scopeGaps || [];
  let gapSummary = gaps.length === 0
    ? "No scope gaps found — all documented damages have corresponding line items."
    : `Found ${gaps.length} scope gap(s): ` +
      gaps.map((g: any) =>
        `${g.roomName} has ${g.damageCount} damage(s) but ${g.lineItemCount} line item(s)`
      ).join("; ");

  // Check for companion omissions
  const companionGaps = gapData.companionOmissions || [];
  if (companionGaps.length > 0) {
    gapSummary += `. Companion item omissions: ${companionGaps.map((c: any) => c.message).join("; ")}`;
  }

  result = {
    success: true,
    gapCount: gaps.length,
    summary: gapSummary,
    gaps: gaps,
    companionOmissions: companionGaps,
  };
  break;
}
```

#### D.4 — `request_phase_validation` Case

```ts
case "request_phase_validation": {
  if (!sessionId) { result = { success: false, error: "No session" }; break; }
  const valHeaders = await getAuthHeaders();
  const valRes = await fetch(
    `/api/inspection/${sessionId}/validate-phase`,
    { headers: valHeaders }
  );
  if (!valRes.ok) {
    result = { success: false, error: "Could not validate phase" };
    break;
  }
  const validation = await valRes.json();

  let valSummary = `Phase ${validation.currentPhase} completion: ${validation.completionScore}%.`;
  if (validation.warnings.length > 0) {
    valSummary += ` Warnings: ${validation.warnings.join("; ")}`;
  }
  if (validation.missingItems.length > 0) {
    valSummary += ` Missing: ${validation.missingItems.join("; ")}`;
  }
  if (validation.warnings.length === 0) {
    valSummary += " All clear — ready to advance.";
  }

  result = {
    success: true,
    currentPhase: validation.currentPhase,
    nextPhase: validation.nextPhase,
    completionScore: validation.completionScore,
    warnings: validation.warnings,
    missingItems: validation.missingItems,
    summary: valSummary,
    canProceed: validation.canProceed,
  };
  break;
}
```

---

## Part E — Enhanced `set_inspection_context` with Phase Validation

### File: `client/src/pages/ActiveInspection.tsx` — Modify `set_inspection_context` Case

Currently (lines 232–248), the `set_inspection_context` handler updates local state and PATCHes the session. It returns `{ success: true, context: args }`. When the adjuster changes phases, we should automatically run phase validation and include results.

Replace the current `set_inspection_context` case:

```ts
case "set_inspection_context": {
  const previousPhase = currentPhase;
  if (args.phase) setCurrentPhase(args.phase);
  if (args.structure) setCurrentStructure(args.structure);
  if (args.area) setCurrentArea(args.area);

  if (sessionId) {
    const headers = await getAuthHeaders();
    await fetch(`/api/inspection/${sessionId}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({
        currentPhase: args.phase,
        currentStructure: args.structure,
      }),
    });
  }

  // If phase is changing, run validation on the PREVIOUS phase
  let phaseValidation = null;
  if (args.phase && args.phase !== previousPhase && sessionId) {
    try {
      const valHeaders = await getAuthHeaders();
      const valRes = await fetch(
        `/api/inspection/${sessionId}/validate-phase`,
        { headers: valHeaders }
      );
      if (valRes.ok) {
        phaseValidation = await valRes.json();
      }
    } catch (e) {
      console.warn("Phase validation check failed:", e);
    }
  }

  result = {
    success: true,
    context: args,
    phaseValidation: phaseValidation ? {
      completionScore: phaseValidation.completionScore,
      warnings: phaseValidation.warnings,
      missingItems: phaseValidation.missingItems,
      summary: phaseValidation.warnings.length > 0
        ? `Phase ${previousPhase} has ${phaseValidation.warnings.length} warning(s): ${phaseValidation.warnings.join("; ")}`
        : `Phase ${previousPhase} is complete — no issues found.`,
    } : undefined,
  };
  break;
}
```

**Why this matters**: The voice agent calls `set_inspection_context` with a new `phase` value whenever the adjuster says "let's move on to the interior" or similar. By automatically including phase validation in the response, the voice agent can immediately narrate warnings without requiring a separate `request_phase_validation` call. The explicit tool still exists for when the adjuster asks "are we ready to move on?" before committing.

---

## Part F — Conversational Flow Patterns

This section defines the dialogue patterns the voice agent should follow for each new capability. These are encoded in the system instructions (Part A) but documented here as reference for the expected conversational behavior.

### F.1 — Auto-Scope Narration Flow

```
TRIGGER: add_damage tool result includes autoScope.itemsCreated > 0

AGENT BEHAVIOR:
1. Acknowledge the damage was logged
2. Summarize auto-scope results (count + brief list)
3. Mention any warnings
4. Ask if adjuster wants to modify anything

EXAMPLE DIALOGUE:
  Adjuster: "I've got water staining on the ceiling here, about 4 feet across,
             moderate damage."
  Agent:    [calls add_damage with description, type, severity]
  Agent:    "Got it — I've logged that water staining. The system also auto-generated
             3 scope items: drywall removal and replacement, ceiling texture, and
             primer plus two coats of paint. That comes to about $1,240 for this
             area. Sound about right, or do you want to adjust anything?"

EDGE CASE — autoScope.itemsCreated === 0:
  Agent:    "I've logged the damage, but I wasn't able to auto-generate scope items
             for this one. Want to add line items manually?"

EDGE CASE — autoScope.warnings present:
  Agent:    "I've auto-generated 2 items, but heads up — the system flagged that
             it couldn't find a catalog match for the trim type. You might want
             to double-check that price."
```

### F.2 — Photo Damage Confirmation Flow

```
TRIGGER: trigger_photo_capture result includes damageSuggestions[]

AGENT BEHAVIOR:
1. Acknowledge the photo was captured
2. Report AI analysis findings (damage type, severity, confidence)
3. Ask for confirmation before logging
4. If confirmed, call confirm_damage_suggestion
5. Report auto-scope results if damage creates them

EXAMPLE DIALOGUE (HIGH CONFIDENCE):
  Agent:    "Got the photo. The AI analysis detected hail impact damage with
             moderate severity — it's pretty confident about that. Want me to
             log that as a damage observation?"
  Adjuster: "Yeah, that's right."
  Agent:    [calls confirm_damage_suggestion with confirmed: true]
  Agent:    "Logged. The system also auto-generated scope items for the
             hail damage — 3 items totaling about $2,100."

EXAMPLE DIALOGUE (LOW CONFIDENCE):
  Agent:    "Photo captured. The analysis picked up something that might be
             wind damage, but the confidence is pretty low. Does that match
             what you're seeing?"
  Adjuster: "No, that's actually just wear and tear."
  Agent:    [calls confirm_damage_suggestion with confirmed: false]
  Agent:    "Noted — I'll skip that one. Anything else you want to document here?"

EXAMPLE DIALOGUE (POOR QUALITY):
  Agent:    "I got the photo, but it came out a bit blurry — the quality score
             is pretty low. Want to try another shot for better documentation?"
```

### F.3 — Phase Transition Dialogue Flow

```
TRIGGER: set_inspection_context result includes phaseValidation with warnings

AGENT BEHAVIOR:
1. Acknowledge the phase change request
2. Report validation warnings conversationally
3. Ask whether to address or proceed
4. If address, guide through each missing item
5. If proceed, continue to next phase

EXAMPLE DIALOGUE (WARNINGS PRESENT):
  Adjuster: "Alright, I think we're done outside. Let's head inside."
  Agent:    [calls set_inspection_context with phase: 4]
  Agent:    "Before we head inside, I want to flag a couple things from the
             exterior work. The north slope doesn't have any photos yet, and
             we've got damage logged on the east elevation but no line items
             for it. We're at about 72% for the exterior phase. Want to
             circle back and clean those up, or move on?"
  Adjuster: "Let's go back and get that photo real quick."
  Agent:    "Sure — let's go to the north slope. Ready to take a photo?"

EXAMPLE DIALOGUE (NO WARNINGS):
  Adjuster: "I think we're good outside."
  Agent:    [calls set_inspection_context with phase: 4]
  Agent:    "Exterior phase looks solid — no gaps I can see. Let's head inside.
             Which room do you want to start with?"
```

### F.4 — Completeness Coaching Flow

```
TRIGGER: Agent proactively calls get_completeness before finalization

AGENT BEHAVIOR:
1. Run completeness check
2. Report overall score
3. Highlight most important gaps
4. Suggest specific actions
5. Proceed to finalize when ready

EXAMPLE DIALOGUE:
  Adjuster: "I think we're about done here."
  Agent:    [calls get_completeness]
  Agent:    "Let me do a quick completeness check... We're at 85% overall.
             Couple things to address: the master bathroom has damage logged
             but no scope items, and we're missing an overview photo of the
             kitchen. Those are the main gaps. Want to tackle those before
             we wrap up?"
  Adjuster: "Yeah, let's add the scope for the bathroom."
  Agent:    "Sure — what work needs to happen in the master bathroom?"
```

### F.5 — Catalog Code Usage Flow

```
TRIGGER: Adjuster describes work that has a known Xactimate code

AGENT BEHAVIOR:
1. Recognize the item from the adjuster's description
2. Provide the catalog code when calling add_line_item
3. Report the catalog-matched pricing
4. Note if the catalog price differs from the adjuster's estimate

EXAMPLE DIALOGUE:
  Adjuster: "We need to replace about 24 squares of architectural shingles."
  Agent:    [calls add_line_item with catalogCode: "RFG-SHIN-AR",
             category: "Roofing", quantity: 24, unit: "SQ"]
  Agent:    "Added 24 squares of architectural shingles. The catalog price
             came in at $127.50 per square, so that's $3,060 before waste.
             I've included a 12% waste factor. That look right?"
```

---

## Part G — Error Recovery Dialogue Patterns

### File: `server/realtime.ts` — Add to System Instructions

Append to the system instructions string, after the completeness coaching section (section 13 from Part A):

```ts
`
14. **Error Recovery**
Sometimes tool calls fail (network issues, missing data, server errors). When a
tool result includes success: false:

- Do NOT panic or apologize excessively. Stay calm and professional.
- If the error is "No room selected": "Hmm, I need to know which room we're in
  first. Can you tell me where we are?"
- If the error is "No session": "It looks like there might be a connection issue.
  Let me try that again." (The client will attempt reconnection.)
- If the error is a server error: "That didn't go through — let me try once more."
  Then retry the same call once. If it fails again, say: "I'm having trouble with
  that one. Let's move on and come back to it."
- If a catalog lookup fails, fall back gracefully: "I couldn't find the catalog
  price for that one, but I've added it with the price you mentioned. We can
  verify it later."

NEVER expose raw error messages to the adjuster. Translate them into
conversational English.
`
```

### File: `client/src/pages/ActiveInspection.tsx` — Retry Logic

Currently, the outer catch block (line 452) sets `result = { success: false, error: error.message }` and sends it to the voice agent. For the new tools, add a simple retry wrapper for transient failures.

Insert a helper function above `executeToolCall`:

```ts
// ─── Insert above executeToolCall definition (before line 219) ───
const retryableFetch = async (
  url: string,
  options: RequestInit,
  maxRetries = 1
): Promise<Response> => {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url, options);
      if (res.ok || res.status < 500) return res;
      lastError = new Error(`Server error: ${res.status}`);
    } catch (e: any) {
      lastError = e;
    }
    if (attempt < maxRetries) {
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
  throw lastError || new Error("Request failed after retries");
};
```

Then use `retryableFetch` in the new tool cases (Part D) for the completeness and validation endpoints, which are read-only and safe to retry:

```ts
// In get_completeness case, replace:
//   const compRes = await fetch(...)
// With:
const compRes = await retryableFetch(
  `/api/inspection/${sessionId}/completeness`,
  { headers: compHeaders }
);

// In request_phase_validation case, replace:
//   const valRes = await fetch(...)
// With:
const valRes = await retryableFetch(
  `/api/inspection/${sessionId}/validate-phase`,
  { headers: valHeaders }
);
```

**Do NOT retry** mutating calls (`add_damage`, `confirm_damage_suggestion`, `add_line_item`) as they could create duplicates.

---

## Part H — Voice-to-UI Synchronization Contracts

This section defines the event sequencing guarantees between tool calls, UI updates, and voice narration. These are not code changes but architectural contracts that Parts A–G must respect.

### H.1 — Event Flow: add_damage with Auto-Scope

```
1. Voice agent calls add_damage(description, type, severity, ...)
2. Client executeToolCall dispatches POST /api/inspection/:id/damages
3. Server creates damage → scopeAssemblyHook fires → returns { damage, autoScope }
4. Client parses response:
   a. refreshRooms()           — UI updates damage count badges
   b. refreshLineItems()       — UI updates estimate panel with new items (if autoScope)
   c. refreshEstimate()        — UI updates RCV/ACV totals
5. Client builds enriched result with autoScope summary
6. Client sends function_call_output via data channel
7. Voice agent receives result, narrates auto-scope per Section 9 instructions
```

**Timing**: Steps 4a–4c are React Query invalidations (async). The UI may update slightly after the voice agent starts narrating. This is acceptable — the voice narration is the primary feedback, UI updates are secondary confirmation.

### H.2 — Event Flow: trigger_photo_capture with Damage Suggestions

```
1. Voice agent calls trigger_photo_capture(label, photoType, overlay)
2. Client sets cameraMode.active = true, stores pending call_id
3. Client does NOT send tool result yet (returns early from executeToolCall)
4. Adjuster captures photo → handleCameraCapture fires
5. Photo saved → Vision API analyzes → damageSuggestions extracted
6. Client sends function_call_output with photo result + damageSuggestions
7. Voice agent receives result, discusses findings per Section 10 instructions
8. If adjuster confirms → voice agent calls confirm_damage_suggestion
9. Client dispatches POST /api/inspection/:id/damages with sourcePhotoId
10. Auto-scope may fire → enriched result sent back
11. Voice agent narrates combined photo+damage+scope result
```

**Critical**: Between steps 3 and 6, the voice agent is SILENT (waiting for tool result). The system instructions (line 81) enforce this: "Do NOT continue talking until you receive the tool result."

### H.3 — Event Flow: Phase Transition with Validation

```
1. Adjuster says "let's move to the interior"
2. Voice agent calls set_inspection_context(phase: 4)
3. Client updates local state + PATCHes session
4. Client auto-runs phase validation (GET /validate-phase)
5. Client sends result including phaseValidation object
6. Voice agent reads warnings per Section 11 instructions
7. If adjuster wants to fix: voice agent guides through missing items
8. If adjuster wants to proceed: voice agent continues with new phase
```

**Note**: The client-side phase stepper (PROMPT-19 Part D) also shows a modal overlay with warnings. Both the voice narration and UI modal fire from the same validation data. The adjuster can interact with either — the voice agent should not repeat what the modal already shows if the adjuster clicks "Proceed Anyway" in the UI.

### H.4 — Voice Agent State During Long Operations

Some operations (completeness check, phase validation) may take 1–3 seconds. During this time:

- The voice agent is in "waiting for tool result" state (silent)
- The UI should show a subtle loading indicator (existing `voiceState === "processing"`)
- If the operation takes longer than 5 seconds, the client should send a partial result: `{ success: true, pending: true, message: "Still checking..." }` to keep the voice agent from timing out

This timeout safety net is implemented in the retry wrapper (Part G) — if the fetch itself takes too long, the catch block sends the error result so the voice agent can recover conversationally.

---

## Summary of All Changes

| File | Change Type | Description |
|------|------------|-------------|
| `server/realtime.ts` | MODIFY | Add 6 new system instruction sections (9–14) to `buildSystemInstructions()` |
| `server/realtime.ts` | MODIFY | Add dynamic capability injection text |
| `server/realtime.ts` | ADD | 4 new tools: `get_completeness`, `confirm_damage_suggestion`, `get_scope_gaps`, `request_phase_validation` |
| `server/realtime.ts` | MODIFY | Enhanced descriptions for `add_damage`, `add_line_item`, `trigger_photo_capture` |
| `client/src/pages/ActiveInspection.tsx` | ADD | 4 new `executeToolCall` switch cases (get_completeness, confirm_damage_suggestion, get_scope_gaps, request_phase_validation) |
| `client/src/pages/ActiveInspection.tsx` | MODIFY | Enhanced `set_inspection_context` with auto phase validation |
| `client/src/pages/ActiveInspection.tsx` | ADD | `retryableFetch` helper for idempotent read operations |

**New tools**: 4
**Modified tools**: 4 (3 descriptions + 1 behavior)
**System instruction sections added**: 6
**Conversational flow patterns documented**: 5
**Event synchronization contracts**: 4
