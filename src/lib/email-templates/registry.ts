import type { ComponentType } from "react";

import { NOTIFICATION_TEMPLATES } from "./notification";

export interface TemplateEntry {
  component: ComponentType<any>;
  subject: string | ((data: Record<string, any>) => string);
  displayName?: string;
  previewData?: Record<string, any>;
  /** Fixed recipient — overrides caller-provided recipientEmail when set. */
  to?: string;
}

/**
 * Template registry — maps template names to their React Email components.
 * The seven app notifications plus the scheduled-report envelope all render
 * from the bilingual notification template (see ./notification.tsx).
 */
export const TEMPLATES: Record<string, TemplateEntry> = {
  "client-invite": NOTIFICATION_TEMPLATES.client_invite,
  "sub-invite": NOTIFICATION_TEMPLATES.sub_invite,
  transmittal: NOTIFICATION_TEMPLATES.transmittal,
  "claim-submitted": NOTIFICATION_TEMPLATES.claim_submitted,
  "claim-certified": NOTIFICATION_TEMPLATES.claim_certified,
  payment: NOTIFICATION_TEMPLATES.payment,
  "compliance-expiry": NOTIFICATION_TEMPLATES.compliance_expiry,
  "scheduled-report": NOTIFICATION_TEMPLATES.scheduled_report,
};
