/* =====================================================================
   Calculator — logic
   ---------------------------------------------------------------------
   How it works, in short:
     1. Every button press adds one "token" to a list, e.g. pressing
        2, ×, 4 gives ["2", "×", "4"]. Keeping one token per press means
        ⌫ can always undo exactly one press.
     2. After every press, the list is evaluated in the background and
        the live answer ("= 8") is shown under the sum.
     3. Pressing = makes that answer final: the sum moves to the grey
        line above and the answer becomes the big number.

   Sections:
     1. Page elements
     2. Token types and helpers
     3. Calculator state
     4. Maths (functions, formatting, the expression evaluator)
     5. Typing input (adding tokens with sensible rules)
     6. Commands (=, AC, ⌫, ±, DEG/RAD, mode switch)
     7. Drawing the screen
     8. Remembering settings between visits
     9. Event listeners (mouse/touch and keyboard)
   ===================================================================== */


/* ---------- 1. Page elements ---------- */

const calc = document.getElementById("calc");               // whole calculator
const display = document.getElementById("display");         // big line: sum or answer
const expressionEl = document.getElementById("expression"); // grey line above: "2 × 4 ="
const previewEl = document.getElementById("preview");       // live answer below: "= 8"
const sciKeys = document.getElementById("sci-keys");        // scientific key panel
const modeToggle = document.getElementById("mode-toggle");  // Basic/Scientific button
const angleToggle = document.getElementById("angle-toggle"); // DEG/RAD button


/* ---------- 2. Token types and helpers ---------- */

/** Operators that sit between two numbers: 2 + 3, 2 ^ 3. */
const BINARY = ["+", "−", "×", "÷", "^"];

/** Operators that act on the number just before them: 5!, 50%, 3², 4⁻¹. */
const POSTFIX = ["!", "%", "²", "⁻¹"];

/** Named constants that count as a number on their own. */
const CONSTS = ["π", "e"];

/**
 * True for a digit, a decimal point, or a stored answer such as "12.5".
 * Answers are kept as one token, so the check is "starts with a digit or dot".
 */
const isNum = (t) => t !== undefined && /^[0-9.]/.test(t);

/** True for an operator that needs a number on both sides. */
const isBinary = (t) => BINARY.includes(t);

/** True for "(" and for functions that open a bracket, like "sin(". */
const isOpen = (t) => t !== undefined && t.endsWith("(");

/**
 * True when the token finishes a value, so something like ")" or "!"
 * may follow it. Examples: "7", "π", ")", "!".
 */
const endsValue = (t) =>
  t !== undefined && (isNum(t) || CONSTS.includes(t) || t === ")" || POSTFIX.includes(t));


/* ---------- 3. Calculator state ---------- */

let tokens = [];           // the sum being typed, one token per button press
let history = "";          // grey line text, e.g. "2 × 4 ="
let justEvaluated = false; // true right after =, while the answer is on screen
let isError = false;       // true when the last = produced an error
let angleMode = "deg";     // "deg" or "rad" — how sin/cos/tan read their input


/* ---------- 4. Maths ---------- */

/** Converts the angle to radians when in DEG mode (JavaScript's Math uses radians). */
const toRad = (x) => (angleMode === "deg" ? (x * Math.PI) / 180 : x);

/**
 * Rounds tiny floating-point leftovers to exactly 0.
 * Without this, sin(180°) would show 1.2e-16 instead of 0.
 */
const snap = (x) => (Math.abs(x) < 1e-12 ? 0 : x);

/** What each function key does with the value inside its brackets. */
const FUNCS = {
  "sin(": (x) => snap(Math.sin(toRad(x))),
  "cos(": (x) => snap(Math.cos(toRad(x))),
  // tan is undefined where cos is 0 (e.g. 90°), so return NaN → "Error".
  "tan(": (x) => (snap(Math.cos(toRad(x))) === 0 ? NaN : snap(Math.tan(toRad(x)))),
  "ln(": Math.log,    // natural logarithm
  "log(": Math.log10, // base-10 logarithm
  "√(": Math.sqrt,    // square root (negative input → NaN → "Error")
};

/**
 * n! = 1 × 2 × … × n.
 * Only whole numbers from 0 to 170 work; 171! is too big for JavaScript.
 */
function factorial(n) {
  if (!Number.isInteger(n) || n < 0 || n > 170) return NaN;
  let result = 1;
  for (let i = 2; i <= n; i++) result *= i;
  return result;
}

/**
 * Turns a number into display text.
 * - Infinity or NaN (from 1 ÷ 0, √−1, etc.) becomes "Error".
 * - Rounds to 12 significant digits to hide floating-point noise,
 *   so 0.1 + 0.2 shows 0.3 instead of 0.30000000000000004.
 */
function format(value) {
  if (!Number.isFinite(value)) return "Error";
  return String(parseFloat(value.toPrecision(12)));
}

/**
 * Works out the value of a token list using normal maths rules.
 *
 * Order, from first to last:
 *   brackets and functions → postfix (! % ² ⁻¹) → powers (^)
 *   → minus sign on a number → × and ÷ → + and −
 *
 * A number written right next to a bracket, function or constant means
 * multiply: "2π" = 2 × π and "3(4)" = 3 × 4.
 *
 * Throws an error if the sum doesn't make sense (e.g. "2 × )").
 * This is a small "recursive descent" parser: each parseX function below
 * handles one level of the order above and calls the next level down.
 */
function evaluate(list) {
  // Step 1: join consecutive digit tokens into real numbers,
  // e.g. ["1", "2", ".", "5", "+", "3"] → [{value: 12.5}, "+", {value: 3}].
  const t = [];
  let num = "";
  for (const tok of list) {
    if (isNum(tok)) { num += tok; continue; }
    if (num) { t.push({ value: Number(num) }); num = ""; }
    t.push(tok);
  }
  if (num) t.push({ value: Number(num) });

  // Step 2: walk through the tokens with a position counter.
  let i = 0;
  const peek = () => t[i];   // look at the current token without moving on
  const next = () => t[i++]; // take the current token and move to the next
  const expect = (tok) => { if (next() !== tok) throw new Error("syntax"); };

  // True if this token can start a value (used to spot implicit multiply).
  const startsValue = (tok) =>
    tok !== undefined &&
    (typeof tok === "object" || CONSTS.includes(tok) || tok === "(" || FUNCS[tok]);

  /** Lowest priority: addition and subtraction, worked left to right. */
  function parseExpr() {
    let v = parseTerm();
    while (peek() === "+" || peek() === "−") {
      const op = next();
      const r = parseTerm();
      v = op === "+" ? v + r : v - r;
    }
    return v;
  }

  /** Multiplication and division, plus implicit multiply like "2π". */
  function parseTerm() {
    let v = parseUnary();
    for (;;) {
      const tok = peek();
      if (tok === "×") { next(); v *= parseUnary(); }
      else if (tok === "÷") { next(); const r = parseUnary(); v = r === 0 ? NaN : v / r; }
      else if (startsValue(tok)) v *= parseUnary(); // nothing between them → multiply
      else return v;
    }
  }

  /** A minus (or plus) sign in front of a value, e.g. "−3". */
  function parseUnary() {
    if (peek() === "−") { next(); return -parseUnary(); }
    if (peek() === "+") { next(); return parseUnary(); }
    return parsePower();
  }

  /**
   * Powers. They group right to left, so 2^3^2 = 2^9 = 512.
   * The minus sign binds looser than ^, so −2² = −4 (standard maths).
   */
  function parsePower() {
    const base = parsePostfix();
    if (peek() === "^") { next(); return Math.pow(base, parseUnary()); }
    return base;
  }

  /** Operators written after a value: 5! 50% 3² 4⁻¹. Several may stack. */
  function parsePostfix() {
    let v = parsePrimary();
    for (;;) {
      const tok = peek();
      if (tok === "!") { next(); v = factorial(v); }
      else if (tok === "%") { next(); v /= 100; }
      else if (tok === "²") { next(); v *= v; }
      else if (tok === "⁻¹") { next(); v = 1 / v; }
      else return v;
    }
  }

  /** Highest priority: a number, a constant, a bracket, or a function. */
  function parsePrimary() {
    const tok = next();
    if (tok === undefined) throw new Error("syntax");     // sum ended too early
    if (typeof tok === "object") return tok.value;        // a number
    if (tok === "π") return Math.PI;
    if (tok === "e") return Math.E;
    if (tok === "(") { const v = parseExpr(); expect(")"); return v; }
    if (FUNCS[tok]) { const v = parseExpr(); expect(")"); return FUNCS[tok](v); }
    throw new Error("syntax");                            // something out of place
  }

  const result = parseExpr();
  if (i < t.length) throw new Error("syntax"); // leftover tokens → bad sum
  return result;
}

/**
 * Counts brackets that are still open.
 * "sin(" and "(" add one, ")" removes one.
 */
function openCount(list) {
  let n = 0;
  for (const tok of list) {
    if (isOpen(tok)) n++;
    else if (tok === ")") n--;
  }
  return n;
}

/**
 * Makes a half-typed sum ready to calculate, without changing what is on screen:
 *   - removes a dangling operator or function at the end ("2 +" → "2"),
 *   - closes any open brackets ("cos(90" → "cos(90)").
 * Returns a new list; the original tokens are left alone.
 */
function prepare(list) {
  const expr = list.slice();
  while (expr.length && (isBinary(expr[expr.length - 1]) || isOpen(expr[expr.length - 1]))) {
    expr.pop();
  }
  for (let n = openCount(expr); n > 0; n--) expr.push(")");
  return expr;
}

/**
 * Calculates a prepared token list and returns display text:
 * the answer (e.g. "8", "-2.5") or "Error".
 */
function calculate(expr) {
  try {
    return format(evaluate(expr));
  } catch {
    return "Error";
  }
}

/** Shows a minus sign as the proper "−" symbol, matching the − key. */
const pretty = (text) => text.replace(/^-/, "−");


/* ---------- 5. Typing input ---------- */

/** The digits at the end of the sum, joined, e.g. "12.5" — used for the "." rule. */
function trailingNumber() {
  let s = "";
  for (let i = tokens.length - 1; i >= 0 && isNum(tokens[i]); i--) s = tokens[i] + s;
  return s;
}

/**
 * Adds a button's token to the sum, following rules that keep the sum valid:
 *   - after an answer, an operator continues from it; anything else starts fresh,
 *   - pressing two operators in a row swaps the first for the second,
 *     except a "−" after × ÷ ^, which makes the next number negative,
 *   - "." only once per number, and "." alone becomes "0.",
 *   - ")" only when a bracket is open, and "!" "%" "²" only after a value,
 *   - typing 5 over a lone 0 gives "5", not "05".
 */
function insert(token) {
  // Leave the error/answer screen first.
  if (isError) {
    clearAll();
  } else if (justEvaluated) {
    justEvaluated = false;
    if (!isBinary(token) && !POSTFIX.includes(token)) {
      tokens = [];
      history = "";
    }
  }

  const last = tokens[tokens.length - 1];

  // Operators: + − × ÷ ^
  if (isBinary(token)) {
    // At the very start or right after "(", only "−" makes sense (a negative number).
    if (last === undefined || isOpen(last)) {
      if (token === "−") tokens.push(token);
      return;
    }
    if (isBinary(last)) {
      // "2 × −3": allow a minus sign after × ÷ ^.
      if (token === "−" && last !== "−" && last !== "+") { tokens.push(token); return; }
      // Otherwise remove the previous operator(s) and use the new one.
      while (isBinary(tokens[tokens.length - 1])) tokens.pop();
      const before = tokens[tokens.length - 1];
      if (before === undefined || isOpen(before)) {
        if (token === "−") tokens.push(token);
        return;
      }
    }
    tokens.push(token);
    return;
  }

  // Postfix operators: ! % ² ⁻¹ need a value in front of them.
  if (POSTFIX.includes(token)) {
    if (endsValue(last)) tokens.push(token);
    return;
  }

  // Closing bracket: needs an open bracket and a value inside it.
  if (token === ")") {
    if (endsValue(last) && openCount(tokens) > 0) tokens.push(token);
    return;
  }

  // Decimal point: once per number; on its own it becomes "0.".
  if (token === ".") {
    const num = trailingNumber();
    if (num.includes(".")) return;
    if (!num) tokens.push("0");
    tokens.push(".");
    return;
  }

  // Replace a lone leading zero instead of writing "05".
  if (/^[0-9]$/.test(token) && last === "0" && !isNum(tokens[tokens.length - 2])) {
    tokens[tokens.length - 1] = token;
    return;
  }

  // Digits, functions, "(", π and e are simply added.
  tokens.push(token);
}


/* ---------- 6. Commands ---------- */

/**
 * The = key: makes the live answer final.
 * The sum moves to the grey line ("2 × 4 =") and the answer becomes the
 * big number, ready to continue with another operator.
 */
function equals() {
  if (isError || justEvaluated || tokens.length === 0) return;

  const expr = prepare(tokens);
  if (!expr.length) return;

  history = renderTokens(expr) + " =";
  const result = calculate(expr);

  if (result === "Error") {
    isError = true;
    tokens = [];
  } else {
    // Store the answer as tokens so you can keep calculating with it.
    // A negative answer becomes ["−", "8"] so ± and ⌫ treat it like typed input.
    tokens = result.startsWith("-") ? ["−", result.slice(1)] : [result];
    justEvaluated = true;
  }
}

/** AC: clears the sum, the history line and any error. */
function clearAll() {
  tokens = [];
  history = "";
  isError = false;
  justEvaluated = false;
}

/** ⌫: removes the last button press (one digit, one operator, or "sin("). */
function backspace() {
  if (isError) { clearAll(); return; }
  if (justEvaluated) return; // an answer isn't something you typed, so leave it
  tokens.pop();
}

/**
 * True when the "−" at position i is a minus sign on a number
 * (at the start, or after an operator or "("), not a subtraction.
 */
const isUnaryAt = (i) => i === 0 || isBinary(tokens[i - 1]) || isOpen(tokens[i - 1]);

/**
 * ±: flips the sign of the number at the end of the sum.
 * "5 × 3" → "5 × −3" → "5 × 3". With no number yet, it starts one with "−".
 */
function toggleSign() {
  if (isError) return;

  // Find where the last number starts.
  let start = tokens.length;
  while (start > 0 && isNum(tokens[start - 1])) start--;

  // No number at the end yet: add or remove a leading minus sign.
  if (start === tokens.length) {
    const last = tokens[tokens.length - 1];
    if (last === "−" && isUnaryAt(tokens.length - 1)) tokens.pop();
    else if (last === undefined || isBinary(last) || isOpen(last)) tokens.push("−");
    return;
  }

  // Remove the minus sign in front of the number, or add one.
  if (tokens[start - 1] === "−" && isUnaryAt(start - 1)) tokens.splice(start - 1, 1);
  else tokens.splice(start, 0, "−");
}

/** DEG/RAD: switches the angle unit used by sin, cos and tan. */
function toggleAngle() {
  angleMode = angleMode === "deg" ? "rad" : "deg";
  angleToggle.textContent = angleMode.toUpperCase();
  save();
}

/**
 * Shows or hides the scientific keys and updates the mode button.
 * The "scientific" class lets the CSS make the main keys shorter.
 */
function setScientific(on) {
  calc.classList.toggle("scientific", on);
  sciKeys.hidden = !on;
  modeToggle.textContent = on ? "Basic" : "Scientific"; // the label names the mode you'd switch TO
  modeToggle.setAttribute("aria-pressed", String(on));
}

/** Mode button: switches between Basic and Scientific and remembers the choice. */
function toggleMode() {
  setScientific(sciKeys.hidden);
  save();
}


/* ---------- 7. Drawing the screen ---------- */

/**
 * Turns tokens into readable text.
 * Operators get spaces around them ("2 + 3"), but a minus sign on a
 * number stays attached ("2 × −3"). "^" stays tight: "2^10".
 */
function renderTokens(list) {
  return list
    .map((tok, i) => {
      if (!isBinary(tok) || tok === "^") return tok;
      const unary = i === 0 || isBinary(list[i - 1]) || isOpen(list[i - 1]);
      return unary ? tok : ` ${tok} `;
    })
    .join("");
}

/**
 * The live answer shown under the sum while typing.
 * It stays empty when:
 *   - an answer or error is already on screen,
 *   - the sum is just a number (showing "= 12" under "12" adds nothing),
 *   - the sum can't be calculated yet (e.g. "5 ÷ 0").
 */
function livePreview() {
  if (isError || justEvaluated) return "";
  const expr = prepare(tokens);
  const isPlainNumber = expr.every((t, i) => isNum(t) || (i === 0 && t === "−"));
  if (isPlainNumber) return "";
  const result = calculate(expr);
  return result === "Error" ? "" : "= " + pretty(result);
}

/** Redraws all three display lines. Called after every key press. */
function render() {
  const text = isError ? "Error" : tokens.length ? renderTokens(tokens) : "0";
  display.textContent = text;

  // Shrink the big text step by step so long sums still fit.
  display.style.fontSize =
    text.length <= 8 ? "56px" : text.length <= 12 ? "44px" : text.length <= 18 ? "34px" : "28px";

  expressionEl.textContent = history;
  previewEl.textContent = livePreview();
}


/* ---------- 8. Remembering settings between visits ---------- */

/** Saves the mode and angle unit in the browser so they're kept next time. */
function save() {
  try {
    localStorage.setItem("calc-settings", JSON.stringify({
      scientific: !sciKeys.hidden,
      angleMode,
    }));
  } catch { /* storage blocked (e.g. private browsing) — just don't remember */ }
}

/** Restores the saved mode and angle unit when the page opens. */
function load() {
  try {
    const s = JSON.parse(localStorage.getItem("calc-settings") || "{}");
    if (s.angleMode === "rad") toggleAngle();
    setScientific(Boolean(s.scientific));
  } catch { /* nothing saved or storage blocked — use the defaults */ }
}


/* ---------- 9. Event listeners ---------- */

/** Which command each data-action button runs. */
const actions = {
  clear: clearAll,
  backspace,
  sign: toggleSign,
  equals,
  angle: toggleAngle,
  mode: toggleMode,
};

/*
 * One click listener for the whole calculator (instead of one per button).
 * It finds which button was pressed, then either adds its data-token
 * or runs its data-action, and redraws the screen.
 */
calc.addEventListener("click", (event) => {
  const key = event.target.closest("button");
  if (!key) return; // clicked on empty space, not a button

  const { token, action } = key.dataset;
  if (token !== undefined) insert(token);
  else if (action) actions[action]();

  render();
});

/** Computer keyboard keys and the token each one types. */
const KEYMAP = {
  "+": "+", "-": "−", "*": "×", "x": "×", "/": "÷", "^": "^",
  "(": "(", ")": ")", "!": "!", "%": "%", ".": ".", ",": ".",
};

/*
 * Keyboard support: digits and the keys above type into the sum,
 * Enter or = calculates, Esc clears, Backspace deletes one press.
 */
document.addEventListener("keydown", (event) => {
  const { key } = event;
  if (event.ctrlKey || event.metaKey || event.altKey) return; // leave shortcuts like Cmd+R alone

  if (/^[0-9]$/.test(key)) insert(key);
  else if (KEYMAP[key]) insert(KEYMAP[key]);
  else if (key === "Enter" || key === "=") { event.preventDefault(); equals(); } // preventDefault: Enter would also "click" the focused button
  else if (key === "Escape") clearAll();
  else if (key === "Backspace") backspace();
  else return; // any other key: do nothing

  render();
});

// Start-up: restore saved settings, then draw the empty calculator.
load();
render();

/*
 * Offline support: register the service worker (sw.js), which saves the
 * app's files on the phone. Browsers only allow this on a real website
 * (https://), so it is skipped when the file is opened straight from disk.
 */
if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  navigator.serviceWorker.register("sw.js");
}
