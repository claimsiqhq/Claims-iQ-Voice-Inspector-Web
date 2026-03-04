import React, { useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import Layout from "@/components/Layout";
import ScheduleView from "@/components/ScheduleView";
import RouteMap from "@/components/RouteMap";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Calendar,
  Clock,
  MapPin,
  CloudSun,
  CheckCircle2,
  AlertTriangle,
  Route,
  CalendarDays,
  ListChecks,
  Map,
  Plug2,
  PlugZap,
} from "lucide-react";

interface ClaimUrgency {
  score: number;
  priority: string;
  hoursRemaining: number | null;
  isOverdue: boolean;
}

interface MyDayClaim {
  id: number;
  claimNumber: string;
  insuredName: string | null;
  propertyAddress: string | null;
  city: string | null;
  state: string | null;
  priority: string | null;
  scheduledTimeSlot: string | null;
  estimatedDurationMin: number | null;
  slaDeadline: string | null;
  status: string;
  urgency: ClaimUrgency;
}

interface MyDayData {
  date: string;
  claims: MyDayClaim[];
  itinerary: any;
  stats: {
    totalScheduled: number;
    completed: number;
    remaining: number;
    totalActive: number;
    slaWarnings: number;
    overdue: number;
  };
  unreadNotifications: number;
  ms365: { connected: boolean; email: string | null };
}

type TabId = "itinerary" | "route-map" | "schedule";

const priorityColors: Record<string, string> = {
  critical: "bg-red-100 text-red-700 border-red-200",
  high: "bg-orange-100 text-orange-700 border-orange-200",
  normal: "bg-blue-100 text-blue-700 border-blue-200",
  low: "bg-gray-100 text-gray-600 border-gray-200",
};

const priorityDotColors: Record<string, string> = {
  critical: "bg-red-500",
  high: "bg-orange-500",
  normal: "bg-blue-500",
  low: "bg-gray-400",
};

function formatGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function SlaCountdown({ urgency }: { urgency: ClaimUrgency }) {
  if (urgency.isOverdue) {
    return (
      <span className="text-xs font-semibold text-red-600" data-testid="text-sla-overdue">
        OVERDUE
      </span>
    );
  }
  if (urgency.hoursRemaining != null) {
    return (
      <span className="text-xs text-muted-foreground" data-testid="text-sla-remaining">
        {Math.round(urgency.hoursRemaining)}h remaining
      </span>
    );
  }
  return null;
}

export default function MyDay() {
  const [, setLocation] = useLocation();
  const [activeTab, setActiveTab] = useState<TabId>("itinerary");

  const { data, isLoading, error } = useQuery<MyDayData>({
    queryKey: ["/api/myday/today"],
  });

  const optimizeMutation = useMutation({
    mutationFn: async () => {
      const today = new Date().toISOString().slice(0, 10);
      const res = await apiRequest("POST", "/api/itinerary/optimize", { date: today });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/myday/today"] });
    },
  });

  const tabs: { id: TabId; label: string; icon: React.ReactNode }[] = [
    { id: "itinerary", label: "Itinerary", icon: <ListChecks className="h-4 w-4" /> },
    { id: "route-map", label: "Route Map", icon: <Map className="h-4 w-4" /> },
    { id: "schedule", label: "Schedule", icon: <CalendarDays className="h-4 w-4" /> },
  ];

  return (
    <Layout title="My Day">
      <div className="space-y-6" data-testid="page-myday">
        {/* Context Bar */}
        <div className="space-y-4" data-testid="context-bar">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <h2 className="text-2xl font-bold tracking-tight" data-testid="text-greeting">
                {formatGreeting()}
              </h2>
              {data?.date && (
                <p className="text-sm text-muted-foreground flex items-center gap-1.5 mt-1" data-testid="text-date">
                  <Calendar className="h-3.5 w-3.5" />
                  {formatDate(data.date)}
                </p>
              )}
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5 text-sm text-muted-foreground" data-testid="weather-placeholder">
                <CloudSun className="h-4 w-4" />
                <span>--°F</span>
              </div>
              <div
                className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded-full ${
                  data?.ms365?.connected
                    ? "bg-green-50 text-green-700"
                    : "bg-gray-100 text-gray-500"
                }`}
                data-testid="ms365-status"
              >
                {data?.ms365?.connected ? (
                  <PlugZap className="h-3.5 w-3.5" />
                ) : (
                  <Plug2 className="h-3.5 w-3.5" />
                )}
                {data?.ms365?.connected ? "MS365 Connected" : "MS365 Disconnected"}
              </div>
            </div>
          </div>

          {/* Quick Stats */}
          <div className="grid grid-cols-3 gap-3" data-testid="stats-row">
            <Card className="p-3 flex items-center gap-3" data-testid="stat-claims-today">
              <div className="h-9 w-9 rounded-lg bg-blue-50 flex items-center justify-center">
                <CalendarDays className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <p className="text-xl font-bold">{data?.stats?.totalScheduled ?? 0}</p>
                <p className="text-xs text-muted-foreground">Claims Today</p>
              </div>
            </Card>
            <Card className="p-3 flex items-center gap-3" data-testid="stat-completed">
              <div className="h-9 w-9 rounded-lg bg-green-50 flex items-center justify-center">
                <CheckCircle2 className="h-5 w-5 text-green-600" />
              </div>
              <div>
                <p className="text-xl font-bold">{data?.stats?.completed ?? 0}</p>
                <p className="text-xs text-muted-foreground">Completed</p>
              </div>
            </Card>
            <Card className="p-3 flex items-center gap-3" data-testid="stat-sla-warnings">
              <div className="h-9 w-9 rounded-lg bg-amber-50 flex items-center justify-center">
                <AlertTriangle className="h-5 w-5 text-amber-600" />
              </div>
              <div>
                <p className="text-xl font-bold">
                  {(data?.stats?.slaWarnings ?? 0) + (data?.stats?.overdue ?? 0)}
                </p>
                <p className="text-xs text-muted-foreground">SLA Warnings</p>
              </div>
            </Card>
          </div>
        </div>

        {/* Sub-tab Navigation */}
        <div className="flex gap-1 bg-muted p-1 rounded-lg" data-testid="tab-bar">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              data-testid={`tab-${tab.id}`}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                activeTab === tab.id
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content Area */}
        {activeTab === "itinerary" && (
          <ItineraryTab
            data={data}
            isLoading={isLoading}
            error={error}
            onOptimize={() => optimizeMutation.mutate()}
            isOptimizing={optimizeMutation.isPending}
            onClaimClick={(id) => setLocation(`/briefing/${id}`)}
          />
        )}
        {activeTab === "route-map" && (
          <RouteMap
            claims={data?.claims ?? []}
            onClaimClick={(id) => setLocation(`/briefing/${id}`)}
          />
        )}
        {activeTab === "schedule" && <ScheduleView />}
      </div>
    </Layout>
  );
}

function ItineraryTab({
  data,
  isLoading,
  error,
  onOptimize,
  isOptimizing,
  onClaimClick,
}: {
  data: MyDayData | undefined;
  isLoading: boolean;
  error: Error | null;
  onOptimize: () => void;
  isOptimizing: boolean;
  onClaimClick: (id: number) => void;
}) {
  if (isLoading) {
    return (
      <div className="space-y-4" data-testid="itinerary-loading">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-24 bg-muted animate-pulse rounded-lg" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-12 text-destructive" data-testid="itinerary-error">
        <p>Failed to load today's schedule.</p>
        <p className="text-sm mt-1">{error.message}</p>
      </div>
    );
  }

  const claims = data?.claims ?? [];

  if (claims.length === 0) {
    return (
      <div className="text-center py-16 space-y-3" data-testid="itinerary-empty">
        <CalendarDays className="h-12 w-12 mx-auto text-muted-foreground/40" />
        <h3 className="text-lg font-semibold">No claims scheduled</h3>
        <p className="text-sm text-muted-foreground">
          You have no inspections scheduled for today.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="itinerary-content">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-muted-foreground">
          {claims.length} stop{claims.length !== 1 ? "s" : ""} today
        </h3>
        <Button
          variant="outline"
          size="sm"
          onClick={onOptimize}
          disabled={isOptimizing}
          data-testid="button-optimize-route"
        >
          <Route className="h-4 w-4 mr-1.5" />
          {isOptimizing ? "Optimizing…" : "Optimize Route"}
        </Button>
      </div>

      <div className="relative">
        {/* Timeline line */}
        <div className="absolute left-[19px] top-4 bottom-4 w-0.5 bg-border" data-testid="timeline-line" />

        <div className="space-y-3">
          {claims.map((claim, idx) => {
            const priority = (claim.priority || "normal").toLowerCase();
            return (
              <div
                key={claim.id}
                className="relative flex gap-4 cursor-pointer group"
                data-testid={`claim-card-${claim.id}`}
                onClick={() => onClaimClick(claim.id)}
              >
                {/* Timeline dot */}
                <div className="relative z-10 flex flex-col items-center pt-4">
                  <div
                    className={`h-3 w-3 rounded-full border-2 border-background ${priorityDotColors[priority] || priorityDotColors.normal}`}
                  />
                </div>

                {/* Claim card */}
                <Card className="flex-1 p-4 hover:shadow-md transition-shadow group-hover:border-primary/30">
                  <div className="flex items-start justify-between gap-2">
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm" data-testid={`text-claim-number-${claim.id}`}>
                          {claim.claimNumber}
                        </span>
                        <Badge
                          variant="outline"
                          className={`text-[10px] px-1.5 py-0 capitalize ${priorityColors[priority] || priorityColors.normal}`}
                          data-testid={`badge-priority-${claim.id}`}
                        >
                          {priority}
                        </Badge>
                      </div>
                      {claim.insuredName && (
                        <p className="text-sm text-foreground" data-testid={`text-insured-${claim.id}`}>
                          {claim.insuredName}
                        </p>
                      )}
                      {(claim.propertyAddress || claim.city) && (
                        <p className="text-xs text-muted-foreground flex items-center gap-1" data-testid={`text-address-${claim.id}`}>
                          <MapPin className="h-3 w-3 shrink-0" />
                          <span className="truncate">
                            {[claim.propertyAddress, claim.city, claim.state]
                              .filter(Boolean)
                              .join(", ")}
                          </span>
                        </p>
                      )}
                    </div>

                    <div className="text-right shrink-0 space-y-1">
                      {claim.scheduledTimeSlot && (
                        <p className="text-sm font-medium flex items-center gap-1 justify-end" data-testid={`text-timeslot-${claim.id}`}>
                          <Clock className="h-3.5 w-3.5" />
                          {claim.scheduledTimeSlot}
                        </p>
                      )}
                      {claim.estimatedDurationMin && (
                        <p className="text-xs text-muted-foreground" data-testid={`text-duration-${claim.id}`}>
                          ~{claim.estimatedDurationMin} min
                        </p>
                      )}
                      <SlaCountdown urgency={claim.urgency} />
                    </div>
                  </div>
                </Card>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
