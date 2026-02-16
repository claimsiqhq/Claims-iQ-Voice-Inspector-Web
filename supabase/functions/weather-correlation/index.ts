import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const VISUAL_CROSSING_BASE = "https://weather.visualcrossing.com/VisualCrossingWebServices/rest/services/timeline";

interface WeatherDay {
  datetime: string; tempmax: number; tempmin: number; temp: number; humidity: number;
  precip: number; preciptype: string[] | null; windspeed: number; windgust: number;
  winddir: number; conditions: string; description: string; icon: string;
  severerisk: number; snowdepth: number; snow: number; visibility: number;
  pressure: number; cloudcover: number;
}

function buildLocation(city?: string | null, state?: string | null, zip?: string | null, address?: string | null): string {
  if (zip) return zip;
  if (city && state) return `${city}, ${state}`;
  if (address) return address;
  return "";
}

function getDateRange(dateOfLoss: string): { start: string; end: string } {
  const d = new Date(dateOfLoss);
  const start = new Date(d); start.setDate(start.getDate() - 3);
  const end = new Date(d); end.setDate(end.getDate() + 1);
  return { start: start.toISOString().split("T")[0], end: end.toISOString().split("T")[0] };
}

function analyzePerilMatch(perilType: string, weather: WeatherDay) {
  const peril = (perilType || "").toLowerCase();
  const conditions = (weather.conditions || "").toLowerCase();
  const precipTypes = (weather.preciptype || []).map(p => p.toLowerCase());
  const relevantConditions: string[] = [];

  if (peril === "hail" || peril.includes("hail")) {
    const hasHailPrecip = precipTypes.includes("hail") || precipTypes.includes("ice");
    const hasStorm = conditions.includes("storm") || conditions.includes("thunder");
    const highGust = weather.windgust >= 40;
    const highRisk = weather.severerisk >= 30;
    if (hasHailPrecip) relevantConditions.push(`Hail precipitation reported`);
    if (hasStorm) relevantConditions.push(`Storm conditions: ${weather.conditions}`);
    if (highGust) relevantConditions.push(`Wind gusts: ${weather.windgust} mph`);
    if (highRisk) relevantConditions.push(`Severe weather risk: ${weather.severerisk}%`);
    const supports = hasHailPrecip || (hasStorm && highRisk);
    let severity = "none";
    if (hasHailPrecip && highGust) severity = "severe";
    else if (hasHailPrecip) severity = "moderate";
    else if (hasStorm && highRisk) severity = "moderate";
    else if (hasStorm) severity = "mild";
    return {
      claimedPeril: perilType, weatherSupportsPeril: supports,
      confidence: hasHailPrecip ? "high" : (hasStorm ? "medium" : "low"),
      details: supports ? `Weather confirms hail/storm on ${weather.datetime}.` : `No hail/storm recorded on ${weather.datetime}. Conditions: ${weather.conditions}.`,
      relevantConditions, severityLevel: severity,
    };
  }

  if (peril === "wind" || peril.includes("wind")) {
    const highWind = weather.windspeed >= 50;
    const gustDamage = weather.windgust >= 58;
    const stormWind = weather.windgust >= 40;
    if (weather.windspeed >= 30) relevantConditions.push(`Sustained wind: ${weather.windspeed} mph`);
    if (weather.windgust >= 30) relevantConditions.push(`Wind gusts: ${weather.windgust} mph`);
    const supports = highWind || gustDamage || stormWind;
    let severity = "none";
    if (gustDamage) severity = "severe"; else if (highWind) severity = "severe"; else if (stormWind) severity = "moderate";
    return {
      claimedPeril: perilType, weatherSupportsPeril: supports,
      confidence: gustDamage ? "high" : (stormWind ? "medium" : "low"),
      details: supports ? `Wind conditions on ${weather.datetime} support wind damage. Gusts: ${weather.windgust} mph.` : `Wind below damage thresholds on ${weather.datetime}. Sustained: ${weather.windspeed} mph, Gusts: ${weather.windgust} mph.`,
      relevantConditions, severityLevel: severity,
    };
  }

  if (peril === "water" || peril.includes("water") || peril.includes("flood")) {
    const heavyRain = weather.precip >= 1.0;
    const significantRain = weather.precip >= 0.5;
    if (weather.precip > 0) relevantConditions.push(`Precipitation: ${weather.precip}"`);
    if (weather.humidity > 80) relevantConditions.push(`High humidity: ${weather.humidity}%`);
    const supports = heavyRain || (significantRain && conditions.includes("storm"));
    let severity = "none";
    if (weather.precip >= 3.0) severity = "extreme"; else if (heavyRain) severity = "severe"; else if (significantRain) severity = "moderate";
    return {
      claimedPeril: perilType, weatherSupportsPeril: supports || weather.precip > 0,
      confidence: heavyRain ? "high" : (significantRain ? "medium" : "low"),
      details: supports ? `Significant precipitation of ${weather.precip}" on ${weather.datetime} supports water damage.` : `Light/no precipitation on ${weather.datetime}. Internal source possible.`,
      relevantConditions, severityLevel: severity,
    };
  }

  relevantConditions.push(`Temperature: ${weather.tempmin}–${weather.tempmax}°F`, `Conditions: ${weather.conditions}`);
  return {
    claimedPeril: perilType || "Unknown", weatherSupportsPeril: true, confidence: "low",
    details: `General weather on ${weather.datetime}: ${weather.conditions}. Temp ${weather.tempmin}-${weather.tempmax}°F.`,
    relevantConditions, severityLevel: "mild",
  };
}

function generateFraudIndicators(perilType: string, lossWeather: WeatherDay, surroundingDays: WeatherDay[]) {
  const indicators: any[] = [];
  const perilAnalysis = analyzePerilMatch(perilType, lossWeather);

  if (perilAnalysis.weatherSupportsPeril) {
    indicators.push({ type: "match", category: "Weather Correlation", message: `Weather supports ${perilType} claim.`, severity: "low" });
  } else {
    indicators.push({ type: "mismatch", category: "Weather Correlation", message: `No significant ${perilType} weather on date of loss.`, severity: "high" });
  }

  const peril = (perilType || "").toLowerCase();
  if (peril === "hail" || peril === "wind") {
    const nearbyStorms = surroundingDays.filter(d => (d.conditions || "").toLowerCase().includes("storm") || d.windgust >= 40 || (d.preciptype || []).some(p => p.toLowerCase() === "hail"));
    if (!perilAnalysis.weatherSupportsPeril && nearbyStorms.length > 0) {
      indicators.push({ type: "warning", category: "Date Discrepancy", message: `Storm activity on nearby dates (${nearbyStorms.map(d => d.datetime).join(", ")}) but not on claimed date.`, severity: "medium" });
    }
  }

  if (peril === "water" && lossWeather.precip < 0.1 && !surroundingDays.some(d => d.precip >= 0.5)) {
    indicators.push({ type: "info", category: "Internal Source Likely", message: `Minimal precipitation suggests internal water source.`, severity: "low" });
  }

  if (lossWeather.severerisk >= 50) {
    indicators.push({ type: "match", category: "Severe Weather Alert", message: `High severe weather risk (${lossWeather.severerisk}%) on date of loss.`, severity: "low" });
  }

  return indicators;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { claimId } = await req.json();
    if (!claimId) return new Response(JSON.stringify({ error: "claimId required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const apiKey = Deno.env.get("WEATHER_API_KEY") || Deno.env.get("VISUAL_CROSSING_API_KEY");
    if (!apiKey) return new Response(JSON.stringify({ error: "WEATHER_API_KEY not set" }), { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: claim } = await supabase.from("claims").select("*").eq("id", claimId).limit(1).single();
    if (!claim) return new Response(JSON.stringify({ error: "Claim not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const location = buildLocation(claim.city, claim.state, claim.zip, claim.property_address);
    if (!location) return new Response(JSON.stringify({ error: "No location data" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    if (!claim.date_of_loss) return new Response(JSON.stringify({ error: "No date of loss" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { start, end } = getDateRange(claim.date_of_loss);
    const url = `${VISUAL_CROSSING_BASE}/${encodeURIComponent(location)}/${start}/${end}?unitGroup=us&include=days&key=${apiKey}&contentType=json`;
    const weatherRes = await fetch(url);
    if (!weatherRes.ok) throw new Error(`Weather API ${weatherRes.status}: ${await weatherRes.text()}`);
    const weatherData = await weatherRes.json();

    const days: WeatherDay[] = (weatherData.days || []).map((d: any) => ({
      datetime: d.datetime, tempmax: d.tempmax ?? 0, tempmin: d.tempmin ?? 0, temp: d.temp ?? 0,
      humidity: d.humidity ?? 0, precip: d.precip ?? 0, preciptype: d.preciptype || null,
      windspeed: d.windspeed ?? 0, windgust: d.windgust ?? 0, winddir: d.winddir ?? 0,
      conditions: d.conditions || "", description: d.description || "", icon: d.icon || "",
      severerisk: d.severerisk ?? 0, snowdepth: d.snowdepth ?? 0, snow: d.snow ?? 0,
      visibility: d.visibility ?? 10, pressure: d.pressure ?? 0, cloudcover: d.cloudcover ?? 0,
    }));

    const loseDateStr = claim.date_of_loss.includes("T") ? claim.date_of_loss.split("T")[0] : claim.date_of_loss;
    const lossDateWeather = days.find(d => d.datetime === loseDateStr) || null;
    const surroundingDays = days.filter(d => d.datetime !== loseDateStr);

    let perilAnalysis, fraudIndicators;
    if (lossDateWeather) {
      perilAnalysis = analyzePerilMatch(claim.peril_type || "", lossDateWeather);
      fraudIndicators = generateFraudIndicators(claim.peril_type || "", lossDateWeather, surroundingDays);
    } else {
      perilAnalysis = { claimedPeril: claim.peril_type || "Unknown", weatherSupportsPeril: false, confidence: "no_data", details: "No weather data for date of loss.", relevantConditions: [], severityLevel: "none" };
      fraudIndicators = [{ type: "warning", category: "Data Gap", message: "Could not retrieve weather data for date of loss.", severity: "medium" }];
    }

    let riskScore = 50;
    if (perilAnalysis.weatherSupportsPeril) { riskScore -= 20; if (perilAnalysis.confidence === "high") riskScore -= 15; }
    else { riskScore += 20; }
    for (const ind of fraudIndicators) {
      if (ind.type === "mismatch") riskScore += 15; else if (ind.type === "match") riskScore -= 10;
    }
    riskScore = Math.max(0, Math.min(100, Math.round(riskScore)));

    const weatherSummary = lossDateWeather
      ? `${lossDateWeather.conditions}. Temp: ${lossDateWeather.tempmin}–${lossDateWeather.tempmax}°F. Wind: ${lossDateWeather.windspeed} mph (gusts ${lossDateWeather.windgust} mph). Precip: ${lossDateWeather.precip}".`
      : "No weather data for date of loss.";

    return new Response(JSON.stringify({
      location: weatherData.resolvedAddress || location,
      dateOfLoss: claim.date_of_loss,
      dateRange: { start, end },
      lossDateWeather, surroundingDays: days,
      perilAnalysis, fraudIndicators,
      overallRiskScore: riskScore, weatherSummary,
      dataSource: "Visual Crossing Weather API",
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
