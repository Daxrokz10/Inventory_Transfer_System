"use client";

import { useEffect } from "react";

/** Scrolls the highlighted candidate's card into view (both axes: the board
    scrolls sideways across stages). */
export function ScrollToCard({ id }: { id: string }) {
  useEffect(() => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
  }, [id]);
  return null;
}
