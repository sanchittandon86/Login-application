
const jwt = require("jsonwebtoken");
const pool = require("../config/db");

const authMiddleware = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  // 1. Check whether the access token was provided
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({
      message: "Access token is required",
    });
  }

  const token = authHeader.slice(7).trim();

  if (!token) {
    return res.status(401).json({
      message: "Access token is required",
    });
  }

  // 2. Check JWT configuration
  if (!process.env.JWT_SECRET) {
    console.error("JWT_SECRET is not configured");

    return res.status(500).json({
      message: "Internal server error",
    });
  }

  try {
    // 3. Verify access token signature and expiry
    const decoded = jwt.verify(token, process.env.JWT_SECRET, {
      algorithms: ["HS256"],
    });

    // 4. Require a valid session-aware token
    if (!decoded.userId || !decoded.sessionId) {
      return res.status(401).json({
        message: "Invalid or revoked session",
      });
    }

    // 5. Confirm this session is still active in PostgreSQL
    const result = await pool.query(
      `SELECT 1
       FROM refresh_tokens
       WHERE user_id = $1
         AND session_id = $2
         AND revoked_at IS NULL
         AND expires_at > NOW()
       LIMIT 1`,
      [decoded.userId, decoded.sessionId]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        message: "Session expired or revoked. Please log in again.",
      });
    }

    // 6. Attach verified user information
    req.user = decoded;

    return next();
  } catch (error) {
    if (error.name === "TokenExpiredError") {
      return res.status(401).json({
        message: "Access token has expired",
      });
    }

    if (error.name === "JsonWebTokenError") {
      return res.status(401).json({
        message: "Invalid access token",
      });
    }

    console.error("Authentication error:", error.message);

    return res.status(500).json({
      message: "Internal server error",
    });
  }
};

module.exports = authMiddleware;
