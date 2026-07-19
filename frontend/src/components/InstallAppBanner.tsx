import { useEffect, useState } from 'react';
import { Download, X } from 'lucide-react';

const DISMISS_KEY = 'nexus-pwa-install-dismissed';

export default function InstallAppBanner() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(
    () => typeof window !== 'undefined' && localStorage.getItem(DISMISS_KEY) === '1'
  );

  const isStandalone =
    typeof window !== 'undefined' &&
    (window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true);

  useEffect(() => {
    if (isStandalone || dismissed) return;

    const onBeforeInstall = (event: Event) => {
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    return () => window.removeEventListener('beforeinstallprompt', onBeforeInstall);
  }, [dismissed, isStandalone]);

  if (!deferredPrompt || dismissed || isStandalone) return null;

  const handleInstall = async () => {
    await deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    setDeferredPrompt(null);
    localStorage.setItem(DISMISS_KEY, '1');
  };

  const handleDismiss = () => {
    setDismissed(true);
    localStorage.setItem(DISMISS_KEY, '1');
    setDeferredPrompt(null);
  };

  return (
    <div className="fixed bottom-[calc(var(--app-safe-bottom)+0.75rem)] left-3 right-3 z-[60] lg:left-auto lg:right-6 lg:max-w-sm">
      <div className="flex items-center gap-3 rounded-xl border border-amber-400/30 bg-[#12151a]/95 backdrop-blur-xl px-4 py-3 shadow-[0_12px_40px_rgba(0,0,0,0.45)]">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-500/15 border border-amber-400/25">
          <Download className="h-5 w-5 text-amber-300" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-bold text-white">Install NEXUS AI</p>
          <p className="text-[10px] text-white/55 leading-snug">Add to home screen for app-like full-screen use.</p>
        </div>
        <button
          type="button"
          onClick={() => void handleInstall()}
          className="shrink-0 rounded-lg bg-amber-500 px-3 py-2 text-[10px] font-extrabold uppercase tracking-wide text-black"
        >
          Install
        </button>
        <button
          type="button"
          onClick={handleDismiss}
          aria-label="Dismiss install prompt"
          className="shrink-0 text-white/40 hover:text-white/70"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
