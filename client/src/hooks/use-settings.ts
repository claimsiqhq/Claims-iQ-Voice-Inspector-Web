import { useState, useCallback } from "react";

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
  // Voice & AI
  voiceModel: "alloy",
  voiceSpeed: 1.0,
  assistantVerbosity: "normal",
  pushToTalk: false,
  autoRecordOnRoomEntry: true,
  silenceDetectionSensitivity: "medium",

  // Inspection Defaults
  defaultRegion: "US-NATIONAL",
  defaultOverheadPercent: 10,
  defaultProfitPercent: 10,
  defaultTaxRate: 0,
  defaultWasteFactor: 10,
  measurementUnit: "imperial",
  autoGenerateBriefing: true,
  requirePhotoVerification: true,

  // Photo & Camera
  photoQuality: "high",
  autoAnalyzePhotos: true,
  timestampWatermark: true,
  gpsTagging: true,

  // Export & Reports
  companyName: "",
  adjusterLicenseNumber: "",
  includeTranscriptInExport: false,
  includePhotosInExport: true,
  exportFormat: "esx",

  // Notifications
  pushNotifications: true,
  soundEffects: true,
  claimStatusAlerts: true,
  inspectionReminders: true,

  // Display & Appearance
  theme: "system",
  compactMode: false,
  fontSize: "medium",
  showPhaseNumbers: true,
};

const STORAGE_KEY = "claimsiq-settings";

function loadSettings(): AppSettings {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(stored) };
    }
  } catch {
    // Ignore parse errors
  }
  return { ...DEFAULT_SETTINGS };
}

export function useSettings() {
  const [settings, setSettingsState] = useState<AppSettings>(loadSettings);

  const updateSetting = useCallback(<K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setSettingsState((prev) => {
      const next = { ...prev, [key]: value };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Ignore storage errors
      }
      return next;
    });
  }, []);

  const resetSettings = useCallback(() => {
    const defaults = { ...DEFAULT_SETTINGS };
    setSettingsState(defaults);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(defaults));
    } catch {
      // Ignore storage errors
    }
  }, []);

  return { settings, updateSetting, resetSettings };
}
