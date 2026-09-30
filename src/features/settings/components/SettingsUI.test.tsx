import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SegmentedControl, SettingRow, Toggle } from './SettingsUI'

describe('Settings UI primitives', () => {
  it('uses the row label for its single switch focus target', () => {
    const onRowClick = vi.fn()
    const onToggle = vi.fn()
    render(
      <SettingRow label="Notifications" onClick={onRowClick}>
        <Toggle enabled={true} onChange={onToggle} />
      </SettingRow>,
    )

    const toggle = screen.getByRole('switch', { name: 'Notifications' })
    expect(toggle.closest('[data-setting-label]')).toHaveAttribute('data-setting-label', 'Notifications')
    expect(screen.queryByRole('button', { name: 'Notifications' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('Notifications'))
    expect(onRowClick).toHaveBeenCalledTimes(1)
    fireEvent.click(toggle)
    expect(onToggle).toHaveBeenCalledTimes(1)
    expect(onRowClick).toHaveBeenCalledTimes(1)
  })

  it('moves focus with the selected segmented option', () => {
    function Harness() {
      const [value, setValue] = useState<'one' | 'two'>('one')
      return (
        <SegmentedControl
          value={value}
          options={[
            { value: 'one', label: 'One' },
            { value: 'two', label: 'Two' },
          ]}
          onChange={setValue}
        />
      )
    }

    render(<Harness />)
    const first = screen.getByRole('tab', { name: 'One' })
    first.focus()
    fireEvent.keyDown(first, { key: 'ArrowRight' })

    expect(screen.getByRole('tab', { name: 'Two' })).toHaveFocus()
  })

  it('keeps focus on the selected option when a change is rejected', () => {
    render(
      <SegmentedControl
        value="one"
        options={[
          { value: 'one', label: 'One' },
          { value: 'two', label: 'Two' },
        ]}
        onChange={() => false}
      />,
    )

    const first = screen.getByRole('tab', { name: 'One' })
    first.focus()
    fireEvent.keyDown(first, { key: 'ArrowRight' })
    expect(first).toHaveFocus()

    fireEvent.click(screen.getByRole('tab', { name: 'Two' }))
    expect(first).toHaveFocus()
  })
})
