alter table public.entity_links drop constraint if exists entity_links_type_check;

alter table public.entity_links add constraint entity_links_type_check check (
  source_type = any (array['opportunity','proposal','project','layout','simulation','sld','bom','rfq','po','purchase_order','cwp','inspection','test','certificate','turnover','asset','work_order','warranty_claim','drawing','document','equipment','scada_alarm','spare_part','vendor','contract','change_request','impact_assessment','estimate'])
  and target_type = any (array['opportunity','proposal','project','layout','simulation','sld','bom','rfq','po','purchase_order','cwp','inspection','test','certificate','turnover','asset','work_order','warranty_claim','drawing','document','equipment','scada_alarm','spare_part','vendor','contract','change_request','impact_assessment','estimate'])
);