import { mockIPC, mockWindows } from '@tauri-apps/api/mocks'
import {
  getPreviewGameCatalog,
  getPreviewInitialQuery,
  getPreviewSummary,
  getPreviewSymbolDetail,
  getPreviewWorkspaceDocument,
  getPreviewWorkspaceSummaries,
  searchPreviewSymbols,
  type PreviewScenario,
} from './previewData'

const previewParamKey = 'preview'
const allowedPreviewScenarios = new Set<PreviewScenario>([
  'main',
  'relation',
  'framework',
  'workspace',
  'games',
])

let previewInitialized = false
let previewMaximized = false
let previewFetchInstalled = false

function asPreviewPayload(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function parsePreviewScenario(rawValue: string | null): PreviewScenario | null {
  if (!rawValue || !allowedPreviewScenarios.has(rawValue as PreviewScenario)) {
    return null
  }

  return rawValue as PreviewScenario
}

export function getPreviewScenario(): PreviewScenario | null {
  if (typeof window === 'undefined') {
    return null
  }

  return parsePreviewScenario(new URLSearchParams(window.location.search).get(previewParamKey))
}

export function initializePreviewMode() {
  const scenario = getPreviewScenario()
  if (!scenario || previewInitialized || typeof window === 'undefined') {
    return scenario
  }

  previewInitialized = true
  ;(globalThis as typeof globalThis & { isTauri?: boolean }).isTauri = true

  try {
    window.localStorage.setItem('dumpview:theme', 'dark')
    window.localStorage.setItem('dumpview:preview-query', getPreviewInitialQuery(scenario))
  } catch {
    // Ignore preview storage errors and continue with in-memory mocks.
  }

  mockWindows('main')
  mockIPC(
    (command, payload) => {
      const previewPayload = asPreviewPayload(payload)

      switch (command) {
        case 'load_sample_dump':
          return getPreviewSummary(scenario)
        case 'load_dump_payload':
          return getPreviewSummary(scenario)
        case 'search_symbols':
          return searchPreviewSymbols(
            typeof previewPayload.query === 'string' ? previewPayload.query : '',
            typeof previewPayload.limit === 'number' ? previewPayload.limit : 120,
          )
        case 'list_node_workspaces':
          return getPreviewWorkspaceSummaries()
        case 'load_node_workspace': {
          const workspaceId =
            typeof previewPayload.workspaceId === 'string' ? previewPayload.workspaceId : ''
          const document = getPreviewWorkspaceDocument(workspaceId)
          if (!document) {
            throw new Error(`Preview workspace is unavailable for ${workspaceId}`)
          }
          return document
        }
        case 'get_symbol_detail': {
          const detail = typeof previewPayload.name === 'string'
            ? getPreviewSymbolDetail(previewPayload.name)
            : null
          if (!detail) {
            throw new Error(`Preview detail is unavailable for ${String(previewPayload.name)}`)
          }
          return detail
        }
        case 'plugin:window|is_maximized':
          return previewMaximized
        case 'plugin:window|toggle_maximize':
          previewMaximized = !previewMaximized
          return null
        case 'plugin:window|minimize':
        case 'plugin:window|close':
        case 'plugin:window|start_dragging':
          return null
        default:
          throw new Error(`Unsupported preview IPC command: ${command}`)
      }
    },
    { shouldMockEvents: true },
  )

  if (!previewFetchInstalled) {
    previewFetchInstalled = true
    const nativeFetch = window.fetch.bind(window)

    window.fetch = async (input, init) => {
      const requestUrl =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url

      if (
        requestUrl ===
        'https://raw.githubusercontent.com/Spuckwaffel/dumpspace/main/Games/GameList.json'
      ) {
        return new Response(JSON.stringify(getPreviewGameCatalog()), {
          status: 200,
          headers: {
            'content-type': 'application/json',
          },
        })
      }

      return nativeFetch(input, init)
    }
  }

  return scenario
}
