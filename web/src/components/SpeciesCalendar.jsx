import { useMemo } from 'react'
import { SPECIES, groupByColorClass } from '../lib/species.js'
import { COLOR_CLASSES, COLOR_CLASS_ORDER } from '../lib/colorClasses.js'
import { isSpeciesActive, getBloomStatus } from '../lib/phenology.js'

// Year-agnostic position math: Apr 1 → 0%, Oct 31 → 100%.
const DAYS_BEFORE_MONTH = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334]
const SEASON_START_DAY = 91   // Apr 1
const SEASON_END_DAY   = 304  // Oct 31
const SEASON_SPAN      = SEASON_END_DAY - SEASON_START_DAY

function dayOfYear(mmdd) {
  const [m, d] = mmdd.split('-').map(Number)
  return DAYS_BEFORE_MONTH[m - 1] + d
}

function positionPct(mmdd) {
  return Math.max(0, Math.min(100, ((dayOfYear(mmdd) - SEASON_START_DAY) / SEASON_SPAN) * 100))
}

function dateToMonthDay(date) {
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${m}-${d}`
}

const MONTHS = [
  { label: 'Apr', start: '04-01' },
  { label: 'May', start: '05-01' },
  { label: 'Jun', start: '06-01' },
  { label: 'Jul', start: '07-01' },
  { label: 'Aug', start: '08-01' },
  { label: 'Sep', start: '09-01' },
  { label: 'Oct', start: '10-01' },
]

export default function SpeciesCalendar({ photoDate, onSelectSpecies }) {
  const today = photoDate || new Date()
  const todayMd = dateToMonthDay(today)
  const todayInSeason = todayMd >= '04-01' && todayMd <= '10-31'
  const todayPct = todayInSeason ? positionPct(todayMd) : null

  const groups = useMemo(() => groupByColorClass(SPECIES), [])

  return (
    <div className="calendar-panel">
      <div className="calendar-intro">
        <h2>Bloom Calendar — Edmonton</h2>
        <p className="muted small">
          Year-agnostic bloom / identifiability windows from the City of Edmonton Species Calendar.
          Bars show when each species is in flower and detectable from a drone.
          The vertical line marks {photoDate ? 'the date of the loaded photo' : "today's date"}.
          Click any species to inspect its detection notes.
        </p>
        <p className="muted small">
          <strong>Reading the chart:</strong> bars are coloured by their detection colour class
          (the same colour the bbox uses in scan results). A species with multiple bars (e.g.
          Common Barberry) has more than one identifiability window — spring flowers, summer
          flowers, fall berries, etc.
        </p>
      </div>

      <div className="calendar-grid">
        {/* Month axis */}
        <div className="calendar-row calendar-header-row">
          <div className="calendar-row-label calendar-row-label-header"></div>
          <div className="calendar-bars calendar-bars-header">
            {MONTHS.map(m => (
              <div
                key={m.label}
                className="calendar-month-tick"
                style={{ left: `${positionPct(m.start)}%` }}
              >
                {m.label}
              </div>
            ))}
            {todayPct !== null && (
              <div
                className="calendar-today-marker calendar-today-marker-header"
                style={{ left: `${todayPct}%` }}
                title={`${photoDate ? 'Photo date' : 'Today'}: ${todayMd}`}
              />
            )}
          </div>
        </div>

        {/* One section per colour class */}
        {COLOR_CLASS_ORDER.map(clsId => {
          const cls = COLOR_CLASSES[clsId]
          const speciesInClass = groups[clsId] || []
          if (!speciesInClass.length) return null
          return (
            <div key={clsId} className="calendar-class-section">
              <div className="calendar-class-divider">
                <span className="color-dot" style={{ backgroundColor: cls.bbox_color }} />
                <strong>{cls.label}</strong>
                <span className="muted small">{speciesInClass.length}</span>
              </div>
              {speciesInClass.map(sp => {
                const active = isSpeciesActive(sp, today)
                const status = getBloomStatus(sp, today)
                return (
                  <div
                    key={sp.id}
                    className={`calendar-row${active ? ' active' : ''}`}
                    onClick={() => onSelectSpecies?.(sp)}
                  >
                    <div className="calendar-row-label">
                      <div className="calendar-species-name">{sp.label}</div>
                      <div className="muted small calendar-species-status">
                        {sp.scientific} · <em>{status}</em>
                      </div>
                    </div>
                    <div className="calendar-bars">
                      {sp.bloom.map((range, i) => {
                        const startPct = positionPct(range.start)
                        const endPct = positionPct(range.end)
                        return (
                          <div
                            key={i}
                            className="calendar-bar"
                            style={{
                              left: `${startPct}%`,
                              width: `${Math.max(0.5, endPct - startPct)}%`,
                              backgroundColor: cls.bbox_color,
                            }}
                            title={`${range.start} → ${range.end}`}
                          />
                        )
                      })}
                      {todayPct !== null && (
                        <div
                          className="calendar-today-line"
                          style={{ left: `${todayPct}%` }}
                        />
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>

      <div className="calendar-footnote muted small">
        Source: City of Edmonton Species Calendar PDF (drone mapping reference).
        Bloom dates are best-effort 10-day-granularity windows; actual phenology
        shifts ±10 days year to year with weather.
      </div>
    </div>
  )
}
