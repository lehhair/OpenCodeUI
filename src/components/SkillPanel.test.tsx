import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SkillPanel } from './SkillPanel'

const getSkillsMock = vi.fn()

vi.mock('../api/skill', () => ({
  getSkills: (...args: unknown[]) => getSkillsMock(...args),
}))

vi.mock('../hooks', () => ({
  useDirectory: () => ({ currentDirectory: '/workspace/demo' }),
}))

vi.mock('../utils', () => ({
  apiErrorHandler: vi.fn(),
}))

describe('SkillPanel', () => {
  beforeEach(() => {
    getSkillsMock.mockReset()
    getSkillsMock.mockResolvedValue([
      {
        name: 'deploy-to-vercel',
        description: 'Deploy app to Vercel',
        location: 'file:///skills/deploy-to-vercel',
        content: 'skill content',
      },
    ])
  })

  it('renders semantic controls for refresh, search, and expandable items', async () => {
    render(<SkillPanel />)

    await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument())

    const searchInput = screen.getByRole('textbox', { name: 'Filter skills...' })
    const itemButton = screen.getByRole('button', { name: /deploy-to-vercel/i })

    expect(searchInput).toHaveAttribute('name', 'skill-filter')
    expect(searchInput).toHaveAttribute('autocomplete', 'off')
    expect(itemButton).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(itemButton)

    expect(itemButton).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('skill content')).toBeInTheDocument()
  })
})
