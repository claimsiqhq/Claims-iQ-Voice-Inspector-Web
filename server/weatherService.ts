import { logger } from "./logger";

const VISUAL_CROSSING_BASE = "https://weather.visualcrossing.com/VisualCrossingWebServices/rest/services/timeline";

export interface WeatherDay {
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
  snowdepth: number;
  snow: number;
  visibility: number;
  pressure: number;
  cloudcover: number;
}

export interface WeatherCorrelation {
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

export interface PerilAnalysis {
  claimedPeril: string;
  weatherSupportsPeril: boolean;
  confidence: "high" | "medium" | "low" | "no_data";
  details: string;
  relevantConditions: string[];
  severityLevel: "extreme" | "severe" | "moderate" | "mild" | "none";
}

export interface FraudIndicator {
  type: "match" | "mismatch" | "warning" | "info";
  category: string;
  message: string;
  severity: "high" | "medium" | "low";
}

const weatherCache = new Map<string, { data: any; timestamp: number }>();
const CACHE_TTL = 24 * 60 * 60 * 1000;

function getCacheKey(location: string, startDate: string, endDate: string): string {
  return `${location}|${startDate}|${endDate}`;
}

async function fetchWeatherData(location: string, startDate: string, endDate: string, apiKey: string): Promise<any> {
  const cacheKey = getCacheKey(location, startDate, endDate);
  const cached = weatherCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }

  const encodedLocation = encodeURIComponent(location);
  const url = `${VISUAL_CROSSING_BASE}/${encodedLocation}/${startDate}/${endDate}?unitGroup=us&include=days&key=${apiKey}&contentType=json`;

  const response = await fetch(url);
  if (!response.ok) {
    const errorText = await response.text();
    logger.error("Weather API error", "WeatherService", { status: response.status, error: errorText });
    throw new Error(`Weather API returned ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  weatherCache.set(cacheKey, { data, timestamp: Date.now() });
  return data;
}

function buildLocation(city?: string | null, state?: string | null, zip?: string | null, address?: string | null): string {
  if (zip) return zip;
  if (city && state) return `${city}, ${state}`;
  if (address) return address;
  return "";
}

function getDateRange(dateOfLoss: string): { start: string; end: string } {
  const lossDate = new Date(dateOfLoss);
  const start = new Date(lossDate);
  start.setDate(start.getDate() - 3);
  const end = new Date(lossDate);
  end.setDate(end.getDate() + 1);
  return {
    start: start.toISOString().split("T")[0],
    end: end.toISOString().split("T")[0],
  };
}

function analyzePerilMatch(perilType: string, weather: WeatherDay): PerilAnalysis {
  const peril = (perilType || "").toLowerCase();
  const conditions = (weather.conditions || "").toLowerCase();
  const precipTypes = (weather.preciptype || []).map(p => p.toLowerCase());
  const relevantConditions: string[] = [];

  if (peril === "hail" || peril.includes("hail")) {
    const hasHailPrecip = precipTypes.includes("hail") || precipTypes.includes("ice");
    const hasStormConditions = conditions.includes("storm") || conditions.includes("thunder");
    const highWindGust = weather.windgust >= 40;
    const highSevereRisk = weather.severerisk >= 30;

    if (hasHailPrecip) relevantConditions.push(`Hail precipitation reported`);
    if (hasStormConditions) relevantConditions.push(`Storm/thunderstorm conditions: ${weather.conditions}`);
    if (highWindGust) relevantConditions.push(`Wind gusts: ${weather.windgust} mph`);
    if (highSevereRisk) relevantConditions.push(`Severe weather risk: ${weather.severerisk}%`);

    const supportsPeril = hasHailPrecip || (hasStormConditions && highSevereRisk);
    let severity: PerilAnalysis["severityLevel"] = "none";
    if (hasHailPrecip && highWindGust) severity = "severe";
    else if (hasHailPrecip) severity = "moderate";
    else if (hasStormConditions && highSevereRisk) severity = "moderate";
    else if (hasStormConditions) severity = "mild";

    return {
      claimedPeril: perilType,
      weatherSupportsPeril: supportsPeril,
      confidence: hasHailPrecip ? "high" : (hasStormConditions ? "medium" : "low"),
      details: supportsPeril
        ? `Weather data confirms hail/storm activity on ${weather.datetime}. ${hasHailPrecip ? "Hail precipitation was recorded." : "Severe storm conditions were present."}`
        : `No hail or significant storm activity recorded on ${weather.datetime}. Conditions: ${weather.conditions}. This does not necessarily indicate fraud — localized hail events may not appear in station data.`,
      relevantConditions,
      severityLevel: severity,
    };
  }

  if (peril === "wind" || peril.includes("wind")) {
    const highWind = weather.windspeed >= 50;
    const gustDamage = weather.windgust >= 58;
    const stormWind = weather.windgust >= 40;

    if (weather.windspeed >= 30) relevantConditions.push(`Sustained wind: ${weather.windspeed} mph`);
    if (weather.windgust >= 30) relevantConditions.push(`Wind gusts: ${weather.windgust} mph`);
    if (conditions.includes("storm")) relevantConditions.push(`Storm conditions: ${weather.conditions}`);

    const supportsPeril = highWind || gustDamage || stormWind;
    let severity: PerilAnalysis["severityLevel"] = "none";
    if (gustDamage) severity = "severe";
    else if (highWind) severity = "severe";
    else if (stormWind) severity = "moderate";
    else if (weather.windgust >= 25) severity = "mild";

    return {
      claimedPeril: perilType,
      weatherSupportsPeril: supportsPeril,
      confidence: gustDamage ? "high" : (stormWind ? "medium" : "low"),
      details: supportsPeril
        ? `Wind conditions on ${weather.datetime} support wind damage claims. ${gustDamage ? `Damaging wind gusts of ${weather.windgust} mph recorded.` : `Elevated wind speeds recorded.`}`
        : `Wind speeds on ${weather.datetime} were below typical damage thresholds. Sustained: ${weather.windspeed} mph, Gusts: ${weather.windgust} mph.`,
      relevantConditions,
      severityLevel: severity,
    };
  }

  if (peril === "water" || peril.includes("water") || peril.includes("flood")) {
    const heavyRain = weather.precip >= 1.0;
    const significantRain = weather.precip >= 0.5;
    const hasRainPrecip = precipTypes.includes("rain");
    const hasSnow = weather.snow > 0;

    if (weather.precip > 0) relevantConditions.push(`Precipitation: ${weather.precip}" recorded`);
    if (hasSnow) relevantConditions.push(`Snowfall: ${weather.snow}" recorded`);
    if (weather.humidity > 80) relevantConditions.push(`High humidity: ${weather.humidity}%`);
    if (conditions.includes("rain") || conditions.includes("storm")) relevantConditions.push(`Conditions: ${weather.conditions}`);

    const supportsPeril = heavyRain || (significantRain && conditions.includes("storm"));
    let severity: PerilAnalysis["severityLevel"] = "none";
    if (weather.precip >= 3.0) severity = "extreme";
    else if (heavyRain) severity = "severe";
    else if (significantRain) severity = "moderate";
    else if (weather.precip > 0.1) severity = "mild";

    return {
      claimedPeril: perilType,
      weatherSupportsPeril: supportsPeril || weather.precip > 0,
      confidence: heavyRain ? "high" : (significantRain ? "medium" : "low"),
      details: supportsPeril
        ? `Significant precipitation of ${weather.precip}" on ${weather.datetime} supports water damage claims.`
        : weather.precip > 0
          ? `Light precipitation of ${weather.precip}" recorded on ${weather.datetime}. Internal plumbing/appliance failures remain possible causes.`
          : `No precipitation recorded on ${weather.datetime}. Water damage may be from internal sources (plumbing, appliance, etc.).`,
      relevantConditions,
      severityLevel: severity,
    };
  }

  if (peril === "fire" || peril.includes("fire")) {
    const lowHumidity = weather.humidity < 30;
    const highTemp = weather.tempmax > 90;
    const highWind = weather.windspeed > 25;

    if (lowHumidity) relevantConditions.push(`Low humidity: ${weather.humidity}%`);
    if (highTemp) relevantConditions.push(`High temperature: ${weather.tempmax}°F`);
    if (highWind) relevantConditions.push(`Wind speed: ${weather.windspeed} mph (fire spread risk)`);

    return {
      claimedPeril: perilType,
      weatherSupportsPeril: true,
      confidence: "medium",
      details: `Fire claims are primarily structural — weather data shows ${weather.conditions} on ${weather.datetime}. ${lowHumidity ? "Low humidity conditions increase fire risk." : ""}`,
      relevantConditions,
      severityLevel: lowHumidity && highTemp ? "moderate" : "mild",
    };
  }

  relevantConditions.push(`Temperature: ${weather.tempmin}°F - ${weather.tempmax}°F`);
  relevantConditions.push(`Conditions: ${weather.conditions}`);
  if (weather.precip > 0) relevantConditions.push(`Precipitation: ${weather.precip}"`);
  if (weather.windgust > 30) relevantConditions.push(`Wind gusts: ${weather.windgust} mph`);

  return {
    claimedPeril: perilType || "Unknown",
    weatherSupportsPeril: true,
    confidence: "low",
    details: `General weather on ${weather.datetime}: ${weather.conditions}. Temp ${weather.tempmin}-${weather.tempmax}°F. Additional investigation may be needed.`,
    relevantConditions,
    severityLevel: "mild",
  };
}

function generateFraudIndicators(perilType: string, lossWeather: WeatherDay, surroundingDays: WeatherDay[]): FraudIndicator[] {
  const indicators: FraudIndicator[] = [];
  const peril = (perilType || "").toLowerCase();

  const perilAnalysis = analyzePerilMatch(perilType, lossWeather);

  if (perilAnalysis.weatherSupportsPeril) {
    indicators.push({
      type: "match",
      category: "Weather Correlation",
      message: `Weather data supports ${perilType} claim — ${perilAnalysis.details.split(".")[0]}.`,
      severity: "low",
    });
  } else {
    indicators.push({
      type: "mismatch",
      category: "Weather Correlation",
      message: `No significant ${perilType} weather activity recorded on date of loss. Consider requesting additional documentation.`,
      severity: "high",
    });
  }

  if (peril === "hail" || peril === "wind") {
    const nearbyStormDays = surroundingDays.filter(d => {
      const cond = (d.conditions || "").toLowerCase();
      return cond.includes("storm") || d.windgust >= 40 || (d.preciptype || []).some(p => p.toLowerCase() === "hail");
    });

    if (!perilAnalysis.weatherSupportsPeril && nearbyStormDays.length > 0) {
      const stormDates = nearbyStormDays.map(d => d.datetime).join(", ");
      indicators.push({
        type: "warning",
        category: "Date Discrepancy",
        message: `Storm activity was recorded on nearby dates (${stormDates}) but not on the claimed date of loss. Verify the exact date of loss.`,
        severity: "medium",
      });
    }
  }

  if (peril === "hail" && lossWeather.tempmin > 50 && !(lossWeather.preciptype || []).some(p => p.toLowerCase() === "hail")) {
    const coldDays = surroundingDays.filter(d => d.tempmin < 40);
    if (coldDays.length === 0) {
      indicators.push({
        type: "info",
        category: "Temperature Context",
        message: `Temperatures remained above 50°F around the date of loss. While hail can occur in warm weather during thunderstorms, confirm storm cell activity.`,
        severity: "low",
      });
    }
  }

  if (peril === "water" && lossWeather.precip < 0.1 && !surroundingDays.some(d => d.precip >= 0.5)) {
    indicators.push({
      type: "info",
      category: "Internal Source Likely",
      message: `Minimal precipitation in the surrounding days suggests water damage is likely from an internal source (plumbing, appliance failure, etc.).`,
      severity: "low",
    });
  }

  if (lossWeather.severerisk >= 50) {
    indicators.push({
      type: "match",
      category: "Severe Weather Alert",
      message: `High severe weather risk (${lossWeather.severerisk}%) recorded on date of loss, supporting the likelihood of storm-related damage.`,
      severity: "low",
    });
  }

  return indicators;
}

function calculateOverallRiskScore(indicators: FraudIndicator[], perilAnalysis: PerilAnalysis): number {
  let score = 50;

  if (perilAnalysis.weatherSupportsPeril) {
    score -= 20;
    if (perilAnalysis.confidence === "high") score -= 15;
    else if (perilAnalysis.confidence === "medium") score -= 10;
  } else {
    score += 20;
    if (perilAnalysis.confidence === "low") score += 10;
  }

  for (const ind of indicators) {
    if (ind.type === "mismatch") {
      score += ind.severity === "high" ? 15 : ind.severity === "medium" ? 10 : 5;
    } else if (ind.type === "match") {
      score -= ind.severity === "high" ? 10 : ind.severity === "medium" ? 7 : 3;
    } else if (ind.type === "warning") {
      score += ind.severity === "high" ? 10 : ind.severity === "medium" ? 5 : 3;
    }
  }

  return Math.max(0, Math.min(100, Math.round(score)));
}

export async function getWeatherCorrelation(
  claimData: {
    propertyAddress?: string | null;
    city?: string | null;
    state?: string | null;
    zip?: string | null;
    dateOfLoss?: string | null;
    perilType?: string | null;
  },
  apiKey: string
): Promise<WeatherCorrelation> {
  const location = buildLocation(claimData.city, claimData.state, claimData.zip, claimData.propertyAddress);
  if (!location) {
    throw new Error("No location data available for weather lookup. Claim must have city/state, zip, or address.");
  }

  if (!claimData.dateOfLoss) {
    throw new Error("Date of loss is required for weather correlation.");
  }

  const { start, end } = getDateRange(claimData.dateOfLoss);

  const weatherData = await fetchWeatherData(location, start, end, apiKey);

  const days: WeatherDay[] = (weatherData.days || []).map((d: any) => ({
    datetime: d.datetime,
    tempmax: d.tempmax ?? 0,
    tempmin: d.tempmin ?? 0,
    temp: d.temp ?? 0,
    humidity: d.humidity ?? 0,
    precip: d.precip ?? 0,
    preciptype: d.preciptype || null,
    windspeed: d.windspeed ?? 0,
    windgust: d.windgust ?? 0,
    winddir: d.winddir ?? 0,
    conditions: d.conditions || "",
    description: d.description || "",
    icon: d.icon || "",
    severerisk: d.severerisk ?? 0,
    snowdepth: d.snowdepth ?? 0,
    snow: d.snow ?? 0,
    visibility: d.visibility ?? 10,
    pressure: d.pressure ?? 0,
    cloudcover: d.cloudcover ?? 0,
  }));

  const loseDateStr = claimData.dateOfLoss.includes("T")
    ? claimData.dateOfLoss.split("T")[0]
    : claimData.dateOfLoss;
  const lossDateWeather = days.find(d => d.datetime === loseDateStr) || null;
  const surroundingDays = days.filter(d => d.datetime !== loseDateStr);

  let perilAnalysis: PerilAnalysis;
  let fraudIndicators: FraudIndicator[];

  if (lossDateWeather) {
    perilAnalysis = analyzePerilMatch(claimData.perilType || "", lossDateWeather);
    fraudIndicators = generateFraudIndicators(claimData.perilType || "", lossDateWeather, surroundingDays);
  } else {
    perilAnalysis = {
      claimedPeril: claimData.perilType || "Unknown",
      weatherSupportsPeril: false,
      confidence: "no_data",
      details: "Weather data for the exact date of loss was not available.",
      relevantConditions: [],
      severityLevel: "none",
    };
    fraudIndicators = [{
      type: "warning",
      category: "Data Gap",
      message: "Could not retrieve weather data for the exact date of loss. Manual verification recommended.",
      severity: "medium",
    }];
  }

  const overallRiskScore = calculateOverallRiskScore(fraudIndicators, perilAnalysis);

  const weatherSummary = lossDateWeather
    ? `${lossDateWeather.conditions}. Temp: ${lossDateWeather.tempmin}–${lossDateWeather.tempmax}°F. Wind: ${lossDateWeather.windspeed} mph (gusts ${lossDateWeather.windgust} mph). Precip: ${lossDateWeather.precip}".`
    : "No weather data available for date of loss.";

  return {
    location: weatherData.resolvedAddress || location,
    dateOfLoss: claimData.dateOfLoss,
    dateRange: { start, end },
    lossDateWeather,
    surroundingDays: days,
    perilAnalysis,
    fraudIndicators,
    overallRiskScore,
    weatherSummary,
    dataSource: "Visual Crossing Weather API",
  };
}
