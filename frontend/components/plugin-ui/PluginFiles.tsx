'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '../../lib/api';
import { resolvePluginSourcePath } from '../../lib/plugin-ui-routing';

type Source = { id: string; method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; path: string };
type Item = { id: string; name: string; mimeType: string; size?: number };

function items(value: unknown): Item[] {
  const rows = Array.isArray(value) ? value : value && typeof value === 'object' && Array.isArray((value as any).items) ? (value as any).items : [];
  return rows.filter((item: any) => item && typeof item.id === 'string' && typeof item.name === 'string' && typeof item.mimeType === 'string');
}

function base64ToBlob(base64: string, mimeType: string) {
  const binary = atob(base64); const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes.buffer as ArrayBuffer], { type: mimeType });
}

export default function PluginFiles({ pluginId, value, sources, params, options, loading, error, onRefresh }: any) {
  const [busy, setBusy] = useState(''); const [message, setMessage] = useState('');
  const [preview, setPreview] = useState<{ url: string; mimeType: string; name: string } | null>(null);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview.url); }, [preview]);
  const rows = items(value);
  const uploadSource = sources.find((source: Source) => source.id === options.uploadSource);
  const downloadSource = sources.find((source: Source) => source.id === options.downloadSource);
  const deleteSource = sources.find((source: Source) => source.id === options.deleteSource);

  async function filePayload(item: Item) {
    if (!downloadSource) throw new Error('Download source is unavailable.');
    const endpoint = `/api/plugin-api/${encodeURIComponent(pluginId)}/${resolvePluginSourcePath(downloadSource.path, { ...params, [options.idParameter]: item.id })}`;
    const response = await apiFetch(endpoint); const result = await response.json().catch(() => ({}));
    if (!response.ok || typeof result.dataBase64 !== 'string') throw new Error(result.message || 'File download failed.');
    return { blob: base64ToBlob(result.dataBase64, item.mimeType), name: typeof result.name === 'string' ? result.name : item.name };
  }

  async function upload(file?: File) {
    if (!file || !uploadSource) return;
    setMessage('');
    if (!options.acceptedTypes.includes(file.type)) return setMessage('This file type is not allowed.');
    if (file.size > options.maxBytes) return setMessage(`The file exceeds the ${options.maxBytes} byte limit.`);
    setBusy('upload');
    try {
      const dataBase64 = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onerror = () => reject(new Error('File could not be read.')); reader.onload = () => resolve(String(reader.result).split(',')[1] || ''); reader.readAsDataURL(file); });
      const endpoint = `/api/plugin-api/${encodeURIComponent(pluginId)}/${resolvePluginSourcePath(uploadSource.path, params)}`;
      const response = await apiFetch(endpoint, { method: uploadSource.method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: file.name, mimeType: file.type, size: file.size, dataBase64 }) });
      const result = await response.json().catch(() => ({})); if (!response.ok) throw new Error(result.message || 'Upload failed.');
      setMessage('Upload completed.'); await onRefresh();
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Upload failed.'); } finally { setBusy(''); }
  }

  async function open(item: Item, asPreview: boolean) {
    setBusy(item.id); setMessage('');
    try { const payload = await filePayload(item); const url = URL.createObjectURL(payload.blob);
      if (asPreview) { if (preview) URL.revokeObjectURL(preview.url); setPreview({ url, mimeType: item.mimeType, name: item.name }); }
      else { const anchor = document.createElement('a'); anchor.href = url; anchor.download = payload.name; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : 'File request failed.'); } finally { setBusy(''); }
  }

  async function remove(item: Item) {
    if (!deleteSource || !window.confirm(`Delete ${item.name}?`)) return;
    setBusy(item.id); setMessage('');
    try { const endpoint = `/api/plugin-api/${encodeURIComponent(pluginId)}/${resolvePluginSourcePath(deleteSource.path, { ...params, [options.idParameter]: item.id })}`; const response = await apiFetch(endpoint, { method: 'DELETE' }); const result = await response.json().catch(() => ({})); if (!response.ok) throw new Error(result.message || 'Delete failed.'); setMessage('File deleted.'); await onRefresh(); }
    catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Delete failed.'); } finally { setBusy(''); }
  }

  if (loading) return <section className="card p-6" aria-busy="true">Loading files…</section>;
  if (error) return <section className="card border-red-200 p-6 text-red-700" role="alert">{error}</section>;
  return <section className="card p-5"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-semibold text-slate-800">Files</h2><label className="btn btn-primary cursor-pointer">{busy === 'upload' ? 'Uploading…' : 'Upload file'}<input className="sr-only" type="file" accept={options.acceptedTypes.join(',')} disabled={Boolean(busy)} onChange={(event) => { upload(event.target.files?.[0]); event.target.value = ''; }} /></label></div>
    {message && <p className="mt-3 text-sm text-slate-700" role="status">{message}</p>}
    {!rows.length ? <p className="py-8 text-center text-sm text-slate-500">No files uploaded.</p> : <ul className="mt-4 divide-y divide-slate-100">{rows.map((item) => <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 py-3"><div><p className="font-medium text-slate-800">{item.name}</p><p className="text-xs text-slate-500">{item.mimeType}{item.size !== undefined ? ` · ${item.size} bytes` : ''}</p></div><div className="flex gap-2"><button className="btn btn-secondary" disabled={Boolean(busy)} onClick={() => open(item, true)}>Preview</button><button className="btn btn-secondary" disabled={Boolean(busy)} onClick={() => open(item, false)}>Download</button>{deleteSource && <button className="btn bg-red-600 text-white" disabled={Boolean(busy)} onClick={() => remove(item)}>Delete</button>}</div></li>)}</ul>}
    {preview && <div className="mt-5 border-t border-slate-200 pt-5"><div className="mb-3 flex justify-between"><h3 className="font-semibold">Preview: {preview.name}</h3><button onClick={() => { URL.revokeObjectURL(preview.url); setPreview(null); }}>Close</button></div>{preview.mimeType.startsWith('image/') ? <img className="max-h-96 max-w-full rounded border" src={preview.url} alt={preview.name} /> : preview.mimeType === 'application/pdf' ? <object className="h-96 w-full border" data={preview.url} type="application/pdf"><a href={preview.url}>Open PDF</a></object> : <iframe className="h-72 w-full border" sandbox="" src={preview.url} title={`Preview ${preview.name}`} />}</div>}
  </section>;
}
