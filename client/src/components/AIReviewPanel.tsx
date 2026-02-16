import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import {
  AlertTriangle, CheckCircle2, AlertCircle, ChevronDown,
  ChevronUp, Zap, Loader2,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface AIReviewPanelProps {
  sessionId: number;
}

export default function AIReviewPanel({ sessionId }: AIReviewPanelProps) {
  const [expandedSections, setExpandedSections] = useState<{ [key: string]: boolean }>({
    gaps: true,
    pricing: false,
    docs: false,
    compliance: false,
    suggestions: false,
  });

  const { data: review, isLoading, refetch } = useQuery({
    queryKey: [`/api/inspection/${sessionId}/review/ai`],
    queryFn: async () => {
      const res = await apiRequest("POST", `/api/inspection/${sessionId}/review/ai`);
      return res.json();
    },
    enabled: !!sessionId,
  });

  const toggleSection = (section: string) => {
    setExpandedSections((prev) => ({
      ...prev,
      [section]: !prev[section],
    }));
  };

  const getScoreColor = (score: number): string => {
    if (score >= 80) return "bg-green-100 text-green-900 border-green-300";
    if (score >= 60) return "bg-yellow-100 text-yellow-900 border-yellow-300";
    return "bg-red-100 text-red-900 border-red-300";
  };

  const getSeverityColor = (severity: string): string => {
    switch (severity) {
      case "critical":
        return "border-l-4 border-l-red-500 bg-red-50";
      case "warning":
        return "border-l-4 border-l-yellow-500 bg-yellow-50";
      default:
        return "border-l-4 border-l-blue-500 bg-blue-50";
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-primary mr-2" />
        <span className="text-sm text-muted-foreground">Running AI review...</span>
      </div>
    );
  }

  if (!review) {
    return null;
  }

  return (
    <div className="border border-border rounded-lg p-4 md:p-6 bg-card">
      {/* Header with Score */}
      <div className="flex items-center justify-between mb-5">
        <h3 className="font-display font-bold text-lg">AI Estimate Review</h3>
        <div className={`h-16 w-16 rounded-full border-4 flex items-center justify-center font-display font-bold text-lg ${getScoreColor(review.overallScore)}`}>
          {review.overallScore}
        </div>
      </div>

      {/* Summary */}
      <p className="text-sm text-muted-foreground mb-5">{review.summary}</p>

      {/* Scope Gaps Section */}
      <Section
        title="Scope Gaps"
        icon={AlertTriangle}
        count={review.scopeGaps?.length || 0}
        expanded={expandedSections.gaps}
        onToggle={() => toggleSection("gaps")}
      >
        {review.scopeGaps?.map((gap: any, idx: number) => (
          <div key={idx} className={`p-3 rounded mb-3 ${getSeverityColor(gap.severity)}`}>
            <div className="flex items-start gap-2">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <div className="flex-1">
                <p className="font-semibold text-sm">{gap.room}</p>
                <p className="text-sm mt-1">{gap.issue}</p>
                <p className="text-xs text-muted-foreground mt-1">Suggestion: {gap.suggestion}</p>
              </div>
            </div>
          </div>
        ))}
      </Section>

      {/* Pricing Anomalies Section */}
      <Section
        title="Pricing Anomalies"
        icon={AlertCircle}
        count={review.pricingFlags?.length || 0}
        expanded={expandedSections.pricing}
        onToggle={() => toggleSection("pricing")}
      >
        {review.pricingFlags?.map((flag: any, idx: number) => (
          <div key={idx} className="p-3 rounded mb-3 border-l-4 border-l-orange-500 bg-orange-50">
            <p className="font-semibold text-sm">{flag.description}</p>
            <p className="text-sm mt-1">{flag.issue}</p>
            <p className="text-xs text-muted-foreground mt-1">Expected: {flag.expectedRange}</p>
          </div>
        ))}
      </Section>

      {/* Documentation Gaps Section */}
      <Section
        title="Documentation"
        icon={AlertCircle}
        count={review.documentationGaps?.length || 0}
        expanded={expandedSections.docs}
        onToggle={() => toggleSection("docs")}
      >
        {review.documentationGaps?.map((gap: any, idx: number) => (
          <div key={idx} className="p-3 rounded mb-3 border-l-4 border-l-yellow-500 bg-yellow-50">
            <p className="font-semibold text-sm">{gap.type}</p>
            <p className="text-sm mt-1">{gap.details}</p>
          </div>
        ))}
      </Section>

      {/* Compliance Section */}
      <Section
        title="Compliance"
        icon={CheckCircle2}
        count={review.complianceIssues?.length || 0}
        expanded={expandedSections.compliance}
        onToggle={() => toggleSection("compliance")}
      >
        {review.complianceIssues?.map((issue: any, idx: number) => (
          <div key={idx} className={`p-3 rounded mb-3 border-l-4 ${issue.status === "pass" ? "border-l-green-500 bg-green-50" : "border-l-red-500 bg-red-50"}`}>
            <div className="flex items-start gap-2">
              {issue.status === "pass" ? (
                <CheckCircle2 size={14} className="text-green-600 mt-0.5 shrink-0" />
              ) : (
                <AlertTriangle size={14} className="text-red-600 mt-0.5 shrink-0" />
              )}
              <div>
                <p className="font-semibold text-sm">{issue.rule}</p>
                <p className="text-sm mt-1">{issue.details}</p>
              </div>
            </div>
          </div>
        ))}
      </Section>

      {/* Suggestions Section */}
      <Section
        title="Suggestions"
        icon={Zap}
        count={review.suggestions?.length || 0}
        expanded={expandedSections.suggestions}
        onToggle={() => toggleSection("suggestions")}
      >
        {review.suggestions?.map((suggestion: any, idx: number) => (
          <div key={idx} className="p-3 rounded mb-3 border-l-4 border-l-blue-500 bg-blue-50">
            <div className="flex items-start justify-between">
              <div>
                <p className="font-semibold text-sm">{suggestion.description}</p>
                <p className="text-xs text-muted-foreground mt-1">Impact: {suggestion.estimatedImpact}</p>
              </div>
              <span className={`text-xs font-semibold px-2 py-1 rounded ${
                suggestion.priority === "high" ? "bg-red-200 text-red-900" :
                suggestion.priority === "medium" ? "bg-yellow-200 text-yellow-900" :
                "bg-blue-200 text-blue-900"
              }`}>
                {suggestion.priority.toUpperCase()}
              </span>
            </div>
          </div>
        ))}
      </Section>

      {/* Re-run button */}
      <Button
        onClick={() => refetch()}
        variant="outline"
        className="w-full mt-4"
        size="sm"
      >
        <Zap size={14} className="mr-2" /> Re-run Review
      </Button>
    </div>
  );
}

function Section({
  title,
  icon: Icon,
  count,
  expanded,
  onToggle,
  children,
}: {
  title: string;
  icon: any;
  count: number;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-4 border border-border rounded-lg overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full p-3 flex items-center justify-between hover:bg-muted/50 transition"
      >
        <div className="flex items-center gap-2">
          <Icon size={16} />
          <span className="font-semibold text-sm">{title}</span>
          {count > 0 && (
            <span className="ml-2 bg-primary/20 text-primary text-xs font-bold px-2 py-0.5 rounded">
              {count}
            </span>
          )}
        </div>
        {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </button>
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="border-t border-border p-3 bg-muted/30"
          >
            {count === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-4">All clear!</p>
            ) : (
              children
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
