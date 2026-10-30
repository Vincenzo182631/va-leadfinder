import { skillLabel, type SkillCode, type TemplateCode } from '../constants';

export interface DraftContext {
  companyName: string;
  roleTitle: string;
  /** Confirmed business need from the opportunity's own summary/signals. */
  confirmedNeed: string;
  userName: string;
  userSkills: SkillCode[];
}

export const TEMPLATE_META: Record<TemplateCode, { label: string; description: string }> = {
  general_admin: { label: 'General administrative support', description: 'Inbox, calendar, documents, scheduling' },
  ghl_crm: { label: 'GoHighLevel / CRM automation', description: 'Pipelines, workflows, CRM hygiene' },
  marketing_social: { label: 'Email marketing / social media', description: 'Campaigns, newsletters, content calendars' },
};

export const OUTREACH_COMPLIANCE_NOTE =
  'Review and personalise this draft before sending. Contact the business only through the route it publishes, ' +
  'send one message (no bulk sending), honour opt-out requests, and follow applicable outreach and anti-spam laws ' +
  '(for example the US CAN-SPAM Act for commercial email).';

const OFFER: Record<TemplateCode, string> = {
  general_admin:
    'I help small teams stay on top of email, calendars, documents and day-to-day admin so owners can focus on clients.',
  ghl_crm:
    'I set up and maintain GoHighLevel and CRM pipelines, automations and follow-up workflows so leads are not missed.',
  marketing_social:
    'I support email campaigns, newsletters and social media scheduling so a business keeps a consistent presence.',
};

/** Deterministic, fact-only outreach draft. Uses only confirmed details — no invented familiarity, results or referrals. */
export function generateOutreachDraft(template: TemplateCode, ctx: DraftContext): { subject: string; body: string } {
  const skills = ctx.userSkills.length ? ctx.userSkills.map(skillLabel).join(', ') : 'virtual assistance';
  const name = ctx.userName.trim() || '[Your name]';
  const need = ctx.confirmedNeed.trim().replace(/\s+/g, ' ');
  const subject = `Remote support for ${ctx.companyName}: ${ctx.roleTitle}`.slice(0, 140);
  const body = [
    `Hello ${ctx.companyName} team,`,
    '',
    `I saw that you are looking for help with "${ctx.roleTitle}".${need ? ` Your listing mentions: ${need}` : ''}`,
    '',
    `I am a Philippines-based virtual assistant working remotely with US businesses. ${OFFER[template]}`,
    `My skills include: ${skills}.`,
    '',
    'If outside or contract support is an option for this role, I would be glad to share relevant work samples and discuss how I could help. I can work overlapping US business hours.',
    '',
    'Thank you for your time,',
    name,
    '[Portfolio or LinkedIn URL]',
  ].join('\n');
  return { subject, body };
}
