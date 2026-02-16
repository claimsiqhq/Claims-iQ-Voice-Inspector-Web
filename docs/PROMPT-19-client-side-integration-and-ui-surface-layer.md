# PROMPT 19 — Client-Side Integration: Surfacing Auto-Scope, Photo Intelligence & Phase Validation

**Depends on:** PROMPT-18 (Scope Wiring & Workflow Integrity)
**Branch:** `feat/client-scope-ui`

---

## Context

PROMPT-18 wired five backend capabilities: auto-scope on damage creation, photo→damage suggestion pipeline, supplemental ESX export, phase transition validation, and catalog-aware line item creation. All five produce richer API responses — but the current client-side code **ignores every new field**.

Specifically:

- **`ActiveInspection.tsx` add_damage handler** (lines 288–310): POSTs to `/api/inspection/:sessionId/damages` and reads only `damage.id` from the response. The new `autoScope` object — containing `itemsCreated`, `items[]`, and `warnings[]` — is silently discarded. The voice agent never learns what items were auto-generated.
- **`ActiveInspection.tsx` photo capture** (lines 650–774): Receives `analysis` from `/api/inspection/:sessionId/photos/:photoId/analyze` but the new `damageSuggestions[]` array appended by PROMPT-18 is never extracted, displayed, or sent to the voice agent.
- **`ActiveInspection.tsx` estimate panel** (lines 917–986): Shows the last 5 line items with basic description/price, but makes no distinction between `provenance: "voice"`, `provenance: "auto_scope"`, and `provenance: "companion"`. Auto-scoped items appear identical to manual entries.
- **`ActiveInspection.tsx` phase stepper** (lines 813–839): Purely visual — clicking or advancing phases has no validation call to `/api/inspection/:sessionId/validate-phase`. The voice agent's `set_inspection_context` tool result doesn't include phase validation warnings.
- **`ReviewFinalize.tsx` provenance display** (line 333): Shows `item.provenance || "voice"` as plain purple text — no visual distinction for "auto_scope" or "companion" provenance, no confirmation workflow for auto-generated items.
- **`ReviewFinalize.tsx` photo analysis** (lines 527–548): Displays `photoType` and `autoTag` badges but no damage suggestion overlay, AI confidence indicators, or links between photos and the damage observations they detected.
- **`SupervisorDashboard.tsx`** (152 lines): Entire dashboard is a basic metrics display with no auto-scope statistics, no phase validation overview, no pipeline health indicators.

PROMPT-19 modifies the client-side code to surface everything PROMPT-18 generates.

---

## Part A — Auto-Scope Response Handling in ActiveInspection

### Goal
When `add_damage` returns `autoScope` data, the client should:
1. Parse the `autoScope` object from the response
2. Show a transient notification with the count of auto-generated items
3. Refresh the estimate panel to include the new items
4. Send the enriched result back to the voice agent so it can narrate the auto-scope

### File: `client/src/pages/ActiveInspection.tsx` — Modify add_damage Handler

**Current** (lines 288–310):
```ts
case "add_damage": {
  if (!sessionId || !currentRoomId) { result = { success: false, error: "No room selected" }; break; }
  const measurements: any = {};
  if (args.extent) measurements.extent = args.extent;
  if (args.hitCount) measurements.hitCount = args.hitCount;
  const damageHeaders = await getAuthHeaders();
  const damageRes = await fetch(`/api/inspection/${sessionId}/damages`, {
    method: "POST",
    headers: damageHeaders,
    body: JSON.stringify({
      roomId: currentRoomId,
      description: args.description,
      damageType: args.damageType,
      severity: args.severity,
      location: args.location,
      measurements: Object.keys(measurements).length > 0 ? measurements : undefined,
    }),
  });
  const damage = await damageRes.json();
  await refreshRooms();
  result = { success: true, damageId: damage.id };
  break;
}
```

**Replace with:**
```ts
case "add_damage": {
  if (!sessionId || !currentRoomId) { result = { success: false, error: "No room selected" }; break; }
  const measurements: any = {};
  if (args.extent) measurements.extent = args.extent;
  if (args.hitCount) measurements.hitCount = args.hitCount;
  const damageHeaders = await getAuthHeaders();
  const damageRes = await fetch(`/api/inspection/${sessionId}/damages`, {
    method: "POST",
    headers: damageHeaders,
    body: JSON.stringify({
      roomId: currentRoomId,
      description: args.description,
      damageType: args.damageType,
      severity: args.severity,
      location: args.location,
      measurements: Object.keys(measurements).length > 0 ? measurements : undefined,
    }),
  });
  const response = await damageRes.json();
  await refreshRooms();

  // Parse auto-scope results from PROMPT-18 enhanced response
  const autoScope = response.autoScope;
  if (autoScope && autoScope.itemsCreated > 0) {
    // Refresh estimate to show new auto-generated items
    await refreshEstimate();

    // Show transient auto-scope notification
    setAutoScopeNotification({
      visible: true,
      count: autoScope.itemsCreated,
      items: autoScope.items,
      warnings: autoScope.warnings || [],
    });
    // Auto-dismiss after 8 seconds
    setTimeout(() => setAutoScopeNotification((prev: any) => ({ ...prev, visible: false })), 8000);
  }

  // Build enriched result for voice agent — includes auto-scope summary
  result = {
    success: true,
    damageId: response.damage?.id || response.id,
    autoScope: autoScope ? {
      itemsCreated: autoScope.itemsCreated,
      summary: autoScope.items?.map((i: any) =>
        `${i.code}: ${i.description} — ${i.quantity} ${i.unit} @ $${i.unitPrice?.toFixed(2)} = $${i.totalPrice?.toFixed(2)} [${i.source}]`
      ).join("\n") || "No items matched",
      warnings: autoScope.warnings,
    } : undefined,
  };
  break;
}
```

### State & Notification Component

Add to the component's state declarations (near the other `useState` hooks, around line 100):

```ts
// Auto-scope notification state (PROMPT-19)
const [autoScopeNotification, setAutoScopeNotification] = useState<{
  visible: boolean;
  count: number;
  items: Array<{ code: string; description: string; quantity: number; unit: string; unitPrice: number; totalPrice: number; source: string }>;
  warnings: string[];
}>({ visible: false, count: 0, items: [], warnings: [] });
```

Add the `refreshEstimate` function near the other refresh functions:

```ts
// Refresh estimate data after auto-scope creates items
const refreshEstimate = useCallback(async () => {
  try {
    const headers = await getAuthHeaders();
    const res = await fetch(`/api/inspection/${sessionId}/estimate-summary`, { headers });
    if (res.ok) {
      const data = await res.json();
      setEstimateSummary(data);
    }
    // Also refresh recent line items
    const liRes = await fetch(`/api/inspection/${sessionId}/line-items?limit=5&sort=desc`, { headers });
    if (liRes.ok) {
      const items = await liRes.json();
      setRecentLineItems(items);
    }
  } catch (e) {
    console.error("Estimate refresh error:", e);
  }
}, [sessionId, getAuthHeaders]);
```

### Auto-Scope Notification Toast

Add this component inside the right panel content (insert after the Running Estimate card, around line 930):

```tsx
{/* Auto-Scope Notification Toast (PROMPT-19) */}
<AnimatePresence>
  {autoScopeNotification.visible && (
    <motion.div
      initial={{ opacity: 0, y: -10, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -10, scale: 0.95 }}
      className="bg-[#22C55E]/10 border border-[#22C55E]/30 rounded-lg p-3 space-y-1.5"
    >
      <div className="flex items-center gap-2">
        <Zap size={14} className="text-[#22C55E]" />
        <span className="text-xs font-semibold text-[#22C55E]">
          Auto-Scope: {autoScopeNotification.count} item{autoScopeNotification.count !== 1 ? "s" : ""} generated
        </span>
        <button
          onClick={() => setAutoScopeNotification((prev) => ({ ...prev, visible: false }))}
          className="ml-auto text-muted-foreground hover:text-foreground"
        >
          <X size={12} />
        </button>
      </div>
      {autoScopeNotification.items.slice(0, 3).map((item, i) => (
        <div key={i} className="flex justify-between text-[10px] text-muted-foreground pl-5">
          <span className="truncate flex-1 mr-2">
            {item.description}
            {item.source === "companion" && (
              <span className="ml-1 text-[#9D8BBF]">(companion)</span>
            )}
          </span>
          <span className="font-mono whitespace-nowrap">${item.totalPrice?.toFixed(2)}</span>
        </div>
      ))}
      {autoScopeNotification.items.length > 3 && (
        <p className="text-[10px] text-muted-foreground pl-5">
          +{autoScopeNotification.items.length - 3} more item{autoScopeNotification.items.length - 3 !== 1 ? "s" : ""}
        </p>
      )}
      {autoScopeNotification.warnings.length > 0 && (
        <div className="text-[10px] text-[#F59E0B] pl-5">
          {autoScopeNotification.warnings.map((w, i) => (
            <p key={i}>⚠ {w}</p>
          ))}
        </div>
      )}
    </motion.div>
  )}
</AnimatePresence>
```

Add `Zap` and `X` to the lucide-react imports at the top of the file if not already present.

---

## Part B — Photo Analysis Damage Suggestions

### Goal
When photo analysis returns `damageSuggestions[]` (from PROMPT-18 Part B), display them as an actionable overlay in the camera capture flow and pass them to the voice agent.

### File: `client/src/pages/ActiveInspection.tsx` — Modify Photo Capture Handler

**Current** (lines 734–745 inside `handleCameraCapture`): The photo analysis result is stored locally but the `damageSuggestions` field is not extracted.

**Modify Step 4** (around line 738, the photoResult construction):

Replace the current `photoResult` construction:
```ts
photoResult = {
  success: true,
  photoId: savedPhoto.photoId,
  message: "Photo captured and saved.",
  analysis: analysis ? {
    description: analysis.description,
    damageVisible: analysis.damageVisible,
    matchesExpected: analysis.matchesExpected,
    matchExplanation: analysis.matchExplanation,
    qualityScore: analysis.qualityScore,
  } : undefined,
};
```

**With:**
```ts
// Extract damage suggestions from PROMPT-18 enhanced response
const damageSuggestions = analysis?.damageSuggestions || [];

photoResult = {
  success: true,
  photoId: savedPhoto.photoId,
  message: "Photo captured and saved.",
  analysis: analysis ? {
    description: analysis.description,
    damageVisible: analysis.damageVisible,
    matchesExpected: analysis.matchesExpected,
    matchExplanation: analysis.matchExplanation,
    qualityScore: analysis.qualityScore,
  } : undefined,
  // NEW (PROMPT-19): damage suggestions for voice agent
  damageSuggestions: damageSuggestions.length > 0 ? damageSuggestions.map((s: any) => ({
    damageType: s.damageType,
    severity: s.severity,
    description: s.description,
    confidence: s.confidence,
    autoCreated: s.autoCreated,
  })) : undefined,
};

// If photo doesn't match what was requested, tell the agent
if (analysis && !analysis.matchesExpected) {
  photoResult.warning = `Photo may not match requested capture "${cameraMode.label}". ${analysis.matchExplanation}`;
}

// Show damage suggestion overlay if suggestions exist
if (damageSuggestions.length > 0) {
  setPhotoDamageSuggestions(damageSuggestions);
}
```

### Damage Suggestion State & Overlay

Add state declaration:
```ts
// Photo-detected damage suggestions (PROMPT-19)
const [photoDamageSuggestions, setPhotoDamageSuggestions] = useState<any[]>([]);
```

Also update the `setRecentPhotos` call in Step 3 to include `damageSuggestions`:
```ts
setRecentPhotos((prev) => [
  {
    id: savedPhoto.photoId,
    storagePath: savedPhoto.storagePath,
    thumbnail: dataUrl,
    caption: cameraMode.label,
    photoType: cameraMode.photoType,
    roomId: currentRoomId,
    analysis,
    matchesRequest: analysis?.matchesExpected ?? true,
    damageSuggestions: analysis?.damageSuggestions || [], // NEW
  },
  ...prev,
].slice(0, 50));
```

### Damage Suggestion Overlay Component

Add this overlay inside the camera mode section (after the camera overlay closes, or as a post-capture step). Insert near the camera mode conditional (around line 775):

```tsx
{/* Photo Damage Suggestions Overlay (PROMPT-19) */}
<AnimatePresence>
  {photoDamageSuggestions.length > 0 && !cameraMode.active && (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 20 }}
      className="fixed inset-x-0 bottom-0 z-40 bg-card border-t border-border shadow-lg p-4 space-y-3 max-h-[40vh] overflow-y-auto"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Camera size={14} className="text-primary" />
          <span className="text-sm font-semibold text-foreground">AI-Detected Damage</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary">
            {photoDamageSuggestions.length} suggestion{photoDamageSuggestions.length !== 1 ? "s" : ""}
          </span>
        </div>
        <button
          onClick={() => setPhotoDamageSuggestions([])}
          className="text-muted-foreground hover:text-foreground"
        >
          <X size={16} />
        </button>
      </div>

      {photoDamageSuggestions.map((suggestion: any, i: number) => (
        <div
          key={i}
          className="bg-muted/30 rounded-lg p-3 border border-border"
        >
          <div className="flex items-start justify-between">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-foreground">
                  {suggestion.damageType?.replace(/_/g, " ")}
                </span>
                <span className={cn(
                  "text-[10px] px-1.5 py-0.5 rounded-full",
                  suggestion.severity === "severe" ? "bg-red-500/10 text-red-500" :
                  suggestion.severity === "moderate" ? "bg-[#F59E0B]/10 text-[#F59E0B]" :
                  "bg-[#22C55E]/10 text-[#22C55E]"
                )}>
                  {suggestion.severity}
                </span>
                {suggestion.confidence && (
                  <span className="text-[10px] text-muted-foreground">
                    {Math.round(suggestion.confidence * 100)}% confidence
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5 truncate">{suggestion.notes || suggestion.description}</p>
            </div>
          </div>
          {suggestion.autoCreated && (
            <p className="text-[10px] text-[#22C55E] mt-1">✓ Auto-created as damage observation</p>
          )}
        </div>
      ))}

      <p className="text-[10px] text-muted-foreground italic">
        The voice agent will ask you to confirm or dismiss these suggestions.
      </p>
    </motion.div>
  )}
</AnimatePresence>
```

---

## Part C — Provenance-Aware Estimate Panel in ActiveInspection

### Goal
Distinguish auto-scoped items from manually added items in the right-panel estimate display. Auto-scoped items show a green lightning icon and companion items show a purple chain icon.

### File: `client/src/pages/ActiveInspection.tsx` — Modify Estimate Panel

**Current** (lines 950–970): Each recent line item shows description, price, category, action, quantity, unit — but no provenance indicator.

**Replace the line item rendering** (the `recentLineItems.map` block) with:

```tsx
{recentLineItems.map((item: any) => (
  <motion.div
    key={item.id}
    initial={{ opacity: 0, x: 20 }}
    animate={{ opacity: 1, x: 0 }}
    className={cn(
      "rounded-lg px-2.5 py-2 mb-1.5 border",
      item.provenance === "auto_scope"
        ? "bg-[#22C55E]/5 border-[#22C55E]/20"
        : item.provenance === "companion"
        ? "bg-[#9D8BBF]/5 border-[#9D8BBF]/20"
        : "bg-primary/5 border-border"
    )}
  >
    <div className="flex justify-between items-start">
      <div className="flex items-center gap-1.5 flex-1 min-w-0 mr-2">
        {/* Provenance icon (PROMPT-19) */}
        {item.provenance === "auto_scope" && (
          <Zap size={10} className="text-[#22C55E] shrink-0" />
        )}
        {item.provenance === "companion" && (
          <Link2 size={10} className="text-[#9D8BBF] shrink-0" />
        )}
        <p className="text-xs font-medium truncate">{item.description}</p>
      </div>
      <span className="text-xs text-accent font-mono whitespace-nowrap">
        ${(item.totalPrice || 0).toFixed(2)}
      </span>
    </div>
    <p className="text-[10px] text-muted-foreground mt-0.5">
      {item.category} · {item.action} · {item.quantity} {item.unit}
      {item.provenance && item.provenance !== "voice" && (
        <span className={cn(
          "ml-1",
          item.provenance === "auto_scope" ? "text-[#22C55E]" : "text-[#9D8BBF]"
        )}>
          · {item.provenance === "auto_scope" ? "auto-scoped" : item.provenance}
        </span>
      )}
    </p>
  </motion.div>
))}
```

Add `Link2` to lucide-react imports if not already present.

---

## Part D — Phase Stepper with Validation Integration

### Goal
When the phase advances (via voice tool or user action), call the `/api/inspection/:sessionId/validate-phase` endpoint and display any warnings as a transient overlay before allowing progression.

### File: `client/src/pages/ActiveInspection.tsx` — Enhance Phase Stepper

### Phase Validation State

Add state:
```ts
// Phase validation (PROMPT-19)
const [phaseValidation, setPhaseValidation] = useState<{
  visible: boolean;
  currentPhase: number;
  nextPhase: number;
  warnings: string[];
  missingItems: string[];
  completionScore: number;
} | null>(null);
```

### Validation Function

Add a function to call the validation endpoint:
```ts
// Validate phase transition before advancing (PROMPT-19)
const validatePhaseTransition = useCallback(async (fromPhase: number): Promise<boolean> => {
  if (!sessionId) return true;
  try {
    const headers = await getAuthHeaders();
    const res = await fetch(`/api/inspection/${sessionId}/validate-phase`, { headers });
    if (!res.ok) return true; // Don't block on validation failure

    const validation = await res.json();
    if (validation.warnings && validation.warnings.length > 0) {
      setPhaseValidation({
        visible: true,
        currentPhase: validation.currentPhase,
        nextPhase: validation.nextPhase,
        warnings: validation.warnings,
        missingItems: validation.missingItems || [],
        completionScore: validation.completionScore || 0,
      });
      return false; // Show warnings first
    }
    return true; // No warnings, proceed
  } catch (e) {
    console.error("Phase validation error:", e);
    return true; // Don't block on error
  }
}, [sessionId, getAuthHeaders]);
```

### Modify set_inspection_context Tool Handler

Find the `set_inspection_context` case in `executeToolCall` and modify it to include phase validation. The current handler likely updates `currentPhase` and `currentArea`. **Add** validation before sending the result:

```ts
case "set_inspection_context": {
  // ... existing logic to set context ...

  // If phase is changing, validate the transition (PROMPT-19)
  if (args.phase && args.phase !== currentPhase) {
    const headers = await getAuthHeaders();
    let phaseWarnings: string[] = [];
    try {
      const valRes = await fetch(`/api/inspection/${sessionId}/validate-phase`, { headers });
      if (valRes.ok) {
        const validation = await valRes.json();
        phaseWarnings = validation.warnings || [];

        // Show validation overlay if warnings exist
        if (phaseWarnings.length > 0) {
          setPhaseValidation({
            visible: true,
            currentPhase: currentPhase,
            nextPhase: args.phase,
            warnings: phaseWarnings,
            missingItems: validation.missingItems || [],
            completionScore: validation.completionScore || 0,
          });
        }
      }
    } catch (e) {
      console.error("Phase validation in tool call:", e);
    }

    setCurrentPhase(args.phase);
    result = {
      ...result,
      phaseValidation: phaseWarnings.length > 0 ? {
        warnings: phaseWarnings,
        message: `Phase ${currentPhase} has ${phaseWarnings.length} warning(s) before advancing to Phase ${args.phase}`,
      } : undefined,
    };
  }
  break;
}
```

### Phase Validation Overlay Component

Insert this overlay inside the main layout (above or near the camera overlay):

```tsx
{/* Phase Validation Overlay (PROMPT-19) */}
<AnimatePresence>
  {phaseValidation?.visible && (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
      onClick={() => setPhaseValidation(null)}
    >
      <motion.div
        initial={{ scale: 0.95 }}
        animate={{ scale: 1 }}
        exit={{ scale: 0.95 }}
        onClick={(e) => e.stopPropagation()}
        className="bg-card rounded-xl border border-border shadow-xl max-w-md w-full p-5 space-y-4"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-[#F59E0B]/10 flex items-center justify-center">
            <AlertTriangle size={20} className="text-[#F59E0B]" />
          </div>
          <div>
            <h3 className="font-display font-bold text-foreground">
              Phase {phaseValidation.currentPhase} → {phaseValidation.nextPhase}
            </h3>
            <p className="text-xs text-muted-foreground">
              {phaseValidation.completionScore}% complete — {phaseValidation.warnings.length} item{phaseValidation.warnings.length !== 1 ? "s" : ""} to review
            </p>
          </div>
        </div>

        <div className="space-y-2 max-h-[40vh] overflow-y-auto">
          {phaseValidation.warnings.map((warning, i) => (
            <div key={i} className="flex items-start gap-2 p-2.5 bg-[#F59E0B]/5 rounded-lg border border-[#F59E0B]/20">
              <AlertTriangle size={12} className="text-[#F59E0B] shrink-0 mt-0.5" />
              <p className="text-xs text-foreground">{warning}</p>
            </div>
          ))}
        </div>

        {phaseValidation.missingItems.length > 0 && (
          <div>
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Missing Items</p>
            <ul className="space-y-1">
              {phaseValidation.missingItems.map((item, i) => (
                <li key={i} className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <span className="w-1 h-1 rounded-full bg-muted-foreground shrink-0" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex gap-2 pt-2">
          <Button
            variant="outline"
            size="sm"
            className="flex-1 text-xs"
            onClick={() => setPhaseValidation(null)}
          >
            Stay & Fix
          </Button>
          <Button
            size="sm"
            className="flex-1 text-xs bg-[#F59E0B] hover:bg-[#F59E0B]/90 text-white"
            onClick={() => {
              setPhaseValidation(null);
              // Phase already advanced — this just dismisses the warning
            }}
          >
            Proceed Anyway
          </Button>
        </div>
      </motion.div>
    </motion.div>
  )}
</AnimatePresence>
```

Add `AlertTriangle` to lucide-react imports if not already present.

---

## Part E — Enhanced Provenance Display in ReviewFinalize

### Goal
The ReviewFinalize estimate tab should visually distinguish auto-scoped, companion, and manually-added line items. Auto-scoped items get a green "Auto-Scoped" badge. Companion items get a purple "Companion" badge. Both provenance types are collapsible as a group per damage observation.

### File: `client/src/pages/ReviewFinalize.tsx` — Modify Line Item Display

**Current** (line 333): Provenance shown as plain text `{item.provenance || "voice"}` in purple.

**Replace** the provenance display at line 333 and its surrounding context (lines 329–334):

```tsx
{/* Current line 329-334 — the metadata row */}
<div className="flex gap-3 mt-0.5 text-[10px] text-muted-foreground">
  <span>{item.quantity} {item.unit}</span>
  <span>@ ${item.unitPrice?.toFixed(2)}</span>
  <span>{item.depreciationType || "Recoverable"}</span>
  {/* PROMPT-19: Provenance badge with visual distinction */}
  {item.provenance === "auto_scope" ? (
    <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-[#22C55E]/10 text-[#22C55E] font-medium">
      <Zap size={8} /> Auto-Scoped
    </span>
  ) : item.provenance === "companion" ? (
    <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-[#9D8BBF]/10 text-[#9D8BBF] font-medium">
      <Link2 size={8} /> Companion
    </span>
  ) : (
    <span className="text-[#9D8BBF]">{item.provenance || "voice"}</span>
  )}
</div>
```

Add `Zap` and `Link2` to the lucide-react imports at the top of ReviewFinalize.tsx.

### Auto-Scope Summary Banner

At the top of the Estimate tab content (inside `EstimateTab`, before the category list), add a summary banner showing auto-scope statistics:

```tsx
{/* Auto-Scope Summary (PROMPT-19) */}
{(() => {
  const allItems = categories.flatMap((cat: any) =>
    (cat.rooms || []).flatMap((room: any) => room.items || [])
  );
  const autoScopedCount = allItems.filter((i: any) => i.provenance === "auto_scope").length;
  const companionCount = allItems.filter((i: any) => i.provenance === "companion").length;
  const autoTotal = allItems
    .filter((i: any) => i.provenance === "auto_scope" || i.provenance === "companion")
    .reduce((sum: number, i: any) => sum + (i.totalPrice || 0), 0);

  if (autoScopedCount === 0 && companionCount === 0) return null;

  return (
    <div className="mx-4 mt-3 mb-1 bg-[#22C55E]/5 border border-[#22C55E]/20 rounded-lg p-3">
      <div className="flex items-center gap-2 mb-1">
        <Zap size={12} className="text-[#22C55E]" />
        <span className="text-xs font-semibold text-[#22C55E]">Intelligent Scope</span>
      </div>
      <div className="flex gap-4 text-[10px] text-muted-foreground">
        <span>{autoScopedCount} auto-scoped item{autoScopedCount !== 1 ? "s" : ""}</span>
        {companionCount > 0 && <span>{companionCount} companion item{companionCount !== 1 ? "s" : ""}</span>}
        <span className="font-mono">${autoTotal.toFixed(2)} auto-generated</span>
      </div>
    </div>
  );
})()}
```

---

## Part F — Photo Intelligence in ReviewFinalize

### Goal
Enhance the Photos tab to show AI analysis confidence, damage detection badges, and links to the damage observations and scope items generated from each photo.

### File: `client/src/pages/ReviewFinalize.tsx` — Modify Photos Tab

**Current** (lines 527–548): Photo grid shows thumbnail placeholder, photoType badge, and autoTag overlay.

### Photo Grid Enhancement

**Replace** the photo grid item (lines 527–548) with:

```tsx
{group.photos.map((photo: any) => (
  <button
    key={photo.id}
    onClick={() => setSelectedPhoto(photo)}
    className={cn(
      "aspect-square bg-muted rounded-lg border overflow-hidden relative group hover:ring-2 hover:ring-primary transition-all",
      photo.analysis?.damageVisible?.length > 0
        ? "border-[#F59E0B]/40"
        : "border-border"
    )}
  >
    <div className="w-full h-full flex items-center justify-center bg-muted">
      <ImageIcon size={24} className="text-muted-foreground/30" />
    </div>

    {/* Photo Type Badge */}
    {photo.photoType && (
      <span className="absolute top-1 right-1 text-[8px] bg-black/60 text-white px-1 py-0.5 rounded">
        {photo.photoType.replace(/_/g, " ")}
      </span>
    )}

    {/* AI Damage Detection Badge (PROMPT-19) */}
    {photo.analysis?.damageVisible?.length > 0 && (
      <span className="absolute top-1 left-1 text-[8px] bg-[#F59E0B]/90 text-white px-1 py-0.5 rounded flex items-center gap-0.5">
        <AlertTriangle size={7} />
        {photo.analysis.damageVisible.length} damage{photo.analysis.damageVisible.length !== 1 ? "s" : ""}
      </span>
    )}

    {/* Quality Score Indicator (PROMPT-19) */}
    {photo.analysis?.qualityScore && (
      <span className={cn(
        "absolute bottom-6 right-1 w-4 h-4 rounded-full flex items-center justify-center text-[7px] font-bold text-white",
        photo.analysis.qualityScore >= 4 ? "bg-[#22C55E]" :
        photo.analysis.qualityScore >= 3 ? "bg-[#F59E0B]" :
        "bg-red-500"
      )}>
        {photo.analysis.qualityScore}
      </span>
    )}

    {/* Auto Tag Overlay */}
    {photo.autoTag && (
      <span className="absolute bottom-0 left-0 right-0 text-[9px] bg-black/60 text-white px-1.5 py-0.5 truncate">
        {photo.autoTag}
      </span>
    )}
  </button>
))}
```

### Enhanced Photo Detail Modal

When `selectedPhoto` is set and a photo detail modal is shown, enhance it to display full analysis data. Find the photo detail/modal section in the component and add:

```tsx
{/* Photo Analysis Detail (PROMPT-19) */}
{selectedPhoto?.analysis && (
  <div className="space-y-3 mt-3">
    {/* AI Description */}
    <div className="bg-muted/30 rounded-lg p-3">
      <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">AI Analysis</p>
      <p className="text-sm text-foreground">{selectedPhoto.analysis.description}</p>
      {selectedPhoto.analysis.qualityScore && (
        <div className="flex items-center gap-2 mt-2">
          <span className="text-[10px] text-muted-foreground">Quality:</span>
          <div className="flex gap-0.5">
            {[1, 2, 3, 4, 5].map((n) => (
              <span
                key={n}
                className={cn(
                  "w-2 h-2 rounded-full",
                  n <= selectedPhoto.analysis.qualityScore ? "bg-[#22C55E]" : "bg-border"
                )}
              />
            ))}
          </div>
        </div>
      )}
    </div>

    {/* Detected Damage List */}
    {selectedPhoto.analysis.damageVisible?.length > 0 && (
      <div>
        <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Detected Damage</p>
        <div className="space-y-1.5">
          {selectedPhoto.analysis.damageVisible.map((damage: any, i: number) => (
            <div key={i} className="flex items-center gap-2 p-2 bg-[#F59E0B]/5 rounded border border-[#F59E0B]/20">
              <AlertTriangle size={12} className="text-[#F59E0B] shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-foreground">{damage.type}</p>
                <p className="text-[10px] text-muted-foreground">{damage.severity} — {damage.notes}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    )}

    {/* Match Status */}
    {selectedPhoto.analysis.matchesExpected === false && (
      <div className="bg-red-500/5 border border-red-500/20 rounded-lg p-2.5">
        <p className="text-xs text-red-500 font-medium">Photo may not match request</p>
        <p className="text-[10px] text-muted-foreground mt-0.5">{selectedPhoto.analysis.matchExplanation}</p>
      </div>
    )}
  </div>
)}
```

Add `AlertTriangle` to ReviewFinalize's lucide-react imports if not already present.

---

## Part G — Supervisor Dashboard Enhancements

### Goal
Replace the static metrics display with live data that includes auto-scope statistics, phase validation summaries, and pipeline health indicators.

### File: `client/src/pages/SupervisorDashboard.tsx`

**Current** (152 lines): Four metric cards (total claims, active sessions, avg inspection time, total estimates), a team members table, and an active inspections table. All data comes from `/api/admin/dashboard`, `/api/admin/users`, and `/api/admin/active-sessions`.

### Enhanced Metrics Interface

**Replace** the `DashboardMetrics` interface (lines 14–19):

```ts
interface DashboardMetrics {
  totalClaims: number;
  activeSessions: number;
  avgInspectionTime: number;
  totalEstimateValue: number;
  // PROMPT-19 additions
  autoScopeItemsCreated?: number;
  avgAutoScopePerDamage?: number;
  catalogMatchRate?: number;
  avgCompletenessScore?: number;
}
```

### Enhanced Metric Cards

**Replace** the metrics grid (lines 60–80) with:

```tsx
<div className="grid grid-cols-1 md:grid-cols-4 gap-4">
  <div className="bg-white p-6 rounded-lg shadow border border-gray-200">
    <p className="text-sm font-medium text-gray-600">Total Claims</p>
    <p className="text-3xl font-bold mt-2">{metrics?.totalClaims || 0}</p>
  </div>

  <div className="bg-white p-6 rounded-lg shadow border border-gray-200">
    <p className="text-sm font-medium text-gray-600">Active Inspections</p>
    <p className="text-3xl font-bold mt-2 text-green-600">{metrics?.activeSessions || 0}</p>
  </div>

  <div className="bg-white p-6 rounded-lg shadow border border-gray-200">
    <p className="text-sm font-medium text-gray-600">Avg Inspection Time</p>
    <p className="text-3xl font-bold mt-2">{Math.round(metrics?.avgInspectionTime || 0)} min</p>
  </div>

  <div className="bg-white p-6 rounded-lg shadow border border-gray-200">
    <p className="text-sm font-medium text-gray-600">Total Estimates</p>
    <p className="text-3xl font-bold mt-2">
      ${(metrics?.totalEstimateValue || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
    </p>
  </div>
</div>

{/* Auto-Scope & Intelligence Metrics (PROMPT-19) */}
<div className="grid grid-cols-1 md:grid-cols-3 gap-4">
  <div className="bg-white p-6 rounded-lg shadow border border-green-200">
    <div className="flex items-center gap-2">
      <Zap className="h-4 w-4 text-green-500" />
      <p className="text-sm font-medium text-gray-600">Auto-Scope Items</p>
    </div>
    <p className="text-3xl font-bold mt-2 text-green-600">{metrics?.autoScopeItemsCreated || 0}</p>
    <p className="text-xs text-gray-500 mt-1">
      Avg {(metrics?.avgAutoScopePerDamage || 0).toFixed(1)} items/damage
    </p>
  </div>

  <div className="bg-white p-6 rounded-lg shadow border border-purple-200">
    <div className="flex items-center gap-2">
      <Target className="h-4 w-4 text-purple-500" />
      <p className="text-sm font-medium text-gray-600">Catalog Match Rate</p>
    </div>
    <p className="text-3xl font-bold mt-2 text-purple-600">
      {Math.round(metrics?.catalogMatchRate || 0)}%
    </p>
    <p className="text-xs text-gray-500 mt-1">Items priced from catalog</p>
  </div>

  <div className="bg-white p-6 rounded-lg shadow border border-blue-200">
    <div className="flex items-center gap-2">
      <CheckCircle2 className="h-4 w-4 text-blue-500" />
      <p className="text-sm font-medium text-gray-600">Avg Completeness</p>
    </div>
    <p className="text-3xl font-bold mt-2 text-blue-600">
      {Math.round(metrics?.avgCompletenessScore || 0)}%
    </p>
    <p className="text-xs text-gray-500 mt-1">Phase validation score</p>
  </div>
</div>
```

Add `Zap, Target, CheckCircle2` to lucide-react imports.

### Enhanced Active Sessions Table

**Replace** the active sessions table (lines 121–147) to include phase validation status:

```tsx
<Table>
  <TableHeader>
    <TableRow>
      <TableHead>Claim #</TableHead>
      <TableHead>Adjuster</TableHead>
      <TableHead>Phase</TableHead>
      <TableHead>Completeness</TableHead>
      <TableHead>Status</TableHead>
      <TableHead>Started</TableHead>
    </TableRow>
  </TableHeader>
  <TableBody>
    {activeSessions.map((session) => (
      <TableRow key={session.id}>
        <TableCell className="font-mono font-bold">{session.claimNumber}</TableCell>
        <TableCell>{session.adjusterName}</TableCell>
        <TableCell>
          <div className="flex items-center gap-1.5">
            <span className="text-center">{session.currentPhase}</span>
            <span className="text-[10px] text-muted-foreground">/8</span>
          </div>
        </TableCell>
        <TableCell>
          {/* Completeness indicator (PROMPT-19) */}
          <div className="flex items-center gap-2">
            <div className="w-16 h-1.5 rounded-full bg-gray-200 overflow-hidden">
              <div
                className={cn(
                  "h-full rounded-full transition-all",
                  (session as any).completenessScore >= 80 ? "bg-green-500" :
                  (session as any).completenessScore >= 50 ? "bg-yellow-500" :
                  "bg-red-500"
                )}
                style={{ width: `${(session as any).completenessScore || 0}%` }}
              />
            </div>
            <span className="text-xs text-muted-foreground">{(session as any).completenessScore || 0}%</span>
          </div>
        </TableCell>
        <TableCell>
          <Badge variant="default">{session.status}</Badge>
        </TableCell>
        <TableCell className="text-sm text-muted-foreground">
          {new Date(session.startedAt).toLocaleDateString()}
        </TableCell>
      </TableRow>
    ))}
  </TableBody>
</Table>
```

### Backend Support: Dashboard Metrics Endpoint Enhancement

**File: `server/routes.ts`** — Modify the `/api/admin/dashboard` endpoint to include auto-scope statistics.

Add after the existing metrics calculation:

```ts
// PROMPT-19: Auto-scope statistics for supervisor dashboard
const autoScopeItems = await db
  .select({ count: sql<number>`count(*)` })
  .from(lineItems)
  .where(eq(lineItems.provenance, "auto_scope"));

const totalDamages = await db
  .select({ count: sql<number>`count(*)` })
  .from(damageObservations);

const catalogMatchItems = await db
  .select({ count: sql<number>`count(*)` })
  .from(lineItems)
  .where(sql`${lineItems.xactCode} IS NOT NULL AND ${lineItems.xactCode} != ''`);

const totalLineItems = await db
  .select({ count: sql<number>`count(*)` })
  .from(lineItems);

// Append to the metrics response:
res.json({
  ...existingMetrics,
  autoScopeItemsCreated: autoScopeItems[0]?.count || 0,
  avgAutoScopePerDamage: (totalDamages[0]?.count || 0) > 0
    ? (autoScopeItems[0]?.count || 0) / (totalDamages[0]?.count || 1)
    : 0,
  catalogMatchRate: (totalLineItems[0]?.count || 0) > 0
    ? ((catalogMatchItems[0]?.count || 0) / (totalLineItems[0]?.count || 1)) * 100
    : 0,
});
```

For `avgCompletenessScore`, query active sessions and average their completeness:

```ts
// Average completeness across active sessions
const activeSessions = await db
  .select()
  .from(inspectionSessions)
  .where(eq(inspectionSessions.status, "active"));

let avgCompleteness = 0;
if (activeSessions.length > 0) {
  // Use the existing completeness endpoint logic or compute inline
  // For simplicity, use the session's cached completeness if available
  const completenessValues = activeSessions.map((s) => (s as any).completenessScore || 0);
  avgCompleteness = completenessValues.reduce((a, b) => a + b, 0) / completenessValues.length;
}
// Add to response: avgCompletenessScore: avgCompleteness
```

---

## Part H — Active Sessions Completeness in Backend

### Goal
The `/api/admin/active-sessions` endpoint should return `completenessScore` for each session so the supervisor dashboard can display it.

### File: `server/routes.ts` — Enhance Active Sessions Endpoint

In the GET `/api/admin/active-sessions` handler, after fetching the sessions, loop through and compute completeness for each:

```ts
// Enhance active sessions with completeness scores (PROMPT-19)
const enrichedSessions = await Promise.all(
  activeSessions.map(async (session) => {
    let completenessScore = 0;
    try {
      // Reuse the completeness calculation logic from the completeness endpoint
      const rooms = await storage.getRooms(session.id);
      const items = await storage.getLineItems(session.id);
      const photos = await storage.getPhotos(session.id);
      const damages = await storage.getDamagesForSession(session.id);

      const totalChecks = 4; // baseline checks
      let passed = 0;
      if (photos.filter(p => p.photoType === "overview").length >= 4) passed++;
      if (rooms.length > 0) passed++;
      if (damages.length > 0) passed++;
      if (items.length > 0) passed++;
      completenessScore = Math.round((passed / totalChecks) * 100);
    } catch (e) {
      // Non-blocking
    }
    return { ...session, completenessScore };
  })
);

res.json(enrichedSessions);
```

---

## Verification Checklist

1. **Auto-scope notification:** Create damage via voice tool with `damageType: "water_intrusion"`, `severity: "moderate"` → verify green toast appears with item count and descriptions in the right panel
2. **Voice agent narration:** After add_damage, verify the voice agent's response includes auto-scope summary (e.g., "I've auto-generated 4 scope items...")
3. **Estimate panel provenance:** Verify auto-scoped items show green lightning icon, companion items show purple chain icon, and voice items show no icon
4. **Photo damage suggestions:** Capture a photo of damage → verify `damageSuggestions` overlay appears with damage types, severity, and confidence
5. **Phase validation overlay:** Advance from Phase 3 to Phase 4 with an exterior room having damages but no line items → verify warning overlay appears with "Stay & Fix" and "Proceed Anyway" buttons
6. **Phase validation in voice:** Verify `set_inspection_context` tool result includes `phaseValidation.warnings` when transitioning with gaps
7. **ReviewFinalize provenance badges:** Navigate to Review & Finalize → verify "Auto-Scoped" green badge, "Companion" purple badge, and "voice" default text display correctly
8. **ReviewFinalize auto-scope summary:** Verify the green "Intelligent Scope" banner shows counts and dollar totals for auto-generated items
9. **Photo intelligence badges:** In the Photos tab, verify damage detection count badge (amber), quality score dot (green/amber/red), and detailed analysis in the modal
10. **Supervisor dashboard metrics:** Verify Auto-Scope Items, Catalog Match Rate, and Avg Completeness cards display with correct values from the backend
11. **Supervisor active sessions:** Verify completeness progress bar and percentage appear for each active session row

---

## Files Modified

| File | Action | Description |
|------|--------|-------------|
| `client/src/pages/ActiveInspection.tsx` | **Modify** | Parse autoScope in add_damage, show auto-scope toast, display damage suggestions from photos, provenance icons in estimate panel, phase validation overlay, wire set_inspection_context to validate-phase endpoint |
| `client/src/pages/ReviewFinalize.tsx` | **Modify** | Provenance badges (Auto-Scoped, Companion), auto-scope summary banner, photo intelligence badges, photo detail analysis panel |
| `client/src/pages/SupervisorDashboard.tsx` | **Modify** | Auto-scope metrics row, catalog match rate card, completeness scores in active sessions table |
| `server/routes.ts` | **Modify** | Enhance `/api/admin/dashboard` with auto-scope statistics, enhance `/api/admin/active-sessions` with completeness scores |

## Files Referenced (Read-Only)

| File | Reason |
|------|--------|
| `server/scopeAssemblyHook.ts` | Auto-scope response shape (`AutoScopeResult`) |
| `server/photoScopeBridge.ts` | Damage suggestion response shape (`PhotoDamageSuggestion`) |
| `server/phaseValidation.ts` | Phase validation response shape (`PhaseValidationResult`) |
| `shared/schema.ts` | `provenance` field on `lineItems`, `analysis` JSONB on `inspectionPhotos` |
| `server/realtime.ts` | Voice tool definitions and system instruction format |

---

## Summary

PROMPT-19 is the UI surface layer that makes PROMPT-18's backend intelligence visible and interactive:

- **Part A** wires the `autoScope` response from damage creation into a transient toast notification and enriches the voice agent's tool result so it can narrate auto-generated scope items
- **Part B** extracts `damageSuggestions` from photo analysis and displays them as an actionable overlay that the voice agent can confirm or dismiss
- **Part C** adds provenance-aware styling to the estimate panel — green lightning for auto-scoped items, purple chain for companions
- **Part D** integrates phase validation into the phase stepper flow, showing a warning overlay with "Stay & Fix" or "Proceed Anyway" options before advancing
- **Part E** upgrades provenance display in ReviewFinalize with visual badges (Auto-Scoped, Companion) and adds an auto-scope summary banner with aggregate statistics
- **Part F** enhances the Photos tab with AI damage detection badges, quality scores, and full analysis detail modals
- **Part G** transforms the SupervisorDashboard with auto-scope metrics, catalog match rates, and per-session completeness bars
- **Part H** backs the dashboard enhancements with enriched API responses from the admin endpoints

Together with PROMPT-18, this completes the damage→scope→UI pipeline: every damage observation auto-generates scope items, every photo analysis surfaces damage suggestions, every phase transition validates completeness, and every auto-generated artifact is visually distinguished throughout the interface.
