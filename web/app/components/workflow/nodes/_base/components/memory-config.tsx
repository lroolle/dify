'use client'
import type { FC } from 'react'
import React, { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import produce from 'immer'
import cn from 'classnames'
import type { Memory } from '../../../types'
import { MemoryRole } from '../../../types'
import Field from '@/app/components/workflow/nodes/_base/components/field'
import Switch from '@/app/components/base/switch'
import Slider from '@/app/components/base/slider'

const i18nPrefix = 'workflow.nodes.common.memory'
const WINDOW_SIZE_MIN = 1
const WINDOW_SIZE_MAX = 100
const WINDOW_SIZE_DEFAULT = 50
type RoleItemProps = {
  readonly: boolean
  title: string
  value: string
  onChange: (value: string) => void
}
const RoleItem: FC<RoleItemProps> = ({
  readonly,
  title,
  value,
  onChange,
}) => {
  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    onChange(e.target.value)
  }, [onChange])
  return (
    <div className='flex items-center justify-between'>
      <div className='text-[13px] font-normal text-gray-700'>{title}</div>
      <input
        readOnly={readonly}
        value={value}
        onChange={handleChange}
        className='w-[200px] h-8 leading-8 px-2.5 rounded-lg border-0 bg-gray-100  text-gray-900 text-[13px]  placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-inset focus:ring-gray-200'
        type='text' />
    </div>
  )
}

type Props = {
  className?: string
  readonly: boolean
  payload: Memory
  onChange: (memory: Memory) => void
  canSetRoleName?: boolean
}

const MemoryConfig: FC<Props> = ({
  className,
  readonly,
  payload = { window: { enabled: false, size: WINDOW_SIZE_DEFAULT } },
  onChange,
  canSetRoleName = false,
}) => {
  const { t } = useTranslation()
  const handleWindowEnabledChange = useCallback((enabled: boolean) => {
    const newPayload = produce(payload, (draft) => {
      if (!draft.window)
        draft.window = { enabled: false, size: WINDOW_SIZE_DEFAULT }

      draft.window.enabled = enabled
    })
    onChange(newPayload)
  }, [payload, onChange])

  const handleWindowSizeChange = useCallback((size: number | string) => {
    const newPayload = produce(payload, (draft) => {
      if (!draft.window)
        draft.window = { enabled: true, size: WINDOW_SIZE_DEFAULT }
      let limitedSize: null | string | number = size
      if (limitedSize === '') {
        limitedSize = null
      }
      else {
        limitedSize = parseInt(limitedSize as string, 10)
        if (isNaN(limitedSize))
          limitedSize = WINDOW_SIZE_DEFAULT

        if (limitedSize < WINDOW_SIZE_MIN)
          limitedSize = WINDOW_SIZE_MIN

        if (limitedSize > WINDOW_SIZE_MAX)
          limitedSize = WINDOW_SIZE_MAX
      }

      draft.window.size = limitedSize as number
    })
    onChange(newPayload)
  }, [payload, onChange])

  const handleBlur = useCallback(() => {
    if (payload.window.size === '' || payload.window.size === null)
      handleWindowSizeChange(WINDOW_SIZE_DEFAULT)
  }, [handleWindowSizeChange, payload.window?.size])

  const handleRolePrefixChange = useCallback((role: MemoryRole) => {
    return (value: string) => {
      const newPayload = produce(payload, (draft) => {
        if (!draft.role_prefix) {
          draft.role_prefix = {
            user: '',
            assistant: '',
          }
        }
        draft.role_prefix[role] = value
      })
      onChange(newPayload)
    }
  }, [payload, onChange])
  return (
    <div className={cn(className)}>
      <Field
        title={t(`${i18nPrefix}.memory`)}
        tooltip={t(`${i18nPrefix}.memoryTip`)!}
      >
        <>
          {/* window size */}
          <div className='flex justify-between'>
            <div className='flex items-center h-8 space-x-1'>
              <Switch
                defaultValue={payload.window?.enabled}
                onChange={handleWindowEnabledChange}
                size='md'
                disabled={readonly}
              />
              <div className='leading-[18px] text-xs font-medium text-gray-500 uppercase'>{t(`${i18nPrefix}.windowSize`)}</div>
            </div>
            <div className='flex items-center h-8 space-x-2'>
              <Slider
                className='w-[144px]'
                value={payload.window?.size as number}
                min={WINDOW_SIZE_MIN}
                max={WINDOW_SIZE_MAX}
                step={1}
                onChange={handleWindowSizeChange}
                disabled={readonly}
              />
              <input
                value={(payload.window?.size || '') as number}
                className='shrink-0 block ml-4 pl-3 w-12 h-8 appearance-none outline-none rounded-lg bg-gray-100 text-[13px] text-gra-900'
                type='number'
                min={WINDOW_SIZE_MIN}
                max={WINDOW_SIZE_MAX}
                step={1}
                onChange={e => handleWindowSizeChange(e.target.value)}
                onBlur={handleBlur}
                disabled={readonly}
              />
            </div>
          </div>
          {canSetRoleName && (
            <div className='mt-4'>
              <div className='leading-6 text-xs font-medium text-gray-500 uppercase'>{t(`${i18nPrefix}.conversationRoleName`)}</div>
              <div className='mt-1 space-y-2'>
                <RoleItem
                  readonly={readonly}
                  title={t(`${i18nPrefix}.user`)}
                  value={payload.role_prefix?.user || ''}
                  onChange={handleRolePrefixChange(MemoryRole.user)}
                />
                <RoleItem
                  readonly={readonly}
                  title={t(`${i18nPrefix}.assistant`)}
                  value={payload.role_prefix?.assistant || ''}
                  onChange={handleRolePrefixChange(MemoryRole.assistant)}
                />
              </div>
            </div>

          )}
        </>
      </Field>
    </div>
  )
}
export default React.memo(MemoryConfig)
