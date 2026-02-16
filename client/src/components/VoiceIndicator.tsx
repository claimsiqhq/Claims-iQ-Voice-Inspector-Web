import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { WifiOff, AlertTriangle } from "lucide-react";

interface VoiceIndicatorProps {
  status: "idle" | "listening" | "processing" | "speaking" | "error" | "disconnected";
  className?: string;
}

export default function VoiceIndicator({ status, className }: VoiceIndicatorProps) {
  if (status === "disconnected") {
    return (
      <div className={cn("flex items-center justify-center gap-2 h-12", className)}>
        <WifiOff className="h-5 w-5 text-destructive animate-pulse" />
        <span className="text-sm text-destructive font-medium">Disconnected</span>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className={cn("flex items-center justify-center gap-2 h-12", className)}>
        <AlertTriangle className="h-5 w-5 text-[#C6A54E] animate-pulse" />
        <span className="text-sm text-[#C6A54E] font-medium">Error — Retrying</span>
      </div>
    );
  }

  const barColor =
    status === "listening" ? "bg-[#7763B7]" :
    status === "speaking" ? "bg-[#C6A54E]" :
    status === "processing" ? "bg-[#9D8BBF]" :
    "bg-muted-foreground/30";

  return (
    <div className={cn("flex items-center justify-center gap-1 h-12", className)}>
      {[1, 2, 3, 4, 5].map((i) => (
        <motion.div
          key={i}
          className={cn("w-1.5 rounded-full", barColor)}
          initial={{ height: 8 }}
          animate={{
            height: status === "idle" ? 8 : [8, 28, 8],
            opacity: status === "idle" ? 0.4 : 1,
          }}
          transition={{
            duration: status === "idle" ? 0 : 0.7,
            repeat: Infinity,
            delay: i * 0.08,
            ease: "easeInOut",
          }}
        />
      ))}
    </div>
  );
}
