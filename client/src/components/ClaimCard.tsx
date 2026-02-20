import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge, PerilBadge } from "./StatusBadge";
import { Calendar, MapPin, ChevronRight, User, Trash2, Loader2, AlertCircle } from "lucide-react";
import { Link } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

interface InspectionProgress {
  sessionId: number;
  completenessScore: number;
  currentPhase: number;
  phaseName: string;
  totalPhases: number;
  totalRooms: number;
  completedRooms: number;
  damageCount: number;
  lineItemCount: number;
  photoCount: number;
  missing: string[];
}

interface ClaimCardProps {
  id: number;
  claimNumber: string;
  insuredName: string | null;
  address: string | null;
  peril: string | null;
  status: string;
  dateOfLoss: string | null;
  documentCount?: number;
  inspectionProgress?: InspectionProgress | null;
}

function ProgressRing({ score, size = 36 }: { score: number; size?: number }) {
  const strokeWidth = 3;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;
  const color = score >= 75 ? "#22c55e" : score >= 40 ? "#eab308" : score >= 15 ? "#f97316" : "#ef4444";
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="currentColor" strokeWidth={strokeWidth} className="text-muted/20" />
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={color} strokeWidth={strokeWidth} strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round" />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold" style={{ color }}>{score}%</span>
    </div>
  );
}

export default function ClaimCard({
  id,
  claimNumber,
  insuredName,
  address,
  peril,
  status,
  dateOfLoss,
  documentCount = 0,
  inspectionProgress,
}: ClaimCardProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const { toast } = useToast();

  const deleteMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", `/api/claims/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/claims"] });
      queryClient.invalidateQueries({ queryKey: ["/api/claims/my-claims"] });
      queryClient.invalidateQueries({ queryKey: ["/api/documents/all"] });
      setDialogOpen(false);
      toast({ title: "Claim deleted", description: `Claim ${claimNumber} has been removed.` });
    },
    onError: (error: Error) => {
      toast({ title: "Delete failed", description: error.message, variant: "destructive" });
    },
  });

  const getNextRoute = () => {
    const s = status.toLowerCase().replace(/\s+/g, "_");
    switch (s) {
      case "extractions_confirmed": return `/review/${id}`;
      case "briefing_ready": return `/briefing/${id}`;
      case "inspecting":
      case "in_progress": return `/inspection/${id}`;
      case "review": return `/inspection/${id}/review`;
      case "inspection_complete":
      case "completed":
      case "closed": return `/inspection/${id}/review`;
      default:
        return `/upload/${id}`;
    }
  };

  return (
    <Card
      data-testid={`card-claim-${id}`}
      className="hover:shadow-lg transition-all border-border group h-full relative"
    >
      <div className="absolute top-2 right-2 z-10">
        <AlertDialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <AlertDialogTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
              onClick={(e) => e.stopPropagation()}
              data-testid={`button-delete-claim-${id}`}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent onClick={(e) => e.stopPropagation()}>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Claim {claimNumber}?</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently delete this claim and all its related data including documents,
                extractions, inspections, photos, and reports. This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deleteMutation.isPending}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={(e) => {
                  e.preventDefault();
                  deleteMutation.mutate();
                }}
                disabled={deleteMutation.isPending}
                data-testid={`button-confirm-delete-${id}`}
              >
                {deleteMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Deleting...
                  </>
                ) : (
                  "Delete Claim"
                )}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      <Link href={getNextRoute()}>
        <div className="p-4 flex flex-col gap-3 h-full cursor-pointer">
          <div className="flex items-center justify-between gap-2 pr-8">
            <span
              data-testid={`text-claim-number-${id}`}
              className="font-mono text-sm font-semibold text-foreground/70 tracking-wide"
            >
              {claimNumber}
            </span>
            <StatusBadge status={status} />
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1.5">
              <User className="h-4 w-4 text-primary shrink-0" />
              <h3 className="font-display font-bold text-base text-foreground truncate group-hover:text-primary transition-colors">
                {insuredName || "Unknown Insured"}
              </h3>
            </div>

            <div className="flex items-start gap-2 text-sm text-muted-foreground">
              <MapPin className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span className="line-clamp-2 leading-snug">{address || "No address"}</span>
            </div>
          </div>

          {inspectionProgress && (
            <div className="flex items-center gap-3 py-2 px-2 bg-muted/30 rounded-md">
              <ProgressRing score={inspectionProgress.completenessScore} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-semibold text-foreground">
                    Phase {inspectionProgress.currentPhase}/{inspectionProgress.totalPhases}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {inspectionProgress.phaseName}
                  </span>
                </div>
                <div className="text-[11px] text-muted-foreground mt-0.5">
                  {inspectionProgress.completedRooms}/{inspectionProgress.totalRooms} rooms
                  {inspectionProgress.damageCount > 0 && <> &middot; {inspectionProgress.damageCount} damages</>}
                  {inspectionProgress.photoCount > 0 && <> &middot; {inspectionProgress.photoCount} photos</>}
                </div>
                {inspectionProgress.missing.length > 0 && (
                  <div className="flex items-center gap-1 mt-1">
                    <AlertCircle className="h-3 w-3 text-amber-500 shrink-0" />
                    <span className="text-[10px] text-amber-600 dark:text-amber-400 truncate">
                      {inspectionProgress.missing.join(" · ")}
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="flex items-center justify-between pt-3 border-t border-border/50">
            <div className="flex items-center gap-3">
              {peril && <PerilBadge peril={peril} />}
              {dateOfLoss && (
                <div className="flex items-center text-xs text-muted-foreground gap-1">
                  <Calendar className="h-3 w-3" />
                  <span>DOL {dateOfLoss}</span>
                </div>
              )}
            </div>
            <ChevronRight className="h-4 w-4 text-muted-foreground/40 group-hover:text-primary group-hover:translate-x-0.5 transition-all shrink-0" />
          </div>
        </div>
      </Link>
    </Card>
  );
}
