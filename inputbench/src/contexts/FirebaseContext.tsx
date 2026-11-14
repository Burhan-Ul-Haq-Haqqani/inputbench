import { onAuthStateChanged, User } from 'firebase/auth';
import {
  deleteDoc,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  BoardKey,
  BOARD_META_MAP,
  LeaderboardSubmissionPayload,
} from '../data/leaderboards';
import {
  auth,
  createUserWithEmailAndPassword,
  db,
  deleteUser,
  EmailAuthProvider,
  googleProvider,
  handleFirestoreError,
  OperationType,
  reauthenticateWithCredential,
  reauthenticateWithPopup,
  signInWithEmailAndPassword,
  signInWithGooglePopup,
  signOutFirebase,
  updateProfile,
  usernameToAuthEmail,
} from '../firebase';
import { BenchmarkStore } from '../types/benchmark';
import {
  AgeTier,
  enforceAgeTierConstraints,
  getDefaultParentalControls,
  hashParentPin,
  PARENT_PIN_REGEX,
  ParentalControlConfig,
} from '../utils/chatGuard';
import {
  sanitizePlayerDisplayName,
  submitLeaderboardScore,
  syncAllLocalBestsToGlobal,
} from '../utils/leaderboardService';
import {
  BanState,
  loadLocalBanRecord,
  saveLocalBanRecord,
} from '../utils/policyGuard';
import {
  recordBlockedSafetyAttempt,
  saveParentalControls as saveParentalControlsDoc,
  subscribeParentalControls,
} from '../utils/socialService';

export const POLICY_VERSION = '2026-11';
export const USERNAME_REGEX = /^[a-zA-Z0-9_-]{3,20}$/;

export interface UserAccountProfile {
  uid: string;
  username: string;
  usernameLower: string;
  agreedToPolicy: boolean;
  policyVersion: string;
  banned?: boolean;
  banReason?: string;
  banMessage?: string;
}

export type UsernameAvailability =
  | 'idle'
  | 'invalid'
  | 'checking'
  | 'available'
  | 'taken'
  | 'error';

interface FirebaseContextValue {
  user: User | null;
  accountProfile: UserAccountProfile | null;
  parentalControls: ParentalControlConfig | null;
  parentalReady: boolean;
  hasPasswordProvider: boolean;
  authReady: boolean;
  accountLoading: boolean;
  signingIn: boolean;
  authError: string | null;
  needsEmailProviderEnable: boolean;
  displayName: string;
  syncingAll: boolean;
  statusBanner: string | null;
  banState: BanState | null;
  ipHash: string | null;
  triggerBan: (reason: string, message?: string) => Promise<void>;
  verifyPassword: (
    password: string
  ) => Promise<{ ok: boolean; error?: string }>;
  reauthenticateWithGoogle: () => Promise<{ ok: boolean; error?: string }>;
  clearStatusBanner: () => void;
  clearAuthError: () => void;
  checkUsernameAvailability: (username: string) => Promise<boolean>;
  registerAccount: (params: {
    username: string;
    password: string;
    agreedToPolicy: boolean;
    ageTier: AgeTier;
    parentPin?: string;
  }) => Promise<boolean>;
  loginAccount: (params: {
    username: string;
    password: string;
    agreedToPolicy: boolean;
  }) => Promise<boolean>;
  completeAccountSetup: (params: {
    username: string;
    agreedToPolicy: boolean;
    ageTier: AgeTier;
    parentPin?: string;
  }) => Promise<boolean>;
  signInWithGoogle: () => Promise<User | null>;
  signOut: () => Promise<void>;
  submitScore: (payload: LeaderboardSubmissionPayload) => Promise<void>;
  syncLocalStore: (
    store: BenchmarkStore,
    forceProfileSync?: boolean
  ) => Promise<number>;
  saveParentalSettings: (
    nextConfig: ParentalControlConfig
  ) => Promise<ParentalControlConfig>;
  incrementBlockedSafetyAttempt: () => Promise<void>;
}

const FirebaseContext = createContext<FirebaseContextValue | null>(null);

export function FirebaseProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [user, setUser] = useState<User | null>(null);
  const [accountProfile, setAccountProfile] =
    useState<UserAccountProfile | null>(null);
  const [parentalControls, setParentalControls] =
    useState<ParentalControlConfig | null>(null);
  const [parentalReady, setParentalReady] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [accountLoading, setAccountLoading] = useState(true);
  const [signingIn, setSigningIn] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [needsEmailProviderEnable, setNeedsEmailProviderEnable] =
    useState(false);
  const [syncingAll, setSyncingAll] = useState(false);
  const [statusBanner, setStatusBanner] = useState<string | null>(null);
  const [banState, setBanState] = useState<BanState | null>(() =>
    loadLocalBanRecord()
  );
  const [ipHash, setIpHash] = useState<string | null>(null);
  const banTriggeredRef = useRef(false);
  const initializingParentalRef = useRef<string | null>(null);

  const hasPasswordProvider = Boolean(
    user?.providerData?.some((p) => p.providerId === 'password')
  );

  const syncServerIpBan = useCallback(
    async (reason: string, message: string): Promise<string | null> => {
      try {
        const res = await fetch('/api/security', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ action: 'ban', reason, message }),
        });
        if (!res.ok) return null;
        const data = (await res.json()) as {
          ipHash?: string;
        };
        if (data.ipHash) {
          setIpHash(data.ipHash);
        }
        return data.ipHash ?? null;
      } catch {
        return null;
      }
    },
    []
  );

  const triggerBan = useCallback(
    async (reason: string, message = 'nice try') => {
      const cleanReason = reason.trim().slice(0, 200) || 'hacking/exploits';
      const cleanMessage = message.trim().slice(0, 120) || 'nice try';
      const nowIso = new Date().toISOString();

      if (!banTriggeredRef.current) {
        banTriggeredRef.current = true;
      }

      const nextBan: BanState = {
        banned: true,
        reason: cleanReason,
        message: cleanMessage,
        ipHash: ipHash ?? undefined,
        bannedAt: nowIso,
      };

      setBanState((prev) => prev ?? nextBan);
      saveLocalBanRecord(nextBan);

      const resolvedIpHash =
        (await syncServerIpBan(cleanReason, cleanMessage)) || ipHash;
      if (resolvedIpHash) {
        const enriched: BanState = {
          banned: true,
          reason: cleanReason,
          message: cleanMessage,
          ipHash: resolvedIpHash,
          bannedAt: nowIso,
        };
        setBanState((prev) =>
          prev ? { ...prev, ipHash: resolvedIpHash } : enriched
        );
        saveLocalBanRecord(enriched);
      }

      const currentUser = auth.currentUser;
      if (currentUser) {
        try {
          await updateDoc(doc(db, 'accounts', currentUser.uid), {
            banned: true,
            banReason: cleanReason,
            banMessage: cleanMessage,
            banVersion: 'v2',
            bannedAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        } catch {
          // Account may already be banned or signed out
        }

        if (resolvedIpHash && resolvedIpHash.length >= 16) {
          try {
            await setDoc(doc(db, 'ipBans', resolvedIpHash), {
              ipHash: resolvedIpHash,
              uid: currentUser.uid,
              reason: cleanReason,
              message: cleanMessage,
              banVersion: 'v2',
              createdAt: serverTimestamp(),
            });
          } catch {
            // IP ban already locked or unauthenticated
          }
        }
      }
    },
    [ipHash, syncServerIpBan]
  );

  const verifyPassword = useCallback(
    async (password: string): Promise<{ ok: boolean; error?: string }> => {
      const currentUser = auth.currentUser;
      if (!currentUser || !currentUser.email) {
        return {
          ok: false,
          error: 'You must be logged in to verify your password.',
        };
      }
      if (!password) {
        return { ok: false, error: 'Please enter your account password.' };
      }
      try {
        const cred = EmailAuthProvider.credential(currentUser.email, password);
        await reauthenticateWithCredential(currentUser, cred);
        return { ok: true };
      } catch (err: unknown) {
        const code =
          typeof err === 'object' && err !== null && 'code' in err
            ? String((err as { code?: unknown }).code)
            : '';
        if (
          code === 'auth/wrong-password' ||
          code === 'auth/invalid-credential'
        ) {
          return {
            ok: false,
            error: 'Incorrect password. Data deletion was blocked.',
          };
        }
        if (code === 'auth/too-many-requests') {
          return {
            ok: false,
            error: 'Too many failed password attempts. Please wait and try again.',
          };
        }
        return {
          ok: false,
          error: 'Password verification failed. Please check your password.',
        };
      }
    },
    []
  );

  const reauthenticateWithGoogle = useCallback(async (): Promise<{
    ok: boolean;
    error?: string;
  }> => {
    const currentUser = auth.currentUser;
    if (!currentUser) {
      return { ok: false, error: 'You must be logged in to verify.' };
    }
    try {
      await reauthenticateWithPopup(currentUser, googleProvider);
      return { ok: true };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '';
      if (msg.includes('popup-closed-by-user')) {
        return { ok: false, error: 'Google verification popup was closed.' };
      }
      if (msg.includes('user-mismatch')) {
        return {
          ok: false,
          error: 'Please verify with the same Google account you signed in with.',
        };
      }
      return {
        ok: false,
        error: 'Google verification failed. Allow popups and try again.',
      };
    }
  }, []);

  // Check server-side IP ban & cookie lock immediately on mount
  useEffect(() => {
    let cancelled = false;
    void fetch('/api/security', { credentials: 'include' })
      .then((res) => (res.ok ? res.json() : null))
      .then(
        (
          data: {
            ipHash?: string;
            banned?: boolean;
            reason?: string;
            message?: string;
            bannedAt?: string;
          } | null
        ) => {
          if (cancelled || !data) return;
          if (data.ipHash) setIpHash(data.ipHash);
          if (data.banned) {
            const serverBan: BanState = {
              banned: true,
              reason: data.reason || 'hacking/exploits',
              message: data.message || 'nice try',
              ipHash: data.ipHash,
              bannedAt: data.bannedAt,
            };
            setBanState(serverBan);
            saveLocalBanRecord(serverBan);
          }
        }
      )
      .catch(() => {
        // Ignore transient offline security fetch errors
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Also check Firestore ipBans when signed in and ipHash is known
  useEffect(() => {
    if (!user || !ipHash || ipHash.length < 16) return;
    let cancelled = false;
    void getDoc(doc(db, 'ipBans', ipHash))
      .then((snap) => {
        if (cancelled || !snap.exists()) return;
        const d = snap.data();
        if (d.banVersion !== 'v2') {
          void deleteDoc(doc(db, 'ipBans', ipHash)).catch(() => {});
          return;
        }
        const remoteIpBan: BanState = {
          banned: true,
          reason: String(d.reason ?? 'hacking/exploits'),
          message: String(d.message ?? 'nice try'),
          ipHash,
          bannedAt: new Date().toISOString(),
        };
        setBanState(remoteIpBan);
        saveLocalBanRecord(remoteIpBan);
        void syncServerIpBan(remoteIpBan.reason, remoteIpBan.message);
      })
      .catch(() => {
        // Ignore if not found or permission denied
      });
    return () => {
      cancelled = true;
    };
  }, [ipHash, syncServerIpBan, user]);

  // Subscribe to real-time Parental Controls for the signed-in user
  useEffect(() => {
    if (!user || !accountProfile?.agreedToPolicy) {
      setParentalControls(null);
      setParentalReady(false);
      return;
    }

    setParentalReady(false);
    const unsub = subscribeParentalControls(
      user.uid,
      (cfg) => {
        if (cfg) {
          setParentalControls(cfg);
          setParentalReady(true);
          return;
        }

        // Legacy account migration: initialize teen13_17 safe defaults if missing
        if (initializingParentalRef.current !== user.uid) {
          initializingParentalRef.current = user.uid;
          const fallback = getDefaultParentalControls(user.uid, 'teen13_17');
          void saveParentalControlsDoc(fallback, false)
            .then((saved) => {
              setParentalControls(saved);
              setParentalReady(true);
            })
            .catch(() => {
              setParentalControls(fallback);
              setParentalReady(true);
            });
        }
      },
      () => {
        setParentalReady(true);
      }
    );

    return () => unsub();
  }, [accountProfile?.agreedToPolicy, user]);

  const loadAccountProfile = useCallback(
    async (firebaseUser: User | null) => {
      if (!firebaseUser) {
        setAccountProfile(null);
        setAccountLoading(false);
        return;
      }

      setAccountLoading(true);
      const path = `accounts/${firebaseUser.uid}`;
      try {
        const snap = await getDoc(doc(db, 'accounts', firebaseUser.uid));
        if (snap.exists()) {
          const data = snap.data();
          const hasLegacyFalsePositiveBan =
            Boolean(data.banned) && data.banVersion !== 'v2';

          if (hasLegacyFalsePositiveBan) {
            try {
              await updateDoc(doc(db, 'accounts', firebaseUser.uid), {
                banned: false,
                updatedAt: serverTimestamp(),
              });
            } catch {
              // Ignore cleanup failure
            }
          }

          const isAccountBanned =
            Boolean(data.banned) && data.banVersion === 'v2';
          setAccountProfile({
            uid: String(data.uid ?? firebaseUser.uid),
            username: String(data.username ?? firebaseUser.displayName ?? 'Player'),
            usernameLower: String(data.usernameLower ?? ''),
            agreedToPolicy: Boolean(data.agreedToPolicy),
            policyVersion: String(data.policyVersion ?? POLICY_VERSION),
            banned: isAccountBanned,
            banReason: data.banReason ? String(data.banReason) : undefined,
            banMessage: data.banMessage ? String(data.banMessage) : undefined,
          });
          if (isAccountBanned) {
            const accBan: BanState = {
              banned: true,
              reason: String(data.banReason ?? 'Policy violation'),
              message: String(data.banMessage ?? 'nice try'),
              ipHash: ipHash ?? undefined,
              bannedAt: new Date().toISOString(),
            };
            setBanState(accBan);
            saveLocalBanRecord(accBan);
            void syncServerIpBan(accBan.reason, accBan.message);
          } else if (banState?.banned && !banTriggeredRef.current) {
            void triggerBan(banState.reason, banState.message);
          }
        } else {
          setAccountProfile(null);
        }
      } catch (err) {
        try {
          handleFirestoreError(err, OperationType.GET, path);
        } catch {
          setAccountProfile(null);
        }
      } finally {
        setAccountLoading(false);
      }
    },
    [banState, ipHash, syncServerIpBan, triggerBan]
  );

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser);
      setAuthReady(true);
      void loadAccountProfile(firebaseUser);
    });
    return () => unsub();
  }, [loadAccountProfile]);

  const displayName = sanitizePlayerDisplayName(
    accountProfile?.username || user?.displayName,
    'InputBench Player'
  );

  const checkUsernameAvailability = useCallback(
    async (username: string): Promise<boolean> => {
      const trimmed = username.trim();
      if (!USERNAME_REGEX.test(trimmed)) return false;
      const lower = trimmed.toLowerCase();
      const path = `usernames/${lower}`;
      try {
        const snap = await getDoc(doc(db, 'usernames', lower));
        return !snap.exists();
      } catch (err) {
        handleFirestoreError(err, OperationType.GET, path);
      }
    },
    []
  );

  const registerAccount = useCallback(
    async ({
      username,
      password,
      agreedToPolicy,
      ageTier,
      parentPin,
    }: {
      username: string;
      password: string;
      agreedToPolicy: boolean;
      ageTier: AgeTier;
      parentPin?: string;
    }): Promise<boolean> => {
      setAuthError(null);
      setNeedsEmailProviderEnable(false);

      const trimmed = username.trim();
      if (!USERNAME_REGEX.test(trimmed)) {
        setAuthError(
          'Username must be 3–20 characters using only letters, numbers, underscores (_), or hyphens (-).'
        );
        return false;
      }
      if (password.length < 6) {
        setAuthError('Password must be 6 or more characters.');
        return false;
      }
      if (!agreedToPolicy) {
        setAuthError(
          'You must tick the Policy Agreements checkbox before creating an account.'
        );
        return false;
      }
      if (parentPin && parentPin.trim().length > 0 && !PARENT_PIN_REGEX.test(parentPin.trim())) {
        setAuthError('Parent PIN must be 4 to 8 numeric digits.');
        return false;
      }

      const lower = trimmed.toLowerCase();
      setSigningIn(true);

      try {
        const available = await checkUsernameAvailability(trimmed);
        if (!available) {
          setAuthError(
            `Username "${trimmed}" is already taken and not allowed. Choose another username.`
          );
          return false;
        }

        const cred = await createUserWithEmailAndPassword(
          auth,
          usernameToAuthEmail(lower),
          password
        );

        try {
          await updateProfile(cred.user, { displayName: trimmed });

          const pinHash =
            parentPin && parentPin.trim().length > 0
              ? await hashParentPin(parentPin.trim(), cred.user.uid)
              : undefined;
          const initialParental = getDefaultParentalControls(
            cred.user.uid,
            ageTier,
            pinHash
          );

          const batch = writeBatch(db);
          batch.set(doc(db, 'usernames', lower), {
            uid: cred.user.uid,
            username: trimmed,
            createdAt: serverTimestamp(),
          });
          batch.set(doc(db, 'accounts', cred.user.uid), {
            uid: cred.user.uid,
            username: trimmed,
            usernameLower: lower,
            agreedToPolicy: true,
            policyVersion: POLICY_VERSION,
            policyAgreedAt: serverTimestamp(),
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
          batch.set(doc(db, 'parentalControls', cred.user.uid), {
            uid: cred.user.uid,
            ageTier: initialParental.ageTier,
            chatMode: initialParental.chatMode,
            allowFriendRequests: initialParental.allowFriendRequests,
            requireParentApproval: initialParental.requireParentApproval,
            blockPiiAndLinks: initialParental.blockPiiAndLinks,
            allowCustomMedia: initialParental.allowCustomMedia,
            parentPinEnabled: initialParental.parentPinEnabled,
            pinHash: initialParental.pinHash ?? '',
            blockedAttemptsCount: 0,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
          await batch.commit();

          const profile: UserAccountProfile = {
            uid: cred.user.uid,
            username: trimmed,
            usernameLower: lower,
            agreedToPolicy: true,
            policyVersion: POLICY_VERSION,
          };
          setAccountProfile(profile);
          setParentalControls(initialParental);
          setParentalReady(true);
          setStatusBanner(
            `Welcome, ${trimmed}! Account created with ${
              ageTier === 'under13'
                ? 'Under-13 Child Safety Lock'
                : ageTier === 'teen13_17'
                ? 'Teen Safety Shield'
                : 'Adult Safety Filter'
            } active.`
          );
          return true;
        } catch (firestoreErr) {
          try {
            await deleteUser(cred.user);
          } catch {
            // Ignore cleanup failure
          }
          setAuthError(
            'That username was just claimed or rejected by security rules. Please try another username.'
          );
          console.error('Account batch failed:', firestoreErr);
          return false;
        }
      } catch (err: unknown) {
        const code =
          typeof err === 'object' && err !== null && 'code' in err
            ? String((err as { code?: unknown }).code)
            : '';
        if (code === 'auth/operation-not-allowed') {
          setNeedsEmailProviderEnable(true);
          setAuthError(
            'Email/Password sign-in is disabled in Firebase Console. Use "Continue with Google" below (works immediately) or enable Email/Password in Firebase Console.'
          );
        } else if (code === 'auth/email-already-in-use') {
          setAuthError(
            `Username "${trimmed}" is already registered. Choose another username or switch to Log In.`
          );
        } else if (code === 'auth/weak-password') {
          setAuthError('Password must be 6 or more characters.');
        } else {
          setAuthError(
            err instanceof Error ? err.message : 'Unable to create account.'
          );
        }
        return false;
      } finally {
        setSigningIn(false);
      }
    },
    [checkUsernameAvailability]
  );

  const loginAccount = useCallback(
    async ({
      username,
      password,
      agreedToPolicy,
    }: {
      username: string;
      password: string;
      agreedToPolicy: boolean;
    }): Promise<boolean> => {
      setAuthError(null);
      setNeedsEmailProviderEnable(false);

      const trimmed = username.trim();
      if (!USERNAME_REGEX.test(trimmed)) {
        setAuthError('Enter a valid username (3–20 characters).');
        return false;
      }
      if (password.length < 6) {
        setAuthError('Password must be 6 or more characters.');
        return false;
      }
      if (!agreedToPolicy) {
        setAuthError(
          'You must tick the Policy Agreements checkbox before logging in.'
        );
        return false;
      }

      const lower = trimmed.toLowerCase();
      setSigningIn(true);

      try {
        const cred = await signInWithEmailAndPassword(
          auth,
          usernameToAuthEmail(lower),
          password
        );

        const accountRef = doc(db, 'accounts', cred.user.uid);
        const snap = await getDoc(accountRef);
        if (snap.exists()) {
          await updateDoc(accountRef, {
            agreedToPolicy: true,
            policyVersion: POLICY_VERSION,
            policyAgreedAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
          await loadAccountProfile(cred.user);
        } else {
          const initialParental = getDefaultParentalControls(
            cred.user.uid,
            'teen13_17'
          );
          const batch = writeBatch(db);
          batch.set(doc(db, 'usernames', lower), {
            uid: cred.user.uid,
            username: trimmed,
            createdAt: serverTimestamp(),
          });
          batch.set(accountRef, {
            uid: cred.user.uid,
            username: trimmed,
            usernameLower: lower,
            agreedToPolicy: true,
            policyVersion: POLICY_VERSION,
            policyAgreedAt: serverTimestamp(),
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
          batch.set(doc(db, 'parentalControls', cred.user.uid), {
            uid: cred.user.uid,
            ageTier: initialParental.ageTier,
            chatMode: initialParental.chatMode,
            allowFriendRequests: initialParental.allowFriendRequests,
            requireParentApproval: initialParental.requireParentApproval,
            blockPiiAndLinks: initialParental.blockPiiAndLinks,
            allowCustomMedia: initialParental.allowCustomMedia,
            parentPinEnabled: false,
            pinHash: '',
            blockedAttemptsCount: 0,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
          await batch.commit();
          await loadAccountProfile(cred.user);
        }

        setStatusBanner(`Logged in as ${trimmed}.`);
        return true;
      } catch (err: unknown) {
        const code =
          typeof err === 'object' && err !== null && 'code' in err
            ? String((err as { code?: unknown }).code)
            : '';
        if (code === 'auth/operation-not-allowed') {
          setNeedsEmailProviderEnable(true);
          setAuthError(
            'Email/Password sign-in is disabled in Firebase Console. Use "Continue with Google" below (works immediately) or enable Email/Password in Firebase Console.'
          );
        } else if (
          code === 'auth/invalid-credential' ||
          code === 'auth/wrong-password' ||
          code === 'auth/user-not-found'
        ) {
          setAuthError('Incorrect username or password.');
        } else if (code === 'auth/too-many-requests') {
          setAuthError(
            'Too many failed attempts. Please wait a moment and try again.'
          );
        } else {
          setAuthError(
            'Unable to log in. Please check your username and password.'
          );
        }
        return false;
      } finally {
        setSigningIn(false);
      }
    },
    [loadAccountProfile]
  );

  const completeAccountSetup = useCallback(
    async ({
      username,
      agreedToPolicy,
      ageTier,
      parentPin,
    }: {
      username: string;
      agreedToPolicy: boolean;
      ageTier: AgeTier;
      parentPin?: string;
    }): Promise<boolean> => {
      if (!user) return false;
      setAuthError(null);

      const trimmed = username.trim();
      if (!USERNAME_REGEX.test(trimmed)) {
        setAuthError(
          'Username must be 3–20 characters (letters, numbers, _ or -).'
        );
        return false;
      }
      if (!agreedToPolicy) {
        setAuthError('You must tick the Policy Agreements checkbox to continue.');
        return false;
      }
      if (parentPin && parentPin.trim().length > 0 && !PARENT_PIN_REGEX.test(parentPin.trim())) {
        setAuthError('Parent PIN must be 4 to 8 numeric digits.');
        return false;
      }

      const lower = trimmed.toLowerCase();
      setSigningIn(true);
      try {
        const available = await checkUsernameAvailability(trimmed);
        if (!available) {
          setAuthError(`Username "${trimmed}" is already taken.`);
          return false;
        }
        await updateProfile(user, { displayName: trimmed });

        const pinHash =
          parentPin && parentPin.trim().length > 0
            ? await hashParentPin(parentPin.trim(), user.uid)
            : undefined;
        const initialParental = getDefaultParentalControls(
          user.uid,
          ageTier,
          pinHash
        );

        const batch = writeBatch(db);
        batch.set(doc(db, 'usernames', lower), {
          uid: user.uid,
          username: trimmed,
          createdAt: serverTimestamp(),
        });
        batch.set(doc(db, 'accounts', user.uid), {
          uid: user.uid,
          username: trimmed,
          usernameLower: lower,
          agreedToPolicy: true,
          policyVersion: POLICY_VERSION,
          policyAgreedAt: serverTimestamp(),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        batch.set(doc(db, 'parentalControls', user.uid), {
          uid: user.uid,
          ageTier: initialParental.ageTier,
          chatMode: initialParental.chatMode,
          allowFriendRequests: initialParental.allowFriendRequests,
          requireParentApproval: initialParental.requireParentApproval,
          blockPiiAndLinks: initialParental.blockPiiAndLinks,
          allowCustomMedia: initialParental.allowCustomMedia,
          parentPinEnabled: initialParental.parentPinEnabled,
          pinHash: initialParental.pinHash ?? '',
          blockedAttemptsCount: 0,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        await batch.commit();
        await loadAccountProfile(user);
        setStatusBanner(`Welcome, ${trimmed}!`);
        return true;
      } catch {
        setAuthError('Unable to claim that username. Please try another.');
        return false;
      } finally {
        setSigningIn(false);
      }
    },
    [checkUsernameAvailability, loadAccountProfile, user]
  );

  const signInWithGoogle = useCallback(async (): Promise<User | null> => {
    setAuthError(null);
    setNeedsEmailProviderEnable(false);
    setSigningIn(true);
    try {
      const cred = await signInWithGooglePopup();
      return cred.user;
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Google sign-in was cancelled.';
      if (!msg.includes('popup-closed-by-user')) {
        setAuthError(
          'Unable to complete Google sign-in. Please allow popups and try again.'
        );
      }
      return null;
    } finally {
      setSigningIn(false);
    }
  }, []);

  const signOut = useCallback(async () => {
    setAuthError(null);
    await signOutFirebase();
    setAccountProfile(null);
    setParentalControls(null);
    setParentalReady(false);
    setStatusBanner(null);
  }, []);

  const submitScore = useCallback(
    async (payload: LeaderboardSubmissionPayload) => {
      if (
        !user ||
        !accountProfile?.agreedToPolicy ||
        accountProfile.banned ||
        banState?.banned
      ) {
        return;
      }
      try {
        const res = await submitLeaderboardScore(
          user,
          accountProfile.username,
          payload
        );
        if (res.status === 'created' || res.status === 'improved') {
          const meta = BOARD_META_MAP[payload.boardKey as BoardKey];
          setStatusBanner(
            `Global PB posted to ${meta.gameLabel} (${meta.boardLabel}): ${payload.scoreLabel}`
          );
        }
      } catch {
        // Error formatted and logged via handleFirestoreError
      }
    },
    [accountProfile, banState?.banned, user]
  );

  const syncLocalStore = useCallback(
    async (store: BenchmarkStore, forceProfileSync = false) => {
      if (
        !user ||
        !accountProfile?.agreedToPolicy ||
        accountProfile.banned ||
        banState?.banned
      ) {
        return 0;
      }
      setSyncingAll(true);
      try {
        const { uploaded } = await syncAllLocalBestsToGlobal(
          user,
          accountProfile.username,
          store,
          forceProfileSync
        );
        setStatusBanner(
          uploaded > 0
            ? `Synced ${uploaded} personal best${uploaded === 1 ? '' : 's'} to Global Leaderboards.`
            : 'All local personal bests are already synced globally.'
        );
        return uploaded;
      } finally {
        setSyncingAll(false);
      }
    },
    [accountProfile, banState?.banned, user]
  );

  const saveParentalSettings = useCallback(
    async (nextConfig: ParentalControlConfig): Promise<ParentalControlConfig> => {
      const normalized = enforceAgeTierConstraints(nextConfig);
      const saved = await saveParentalControlsDoc(
        normalized,
        Boolean(parentalControls)
      );
      setParentalControls(saved);
      setStatusBanner('Parental Controls updated and enforced on server.');
      return saved;
    },
    [parentalControls]
  );

  const incrementBlockedSafetyAttempt = useCallback(async () => {
    if (!user) return;
    await recordBlockedSafetyAttempt(user.uid);
  }, [user]);

  return (
    <FirebaseContext.Provider
      value={{
        user,
        accountProfile,
        parentalControls,
        parentalReady,
        hasPasswordProvider,
        authReady,
        accountLoading,
        signingIn,
        authError,
        needsEmailProviderEnable,
        displayName,
        syncingAll,
        statusBanner,
        banState,
        ipHash,
        triggerBan,
        verifyPassword,
        reauthenticateWithGoogle,
        clearStatusBanner: () => setStatusBanner(null),
        clearAuthError: () => setAuthError(null),
        checkUsernameAvailability,
        registerAccount,
        loginAccount,
        completeAccountSetup,
        signInWithGoogle,
        signOut,
        submitScore,
        syncLocalStore,
        saveParentalSettings,
        incrementBlockedSafetyAttempt,
      }}
    >
      {children}
    </FirebaseContext.Provider>
  );
}

export function useFirebase() {
  const ctx = useContext(FirebaseContext);
  if (!ctx) {
    throw new Error('useFirebase must be used inside FirebaseProvider');
  }
  return ctx;
}
