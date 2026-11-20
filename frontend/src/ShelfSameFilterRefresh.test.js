import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { ApiError } from './api/client'
import { listProfiles } from './api/profiles'
import { getStoryVersion, listStorybooks } from './api/storybooks'
import { createReadingSession } from './api/reading'

vi.mock('./api/auth', () => ({ checkHealth: vi.fn(), login: vi.fn(), parentUnlock: vi.fn() }))
vi.mock('./api/profiles', () => ({ listProfiles: vi.fn(async () => []), deleteProfile: vi.fn() }))
vi.mock('./api/storybooks', () => ({ getStoryVersion: vi.fn(), listStorybooks: vi.fn() }))
vi.mock('./api/reading', () => ({ getReadingSession: vi.fn(), addReadingEvent: vi.fn(), createReadingSession: vi.fn(), deleteReadingSession: vi.fn(), getDeletionStatus: vi.fn(), listReadingSessions: vi.fn(), updateReadingMode: vi.fn() }))

const withdrawnBook = { storyVersionId: 88, title: '已下架的绘本', status: 'PUBLISHED' }
const availableBook = { ...withdrawnBook, storyVersionId: 89, title: '仍可阅读的绘本' }
const oldShelf = [withdrawnBook, availableBook]
const allQuery = { page: 1, pageSize: 30, ageBand: undefined, topic: undefined }
let wrapper

beforeEach(() => {
  vi.resetModules()
  vi.resetAllMocks()
  localStorage.clear()
  sessionStorage.clear()
  localStorage.setItem('zhiya.account', 'parent-a')
  listProfiles.mockResolvedValue([{ childProfileId: 7 }])
})

afterEach(() => wrapper?.unmount())

it.each(['details', 'reading creation'])('refreshes the same shelf after a pending %s request returns 404', async (request) => {
  let rejectRequest
  let finishOldShelf
  const pendingRequest = new Promise((_, reject) => { rejectRequest = reject })
  listStorybooks.mockResolvedValueOnce(oldShelf)
    .mockReturnValueOnce(new Promise((resolve) => { finishOldShelf = resolve }))
    .mockResolvedValue([availableBook])
  if (request === 'details') getStoryVersion.mockReturnValueOnce(pendingRequest)
  else createReadingSession.mockReturnValueOnce(pendingRequest)

  window.history.replaceState({}, '', request === 'details' ? '/#detail/88' : '/#library')
  const { default: App } = await import('./App.vue')
  wrapper = mount(App, { global: { stubs: { BookCarousel: true } } })
  await flushPromises()

  if (request === 'details') {
    expect(getStoryVersion).toHaveBeenCalledExactlyOnceWith(88)
    await wrapper.get('.detail-toolbar button').trigger('click')
    await vi.waitFor(() => expect(wrapper.find('.library-page').exists()).toBe(true))
  } else {
    await wrapper.findAll('button').find((button) => button.text() === '开始阅读').trigger('click')
    expect(createReadingSession).toHaveBeenCalledExactlyOnceWith({ storyVersionId: 88, childProfileId: 7 })
  }

  expect(listStorybooks.mock.calls).toEqual([[allQuery]])
  const all = wrapper.get('.library-category-chip.active')
  expect(all.text()).toBe('全部')
  await all.trigger('click')
  await flushPromises()
  expect(listStorybooks.mock.calls).toEqual([[allQuery], [allQuery]])

  rejectRequest(new ApiError('资源不可用', { status: 404, code: 'RESOURCE_NOT_FOUND' }))
  await flushPromises()
  finishOldShelf(oldShelf)
  await flushPromises()

  expect(listStorybooks.mock.calls).toEqual([[allQuery], [allQuery], [allQuery]])
  expect(wrapper.getComponent({ name: 'BookCarousel' }).props('books').map(({ storyVersionId }) => storyVersionId))
    .toEqual([89])
  expect(wrapper.get('.library-feature-copy h2').text()).toBe(availableBook.title)
  expect(wrapper.text()).not.toContain(withdrawnBook.title)
})

it('restores saved book 63 after reselecting All during the initial shelf restore', async () => {
  localStorage.setItem('zhiya.selectedBookId', 'version-63')
  const catalog = Array.from({ length: 63 }, (_, index) => ({
    ...availableBook,
    storyVersionId: index + 1,
    title: '绘本' + (index + 1),
  }))
  let finishInitialPage
  listStorybooks.mockReturnValueOnce(new Promise((resolve) => { finishInitialPage = resolve }))
    .mockImplementation(async ({ page, pageSize }) => catalog.slice((page - 1) * pageSize, page * pageSize))

  window.history.replaceState({}, '', '/#library')
  const { default: App } = await import('./App.vue')
  wrapper = mount(App, { global: { stubs: { BookCarousel: true } } })
  await flushPromises()
  expect(listStorybooks.mock.calls).toEqual([[allQuery]])

  const all = wrapper.get('.library-category-chip.active')
  expect(all.text()).toBe('全部')
  await all.trigger('click')
  await flushPromises()

  expect(listStorybooks.mock.calls).toEqual([1, 1, 2, 3].map((page) => [{ ...allQuery, page }]))
  expect(wrapper.get('.library-feature-copy h2').text()).toBe('绘本63')

  finishInitialPage(catalog.slice(0, 30))
  await flushPromises()
  expect(listStorybooks).toHaveBeenCalledTimes(4)
  expect(wrapper.get('.library-feature-copy h2').text()).toBe('绘本63')
  expect(localStorage.getItem('zhiya.selectedBookId')).toBe('version-63')
})

it('keeps restored book 63 after reselecting All once the initial shelf restore completes', async () => {
  localStorage.setItem('zhiya.selectedBookId', 'version-63')
  const catalog = Array.from({ length: 63 }, (_, index) => ({
    ...availableBook,
    storyVersionId: index + 1,
    title: '绘本' + (index + 1),
  }))
  listStorybooks.mockImplementation(async ({ page, pageSize }) => catalog.slice((page - 1) * pageSize, page * pageSize))

  window.history.replaceState({}, '', '/#library')
  const { default: App } = await import('./App.vue')
  wrapper = mount(App, { global: { stubs: { BookCarousel: true } } })
  await flushPromises()

  expect(listStorybooks.mock.calls).toEqual([1, 2, 3].map((page) => [{ ...allQuery, page }]))
  expect(wrapper.get('.library-feature-copy h2').text()).toBe('绘本63')
  const all = wrapper.get('.library-category-chip.active')
  expect(all.text()).toBe('全部')
  await all.trigger('click')
  await flushPromises()

  expect(listStorybooks.mock.calls).toEqual([1, 2, 3, 1, 2, 3].map((page) => [{ ...allQuery, page }]))
  expect(wrapper.get('.library-feature-copy h2').text()).toBe('绘本63')
  expect(localStorage.getItem('zhiya.selectedBookId')).toBe('version-63')
})
