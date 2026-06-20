import {
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
  disabled?: boolean
  onClose: () => void
  onGameUpdated: (game: StoryGameSummary) => void
  onOpenWorldCard: (card: StoryWorldCard) => void
  onOpenInstructionCard: (card: StoryInstructionCard) => void
  onOpenPlotCard: (card: StoryPlotCard) => void
  onOpenMemoryBlock: (block: StoryMemoryBlock) => void
}

type GraphDragState =
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
      startX: number
      startY: number
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

const GRAPH_CANVAS_WIDTH = 5200
const GRAPH_CANVAS_HEIGHT = 3400
const NODE_WIDTH = 260
const NODE_HEIGHT = 136
const ZOOM_MIN = 0.35
const ZOOM_MAX = 1.8
const GRAPH_LOAD_TIMEOUT_MS = 20_000
const VIEWPORT_ANIMATION_MS = 420

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

function normalizeRole(value: string): string {
  return value.trim().toLowerCase()
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
  disabled = false,
  onClose,
  onGameUpdated,
  onOpenWorldCard,
  onOpenInstructionCard,
  onOpenPlotCard,
  onOpenMemoryBlock,
}: StoryGraphDialogProps) {
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const dragStateRef = useRef<GraphDragState | null>(null)
  const viewStateRef = useRef({ zoom: 0.78, pan: { x: 430, y: 130 } })
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

  const canUseGraph = normalizeRole(userRole) === 'administrator' || normalizeRole(userRole) === 'moderator'
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
  }, [loadGraph])

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
      hasAutoFittedGraphRef.current = false
    }
  }, [open])

  useEffect(() => {
    hasAutoFittedGraphRef.current = false
  }, [gameId])

  useEffect(() => {
    setSelectedCardKeys((previousKeys) => previousKeys.filter((key) => availableCards.some((card) => `${card.card_type}:${card.card_id}` === key)))
  }, [availableCards])

  useEffect(() => {
    viewStateRef.current = { zoom, pan }
  }, [pan, zoom])

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
    if (!rect) {
      return { x: 520, y: 320 }
    }
    return {
      x: (rect.width / 2 - pan.x) / zoom,
      y: (rect.height / 2 - pan.y) / zoom,
    }
  }, [pan.x, pan.y, zoom])

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

  const handleNodePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>, node: StoryGraphNode) => {
      if (event.button !== 0) {
        return
      }
      event.preventDefault()
      event.stopPropagation()
      setIsViewportAnimating(false)
      setNodeSearch('')
      setSelectedNodeId(node.id)
      setSelectedEdgeId(null)
      event.currentTarget.setPointerCapture(event.pointerId)
      dragStateRef.current = {
        type: 'node',
        pointerId: event.pointerId,
        nodeId: node.id,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startX: node.x,
        startY: node.y,
        latestX: node.x,
        latestY: node.y,
      }
    },
    [],
  )

  const handleViewportPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return
    }
    const target = event.target
    if (target instanceof Element && target.closest('[data-graph-interactive="true"]')) {
      return
    }
    event.preventDefault()
    setIsViewportAnimating(false)
    event.currentTarget.setPointerCapture(event.pointerId)
    dragStateRef.current = {
      type: 'pan',
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: pan.x,
      startY: pan.y,
    }
    setSelectedNodeId(null)
    setSelectedEdgeId(null)
  }, [pan.x, pan.y])

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const dragState = dragStateRef.current
      if (!dragState || dragState.pointerId !== event.pointerId) {
        return
      }
      if (dragState.type === 'pan') {
        setPan({
          x: dragState.startX + event.clientX - dragState.startClientX,
          y: dragState.startY + event.clientY - dragState.startClientY,
        })
        return
      }
      const deltaX = (event.clientX - dragState.startClientX) / zoom
      const deltaY = (event.clientY - dragState.startClientY) / zoom
      const x = clamp(dragState.startX + deltaX, 20, canvasWidth - NODE_WIDTH - 20)
      const y = clamp(dragState.startY + deltaY, 20, canvasHeight - NODE_HEIGHT - 20)
      dragState.latestX = x
      dragState.latestY = y
      setGraph((previousGraph) => {
        if (!previousGraph) {
          return previousGraph
        }
        return {
          ...previousGraph,
          nodes: previousGraph.nodes.map((node) => {
            if (node.id !== dragState.nodeId) {
              return node
            }
            return { ...node, x, y }
          }),
        }
      })
    },
    [canvasHeight, canvasWidth, zoom],
  )

  const handlePointerEnd = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const dragState = dragStateRef.current
    if (dragState?.pointerId === event.pointerId) {
      dragStateRef.current = null
      if (dragState.type === 'node') {
        const node = nodesById.get(dragState.nodeId)
        if (node) {
          persistNodeLayout({
            ...node,
            x: dragState.latestX,
            y: dragState.latestY,
          })
        }
      }
    }
  }, [nodesById, persistNodeLayout])

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
      const currentView = viewStateRef.current
      const currentZoom = currentView.zoom
      const currentPan = currentView.pan
      const deltaMultiplier = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rect.height : 1
      const normalizedDelta = event.deltaY * deltaMultiplier
      const nextZoom = clamp(currentZoom * Math.exp(-normalizedDelta * 0.0015), ZOOM_MIN, ZOOM_MAX)
      if (Math.abs(nextZoom - currentZoom) < 0.0001) {
        return
      }
      const worldX = (event.clientX - rect.left - currentPan.x) / currentZoom
      const worldY = (event.clientY - rect.top - currentPan.y) / currentZoom
      const nextPan = {
        x: event.clientX - rect.left - worldX * nextZoom,
        y: event.clientY - rect.top - worldY * nextZoom,
      }
      viewStateRef.current = { zoom: nextZoom, pan: nextPan }
      setZoom(nextZoom)
      setPan(nextPan)
    },
    [],
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

  const handleNodeClick = useCallback(
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

  const renderCardAvatar = (card: StoryGraphCardSummary) => {
    const imageUrl = resolveApiResourceUrl(card.avatar_original_url || card.avatar_url)
    if (imageUrl) {
      return (
        <Box
          sx={{
            width: 34,
            height: 34,
            borderRadius: '50%',
            overflow: 'hidden',
            flexShrink: 0,
            backgroundColor: 'rgba(115, 138, 164, 0.18)',
          }}
        >
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
          backgroundColor: card.card_type === 'instruction_card' ? '#5D728A' : card.card_type === 'plot_card' ? '#785E9A' : card.card_type === 'memory_block' ? '#527668' : '#7B6B52',
        }}
      >
        {formatCardType(card.card_type).slice(0, 1)}
      </Box>
    )
  }

  const renderNode = (node: StoryGraphNode) => {
    const card = node.card
    const isSelected = selectedNodeId === node.id
    const isConnectSource = connectSourceNodeId === node.id
    const hasSearchFocus = normalizedNodeSearch.length > 0 && matchingNodeIds.size > 0
    const isSearchMatch = matchingNodeIds.has(node.id)
    const hasSelectionFocus = selectedNodeId !== null && !hasSearchFocus
    const isConnected = connectedNodeIds.has(node.id)
    const isDimmed = hasSearchFocus ? !isSearchMatch : hasSelectionFocus ? !isConnected : false
    const isHighlighted = isSelected || isConnectSource || isSearchMatch || (hasSelectionFocus && isConnected)
    return (
      <Box
        key={node.id}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
        onClick={() => handleNodeClick(node)}
        data-graph-interactive="true"
        sx={{
          position: 'absolute',
          left: node.x,
          top: node.y,
          width: node.width || NODE_WIDTH,
          height: node.height || NODE_HEIGHT,
          borderRadius: '8px',
          border: isSelected
            ? '2px solid #7FDBFF'
            : isConnectSource
              ? '2px solid #F2C56D'
              : isSearchMatch
                ? '2px solid rgba(127, 219, 255, 0.92)'
                : hasSelectionFocus && isConnected
                  ? '2px solid rgba(127, 219, 255, 0.62)'
              : '2px solid rgba(126, 160, 194, 0.7)',
          outline: isSelected ? '1px solid rgba(127, 219, 255, 0.28)' : '1px solid rgba(7, 10, 15, 0.9)',
          backgroundColor: 'rgba(18, 23, 30, 0.94)',
          boxShadow: isHighlighted
            ? '0 0 0 4px rgba(127, 219, 255, 0.12), 0 18px 38px rgba(0, 0, 0, 0.38)'
            : '0 12px 24px rgba(0, 0, 0, 0.28)',
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
          onPointerDown={(event) => handleNodePointerDown(event, node)}
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
            color: '#A9C8E3',
            borderRight: '2px solid rgba(126, 160, 194, 0.58)',
            backgroundColor: 'rgba(73, 113, 148, 0.2)',
            cursor: 'grab',
            touchAction: 'none',
            '&:hover': {
              color: '#CFF5FF',
              backgroundColor: 'rgba(127, 219, 255, 0.2)',
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
            {card ? renderCardAvatar(card) : null}
            <Stack spacing={0.12} sx={{ minWidth: 0, flex: 1 }}>
              <Typography sx={{ color: '#F5F7FB', fontSize: '0.88rem', fontWeight: 900, lineHeight: 1.15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {card?.title || `Карточка #${node.card_id}`}
              </Typography>
              <Typography sx={{ color: 'rgba(191, 205, 224, 0.72)', fontSize: '0.72rem', fontWeight: 800 }}>
                {formatCardType(node.card_type)}
              </Typography>
            </Stack>
          </Stack>
          <Typography sx={{ color: 'rgba(222, 230, 242, 0.72)', fontSize: '0.76rem', lineHeight: 1.28, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
            {card?.description || 'Карточка отсутствует или была удалена.'}
          </Typography>
        </Stack>
      </Box>
    )
  }

  const renderEdge = (edge: StoryGraphEdge) => {
    const source = nodesById.get(edge.source_node_id)
    const target = nodesById.get(edge.target_node_id)
    if (!source || !target) {
      return null
    }
    const sourceX = source.x + (source.width || NODE_WIDTH) / 2
    const sourceY = source.y + (source.height || NODE_HEIGHT) / 2
    const targetX = target.x + (target.width || NODE_WIDTH) / 2
    const targetY = target.y + (target.height || NODE_HEIGHT) / 2
    const midX = (sourceX + targetX) / 2
    const midY = (sourceY + targetY) / 2
    const isSelected = selectedEdgeId === edge.id
    const hasSearchFocus = normalizedNodeSearch.length > 0 && matchingNodeIds.size > 0
    const hasSelectionFocus = selectedNodeId !== null && !hasSearchFocus
    const isConnectedToSelection = connectedEdgeIds.has(edge.id)
    const isConnectedToSearch = matchingNodeIds.has(edge.source_node_id) || matchingNodeIds.has(edge.target_node_id)
    const isHighlighted = isSelected || (hasSelectionFocus && isConnectedToSelection)
    const edgeOpacity = hasSearchFocus
      ? isConnectedToSearch
        ? 0.72
        : 0.08
      : hasSelectionFocus
        ? isConnectedToSelection
          ? 1
          : 0.08
        : 1
    return (
      <g key={edge.id} opacity={edgeOpacity} style={{ transition: 'opacity 180ms ease' }} data-graph-interactive="true" onClick={() => {
        setNodeSearch('')
        setSelectedEdgeId(edge.id)
        setSelectedNodeId(null)
      }}>
        <line
          x1={sourceX}
          y1={sourceY}
          x2={targetX}
          y2={targetY}
          stroke="rgba(127, 219, 255, 0.02)"
          strokeWidth={18}
          cursor="pointer"
        />
        <line
          x1={sourceX}
          y1={sourceY}
          x2={targetX}
          y2={targetY}
          stroke={edge.active ? (isHighlighted ? '#7FDBFF' : 'rgba(143, 185, 219, 0.66)') : 'rgba(130, 142, 160, 0.28)'}
          strokeWidth={isHighlighted ? 3.2 : 2}
          strokeLinecap="round"
          markerEnd={edge.direction === 'directed' ? `url(#graph-arrow-${edge.active ? 'active' : 'muted'})` : undefined}
          cursor="pointer"
        />
        <foreignObject x={midX - 74} y={midY - 18} width={148} height={36} pointerEvents="none">
          <Box
            sx={{
              px: 0.8,
              py: 0.35,
              borderRadius: '7px',
              border: '1px solid rgba(143, 185, 219, 0.28)',
              backgroundColor: 'rgba(12, 16, 22, 0.88)',
              color: isHighlighted ? '#CFF5FF' : 'rgba(226, 234, 246, 0.86)',
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
  }

  if (!canUseGraph) {
    return null
  }

  return (
    <>
      <Dialog
        open={open}
        onClose={onClose}
        fullScreen
        PaperProps={{
          sx: {
            background: '#080B10',
            color: '#EAF1FA',
            overflow: 'hidden',
          },
        }}
      >
        <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: '100dvh' }}>
          <Stack
            direction="row"
            alignItems="center"
            spacing={1}
            sx={{
              px: { xs: 1.2, md: 2 },
              py: 1,
              borderBottom: '1px solid rgba(140, 159, 184, 0.2)',
              backgroundColor: 'rgba(10, 14, 20, 0.96)',
            }}
          >
            <Typography sx={{ fontSize: { xs: '1.05rem', md: '1.26rem' }, fontWeight: 900, minWidth: 0, flex: 1 }}>
              Ноды
            </Typography>
            <Tooltip title="Масштаб">
              <Button
                onClick={() => {
                  const nextPan = { x: 430, y: 130 }
                  viewStateRef.current = { zoom: 0.78, pan: nextPan }
                  setZoom(0.78)
                  setPan(nextPan)
                }}
                sx={toolbarButtonSx}
              >
                {Math.round(zoom * 100)}%
              </Button>
            </Tooltip>
            <Button onClick={() => void loadGraph()} disabled={isLoading || isMutating} sx={toolbarButtonSx}>
              Обновить
            </Button>
            <Button onClick={() => void handleAutoLayout()} disabled={isMutating || graphPayload.nodes.length === 0} sx={toolbarButtonSx}>
              Авто-layout
            </Button>
            <IconButton onClick={onClose} aria-label="Закрыть ноды" sx={{ color: '#DDE7F5' }}>
              ×
            </IconButton>
          </Stack>

          {errorMessage ? (
            <Alert severity="error" sx={{ borderRadius: 0 }}>
              {errorMessage}
            </Alert>
          ) : null}

          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', lg: '292px minmax(0, 1fr) 318px' },
              gridTemplateRows: { xs: 'auto minmax(420px, 1fr) auto', lg: 'minmax(0, 1fr)' },
              gap: { xs: 0, lg: 0 },
              flex: 1,
              minHeight: 0,
            }}
          >
            <Box sx={sidePanelSx}>
              <Stack spacing={1.1}>
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
                <Box className="morius-scrollbar" sx={{ maxHeight: { xs: 168, lg: 'calc(100dvh - 225px)' }, overflowY: 'auto', pr: 0.4 }}>
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
                            sx={{ color: 'rgba(214, 225, 241, 0.54)', p: 0.35 }}
                          />
                          {renderCardAvatar(card)}
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
                      <Typography sx={{ color: 'rgba(210, 221, 237, 0.62)', fontSize: '0.84rem', lineHeight: 1.35 }}>
                        Все доступные карточки уже на графе.
                      </Typography>
                    ) : null}
                  </Stack>
                </Box>
              </Stack>
            </Box>

            <Box
              ref={viewportRef}
              onPointerDown={handleViewportPointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerEnd}
              onPointerCancel={handlePointerEnd}
              sx={{
                position: 'relative',
                minHeight: { xs: 420, lg: 'auto' },
                overflow: 'hidden',
                cursor: dragStateRef.current?.type === 'pan' ? 'grabbing' : 'grab',
                backgroundColor: '#090D13',
                backgroundImage:
                  'linear-gradient(rgba(143, 185, 219, 0.07) 1px, transparent 1px), linear-gradient(90deg, rgba(143, 185, 219, 0.07) 1px, transparent 1px)',
                backgroundSize: `${32 * zoom}px ${32 * zoom}px`,
                backgroundPosition: `${pan.x}px ${pan.y}px`,
              }}
            >
              {isLoading && graph === null ? (
                <Stack spacing={1} alignItems="center" justifyContent="center" sx={{ position: 'absolute', inset: 0, zIndex: 4 }}>
                  <CircularProgress size={30} sx={{ color: '#7FDBFF' }} />
                  <Typography sx={{ color: 'rgba(224, 234, 248, 0.72)', fontSize: '0.9rem' }}>Загружаю граф</Typography>
                </Stack>
              ) : null}
              <Box
                sx={{
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  width: 0,
                  height: 0,
                  transform: `translate(${Math.round(pan.x)}px, ${Math.round(pan.y)}px)`,
                  transition: isViewportAnimating ? `transform ${VIEWPORT_ANIMATION_MS}ms cubic-bezier(0.22, 1, 0.36, 1)` : 'none',
                }}
              >
                <Box
                  sx={{
                    position: 'relative',
                    width: canvasWidth,
                    height: canvasHeight,
                    boxSizing: 'border-box',
                    border: '3px solid rgba(127, 219, 255, 0.34)',
                    boxShadow: 'inset 0 0 0 1px rgba(7, 10, 15, 0.95)',
                    zoom,
                    transition: isViewportAnimating ? `zoom ${VIEWPORT_ANIMATION_MS}ms cubic-bezier(0.22, 1, 0.36, 1)` : 'none',
                    textRendering: 'geometricPrecision',
                    WebkitFontSmoothing: 'antialiased',
                  }}
                >
                  <Box
                    component="svg"
                    width={canvasWidth}
                    height={canvasHeight}
                    sx={{ position: 'absolute', inset: 0, overflow: 'visible' }}
                  >
                    <defs>
                      <marker id="graph-arrow-active" markerWidth="11" markerHeight="11" refX="9" refY="3" orient="auto" markerUnits="strokeWidth">
                        <path d="M0,0 L0,6 L9,3 z" fill="#7FDBFF" />
                      </marker>
                      <marker id="graph-arrow-muted" markerWidth="11" markerHeight="11" refX="9" refY="3" orient="auto" markerUnits="strokeWidth">
                        <path d="M0,0 L0,6 L9,3 z" fill="rgba(130, 142, 160, 0.38)" />
                      </marker>
                    </defs>
                    {graphPayload.edges.map(renderEdge)}
                  </Box>
                  {graphPayload.nodes.map(renderNode)}
                </Box>
              </Box>
              {connectSourceNodeId !== null ? (
                <Box sx={{ position: 'absolute', left: 14, bottom: 14, borderRadius: '8px', px: 1.2, py: 0.8, backgroundColor: 'rgba(12, 16, 22, 0.92)', border: '1px solid rgba(242, 197, 109, 0.5)' }}>
                  <Typography sx={{ color: '#F8D27B', fontSize: '0.84rem', fontWeight: 800 }}>
                    Выберите вторую ноду для связи
                  </Typography>
                </Box>
              ) : null}
            </Box>

            <Box sx={sidePanelSx}>
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
                        color: matchingNodeIds.size > 0 ? 'rgba(174, 226, 246, 0.8)' : 'rgba(240, 157, 157, 0.82)',
                        fontSize: '0.74rem',
                        fontWeight: 800,
                      }}
                    >
                      {matchingNodeIds.size > 0
                        ? `Совпадений: ${matchingNodeIds.size}`
                        : 'Совпадений нет'}
                    </Typography>
                  ) : null}
                </Stack>
                {selectedNode ? (
                  <Stack spacing={1}>
                    <Typography sx={{ color: '#F5F8FC', fontWeight: 900, lineHeight: 1.2 }}>
                      {selectedNode.card?.title || `Нода #${selectedNode.id}`}
                    </Typography>
                    <Typography sx={{ color: 'rgba(206, 219, 237, 0.72)', fontSize: '0.84rem', lineHeight: 1.45 }}>
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
                    <Typography sx={{ color: '#F5F8FC', fontWeight: 900, lineHeight: 1.2 }}>
                      {selectedEdge.label || formatRelationType(selectedEdge.relation_type)}
                    </Typography>
                    <Typography sx={{ color: 'rgba(206, 219, 237, 0.72)', fontSize: '0.84rem', lineHeight: 1.45 }}>
                      {selectedEdge.description || 'Описание связи не задано.'}
                    </Typography>
                    <Stack direction="row" spacing={0.7} flexWrap="wrap" useFlexGap>
                      <Button onClick={() => openEdgeDraft(selectedEdge)} sx={compactButtonSx}>Редактировать</Button>
                      <Button onClick={() => void handleDeleteSelectedEdge()} disabled={isMutating} sx={dangerButtonSx}>Удалить</Button>
                    </Stack>
                  </Stack>
                ) : (
                  <Typography sx={{ color: 'rgba(206, 219, 237, 0.68)', fontSize: '0.86rem', lineHeight: 1.45 }}>
                    Выберите ноду или связь на полотне.
                  </Typography>
                )}

                <Box sx={settingsBoxSx}>
                  <Typography sx={panelTitleSx}>ИИ графа</Typography>
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
                    <Typography sx={{ color: 'rgba(228, 237, 249, 0.8)', fontSize: '0.82rem', fontWeight: 800 }}>
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
                      sx={{ color: '#7FDBFF' }}
                    />
                  </Stack>
                </Box>

                <Box sx={settingsBoxSx}>
                  <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
                    <Typography sx={panelTitleSx}>Предложения</Typography>
                    <Typography sx={{ color: 'rgba(205, 219, 237, 0.66)', fontSize: '0.78rem', fontWeight: 800 }}>
                      {graphPayload.suggestions.length}
                    </Typography>
                  </Stack>
                  <Stack spacing={0.75} sx={{ maxHeight: { xs: 174, lg: 260 }, overflowY: 'auto', pr: 0.2 }} className="morius-scrollbar">
                    {graphPayload.suggestions.map((suggestion) => (
                      <Box key={suggestion.id} sx={suggestionBoxSx}>
                        <Typography sx={{ color: '#F4F8FC', fontSize: '0.82rem', fontWeight: 900 }}>
                          {formatSuggestionKind(suggestion.kind)} · {Math.round((suggestion.confidence ?? 0) * 100)}%
                        </Typography>
                        <Typography sx={{ color: 'rgba(211, 224, 241, 0.72)', fontSize: '0.76rem', lineHeight: 1.35 }}>
                          {suggestion.reason || summarizeSuggestionPayload(suggestion)}
                        </Typography>
                        <Stack direction="row" spacing={0.55}>
                          <Button onClick={() => void handleApplySuggestion(suggestion.id)} disabled={isMutating} sx={tinyButtonSx}>ОК</Button>
                          <Button onClick={() => void handleDeclineSuggestion(suggestion.id)} disabled={isMutating} sx={tinyButtonSx}>Нет</Button>
                        </Stack>
                      </Box>
                    ))}
                    {graphPayload.suggestions.length === 0 ? (
                      <Typography sx={{ color: 'rgba(206, 219, 237, 0.62)', fontSize: '0.82rem' }}>
                        Очередь пуста.
                      </Typography>
                    ) : null}
                  </Stack>
                </Box>
              </Stack>
            </Box>
          </Box>
        </Box>
      </Dialog>

      <Dialog
        open={edgeDraft !== null}
        onClose={() => setEdgeDraft(null)}
        maxWidth="sm"
        fullWidth
        PaperProps={{
          sx: {
            borderRadius: '10px',
            border: '1px solid rgba(143, 185, 219, 0.2)',
            backgroundColor: '#080C12',
            backgroundImage: 'none',
            color: '#EEF4FC',
            boxShadow: '0 26px 80px rgba(0, 0, 0, 0.72)',
          },
        }}
      >
        <DialogTitle sx={{ fontWeight: 900, backgroundColor: '#080C12' }}>{edgeDraft?.id === null ? 'Новая связь' : 'Редактирование связи'}</DialogTitle>
        <DialogContent sx={{ pt: 1, backgroundColor: '#080C12' }}>
          {edgeDraft ? (
            <Stack spacing={1.4}>
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
                <Typography sx={{ color: 'rgba(226, 236, 249, 0.78)', fontSize: '0.84rem', fontWeight: 800 }}>
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
                  sx={{ color: '#7FDBFF' }}
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
        <DialogActions sx={{ px: 3, pb: 2.2, backgroundColor: '#080C12' }}>
          <Button onClick={() => setEdgeDraft(null)} sx={{ color: 'rgba(224, 234, 248, 0.72)' }}>Отмена</Button>
          <Button onClick={() => void handleSaveEdgeDraft()} disabled={isMutating || edgeDraft === null} sx={primaryActionButtonSx}>
            Сохранить
          </Button>
        </DialogActions>
      </Dialog>
    </>
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
        <Typography sx={{ color: 'rgba(228, 237, 249, 0.82)', fontSize: '0.82rem', fontWeight: 800, lineHeight: 1.25 }}>
          {label}
        </Typography>
        {tooltip ? (
          <Tooltip title={tooltip} arrow placement="left">
            <Box
              component="span"
              tabIndex={0}
              aria-label={`Подсказка: ${label}`}
              sx={{ display: 'inline-grid', placeItems: 'center', color: 'rgba(177, 205, 231, 0.7)', cursor: 'help' }}
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
          '& .MuiSwitch-switchBase.Mui-checked': { color: '#7FDBFF' },
          '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': { backgroundColor: '#7FDBFF', opacity: 0.86 },
          '& .MuiSwitch-track': { backgroundColor: 'rgba(135, 153, 178, 0.34)', opacity: 1 },
        }}
      />
    </Stack>
  )
}

const toolbarButtonSx = {
  minHeight: 36,
  borderRadius: '8px',
  px: 1.25,
  textTransform: 'none',
  color: '#EAF1FA',
  border: '1px solid rgba(143, 185, 219, 0.24)',
  backgroundColor: 'rgba(22, 29, 39, 0.84)',
  '&:hover': { backgroundColor: 'rgba(32, 42, 56, 0.96)' },
}

const primaryActionButtonSx = {
  minHeight: 36,
  borderRadius: '8px',
  px: 1.35,
  textTransform: 'none',
  color: '#061018',
  fontWeight: 900,
  backgroundColor: '#7FDBFF',
  '&:hover': { backgroundColor: '#9BE8FF' },
  '&:disabled': { color: 'rgba(6, 16, 24, 0.42)', backgroundColor: 'rgba(127, 219, 255, 0.42)' },
}

const graphSelectMenuProps = {
  PaperProps: {
    sx: {
      mt: 0.5,
      border: '1px solid rgba(143, 185, 219, 0.2)',
      backgroundColor: '#080C12',
      backgroundImage: 'none',
      color: '#EEF4FC',
      boxShadow: '0 18px 48px rgba(0, 0, 0, 0.64)',
      '& .MuiMenuItem-root': {
        color: '#EAF1FA',
      },
      '& .MuiMenuItem-root:hover': {
        backgroundColor: 'rgba(127, 219, 255, 0.1)',
      },
      '& .MuiMenuItem-root.Mui-selected': {
        backgroundColor: 'rgba(127, 219, 255, 0.16)',
      },
      '& .MuiMenuItem-root.Mui-selected:hover': {
        backgroundColor: 'rgba(127, 219, 255, 0.22)',
      },
    },
  },
}

const compactButtonSx = {
  minHeight: 32,
  borderRadius: '7px',
  px: 1,
  textTransform: 'none',
  color: '#EAF1FA',
  border: '1px solid rgba(143, 185, 219, 0.22)',
  backgroundColor: 'rgba(24, 32, 43, 0.86)',
  '&:hover': { backgroundColor: 'rgba(35, 46, 61, 0.96)' },
}

const tinyButtonSx = {
  minWidth: 32,
  minHeight: 28,
  borderRadius: '7px',
  px: 0.8,
  textTransform: 'none',
  color: '#EAF1FA',
  border: '1px solid rgba(143, 185, 219, 0.2)',
  backgroundColor: 'rgba(28, 37, 50, 0.82)',
  '&:hover': { backgroundColor: 'rgba(42, 55, 72, 0.94)' },
}

const dangerButtonSx = {
  ...compactButtonSx,
  color: '#FFD2D2',
  border: '1px solid rgba(240, 128, 128, 0.28)',
  backgroundColor: 'rgba(96, 36, 44, 0.32)',
  '&:hover': { backgroundColor: 'rgba(120, 44, 54, 0.44)' },
}

const sidePanelSx = {
  minHeight: 0,
  overflow: 'hidden',
  px: { xs: 1.1, lg: 1.25 },
  py: 1.2,
  borderRight: { xs: 'none', lg: '1px solid rgba(140, 159, 184, 0.18)' },
  borderTop: { xs: '1px solid rgba(140, 159, 184, 0.16)', lg: 'none' },
  backgroundColor: 'rgba(10, 14, 20, 0.96)',
}

const panelTitleSx = {
  color: '#F4F8FC',
  fontSize: '0.88rem',
  fontWeight: 900,
  lineHeight: 1.2,
}

const cardRowSx = {
  display: 'flex',
  alignItems: 'center',
  gap: 0.7,
  minWidth: 0,
  borderRadius: '8px',
  border: '1px solid rgba(143, 185, 219, 0.16)',
  backgroundColor: 'rgba(20, 27, 37, 0.72)',
  px: 0.65,
  py: 0.6,
  contentVisibility: 'auto',
  containIntrinsicSize: '48px',
}

const cardRowTitleSx = {
  color: '#EEF4FC',
  fontSize: '0.82rem',
  fontWeight: 900,
  lineHeight: 1.2,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
}

const cardRowMetaSx = {
  color: 'rgba(191, 205, 224, 0.66)',
  fontSize: '0.72rem',
  fontWeight: 800,
}

const settingsBoxSx = {
  borderRadius: '8px',
  border: '1px solid rgba(143, 185, 219, 0.17)',
  backgroundColor: 'rgba(16, 22, 30, 0.74)',
  p: 1,
}

const suggestionBoxSx = {
  borderRadius: '8px',
  border: '1px solid rgba(143, 185, 219, 0.16)',
  backgroundColor: 'rgba(18, 25, 34, 0.82)',
  p: 0.85,
}

const darkTextFieldSx = {
  '& .MuiInputBase-root': {
    color: '#EEF4FC',
    backgroundColor: 'rgba(18, 25, 34, 0.86)',
    borderRadius: '8px',
  },
  '& .MuiInputLabel-root': { color: 'rgba(217, 228, 243, 0.68)' },
  '& .MuiInputLabel-root.Mui-focused': { color: '#7FDBFF' },
  '& .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(143, 185, 219, 0.24)' },
  '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(143, 185, 219, 0.42)' },
  '& .MuiOutlinedInput-root.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: '#7FDBFF' },
}

const darkSelectSx = {
  '& .MuiInputBase-root': {
    color: '#EEF4FC',
    backgroundColor: 'rgba(18, 25, 34, 0.86)',
    borderRadius: '8px',
  },
  '& .MuiInputLabel-root': { color: 'rgba(217, 228, 243, 0.68)' },
  '& .MuiInputLabel-root.Mui-focused': { color: '#7FDBFF' },
  '& .MuiSelect-icon': { color: 'rgba(217, 228, 243, 0.72)' },
  '& .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(143, 185, 219, 0.24)' },
  '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(143, 185, 219, 0.42)' },
  '& .MuiOutlinedInput-root.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: '#7FDBFF' },
}
