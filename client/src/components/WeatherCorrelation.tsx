import { useQuery } from "@tanstack/react-query";
import { Cloud, CloudRain, CloudSnow, Sun, Wind, Thermometer, Droplets, AlertTriangle, CheckCircle2, XCircle, Info, Loader2, ShieldAlert, ShieldCheck, Eye, ChevronDown, ChevronUp } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useState } from "react";

interface WeatherDay {
  datetime: string;
  tempmax: number;
  tempmin: number;
  temp: number;
  humidity: number;
  precip: number;
  preciptype: string[] | null;
  windspeed: number;
  windgust: number;
  winddir: number;
  conditions: string;
  description: string;
  icon: string;
  severerisk: number;
  snow: number;
  snowdepth: number;
  visibility: number;
  pressure: number;
  cloudcover: number;
}

interface FraudIndicator {
  type: "match" | "mismatch" | "warning" | "info";
  category: string;
  message: string;
  severity: "high" | "medium" | "low";
}

interface PerilAnalysis {
  claimedPeril: string;
  weatherSupportsPeril: boolean;
  confidence: "high" | "medium" | "low" | "no_data";
  details: string;
  relevantConditions: string[];
  severityLevel: "extreme" | "severe" | "moderate" | "mild" | "none";
}

interface WeatherCorrelationData {
  location: string;
  dateOfLoss: string;
  dateRange: { start: string; end: string };
  lossDateWeather: WeatherDay | null;
  surroundingDays: WeatherDay[];
  perilAnalysis: PerilAnalysis;
  fraudIndicators: FraudIndicator[];
  overallRiskScore: number;
  weatherSummary: string;
  dataSource: string;
}

function getWeatherIcon(icon: string, size = 20) {
  if (icon?.includes("snow")) return <CloudSnow size={size} />;
  if (icon?.includes("rain") || icon?.includes("showers")) return <CloudRain size={size} />;
  if (icon?.includes("wind")) return <Wind size={size} />;
  if (icon?.includes("clear") || icon?.includes("sun")) return <Sun size={size} />;
  return <Cloud size={size} />;
}

function getRiskColor(score: number) {
  if (score <= 25) return { text: "text-green-600", bg: "bg-green-50", border: "border-green-200", ring: "ring-green-200" };
  if (score <= 50) return { text: "text-yellow-600", bg: "bg-yellow-50", border: "border-yellow-200", ring: "ring-yellow-200" };
  if (score <= 75) return { text: "text-orange-600", bg: "bg-orange-50", border: "border-orange-200", ring: "ring-orange-200" };
  return { text: "text-red-600", bg: "bg-red-50", border: "border-red-200", ring: "ring-red-200" };
}

function getRiskLabel(score: number) {
  if (score <= 25) return "Low Risk";
  if (score <= 50) return "Moderate";
  if (score <= 75) return "Elevated";
  return "High Risk";
}

function getConfidenceBadge(confidence: string) {
  const colors: Record<string, string> = {
    high: "bg-green-100 text-green-700",
    medium: "bg-yellow-100 text-yellow-700",
    low: "bg-orange-100 text-orange-700",
    no_data: "bg-gray-100 text-gray-600",
  };
  return colors[confidence] || colors.no_data;
}

function getSeverityBadge(severity: string) {
  const colors: Record<string, string> = {
    extreme: "bg-red-600 text-white",
    severe: "bg-red-500 text-white",
    moderate: "bg-orange-500 text-white",
    mild: "bg-yellow-500 text-white",
    none: "bg-gray-200 text-gray-600",
  };
  return colors[severity] || colors.none;
}

function getIndicatorIcon(type: string) {
  switch (type) {
    case "match": return <CheckCircle2 size={14} className="text-green-600 shrink-0 mt-0.5" />;
    case "mismatch": return <XCircle size={14} className="text-red-600 shrink-0 mt-0.5" />;
    case "warning": return <AlertTriangle size={14} className="text-orange-500 shrink-0 mt-0.5" />;
    default: return <Info size={14} className="text-blue-500 shrink-0 mt-0.5" />;
  }
}

function formatDate(dateStr: string) {
  try {
    const d = new Date(dateStr + "T12:00:00");
    return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  } catch { return dateStr; }
}

export default function WeatherCorrelation({ claimId, defaultExpanded = false }: { claimId: number | string; defaultExpanded?: boolean }) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [showTimeline, setShowTimeline] = useState(false);

  const { data, isLoading, error } = useQuery<WeatherCorrelationData>({
    queryKey: [`/api/claims/${claimId}/weather-correlation`],
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading) {
    return (
      <div className="rounded-xl border border-border bg-card" data-testid="weather-correlation-loading">
        <div className="flex items-center gap-3 px-4 py-3">
          <Cloud className="h-4 w-4 text-blue-500" />
          <span className="text-sm font-semibold text-foreground">Weather Correlation</span>
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground ml-auto" />
          <span className="text-xs text-muted-foreground">Fetching weather data...</span>
        </div>
      </div>
    );
  }

  if (error) {
    const errMsg = (error as any)?.message || "";
    return (
      <div className="rounded-xl border border-border bg-card" data-testid="weather-correlation-error">
        <div className="flex items-center gap-3 px-4 py-3">
          <Cloud className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-semibold text-foreground">Weather Correlation</span>
          <span className="text-xs text-muted-foreground ml-auto">
            {errMsg.includes("503") || errMsg.includes("not configured") ? "API key needed" : "Unavailable"}
          </span>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const w = data.lossDateWeather;
  const risk = getRiskColor(data.overallRiskScore);

  return (
    <div className={`rounded-xl border ${risk.border} bg-card overflow-hidden`} data-testid="weather-correlation">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors"
        data-testid="button-toggle-weather"
      >
        <Cloud className="h-4 w-4 text-blue-500 shrink-0" />
        <span className="text-sm font-semibold text-foreground">Weather Correlation</span>

        {w && !expanded && (
          <span className="text-xs text-muted-foreground hidden sm:inline">
            {w.conditions} &bull; {w.tempmin}–{w.tempmax}°F &bull; Wind {w.windgust} mph
          </span>
        )}

        <div className="ml-auto flex items-center gap-2 shrink-0">
          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${risk.bg} ${risk.text}`} data-testid="weather-risk-score">
            {data.overallRiskScore <= 25 ? <ShieldCheck size={11} className="inline mr-0.5 -mt-px" /> : <ShieldAlert size={11} className="inline mr-0.5 -mt-px" />}
            {getRiskLabel(data.overallRiskScore)}
          </span>
          {data.perilAnalysis.weatherSupportsPeril ? (
            <CheckCircle2 size={16} className="text-green-600" />
          ) : (
            <AlertTriangle size={16} className="text-orange-500" />
          )}
          {expanded ? <ChevronUp size={16} className="text-muted-foreground" /> : <ChevronDown size={16} className="text-muted-foreground" />}
        </div>
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 space-y-3 border-t border-border/50">
              <div className="flex items-center gap-2 text-[10px] text-muted-foreground pt-3">
                <span>{data.location}</span>
                <span className="h-1 w-1 rounded-full bg-muted-foreground/40" />
                <span>Loss Date: {formatDate(data.dateOfLoss)}</span>
                <span className="ml-auto">{data.dataSource}</span>
              </div>

              {w && (
                <div className="bg-gradient-to-br from-blue-50/80 to-indigo-50/80 rounded-lg p-3 border border-blue-100/60" data-testid="weather-loss-date">
                  <div className="flex items-center gap-2 mb-2.5">
                    {getWeatherIcon(w.icon, 20)}
                    <span className="text-sm font-semibold text-foreground">{w.conditions}</span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                    <div className="flex items-center gap-1.5">
                      <Thermometer size={13} className="text-red-400 shrink-0" />
                      <div>
                        <p className="text-[9px] text-muted-foreground leading-none">Temp</p>
                        <p className="text-xs font-semibold">{w.tempmin}°–{w.tempmax}°F</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Wind size={13} className="text-blue-400 shrink-0" />
                      <div>
                        <p className="text-[9px] text-muted-foreground leading-none">Wind / Gusts</p>
                        <p className="text-xs font-semibold">{w.windspeed} / {w.windgust} mph</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Droplets size={13} className="text-cyan-400 shrink-0" />
                      <div>
                        <p className="text-[9px] text-muted-foreground leading-none">Precip</p>
                        <p className="text-xs font-semibold">{w.precip}"{w.preciptype ? ` (${w.preciptype.join(", ")})` : ""}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Eye size={13} className="text-gray-400 shrink-0" />
                      <div>
                        <p className="text-[9px] text-muted-foreground leading-none">Severe Risk</p>
                        <p className="text-xs font-semibold">{w.severerisk}%</p>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              <div className="rounded-lg border p-3" data-testid="weather-peril-analysis">
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-1.5">
                    {data.perilAnalysis.weatherSupportsPeril
                      ? <CheckCircle2 size={15} className="text-green-600" />
                      : <AlertTriangle size={15} className="text-orange-500" />
                    }
                    <span className="text-xs font-semibold">
                      {data.perilAnalysis.weatherSupportsPeril ? "Weather Supports Claim" : "Weather Data Inconsistency"}
                    </span>
                  </div>
                  <div className="flex gap-1">
                    <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium ${getConfidenceBadge(data.perilAnalysis.confidence)}`}>
                      {data.perilAnalysis.confidence.toUpperCase()}
                    </span>
                    <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium ${getSeverityBadge(data.perilAnalysis.severityLevel)}`}>
                      {data.perilAnalysis.severityLevel.toUpperCase()}
                    </span>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">{data.perilAnalysis.details}</p>
                {data.perilAnalysis.relevantConditions.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {data.perilAnalysis.relevantConditions.map((c, i) => (
                      <span key={i} className="text-[9px] bg-muted/60 text-muted-foreground px-1.5 py-0.5 rounded-full">{c}</span>
                    ))}
                  </div>
                )}
              </div>

              {data.fraudIndicators.length > 0 && (
                <div className="space-y-1.5" data-testid="weather-fraud-indicators">
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Validation Findings</p>
                  {data.fraudIndicators.map((ind, i) => (
                    <div
                      key={i}
                      className={`flex items-start gap-2 text-xs p-2 rounded-lg border ${
                        ind.type === "mismatch" ? "bg-red-50/50 border-red-200" :
                        ind.type === "warning" ? "bg-orange-50/50 border-orange-200" :
                        ind.type === "match" ? "bg-green-50/50 border-green-200" :
                        "bg-blue-50/50 border-blue-200"
                      }`}
                    >
                      {getIndicatorIcon(ind.type)}
                      <div className="min-w-0">
                        <span className="font-medium text-foreground">{ind.category}: </span>
                        <span className="text-muted-foreground">{ind.message}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div>
                <button
                  onClick={(e) => { e.stopPropagation(); setShowTimeline(!showTimeline); }}
                  className="text-[10px] text-primary hover:underline flex items-center gap-1"
                  data-testid="button-toggle-timeline"
                >
                  {showTimeline ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                  {showTimeline ? "Hide" : "Show"} 5-Day Timeline
                </button>

                <AnimatePresence>
                  {showTimeline && data.surroundingDays.length > 0 && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="mt-2 overflow-hidden"
                    >
                      <div className="grid grid-cols-5 gap-1.5">
                        {data.surroundingDays.map((day) => {
                          const isLossDate = day.datetime === (data.dateOfLoss.includes("T") ? data.dateOfLoss.split("T")[0] : data.dateOfLoss);
                          return (
                            <div
                              key={day.datetime}
                              className={`rounded-lg border p-2 text-center ${isLossDate ? "ring-2 ring-primary bg-primary/5 border-primary/30" : "bg-muted/20"}`}
                              data-testid={`weather-day-${day.datetime}`}
                            >
                              <p className="text-[9px] font-medium text-muted-foreground">{formatDate(day.datetime)}</p>
                              {isLossDate && <p className="text-[7px] font-bold text-primary uppercase">Loss Date</p>}
                              <div className="flex justify-center my-1">{getWeatherIcon(day.icon, 18)}</div>
                              <p className="text-[9px] font-medium truncate">{day.conditions}</p>
                              <div className="text-[8px] text-muted-foreground mt-0.5">
                                <p>{day.tempmin}°–{day.tempmax}°F</p>
                                <p>G: {day.windgust} mph</p>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
