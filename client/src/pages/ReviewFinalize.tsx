import React, { useState, useEffect, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ChevronLeft, ChevronDown, ChevronRight, DollarSign,
  Camera, CheckCircle2, AlertTriangle, FileText,
  Edit3, Trash2, ImageIcon, AlertCircle, X,
  ChevronUp, MessageSquare, MapPin, Zap, Link2, Cloud,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { logger } from "@/lib/logger";
import WeatherCorrelation from "@/components/WeatherCorrelation";
import MoistureMap from "@/components/MoistureMap";
import PropertySketch from "@/components/PropertySketch";
import XactimateEstimateView from "@/components/XactimateEstimateView";

export default function ReviewFinalize({ params }: { params: { id: string } }) {
  const claimId = parseInt(params.id);
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

  // Fetch session data first
  const { data: claimData, isError: claimError, refetch: refetchClaim } = useQuery({
    queryKey: [`/api/claims/${claimId}`],
    enabled: !!claimId,
  });

  const claim = claimData as any;

  const { data: sessionData, isError: sessionError, refetch: refetchSession } = useQuery({
    queryKey: [`/api/claims/${claimId}/inspection/active`],
    enabled: !!claimId,
  });

  const sessionId = (sessionData as any)?.sessionId;
  const hasCriticalError = claimError || sessionError;
  const refetchCritical = () => { refetchClaim(); refetchSession(); };

  // Fetch data for all tabs
  const { data: estimateData } = useQuery({
    queryKey: [`/api/inspection/${sessionId}/estimate-grouped`],
    enabled: !!sessionId,
  });

  const { data: photosData } = useQuery({
    queryKey: [`/api/inspection/${sessionId}/photos-grouped`],
    enabled: !!sessionId,
  });

  const { data: completenessData } = useQuery({
    queryKey: [`/api/inspection/${sessionId}/completeness`],
    enabled: !!sessionId,
  });

  const { data: transcriptData } = useQuery({
    queryKey: [`/api/inspection/${sessionId}/transcript`],
    enabled: !!sessionId,
  });

  const { data: briefingData } = useQuery({
    queryKey: [`/api/claims/${claimId}/briefing`],
    enabled: !!claimId,
  });

  const { data: roomsData } = useQuery({
    queryKey: [`/api/inspection/${sessionId}/rooms`],
    enabled: !!sessionId,
  });

  const { data: estimateByRoomData } = useQuery({
    queryKey: [`/api/inspection/${sessionId}/estimate-by-room`],
    enabled: !!sessionId,
  });

  const estimate = estimateData as any;
  const photos = photosData as any;
  const completeness = completenessData as any;
  const transcriptEntries = (transcriptData || []) as any[];
  const briefing = briefingData as any;
  const rooms = (roomsData || []) as any[];
  const estimateByRoom = estimateByRoomData as any;

  if (hasCriticalError) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6 gap-4" data-testid="review-finalize-page">
        <p className="text-destructive font-medium">Failed to load claim or inspection data</p>
        <Button variant="outline" onClick={() => refetchCritical()}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col pb-20" data-testid="review-finalize-page">
      {/* Header */}
      <div className="h-14 bg-white border-b border-border flex items-center justify-between px-3 md:px-5 shrink-0">
        <div className="flex items-center gap-2 md:gap-3 min-w-0">
          <button onClick={() => setLocation(`/inspection/${claimId}`)} className="text-muted-foreground hover:text-foreground shrink-0">
            <ChevronLeft size={20} />
          </button>
          <div className="min-w-0">
            <h1 className="font-display font-bold text-foreground text-sm md:text-base truncate">Review & Finalize</h1>
            <p className="text-xs text-muted-foreground truncate">{claim?.claimNumber || `Claim #${claimId}`}</p>
          </div>
        </div>
        <Button
          size="sm"
          className="bg-primary hover:bg-primary/90 text-primary-foreground shrink-0"
          onClick={() => setLocation(`/inspection/${claimId}/export`)}
        >
          Export
          <ChevronRight size={14} className="ml-1" />
        </Button>
      </div>

      {/* Tabs */}
      <div className="flex-1 overflow-hidden">
        <Tabs defaultValue="estimate" className="h-full flex flex-col">
          <TabsList className="w-full justify-start rounded-none border-b bg-white px-2 md:px-5 h-11 shrink-0 gap-0">
            <TabsTrigger value="estimate" className="data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none text-xs md:text-sm px-2 md:px-4">
              <DollarSign size={14} className="mr-0 md:mr-1.5" /> <span className="hidden md:inline">Estimate</span>
            </TabsTrigger>
            <TabsTrigger value="photos" className="data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none text-xs md:text-sm px-2 md:px-4">
              <Camera size={14} className="mr-0 md:mr-1.5" /> <span className="hidden md:inline">Photos</span>
            </TabsTrigger>
            <TabsTrigger value="completeness" className="data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none text-xs md:text-sm px-2 md:px-4">
              <CheckCircle2 size={14} className="mr-0 md:mr-1.5" /> <span className="hidden md:inline">Completeness</span>
            </TabsTrigger>
            <TabsTrigger value="notes" className="data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none text-xs md:text-sm px-2 md:px-4">
              <FileText size={14} className="mr-0 md:mr-1.5" /> <span className="hidden md:inline">Notes</span>
            </TabsTrigger>
            <TabsTrigger value="sketch" className="data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none text-xs md:text-sm px-2 md:px-4">
              <MapPin size={14} className="mr-0 md:mr-1.5" /> <span className="hidden md:inline">Sketch</span>
            </TabsTrigger>
            <TabsTrigger value="weather" className="data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none text-xs md:text-sm px-2 md:px-4">
              <Cloud size={14} className="mr-0 md:mr-1.5" /> <span className="hidden md:inline">Weather</span>
            </TabsTrigger>
          </TabsList>

          {/* ESTIMATE TAB */}
          <TabsContent value="estimate" className="flex-1 overflow-y-auto mt-0 p-0">
            <EstimateTab estimate={estimate} sessionId={sessionId} briefing={briefing} queryClient={queryClient} />
          </TabsContent>

          {/* PHOTOS TAB */}
          <TabsContent value="photos" className="flex-1 overflow-y-auto mt-0 p-0">
            <PhotosTab photos={photos} completeness={completeness} sessionId={sessionId} claimId={claimId} />
          </TabsContent>

          {/* COMPLETENESS TAB */}
          <TabsContent value="completeness" className="flex-1 overflow-y-auto mt-0 p-0">
            <CompletenessTab completeness={completeness} claimId={claimId} setLocation={setLocation} />
          </TabsContent>

          {/* NOTES TAB */}
          <TabsContent value="notes" className="flex-1 overflow-y-auto mt-0 p-0">
            <NotesTab transcriptEntries={transcriptEntries} sessionId={sessionId} />
          </TabsContent>

          {/* SKETCH TAB */}
          <TabsContent value="sketch" className="flex-1 overflow-y-auto mt-0 p-0">
            <SketchTab rooms={rooms} sessionId={sessionId} estimateByRoom={estimateByRoom} claim={claim} />
          </TabsContent>

          <TabsContent value="weather" className="flex-1 overflow-y-auto mt-0 p-4">
            <WeatherCorrelation claimId={claimId} />
          </TabsContent>
        </Tabs>
      </div>

      {/* Bottom Action Bar */}
      <div className="h-auto md:h-16 bg-white border-t border-border flex flex-col sm:flex-row items-stretch sm:items-center justify-between px-3 md:px-5 py-2 sm:py-0 gap-2 sm:gap-0 shrink-0">
        <Button variant="outline" size="sm" className="text-xs md:text-sm" onClick={() => setLocation(`/inspection/${claimId}`)}>
          <ChevronLeft size={14} className="mr-1" /> Resume Inspection
        </Button>
        <Button size="sm" className="bg-primary hover:bg-primary/90 text-primary-foreground text-xs md:text-sm" onClick={() => setLocation(`/inspection/${claimId}/export`)}>
          Proceed to Export <ChevronRight size={14} className="ml-1" />
        </Button>
      </div>
    </div>
  );
}

// ─── ESTIMATE TAB ────────────────────────────────────────

function EstimateTab({ estimate, sessionId, briefing, queryClient }: any) {
  const [editingItem, setEditingItem] = useState<number | null>(null);
  const [editForm, setEditForm] = useState({ quantity: 0, unitPrice: 0, age: null as number | null, lifeExpectancy: null as number | null });
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);

  const { data: estimateByRoomData } = useQuery({
    queryKey: [`/api/inspection/${sessionId}/estimate-by-room`],
    enabled: !!sessionId,
  });

  const roomData = estimateByRoomData as any;
  const roomSections = roomData?.rooms || [];
  const grandTotal = roomData?.grandTotal || 0;
  const grandTax = roomData?.grandTax || 0;
  const grandDepreciation = roomData?.grandDepreciation || 0;
  const grandACV = roomData?.grandACV || 0;
  const totalLineItems = roomData?.totalLineItems || 0;

  const totalRCV = estimate?.totalRCV || grandTotal;
  const totalDepreciation = estimate?.totalDepreciation || grandDepreciation;
  const totalACV = estimate?.totalACV || grandACV;

  const coverageA = briefing?.coverageSnapshot?.coverageA || 0;
  const deductible = briefing?.coverageSnapshot?.deductible || 0;
  const netClaim = totalACV - deductible;
  const policyUtilization = coverageA > 0 ? (totalRCV / coverageA) * 100 : 0;

  const updateMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: number; updates: any }) => {
      const totalPrice = (updates.quantity || 1) * (updates.unitPrice || 0);
      const res = await apiRequest("PATCH", `/api/inspection/${sessionId}/line-items/${id}`, {
        ...updates,
        totalPrice,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/inspection/${sessionId}/estimate-grouped`] });
      queryClient.invalidateQueries({ queryKey: [`/api/inspection/${sessionId}/estimate-by-room`] });
      setEditingItem(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/inspection/${sessionId}/line-items/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/inspection/${sessionId}/estimate-grouped`] });
      queryClient.invalidateQueries({ queryKey: [`/api/inspection/${sessionId}/estimate-by-room`] });
      setDeleteConfirm(null);
    },
  });

  const startEdit = (item: any) => {
    setEditingItem(item.id);
    setEditForm({ quantity: item.quantity || 0, unitPrice: item.unitPrice || 0, age: item.age ?? null, lifeExpectancy: item.lifeExpectancy ?? null });
  };

  const fmt = (v: number) => v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  let runningLineNumber = 0;

  return (
    <div className="pb-4">
      <div className="px-2 md:px-4 py-3 space-y-6">
        {totalLineItems === 0 && (
          <div className="text-center py-12 text-muted-foreground">
            <DollarSign size={40} className="mx-auto mb-3 opacity-30" />
            <p className="text-sm" data-testid="text-no-line-items">No line items yet.</p>
          </div>
        )}

        {roomSections.filter((r: any) => r.items.length > 0).map((room: any) => (
          <div key={room.id} className="border border-border rounded-lg overflow-hidden" data-testid={`scope-room-${room.id}`}>
            <div className="bg-[#342A4F] px-4 py-2.5 flex items-center justify-between">
              <h3 className="text-sm font-display font-bold text-white">{room.name}</h3>
              {room.measurements && (
                <span className="text-[10px] text-white/50 font-mono hidden md:block">
                  {room.dimensions.length}' x {room.dimensions.width}' x {room.dimensions.height}'
                </span>
              )}
            </div>

            {room.measurements && (
              <div className="bg-[#342A4F]/5 border-b border-border px-4 py-1.5 text-[10px] text-muted-foreground font-mono flex flex-wrap gap-x-4 gap-y-0.5">
                <span>{room.measurements.sfWalls?.toFixed(2)} SF Walls</span>
                <span>{room.measurements.sfFloor?.toFixed(2)} SF Floor</span>
                <span>{room.measurements.lfFloorPerimeter?.toFixed(2)} LF Floor Perimeter</span>
                <span>{room.measurements.sfCeiling?.toFixed(2)} SF Ceiling</span>
              </div>
            )}

            <div className="hidden md:grid grid-cols-[auto_1fr_60px_40px_70px_60px_80px_80px_80px_32px] gap-0 bg-muted/60 border-b border-border text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
              <div className="px-3 py-2 w-8 text-center">#</div>
              <div className="px-2 py-2">Description</div>
              <div className="px-2 py-2 text-right">Qty</div>
              <div className="px-2 py-2 text-center">Unit</div>
              <div className="px-2 py-2 text-right">Price</div>
              <div className="px-2 py-2 text-right">Tax</div>
              <div className="px-2 py-2 text-right">RCV</div>
              <div className="px-2 py-2 text-right">Deprec.</div>
              <div className="px-2 py-2 text-right">ACV</div>
              <div className="px-2 py-2"></div>
            </div>

            {room.items.map((item: any) => {
              runningLineNumber++;
              const lineNum = runningLineNumber;
              return (
                <div key={item.id} data-testid={`scope-item-${item.id}`}>
                  {editingItem === item.id ? (
                    <div className="border-b border-border/30 px-4 py-3 bg-blue-50/50 space-y-2">
                      <p className="text-sm font-medium text-foreground">{item.description}</p>
                      <div className="flex flex-wrap gap-3">
                        <div>
                          <label className="text-[10px] uppercase text-muted-foreground">Quantity</label>
                          <input
                            type="number"
                            value={editForm.quantity}
                            onChange={(e) => setEditForm({ ...editForm, quantity: parseFloat(e.target.value) || 0 })}
                            className="w-24 border border-border rounded px-2 py-1 text-sm"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] uppercase text-muted-foreground">Unit Price</label>
                          <input
                            type="number"
                            step="0.01"
                            value={editForm.unitPrice}
                            onChange={(e) => setEditForm({ ...editForm, unitPrice: parseFloat(e.target.value) || 0 })}
                            className="w-28 border border-border rounded px-2 py-1 text-sm"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] uppercase text-muted-foreground">Age (yrs)</label>
                          <input
                            type="number"
                            step="0.5"
                            value={editForm.age ?? ""}
                            placeholder="—"
                            onChange={(e) => setEditForm({ ...editForm, age: e.target.value ? parseFloat(e.target.value) : null })}
                            className="w-20 border border-border rounded px-2 py-1 text-sm"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] uppercase text-muted-foreground">Life Exp. (yrs)</label>
                          <input
                            type="number"
                            step="1"
                            value={editForm.lifeExpectancy ?? ""}
                            placeholder="auto"
                            onChange={(e) => setEditForm({ ...editForm, lifeExpectancy: e.target.value ? parseFloat(e.target.value) : null })}
                            className="w-20 border border-border rounded px-2 py-1 text-sm"
                          />
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button size="sm" className="bg-primary text-primary-foreground text-xs"
                          onClick={() => updateMutation.mutate({ id: item.id, updates: {
                            quantity: editForm.quantity,
                            unitPrice: editForm.unitPrice,
                            totalPrice: Math.round(editForm.quantity * editForm.unitPrice * 100) / 100,
                            age: editForm.age,
                            lifeExpectancy: editForm.lifeExpectancy,
                          } })}
                          disabled={updateMutation.isPending}>
                          Save
                        </Button>
                        <Button size="sm" variant="outline" className="text-xs" onClick={() => setEditingItem(null)}>Cancel</Button>
                        <Button size="sm" variant="destructive" className="text-xs ml-auto" onClick={() => setDeleteConfirm(item.id)}>
                          <Trash2 size={12} className="mr-1" /> Delete
                        </Button>
                      </div>
                      {deleteConfirm === item.id && (
                        <div className="bg-destructive/10 border border-destructive/30 rounded p-2 flex items-center justify-between">
                          <span className="text-xs text-destructive">Confirm deletion?</span>
                          <div className="flex gap-1">
                            <Button size="sm" variant="destructive" className="text-xs h-6"
                              onClick={() => deleteMutation.mutate(item.id)} disabled={deleteMutation.isPending}>Yes, Delete</Button>
                            <Button size="sm" variant="ghost" className="text-xs h-6" onClick={() => setDeleteConfirm(null)}>No</Button>
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <>
                      <div className="hidden md:grid grid-cols-[auto_1fr_60px_40px_70px_60px_80px_80px_80px_32px] gap-0 border-b border-border/30 hover:bg-muted/20 transition-colors group">
                        <div className="px-3 py-2 w-8 text-center text-xs text-muted-foreground font-mono">{lineNum}.</div>
                        <div className="px-2 py-2 text-xs text-foreground min-w-0">
                          <span className="block truncate">{item.action ? `${item.action} ` : ""}{item.description}</span>
                          {item.provenance === "auto_scope" && (
                            <span className="inline-flex items-center gap-0.5 text-[9px] text-[#22C55E] font-medium"><Zap size={8} /> Auto</span>
                          )}
                          {item.provenance === "companion" && (
                            <span className="inline-flex items-center gap-0.5 text-[9px] text-[#9D8BBF] font-medium"><Link2 size={8} /> Companion</span>
                          )}
                        </div>
                        <div className="px-2 py-2 text-xs text-right font-mono">{fmt(item.quantity)}</div>
                        <div className="px-2 py-2 text-xs text-center text-muted-foreground">{item.unit}</div>
                        <div className="px-2 py-2 text-xs text-right font-mono">{fmt(item.unitPrice)}</div>
                        <div className="px-2 py-2 text-xs text-right font-mono text-muted-foreground">{fmt(item.taxAmount)}</div>
                        <div className="px-2 py-2 text-xs text-right font-mono font-semibold">{fmt(item.totalPrice)}</div>
                        <div className="px-2 py-2 text-xs text-right font-mono text-red-500/80" title={item.age != null ? `Age: ${item.age}yr / Life: ${item.lifeExpectancy ?? '?'}yr = ${item.depreciationPercentage?.toFixed(1) ?? 0}%` : ''}>({fmt(item.depreciationAmount)})</div>
                        <div className="px-2 py-2 text-xs text-right font-mono font-semibold">{fmt(item.acv)}</div>
                        <div className="px-1 py-2 flex items-center justify-center">
                          <button onClick={() => startEdit(item)} className="opacity-0 group-hover:opacity-70 hover:!opacity-100 transition-opacity text-muted-foreground hover:text-foreground">
                            <Edit3 size={13} />
                          </button>
                        </div>
                      </div>

                      <div className="md:hidden border-b border-border/30 px-3 py-2.5 active:bg-muted/20" onClick={() => startEdit(item)}>
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium text-foreground">
                              <span className="text-muted-foreground font-mono mr-1">{lineNum}.</span>
                              {item.action ? `${item.action} ` : ""}{item.description}
                            </p>
                            <div className="flex gap-2 mt-1 text-[10px] text-muted-foreground font-mono">
                              <span>{fmt(item.quantity)} {item.unit}</span>
                              <span>@ ${fmt(item.unitPrice)}</span>
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="text-xs font-mono font-semibold">${fmt(item.totalPrice)}</p>
                            {item.depreciationAmount > 0 && (
                              <p className="text-[10px] font-mono text-red-500/80">-{fmt(item.depreciationAmount)}</p>
                            )}
                          </div>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              );
            })}

            <div className="hidden md:grid grid-cols-[auto_1fr_60px_40px_70px_60px_80px_80px_80px_32px] gap-0 bg-muted/40 border-t border-border font-semibold">
              <div className="px-3 py-2 w-8"></div>
              <div className="px-2 py-2 text-xs text-foreground">Totals: {room.name}</div>
              <div className="px-2 py-2"></div>
              <div className="px-2 py-2"></div>
              <div className="px-2 py-2"></div>
              <div className="px-2 py-2 text-xs text-right font-mono">{fmt(room.totalTax || 0)}</div>
              <div className="px-2 py-2 text-xs text-right font-mono text-[#C6A54E]">{fmt(room.subtotal)}</div>
              <div className="px-2 py-2 text-xs text-right font-mono text-red-500/80">{fmt(room.totalDepreciation || 0)}</div>
              <div className="px-2 py-2 text-xs text-right font-mono text-[#C6A54E]">{fmt(room.totalACV || 0)}</div>
              <div className="px-2 py-2"></div>
            </div>

            <div className="md:hidden bg-muted/40 border-t border-border px-3 py-2 flex items-center justify-between">
              <span className="text-xs font-semibold text-foreground">Totals: {room.name}</span>
              <div className="text-right">
                <span className="text-xs font-mono font-bold text-[#C6A54E]">${fmt(room.subtotal)}</span>
                {(room.totalDepreciation || 0) > 0 && (
                  <span className="text-[10px] font-mono text-red-500/80 ml-2">-{fmt(room.totalDepreciation)}</span>
                )}
              </div>
            </div>
          </div>
        ))}

        {totalLineItems > 0 && (
          <div className="border border-[#C6A54E]/30 rounded-lg overflow-hidden bg-[#C6A54E]/5">
            <div className="hidden md:grid grid-cols-[auto_1fr_60px_40px_70px_60px_80px_80px_80px_32px] gap-0 font-bold">
              <div className="px-3 py-3 w-8"></div>
              <div className="px-2 py-3 text-sm text-foreground">Line Item Totals:</div>
              <div className="px-2 py-3"></div>
              <div className="px-2 py-3"></div>
              <div className="px-2 py-3"></div>
              <div className="px-2 py-3 text-xs text-right font-mono">{fmt(grandTax)}</div>
              <div className="px-2 py-3 text-sm text-right font-mono text-[#C6A54E]">{fmt(grandTotal)}</div>
              <div className="px-2 py-3 text-xs text-right font-mono text-red-500/80">{fmt(grandDepreciation)}</div>
              <div className="px-2 py-3 text-sm text-right font-mono text-[#C6A54E]">{fmt(grandACV)}</div>
              <div className="px-2 py-3"></div>
            </div>
            <div className="md:hidden px-3 py-3 flex items-center justify-between">
              <span className="text-sm font-bold text-foreground">Line Item Totals</span>
              <div className="text-right">
                <p className="text-sm font-mono font-bold text-[#C6A54E]">${fmt(grandTotal)}</p>
                <p className="text-[10px] font-mono text-muted-foreground">ACV: ${fmt(grandACV)}</p>
              </div>
            </div>
          </div>
        )}
      </div>

      {totalLineItems > 0 && (
        <div className="mx-2 md:mx-4 mt-2 bg-[#342A4F] rounded-xl p-4 md:p-5 text-white">
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-white/50">RCV Total</p>
              <p className="text-xl font-display font-bold text-[#C6A54E]">${fmt(totalRCV)}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-white/50">Depreciation</p>
              <p className="text-lg font-display font-semibold text-white/80">${fmt(totalDepreciation)}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-white/50">ACV Total</p>
              <p className="text-lg font-display font-semibold text-white/80">${fmt(totalACV)}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-white/50">Deductible</p>
              <p className="text-lg font-display font-semibold text-white/80">${fmt(deductible)}</p>
            </div>
          </div>

          <div className="border-t border-white/20 pt-3">
            <p className="text-[10px] uppercase tracking-wider text-white/50">Net Claim</p>
            <p className="text-2xl font-display font-bold text-[#C6A54E]">
              ${fmt(Math.max(0, netClaim))}
            </p>
          </div>

          {coverageA > 0 && (
            <div className="mt-3">
              <div className="flex justify-between text-[10px] text-white/40 mb-1">
                <span>Policy Limit (Coverage A)</span>
                <span>${coverageA.toLocaleString()}</span>
              </div>
              <div className="h-2 bg-white/10 rounded-full overflow-hidden">
                <div
                  className={cn(
                    "h-full rounded-full transition-all",
                    policyUtilization >= 80 ? "bg-[#C6A54E]" : "bg-[#7763B7]"
                  )}
                  style={{ width: `${Math.min(100, policyUtilization)}%` }}
                />
              </div>
              {policyUtilization >= 80 && (
                <div className="flex items-center gap-1 mt-1">
                  <AlertTriangle size={10} className="text-[#C6A54E]" />
                  <span className="text-[10px] text-[#C6A54E]">Claim exceeds 80% of policy limit</span>
                </div>
              )}
            </div>
          )}

          {estimate?.qualifiesForOP && (
            <div className="mt-3 border-t border-white/20 pt-3">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-[10px] uppercase tracking-wider text-white/50">
                  Overhead & Profit (3+ trades)
                </span>
                <span className="px-1.5 py-0.5 bg-green-500/20 text-green-300 rounded text-[9px] font-bold">
                  Eligible
                </span>
              </div>
              <div className="space-y-1">
                <div className="flex justify-between text-[10px]">
                  <span className="text-white/40">10% Overhead</span>
                  <span className="text-white/60 font-mono">${fmt(estimate?.overheadAmount || 0)}</span>
                </div>
                <div className="flex justify-between text-[10px]">
                  <span className="text-white/40">10% Profit</span>
                  <span className="text-white/60 font-mono">${fmt(estimate?.profitAmount || 0)}</span>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── PHOTOS TAB ──────────────────────────────────────────

function PhotosTab({ photos, completeness, sessionId, claimId }: any) {
  const [filter, setFilter] = useState("all");
  const [selectedPhoto, setSelectedPhoto] = useState<any>(null);

  const groups = photos?.groups || [];
  const missingPhotos = completeness?.missingPhotos || [];

  const photoTypes = ["all", "overview", "damage_detail", "test_square", "moisture", "pre_existing"];

  const filteredGroups = groups.map((group: any) => ({
    ...group,
    photos: filter === "all" ? group.photos : group.photos.filter((p: any) => p.photoType === filter),
  })).filter((group: any) => group.photos.length > 0);

  return (
    <div className="p-3 md:p-5 space-y-4">
      {/* Missing Photo Alerts */}
      {missingPhotos.length > 0 && (
        <div className="bg-[#F59E0B]/10 border border-[#F59E0B]/30 rounded-lg p-3 space-y-1">
          {missingPhotos.map((mp: any, i: number) => (
            <div key={i} className="flex items-center gap-2 text-sm">
              <AlertTriangle size={14} className="text-[#F59E0B] shrink-0" />
              <span className="text-[#342A4F]">Missing: <strong>{mp.room}</strong> {mp.issue}</span>
            </div>
          ))}
        </div>
      )}

      {/* Filter Bar */}
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {photoTypes.map((type) => (
          <button
            key={type}
            onClick={() => setFilter(type)}
            className={cn(
              "px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors",
              filter === type
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-muted/80"
            )}
          >
            {type === "all" ? "All" : type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
          </button>
        ))}
      </div>

      {/* Photo Grid by Room */}
      {filteredGroups.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          <Camera size={40} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">No photos{filter !== "all" ? " matching this filter" : " captured yet"}.</p>
        </div>
      )}

      {filteredGroups.map((group: any) => (
        <div key={group.roomName}>
          <div className="flex items-center gap-2 mb-2">
            <h3 className="font-display font-semibold text-sm text-foreground">{group.roomName}</h3>
            <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded-full text-muted-foreground">
              {group.photos.length}
            </span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {group.photos.map((photo: any) => (
              <button
                key={photo.id}
                onClick={() => setSelectedPhoto(photo)}
                className={cn(
                  "aspect-square bg-muted rounded-lg border overflow-hidden relative group hover:ring-2 hover:ring-primary transition-all",
                  photo.analysis?.damageVisible?.length > 0
                    ? "border-[#F59E0B]/40"
                    : "border-border"
                )}
              >
                {photo.signedUrl ? (
                  <img
                    src={photo.signedUrl}
                    alt={photo.caption || photo.autoTag || "Inspection photo"}
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-muted">
                    <ImageIcon size={24} className="text-muted-foreground/30" />
                  </div>
                )}
                {/* Photo Type Badge */}
                {photo.photoType && (
                  <span className="absolute top-1 right-1 text-[8px] bg-black/60 text-white px-1 py-0.5 rounded">
                    {photo.photoType.replace(/_/g, " ")}
                  </span>
                )}
                {/* AI Damage Detection Badge (PROMPT-19) */}
                {photo.analysis?.damageVisible?.length > 0 && (
                  <span className="absolute top-1 left-1 text-[8px] bg-[#F59E0B]/90 text-white px-1 py-0.5 rounded flex items-center gap-0.5">
                    <AlertTriangle size={7} />
                    {photo.analysis.damageVisible.length} damage{photo.analysis.damageVisible.length !== 1 ? "s" : ""}
                  </span>
                )}
                {/* Quality Score Indicator (PROMPT-19) */}
                {photo.analysis?.qualityScore && (
                  <span className={cn(
                    "absolute bottom-6 right-1 w-4 h-4 rounded-full flex items-center justify-center text-[7px] font-bold text-white",
                    photo.analysis.qualityScore >= 4 ? "bg-[#22C55E]" :
                    photo.analysis.qualityScore >= 3 ? "bg-[#F59E0B]" :
                    "bg-red-500"
                  )}>
                    {photo.analysis.qualityScore}
                  </span>
                )}
                {/* Auto Tag Overlay */}
                {photo.autoTag && (
                  <span className="absolute bottom-0 left-0 right-0 text-[9px] bg-black/60 text-white px-1.5 py-0.5 truncate">
                    {photo.autoTag}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      ))}

      {/* Photo Detail Overlay */}
      <AnimatePresence>
        {selectedPhoto && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-6"
            onClick={() => setSelectedPhoto(null)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white rounded-xl max-w-lg w-full p-5 space-y-3"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex justify-between items-start">
                <h3 className="font-display font-semibold text-foreground">{selectedPhoto.autoTag || "Photo"}</h3>
                <button onClick={() => setSelectedPhoto(null)}>
                  <X size={18} className="text-muted-foreground" />
                </button>
              </div>
              <div className="aspect-video bg-muted rounded-lg overflow-hidden">
                {selectedPhoto.signedUrl ? (
                  <img
                    src={selectedPhoto.signedUrl}
                    alt={selectedPhoto.caption || selectedPhoto.autoTag || "Photo"}
                    className="w-full h-full object-contain"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <ImageIcon size={48} className="text-muted-foreground/20" />
                  </div>
                )}
              </div>
              <div className="space-y-1.5 text-sm">
                {selectedPhoto.caption && <p><strong>Caption:</strong> {selectedPhoto.caption}</p>}
                {selectedPhoto.photoType && <p><strong>Type:</strong> {selectedPhoto.photoType.replace(/_/g, " ")}</p>}
                {selectedPhoto.analysis?.description && <p><strong>AI Analysis:</strong> {selectedPhoto.analysis.description}</p>}
                {selectedPhoto.createdAt && <p className="text-xs text-muted-foreground">Taken: {new Date(selectedPhoto.createdAt).toLocaleString()}</p>}
              </div>

              {/* Photo Analysis Detail (PROMPT-19) */}
              {selectedPhoto?.analysis && (
                <div className="space-y-3 mt-3">
                  <div className="bg-muted/30 rounded-lg p-3">
                    <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">AI Analysis</p>
                    <p className="text-sm text-foreground">{selectedPhoto.analysis.description}</p>
                    {selectedPhoto.analysis.qualityScore && (
                      <div className="flex items-center gap-2 mt-2">
                        <span className="text-[10px] text-muted-foreground">Quality:</span>
                        <div className="flex gap-0.5">
                          {[1, 2, 3, 4, 5].map((n) => (
                            <span
                              key={n}
                              className={cn(
                                "w-2 h-2 rounded-full",
                                n <= selectedPhoto.analysis.qualityScore ? "bg-[#22C55E]" : "bg-border"
                              )}
                            />
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {selectedPhoto.analysis.damageVisible?.length > 0 && (
                    <div>
                      <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Detected Damage</p>
                      <div className="space-y-1.5">
                        {selectedPhoto.analysis.damageVisible.map((damage: any, i: number) => (
                          <div key={i} className="flex items-center gap-2 p-2 bg-[#F59E0B]/5 rounded border border-[#F59E0B]/20">
                            <AlertTriangle size={12} className="text-[#F59E0B] shrink-0" />
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-medium text-foreground">{damage.type}</p>
                              <p className="text-[10px] text-muted-foreground">{damage.severity} — {damage.notes}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {selectedPhoto.analysis.matchesExpected === false && (
                    <div className="bg-red-500/5 border border-red-500/20 rounded-lg p-2.5">
                      <p className="text-xs text-red-500 font-medium">Photo may not match request</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">{selectedPhoto.analysis.matchExplanation}</p>
                    </div>
                  )}
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── COMPLETENESS TAB ────────────────────────────────────

function CompletenessTab({ completeness, claimId, setLocation }: any) {
  const score = completeness?.completenessScore || 0;
  const checklist = completeness?.checklist || [];
  const scopeGaps = completeness?.scopeGaps || [];
  const missingPhotos = completeness?.missingPhotos || [];
  const summary = completeness?.summary || {};

  const satisfiedCount = checklist.filter((c: any) => c.satisfied).length;

  const scoreColor = score >= 80 ? "#22C55E" : score >= 50 ? "#C6A54E" : "#EF4444";

  // SVG circle progress
  const radius = 60;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (score / 100) * circumference;

  // Sort checklist: unsatisfied first
  const sortedChecklist = [...checklist].sort((a: any, b: any) => {
    if (a.satisfied === b.satisfied) return 0;
    return a.satisfied ? 1 : -1;
  });

  return (
    <div className="p-5 space-y-6">
      {/* Score Circle */}
      <div className="flex flex-col items-center">
        <svg width="160" height="160" viewBox="0 0 160 160">
          <circle cx="80" cy="80" r={radius} fill="none" stroke="#E5E7EB" strokeWidth="8" />
          <circle
            cx="80" cy="80" r={radius}
            fill="none" stroke={scoreColor} strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            transform="rotate(-90 80 80)"
            style={{ transition: "stroke-dashoffset 0.6s ease-out" }}
          />
          <text x="80" y="75" textAnchor="middle" className="font-display" fontSize="32" fontWeight="700" fill={scoreColor}>
            {score}%
          </text>
          <text x="80" y="95" textAnchor="middle" fontSize="11" fill="#9CA3AF">
            Complete
          </text>
        </svg>
        <p className="text-sm text-muted-foreground mt-2">
          {satisfiedCount} of {checklist.length} items complete
        </p>
      </div>

      {/* Checklist */}
      <div className="space-y-2">
        {sortedChecklist.map((item: any, i: number) => (
          <div
            key={i}
            className={cn(
              "flex items-start gap-3 p-3 rounded-lg border",
              item.satisfied
                ? "border-border bg-card"
                : "border-l-4 border-l-destructive border-t border-r border-b border-border bg-destructive/5"
            )}
          >
            {item.satisfied ? (
              <CheckCircle2 size={18} className="text-[#22C55E] shrink-0 mt-0.5" />
            ) : (
              <AlertCircle size={18} className="text-destructive shrink-0 mt-0.5" />
            )}
            <div className="flex-1">
              <p className="text-sm text-foreground">{item.item}</p>
              {item.evidence && (
                <p className="text-xs text-muted-foreground mt-0.5">{item.evidence}</p>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Scope Gaps */}
      {scopeGaps.length > 0 && (
        <div>
          <h3 className="font-display font-semibold text-sm text-foreground flex items-center gap-2 mb-2 border-l-4 border-l-[#C6A54E] pl-3">
            <AlertTriangle size={14} className="text-[#C6A54E]" />
            AI-Detected Scope Gaps
          </h3>
          <div className="space-y-2">
            {scopeGaps.map((gap: any, i: number) => (
              <div key={i} className="border border-border rounded-lg p-3 bg-card">
                <p className="text-sm font-medium text-foreground">{gap.room}</p>
                <p className="text-xs text-muted-foreground">{gap.issue}</p>
                <div className="flex gap-2 mt-2">
                  <Button size="sm" variant="outline" className="text-xs h-7" onClick={() => setLocation(`/inspection/${claimId}`)}>
                    Add Line Item
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Missing Photos */}
      {missingPhotos.length > 0 && (
        <div>
          <h3 className="font-display font-semibold text-sm text-foreground flex items-center gap-2 mb-2 border-l-4 border-l-[#C6A54E] pl-3">
            <Camera size={14} className="text-[#C6A54E]" />
            Missing Photos
          </h3>
          <div className="space-y-2">
            {missingPhotos.map((mp: any, i: number) => (
              <div key={i} className="border border-border rounded-lg p-3 bg-card">
                <p className="text-sm font-medium text-foreground">{mp.room}</p>
                <p className="text-xs text-muted-foreground">{mp.issue}</p>
                <Button size="sm" variant="outline" className="text-xs h-7 mt-2" onClick={() => setLocation(`/inspection/${claimId}`)}>
                  Return to Capture
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Summary Stats */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-card border border-border rounded-lg p-3 text-center">
          <p className="text-lg font-display font-bold text-foreground">{summary.totalRooms || 0}</p>
          <p className="text-[10px] text-muted-foreground uppercase">Rooms</p>
        </div>
        <div className="bg-card border border-border rounded-lg p-3 text-center">
          <p className="text-lg font-display font-bold text-foreground">{summary.totalPhotos || 0}</p>
          <p className="text-[10px] text-muted-foreground uppercase">Photos</p>
        </div>
        <div className="bg-card border border-border rounded-lg p-3 text-center">
          <p className="text-lg font-display font-bold text-foreground">{summary.totalLineItems || 0}</p>
          <p className="text-[10px] text-muted-foreground uppercase">Line Items</p>
        </div>
      </div>
    </div>
  );
}

// ─── NOTES TAB ───────────────────────────────────────────

function NotesTab({ transcriptEntries, sessionId }: any) {
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!sessionId) return;
    apiRequest("GET", `/api/inspection/${sessionId}`)
      .then((data: any) => {
        if (data?.session?.adjusterNotes) setNotes(data.session.adjusterNotes);
      })
      .catch((e: unknown) => logger.error("Notes", "Failed to load adjuster notes", e));
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [sessionId]);

  const saveNotes = useCallback((value: string) => {
    if (!sessionId) return;
    setSaving(true);
    apiRequest("PATCH", `/api/inspection/${sessionId}`, { adjusterNotes: value })
      .then(() => setSaving(false))
      .catch((e: unknown) => { logger.error("Notes", "Failed to save adjuster notes", e); setSaving(false); });
  }, [sessionId]);

  const handleNotesChange = (value: string) => {
    setNotes(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => saveNotes(value), 800);
  };
  const [transcriptOpen, setTranscriptOpen] = useState(false);

  return (
    <div className="p-5 space-y-4">
      {/* Adjuster Notes */}
      <div>
        <h3 className="font-display font-semibold text-sm text-foreground mb-2">Adjuster Notes</h3>
        <textarea
          data-testid="input-adjuster-notes"
          value={notes}
          onChange={(e) => handleNotesChange(e.target.value)}
          rows={6}
          className="w-full border border-border rounded-lg px-3 py-2 text-sm resize-none focus:ring-2 focus:ring-primary focus:border-primary"
          placeholder="Add any final observations, special circumstances, or notes for the reviewer..."
        />
        <p className="text-[10px] text-muted-foreground mt-1">{saving ? "Saving..." : "Notes are auto-saved and included in the export."}</p>
      </div>

      {/* Voice Transcript */}
      <div className="border border-border rounded-lg overflow-hidden">
        <button
          onClick={() => setTranscriptOpen(!transcriptOpen)}
          className="w-full flex items-center justify-between px-4 py-3 bg-card hover:bg-muted/50 transition-colors"
        >
          <div className="flex items-center gap-2">
            <MessageSquare size={14} className="text-primary" />
            <span className="text-sm font-medium text-foreground">View Full Transcript</span>
            <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded-full text-muted-foreground">
              {transcriptEntries.length} entries
            </span>
          </div>
          {transcriptOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>

        <AnimatePresence>
          {transcriptOpen && (
            <motion.div initial={{ height: 0 }} animate={{ height: "auto" }} exit={{ height: 0 }} className="overflow-hidden">
              <div className="max-h-96 overflow-y-auto p-3 space-y-2 bg-muted/20">
                {transcriptEntries.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-4">No transcript entries yet.</p>
                )}
                {transcriptEntries.map((entry: any, i: number) => (
                  <div
                    key={i}
                    className={cn(
                      "max-w-[80%] rounded-lg px-3 py-2",
                      entry.speaker === "agent"
                        ? "bg-[#EDEAFF] border border-[#7763B7]/20 mr-auto"
                        : "bg-white border border-border ml-auto"
                    )}
                  >
                    <p className="text-[9px] uppercase tracking-wider text-muted-foreground mb-0.5">
                      {entry.speaker === "agent" ? "Claims IQ" : "Adjuster"}
                    </p>
                    <p className="text-sm text-foreground">{entry.content}</p>
                    {entry.timestamp && (
                      <p className="text-[9px] text-muted-foreground mt-1">
                        {new Date(entry.timestamp).toLocaleTimeString()}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

// ─── SKETCH TAB ─────────────────────────────────────────

function SketchTab({ rooms, sessionId, estimateByRoom, claim }: { rooms: any[]; sessionId: number | null; estimateByRoom: any; claim: any }) {
  return (
    <div className="p-3 md:p-5 space-y-4" data-testid="sketch-tab">
      <PropertySketch
        sessionId={sessionId}
        rooms={rooms.map((r: any) => ({
          id: r.id,
          name: r.name,
          status: r.status,
          damageCount: r.damageCount || 0,
          photoCount: r.photoCount || 0,
          roomType: r.roomType,
          dimensions: r.dimensions,
          structure: r.structure,
          viewType: r.viewType,
          shapeType: r.shapeType,
          parentRoomId: r.parentRoomId,
          attachmentType: r.attachmentType,
          facetLabel: r.facetLabel,
          pitch: r.pitch,
          floor: r.floor,
        }))}
        currentRoomId={null}
        expanded
      />

      <XactimateEstimateView
        data={estimateByRoom}
        claimNumber={claim?.claimNumber}
        insuredName={claim?.insuredName}
      />
    </div>
  );
}
