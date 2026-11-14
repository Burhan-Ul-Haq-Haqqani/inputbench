import {
  AlertTriangle,
  Ban,
  Check,
  CheckCircle2,
  Flag,
  Lock,
  MessageSquare,
  Send,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Unlock,
  UserCheck,
  UserMinus,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { sfx } from '../audio/sfxEngine';
import { useFirebase } from '../contexts/FirebaseContext';
import {
  AgeTier,
  ChatMode,
  checkChatSafety,
  enforceAgeTierConstraints,
  hashParentPin,
  PARENT_PIN_REGEX,
  ParentalControlConfig,
  SAFE_CHAT_PRESETS,
  SafetyReportCategory,
} from '../utils/chatGuard';
import {
  acceptFriendRequest,
  blockFriendRelationship,
  ChatMessageRecord,
  FriendshipRecord,
  getFriendPeer,
  removeOrCancelFriendship,
  sendChatMessage,
  sendFriendRequest,
  submitSafetyReport,
  subscribeChatMessages,
  subscribeFriendships,
} from '../utils/socialService';

type SubView = 'chat' | 'parental';

interface FriendsChatTabProps {
  initialView?: SubView;
}

export function FriendsChatTab({ initialView = 'chat' }: FriendsChatTabProps) {
  const {
    user,
    accountProfile,
    parentalControls,
    saveParentalSettings,
    incrementBlockedSafetyAttempt,
    triggerBan,
  } = useFirebase();

  const [subView, setSubView] = useState<SubView>(initialView);
  const [friendships, setFriendships] = useState<FriendshipRecord[]>([]);
  const [selectedPairId, setSelectedPairId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessageRecord[]>([]);

  // Add friend state
  const [targetUsername, setTargetUsername] = useState('');
  const [friendActionMsg, setFriendActionMsg] = useState<{
    type: 'ok' | 'err';
    text: string;
  } | null>(null);
  const [sendingRequest, setSendingRequest] = useState(false);

  // Chat composer state
  const [chatInput, setChatInput] = useState('');
  const [chatFeedback, setChatFeedback] = useState<string | null>(null);
  const [peerRequiresPresets, setPeerRequiresPresets] = useState(false);
  const [showQuickPresets, setShowQuickPresets] = useState(false);
  const [sendingMsg, setSendingMsg] = useState(false);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);

  // Parent PIN approval modal for friend requests
  const [pinApprovalPrompt, setPinApprovalPrompt] = useState<{
    label: string;
    onApproved: () => Promise<void>;
  } | null>(null);
  const [approvalPinInput, setApprovalPinInput] = useState('');
  const [approvalPinError, setApprovalPinError] = useState<string | null>(null);

  // Report modal state
  const [reportTarget, setReportTarget] = useState<{
    pairId: string;
    peerUid: string;
    peerUsername: string;
    excerpt: string;
  } | null>(null);
  const [reportCategory, setReportCategory] = useState<SafetyReportCategory>(
    'grooming_solicitation'
  );
  const [reportDetails, setReportDetails] = useState('');
  const [reportAlsoBlock, setReportAlsoBlock] = useState(true);
  const [reportBusy, setReportBusy] = useState(false);

  // Parental controls dashboard state
  const [parentUnlocked, setParentUnlocked] = useState(false);
  const [unlockPinInput, setUnlockPinInput] = useState('');
  const [unlockPinError, setUnlockPinError] = useState<string | null>(null);
  const [draftConfig, setDraftConfig] = useState<ParentalControlConfig | null>(
    null
  );
  const [newPin, setNewPin] = useState('');
  const [confirmNewPin, setConfirmNewPin] = useState('');
  const [pinSaveMsg, setPinSaveMsg] = useState<string | null>(null);
  const [savingParental, setSavingParental] = useState(false);

  useEffect(() => {
    setSubView(initialView);
  }, [initialView]);

  useEffect(() => {
    if (parentalControls) {
      setDraftConfig(parentalControls);
      if (!parentalControls.parentPinEnabled) {
        setParentUnlocked(true);
      }
    }
  }, [parentalControls]);

  useEffect(() => {
    if (!user) return;
    const unsub = subscribeFriendships(
      user.uid,
      (rows) => {
        setFriendships(rows);
      },
      () => {
        // Handled cleanly in empty state
      }
    );
    return () => unsub();
  }, [user]);

  const { acceptedFriends, incomingRequests, outgoingRequests, blockedByMe } =
    useMemo(() => {
      const accepted: FriendshipRecord[] = [];
      const incoming: FriendshipRecord[] = [];
      const outgoing: FriendshipRecord[] = [];
      const blocked: FriendshipRecord[] = [];
      if (!user) {
        return {
          acceptedFriends: accepted,
          incomingRequests: incoming,
          outgoingRequests: outgoing,
          blockedByMe: blocked,
        };
      }
      for (const f of friendships) {
        if (f.status === 'accepted') accepted.push(f);
        else if (f.status === 'pending') {
          if (f.requestedBy === user.uid) outgoing.push(f);
          else incoming.push(f);
        } else if (f.status === 'blocked' && f.blockedBy === user.uid) {
          blocked.push(f);
        }
      }
      return {
        acceptedFriends: accepted,
        incomingRequests: incoming,
        outgoingRequests: outgoing,
        blockedByMe: blocked,
      };
    }, [friendships, user]);

  useEffect(() => {
    if (
      selectedPairId &&
      acceptedFriends.some((f) => f.pairId === selectedPairId)
    ) {
      return;
    }
    setSelectedPairId(acceptedFriends[0]?.pairId ?? null);
  }, [acceptedFriends, selectedPairId]);

  const activeFriendship = useMemo(
    () => acceptedFriends.find((f) => f.pairId === selectedPairId) ?? null,
    [acceptedFriends, selectedPairId]
  );

  useEffect(() => {
    setPeerRequiresPresets(false);
    setChatFeedback(null);
    if (!user || !activeFriendship) {
      setMessages([]);
      return;
    }
    const unsub = subscribeChatMessages(
      activeFriendship.pairId,
      user.uid,
      (rows) => setMessages(rows),
      () => setMessages([])
    );
    return () => unsub();
  }, [activeFriendship, user]);

  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [messages.length, selectedPairId]);

  if (!user || !accountProfile) return null;

  const effectiveParental = parentalControls;
  const effectiveChatMode: ChatMode =
    effectiveParental?.chatMode ?? 'friends_filtered';
  const forceSafePresets =
    effectiveChatMode === 'friends_safe_presets' || peerRequiresPresets;

  const runWithOptionalParentApproval = (
    label: string,
    action: () => Promise<void>
  ) => {
    if (
      effectiveParental?.requireParentApproval &&
      effectiveParental?.parentPinEnabled &&
      effectiveParental.pinHash &&
      !parentUnlocked
    ) {
      setApprovalPinInput('');
      setApprovalPinError(null);
      setPinApprovalPrompt({ label, onApproved: action });
      return;
    }
    void action();
  };

  const handleConfirmPinApproval = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pinApprovalPrompt || !effectiveParental?.pinHash) return;
    if (!PARENT_PIN_REGEX.test(approvalPinInput.trim())) {
      setApprovalPinError('Enter your 4–8 digit Parent PIN.');
      return;
    }
    const hash = await hashParentPin(approvalPinInput.trim(), user.uid);
    if (hash !== effectiveParental.pinHash) {
      setApprovalPinError('Incorrect Parent PIN.');
      return;
    }
    const fn = pinApprovalPrompt.onApproved;
    setPinApprovalPrompt(null);
    await fn();
  };

  const handleSendFriendRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    sfx.playUiTick();
    setFriendActionMsg(null);

    if (effectiveParental && !effectiveParental.allowFriendRequests) {
      setFriendActionMsg({
        type: 'err',
        text: 'Friend requests are disabled in your Parental Controls.',
      });
      return;
    }

    const clean = targetUsername.trim();
    if (!clean) return;

    runWithOptionalParentApproval(
      `Approve sending a friend request to "${clean}"`,
      async () => {
        setSendingRequest(true);
        try {
          const res = await sendFriendRequest({
            myUid: user.uid,
            myUsername: accountProfile.username,
            targetUsername: clean,
          });
          setFriendActionMsg({
            type: res.ok ? 'ok' : 'err',
            text: res.message,
          });
          if (res.ok) setTargetUsername('');
        } finally {
          setSendingRequest(false);
        }
      }
    );
  };

  const handleAcceptRequest = (f: FriendshipRecord) => {
    const peer = getFriendPeer(f, user.uid);
    sfx.playUiTick();
    setFriendActionMsg(null);
    runWithOptionalParentApproval(
      `Approve adding "${peer.username}" as a friend`,
      async () => {
        const res = await acceptFriendRequest(f.pairId);
        if (!res.ok) {
          setFriendActionMsg({
            type: 'err',
            text: res.error || 'Could not accept friend request.',
          });
        } else {
          setSelectedPairId(f.pairId);
          setFriendActionMsg({
            type: 'ok',
            text: `You are now friends with ${peer.username}!`,
          });
        }
      }
    );
  };

  const handleSendPreset = async (presetText: string) => {
    if (!activeFriendship || sendingMsg) return;
    if (effectiveChatMode === 'off') {
      setChatFeedback('Chat is disabled by Parental Controls.');
      return;
    }
    sfx.playUiTick();
    setChatFeedback(null);
    setSendingMsg(true);
    try {
      const res = await sendChatMessage({
        pairId: activeFriendship.pairId,
        participants: activeFriendship.participants,
        senderUid: user.uid,
        senderUsername: accountProfile.username,
        kind: 'preset',
        text: presetText,
      });
      if (!res.ok) {
        setChatFeedback(res.error || 'Unable to send message.');
      }
    } finally {
      setSendingMsg(false);
    }
  };

  const handleSendFreeText = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeFriendship || sendingMsg) return;
    if (effectiveChatMode === 'off') {
      setChatFeedback('Chat is disabled by Parental Controls.');
      return;
    }
    if (forceSafePresets) {
      setChatFeedback(
        'Safe Presets Only is active. Choose one of the approved phrases below.'
      );
      return;
    }

    const safety = checkChatSafety(chatInput, {
      blockPiiAndLinks: effectiveParental?.blockPiiAndLinks ?? true,
    });

    if (!safety.allowed) {
      setChatFeedback(safety.reason || 'Message blocked by Safety Shield.');
      await incrementBlockedSafetyAttempt();
      if (safety.severe) {
        await triggerBan(
          safety.reason || 'Child safety & policy violation in chat.',
          'Safety shield ban'
        );
      }
      return;
    }

    sfx.playUiTick();
    setChatFeedback(null);
    setSendingMsg(true);
    try {
      const res = await sendChatMessage({
        pairId: activeFriendship.pairId,
        participants: activeFriendship.participants,
        senderUid: user.uid,
        senderUsername: accountProfile.username,
        kind: 'text',
        text: chatInput,
      });
      if (!res.ok) {
        setPeerRequiresPresets(true);
        setChatFeedback(
          'Your friend has Safe Presets Only enabled in Parental Controls. Switched to Safe Presets mode for this chat!'
        );
      } else {
        setChatInput('');
      }
    } finally {
      setSendingMsg(false);
    }
  };

  const handleSubmitReport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reportTarget || reportBusy) return;
    setReportBusy(true);
    try {
      await submitSafetyReport({
        reporterUid: user.uid,
        reportedUid: reportTarget.peerUid,
        pairId: reportTarget.pairId,
        category: reportCategory,
        details: reportDetails,
        messageExcerpt: reportTarget.excerpt,
        alsoBlock: reportAlsoBlock,
      });
      setFriendActionMsg({
        type: 'ok',
        text: `Safety report submitted against ${reportTarget.peerUsername}${
          reportAlsoBlock ? ' and user blocked.' : '.'
        }`,
      });
      setReportTarget(null);
      setReportDetails('');
    } finally {
      setReportBusy(false);
    }
  };

  const handleUnlockParental = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!effectiveParental?.pinHash) {
      setParentUnlocked(true);
      return;
    }
    if (!PARENT_PIN_REGEX.test(unlockPinInput.trim())) {
      setUnlockPinError('Enter your 4–8 digit Parent PIN.');
      return;
    }
    const enteredHash = await hashParentPin(unlockPinInput.trim(), user.uid);
    if (enteredHash !== effectiveParental.pinHash) {
      setUnlockPinError('Incorrect Parent PIN.');
      return;
    }
    sfx.playUiTick();
    setUnlockPinError(null);
    setUnlockPinInput('');
    setParentUnlocked(true);
  };

  const handleUpdateDraftTier = (ageTier: AgeTier) => {
    if (!draftConfig) return;
    sfx.playUiTick();
    if (ageTier === 'under13') {
      setDraftConfig(
        enforceAgeTierConstraints({
          ...draftConfig,
          ageTier,
          chatMode: 'friends_safe_presets',
          allowFriendRequests: false,
          requireParentApproval: true,
          blockPiiAndLinks: true,
          allowCustomMedia: false,
        })
      );
    } else if (ageTier === 'teen13_17') {
      setDraftConfig(
        enforceAgeTierConstraints({
          ...draftConfig,
          ageTier,
          chatMode:
            draftConfig.chatMode === 'off' ? 'off' : 'friends_filtered',
          blockPiiAndLinks: true,
        })
      );
    } else {
      setDraftConfig(
        enforceAgeTierConstraints({
          ...draftConfig,
          ageTier,
        })
      );
    }
  };

  const handleSaveParental = async () => {
    if (!draftConfig || savingParental) return;
    setPinSaveMsg(null);
    let nextToSave = { ...draftConfig };

    if (newPin.trim().length > 0 || confirmNewPin.trim().length > 0) {
      if (!PARENT_PIN_REGEX.test(newPin.trim())) {
        setPinSaveMsg('New Parent PIN must be 4–8 digits.');
        return;
      }
      if (newPin.trim() !== confirmNewPin.trim()) {
        setPinSaveMsg('New Parent PIN entries do not match.');
        return;
      }
      const hashed = await hashParentPin(newPin.trim(), user.uid);
      nextToSave = {
        ...nextToSave,
        parentPinEnabled: true,
        pinHash: hashed,
      };
    }

    setSavingParental(true);
    try {
      const saved = await saveParentalSettings(nextToSave);
      setDraftConfig(saved);
      setNewPin('');
      setConfirmNewPin('');
      setPinSaveMsg('Saved! Rules are actively enforced by the database.');
    } catch {
      setPinSaveMsg('Unable to save Parental Controls. Check constraints.');
    } finally {
      setSavingParental(false);
    }
  };

  const handleDisablePin = async () => {
    if (!draftConfig || savingParental) return;
    setSavingParental(true);
    try {
      const saved = await saveParentalSettings({
        ...draftConfig,
        parentPinEnabled: false,
        pinHash: undefined,
      });
      setDraftConfig(saved);
      setPinSaveMsg('Parent PIN lock removed.');
    } finally {
      setSavingParental(false);
    }
  };

  const activePeer = activeFriendship
    ? getFriendPeer(activeFriendship, user.uid)
    : null;

  return (
    <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">
      {/* Header & View Switcher */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="inline-flex items-center gap-2 text-xs font-mono font-semibold uppercase tracking-wider accent-text">
            <ShieldCheck className="w-4 h-4" />
            <span>Friends, Safe Chat &amp; Parental Controls</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            Social Hub · {accountProfile.username}
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Add accepted friends by username, chat with anti-grooming &amp; PII
            filters, and lock down minor protections with a Parent PIN.
          </p>
        </div>

        <div className="inline-flex items-center p-1 rounded-xl bg-slate-200/70 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
          <button
            type="button"
            onClick={() => {
              sfx.playUiTick();
              setSubView('chat');
            }}
            className={`inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
              subView === 'chat'
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            <span>Friends &amp; Chat</span>
            {incomingRequests.length > 0 && (
              <span className="px-1.5 py-0.5 text-[10px] font-mono font-bold rounded-md bg-blue-600 text-white">
                {incomingRequests.length}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => {
              sfx.playUiTick();
              setSubView('parental');
            }}
            className={`inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
              subView === 'parental'
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
            }`}
          >
            <Shield className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
            <span>Parental Controls</span>
          </button>
        </div>
      </div>

      {/* FRIENDS & CHAT VIEW */}
      {subView === 'chat' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left Column: Add Friend + Requests + Friend List */}
          <div className="lg:col-span-4 space-y-5">
            {/* Add Friend Card */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-mono font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                  Add Friend by Username
                </span>
                {effectiveParental?.requireParentApproval && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-700 dark:text-amber-300">
                    <Lock className="w-3 h-3" />
                    PIN Lock
                  </span>
                )}
              </div>

              <form onSubmit={handleSendFriendRequest} className="flex gap-2">
                <input
                  type="text"
                  maxLength={20}
                  disabled={
                    sendingRequest ||
                    effectiveParental?.allowFriendRequests === false
                  }
                  value={targetUsername}
                  onChange={(e) => setTargetUsername(e.target.value)}
                  placeholder="Exact username..."
                  className="flex-1 min-w-0 px-3 py-2 text-xs font-medium bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg outline-none focus:border-blue-500 disabled:opacity-50"
                />
                <button
                  type="submit"
                  disabled={
                    sendingRequest ||
                    !targetUsername.trim() ||
                    effectiveParental?.allowFriendRequests === false
                  }
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white accent-bg rounded-lg cursor-pointer disabled:opacity-50 shrink-0"
                >
                  <UserPlus className="w-3.5 h-3.5" />
                  <span>Add</span>
                </button>
              </form>

              {effectiveParental?.allowFriendRequests === false && (
                <p className="text-[11px] text-amber-700 dark:text-amber-300">
                  Friend requests are turned off in Parental Controls.
                </p>
              )}

              {friendActionMsg && (
                <div
                  className={`p-2.5 rounded-lg text-xs border ${
                    friendActionMsg.type === 'ok'
                      ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200'
                      : 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-200'
                  }`}
                >
                  {friendActionMsg.text}
                </div>
              )}
            </div>

            {/* Incoming / Outgoing Requests */}
            {(incomingRequests.length > 0 || outgoingRequests.length > 0) && (
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-3">
                <div className="text-xs font-mono font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                  Pending Requests (
                  {incomingRequests.length + outgoingRequests.length})
                </div>

                <div className="space-y-2">
                  {incomingRequests.map((req) => {
                    const peer = getFriendPeer(req, user.uid);
                    return (
                      <div
                        key={req.pairId}
                        className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2"
                      >
                        <div className="min-w-0">
                          <div className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                            {peer.username}
                          </div>
                          <div className="text-[10px] text-slate-500 dark:text-slate-400">
                            Incoming request
                          </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            title="Accept friend request"
                            onClick={() => handleAcceptRequest(req)}
                            className="p-1.5 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer"
                          >
                            <Check className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            title="Decline request"
                            onClick={() =>
                              void removeOrCancelFriendship(req.pairId)
                            }
                            className="p-1.5 rounded-md bg-slate-200 dark:bg-slate-800 hover:bg-rose-100 dark:hover:bg-rose-950 text-slate-700 dark:text-slate-300 hover:text-rose-600 cursor-pointer"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            title="Block user"
                            onClick={() =>
                              void blockFriendRelationship(req.pairId, user.uid)
                            }
                            className="p-1.5 rounded-md bg-slate-200 dark:bg-slate-800 hover:bg-rose-600 text-slate-700 dark:text-slate-300 hover:text-white cursor-pointer"
                          >
                            <Ban className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}

                  {outgoingRequests.map((req) => {
                    const peer = getFriendPeer(req, user.uid);
                    return (
                      <div
                        key={req.pairId}
                        className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2"
                      >
                        <div className="min-w-0">
                          <div className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                            {peer.username}
                          </div>
                          <div className="text-[10px] text-slate-500 dark:text-slate-400">
                            Waiting for acceptance
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            void removeOrCancelFriendship(req.pairId)
                          }
                          className="px-2 py-1 text-[11px] font-semibold text-slate-600 dark:text-slate-400 hover:text-rose-600 cursor-pointer"
                        >
                          Cancel
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Accepted Friends List */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                  Friends ({acceptedFriends.length})
                </span>
                <span className="text-[11px] text-slate-500 dark:text-slate-400">
                  Friends-Only Chat
                </span>
              </div>

              {acceptedFriends.length === 0 ? (
                <div className="py-6 text-center text-xs text-slate-500 dark:text-slate-400">
                  No accepted friends yet. Add a friend by username above to
                  chat safely.
                </div>
              ) : (
                <div className="space-y-1.5">
                  {acceptedFriends.map((f) => {
                    const peer = getFriendPeer(f, user.uid);
                    const isSelected = f.pairId === selectedPairId;
                    return (
                      <button
                        key={f.pairId}
                        type="button"
                        onClick={() => {
                          sfx.playUiTick();
                          setSelectedPairId(f.pairId);
                        }}
                        className={`w-full p-3 rounded-xl border text-left transition-colors cursor-pointer ${
                          isSelected
                            ? 'bg-blue-50/80 dark:bg-blue-950/40 border-blue-500'
                            : 'bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-900 dark:text-slate-100 truncate">
                            <UserCheck className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                            <span>{peer.username}</span>
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-1">
                          {f.lastMessageText || 'Say hello!'}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}

              {blockedByMe.length > 0 && (
                <div className="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-2">
                  <div className="text-[11px] font-mono uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    Blocked ({blockedByMe.length})
                  </div>
                  {blockedByMe.map((b) => {
                    const peer = getFriendPeer(b, user.uid);
                    return (
                      <div
                        key={b.pairId}
                        className="flex items-center justify-between gap-2 text-xs text-slate-600 dark:text-slate-400"
                      >
                        <span className="truncate">{peer.username}</span>
                        <button
                          type="button"
                          onClick={() => void removeOrCancelFriendship(b.pairId)}
                          className="text-[11px] font-semibold text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                        >
                          Unblock
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Right Column: Live 1-on-1 Safe Chat */}
          <div className="lg:col-span-8 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl flex flex-col min-h-[540px] max-h-[680px]">
            {!activeFriendship || !activePeer ? (
              <div className="flex-1 flex flex-col items-center justify-center p-8 text-center space-y-3">
                <div className="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-400">
                  <MessageSquare className="w-6 h-6" />
                </div>
                <div className="space-y-1 max-w-sm">
                  <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                    Select an accepted friend to chat
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                    Stranger DMs and unmoderated public rooms are disabled by
                    design. Only mutually accepted friends can exchange messages.
                  </p>
                </div>
              </div>
            ) : (
              <>
                {/* Chat Header */}
                <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-slate-900 dark:text-slate-100">
                        {activePeer.username}
                      </span>
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                        <ShieldCheck className="w-3 h-3" />
                        {effectiveChatMode === 'off'
                          ? 'Chat Off'
                          : forceSafePresets
                          ? 'Safe Presets Only'
                          : 'Anti-Grooming + PII Guard'}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">
                      Messages are immutable &amp; screened against links,
                      off-platform apps, and personal-info requests.
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        sfx.playUiTick();
                        setReportTarget({
                          pairId: activeFriendship.pairId,
                          peerUid: activePeer.uid,
                          peerUsername: activePeer.username,
                          excerpt:
                            messages[messages.length - 1]?.text || '',
                        });
                      }}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold rounded-lg border border-amber-200 dark:border-amber-900/60 bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/50 cursor-pointer"
                    >
                      <Flag className="w-3.5 h-3.5" />
                      <span>Report</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        sfx.playUiTick();
                        void blockFriendRelationship(
                          activeFriendship.pairId,
                          user.uid
                        );
                      }}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold rounded-lg border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 hover:bg-rose-100 dark:hover:bg-rose-900/50 cursor-pointer"
                    >
                      <Ban className="w-3.5 h-3.5" />
                      <span>Block</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        sfx.playUiTick();
                        void removeOrCancelFriendship(activeFriendship.pairId);
                      }}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:text-rose-600 cursor-pointer"
                    >
                      <UserMinus className="w-3.5 h-3.5" />
                      <span className="hidden sm:inline">Unfriend</span>
                    </button>
                  </div>
                </div>

                {/* Chat Messages */}
                <div
                  ref={chatScrollRef}
                  className="flex-1 overflow-y-auto p-5 space-y-3 bg-slate-50/60 dark:bg-slate-950/40"
                >
                  {messages.length === 0 ? (
                    <div className="h-full flex items-center justify-center text-xs text-slate-500 dark:text-slate-400">
                      No messages yet. Start with a safe greeting or game
                      challenge!
                    </div>
                  ) : (
                    messages.map((m) => {
                      const isMine = m.senderUid === user.uid;
                      return (
                        <div
                          key={m.id}
                          className={`flex flex-col ${
                            isMine ? 'items-end' : 'items-start'
                          }`}
                        >
                          <div
                            className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 text-sm shadow-xs ${
                              isMine
                                ? 'accent-bg text-white rounded-br-xs'
                                : 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 rounded-bl-xs'
                            }`}
                          >
                            <div className="leading-snug break-words">
                              {m.text}
                            </div>
                          </div>
                          <div className="mt-1 flex items-center gap-1.5 text-[10px] text-slate-400 px-1">
                            <span>{m.senderUsername}</span>
                            {m.kind === 'preset' && (
                              <span>· Safe Preset</span>
                            )}
                            {m.createdAtMs > 0 && (
                              <span>
                                ·{' '}
                                {new Date(m.createdAtMs).toLocaleTimeString([], {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>

                {/* Chat Feedback Warning */}
                {chatFeedback && (
                  <div className="mx-4 mt-3 p-2.5 rounded-lg bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-800 flex items-start gap-2 text-xs text-rose-800 dark:text-rose-200">
                    <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5 text-rose-600 dark:text-rose-400" />
                    <span className="flex-1">{chatFeedback}</span>
                    <button
                      type="button"
                      onClick={() => setChatFeedback(null)}
                      className="text-rose-600 dark:text-rose-300 font-semibold cursor-pointer"
                    >
                      Dismiss
                    </button>
                  </div>
                )}

                {/* Chat Composer */}
                <div className="p-4 border-t border-slate-200 dark:border-slate-800 space-y-3">
                  {effectiveChatMode === 'off' ? (
                    <div className="p-3 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs font-medium text-slate-600 dark:text-slate-300 flex items-center gap-2">
                      <Lock className="w-4 h-4 shrink-0" />
                      <span>
                        Chat is turned off by Parental Controls. A parent can
                        enable Safe Presets or Filtered Chat in Parental
                        Controls.
                      </span>
                    </div>
                  ) : forceSafePresets ? (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
                        <span className="inline-flex items-center gap-1.5">
                          <ShieldCheck className="w-3.5 h-3.5" />
                          Safe Presets Only Mode (Free-text locked at database
                          level)
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto">
                        {SAFE_CHAT_PRESETS.map((phrase) => (
                          <button
                            key={phrase}
                            type="button"
                            disabled={sendingMsg}
                            onClick={() => void handleSendPreset(phrase)}
                            className="px-2.5 py-1.5 text-xs font-medium rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-blue-50 dark:hover:bg-blue-950/60 border border-slate-200 dark:border-slate-700 hover:border-blue-400 text-slate-800 dark:text-slate-100 transition-colors cursor-pointer disabled:opacity-50"
                          >
                            {phrase}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2.5">
                      {showQuickPresets && (
                        <div className="flex flex-wrap gap-1.5 p-2.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 max-h-32 overflow-y-auto">
                          {SAFE_CHAT_PRESETS.map((phrase) => (
                            <button
                              key={phrase}
                              type="button"
                              disabled={sendingMsg}
                              onClick={() => void handleSendPreset(phrase)}
                              className="px-2.5 py-1 text-[11px] font-medium rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:border-blue-400 text-slate-700 dark:text-slate-200 cursor-pointer"
                            >
                              {phrase}
                            </button>
                          ))}
                        </div>
                      )}

                      <form onSubmit={handleSendFreeText} className="flex gap-2">
                        <button
                          type="button"
                          title="Quick Safe Presets"
                          onClick={() => {
                            sfx.playUiTick();
                            setShowQuickPresets((prev) => !prev);
                          }}
                          className={`px-3 py-2 text-xs font-semibold rounded-xl border transition-colors cursor-pointer shrink-0 inline-flex items-center gap-1 ${
                            showQuickPresets
                              ? 'bg-blue-50 dark:bg-blue-950/50 border-blue-400 text-blue-700 dark:text-blue-300'
                              : 'bg-slate-50 dark:bg-slate-800 border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200'
                          }`}
                        >
                          <Sparkles className="w-3.5 h-3.5" />
                          <span className="hidden sm:inline">Presets</span>
                        </button>
                        <input
                          type="text"
                          maxLength={300}
                          value={chatInput}
                          onChange={(e) => {
                            setChatInput(e.target.value);
                            if (chatFeedback) setChatFeedback(null);
                          }}
                          placeholder="Type a friendly message (links, PII & off-platform apps blocked)..."
                          className="flex-1 min-w-0 px-3.5 py-2 text-sm bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-xl outline-none focus:bg-white dark:focus:bg-slate-900 focus:border-blue-500"
                        />
                        <button
                          type="submit"
                          disabled={sendingMsg || !chatInput.trim()}
                          className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white accent-bg rounded-xl cursor-pointer disabled:opacity-50 shrink-0"
                        >
                          <Send className="w-3.5 h-3.5" />
                          <span>Send</span>
                        </button>
                      </form>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* PARENTAL CONTROLS DASHBOARD */}
      {subView === 'parental' && draftConfig && (
        <div className="space-y-6">
          {!parentUnlocked && draftConfig.parentPinEnabled ? (
            <div className="max-w-md mx-auto bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-amber-100 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-800 flex items-center justify-center text-amber-700 dark:text-amber-300">
                  <Lock className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                    Parent PIN Required
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Parental Controls are locked so safety settings cannot be
                    bypassed.
                  </p>
                </div>
              </div>

              <form onSubmit={handleUnlockParental} className="space-y-3">
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={8}
                  value={unlockPinInput}
                  onChange={(e) => {
                    setUnlockPinInput(e.target.value.replace(/\D/g, ''));
                    setUnlockPinError(null);
                  }}
                  placeholder="Enter 4–8 digit Parent PIN"
                  className="w-full px-3.5 py-2.5 text-sm font-mono bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-xl outline-none focus:border-blue-500"
                />
                {unlockPinError && (
                  <p className="text-xs text-rose-600 dark:text-rose-400">
                    {unlockPinError}
                  </p>
                )}
                <button
                  type="submit"
                  className="w-full py-2.5 px-4 text-xs font-semibold text-white accent-bg rounded-xl cursor-pointer inline-flex items-center justify-center gap-2"
                >
                  <Unlock className="w-3.5 h-3.5" />
                  <span>Unlock Parental Controls</span>
                </button>
              </form>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Settings Panel */}
              <div className="lg:col-span-8 space-y-5">
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-6">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                        Account Age Tier &amp; Server Enforcement
                      </h2>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                        Firestore Security Rules enforce these limits on every
                        message and friend request, even if the client is
                        modified.
                      </p>
                    </div>
                    {draftConfig.parentPinEnabled && (
                      <button
                        type="button"
                        onClick={() => setParentUnlocked(false)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 cursor-pointer"
                      >
                        <Lock className="w-3.5 h-3.5" />
                        <span>Re-Lock with PIN</span>
                      </button>
                    )}
                  </div>

                  {/* Age Tier */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {[
                      {
                        id: 'under13' as AgeTier,
                        title: 'Under 13',
                        desc: 'Forces Safe Presets Only (no free text), PII lock & no custom uploads.',
                      },
                      {
                        id: 'teen13_17' as AgeTier,
                        title: '13 – 17',
                        desc: 'Filtered Friends Chat with anti-grooming & PII/link filter locked ON.',
                      },
                      {
                        id: 'adult18plus' as AgeTier,
                        title: '18+ Adult',
                        desc: 'Filtered Friends Chat with configurable safety & media controls.',
                      },
                    ].map((tier) => (
                      <button
                        key={tier.id}
                        type="button"
                        onClick={() => handleUpdateDraftTier(tier.id)}
                        className={`p-3.5 rounded-xl border text-left transition-all cursor-pointer ${
                          draftConfig.ageTier === tier.id
                            ? 'bg-blue-50/70 dark:bg-blue-950/40 border-blue-500 ring-2 ring-blue-500/20'
                            : 'bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                        }`}
                      >
                        <div className="text-xs font-bold text-slate-900 dark:text-slate-100">
                          {tier.title}
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 leading-snug">
                          {tier.desc}
                        </div>
                      </button>
                    ))}
                  </div>

                  {/* Chat Mode */}
                  <div className="space-y-2.5 pt-4 border-t border-slate-100 dark:border-slate-800">
                    <div className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                      Who Can Chat &amp; What Can Be Sent
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      {[
                        {
                          id: 'off' as ChatMode,
                          title: 'Chat Disabled',
                          desc: 'Blocks all chat reads/writes in database.',
                          disabled: false,
                        },
                        {
                          id: 'friends_safe_presets' as ChatMode,
                          title: 'Safe Presets Only',
                          desc: 'Pre-approved gaming phrases only; free typing locked out.',
                          disabled: false,
                        },
                        {
                          id: 'friends_filtered' as ChatMode,
                          title: 'Filtered Friends Chat',
                          desc: 'Friends-only chat screened by anti-grooming & link guard.',
                          disabled: draftConfig.ageTier === 'under13',
                        },
                      ].map((mode) => (
                        <button
                          key={mode.id}
                          type="button"
                          disabled={mode.disabled}
                          onClick={() => {
                            sfx.playUiTick();
                            setDraftConfig({
                              ...draftConfig,
                              chatMode: mode.id,
                            });
                          }}
                          className={`p-3 rounded-xl border text-left transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                            draftConfig.chatMode === mode.id
                              ? 'bg-emerald-50/70 dark:bg-emerald-950/40 border-emerald-500 ring-2 ring-emerald-500/20'
                              : 'bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800'
                          }`}
                        >
                          <div className="text-xs font-bold text-slate-900 dark:text-slate-100">
                            {mode.title}
                          </div>
                          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 leading-snug">
                            {mode.desc}
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Safety Toggles */}
                  <div className="space-y-3 pt-4 border-t border-slate-100 dark:border-slate-800">
                    {[
                      {
                        key: 'allowFriendRequests' as const,
                        label: 'Allow Friend Requests',
                        desc: 'When OFF, Firestore rejects all incoming and outgoing friend requests.',
                        lockedOn: false,
                      },
                      {
                        key: 'requireParentApproval' as const,
                        label: 'Require Parent PIN for Friend Requests',
                        desc: 'Prompts for Parent PIN before sending or accepting friend requests.',
                        lockedOn: false,
                      },
                      {
                        key: 'blockPiiAndLinks' as const,
                        label:
                          'Block Discord / Snapchat / Links / Phone / Age Probing',
                        desc: 'Locked ON automatically for Under-13 and Teen 13–17 tiers.',
                        lockedOn: draftConfig.ageTier !== 'adult18plus',
                      },
                      {
                        key: 'allowCustomMedia' as const,
                        label:
                          'Allow Custom Image, GIF & Audio Uploads (Wave / Shuffle / Rhythm / BG)',
                        desc: 'Turn OFF to disable all local custom image & audio uploads for child safety.',
                        lockedOn: false,
                      },
                    ].map((item) => {
                      const val = draftConfig[item.key];
                      return (
                        <div
                          key={item.key}
                          className="flex items-center justify-between gap-4 p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800"
                        >
                          <div className="space-y-0.5">
                            <div className="text-xs font-bold text-slate-900 dark:text-slate-100">
                              {item.label}
                            </div>
                            <div className="text-[11px] text-slate-500 dark:text-slate-400">
                              {item.desc}
                            </div>
                          </div>
                          <button
                            type="button"
                            disabled={item.lockedOn}
                            onClick={() => {
                              sfx.playUiTick();
                              setDraftConfig({
                                ...draftConfig,
                                [item.key]: !val,
                              });
                            }}
                            className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg border shrink-0 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed ${
                              val
                                ? 'accent-bg border-transparent text-white'
                                : 'bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300'
                            }`}
                          >
                            {item.lockedOn
                              ? 'Locked ON'
                              : val
                              ? 'Enabled'
                              : 'Disabled'}
                          </button>
                        </div>
                      );
                    })}
                  </div>

                  {/* Parent PIN Management */}
                  <div className="space-y-3 pt-4 border-t border-slate-100 dark:border-slate-800">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <div className="text-xs font-bold text-slate-900 dark:text-slate-100">
                          Parent PIN Protection (
                          {draftConfig.parentPinEnabled
                            ? 'Active'
                            : 'Not Set'}
                          )
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400">
                          Set a 4–8 digit PIN so only a parent can loosen age
                          tier, chat, friend, or media restrictions.
                        </div>
                      </div>
                      {draftConfig.parentPinEnabled && (
                        <button
                          type="button"
                          onClick={() => void handleDisablePin()}
                          className="text-xs font-semibold text-rose-600 dark:text-rose-400 hover:underline cursor-pointer shrink-0"
                        >
                          Remove PIN
                        </button>
                      )}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <input
                        type="password"
                        inputMode="numeric"
                        maxLength={8}
                        value={newPin}
                        onChange={(e) =>
                          setNewPin(e.target.value.replace(/\D/g, ''))
                        }
                        placeholder={
                          draftConfig.parentPinEnabled
                            ? 'New 4–8 digit PIN (optional)'
                            : 'Create 4–8 digit Parent PIN'
                        }
                        className="px-3.5 py-2 text-xs font-mono bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-xl outline-none focus:border-blue-500"
                      />
                      <input
                        type="password"
                        inputMode="numeric"
                        maxLength={8}
                        value={confirmNewPin}
                        onChange={(e) =>
                          setConfirmNewPin(e.target.value.replace(/\D/g, ''))
                        }
                        placeholder="Confirm Parent PIN"
                        className="px-3.5 py-2 text-xs font-mono bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-xl outline-none focus:border-blue-500"
                      />
                    </div>
                  </div>

                  {pinSaveMsg && (
                    <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 text-xs font-medium text-emerald-800 dark:text-emerald-200 flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 shrink-0" />
                      <span>{pinSaveMsg}</span>
                    </div>
                  )}

                  <div className="flex justify-end">
                    <button
                      type="button"
                      disabled={savingParental}
                      onClick={() => void handleSaveParental()}
                      className="px-5 py-2.5 text-xs font-semibold text-white accent-bg rounded-xl cursor-pointer disabled:opacity-50"
                    >
                      {savingParental
                        ? 'Saving to Server...'
                        : 'Save Parental Controls'}
                    </button>
                  </div>
                </div>
              </div>

              {/* Right Column: Parent Activity & Oversight */}
              <div className="lg:col-span-4 space-y-5">
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-3">
                  <div className="flex items-center gap-2 text-xs font-mono font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                    <ShieldAlert className="w-4 h-4 text-amber-500" />
                    <span>Safety Activity Log</span>
                  </div>
                  <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                    <div className="text-2xl font-mono font-bold text-slate-900 dark:text-slate-100">
                      {effectiveParental?.blockedAttemptsCount ?? 0}
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                      Blocked unsafe / off-platform / solicitation messages
                    </div>
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                    Chat messages are immutable (cannot be deleted or edited to
                    hide evidence) and Stranger DMs are blocked globally.
                  </p>
                </div>

                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-3">
                  <div className="text-xs font-mono font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                    Parent Friend Oversight ({acceptedFriends.length})
                  </div>
                  {acceptedFriends.length === 0 ? (
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      No active friends on this account.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {acceptedFriends.map((f) => {
                        const peer = getFriendPeer(f, user.uid);
                        return (
                          <div
                            key={f.pairId}
                            className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2"
                          >
                            <span className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                              {peer.username}
                            </span>
                            <div className="flex items-center gap-1 shrink-0">
                              <button
                                type="button"
                                onClick={() =>
                                  void removeOrCancelFriendship(f.pairId)
                                }
                                className="px-2 py-1 text-[10px] font-semibold rounded bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 cursor-pointer"
                              >
                                Remove
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  void blockFriendRelationship(
                                    f.pairId,
                                    user.uid
                                  )
                                }
                                className="px-2 py-1 text-[10px] font-semibold rounded bg-rose-600 text-white cursor-pointer"
                              >
                                Block
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* PARENT PIN APPROVAL MODAL FOR FRIEND REQUESTS */}
      {pinApprovalPrompt && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs"
        >
          <div className="w-full max-w-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-xl space-y-4">
            <div className="flex items-center gap-2.5">
              <Lock className="w-5 h-5 text-amber-500 shrink-0" />
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  Parent Approval Required
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {pinApprovalPrompt.label}
                </p>
              </div>
            </div>

            <form onSubmit={handleConfirmPinApproval} className="space-y-3">
              <input
                type="password"
                inputMode="numeric"
                maxLength={8}
                autoFocus
                value={approvalPinInput}
                onChange={(e) => {
                  setApprovalPinInput(e.target.value.replace(/\D/g, ''));
                  setApprovalPinError(null);
                }}
                placeholder="Enter Parent PIN"
                className="w-full px-3.5 py-2.5 text-sm font-mono bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-xl outline-none focus:border-blue-500"
              />
              {approvalPinError && (
                <p className="text-xs text-rose-600 dark:text-rose-400">
                  {approvalPinError}
                </p>
              )}
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setPinApprovalPrompt(null)}
                  className="px-3.5 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-semibold text-white accent-bg rounded-lg cursor-pointer"
                >
                  Verify &amp; Approve
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* SAFETY REPORT MODAL */}
      {reportTarget && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs"
        >
          <div className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0" />
                <div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                    Report {reportTarget.peerUsername}
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Files an immutable safety report and optionally blocks this
                    user immediately.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setReportTarget(null)}
                className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSubmitReport} className="space-y-3.5">
              <label className="block space-y-1">
                <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Safety Category
                </span>
                <select
                  value={reportCategory}
                  onChange={(e) =>
                    setReportCategory(e.target.value as SafetyReportCategory)
                  }
                  className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-xl outline-none"
                >
                  <option value="grooming_solicitation">
                    Grooming / Asking Age, Photos, Location, or Secrecy
                  </option>
                  <option value="off_platform_luring">
                    Off-Platform Luring (Discord, Snapchat, Telegram, etc.)
                  </option>
                  <option value="explicit_content">
                    Explicit / NSFW Content
                  </option>
                  <option value="harassment">Harassment or Bullying</option>
                  <option value="cheating_exploit">
                    Hacking, Exploits, or Scamming
                  </option>
                </select>
              </label>

              <label className="block space-y-1">
                <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Details
                </span>
                <textarea
                  required
                  rows={3}
                  maxLength={500}
                  value={reportDetails}
                  onChange={(e) => setReportDetails(e.target.value)}
                  placeholder="Describe what happened..."
                  className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-xl outline-none focus:border-blue-500"
                />
              </label>

              <label className="flex items-center gap-2 text-xs font-semibold text-slate-800 dark:text-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={reportAlsoBlock}
                  onChange={(e) => setReportAlsoBlock(e.target.checked)}
                  className="w-4 h-4 rounded accent-rose-600"
                />
                <span>Also block {reportTarget.peerUsername} immediately</span>
              </label>

              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setReportTarget(null)}
                  className="px-3.5 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={reportBusy || !reportDetails.trim()}
                  className="px-4 py-2 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded-lg cursor-pointer disabled:opacity-50"
                >
                  {reportBusy ? 'Submitting...' : 'Submit Safety Report'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
