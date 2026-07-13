import { useState } from 'react'
import { Save, Trash2, Users, Network } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useProjectStore } from '../../stores/project-store'
import { useWorkflowStore } from '../../stores/workflow-store'
import { confirm } from '../ui/Confirm'
import {
  useCharacterStore,
  EMPTY_STATE,
  ROLE_LABELS,
  type CharacterCurrentState,
} from '../../stores/character-store'
import RelationshipGraph from './RelationshipGraph'
import { EmptyState as BaseEmptyState } from '../ui/EmptyState'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { Textarea } from '../ui/Textarea'
import { Label } from '../ui/Label'
import { NativeSelect } from '../ui/NativeSelect'

/**
 * 角色卡编辑器 — 纯编辑区域（角色列表已移至侧栏）
 * 从 character-store 读取选中角色，仅渲染编辑表单。
 */
export default function CharacterEditor() {
  const { t } = useTranslation('editors')
  const currentProject = useProjectStore(s => s.currentProject)
  const addLog = useWorkflowStore(s => s.addLog)
  const characters = useCharacterStore(s => s.characters)
  const selectedName = useCharacterStore(s => s.selectedName)
  const saving = useCharacterStore(s => s.saving)
  const updateField = useCharacterStore(s => s.updateField)
  const deleteCharacter = useCharacterStore(s => s.deleteCharacter)
  const saveAll = useCharacterStore(s => s.saveAll)
  const [viewMode, setViewMode] = useState<'edit' | 'state' | 'graph'>('edit')

  // 数据由 ProjectService 统一加载，组件只消费 store 数据

  const selectedCard = characters.find((c) => c.name === selectedName) || null

  const handleDelete = async () => {
    if (!selectedCard || !currentProject) return
    const ok = await confirm(
      t('characterEditor.deleteConfirmText', { name: selectedCard.name || t('chapterCard.unnamed') }),
      { title: t('characterEditor.deleteConfirmTitle'), confirmText: t('characterEditor.delete'), danger: true }
    )
    if (!ok) return
    await deleteCharacter(selectedCard.name, currentProject.path)
  }

  const handleSave = async () => {
    if (!currentProject) return
    await saveAll(currentProject.path)
    addLog('info', t('characterEditor.saveSuccess', { count: characters.length }))
  }

  // ===== 渲染 =====

  return (
    <div className="h-full flex flex-col overflow-hidden bg-[var(--color-bg)]">
      {/* 统一顶部工具栏 */}
      <div
        className="flex items-center justify-between gap-2 px-3 h-9 flex-shrink-0"
        style={{
          borderBottom: '1px solid var(--color-border)',
          backgroundColor: 'var(--color-editor-bg)',
        }}
      >
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-xs font-medium truncate text-[var(--color-text-secondary)]">
            {viewMode === 'graph'
              ? t('characterEditor.characterGraph')
              : selectedCard
                ? `${selectedCard.name || t('characterEditor.newCharacter')} ${viewMode === 'state' ? `— ${t('characterEditor.currentState')}` : `— ${t('characterEditor.editProfile')}`}`
                : t('characterEditor.characterProfile')}
          </span>
        </div>

        <div className="flex items-center gap-1.5 flex-shrink-0">
          {viewMode === 'graph' ? (
            <Button variant="outline" size="sm" onClick={() => setViewMode('edit')} title={t('characterEditor.backToEdit')}>
              <Users size={12} /> {t('characterEditor.editMode')}
            </Button>
          ) : selectedCard ? (
            <>
              {viewMode === 'state' ? (
                <Button variant="outline" size="sm" onClick={() => setViewMode('edit')} title={t('characterEditor.backToBasic')}>
                  <Users size={12} /> {t('characterEditor.basicSettings')}
                </Button>
              ) : (
                <Button variant="outline" size="sm" onClick={() => setViewMode('state')} title={t('characterEditor.viewCurrentStatus')}>
                  {t('characterEditor.currentStatus')}
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={() => setViewMode('graph')} title={t('characterEditor.viewRelationshipMap')}>
                <Network size={12} /> {t('characterEditor.relationshipGraph')}
              </Button>
              <Button variant="destructive" size="sm" onClick={handleDelete}>
                <Trash2 size={12} /> {t('characterEditor.delete')}
              </Button>
              <Button variant="outline" size="sm" onClick={handleSave} disabled={saving}>
                <Save size={12} /> {saving ? t('characterEditor.saving') : t('characterEditor.save')}
              </Button>
            </>
          ) : (
            <Button variant="outline" size="sm" onClick={() => setViewMode('graph')} title={t('characterEditor.viewRelationshipMap')}>
              <Network size={12} /> {t('characterEditor.relationshipGraph')}
            </Button>
          )}
        </div>
      </div>

      {/* 主体区 */}
      <div className="flex-1 overflow-y-auto relative">
        {viewMode === 'graph' ? (
          <RelationshipGraph characters={characters} />
        ) : !selectedCard ? (
          <BaseEmptyState
            icon={<Users size={36} />}
            message={currentProject ? t('characterEditor.selectOrCreate') : t('characterEditor.openProjectFirst')}
            opacity={currentProject ? 0.3 : 0.4}
          />
        ) : viewMode === 'state' ? (
          <div className="max-w-2xl mx-auto px-6 py-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-[var(--color-text)]">
                {t('characterEditor.currentStatusProfile')}
              </h3>
              <span className="text-xs text-[var(--color-text-secondary)]">
                {t('characterEditor.lastUpdated', { chapter: selectedCard.currentState?.updatedAtChapter ?? 0 })}
              </span>
            </div>
            <div className="space-y-3">
              {([
                ['location', t('characterEditor.stateFields.location')],
                ['powerLevel', t('characterEditor.stateFields.powerLevel')],
                ['physicalState', t('characterEditor.stateFields.physicalState')],
                ['mentalState', t('characterEditor.stateFields.mentalState')],
                ['keyItems', t('characterEditor.stateFields.keyItems')],
                ['recentEvents', t('characterEditor.stateFields.recentEvents')],
              ] as const).map(([field, label]) => (
                <div key={field}>
                  <Label>{label}</Label>
                  <Textarea
                    value={selectedCard.currentState?.[field]?.toString() ?? ''}
                    onChange={(e) => {
                      const cs: CharacterCurrentState = {
                        ...(selectedCard.currentState ?? EMPTY_STATE),
                        [field]: e.target.value,
                      }
                      updateField(selectedCard.name, 'currentState', cs)
                    }}
                    rows={2}
                    placeholder={`${label}...`}
                  />
                </div>
              ))}
            </div>
            {!selectedCard.currentState && (
              <div className="mt-4 p-3 rounded-lg bg-[var(--color-hover)] text-xs text-[var(--color-text-secondary)]">
                {t('characterEditor.stateHint')}
              </div>
            )}
          </div>
        ) : (
          <div className="max-w-2xl mx-auto px-6 py-4">
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-3">
                <div><Label>{t('characterEditor.fields.name')}</Label><Input value={selectedCard.name} onChange={(e) => updateField(selectedCard.name, 'name', e.target.value)} /></div>
                <div><Label>{t('characterEditor.fields.gender')}</Label><Input value={selectedCard.gender} onChange={(e) => updateField(selectedCard.name, 'gender', e.target.value)} /></div>
                <div><Label>{t('characterEditor.fields.age')}</Label><Input value={selectedCard.age} onChange={(e) => updateField(selectedCard.name, 'age', e.target.value)} /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>{t('characterEditor.fields.role')}</Label>
                  <NativeSelect value={selectedCard.role} onChange={(e) => updateField(selectedCard.name, 'role', e.target.value as typeof selectedCard.role)}>
                    {Object.entries(ROLE_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>{v}</option>
                    ))}
                  </NativeSelect>
                </div>
              </div>
              <div><Label>{t('characterEditor.fields.appearance')}</Label><Textarea value={selectedCard.appearance} onChange={(e) => updateField(selectedCard.name, 'appearance', e.target.value)} rows={3} placeholder={t('characterEditor.fields.appearancePlaceholder')} /></div>
              <div><Label>{t('characterEditor.fields.personality')}</Label><Textarea value={selectedCard.personality} onChange={(e) => updateField(selectedCard.name, 'personality', e.target.value)} rows={3} placeholder={t('characterEditor.fields.personalityPlaceholder')} /></div>
              <div><Label>{t('characterEditor.fields.background')}</Label><Textarea value={selectedCard.background} onChange={(e) => updateField(selectedCard.name, 'background', e.target.value)} rows={4} placeholder={t('characterEditor.fields.backgroundPlaceholder')} /></div>
              <div><Label>{t('characterEditor.fields.abilities')}</Label><Textarea value={selectedCard.abilities} onChange={(e) => updateField(selectedCard.name, 'abilities', e.target.value)} rows={3} placeholder={t('characterEditor.fields.abilitiesPlaceholder')} /></div>
              <div><Label>{t('characterEditor.fields.motivation')}</Label><Textarea value={selectedCard.motivation} onChange={(e) => updateField(selectedCard.name, 'motivation', e.target.value)} rows={2} placeholder={t('characterEditor.fields.motivationPlaceholder')} /></div>
              <div><Label>{t('characterEditor.fields.relationships')}</Label><Textarea value={selectedCard.relationships} onChange={(e) => updateField(selectedCard.name, 'relationships', e.target.value)} rows={3} placeholder={t('characterEditor.fields.relationshipsPlaceholder')} /></div>
              <div><Label>{t('characterEditor.fields.arc')}</Label><Textarea value={selectedCard.arc} onChange={(e) => updateField(selectedCard.name, 'arc', e.target.value)} rows={3} placeholder={t('characterEditor.fields.arcPlaceholder')} /></div>
              <div><Label>{t('characterEditor.fields.notes')}</Label><Textarea value={selectedCard.notes} onChange={(e) => updateField(selectedCard.name, 'notes', e.target.value)} rows={2} placeholder={t('characterEditor.fields.notesPlaceholder')} /></div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
