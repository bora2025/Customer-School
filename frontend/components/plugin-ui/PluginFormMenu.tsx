'use client';

import { useEffect, useRef, useState } from 'react';
import PluginForm from './PluginForm';

type Source = { id: string; method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; path: string };
type FormComponent = {
  id: string;
  title?: string;
  source?: string;
  fields?: Array<Record<string, unknown>>;
  options?: Record<string, any>;
};

export default function PluginFormMenu({ pluginId, params, forms, sources, data, onSuccess }: {
  pluginId: string;
  params: Record<string, string>;
  forms: FormComponent[];
  sources: Source[];
  data: Record<string, unknown>;
  onSuccess(sourceId: string, result: unknown): void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [activeId, setActiveId] = useState('');
  const container = useRef<HTMLDivElement>(null);
  const active = forms.find((form) => form.id === activeId);
  const groupOptions = forms[0]?.options || {};

  useEffect(() => {
    function dismiss(event: MouseEvent) {
      if (container.current && !container.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', dismiss);
    return () => document.removeEventListener('mousedown', dismiss);
  }, []);

  function choose(id: string) {
    setActiveId(id);
    setOpen(false);
  }

  return <div className="space-y-4">
    <section className="card border-slate-200 bg-gradient-to-r from-white via-white to-indigo-50/70 p-5 shadow-sm">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-xl bg-indigo-100 text-xl font-bold text-indigo-700" aria-hidden="true">＋</span>
          <div><h2 className="text-lg font-bold text-slate-950">{groupOptions.actionMenuTitle || 'Student actions'}</h2><p className="mt-1 text-sm text-slate-500">{groupOptions.actionMenuDescription || 'Create one record or import multiple records from a file.'}</p></div>
        </div>
        <div className="relative" ref={container}>
          <button type="button" className="btn btn-primary min-w-44 shadow-sm" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((value) => !value)}>＋ {groupOptions.actionMenuLabel || 'Add record'} <span aria-hidden="true">⌄</span></button>
          {open && <div role="menu" className="absolute right-0 z-20 mt-2 w-80 overflow-hidden rounded-xl border border-slate-200 bg-white p-2 shadow-xl">
            {forms.map((form) => <button key={form.id} type="button" role="menuitem" className="flex w-full items-start gap-3 rounded-lg px-3 py-3 text-left transition hover:bg-indigo-50 focus:bg-indigo-50 focus:outline-none" onClick={() => choose(form.id)}><span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-indigo-100 font-bold text-indigo-700" aria-hidden="true">{form.options?.actionMenuIcon || '＋'}</span><span><span className="block font-semibold text-slate-900">{form.options?.triggerLabel || form.title}</span><span className="mt-0.5 block text-xs leading-5 text-slate-500">{form.options?.actionDescription || 'Open this guided form.'}</span></span></button>)}
          </div>}
        </div>
      </div>
    </section>
    {active && (() => {
      const source = sources.find((entry) => entry.id === active.source);
      const initialSource = active.options?.initialSource;
      if (!source || source.method === 'GET' || source.method === 'DELETE') return null;
      return <PluginForm key={active.id} title={active.title} pluginId={pluginId} source={source as any} params={params} fields={(active.fields || []) as any} options={{ ...active.options, collapsible: true, defaultCollapsed: false }} initialData={typeof initialSource === 'string' ? data[initialSource] : undefined} onSuccess={(result) => onSuccess(source.id, result)} />;
    })()}
  </div>;
}
