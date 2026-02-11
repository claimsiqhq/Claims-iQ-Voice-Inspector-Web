import { useState, useRef, useCallback } from "react";
import Layout from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FileText, Shield, FileStack, CheckCircle2, Loader2, ArrowRight, AlertCircle } from "lucide-react";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Badge } from "@/components/ui/badge";

type UploadState = "empty" | "uploading" | "processing" | "complete" | "error";

const DOC_TYPES = ["fnol", "policy", "endorsements"] as const;

interface DocCardProps {
  title: string;
  description: string;
  icon: React.ElementType;
  color: string;
  state: UploadState;
  errorMsg?: string;
  onUpload: (file: File) => void;
  index: number;
  multiple?: boolean;
  onUploadMultiple?: (files: File[]) => void;
  fileCount?: number;
}

const DocCard = ({ title, description, icon: Icon, color, state, errorMsg, onUpload, index, multiple, onUploadMultiple, fileCount }: DocCardProps) => {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleClick = () => {
    if (state === "empty" || state === "error") {
      inputRef.current?.click();
    }
  };

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    if (multiple && onUploadMultiple && files.length > 0) {
      onUploadMultiple(Array.from(files));
    } else if (files[0]) {
      onUpload(files[0]);
    }
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.1 }}
    >
      <Card
        data-testid={`card-doc-${DOC_TYPES[index]}`}
        className={cn(
          "relative h-64 border-2 border-dashed flex flex-col items-center justify-center p-6 cursor-pointer transition-all hover:border-primary/50 group overflow-hidden bg-white",
          state === "complete" && "border-solid border-green-500/30 bg-green-50/10",
          state === "uploading" && "border-solid border-primary/30",
          state === "error" && "border-solid border-red-300 bg-red-50/10"
        )}
        onClick={handleClick}
      >
        <input ref={inputRef} type="file" accept=".pdf" className="hidden" onChange={handleFile} multiple={multiple} />

        {state === "empty" && (
          <div className="text-center space-y-4">
            <div className={cn("h-16 w-16 rounded-full flex items-center justify-center mx-auto mb-4", color)}>
              <Icon className="h-8 w-8 text-white" />
            </div>
            <h3 className="font-display font-semibold text-lg">{title}</h3>
            <p className="text-sm text-muted-foreground max-w-[200px] mx-auto">{description}</p>
            <div className="opacity-0 group-hover:opacity-100 transition-opacity absolute bottom-4 left-0 right-0 text-center text-xs text-primary font-medium">
              {multiple ? "Click to select PDF(s)" : "Click to upload PDF"}
            </div>
          </div>
        )}

        {state === "uploading" && (
          <div className="w-full max-w-xs text-center space-y-4">
            <Loader2 className="h-10 w-10 text-primary animate-spin mx-auto" />
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              <motion.div
                className="h-full bg-primary"
                initial={{ width: "0%" }}
                animate={{ width: "60%" }}
                transition={{ duration: 2 }}
              />
            </div>
            <p className="text-sm text-muted-foreground">
              {fileCount && fileCount > 1 ? `Uploading ${fileCount} documents...` : "Uploading document..."}
            </p>
          </div>
        )}

        {state === "processing" && (
          <div className="w-full max-w-xs text-center space-y-4">
            <div className="relative mx-auto h-16 w-16">
              <div className={cn("absolute inset-0 rounded-full opacity-20 animate-ping", color)}></div>
              <div className={cn("relative h-16 w-16 rounded-full flex items-center justify-center", color)}>
                <Icon className="h-8 w-8 text-white" />
              </div>
            </div>
            <p className="text-sm font-medium animate-pulse">AI Parsing in progress...</p>
            <p className="text-xs text-muted-foreground">
              {fileCount && fileCount > 1 ? `Extracting from ${fileCount} documents` : "Extracting key data points"}
            </p>
          </div>
        )}

        {state === "complete" && (
          <div className="text-center space-y-3">
            <div className="h-16 w-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-2">
              <CheckCircle2 className="h-8 w-8 text-green-600" />
            </div>
            <h3 className="font-display font-semibold text-lg text-green-900">Analysis Complete</h3>
            {fileCount && fileCount > 1 && (
              <Badge data-testid="text-endorsement-file-count" variant="outline" className="border-green-200 text-green-700">
                {fileCount} documents processed
              </Badge>
            )}
            <div className="bg-white/50 rounded-lg p-2 text-xs text-left w-full max-w-[200px] mx-auto border border-green-200/50 space-y-1">
              <div className="h-2 w-3/4 bg-green-200/50 rounded"></div>
              <div className="h-2 w-1/2 bg-green-200/50 rounded"></div>
              <div className="h-2 w-2/3 bg-green-200/50 rounded"></div>
            </div>
          </div>
        )}

        {state === "error" && (
          <div className="text-center space-y-3">
            <div className="h-16 w-16 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-2">
              <AlertCircle className="h-8 w-8 text-red-600" />
            </div>
            <h3 className="font-display font-semibold text-lg text-red-900">Error</h3>
            <p className="text-xs text-red-600 max-w-[200px] mx-auto">{errorMsg || "Upload failed. Click to retry."}</p>
          </div>
        )}
      </Card>
    </motion.div>
  );
};

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

export default function DocumentUpload({ params }: { params: { id: string } }) {
  const [, setLocation] = useLocation();
  const claimId = params.id;
  const [docStates, setDocStates] = useState<UploadState[]>(["empty", "empty", "empty"]);
  const [errors, setErrors] = useState<(string | undefined)[]>([undefined, undefined, undefined]);
  const [endorsementFileCount, setEndorsementFileCount] = useState(0);

  const { data: existingDocs } = useQuery<any[]>({
    queryKey: [`/api/claims/${claimId}/documents`],
  });

  const updateState = (index: number, state: UploadState, errorMsg?: string) => {
    setDocStates((prev) => {
      const next = [...prev];
      next[index] = state;
      return next;
    });
    if (errorMsg !== undefined) {
      setErrors((prev) => {
        const next = [...prev];
        next[index] = errorMsg;
        return next;
      });
    }
  };

  const getEffectiveState = (index: number): UploadState => {
    if (docStates[index] !== "empty") return docStates[index];
    if (existingDocs) {
      const doc = existingDocs.find((d: any) => d.documentType === DOC_TYPES[index]);
      if (doc?.status === "parsed") return "complete";
      if (doc?.status === "processing") return "processing";
      if (doc?.status === "uploaded") return "complete";
    }
    return "empty";
  };

  const handleUpload = useCallback(async (index: number, file: File) => {
    const docType = DOC_TYPES[index];
    updateState(index, "uploading");

    try {
      const fileBase64 = await readFileAsBase64(file);

      const uploadRes = await apiRequest("POST", `/api/claims/${claimId}/documents/upload`, {
        fileName: file.name,
        fileBase64,
        documentType: docType,
      });

      if (!uploadRes.ok) {
        const err = await uploadRes.json();
        throw new Error(err.message || "Upload failed");
      }

      updateState(index, "processing");

      const parseRes = await apiRequest("POST", `/api/claims/${claimId}/documents/${docType}/parse`);

      if (!parseRes.ok) {
        const err = await parseRes.json();
        throw new Error(err.message || "AI parsing failed");
      }

      updateState(index, "complete");
      queryClient.invalidateQueries({ queryKey: [`/api/claims/${claimId}/documents`] });
      queryClient.invalidateQueries({ queryKey: [`/api/claims/${claimId}/extractions`] });
    } catch (error: unknown) {
      updateState(index, "error", error.message);
    }
  }, [claimId]);

  const handleEndorsementBatch = useCallback(async (files: File[]) => {
    const index = 2;
    setEndorsementFileCount(files.length);
    updateState(index, "uploading");

    try {
      const filesData = await Promise.all(
        files.map(async (file) => ({
          fileName: file.name,
          fileBase64: await readFileAsBase64(file),
        }))
      );

      const uploadRes = await apiRequest("POST", `/api/claims/${claimId}/documents/upload-batch`, {
        files: filesData,
        documentType: "endorsements",
      });

      if (!uploadRes.ok) {
        const err = await uploadRes.json();
        throw new Error(err.message || "Batch upload failed");
      }

      updateState(index, "processing");

      const parseRes = await apiRequest("POST", `/api/claims/${claimId}/documents/endorsements/parse`);

      if (!parseRes.ok) {
        const err = await parseRes.json();
        throw new Error(err.message || "AI parsing failed");
      }

      updateState(index, "complete");
      queryClient.invalidateQueries({ queryKey: [`/api/claims/${claimId}/documents`] });
      queryClient.invalidateQueries({ queryKey: [`/api/claims/${claimId}/extractions`] });
    } catch (error: unknown) {
      updateState(index, "error", error.message);
    }
  }, [claimId]);

  const allComplete = [0, 1, 2].every((i) => getEffectiveState(i) === "complete");

  return (
    <Layout title="Document Upload" showBack>
      <div className="max-w-5xl mx-auto py-4 md:py-8 px-1 md:px-0">
        <div className="text-center mb-6 md:mb-10">
          <h2 className="text-2xl md:text-3xl font-display font-bold text-foreground mb-2 md:mb-3">Upload Claim Documents</h2>
          <p className="text-sm md:text-base text-muted-foreground max-w-xl mx-auto">
            Upload the three required documents below. Our AI agents will automatically extract policy limits, property details, and endorsement impacts.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6 mb-8 md:mb-12">
          <DocCard
            index={0}
            title="FNOL Report"
            description="First Notice of Loss / Claim Information Report with insured details and reported damage."
            icon={FileText}
            color="bg-primary"
            state={getEffectiveState(0)}
            errorMsg={errors[0]}
            onUpload={(file) => handleUpload(0, file)}
          />
          <DocCard
            index={1}
            title="Policy Form"
            description="HO policy form (e.g. HO 80 03) or declarations page with coverages."
            icon={Shield}
            color="bg-secondary"
            state={getEffectiveState(1)}
            errorMsg={errors[1]}
            onUpload={(file) => handleUpload(1, file)}
          />
          <DocCard
            index={2}
            title="Endorsements"
            description="Select one or more endorsement PDFs (e.g. HO 88 02, HO 81 06). All will be combined for extraction."
            icon={FileStack}
            color="bg-accent"
            state={getEffectiveState(2)}
            errorMsg={errors[2]}
            onUpload={(file) => handleEndorsementBatch([file])}
            multiple={true}
            onUploadMultiple={handleEndorsementBatch}
            fileCount={endorsementFileCount}
          />
        </div>

        <div className="flex justify-center px-4 md:px-0">
          <Button
            data-testid="button-review-extraction"
            size="lg"
            disabled={!allComplete}
            className="w-full sm:w-64 h-12 text-base md:text-lg shadow-xl shadow-primary/20"
            onClick={() => setLocation(`/review/${claimId}`)}
          >
            Review Extraction <ArrowRight className="ml-2 h-5 w-5" />
          </Button>
        </div>

        {allComplete && (
          <p className="text-center text-sm text-green-600 mt-4 animate-in fade-in slide-in-from-bottom-2">
            All documents parsed successfully. Ready for review.
          </p>
        )}
      </div>
    </Layout>
  );
}
