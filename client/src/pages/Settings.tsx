import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { useState } from 'react';
import type { UserPreferences } from '../contexts/AuthContext';
import './Settings.css';

const GLASSES_OPTIONS = [
  {
    value: 'red_cyan',
    label: 'Red / Cyan',
    leftColor: '#e74c3c',
    rightColor: '#00d4ff',
  },
  {
    value: 'red_blue',
    label: 'Red / Blue',
    leftColor: '#e74c3c',
    rightColor: '#3498db',
  },
  {
    value: 'green_magenta',
    label: 'Green / Magenta',
    leftColor: '#2ecc71',
    rightColor: '#e056a0',
  },
  {
    value: 'amber_blue',
    label: 'Amber / Blue',
    leftColor: '#f39c12',
    rightColor: '#3498db',
  },
] as const;

const MODE_OPTIONS = [
  { value: 'normal', label: '🎥 Normal', description: 'Standard 2D video' },
  { value: 'anaglyph', label: '👓 Anaglyph', description: '3D with anaglyph glasses' },
  { value: '3d', label: '🧊 3D', description: 'Gaussian Splatting' },
] as const;

export function Settings() {
  const { user, preferences, updatePreferences } = useAuth();
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function handleChange(update: Partial<UserPreferences>) {
    setSaving(true);
    setSaved(false);
    try {
      await updatePreferences(update);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="settings">
      <header className="settings-header">
        <button className="btn btn-secondary" onClick={() => navigate('/')}>
          ← Back
        </button>
        <h1>Settings</h1>
        {saved && <span className="settings-saved">✓ Saved</span>}
      </header>

      <main className="settings-content">
        {/* User info */}
        <section className="settings-card">
          <h2>Profile</h2>
          <div className="settings-profile">
            {user?.photoURL && (
              <img src={user.photoURL} alt="" className="settings-avatar" />
            )}
            <div>
              <p className="settings-name">{user?.displayName}</p>
              <p className="settings-email">{user?.email}</p>
            </div>
          </div>
        </section>

        {/* Anaglyph Glasses Type */}
        <section className="settings-card">
          <h2>👓 Anaglyph Glasses Type</h2>
          <p className="settings-description">
            Choose the type that matches your anaglyph glasses for the best 3D effect.
          </p>
          <div className="glasses-grid">
            {GLASSES_OPTIONS.map((option) => (
              <button
                key={option.value}
                className={`glasses-option ${
                  preferences.anaglyphType === option.value ? 'active' : ''
                }`}
                onClick={() => handleChange({ anaglyphType: option.value as UserPreferences['anaglyphType'] })}
                disabled={saving}
              >
                <div className="glasses-swatch">
                  <span style={{ background: option.leftColor }} />
                  <span style={{ background: option.rightColor }} />
                </div>
                <span className="glasses-label">{option.label}</span>
              </button>
            ))}
          </div>
        </section>

        {/* Default Mode */}
        <section className="settings-card">
          <h2>🎬 Default Mode</h2>
          <p className="settings-description">
            The mode that activates when you join a meeting.
          </p>
          <div className="mode-options">
            {MODE_OPTIONS.map((option) => (
              <button
                key={option.value}
                className={`mode-option ${
                  preferences.defaultMode === option.value ? 'active' : ''
                }`}
                onClick={() => handleChange({ defaultMode: option.value as UserPreferences['defaultMode'] })}
                disabled={saving}
              >
                <span className="mode-option-label">{option.label}</span>
                <span className="mode-option-desc">{option.description}</span>
              </button>
            ))}
          </div>
        </section>

        {/* Volume */}
        <section className="settings-card">
          <h2>🔊 Volume</h2>
          <div className="volume-control">
            <input
              type="range"
              min="0"
              max="100"
              value={preferences.volumeLevel}
              onChange={(e) =>
                handleChange({ volumeLevel: parseInt(e.target.value, 10) })
              }
              className="volume-slider"
            />
            <span className="volume-value">{preferences.volumeLevel}%</span>
          </div>
        </section>
      </main>
    </div>
  );
}
