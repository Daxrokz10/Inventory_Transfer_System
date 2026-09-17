-- HR sheet: the Excel's "Date" column, and a record of how the sheet's
-- headings were matched (shown in HR → Settings so mismatches are visible).

alter table hr_candidates add column if not exists entry_date text; -- as shown in the Excel, e.g. 13/08/2024

alter table hr_ms_connection add column if not exists column_map jsonb;
