<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { describeApiError } from '../api/client'

const props = defineProps({
  childMode: { type: Object, default: null },
  session: { type: Object, default: null },
  book: { type: Object, default: null },
  auth: { type: Object, required: true },
  loading: { type: Boolean, default: false },
  unlockAction: { type: Function, required: true },
})

const account = ref(props.auth.account || '')
const password = ref('')
const error = ref('')
const unlocking = ref(false)
const now = ref(Date.now())
let timer = null

const remaining = computed(() => {
  if (!props.childMode?.expiresAt) return '以儿童端显示为准'
  const minutes = Math.max(0, Math.ceil((new Date(props.childMode.expiresAt).getTime() - now.value) / 60000))
  return `${minutes} 分钟`
})

async function unlock() {
  if (unlocking.value || !account.value.trim() || password.value.length < 8) {
    error.value = '请输入家长账号和至少 8 位密码'
    return
  }
  error.value = ''
  unlocking.value = true
  try {
    await props.unlockAction(account.value.trim(), password.value)
  } catch (reason) {
    error.value = describeApiError(reason)
  } finally {
    unlocking.value = false
  }
}

onMounted(() => {
  timer = window.setInterval(() => { now.value = Date.now() }, 30000)
})
onBeforeUnmount(() => window.clearInterval(timer))
</script>

<template>
  <main class="child-handoff-page">
    <section class="child-handoff-card">
      <div class="child-mode-mark" aria-hidden="true">芽</div>
      <p class="eyebrow">儿童自主阅读模式</p>
      <h1>阅读空间已为孩子准备好</h1>
      <p v-if="book" class="child-handoff-book">当前绘本：{{ book.title }}</p>
      <p>本次剩余：{{ remaining }} · 已授权 {{ childMode?.allowedStoryVersionIds?.length || 1 }} 个绘本版本</p>
      <div class="child-handoff-notice">
        这是桌面家长端的授权与交接页。儿童阅读交互由手机端或 4.3C 硬件端模块承接；本页面不会展示家长导航、档案或历史记录。
      </div>
      <form class="child-handoff-unlock" @submit.prevent="unlock">
        <h2>家长解锁</h2>
        <label class="form-field"><span>家长账号</span><input v-model="account" autocomplete="username"></label>
        <label class="form-field"><span>密码</span><input v-model="password" type="password" autocomplete="current-password"></label>
        <p v-if="error" class="form-error" role="alert">{{ error }}</p>
        <button class="primary" type="submit" :disabled="unlocking">{{ unlocking ? '正在解锁…' : '退出儿童模式' }}</button>
      </form>
    </section>
  </main>
</template>
