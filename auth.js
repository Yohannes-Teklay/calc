/* =====================================================================
   Login — Firebase email & password accounts
   ---------------------------------------------------------------------
   What this file does:
     • Shows a login screen until the person is logged in, then shows
       the calculator. Firebase remembers the login on this device, so
       people only log in once.
     • Lets new people create an account (and emails them a link to
       verify their address).
     • "Forgot password?" emails a link to choose a new password.
     • The Account window lets a logged-in person change their password,
       email themselves a reset link, or log out.

   Sections:
     1. Firebase setup
     2. Page elements
     3. Helpers (messages, busy buttons, friendly error text)
     4. Login screen: switching between Log in / Create account / Reset
     5. Login screen: submitting the form
     6. Account window: change password, reset link, log out
     7. Showing the right screen when someone logs in or out

   This file is loaded as a "module" (type="module" in calc.htm), which is
   what lets it import Firebase straight from Google's servers.
   ===================================================================== */


/* ---------- 1. Firebase setup ---------- */

// Firebase's building blocks, loaded from Google (version 13.4.0).
import { initializeApp } from "https://www.gstatic.com/firebasejs/13.4.0/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,              // tells us whenever someone logs in or out
  signInWithEmailAndPassword,      // log in
  createUserWithEmailAndPassword,  // create an account
  sendEmailVerification,           // "please confirm your email" message
  sendPasswordResetEmail,          // "choose a new password" link
  EmailAuthProvider,               // builds a login proof from email + password
  reauthenticateWithCredential,    // re-checks the current password before changing it
  updatePassword,                  // saves the new password
  signOut,                         // log out
} from "https://www.gstatic.com/firebasejs/13.4.0/firebase-auth.js";

// Your project's public settings from the Firebase console.
// These are safe to put in a web page: they only say WHICH Firebase project
// to talk to. Security comes from the settings in the Firebase console.
const firebaseConfig = {
  apiKey: "AIzaSyAFBKBwBJ6cr2B3cIAId_fT6tAxNwlAO9Y",
  authDomain: "calc-c7c13.firebaseapp.com",
  projectId: "calc-c7c13",
  storageBucket: "calc-c7c13.firebasestorage.app",
  messagingSenderId: "473615120789",
  appId: "1:473615120789:web:3e4343eb9e7ebdc2189e9c",
  measurementId: "G-7294YQ492Z",
};

// Connect to your Firebase project and its login service.
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

// Google Analytics (visitor statistics) — optional extra.
// Loaded separately so that if an ad blocker stops it, login still works.
import("https://www.gstatic.com/firebasejs/13.4.0/firebase-analytics.js")
  .then(async ({ getAnalytics, isSupported }) => {
    if (await isSupported()) getAnalytics(app); // skip on browsers that can't run it
  })
  .catch(() => { /* blocked or offline — the app works fine without it */ });


/* ---------- 2. Page elements ---------- */

// Screens
const loadingEl = document.getElementById("loading");      // "Loading…" shown at start-up
const authScreen = document.getElementById("auth-screen"); // login screen
const calcEl = document.getElementById("calc");            // the calculator

// Login screen parts
const authTitle = document.getElementById("auth-title");
const authSubtitle = document.getElementById("auth-subtitle");
const authForm = document.getElementById("auth-form");
const emailInput = document.getElementById("auth-email");
const passwordRow = document.getElementById("password-row");
const passwordInput = document.getElementById("auth-password");
const confirmRow = document.getElementById("confirm-row");
const confirmInput = document.getElementById("auth-confirm");
const authSubmit = document.getElementById("auth-submit");
const authMessage = document.getElementById("auth-message");
const linkForgot = document.getElementById("link-forgot");
const linkSignup = document.getElementById("link-signup");
const linkSignin = document.getElementById("link-signin");

// Account window parts
const accountButton = document.getElementById("account-button");
const accountDialog = document.getElementById("account-dialog");
const accountEmail = document.getElementById("account-email");
const passwordForm = document.getElementById("password-form");
const currentPassword = document.getElementById("current-password");
const newPassword = document.getElementById("new-password");
const newPasswordConfirm = document.getElementById("new-password-confirm");
const passwordSubmit = document.getElementById("password-submit");
const sendResetButton = document.getElementById("send-reset");
const logoutButton = document.getElementById("logout");
const accountClose = document.getElementById("account-close");
const accountMessage = document.getElementById("account-message");

/** Shortest password allowed for new passwords. */
const MIN_PASSWORD = 8;


/* ---------- 3. Helpers ---------- */

/**
 * Shows a message under a form.
 * type: "error" (red), "success" (green) or "" (plain grey).
 */
function showMessage(el, text, type = "") {
  el.textContent = text;
  el.className = "message" + (type ? " " + type : "");
}

/**
 * Disables a button and shows "Please wait…" while Firebase is working,
 * so people can't press it twice. Puts the original label back afterwards.
 */
function setBusy(button, busy) {
  if (busy) {
    button.dataset.label = button.textContent;
    button.textContent = "Please wait…";
  } else if (button.dataset.label) {
    button.textContent = button.dataset.label;
  }
  button.disabled = busy;
}

/**
 * Turns Firebase's technical error codes into plain English.
 * Login failures always say "wrong email or password" without saying
 * which one, so strangers can't find out who has an account.
 */
function friendlyError(error) {
  switch (error.code) {
    // Firebase gives this same answer when the password is wrong AND when
    // no account exists for that email, so the message covers both cases.
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return "Wrong email or password. New here? Tap \"Create an account\" below first.";
    case "auth/invalid-email":
      return "That email address doesn't look right.";
    case "auth/missing-password":
      return "Please enter your password.";
    case "auth/email-already-in-use":
      return "An account with this email already exists. Try logging in.";
    case "auth/weak-password":
    case "auth/password-does-not-meet-requirements":
      return `That password is too weak. Use at least ${MIN_PASSWORD} characters.`;
    case "auth/too-many-requests":
      return "Too many attempts. Please wait a few minutes and try again.";
    case "auth/network-request-failed":
      return "No internet connection. Check your connection and try again.";
    case "auth/requires-recent-login":
      return "For your security, please log out, log back in, and try again.";
    case "app/passwords-differ":
      return "The two new passwords don't match.";
    case "app/password-too-short":
      return `Passwords must be at least ${MIN_PASSWORD} characters.`;
    default:
      return "Something went wrong. Please try again.";
  }
}

/** Creates an error with our own code, so friendlyError can explain it. */
const appError = (code) => Object.assign(new Error(code), { code });


/* ---------- 4. Login screen: switching views ---------- */

/** Which form is showing: "signin", "signup" or "reset". */
let view = "signin";

/**
 * Switches the login screen between its three forms.
 * Hidden fields are also disabled, so the browser doesn't ask for them
 * (a hidden "required" field would block the form otherwise).
 */
function setView(next) {
  view = next;
  const signin = view === "signin";
  const signup = view === "signup";
  const reset = view === "reset";

  // Headings and main button text
  authTitle.textContent = signup ? "Create account" : reset ? "Reset password" : "Log in";
  authSubtitle.textContent = signup
    ? "Choose your email and a password."
    : reset
      ? "Enter your email and we'll send you a link to choose a new password."
      : "Log in to use the calculator.";
  authSubmit.textContent = signup ? "Create account" : reset ? "Send reset link" : "Log in";

  // Password field: shown for log in and create account, not for reset.
  passwordRow.hidden = reset;
  passwordInput.disabled = reset;
  // Tell password managers whether to fill a saved password or suggest a new one.
  passwordInput.autocomplete = signup ? "new-password" : "current-password";
  passwordInput.minLength = signup ? MIN_PASSWORD : 0;

  // "Confirm password" only when creating an account.
  confirmRow.hidden = !signup;
  confirmInput.disabled = !signup;

  // Links under the form
  linkForgot.hidden = !signin;
  linkSignup.hidden = !signin;
  linkSignin.hidden = signin;

  showMessage(authMessage, "");
}

// The three links just switch views.
linkForgot.addEventListener("click", () => setView("reset"));
linkSignup.addEventListener("click", () => setView("signup"));
linkSignin.addEventListener("click", () => setView("signin"));


/* ---------- 5. Login screen: submitting ---------- */

/*
 * Runs when the main button is pressed (or Enter in a field).
 * Does a different job depending on the current view.
 * On successful log in / sign up we don't switch screens here —
 * onAuthStateChanged (section 7) notices and does it.
 */
authForm.addEventListener("submit", async (event) => {
  event.preventDefault(); // stay on this page instead of reloading it
  const email = emailInput.value.trim();
  showMessage(authMessage, "");
  setBusy(authSubmit, true);

  try {
    if (view === "signin") {
      await signInWithEmailAndPassword(auth, email, passwordInput.value);

    } else if (view === "signup") {
      if (passwordInput.value.length < MIN_PASSWORD) throw appError("app/password-too-short");
      if (passwordInput.value !== confirmInput.value) throw appError("app/passwords-differ");
      const { user } = await createUserWithEmailAndPassword(auth, email, passwordInput.value);
      // Ask them to confirm their email. Don't wait for it or fail if it can't send.
      sendEmailVerification(user).catch(() => {});

    } else {
      await sendPasswordResetEmail(auth, email);
      showResetSent();
    }
  } catch (error) {
    // For reset, act the same whether or not the account exists,
    // so the form can't be used to check who has an account.
    if (view === "reset" && error.code === "auth/user-not-found") showResetSent();
    else showMessage(authMessage, friendlyError(error), "error");
  } finally {
    setBusy(authSubmit, false);
  }
});

/** The message shown after a reset link is requested. */
function showResetSent() {
  showMessage(
    authMessage,
    "If an account exists for that email, a reset link is on its way. Check your inbox and spam folder.",
    "success"
  );
}


/* ---------- 6. Account window ---------- */

// "Account" button in the calculator's top bar opens the window.
accountButton.addEventListener("click", () => {
  passwordForm.reset();
  showMessage(accountMessage, "");
  accountDialog.showModal(); // modal: the calculator behind can't be used until it's closed
});

// "Close" button shuts it.
accountClose.addEventListener("click", () => accountDialog.close());

/*
 * Change password.
 * Firebase requires the current password first (re-authentication), so
 * someone who picks up an unlocked phone can't change it.
 */
passwordForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  showMessage(accountMessage, "");
  setBusy(passwordSubmit, true);

  try {
    if (newPassword.value.length < MIN_PASSWORD) throw appError("app/password-too-short");
    if (newPassword.value !== newPasswordConfirm.value) throw appError("app/passwords-differ");

    const user = auth.currentUser;
    // Step 1: prove it's really them with their current password.
    const proof = EmailAuthProvider.credential(user.email, currentPassword.value);
    await reauthenticateWithCredential(user, proof);
    // Step 2: save the new password.
    await updatePassword(user, newPassword.value);

    passwordForm.reset();
    showMessage(accountMessage, "Password changed.", "success");
  } catch (error) {
    // A wrong current password comes back as "invalid credential".
    const text = error.code === "auth/invalid-credential" || error.code === "auth/wrong-password"
      ? "Your current password is wrong."
      : friendlyError(error);
    showMessage(accountMessage, text, "error");
  } finally {
    setBusy(passwordSubmit, false);
  }
});

/*
 * "Email me a reset link" — for people who are logged in but have
 * forgotten their current password, so they can't use the form above.
 */
sendResetButton.addEventListener("click", async () => {
  setBusy(sendResetButton, true);
  try {
    await sendPasswordResetEmail(auth, auth.currentUser.email);
    showMessage(accountMessage, "Reset link sent to your email. Check your spam folder too.", "success");
  } catch (error) {
    showMessage(accountMessage, friendlyError(error), "error");
  } finally {
    setBusy(sendResetButton, false);
  }
});

// Log out. Section 7 then switches back to the login screen.
logoutButton.addEventListener("click", async () => {
  await signOut(auth);
});


/* ---------- 7. Showing the right screen ---------- */

/*
 * Firebase calls this once at start-up (with the remembered login, if any)
 * and again every time someone logs in or out.
 *   Logged in  → hide the login screen, show the calculator.
 *   Logged out → hide the calculator, show a clean login screen.
 */
onAuthStateChanged(auth, (user) => {
  loadingEl.hidden = true;
  authScreen.hidden = Boolean(user);
  calcEl.hidden = !user;

  if (user) {
    accountEmail.textContent = user.email;
  } else {
    if (accountDialog.open) accountDialog.close();
    authForm.reset();
    setView("signin");
  }
});
