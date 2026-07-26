do $$
declare v_project uuid := 'd887fd69-4542-4ae4-a9a1-e0253e7258ff';
        v_company uuid := '1ab0730f-d6fa-4678-b1b7-7f752c80eceb';
        v_drawing uuid;
        v_rev uuid;
begin
  if exists (select 1 from public.sld_drawings where project_id = v_project) then
    return;
  end if;

  insert into public.sld_drawings (company_id, project_id, drawing_number, title, status, sheet_size, border_template)
  values (v_company, v_project, 'SLD-0001', 'Overall single line diagram', 'draft', 'A1', 'gridmind_default')
  returning id into v_drawing;

  insert into public.sld_revisions (company_id, drawing_id, revision_code, status, canvas)
  values (v_company, v_drawing, 'A', 'draft',
    jsonb_build_object(
      'gridMm', 5,
      'snapEnabled', true,
      'layers', jsonb_build_array(
        jsonb_build_object('id','__border','name','Sheet border','visible',true,'locked',true,'system',true),
        jsonb_build_object('id','default','name','Equipment','visible',true,'locked',false)
      )
    ))
  returning id into v_rev;

  update public.sld_drawings set current_revision_id = v_rev where id = v_drawing;
end $$;