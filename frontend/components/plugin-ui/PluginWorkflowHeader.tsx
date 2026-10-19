'use client';

import Link from 'next/link';

type WorkflowStep = { label: string; route: string };

export default function PluginWorkflowHeader({ pluginId, title, options }: { pluginId: string; title?: string; options?: Record<string, any> }) {
  const steps = Array.isArray(options?.steps) ? options.steps.filter((step: unknown): step is WorkflowStep => Boolean(step && typeof step === 'object' && typeof (step as WorkflowStep).label === 'string' && typeof (step as WorkflowStep).route === 'string')) : [];
  const activeStep = Math.max(0, Math.min(Number(options?.activeStep) || 0, Math.max(steps.length - 1, 0)));
  const dashboardRoute = typeof options?.dashboardRoute === 'string' ? options.dashboardRoute : 'dashboard';
  const currentStep = steps[activeStep];
  const nextStep = steps[activeStep + 1];
  const guide = typeof options?.guide === 'string' && options.guide.trim()
    ? options.guide.trim()
    : `Complete the actions and review the records on this page before continuing${nextStep ? ` to ${nextStep.label}` : ' to your final review'}. Saved information remains available to the later workflow stages.`;
  return <div className="space-y-4">
    <header className="overflow-hidden rounded-3xl border border-indigo-100 bg-gradient-to-br from-slate-950 via-indigo-950 to-violet-700 p-6 text-white shadow-lg sm:p-7">
      <p className="text-xs font-bold uppercase tracking-[.22em] text-indigo-200">{options?.eyebrow || 'Workflow'}</p>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
        <div><h1 className="text-2xl font-black tracking-tight sm:text-3xl">{title}</h1>{options?.description && <p className="mt-2 max-w-3xl text-sm leading-6 text-indigo-100">{options.description}</p>}</div>
        {options?.showDashboard !== false && <Link href={`/plugins/${encodeURIComponent(pluginId)}/${dashboardRoute}`} className="rounded-xl border border-white/20 bg-white/10 px-4 py-2 text-sm font-bold hover:bg-white/20">{options?.dashboardLabel || 'Dashboard'}</Link>}
      </div>
    </header>
    {steps.length > 0 && <nav aria-label={options?.navigationLabel || 'Plugin workflow'} className="flex gap-2 overflow-x-auto pb-1">{steps.map((step, index) => <Link key={`${step.route}-${index}`} href={`/plugins/${encodeURIComponent(pluginId)}/${step.route}`} className={`whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-bold transition ${index === activeStep ? 'border-indigo-600 bg-indigo-600 text-white shadow-sm' : index < activeStep ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-white text-slate-500 hover:border-indigo-200 hover:text-indigo-700'}`}><span aria-hidden="true">{index < activeStep ? '✓ ' : `${index + 1}. `}</span>{step.label}</Link>)}</nav>}
    <section className="rounded-2xl border border-sky-200 bg-sky-50/80 px-5 py-4 text-sky-950" aria-label="Page guide">
      <div className="flex gap-3"><span aria-hidden="true" className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-sky-600 text-sm font-black text-white">?</span><div><h2 className="font-bold">Page guide{currentStep ? ` · ${currentStep.label}` : ''}</h2><p className="mt-1 text-sm leading-6 text-sky-900">{guide}</p>{nextStep && <Link href={`/plugins/${encodeURIComponent(pluginId)}/${nextStep.route}`} className="mt-2 inline-flex text-sm font-bold text-sky-700 hover:text-sky-900">Continue to {nextStep.label} →</Link>}</div></div>
    </section>
  </div>;
}
