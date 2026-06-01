import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAppStore } from '@/stores/appStore';
import { memoApi } from '@/lib/api';

const DURATION = 5000;

export function DeleteToast() {
  const toast = useAppStore((s) => s.deleteToast);
  const clearDeleteToast = useAppStore((s) => s.clearDeleteToast);
  const queryClient = useQueryClient();
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const undoneRef = useRef(false);

  useEffect(() => {
    if (!toast) return;
    undoneRef.current = false;
    setTimeLeft(DURATION);

    intervalRef.current = setInterval(() => {
      setTimeLeft((t) => Math.max(0, t - 100));
    }, 100);

    timerRef.current = setTimeout(async () => {
      if (!undoneRef.current) {
        // Time's up — embeddings + hard delete not needed; soft delete already done.
        // Optionally: purge embeddings here in background.
      }
      clearDeleteToast();
    }, DURATION);

    return () => {
      clearInterval(intervalRef.current!);
      clearTimeout(timerRef.current!);
    };
  }, [toast?.memoId]);

  const handleUndo = async () => {
    if (!toast) return;
    undoneRef.current = true;
    clearInterval(intervalRef.current!);
    clearTimeout(timerRef.current!);
    try {
      await memoApi.restore(toast.memoId);
      queryClient.invalidateQueries({ queryKey: ['memos'] });
      queryClient.invalidateQueries({ queryKey: ['memos', 'pinned'] });
    } catch (e) {
      console.error(e);
    }
    clearDeleteToast();
  };

  if (!toast) return null;

  const pct = (timeLeft / DURATION) * 100;

  return (
    <div className="om-delete-toast" role="status" aria-live="polite">
      <span className="om-delete-toast-text">
        <strong>"{toast.title}"</strong> deleted
      </span>
      <button className="om-delete-toast-undo" onClick={handleUndo}>
        Undo
      </button>
      <div className="om-delete-toast-bar" style={{ width: `${pct}%` }} />
    </div>
  );
}
