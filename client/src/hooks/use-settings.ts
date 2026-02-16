import { useState, useCallback, useEffect, useRef } from "react";
import { apiRequest } from "@/lib/queryClient";

export interface AppSettings {
  // Voice & AI
  voiceModel: string;
  voiceSpeed: number;
  assistantVerbosity: "concise" | "normal" | "detailed";
  pushToTalk: boolean;
  autoRecordOnRoomEntry: boolean;
  silenceDetectionSensitivity: "low" | "medium" | "high";

  // Inspection Defaults
  defaultRegion: string;
  defaultOverheadPercent: number;
  defaultProfitPercent: number;
  defaultTaxRate: number;
  defaultWasteFactor: number;
  measurementUnit: "imperial" | "metric";
  autoGenerateBriefing: boolean;
  requirePhotoVerification: boolean;

  // Photo & Camera
  photoQuality: "low" | "medium" | "high";
  autoAnalyzePhotos: boolean;
  timestampWatermark: boolean;
  gpsTagging: boolean;

  // Export & Reports
  companyName: string;
  adjusterLicenseNumber: string;
  includeTranscriptInExport: boolean;
  includePhotosInExport: boolean;
  exportFormat: "esx" | "pdf" | "both";

  // Notifications
  pushNotifications: boolean;
  soundEffects: boolean;
  claimStatusAlerts: boolean;
  inspectionReminders: boolean;

  // Display & Appearance
  theme: "light" | "dark" | "system";
  compactMode: boolean;
  fontSize: "small" | "medium" | "large";
  showPhaseNumbers: boolean;
}

const DEFAULT_SETTINGS: AppSettings = {
  voiceModel: "alloy",
  voiceSpeed: 1.0,
  assistantVerbosity: "normal",
  pushToTalk: false,
  autoRecordOnRoomEntry: true,
  silenceDetectionSensitivity: "medium",

  defaultRegion: "US-NATIONAL",
  defaultOverheadPercent: 10,
  defaultProfitPercent: 10,
  defaultTaxRate: 0,
  defaultWasteFactor: 10,
  measurementUnit: "imperial",
  autoGenerateBriefing: true,
  requirePhotoVerification: true,

  photoQuality: "high",
  autoAnalyzePhotos: true,
  timestampWatermark: true,
  gpsTagging: true,

  companyName: "",
  adjusterLicenseNumber: "",
  includeTranscriptInExport: false,
  includePhotosInExport: true,
  exportFormat: "esx",

  pushNotifications: true,
  soundEffects: true,
  claimStatusAlerts: true,
  inspectionReminders: true,

  theme: "system",
  compactMode: false,
  fontSize: "medium",
  showPhaseNumbers: true,
};

const STORAGE_KEY = "claimsiq-settings";

function loadLocalSettings(): AppSettings {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(stored) };
    }
  } catch {}
  return { ...DEFAULT_SETTINGS };
}

function saveLocalSettings(settings: AppSettings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {}
}

export function useSettings() {
  const [settings, setSettingsState] = useState<AppSettings>(loadLocalSettings);
  const [loaded, setLoaded] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSettingsRef = useRef<AppSettings | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function fetchFromDB() {
      try {
        const res = await apiRequest("GET", "/api/settings");
        const dbSettings = await res.json();
        if (!cancelled && dbSettings && Object.keys(dbSettings).length > 0) {
          const merged = { ...DEFAULT_SETTINGS, ...dbSettings };
          setSettingsState(merged);
          saveLocalSettings(merged);
        }
      } catch {}
      if (!cancelled) setLoaded(true);
    }
    fetchFromDB();
    return () => { cancelled = true; };
  }, []);

  const persistToDB = useCallback((nextSettings: AppSettings) => {
    pendingSettingsRef.current = nextSettings;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      const toSave = pendingSettingsRef.current;
      if (!toSave) return;
      try {
        await apiRequest("PUT", "/api/settings", toSave);
      } catch {}
    }, 800);
  }, []);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  const updateSetting = useCallback(<K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setSettingsState((prev) => {
      const next = { ...prev, [key]: value };
      saveLocalSettings(next);
      persistToDB(next);
      return next;
    });
  }, [persistToDB]);

  const resetSettings = useCallback(() => {
    const defaults = { ...DEFAULT_SETTINGS };
    setSettingsState(defaults);
    saveLocalSettings(defaults);
    persistToDB(defaults);
  }, [persistToDB]);

  return { settings, updateSetting, resetSettings, loaded };
}
