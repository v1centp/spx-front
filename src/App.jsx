import { useEffect, useMemo, useState } from 'react'
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
} from 'recharts'
import { auth, provider } from './firebase'
import { onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth'
import './App.css'

const defaultApiBase = (import.meta.env.VITE_API_BASE || 'https://spx-fake-breakout.onrender.com').replace(/\/$/, '')
const emptyPanel = { data: null, loading: false, error: null }
const tabs = [
  { key: 'account', label: 'Mon compte' },
  { key: 'positions', label: 'Mes positions' },
  { key: 'strategies', label: 'Mes stratégies' },
  { key: 'market', label: 'Infos marché' },
  { key: 'logs', label: 'Logs' },
]

function App() {
  const [apiBase, setApiBase] = useState(defaultApiBase)
  const [activeTab, setActiveTab] = useState('account')
  const [user, setUser] = useState(null)
  const [authError, setAuthError] = useState('')

  const [strategies, setStrategies] = useState(emptyPanel)
  const [balance, setBalance] = useState(emptyPanel)
  const [logs, setLogs] = useState(emptyPanel)
  const [trades, setTrades] = useState(emptyPanel)
  const [positions, setPositions] = useState(emptyPanel)
  const [openingRange, setOpeningRange] = useState(emptyPanel)
  const [candles, setCandles] = useState(emptyPanel)

  const [logParams, setLogParams] = useState({ limit: 50, level: '', contains: '' })
  const [openingDay, setOpeningDay] = useState('')
  const [candlesDay, setCandlesDay] = useState('')
  const [instrument, setInstrument] = useState('SPX')

  const apiPrefix = useMemo(() => apiBase.replace(/\/$/, ''), [apiBase])

  const fetchJson = async (endpoint, options = {}) => {
    const url = `${apiPrefix}${endpoint}`
    const resp = await fetch(url, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    })
    const data = await resp.json().catch(() => ({}))

    const tupleStatus = Array.isArray(data) && typeof data[data.length - 1] === 'number' ? data[data.length - 1] : null

    if (!resp.ok || (tupleStatus && tupleStatus >= 400)) {
      const payload = Array.isArray(data) ? data[0] : data
      const message = payload?.error || payload?.message || resp.statusText || `HTTP ${tupleStatus}`
      throw new Error(message || 'Erreur API')
    }
    return data
  }

  const loadStrategies = async () => {
    setStrategies((p) => ({ ...p, loading: true, error: null }))
    try {
      const data = await fetchJson('/api/strategy/all')
      setStrategies({ data, loading: false, error: null })
    } catch (err) {
      setStrategies({ data: null, loading: false, error: err.message })
    }
  }

  const toggleStrategy = async (name) => {
    if (!name) return
    setStrategies((p) => ({ ...p, loading: true, error: null }))
    try {
      await fetchJson('/api/strategy/toggle', {
        method: 'POST',
        body: JSON.stringify({ strategy: name }),
      })
      await loadStrategies()
    } catch (err) {
      setStrategies((p) => ({ ...p, loading: false, error: err.message }))
    }
  }

  const loadBalance = async () => {
    setBalance((p) => ({ ...p, loading: true, error: null }))
    try {
      const data = await fetchJson('/check-balance')
      setBalance({ data, loading: false, error: null })
    } catch (err) {
      setBalance({ data: null, loading: false, error: err.message })
    }
  }

  const loadLogs = async () => {
    setLogs((p) => ({ ...p, loading: true, error: null }))
    try {
      const params = new URLSearchParams()
      if (logParams.limit) params.append('limit', logParams.limit)
      if (logParams.level) params.append('level', logParams.level)
      if (logParams.contains) params.append('contains', logParams.contains)
      const data = await fetchJson(`/api/logs?${params.toString()}`)
      setLogs({ data, loading: false, error: null })
    } catch (err) {
      setLogs({ data: null, loading: false, error: err.message })
    }
  }

  const loadTrades = async () => {
    setTrades((p) => ({ ...p, loading: true, error: null }))
    try {
      const data = await fetchJson('/api/trades')
      setTrades({ data, loading: false, error: null })
    } catch (err) {
      setTrades({ data: null, loading: false, error: err.message })
    }
  }

  const loadPositions = async () => {
    setPositions((p) => ({ ...p, loading: true, error: null }))
    try {
      const data = await fetchJson('/api/positions')
      setPositions({ data, loading: false, error: null })
    } catch (err) {
      setPositions({ data: null, loading: false, error: err.message })
    }
  }

  const loadOpening = async () => {
    if (!openingDay) return
    setOpeningRange((p) => ({ ...p, loading: true, error: null }))
    try {
      const data = await fetchJson(`/api/opening_range/${openingDay}?instrument=${instrument}`)
      setOpeningRange({ data, loading: false, error: null })
    } catch (err) {
      setOpeningRange({ data: null, loading: false, error: err.message })
    }
  }

  const loadCandles = async () => {
    if (!candlesDay) return
    setCandles((p) => ({ ...p, loading: true, error: null }))
    try {
      const data = await fetchJson(`/api/candles?day=${encodeURIComponent(candlesDay)}`)
      setCandles({ data, loading: false, error: null })
    } catch (err) {
      setCandles({ data: null, loading: false, error: err.message })
    }
  }

  useEffect(() => {
    loadStrategies()
    loadBalance()
  }, [])

  const strategyEntries = strategies.data ? Object.entries(strategies.data) : []

  const parseCandleData = () => {
    if (!Array.isArray(candles.data)) return []
    return candles.data.map((c, idx) => {
      const ts = c.timestamp || c.t || c.s || idx
      const close = c.c ?? c.close ?? c.price ?? c.vwap ?? null
      return {
        ts: String(ts),
        close,
        high: c.h ?? c.high,
        low: c.l ?? c.low,
      }
    })
  }

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setAuthError('')
      if (u && u.email === 'vincent.porret@hotmail.com') {
        setUser(u)
        loadStrategies()
        loadBalance()
      } else if (u) {
        setAuthError("Cet utilisateur n'est pas autorisé.")
        signOut(auth)
        setUser(null)
      } else {
        setUser(null)
      }
    })
    return () => unsub()
  }, [])

  const renderAccount = () => (
    <section className="card">
      <div className="card-header">
        <div>
          <p className="eyebrow">Compte</p>
          <h2>Bonjour, {user?.displayName || 'Vincent'}</h2>
        </div>
        <button onClick={loadBalance} disabled={balance.loading}>Rafraîchir</button>
      </div>
      {balance.error && <p className="error">Erreur : {balance.error}</p>}
      {balance.loading && <p className="muted">Chargement…</p>}
      {balance.data && (
        <div className="info-grid">
          <div className="pill-strong">
            <p className="muted">Message</p>
            <strong>{balance.data.message}</strong>
          </div>
          <div className="pill-strong">
            <p className="muted">Solde</p>
            <strong>{balance.data.balance}</strong>
          </div>
        </div>
      )}
    </section>
  )

  const renderPositions = () => {
    const posData = positions.data || {}
    const openTrades = posData.trades || []
    const openPositions = posData.positions || []

    return (
      <section className="card">
        <div className="card-header">
          <div>
            <p className="eyebrow">Positions</p>
            <h2>Mes positions & historique</h2>
          </div>
          <div className="actions">
            <button onClick={loadPositions} disabled={positions.loading}>Rafraichir positions</button>
            <button onClick={loadTrades} disabled={trades.loading}>Charger trades</button>
          </div>
        </div>

        {positions.error && <p className="error">Erreur positions : {positions.error}</p>}
        {positions.loading && <p className="muted">Chargement positions…</p>}

        {/* Open trades OANDA */}
        {openTrades.length > 0 && (
          <>
            <h3>Trades ouverts ({openTrades.length})</h3>
            <div className="pos-grid">
              {openTrades.map((t) => {
                const uPnL = parseFloat(t.unrealizedPL || 0)
                const units = parseFloat(t.currentUnits || t.initialUnits || 0)
                const dir = units >= 0 ? 'LONG' : 'SHORT'
                return (
                  <div key={t.id} className="pos-card">
                    <div className="pos-card-header">
                      <span className="pos-instrument">{t.instrument}</span>
                      <span className={`pill-dir ${dir === 'LONG' ? 'long' : 'short'}`}>{dir}</span>
                    </div>
                    <div className="pos-card-body">
                      <div className="pos-row">
                        <span className="pos-label">ID</span>
                        <span className="pos-value mono">{t.id}</span>
                      </div>
                      <div className="pos-row">
                        <span className="pos-label">Prix</span>
                        <span className="pos-value">{parseFloat(t.price).toFixed(1)}</span>
                      </div>
                      <div className="pos-row">
                        <span className="pos-label">Units</span>
                        <span className="pos-value">{Math.abs(units).toFixed(1)}</span>
                      </div>
                      <div className="pos-row">
                        <span className="pos-label">PnL latent</span>
                        <span className={`pos-value bold ${uPnL > 0 ? 'positive' : uPnL < 0 ? 'negative' : ''}`}>
                          {uPnL > 0 ? '+' : ''}{uPnL.toFixed(2)} CHF
                        </span>
                      </div>
                      {t.stopLossOrder && (
                        <div className="pos-row">
                          <span className="pos-label">SL</span>
                          <span className="pos-value">{parseFloat(t.stopLossOrder.price).toFixed(1)}</span>
                        </div>
                      )}
                      {t.takeProfitOrder && (
                        <div className="pos-row">
                          <span className="pos-label">TP</span>
                          <span className="pos-value">{parseFloat(t.takeProfitOrder.price).toFixed(1)}</span>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </>
        )}

        {!positions.loading && openTrades.length === 0 && !positions.error && (
          <p className="muted">Aucune position ouverte.</p>
        )}

        {/* Positions agrégées */}
        {openPositions.length > 0 && (
          <>
            <h3>Positions agrégées</h3>
            <div className="pos-grid">
              {openPositions.map((p) => {
                const longUnits = parseFloat(p.long?.units || 0)
                const shortUnits = parseFloat(p.short?.units || 0)
                const totalPnL = parseFloat(p.unrealizedPL || 0)
                return (
                  <div key={p.instrument} className="pos-card">
                    <div className="pos-card-header">
                      <span className="pos-instrument">{p.instrument}</span>
                      <span className={`pos-pnl-badge ${totalPnL >= 0 ? 'up' : 'down'}`}>
                        {totalPnL >= 0 ? '+' : ''}{totalPnL.toFixed(2)}
                      </span>
                    </div>
                    <div className="pos-card-body">
                      {longUnits !== 0 && (
                        <div className="pos-row">
                          <span className="pos-label">Long</span>
                          <span className="pos-value">{longUnits.toFixed(1)} @ {parseFloat(p.long.averagePrice).toFixed(1)}</span>
                        </div>
                      )}
                      {shortUnits !== 0 && (
                        <div className="pos-row">
                          <span className="pos-label">Short</span>
                          <span className="pos-value">{Math.abs(shortUnits).toFixed(1)} @ {parseFloat(p.short.averagePrice).toFixed(1)}</span>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </>
        )}

        {/* Trade history table */}
        <h3>Historique trades</h3>
        {trades.error && <p className="error">Erreur trades : {trades.error}</p>}
        {trades.loading && <p className="muted">Chargement trades…</p>}
        {Array.isArray(trades.data) && trades.data.length > 0 && (
          <div className="table-wrap">
            <table className="trade-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Strategie</th>
                  <th>Direction</th>
                  <th>Entry</th>
                  <th>SL</th>
                  <th>TP</th>
                  <th>Units</th>
                  <th>Fill Price</th>
                  <th>Outcome</th>
                  <th>PnL</th>
                  <th>OANDA ID</th>
                </tr>
              </thead>
              <tbody>
                {trades.data.map((t) => (
                  <tr key={t.id}>
                    <td className="cell-date">{t.timestamp ? new Date(t.timestamp).toLocaleString('fr-CH', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-'}</td>
                    <td><span className="pill-strat">{t.strategy}</span></td>
                    <td><span className={`pill-dir ${t.direction === 'LONG' ? 'long' : 'short'}`}>{t.direction}</span></td>
                    <td>{t.entry != null ? Number(t.entry).toFixed(1) : '-'}</td>
                    <td>{t.sl != null ? Number(t.sl).toFixed(1) : '-'}</td>
                    <td>{t.tp != null ? Number(t.tp).toFixed(1) : '-'}</td>
                    <td>{t.units != null ? Number(t.units).toFixed(1) : '-'}</td>
                    <td>{t.fill_price != null ? Number(t.fill_price).toFixed(1) : '-'}</td>
                    <td><span className={`pill-outcome ${t.outcome}`}>{t.outcome || 'unknown'}</span></td>
                    <td className={`cell-pnl ${t.realized_pnl > 0 ? 'positive' : t.realized_pnl < 0 ? 'negative' : ''}`}>
                      {t.realized_pnl != null ? `${t.realized_pnl > 0 ? '+' : ''}${Number(t.realized_pnl).toFixed(2)}` : '-'}
                    </td>
                    <td className="cell-id">{t.oanda_trade_id || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    )
  }

  const renderStrategies = () => (
    <section className="card">
      <div className="card-header">
        <div>
          <p className="eyebrow">Stratégies</p>
          <h2>Mes stratégies</h2>
        </div>
        <div className="actions">
          <button onClick={loadStrategies} disabled={strategies.loading}>Rafraîchir</button>
        </div>
      </div>
      {strategies.error && <p className="error">Erreur : {strategies.error}</p>}
      {strategies.loading && <p className="muted">Chargement…</p>}
      {strategyEntries.length === 0 && !strategies.loading && <p className="muted">Aucune stratégie.</p>}
      <ul className="list">
        {strategyEntries.map(([name, enabled]) => (
          <li key={name} className="list-item">
            <div>
              <strong>{name}</strong>
              <span className={`pill ${enabled ? 'on' : 'off'}`}>{enabled ? 'ON' : 'OFF'}</span>
            </div>
            <button onClick={() => toggleStrategy(name)} disabled={strategies.loading}>
              {enabled ? 'Désactiver' : 'Activer'}
            </button>
          </li>
        ))}
      </ul>
    </section>
  )

  const renderMarket = () => {
    const chartData = parseCandleData()
    return (
      <section className="card">
        <div className="card-header">
          <div>
            <p className="eyebrow">Marché</p>
            <h2>Infos marché & graphique</h2>
          </div>
          <div className="actions">
            <label>
              Instrument
              <input value={instrument} onChange={(e) => setInstrument(e.target.value)} style={{ width: 100 }} />
            </label>
          </div>
        </div>

        <div className="stack">
          <div className="inline">
            <label>Opening range jour (YYYY-MM-DD)</label>
            <input value={openingDay} onChange={(e) => setOpeningDay(e.target.value)} />
            <button onClick={loadOpening} disabled={openingRange.loading || !openingDay}>Charger</button>
          </div>
          <div className="inline">
            <label>Bougies (YYYY-MM-DD)</label>
            <input value={candlesDay} onChange={(e) => setCandlesDay(e.target.value)} />
            <button onClick={loadCandles} disabled={candles.loading || !candlesDay}>Charger</button>
          </div>
        </div>

        {openingRange.error && <p className="error">Erreur opening range : {openingRange.error}</p>}
        {openingRange.data && (
          <div className="pill-strong">
            <p className="muted">Opening Range</p>
            <strong>{JSON.stringify(openingRange.data)}</strong>
          </div>
        )}

        <div className="chart-card">
          {candles.error && <p className="error">Erreur bougies : {candles.error}</p>}
          {candles.loading && <p className="muted">Chargement bougies…</p>}
          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={chartData}>
                <XAxis dataKey="ts" hide />
                <YAxis dataKey="close" domain={['auto', 'auto']} />
                <Tooltip />
                <Line type="monotone" dataKey="close" stroke="#2563eb" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <p className="muted">Aucune donnée bougie chargée.</p>
          )}
        </div>
      </section>
    )
  }

  const renderLogs = () => (
    <section className="card">
      <div className="card-header">
        <div>
          <p className="eyebrow">Logs</p>
          <h2>Recherche logs</h2>
        </div>
        <button onClick={loadLogs} disabled={logs.loading}>Charger</button>
      </div>
      <div className="stack">
        <div className="inline">
          <label>Limit</label>
          <input
            type="number"
            value={logParams.limit}
            min={1}
            onChange={(e) => setLogParams((p) => ({ ...p, limit: Number(e.target.value) }))}
          />
        </div>
        <div className="inline">
          <label>Niveau</label>
          <input
            value={logParams.level}
            placeholder="INFO / ERROR"
            onChange={(e) => setLogParams((p) => ({ ...p, level: e.target.value }))}
          />
        </div>
        <div className="inline">
          <label>Contient</label>
          <input
            value={logParams.contains}
            placeholder="mot-clé"
            onChange={(e) => setLogParams((p) => ({ ...p, contains: e.target.value }))}
          />
        </div>
      </div>
      {logs.error && <p className="error">Erreur : {logs.error}</p>}
      {logs.loading && <p className="muted">Chargement…</p>}
      {Array.isArray(logs.data) && logs.data.length > 0 && (
        <div className="scroll">
          {logs.data.map((log, idx) => (
            <pre key={idx} className="code">{JSON.stringify(log, null, 2)}</pre>
          ))}
        </div>
      )}
    </section>
  )

  const renderTabContent = () => {
    switch (activeTab) {
      case 'account':
        return renderAccount()
      case 'positions':
        return renderPositions()
      case 'strategies':
        return renderStrategies()
      case 'market':
        return renderMarket()
      case 'logs':
        return renderLogs()
      default:
        return null
    }
  }

  return (
    <div className="page">
      <header className="header">
        <div>
          <p className="eyebrow">SPX Fake Breakout</p>
          <h1>Console front ↔ back</h1>
          <p className="muted">Base API : configure ci-dessous, puis navigue entre les sections.</p>
        </div>
        <div className="api-input">
          <label htmlFor="api">API base URL</label>
          <input
            id="api"
            value={apiBase}
            onChange={(e) => setApiBase(e.target.value)}
            placeholder="https://spx-fake-breakout.onrender.com"
          />
          <div className="auth-row">
            {user ? (
              <>
                <span className="muted">{user.email}</span>
                <button onClick={() => signOut(auth)}>Se déconnecter</button>
              </>
            ) : (
              <button onClick={() => signInWithPopup(auth, provider)}>Connexion Google</button>
            )}
          </div>
          {authError && <p className="error">{authError}</p>}
        </div>
      </header>

      {!user ? (
        <section className="card">
          <h2>Connexion requise</h2>
          <p className="muted">Seul vincent.porret@gmail.com est autorisé.</p>
          <button onClick={() => signInWithPopup(auth, provider)}>Connexion Google</button>
          {authError && <p className="error">{authError}</p>}
        </section>
      ) : (
        <>
          <nav className="tabs">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                className={tab.key === activeTab ? 'tab active' : 'tab'}
                onClick={() => setActiveTab(tab.key)}
              >
                {tab.label}
              </button>
            ))}
          </nav>

          <div className="tab-content">
            {renderTabContent()}
          </div>
        </>
      )}
    </div>
  )
}

export default App
