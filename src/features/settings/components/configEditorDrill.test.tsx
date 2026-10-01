import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { Drill } from './configEditorDrill'
import { useDrillState } from './configEditorDrillState'
import { DuplicateIdField } from './configEditorFields'
import { IntegerField, KeyValueField, PortField, Select, StringMapField } from './configEditorControls'
import { ProvidersSection } from './configEditorProviders'
import type { Config } from '../../../types/api/config'
import { createMergePatch, setNested } from './configEditorUtils'
import { SectionRouter } from './configEditorSections'

function DrillHarness() {
  const drill = useDrillState()
  return (
    <div>
      <button type="button" onClick={() => drill.push({ id: 'provider:openai', title: 'openai' })}>
        Open provider
      </button>
      <button type="button" onClick={() => drill.push({ id: 'model:gpt', title: 'gpt' })}>
        Open model
      </button>
    </div>
  )
}

describe('Config editor drill path', () => {
  it('supports entering, breadcrumb jumps, and single-step back', () => {
    render(
      <Drill rootTitle="Providers" rootKey="providers">
        <DrillHarness />
      </Drill>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Open provider' }))
    fireEvent.click(screen.getByRole('button', { name: 'Open model' }))

    const path = screen.getByRole('navigation', { name: 'Config path' })
    expect(path).toHaveTextContent('Providers')
    expect(path).toHaveTextContent('openai')
    expect(screen.getByRole('button', { name: 'gpt' })).toHaveAttribute('aria-current', 'page')

    fireEvent.click(screen.getByRole('button', { name: 'openai' }))
    expect(screen.queryByRole('button', { name: 'gpt' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'openai' })).toHaveAttribute('aria-current', 'page')

    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.queryByRole('navigation', { name: 'Config path' })).not.toBeInTheDocument()
  })

  it('resets the path when switching root sections', () => {
    const view = render(
      <Drill rootTitle="Providers" rootKey="providers">
        <DrillHarness />
      </Drill>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Open provider' }))
    expect(screen.getByRole('navigation', { name: 'Config path' })).toBeInTheDocument()

    view.rerender(
      <Drill rootTitle="Agents" rootKey="agents">
        <DrillHarness />
      </Drill>,
    )

    expect(screen.queryByRole('navigation', { name: 'Config path' })).not.toBeInTheDocument()
  })

  it('keeps a validation target path after the target is consumed', () => {
    const view = render(
      <Drill rootTitle="Providers" rootKey="providers" targetKey="issue-1" targetStack={[{ id: 'provider:openai', title: 'openai' }]}>
        <DrillHarness />
      </Drill>,
    )
    expect(screen.getByRole('navigation', { name: 'Config path' })).toHaveTextContent('openai')

    view.rerender(
      <Drill rootTitle="Providers" rootKey="providers">
        <DrillHarness />
      </Drill>,
    )
    expect(screen.getByRole('navigation', { name: 'Config path' })).toHaveTextContent('openai')
  })

  it('keeps the full provider path when copying a model', () => {
    function ProviderHarness() {
      const [config, setConfig] = useState<Config>({
        model: 'openai/gpt',
      })
      return (
        <ProvidersSection
          config={config}
          setConfig={setConfig}
          lang="en"
          providerCatalog={{}}
          shells={[]}
          models={[]}
          agents={[]}
        />
      )
    }

    render(<ProviderHarness />)
    fireEvent.click(screen.getByRole('button', { name: /openai/ }))
    fireEvent.click(screen.getByRole('button', { name: /models/ }))
    fireEvent.click(screen.getByRole('button', { name: /gpt/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))

    const path = screen.getByRole('navigation', { name: 'Config path' })
    expect(path).toHaveTextContent('openai')
    expect(path).toHaveTextContent('models')
    expect(path).toHaveTextContent('gpt-copy')
    expect(screen.getByLabelText('Copy as…')).toHaveValue('gpt-copy-2')

    fireEvent.click(screen.getByRole('button', { name: /headers/ }))
    expect(screen.queryByLabelText('Copy as…')).not.toBeInTheDocument()
  })
})

describe('Config editor draft controls', () => {
  it('keeps an integer draft visible while reporting valid values', () => {
    const onChange = vi.fn()
    const view = render(<IntegerField value={4096} onChange={onChange} />)
    const input = screen.getByRole('textbox')

    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: '096' } })
    expect(input).toHaveValue('096')
    expect(onChange).toHaveBeenLastCalledWith(96)

    fireEvent.change(input, { target: { value: '5096' } })
    expect(input).toHaveValue('5096')
    expect(onChange).toHaveBeenLastCalledWith(5096)

    view.rerender(<IntegerField value={5096} onChange={onChange} />)
    expect(input).toHaveValue('5096')
  })

  it('does not submit an invalid port draft', () => {
    const onChange = vi.fn()
    render(<PortField value={4096} onChange={onChange} />)
    const input = screen.getByRole('textbox')

    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: '70000' } })
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByText('Must be an integer in the allowed range.')).toBeInTheDocument()
    fireEvent.blur(input)
    expect(input).toHaveValue('4096')
  })

  it('restores the value from focus start after clearing an integer', () => {
    const onChange = vi.fn()
    render(<IntegerField value={4096} onChange={onChange} />)
    const input = screen.getByRole('textbox')

    fireEvent.focus(input)
    for (const value of ['409', '40', '4', '']) fireEvent.change(input, { target: { value } })
    fireEvent.blur(input)

    expect(onChange).toHaveBeenLastCalledWith(4096)
    expect(input).toHaveValue('4096')
  })

  it('keeps Select escape inside the control', () => {
    const onParentKeyDown = vi.fn()
    render(
      <div onKeyDown={onParentKeyDown}>
        <Select value="a" options={[{ value: 'a', label: 'A' }]} onChange={() => {}} />
      </div>,
    )
    const trigger = screen.getByRole('button', { name: 'A' })
    fireEvent.click(trigger)
    fireEvent.keyDown(trigger, { key: 'Escape' })

    expect(onParentKeyDown).not.toHaveBeenCalled()
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
  })

  it('blocks duplicate ids after trimming whitespace', () => {
    const onCopy = vi.fn()
    render(<DuplicateIdField sourceId="worker" existing={{ 'worker-copy': {} }} lang="en" onCopy={onCopy} />)
    const input = screen.getByLabelText('Copy as…')

    expect(input).toHaveValue('worker-copy-2')
    fireEvent.change(input, { target: { value: ' worker-copy ' } })
    expect(screen.getByRole('button', { name: 'Copy' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
    expect(onCopy).not.toHaveBeenCalled()
  })

  it('adds string map keys together with editable values', () => {
    function StringMapHarness() {
      const [value, setValue] = useState<Record<string, string>>({})
      return (
        <div>
          <StringMapField value={value} onChange={setValue} />
          <output>{JSON.stringify(value)}</output>
        </div>
      )
    }

    render(<StringMapHarness />)
    fireEvent.change(screen.getByPlaceholderText('new key'), { target: { value: 'Authorization' } })
    fireEvent.change(screen.getByPlaceholderText('value'), { target: { value: 'Bearer token' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add key-value pair' }))

    expect(screen.getByText('Authorization')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Bearer token')).toBeInTheDocument()
    expect(screen.getByText('{"Authorization":"Bearer token"}')).toBeInTheDocument()
  })

  it('keeps a KeyValue key pending while choosing its type', () => {
    function KeyValueHarness() {
      const [value, setValue] = useState<Record<string, unknown>>({})
      return (
        <div>
          <KeyValueField value={value} onChange={setValue} />
          <output>{JSON.stringify(value)}</output>
        </div>
      )
    }

    render(<KeyValueHarness />)
    fireEvent.change(screen.getByPlaceholderText('new key'), { target: { value: 'metadata' } })
    fireEvent.click(screen.getByRole('button', { name: 'string' }))
    fireEvent.click(screen.getByRole('option', { name: 'object' }))

    expect(screen.getByPlaceholderText('new key')).toHaveValue('metadata')
    expect(screen.getByText('{}')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(screen.getByText('{"metadata":{}}')).toBeInTheDocument()
  })
})

describe('Config editor object updates', () => {
  it('creates a deep merge patch with changed fields only', () => {
    expect(createMergePatch(
      { server: { port: 4096, hostname: 'localhost' }, share: 'manual' },
      { server: { port: 5000, hostname: 'localhost' }, share: 'manual' },
    )).toEqual({ server: { port: 5000 } })
  })

  it('writes __proto__ as an own config id without changing prototypes', () => {
    const next = setNested({} as Config, ['agent', '__proto__'], { description: 'safe' }) as unknown as Record<string, unknown>
    const agents = next.agent as Record<string, unknown>

    expect(Object.prototype.hasOwnProperty.call(agents, '__proto__')).toBe(true)
    expect((agents.__proto__ as Record<string, unknown>).description).toBe('safe')
    expect(Object.getPrototypeOf(agents)).toBe(Object.prototype)
  })
})

describe('Config editor sections', () => {
  it('renders Skills inside its drill provider', () => {
    render(
      <SectionRouter
        section="skills"
        config={{} as Config}
        setConfig={() => {}}
        lang="en"
        shells={[]}
        models={[]}
        agents={[]}
        providerCatalog={{}}
      />,
    )

    expect(screen.getByText('References (@alias)')).toBeInTheDocument()
  })
})
