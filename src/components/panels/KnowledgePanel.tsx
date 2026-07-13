import { useState, useEffect, useCallback } from 'react'
import {
  Database, RefreshCw, BookOpen,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { ipc } from '../../services/ipc-client'
import { Button } from '../ui/Button'
import { EmptyState } from '../ui/EmptyState'
import { useProjectStore } from '../../stores/project-store'
import { globalEventBus } from '../../shared/event-bus'
import { loadKBData, type KBDocument } from '../../services/knowledge-service'



/** 知识库管理面板（侧栏）— 纯只读展示 + 搜索，数据由定稿自动驱动 */
export default function KnowledgePanel() {
  const { t } = useTranslation('panels')
  const [documents, setDocuments] = useState<KBDocument[]>([])
  const [stats, setStats] = useState({ documentCount: 0, totalChunks: 0 })
  const [currentPage, setCurrentPage] = useState(1)
  const pageSize = 20
  const [titleMap, setTitleMap] = useState<Record<string, string>>({})

  /** 加载文档列表 + 统计（通过 Service 层） */
  const loadData = useCallback(async () => {
    try {
      const { documents: docs, stats: s } = await loadKBData()
      setDocuments(docs)
      setStats(s)
    } catch { /* 忽略 */ }
  }, [])

  useEffect(() => { 
    let mounted = true
    Promise.resolve().then(() => { if (mounted) loadData() })
    return () => { mounted = false }
  }, [loadData])

  // 通过 EventBus 监听资源刷新和定稿完成事件
  useEffect(() => {
    const unsub1 = globalEventBus.on('REFRESH_RESOURCE', () => { loadData() })
    const unsub2 = globalEventBus.on('FINALIZE_COMPLETE', () => { loadData() })
    return () => { unsub1(); unsub2() }
  }, [loadData])

  useEffect(() => {
    let cancelled = false
    const loadTitles = async () => {
      if (documents.length === 0) return
      const missing = documents.filter(d => d.filePath && !titleMap[d.id])
      if (missing.length === 0) return

      const newTitles: Record<string, string> = {}
      await Promise.all(
        missing.map(async (doc) => {
          let title = doc.fileName
          const rawName = doc.fileName.replace(/\.[^.]+$/, '')
          const chMatch = rawName.match(/^(?:chapter_(\d+)|第(\d+)章)\s*(.*)$/)
          if (chMatch) {
            const num = chMatch[1] ? parseInt(chMatch[1], 10) : parseInt(chMatch[2], 10)
            const rest = (chMatch[3] || '').trim()
            title = rest ? t('knowledge.chapterTitle', { chapter: num, title: rest }) : t('knowledge.chapterOnly', { chapter: num })
          }

          try {
            const res = await ipc.invoke('fs:read-file', doc.filePath)
            if (res.success && res.content) {
              const firstLine = res.content.split('\n').find((l: string) => l.trim())
              if (firstLine) {
                title = firstLine.replace(/^#+\s*/, '').trim() || title
              }
            }
          } catch { /* 忽略 */ }
          newTitles[doc.id] = title
        })
      )
      if (!cancelled) setTitleMap(prev => ({ ...prev, ...newTitles }))
    }
    loadTitles()
    return () => { cancelled = true }
  }, [documents]) // eslint-disable-line react-hooks/exhaustive-deps -- titleMap 不需要作为依赖：内部通过 prev => 合并即可获取最新值

  const currentProject = useProjectStore(s => s.currentProject)

  if (!currentProject) {
    return (
      <EmptyState 
        icon={<BookOpen size={36} />} 
        message={t('knowledge.openProjectFirst')} 
        className="pb-[15vh]" 
        opacity={0.4} 
      />
    )
  }

  return (
    <div className="h-full flex flex-col overflow-hidden text-sm">
      {/* 标题栏 */}
      <div className="flex items-center justify-between px-3 h-9 flex-shrink-0 border-b border-[var(--color-border)]">
        <span className="text-xs font-medium text-[var(--color-text)] flex items-center gap-1.5">
          <Database size={13} />
          {t('knowledge.title')}
          <span className="text-[0.7rem] text-[var(--color-text-muted)]">
            {t('knowledge.docsChunks', { docs: stats.documentCount, chunks: stats.totalChunks })}
          </span>
        </span>
        <Button
          variant="ghost" size="icon"
          onClick={() => loadData()}
          title={t('common.refresh')}
          className="h-6 w-6"
        >
          <RefreshCw size={11} />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto">

        {/* 已入库章节列表 */}
        <div className="px-3 py-1.5 text-[0.7rem] text-[var(--color-text-muted)] font-medium uppercase tracking-wide">
          {t('knowledge.indexedChapters')}
        </div>
        {documents.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 gap-2 opacity-40">
            <BookOpen size={28} />
            <span className="text-xs">{t('knowledge.noManuscript')}</span>
            <span className="text-[0.7rem] text-center px-4">{t('knowledge.importDocumentAuto')}</span>
          </div>
        ) : (
          <div className="pb-4">
            {documents
              .sort((a, b) => new Date(b.importedAt).getTime() - new Date(a.importedAt).getTime())
              .slice((currentPage - 1) * pageSize, currentPage * pageSize)
              .map((doc) => (
                <div
                  key={doc.id}
                  className="flex items-center justify-between px-3 py-2 hover:bg-[var(--color-hover)] transition-colors group"
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-[var(--color-text)] truncate" title={doc.fileName}>
                      {titleMap[doc.id] || doc.fileName}
                    </div>
                    <div className="flex items-center gap-2 text-[0.7rem] text-[var(--color-text-muted)] mt-0.5">
                      <span>{t('knowledge.chunks', { count: doc.chunkCount })}</span>
                      <span>{new Date(doc.importedAt).toLocaleDateString('zh-CN')}</span>
                    </div>
                  </div>
                </div>
              ))}
            
            {Math.ceil(documents.length / pageSize) > 1 && (
              <div className="flex items-center justify-between px-3 pt-3">
                <span className="text-[0.65rem] text-[var(--color-text-muted)]">
                  {currentPage} / {Math.ceil(documents.length / pageSize)}
                </span>
                <div className="flex items-center gap-1">
                  <Button
                    variant="outline" size="sm"
                    className="h-6 text-[0.65rem] px-2"
                    disabled={currentPage === 1}
                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  >
                    {t('knowledge.previousPage')}
                  </Button>
                  <Button
                    variant="outline" size="sm"
                    className="h-6 text-[0.65rem] px-2"
                    disabled={currentPage === Math.ceil(documents.length / pageSize)}
                    onClick={() => setCurrentPage(p => Math.min(Math.ceil(documents.length / pageSize), p + 1))}
                  >
                    {t('knowledge.nextPage')}
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
