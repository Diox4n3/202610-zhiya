import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/client'
import * as auth from '../api/auth'
import * as profiles from '../api/profiles'
import * as books from '../api/storybooks'
import * as reading from '../api/reading'

vi.mock('../api/auth', () => ({ checkHealth: vi.fn(), login: vi.fn(), logout: vi.fn(), register: vi.fn() }))
vi.mock('../api/profiles', () => ({ listProfiles: vi.fn(), createProfile: vi.fn(), updateProfile: vi.fn() }))
vi.mock('../api/storybooks', () => ({ listStorybooks: vi.fn(), getStoryVersion: vi.fn() }))
vi.mock('../api/reading', () => ({ createReadingSession: vi.fn(), getReadingSession: vi.fn(), addReadingEvent: vi.fn(), completeReadingSession: vi.fn(), listReadingSessions: vi.fn() }))

const session = (overrides = {}) => ({ readingSessionId: 55, storyVersionId: 88, currentPage: 1, visitedPageNumbers: [1], revision: 1, status: 'IN_PROGRESS', ...overrides })
const detail = (overrides = {}) => ({ session: session(overrides), events: [], report: null })
const version = { storyVersionId: 88, title: '测试绘本', status: 'APPROVED_PRIVATE', pages: [{ pageNumber: 1, text: '一', defaultNextPageNumber: 3 }, { pageNumber: 3, text: '三', defaultNextPageNumber: 7 }, { pageNumber: 7, text: '七', defaultNextPageNumber: null }] }
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
let state, actions

beforeEach(async () => {
  vi.resetModules()
  vi.resetAllMocks()
  vi.useFakeTimers()
  localStorage.clear()
  window.history.replaceState({}, '', '/#reader/55')
  auth.login.mockResolvedValue({ data: { accountId: 1 } })
  auth.logout.mockResolvedValue(null)
  profiles.listProfiles.mockResolvedValue([{ childProfileId: 1, nickname: '小芽' }])
  books.listStorybooks.mockResolvedValue([version])
  books.getStoryVersion.mockResolvedValue(version)
  reading.getReadingSession.mockImplementation(async () => detail())
  reading.addReadingEvent.mockResolvedValue({ revision: 2 })
  reading.listReadingSessions.mockResolvedValue([session()])
  const store = await import('./useZhiya')
  state = store.zhiya
  actions = store.zhiyaActions
  await actions.loadReaderRoute()
})
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers() })

describe('authoritative reading progress', () => {
  it('serializes page writes and rejects skipped or already visited pages', async () => {
    const request = deferred()
    reading.addReadingEvent.mockReturnValueOnce(request.promise)
    const first = actions.recordPageChange(3)
    expect(await actions.recordPageChange(7)).toBe(false)
    expect(await actions.completeReading()).toBe(false)
    expect(state.currentSession.currentPage).toBe(1)
    request.resolve({ revision: 2 })
    expect(await first).toBe(true)
    expect(reading.addReadingEvent).toHaveBeenCalledTimes(1)
    expect(reading.addReadingEvent.mock.calls[0][1]).toMatchObject({ pageNumber: 3, expectedRevision: 1, eventType: 'PAGE_CHANGED' })
    expect(await actions.recordPageChange(1)).toBe(false)
    reading.addReadingEvent.mockResolvedValueOnce({ revision: 3 })
    expect(await actions.recordPageChange(7)).toBe(true)
    expect(reading.addReadingEvent.mock.calls[1][1].expectedRevision).toBe(2)
    expect(state.currentSession.currentPage).toBe(7)
  })

  it('resynchronizes all session details after a 409 and uses the new revision', async () => {
    reading.addReadingEvent.mockRejectedValueOnce(new ApiError('changed', { status: 409, code: 'SESSION_CONFLICT' }))
    reading.getReadingSession.mockResolvedValueOnce(detail({ currentPage: 3, visitedPageNumbers: [1, 3], revision: 5 }))
    expect(await actions.recordPageChange(3)).toBe(false)
    expect(state.currentSession.currentPage).toBe(3)
    expect(state.readingSyncRequired).toBe(false)
    await actions.recordPageChange(7)
    expect(reading.addReadingEvent.mock.calls[1][1].expectedRevision).toBe(5)
  })

  it('does not replay a timed out write when GET confirms newer progress', async () => {
    reading.addReadingEvent.mockRejectedValueOnce(new ApiError('timeout', { status: 504, code: 'REQUEST_OUTCOME_UNKNOWN' }))
    reading.getReadingSession.mockResolvedValueOnce(detail({ currentPage: 3, visitedPageNumbers: [1, 3], revision: 2 }))
    await actions.recordPageChange(3)
    expect(state.currentSession.currentPage).toBe(3)
    expect(state.readingSyncRequired).toBe(false)
    expect(reading.addReadingEvent).toHaveBeenCalledTimes(1)
  })

  it('locks new writes when outcome is unknown; explicit confirmation reuses the exact key and body', async () => {
    reading.addReadingEvent.mockRejectedValueOnce(new ApiError('timeout', { status: 504, code: 'REQUEST_OUTCOME_UNKNOWN' }))
    reading.getReadingSession.mockRejectedValueOnce(new Error('offline'))
    await actions.recordPageChange(3)
    const original = structuredClone(reading.addReadingEvent.mock.calls[0][1])
    expect(state.readingSyncRequired).toBe(true)
    expect(await actions.recordPageChange(3)).toBe(false)
    expect(await actions.completeReading()).toBe(false)
    await actions.refreshReading()
    expect(reading.addReadingEvent).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1100)
    await actions.refreshReading()
    expect(reading.addReadingEvent.mock.calls[1][1]).toEqual(original)
    expect(state.currentSession.currentPage).toBe(3)
    expect(state.readingSyncRequired).toBe(false)
  })

  it('handles completion conflicts using the same refresh path', async () => {
    reading.completeReadingSession.mockRejectedValueOnce(new ApiError('changed', { status: 409, code: 'SESSION_CONFLICT' }))
    reading.getReadingSession.mockResolvedValueOnce({ ...detail({ status: 'FINISHED', revision: 8 }), report: { summary: '已完成' } })
    expect(await actions.completeReading()).toBe(false)
    expect(state.currentSession.status).toBe('FINISHED')
    expect(state.currentReport.summary).toBe('已完成')
    expect(state.readingSyncRequired).toBe(false)
  })

  it('starts a restored CREATED session with its authoritative revision', async () => {
    reading.getReadingSession.mockResolvedValueOnce(detail({ status: 'CREATED', revision: 0, visitedPageNumbers: [] }))
    reading.addReadingEvent.mockResolvedValueOnce({ revision: 1 })
    await actions.loadReaderRoute()
    expect(reading.addReadingEvent.mock.calls[0][1]).toMatchObject({ eventType: 'STARTED', expectedRevision: 0, pageNumber: 1 })
    expect(state.currentSession.status).toBe('IN_PROGRESS')
  })

  it('does not overwrite a reloaded session with a late result from the old view', async () => {
    const pending = deferred()
    reading.addReadingEvent.mockReturnValueOnce(pending.promise)
    const oldWrite = actions.recordPageChange(3)
    reading.getReadingSession.mockResolvedValueOnce(detail({ currentPage: 7, visitedPageNumbers: [1, 3, 7], revision: 5 }))
    await actions.loadReaderRoute()
    pending.resolve({ revision: 2 })
    await oldWrite
    expect(state.currentSession.currentPage).toBe(7)
    expect(state.currentSession.revision).toBe(5)
  })
})

describe('account isolation and logout', () => {
  it('retains an honest authentication state and explicit message when logout fails', async () => {
    await actions.signIn('parent-a', 'password123')
    auth.logout.mockRejectedValueOnce(new Error('offline'))
    expect(await actions.signOut()).toBe(false)
    expect(state.auth.authenticated).toBe(true)
    expect(state.auth.status).toBe('authenticated')
    expect(state.toast.message).toContain('退出尚未确认')
    expect(localStorage.getItem('zhiya.account')).toBe('parent-a')
  })

  it('clears private account state and stored preferences only on confirmed logout', async () => {
    await actions.signIn('parent-a', 'password123')
    localStorage.setItem('zhiya.plan', '{"minutes":20}')
    localStorage.setItem('zhiya.guardianNickname', '家长A')
    localStorage.setItem('other-app-setting', 'keep')
    expect(await actions.signOut()).toBe(true)
    expect(state.auth.authenticated).toBe(false)
    expect(state.profiles).toEqual([])
    expect(state.currentSession).toBeNull()
    expect(state.currentBook).toBeNull()
    expect(state.currentEvents).toEqual([])
    expect(state.currentReport).toBeNull()
    expect(state.books.every((book) => book.source === 'preview')).toBe(true)
    expect(localStorage.getItem('zhiya.plan')).toBeNull()
    expect(localStorage.getItem('zhiya.guardianNickname')).toBeNull()
    expect(localStorage.getItem('zhiya.activeProfileId')).toBeNull()
    expect(localStorage.getItem('other-app-setting')).toBe('keep')
  })

  it('ignores private books, profiles and sessions arriving after logout', async () => {
    await actions.signIn('parent-a', 'password123')
    const booksRequest = deferred(), profileRequest = deferred(), sessionRequest = deferred()
    books.listStorybooks.mockReturnValueOnce(booksRequest.promise)
    profiles.listProfiles.mockReturnValueOnce(profileRequest.promise)
    reading.listReadingSessions.mockReturnValueOnce(sessionRequest.promise)
    const pending = [actions.loadBooks(), actions.loadProfiles(), actions.loadSessions()]
    await actions.signOut()
    booksRequest.resolve([version])
    profileRequest.resolve([{ childProfileId: 99, nickname: '上个账号' }])
    sessionRequest.resolve([session()])
    await Promise.all(pending)
    expect(state.profiles).toEqual([])
    expect(state.sessions).toEqual([])
    expect(state.booksSource).toBe('preview')
  })

  it('ignores an old session response after changing routes', async () => {
    const pending = deferred()
    reading.getReadingSession.mockReturnValueOnce(pending.promise)
    const loading = actions.loadReaderRoute()
    window.history.replaceState({}, '', '/#home')
    await actions.syncRoute()
    pending.resolve(detail({ readingSessionId: 99 }))
    await loading
    expect(state.currentSession).toBeNull()
  })
})
