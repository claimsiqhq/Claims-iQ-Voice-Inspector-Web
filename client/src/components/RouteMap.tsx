import React, { useEffect, useRef, useState } from "react";
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Route, Navigation, MapPin } from "lucide-react";

delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png",
  iconUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png",
  shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
});

interface RouteMapClaim {
  id: number;
  claimNumber: string;
  insuredName: string | null;
  propertyAddress: string | null;
  city: string | null;
  state: string | null;
  priority: string | null;
  scheduledTimeSlot: string | null;
  latitude: number | null;
  longitude: number | null;
}

interface RouteMapProps {
  claims: RouteMapClaim[];
  onClaimClick?: (claimId: number) => void;
}

const priorityMarkerColors: Record<string, string> = {
  critical: "#ef4444",
  high: "#f97316",
  normal: "#3b82f6",
  low: "#9ca3af",
};

function createNumberedIcon(index: number, priority: string): L.DivIcon {
  const color = priorityMarkerColors[priority.toLowerCase()] || priorityMarkerColors.normal;
  return L.divIcon({
    className: "custom-numbered-marker",
    html: `<div style="
      background-color: ${color};
      color: white;
      border-radius: 50%;
      width: 28px;
      height: 28px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 12px;
      font-weight: 700;
      border: 2px solid white;
      box-shadow: 0 2px 6px rgba(0,0,0,0.3);
    ">${index + 1}</div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -14],
  });
}

function createUserLocationIcon(): L.DivIcon {
  return L.divIcon({
    className: "user-location-marker",
    html: `<div style="
      width: 16px;
      height: 16px;
      background-color: #3b82f6;
      border-radius: 50%;
      border: 3px solid white;
      box-shadow: 0 0 0 4px rgba(59, 130, 246, 0.3), 0 2px 6px rgba(0,0,0,0.3);
      animation: pulse-dot 2s infinite;
    "></div>
    <style>
      @keyframes pulse-dot {
        0% { box-shadow: 0 0 0 4px rgba(59, 130, 246, 0.3), 0 2px 6px rgba(0,0,0,0.3); }
        50% { box-shadow: 0 0 0 10px rgba(59, 130, 246, 0.1), 0 2px 6px rgba(0,0,0,0.3); }
        100% { box-shadow: 0 0 0 4px rgba(59, 130, 246, 0.3), 0 2px 6px rgba(0,0,0,0.3); }
      }
    </style>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });
}

function FitBounds({ positions }: { positions: L.LatLngExpression[] }) {
  const map = useMap();
  const fitted = useRef(false);

  useEffect(() => {
    if (positions.length > 0 && !fitted.current) {
      fitted.current = true;
      const bounds = L.latLngBounds(positions);
      map.fitBounds(bounds, { padding: [50, 50], maxZoom: 14 });
    }
  }, [positions, map]);

  return null;
}

export default function RouteMap({ claims, onClaimClick }: RouteMapProps) {
  const [userLocation, setUserLocation] = useState<[number, number] | null>(null);

  const optimizeMutation = useMutation({
    mutationFn: async () => {
      const today = new Date().toISOString().slice(0, 10);
      const res = await apiRequest("POST", "/api/itinerary/optimize", { date: today });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/myday/today"] });
    },
  });

  useEffect(() => {
    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => setUserLocation([pos.coords.latitude, pos.coords.longitude]),
        () => {},
        { enableHighAccuracy: false, timeout: 10000 }
      );
    }
  }, []);

  const geolocatedClaims = claims.filter(
    (c) => c.latitude != null && c.longitude != null
  );

  if (geolocatedClaims.length === 0) {
    return (
      <div
        data-testid="route-map-empty"
        className="flex flex-col items-center justify-center h-64 border-2 border-dashed rounded-lg text-muted-foreground gap-3"
      >
        <MapPin className="h-10 w-10 text-muted-foreground/40" />
        <p className="text-sm">No claims with coordinates to display on the map.</p>
      </div>
    );
  }

  const positions: [number, number][] = geolocatedClaims.map(
    (c) => [c.latitude!, c.longitude!] as [number, number]
  );

  const allPositions: L.LatLngExpression[] = [...positions];
  if (userLocation) allPositions.push(userLocation);

  const center = positions[0];

  return (
    <div data-testid="route-map-container" className="relative rounded-lg overflow-hidden border" style={{ height: 400 }}>
      <MapContainer
        center={center}
        zoom={12}
        style={{ height: "100%", width: "100%" }}
        scrollWheelZoom={true}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        <FitBounds positions={allPositions} />

        <Polyline
          positions={positions}
          pathOptions={{ color: "#3b82f6", weight: 3, opacity: 0.7, dashArray: "8 4" }}
        />

        {geolocatedClaims.map((claim, idx) => {
          const priority = (claim.priority || "normal").toLowerCase();
          const address = [claim.propertyAddress, claim.city, claim.state].filter(Boolean).join(", ");
          return (
            <Marker
              key={claim.id}
              position={[claim.latitude!, claim.longitude!]}
              icon={createNumberedIcon(idx, priority)}
              eventHandlers={{
                click: () => onClaimClick?.(claim.id),
              }}
            >
              <Popup>
                <div data-testid={`map-popup-${claim.id}`} className="min-w-[180px]">
                  <p className="font-semibold text-sm" data-testid={`map-popup-claim-number-${claim.id}`}>
                    {claim.claimNumber}
                  </p>
                  {claim.insuredName && (
                    <p className="text-xs text-gray-600" data-testid={`map-popup-insured-${claim.id}`}>
                      {claim.insuredName}
                    </p>
                  )}
                  {address && (
                    <p className="text-xs text-gray-500 mt-0.5" data-testid={`map-popup-address-${claim.id}`}>
                      {address}
                    </p>
                  )}
                  {claim.scheduledTimeSlot && (
                    <p className="text-xs text-gray-500 mt-0.5" data-testid={`map-popup-timeslot-${claim.id}`}>
                      🕐 {claim.scheduledTimeSlot}
                    </p>
                  )}
                  <a
                    href={`https://www.google.com/maps/dir/?api=1&destination=${claim.latitude},${claim.longitude}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    data-testid={`button-navigate-${claim.id}`}
                    className="inline-flex items-center gap-1 mt-2 text-xs font-medium text-blue-600 hover:text-blue-800"
                  >
                    <Navigation className="h-3 w-3" />
                    Navigate
                  </a>
                </div>
              </Popup>
            </Marker>
          );
        })}

        {userLocation && (
          <Marker position={userLocation} icon={createUserLocationIcon()}>
            <Popup>
              <span className="text-xs font-medium" data-testid="map-popup-user-location">Your Location</span>
            </Popup>
          </Marker>
        )}
      </MapContainer>

      <div className="absolute top-3 right-3 z-[1000]">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => optimizeMutation.mutate()}
          disabled={optimizeMutation.isPending}
          data-testid="button-optimize-route-map"
          className="shadow-md"
        >
          <Route className="h-4 w-4 mr-1.5" />
          {optimizeMutation.isPending ? "Optimizing…" : "Optimize"}
        </Button>
      </div>
    </div>
  );
}
