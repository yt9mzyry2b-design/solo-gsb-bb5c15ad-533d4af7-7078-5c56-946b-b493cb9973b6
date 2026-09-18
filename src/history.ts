import type { Rule } from './types';

/** 历史步数上限：超出后丢弃最早的一步，避免长时间编辑占用过多内存 */
export const MAX_HISTORY = 100;

/**
 * 规则表的撤销 / 重做历史。
 * 每一步都是完整的规则快照（规则表不可变更新，快照只需保存引用）；
 * 历史只存在于页面会话内，不写入 localStorage。
 */
export interface RuleHistory {
  /** 可撤销的快照栈，栈底是最早的一步 */
  past: Rule[][];
  /** 当前规则表 */
  present: Rule[];
  /** 可重做的快照栈，栈顶是最近一次被撤销的一步 */
  future: Rule[][];
  /**
   * 最近一次提交的合并标识：同一文本输入框同一次聚焦会话（聚焦到失焦）
   * 内的连续输入共享标识，从而合并为一步；离散编辑与撤销 / 重做会清空它
   */
  mergeKey: string | null;
}

export function initHistory(initial: Rule[]): RuleHistory {
  return { past: [], present: initial, future: [], mergeKey: null };
}

export function canUndo(h: RuleHistory): boolean {
  return h.past.length > 0;
}

export function canRedo(h: RuleHistory): boolean {
  return h.future.length > 0;
}

/**
 * 记录一次编辑并返回新历史：
 * - `mergeKey` 非空且与上一次提交相同（同一输入框的连续输入）时，
 *   合并进当前步骤，不再新增历史；
 * - 否则把当前快照压入 past，并立即丢弃重做分支。
 */
export function commit(
  h: RuleHistory,
  next: Rule[],
  mergeKey: string | null,
): RuleHistory {
  if (mergeKey !== null && mergeKey === h.mergeKey) {
    return { ...h, present: next };
  }
  const past = [...h.past, h.present];
  if (past.length > MAX_HISTORY) past.shift();
  return { past, present: next, future: [], mergeKey };
}

/** 撤销一步：恢复上一份完整快照；无可撤销时原样返回 */
export function undo(h: RuleHistory): RuleHistory {
  if (h.past.length === 0) return h;
  return {
    past: h.past.slice(0, -1),
    present: h.past[h.past.length - 1],
    future: [h.present, ...h.future],
    mergeKey: null,
  };
}

/** 重做一步：恢复最近被撤销的快照；无可重做时原样返回 */
export function redo(h: RuleHistory): RuleHistory {
  if (h.future.length === 0) return h;
  return {
    past: [...h.past, h.present],
    present: h.future[0],
    future: h.future.slice(1),
    mergeKey: null,
  };
}
