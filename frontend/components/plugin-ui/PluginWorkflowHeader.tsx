"use client";

import Link from "next/link";
import { resolvePluginSourcePath } from "../../lib/plugin-ui-routing";

type WorkflowStep = { label: string; route: string };

export default function PluginWorkflowHeader({
  pluginId,
  title,
  options,
  params = {},
}: {
  pluginId: string;
  title?: string;
  options?: Record<string, any>;
  params?: Record<string, string>;
}) {
  const steps = Array.isArray(options?.steps)
    ? options.steps.filter((step: unknown): step is WorkflowStep =>
        Boolean(
          step &&
          typeof step === "object" &&
          typeof (step as WorkflowStep).label === "string" &&
          typeof (step as WorkflowStep).route === "string",
        ),
      )
    : [];
  const activeStep = Math.max(
    0,
    Math.min(Number(options?.activeStep) || 0, Math.max(steps.length - 1, 0)),
  );
  const dashboardRoute =
    typeof options?.dashboardRoute === "string"
      ? options.dashboardRoute
      : "dashboard";
  const currentStep = steps[activeStep];
  const nextStep = steps[activeStep + 1];
  const company = options?.theme === "company";
  const guide =
    typeof options?.guide === "string" && options.guide.trim()
      ? options.guide.trim()
      : `Complete the actions and review the records on this page before continuing${nextStep ? ` to ${nextStep.label}` : " to your final review"}. Saved information remains available to the later workflow stages.`;
  const hrefFor = (route: string) =>
    `/plugins/${encodeURIComponent(pluginId)}/${resolvePluginSourcePath(route, params)}`;
  return (
    <div className="space-y-4">
      <header
        className={
          company
            ? "overflow-hidden rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8"
            : "overflow-hidden rounded-3xl border border-indigo-100 bg-gradient-to-br from-slate-950 via-indigo-950 to-violet-700 p-6 text-white shadow-lg sm:p-7"
        }
      >
        <p
          className={
            company
              ? "text-xs font-black uppercase tracking-[.22em] text-blue-600"
              : "text-xs font-bold uppercase tracking-[.22em] text-indigo-200"
          }
        >
          {options?.eyebrow || "Workflow"}
        </p>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1
              className={
                company
                  ? "text-2xl font-black tracking-tight text-slate-950 sm:text-3xl"
                  : "text-2xl font-black tracking-tight sm:text-3xl"
              }
            >
              {title}
            </h1>
            {options?.description && (
              <p
                className={
                  company
                    ? "mt-2 max-w-3xl text-sm leading-6 text-slate-600"
                    : "mt-2 max-w-3xl text-sm leading-6 text-indigo-100"
                }
              >
                {options.description}
              </p>
            )}
          </div>
          {options?.showDashboard !== false && (
            <Link
              href={hrefFor(dashboardRoute)}
              className={
                company
                  ? "rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700"
                  : "rounded-xl border border-white/20 bg-white/10 px-4 py-2 text-sm font-bold hover:bg-white/20"
              }
            >
              {options?.dashboardLabel || "Dashboard"}
            </Link>
          )}
        </div>
      </header>
      {steps.length > 0 && (
        <nav
          aria-label={options?.navigationLabel || "Plugin workflow"}
          className={
            company
              ? "flex gap-2 overflow-x-auto rounded-2xl border border-slate-200 bg-white p-2 shadow-sm"
              : "flex gap-2 overflow-x-auto pb-1"
          }
        >
          {steps.map((step, index) => (
            <Link
              key={`${step.route}-${index}`}
              href={hrefFor(step.route)}
              className={`whitespace-nowrap border px-3 py-1.5 text-xs font-bold transition ${company ? "rounded-xl" : "rounded-full"} ${index === activeStep ? (company ? "border-slate-950 bg-slate-950 text-white shadow-sm" : "border-indigo-600 bg-indigo-600 text-white shadow-sm") : index < activeStep ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-white text-slate-500 hover:border-blue-300 hover:text-blue-700"}`}
            >
              <span aria-hidden="true">
                {index < activeStep ? "✓ " : `${index + 1}. `}
              </span>
              {step.label}
            </Link>
          ))}
        </nav>
      )}
      <section
        className={
          company
            ? "rounded-2xl border border-slate-200 bg-white px-5 py-4 text-slate-800 shadow-sm"
            : "rounded-2xl border border-sky-200 bg-sky-50/80 px-5 py-4 text-sky-950"
        }
        aria-label="Page guide"
      >
        <div className="flex gap-3">
          <span
            aria-hidden="true"
            className={
              company
                ? "mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-blue-600 text-sm font-black text-white"
                : "mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-sky-600 text-sm font-black text-white"
            }
          >
            ?
          </span>
          <div>
            <h2 className="font-bold">
              Page guide{currentStep ? ` · ${currentStep.label}` : ""}
            </h2>
            <p
              className={
                company
                  ? "mt-1 text-sm leading-6 text-slate-600"
                  : "mt-1 text-sm leading-6 text-sky-900"
              }
            >
              {guide}
            </p>
            {nextStep && (
              <Link
                href={hrefFor(nextStep.route)}
                className={
                  company
                    ? "mt-2 inline-flex text-sm font-bold text-blue-700 hover:text-blue-900"
                    : "mt-2 inline-flex text-sm font-bold text-sky-700 hover:text-sky-900"
                }
              >
                Continue to {nextStep.label} →
              </Link>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
