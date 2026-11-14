import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  LogIn,
  ShieldCheck,
  UserPlus,
  XCircle,
} from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { sfx } from '../audio/sfxEngine';
import {
  USERNAME_REGEX,
  UsernameAvailability,
  useFirebase,
} from '../contexts/FirebaseContext';
import { FIREBASE_PROJECT_ID } from '../firebase';
import { AgeTier, PARENT_PIN_REGEX } from '../utils/chatGuard';
import { checkPolicyContent, detectExploitPayload } from '../utils/policyGuard';

type AuthTab = 'create' | 'login';

export function AuthGate() {
  const {
    user,
    accountProfile,
    signingIn,
    authError,
    needsEmailProviderEnable,
    triggerBan,
    clearAuthError,
    checkUsernameAvailability,
    registerAccount,
    loginAccount,
    completeAccountSetup,
    signInWithGoogle,
    signOut,
  } = useFirebase();

  const [tab, setTab] = useState<AuthTab>('create');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [agreedToPolicy, setAgreedToPolicy] = useState(false);
  const [ageTier, setAgeTier] = useState<AgeTier>('teen13_17');
  const [parentPin, setParentPin] = useState('');
  const [availability, setAvailability] =
    useState<UsernameAvailability>('idle');
  const [localValidationError, setLocalValidationError] = useState<
    string | null
  >(null);

  const needsProfileCompletion = Boolean(user && !accountProfile);
  const isCreateMode = tab === 'create' || needsProfileCompletion;

  // Live username availability check on Create Account / Profile Setup
  useEffect(() => {
    if (!isCreateMode) {
      setAvailability('idle');
      return;
    }

    const trimmed = username.trim();
    if (!trimmed) {
      setAvailability('idle');
      return;
    }

    if (!USERNAME_REGEX.test(trimmed)) {
      setAvailability('invalid');
      return;
    }

    let cancelled = false;
    setAvailability('checking');
    const timer = window.setTimeout(() => {
      void checkUsernameAvailability(trimmed)
        .then((isFree) => {
          if (!cancelled) {
            setAvailability(isFree ? 'available' : 'taken');
          }
        })
        .catch(() => {
          if (!cancelled) {
            setAvailability('error');
          }
        });
    }, 280);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [checkUsernameAvailability, isCreateMode, username]);

  const trimmedUsername = username.trim();
  const isUsernameValid = USERNAME_REGEX.test(trimmedUsername);
  const isPasswordValid = password.length >= 6;

  const handleGoogleLogin = async () => {
    sfx.playUiTick();
    setLocalValidationError(null);
    clearAuthError();
    await signInWithGoogle();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    sfx.playUiTick();
    setLocalValidationError(null);
    clearAuthError();

    if (
      detectExploitPayload(trimmedUsername) ||
      detectExploitPayload(password)
    ) {
      await triggerBan('hacking/exploits', 'nice try');
      return;
    }

    const policyCheck = checkPolicyContent(trimmedUsername);
    if (!policyCheck.allowed) {
      setLocalValidationError(
        'That username violates InputBench Policy Agreements.'
      );
      if (isCreateMode) {
        await triggerBan(
          'Policy violation: offensive or explicit username.',
          'Policy violation ban'
        );
      }
      return;
    }

    if (!isUsernameValid) {
      setLocalValidationError(
        'Username must be 3–20 characters using letters, numbers, underscores (_), or hyphens (-).'
      );
      return;
    }

    if (!needsProfileCompletion && !isPasswordValid) {
      setLocalValidationError('Password must have 6 or more characters.');
      return;
    }

    if (!agreedToPolicy) {
      setLocalValidationError(
        'You must tick the Policy Agreements checkbox before logging in.'
      );
      return;
    }

    if (
      isCreateMode &&
      parentPin.trim().length > 0 &&
      !PARENT_PIN_REGEX.test(parentPin.trim())
    ) {
      setLocalValidationError('Parent PIN must be 4 to 8 digits (numbers only).');
      return;
    }

    if (needsProfileCompletion) {
      await completeAccountSetup({
        username: trimmedUsername,
        agreedToPolicy,
        ageTier,
        parentPin: parentPin.trim() || undefined,
      });
      return;
    }

    if (tab === 'create') {
      if (availability === 'taken') {
        setLocalValidationError(
          `Username "${trimmedUsername}" is already taken — not allowed.`
        );
        return;
      }
      await registerAccount({
        username: trimmedUsername,
        password,
        agreedToPolicy,
        ageTier,
        parentPin: parentPin.trim() || undefined,
      });
    } else {
      await loginAccount({
        username: trimmedUsername,
        password,
        agreedToPolicy,
      });
    }
  };

  const displayError = localValidationError || authError;
  const consoleAuthUrl = `https://console.firebase.google.com/project/${FIREBASE_PROJECT_ID}/authentication/providers`;

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-md space-y-6">
        {/* Brand Header */}
        <div className="flex flex-col items-center text-center space-y-3">
          <img
            src="/app-icon.png"
            alt="InputBench icon"
            className="w-12 h-12 rounded-2xl object-cover border border-slate-200 dark:border-slate-700 shadow-sm"
          />
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
              {needsProfileCompletion
                ? 'Finish Account Setup'
                : 'InputBench Account'}
            </h1>
            <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
              {needsProfileCompletion
                ? 'Choose an available username and accept Policy Agreements to continue.'
                : 'Sign in with Google right away, or register a username and password.'}
            </p>
          </div>
        </div>

        {/* Auth Card */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm space-y-5">
          {!needsProfileCompletion && (
            <>
              <button
                type="button"
                disabled={signingIn}
                onClick={() => void handleGoogleLogin()}
                className="w-full py-2.5 px-4 rounded-xl text-sm font-semibold text-slate-900 dark:text-slate-100 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 border border-slate-300 dark:border-slate-700 flex items-center justify-center gap-2.5 transition-colors cursor-pointer disabled:opacity-50"
              >
                {signingIn ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
                    <path
                      fill="#EA4335"
                      d="M12 10.2v3.9h5.5c-.2 1.3-1.5 3.9-5.5 3.9-3.3 0-6-2.7-6-6s2.7-6 6-6c1.9 0 3.1.8 3.9 1.5l2.6-2.5C16.8 3.4 14.6 2.5 12 2.5 6.8 2.5 2.5 6.8 2.5 12s4.3 9.5 9.5 9.5c5.5 0 9.1-3.9 9.1-9.3 0-.6-.1-1.1-.2-1.6H12z"
                    />
                  </svg>
                )}
                <span>Continue with Google (Instant Sign-In)</span>
              </button>

              <div className="relative flex items-center py-0.5">
                <div className="flex-grow border-t border-slate-200 dark:border-slate-800" />
                <span className="shrink-0 mx-3 text-[11px] font-mono uppercase tracking-wider text-slate-400">
                  Or Username &amp; Password
                </span>
                <div className="flex-grow border-t border-slate-200 dark:border-slate-800" />
              </div>

              <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-xl">
                <button
                  type="button"
                  onClick={() => {
                    sfx.playUiTick();
                    setTab('create');
                    setLocalValidationError(null);
                    clearAuthError();
                  }}
                  className={`py-2 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
                    tab === 'create'
                      ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                  }`}
                >
                  Create Account
                </button>
                <button
                  type="button"
                  onClick={() => {
                    sfx.playUiTick();
                    setTab('login');
                    setLocalValidationError(null);
                    clearAuthError();
                  }}
                  className={`py-2 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
                    tab === 'login'
                      ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                  }`}
                >
                  Log In
                </button>
              </div>
            </>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* USERNAME */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <label
                  htmlFor="auth-username"
                  className="text-xs font-mono font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300"
                >
                  USERNAME
                </label>
                {isCreateMode && availability === 'checking' && (
                  <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-500 dark:text-slate-400">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    Checking...
                  </span>
                )}
                {isCreateMode && availability === 'available' && (
                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 className="w-3 h-3" />
                    Available
                  </span>
                )}
                {isCreateMode && availability === 'taken' && (
                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-rose-600 dark:text-rose-400">
                    <XCircle className="w-3 h-3" />
                    Taken · Not allowed
                  </span>
                )}
              </div>

              <input
                id="auth-username"
                type="text"
                autoComplete="username"
                maxLength={20}
                value={username}
                onChange={(e) => {
                  setUsername(e.target.value);
                  setLocalValidationError(null);
                }}
                placeholder="Enter an available username (3–20 chars)"
                className="w-full px-3.5 py-2.5 text-sm font-medium text-slate-900 dark:text-slate-100 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-xl outline-none focus:bg-white dark:focus:bg-slate-900 focus:border-blue-500"
              />
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                {availability === 'invalid'
                  ? 'Use 3–20 characters: letters, numbers, underscores (_), or hyphens (-).'
                  : isCreateMode
                  ? 'Any available username is allowed; taken usernames are blocked.'
                  : 'Enter your registered InputBench username.'}
              </p>
            </div>

            {/* PASSWORD */}
            {!needsProfileCompletion && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <label
                    htmlFor="auth-password"
                    className="text-xs font-mono font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300"
                  >
                    PASSWORD
                  </label>
                  <span
                    className={`text-[11px] font-mono font-semibold ${
                      password.length === 0
                        ? 'text-slate-500 dark:text-slate-400'
                        : isPasswordValid
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-amber-600 dark:text-amber-400'
                    }`}
                  >
                    {isPasswordValid
                      ? '6+ characters ✓'
                      : `${password.length}/6 min chars`}
                  </span>
                </div>

                <div className="relative">
                  <input
                    id="auth-password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete={
                      tab === 'create' ? 'new-password' : 'current-password'
                    }
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      setLocalValidationError(null);
                    }}
                    placeholder="At least 6 characters"
                    className="w-full pl-3.5 pr-10 py-2.5 text-sm font-medium text-slate-900 dark:text-slate-100 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-xl outline-none focus:bg-white dark:focus:bg-slate-900 focus:border-blue-500"
                  />
                  <button
                    type="button"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    onClick={() => setShowPassword((prev) => !prev)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
                  >
                    {showPassword ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>
            )}

            {/* AGE TIER & PARENTAL SAFETY (Create / Setup only) */}
            {isCreateMode && (
              <div className="space-y-2 pt-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-mono font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                    ACCOUNT AGE TIER
                  </span>
                  <span className="text-[11px] text-slate-500 dark:text-slate-400">
                    Server-enforced safety
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    {
                      id: 'under13' as AgeTier,
                      label: 'Under 13',
                      sub: 'Safe Presets Only',
                    },
                    {
                      id: 'teen13_17' as AgeTier,
                      label: '13 – 17',
                      sub: 'Filtered + PII Guard',
                    },
                    {
                      id: 'adult18plus' as AgeTier,
                      label: '18+',
                      sub: 'Filtered Friends',
                    },
                  ].map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => {
                        sfx.playUiTick();
                        setAgeTier(opt.id);
                      }}
                      className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                        ageTier === opt.id
                          ? 'bg-blue-50/80 dark:bg-blue-950/50 border-blue-500 ring-2 ring-blue-500/20'
                          : 'bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                      }`}
                    >
                      <div className="text-xs font-bold text-slate-900 dark:text-slate-100">
                        {opt.label}
                      </div>
                      <div className="text-[10px] text-slate-500 dark:text-slate-400 leading-tight mt-0.5">
                        {opt.sub}
                      </div>
                    </button>
                  ))}
                </div>

                {(ageTier === 'under13' || ageTier === 'teen13_17') && (
                  <div className="p-3 rounded-xl bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/60 space-y-1.5">
                    <label
                      htmlFor="auth-parent-pin"
                      className="block text-[11px] font-semibold text-amber-900 dark:text-amber-200"
                    >
                      Parent PIN Lock (Optional 4–8 digits — recommended for minors)
                    </label>
                    <input
                      id="auth-parent-pin"
                      type="password"
                      inputMode="numeric"
                      maxLength={8}
                      value={parentPin}
                      onChange={(e) => {
                        setParentPin(e.target.value.replace(/\D/g, ''));
                        setLocalValidationError(null);
                      }}
                      placeholder="Leave blank or enter 4–8 digit Parent PIN"
                      className="w-full px-3 py-2 text-xs font-mono text-slate-900 dark:text-slate-100 bg-white dark:bg-slate-900 border border-amber-300 dark:border-amber-800 rounded-lg outline-none focus:border-blue-500"
                    />
                  </div>
                )}
              </div>
            )}

            {/* POLICY AGREEMENTS */}
            <div className="space-y-2.5 pt-1">
              <div className="flex items-center gap-2 text-xs font-mono font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                <ShieldCheck className="w-4 h-4 accent-text shrink-0" />
                <span>POLICY AGREEMENTS</span>
              </div>

              <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800 space-y-2 text-xs text-slate-600 dark:text-slate-400">
                <ul className="list-disc pl-4 space-y-1">
                  <li>
                    I agree <strong>not</strong> to upload or play explicit,
                    NSFW, or offensive music, audio, or images.
                  </li>
                  <li>
                    I agree to play fairly on Global Leaderboards without macros,
                    autoclickers, or score tampering.
                  </li>
                </ul>

                <label className="pt-2 border-t border-slate-200 dark:border-slate-800 flex items-start gap-2.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={agreedToPolicy}
                    onChange={(e) => {
                      sfx.playUiTick();
                      setAgreedToPolicy(e.target.checked);
                      setLocalValidationError(null);
                    }}
                    className="mt-0.5 w-4 h-4 rounded accent-blue-600 cursor-pointer shrink-0"
                  />
                  <span className="text-xs font-semibold text-slate-900 dark:text-slate-100 leading-snug">
                    I tick to confirm and agree to all InputBench Policy
                    Agreements (required to log in).
                  </span>
                </label>
              </div>
            </div>

            {displayError && (
              <div className="flex items-start gap-2 p-3 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 text-xs text-rose-800 dark:text-rose-200">
                <AlertTriangle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
                <span>{displayError}</span>
              </div>
            )}

            {needsEmailProviderEnable && (
              <div className="p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-xs text-amber-900 dark:text-amber-200 space-y-2.5">
                <div className="font-semibold">
                  Use Google Sign-In Now (or enable Email/Password):
                </div>
                <p className="leading-relaxed">
                  Google Sign-In is active immediately and works with your
                  username above. If you also want Password-based login, enable{' '}
                  <strong>Email/Password</strong> in Firebase Authentication.
                </p>
                <div className="flex flex-wrap items-center gap-2 pt-0.5">
                  <button
                    type="button"
                    disabled={signingIn}
                    onClick={() => void handleGoogleLogin()}
                    className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-semibold cursor-pointer"
                  >
                    Sign In with Google Now
                  </button>
                  <a
                    href={consoleAuthUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 font-semibold text-blue-700 dark:text-blue-300 underline"
                  >
                    <span>Firebase Auth Providers</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={
                signingIn ||
                (isCreateMode && availability === 'taken') ||
                (isCreateMode && availability === 'checking')
              }
              className={`w-full py-3 px-4 rounded-xl text-sm font-semibold text-white flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                agreedToPolicy
                  ? 'accent-bg active:scale-[0.99]'
                  : 'bg-slate-400 dark:bg-slate-700'
              }`}
            >
              {signingIn ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : needsProfileCompletion ? (
                <ShieldCheck className="w-4 h-4" />
              ) : tab === 'create' ? (
                <UserPlus className="w-4 h-4" />
              ) : (
                <LogIn className="w-4 h-4" />
              )}
              <span>
                {signingIn
                  ? 'Processing...'
                  : needsProfileCompletion
                  ? 'Save Username & Enter InputBench'
                  : tab === 'create'
                  ? 'Create Account & Log In'
                  : 'Log In'}
              </span>
            </button>

            {!agreedToPolicy && (
              <p className="flex items-center justify-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                <Lock className="w-3 h-3" />
                <span>Tick Policy Agreements above to unlock login</span>
              </p>
            )}
          </form>

          {needsProfileCompletion && (
            <button
              type="button"
              onClick={() => void signOut()}
              className="w-full py-2 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 cursor-pointer"
            >
              Switch Account / Log Out
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
