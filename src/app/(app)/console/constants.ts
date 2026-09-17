export const ACCESS_FLAGS = ["can_inventory", "can_diesel", "hr_staff", "hr_interviewer", "hr_planning"] as const;
export type AccessFlag = (typeof ACCESS_FLAGS)[number];

export const ACCESS_LABELS: Record<AccessFlag, string> = {
  can_inventory: "Inventory",
  can_diesel: "Diesel",
  hr_staff: "HR staff",
  hr_interviewer: "Interviewer",
  hr_planning: "Planning",
};
