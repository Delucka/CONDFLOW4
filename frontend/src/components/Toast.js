'use client';
import { createContext, useContext, useState, useCallback } from 'react';
import { CheckCircle2, AlertCircle, X } from 'lucide-react';

const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const addToast = useCallback((message, type = 'success') => {
    const id = Date.now();
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  const removeToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ addToast }}>
      {children}
      {/* Toast Container — região "ao vivo" para leitores de tela */}
      <div
        className="fixed top-4 left-4 right-4 sm:left-auto z-[200] space-y-2 pointer-events-none"
        aria-live="polite"
        aria-atomic="false"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role={toast.type === 'success' ? 'status' : 'alert'}
            className={`pointer-events-auto animate-slide-in flex items-center gap-3 px-4 py-3 rounded-xl border text-sm font-medium shadow-lg w-full sm:w-auto sm:min-w-[300px] sm:max-w-md bg-white ${
              toast.type === 'success'
                ? 'text-emerald-700 border-emerald-200'
                : 'text-rose-700 border-rose-200'
            }`}
          >
            {toast.type === 'success' ? (
              <CheckCircle2 className="w-5 h-5 shrink-0 text-emerald-500" aria-hidden="true" />
            ) : (
              <AlertCircle className="w-5 h-5 shrink-0 text-rose-500" aria-hidden="true" />
            )}
            <span className="flex-1 text-slate-700">{toast.message}</span>
            <button
              type="button"
              onClick={() => removeToast(toast.id)}
              aria-label="Fechar notificação"
              className="tap shrink-0 inline-flex items-center justify-center -mr-1 rounded-lg text-slate-400 hover:text-slate-600 transition-colors"
            >
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}

export default function Toast() {
  return null; // Placeholder - actual rendering is in ToastProvider
}
