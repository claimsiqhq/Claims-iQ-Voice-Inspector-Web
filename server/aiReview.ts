import { IStorage } from "./storage";

export interface ScopeGap {
  room: string;
  issue: string;
  suggestion: string;
  severity: "critical" | "warning" | "info";
}

export interface PricingFlag {
  lineItemId: number;
  description: string;
  issue: string;
  expectedRange: string;
}

export interface DocumentationGap {
  type: string;
  details: string;
}

export interface ComplianceIssue {
  rule: string;
  status: "pass" | "fail";
  details: string;
}

export interface Suggestion {
  description: string;
  estimatedImpact: string;
  priority: "high" | "medium" | "low";
}

export interface EstimateReview {
  overallScore: number; // 1-100
  scopeGaps: ScopeGap[];
  pricingFlags: PricingFlag[];
  documentationGaps: DocumentationGap[];
  complianceIssues: ComplianceIssue[];
  suggestions: Suggestion[];
  summary: string;
}

/**
 * AI-powered estimate review using GPT-4o
 * Checks for scope gaps, pricing anomalies, documentation issues, and compliance
 */
export async function reviewEstimate(sessionId: number, storage: IStorage): Promise<EstimateReview> {
  // Fetch all data for review
  const session = await storage.getInspectionSession(sessionId);
  if (!session) throw new Error("Session not found");

  const claim = await storage.getClaim(session.claimId);
  const items = await storage.getLineItems(sessionId);
  const rooms = await storage.getRooms(sessionId);
  const damages = await storage.getDamagesForSession(sessionId);
  const photos = await storage.getPhotos(sessionId);
  const moistureReadings = await storage.getMoistureReadingsForSession(sessionId);
  const summary = await storage.getEstimateSummary(sessionId);

  // Build context for AI review
  const estimateContext = {
    claimNumber: claim?.claimNumber,
    perilType: claim?.perilType,
    dateOfLoss: claim?.dateOfLoss,
    totalRCV: summary.totalRCV,
    totalACV: summary.totalACV,
    itemCount: items.length,
    roomCount: rooms.length,
    photoCount: photos.length,
    damageCount: damages.length,
    moistureReadingCount: moistureReadings.length,
    rooms: rooms.map((r) => ({
      id: r.id,
      name: r.name,
      type: r.roomType,
      damages: damages.filter((d) => d.roomId === r.id).length,
      photos: photos.filter((p) => p.roomId === r.id).length,
      lineItems: items.filter((li) => li.roomId === r.id).length,
    })),
    lineItems: items.map((item) => ({
      id: item.id,
      category: item.category,
      description: item.description,
      quantity: item.quantity,
      unit: item.unit,
      unitPrice: item.unitPrice,
      totalPrice: item.totalPrice,
      room: rooms.find((r) => r.id === item.roomId)?.name,
    })),
    damages: damages.map((d) => ({
      id: d.id,
      description: d.description,
      type: d.damageType,
      severity: d.severity,
      room: rooms.find((r) => r.id === d.roomId)?.name,
    })),
  };

  // Call GPT-4o for analysis
  const prompt = `You are an expert insurance adjuster and estimator. Analyze this property damage estimate and review for:

1. **Scope Gaps**: Rooms with damage but missing line items, missing related work (e.g., painting after drywall), incomplete sequences
2. **Pricing Anomalies**: Line items with unusual unit prices, quantities that don't match room dimensions
3. **Documentation Issues**: Rooms without photos, damage without photographic support, missing overview photos
4. **Compliance**: For water damage, verify moisture protocol was followed. Check for required supporting documentation.
5. **Suggestions**: Common companion items that should be added based on observed damage type

ESTIMATE DATA:
${JSON.stringify(estimateContext, null, 2)}

Respond with a JSON object:
{
  "overallScore": <number 1-100>,
  "scopeGaps": [{"room": "string", "issue": "string", "suggestion": "string", "severity": "critical|warning|info"}],
  "pricingFlags": [{"lineItemId": <number>, "description": "string", "issue": "string", "expectedRange": "string"}],
  "documentationGaps": [{"type": "string", "details": "string"}],
  "complianceIssues": [{"rule": "string", "status": "pass|fail", "details": "string"}],
  "suggestions": [{"description": "string", "estimatedImpact": "string", "priority": "high|medium|low"}],
  "summary": "2-3 sentence executive summary"
}`;

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],
        temperature: 0.3,
        max_tokens: 2000,
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error("GPT-4o review error:", err);
      // Return a safe default
      return getDefaultReview();
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "{}";
    const review = JSON.parse(content);

    return {
      overallScore: Math.max(1, Math.min(100, review.overallScore || 50)),
      scopeGaps: review.scopeGaps || [],
      pricingFlags: review.pricingFlags || [],
      documentationGaps: review.documentationGaps || [],
      complianceIssues: review.complianceIssues || [],
      suggestions: review.suggestions || [],
      summary: review.summary || "Review completed.",
    };
  } catch (error) {
    console.error("Review error:", error);
    return getDefaultReview();
  }
}

function getDefaultReview(): EstimateReview {
  return {
    overallScore: 50,
    scopeGaps: [],
    pricingFlags: [],
    documentationGaps: [],
    complianceIssues: [
      {
        rule: "Estimate Completeness",
        status: "fail",
        details: "AI review unavailable. Manual review recommended.",
      },
    ],
    suggestions: [],
    summary: "Automated review unavailable. Please review manually.",
  };
}
