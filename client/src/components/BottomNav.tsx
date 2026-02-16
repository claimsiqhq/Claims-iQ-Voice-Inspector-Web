import { useLocation } from "wouter";
import { Home, FileText, Mic, ClipboardCheck, Camera, PenTool, List } from "lucide-react";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";

interface Claim {
  id: number;
  claimNumber: string;
  status: string;
}

interface NavItem {
  icon: React.ElementType;
  label: string;
  getPath: (activeClaim: Claim | null) => string;
  matchPaths: string[];
  prominent?: boolean;
}

function getNavItems(): NavItem[] {
  return [
    {
      icon: Home,
      label: "Home",
      getPath: () => "/",
      matchPaths: ["/"],
    },
    {
      icon: FileText,
      label: "Docs",
      getPath: () => "/documents",
      matchPaths: ["/documents", "/upload", "/review"],
    },
    {
      icon: List,
      label: "Scope",
      getPath: (c) => c ? `/inspection/${c.id}/review` : "/",
      matchPaths: ["/inspection/*/review"],
    },
    {
      icon: Mic,
      label: "Inspect",
      getPath: (c) => {
        if (!c) return "/";
        const s = c.status.toLowerCase().replace(/\s+/g, "_");
        if (s === "inspecting") return `/inspection/${c.id}`;
        if (s === "briefing_ready") return `/briefing/${c.id}`;
        return `/briefing/${c.id}`;
      },
      matchPaths: ["/briefing", "/inspection"],
      prominent: true,
    },
    {
      icon: ClipboardCheck,
      label: "Reports",
      getPath: (c) => c ? `/inspection/${c.id}/export` : "/",
      matchPaths: ["/inspection/*/export"],
    },
    {
      icon: Camera,
      label: "Photos",
      getPath: () => "/photo-lab",
      matchPaths: ["/photo-lab", "/gallery/photos"],
    },
    {
      icon: PenTool,
      label: "Sketches",
      getPath: () => "/gallery/sketches",
      matchPaths: ["/gallery/sketches"],
    },
  ];
}

function isActive(location: string, matchPaths: string[]): boolean {
  if (matchPaths.includes("/") && location === "/") return true;
  return matchPaths
    .filter((p) => p !== "/")
    .some((p) => {
      if (p.includes("*")) {
        const regex = new RegExp("^" + p.replace(/\*/g, "[^/]+") + "$");
        return regex.test(location);
      }
      return location.startsWith(p);
    });
}

function extractClaimIdFromPath(path: string): number | null {
  const match = path.match(/\/(upload|review|briefing|inspection|export)\/(\d+)/);
  return match ? parseInt(match[2]) : null;
}

export default function BottomNav() {
  const [location, setLocation] = useLocation();
  const { isAuthenticated } = useAuth();

  const { data: claims = [] } = useQuery<Claim[]>({
    queryKey: ["/api/claims"],
    enabled: isAuthenticated,
  });

  if (!isAuthenticated) return null;

  const currentClaimId = extractClaimIdFromPath(location);
  const activeClaim = currentClaimId
    ? claims.find((c) => c.id === currentClaimId) || null
    : claims.length > 0 ? claims[0] : null;

  const navItems = getNavItems();

  const hideOnPaths = ["/inspection/"];
  const shouldHide = hideOnPaths.some(
    (p) => location.startsWith(p) && !location.includes("/review") && !location.includes("/export")
  );
  if (shouldHide) return null;

  return (
    <nav
      data-testid="bottom-nav"
      className="fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-border shadow-[0_-2px_10px_rgba(0,0,0,0.06)]"
    >
      <div className="flex items-center justify-around h-16 px-2 max-w-lg mx-auto">
        {navItems.map((item) => {
          const active = isActive(location, item.matchPaths);
          const Icon = item.icon;
          const targetPath = item.getPath(activeClaim);

          if (item.prominent) {
            return (
              <button
                key={item.label}
                data-testid={`nav-${item.label.toLowerCase()}`}
                onClick={() => setLocation(targetPath)}
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
              data-testid={`nav-${item.label.toLowerCase()}`}
              onClick={() => setLocation(targetPath)}
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
      <div className="h-[env(safe-area-inset-bottom)]" />
    </nav>
  );
}
