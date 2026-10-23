// ============================================
// fuzzyMatch - 打分式模糊匹配器
// ============================================
// 用于命令面板这类「少量条目、需要相关度排序」的场景。
// 设计参考 VS Code Quick Open / fzf 的分级打分语义：
// 名字命中永远压过描述命中，同级内按打分排序。

/**
 * 匹配等级（数值越大越相关）。
 * 注意：等级之间的差距设计为远大于同级内的细项加分，
 * 保证「名字子串命中」永远排在「描述命中」前面。
 */
const SCORE_EXACT = 10_000 // 名字全等
const SCORE_PREFIX = 8_000 // 名字前缀命中
const SCORE_WORD_BOUNDARY = 6_000 // 名字词边界命中（如 session-stats 中的 "stats"）
const SCORE_SUBSTRING = 4_000 // 名字普通子串命中
const SCORE_SUBSEQUENCE = 2_000 // 名字缩写命中（按序命中所有字符，如 cmp → compact）
const SCORE_DESCRIPTION = 100 // 仅描述命中（名字完全不沾边）

// 同级内的细项加分，累计上限不会跨级
const BONUS_PREFIX_START = 300 // query 从名字第一个字符开始（天然前缀）
const BONUS_SHORTER_NAME = 200 // 名字越短越精确（每短一个字符 +2，封顶 200）
const BONUS_CONSECUTIVE = 15 // 子序列匹配时，连续命中的字符越多越相关
const BONUS_WORD_START = 50 // query 命中在词边界上（- _ . / 空格 后的首字符）
const PENALTY_SUBSEQUENCE_GAP = -5 // 缩写匹配时字符间隔越大越扣分

/** 词边界字符：这些字符后的字母视为「词首」 */
const WORD_SEPARATORS = new Set(['-', '_', '.', '/', ' ', '@', ':'])

/**
 * 计算子序列匹配的得分：query 的每个字符按顺序出现在 target 中。
 * 返回 null 表示不是子序列匹配。
 *
 * 统计连续命中数和间隔惩罚，让 "cmp" 对 "compact" 的得分
 * 高于对 "ca...m...p" 这类松散匹配。
 */
function scoreSubsequence(query: string, target: string): { score: number } | null {
  let qi = 0
  let consecutive = 0
  let maxConsecutive = 0
  let gaps = 0
  let prevMatchIndex = -2

  for (let ti = 0; ti < target.length && qi < query.length; ti++) {
    if (target[ti] === query[qi]) {
      if (prevMatchIndex === ti - 1) {
        consecutive++
      } else {
        gaps += prevMatchIndex >= 0 ? ti - prevMatchIndex - 1 : 0
        consecutive = 1
      }
      maxConsecutive = Math.max(maxConsecutive, consecutive)
      prevMatchIndex = ti
      qi++
    }
  }

  // 有字符没按序命中 → 匹配失败
  if (qi < query.length) return null

  return {
    score: BONUS_CONSECUTIVE * maxConsecutive + PENALTY_SUBSEQUENCE_GAP * gaps,
  }
}

/**
 * 纯函数：query 与一个名字/描述对的相关度打分。
 * 返回总分（0 = 无匹配），分数只用于同一次查询内的排序，无绝对含义。
 */
export function fuzzyScore(query: string, name: string, description?: string): number {
  const q = query.toLowerCase().trim()
  if (!q) return 0

  const n = name.toLowerCase()

  // —— 名字匹配（高等级）——
  let nameScore = 0

  if (n === q) {
    nameScore = SCORE_EXACT
  } else if (n.startsWith(q)) {
    nameScore = SCORE_PREFIX + BONUS_PREFIX_START
    // 名字越短，前缀命中越精确
    nameScore += Math.max(0, BONUS_SHORTER_NAME - (n.length - q.length) * 2)
  } else {
    // 词边界命中：query 出现在某个分隔符之后（如 "stats" → "session-stats"）
    let wordBoundaryOffset = -1
    for (let i = 1; i <= n.length - q.length; i++) {
      if (n.startsWith(q, i) && WORD_SEPARATORS.has(n[i - 1])) {
        wordBoundaryOffset = i
        break
      }
    }

    if (wordBoundaryOffset >= 0) {
      nameScore = SCORE_WORD_BOUNDARY + BONUS_WORD_START
    } else if (n.includes(q)) {
      // 普通子串命中：位置越靠前越相关
      nameScore = SCORE_SUBSTRING + Math.max(0, 60 - n.indexOf(q) * 3)
    } else {
      const sub = scoreSubsequence(q, n)
      if (sub) {
        nameScore = SCORE_SUBSEQUENCE + sub.score
      }
    }
  }

  if (nameScore > 0) return nameScore

  // —— 描述匹配（最低等级，永远压不过名字命中）——
  // 单字符 query 不走描述匹配：会在所有含该字母的描述里到处命中，噪音太大
  if (description && q.length >= 2) {
    const d = description.toLowerCase()
    if (d.includes(q)) return SCORE_DESCRIPTION
    // 描述子序列兜底，分数略高于纯 includes 以区分强度
    if (scoreSubsequence(q, d)) {
      return SCORE_DESCRIPTION + Math.min(50, q.length * 5)
    }
  }

  return 0
}
