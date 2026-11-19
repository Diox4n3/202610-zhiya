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

    await wrapper.get('.shelf-showcase-book.featured').trigger('click')
    expect(wrapper.emitted('select')?.at(-1)).toEqual(['book-1'])
    await wrapper.setProps({ selectedBookId: 'book-1' })

    await vi.advanceTimersByTimeAsync(7200)
    expect(wrapper.get('.hero-book-cover img').attributes('src')).toBe('/one.png')
    expect(wrapper.get('.home-info-card h2').text()).toBe('第一本')
    wrapper.unmount()
  })
})
