import React, { lazy, Suspense, useEffect, useState } from "react";
import { Switch, Route, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import BottomNav from "@/components/BottomNav";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { SettingsProvider } from "@/components/SettingsProvider";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { OfflineBanner } from "@/components/OfflineBanner";
import { useOfflineSync } from "@/hooks/useOfflineSync";

const LoginPage = lazy(() => import("@/pages/LoginPage"));
const SupervisorDashboard = lazy(() => import("@/pages/SupervisorDashboard"));
const ClaimsList = lazy(() => import("@/pages/ClaimsList"));
const DocumentUpload = lazy(() => import("@/pages/DocumentUpload"));
const ExtractionReview = lazy(() => import("@/pages/ExtractionReview"));
const InspectionBriefing = lazy(() => import("@/pages/InspectionBriefing"));
const ActiveInspection = lazy(() => import("@/pages/ActiveInspection"));
const ReviewFinalize = lazy(() => import("@/pages/ReviewFinalize"));
const ExportPage = lazy(() => import("@/pages/ExportPage"));
const DocumentsHub = lazy(() => import("@/pages/DocumentsHub"));
const SettingsPage = lazy(() => import("@/pages/SettingsPage"));
const SupplementalPage = lazy(() => import("@/pages/SupplementalPage"));
const WorkflowBuilder = lazy(() => import("@/pages/WorkflowBuilder"));
const ProfilePage = lazy(() => import("@/pages/ProfilePage"));
const PhotoGallery = lazy(() => import("@/pages/PhotoGallery"));
const SketchGallery = lazy(() => import("@/pages/SketchGallery"));
const PhotoLab = lazy(() => import("@/pages/PhotoLab"));
const ScopePage = lazy(() => import("@/pages/ScopePage"));

import OnboardingWizard, { isOnboardingCompleted } from "@/components/OnboardingWizard";

function PageLoadingFallback() {
  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4" />
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    </div>
  );
}

function ScrollToTop() {
  const [location] = useLocation();
  useEffect(() => {
    if ("scrollRestoration" in window.history) {
      window.history.scrollRestoration = "manual";
    }
  }, []);
  useEffect(() => {
    window.scrollTo(0, 0);
    const main = document.querySelector("main");
    if (main) main.scrollTop = 0;
  }, [location]);
  return null;
}

function ActiveInspectionWithBoundary({ params }: { params?: { id?: string } }) {
  return (
    <ErrorBoundary>
      <ActiveInspection params={{ id: params?.id ?? "" }} />
    </ErrorBoundary>
  );
}

function ExportPageWithBoundary({ params }: { params?: { id?: string } }) {
  return (
    <ErrorBoundary>
      <ExportPage params={{ id: params?.id ?? "" }} />
    </ErrorBoundary>
  );
}

function SupervisorDashboardWithBoundary() {
  return (
    <ErrorBoundary>
      <SupervisorDashboard />
    </ErrorBoundary>
  );
}

function RouterContent() {
  const { role } = useAuth();
  return (
    <Suspense fallback={<PageLoadingFallback />}>
      <Switch>
        <Route path="/" component={ClaimsList} />
        {role === "supervisor" && <Route path="/dashboard" component={SupervisorDashboardWithBoundary} />}
        <Route path="/documents" component={DocumentsHub} />
        <Route path="/settings" component={SettingsPage} />
        <Route path="/settings/workflows" component={WorkflowBuilder} />
        <Route path="/profile" component={ProfilePage} />
        <Route path="/gallery/photos" component={PhotoGallery} />
        <Route path="/gallery/sketches" component={SketchGallery} />
        <Route path="/photo-lab" component={PhotoLab} />
        <Route path="/upload/:id" component={DocumentUpload} />
        <Route path="/review/:id" component={ExtractionReview} />
        <Route path="/briefing/:id" component={InspectionBriefing} />
        <Route path="/inspection/:id/scope" component={ScopePage} />
        <Route path="/inspection/:id/review" component={ReviewFinalize} />
        <Route path="/inspection/:id/export" component={ExportPageWithBoundary} />
        <Route path="/inspection/:id/supplemental" component={SupplementalPage} />
        <Route path="/inspection/:id" component={ActiveInspectionWithBoundary} />
        <Route component={NotFound} />
      </Switch>
    </Suspense>
  );
}

function ProtectedRouter() {
  const { isAuthenticated, role, loading } = useAuth();
  const [showOnboarding, setShowOnboarding] = useState(false);

  useEffect(() => {
    if (isAuthenticated && !isOnboardingCompleted()) {
      setShowOnboarding(true);
    }
  }, [isAuthenticated]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <Suspense fallback={<PageLoadingFallback />}>
        <LoginPage />
      </Suspense>
    );
  }

  return (
    <>
      <ScrollToTop />
      <OnboardingWizard open={showOnboarding} onComplete={() => setShowOnboarding(false)} />
      <ErrorBoundary>
        <RouterContent />
      </ErrorBoundary>
      <BottomNav />
    </>
  );
}

function AppWithSync() {
  useOfflineSync();
  return <ProtectedRouter />;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthProvider>
          <SettingsProvider>
            <Toaster />
            <ErrorBoundary>
              <OfflineBanner />
              <AppWithSync />
            </ErrorBoundary>
          </SettingsProvider>
        </AuthProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
