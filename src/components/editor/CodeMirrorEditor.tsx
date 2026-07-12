import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import CodeMirror, { ReactCodeMirrorRef, EditorView, ViewUpdate } from '@uiw/react-codemirror'
import { keymap } from '@codemirror/view'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { EditorState } from '@codemirror/state'
import { openSearchPanel, closeSearchPanel, search } from '@codemirror/search'
import { Sparkles, Bold } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '../../lib/utils'

/** 统计字数（简单字符数统计，包含空格换行等格式符） */
function countWords(text: string): number {
  return text.length
}

export type CodeMirrorEditorProps = {
  content: string
  filePath?: string
  editable?: boolean
  onChange?: (content: string) => void
  onSave?: (content: string) => Promise<void> | void
  onCharCountChange?: (count: number) => void
  placeholder?: string
  hideStatusBar?: boolean
  mode?: 'document' | 'prose'
}

export default function CodeMirrorEditor({
  content,
  editable = true,
  onChange,
  onSave,
  onCharCountChange,
  mode = 'document',
}: CodeMirrorEditorProps) {
  const { t } = useTranslation('editors')
  const editorRef = useRef<ReactCodeMirrorRef>(null)

  const AI_ACTIONS = useMemo(() => [
    { key: 'refine', label: t('codeMirrorEditor.aiRefine'), color: 'text-blue-400', prompt: t('codeMirrorEditor.aiRefinePrompt') },
    { key: 'expand', label: t('codeMirrorEditor.aiExpand'), color: 'text-amber-400', prompt: t('codeMirrorEditor.aiExpandPrompt') },
    { key: 'continue', label: t('codeMirrorEditor.aiContinue'), color: 'text-purple-400', prompt: t('codeMirrorEditor.aiContinuePrompt') },
    { key: 'dialogue', label: t('codeMirrorEditor.aiDialogue'), color: 'text-emerald-400', prompt: t('codeMirrorEditor.aiDialoguePrompt') },
  ], [t])

  // 避免状态回路
  const lastEmittedContentRef = useRef(content)
  const [editorContent, setEditorContent] = useState(content)
  const hasEmittedInitialCount = useRef(false)

  // 更新内容
  useEffect(() => {
    // 首次挂载时主动汇报一次字数
    if (!hasEmittedInitialCount.current) {
      onCharCountChange?.(countWords(content))
      hasEmittedInitialCount.current = true
    }

    if (content !== lastEmittedContentRef.current) {
      lastEmittedContentRef.current = content
      setEditorContent(content)
      // 内容经由外部变动（例如打开新文件）
      onCharCountChange?.(countWords(content))
    }
  }, [content, onCharCountChange])

  // ===== Bubble Menu 逻辑 =====
  const [bubbleOpen, setBubbleOpen] = useState(false)
  const [bubblePos, setBubblePos] = useState({ top: 0, left: 0 })
  const [aiResult, setAiResult] = useState<string | null>(null)
  const [activeAIAction, setActiveAIAction] = useState<string | null>(null)
  const [loadingDots, setLoadingDots] = useState('.')
  const [selectionRange, setSelectionRange] = useState<{ from: number, to: number } | null>(null)

  useEffect(() => {
    if (aiResult === '') {
      const timer = setInterval(() => setLoadingDots(d => d.length >= 3 ? '.' : d + '.'), 400)
      return () => clearInterval(timer)
    }
  }, [aiResult])

  const handleUpdate = useCallback((v: ViewUpdate) => {
    if (v.docChanged) {
      const newText = v.state.doc.toString()
      lastEmittedContentRef.current = newText
      onChange?.(newText)

      const cnt = countWords(newText)
      onCharCountChange?.(cnt)
    }

    if (v.selectionSet || v.docChanged || v.geometryChanged) {
      const sel = v.state.selection.main
      if (sel.empty || sel.to - sel.from < 1) {
        setBubbleOpen(false)
        setSelectionRange(null)
      } else {
        setSelectionRange({ from: sel.from, to: sel.to })
        // 交由下方的 useEffect 进行精准防越界座标计算与位置同步
        if (!aiResult) {
          setBubbleOpen(true)
        }
      }
    }
  }, [onChange, onCharCountChange, aiResult])

  // 监听滚动与缩放，实时更新 Bubble Menu 坐标
  useEffect(() => {
    if (!bubbleOpen || !selectionRange || !editorRef.current?.view) return;

    const view = editorRef.current.view;
    const scrollDOM = view.scrollDOM;

    let rafId: number;

    const updatePosition = () => {
      const sel = window.getSelection()
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
        const coords = view.coordsAtPos(selectionRange.from)
        if (coords) {
          setBubblePos({ top: coords.top, left: coords.left })
        } else {
          setBubbleOpen(false)
        }
        return
      }

      const range = sel.getRangeAt(0)
      const rect = range.getBoundingClientRect()
      const viewRect = scrollDOM.getBoundingClientRect()

      // 判断选区是否整体完全在视口之外
      if (rect.bottom < viewRect.top || rect.top > viewRect.bottom || rect.width === 0) {
        setBubbleOpen(false)
        return
      }

      let top = rect.top - 5 // 与选区顶部有些许间距
      const left = rect.left + rect.width / 2

      // 当用户圈选了一大段并向下滚动时，如果选区顶部滚出了视区，
      // 我们让气泡悬浮在视区顶部边缘，直到选区底部也完全滚出视区。
      if (top < viewRect.top + 45) {
        top = Math.min(viewRect.top + 45, rect.bottom - 10)
      }

      setBubblePos({ top, left })
    }

    const onScrollOrResize = () => {
      if (rafId) cancelAnimationFrame(rafId)
      rafId = requestAnimationFrame(updatePosition)
    }

    scrollDOM.addEventListener('scroll', onScrollOrResize, { passive: true })
    window.addEventListener('resize', onScrollOrResize, { passive: true })

    // 初始化计算需要等待 CM 渲染映射完成，确保获取到正确的 DOM Range
    rafId = requestAnimationFrame(updatePosition)

    return () => {
      scrollDOM.removeEventListener('scroll', onScrollOrResize)
      window.removeEventListener('resize', onScrollOrResize)
      if (rafId) cancelAnimationFrame(rafId)
    }
  }, [bubbleOpen, selectionRange])

  // 主题配置
  const cmTheme = useMemo(() => EditorView.theme({
    "&": {
      height: "100%",
      // prose/document 都是写作场景，使用写作字体
      // 其他模式（如代码等）继承父元素 UI 字体
      fontSize: mode === 'prose' ? "16px" : "14px",
      backgroundColor: "transparent",
      fontFamily: (mode === 'prose' || mode === 'document') ? "var(--font-writing)" : "inherit"
    },
    ".cm-scroller": {
      overflow: "auto",
      paddingBottom: "100px",
      fontFamily: (mode === 'prose' || mode === 'document') ? "var(--font-writing)" : "inherit"
    },
    ".cm-content": {
      width: "100%",
      maxWidth: "800px",
      margin: "0 auto",
      padding: "40px",
      lineHeight: "1.8",
      color: "var(--color-text)",
    },
    "&.cm-focused": { outline: "none" },
    ".cm-cursor": { borderLeftColor: "var(--color-accent)", borderLeftWidth: "2px" },
    ".cm-activeLine": { backgroundColor: "transparent" },
    ".cm-selectionBackground, .cm-focused .cm-selectionBackground": { backgroundColor: "var(--color-hover) !important" },
    ".cm-line": { padding: "0" },
  }), [mode])

  // 构建扩展
  const extensions = useMemo(() => {
    const exts = [
      search({ top: true }),
      EditorView.lineWrapping,
      keymap.of([
        {
          key: 'Tab',
          run: (target) => {
            // 插入两个 em 空格（U+2003）= 2em = 标准中文首行缩进两字符宽
            // 使用 \u2003 而非 \u3000（全角空格），因为 em 空格在任何 Unicode 字体下
            // 都精确等于 1em，不依赖 CJK 字体加载
            target.dispatch({
              changes: { from: target.state.selection.main.head, insert: '\u2003\u2003' },
              selection: { anchor: target.state.selection.main.head + 2 }
            })
            return true
          }
        }
      ]),
      // 汉化 Search / UI 文本（涵盖官方大小写所有变种）
      EditorState.phrases.of({
        "Find": t('codeMirrorEditor.search.find'),
        "find": t('codeMirrorEditor.search.find'),
        "Replace": t('codeMirrorEditor.search.replace'),
        "replace": t('codeMirrorEditor.search.replace'),
        "Replace all": t('codeMirrorEditor.search.replaceAll'),
        "replace all": t('codeMirrorEditor.search.replaceAll'),
        "Next": t('codeMirrorEditor.search.next'),
        "next": t('codeMirrorEditor.search.next'),
        "Previous": t('codeMirrorEditor.search.previous'),
        "previous": t('codeMirrorEditor.search.previous'),
        "All": t('codeMirrorEditor.search.all'),
        "all": t('codeMirrorEditor.search.all'),
        "Match case": t('codeMirrorEditor.search.matchCase'),
        "match case": t('codeMirrorEditor.search.matchCase'),
        "Regexp": t('codeMirrorEditor.search.regexp'),
        "regexp": t('codeMirrorEditor.search.regexp'),
        "by word": t('codeMirrorEditor.search.byWord'),
        "By word": t('codeMirrorEditor.search.byWord'),
        "Close": t('codeMirrorEditor.search.close'),
        "close": t('codeMirrorEditor.search.close')
      })
    ]
    if (mode === 'document') {
      exts.push(markdown({ base: markdownLanguage, codeLanguages: languages }))
    }
    return exts
  }, [mode, t])

  // AI 菜单处理（流式调用，实时显示生成内容）
  const handleAIAction = async (prompt: string, _actionKey: string) => {
    try {
      if (!selectionRange || !editorRef.current?.view) return
      const view = editorRef.current.view
      const selectedText = view.state.sliceDoc(selectionRange.from, selectionRange.to)

      const { useLLMStore } = await import('../../stores/llm-store')

      // 初始化流式内容
      setActiveAIAction(AI_ACTIONS.find(a => a.key === _actionKey)?.label || 'AI')
      setAiResult('')

      await useLLMStore.getState().generateStream(
        [
          { role: 'system', content: t('codeMirrorEditor.aiSystemPrompt') },
          { role: 'user', content: `要求：${prompt}\n\n文本：\n${selectedText}` },
        ],
        {
          onChunk: (chunk) => {
            setAiResult(prev => (prev ?? '') + chunk)
          },
          onError: () => {
            setAiResult(t('codeMirrorEditor.generateFailed'))
          },
        }
      )
    } catch (e) {
      console.error(e)
      setAiResult(t('codeMirrorEditor.generateFailed'))
    }
  }

  const handleAcceptAI = () => {
    if (selectionRange && aiResult && editorRef.current?.view) {
      const view = editorRef.current.view
      view.dispatch({
        changes: { from: selectionRange.from, to: selectionRange.to, insert: aiResult }
      })
    }
    setAiResult(null)
    setBubbleOpen(false)
  }

  const handleRejectAI = () => {
    setAiResult(null)
    setBubbleOpen(false)
  }

  // 固定 basicSetup 内存引用，防止 React 每次渲染生成新对象导致内部扩展被重载（搜索框消失的罪魁祸首）
  const cmBasicSetup = useMemo(() => ({
    lineNumbers: false,
    foldGutter: false,
    dropCursor: false,
    allowMultipleSelections: false,
    indentOnInput: false,
    highlightActiveLine: false,
    highlightActiveLineGutter: false,
    searchKeymap: true,
  }), [])

  return (
    <div className="relative h-full flex flex-col min-h-0"
      onKeyDownCapture={(e) => {
        // 全局捕获 Ctrl+F 实现搜索框 Toggle（解决搜索框内焦点时快捷键失效的问题）
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
          e.preventDefault()
          e.stopPropagation()
          const view = editorRef.current?.view
          if (view) {
            const searchPanel = view.dom.querySelector('.cm-search')
            if (searchPanel) {
              closeSearchPanel(view)
              view.focus()
            } else {
              openSearchPanel(view)
            }
          }
        }
      }}
      onKeyDown={(e) => {
        // 捕获 Cmd+S 保存
        if ((e.metaKey || e.ctrlKey) && e.key === 's') {
          e.preventDefault()
          onSave?.(lastEmittedContentRef.current)
        }
      }}>
      <div className="flex-1 relative min-h-0 overflow-hidden"
        onMouseDown={() => {
          // 点击空白处关闭 Bubble Menu
          if (aiResult) return;
          // setBubbleOpen(false) 交给 handleUpdate 里面的 selection empty 判断即可
        }}>
        <div className="absolute inset-0">
          <CodeMirror
            ref={editorRef}
            value={editorContent}
            height="100%"
            className="h-full"
            theme={cmTheme}
            extensions={extensions}
            readOnly={!editable}
            basicSetup={cmBasicSetup}
            onUpdate={handleUpdate}
          />
        </div>
      </div>

      {/* Bubble Menu */}
      {bubbleOpen && bubblePos.top !== 0 && (
        <div
          className="fixed z-50 flex items-center gap-0.5 p-1 rounded-xl border select-none shadow-xl transform -translate-x-1/2 -translate-y-full"
          style={{
            top: bubblePos.top,
            left: bubblePos.left,
            backgroundColor: 'var(--color-sidebar)',
            borderColor: 'var(--color-border)',
          }}
          onMouseDown={(e) => e.preventDefault()} // 防止编辑器失焦
        >
          {aiResult !== null ? (
            <div className="w-[360px] max-h-[260px] overflow-y-auto p-2">
              <div
                className="text-[10px] mb-1.5 font-medium flex items-center gap-1"
                style={{ color: 'var(--color-text-muted)' }}
              >
                <Sparkles size={11} style={{ color: 'var(--color-accent)' }} /> {activeAIAction ? t('codeMirrorEditor.aiPreviewWithAction', { action: activeAIAction }) : t('codeMirrorEditor.aiPreview')}
              </div>
              {/* 流式输入中显示动态内容 */}
              {aiResult === '' ? (
                <div
                  className="text-xs leading-relaxed mb-3"
                  style={{ color: 'var(--color-text-muted)' }}
                >
                  {t('codeMirrorEditor.generating')} {loadingDots}
                </div>
              ) : (
                <div
                  className="text-xs whitespace-pre-wrap leading-relaxed mb-3"
                  style={{ color: 'var(--color-text-secondary)' }}
                >
                  {aiResult}
                </div>
              )}
              <div className="flex items-center gap-2 justify-end">
                <button
                  className="px-2.5 py-1 text-xs rounded-md transition-colors"
                  style={{ border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}
                  onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--color-hover)')}
                  onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                  onClick={handleRejectAI}
                >{t('codeMirrorEditor.cancel')}</button>
                <button
                  className="px-2.5 py-1 text-xs rounded-md font-medium transition-colors"
                  style={{ backgroundColor: 'var(--color-accent)', color: '#fff' }}
                  onMouseEnter={e => (e.currentTarget.style.opacity = '0.9')}
                  onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
                  disabled={aiResult === ''}
                  onClick={handleAcceptAI}
                >{t('codeMirrorEditor.replace')}</button>
              </div>
            </div>
          ) : (
            <>
              {mode === 'document' && (
                <>
                  <button
                    className="p-1 rounded"
                    style={{ color: 'var(--color-text-secondary)' }}
                    onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--color-hover)')}
                    onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                    onClick={() => {
                      // document模式下的格式转换
                      if (selectionRange && editorRef.current?.view) {
                        const view = editorRef.current.view
                        const text = view.state.sliceDoc(selectionRange.from, selectionRange.to)
                        view.dispatch({
                          changes: { from: selectionRange.from, to: selectionRange.to, insert: `**${text}**` }
                        })
                      }
                    }}
                  ><Bold size={14} /></button>
                  <div className="w-[1px] h-3 mx-1" style={{ backgroundColor: 'var(--color-border)' }} />
                </>
              )}
              <div
                className="flex items-center gap-0.5 pl-0.5 pr-1 text-[10px]"
                style={{ color: 'var(--color-text-muted)' }}
              >
                <Sparkles size={11} />AI
              </div>
              {AI_ACTIONS.map(action => (
                <button
                  key={action.key}
                  className={cn('p-1.5 rounded flex items-center gap-1 transition-colors', action.color)}
                  onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--color-hover)')}
                  onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                  onClick={() => handleAIAction(action.prompt, action.key)}
                >
                  <span className="text-[10px] tracking-widest">{action.label}</span>
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  )
}
