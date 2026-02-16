import { useState } from "react";
import Layout from "@/components/Layout";
import { Card } from "@/components/ui/card";
import { useQuery } from "@tanstack/react-query";
import { PenTool, MapPin, Loader2, Search, Layers } from "lucide-react";
import { Input } from "@/components/ui/input";
import PropertySketch from "@/components/PropertySketch";

interface SketchRoom {
  id: number;
  name: string;
  roomType: string | null;
  viewType: string | null;
  shapeType: string | null;
  dimensions: any;
  status: string;
  position: any;
}

interface SketchStructure {
  id: number;
  sessionId: number;
  name: string;
  structureType: string;
  rooms: SketchRoom[];
}

interface ClaimSketches {
  claimId: number;
  claimNumber: string;
  insuredName: string | null;
  propertyAddress: string | null;
  sessionId: number;
  structures: SketchStructure[];
}

export default function SketchGallery() {
  const [search, setSearch] = useState("");

  const { data: galleryData, isLoading } = useQuery<ClaimSketches[]>({
    queryKey: ["/api/gallery/sketches"],
    refetchInterval: 30000,
  });

  const filteredData = galleryData?.filter(claim => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      claim.claimNumber.toLowerCase().includes(q) ||
      (claim.insuredName || "").toLowerCase().includes(q) ||
      (claim.propertyAddress || "").toLowerCase().includes(q)
    );
  }) || [];

  const totalRooms = filteredData.reduce((sum, c) =>
    sum + c.structures.reduce((s, st) => s + st.rooms.length, 0), 0
  );

  return (
    <Layout title="Sketch Gallery">
      <div className="max-w-5xl mx-auto space-y-6">
        <div>
          <h2 className="text-2xl md:text-3xl font-display font-bold text-foreground flex items-center gap-3">
            <PenTool className="h-7 w-7 text-primary" />
            Sketch Gallery
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            All property sketches and floor plans across your claims.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              data-testid="input-sketch-search"
              placeholder="Search by claim number, name, or address..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10"
            />
          </div>
          <span className="text-sm text-muted-foreground whitespace-nowrap" data-testid="text-room-count">
            {totalRooms} room{totalRooms !== 1 ? "s" : ""}
          </span>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : filteredData.length === 0 ? (
          <Card className="p-12 flex flex-col items-center justify-center text-center">
            <PenTool className="h-12 w-12 text-muted-foreground/40 mb-4" />
            <h3 className="text-lg font-semibold text-muted-foreground">No Sketches Found</h3>
            <p className="text-sm text-muted-foreground/70 mt-1">
              {search ? "No sketches match your search." : "Sketches created during inspections will appear here."}
            </p>
          </Card>
        ) : (
          <div className="space-y-8">
            {filteredData.map((claim) => {
              const allRooms = claim.structures.flatMap(s =>
                s.rooms.map(r => ({
                  ...r,
                  structure: s.name,
                  damageCount: 0,
                  photoCount: 0,
                }))
              );

              return (
                <Card key={claim.claimId} className="overflow-hidden" data-testid={`claim-sketches-${claim.claimId}`}>
                  <div className="px-5 py-4 bg-muted/30 border-b border-border">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="font-semibold text-foreground" data-testid={`text-sketch-claim-${claim.claimId}`}>
                          Claim #{claim.claimNumber}
                        </h3>
                        {claim.insuredName && (
                          <p className="text-sm text-muted-foreground">{claim.insuredName}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-right">
                        {claim.propertyAddress && (
                          <p className="text-xs text-muted-foreground flex items-center gap-1">
                            <MapPin className="h-3 w-3" />
                            <span className="max-w-[200px] truncate">{claim.propertyAddress}</span>
                          </p>
                        )}
                        <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full font-medium flex items-center gap-1">
                          <Layers className="h-3 w-3" />
                          {claim.structures.length} structure{claim.structures.length !== 1 ? "s" : ""}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="p-4">
                    {allRooms.length > 0 ? (
                      <div className="bg-white rounded-lg border border-border overflow-hidden">
                        <PropertySketch
                          sessionId={claim.sessionId}
                          rooms={allRooms}
                          currentRoomId={null}
                          expanded
                        />
                      </div>
                    ) : (
                      <div className="text-center py-8 text-muted-foreground text-sm">
                        No rooms added yet
                      </div>
                    )}

                    <div className="mt-3 flex flex-wrap gap-2">
                      {claim.structures.map((struct) => (
                        <div
                          key={struct.id}
                          className="text-xs bg-muted rounded-full px-3 py-1 text-muted-foreground"
                          data-testid={`structure-badge-${struct.id}`}
                        >
                          {struct.name} · {struct.rooms.length} room{struct.rooms.length !== 1 ? "s" : ""}
                        </div>
                      ))}
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </Layout>
  );
}
