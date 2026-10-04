import { useCallback, useEffect, useRef, useState } from 'react';
import type { Seed } from '../types';
import type { AccountsApi, AccountTimeline } from './api';

const message = (reason: unknown) => reason instanceof Error ? reason.message : 'Please try again.';

/**
 * Loads one account's timeline and keeps it current. Status changes made elsewhere (for
 * example a confirmed self-updating commitment) appear on the next poll, on window focus,
 * or when `refreshSignal` changes. A seed only changes on screen after its save succeeds.
 */
export function useAccountTimeline(api: AccountsApi, accountId: string, refreshSignal = 0, pollMs = 15_000) {
  const [timeline, setTimeline] = useState<AccountTimeline | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [notice, setNotice] = useState('');
  const version = useRef(0);
  const saving = useRef(false);

  const refresh = useCallback(async (background = false) => {
    if (saving.current) return;
    const revision = ++version.current;
    if (!background) { setLoading(true); setError(''); }
    try {
      const result = await api.getTimeline(accountId);
      if (version.current !== revision) return;
      setTimeline(result);
      setError('');
    } catch (reason) {
      // A failed background poll keeps the last good data visible and says it may be stale.
      if (version.current === revision) setError(`Could not load this account. ${message(reason)}`);
    } finally {
      if (version.current === revision) setLoading(false);
    }
  }, [api, accountId]);

  useEffect(() => {
    setTimeline(null); setNotice(''); setSaveError('');
    void refresh();
    const timer = window.setInterval(() => { void refresh(true); }, pollMs);
    const onFocus = () => { void refresh(true); };
    window.addEventListener('focus', onFocus);
    return () => { version.current++; window.clearInterval(timer); window.removeEventListener('focus', onFocus); };
  }, [refresh, pollMs]);

  useEffect(() => { if (refreshSignal) void refresh(true); }, [refreshSignal, refresh]);

  const setStatus = useCallback(async (seed: Seed, status: 'sprout' | 'bloom') => {
    if (saving.current) return null;
    saving.current = true;
    const revision = ++version.current;
    setBusy(true); setSaveError(''); setNotice('');
    try {
      const saved = await api.setSeedStatus(seed, status);
      if (version.current !== revision) return null;
      setTimeline((current) => current && { ...current, items: current.items.map((item) => ({
        ...item, seeds: item.seeds.map((entry) => entry.id === saved.id ? saved : entry),
      })) });
      setNotice(status === 'bloom' ? 'Marked done. This seed is blooming.' : 'Reopened.');
      return saved;
    } catch (reason) {
      if (version.current === revision) setSaveError(`Change was not saved. ${message(reason)}`);
      return null;
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }, [api]);

  return { timeline, loading, busy, error, saveError, notice, refresh, setStatus };
}
