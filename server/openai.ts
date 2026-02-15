export async function analyzePhotoDamage(_imageUrl: string): Promise<{
  damageType?: string;
  description?: string;
  damageDetections?: unknown[];
  overallSeverity?: number;
  damageTypes?: unknown[];
  suggestedRepairs?: unknown[];
}> {
  return {
    damageType: "unknown",
    description: "Analysis not configured",
    damageDetections: [],
    overallSeverity: 0,
    damageTypes: [],
    suggestedRepairs: [],
  };
}
