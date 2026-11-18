import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import AuthPage from './AuthPage.vue'
import AccountPage from './AccountPage.vue'
import BookDetailPage from './BookDetailPage.vue'
import HomePage from './HomePage.vue'
import LibraryPage from './LibraryPage.vue'
import ChildModePage from './ChildModePage.vue'
import { mapApiBook } from '../data/preview'

const wrappers = []
const render = (component, props) => { const wrapper = mount(component, { props, global: { stubs: { BookCarousel: true } } }); wrappers.push(wrapper); return wrapper }
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
afterEach(() => { wrappers.splice(0).forEach((wrapper) => wrapper.unmount()); localStorage.clear() })

describe('forms wait for completion', () => {
  it.each(['login', 'register'])('prevents duplicate %s and retains fields after failure', async (mode) => {
    const request = deferred()
    const action = vi.fn().mockReturnValue(request.promise)
    const wrapper = render(AuthPage, { login: action, register: action, health: 'ready' })
    if (mode === 'register') await wrapper.findAll('.auth-tabs button')[1].trigger('click')
    await wrapper.find('input[autocomplete="username"]').setValue('parent-test')
    await wrapper.find('input[type="password"]').setValue('password123')
    await wrapper.find('form').trigger('submit')
    await wrapper.find('form').trigger('submit')
    expect(action).toHaveBeenCalledTimes(1)
    expect(wrapper.find('button[type="submit"]').element.disabled).toBe(true)
    request.reject(new Error('网络不可用'))
    await flushPromises()
    expect(wrapper.find('.form-error').text()).toContain('网络不可用')
    expect(wrapper.find('input[autocomplete="username"]').element.value).toBe('parent-test')
    expect(wrapper.find('button[type="submit"]').element.disabled).toBe(false)
  })

  it('keeps profile editor open while saving and on error, then closes on success', async () => {
    const request = deferred()
    const save = vi.fn().mockReturnValueOnce(request.promise).mockResolvedValueOnce({ childProfileId: 2 })
    const wrapper = render(AccountPage, { section: 'children', auth: { nickname: '家长' }, totals: { read: 0, pages: 0, sessions: 0 }, saveProfileAction: save })
    await wrapper.findAll('button').find((button) => button.text() === '添加孩子').trigger('click')
    await wrapper.find('form input').setValue('小芽')
    await wrapper.find('form').trigger('submit')
    await wrapper.find('form').trigger('submit')
    expect(save).toHaveBeenCalledTimes(1)
    expect(wrapper.find('form button[type="submit"]').element.disabled).toBe(true)
    expect(wrapper.find('form button[type="button"]').element.disabled).toBe(true)
    request.reject(new Error('暂时无法保存'))
    await flushPromises()
    expect(wrapper.find('form').exists()).toBe(true)
    expect(wrapper.find('[role="alert"]').text()).toBe('暂时无法保存')
    expect(wrapper.find('form input').element.value).toBe('小芽')
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(wrapper.find('form').exists()).toBe(false)
  })

  it('confirms profile deletion and waits for the backend action', async () => {
    const remove = vi.fn().mockResolvedValue(true)
    const wrapper = render(AccountPage, {
      section: 'children',
      auth: { nickname: '家长', authenticated: true },
      profiles: [{ childProfileId: 2, nickname: '小芽', ageBand: 'AGE_4_5', interests: [], preferredMinutes: 15 }],
      activeProfileId: 2,
      totals: { read: 0, pages: 0, sessions: 0 },
      saveProfileAction: vi.fn(),
      deleteProfileAction: remove,
    })
    await wrapper.findAll('button').find((button) => button.text() === '删除档案').trigger('click')
    expect(wrapper.get('[role="dialog"]').text()).toContain('小芽')
    await wrapper.findAll('button').find((button) => button.text().includes('确认删除')).trigger('click')
    await flushPromises()
    expect(remove).toHaveBeenCalledWith(2)
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
  })

  it('confirms reading-history deletion without removing successful-row state early', async () => {
    const request = deferred()
    const remove = vi.fn().mockReturnValue(request.promise)
    const wrapper = render(AccountPage, {
      section: 'growth',
      auth: { nickname: '家长', authenticated: true },
      books: [{ storyVersionId: 88, title: '测试绘本' }],
      sessions: [{ readingSessionId: 7, storyVersionId: 88, visitedPageNumbers: [1], status: 'FINISHED', revision: 2 }],
      totals: { read: 1, pages: 1, sessions: 1 },
      saveProfileAction: vi.fn(),
      deleteSessionAction: remove,
    })
    await wrapper.findAll('button').find((button) => button.text() === '删除记录').trigger('click')
    await wrapper.findAll('button').find((button) => button.text().includes('确认删除')).trigger('click')
    expect(remove).toHaveBeenCalledWith(7)
    expect(wrapper.find('[role="dialog"]').exists()).toBe(true)
    request.resolve(true)
    await flushPromises()
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
  })
})

describe('child-mode parent unlock', () => {
  it('requires the guardian password and delegates unlock to the backend action', async () => {
    const request = deferred()
    const unlock = vi.fn().mockReturnValue(request.promise)
    const wrapper = render(ChildModePage, {
      childMode: { sessionId: 9, allowedStoryVersionIds: [88], expiresAt: new Date(Date.now() + 600000).toISOString() },
      book: { title: '测试绘本' },
      auth: { account: 'parent-a' },
      unlockAction: unlock,
    })
    const form = wrapper.get('.child-handoff-unlock')
    await form.find('input[type="password"]').setValue('password123')
    await form.trigger('submit')
    await form.trigger('submit')
    expect(unlock).toHaveBeenCalledTimes(1)
    expect(unlock).toHaveBeenCalledWith('parent-a', 'password123')
    expect(wrapper.get('.child-handoff-unlock button').element.disabled).toBe(true)
    request.resolve(true)
    await flushPromises()
    expect(wrapper.get('.child-handoff-unlock button').element.disabled).toBe(false)
  })
})

describe('real book metadata', () => {
  it('does not borrow author, cover, age or questions from preview books', () => {
    const book = mapApiBook({ storybookId: 101, storyVersionId: 88, title: '后端绘本', status: 'PUBLISHED', pages: [{ pageNumber: 1, text: '真实内容', imageRef: 'page-key' }] })
    expect(book.author).toBe('作者信息暂缺')
    expect(book.ageLabel).toBe('适龄信息暂缺')
    expect(book.cover).toBe('/assets/image-placeholder.svg')
    expect(book.pages[0].question).toBeUndefined()
    expect(book.pages[0].imageRef).toBe('page-key')
    expect(book.topics).toEqual([])
  })

  it.each([['PUBLISHED', '公开已发布'], ['APPROVED_PRIVATE', '本人已审核私有绘本']])('shows the correct %s status', (status, label) => {
    const wrapper = render(BookDetailPage, { book: mapApiBook({ storyVersionId: 88, title: '绘本', status, pages: [] }) })
    expect(wrapper.text()).toContain(label)
  })

  it.each([HomePage, LibraryPage])('does not label a private approved book as public in the catalogue', (component) => {
    const book = mapApiBook({ storyVersionId: 88, title: '私有绘本', status: 'APPROVED_PRIVATE', pages: [] })
    const wrapper = render(component, { books: [book], auth: { authenticated: true } })
    expect(wrapper.text()).toContain('本人已审核私有绘本')
    expect(wrapper.text()).not.toContain('公开已发布')
  })
})
