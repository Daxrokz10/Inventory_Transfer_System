import { createAdminClient } from "@/lib/supabase/admin";
import type { FuelPrice } from "./types";

/* City-level daily fuel prices, cached in the fuel_prices table.

   Source: goodreturns.in — a free, public, consumer fuel-price site with
   one page per city per fuel:
     https://www.goodreturns.in/{diesel|petrol}-price-in-{city-slug}.html
   Each page embeds a JSON-LD <script> block whose "name" field reads
   like "Petrol Price in Surat, Petrol Rate Today (13th Jul, 2026),
   Rs. 102.23/Ltr" — that's what gets parsed out. No API key, no signup,
   no rate limit; a normal browser User-Agent is enough to avoid basic
   bot-blocking. This replaced an unreliable third-party fuel-price API
   whose petrol figures were off by several rupees against real prices. */

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

export interface DayPrices {
  diesel: number | null;
  petrol: number | null;
  /** Where the numbers came from: cache, api, stale (older day), none. */
  source: "cache" | "api" | "stale" | "none";
  priceDate: string | null;
}

function citySlug(city: string): string {
  return city
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-");
}

async function fetchCityFuelPrice(
  city: string,
  fuelType: "diesel" | "petrol",
): Promise<number | null> {
  const url = `https://www.goodreturns.in/${fuelType}-price-in-${citySlug(city)}.html`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    if (!res.ok) {
      console.error(`goodreturns.in ${res.status} for ${fuelType}/${city}`);
      return null;
    }
    const html = await res.text();
    // "...Rate Today (13th Jul, 2026), Rs. 102.23/Ltr" — pull the number
    // out of the JSON-LD name field rather than parsing the whole page.
    const match = html.match(/"name"\s*:\s*"[^"]*Rs\.?\s*([\d]+\.?\d*)\s*\/Ltr/i);
    const price = match ? Number(match[1]) : NaN;
    if (!Number.isFinite(price) || price <= 0 || price > 500) {
      console.error(`goodreturns.in: couldn't parse a price for ${fuelType}/${city}`);
      return null;
    }
    return price;
  } catch (err) {
    console.error(`goodreturns.in fetch failed for ${fuelType}/${city}`, err);
    return null;
  }
}

/** Fetch and cache today's diesel+petrol prices for one city (2 requests). */
async function refreshCityPrices(city: string, date: string): Promise<DayPrices> {
  const admin = createAdminClient();
  const [diesel, petrol] = await Promise.all([
    fetchCityFuelPrice(city, "diesel"),
    fetchCityFuelPrice(city, "petrol"),
  ]);

  const rows: FuelPrice[] = [];
  if (diesel != null) {
    rows.push({ price_date: date, location: city, fuel_type: "diesel", price: diesel, source: "api" });
  }
  if (petrol != null) {
    rows.push({ price_date: date, location: city, fuel_type: "petrol", price: petrol, source: "api" });
  }
  if (rows.length > 0) {
    const { error } = await admin
      .from("fuel_prices")
      .upsert(rows, { onConflict: "price_date,location,fuel_type" });
    if (error) console.error("Failed to cache fuel prices", error.message);
  }

  return { diesel, petrol, source: rows.length > 0 ? "api" : "none", priceDate: date };
}

/** Get diesel+petrol prices for a city on a date — cache first; on a
    cache miss for today, scrape goodreturns.in; otherwise fall back to
    the most recent cached day for that city. */
export async function getPricesForCity(
  city: string | null,
  date: string,
): Promise<DayPrices> {
  if (!city) return { diesel: null, petrol: null, source: "none", priceDate: null };

  const admin = createAdminClient();

  const readDay = async (d: string) => {
    const { data } = await admin
      .from("fuel_prices")
      .select("fuel_type, price")
      .eq("location", city)
      .eq("price_date", d);
    return data ?? [];
  };
  const fromRows = (rows: Pick<FuelPrice, "fuel_type" | "price">[]) => ({
    diesel: rows.find((r) => r.fuel_type === "diesel")?.price ?? null,
    petrol: rows.find((r) => r.fuel_type === "petrol")?.price ?? null,
  });

  const cached = await readDay(date);
  if (cached.length > 0) {
    return { ...fromRows(cached), source: "cache", priceDate: date };
  }

  const today = new Date().toISOString().slice(0, 10);
  if (date === today) {
    const fresh = await refreshCityPrices(city, today);
    if (fresh.diesel != null || fresh.petrol != null) return fresh;
  }

  // Stale fallback: latest cached day for this city.
  const { data: stale } = await admin
    .from("fuel_prices")
    .select("fuel_type, price, price_date")
    .eq("location", city)
    .lte("price_date", date)
    .order("price_date", { ascending: false })
    .limit(2);

  if (stale && stale.length > 0) {
    return { ...fromRows(stale), source: "stale", priceDate: stale[0].price_date };
  }

  return { diesel: null, petrol: null, source: "none", priceDate: null };
}
