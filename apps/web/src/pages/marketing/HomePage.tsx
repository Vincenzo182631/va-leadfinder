import { ArrowRight, BadgeCheck, ClipboardList, FileSearch, MailCheck, ShieldCheck, Target } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Badge, ButtonLink, Card, ScoreRing } from '../../components/ui';
import { usePublicConfig } from '../../hooks/queries';

const steps = [
  { icon: Target, title: 'Tell us your services', body: 'Pick your VA skills, preferred work types and the US markets you serve. Takes about two minutes.' },
  { icon: FileSearch, title: 'Review sourced opportunities', body: 'Each opportunity shows its source, date, eligibility restrictions and a transparent match score.' },
  { icon: ClipboardList, title: 'Save and research', body: 'Track prospects through a simple pipeline with notes and follow-up dates.' },
  { icon: MailCheck, title: 'Prepare thoughtful outreach', body: 'Start from an editable draft that uses only confirmed details. You review and send it yourself.' },
];

const niches = [
  { title: 'Admin & executive support', body: 'Inbox, calendar, documents, scheduling, research.' },
  { title: 'GoHighLevel, CRM & automation', body: 'Pipelines, workflows, follow-ups, CRM hygiene.' },
  { title: 'Email marketing & social media', body: 'Newsletters, campaigns, content calendars.' },
];

export function HomePage() {
  const cfg = usePublicConfig();
  const demoOnly = cfg.data ? cfg.data.liveSourcesActive === 0 : true;
  return (
    <>
      <section className="bg-navy-900 text-white">
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-16 md:grid-cols-2 md:py-24">
          <div>
            <Badge tone="teal" className="mb-4 bg-teal-500/20 text-teal-500">Beta · Built for Filipino virtual assistants</Badge>
            <h1 className="text-4xl font-extrabold leading-tight text-white sm:text-5xl">Find businesses that need your skills.</h1>
            <p className="mt-5 max-w-xl text-lg text-white/80">
              Discover relevant US business opportunities, see why they match your VA services, and organize better outreach—all in one workspace.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <ButtonLink to="/signup">Explore a demo <ArrowRight className="size-4" aria-hidden /></ButtonLink>
              <ButtonLink to="/signup" variant="onDark">Join the beta</ButtonLink>
            </div>
            <p className="mt-4 text-xs text-white/60">No credit card needed to explore. Opportunities are not guaranteed clients.</p>
          </div>
          <Card className="bg-white text-ink">
            <div className="mb-3 flex items-center justify-between">
              <Badge tone="demo">Example · fictional data</Badge>
              <span className="text-xs text-muted">Source: Demo data · 1 day ago</span>
            </div>
            <div className="flex gap-4">
              <ScoreRing score={93} band="high" />
              <div>
                <p className="text-sm text-muted">Demo Coastline Agency</p>
                <h2 className="text-lg font-bold">GoHighLevel CRM Assistant (contract)</h2>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <Badge tone="teal">Likely fit</Badge><Badge>Remote · open worldwide</Badge><Badge>Contract</Badge>
                </div>
              </div>
            </div>
            <ul className="mt-4 space-y-1.5 text-sm">
              <li className="flex gap-2"><BadgeCheck className="size-4 shrink-0 text-teal-700" aria-hidden /> Matches your skills: GoHighLevel / CRM, Automation</li>
              <li className="flex gap-2"><BadgeCheck className="size-4 shrink-0 text-teal-700" aria-hidden /> Hiring signal: listing says "contractors welcome"</li>
              <li className="flex gap-2"><BadgeCheck className="size-4 shrink-0 text-teal-700" aria-hidden /> Open to Philippines-based contractors</li>
            </ul>
          </Card>
        </div>
      </section>

      <section id="how-it-works" className="mx-auto max-w-6xl px-4 py-16">
        <h2 className="text-3xl font-bold">How it works</h2>
        <p className="mt-2 max-w-2xl text-muted">A focused workspace for finding direct clients — no scraping, no automated spam, no false promises.</p>
        <ol className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map((s, i) => (
            <Card as="li" key={s.title}>
              <div className="mb-3 flex size-10 items-center justify-center rounded-xl bg-teal-500/15 text-teal-700"><s.icon className="size-5" aria-hidden /></div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">Step {i + 1}</p>
              <h3 className="mt-1 font-semibold">{s.title}</h3>
              <p className="mt-1 text-sm text-muted">{s.body}</p>
            </Card>
          ))}
        </ol>
      </section>

      <section className="border-y border-line bg-white">
        <div className="mx-auto max-w-6xl px-4 py-16">
          <h2 className="text-3xl font-bold">Launch specialties</h2>
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {niches.map((n) => (
              <Card key={n.title} className="bg-page">
                <h3 className="font-semibold">{n.title}</h3>
                <p className="mt-1 text-sm text-muted">{n.body}</p>
              </Card>
            ))}
          </div>
          <p className="mt-4 text-sm text-muted">Coming later: e-commerce operations, customer support, website admin, SEO, real estate and travel administration.</p>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-16">
        <div className="grid gap-8 md:grid-cols-2">
          <div>
            <div className="mb-3 flex size-10 items-center justify-center rounded-xl bg-navy-900 text-teal-500"><ShieldCheck className="size-5" aria-hidden /></div>
            <h2 className="text-3xl font-bold">Source transparency</h2>
            <p className="mt-3 text-muted">
              Every opportunity shows where it came from, when it was observed and when it was last verified. We only use sources we have documented
              permission to use, we don't scrape LinkedIn, and we never invent contact details.
            </p>
            <p className="mt-3 text-muted">Opportunities are company-level hiring signals and legitimate business contact routes—not personal data.</p>
          </div>
          <Card>
            <h3 className="font-semibold">Current data status</h3>
            {demoOnly ? (
              <p className="mt-2 text-sm">
                <Badge tone="demo">Demo mode</Badge>
                <span className="mt-2 block text-muted">
                  The beta currently shows <strong>fictional demo opportunities</strong> so you can explore every feature. Licensed live opportunities
                  will be added only after source agreements are in place.
                </span>
              </p>
            ) : (
              <p className="mt-2 text-sm text-muted">Live opportunities come from {cfg.data?.liveSourcesActive} approved source(s), each shown with attribution.</p>
            )}
            <p className="mt-4 text-sm"><Link to="/faq">Read how we source data →</Link></p>
          </Card>
        </div>
      </section>

      <section className="bg-teal-500/10">
        <div className="mx-auto flex max-w-6xl flex-col items-start gap-4 px-4 py-12 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-2xl font-bold">Ready to look around?</h2>
            <p className="text-muted">Create a free account and explore the demo workspace.</p>
          </div>
          <ButtonLink to="/signup">Join the beta</ButtonLink>
        </div>
      </section>
    </>
  );
}
