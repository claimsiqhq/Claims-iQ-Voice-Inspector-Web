import { Card } from "@/components/ui/card";
import { StatusBadge, PerilBadge } from "./StatusBadge";
import { Calendar, MapPin, ChevronRight, User } from "lucide-react";
import { Link } from "wouter";

interface ClaimCardProps {
  id: number;
  claimNumber: string;
  insuredName: string | null;
  address: string | null;
  peril: string | null;
  status: string;
  dateOfLoss: string | null;
}

export default function ClaimCard({
  id,
  claimNumber,
  insuredName,
  address,
  peril,
  status,
  dateOfLoss,
}: ClaimCardProps) {
  const getNextRoute = () => {
    const s = status.toLowerCase().replace(/\s+/g, "_");
    switch (s) {
      case "draft": return `/upload/${id}`;
      case "documents_uploaded": return `/review/${id}`;
      case "extractions_confirmed": return `/review/${id}`;
      case "briefing_ready": return `/briefing/${id}`;
      case "inspecting": return `/inspection/${id}`;
      default: return `/upload/${id}`;
    }
  };

  return (
    <Link href={getNextRoute()}>
      <Card
        data-testid={`card-claim-${id}`}
        className="hover:shadow-lg transition-all cursor-pointer border-border group h-full"
      >
        <div className="p-4 flex flex-col gap-3 h-full">
          <div className="flex items-center justify-between gap-2">
            <span
              data-testid={`text-claim-number-${id}`}
              className="font-mono text-sm font-semibold text-foreground/70 tracking-wide"
            >
              {claimNumber}
            </span>
            <StatusBadge status={status} />
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1.5">
              <User className="h-4 w-4 text-primary shrink-0" />
              <h3 className="font-display font-bold text-base text-foreground truncate group-hover:text-primary transition-colors">
                {insuredName || "Unknown Insured"}
              </h3>
            </div>

            <div className="flex items-start gap-2 text-sm text-muted-foreground">
              <MapPin className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span className="line-clamp-2 leading-snug">{address || "No address"}</span>
            </div>
          </div>

          <div className="flex items-center justify-between pt-3 border-t border-border/50">
            <div className="flex items-center gap-3">
              {peril && <PerilBadge peril={peril} />}
              {dateOfLoss && (
                <div className="flex items-center text-xs text-muted-foreground gap-1">
                  <Calendar className="h-3 w-3" />
                  <span>DOL {dateOfLoss}</span>
                </div>
              )}
            </div>
            <ChevronRight className="h-4 w-4 text-muted-foreground/40 group-hover:text-primary group-hover:translate-x-0.5 transition-all shrink-0" />
          </div>
        </div>
      </Card>
    </Link>
  );
}
