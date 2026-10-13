const express = require("express");
const authMiddleware = require("../middleware/auth.middleware");
const createRateLimiter = require("../middleware/rateLimit.middleware");
const {
  register,
  login,
  refresh,
  logout,
  getProfile,
} = require("../controller/auth.controller");

const router = express.Router();

const registerLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000,
  max: 3,
  message: "Too many registration attempts. Please try again later.",
});

const loginLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 3,
  message: "Too many login attempts. Please try again later.",
});

// Register a new user
router.post("/register", registerLimiter, register);

// Login and receive access + refresh tokens
router.post("/login", loginLimiter, login);

// Refresh access token and rotate refresh token
router.post("/refresh", refresh);

// Logout and revoke refresh token
router.post("/logout", logout);

// Protected profile route
router.get("/profile", authMiddleware, getProfile);

module.exports = router;
