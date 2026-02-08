import { useEffect, useMemo, useState } from 'react'
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
} from 'recharts'
import { auth, provider } from './firebase'
import { onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth'
import './App.css'

const defaultApiBase = (import.meta.env.VITE_API_BASE || 'https://spx-fake-breakout.onrender.com').replace(/\/$/, '')
const emptyPanel = { data: null, loading: false, error: null }
const tabs = [
  { key: 'account', label: 'Compte', icon: '\u{1F4B0}' },
  { key: 'positions', label: 'Positions', icon: '\u{1F4CA}' },
  { key: 'strategies', label: 'Strategies', icon: '\u{2699}\u{FE0F}' },
  { key: 'market', label: 'Marche', icon: '\u{1F4C8}' },
  { key: 'logs', label: 'Logs', icon: '\u{1F4DD}' },
]

const LOG_LEVELS = ['', 'TRADING', 'OANDA', 'INFO', 'ERROR', 'NO_TRADING', 'GPT']

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
  const [openingDay, setOpeningDay] = useState(() => new Date().toISOString().slice(0, 10))
  const [candlesDay, setCandlesDay] = useState(() => new Date().toISOString().slice(0, 10))
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
        setAuthError("Cet utilisateur n'est pas autorise.")
        signOut(auth)
        setUser(null)
      } else {
        setUser(null)
      }
    })
    return () => unsub()
  }, [])

  /* ─────────────── ACCOUNT ─────────────── */
  const renderAccount = () => {
    const bal = balance.data?.balance
    return (
      <section className="card">
        <div className="card-header">
          <div>
            <p className="eyebrow">Compte OANDA</p>
            <h2>Bonjour, {user?.displayName?.split(' ')[0] || 'Vincent'}</h2>
          </div>
          <button className="btn-secondary" onClick={loadBalance} disabled={balance.loading}>
            {balance.loading ? 'Chargement...' : 'Rafraichir'}
          </button>
        </div>
        {balance.error && <p className="error">{balance.error}</p>}
        {balance.data && (
          <div className="account-grid">
            <div className="stat-card accent">
              <span className="stat-label">Solde du compte</span>
              <span className="stat-value">{Number(bal).toLocaleString('fr-CH', { minimumFractionDigits: 2 })} CHF</span>
            </div>
            <div className="stat-card">
              <span className="stat-label">Statut</span>
              <span className="stat-value">{balance.data.message || 'Connecte'}</span>
            </div>
            <div className="stat-card">
              <span className="stat-label">Email</span>
              <span className="stat-value small">{user?.email}</span>
            </div>
          </div>
        )}
      </section>
    )
  }

  /* ─────────────── POSITIONS ─────────────── */
  const renderPositions = () => {
    const posData = positions.data || {}
    const openTrades = posData.trades || []
    const openPositions = posData.positions || []

    const totalPnL = openTrades.reduce((sum, t) => sum + parseFloat(t.unrealizedPL || 0), 0)

    return (
      <>
        <section className="card">
          <div className="card-header">
            <div>
              <p className="eyebrow">Positions ouvertes</p>
              <h2>En cours {openTrades.length > 0 && <span className="count-badge">{openTrades.length}</span>}</h2>
            </div>
            <button className="btn-secondary" onClick={loadPositions} disabled={positions.loading}>
              {positions.loading ? 'Chargement...' : 'Rafraichir'}
            </button>
          </div>

          {positions.error && <p className="error">{positions.error}</p>}

          {openTrades.length > 0 && (
            <>
              <div className={`pnl-banner ${totalPnL >= 0 ? 'up' : 'down'}`}>
                <span>PnL latent total</span>
                <strong>{totalPnL >= 0 ? '+' : ''}{totalPnL.toFixed(2)} CHF</strong>
              </div>
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
                          <span className="pos-label">Prix d'entree</span>
                          <span className="pos-value">{parseFloat(t.price).toFixed(1)}</span>
                        </div>
                        <div className="pos-row">
                          <span className="pos-label">Units</span>
                          <span className="pos-value">{Math.abs(units).toFixed(1)}</span>
                        </div>
                        {t.stopLossOrder && (
                          <div className="pos-row">
                            <span className="pos-label">Stop Loss</span>
                            <span className="pos-value sl">{parseFloat(t.stopLossOrder.price).toFixed(1)}</span>
                          </div>
                        )}
                        {t.takeProfitOrder && (
                          <div className="pos-row">
                            <span className="pos-label">Take Profit</span>
                            <span className="pos-value tp">{parseFloat(t.takeProfitOrder.price).toFixed(1)}</span>
                          </div>
                        )}
                        <div className="pos-row pnl-row">
                          <span className="pos-label">PnL</span>
                          <span className={`pos-value bold ${uPnL > 0 ? 'positive' : uPnL < 0 ? 'negative' : ''}`}>
                            {uPnL > 0 ? '+' : ''}{uPnL.toFixed(2)} CHF
                          </span>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </>
          )}

          {!positions.loading && openTrades.length === 0 && !positions.error && (
            <div className="empty-state">
              <p>Aucune position ouverte</p>
            </div>
          )}
        </section>

        <section className="card">
          <div className="card-header">
            <div>
              <p className="eyebrow">Historique</p>
              <h2>Trades passes</h2>
            </div>
            <button className="btn-secondary" onClick={loadTrades} disabled={trades.loading}>
              {trades.loading ? 'Chargement...' : 'Charger'}
            </button>
          </div>
          {trades.error && <p className="error">{trades.error}</p>}
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
                    <th>Fill</th>
                    <th>Outcome</th>
                    <th>PnL</th>
                    <th>ID</th>
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
          {Array.isArray(trades.data) && trades.data.length === 0 && (
            <div className="empty-state"><p>Aucun trade enregistre</p></div>
          )}
        </section>
      </>
    )
  }

  /* ─────────────── STRATEGIES ─────────────── */
  const renderStrategies = () => (
    <section className="card">
      <div className="card-header">
        <div>
          <p className="eyebrow">Configuration</p>
          <h2>Strategies actives</h2>
        </div>
        <button className="btn-secondary" onClick={loadStrategies} disabled={strategies.loading}>
          {strategies.loading ? 'Chargement...' : 'Rafraichir'}
        </button>
      </div>
      {strategies.error && <p className="error">{strategies.error}</p>}
      {strategyEntries.length === 0 && !strategies.loading && (
        <div className="empty-state"><p>Aucune strategie configuree</p></div>
      )}
      <div className="strat-grid">
        {strategyEntries.map(([name, enabled]) => (
          <div key={name} className={`strat-card ${enabled ? 'active' : 'inactive'}`}>
            <div className="strat-card-top">
              <span className={`strat-dot ${enabled ? 'on' : 'off'}`} />
              <span className="strat-name">{name}</span>
            </div>
            <div className="strat-card-bottom">
              <span className={`pill ${enabled ? 'on' : 'off'}`}>{enabled ? 'ACTIVE' : 'INACTIVE'}</span>
              <button
                className={enabled ? 'btn-danger-sm' : 'btn-success-sm'}
                onClick={() => toggleStrategy(name)}
                disabled={strategies.loading}
              >
                {enabled ? 'Desactiver' : 'Activer'}
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  )

  /* ─────────────── MARKET ─────────────── */
  const renderMarket = () => {
    const chartData = parseCandleData()
    const orData = openingRange.data
    return (
      <>
        <section className="card">
          <div className="card-header">
            <div>
              <p className="eyebrow">Donnees de marche</p>
              <h2>Opening Range & Bougies</h2>
            </div>
          </div>

          <div className="market-controls">
            <div className="control-group">
              <label>Instrument</label>
              <input value={instrument} onChange={(e) => setInstrument(e.target.value)} />
            </div>
            <div className="control-group">
              <label>Opening Range</label>
              <div className="input-row">
                <input type="date" value={openingDay} onChange={(e) => setOpeningDay(e.target.value)} />
                <button className="btn-secondary" onClick={loadOpening} disabled={openingRange.loading || !openingDay}>
                  {openingRange.loading ? '...' : 'Charger'}
                </button>
              </div>
            </div>
            <div className="control-group">
              <label>Bougies 1min</label>
              <div className="input-row">
                <input type="date" value={candlesDay} onChange={(e) => setCandlesDay(e.target.value)} />
                <button className="btn-secondary" onClick={loadCandles} disabled={candles.loading || !candlesDay}>
                  {candles.loading ? '...' : 'Charger'}
                </button>
              </div>
            </div>
          </div>

          {openingRange.error && <p className="error">{openingRange.error}</p>}
          {orData && (
            <div className="or-cards">
              <div className="or-card">
                <span className="or-label">High</span>
                <span className="or-value">{Number(orData.high).toFixed(1)}</span>
              </div>
              <div className="or-card">
                <span className="or-label">Low</span>
                <span className="or-value">{Number(orData.low).toFixed(1)}</span>
              </div>
              {orData.range_size != null && (
                <div className="or-card">
                  <span className="or-label">Range</span>
                  <span className="or-value">{Number(orData.range_size).toFixed(1)}</span>
                </div>
              )}
              <div className="or-card">
                <span className="or-label">Status</span>
                <span className={`pill ${orData.status === 'ready' ? 'on' : 'off'}`}>{orData.status || '-'}</span>
              </div>
            </div>
          )}
        </section>

        <section className="card">
          <div className="card-header">
            <div>
              <p className="eyebrow">Graphique</p>
              <h2>Prix intraday</h2>
            </div>
          </div>
          {candles.error && <p className="error">{candles.error}</p>}
          <div className="chart-card">
            {chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={320}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="ts" hide />
                  <YAxis dataKey="close" domain={['auto', 'auto']} tick={{ fontSize: 11 }} width={55} />
                  <Tooltip
                    contentStyle={{ background: '#111827', border: 'none', borderRadius: 8, color: '#e5e7eb', fontSize: 13 }}
                    labelStyle={{ color: '#9ca3af' }}
                  />
                  {orData && <ReferenceLine y={orData.high} stroke="#16a34a" strokeDasharray="6 3" label={{ value: 'High', fill: '#16a34a', fontSize: 11 }} />}
                  {orData && <ReferenceLine y={orData.low} stroke="#dc2626" strokeDasharray="6 3" label={{ value: 'Low', fill: '#dc2626', fontSize: 11 }} />}
                  <Line type="monotone" dataKey="close" stroke="#2563eb" strokeWidth={1.5} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="empty-state"><p>Charge des bougies pour afficher le graphique</p></div>
            )}
          </div>
        </section>
      </>
    )
  }

  /* ─────────────── LOGS ─────────────── */
  const renderLogs = () => (
    <section className="card">
      <div className="card-header">
        <div>
          <p className="eyebrow">Systeme</p>
          <h2>Logs</h2>
        </div>
        <button className="btn-secondary" onClick={loadLogs} disabled={logs.loading}>
          {logs.loading ? 'Chargement...' : 'Charger'}
        </button>
      </div>

      <div className="log-filters">
        <div className="control-group">
          <label>Limite</label>
          <input
            type="number"
            value={logParams.limit}
            min={1}
            max={500}
            onChange={(e) => setLogParams((p) => ({ ...p, limit: Number(e.target.value) }))}
          />
        </div>
        <div className="control-group">
          <label>Niveau</label>
          <div className="level-chips">
            {LOG_LEVELS.map((lvl) => (
              <button
                key={lvl}
                className={`chip ${logParams.level === lvl ? 'active' : ''}`}
                onClick={() => setLogParams((p) => ({ ...p, level: lvl }))}
              >
                {lvl || 'Tous'}
              </button>
            ))}
          </div>
        </div>
        <div className="control-group">
          <label>Recherche</label>
          <input
            value={logParams.contains}
            placeholder="Mot-cle..."
            onChange={(e) => setLogParams((p) => ({ ...p, contains: e.target.value }))}
          />
        </div>
      </div>

      {logs.error && <p className="error">{logs.error}</p>}
      {Array.isArray(logs.data) && logs.data.length > 0 && (
        <div className="log-list">
          {logs.data.map((log, idx) => {
            const lvl = (log.level || '').toUpperCase()
            return (
              <div key={idx} className={`log-entry level-${lvl.toLowerCase()}`}>
                <div className="log-meta">
                  <span className={`log-level ${lvl.toLowerCase()}`}>{lvl || 'LOG'}</span>
                  <span className="log-time">{log.timestamp ? new Date(log.timestamp).toLocaleString('fr-CH', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : ''}</span>
                </div>
                <p className="log-msg">{log.message || JSON.stringify(log)}</p>
              </div>
            )
          })}
        </div>
      )}
      {Array.isArray(logs.data) && logs.data.length === 0 && (
        <div className="empty-state"><p>Aucun log trouve</p></div>
      )}
    </section>
  )

  const renderTabContent = () => {
    switch (activeTab) {
      case 'account': return renderAccount()
      case 'positions': return renderPositions()
      case 'strategies': return renderStrategies()
      case 'market': return renderMarket()
      case 'logs': return renderLogs()
      default: return null
    }
  }

  return (
    <div className="page">
      <header className="top-bar">
        <div className="top-bar-left">
          <h1 className="logo">SPX Trading</h1>
          <span className="muted version">v2.0</span>
        </div>
        <div className="top-bar-right">
          {user ? (
            <>
              <span className="muted">{user.email}</span>
              <button className="btn-ghost" onClick={() => signOut(auth)}>Deconnexion</button>
            </>
          ) : (
            <button onClick={() => signInWithPopup(auth, provider)}>Connexion Google</button>
          )}
        </div>
      </header>

      {!user ? (
        <div className="login-page">
          <div className="login-card">
            <h2>Connexion requise</h2>
            <p className="muted">Acces restreint.</p>
            <button onClick={() => signInWithPopup(auth, provider)}>Connexion avec Google</button>
            {authError && <p className="error">{authError}</p>}
          </div>
        </div>
      ) : (
        <>
          <nav className="tabs">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                className={tab.key === activeTab ? 'tab active' : 'tab'}
                onClick={() => setActiveTab(tab.key)}
              >
                <span className="tab-icon">{tab.icon}</span>
                <span className="tab-label">{tab.label}</span>
              </button>
            ))}
          </nav>

          <main className="content">
            {renderTabContent()}
          </main>
        </>
      )}
    </div>
  )
}

export default App
