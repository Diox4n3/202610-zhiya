<script setup>
import { computed, ref, watch } from 'vue'
import FlipBook from '../components/FlipBook.vue'
import { synthesize, transcribe } from '../api/voice'

const props = defineProps({
  book: { type: Object, default: null },
  session: { type: Object, default: null },
  report: { type: Object, default: null },
  loading: { type: Boolean, default: false },
  authenticated: { type: Boolean, default: false },
})

const emit = defineEmits(['back', 'record-page', 'complete'])
const flipBook = ref(null)
const pageIndex = ref(Math.max(0, (props.session?.currentPage || 1) - 1))
const audioStatus = ref('idle')
const audioMessage = ref('')
const voiceOpen = ref(false)
const voiceState = ref('idle')
const voiceError = ref('')
const transcript = ref('')
let recorder = null
let chunks = []

const currentPage = computed(() => props.book?.pages?.[pageIndex.value] || props.book?.pages?.[0] || null)
const isLast = computed(() => pageIndex.value >= (props.book?.pages?.length || 1) - 1)

watch(
  () => props.session?.currentPage,
  (pageNumber) => {
    if (pageNumber) pageIndex.value = Math.max(0, pageNumber - 1)
  },
  { immediate: true },
)

function onPageChange({ storyIndex }) {
  pageIndex.value = storyIndex
  audioStatus.value = 'idle'
  audioMessage.value = ''
  emit('record-page', props.book.pages[storyIndex]?.pageNumber || storyIndex + 1)
}

function goPrevious() {
  if (pageIndex.value > 0) flipBook.value?.flipPrev()
}

async function goNext() {
  if (isLast.value) {
    emit('complete')
    return
  }
  flipBook.value?.flipNext()
}

async function playNarration() {
  if (!currentPage.value) return
  if (audioStatus.value === 'playing') {
    document.querySelector('#zhiya-reader-audio')?.pause()
    audioStatus.value = 'idle'
    return
  }
  if (!props.session?.preview && props.authenticated && currentPage.value) {
    try {
      audioStatus.value = 'loading'
      audioMessage.value = '正在生成朗读'
      const data = await synthesize({
        readingSessionId: props.session.readingSessionId,
        pageNumber: currentPage.value.pageNumber,
        revision: props.session.revision,
      })
      const audio = new Audio(data.audioUrl)
      audio.id = 'zhiya-reader-audio'
      audio.onended = () => { audioStatus.value = 'idle'; audioMessage.value = '朗读完成' }
      audio.onerror = () => { audioStatus.value = 'error'; audioMessage.value = '播放失败，文字仍可阅读' }
      await audio.play()
      audioStatus.value = 'playing'
      audioMessage.value = `正在朗读第 ${currentPage.value.pageNumber} 页`
      return
    } catch (error) {
      audioStatus.value = 'error'
      audioMessage.value = error.message || '语音合成暂时不可用'
    }
  }
  if ('speechSynthesis' in window) {
    speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(currentPage.value.text)
    utterance.lang = 'zh-CN'
    utterance.rate = .92
    utterance.onend = () => { audioStatus.value = 'idle'; audioMessage.value = '朗读完成' }
    utterance.onerror = () => { audioStatus.value = 'error'; audioMessage.value = '浏览器朗读失败，文字仍可阅读' }
    audioStatus.value = 'playing'
    audioMessage.value = '正在使用浏览器朗读'
    speechSynthesis.speak(utterance)
  } else {
    audioStatus.value = 'error'
    audioMessage.value = '当前浏览器不支持语音播放'
  }
}

async function toggleRecording() {
  voiceError.value = ''
  if (voiceState.value === 'recording') {
    recorder?.stop()
    return
  }
  if (props.session?.preview || !props.authenticated) {
    voiceState.value = 'unavailable'
    voiceError.value = '当前是本地预览模式。登录并创建后端阅读会话后才能上传录音。'
    return
  }
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    voiceState.value = 'unavailable'
    voiceError.value = '当前浏览器不支持录音，请使用文字输入与孩子交流。'
    return
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    chunks = []
    recorder = new MediaRecorder(stream)
    recorder.ondataavailable = (event) => {
      if (event.data.size) chunks.push(event.data)
    }
    recorder.onstop = async () => {
      stream.getTracks().forEach((track) => track.stop())
      const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' })
      voiceState.value = 'processing'
      try {
        const result = await transcribe(blob, {
          readingSessionId: props.session.readingSessionId,
          pageNumber: currentPage.value.pageNumber,
          revision: props.session.revision,
        })
        transcript.value = result.text
        voiceState.value = result.reliable ? 'recognized' : 'uncertain'
      } catch (error) {
        voiceState.value = 'error'
        voiceError.value = error.message || '语音识别失败'
      }
    }
    recorder.start()
    voiceState.value = 'recording'
  } catch {
    voiceState.value = 'error'
    voiceError.value = '麦克风不可用，可以和孩子口头讨论当前问题。'
  }
}

function openVoice() {
  voiceOpen.value = true
  voiceState.value = 'idle'
  transcript.value = ''
  voiceError.value = ''
}

function closeVoice() {
  try { recorder?.stop() } catch {}
  voiceOpen.value = false
}
</script>

<template>
  <main v-if="loading" class="reader-page page-width">
    <div class="reader-loading"><div><div class="spinner" style="margin:0 auto 12px" /><p>正在恢复阅读会话…</p></div></div>
  </main>
  <main v-else-if="book && session" class="reader-page page-width">
    <div class="reader-heading">
      <div>
        <button class="text-button" type="button" @click="emit('back', book)">← 返回绘本详情</button>
        <h1>{{ book.title }}</h1>
        <p>第 {{ currentPage?.pageNumber }} / {{ book.pageCount }} 页 · {{ session.preview ? '本地预览' : '后端会话已同步' }}</p>
      </div>
      <span class="pill">{{ report ? '本次阅读已完成' : '亲子共读模式' }}</span>
    </div>

    <div class="reader-layout">
      <section class="reader-main">
        <div class="flipbook-stage">
          <FlipBook
            ref="flipBook"
            :pages="book.pages"
            :cover="book.cover"
            :title="book.title"
            :start-page="pageIndex"
            @page-change="onPageChange"
            @error="audioMessage = $event"
          />
          <p class="flip-hint">拖动书页边缘，或点击外侧翻页</p>
        </div>
        <nav class="reader-dock" aria-label="阅读控制">
          <button class="dock-button" type="button" :disabled="pageIndex === 0" @click="goPrevious"><span class="dock-glyph">‹</span>上一页</button>
          <button class="dock-button" type="button" @click="playNarration"><span class="dock-glyph">{{ audioStatus === 'playing' ? 'Ⅱ' : '▶' }}</span>{{ audioStatus === 'playing' ? '暂停朗读' : '朗读' }}</button>
          <button class="dock-button primary" type="button" @click="openVoice"><span class="dock-glyph">芽</span>问知芽</button>
          <button class="dock-button" type="button" @click="goNext"><span class="dock-glyph">{{ isLast ? '✓' : '›' }}</span>{{ isLast ? '完成' : '下一页' }}</button>
        </nav>
      </section>

      <aside class="reader-side">
        <div v-if="audioMessage" class="side-card audio">
          <div class="audio-line"><span>{{ audioMessage }}</span></div>
        </div>
        <section class="side-card question-card">
          <h2>✦ 共读小提问</h2>
          <p>{{ currentPage?.question }}</p>
          <div class="question-actions">
            <button class="secondary" type="button">已理解</button>
            <button class="secondary" type="button">还没懂</button>
            <button class="primary" type="button" @click="openVoice">孩子来回答</button>
          </div>
        </section>
        <section class="side-card parent-tip">
          <h2>给家长的共读提示</h2>
          <p>{{ currentPage?.answer }}</p>
        </section>
        <section v-if="report" class="side-card">
          <h2>本次共读小结</h2>
          <p class="address">{{ report.summary }}</p>
        </section>
      </aside>
    </div>

    <div v-if="voiceOpen" class="modal-backdrop" @click.self="closeVoice">
      <section class="modal-card voice-card" role="dialog" aria-modal="true" aria-labelledby="voice-title">
        <div class="modal-head">
          <div><h2 id="voice-title">问知芽</h2><p>{{ book.title }} · 第 {{ currentPage?.pageNumber }} 页</p></div>
          <button class="modal-close" type="button" aria-label="关闭" @click="closeVoice">×</button>
        </div>
        <div class="voice-center">
          <button class="mic-button" :class="{ recording: voiceState === 'recording' }" type="button" @click="toggleRecording">
            {{ voiceState === 'recording' ? '■' : '◉' }}
          </button>
          <h3>{{ voiceState === 'recording' ? '正在录音' : voiceState === 'processing' ? '正在识别' : '点一下，说出你的问题' }}</h3>
          <p v-if="voiceError" class="form-error">{{ voiceError }}</p>
          <p v-else>录音会通过后端语音识别上传；当前问答生成接口尚未上线，因此这里先展示识别结果。</p>
          <div v-if="transcript" class="transcript-box"><label>识别到的问题</label><p>{{ transcript }}</p></div>
        </div>
      </section>
    </div>
  </main>
  <main v-else class="reader-page page-width">
    <div class="empty-state"><div><h2>阅读会话暂时不可用</h2><p>请返回绘本馆，登录并重新开始阅读。</p><button class="primary" type="button" @click="emit('back')">返回绘本馆</button></div></div>
  </main>
</template>
