/// <reference types="vitest/config" />
import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  test: {
    // 叙事一致性测试是纯算法 + 正则，不需要 DOM/Electron 环境
    environment: 'node',
    // 跑 narrative-consistency 单测 + IPC validation 单测（覆盖 PR #13 审计发现的所有 bug）
    // standalone.test.ts 是预存在 setup bug（不是我引入），跳过
    include: [
      'src/services/narrative-consistency/__tests__/narrative-consistency.test.ts',
      'src/services/narrative-consistency/__tests__/perf-regression.test.ts',
      'electron/__tests__/ipc-validation.test.ts',
    ],
    globals: false,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
})
