"use client";

import { useEffect, useRef, useState } from "react";
import {
  Check,
  Command,
  DatabaseBackup,
  Keyboard,
  Moon,
  Paintbrush,
  Sun,
  SunMoon,
  X
} from "lucide-react";
import {
  THEME_OPTIONS,
  ACCENT_OPTIONS,
  type ThemeMode,
  type AccentColor
} from "@/lib/theme";
import { useTheme } from "./theme-provider";

type SettingsTab = "appearance" | "shortcuts" | "about";

export function SettingsDialog({
  onClose,
  onOpenDataManagement
}: {
  onClose: () => void;
  onOpenDataManagement?: () => void;
}) {
  const { theme, accent, setTheme, setAccent } = useTheme();
  const [activeTab, setActiveTab] = useState<SettingsTab>("appearance");
  const dialogRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  function themeIcon(id: ThemeMode) {
    switch (id) {
      case "light":
        return <Sun size={15} />;
      case "dark":
        return <Moon size={15} />;
      case "warm":
        return <Paintbrush size={15} />;
      case "system":
        return <SunMoon size={15} />;
    }
  }

  return (
    <div
      className="settings-overlay"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) {
          onClose();
        }
      }}
    >
      <section
        ref={dialogRef}
        className="settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-dialog-title"
        aria-describedby="settings-dialog-description"
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="settings-heading">
          <div>
            <span className="eyebrow">Preferences</span>
            <h2 id="settings-dialog-title">Settings</h2>
            <p id="settings-dialog-description">
              Customize workspace appearance, themes, and personal preferences.
            </p>
          </div>
          <button
            className="icon-button"
            aria-label="Close settings"
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </header>

        <nav className="settings-tabs" aria-label="Settings sections">
          <button
            type="button"
            className={activeTab === "appearance" ? "active" : ""}
            onClick={() => setActiveTab("appearance")}
          >
            <Paintbrush size={15} />
            <span>Appearance &amp; Theme</span>
          </button>
          <button
            type="button"
            className={activeTab === "shortcuts" ? "active" : ""}
            onClick={() => setActiveTab("shortcuts")}
          >
            <Keyboard size={15} />
            <span>Shortcuts</span>
          </button>
          <button
            type="button"
            className={activeTab === "about" ? "active" : ""}
            onClick={() => setActiveTab("about")}
          >
            <DatabaseBackup size={15} />
            <span>Storage &amp; System</span>
          </button>
        </nav>

        <div className="settings-body">
          {activeTab === "appearance" && (
            <div className="settings-section">
              <div className="settings-block">
                <div className="settings-block-heading">
                  <h3>Theme Style</h3>
                  <p>Choose how Dayflow renders across all surfaces and windows.</p>
                </div>
                <div className="settings-theme-grid" role="radiogroup" aria-label="Theme style">
                  {THEME_OPTIONS.map((item) => {
                    const isSelected = theme === item.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        role="radio"
                        aria-checked={isSelected}
                        className={`settings-theme-card ${item.id} ${isSelected ? "selected" : ""}`}
                        onClick={() => setTheme(item.id)}
                      >
                        <div className="theme-card-preview" aria-hidden="true">
                          <div className="theme-preview-sidebar" />
                          <div className="theme-preview-content">
                            <div className="theme-preview-bar" />
                            <div className="theme-preview-box" />
                          </div>
                        </div>
                        <div className="theme-card-info">
                          <div className="theme-card-title">
                            {themeIcon(item.id)}
                            <strong>{item.name}</strong>
                            {isSelected && <Check size={14} className="theme-card-check" />}
                          </div>
                          <small>{item.description}</small>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="settings-block">
                <div className="settings-block-heading">
                  <h3>Accent Palette</h3>
                  <p>Apply an accent color to focus timers, active tabs, and primary controls.</p>
                </div>
                <div className="settings-accent-grid" role="radiogroup" aria-label="Accent palette">
                  {ACCENT_OPTIONS.map((item) => {
                    const isSelected = accent === item.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        role="radio"
                        aria-checked={isSelected}
                        className={`settings-accent-button ${isSelected ? "selected" : ""}`}
                        onClick={() => setAccent(item.id)}
                      >
                        <span
                          className="settings-accent-swatch"
                          style={{ background: item.hex }}
                        >
                          {isSelected && <Check size={12} color="#ffffff" />}
                        </span>
                        <div>
                          <strong>{item.name}</strong>
                          <small>{item.description}</small>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="settings-preview-panel">
                <span className="eyebrow">Live Preview</span>
                <div className="settings-preview-row">
                  <button type="button" className="primary-button" tabIndex={-1}>
                    Primary Action
                  </button>
                  <button type="button" className="secondary-button" tabIndex={-1}>
                    Secondary
                  </button>
                  <span className="settings-preview-chip">Active Tag</span>
                  <div className="settings-preview-clock">
                    <strong>25:00</strong>
                    <small>Focus</small>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === "shortcuts" && (
            <div className="settings-section">
              <div className="settings-block-heading">
                <h3>Keyboard Shortcuts</h3>
                <p>Quick keys for high-frequency workspace navigation and actions.</p>
              </div>
              <dl className="settings-shortcuts-list">
                <div>
                  <dt>
                    <kbd>⌘</kbd> <kbd>K</kbd> / <kbd>Ctrl</kbd> <kbd>K</kbd>
                  </dt>
                  <dd>Open command palette to search tasks, projects, or log activity</dd>
                </div>
                <div>
                  <dt>
                    <kbd>⌘</kbd> <kbd>⇧</kbd> <kbd>F</kbd>
                  </dt>
                  <dd>Quick-start a 25-minute focus session</dd>
                </div>
                <div>
                  <dt>
                    <kbd>Esc</kbd>
                  </dt>
                  <dd>Close any open dialog, modal, drawer, or reorder mode</dd>
                </div>
                <div>
                  <dt>
                    <kbd>←</kbd> <kbd>→</kbd>
                  </dt>
                  <dd>Move through options in view switchers and segmented controls</dd>
                </div>
              </dl>
            </div>
          )}

          {activeTab === "about" && (
            <div className="settings-section">
              <div className="settings-block-heading">
                <h3>Storage &amp; Local First</h3>
                <p>Dayflow stores all data locally on your computer in an embedded SQLite database.</p>
              </div>
              <div className="settings-storage-card">
                <div>
                  <strong>Local Database</strong>
                  <small>SQLite via Prisma Client</small>
                </div>
                {onOpenDataManagement && (
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={onOpenDataManagement}
                  >
                    <DatabaseBackup size={14} />
                    Open Data &amp; Backups
                  </button>
                )}
              </div>
              <div className="settings-about-meta">
                <p>Dayflow v0.1.0 · A local-first workspace for deciding, planning, recording, and reviewing.</p>
              </div>
            </div>
          )}
        </div>

        <footer className="settings-footer">
          <small>Theme choices are saved locally and take effect immediately.</small>
          <button type="button" className="primary-button" onClick={onClose}>
            Done
          </button>
        </footer>
      </section>
    </div>
  );
}
