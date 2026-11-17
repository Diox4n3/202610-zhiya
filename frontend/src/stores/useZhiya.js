import { computed, reactive, readonly } from 'vue'
import { ApiError, createClientEventId } from '../api/client'
import { checkHealth, login, logout, register } from '../api/auth'
import { createProfile, listProfiles, updateProfile } from '../api/profiles'
import { getStoryVersion, listStorybooks } from '../api/storybooks'
import {
  addReadingEvent,
  completeReadingSession,
  createReadingSession,
  getReadingSession,
  listReadingSessions,
} from '../api/reading'
import { previewBooks, mapApiBook } from '../data/preview'

function parseRoute() {
  const parts = location.hash.replace(/^#/, '').split('/').filter(Boolean)
  const name = parts[0] || 'home'
  if (name === 'account') return { name, section: parts[1] || 'overview' }
  if (name === 'detail') return { name, versionId: Number(parts[1]) || null }
  if (name === 'reader' && parts[1] === 'preview') return { name, previewVersionId: Number(parts[2]) || null }
  if (name === 'reader') return { name, sessionId: Number(parts[1]) || null }
  if (['library', 'auth'].includes(name)) return { name }
  return { name: 'home' }
}

const savedProfileId = Number(localStorage.getItem('zhiya.activeProfileId') || 0)
const savedNickname = localStorage.getItem('zhiya.guardianNickname') || '知芽家长'

const state = reactive({
  route: parseRoute(),
  health: 'checking',
  auth: {
    status: 'checking',
    authenticated: false,
    accountId: null,
    account: localStorage.getItem('zhiya.account') || '',
    nickname: savedNickname,
  },
  profiles: [],
  activeProfileId: savedProfileId,
  books: previewBooks,
  booksSource: 'preview',
  booksLoading: false,
  booksError: '',
  bookFilters: { ageBand: '', topic: '' },
  selectedBookId: localStorage.getItem('zhiya.selectedBookId') || previewBooks[0].id,
  currentBook: null,
  detailLoading: false,
  currentSession: null,
  currentEvents: [],
  currentReport: null,
  sessionLoading: false,
  sessions: [],
  sessionsLoading: false,
  toast: { message: '', tone: 'info', visible: false },
})

let toastTimer = null

function activeProfile() {
  return state.profiles.find((profile) => profile.childProfileId === state.activeProfileId) || state.profiles[0] || null
}

function setToast(message, tone = 'info') {
  state.toast.message = message
  state.toast.tone = tone
  state.toast.visible = true
  clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => {
    state.toast.visible = false
  }, 2800)
}

function navigate(path) {
  const target = `#${String(path).replace(/^#/, '')}`
  if (location.hash === target) {
    state.route = parseRoute()
  } else {
    location.hash = target
  }
}

function updateBodyView() {
  document.body.dataset.view = state.route.name
}

function applyBooks(items, source, message = '') {
  state.books = items
  state.booksSource = source
  state.booksError = message
  if (!items.some((book) => book.id === state.selectedBookId)) {
    state.selectedBookId = items[0]?.id || ''
  }
}

function loadPreviewBooks(message = '') {
  const { ageBand, topic } = state.bookFilters
  const filtered = previewBooks.filter((book) => {
    if (ageBand && book.ageBand !== ageBand) return false
    if (topic && !book.topics.includes(topic)) return false
    return true
  })
  applyBooks(filtered, 'preview', message)
}

async function loadBooks(filters = {}) {
  state.bookFilters = { ...state.bookFilters, ...filters }
  state.booksLoading = true
  state.booksError = ''
  try {
    if (!state.auth.authenticated) {
      loadPreviewBooks('登录后可读取组内已发布绘本，当前展示本地设计预览。')
      return
    }
    const items = await listStorybooks({
      ageBand: state.bookFilters.ageBand || undefined,
      topic: state.bookFilters.topic || undefined,
    })
    if (!items.length && !state.bookFilters.ageBand && !state.bookFilters.topic) {
      loadPreviewBooks('后端当前没有可见的已发布绘本，当前展示本地设计预览。')
      return
    }
    applyBooks(items.map(mapApiBook), 'api')
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      state.auth.status = 'anonymous'
      state.auth.authenticated = false
      loadPreviewBooks('登录后读取后端绘本，当前展示本地设计预览。')
    } else {
      loadPreviewBooks(error.message || '绘本列表暂时不可用，已切换到本地预览。')
    }
  } finally {
    state.booksLoading = false
  }
}

async function loadProfiles() {
  const items = await listProfiles()
  state.profiles = items
  if (!items.some((profile) => profile.childProfileId === state.activeProfileId)) {
    state.activeProfileId = items[0]?.childProfileId || 0
  }
  localStorage.setItem('zhiya.activeProfileId', String(state.activeProfileId))
  return items
}

async function bootstrap() {
  try {
    await checkHealth()
    state.health = 'ready'
  } catch {
    state.health = 'offline'
  }
  try {
    await loadProfiles()
    state.auth.status = 'authenticated'
    state.auth.authenticated = true
    await loadBooks()
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      state.auth.status = 'anonymous'
    } else {
      state.auth.status = 'unavailable'
      state.booksError = error.message || '后端暂不可用'
    }
    state.auth.authenticated = false
    loadPreviewBooks(state.health === 'offline' ? '后端暂未启动，当前展示本地设计预览。' : '登录后读取后端绘本，当前展示本地设计预览。')
  }
  await handleRoute()
}

async function signIn(account, password) {
  const result = await login(account, password)
  state.auth.accountId = result.data.accountId
  state.auth.account = account
  state.auth.authenticated = true
  state.auth.status = 'authenticated'
  localStorage.setItem('zhiya.account', account)
  await loadProfiles()
  await loadBooks()
  setToast('已登录知芽家长空间')
  navigate(state.books.length ? 'library' : 'account/children')
}

async function signUp(account, password) {
  await register(account, password)
  await signIn(account, password)
  setToast('账号已创建并登录')
}

async function signOut() {
  try {
    await logout()
  } catch {}
  state.auth = {
    status: 'anonymous',
    authenticated: false,
    accountId: null,
    account: '',
    nickname: '知芽家长',
  }
  state.profiles = []
  state.activeProfileId = 0
  state.sessions = []
  state.currentSession = null
  loadPreviewBooks('已退出账号，当前展示本地设计预览。')
  localStorage.removeItem('zhiya.account')
  navigate('home')
  setToast('已退出当前账号')
}

function selectProfile(profileId) {
  state.activeProfileId = Number(profileId)
  localStorage.setItem('zhiya.activeProfileId', String(state.activeProfileId))
  setToast(`已切换到${activeProfile()?.nickname || '孩子的'}阅读空间`)
}

async function addProfile(payload) {
  const profile = await createProfile(payload)
  await loadProfiles()
  selectProfile(profile.childProfileId)
  setToast('儿童档案已创建')
  return profile
}

async function editProfile(profileId, payload) {
  const profile = await updateProfile(profileId, payload)
  await loadProfiles()
  setToast('儿童档案已更新')
  return profile
}

function selectBook(bookId) {
  if (!state.books.some((book) => book.id === bookId)) return
  state.selectedBookId = bookId
  localStorage.setItem('zhiya.selectedBookId', bookId)
}

function openDetail(bookOrVersionId) {
  const versionId = Number(bookOrVersionId?.storyVersionId || bookOrVersionId)
  if (versionId) navigate(`detail/${versionId}`)
}

async function loadDetail(versionId) {
  state.detailLoading = true
  state.currentBook = null
  try {
    const cached = state.books.find((book) => book.storyVersionId === Number(versionId))
    if (cached?.source === 'preview') {
      state.currentBook = cached
      return
    }
    const version = await getStoryVersion(Number(versionId))
    state.currentBook = mapApiBook(version)
  } catch (error) {
    setToast(error.message || '绘本详情暂时不可用', 'error')
  } finally {
    state.detailLoading = false
  }
}

async function startReading(book) {
  if (!book) return
  state.currentBook = book
  state.currentEvents = []
  state.currentReport = null
  if (book.source === 'preview' || !state.auth.authenticated) {
    state.currentSession = {
      preview: true,
      readingSessionId: `preview-${book.storyVersionId}`,
      storyVersionId: book.storyVersionId,
      currentPage: 1,
      visitedPageNumbers: [1],
      status: 'IN_PROGRESS',
      revision: 1,
    }
    navigate(`reader/preview/${book.storyVersionId}`)
    return
  }
  const profile = activeProfile()
  if (!profile) {
    setToast('请先为孩子创建阅读档案', 'error')
    navigate('account/children')
    return
  }
  try {
    const created = await createReadingSession({
      childProfileId: profile.childProfileId,
      storyVersionId: book.storyVersionId,
    })
    const started = await addReadingEvent(created.readingSessionId, {
      eventType: 'STARTED',
      pageNumber: 1,
      expectedRevision: created.revision,
      clientEventId: createClientEventId('start'),
    })
    state.currentSession = {
      ...created,
      status: 'IN_PROGRESS',
      currentPage: 1,
      visitedPageNumbers: [1],
      revision: started.revision,
    }
    navigate(`reader/${created.readingSessionId}`)
  } catch (error) {
    setToast(error.message || '无法创建阅读会话', 'error')
  }
}

async function loadReaderRoute() {
  state.sessionLoading = true
  state.currentEvents = []
  state.currentReport = null
  try {
    if (state.route.previewVersionId) {
      const book = previewBooks.find((item) => item.storyVersionId === state.route.previewVersionId)
      if (!book) throw new Error('本地预览绘本不可用')
      state.currentBook = book
      state.currentSession = {
        preview: true,
        readingSessionId: `preview-${book.storyVersionId}`,
        storyVersionId: book.storyVersionId,
        currentPage: 1,
        visitedPageNumbers: [1],
        status: 'IN_PROGRESS',
        revision: 1,
      }
      return
    }
    if (!state.route.sessionId) return
    const detail = await getReadingSession(state.route.sessionId)
    state.currentSession = detail.session
    state.currentEvents = detail.events
    state.currentReport = detail.report
    const cached = state.books.find((book) => book.storyVersionId === detail.session.storyVersionId)
    state.currentBook = cached || mapApiBook(await getStoryVersion(detail.session.storyVersionId))
  } catch (error) {
    setToast(error.message || '阅读会话不可用', 'error')
    state.currentSession = null
  } finally {
    state.sessionLoading = false
  }
}

async function recordPageChange(pageNumber) {
  const session = state.currentSession
  if (!session || pageNumber <= session.currentPage) return
  if (session.preview) {
    session.currentPage = pageNumber
    session.visitedPageNumbers = [...new Set([...session.visitedPageNumbers, pageNumber])]
    session.revision += 1
    return
  }
  try {
    const result = await addReadingEvent(session.readingSessionId, {
      eventType: 'PAGE_CHANGED',
      pageNumber,
      expectedRevision: session.revision,
      clientEventId: createClientEventId('page'),
    })
    session.currentPage = pageNumber
    session.visitedPageNumbers = [...new Set([...session.visitedPageNumbers, pageNumber])]
    session.revision = result.revision
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) {
      const detail = await getReadingSession(session.readingSessionId)
      state.currentSession = detail.session
    }
    setToast(error.message || '阅读进度同步失败', 'error')
  }
}

async function completeReading() {
  const session = state.currentSession
  if (!session) return null
  if (session.preview) {
    session.status = 'FINISHED'
    state.currentReport = {
      status: 'READY',
      summary: `本次共读浏览了 ${session.visitedPageNumbers.length} 页，可在家长陪伴下继续交流故事内容。`,
      activities: [],
    }
    setToast('本次预览阅读已完成')
    return state.currentReport
  }
  try {
    const result = await completeReadingSession(session.readingSessionId, {
      reason: 'USER_FINISH',
      expectedRevision: session.revision,
      clientEventId: createClientEventId('finish'),
    })
    state.currentSession = result.session
    state.currentReport = result.report
    setToast('阅读记录已保存')
    return result.report
  } catch (error) {
    setToast(error.message || '暂时无法结束阅读', 'error')
    return null
  }
}

async function loadSessions() {
  if (!state.auth.authenticated) {
    state.sessions = []
    return
  }
  state.sessionsLoading = true
  try {
    state.sessions = await listReadingSessions()
  } catch (error) {
    setToast(error.message || '阅读记录暂时不可用', 'error')
  } finally {
    state.sessionsLoading = false
  }
}

async function handleRoute() {
  updateBodyView()
  const route = state.route
  if (route.name === 'library') {
    if (state.auth.authenticated && state.booksSource !== 'api') await loadBooks()
  } else if (route.name === 'detail' && route.versionId) {
    await loadDetail(route.versionId)
  } else if (route.name === 'reader') {
    await loadReaderRoute()
  } else if (route.name === 'account') {
    await loadSessions()
  }
}

function syncRoute() {
  state.route = parseRoute()
  return handleRoute()
}

const totals = computed(() => {
  const read = new Set(state.sessions.map((item) => item.storyVersionId)).size
  const minutes = state.sessions.reduce((sum, item) => sum + Math.max(1, item.visitedPageNumbers?.length || 1), 0)
  return { read, minutes, sessions: state.sessions.length }
})

export const zhiya = readonly(state)
export const zhiyaActions = {
  bootstrap,
  navigate,
  syncRoute,
  signIn,
  signUp,
  signOut,
  selectProfile,
  addProfile,
  editProfile,
  loadProfiles,
  loadBooks,
  selectBook,
  openDetail,
  loadDetail,
  startReading,
  loadReaderRoute,
  recordPageChange,
  completeReading,
  loadSessions,
  setToast,
}
export { activeProfile, totals, parseRoute }
