import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, Clock } from "lucide-react";

interface WeekClaim {
  id: number;
  claimNumber: string;
  insuredName: string | null;
  scheduledTimeSlot: string | null;
  priority: string | null;
  status: string;
  estimatedDurationMin: number | null;
  propertyAddress: string | null;
  city: string | null;
}

interface WeekDay {
  date: string;
  claims: WeekClaim[];
}

interface WeekData {
  startDate: string;
  days: WeekDay[];
}

const priorityDotColors: Record<string, string> = {
  critical: "bg-red-500",
  high: "bg-orange-500",
  normal: "bg-blue-500",
  low: "bg-gray-400",
};

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function getMonday(d: Date): Date {
  const date = new Date(d);
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  return date;
}

function formatDateStr(d: Date): string {
  return d.toISOString().split("T")[0];
}

function formatShortDate(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatWeekRange(startDate: string): string {
  const start = new Date(startDate + "T12:00:00");
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  return `${start.toLocaleDateString("en-US", opts)} – ${end.toLocaleDateString("en-US", { ...opts, year: "numeric" })}`;
}

export default function ScheduleView() {
  const [, setLocation] = useLocation();
  const today = formatDateStr(new Date());
  const [weekStart, setWeekStart] = useState(() => formatDateStr(getMonday(new Date())));

  const { data, isLoading } = useQuery<WeekData>({
    queryKey: [`/api/myday/week/${weekStart}`],
  });

  const goToPrevWeek = () => {
    const d = new Date(weekStart + "T12:00:00");
    d.setDate(d.getDate() - 7);
    setWeekStart(formatDateStr(d));
  };

  const goToNextWeek = () => {
    const d = new Date(weekStart + "T12:00:00");
    d.setDate(d.getDate() + 7);
    setWeekStart(formatDateStr(d));
  };

  const goToToday = () => {
    setWeekStart(formatDateStr(getMonday(new Date())));
  };

  if (isLoading) {
    return (
      <div className="space-y-4" data-testid="schedule-loading">
        <div className="h-8 bg-muted animate-pulse rounded" />
        <div className="grid grid-cols-7 gap-2">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="h-48 bg-muted animate-pulse rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  const days = data?.days ?? [];

  return (
    <div className="space-y-4" data-testid="schedule-view">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={goToPrevWeek} data-testid="button-prev-week">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="icon" onClick={goToNextWeek} data-testid="button-next-week">
            <ChevronRight className="h-4 w-4" />
          </Button>
          <span className="text-sm font-medium ml-2" data-testid="text-week-range">
            {formatWeekRange(weekStart)}
          </span>
        </div>
        <Button variant="outline" size="sm" onClick={goToToday} data-testid="button-today">
          Today
        </Button>
      </div>

      <div className="grid grid-cols-7 gap-2" data-testid="week-grid">
        {days.map((day, idx) => {
          const isToday = day.date === today;
          return (
            <div
              key={day.date}
              className={`rounded-lg border p-2 min-h-[200px] flex flex-col ${
                isToday ? "bg-blue-50 border-blue-200" : "bg-background"
              }`}
              data-testid={`day-column-${day.date}`}
            >
              <div className="text-center mb-2">
                <p className={`text-xs font-semibold uppercase ${isToday ? "text-blue-600" : "text-muted-foreground"}`}>
                  {DAY_LABELS[idx]}
                </p>
                <p className={`text-sm font-medium ${isToday ? "text-blue-700" : ""}`} data-testid={`text-day-date-${day.date}`}>
                  {formatShortDate(day.date)}
                </p>
              </div>

              <div className="flex-1 space-y-1.5">
                {day.claims.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center mt-4" data-testid={`text-no-inspections-${day.date}`}>
                    No inspections
                  </p>
                ) : (
                  day.claims.map((claim) => {
                    const priority = (claim.priority || "normal").toLowerCase();
                    return (
                      <Card
                        key={claim.id}
                        className="p-2 cursor-pointer hover:shadow-md transition-shadow"
                        data-testid={`schedule-claim-card-${claim.id}`}
                        onClick={() => setLocation(`/briefing/${claim.id}`)}
                      >
                        <div className="flex items-start gap-1.5">
                          <div className={`h-2 w-2 rounded-full mt-1 shrink-0 ${priorityDotColors[priority] || priorityDotColors.normal}`} />
                          <div className="min-w-0 flex-1">
                            {claim.scheduledTimeSlot && (
                              <p className="text-[10px] text-muted-foreground flex items-center gap-0.5" data-testid={`text-schedule-time-${claim.id}`}>
                                <Clock className="h-2.5 w-2.5" />
                                {claim.scheduledTimeSlot}
                              </p>
                            )}
                            <p className="text-xs font-semibold truncate" data-testid={`text-schedule-claim-number-${claim.id}`}>
                              {claim.claimNumber}
                            </p>
                            {claim.insuredName && (
                              <p className="text-[10px] text-muted-foreground truncate" data-testid={`text-schedule-insured-${claim.id}`}>
                                {claim.insuredName.length > 15 ? claim.insuredName.slice(0, 15) + "…" : claim.insuredName}
                              </p>
                            )}
                          </div>
                        </div>
                      </Card>
                    );
                  })
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}