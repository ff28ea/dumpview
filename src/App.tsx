import {
  startTransition,
  useDeferredValue,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import './App.css'
import FrameworkGraphModal from './FrameworkGraphModal'

type SymbolKind = 'class' | 'struct' | 'enum'
type KindFilter = 'all' | SymbolKind

interface OffsetEntry {
  key: string
  value: string
}

interface LoadSummary {
  sourceLabel: string
  symbolCount: number
  classCount: number
  structCount: number
  enumCount: number
  functionOwnerCount: number
  methodCount: number
  relationCount: number
  offsets: OffsetEntry[]
  landingSymbol: string | null
}

interface SearchResult {
  name: string
  kind: SymbolKind
  parent: string | null
  size: number | null
  fieldCount: number
  methodCount: number
  relationCount: number
  childCount: number
  subtitle: string
}

interface SymbolLink {
  name: string
  kind: SymbolKind
}

interface FieldInfo {
  name: string
  typeDisplay: string
  offset: number | null
  size: number | null
  arrayDim: number | null
  links: SymbolLink[]
}

interface ParameterInfo {
  name: string
  typeDisplay: string
  links: SymbolLink[]
}

interface MethodInfo {
  name: string
  returnType: string
  returnLinks: SymbolLink[]
  parameters: ParameterInfo[]
  address: number | null
  flags: string
}

interface EnumValueInfo {
  name: string
  value: string
}

interface RelationInfo {
  name: string
  kind: SymbolKind
  relation: string
  via: string
}

interface SymbolDetail {
  name: string
  kind: SymbolKind
  size: number | null
  parent: string | null
  parents: SymbolLink[]
  directChildren: SymbolLink[]
  fields: FieldInfo[]
  methods: MethodInfo[]
  enumValues: EnumValueInfo[]
  underlyingType: string | null
  related: RelationInfo[]
  incomingRefs: RelationInfo[]
  fieldCount: number
  methodCount: number
  relationCount: number
  childCount: number
}

interface DumpImportPayload {
  sourceLabel: string
  classesJson: string
  structsJson: string
  functionsJson: string
  enumsJson: string
  offsetsJson: string | null
}

const directoryInputProps = {
  webkitdirectory: '',
  directory: '',
} as Record<string, string>

const requiredDumpFiles = [
  'ClassesInfo.json',
  'StructsInfo.json',
  'FunctionsInfo.json',
  'EnumsInfo.json',
] as const

const kindLabels: Record<KindFilter, string> = {
  all: 'All',
  class: 'Class',
  struct: 'Struct',
  enum: 'Enum',
}

const relationLabels: Record<string, string> = {
  field: 'Field Ref',
  return: 'Return Ref',
  parameter: 'Param Ref',
}

const searchHistoryStoragePrefix = 'dumpview:search-history'
const maxSearchHistoryItems = 12

function kindLabel(kind: SymbolKind) {
  return kindLabels[kind]
}

function relationLabel(relation: string) {
  return relationLabels[relation] ?? relation
}

function formatHex(value: number | null) {
  return value == null ? 'n/a' : `0x${value.toString(16).toUpperCase()}`
}

function shouldShowArrayDim(value: number | null) {
  return value != null && value > 1
}

function formatMethodParameter(parameter: ParameterInfo) {
  return parameter.name
    ? `${parameter.typeDisplay} ${parameter.name}`
    : parameter.typeDisplay
}

function collectUniqueSymbolLinks(links: SymbolLink[]) {
  return [...new Map(links.map((link) => [`${link.kind}:${link.name}`, link])).values()]
}

function isTypeLinkBoundary(character: string | undefined) {
  return character == null || !/[A-Za-z0-9_]/.test(character)
}

function buildInlineTypeDisplay(
  typeDisplay: string,
  links: SymbolLink[],
  onSelectSymbol: (name: string) => void,
) {
  if (links.length === 0) {
    return {
      content: typeDisplay as ReactNode,
      unmatchedLinks: [] as SymbolLink[],
    }
  }

  const uniqueLinks = collectUniqueSymbolLinks(links).sort(
    (left, right) => right.name.length - left.name.length,
  )
  const matchedKeys = new Set<string>()
  const nodes: ReactNode[] = []
  let cursor = 0
  let plainStart = 0
  let partIndex = 0

  while (cursor < typeDisplay.length) {
    const matchedLink = uniqueLinks.find((link) => {
      if (!typeDisplay.startsWith(link.name, cursor)) {
        return false
      }

      const previousCharacter = cursor > 0 ? typeDisplay[cursor - 1] : undefined
      const nextCharacter = typeDisplay[cursor + link.name.length]

      return isTypeLinkBoundary(previousCharacter) && isTypeLinkBoundary(nextCharacter)
    })

    if (!matchedLink) {
      cursor += 1
      continue
    }

    if (plainStart < cursor) {
      nodes.push(typeDisplay.slice(plainStart, cursor))
    }

    matchedKeys.add(`${matchedLink.kind}:${matchedLink.name}`)
    nodes.push(
      <button
        key={`${matchedLink.kind}-${matchedLink.name}-${partIndex}`}
        type="button"
        className="inline-type-link"
        onClick={() => onSelectSymbol(matchedLink.name)}
      >
        {matchedLink.name}
      </button>,
    )
    partIndex += 1
    cursor += matchedLink.name.length
    plainStart = cursor
  }

  if (plainStart < typeDisplay.length) {
    nodes.push(typeDisplay.slice(plainStart))
  }

  return {
    content: nodes,
    unmatchedLinks: uniqueLinks.filter((link) => !matchedKeys.has(`${link.kind}:${link.name}`)),
  }
}

function shouldWrapMethodSignature(method: MethodInfo) {
  if (method.parameters.length >= 4) {
    return true
  }

  const signatureLength =
    method.returnType.length +
    method.name.length +
    method.parameters.map(formatMethodParameter).join(', ').length +
    3

  return (
    signatureLength > 88 ||
    method.parameters.some((parameter) => formatMethodParameter(parameter).length > 30)
  )
}

function buildTypeReferenceDisplay(
  typeDisplay: string,
  links: SymbolLink[],
  onSelectSymbol: (name: string) => void,
  onLoadLinkedDetails: (names: string[]) => void,
  linkedDetailCache: Record<string, SymbolDetail | null>,
) {
  const inlineTypeDisplay = buildInlineTypeDisplay(typeDisplay, links, onSelectSymbol)
  const linkedSymbols = collectUniqueSymbolLinks(links)
  const linkedDetails = linkedSymbols
    .map((link) => linkedDetailCache[link.name])
    .filter((detail): detail is SymbolDetail => detail != null)
  const previewableLinkedDetails = linkedDetails.filter(
    (detail) => detail.kind === 'enum' || detail.fields.length > 0,
  )
  const loadingLinkedDetails =
    linkedSymbols.length > 0 && linkedSymbols.some((link) => !(link.name in linkedDetailCache))

  if (linkedSymbols.length === 0) {
    return {
      content: <span className="field-type">{inlineTypeDisplay.content}</span>,
      unmatchedLinks: inlineTypeDisplay.unmatchedLinks,
    }
  }

  return {
    content: (
      <span
        className="field-type-shell"
        onMouseEnter={() => onLoadLinkedDetails(linkedSymbols.map((link) => link.name))}
        onFocus={() => onLoadLinkedDetails(linkedSymbols.map((link) => link.name))}
      >
        <span className="field-type">
          {inlineTypeDisplay.content}
        </span>
        <span className="field-hover-card" role="tooltip" aria-hidden="true">
          {previewableLinkedDetails.length > 0 ? (
            <div className="field-hover-sections">
              {previewableLinkedDetails.map((detail) => {
                if (detail.kind === 'enum') {
                  const previewValues = detail.enumValues.slice(0, 10)
                  const remainingCount = detail.enumValues.length - previewValues.length

                  return (
                    <div key={detail.name} className="field-hover-section">
                      <div className="field-hover-section-head">
                        <strong>{detail.name}</strong>
                      </div>
                      <div className="field-hover-code">
                        <div className="field-hover-code-line">
                          <span className="field-hover-code-keyword">enum</span>{' '}
                          <span className="field-hover-code-type-name">{detail.name}</span>
                          {detail.underlyingType ? (
                            <>
                              {' '}
                              <span className="field-hover-code-punctuation">:</span>{' '}
                              <span className="field-hover-enum-underlying">
                                {detail.underlyingType}
                              </span>
                            </>
                          ) : null}
                        </div>
                        <div className="field-hover-code-line">
                          <span className="field-hover-code-punctuation">{'{'}</span>
                        </div>
                        {previewValues.map((value, index) => (
                          <div
                            key={`${detail.name}-${value.name}`}
                            className="field-hover-code-line field-hover-code-line-field"
                          >
                            <span className="field-hover-code-indent" aria-hidden="true">
                              {'  '}
                            </span>
                            <span className="field-hover-enum-value-name">{value.name}</span>
                            {value.value !== '' ? (
                              <>
                                {' '}
                                <span className="field-hover-code-punctuation">=</span>{' '}
                                <span className="field-hover-enum-value">{value.value}</span>
                              </>
                            ) : null}
                            {index < previewValues.length - 1 || remainingCount > 0 ? (
                              <span className="field-hover-code-punctuation">,</span>
                            ) : null}
                          </div>
                        ))}
                        <div className="field-hover-code-line">
                          <span className="field-hover-code-punctuation">{'};'}</span>
                        </div>
                        {remainingCount > 0 ? (
                          <span className="field-hover-muted">{`+${remainingCount} more values`}</span>
                        ) : null}
                      </div>
                    </div>
                  )
                }

                const previewFields = detail.fields.slice(0, 8)
                const remainingCount = detail.fields.length - previewFields.length

                return (
                  <div key={detail.name} className="field-hover-section">
                    <div className="field-hover-section-head">
                      <strong>{detail.name}</strong>
                      <span>{`size ${formatHex(detail.size)}`}</span>
                    </div>
                    <div className="field-hover-code">
                      <div className="field-hover-code-line">
                        <span className="field-hover-code-keyword">struct</span>{' '}
                        <span className="field-hover-code-type-name">{detail.name}</span>{' '}
                        <span className="field-hover-code-comment">{`// size ${formatHex(detail.size)}`}</span>
                      </div>
                      <div className="field-hover-code-line">
                        <span className="field-hover-code-punctuation">{'{'}</span>
                      </div>
                      {previewFields.map((previewField) => (
                        <div
                          key={`${detail.name}-${previewField.name}`}
                          className="field-hover-code-line field-hover-code-line-field"
                        >
                          <span className="field-hover-code-indent" aria-hidden="true">
                            {'  '}
                          </span>
                          <span className="field-hover-field-type">
                            {previewField.typeDisplay}
                          </span>{' '}
                          <span className="field-hover-field-name">
                            {previewField.name}
                            {shouldShowArrayDim(previewField.arrayDim)
                              ? `[${previewField.arrayDim}]`
                              : ''}
                            ;
                          </span>{' '}
                          <span className="field-hover-code-comment">
                            {`// ${formatHex(previewField.offset)}`}
                          </span>
                        </div>
                      ))}
                      <div className="field-hover-code-line">
                        <span className="field-hover-code-punctuation">{'};'}</span>
                      </div>
                      {remainingCount > 0 ? (
                        <span className="field-hover-muted">{`+${remainingCount} more fields`}</span>
                      ) : null}
                    </div>
                  </div>
                )
              })}
            </div>
          ) : loadingLinkedDetails ? (
            <span className="field-hover-muted">Loading type fields...</span>
          ) : linkedSymbols.length > 0 ? (
            <span className="field-hover-muted">No referenced type preview.</span>
          ) : null}
        </span>
      </span>
    ),
    unmatchedLinks: inlineTypeDisplay.unmatchedLinks,
  }
}

function buildFieldTypeDisplay(
  field: FieldInfo,
  onSelectSymbol: (name: string) => void,
  onLoadLinkedDetails: (names: string[]) => void,
  linkedDetailCache: Record<string, SymbolDetail | null>,
) {
  return buildTypeReferenceDisplay(
    field.typeDisplay,
    field.links,
    onSelectSymbol,
    onLoadLinkedDetails,
    linkedDetailCache,
  )
}

function buildMethodTypeDisplays(
  method: MethodInfo,
  onSelectSymbol: (name: string) => void,
  onLoadLinkedDetails: (names: string[]) => void,
  linkedDetailCache: Record<string, SymbolDetail | null>,
) {
  const returnTypeDisplay = buildTypeReferenceDisplay(
    method.returnType,
    method.returnLinks,
    onSelectSymbol,
    onLoadLinkedDetails,
    linkedDetailCache,
  )
  const parameterTypeDisplays = method.parameters.map((parameter) =>
    buildTypeReferenceDisplay(
      parameter.typeDisplay,
      parameter.links,
      onSelectSymbol,
      onLoadLinkedDetails,
      linkedDetailCache,
    ),
  )

  return {
    returnTypeDisplay,
    parameterTypeDisplays,
    unmatchedLinks: collectUniqueSymbolLinks([
      ...returnTypeDisplay.unmatchedLinks,
      ...parameterTypeDisplays.flatMap((parameterDisplay) => parameterDisplay.unmatchedLinks),
    ]),
  }
}

function buildEnumCpp(detail: SymbolDetail) {
  const declaration = detail.underlyingType
    ? `enum ${detail.name} : ${detail.underlyingType}`
    : `enum ${detail.name}`

  const values = detail.enumValues.map((value) =>
    value.value !== '' ? `  ${value.name} = ${value.value}` : `  ${value.name}`,
  )

  return `${declaration}\n{\n${values.join(',\n')}\n};`
}

function buildSearchHistoryStorageKey(summary: LoadSummary) {
  return `${searchHistoryStoragePrefix}:${summary.sourceLabel}`
}

function mergeSearchHistoryEntries(entries: string[], nextTerm: string) {
  const normalizedTerm = nextTerm.trim()
  if (!normalizedTerm) {
    return entries
  }

  return [
    normalizedTerm,
    ...entries.filter((entry) => entry.toLowerCase() !== normalizedTerm.toLowerCase()),
  ].slice(0, maxSearchHistoryItems)
}

function readSearchHistoryEntries(storageKey: string) {
  if (typeof window === 'undefined') {
    return []
  }

  try {
    const rawValue = window.localStorage.getItem(storageKey)
    if (!rawValue) {
      return []
    }

    const parsedValue = JSON.parse(rawValue)
    if (!Array.isArray(parsedValue)) {
      return []
    }

    return parsedValue
      .filter((entry): entry is string => typeof entry === 'string')
      .map((entry) => entry.trim())
      .filter(Boolean)
      .slice(0, maxSearchHistoryItems)
  } catch {
    return []
  }
}

function writeSearchHistoryEntries(storageKey: string, entries: string[]) {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.localStorage.setItem(storageKey, JSON.stringify(entries.slice(0, maxSearchHistoryItems)))
  } catch {
    // Ignore storage write failures and keep the in-memory history only.
  }
}

type FieldDisplayRow =
  | { kind: 'single'; key: string; field: FieldInfo }
  | {
      kind: 'group'
      key: string
      offset: number
      slotSize: number | null
      fields: FieldInfo[]
      hint: string
    }

function buildFieldDisplayRows(fields: FieldInfo[]): FieldDisplayRow[] {
  const sharedOffsetCounts = new Map<number, number>()

  for (const field of fields) {
    if (field.offset == null) {
      continue
    }
    sharedOffsetCounts.set(field.offset, (sharedOffsetCounts.get(field.offset) ?? 0) + 1)
  }

  const handledOffsets = new Set<number>()
  const rows: FieldDisplayRow[] = []

  for (const field of fields) {
    if (field.offset == null || (sharedOffsetCounts.get(field.offset) ?? 0) === 1) {
      rows.push({
        kind: 'single',
        key: `field:${field.name}`,
        field,
      })
      continue
    }

    if (handledOffsets.has(field.offset)) {
      continue
    }

    handledOffsets.add(field.offset)
    const groupedFields = fields.filter((item) => item.offset === field.offset)
    const uniqueSizes = [...new Set(groupedFields.map((item) => item.size))]
    const slotSize = uniqueSizes.length === 1 ? (uniqueSizes[0] ?? null) : null

    rows.push({
      kind: 'group',
      key: `offset:${field.offset}`,
      offset: field.offset,
      slotSize,
      fields: groupedFields,
      hint: inferSharedOffsetHint(groupedFields),
    })
  }

  return rows
}

function inferSharedOffsetHint(fields: FieldInfo[]) {
  const packedByte =
    fields.length > 1 &&
    fields.every(
      (field) =>
        field.size === 1 &&
        (field.typeDisplay === 'uint8' ||
          field.typeDisplay === 'bool' ||
          field.name.startsWith('b')),
    )

  if (packedByte) {
    return 'Packed byte, likely flag-style fields sharing one slot.'
  }

  return 'Multiple fields share the same storage offset.'
}

function normalizeError(error: unknown) {
  if (error instanceof Error) {
    return error.message
  }
  return String(error)
}

function App() {
  const runningInTauri = isTauri()
  const directoryInputRef = useRef<HTMLInputElement | null>(null)
  const titlebarSearchRef = useRef<HTMLDivElement | null>(null)
  const actionMenuRef = useRef<HTMLDivElement | null>(null)
  const offsetsMenuRef = useRef<HTMLDivElement | null>(null)
  const filterMenuRef = useRef<HTMLDivElement | null>(null)
  const [summary, setSummary] = useState<LoadSummary | null>(null)
  const [results, setResults] = useState<SearchResult[]>([])
  const [detail, setDetail] = useState<SymbolDetail | null>(null)
  const [query, setQuery] = useState('')
  const [searchHistory, setSearchHistory] = useState<string[]>([])
  const [searchHistoryOpen, setSearchHistoryOpen] = useState(false)
  const [selectedName, setSelectedName] = useState<string | null>(null)
  const [kindFilter, setKindFilter] = useState<KindFilter>('all')
  const [error, setError] = useState<string | null>(null)
  const [busyLabel, setBusyLabel] = useState<string | null>(null)
  const [loadingResults, setLoadingResults] = useState(false)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [actionMenuOpen, setActionMenuOpen] = useState(false)
  const [offsetsMenuOpen, setOffsetsMenuOpen] = useState(false)
  const [filterMenuOpen, setFilterMenuOpen] = useState(false)
  const [relationViewOpen, setRelationViewOpen] = useState(false)
  const [frameworkGraphOpen, setFrameworkGraphOpen] = useState(false)
  const [windowMaximized, setWindowMaximized] = useState(false)
  const [copyLabel, setCopyLabel] = useState('Copy C++')
  const [copiedOffsetValue, setCopiedOffsetValue] = useState<string | null>(null)
  const [linkedTypeDetailCache, setLinkedTypeDetailCache] = useState<
    Record<string, SymbolDetail | null>
  >({})
  const linkedTypeDetailCacheRef = useRef<Record<string, SymbolDetail | null>>({})
  const pendingLinkedTypeDetailsRef = useRef(new Set<string>())
  const deferredQuery = useDeferredValue(query)
  const searchHistoryStorageKey = summary ? buildSearchHistoryStorageKey(summary) : null

  async function loadSampleDump() {
    if (!runningInTauri) {
      setError('Run this UI through Tauri to access local files and SQLite.')
      return
    }

    setBusyLabel('Loading sample Dumpspace and building the FTS5 index...')
    try {
      const nextSummary = await invoke<LoadSummary>('load_sample_dump')
      setSummary(nextSummary)
      setSelectedName(nextSummary.landingSymbol)
      setQuery('')
      setKindFilter('all')
      setError(null)
      setDetail(null)
    } catch (loadError) {
      setError(normalizeError(loadError))
    } finally {
      setBusyLabel(null)
    }
  }

  useEffect(() => {
    if (!runningInTauri) {
      setError('Browser preview mode detected. Start the app with Tauri.')
      return
    }

    let cancelled = false
    setBusyLabel('Loading sample Dumpspace and building the FTS5 index...')

    invoke<LoadSummary>('load_sample_dump')
      .then((nextSummary) => {
        if (cancelled) {
          return
        }
        setSummary(nextSummary)
        setSelectedName(nextSummary.landingSymbol)
        setQuery('')
        setKindFilter('all')
        setError(null)
        setDetail(null)
      })
      .catch((loadError) => {
        if (!cancelled) {
          setError(normalizeError(loadError))
        }
      })
      .finally(() => {
        if (!cancelled) {
          setBusyLabel(null)
        }
      })

    return () => {
      cancelled = true
    }
  }, [runningInTauri])

  useEffect(() => {
    if (!summary || !runningInTauri) {
      return
    }

    let cancelled = false
    setLoadingResults(true)

    invoke<SearchResult[]>('search_symbols', {
      query: deferredQuery,
      limit: 120,
    })
      .then((nextResults) => {
        if (cancelled) {
          return
        }

        setResults(nextResults)
        if (nextResults.length === 0) {
          return
        }

        setSelectedName((current) => {
          if (current && nextResults.some((item) => item.name === current)) {
            return current
          }
          return nextResults[0].name
        })
      })
      .catch((searchError) => {
        if (!cancelled) {
          setError(normalizeError(searchError))
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingResults(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [summary, deferredQuery, runningInTauri])

  useEffect(() => {
    if (!summary || !selectedName || !runningInTauri) {
      return
    }

    let cancelled = false
    setLoadingDetail(true)

    invoke<SymbolDetail>('get_symbol_detail', { name: selectedName })
      .then((nextDetail) => {
        if (!cancelled) {
          setDetail(nextDetail)
        }
      })
      .catch((detailError) => {
        if (!cancelled) {
          setError(normalizeError(detailError))
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingDetail(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [summary, selectedName, runningInTauri])

  useEffect(() => {
    if (!searchHistoryStorageKey) {
      setSearchHistory([])
      return
    }

    setSearchHistory(readSearchHistoryEntries(searchHistoryStorageKey))
  }, [searchHistoryStorageKey])

  useEffect(() => {
    setCopyLabel('Copy C++')
    setRelationViewOpen(false)
  }, [selectedName])

  useEffect(() => {
    linkedTypeDetailCacheRef.current = linkedTypeDetailCache
  }, [linkedTypeDetailCache])

  useEffect(() => {
    linkedTypeDetailCacheRef.current = {}
    pendingLinkedTypeDetailsRef.current.clear()
    setLinkedTypeDetailCache({})
  }, [summary?.sourceLabel])

  useEffect(() => {
    if (
      !actionMenuOpen &&
      !offsetsMenuOpen &&
      !filterMenuOpen &&
      !relationViewOpen &&
      !frameworkGraphOpen &&
      !searchHistoryOpen
    ) {
      return
    }

    function handlePointerDown(event: MouseEvent) {
      if (!(event.target instanceof Node)) {
        return
      }

      if (actionMenuRef.current && !actionMenuRef.current.contains(event.target)) {
        setActionMenuOpen(false)
      }

      if (offsetsMenuRef.current && !offsetsMenuRef.current.contains(event.target)) {
        setOffsetsMenuOpen(false)
      }

      if (filterMenuRef.current && !filterMenuRef.current.contains(event.target)) {
        setFilterMenuOpen(false)
      }

      if (titlebarSearchRef.current && !titlebarSearchRef.current.contains(event.target)) {
        setSearchHistoryOpen(false)
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setActionMenuOpen(false)
        setOffsetsMenuOpen(false)
        setFilterMenuOpen(false)
        setRelationViewOpen(false)
        setFrameworkGraphOpen(false)
        setSearchHistoryOpen(false)
      }
    }

    window.addEventListener('mousedown', handlePointerDown)
    window.addEventListener('keydown', handleEscape)

    return () => {
      window.removeEventListener('mousedown', handlePointerDown)
      window.removeEventListener('keydown', handleEscape)
    }
  }, [
    actionMenuOpen,
    offsetsMenuOpen,
    filterMenuOpen,
    relationViewOpen,
    frameworkGraphOpen,
    searchHistoryOpen,
  ])

  useEffect(() => {
    if (!runningInTauri) {
      return
    }

    const appWindow = getCurrentWindow()
    let disposed = false
    let unlistenResize: (() => void) | null = null

    async function syncWindowState() {
      try {
        const maximized = await appWindow.isMaximized()
        if (!disposed) {
          setWindowMaximized(maximized)
        }
      } catch {
        if (!disposed) {
          setWindowMaximized(false)
        }
      }
    }

    void syncWindowState()

    appWindow
      .onResized(() => {
        void syncWindowState()
      })
      .then((unlisten) => {
        if (disposed) {
          unlisten()
          return
        }
        unlistenResize = unlisten
      })
      .catch(() => {
        if (!disposed) {
          setWindowMaximized(false)
        }
      })

    return () => {
      disposed = true
      unlistenResize?.()
    }
  }, [runningInTauri])

  async function handleFolderImport(event: ChangeEvent<HTMLInputElement>) {
    if (!runningInTauri) {
      setError('Folder import is only available in the Tauri app.')
      return
    }

    const files = Array.from(event.target.files ?? [])
    event.target.value = ''

    if (files.length === 0) {
      return
    }

    const fileMap = new Map(files.map((file) => [file.name, file]))
    const missingFiles = requiredDumpFiles.filter((fileName) => !fileMap.has(fileName))
    if (missingFiles.length > 0) {
      setError(`Missing required files: ${missingFiles.join(', ')}`)
      return
    }

    const sourceLabel =
      files[0]?.webkitRelativePath?.split('/')[0] || 'Selected Dumpspace'

    setBusyLabel('Reading JSON files and rebuilding the SQLite FTS5 index...')
    try {
      const payload: DumpImportPayload = {
        sourceLabel,
        classesJson: await fileMap.get('ClassesInfo.json')!.text(),
        structsJson: await fileMap.get('StructsInfo.json')!.text(),
        functionsJson: await fileMap.get('FunctionsInfo.json')!.text(),
        enumsJson: await fileMap.get('EnumsInfo.json')!.text(),
        offsetsJson: fileMap.get('OffsetsInfo.json')
          ? await fileMap.get('OffsetsInfo.json')!.text()
          : null,
      }

      const nextSummary = await invoke<LoadSummary>('load_dump_payload', { payload })
      setSummary(nextSummary)
      setSelectedName(nextSummary.landingSymbol)
      setQuery('')
      setKindFilter('all')
      setError(null)
      setDetail(null)
    } catch (loadError) {
      setError(normalizeError(loadError))
    } finally {
      setBusyLabel(null)
    }
  }

  function jumpToSymbol(name: string) {
    startTransition(() => {
      setQuery(name)
      setSelectedName(name)
    })
  }

  function openFolderPicker() {
    setActionMenuOpen(false)
    directoryInputRef.current?.click()
  }

  function selectKindFilter(filter: KindFilter) {
    setKindFilter(filter)
    setFilterMenuOpen(false)
  }

  function openFrameworkGraph() {
    setActionMenuOpen(false)
    setOffsetsMenuOpen(false)
    setFilterMenuOpen(false)
    setSearchHistoryOpen(false)
    setRelationViewOpen(false)
    setFrameworkGraphOpen(true)
  }

  function rememberSearchTerm(term: string) {
    if (!searchHistoryStorageKey) {
      return
    }

    setSearchHistory((currentEntries) => {
      const nextEntries = mergeSearchHistoryEntries(currentEntries, term)
      writeSearchHistoryEntries(searchHistoryStorageKey, nextEntries)
      return nextEntries
    })
  }

  function selectSearchHistoryEntry(term: string) {
    rememberSearchTerm(term)
    setQuery(term)
    setSearchHistoryOpen(false)
  }

  function submitSearchTerm(term: string) {
    const normalizedTerm = term.trim()
    if (!normalizedTerm) {
      return
    }

    rememberSearchTerm(normalizedTerm)
    setSearchHistoryOpen(false)
  }

  function jumpToRelatedSymbol(name: string) {
    setRelationViewOpen(false)
    jumpToSymbol(name)
  }

  function jumpToFrameworkSymbol(name: string) {
    setFrameworkGraphOpen(false)
    jumpToSymbol(name)
  }

  async function copyTextToClipboard(value: string) {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value)
      return
    }

    const textarea = document.createElement('textarea')
    textarea.value = value
    textarea.setAttribute('readonly', 'true')
    textarea.style.position = 'absolute'
    textarea.style.left = '-9999px'
    document.body.appendChild(textarea)
    textarea.select()
    document.execCommand('copy')
    document.body.removeChild(textarea)
  }

  async function copyOffsetValue(offset: number | null) {
    if (offset == null) {
      return
    }

    const formattedOffset = formatHex(offset)
    await copyTextToClipboard(formattedOffset)
    setCopiedOffsetValue(formattedOffset)
    window.setTimeout(() => {
      setCopiedOffsetValue((current) => (current === formattedOffset ? null : current))
    }, 1500)
  }

  async function ensureLinkedTypeDetails(names: string[]) {
    if (!runningInTauri || !summary) {
      return
    }

    const nextNames = [...new Set(names.filter(Boolean))].filter((name) => {
      return (
        !(name in linkedTypeDetailCacheRef.current) &&
        !pendingLinkedTypeDetailsRef.current.has(name)
      )
    })

    if (nextNames.length === 0) {
      return
    }

    nextNames.forEach((name) => {
      pendingLinkedTypeDetailsRef.current.add(name)
    })

    const resolvedEntries = await Promise.all(
      nextNames.map(async (name) => {
        try {
          const nextDetail = await invoke<SymbolDetail>('get_symbol_detail', { name })
          return [name, nextDetail] as const
        } catch {
          return [name, null] as const
        } finally {
          pendingLinkedTypeDetailsRef.current.delete(name)
        }
      }),
    )

    const nextEntries = Object.fromEntries(resolvedEntries)
    linkedTypeDetailCacheRef.current = {
      ...linkedTypeDetailCacheRef.current,
      ...nextEntries,
    }
    setLinkedTypeDetailCache((current) => ({
      ...current,
      ...nextEntries,
    }))
  }

  async function startWindowDrag(event: ReactMouseEvent<HTMLDivElement>) {
    if (!runningInTauri || event.button !== 0) {
      return
    }

    try {
      const appWindow = getCurrentWindow()

      if (event.detail > 1) {
        await appWindow.toggleMaximize()
        setWindowMaximized(await appWindow.isMaximized())
        return
      }

      await appWindow.startDragging()
    } catch (windowError) {
      setError(normalizeError(windowError))
    }
  }

  async function minimizeWindow() {
    if (!runningInTauri) {
      return
    }

    try {
      await getCurrentWindow().minimize()
    } catch (windowError) {
      setError(normalizeError(windowError))
    }
  }

  async function toggleWindowMaximize() {
    if (!runningInTauri) {
      return
    }

    try {
      const appWindow = getCurrentWindow()
      await appWindow.toggleMaximize()
      setWindowMaximized(await appWindow.isMaximized())
    } catch (windowError) {
      setError(normalizeError(windowError))
    }
  }

  async function closeWindow() {
    if (!runningInTauri) {
      return
    }

    try {
      await getCurrentWindow().close()
    } catch (windowError) {
      setError(normalizeError(windowError))
    }
  }

  async function copyEnumAsCpp(detail: SymbolDetail) {
    const code = buildEnumCpp(detail)

    try {
      await copyTextToClipboard(code)
    } catch {
      return
    }

    setCopyLabel('Copied')
    window.setTimeout(() => {
      setCopyLabel('Copy C++')
    }, 1500)
  }

  const visibleResults =
    kindFilter === 'all'
      ? results
      : results.filter((result) => result.kind === kindFilter)
  const fieldRows = detail ? buildFieldDisplayRows(detail.fields) : []
  const visibleOffsets = (summary?.offsets ?? []).filter((entry) => entry.key !== 'Dumper')
  const normalizedQuery = query.trim().toLowerCase()
  const visibleSearchHistory = searchHistory
    .filter((entry) => {
      const normalizedEntry = entry.toLowerCase()
      if (!normalizedQuery) {
        return true
      }

      return normalizedEntry.includes(normalizedQuery) && normalizedEntry !== normalizedQuery
    })
    .slice(0, 8)

  return (
    <div className="window-shell">
      <header className="titlebar">
        <div className="titlebar-left">
          <div className="titlebar-brand" aria-hidden="true" />
          <strong className="titlebar-appname">Dumpview</strong>

          <div ref={actionMenuRef} className="action-menu-shell titlebar-menu">
            <button
              type="button"
              className={actionMenuOpen ? 'menu-trigger active' : 'menu-trigger'}
              onClick={() => {
                setOffsetsMenuOpen(false)
                setFilterMenuOpen(false)
                setActionMenuOpen((open) => !open)
              }}
              aria-haspopup="menu"
              aria-expanded={actionMenuOpen}
            >
              File
            </button>

            {actionMenuOpen ? (
              <div className="action-menu" role="menu">
                <button
                  type="button"
                  className="action-menu-item"
                  role="menuitem"
                  onClick={() => {
                    setActionMenuOpen(false)
                    void loadSampleDump()
                  }}
                >
                  Load Repo Sample
                </button>
                <button
                  type="button"
                  className="action-menu-item"
                  role="menuitem"
                  onClick={openFolderPicker}
                >
                  Pick Dumpspace Folder...
                </button>
              </div>
            ) : null}

            <input
              ref={directoryInputRef}
              type="file"
              className="visually-hidden"
              onChange={handleFolderImport}
              {...directoryInputProps}
            />
          </div>

          <div ref={offsetsMenuRef} className="action-menu-shell titlebar-menu">
            <button
              type="button"
              className={offsetsMenuOpen ? 'menu-trigger active' : 'menu-trigger'}
              onClick={() => {
                setActionMenuOpen(false)
                setFrameworkGraphOpen(false)
                setFilterMenuOpen(false)
                setOffsetsMenuOpen((open) => !open)
              }}
              aria-haspopup="dialog"
              aria-expanded={offsetsMenuOpen}
            >
              Offsets
            </button>

            {offsetsMenuOpen ? (
              <div className="offsets-popover">
                <div className="offsets-popover-head">
                  <strong>Offsets</strong>
                </div>

                <div className="offsets-popover-list">
                  {visibleOffsets.map((entry) => (
                    <div key={entry.key} className="offset-card">
                      <span>{entry.key}</span>
                      <strong>{entry.value}</strong>
                    </div>
                  ))}

                  {visibleOffsets.length === 0 ? (
                    <p className="empty-state">No OffsetsInfo.json was provided.</p>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>

          <button
            type="button"
            className={frameworkGraphOpen ? 'menu-trigger active' : 'menu-trigger'}
            onClick={openFrameworkGraph}
            aria-haspopup="dialog"
            aria-expanded={frameworkGraphOpen}
          >
            Framework
          </button>
        </div>

        <div className="titlebar-middle">
          <div
            className="titlebar-drag-region"
            onMouseDown={(event) => {
              void startWindowDrag(event)
            }}
          />

          <div className="titlebar-center">
            <label className="visually-hidden" htmlFor="titlebar-search">
              Quick Search
            </label>
            <div ref={titlebarSearchRef} className="titlebar-search">
              <input
                id="titlebar-search"
                type="search"
                autoComplete="off"
                placeholder="Search by type name, field, method or related symbol..."
                value={query}
                onFocus={() => {
                  setActionMenuOpen(false)
                  setOffsetsMenuOpen(false)
                  setFrameworkGraphOpen(false)
                  setFilterMenuOpen(false)
                  setSearchHistoryOpen(true)
                }}
                onChange={(event) => {
                  setQuery(event.target.value)
                  setSearchHistoryOpen(true)
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    submitSearchTerm(query)
                  }
                }}
              />

              {summary && searchHistoryOpen && visibleSearchHistory.length > 0 ? (
                <div className="search-history-popover">
                  <div className="search-history-head">
                    <span>Recent Searches</span>
                  </div>
                  <div className="search-history-list">
                    {visibleSearchHistory.map((entry) => (
                      <button
                        key={entry}
                        type="button"
                        className="search-history-item"
                        onClick={() => selectSearchHistoryEntry(entry)}
                      >
                        {entry}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>

            <div ref={filterMenuRef} className="filter-combo-shell">
              <button
                type="button"
                className={filterMenuOpen ? 'filter-combo-trigger active' : 'filter-combo-trigger'}
                aria-haspopup="menu"
                aria-expanded={filterMenuOpen}
                onClick={() => {
                  setActionMenuOpen(false)
                  setOffsetsMenuOpen(false)
                  setFrameworkGraphOpen(false)
                  setFilterMenuOpen((open) => !open)
                }}
              >
                <span className="filter-combo-value">{kindLabels[kindFilter]}</span>
                <span className="filter-combo-caret" aria-hidden="true" />
              </button>

              {filterMenuOpen ? (
                <div className="filter-combo-menu" role="menu">
                  {(['all', 'class', 'struct', 'enum'] as const).map((filter) => (
                    <button
                      key={filter}
                      type="button"
                      className={
                        filter === kindFilter ? 'filter-combo-item active' : 'filter-combo-item'
                      }
                      role="menuitemradio"
                      aria-checked={filter === kindFilter}
                      onClick={() => selectKindFilter(filter)}
                    >
                      {kindLabels[filter]}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        </div>

        {runningInTauri ? (
          <div className="window-controls">
            <button
              type="button"
              className="window-control"
              aria-label="Minimize window"
              onClick={() => void minimizeWindow()}
            >
              <span className="window-control-icon minimize" aria-hidden="true" />
            </button>
            <button
              type="button"
              className="window-control"
              aria-label={windowMaximized ? 'Restore window' : 'Maximize window'}
              onClick={() => void toggleWindowMaximize()}
            >
              <span
                className={
                  windowMaximized
                    ? 'window-control-icon restore'
                    : 'window-control-icon maximize'
                }
                aria-hidden="true"
              />
            </button>
            <button
              type="button"
              className="window-control close"
              aria-label="Close window"
              onClick={() => void closeWindow()}
            >
              <span className="window-control-icon close" aria-hidden="true" />
            </button>
          </div>
        ) : null}
      </header>

      <div className="window-scroll-area">
        <div className="app-shell">
          <section className="status-strip">
            <div className="status-card status-card-source">
              <span className="status-label">Source</span>
              <strong
                className="status-value truncate"
                title={summary?.sourceLabel ?? 'Not loaded'}
              >
                {summary?.sourceLabel ?? 'Not loaded'}
              </strong>
            </div>
            <div className="status-card">
              <span className="status-label">Symbols</span>
              <strong className="status-value">{summary?.symbolCount ?? 0}</strong>
            </div>
            <div className="status-card">
              <span className="status-label">Methods</span>
              <strong className="status-value">{summary?.methodCount ?? 0}</strong>
            </div>
            <div className="status-card">
              <span className="status-label">Relations</span>
              <strong className="status-value">{summary?.relationCount ?? 0}</strong>
            </div>
            <div className="status-card wide">
              <span className="status-label">Status</span>
              <strong className="status-value">{busyLabel ?? 'Idle'}</strong>
            </div>
          </section>

          {error ? (
            <section className="error-banner">
              <strong>Error</strong>
              <span>{error}</span>
            </section>
          ) : null}

          <section className="workspace">
            <aside className="panel results-panel">
              <div className="panel-header">
                <h2>Search Results</h2>
                <span>{loadingResults ? 'Searching...' : `${visibleResults.length} items`}</span>
              </div>

              <div className="results-list">
                {visibleResults.map((result) => (
                  <button
                    key={result.name}
                    className={
                      result.name === selectedName ? 'result-card selected' : 'result-card'
                    }
                    onClick={() => {
                      submitSearchTerm(query)
                      setSelectedName(result.name)
                    }}
                  >
                    <div className="result-title-row">
                      <strong>{result.name}</strong>
                      <span className={`kind-chip ${result.kind}`}>{kindLabel(result.kind)}</span>
                    </div>
                    <p>{result.subtitle || 'No extra metadata available.'}</p>
                  </button>
                ))}

                {!loadingResults && visibleResults.length === 0 ? (
                  <p className="empty-state">No matches. Try a type fragment or member name.</p>
                ) : null}
              </div>
            </aside>

            <main className="panel detail-panel">
              <div className="panel-header">
                <h2>Symbol Detail</h2>
                <span>
                  {loadingDetail ? 'Loading...' : detail ? detail.name : 'Nothing selected'}
                </span>
              </div>

          {detail ? (
            detail.kind === 'enum' ? (
              <>
                <section className="enum-detail-hero">
                  <div className="detail-card-head">
                    <p className="eyebrow">Enum</p>
                    <button
                      type="button"
                      className="detail-card-action"
                      onClick={() => setRelationViewOpen(true)}
                    >
                      Relations
                    </button>
                  </div>
                  <div className="enum-declaration">
                    <span className="enum-keyword">enum</span>
                    <span className="enum-name-token">{detail.name}</span>
                    {detail.underlyingType ? (
                      <>
                        <span className="enum-punctuation">:</span>
                        <span className="enum-underlying">{detail.underlyingType}</span>
                      </>
                    ) : null}
                  </div>
                </section>

                <section className="detail-section">
                  <div className="section-heading">
                    <h3>Enum Definition</h3>
                    <span>{detail.enumValues.length} items</span>
                  </div>
                  <div className="enum-block">
                    <div className="enum-block-toolbar">
                      <button
                        type="button"
                        className="copy-inline-button"
                        onClick={() => void copyEnumAsCpp(detail)}
                      >
                        {copyLabel}
                      </button>
                    </div>
                    <div className="enum-line">
                      <span className="enum-punctuation">{'{'}</span>
                    </div>
                    {detail.enumValues.map((value, index) => (
                      <div key={value.name} className="enum-line enum-value-line">
                        <span className="enum-indent" aria-hidden="true" />
                        <span className="enum-name-token">{value.name}</span>
                        {value.value !== '' ? (
                          <>
                            <span className="enum-assignment">=</span>
                            <span className="enum-terminal-token">
                              <span className="enum-value-token">{value.value}</span>
                              {index < detail.enumValues.length - 1 ? (
                                <span className="enum-punctuation">,</span>
                              ) : null}
                            </span>
                          </>
                        ) : index < detail.enumValues.length - 1 ? (
                          <span className="enum-terminal-token">
                            <span className="enum-punctuation">,</span>
                          </span>
                        ) : null}
                      </div>
                    ))}
                    <div className="enum-line">
                      <span className="enum-punctuation">{'};'}</span>
                    </div>
                  </div>
                </section>
              </>
            ) : (
              <>
                <section className="detail-hero">
                  <div className="detail-card-head">
                    <p className="eyebrow">{kindLabel(detail.kind)}</p>
                    <button
                      type="button"
                      className="detail-card-action"
                      onClick={() => setRelationViewOpen(true)}
                    >
                      Relations
                    </button>
                  </div>
                  <h3>{detail.name}</h3>
                </section>

                <section className="detail-section">
                  <div className="section-heading">
                    <h3>Inheritance</h3>
                    <span>{detail.parents.length} levels</span>
                  </div>
                  <div className="chip-row">
                    {detail.parents.length > 0 ? (
                      detail.parents.map((parent) => (
                        <button
                          key={parent.name}
                          className="link-chip"
                          onClick={() => jumpToSymbol(parent.name)}
                        >
                          {parent.name}
                        </button>
                      ))
                    ) : (
                      <p className="empty-state">No parent chain available.</p>
                    )}
                  </div>
                </section>

                <>
                  <section className="detail-section">
                    <div className="section-heading">
                      <h3>Fields</h3>
                      <span>{detail.fields.length} items</span>
                    </div>
                    <div className="field-list">
                      {fieldRows.map((row) => {
                        if (row.kind === 'single') {
                          const fieldTypeDisplay = buildFieldTypeDisplay(
                            row.field,
                            jumpToSymbol,
                            (names) => {
                              void ensureLinkedTypeDetails(names)
                            },
                            linkedTypeDetailCache,
                          )

                          return (
                            <div key={row.key} className="table-block">
                              <div className="table-row">
                                <div className="table-main">
                                  <div className="field-declaration">
                                    {fieldTypeDisplay.content}
                                    <span className="field-name">{row.field.name}</span>
                                  </div>
                                  {fieldTypeDisplay.unmatchedLinks.length > 0 ? (
                                    <div className="chip-row">
                                      {fieldTypeDisplay.unmatchedLinks.map((link) => (
                                        <button
                                          key={`${row.field.name}-${link.name}`}
                                          className="link-chip subtle"
                                          onClick={() => jumpToSymbol(link.name)}
                                        >
                                          {link.name}
                                        </button>
                                      ))}
                                    </div>
                                  ) : null}
                                </div>
                                <div className="table-meta">
                                  {row.field.offset != null ? (
                                    <button
                                      type="button"
                                      className="offset-button"
                                      onClick={() => void copyOffsetValue(row.field.offset)}
                                    >
                                      {copiedOffsetValue === formatHex(row.field.offset)
                                        ? `Copied ${formatHex(row.field.offset)}`
                                        : `offset ${formatHex(row.field.offset)}`}
                                    </button>
                                  ) : (
                                    <span>offset n/a</span>
                                  )}
                                  {shouldShowArrayDim(row.field.arrayDim) ? (
                                    <span>dim {row.field.arrayDim}</span>
                                  ) : null}
                                </div>
                              </div>
                            </div>
                          )
                        }

                        return (
                          <article key={row.key} className="field-group">
                            <div className="field-group-head">
                              <div className="field-group-copy">
                                <strong>{`Shared Offset ${formatHex(row.offset)}`}</strong>
                                <p className="field-group-hint">{row.hint}</p>
                              </div>
                              <div className="field-group-meta">
                                <button
                                  type="button"
                                  className="offset-button"
                                  onClick={() => void copyOffsetValue(row.offset)}
                                >
                                  {copiedOffsetValue === formatHex(row.offset)
                                    ? `Copied ${formatHex(row.offset)}`
                                    : `offset ${formatHex(row.offset)}`}
                                </button>
                                <span>slot size {row.slotSize ?? 'mixed'}</span>
                                <span>fields {row.fields.length}</span>
                              </div>
                            </div>

                            <div className="field-group-list">
                              {row.fields.map((field) => {
                                const fieldTypeDisplay = buildFieldTypeDisplay(
                                  field,
                                  jumpToSymbol,
                                  (names) => {
                                    void ensureLinkedTypeDetails(names)
                                  },
                                  linkedTypeDetailCache,
                                )

                                return (
                                  <div key={field.name} className="field-group-item">
                                    <div className="table-main">
                                      <div className="field-declaration">
                                        {fieldTypeDisplay.content}
                                        <span className="field-name">{field.name}</span>
                                      </div>
                                      {fieldTypeDisplay.unmatchedLinks.length > 0 ? (
                                        <div className="chip-row">
                                          {fieldTypeDisplay.unmatchedLinks.map((link) => (
                                            <button
                                              key={`${field.name}-${link.name}`}
                                              className="link-chip subtle"
                                              onClick={() => jumpToSymbol(link.name)}
                                            >
                                              {link.name}
                                            </button>
                                          ))}
                                        </div>
                                      ) : null}
                                    </div>
                                    <div className="table-meta">
                                      {shouldShowArrayDim(field.arrayDim) ? (
                                        <span>dim {field.arrayDim}</span>
                                      ) : null}
                                    </div>
                                  </div>
                                )
                              })}
                            </div>
                          </article>
                        )
                      })}
                      {detail.fields.length === 0 ? (
                        <p className="empty-state">No field entries available.</p>
                      ) : null}
                    </div>
                  </section>

                  <section className="detail-section">
                    <div className="section-heading">
                      <h3>Methods</h3>
                      <span>{detail.methods.length} items</span>
                    </div>
                    <div className="method-list">
                      {detail.methods.map((method) => {
                        const wrapSignature = shouldWrapMethodSignature(method)
                        const methodTypeDisplays = buildMethodTypeDisplays(
                          method,
                          jumpToSymbol,
                          (names) => {
                            void ensureLinkedTypeDetails(names)
                          },
                          linkedTypeDetailCache,
                        )

                        return (
                          <article key={method.name} className="method-card">
                            <div
                              className={
                                wrapSignature ? 'method-signature multiline' : 'method-signature'
                              }
                            >
                              {wrapSignature ? (
                                <>
                                  <div className="method-signature-line">
                                    {methodTypeDisplays.returnTypeDisplay.content}
                                    <span className="method-call-token">
                                      <span className="field-name method-call-name">
                                        {method.name}
                                      </span>
                                      <span className="method-punctuation">(</span>
                                    </span>
                                  </div>

                                  {method.parameters.length > 0 ? (
                                    <div className="method-parameter-block">
                                      {method.parameters.map((parameter, index) => (
                                        <div
                                          key={`${method.name}-${parameter.name || index}`}
                                          className="method-parameter-line"
                                        >
                                          {methodTypeDisplays.parameterTypeDisplays[index].content}
                                          <span className="method-parameter-token">
                                            {parameter.name ? (
                                              <span className="field-name method-parameter-name">
                                                {parameter.name}
                                              </span>
                                            ) : null}
                                            {index < method.parameters.length - 1 ? (
                                              <span className="method-punctuation">,</span>
                                            ) : null}
                                          </span>
                                        </div>
                                      ))}
                                    </div>
                                  ) : null}

                                  <div className="method-signature-line method-signature-close">
                                    <span className="method-punctuation">)</span>
                                  </div>
                                </>
                              ) : (
                                <div className="method-signature-line single-line">
                                  {methodTypeDisplays.returnTypeDisplay.content}
                                  {' '}
                                  <span className="field-name method-call-name">{method.name}</span>
                                  <span className="method-punctuation">(</span>
                                  {method.parameters.map((parameter, index) => (
                                    <span
                                      key={`${method.name}-${parameter.name || index}`}
                                      className="method-inline-parameter compact"
                                    >
                                      {index > 0 ? (
                                        <span className="method-punctuation">, </span>
                                      ) : null}
                                      {methodTypeDisplays.parameterTypeDisplays[index].content}
                                      {parameter.name ? (
                                        <>
                                          {' '}
                                          <span className="field-name method-parameter-name">
                                            {parameter.name}
                                          </span>
                                        </>
                                      ) : null}
                                    </span>
                                  ))}
                                  <span className="method-punctuation">)</span>
                                </div>
                              )}
                            </div>

                            <div className="method-comment-list">
                              <p className="method-comment">{`// RVA:${formatHex(method.address)}`}</p>
                              {method.flags ? (
                                <p className="method-comment">{`// ${method.flags}`}</p>
                              ) : null}
                            </div>

                            {methodTypeDisplays.unmatchedLinks.length > 0 ? (
                              <div className="chip-row">
                                {methodTypeDisplays.unmatchedLinks.map((link) => (
                                  <button
                                    key={`${method.name}-${link.kind}-${link.name}`}
                                    className="link-chip subtle"
                                    onClick={() => jumpToSymbol(link.name)}
                                  >
                                    {link.name}
                                  </button>
                                ))}
                              </div>
                            ) : null}
                          </article>
                        )
                      })}
                      {detail.methods.length === 0 ? (
                        <p className="empty-state">No method entries available.</p>
                      ) : null}
                    </div>
                  </section>
                </>
              </>
            )
          ) : (
            <div className="empty-detail">
              <h3>Select a symbol</h3>
              <p>
                Pick a result from the left column to inspect parents,
                children, fields, methods and type references.
              </p>
            </div>
          )}
            </main>
          </section>

          {relationViewOpen && detail ? (
            <div className="relation-overlay" onClick={() => setRelationViewOpen(false)}>
              <div
                className="relation-popover"
                role="dialog"
                aria-modal="true"
                aria-labelledby="relation-view-title"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="relation-popover-header">
                  <div className="relation-popover-title">
                    <strong id="relation-view-title">Relation View</strong>
                    <span>{detail.name}</span>
                  </div>
                  <button
                    type="button"
                    className="relation-close-button"
                    onClick={() => setRelationViewOpen(false)}
                  >
                    Close
                  </button>
                </div>

                <div className="relation-popover-body">
                  <section className="detail-section">
                    <div className="section-heading">
                      <h3>Direct Children</h3>
                      <span>{detail.directChildren.length}</span>
                    </div>
                    <div className="chip-row">
                      {detail.directChildren.length ? (
                        detail.directChildren.map((child) => (
                          <button
                            key={child.name}
                            className="link-chip"
                            onClick={() => jumpToRelatedSymbol(child.name)}
                          >
                            {child.name}
                          </button>
                        ))
                      ) : (
                        <p className="empty-state">No direct child records.</p>
                      )}
                    </div>
                  </section>

                  <section className="detail-section">
                    <div className="section-heading">
                      <h3>Outgoing Links</h3>
                      <span>{detail.related.length}</span>
                    </div>
                    <div className="relation-list">
                      {detail.related.length ? (
                        detail.related.map((relation) => (
                          <button
                            key={`${relation.name}-${relation.relation}-${relation.via}`}
                            className="relation-card"
                            onClick={() => jumpToRelatedSymbol(relation.name)}
                          >
                            <strong>{relation.name}</strong>
                            <span>{relationLabel(relation.relation)}</span>
                            <em>{relation.via}</em>
                          </button>
                        ))
                      ) : (
                        <p className="empty-state">No outgoing relation records.</p>
                      )}
                    </div>
                  </section>

                  <section className="detail-section">
                    <div className="section-heading">
                      <h3>Incoming Links</h3>
                      <span>{detail.incomingRefs.length}</span>
                    </div>
                    <div className="relation-list">
                      {detail.incomingRefs.length ? (
                        detail.incomingRefs.map((relation) => (
                          <button
                            key={`${relation.name}-${relation.relation}-${relation.via}-incoming`}
                            className="relation-card incoming"
                            onClick={() => jumpToRelatedSymbol(relation.name)}
                          >
                            <strong>{relation.name}</strong>
                            <span>{relationLabel(relation.relation)}</span>
                            <em>{relation.via}</em>
                          </button>
                        ))
                      ) : (
                        <p className="empty-state">No incoming relation records.</p>
                      )}
                    </div>
                  </section>
                </div>
              </div>
            </div>
          ) : null}

          <FrameworkGraphModal
            open={frameworkGraphOpen}
            runningInTauri={runningInTauri}
            sourceLabel={summary?.sourceLabel ?? null}
            onClose={() => setFrameworkGraphOpen(false)}
            onSelectSymbol={jumpToFrameworkSymbol}
          />
        </div>
      </div>
    </div>
  )
}

export default App
