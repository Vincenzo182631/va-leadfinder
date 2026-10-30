const faqs: [string, string][] = [
  ['What is an "opportunity"?', 'A business that shows a documented need for remote help — for example a role posting or a stated need for contractors — summarised in our own words, with a link to the original source and any eligibility restrictions.'],
  ['Are these guaranteed clients?', 'No. An opportunity is a lead to research, not a promise of work. Match scores are estimates based on the information available. Always read the original source and verify requirements before reaching out.'],
  ['Is the current data real?', 'During the beta, the workspace shows clearly labelled FICTIONAL demo opportunities so you can explore every feature. Licensed live opportunities appear only from sources we have permission to use, and each one shows its source.'],
  ['Where does live data come from?', 'Only from sources whose terms permit our exact use — for example a written agreement with a data provider, or opportunities our team summarises from sources that allow it. We do not scrape LinkedIn or bypass any website protections.'],
  ['How fresh is the data?', 'Each opportunity shows when it was posted or observed and when it was last verified. Listings older than 30 days without re-verification are marked "Stale", and expired listings are hidden.'],
  ['Does "Remote" mean I can apply from the Philippines?', 'Not necessarily. We show explicit restrictions such as "US residents only" or "US work authorization required", and by default hide roles that exclude Philippines-based contractors. When eligibility is not stated, we mark it "Needs review".'],
  ['Do you send emails to businesses for me?', 'No. We help you prepare a personalised draft. You review it and send it yourself through the contact route the business publishes. Please follow applicable outreach laws and honour opt-outs.'],
  ['How do cancellations work?', 'Cancel anytime in Account → Billing. You will not be charged again, and paid features remain until the end of the period you already paid for.'],
  ['What about my privacy?', 'We collect only what we need to run your account: your login, preferences, saved prospects and notes. You can download your data or request deletion from your account page. See the Privacy Policy for details.'],
];

export function FaqPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-14">
      <h1 className="text-4xl font-extrabold">Frequently asked questions</h1>
      <div className="mt-8 divide-y divide-line rounded-2xl border border-line bg-white">
        {faqs.map(([q, a]) => (
          <details key={q} className="group p-5">
            <summary className="cursor-pointer list-none font-semibold text-navy-900 marker:hidden">
              <span className="flex items-center justify-between gap-4">{q}<span aria-hidden className="text-teal-700 transition-transform group-open:rotate-45">+</span></span>
            </summary>
            <p className="mt-3 text-sm text-ink">{a}</p>
          </details>
        ))}
      </div>
    </div>
  );
}
