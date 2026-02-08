import { useEffect, useState } from "react";
import { Switch, Route, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import BottomNav from "@/components/BottomNav";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import LoginPage from "@/pages/LoginPage";
import SupervisorDashboard from "@/pages/SupervisorDashboard";
import OnboardingWizard, { isOnboardingCompleted } from "@/components/OnboardingWizard";

// Pages
import ClaimsList from "@/pages/ClaimsList";
import DocumentUpload from "@/pages/DocumentUpload";
import ExtractionReview from "@/pages/ExtractionReview";
import InspectionBriefing from "@/pages/InspectionBriefing";
import ActiveInspection from "@/pages/ActiveInspection";
import ReviewFinalize from "@/pages/ReviewFinalize";
import ExportPage from "@/pages/ExportPage";
import DocumentsHub from "@/pages/DocumentsHub";
import SettingsPage from "@/pages/SettingsPage";

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
      <Switch>
        <Route path="/" component={ClaimsList} />
        {role === "supervisor" && <Route path="/dashboard" component={SupervisorDashboard} />}
        <Route path="/documents" component={DocumentsHub} />
        <Route path="/settings" component={SettingsPage} />
        <Route path="/upload/:id" component={DocumentUpload} />
        <Route path="/review/:id" component={ExtractionReview} />
        <Route path="/briefing/:id" component={InspectionBriefing} />
        <Route path="/inspection/:id" component={ActiveInspection} />
        <Route path="/inspection/:id/review" component={ReviewFinalize} />
        <Route path="/inspection/:id/export" component={ExportPage} />
        <Route component={NotFound} />
      </Switch>
    </>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthProvider>
          <Toaster />
          <ProtectedRouter />
          <BottomNav />
        </AuthProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
