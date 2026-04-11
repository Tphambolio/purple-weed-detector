import { useMemo } from 'react'
import { SPECIES, groupByColorClass } from '../lib/species.js'
import { COLOR_CLASSES, COLOR_CLASS_ORDER } from '../lib/colorClasses.js'
import { isSpeciesActive, getBloomStatus } from '../lib/phenology.js'

// Year-agnostic position math: Apr 1 → 0%, Oct 31 → 100%.
// (Non-leap-year day-of-year arithmetic; bloom windows live in Apr–Oct so
// the leap-year delta is irrelevant.)
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

// Month metadata: label, mid-month position (where the label sits), and the
// boundary at the END of the month (where the next-month tick line is drawn).
const MONTHS = [
  { label: 'Apr', mid: '04-16', end: '04-30' },
  { label: 'May', mid: '05-16', end: '05-31' },
  { label: 'Jun', mid: '06-16', end: '06-30' },
  { label: 'Jul', mid: '07-16', end: '07-31' },
  { label: 'Aug', mid: '08-16', end: '08-31' },
  { label: 'Sep', mid: '09-16', end: '09-30' },
  { label: 'Oct', mid: '10-16', end: '10-31' },
]

const FORMAT_DATE = (date) => {
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${months[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`
}

export default function SpeciesCalendar({ photoDate, onSelectSpecies }) {
  const today = photoDate || new Date()
  const todayMd = dateToMonthDay(today)
  const todayInSeason = todayMd >= '04-01' && todayMd <= '10-31'
  const todayPct = todayInSeason ? positionPct(todayMd) : null
  const todayLabel = FORMAT_DATE(today)
  const markerKind = photoDate ? 'PHOTO' : 'TODAY'

  const groups = useMemo(() => groupByColorClass(SPECIES), [])

  return (
    <div className="p-4 md:p-6 lg:p-8 max-w-[1400px] mx-auto">
      <div className="mb-6 space-y-2">
        <h2 className="text-xl md:text-2xl font-bold tracking-tight text-on-surface">
          Bloom Calendar — Edmonton
        </h2>
        <p className="text-sm text-on-surface-variant/80 max-w-2xl">
          Year-agnostic identifiability windows from the City of Edmonton Species Calendar.
          Bars show when each species is in flower or otherwise detectable from a drone.
          The vertical line marks <strong className="text-on-surface">{photoDate ? 'the date of the loaded photo' : "today's date"}</strong>.
        </p>
        {todayInSeason && (
          <div className="inline-flex items-center gap-2 mt-1 px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-bold">
            <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
            {markerKind} · {todayLabel}
          </div>
        )}
        {!todayInSeason && (
          <div className="inline-flex items-center gap-2 mt-1 px-3 py-1 rounded-full bg-surface-container-high text-on-surface-variant text-xs font-bold">
            {todayLabel} · outside the Apr–Oct survey window
          </div>
        )}
      </div>

      {/* ── Calendar grid ─────────────────────────────────────────── */}
      <div className="rounded-2xl bg-surface-container-low p-4 md:p-6 overflow-hidden">
        {/* Month axis header */}
        <div className="flex items-center mb-3">
          <div className="w-[160px] md:w-[200px] flex-shrink-0" />
          <div className="relative flex-1 h-8">
            {/* Month boundary tick lines (subtle, in the gutter background) */}
            {MONTHS.map(m => (
              <div
                key={`tick-${m.label}`}
                className="absolute top-0 bottom-0 w-px bg-outline-variant/20"
                style={{ left: `${positionPct(m.end)}%` }}
              />
            ))}
            {/* Month labels (centred on mid-month) */}
            {MONTHS.map(m => (
              <div
                key={m.label}
                className="absolute top-1.5 -translate-x-1/2 text-[11px] font-bold uppercase tracking-widest text-on-surface-variant/60"
                style={{ left: `${positionPct(m.mid)}%` }}
              >
                {m.label}
              </div>
            ))}
            {/* Today marker — header arrow */}
            {todayPct !== null && (
              <div
                className="absolute -top-1 -translate-x-1/2 flex flex-col items-center pointer-events-none"
                style={{ left: `${todayPct}%` }}
              >
                <div className="text-[9px] font-black text-primary uppercase tracking-widest whitespace-nowrap mb-0.5">
                  {markerKind} · {todayMd}
                </div>
                <div className="w-0 h-0 border-l-[5px] border-l-transparent border-r-[5px] border-r-transparent border-t-[6px] border-t-primary" />
              </div>
            )}
          </div>
        </div>

        {/* Per-class species sections */}
        <div className="space-y-4">
          {COLOR_CLASS_ORDER.map(clsId => {
            const cls = COLOR_CLASSES[clsId]
            const speciesInClass = groups[clsId] || []
            if (!speciesInClass.length) return null
            return (
              <div key={clsId}>
                <div className="flex items-center gap-2 mb-1.5 px-2">
                  <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: cls.bbox_color }} />
                  <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: cls.bbox_color + 'cc' }}>
                    {cls.label}
                  </span>
                  <span className="text-[10px] text-on-surface-variant/40">{speciesInClass.length}</span>
                </div>
                {speciesInClass.map(sp => {
                  const active = isSpeciesActive(sp, today)
                  const status = getBloomStatus(sp, today)
                  return (
                    <div
                      key={sp.id}
                      className={`flex items-center min-h-[36px] rounded transition-colors cursor-pointer ${
                        active ? 'bg-surface-container/40 hover:bg-surface-container' : 'hover:bg-surface-container/30'
                      }`}
                      onClick={() => onSelectSpecies?.(sp)}
                    >
                      <div className="w-[160px] md:w-[200px] flex-shrink-0 px-2 py-1.5 min-w-0">
                        <div className={`text-xs truncate ${active ? 'text-on-surface font-semibold' : 'text-on-surface-variant/70'}`}>
                          {sp.label}
                        </div>
                        <div className="text-[10px] text-on-surface-variant/40 truncate italic">
                          {status}
                        </div>
                      </div>
                      <div className="relative flex-1 h-8">
                        {/* Faint month boundary lines inside each row's gutter */}
                        {MONTHS.map(m => (
                          <div
                            key={`row-tick-${sp.id}-${m.label}`}
                            className="absolute top-0 bottom-0 w-px bg-outline-variant/10"
                            style={{ left: `${positionPct(m.end)}%` }}
                          />
                        ))}
                        {/* Bloom bars */}
                        {sp.bloom.map((range, i) => {
                          const startPct = positionPct(range.start)
                          const endPct = positionPct(range.end)
                          return (
                            <div
                              key={i}
                              className="absolute top-1/2 -translate-y-1/2 h-4 rounded-full"
                              style={{
                                left: `${startPct}%`,
                                width: `${Math.max(0.8, endPct - startPct)}%`,
                                backgroundColor: cls.bbox_color,
                                boxShadow: `0 0 8px ${cls.bbox_color}40`,
                              }}
                              title={`${range.start} → ${range.end}`}
                            />
                          )
                        })}
                        {/* Today line — drawn over the bars */}
                        {todayPct !== null && (
                          <div
                            className="absolute top-0 bottom-0 w-px bg-primary pointer-events-none"
                            style={{ left: `${todayPct}%`, opacity: 0.5 }}
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

        <div className="mt-6 pt-4 border-t border-outline-variant/10 text-[10px] text-on-surface-variant/40 italic text-center">
          Source: City of Edmonton Species Calendar PDF.
          Bloom windows are 10-day-granularity; actual phenology shifts ±10 days year to year with weather.
        </div>
      </div>
    </div>
  )
}
