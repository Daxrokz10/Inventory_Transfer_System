// Tiny class-name joiner — enough for our variant props, no dependency.
export function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}
