import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import {
  signInWithPopup,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  type User,
} from 'firebase/auth';
import { doc, setDoc, getDoc, serverTimestamp } from 'firebase/firestore';
import { auth, googleProvider, db } from '../lib/firebase';

export interface UserPreferences {
  anaglyphType: 'red_cyan' | 'red_blue' | 'green_magenta' | 'amber_blue';
  defaultMode: 'normal' | 'anaglyph' | '3d';
  volumeLevel: number;
}

const DEFAULT_PREFS: UserPreferences = {
  anaglyphType: 'red_cyan',
  defaultMode: 'normal',
  volumeLevel: 80,
};

interface AuthContextType {
  user: User | null;
  preferences: UserPreferences;
  loading: boolean;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  updatePreferences: (prefs: Partial<UserPreferences>) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [preferences, setPreferences] = useState<UserPreferences>(DEFAULT_PREFS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      if (firebaseUser) {
        await loadOrCreateUserDoc(firebaseUser);
      }
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  async function loadOrCreateUserDoc(firebaseUser: User) {
    const userRef = doc(db, 'users', firebaseUser.uid);
    const snap = await getDoc(userRef);

    if (snap.exists()) {
      const data = snap.data();
      setPreferences({
        anaglyphType: data.preferences?.anaglyphType ?? DEFAULT_PREFS.anaglyphType,
        defaultMode: data.preferences?.defaultMode ?? DEFAULT_PREFS.defaultMode,
        volumeLevel: data.preferences?.volumeLevel ?? DEFAULT_PREFS.volumeLevel,
      });
    } else {
      await setDoc(userRef, {
        displayName: firebaseUser.displayName,
        email: firebaseUser.email,
        photoURL: firebaseUser.photoURL,
        preferences: DEFAULT_PREFS,
        createdAt: serverTimestamp(),
      });
      setPreferences(DEFAULT_PREFS);
    }
  }

  async function signIn() {
    await signInWithPopup(auth, googleProvider);
  }

  async function signOut() {
    await firebaseSignOut(auth);
    setPreferences(DEFAULT_PREFS);
  }

  async function updatePreferences(newPrefs: Partial<UserPreferences>) {
    if (!user) return;
    const merged = { ...preferences, ...newPrefs };
    setPreferences(merged);
    const userRef = doc(db, 'users', user.uid);
    await setDoc(userRef, { preferences: merged }, { merge: true });
  }

  return (
    <AuthContext.Provider
      value={{ user, preferences, loading, signIn, signOut, updatePreferences }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
