import { useDeferredValue, useEffect, useRef, useState } from 'react'
import './GameBrowserPage.css'

interface RemoteGameUploader {
  name: string
  link: string
}

interface RemoteGameEntry {
  hash: string
  name: string
  engine: string
  location: string
  uploaded: number
  uploader?: RemoteGameUploader | null
}

interface RemoteGameListResponse {
  games?: RemoteGameEntry[]
}

interface DumpImportPayload {
  sourceLabel: string
  classesJson: string
  structsJson: string
  functionsJson: string
  enumsJson: string
  offsetsJson: string | null
}

interface GameBrowserPageProps {
  runningInTauri: boolean
  busyLabel: string | null
  currentSourceLabel: string | null
  onLoadRemoteDump: (payload: DumpImportPayload) => Promise<void>
}

interface RemoteLoadProgress {
  gameHash: string
  label: string
  progress: number
  step: number
  totalSteps: number
}

const remoteCatalogUrl =
  'https://raw.githubusercontent.com/Spuckwaffel/dumpspace/main/Games/GameList.json'
const remoteGamesRootUrl =
  'https://raw.githubusercontent.com/Spuckwaffel/dumpspace/main/Games'
const defaultEngineFilter = 'all'

const remoteDumpFiles = [
  {
    payloadKey: 'classesJson',
    fileName: 'ClassesInfo.json',
  },
  {
    payloadKey: 'structsJson',
    fileName: 'StructsInfo.json',
  },
  {
    payloadKey: 'functionsJson',
    fileName: 'FunctionsInfo.json',
  },
  {
    payloadKey: 'enumsJson',
    fileName: 'EnumsInfo.json',
  },
] as const

function normalizeError(error: unknown) {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}

function formatEngineName(engine: string) {
  return engine.replaceAll('-', ' ')
}

function formatUploadedAt(uploaded: number) {
  if (!Number.isFinite(uploaded)) {
    return 'Unknown upload date'
  }

  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(uploaded))
}

function buildRemoteSourceLabel(game: RemoteGameEntry) {
  return `GitHub Games / ${game.name}`
}

function buildEncodedGameFolder(game: Pick<RemoteGameEntry, 'engine' | 'location'>) {
  return [game.engine, game.location].map((segment) => encodeURIComponent(segment)).join('/')
}

function buildRemoteGameFileUrl(
  game: Pick<RemoteGameEntry, 'engine' | 'location'>,
  fileName: string,
) {
  return `${remoteGamesRootUrl}/${buildEncodedGameFolder(game)}/${fileName}`
}

function buildGitHubFolderUrl(game: Pick<RemoteGameEntry, 'engine' | 'location'>) {
  return `https://github.com/Spuckwaffel/dumpspace/tree/main/Games/${buildEncodedGameFolder(game)}`
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError'
}

function clampProgress(value: number) {
  return Math.max(0, Math.min(1, value))
}

async function readResponseBytes(
  response: Response,
  onProgress?: (fraction: number) => void,
) {
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer())
    onProgress?.(1)
    return bytes
  }

  const totalHeader = response.headers.get('content-length')
  const totalBytes = totalHeader ? Number.parseInt(totalHeader, 10) : Number.NaN
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let receivedBytes = 0

  onProgress?.(0)

  while (true) {
    const { done, value } = await reader.read()
    if (done) {
      break
    }

    if (!value) {
      continue
    }

    chunks.push(value)
    receivedBytes += value.byteLength

    if (Number.isFinite(totalBytes) && totalBytes > 0) {
      onProgress?.(clampProgress(receivedBytes / totalBytes))
    }
  }

  onProgress?.(1)

  const merged = new Uint8Array(receivedBytes)
  let offset = 0

  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }

  return merged
}

async function fetchTextFile(
  url: string,
  signal?: AbortSignal,
  optional = false,
  onProgress?: (fraction: number) => void,
) {
  const response = await fetch(url, { signal })

  if (!response.ok) {
    if (optional && response.status === 404) {
      return null
    }

    throw new Error(`Request failed (${response.status}) for ${url}`)
  }

  const bytes = await readResponseBytes(response, onProgress)
  return new Response(bytes).text()
}

async function fetchGzipFile(
  url: string,
  signal?: AbortSignal,
  optional = false,
  onProgress?: (fraction: number) => void,
) {
  const response = await fetch(url, { signal })

  if (!response.ok) {
    if (optional && response.status === 404) {
      return null
    }

    throw new Error(`Request failed (${response.status}) for ${url}`)
  }

  if (typeof DecompressionStream === 'undefined' || !response.body) {
    throw new Error('Gzip decompression is unavailable in this runtime.')
  }

  const bytes = await readResponseBytes(response, onProgress)
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
  return new Response(stream).text()
}

async function fetchRemoteDumpFile(
  game: Pick<RemoteGameEntry, 'engine' | 'location'>,
  fileName: string,
  signal?: AbortSignal,
  optional = false,
  onProgress?: (fraction: number) => void,
) {
  const baseUrl = buildRemoteGameFileUrl(game, fileName)

  try {
    const gzipText = await fetchGzipFile(`${baseUrl}.gz`, signal, optional, onProgress)
    if (gzipText != null) {
      return gzipText
    }
  } catch (error) {
    if (isAbortError(error)) {
      throw error
    }
  }

  return fetchTextFile(baseUrl, signal, optional, onProgress)
}

async function fetchRemoteCatalog(signal?: AbortSignal) {
  const response = await fetch(remoteCatalogUrl, { signal })

  if (!response.ok) {
    throw new Error(`Request failed (${response.status}) for ${remoteCatalogUrl}`)
  }

  const payload = (await response.json()) as RemoteGameListResponse
  if (!payload || !Array.isArray(payload.games)) {
    throw new Error('Remote game catalog returned an unexpected format.')
  }

  return [...payload.games]
    .filter((game) => {
      return (
        typeof game?.hash === 'string' &&
        typeof game?.name === 'string' &&
        typeof game?.engine === 'string' &&
        typeof game?.location === 'string'
      )
    })
    .sort((left, right) => {
      if (left.uploaded !== right.uploaded) {
        return right.uploaded - left.uploaded
      }

      return left.name.localeCompare(right.name)
    })
}

function GameBrowserPage({
  runningInTauri,
  busyLabel,
  currentSourceLabel,
  onLoadRemoteDump,
}: GameBrowserPageProps) {
  const [games, setGames] = useState<RemoteGameEntry[]>([])
  const [query, setQuery] = useState('')
  const [engineFilter, setEngineFilter] = useState(defaultEngineFilter)
  const [selectedGameHash, setSelectedGameHash] = useState<string | null>(null)
  const [catalogError, setCatalogError] = useState<string | null>(null)
  const [loadingCatalog, setLoadingCatalog] = useState(false)
  const [catalogRevision, setCatalogRevision] = useState(0)
  const [loadingGameHash, setLoadingGameHash] = useState<string | null>(null)
  const [loadProgress, setLoadProgress] = useState<RemoteLoadProgress | null>(null)
  const [missingPreviewHashes, setMissingPreviewHashes] = useState<string[]>([])
  const clearProgressTimeoutRef = useRef<number | null>(null)
  const deferredQuery = useDeferredValue(query)
  const normalizedQuery = deferredQuery.trim().toLowerCase()

  useEffect(() => {
    return () => {
      if (clearProgressTimeoutRef.current != null) {
        window.clearTimeout(clearProgressTimeoutRef.current)
      }
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    let cancelled = false

    setLoadingCatalog(true)
    setCatalogError(null)

    fetchRemoteCatalog(controller.signal)
      .then((nextGames) => {
        if (cancelled) {
          return
        }

        setGames(nextGames)
        setSelectedGameHash((current) => {
          if (current && nextGames.some((game) => game.hash === current)) {
            return current
          }

          return nextGames[0]?.hash ?? null
        })
      })
      .catch((error) => {
        if (!cancelled && !isAbortError(error)) {
          setCatalogError(normalizeError(error))
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingCatalog(false)
        }
      })

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [catalogRevision])

  const engineOptions = [
    defaultEngineFilter,
    ...new Set(games.map((game) => game.engine)).values(),
  ].sort((left, right) => {
    if (left === defaultEngineFilter) {
      return -1
    }

    if (right === defaultEngineFilter) {
      return 1
    }

    return formatEngineName(left).localeCompare(formatEngineName(right))
  })

  const visibleGames = games.filter((game) => {
    if (engineFilter !== defaultEngineFilter && game.engine !== engineFilter) {
      return false
    }

    if (!normalizedQuery) {
      return true
    }

    const uploaderName = game.uploader?.name?.toLowerCase() ?? ''
    const searchText = `${game.name} ${game.engine} ${game.location} ${uploaderName}`.toLowerCase()
    return searchText.includes(normalizedQuery)
  })

  const selectedGame =
    visibleGames.length > 0
      ? visibleGames.find((game) => game.hash === selectedGameHash) ?? visibleGames[0]
      : null
  const activeSourceLabel = selectedGame ? buildRemoteSourceLabel(selectedGame) : null
  const activePreviewMissing = selectedGame
    ? missingPreviewHashes.includes(selectedGame.hash)
    : false
  const selectedGameLoading = selectedGame ? loadingGameHash === selectedGame.hash : false
  const selectedGameProgress =
    selectedGame && loadProgress?.gameHash === selectedGame.hash ? loadProgress : null
  const currentGameLoaded =
    activeSourceLabel != null && currentSourceLabel === activeSourceLabel

  async function handleLoadGame(game: RemoteGameEntry) {
    const controller = new AbortController()
    const totalSteps = remoteDumpFiles.length + 2
    const payload: DumpImportPayload = {
      sourceLabel: buildRemoteSourceLabel(game),
      classesJson: '',
      structsJson: '',
      functionsJson: '',
      enumsJson: '',
      offsetsJson: null,
    }

    const updateLoadProgress = (
      stepIndex: number,
      label: string,
      fraction = 0,
    ) => {
      setLoadProgress({
        gameHash: game.hash,
        label,
        progress: clampProgress((stepIndex + clampProgress(fraction)) / totalSteps),
        step: Math.min(totalSteps, stepIndex + 1),
        totalSteps,
      })
    }

    if (clearProgressTimeoutRef.current != null) {
      window.clearTimeout(clearProgressTimeoutRef.current)
      clearProgressTimeoutRef.current = null
    }

    setLoadingGameHash(game.hash)
    setCatalogError(null)

    try {
      for (const [index, file] of remoteDumpFiles.entries()) {
        updateLoadProgress(index, `Downloading ${file.fileName}...`, 0)
        const content = await fetchRemoteDumpFile(
          game,
          file.fileName,
          controller.signal,
          false,
          (fraction) => {
            updateLoadProgress(index, `Downloading ${file.fileName}...`, fraction)
          },
        )

        if (content == null) {
          throw new Error(`Missing required remote file: ${file.fileName}`)
        }

        payload[file.payloadKey] = content
        updateLoadProgress(index, `Downloaded ${file.fileName}`, 1)
      }

      const offsetsStepIndex = remoteDumpFiles.length
      updateLoadProgress(offsetsStepIndex, 'Checking OffsetsInfo.json...', 0)
      payload.offsetsJson = await fetchRemoteDumpFile(
        game,
        'OffsetsInfo.json',
        controller.signal,
        true,
        (fraction) => {
          updateLoadProgress(offsetsStepIndex, 'Downloading OffsetsInfo.json...', fraction)
        },
      )
      updateLoadProgress(
        offsetsStepIndex,
        payload.offsetsJson ? 'Downloaded OffsetsInfo.json' : 'OffsetsInfo.json not provided',
        1,
      )

      const importStepIndex = offsetsStepIndex + 1
      updateLoadProgress(importStepIndex, 'Building symbol index...', 0)
      await onLoadRemoteDump(payload)
      updateLoadProgress(importStepIndex, 'Loaded into Symbol Browser', 1)

      clearProgressTimeoutRef.current = window.setTimeout(() => {
        setLoadProgress((current) => (current?.gameHash === game.hash ? null : current))
        clearProgressTimeoutRef.current = null
      }, 900)
    } catch (error) {
      if (!isAbortError(error)) {
        setCatalogError(normalizeError(error))
      }
      setLoadProgress((current) => (current?.gameHash === game.hash ? null : current))
    } finally {
      controller.abort()
      setLoadingGameHash(null)
    }
  }

  return (
    <section className="game-browser-shell">
      <section className="toolbar game-browser-toolbar">
        <div className="search-box">
          <label className="visually-hidden" htmlFor="remote-game-search">
            Search remote games
          </label>
          <input
            id="remote-game-search"
            type="search"
            value={query}
            placeholder="Search game, engine, folder or uploader..."
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>

        <div className="game-browser-toolbar-actions">
          <div className="game-browser-filter-group" role="group" aria-label="Filter by engine">
            {engineOptions.map((engine) => (
              <button
                key={engine}
                type="button"
                className={
                  engine === engineFilter
                    ? 'filter-pill game-filter-pill active'
                    : 'filter-pill game-filter-pill'
                }
                onClick={() => setEngineFilter(engine)}
              >
                {engine === defaultEngineFilter ? 'All Engines' : formatEngineName(engine)}
              </button>
            ))}
          </div>

          <button
            type="button"
            className="secondary-button game-refresh-button"
            onClick={() => setCatalogRevision((current) => current + 1)}
            disabled={loadingCatalog}
          >
            {loadingCatalog ? 'Refreshing...' : 'Refresh Catalog'}
          </button>
        </div>
      </section>

      {catalogError ? (
        <section className="error-banner">
          <strong>Error</strong>
          <span>{catalogError}</span>
        </section>
      ) : null}

      {!runningInTauri ? (
        <section className="panel game-browser-note">
          <strong>Tauri Required</strong>
          <p>目录可以查看，但真正导入并建立索引仍然需要桌面版 Tauri 应用来完成。</p>
        </section>
      ) : null}

      <section className="game-browser-layout">
        <aside className="panel results-panel game-catalog-panel">
          <div className="panel-header">
            <h2>Remote Games</h2>
            <span>{loadingCatalog ? 'Loading...' : `${visibleGames.length} items`}</span>
          </div>

          <div className="results-list game-catalog-list">
            {visibleGames.map((game) => {
              const active = selectedGame?.hash === game.hash
              const uploaderName = game.uploader?.name?.trim() || 'Unknown uploader'

              return (
                <button
                  key={game.hash}
                  type="button"
                  className={active ? 'result-card selected game-card' : 'result-card game-card'}
                  onClick={() => setSelectedGameHash(game.hash)}
                >
                  <div className="result-title-row">
                    <strong>{game.name}</strong>
                    <span className="kind-chip game-engine-chip">{formatEngineName(game.engine)}</span>
                  </div>

                  <div className="game-card-meta">
                    <span>{uploaderName}</span>
                    <span>{formatUploadedAt(game.uploaded)}</span>
                  </div>

                  <p>{`${game.location} • ${game.hash}`}</p>
                </button>
              )
            })}

            {!loadingCatalog && visibleGames.length === 0 ? (
              <p className="empty-state">No remote game matched the current filters.</p>
            ) : null}
          </div>
        </aside>

        <main className="panel detail-panel game-detail-panel">
          {selectedGame ? (
            <div className="game-detail-shell">
              <section className="detail-hero game-detail-hero">
                <div className="detail-card-head">
                  <div className="game-detail-title-group">
                    <p className="eyebrow">Remote Dump</p>
                    <h3>{selectedGame.name}</h3>
                    <div className="game-detail-title-meta">
                      <span className="kind-chip game-engine-chip">
                        {formatEngineName(selectedGame.engine)}
                      </span>
                      {currentGameLoaded ? (
                        <span className="game-source-badge">Currently loaded</span>
                      ) : null}
                    </div>
                  </div>

                  <div className="game-detail-actions">
                    <div className="game-detail-action-row">
                      <button
                        type="button"
                        className="primary-button game-load-button"
                        onClick={() => void handleLoadGame(selectedGame)}
                        disabled={!runningInTauri || selectedGameLoading}
                      >
                        {selectedGameLoading
                          ? 'Loading remote dump...'
                          : currentGameLoaded
                            ? 'Reload into Symbol Browser'
                            : 'Load into Symbol Browser'}
                      </button>

                      <a
                        className="game-link-button"
                        href={buildGitHubFolderUrl(selectedGame)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open GitHub Folder
                      </a>
                    </div>

                    {selectedGameProgress ? (
                      <div className="game-load-progress" aria-live="polite">
                        <div className="game-load-progress-head">
                          <span>
                            {selectedGameProgress.step === selectedGameProgress.totalSteps &&
                            busyLabel
                              ? busyLabel
                              : selectedGameProgress.label}
                          </span>
                          <strong>{`${Math.round(selectedGameProgress.progress * 100)}%`}</strong>
                        </div>
                        <div
                          className="game-load-progress-track"
                          role="progressbar"
                          aria-label="Remote dump load progress"
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-valuenow={Math.round(selectedGameProgress.progress * 100)}
                        >
                          <span
                            className="game-load-progress-fill"
                            style={{ width: `${Math.round(selectedGameProgress.progress * 100)}%` }}
                          />
                        </div>
                        <div className="game-load-progress-meta">
                          <span>{`Step ${selectedGameProgress.step} / ${selectedGameProgress.totalSteps}`}</span>
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="game-detail-visual-shell">
                  {!activePreviewMissing ? (
                    <img
                      src={buildRemoteGameFileUrl(selectedGame, 'image.jpg')}
                      alt={`${selectedGame.name} preview`}
                      className="game-detail-preview"
                      onError={() =>
                        setMissingPreviewHashes((current) =>
                          current.includes(selectedGame.hash)
                            ? current
                            : [...current, selectedGame.hash],
                        )
                      }
                    />
                  ) : (
                    <div className="game-detail-preview game-detail-preview-fallback">
                      <strong>No preview image</strong>
                      <span>{selectedGame.location}</span>
                    </div>
                  )}
                </div>
              </section>

              <article className="table-block game-meta-card">
                <div className="table-row compact">
                  <div className="table-main">
                    <strong>Uploader</strong>
                    <span>{selectedGame.uploader?.name?.trim() || 'Unknown uploader'}</span>
                  </div>
                  {selectedGame.uploader?.link ? (
                    <a
                      className="game-inline-link"
                      href={selectedGame.uploader.link}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Profile
                    </a>
                  ) : null}
                </div>
                <div className="table-row compact">
                  <div className="table-main">
                    <strong>Uploaded</strong>
                    <span>{formatUploadedAt(selectedGame.uploaded)}</span>
                  </div>
                </div>
                <div className="table-row compact">
                  <div className="table-main">
                    <strong>Folder</strong>
                    <span>{`${selectedGame.engine}/${selectedGame.location}`}</span>
                  </div>
                </div>
                <div className="table-row compact">
                  <div className="table-main">
                    <strong>Source Label</strong>
                    <span>{buildRemoteSourceLabel(selectedGame)}</span>
                  </div>
                </div>
              </article>
            </div>
          ) : (
            <div className="empty-detail game-empty-detail">
              <h3>Select a remote game</h3>
              <p>Pick a game from the left list to inspect its GitHub source and load it into the browser.</p>
            </div>
          )}
        </main>
      </section>
    </section>
  )
}

export default GameBrowserPage
