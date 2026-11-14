import { ShieldAlert, Terminal } from 'lucide-react';
import { BanState } from '../utils/policyGuard';

interface BanScreenProps {
  banState: BanState;
}

export function BanScreen({ banState }: BanScreenProps) {
  return (
    <div
      id="inputbench-ban-lock"
      data-security-guarded="true"
      className="fixed inset-0 z-[9999] bg-slate-950 text-slate-100 flex items-center justify-center p-6 select-none"
    >
      <div className="max-w-lg w-full bg-slate-900 border-2 border-rose-600/80 rounded-2xl p-8 shadow-2xl space-y-6 text-center">
        <div className="w-16 h-16 mx-auto rounded-2xl bg-rose-950/80 border border-rose-500/40 flex items-center justify-center text-rose-400">
          <ShieldAlert className="w-9 h-9" />
        </div>

        <div className="space-y-2">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md bg-rose-950 border border-rose-700/60 text-rose-300 text-xs font-mono font-bold uppercase tracking-wider">
            <Terminal className="w-3.5 h-3.5" />
            <span>IP &amp; Account Banned</span>
          </div>

          <h1 className="text-4xl font-mono font-extrabold tracking-tight text-white pt-1">
            {banState.message || 'nice try'}
          </h1>
        </div>

        <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 text-left space-y-2 font-mono text-xs">
          <div className="flex items-start justify-between gap-4">
            <span className="text-slate-500 uppercase">Reason</span>
            <span className="text-rose-400 font-bold text-right">
              {banState.reason || 'hacking/exploits'}
            </span>
          </div>
          {banState.ipHash && (
            <div className="flex items-start justify-between gap-4">
              <span className="text-slate-500 uppercase">IP Lock ID</span>
              <span className="text-slate-300 truncate max-w-[260px]">
                {banState.ipHash.slice(0, 20)}...
              </span>
            </div>
          )}
          {banState.bannedAt && (
            <div className="flex items-start justify-between gap-4">
              <span className="text-slate-500 uppercase">Enforced</span>
              <span className="text-slate-400">
                {new Date(banState.bannedAt).toLocaleString()}
              </span>
            </div>
          )}
        </div>

        <p className="text-xs text-slate-400 leading-relaxed">
          Access from this IP address and account has been permanently revoked by InputBench Security.
        </p>
      </div>
    </div>
  );
}
