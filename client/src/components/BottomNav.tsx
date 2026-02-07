import { useLocation } from "wouter";
import { Home, FileText, Mic, ClipboardCheck, Settings } from "lucide-react";
import { cn } from "@/lib/utils";

interface NavItem {
  icon: React.ElementType;
  label: string;
  path: string;
  matchPaths: string[];
  prominent?: boolean;
}

const navItems: NavItem[] = [
  {
    icon: Home,
    label: "Home",
    path: "/",
    matchPaths: ["/"],
  },
  {
    icon: FileText,
    label: "Documents",
    path: "/",
    matchPaths: ["/upload", "/review"],
  },
  {
    icon: Mic,
    label: "Inspect",
    path: "/",
    matchPaths: ["/briefing", "/inspection"],
    prominent: true,
  },
  {
    icon: ClipboardCheck,
    label: "Reports",
    path: "/",
    matchPaths: ["/inspection/", "/export"],
  },
  {
    icon: Settings,
    label: "Settings",
    path: "/",
    matchPaths: ["/settings"],
  },
];

function isActive(location: string, matchPaths: string[]): boolean {
  // Exact match for home
  if (matchPaths.includes("/") && location === "/") return true;
  // Prefix match for other paths (skip "/" to avoid matching everything)
  return matchPaths
    .filter((p) => p !== "/")
    .some((p) => location.startsWith(p));
}

export default function BottomNav() {
  const [location, setLocation] = useLocation();

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-border shadow-[0_-2px_10px_rgba(0,0,0,0.06)]">
      {/* Safe area spacer for iOS notch devices */}
      <div className="flex items-center justify-around h-16 px-2 max-w-lg mx-auto">
        {navItems.map((item) => {
          const active = isActive(location, item.matchPaths);
          const Icon = item.icon;

          if (item.prominent) {
            return (
              <button
                key={item.label}
                onClick={() => setLocation(item.path)}
                className="flex flex-col items-center justify-center -mt-5"
              >
                <div
                  className={cn(
                    "h-12 w-12 rounded-full flex items-center justify-center shadow-lg transition-colors",
                    active
                      ? "bg-primary text-white"
                      : "bg-foreground text-white"
                  )}
                >
                  <Icon className="h-6 w-6" />
                </div>
                <span
                  className={cn(
                    "text-[10px] mt-1 font-medium",
                    active ? "text-primary" : "text-muted-foreground"
                  )}
                >
                  {item.label}
                </span>
              </button>
            );
          }

          return (
            <button
              key={item.label}
              onClick={() => setLocation(item.path)}
              className="flex flex-col items-center justify-center gap-0.5 min-w-[56px] py-1 transition-colors"
            >
              <Icon
                className={cn(
                  "h-5 w-5 transition-colors",
                  active ? "text-primary" : "text-muted-foreground"
                )}
              />
              <span
                className={cn(
                  "text-[10px] font-medium transition-colors",
                  active ? "text-primary" : "text-muted-foreground"
                )}
              >
                {item.label}
              </span>
              {active && (
                <div className="h-0.5 w-4 rounded-full bg-primary mt-0.5" />
              )}
            </button>
          );
        })}
      </div>
      {/* iOS safe area bottom padding */}
      <div className="h-[env(safe-area-inset-bottom)]" />
    </nav>
  );
}
