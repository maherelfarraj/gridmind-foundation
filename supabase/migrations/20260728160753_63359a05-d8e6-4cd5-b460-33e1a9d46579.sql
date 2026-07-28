DO $$
DECLARE v_def text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_def
    FROM pg_proc WHERE proname = 'settle_approval_entity'
     AND pronamespace = 'public'::regnamespace;

  v_def := replace(v_def,
$old$  ELSE
    PERFORM set_config('gridmind.approval_settle', 'off', true);
    RETURN jsonb_build_object('settled', false, 'reason', 'entity_not_mirrored',
                              'entity_type', v_inst.entity_type);
  END IF;$old$,
$new$  ELSE
    PERFORM set_config('gridmind.approval_settle', 'off', true);
    RETURN public.settle_derived_entity(p_instance_id);
  END IF;$new$);

  IF v_def NOT LIKE '%settle_derived_entity%' THEN
    RAISE EXCEPTION 'P-249: settler delegation patch did not apply';
  END IF;
  EXECUTE v_def;
END $$;