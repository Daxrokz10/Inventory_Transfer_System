// PostgREST caps every response at 1000 rows by default. Any query that must
// return a whole table/view (e.g. stock_balances, which grows with every
// item x site combination) silently loses rows past that cap — no error, just
// missing data. selectAll pages through with .range() until exhausted.
//
// Usage: pass a factory that builds a FRESH query each call, because a query
// builder cannot be reused once awaited:
//   const rows = await selectAll<Row>(() =>
//     supabase.from("stock_balances").select("project_id, item_id, on_hand"));

const PAGE_SIZE = 1000;

type RangeableQuery<T> = {
  range: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>;
};

export async function selectAll<T>(
  makeQuery: () => RangeableQuery<T>,
  pageSize: number = PAGE_SIZE,
): Promise<T[]> {
  const all: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await makeQuery().range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    all.push(...rows);
    // A short page means we've reached the end.
    if (rows.length < pageSize) break;
  }
  return all;
}

/* Same job, different shape: a builder that takes (from, to) and whose data
   is typed `unknown`. Needed where supabase-js types an embedded join
   (`machines(...)`) as an array while PostgREST returns a single object for
   a to-one relationship, which makes the row type unassignable to T.

   ORDER MATTERS for both helpers: paging without a stable .order() can
   repeat or skip rows between pages, so give the query a deterministic sort. */
export async function fetchAllRows<T>(
  build: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>,
  pageSize = PAGE_SIZE,
  maxPages = 50,
): Promise<T[]> {
  const out: T[] = [];
  for (let page = 0; page < maxPages; page++) {
    const from = page * pageSize;
    const { data, error } = await build(from, from + pageSize - 1);
    if (error) throw error;
    const rows = (Array.isArray(data) ? data : []) as T[];
    out.push(...rows);
    if (rows.length < pageSize) return out;
  }
  console.warn(`fetchAllRows: hit the ${maxPages}-page cap, results may be partial`);
  return out;
}
