import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { FileText, Upload, CheckCircle, Briefcase, Search, Star } from "lucide-react";

interface StatusBadgeProps {
  status: string;
  className?: string;
}

interface PerilBadgeProps {
  peril: string;
  className?: string;
}

const STATUS_CONFIG: Record<string, { label: string; icon: typeof FileText; colorClass: string }> = {
  draft: {
    label: "Draft",
    icon: FileText,
    colorClass: "bg-gray-100 text-gray-600 border-gray-200",
  },
  documents_uploaded: {
    label: "Uploaded",
    icon: Upload,
    colorClass: "bg-blue-50 text-blue-700 border-blue-200",
  },
  extractions_confirmed: {
    label: "Confirmed",
    icon: CheckCircle,
    colorClass: "bg-indigo-50 text-indigo-700 border-indigo-200",
  },
  briefing_ready: {
    label: "Ready",
    icon: Briefcase,
    colorClass: "bg-primary/10 text-primary border-primary/20",
  },
  inspecting: {
    label: "Inspecting",
    icon: Search,
    colorClass: "bg-amber-50 text-amber-700 border-amber-200",
  },
  complete: {
    label: "Complete",
    icon: Star,
    colorClass: "bg-green-50 text-green-700 border-green-200",
  },
};

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const normalized = status.toLowerCase().replace(/\s+/g, "_");
  const config = STATUS_CONFIG[normalized] || {
    label: status,
    icon: FileText,
    colorClass: "bg-muted text-muted-foreground",
  };
  const Icon = config.icon;

  return (
    <Badge
      variant="outline"
      className={cn(
        "font-medium text-xs px-2 py-0.5 border gap-1 whitespace-nowrap shrink-0",
        config.colorClass,
        className,
      )}
    >
      <Icon className="h-3 w-3" />
      {config.label}
    </Badge>
  );
}

const PERIL_CONFIG: Record<string, string> = {
  hail: "bg-primary text-white",
  water: "bg-blue-600 text-white",
  fire: "bg-red-600 text-white",
  wind: "bg-teal-600 text-white",
  freeze: "bg-cyan-600 text-white",
  multi: "bg-gray-700 text-white",
};

export function PerilBadge({ peril, className }: PerilBadgeProps) {
  const normalized = peril.toLowerCase();
  const colorClass = PERIL_CONFIG[normalized] || "bg-muted text-muted-foreground";
  const display = peril.charAt(0).toUpperCase() + peril.slice(1);

  return (
    <Badge className={cn("font-medium text-xs border-0 px-2 py-0.5", colorClass, className)}>
      {display}
    </Badge>
  );
}
