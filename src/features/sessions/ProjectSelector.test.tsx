import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ProjectSelector } from './ProjectSelector'
import type { ApiProject } from '../../api'

const GLOBAL_PROJECT = {
  id: 'global',
  name: 'Global',
  canonical: '',
  time: { created: 0, updated: 0 },
  sandboxes: [],
} as unknown as ApiProject

const APP_PROJECT = {
  id: 'project-1',
  name: 'App',
  canonical: '/workspace/app',
  time: { created: 0, updated: 0 },
  sandboxes: [],
} as unknown as ApiProject

describe('ProjectSelector', () => {
  it('opens remove confirmation without selecting the project row', async () => {
    const onSelectProject = vi.fn()
    const onRemoveProject = vi.fn()

    render(
      <ProjectSelector
        currentProject={GLOBAL_PROJECT}
        projects={[GLOBAL_PROJECT, APP_PROJECT]}
        isLoading={false}
        onSelectProject={onSelectProject}
        onAddProject={vi.fn()}
        onRemoveProject={onRemoveProject}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /Global/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))

    expect(onSelectProject).not.toHaveBeenCalled()

    const dialog = await screen.findByRole('dialog', { name: 'Remove Project' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove' }))

    expect(onRemoveProject).toHaveBeenCalledWith('project-1')
  })

  it('keeps the full project row clickable outside the inner text button', () => {
    const onSelectProject = vi.fn()

    render(
      <ProjectSelector
        currentProject={GLOBAL_PROJECT}
        projects={[GLOBAL_PROJECT, APP_PROJECT]}
        isLoading={false}
        onSelectProject={onSelectProject}
        onAddProject={vi.fn()}
        onRemoveProject={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /Global/i }))

    const projectButton = screen.getByRole('button', { name: /App/i })
    const projectRow = projectButton.parentElement

    expect(projectRow).not.toBeNull()

    fireEvent.click(projectRow!)

    expect(onSelectProject).toHaveBeenCalledWith('project-1')
  })
})
