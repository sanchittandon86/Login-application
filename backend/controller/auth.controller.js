
const bcrypt = require("bcryptjs");
const pool = require("../config/db");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");

const refreshCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  path: "/api/auth",
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

// Generate a short-lived access token
const createAccessToken = (user, sessionId) => {
  return jwt.sign(
    {
      userId: user.id,
      email: user.email,
      sessionId,
    },
    process.env.JWT_SECRET,
    {
      expiresIn: process.env.JWT_EXPIRES_IN || "15m",
    }
  );
};

// Generate a longer-lived refresh token
const createRefreshToken = (user, sessionId) => {
  return jwt.sign(
    {
      userId: user.id,
      sessionId,
      // Ensures distinct tokens (and hashes) even when minted
      // within the same second for the same session.
      jti: crypto.randomUUID(),
    },
    process.env.JWT_REFRESH_SECRET,
    {
      expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || "7d",
    }
  );
};

// Store only the SHA-256 hash of a refresh token
const hashRefreshToken = (token) => {
  return crypto.createHash("sha256").update(token).digest("hex");
};

// REGISTER
const register = async (req, res) => {
  try {
    const { name, email, password } = req.body || {};

    if (
      typeof name !== "string" ||
      !name.trim() ||
      typeof email !== "string" ||
      !email.trim() ||
      typeof password !== "string" ||
      !password
    ) {
      return res.status(400).json({
        message: "Name, email and password are required",
      });
    }

    if (password.length < 8) {
      return res.status(400).json({
        message: "Password must be at least 8 characters long",
      });
    }

    const normalizedEmail = email.trim().toLowerCase();

    const existingUser = await pool.query(
      "SELECT id FROM users WHERE email = $1",
      [normalizedEmail]
    );

    if (existingUser.rows.length > 0) {
      return res.status(409).json({
        message: "User already exists",
      });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const result = await pool.query(
      `INSERT INTO users (name, email, password_hash)
       VALUES ($1, $2, $3)
       RETURNING id, name, email, created_at`,
      [name.trim(), normalizedEmail, passwordHash]
    );

    return res.status(201).json({
      message: "User registered successfully",
      user: result.rows[0],
    });
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({
        message: "User already exists",
      });
    }

    console.error("Register error:", error);

    return res.status(500).json({
      message: "Internal server error",
    });
  }
};

// LOGIN — only one active session per user
const login = async (req, res) => {
  try {
    const { email, password } = req.body || {};

    if (
      typeof email !== "string" ||
      !email.trim() ||
      typeof password !== "string" ||
      !password
    ) {
      return res.status(400).json({
        message: "Email and password are required",
      });
    }

    if (!process.env.JWT_SECRET || !process.env.JWT_REFRESH_SECRET) {
      console.error("JWT secrets are not configured");

      return res.status(500).json({
        message: "Internal server error",
      });
    }

    const normalizedEmail = email.trim().toLowerCase();

    const result = await pool.query(
      `SELECT id, name, email, password_hash
       FROM users
       WHERE email = $1`,
      [normalizedEmail]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        message: "Invalid email or password",
      });
    }

    const user = result.rows[0];

    const isPasswordValid = await bcrypt.compare(
      password,
      user.password_hash
    );

    if (!isPasswordValid) {
      return res.status(401).json({
        message: "Invalid email or password",
      });
    }

    // Every successful login creates a new session
    const sessionId = crypto.randomUUID();

    const accessToken = createAccessToken(user, sessionId);
    const refreshToken = createRefreshToken(user, sessionId);
    const tokenHash = hashRefreshToken(refreshToken);

    const decodedRefreshToken = jwt.decode(refreshToken);
    const expiresAt = new Date(decodedRefreshToken.exp * 1000);

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      // Serialize simultaneous logins for the same user
      await client.query(
        "SELECT id FROM users WHERE id = $1 FOR UPDATE",
        [user.id]
      );

      // Revoke all previously active refresh-token sessions
      await client.query(
        `UPDATE refresh_tokens
         SET revoked_at = NOW()
         WHERE user_id = $1
           AND revoked_at IS NULL`,
        [user.id]
      );

      // Insert the new active session
      await client.query(
        `INSERT INTO refresh_tokens
         (user_id, token_hash, session_id, expires_at)
         VALUES ($1, $2, $3, $4)`,
        [user.id, tokenHash, sessionId, expiresAt]
      );

      await client.query("COMMIT");
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        console.error("Login rollback error:", rollbackError);
      }

      throw error;
    } finally {
      client.release();
    }

    res.cookie("refreshToken", refreshToken, refreshCookieOptions);

    return res.status(200).json({
      message: "Login successful",
      accessToken,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
      },
    });
  } catch (error) {
    console.error("Login error:", error);

    return res.status(500).json({
      message: "Internal server error",
    });
  }
};

// REFRESH ACCESS TOKEN AND ROTATE REFRESH TOKEN
const refresh = async (req, res) => {
  const refreshToken = req.cookies?.refreshToken;

  if (typeof refreshToken !== "string" || !refreshToken.trim()) {
    return res.status(400).json({
      message: "Refresh token is required",
    });
  }

  if (!process.env.JWT_REFRESH_SECRET || !process.env.JWT_SECRET) {
    console.error("JWT secrets are not configured");

    return res.status(500).json({
      message: "Internal server error",
    });
  }

  let decoded;

  try {
    decoded = jwt.verify(
      refreshToken,
      process.env.JWT_REFRESH_SECRET,
      { algorithms: ["HS256"] }
    );

    if (!decoded.userId || !decoded.sessionId) {
      return res.status(401).json({
        message: "Invalid refresh token",
      });
    }
  } catch (error) {
    return res.status(401).json({
      message: "Invalid or expired refresh token",
    });
  }

  const tokenHash = hashRefreshToken(refreshToken);

  let client;
  let transactionStarted = false;

  try {
    client = await pool.connect();

    await client.query("BEGIN");
    transactionStarted = true;

    // Revoke the old token only if it is active and belongs
    // to the session encoded in the refresh token
    const oldToken = await client.query(
      `UPDATE refresh_tokens
       SET revoked_at = NOW()
       WHERE token_hash = $1
         AND user_id = $2
         AND session_id = $3
         AND revoked_at IS NULL
         AND expires_at > NOW()
       RETURNING user_id, session_id`,
      [tokenHash, decoded.userId, decoded.sessionId]
    );

    if (oldToken.rows.length === 0) {
      await client.query("ROLLBACK");
      transactionStarted = false;

      return res.status(401).json({
        message: "Refresh token is invalid, revoked, or already used",
      });
    }

    const userResult = await client.query(
      `SELECT id, name, email
       FROM users
       WHERE id = $1`,
      [oldToken.rows[0].user_id]
    );

    if (userResult.rows.length === 0) {
      await client.query("ROLLBACK");
      transactionStarted = false;

      return res.status(401).json({
        message: "User no longer exists",
      });
    }

    const user = userResult.rows[0];
    const sessionId = oldToken.rows[0].session_id;

    // Preserve the same session ID when rotating tokens
    const accessToken = createAccessToken(user, sessionId);
    const newRefreshToken = createRefreshToken(user, sessionId);
    const newTokenHash = hashRefreshToken(newRefreshToken);

    const decodedNewRefreshToken = jwt.decode(newRefreshToken);
    const expiresAt = new Date(decodedNewRefreshToken.exp * 1000);

    await client.query(
      `INSERT INTO refresh_tokens
       (user_id, token_hash, session_id, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [user.id, newTokenHash, sessionId, expiresAt]
    );

    await client.query("COMMIT");
    transactionStarted = false;

    res.cookie(
      "refreshToken",
      newRefreshToken,
      refreshCookieOptions
    );


    return res.status(200).json({
      message: "Token refreshed successfully",
      accessToken,
    });
  } catch (error) {
    if (client && transactionStarted) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        console.error("Refresh rollback error:", rollbackError);
      }
    }

    console.error("Refresh error:", error);

    return res.status(500).json({
      message: "Internal server error",
    });
  } finally {
    if (client) {
      client.release();
    }
  }
};

// LOGOUT — revoke the current refresh-token session
const logout = async (req, res) => {
  try {
    const refreshToken = req.cookies?.refreshToken;

    if (typeof refreshToken !== "string" || !refreshToken.trim()) {
      return res.status(400).json({
        message: "Refresh token is required",
      });
    }

    if (!process.env.JWT_REFRESH_SECRET) {
      console.error("JWT_REFRESH_SECRET is not configured");

      return res.status(500).json({
        message: "Internal server error",
      });
    }

    let decoded;

    try {
      decoded = jwt.verify(
        refreshToken,
        process.env.JWT_REFRESH_SECRET,
        { algorithms: ["HS256"] }
      );
    } catch (error) {
      return res.status(401).json({
        message: "Invalid or expired refresh token",
      });
    }

    if (!decoded.userId || !decoded.sessionId) {
      return res.status(401).json({
        message: "Invalid refresh token",
      });
    }

    const tokenHash = hashRefreshToken(refreshToken);

    // Revoke all refresh tokens for this session
    await pool.query(
      `UPDATE refresh_tokens
       SET revoked_at = NOW()
       WHERE user_id = $1
         AND session_id = $2
         AND revoked_at IS NULL`,
      [decoded.userId, decoded.sessionId]
    );

    res.clearCookie("refreshToken", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/api/auth",
    });

    return res.status(200).json({
      message: "Logout successful",
    });
  } catch (error) {
    console.error("Logout error:", error);

    return res.status(500).json({
      message: "Internal server error",
    });
  }
};


const getProfile = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, email, created_at
       FROM users
       WHERE id = $1`,
      [req.user.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        message: "User not found",
      });
    }

    return res.status(200).json({
      user: result.rows[0],
    });
  } catch (error) {
    console.error("Get profile error:", error.message);

    return res.status(500).json({
      message: "Internal server error",
    });
  }
};


module.exports = {
  register,
  login,
  refresh,
  logout,
  getProfile,
};
