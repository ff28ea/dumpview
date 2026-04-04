import {
  type CSSProperties,
  Fragment,
  memo,
  type MouseEvent as ReactMouseEvent,
  useDeferredValue,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from 'react'
import { invoke } from '@tauri-apps/api/core'
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  applyNodeChanges,
  type Edge,
  type Node,
  type NodeChange,
  type NodeMouseHandler,
  type NodeProps,
  useNodesState,
} from '@xyflow/react'
import { createPortal } from 'react-dom'
import '@xyflow/react/dist/style.css'
import './NodeWorkspacePage.css'

type SymbolKind = 'class' | 'struct' | 'enum'

interface SearchResult {
  name: string
  kind: SymbolKind
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
  links: SymbolLink[]
}

interface WorkspaceFieldEntry extends FieldInfo {
  ownerName: string
  ownerColor: string
  selectionId: string
}

interface WorkspaceFieldGroup {
  ownerName: string
  ownerColor: string
  fields: WorkspaceFieldEntry[]
}

interface SymbolDetail {
  name: string
  kind: SymbolKind
  parents: SymbolLink[]
  fields: FieldInfo[]
}

interface NodeWorkspaceSummary {
  id: string
  title: string
  sourceLabel: string
  updatedAtMs: number
  nodeCount: number
  edgeCount: number
  path: string
}

interface NodeWorkspaceDocument {
  id: string
  title: string
  sourceLabel: string
  createdAtMs: number
  updatedAtMs: number
  nodes: NodeWorkspaceNode[]
  edges: NodeWorkspaceEdge[]
}

interface NodeWorkspaceNode {
  id: string
  symbolName: string
  x: number
  y: number
  selectedFieldNames: string[]
}

interface NodeWorkspaceEdge {
  id: string
  sourceNodeId: string
  sourceHandleId?: string | null
  targetNodeId: string
  label: string
  kind: 'field' | 'parent'
}

interface NodeWorkspacePageProps {
  runningInTauri: boolean
  sourceLabel: string | null
  onOpenSymbol: (name: string) => void
}

interface WorkspaceFileMenuState {
  documentId: string
  x: number
  y: number
}

interface WorkspaceInspectorState {
  nodeId: string
  x: number
  y: number
}

interface WorkspaceSymbolNodeData extends Record<string, unknown> {
  nodeId: string
  symbolName: string
  kind: SymbolKind | null
  loading: boolean
  missing: boolean
  selected: boolean
  inspectorOpen: boolean
  selectedFields: WorkspaceFieldEntry[]
  parentNames: string[]
  onOpenSymbol: (symbolName: string) => void
  onAddParent: (nodeId: string, parentName: string) => void
  onAddFieldLink: (
    nodeId: string,
    fieldName: string,
    targetName: string,
    sourceHandleId?: string | null,
  ) => void
  onOpenInspector: (nodeId: string, anchorRect: DOMRect) => void
}

type FlowNode = Node<WorkspaceSymbolNodeData>
type FlowEdge = Edge
const AUTO_SAVE_DELAY_MS = 1800

function normalizeError(error: unknown) {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}

function kindLabel(kind: SymbolKind | null) {
  if (kind === 'struct') {
    return 'Struct'
  }

  if (kind === 'enum') {
    return 'Enum'
  }

  return 'Class'
}

function createClientId(prefix: string) {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function formatUpdatedAt(updatedAtMs: number) {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(updatedAtMs))
}

function upsertWorkspaceSummary(
  summaries: NodeWorkspaceSummary[],
  nextSummary: NodeWorkspaceSummary,
) {
  return [...summaries.filter((summary) => summary.id !== nextSummary.id), nextSummary].sort(
    (left, right) => right.updatedAtMs - left.updatedAtMs,
  )
}

function formatFieldLabel(field: FieldInfo) {
  return `${field.name}${field.offset != null ? ` @0x${field.offset.toString(16).toUpperCase()}` : ''}`
}

function formatInheritanceChain(symbolName: string, parentNames: string[]) {
  return [...parentNames].reverse().concat(symbolName).join(' -> ')
}

function createFieldSelectionId(ownerName: string, fieldName: string) {
  return `${ownerName}::${fieldName}`
}

function getFieldSourceHandleId(field: Pick<WorkspaceFieldEntry, 'selectionId'>) {
  return `field-${field.selectionId}`
}

function findWorkspaceNodeBySymbolName(
  document: NodeWorkspaceDocument,
  symbolName: string,
) {
  return document.nodes.find((node) => node.symbolName === symbolName) ?? null
}

function hasWorkspaceEdge(
  document: NodeWorkspaceDocument,
  edgeToMatch: Pick<
    NodeWorkspaceEdge,
    'sourceNodeId' | 'targetNodeId' | 'label' | 'kind' | 'sourceHandleId'
  >,
) {
  return document.edges.some((edge) => {
    return (
      edge.sourceNodeId === edgeToMatch.sourceNodeId &&
      edge.targetNodeId === edgeToMatch.targetNodeId &&
      edge.label === edgeToMatch.label &&
      edge.kind === edgeToMatch.kind &&
      (edge.sourceHandleId ?? null) === (edgeToMatch.sourceHandleId ?? null)
    )
  })
}

function areStringListsEqual(left: string[], right: string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function areSymbolLinksEqual(left: SymbolLink[], right: SymbolLink[]) {
  return (
    left.length === right.length &&
    left.every((link, index) => link.name === right[index]?.name && link.kind === right[index]?.kind)
  )
}

function areWorkspaceFieldEntriesEqual(left: WorkspaceFieldEntry[], right: WorkspaceFieldEntry[]) {
  return (
    left.length === right.length &&
    left.every((field, index) => {
      const nextField = right[index]
      return (
        field.selectionId === nextField?.selectionId &&
        field.ownerName === nextField.ownerName &&
        field.ownerColor === nextField.ownerColor &&
        field.name === nextField.name &&
        field.typeDisplay === nextField.typeDisplay &&
        field.offset === nextField.offset &&
        areSymbolLinksEqual(field.links, nextField.links)
      )
    })
  )
}

function getBranchableFieldTarget(
  nodeSymbolName: string,
  field: Pick<WorkspaceFieldEntry, 'links'>,
) {
  const branchableLinks = field.links.filter((link) => {
    return link.kind !== 'enum' && link.name !== nodeSymbolName
  })

  if (branchableLinks.length !== 1) {
    return null
  }

  return branchableLinks[0].name
}

function getInheritanceOwners(symbolName: string, parentNames: string[]) {
  return [...parentNames].reverse().concat(symbolName)
}

function getInheritanceColor(index: number) {
  const hue = (204 + index * 137.508) % 360
  const saturation = 76
  const lightness = 72 - (index % 3) * 5
  return `hsl(${hue.toFixed(1)} ${saturation}% ${lightness}%)`
}

function buildOwnerColorMap(symbolName: string, parentNames: string[]) {
  return new Map(
    getInheritanceOwners(symbolName, parentNames).map((ownerName, index) => [
      ownerName,
      getInheritanceColor(index),
    ]),
  )
}

function buildWorkspaceFieldEntries(
  symbolName: string,
  detail: SymbolDetail,
  detailCache: Record<string, SymbolDetail | null>,
) {
  const parentNames = detail.parents.map((parent) => parent.name)
  const ownerColorMap = buildOwnerColorMap(symbolName, parentNames)
  const orderedOwners = getInheritanceOwners(symbolName, parentNames)
  const entries: WorkspaceFieldEntry[] = []

  for (const ownerName of orderedOwners) {
    const ownerDetail = ownerName === symbolName ? detail : detailCache[ownerName]
    if (!ownerDetail) {
      continue
    }

    for (const field of ownerDetail.fields) {
      entries.push({
        ...field,
        ownerName,
        ownerColor: ownerColorMap.get(ownerName) ?? getInheritanceColor(0),
        selectionId: createFieldSelectionId(ownerName, field.name),
      })
    }
  }

  return entries
}

function groupWorkspaceFieldsByOwner(
  symbolName: string,
  parentNames: string[],
  fields: WorkspaceFieldEntry[],
): WorkspaceFieldGroup[] {
  const ownerColorMap = buildOwnerColorMap(symbolName, parentNames)
  const groupedFields = new Map<string, WorkspaceFieldEntry[]>()

  for (const field of fields) {
    const existing = groupedFields.get(field.ownerName)
    if (existing) {
      existing.push(field)
    } else {
      groupedFields.set(field.ownerName, [field])
    }
  }

  return getInheritanceOwners(symbolName, parentNames)
    .map((ownerName) => ({
      ownerName,
      ownerColor: ownerColorMap.get(ownerName) ?? getInheritanceColor(0),
      fields: groupedFields.get(ownerName) ?? [],
    }))
    .filter((group) => group.fields.length > 0)
}

function isFieldSelected(node: NodeWorkspaceNode, field: WorkspaceFieldEntry) {
  return (
    node.selectedFieldNames.includes(field.selectionId) ||
    (field.ownerName === node.symbolName && node.selectedFieldNames.includes(field.name))
  )
}

function compareWorkspaceFieldsByOffset(left: WorkspaceFieldEntry, right: WorkspaceFieldEntry) {
  if (left.offset != null && right.offset != null && left.offset !== right.offset) {
    return left.offset - right.offset
  }

  if (left.offset != null && right.offset == null) {
    return -1
  }

  if (left.offset == null && right.offset != null) {
    return 1
  }

  const ownerComparison = left.ownerName.localeCompare(right.ownerName)
  if (ownerComparison !== 0) {
    return ownerComparison
  }

  return left.name.localeCompare(right.name)
}

function estimateWorkspaceNodeLayout(
  symbolName: string,
  fields: WorkspaceFieldEntry[],
  parentNames: string[],
) {
  const typeLength = fields.reduce((longest, field) => {
    return Math.max(longest, field.typeDisplay.length)
  }, 8)
  const fieldLabelLength = fields.reduce((longest, field) => {
    return Math.max(longest, formatFieldLabel(field).length + (field.links.length > 0 ? 4 : 0))
  }, 12)
  const chainLength = parentNames.length > 0 ? formatInheritanceChain(symbolName, parentNames).length : 0
  const headlineLength = Math.max(symbolName.length, chainLength)
  const rowLength = Math.max(headlineLength, typeLength + fieldLabelLength + 2)

  return {
    cardWidthPx: Math.max(320, Math.min(760, 108 + rowLength * 7.1)),
    typeColumnWidthPx: Math.max(76, Math.min(260, 20 + typeLength * 7.1)),
  }
}

const WorkspaceSymbolNodeCard = memo(function WorkspaceSymbolNodeCard({ data }: NodeProps<FlowNode>) {
  const classes = ['workspace-flow-node', data.selected ? 'selected' : '']
    .filter(Boolean)
    .join(' ')
  const layout = estimateWorkspaceNodeLayout(data.symbolName, data.selectedFields, data.parentNames)
  const chainOwners = getInheritanceOwners(data.symbolName, data.parentNames)
  const ownerColorMap = buildOwnerColorMap(data.symbolName, data.parentNames)
  const style = {
    '--workspace-node-card-width': `${layout.cardWidthPx}px`,
    '--workspace-node-type-column-width': `${layout.typeColumnWidthPx}px`,
  } as CSSProperties
  const openInspectorFromTrigger = (target: HTMLElement) => {
    data.onOpenInspector(data.nodeId, target.getBoundingClientRect())
  }

  return (
    <div className={classes} style={style}>
      <Handle
        type="target"
        position={Position.Left}
        isConnectable={false}
        className="workspace-flow-handle"
      />

      <div className="workspace-flow-node-head">
        <span className="workspace-flow-node-kind">{kindLabel(data.kind)}</span>
        <button
          type="button"
          className="workspace-node-inline-button nodrag nopan"
          onClick={() => data.onOpenSymbol(data.symbolName)}
        >
          Open
        </button>
      </div>

      <div className="workspace-flow-node-title-row">
        <strong>{data.symbolName}</strong>
        <button
          type="button"
          className={
            data.inspectorOpen
              ? 'workspace-node-inspector-trigger nodrag nopan active'
              : 'workspace-node-inspector-trigger nodrag nopan'
          }
          data-node-inspector-trigger="true"
          aria-label={`Open actions for ${data.symbolName}`}
          onPointerDownCapture={(event) => {
            event.stopPropagation()
            openInspectorFromTrigger(event.currentTarget)
          }}
          onMouseDown={(event) => {
            event.preventDefault()
            event.stopPropagation()
          }}
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            openInspectorFromTrigger(event.currentTarget)
          }}
        >
          +
        </button>
      </div>

      {data.parentNames.length > 0 ? (
        <div className="workspace-flow-node-chain">
          {chainOwners.map((ownerName, index) => (
            <Fragment key={`${data.nodeId}-${ownerName}`}>
              {index > 0 ? (
                <span className="workspace-flow-node-chain-separator">{' -> '}</span>
              ) : null}
              <span
                className="workspace-flow-node-chain-part"
                style={{ color: ownerColorMap.get(ownerName) ?? getInheritanceColor(0) }}
              >
                {ownerName}
              </span>
            </Fragment>
          ))}
        </div>
      ) : null}

      {data.loading ? (
        <p>Loading symbol detail...</p>
      ) : data.missing ? (
        <p>Symbol detail is unavailable in the current dump.</p>
      ) : data.selectedFields.length > 0 ? (
        <div className="workspace-node-field-list">
          {data.selectedFields.map((field) => {
            const branchTargetName = getBranchableFieldTarget(data.symbolName, field)

            return (
              <div
                key={`${data.nodeId}-${field.selectionId}`}
                className="workspace-node-field-row"
                style={
                  {
                    '--workspace-field-owner-color': field.ownerColor,
                  } as CSSProperties
                }
              >
                <div className="workspace-node-field-copy">
                  <span className="workspace-node-field-type">{field.typeDisplay}</span>
                  <div className="workspace-node-field-main">
                    <span className="workspace-node-field-name">{formatFieldLabel(field)}</span>
                    {branchTargetName ? (
                      <>
                        <button
                          type="button"
                          className="workspace-node-field-add nodrag nopan"
                          onClick={() =>
                            data.onAddFieldLink(
                              data.nodeId,
                              field.name,
                              branchTargetName,
                              getFieldSourceHandleId(field),
                            )
                          }
                        >
                          +
                        </button>
                        <Handle
                          id={getFieldSourceHandleId(field)}
                          type="source"
                          position={Position.Right}
                          isConnectable={false}
                          className="workspace-node-field-handle"
                        />
                      </>
                    ) : null}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <p>Click the + beside this class name to pin fields or extend the inheritance chain.</p>
      )}

      <Handle
        type="source"
        position={Position.Right}
        isConnectable={false}
        className="workspace-flow-handle"
      />
    </div>
  )
},
function areWorkspaceSymbolNodeCardPropsEqual(
  previousProps: NodeProps<FlowNode>,
  nextProps: NodeProps<FlowNode>,
) {
  const previousData = previousProps.data
  const nextData = nextProps.data

  return (
    previousData.nodeId === nextData.nodeId &&
    previousData.symbolName === nextData.symbolName &&
    previousData.kind === nextData.kind &&
    previousData.loading === nextData.loading &&
    previousData.missing === nextData.missing &&
    previousData.selected === nextData.selected &&
    previousData.inspectorOpen === nextData.inspectorOpen &&
    areStringListsEqual(previousData.parentNames, nextData.parentNames) &&
    areWorkspaceFieldEntriesEqual(previousData.selectedFields, nextData.selectedFields)
  )
})

const nodeTypes = {
  workspaceSymbolNode: WorkspaceSymbolNodeCard,
}

function NodeWorkspacePage({
  runningInTauri,
  sourceLabel,
  onOpenSymbol,
}: NodeWorkspacePageProps) {
  const searchPopoverRef = useRef<HTMLDivElement | null>(null)
  const fileMenuRef = useRef<HTMLDivElement | null>(null)
  const inspectorPopoverRef = useRef<HTMLDivElement | null>(null)
  const renameInputRef = useRef<HTMLInputElement | null>(null)
  const retiredWorkspaceIdsRef = useRef(new Set<string>())
  const [documents, setDocuments] = useState<NodeWorkspaceSummary[]>([])
  const [activeDocument, setActiveDocument] = useState<NodeWorkspaceDocument | null>(null)
  const [workspaceError, setWorkspaceError] = useState<string | null>(null)
  const [loadingDocuments, setLoadingDocuments] = useState(false)
  const [loadingDocument, setLoadingDocument] = useState(false)
  const [savingDocument, setSavingDocument] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [searchingSymbols, setSearchingSymbols] = useState(false)
  const [searchPopoverOpen, setSearchPopoverOpen] = useState(false)
  const [fileMenu, setFileMenu] = useState<WorkspaceFileMenuState | null>(null)
  const [inspectorPopover, setInspectorPopover] = useState<WorkspaceInspectorState | null>(null)
  const [renamingDocumentId, setRenamingDocumentId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [expandedFieldOwners, setExpandedFieldOwners] = useState<string[]>([])
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [fieldFilter, setFieldFilter] = useState('')
  const [detailCache, setDetailCache] = useState<Record<string, SymbolDetail | null>>({})
  const activeDocumentRef = useRef<NodeWorkspaceDocument | null>(null)
  const detailCacheRef = useRef<Record<string, SymbolDetail | null>>({})
  const pendingDetailNamesRef = useRef(new Set<string>())
  const revisionRef = useRef(0)
  const draggingNodesRef = useRef(false)
  const flowNodesRef = useRef<FlowNode[]>([])
  const flowDocumentIdRef = useRef<string | null>(null)
  const deferredSearchQuery = useDeferredValue(searchQuery)
  const persistDocumentEvent = useEffectEvent(
    (
      documentSnapshot: NodeWorkspaceDocument | null,
      revisionAtSave: number,
      silent = false,
    ) => {
      void persistDocument(documentSnapshot, revisionAtSave, { silent })
    },
  )
  const openSymbolEvent = useEffectEvent((symbolName: string) => {
    onOpenSymbol(symbolName)
  })
  const addFieldBranchNodeEvent = useEffectEvent(
    (
      nodeId: string,
      fieldName: string,
      targetName: string,
      sourceHandleId?: string | null,
    ) => {
      addFieldBranchNode(nodeId, fieldName, targetName, sourceHandleId)
    },
  )
  const addParentNodeEvent = useEffectEvent((nodeId: string, parentName: string) => {
    addParentNode(nodeId, parentName)
  })
  const openNodeInspectorEvent = useEffectEvent((nodeId: string, anchorRect: DOMRect) => {
    openNodeInspector(nodeId, anchorRect)
  })
  const [draggingNodes, setDraggingNodes] = useState(false)
  const [flowEdges, setFlowEdges] = useState<FlowEdge[]>([])
  const [flowNodes, setFlowNodes] = useNodesState<FlowNode>([])

  function updateDraggingNodes(nextDragging: boolean) {
    if (draggingNodesRef.current === nextDragging) {
      return
    }

    draggingNodesRef.current = nextDragging
    setDraggingNodes(nextDragging)
  }

  useEffect(() => {
    activeDocumentRef.current = activeDocument
  }, [activeDocument])

  useEffect(() => {
    detailCacheRef.current = detailCache
  }, [detailCache])

  useEffect(() => {
    flowNodesRef.current = flowNodes
  }, [flowNodes])

  useEffect(() => {
    setDocuments([])
    setActiveDocument(null)
    activeDocumentRef.current = null
    setSelectedNodeId(null)
    setSearchQuery('')
    setSearchResults([])
    setSearchPopoverOpen(false)
    setFileMenu(null)
    setInspectorPopover(null)
    setRenamingDocumentId(null)
    setRenameDraft('')
    setExpandedFieldOwners([])
    setFieldFilter('')
    setDirty(false)
    revisionRef.current = 0
    updateDraggingNodes(false)
    detailCacheRef.current = {}
    pendingDetailNamesRef.current.clear()
    setDetailCache({})
    retiredWorkspaceIdsRef.current.clear()

    if (!runningInTauri || !sourceLabel) {
      return
    }

    let cancelled = false
    setLoadingDocuments(true)
    setWorkspaceError(null)

    invoke<NodeWorkspaceSummary[]>('list_node_workspaces', { sourceLabel })
      .then(async (nextDocuments) => {
        if (cancelled) {
          return null
        }

        setDocuments(nextDocuments)
        if (nextDocuments.length === 0) {
          return null
        }

        const nextDocument = await invoke<NodeWorkspaceDocument>('load_node_workspace', {
          sourceLabel,
          workspaceId: nextDocuments[0].id,
        })

        if (cancelled) {
          return null
        }

        return nextDocument
      })
      .then((nextDocument) => {
        if (cancelled || !nextDocument) {
          return
        }

        setActiveDocument(nextDocument)
        activeDocumentRef.current = nextDocument
        setSelectedNodeId(nextDocument.nodes[0]?.id ?? null)
        revisionRef.current = 0
        setDirty(false)
      })
      .catch((loadError) => {
        if (!cancelled) {
          setWorkspaceError(normalizeError(loadError))
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingDocuments(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [runningInTauri, sourceLabel])

  useEffect(() => {
    if (!runningInTauri || !sourceLabel) {
      return
    }

    const activeNames = activeDocument?.nodes.map((node) => node.symbolName) ?? []
    const pendingNames = activeNames.filter((name) => {
      return !(name in detailCacheRef.current) && !pendingDetailNamesRef.current.has(name)
    })

    if (pendingNames.length === 0) {
      return
    }

    let cancelled = false
    pendingNames.forEach((name) => {
      pendingDetailNamesRef.current.add(name)
    })

    Promise.all(
      pendingNames.map(async (name) => {
        try {
          const detail = await invoke<SymbolDetail>('get_symbol_detail', { name })
          return [name, detail] as const
        } catch {
          return [name, null] as const
        } finally {
          pendingDetailNamesRef.current.delete(name)
        }
      }),
    ).then((entries) => {
      if (cancelled) {
        return
      }

      const nextEntries = Object.fromEntries(entries)
      detailCacheRef.current = {
        ...detailCacheRef.current,
        ...nextEntries,
      }
      setDetailCache((current) => ({
        ...current,
        ...nextEntries,
      }))
    })

    return () => {
      cancelled = true
    }
  }, [activeDocument, runningInTauri, sourceLabel])

  useEffect(() => {
    if (!runningInTauri || !sourceLabel) {
      return
    }

    const inheritedNames = Array.from(
      new Set(
        (activeDocument?.nodes ?? []).flatMap((node) => {
          const detail = detailCacheRef.current[node.symbolName]
          return detail?.parents.map((parent) => parent.name) ?? []
        }),
      ),
    ).filter((name) => !(name in detailCacheRef.current) && !pendingDetailNamesRef.current.has(name))

    if (inheritedNames.length === 0) {
      return
    }

    let cancelled = false
    inheritedNames.forEach((name) => {
      pendingDetailNamesRef.current.add(name)
    })

    Promise.all(
      inheritedNames.map(async (name) => {
        try {
          const detail = await invoke<SymbolDetail>('get_symbol_detail', { name })
          return [name, detail] as const
        } catch {
          return [name, null] as const
        } finally {
          pendingDetailNamesRef.current.delete(name)
        }
      }),
    ).then((entries) => {
      if (cancelled) {
        return
      }

      const nextEntries = Object.fromEntries(entries)
      detailCacheRef.current = {
        ...detailCacheRef.current,
        ...nextEntries,
      }
      setDetailCache((current) => ({
        ...current,
        ...nextEntries,
      }))
    })

    return () => {
      cancelled = true
    }
  }, [activeDocument, detailCache, runningInTauri, sourceLabel])

  useEffect(() => {
    if (!activeDocument) {
      flowDocumentIdRef.current = null
      setFlowNodes([])
      setFlowEdges([])
      return
    }

    const preservePositions = flowDocumentIdRef.current === activeDocument.id
    flowDocumentIdRef.current = activeDocument.id

    setFlowNodes((currentNodes) => {
      const currentNodeMap = preservePositions
        ? new Map(currentNodes.map((node) => [node.id, node]))
        : new Map<string, FlowNode>()

      return activeDocument.nodes.map((node) => {
        const detail = detailCache[node.symbolName]
        const availableFields = detail
          ? buildWorkspaceFieldEntries(node.symbolName, detail, detailCache)
          : []
        const selectedFields = availableFields.filter((field) => isFieldSelected(node, field))

        selectedFields.sort(compareWorkspaceFieldsByOffset)

        return {
          id: node.id,
          type: 'workspaceSymbolNode',
          position: currentNodeMap.get(node.id)?.position ?? { x: node.x, y: node.y },
          data: {
            nodeId: node.id,
            symbolName: node.symbolName,
            kind: detail?.kind ?? null,
            loading: !(node.symbolName in detailCache),
            missing: detail === null,
            selected: node.id === selectedNodeId,
            inspectorOpen: node.id === inspectorPopover?.nodeId,
            selectedFields,
            parentNames: detail?.parents.map((parent) => parent.name) ?? [],
            onOpenSymbol: openSymbolEvent,
            onAddParent: addParentNodeEvent,
            onAddFieldLink: addFieldBranchNodeEvent,
            onOpenInspector: openNodeInspectorEvent,
          },
          draggable: true,
          selectable: true,
        }
      })
    })

    setFlowEdges(
      activeDocument.edges.map((edge) => {
        const sourceNode = activeDocument.nodes.find((node) => node.id === edge.sourceNodeId)
        const sourceDetail = sourceNode ? detailCache[sourceNode.symbolName] : null
        const sourceHandleId =
          edge.sourceHandleId ??
          (edge.kind === 'field' && sourceNode && sourceDetail
            ? buildWorkspaceFieldEntries(
                sourceNode.symbolName,
                sourceDetail,
                detailCache,
              ).find((field) => isFieldSelected(sourceNode, field) && field.name === edge.label)
            : null)?.selectionId

        return {
          id: edge.id,
          source: edge.sourceNodeId,
          sourceHandle:
            typeof sourceHandleId === 'string' && sourceHandleId.length > 0
              ? sourceHandleId.startsWith('field-')
                ? sourceHandleId
                : getFieldSourceHandleId({ selectionId: sourceHandleId })
              : undefined,
          target: edge.targetNodeId,
          label: edge.label,
          type: 'smoothstep',
          selectable: false,
          markerEnd: {
            type: MarkerType.ArrowClosed,
            width: 18,
            height: 18,
          },
          className:
            edge.kind === 'parent'
              ? 'workspace-flow-edge parent-edge'
              : 'workspace-flow-edge field-edge',
        }
      }),
    )
  }, [activeDocument, detailCache, inspectorPopover, selectedNodeId, setFlowNodes])

  useEffect(() => {
    if (!runningInTauri || !sourceLabel || !deferredSearchQuery.trim()) {
      setSearchResults([])
      return
    }

    let cancelled = false
    setSearchingSymbols(true)

    invoke<SearchResult[]>('search_symbols', {
      query: deferredSearchQuery,
      limit: 24,
    })
      .then((nextResults) => {
        if (!cancelled) {
          setSearchResults(nextResults)
        }
      })
      .catch((searchError) => {
        if (!cancelled) {
          setWorkspaceError(normalizeError(searchError))
        }
      })
      .finally(() => {
        if (!cancelled) {
          setSearchingSymbols(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [deferredSearchQuery, runningInTauri, sourceLabel])

  useEffect(() => {
    if (!dirty || !activeDocument || !runningInTauri || draggingNodes) {
      return
    }

    const snapshot = activeDocument
    const revisionAtSave = revisionRef.current
    const timeoutId = window.setTimeout(() => {
      persistDocumentEvent(snapshot, revisionAtSave, true)
    }, AUTO_SAVE_DELAY_MS)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [activeDocument, dirty, draggingNodes, runningInTauri])

  useEffect(() => {
    if (!searchPopoverOpen) {
      return
    }

    function handlePointerDown(event: MouseEvent) {
      if (!(event.target instanceof Node)) {
        return
      }

      if (searchPopoverRef.current && !searchPopoverRef.current.contains(event.target)) {
        setSearchPopoverOpen(false)
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setSearchPopoverOpen(false)
      }
    }

    window.addEventListener('mousedown', handlePointerDown)
    window.addEventListener('keydown', handleEscape)

    return () => {
      window.removeEventListener('mousedown', handlePointerDown)
      window.removeEventListener('keydown', handleEscape)
    }
  }, [searchPopoverOpen])

  useEffect(() => {
    if (!fileMenu) {
      return
    }

    function handlePointerDown(event: MouseEvent) {
      if (!(event.target instanceof Node)) {
        return
      }

      if (fileMenuRef.current && !fileMenuRef.current.contains(event.target)) {
        setFileMenu(null)
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setFileMenu(null)
      }
    }

    function handleScroll() {
      setFileMenu(null)
    }

    window.addEventListener('mousedown', handlePointerDown)
    window.addEventListener('keydown', handleEscape)
    window.addEventListener('scroll', handleScroll, true)

    return () => {
      window.removeEventListener('mousedown', handlePointerDown)
      window.removeEventListener('keydown', handleEscape)
      window.removeEventListener('scroll', handleScroll, true)
    }
  }, [fileMenu])

  useEffect(() => {
    if (!inspectorPopover) {
      return
    }

    function closeInspector() {
      setInspectorPopover(null)
      setExpandedFieldOwners([])
      setFieldFilter('')
    }

    function handlePointerDown(event: MouseEvent) {
      if (!(event.target instanceof Node)) {
        return
      }

      const triggerElement =
        event.target instanceof Element ? event.target.closest('.workspace-node-inspector-trigger') : null
      if (triggerElement) {
        return
      }

      if (
        inspectorPopoverRef.current &&
        !inspectorPopoverRef.current.contains(event.target)
      ) {
        closeInspector()
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        closeInspector()
      }
    }

    window.addEventListener('click', handlePointerDown)
    window.addEventListener('keydown', handleEscape)
    window.addEventListener('resize', closeInspector)

    return () => {
      window.removeEventListener('click', handlePointerDown)
      window.removeEventListener('keydown', handleEscape)
      window.removeEventListener('resize', closeInspector)
    }
  }, [inspectorPopover])

  useEffect(() => {
    if (!inspectorPopover) {
      return
    }

    const hasNode = activeDocument?.nodes.some((node) => node.id === inspectorPopover.nodeId) ?? false
    if (!hasNode) {
      setInspectorPopover(null)
      setExpandedFieldOwners([])
      setFieldFilter('')
    }
  }, [activeDocument, inspectorPopover])

  useEffect(() => {
    if (!renamingDocumentId || !renameInputRef.current) {
      return
    }

    renameInputRef.current.focus()
    renameInputRef.current.select()
  }, [renamingDocumentId])

  async function refreshDocumentList() {
    if (!runningInTauri || !sourceLabel) {
      return []
    }

    try {
      const nextDocuments = await invoke<NodeWorkspaceSummary[]>('list_node_workspaces', {
        sourceLabel,
      })
      setDocuments(nextDocuments)
      return nextDocuments
    } catch (listError) {
      setWorkspaceError(normalizeError(listError))
      return []
    }
  }

  async function persistDocument(
    documentSnapshot: NodeWorkspaceDocument | null = activeDocumentRef.current,
    revisionAtSave = revisionRef.current,
    options: {
      silent?: boolean
    } = {},
  ) {
    const { silent = false } = options

    if (
      !runningInTauri ||
      !documentSnapshot ||
      retiredWorkspaceIdsRef.current.has(documentSnapshot.id)
    ) {
      return
    }

    if (!silent) {
      setSavingDocument(true)
    }

    try {
      const summary = await invoke<NodeWorkspaceSummary>('save_node_workspace', {
        document: documentSnapshot,
      })

      setDocuments((current) => upsertWorkspaceSummary(current, summary))
      setWorkspaceError(null)

      if (activeDocumentRef.current?.id === documentSnapshot.id) {
        activeDocumentRef.current = {
          ...activeDocumentRef.current,
          title: documentSnapshot.title,
          updatedAtMs: summary.updatedAtMs,
        }
      }

      if (
        activeDocumentRef.current?.id === documentSnapshot.id &&
        revisionRef.current === revisionAtSave
      ) {
        setDirty(false)
      }
    } catch (saveError) {
      setWorkspaceError(normalizeError(saveError))
    } finally {
      if (!silent) {
        setSavingDocument(false)
      }
    }
  }

  async function createWorkspace() {
    if (!runningInTauri || !sourceLabel) {
      return
    }

    if (dirty && activeDocumentRef.current) {
      await persistDocument(activeDocumentRef.current, revisionRef.current)
    }

    setLoadingDocument(true)

    try {
      const nextDocument = await invoke<NodeWorkspaceDocument>('create_node_workspace', {
        sourceLabel,
      })

      setActiveDocument(nextDocument)
      activeDocumentRef.current = nextDocument
      setSelectedNodeId(null)
      setFieldFilter('')
      setDirty(false)
      revisionRef.current = 0
      setWorkspaceError(null)
      await refreshDocumentList()
    } catch (createError) {
      setWorkspaceError(normalizeError(createError))
    } finally {
      setLoadingDocument(false)
    }
  }

  async function openWorkspace(workspaceId: string) {
    if (!runningInTauri || !sourceLabel || workspaceId === activeDocumentRef.current?.id) {
      return
    }

    if (dirty && activeDocumentRef.current) {
      await persistDocument(activeDocumentRef.current, revisionRef.current)
    }

    setLoadingDocument(true)

    try {
      const nextDocument = await invoke<NodeWorkspaceDocument>('load_node_workspace', {
        sourceLabel,
        workspaceId,
      })

      setActiveDocument(nextDocument)
      activeDocumentRef.current = nextDocument
      setSelectedNodeId(nextDocument.nodes[0]?.id ?? null)
      setFieldFilter('')
      setDirty(false)
      revisionRef.current = 0
      setWorkspaceError(null)
    } catch (loadError) {
      setWorkspaceError(normalizeError(loadError))
    } finally {
      setLoadingDocument(false)
    }
  }

  function openWorkspaceFileMenu(
    event: ReactMouseEvent<HTMLButtonElement>,
    workspaceId: string,
  ) {
    event.preventDefault()

    const nextX = Math.min(event.clientX, window.innerWidth - 176)
    const nextY = Math.min(event.clientY, window.innerHeight - 112)

    setRenamingDocumentId(null)
    setRenameDraft('')
    setFileMenu({
      documentId: workspaceId,
      x: Math.max(8, nextX),
      y: Math.max(8, nextY),
    })
  }

  function openNodeInspector(nodeId: string, anchorRect: DOMRect) {
    setSelectedNodeId(nodeId)

    const estimatedWidth = 388
    const estimatedHeight = 560
    const gutter = 14
    let nextLeft = anchorRect.right + gutter
    let nextTop = anchorRect.top - 8

    if (nextLeft + estimatedWidth > window.innerWidth - 12) {
      nextLeft = anchorRect.left - estimatedWidth - gutter
    }

    if (nextLeft < 12) {
      nextLeft = Math.max(12, window.innerWidth - estimatedWidth - 12)
    }

    if (nextTop + estimatedHeight > window.innerHeight - 12) {
      nextTop = Math.max(12, window.innerHeight - estimatedHeight - 12)
    }

    setExpandedFieldOwners([])
    setFieldFilter('')
    setInspectorPopover({
      nodeId,
      x: nextLeft,
      y: Math.max(12, nextTop),
    })
  }

  function beginRenameWorkspace(workspaceId: string) {
    const targetDocument = documents.find((document) => document.id === workspaceId)
    if (!targetDocument) {
      return
    }

    setFileMenu(null)
    setRenamingDocumentId(workspaceId)
    setRenameDraft(targetDocument.title)
  }

  function cancelRenameWorkspace() {
    setRenamingDocumentId(null)
    setRenameDraft('')
  }

  async function submitRenameWorkspace(workspaceId: string) {
    if (!runningInTauri || !sourceLabel || renamingDocumentId !== workspaceId) {
      return
    }

    const nextTitle = renameDraft.trim()
    const targetDocument = documents.find((document) => document.id === workspaceId)
    if (!nextTitle || !targetDocument) {
      cancelRenameWorkspace()
      return
    }

    if (nextTitle === targetDocument.title) {
      cancelRenameWorkspace()
      return
    }

    setLoadingDocument(true)
    setWorkspaceError(null)

    const isActiveWorkspace = activeDocumentRef.current?.id === workspaceId
    let keepRetiredIdBlocked = false

    try {
      if (isActiveWorkspace && dirty && activeDocumentRef.current) {
        await persistDocument(activeDocumentRef.current, revisionRef.current)
      }

      retiredWorkspaceIdsRef.current.add(workspaceId)
      const renamedDocument = await invoke<NodeWorkspaceDocument>('rename_node_workspace', {
        sourceLabel,
        workspaceId,
        title: nextTitle,
      })

      keepRetiredIdBlocked = renamedDocument.id !== workspaceId

      if (isActiveWorkspace) {
        activeDocumentRef.current = renamedDocument
        setActiveDocument(renamedDocument)
        setSelectedNodeId((currentSelectedNodeId) =>
          currentSelectedNodeId &&
          renamedDocument.nodes.some((node) => node.id === currentSelectedNodeId)
            ? currentSelectedNodeId
            : renamedDocument.nodes[0]?.id ?? null,
        )
        revisionRef.current = 0
        setDirty(false)
      }

      await refreshDocumentList()
      cancelRenameWorkspace()
    } catch (renameError) {
      retiredWorkspaceIdsRef.current.delete(workspaceId)
      setWorkspaceError(normalizeError(renameError))
    } finally {
      if (!keepRetiredIdBlocked) {
        retiredWorkspaceIdsRef.current.delete(workspaceId)
      }
      setLoadingDocument(false)
    }
  }

  async function deleteWorkspace(workspaceId: string) {
    if (!runningInTauri || !sourceLabel) {
      return
    }

    const targetDocument = documents.find((document) => document.id === workspaceId)
    if (
      !targetDocument ||
      !window.confirm(`Delete "${targetDocument.title}"? This node file will be removed from disk.`)
    ) {
      return
    }

    setFileMenu(null)
    cancelRenameWorkspace()
    setLoadingDocument(true)
    setWorkspaceError(null)

    const isActiveWorkspace = activeDocumentRef.current?.id === workspaceId
    retiredWorkspaceIdsRef.current.add(workspaceId)

    try {
      await invoke('delete_node_workspace', {
        sourceLabel,
        workspaceId,
      })

      const nextDocuments = await refreshDocumentList()

      if (isActiveWorkspace) {
        const nextSummary = nextDocuments[0] ?? null

        if (!nextSummary) {
          activeDocumentRef.current = null
          setActiveDocument(null)
          setSelectedNodeId(null)
          setFieldFilter('')
          setDirty(false)
          revisionRef.current = 0
        } else {
          const nextDocument = await invoke<NodeWorkspaceDocument>('load_node_workspace', {
            sourceLabel,
            workspaceId: nextSummary.id,
          })

          activeDocumentRef.current = nextDocument
          setActiveDocument(nextDocument)
          setSelectedNodeId(nextDocument.nodes[0]?.id ?? null)
          setFieldFilter('')
          setDirty(false)
          revisionRef.current = 0
        }
      }
    } catch (deleteError) {
      retiredWorkspaceIdsRef.current.delete(workspaceId)
      setWorkspaceError(normalizeError(deleteError))
    } finally {
      setLoadingDocument(false)
    }
  }

  function mutateActiveDocument(
    updater: (current: NodeWorkspaceDocument) => NodeWorkspaceDocument,
  ) {
    const current = activeDocumentRef.current
    if (!current) {
      return
    }

    const nextDocument = updater(current)
    revisionRef.current += 1
    activeDocumentRef.current = nextDocument
    setActiveDocument(nextDocument)
    setDirty(true)
  }

  function addRootNode(symbolName: string) {
    const current = activeDocumentRef.current
    if (!current) {
      return
    }

    const existingNode = findWorkspaceNodeBySymbolName(current, symbolName)
    if (existingNode) {
      setSelectedNodeId(existingNode.id)
      return
    }

    const index = current.nodes.length
    const nextNode: NodeWorkspaceNode = {
      id: createClientId('node'),
      symbolName,
      x: 120 + (index % 3) * 360,
      y: 96 + Math.floor(index / 3) * 220,
      selectedFieldNames: [],
    }

    mutateActiveDocument((document) => ({
      ...document,
      nodes: [...document.nodes, nextNode],
    }))
    setSelectedNodeId(nextNode.id)
  }

  function addRootNodeFromSearch(symbolName: string) {
    addRootNode(symbolName)
    setSearchQuery('')
    setSearchResults([])
    setSearchPopoverOpen(false)
  }

  function addFieldBranchNode(
    sourceNodeId: string,
    fieldName: string,
    targetName: string,
    sourceHandleId?: string | null,
  ) {
    const current = activeDocumentRef.current
    const sourceNode = current?.nodes.find((node) => node.id === sourceNodeId)
    const sourceDetail = sourceNode ? detailCacheRef.current[sourceNode.symbolName] : null
    const branchableField =
      sourceNode && sourceDetail && sourceHandleId
        ? buildWorkspaceFieldEntries(sourceNode.symbolName, sourceDetail, detailCacheRef.current).find(
            (field) =>
              getFieldSourceHandleId(field) === sourceHandleId &&
              getBranchableFieldTarget(sourceNode.symbolName, field) === targetName &&
              field.name === fieldName,
          )
        : null

    if (!current || !sourceNode || !sourceHandleId || !branchableField) {
      return
    }

    if (targetName === sourceNode.symbolName) {
      return
    }

    const existingTargetNode = findWorkspaceNodeBySymbolName(current, targetName)
    if (existingTargetNode) {
      if (existingTargetNode.id === sourceNodeId) {
        return
      }

      const nextEdge: NodeWorkspaceEdge = {
        id: createClientId('edge'),
        sourceNodeId,
        sourceHandleId: sourceHandleId ?? null,
        targetNodeId: existingTargetNode.id,
        label: fieldName,
        kind: 'field',
      }

      if (!hasWorkspaceEdge(current, nextEdge)) {
        mutateActiveDocument((document) => ({
          ...document,
          edges: [...document.edges, nextEdge],
        }))
      }

      setSelectedNodeId(existingTargetNode.id)
      return
    }

    const branchCount = current.edges.filter(
      (edge) => edge.kind === 'field' && edge.sourceNodeId === sourceNodeId,
    ).length

    const targetNode: NodeWorkspaceNode = {
      id: createClientId('node'),
      symbolName: targetName,
      x: sourceNode.x + 380,
      y: sourceNode.y + branchCount * 164,
      selectedFieldNames: [],
    }
    const nextEdge: NodeWorkspaceEdge = {
      id: createClientId('edge'),
      sourceNodeId,
      sourceHandleId: sourceHandleId ?? null,
      targetNodeId: targetNode.id,
      label: fieldName,
      kind: 'field',
    }

    mutateActiveDocument((document) => ({
      ...document,
      nodes: [...document.nodes, targetNode],
      edges: [...document.edges, nextEdge],
    }))
    setSelectedNodeId(targetNode.id)
  }

  function addParentNode(targetNodeId: string, parentName: string) {
    const current = activeDocumentRef.current
    const targetNode = current?.nodes.find((node) => node.id === targetNodeId)
    if (!current || !targetNode) {
      return
    }

    if (parentName === targetNode.symbolName) {
      return
    }

    const existingParentNode = findWorkspaceNodeBySymbolName(current, parentName)
    if (existingParentNode) {
      if (existingParentNode.id === targetNodeId) {
        return
      }

      const nextEdge: NodeWorkspaceEdge = {
        id: createClientId('edge'),
        sourceNodeId: existingParentNode.id,
        targetNodeId,
        label: 'inherits',
        kind: 'parent',
      }

      if (!hasWorkspaceEdge(current, nextEdge)) {
        mutateActiveDocument((document) => ({
          ...document,
          edges: [...document.edges, nextEdge],
        }))
      }

      setSelectedNodeId(existingParentNode.id)
      return
    }

    const parentCount = current.edges.filter(
      (edge) => edge.kind === 'parent' && edge.targetNodeId === targetNodeId,
    ).length

    const parentNode: NodeWorkspaceNode = {
      id: createClientId('node'),
      symbolName: parentName,
      x: targetNode.x - 380,
      y: targetNode.y - 48 + parentCount * 132,
      selectedFieldNames: [],
    }
    const nextEdge: NodeWorkspaceEdge = {
      id: createClientId('edge'),
      sourceNodeId: parentNode.id,
      targetNodeId,
      label: 'inherits',
      kind: 'parent',
    }

    mutateActiveDocument((document) => ({
      ...document,
      nodes: [...document.nodes, parentNode],
      edges: [...document.edges, nextEdge],
    }))
    setSelectedNodeId(parentNode.id)
  }

  function removeNode(nodeId: string) {
    mutateActiveDocument((document) => ({
      ...document,
      nodes: document.nodes.filter((node) => node.id !== nodeId),
      edges: document.edges.filter(
        (edge) => edge.sourceNodeId !== nodeId && edge.targetNodeId !== nodeId,
      ),
    }))

    if (selectedNodeId === nodeId) {
      setSelectedNodeId(null)
    }

    if (inspectorPopover?.nodeId === nodeId) {
      setInspectorPopover(null)
      setExpandedFieldOwners([])
      setFieldFilter('')
    }
  }

  function toggleFieldSelection(nodeId: string, field: WorkspaceFieldEntry) {
    mutateActiveDocument((document) => ({
      ...document,
      nodes: document.nodes.map((node) => {
        if (node.id !== nodeId) {
          return node
        }

        const cleanedFieldNames = node.selectedFieldNames.filter((name) => {
          return !(field.ownerName === node.symbolName && name === field.name)
        })
        const nextFieldNames = isFieldSelected(node, field)
          ? cleanedFieldNames.filter((name) => name !== field.selectionId)
          : [...cleanedFieldNames.filter((name) => name !== field.selectionId), field.selectionId]

        return {
          ...node,
          selectedFieldNames: nextFieldNames,
        }
      }),
    }))
  }

  function handleNodesChange(changes: NodeChange<FlowNode>[]) {
    const nextFlowNodes = applyNodeChanges(changes, flowNodesRef.current)
    flowNodesRef.current = nextFlowNodes
    setFlowNodes(nextFlowNodes)

    for (const change of changes) {
      if (change.type === 'select' && change.selected) {
        setSelectedNodeId(change.id)
      }
    }
  }

  function commitFlowNodePositions() {
    const current = activeDocumentRef.current
    if (!current) {
      return
    }

    const flowNodeMap = new Map(flowNodesRef.current.map((node) => [node.id, node.position]))
    let changed = false
    const nextNodes = current.nodes.map((node) => {
      const nextPosition = flowNodeMap.get(node.id)
      if (!nextPosition || (nextPosition.x === node.x && nextPosition.y === node.y)) {
        return node
      }

      changed = true
      return {
        ...node,
        x: nextPosition.x,
        y: nextPosition.y,
      }
    })

    if (!changed) {
      return
    }

    revisionRef.current += 1
    const nextDocument = {
      ...current,
      nodes: nextNodes,
    }
    activeDocumentRef.current = nextDocument
    setActiveDocument(nextDocument)
    setDirty(true)
  }

  const inspectorNode =
    activeDocument?.nodes.find((node) => node.id === inspectorPopover?.nodeId) ?? null
  const inspectorDetail = inspectorNode ? detailCache[inspectorNode.symbolName] : null
  const normalizedFieldFilter = fieldFilter.trim().toLowerCase()
  const inspectorFieldEntries =
    inspectorNode && inspectorDetail
      ? buildWorkspaceFieldEntries(inspectorNode.symbolName, inspectorDetail, detailCache)
      : []
  const visibleInspectorFields = inspectorFieldEntries.filter((field) => {
      if (!normalizedFieldFilter) {
        return true
      }

      const haystack = `${field.ownerName} ${field.name} ${field.typeDisplay}`.toLowerCase()
      return haystack.includes(normalizedFieldFilter)
    })
  const visibleInspectorFieldGroups =
    inspectorNode && inspectorDetail
      ? groupWorkspaceFieldsByOwner(
          inspectorNode.symbolName,
          inspectorDetail.parents.map((parent) => parent.name),
          visibleInspectorFields,
        )
      : []
  const availableInspectorParents =
    inspectorNode && inspectorDetail
      ? inspectorDetail.parents.filter((parent) => parent.name !== inspectorNode.symbolName)
      : []
  const workspaceFileBusy = loadingDocument || savingDocument

  const pageUnavailableMessage = !runningInTauri
    ? 'Run this page through Tauri to use local node files.'
    : !sourceLabel
      ? 'Load a dump dataset first so the canvas can resolve symbols and save workspace files.'
      : null
  const titlebarSearchSlot =
    typeof document === 'undefined'
      ? null
      : document.getElementById('node-workspace-titlebar-slot')
  const sidebarFilesSlot =
    typeof document === 'undefined' ? null : document.getElementById('node-workspace-sidebar-slot')
  const contextMenuSlot = typeof document === 'undefined' ? null : document.body

  return (
    <section className="node-workspace-page">
      {titlebarSearchSlot
        ? createPortal(
            <div className="workspace-titlebar-content">
              <div ref={searchPopoverRef} className="workspace-titlebar-search-shell">
                <label className="visually-hidden" htmlFor="node-workspace-search">
                  Add Root Node
                </label>
                <div className="workspace-titlebar-search">
                  <input
                    id="node-workspace-search"
                    type="search"
                    autoComplete="off"
                    value={searchQuery}
                    placeholder="Search class, struct or enum to add..."
                    onFocus={() => setSearchPopoverOpen(true)}
                    onChange={(event) => {
                      setSearchQuery(event.target.value)
                      setSearchPopoverOpen(true)
                    }}
                    onKeyDown={(event) => {
                      if (
                        event.key === 'Enter' &&
                        searchResults.length > 0 &&
                        activeDocument &&
                        deferredSearchQuery.trim()
                      ) {
                        addRootNodeFromSearch(searchResults[0].name)
                      }
                    }}
                    disabled={!activeDocument}
                  />

                  {activeDocument && searchPopoverOpen ? (
                    <div className="workspace-titlebar-search-popover">
                      <div className="workspace-titlebar-search-popover-head">
                        <span>
                          {searchingSymbols
                            ? 'Searching...'
                            : deferredSearchQuery.trim()
                              ? 'Search Results'
                              : 'Add Root Node'}
                        </span>
                      </div>

                      <div className="workspace-titlebar-search-popover-list">
                        {searchResults.map((result) => (
                          <div key={result.name} className="workspace-titlebar-search-result">
                            <div className="workspace-titlebar-search-result-copy">
                              <div className="node-workspace-search-result-head">
                                <strong>{result.name}</strong>
                                <span>{kindLabel(result.kind)}</span>
                              </div>
                              <p>{result.subtitle || 'Add this symbol as a root node.'}</p>
                            </div>

                            <button
                              type="button"
                              className="workspace-titlebar-search-add-button"
                              onClick={() => addRootNodeFromSearch(result.name)}
                            >
                              Add
                            </button>
                          </div>
                        ))}

                        {!searchingSymbols &&
                        deferredSearchQuery.trim() &&
                        searchResults.length === 0 ? (
                          <p className="node-workspace-muted">No symbol matches the current query.</p>
                        ) : null}

                        {!deferredSearchQuery.trim() ? (
                          <p className="node-workspace-muted">
                            Search for a symbol, then add it as a root node to the current file.
                          </p>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>,
            titlebarSearchSlot,
          )
        : null}

      {sidebarFilesSlot && !pageUnavailableMessage
        ? createPortal(
            <div className="workspace-sidebar-files">
              <div className="workspace-sidebar-files-head">
                <div>
                  <strong>Node Files</strong>
                  <span>{loadingDocuments ? 'Loading files...' : `${documents.length} files`}</span>
                </div>
                <button
                  type="button"
                  className="workspace-action-button workspace-sidebar-new-button"
                  onClick={() => void createWorkspace()}
                  disabled={workspaceFileBusy}
                >
                  New File
                </button>
              </div>

              <div className="workspace-sidebar-files-list">
                {documents.map((document) => (
                  document.id === renamingDocumentId ? (
                    <div
                      key={document.id}
                      className={
                        document.id === activeDocument?.id
                          ? 'node-workspace-document-card active renaming'
                          : 'node-workspace-document-card renaming'
                      }
                    >
                      <label className="visually-hidden" htmlFor={`workspace-rename-${document.id}`}>
                        Rename node file
                      </label>
                      <input
                        id={`workspace-rename-${document.id}`}
                        ref={document.id === renamingDocumentId ? renameInputRef : null}
                        type="text"
                        className="workspace-sidebar-rename-input"
                        value={renameDraft}
                        disabled={workspaceFileBusy}
                        onChange={(event) => setRenameDraft(event.target.value)}
                        onBlur={() => void submitRenameWorkspace(document.id)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault()
                            event.currentTarget.blur()
                          }

                          if (event.key === 'Escape') {
                            event.preventDefault()
                            cancelRenameWorkspace()
                          }
                        }}
                      />
                      <span>{`${document.nodeCount} nodes | ${document.edgeCount} edges`}</span>
                      <em>Enter to save, Esc to cancel</em>
                    </div>
                  ) : (
                    <button
                      key={document.id}
                      type="button"
                      className={
                        document.id === activeDocument?.id
                          ? 'node-workspace-document-card active'
                          : 'node-workspace-document-card'
                      }
                      onClick={() => void openWorkspace(document.id)}
                      disabled={workspaceFileBusy}
                      onContextMenu={(event) => openWorkspaceFileMenu(event, document.id)}
                    >
                      <strong>{document.title}</strong>
                      <span>{`${document.nodeCount} nodes | ${document.edgeCount} edges`}</span>
                      <em>{formatUpdatedAt(document.updatedAtMs)}</em>
                    </button>
                  )
                ))}

                {!loadingDocuments && documents.length === 0 ? (
                  <p className="node-workspace-muted">
                    No node file yet. Create one, then start adding symbols into the canvas.
                  </p>
                ) : null}
              </div>
            </div>,
            sidebarFilesSlot,
          )
        : null}

      {workspaceError ? (
        <section className="node-workspace-error-banner">
          <strong>Error</strong>
          <span>{workspaceError}</span>
        </section>
      ) : null}

      {pageUnavailableMessage ? (
        <section className="node-workspace-empty-shell">
          <strong>Node Canvas</strong>
          <p>{pageUnavailableMessage}</p>
        </section>
      ) : (
        <div className="node-workspace-layout">
          <section className="node-workspace-canvas-shell">
            <div className="node-workspace-flow-shell">
              {activeDocument ? (
                <ReactFlow<FlowNode, FlowEdge>
                  key={activeDocument.id}
                  nodes={flowNodes}
                  edges={flowEdges}
                  nodeTypes={nodeTypes}
                  onNodesChange={handleNodesChange}
                  onNodeDragStart={() => {
                    updateDraggingNodes(true)
                  }}
                  onNodeDragStop={() => {
                    updateDraggingNodes(false)
                    commitFlowNodePositions()
                  }}
                  onNodeClick={((event, node) => {
                    const triggerElement =
                      event.target instanceof Element
                        ? event.target.closest('[data-node-inspector-trigger="true"]')
                        : null

                    if (triggerElement instanceof HTMLElement) {
                      openNodeInspector(node.id, triggerElement.getBoundingClientRect())
                      return
                    }

                    setSelectedNodeId(node.id)
                  }) as NodeMouseHandler<FlowNode>}
                  onNodeDoubleClick={((event, node) => {
                    const triggerElement =
                      event.target instanceof Element
                        ? event.target.closest('[data-node-inspector-trigger="true"]')
                        : null

                    if (triggerElement) {
                      return
                    }

                    onOpenSymbol(node.data.symbolName)
                  }) as NodeMouseHandler<FlowNode>}
                  onPaneClick={() => {
                    setSelectedNodeId(null)
                    setInspectorPopover(null)
                    setExpandedFieldOwners([])
                    setFieldFilter('')
                  }}
                  fitView
                  minZoom={0.2}
                  maxZoom={1.7}
                  deleteKeyCode={null}
                  nodesConnectable={false}
                  className="node-workspace-flow"
                >
                  <Background gap={20} size={1} color="rgba(255, 255, 255, 0.06)" />
                  <MiniMap
                    pannable
                    zoomable
                    className="node-workspace-minimap"
                    nodeStrokeWidth={2}
                    nodeColor={(node) => {
                      if (node.data.selected) {
                        return '#f4aa3b'
                      }

                      return '#5ba6ff'
                    }}
                  />
                  <Controls className="node-workspace-controls" showInteractive={false} />
                </ReactFlow>
              ) : (
                <div className="node-workspace-empty-canvas">
                  <strong>Node Canvas</strong>
                  <p>Create a node file, then search a symbol in the top bar and add it to the canvas.</p>
                </div>
              )}
            </div>
          </section>

        </div>
      )}

      {inspectorPopover && inspectorNode && contextMenuSlot
        ? createPortal(
            <div
              ref={inspectorPopoverRef}
              className="workspace-node-inspector-popover"
              style={{
                top: `${inspectorPopover.y}px`,
                left: `${inspectorPopover.x}px`,
              }}
            >
              <div className="workspace-node-inspector-topbar">
                <div className="workspace-node-inspector-headline">
                  <strong>{inspectorNode.symbolName}</strong>
                  <span>{inspectorDetail ? kindLabel(inspectorDetail.kind) : 'Loading...'}</span>
                </div>
                <button
                  type="button"
                  className="workspace-node-inspector-close"
                  aria-label="Close node actions"
                  onClick={() => {
                    setInspectorPopover(null)
                    setExpandedFieldOwners([])
                    setFieldFilter('')
                  }}
                >
                  x
                </button>
              </div>

              {inspectorDetail ? (
                <div className="workspace-node-inspector-body">
                  <div className="workspace-node-inspector-summary">
                    <div className="node-workspace-inspector-actions">
                      <button
                        type="button"
                        className="workspace-action-button secondary"
                        onClick={() => onOpenSymbol(inspectorNode.symbolName)}
                      >
                        Open in Browser
                      </button>
                      <button
                        type="button"
                        className="workspace-action-button secondary"
                        onClick={() => removeNode(inspectorNode.id)}
                      >
                        Remove Node
                      </button>
                    </div>
                  </div>

                  <div className="workspace-node-inspector-section">
                    <div className="node-workspace-block-head">
                      <strong>Parent Classes</strong>
                      <span>{availableInspectorParents.length} available</span>
                    </div>

                    <div className="node-workspace-chip-row">
                      {availableInspectorParents.length > 0 ? (
                        availableInspectorParents.map((parent) => (
                          <button
                            key={`${inspectorNode.id}-${parent.name}`}
                            type="button"
                            className="node-workspace-chip"
                            onClick={() => addParentNode(inspectorNode.id, parent.name)}
                          >
                            Add {parent.name}
                          </button>
                        ))
                      ) : (
                        <p className="node-workspace-muted">No parent class is recorded for this symbol.</p>
                      )}
                    </div>
                  </div>

                  <div className="workspace-node-inspector-section">
                    <div className="node-workspace-block-head">
                      <strong>Visible Fields</strong>
                      <span>{inspectorFieldEntries.filter((field) => isFieldSelected(inspectorNode, field)).length} pinned</span>
                    </div>

                    <input
                      type="search"
                      value={fieldFilter}
                      placeholder="Filter fields..."
                      onChange={(event) => setFieldFilter(event.target.value)}
                    />

                    <div className="node-workspace-field-list">
                      {visibleInspectorFieldGroups.map((group) => {
                        const pinnedCount = group.fields.filter((field) =>
                          isFieldSelected(inspectorNode, field),
                        ).length
                        const collapsed =
                          !normalizedFieldFilter && !expandedFieldOwners.includes(group.ownerName)

                        return (
                          <section
                            key={`${inspectorNode.id}-${group.ownerName}`}
                            className="workspace-field-group-card"
                            style={
                              {
                                '--workspace-field-owner-color': group.ownerColor,
                              } as CSSProperties
                            }
                          >
                            <button
                              type="button"
                              className="workspace-field-group-toggle"
                              onClick={() =>
                                setExpandedFieldOwners((current) =>
                                  current.includes(group.ownerName)
                                    ? current.filter((name) => name !== group.ownerName)
                                    : [...current, group.ownerName],
                                )
                              }
                            >
                              <span className={collapsed ? 'workspace-field-group-caret collapsed' : 'workspace-field-group-caret'}>
                                ▾
                              </span>
                              <span className="workspace-field-group-copy">
                                <strong>{group.ownerName}</strong>
                                <span>{`${group.fields.length} fields | ${pinnedCount} pinned`}</span>
                              </span>
                            </button>

                            {!collapsed ? (
                              <div className="workspace-field-group-body">
                                {group.fields.map((field) => {
                                  const checked = isFieldSelected(inspectorNode, field)

                                  return (
                                    <label
                                      key={`${inspectorNode.id}-${field.selectionId}`}
                                      className="node-workspace-field-toggle"
                                      style={
                                        {
                                          '--workspace-field-owner-color': field.ownerColor,
                                        } as CSSProperties
                                      }
                                    >
                                      <input
                                        type="checkbox"
                                        checked={checked}
                                        onChange={() => toggleFieldSelection(inspectorNode.id, field)}
                                      />
                                      <span className="node-workspace-field-toggle-copy">
                                        <strong>{field.name}</strong>
                                        <span>{field.typeDisplay}</span>
                                      </span>
                                    </label>
                                  )
                                })}
                              </div>
                            ) : null}
                          </section>
                        )
                      })}

                      {visibleInspectorFieldGroups.length === 0 ? (
                        <p className="node-workspace-muted">No field matches the current filter.</p>
                      ) : null}
                    </div>
                  </div>
                </div>
              ) : inspectorNode.symbolName in detailCache ? (
                <div className="workspace-node-inspector-body">
                  <p className="node-workspace-muted">
                    Symbol detail is unavailable for the selected node in the current dump.
                  </p>
                </div>
              ) : (
                <div className="workspace-node-inspector-body">
                  <p className="node-workspace-muted">Loading selected node details...</p>
                </div>
              )}
            </div>,
            contextMenuSlot,
          )
        : null}

      {fileMenu && contextMenuSlot
        ? createPortal(
            <div
              ref={fileMenuRef}
              className="workspace-sidebar-file-menu"
              style={{
                top: `${fileMenu.y}px`,
                left: `${fileMenu.x}px`,
              }}
            >
              <button
                type="button"
                className="workspace-sidebar-file-menu-item"
                onClick={() => beginRenameWorkspace(fileMenu.documentId)}
                disabled={workspaceFileBusy}
              >
                Rename
              </button>
              <button
                type="button"
                className="workspace-sidebar-file-menu-item danger"
                onClick={() => void deleteWorkspace(fileMenu.documentId)}
                disabled={workspaceFileBusy}
              >
                Delete
              </button>
            </div>,
            contextMenuSlot,
          )
        : null}
    </section>
  )
}

export default NodeWorkspacePage
