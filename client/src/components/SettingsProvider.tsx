import { useEffect } from "react";
import { SettingsContextProvider, useSettings } from "@/hooks/use-settings";

function SettingsEffects() {
  const { settings, loaded } = useSettings();

  useEffect(() => {
    if (!loaded) return;
    const root = document.documentElement;

    if (settings.theme === "dark") {
      root.classList.add("dark");
    } else if (settings.theme === "light") {
      root.classList.remove("dark");
    } else {
      const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      root.classList.toggle("dark", prefersDark);
    }
  }, [settings.theme, loaded]);

  useEffect(() => {
    if (!loaded) return;
    const listener = (e: MediaQueryListEvent) => {
      if (settings.theme === "system") {
        document.documentElement.classList.toggle("dark", e.matches);
      }
    };
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", listener);
    return () => mq.removeEventListener("change", listener);
  }, [settings.theme, loaded]);

  useEffect(() => {
    if (!loaded) return;
    const root = document.documentElement;
    const sizeMap = { small: "14px", medium: "16px", large: "18px" };
    root.style.fontSize = sizeMap[settings.fontSize] || "16px";
  }, [settings.fontSize, loaded]);

  useEffect(() => {
    if (!loaded) return;
    document.documentElement.classList.toggle("compact-mode", settings.compactMode);
  }, [settings.compactMode, loaded]);

  return null;
}

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  return (
    <SettingsContextProvider>
      <SettingsEffects />
      {children}
    </SettingsContextProvider>
  );
}
