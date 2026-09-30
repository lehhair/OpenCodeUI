import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SettingsSearch } from './SettingsSearch'
import type { SettingsSearchItem } from './settingsSearchCatalog'

const items: SettingsSearchItem[] = [
  { id: 'appearance:color', tab: 'appearance', label: 'Color Mode', tabLabel: 'Appearance', targetLabel: 'Color Mode' },
  { id: 'workspace:wide', tab: 'workspace', label: 'Wide Mode', tabLabel: 'Workspace', targetLabel: 'Wide Mode' },
]

const rect = (left: number, top: number, width: number, height: number) =>
  ({
    left,
    right: left + width,
    top,
    bottom: top + height,
    width,
    height,
    x: left,
    y: top,
    toJSON: () => ({}),
  }) as DOMRect

describe('SettingsSearch', () => {
  it('selects results with the keyboard', () => {
    const onSelect = vi.fn()
    render(
      <SettingsSearch
        items={items}
        placeholder="Search settings"
        clearLabel="Clear settings search"
        noResultsLabel="No matching settings"
        onSelect={onSelect}
      />,
    )

    const input = screen.getByRole('combobox', { name: 'Search settings' })
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'mode' } })
    expect(screen.getAllByRole('option')).toHaveLength(2)
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(onSelect).toHaveBeenCalledWith(items[1])
    expect(input).toHaveValue('')
  })

  it('shows an empty result and clears the query', () => {
    render(
      <SettingsSearch
        items={items}
        placeholder="Search settings"
        clearLabel="Clear settings search"
        noResultsLabel="No matching settings"
        onSelect={vi.fn()}
      />,
    )

    const input = screen.getByRole('combobox', { name: 'Search settings' })
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'missing' } })
    expect(screen.getByRole('status')).toHaveTextContent('No matching settings')
    fireEvent.click(screen.getByRole('button', { name: 'Clear settings search' }))
    expect(input).toHaveValue('')
  })

  it('clears with Escape without bubbling to the dialog', () => {
    const onKeyDown = vi.fn()
    render(
      <div onKeyDown={onKeyDown}>
        <SettingsSearch
          items={items}
          placeholder="Search settings"
          clearLabel="Clear settings search"
          noResultsLabel="No matching settings"
          onSelect={vi.fn()}
        />
      </div>,
    )

    const input = screen.getByRole('combobox', { name: 'Search settings' })
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'mode' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(input).toHaveValue('')
    expect(onKeyDown).not.toHaveBeenCalled()

    fireEvent.keyDown(input, { key: 'Escape' })
    expect(onKeyDown).toHaveBeenCalledTimes(1)
  })

  it('closes results when focus leaves the search', () => {
    render(
      <SettingsSearch
        items={items}
        placeholder="Search settings"
        clearLabel="Clear settings search"
        noResultsLabel="No matching settings"
        onSelect={vi.fn()}
      />,
    )

    const input = screen.getByRole('combobox', { name: 'Search settings' })
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'mode' } })
    expect(screen.getAllByRole('option')).toHaveLength(2)
    fireEvent.blur(input, { relatedTarget: document.body })
    expect(screen.queryByRole('option')).not.toBeInTheDocument()
    expect(input).toHaveValue('mode')
  })

  it('sizes results to content without crossing the dialog edge', () => {
    const view = render(
      <div role="dialog" aria-label="Outer dialog">
        <div role="dialog" aria-label="Settings">
          <SettingsSearch
            items={items}
            placeholder="Search settings"
            clearLabel="Clear settings search"
            noResultsLabel="No matching settings"
            onSelect={vi.fn()}
          />
        </div>
      </div>,
    )

    const outerDialog = screen.getByRole('dialog', { name: 'Outer dialog' })
    const dialog = screen.getByRole('dialog', { name: 'Settings' })
    const input = screen.getByRole('combobox', { name: 'Search settings' })
    const root = input.parentElement as HTMLElement
    outerDialog.getBoundingClientRect = () => rect(0, 0, 1000, 700)
    dialog.getBoundingClientRect = () => rect(80, 20, 500, 500)
    let rootRect = rect(100, 40, 160, 32)
    let rootRectReads = 0
    root.getBoundingClientRect = () => {
      rootRectReads += 1
      return rootRect
    }
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'mode' } })

    const listbox = screen.getByRole('listbox')
    expect(listbox.style.width).toBe('max-content')
    expect(listbox.style.minWidth).toBe('160px')
    expect(listbox.style.maxWidth).toBe('472px')
    expect(listbox.style.left).toBe('0px')

    rootRect = rect(500, 40, 60, 32)
    fireEvent(window, new Event('resize'))
    expect(listbox.style.minWidth).toBe('60px')
    expect(listbox.style.maxWidth).toBe('472px')
    expect(listbox.style.left).toBe('auto')
    expect(listbox.style.right).toBe('0px')

    const readsBeforeUnmount = rootRectReads
    view.unmount()
    fireEvent(window, new Event('resize'))
    expect(rootRectReads).toBe(readsBeforeUnmount)
  })

  it('scrolls the active option only during keyboard navigation', () => {
    const manyItems: SettingsSearchItem[] = Array.from({ length: 10 }, (_, index) => ({
      id: `item-${index}`,
      tab: 'appearance',
      label: `Mode ${index}`,
      tabLabel: 'Appearance',
      targetLabel: `Mode ${index}`,
    }))
    render(
      <SettingsSearch
        items={manyItems}
        placeholder="Search settings"
        clearLabel="Clear settings search"
        noResultsLabel="No matching settings"
        onSelect={vi.fn()}
      />,
    )

    const input = screen.getByRole('combobox', { name: 'Search settings' })
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'mode' } })
    const listbox = screen.getByRole('listbox')
    listbox.getBoundingClientRect = () => rect(0, 0, 260, 90)
    Object.defineProperty(listbox, 'scrollTop', { value: 0, writable: true })
    screen.getAllByRole('option').forEach((option, index) => {
      option.getBoundingClientRect = () => rect(0, index * 30 - listbox.scrollTop, 260, 30)
    })

    for (let index = 0; index < 4; index += 1) fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(listbox.scrollTop).toBeGreaterThan(0)

    const previousScrollTop = listbox.scrollTop
    fireEvent.mouseEnter(screen.getAllByRole('option')[2])
    expect(listbox.scrollTop).toBe(previousScrollTop)
  })
})
