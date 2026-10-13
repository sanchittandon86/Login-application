
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";

import {
  loginUser,
  getProfile,
  logoutUser,
} from "../services/auth";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // Restore the user's session when the app starts.
  useEffect(() => {
    let cancelled = false;

    const restoreSession = async () => {
      try {
        const accessToken = localStorage.getItem("accessToken");
        const profile = await getProfile(accessToken);

        if (!cancelled) {
          setUser(profile.user ?? profile);
        }
      } catch {
        localStorage.removeItem("accessToken");

        if (!cancelled) {
          setUser(null);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    restoreSession();

    return () => {
      cancelled = true;
    };
  }, []);

  // Log in and update the global user state.
  const login = useCallback(async (email, password) => {
    const data = await loginUser(email, password);

    localStorage.setItem("accessToken", data.accessToken);
    setUser(data.user);

    return data;
  }, []);

  // Log out and clear local authentication state.
  const logout = useCallback(async () => {
    try {
      await logoutUser();
    } finally {
      localStorage.removeItem("accessToken");
      setUser(null);
    }
  }, []);

  const value = {
    user,
    loading,
    isAuthenticated: Boolean(user),
    login,
    logout,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

// Custom hook for accessing authentication state.
export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error(
      "useAuth must be used inside an AuthProvider"
    );
  }

  return context;
}
