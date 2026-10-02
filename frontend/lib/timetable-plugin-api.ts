import { apiFetch } from './api'

const TIMETABLE_PLUGIN_API = '/api/plugin-api/wattanam.timetable'

export async function pluginTimetableFetch(path: string, options: RequestInit = {}) {
  if (!path.startsWith('/api/timetable')) return apiFetch(path, options)
  const suffix = path.slice('/api/timetable'.length)
  const resourceMatch = suffix.match(/^\/(subjects|classes|classrooms|teachers|lessons|entries)\/([^/]+)$/)
  const nestedMatch = suffix.match(/^\/([^/]+)\/(subjects|classes|classrooms|teachers|lessons|entries)$/)
  let endpoint: string
  let nextOptions = options
  if (
    suffix === '/teacher-attendance/mark' ||
    suffix === '/teacher-attendance/scan' ||
    suffix === '/teacher-attendance/wattaman-scan' ||
    suffix === '/scheduled-teachers/all'
  ) endpoint = `${TIMETABLE_PLUGIN_API}${suffix}`
  else if (resourceMatch) endpoint = `${TIMETABLE_PLUGIN_API}/${resourceMatch[1]}/${encodeURIComponent(resourceMatch[2])}`
  else if (nestedMatch) {
    endpoint = `${TIMETABLE_PLUGIN_API}/${nestedMatch[2]}`
    if (options.body && typeof options.body === 'string') {
      const body = JSON.parse(options.body)
      nextOptions = { ...options, body: JSON.stringify({ ...body, timetableId: nestedMatch[1] }) }
    }
  } else if (!suffix) endpoint = `${TIMETABLE_PLUGIN_API}/timetables`
  else endpoint = `${TIMETABLE_PLUGIN_API}/timetables${suffix}`
  return apiFetch(endpoint, nextOptions)
}
