import { useState } from "react";
import Layout from "@/components/Layout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Trash2, Loader2, AlertTriangle, Database, Shield, BookOpen } from "lucide-react";
import OnboardingWizard, { resetOnboarding } from "@/components/OnboardingWizard";
import { useMutation, useQuery } from "@tanstack/react-query";
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
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";

interface Claim {
  id: number;
  claimNumber: string;
}

export default function SettingsPage() {
  const [purgeDialogOpen, setPurgeDialogOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [showOnboarding, setShowOnboarding] = useState(false);
  const { toast } = useToast();

  const { data: claims = [] } = useQuery<Claim[]>({
    queryKey: ["/api/claims"],
  });

  const purgeMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", "/api/claims/purge-all");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/claims"] });
      queryClient.invalidateQueries({ queryKey: ["/api/documents/all"] });
      setPurgeDialogOpen(false);
      setConfirmText("");
      toast({ title: "All data purged", description: "All claims and related data have been removed." });
    },
    onError: (error: Error) => {
      toast({ title: "Purge failed", description: error.message, variant: "destructive" });
    },
  });

  return (
    <Layout title="Settings">
      <div className="flex flex-col space-y-6 max-w-2xl">
        <div>
          <h2 className="text-2xl md:text-3xl font-display font-bold text-foreground">Settings</h2>
          <p className="text-sm md:text-base text-muted-foreground mt-1">
            Manage your application settings and data.
          </p>
        </div>

        <Card className="p-5 border-border">
          <div className="flex items-start gap-3">
            <div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center shrink-0">
              <Database className="h-5 w-5 text-muted-foreground" />
            </div>
            <div>
              <h3 className="font-display font-semibold text-foreground">Data Overview</h3>
              <p className="text-sm text-muted-foreground mt-0.5">
                You currently have <span className="font-semibold text-foreground">{claims.length}</span> claim{claims.length !== 1 ? "s" : ""} in the system.
              </p>
            </div>
          </div>
        </Card>

        <Card className="p-5 border-destructive/30 bg-destructive/5">
          <div className="flex items-start gap-3">
            <div className="h-10 w-10 rounded-lg bg-destructive/10 flex items-center justify-center shrink-0">
              <AlertTriangle className="h-5 w-5 text-destructive" />
            </div>
            <div className="flex-1">
              <h3 className="font-display font-semibold text-destructive">Danger Zone</h3>
              <p className="text-sm text-muted-foreground mt-1">
                These actions are destructive and cannot be undone. All associated documents,
                inspections, photos, and reports will be permanently removed.
              </p>

              <div className="mt-4">
                <Button
                  variant="destructive"
                  className="gap-2"
                  onClick={() => setPurgeDialogOpen(true)}
                  disabled={claims.length === 0}
                  data-testid="button-purge-all"
                >
                  <Trash2 className="h-4 w-4" />
                  Purge All Claims & Data
                </Button>
                {claims.length === 0 && (
                  <p className="text-xs text-muted-foreground mt-2">No claims to purge.</p>
                )}
              </div>
            </div>
          </div>
        </Card>

        <Card className="p-5 border-border">
          <div className="flex items-start gap-3">
            <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
              <BookOpen className="h-5 w-5 text-primary" />
            </div>
            <div className="flex-1">
              <h3 className="font-display font-semibold text-foreground">Onboarding Guide</h3>
              <p className="text-sm text-muted-foreground mt-0.5">
                Review the guided walkthrough of key features and workflows.
              </p>
              <Button
                variant="outline"
                size="sm"
                className="mt-3 gap-2"
                onClick={() => {
                  resetOnboarding();
                  setShowOnboarding(true);
                }}
                data-testid="button-replay-onboarding"
              >
                <BookOpen className="h-4 w-4" />
                Replay Onboarding
              </Button>
            </div>
          </div>
        </Card>

        <Card className="p-5 border-border">
          <div className="flex items-start gap-3">
            <div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center shrink-0">
              <Shield className="h-5 w-5 text-muted-foreground" />
            </div>
            <div>
              <h3 className="font-display font-semibold text-foreground">About</h3>
              <p className="text-sm text-muted-foreground mt-0.5">
                Claims IQ Voice Inspector v1.0
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                AI-powered voice-driven field inspection assistant for insurance adjusters.
              </p>
            </div>
          </div>
        </Card>
      </div>

      <AlertDialog open={purgeDialogOpen} onOpenChange={(open) => {
        setPurgeDialogOpen(open);
        if (!open) setConfirmText("");
      }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-destructive flex items-center gap-2">
              <AlertTriangle className="h-5 w-5" />
              Purge All Data
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-3">
              <span className="block">
                This will permanently delete <span className="font-semibold">{claims.length} claim{claims.length !== 1 ? "s" : ""}</span> and
                ALL associated data including:
              </span>
              <ul className="list-disc pl-5 space-y-1 text-sm">
                <li>All uploaded documents (PDFs)</li>
                <li>All AI extractions and briefings</li>
                <li>All inspection sessions, rooms, and damages</li>
                <li>All inspection photos</li>
                <li>All moisture readings and voice transcripts</li>
                <li>All line items and export data</li>
              </ul>
              <span className="block font-medium text-destructive">
                This action cannot be undone.
              </span>
              <span className="block text-sm">
                Type <span className="font-mono font-bold">PURGE</span> to confirm:
              </span>
              <Input
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder="Type PURGE to confirm"
                className="font-mono"
                data-testid="input-purge-confirm"
              />
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={purgeMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(e) => {
                e.preventDefault();
                purgeMutation.mutate();
              }}
              disabled={confirmText !== "PURGE" || purgeMutation.isPending}
              data-testid="button-confirm-purge"
            >
              {purgeMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Purging...
                </>
              ) : (
                "Purge Everything"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <OnboardingWizard open={showOnboarding} onComplete={() => setShowOnboarding(false)} />
    </Layout>
  );
}
