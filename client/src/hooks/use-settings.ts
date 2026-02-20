import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { apiRequest, resilientMutation } from "@/lib/queryClient";
import { useAuth } from "@/contexts/AuthContext";

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

interface SettingsState {
  settings: AppSettings;
  updateSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
  resetSettings: () => void;
  loaded: boolean;
}

const SettingsContext = createContext<SettingsState | null>(null);

function useSettingsState(): SettingsState {
  const { isAuthenticated, loading: authLoading, user } = useAuth();
  const [settings, setSettingsState] = useState<AppSettings>(loadLocalSettings);
  const [loaded, setLoaded] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSettingsRef = useRef<AppSettings | null>(null);
  const loadedUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (authLoading) return;
    let cancelled = false;

    if (!isAuthenticated || !user?.id) {
      loadedUserIdRef.current = null;
      setLoaded(true);
      return;
    }

    if (loadedUserIdRef.current === user.id) {
      setLoaded(true);
      return;
    }

    setLoaded(false);

    async function fetchFromDB() {
      try {
        const res = await apiRequest("GET", "/api/settings");
        const dbSettings = await res.json();
        if (!cancelled && dbSettings && Object.keys(dbSettings).length > 0) {
          const merged = { ...DEFAULT_SETTINGS, ...dbSettings };
          setSettingsState(merged);
          saveLocalSettings(merged);
        } else if (!cancelled) {
          setSettingsState((prev) => ({ ...DEFAULT_SETTINGS, ...prev }));
        }
      } catch {}

      if (!cancelled) {
        loadedUserIdRef.current = user?.id ?? null;
        setLoaded(true);
      }
    }

    fetchFromDB();
    return () => {
      cancelled = true;
    };
  }, [authLoading, isAuthenticated, user?.id]);

  const flushPendingToDB = useCallback(async () => {
    const toSave = pendingSettingsRef.current;
    if (!toSave || !isAuthenticated) return;
    pendingSettingsRef.current = null;
    try {
      await resilientMutation("PUT", "/api/settings", toSave, {
        label: "Save settings",
      });
    } catch {}
  }, [isAuthenticated]);

  const persistToDB = useCallback((nextSettings: AppSettings) => {
    pendingSettingsRef.current = nextSettings;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      void flushPendingToDB();
    }, 800);
  }, [flushPendingToDB]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const handleBeforeUnload = () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      void flushPendingToDB();
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [flushPendingToDB]);

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

  return useMemo(
    () => ({ settings, updateSetting, resetSettings, loaded }),
    [settings, updateSetting, resetSettings, loaded]
  );
}

export function SettingsContextProvider({ children }: { children: ReactNode }) {
  const state = useSettingsState();
  return createElement(SettingsContext.Provider, { value: state }, children);
}

export function useSettings() {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error("useSettings must be used within SettingsContextProvider");
  }
  return context;
}
