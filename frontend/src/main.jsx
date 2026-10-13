import React from "react";
import ReactDOM from "react-dom/client";
import axios from "axios";

import { initializeTheme } from "./utils/theme";
import App from "./App.jsx";
import "./index.css";

initializeTheme();

axios.interceptors.request.use(
  (config) => {
    const token =
      localStorage.getItem(
        "eduliteToken",
      );

    if (token) {
      config.headers =
        config.headers ?? {};

      config.headers.Authorization =
        `Bearer ${token}`;
    }

    return config;
  },
  (error) =>
    Promise.reject(error),
);

axios.interceptors.response.use(
  (response) => {
    const requestUrl =
      response.config?.url ?? "";

    const isAuthenticationRequest =
      requestUrl.endsWith(
        "/login",
      ) ||
      requestUrl.endsWith(
        "/register",
      ) || requestUrl.endsWith("/account/reset-password");

    if (
      isAuthenticationRequest &&
      response.data?.token
    ) {
      localStorage.setItem(
        "eduliteToken",
        response.data.token,
      );

      if (response.data.user) {
        localStorage.setItem(
          "user",
          JSON.stringify(
            response.data.user,
          ),
        );
      }
    }

    return response;
  },
  (error) => {
    const status =
      error.response?.status;

    const requestUrl =
      error.config?.url ?? "";

    const isAuthenticationRequest =
      requestUrl.endsWith(
        "/login",
      ) ||
      requestUrl.endsWith(
        "/register",
      ) || requestUrl.endsWith("/account/reset-password");

    if (
      status === 401 &&
      !isAuthenticationRequest
    ) {
      localStorage.removeItem(
        "eduliteToken",
      );

      localStorage.removeItem(
        "user",
      );

      if (
        window.location.pathname !==
        "/"
      ) {
        window.location.assign(
          "/",
        );
      }
    }

    return Promise.reject(error);
  },
);

ReactDOM.createRoot(
  document.getElementById(
    "root",
  ),
).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);