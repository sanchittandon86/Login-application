const express = require("express");
const authMiddleware = require("../middleware/auth.middleware");
const {
  register,
  login,
  refresh,
  logout,
  getProfile,
} = require("../controller/auth.controller");

const router = express.Router();

// Register a new user
router.post("/register", register);

// Login and receive access + refresh tokens
router.post("/login", login);

// Refresh access token and rotate refresh token
router.post("/refresh", refresh);

// Logout and revoke refresh token
router.post("/logout", logout);

// Protected profile route
router.get("/profile", authMiddleware, getProfile);

module.exports = router;
