import { useEffect, useRef } from 'react'
import type { DestinationConfig } from '../game/config'

interface InvitationCardProps {
  destination: DestinationConfig
  onClose: () => void
}

export function InvitationCard({
  destination,
  onClose,
}: InvitationCardProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const invitation = destination.invitation

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    const focusable = dialog.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
    )
    focusable[0]?.focus()

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose()
        return
      }
      if (event.key !== 'Tab' || focusable.length < 2) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  return (
    <div
      className="invitation-backdrop absolute inset-0 z-30 flex items-end justify-center bg-black/45 px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-24 backdrop-blur-[2px] sm:items-center sm:py-8"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="invitation-title"
        aria-describedby="invitation-description"
        className="invitation-card relative w-full max-w-md overflow-hidden rounded-[2rem] border border-rose-200/20 bg-[#11131d]/95 p-6 text-center shadow-[0_24px_80px_rgba(0,0,0,0.65)] backdrop-blur-2xl sm:p-8"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="celebration" aria-hidden="true">
          <span>♥</span><span>✦</span><span>♥</span><span>✦</span><span>♥</span>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 rounded-full p-2 text-white/45 transition hover:bg-white/10 hover:text-white focus:outline-none focus:ring-2 focus:ring-rose-300"
          aria-label="Meghívó bezárása"
        >
          ✕
        </button>

        <div className="text-4xl" aria-hidden="true">{destination.icon ?? '📍'}</div>
        {invitation.eyebrow && (
          <p className="mt-4 text-[11px] font-semibold uppercase tracking-[0.24em] text-rose-300">
            {invitation.eyebrow}
          </p>
        )}
        <h2 id="invitation-title" className="mt-2 text-2xl font-semibold text-white sm:text-3xl">
          {invitation.title}
        </h2>
        <p id="invitation-description" className="mt-3 leading-relaxed text-white/70">
          {invitation.message}
        </p>

        <div className="mt-6 space-y-3 text-left">
          {invitation.dateTime && <InvitationDetail icon="🗓️" text={invitation.dateTime} />}
          {invitation.meetingInstructions && (
            <InvitationDetail icon="📍" text={invitation.meetingInstructions} />
          )}
          {invitation.dressHint && <InvitationDetail icon="✨" text={invitation.dressHint} />}
        </div>

        <div className="mt-7 flex flex-col gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-white/10 bg-white/5 px-5 py-3 text-sm text-white/70 transition hover:bg-white/10 hover:text-white focus:outline-none focus:ring-2 focus:ring-white/50"
          >
            {invitation.secondaryLabel ?? 'Megnézem a térképen'}
          </button>
        </div>
      </div>
    </div>
  )
}

function InvitationDetail({ icon, text }: { icon: string; text: string }) {
  return (
    <div className="flex gap-3 rounded-xl border border-white/8 bg-white/5 px-4 py-3">
      <span aria-hidden="true">{icon}</span>
      <span className="text-sm leading-relaxed text-white/75">{text}</span>
    </div>
  )
}
