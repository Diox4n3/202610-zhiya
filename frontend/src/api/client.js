const API_ROOT = '/api/v1'

export class ApiError extends Error {
  constructor(message, { status = 0, code = 'REQUEST_FAILED', requestId = '', retryable = false } = {}) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.requestId = requestId
    this.retryable = retryable
  }
}

function readCookie(name) {
  const prefix = `${encodeURIComponent(name)}=`
  return document.cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix))
    ?.slice(prefix.length) ?? ''
}

export async function apiRequest(path, options = {}) {
  const method = (options.method || 'GET').toUpperCase()
  const headers = new Headers(options.headers || {})
  headers.set('Accept', 'application/json')

  let body = options.body
  if (body !== undefined && !(body instanceof FormData) && typeof body !== 'string') {
    headers.set('Content-Type', 'application/json')
    body = JSON.stringify(body)
  }
  if (!['GET', 'HEAD'].includes(method)) {
    const csrf = decodeURIComponent(readCookie('zhiya_csrf'))
    if (csrf) headers.set('X-CSRF-Token', csrf)
  }

  let response
  try {
    response = await fetch(`${API_ROOT}${path}`, {
      ...options,
      method,
      body,
      headers,
      credentials: 'include',
    })
  } catch {
    throw new ApiError('无法连接后端服务', { retryable: true })
  }

  if (response.status === 204) return null

  const contentType = response.headers.get('content-type') || ''
  const payload = contentType.includes('application/json') ? await response.json() : null
  if (!response.ok) {
    const detail = payload?.error
    throw new ApiError(detail?.message || `请求失败（${response.status}）`, {
      status: response.status,
      code: detail?.code || 'REQUEST_FAILED',
      requestId: payload?.requestId || '',
      retryable: Boolean(detail?.retryable || response.status >= 500),
    })
  }
  return payload
}

export function createClientEventId(prefix = 'evt') {
  const random = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`
  return `${prefix}-${random}`.slice(0, 64)
}
