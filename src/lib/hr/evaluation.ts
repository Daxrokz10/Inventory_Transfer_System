/* The company's Technical Interview Evaluation Form, as data.
   Same eight rows and the same 1-5 scale as the printed sheet. */

export const SKILLS = [
  { id: "tech_match", label: "How well do their technical skills match job requirements?" },
  { id: "experience_match", label: "Does their experience appear to match?" },
  { id: "interpersonal", label: "Interpersonal and communication skills" },
  { id: "technical_knowledge", label: "Technical knowledge" },
  { id: "similar_work", label: "Work experience in a similar job in the past" },
  { id: "education", label: "Educational qualification" },
  { id: "learning", label: "Learning ability" },
  { id: "track_record", label: "Past track record and performance (HR)" },
] as const;

export type SkillId = (typeof SKILLS)[number]["id"];
export type Scores = Partial<Record<SkillId, number>>;

export const RATING_LABELS: Record<number, string> = {
  1: "Poor",
  2: "Fair",
  3: "Above average",
  4: "Good",
  5: "Very good",
};

export const RATING_SCALE = "1 = Poor · 2 = Fair · 3 = Above average · 4 = Good · 5 = Very good";

export function parseScores(value: unknown): Scores {
  if (!value || typeof value !== "object") return {};
  const out: Scores = {};
  for (const s of SKILLS) {
    const n = Number((value as Record<string, unknown>)[s.id]);
    if (n >= 1 && n <= 5) out[s.id] = Math.round(n);
  }
  return out;
}

/** Average of the scores given, rounded to one decimal (null if none). */
export function averageScore(scores: Scores): number | null {
  const given = SKILLS.map((s) => scores[s.id]).filter((n): n is number => typeof n === "number");
  if (!given.length) return null;
  return Math.round((given.reduce((a, b) => a + b, 0) / given.length) * 10) / 10;
}
