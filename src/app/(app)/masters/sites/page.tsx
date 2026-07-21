import { redirect } from "next/navigation";

// The Sites master now lives in the Diesel module.
export default function LegacySitesRedirect() {
  redirect("/diesel/sites");
}
