import { Inter } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/lib/auth";
import { ToastProvider } from "@/components/Toast";
import AppShell from "@/components/AppShell";
import SWRProvider from "@/components/SWRProvider";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });

export const metadata = {
  title: "CondoFlow — Sistema de Gestão de Condomínios",
  description: "Gestão moderna de arrecadações, cobranças e aprovações de condomínios",
};

const themeScript = `(function(){try{if(localStorage.getItem('theme')==='dark'){document.documentElement.classList.add('dark');}}catch(e){}})();`;

export default function RootLayout({ children }) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className={`${inter.variable} font-sans text-slate-800 antialiased min-h-screen bg-slate-50`}>
        <AuthProvider>
          <SWRProvider>
            <ToastProvider>
              <AppShell>
                {children}
              </AppShell>
            </ToastProvider>
          </SWRProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
