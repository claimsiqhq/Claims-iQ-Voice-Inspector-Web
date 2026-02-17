import React, { useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import {
  ChevronLeft, ChevronRight, DollarSign,
  Edit3, Trash2, AlertTriangle, Zap, Link2,
} from "lucide-react";
import { cn } from "@/lib/utils";

export default function ScopePage({ params }: { params: { id: string } }) {
  const claimId = parseInt(params.id);
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

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

  const { data: estimateData } = useQuery({
    queryKey: [`/api/inspection/${sessionId}/estimate-grouped`],
    enabled: !!sessionId,
  });

  const { data: briefingData } = useQuery({
    queryKey: [`/api/claims/${claimId}/briefing`],
    enabled: !!claimId,
  });

  const estimate = estimateData as any;
  const briefing = briefingData as any;

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

  if (hasCriticalError) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6 gap-4" data-testid="scope-page">
        <p className="text-destructive font-medium">Failed to load claim or inspection data</p>
        <Button variant="outline" onClick={() => refetchCritical()}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col pb-20" data-testid="scope-page">
      <div className="h-14 bg-white border-b border-border flex items-center justify-between px-3 md:px-5 shrink-0">
        <div className="flex items-center gap-2 md:gap-3 min-w-0">
          <button onClick={() => setLocation(`/inspection/${claimId}`)} className="text-muted-foreground hover:text-foreground shrink-0" data-testid="button-back">
            <ChevronLeft size={20} />
          </button>
          <div className="min-w-0">
            <h1 className="font-display font-bold text-foreground text-sm md:text-base truncate" data-testid="text-scope-title">Scope - {claim?.claimNumber || `Claim #${claimId}`}</h1>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
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
      </div>

      <div className="h-auto md:h-16 bg-white border-t border-border flex flex-col sm:flex-row items-stretch sm:items-center justify-between px-3 md:px-5 py-2 sm:py-0 gap-2 sm:gap-0 shrink-0">
        <Button variant="outline" size="sm" className="text-xs md:text-sm" onClick={() => setLocation(`/inspection/${claimId}`)} data-testid="button-resume-inspection">
          <ChevronLeft size={14} className="mr-1" /> Resume Inspection
        </Button>
        <Button size="sm" className="bg-primary hover:bg-primary/90 text-primary-foreground text-xs md:text-sm" onClick={() => setLocation(`/inspection/${claimId}/review`)} data-testid="button-go-to-review">
          Go to Review <ChevronRight size={14} className="ml-1" />
        </Button>
      </div>
    </div>
  );
}
