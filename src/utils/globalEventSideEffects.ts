// ============================================
// Global Event Side Effects
// ============================================
//
// Multiple app windows subscribe to the same global SSE stream. State updates
// must still happen in every window, but one-shot side effects such as audio,
// toasts, and automatic permission replies should only run once per event.

interface SideEffectClaim {
  token: string
  expiresAt: number
}

const STORAGE_PREFIX = 'opencode:global-side-effect:'
const LOCK_PREFIX = 'opencode:global-side-effect-lock:'
const DEFAULT_TTL_MS = 3000
const FALLBACK_CONFIRM_DELAY_MS = 25

function createClaimToken(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function parseClaim(raw: string | null): SideEffectClaim | null {
  if (!raw) return null

  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null

    const record = parsed as Record<string, unknown>
    if (typeof record.token !== 'string') return null
    if (typeof record.expiresAt !== 'number') return null
    return { token: record.token, expiresAt: record.expiresAt }
  } catch {
    return null
  }
}

function removeStoredClaim(storageKey: string, token: string) {
  try {
    const stored = parseClaim(localStorage.getItem(storageKey))
    if (stored?.token === token) {
      localStorage.removeItem(storageKey)
    }
  } catch {
    // Ignore storage cleanup failures.
  }
}

function scheduleClaimCleanup(storageKey: string, token: string, ttlMs: number) {
  setTimeout(() => removeStoredClaim(storageKey, token), ttlMs)
}

function waitForFallbackConfirmation(): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, FALLBACK_CONFIRM_DELAY_MS)
  })
}

export function claimGlobalSideEffect(key: string, ttlMs: number = DEFAULT_TTL_MS): boolean {
  const storageKey = `${STORAGE_PREFIX}${key}`
  const now = Date.now()

  try {
    const existing = parseClaim(localStorage.getItem(storageKey))
    if (existing && existing.expiresAt > now) return false

    const token = createClaimToken()
    const claim: SideEffectClaim = {
      token,
      expiresAt: now + ttlMs,
    }

    localStorage.setItem(storageKey, JSON.stringify(claim))
    const stored = parseClaim(localStorage.getItem(storageKey))
    const claimed = stored?.token === token
    if (claimed) {
      scheduleClaimCleanup(storageKey, claim.token, ttlMs)
    }
    return claimed
  } catch {
    // If storage is unavailable, prefer preserving the side effect over
    // dropping notifications/sounds entirely.
    return true
  }
}

async function claimGlobalSideEffectAfterConfirmation(key: string, ttlMs: number): Promise<boolean> {
  const storageKey = `${STORAGE_PREFIX}${key}`
  const now = Date.now()

  try {
    const existing = parseClaim(localStorage.getItem(storageKey))
    if (existing && existing.expiresAt > now) return false

    const token = createClaimToken()
    const claim: SideEffectClaim = {
      token,
      expiresAt: now + ttlMs,
    }

    localStorage.setItem(storageKey, JSON.stringify(claim))
    await waitForFallbackConfirmation()

    const stored = parseClaim(localStorage.getItem(storageKey))
    const claimed = stored?.token === token && stored.expiresAt > Date.now()
    if (claimed) {
      scheduleClaimCleanup(storageKey, claim.token, ttlMs)
    }
    return claimed
  } catch {
    // If storage is unavailable, prefer preserving the side effect over
    // dropping notifications/sounds entirely.
    return true
  }
}

export async function claimGlobalSideEffectLocked(key: string, ttlMs: number = DEFAULT_TTL_MS): Promise<boolean> {
  const lockManager = typeof navigator === 'undefined' ? undefined : navigator.locks
  if (!lockManager) return claimGlobalSideEffectAfterConfirmation(key, ttlMs)

  try {
    return await lockManager.request(`${LOCK_PREFIX}${key}`, { mode: 'exclusive' }, () => claimGlobalSideEffect(key, ttlMs))
  } catch {
    return claimGlobalSideEffectAfterConfirmation(key, ttlMs)
  }
}
