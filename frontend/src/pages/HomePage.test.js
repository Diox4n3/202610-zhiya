import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import HomePage from './HomePage.vue'

const books = [
  { id: 'book-1', title: '第一本', cover: '/one.png', topics: [], pages: [] },
  { id: 'book-2', title: '第二本', cover: '/two.png', topics: [], pages: [] },
  { id: 'book-3', title: '第三本', cover: '/three.png', topics: [], pages: [] },
]

const render = (selectedBookId = '') => mount(HomePage, {
  props: {
    books,
    selectedBookId,
    auth: { authenticated: false },
  },
})

afterEach(() => {
  vi.useRealTimers()
})

describe('home featured book', () => {
  it('cycles the open-book cover and information until the reader selects a book', async () => {
    vi.useFakeTimers()
    const wrapper = render()
    expect(wrapper.get('.hero-book-cover img').attributes('src')).toBe('/one.png')
    expect(wrapper.get('.home-info-card h2').text()).toBe('第一本')

    await vi.advanceTimersByTimeAsync(3600)
    expect(wrapper.get('.hero-book-cover img').attributes('src')).toBe('/two.png')
    expect(wrapper.get('.home-info-card h2').text()).toBe('第二本')
    expect(wrapper.get('.shelf-showcase-book.featured img').attributes('src')).toBe('/two.png')
    expect(wrapper.emitted('select')).toBeUndefined()

    await wrapper.get('.shelf-arrow-hit.next').trigger('click')
    expect(wrapper.emitted('select')?.at(-1)).toEqual(['book-3'])
    await wrapper.get('.shelf-showcase-book.featured').trigger('click')
    expect(wrapper.emitted('select')?.at(-1)).toEqual(['book-2'])
    await wrapper.setProps({ selectedBookId: 'book-2' })

    await vi.advanceTimersByTimeAsync(7200)
    expect(wrapper.get('.hero-book-cover img').attributes('src')).toBe('/two.png')
    expect(wrapper.get('.home-info-card h2').text()).toBe('第二本')
    wrapper.unmount()
  })

  it('pauses the carousel until hover and keyboard focus both leave the recommendations', async () => {
    vi.useFakeTimers()
    const wrapper = render()
    const info = wrapper.get('.home-info-card')
    const cover = wrapper.get('.hero-book-cover')
    const arrow = wrapper.get('.shelf-arrow-hit.next')

    await info.trigger('mouseenter')
    await vi.advanceTimersByTimeAsync(3600)
    expect(wrapper.get('.hero-book-cover img').attributes('src')).toBe('/one.png')

    await cover.trigger('focusin')
    await info.trigger('mouseleave')
    await vi.advanceTimersByTimeAsync(3600)
    expect(wrapper.get('.hero-book-cover img').attributes('src')).toBe('/one.png')

    await cover.trigger('focusout', { relatedTarget: arrow.element })
    await arrow.trigger('focusin', { relatedTarget: cover.element })
    await vi.advanceTimersByTimeAsync(3600)
    expect(wrapper.get('.hero-book-cover img').attributes('src')).toBe('/one.png')

    await arrow.trigger('focusout')
    await vi.advanceTimersByTimeAsync(3600)
    expect(wrapper.get('.hero-book-cover img').attributes('src')).toBe('/two.png')
    wrapper.unmount()
  })
})
