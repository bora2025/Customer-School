"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiFetch } from "../../lib/api";
import { resolvePluginSourcePath } from "../../lib/plugin-ui-routing";

type Column = {
  id: string;
  label?: string;
  sortable?: boolean;
  filterable?: boolean;
  format?: string;
};
type Source = {
  id: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
};
type RowAction = {
  id: string;
  label: string;
  source: string;
  idField?: string;
  idParameter?: string;
  confirmation?: string;
  destructive?: boolean;
  body?: Record<string, unknown>;
};

function rowsFrom(value: unknown): Record<string, unknown>[] {
  const candidate = Array.isArray(value)
    ? value
    : value && typeof value === "object" && Array.isArray((value as any).items)
      ? (value as any).items
      : [];
  return candidate.filter(
    (row: unknown) => row && typeof row === "object" && !Array.isArray(row),
  ) as Record<string, unknown>[];
}

function display(value: unknown) {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function statusTone(value: unknown) {
  const status = String(value ?? "").toUpperCase();
  if (
    ["ACTIVE", "APPROVED", "PAID", "PRESENT", "COMPLETED", "RESOLVED"].includes(
      status,
    )
  )
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (["PENDING", "DRAFT", "ON_LEAVE", "LATE"].includes(status))
    return "border-amber-200 bg-amber-50 text-amber-700";
  if (
    [
      "INACTIVE",
      "TERMINATED",
      "REJECTED",
      "VOID",
      "ABSENT",
      "CANCELLED",
    ].includes(status)
  )
    return "border-red-200 bg-red-50 text-red-700";
  return "border-slate-200 bg-slate-50 text-slate-700";
}

function valueAtPath(row: Record<string, unknown>, dataPath: string) {
  return dataPath
    .split(".")
    .reduce<unknown>(
      (value, part) =>
        value && typeof value === "object"
          ? (value as Record<string, unknown>)[part]
          : undefined,
      row,
    );
}

export default function PluginDataTable({
  title,
  value,
  fields,
  options,
  loading,
  error,
  onSelectionChange,
  formatValue,
  pluginId,
  pageParams,
  sources = [],
  onRefresh,
}: {
  title?: string;
  value: unknown;
  fields?: Array<Record<string, unknown>>;
  options?: Record<string, unknown>;
  loading?: boolean;
  error?: string;
  onSelectionChange?(ids: string[]): void;
  formatValue?(value: unknown, kind?: string): string;
  pluginId?: string;
  pageParams?: Record<string, string>;
  sources?: Source[];
  onRefresh?(): void | Promise<void>;
}) {
  const router = useRouter();
  const sourceRows = useMemo(() => rowsFrom(value), [value]);
  const columns = useMemo<Column[]>(() => {
    if (fields?.length)
      return fields.map((field) => ({
        id: String(field.id),
        label: typeof field.label === "string" ? field.label : String(field.id),
        sortable: field.sortable !== false,
        filterable: field.filterable !== false,
        format: typeof field.format === "string" ? field.format : "text",
      }));
    return Object.keys(sourceRows[0] || {})
      .slice(0, 12)
      .map((id) => ({ id, label: id, sortable: true, filterable: true }));
  }, [fields, sourceRows]);
  const pageSize =
    typeof options?.pageSize === "number"
      ? Math.min(Math.max(Math.trunc(options.pageSize), 1), 100)
      : 10;
  const selectable = options?.selectable === true;
  const rowRoute =
    typeof options?.rowRoute === "string" ? options.rowRoute : "";
  const rowClickable = options?.rowClickable === true;
  const rowActionLabel =
    typeof options?.rowActionLabel === "string"
      ? options.rowActionLabel
      : "Open / Edit";
  const rowParameterMap =
    options?.rowParameterMap && typeof options.rowParameterMap === "object"
      ? (options.rowParameterMap as Record<string, string>)
      : {};
  const rowActions = Array.isArray(options?.rowActions)
    ? (options.rowActions as RowAction[])
    : [];
  const workforce = options?.variant === "workforce";
  const compactActions = options?.compactActions === true;
  const [filter, setFilter] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [columnFilters, setColumnFilters] = useState<Record<string, string>>(
    {},
  );
  const [sort, setSort] = useState<{
    id: string;
    direction: "asc" | "desc";
  } | null>(null);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [runningAction, setRunningAction] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  useEffect(() => {
    const available = new Set(
      sourceRows.map((row, index) => String(row.id ?? `1-${index}`)),
    );
    setSelected(
      (current) => new Set([...current].filter((id) => available.has(id))),
    );
  }, [sourceRows]);
  useEffect(() => {
    onSelectionChange?.([...selected]);
  }, [onSelectionChange, selected]);

  const filtered = useMemo(() => {
    const needle = filter.trim().toLocaleLowerCase();
    const result = sourceRows.filter((row) => {
      const matchesSearch =
        !needle ||
        columns.some(
          (column) =>
            column.filterable &&
            display(valueAtPath(row, column.id))
              .toLocaleLowerCase()
              .includes(needle),
        );
      const matchesColumns = Object.entries(columnFilters).every(
        ([id, expected]) =>
          !expected || display(valueAtPath(row, id)) === expected,
      );
      return matchesSearch && matchesColumns;
    });
    if (sort)
      result.sort(
        (left, right) =>
          display(valueAtPath(left, sort.id)).localeCompare(
            display(valueAtPath(right, sort.id)),
            undefined,
            { numeric: true },
          ) * (sort.direction === "asc" ? 1 : -1),
      );
    return result;
  }, [columns, columnFilters, filter, sort, sourceRows]);
  const filterColumns = useMemo(
    () =>
      columns
        .filter((column) => column.filterable)
        .map((column) => ({
          ...column,
          values: [
            ...new Set(
              sourceRows
                .map((row) => display(valueAtPath(row, column.id)))
                .filter((value) => value !== "—"),
            ),
          ].sort((left, right) =>
            left.localeCompare(right, undefined, { numeric: true }),
          ),
        }))
        .filter(
          (column) => column.values.length > 1 && column.values.length <= 30,
        )
        .slice(0, 6),
    [columns, sourceRows],
  );
  const activeFilterCount = Object.values(columnFilters).filter(Boolean).length;
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const visible = filtered.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  );
  const rowKey = (row: Record<string, unknown>, index: number) =>
    String(row.id ?? `${currentPage}-${index}`);
  const visibleKeys = visible.map(rowKey);
  const allVisibleSelected =
    visibleKeys.length > 0 && visibleKeys.every((key) => selected.has(key));

  function rowHref(row: Record<string, unknown>) {
    if (!rowRoute || !pluginId) return "";
    const resolved = rowRoute.replace(
      /:([a-z][a-zA-Z0-9]*)/g,
      (_match, name: string) => {
        const value =
          pageParams?.[name] ??
          (rowParameterMap[name]
            ? valueAtPath(row, rowParameterMap[name])
            : undefined);
        return value === undefined || value === null
          ? ""
          : encodeURIComponent(String(value));
      },
    );
    return resolved.split("/").some((segment) => !segment)
      ? ""
      : `/plugins/${encodeURIComponent(pluginId)}/${resolved}`;
  }

  function toggleAll() {
    setSelected((current) => {
      const next = new Set(current);
      if (allVisibleSelected) visibleKeys.forEach((key) => next.delete(key));
      else visibleKeys.forEach((key) => next.add(key));
      return next;
    });
  }

  async function invokeRowAction(
    action: RowAction,
    row: Record<string, unknown>,
    recordKey: string,
  ) {
    const source = sources.find((item) => item.id === action.source);
    const rawId = valueAtPath(row, action.idField || "id");
    if (!source || !pluginId || rawId === undefined || rawId === null)
      return setActionMessage("This action is unavailable.");
    if (action.confirmation && !window.confirm(action.confirmation)) return;
    const actionKey = `${recordKey}:${action.id}`;
    setRunningAction(actionKey);
    setActionMessage("");
    try {
      const sourceParams = {
        ...(pageParams || {}),
        [action.idParameter || "id"]: String(rawId),
      };
      const endpoint = `/api/plugin-api/${encodeURIComponent(pluginId)}/${resolvePluginSourcePath(source.path, sourceParams)}`;
      const response = await apiFetch(endpoint, {
        method: source.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(action.body || {}),
          [action.idField || "id"]: rawId,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(
          Array.isArray(result.message)
            ? result.message.join(" ")
            : result.message || `Request failed (${response.status})`,
        );
      setActionMessage(`${action.label} completed.`);
      await onRefresh?.();
    } catch (cause) {
      setActionMessage(
        cause instanceof Error
          ? cause.message
          : "The action could not be completed.",
      );
    } finally {
      setRunningAction("");
    }
  }

  if (loading)
    return (
      <section className="card p-6" aria-busy="true">
        <div className="h-5 w-40 animate-pulse rounded bg-slate-200" />
        <div className="mt-4 h-28 animate-pulse rounded bg-slate-100" />
        <span className="sr-only">Loading table</span>
      </section>
    );
  if (error)
    return (
      <section className="card border-red-200 p-6" role="alert">
        <div className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className="grid h-9 w-9 place-items-center rounded-full bg-red-100 font-bold text-red-700"
          >
            !
          </span>
          <div>
            <h2 className="font-semibold text-red-800">
              {title || "Table"} could not be loaded
            </h2>
            <p className="mt-1 text-sm text-red-700">{error}</p>
            <p className="mt-2 text-xs text-red-600">
              Refresh the page. If this continues, check plugin permissions and
              runtime status.
            </p>
          </div>
        </div>
      </section>
    );

  return (
    <section className="card overflow-hidden border-slate-200 shadow-sm">
      {workforce && (
        <div className="grid gap-3 border-b border-slate-200 bg-slate-50/70 p-5 sm:grid-cols-2 xl:grid-cols-4">
          {[
            ["Total workforce", sourceRows.length, "bg-blue-600"],
            [
              "Active",
              sourceRows.filter((row) => row.employmentStatus === "ACTIVE")
                .length,
              "bg-emerald-500",
            ],
            [
              "On leave",
              sourceRows.filter((row) => row.employmentStatus === "ON_LEAVE")
                .length,
              "bg-amber-500",
            ],
            [
              "Leadership",
              sourceRows.filter((row) => row.employmentType === "EMPLOYER")
                .length,
              "bg-violet-500",
            ],
          ].map(([label, total, tone]) => (
            <div
              key={String(label)}
              className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
            >
              <div className="flex items-center justify-between">
                <p className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  {label}
                </p>
                <span className={`h-2.5 w-2.5 rounded-full ${tone}`} />
              </div>
              <p className="mt-2 text-2xl font-black tracking-tight text-slate-950">
                {total}
              </p>
            </div>
          ))}
        </div>
      )}
      <div
        className={`flex flex-col gap-4 border-b border-slate-200 p-5 sm:flex-row sm:items-center sm:justify-between ${workforce ? "bg-white" : "bg-gradient-to-r from-white via-white to-indigo-50/50"}`}
      >
        <div className="flex items-center gap-3">
          <span
            className={`grid h-10 w-10 place-items-center rounded-xl text-lg ${workforce ? "bg-slate-950 text-white" : "bg-indigo-100 text-indigo-700"}`}
            aria-hidden="true"
          >
            ▦
          </span>
          <div>
            <h2 className="font-bold text-slate-900">{title || "Records"}</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              {workforce
                ? "People, roles, teams, and employment status"
                : `${sourceRows.length} total record${sourceRows.length === 1 ? "" : "s"}`}
              {selectable && selected.size > 0
                ? ` · ${selected.size} selected`
                : ""}
            </p>
          </div>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <label className="relative block text-sm text-slate-600">
            <span className="sr-only">Search records</span>
            <span
              className="pointer-events-none absolute left-3 top-2.5 text-slate-400"
              aria-hidden="true"
            >
              ⌕
            </span>
            <input
              className="w-full min-w-64 rounded-xl border border-slate-300 bg-white py-2 pl-9 pr-3 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
              placeholder={
                workforce
                  ? "Search people, roles, or teams…"
                  : "Search records…"
              }
              value={filter}
              onChange={(event) => {
                setFilter(event.target.value);
                setPage(1);
              }}
              type="search"
            />
          </label>
          {filterColumns.length > 0 && (
            <button
              type="button"
              className={`btn btn-secondary whitespace-nowrap ${activeFilterCount ? "border-indigo-300 bg-indigo-50 text-indigo-700" : ""}`}
              onClick={() => setFiltersOpen((value) => !value)}
              aria-expanded={filtersOpen}
            >
              ☷ Filters{activeFilterCount ? ` (${activeFilterCount})` : ""}
            </button>
          )}
        </div>
      </div>
      {filtersOpen && filterColumns.length > 0 && (
        <div className="border-b border-slate-200 bg-slate-50/80 px-5 py-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {filterColumns.map((column) => (
              <label
                key={column.id}
                className="text-xs font-semibold text-slate-600"
              >
                {column.label}
                <select
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal text-slate-800"
                  value={columnFilters[column.id] || ""}
                  onChange={(event) => {
                    setColumnFilters((current) => ({
                      ...current,
                      [column.id]: event.target.value,
                    }));
                    setPage(1);
                  }}
                >
                  <option value="">All</option>
                  {column.values.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          {activeFilterCount > 0 && (
            <button
              type="button"
              className="mt-3 text-xs font-bold text-indigo-700 hover:underline"
              onClick={() => {
                setColumnFilters({});
                setPage(1);
              }}
            >
              Clear all filters
            </button>
          )}
        </div>
      )}
      {sourceRows.length === 0 ? (
        <div className="p-12 text-center">
          <div
            className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-slate-100 text-xl text-slate-400"
            aria-hidden="true"
          >
            ◇
          </div>
          <h3 className="mt-4 font-semibold text-slate-800">No records yet</h3>
          <p className="mt-1 text-sm text-slate-500">
            Create the first record using the form on this page.
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="p-12 text-center">
          <h3 className="font-semibold text-slate-800">No matching records</h3>
          <p className="mt-1 text-sm text-slate-500">
            Clear or change the filter to see more results.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50">
              <tr>
                {selectable && (
                  <th className="w-12 px-4 py-3">
                    <input
                      aria-label="Select all visible rows"
                      type="checkbox"
                      checked={allVisibleSelected}
                      onChange={toggleAll}
                    />
                  </th>
                )}
                {columns.map((column) => (
                  <th
                    key={column.id}
                    scope="col"
                    aria-sort={
                      column.sortable && sort?.id === column.id
                        ? sort.direction === "asc"
                          ? "ascending"
                          : "descending"
                        : undefined
                    }
                    className="px-4 py-3 text-left font-semibold text-slate-700"
                  >
                    {column.sortable ? (
                      <button
                        type="button"
                        className="inline-flex items-center gap-1"
                        onClick={() =>
                          setSort((current) => ({
                            id: column.id,
                            direction:
                              current?.id === column.id &&
                              current.direction === "asc"
                                ? "desc"
                                : "asc",
                          }))
                        }
                        aria-label={`Sort by ${column.label}${sort?.id === column.id ? `, currently ${sort.direction === "asc" ? "ascending" : "descending"}` : ""}`}
                      >
                        {column.label}
                        {sort?.id === column.id
                          ? sort.direction === "asc"
                            ? " ↑"
                            : " ↓"
                          : ""}
                      </button>
                    ) : (
                      column.label
                    )}
                  </th>
                ))}
                {(rowRoute || rowActions.length > 0) && (
                  <th
                    scope="col"
                    className="px-4 py-3 text-right font-semibold text-slate-700"
                  >
                    Actions
                  </th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {visible.map((row, index) => {
                const key = rowKey(row, index);
                const href = rowHref(row);
                const clickable = Boolean(href && rowClickable);
                return (
                  <tr
                    key={key}
                    tabIndex={clickable ? 0 : undefined}
                    aria-label={
                      clickable
                        ? `Open ${display(row.fullName ?? row.name ?? row.employeeNumber ?? "record")}`
                        : undefined
                    }
                    onClick={
                      clickable
                        ? (event) => {
                            if (
                              !(event.target as HTMLElement).closest(
                                "a,button,input,select,textarea",
                              )
                            )
                              router.push(href);
                          }
                        : undefined
                    }
                    onKeyDown={
                      clickable
                        ? (event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              router.push(href);
                            }
                          }
                        : undefined
                    }
                    className={`${selected.has(key) ? "bg-indigo-50" : ""} ${clickable ? "cursor-pointer transition hover:bg-indigo-50/70 focus:bg-indigo-50 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-indigo-500" : ""}`}
                  >
                    {selectable && (
                      <td className="px-4 py-3">
                        <input
                          aria-label={`Select row ${index + 1}`}
                          type="checkbox"
                          checked={selected.has(key)}
                          onChange={() =>
                            setSelected((current) => {
                              const next = new Set(current);
                              if (next.has(key)) next.delete(key);
                              else next.add(key);
                              return next;
                            })
                          }
                        />
                      </td>
                    )}
                    {columns.map((column) => {
                      const raw = valueAtPath(row, column.id);
                      const content = formatValue
                        ? formatValue(raw, column.format)
                        : display(raw);
                      const status = /status|active/i.test(column.id);
                      const rendered = status ? (
                        <span
                          className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-bold tracking-wide ${statusTone(raw)}`}
                        >
                          {content}
                        </span>
                      ) : (
                        content
                      );
                      const workforceName =
                        workforce && column.id === "fullName";
                      const photo =
                        typeof row.photoUrl === "string" ? row.photoUrl : "";
                      const name = display(row.fullName);
                      const cell = workforceName ? (
                        <span className="flex items-center gap-3">
                          {photo ? (
                            <img
                              src={photo}
                              alt=""
                              className="h-11 w-11 rounded-xl border border-slate-200 object-cover"
                            />
                          ) : (
                            <span
                              aria-hidden="true"
                              className="grid h-11 w-11 place-items-center rounded-xl bg-slate-100 text-sm font-black text-slate-600"
                            >
                              {name.slice(0, 2).toUpperCase()}
                            </span>
                          )}
                          <span className="min-w-0">
                            <strong className="block truncate text-slate-950">
                              {name}
                            </strong>
                            <span className="block text-xs text-slate-500">
                              {display(row.email ?? row.employeeNumber)}
                            </span>
                          </span>
                        </span>
                      ) : (
                        rendered
                      );
                      return (
                        <td
                          key={column.id}
                          className="max-w-sm px-4 py-3.5 text-slate-700"
                        >
                          {href ? (
                            <Link
                              className="block rounded-sm hover:text-indigo-700 hover:underline focus:outline-none focus:ring-2 focus:ring-indigo-500"
                              href={href}
                            >
                              {cell}
                            </Link>
                          ) : (
                            cell
                          )}
                        </td>
                      );
                    })}
                    {(rowRoute || rowActions.length > 0) && (
                      <td className="whitespace-nowrap px-4 py-3 text-right">
                        <div className="inline-flex items-center justify-end gap-2">
                          {rowRoute &&
                            (href ? (
                              <Link
                                className={`inline-flex items-center rounded-lg text-xs font-bold transition ${compactActions ? "border border-slate-200 bg-white p-2.5 text-slate-700 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700" : "bg-indigo-50 px-3 py-2 text-indigo-700 hover:bg-indigo-600 hover:text-white"}`}
                                href={href}
                                aria-label={`${rowActionLabel} ${display(row.fullName ?? row.name ?? row.employeeNumber ?? "record")}`}
                                title={rowActionLabel}
                              >
                                {compactActions ? (
                                  <svg
                                    aria-hidden="true"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="1.8"
                                    className="h-4 w-4"
                                  >
                                    <path
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                      d="M14 3h7v7M10 14 21 3M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"
                                    />
                                  </svg>
                                ) : (
                                  <>{rowActionLabel} →</>
                                )}
                              </Link>
                            ) : (
                              <span className="text-xs text-slate-400">
                                Unavailable
                              </span>
                            ))}
                          {rowActions.map((action) => {
                            const actionKey = `${key}:${action.id}`;
                            return (
                              <button
                                key={action.id}
                                type="button"
                                disabled={Boolean(runningAction)}
                                aria-label={`${action.label} ${display(row.fullName ?? row.name ?? row.employeeNumber ?? "record")}`}
                                title={action.label}
                                className={
                                  compactActions && action.destructive
                                    ? "inline-flex items-center rounded-lg border border-red-200 bg-white p-2.5 text-red-600 transition hover:bg-red-50 disabled:opacity-50"
                                    : action.destructive
                                      ? "inline-flex items-center rounded-lg border border-red-200 bg-white px-3 py-2 text-xs font-bold text-red-700 transition hover:bg-red-600 hover:text-white disabled:opacity-50"
                                      : "inline-flex items-center rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 transition hover:bg-slate-900 hover:text-white disabled:opacity-50"
                                }
                                onClick={() =>
                                  invokeRowAction(action, row, key)
                                }
                              >
                                {runningAction === actionKey ? (
                                  "…"
                                ) : compactActions && action.destructive ? (
                                  <svg
                                    aria-hidden="true"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="1.8"
                                    className="h-4 w-4"
                                  >
                                    <path
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                      d="M3 6h18M8 6V4h8v2m3 0-1 14H6L5 6m5 5v5m4-5v5"
                                    />
                                  </svg>
                                ) : (
                                  action.label
                                )}
                              </button>
                            );
                          })}
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {actionMessage && (
        <div
          className={`border-t px-5 py-3 text-sm ${/completed/i.test(actionMessage) ? "border-emerald-100 bg-emerald-50 text-emerald-700" : "border-red-100 bg-red-50 text-red-700"}`}
          role="status"
        >
          {actionMessage}
        </div>
      )}
      <div className="flex flex-col gap-3 border-t border-slate-200 bg-slate-50/70 px-5 py-4 text-sm text-slate-600 sm:flex-row sm:items-center sm:justify-between">
        <span>
          Showing {visible.length} of {filtered.length} record
          {filtered.length === 1 ? "" : "s"}
        </span>
        <div className="flex items-center gap-2">
          <button
            className="btn btn-secondary"
            disabled={currentPage <= 1}
            onClick={() => setPage((value) => Math.max(1, value - 1))}
          >
            ← Previous
          </button>
          <span className="rounded-lg bg-white px-3 py-2 font-medium shadow-sm">
            Page {currentPage} of {pageCount}
          </span>
          <button
            className="btn btn-secondary"
            disabled={currentPage >= pageCount}
            onClick={() => setPage((value) => Math.min(pageCount, value + 1))}
          >
            Next →
          </button>
        </div>
      </div>
    </section>
  );
}
