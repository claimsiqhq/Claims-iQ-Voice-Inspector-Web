import React, { useEffect, useState } from "react";
import { Switch, Route, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import BottomNav from "@/components/BottomNav";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { SettingsProvider } from "@/components/SettingsProvider";
import LoginPage from "@/pages/LoginPage";
import SupervisorDashboard from "@/pages/SupervisorDashboard";
import OnboardingWizard, { isOnboardingCompleted } from "@/components/OnboardingWizard";

import ClaimsList from "@/pages/ClaimsList";
import DocumentUpload from "@/pages/DocumentUpload";
import ExtractionReview from "@/pages/ExtractionReview";
import InspectionBriefing from "@/pages/InspectionBriefing";
import ActiveInspection from "@/pages/ActiveInspection";
import ReviewFinalize from "@/pages/ReviewFinalize";
import ExportPage from "@/pages/ExportPage";
import DocumentsHub from "@/pages/DocumentsHub";
import SettingsPage from "@/pages/SettingsPage";
import SupplementalPage from "@/pages/SupplementalPage";
import WorkflowBuilder from "@/pages/WorkflowBuilder";
import ProfilePage from "@/pages/ProfilePage";
import PhotoGallery from "@/pages/PhotoGallery";
import SketchGallery from "@/pages/SketchGallery";

class ErrorBoundary extends React.Component<
  { children: React.ReactNode; fallback?: React.ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: React.ReactNode; fallback?: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("ErrorBoundary caught:", error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback || (
          <div className="flex flex-col items-center justify-center min-h-screen p-6 text-center" data-testid="error-boundary-fallback">
            <div className="text-6xl mb-4">⚠</div>
            <h2 className="text-xl font-semibold mb-2">Something went wrong</h2>
            <p className="text-muted-foreground mb-4">
              An unexpected error occurred. Please try refreshing the page.
            </p>
            <button
              data-testid="button-reload"
              className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
              onClick={() => {
                this.setState({ hasError: false, error: null });
                window.location.reload();
              }}
            >
              Reload Page
            </button>
          </div>
        )
      );
    }
    return this.props.children;
  }
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
    return <LoginPage />;
  }

  return (
    <>
      <ScrollToTop />
      <OnboardingWizard open={showOnboarding} onComplete={() => setShowOnboarding(false)} />
      <ErrorBoundary>
        <Switch>
          <Route path="/" component={ClaimsList} />
          {role === "supervisor" && <Route path="/dashboard" component={SupervisorDashboard} />}
          <Route path="/documents" component={DocumentsHub} />
          <Route path="/settings" component={SettingsPage} />
          <Route path="/settings/workflows" component={WorkflowBuilder} />
          <Route path="/profile" component={ProfilePage} />
          <Route path="/gallery/photos" component={PhotoGallery} />
          <Route path="/gallery/sketches" component={SketchGallery} />
          <Route path="/upload/:id" component={DocumentUpload} />
          <Route path="/review/:id" component={ExtractionReview} />
          <Route path="/briefing/:id" component={InspectionBriefing} />
          <Route path="/inspection/:id" component={ActiveInspection} />
          <Route path="/inspection/:id/review" component={ReviewFinalize} />
          <Route path="/inspection/:id/export" component={ExportPage} />
          <Route path="/inspection/:id/supplemental" component={SupplementalPage} />
          <Route component={NotFound} />
        </Switch>
      </ErrorBoundary>
      <BottomNav />
    </>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthProvider>
          <SettingsProvider>
            <Toaster />
            <ErrorBoundary>
              <ProtectedRouter />
            </ErrorBoundary>
          </SettingsProvider>
        </AuthProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
