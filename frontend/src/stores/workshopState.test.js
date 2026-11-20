import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/client'
import * as auth from '../api/auth'
import * as profiles from '../api/profiles'
import * as books from '../api/storybooks'
import * as reading from '../api/reading'
import * as adminApi from '../api/admin'
import * as storyWorkshop from '../api/storyWorkshop'

vi.mock('../api/auth', () => ({
  checkHealth: vi.fn(),
  currentIdentity: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
  parentUnlock: vi.fn(),
  register: vi.fn(),
}))
vi.mock('../api/profiles', () => ({
  listProfiles: vi.fn(),
  createProfile: vi.fn(),
  updateProfile: vi.fn(),
  deleteProfile: vi.fn(),
}))
vi.mock('../api/storybooks', () => ({
  listStorybooks: vi.fn(),
  getStoryVersion: vi.fn(),
  recommendStorybooks: vi.fn(),
}))
vi.mock('../api/reading', () => ({
  createReadingSession: vi.fn(),
  getReadingSession: vi.fn(),
  addReadingEvent: vi.fn(),
  requestReadingGuidance: vi.fn(),
  chooseReadingBranch: vi.fn(),
  completeReadingSession: vi.fn(),
  listReadingSessions: vi.fn(),
  deleteReadingSession: vi.fn(),
  getDeletionStatus: vi.fn(),
  updateReadingMode: vi.fn(),
}))
vi.mock('../api/admin', () => ({
  listAdminStoryVersions: vi.fn(),
  listAdminKnowledge: vi.fn(),
  createAdminStory: vi.fn(),
  updateAdminStoryStatus: vi.fn(),
  createAdminKnowledge: vi.fn(),
  updateAdminKnowledge: vi.fn(),
}))
vi.mock('../api/storyWorkshop', () => ({
  generateStory: vi.fn(),
  approveStoryVersion: vi.fn(),
}))

const draft = {
  storybookId: 21,
  storyVersionId: 31,
  versionNumber: 1,
  title: '月光下的小兔',
  status: 'PENDING_REVIEW',
  pages: [
    { pageNumber: 1, text: '第一页', imageRef: 'asset-31-page-1', defaultNextPageNumber: 2 },
    { pageNumber: 2, text: '第二页', imageRef: 'asset-31-page-2', defaultNextPageNumber: 3 },
    { pageNumber: 3, text: '第三页', imageRef: 'asset-31-page-3', defaultNextPageNumber: 4 },
    { pageNumber: 4, text: '第四页', imageRef: 'asset-31-page-4', defaultNextPageNumber: null },
  ],
  branches: [],
  checkResults: { structurePassed: true, safetyPassed: true, licensePassed: true },
}
const form = {
  ageBand: 'AGE_4_5',
  topic: '友谊',
  characters: ['小兔'],
  scene: '森林',
  branching: true,
}
const sourceSession = {
  childProfileId: 7,
  sourceType: 'ORIGINAL',
  readingSessionId: 55,
  storyVersionId: 30,
  mode: 'PARENT_CHILD',
  status: 'IN_PROGRESS',
  currentPage: 2,
  visitedPageNumbers: [1, 2],
  revision: 4,
}
let state
let actions

beforeEach(() => {
  vi.resetModules()
  vi.resetAllMocks()
  localStorage.clear()
  sessionStorage.clear()
  localStorage.setItem('zhiya.account', 'parent-a')
  auth.checkHealth.mockResolvedValue({})
  auth.currentIdentity.mockResolvedValue({ role: 'GUARDIAN', accountId: 1 })
  profiles.listProfiles.mockResolvedValue([{
    childProfileId: 7,
    nickname: '小芽',
    ageBand: 'AGE_4_5',
  }])
  books.listStorybooks.mockResolvedValue([])
  books.recommendStorybooks.mockResolvedValue([])
  reading.listReadingSessions.mockResolvedValue([])
  reading.getReadingSession.mockResolvedValue({ session: sourceSession, events: [], report: null })
  reading.createReadingSession.mockResolvedValue({
    readingSessionId: 77,
    storyVersionId: 32,
    mode: 'PARENT_CHILD',
    status: 'IN_PROGRESS',
    currentPage: 3,
    visitedPageNumbers: [1, 2, 3],
    revision: 1,
  })
  storyWorkshop.generateStory.mockResolvedValue(draft)
  adminApi.listAdminStoryVersions.mockResolvedValue({ items: [] })
  adminApi.listAdminKnowledge.mockResolvedValue({ items: [] })
})

afterEach(() => {
  vi.clearAllTimers()
})

async function open(path = 'workshop') {
  window.history.replaceState({}, '', `/#${path}`)
  const store = await import('./useZhiya')
  state = store.zhiya
  actions = store.zhiyaActions
  await actions.bootstrap()
  return store
}

describe('workshop state and API sequencing', () => {
  it('creates a new generation only after the guardian submits the selected conditions', async () => {
    await open()
    expect(storyWorkshop.generateStory).not.toHaveBeenCalled()

    expect(await actions.generateWorkshopDraft(form)).toBe(true)
    expect(storyWorkshop.generateStory).toHaveBeenCalledWith(expect.objectContaining({
      ageBand: 'AGE_4_5',
      topic: '友谊',
      characters: ['小兔'],
      scene: '森林',
      branching: true,
      clientRequestId: expect.stringMatching(/^story-/),
    }))
    expect(state.workshop.generationStatus).toBe('review')
    expect(state.workshop.draft).toEqual(draft)
    expect(state.workshop.pendingGeneration).toBeNull()
  })

  it('confirms an uncertain generation with the exact original payload and idempotency key', async () => {
    await open()
    storyWorkshop.generateStory
      .mockRejectedValueOnce(new ApiError('网络中断', { code: 'REQUEST_OUTCOME_UNKNOWN' }))
      .mockResolvedValueOnce(draft)

    expect(await actions.generateWorkshopDraft(form)).toBe(false)
    expect(state.workshop.generationStatus).toBe('unknown')
    const original = structuredClone(storyWorkshop.generateStory.mock.calls[0][0])

    expect(await actions.retryWorkshopGeneration()).toBe(true)
    expect(storyWorkshop.generateStory).toHaveBeenCalledTimes(2)
    expect(storyWorkshop.generateStory.mock.calls[1][0]).toEqual(original)
    expect(state.workshop.generationStatus).toBe('review')
  })

  it('approves the reviewed version and exposes the approved private result', async () => {
    await open()
    storyWorkshop.approveStoryVersion.mockResolvedValue({
      ...draft,
      status: 'APPROVED_PRIVATE',
    })
    await actions.generateWorkshopDraft(form)

    expect(await actions.approveWorkshopDraft()).toBe(true)
    expect(storyWorkshop.approveStoryVersion).toHaveBeenCalledWith(31, 1)
    expect(state.workshop.generationStatus).toBe('approved')
    expect(state.workshop.approvedVersion.status).toBe('APPROVED_PRIVATE')
  })

  it('starts a fresh request only after the guardian closes a terminal unknown result', async () => {
    await open()
    storyWorkshop.generateStory.mockRejectedValueOnce(new ApiError('生成结果未知', {
      status: 504, code: 'REQUEST_OUTCOME_UNKNOWN',
    }))
    await actions.generateWorkshopDraft(form)
    expect(state.workshop.generationStatus).toBe('endedUnknown')
    expect(await actions.generateWorkshopDraft(form)).toBe(false)
    expect(storyWorkshop.generateStory).toHaveBeenCalledTimes(1)
    expect(actions.resetWorkshopDraft()).toBe(true)
    expect(await actions.generateWorkshopDraft(form)).toBe(true)
    const [first, second] = storyWorkshop.generateStory.mock.calls
    expect(first[0].clientRequestId).not.toBe(second[0].clientRequestId)
  })

  it('clears a failed continuation when opening the regular workshop', async () => {
    reading.getReadingSession.mockRejectedValueOnce(new Error('无法读取会话'))
    await open('workshop/continue/55')
    expect(state.workshop.continuationError).toBeTruthy()
    window.history.replaceState({}, '', '/#workshop')
    await actions.syncRoute()
    expect(state.workshop.continuationError).toBe('')
    expect(await actions.generateWorkshopDraft(form)).toBe(true)
    expect(storyWorkshop.generateStory.mock.calls[0][0]).not.toHaveProperty('sourceReadingSessionId')
  })

  it('discards an approval lookup that finishes after logout', async () => {
    await open()
    await actions.generateWorkshopDraft(form)
    storyWorkshop.approveStoryVersion.mockRejectedValueOnce(new ApiError('timeout', { status: 504 }))
    let finishLookup
    books.getStoryVersion.mockImplementationOnce(() => new Promise(resolve => { finishLookup = resolve }))
    const approving = actions.approveWorkshopDraft()
    await vi.waitFor(() => expect(finishLookup).toBeTypeOf('function'))
    await actions.signOut()
    finishLookup({ ...draft, status: 'APPROVED_PRIVATE' })
    expect(await approving).toBe(false)
    expect(state.workshop.draft).toBeNull()
    expect(state.workshop.approvedVersion).toBeNull()
  })

  it('discards a shelf refresh that finishes after logout', async () => {
    await open()
    await actions.generateWorkshopDraft(form)
    storyWorkshop.approveStoryVersion.mockResolvedValueOnce({ ...draft, status: 'APPROVED_PRIVATE' })
    await actions.approveWorkshopDraft()
    let finishCatalog
    books.listStorybooks.mockImplementationOnce(() => new Promise(resolve => { finishCatalog = resolve }))
    const opening = actions.openApprovedPrivateShelf()
    await vi.waitFor(() => expect(finishCatalog).toBeTypeOf('function'))
    await actions.signOut()
    finishCatalog([])
    expect(await opening).toBe(false)
    expect(state.books.some(book => book.id === 'version-' + draft.storyVersionId)).toBe(false)
    expect(window.location.hash).not.toBe('#library')
  })

  it('reloads stale progress and waits for the guardian before generating again', async () => {
    books.getStoryVersion.mockResolvedValue({ ...draft, status: 'RETIRED' })
    await open('workshop/continue/55')
    reading.getReadingSession.mockResolvedValue({ session: {
      ...sourceSession, revision: 5, currentPage: 3, visitedPageNumbers: [1, 2, 3],
    } })
    storyWorkshop.generateStory.mockRejectedValueOnce(new ApiError('进度已更新', { status: 409, code: 'CONTINUATION_STALE' }))
    expect(await actions.generateWorkshopDraft(form)).toBe(false)
    expect(state.workshop.continuation.session.revision).toBe(5)
    expect(state.workshop.continuation.resumePageNumber).toBe(4)
    expect(storyWorkshop.generateStory).toHaveBeenCalledTimes(1)
    expect(await actions.generateWorkshopDraft(form)).toBe(true)
    const [first, second] = storyWorkshop.generateStory.mock.calls
    expect(second[0]).toMatchObject({ expectedRevision: 5, sourceReadingSessionId: 55 })
    expect(second[0].clientRequestId).not.toBe(first[0].clientRequestId)
  })

  it('rejects a retired public library version on the continuation route', async () => {
    reading.getReadingSession.mockResolvedValue({ session: { ...sourceSession, sourceType: 'LIBRARY' } })
    books.getStoryVersion.mockResolvedValue({ ...draft, status: 'RETIRED' })
    await open('workshop/continue/55')
    expect(state.workshop.continuation).toBeNull()
    expect(state.workshop.continuationError).toBeTruthy()
    expect(storyWorkshop.generateStory).not.toHaveBeenCalled()
  })

  it('continues from the frozen session revision and switches to the approved resume page', async () => {
    profiles.listProfiles.mockResolvedValue([
      { childProfileId: 8, nickname: '小松', ageBand: 'AGE_3_4' },
      { childProfileId: 7, nickname: '小芽', ageBand: 'AGE_4_5' },
    ])
    books.getStoryVersion.mockResolvedValue({
      ...draft,
      storyVersionId: 30,
      status: 'APPROVED_PRIVATE',
    })
    await open('workshop/continue/55')
    expect(state.activeProfileId).toBe(8)
    expect(state.workshop.continuation.session.revision).toBe(4)

    await actions.generateWorkshopDraft(form)
    const generation = storyWorkshop.generateStory.mock.calls[0][0]
    expect(generation).toMatchObject({
      sourceReadingSessionId: 55,
      expectedRevision: 4,
      topic: '友谊',
      branching: true,
    })
    expect(generation).not.toHaveProperty('ageBand')

    const approved = {
      ...draft,
      storyVersionId: 32,
      status: 'APPROVED_PRIVATE',
      continuation: {
        sourceReadingSessionId: 55,
        sourceRevision: 4,
        resumePageNumber: 3,
      },
    }
    storyWorkshop.approveStoryVersion.mockResolvedValue(approved)
    await actions.approveWorkshopDraft()
    expect(await actions.switchWorkshopContinuation()).toBe(true)
    expect(reading.createReadingSession).toHaveBeenCalledWith({
      childProfileId: 7,
      storyVersionId: 32,
      mode: 'PARENT_CHILD',
      sourceReadingSessionId: 55,
      expectedRevision: 4,
      clientRequestId: expect.stringMatching(/^switch-/),
    })
    expect(window.location.hash).toBe('#reader/77')
  })
})
