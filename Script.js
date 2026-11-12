/**
 * SESOVA-1 — 4-Bit ALU Simulator v1.0.0
 * Sesovatech Hardware · Research and Development
 *
 * Software-based functional simulation. This is NOT a gate-level model,
 * an HDL description, or an FPGA implementation.
 */
'use strict';

/* ==========================================================================
   1. Constants and configuration
   ========================================================================== */

const WORD_BITS = 4;
const WORD_MASK = (1 << WORD_BITS) - 1; // 0b1111 = 15: keeps every value inside 4 bits
const MAX_VALUE = WORD_MASK;

const OPERATIONS = Object.freeze({
  ADD: { label: 'ADD',   usesB: true  },
  SUB: { label: 'SUB',   usesB: true  },
  AND: { label: 'AND',   usesB: true  },
  OR:  { label: 'OR',    usesB: true  },
  XOR: { label: 'XOR',   usesB: true  },
  NOT: { label: 'NOT A', usesB: false },
});

const DEFAULT_STATE = Object.freeze({ a: 5, b: 3, operation: 'ADD' });

/** Predefined example test cases (also used to populate the table). */
const TEST_CASES = Object.freeze([
  { operation: 'ADD', a: 5,  b: 3,  expected: 8  },
  { operation: 'SUB', a: 9,  b: 4,  expected: 5  },
  { operation: 'AND', a: 12, b: 10, expected: 8  },
  { operation: 'OR',  a: 12, b: 10, expected: 14 },
  { operation: 'XOR', a: 12, b: 10, expected: 6  },
  { operation: 'NOT', a: 5,  b: 0,  expected: 10 },
]);

/* ==========================================================================
   2. Pure helpers
   ========================================================================== */

/** Converts a value to a zero-padded 4-bit binary string, e.g. 5 -> "0101". */
function toBinary(value) {
  return (value & WORD_MASK).toString(2).padStart(WORD_BITS, '0');
}

/** Parses and clamps an operand into the valid 4-bit range 0..15. */
function clampOperand(value) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) return 0;
  return Math.min(MAX_VALUE, Math.max(0, parsed));
}

/** Throws if the operation is not one of the six supported ALU operations. */
function assertValidOperation(operation) {
  if (!Object.prototype.hasOwnProperty.call(OPERATIONS, operation)) {
    throw new Error(`Unsupported ALU operation: "${operation}"`);
  }
}

/** Human-readable expression, e.g. "9 − 4", "12 AND 10", "NOT 5". */
function formatExpression(operation, a, b) {
  switch (operation) {
    case 'ADD': return `${a} + ${b}`;
    case 'SUB': return `${a} − ${b}`;
    case 'NOT': return `NOT ${a}`;
    default:    return `${a} ${operation} ${b}`;
  }
}

/* ==========================================================================
   3. ALU core (no DOM access here)
   ========================================================================== */

/**
 * Executes one ALU operation on two 4-bit operands.
 *
 * Flag rules:
 *   carry  = 1 only for ADD when the true sum exceeds 15.
 *   borrow = 1 only for SUB when A < B.
 *   zero   = 1 whenever the final 4-bit result is 0000.
 *
 * @returns {{operation:string,a:number,b:number,raw:number|null,result:number,
 *            carry:number,borrow:number,zero:number}}
 */
function executeAlu(operation, a, b) {
  assertValidOperation(operation);

  const operandA = clampOperand(a);
  const operandB = clampOperand(b);

  let raw;          // result before the 4-bit mask is applied
  let carry = 0;
  let borrow = 0;

  switch (operation) {
    case 'ADD':
      raw = operandA + operandB;
      carry = raw > MAX_VALUE ? 1 : 0;
      break;
    case 'SUB':
      raw = operandA - operandB; // may be negative; the mask wraps it (two's complement)
      borrow = operandA < operandB ? 1 : 0;
      break;
    case 'AND': raw = operandA & operandB; break;
    case 'OR':  raw = operandA | operandB; break;
    case 'XOR': raw = operandA ^ operandB; break;
    case 'NOT': raw = ~operandA;           break; // JS ~ is 32-bit; the mask keeps the low 4
  }

  // Four-bit overflow handling: discard everything above bit 3.
  // e.g. 16 & 15 = 0, -2 & 15 = 14, ~5 & 15 = 10.
  const result = raw & WORD_MASK;
  const zero = result === 0 ? 1 : 0;

  const hasMeaningfulRaw = operation === 'ADD' || operation === 'SUB';
  return {
    operation,
    a: operandA,
    b: operandB,
    raw: hasMeaningfulRaw ? raw : null,
    result,
    carry,
    borrow,
    zero,
  };
}

/* ==========================================================================
   4. Execution trace builders (text only, no DOM)
   ========================================================================== */

/** Returns an array of explanatory step strings for the given ALU result. */
function buildTraceSteps(r) {
  const { operation, a, b } = r;
  const steps = [];
  const fmt = (n) => `${n} (${toBinary(n)})`;

  steps.push(`Operation: ${OPERATIONS[operation].label}`);
  steps.push(OPERATIONS[operation].usesB
    ? `A = ${fmt(a)}, B = ${fmt(b)}`
    : `A = ${fmt(a)} (B is not used)`);

  switch (operation) {
    case 'ADD': {
      steps.push(`Full sum: ${a} + ${b} = ${r.raw}`);
      steps.push(`Keep 4 bits: ${r.raw} AND 15 = ${r.result} (${toBinary(r.result)})`);
      steps.push(`Carry = ${r.carry} (${r.raw} ${r.carry ? '>' : '≤'} 15)`);
      break;
    }
    case 'SUB': {
      // Hardware performs A − B as A + (~B) + 1 in two's complement.
      const invertedB = (~b) & WORD_MASK;
      const wideSum = a + invertedB + 1;
      steps.push(`Invert B: ~B = ${toBinary(invertedB)} (${invertedB})`);
      steps.push(`Two's complement add: A + ~B + 1 = ${a} + ${invertedB} + 1 = ${wideSum} (${wideSum.toString(2)})`);
      steps.push(`Keep 4 bits: ${wideSum} AND 15 = ${r.result} (${toBinary(r.result)})`);
      const carryOut = wideSum > MAX_VALUE ? 1 : 0;
      steps.push(`Adder carry-out = ${carryOut}; Borrow = NOT carry-out = ${r.borrow} (A ${r.borrow ? '<' : '≥'} B)`);
      break;
    }
    case 'AND':
    case 'OR':
    case 'XOR':
      steps.push(`Apply ${operation} to each bit pair (see bit table below)`);
      steps.push(`Result = ${fmt(r.result)}`);
      break;
    case 'NOT':
      steps.push(`Invert each bit of A: ~${toBinary(a)} = ${toBinary(r.result)}`);
      steps.push(`Result = ${fmt(r.result)}`);
      break;
  }

  steps.push(`Zero = ${r.zero} (result ${toBinary(r.result)} ${r.zero ? '=' : '≠'} 0000)`);
  return steps;
}

/* ==========================================================================
   5. Self-test suite (expected values written out independently of the ALU)
   ========================================================================== */

const VERIFICATION_CASES = Object.freeze([
  // Required examples
  { name: 'ADD 5 + 3',       op: 'ADD', a: 5,  b: 3,  result: 8,  carry: 0, borrow: 0, zero: 0 },
  { name: 'SUB 9 − 4',       op: 'SUB', a: 9,  b: 4,  result: 5,  carry: 0, borrow: 0, zero: 0 },
  { name: 'AND 12 AND 10',   op: 'AND', a: 12, b: 10, result: 8,  carry: 0, borrow: 0, zero: 0 },
  { name: 'OR 12 OR 10',     op: 'OR',  a: 12, b: 10, result: 14, carry: 0, borrow: 0, zero: 0 },
  { name: 'XOR 12 XOR 10',   op: 'XOR', a: 12, b: 10, result: 6,  carry: 0, borrow: 0, zero: 0 },
  { name: 'NOT 5',           op: 'NOT', a: 5,  b: 0,  result: 10, carry: 0, borrow: 0, zero: 0 },
  // Boundaries, overflow, borrow, zero conditions
  { name: 'ADD 0 + 0 (min)',            op: 'ADD', a: 0,  b: 0,  result: 0,  carry: 0, borrow: 0, zero: 1 },
  { name: 'ADD 15 + 15 (max)',          op: 'ADD', a: 15, b: 15, result: 14, carry: 1, borrow: 0, zero: 0 },
  { name: 'ADD 15 + 1 (overflow)',      op: 'ADD', a: 15, b: 1,  result: 0,  carry: 1, borrow: 0, zero: 1 },
  { name: 'SUB 3 − 5 (borrow)',         op: 'SUB', a: 3,  b: 5,  result: 14, carry: 0, borrow: 1, zero: 0 },
  { name: 'SUB 7 − 7 (zero)',           op: 'SUB', a: 7,  b: 7,  result: 0,  carry: 0, borrow: 0, zero: 1 },
  { name: 'SUB 0 − 15 (max borrow)',    op: 'SUB', a: 0,  b: 15, result: 1,  carry: 0, borrow: 1, zero: 0 },
  { name: 'SUB 15 − 0',                 op: 'SUB', a: 15, b: 0,  result: 15, carry: 0, borrow: 0, zero: 0 },
  { name: 'AND 15 AND 0 (zero)',        op: 'AND', a: 15, b: 0,  result: 0,  carry: 0, borrow: 0, zero: 1 },
  { name: 'AND 15 AND 15',              op: 'AND', a: 15, b: 15, result: 15, carry: 0, borrow: 0, zero: 0 },
  { name: 'OR 0 OR 0 (zero)',           op: 'OR',  a: 0,  b: 0,  result: 0,  carry: 0, borrow: 0, zero: 1 },
  { name: 'OR 15 OR 0',                 op: 'OR',  a: 15, b: 0,  result: 15, carry: 0, borrow: 0, zero: 0 },
  { name: 'XOR 15 XOR 15 (zero)',       op: 'XOR', a: 15, b: 15, result: 0,  carry: 0, borrow: 0, zero: 1 },
  { name: 'XOR 15 XOR 0',               op: 'XOR', a: 15, b: 0,  result: 15, carry: 0, borrow: 0, zero: 0 },
  { name: 'NOT 15 (zero)',              op: 'NOT', a: 15, b: 0,  result: 0,  carry: 0, borrow: 0, zero: 1 },
  { name: 'NOT 0 (max)',                op: 'NOT', a: 0,  b: 0,  result: 15, carry: 0, borrow: 0, zero: 0 },
]);

/**
 * Runs every verification case plus an exhaustive 4-bit range check
 * (all 16 × 16 operand pairs × 6 operations).
 * @returns {{total:number, passed:number, failures:string[]}}
 */
function runVerificationSuite() {
  const failures = [];
  let total = 0;

  VERIFICATION_CASES.forEach((t) => {
    total += 1;
    const r = executeAlu(t.op, t.a, t.b);
    const ok = r.result === t.result && r.carry === t.carry &&
               r.borrow === t.borrow && r.zero === t.zero;
    if (!ok) {
      failures.push(`${t.name}: expected ${t.result}/C${t.carry}/B${t.borrow}/Z${t.zero}, ` +
                    `got ${r.result}/C${r.carry}/B${r.borrow}/Z${r.zero}`);
    }
  });

  // Exhaustive check: result must always be 4 bits and flags must be consistent.
  let exhaustiveOk = true;
  let exhaustiveDetail = '';
  for (const op of Object.keys(OPERATIONS)) {
    for (let a = 0; a <= MAX_VALUE && exhaustiveOk; a += 1) {
      for (let b = 0; b <= MAX_VALUE; b += 1) {
        const r = executeAlu(op, a, b);
        const inRange = Number.isInteger(r.result) && r.result >= 0 && r.result <= MAX_VALUE;
        const zeroOk = r.zero === (r.result === 0 ? 1 : 0);
        const carryOk = r.carry === (op === 'ADD' && a + b > MAX_VALUE ? 1 : 0);
        const borrowOk = r.borrow === (op === 'SUB' && a < b ? 1 : 0);
        if (!(inRange && zeroOk && carryOk && borrowOk)) {
          exhaustiveOk = false;
          exhaustiveDetail = `${op} A=${a} B=${b} -> ${JSON.stringify(r)}`;
          break;
        }
      }
    }
  }
  total += 1;
  if (!exhaustiveOk) failures.push(`Exhaustive 4-bit range/flag check failed at ${exhaustiveDetail}`);

  return { total, passed: total - failures.length, failures };
}

/* ==========================================================================
   6. Application state and DOM wiring
   ========================================================================== */

const state = { ...DEFAULT_STATE };
const dom = {};

function cacheDom() {
  const ids = [
    'inputA', 'inputB', 'decA', 'decB', 'binA', 'binB', 'noteB', 'operandB',
    'resultBits', 'resultDecimal', 'resultExpr',
    'flagCarry', 'flagBorrow', 'flagZero',
    'traceSteps', 'bitGrid', 'testBody', 'testStatus', 'testSummary',
    'resetBtn', 'runTestsBtn',
  ];
  ids.forEach((id) => { dom[id] = document.getElementById(id); });
  dom.opRadios = Array.from(document.querySelectorAll('input[name="operation"]'));
}

/** Small DOM helper. */
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Renders four bit cells (bit 3 on the left) into a container. */
function renderBits(container, value) {
  const bits = toBinary(value);
  container.replaceChildren();
  for (let i = 0; i < WORD_BITS; i += 1) {
    const cell = el('div', bits[i] === '1' ? 'bit is-on' : 'bit');
    cell.appendChild(el('span', '', bits[i]));
    cell.appendChild(el('small', '', `b${WORD_BITS - 1 - i}`));
    container.appendChild(cell);
  }
}

function renderFlag(node, value) {
  node.classList.toggle('is-active', value === 1);
  node.querySelector('.flag-value').textContent = String(value);
}

/** Bit-by-bit table showing A, B and the 4-bit result. */
function renderBitGrid(r) {
  const table = dom.bitGrid;
  table.replaceChildren();

  const thead = el('thead');
  const headRow = el('tr');
  headRow.appendChild(el('th', '', ''));
  for (let bit = WORD_BITS - 1; bit >= 0; bit -= 1) {
    headRow.appendChild(el('th', '', `b${bit}`));
  }
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = el('tbody');
  const addRow = (label, value, className) => {
    const row = el('tr', className);
    row.appendChild(el('th', '', label));
    const bits = toBinary(value);
    for (let i = 0; i < WORD_BITS; i += 1) {
      row.appendChild(el('td', bits[i] === '1' ? 'is-on' : '', bits[i]));
    }
    tbody.appendChild(row);
  };

  addRow('A', r.a);
  if (OPERATIONS[r.operation].usesB) addRow('B', r.b);
  addRow('Result', r.result, 'row-result');
  table.appendChild(tbody);
}

function renderTrace(r) {
  dom.traceSteps.replaceChildren();
  buildTraceSteps(r).forEach((text) => dom.traceSteps.appendChild(el('li', '', text)));
  renderBitGrid(r);
}

/** Single render pass: runs the ALU and synchronises the whole UI with the result. */
function render() {
  const r = executeAlu(state.operation, state.a, state.b);

  // Inputs
  dom.inputA.value = String(r.a);
  dom.inputB.value = String(r.b);
  dom.decA.textContent = String(r.a);
  dom.decB.textContent = String(r.b);
  renderBits(dom.binA, r.a);
  renderBits(dom.binB, r.b);

  // Operation radios
  dom.opRadios.forEach((radio) => { radio.checked = radio.value === state.operation; });
  const usesB = OPERATIONS[state.operation].usesB;
  dom.operandB.classList.toggle('is-unused', !usesB);
  dom.noteB.hidden = usesB;

  // Output
  renderBits(dom.resultBits, r.result);
  dom.resultDecimal.textContent = String(r.result);
  dom.resultExpr.textContent =
    `${OPERATIONS[state.operation].label} · ${formatExpression(state.operation, r.a, r.b)} = ${r.result}`;
  renderFlag(dom.flagCarry, r.carry);
  renderFlag(dom.flagBorrow, r.borrow);
  renderFlag(dom.flagZero, r.zero);

  renderTrace(r);
}

/* ==========================================================================
   7. Test cases, reset and event handlers
   ========================================================================== */

function renderTestTable() {
  dom.testBody.replaceChildren();
  TEST_CASES.forEach((test, index) => {
    const row = el('tr');
    row.appendChild(el('td', '', OPERATIONS[test.operation].label));
    row.appendChild(el('td', '', formatExpression(test.operation, test.a, test.b)));
    row.appendChild(el('td', '', `${test.expected} (${toBinary(test.expected)})`));

    const actionCell = el('td');
    const button = el('button', 'btn btn-small', 'Load');
    button.type = 'button';
    button.dataset.testIndex = String(index);
    button.setAttribute('aria-label',
      `Load test: ${OPERATIONS[test.operation].label} ${formatExpression(test.operation, test.a, test.b)}`);
    actionCell.appendChild(button);
    row.appendChild(actionCell);

    dom.testBody.appendChild(row);
  });
}

function setStatus(message, kind) {
  dom.testStatus.textContent = message;
  dom.testStatus.className = kind ? `status is-${kind}` : 'status';
}

function loadTestCase(index) {
  const test = TEST_CASES[index];
  if (!test) return;
  state.operation = test.operation;
  state.a = test.a;
  state.b = test.b;
  render();

  const r = executeAlu(test.operation, test.a, test.b);
  const passed = r.result === test.expected;
  setStatus(
    `Loaded ${OPERATIONS[test.operation].label} ${formatExpression(test.operation, test.a, test.b)}: ` +
    `expected ${test.expected}, ALU produced ${r.result} — ${passed ? 'PASS' : 'FAIL'}`,
    passed ? 'pass' : 'fail'
  );
}

function resetSimulator() {
  Object.assign(state, DEFAULT_STATE);
  render();
  dom.testSummary.replaceChildren();
  setStatus('Simulator reset to defaults (A = 5, B = 3, ADD).');
}

function showVerificationResults() {
  const { total, passed, failures } = runVerificationSuite();
  dom.testSummary.replaceChildren();

  const headline = el('p', passed === total ? 'ok' : 'bad',
    `${passed} of ${total} checks passed` +
    (passed === total ? ' — all six operations, boundaries, overflow, borrow and zero cases verified.' : '.'));
  dom.testSummary.appendChild(headline);

  if (failures.length > 0) {
    const list = el('ul');
    failures.forEach((message) => list.appendChild(el('li', '', message)));
    dom.testSummary.appendChild(list);
  }
  setStatus('');
}

function bindEvents() {
  dom.inputA.addEventListener('input', (event) => {
    state.a = clampOperand(event.target.value);
    render();
  });
  dom.inputB.addEventListener('input', (event) => {
    state.b = clampOperand(event.target.value);
    render();
  });

  dom.opRadios.forEach((radio) => {
    radio.addEventListener('change', (event) => {
      try {
        assertValidOperation(event.target.value);
        state.operation = event.target.value;
      } catch (error) {
        console.error(error);
        state.operation = DEFAULT_STATE.operation; // fall back to a safe operation
      }
      render();
    });
  });

  dom.testBody.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-test-index]');
    if (button) loadTestCase(Number(button.dataset.testIndex));
  });

  dom.resetBtn.addEventListener('click', resetSimulator);
  dom.runTestsBtn.addEventListener('click', showVerificationResults);
}

/* ==========================================================================
   8. Start-up
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
  cacheDom();
  renderTestTable();
  bindEvents();
  render();
});
