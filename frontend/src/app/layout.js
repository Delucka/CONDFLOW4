import { Inter } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/lib/auth";
import { ToastProvider } from "@/components/Toast";
import AppShell from "@/components/AppShell";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });

export const metadata = {
  title: "CondoFlow — Sistema de Gestão de Condomínios",
  description: "Gestão moderna de arrecadações, cobranças e aprovações de condomínios",
};

export default function RootLayout({ children }) {
  return (
    <html lang="pt-BR">
      <body className={`${inter.variable} font-sans text-gray-200 antialiased min-h-screen bg-[#030712]`}>
        <AuthProvider>
          <ToastProvider>
            <AppShell>
              {children}
            </AppShell>
          </ToastProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
