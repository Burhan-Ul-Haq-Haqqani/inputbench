import { AlertTriangle, Eye, EyeOff, Loader2, Lock, X } from 'lucide-react';
import React, { useState } from 'react';
import { sfx } from '../audio/sfxEngine';
import { useFirebase } from '../contexts/FirebaseContext';

interface PasswordConfirmModalProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  onCancel: () => void;
  onConfirmed: () => Promise<void> | void;
}

export function PasswordConfirmModal({
  open,
  title,
  description,
  confirmLabel = 'Verify & Delete',
  onCancel,
  onConfirmed,
}: PasswordConfirmModalProps) {
  const { hasPasswordProvider, verifyPassword, reauthenticateWithGoogle } =
    useFirebase();
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    sfx.playUiTick();
    setError(null);

    if (hasPasswordProvider && !password) {
      setError('Enter your account password to delete data.');
      return;
    }

    setSubmitting(true);
    try {
      const check = hasPasswordProvider
        ? await verifyPassword(password)
        : await reauthenticateWithGoogle();
      if (!check.ok) {
        setError(
          check.error ||
            (hasPasswordProvider
              ? 'Incorrect password. Deletion blocked.'
              : 'Account verification failed. Deletion blocked.')
        );
        return;
      }
      await onConfirmed();
      setPassword('');
      setError(null);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[100] bg-slate-950/65 backdrop-blur-xs flex items-center justify-center p-4"
    >
      <div className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-800 flex items-center justify-center text-rose-600 dark:text-rose-400 shrink-0">
              <Lock className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                {title}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {hasPasswordProvider
                  ? 'Account password verification required'
                  : 'Google account verification required'}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              setPassword('');
              setError(null);
              onCancel();
            }}
            className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
            aria-label="Close verification dialog"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
          {description}
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          {hasPasswordProvider ? (
            <div className="space-y-1.5">
              <label
                htmlFor="delete-verify-password"
                className="text-xs font-mono font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300"
              >
                Confirm Account Password
              </label>
              <div className="relative">
                <input
                  id="delete-verify-password"
                  type={showPassword ? 'text' : 'password'}
                  autoFocus
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setError(null);
                  }}
                  placeholder="Enter your password"
                  className="w-full pl-3.5 pr-10 py-2.5 text-sm font-medium text-slate-900 dark:text-slate-100 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-xl outline-none focus:bg-white dark:focus:bg-slate-900 focus:border-blue-500"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? (
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>
          ) : (
            <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-400">
              Your session uses Google Sign-In. Click below to re-verify with
              your Google account before deleting data.
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 p-3 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 text-xs text-rose-800 dark:text-rose-200">
              <AlertTriangle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <div className="flex items-center justify-end gap-2.5 pt-1">
            <button
              type="button"
              disabled={submitting}
              onClick={() => {
                setPassword('');
                setError(null);
                onCancel();
              }}
              className="px-4 py-2 text-xs font-semibold text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded-lg cursor-pointer disabled:opacity-50"
            >
              {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              <span>
                {submitting
                  ? 'Verifying...'
                  : hasPasswordProvider
                  ? confirmLabel
                  : 'Verify with Google & Delete'}
              </span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
