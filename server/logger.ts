/** Structured one-line logs. Never pass passwords, tokens or file contents here. */
export interface Logger {
  info(event: string, data?: Record<string, unknown>): void
  warn(event: string, data?: Record<string, unknown>): void
  error(event: string, data?: Record<string, unknown>): void
}

export function createLogger(silent = false): Logger {
  const out = (level: string, event: string, data?: Record<string, unknown>) => {
    if (silent) return
    const line = JSON.stringify({ t: new Date().toISOString(), level, event, ...data })
    if (level === 'error') console.error(line)
    else console.log(line)
  }
  return {
    info: (e, d) => out('info', e, d),
    warn: (e, d) => out('warn', e, d),
    error: (e, d) => out('error', e, d),
  }
}
