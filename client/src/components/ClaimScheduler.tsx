import React, { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";

interface ClaimSchedulerProps {
  claimId: number;
  claimNumber: string;
  open: boolean;
  onClose: () => void;
  onScheduled: () => void;
}

const TIME_SLOTS = [
  "8:00-9:00",
  "9:00-10:00",
  "10:00-11:00",
  "11:00-12:00",
  "12:00-13:00",
  "13:00-14:00",
  "14:00-15:00",
  "15:00-16:00",
  "16:00-17:00",
];

const PRIORITIES = [
  { value: "critical", label: "Critical", color: "bg-red-500" },
  { value: "high", label: "High", color: "bg-orange-500" },
  { value: "normal", label: "Normal", color: "bg-blue-500" },
  { value: "low", label: "Low", color: "bg-gray-400" },
];

export default function ClaimScheduler({ claimId, claimNumber, open, onClose, onScheduled }: ClaimSchedulerProps) {
  const [date, setDate] = useState("");
  const [timeSlot, setTimeSlot] = useState("");
  const [priority, setPriority] = useState("normal");
  const [durationMin, setDurationMin] = useState(60);

  const scheduleMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/itinerary/schedule", {
        claimId,
        date,
        timeSlot,
        priority,
        estimatedDurationMin: durationMin,
      });
      return res.json();
    },
    onSuccess: () => {
      onScheduled();
      onClose();
    },
  });

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent data-testid="claim-scheduler-dialog">
        <DialogHeader>
          <DialogTitle data-testid="text-scheduler-title">Schedule {claimNumber}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="schedule-date">Date</Label>
            <input
              id="schedule-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              data-testid="input-schedule-date"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Time Slot</Label>
            <Select value={timeSlot} onValueChange={setTimeSlot}>
              <SelectTrigger data-testid="select-time-slot">
                <SelectValue placeholder="Select time slot" />
              </SelectTrigger>
              <SelectContent>
                {TIME_SLOTS.map((slot) => (
                  <SelectItem key={slot} value={slot} data-testid={`option-time-${slot}`}>
                    {slot}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Priority</Label>
            <div className="flex gap-2" data-testid="priority-selector">
              {PRIORITIES.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => setPriority(p.value)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-sm transition-colors ${
                    priority === p.value
                      ? "border-foreground bg-muted font-medium"
                      : "border-border hover:bg-muted/50"
                  }`}
                  data-testid={`button-priority-${p.value}`}
                >
                  <div className={`h-2.5 w-2.5 rounded-full ${p.color}`} />
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Duration: {durationMin} min</Label>
            <Slider
              value={[durationMin]}
              onValueChange={([v]) => setDurationMin(v)}
              min={30}
              max={240}
              step={30}
              data-testid="slider-duration"
            />
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span>30 min</span>
              <span>240 min</span>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} data-testid="button-scheduler-cancel">
            Cancel
          </Button>
          <Button
            onClick={() => scheduleMutation.mutate()}
            disabled={!date || !timeSlot || scheduleMutation.isPending}
            data-testid="button-scheduler-save"
          >
            {scheduleMutation.isPending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}