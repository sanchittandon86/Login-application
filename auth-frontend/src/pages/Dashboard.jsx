
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

function Dashboard() {
  const { user, logout } = useAuth();
  const [loggingOut, setLoggingOut] = useState(false);

  const navigate = useNavigate();

  const handleLogout = async () => {
    setLoggingOut(true);

    try {
      await logout();
    } catch (err) {
      console.error("Logout request failed:", err.message);
    } finally {
      navigate("/login", { replace: true });
    }
  };

  if (!user) return null;

  return (
    <div className="dashboard-page">
      <header className="dashboard-header">
        <div>
          <h2>AuthApp</h2>
          <p>Account dashboard</p>
        </div>

        <button
          className="logout-button"
          onClick={handleLogout}
          disabled={loggingOut}
        >
          {loggingOut ? "Signing out..." : "Log out"}
        </button>
      </header>

      <main className="dashboard-content">
        <div className="welcome-section">
          <p className="eyebrow">OVERVIEW</p>
          <h1>Welcome, {user.name || "User"}!</h1>
          <p>You're successfully authenticated.</p>
        </div>

        <section className="profile-card">
          <h2>Your profile</h2>

          <div className="profile-row">
            <span>Name</span>
            <strong>{user.name || "Not provided"}</strong>
          </div>

          <div className="profile-row">
            <span>Email address</span>
            <strong>{user.email || "Not provided"}</strong>
          </div>

          <div className="profile-row">
            <span>User ID</span>
            <strong>{user.id ?? user.userId ?? "Not provided"}</strong>
          </div>
        </section>
      </main>
    </div>
  );
}

export default Dashboard;
