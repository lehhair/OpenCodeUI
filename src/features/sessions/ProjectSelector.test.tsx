import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ProjectSelector } from './ProjectSelector'
import type { ApiProject } from '../../api'

const GLOBAL_PROJECT = {
  id: 'global',
  name: 'Global',
  worktree: '',
} as ApiProject

const APP_PROJECT = {
  id: 'project-1',
  name: 'App',
  worktree: '/workspace/app',
} as ApiProject

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
})
