/* Mapping between the HR master Excel sheet and hr_candidates.

   Headers are matched loosely (case, spaces and punctuation ignored, plus
   aliases) so HR can keep the sheet exactly as they wrote it. */

export const CANDIDATE_FIELDS = [
  "entry_date",
  "name",
  "designation",
  "phone",
  "current_salary",
  "expected_salary",
  "experience_years",
  "industry_experience",
  "hr_remarks",
  "job_change_reason",
  "status",
  "resume_url",
  "opening_code",
  "candidate_code",
] as const;

export type CandidateField = (typeof CANDIDATE_FIELDS)[number];
export type CandidateValues = Record<CandidateField, string | null>;

export const FIELD_LABELS: Record<CandidateField, string> = {
  entry_date: "Date",
  name: "Name",
  designation: "Designation",
  phone: "Phone number",
  current_salary: "Current salary",
  expected_salary: "Expected salary",
  experience_years: "Years of experience",
  industry_experience: "Industrial experience",
  hr_remarks: "HR remarks",
  job_change_reason: "Reason for job change",
  status: "Status",
  resume_url: "Resume",
  opening_code: "Opening",
  candidate_code: "Candidate ID",
};

const norm = (s: unknown) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

const ALIASES: Record<CandidateField, string[]> = {
  entry_date: ["date", "entrydate", "applicationdate", "dateofentry", "dateadded"],
  name: ["name", "candidatename", "fullname", "nameofcandidate"],
  // HR's sheet uses "Position" for the stage a candidate is at, so it maps to
  // status, not designation.
  designation: ["designation", "post", "appliedfor", "positionappliedfor"],
  phone: ["phnumber", "phno", "phone", "phonenumber", "phoneno", "mobile", "mobileno", "mobilenumber", "contact", "contactno", "contactnumber"],
  current_salary: ["salarycurrent", "currentsalary", "currentctc", "ctccurrent", "presentsalary"],
  expected_salary: ["salaryexpected", "expectedsalary", "expectedctc", "ctcexpected"],
  experience_years: ["totalexperience", "yearsofexperience", "experience", "totalexp", "exp", "experienceyears", "yearsexperience", "yrsofexperience"],
  industry_experience: ["industrialexperience", "industryexperience", "industry", "relevantexperience", "industrialexp"],
  hr_remarks: ["hrremarks", "hrremark", "remarks", "remark", "hrcomments", "comments"],
  job_change_reason: ["reasonforjobchange", "reasonforjobchnage", "reasonforchange", "jobchangereason", "reasonforleaving", "reasonofjobchange", "reasonforchangingjob", "reason"],
  status: ["status", "position", "interviewstatus", "currentstatus", "currentinterviewposition", "stage", "currentposition"],
  resume_url: ["resume", "resumelink", "cv", "cvlink", "resumeurl"],
  opening_code: ["opening", "openingid", "openingcode", "vacancy", "vacancyid"],
  candidate_code: ["candidateid", "id", "candidatecode"],
};

function fieldForHeader(header: unknown): CandidateField | null {
  const h = norm(header);
  if (!h) return null;
  for (const f of CANDIDATE_FIELDS) if (ALIASES[f].includes(h)) return f;
  // "Status (current interview position)" and similar long headers
  for (const f of CANDIDATE_FIELDS) {
    if (ALIASES[f].some((a) => a.length >= 6 && h.startsWith(a))) return f;
  }
  return null;
}

export type SheetLayout = {
  headers: { col: number; text: string; field: CandidateField | null }[]; // every non-empty heading
  headerRow: number; // 1-based absolute sheet row
  cols: Partial<Record<CandidateField, number>>; // 0-based absolute column
  lastCol: number; // 0-based absolute, last used column
  lastRow: number; // 1-based absolute, last used row
  firstDataIndex: number; // index into usedRange.values of the first data row
};

/** Find the header row within the first rows of the sheet.
    `range` is the block read from the top of the used range; `extent` is the
    whole used range (so lastRow/lastCol cover all 6,000+ rows). */
export function detectLayout(
  range: { rowIndex: number; columnIndex: number; values: unknown[][] },
  extent?: { lastRow: number; lastCol: number },
): SheetLayout {
  const rows = range.values ?? [];
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const cols: Partial<Record<CandidateField, number>> = {};
    rows[i].forEach((cell, j) => {
      const f = fieldForHeader(cell);
      if (f && cols[f] === undefined) cols[f] = range.columnIndex + j;
    });
    if (cols.name !== undefined && Object.keys(cols).length >= 3) {
      const headers = rows[i]
        .map((cell, j) => ({ col: range.columnIndex + j, text: cellText(cell) ?? "" }))
        .filter((h) => h.text)
        .map((h) => {
          const f = fieldForHeader(h.text);
          return { ...h, field: f && cols[f] === h.col ? f : null };
        });
      return {
        headers,
        headerRow: range.rowIndex + i + 1,
        cols,
        lastCol: extent?.lastCol ?? range.columnIndex + (rows[0]?.length ?? 1) - 1,
        lastRow: extent?.lastRow ?? range.rowIndex + rows.length,
        firstDataIndex: i + 1,
      };
    }
  }
  throw new Error(
    'Could not find the header row in the sheet. It needs a "Name" column and at least two other known columns (Designation, Ph number, Status, …).',
  );
}

export function cellText(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

/** Excel stores dates as day counts from 1899-12-30; show them as dd/mm/yyyy. */
export function excelSerialToDate(serial: number): string {
  const d = new Date(Date.UTC(1899, 11, 30) + Math.round(serial) * 86_400_000);
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getUTCFullYear()}`;
}

/** Read one sheet row (the raw values array) into candidate fields. */
export function rowToValues(row: unknown[], layout: SheetLayout, columnIndex: number): CandidateValues {
  const out = {} as CandidateValues;
  for (const f of CANDIDATE_FIELDS) {
    const c = layout.cols[f];
    const raw = c === undefined ? null : row[c - columnIndex];
    out[f] = f === "entry_date" && typeof raw === "number" ? excelSerialToDate(raw) : cellText(raw);
  }
  return out;
}

/** Build a contiguous row of cells from the first to the last mapped column,
    leaving unmapped columns untouched (null). */
export function valuesToRow(
  v: Partial<CandidateValues>,
  layout: SheetLayout,
): { startCol: number; cells: (string | null)[] } {
  const mapped = Object.entries(layout.cols) as [CandidateField, number][];
  const startCol = Math.min(...mapped.map(([, c]) => c));
  const endCol = Math.max(...mapped.map(([, c]) => c));
  const cells: (string | null)[] = Array(endCol - startCol + 1).fill(null);
  for (const [f, c] of mapped) {
    if (f in v) cells[c - startCol] = v[f] ?? "";
  }
  return { startCol, cells };
}

const CODE_RE = /^CAND-(\d+)$/i;

export function codeNumber(code: string | null | undefined): number {
  const m = CODE_RE.exec(code ?? "");
  return m ? Number(m[1]) : 0;
}

export function formatCode(n: number): string {
  return `CAND-${String(n).padStart(4, "0")}`;
}

export const STATUS_SUGGESTIONS = [
  "New",
  "Shortlisted",
  "Interview scheduled",
  "Interviewed",
  "Selected",
  "Rejected",
  "On hold",
  "Offer sent",
  "Joined",
];

/* ---------------- addresses ---------------- */

/** Excel letters → 0-based column index (A → 0, AA → 26). */
export function colIndex(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** "Sheet1!A1:L6012" / "'HR Data'!B3:M40" / "Sheet1!A1" → bounds.
    Rows are 1-based, columns 0-based. */
export function parseAddress(address: string): { firstRow: number; lastRow: number; firstCol: number; lastCol: number } {
  const ref = address.slice(address.lastIndexOf("!") + 1);
  const [a, b = a] = ref.split(":");
  const m1 = /^([A-Z]+)(\d+)$/i.exec(a);
  const m2 = /^([A-Z]+)(\d+)$/i.exec(b);
  if (!m1 || !m2) throw new Error(`Unexpected sheet address: ${address}`);
  return {
    firstRow: Number(m1[2]),
    lastRow: Number(m2[2]),
    firstCol: colIndex(m1[1]),
    lastCol: colIndex(m2[1]),
  };
}

/** Normalise a cell for comparisons: Excel may hand back 9876543210 as a
    number while the database holds "9876543210". */
export function sameCell(a: unknown, b: unknown): boolean {
  return (cellText(a) ?? "") === (cellText(b) ?? "");
}

/** Stable fingerprint of a sheet row, so sync only rewrites rows that changed.
    FNV-1a (two passes, 64 bits of output); pure JS so this module stays
    importable from client components. */
export function rowHash(v: CandidateValues): string {
  const text = CANDIDATE_FIELDS.map((f) => v[f] ?? "").join("|");
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193 ^ text.length;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ c, 0x5bd1e995);
  }
  return (h1 >>> 0).toString(16).padStart(8, "0") + (h2 >>> 0).toString(16).padStart(8, "0");
}

/** A value that is an http(s) link. */
export function asUrl(v: string | null | undefined): string | null {
  const t = (v ?? "").trim();
  return /^https?:\/\/\S+$/i.test(t) ? t : null;
}

/** =HYPERLINK("url", "label") → url */
export function hyperlinkFormulaTarget(formula: string | undefined): string | null {
  const m = /HYPERLINK\(\s*"((?:[^"]|"")*)"/i.exec(formula ?? "");
  return m ? m[1].replace(/""/g, '"') : null;
}

/** Cell formula that shows "Resume" and opens the link. */
export function hyperlinkFormula(url: string, label = "Resume"): string {
  const q = (s: string) => s.replace(/"/g, '""');
  return `=HYPERLINK("${q(url)}","${q(label)}")`;
}
