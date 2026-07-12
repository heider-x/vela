import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { FolderOpen, Sparkles } from 'lucide-react'
import { useProjectStore } from '../../stores/project-store'
import { ipc } from '../../services/ipc-client'
import {
  Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription,
} from '../ui/Dialog'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { Label } from '../ui/Label'

interface NewProjectDialogProps {
  open: boolean
  onClose: () => void
}

/** 新建项目对话框 */
export default function NewProjectDialog({ open, onClose }: NewProjectDialogProps) {
  const { t } = useTranslation('dialogs')
  const createProject = useProjectStore((s) => s.createProject)
  const [name, setName] = useState('')
  const [path, setPath] = useState('')
  const [creating, setCreating] = useState(false)

  /** 对话框每次打开时重置名称 */
  useEffect(() => {
    if (!open) return
    let mounted = true
    Promise.resolve().then(() => { if (mounted) setName('') })
    return () => { mounted = false }
  }, [open])

  /** 选择文件夹 */
  const handleSelectFolder = async () => {
    const selected = await ipc.invoke('dialog:select-folder')
    if (selected) setPath(selected)
  }

  /** 创建项目（类型/受众留空，在小说配置页面填写） */
  const handleCreate = async () => {
    if (!name.trim() || !path.trim()) return
    setCreating(true)
    const success = await createProject({
      name: name.trim(),
      path: path.trim(),
      genre: '',
      targetAudience: '',
    })
    setCreating(false)
    if (success) {
      onClose()
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-[420px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles size={18} className="text-[var(--color-accent)]" />
            {t('newProject.title')}
          </DialogTitle>
          <DialogDescription>{t('newProject.description')}</DialogDescription>
        </DialogHeader>

        {/* 表单 */}
        <div className="px-5 py-4 space-y-4">
          {/* 项目名称 */}
          <div>
            <Label>{t('newProject.nameLabel')}</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('newProject.namePlaceholder')}
              autoFocus
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            />
          </div>

          {/* 保存路径 */}
          <div>
            <Label>{t('newProject.pathLabel')}</Label>
            <div className="flex gap-2">
              <Input
                value={path}
                onChange={(e) => setPath(e.target.value)}
                placeholder={t('newProject.pathPlaceholder')}
                className="flex-1"
              />
              <Button variant="outline" onClick={handleSelectFolder}>
                <FolderOpen size={14} />
                {t('newProject.selectFolder')}
              </Button>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>{t('newProject.cancel')}</Button>
          <Button
            onClick={handleCreate}
            disabled={creating || !name.trim() || !path.trim()}
          >
            <Sparkles size={14} />
            {creating ? t('newProject.creating') : t('newProject.createProject')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
