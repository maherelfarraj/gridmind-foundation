insert into public.profiles (id, company_id, email, full_name)
values ('94ab0f04-5b4c-4e0c-881e-6ab2d230d318', '1ab0730f-d6fa-4678-b1b7-7f752c80eceb', 'maher@next.jo', 'Maher')
on conflict (id) do update set company_id = excluded.company_id, email = excluded.email, updated_at = now();

insert into public.user_roles (user_id, company_id, role)
values
  ('94ab0f04-5b4c-4e0c-881e-6ab2d230d318', '1ab0730f-d6fa-4678-b1b7-7f752c80eceb', 'company_admin'),
  ('94ab0f04-5b4c-4e0c-881e-6ab2d230d318', '1ab0730f-d6fa-4678-b1b7-7f752c80eceb', 'super_admin')
on conflict (user_id, company_id, role) do nothing;

insert into public.audit_logs (company_id, actor_id, action, entity, entity_id, metadata)
values (
  '1ab0730f-d6fa-4678-b1b7-7f752c80eceb',
  '94ab0f04-5b4c-4e0c-881e-6ab2d230d318',
  'admin.bootstrap_grant',
  'user_roles',
  '94ab0f04-5b4c-4e0c-881e-6ab2d230d318',
  jsonb_build_object(
    'email', 'maher@next.jo',
    'company', 'GSI',
    'roles', jsonb_build_array('company_admin','super_admin'),
    'reason', 'first admin bootstrap (no existing admin to grant via UI)'
  )
);