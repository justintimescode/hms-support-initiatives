import React, { useState, useEffect, useRef } from 'react'
import { useJiraProjects } from '../hooks/useJiraProjects.js'

const T = {
  bg: '#F3EEE5', surface: '#FBF8F2', surfaceAlt: '#EFE8DB',
  ink: '#141311', sub: '#5C564A', muted: '#8A8270',
  border: '#D9D1BF', borderSoft: '#E8E0CE',
  accent: '#B8452C', accentSoft: '#E8C6B8',
  ok: '#3D6340', okSoft: '#C8D6BF',
  danger: '#A23220', dangerSoft: '#E7B8AD',
}

const PRIORITIES = ['Highest', 'High', 'Medium', 'Low', 'Lowest']
const ISSUE_TYPES = ['Task', 'Bug', 'Story', 'Improvement']

const inputStyle = {
  width: '100%',
  padding: '8px 10px',
  fontSize: 13,
  border: `1px solid ${T.border}`,
  borderRadius: 6,
  background: T.surface,
  color: T.ink,
  outline: 'none',
  fontFamily: 'inherit',
  boxSizing: 'border-box',
}

const labelStyle = {
  display: 'block',
  fontSize: 12,
  fontWeight: 600,
  color: T.sub,
  marginBottom: 4,
}

/**
 * Modal for creating a Jira ticket from a KPI card.
 *
 * Props:
 *   kpiData   — { label, value, sub, description } used to pre-populate fields
 *   onClose   — called when the modal is dismissed
 *   onSuccess — called with { key, url } when a ticket is created
 */
export default function JiraTicketModal({ kpiData, onClose, onSuccess }) {
  const { projects, loading: projectsLoading, error: projectsError } = useJiraProjects()

  const [summary, setSummary]       = useState('')
  const [description, setDescription] = useState('')
  const [projectKey, setProjectKey] = useState(() => localStorage.getItem('jira_last_project') || '')
  const [priority, setPriority]     = useState('Medium')
  const [issueType, setIssueType]   = useState('Task')

  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState(null)
  const [created, setCreated]       = useState(null) // { key, url }

  const firstFocusRef = useRef(null)
  const triggerRef    = useRef(document.activeElement)

  // Pre-populate from kpiData
  useEffect(() => {
    if (!kpiData) return
    const val = kpiData.value != null ? ` — ${kpiData.value}` : ''
    setSummary(`KPI Alert: ${kpiData.label}${val}`)
    const lines = [`KPI: ${kpiData.label}`]
    if (kpiData.value != null) lines.push(`Current value: ${kpiData.value}`)
    if (kpiData.sub)           lines.push(`Context: ${kpiData.sub}`)
    if (kpiData.description)   lines.push(`\n${kpiData.description}`)
    setDescription(lines.join('\n'))
  }, [kpiData])

  // Set default project once list loads
  useEffect(() => {
    if (projects.length && !projectKey) {
      setProjectKey(projects[0].key)
    }
  }, [projects, projectKey])

  // Focus first field on mount
  useEffect(() => {
    firstFocusRef.current?.focus()
  }, [])

  // Trap focus inside modal
  useEffect(() => {
    const modal = document.getElementById('jira-modal')
    if (!modal) return
    const focusable = () =>
      Array.from(modal.querySelectorAll('button,input,select,textarea,[tabindex]:not([tabindex="-1"])'))
        .filter((el) => !el.disabled)

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') { onClose(); return }
      if (e.key !== 'Tab') return
      const els = focusable()
      if (!els.length) return
      const first = els[0], last = els[els.length - 1]
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last.focus() }
      } else {
        if (document.activeElement === last) { e.preventDefault(); first.focus() }
      }
    }
    modal.addEventListener('keydown', handleKeyDown)
    return () => modal.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  // Restore focus on unmount
  useEffect(() => {
    return () => { triggerRef.current?.focus?.() }
  }, [])

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!projectKey || !summary.trim()) return
    setSubmitting(true)
    setSubmitError(null)
    try {
      const res = await fetch('/api/jira/tickets', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectKey, summary: summary.trim(), description, priority, issueType }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      localStorage.setItem('jira_last_project', projectKey)
      setCreated(data)
    } catch (err) {
      setSubmitError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  const handleSuccess = () => {
    onSuccess(created)
    onClose()
  }

  return (
    /* backdrop */
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(20,19,17,0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16,
      }}
    >
      <div
        id="jira-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="jira-modal-title"
        style={{
          background: T.surface,
          border: `1px solid ${T.border}`,
          borderRadius: 12,
          padding: 24,
          width: '100%',
          maxWidth: 520,
          boxShadow: '0 8px 40px rgba(0,0,0,0.18)',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
          maxHeight: '90vh',
          overflowY: 'auto',
        }}
      >
        {/* header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2 id="jira-modal-title" style={{ fontSize: 16, fontWeight: 700, color: T.ink, margin: 0 }}>
            Create Jira Ticket
          </h2>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              fontSize: 20, color: T.muted, lineHeight: 1, padding: '0 4px',
            }}
          >
            ×
          </button>
        </div>

        {/* success state */}
        {created ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{
              background: T.okSoft, border: `1px solid ${T.ok}44`,
              borderRadius: 8, padding: '12px 16px',
              display: 'flex', alignItems: 'center', gap: 10,
            }}>
              <span style={{ fontSize: 18 }}>✓</span>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: T.ok }}>Ticket created</div>
                <a
                  href={created.url} target="_blank" rel="noreferrer"
                  style={{ fontSize: 13, color: T.accent, fontWeight: 600 }}
                >
                  {created.key} ↗
                </a>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                onClick={handleSuccess}
                style={{
                  padding: '8px 18px', background: T.accent, color: '#fff',
                  border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer',
                }}
              >
                Done
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {/* project */}
            <div>
              <label htmlFor="jira-project" style={labelStyle}>Project *</label>
              {projectsLoading ? (
                <div style={{ fontSize: 12, color: T.muted, padding: '8px 0' }}>Loading projects…</div>
              ) : projectsError ? (
                <div style={{ fontSize: 12, color: T.danger }}>{projectsError}</div>
              ) : (
                <select
                  id="jira-project"
                  value={projectKey}
                  onChange={(e) => setProjectKey(e.target.value)}
                  required
                  style={{ ...inputStyle, cursor: 'pointer' }}
                >
                  <option value="" disabled>Select a project…</option>
                  {projects.map((p) => (
                    <option key={p.key} value={p.key}>{p.name} ({p.key})</option>
                  ))}
                </select>
              )}
            </div>

            {/* summary */}
            <div>
              <label htmlFor="jira-summary" style={labelStyle}>Summary *</label>
              <input
                id="jira-summary"
                ref={firstFocusRef}
                type="text"
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                required
                maxLength={255}
                style={inputStyle}
              />
            </div>

            {/* description */}
            <div>
              <label htmlFor="jira-description" style={labelStyle}>Description</label>
              <textarea
                id="jira-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={5}
                style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.5 }}
              />
            </div>

            {/* priority + issue type row */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label htmlFor="jira-priority" style={labelStyle}>Priority</label>
                <select
                  id="jira-priority"
                  value={priority}
                  onChange={(e) => setPriority(e.target.value)}
                  style={{ ...inputStyle, cursor: 'pointer' }}
                >
                  {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="jira-issue-type" style={labelStyle}>Issue Type</label>
                <select
                  id="jira-issue-type"
                  value={issueType}
                  onChange={(e) => setIssueType(e.target.value)}
                  style={{ ...inputStyle, cursor: 'pointer' }}
                >
                  {ISSUE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            </div>

            {/* error */}
            {submitError && (
              <div
                role="alert"
                aria-live="polite"
                style={{
                  background: T.dangerSoft, color: T.danger,
                  fontSize: 12, padding: '8px 12px', borderRadius: 6,
                }}
              >
                {submitError}
              </div>
            )}

            {/* actions */}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
              <button
                type="button"
                onClick={onClose}
                style={{
                  padding: '8px 16px', background: T.surfaceAlt, color: T.sub,
                  border: `1px solid ${T.border}`, borderRadius: 6,
                  fontSize: 13, fontWeight: 500, cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting || !projectKey || !summary.trim()}
                style={{
                  padding: '8px 18px', background: T.accent, color: '#fff',
                  border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 600,
                  cursor: submitting || !projectKey || !summary.trim() ? 'not-allowed' : 'pointer',
                  opacity: submitting || !projectKey || !summary.trim() ? 0.6 : 1,
                  display: 'flex', alignItems: 'center', gap: 6,
                }}
              >
                {submitting ? 'Creating…' : 'Create Ticket'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
