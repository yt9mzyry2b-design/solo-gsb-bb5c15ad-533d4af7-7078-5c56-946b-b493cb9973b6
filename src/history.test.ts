import { describe, expect, it } from 'vitest';
import {
  MAX_HISTORY,
  canRedo,
  canUndo,
  commit,
  initHistory,
  redo,
  undo,
} from './history';
import type { Rule } from './types';

/** 生成只含名字的规则表快照（测试只关心快照内容与顺序） */
function snap(...names: string[]): Rule[] {
  return names.map((name) => ({
    id: name,
    name,
    enabled: true,
    method: 'ANY',
    host: 'example.com',
    pathTemplate: '/',
    action: { type: 'rewrite', target: '/', status: 302 },
  }));
}

function names(rules: Rule[]): string[] {
  return rules.map((r) => r.name);
}

describe('commit', () => {
  it('离散编辑：当前快照进入 past，可撤销、不可重做', () => {
    let h = initHistory(snap('a'));
    expect(canUndo(h)).toBe(false);
    expect(canRedo(h)).toBe(false);
    h = commit(h, snap('b'), null);
    expect(names(h.present)).toEqual(['b']);
    expect(names(h.past[0])).toEqual(['a']);
    expect(canUndo(h)).toBe(true);
    expect(canRedo(h)).toBe(false);
  });

  it('同一合并标识的连续输入合并为一步，一次撤销回到会话前', () => {
    let h = initHistory(snap('a'));
    h = commit(h, snap('ab'), 'r1:name#1');
    h = commit(h, snap('abc'), 'r1:name#1');
    h = commit(h, snap('abcd'), 'r1:name#1');
    expect(h.past).toHaveLength(1); // 只有首次输入产生历史
    expect(names(h.present)).toEqual(['abcd']);
    h = undo(h);
    expect(names(h.present)).toEqual(['a']);
  });

  it('不同合并标识（新的聚焦会话）产生新的历史步骤', () => {
    let h = initHistory(snap('a'));
    h = commit(h, snap('ab'), 'r1:name#1');
    h = commit(h, snap('abx'), 'r1:name#2');
    expect(h.past).toHaveLength(2);
  });

  it('离散编辑会打断合并链：相同标识也不再合并', () => {
    let h = initHistory(snap('a'));
    h = commit(h, snap('ab'), 'r1:name#1');
    h = commit(h, snap('b'), null); // 例如启停开关
    h = commit(h, snap('bc'), 'r1:name#1');
    expect(h.past).toHaveLength(3);
  });

  it(`历史上限 ${MAX_HISTORY} 步：超出后丢弃最早的一步`, () => {
    let h = initHistory(snap('r0'));
    for (let i = 1; i <= MAX_HISTORY + 10; i += 1) {
      h = commit(h, snap(`r${i}`), null);
    }
    expect(h.past).toHaveLength(MAX_HISTORY);
    expect(names(h.past[0])).toEqual(['r10']);
    expect(names(h.present)).toEqual([`r${MAX_HISTORY + 10}`]);
  });
});

describe('undo / redo', () => {
  it('撤销逐步恢复完整快照，重做按相反顺序恢复', () => {
    let h = initHistory(snap('a'));
    h = commit(h, snap('a', 'b'), null);
    h = commit(h, snap('a', 'b', 'c'), null);

    h = undo(h);
    expect(names(h.present)).toEqual(['a', 'b']);
    h = undo(h);
    expect(names(h.present)).toEqual(['a']);
    expect(canUndo(h)).toBe(false);
    expect(canRedo(h)).toBe(true);

    h = redo(h);
    expect(names(h.present)).toEqual(['a', 'b']);
    h = redo(h);
    expect(names(h.present)).toEqual(['a', 'b', 'c']);
    expect(canRedo(h)).toBe(false);
    expect(canUndo(h)).toBe(true);
  });

  it('无可撤销 / 可重做时是安全的空操作', () => {
    const h = initHistory(snap('a'));
    expect(undo(h)).toBe(h);
    expect(redo(h)).toBe(h);
    const h2 = commit(h, snap('b'), null);
    expect(redo(h2)).toBe(h2);
  });

  it('撤销后产生新编辑，立即丢弃重做分支', () => {
    let h = initHistory(snap('a'));
    h = commit(h, snap('b'), null);
    h = undo(h);
    expect(canRedo(h)).toBe(true);
    h = commit(h, snap('c'), null);
    expect(canRedo(h)).toBe(false);
    expect(h.future).toHaveLength(0);
    // 撤销新编辑后也只能回到 a，而不是被丢弃的 b
    h = undo(h);
    expect(names(h.present)).toEqual(['a']);
  });

  it('撤销 / 重做清空合并标识：后续输入不再并入旧会话', () => {
    let h = initHistory(snap('a'));
    h = commit(h, snap('ab'), 'r1:name#1');
    h = undo(h);
    // 撤销后焦点可能仍在原输入框，继续输入必须开启新的一步
    h = commit(h, snap('ac'), 'r1:name#1');
    expect(h.past).toHaveLength(1);
    expect(names(h.present)).toEqual(['ac']);
  });
});
