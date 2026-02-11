import React, { useState, useRef, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { 
  LayoutDashboard, 
  FileText, 
  ClipboardCheck, 
  Mic, 
  CheckCircle,
  Menu,
  Bell,
  Search,
  ChevronLeft,
  FileSearch,
  ClipboardList,
  FilePlus,
  X
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/contexts/AuthContext";
import { useSettings } from "@/hooks/use-settings";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

interface Notification {
  id: string;
  type: string;
  title: string;
  message: string;
  claimId?: number;
  timestamp: string;
  read: boolean;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function notificationIcon(type: string) {
  switch (type) {
    case "inspection": return <Mic className="h-4 w-4 text-blue-400" />;
    case "review": return <ClipboardList className="h-4 w-4 text-amber-400" />;
    case "new_claim": return <FilePlus className="h-4 w-4 text-green-400" />;
    default: return <Bell className="h-4 w-4 text-gray-400" />;
  }
}

interface LayoutProps {
  children: React.ReactNode;
  title?: string;
  showBack?: boolean;
}

export default function Layout({ children, title = "Claims IQ", showBack = false }: LayoutProps) {
  const [location, setLocation] = useLocation();
  const { user } = useAuth();
  const { settings } = useSettings();
  const [showNotifications, setShowNotifications] = useState(false);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem("claimsiq_dismissed_notifs");
      return saved ? new Set(JSON.parse(saved)) : new Set();
    } catch { return new Set(); }
  });
  const panelRef = useRef<HTMLDivElement>(null);

  const displayName = user?.fullName || user?.email?.split("@")[0] || "User";
  const displayTitle = user?.title || (user?.role === "admin" ? "Administrator" : user?.role === "supervisor" ? "Supervisor" : "Field Adjuster");
  const initials = displayName.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);

  const { data: notifications = [] } = useQuery<Notification[]>({
    queryKey: ["/api/notifications"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/notifications");
      return res.json();
    },
    refetchInterval: 60000,
    enabled: !!user,
  });

  const visibleNotifications = notifications.filter(n => {
    if (dismissedIds.has(n.id)) return false;
    if (n.type === "inspection" && !settings.inspectionReminders) return false;
    if (n.type === "review" && !settings.claimStatusAlerts) return false;
    if (n.type === "new_claim" && !settings.claimStatusAlerts) return false;
    return true;
  });
  const unreadCount = visibleNotifications.length;

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setShowNotifications(false);
      }
    }
    if (showNotifications) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showNotifications]);

  function dismissNotification(id: string) {
    setDismissedIds(prev => {
      const next = new Set(prev);
      next.add(id);
      localStorage.setItem("claimsiq_dismissed_notifs", JSON.stringify(Array.from(next)));
      return next;
    });
  }

  function dismissAll() {
    setDismissedIds(prev => {
      const next = new Set(prev);
      visibleNotifications.forEach(n => next.add(n.id));
      localStorage.setItem("claimsiq_dismissed_notifs", JSON.stringify(Array.from(next)));
      return next;
    });
  }

  function handleNotificationClick(n: Notification) {
    setShowNotifications(false);
    if (n.claimId) {
      if (n.type === "inspection") {
        setLocation(`/inspection/${n.claimId}`);
      } else if (n.type === "review") {
        setLocation(`/inspection/${n.claimId}/review`);
      } else {
        setLocation(`/upload/${n.claimId}`);
      }
    }
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="h-14 md:h-16 bg-foreground text-white flex items-center justify-between px-3 md:px-6 shadow-md z-50">
        <div className="flex items-center gap-2 md:gap-4 min-w-0">
          {showBack && (
            <Button variant="ghost" size="icon" className="text-white hover:bg-white/10 shrink-0 h-8 w-8 md:h-10 md:w-10" onClick={() => window.history.back()} aria-label="Go back">
              <ChevronLeft className="h-5 w-5 md:h-6 md:w-6" />
            </Button>
          )}
          
          <div className="flex items-center gap-2 shrink-0">
            <div className="h-7 w-7 md:h-8 md:w-8 bg-primary rounded-lg flex items-center justify-center">
              <Mic className="h-4 w-4 md:h-5 md:w-5 text-white" />
            </div>
            <h1 className="text-base md:text-lg font-display font-bold tracking-wide hidden sm:block">Claims IQ</h1>
          </div>

          {title !== "Claims IQ" && (
            <>
              <div className="h-5 w-px bg-white/20 mx-1 md:mx-2 hidden sm:block" />
              <h2 className="text-sm md:text-lg font-display font-medium text-white/90 truncate">{title}</h2>
            </>
          )}
        </div>

        <div className="flex items-center gap-2 md:gap-4 shrink-0">
          <div className="relative hidden md:block">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-white/50" />
            <input 
              className="h-9 w-64 rounded-full bg-white/10 border-none pl-9 pr-4 text-sm text-white placeholder:text-white/50 focus:ring-1 focus:ring-primary"
              placeholder="Search claims..." 
              aria-label="Search claims"
            />
          </div>
          
          <div className="relative" ref={panelRef}>
            <Button
              data-testid="button-notifications"
              variant="ghost"
              size="icon"
              className="text-white hover:bg-white/10 relative h-8 w-8 md:h-10 md:w-10"
              onClick={() => setShowNotifications(!showNotifications)}
              aria-label={showNotifications ? "Close notifications" : `Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ""}`}
            >
              <Bell className="h-4 w-4 md:h-5 md:w-5" />
              {unreadCount > 0 && (
                <span className="absolute top-0.5 right-0.5 md:top-1 md:right-1 min-w-[18px] h-[18px] bg-accent rounded-full flex items-center justify-center text-[10px] font-bold text-white px-1" data-testid="text-notification-count">
                  {unreadCount > 9 ? "9+" : unreadCount}
                </span>
              )}
            </Button>

            {showNotifications && (
              <div className="absolute right-0 top-full mt-2 w-80 md:w-96 bg-white rounded-xl shadow-2xl border border-gray-200 overflow-hidden z-[100]" data-testid="panel-notifications">
                <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-b">
                  <h3 className="text-sm font-semibold text-gray-900">Notifications</h3>
                  {visibleNotifications.length > 0 && (
                    <button
                      data-testid="button-dismiss-all"
                      onClick={dismissAll}
                      className="text-xs text-primary hover:text-primary/80 font-medium"
                    >
                      Dismiss all
                    </button>
                  )}
                </div>

                <div className="max-h-80 overflow-y-auto">
                  {visibleNotifications.length === 0 ? (
                    <div className="py-10 text-center" data-testid="text-no-notifications">
                      <Bell className="h-8 w-8 text-gray-300 mx-auto mb-2" />
                      <p className="text-sm text-gray-500">All caught up!</p>
                      <p className="text-xs text-gray-400 mt-1">No new notifications</p>
                    </div>
                  ) : (
                    visibleNotifications.map((n) => (
                      <div
                        key={n.id}
                        data-testid={`notification-${n.id}`}
                        className="flex items-start gap-3 px-4 py-3 hover:bg-gray-50 cursor-pointer border-b border-gray-100 last:border-0 transition-colors group"
                      >
                        <div className="mt-0.5 p-1.5 rounded-full bg-gray-100 shrink-0">
                          {notificationIcon(n.type)}
                        </div>
                        <div className="flex-1 min-w-0" onClick={() => handleNotificationClick(n)}>
                          <p className="text-sm font-medium text-gray-900 leading-tight">{n.title}</p>
                          <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{n.message}</p>
                          <p className="text-[10px] text-gray-400 mt-1">{timeAgo(n.timestamp)}</p>
                        </div>
                    <button
                      data-testid={`button-dismiss-${n.id}`}
                      onClick={(e) => { e.stopPropagation(); dismissNotification(n.id); }}
                      className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-gray-200 rounded shrink-0"
                      aria-label={`Dismiss notification: ${n.title}`}
                    >
                      <X className="h-3.5 w-3.5 text-gray-400" />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
          
          <button
            data-testid="button-profile-header"
            onClick={() => setLocation("/profile")}
            className="flex items-center gap-2 md:gap-3 pl-2 md:pl-4 border-l border-white/10 cursor-pointer hover:bg-white/5 rounded-lg py-1.5 px-2 transition-colors"
            aria-label={`Profile: ${displayName}`}
          >
            <div className="text-right hidden md:block">
              <p className="text-sm font-medium leading-none" data-testid="text-header-name">{displayName}</p>
              <p className="text-xs text-white/60 mt-1" data-testid="text-header-title">{displayTitle}</p>
            </div>
            <Avatar className="h-8 w-8 md:h-9 md:w-9 border border-white/20" data-testid="img-header-avatar">
              <AvatarImage src={user?.avatarUrl || undefined} />
              <AvatarFallback>{initials}</AvatarFallback>
            </Avatar>
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-auto p-4 pb-24 md:p-8 md:pb-24 max-w-7xl mx-auto w-full">
        {children}
      </main>
    </div>
  );
}
