-- =============================================================
-- Switch fuel pricing from state-level (unreliable third-party API) to
-- city-level, scraped directly from goodreturns.in — free, no API key,
-- and matches real consumer prices (verified against Google's own
-- figures at the time this was written).
-- =============================================================

alter table projects add column if not exists city text;

alter table fuel_prices rename column state to location;
