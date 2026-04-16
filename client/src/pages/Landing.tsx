import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { v4 as uuidv4 } from 'uuid';
import './Landing.css';

export function Landing() {
  const { user, loading, signIn, signOut } = useAuth();
  const navigate = useNavigate();

  function handleNewMeeting() {
    const meetingId = uuidv4().slice(0, 8);
    navigate(`/meeting/${meetingId}`);
  }

  function handleJoinMeeting(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const code = (formData.get('meetingCode') as string).trim();
    if (code) {
      navigate(`/meeting/${code}`);
    }
  }

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="loading-spinner" />
      </div>
    );
  }

  return (
    <div className="landing">
      {/* Background mesh gradient */}
      <div className="landing-bg" />
      
      {/* Floating orbs */}
      <div className="landing-orb landing-orb--1" />
      <div className="landing-orb landing-orb--2" />
      <div className="landing-orb landing-orb--3" />

      {/* Header */}
      <header className="landing-header">
        <div className="landing-logo">
          <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
            <rect width="32" height="32" rx="8" fill="url(#logo-grad)" />
            <path d="M8 16L16 8L24 16L16 24Z" fill="white" fillOpacity="0.9" />
            <path d="M12 16L16 12L20 16L16 20Z" fill="white" fillOpacity="0.5" />
            <defs>
              <linearGradient id="logo-grad" x1="0" y1="0" x2="32" y2="32">
                <stop stopColor="#7c5cff" />
                <stop offset="1" stopColor="#00d4ff" />
              </linearGradient>
            </defs>
          </svg>
          <span className="landing-logo-text">Parallax</span>
        </div>
        {user ? (
          <div className="landing-user">
            <button
              className="btn btn-secondary"
              onClick={() => navigate('/settings')}
              style={{ padding: '6px 12px', fontSize: '0.8rem' }}
            >
              ⚙️ Settings
            </button>
            <img src={user.photoURL || ''} alt="" className="landing-avatar" />
            <span className="landing-user-name">{user.displayName}</span>
            <button
              className="btn btn-secondary"
              onClick={signOut}
              style={{ padding: '6px 12px', fontSize: '0.8rem', color: 'var(--accent-danger)' }}
              title="Sign out"
            >
              Sign out
            </button>
          </div>
        ) : null}
      </header>

      {/* Hero */}
      <main className="landing-hero">
        <div className="landing-hero-content">
          <h1 className="landing-title">
            Video meetings in{' '}
            <span className="text-gradient">a new dimension</span>
          </h1>
          <p className="landing-subtitle">
            Real-time 3D video calls with anaglyph stereo and Gaussian splatting.
            Just open a link and talk.
          </p>

          {user ? (
            <div className="landing-actions">
              <button className="btn btn-primary btn-lg" onClick={handleNewMeeting}>
                <span>✦</span> New Meeting
              </button>
              <form className="landing-join-form" onSubmit={handleJoinMeeting}>
                <input
                  type="text"
                  name="meetingCode"
                  placeholder="Enter meeting code"
                  className="landing-input"
                  autoComplete="off"
                />
                <button type="submit" className="btn btn-secondary">
                  Join
                </button>
              </form>
            </div>
          ) : (
            <button className="btn btn-primary btn-lg" onClick={signIn}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
              </svg>
              Sign in with Google
            </button>
          )}
        </div>

        {/* Feature pills */}
        <div className="landing-features">
          <div className="feature-pill">
            <span className="feature-pill-icon">🎥</span>
            <span>HD Video</span>
          </div>
          <div className="feature-pill">
            <span className="feature-pill-icon">👓</span>
            <span>Anaglyph 3D</span>
          </div>
          <div className="feature-pill">
            <span className="feature-pill-icon">🧊</span>
            <span>Gaussian Splatting</span>
          </div>
        </div>
      </main>
    </div>
  );
}
