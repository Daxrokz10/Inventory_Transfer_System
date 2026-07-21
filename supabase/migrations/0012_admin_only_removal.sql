-- =============================================================
-- Machine removal (deactivate or delete) is admin-only.
--
-- 0010 gave supervisors UPDATE/DELETE on their own site's machines
-- (used for self-service deactivate/delete). That's reverted: only
-- admin/superadmin can deactivate, reactivate, delete, or transfer a
-- machine now — supervisors keep INSERT rights (registering new
-- machines) but nothing else.
-- =============================================================

drop policy if exists "supervisor updates own site machines" on machines;
drop policy if exists "supervisor deletes own site machines" on machines;
