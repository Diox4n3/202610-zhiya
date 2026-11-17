<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue'

const props = defineProps({
  pages: { type: Array, required: true },
  cover: { type: String, default: '' },
  title: { type: String, default: '绘本' },
  startPage: { type: Number, default: 0 },
})

const emit = defineEmits(['page-change', 'error'])
const container = ref(null)
const imageErrors = ref(new Set())
let book = null

function markImageError(pageNumber) {
  imageErrors.value = new Set([...imageErrors.value, pageNumber])
}

onMounted(() => {
  if (!container.value || !window.OpenPageFlip) {
    emit('error', '翻书组件未加载')
    return
  }
  try {
    book = window.OpenPageFlip.createBook(container.value, {
      width: 420,
      height: 560,
      size: 'stretch',
      minWidth: 240,
      maxWidth: 460,
      layout: 'auto',
      cover: false,
      startPage: Math.max(0, Math.min(props.pages.length * 2 - 1, props.startPage * 2)),
      flipDuration: 920,
      easing: (progress) => 1 - ((1 - progress) ** 3),
      shadows: true,
      shadowOpacity: .3,
      drag: true,
      swipe: true,
      hover: true,
      click: 'edges',
    })
    book.on('flip', ({ page }) => {
      emit('page-change', {
        storyIndex: Math.max(0, Math.min(props.pages.length - 1, Math.floor(page / 2))),
        bookPage: page,
      })
    })
  } catch (error) {
    emit('error', error.message || '翻书组件初始化失败')
  }
})

onBeforeUnmount(() => {
  book?.destroy()
  book = null
})

defineExpose({
  flipNext: () => book?.flipNext(),
  flipPrev: () => book?.flipPrev(),
})
</script>

<template>
  <div ref="container" class="flipbook-book" :aria-label="`${title}软页绘本`">
    <template v-for="page in pages" :key="page.pageNumber">
      <section class="flip-page flip-page--illustration" data-density="soft" :aria-label="`第 ${page.pageNumber} 页插图`">
        <div v-if="imageErrors.has(page.pageNumber)" class="flip-page-empty">
          <div><h2>插图暂时无法显示</h2><p>文字内容仍可继续阅读。</p></div>
        </div>
        <img v-else :src="cover" :alt="`${title} · 第 ${page.pageNumber} 页`" draggable="false" @error="markImageError(page.pageNumber)">
      </section>
      <section class="flip-page flip-page--text" data-density="soft" :aria-label="`第 ${page.pageNumber} 页文字`">
        <div class="flip-page-inner flip-page-inner--text">
          <p class="eyebrow">{{ title }} · 第 {{ page.pageNumber }} 页</p>
          <blockquote class="page-quote">{{ page.text }}</blockquote>
          <div class="page-number">
            <span>第 {{ page.pageNumber }} 页 · 共 {{ pages.length }} 页</span>
            <span class="page-dots"><i v-for="item in pages" :key="item.pageNumber" :class="{ active: item.pageNumber === page.pageNumber }" /></span>
          </div>
        </div>
      </section>
    </template>
  </div>
</template>
