import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import {
  Alert,
  Box,
  Button,
  Checkbox,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  Slider,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography,
  useMediaQuery,
} from '@mui/material'
import {
  applyStoryGraphSuggestions,
  autoLayoutStoryGraph,
  createStoryGraphEdge,
  createStoryGraphNode,
  declineStoryGraphSuggestion,
  deleteStoryGraphEdge,
  deleteStoryGraphNode,
  getStoryGraph,
  updateStoryGameSettings,
  updateStoryGraphEdge,
  updateStoryGraphNodeLayout,
} from '../../services/storyApi'
import { resolveApiResourceUrl } from '../../services/httpClient'
import { canUseStoryGraphFeatures } from '../../types/auth'
import type {
  StoryGameSummary,
  StoryGraphCardSummary,
  StoryGraphDirection,
  StoryGraphEdge,
  StoryGraphNode,
  StoryGraphPayload,
  StoryGraphRelationType,
  StoryGraphScope,
  StoryGraphSuggestion,
  StoryInstructionCard,
  StoryMemoryBlock,
  StoryPlotCard,
  StoryWorldCard,
} from '../../types/story'

type StoryGraphDialogProps = {
  open: boolean
  token: string
  game: StoryGameSummary | null
  userRole: string
  worldCards: StoryWorldCard[]
  instructionCards: StoryInstructionCard[]
  plotCards: StoryPlotCard[]
  memoryBlocks: StoryMemoryBlock[]
  refreshRevision?: number
  disabled?: boolean
  onClose: () => void
  onGameUpdated: (game: StoryGameSummary) => void
  onOpenWorldCard: (card: StoryWorldCard) => void
  onOpenInstructionCard: (card: StoryInstructionCard) => void
  onOpenPlotCard: (card: StoryPlotCard) => void
  onOpenMemoryBlock: (block: StoryMemoryBlock) => void
}

type GestureState =
  | {
      type: 'node'
      pointerId: number
      nodeId: number
      startClientX: number
      startClientY: number
      startX: number
      startY: number
      latestX: number
      latestY: number
    }
  | {
      type: 'pan'
      pointerId: number
      startClientX: number
      startClientY: number
      startPanX: number
      startPanY: number
    }
  | {
      type: 'pinch'
      startDist: number
      startZoom: number
      startPanX: number
      startPanY: number
      rectLeft: number
      rectTop: number
      startMidX: number
      startMidY: number
    }

type LivePosition = { x: number; y: number; w: number; h: number }

type EdgeRegistration = {
  source: number
  target: number
  line: SVGLineElement | null
  hit: SVGLineElement | null
  label: SVGForeignObjectElement | null
}

type EdgeDraft = {
  id: number | null
  sourceNodeId: number
  targetNodeId: number
  relationType: StoryGraphRelationType
  label: string
  description: string
  direction: StoryGraphDirection
  scope: StoryGraphScope
  importance: number
  active: boolean
}

type CardTypeFilter = 'all' | 'characters' | 'world' | 'world_details' | 'rules' | 'plot' | 'memory'
type MobilePanel = 'none' | 'cards' | 'inspector' | 'ai'

const GRAPH_CANVAS_WIDTH = 5200
const GRAPH_CANVAS_HEIGHT = 3400
const NODE_WIDTH = 260
const NODE_HEIGHT = 136
const ZOOM_MIN = 0.35
const ZOOM_MAX = 1.8
const GRID_SIZE = 32
const GRAPH_LOAD_TIMEOUT_MS = 20_000
const VIEWPORT_ANIMATION_MS = 420
const COMPACT_QUERY = '(max-width: 1023.95px)'

// MoRius theme tokens — keeps the graph consistent with the rest of the app.
const T = {
  appBg: 'var(--morius-app-bg)',
  panel: 'var(--morius-card-bg)',
  elevated: 'var(--morius-elevated-bg)',
  input: 'var(--morius-input-bg)',
  border: 'var(--morius-card-border)',
  hoverBorder: 'var(--morius-hover-border)',
  accent: 'var(--morius-accent)',
  title: 'var(--morius-title-text)',
  text: 'var(--morius-text-primary)',
  muted: 'var(--morius-text-secondary)',
  radius: 'var(--morius-radius)',
  gold: 'var(--morius-gold)',
}
const CANVAS_BG = '#0b0b0f'
const GRID_LINE = 'rgba(255, 255, 255, 0.045)'
const accentSoft = (alpha: number) => `rgba(76, 141, 255, ${alpha})`

const RELATION_OPTIONS: Array<{ value: StoryGraphRelationType; label: string }> = [
  { value: 'acquaintance', label: 'Знакомство' },
  { value: 'friend', label: 'Дружба' },
  { value: 'enemy', label: 'Вражда' },
  { value: 'member_of', label: 'Состоит в' },
  { value: 'leader_of', label: 'Лидерство' },
  { value: 'works_for', label: 'Работает на' },
  { value: 'owns', label: 'Владеет' },
  { value: 'located_in', label: 'Находится в' },
  { value: 'knows_about', label: 'Знает о' },
  { value: 'rule_applies_to', label: 'Правило для' },
  { value: 'plot_about', label: 'Сюжет о' },
  { value: 'backstory_for', label: 'Предыстория' },
  { value: 'future_arc_for', label: 'Будущая арка' },
  { value: 'memory_about', label: 'Память о' },
  { value: 'custom', label: 'Своя связь' },
]

const SCOPE_OPTIONS: Array<{ value: StoryGraphScope; label: string }> = [
  { value: 'both', label: 'Обе карточки' },
  { value: 'global', label: 'Глобально' },
  { value: 'source_only', label: 'Источник' },
  { value: 'target_only', label: 'Цель' },
  { value: 'character_specific', label: 'Персонаж' },
  { value: 'location_specific', label: 'Локация' },
  { value: 'organization_specific', label: 'Организация' },
  { value: 'custom', label: 'Особое' },
]

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function formatCardType(value: StoryGraphCardSummary['card_type']): string {
  if (value === 'instruction_card') {
    return 'Правило'
  }
  if (value === 'plot_card') {
    return 'Сюжет'
  }
  if (value === 'memory_block') {
    return 'Память'
  }
  return 'Мир'
}

function formatCardSummaryType(card: StoryGraphCardSummary): string {
  if (card.kind === 'main_hero') {
    return 'Главный герой'
  }
  if (card.kind === 'npc') {
    return 'Персонаж'
  }
  return formatCardType(card.card_type)
}

function getCardTypeFilter(card: StoryGraphCardSummary): CardTypeFilter {
  if (card.card_type === 'instruction_card') {
    return 'rules'
  }
  if (card.card_type === 'plot_card') {
    return 'plot'
  }
  if (card.card_type === 'memory_block') {
    return 'memory'
  }
  if (card.kind === 'npc' || card.kind === 'main_hero') {
    return 'characters'
  }
  if (card.kind === 'world_profile' || !card.detail_type.trim()) {
    return 'world'
  }
  return 'world_details'
}

function formatRelationType(value: StoryGraphRelationType): string {
  return RELATION_OPTIONS.find((option) => option.value === value)?.label ?? 'Связь'
}

function formatSuggestionKind(value: string): string {
  if (value === 'create_card') {
    return 'Новая карточка'
  }
  if (value === 'add_node') {
    return 'Нода'
  }
  if (value === 'create_edge') {
    return 'Связь'
  }
  if (value === 'update_edge') {
    return 'Правка связи'
  }
  return 'Предложение'
}

function normalizeGraphSearch(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLocaleLowerCase('ru')
}

function createEmptyGraph(gameId: number): StoryGraphPayload {
  return {
    game_id: gameId,
    nodes: [],
    edges: [],
    available_cards: [],
    suggestions: [],
    can_edit: true,
  }
}

function summarizeSuggestionPayload(suggestion: StoryGraphSuggestion): string {
  const payload = suggestion.payload
  if (typeof payload.title === 'string') {
    return payload.title
  }
  if (typeof payload.label === 'string') {
    return payload.label
  }
  if (typeof payload.cardRef === 'string') {
    return payload.cardRef
  }
  if (typeof payload.sourceCardRef === 'string' && typeof payload.targetCardRef === 'string') {
    return `${payload.sourceCardRef} -> ${payload.targetCardRef}`
  }
  return JSON.stringify(payload).slice(0, 160)
}

export default function StoryGraphDialog({
  open,
  token,
  game,
  userRole,
  worldCards,
  instructionCards,
  plotCards,
  memoryBlocks,
  refreshRevision = 0,
  disabled = false,
  onClose,
  onGameUpdated,
  onOpenWorldCard,
  onOpenInstructionCard,
  onOpenPlotCard,
  onOpenMemoryBlock,
}: StoryGraphDialogProps) {
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const gridLayerRef = useRef<HTMLDivElement | null>(null)
  const worldLayerRef = useRef<HTMLDivElement | null>(null)
  const gestureRef = useRef<GestureState | null>(null)
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map())
  const viewStateRef = useRef({ zoom: 0.78, pan: { x: 430, y: 130 } })
  const viewRafRef = useRef<number | null>(null)
  const commitRafRef = useRef<number | null>(null)
  const nodeElementsRef = useRef<Map<number, HTMLElement>>(new Map())
  const edgeRegistryRef = useRef<Map<number, EdgeRegistration>>(new Map())
  const livePositionsRef = useRef<Map<number, LivePosition>>(new Map())
  const adjacencyRef = useRef<Map<number, number[]>>(new Map())
  const nodesByIdRef = useRef<Map<number, StoryGraphNode>>(new Map())
  const canvasSizeRef = useRef({ w: GRAPH_CANVAS_WIDTH, h: GRAPH_CANVAS_HEIGHT })
  const loadRequestRef = useRef<{ id: number; controller: AbortController } | null>(null)
  const loadSequenceRef = useRef(0)
  const hasAutoFittedGraphRef = useRef(false)
  const viewportAnimationTimerRef = useRef<number | null>(null)
  const [graph, setGraph] = useState<StoryGraphPayload | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isMutating, setIsMutating] = useState(false)
  const [isSavingSettings, setIsSavingSettings] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [selectedNodeId, setSelectedNodeId] = useState<number | null>(null)
  const [selectedEdgeId, setSelectedEdgeId] = useState<number | null>(null)
  const [connectSourceNodeId, setConnectSourceNodeId] = useState<number | null>(null)
  const [selectedCardKeys, setSelectedCardKeys] = useState<string[]>([])
  const [cardSearch, setCardSearch] = useState('')
  const [nodeSearch, setNodeSearch] = useState('')
  const [cardTypeFilter, setCardTypeFilter] = useState<CardTypeFilter>('all')
  const [zoom, setZoom] = useState(0.78)
  const [pan, setPan] = useState({ x: 430, y: 130 })
  const [isViewportAnimating, setIsViewportAnimating] = useState(false)
  const [edgeDraft, setEdgeDraft] = useState<EdgeDraft | null>(null)
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>('none')

  const isCompact = useMediaQuery(COMPACT_QUERY)

  const canUseGraph = canUseStoryGraphFeatures(userRole)
  const gameId = game?.id ?? null
  const graphPayload = graph ?? createEmptyGraph(gameId ?? 0)
  const nodesById = useMemo(() => new Map(graphPayload.nodes.map((node) => [node.id, node])), [graphPayload.nodes])
  const edgesById = useMemo(() => new Map(graphPayload.edges.map((edge) => [edge.id, edge])), [graphPayload.edges])
  const cardKeySet = useMemo(
    () => new Set(graphPayload.nodes.map((node) => `${node.card_type}:${node.card_id}`)),
    [graphPayload.nodes],
  )
  const selectedNode = selectedNodeId === null ? null : nodesById.get(selectedNodeId) ?? null
  const selectedEdge = selectedEdgeId === null ? null : edgesById.get(selectedEdgeId) ?? null
  const normalizedNodeSearch = useMemo(() => normalizeGraphSearch(nodeSearch), [nodeSearch])
  const matchingNodeIds = useMemo(() => {
    if (!normalizedNodeSearch) {
      return new Set<number>()
    }
    return new Set(
      graphPayload.nodes
        .filter((node) => {
          const card = node.card
          const searchText = normalizeGraphSearch(
            [
              card?.title,
              card?.description,
              card?.kind,
              card?.detail_type,
              formatCardType(node.card_type),
              `#${node.id}`,
            ]
              .filter(Boolean)
              .join(' '),
          )
          return searchText.includes(normalizedNodeSearch)
        })
        .map((node) => node.id),
    )
  }, [graphPayload.nodes, normalizedNodeSearch])
  const matchingNodes = useMemo(
    () => graphPayload.nodes.filter((node) => matchingNodeIds.has(node.id)),
    [graphPayload.nodes, matchingNodeIds],
  )
  const connectedNodeIds = useMemo(() => {
    const connected = new Set<number>()
    if (selectedNodeId === null) {
      return connected
    }
    connected.add(selectedNodeId)
    graphPayload.edges.forEach((edge) => {
      if (edge.source_node_id === selectedNodeId) {
        connected.add(edge.target_node_id)
      } else if (edge.target_node_id === selectedNodeId) {
        connected.add(edge.source_node_id)
      }
    })
    return connected
  }, [graphPayload.edges, selectedNodeId])
  const connectedEdgeIds = useMemo(() => {
    if (selectedNodeId === null) {
      return new Set<number>()
    }
    return new Set(
      graphPayload.edges
        .filter((edge) => edge.source_node_id === selectedNodeId || edge.target_node_id === selectedNodeId)
        .map((edge) => edge.id),
    )
  }, [graphPayload.edges, selectedNodeId])
  const canvasWidth = useMemo(
    () =>
      graphPayload.nodes.reduce(
        (maximum, node) => Math.max(maximum, node.x + (node.width || NODE_WIDTH) + 640),
        GRAPH_CANVAS_WIDTH,
      ),
    [graphPayload.nodes],
  )
  const canvasHeight = useMemo(
    () =>
      graphPayload.nodes.reduce(
        (maximum, node) => Math.max(maximum, node.y + (node.height || NODE_HEIGHT) + 640),
        GRAPH_CANVAS_HEIGHT,
      ),
    [graphPayload.nodes],
  )
  const selectedCardKeysSet = useMemo(() => new Set(selectedCardKeys), [selectedCardKeys])
  const availableCards = useMemo(() => {
    const normalizedSearch = cardSearch.trim().toLowerCase()
    const cardsByKey = new Map(
      graphPayload.available_cards.map((card) => [`${card.card_type}:${card.card_id}`, card]),
    )
    worldCards
      .filter((card) => card.kind === 'main_hero')
      .forEach((card) => {
        const key = `world_card:${card.id}`
        if (!cardsByKey.has(key)) {
          cardsByKey.set(key, {
            card_type: 'world_card',
            card_id: card.id,
            title: card.title,
            description: card.content,
            kind: card.kind,
            detail_type: card.detail_type,
            avatar_url: card.avatar_url,
            avatar_original_url: card.avatar_original_url ?? null,
            avatar_scale: card.avatar_scale,
            race: card.race,
            memory_turns: card.memory_turns,
            active: !card.is_locked,
            source: card.source,
            updated_at: card.updated_at,
          })
        }
      })
    return [...cardsByKey.values()]
      .filter((card) => !cardKeySet.has(`${card.card_type}:${card.card_id}`))
      .filter((card) => cardTypeFilter === 'all' || getCardTypeFilter(card) === cardTypeFilter)
      .filter((card) => {
        if (!normalizedSearch) {
          return true
        }
        return `${card.title} ${card.description} ${formatCardSummaryType(card)}`.toLowerCase().includes(normalizedSearch)
      })
      .sort((left, right) => {
        if (left.kind === 'main_hero' && right.kind !== 'main_hero') {
          return -1
        }
        if (right.kind === 'main_hero' && left.kind !== 'main_hero') {
          return 1
        }
        return left.title.localeCompare(right.title, 'ru', { sensitivity: 'base' })
      })
  }, [cardKeySet, cardSearch, cardTypeFilter, graphPayload.available_cards, worldCards])
  const activeConfidence = clamp(game?.graph_auto_apply_confidence ?? 0.78, 0, 1)

  const worldCardsById = useMemo(() => new Map(worldCards.map((card) => [card.id, card])), [worldCards])
  const instructionCardsById = useMemo(() => new Map(instructionCards.map((card) => [card.id, card])), [instructionCards])
  const plotCardsById = useMemo(() => new Map(plotCards.map((card) => [card.id, card])), [plotCards])
  const memoryBlocksById = useMemo(() => new Map(memoryBlocks.map((block) => [block.id, block])), [memoryBlocks])

  // Keep refs in sync so the imperative gesture handlers stay identity-stable
  // (and therefore don't force the memoized node/edge components to re-render).
  useEffect(() => {
    nodesByIdRef.current = nodesById
  }, [nodesById])
  useEffect(() => {
    canvasSizeRef.current = { w: canvasWidth, h: canvasHeight }
  }, [canvasWidth, canvasHeight])
  useEffect(() => {
    const positions = new Map<number, LivePosition>()
    graphPayload.nodes.forEach((node) => {
      positions.set(node.id, {
        x: node.x,
        y: node.y,
        w: node.width || NODE_WIDTH,
        h: node.height || NODE_HEIGHT,
      })
    })
    livePositionsRef.current = positions
  }, [graphPayload.nodes])
  useEffect(() => {
    const adjacency = new Map<number, number[]>()
    graphPayload.edges.forEach((edge) => {
      const forSource = adjacency.get(edge.source_node_id)
      if (forSource) {
        forSource.push(edge.id)
      } else {
        adjacency.set(edge.source_node_id, [edge.id])
      }
      const forTarget = adjacency.get(edge.target_node_id)
      if (forTarget) {
        forTarget.push(edge.id)
      } else {
        adjacency.set(edge.target_node_id, [edge.id])
      }
    })
    adjacencyRef.current = adjacency
  }, [graphPayload.edges])

  const applyView = useCallback(() => {
    const { zoom: currentZoom, pan: currentPan } = viewStateRef.current
    const layer = worldLayerRef.current
    if (layer) {
      layer.style.transform = `translate3d(${currentPan.x}px, ${currentPan.y}px, 0) scale(${currentZoom})`
    }
    const gridLayer = gridLayerRef.current
    if (gridLayer) {
      gridLayer.style.backgroundSize = `${GRID_SIZE * currentZoom}px ${GRID_SIZE * currentZoom}px`
      gridLayer.style.backgroundPosition = `${currentPan.x}px ${currentPan.y}px`
    }
  }, [])

  const scheduleView = useCallback(() => {
    if (viewRafRef.current !== null) {
      return
    }
    viewRafRef.current = window.requestAnimationFrame(() => {
      viewRafRef.current = null
      applyView()
    })
  }, [applyView])

  const commitView = useCallback(() => {
    const { zoom: nextZoom, pan: nextPan } = viewStateRef.current
    setZoom(nextZoom)
    setPan(nextPan)
    applyView()
  }, [applyView])

  const commitViewSoon = useCallback(() => {
    if (commitRafRef.current !== null) {
      return
    }
    commitRafRef.current = window.requestAnimationFrame(() => {
      commitRafRef.current = null
      const { zoom: nextZoom, pan: nextPan } = viewStateRef.current
      setZoom(nextZoom)
      setPan(nextPan)
    })
  }, [])

  const updateEdgesForNode = useCallback((nodeId: number) => {
    const edgeIds = adjacencyRef.current.get(nodeId)
    if (!edgeIds) {
      return
    }
    const positions = livePositionsRef.current
    edgeIds.forEach((edgeId) => {
      const registration = edgeRegistryRef.current.get(edgeId)
      if (!registration) {
        return
      }
      const source = positions.get(registration.source)
      const target = positions.get(registration.target)
      if (!source || !target) {
        return
      }
      const sourceX = source.x + source.w / 2
      const sourceY = source.y + source.h / 2
      const targetX = target.x + target.w / 2
      const targetY = target.y + target.h / 2
      if (registration.line) {
        registration.line.setAttribute('x1', String(sourceX))
        registration.line.setAttribute('y1', String(sourceY))
        registration.line.setAttribute('x2', String(targetX))
        registration.line.setAttribute('y2', String(targetY))
      }
      if (registration.hit) {
        registration.hit.setAttribute('x1', String(sourceX))
        registration.hit.setAttribute('y1', String(sourceY))
        registration.hit.setAttribute('x2', String(targetX))
        registration.hit.setAttribute('y2', String(targetY))
      }
      if (registration.label) {
        registration.label.setAttribute('x', String((sourceX + targetX) / 2 - 74))
        registration.label.setAttribute('y', String((sourceY + targetY) / 2 - 18))
      }
    })
  }, [])

  const registerNodeEl = useCallback((nodeId: number, element: HTMLElement | null) => {
    if (element) {
      nodeElementsRef.current.set(nodeId, element)
    } else {
      nodeElementsRef.current.delete(nodeId)
    }
  }, [])

  const registerEdge = useCallback((edgeId: number, registration: EdgeRegistration | null) => {
    if (registration) {
      edgeRegistryRef.current.set(edgeId, registration)
    } else {
      edgeRegistryRef.current.delete(edgeId)
    }
  }, [])

  const fitNodesInViewport = useCallback((nodes: StoryGraphNode[], options?: { animate?: boolean; maxZoom?: number; padding?: number }) => {
    const viewport = viewportRef.current
    if (!viewport || nodes.length === 0) {
      return
    }
    const rect = viewport.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) {
      return
    }
    const minX = Math.min(...nodes.map((node) => node.x))
    const minY = Math.min(...nodes.map((node) => node.y))
    const maxX = Math.max(...nodes.map((node) => node.x + (node.width || NODE_WIDTH)))
    const maxY = Math.max(...nodes.map((node) => node.y + (node.height || NODE_HEIGHT)))
    const contentWidth = Math.max(maxX - minX, NODE_WIDTH)
    const contentHeight = Math.max(maxY - minY, NODE_HEIGHT)
    const padding = options?.padding ?? 72
    const nextZoom = clamp(
      Math.min(
        (rect.width - padding * 2) / contentWidth,
        (rect.height - padding * 2) / contentHeight,
        options?.maxZoom ?? 1.15,
      ),
      ZOOM_MIN,
      ZOOM_MAX,
    )
    const nextPan = {
      x: (rect.width - contentWidth * nextZoom) / 2 - minX * nextZoom,
      y: (rect.height - contentHeight * nextZoom) / 2 - minY * nextZoom,
    }
    if (viewportAnimationTimerRef.current !== null) {
      window.clearTimeout(viewportAnimationTimerRef.current)
      viewportAnimationTimerRef.current = null
    }
    if (options?.animate) {
      setIsViewportAnimating(true)
      viewportAnimationTimerRef.current = window.setTimeout(() => {
        viewportAnimationTimerRef.current = null
        setIsViewportAnimating(false)
      }, VIEWPORT_ANIMATION_MS)
    } else {
      setIsViewportAnimating(false)
    }
    viewStateRef.current = { zoom: nextZoom, pan: nextPan }
    setZoom(nextZoom)
    setPan(nextPan)
  }, [])

  const loadGraph = useCallback(async () => {
    if (!open || gameId === null || !canUseGraph) {
      return
    }
    loadRequestRef.current?.controller.abort()
    const controller = new AbortController()
    loadSequenceRef.current += 1
    const requestId = loadSequenceRef.current
    loadRequestRef.current = { id: requestId, controller }
    let timedOut = false
    const timeoutId = window.setTimeout(() => {
      timedOut = true
      controller.abort()
    }, GRAPH_LOAD_TIMEOUT_MS)
    setIsLoading(true)
    setErrorMessage('')
    try {
      const nextGraph = await getStoryGraph({ token, gameId, signal: controller.signal })
      if (loadRequestRef.current?.id !== requestId) {
        return
      }
      setGraph(nextGraph)
      setSelectedCardKeys([])
      if (!hasAutoFittedGraphRef.current && nextGraph.nodes.length > 0) {
        hasAutoFittedGraphRef.current = true
        window.requestAnimationFrame(() => fitNodesInViewport(nextGraph.nodes))
      }
    } catch (error) {
      if (loadRequestRef.current?.id !== requestId || (!timedOut && controller.signal.aborted)) {
        return
      }
      setErrorMessage(
        timedOut
          ? 'Граф не загрузился за 20 секунд. Проверьте соединение и нажмите «Обновить».'
          : error instanceof Error
            ? error.message
            : 'Не удалось загрузить граф',
      )
    } finally {
      window.clearTimeout(timeoutId)
      if (loadRequestRef.current?.id === requestId) {
        loadRequestRef.current = null
        setIsLoading(false)
      }
    }
  }, [canUseGraph, fitNodesInViewport, gameId, open, token])

  useEffect(() => {
    void loadGraph()
  }, [loadGraph, refreshRevision])

  useEffect(
    () => () => {
      loadRequestRef.current?.controller.abort()
      loadRequestRef.current = null
    },
    [],
  )

  useEffect(() => {
    if (!open) {
      loadRequestRef.current?.controller.abort()
      loadRequestRef.current = null
      setGraph(null)
      setSelectedNodeId(null)
      setSelectedEdgeId(null)
      setConnectSourceNodeId(null)
      setNodeSearch('')
      setEdgeDraft(null)
      setErrorMessage('')
      setMobilePanel('none')
      pointersRef.current.clear()
      gestureRef.current = null
      hasAutoFittedGraphRef.current = false
    }
  }, [open])

  useEffect(() => {
    hasAutoFittedGraphRef.current = false
  }, [gameId])

  useEffect(() => {
    setSelectedCardKeys((previousKeys) => previousKeys.filter((key) => availableCards.some((card) => `${card.card_type}:${card.card_id}` === key)))
  }, [availableCards])

  // Keep the imperative view ref in lockstep with React state so gestures that
  // read viewStateRef always start from the last committed transform.
  useEffect(() => {
    viewStateRef.current = { zoom, pan }
    applyView()
  }, [applyView, pan, zoom])

  useEffect(() => {
    if (!open || !normalizedNodeSearch || matchingNodes.length === 0) {
      return
    }
    const timeoutId = window.setTimeout(() => {
      fitNodesInViewport(matchingNodes, {
        animate: true,
        maxZoom: matchingNodes.length === 1 ? 1.18 : 1.08,
        padding: matchingNodes.length === 1 ? 150 : 96,
      })
    }, 160)
    return () => window.clearTimeout(timeoutId)
  }, [fitNodesInViewport, matchingNodes, normalizedNodeSearch, open])

  useEffect(
    () => () => {
      if (viewportAnimationTimerRef.current !== null) {
        window.clearTimeout(viewportAnimationTimerRef.current)
      }
      if (viewRafRef.current !== null) {
        window.cancelAnimationFrame(viewRafRef.current)
      }
      if (commitRafRef.current !== null) {
        window.cancelAnimationFrame(commitRafRef.current)
      }
    },
    [],
  )

  const replaceGraph = useCallback((nextGraph: StoryGraphPayload) => {
    setGraph(nextGraph)
    setSelectedCardKeys([])
    setSelectedNodeId((nodeId) => (nodeId !== null && nextGraph.nodes.some((node) => node.id === nodeId) ? nodeId : null))
    setSelectedEdgeId((edgeId) => (edgeId !== null && nextGraph.edges.some((edge) => edge.id === edgeId) ? edgeId : null))
  }, [])

  const mergeNode = useCallback((node: StoryGraphNode) => {
    setGraph((previousGraph) => {
      const base = previousGraph ?? createEmptyGraph(game?.id ?? node.game_id)
      const exists = base.nodes.some((item) => item.id === node.id)
      return {
        ...base,
        nodes: exists ? base.nodes.map((item) => (item.id === node.id ? node : item)) : [...base.nodes, node],
      }
    })
  }, [game?.id])

  const mergeEdge = useCallback((edge: StoryGraphEdge) => {
    setGraph((previousGraph) => {
      const base = previousGraph ?? createEmptyGraph(game?.id ?? edge.game_id)
      const exists = base.edges.some((item) => item.id === edge.id)
      return {
        ...base,
        edges: exists ? base.edges.map((item) => (item.id === edge.id ? edge : item)) : [...base.edges, edge],
      }
    })
  }, [game?.id])

  const persistNodeLayout = useCallback((node: StoryGraphNode) => {
    if (!game) {
      return
    }
    updateStoryGraphNodeLayout({
      token,
      gameId: game.id,
      nodeId: node.id,
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height,
    })
      .then(mergeNode)
      .catch((error: unknown) => {
        setErrorMessage(error instanceof Error ? error.message : 'Не удалось сохранить позицию ноды')
      })
  }, [game, mergeNode, token])

  const getViewportCenterWorld = useCallback(() => {
    const rect = viewportRef.current?.getBoundingClientRect()
    const { zoom: currentZoom, pan: currentPan } = viewStateRef.current
    if (!rect) {
      return { x: 520, y: 320 }
    }
    return {
      x: (rect.width / 2 - currentPan.x) / currentZoom,
      y: (rect.height / 2 - currentPan.y) / currentZoom,
    }
  }, [])

  const addCardNode = useCallback(
    async (card: StoryGraphCardSummary, offsetIndex = 0) => {
      if (!game) {
        return null
      }
      const center = getViewportCenterWorld()
      const x = clamp(center.x - NODE_WIDTH / 2 + offsetIndex * 28, 40, GRAPH_CANVAS_WIDTH - NODE_WIDTH - 40)
      const y = clamp(center.y - NODE_HEIGHT / 2 + offsetIndex * 24, 40, GRAPH_CANVAS_HEIGHT - NODE_HEIGHT - 40)
      const node = await createStoryGraphNode({
        token,
        gameId: game.id,
        cardType: card.card_type,
        cardId: card.card_id,
        x,
        y,
      })
      mergeNode(node)
      setSelectedNodeId(node.id)
      return node
    },
    [game, getViewportCenterWorld, mergeNode, token],
  )

  const handleAddCardNode = useCallback(
    async (card: StoryGraphCardSummary) => {
      setIsMutating(true)
      setErrorMessage('')
      try {
        await addCardNode(card)
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : 'Не удалось добавить ноду')
      } finally {
        setIsMutating(false)
      }
    },
    [addCardNode],
  )

  const handleAddSelectedNodes = useCallback(async () => {
    const selectedCards = availableCards.filter((card) => selectedCardKeysSet.has(`${card.card_type}:${card.card_id}`))
    if (selectedCards.length === 0) {
      return
    }
    setIsMutating(true)
    setErrorMessage('')
    try {
      const createdNodes: StoryGraphNode[] = []
      for (const card of selectedCards) {
        const node = await addCardNode(card, createdNodes.length)
        if (node) {
          createdNodes.push(node)
        }
      }
      setSelectedCardKeys([])
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Не удалось добавить выбранные ноды')
    } finally {
      setIsMutating(false)
    }
  }, [addCardNode, availableCards, selectedCardKeysSet])

  const handleAutoLayout = useCallback(async () => {
    if (!game) {
      return
    }
    setIsMutating(true)
    setErrorMessage('')
    try {
      const nextGraph = await autoLayoutStoryGraph({ token, gameId: game.id })
      replaceGraph(nextGraph)
      window.requestAnimationFrame(() => fitNodesInViewport(nextGraph.nodes, { animate: true }))
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Не удалось разложить граф')
    } finally {
      setIsMutating(false)
    }
  }, [fitNodesInViewport, game, replaceGraph, token])

  const handleApplySuggestion = useCallback(
    async (suggestionId: number) => {
      if (!game) {
        return
      }
      setIsMutating(true)
      setErrorMessage('')
      try {
        const result = await applyStoryGraphSuggestions({ token, gameId: game.id, suggestionIds: [suggestionId] })
        replaceGraph(result.graph)
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : 'Не удалось применить предложение')
      } finally {
        setIsMutating(false)
      }
    },
    [game, replaceGraph, token],
  )

  const handleDeclineSuggestion = useCallback(
    async (suggestionId: number) => {
      if (!game) {
        return
      }
      setIsMutating(true)
      setErrorMessage('')
      try {
        replaceGraph(await declineStoryGraphSuggestion({ token, gameId: game.id, suggestionId }))
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : 'Не удалось скрыть предложение')
      } finally {
        setIsMutating(false)
      }
    },
    [game, replaceGraph, token],
  )

  const openEdgeDraft = useCallback((edge: StoryGraphEdge | null, sourceNodeId?: number, targetNodeId?: number) => {
    if (edge) {
      setEdgeDraft({
        id: edge.id,
        sourceNodeId: edge.source_node_id,
        targetNodeId: edge.target_node_id,
        relationType: edge.relation_type,
        label: edge.label,
        description: edge.description,
        direction: edge.direction,
        scope: edge.scope,
        importance: edge.importance,
        active: edge.active,
      })
      return
    }
    if (typeof sourceNodeId !== 'number' || typeof targetNodeId !== 'number') {
      return
    }
    setEdgeDraft({
      id: null,
      sourceNodeId,
      targetNodeId,
      relationType: 'custom',
      label: '',
      description: '',
      direction: 'directed',
      scope: 'both',
      importance: 3,
      active: true,
    })
  }, [])

  const handleSaveEdgeDraft = useCallback(async () => {
    if (!game || !edgeDraft) {
      return
    }
    setIsMutating(true)
    setErrorMessage('')
    try {
      const label = edgeDraft.label.trim()
      const description = edgeDraft.description.trim()
      if (edgeDraft.id === null) {
        mergeEdge(
          await createStoryGraphEdge({
            token,
            gameId: game.id,
            sourceNodeId: edgeDraft.sourceNodeId,
            targetNodeId: edgeDraft.targetNodeId,
            relationType: edgeDraft.relationType,
            label,
            description,
            direction: edgeDraft.direction,
            scope: edgeDraft.scope,
            importance: edgeDraft.importance,
            active: edgeDraft.active,
          }),
        )
      } else {
        mergeEdge(
          await updateStoryGraphEdge({
            token,
            gameId: game.id,
            edgeId: edgeDraft.id,
            relationType: edgeDraft.relationType,
            label,
            description,
            direction: edgeDraft.direction,
            scope: edgeDraft.scope,
            importance: edgeDraft.importance,
            active: edgeDraft.active,
          }),
        )
      }
      setEdgeDraft(null)
      setConnectSourceNodeId(null)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Не удалось сохранить связь')
    } finally {
      setIsMutating(false)
    }
  }, [edgeDraft, game, mergeEdge, token])

  const handleDeleteSelectedEdge = useCallback(async () => {
    if (!game || !selectedEdge) {
      return
    }
    setIsMutating(true)
    setErrorMessage('')
    try {
      await deleteStoryGraphEdge({ token, gameId: game.id, edgeId: selectedEdge.id })
      setGraph((previousGraph) =>
        previousGraph
          ? {
              ...previousGraph,
              edges: previousGraph.edges.filter((edge) => edge.id !== selectedEdge.id),
            }
          : previousGraph,
      )
      setSelectedEdgeId(null)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Не удалось удалить связь')
    } finally {
      setIsMutating(false)
    }
  }, [game, selectedEdge, token])

  const handleDeleteSelectedNode = useCallback(async () => {
    if (!game || !selectedNode) {
      return
    }
    setIsMutating(true)
    setErrorMessage('')
    try {
      await deleteStoryGraphNode({ token, gameId: game.id, nodeId: selectedNode.id, deleteEdges: true })
      setGraph((previousGraph) =>
        previousGraph
          ? {
              ...previousGraph,
              nodes: previousGraph.nodes.filter((node) => node.id !== selectedNode.id),
              edges: previousGraph.edges.filter(
                (edge) => edge.source_node_id !== selectedNode.id && edge.target_node_id !== selectedNode.id,
              ),
            }
          : previousGraph,
      )
      setSelectedNodeId(null)
      setSelectedEdgeId(null)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Не удалось удалить ноду')
    } finally {
      setIsMutating(false)
    }
  }, [game, selectedNode, token])

  const handleOpenSelectedCard = useCallback(() => {
    if (!selectedNode) {
      return
    }
    if (selectedNode.card_type === 'world_card') {
      const card = worldCardsById.get(selectedNode.card_id)
      if (card) {
        onOpenWorldCard(card)
        onClose()
      }
      return
    }
    if (selectedNode.card_type === 'instruction_card') {
      const card = instructionCardsById.get(selectedNode.card_id)
      if (card) {
        onOpenInstructionCard(card)
        onClose()
      }
      return
    }
    if (selectedNode.card_type === 'plot_card') {
      const card = plotCardsById.get(selectedNode.card_id)
      if (card) {
        onOpenPlotCard(card)
        onClose()
      }
      return
    }
    const block = memoryBlocksById.get(selectedNode.card_id)
    if (block) {
      onOpenMemoryBlock(block)
      onClose()
    }
  }, [
    instructionCardsById,
    memoryBlocksById,
    onClose,
    onOpenInstructionCard,
    onOpenMemoryBlock,
    onOpenPlotCard,
    onOpenWorldCard,
    plotCardsById,
    selectedNode,
    worldCardsById,
  ])

  // ----- Node drag (imperative, identity-stable handlers) -----
  const handleNodePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>, node: StoryGraphNode) => {
      if (event.button !== 0 && event.pointerType === 'mouse') {
        return
      }
      event.preventDefault()
      event.stopPropagation()
      setIsViewportAnimating(false)
      setNodeSearch('')
      setSelectedNodeId(node.id)
      setSelectedEdgeId(null)
      event.currentTarget.setPointerCapture(event.pointerId)
      const position = livePositionsRef.current.get(node.id)
      const startX = position?.x ?? node.x
      const startY = position?.y ?? node.y
      gestureRef.current = {
        type: 'node',
        pointerId: event.pointerId,
        nodeId: node.id,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startX,
        startY,
        latestX: startX,
        latestY: startY,
      }
    },
    [],
  )

  const handleNodePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const gesture = gestureRef.current
      if (!gesture || gesture.type !== 'node' || gesture.pointerId !== event.pointerId) {
        return
      }
      const { zoom: currentZoom } = viewStateRef.current
      const { w: cw, h: ch } = canvasSizeRef.current
      const x = clamp(gesture.startX + (event.clientX - gesture.startClientX) / currentZoom, 20, cw - NODE_WIDTH - 20)
      const y = clamp(gesture.startY + (event.clientY - gesture.startClientY) / currentZoom, 20, ch - NODE_HEIGHT - 20)
      gesture.latestX = x
      gesture.latestY = y
      const position = livePositionsRef.current.get(gesture.nodeId)
      if (position) {
        position.x = x
        position.y = y
      }
      const element = nodeElementsRef.current.get(gesture.nodeId)
      if (element) {
        element.style.transform = `translate3d(${x}px, ${y}px, 0)`
      }
      updateEdgesForNode(gesture.nodeId)
    },
    [updateEdgesForNode],
  )

  const handleNodePointerEnd = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const gesture = gestureRef.current
      if (!gesture || gesture.type !== 'node' || gesture.pointerId !== event.pointerId) {
        return
      }
      gestureRef.current = null
      const node = nodesByIdRef.current.get(gesture.nodeId)
      if (node && (node.x !== gesture.latestX || node.y !== gesture.latestY)) {
        const updated = { ...node, x: gesture.latestX, y: gesture.latestY }
        setGraph((previousGraph) =>
          previousGraph
            ? { ...previousGraph, nodes: previousGraph.nodes.map((item) => (item.id === node.id ? updated : item)) }
            : previousGraph,
        )
        persistNodeLayout(updated)
      }
    },
    [persistNodeLayout],
  )

  // ----- Viewport pan / pinch (imperative) -----
  const beginPinch = useCallback(() => {
    const points = [...pointersRef.current.values()]
    if (points.length < 2) {
      return
    }
    const [a, b] = points
    const rect = viewportRef.current?.getBoundingClientRect()
    const { zoom: currentZoom, pan: currentPan } = viewStateRef.current
    gestureRef.current = {
      type: 'pinch',
      startDist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
      startZoom: currentZoom,
      startPanX: currentPan.x,
      startPanY: currentPan.y,
      rectLeft: rect?.left ?? 0,
      rectTop: rect?.top ?? 0,
      startMidX: (a.x + b.x) / 2,
      startMidY: (a.y + b.y) / 2,
    }
  }, [])

  const handleViewportPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const target = event.target
    if (target instanceof Element && target.closest('[data-graph-interactive="true"]')) {
      return
    }
    if (event.button !== 0 && event.pointerType === 'mouse') {
      return
    }
    event.preventDefault()
    setIsViewportAnimating(false)
    event.currentTarget.setPointerCapture(event.pointerId)
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    const count = pointersRef.current.size
    if (count >= 2) {
      beginPinch()
      return
    }
    const { pan: currentPan } = viewStateRef.current
    gestureRef.current = {
      type: 'pan',
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startPanX: currentPan.x,
      startPanY: currentPan.y,
    }
    setSelectedNodeId(null)
    setSelectedEdgeId(null)
  }, [beginPinch])

  const handleViewportPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointersRef.current.has(event.pointerId)) {
      return
    }
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    const gesture = gestureRef.current
    if (!gesture) {
      return
    }
    if (gesture.type === 'pan') {
      if (gesture.pointerId !== event.pointerId) {
        return
      }
      viewStateRef.current = {
        zoom: viewStateRef.current.zoom,
        pan: {
          x: gesture.startPanX + (event.clientX - gesture.startClientX),
          y: gesture.startPanY + (event.clientY - gesture.startClientY),
        },
      }
      scheduleView()
      return
    }
    if (gesture.type === 'pinch') {
      const points = [...pointersRef.current.values()]
      if (points.length < 2) {
        return
      }
      const [a, b] = points
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1
      const midX = (a.x + b.x) / 2
      const midY = (a.y + b.y) / 2
      const nextZoom = clamp(gesture.startZoom * (dist / gesture.startDist), ZOOM_MIN, ZOOM_MAX)
      const worldX = (gesture.startMidX - gesture.rectLeft - gesture.startPanX) / gesture.startZoom
      const worldY = (gesture.startMidY - gesture.rectTop - gesture.startPanY) / gesture.startZoom
      viewStateRef.current = {
        zoom: nextZoom,
        pan: {
          x: midX - gesture.rectLeft - worldX * nextZoom,
          y: midY - gesture.rectTop - worldY * nextZoom,
        },
      }
      scheduleView()
    }
  }, [scheduleView])

  const handleViewportPointerEnd = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (pointersRef.current.has(event.pointerId)) {
      pointersRef.current.delete(event.pointerId)
      try {
        event.currentTarget.releasePointerCapture(event.pointerId)
      } catch {
        // pointer capture may already be released
      }
    }
    const gesture = gestureRef.current
    if (!gesture || gesture.type === 'node') {
      return
    }
    const remaining = pointersRef.current.size
    if (remaining === 0) {
      gestureRef.current = null
      commitView()
      return
    }
    if (remaining === 1) {
      // Fall back to a pan driven by the finger still on the canvas.
      const [entry] = [...pointersRef.current.entries()]
      const [pointerId, point] = entry
      const { pan: currentPan } = viewStateRef.current
      gestureRef.current = {
        type: 'pan',
        pointerId,
        startClientX: point.x,
        startClientY: point.y,
        startPanX: currentPan.x,
        startPanY: currentPan.y,
      }
    }
  }, [commitView])

  const handleNativeWheel = useCallback(
    (event: globalThis.WheelEvent) => {
      const viewportNode = viewportRef.current
      const target = event.target
      if (!viewportNode || !(target instanceof Node) || !viewportNode.contains(target)) {
        return
      }
      event.preventDefault()
      event.stopPropagation()
      setIsViewportAnimating(false)
      const rect = viewportNode.getBoundingClientRect()
      const { zoom: currentZoom, pan: currentPan } = viewStateRef.current
      const deltaMultiplier = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rect.height : 1
      const normalizedDelta = event.deltaY * deltaMultiplier
      const nextZoom = clamp(currentZoom * Math.exp(-normalizedDelta * 0.0015), ZOOM_MIN, ZOOM_MAX)
      if (Math.abs(nextZoom - currentZoom) < 0.0001) {
        return
      }
      const worldX = (event.clientX - rect.left - currentPan.x) / currentZoom
      const worldY = (event.clientY - rect.top - currentPan.y) / currentZoom
      viewStateRef.current = {
        zoom: nextZoom,
        pan: {
          x: event.clientX - rect.left - worldX * nextZoom,
          y: event.clientY - rect.top - worldY * nextZoom,
        },
      }
      applyView()
      commitViewSoon()
    },
    [applyView, commitViewSoon],
  )

  useEffect(() => {
    if (!open || !canUseGraph) {
      return
    }
    document.addEventListener('wheel', handleNativeWheel, { passive: false, capture: true })
    return () => {
      document.removeEventListener('wheel', handleNativeWheel, { capture: true })
    }
  }, [canUseGraph, handleNativeWheel, open])

  const handleZoomButton = useCallback(
    (direction: 1 | -1) => {
      const viewport = viewportRef.current
      if (!viewport) {
        return
      }
      const rect = viewport.getBoundingClientRect()
      const { zoom: currentZoom, pan: currentPan } = viewStateRef.current
      const nextZoom = clamp(currentZoom * (direction === 1 ? 1.2 : 1 / 1.2), ZOOM_MIN, ZOOM_MAX)
      const centerX = rect.width / 2
      const centerY = rect.height / 2
      const worldX = (centerX - currentPan.x) / currentZoom
      const worldY = (centerY - currentPan.y) / currentZoom
      viewStateRef.current = {
        zoom: nextZoom,
        pan: { x: centerX - worldX * nextZoom, y: centerY - worldY * nextZoom },
      }
      setIsViewportAnimating(false)
      commitView()
    },
    [commitView],
  )

  const handleFitView = useCallback(() => {
    if (graphPayload.nodes.length > 0) {
      fitNodesInViewport(graphPayload.nodes, { animate: true })
    }
  }, [fitNodesInViewport, graphPayload.nodes])

  const handleNodeSelect = useCallback(
    (node: StoryGraphNode) => {
      if (connectSourceNodeId !== null && connectSourceNodeId !== node.id) {
        const existingEdge = graphPayload.edges.find(
          (edge) =>
            (edge.source_node_id === connectSourceNodeId && edge.target_node_id === node.id)
            || (edge.source_node_id === node.id && edge.target_node_id === connectSourceNodeId),
        )
        if (existingEdge) {
          openEdgeDraft(existingEdge)
          setSelectedEdgeId(existingEdge.id)
          setSelectedNodeId(null)
        } else {
          openEdgeDraft(null, connectSourceNodeId, node.id)
        }
        setConnectSourceNodeId(null)
        return
      }
      setNodeSearch('')
      setSelectedNodeId(node.id)
      setSelectedEdgeId(null)
    },
    [connectSourceNodeId, graphPayload.edges, openEdgeDraft],
  )

  const handleEdgeSelect = useCallback((edgeId: number) => {
    setNodeSearch('')
    setSelectedEdgeId(edgeId)
    setSelectedNodeId(null)
  }, [])

  const handleSettingChange = useCallback(
    async (patch: {
      autoGraphNodesEnabled?: boolean
      autoGraphEdgesEnabled?: boolean
      graphConfirmLowConfidence?: boolean
      graphAutoApplyConfidence?: number
    }) => {
      if (!game) {
        return
      }
      setIsSavingSettings(true)
      setErrorMessage('')
      try {
        const updatedGame = await updateStoryGameSettings({
          token,
          gameId: game.id,
          ...patch,
        })
        onGameUpdated(updatedGame)
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : 'Не удалось сохранить настройки графа')
      } finally {
        setIsSavingSettings(false)
      }
    },
    [game, onGameUpdated, token],
  )

  if (!canUseGraph) {
    return null
  }

  const cardsPanel = (
    <Stack spacing={1.1} sx={{ minHeight: 0, flex: 1 }}>
      <Typography sx={panelTitleSx}>Карточки</Typography>
      <TextField
        size="small"
        value={cardSearch}
        onChange={(event) => setCardSearch(event.target.value)}
        placeholder="Поиск"
        sx={darkTextFieldSx}
      />
      <FormControl size="small" fullWidth sx={darkSelectSx}>
        <InputLabel>Тип карточек</InputLabel>
        <Select
          label="Тип карточек"
          value={cardTypeFilter}
          MenuProps={graphSelectMenuProps}
          onChange={(event) => {
            setCardTypeFilter(event.target.value as CardTypeFilter)
            setSelectedCardKeys([])
          }}
        >
          <MenuItem value="all">Все типы</MenuItem>
          <MenuItem value="characters">Персонажи</MenuItem>
          <MenuItem value="world">Мир</MenuItem>
          <MenuItem value="world_details">Детали мира</MenuItem>
          <MenuItem value="rules">Правила</MenuItem>
          <MenuItem value="plot">Сюжет</MenuItem>
          <MenuItem value="memory">Память</MenuItem>
        </Select>
      </FormControl>
      <Stack direction="row" spacing={0.7}>
        <Button onClick={() => void handleAddSelectedNodes()} disabled={selectedCardKeys.length === 0 || isMutating} sx={compactButtonSx}>
          Добавить
        </Button>
        <Button
          onClick={() => setSelectedCardKeys(availableCards.map((card) => `${card.card_type}:${card.card_id}`))}
          disabled={availableCards.length === 0}
          sx={compactButtonSx}
        >
          Все
        </Button>
      </Stack>
      <Box className="morius-scrollbar" sx={{ flex: 1, minHeight: 0, overflowY: 'auto', pr: 0.4 }}>
        <Stack spacing={0.65}>
          {availableCards.map((card) => {
            const key = `${card.card_type}:${card.card_id}`
            return (
              <Box key={key} sx={cardRowSx}>
                <Checkbox
                  checked={selectedCardKeysSet.has(key)}
                  onChange={(_, checked) =>
                    setSelectedCardKeys((previousKeys) =>
                      checked ? [...previousKeys, key] : previousKeys.filter((item) => item !== key),
                    )
                  }
                  size="small"
                  sx={{ color: T.muted, p: 0.35, '&.Mui-checked': { color: T.accent } }}
                />
                <CardAvatar card={card} />
                <Stack spacing={0.1} sx={{ minWidth: 0, flex: 1 }}>
                  <Typography sx={cardRowTitleSx}>{card.title || `#${card.card_id}`}</Typography>
                  <Typography sx={cardRowMetaSx}>{formatCardSummaryType(card)}</Typography>
                </Stack>
                <Button onClick={() => void handleAddCardNode(card)} disabled={isMutating} sx={tinyButtonSx}>
                  +
                </Button>
              </Box>
            )
          })}
          {availableCards.length === 0 ? (
            <Typography sx={{ color: T.muted, fontSize: '0.84rem', lineHeight: 1.35 }}>
              Все доступные карточки уже на графе.
            </Typography>
          ) : null}
        </Stack>
      </Box>
    </Stack>
  )

  const inspectorPanel = (
    <Stack spacing={1.35}>
      <Typography sx={panelTitleSx}>Инспектор</Typography>
      <Stack spacing={0.45}>
        <TextField
          size="small"
          value={nodeSearch}
          onChange={(event) => setNodeSearch(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              setNodeSearch('')
            }
          }}
          placeholder="Поиск по нодам"
          aria-label="Поиск по нодам"
          sx={darkTextFieldSx}
        />
        {normalizedNodeSearch ? (
          <Typography
            sx={{
              color: matchingNodeIds.size > 0 ? T.accent : 'rgba(240, 157, 157, 0.9)',
              fontSize: '0.74rem',
              fontWeight: 800,
            }}
          >
            {matchingNodeIds.size > 0 ? `Совпадений: ${matchingNodeIds.size}` : 'Совпадений нет'}
          </Typography>
        ) : null}
      </Stack>
      {selectedNode ? (
        <Stack spacing={1}>
          <Typography sx={{ color: T.title, fontWeight: 900, lineHeight: 1.2 }}>
            {selectedNode.card?.title || `Нода #${selectedNode.id}`}
          </Typography>
          <Typography sx={{ color: T.muted, fontSize: '0.84rem', lineHeight: 1.45 }}>
            {selectedNode.card?.description || 'Связанная карточка не найдена.'}
          </Typography>
          <Stack direction="row" spacing={0.7} flexWrap="wrap" useFlexGap>
            <Button onClick={handleOpenSelectedCard} sx={compactButtonSx}>Открыть</Button>
            <Button onClick={() => setConnectSourceNodeId(selectedNode.id)} sx={compactButtonSx}>Связать</Button>
            <Button onClick={() => void handleDeleteSelectedNode()} disabled={isMutating} sx={dangerButtonSx}>Удалить</Button>
          </Stack>
        </Stack>
      ) : selectedEdge ? (
        <Stack spacing={1}>
          <Typography sx={{ color: T.title, fontWeight: 900, lineHeight: 1.2 }}>
            {selectedEdge.label || formatRelationType(selectedEdge.relation_type)}
          </Typography>
          <Typography sx={{ color: T.muted, fontSize: '0.84rem', lineHeight: 1.45 }}>
            {selectedEdge.description || 'Описание связи не задано.'}
          </Typography>
          <Stack direction="row" spacing={0.7} flexWrap="wrap" useFlexGap>
            <Button onClick={() => openEdgeDraft(selectedEdge)} sx={compactButtonSx}>Редактировать</Button>
            <Button onClick={() => void handleDeleteSelectedEdge()} disabled={isMutating} sx={dangerButtonSx}>Удалить</Button>
          </Stack>
        </Stack>
      ) : (
        <Typography sx={{ color: T.muted, fontSize: '0.86rem', lineHeight: 1.45 }}>
          Выберите ноду или связь на полотне.
        </Typography>
      )}
    </Stack>
  )

  const aiPanel = (
    <Stack spacing={1.35}>
      <Box sx={settingsBoxSx}>
        <Typography sx={panelTitleSx}>ИИ графа</Typography>
        <Stack spacing={1.1} sx={{ mt: 1.1 }}>
          <SettingSwitch
            label="Авто-ноды"
            tooltip="После каждого завершённого хода Gemini 2.5 Flash находит важные новые сущности, создаёт недостающие карточки и добавляет их на граф."
            checked={Boolean(game?.auto_graph_nodes_enabled)}
            disabled={isSavingSettings || disabled}
            onChange={(checked) => void handleSettingChange({ autoGraphNodesEnabled: checked })}
          />
          <SettingSwitch
            label="Авто-связи"
            tooltip="После каждого хода Gemini 2.5 Flash создаёт или обновляет связи между карточками по событиям сцены. Связи выше порога применяются автоматически."
            checked={Boolean(game?.auto_graph_edges_enabled)}
            disabled={isSavingSettings || disabled}
            onChange={(checked) => void handleSettingChange({ autoGraphEdgesEnabled: checked })}
          />
          <SettingSwitch
            label="Подтверждать низкую уверенность"
            tooltip="Действия Gemini ниже выбранного порога не применяются сразу, а попадают в «Предложения», где их можно подтвердить или отклонить."
            checked={game?.graph_confirm_low_confidence !== false}
            disabled={isSavingSettings || disabled}
            onChange={(checked) => void handleSettingChange({ graphConfirmLowConfidence: checked })}
          />
          <Stack spacing={0.55}>
            <Typography sx={{ color: T.text, fontSize: '0.82rem', fontWeight: 800 }}>
              Порог авто-применения: {Math.round(activeConfidence * 100)}%
            </Typography>
            <Slider
              value={activeConfidence}
              min={0.5}
              max={0.95}
              step={0.01}
              disabled={isSavingSettings || disabled}
              onChangeCommitted={(_, value) => {
                const nextValue = Array.isArray(value) ? value[0] : value
                void handleSettingChange({ graphAutoApplyConfidence: nextValue })
              }}
              sx={sliderSx}
            />
          </Stack>
        </Stack>
      </Box>

      <Box sx={settingsBoxSx}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
          <Typography sx={panelTitleSx}>Предложения</Typography>
          <Typography sx={{ color: T.muted, fontSize: '0.78rem', fontWeight: 800 }}>
            {graphPayload.suggestions.length}
          </Typography>
        </Stack>
        <Stack spacing={0.75} sx={{ mt: 1, maxHeight: { xs: 220, lg: 260 }, overflowY: 'auto', pr: 0.2 }} className="morius-scrollbar">
          {graphPayload.suggestions.map((suggestion) => (
            <Box key={suggestion.id} sx={suggestionBoxSx}>
              <Typography sx={{ color: T.title, fontSize: '0.82rem', fontWeight: 900 }}>
                {formatSuggestionKind(suggestion.kind)} · {Math.round((suggestion.confidence ?? 0) * 100)}%
              </Typography>
              <Typography sx={{ color: T.muted, fontSize: '0.76rem', lineHeight: 1.35 }}>
                {suggestion.reason || summarizeSuggestionPayload(suggestion)}
              </Typography>
              <Stack direction="row" spacing={0.55} sx={{ mt: 0.5 }}>
                <Button onClick={() => void handleApplySuggestion(suggestion.id)} disabled={isMutating} sx={tinyButtonSx}>ОК</Button>
                <Button onClick={() => void handleDeclineSuggestion(suggestion.id)} disabled={isMutating} sx={tinyButtonSx}>Нет</Button>
              </Stack>
            </Box>
          ))}
          {graphPayload.suggestions.length === 0 ? (
            <Typography sx={{ color: T.muted, fontSize: '0.82rem' }}>
              Очередь пуста.
            </Typography>
          ) : null}
        </Stack>
      </Box>
    </Stack>
  )

  const canvas = (
    <Box
      ref={viewportRef}
      onPointerDown={handleViewportPointerDown}
      onPointerMove={handleViewportPointerMove}
      onPointerUp={handleViewportPointerEnd}
      onPointerCancel={handleViewportPointerEnd}
      sx={{
        position: 'relative',
        flex: 1,
        minHeight: 0,
        overflow: 'hidden',
        isolation: 'isolate',
        touchAction: 'none',
        cursor: gestureRef.current?.type === 'pan' ? 'grabbing' : 'grab',
        backgroundColor: CANVAS_BG,
      }}
    >
      <Box
        aria-hidden="true"
        sx={{
          position: 'absolute',
          inset: 0,
          zIndex: 0,
          pointerEvents: 'none',
          backgroundColor: CANVAS_BG,
          transform: 'translateZ(0)',
          backfaceVisibility: 'hidden',
        }}
      />
      <Box
        ref={gridLayerRef}
        aria-hidden="true"
        style={{
          backgroundSize: `${GRID_SIZE * zoom}px ${GRID_SIZE * zoom}px`,
          backgroundPosition: `${pan.x}px ${pan.y}px`,
        }}
        sx={{
          position: 'absolute',
          inset: 0,
          zIndex: 1,
          pointerEvents: 'none',
          backgroundImage: `linear-gradient(${GRID_LINE} 1px, transparent 1px), linear-gradient(90deg, ${GRID_LINE} 1px, transparent 1px)`,
        }}
      />
      {isLoading && graph === null ? (
        <Stack spacing={1} alignItems="center" justifyContent="center" sx={{ position: 'absolute', inset: 0, zIndex: 4 }}>
          <CircularProgress size={30} sx={{ color: T.accent }} />
          <Typography sx={{ color: T.muted, fontSize: '0.9rem' }}>Загружаю граф</Typography>
        </Stack>
      ) : null}
      <Box
        ref={worldLayerRef}
        style={{ transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})` }}
        sx={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: 0,
          height: 0,
          zIndex: 2,
          transformOrigin: '0 0',
          willChange: 'transform',
          transition: isViewportAnimating ? `transform ${VIEWPORT_ANIMATION_MS}ms cubic-bezier(0.22, 1, 0.36, 1)` : 'none',
        }}
      >
        <Box
          sx={{
            position: 'relative',
            width: canvasWidth,
            height: canvasHeight,
            boxSizing: 'border-box',
            borderRadius: 'calc(var(--morius-radius) + 4px)',
            border: `1px solid ${T.border}`,
          }}
        >
          <Box component="svg" width={canvasWidth} height={canvasHeight} sx={{ position: 'absolute', inset: 0, overflow: 'visible' }}>
            <defs>
              <marker id="graph-arrow-active" markerWidth="11" markerHeight="11" refX="9" refY="3" orient="auto" markerUnits="strokeWidth">
                <path d="M0,0 L0,6 L9,3 z" fill={T.accent} />
              </marker>
              <marker id="graph-arrow-muted" markerWidth="11" markerHeight="11" refX="9" refY="3" orient="auto" markerUnits="strokeWidth">
                <path d="M0,0 L0,6 L9,3 z" fill="rgba(155, 154, 160, 0.42)" />
              </marker>
            </defs>
            {graphPayload.edges.map((edge) => {
              const source = nodesById.get(edge.source_node_id)
              const target = nodesById.get(edge.target_node_id)
              if (!source || !target) {
                return null
              }
              const hasSearchFocus = normalizedNodeSearch.length > 0 && matchingNodeIds.size > 0
              const hasSelectionFocus = selectedNodeId !== null && !hasSearchFocus
              const isConnectedToSelection = connectedEdgeIds.has(edge.id)
              const isConnectedToSearch = matchingNodeIds.has(edge.source_node_id) || matchingNodeIds.has(edge.target_node_id)
              const isSelected = selectedEdgeId === edge.id
              const isHighlighted = isSelected || (hasSelectionFocus && isConnectedToSelection)
              const opacity = hasSearchFocus
                ? isConnectedToSearch ? 0.72 : 0.08
                : hasSelectionFocus ? (isConnectedToSelection ? 1 : 0.08) : 1
              return (
                <GraphEdge
                  key={edge.id}
                  edge={edge}
                  source={source}
                  target={target}
                  isHighlighted={isHighlighted}
                  opacity={opacity}
                  onSelect={handleEdgeSelect}
                  registerEdge={registerEdge}
                />
              )
            })}
          </Box>
          {graphPayload.nodes.map((node) => {
            const isSelected = selectedNodeId === node.id
            const isConnectSource = connectSourceNodeId === node.id
            const hasSearchFocus = normalizedNodeSearch.length > 0 && matchingNodeIds.size > 0
            const isSearchMatch = matchingNodeIds.has(node.id)
            const hasSelectionFocus = selectedNodeId !== null && !hasSearchFocus
            const isConnected = connectedNodeIds.has(node.id)
            const isDimmed = hasSearchFocus ? !isSearchMatch : hasSelectionFocus ? !isConnected : false
            const isHighlighted = isSelected || isConnectSource || isSearchMatch || (hasSelectionFocus && isConnected)
            return (
              <GraphNode
                key={node.id}
                node={node}
                isSelected={isSelected}
                isConnectSource={isConnectSource}
                isSearchMatch={isSearchMatch}
                isDimmed={isDimmed}
                isHighlighted={isHighlighted}
                isConnected={isConnected}
                hasSelectionFocus={hasSelectionFocus}
                onSelect={handleNodeSelect}
                onHandlePointerDown={handleNodePointerDown}
                onHandlePointerMove={handleNodePointerMove}
                onHandlePointerEnd={handleNodePointerEnd}
                registerEl={registerNodeEl}
              />
            )
          })}
        </Box>
      </Box>

      {connectSourceNodeId !== null ? (
        <Box sx={{ position: 'absolute', left: 14, bottom: isCompact ? 86 : 14, zIndex: 6, borderRadius: T.radius, px: 1.4, py: 0.9, backgroundColor: T.elevated, border: `1px solid ${T.gold}` }}>
          <Typography sx={{ color: T.gold, fontSize: '0.84rem', fontWeight: 800 }}>
            Выберите вторую ноду для связи
          </Typography>
        </Box>
      ) : null}

      <Stack spacing={0.75} sx={{ ...floatingControlsSx, bottom: isCompact ? 84 : 16 }}>
        <IconButton aria-label="Приблизить" onClick={() => handleZoomButton(1)} sx={floatingButtonSx}>+</IconButton>
        <Box sx={{ textAlign: 'center', color: T.muted, fontSize: '0.72rem', fontWeight: 800, userSelect: 'none' }}>{Math.round(zoom * 100)}%</Box>
        <IconButton aria-label="Отдалить" onClick={() => handleZoomButton(-1)} sx={floatingButtonSx}>−</IconButton>
        <IconButton aria-label="Показать весь граф" onClick={handleFitView} sx={floatingButtonSx}>
          <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <path d="M3 7V3h4M17 7V3h-4M3 13v4h4M17 13v4h-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </IconButton>
      </Stack>
    </Box>
  )

  const mobileTabBar = (
    <Stack direction="row" spacing={0.75} sx={mobileTabBarSx}>
      <MobileTabButton label="Карточки" active={mobilePanel === 'cards'} onClick={() => setMobilePanel(mobilePanel === 'cards' ? 'none' : 'cards')} />
      <MobileTabButton label="Инспектор" active={mobilePanel === 'inspector'} badge={selectedNode || selectedEdge ? '•' : undefined} onClick={() => setMobilePanel(mobilePanel === 'inspector' ? 'none' : 'inspector')} />
      <MobileTabButton label="ИИ" active={mobilePanel === 'ai'} badge={graphPayload.suggestions.length > 0 ? String(graphPayload.suggestions.length) : undefined} onClick={() => setMobilePanel(mobilePanel === 'ai' ? 'none' : 'ai')} />
    </Stack>
  )

  return (
    <>
      <Dialog
        open={open}
        onClose={onClose}
        fullScreen
        PaperProps={{
          sx: {
            backgroundColor: CANVAS_BG,
            backgroundImage: 'none',
            color: T.text,
            overflow: 'hidden',
          },
        }}
      >
        <Box sx={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100dvh', minHeight: 0, overflow: 'hidden', backgroundColor: CANVAS_BG }}>
          <Stack
            direction="row"
            alignItems="center"
            spacing={{ xs: 0.6, md: 1 }}
            sx={{
              px: { xs: 1.2, md: 2 },
              py: 1,
              borderBottom: `1px solid ${T.border}`,
              backgroundColor: T.panel,
              flexShrink: 0,
            }}
          >
            <Typography
              sx={{
                fontFamily: '"Spectral", "Times New Roman", serif',
                fontSize: { xs: '1.1rem', md: '1.32rem' },
                fontWeight: 800,
                color: T.title,
                minWidth: 0,
                flex: 1,
              }}
            >
              Ноды
            </Typography>
            {isCompact ? (
              <>
                <Tooltip title="Обновить">
                  <span>
                    <IconButton onClick={() => void loadGraph()} disabled={isLoading || isMutating} sx={toolbarIconButtonSx} aria-label="Обновить">
                      <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                        <path d="M15.5 6.5A6 6 0 1 0 16 10" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                        <path d="M16 4v3h-3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </IconButton>
                  </span>
                </Tooltip>
                <Tooltip title="Авто-layout">
                  <span>
                    <IconButton onClick={() => void handleAutoLayout()} disabled={isMutating || graphPayload.nodes.length === 0} sx={toolbarIconButtonSx} aria-label="Авто-layout">
                      <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                        <rect x="2.5" y="2.5" width="6" height="6" rx="1.4" stroke="currentColor" strokeWidth="1.5" />
                        <rect x="11.5" y="2.5" width="6" height="6" rx="1.4" stroke="currentColor" strokeWidth="1.5" />
                        <rect x="7" y="11.5" width="6" height="6" rx="1.4" stroke="currentColor" strokeWidth="1.5" />
                      </svg>
                    </IconButton>
                  </span>
                </Tooltip>
              </>
            ) : (
              <>
                <Button onClick={() => void loadGraph()} disabled={isLoading || isMutating} sx={toolbarButtonSx}>
                  Обновить
                </Button>
                <Button onClick={() => void handleAutoLayout()} disabled={isMutating || graphPayload.nodes.length === 0} sx={toolbarButtonSx}>
                  Авто-layout
                </Button>
              </>
            )}
            <IconButton onClick={onClose} aria-label="Закрыть ноды" sx={toolbarIconButtonSx}>
              <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </IconButton>
          </Stack>

          {errorMessage ? (
            <Alert severity="error" sx={{ borderRadius: 0, flexShrink: 0 }}>
              {errorMessage}
            </Alert>
          ) : null}

          {isCompact ? (
            <Box sx={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', backgroundColor: CANVAS_BG }}>
              {canvas}
              {mobilePanel !== 'none' ? (
                <>
                  <Box
                    onPointerDown={() => setMobilePanel('none')}
                    sx={{ position: 'absolute', inset: 0, zIndex: 8, backgroundColor: 'rgba(0, 0, 0, 0.55)' }}
                  />
                  <Box
                    sx={{
                      position: 'absolute',
                      left: 0,
                      right: 0,
                      bottom: 0,
                      zIndex: 9,
                      display: 'flex',
                      flexDirection: 'column',
                      maxHeight: '82%',
                      backgroundColor: T.panel,
                      borderTop: `1px solid ${T.border}`,
                      borderTopLeftRadius: '20px',
                      borderTopRightRadius: '20px',
                      boxShadow: '0 -22px 54px rgba(0, 0, 0, 0.55)',
                      animation: 'morius-graph-sheet-up 220ms cubic-bezier(0.22, 1, 0.36, 1)',
                      '@keyframes morius-graph-sheet-up': {
                        from: { transform: 'translateY(100%)' },
                        to: { transform: 'translateY(0)' },
                      },
                    }}
                  >
                    <Box sx={{ pt: 1.1, px: 2, flexShrink: 0 }}>
                      <Box sx={{ width: 44, height: 5, borderRadius: 999, backgroundColor: T.hoverBorder, mx: 'auto' }} />
                    </Box>
                    <Box
                      className="morius-scrollbar"
                      sx={{
                        px: 2,
                        pt: 1.4,
                        pb: 'calc(18px + env(safe-area-inset-bottom))',
                        overflowY: 'auto',
                        display: 'flex',
                        flexDirection: 'column',
                        minHeight: 0,
                      }}
                    >
                      {mobilePanel === 'cards' ? cardsPanel : mobilePanel === 'inspector' ? inspectorPanel : aiPanel}
                    </Box>
                  </Box>
                </>
              ) : null}
              {mobileTabBar}
            </Box>
          ) : (
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: '300px minmax(0, 1fr) 330px',
                flex: 1,
                minHeight: 0,
              }}
            >
              <Box sx={{ ...sidePanelSx, borderRight: `1px solid ${T.border}`, display: 'flex', flexDirection: 'column' }}>
                {cardsPanel}
              </Box>
              {canvas}
              <Box sx={{ ...sidePanelSx, borderLeft: `1px solid ${T.border}`, overflowY: 'auto' }} className="morius-scrollbar">
                <Stack spacing={1.6}>
                  {inspectorPanel}
                  {aiPanel}
                </Stack>
              </Box>
            </Box>
          )}
        </Box>
      </Dialog>

      <Dialog
        open={edgeDraft !== null}
        onClose={() => setEdgeDraft(null)}
        maxWidth="sm"
        fullWidth
        PaperProps={{
          sx: {
            borderRadius: T.radius,
            border: `1px solid ${T.border}`,
            backgroundColor: T.panel,
            backgroundImage: 'none',
            color: T.text,
            boxShadow: 'var(--morius-neutral-shadow)',
          },
        }}
      >
        <DialogTitle sx={{ fontWeight: 900, color: T.title, backgroundColor: T.panel }}>{edgeDraft?.id === null ? 'Новая связь' : 'Редактирование связи'}</DialogTitle>
        <DialogContent sx={{ pt: 1, backgroundColor: T.panel }}>
          {edgeDraft ? (
            <Stack spacing={1.4} sx={{ pt: 1 }}>
              <FormControl size="small" fullWidth sx={darkSelectSx}>
                <InputLabel>Тип</InputLabel>
                <Select
                  label="Тип"
                  value={edgeDraft.relationType}
                  MenuProps={graphSelectMenuProps}
                  onChange={(event) => setEdgeDraft((draft) => draft ? { ...draft, relationType: event.target.value as StoryGraphRelationType } : draft)}
                >
                  {RELATION_OPTIONS.map((option) => (
                    <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
                  ))}
                </Select>
              </FormControl>
              <TextField
                label="Метка"
                value={edgeDraft.label}
                onChange={(event) => setEdgeDraft((draft) => draft ? { ...draft, label: event.target.value } : draft)}
                sx={darkTextFieldSx}
                fullWidth
              />
              <TextField
                label="Описание"
                value={edgeDraft.description}
                onChange={(event) => setEdgeDraft((draft) => draft ? { ...draft, description: event.target.value } : draft)}
                sx={darkTextFieldSx}
                fullWidth
                multiline
                minRows={3}
              />
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                <FormControl size="small" fullWidth sx={darkSelectSx}>
                  <InputLabel>Направление</InputLabel>
                  <Select
                    label="Направление"
                    value={edgeDraft.direction}
                    MenuProps={graphSelectMenuProps}
                    onChange={(event) => setEdgeDraft((draft) => draft ? { ...draft, direction: event.target.value as StoryGraphDirection } : draft)}
                  >
                    <MenuItem value="directed">Направленная</MenuItem>
                    <MenuItem value="undirected">Без направления</MenuItem>
                  </Select>
                </FormControl>
                <FormControl size="small" fullWidth sx={darkSelectSx}>
                  <InputLabel>Scope</InputLabel>
                  <Select
                    label="Scope"
                    value={edgeDraft.scope}
                    MenuProps={graphSelectMenuProps}
                    onChange={(event) => setEdgeDraft((draft) => draft ? { ...draft, scope: event.target.value as StoryGraphScope } : draft)}
                  >
                    {SCOPE_OPTIONS.map((option) => (
                      <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Stack>
              <Stack spacing={0.5}>
                <Typography sx={{ color: T.text, fontSize: '0.84rem', fontWeight: 800 }}>
                  Важность: {edgeDraft.importance}
                </Typography>
                <Slider
                  value={edgeDraft.importance}
                  min={1}
                  max={5}
                  step={1}
                  onChange={(_, value) => {
                    const nextValue = Array.isArray(value) ? value[0] : value
                    setEdgeDraft((draft) => draft ? { ...draft, importance: nextValue } : draft)
                  }}
                  sx={sliderSx}
                />
              </Stack>
              <SettingSwitch
                label="Активна"
                checked={edgeDraft.active}
                onChange={(checked) => setEdgeDraft((draft) => draft ? { ...draft, active: checked } : draft)}
              />
            </Stack>
          ) : null}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.2, backgroundColor: T.panel }}>
          <Button onClick={() => setEdgeDraft(null)} sx={{ color: T.muted, textTransform: 'none' }}>Отмена</Button>
          <Button onClick={() => void handleSaveEdgeDraft()} disabled={isMutating || edgeDraft === null} sx={primaryActionButtonSx}>
            Сохранить
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}

type GraphNodeProps = {
  node: StoryGraphNode
  isSelected: boolean
  isConnectSource: boolean
  isSearchMatch: boolean
  isDimmed: boolean
  isHighlighted: boolean
  isConnected: boolean
  hasSelectionFocus: boolean
  onSelect: (node: StoryGraphNode) => void
  onHandlePointerDown: (event: ReactPointerEvent<HTMLDivElement>, node: StoryGraphNode) => void
  onHandlePointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void
  onHandlePointerEnd: (event: ReactPointerEvent<HTMLDivElement>) => void
  registerEl: (nodeId: number, element: HTMLElement | null) => void
}

const GraphNode = memo(function GraphNode({
  node,
  isSelected,
  isConnectSource,
  isSearchMatch,
  isDimmed,
  isHighlighted,
  isConnected,
  hasSelectionFocus,
  onSelect,
  onHandlePointerDown,
  onHandlePointerMove,
  onHandlePointerEnd,
  registerEl,
}: GraphNodeProps) {
  const card = node.card
  const borderColor = isSelected
    ? T.accent
    : isConnectSource
      ? T.gold
      : isSearchMatch
        ? accentSoft(0.92)
        : hasSelectionFocus && isConnected
          ? accentSoft(0.6)
          : 'rgba(255, 255, 255, 0.14)'
  return (
    <Box
      ref={(element: HTMLDivElement | null) => registerEl(node.id, element)}
      onClick={() => onSelect(node)}
      data-graph-interactive="true"
      style={{ transform: `translate3d(${node.x}px, ${node.y}px, 0)` }}
      sx={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: node.width || NODE_WIDTH,
        height: node.height || NODE_HEIGHT,
        willChange: 'transform',
        borderRadius: T.radius,
        border: `2px solid ${borderColor}`,
        backgroundColor: T.elevated,
        boxShadow: isHighlighted
          ? `0 0 0 4px ${accentSoft(0.14)}, 0 20px 40px rgba(0, 0, 0, 0.5)`
          : '0 14px 28px rgba(0, 0, 0, 0.4)',
        opacity: isDimmed ? 0.16 : 1,
        zIndex: isHighlighted ? 3 : isConnected ? 2 : 1,
        transition: 'opacity 180ms ease, border-color 180ms ease, box-shadow 180ms ease',
        cursor: 'pointer',
        overflow: 'hidden',
        userSelect: 'none',
        touchAction: 'none',
      }}
    >
      <Box
        onPointerDown={(event) => onHandlePointerDown(event, node)}
        onPointerMove={onHandlePointerMove}
        onPointerUp={onHandlePointerEnd}
        onPointerCancel={onHandlePointerEnd}
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
        }}
        role="button"
        aria-label={`Перетащить ${card?.title || `ноду ${node.id}`}`}
        title="Перетащить ноду"
        data-graph-interactive="true"
        sx={{
          position: 'absolute',
          inset: '0 auto 0 0',
          width: 30,
          display: 'grid',
          placeItems: 'center',
          color: T.muted,
          borderRight: `1px solid ${T.border}`,
          backgroundColor: 'rgba(255, 255, 255, 0.03)',
          cursor: 'grab',
          touchAction: 'none',
          '&:hover': {
            color: T.accent,
            backgroundColor: accentSoft(0.14),
          },
          '&:active': { cursor: 'grabbing' },
        }}
      >
        <svg width="14" height="22" viewBox="0 0 14 22" fill="none" aria-hidden="true">
          <circle cx="4" cy="4" r="1.5" fill="currentColor" />
          <circle cx="10" cy="4" r="1.5" fill="currentColor" />
          <circle cx="4" cy="11" r="1.5" fill="currentColor" />
          <circle cx="10" cy="11" r="1.5" fill="currentColor" />
          <circle cx="4" cy="18" r="1.5" fill="currentColor" />
          <circle cx="10" cy="18" r="1.5" fill="currentColor" />
        </svg>
      </Box>
      <Stack spacing={0.75} sx={{ py: 1.1, pr: 1.1, pl: 4.8, height: '100%' }}>
        <Stack direction="row" spacing={0.8} alignItems="center" sx={{ minWidth: 0 }}>
          {card ? <CardAvatar card={card} /> : null}
          <Stack spacing={0.12} sx={{ minWidth: 0, flex: 1 }}>
            <Typography sx={{ color: T.title, fontSize: '0.88rem', fontWeight: 900, lineHeight: 1.15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {card?.title || `Карточка #${node.card_id}`}
            </Typography>
            <Typography sx={{ color: T.muted, fontSize: '0.72rem', fontWeight: 800 }}>
              {formatCardType(node.card_type)}
            </Typography>
          </Stack>
        </Stack>
        <Typography sx={{ color: T.muted, fontSize: '0.76rem', lineHeight: 1.28, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
          {card?.description || 'Карточка отсутствует или была удалена.'}
        </Typography>
      </Stack>
    </Box>
  )
})

type GraphEdgeProps = {
  edge: StoryGraphEdge
  source: StoryGraphNode
  target: StoryGraphNode
  isHighlighted: boolean
  opacity: number
  onSelect: (edgeId: number) => void
  registerEdge: (edgeId: number, registration: EdgeRegistration | null) => void
}

const GraphEdge = memo(function GraphEdge({ edge, source, target, isHighlighted, opacity, onSelect, registerEdge }: GraphEdgeProps) {
  const lineRef = useRef<SVGLineElement | null>(null)
  const hitRef = useRef<SVGLineElement | null>(null)
  const labelRef = useRef<SVGForeignObjectElement | null>(null)

  useEffect(() => {
    registerEdge(edge.id, {
      source: edge.source_node_id,
      target: edge.target_node_id,
      line: lineRef.current,
      hit: hitRef.current,
      label: labelRef.current,
    })
    return () => registerEdge(edge.id, null)
  }, [edge.id, edge.source_node_id, edge.target_node_id, registerEdge])

  const sourceX = source.x + (source.width || NODE_WIDTH) / 2
  const sourceY = source.y + (source.height || NODE_HEIGHT) / 2
  const targetX = target.x + (target.width || NODE_WIDTH) / 2
  const targetY = target.y + (target.height || NODE_HEIGHT) / 2
  const midX = (sourceX + targetX) / 2
  const midY = (sourceY + targetY) / 2
  const strokeColor = edge.active ? (isHighlighted ? T.accent : 'rgba(180, 196, 224, 0.5)') : 'rgba(155, 154, 160, 0.3)'

  return (
    <g opacity={opacity} style={{ transition: 'opacity 180ms ease' }} data-graph-interactive="true" onClick={() => onSelect(edge.id)}>
      <line ref={hitRef} x1={sourceX} y1={sourceY} x2={targetX} y2={targetY} stroke="transparent" strokeWidth={18} cursor="pointer" />
      <line
        ref={lineRef}
        x1={sourceX}
        y1={sourceY}
        x2={targetX}
        y2={targetY}
        stroke={strokeColor}
        strokeWidth={isHighlighted ? 3.2 : 2}
        strokeLinecap="round"
        markerEnd={edge.direction === 'directed' ? `url(#graph-arrow-${edge.active ? 'active' : 'muted'})` : undefined}
        cursor="pointer"
      />
      <foreignObject ref={labelRef} x={midX - 74} y={midY - 18} width={148} height={36} pointerEvents="none">
        <Box
          sx={{
            px: 0.8,
            py: 0.35,
            borderRadius: T.radius,
            border: `1px solid ${T.border}`,
            backgroundColor: T.panel,
            color: isHighlighted ? T.accent : T.text,
            fontSize: '11px',
            fontWeight: 800,
            textAlign: 'center',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {edge.label || formatRelationType(edge.relation_type)}
        </Box>
      </foreignObject>
    </g>
  )
})

const CardAvatar = memo(function CardAvatar({ card }: { card: StoryGraphCardSummary }) {
  const imageUrl = resolveApiResourceUrl(card.avatar_original_url || card.avatar_url)
  if (imageUrl) {
    return (
      <Box sx={{ width: 34, height: 34, borderRadius: '50%', overflow: 'hidden', flexShrink: 0, backgroundColor: 'rgba(255, 255, 255, 0.08)' }}>
        <Box
          component="img"
          src={imageUrl}
          alt=""
          loading="lazy"
          decoding="async"
          sx={{
            width: '100%',
            height: '100%',
            display: 'block',
            objectFit: 'cover',
            transform: `scale(${clamp(card.avatar_scale || 1, 1, 2.2)})`,
            transformOrigin: 'center',
          }}
        />
      </Box>
    )
  }
  return (
    <Box
      sx={{
        width: 34,
        height: 34,
        borderRadius: '50%',
        display: 'grid',
        placeItems: 'center',
        flexShrink: 0,
        color: '#F4F7FB',
        fontSize: '0.78rem',
        fontWeight: 900,
        backgroundColor:
          card.card_type === 'instruction_card'
            ? '#4b5f7a'
            : card.card_type === 'plot_card'
              ? '#5a4a7e'
              : card.card_type === 'memory_block'
                ? '#3f5f52'
                : '#6a5a42',
      }}
    >
      {formatCardType(card.card_type).slice(0, 1)}
    </Box>
  )
})

function MobileTabButton({ label, active, badge, onClick }: { label: string; active: boolean; badge?: string; onClick: () => void }) {
  return (
    <Button
      onClick={onClick}
      sx={{
        flex: 1,
        minHeight: 42,
        borderRadius: '12px',
        textTransform: 'none',
        fontWeight: 800,
        fontSize: '0.82rem',
        color: active ? T.appBg : T.text,
        backgroundColor: active ? T.accent : T.elevated,
        border: `1px solid ${active ? T.accent : T.border}`,
        '&:hover': { backgroundColor: active ? T.accent : 'var(--morius-button-hover)' },
      }}
    >
      {label}
      {badge ? (
        <Box
          component="span"
          sx={{
            ml: 0.6,
            minWidth: 18,
            height: 18,
            px: 0.5,
            borderRadius: 999,
            display: 'inline-grid',
            placeItems: 'center',
            fontSize: '0.68rem',
            fontWeight: 900,
            color: active ? T.accent : T.appBg,
            backgroundColor: active ? T.appBg : T.accent,
          }}
        >
          {badge}
        </Box>
      ) : null}
    </Button>
  )
}

function SettingSwitch({
  label,
  tooltip,
  checked,
  disabled = false,
  onChange,
}: {
  label: string
  tooltip?: string
  checked: boolean
  disabled?: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
      <Stack direction="row" spacing={0.55} alignItems="center" sx={{ minWidth: 0 }}>
        <Typography sx={{ color: T.text, fontSize: '0.82rem', fontWeight: 800, lineHeight: 1.25 }}>
          {label}
        </Typography>
        {tooltip ? (
          <Tooltip title={tooltip} arrow placement="left">
            <Box
              component="span"
              tabIndex={0}
              aria-label={`Подсказка: ${label}`}
              sx={{ display: 'inline-grid', placeItems: 'center', color: T.muted, cursor: 'help' }}
            >
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <circle cx="8" cy="8" r="6.5" stroke="currentColor" />
                <path d="M6.7 6.15a1.45 1.45 0 1 1 2.35 1.14c-.65.5-1.05.86-1.05 1.71" stroke="currentColor" strokeLinecap="round" />
                <circle cx="8" cy="11.6" r=".75" fill="currentColor" />
              </svg>
            </Box>
          </Tooltip>
        ) : null}
      </Stack>
      <Switch
        checked={checked}
        disabled={disabled}
        onChange={(_, nextChecked) => onChange(nextChecked)}
        sx={{
          '& .MuiSwitch-switchBase.Mui-checked': { color: T.accent },
          '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': { backgroundColor: T.accent, opacity: 0.86 },
          '& .MuiSwitch-track': { backgroundColor: 'rgba(255, 255, 255, 0.18)', opacity: 1 },
        }}
      />
    </Stack>
  )
}

const toolbarButtonSx = {
  minHeight: 36,
  borderRadius: '12px',
  px: 1.35,
  textTransform: 'none',
  fontWeight: 700,
  color: T.text,
  border: `1px solid ${T.border}`,
  backgroundColor: T.elevated,
  '&:hover': { backgroundColor: 'var(--morius-button-hover)', borderColor: T.hoverBorder },
}

const toolbarIconButtonSx = {
  width: 38,
  height: 38,
  borderRadius: '12px',
  color: T.text,
  border: `1px solid ${T.border}`,
  backgroundColor: T.elevated,
  '&:hover': { backgroundColor: 'var(--morius-button-hover)', borderColor: T.hoverBorder },
}

const primaryActionButtonSx = {
  minHeight: 36,
  borderRadius: '12px',
  px: 1.6,
  textTransform: 'none',
  color: T.appBg,
  fontWeight: 900,
  backgroundColor: T.accent,
  '&:hover': { backgroundColor: T.accent, filter: 'brightness(1.08)' },
  '&:disabled': { color: 'rgba(9, 9, 9, 0.42)', backgroundColor: accentSoft(0.42) },
}

const graphSelectMenuProps = {
  PaperProps: {
    sx: {
      mt: 0.5,
      border: `1px solid ${T.border}`,
      backgroundColor: T.elevated,
      backgroundImage: 'none',
      color: T.text,
      boxShadow: 'var(--morius-neutral-shadow)',
      '& .MuiMenuItem-root': { color: T.text },
      '& .MuiMenuItem-root:hover': { backgroundColor: accentSoft(0.1) },
      '& .MuiMenuItem-root.Mui-selected': { backgroundColor: accentSoft(0.16) },
      '& .MuiMenuItem-root.Mui-selected:hover': { backgroundColor: accentSoft(0.22) },
    },
  },
}

const compactButtonSx = {
  minHeight: 32,
  borderRadius: '11px',
  px: 1.1,
  textTransform: 'none',
  fontWeight: 700,
  color: T.text,
  border: `1px solid ${T.border}`,
  backgroundColor: T.elevated,
  '&:hover': { backgroundColor: 'var(--morius-button-hover)', borderColor: T.hoverBorder },
}

const tinyButtonSx = {
  minWidth: 34,
  minHeight: 30,
  borderRadius: '10px',
  px: 0.9,
  textTransform: 'none',
  fontWeight: 700,
  color: T.text,
  border: `1px solid ${T.border}`,
  backgroundColor: T.elevated,
  '&:hover': { backgroundColor: 'var(--morius-button-hover)', borderColor: T.hoverBorder },
}

const dangerButtonSx = {
  ...compactButtonSx,
  color: '#ffb4b4',
  border: '1px solid rgba(240, 128, 128, 0.32)',
  backgroundColor: 'rgba(120, 44, 54, 0.24)',
  '&:hover': { backgroundColor: 'rgba(140, 52, 62, 0.36)', borderColor: 'rgba(240, 128, 128, 0.5)' },
}

const sidePanelSx = {
  minHeight: 0,
  px: 1.4,
  py: 1.4,
  backgroundColor: T.panel,
}

const panelTitleSx = {
  color: T.title,
  fontSize: '0.9rem',
  fontWeight: 900,
  lineHeight: 1.2,
}

const cardRowSx = {
  display: 'flex',
  alignItems: 'center',
  gap: 0.7,
  minWidth: 0,
  borderRadius: '12px',
  border: `1px solid ${T.border}`,
  backgroundColor: T.elevated,
  px: 0.7,
  py: 0.6,
  contentVisibility: 'auto',
  containIntrinsicSize: '48px',
  transition: 'border-color 140ms ease',
  '&:hover': { borderColor: T.hoverBorder },
}

const cardRowTitleSx = {
  color: T.text,
  fontSize: '0.82rem',
  fontWeight: 800,
  lineHeight: 1.2,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
}

const cardRowMetaSx = {
  color: T.muted,
  fontSize: '0.72rem',
  fontWeight: 700,
}

const settingsBoxSx = {
  borderRadius: T.radius,
  border: `1px solid ${T.border}`,
  backgroundColor: T.elevated,
  p: 1.2,
}

const suggestionBoxSx = {
  borderRadius: '12px',
  border: `1px solid ${T.border}`,
  backgroundColor: T.panel,
  p: 0.95,
}

const sliderSx = {
  color: T.accent,
  '& .MuiSlider-rail': { opacity: 0.28 },
}

const darkTextFieldSx = {
  '& .MuiInputBase-root': {
    color: T.text,
    backgroundColor: T.input,
    borderRadius: '12px',
  },
  '& .MuiInputLabel-root': { color: T.muted },
  '& .MuiInputLabel-root.Mui-focused': { color: T.accent },
  '& .MuiOutlinedInput-notchedOutline': { borderColor: T.border },
  '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: T.hoverBorder },
  '& .MuiOutlinedInput-root.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: T.accent },
}

const darkSelectSx = {
  '& .MuiInputBase-root': {
    color: T.text,
    backgroundColor: T.input,
    borderRadius: '12px',
  },
  '& .MuiInputLabel-root': { color: T.muted },
  '& .MuiInputLabel-root.Mui-focused': { color: T.accent },
  '& .MuiSelect-icon': { color: T.muted },
  '& .MuiOutlinedInput-notchedOutline': { borderColor: T.border },
  '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: T.hoverBorder },
  '& .MuiOutlinedInput-root.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: T.accent },
}

const floatingControlsSx = {
  position: 'absolute',
  right: { xs: 12, md: 16 },
  bottom: { xs: 16, md: 16 },
  zIndex: 5,
  alignItems: 'center',
  p: 0.6,
  borderRadius: '16px',
  border: `1px solid ${T.border}`,
  backgroundColor: 'color-mix(in srgb, var(--morius-card-bg) 88%, transparent)',
  backdropFilter: 'blur(6px)',
  boxShadow: '0 12px 30px rgba(0, 0, 0, 0.4)',
}

const floatingButtonSx = {
  width: 40,
  height: 40,
  borderRadius: '12px',
  fontSize: '1.2rem',
  fontWeight: 800,
  color: T.text,
  backgroundColor: T.elevated,
  border: `1px solid ${T.border}`,
  '&:hover': { backgroundColor: 'var(--morius-button-hover)', borderColor: T.hoverBorder },
}

const mobileTabBarSx = {
  position: 'absolute',
  left: 0,
  right: 0,
  bottom: 0,
  zIndex: 6,
  px: 1.2,
  pt: 1,
  pb: `calc(10px + env(safe-area-inset-bottom))`,
  backgroundColor: T.panel,
  borderTop: `1px solid ${T.border}`,
}
