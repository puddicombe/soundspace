'use client'
import { useState, useCallback } from 'react'

interface Candidate {
  chord: string
  score: number
}

interface Props {
  chord: string | null
  candidates: ReadonlyArray<Candidate>
  onClose: () => void
}

interface TestEntry {
  detected: string | null
  correct: boolean
  actual?: string   // what user was actually playing (if different)
}

const FONT = '"Courier New", Courier, monospace'

export function ChordTestOverlay({ chord, candidates, onClose }: Props) {
  const [history, setHistory] = useState<TestEntry[]>([])
  const [pendingWrong, setPendingWrong] = useState(false)
  const [actualInput, setActualInput] = useState('')

  const correctCount = history.filter(h => h.correct).length
  const accuracy = history.length > 0 ? Math.round((correctCount / history.length) * 100) : null

  const markCorrect = useCallback(() => {
    setHistory(prev => [...prev, { detected: chord, correct: true }])
    setPendingWrong(false)
    setActualInput('')
  }, [chord])

  const markWrong = useCallback(() => {
    setPendingWrong(true)
  }, [])

  const submitWrong = useCallback(() => {
    setHistory(prev => [...prev, {
      detected: chord,
      correct: false,
      actual: actualInput.trim() || undefined,
    }])
    setPendingWrong(false)
    setActualInput('')
  }, [chord, actualInput])

  const reset = () => {
    setHistory([])
    setPendingWrong(false)
    setActualInput('')
  }

  return (
    <div
      className="fixed bottom-4 left-4 z-40 w-72 rounded-lg border border-white/20
                 bg-black/90 backdrop-blur-sm overflow-hidden select-none"
      style={{ fontFamily: FONT }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/10">
        <span className="text-cyan-400 text-xs font-bold tracking-wider">CHORD ACCURACY TEST</span>
        <div className="flex gap-2 items-center">
          {history.length > 0 && (
            <button onClick={reset} className="text-white/30 hover:text-white/60 text-xs">reset</button>
          )}
          <button onClick={onClose} className="text-white/30 hover:text-white/80 text-lg leading-none">×</button>
        </div>
      </div>

      {/* Current detection */}
      <div className="px-3 pt-3 pb-1">
        <div className="text-white/40 text-xs mb-1">DETECTED</div>
        <div className="flex items-baseline gap-2">
          <span className={`text-4xl font-bold ${chord ? 'text-cyan-400' : 'text-white/20'}`}
                style={{ textShadow: chord ? '0 0 16px #00ffaa88' : 'none' }}>
            {chord ?? '—'}
          </span>
          {candidates[0] && (
            <span className="text-white/40 text-xs">
              {Math.round(candidates[0].score * 100)}% conf
            </span>
          )}
        </div>
      </div>

      {/* Top candidates */}
      {candidates.length > 0 && (
        <div className="px-3 pb-2">
          <div className="text-white/30 text-xs mb-1">CANDIDATES</div>
          {candidates.slice(0, 4).map(({ chord: c, score }, i) => (
            <div key={i} className="flex items-center gap-2 mb-0.5">
              <span className={`w-8 text-xs ${i === 0 ? 'text-cyan-400 font-bold' : 'text-white/50'}`}>{c}</span>
              <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-200 ${i === 0 ? 'bg-cyan-400' : 'bg-white/30'}`}
                  style={{ width: `${score * 100}%` }}
                />
              </div>
              <span className="text-white/30 text-xs w-7 text-right">{Math.round(score * 100)}</span>
            </div>
          ))}
        </div>
      )}

      {/* Accuracy tally */}
      {history.length > 0 && (
        <div className="px-3 py-1.5 border-t border-white/10 flex items-center gap-3">
          <span className={`text-sm font-bold ${
            accuracy !== null && accuracy >= 70 ? 'text-green-400' :
            accuracy !== null && accuracy >= 40 ? 'text-yellow-400' : 'text-red-400'
          }`}>
            {accuracy}%
          </span>
          <span className="text-white/40 text-xs">{correctCount}/{history.length} correct</span>
          <div className="flex-1" />
          {/* Mini history dots */}
          <div className="flex gap-0.5">
            {history.slice(-10).map((h, i) => (
              <div key={i} className={`w-2 h-2 rounded-full ${h.correct ? 'bg-green-400' : 'bg-red-400'}`} />
            ))}
          </div>
        </div>
      )}

      {/* Wrong input area */}
      {pendingWrong && (
        <div className="px-3 py-2 border-t border-white/10 bg-white/5">
          <div className="text-white/50 text-xs mb-1.5">What were you actually playing?</div>
          <div className="flex gap-2">
            <input
              autoFocus
              type="text"
              value={actualInput}
              onChange={e => setActualInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') submitWrong() }}
              placeholder="e.g. Am, G, Dm …"
              className="flex-1 bg-white/10 text-white text-xs rounded px-2 py-1
                         border border-white/20 outline-none focus:border-cyan-400/60
                         placeholder:text-white/20"
              style={{ fontFamily: FONT }}
            />
            <button
              onClick={submitWrong}
              className="text-xs px-2 py-1 bg-red-500/20 text-red-400 rounded border border-red-400/30
                         hover:bg-red-500/40 transition-colors"
            >
              log
            </button>
          </div>
        </div>
      )}

      {/* Action buttons */}
      {!pendingWrong && (
        <div className="px-3 py-2 border-t border-white/10 flex gap-2">
          <button
            onClick={markCorrect}
            disabled={!chord}
            className="flex-1 py-1.5 rounded text-xs font-bold transition-colors
                       bg-green-500/20 text-green-400 border border-green-400/30
                       hover:bg-green-500/40 disabled:opacity-20 disabled:cursor-not-allowed"
          >
            ✓ Correct
          </button>
          <button
            onClick={markWrong}
            disabled={!chord}
            className="flex-1 py-1.5 rounded text-xs font-bold transition-colors
                       bg-red-500/20 text-red-400 border border-red-400/30
                       hover:bg-red-500/40 disabled:opacity-20 disabled:cursor-not-allowed"
          >
            ✗ Wrong
          </button>
        </div>
      )}

      {/* Session history (scrollable, last 20) */}
      {history.length > 0 && (
        <div className="px-3 pb-2 border-t border-white/10 max-h-28 overflow-y-auto">
          <div className="text-white/30 text-xs mt-1.5 mb-1">HISTORY</div>
          {history.slice().reverse().slice(0, 20).map((h, i) => (
            <div key={i} className="flex items-center gap-2 text-xs py-0.5">
              <span className={h.correct ? 'text-green-400' : 'text-red-400'}>
                {h.correct ? '✓' : '✗'}
              </span>
              <span className="text-white/60">{h.detected ?? '—'}</span>
              {!h.correct && h.actual && (
                <span className="text-white/30">→ {h.actual}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
