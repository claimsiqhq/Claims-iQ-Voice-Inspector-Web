import { Upload, Loader2, Brain, CheckCircle2, Circle } from "lucide-react";
import { cn } from "@/lib/utils";

const STAGES = ["uploaded", "processing", "extracted", "reviewed"] as const;

const STAGE_CONFIG: Record<string, { label: string; icon: typeof Upload; color: string; bgColor: string }> = {
  uploaded: { label: "Uploaded", icon: Upload, color: "text-blue-600", bgColor: "bg-blue-100" },
  processing: { label: "Processing", icon: Loader2, color: "text-amber-600", bgColor: "bg-amber-100" },
  extracted: { label: "Extracted", icon: Brain, color: "text-purple-600", bgColor: "bg-purple-100" },
  reviewed: { label: "Reviewed", icon: CheckCircle2, color: "text-emerald-600", bgColor: "bg-emerald-100" },
};

export type DocStage = "empty" | "uploaded" | "processing" | "extracted" | "reviewed";

export function getDocStage(status: string | undefined, confirmedByUser?: boolean): DocStage {
  if (!status || status === "empty") return "empty";
  if (status === "uploaded") return "uploaded";
  if (status === "processing") return "processing";
  if ((status === "parsed" || status === "complete") && confirmedByUser) return "reviewed";
  if (status === "parsed" || status === "complete") return "extracted";
  return "uploaded";
}

export function StageIndicator({ stage }: { stage: string }) {
  const stageIndex = STAGES.indexOf(stage as any);
  if (stageIndex < 0) return null;

  return (
    <div className="flex items-center gap-0.5">
      {STAGES.map((s, i) => {
        const config = STAGE_CONFIG[s];
        const Icon = config.icon;
        const isActive = i <= stageIndex;
        const isCurrent = i === stageIndex;

        return (
          <div key={s} className="flex items-center">
            {i > 0 && (
              <div
                className={cn(
                  "h-0.5 w-3 md:w-5 transition-colors",
                  isActive ? "bg-emerald-400" : "bg-gray-200"
                )}
              />
            )}
            <div className="relative group">
              <div
                className={cn(
                  "h-5 w-5 md:h-6 md:w-6 rounded-full flex items-center justify-center transition-all",
                  isCurrent ? `${config.bgColor} ${config.color} ring-2 ring-offset-1 ring-current` :
                  isActive ? "bg-emerald-100 text-emerald-600" :
                  "bg-gray-100 text-gray-300"
                )}
              >
                {isActive ? (
                  <Icon className={cn("h-2.5 w-2.5 md:h-3 md:w-3", s === "processing" && isCurrent && "animate-spin")} />
                ) : (
                  <Circle className="h-2.5 w-2.5 md:h-3 md:w-3" />
                )}
              </div>
              <span className={cn(
                "absolute -bottom-4 left-1/2 -translate-x-1/2 text-[8px] md:text-[9px] whitespace-nowrap font-medium transition-colors",
                isCurrent ? config.color : isActive ? "text-emerald-600" : "text-gray-300"
              )}>
                {config.label}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
