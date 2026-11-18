import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { ApiError } from './api/client'
import { getStoryVersion, listStorybooks } from './api/storybooks'
import { addReadingEvent, getReadingSession, listReadingSessions } from './api/reading'
import { listProfiles } from './api/profiles'

vi.mock('./api/auth', () => ({ checkHealth: vi.fn() }))
vi.mock('./api/profiles', () => ({ listProfiles: vi.fn(async () => []) }))
vi.mock('./api/storybooks', () => ({ getStoryVersion: vi.fn(), listStorybooks: vi.fn() }))
vi.mock('./api/reading', () => ({ getReadingSession: vi.fn(), addReadingEvent: vi.fn(), listReadingSessions: vi.fn() }))

const book = { storyVersionId: 88, title: '书架上的绘本', status: 'PUBLISHED', pages: [{ pageNumber: 1, text: '只在授权时可读的正文' }] }
const missing = () => new ApiError('资源不可用', { status: 404, code: 'RESOURCE_NOT_FOUND' })
let wrapper

async function open(path) {
  window.history.replaceState({}, '', '/#' + path)
  const { default: App } = await import('./App.vue')
  const flipBook = { template: '<div />', methods: { showPage() {} } }
  wrapper = mount(App, { global: { stubs: { BookCarousel: true, FlipBook: flipBook } } })
  await flushPromises()
}

beforeEach(() => {
  vi.resetModules()
  vi.resetAllMocks()
  localStorage.clear()
  sessionStorage.clear()
  listStorybooks.mockResolvedValue([book])
  listReadingSessions.mockResolvedValue([])
})
afterEach(() => wrapper?.unmount())

it('hides withdrawn details and removes the stale version when returning to the library', async () => {
  getStoryVersion.mockRejectedValueOnce(missing())
  await open('detail/88')
  expect(getStoryVersion).toHaveBeenCalledWith(88)
  expect(wrapper.text()).toContain('绘本暂不可用')
  expect(wrapper.text()).not.toContain(book.pages[0].text)
  expect(wrapper.text()).not.toContain('开始阅读')
  await wrapper.get('.detail-toolbar button').trigger('click')
  await vi.waitFor(() => expect(wrapper.find('.library-page').exists()).toBe(true))
  expect(wrapper.text()).not.toContain(book.title)
})

it('allows an explicitly labelled local preview to open without fetching API details', async () => {
  listStorybooks.mockResolvedValue([])
  await open('detail/1001')
  expect(wrapper.get('.detail-card').text()).toContain('设计预览')
  expect(getStoryVersion).not.toHaveBeenCalled()
})

it('returns from an unavailable session to the library', async () => {
  getReadingSession.mockRejectedValueOnce(missing())
  await open('reader/999')
  const empty = wrapper.get('.reader-page .empty-state')
  expect(empty.text()).toContain('阅读会话暂时不可用')
  await empty.get('button').trigger('click')
  await vi.waitFor(() => expect(wrapper.find('.library-page').exists()).toBe(true))
  expect(location.hash).toBe('#library')
})

it('lets the user explicitly start again if a terminal 504 left the session in CREATED', async () => {
  const created = { readingSessionId: 55, storyVersionId: 88, currentPage: 1, revision: 0, status: 'CREATED', visitedPageNumbers: [] }
  getReadingSession.mockResolvedValue({ session: created, events: [], report: null })
  addReadingEvent.mockRejectedValueOnce(new ApiError('unknown', { status: 504, code: 'REQUEST_OUTCOME_UNKNOWN' }))
    .mockResolvedValueOnce({ revision: 1 })
  await open('reader/55')
  expect(addReadingEvent).not.toHaveBeenCalled()
  await wrapper.get('.reader-heading button.primary').trigger('click')
  await flushPromises()
  const writes = addReadingEvent.mock.calls.map(([, event]) => event)
  expect(writes).toHaveLength(1)
  expect(writes[0]).toMatchObject({ eventType: 'STARTED', expectedRevision: 0, pageNumber: 1 })
  expect(wrapper.text()).toContain('开始本次阅读')
  await wrapper.get('.reader-heading button.primary').trigger('click')
  await flushPromises()
  expect(addReadingEvent).toHaveBeenCalledTimes(2)
  expect(addReadingEvent.mock.calls[1][1].clientEventId).not.toBe(addReadingEvent.mock.calls[0][1].clientEventId)
  expect(wrapper.text()).not.toContain('开始本次阅读')
})

it('routes a child credential to the restricted handoff even from the home route', async () => {
  listProfiles.mockRejectedValue(new ApiError('需要儿童授权', { status: 403, code: 'FORBIDDEN' }))
  await open('home')
  expect(listProfiles).toHaveBeenCalled()
  await vi.waitFor(() => expect(location.hash).toBe('#child'))
  expect(wrapper.find('.child-handoff-page').exists()).toBe(true)
  expect(wrapper.find('.site-header').exists()).toBe(false)
  expect(listStorybooks).not.toHaveBeenCalled()
})

it('routes a guardian credential away from a stale child handoff link', async () => {
  await open('child/99')
  expect(location.hash).toBe('#account/overview')
  expect(wrapper.find('.child-handoff-page').exists()).toBe(false)
  expect(wrapper.find('.site-header').exists()).toBe(true)
})
