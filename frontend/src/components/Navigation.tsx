"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ConnectWallet } from "./ConnectWallet";
import { useState } from "react";
import { Menu, X } from "lucide-react";
import { cn } from "@/lib/utils";

const navLinks = [
  { href: "/marketplace", label: "Marketplace" },
  { href: "/playground", label: "Playground" },
  { href: "/register", label: "Register" },
  { href: "/simulation", label: "Simulation" },
  { href: "/score", label: "Score" },
];

export function Navigation() {
  const pathname = usePathname();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <nav className="sticky top-0 z-[120] bg-black/95 border-b border-white/10">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16 gap-2">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-shrink-0">
            {/* Mobile Menu Button */}
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="xl:hidden p-2 rounded-lg hover:bg-lobster-hover transition-colors duration-200 flex-shrink-0"
              aria-label="Toggle menu"
            >
              {mobileMenuOpen ? (
                <X className="w-6 h-6 text-white" />
              ) : (
                <Menu className="w-6 h-6 text-white" />
              )}
            </button>

            {/* Logo */}
            <Link
              href="/"
              className="flex items-center space-x-2 text-xl sm:text-2xl font-display font-bold text-white hover:text-pragma-primary transition-colors duration-200"
            >
              <span className="material-icons text-2xl sm:text-3xl">account_balance_wallet</span>
              <span className="hidden sm:inline">Clawmono</span>
              <span className="sm:hidden">Pragma</span>
            </Link>
          </div>

          {/* Desktop Navigation */}
          <div className="hidden xl:flex items-center space-x-1">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  "px-4 py-2 rounded-lg font-medium transition-all duration-200",
                  pathname === link.href || pathname.startsWith(link.href + "/")
                    ? "bg-white/10 text-white"
                    : "text-white/70 hover:bg-lobster-hover hover:text-white"
                )}
              >
                {link.label}
              </Link>
            ))}
          </div>

          {/* Connect Wallet (always visible, right) */}
          <div className="flex items-center">
            <ConnectWallet />
          </div>
        </div>
      </div>

      {/* Slide-in Mobile Menu */}
      <div
        className={cn(
          "xl:hidden fixed left-0 right-0 bottom-0 top-16 z-[110] transition-opacity duration-200",
          mobileMenuOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        )}
        aria-hidden={!mobileMenuOpen}
      >
        <button
          className="absolute inset-0 bg-black/75"
          aria-label="Close menu"
          onClick={() => setMobileMenuOpen(false)}
        />
        <div
          className={cn(
            "absolute left-0 top-0 h-full w-72 max-w-[85vw] border-r border-white/10 bg-black/95 backdrop-blur-xl p-5 transition-transform duration-200 shadow-2xl",
            mobileMenuOpen ? "translate-x-0" : "-translate-x-full"
          )}
        >
          <div className="flex items-center justify-between mb-6">
            <span className="text-sm uppercase tracking-widest text-white/60">Navigation</span>
            <button
              onClick={() => setMobileMenuOpen(false)}
              className="p-2 rounded-lg hover:bg-white/10 transition-colors"
              aria-label="Close menu"
            >
              <X className="w-5 h-5 text-white" />
            </button>
          </div>
          <div className="space-y-2">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setMobileMenuOpen(false)}
                className={cn(
                  "block px-4 py-3 rounded-xl font-medium transition-all duration-200",
                  pathname === link.href || pathname.startsWith(link.href + "/")
                    ? "bg-white/10 text-white"
                    : "text-white/70 hover:bg-lobster-hover hover:text-white"
                )}
              >
                {link.label}
              </Link>
            ))}
          </div>
        </div>
      </div>
    </nav>
  );
}
