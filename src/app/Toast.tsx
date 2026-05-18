import { type ReactNode, createContext, useCallback, useContext, useMemo, useState } from 'react';

interface ToastSpec {
  id: number;
  message: string;
  actions?: { label: string; onClick: () => void }[];
}

interface ToastApi {
  show(message: string, actions?: ToastSpec['actions']): number;
  dismiss(id: number): void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastSpec[]>([]);

  const dismiss = useCallback(
    (id: number) => setToasts((all) => all.filter((t) => t.id !== id)),
    [],
  );
  const show = useCallback(
    (message: string, actions?: ToastSpec['actions']) => {
      const id = Date.now() + Math.random();
      setToasts((all) => [...all, { id, message, actions }]);
      // auto-dismiss after 8s only if there are no actions
      if (!actions || actions.length === 0) {
        setTimeout(() => dismiss(id), 8000);
      }
      return id;
    },
    [dismiss],
  );

  const api = useMemo<ToastApi>(() => ({ show, dismiss }), [show, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast-stack" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className="toast">
            <span>{t.message}</span>
            <span className="toast__actions">
              {t.actions?.map((a) => (
                <button
                  key={a.label}
                  type="button"
                  onClick={() => {
                    a.onClick();
                    dismiss(t.id);
                  }}
                >
                  {a.label}
                </button>
              ))}
              <button type="button" onClick={() => dismiss(t.id)} aria-label="Dismiss">
                ×
              </button>
            </span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast outside ToastProvider');
  return ctx;
}
