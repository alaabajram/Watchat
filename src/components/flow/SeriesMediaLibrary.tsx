"use client";

// The series media library on the series page: the same files the Flow builder's Media tab shows.

import { useState } from "react";
import type { Asset } from "@/lib/flows/store";
import { MediaLibrary } from "./MediaLibrary";

export function SeriesMediaLibrary({ seriesId, initial }: { seriesId: string; initial: Asset[] }) {
  const [assets, setAssets] = useState(initial);
  return (
    <div style={{ maxWidth: 900 }}>
      <MediaLibrary seriesId={seriesId} assets={assets} setAssets={setAssets} graph={{ v: 1, nodes: [], edges: [] }} publishedGraph={null} canAttach={false} onAttach={() => {}} onShowCard={() => {}} compact />
    </div>
  );
}
