// Only these two accounts may edit closing-balance quantities in place.
// Deliberately narrower than the admin role — keep lowercase for comparison.
export const CLOSING_BALANCE_EDITORS = [
  "store@shreeganeshcorp.com",
  "dakshgagnani@gmail.com",
];

export function canEditClosingBalance(email: string | null | undefined): boolean {
  return CLOSING_BALANCE_EDITORS.includes((email ?? "").trim().toLowerCase());
}
