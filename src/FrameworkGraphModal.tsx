import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import dagre from 'dagre'
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Edge,
  type Node,
  type NodeMouseHandler,
  type NodeProps,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import './FrameworkGraphModal.css'

type SymbolKind = 'class' | 'struct' | 'enum'

interface SymbolLink {
  name: string
  kind: SymbolKind
}

interface SymbolDetail {
  name: string
  kind: SymbolKind
  directChildren: SymbolLink[]
}

interface FrameworkRoot {
  symbolName: string
  badge: string
  note: string
}

interface FrameworkNodeData extends Record<string, unknown> {
  symbolName: string
  badge: string
  note: string
  kind: SymbolKind
  isCore: boolean
  isMissing: boolean
  childCount: number
}

interface FrameworkGraphModalProps {
  open: boolean
  runningInTauri: boolean
  sourceLabel: string | null
  onClose: () => void
  onSelectSymbol: (name: string) => void
}

interface HierarchyNode {
  symbolName: string
  kind: SymbolKind
  badge: string
  note: string
  isCore: boolean
  isMissing: boolean
  children: HierarchyNode[]
}

type FlowNode = Node<FrameworkNodeData>
type FlowEdge = Edge

const frameworkRoots: FrameworkRoot[] = [
  {
    symbolName: 'UWorld',
    badge: 'World Root',
    note: 'Owns runtime world state and level context.',
  },
  {
    symbolName: 'ULevel',
    badge: 'Level',
    note: 'Represents the loaded level container.',
  },
  {
    symbolName: 'UGameInstance',
    badge: 'Runtime',
    note: 'Persistent app-level gameplay context.',
  },
  {
    symbolName: 'UGameViewportClient',
    badge: 'Viewport',
    note: 'Bridges local play and viewport rendering.',
  },
  {
    symbolName: 'ULocalPlayer',
    badge: 'Player',
    note: 'Local user slot bound to viewport and input.',
  },
  {
    symbolName: 'APlayerController',
    badge: 'Controller',
    note: 'Player input, camera and pawn possession.',
  },
  {
    symbolName: 'APawn',
    badge: 'Pawn',
    note: 'Controllable actor owned by a controller.',
  },
  {
    symbolName: 'AGameModeBase',
    badge: 'Authority',
    note: 'Server-side rules and spawning flow.',
  },
  {
    symbolName: 'AGameStateBase',
    badge: 'State',
    note: 'Replicated match state and player roster.',
  },
  {
    symbolName: 'APlayerState',
    badge: 'Player State',
    note: 'Per-player replicated runtime data.',
  },
]

const frameworkCoreEdges = [
  { from: 'UWorld', to: 'ULevel', label: 'owns level' },
  { from: 'UWorld', to: 'UGameInstance', label: 'owns' },
  { from: 'UWorld', to: 'AGameModeBase', label: 'authority' },
  { from: 'UWorld', to: 'AGameStateBase', label: 'state' },
  { from: 'UGameInstance', to: 'UGameViewportClient', label: 'viewport' },
  { from: 'UGameInstance', to: 'ULocalPlayer', label: 'local players' },
  { from: 'ULocalPlayer', to: 'APlayerController', label: 'owns' },
  { from: 'APlayerController', to: 'APawn', label: 'possesses' },
  { from: 'APlayerController', to: 'APlayerState', label: 'owns' },
  { from: 'AGameModeBase', to: 'AGameStateBase', label: 'drives' },
  { from: 'AGameStateBase', to: 'APlayerState', label: 'tracks' },
] as const

const nodeTypes = {
  frameworkNode: FrameworkNodeCard,
}

const nodeWidth = 308
const rootNodeHeight = 124
const childNodeHeight = 92

function normalizeError(error: unknown) {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}

function kindLabel(kind: SymbolKind) {
  if (kind === 'class') {
    return 'Class'
  }

  if (kind === 'struct') {
    return 'Struct'
  }

  return 'Enum'
}

function graphNodeId(symbolName: string) {
  return `symbol:${symbolName}`
}

function FrameworkNodeCard({ data }: NodeProps<FlowNode>) {
  const classes = [
    'framework-flow-node',
    data.isCore ? 'core' : 'derived',
    data.isMissing ? 'missing' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={classes}>
      <Handle
        type="target"
        position={Position.Top}
        isConnectable={false}
        className="framework-flow-handle"
      />
      <div className="framework-flow-node-badge-row">
        <span className="framework-flow-node-badge">{data.badge}</span>
        <span className="framework-flow-node-kind">{kindLabel(data.kind)}</span>
      </div>
      <strong>{data.symbolName}</strong>
      <p>{data.isMissing ? 'Not found in the current dump.' : data.note}</p>
      <span className="framework-flow-node-meta">
        {data.isMissing
          ? 'Unavailable'
          : `${data.childCount} direct subclass${data.childCount === 1 ? '' : 'es'}`}
      </span>
      <Handle
        type="source"
        position={Position.Bottom}
        isConnectable={false}
        className="framework-flow-handle"
      />
    </div>
  )
}

function FrameworkGraphModal({
  open,
  runningInTauri,
  sourceLabel,
  onClose,
  onSelectSymbol,
}: FrameworkGraphModalProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<FlowEdge>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [graphVersion, setGraphVersion] = useState(0)

  useEffect(() => {
    if (!open) {
      return
    }

    if (!runningInTauri) {
      return
    }

    let cancelled = false

    async function buildGraph() {
      const detailCache = new Map<string, Promise<SymbolDetail | null>>()

      async function loadDetail(symbolName: string) {
        let cached = detailCache.get(symbolName)
        if (!cached) {
          cached = invoke<SymbolDetail>('get_symbol_detail', { name: symbolName }).catch(
            () => null,
          )
          detailCache.set(symbolName, cached)
        }

        return cached
      }

      async function buildHierarchy(
        symbolName: string,
        badge: string,
        note: string,
        isCore: boolean,
        trail: Set<string>,
      ): Promise<HierarchyNode> {
        const cycleKey = symbolName.toLowerCase()
        if (trail.has(cycleKey)) {
          return {
            symbolName,
            kind: 'class',
            badge,
            note,
            isCore,
            isMissing: false,
            children: [],
          }
        }

        const nextTrail = new Set(trail)
        nextTrail.add(cycleKey)

        const detail = await loadDetail(symbolName)
        if (!detail) {
          return {
            symbolName,
            kind: 'class',
            badge,
            note,
            isCore,
            isMissing: true,
            children: [],
          }
        }

        const sortedChildren = [...detail.directChildren].sort((left, right) =>
          left.name.localeCompare(right.name),
        )

        const children = await Promise.all(
          sortedChildren.map((child) =>
            buildHierarchy(
              child.name,
              child.kind === 'enum' ? 'Enum' : 'Subclass',
              'Inherited child from the current dump.',
              false,
              nextTrail,
            ),
          ),
        )

        return {
          symbolName: detail.name,
          kind: detail.kind,
          badge,
          note,
          isCore,
          isMissing: false,
          children,
        }
      }

      const hierarchies = await Promise.all(
        frameworkRoots.map((root) =>
          buildHierarchy(root.symbolName, root.badge, root.note, true, new Set<string>()),
        ),
      )

      const nextNodes = new Map<string, FlowNode>()
      const nextEdges = new Map<string, FlowEdge>()

      function ensureNode(node: HierarchyNode) {
        const id = graphNodeId(node.symbolName)
        if (!nextNodes.has(id)) {
          nextNodes.set(id, {
            id,
            type: 'frameworkNode',
            position: { x: 0, y: 0 },
            draggable: true,
            data: {
              symbolName: node.symbolName,
              badge: node.badge,
              note: node.note,
              kind: node.kind,
              isCore: node.isCore,
              isMissing: node.isMissing,
              childCount: node.children.length,
            },
            sourcePosition: Position.Bottom,
            targetPosition: Position.Top,
          })
        } else if (node.isCore) {
          const existingNode = nextNodes.get(id)!
          existingNode.data = {
            ...existingNode.data,
            badge: node.badge,
            note: node.note,
            isCore: true,
            childCount: Math.max(existingNode.data.childCount, node.children.length),
          }
        }

        return id
      }

      function addHierarchy(node: HierarchyNode) {
        const parentId = ensureNode(node)

        for (const child of node.children) {
          const childId = ensureNode(child)
          const edgeId = `inherit:${parentId}:${childId}`
          nextEdges.set(edgeId, {
            id: edgeId,
            source: parentId,
            target: childId,
            type: 'smoothstep',
            label: 'subclass',
            markerEnd: {
              type: MarkerType.ArrowClosed,
              width: 16,
              height: 16,
            },
            className: 'framework-flow-edge inherit-edge',
          })
          addHierarchy(child)
        }
      }

      for (const hierarchy of hierarchies) {
        addHierarchy(hierarchy)
      }

      for (const edge of frameworkCoreEdges) {
        const sourceId = graphNodeId(edge.from)
        const targetId = graphNodeId(edge.to)
        const sourceNode = nextNodes.get(sourceId)
        const targetNode = nextNodes.get(targetId)

        if (!sourceNode || !targetNode) {
          continue
        }

        nextEdges.set(`framework:${edge.from}:${edge.to}`, {
          id: `framework:${edge.from}:${edge.to}`,
          source: sourceId,
          target: targetId,
          type: 'smoothstep',
          label: edge.label,
          markerEnd: {
            type: MarkerType.ArrowClosed,
            width: 18,
            height: 18,
          },
          className: 'framework-flow-edge core-edge',
        })
      }

      const dagreGraph = new dagre.graphlib.Graph()
      dagreGraph.setDefaultEdgeLabel(() => ({}))
      dagreGraph.setGraph({
        rankdir: 'TB',
        nodesep: 88,
        ranksep: 118,
        marginx: 220,
        marginy: 72,
      })

      for (const node of nextNodes.values()) {
        dagreGraph.setNode(node.id, {
          width: nodeWidth,
          height: node.data.isCore ? rootNodeHeight : childNodeHeight,
        })
      }

      for (const edge of nextEdges.values()) {
        dagreGraph.setEdge(edge.source, edge.target)
      }

      dagre.layout(dagreGraph)

      const laidOutNodes = [...nextNodes.values()].map((node) => {
        const position = dagreGraph.node(node.id)
        const height = node.data.isCore ? rootNodeHeight : childNodeHeight

        return {
          ...node,
          position: {
            x: position.x - nodeWidth / 2,
            y: position.y - height / 2,
          },
        }
      })

      return {
        nodes: laidOutNodes,
        edges: [...nextEdges.values()],
      }
    }

    void Promise.resolve()
      .then(() => {
        if (!cancelled) {
          setLoading(true)
          setError(null)
        }

        return buildGraph()
      })
      .then((graph) => {
        if (cancelled) {
          return
        }

        setNodes(graph.nodes)
        setEdges(graph.edges)
        setGraphVersion((version) => version + 1)
      })
      .catch((buildError) => {
        if (!cancelled) {
          setError(normalizeError(buildError))
          setNodes([])
          setEdges([])
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [open, runningInTauri, sourceLabel, setEdges, setNodes])

  if (!open) {
    return null
  }

  const graphError = !runningInTauri
    ? 'Run this UI through Tauri to load the framework graph.'
    : error

  return (
    <div className="framework-overlay" onClick={onClose}>
      <div
        className="framework-popover"
        role="dialog"
        aria-modal="true"
        aria-labelledby="framework-graph-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="framework-popover-header">
          <div className="framework-popover-title">
            <strong id="framework-graph-title">UE Framework Graph</strong>
            <span>
              Recursive subclass graph for the main runtime framework. Drag nodes or pan the
              canvas to inspect the full hierarchy.
            </span>
          </div>
          <button type="button" className="relation-close-button" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="framework-popover-body">
          <div className="framework-meta-bar">
            <span>{sourceLabel ?? 'No dump loaded'}</span>
            <span>
              {loading
                ? 'Building recursive framework graph...'
                : `${nodes.length} nodes, ${edges.length} edges`}
            </span>
          </div>

          {graphError ? <p className="framework-error-banner">{graphError}</p> : null}

          <div className="framework-flow-shell">
            {graphError ? (
              <div className="framework-flow-loading">
                <p>Framework graph is unavailable in browser preview mode.</p>
              </div>
            ) : loading && nodes.length === 0 ? (
              <div className="framework-flow-loading">
                <p>Loading framework hierarchy...</p>
              </div>
            ) : (
              <ReactFlow<FlowNode, FlowEdge>
                key={`${sourceLabel ?? 'empty'}-${graphVersion}`}
                nodes={nodes}
                edges={edges}
                nodeTypes={nodeTypes}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onNodeDoubleClick={((_, node) => {
                  if (!node.data.isMissing) {
                    onSelectSymbol(node.data.symbolName)
                  }
                }) as NodeMouseHandler<FlowNode>}
                fitView
                minZoom={0.2}
                maxZoom={1.8}
                panOnDrag
                nodesDraggable
                nodesConnectable={false}
                elementsSelectable={false}
                className="framework-flow-canvas"
              >
                <Background gap={20} size={1} color="rgba(255, 255, 255, 0.06)" />
                <MiniMap
                  pannable
                  zoomable
                  nodeStrokeWidth={2}
                  nodeColor={(node) => {
                    if (node.data.isMissing) {
                      return '#5b6677'
                    }

                    return node.data.isCore ? '#f4aa3b' : '#5ba6ff'
                  }}
                  className="framework-flow-minimap"
                />
                <Controls className="framework-flow-controls" showInteractive={false} />
              </ReactFlow>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default FrameworkGraphModal
