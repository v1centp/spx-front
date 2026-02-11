import { useEffect, useMemo, useRef, useState } from 'react'
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom'
import { createChart, CandlestickSeries, createTextWatermark, createSeriesMarkers } from 'lightweight-charts'
import { ResponsiveContainer, LineChart, Line, Tooltip } from 'recharts'
import { auth, provider } from './firebase'
import { onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth'
import './App.css'

const defaultApiBase = (import.meta.env.VITE_API_BASE || 'https://spx-fake-breakout.onrender.com').replace(/\/$/, '')
const emptyPanel = { data: null, loading: false, error: null }
const tabs = [
  { key: 'account', label: 'Compte', icon: '\u{1F4B0}' },
  { key: 'positions', label: 'Positions', icon: '\u{1F4CA}' },
  { key: 'strategies', label: 'Stratégies', icon: '\u{2699}\u{FE0F}' },
  { key: 'news', label: 'News', icon: '\u{1F4C5}' },
  { key: 'logs', label: 'Logs', icon: '\u{1F4DD}' },
  { key: 'stats', label: 'Stats', icon: '\u{1F4CA}' },
]

const LOG_LEVELS = ['', 'TRADING', 'OANDA', 'INFO', 'ERROR', 'NO_TRADING', 'GPT']
const INSTRUMENTS = [
  { sym: 'SPX', label: 'S&P 500', source: 'polygon', decimals: 1 },
  { sym: 'NDX', label: 'Nasdaq 100', source: 'polygon', decimals: 1 },
  { sym: 'EUR_USD', label: 'EUR/USD', source: 'oanda', decimals: 5 },
  { sym: 'GBP_USD', label: 'GBP/USD', source: 'oanda', decimals: 5 },
  { sym: 'USD_CHF', label: 'USD/CHF', source: 'oanda', decimals: 5 },
  { sym: 'USD_JPY', label: 'USD/JPY', source: 'oanda', decimals: 3 },
  { sym: 'EUR_GBP', label: 'EUR/GBP', source: 'oanda', decimals: 5 },
  { sym: 'EUR_JPY', label: 'EUR/JPY', source: 'oanda', decimals: 3 },
  { sym: 'GBP_JPY', label: 'GBP/JPY', source: 'oanda', decimals: 3 },
  { sym: 'AUD_USD', label: 'AUD/USD', source: 'oanda', decimals: 5 },
  { sym: 'NZD_USD', label: 'NZD/USD', source: 'oanda', decimals: 5 },
  { sym: 'USD_CAD', label: 'USD/CAD', source: 'oanda', decimals: 5 },
]

const PRICE_DECIMALS = { SPX500_USD: 1, NAS100_USD: 1, US30_USD: 1, USD_JPY: 3, EUR_JPY: 3, GBP_JPY: 3 }
const priceDec = (instrument) => PRICE_DECIMALS[instrument] ?? 5

function App() {
  const navigate = useNavigate()
  const location = useLocation()
  const activeTab = location.pathname.replace('/', '') || 'account'

  const [apiBase, setApiBase] = useState(defaultApiBase)
  const [user, setUser] = useState(null)
  const [authError, setAuthError] = useState('')

  const [strategies, setStrategies] = useState(emptyPanel)
  const [balance, setBalance] = useState(emptyPanel)
  const [logs, setLogs] = useState(emptyPanel)
  const [trades, setTrades] = useState(emptyPanel)
  const [positions, setPositions] = useState(emptyPanel)
  const [openingRange, setOpeningRange] = useState(emptyPanel)
  const [candles, setCandles] = useState(emptyPanel)
  const [stats, setStats] = useState(emptyPanel)
  const [newsEvents, setNewsEvents] = useState(emptyPanel)
  const [newsHistory, setNewsHistory] = useState(emptyPanel)

  const [logParams, setLogParams] = useState({ limit: 50, level: '', contains: '', tag: '', trade_id: '' })
  const [logTags, setLogTags] = useState([])
  const [candlesDay, setCandlesDay] = useState(() => new Date().toISOString().slice(0, 10))
  const [instrument, setInstrument] = useState('SPX')
  const [expandedTradeId, setExpandedTradeId] = useState(null)
  const [tradeEvents, setTradeEvents] = useState({ data: null, loading: false })
  const [tradeFilterInstrument, setTradeFilterInstrument] = useState('')
  const [tradeFilterDate, setTradeFilterDate] = useState('')
  const [riskChf, setRiskChf] = useState({ value: 50, saving: false, loaded: false })

  const chartContainerRef = useRef(null)

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

  const loadRisk = async () => {
    try {
      const data = await fetchJson('/api/config/risk')
      setRiskChf((p) => ({ ...p, value: data.risk_chf, loaded: true }))
    } catch {
      // keep default
    }
  }

  const saveRisk = async (val) => {
    const num = Number(val)
    if (!num || num <= 0) return
    setRiskChf((p) => ({ ...p, saving: true }))
    try {
      await fetchJson('/api/config/risk', {
        method: 'PUT',
        body: JSON.stringify({ risk_chf: num }),
      })
      setRiskChf({ value: num, saving: false, loaded: true })
    } catch {
      setRiskChf((p) => ({ ...p, saving: false }))
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

  const loadLogTags = async () => {
    try {
      const data = await fetchJson('/api/logs/tags')
      setLogTags(data)
    } catch {
      // keep empty
    }
  }

  const loadLogs = async () => {
    setLogs((p) => ({ ...p, loading: true, error: null }))
    try {
      const params = new URLSearchParams()
      if (logParams.limit) params.append('limit', logParams.limit)
      if (logParams.level) params.append('level', logParams.level)
      if (logParams.contains) params.append('contains', logParams.contains)
      if (logParams.tag) params.append('tag', logParams.tag)
      if (logParams.trade_id) params.append('trade_id', logParams.trade_id)
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

  const deleteTrade = async (docPath) => {
    if (!docPath || !confirm('Supprimer ce trade et ses évènements ?')) return
    try {
      await fetchJson(`/api/trades?path=${encodeURIComponent(docPath)}`, { method: 'DELETE' })
      setExpandedTradeId(null)
      setTradeEvents({ data: null, loading: false })
      loadTrades()
    } catch (err) {
      alert(`Erreur: ${err.message}`)
    }
  }

  const toggleTradeEvents = async (oandaTradeId, docPath) => {
    if (expandedTradeId === oandaTradeId) {
      setExpandedTradeId(null)
      setTradeEvents({ data: null, loading: false })
      return
    }
    setExpandedTradeId(oandaTradeId)
    setTradeEvents({ data: null, loading: true })
    try {
      const pathParam = docPath ? `?path=${encodeURIComponent(docPath)}` : ''
      const data = await fetchJson(`/api/trades/${oandaTradeId}/events${pathParam}`)
      setTradeEvents({ data, loading: false })
    } catch {
      setTradeEvents({ data: [], loading: false })
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

  const currentInstrument = INSTRUMENTS.find(i => i.sym === instrument) || INSTRUMENTS[0]

  const loadMarketData = (overrideSym) => {
    if (!candlesDay) return
    const sym = overrideSym || instrument
    const instrObj = INSTRUMENTS.find(i => i.sym === sym) || INSTRUMENTS[0]
    setCandles((p) => ({ ...p, loading: true, error: null }))

    if (instrObj.source === 'oanda') {
      fetchJson(`/api/candles/oanda?instrument=${encodeURIComponent(sym)}&day=${encodeURIComponent(candlesDay)}`)
        .then(data => setCandles({ data, loading: false, error: null }))
        .catch(err => setCandles({ data: null, loading: false, error: err.message }))
      setOpeningRange({ data: null, loading: false, error: null })
    } else {
      fetchJson(`/api/candles?day=${encodeURIComponent(candlesDay)}`)
        .then(data => setCandles({ data, loading: false, error: null }))
        .catch(err => setCandles({ data: null, loading: false, error: err.message }))

      setOpeningRange((p) => ({ ...p, loading: true, error: null }))
      fetchJson(`/api/opening_range/${candlesDay}?instrument=${sym}`)
        .then(data => setOpeningRange({ data, loading: false, error: null }))
        .catch(() => setOpeningRange({ data: null, loading: false, error: null }))
    }

    if (!trades.data) loadTrades()
  }

  const loadStats = async () => {
    setStats((p) => ({ ...p, loading: true, error: null }))
    try {
      const data = await fetchJson('/api/trades/stats')
      setStats({ data, loading: false, error: null })
    } catch (err) {
      setStats({ data: null, loading: false, error: err.message })
    }
  }

  const loadNewsEvents = async () => {
    setNewsEvents((p) => ({ ...p, loading: true, error: null }))
    try {
      const data = await fetchJson('/api/news/calendar')
      setNewsEvents({ data, loading: false, error: null })
    } catch (err) {
      setNewsEvents({ data: null, loading: false, error: err.message })
    }
  }

  const loadNewsHistory = async () => {
    setNewsHistory((p) => ({ ...p, loading: true, error: null }))
    try {
      const data = await fetchJson('/api/news/history')
      setNewsHistory({ data, loading: false, error: null })
    } catch (err) {
      setNewsHistory({ data: null, loading: false, error: err.message })
    }
  }

  useEffect(() => {
    loadStrategies()
    loadBalance()
    loadRisk()
    loadLogTags()
  }, [])

  const strategyEntries = strategies.data ? Object.entries(strategies.data) : []

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

  /* ─────────────── CHART (lightweight-charts) ─────────────── */
  useEffect(() => {
    const container = chartContainerRef.current
    if (!container || !Array.isArray(candles.data) || candles.data.length === 0) return

    container.innerHTML = ''

    const dec = currentInstrument.decimals
    const minMove = dec === 5 ? 0.00001 : dec === 3 ? 0.001 : dec === 2 ? 0.01 : 0.1

    // 1. Create chart (dark theme)
    const chart = createChart(container, {
      width: container.clientWidth,
      height: 420,
      layout: { background: { type: 'solid', color: '#131722' }, textColor: '#d1d4dc', fontSize: 12 },
      grid: { vertLines: { color: '#1e222d' }, horzLines: { color: '#1e222d' } },
      timeScale: { timeVisible: true, secondsVisible: false, borderColor: '#2a2e39', rightOffset: 5, minBarSpacing: 2 },
      rightPriceScale: { borderColor: '#2a2e39' },
      crosshair: {
        mode: 0,
        vertLine: { width: 1, color: '#758696', style: 3, labelBackgroundColor: '#2a2e39' },
        horzLine: { width: 1, color: '#758696', style: 3, labelBackgroundColor: '#2a2e39' },
      },
    })

    // 2. Create legend overlay
    const legend = document.createElement('div')
    legend.className = 'chart-legend'
    legend.innerHTML = `
      <div class="chart-legend-title">${currentInstrument.label}  M5</div>
      <div class="chart-legend-ohlc">
        <span>O <span class="val">-</span></span>
        <span>H <span class="val">-</span></span>
        <span>L <span class="val">-</span></span>
        <span>C <span class="val">-</span></span>
        <span class="chart-legend-change"></span>
      </div>
    `
    container.appendChild(legend)

    // 3. Add candlestick series with priceFormat
    const series = chart.addSeries(CandlestickSeries, {
      upColor: '#26a69a', downColor: '#ef5350',
      borderUpColor: '#26a69a', borderDownColor: '#ef5350',
      wickUpColor: '#26a69a', wickDownColor: '#ef5350',
      priceFormat: { type: 'price', precision: dec, minMove },
    })

    const isOanda = currentInstrument.source === 'oanda'
    const sym = `I:${instrument}`
    const data = candles.data
      .filter(c => isOanda || !c.sym || c.sym === sym)
      .map(c => ({
        time: isOanda
          ? Math.floor(Date.parse(c.time) / 1000)
          : Math.floor((c.s || 0) / 1000),
        open: c.o ?? c.open,
        high: c.h ?? c.high,
        low: c.l ?? c.low,
        close: c.c ?? c.close,
      }))
      .filter(d => d.open != null && d.time > 0)
      .sort((a, b) => a.time - b.time)

    if (data.length === 0) { chart.remove(); legend.remove(); return }

    // 4. Set data
    series.setData(data)

    // 5. Watermark
    try {
      const pane = chart.panes()[0]
      createTextWatermark(pane, {
        horzAlign: 'center',
        vertAlign: 'center',
        lines: [{ text: currentInstrument.label, color: 'rgba(255,255,255,0.06)', fontSize: 48, fontStyle: 'bold' }],
      })
    } catch { /* watermark is optional */ }

    // 6. Opening range lines
    const orData = openingRange.data
    if (orData) {
      series.createPriceLine({ price: Number(orData.high), color: '#26a69a', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: 'OR High' })
      series.createPriceLine({ price: Number(orData.low), color: '#ef5350', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: 'OR Low' })
    }

    // Trade overlays
    if (Array.isArray(trades.data)) {
      const dayTrades = trades.data
        .filter(t => t.timestamp?.startsWith(candlesDay))
        .filter(t => {
          if (!t.instrument) return false
          if (isOanda) return t.instrument === instrument
          const map = { SPX: 'SPX500_USD', NDX: 'NAS100_USD' }
          return t.instrument === (map[instrument] || instrument)
        })
      const candleTimes = data.map(d => d.time)

      if (dayTrades.length > 0 && candleTimes.length > 0) {
        const snapToCandle = (ts) => {
          const best = candleTimes.reduce((prev, curr) => Math.abs(curr - ts) < Math.abs(prev - ts) ? curr : prev)
          return Math.abs(best - ts) <= 300 ? best : null // max 5min (M5)
        }

        const markers = dayTrades
          .map(t => {
            const snapped = snapToCandle(Math.floor(new Date(t.timestamp).getTime() / 1000))
            if (!snapped) return null
            return {
              time: snapped,
              position: t.direction === 'LONG' ? 'belowBar' : 'aboveBar',
              color: t.direction === 'LONG' ? '#26a69a' : '#ef5350',
              shape: t.direction === 'LONG' ? 'arrowUp' : 'arrowDown',
              text: `${t.direction} @ ${Number(t.fill_price || t.entry).toFixed(dec)}`,
            }
          })
          .filter(Boolean)
          .sort((a, b) => a.time - b.time)

        createSeriesMarkers(series, markers)

        dayTrades.forEach(t => {
          if (t.fill_price != null)
            series.createPriceLine({ price: Number(t.fill_price), color: '#2962ff', lineWidth: 1, lineStyle: 0, axisLabelVisible: true, title: 'Entry' })
          if (t.sl != null)
            series.createPriceLine({ price: Number(t.sl), color: '#ef5350', lineWidth: 1, lineStyle: 1, axisLabelVisible: true, title: 'SL' })
          if (t.tp != null)
            series.createPriceLine({ price: Number(t.tp), color: '#26a69a', lineWidth: 1, lineStyle: 1, axisLabelVisible: true, title: 'TP' })
        })
      }
    }

    // 7. Crosshair legend update
    const updateLegend = (param) => {
      let bar
      if (param && param.seriesData) {
        bar = param.seriesData.get(series)
      }
      if (!bar) bar = data[data.length - 1]
      if (!bar) return

      const isUp = bar.close >= bar.open
      const cls = isUp ? 'up' : 'down'
      const spans = legend.querySelectorAll('.chart-legend-ohlc .val')
      if (spans.length >= 4) {
        spans[0].textContent = bar.open.toFixed(dec)
        spans[0].className = `val ${cls}`
        spans[1].textContent = bar.high.toFixed(dec)
        spans[1].className = `val ${cls}`
        spans[2].textContent = bar.low.toFixed(dec)
        spans[2].className = `val ${cls}`
        spans[3].textContent = bar.close.toFixed(dec)
        spans[3].className = `val ${cls}`
      }
      const changeEl = legend.querySelector('.chart-legend-change')
      if (changeEl && data.length > 1) {
        const idx = param?.seriesData?.get(series) ? data.findIndex(d => d.time === bar.time) : data.length - 1
        const prevClose = idx > 0 ? data[idx - 1].close : bar.open
        const pct = ((bar.close - prevClose) / prevClose * 100).toFixed(2)
        const sign = pct >= 0 ? '+' : ''
        changeEl.textContent = `${sign}${pct}%`
        changeEl.className = `chart-legend-change ${pct >= 0 ? 'up' : 'down'}`
      }
    }

    chart.subscribeCrosshairMove(updateLegend)

    // 8. Initialize legend with last candle
    updateLegend(null)

    // 9. Fit content
    chart.timeScale().fitContent()

    const ro = new ResizeObserver(entries => {
      if (entries[0]) chart.applyOptions({ width: entries[0].contentRect.width })
    })
    ro.observe(container)

    // 10. Cleanup
    return () => { ro.disconnect(); chart.remove(); legend.remove() }
  }, [activeTab, candles.data, openingRange.data, trades.data, candlesDay, instrument])

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
            {balance.loading ? 'Chargement...' : 'Rafraîchir'}
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
              <span className="stat-value">{balance.data.message || 'Connecté'}</span>
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
  const oandaToSym = (oandaInstr) => {
    const map = { SPX500_USD: 'SPX', NAS100_USD: 'NDX' }
    return map[oandaInstr] || oandaInstr
  }

  const handlePositionClick = (oandaInstr) => {
    const sym = oandaToSym(oandaInstr)
    if (INSTRUMENTS.find(i => i.sym === sym)) {
      setInstrument(sym)
      loadMarketData(sym)
    }
  }

  const renderPositions = () => {
    const posData = positions.data || {}
    const openTrades = posData.trades || []
    const openPositions = posData.positions || []

    const totalPnL = openTrades.reduce((sum, t) => sum + parseFloat(t.unrealizedPL || 0), 0)

    const orData = openingRange.data
    const isOandaInstr = currentInstrument.source === 'oanda'
    const dec = currentInstrument.decimals
    const dayTrades = Array.isArray(trades.data)
      ? trades.data
          .filter(t => t.timestamp?.startsWith(candlesDay))
          .filter(t => {
            if (!t.instrument) return false
            if (isOandaInstr) return t.instrument === instrument
            const map = { SPX: 'SPX500_USD', NDX: 'NAS100_USD' }
            return t.instrument === (map[instrument] || instrument)
          })
      : []

    return (
      <>
        <section className="card">
          <div className="card-header">
            <div>
              <p className="eyebrow">Positions ouvertes</p>
              <h2>En cours {openTrades.length > 0 && <span className="count-badge">{openTrades.length}</span>}</h2>
            </div>
            <button className="btn-secondary" onClick={loadPositions} disabled={positions.loading}>
              {positions.loading ? 'Chargement...' : 'Rafraîchir'}
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
                    <div key={t.id} className="pos-card" onClick={() => handlePositionClick(t.instrument)} style={{ cursor: 'pointer' }}>
                      <div className="pos-card-header">
                        <span className="pos-instrument">{t.instrument}</span>
                        <span className={`pill-dir ${dir === 'LONG' ? 'long' : 'short'}`}>{dir}</span>
                      </div>
                      <div className="pos-card-body">
                        <div className="pos-row">
                          <span className="pos-label">Prix d'entrée</span>
                          <span className="pos-value">{parseFloat(t.price).toFixed(priceDec(t.instrument))}</span>
                        </div>
                        <div className="pos-row">
                          <span className="pos-label">Units</span>
                          <span className="pos-value">{Math.abs(units).toFixed(1)}</span>
                        </div>
                        {t.stopLossOrder && (
                          <div className="pos-row">
                            <span className="pos-label">Stop Loss</span>
                            <span className="pos-value sl">{parseFloat(t.stopLossOrder.price).toFixed(priceDec(t.instrument))}</span>
                          </div>
                        )}
                        {t.takeProfitOrder && (
                          <div className="pos-row">
                            <span className="pos-label">Take Profit</span>
                            <span className="pos-value tp">{parseFloat(t.takeProfitOrder.price).toFixed(priceDec(t.instrument))}</span>
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
              <p className="eyebrow">Données de marché</p>
              <h2>Graphique intraday</h2>
            </div>
          </div>

          <div className="market-controls">
            <div className="control-group">
              <label>Instrument</label>
              <select value={instrument} onChange={(e) => setInstrument(e.target.value)}>
                {INSTRUMENTS.map(i => (
                  <option key={i.sym} value={i.sym}>{i.label} ({i.sym})</option>
                ))}
              </select>
            </div>
            <div className="control-group">
              <label>Date</label>
              <div className="input-row">
                <input type="date" value={candlesDay} onChange={(e) => setCandlesDay(e.target.value)} />
                <button className="btn-secondary" onClick={loadMarketData} disabled={candles.loading}>
                  {candles.loading ? '...' : 'Charger'}
                </button>
              </div>
            </div>
          </div>

          {!isOandaInstr && orData && (
            <div className="or-cards">
              <div className="or-card">
                <span className="or-label">High</span>
                <span className="or-value">{Number(orData.high).toFixed(dec)}</span>
              </div>
              <div className="or-card">
                <span className="or-label">Low</span>
                <span className="or-value">{Number(orData.low).toFixed(dec)}</span>
              </div>
              {orData.range_size != null && (
                <div className="or-card">
                  <span className="or-label">Range</span>
                  <span className="or-value">{Number(orData.range_size).toFixed(dec)}</span>
                </div>
              )}
              <div className="or-card">
                <span className="or-label">Status</span>
                <span className={`pill ${orData.status === 'ready' ? 'on' : 'off'}`}>{orData.status || '-'}</span>
              </div>
            </div>
          )}

          {dayTrades.length > 0 && (
            <div className="day-trades-summary">
              {dayTrades.map((t, i) => (
                <div key={i} className="day-trade-chip">
                  <span className={`pill-dir ${t.direction === 'LONG' ? 'long' : 'short'}`}>{t.direction}</span>
                  <span>Entry {Number(t.fill_price || t.entry).toFixed(dec)}</span>
                  <span className="muted">SL {Number(t.sl).toFixed(dec)}</span>
                  <span className="muted">TP {Number(t.tp).toFixed(dec)}</span>
                  <span className={`pill-outcome ${t.outcome}`}>{t.outcome}</span>
                </div>
              ))}
            </div>
          )}

          {candles.error && <p className="error">{candles.error}</p>}
          <div className="chart-card">
            <div ref={chartContainerRef} />
            {(!Array.isArray(candles.data) || candles.data.length === 0) && !candles.loading && (
              <div className="empty-state"><p>Charger des bougies pour afficher le graphique</p></div>
            )}
          </div>
        </section>

        <section className="card">
          <div className="card-header">
            <div>
              <p className="eyebrow">Historique</p>
              <h2>Trades passés</h2>
            </div>
            <button className="btn-secondary" onClick={loadTrades} disabled={trades.loading}>
              {trades.loading ? 'Chargement...' : 'Charger'}
            </button>
          </div>
          {Array.isArray(trades.data) && trades.data.length > 0 && (() => {
            const allInstruments = [...new Set(trades.data.map(t => t.instrument).filter(Boolean))].sort()
            const filteredTrades = trades.data.filter(t => {
              if (tradeFilterInstrument && t.instrument !== tradeFilterInstrument) return false
              if (tradeFilterDate && t.date !== tradeFilterDate) return false
              return true
            })
            return (
              <>
                <div className="trade-filters">
                  <select value={tradeFilterInstrument} onChange={e => setTradeFilterInstrument(e.target.value)}>
                    <option value="">Tous les instruments</option>
                    {allInstruments.map(inst => (
                      <option key={inst} value={inst}>{inst.replace('_', '/')}</option>
                    ))}
                  </select>
                  <input type="date" value={tradeFilterDate} onChange={e => setTradeFilterDate(e.target.value)} />
                  {(tradeFilterInstrument || tradeFilterDate) && (
                    <button className="btn-secondary" onClick={() => { setTradeFilterInstrument(''); setTradeFilterDate('') }}>Reset</button>
                  )}
                  <span className="muted" style={{ fontSize: '0.78rem' }}>{filteredTrades.length} / {trades.data.length}</span>
                </div>
              </>
            )
          })()}
          {trades.error && <p className="error">{trades.error}</p>}
          {Array.isArray(trades.data) && trades.data.length > 0 && (() => {
            const filteredTrades = trades.data.filter(t => {
              if (tradeFilterInstrument && t.instrument !== tradeFilterInstrument) return false
              if (tradeFilterDate && t.date !== tradeFilterDate) return false
              return true
            })
            return filteredTrades.length > 0 ? (
            <div className="table-wrap">
              <div className="trade-table">
                <div className="trade-header-row">
                  <span>Date</span>
                  <span>Stratégie</span>
                  <span>Instrument</span>
                  <span>Direction</span>
                  <span>Entry</span>
                  <span>SL</span>
                  <span>TP</span>
                  <span>Units</span>
                  <span>Fill</span>
                  <span>Scaling</span>
                  <span>Outcome</span>
                  <span>PnL</span>
                  <span>ID</span>
                </div>
                {filteredTrades.map((t) => {
                  const isRejected = t.outcome === 'rejected'
                  const expandKey = t.oanda_trade_id || t.id
                  const isExpanded = expandedTradeId === expandKey
                  return (
                    <div key={t.id} className="trade-row-group">
                      <div
                        className={`trade-row-clickable ${isExpanded ? 'expanded' : ''} ${isRejected ? 'rejected-row' : ''}`}
                        onClick={() => {
                          if (isRejected) {
                            setExpandedTradeId(isExpanded ? null : expandKey)
                            setTradeEvents({ data: null, loading: false })
                          } else if (t.oanda_trade_id) {
                            toggleTradeEvents(t.oanda_trade_id, t.doc_path)
                          }
                        }}
                      >
                        <span className="cell-date">{t.timestamp ? new Date(t.timestamp).toLocaleString('fr-CH', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-'}</span>
                        <span><span className="pill-strat">{t.strategy}</span></span>
                        <span className="cell-instrument">{t.instrument?.replace('_', '/') || '-'}</span>
                        <span><span className={`pill-dir ${t.direction === 'LONG' ? 'long' : 'short'}`}>{t.direction}</span></span>
                        <span>{!isRejected && t.entry != null ? Number(t.entry).toFixed(priceDec(t.instrument)) : '-'}</span>
                        <span>{!isRejected && t.sl != null ? Number(t.sl).toFixed(priceDec(t.instrument)) : '-'}</span>
                        <span>{!isRejected && t.tp != null ? Number(t.tp).toFixed(priceDec(t.instrument)) : '-'}</span>
                        <span>{!isRejected && t.units != null ? Number(t.units).toFixed(1) : '-'}</span>
                        <span>{!isRejected && t.fill_price != null ? Number(t.fill_price).toFixed(priceDec(t.instrument)) : '-'}</span>
                        <span>
                          {isRejected ? '-' : t.scaling_step != null ? (
                            <span className={`pill-scaling step-${t.scaling_step}`}>
                              {t.scaling_step === 0 ? '100%' : t.scaling_step === 1 ? 'TP1 50%' : 'TP2 25%'}
                            </span>
                          ) : t.breakeven_applied ? 'BE' : '-'}
                        </span>
                        <span><span className={`pill-outcome ${t.outcome}`}>{t.outcome || 'unknown'}</span></span>
                        <span className={`cell-pnl ${t.realized_pnl > 0 ? 'positive' : t.realized_pnl < 0 ? 'negative' : ''}`}>
                          {t.realized_pnl != null ? `${t.realized_pnl > 0 ? '+' : ''}${Number(t.realized_pnl).toFixed(2)}` : '-'}
                        </span>
                        <span className="cell-id">{t.oanda_trade_id || '-'}</span>
                      </div>
                      {isExpanded && isRejected && (
                        <div className="trade-events-panel">
                          <div className="trade-actions">
                            <button
                              className="btn-danger-sm"
                              onClick={(e) => { e.stopPropagation(); deleteTrade(t.doc_path) }}
                            >
                              Supprimer
                            </button>
                          </div>
                          <div className="rejection-detail">
                            {t.rejection_type === 'news' ? (
                              <>
                                <div className="rejection-header">
                                  <span className="pill-outcome rejected">News block</span>
                                </div>
                                {t.news_check?.nearby_events?.length > 0 && (
                                  <div className="rejection-reasons">
                                    <span className="rejection-reasons-label">Events proches:</span>
                                    {t.news_check.nearby_events.map((e, i) => (
                                      <span key={i} className="rejection-reason-chip">
                                        {e.title} ({e.country}) {e.minutes_away > 0 ? `dans ${Math.round(e.minutes_away)}min` : `il y a ${Math.round(Math.abs(e.minutes_away))}min`}
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </>
                            ) : (
                              <>
                                <div className="rejection-header">
                                  <span className={`pill-dir ${t.gpt_bias === 'BULLISH' ? 'long' : t.gpt_bias === 'BEARISH' ? 'short' : ''}`}>
                                    GPT: {t.gpt_bias}
                                  </span>
                                  {t.gpt_confidence != null && (
                                    <span className="rejection-confidence">Confiance: {t.gpt_confidence}%</span>
                                  )}
                                </div>
                                {t.gpt_analysis && <p className="rejection-analysis">{t.gpt_analysis}</p>}
                              </>
                            )}
                            {Array.isArray(t.ichimoku_reasons) && t.ichimoku_reasons.length > 0 && (
                              <div className="rejection-reasons">
                                <span className="rejection-reasons-label">Ichimoku:</span>
                                {t.ichimoku_reasons.map((r, i) => (
                                  <span key={i} className="rejection-reason-chip">{r}</span>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                      {isExpanded && !isRejected && (
                        <div className="trade-events-panel">
                          <div className="trade-actions">
                            <button
                              className="btn-danger-sm"
                              onClick={(e) => { e.stopPropagation(); deleteTrade(t.doc_path) }}
                            >
                              Supprimer ce trade
                            </button>
                          </div>
                          {(t.gpt_macro_bias || t.gpt_bias || t.news_check) && (
                            <div className="rejection-detail">
                              {t.news_check && (
                                <div className="rejection-reasons" style={{ marginBottom: 6 }}>
                                  <span className="rejection-reasons-label">News check:</span>
                                  {t.news_check.nearby_events?.length > 0
                                    ? t.news_check.nearby_events.map((e, i) => (
                                        <span key={i} className="rejection-reason-chip">
                                          {e.title} ({e.country}) {e.minutes_away > 0 ? `dans ${Math.round(e.minutes_away)}min` : `il y a ${Math.round(Math.abs(e.minutes_away))}min`}
                                        </span>
                                      ))
                                    : <span className="rejection-reason-chip">Aucune news proche</span>
                                  }
                                </div>
                              )}
                              {(t.gpt_macro_bias || t.gpt_bias) && (
                                <>
                                  <div className="rejection-header">
                                    <span className={`pill-dir ${(t.gpt_macro_bias || t.gpt_bias) === 'BULLISH' ? 'long' : (t.gpt_macro_bias || t.gpt_bias) === 'BEARISH' ? 'short' : ''}`}>
                                      GPT: {t.gpt_macro_bias || t.gpt_bias}
                                    </span>
                                    {(t.gpt_macro_confidence ?? t.gpt_confidence) != null && (
                                      <span className="rejection-confidence">Confiance: {t.gpt_macro_confidence ?? t.gpt_confidence}%</span>
                                    )}
                                  </div>
                                  {(t.gpt_macro_analysis || t.gpt_analysis) && <p className="rejection-analysis">{t.gpt_macro_analysis || t.gpt_analysis}</p>}
                                </>
                              )}
                              {Array.isArray(t.ichimoku_reasons) && t.ichimoku_reasons.length > 0 && (
                                <div className="rejection-reasons">
                                  <span className="rejection-reasons-label">Ichimoku:</span>
                                  {t.ichimoku_reasons.map((r, i) => (
                                    <span key={i} className="rejection-reason-chip">{r}</span>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                          {tradeEvents.loading && <p className="events-loading">Chargement...</p>}
                          {!tradeEvents.loading && tradeEvents.data && tradeEvents.data.length === 0 && (
                            <p className="events-empty">Aucun évènement</p>
                          )}
                          {!tradeEvents.loading && tradeEvents.data && tradeEvents.data.length > 0 && (
                            <div className="events-timeline">
                              {tradeEvents.data.map((ev, idx) => (
                                <div key={idx} className={`event-item event-${(ev.type || '').toLowerCase()}`}>
                                  <div className="event-dot" />
                                  <div className="event-content">
                                    <div className="event-header">
                                      <span className={`event-type-pill ${(ev.type || '').toLowerCase()}`}>{ev.type}</span>
                                      <span className="event-time">
                                        {ev.timestamp ? new Date(ev.timestamp).toLocaleString('fr-CH', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : ''}
                                      </span>
                                    </div>
                                    <p className="event-message">{ev.message}</p>
                                    {ev.data && (
                                      <div className="event-data">
                                        {Object.entries(ev.data).map(([k, v]) => (
                                          <span key={k} className="event-data-item">
                                            <span className="event-data-key">{k}</span> {String(v)}
                                          </span>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
            ) : (
              <div className="empty-state"><p>Aucun trade pour ces filtres</p></div>
            )
          })()}
          {Array.isArray(trades.data) && trades.data.length === 0 && (
            <div className="empty-state"><p>Aucun trade enregistré</p></div>
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
          <h2>Stratégies actives</h2>
        </div>
        <button className="btn-secondary" onClick={loadStrategies} disabled={strategies.loading}>
          {strategies.loading ? 'Chargement...' : 'Rafraîchir'}
        </button>
      </div>
      {strategies.error && <p className="error">{strategies.error}</p>}
      {strategyEntries.length === 0 && !strategies.loading && (
        <div className="empty-state"><p>Aucune stratégie configurée</p></div>
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
                {enabled ? 'Désactiver' : 'Activer'}
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="risk-config">
        <p className="eyebrow">Risque par trade</p>
        <div className="risk-row">
          <input
            type="number"
            min={1}
            max={500}
            value={riskChf.value}
            onChange={(e) => setRiskChf((p) => ({ ...p, value: Number(e.target.value) }))}
          />
          <span className="risk-unit">CHF</span>
          <button
            className="btn-secondary"
            onClick={() => saveRisk(riskChf.value)}
            disabled={riskChf.saving}
          >
            {riskChf.saving ? '...' : 'Sauvegarder'}
          </button>
        </div>
      </div>
    </section>
  )

  /* ─────────────── NEWS CALENDAR ─────────────── */
  const renderNews = () => {
    const events = newsEvents.data?.events || []

    // Group events by day
    const grouped = {}
    events.forEach((ev) => {
      const day = ev.datetime_utc.slice(0, 10)
      if (!grouped[day]) grouped[day] = []
      grouped[day].push(ev)
    })
    const days = Object.keys(grouped).sort()

    const formatTime = (iso) =>
      new Date(iso).toLocaleString('fr-CH', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Zurich' })

    const formatDay = (dateStr) => {
      const d = new Date(dateStr + 'T12:00:00Z')
      return d.toLocaleDateString('fr-CH', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Zurich' })
    }

    const impactClass = (impact) => {
      if (impact === 'High') return 'high'
      if (impact === 'Medium') return 'medium'
      return 'low'
    }

    const history = newsHistory.data?.events || []

    return (
      <>
        <section className="card">
          <div className="card-header">
            <div>
              <p className="eyebrow">News Trading</p>
              <h2>Évènements à venir</h2>
            </div>
            <button className="btn-secondary" onClick={loadNewsEvents} disabled={newsEvents.loading}>
              {newsEvents.loading ? 'Chargement...' : 'Rafraîchir'}
            </button>
          </div>

          {newsEvents.error && <p className="error">{newsEvents.error}</p>}

          {days.length > 0 && days.map((day) => (
            <div key={day} className="news-day-group">
              <div className="news-day-header">{formatDay(day)}</div>
              <div className="news-event-list">
                {grouped[day].map((ev, idx) => (
                  <div key={idx} className={`news-event-row ${ev.scheduled ? 'news-scheduled' : ''}`}>
                    <div className="news-event-time">{formatTime(ev.datetime_utc)}</div>
                    <div className={`news-impact-dot impact-${impactClass(ev.impact)}`} />
                    <div className="news-event-body">
                      <div className="news-event-title-row">
                        <span className="news-country-pill">{ev.country}</span>
                        <span className="news-event-title">{ev.title}</span>
                        {ev.scheduled && <span className="news-scheduled-pill">Planifié</span>}
                      </div>
                      <div className="news-event-details">
                        {ev.forecast && <span>Prév: <strong>{ev.forecast}</strong></span>}
                        {ev.previous && <span>Préc: <strong>{ev.previous}</strong></span>}
                        {ev.instruments.length > 0 && (
                          <span className="news-instruments">
                            {ev.instruments.map((instr) => (
                              <span key={instr} className="news-instrument-chip">{instr.replace('_', '/')}</span>
                            ))}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}

          {!newsEvents.loading && events.length === 0 && !newsEvents.error && (
            <div className="empty-state"><p>Cliquer sur Rafraîchir pour charger le calendrier</p></div>
          )}
        </section>

        <section className="card">
          <div className="card-header">
            <div>
              <p className="eyebrow">Historique</p>
              <h2>Décisions passées</h2>
            </div>
            <button className="btn-secondary" onClick={loadNewsHistory} disabled={newsHistory.loading}>
              {newsHistory.loading ? 'Chargement...' : 'Charger'}
            </button>
          </div>

          {newsHistory.error && <p className="error">{newsHistory.error}</p>}

          {history.length > 0 && (
            <div className="news-history-list">
              {history.map((ev) => {
                const isTrade = ev.decision_action === 'TRADE'
                return (
                  <div key={ev.id} className={`news-history-item ${isTrade ? 'traded' : 'skipped'}`}>
                    <div className="news-history-header">
                      <span className="cell-date">
                        {ev.timestamp ? new Date(ev.timestamp).toLocaleString('fr-CH', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-'}
                      </span>
                      <span className="news-instrument-chip">{ev.instrument?.replace('_', '/')}</span>
                      <span className={`pill-outcome ${isTrade ? 'win' : 'rejected'}`}>
                        {ev.decision_action || ev.phase || '...'}
                      </span>
                    </div>
                    <div className="news-history-titles">
                      {(ev.event_titles || []).map((title, i) => (
                        <span key={i} className="news-history-title">{title}</span>
                      ))}
                    </div>
                    {ev.decision_reason && (
                      <p className="news-history-reason">{ev.decision_reason}</p>
                    )}
                    {ev.surprises && ev.surprises.length > 0 && (
                      <div className="news-history-surprises">
                        {ev.surprises.map((s, i) => (
                          <span key={i} className={`news-surprise-chip ${s.direction === 'ABOVE' ? 'above' : s.direction === 'BELOW' ? 'below' : ''}`}>
                            {s.title}: {s.direction} ({s.magnitude}{s.pct_deviation != null ? `, ${s.pct_deviation.toFixed(1)}%` : ''})
                          </span>
                        ))}
                      </div>
                    )}
                    {ev.gpt_analysis && (
                      <details className="news-history-gpt">
                        <summary>
                          GPT: {ev.gpt_bias} (confiance {ev.gpt_confidence}%)
                        </summary>
                        <p>{ev.gpt_analysis}</p>
                      </details>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {!newsHistory.loading && history.length === 0 && !newsHistory.error && (
            <div className="empty-state"><p>Cliquer sur Charger pour voir les décisions passées</p></div>
          )}
        </section>
      </>
    )
  }

  /* ─────────────── LOGS ─────────────── */
  const renderLogs = () => {
    return (
      <section className="card">
        <div className="card-header">
          <div>
            <p className="eyebrow">Système</p>
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
          {logTags.length > 0 && (
            <div className="control-group">
              <label>Stratégie / Service</label>
              <div className="level-chips">
                <button
                  className={`chip ${logParams.tag === '' ? 'active' : ''}`}
                  onClick={() => setLogParams((p) => ({ ...p, tag: '' }))}
                >
                  Tous
                </button>
                {logTags.map((t) => (
                  <button
                    key={t}
                    className={`chip ${logParams.tag === t ? 'active' : ''}`}
                    onClick={() => setLogParams((p) => ({ ...p, tag: t }))}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="control-group">
            <label>Trade ID (OANDA)</label>
            <input
              value={logParams.trade_id}
              placeholder="Ex: 12345"
              onChange={(e) => setLogParams((p) => ({ ...p, trade_id: e.target.value }))}
            />
          </div>
          <div className="control-group">
            <label>Recherche</label>
            <input
              value={logParams.contains}
              placeholder="Mot-clé..."
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
                    {log.tag && <span className="pill-strat log-tag">{log.tag}</span>}
                    <span className="log-time">{log.timestamp ? new Date(log.timestamp).toLocaleString('fr-CH', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : ''}</span>
                  </div>
                  <p className="log-msg">{log.message || JSON.stringify(log)}</p>
                </div>
              )
            })}
          </div>
        )}
        {Array.isArray(logs.data) && logs.data.length === 0 && (
          <div className="empty-state"><p>Aucun log trouvé</p></div>
        )}
      </section>
    )
  }

  /* ─────────────── STATS ─────────────── */
  const renderStats = () => {
    const d = stats.data
    const strats = d ? Object.entries(d.strategies) : []

    return (
      <section className="card">
        <div className="card-header">
          <div>
            <p className="eyebrow">Performance</p>
            <h2>Stats par stratégie</h2>
          </div>
          <button className="btn-secondary" onClick={loadStats} disabled={stats.loading}>
            {stats.loading ? 'Chargement...' : 'Rafraîchir'}
          </button>
        </div>

        {stats.error && <p className="error">{stats.error}</p>}

        {d && (
          <>
            <div className="stats-global">
              <p className="eyebrow">PnL global réalisé</p>
              <p className={`stats-global-value ${d.global_pnl >= 0 ? 'positive' : 'negative'}`}>
                {d.global_pnl >= 0 ? '+' : ''}{d.global_pnl.toFixed(2)} CHF
              </p>
            </div>

            <div className="stats-grid">
              {strats.map(([name, s]) => {
                const cumData = (s.pnl_history || []).reduce((acc, item, i) => {
                  const prev = i > 0 ? acc[i - 1].cumul : 0
                  acc.push({ date: item.date, cumul: Math.round((prev + item.pnl) * 100) / 100 })
                  return acc
                }, [])

                return (
                  <div key={name} className="stat-strategy-card">
                    <div className="stat-strategy-header">
                      <span className="pill-strat">{name}</span>
                      <span className={`stat-strategy-pnl ${s.total_pnl >= 0 ? 'positive' : 'negative'}`}>
                        {s.total_pnl >= 0 ? '+' : ''}{s.total_pnl.toFixed(2)}
                      </span>
                    </div>

                    <div className="win-rate-section">
                      <div className="stat-row">
                        <span className="stat-row-label">Win rate</span>
                        <span className="stat-row-value">{s.win_rate}%</span>
                      </div>
                      <div className="win-rate-bar">
                        <div className="win-rate-fill" style={{ width: `${s.win_rate}%` }} />
                      </div>
                    </div>

                    <div className="stat-row">
                      <span className="stat-row-label">Trades</span>
                      <span className="stat-row-value">{s.closed_trades} clos ({s.wins}W / {s.losses}L / {s.breakevens}BE) + {s.open_trades} open</span>
                    </div>
                    <div className="stat-row">
                      <span className="stat-row-label">Avg win / loss</span>
                      <span className="stat-row-value">
                        <span className="positive">{s.avg_win > 0 ? '+' : ''}{s.avg_win.toFixed(2)}</span>
                        {' / '}
                        <span className="negative">{s.avg_loss.toFixed(2)}</span>
                      </span>
                    </div>
                    <div className="stat-row">
                      <span className="stat-row-label">Best / Worst</span>
                      <span className="stat-row-value">
                        <span className="positive">{s.best_trade > 0 ? '+' : ''}{s.best_trade.toFixed(2)}</span>
                        {' / '}
                        <span className="negative">{s.worst_trade.toFixed(2)}</span>
                      </span>
                    </div>
                    <div className="stat-row">
                      <span className="stat-row-label">Profit factor</span>
                      <span className="stat-row-value">{s.profit_factor != null ? s.profit_factor.toFixed(2) : '-'}</span>
                    </div>

                    {cumData.length > 1 && (
                      <div className="sparkline-container">
                        <ResponsiveContainer width="100%" height={60}>
                          <LineChart data={cumData}>
                            <Line
                              type="monotone"
                              dataKey="cumul"
                              stroke={cumData[cumData.length - 1].cumul >= 0 ? '#16a34a' : '#dc2626'}
                              strokeWidth={1.5}
                              dot={false}
                            />
                            <Tooltip
                              contentStyle={{ fontSize: '0.72rem', padding: '0.25rem 0.5rem', borderRadius: '6px' }}
                              formatter={(v) => [`${v.toFixed(2)} CHF`, 'PnL']}
                              labelFormatter={(l) => l || ''}
                            />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </>
        )}

        {!stats.loading && !d && !stats.error && (
          <div className="empty-state"><p>Cliquer sur Rafraîchir pour charger les stats</p></div>
        )}
      </section>
    )
  }

  const renderTabContent = () => (
    <Routes>
      <Route path="/account" element={renderAccount()} />
      <Route path="/positions" element={renderPositions()} />
      <Route path="/strategies" element={renderStrategies()} />
      <Route path="/news" element={renderNews()} />
      <Route path="/logs" element={renderLogs()} />
      <Route path="/stats" element={renderStats()} />
      <Route path="*" element={<Navigate to="/account" replace />} />
    </Routes>
  )

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
              <button className="btn-ghost" onClick={() => signOut(auth)}>Déconnexion</button>
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
            <p className="muted">Accès restreint.</p>
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
                onClick={() => navigate(`/${tab.key}`)}
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
