
const API_URL = "http://localhost:3000/api/auth";

// Access token lives only in memory, never in localStorage/sessionStorage,
// so it isn't readable by an XSS payload that can read web storage.
let accessToken = null;

export const setAccessToken = (token) => {
  accessToken = token;
};

// Shared promise prevents simultaneous refresh requests.
let refreshPromise = null;

async function parseResponse(response) {
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(
      data.message || "Something went wrong"
    );
    error.status = response.status;
    throw error;
  }

  return data;
}

// Registration
export const registerUser = async (name, email, password) => {
  const response = await fetch(`${API_URL}/register`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name, email, password }),
  });

  return parseResponse(response);
};

// Login
export const loginUser = async (email, password) => {
  const response = await fetch(`${API_URL}/login`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password }),
  });

  return parseResponse(response);
};

// Refresh the access token.
// Concurrent callers share the same refresh request.
export const refreshAccessToken = async () => {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      const response = await fetch(`${API_URL}/refresh`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
      });

      const data = await parseResponse(response);

      if (!data.accessToken) {
        throw new Error("No access token returned by server");
      }

      setAccessToken(data.accessToken);

      return data;
    })().finally(() => {
      refreshPromise = null;
    });
  }

  return refreshPromise;
};

// Automatically refresh and retry a failed authenticated request.
export const authenticatedFetch = async (
  url,
  options = {}
) => {
  const makeRequest = (token) => {
    const headers = new Headers(options.headers || {});

    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
    }

    return fetch(url, {
      ...options,
      headers,
    });
  };

  // First attempt
  const response = await makeRequest(accessToken);

  if (response.status !== 401) {
    return response;
  }

  // The access token may have expired.
  let refreshed;

  try {
    refreshed = await refreshAccessToken();
  } catch (error) {
    setAccessToken(null);
    throw error;
  }

  // Retry the original request once with the new token.
  const retryResponse = await makeRequest(refreshed.accessToken);

  // Do not refresh repeatedly if the retry is also unauthorized.
  if (retryResponse.status === 401) {
    setAccessToken(null);
  }

  return retryResponse;
};

// Get the logged-in user's profile
export const getProfile = async () => {
  const response = await authenticatedFetch(`${API_URL}/profile`, {
    method: "GET",
  });

  return parseResponse(response);
};

// Logout
export const logoutUser = async () => {
  const response = await fetch(`${API_URL}/logout`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
  });

  return parseResponse(response);
};
