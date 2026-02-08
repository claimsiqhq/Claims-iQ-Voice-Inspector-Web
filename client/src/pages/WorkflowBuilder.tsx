import { useState, useCallback } from "react";
import Layout from "@/components/Layout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Plus,
  Trash2,
  GripVertical,
  Copy,
  ChevronDown,
  ChevronUp,
  ArrowLeft,
  Save,
  Loader2,
  Workflow,
  Star,
  Lock,
  Pencil,
} from "lucide-react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";

// ── Types ─────────────────────────────────────────

interface InspectionStep {
  id: string;
  phaseName: string;
  agentPrompt: string;
  requiredTools: string[];
  completionCriteria: string;
}

interface InspectionFlow {
  id: number;
  userId: string | null;
  name: string;
  perilType: string;
  description: string | null;
  isDefault: boolean | null;
  isSystemDefault: boolean | null;
  steps: InspectionStep[];
  createdAt: string;
  updatedAt: string;
}

const PERIL_TYPES = ["Hail", "Wind", "Water", "Fire", "General"] as const;

const AVAILABLE_TOOLS = [
  "set_inspection_context",
  "create_structure",
  "get_inspection_state",
  "get_room_details",
  "create_room",
  "create_sub_area",
  "add_opening",
  "add_sketch_annotation",
  "complete_room",
  "add_damage",
  "add_line_item",
  "trigger_photo_capture",
  "log_moisture_reading",
  "get_progress",
  "get_estimate_summary",
  "skip_step",
  "apply_smart_macro",
  "check_related_items",
  "log_test_square",
  "complete_inspection",
];

const PERIL_COLORS: Record<string, string> = {
  Hail: "bg-blue-100 text-blue-800 border-blue-200",
  Wind: "bg-amber-100 text-amber-800 border-amber-200",
  Water: "bg-cyan-100 text-cyan-800 border-cyan-200",
  Fire: "bg-red-100 text-red-800 border-red-200",
  General: "bg-gray-100 text-gray-800 border-gray-200",
};

function generateStepId(): string {
  return `step_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ── Step Editor Component ─────────────────────────

function StepEditor({
  step,
  index,
  totalSteps,
  onUpdate,
  onDelete,
  onMoveUp,
  onMoveDown,
}: {
  step: InspectionStep;
  index: number;
  totalSteps: number;
  onUpdate: (updated: InspectionStep) => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border rounded-lg bg-card">
      {/* Collapsed header */}
      <div
        className="flex items-center gap-2 p-3 cursor-pointer hover:bg-muted/50 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <GripVertical className="h-4 w-4 text-muted-foreground flex-shrink-0" />
        <span className="text-xs font-bold text-muted-foreground w-8">
          #{index + 1}
        </span>
        <span className="font-medium flex-1 truncate">{step.phaseName || "Untitled Step"}</span>
        <div className="flex items-center gap-1 flex-shrink-0">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            disabled={index === 0}
            onClick={(e) => { e.stopPropagation(); onMoveUp(); }}
          >
            <ChevronUp className="h-3 w-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            disabled={index === totalSteps - 1}
            onClick={(e) => { e.stopPropagation(); onMoveDown(); }}
          >
            <ChevronDown className="h-3 w-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-destructive"
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
          >
            <Trash2 className="h-3 w-3" />
          </Button>
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </div>
      </div>

      {/* Expanded editor */}
      {expanded && (
        <div className="px-3 pb-3 space-y-3 border-t">
          <div className="pt-3">
            <Label className="text-xs">Phase Name</Label>
            <Input
              value={step.phaseName}
              onChange={(e) => onUpdate({ ...step, phaseName: e.target.value })}
              placeholder="e.g., Roof Overview, Source ID, Test Squares"
              className="mt-1"
            />
          </div>

          <div>
            <Label className="text-xs">Agent Prompt</Label>
            <textarea
              className="mt-1 w-full min-h-[80px] rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={step.agentPrompt}
              onChange={(e) => onUpdate({ ...step, agentPrompt: e.target.value })}
              placeholder="What should the agent say/look for during this phase..."
            />
          </div>

          <div>
            <Label className="text-xs">Required Tools</Label>
            <div className="mt-1 flex flex-wrap gap-1">
              {AVAILABLE_TOOLS.map((tool) => {
                const isSelected = step.requiredTools.includes(tool);
                return (
                  <button
                    key={tool}
                    className={`px-2 py-0.5 text-xs rounded-full border transition-colors ${
                      isSelected
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-muted text-muted-foreground border-border hover:bg-muted/80"
                    }`}
                    onClick={() => {
                      const tools = isSelected
                        ? step.requiredTools.filter((t) => t !== tool)
                        : [...step.requiredTools, tool];
                      onUpdate({ ...step, requiredTools: tools });
                    }}
                  >
                    {tool}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <Label className="text-xs">Completion Criteria</Label>
            <Input
              value={step.completionCriteria}
              onChange={(e) => onUpdate({ ...step, completionCriteria: e.target.value })}
              placeholder="e.g., At least 4 photos taken, All slopes documented"
              className="mt-1"
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ── Flow Editor Component ─────────────────────────

function FlowEditor({
  flow,
  onBack,
}: {
  flow: InspectionFlow;
  onBack: () => void;
}) {
  const { toast } = useToast();
  const [name, setName] = useState(flow.name);
  const [perilType, setPerilType] = useState(flow.perilType);
  const [description, setDescription] = useState(flow.description || "");
  const [isDefault, setIsDefault] = useState(flow.isDefault || false);
  const [steps, setSteps] = useState<InspectionStep[]>(flow.steps || []);

  const isSystem = flow.isSystemDefault;

  const updateMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("PUT", `/api/flows/${flow.id}`, {
        name,
        perilType,
        description,
        isDefault,
        steps,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/flows"] });
      toast({ title: "Flow saved", description: `"${name}" has been updated.` });
    },
    onError: (err: any) => {
      toast({ title: "Error saving flow", description: err.message, variant: "destructive" });
    },
  });

  const addStep = useCallback(() => {
    setSteps((prev) => [
      ...prev,
      {
        id: generateStepId(),
        phaseName: "",
        agentPrompt: "",
        requiredTools: [],
        completionCriteria: "",
      },
    ]);
  }, []);

  const updateStep = useCallback((index: number, updated: InspectionStep) => {
    setSteps((prev) => prev.map((s, i) => (i === index ? updated : s)));
  }, []);

  const deleteStep = useCallback((index: number) => {
    setSteps((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const moveStep = useCallback((from: number, to: number) => {
    setSteps((prev) => {
      const newSteps = [...prev];
      const [moved] = newSteps.splice(from, 1);
      newSteps.splice(to, 0, moved);
      return newSteps;
    });
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1">
          <h2 className="text-lg font-semibold">{isSystem ? "View System Flow" : "Edit Flow"}</h2>
          <p className="text-xs text-muted-foreground">
            {isSystem ? "System default flows are read-only. Clone to customize." : "Configure the inspection phases for this workflow."}
          </p>
        </div>
        {!isSystem && (
          <Button onClick={() => updateMutation.mutate()} disabled={updateMutation.isPending}>
            {updateMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
            Save
          </Button>
        )}
      </div>

      <Card className="p-4 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Flow Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} disabled={!!isSystem} className="mt-1" />
          </div>
          <div>
            <Label className="text-xs">Peril Type</Label>
            <Select value={perilType} onValueChange={setPerilType} disabled={!!isSystem}>
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PERIL_TYPES.map((p) => (
                  <SelectItem key={p} value={p}>{p}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div>
          <Label className="text-xs">Description</Label>
          <Input value={description} onChange={(e) => setDescription(e.target.value)} disabled={!!isSystem} className="mt-1" placeholder="Brief description of this inspection workflow..." />
        </div>
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="isDefault"
            checked={isDefault}
            onChange={(e) => setIsDefault(e.target.checked)}
            disabled={!!isSystem}
            className="h-4 w-4 rounded border-input"
          />
          <Label htmlFor="isDefault" className="text-xs">Default flow for this peril type</Label>
        </div>
      </Card>

      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-sm">
          Inspection Steps ({steps.length})
        </h3>
        {!isSystem && (
          <Button size="sm" variant="outline" onClick={addStep}>
            <Plus className="h-3 w-3 mr-1" /> Add Step
          </Button>
        )}
      </div>

      <div className="space-y-2">
        {steps.map((step, index) => (
          <StepEditor
            key={step.id}
            step={step}
            index={index}
            totalSteps={steps.length}
            onUpdate={(updated) => updateStep(index, updated)}
            onDelete={() => deleteStep(index)}
            onMoveUp={() => moveStep(index, index - 1)}
            onMoveDown={() => moveStep(index, index + 1)}
          />
        ))}
        {steps.length === 0 && (
          <div className="text-center py-8 text-muted-foreground text-sm">
            No steps defined. Click "Add Step" to build your inspection flow.
          </div>
        )}
      </div>
    </div>
  );
}

// ── Flow Card Component ───────────────────────────

function FlowCard({
  flow,
  onEdit,
  onClone,
  onDelete,
}: {
  flow: InspectionFlow;
  onEdit: () => void;
  onClone: () => void;
  onDelete: () => void;
}) {
  const colorClass = PERIL_COLORS[flow.perilType] || PERIL_COLORS.General;

  return (
    <Card className="p-3 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h4 className="font-medium text-sm truncate">{flow.name}</h4>
            {flow.isSystemDefault && <Lock className="h-3 w-3 text-muted-foreground flex-shrink-0" />}
            {flow.isDefault && <Star className="h-3 w-3 text-yellow-500 flex-shrink-0" />}
          </div>
          <div className="flex items-center gap-2 mt-1">
            <span className={`px-2 py-0.5 text-[10px] font-medium rounded-full border ${colorClass}`}>
              {flow.perilType}
            </span>
            <span className="text-[10px] text-muted-foreground">
              {flow.steps?.length || 0} steps
            </span>
          </div>
          {flow.description && (
            <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{flow.description}</p>
          )}
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onEdit}>
            <Pencil className="h-3 w-3" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClone}>
            <Copy className="h-3 w-3" />
          </Button>
          {!flow.isSystemDefault && (
            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={onDelete}>
              <Trash2 className="h-3 w-3" />
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}

// ── Main Page ─────────────────────────────────────

export default function WorkflowBuilder() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [editingFlow, setEditingFlow] = useState<InspectionFlow | null>(null);
  const [filterPeril, setFilterPeril] = useState<string>("all");
  const [deleteTarget, setDeleteTarget] = useState<InspectionFlow | null>(null);
  const [showNewFlow, setShowNewFlow] = useState(false);
  const [newFlowName, setNewFlowName] = useState("");
  const [newFlowPeril, setNewFlowPeril] = useState("General");

  const { data: flows = [], isLoading } = useQuery<InspectionFlow[]>({
    queryKey: ["/api/flows"],
  });

  const createMutation = useMutation({
    mutationFn: async (data: { name: string; perilType: string }) => {
      const res = await apiRequest("POST", "/api/flows", {
        name: data.name,
        perilType: data.perilType,
        description: "",
        steps: [],
      });
      return res.json();
    },
    onSuccess: (flow: InspectionFlow) => {
      queryClient.invalidateQueries({ queryKey: ["/api/flows"] });
      setShowNewFlow(false);
      setNewFlowName("");
      setEditingFlow(flow);
      toast({ title: "Flow created", description: `"${flow.name}" is ready to configure.` });
    },
    onError: (err: any) => {
      toast({ title: "Error creating flow", description: err.message, variant: "destructive" });
    },
  });

  const cloneMutation = useMutation({
    mutationFn: async (flow: InspectionFlow) => {
      const res = await apiRequest("POST", `/api/flows/${flow.id}/clone`, {
        name: `${flow.name} (Custom)`,
      });
      return res.json();
    },
    onSuccess: (flow: InspectionFlow) => {
      queryClient.invalidateQueries({ queryKey: ["/api/flows"] });
      setEditingFlow(flow);
      toast({ title: "Flow cloned", description: `Created "${flow.name}". You can now customize it.` });
    },
    onError: (err: any) => {
      toast({ title: "Error cloning flow", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/flows/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/flows"] });
      setDeleteTarget(null);
      toast({ title: "Flow deleted" });
    },
    onError: (err: any) => {
      toast({ title: "Error deleting flow", description: err.message, variant: "destructive" });
    },
  });

  const filteredFlows = filterPeril === "all"
    ? flows
    : flows.filter((f) => f.perilType === filterPeril);

  // Group flows by peril type
  const groupedFlows: Record<string, InspectionFlow[]> = {};
  for (const flow of filteredFlows) {
    const key = flow.perilType;
    if (!groupedFlows[key]) groupedFlows[key] = [];
    groupedFlows[key].push(flow);
  }

  if (editingFlow) {
    // Refresh from server data if available
    const freshFlow = flows.find((f) => f.id === editingFlow.id) || editingFlow;
    return (
      <Layout title="Workflow Builder">
        <div className="p-4 max-w-3xl mx-auto pb-24">
          <FlowEditor
            key={freshFlow.id}
            flow={freshFlow}
            onBack={() => {
              setEditingFlow(null);
              queryClient.invalidateQueries({ queryKey: ["/api/flows"] });
            }}
          />
        </div>
      </Layout>
    );
  }

  return (
    <Layout title="Workflow Builder">
      <div className="p-4 max-w-3xl mx-auto pb-24">
        {/* Header */}
        <div className="flex items-center gap-3 mb-4">
          <Button variant="ghost" size="icon" onClick={() => setLocation("/settings")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex-1">
            <h1 className="text-lg font-semibold flex items-center gap-2">
              <Workflow className="h-5 w-5" />
              Inspection Workflows
            </h1>
            <p className="text-xs text-muted-foreground">
              Create and customize inspection flows for different peril types.
            </p>
          </div>
          <Button size="sm" onClick={() => setShowNewFlow(true)}>
            <Plus className="h-3 w-3 mr-1" /> New Flow
          </Button>
        </div>

        {/* Filter */}
        <div className="flex items-center gap-2 mb-4">
          <Label className="text-xs text-muted-foreground">Filter:</Label>
          <div className="flex gap-1">
            <button
              className={`px-2 py-1 text-xs rounded-full border transition-colors ${filterPeril === "all" ? "bg-primary text-primary-foreground" : "bg-muted"}`}
              onClick={() => setFilterPeril("all")}
            >
              All
            </button>
            {PERIL_TYPES.map((p) => (
              <button
                key={p}
                className={`px-2 py-1 text-xs rounded-full border transition-colors ${filterPeril === p ? "bg-primary text-primary-foreground" : PERIL_COLORS[p]}`}
                onClick={() => setFilterPeril(p)}
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        {/* Flow list */}
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : Object.keys(groupedFlows).length === 0 ? (
          <div className="text-center py-12">
            <Workflow className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
            <p className="text-muted-foreground text-sm">
              {filterPeril === "all"
                ? "No inspection flows yet. Create one or seed default flows."
                : `No ${filterPeril} flows found.`}
            </p>
          </div>
        ) : (
          <div className="space-y-5">
            {Object.entries(groupedFlows).map(([peril, perilFlows]) => (
              <div key={peril}>
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                  {peril} Flows
                </h3>
                <div className="space-y-2">
                  {perilFlows.map((flow) => (
                    <FlowCard
                      key={flow.id}
                      flow={flow}
                      onEdit={() => setEditingFlow(flow)}
                      onClone={() => cloneMutation.mutate(flow)}
                      onDelete={() => setDeleteTarget(flow)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* New Flow Dialog */}
      <AlertDialog open={showNewFlow} onOpenChange={setShowNewFlow}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Create New Flow</AlertDialogTitle>
            <AlertDialogDescription>
              Start with a blank inspection workflow for a specific peril type.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label className="text-xs">Flow Name</Label>
              <Input
                value={newFlowName}
                onChange={(e) => setNewFlowName(e.target.value)}
                placeholder="e.g., My Custom Hail Flow"
                className="mt-1"
              />
            </div>
            <div>
              <Label className="text-xs">Peril Type</Label>
              <Select value={newFlowPeril} onValueChange={setNewFlowPeril}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PERIL_TYPES.map((p) => (
                    <SelectItem key={p} value={p}>{p}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={!newFlowName.trim() || createMutation.isPending}
              onClick={() => createMutation.mutate({ name: newFlowName.trim(), perilType: newFlowPeril })}
            >
              {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              Create
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Flow</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{deleteTarget?.name}"? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Layout>
  );
}
