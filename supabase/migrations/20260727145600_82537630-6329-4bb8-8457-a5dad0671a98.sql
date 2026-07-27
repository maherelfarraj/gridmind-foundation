alter table public.timesheet_entries drop constraint if exists timesheet_entries_unique_slot;
alter table public.timesheet_entries
  add constraint timesheet_entries_unique_slot
  unique nulls not distinct (timesheet_id, work_date, project_id, activity);