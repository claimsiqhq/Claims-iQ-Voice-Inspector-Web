import { useState } from "react";
import Layout from "@/components/Layout";
import { Card } from "@/components/ui/card";
import { useQuery } from "@tanstack/react-query";
import { Camera, MapPin, Loader2, Search, ImageOff } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";

interface GalleryPhoto {
  id: number;
  sessionId: number;
  roomId: number | null;
  storagePath: string | null;
  autoTag: string | null;
  caption: string | null;
  photoType: string | null;
  analysis: any;
  signedUrl: string | null;
  createdAt: string;
}

interface ClaimPhotos {
  claimId: number;
  claimNumber: string;
  policyholderName: string | null;
  propertyAddress: string | null;
  photos: GalleryPhoto[];
}

export default function PhotoGallery() {
  const { getAuthHeaders } = useAuth();
  const [search, setSearch] = useState("");
  const [selectedPhoto, setSelectedPhoto] = useState<GalleryPhoto | null>(null);

  const { data: galleryData, isLoading } = useQuery<ClaimPhotos[]>({
    queryKey: ["/api/gallery/photos"],
    queryFn: async () => {
      const headers = await getAuthHeaders();
      const res = await fetch("/api/gallery/photos", { headers });
      if (!res.ok) throw new Error("Failed to load photos");
      return res.json();
    },
    refetchInterval: 30000,
  });

  const filteredData = galleryData?.filter(claim => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      claim.claimNumber.toLowerCase().includes(q) ||
      (claim.policyholderName || "").toLowerCase().includes(q) ||
      (claim.propertyAddress || "").toLowerCase().includes(q)
    );
  }) || [];

  const totalPhotos = filteredData.reduce((sum, c) => sum + c.photos.length, 0);

  return (
    <Layout title="Photo Gallery">
      <div className="max-w-5xl mx-auto space-y-6">
        <div>
          <h2 className="text-2xl md:text-3xl font-display font-bold text-foreground flex items-center gap-3">
            <Camera className="h-7 w-7 text-primary" />
            Photo Gallery
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            All inspection photos across your claims.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              data-testid="input-photo-search"
              placeholder="Search by claim number, name, or address..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10"
            />
          </div>
          <span className="text-sm text-muted-foreground whitespace-nowrap" data-testid="text-photo-count">
            {totalPhotos} photo{totalPhotos !== 1 ? "s" : ""}
          </span>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : filteredData.length === 0 ? (
          <Card className="p-12 flex flex-col items-center justify-center text-center">
            <ImageOff className="h-12 w-12 text-muted-foreground/40 mb-4" />
            <h3 className="text-lg font-semibold text-muted-foreground">No Photos Found</h3>
            <p className="text-sm text-muted-foreground/70 mt-1">
              {search ? "No photos match your search." : "Photos taken during inspections will appear here."}
            </p>
          </Card>
        ) : (
          <div className="space-y-8">
            {filteredData.map((claim) => (
              <Card key={claim.claimId} className="overflow-hidden" data-testid={`claim-photos-${claim.claimId}`}>
                <div className="px-5 py-4 bg-muted/30 border-b border-border">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-semibold text-foreground" data-testid={`text-claim-number-${claim.claimId}`}>
                        Claim #{claim.claimNumber}
                      </h3>
                      {claim.policyholderName && (
                        <p className="text-sm text-muted-foreground">{claim.policyholderName}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-right">
                      {claim.propertyAddress && (
                        <p className="text-xs text-muted-foreground flex items-center gap-1">
                          <MapPin className="h-3 w-3" />
                          <span className="max-w-[200px] truncate">{claim.propertyAddress}</span>
                        </p>
                      )}
                      <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full font-medium">
                        {claim.photos.length} photo{claim.photos.length !== 1 ? "s" : ""}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="p-4">
                  <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-2">
                    {claim.photos.map((photo) => (
                      <button
                        key={photo.id}
                        onClick={() => setSelectedPhoto(photo)}
                        className="relative aspect-square rounded-lg overflow-hidden bg-muted group cursor-pointer border border-border hover:border-primary transition-colors"
                        data-testid={`photo-thumb-${photo.id}`}
                      >
                        {photo.signedUrl ? (
                          <img
                            src={photo.signedUrl}
                            alt={photo.caption || photo.autoTag || "Inspection photo"}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                            loading="lazy"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <Camera className="h-6 w-6 text-muted-foreground/30" />
                          </div>
                        )}
                        {photo.autoTag && (
                          <div className="absolute bottom-0 left-0 right-0 bg-black/60 px-1.5 py-0.5">
                            <span className="text-[9px] text-white truncate block">{photo.autoTag}</span>
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      {selectedPhoto && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          onClick={() => setSelectedPhoto(null)}
          data-testid="photo-lightbox"
        >
          <div
            className="relative max-w-4xl max-h-[90vh] w-full"
            onClick={(e) => e.stopPropagation()}
          >
            {selectedPhoto.signedUrl ? (
              <img
                src={selectedPhoto.signedUrl}
                alt={selectedPhoto.caption || "Photo"}
                className="w-full h-auto max-h-[80vh] object-contain rounded-lg"
                data-testid="photo-lightbox-image"
              />
            ) : (
              <div className="bg-muted rounded-lg p-20 flex items-center justify-center">
                <Camera className="h-16 w-16 text-muted-foreground/30" />
              </div>
            )}
            <div className="mt-3 bg-white/10 backdrop-blur-sm rounded-lg px-4 py-3">
              {selectedPhoto.caption && (
                <p className="text-white text-sm font-medium">{selectedPhoto.caption}</p>
              )}
              {selectedPhoto.autoTag && (
                <p className="text-white/70 text-xs mt-1">{selectedPhoto.autoTag}</p>
              )}
              {selectedPhoto.analysis && typeof selectedPhoto.analysis === 'object' && (
                <p className="text-white/60 text-xs mt-1">
                  {(selectedPhoto.analysis as any).summary || (selectedPhoto.analysis as any).description || ""}
                </p>
              )}
              <p className="text-white/40 text-[10px] mt-2">
                {selectedPhoto.createdAt ? new Date(selectedPhoto.createdAt).toLocaleString() : ""}
              </p>
            </div>
            <button
              onClick={() => setSelectedPhoto(null)}
              className="absolute top-2 right-2 bg-black/50 text-white rounded-full p-2 hover:bg-black/70 transition-colors"
              data-testid="close-lightbox"
            >
              ✕
            </button>
          </div>
        </div>
      )}
    </Layout>
  );
}
