import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import BottomNav from "@/components/BottomNav";

// Pages
import ClaimsList from "@/pages/ClaimsList";
import DocumentUpload from "@/pages/DocumentUpload";
import ExtractionReview from "@/pages/ExtractionReview";
import InspectionBriefing from "@/pages/InspectionBriefing";
import ActiveInspection from "@/pages/ActiveInspection";
import ReviewFinalize from "@/pages/ReviewFinalize";
import ExportPage from "@/pages/ExportPage";
import DocumentsHub from "@/pages/DocumentsHub";

function Router() {
  return (
    <Switch>
      <Route path="/" component={ClaimsList} />
      <Route path="/documents" component={DocumentsHub} />
      <Route path="/upload/:id" component={DocumentUpload} />
      <Route path="/review/:id" component={ExtractionReview} />
      <Route path="/briefing/:id" component={InspectionBriefing} />
      <Route path="/inspection/:id" component={ActiveInspection} />
      <Route path="/inspection/:id/review" component={ReviewFinalize} />
      <Route path="/inspection/:id/export" component={ExportPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Router />
        <BottomNav />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
