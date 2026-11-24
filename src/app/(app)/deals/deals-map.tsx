"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MarkerClusterer } from "@googlemaps/markerclusterer";
import {
  APIProvider,
  InfoWindow,
  Map as GoogleMap,
  useMap,
} from "@vis.gl/react-google-maps";
import { MapPinOff, MapPinned } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { TractDemographicsRow } from "@/lib/geo/acs";
import { partitionDealsForMap, type MappedDeal } from "@/lib/geo/map-helpers";
import { dealStages, type Deal, type VerticalConfig } from "@/lib/deals";
import { fmtOrDash } from "@/lib/format";
import { STAGE_STYLES, stageStyleFor } from "@/lib/stage-colors";
import { DealHoverCard } from "./deal-hover-card";

const US_CENTER = { lat: 39.5, lng: -98.35 };

function pinSvgDataUrl(fillHex: string, borderHex: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="36" viewBox="0 0 28 36"><path d="M14 1C6.8 1 1 6.8 1 14c0 9.8 13 21 13 21s13-11.2 13-21C27 6.8 21.2 1 14 1z" fill="${fillHex}" stroke="${borderHex}" stroke-width="2"/><circle cx="14" cy="13.5" r="4.5" fill="#ffffff"/></svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function ClusteredDealMarkers({
  deals,
  activeDeal,
  onHoverDeal,
  onSelectDeal,
}: {
  deals: MappedDeal[];
  activeDeal: MappedDeal | null;
  onHoverDeal: (deal: MappedDeal | null) => void;
  onSelectDeal: (deal: Deal) => void;
}) {
  const map = useMap();
  const clustererRef = useRef<MarkerClusterer | null>(null);
  const activeDealIdRef = useRef<string | null>(null);

  useEffect(() => {
    activeDealIdRef.current = activeDeal?.id ?? null;
  }, [activeDeal]);

  useEffect(() => {
    if (!map || typeof google === "undefined" || !google.maps) return;

    const isTouchDevice =
      typeof window !== "undefined" &&
      window.matchMedia("(pointer: coarse)").matches;

    const markers = deals.map((deal) => {
      const style = stageStyleFor(deal.stage);
      const marker = new google.maps.Marker({
        position: { lat: deal.lat, lng: deal.lng },
        title: deal.address ?? deal.id,
        icon: {
          url: pinSvgDataUrl(style.pinHex, style.pinBorderHex),
          scaledSize: new google.maps.Size(28, 36),
          anchor: new google.maps.Point(14, 35),
        },
      });

      marker.addListener("mouseover", () => {
        onHoverDeal(deal);
      });

      marker.addListener("click", () => {
        if (isTouchDevice && activeDealIdRef.current !== deal.id) {
          onHoverDeal(deal);
          return;
        }
        onSelectDeal(deal);
      });

      return marker;
    });

    const clusterer = new MarkerClusterer({ map, markers });
    clustererRef.current = clusterer;

    if (deals.length === 1) {
      map.setCenter({ lat: deals[0].lat, lng: deals[0].lng });
      map.setZoom(14);
    } else if (deals.length > 1) {
      const bounds = new google.maps.LatLngBounds();
      for (const deal of deals) {
        bounds.extend({ lat: deal.lat, lng: deal.lng });
      }
      map.fitBounds(bounds, 56);
    } else {
      map.setCenter(US_CENTER);
      map.setZoom(4);
    }

    return () => {
      clusterer.clearMarkers();
      for (const marker of markers) {
        google.maps.event.clearInstanceListeners(marker);
        marker.setMap(null);
      }
      clustererRef.current = null;
    };
  }, [deals, map, onHoverDeal, onSelectDeal]);

  return null;
}

export function DealsMap({
  deals,
  configsByVertical,
  tractDemographics,
  onSelectDeal,
  mapsApiKey,
}: {
  deals: Deal[];
  configsByVertical: Map<string, VerticalConfig>;
  tractDemographics: Record<string, TractDemographicsRow>;
  onSelectDeal: (deal: Deal) => void;
  mapsApiKey?: string;
}) {
  const apiKey = (
    mapsApiKey !== undefined
      ? mapsApiKey
      : (process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY ?? "")
  ).trim();

  const { mapped, unmapped } = useMemo(() => partitionDealsForMap(deals), [deals]);
  const [hoveredDeal, setHoveredDeal] = useState<MappedDeal | null>(null);
  const [fallbackFocusedId, setFallbackFocusedId] = useState<string | null>(null);

  const activeHovered = useMemo(() => {
    if (!hoveredDeal) return null;
    return mapped.find((item) => item.id === hoveredDeal.id) ?? null;
  }, [hoveredDeal, mapped]);

  const fallbackSelected = useMemo(() => {
    if (!mapped.length) return null;
    return mapped.find((item) => item.id === fallbackFocusedId) ?? mapped[0];
  }, [fallbackFocusedId, mapped]);

  return (
    <div className="grid gap-4 p-4 lg:grid-cols-[1fr_320px]">
      <div className="space-y-3">
        {apiKey ? (
          <div className="h-[calc(100vh-370px)] min-h-[480px] overflow-hidden rounded-lg border border-slate-200">
            <APIProvider apiKey={apiKey}>
              <GoogleMap
                defaultCenter={US_CENTER}
                defaultZoom={4}
                gestureHandling="greedy"
                mapTypeControl={false}
                onClick={() => setHoveredDeal(null)}
                streetViewControl={false}
              >
                <ClusteredDealMarkers
                  activeDeal={activeHovered}
                  deals={mapped}
                  onHoverDeal={setHoveredDeal}
                  onSelectDeal={onSelectDeal}
                />
                {activeHovered ? (
                  <InfoWindow
                    onCloseClick={() => setHoveredDeal(null)}
                    pixelOffset={[0, -34]}
                    position={{ lat: activeHovered.lat, lng: activeHovered.lng }}
                  >
                    <DealHoverCard
                      config={
                        activeHovered.vertical
                          ? configsByVertical.get(activeHovered.vertical)
                          : undefined
                      }
                      deal={activeHovered}
                      demographics={
                        activeHovered.census_tract_geoid
                          ? tractDemographics[activeHovered.census_tract_geoid]
                          : null
                      }
                      onSelectDeal={onSelectDeal}
                    />
                  </InfoWindow>
                ) : null}
              </GoogleMap>
            </APIProvider>
          </div>
        ) : (
          <div className="space-y-4 rounded-lg border border-dashed border-slate-300 bg-slate-50/70 p-5">
            <div className="flex items-start gap-3">
              <MapPinned className="mt-0.5 size-5 shrink-0 text-slate-500" />
              <div className="space-y-1">
                <p className="text-sm font-semibold text-slate-900">
                  Google Map preview unavailable (missing API key)
                </p>
                <p className="text-xs text-slate-600">
                  Set <code className="rounded bg-slate-200/70 px-1 py-0.5">NEXT_PUBLIC_GOOGLE_MAPS_KEY</code>{" "}
                  (with HTTP referrer restrictions and Google Cloud billing enabled) to render interactive pins. Geocoded sites and Census tract demographics remain inspectable below.
                </p>
              </div>
            </div>

            {mapped.length > 0 ? (
              <div className="grid gap-4 xl:grid-cols-[1fr_330px]">
                <div className="max-h-[400px] space-y-2 overflow-y-auto pr-1">
                  {mapped.map((deal) => {
                    const style = stageStyleFor(deal.stage);
                    const selected = fallbackSelected?.id === deal.id;
                    return (
                      <button
                        className={`flex w-full items-center justify-between gap-2 rounded-md border bg-white p-3 text-left text-xs transition hover:border-slate-400 ${
                          selected ? "border-slate-900 ring-1 ring-slate-900/10" : "border-slate-200"
                        }`}
                        key={deal.id}
                        onClick={() => onSelectDeal(deal)}
                        onFocus={() => setFallbackFocusedId(deal.id)}
                        onMouseEnter={() => setFallbackFocusedId(deal.id)}
                        type="button"
                      >
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-slate-900">
                            {fmtOrDash(deal.address)}
                          </p>
                          <p className="truncate text-[11px] text-slate-500">
                            {[deal.city, deal.state].filter(Boolean).join(", ")} ·{" "}
                            {fmtOrDash(deal.vertical)} ·{" "}
                            <span className="font-mono">
                              {deal.lat.toFixed(4)}, {deal.lng.toFixed(4)}
                            </span>
                          </p>
                        </div>
                        <Badge className={`shrink-0 ${style.badgeClass}`}>
                          {deal.stage}
                        </Badge>
                      </button>
                    );
                  })}
                </div>
                {fallbackSelected ? (
                  <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-xs">
                    <DealHoverCard
                      config={
                        fallbackSelected.vertical
                          ? configsByVertical.get(fallbackSelected.vertical)
                          : undefined
                      }
                      deal={fallbackSelected}
                      demographics={
                        fallbackSelected.census_tract_geoid
                          ? tractDemographics[fallbackSelected.census_tract_geoid]
                          : null
                      }
                      onSelectDeal={onSelectDeal}
                    />
                  </div>
                ) : null}
              </div>
            ) : (
              <p className="text-xs text-slate-500">
                No geocoded deals match the current filters. Run &ldquo;Geocode missing&rdquo; in Admin → Data health to geocode deals with addresses.
              </p>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-[11px] text-slate-600">
          <span className="font-semibold text-slate-700">
            Stage legend ({mapped.length} on map):
          </span>
          {dealStages.map((stage) => (
            <span className="inline-flex items-center gap-1.5" key={stage}>
              <span
                className="size-2.5 rounded-full border border-black/15"
                style={{ backgroundColor: STAGE_STYLES[stage].pinHex }}
              />
              <span>{stage}</span>
            </span>
          ))}
        </div>
      </div>

      <aside className="flex max-h-[calc(100vh-330px)] min-h-[320px] flex-col rounded-lg border border-slate-200 bg-slate-50/50">
        <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2.5">
          <h3 className="flex items-center gap-1.5 text-xs font-semibold text-slate-800">
            <MapPinOff className="size-3.5 text-slate-500" />
            Not on map ({unmapped.length})
          </h3>
        </div>
        <div className="flex-1 space-y-2 overflow-y-auto p-3">
          {unmapped.length > 0 ? (
            unmapped.map(({ deal, reason }) => (
              <button
                className="block w-full rounded-md border border-slate-200 bg-white p-2.5 text-left text-xs transition hover:border-slate-400"
                key={deal.id}
                onClick={() => onSelectDeal(deal)}
                type="button"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="truncate font-medium text-slate-900">
                    {deal.address?.trim() ? deal.address : deal.id}
                  </p>
                  <Badge className="shrink-0 text-[10px]" variant="outline">
                    {reason}
                  </Badge>
                </div>
                <p className="mt-1 truncate text-[11px] text-slate-500">
                  {fmtOrDash(deal.vertical)} · {fmtOrDash(deal.client)} ·{" "}
                  {fmtOrDash(deal.market)}
                </p>
              </button>
            ))
          ) : (
            <p className="text-xs text-slate-500">
              All filtered deals are plotted on the map.
            </p>
          )}
        </div>
      </aside>
    </div>
  );
}
