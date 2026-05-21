import React from 'react'

const STATUS_COLORS = {
  done:        { bg: '#C8D6BF', color: '#3D6340' },
  'in-progress': { bg: '#EBD3A0', color: '#B8801C' },
  'to-do':     { bg: '#E8E0CE', color: '#5C564A' },
  default:     { bg: '#E8E0CE', color: '#5C564A' },
}

/**
 * A small clickable chip that links to a Jira ticket.
 *
 * Props:
 *   ticketKey  — e.g. "OPS-42"
 *   ticketUrl  — full URL to the ticket
 *   status     — optional status string (e.g. "In Progress")
 *   statusCategory — optional Jira status category key ("done", "in-progress", "to-do")
 */
export default function JiraTicketBadge({ ticketKey, ticketUrl, status, statusCategory }) {
  const palette = STATUS_COLORS[statusCategory] || STATUS_COLORS.default

  return (
    <a
      href={ticketUrl}
      target="_blank"
      rel="noreferrer"
      title={status ? `${ticketKey} — ${status}` : ticketKey}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        fontSize: 11,
        fontWeight: 600,
        padding: '2px 8px',
        borderRadius: 99,
        textDecoration: 'none',
        background: palette.bg,
        color: palette.color,
        border: `1px solid ${palette.color}44`,
        whiteSpace: 'nowrap',
      }}
    >
      {ticketKey}
      {status && (
        <span style={{ fontWeight: 400, opacity: 0.8 }}>· {status}</span>
      )}
      <span style={{ fontSize: 10 }}>↗</span>
    </a>
  )
}
