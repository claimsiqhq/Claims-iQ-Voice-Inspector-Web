import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Info, CheckCircle, ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";

interface LayoutIssue {
  severity: "BLOCKER" | "WARNING" | "INFO";
  code: string;
  message: string;
  suggestion?: string;
}

interface LayoutValidationResult {
  ok: boolean;
  issues: LayoutIssue[];
  summary: {
    totalRooms: number;
    placedRooms: number;
    orphanedRooms: number;
    totalFloorAreaSF: number;
    expectedAreaSF: number | null;
    areaDeltaPct: number | null;
    sharedWallMismatches: number;
    gapCount: number;
  };
}

interface Props {
  sessionId: number;
  getAuthHeaders: () => Record<string, string>;
  compact?: boolean;
}

export default function LayoutValidationBanner({ sessionId, getAuthHeaders, compact = false }: Props) {
  const [expanded, setExpanded] = useState(false);

  const { data, isLoading } = useQuery<LayoutValidationResult>({
    queryKey: ["/api/inspection", sessionId, "layout", "validate"],
    queryFn: async () => {
      const res = await fetch(`/api/inspection/${sessionId}/layout/validate`, {
        headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error("Failed to validate layout");
      return res.json();
    },
    enabled: !!sessionId,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  if (isLoading || !data) return null;

  const warnings = data.issues.filter((i) => i.severity === "WARNING");
  const infos = data.issues.filter((i) => i.severity === "INFO");
  const blockers = data.issues.filter((i) => i.severity === "BLOCKER");

  if (data.issues.length === 0) {
    if (compact) return null;
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 bg-green-500/10 border border-green-500/20 rounded-md text-xs text-green-700 dark:text-green-400" data-testid="layout-validation-ok">
        <CheckCircle size={14} />
        <span>Layout valid — {data.summary.totalRooms} rooms, {data.summary.totalFloorAreaSF.toLocaleString()} SF</span>
      </div>
    );
  }

  const hasProblems = blockers.length > 0 || warnings.length > 0;
  const borderColor = blockers.length > 0 ? "border-red-500/30" : warnings.length > 0 ? "border-amber-500/30" : "border-blue-500/20";
  const bgColor = blockers.length > 0 ? "bg-red-500/10" : warnings.length > 0 ? "bg-amber-500/10" : "bg-blue-500/10";
  const textColor = blockers.length > 0 ? "text-red-700 dark:text-red-400" : warnings.length > 0 ? "text-amber-700 dark:text-amber-400" : "text-blue-700 dark:text-blue-400";

  const summaryParts: string[] = [];
  if (data.summary.orphanedRooms > 0) summaryParts.push(`${data.summary.orphanedRooms} disconnected`);
  if (data.summary.sharedWallMismatches > 0) summaryParts.push(`${data.summary.sharedWallMismatches} wall mismatches`);
  if (data.summary.areaDeltaPct !== null && Math.abs(data.summary.areaDeltaPct) > 25) {
    summaryParts.push(`area ${data.summary.areaDeltaPct > 0 ? "+" : ""}${data.summary.areaDeltaPct}%`);
  }

  return (
    <div className={`${bgColor} ${borderColor} border rounded-md text-xs ${textColor}`} data-testid="layout-validation-banner">
      <button
        className="flex items-center gap-2 px-3 py-1.5 w-full text-left"
        onClick={() => setExpanded(!expanded)}
        data-testid="button-toggle-layout-issues"
      >
        {hasProblems ? <AlertTriangle size={14} /> : <Info size={14} />}
        <span className="flex-1">
          {blockers.length > 0 && `${blockers.length} layout error${blockers.length > 1 ? "s" : ""}`}
          {blockers.length > 0 && warnings.length > 0 && ", "}
          {warnings.length > 0 && `${warnings.length} warning${warnings.length > 1 ? "s" : ""}`}
          {(blockers.length > 0 || warnings.length > 0) && infos.length > 0 && ", "}
          {infos.length > 0 && `${infos.length} note${infos.length > 1 ? "s" : ""}`}
          {summaryParts.length > 0 && ` — ${summaryParts.join(", ")}`}
        </span>
        {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>

      {expanded && (
        <div className="px-3 pb-2 space-y-1.5 border-t border-inherit pt-1.5">
          {data.issues.map((issue, i) => (
            <div key={i} className="flex items-start gap-2" data-testid={`layout-issue-${issue.code}-${i}`}>
              {issue.severity === "BLOCKER" ? (
                <AlertTriangle size={12} className="text-red-500 mt-0.5 shrink-0" />
              ) : issue.severity === "WARNING" ? (
                <AlertTriangle size={12} className="text-amber-500 mt-0.5 shrink-0" />
              ) : (
                <Info size={12} className="text-blue-500 mt-0.5 shrink-0" />
              )}
              <div>
                <p className="leading-tight">{issue.message}</p>
                {issue.suggestion && (
                  <p className="text-[10px] opacity-75 mt-0.5">{issue.suggestion}</p>
                )}
              </div>
            </div>
          ))}
          <div className="pt-1 text-[10px] opacity-60">
            {data.summary.placedRooms}/{data.summary.totalRooms} rooms placed • {data.summary.totalFloorAreaSF.toLocaleString()} SF total
            {data.summary.expectedAreaSF && ` • ${data.summary.expectedAreaSF.toLocaleString()} SF expected`}
          </div>
        </div>
      )}
    </div>
  );
}
