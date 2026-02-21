import { ContentBlock } from '../../../../components'
import { AlertCircleIcon } from '../../../../components/Icons'
import { detectLanguage } from '../../../../utils/languageUtils'
import type { ToolRendererProps, ExtractedToolData } from '../types'

// ============================================
// Default Tool Renderer
// 通用的 Input/Output 渲染逻辑
// ============================================

export function DefaultRenderer({ part, data }: ToolRendererProps) {
  const { state, tool } = part
  const isActive = state.status === 'running' || state.status === 'pending'
  
  const hasInput = !!data.input?.trim()
  const hasError = !!data.error
  const hasOutput = !!(data.files || data.diff || data.output?.trim() || data.exitCode !== undefined)
  const hasDiagnostics = !!data.diagnostics?.length
  
  // Output 不再依赖 hasInput
  const showOutput = hasOutput || hasError || (isActive && !hasOutput)
  
  return (
    <div className="flex flex-col gap-2">
      {/* Input - 默认折叠 */}
      {(hasInput || (isActive && !hasInput)) && (
        <ContentBlock 
          label="Input"
          content={data.input || ''}
          language={data.inputLang}
          isLoading={isActive && !hasInput}
          loadingText=""
          defaultCollapsed={true}
        />
      )}
      
      {/* Output */}
      {showOutput && (
        <OutputBlock 
          tool={tool}
          data={data}
          isActive={isActive}
          hasError={hasError}
          hasOutput={hasOutput}
        />
      )}
      
      {/* Diagnostics */}
      {hasDiagnostics && (
        <DiagnosticsBlock diagnostics={data.diagnostics!} />
      )}
    </div>
  )
}

// ============================================
// Output Block
// ============================================

interface OutputBlockProps {
  tool: string
  data: ExtractedToolData
  isActive: boolean
  hasError: boolean
  hasOutput: boolean
}

function OutputBlock({ tool, data, isActive, hasError, hasOutput }: OutputBlockProps) {
  // 1. Error 优先
  if (hasError) {
    return (
      <ContentBlock 
        label="Error"
        content={data.error || ''}
        variant="error"
      />
    )
  }
  
  // 2. 工具活跃时（running/pending）统一显示 loading
  //    所有工具行为一致，权限弹窗已有预览，这里不重复展示
  if (isActive) {
    return (
      <ContentBlock 
        label="Output"
        isLoading={true}
        loadingText="Running..."
      />
    )
  }
  
  // 3. 完成后显示结果
  if (hasOutput) {
    // Multiple files with diff
    if (data.files) {
      return (
        <div className="flex flex-col gap-2">
          {data.files.map((file, idx) => (
            <ContentBlock 
              key={idx}
              label={formatLabel(tool)}
              filePath={file.filePath}
              diff={file.diff || (file.before !== undefined && file.after !== undefined 
                ? { before: file.before, after: file.after } 
                : undefined)}
              language={detectLanguage(file.filePath)}
            />
          ))}
        </div>
      )
    }
    
    // Single diff
    if (data.diff) {
      return (
        <ContentBlock 
          label="Output"
          filePath={data.filePath}
          diff={data.diff}
          diffStats={data.diffStats}
          language={data.outputLang}
        />
      )
    }
    
    // Regular output
    return (
      <ContentBlock 
        label="Output"
        content={data.output}
        language={data.outputLang}
        filePath={data.filePath}
        stats={data.exitCode !== undefined ? { exit: data.exitCode } : undefined}
      />
    )
  }
  
  // 4. 无输出
  return (
    <ContentBlock 
      label="Output"
    />
  )
}

// ============================================
// Diagnostics Block
// ============================================

interface DiagnosticsBlockProps {
  diagnostics: NonNullable<ExtractedToolData['diagnostics']>
}

function DiagnosticsBlock({ diagnostics }: DiagnosticsBlockProps) {
  const errors = diagnostics.filter(d => d.severity === 'error')
  const warnings = diagnostics.filter(d => d.severity === 'warning')
  
  if (errors.length === 0 && warnings.length === 0) return null
  
  return (
    <div className="rounded-lg border border-border-200/40 bg-bg-100/80 overflow-hidden text-xs">
      <div className="px-3 h-8 bg-bg-200/40 flex items-center gap-2">
        <AlertCircleIcon className="w-3.5 h-3.5 text-text-400" />
        <span className="font-medium text-text-300">Diagnostics</span>
        <div className="flex items-center gap-2 ml-auto text-[10px]">
          {errors.length > 0 && (
            <span className="text-danger-100">{errors.length} error{errors.length > 1 ? 's' : ''}</span>
          )}
          {warnings.length > 0 && (
            <span className="text-warning-100">{warnings.length} warning{warnings.length > 1 ? 's' : ''}</span>
          )}
        </div>
      </div>
      <div className="px-3 py-2 space-y-1.5 max-h-40 overflow-auto custom-scrollbar">
        {diagnostics.map((d, idx) => (
          <div key={idx} className="flex items-start gap-2 text-[11px]">
            <span className={`flex-shrink-0 mt-1 w-1.5 h-1.5 rounded-full ${
              d.severity === 'error' ? 'bg-danger-100' : 'bg-warning-100'
            }`} />
            <span className="text-text-400 flex-shrink-0">
              {d.file}:{d.line + 1}
            </span>
            <span className="text-text-300 break-words">{d.message}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ============================================
// Helpers
// ============================================

function formatLabel(name: string): string {
  if (!name) return 'Result'
  return name
    .split(/[_-]/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ') + ' Result'
}
