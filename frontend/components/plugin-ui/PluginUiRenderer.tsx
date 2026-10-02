'use client';

import PluginDataTable from './PluginDataTable';
import PluginForm from './PluginForm';
import PluginActions from './PluginActions';
import { useCallback, useState } from 'react';
import { PluginCard, PluginChart, PluginMetric, PluginStatus } from './PluginDashboard';
import PluginFiles from './PluginFiles';
import PluginPrintExport from './PluginPrintExport';
import PluginDocumentPreview from './PluginDocumentPreview';
import PluginDocumentDesigner from './PluginDocumentDesigner';
import { usePluginUiRealtime } from '../../lib/plugin-ui-realtime';
import PluginScanner from './PluginScanner';
import PluginQueryFilter from './PluginQueryFilter';
import { usePluginUiPresentation } from '../../lib/plugin-ui-presentation';
import type { PluginUiPageDescriptor } from '../../lib/plugin-ui-routing';

function valueAtPath(value: unknown, path?: string) {
  if (!path) return value;
  return path.split('.').reduce<unknown>((current, key) => current && typeof current === 'object' ? (current as Record<string, unknown>)[key] : undefined, value);
}

export default function PluginUiRenderer({ pluginId, page, params, data, loading, errors, onRefresh, onQueryFilters }: { pluginId: string; page: PluginUiPageDescriptor; params: Record<string, string>; data: Record<string, unknown>; loading: boolean; errors: Record<string, string>; onRefresh(): void | Promise<void>; onQueryFilters(sources: string[], values: Record<string, string>): void | Promise<void> }) {
  const [selections, setSelections] = useState<Record<string, string[]>>({});
  const [mutationResults, setMutationResults] = useState<Record<string, unknown>>({});
  const renderedData = { ...data, ...mutationResults };
  const presentation = usePluginUiPresentation(page);
  usePluginUiRealtime(pluginId, page.realtime, onRefresh);
  const updateSelection = useCallback((source: string, ids: string[]) => setSelections((current) => {
    if ((current[source] || []).join('\0') === ids.join('\0')) return current;
    return { ...current, [source]: ids };
  }), []);
  return <div className="space-y-5">{page.components.map((component: any) => {
    const localized = { ...component, title: presentation.translate(component.titleKey, component.title), fields: component.fields?.map((field: any) => ({ ...field, label: presentation.translate(field.labelKey, field.label) })), options: { ...component.options, submitLabel: presentation.translate(component.options?.submitLabelKey, component.options?.submitLabel), confirmation: presentation.translate(component.options?.confirmationKey, component.options?.confirmation), successMessage: presentation.translate(component.options?.successMessageKey, component.options?.successMessage), actions: component.options?.actions?.map((action: any) => ({ ...action, label: presentation.translate(action.labelKey, action.label), confirmation: presentation.translate(action.confirmationKey, action.confirmation) })), states: component.options?.states?.map((state: any) => ({ ...state, label: presentation.translate(state.labelKey, state.label) })) } }; component = localized;
    if (component.type === 'table') return <PluginDataTable key={component.id} title={component.title} value={component.source ? renderedData[component.source] : []} fields={component.fields} options={component.options} loading={loading} error={component.source ? errors[component.source] : undefined} onSelectionChange={component.source ? (ids) => updateSelection(component.source, ids) : undefined} formatValue={presentation.format} pluginId={pluginId} pageParams={params} />;
    if (component.type === 'form') { const source = page.dataSources.find((entry) => entry.id === component.source); const initialSource = component.options?.initialSource; return source && source.method !== 'GET' && source.method !== 'DELETE' ? <PluginForm key={component.id} pluginId={pluginId} source={source as any} params={params} fields={component.fields || []} options={component.options as any} initialData={typeof initialSource === 'string' ? renderedData[initialSource] : undefined} onSuccess={async (result) => { setMutationResults((current) => ({ ...current, [source.id]: result })); await onRefresh(); }} /> : null; }
    if (component.type === 'actions') return <PluginActions key={component.id} pluginId={pluginId} sources={page.dataSources.filter((entry) => entry.method !== 'GET') as any} params={params} actions={(component.options?.actions || []) as any} selections={selections} onSuccess={onRefresh} />;
    if (component.type === 'metric') return <PluginMetric key={component.id} title={component.title} value={data[component.source]} options={component.options} loading={loading} error={errors[component.source]} formatValue={presentation.format} />;
    if (component.type === 'status') return <PluginStatus key={component.id} title={component.title} value={data[component.source]} options={component.options} loading={loading} error={errors[component.source]} />;
    if (component.type === 'detail') return <PluginCard key={component.id} title={component.title} value={data[component.source]} fields={component.fields || []} loading={loading} error={errors[component.source]} formatValue={presentation.format} />;
    if (component.type === 'card') return <PluginCard key={component.id} title={component.title} value={data[component.source]} fields={component.fields || []} loading={loading} error={errors[component.source]} formatValue={presentation.format} />;
    if (component.type === 'chart') return <PluginChart key={component.id} title={component.title} value={data[component.source]} options={component.options} loading={loading} error={errors[component.source]} />;
    if (component.type === 'file') return <PluginFiles key={component.id} pluginId={pluginId} value={data[component.source]} sources={page.dataSources} params={params} options={component.options} loading={loading} error={errors[component.source]} onRefresh={onRefresh} />;
    if (component.type === 'print') return <PluginPrintExport key={component.id} title={component.title} value={valueAtPath(renderedData[component.source], component.options?.itemsPath)} fields={component.fields || []} options={component.options} loading={loading} error={errors[component.source]} />;
    if (component.type === 'document') return <PluginDocumentPreview key={component.id} pluginId={pluginId} title={component.title} value={valueAtPath(renderedData[component.source], component.options?.documentsPath)} options={component.options} loading={loading} error={errors[component.source]} />;
    if (component.type === 'designer') return <PluginDocumentDesigner key={component.id} pluginId={pluginId} title={component.title} value={renderedData[component.source]} assets={component.options?.assetSource ? renderedData[component.options.assetSource] : []} sources={page.dataSources} params={params} options={component.options} loading={loading} error={errors[component.source]} onSaved={onRefresh} />;
    if (component.type === 'scanner') { const source = page.dataSources.find((entry) => entry.id === component.source); return source && source.method !== 'GET' && source.method !== 'DELETE' ? <PluginScanner key={component.id} pluginId={pluginId} source={source} params={params} options={component.options} onSuccess={onRefresh} /> : null; }
    if (component.type === 'filter') return <PluginQueryFilter key={component.id} fields={component.fields || []} options={component.options} onApply={onQueryFilters} />;
    if (component.type === 'heading') return <h2 key={component.id} className="text-xl font-semibold text-slate-800">{component.title}</h2>;
    if (component.type === 'text') return <p key={component.id} className="text-sm text-slate-600">{component.title}</p>;
    return <section key={component.id} className="card p-5 text-sm text-slate-500">{component.title || component.type} will be rendered by its LC3 component.</section>;
  })}</div>;
}
