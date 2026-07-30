-- =============================================================
-- Free up a numberplate once its machine is deactivated.
--
-- machines_project_reg_idx (0005) enforced uniqueness on
-- (project_id, registration_no) across ALL rows, active or not — so once
-- a machine was deactivated ("removed") its numberplate stayed permanently
-- blocked at that site, and re-registering the same vehicle later (or a
-- replacement carrying the same plate) hit "already registered at this
-- site" with no way around it. Scope the constraint to active rows only.
-- =============================================================

drop index if exists machines_project_reg_idx;

create unique index machines_project_reg_idx
  on machines (project_id, registration_no)
  where registration_no is not null and is_active;
