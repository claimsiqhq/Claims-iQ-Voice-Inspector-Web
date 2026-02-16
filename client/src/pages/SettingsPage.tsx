import { useState } from "react";
import Layout from "@/components/Layout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Trash2,
  Loader2,
  AlertTriangle,
  Database,
  Shield,
  BookOpen,
  User,
  Mic,
  ClipboardList,
  Camera,
  FileOutput,
  Bell,
  Palette,
  LogOut,
  RotateCcw,
} from "lucide-react";
import OnboardingWizard, { resetOnboarding } from "@/components/OnboardingWizard";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useSettings } from "@/hooks/use-settings";
import { useAuth } from "@/contexts/AuthContext";
import { useLocation } from "wouter";
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

interface Claim {
  id: number;
  claimNumber: string;
}

// --- Reusable setting row components ---

function SettingRow({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`flex items-center justify-between gap-4 py-3 ${className}`}>
      {children}
    </div>
  );
}

function SettingLabel({ title, description }: { title: string; description?: string }) {
  return (
    <div className="flex-1 min-w-0">
      <Label className="text-sm font-medium text-foreground">{title}</Label>
      {description && (
        <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
      )}
    </div>
  );
}

function SectionHeader({
  icon: Icon,
  title,
  description,
  variant = "default",
}: {
  icon: React.ElementType;
  title: string;
  description: string;
  variant?: "default" | "destructive";
}) {
  const isDestructive = variant === "destructive";
  return (
    <div className="flex items-start gap-3 mb-4">
      <div
        className={`h-10 w-10 rounded-lg flex items-center justify-center shrink-0 ${
          isDestructive ? "bg-destructive/10" : "bg-primary/10"
        }`}
      >
        <Icon className={`h-5 w-5 ${isDestructive ? "text-destructive" : "text-primary"}`} />
      </div>
      <div>
        <h3 className={`font-display font-semibold ${isDestructive ? "text-destructive" : "text-foreground"}`}>
          {title}
        </h3>
        <p className="text-sm text-muted-foreground mt-0.5">{description}</p>
      </div>
    </div>
  );
}

// --- Main Settings Page ---

export default function SettingsPage() {
  const [purgeDialogOpen, setPurgeDialogOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const { toast } = useToast();
  const { settings, updateSetting, resetSettings } = useSettings();
  const { user, signOut } = useAuth();
  const [, setLocation] = useLocation();

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
            Manage your account, preferences, and application configuration.
          </p>
        </div>

        {/* ===== Profile & Account ===== */}
        <Card className="p-5 border-border">
          <SectionHeader
            icon={User}
            title="Profile & Account"
            description="Your account information and session."
          />
          <div className="space-y-1 ml-13">
            <SettingRow>
              <SettingLabel title="Profile" description="Manage your name, title, and avatar photo." />
              <Button
                data-testid="button-go-to-profile"
                variant="outline"
                size="sm"
                className="gap-2 shrink-0"
                onClick={() => setLocation("/profile")}
              >
                <User className="h-4 w-4" />
                Edit Profile
              </Button>
            </SettingRow>
            <Separator />
            <SettingRow>
              <SettingLabel title="Email" description="Managed through your login account." />
              <span data-testid="text-profile-email" className="text-sm text-muted-foreground truncate max-w-[180px]">{user?.email || "---"}</span>
            </SettingRow>
            <Separator />
            <SettingRow>
              <SettingLabel title="Role" description="Assigned by your administrator." />
              <span data-testid="text-profile-role" className="text-sm text-muted-foreground capitalize">{user?.role || "---"}</span>
            </SettingRow>
            <Separator />
            <div className="pt-3">
              <Button
                data-testid="button-sign-out"
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={() => signOut()}
              >
                <LogOut className="h-4 w-4" />
                Sign Out
              </Button>
            </div>
          </div>
        </Card>

        {/* ===== Voice & AI Assistant ===== */}
        <Card className="p-5 border-border">
          <SectionHeader
            icon={Mic}
            title="Voice & AI Assistant"
            description="Configure the AI voice assistant behavior during inspections."
          />
          <div className="space-y-1 ml-13">
            <SettingRow>
              <SettingLabel
                title="Voice Model"
                description="The AI assistant's speaking voice."
              />
              <Select
                value={settings.voiceModel}
                onValueChange={(v) => updateSetting("voiceModel", v)}
              >
                <SelectTrigger className="w-[140px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="alloy">Alloy</SelectItem>
                  <SelectItem value="echo">Echo</SelectItem>
                  <SelectItem value="fable">Fable</SelectItem>
                  <SelectItem value="onyx">Onyx</SelectItem>
                  <SelectItem value="nova">Nova</SelectItem>
                  <SelectItem value="shimmer">Shimmer</SelectItem>
                </SelectContent>
              </Select>
            </SettingRow>
            <Separator />

            <SettingRow>
              <SettingLabel
                title="Voice Speed"
                description={`Playback rate: ${settings.voiceSpeed.toFixed(1)}x`}
              />
              <div className="w-[140px]">
                <Slider
                  value={[settings.voiceSpeed]}
                  min={0.5}
                  max={2.0}
                  step={0.1}
                  onValueChange={([v]) => updateSetting("voiceSpeed", v)}
                />
              </div>
            </SettingRow>
            <Separator />

            <SettingRow>
              <SettingLabel
                title="Assistant Verbosity"
                description="How detailed the AI responses are."
              />
              <Select
                value={settings.assistantVerbosity}
                onValueChange={(v) => updateSetting("assistantVerbosity", v as any)}
              >
                <SelectTrigger className="w-[140px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="concise">Concise</SelectItem>
                  <SelectItem value="normal">Normal</SelectItem>
                  <SelectItem value="detailed">Detailed</SelectItem>
                </SelectContent>
              </Select>
            </SettingRow>
            <Separator />

            <SettingRow>
              <SettingLabel
                title="Push-to-Talk Mode"
                description="Hold mic button to speak instead of hands-free."
              />
              <Switch
                checked={settings.pushToTalk}
                onCheckedChange={(v) => updateSetting("pushToTalk", v)}
              />
            </SettingRow>
            <Separator />

            <SettingRow>
              <SettingLabel
                title="Auto-Record on Room Entry"
                description="Start recording when entering a new room."
              />
              <Switch
                checked={settings.autoRecordOnRoomEntry}
                onCheckedChange={(v) => updateSetting("autoRecordOnRoomEntry", v)}
              />
            </SettingRow>
            <Separator />

            <SettingRow>
              <SettingLabel
                title="Silence Detection"
                description="Sensitivity for detecting end of speech."
              />
              <Select
                value={settings.silenceDetectionSensitivity}
                onValueChange={(v) => updateSetting("silenceDetectionSensitivity", v as any)}
              >
                <SelectTrigger className="w-[140px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                </SelectContent>
              </Select>
            </SettingRow>
          </div>
        </Card>

        {/* ===== Inspection Workflows ===== */}
        <Card className="p-5 border-border">
          <SectionHeader
            icon={ClipboardList}
            title="Inspection Workflows"
            description="Configure peril-specific inspection flows for the voice agent."
          />
          <div className="ml-13 mt-2">
            <Button
              variant="outline"
              className="w-full justify-start gap-2 overflow-hidden"
              onClick={() => setLocation("/settings/workflows")}
            >
              <ClipboardList className="h-4 w-4 flex-shrink-0" />
              <span className="truncate">Manage Inspection Flows</span>
              <span className="ml-auto text-xs text-muted-foreground flex-shrink-0 hidden sm:inline">Hail, Wind, Water, Fire, General</span>
            </Button>
          </div>
        </Card>

        {/* ===== Inspection Defaults ===== */}
        <Card className="p-5 border-border">
          <SectionHeader
            icon={ClipboardList}
            title="Inspection Defaults"
            description="Default values applied to new inspections and estimates."
          />
          <div className="space-y-1 ml-13">
            <SettingRow>
              <SettingLabel
                title="Price List Region"
                description="Regional pricing for line items."
              />
              <Select
                value={settings.defaultRegion}
                onValueChange={(v) => updateSetting("defaultRegion", v)}
              >
                <SelectTrigger className="w-[160px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="US-NATIONAL">US National</SelectItem>
                  <SelectItem value="US-NORTHEAST">Northeast</SelectItem>
                  <SelectItem value="US-SOUTHEAST">Southeast</SelectItem>
                  <SelectItem value="US-MIDWEST">Midwest</SelectItem>
                  <SelectItem value="US-SOUTHWEST">Southwest</SelectItem>
                  <SelectItem value="US-WEST">West</SelectItem>
                  <SelectItem value="US-NORTHWEST">Northwest</SelectItem>
                </SelectContent>
              </Select>
            </SettingRow>
            <Separator />

            <SettingRow>
              <SettingLabel
                title="Overhead Rate"
                description={`Default: ${settings.defaultOverheadPercent}%`}
              />
              <div className="w-[140px]">
                <Slider
                  value={[settings.defaultOverheadPercent]}
                  min={0}
                  max={25}
                  step={1}
                  onValueChange={([v]) => updateSetting("defaultOverheadPercent", v)}
                />
              </div>
            </SettingRow>
            <Separator />

            <SettingRow>
              <SettingLabel
                title="Profit Rate"
                description={`Default: ${settings.defaultProfitPercent}%`}
              />
              <div className="w-[140px]">
                <Slider
                  value={[settings.defaultProfitPercent]}
                  min={0}
                  max={25}
                  step={1}
                  onValueChange={([v]) => updateSetting("defaultProfitPercent", v)}
                />
              </div>
            </SettingRow>
            <Separator />

            <SettingRow>
              <SettingLabel
                title="Tax Rate"
                description={`Default: ${settings.defaultTaxRate}%`}
              />
              <div className="w-[140px]">
                <Slider
                  value={[settings.defaultTaxRate]}
                  min={0}
                  max={15}
                  step={0.25}
                  onValueChange={([v]) => updateSetting("defaultTaxRate", v)}
                />
              </div>
            </SettingRow>
            <Separator />

            <SettingRow>
              <SettingLabel
                title="Default Waste Factor"
                description={`Material waste: ${settings.defaultWasteFactor}%`}
              />
              <div className="w-[140px]">
                <Slider
                  value={[settings.defaultWasteFactor]}
                  min={0}
                  max={25}
                  step={1}
                  onValueChange={([v]) => updateSetting("defaultWasteFactor", v)}
                />
              </div>
            </SettingRow>
            <Separator />

            <SettingRow>
              <SettingLabel
                title="Measurement Units"
                description="Unit system for dimensions and quantities."
              />
              <Select
                value={settings.measurementUnit}
                onValueChange={(v) => updateSetting("measurementUnit", v as any)}
              >
                <SelectTrigger className="w-[140px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="imperial">Imperial (ft)</SelectItem>
                  <SelectItem value="metric">Metric (m)</SelectItem>
                </SelectContent>
              </Select>
            </SettingRow>
            <Separator />

            <SettingRow>
              <SettingLabel
                title="Auto-Generate Briefing"
                description="Generate inspection briefing after all documents are parsed."
              />
              <Switch
                checked={settings.autoGenerateBriefing}
                onCheckedChange={(v) => updateSetting("autoGenerateBriefing", v)}
              />
            </SettingRow>
            <Separator />

            <SettingRow>
              <SettingLabel
                title="Require Property Verification"
                description="Mandate a verification photo before starting inspection."
              />
              <Switch
                checked={settings.requirePhotoVerification}
                onCheckedChange={(v) => updateSetting("requirePhotoVerification", v)}
              />
            </SettingRow>
          </div>
        </Card>

        {/* ===== Photo & Camera ===== */}
        <Card className="p-5 border-border">
          <SectionHeader
            icon={Camera}
            title="Photo & Camera"
            description="Control photo capture quality and automatic processing."
          />
          <div className="space-y-1 ml-13">
            <SettingRow>
              <SettingLabel
                title="Photo Quality"
                description="Resolution of captured inspection photos."
              />
              <Select
                value={settings.photoQuality}
                onValueChange={(v) => updateSetting("photoQuality", v as any)}
              >
                <SelectTrigger className="w-[140px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low (faster)</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High (best)</SelectItem>
                </SelectContent>
              </Select>
            </SettingRow>
            <Separator />

            <SettingRow>
              <SettingLabel
                title="Auto-Analyze Photos"
                description="Use AI to automatically analyze and tag photos."
              />
              <Switch
                checked={settings.autoAnalyzePhotos}
                onCheckedChange={(v) => updateSetting("autoAnalyzePhotos", v)}
              />
            </SettingRow>
            <Separator />

            <SettingRow>
              <SettingLabel
                title="Timestamp Watermark"
                description="Add date/time overlay on captured photos."
              />
              <Switch
                checked={settings.timestampWatermark}
                onCheckedChange={(v) => updateSetting("timestampWatermark", v)}
              />
            </SettingRow>
            <Separator />

            <SettingRow>
              <SettingLabel
                title="GPS Tagging"
                description="Embed GPS coordinates in photo metadata."
              />
              <Switch
                checked={settings.gpsTagging}
                onCheckedChange={(v) => updateSetting("gpsTagging", v)}
              />
            </SettingRow>
          </div>
        </Card>

        {/* ===== Export & Reports ===== */}
        <Card className="p-5 border-border">
          <SectionHeader
            icon={FileOutput}
            title="Export & Reports"
            description="Configure export formatting and report branding."
          />
          <div className="space-y-1 ml-13">
            <SettingRow>
              <SettingLabel
                title="Company / Firm Name"
                description="Appears on exported reports and estimates."
              />
              <Input
                className="w-[200px]"
                placeholder="Your company name"
                value={settings.companyName}
                onChange={(e) => updateSetting("companyName", e.target.value)}
              />
            </SettingRow>
            <Separator />

            <SettingRow>
              <SettingLabel
                title="Adjuster License #"
                description="Your state adjuster license number."
              />
              <Input
                className="w-[200px]"
                placeholder="License number"
                value={settings.adjusterLicenseNumber}
                onChange={(e) => updateSetting("adjusterLicenseNumber", e.target.value)}
              />
            </SettingRow>
            <Separator />

            <SettingRow>
              <SettingLabel
                title="Export Format"
                description="Default format for inspection exports."
              />
              <Select
                value={settings.exportFormat}
                onValueChange={(v) => updateSetting("exportFormat", v as any)}
              >
                <SelectTrigger className="w-[140px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="esx">ESX Only</SelectItem>
                  <SelectItem value="pdf">PDF Only</SelectItem>
                  <SelectItem value="both">ESX + PDF</SelectItem>
                </SelectContent>
              </Select>
            </SettingRow>
            <Separator />

            <SettingRow>
              <SettingLabel
                title="Include Voice Transcript"
                description="Attach full voice conversation log to export."
              />
              <Switch
                checked={settings.includeTranscriptInExport}
                onCheckedChange={(v) => updateSetting("includeTranscriptInExport", v)}
              />
            </SettingRow>
            <Separator />

            <SettingRow>
              <SettingLabel
                title="Include Photos"
                description="Embed inspection photos in exported report."
              />
              <Switch
                checked={settings.includePhotosInExport}
                onCheckedChange={(v) => updateSetting("includePhotosInExport", v)}
              />
            </SettingRow>
          </div>
        </Card>

        {/* ===== Notifications ===== */}
        <Card className="p-5 border-border">
          <SectionHeader
            icon={Bell}
            title="Notifications"
            description="Control alerts and notification preferences."
          />
          <div className="space-y-1 ml-13">
            <SettingRow>
              <SettingLabel
                title="Push Notifications"
                description="Receive browser push notifications."
              />
              <Switch
                checked={settings.pushNotifications}
                onCheckedChange={(v) => updateSetting("pushNotifications", v)}
              />
            </SettingRow>
            <Separator />

            <SettingRow>
              <SettingLabel
                title="Sound Effects"
                description="Play audio for events (photo captured, phase complete, etc.)."
              />
              <Switch
                checked={settings.soundEffects}
                onCheckedChange={(v) => updateSetting("soundEffects", v)}
              />
            </SettingRow>
            <Separator />

            <SettingRow>
              <SettingLabel
                title="Claim Status Alerts"
                description="Notify when claim status changes."
              />
              <Switch
                checked={settings.claimStatusAlerts}
                onCheckedChange={(v) => updateSetting("claimStatusAlerts", v)}
              />
            </SettingRow>
            <Separator />

            <SettingRow>
              <SettingLabel
                title="Inspection Reminders"
                description="Remind about incomplete inspections."
              />
              <Switch
                checked={settings.inspectionReminders}
                onCheckedChange={(v) => updateSetting("inspectionReminders", v)}
              />
            </SettingRow>
          </div>
        </Card>

        {/* ===== Display & Appearance ===== */}
        <Card className="p-5 border-border">
          <SectionHeader
            icon={Palette}
            title="Display & Appearance"
            description="Customize the look and feel of the application."
          />
          <div className="space-y-1 ml-13">
            <SettingRow>
              <SettingLabel
                title="Theme"
                description="Application color scheme."
              />
              <Select
                value={settings.theme}
                onValueChange={(v) => updateSetting("theme", v as any)}
              >
                <SelectTrigger className="w-[140px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="light">Light</SelectItem>
                  <SelectItem value="dark">Dark</SelectItem>
                  <SelectItem value="system">System</SelectItem>
                </SelectContent>
              </Select>
            </SettingRow>
            <Separator />

            <SettingRow>
              <SettingLabel
                title="Font Size"
                description="Base text size throughout the app."
              />
              <Select
                value={settings.fontSize}
                onValueChange={(v) => updateSetting("fontSize", v as any)}
              >
                <SelectTrigger className="w-[140px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="small">Small</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="large">Large</SelectItem>
                </SelectContent>
              </Select>
            </SettingRow>
            <Separator />

            <SettingRow>
              <SettingLabel
                title="Compact Mode"
                description="Reduce spacing for more content on screen."
              />
              <Switch
                checked={settings.compactMode}
                onCheckedChange={(v) => updateSetting("compactMode", v)}
              />
            </SettingRow>
            <Separator />

            <SettingRow>
              <SettingLabel
                title="Show Phase Numbers"
                description="Display phase numbers in the inspection workflow."
              />
              <Switch
                checked={settings.showPhaseNumbers}
                onCheckedChange={(v) => updateSetting("showPhaseNumbers", v)}
              />
            </SettingRow>
          </div>
        </Card>

        {/* ===== Data Overview ===== */}
        <Card className="p-5 border-border">
          <SectionHeader
            icon={Database}
            title="Data Overview"
            description="Summary of data stored in the system."
          />
          <div className="ml-13">
            <p className="text-sm text-muted-foreground">
              You currently have <span className="font-semibold text-foreground">{claims.length}</span> claim{claims.length !== 1 ? "s" : ""} in the system.
            </p>
          </div>
        </Card>

        {/* ===== Onboarding Guide ===== */}
        <Card className="p-5 border-border">
          <SectionHeader
            icon={BookOpen}
            title="Onboarding Guide"
            description="Review the guided walkthrough of key features and workflows."
          />
          <div className="ml-13">
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
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
        </Card>

        {/* ===== Reset Preferences ===== */}
        <Card className="p-5 border-border">
          <SectionHeader
            icon={RotateCcw}
            title="Reset Preferences"
            description="Restore all settings on this page to their default values."
          />
          <div className="ml-13">
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={() => setResetDialogOpen(true)}
            >
              <RotateCcw className="h-4 w-4" />
              Reset All to Defaults
            </Button>
          </div>
        </Card>

        {/* ===== Danger Zone ===== */}
        <Card className="p-5 border-destructive/30 bg-destructive/5">
          <SectionHeader
            icon={AlertTriangle}
            title="Danger Zone"
            description="Destructive actions that cannot be undone. All associated documents, inspections, photos, and reports will be permanently removed."
            variant="destructive"
          />
          <div className="ml-13">
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
        </Card>

        {/* ===== About ===== */}
        <Card className="p-5 border-border">
          <SectionHeader
            icon={Shield}
            title="About"
            description="Claims IQ Voice Inspector v1.0"
          />
          <div className="ml-13">
            <p className="text-xs text-muted-foreground">
              AI-powered voice-driven field inspection assistant for insurance adjusters.
            </p>
          </div>
        </Card>
      </div>

      {/* ===== Purge Confirmation Dialog ===== */}
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

      {/* ===== Reset Settings Confirmation Dialog ===== */}
      <AlertDialog open={resetDialogOpen} onOpenChange={setResetDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <RotateCcw className="h-5 w-5" />
              Reset All Settings
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will restore all preferences (voice, inspection defaults, photo, export,
              notifications, and display settings) to their original default values.
              Your account data and claims are not affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                resetSettings();
                setResetDialogOpen(false);
                toast({ title: "Settings reset", description: "All preferences restored to defaults." });
              }}
            >
              Reset to Defaults
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <OnboardingWizard open={showOnboarding} onComplete={() => setShowOnboarding(false)} />
    </Layout>
  );
}
