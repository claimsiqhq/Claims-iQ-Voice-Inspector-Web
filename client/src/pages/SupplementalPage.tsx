import React, { useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import {
  ChevronLeft, Plus, Loader2, Send,
} from "lucide-react";
import { motion } from "framer-motion";

export default function SupplementalPage({ params }: { params: { id: string } }) {
  const claimId = parseInt(params.id);
  const [, setLocation] = useLocation();
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({
    reason: "",
    newItems: [] as any[],
  });

  // Get session
  const { data: sessionData } = useQuery({
    queryKey: [`/api/claims/${claimId}/inspection/start`],
    queryFn: async () => {
      const res = await apiRequest("POST", `/api/claims/${claimId}/inspection/start`);
      return res.json();
    },
    enabled: !!claimId,
  });

  const sessionId = (sessionData as any)?.sessionId;

  // Get supplementals
  const { data: supplementals, refetch } = useQuery({
    queryKey: [`/api/inspection/${sessionId}/supplementals`],
    enabled: !!sessionId,
  });

  // Get original estimate
  const { data: estimateData } = useQuery({
    queryKey: [`/api/inspection/${sessionId}/estimate-grouped`],
    enabled: !!sessionId,
  });

  // Create supplemental
  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/inspection/${sessionId}/supplemental`, {
        reason: formData.reason,
        newLineItems: formData.newItems,
        removedLineItemIds: [],
        modifiedLineItems: [],
      });
      return res.json();
    },
    onSuccess: () => {
      refetch();
      setFormData({ reason: "", newItems: [] });
      setShowForm(false);
    },
  });

  // Submit supplemental
  const submitMutation = useMutation({
    mutationFn: async (supplementalId: number) => {
      const res = await apiRequest("POST", `/api/supplemental/${supplementalId}/submit`);
      return res.json();
    },
    onSuccess: () => {
      refetch();
    },
  });

  return (
    <div className="min-h-screen bg-background flex flex-col pb-20">
      {/* Header */}
      <div className="h-14 bg-white border-b border-border flex items-center px-3 md:px-5 shrink-0">
        <button onClick={() => setLocation(`/inspection/${claimId}/export`)} className="text-muted-foreground hover:text-foreground mr-2 md:mr-3 shrink-0">
          <ChevronLeft size={20} />
        </button>
        <div className="min-w-0">
          <h1 className="font-display font-bold text-foreground text-sm md:text-base">Supplemental Claims</h1>
          <p className="text-xs text-muted-foreground">Additional damage discovered</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 md:p-5 space-y-4 md:space-y-5 max-w-2xl mx-auto w-full">
        {/* Original Estimate Summary */}
        {estimateData && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="border border-border rounded-xl p-4 md:p-6 bg-card"
          >
            <h3 className="font-display font-bold text-lg mb-3">Original Estimate</h3>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <p><strong>Items:</strong> {(estimateData as any)?.lineItems?.length || 0}</p>
              <p><strong>Rooms:</strong> {(estimateData as any)?.rooms?.length || 0}</p>
              <p><strong>Total RCV:</strong> ${((estimateData as any)?.summary?.totalRCV || 0).toFixed(2)}</p>
              <p><strong>Total ACV:</strong> ${((estimateData as any)?.summary?.totalACV || 0).toFixed(2)}</p>
            </div>
          </motion.div>
        )}

        {/* Supplementals List */}
        {(supplementals as any)?.map((supplemental: any, idx: number) => (
          <motion.div
            key={supplemental.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.1 }}
            className="border border-border rounded-xl p-4 md:p-6 bg-card"
          >
            <div className="flex items-start justify-between mb-3">
              <div>
                <h4 className="font-display font-bold text-lg">{supplemental.reason}</h4>
                <p className="text-xs text-muted-foreground mt-1">
                  Created {new Date(supplemental.createdAt).toLocaleDateString()}
                </p>
              </div>
              <StatusBadge status={supplemental.status} />
            </div>

            {supplemental.newLineItems?.length > 0 && (
              <div className="mt-3 p-3 bg-muted/30 rounded">
                <p className="text-xs font-semibold text-muted-foreground uppercase mb-2">New Items: {supplemental.newLineItems.length}</p>
              </div>
            )}

            {supplemental.status === "draft" && (
              <div className="mt-4 flex gap-2">
                <Button
                  size="sm"
                  onClick={() => submitMutation.mutate(supplemental.id)}
                  disabled={submitMutation.isPending}
                >
                  {submitMutation.isPending ? <Loader2 size={14} className="mr-1 animate-spin" /> : <Send size={14} className="mr-1" />}
                  Submit
                </Button>
              </div>
            )}
          </motion.div>
        ))}

        {/* New Supplemental Form */}
        {!showForm && (
          <motion.button
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            onClick={() => setShowForm(true)}
            className="w-full p-4 md:p-6 border-2 border-dashed border-border rounded-xl hover:bg-muted/30 transition"
          >
            <Plus size={20} className="mx-auto mb-2 text-muted-foreground" />
            <p className="text-sm font-semibold text-foreground">Create Supplemental Claim</p>
            <p className="text-xs text-muted-foreground mt-1">Add new items for additional damage discovered</p>
          </motion.button>
        )}

        {showForm && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="border border-border rounded-xl p-4 md:p-6 bg-card"
          >
            <h4 className="font-display font-bold text-lg mb-4">New Supplemental Claim</h4>

            <div className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase">Reason</label>
                <textarea
                  value={formData.reason}
                  onChange={(e) => setFormData({ ...formData, reason: e.target.value })}
                  placeholder="What additional damage was discovered?"
                  className="w-full mt-2 p-2 border border-border rounded text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  rows={3}
                />
              </div>

              <div className="flex gap-2">
                <Button
                  onClick={() => createMutation.mutate()}
                  disabled={createMutation.isPending || !formData.reason.trim()}
                  className="flex-1"
                >
                  {createMutation.isPending ? <Loader2 size={14} className="mr-1 animate-spin" /> : <Plus size={14} className="mr-1" />}
                  Create
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowForm(false);
                    setFormData({ reason: "", newItems: [] });
                  }}
                  className="flex-1"
                >
                  Cancel
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </div>

      {/* Bottom Link */}
      <div className="h-12 bg-white border-t border-border flex items-center justify-center shrink-0">
        <button
          onClick={() => setLocation(`/inspection/${claimId}/export`)}
          className="text-sm text-primary hover:underline"
        >
          &larr; Back to Export
        </button>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { label: string; color: string }> = {
    draft: { label: "Draft", color: "bg-gray-100 text-gray-900" },
    submitted: { label: "Submitted", color: "bg-blue-100 text-blue-900" },
    approved: { label: "Approved", color: "bg-green-100 text-green-900" },
  };

  const c = config[status] || config.draft;

  return (
    <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${c.color}`}>
      {c.label}
    </span>
  );
}
