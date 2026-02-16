import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  FileText,
  Upload,
  Brain,
  Mic,
  ClipboardCheck,
  Download,
  ChevronRight,
  ChevronLeft,
  Sparkles,
} from "lucide-react";

const ONBOARDING_KEY = "claims-iq-onboarding-completed";

interface Step {
  icon: typeof FileText;
  iconColor: string;
  iconBg: string;
  title: string;
  description: string;
  details: string[];
}

const steps: Step[] = [
  {
    icon: Sparkles,
    iconColor: "text-primary",
    iconBg: "bg-primary/10",
    title: "Welcome to Claims IQ",
    description:
      "Your AI-powered voice inspection assistant. Let's walk through how to streamline your insurance field inspections.",
    details: [
      "Automate document analysis with AI",
      "Conduct voice-guided inspections",
      "Generate professional reports instantly",
    ],
  },
  {
    icon: FileText,
    iconColor: "text-blue-600",
    iconBg: "bg-blue-50",
    title: "Create a Claim",
    description:
      "Start by creating a new claim from the home screen. Each claim tracks all documents, inspections, and reports for a single property.",
    details: [
      "Tap 'New Claim' to get started",
      "Claims are organized by status: Draft, In Progress, Complete",
      "Filter and search across all your claims",
    ],
  },
  {
    icon: Upload,
    iconColor: "text-indigo-600",
    iconBg: "bg-indigo-50",
    title: "Upload Documents",
    description:
      "Upload your claim documents — FNOLs, policy forms, and endorsements. Batch uploads are supported for faster processing.",
    details: [
      "Supports PDF, images, and scanned documents",
      "Upload multiple files at once with batch support",
      "Documents are securely stored and organized per claim",
    ],
  },
  {
    icon: Brain,
    iconColor: "text-purple-600",
    iconBg: "bg-purple-50",
    title: "AI-Powered Extraction",
    description:
      "Our AI reads your documents and extracts key data — insured info, coverage details, policy limits, and more — with confidence scoring.",
    details: [
      "Automatic parsing of FNOLs, policies, and endorsements",
      "Color-coded confidence indicators (high, medium, low)",
      "Review and confirm each extraction before proceeding",
    ],
  },
  {
    icon: Mic,
    iconColor: "text-green-600",
    iconBg: "bg-green-50",
    title: "Voice-Guided Inspection",
    description:
      "Use real-time voice AI during your field inspection. The assistant guides you through each room, logs damages, and captures photos hands-free.",
    details: [
      "Hands-free voice commands via your device microphone",
      "AI creates rooms, logs damages, and notes moisture readings",
      "Multi-structure support: main dwelling, garages, and more",
    ],
  },
  {
    icon: ClipboardCheck,
    iconColor: "text-amber-600",
    iconBg: "bg-amber-50",
    title: "Review & Export",
    description:
      "Review your completed inspection, check for scope gaps, then export your report as an Xactimate ESX file or a polished PDF.",
    details: [
      "AI checks for missing scope items automatically",
      "Review estimate details, photos, and notes in one place",
      "Export to ESX/Xactimate or generate a PDF report",
    ],
  },
];

export function isOnboardingCompleted(): boolean {
  return localStorage.getItem(ONBOARDING_KEY) === "true";
}

export function resetOnboarding(): void {
  localStorage.removeItem(ONBOARDING_KEY);
}

interface OnboardingWizardProps {
  open: boolean;
  onComplete: () => void;
}

export default function OnboardingWizard({ open, onComplete }: OnboardingWizardProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [direction, setDirection] = useState(1);

  const step = steps[currentStep];
  const isFirst = currentStep === 0;
  const isLast = currentStep === steps.length - 1;
  const Icon = step.icon;

  function handleNext() {
    if (isLast) {
      localStorage.setItem(ONBOARDING_KEY, "true");
      setCurrentStep(0);
      onComplete();
    } else {
      setDirection(1);
      setCurrentStep((s) => s + 1);
    }
  }

  function handleBack() {
    if (!isFirst) {
      setDirection(-1);
      setCurrentStep((s) => s - 1);
    }
  }

  function handleSkip() {
    localStorage.setItem(ONBOARDING_KEY, "true");
    setCurrentStep(0);
    onComplete();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onComplete(); }}>
      <DialogContent className="sm:max-w-md p-0 gap-0 overflow-hidden" data-testid="dialog-onboarding">
        <div className="relative h-1.5 bg-muted" data-testid="progress-onboarding">
          <motion.div
            className="absolute inset-y-0 left-0 bg-primary rounded-full"
            initial={{ width: 0 }}
            animate={{ width: `${((currentStep + 1) / steps.length) * 100}%` }}
            transition={{ duration: 0.3, ease: "easeInOut" }}
          />
        </div>

        <div className="px-6 pt-5 pb-2">
          <DialogHeader className="items-center text-center">
            <AnimatePresence mode="wait" custom={direction}>
              <motion.div
                key={currentStep}
                custom={direction}
                initial={{ opacity: 0, x: direction * 40 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: direction * -40 }}
                transition={{ duration: 0.25 }}
                className="flex flex-col items-center w-full"
              >
                <div className={`h-14 w-14 rounded-2xl ${step.iconBg} flex items-center justify-center mb-4`} data-testid={`icon-onboarding-step-${currentStep}`}>
                  <Icon className={`h-7 w-7 ${step.iconColor}`} />
                </div>

                <DialogTitle className="text-xl font-display" data-testid={`text-onboarding-title-${currentStep}`}>
                  {step.title}
                </DialogTitle>
                <DialogDescription className="mt-2 text-sm leading-relaxed" data-testid={`text-onboarding-desc-${currentStep}`}>
                  {step.description}
                </DialogDescription>

                <ul className="mt-4 space-y-2.5 text-left w-full" data-testid={`list-onboarding-details-${currentStep}`}>
                  {step.details.map((detail, i) => (
                    <li key={i} className="flex items-start gap-2.5 text-sm text-muted-foreground" data-testid={`text-onboarding-detail-${currentStep}-${i}`}>
                      <div className={`h-5 w-5 rounded-full ${step.iconBg} flex items-center justify-center shrink-0 mt-0.5`}>
                        <span className={`text-xs font-semibold ${step.iconColor}`}>{i + 1}</span>
                      </div>
                      {detail}
                    </li>
                  ))}
                </ul>
              </motion.div>
            </AnimatePresence>
          </DialogHeader>
        </div>

        <div className="flex items-center justify-between px-6 py-4 border-t bg-muted/30">
          <div className="flex items-center gap-1.5">
            {steps.map((_, i) => (
              <button
                key={i}
                onClick={() => {
                  setDirection(i > currentStep ? 1 : -1);
                  setCurrentStep(i);
                }}
                className={`h-2 rounded-full transition-all duration-300 ${
                  i === currentStep ? "w-6 bg-primary" : "w-2 bg-muted-foreground/30 hover:bg-muted-foreground/50"
                }`}
                data-testid={`button-onboarding-dot-${i}`}
              />
            ))}
          </div>

          <div className="flex items-center gap-2">
            {!isFirst && (
              <Button variant="ghost" size="sm" onClick={handleBack} data-testid="button-onboarding-back">
                <ChevronLeft className="h-4 w-4 mr-1" />
                Back
              </Button>
            )}
            {isFirst && (
              <Button variant="ghost" size="sm" onClick={handleSkip} className="text-muted-foreground" data-testid="button-onboarding-skip">
                Skip
              </Button>
            )}
            <Button size="sm" onClick={handleNext} data-testid="button-onboarding-next">
              {isLast ? "Get Started" : "Next"}
              {!isLast && <ChevronRight className="h-4 w-4 ml-1" />}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
