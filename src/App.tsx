import { useEffect, useRef, useState } from 'react';
import type { Rule, Simulation } from './types';
import { simulate } from './engine';
import { validateRules } from './validate';
import { canRedo, canUndo, commit, initHistory, redo, undo } from './history';
import { SAMPLE_RULES, PRESETS } from './samples';
import { RulesPanel } from './components/RulesPanel';
import { Simulator } from './components/Simulator';
import { TraceView } from './components/TraceView';
import { RegressionPanel } from './components/RegressionPanel';
import { ShareCreateDialog } from './components/ShareCreateDialog';
import { ShareUnlock } from './components/ShareUnlock';
import {
  cleanLocationUrl,
  parseShareHash,
  type SharePayload,
} from './share';

const STORAGE_KEY = 'url-route-debugger.rules.v1';

function loadRules(): Rule[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return validateRules(JSON.parse(raw));
  } catch {
    // 本地缓存损坏时回退到示例规则
  }
  return structuredClone(SAMPLE_RULES);
}

function readPendingShare(): string | null {
  try {
    return parseShareHash(window.location.hash);
  } catch {
    return null;
  }
}

/** 移除地址栏中的分享 hash（用 replaceState，不新增历史记录） */
function removeShareHash() {
  if (window.location.hash !== '') {
    window.history.replaceState(null, '', cleanLocationUrl());
  }
}

export default function App() {
  // 打开分享链接时，整个调试台让位给口令解锁页；任何解密/校验失败都保持当前状态不变
  const [pendingShare, setPendingShare] = useState<string | null>(readPendingShare);
  const [sharing, setSharing] = useState(false);

  // 规则表的全部编辑都经过撤销历史；历史只存在于当前页面会话，
  // 刷新后从 localStorage 恢复当前规则表，历史本身不持久化
  const [history, setHistory] = useState(() => initHistory(loadRules()));
  const rules = history.present;
  const [method, setMethod] = useState(PRESETS[0].method);
  const [url, setUrl] = useState(PRESETS[0].url);
  const [sim, setSim] = useState<Simulation | null>(null);

  // 文本输入框的聚焦会话：每次聚焦生成唯一标识，
  // 同一会话内（从获得焦点到失焦）的连续输入在历史中合并为一步
  const textSessionRef = useRef<string | null>(null);
  const focusSeqRef = useRef(0);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rules));
  }, [rules]);

  // 监听浏览器前进 / 后退或手工改写 hash 带来的分享链接变化
  useEffect(() => {
    const onHashChange = () => setPendingShare(readPendingShare());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  /** 离散编辑（增删、排序、启停、下拉框、导入等）：每次都成为独立的历史步骤 */
  const changeRules = (next: Rule[]) => setHistory((h) => commit(h, next, null));

  /** 文本框编辑：同一聚焦会话内的连续输入合并为一步 */
  const changeRulesText = (next: Rule[]) => {
    const mergeKey = textSessionRef.current;
    setHistory((h) => commit(h, next, mergeKey));
  };

  const beginTextSession = (fieldKey: string) => {
    focusSeqRef.current += 1;
    textSessionRef.current = `${fieldKey}#${focusSeqRef.current}`;
  };

  // 撤销 / 重做：恢复完整规则快照，同时清空当前模拟轨迹
  const undoRules = () => {
    if (!canUndo(history)) return;
    setHistory(undo(history));
    setSim(null);
  };
  const redoRules = () => {
    if (!canRedo(history)) return;
    setHistory(redo(history));
    setSim(null);
  };

  // Ctrl/Cmd+Z 撤销、Ctrl/Cmd+Shift+Z 重做；输入控件聚焦时不拦截，
  // 保留浏览器原生编辑行为。不设依赖数组：每次渲染都重新绑定，
  // 保证闭包拿到最新的 history。
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.key.toLowerCase() !== 'z') return;
      const t = e.target;
      if (
        t instanceof HTMLElement &&
        (t.closest('input, textarea, select') !== null || t.isContentEditable)
      ) {
        return;
      }
      e.preventDefault();
      if (e.shiftKey) redoRules();
      else undoRules();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  const run = () => setSim(simulate(rules, method, url));

  // 用户在预览页确认：此刻才真正替换状态（作为一步进入撤销历史），同时清空旧轨迹与地址栏 hash
  const confirmImport = (payload: SharePayload) => {
    changeRules(payload.rules);
    setMethod(payload.method);
    setUrl(payload.url);
    setSim(null);
    removeShareHash();
    setPendingShare(null);
  };

  // 用户放弃导入：仅移除 hash 回到调试台，当前规则表 / 请求 / 轨迹一概不动
  const abortImport = () => {
    removeShareHash();
    setPendingShare(null);
  };

  // 创建者关闭分享对话框：清掉自己刚写入地址栏的 hash（复制出的链接不受影响）
  const closeShareDialog = () => {
    setSharing(false);
    removeShareHash();
  };

  if (pendingShare) {
    return (
      <ShareUnlock
        fragment={pendingShare}
        onConfirm={confirmImport}
        onAbort={abortImport}
      />
    );
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>URL 路由规则调试台</h1>
        <p>
          编排有序规则（方法 / 主机 / 路径模板 → 重写、重定向或停止），模拟请求逐步追踪命中过程。
          重写后从第一条规则重新匹配；以「方法 + URL」识别循环，最多执行 20 步。
        </p>
      </header>
      <main className="layout">
        <RulesPanel
          rules={rules}
          onRulesChange={changeRules}
          onTextChange={changeRulesText}
          onFieldFocus={beginTextSession}
          canUndo={canUndo(history)}
          canRedo={canRedo(history)}
          onUndo={undoRules}
          onRedo={redoRules}
          onShare={() => setSharing(true)}
        />
        <div className="right-col">
          <Simulator
            method={method}
            url={url}
            onMethodChange={setMethod}
            onUrlChange={setUrl}
            onRun={run}
          />
          {sim && <TraceView sim={sim} />}
        </div>
      </main>
      <RegressionPanel rules={rules} />
      {sharing && (
        <ShareCreateDialog
          rules={rules}
          method={method}
          url={url}
          onClose={closeShareDialog}
        />
      )}
    </div>
  );
}
