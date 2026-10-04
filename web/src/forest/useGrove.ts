import { useCallback, useEffect, useRef, useState } from 'react';
import type { GroveApi } from '../api/contracts';
import type { Grove, Seed, SeedPatch } from '../types';

const emptyGrove: Grove = { seeds: [], roots: [] };

export function useGrove(api: GroveApi, meetingId: string) {
  const [grove, setGrove] = useState<Grove>(emptyGrove);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const mounted = useRef(false);
  const saving = useRef(false);
  const version = useRef(0);
  const context = useRef(0);

  const refresh = useCallback(async (background = false) => {
    if (saving.current) return;
    const revision = ++version.current;
    if (!background) { setLoading(true); setError(''); }
    try {
      const result = await api.getGrove(meetingId);
      if (mounted.current && version.current === revision) {
        setGrove(result);
        setError('');
      }
    } catch (reason) {
      if (mounted.current && version.current === revision) {
        setError(`Could not refresh this grove. ${reason instanceof Error ? reason.message : 'Please try again.'}`);
      }
    } finally {
      if (mounted.current && version.current === revision) setLoading(false);
    }
  }, [api, meetingId]);

  useEffect(() => {
    mounted.current = true;
    context.current++;
    setGrove(emptyGrove);
    setNotice('');
    void refresh();
    const timer = window.setInterval(() => { void refresh(true); }, 30_000);
    return () => {
      mounted.current = false;
      context.current++;
      version.current++;
      window.clearInterval(timer);
    };
  }, [refresh]);

  const save = useCallback(async (operation: () => Promise<Seed>, message: string) => {
    if (saving.current) return null;
    saving.current = true;
    version.current++;
    const originalContext = context.current;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const seed = await operation();
      if (!mounted.current || context.current !== originalContext) return null;
      setGrove((current) => ({ ...current, seeds: current.seeds.some((item) => item.id === seed.id)
        ? current.seeds.map((item) => item.id === seed.id ? seed : item)
        : [...current.seeds, seed] }));
      setNotice(message);
      return seed;
    } catch (reason) {
      if (mounted.current && context.current === originalContext) {
        setError(`Changes were not saved. ${reason instanceof Error ? reason.message : 'Please try again.'}`);
      }
      return null;
    } finally {
      saving.current = false;
      if (mounted.current) setBusy(false);
    }
  }, []);

  const updateSeed = useCallback((id: string, patch: SeedPatch, message = 'Seed updated.') =>
    save(() => api.updateSeed(meetingId, id, patch), message), [api, meetingId, save]);
  const createSeed = useCallback((seed: Seed) =>
    save(() => api.createSeed(seed), 'Your seed is planted.'), [api, save]);

  return { grove, loading, busy, error, notice, refresh, updateSeed, createSeed };
}
