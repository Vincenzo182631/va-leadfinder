import { ButtonLink } from '../../components/ui';
import { Alert } from '../../components/ui';

function LegalShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-14">
      <h1 className="text-4xl font-extrabold">{title}</h1>
      <Alert tone="warn" className="mt-6" title="Draft placeholder — pending legal review">
        This document is a working draft and has not been reviewed or approved by a lawyer. It will be replaced before public launch.
      </Alert>
      <div className="mt-8 space-y-4 text-sm leading-relaxed [&_h2]:mt-8 [&_h2]:text-lg [&_h2]:font-bold">{children}</div>
    </div>
  );
}

export function TermsPage() {
  return (
    <LegalShell title="Terms of Service">
      <h2>1. The service</h2>
      <p>VA LeadFinder is a research and organisation workspace for independent virtual assistants. It surfaces business opportunities, estimates fit, and helps you prepare outreach.</p>
      <h2>2. No guarantee of work</h2>
      <p>Opportunities are not offers of employment or engagement. We do not guarantee that any business will respond to or hire you. Match scores are estimates.</p>
      <h2>3. Acceptable use</h2>
      <p>You agree not to use the service for bulk or automated unsolicited messaging, to harass any business, to resell or republish opportunity data, or to attempt to access other users' data.</p>
      <h2>4. Subscriptions</h2>
      <p>Paid plans renew monthly until cancelled. Cancelling stops future charges; access continues to the end of the paid period. Plan changes take effect at the next billing cycle.</p>
      <h2>5. Source data</h2>
      <p>Opportunity data is provided under the terms of each source. Attribution and removal requests are honoured.</p>
      <h2>6. Contact</h2>
      <p>support@example.com (placeholder)</p>
    </LegalShell>
  );
}

export function PrivacyPage() {
  return (
    <LegalShell title="Privacy Policy">
      <h2>What we collect about you</h2>
      <p>Account email and authentication data; profile name, country and time zone; skills and preferences; saved prospects, notes, drafts and feedback; subscription status (payment card details are handled by PayMongo and never stored by us); minimal product usage events.</p>
      <h2>Why</h2>
      <p>To provide the service, match opportunities to your preferences, enforce plan limits, send the emails you opt into, and improve the product. We aim to comply with the Philippine Data Privacy Act of 2012 (RA 10173).</p>
      <h2>Opportunity data</h2>
      <p>We store company-level information and generic business contact routes. We do not collect sensitive personal information and do not scrape personal profiles. Publicly available information is not treated as automatically free to use.</p>
      <h2>Your rights</h2>
      <p>You can download your data and request deletion from Account → Your data. You may also contact us to correct or object to processing.</p>
      <h2>Retention</h2>
      <p>Account data is kept while your account is active. Source records are deleted after each source's retention period.</p>
      <h2>Contact</h2>
      <p>Data protection contact: privacy@example.com (placeholder)</p>
    </LegalShell>
  );
}

export function NotFoundPage() {
  return (
    <div className="mx-auto max-w-xl px-4 py-24 text-center">
      <h1 className="text-3xl font-bold">Page not found</h1>
      <p className="mt-2 text-muted">The page you're looking for doesn't exist.</p>
      <ButtonLink to="/" className="mt-6">Back to home</ButtonLink>
    </div>
  );
}
